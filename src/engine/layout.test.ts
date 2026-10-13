import { describe, expect, it } from 'vitest';
import { alignShift, arrangeT, bbox, isUnarranged, localOutline, place, refHeight, rotate } from './layout';
import type { Id } from './model';
import { computePanel, type ComputedPanel } from './panel';
import { bodice, neckband, sleeve } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

function setup() {
  const p = fixtureProject();
  const back = bodice('back');
  const front = bodice('front');
  const s1 = sleeve('set-in');
  const s2 = sleeve('set-in');
  const band = neckband();
  p.panels = [back, front, s1, s2, band];
  const M = sizeId(p, 'M');
  const computed = new Map<Id, ComputedPanel>(p.panels.map((x) => [x.id, computePanel(p, x, M)]));
  return { p, back, front, s1, s2, band, computed, M };
}

const placedBox = (c: ComputedPanel, at: { x: number; y: number; rotation: 0 | 90 | 180 | 270 }) => bbox(localOutline(c).map((q) => place(q, at)));

describe('geometry', () => {
  it('rotates counter-clockwise', () => {
    expect(rotate({ x: 1, y: 0 }, 90)).toEqual({ x: -0, y: 1 });
    expect(rotate({ x: 1, y: 2 }, 180)).toEqual({ x: -1, y: -2 });
    expect(rotate({ x: 0, y: 1 }, 270)).toEqual({ x: 1, y: -0 });
  });

  it('draws top-down panels upright in the local frame', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    const up = bbox(localOutline(computePanel(p, bodice('back'), M)));
    const down = bbox(localOutline(computePanel(p, bodice('back', { direction: 'top-down' }), M)));
    expect(down.minY).toBeCloseTo(up.minY, 6);
    expect(down.maxY).toBeCloseTo(up.maxY, 6);
  });
});

describe('aligning sizes', () => {
  it('finds reference heights and the shift that lines them up', () => {
    const p = fixtureProject();
    const b = bodice('back');
    const S = computePanel(p, b, sizeId(p, '3XS'));
    const L = computePanel(p, b, sizeId(p, '4X'));
    expect(refHeight(S, 'hem')).toBe(0);
    expect(refHeight(S, 'underarm')).toBeCloseTo(S.waypoints.find((w) => w.key === 'underarm')!.row / S.rowsPerCm, 6);
    expect(refHeight(L, 'top')).toBeCloseTo(L.totalRows / L.rowsPerCm, 6);
    const shift = alignShift(S, L, 'underarm');
    expect(refHeight(S, 'underarm') + shift).toBeCloseTo(refHeight(L, 'underarm'), 6);
    expect(alignShift(S, L, 'hem')).toBe(0);
  });
});

describe('T-shape auto-arrange', () => {
  it('puts back and front side by side, sleeves either side at underarm height, bands below, no overlaps', () => {
    const { p, back, front, s1, s2, band, computed } = setup();
    const at = arrangeT(p, computed);
    const box = (id: Id) => placedBox(computed.get(id)!, at[id]);
    const bb = box(back.id);
    const fb = box(front.id);
    expect(bb.minY).toBeCloseTo(0, 6);
    expect(fb.minY).toBeCloseTo(0, 6);
    expect(fb.minX).toBeGreaterThan(bb.maxX);
    const l = box(s1.id);
    const r = box(s2.id);
    expect(l.maxX).toBeLessThan(bb.minX);
    expect(r.minX).toBeGreaterThan(fb.maxX);
    const underarm = refHeight(computed.get(back.id)!, 'underarm');
    expect((l.minY + l.maxY) / 2).toBeCloseTo(underarm, 0);
    expect(box(band.id).maxY).toBeLessThan(0);
    const all = p.panels.map((x) => box(x.id));
    for (let i = 0; i < all.length; i++)
      for (let k = i + 1; k < all.length; k++) {
        const a = all[i];
        const c = all[k];
        const overlap = a.minX < c.maxX && c.minX < a.maxX && a.minY < c.maxY && c.minY < a.maxY;
        expect(overlap, `${p.panels[i].name} / ${p.panels[k].name}`).toBe(false);
      }
  });

  it('can leave room for every size', () => {
    const { p, back, front, computed } = setup();
    const all = new Map<Id, ComputedPanel[]>(p.panels.map((x) => [x.id, p.sizes.map((s) => computePanel(p, x, s.id))]));
    const at = arrangeT(p, computed, all);
    const widest = (id: Id) => all.get(id)!.map((c) => placedBox(c, at[id]));
    const backRight = Math.max(...widest(back.id).map((b) => b.maxX));
    const frontLeft = Math.min(...widest(front.id).map((b) => b.minX));
    expect(frontLeft).toBeGreaterThan(backRight);
  });

  it('knows when nothing has been placed', () => {
    const { p } = setup();
    expect(isUnarranged(p)).toBe(true);
    p.panels[0].layout = { x: 3, y: 0, rotation: 0 };
    expect(isUnarranged(p)).toBe(false);
  });
});
