// UI glue for marker editing: turns schematic / table gestures into undoable project edits.

import { addMarker, moveMarker, removeMarker, resetMarkers, setMarkerSymbol, type MarkerRef } from '../engine/manual';
import type { Id, Project } from '../engine/model';
import type { ComputedSegment, Edge } from '../engine/panel';
import { defaultSymbol } from '../engine/symbols';

type Update = (fn: (p: Project) => Project, key?: string | null) => void;

export interface MarkerActions {
  move: (fromWaypoint: Id, edge: Edge, index: number, relRow: number, dragKey?: string) => void;
  add: (seg: ComputedSegment, edge: Edge, relRow: number) => void;
  remove: (fromWaypoint: Id, edge: Edge, index: number) => void;
  setSymbol: (fromWaypoint: Id, edge: Edge, index: number, symbol: string, count?: number) => void;
  reset: (fromWaypoint: Id) => void;
}

export function markerActions(update: Update, panelId: Id, sizeId: Id): MarkerActions {
  const ref = (fromWaypoint: Id, edge: Edge): MarkerRef => ({ panelId, fromWaypoint, sizeId, edge });
  return {
    move: (fw, edge, index, relRow, dragKey) => update((p) => moveMarker(p, ref(fw, edge), index, relRow), dragKey ?? `marker.${fw}.${edge}.${index}.row`),
    add: (seg, edge, relRow) => {
      const shaping = seg[edge];
      const kind =
        shaping.method === 'steps' ? (shaping.target > 0 ? 'caston' : 'bindoff') : shaping.method === 'shortrows' ? 'turn' : shaping.target > 0 ? 'inc' : 'dec';
      const symbol = defaultSymbol(kind, edge);
      update((p) => addMarker(p, ref(seg.fromWaypoint, edge), relRow, symbol, kind === 'dec' || kind === 'inc' ? 1 : 2));
    },
    remove: (fw, edge, index) => update((p) => removeMarker(p, ref(fw, edge), index)),
    setSymbol: (fw, edge, index, symbol, count) => update((p) => setMarkerSymbol(p, ref(fw, edge), index, symbol, count), count !== undefined ? `marker.${fw}.${edge}.${index}.count` : null),
    reset: (fw) => update((p) => resetMarkers(p, { panelId, fromWaypoint: fw, sizeId })),
  };
}
