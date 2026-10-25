import { inflateSync } from 'node:zlib';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { defaultEdges } from '../engine/edgeTreatments';
import { buildGarment, type GarmentSpec } from '../engine/garmentSetup';
import { fixtureProject, sizeId } from '../engine/testFixtures';
import { buildChart } from '../engine/chart';
import { newSegment, newWaypoint } from '../engine/model';
import { computePanel } from '../engine/panel';
import { rectangle } from '../engine/templates';
import { buildPdf } from './pdf';
import { readySections } from './plan';

// svg2pdf.js needs a DOM; here it only records what it's asked to draw: arrows (measurement labels have some) and
// chart sheets, which are rendered to markup without a DOM (sheetDom stood in) so their content can be checked.
const drawn: string[] = [];
const sheets: { markup: string; at: { x: number; y: number; width: number; height: number } }[] = [];
vi.mock('svg2pdf.js', () => ({
  svg2pdf: async (el: { kids?: { attrs: Record<string, string> }[]; markup?: string }, _doc: unknown, at: { x: number; y: number; width: number; height: number }) => {
    if (el.markup !== undefined) sheets.push({ markup: el.markup, at });
    else drawn.push(el.kids![0].attrs.transform);
  },
}));
vi.mock('./sheetDom', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  return {
    renderSvg: (node: ReactElement) => {
      const markup = renderToStaticMarkup(node);
      return { markup, getAttribute: (k: string) => new RegExp(`<svg[^>]*?\\s${k}="([\\d.]+)"`).exec(markup)?.[1] ?? null };
    },
  };
});
const el = () => ({ attrs: {} as Record<string, string>, kids: [] as unknown[], setAttribute(k: string, v: string) { this.attrs[k] = v; }, append(...k: unknown[]) { this.kids.push(...k); } });
vi.stubGlobal('document', { createElementNS: el });

const garment = (s: Partial<GarmentSpec>) =>
  buildGarment({ ...fixtureProject(), panels: [], joins: [] }, { method: 'seamed', opening: 'closed', neckline: 'round', sleeve: 'set-in', ease: 'standard', edges: defaultEdges(), ...s });

/** The text drawn on each page (content streams inflated). */
async function pdfText(blob: Blob): Promise<string> {
  const bin = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  const out: string[] = [];
  for (const m of bin.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      out.push(inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'));
    } catch {
      out.push(m[1]);
    }
  }
  return out.join('\n');
}

describe('buildPdf', () => {
  it('pages, page numbers and the footer; no credit for seamed panels', async () => {
    const p = garment({});
    const blob = await buildPdf(p, { sizeIds: p.sizes.map((s) => s.id), paper: 'a4', sections: readySections() }, { date: new Date(2026, 9, 25) });
    const text = await pdfText(blob);
    expect(text).toContain('(p. 1 of ');
    expect(text).toContain('Made with Knitbit');
    expect(text).toContain('25 Oct 2026');
    expect(text).toContain('(Finished measurements)');
    expect(text).not.toContain('Susie Myers');
    expect(drawn.length).toBeGreaterThan(0);
    // Long tables flow: all sizes need more than one page.
    expect(text.match(/\(p\. \d+ of (\d+)\)/)![1]).not.toBe('1');
  });

  it('the contiguous credit in the footer of every page, unless switched off', async () => {
    const p = garment({ method: 'contiguous', sleeve: 'contiguous' });
    const opts = { sizeIds: [sizeId(p, 'M')], paper: 'letter' as const, sections: readySections() };
    const text = await pdfText(await buildPdf(p, opts));
    const pages = Number(text.match(/\(p\. 1 of (\d+)\)/)![1]);
    expect(text.match(/Susie Myers/g)?.length).toBe(pages);
    const off = await pdfText(await buildPdf({ ...p, settings: { ...p.settings, exportCredit: false } }, opts));
    expect(off).not.toContain('Susie Myers');
  });

  it('a raglan yoke has no credit; a minus sign prints as "-"', async () => {
    const p = garment({ method: 'raglan', sleeve: 'raglan' });
    const text = await pdfText(await buildPdf(p, { sizeIds: [sizeId(p, 'M')], paper: 'a4', sections: ['finished'] }));
    expect(text).not.toContain('Susie Myers');
    expect(text).not.toMatch(/−/);
  });
});

