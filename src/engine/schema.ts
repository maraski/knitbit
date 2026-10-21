// Project JSON: serialization, migration between schema versions, and validation with readable errors.

import { isValidName } from './expr';
import { migrateV1toV2 } from './legacy';
import { migrateV2toV3 } from './garment';
import { SCHEMA_VERSION, type Project } from './model';

// ---------- migrations ----------

/**
 * `MIGRATIONS[n]` upgrades a raw project object from schema n to n+1. Add one per schema bump.
 * A migration pushes a readable note for every change it makes to `notes`; they are shown to the knitter.
 */
export type Migration = (raw: any, notes: string[]) => any;
export const MIGRATIONS: Record<number, Migration> = {
  1: migrateV1toV2,
  2: migrateV2toV3,
};

export interface MigrateResult {
  raw: unknown;
  from: number;
  errors: string[];
  notes: string[]; // what the migrations changed
}

export function migrate(raw: unknown, migrations: Record<number, Migration> = MIGRATIONS, target = SCHEMA_VERSION): MigrateResult {
  if (!isObj(raw)) return { raw, from: 0, errors: ['The file does not contain a project object.'], notes: [] };
  const v = raw.schemaVersion;
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    return { raw, from: 0, errors: ['This file is not a Knitbit project (it has no schemaVersion).'], notes: [] };
  }
  if (v > target) {
    return { raw, from: v, errors: [`This project was saved by a newer version of Knitbit (schema ${v}); this app reads up to schema ${target}.`], notes: [] };
  }
  let cur: unknown = raw;
  const notes: string[] = [];
  for (let n = v; n < target; n++) {
    const m = migrations[n];
    if (!m) return { raw, from: v, errors: [`No migration from schema ${n} to ${n + 1}.`], notes: [] };
    try {
      cur = { ...(m(structuredClone(cur), notes) as object), schemaVersion: n + 1 };
    } catch (e) {
      return { raw, from: v, errors: [`Migration from schema ${n} to ${n + 1} failed: ${String(e)}`], notes: [] };
    }
  }
  return { raw: cur, from: v, errors: [], notes };
}

// ---------- validation ----------

type Errs = string[];
type Check = (v: unknown, path: string, errs: Errs) => void;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'a list';
  return typeof v === 'object' ? 'an object' : `${typeof v} ${JSON.stringify(v)}`;
}

const str: Check = (v, p, e) => {
  if (typeof v !== 'string') e.push(`${p}: expected text, got ${typeName(v)}`);
};
const num: Check = (v, p, e) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) e.push(`${p}: expected a number, got ${typeName(v)}`);
};
const bool: Check = (v, p, e) => {
  if (typeof v !== 'boolean') e.push(`${p}: expected true/false, got ${typeName(v)}`);
};
const oneOf =
  (...opts: (string | number | null)[]): Check =>
  (v, p, e) => {
    if (!opts.includes(v as string)) e.push(`${p}: expected one of ${opts.map((o) => JSON.stringify(o)).join(', ')}, got ${typeName(v)}`);
  };
const arr =
  (item: Check): Check =>
  (v, p, e) => {
    if (!Array.isArray(v)) return void e.push(`${p}: expected a list, got ${typeName(v)}`);
    v.forEach((x, i) => item(x, `${p}[${i}]`, e));
  };
const rec =
  (item: Check): Check =>
  (v, p, e) => {
    if (!isObj(v)) return void e.push(`${p}: expected an object, got ${typeName(v)}`);
    for (const [k, x] of Object.entries(v)) item(x, `${p}.${k}`, e);
  };
const nullable =
  (c: Check): Check =>
  (v, p, e) => {
    if (v !== null) c(v, p, e);
  };
const optional =
  (c: Check): Check =>
  (v, p, e) => {
    if (v !== undefined) c(v, p, e);
  };
const obj =
  (shape: Record<string, Check>): Check =>
  (v, p, e) => {
    if (!isObj(v)) return void e.push(`${p}: expected an object, got ${typeName(v)}`);
    for (const [k, c] of Object.entries(shape)) c(v[k], `${p}.${k}`, e);
  };
/** Discriminated union on a tag field. */
const tagged =
  (tag: string, variants: Record<string, Record<string, Check>>): Check =>
  (v, p, e) => {
    if (!isObj(v)) return void e.push(`${p}: expected an object, got ${typeName(v)}`);
    const t = v[tag];
    if (typeof t !== 'string' || !(t in variants)) {
      return void e.push(`${p}.${tag}: expected one of ${Object.keys(variants).map((k) => `"${k}"`).join(', ')}, got ${typeName(t)}`);
    }
    obj(variants[t])(v, p, e);
  };

