// Moving waypoints by dragging, proportionally across sizes, and linked panels (e.g. back ↔ front).
//
// Height: rewritten as a fraction of the way between the waypoints below and above it,
//   `lo.height + (hi.height - lo.height) * t`, so it keeps its relative place in every size.
// Width: the expression is scaled by a factor, `(expr) * f`, so every size changes by the same proportion.
// "This size only" sets a per-size fixed value instead. Pure: returns a new project.

import type { Id, Panel, Project, Waypoint } from './model';
import { resolvePanelDims, waypointKey } from './panel';

export type WidthPart = 'width' | 'left' | 'right';
export type DragMode = 'all' | 'size';

const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Resolved values (cm) of a panel's waypoint expressions for one size, per-size fixed values included. */
function values(project: Project, panel: Panel, sizeId: Id): Record<string, number> {
  return resolvePanelDims(project, panel, sizeId).values;
}

/** Same, ignoring this size's fixed value on one dimension (what the expression alone gives). */
function exprValue(project: Project, panel: Panel, wp: Waypoint, part: 'height' | WidthPart, sizeId: Id): number | undefined {
  const p = structuredClone(panel);
  const w = p.waypoints.find((x) => x.id === wp.id)!;
  delete w[part].overrides[sizeId];
  return values(project, p, sizeId)[`${waypointKey(wp.name)}.${part}`];
}

function withPanel(project: Project, panel: Panel): Project {
  return { ...project, panels: project.panels.map((p) => (p.id === panel.id ? panel : p)) };
}

/** Whether the panel's waypoint expressions still resolve for this size (no cycles, no unknown names). */
function resolves(project: Project, panel: Panel, sizeId: Id): boolean {
  return Object.keys(resolvePanelDims(project, panel, sizeId).errors).length === 0;
}

/**
 * Put a waypoint at garment height `h` (cm, as its expression measures) in `sizeId`.
 * 'all': a proportional expression between the nearest neighbours it can reference without a cycle;
 * the top or bottom waypoint keeps a fixed distance from its neighbour. 'size': a fixed value for this size.
 */
export function placeHeight(project: Project, panel: Panel, wpId: Id, sizeId: Id, h: number, mode: DragMode): Panel {
  const p = structuredClone(panel);
  const wp = p.waypoints.find((w) => w.id === wpId);
  if (!wp) return panel;
  if (mode === 'size') {
    wp.height = { ...wp.height, overrides: { ...wp.height.overrides, [sizeId]: r4(h) } };
    return p;
  }
  const vals = values(project, panel, sizeId);
  const others = p.waypoints
    .filter((w) => w.id !== wpId)
    .map((w) => ({ key: waypointKey(w.name), h: vals[`${waypointKey(w.name)}.height`] }))
    .filter((w) => Number.isFinite(w.h));
  const below = others.filter((w) => w.h <= h + 1e-9).sort((a, b) => b.h - a.h);
  const above = others.filter((w) => w.h > h + 1e-9).sort((a, b) => a.h - b.h);
  const overrides = { ...wp.height.overrides };
  delete overrides[sizeId];
  const tryExpr = (expr: string) => {
    const old = wp.height;
    wp.height = { expr, overrides };
    if (resolves(project, p, sizeId)) return true;
    wp.height = old;
    return false;
  };
  for (const lo of below) {
    for (const hi of above) {
      if (hi.h - lo.h < 1e-6) continue;
      const t = r4((h - lo.h) / (hi.h - lo.h));
      if (tryExpr(`${lo.key}.height + (${hi.key}.height - ${lo.key}.height) * ${t}`)) return p;
    }
  }
  for (const lo of below) {
    const d = r4(h - lo.h);
    if (tryExpr(`${lo.key}.height + ${d}`)) return p;
  }
  for (const hi of above) {
    const d = r4(hi.h - h);
    if (tryExpr(`${hi.key}.height - ${d}`)) return p;
  }
  tryExpr(String(r4(h)));
  return p;
}

/** Scale an expression by a factor, folding repeated scaling into one factor: `(expr) * f`. */
export function scaleExpr(expr: string, f: number): string {
  const m = /^\((.*)\) \* (-?[0-9.]+)$/.exec(expr.trim());
  if (m) {
    const g = r4(Number(m[2]) * f);
    return Math.abs(g - 1) < 1e-4 ? m[1] : `(${m[1]}) * ${g}`;
  }
  const g = r4(f);
  return Math.abs(g - 1) < 1e-4 ? expr : `(${expr}) * ${g}`;
}

