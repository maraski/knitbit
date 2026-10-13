// Small helpers for immutable project edits: clone, mutate the copy, return it.

import type { Id, Panel, Project, Segment, Waypoint } from '../engine/model';
import { defaultAutoMethod } from '../engine/model';

export function produce<T>(value: T, fn: (draft: T) => void): T {
  const draft = structuredClone(value);
  fn(draft);
  return draft;
}

export function editPanel(p: Project, panelId: Id, fn: (panel: Panel) => void): Project {
  return produce(p, (d) => {
    const panel = d.panels.find((x) => x.id === panelId);
    if (panel) fn(panel);
  });
}

export function editWaypoint(p: Project, panelId: Id, wpId: Id, fn: (wp: Waypoint) => void): Project {
  return editPanel(p, panelId, (panel) => {
    const wp = panel.waypoints.find((w) => w.id === wpId);
    if (wp) fn(wp);
  });
}

/** Edit the stored segment starting at a waypoint, creating it (default auto) if it was implicit. */
export function editSegment(p: Project, panelId: Id, fromWaypoint: Id, fn: (seg: Segment) => void): Project {
  return editPanel(p, panelId, (panel) => {
    let seg = panel.segments.find((s) => s.fromWaypoint === fromWaypoint);
    if (!seg) {
      seg = { fromWaypoint, left: defaultAutoMethod(), right: defaultAutoMethod(), mirror: true, manual: {} };
      panel.segments.push(seg);
    }
    fn(seg);
  });
}
