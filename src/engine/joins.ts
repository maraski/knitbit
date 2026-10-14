// Joins: measuring tagged edges, comparing seam sides, and suggesting pick-up counts.
// Display only: nothing here changes a panel.

import { sideEdgeLength } from './edges';
import type { EdgeKey, EdgeRef, Id, Join, JoinTag, Project } from './model';
import { computePanel, type ComputedPanel } from './panel';
import { roundNearest } from './rounding';

export const JOIN_TAGS: Record<JoinTag, { label: string; color: string }> = {
  seam: { label: 'Seam', color: '#2f6690' },
  pickup: { label: 'Pick up stitches', color: '#3f8a5a' },
  live: { label: 'Live / held stitches', color: '#b0662a' },
  bindoff: { label: 'Bound off', color: '#5b4fae' },
  caston: { label: 'Cast on', color: '#8a8577' },
  free: { label: 'Free edge', color: '#a9a49a' },
};

export type PanelCache = Map<string, ComputedPanel>;

export function cachedPanel(project: Project, panelId: Id, sizeId: Id, cache: PanelCache): ComputedPanel | null {
  const key = `${panelId}|${sizeId}`;
  let c = cache.get(key);
  if (!c) {
    const panel = project.panels.find((p) => p.id === panelId);
    if (!panel) return null;
    c = computePanel(project, panel, sizeId);
    cache.set(key, c);
  }
  return c;
}

export interface EdgeMeasure {
  ok: boolean;
  label: string;
  error?: string;
  rows: number; // rows along the edge (vertical extent)
  stitches: number; // stitches along horizontal parts (cast-on / bind-off / held stitches, steps)
  lengthCm: number; // length measured along the edge
  /** Suggested pick-up count: rows × ratio + 1 per stitch along horizontal parts. */
  pickup: number;
  parts: string[]; // human-readable breakdown
  rowRange: [number, number] | null; // knit rows covered (side edges)
}

export function edgeLabel(project: Project, ref: EdgeRef): string {
  const panel = project.panels.find((p) => p.id === ref.panelId);
  if (!panel) return '(deleted panel)';
  const e = ref.edge;
  const name = (id: Id) => panel.waypoints.find((w) => w.id === id)?.name ?? '?';
  switch (e.kind) {
    case 'side':
      return `${panel.name} · ${e.side} edge, ${name(e.from)} → ${name(e.to)}`;
    case 'bottom':
      return `${panel.name} · lower edge`;
    case 'top':
      return `${panel.name} · upper edge`;
    default:
      return `${panel.name} · neckline`;
  }
}

function blankMeasure(label: string, error: string): EdgeMeasure {
  return { ok: false, label, error, rows: 0, stitches: 0, lengthCm: 0, pickup: 0, parts: [], rowRange: null };
}

