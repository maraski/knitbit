import { describe, expect, it } from 'vitest';
import { pinchStep, pinchView, zoomView } from './touch';
import { commit, createHistory, revert } from '../engine/history';

describe('pinch maths', () => {
  it('measures zoom and midpoint movement between finger pairs', () => {
    const s = pinchStep([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 10, y: 20 }, { x: 210, y: 20 }]);
    expect(s.k).toBeCloseTo(2);
    expect(s.from).toEqual({ x: 50, y: 0 });
    expect(s.to).toEqual({ x: 110, y: 20 });
  });

  it('treats fingers on top of each other as no zoom', () => {
    expect(pinchStep([{ x: 5, y: 5 }, { x: 5, y: 5 }], [{ x: 0, y: 0 }, { x: 10, y: 0 }]).k).toBe(1);
  });

  it('zooms about a point: the world point under it stays put', () => {
    const v = { scale: 2, ox: 10, oy: 30 };
    const at = { x: 110, y: 70 };
    const world = { x: (at.x - v.ox) / v.scale, y: (at.y - v.oy) / v.scale };
    const z = zoomView(v, 3, at, 0.1, 100);
    expect(z.scale).toBe(6);
    expect(z.ox + world.x * z.scale).toBeCloseTo(at.x);
    expect(z.oy + world.y * z.scale).toBeCloseTo(at.y);
  });

  it('matches the wheel zoom formula it replaces', () => {
    const v = { scale: 4, ox: 200, oy: 150 };
    const mx = 321, my = 87, k = Math.exp(-120 * 0.0015);
    const scale = v.scale * k;
    const f = scale / v.scale;
    expect(zoomView(v, k, { x: mx, y: my }, 0.3, 200)).toEqual({ scale, ox: mx - (mx - v.ox) * f, oy: my - (my - v.oy) * f });
  });

  it('clamps the scale', () => {
    expect(zoomView({ scale: 1, ox: 0, oy: 0 }, 1000, { x: 0, y: 0 }, 0.5, 50).scale).toBe(50);
    expect(zoomView({ scale: 1, ox: 0, oy: 0 }, 0.001, { x: 0, y: 0 }, 0.5, 50).scale).toBe(0.5);
  });

  it('pans with the fingers: the point under the old midpoint ends under the new one', () => {
    const v = { scale: 3, ox: 0, oy: 0 };
    const z = pinchView(v, { k: 1.5, from: { x: 30, y: 60 }, to: { x: 50, y: 40 } }, 0.1, 100);
    // world point (10, 20) was under (30, 60)
    expect(z.ox + 10 * z.scale).toBeCloseTo(50);
    expect(z.oy + 20 * z.scale).toBeCloseTo(40);
  });
});

describe('revert (drag cut short by a pinch)', () => {
  it('drops the step made with the key, without a redo', () => {
    let h = createHistory(0);
    h = commit(h, 1);
    h = commit(h, 2, 'drag:a');
    h = commit(h, 3, 'drag:a');
    const r = revert(h, 'drag:a');
    expect(r.present).toBe(1);
    expect(r.past).toEqual([0]);
    expect(r.future).toEqual([]);
  });

  it('leaves the history alone when the key was not the last edit', () => {
    let h = createHistory(0);
    h = commit(h, 1, 'drag:a');
    h = commit(h, 2, 'other');
    expect(revert(h, 'drag:a')).toBe(h);
    expect(revert(createHistory(0), 'drag:a').present).toBe(0);
  });
});
