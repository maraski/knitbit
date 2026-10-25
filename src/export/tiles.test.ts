import { describe, expect, it } from 'vitest';
import { buildChart, collapseColumns, type Chart, type DisplayCol } from '../engine/chart';
import { computePanel } from '../engine/panel';
import { fromTemplate } from '../engine/templates';
import { fixtureProject, sizeId } from '../engine/testFixtures';
import { CELL_MM, countRows, fitGrid, layoutTiles, MIN_CELL_MM, spanCount, spans, stitchLabels, tileRange, tileTotal, type Span } from './tiles';

// An A4 portrait page's room for the cells (content box less the gutters): about 38 × 48 cells at 4.5 mm.
const A4 = { width: 172, height: 218 };
const all = (n: number): DisplayCol[] => Array.from({ length: n }, (_, k) => ({ col: k }));

/** Every index covered, neighbours sharing exactly one. */
function expectCover(s: Span[], n: number) {
  expect(s[0].from).toBe(0);
  expect(s[s.length - 1].to).toBe(n - 1);
  for (let i = 1; i < s.length; i++) expect(s[i].from).toBe(s[i - 1].to);
}

function chartOf(id: Parameters<typeof fromTemplate>[0], opts: Parameters<typeof fromTemplate>[1] = {}) {
  const p = fixtureProject();
  const panel = fromTemplate(id, opts);
  p.panels.push(panel);
  return buildChart(p, panel, computePanel(p, panel, sizeId(p, 'M')));
}

describe('spans', () => {
  it('covers everything with one shared item between neighbours', () => {
    expect(spans(10, 4)).toEqual([{ from: 0, to: 3 }, { from: 3, to: 6 }, { from: 6, to: 9 }]);
    expect(spans(4, 4)).toEqual([{ from: 0, to: 3 }]);
    expect(spans(0, 4)).toEqual([]);
    for (const [n, per] of [[200, 48], [150, 38], [49, 48], [7, 2]]) {
      const s = spans(n, per);
      expectCover(s, n);
      expect(s.length).toBe(spanCount(n, per));
      expect(Math.max(...s.map((x) => x.to - x.from + 1))).toBeLessThanOrEqual(per);
    }
  });
});

describe('fitGrid', () => {
  it('a small chart is one tile at the full cell size', () => {
    const g = fitGrid(30, 20, A4);
    expect(g.cell).toBe(CELL_MM);
    expect(tileTotal(g)).toBe(1);
    expect(g.colSpans).toEqual([{ from: 0, to: 19 }]);
  });

  it('shrinks the cells only to save tiles, and no further than needed', () => {
    // 45 stitches: 38 fit at 4.5 mm, so 172 / 45 = 3.82 mm makes it one tile wide.
    const g = fitGrid(30, 45, A4);
    expect(tileTotal(g)).toBe(1);
    expect(g.cell).toBeCloseTo(172 / 45, 5);
    // 80 stitches: 3 bands at 4.5 mm, 2 at 3.5 mm; 2 bands of 41 need only 172 / 41 = 4.2 mm.
    const w = fitGrid(30, 80, A4);
    expect(w.colSpans.length).toBe(2);
    expect(w.cell).toBeCloseTo(172 / 41, 5);
    // 100 stitches: 3 bands either way, so the cells stay 4.5 mm.
    const n = fitGrid(30, 100, A4);
    expect(n.colSpans.length).toBe(spanCount(100, Math.floor(172 / MIN_CELL_MM)));
    expect(n.cell).toBe(CELL_MM);
  });

  it('a wide chart is split right to left: the first band holds stitch 1 (the last column)', () => {
    const g = fitGrid(20, 150, A4);
    expect(g.rowSpans.length).toBe(1);
    expect(g.colSpans.length).toBeGreaterThan(1);
    expect(g.colSpans[0].to).toBe(149);
    expect(g.colSpans[g.colSpans.length - 1].from).toBe(0);
    for (let i = 1; i < g.colSpans.length; i++) expect(g.colSpans[i].to).toBe(g.colSpans[i - 1].from);
  });

  it('a tall chart is split into row bands in knit order', () => {
    const g = fitGrid(200, 30, A4);
    expect(g.colSpans.length).toBe(1);
    expectCover(g.rowSpans, 200);
    expect(g.rowSpans.length).toBeGreaterThan(3);
    for (const s of g.rowSpans) expect((s.to - s.from + 1) * g.cell).toBeLessThanOrEqual(A4.height + 1e-6);
  });

  it('150 stitches × 200 rows: every tile fits the box', () => {
    const g = fitGrid(200, 150, A4);
    expect(g.cell).toBeGreaterThanOrEqual(MIN_CELL_MM);
    for (const s of g.colSpans) expect((s.to - s.from + 1) * g.cell).toBeLessThanOrEqual(A4.width + 1e-6);
    for (const s of g.rowSpans) expect((s.to - s.from + 1) * g.cell).toBeLessThanOrEqual(A4.height + 1e-6);
    expect(tileTotal(g)).toBe(g.rowSpans.length * g.colSpans.length);
  });
});

