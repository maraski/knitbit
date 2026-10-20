// A contiguous yoke as a panel: the generator's rows turned into an ordinary ComputedPanel (each row as wide as its
// stitch count, centred, top-down) so the schematic, layout, overlay and joins work on it. Its stitch chart is built
// in yokeChart.ts (loaded with the chart).

import { generateYoke, ZONES, type YokeResult, type Zone } from './contiguous';
import type { Id, Panel, Project } from './model';
import type { ComputedPanel, ComputedWaypoint, Issue, Point } from './panel';
import { roundRows } from './rounding';

/** Names of the yoke's landmark rows (used like waypoints: alignment, labels, joins). */
export const YOKE_WAYPOINTS = { neck: 'neck', shoulder: 'shoulder', capRapid: 'cap_rapid', capSlow: 'cap_slow', underarm: 'underarm' } as const;

function landmark(id: string, name: string, row: number, sts: number, spc: number, rpc: number): ComputedWaypoint {
  const r = roundRows(row);
  return {
    id,
    name,
    key: name,
    heightCm: row / rpc,
    row,
    rowRounding: r,
    symmetric: true,
    widthCm: sts / spc,
    leftCm: sts / spc / 2,
    rightCm: sts / spc / 2,
    stitches: sts,
    stitchRounding: [{ raw: sts, value: sts, steps: [], warnings: [] }],
    leftPos: -sts / 2,
    rightPos: sts / 2,
    actualStitches: sts,
    selvedge: 0,
    inRound: false,
    overridden: { height: false, width: false },
  };
}

export function computeYokePanel(project: Project, panel: Panel, sizeId: Id): ComputedPanel {
  const y = generateYoke(project, panel.yoke!, sizeId);
  const spc = y.stitchesPerCm;
  const rpc = y.rowsPerCm;
  const T = y.rows.length;
  const counts = [y.castOn, ...y.rows.map((r) => r.total)];
  const leftEdge = counts.map((n) => -n / 2);
  const rightEdge = counts.map((n) => n / 2);
  const issues: Issue[] = y.issues.map((i) => ({ severity: i.severity, message: i.message, ref: { kind: 'panel' } }));
  const { A, C, D } = y.counts;
  const wps: ComputedWaypoint[] = [
    landmark(`${panel.id}:neck`, YOKE_WAYPOINTS.neck, 0, counts[0], spc, rpc),
    landmark(`${panel.id}:shoulder`, YOKE_WAYPOINTS.shoulder, A, counts[A] ?? 0, spc, rpc),
    ...(C > 0 ? [landmark(`${panel.id}:cap_rapid`, YOKE_WAYPOINTS.capRapid, A + C, counts[A + C] ?? 0, spc, rpc)] : []),
    ...(D > 0 ? [landmark(`${panel.id}:cap_slow`, YOKE_WAYPOINTS.capSlow, A + C + D, counts[A + C + D] ?? 0, spc, rpc)] : []),
    landmark(`${panel.id}:underarm`, YOKE_WAYPOINTS.underarm, T, counts[T] ?? 0, spc, rpc),
  ].filter((w, i, a) => i === 0 || w.row > a[i - 1].row);
  const outline: Point[] = [];
  for (let r = 0; r <= T; r++) outline.push({ x: leftEdge[r], y: r });
  for (let r = T; r >= 0; r--) outline.push({ x: rightEdge[r], y: r });
  const join = y.counts.joinRow;
  return {
    panelId: panel.id,
    sizeId,
    ok: y.ok && T > 0,
    topDown: true,
    stitchesPerCm: spc,
    rowsPerCm: rpc,
    waypoints: wps,
    segments: [],
    neck: null,
    totalRows: T,
    roundRows: join !== null && join < T ? { from: join + 1, to: T } : null,
    firstFlatRow: 1,
    sections: [],
    bust: null,
    lines: [],
    princess: null,
    held: new Array(T + 1).fill(0),
    leftEdge,
    rightEdge,
    neckLeft: new Array(T + 1).fill(null),
    neckRight: new Array(T + 1).fill(null),
    counts,
    outline,
    markers: [],
    issues,
    yoke: y,
  };
}

/** Column where each zone starts in a row of `total` sts centred in `cols` (zone boundaries = marker positions). */
export function zoneStarts(row: { zones: Record<Zone, number>; total: number }, x0: number): number[] {
  const starts: number[] = [];
  let x = Math.round(-row.total / 2 - x0);
  for (const z of ZONES) {
    starts.push(x);
    x += row.zones[z];
  }
  starts.push(x);
  return starts;
}

export type { YokeResult };