const parity = oneOf('any', 'even', 'odd');
const dimExpr = obj({ expr: str, overrides: rec(num) });
const stitchPattern = obj({ name: str, multiple: num, offset: num });
const intList = nullable(arr(num));

const align = oneOf('end', 'start', 'center');
const edgeId = oneOf('hem', 'cuff', 'neckband', 'frontBands');
const bandAttach = oneOf('pickup', 'sideways', 'integrated');
const edgeTreatment = obj({ enabled: bool, depth: dimExpr, stitch: oneOf('rib1x1', 'rib2x2', 'garter', 'seed', 'custom'), custom: stitchPattern, method: oneOf('with-panel', 'later') });
const segmentMethod = tagged('kind', {
  auto: {
    side: oneOf('any', 'rs', 'ws'),
    align,
    order: oneOf('spread', 'shortFirst', 'longFirst'),
    rhythm: tagged('type', { auto: {}, fixed: { every: num }, mixed: { a: num, b: num } }),
    perSide: num,
  },
  steps: { steps: intList, maxPerStep: num, align: optional(align) },
  shortrows: { steps: intList, maxPerStep: num, style: oneOf('wrap-turn', 'german'), align: optional(align) },
  straight: {},
});

const manualEvent = obj({ row: num, delta: num, symbol: str });

const panel = obj({
  id: str,
  name: str,
  template: nullable(str),
  direction: oneOf('bottom-up', 'top-down', 'side-to-side'),
  startEdge: oneOf('bottom', 'top', 'left', 'right'),
  inTheRound: bool,
  joinAt: optional(nullable(str)),
  selvedge: obj({ left: oneOf(0, 1, 2), right: oneOf(0, 1, 2) }),
  shapingInset: num,
  rounding: obj({ parity: oneOf('any', 'even', 'odd', 'start'), rowParity: parity }),
  pattern: stitchPattern,
  sections: arr(obj({ id: str, name: str, fromHeight: dimExpr, toHeight: dimExpr, pattern: stitchPattern, edge: optional(edgeId) })),
  waypoints: arr(obj({ id: str, name: str, height: dimExpr, symmetric: bool, width: dimExpr, left: dimExpr, right: dimExpr })),
  segments: arr(
    obj({
      fromWaypoint: str,
      left: segmentMethod,
      right: segmentMethod,
      mirror: bool,
      placement: optional(oneOf('edge', 'princess', 'both')),
      manual: rec(obj({ left: optional(arr(manualEvent)), right: optional(arr(manualEvent)) })),
    }),
  ),
  neckline: nullable(
    obj({
      shape: oneOf('round', 'v', 'square', 'boat'),
      width: dimExpr,
      depth: dimExpr,
      centre: oneOf('bindoff', 'hold'),
      centreWidth: dimExpr,
      side: oneOf('rs', 'any'),
    }),
  ),
  bust: optional(
    nullable(
      obj({
        method: oneOf('shortrows', 'horizontal-dart', 'vertical-dart', 'none'),
        width: dimExpr,
        length: dimExpr,
        frontWidth: optional(bool),
        lengthNoWidth: optional(dimExpr),
        apexCorrection: optional(dimExpr),
        sideWidth: bool,
        apexHeight: dimExpr,
        apexOffset: dimExpr,
        shortRows: obj({
          style: oneOf('wrap-turn', 'german'),
          pairs: nullable(num),
          order: oneOf('shortening', 'lengthening'),
          zoneWidth: dimExpr,
          span: optional(oneOf('zone', 'apex-to-side')),
          start: optional(oneOf('centred', 'apex')),
          edgeSts: optional(nullable(num)),
        }),
        dart: obj({ placement: oneOf('side', 'underarm'), tipGap: dimExpr }),
        vertical: obj({ bottom: dimExpr, gap: dimExpr, top: dimExpr }),
        manual: rec(obj({ left: optional(arr(num)), right: optional(arr(num)), incRows: optional(arr(num)), decRows: optional(arr(num)) })),
      }),
    ),
  ),
  princess: optional(nullable(obj({ position: dimExpr, sides: oneOf('both', 'one') }))),
  startFrom: optional(oneOf('caston', 'pickup')),
  linkedTo: optional(nullable(str)),
  edge: optional(edgeId),
  band: optional(oneOf('button', 'buttonhole', 'continuous')),
  fromYoke: optional(oneOf('back', 'front', 'leftSleeve', 'rightSleeve')),
  yoke: optional(
    nullable(
      obj({
        start: optional(oneOf('back', 'neck')),
        shortRows: optional(obj({ frontCo: dimExpr, pairs: dimExpr, first: dimExpr, step: dimExpr })),
        increase: obj({ type: oneOf('kfb', 'm1', 'other'), symbol: str }),
        seamSts: dimExpr,
        shoulder: obj({ mode: oneOf('cross-back', 'length'), backWidth: dimExpr, length: dimExpr, shorten: dimExpr, extraRows: dimExpr }),
        backNeck: obj({ perRow: dimExpr, rows: dimExpr, manual: rec(arr(arr(num))) }),
        cap: obj({ topSts: dimExpr, rapidRows: dimExpr, solve: bool }),
        sleeveWidth: dimExpr,
        depth: obj({ mode: oneOf('back-length', 'armhole'), backLength: dimExpr, extra: dimExpr, deepen: bool, maxRapid: dimExpr }),
        body: obj({ width: dimExpr, increases: bool, zone: dimExpr }),
        underarm: obj({ castOn: dimExpr }),
        neck: obj({ shape: oneOf('round', 'v', 'square', 'boat'), depth: dimExpr, centre: dimExpr, width: optional(dimExpr) }),
      }),
    ),
  ),
  half: optional(nullable(obj({ side: oneOf('left', 'right'), pair: nullable(str), cfSelvedge: oneOf(0, 1, 2) }))),
  freeStitches: optional(arr(obj({ id: str, sizeId: str, row: num, x: num, symbol: str, mirror: bool }))),
  shapingLines: optional(
    arr(
      obj({
        id: str,
        name: str,
        from: obj({ height: dimExpr, x: dimExpr }),
        to: obj({ height: dimExpr, x: dimExpr }),
        amount: dimExpr,
        kind: oneOf('one-way', 'fisheye'),
        sides: oneOf('both', 'one'),
        rowSide: oneOf('rs', 'any'),
        mirror: bool,
        manual: rec(arr(num)),
      }),
    ),
  ),
  layout: obj({ x: num, y: num, rotation: oneOf(0, 90, 180, 270) }),
  notes: str,
});

