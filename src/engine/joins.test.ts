import { describe, expect, it } from 'vitest';
import { projectChecks } from './checks';
import { dropPanelFromJoins, joinReport, measureEdge, sameEdge } from './joins';
import { dim, newId, type EdgeRef, type Join, type Panel, type Project } from './model';
import { computePanel } from './panel';
import { loadProject, serializeProject } from './schema';
import { bodice, sleeve } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

function garment(): { p: Project; back: Panel; front: Panel; sl: Panel } {
  const p = fixtureProject();
  const back = bodice('back');
  const front = bodice('front');
  const sl = sleeve('set-in');
  p.panels = [back, front, sl];
  return { p, back, front, sl };
}

const wp = (panel: Panel, name: string) => panel.waypoints.find((w) => w.name === name)!.id;
const side = (panel: Panel, s: 'left' | 'right', from: string, to: string): EdgeRef => ({ panelId: panel.id, edge: { kind: 'side', side: s, from: wp(panel, from), to: wp(panel, to) } });
const join = (tag: Join['tag'], edges: EdgeRef[], partner: EdgeRef[] = [], name = 'J'): Join => ({ id: newId('join'), name, tag, edges, partner, ratio: null, note: '' });

describe('measuring edges', () => {
  it('measures a side edge in rows and along the edge', () => {
    const { p, back } = garment();
    const M = sizeId(p, 'M');
    const m = measureEdge(p, side(back, 'left', 'hem', 'underarm'), M, p.settings.pickUp);
    expect(m.ok).toBe(true);
    expect(m.rows).toBe(93); // hem_drop 11.5 + waist_to_underarm 19.5 = 31 cm at 3 rows/cm
    expect(m.lengthCm).toBeGreaterThan(93 / 3); // a little longer than straight up: the side is shaped
    expect(m.lengthCm).toBeLessThan(93 / 3 + 1.5);
    expect(m.pickup).toBe(Math.round(93 * 0.75));
    // Reversed waypoint order is the same edge.
    expect(measureEdge(p, side(back, 'left', 'underarm', 'hem'), M, p.settings.pickUp).rows).toBe(93);
  });

  it('counts bind-off steps along an armhole as stitches', () => {
    const { p, back } = garment();
    const M = sizeId(p, 'M');
    const m = measureEdge(p, side(back, 'left', 'underarm', 'shoulder'), M, p.settings.pickUp);
    const c = computePanel(p, back, M);
    const bo = c.segments.find((s) => s.fromWaypoint === wp(back, 'underarm'))!.left.events.reduce((a, e) => a + Math.abs(e.delta), 0);
    expect(m.stitches).toBe(bo);
    expect(m.pickup).toBe(Math.round(m.rows * 0.75) + bo);
  });

  it('measures the lower edge and the neckline', () => {
    const { p, back, front } = garment();
    const M = sizeId(p, 'M');
    expect(measureEdge(p, { panelId: back.id, edge: { kind: 'bottom' } }, M, p.settings.pickUp).stitches).toBe(140); // high hip 120.5 / 2 + ease 2.5 = 62.75 cm
    const neck = measureEdge(p, { panelId: front.id, edge: { kind: 'neck' } }, M, p.settings.pickUp);
    const c = computePanel(p, front, M);
    expect(neck.stitches).toBe(c.neck!.centreSts);
    expect(neck.pickup).toBe(c.neck!.centreSts + 2 * Math.round((c.totalRows - c.neck!.splitRow) * 0.75));
    expect(measureEdge(p, { panelId: front.id, edge: { kind: 'neck' } }, M, { stitches: 1, rows: 1 }).pickup).toBe(c.neck!.centreSts + 2 * (c.totalRows - c.neck!.splitRow));
  });

  it('reports edges that no longer exist', () => {
    const { p, back } = garment();
    const M = sizeId(p, 'M');
    const ref = side(back, 'left', 'hem', 'waist');
    back.waypoints = back.waypoints.filter((w) => w.name !== 'waist');
    back.waypoints.find((w) => w.name === 'underarm')!.height = dim('hem_drop + waist_to_underarm');
    expect(measureEdge(p, ref, M, p.settings.pickUp)).toMatchObject({ ok: false, error: expect.stringMatching(/waypoint/) });
    expect(measureEdge(p, { panelId: 'gone', edge: { kind: 'bottom' } }, M, p.settings.pickUp).ok).toBe(false);
  });
});

