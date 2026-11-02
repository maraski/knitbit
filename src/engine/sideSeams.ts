// Side seams that should mirror: the front's and the back's side edges are sewn (or knitted in the round) together,
// so their waist decreases and hip increases should match stitch for stitch. Back-weighted waists (waist_shift),
// different hem or waist widths, or hand edits break that; the bust width at the front's side seams above the waist
// (bust_side_w) and princess-line shaping are expected differences and not reported.

import { bustValues } from './bust';
import { buildScope } from './measurements';
import type { EdgeRef, Id, Panel, Project, WaistSplit } from './model';
import type { ComputedPanel, Edge, Issue } from './panel';
import { field, fixOf, type FieldRef, type IssueFix } from './issues';

export interface SideSeamCheck {
  panelId: Id;
  panelName: string;
  issue: Issue;
}

const isBodice = (p: Panel) => p.template === 'back' || p.template === 'front';

/** The estimate older projects were seeded with: removed when the project switches to the choice. */
export const OLD_WAIST_SHIFT = '(bust - waist) / 4';

/** The project's own `waist_shift` measurement, if any (it wins over the Fit choice). */
export function ownWaistShift(project: Project) {
  return project.measurements.find((m) => m.name === 'waist_shift');
}

/** Whether the project's waist_shift measurement is the untouched old estimate (safe to remove). */
export function isOldWaistShift(project: Project): boolean {
  const m = ownWaistShift(project);
  return !!m && m.rule.type === 'expression' && m.rule.expr.replace(/\s/g, '') === OLD_WAIST_SHIFT.replace(/\s/g, '') && !Object.keys(m.manual).length && !Object.keys(m.table).length;
}

/** Set the Fit choice; an old seeded waist_shift estimate goes so the choice applies (a hand-edited one stays). */
export function setWaistSplit(project: Project, split: WaistSplit): Project {
  const measurements = isOldWaistShift(project) ? project.measurements.filter((m) => m.name !== 'waist_shift') : project.measurements;
  return { ...project, fit: { ...project.fit, waistSplit: split }, measurements };
}

/** One edge's increases and decreases (sts, going up the garment) below and above the waist, and their rows (counted up from the edge's lower end). */
export interface EdgeShaping {
  below: number;
  above: number;
  rowsBelow: number[];
  rowsAbove: number[];
  princess: boolean;
}

function edgeShaping(c: ComputedPanel, side: Edge, fromId: Id, toId: Id): EdgeShaping | null {
  const a = c.waypoints.find((w) => w.id === fromId);
  const b = c.waypoints.find((w) => w.id === toId);
  if (!a || !b) return null;
  const r0 = Math.min(a.row, b.row);
  const r1 = Math.max(a.row, b.row);
  const waist = c.waypoints.find((w) => w.name === 'waist' && w.row >= r0 && w.row <= r1);
  const out: EdgeShaping = { below: 0, above: 0, rowsBelow: [], rowsAbove: [], princess: false };
  for (const seg of c.segments) {
    if (seg.rowTo <= r0 || seg.rowFrom > r1) continue;
    for (const ev of seg[side].events) {
      if (ev.row <= r0 || ev.row > r1 || (ev.kind !== 'inc' && ev.kind !== 'dec')) continue;
      if (seg.placement !== 'edge') out.princess = true;
      const up = c.topDown ? -ev.delta : ev.delta;
      // Bottom-up the waist row's own change is below it; top-down the change made on it is above it.
      const below = !waist ? true : c.topDown ? ev.row > waist.row : ev.row <= waist.row;
      const row = c.topDown ? r1 - ev.row : ev.row - r0;
      if (below) {
        out.below += up;
        out.rowsBelow.push(row);
      } else {
        out.above += up;
        out.rowsAbove.push(row);
      }
    }
  }
  out.rowsBelow.sort((x, y) => x - y);
  out.rowsAbove.sort((x, y) => x - y);
  return out;
}

const changeText = (n: number) => (n === 0 ? 'no shaping' : `${n > 0 ? '+' : '−'}${Math.abs(n)} sts`);

export interface Pair {
  name: string;
  ref: Issue['ref'];
  a: { panel: Panel; side: Edge; from: Id; to: Id };
  b: { panel: Panel; side: Edge; from: Id; to: Id };
}