const edgeRef = obj({
  panelId: str,
  edge: tagged('kind', { side: { side: oneOf('left', 'right'), from: str, to: str }, bottom: {}, top: {}, neck: {}, front: { side: optional(oneOf('left', 'right')) }, held: { part: oneOf('leftSleeve', 'body', 'rightSleeve') } }),
});

const project = obj({
  schemaVersion: num,
  id: str,
  name: str,
  units: oneOf('metric', 'imperial'),
  gauge: obj({ stitches: num, rows: num, basis: oneOf('10cm', '4in') }),
  sizes: arr(obj({ id: str, name: str, estimated: optional(bool), regions: optional(rec(str)), custom: optional(obj({ seededFrom: str })) })),
  baseSizeId: str,
  measurements: arr(
    obj({
      name: str,
      label: str,
      kind: oneOf('circumference', 'length'),
      rule: tagged('type', {
        none: {},
        increment: { baseValue: num, defaultStep: num, steps: rec(num) },
        expression: { expr: str },
      }),
      table: rec(num),
      manual: rec(num),
      estimate: optional(bool),
      note: optional(str),
      region: optional(oneOf('upper', 'lower', 'sleeves')),
    }),
  ),
  ease: obj({ global: num, per: rec(num) }),
  fit: obj({ cup: oneOf('ab', 'cd', 'ef', 'gh', 'custom'), hem: optional(oneOf('high_hip', 'hip_seat_straight', 'hip_seat_curvy')), broadBack: optional(bool) }),
  garment: obj({ construction: oneOf('panels', 'contiguous'), opening: oneOf('closed', 'cardigan') }),
  tags: arr(str),
  cardigan: optional(
    obj({
      bands: oneOf('separate', 'continuous'),
      attach: obj({ button: bandAttach, buttonhole: bandAttach, continuous: oneOf('pickup', 'sideways') }),
      buttonholeSide: oneOf('left', 'right'),
      overlap: dimExpr,
      closing: dimExpr,
      buttons: obj({ count: num, top: dimExpr, bottom: dimExpr, manual: rec(arr(num)) }),
      buttonhole: obj({ style: oneOf('yo-k2tog', 'symbol'), symbol: str, width: num, note: str }),
    }),
  ),
  edges: optional(obj({ hem: edgeTreatment, cuff: edgeTreatment, neckband: edgeTreatment, frontBands: edgeTreatment })),
  panels: arr(panel),
  joins: optional(arr(obj({ id: str, name: str, tag: oneOf('seam', 'pickup', 'live', 'bindoff', 'caston', 'free'), edges: arr(edgeRef), partner: arr(edgeRef), ratio: nullable(obj({ stitches: num, rows: num })), note: str, edge: optional(edgeId) }))),
  symbols: optional(arr(obj({ id: str, label: str, abbr: str, color: str, change: num }))),
  settings: obj({ seamToleranceCm: num, pickUp: obj({ stitches: num, rows: num }), regionSizing: optional(bool), regionGapLimit: optional(num), hemCheck: optional(bool), exportCredit: optional(bool) }),
  createdAt: str,
  updatedAt: str,
});

