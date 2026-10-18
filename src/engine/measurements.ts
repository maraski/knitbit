// Resolving measurement values per size, and building the expression scope that panels evaluate against.
// Precedence per size: manual override → table value → grading rule.

import { bandValues } from './bands';
import { evaluate, resolveDefinitions, scopeFrom, type Result } from './expr';
import { customCupNames, fitAliases } from './fit';
import { regionOf, regionSources } from './regions';
import type { DimExpr, Id, Measurement, Project, ValueSource } from './model';

export interface ResolvedValue {
  value: number;
  source: ValueSource;
  /** Region sizing: the size the value was taken from, when it isn't the size being resolved. */
  from?: Id;
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

  // Region sizing: each measurement may come from another size (its region's source). This size's own manual
  // value still wins; expression rules are evaluated over the mixed values.
  const sources = regionSources(project, sizeId);
  for (const m of project.measurements) {
    const src = sources[regionOf(m)];
    const from = src !== sizeId ? { from: src } : {};
    if (sizeId in m.manual) values[m.name] = { value: m.manual[sizeId], source: 'manual' };
    else if (src in m.manual) values[m.name] = { value: m.manual[src], source: 'manual', ...from };
    else if (src in m.table) values[m.name] = { value: m.table[src], source: 'table', ...from };
    else if (m.rule.type === 'increment') {
      const v = incrementValue(project, m, src);
      if (v === undefined) errors[m.name] = 'Base size not found';
      else values[m.name] = { value: v, source: 'rule', ...from };
    } else if (m.rule.type === 'expression') {
      defs[m.name] = m.rule.expr;
    } else {
      errors[m.name] = 'No value for this size and no grading rule';
    }
    if (values[m.name]) base[m.name] = values[m.name].value;
  }
  // Names that follow the project's fit choices (e.g. `bust` = the chosen cup column).
  const aliases = fitAliases(project);
  Object.assign(defs, aliases);

  const resolved = resolveDefinitions(defs, base);
  for (const name of Object.keys(defs)) {
    if (name in resolved.errors) errors[name] = resolved.errors[name];
    else if (name in aliases) {
      const t = values[aliases[name]];
      values[name] = { value: resolved.values[name], source: t?.source ?? 'rule', ...(t?.from ? { from: t.from } : {}) };
    } else values[name] = { value: resolved.values[name], source: 'rule' };
  }
  // Custom bust: dart height and apex width from the nearest cup, per size.
  const plain = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.value]));
  const custom = customCupNames(project, plain);
  if (custom) for (const [name, col] of Object.entries(custom.names)) values[name] = { ...values[col], source: 'rule' };
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
  // Cardigan front bands: band_w, band_overlap, closing_r (0 without bands).
  const b = bandValues(project, sizeId, scope);
  scope.band_w = b.band_w;
  scope.band_overlap = b.band_overlap;
  scope.closing_r = b.closing_r;
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
