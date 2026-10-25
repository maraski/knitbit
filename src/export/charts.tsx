// The stitch-chart pages of one size: each piece's chart cut into tiles (tiles.ts), one tile per page, drawn by
// ChartSheet and placed with svg2pdf. Every tile has a title with its rows and stitches, a small map of the tiles,
// "continues on p. N" links, and the first tile has the piece's symbol key at its foot (or on the next page when it
// doesn't fit). A chart turns landscape when that takes fewer pages.

import { svg2pdf } from 'svg2pdf.js';
import { buildChart, collapseColumns, type Chart, type DisplayCol } from '../engine/chart';
import { cachedPanel } from '../engine/joins';
import type { CustomSymbol } from '../engine/model';
import { ChartSheet, KeySwatches, readPalette, sheetGutters, type Palette, type SheetLayout } from './ChartSheet';
import type { Orientation, RenderContext, Writer } from './pdf';
import type { Part } from './plan';
import { renderSvg } from './sheetDom';
import { pieceEntries } from './tables';
import { fitGrid, layoutTiles, tileRange, tileTotal, type Tile, type TileGrid } from './tiles';

const HEAD = 12; // title lines and the tile map, mm
const FOOT = 9.5; // links and the note under the grid
const MUTED: [number, number, number] = [110, 106, 98];

/** The tiling for one orientation's content box. */
interface Fit {
  orientation: Orientation;
  grid: TileGrid;
}

/** Portrait or landscape, whichever needs fewer tiles (then the bigger cells, then portrait). */
function chooseFit(w: Writer, rows: number, cols: number, g: SheetLayout): Fit {
  const fits = (['portrait', 'landscape'] as const).map((orientation) => {
    const box = w.boxFor(orientation);
    const area = { width: box.width - g.left - g.right, height: box.height - HEAD - g.top - g.bottom - FOOT };
    return { orientation, grid: fitGrid(rows, cols, area) };
  });
  const [p, l] = fits;
  return tileTotal(l.grid) < tileTotal(p.grid) || (tileTotal(l.grid) === tileTotal(p.grid) && l.grid.cell > p.grid.cell + 1e-6) ? l : p;
}

interface KeyEntry {
  id: string;
  lines: string[];
}
const KEY_SWATCH = 4;
const KEY_LINE = 3.3;
const KEY_SIZE = 8; // pt

/** The key's entries split into two columns, with each entry's top (mm) and the block's height. */
function keyLayout(w: Writer, chart: Chart, width: number) {
  const colW = (width - 6) / 2;
  const entries: KeyEntry[] = chart.legend.map((l) => ({ id: l.id, lines: w.wrap(l.abbr ? `${l.abbr}: ${l.label}` : l.label, colW - KEY_SWATCH - 2.5, { size: KEY_SIZE }) }));
  const h = (e: KeyEntry) => Math.max(KEY_SWATCH + 1.4, e.lines.length * KEY_LINE + 1.4);
  const half = Math.ceil(entries.length / 2);
  const columns = [entries.slice(0, half), entries.slice(half)].map((list) => {
    let y = 0;
    const tops = list.map((e) => {
      const t = y;
      y += h(e);
      return t;
    });
    return { list, tops, height: y };
  });
  return { colW, columns, height: 6 + Math.max(...columns.map((c) => c.height)) };
}

async function drawKey(w: Writer, chart: Chart, palette: Palette, custom: CustomSymbol[]) {
  const { left, width } = w.box();
  const k = keyLayout(w, chart, width);
  w.text('Key', left, w.y + 3.5, { size: 9, bold: true });
  const top = w.y + 6;
  for (const [i, col] of k.columns.entries()) {
    if (!col.list.length) continue;
    const x = left + i * (k.colW + 6);
    const svg = renderSvg(<KeySwatches ids={col.list.map((e) => e.id)} size={KEY_SWATCH} pitch={col.tops} palette={palette} custom={custom} />, palette.fg);
    await svg2pdf(svg, w.doc, { x, y: top, width: KEY_SWATCH + 0.5, height: col.height + 0.5 });
    col.list.forEach((e, j) => e.lines.forEach((line, n) => w.text(line, x + KEY_SWATCH + 2.5, top + col.tops[j] + 3.1 + n * KEY_LINE, { size: KEY_SIZE })));
  }
  w.y += k.height;
}

/** A small map of the tiles in the top right corner, this one filled (laid out as the chart is). */
function drawMap(w: Writer, grid: TileGrid, tile: Tile, topDown: boolean, top: number) {
  const nx = grid.colSpans.length;
  const ny = grid.rowSpans.length;
  if (nx * ny <= 1) return;
  const mw = Math.min(3.4, 28 / nx);
  const mh = Math.min(2.4, (HEAD - 2) / ny);
  const right = w.box().right;
  const doc = w.doc;
  doc.setLineWidth(0.15);
  doc.setDrawColor(...MUTED);
  for (let b = 0; b < ny; b++) {
    for (let c = 0; c < nx; c++) {
      const x = right - (c + 1) * mw;
      const y = top + (topDown ? b : ny - 1 - b) * mh;
      const me = b === tile.band && c === tile.column;
      if (me) doc.setFillColor(30, 28, 24);
      else doc.setFillColor(255, 255, 255);
      doc.rect(x, y, mw, mh, 'FD');
    }
  }
}

