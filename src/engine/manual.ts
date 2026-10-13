// Editing shaping markers by hand. The first edit of a segment edge in a size copies the current
// auto-suggestion into manual markers ("materialises" it), so editing starts from what is drawn.
// Rows in ManualEvent are relative to the segment's first row (1-based). Pure: returns a new project.

import type { Id, ManualEvent, Project, Segment } from './model';
import { defaultAutoMethod, defaultPrincess } from './model';
import { computePanel, type Edge } from './panel';
import { isCountSymbol, markerDelta } from './symbols';

export interface MarkerRef {
  panelId: Id;
  fromWaypoint: Id; // segment key (garment-lower waypoint)
  sizeId: Id;
  edge: Edge;
}

function findSegment(p: Project, ref: MarkerRef): { seg: Segment; created: boolean } | null {
  const panel = p.panels.find((x) => x.id === ref.panelId);
  if (!panel) return null;
  let seg = panel.segments.find((s) => s.fromWaypoint === ref.fromWaypoint);
  let created = false;
  if (!seg) {
    seg = { fromWaypoint: ref.fromWaypoint, left: defaultAutoMethod(), right: defaultAutoMethod(), mirror: true, manual: {} };
    panel.segments.push(seg);
    created = true;
  }
  return { seg, created };
}

/** The edge whose list is edited: with mirroring on, the right edge follows the left. */
export function editableEdge(seg: Pick<Segment, 'mirror'>, edge: Edge): Edge {
  return seg.mirror ? 'left' : edge;
}

/** Copy the computed events of this segment (both edges as needed) into manual markers for the size. */
export function materialise(p: Project, ref: MarkerRef): Project {
  const d = structuredClone(p);
  const found = findSegment(d, ref);
  if (!found) return p;
  const { seg } = found;
  const existing = seg.manual[ref.sizeId];
  const needLeft = !existing?.left;
  const needRight = !seg.mirror && !existing?.right;
  if (!needLeft && !needRight) return p;
  const panel = d.panels.find((x) => x.id === ref.panelId)!;
  const c = computePanel(d, panel, ref.sizeId);
  const cs = c.segments.find((s) => s.fromWaypoint === ref.fromWaypoint);
  if (!cs) return p;
  const toManual = (edge: Edge): ManualEvent[] =>
    cs[edge].events.map((e) => ({ row: e.row - cs.rowFrom + 1, delta: e.delta, symbol: e.symbol ?? (e.delta < 0 ? 'k2tog' : 'm1l') }));
  const m = { ...(existing ?? {}) };
  if (needLeft) m.left = toManual('left');
  if (needRight) m.right = toManual('right');
  seg.manual[ref.sizeId] = m;
  return d;
}

function editList(p: Project, ref: MarkerRef, fn: (list: ManualEvent[], rows: number) => void): Project {
  const m0 = materialise(p, ref);
  const d = m0 === p ? structuredClone(p) : m0;
  const found = findSegment(d, ref);
  if (!found) return p;
  const edge = editableEdge(found.seg, ref.edge);
  const m = (found.seg.manual[ref.sizeId] ??= {});
  const list = (m[edge] ??= []);
  fn(list, segmentRows(d, ref));
  list.sort((a, b) => a.row - b.row);
  return d;
}

/** Number of rows in the segment for this size (0 if it cannot be computed). */
export function segmentRows(p: Project, ref: MarkerRef): number {
  const panel = p.panels.find((x) => x.id === ref.panelId);
  if (!panel) return 0;
  const c = computePanel(p, panel, ref.sizeId);
  const cs = c.segments.find((s) => s.fromWaypoint === ref.fromWaypoint);
  return cs ? Math.max(0, cs.rowTo - cs.rowFrom + 1) : 0;
}

/**
 * Stitches one increase/decrease marker stands for in this segment: 1 at a side edge; at princess lines 2 (both
 * sides of the marker) or 1, plus 1 more when the edge is shaped too.
 */
export function shapingPoints(p: Project, ref: Pick<MarkerRef, 'panelId' | 'fromWaypoint'>): number {
  const panel = p.panels.find((x) => x.id === ref.panelId);
  const seg = panel?.segments.find((s) => s.fromWaypoint === ref.fromWaypoint);
  const placement = seg?.placement ?? 'edge';
  if (placement === 'edge') return 1;
  return ((panel!.princess ?? defaultPrincess()).sides === 'both' ? 2 : 1) + (placement === 'both' ? 1 : 0);
}

function deltaFor(p: Project, ref: MarkerRef, symbol: string, count: number): number {
  const d = markerDelta(symbol, count, p.symbols);
  return isCountSymbol(symbol) ? d : d * shapingPoints(p, ref);
}

const clampRow = (row: number, rows: number) => Math.max(1, Math.min(Math.max(1, rows), Math.round(row)));

/** Move the marker at `index` (in the editable edge's sorted list) to a segment row. Returns the new index too. */
export function moveMarker(p: Project, ref: MarkerRef, index: number, row: number): Project {
  return editList(p, ref, (list, rows) => {
    if (list[index]) list[index] = { ...list[index], row: clampRow(row, rows) };
  });
}

export function addMarker(p: Project, ref: MarkerRef, row: number, symbol: string, count = 1): Project {
  return editList(p, ref, (list, rows) => {
    list.push({ row: clampRow(row, rows), delta: deltaFor(p, ref, symbol, count), symbol });
  });
}

export function removeMarker(p: Project, ref: MarkerRef, index: number): Project {
  return editList(p, ref, (list) => {
    list.splice(index, 1);
  });
}

/** Change a marker's symbol (and count for bind-off / cast-on / turn markers). */
export function setMarkerSymbol(p: Project, ref: MarkerRef, index: number, symbol: string, count?: number): Project {
  return editList(p, ref, (list) => {
    const e = list[index];
    if (!e) return;
    const n = count ?? Math.max(1, Math.abs(e.delta));
    let delta = deltaFor(p, ref, symbol, n);
    // A one-sided princess marker (the odd stitch) stays one-sided when its stitch is changed.
    const full = isCountSymbol(e.symbol) ? 0 : Math.abs(deltaFor(p, ref, e.symbol, n));
    if (shapingPoints(p, ref) > 1 && !isCountSymbol(symbol) && full > 0 && Math.abs(e.delta) < full) delta = Math.sign(delta) * Math.min(Math.abs(e.delta), Math.abs(delta));
    list[index] = { ...e, symbol, delta };
  });
}

/** Drop manual markers for this size and edge(s): back to the auto-suggestion. */
export function resetMarkers(p: Project, ref: Omit<MarkerRef, 'edge'>): Project {
  const d = structuredClone(p);
  const panel = d.panels.find((x) => x.id === ref.panelId);
  const seg = panel?.segments.find((s) => s.fromWaypoint === ref.fromWaypoint);
  if (seg) delete seg.manual[ref.sizeId];
  return d;
}

/** Index in the editable list of the marker at a given absolute row (for selecting from the schematic). */
export function markerIndexAtRow(list: ManualEvent[], relRow: number): number {
  return list.findIndex((e) => e.row === relRow);
}
