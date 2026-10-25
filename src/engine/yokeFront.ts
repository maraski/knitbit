// A yoke laid flat: folded at the top of each sleeve into a back half and a front half, both upright (neck at the
// top, row 1 first) and RS facing — the back as seen from behind (the wearer's left on the left), the front as seen
// from the front (the wearer's left on the right). Each stitch is one stitch wide at its place along the row, as in
// the top view (yokeTop.ts): its slot from centre front, so the neck opening, the front neck and the short rows'
// unworked stitches keep their places. x is in stitches from the half's centre line (centre back, centre front);
// rows run down from the cast-on.
//
// The fold runs down the middle of each sleeve (on the contiguous yoke, the shoulder seam and cap); an odd centre
// stitch goes to the back half. In row order (left front … right front) both halves read left to right, so a
// chart's RS rows still read right to left.

import { ZONES, type YokeResult, type Zone, type ZoneCounts } from './contiguous';
import { topGeometry, zoneOffsets, type TopRing } from './yokeTop';

export type Half = 'back' | 'front';

/** Stitches [i0, i1) of a row (in row order) drawn in one half, stitch i's left edge at x = i + shift. */
export interface FrontPiece {
  half: Half;
  i0: number;
  i1: number;
  shift: number;
}

/** A zone's stitches in one half on one row: x from x0 to x1 (stitches from the half's centre line). */
export interface FrontPart {
  half: Half;
  zone: Zone;
  x0: number;
  x1: number;
}

export interface FrontRow {
  row: number; // 0 = the cast-on
  /** Top and bottom of the row, cm down from the cast-on (a folded band's facing and turning round: no height). */
  y0: number;
  y1: number;
  total: number;
  zones: ZoneCounts;
  /** Every stitch of the row by half (the chart), and the zones' worked stitches (the schematic). */
  pieces: FrontPiece[];
  parts: FrontPart[];
  /** Where each half's sleeve stitches fold: the first back-half stitch and the first front-half stitch after it. */
  fold: [number, number];
  /** The stitches worked on this row (short rows: those between the turns; the cast-on: those first worked on row 1). */
  lo: number;
  hi: number;
}

export interface FrontGeometry {
  rows: FrontRow[]; // index = row
  height: number; // cm, cast-on to the split
  /** Widest extent of each half over all rows, in stitches from its centre line. */
  extent: Record<Half, { min: number; max: number }>;
}

function frontRow(ring: TopRing, y0: number, y1: number): FrontRow {
  const off = zoneOffsets(ring.zones);
  const z = ring.zones;
  // The fold: the middle of each sleeve, its odd centre stitch on the back.
  const bL = off[1] + Math.floor(z.leftSleeve / 2);
  const bR = off[3] + Math.ceil(z.rightSleeve / 2);
  const cb = (off[2] + off[3]) / 2;
  // Front: the right front's side of centre front (x < 0) and the left front's (x > 0); they meet once the round is
  // closed there (no gap).
  const pieces: FrontPiece[] = [{ half: 'back', i0: bL, i1: bR, shift: -cb }];
  pieces.push({ half: 'front', i0: bR, i1: ring.total, shift: ring.lead - ring.slots });
  pieces.push({ half: 'front', i0: 0, i1: bL, shift: ring.lead });
  const parts: FrontPart[] = [];
  for (const p of pieces) {
    ZONES.forEach((zone, zi) => {
      const a = Math.max(p.i0, off[zi], ring.lo);
      const b = Math.min(p.i1, off[zi + 1], ring.hi);
      if (b > a) parts.push({ half: p.half, zone, x0: a + p.shift, x1: b + p.shift });
    });
  }
  return { row: ring.row, y0, y1, total: ring.total, zones: { ...z }, pieces, parts, fold: [bL, bR], lo: ring.lo, hi: ring.hi };
}

/** `fold`: a folded band's facing and turning round get no height (the finished shape, for the schematic); the
 * chart passes false so every row has its own line. */
export function frontGeometry(y: YokeResult, fold = true): FrontGeometry {
  const g = topGeometry(y, fold);
  const rows = g.rings.map((ring) => frontRow(ring, ring.r0 - g.neckR, ring.r1 - g.neckR));
  const extent: FrontGeometry['extent'] = { back: { min: 0, max: 0 }, front: { min: 0, max: 0 } };
  for (const r of rows)
    for (const p of r.parts) {
      extent[p.half].min = Math.min(extent[p.half].min, p.x0);
      extent[p.half].max = Math.max(extent[p.half].max, p.x1);
    }
  return { rows, height: g.outerR - g.neckR, extent };
}

/** The piece (half and x shift) stitch `i` of a row is drawn in. */
export function pieceOf(r: FrontRow, i: number): FrontPiece | undefined {
  return r.pieces.find((p) => i >= p.i0 && i < p.i1);
}

/** The stitch under a point of one half (x in stitches from its centre line, y in cm down from the cast-on), or null
 * off the fabric. Rows with no height (a folded band's facing) are never hit. */
export function hitFront(g: FrontGeometry, half: Half, x: number, y: number): { row: number; index: number; zone: Zone } | null {
  const r = g.rows.find((q) => q.row > 0 && y >= q.y0 && y < q.y1);
  if (!r) return null;
  const part = r.parts.find((p) => p.half === half && x >= p.x0 && x < p.x1);
  if (!part) return null;
  const piece = r.pieces.find((p) => p.half === half && x - p.shift >= p.i0 && x - p.shift < p.i1);
  if (!piece) return null;
  return { row: r.row, index: Math.floor(x - piece.shift), zone: part.zone };
}

/** The polygons of a zone's part in a half, over every row it has stitches in (runs of rows: a part that stops and
 * starts again is two shapes). Points in (x stitches, y cm); the left edge down, then the right edge up. */
export function partShapes(g: FrontGeometry, half: Half, zone: Zone): { x: number; y: number }[][] {
  const shapes: { x: number; y: number }[][] = [];
  let left: { x: number; y: number }[] = [];
  let right: { x: number; y: number }[] = [];
  const flush = () => {
    if (left.length) shapes.push([...left, ...right.reverse()]);
    left = [];
    right = [];
  };
  for (const r of g.rows) {
    if (r.row === 0) continue;
    const part = r.parts.find((p) => p.half === half && p.zone === zone);
    if (!part) {
      flush();
      continue;
    }
    if (!left.length) {
      left.push({ x: part.x0, y: r.y0 });
      right.push({ x: part.x1, y: r.y0 });
    }
    left.push({ x: part.x0, y: r.y1 });
    right.push({ x: part.x1, y: r.y1 });
  }
  flush();
  return shapes;
}

/** A marker (zone boundary b = 1 … 4) down one half, as points (x stitches, y cm), on the rows it lies in that half. */
export function boundaryLineFront(g: FrontGeometry, half: Half, b: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (const r of g.rows) {
    if (r.row === 0) continue;
    const i = zoneOffsets(r.zones)[b];
    const p = i >= r.lo && i <= r.hi ? r.pieces.find((q) => q.half === half && i > q.i0 && i < q.i1) : undefined;
    if (!p) continue;
    if (!pts.length) pts.push({ x: i + p.shift, y: r.y0 });
    pts.push({ x: i + p.shift, y: r.y1 });
  }
  return pts;
}
