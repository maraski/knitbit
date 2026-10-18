// A contiguous yoke seen from above: the neck in the middle, each row a ring around it (radius = distance from the
// neck in cm), each stitch an angle by its share of the ring. Back at the top, fronts at the bottom, the wearer's
// left sleeve on the right. Before a pullover's neck is joined (and on a cardigan) the ring is open at centre front.
//
// Angles are measured clockwise from 12 o'clock on screen, in radians. Stitches run counter-clockwise from centre
// front in row order: left front, left sleeve, back, right sleeve, right front.

import { ZONES, type YokeResult, type Zone, type ZoneCounts } from './contiguous';

export interface TopRing {
  row: number; // 0 = the cast-on (neck)
  total: number; // stitches on the needle
  /** Open at centre front: stitch-widths of neck (or band) still to come between the front edges. */
  gap: number;
  /** total + gap: the ring's stitch slots. */
  slots: number;
  /** Inner and outer radius of this row's band (cm from the centre). */
  r0: number;
  r1: number;
  zones: ZoneCounts;
}

export interface TopGeometry {
  neckR: number; // radius of the neck (row 0)
  outerR: number;
  rings: TopRing[]; // index = row
}

export function topGeometry(y: YokeResult): TopGeometry {
  const spc = y.stitchesPerCm;
  const rowH = 1 / y.rowsPerCm;
  // The neck opening at the front is the back neck; neck increases and front cast-ons close it.
  let gap = y.castOnZones.back;
  const neckR = (y.castOn + gap) / spc / (2 * Math.PI);
  const rings: TopRing[] = [{ row: 0, total: y.castOn, gap, slots: y.castOn + gap, r0: neckR, r1: neckR, zones: { ...y.castOnZones } }];
  for (const r of y.rows) {
    if (r.neck) gap -= 2;
    for (const co of r.castOns) gap -= co.count;
    gap = Math.max(0, gap);
    const r0 = neckR + (r.row - 1) * rowH;
    rings.push({ row: r.row, total: r.total, gap, slots: r.total + gap, r0, r1: r0 + rowH, zones: { ...r.zones } });
  }
  return { neckR, outerR: rings[rings.length - 1].r1, rings };
}

/** Angle of a position along a ring: `p` in stitch slots counter-clockwise from centre front (0 … slots). */
export function slotAngle(ring: TopRing, p: number): number {
  return Math.PI - (2 * Math.PI * p) / Math.max(1, ring.slots);
}

/** Angle of the centre of stitch `i` of a row (0 = the left front's front-edge stitch). */
export function stitchAngle(ring: TopRing, i: number): number {
  return slotAngle(ring, ring.gap / 2 + i + 0.5);
}

/** Angle of the boundary before stitch `i` (i = 0 … total). */
export function boundaryAngle(ring: TopRing, i: number): number {
  return slotAngle(ring, ring.gap / 2 + i);
}

/** Stitch index where each zone starts (and the row's end), in row order. */
export function zoneOffsets(z: ZoneCounts): number[] {
  const out = [0];
  for (const k of ZONES) out.push(out[out.length - 1] + z[k]);
  return out;
}

/** Screen point (cm, y down) at radius r and angle a. */
export function polar(r: number, a: number): { x: number; y: number } {
  return { x: r * Math.sin(a), y: -r * Math.cos(a) };
}

/** The stitch under a point (cm from the centre, y down), or null outside the fabric. */
export function hitStitch(g: TopGeometry, x: number, y: number): { row: number; index: number; zone: Zone } | null {
  const r = Math.hypot(x, y);
  const ring = g.rings.find((q) => q.row > 0 && r >= q.r0 && r < q.r1);
  if (!ring) return null;
  const a = Math.atan2(x, -y); // clockwise from 12 o'clock
  // p counter-clockwise from centre front: a = π − 2πp/slots.
  let p = ((Math.PI - a) / (2 * Math.PI)) * ring.slots;
  p = ((p % ring.slots) + ring.slots) % ring.slots;
  const index = Math.floor(p - ring.gap / 2);
  if (index < 0 || index >= ring.total) return null;
  const off = zoneOffsets(ring.zones);
  const zi = off.findIndex((o, k) => k < 5 && index >= o && index < off[k + 1]);
  return { row: ring.row, index, zone: ZONES[Math.max(0, zi)] };
}
