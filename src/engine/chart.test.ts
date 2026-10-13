import { describe, expect, it } from 'vitest';
import { buildChart, collapseColumns, HELD, PLAIN } from './chart';
import { computePanel } from './panel';
import { fromTemplate } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

function chartOf(id: Parameters<typeof fromTemplate>[0], opts: Parameters<typeof fromTemplate>[1] = {}, size = 'M') {
  const p = fixtureProject();
  const panel = fromTemplate(id, opts);
  p.panels.push(panel);
  const c = computePanel(p, panel, sizeId(p, size));
  return { p, panel, c, chart: buildChart(p, panel, c) };
}

const live = (cells: string[]) => cells.filter((v) => v !== '' && v !== HELD && v !== 'bo' && v !== 'hold').length;

describe('stitch chart', () => {
  it('has one row per knit row plus the inserted short rows', () => {
    const { c, chart } = chartOf('front');
    const sr = c.bust!.shortRows!;
    expect(chart.rows.length).toBe(c.totalRows + sr.extraRows);
    expect(chart.rows.filter((r) => !r.shortRow).map((r) => r.knitRow)).toEqual(Array.from({ length: c.totalRows }, (_, i) => i + 1));
  });

  it('inserts the bust short rows right after bust.shortRows.afterRow, starting with a RS row', () => {
    const { c, chart } = chartOf('front');
    const sr = c.bust!.shortRows!;
    const i = chart.rows.findIndex((r) => r.knitRow === sr.afterRow && !r.shortRow);
    const inserted = chart.rows.slice(i + 1, i + 1 + sr.extraRows);
    expect(inserted.every((r) => r.shortRow)).toBe(true);
    expect(inserted.map((r) => r.label)).toEqual(Array.from({ length: sr.extraRows }, (_, k) => `SR${k + 1}`));
    expect(inserted.map((r) => r.rs)).toEqual(inserted.map((_, k) => k % 2 === 0));
    expect(chart.rows[i + 1 + sr.extraRows].shortRow).toBeNull();
    // Each short row works the stitches the bust helper says, ending in a turn.
    sr.pairs.forEach((p, k) => {
      const rsRow = inserted[2 * k];
      const wsRow = inserted[2 * k + 1];
      expect(live(rsRow.cells)).toBe(p.rsWorked);
      expect(live(wsRow.cells)).toBe(p.wsWorked);
      expect(rsRow.cells.filter((v) => v.startsWith('turn')).length).toBe(1);
    });
  });

  it('live stitches in each knit row match the computed stitch counts', () => {
    for (const [id, opts] of [['back', {}], ['front', { neckline: 'v' }], ['sleeve', { sleeve: 'set-in' }], ['back', { direction: 'top-down' }]] as const) {
      const { c, chart } = chartOf(id, opts);
      for (const row of chart.rows) {
        if (row.shortRow) continue;
        const onNeedle = row.cells.filter((v) => v !== '' && v !== 'bo' && v !== 'hold').length;
        expect(onNeedle, `${id} ${JSON.stringify(opts)} row ${row.knitRow}`).toBe(c.counts[row.knitRow]);
      }
    }
  });

  it('vertical darts: symbols at the dart lines, counts still match', () => {
    const p = fixtureProject();
    const panel = fromTemplate('front');
    panel.bust!.method = 'vertical-dart';
    p.panels.push(panel);
    const c = computePanel(p, panel, sizeId(p, 'M'));
    const chart = buildChart(p, panel, c);
    const d = c.bust!.darts!;
    expect(d.incRows.length).toBeGreaterThan(0);
    for (const r of d.incRows) expect(chart.rows.find((x) => x.knitRow === r)!.cells.filter((v) => v === 'm1r').length).toBeGreaterThanOrEqual(2);
    for (const row of chart.rows) expect(row.cells.filter((v) => v !== '' && v !== 'bo' && v !== 'hold').length, `row ${row.knitRow}`).toBe(c.counts[row.knitRow]);
  });

  it('top-down front: short rows follow afterRow in knit order', () => {
    const { c, chart } = chartOf('front', { direction: 'top-down' });
    const sr = c.bust!.shortRows!;
    const i = chart.rows.findIndex((r) => r.knitRow === sr.afterRow && !r.shortRow);
    expect(chart.rows[i + 1].label).toBe('SR1');
    expect(chart.topDown).toBe(true);
  });

  it('reads RS rows right to left and WS rows left to right; rounds always right to left', () => {
    const flat = chartOf('back').chart;
    const r1 = flat.rows[0];
    const r2 = flat.rows[1];
    expect([r1.rs, r1.rtl, r2.rs, r2.rtl]).toEqual([true, true, false, false]);

    const { c, chart } = chartOf('back', { joinInRound: true });
    const rr = c.roundRows!;
    for (const row of chart.rows) {
      if (row.knitRow >= rr.from && row.knitRow <= rr.to) expect(row.round && row.rtl && row.rs).toBe(true);
    }
    const firstFlat = chart.rows.find((r) => !r.round)!;
    expect(firstFlat.knitRow).toBe(c.firstFlatRow);
    expect(firstFlat.rs).toBe(true);
  });

  it('places shaping symbols the shaping inset away from the edge', () => {
    const { c, chart, panel } = chartOf('back');
    const seg = c.segments.find((s) => s.left.events.some((e) => e.kind === 'dec'))!;
    const e = seg.left.events.find((x) => x.kind === 'dec')!;
    const row = chart.rows.find((r) => r.knitRow === e.row && !r.shortRow)!;
    const first = row.cells.findIndex((v) => v !== '');
    expect(row.cells[first + panel.shapingInset]).toBe(e.symbol);
    expect(row.refs[first + panel.shapingInset]).toMatchObject({ fromWaypoint: seg.fromWaypoint, edge: 'left' });
  });

  it('marks bound-off stitches and the neck centre', () => {
    const { c, chart } = chartOf('front', { neckline: 'round' });
    const split = chart.rows.find((r) => r.knitRow === c.neck!.splitRow && !r.shortRow)!;
    expect(split.cells.filter((v) => v === 'bo').length).toBeGreaterThanOrEqual(c.neck!.centreSts);
  });

  it('legend lists exactly the symbols used', () => {
    const { chart } = chartOf('front');
    const used = new Set(chart.rows.flatMap((r) => r.cells).filter((v) => v !== ''));
    expect(new Set(chart.legend.map((l) => l.id))).toEqual(used);
    expect(chart.legend[0].id).toBe(PLAIN);
    expect(chart.legend.map((l) => l.id)).toContain('turn-german');
    expect(chart.legend.map((l) => l.id)).toContain('bo');
  });

  it('collapses the plain middle without dropping columns', () => {
    const { chart } = chartOf('rectangle');
    const cols = collapseColumns(chart);
    const shown = cols.reduce((n, d) => n + ('gap' in d ? d.gap : 1), 0);
    expect(shown).toBe(chart.cols);
    expect(cols.some((d) => 'gap' in d)).toBe(true);
    expect(cols.length).toBeLessThan(chart.cols);
  });
});

