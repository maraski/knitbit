// Rectangle panels: bottom width, top width and height set as a rule — fixed for all sizes, graded from a
// measurement (measurement × fraction ± ease), the same as the bottom (top width only) or a custom expression.
// Rules are stored as ordinary dimension expressions and read back from them, so nothing new is saved.
// Pure: edits return a new project.

import { evaluate, parseExpression, references } from './expr';
import { defaultAutoMethod, dim, type DimExpr, type Id, type Panel, type Project, type SegmentMethod, type Waypoint } from './model';
import { waypointKey } from './panel';
import { CM_PER_INCH, type Units } from './units';

export type RectDim = 'bottom' | 'top' | 'height';

export type SizeRule =
  | { mode: 'fixed'; value: number } // cm, every size
  | { mode: 'measure'; measurement: string; fraction: number; ease: number } // ease in cm
  | { mode: 'same' } // top width: whatever the bottom is
  | { mode: 'custom'; expr: string };

/** A panel the size block applies to: the plain rectangle template, still two symmetric waypoints. */
export function isRectangle(panel: Panel): boolean {
  return panel.template === 'rectangle' && panel.waypoints.length === 2 && panel.waypoints.every((w) => w.symmetric) && !panel.yoke && !panel.half;
}

/** Bottom and top waypoints (heights are measured up from the lower edge, so the first is the bottom). */
export function rectWaypoints(panel: Panel): { bottom: Waypoint; top: Waypoint } {
  return { bottom: panel.waypoints[0], top: panel.waypoints[1] };
}

function rectDimOf(panel: Panel, which: RectDim): DimExpr {
  const { bottom, top } = rectWaypoints(panel);
  return which === 'bottom' ? bottom.width : which === 'top' ? top.width : top.height;
}

// ---------- reading ----------

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const MEASURE_RE = new RegExp(String.raw`^([A-Za-z_][A-Za-z0-9_]*)\s*(?:([*/])\s*${NUM})?\s*(?:([+-])\s*${NUM}\s*(in|cm|mm|")?)?$`);
const UNIT_CM: Record<string, number> = { cm: 1, mm: 0.1, in: CM_PER_INCH, '"': CM_PER_INCH };

/** Which rule an expression is. Anything not in one of the simple forms is a custom expression. */
export function readRule(expr: string, measurements: string[], bottomKey?: string): SizeRule {
  const src = expr.trim();
  if (bottomKey && src.replace(/\s+/g, '') === `${bottomKey}.width`) return { mode: 'same' };
  const parsed = parseExpression(src);
  if (parsed.ok && references(parsed.value).length === 0) {
    const v = evaluate(src, {});
    if (v.ok) return { mode: 'fixed', value: v.value };
  }
  const m = MEASURE_RE.exec(src);
  if (m && measurements.includes(m[1])) {
    const k = m[3] ? Number(m[3]) : 1;
    const fraction = m[2] === '/' ? (k ? 1 / k : 1) : k;
    const ease = m[5] ? Number(m[5]) * UNIT_CM[m[6] ?? 'cm'] * (m[4] === '-' ? -1 : 1) : 0;
    return { mode: 'measure', measurement: m[1], fraction, ease };
  }
  return { mode: 'custom', expr: src };
}

// ---------- writing ----------

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** A length written in the user's units: `20` (cm) or `8in`. */
export function lengthLiteral(cm: number, units: Units): string {
  return units === 'imperial' ? `${round(cm / CM_PER_INCH, 3)}in` : `${round(cm, 2)}`;
}

/** `× 0.5` is written `/ 2` when it is one over a whole number. */
function fractionPart(f: number): string {
  if (Math.abs(f - 1) < 1e-9) return '';
  const inv = 1 / f;
  if (f > 0 && f < 1 && Math.abs(inv - Math.round(inv)) < 1e-6) return ` / ${Math.round(inv)}`;
  return ` * ${round(f, 4)}`;
}