describe('chart pages', () => {
  /** A plain rectangle `sts` wide and `rows` tall (gauge 10 × 10 per 10 cm, so 1 st and 1 row per cm; plus 2 selvedge stitches). */
  function big(sts: number, rows: number, symbols = false) {
    const p = { ...fixtureProject(), panels: [], joins: [] } as ReturnType<typeof fixtureProject>;
    p.gauge = { stitches: 10, rows: 10, basis: '10cm' };
    const panel = rectangle();
    panel.waypoints = [newWaypoint('bottom', 0, sts - 2), newWaypoint('top', rows, 'bottom.width')];
    panel.segments = [newSegment(panel.waypoints[0].id, { kind: 'straight' })];
    p.panels.push(panel);
    if (symbols) {
      p.symbols = [{ id: 'mb', label: 'Make bobble', abbr: 'MB', color: '#f2d17a', change: 0 }];
      panel.freeStitches = [
        { id: 'f1', sizeId: p.baseSizeId, row: 10, x: 0.5, symbol: 'mb', mirror: false },
        { id: 'f2', sizeId: p.baseSizeId, row: 12, x: 0.5, symbol: 'purl', mirror: false },
      ] as typeof panel.freeStitches;
    }
    return { p, panel };
  }

  it('150 stitches × 200 rows: tiles that fit the page and line up, with links and a map', async () => {
    const { p, panel } = big(150, 200);
    const c = computePanel(p, panel, p.baseSizeId);
    const chart = buildChart(p, panel, c);
    expect([chart.cols, chart.rows.length]).toEqual([150, 200]);
    sheets.length = 0;
    const text = await pdfText(await buildPdf(p, { sizeIds: [p.baseSizeId], paper: 'a4', sections: ['charts'] }));
    // The tiles (the key's swatch column is the narrow one).
    const tileSheets = sheets.filter((s) => s.at.width > 10);
    expect(tileSheets.length).toBeGreaterThan(4);
    expect(sheets.length - tileSheets.length).toBe(1);
    // Every tile sits inside an A4 page (portrait or landscape) with the margins.
    for (const s of sheets) {
      const portrait = s.at.x + s.at.width <= 210 - 12 + 1e-6 && s.at.y + s.at.height <= 297 - 12;
      const landscape = s.at.x + s.at.width <= 297 - 12 + 1e-6 && s.at.y + s.at.height <= 210 - 12;
      expect(portrait || landscape).toBe(true);
    }
    // Cells of at least 3.5 mm: the sheet's cell rects are as wide as the tile's cell size.
    const cell = Number(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="([\d.]+)"/.exec(tileSheets[0].markup)![1]);
    expect(cell).toBeGreaterThanOrEqual(3.5);
    expect(cell).toBeLessThanOrEqual(4.5);
    // The first tile holds row 1 and stitch 1; the last row and stitch appear on the last tile.
    const tiles = tileSheets.length;
    expect(text).toContain(`(tile 1 of ${tiles}`);
    expect(text).toContain(`(tile ${tiles} of ${tiles}`);
    // ("–" is 0x96 in Helvetica's WinAnsi encoding.)
    expect(text).toMatch(/\(Rectangle chart · size \w+ · rows 1\x96\d+ · sts 1\x96\d+\)/);
    expect(tileSheets[tiles - 1].markup).toContain('>200<');
    expect(tileSheets[tiles - 1].markup).toContain('>150<');
    expect(tileSheets[0].markup).toContain('>1<');
    expect(text).toContain('Continues ');
    // Page 1 is the header, tile 1 is p. 2, the key (no room under a full tile) p. 3, tile 2 (to the left) p. 4.
    expect(text).toContain('( on p. 4 · )');
    expect(text.indexOf('(Key)')).toBeGreaterThan(text.indexOf('(tile 1 of'));
    expect(text.indexOf('(Key)')).toBeLessThan(text.indexOf('(tile 2 of'));
    expect(text).toContain('From ');
    // No CSS variables or classes reach svg2pdf, except the glyph classes sheetDom turns into attributes.
    for (const s of sheets) {
      expect(s.markup).not.toContain('var(');
      expect(s.markup).not.toMatch(/class="(?!glyph)/);
    }
  });

  it('the key lists every used symbol, custom ones with their abbreviation', async () => {
    const { p } = big(30, 20, true);
    sheets.length = 0;
    const text = await pdfText(await buildPdf(p, { sizeIds: [p.baseSizeId], paper: 'a4', sections: ['charts'] }));
    expect(text).toContain('(Key)');
    expect(text).toContain('(MB: Make bobble)');
    expect(text).toContain('(p: Purl \\(RS\\), knit \\(WS\\))');
    expect(text).toContain('(k: Knit \\(RS\\), purl \\(WS\\))');
    expect(text).toContain('(whole chart');
    // The custom symbol's abbreviation is drawn in its cell.
    expect(sheets.some((s) => s.markup.includes('>MB</text>'))).toBe(true);
  });

  it('short rows, top-down numbering and collapse are as on the Chart tab', async () => {
    const p = garment({});
    const front = p.panels.find((x) => x.name.toLowerCase().includes('front'))!;
    const c = computePanel(p, front, sizeId(p, 'M'));
    const chart = buildChart(p, front, c);
    const sr = chart.rows.filter((r) => r.shortRow).map((r) => r.label);
    sheets.length = 0;
    await buildPdf(p, { sizeIds: [sizeId(p, 'M')], paper: 'a4', sections: ['charts'], collapse: true });
    const all = sheets.map((s) => s.markup).join('\n');
    for (const l of sr) expect(all).toContain(`>${l}</text>`);
    expect(all).toContain('>…');

    const td = garment({ method: 'raglan', sleeve: 'raglan' });
    sheets.length = 0;
    const text = await pdfText(await buildPdf(td, { sizeIds: [sizeId(td, 'M')], paper: 'a4', sections: ['charts'] }));
    expect(text).toContain('Worked top-down: row 1 at the top');
  });
});
