import { inflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { defaultEdges } from '../engine/edgeTreatments';
import { buildGarment, type GarmentSpec } from '../engine/garmentSetup';
import { fixtureProject, sizeId } from '../engine/testFixtures';
import { buildPdf } from './pdf';
import { readySections } from './plan';

// svg2pdf.js needs a DOM; here it only counts the arrows it's asked to draw (measurement labels have some).
const drawn: string[] = [];
vi.mock('svg2pdf.js', () => ({ svg2pdf: async (el: { kids: { attrs: Record<string, string> }[] }) => void drawn.push(el.kids[0].attrs.transform) }));
// The schematic itself needs a browser (render.tsx); here a stand-in fitted like the real one, about 60 cm across.
vi.mock('./render', () => ({
  pieceSvg: async (_p: unknown, panel: { name: string }, _c: unknown, _s: unknown, width: number, _h: number, snap: (px: number) => number) => ({
    svg: { kids: [{ attrs: { transform: `schematic ${panel.name}` } }], querySelectorAll: () => [] },
    pxPerCm: snap(width / 60),
  }),
}));
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

describe('schematic pages', () => {
  const pages = (text: string) => Number(text.match(/\(p\. 1 of (\d+)\)/)![1]);

  it('a page per piece per size, after the tables; fronts and sleeves once, marked "make 2"', async () => {
    const p = garment({ opening: 'cardigan' });
    drawn.length = 0;
    const sizes = [sizeId(p, 'S'), sizeId(p, 'M')];
    const text = await pdfText(await buildPdf(p, { sizeIds: sizes, paper: 'a4', sections: ['schematics'] }));
    const front = p.panels.find((x) => x.half?.side === 'left')!.name;
    const right = p.panels.find((x) => x.half?.side === 'right')!.name;
    expect(text).toContain(`(${front} · size S)`);
    expect(text).toContain(`(${front} · size M)`);
    expect(text).not.toContain(`(${right} · size`);
    expect(text).toMatch(/\(make 2, mirrored · scale 1 : [\d.]+\)/);
    expect(text).toMatch(/\(make 2 · scale 1 : [\d.]+\)/);
    expect(text).toContain('(Waypoint)');
    // Header page + one page per piece per size.
    const pieces = p.panels.length - 1;
    expect(pages(text)).toBe(1 + 2 * pieces);
    expect(drawn.filter((d) => d?.startsWith('schematic')).length).toBe(2 * pieces);
    // In the size's order, the piece's order.
    expect(text.indexOf(`(${front} · size S)`)).toBeLessThan(text.indexOf(`(${front} · size M)`));
  });

  it('a contiguous yoke prints laid flat with its phases', async () => {
    const p = garment({ method: 'contiguous', sleeve: 'contiguous' });
    const text = await pdfText(await buildPdf(p, { sizeIds: [sizeId(p, 'M')], paper: 'letter', sections: ['schematics'] }));
    expect(text).toContain('(Yoke · size M)');
    expect(text).toContain('(Phase)');
    expect(text).toMatch(/\(Cast on \d+ · split after row \d+/);
  });
});