/** Set a waypoint's width (or one half) to `value` cm in `sizeId`: proportionally in every size, or this size only. */
export function placeWidth(project: Project, panel: Panel, wpId: Id, sizeId: Id, part: WidthPart, value: number, mode: DragMode): Panel {
  const p = structuredClone(panel);
  const wp = p.waypoints.find((w) => w.id === wpId);
  if (!wp || value <= 0) return panel;
  if (mode === 'size') {
    wp[part] = { ...wp[part], overrides: { ...wp[part].overrides, [sizeId]: r4(value) } };
    return p;
  }
  const e = exprValue(project, panel, wp, part, sizeId);
  if (!e || e <= 0) return panel;
  const overrides = { ...wp[part].overrides };
  delete overrides[sizeId];
  wp[part] = { expr: scaleExpr(wp[part].expr, value / e), overrides };
  return p;
}

// ---------- linked panels ----------

export function partnerOf(project: Project, panel: Panel): Panel | undefined {
  return panel.linkedTo ? project.panels.find((p) => p.id === panel.linkedTo && p.id !== panel.id) : undefined;
}

/** Link two panels (each to the other), unlinking their previous partners. `b` null unlinks `a`. */
export function linkPanels(project: Project, a: Id, b: Id | null): Project {
  const d = structuredClone(project);
  const pa = d.panels.find((p) => p.id === a);
  if (!pa) return project;
  for (const p of d.panels) if (p.linkedTo === a || (b && p.linkedTo === b)) p.linkedTo = null;
  const pb = b ? d.panels.find((p) => p.id === b) : undefined;
  if (pb?.linkedTo) {
    const old = d.panels.find((p) => p.id === pb.linkedTo);
    if (old) old.linkedTo = null;
  }
  if (pa.linkedTo) {
    const old = d.panels.find((p) => p.id === pa.linkedTo);
    if (old) old.linkedTo = null;
  }
  pa.linkedTo = pb ? pb.id : null;
  if (pb) pb.linkedTo = pa.id;
  return d;
}

/** The partner's waypoint with the same name, if the panel is linked and the partner has one. */
export function partnerWaypoint(project: Project, panel: Panel, wpId: Id): { partner: Panel; wp: Waypoint } | undefined {
  const partner = partnerOf(project, panel);
  const wp = panel.waypoints.find((w) => w.id === wpId);
  if (!partner || !wp) return undefined;
  const pw = partner.waypoints.find((w) => waypointKey(w.name) === waypointKey(wp.name));
  return pw ? { partner, wp: pw } : undefined;
}

/**
 * Sizes that should not follow a drag keep their values: every waypoint dimension whose expression the drag changed
 * gets a per-size fixed value (its value before the drag) in those sizes, unless it already has one.
 */
function pinSizes(before: Project, after: Project, panelIds: Id[], keep: Id[]): Project {
  if (!keep.length) return after;
  let out = after;
  for (const pid of panelIds) {
    const was = before.panels.find((p) => p.id === pid);
    const now = out.panels.find((p) => p.id === pid);
    if (!was || !now) continue;
    const next = structuredClone(now);
    let changed = false;
    for (const w of next.waypoints) {
      const old = was.waypoints.find((x) => x.id === w.id);
      if (!old) continue;
      for (const part of ['height', 'width', 'left', 'right'] as const) {
        if (old[part].expr === w[part].expr) continue;
        for (const sid of keep) {
          if (sid in w[part].overrides) continue;
          const v = values(before, was, sid)[`${waypointKey(w.name)}.${part}`];
          if (Number.isFinite(v)) {
            w[part].overrides = { ...w[part].overrides, [sid]: r4(v) };
            changed = true;
          }
        }
      }
    }
    if (changed) out = withPanel(out, next);
  }
  return out;
}

/** Sizes a drag must leave alone: every size except the dragged one that isn't in `cascade` (undefined = all follow). */
function notCascaded(project: Project, sizeId: Id, cascade: Id[] | undefined): Id[] {
  return cascade ? project.sizes.map((s) => s.id).filter((id) => id !== sizeId && !cascade.includes(id)) : [];
}

const heightOf = (project: Project, panel: Panel, wp: Waypoint, sizeId: Id) => values(project, panel, sizeId)[`${waypointKey(wp.name)}.height`];
const widthOf = (project: Project, panel: Panel, wp: Waypoint, part: WidthPart, sizeId: Id) => values(project, panel, sizeId)[`${waypointKey(wp.name)}.${part}`];

