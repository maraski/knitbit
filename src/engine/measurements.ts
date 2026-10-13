// Resolving measurement values per size, and building the expression scope that panels evaluate against.
// Precedence per size: manual override → table value → grading rule.

import { evaluate, resolveDefinitions, scopeFrom, type Result } from './expr';
import type { DimExpr, Id, Measurement, Project, ValueSource } from './model';

export interface ResolvedValue {
  value: number;
  source: ValueSource;
}

export interface ResolvedMeasurements {
  values: Record<string, ResolvedValue>;
  errors: Record<string, string>; // measurement name → why it has no value
}

function sizeIndex(project: Project, sizeId: Id): number {
  return project.sizes.findIndex((s) => s.id === sizeId);
}

/** Value from an increment rule: walk from the base size, adding each size's step on the way up. */
export function incrementValue(project: Project, m: Measurement, sizeId: Id): number | undefined {
  if (m.rule.type !== 'increment') return undefined;
  const rule = m.rule;
  const base = sizeIndex(project, project.baseSizeId);
  const target = sizeIndex(project, sizeId);
  if (base < 0 || target < 0) return undefined;
  const step = (i: number) => rule.steps[project.sizes[i].id] ?? rule.defaultStep;
  let v = rule.baseValue;
  if (target > base) for (let i = base + 1; i <= target; i++) v += step(i);
  else for (let i = base; i > target; i--) v -= step(i);
  return v;
}

/** Scope entries for ease: `ease` and `ease.<name>` for every measurement (falling back to global). */
export function easeScope(project: Project): Record<string, number> {
  const out: Record<string, number> = { ease: project.ease.global };
  for (const m of project.measurements) out[`ease.${m.name}`] = project.ease.per[m.name] ?? project.ease.global;
  for (const [k, v] of Object.entries(project.ease.per)) out[`ease.${k}`] = v;
  return out;
}

export function resolveMeasurements(project: Project, sizeId: Id): ResolvedMeasurements {
  const values: Record<string, ResolvedValue> = {};
  const errors: Record<string, string> = {};
  const base: Record<string, number> = easeScope(project);
  const defs: Record<string, string> = {};

  for (const m of project.measurements) {
    if (sizeId in m.manual) values[m.name] = { value: m.manual[sizeId], source: 'manual' };
    else if (sizeId in m.table) values[m.name] = { value: m.table[sizeId], source: 'table' };
    else if (m.rule.type === 'increment') {
      const v = incrementValue(project, m, sizeId);
      if (v === undefined) errors[m.name] = 'Base size not found';
      else values[m.name] = { value: v, source: 'rule' };
    } else if (m.rule.type === 'expression') {
      defs[m.name] = m.rule.expr;
    } else {
      errors[m.name] = 'No value for this size and no grading rule';
    }
    if (values[m.name]) base[m.name] = values[m.name].value;
  }

  const resolved = resolveDefinitions(defs, base);
  for (const name of Object.keys(defs)) {
    if (name in resolved.errors) errors[name] = resolved.errors[name];
    else values[name] = { value: resolved.values[name], source: 'rule' };
  }
  return { values, errors };
}

/** Gauge-derived lengths for expressions: `row_h` = height of one row, `st_w` = width of one stitch (cm). */
export function gaugeScope(project: Project): Record<string, number> {
  const basis = project.gauge.basis === '10cm' ? 10 : 10.16;
  return {
    row_h: project.gauge.rows > 0 ? basis / project.gauge.rows : 0,
    st_w: project.gauge.stitches > 0 ? basis / project.gauge.stitches : 0,
  };
}

/** Flat name → number scope for evaluating panel expressions in one size. */
export function buildScope(project: Project, sizeId: Id): Record<string, number> {
  const { values } = resolveMeasurements(project, sizeId);
  const scope = { ...gaugeScope(project), ...easeScope(project) };
  for (const [name, v] of Object.entries(values)) scope[name] = v.value;
  return scope;
}

export interface DimValue {
  value: number;
  overridden: boolean;
}

/** Evaluate a dimension for one size: a per-size fixed override wins over the expression. */
export function evaluateDim(d: DimExpr, sizeId: Id, scope: Record<string, number>): Result<DimValue> {
  if (sizeId in d.overrides) return { ok: true, value: { value: d.overrides[sizeId], overridden: true } };
  const r = evaluate(d.expr, scopeFrom(scope));
  return r.ok ? { ok: true, value: { value: r.value, overridden: false } } : r;
}