describe('custom symbols', () => {
  it('round-trip through JSON, set the marker delta and appear in the legend', async () => {
    const { loadProject, serializeProject } = await import('./schema');
    const { setMarkerSymbol } = await import('./manual');
    const p = fixtureProject();
    const panel = fromTemplate('back');
    p.panels.push(panel);
    p.symbols = [{ id: 'custom_tw', label: 'Twisted decrease', abbr: 'tw', color: '#f2d17a', change: -1 }];
    const r = loadProject(serializeProject(p));
    expect(r.ok && r.project.symbols).toEqual(p.symbols);

    const c0 = computePanel(p, panel, sizeId(p, 'M'));
    const seg = c0.segments.find((s) => s.left.events.some((e) => e.kind === 'dec'))!;
    const q = setMarkerSymbol(p, { panelId: panel.id, fromWaypoint: seg.fromWaypoint, sizeId: sizeId(p, 'M'), edge: 'left' }, 0, 'custom_tw');
    const qp = q.panels.find((x) => x.id === panel.id)!;
    const ev = qp.segments.find((s) => s.fromWaypoint === seg.fromWaypoint)!.manual[sizeId(p, 'M')]!.left![0];
    expect(ev).toMatchObject({ symbol: 'custom_tw', delta: -1 });
    const chart = buildChart(q, qp, computePanel(q, qp, sizeId(p, 'M')));
    expect(chart.legend.find((l) => l.id === 'custom_tw')).toMatchObject({ label: 'Twisted decrease', abbr: 'tw', custom: true });
  });
});