/**
 * Drag a waypoint's height. A linked partner's waypoint of the same name moves by the same amount (in this size,
 * then proportionally in the others). `cascade`: the other sizes that follow the drag (undefined = all); the rest keep
 * their values.
 */
export function dragHeight(project: Project, panelId: Id, wpId: Id, sizeId: Id, h: number, mode: DragMode, cascade?: Id[]): Project {
  const panel = project.panels.find((p) => p.id === panelId);
  const wp = panel?.waypoints.find((w) => w.id === wpId);
  if (!panel || !wp) return project;
  const before = heightOf(project, panel, wp, sizeId);
  let out = withPanel(project, placeHeight(project, panel, wpId, sizeId, h, mode));
  const pw = partnerWaypoint(project, panel, wpId);
  if (pw && Number.isFinite(before)) {
    const ph = heightOf(project, pw.partner, pw.wp, sizeId);
    if (Number.isFinite(ph)) out = withPanel(out, placeHeight(out, pw.partner, pw.wp.id, sizeId, ph + (h - before), mode));
  }
  return mode === 'all' ? pinSizes(project, out, [panelId, ...(pw ? [pw.partner.id] : [])], notCascaded(project, sizeId, cascade)) : out;
}

/** Drag a waypoint's width (or half). A linked partner's waypoint changes by the same proportion. `cascade`: as dragHeight. */
export function dragWidth(project: Project, panelId: Id, wpId: Id, sizeId: Id, part: WidthPart, value: number, mode: DragMode, cascade?: Id[]): Project {
  const panel = project.panels.find((p) => p.id === panelId);
  const wp = panel?.waypoints.find((w) => w.id === wpId);
  if (!panel || !wp) return project;
  const before = widthOf(project, panel, wp, part, sizeId);
  let out = withPanel(project, placeWidth(project, panel, wpId, sizeId, part, value, mode));
  const pw = partnerWaypoint(project, panel, wpId);
  if (pw && before > 0) {
    const f = value / before;
    // Same proportion on the partner: its whole width, the same half, or both halves.
    const parts: WidthPart[] = pw.wp.symmetric ? ['width'] : part === 'width' ? ['left', 'right'] : [part];
    for (const pp of parts) {
      const cur = out.panels.find((p) => p.id === pw.partner.id)!;
      const pv = widthOf(out, cur, pw.wp, pp, sizeId);
      if (pv > 0) out = withPanel(out, placeWidth(out, cur, pw.wp.id, sizeId, pp, pv * f, mode));
    }
  }
  return mode === 'all' ? pinSizes(project, out, [panelId, ...(pw ? [pw.partner.id] : [])], notCascaded(project, sizeId, cascade)) : out;
}

/** Make the partner's waypoint match this one (height and/or width), proportionally in every size. */
export function matchPartner(project: Project, panelId: Id, wpId: Id, sizeId: Id, what: { height: boolean; width: boolean }): Project {
  const panel = project.panels.find((p) => p.id === panelId);
  const wp = panel?.waypoints.find((w) => w.id === wpId);
  const pw = panel ? partnerWaypoint(project, panel, wpId) : undefined;
  if (!panel || !wp || !pw) return project;
  let out = project;
  if (what.height) {
    const h = heightOf(project, panel, wp, sizeId);
    if (Number.isFinite(h)) out = withPanel(out, placeHeight(out, pw.partner, pw.wp.id, sizeId, h, 'all'));
  }
  if (what.width) {
    const partner = out.panels.find((p) => p.id === pw.partner.id)!;
    if (wp.symmetric && pw.wp.symmetric) {
      const v = widthOf(project, panel, wp, 'width', sizeId);
      if (v > 0) out = withPanel(out, placeWidth(out, partner, pw.wp.id, sizeId, 'width', v, 'all'));
    } else {
      for (const part of ['left', 'right'] as const) {
        const v = wp.symmetric ? widthOf(project, panel, wp, 'width', sizeId) / 2 : widthOf(project, panel, wp, part, sizeId);
        const cur = out.panels.find((p) => p.id === pw.partner.id)!;
        if (v > 0 && !pw.wp.symmetric) out = withPanel(out, placeWidth(out, cur, pw.wp.id, sizeId, part, v, 'all'));
      }
    }
  }
  return out;
}
