import { describe, expect, it } from 'vitest';
import { buildChart } from './chart';
import { defaultYoke, generateYoke, yokePanel, ZONES } from './contiguous';
import { measureEdge } from './joins';
import { localOutline, refHeight } from './layout';
import type { Project } from './model';
import { computePanel } from './panel';
import { fixtureProject, sizeId } from './testFixtures';
import { zoneStarts } from './yokePanel';

// The method's start (back neck only); the whole-neck start's chart is tested at the end.
const panel = { ...yokePanel(), yoke: defaultYoke('round', 'back') };
const p: Project = { ...fixtureProject(), panels: [panel] };
const M = sizeId(p, 'M');

describe('the yoke as a panel', () => {
  const c = computePanel(p, panel, M);
  const y = generateYoke(p, panel.yoke!, M);

  it('computes from the generator: top-down, one row per yoke row, each as wide as its stitches', () => {
    expect(c.ok).toBe(true);
    expect(c.topDown).toBe(true);
    expect(c.totalRows).toBe(y.counts.total);
    expect(c.counts).toEqual([y.castOn, ...y.rows.map((r) => r.total)]);
    expect(c.rightEdge[10] - c.leftEdge[10]).toBe(y.rows[9].total);
    expect(c.yoke!.held).toEqual(y.held);
  });

  it('names its landmark rows like waypoints (neck, shoulder, underarm) so alignment and labels work', () => {
    expect(c.waypoints.map((w) => [w.name, w.row])).toEqual([
      ['neck', 0],
      ['shoulder', y.counts.A],
      ['cap_rapid', y.counts.A + y.counts.C],
      ['cap_slow', y.counts.A + y.counts.C + y.counts.D],
      ['underarm', y.counts.total],
    ].filter((w, i, a) => i === 0 || w[1] > a[i - 1][1]) as [string, number][]);
    expect(refHeight(c, 'underarm')).toBe(0); // the split is the yoke's lower edge
    expect(localOutline(c).length).toBe(2 * (y.counts.total + 1));
  });

  it('measures its cast-on and split edges', () => {
    expect(measureEdge(p, { panelId: panel.id, edge: { kind: 'top' } }, M, p.settings.pickUp).stitches).toBe(y.castOn);
    expect(measureEdge(p, { panelId: panel.id, edge: { kind: 'bottom' } }, M, p.settings.pickUp).stitches).toBe(y.rows[y.rows.length - 1].total);
  });

  it('computes in every size (overlay and grid)', () => {
    for (const s of p.sizes) expect(computePanel(p, panel, s.id).ok).toBe(true);
  });

  it('reports the generator issues as panel issues', () => {
    expect(c.issues.map((i) => i.message)).toEqual(y.issues.map((i) => i.message));
  });
});

describe('the yoke chart', () => {
  const c = computePanel(p, panel, M);
  const chart = buildChart(p, panel, c);
  const y = c.yoke!;

  it('has one row per yoke row, as many stitches as the row, centred', () => {
    expect(chart.rows.length).toBe(y.rows.length);
    expect(chart.cols).toBe(Math.max(...c.counts));
    for (const [i, row] of chart.rows.entries()) {
      const filled = row.cells.filter((v) => v !== '').length;
      expect(filled).toBe(y.rows[i].total);
      expect(row.count).toBe(y.rows[i].total);
    }
  });

  it('puts every increase and cast-on symbol where the generator placed it', () => {
    for (const [i, yr] of y.rows.entries()) {
      const starts = zoneStarts(yr, chart.x0);
      for (const inc of yr.incs) expect(chart.rows[i].cells[starts[ZONES.indexOf(inc.zone)] + inc.at]).toBe(inc.symbol);
    }
    const R = y.counts.neckRow!;
    expect(chart.rows[R - 1].cells.filter((v) => v === 'co').length).toBe(y.rows[R - 1].castOns[0].count);
  });

  it('colours the five zones and draws a marker between each pair', () => {
    for (const [i, yr] of y.rows.entries()) {
      const key = chart.rows[i].key;
      const runs = chart.zoneRuns![key];
      expect(runs.map((r) => r.to - r.from)).toEqual(ZONES.map((z) => yr.zones[z]));
      expect(chart.markerCols![key]).toEqual(runs.slice(1).map((r) => r.from));
      expect(chart.zoneCounts![key]).toEqual(ZONES.map((z) => yr.zones[z]));
    }
  });

  it('lists the phases and the symbols it uses, marker included', () => {
    expect(chart.phases!.map((ph) => ph.label)).toEqual(y.phases.filter((ph) => ph.id !== 'B' && ph.id !== 'neck').map((ph) => `${ph.id} · ${ph.label}`));
    expect(chart.legend.map((l) => l.id)).toEqual(expect.arrayContaining(['k', 'marker', 'm1l', 'm1r', 'co']));
  });

  it('marks rounds after the neck is joined', () => {
    const R = y.counts.neckRow!;
    expect(chart.rows[R - 1].round).toBe(false);
    expect(chart.rows[R].round).toBe(true);
    expect(c.roundRows).toEqual({ from: R + 1, to: y.counts.total });
  });
});

describe('the yoke chart, whole-neck start', () => {
  const wp = { ...yokePanel(), yoke: defaultYoke('round', 'neck') };
  const pp: Project = { ...fixtureProject(), panels: [wp] };
  const Mw = sizeId(pp, 'M');
  const cw = computePanel(pp, wp, Mw);
  const yw = cw.yoke!;
  const ch = buildChart(pp, wp, cw);

  it("works only the short row's span, with a German turn where it turns", () => {
    for (const row of yw.rows.filter((r) => r.span)) {
      const cells = ch.rows[row.row - 1].cells;
      const start = zoneStarts(row, ch.x0)[0];
      const [from, to] = row.span!;
      const worked = cells.slice(start, start + row.total).map((v) => v !== '');
      expect(worked.filter(Boolean).length).toBe(to - from);
      expect(worked.slice(from, to).every(Boolean)).toBe(true);
      if (row.turn) expect(cells[start + row.turn.at]).toBe('turn-german');
    }
    const full = yw.rows[yw.shortRows!.endRow];
    expect(ch.rows[full.row - 1].cells.filter((v) => v !== '').length).toBe(full.total);
  });
});

