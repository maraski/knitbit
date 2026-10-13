// Size and measurement operations: add/rename/remove/reorder sizes, rename measurements everywhere
// they are referenced, convert values to increment rules, and spot values that break the size trend.
// All functions return a new project (the input is not modified).

import { isValidName, parseExpression, references, renameReferences } from './expr';
import { resolveMeasurements } from './measurements';
import { newId, newMeasurement, type DimExpr, type GradingRule, type Id, type Measurement, type Panel, type Project, type Size } from './model';

function clone(p: Project): Project {
  return structuredClone(p);
}

/** Every dimension expression in a panel. */
export function panelDims(panel: Panel): { label: string; dim: DimExpr }[] {
  const out: { label: string; dim: DimExpr }[] = [];
  for (const w of panel.waypoints) {
    out.push({ label: `${w.name} height`, dim: w.height });
    if (w.symmetric) out.push({ label: `${w.name} width`, dim: w.width });
    else out.push({ label: `${w.name} left`, dim: w.left }, { label: `${w.name} right`, dim: w.right });
  }
  for (const s of panel.sections) out.push({ label: `${s.name} from`, dim: s.fromHeight }, { label: `${s.name} to`, dim: s.toHeight });
  if (panel.neckline) {
    out.push({ label: 'neck width', dim: panel.neckline.width }, { label: 'neck depth', dim: panel.neckline.depth }, { label: 'neck centre', dim: panel.neckline.centreWidth });
  }
  return out;
}

/** Including hidden left/right expressions of symmetric waypoints (they still hold text). */
function allDims(panel: Panel): DimExpr[] {
  const out: DimExpr[] = [];
  for (const w of panel.waypoints) out.push(w.height, w.width, w.left, w.right);
  for (const s of panel.sections) out.push(s.fromHeight, s.toHeight);
  if (panel.neckline) out.push(panel.neckline.width, panel.neckline.depth, panel.neckline.centreWidth);
  const b = panel.bust;
  if (b) out.push(b.width, b.length, b.apexHeight, b.apexOffset, b.shortRows.zoneWidth, b.dart.tipGap, b.vertical.bottom, b.vertical.gap, b.vertical.top);
  if (panel.princess) out.push(panel.princess.position);
  for (const l of panel.shapingLines ?? []) out.push(l.from.height, l.from.x, l.to.height, l.to.x, l.amount);
  return out;
}

// ---------- sizes ----------

export function addSize(p: Project, name: string, afterId?: Id): { project: Project; size: Size } {
  const d = clone(p);
  const size: Size = { id: newId('size'), name: name.trim() };
  const idx = afterId ? d.sizes.findIndex((s) => s.id === afterId) : -1;
  if (idx >= 0) d.sizes.splice(idx + 1, 0, size);
  else d.sizes.push(size);
  return { project: d, size };
}

export function renameSize(p: Project, id: Id, name: string): Project {
  const d = clone(p);
  const s = d.sizes.find((x) => x.id === id);
  if (s) s.name = name;
  return d;
}

export function moveSize(p: Project, id: Id, by: -1 | 1): Project {
  const d = clone(p);
  const i = d.sizes.findIndex((s) => s.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= d.sizes.length) return p;
  [d.sizes[i], d.sizes[j]] = [d.sizes[j], d.sizes[i]];
  return d;
}

/** Remove a size and every per-size value that belongs to it. Refuses to remove the last size. */
export function removeSize(p: Project, id: Id): Project {
  if (p.sizes.length <= 1) return p;
  const d = clone(p);
  const idx = d.sizes.findIndex((s) => s.id === id);
  d.sizes = d.sizes.filter((s) => s.id !== id);
  if (d.baseSizeId === id) d.baseSizeId = d.sizes[Math.min(idx, d.sizes.length - 1)].id;
  for (const m of d.measurements) {
    delete m.table[id];
    delete m.manual[id];
    if (m.rule.type === 'increment') delete m.rule.steps[id];
  }
  for (const panel of d.panels) {
    for (const dim of allDims(panel)) delete dim.overrides[id];
    for (const s of panel.segments) delete s.manual[id];
    if (panel.bust) delete panel.bust.manual[id];
    if (panel.freeStitches) panel.freeStitches = panel.freeStitches.filter((f) => f.sizeId !== id);
    for (const l of panel.shapingLines ?? []) delete l.manual[id];
  }
  return d;
}

/**
 * Change the base size. Increment rules keep producing the same values: each rule's base value
 * is moved to the new base size.
 */
export function setBaseSize(p: Project, id: Id): Project {
  if (!p.sizes.some((s) => s.id === id)) return p;
  const d = clone(p);
  for (const m of d.measurements) {
    if (m.rule.type !== 'increment') continue;
    const v = incrementAt(p, m.rule, id);
    if (v !== undefined) m.rule.baseValue = v;
  }
  d.baseSizeId = id;
  return d;
}

function incrementAt(p: Project, rule: Extract<GradingRule, { type: 'increment' }>, sizeId: Id): number | undefined {
  const base = p.sizes.findIndex((s) => s.id === p.baseSizeId);
  const target = p.sizes.findIndex((s) => s.id === sizeId);
  if (base < 0 || target < 0) return undefined;
  const step = (i: number) => rule.steps[p.sizes[i].id] ?? rule.defaultStep;
  let v = rule.baseValue;
  if (target > base) for (let i = base + 1; i <= target; i++) v += step(i);
  else for (let i = base; i > target; i--) v -= step(i);
  return v;
}

// ---------- measurements ----------

export function validateNewName(p: Project, name: string, current?: string): string | null {
  if (!isValidName(name)) return 'Use letters, digits and _ only, starting with a letter (not cm, mm, in or a function name).';
  if (name.includes('.')) return 'Measurement names cannot contain dots.';
  if (name !== current && p.measurements.some((m) => m.name === name)) return `"${name}" already exists.`;
  return null;
}

