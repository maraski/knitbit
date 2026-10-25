// Splitting a stitch chart into page-sized tiles. Pure. A chart bigger than a page is cut into bands of rows and,
// when it's wider than the page, bands of stitches; neighbouring tiles share one row and one stitch, so they line
// up when laid side by side. Tiles are read the way a flat chart is knitted: the first rows first (at the bottom of
// a bottom-up chart, at the top of a top-down one), and each band from the right, where stitch 1 is.
//
// Rows are indices into `chart.rows` (knit order, short rows included); columns are display columns (after the
// collapse-plain-middle fold, if it's on), 0 at the left.

import type { Chart, DisplayCol } from '../engine/chart';

/** Cell size on paper, mm: about 6 rows to the inch. */
export const CELL_MM = 4.5;
/** The smallest cell size used to save a page. */
export const MIN_CELL_MM = 3.5;

/** A run of indices, both ends included. */
export interface Span {
  from: number;
  to: number;
}

/** Spans covering `n` items, at most `per` each, neighbours sharing one item. */
export function spans(n: number, per: number): Span[] {
  if (n <= 0) return [];
  const step = Math.max(1, per - 1);
  const out: Span[] = [];
  for (let from = 0; ; from += step) {
    const to = Math.min(n - 1, from + Math.max(1, per) - 1);
    out.push({ from, to });
    if (to >= n - 1) return out;
  }
}

/** How many spans `spans(n, per)` gives. */
export function spanCount(n: number, per: number): number {
  if (n <= 0) return 0;
  return n <= per ? 1 : Math.ceil((n - 1) / Math.max(1, per - 1));
}

export interface TileGrid {
  cell: number; // mm
  /** Row bands, in knit order. */
  rowSpans: Span[];
  /** Column bands, right to left (the first one holds stitch 1). */
  colSpans: Span[];
}

/** Cells of `cell` mm that fit in `mm`. */
const fits = (mm: number, cell: number) => Math.max(2, Math.floor(mm / cell + 1e-9));

/**
 * Cut `rows` × `cols` cells into tiles whose grid fits `box` (mm, the room for the cells alone). The cell is
 * `cell` mm, shrunk down to `minCell` only when that saves tiles, and then no further than needed.
 */
export function fitGrid(rows: number, cols: number, box: { width: number; height: number }, opts: { cell?: number; minCell?: number } = {}): TileGrid {
  const big = opts.cell ?? CELL_MM;
  const small = Math.min(big, opts.minCell ?? MIN_CELL_MM);
  // The largest cell that still gives an axis its fewest spans.
  const best = (n: number, mm: number) => {
    const count = spanCount(n, fits(mm, small));
    const per = count <= 1 ? n : Math.ceil((n - 1) / count) + 1;
    return Math.min(big, Math.max(small, mm / Math.max(1, per)));
  };
  const cell = Math.min(best(rows, box.height), best(cols, box.width));
  const rowSpans = spans(rows, fits(box.height, cell));
  const colSpans = spans(cols, fits(box.width, cell)).map((s) => ({ from: cols - 1 - s.to, to: cols - 1 - s.from }));
  return { cell, rowSpans, colSpans };
}

export const tileTotal = (g: TileGrid) => g.rowSpans.length * g.colSpans.length;

export interface Tile {
  /** Reading order, 0 first. */
  index: number;
  /** Row band (0 = the first rows knitted) and column band (0 = the rightmost). */
  band: number;
  column: number;
  rows: Span;
  cols: Span;
  /** The row and the column repeated from the tile before (drawn lighter), if any. */
  overlapRow: number | null;
  overlapCol: number | null;
  page: number;
  /** Pages of the neighbouring tiles, by the side they're on as the chart is drawn. */
  next: Partial<Record<'up' | 'down' | 'left' | 'right', number>>;
}

/**
 * The tiles of a grid, in reading order, with their pages: one tile per page from `firstPage`, plus
 * `pagesAfterFirst` pages (the symbol key's) between the first tile and the second.
 */
