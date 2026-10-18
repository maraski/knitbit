// Garment layout: panels placed on one canvas at a shared scale (centimetres, y up), and size alignment.
// A panel's local frame: x in cm from its centre line, y in cm up from the garment's lower edge (upright).
// panel.layout {x, y, rotation} places that frame in the world: rotate (counter-clockwise) then translate.

import type { Id, Panel, Project } from './model';
import type { ComputedPanel, Point } from './panel';

export type Rotation = 0 | 90 | 180 | 270;

export interface Placement {
  x: number;
  y: number;
  rotation: Rotation;
}

/** Garment height (cm) of a knit row. */
export function garmentY(c: ComputedPanel, knitRow: number): number {
  return (c.topDown ? c.totalRows - knitRow : knitRow) / c.rowsPerCm;
}

/** Stitch/row point → local cm. */
export function toLocal(c: ComputedPanel, p: Point): Point {
  return { x: p.x / c.stitchesPerCm, y: garmentY(c, p.y) };
}

export function localOutline(c: ComputedPanel): Point[] {
  return c.outline.map((p) => toLocal(c, p));
}

export function rotate(p: Point, r: Rotation): Point {
  switch (r) {
    case 90:
      return { x: -p.y, y: p.x };
    case 180:
      return { x: -p.x, y: -p.y };
    case 270:
      return { x: p.y, y: -p.x };
    default:
      return { x: p.x, y: p.y };
  }
}

export function place(p: Point, at: Placement): Point {
  const r = rotate(p, at.rotation);
  return { x: r.x + at.x, y: r.y + at.y };
}

export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function bbox(points: Point[]): Box {
  if (!points.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

// ---------- aligning sizes ----------

export type AlignRef = 'hem' | 'waist' | 'underarm' | 'shoulder' | 'top';

/**
 * Garment height (cm) of a reference line in a computed panel: the lower edge, the top, or a waypoint by name
 * (falls back to the lower edge when the panel has no such waypoint).
 */
export function refHeight(c: ComputedPanel, ref: AlignRef): number {
  if (!c.ok) return 0;
  if (ref === 'hem') return 0;
  if (ref === 'top') return c.totalRows / c.rowsPerCm;
  const w = c.waypoints.find((x) => x.key === ref);
  return w ? garmentY(c, w.row) : 0;
}

/** Vertical shift (cm, local frame) that puts `c`'s reference line where `anchor`'s is. */
export function alignShift(c: ComputedPanel, anchor: ComputedPanel, ref: AlignRef): number {
  return refHeight(anchor, ref) - refHeight(c, ref);
}

// ---------- auto-arrange ----------

const GAP = 8; // cm between panels

function role(panel: Panel): 'back' | 'front' | 'sleeve' | 'band' | 'other' {
  const t = panel.template ?? '';
  if (panel.band) return 'band';
  if (t === 'back' || t === 'back-bodice') return 'back';
  if (t === 'front') return 'front';
  if (t.startsWith('sleeve')) return 'sleeve';
  const n = panel.name.toLowerCase();
  if (n.startsWith('back')) return 'back';
  if (n.startsWith('front')) return 'front';
  if (n.includes('sleeve')) return 'sleeve';
  return 'other';
}

/**
 * T-shape: back and front side by side on a common lower edge, a sleeve either side with its cap pointing
 * at the body at underarm height, everything else in a row underneath. Spacing uses `computed` (one size);
 * pass `allSizes` to leave room for every size, so overlays of several sizes don't collide.
 */
export function arrangeT(project: Project, computed: Map<Id, ComputedPanel>, allSizes?: Map<Id, ComputedPanel[]>): Record<Id, Placement> {
  const out: Record<Id, Placement> = {};
  const boxOf = (id: Id) => {
    const sets = allSizes?.get(id)?.filter((c) => c.ok) ?? [];
    return bbox((sets.length ? sets : [computed.get(id)!]).flatMap((c) => localOutline(c)));
  };
  const usable = project.panels.filter((p) => computed.get(p.id)?.ok);
  const bodies = [...usable.filter((p) => role(p) === 'back'), ...usable.filter((p) => role(p) === 'front')];
  const sleeves = usable.filter((p) => role(p) === 'sleeve');
  const bands = usable.filter((p) => role(p) === 'band');
  const others = usable.filter((p) => !bodies.includes(p) && !bands.includes(p) && !sleeves.slice(0, 2).includes(p));

  // Bodies in a row, lower edges on y = 0.
  let x = 0;
  let bodyLeft = 0;
  let bodyRight = 0;
  let underarm = 0;
  bodies.forEach((p, i) => {
    const b = boxOf(p.id);
    out[p.id] = { x: x - b.minX, y: -b.minY, rotation: 0 };
    if (i === 0) bodyLeft = x;
    x += b.maxX - b.minX + GAP;
    bodyRight = x - GAP;
    underarm = Math.max(underarm, refHeight(computed.get(p.id)!, 'underarm'));
  });
  if (!bodies.length) underarm = 0;

  // Cardigan bands stand upright beside the body, lower ends on y = 0 (a picked-up band turned a quarter turn).
  for (const p of bands) {
    const pts = (allSizes?.get(p.id)?.filter((c) => c.ok) ?? [computed.get(p.id)!]).flatMap((c) => localOutline(c));
    const flat = bbox(pts);
    const rotation: Rotation = flat.maxX - flat.minX > flat.maxY - flat.minY ? 90 : 0;
    const b = bbox(pts.map((q) => rotate(q, rotation)));
    out[p.id] = { x: x - b.minX, y: -b.minY, rotation };
    x += b.maxX - b.minX + GAP;
    bodyRight = x - GAP;
  }

  // Sleeves: left one rotated 270° (cap pointing right), right one 90° (cap pointing left), axis at underarm height.
  const [left, right] = sleeves;
  if (left) {
    const b = boxOf(left.id);
    const length = b.maxY - b.minY;
    out[left.id] = { x: bodyLeft - GAP - length - b.minY, y: underarm, rotation: 270 };
  }
  if (right) {
    const b = boxOf(right.id);
    const length = b.maxY - b.minY;
    out[right.id] = { x: bodyRight + GAP + length + b.minY, y: underarm, rotation: 90 };
  }

  // Everything else underneath, left to right.
  const others2 = [...others, ...sleeves.slice(2)];
  const rowTop = -GAP;
  let ox = bodyLeft;
  for (const p of others2) {
    const b = boxOf(p.id);
    out[p.id] = { x: ox - b.minX, y: rowTop - b.maxY, rotation: 0 };
    ox += b.maxX - b.minX + GAP;
  }
  return out;
}

/** True when no panel has been placed yet (all at the origin, unrotated). */
export function isUnarranged(project: Project): boolean {
  return project.panels.every((p) => p.layout.x === 0 && p.layout.y === 0 && p.layout.rotation === 0);
}

export function panelRole(panel: Panel) {
  return role(panel);
}