export function ruleExpr(rule: SizeRule, units: Units, bottomKey: string): string {
  switch (rule.mode) {
    case 'fixed':
      return lengthLiteral(rule.value, units);
    case 'same':
      return `${bottomKey}.width`;
    case 'custom':
      return rule.expr;
    case 'measure': {
      const ease = Math.abs(rule.ease) < 1e-9 ? '' : ` ${rule.ease < 0 ? '-' : '+'} ${lengthLiteral(Math.abs(rule.ease), units)}`;
      return `${rule.measurement}${fractionPart(rule.fraction)}${ease}`;
    }
  }
}

// ---------- editing ----------

/**
 * Set one of the rectangle's dimensions. Fixed, measurement and same-as-bottom rules hold for every size, so they
 * clear per-size fixed values; a custom expression keeps them. Setting the top width also picks the shaping: no
 * shaping when it follows the bottom, spread increases/decreases otherwise (unless shaping was already chosen).
 */
export function setRectDim(p: Project, panelId: Id, which: RectDim, rule: SizeRule, units: Units): Project {
  const d = structuredClone(p);
  const panel = d.panels.find((x) => x.id === panelId);
  if (!panel || !isRectangle(panel)) return p;
  const { bottom } = rectWaypoints(panel);
  const old = rectDimOf(panel, which);
  const next = dim(ruleExpr(rule, units, waypointKey(bottom.name)), rule.mode === 'custom' ? old.overrides : {});
  assign(panel, which, next);
  if (which === 'top') {
    const seg = panel.segments.find((s) => s.fromWaypoint === bottom.id);
    const set = (m: SegmentMethod) => seg && Object.assign(seg, { left: m, right: structuredClone(m), mirror: true });
    if (rule.mode === 'same') set({ kind: 'straight' });
    else if (seg && seg.left.kind === 'straight' && seg.right.kind === 'straight') set({ ...defaultAutoMethod(), align: 'center' });
  }
  return d;
}

function assign(panel: Panel, which: RectDim, next: DimExpr): void {
  const { bottom, top } = rectWaypoints(panel);
  if (which === 'height') top.height = next;
  else {
    const wp = which === 'bottom' ? bottom : top;
    wp.width = next;
    wp.left = dim(`(${next.expr}) / 2`);
    wp.right = dim(`(${next.expr}) / 2`);
  }
}

/** Set a dimension's expression and per-size values as they are (the custom-expression field). */
export function setRectExpr(p: Project, panelId: Id, which: RectDim, next: DimExpr): Project {
  const d = structuredClone(p);
  const panel = d.panels.find((x) => x.id === panelId);
  if (!panel || !isRectangle(panel)) return p;
  assign(panel, which, structuredClone(next));
  return d;
}

/** Drop the per-size fixed values of one dimension (they win over its rule). */
export function clearRectOverrides(p: Project, panelId: Id, which: RectDim): Project {
  const d = structuredClone(p);
  const panel = d.panels.find((x) => x.id === panelId);
  if (!panel || !isRectangle(panel)) return p;
  rectDimOf(panel, which).overrides = {};
  return d;
}

/**
 * A rule of another kind, starting from the current one: a fixed value keeps the current size's value (rounded to
 * a tidy step); a measurement starts with no ease (a panel's old fixed width rarely relates to the measurement);
 * an expression starts from the current rule written out.
 */
export function convertRule(mode: SizeRule['mode'], current: SizeRule, valueCm: number, units: Units, measurement: string, fraction: number, bottomKey: string): SizeRule {
  const step = units === 'imperial' ? CM_PER_INCH / 4 : 0.5;
  const tidy = (cm: number) => Math.round(cm / step) * step;
  switch (mode) {
    case 'fixed':
      return { mode, value: tidy(valueCm) };
    case 'same':
      return { mode };
    case 'custom':
      return { mode, expr: current.mode === 'custom' ? current.expr : ruleExpr(current, units, bottomKey) };
    case 'measure':
      return current.mode === 'measure' ? current : { mode, measurement, fraction, ease: 0 };
  }
}
