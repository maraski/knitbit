import { describe, expect, it } from 'vitest';
import { groupChecks, projectChecks } from './checks';
import { commit, createHistory } from './history';
import { addMarker, materialise, moveMarker, removeMarker, resetMarkers, setMarkerSymbol, type MarkerRef } from './manual';
import { computePanel } from './panel';
import { markerDelta } from './symbols';
import { backBodice } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

function setup(direction: 'bottom-up' | 'top-down' = 'bottom-up') {
  const p = fixtureProject();
  const b = backBodice();
  b.direction = direction;
  p.panels = [b];
  return p;
}

const strip = (evs: { row: number; delta: number; kind: string }[]) => evs.map(({ row, delta, kind }) => ({ row, delta, kind }));

describe('materialise', () => {
  it('reproduces the auto-suggestion exactly, for every segment, size and direction', () => {
    for (const dir of ['bottom-up', 'top-down'] as const) {
      const p = setup(dir);
      const panel = p.panels[0];
      for (const s of p.sizes) {
        const before = computePanel(p, panel, s.id);
        for (const seg of before.segments) {
          const ref: MarkerRef = { panelId: panel.id, fromWaypoint: seg.fromWaypoint, sizeId: s.id, edge: 'left' };
          const q = materialise(p, ref);
          const after = computePanel(q, q.panels[0], s.id);
          const a = after.segments.find((x) => x.fromWaypoint === seg.fromWaypoint)!;
          const label = `${dir} ${s.name} ${seg.index}`;
          expect(a.left.method === 'manual' || seg.left.events.length === 0, label).toBe(true);
          expect(strip(a.left.events), label).toEqual(strip(seg.left.events));
          expect(strip(a.right.events), label).toEqual(strip(seg.right.events));
          expect(after.counts, label).toEqual(before.counts);
        }
      }
    }
  });
});

describe('editing markers', () => {
  const M = (p: ReturnType<typeof setup>) => sizeId(p, 'M');
  const hemRef = (p: ReturnType<typeof setup>): MarkerRef => ({ panelId: p.panels[0].id, fromWaypoint: p.panels[0].waypoints[0].id, sizeId: M(p), edge: 'left' });

  it('moves a marker and updates counts live, mirrored on both edges', () => {
    const p = setup();
    const ref = hemRef(p);
    const before = computePanel(p, p.panels[0], ref.sizeId).segments[0];
    const q = moveMarker(p, ref, 0, 1);
    const seg = computePanel(q, q.panels[0], ref.sizeId).segments[0];
    expect(seg.left.events[0].row).toBe(1);
    expect(seg.right.events[0].row).toBe(1);
    expect(seg.right.events[0].symbol).toBe('ssk'); // mirrored lean
    expect(seg.left.events.slice(1).map((e) => e.row)).toEqual(before.left.events.slice(1).map((e) => e.row));
  });

  it('removing a marker leaves the target unmet and warns', () => {
    const p = setup();
    const ref = hemRef(p);
    const q = removeMarker(p, ref, 0);
    const c = computePanel(q, q.panels[0], ref.sizeId);
    expect(c.segments[0].left.events.length).toBe(computePanel(p, p.panels[0], ref.sizeId).segments[0].left.events.length - 1);
    const n = computePanel(p, p.panels[0], ref.sizeId).segments[0].left.target;
    expect(c.issues.some((i) => i.message === `Left edge: manual markers change this edge by ${n + 1} sts; ${n} are needed.`)).toBe(true);
    expect(c.issues.some((i) => /At waist the shaping reaches/.test(i.message))).toBe(true);
  });

  it('adds markers and changes their type', () => {
    const p = setup();
    const ref = hemRef(p);
    const auto = computePanel(p, p.panels[0], ref.sizeId).segments[0].left.target;
    let q = addMarker(p, ref, 20, 'k2tog');
    q = setMarkerSymbol(q, ref, 0, 'sk2p');
    const seg = computePanel(q, q.panels[0], ref.sizeId).segments[0];
    const total = seg.left.events.reduce((a, e) => a + e.delta, 0);
    expect(total).toBe(auto - 2); // one added, and the sk2p takes 2 instead of 1
    expect(seg.left.events.some((e) => e.row === 20)).toBe(true);
  });

  it('bind-off markers carry a count', () => {
    expect(markerDelta('bo', 4)).toBe(-4);
    expect(markerDelta('co', 3)).toBe(3);
    expect(markerDelta('m1l')).toBe(1);
    const p = setup();
    const under = p.panels[0].waypoints.find((w) => w.name === 'underarm')!;
    const ref: MarkerRef = { panelId: p.panels[0].id, fromWaypoint: under.id, sizeId: M(p), edge: 'left' };
    const q = setMarkerSymbol(p, ref, 0, 'bo', 9); // one big bind-off instead of 5 + 4
    const r = removeMarker(q, ref, 1);
    const c = computePanel(r, r.panels[0], ref.sizeId);
    const seg = c.segments.find((s) => s.fromWaypoint === under.id)!;
    expect(seg.left.events.map((e) => e.delta)).toEqual([-9]);
    expect(seg.right.events.map((e) => e.delta)).toEqual([-9]);
    expect(seg.right.events[0].row % 2).toBe(1); // RS row
    expect(c.waypoints.find((w) => w.name === 'armhole_bo')!.actualStitches).toBe(c.waypoints.find((w) => w.name === 'armhole_bo')!.stitches);
  });

  it('clamps rows to the segment and resets to auto', () => {
    const p = setup();
    const ref = hemRef(p);
    const q = moveMarker(p, ref, 0, 9999);
    const seg = computePanel(q, q.panels[0], ref.sizeId).segments[0];
    expect(Math.max(...seg.left.events.map((e) => e.row))).toBe(seg.rowTo);
    const r = resetMarkers(q, ref);
    expect(computePanel(r, r.panels[0], ref.sizeId).segments[0].left.method).toBe('auto');
  });

  it('only affects the edited size', () => {
    const p = setup();
    const ref = hemRef(p);
    const q = removeMarker(p, ref, 0);
    const L = sizeId(p, 'L');
    expect(computePanel(q, q.panels[0], L).segments[0].left.method).toBe('auto');
  });

  it('notes manual decreases placed on WS rows', () => {
    const p = setup();
    const ref = hemRef(p);
    const q = moveMarker(p, ref, 0, 2);
    const c = computePanel(q, q.panels[0], ref.sizeId);
    expect(c.issues.some((i) => i.severity === 'info' && /on WS rows \(2\)/.test(i.message))).toBe(true);
  });
});

describe('checks and history', () => {
  it('collects issues for every panel and size and groups repeats', () => {
    const p = setup();
    p.panels[0].waypoints[1].height.expr = '0.5'; // waist far too close to the hem: shaping cannot fit
    const checks = projectChecks(p);
    expect(checks.length).toBeGreaterThan(p.sizes.length);
    const groups = groupChecks(checks);
    expect(groups[0].issue.severity).toBe('error');
    expect(groups[0].sizes.length).toBeGreaterThan(1);
  });

  it('merges a whole drag into one undo step', () => {
    let h = createHistory(0);
    h = commit(h, 1, 'drag:1', 0);
    h = commit(h, 2, 'drag:1', 5000);
    h = commit(h, 3, 'drag:1', 20000);
    expect(h.past).toEqual([0]);
  });
});
