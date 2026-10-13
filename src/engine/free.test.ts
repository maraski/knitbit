import { describe, expect, it } from 'vitest';
import { buildChart } from './chart';
import { clearFree, copyFreeToAllSizes, eraseStitch, findFree, freeCells, paintStitch, withOnlySize } from './free';
import { computePanel } from './panel';
import { loadProject, serializeProject } from './schema';
import { fromTemplate } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

function setup() {
  const p = fixtureProject();
  const panel = fromTemplate('back');
  p.panels.push(panel);
  const M = sizeId(p, 'M');
  const c = computePanel(p, panel, M);
  return { p, panel, M, c };
}
const panelOf = (p: ReturnType<typeof setup>['p'], id: string) => p.panels.find((x) => x.id === id)!;
const once = { mirror: false, every: 0, times: 1 };

describe('free stitches', () => {
  it('a painted increase widens the panel about the centre from its row on', () => {
    const { p, panel, M, c } = setup();
    const q = paintStitch(p, panel.id, M, 20, -10, 'm1l', { ...once, mirror: true }, c.totalRows);
    const c2 = computePanel(q, panelOf(q, panel.id), M);
    expect(c2.counts[19]).toBe(c.counts[19]);
    expect(c2.counts[20]).toBe(c.counts[20] + 2); // the stitch and its mirror
    expect(c2.counts[c.totalRows]).toBe(c.counts[c.totalRows] + 2);
    expect((c2.leftEdge[20] + c2.rightEdge[20]) / 2).toBeCloseTo((c.leftEdge[20] + c.rightEdge[20]) / 2);
    expect(c2.issues.some((i) => /Painted stitches change the count by \+2/.test(i.message))).toBe(true);
  });

  it('non-shaping stitches are only drawn', () => {
    const { p, panel, M, c } = setup();
    const q = paintStitch(p, panel.id, M, 20, 3, 'purl', once, c.totalRows);
    const c2 = computePanel(q, panelOf(q, panel.id), M);
    expect(c2.counts).toEqual(c.counts);
    const chart = buildChart(q, panelOf(q, panel.id), c2);
    const row = chart.rows.find((r) => r.knitRow === 20)!;
    const k = Math.round((c2.leftEdge[20] + c2.rightEdge[20]) / 2 + 3 - chart.x0);
    expect(row.cells[k]).toBe('purl');
    expect(row.free[k]).toBeDefined();
  });

  it('mirrors leaning stitches and erases both cells together', () => {
    const { p, panel, M, c } = setup();
    let q = paintStitch(p, panel.id, M, 30, -8, 'ssk', { ...once, mirror: true }, c.totalRows);
    const f = findFree(panelOf(q, panel.id), M, 30, 7)!; // mirror of x = -8 is 7
    expect(freeCells(f)).toEqual([{ x: -8, symbol: 'ssk' }, { x: 7, symbol: 'k2tog' }]);
    q = paintStitch(q, panel.id, M, 40, -8, 'm1l', { ...once, mirror: true }, c.totalRows); // back to the original width
    const c2 = computePanel(q, panelOf(q, panel.id), M);
    expect(c2.counts[30]).toBe(c.counts[30] - 2);
    expect(c2.counts[40]).toBe(c.counts[40]);
    const chart = buildChart(q, panelOf(q, panel.id), c2);
    for (const row of chart.rows) expect(row.cells.filter((v) => v !== '' && v !== 'bo' && v !== 'hold').length, `row ${row.knitRow}`).toBe(c2.counts[row.knitRow]);
    q = eraseStitch(q, panel.id, M, 30, 7);
    expect(panelOf(q, panel.id).freeStitches!.map((f) => f.row)).toEqual([40]);
  });

  it('repeats every N rows, skipping rows past the top, and replaces what was there', () => {
    const { p, panel, M, c } = setup();
    let q = paintStitch(p, panel.id, M, c.totalRows - 10, 0, 'yo', { mirror: false, every: 4, times: 5 }, c.totalRows);
    expect(freeRows(q, panel.id)).toEqual([c.totalRows - 10, c.totalRows - 6, c.totalRows - 2]);
    q = paintStitch(q, panel.id, M, c.totalRows - 6, 0, 'purl', once, c.totalRows);
    expect(panelOf(q, panel.id).freeStitches!.filter((f) => f.row === c.totalRows - 6).map((f) => f.symbol)).toEqual(['purl']);
    expect(clearFree(q, panel.id, M).panels.find((x) => x.id === panel.id)!.freeStitches).toEqual([]);
  });

  it('copy to all sizes keeps stitches between the same waypoints and at the same fraction of the width', () => {
    const { p, panel, M, c } = setup();
    const waist = c.waypoints.find((w) => w.key === 'waist')!;
    const under = c.waypoints.find((w) => w.key === 'underarm')!;
    const row = Math.round((waist.row + under.row) / 2);
    const half = (c.rightEdge[row] - c.leftEdge[row]) / 2;
    const x = Math.round(-half / 2) - 0.5 + (((c.leftEdge[row] % 1) + 1) % 1 === 0.5 ? 0 : 0.5);
    let q = paintStitch(p, panel.id, M, row, x, 'k2tog', { ...once, mirror: true }, c.totalRows);
    q = copyFreeToAllSizes(q, panel.id, M, (s) => computePanel(withOnlySize(q, panel.id, M), panelOf(q, panel.id), s));
    for (const s of q.sizes) {
      const list = panelOf(q, panel.id).freeStitches!.filter((f) => f.sizeId === s.id);
      expect(list.length, s.name).toBe(1);
      const cs = computePanel(q, panelOf(q, panel.id), s.id);
      const w = cs.waypoints.find((x) => x.key === 'waist')!.row;
      const u = cs.waypoints.find((x) => x.key === 'underarm')!.row;
      expect(Math.abs(list[0].row - (w + u) / 2), s.name).toBeLessThanOrEqual(1);
      const h = (cs.rightEdge[list[0].row] - cs.leftEdge[list[0].row]) / 2;
      expect(Math.abs((list[0].x + 0.5) / h + 0.5), s.name).toBeLessThan(0.08);
      expect(cs.issues.filter((i) => /outside the fabric/.test(i.message)), s.name).toEqual([]);
      // Sits on the stitch grid: the chart draws it.
      const chart = buildChart(q, panelOf(q, panel.id), cs);
      expect(Object.keys(chart.rows.find((r) => r.knitRow === list[0].row)!.free).length, s.name).toBe(2);
    }
  });

  it('warns when a net decrease leaves nothing for the final bind-off', () => {
    const { p, panel, M, c } = setup();
    const q = paintStitch(p, panel.id, M, 30, -8, 'ssk', { ...once, mirror: true }, c.totalRows);
    const c2 = computePanel(q, panelOf(q, panel.id), M);
    expect(c2.issues.some((i) => i.severity === 'warning' && /run out of stitches/.test(i.message))).toBe(true);
  });

  it('warns about stitches outside the fabric', () => {
    const { p, panel, M, c } = setup();
    const q = paintStitch(p, panel.id, M, 10, 500, 'purl', once, c.totalRows);
    const c2 = computePanel(q, panelOf(q, panel.id), M);
    expect(c2.issues.some((i) => i.severity === 'warning' && /outside the fabric/.test(i.message))).toBe(true);
  });

  it('round-trips through JSON', () => {
    const { p, panel, M, c } = setup();
    const q = paintStitch(p, panel.id, M, 12, 2, 'yo', { ...once, mirror: true }, c.totalRows);
    const r = loadProject(serializeProject(q));
    expect(r.ok && panelOf(r.project, panel.id).freeStitches).toEqual(panelOf(q, panel.id).freeStitches);
  });
});

function freeRows(p: ReturnType<typeof setup>['p'], panelId: string) {
  return panelOf(p, panelId).freeStitches!.map((f) => f.row).sort((a, b) => a - b);
}