export interface ValidationResult {
  errors: string[]; // the project cannot be used
  warnings: string[]; // usable, but something was odd
}

/** Structural check plus cross-references (ids, names, sizes). */
export function validateProject(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  project(raw, 'project', errors);
  if (errors.length) return { errors, warnings };
  const p = raw as Project;

  if (p.sizes.length === 0) errors.push('project.sizes: a project needs at least one size.');
  dupes(p.sizes.map((s) => s.id), 'size id', errors);
  dupes(p.sizes.map((s) => s.name), 'size name', errors);
  const sizeIds = new Set(p.sizes.map((s) => s.id));
  if (p.sizes.length && !sizeIds.has(p.baseSizeId)) errors.push(`project.baseSizeId: "${p.baseSizeId}" is not one of the sizes.`);
  if (!(p.gauge.stitches > 0 && p.gauge.rows > 0)) errors.push('project.gauge: stitches and rows must be greater than 0.');

  dupes(p.measurements.map((m) => m.name), 'measurement name', errors);
  p.measurements.forEach((m, i) => {
    if (!isValidName(m.name)) errors.push(`project.measurements[${i}].name: "${m.name}" is not a valid name (letters, digits, _; not starting with a digit).`);
    for (const k of [...Object.keys(m.table), ...Object.keys(m.manual)]) {
      if (!sizeIds.has(k)) warnings.push(`Measurement "${m.name}" has a value for an unknown size id "${k}"; it will be ignored.`);
    }
  });

  dupes(p.panels.map((x) => x.id), 'panel id', errors);
  p.panels.forEach((panel, pi) => {
    const where = `panel "${panel.name}"`;
    dupes(panel.waypoints.map((w) => w.id), `waypoint id in ${where}`, errors);
    const wpIds = new Set(panel.waypoints.map((w) => w.id));
    panel.segments.forEach((s, si) => {
      if (!wpIds.has(s.fromWaypoint)) errors.push(`project.panels[${pi}].segments[${si}].fromWaypoint: no waypoint "${s.fromWaypoint}" in ${where}.`);
    });
    if (panel.joinAt && !wpIds.has(panel.joinAt)) warnings.push(`Panel "${panel.name}" joins in the round at a waypoint that no longer exists; it is treated as flat.`);
    if (panel.shapingInset < 0) errors.push(`project.panels[${pi}].shapingInset: must be 0 or more.`);
    const pair = panel.half?.pair;
    if (pair) {
      const other = p.panels.find((x) => x.id === pair);
      if (!other?.half || other.half.side === panel.half!.side) warnings.push(`Panel "${panel.name}" is linked to a front that is missing or on the same side; it is treated as unlinked.`);
    }
  });

  return { errors, warnings };
}

function dupes(values: string[], what: string, errors: string[]): void {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) errors.push(`Duplicate ${what}: "${v}".`);
    seen.add(v);
  }
}

// ---------- load / save ----------

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2);
}

export type LoadResult =
  | { ok: true; project: Project; warnings: string[]; migratedFrom: number | null; migrationNotes: string[] }
  | { ok: false; errors: string[] };

const MAX_ERRORS = 25;

export function loadProject(text: string, migrations: Record<number, Migration> = MIGRATIONS): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  const m = migrate(raw, migrations);
  if (m.errors.length) return { ok: false, errors: m.errors };
  const v = validateProject(m.raw);
  if (v.errors.length) {
    const extra = v.errors.length > MAX_ERRORS ? [`…and ${v.errors.length - MAX_ERRORS} more.`] : [];
    return { ok: false, errors: [...v.errors.slice(0, MAX_ERRORS), ...extra] };
  }
  return { ok: true, project: m.raw as Project, warnings: v.warnings, migratedFrom: m.from < SCHEMA_VERSION ? m.from : null, migrationNotes: m.notes };
}