describe('layoutTiles', () => {
  const g = fitGrid(200, 150, A4);
  const tiles = layoutTiles(g, { firstPage: 5, topDown: false });

  it('reads bottom to top, right to left, one page each', () => {
    expect(tiles.map((t) => t.page)).toEqual(tiles.map((_, i) => 5 + i));
    expect(tiles[0]).toMatchObject({ band: 0, column: 0, rows: g.rowSpans[0], cols: g.colSpans[0], overlapRow: null, overlapCol: null });
    expect(tiles[1]).toMatchObject({ band: 0, column: 1 });
    expect(tiles[g.colSpans.length]).toMatchObject({ band: 1, column: 0 });
  });

  it('the repeated row and stitch are the ones shared with the tile before', () => {
    const t = tiles[g.colSpans.length + 1];
    expect(t.overlapRow).toBe(g.rowSpans[1].from);
    expect(t.overlapRow).toBe(g.rowSpans[0].to);
    expect(t.overlapCol).toBe(g.colSpans[1].to);
    expect(t.overlapCol).toBe(g.colSpans[0].from);
  });

  it('links each tile to its neighbours: later rows above a bottom-up chart', () => {
    const nx = g.colSpans.length;
    expect(tiles[0].next).toEqual({ up: tiles[nx].page, left: tiles[1].page });
    const mid = tiles[nx + 1];
    expect(mid.next).toEqual({ up: tiles[2 * nx + 1].page, down: tiles[1].page, left: tiles[nx + 2].page, right: tiles[nx].page });
    expect(tiles[tiles.length - 1].next.up).toBeUndefined();
    expect(tiles[tiles.length - 1].next.left).toBeUndefined();
  });

  it('top-down: later rows below', () => {
    const t = layoutTiles(fitGrid(200, 20, A4), { firstPage: 1, topDown: true });
    expect(t[0].next).toEqual({ down: 2 });
    expect(t[1].next).toEqual({ up: 1, down: 3 });
  });

  it('the key page after the first tile shifts the rest', () => {
    const t = layoutTiles(g, { firstPage: 5, topDown: false, pagesAfterFirst: 1 });
    expect(t[0].page).toBe(5);
    expect(t[1].page).toBe(7);
    expect(t[0].next.left).toBe(7);
  });
});

describe('numbering', () => {
  it('stitch numbers every 5, stitch 1, and uncrowded tile edges', () => {
    const chart = { cols: 40 };
    const labels = stitchLabels(chart, all(40), { from: 0, to: 39 }).map((l) => l.n);
    expect(labels).toEqual([40, 35, 30, 25, 20, 15, 10, 5, 1]);
    // A tile from stitch 33 to stitch 8 numbers both ends.
    const edge = stitchLabels(chart, all(40), { from: 7, to: 32 }).map((l) => l.n);
    expect(edge).toEqual([33, 30, 25, 20, 15, 10, 8]);
  });

  it('collapsed columns: the gap is skipped and the numbers stay the real stitches', () => {
    const row = (k: number) => ({ key: String(k), knitRow: k, label: String(k), shortRow: null, cells: new Array(40).fill('k') });
    const chart = { cols: 40, rows: Array.from({ length: 10 }, (_, i) => row(i + 1)) } as unknown as Chart;
    const d = collapseColumns(chart);
    expect(d.some((x) => 'gap' in x)).toBe(true);
    const labels = stitchLabels(chart, d, { from: 0, to: d.length - 1 });
    expect(labels.every((l) => 'col' in d[l.xi])).toBe(true);
    expect(labels[0].n).toBe(chart.cols);
    expect(labels[labels.length - 1].n).toBe(1);
    expect(tileRange(chart, d, { rows: { from: 0, to: 9 }, cols: { from: 0, to: d.length - 1 } })).toBe(`rows 1–10 · sts 1–${chart.cols}`);
  });

  it('short rows count as the row they follow; counts on change and on each tile’s first row', () => {
    const chart = chartOf('front');
    const i = chart.rows.findIndex((r) => r.shortRow);
    expect(i).toBeGreaterThan(0);
    const after = chart.rows[i].knitRow;
    expect(tileRange(chart, all(chart.cols), { rows: { from: i - 1, to: i + 1 }, cols: { from: 0, to: 9 } })).toBe(`row ${after} · sts ${chart.cols - 9}–${chart.cols}`);
    const plainTile = { rows: { from: 3, to: 6 } };
    expect(countRows(chart, plainTile).has(chart.rows[3].key)).toBe(true);
    expect(countRows(chart).has(chart.rows[3].key)).toBe(chart.rows[3].count !== chart.rows[2].count);
  });

  it('a top-down chart keeps the app’s numbering (row 1 is the first knitted)', () => {
    const chart = chartOf('back', { direction: 'top-down' });
    expect(chart.topDown).toBe(true);
    const g = fitGrid(chart.rows.length, chart.cols, A4);
    const t = layoutTiles(g, { firstPage: 1, topDown: true });
    expect(tileRange(chart, all(chart.cols), t[0]).startsWith('rows 1–')).toBe(true);
    if (t.length > g.colSpans.length) expect(t[0].next.down).toBe(t[g.colSpans.length].page);
  });
});