export function layoutTiles(grid: TileGrid, opts: { firstPage: number; topDown: boolean; pagesAfterFirst?: number }): Tile[] {
  const nx = grid.colSpans.length;
  const pageOf = (band: number, column: number) => {
    const i = band * nx + column;
    return opts.firstPage + i + (i > 0 ? (opts.pagesAfterFirst ?? 0) : 0);
  };
  const tiles: Tile[] = [];
  grid.rowSpans.forEach((rows, band) => {
    grid.colSpans.forEach((cols, column) => {
      const next: Tile['next'] = {};
      // Later rows are above a bottom-up chart, below a top-down one.
      const later = opts.topDown ? 'down' : 'up';
      const earlier = opts.topDown ? 'up' : 'down';
      if (band + 1 < grid.rowSpans.length) next[later] = pageOf(band + 1, column);
      if (band > 0) next[earlier] = pageOf(band - 1, column);
      if (column + 1 < nx) next.left = pageOf(band, column + 1);
      if (column > 0) next.right = pageOf(band, column - 1);
      tiles.push({
        index: band * nx + column,
        band,
        column,
        rows,
        cols,
        overlapRow: band > 0 ? rows.from : null,
        overlapCol: column > 0 ? cols.to : null,
        page: pageOf(band, column),
        next,
      });
    });
  });
  return tiles;
}

/** The stitch number of a display column (stitch 1 at the right, as a RS row is read); null for a folded gap. */
export function stitchOf(chart: Pick<Chart, 'cols'>, d: DisplayCol): number | null {
  return 'col' in d ? chart.cols - d.col : null;
}

/** Display columns of a tile to number: every 5th stitch, stitch 1, and the tile's two edges unless crowded. */
export function stitchLabels(chart: Pick<Chart, 'cols'>, dcols: DisplayCol[], span: Span): { xi: number; n: number }[] {
  const out: { xi: number; n: number }[] = [];
  for (let xi = span.from; xi <= span.to; xi++) {
    const n = stitchOf(chart, dcols[xi]);
    if (n === null) continue;
    const edge = xi === span.from || xi === span.to;
    if (n % 5 === 0 || n === 1) out.push({ xi, n });
    else if (edge && n % 5 !== 1 && n % 5 !== 4) out.push({ xi, n });
  }
  return out;
}

/** "rows 1–52 · sts 1–40" for a tile ("SR" rows count as the row they follow). */
export function tileRange(chart: Pick<Chart, 'cols' | 'rows'>, dcols: DisplayCol[], tile: Pick<Tile, 'rows' | 'cols'>): string {
  const knit = chart.rows.slice(tile.rows.from, tile.rows.to + 1).map((r) => r.knitRow);
  const sts = dcols.slice(tile.cols.from, tile.cols.to + 1).flatMap((d) => stitchOf(chart, d) ?? []);
  const lo = Math.max(1, Math.min(...knit));
  const hi = Math.max(1, ...knit);
  const rows = lo === hi ? `row ${lo}` : `rows ${lo}–${hi}`;
  return sts.length ? `${rows} · sts ${Math.min(...sts)}–${Math.max(...sts)}` : rows;
}

/**
 * Rows whose stitch count is printed in the counts column: where it changes (as on the Chart tab), and each tile's
 * first row so a tile can be read on its own. Keys of `chart.rows`.
 */
export function countRows(chart: Pick<Chart, 'rows' | 'castOn'>, tile?: Pick<Tile, 'rows'>): Set<string> {
  const s = new Set<string>();
  let prev = chart.castOn;
  for (const r of chart.rows) {
    if (!r.shortRow && r.count !== prev) s.add(r.key);
    if (!r.shortRow) prev = r.count;
  }
  if (tile) {
    const first = chart.rows.slice(tile.rows.from, tile.rows.to + 1).find((r) => !r.shortRow);
    if (first) s.add(first.key);
  }
  return s;
}
