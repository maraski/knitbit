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
  /** Slots of the gap before the first stitch (the left-front side): the fronts close it one side at a time. */
  lead: number;
  /** total + gap: the ring's stitch slots. */
  slots: number;
  /** Inner and outer radius of this row's band (cm from the centre). */
  r0: number;
  r1: number;
  zones: ZoneCounts;
  /** Stitches cast on this row at the left-front edge (boundary 0) and the right-front edge (boundary 5). */
  edgeCo: [number, number];
  /** The stitches drawn on this ring, [lo, hi): all of them, or (whole-neck start) those between this pair's turns.
   * Ring 0: the cast-on stitches whose first row is row 1. */
  lo: number;
  hi: number;
}

export interface TopGeometry {
  neckR: number; // radius of the neck (row 0)
  outerR: number;
  rings: TopRing[]; // index = row
}

export function topGeometry(y: YokeResult): TopGeometry {
  const spc = y.stitchesPerCm;
  const rowH = 1 / y.rowsPerCm;
  // The neck opening at the front is the back neck; neck increases and front cast-ons close it. A whole-neck start
  // casts the fronts on too: no opening (a cardigan: the band space between its front edges).
  let gap = y.shortRows ? y.neck.closingSts : y.castOnZones.back;
  let lead = gap / 2;
  const neckR = (y.castOn + gap) / spc / (2 * Math.PI);
  // Short rows: drawn symmetrically, each pair between its two turns (the half rows at the start and end of a
  // pullover's section stand for one row each side); the stitches outside are worked first further out.
  const sr = y.shortRows;
  // The section's first row (an off-shoulder raglan's back raise starts after its band and increase round).
  const from = sr?.fromRow ?? 1;
  const unworked = (row: number) => (sr && sr.pairs && row >= from && row <= sr.endRow ? sr.turns[Math.min(sr.pairs, Math.max(1, Math.ceil((row - from + 1) / 2))) - 1] : 0);
  const u0 = unworked(1);
  const rings: TopRing[] = [{ row: 0, total: y.castOn, gap, lead, slots: y.castOn + gap, r0: neckR, r1: neckR, zones: { ...y.castOnZones }, edgeCo: [0, 0], lo: u0, hi: y.castOn - u0 }];
  for (const r of y.rows) {
    if (r.neck) {
      gap -= 2;
      lead -= 1;
    }
    const edgeCo: [number, number] = [0, 0];
    for (const co of r.castOns) {
      gap -= co.count;
      // The centre-front cast-on closes the round: half of it next to each front edge (as on the flat chart).
      if (co.where === 'centre-front') {
        edgeCo[0] += Math.floor(co.count / 2);
        edgeCo[1] += co.count - Math.floor(co.count / 2);
      } else edgeCo[co.zone === 'leftFront' ? 0 : 1] += co.count;
    }
    gap = Math.max(0, gap);
    lead = Math.min(gap, Math.max(0, lead - edgeCo[0]));
    const r0 = neckR + (r.row - 1) * rowH;
    const u = unworked(r.row);
    rings.push({ row: r.row, total: r.total, gap, lead, slots: r.total + gap, r0, r1: r0 + rowH, zones: { ...r.zones }, edgeCo, lo: u, hi: r.total - u });
  }
  return { neckR, outerR: rings[rings.length - 1].r1, rings };
}

/** Angle of a position along a ring: `p` in stitch slots counter-clockwise from centre front (0 … slots). */
export function slotAngle(ring: TopRing, p: number): number {
  return Math.PI - (2 * Math.PI * p) / Math.max(1, ring.slots);
}

/** Angle of the centre of stitch `i` of a row (0 = the left front's front-edge stitch). */
export function stitchAngle(ring: TopRing, i: number): number {
  return slotAngle(ring, ring.lead + i + 0.5);
}

/** Angle of the boundary before stitch `i` (i = 0 … total). */
export function boundaryAngle(ring: TopRing, i: number): number {
  return slotAngle(ring, ring.lead + i);
}

/** Stitch index where each zone starts (and the row's end), in row order. */
export function zoneOffsets(z: ZoneCounts): number[] {
  const out = [0];
  for (const k of ZONES) out.push(out[out.length - 1] + z[k]);
  return out;
}

/**
 * Boundary `b` (0 = left front edge, 1–4 = the markers, 5 = right front edge) from the neck out, as points (cm). Where
 * stitches are cast on at a front edge (the front neck), the edge follows that row's cast-on edge along the ring
 * instead of cutting straight across to the next row.
 */
export function boundaryPoints(g: TopGeometry, b: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  let prev = 0;
  let prevClamped = false;
  g.rings.forEach((ring, k) => {
    const off = zoneOffsets(ring.zones)[b];
    const at = clampToRing(ring, off);
    const a = boundaryAngle(ring, at);
    const co = b === 0 ? ring.edgeCo[0] : b === 5 ? ring.edgeCo[1] : 0;
    if (k > 0 && co > 0) {
      const n = Math.max(2, Math.ceil(Math.abs(a - prev) / 0.05));
      for (let j = 1; j <= n; j++) pts.push(polar(ring.r0, prev + ((a - prev) * j) / n));
    }
    // Where the edge follows the short-row turns (or leaves them), it steps: along the row's inner edge, then out.
    const clamped = at !== off;
    if (k > 0 && (clamped || prevClamped)) pts.push(polar(ring.r0, a));
    pts.push(polar(k === 0 ? ring.r0 : ring.r1, a));
    prev = a;
    prevClamped = clamped;
  });
  return pts;
}

/** A stitch boundary moved inside the stitches drawn on this ring. */
export function clampToRing(ring: TopRing, i: number): number {
  return Math.min(ring.hi, Math.max(ring.lo, i));
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
  const index = Math.floor(p - ring.lead);
  if (index < ring.lo || index >= ring.hi) return null;
  const off = zoneOffsets(ring.zones);
  const zi = off.findIndex((o, k) => k < 5 && index >= o && index < off[k + 1]);
  return { row: ring.row, index, zone: ZONES[Math.max(0, zi)] };
}