/** The side-seam edge pairs: seam joins between one side edge of a front and one of a back, and joined-in-the-round bodices. */
function pairs(project: Project): Pair[] {
  const byId = new Map(project.panels.map((p) => [p.id, p]));
  const out: Pair[] = [];
  const covered = new Set<Id>();
  for (const j of project.joins ?? []) {
    if (j.tag !== 'seam' || j.edges.length !== 1 || j.partner.length !== 1) continue;
    const sideOf = (r: EdgeRef) => {
      const p = byId.get(r.panelId);
      return p && r.edge.kind === 'side' && isBodice(p) ? { panel: p, side: r.edge.side, from: r.edge.from, to: r.edge.to } : null;
    };
    const a = sideOf(j.edges[0]);
    const b = sideOf(j.partner[0]);
    if (!a || !b || a.panel.template === b.panel.template) continue;
    out.push({ name: j.name, ref: { kind: 'join', id: j.id }, a, b });
    covered.add(a.panel.id).add(b.panel.id);
  }
  // Knitted together below the underarm (top-down bodies): the back's edges meet the front's (each cardigan half's side edge).
  const body = project.panels.filter((p) => !covered.has(p.id) && isBodice(p));
  const back = body.find((p) => p.template === 'back');
  const fronts = body.filter((p) => p.template === 'front');
  const span = (p: Panel) => {
    const hem = p.waypoints.find((w) => w.name === 'hem');
    const ua = p.waypoints.find((w) => w.name === 'underarm');
    return hem && ua ? { from: hem.id, to: ua.id } : null;
  };
  const bs = back && span(back);
  if (back && bs) {
    for (const f of fronts) {
      const fs = span(f);
      if (!fs) continue;
      // As seen from the RS the front's right edge meets the back's left edge; a cardigan half has one side edge.
      const sides: Edge[] = f.half ? [f.half.side === 'left' ? 'right' : 'left'] : ['right', 'left'];
      for (const s of sides) {
        out.push({ name: `${s === 'right' ? 'Left' : 'Right'} side (${f.name} and ${back.name})`, ref: { kind: 'panel' }, a: { panel: f, side: s, ...fs }, b: { panel: back, side: s === 'right' ? 'left' : 'right', ...bs } });
      }
    }
  }
  return out;
}

export interface SideSeamShaping {
  pair: Pair;
  a: EdgeShaping;
  b: EdgeShaping;
  /** Either side is a front taking the bust width at its side seams (above the waist). */
  bustSide: boolean;
}

/** Each side seam's two edges, shaped, in one size (pairs whose panels can't be computed are left out). */
export function sideSeamShapings(project: Project, sizeId: Id, compute: (p: Panel) => ComputedPanel | null, scope = buildScope(project, sizeId)): SideSeamShaping[] {
  const bustSide = (p: Panel) => p.template === 'front' && (bustValues(p, sizeId, scope).bust_side_w ?? 0) > 0;
  return pairs(project).flatMap((pair) => {
    const ca = compute(pair.a.panel);
    const cb = compute(pair.b.panel);
    const a = ca?.ok && edgeShaping(ca, pair.a.side, pair.a.from, pair.a.to);
    const b = cb?.ok && edgeShaping(cb, pair.b.side, pair.b.from, pair.b.to);
    return a && b ? [{ pair, a, b, bustSide: bustSide(pair.a.panel) || bustSide(pair.b.panel) }] : [];
  });
}

const same = (x: number[], y: number[]) => x.length === y.length && x.every((v, i) => v === y[i]);