describe('seam check', () => {
  it('front and back side seams match in every size', () => {
    const { p, back, front } = garment();
    const j = join('seam', [side(front, 'left', 'hem', 'underarm')], [side(back, 'right', 'hem', 'underarm')], 'Side seam');
    for (const s of p.sizes) {
      const r = joinReport(p, j, s.id);
      expect(r.diffRows, s.name).toBe(0);
      expect(r.withinTolerance, s.name).toBe(true);
    }
  });

  it('flags a mismatch beyond tolerance and suggests where to add rows', () => {
    const { p, back, front } = garment();
    front.waypoints.find((w) => w.name === 'underarm')!.height = dim('waist.height + waist_to_underarm + 2');
    const j = join('seam', [side(front, 'left', 'hem', 'underarm')], [side(back, 'right', 'hem', 'underarm')], 'Side seam');
    p.joins = [j];
    const r = joinReport(p, j, sizeId(p, 'M'));
    expect(r.diffRows).toBe(6);
    expect(r.withinTolerance).toBe(false);
    expect(r.suggestion).toMatch(/The first side is 6 rows longer\. Add 6 rows to the shorter side in its straight stretch between/);
    const checks = projectChecks(p).filter((c) => c.issue.ref.kind === 'join');
    expect(checks.filter((c) => c.issue.severity === 'warning')).toHaveLength(p.sizes.length);
  });

  it('compares a sleeve cap with the armholes it is sewn into, by length', () => {
    const { p, back, front, sl } = garment();
    const cap = [side(sl, 'left', 'underarm', 'cap_top'), side(sl, 'right', 'underarm', 'cap_top')];
    const armholes = [side(front, 'left', 'underarm', 'shoulder'), side(back, 'right', 'underarm', 'shoulder')];
    const r = joinReport(p, join('seam', cap, armholes, 'Sleeve'), sizeId(p, 'M'));
    expect(r.a.ok && r.b!.ok).toBe(true);
    expect(r.a.lengthCm).toBeGreaterThan(0);
    expect(r.suggestion).toMatch(/cm longer \(\d+ % ease\)/);
  });

  it('notes a seam with only one side', () => {
    const { p, back } = garment();
    p.joins = [join('seam', [side(back, 'left', 'hem', 'underarm')], [], 'Lonely')];
    expect(projectChecks(p).some((c) => /only one side/.test(c.issue.message))).toBe(true);
  });
});

describe('pick-up helper', () => {
  it('totals a neckband pick-up across edges and rounds to rib multiples', () => {
    const { p, back, front } = garment();
    const M = sizeId(p, 'M');
    const j = join('pickup', [
      { panelId: back.id, edge: { kind: 'neck' } },
      { panelId: front.id, edge: { kind: 'neck' } },
    ]);
    const r = joinReport(p, j, M);
    expect(r.a.pickup).toBe(r.a.measures[0].pickup + r.a.measures[1].pickup);
    expect(r.multiples.map((m) => m.value % m.multiple)).toEqual([0, 0]);
    // A custom ratio changes the suggestion.
    const r2 = joinReport(p, { ...j, ratio: { stitches: 2, rows: 3 } }, M);
    expect(r2.a.pickup).toBeLessThan(r.a.pickup);
  });
});

describe('join bookkeeping', () => {
  it('identifies the same edge and drops deleted panels', () => {
    const { p, back, front } = garment();
    expect(sameEdge(side(back, 'left', 'hem', 'waist'), side(back, 'left', 'waist', 'hem'))).toBe(true);
    expect(sameEdge(side(back, 'left', 'hem', 'waist'), side(back, 'right', 'hem', 'waist'))).toBe(false);
    const joins = [join('seam', [side(front, 'left', 'hem', 'underarm')], [side(back, 'right', 'hem', 'underarm')])];
    expect(dropPanelFromJoins(joins, back.id)[0].partner).toEqual([]);
    expect(dropPanelFromJoins([join('free', [side(back, 'left', 'hem', 'waist')])], back.id)).toEqual([]);
    void p;
  });

  it('flags one edge tagged two ways', () => {
    const { p, back } = garment();
    const e = side(back, 'left', 'hem', 'underarm');
    p.joins = [join('seam', [e], [], 'A'), join('pickup', [e], [], 'B')];
    expect(projectChecks(p).some((c) => /same edge is in "A" \(seam\) and "B" \(pickup\)/.test(c.issue.message))).toBe(true);
  });

  it('saves and loads joins', () => {
    const { p, back, front } = garment();
    p.joins = [{ ...join('seam', [side(front, 'left', 'hem', 'underarm')], [side(back, 'right', 'hem', 'underarm')], 'Side'), ratio: { stitches: 2, rows: 3 }, note: 'mattress stitch' }];
    const r = loadProject(serializeProject(p));
    expect(r.ok && r.project.joins).toEqual(p.joins);
  });
});
