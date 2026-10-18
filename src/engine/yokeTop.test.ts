import { describe, expect, it } from 'vitest';
import { defaultYoke, generateYoke, ZONES } from './contiguous';
import { setOpening } from './garment';
import { boundaryAngle, hitStitch, polar, stitchAngle, topGeometry, zoneOffsets } from './yokeTop';
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
});
