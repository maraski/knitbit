// A fix's one-click change ("Apply"): set the field to the value each failing size needs. Per-size overrides for those
// sizes; the expression itself when every size fails and they all need the same value. Pure: the UI commits the
// returned project as one undo step and shows the summary in a toast.

import { defaultShortRows } from './contiguous';
import type { Check } from './checks';
import type { FieldRef, FixApply, IssueFix } from './issues';
import { dim, type DimExpr, type Id, type Panel, type Project, type YokeSpec } from './model';
import { defaultOffShoulder, RAGLAN_SLEEVE_TOP } from './raglan';

/** Where a yoke parameter lives in the YokeSpec (the optional parts get their defaults when first set). */
const YOKE_DIMS: Record<string, { get: (s: YokeSpec) => DimExpr; set: (s: YokeSpec, d: DimExpr) => void }> = {
  seamSts: { get: (s) => s.seamSts, set: (s, d) => void (s.seamSts = d) },
  frontCo: { get: (s) => (s.shortRows ?? defaultShortRows()).frontCo, set: (s, d) => void ((s.shortRows ??= defaultShortRows()).frontCo = d) },
  srPairs: { get: (s) => (s.shortRows ?? defaultShortRows()).pairs, set: (s, d) => void ((s.shortRows ??= defaultShortRows()).pairs = d) },
  srFirst: { get: (s) => (s.shortRows ?? defaultShortRows()).first, set: (s, d) => void ((s.shortRows ??= defaultShortRows()).first = d) },
  srStep: { get: (s) => (s.shortRows ?? defaultShortRows()).step, set: (s, d) => void ((s.shortRows ??= defaultShortRows()).step = d) },
  backWidth: { get: (s) => s.shoulder.backWidth, set: (s, d) => void (s.shoulder.backWidth = d) },
  shoulderLength: { get: (s) => s.shoulder.length, set: (s, d) => void (s.shoulder.length = d) },
  shorten: { get: (s) => s.shoulder.shorten, set: (s, d) => void (s.shoulder.shorten = d) },
  extraRows: { get: (s) => s.shoulder.extraRows, set: (s, d) => void (s.shoulder.extraRows = d) },
  backNeckPerRow: { get: (s) => s.backNeck.perRow, set: (s, d) => void (s.backNeck.perRow = d) },
  backNeckRows: { get: (s) => s.backNeck.rows, set: (s, d) => void (s.backNeck.rows = d) },
  neckWidth: { get: (s) => s.neck.width ?? dim('back_neck_width'), set: (s, d) => void (s.neck.width = d) },
  neckDepth: { get: (s) => s.neck.depth, set: (s, d) => void (s.neck.depth = d) },
  neckBackDepth: { get: (s) => s.neck.backDepth ?? dim('back_neck_drop'), set: (s, d) => void (s.neck.backDepth = d) },
  neckCentre: { get: (s) => s.neck.centre, set: (s, d) => void (s.neck.centre = d) },
  capTopSts: { get: (s) => s.cap.topSts, set: (s, d) => void (s.cap.topSts = d) },
  rapidRows: { get: (s) => s.cap.rapidRows, set: (s, d) => void (s.cap.rapidRows = d) },
  sleeveWidth: { get: (s) => s.sleeveWidth, set: (s, d) => void (s.sleeveWidth = d) },
  backLength: { get: (s) => s.depth.backLength, set: (s, d) => void (s.depth.backLength = d) },
  extraDepth: { get: (s) => s.depth.extra, set: (s, d) => void (s.depth.extra = d) },
  maxRapid: { get: (s) => s.depth.maxRapid, set: (s, d) => void (s.depth.maxRapid = d) },
  bodyWidth: { get: (s) => s.body.width, set: (s, d) => void (s.body.width = d) },
  bodyZone: { get: (s) => s.body.zone, set: (s, d) => void (s.body.zone = d) },
  underarmCo: { get: (s) => s.underarm.castOn, set: (s, d) => void (s.underarm.castOn = d) },
  sleeveTop: { get: (s) => s.raglan?.sleeveTop ?? dim(RAGLAN_SLEEVE_TOP), set: (s, d) => void (s.raglan = { ...s.raglan, sleeveTop: d }) },
  bandEase: { get: (s) => (s.offShoulder ?? defaultOffShoulder()).bandEase, set: (s, d) => void ((s.offShoulder ??= defaultOffShoulder()).bandEase = d) },
  ringEase: { get: (s) => (s.offShoulder ?? defaultOffShoulder()).ringEase, set: (s, d) => void ((s.offShoulder ??= defaultOffShoulder()).ringEase = d) },
  armArc: { get: (s) => (s.offShoulder ?? defaultOffShoulder()).armArc, set: (s, d) => void ((s.offShoulder ??= defaultOffShoulder()).armArc = d) },
  backRaise: { get: (s) => (s.offShoulder ?? defaultOffShoulder()).backRaise, set: (s, d) => void ((s.offShoulder ??= defaultOffShoulder()).backRaise = d) },
};

const NECK_KEYS = { width: 'width', depth: 'depth', centre: 'centreWidth' } as const;

