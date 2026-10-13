// Measuring a stretch of a computed panel's outline. Type-only dependency on panel.ts, so both
// panel.ts (for armhole_len) and joins.ts can use it without an import cycle.

import type { Id } from './model';
import type { ComputedPanel, Edge } from './panel';

export interface SideEdgeLength {
  rows: number; // rows along the edge
  lengthCm: number; // measured along the edge as drawn: slopes between shaping points, steps as horizontal runs
  stepStitches: number; // stitches bound off / cast on / turned in steps along the edge
  rowRange: [number, number];
}

/** Length of a panel's left or right edge between two waypoints (either order). Null if a waypoint is missing. */
export function sideEdgeLength(c: ComputedPanel, side: Edge, fromId: Id, toId: Id): SideEdgeLength | null {
  const a = c.waypoints.find((w) => w.id === fromId);
  const b = c.waypoints.find((w) => w.id === toId);
  if (!a || !b) return null;
  const r0 = Math.min(a.row, b.row);
  const r1 = Math.max(a.row, b.row);
  const pos = side === 'left' ? c.leftEdge : c.rightEdge;
  const steps = new Map<number, number>();
  for (const seg of c.segments) {
    for (const ev of seg[side].events) {
      if (ev.row > r0 && ev.row <= r1 && (ev.kind === 'bindoff' || ev.kind === 'caston' || ev.kind === 'turn')) {
        steps.set(ev.row, (steps.get(ev.row) ?? 0) + Math.abs(ev.delta));
      }
    }
  }
  const pts: [number, number][] = [[pos[r0], r0]];
  let stepStitches = 0;
  for (let r = r0 + 1; r <= r1; r++) {
    const step = steps.get(r) ?? 0;
    if (step) {
      stepStitches += step;
      pts.push([pos[r - 1], r - 1], [pos[r], r - 1]);
    } else if (Math.abs(pos[r] - pos[r - 1]) > 1e-9) {
      pts.push([pos[r], r]);
    }
  }
  pts.push([pos[r1], r1]);
  let lengthCm = 0;
  for (let i = 1; i < pts.length; i++) lengthCm += Math.hypot((pts[i][0] - pts[i - 1][0]) / c.stitchesPerCm, (pts[i][1] - pts[i - 1][1]) / c.rowsPerCm);
  return { rows: r1 - r0, lengthCm, stepStitches, rowRange: [r0, r1] };
}
