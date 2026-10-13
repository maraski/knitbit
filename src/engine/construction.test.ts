import { describe, expect, it } from 'vitest';
import { joinReport, measureEdge } from './joins';
import { ensureEstimates } from './seed';
import { computePanel } from './panel';
import { topDownTop } from './templates';
import { fixtureProject } from './testFixtures';

function build(opts: Parameters<typeof topDownTop>[0] = {}) {
  const { project } = ensureEstimates(fixtureProject(), ['underarm_co']);
  const set = topDownTop({ joinInRound: true, ...opts });
  project.panels = set.panels;
  project.joins = set.joins;
  const [back, front] = set.panels;
  return { p: project, back, front, joins: set.joins };
}

describe('top-down top, shoulders first', () => {
  it('back and front line up in every size: same rows to the underarm, half the underarm cast-on each', () => {
    const { p, back, front } = build();
    for (const s of p.sizes) {
      const b = computePanel(p, back, s.id);
      const f = computePanel(p, front, s.id);
      for (const c of [b, f]) expect(c.issues.filter((i) => i.severity !== 'info').map((i) => i.message), s.name).toEqual([]);
      const row = (c: typeof b, name: string) => c.waypoints.find((w) => w.name === name)!.row;
      expect(row(f, 'underarm'), s.name).toBe(row(b, 'underarm'));
      const step = (c: typeof b) => {
        const seg = c.segments.find((x) => x.fromWaypoint === c.waypoints.find((w) => w.name === 'underarm')!.id)!;
        return [seg.left, seg.right].map((e) => e.events.reduce((a, ev) => a + ev.delta, 0));
      };
      expect(step(f), s.name).toEqual(step(b));
    }
  });

  it('the front is picked up: its shoulders match the back shoulders (straight back neck)', () => {
    const { p, back, front } = build();
    expect(front.startFrom).toBe('pickup');
    expect(back.neckline).toBeNull();
    for (const s of p.sizes) {
      const ratio = { stitches: 3, rows: 4 };
      const fTop = measureEdge(p, { panelId: front.id, edge: { kind: 'top' } }, s.id, ratio);
      const b = computePanel(p, back, s.id);
      const f = computePanel(p, front, s.id);
      const neckOpening = Math.round(f.neckRight[0]! - f.neckLeft[0]!);
      expect(fTop.stitches, s.name).toBe(f.counts[0]);
      expect(Math.abs(b.counts[0] - neckOpening - f.counts[0]), s.name).toBeLessThanOrEqual(1);
    }
  });

  it('tags the shoulder pick-up and the underarm cast-on as ordinary joins', () => {
    const { p, joins, front } = build();
    expect(joins.map((j) => j.tag)).toEqual(['pickup', 'caston']);
    for (const s of p.sizes) for (const j of joins) expect(joinReport(p, j, s.id).a.ok, s.name).toBe(true);
    expect(joinReport(p, joins[0], p.baseSizeId).a.pickup).toBe(computePanel(p, front, p.baseSizeId).counts[0]);
  });

  it('a deep V keeps the body flat until the neck closes, then in the round', () => {
    const { p, front } = build({ neckline: 'v' });
    front.neckline!.depth = { expr: 'armhole_depth + 6', overrides: {} };
    const c = computePanel(p, front, p.baseSizeId);
    const under = c.waypoints.find((w) => w.name === 'underarm')!.row;
    expect(c.neck!.splitRow).toBeGreaterThan(under);
    expect(c.roundRows!.from).toBe(c.neck!.splitRow + 1);
    expect(c.issues.some((i) => /body is worked flat until then/.test(i.message))).toBe(true);
  });

  it('straight shoulders and a shaped back neck are options', () => {
    const { p, back, front } = build({ shoulderSlope: 'none', backNeck: 'shaped' });
    expect(back.waypoints.some((w) => w.name === 'neck_side')).toBe(false);
    expect(back.neckline).not.toBeNull();
    for (const s of p.sizes) for (const pn of [back, front]) expect(computePanel(p, pn, s.id).held.every((h) => h === 0)).toBe(true);
  });
});