export function addMeasurement(p: Project, name: string, label = name, kind: Measurement['kind'] = 'length'): Project {
  const d = clone(p);
  d.measurements.push(newMeasurement(name, label, kind));
  return d;
}

export function updateMeasurement(p: Project, name: string, fn: (m: Measurement) => void): Project {
  const d = clone(p);
  const m = d.measurements.find((x) => x.name === name);
  if (m) fn(m);
  return d;
}

/** Rename a measurement and every reference to it (`name` and `ease.name`) in the project. */
export function renameMeasurement(p: Project, from: string, to: string): Project {
  if (from === to) return p;
  const d = clone(p);
  const map = (n: string) => (n === from ? to : n === `ease.${from}` ? `ease.${to}` : undefined);
  for (const m of d.measurements) {
    if (m.name === from) m.name = to;
    if (m.rule.type === 'expression') m.rule.expr = renameReferences(m.rule.expr, map);
  }
  for (const panel of d.panels) for (const dim of allDims(panel)) dim.expr = renameReferences(dim.expr, map);
  if (from in d.ease.per) {
    d.ease.per[to] = d.ease.per[from];
    delete d.ease.per[from];
  }
  return d;
}

export function removeMeasurement(p: Project, name: string): Project {
  const d = clone(p);
  d.measurements = d.measurements.filter((m) => m.name !== name);
  delete d.ease.per[name];
  return d;
}

/** Where a measurement is used, as readable labels (e.g. "Back › waist width"). */
export function measurementUsage(p: Project, name: string): string[] {
  const uses = (expr: string) => {
    const r = parseExpression(expr);
    if (!r.ok) return new RegExp(`(^|[^\\w.])(ease\\.)?${name}(?![\\w.])`).test(expr);
    return references(r.value).some((n) => n === name || n === `ease.${name}`);
  };
  const out: string[] = [];
  for (const m of p.measurements) if (m.name !== name && m.rule.type === 'expression' && uses(m.rule.expr)) out.push(`measurement ${m.name}`);
  for (const panel of p.panels) for (const { label, dim } of panelDims(panel)) if (uses(dim.expr)) out.push(`${panel.name} › ${label}`);
  return out;
}

/**
 * Replace a measurement's values with an increment rule that reproduces its current values exactly
 * (base value at the base size, one step per size), and clear its table values so the rule applies.
 */
export function convertToIncrementRule(p: Project, name: string): Project {
  const m = p.measurements.find((x) => x.name === name);
  if (!m) return p;
  const values = p.sizes.map((s) => resolveMeasurements(p, s.id).values[name]?.value);
  if (values.some((v) => v === undefined)) return p;
  const vs = values as number[];
  const baseIdx = p.sizes.findIndex((s) => s.id === p.baseSizeId);
  const diffs = vs.slice(1).map((v, i) => round4(v - vs[i]));
  const defaultStep = mostCommon(diffs) ?? 0;
  const steps: Record<Id, number> = {};
  p.sizes.forEach((s, i) => {
    if (i > 0 && diffs[i - 1] !== defaultStep) steps[s.id] = diffs[i - 1];
  });
  return updateMeasurement(p, name, (mm) => {
    mm.rule = { type: 'increment', baseValue: vs[baseIdx], defaultStep, steps };
    mm.table = {};
    for (const id of Object.keys(mm.manual)) delete mm.manual[id];
  });
}

/** Give every size the same step (removes per-size steps). */
export function uniformSteps(p: Project, name: string, step: number): Project {
  return updateMeasurement(p, name, (m) => {
    if (m.rule.type === 'increment') m.rule = { ...m.rule, defaultStep: step, steps: {} };
  });
}

function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

function mostCommon(xs: number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: number | undefined;
  let n = 0;
  for (const [x, c] of counts) if (c > n) [best, n] = [x, c];
  return best;
}

// ---------- trend check ----------

export interface TrendFlag {
  sizeId: Id;
  message: string;
}

/**
 * Sizes that zigzag: the step into this size goes the opposite way to the steps on both sides of it
 * (e.g. M is smaller than S while S grew from XS and L grows from M). A measurement that rises and
 * then falls across the range is a grading shape, not a zigzag, and is not flagged. Informational only.
 */
export function trendFlags(p: Project, name: string): TrendFlag[] {
  const vals = p.sizes.map((s) => resolveMeasurements(p, s.id).values[name]?.value);
  const sign = (i: number): number => {
    const a = vals[i - 1];
    const b = vals[i];
    if (a === undefined || b === undefined) return 0;
    const d = b - a;
    return Math.abs(d) < 1e-9 ? 0 : Math.sign(d);
  };
  const flags: TrendFlag[] = [];
  for (let i = 1; i < p.sizes.length - 1; i++) {
    const here = sign(i);
    if (here === 0) continue;
    // Nearest non-flat steps before and after this one.
    let before = 0;
    for (let j = i - 1; j >= 1 && before === 0; j--) before = sign(j);
    let after = 0;
    for (let j = i + 1; j < p.sizes.length && after === 0; j++) after = sign(j);
    if (before !== 0 && after !== 0 && before === after && here !== before) {
      const d = round4((vals[i] as number) - (vals[i - 1] as number));
      flags.push({
        sizeId: p.sizes[i].id,
        message: `${here < 0 ? 'Smaller' : 'Larger'} than ${p.sizes[i - 1].name} (${d > 0 ? '+' : ''}${d} cm) although the sizes around it ${before > 0 ? 'grow' : 'shrink'}.`,
      });
    }
  }
  return flags;
}
