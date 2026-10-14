// Where a panel runs from one body region into another (e.g. lower body → upper body at the waist) in a size whose
// regions follow different sizes. The shaping itself is ordinary waypoint shaping: the waypoint widths come from
// different sizes' measurements, so the segment between them increases or decreases the difference. This module
// finds those segments so the schematic can label them.

import { parseExpression, references } from './expr';
import { fitAliases } from './fit';
import type { BodyRegion, Id, Panel, Project } from './model';
import { waypointKey as key, type ComputedPanel } from './panel';
import { REGIONS, regionOf, regionSources } from './regions';

function refs(expr: string): string[] {
  const r = parseExpression(expr);
  return r.ok ? references(r.value) : [];
}

/**
 * The regions a waypoint's width comes from. Measurements are taken at their region; fit names at their column's
 * region; other waypoints' widths through their own regions. Formula measurements (estimates such as waist_shift)
 * only count when nothing else in the expression has a region, so `waist / 2 − waist_shift` is lower body.
 */
export function waypointRegions(project: Project, panel: Panel): Map<Id, Set<BodyRegion>> {
  const aliases = fitAliases(project);
  const byName = new Map(project.measurements.map((m) => [m.name, m]));
  const wpByKey = new Map(panel.waypoints.map((w) => [key(w.name), w]));
  const memo = new Map<Id, Set<BodyRegion>>();

  const measurementRegions = (name: string, seen: Set<string>): { direct: Set<BodyRegion>; derived: Set<BodyRegion> } => {
    const out = { direct: new Set<BodyRegion>(), derived: new Set<BodyRegion>() };
    if (seen.has(name)) return out;
    seen.add(name);
    const target = aliases[name] ?? name;
    const m = byName.get(target);
    if (!m) return out;
    if (m.rule.type === 'expression' && !m.region && !Object.keys(m.table).length) {
      for (const n of refs(m.rule.expr)) {
        const r = measurementRegions(n, seen);
        for (const x of [...r.direct, ...r.derived]) out.derived.add(x);
      }
    } else out.direct.add(regionOf(m));
    return out;
  };

  const ofWaypoint = (id: Id, stack: Set<Id>): Set<BodyRegion> => {
    const hit = memo.get(id);
    if (hit) return hit;
    const w = panel.waypoints.find((x) => x.id === id);
    if (!w || stack.has(id)) return new Set();
    stack.add(id);
    const direct = new Set<BodyRegion>();
    const derived = new Set<BodyRegion>();
    const exprs = w.symmetric ? [w.width.expr] : [w.left.expr, w.right.expr];
    for (const e of exprs) {
      for (const n of refs(e)) {
        const dot = n.indexOf('.');
        if (dot > 0 && wpByKey.has(n.slice(0, dot)) && n.slice(dot + 1) === 'width') {
          for (const r of ofWaypoint(wpByKey.get(n.slice(0, dot))!.id, stack)) direct.add(r);
          continue;
        }
        const r = measurementRegions(n, new Set());
        r.direct.forEach((x) => direct.add(x));
        r.derived.forEach((x) => derived.add(x));
      }
    }
    stack.delete(id);
    const out = direct.size ? direct : derived;
    memo.set(id, out);
    return out;
  };

  for (const w of panel.waypoints) ofWaypoint(w.id, new Set());
  return memo;
}

export interface RegionTransition {
  lower: { waypointId: Id; name: string; row: number; regions: BodyRegion[]; sizes: string };
  upper: { waypointId: Id; name: string; row: number; regions: BodyRegion[]; sizes: string };
  /** Stitch change per side going up the garment, from the lower waypoint to the upper one. */
  perSideUp: number;
  label: string;
}

const regionName = (r: BodyRegion) => REGIONS.find((x) => x.id === r)!.label.toLowerCase();

/** Segments of a computed panel that run between regions taking their measurements from different sizes. */
export function regionTransitions(project: Project, panel: Panel, c: ComputedPanel): RegionTransition[] {
  if (!c.ok) return [];
  const src = regionSources(project, c.sizeId);
  if (REGIONS.every((r) => src[r.id] === c.sizeId)) return [];
  const sizeName = (id: Id) => project.sizes.find((s) => s.id === id)?.name ?? '?';
  const regions = waypointRegions(project, panel);
  const describe = (rs: Set<BodyRegion>) => {
    const list = REGIONS.map((r) => r.id).filter((r) => rs.has(r));
    return { regions: list, sizes: list.map((r) => `${regionName(r)} ${sizeName(src[r])}`).join(' + '), sources: new Set(list.map((r) => src[r])) };
  };
  // Up the garment (top-down panels count rows and heights from the top).
  const up = (r: number) => (c.topDown ? c.totalRows - r : r);
  const ordered = [...c.waypoints].sort((a, b) => up(a.row) - up(b.row));
  const out: RegionTransition[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const lo = ordered[i - 1];
    const hi = ordered[i];
    const a = describe(regions.get(lo.id) ?? new Set());
    const b = describe(regions.get(hi.id) ?? new Set());
    if (!a.regions.length || !b.regions.length) continue;
    const same = a.sources.size === b.sources.size && [...a.sources].every((x) => b.sources.has(x));
    if (same) continue;
    const perSideUp = (hi.stitches - lo.stitches) / 2;
    const n = Math.abs(perSideUp);
    // In knitting order: bottom-up works lower → upper, top-down upper → lower.
    const worked = c.topDown ? -perSideUp : perSideUp;
    const verb = worked > 0 ? 'increase' : worked < 0 ? 'decrease' : 'no change,';
    const amount = n === 0 ? 'same stitch count' : `${n % 1 ? n.toFixed(1) : n} st${n === 1 ? '' : 's'} each side`;
    const route = c.topDown ? `${b.sizes} → ${a.sizes}` : `${a.sizes} → ${b.sizes}`;
    out.push({
      lower: { waypointId: lo.id, name: lo.name, row: lo.row, regions: a.regions, sizes: a.sizes },
      upper: { waypointId: hi.id, name: hi.name, row: hi.row, regions: b.regions, sizes: b.sizes },
      perSideUp,
      label: `${route}: ${verb} ${amount}`.replace('no change, same stitch count', 'same stitch count'),
    });
  }
  return out;
}
