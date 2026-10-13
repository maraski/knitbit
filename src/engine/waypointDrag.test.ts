import { describe, expect, it } from 'vitest';
import { computePanel, resolvePanelDims } from './panel';
import { fromTemplate } from './templates';
import { fixtureProject, sizeId } from './testFixtures';
import { dragHeight, dragWidth, linkPanels, matchPartner, scaleExpr } from './waypointDrag';

function setup() {
  const p = fixtureProject();
  const back = fromTemplate('back');
  const front = fromTemplate('front');
  p.panels = [back, front];
  return { p, back, front, M: sizeId(p, 'M') };
}
const wpOf = (panel: ReturnType<typeof fromTemplate>, name: string) => panel.waypoints.find((w) => w.name === name)!;
const val = (p: ReturnType<typeof setup>['p'], panelId: string, name: string, sid: string) =>
  resolvePanelDims(p, p.panels.find((x) => x.id === panelId)!, sid).values[name];

describe('dragging waypoints', () => {
  it('height: proportional between the neighbours in every size', () => {
    const { p, back, M } = setup();
    const end = wpOf(back, 'armhole_end');
    const u = val(p, back.id, 'underarm.height', M);
    const sh = val(p, back.id, 'shoulder.height', M);
    const target = u + (sh - u) * 0.3;
    const q = dragHeight(p, back.id, end.id, M, target, 'all');
    expect(val(q, back.id, 'armhole_end.height', M)).toBeCloseTo(target, 2);
    for (const s of q.sizes) {
      const lo = val(q, back.id, 'armhole_bo.height', s.id);
      const hi = val(q, back.id, 'shoulder.height', s.id);
      const h = val(q, back.id, 'armhole_end.height', s.id);
      const loM = val(q, back.id, 'armhole_bo.height', M);
      const t = (target - loM) / (val(q, back.id, 'shoulder.height', M) - loM);
      expect((h - lo) / (hi - lo), s.name).toBeCloseTo(t, 3);
      expect(computePanel(q, q.panels[0], s.id).ok).toBe(true);
    }
  });

  it('height: avoids cycles (armhole_bo refers to underarm) and keeps resolving', () => {
    const { p, back, M } = setup();
    const under = wpOf(back, 'underarm');
    const h = val(p, back.id, 'underarm.height', M) - 3;
    const q = dragHeight(p, back.id, under.id, M, h, 'all');
    expect(Object.keys(resolvePanelDims(q, q.panels[0], M).errors)).toEqual([]);
    expect(val(q, back.id, 'underarm.height', M)).toBeCloseTo(h, 3);
    expect(q.panels[0].waypoints.find((w) => w.id === under.id)!.height.expr).not.toContain('armhole_bo');
  });

  it('this size only: a fixed value, other sizes unchanged', () => {
    const { p, back, M } = setup();
    const waist = wpOf(back, 'waist');
    const L = sizeId(p, 'L');
    const before = val(p, back.id, 'waist.height', L);
    const q = dragHeight(p, back.id, waist.id, M, 20, 'size');
    expect(val(q, back.id, 'waist.height', M)).toBe(20);
    expect(val(q, back.id, 'waist.height', L)).toBe(before);
  });

  it('width: scaled by the same proportion in every size', () => {
    const { p, back, M } = setup();
    const waist = wpOf(back, 'waist');
    const w0 = Object.fromEntries(p.sizes.map((s) => [s.id, val(p, back.id, 'waist.width', s.id)]));
    const q = dragWidth(p, back.id, waist.id, M, 'width', w0[M] * 1.1, 'all');
    for (const s of q.sizes) expect(val(q, back.id, 'waist.width', s.id) / w0[s.id], s.name).toBeCloseTo(1.1, 3);
    // Repeated drags fold into one factor.
    const q2 = dragWidth(q, back.id, waist.id, M, 'width', w0[M], 'all');
    expect(q2.panels[0].waypoints.find((w) => w.id === waist.id)!.width.expr).toBe(waist.width.expr);
  });

  it('linked panels: the partner waypoint moves by the same amount; match lines them up', () => {
    let { p, back, front, M } = setup();
    p = linkPanels(p, back.id, front.id);
    expect(p.panels.map((x) => x.linkedTo)).toEqual([front.id, back.id]);
    const end = wpOf(back, 'armhole_end');
    const bh = val(p, back.id, 'armhole_end.height', M);
    const fh = val(p, front.id, 'armhole_end.height', M);
    const q = dragHeight(p, back.id, end.id, M, bh + 2, 'all');
    expect(val(q, front.id, 'armhole_end.height', M)).toBeCloseTo(fh + 2, 3);
    const fw = val(p, front.id, 'waist.width', M);
    const bw = val(p, back.id, 'waist.width', M);
    const q2 = dragWidth(q, back.id, wpOf(back, 'waist').id, M, 'width', bw * 0.9, 'all');
    expect(val(q2, front.id, 'waist.width', M)).toBeCloseTo(fw * 0.9, 3);
    const q3 = matchPartner(q2, back.id, end.id, M, { height: true, width: false });
    for (const s of q3.sizes) expect(val(q3, front.id, 'armhole_end.height', s.id), s.name).toBeCloseTo(val(q3, back.id, 'armhole_end.height', s.id), 2);
    // Unlinking clears both sides.
    expect(linkPanels(q3, back.id, null).panels.map((x) => x.linkedTo ?? null)).toEqual([null, null]);
  });

  it('scaleExpr folds factors and drops a factor of 1', () => {
    expect(scaleExpr('waist / 2', 1.1)).toBe('(waist / 2) * 1.1');
    expect(scaleExpr('(waist / 2) * 1.1', 2)).toBe('(waist / 2) * 2.2');
    expect(scaleExpr('(waist / 2) * 1.25', 0.8)).toBe('waist / 2');
  });
});