/** Measure one edge in one size. `ratio` is the pick-up ratio (stitches per rows). */
export function measureEdge(
  project: Project,
  ref: EdgeRef,
  sizeId: Id,
  ratio: { stitches: number; rows: number },
  cache: PanelCache = new Map(),
): EdgeMeasure {
  const label = edgeLabel(project, ref);
  const panel = project.panels.find((p) => p.id === ref.panelId);
  if (!panel) return blankMeasure(label, 'The panel no longer exists.');
  const c = cachedPanel(project, ref.panelId, sizeId, cache);
  if (!c || !c.ok) return blankMeasure(label, 'The panel cannot be computed in this size.');
  const spc = c.stitchesPerCm;
  const rpc = c.rowsPerCm;
  const perRow = ratio.rows > 0 ? ratio.stitches / ratio.rows : 0.75;
  const e = ref.edge;
  const garmentBottom = c.topDown ? c.totalRows : 0;
  const garmentTop = c.topDown ? 0 : c.totalRows;

  if (e.kind === 'side') {
    const m = sideEdgeLength(c, e.side, e.from, e.to);
    if (!m) return blankMeasure(label, 'A waypoint of this edge no longer exists.');
    const parts = [`${m.rows} rows`];
    if (m.stepStitches) parts.push(`${m.stepStitches} sts bound off / cast on in steps`);
    return { ok: true, label, rows: m.rows, stitches: m.stepStitches, lengthCm: m.lengthCm, pickup: roundNearest(m.rows * perRow) + m.stepStitches, parts, rowRange: m.rowRange };
  }

  if (e.kind === 'bottom' || e.kind === 'top') {
    const r = e.kind === 'bottom' ? garmentBottom : garmentTop;
    // A top-down cast-on row includes the stitches short-row shoulders hold at first.
    let sts = roundNearest(c.rightEdge[r] - c.leftEdge[r] + (c.topDown && e.kind === 'top' ? c.held[r] ?? 0 : 0));
    if (c.neckLeft[r] !== null) sts -= roundNearest(c.neckRight[r]! - c.neckLeft[r]!);
    sts = Math.max(0, sts);
    return { ok: true, label, rows: 0, stitches: sts, lengthCm: sts / spc, pickup: sts, parts: [`${sts} sts`], rowRange: null };
  }

  // Neckline: centre stitches plus two slopes.
  const n = c.neck;
  if (!n) return blankMeasure(label, 'This panel has no neckline.');
  const slopeRows = n.atStart ? n.splitRow - 1 : c.totalRows - n.splitRow;
  // A cardigan front has one neck slope: the edge on its own side (the other one is its straight front edge).
  const slopeEdge = c.half?.keep === 'left' ? c.neckLeft : c.half ? c.neckRight : c.neckLeft;
  const slopes = n.oneSide ? 1 : 2;
  const neckRows = Array.from({ length: c.totalRows + 1 }, (_, r) => r).filter((r) => c.neckLeft[r] !== null);
  let slopeLen = 0;
  for (let i = 1; i < neckRows.length; i++) {
    const r = neckRows[i];
    const p = neckRows[i - 1];
    slopeLen += Math.hypot(Math.abs(slopeEdge[r]! - slopeEdge[p]!) / spc, 1 / rpc);
  }
  const centreText = panel.neckline?.centre === 'hold' ? 'held' : n.atStart ? 'cast on' : 'bound off';
  const slopePick = roundNearest(slopeRows * perRow);
  return {
    ok: true,
    label,
    rows: slopeRows * slopes,
    stitches: n.centreSts,
    lengthCm: n.centreSts / spc + slopes * slopeLen,
    pickup: n.centreSts + slopes * slopePick,
    parts: n.oneSide
      ? [`${n.centreSts} sts ${centreText} at the front edge`, `1 slope of ${slopeRows} rows (${slopePick})`]
      : [`centre ${n.centreSts} sts ${centreText}`, `2 slopes of ${slopeRows} rows (${slopePick} each)`],
    rowRange: null,
  };
}

export interface SideTotal {
  measures: EdgeMeasure[];
  rows: number;
  lengthCm: number;
  pickup: number;
  ok: boolean;
}

function total(measures: EdgeMeasure[]): SideTotal {
  return {
    measures,
    rows: measures.reduce((a, m) => a + m.rows, 0),
    lengthCm: measures.reduce((a, m) => a + m.lengthCm, 0),
    pickup: measures.reduce((a, m) => a + m.pickup, 0),
    ok: measures.length > 0 && measures.every((m) => m.ok),
  };
}

export interface JoinReport {
  join: Join;
  a: SideTotal;
  b: SideTotal | null; // seams only
  diffRows: number; // a − b
  diffCm: number;
  withinTolerance: boolean;
  suggestion: string | null;
  /** Pick-up total rounded to common rib multiples. */
  multiples: { multiple: number; value: number }[];
}

export function joinRatio(project: Project, join: Join) {
  return join.ratio ?? project.settings.pickUp;
}

/** Longest run of rows on an edge with no shaping, for "add rows here" suggestions. */
function straightStretch(project: Project, ref: EdgeRef, sizeId: Id, cache: PanelCache): { from: number; to: number; between: string } | null {
  const c = cachedPanel(project, ref.panelId, sizeId, cache);
  const e = ref.edge;
  if (!c || !c.ok || e.kind !== 'side') return null;
  const a = c.waypoints.find((w) => w.id === e.from);
  const b = c.waypoints.find((w) => w.id === e.to);
  if (!a || !b) return null;
  const r0 = Math.min(a.row, b.row);
  const r1 = Math.max(a.row, b.row);
  const shaped = new Set<number>();
  for (const seg of c.segments) for (const ev of seg[e.side].events) shaped.add(ev.row);
  let best: { from: number; to: number } | null = null;
  let start = r0 + 1;
  for (let r = r0 + 1; r <= r1 + 1; r++) {
    if (r > r1 || shaped.has(r)) {
      if (r - start > (best ? best.to - best.from + 1 : 0)) best = { from: start, to: r - 1 };
      start = r + 1;
    }
  }
  if (!best) return null;
  const sorted = [...c.waypoints].sort((x, y) => x.row - y.row);
  const below = [...sorted].reverse().find((w) => w.row <= best!.from - 1)?.name ?? 'start';
  const above = sorted.find((w) => w.row >= best!.to)?.name ?? 'end';
  return { ...best, between: c.topDown ? `${above} and ${below}` : `${below} and ${above}` };
}