/** "Continues ← on p. 5 · ↑ on p. 7" and "From → p. 3 · ↓ p. 1" for a tile. */
export function tileLinks(tile: Tile, topDown: boolean): { next: string; prev: string } {
  const arrow = { up: '↑', down: '↓', left: '←', right: '→' } as const;
  const later = topDown ? 'down' : 'up';
  const earlier = topDown ? 'up' : 'down';
  const fmt = (dirs: (keyof typeof arrow)[], word: string) =>
    dirs
      .filter((d) => tile.next[d] !== undefined)
      .map((d) => `${arrow[d]} ${word}p. ${tile.next[d]}`)
      .join(' · ');
  const next = fmt(['left', later], 'on ');
  const prev = fmt(['right', earlier], '');
  return { next: next && `Continues ${next}`, prev: prev && `From ${prev}` };
}

/** One piece's chart: its tiles, one per page, and its key. */
async function drawPiece(w: Writer, ctx: RenderContext, label: string, sizeName: string, chart: Chart, palette: Palette) {
  const custom = (ctx.project.symbols ?? []).map((s) => ({ ...s, abbr: w.clean(s.abbr) }));
  const dcols: DisplayCol[] = ctx.options.collapse ? collapseColumns(chart) : Array.from({ length: chart.cols }, (_, k) => ({ col: k }));
  const gutters = sheetGutters(chart);
  const fit = chooseFit(w, chart.rows.length, dcols.length, gutters);
  const { grid, orientation } = fit;
  const box = w.boxFor(orientation);
  const firstH = (grid.rowSpans[0].to - grid.rowSpans[0].from + 1) * grid.cell;
  const roomUnder = box.height - HEAD - gutters.top - firstH - gutters.bottom - FOOT - 3;
  const keyOwnPage = keyLayout(w, chart, box.width).height > roomUnder;
  const tiles = layoutTiles(grid, { firstPage: w.page + 1, topDown: chart.topDown, pagesAfterFirst: keyOwnPage ? 1 : 0 });
  const total = tiles.length;
  const panelStart = ctx.project.panels.find((p) => p.id === chart.panelId)?.startFrom ?? 'caston';

  for (const tile of tiles) {
    w.newPage(orientation);
    const { left } = w.box();
    const top = w.y;
    w.text(`${label} chart · size ${sizeName} · ${tileRange(chart, dcols, tile)}`, left, top + 4, { size: 10, bold: true });
    const sub = total > 1 ? `tile ${tile.index + 1} of ${total}` : 'whole chart';
    w.text(`${sub} · RS rows read right to left, WS rows left to right`, left, top + 8.5, { size: 8, color: MUTED });
    drawMap(w, grid, tile, chart.topDown, top);

    const node = <ChartSheet chart={chart} dcols={dcols} tile={tile} cell={grid.cell} gutters={gutters} palette={palette} custom={custom} />;
    const svg = renderSvg(node, palette.fg);
    const sw = Number(svg.getAttribute('width'));
    const sh = Number(svg.getAttribute('height'));
    const y = top + HEAD;
    await svg2pdf(svg, w.doc, { x: left, y, width: sw, height: sh });
    w.y = y + sh;

    const links = tileLinks(tile, chart.topDown);
    if (links.next) w.text(links.next, left + gutters.left, w.y + 3.5, { size: 8.5, bold: true });
    if (links.prev) w.text(links.prev, left + sw - gutters.right, w.y + 3.5, { size: 8.5, color: MUTED, align: 'right' });
    if (tile.index === 0) {
      const note = chart.topDown ? `Worked top-down: row 1 at the top · ${panelStart === 'pickup' ? 'pick up' : 'cast on'} ${chart.castOn} sts` : `Cast on ${chart.castOn} sts`;
      w.text(note, left + gutters.left, w.y + 7.5, { size: 8, color: MUTED });
    }
    w.y += FOOT;
    if (tile.index === 0) {
      if (keyOwnPage) {
        w.newPage(orientation);
        w.text(`${label} chart · size ${sizeName} · key`, left, w.y + 4, { size: 10, bold: true });
        w.y += HEAD;
      } else w.y += 3;
      await drawKey(w, chart, palette, custom);
    }
  }
}

/** The charts of every piece for the part's size. */
export async function drawCharts(w: Writer, part: Part, ctx: RenderContext): Promise<void> {
  const sizeId = part.sizeId!;
  const sizeName = ctx.project.sizes.find((s) => s.id === sizeId)?.name ?? '?';
  const palette = readPalette();
  for (const entry of pieceEntries(ctx.project)) {
    const c = cachedPanel(ctx.project, entry.panel.id, sizeId, ctx.cache);
    const chart = c?.ok ? buildChart(ctx.project, entry.panel, c) : null;
    if (!chart || !chart.rows.length || !chart.cols) {
      w.newPage();
      w.text(`${entry.label} chart · size ${sizeName}: can't be charted (fix the piece's problems first)`, w.box().left, w.y + 4, { size: 10, bold: true });
      w.y += HEAD;
      continue;
    }
    await drawPiece(w, ctx, entry.label, sizeName, chart, palette);
    // Give the browser a turn between pieces.
    await new Promise((r) => setTimeout(r, 0));
  }
}
