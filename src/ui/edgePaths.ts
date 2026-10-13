// Paths of panel edges in stitch/row space (x = stitches from the centre line, y = knit row), shared by the
// schematic and the layout. Each edge is one or more polylines.

import type { EdgeKey } from '../engine/model';
import type { ComputedPanel, Point } from '../engine/panel';

/** Per-row stair along an outer edge between two knit rows (row r spans y = r−1 … r). */
export function edgeRowsPath(edge: number[], from: number, to: number): Point[] {
  const pts: Point[] = [];
  for (let r = Math.max(0, from); r <= to; r++) {
    pts.push({ x: edge[r], y: Math.max(0, r - 1) });
    pts.push({ x: edge[r], y: r });
  }
  return pts;
}

export function edgePaths(c: ComputedPanel, edge: EdgeKey): Point[][] {
  const top = c.totalRows;
  if (edge.kind === 'side') {
    const a = c.waypoints.find((w) => w.id === edge.from);
    const b = c.waypoints.find((w) => w.id === edge.to);
    if (!a || !b) return [];
    return [edgeRowsPath(edge.side === 'left' ? c.leftEdge : c.rightEdge, Math.min(a.row, b.row) + 1, Math.max(a.row, b.row))];
  }
  if (edge.kind === 'bottom' || edge.kind === 'top') {
    const r = (edge.kind === 'bottom') === !c.topDown ? 0 : top;
    if (c.neckLeft[r] !== null && c.neck) {
      return [
        [{ x: c.leftEdge[r], y: r }, { x: c.neckLeft[r]!, y: r }],
        [{ x: c.neckRight[r]!, y: r }, { x: c.rightEdge[r], y: r }],
      ];
    }
    return [[{ x: c.leftEdge[r], y: r }, { x: c.rightEdge[r], y: r }]];
  }
  if (!c.neck) return [];
  const rows: number[] = [];
  for (let r = 0; r <= top; r++) if (c.neckLeft[r] !== null) rows.push(r);
  const line = c.neck.splitRow - 1;
  const left = rows.map((r) => ({ x: c.neckLeft[r]!, y: r }));
  const right = rows.map((r) => ({ x: c.neckRight[r]!, y: r }));
  const cl = { x: c.neck.centreX - c.neck.centreSts / 2, y: line };
  const cr = { x: c.neck.centreX + c.neck.centreSts / 2, y: line };
  return c.neck.atStart ? [[...left, cl, cr, ...right.reverse()]] : [[...left.reverse(), cl, cr, ...right]];
}

/** Middle point of an edge (for drawing seam links). */
export function edgeMidpoint(c: ComputedPanel, edge: EdgeKey): Point | null {
  const pieces = edgePaths(c, edge);
  const pts = pieces.flat();
  if (!pts.length) return null;
  return pts[Math.floor(pts.length / 2)];
}
