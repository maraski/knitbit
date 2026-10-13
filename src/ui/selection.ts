import type { Id } from '../engine/model';
import type { Edge } from '../engine/panel';

export type Selection =
  | { kind: 'panel' }
  | { kind: 'waypoint'; id: Id }
  | { kind: 'segment'; fromWaypoint: Id; edge?: Edge; marker?: number } // marker: index in the edge's sorted events
  | { kind: 'neckline' }
  | { kind: 'bust' }
  | { kind: 'join'; id: Id }
  | { kind: 'line'; id: Id };

export const PANEL_SELECTION: Selection = { kind: 'panel' };

export function sameSelection(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'waypoint' && b.kind === 'waypoint') return a.id === b.id;
  if (a.kind === 'segment' && b.kind === 'segment') return a.fromWaypoint === b.fromWaypoint;
  if (a.kind === 'join' && b.kind === 'join') return a.id === b.id;
  if (a.kind === 'line' && b.kind === 'line') return a.id === b.id;
  return true;
}