export function joinReport(project: Project, join: Join, sizeId: Id, cache: PanelCache = new Map()): JoinReport {
  const ratio = joinRatio(project, join);
  const a = total(join.edges.map((r) => measureEdge(project, r, sizeId, ratio, cache)));
  const b = join.tag === 'seam' ? total(join.partner.map((r) => measureEdge(project, r, sizeId, ratio, cache))) : null;
  const diffRows = b ? a.rows - b.rows : 0;
  const diffCm = b ? a.lengthCm - b.lengthCm : 0;
  const tol = project.settings.seamToleranceCm;
  const withinTolerance = !b || Math.abs(diffCm) <= tol;
  let suggestion: string | null = null;
  if (b && a.ok && b.ok && (Math.abs(diffCm) >= 0.3 || diffRows !== 0)) {
    const longer = diffCm >= 0 ? 'the first side' : 'the second side';
    const shorterRefs = diffCm >= 0 ? join.partner : join.edges;
    // Row-for-row seams (one edge each side, e.g. side seams) get a rows suggestion; seams across differently
    // shaped edges (a sleeve cap into an armhole) are compared by length.
    const allSides = [...join.edges, ...join.partner].every((r) => r.edge.kind === 'side');
    const rows = Math.abs(diffRows);
    const rowForRow = allSides && a.measures.length === 1 && b.measures.length === 1 && rows > 0 && rows <= 0.1 * Math.max(a.rows, b.rows);
    if (rowForRow) {
      const stretch = shorterRefs.map((r) => ({ r, s: straightStretch(project, r, sizeId, cache) })).find((x) => x.s);
      const where = stretch?.s ? ` in its straight stretch between ${stretch.s.between} (rows ${stretch.s.from}–${stretch.s.to})` : '';
      suggestion = `${cap(longer)} is ${rows} row${rows === 1 ? '' : 's'} longer. Add ${rows} row${rows === 1 ? '' : 's'} to the shorter side${where}, or ease the extra rows in evenly along the seam.`;
    } else {
      const shorterLen = Math.min(a.lengthCm, b.lengthCm);
      const pct = shorterLen > 0 ? (Math.abs(diffCm) / shorterLen) * 100 : 0;
      suggestion = `${cap(longer)} is ${Math.abs(diffCm).toFixed(1)} cm longer (${pct.toFixed(0)} % ease). Ease it in along the seam${pct > 8 ? ', or change the shaping: that is a lot of ease' : ''}.`;
    }
  }
  const multiples = join.tag === 'pickup' ? [2, 4].map((m) => ({ multiple: m, value: Math.max(m, Math.round(a.pickup / m) * m) })) : [];
  return { join, a, b, diffRows, diffCm, withinTolerance, suggestion, multiples };
}

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

/** Do two edge keys describe the same edge? (Side edges compare their waypoint pair in either order.) */
export function sameEdge(a: EdgeRef, b: EdgeRef): boolean {
  if (a.panelId !== b.panelId || a.edge.kind !== b.edge.kind) return false;
  if (a.edge.kind === 'side' && b.edge.kind === 'side') {
    return a.edge.side === b.edge.side && new Set([a.edge.from, a.edge.to, b.edge.from, b.edge.to]).size === 2;
  }
  return true;
}

/** Joins touching a panel, with the edges on that panel (for drawing tags on the schematic). */
export function panelJoins(project: Project, panelId: Id): { join: Join; edge: EdgeKey; role: 'edges' | 'partner' }[] {
  const out: { join: Join; edge: EdgeKey; role: 'edges' | 'partner' }[] = [];
  for (const j of project.joins ?? []) {
    for (const r of j.edges) if (r.panelId === panelId) out.push({ join: j, edge: r.edge, role: 'edges' });
    for (const r of j.partner) if (r.panelId === panelId) out.push({ join: j, edge: r.edge, role: 'partner' });
  }
  return out;
}

/** Remove references to a deleted panel (and joins left with nothing). */
export function dropPanelFromJoins(joins: Join[] | undefined, panelId: Id): Join[] {
  return (joins ?? [])
    .map((j) => ({ ...j, edges: j.edges.filter((r) => r.panelId !== panelId), partner: j.partner.filter((r) => r.panelId !== panelId) }))
    .filter((j) => j.edges.length + j.partner.length > 0);
}
