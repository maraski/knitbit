import { describe, expect, it } from 'vitest';
import { defaultYoke, generateYoke, ZONES } from './contiguous';
import { setOpening } from './garment';
import { boundaryAngle, boundaryPoints, hitStitch, polar, stitchAngle, topGeometry, zoneOffsets } from './yokeTop';
import { fixtureProject, sizeId } from './testFixtures';

const p = fixtureProject();
const M = sizeId(p, 'M');
const y = generateYoke(p, defaultYoke(), M);
const g = topGeometry(y);

describe('yoke seen from above', () => {
  it('has a ring per row, spaced by the row height from the neck', () => {
    expect(g.rings.length).toBe(y.rows.length + 1);
    expect(g.rings[1].r0).toBeCloseTo(g.neckR);
    expect(g.rings[10].r1 - g.rings[10].r0).toBeCloseTo(1 / y.rowsPerCm);
    expect(g.outerR).toBeCloseTo(g.neckR + y.rows.length / y.rowsPerCm);
  });

  it('is open at centre front until a pullover neck is joined', () => {
    const R = y.counts.neckRow!;
    expect(g.rings[0].gap).toBe(y.castOnZones.back);
    const incs = y.rows.filter((r) => r.neck && r.row < R).length;
    expect(g.rings[R - 1].gap).toBe(y.castOnZones.back - 2 * incs);
    expect(g.rings[R].gap).toBe(0);
    for (const ring of g.rings) expect(ring.slots).toBe(ring.total + ring.gap);
  });

  it('keeps the band space open on a cardigan', () => {
    const c = setOpening(p, 'cardigan');
    const gc = topGeometry(generateYoke(c, defaultYoke(), M));
    expect(gc.rings[gc.rings.length - 1].gap).toBeGreaterThanOrEqual(0);
    expect(gc.rings.every((r) => r.gap >= 0)).toBe(true);
  });

  it('puts the back at the top, centre front at the bottom, the left sleeve on the right', () => {
    const ring = g.rings[g.rings.length - 1];
    const off = zoneOffsets(ring.zones);
    const backMid = (boundaryAngle(ring, off[2]) + boundaryAngle(ring, off[3])) / 2;
    expect(Math.abs(backMid)).toBeLessThan(0.02);
    expect(boundaryAngle(ring, 0)).toBeCloseTo(Math.PI - (Math.PI * ring.gap) / ring.slots);
    const leftSleeve = polar(1, (boundaryAngle(ring, off[1]) + boundaryAngle(ring, off[2])) / 2);
    expect(leftSleeve.x).toBeGreaterThan(0.9);
    const rightSleeve = polar(1, (boundaryAngle(ring, off[3]) + boundaryAngle(ring, off[4])) / 2);
    expect(rightSleeve.x).toBeLessThan(-0.9);
  });

  it('finds the stitch under a point', () => {
    for (const row of [1, 20, y.counts.A + 1, y.rows.length]) {
      const ring = g.rings[row];
      for (const i of [0, 5, Math.floor(ring.total / 2), ring.total - 1]) {
        const pt = polar((ring.r0 + ring.r1) / 2, stitchAngle(ring, i));
        const hit = hitStitch(g, pt.x, pt.y)!;
        expect(hit.row).toBe(row);
        expect(hit.index).toBe(i);
        const off = zoneOffsets(ring.zones);
        expect(hit.zone).toBe(ZONES[off.findIndex((o, k) => k < 5 && i >= o && i < off[k + 1])]);
      }
    }
    expect(hitStitch(g, 0, 0)).toBeNull(); // the neck opening
  });

  it('follows the centre-front cast-on along its row instead of cutting a V across it', () => {
    const boat = generateYoke(p, defaultYoke('boat'), M);
    const gb = topGeometry(boat);
    const R = boat.counts.neckRow!;
    expect(boat.neck.centre).toBeGreaterThan(10);
    expect(gb.rings[R].edgeCo[0] + gb.rings[R].edgeCo[1]).toBe(boat.neck.centre);
    for (const b of [0, 5]) {
      const pts = boundaryPoints(gb, b);
      // Rings 0 … R−1 one point each, then the arc along row R's cast-on edge.
      const arc = pts.slice(R, -(gb.rings.length - R));
      expect(arc.length).toBeGreaterThan(2);
      for (const q of arc) expect(Math.hypot(q.x, q.y)).toBeCloseTo(gb.rings[R].r0);
      // It reaches centre front (straight down) on that row.
      const end = arc[arc.length - 1];
      expect(Math.abs(end.x)).toBeLessThan(1e-6);
      expect(end.y).toBeGreaterThan(0);
    }
  });

  it('draws the marker lines one point per ring', () => {
    for (const b of [1, 2, 3, 4]) expect(boundaryPoints(g, b).length).toBe(g.rings.length);
  });

  it('cardigan: each front edge follows its own cast-on row', () => {
    const c = setOpening(p, 'cardigan');
    const yc = generateYoke(c, defaultYoke('round'), M);
    const gc = topGeometry(yc);
    const R = yc.counts.neckRow!;
    expect(gc.rings[R].edgeCo).toEqual([0, yc.neck.frontEdgeCo]);
    expect(gc.rings[R + 1].edgeCo).toEqual([yc.neck.frontEdgeCo, 0]);
    // The gap closes on the right front's side on row R and the left front's on row R + 1, so the markers don't jump.
    // (Within half a stitch: an odd neck can't be split evenly at centre front.)
    expect(Math.abs(gc.rings[R].lead - gc.rings[R - 1].lead)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(gc.rings[R + 1].lead - Math.max(0, gc.rings[R].lead - yc.neck.frontEdgeCo))).toBeLessThanOrEqual(0.5);
    expect(gc.rings[R + 1].gap - gc.rings[R + 1].lead).toBe(gc.rings[R].gap - gc.rings[R].lead);
  });
});