/** Waist split hints and mismatched side seams, for one size. */
export function sideSeamChecks(project: Project, sizeId: Id, compute: (p: Panel) => ComputedPanel | null): SideSeamCheck[] {
  const out: SideSeamCheck[] = [];
  const bodices = project.panels.filter(isBodice);
  if (!bodices.length) return out;
  const scope = buildScope(project, sizeId);
  const shift = scope.waist_shift ?? 0;
  const own = ownWaistShift(project);
  const chosen = project.fit.waistSplit;
  const evenFix = (): IssueFix | null => {
    if (Math.abs(shift) < 1e-9) return null;
    const fields: FieldRef[] = [field.settings('waistSplit')];
    if (own) fields.push(field.measurement('waist_shift'));
    const text = own && !isOldWaistShift(project)
      ? `Your waist_shift measurement moves ${shift.toFixed(1)} cm of waist from the back to the front: set it to 0 (Measurements) for mirrored side seams.`
      : `Use an even waist split (Settings → Fit → Waist split), so the front and back narrow alike and their side seams mirror${own ? ' (removes the old waist_shift estimate)' : ''}.`;
    return fixOf(text, fields, { now: `waist_shift ${shift.toFixed(1)} cm`, need: '0', ...(!own || isOldWaistShift(project) ? { apply: { field: field.settings('waistSplit'), value: 0, unit: '' as const, label: 'Even waist split' } } : {}) });
  };

  for (const { pair: pr, a: ea, b: eb, bustSide } of sideSeamShapings(project, sizeId, compute, scope)) {
    if (ea.princess || eb.princess) continue;
    const parts: string[] = [];
    const sameDir = pr.a.panel.direction === pr.b.panel.direction;
    const part = (where: string, x: number, y: number, rx: number[], ry: number[]) => {
      if (x !== y) parts.push(`${where} ${pr.a.panel.name} ${changeText(x)}, ${pr.b.panel.name} ${changeText(y)}`);
      else if (sameDir && !same(rx, ry)) parts.push(`${where} on different rows`);
    };
    part('hem to waist', ea.below, eb.below, ea.rowsBelow, eb.rowsBelow);
    // The bust width at the front's side seams is added between the waist and the underarm only.
    if (!bustSide) part('waist to underarm', ea.above, eb.above, ea.rowsAbove, eb.rowsAbove);
    if (!parts.length) continue;
    const wp = (p: Panel, n: string) => p.waypoints.find((w) => w.name === n);
    const widthFields = [pr.a.panel, pr.b.panel].flatMap((p) => ['hem', 'waist', 'underarm'].flatMap((n) => {
      const w = wp(p, n);
      return w ? [{ ...field.waypoint(w.id, n, w.symmetric ? 'width' : 'left'), panelId: p.id, label: `${p.name}: ${n} width` }] : [];
    }));
    const usesShift = [pr.a.panel, pr.b.panel].some((p) => {
      const w = wp(p, 'waist');
      return !!w && (w.symmetric ? w.width.expr : `${w.left.expr} ${w.right.expr}`).includes('waist_shift');
    });
    // Yoke bodies made before the yoke's front/back split was carried down to the hem: the underarm widths differ.
    const [front, back] = pr.a.panel.template === 'front' ? [pr.a.panel, pr.b.panel] : [pr.b.panel, pr.a.panel];
    const carried = [front, back].some((p) => {
      const w = wp(p, 'hem');
      return !!w && (w.symmetric ? w.width.expr : w.left.expr).includes('yoke.');
    });
    const yokeFix =
      front.fromYoke && back.fromYoke && !carried
        ? fixOf(
            `The yoke splits ${front.name} and ${back.name} unevenly at the underarm: carry the difference down, as new garments do. Add + (yoke.front_w - yoke.back_w) / 2 to the ${front.name}'s hem and waist widths, and + (yoke.back_w - yoke.front_w) / 2 to the ${back.name}'s.`,
            widthFields.filter((f) => !f.label.endsWith('underarm width')),
          )
        : null;
    const fix = (usesShift && evenFix()) || yokeFix || fixOf(`Make the ${pr.a.panel.name} and ${pr.b.panel.name} widths match at the hem, waist and underarm (each edge then shapes alike), or shape at princess lines (Shaping → Shape at).`, widthFields);
    out.push({
      panelId: pr.a.panel.id,
      panelName: pr.a.panel.name,
      issue: {
        // A back-weighted split chosen on purpose is a choice: noted, not warned about.
        severity: chosen === 'back' && !own ? 'info' : 'warning',
        code: 'join.side-shaping',
        message: `${pr.name}: the side seams don't mirror (${parts.join('; ')} at this edge).`,
        ref: pr.ref,
        fix,
      },
    });
  }

  // Princess-line waist shaping usually wants more shaping at the back.
  if (Math.abs(shift) < 1e-9 && !own) {
    for (const p of bodices) {
      const c = compute(p);
      if (!c?.ok) continue;
      const ua = c.waypoints.find((w) => w.name === 'underarm');
      const princess = c.segments.some((s) => s.placement !== 'edge' && (!ua || (c.topDown ? s.rowFrom >= ua.row : s.rowTo <= ua.row)));
      if (!princess) continue;
      out.push({
        panelId: p.id,
        panelName: p.name,
        issue: {
          severity: 'info',
          code: 'fit.waist-split-princess',
          message: `${p.name} shapes the waist at princess lines with an even waist split; a back-weighted split (Settings → Fit) takes more of the narrowing at the back.`,
          ref: { kind: 'panel' },
          fix: fixOf('Choose Back-weighted under Settings → Fit → Waist split, or keep even.', [field.settings('waistSplit')], { apply: { field: field.settings('waistSplit'), value: 1, unit: '', label: 'Back-weighted waist split' } }),
        },
      });
    }
  }
  return out;
}