/** The DimExpr a field edits, with its setter, in a (cloned) panel; null when Apply can't set it. */
function dimOf(panel: Panel, f: FieldRef): { get: () => DimExpr; set: (d: DimExpr) => void } | null {
  if (f.target === 'yoke' && panel.yoke && YOKE_DIMS[f.key]) {
    const y = panel.yoke;
    const m = YOKE_DIMS[f.key];
    return { get: () => m.get(y), set: (d) => m.set(y, d) };
  }
  if (f.target === 'neckline' && panel.neckline && f.key in NECK_KEYS) {
    const nk = panel.neckline;
    const k = NECK_KEYS[f.key as keyof typeof NECK_KEYS];
    return { get: () => nk[k], set: (d) => void (nk[k] = d) };
  }
  if (f.target === 'waypoint') {
    const wp = panel.waypoints.find((w) => w.id === f.id);
    const k = f.key as 'height' | 'width' | 'left' | 'right';
    if (!wp || !['height', 'width', 'left', 'right'].includes(k)) return null;
    return { get: () => wp[k], set: (d) => void (wp[k] = d) };
  }
  return null;
}

/** Same field (piece, place and key). */
export function sameField(a: FieldRef, b: FieldRef): boolean {
  return a.target === b.target && a.key === b.key && (a.panelId ?? '') === (b.panelId ?? '') && (a.id ?? '') === (b.id ?? '');
}

/** A number as an expression or override: at most 2 decimals. */
const num = (v: number) => Math.round(v * 100) / 100;

/** Can Apply set this field in this project? */
export function canApply(project: Project, a: FixApply): boolean {
  const panel = project.panels.find((p) => p.id === a.field.panelId);
  return !!panel && !!dimOf(structuredClone(panel), a.field);
}

/**
 * Set the field to each size's value. Every size of the project failing with one value: the expression becomes that
 * value (and its overrides go); otherwise each failing size gets an override and the others keep theirs.
 */
export function applyFix(project: Project, f: FieldRef, values: { sizeId: Id; value: number }[]): Project | null {
  if (!values.length) return null;
  const next = structuredClone(project);
  const panel = next.panels.find((p) => p.id === f.panelId);
  const d = panel && dimOf(panel, f);
  if (!d) return null;
  const cur = d.get();
  const all = project.sizes.every((s) => values.some((v) => v.sizeId === s.id));
  const one = values.every((v) => num(v.value) === num(values[0].value));
  if (all && one) d.set({ expr: String(num(values[0].value)), overrides: {} });
  else {
    const overrides = { ...cur.overrides };
    for (const v of values) overrides[v.sizeId] = num(v.value);
    d.set({ ...cur, overrides });
  }
  return { ...next, updatedAt: new Date().toISOString() };
}

/**
 * The one-click change of a group of sizes with the same problem (the Checks list's row, or the same issue found in
 * every size): each size's apply on the first apply's field. Sizes without an apply on that field are left out.
 */
export function groupApply(sizes: { id: Id; fix?: IssueFix }[]): { field: FieldRef; unit: FixApply['unit']; values: { sizeId: Id; value: number }[] } | null {
  const first = sizes.find((s) => s.fix?.apply)?.fix!.apply;
  if (!first) return null;
  const values = sizes.filter((s) => s.fix?.apply && sameField(s.fix.apply.field, first.field)).map((s) => ({ sizeId: s.id, value: s.fix!.apply!.value }));
  return { field: first.field, unit: first.unit, values };
}

/**
 * The one-click change for an issue across the project: every size where the same piece reports the same kind of
 * problem (its code) with an apply on the same field. (Messages can differ between sizes, e.g. which side is short.)
 */
export function applyAcrossSizes(checks: Check[], panelId: Id, issue: { code?: string; fix?: IssueFix }): { field: FieldRef; unit: FixApply['unit']; values: { sizeId: Id; value: number }[] } | null {
  const a = issue.fix?.apply;
  if (!a || !issue.code) return null;
  const seen = new Set<Id>();
  const values: { sizeId: Id; value: number }[] = [];
  for (const c of checks) {
    const ca = c.issue.fix?.apply;
    if (c.panelId !== panelId || c.issue.code !== issue.code || !ca || !sameField(ca.field, a.field) || seen.has(c.sizeId)) continue;
    seen.add(c.sizeId);
    values.push({ sizeId: c.sizeId, value: ca.value });
  }
  return values.length ? { field: a.field, unit: a.unit, values } : null;
}

/** Sizes in words: consecutive runs of the project's size order as "4XS–XS", the rest listed; "all sizes". */
export function sizesText(project: Project, ids: Id[]): string {
  if (project.sizes.length > 1 && project.sizes.every((s) => ids.includes(s.id))) return 'all sizes';
  const idx = project.sizes.map((s, i) => (ids.includes(s.id) ? i : -1)).filter((i) => i >= 0);
  const runs: string[] = [];
  for (let k = 0; k < idx.length; ) {
    let e = k;
    while (e + 1 < idx.length && idx[e + 1] === idx[e] + 1) e++;
    const a = project.sizes[idx[k]].name;
    const b = project.sizes[idx[e]].name;
    runs.push(e === k ? a : e === k + 1 ? `${a}, ${b}` : `${a}–${b}`);
    k = e + 1;
  }
  return runs.join(', ');
}

/** "Set Extra depth to 5.7 cm in 4XS–XS" (a different value per size: "to 5.7–7.2 cm"). */
export function applySummary(project: Project, f: FieldRef, unit: FixApply['unit'], values: { sizeId: Id; value: number }[], fmt: (v: number, unit: FixApply['unit']) => string): string {
  const vs = values.map((v) => num(v.value));
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const to = lo === hi ? fmt(lo, unit) : `${fmt(lo, unit)} … ${fmt(hi, unit)}`;
  return `Set ${f.label} to ${to} in ${sizesText(project, values.map((v) => v.sizeId))}`;
}
