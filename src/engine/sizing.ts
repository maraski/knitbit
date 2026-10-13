// Importing a sizing table (CSV or JSON) into a project, with a column mapping.
// One row per size; one column per measurement; one column holds the size name.

import { parseCsv, type CsvTable } from './csv';
import { dictionaryEntry, isEstimatedSource, isLegacyColumn, SOURCE_COLUMN } from './dictionary';
import { isValidName } from './expr';
import { removeSize } from './grading';
import { newId, newMeasurement, type Id, type Measurement, type Project } from './model';
import { STANDARD_COLUMNS } from './seed';
import { CM_PER_INCH } from './units';

// ---------- reading ----------

export type ReadResult = { ok: true; table: CsvTable; format: 'csv' | 'json' } | { ok: false; error: string };

/** Read CSV or JSON text into a table. JSON may be an array of row objects, `{ sizes: [...] }`, or `{ "S": {...}, … }`. */
export function readSizingTable(text: string, filename = ''): ReadResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'The file is empty.' };
  const looksJson = /\.json$/i.test(filename) || trimmed.startsWith('{') || trimmed.startsWith('[');
  if (!looksJson) {
    const table = parseCsv(text);
    if (table.headers.length < 2) return { ok: false, error: 'Expected at least two columns (size and one measurement).' };
    if (table.rows.length === 0) return { ok: false, error: 'The table has a header row but no sizes.' };
    return { ok: true, table, format: 'csv' };
  }
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (isObj(data) && 'schemaVersion' in data && 'panels' in data) {
    return { ok: false, error: 'This is a Knitbit project file. Use Open to load it.' };
  }
  let rows: Record<string, unknown>[] | null = null;
  if (Array.isArray(data)) rows = data.filter(isObj);
  else if (isObj(data) && Array.isArray(data.sizes)) rows = data.sizes.filter(isObj);
  else if (isObj(data) && Object.values(data).every(isObj)) {
    rows = Object.entries(data).map(([size, v]) => ({ size, ...(v as Record<string, unknown>) }));
  }
  if (!rows || rows.length === 0) return { ok: false, error: 'Expected a list of sizes, e.g. [{"size": "S", "bust": 90}, …].' };
  const headers: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!headers.includes(k)) headers.push(k);
  const sizeIdx = headers.findIndex((h) => normalize(h) === 'size' || normalize(h) === 'name');
  if (sizeIdx > 0) headers.unshift(...headers.splice(sizeIdx, 1));
  return {
    ok: true,
    format: 'json',
    table: { headers, rows: rows.map((r) => headers.map((h) => (r[h] === undefined || r[h] === null ? '' : String(r[h])))) },
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------- mapping ----------

export type ColumnTarget =
  | { kind: 'ignore' }
  | { kind: 'size' }
  /** Where each row came from ("table" / "estimated"); estimated rows are marked on the size. */
  | { kind: 'source' }
  | { kind: 'measurement'; name: string } // existing or new; new ones are created on import
  ;

const SYNONYMS: Record<string, string[]> = {
  size: ['size', 'sizes', 'name', 'size_name'],
  upper_chest: ['upper_chest', 'upper_bust', 'high_bust', 'upper_torso', 'highbust', 'upperchest'],
  bust: ['bust', 'full_bust', 'chest', 'bust_circumference'],
  waist: ['waist', 'natural_waist', 'waist_circumference'],
  full_hip: ['full_hip', 'hip', 'hips', 'low_hip', 'fullhip'],
  cross_chest_back: ['cross_chest_back', 'cross_back', 'back_width', 'cross_chest', 'across_back'],
  waist_to_armhole: ['waist_to_armhole', 'waist_to_underarm', 'side_length', 'underarm_to_waist'],
  back_waist_length: ['back_waist_length', 'back_waist', 'nape_to_waist', 'back_length'],
  armhole_depth: ['armhole_depth', 'armhole', 'armscye_depth'],
  bicep: ['bicep', 'biceps', 'upper_arm', 'upper_arm_circumference'],
  wrist: ['wrist'],
  arm_length: ['arm_length', 'sleeve_length', 'arm'],
};

export function normalize(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** A valid, unused measurement name from a column header. */
export function nameFromHeader(header: string, taken: Set<string>): string {
  let base = normalize(header) || 'measurement';
  if (/^[0-9]/.test(base)) base = `m_${base}`;
  if (!isValidName(base)) base = `m_${base}`;
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  return name;
}

/**
 * Guess what each column is: the size column, the row source, a known measurement, or a new measurement.
 * Exact header names (dictionary or existing measurements) win; legacy columns are left unmapped.
 */
export function suggestMapping(table: CsvTable, project: Project): ColumnTarget[] {
  const existing = project.measurements;
  const taken = new Set(existing.map((m) => m.name));
  let sizeFound = false;
  let sourceFound = false;
  const exact = new Set<string>();
  return table.headers.map((h, i) => {
    const n = normalize(h);
    if (!sizeFound && (SYNONYMS.size.includes(n) || (i === 0 && looksLikeSizeColumn(table, i)))) {
      sizeFound = true;
      return { kind: 'size' };
    }
    if (!sourceFound && h.trim().toLowerCase() === SOURCE_COLUMN) {
      sourceFound = true;
      return { kind: 'source' };
    }
    if (isLegacyColumn(h.trim())) return { kind: 'ignore' };
    const header = h.trim();
    if (!exact.has(header) && (dictionaryEntry(header) || existing.some((m) => m.name === header))) {
      exact.add(header);
      taken.add(header);
      return { kind: 'measurement', name: header };
    }
    const direct = existing.find((m) => m.name === n || normalize(m.label) === n);
    if (direct) return { kind: 'measurement', name: direct.name };
    for (const [name, syn] of Object.entries(SYNONYMS)) {
      if (name !== 'size' && syn.includes(n)) return { kind: 'measurement', name };
    }
    if (table.rows.every((r) => r[i] === '' || parseNumber(r[i]) === null)) return { kind: 'ignore' };
    const name = nameFromHeader(h, taken);
    taken.add(name);
    return { kind: 'measurement', name };
  });
}

function looksLikeSizeColumn(table: CsvTable, i: number): boolean {
  return table.rows.some((r) => r[i] !== '' && parseNumber(r[i]) === null);
}

export function parseNumber(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ---------- applying ----------

export interface ImportOptions {
  units: 'cm' | 'in';
  /** merge: update matching sizes, add new ones. replace: the project's sizes become exactly the table's. */
  mode: 'merge' | 'replace';
}

export interface ImportReport {
  sizesMatched: string[];
  sizesAdded: string[];
  sizesRemoved: string[];
  measurementsCreated: string[];
  estimatedSizes: string[]; // rows marked "estimated" in the source column
  valuesSet: number;
  warnings: string[];
}

export function validateMapping(table: CsvTable, mapping: ColumnTarget[]): string[] {
  const errors: string[] = [];
  const sizeCols = mapping.filter((m) => m.kind === 'size').length;
  if (sizeCols !== 1) errors.push(sizeCols === 0 ? 'Choose which column holds the size names.' : 'Only one column can be the size column.');
  if (mapping.filter((m) => m.kind === 'source').length > 1) errors.push('Only one column can be the row source.');
  const names = mapping.flatMap((m) => (m.kind === 'measurement' ? [m.name] : []));
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) errors.push(`Two columns are mapped to "${dup}".`);
  for (const n of names) if (!isValidName(n) || n.includes('.')) errors.push(`"${n}" is not a valid measurement name.`);
  if (!names.length) errors.push('Map at least one column to a measurement.');
  const sizeIdx = mapping.findIndex((m) => m.kind === 'size');
  if (sizeIdx >= 0) {
    const sizes = table.rows.map((r) => r[sizeIdx].trim());
    if (sizes.some((s) => s === '')) errors.push('Some rows have no size name.');
    const dupSize = sizes.find((s, i) => s && sizes.indexOf(s) !== i);
    if (dupSize) errors.push(`Size "${dupSize}" appears twice.`);
  }
  return errors;
}

export function applyImport(project: Project, table: CsvTable, mapping: ColumnTarget[], opts: ImportOptions): { project: Project; report: ImportReport } {
  const report: ImportReport = { sizesMatched: [], sizesAdded: [], sizesRemoved: [], measurementsCreated: [], estimatedSizes: [], valuesSet: 0, warnings: [] };
  let d = structuredClone(project);
  const sizeIdx = mapping.findIndex((m) => m.kind === 'size');
  const factor = opts.units === 'in' ? CM_PER_INCH : 1;

  // Sizes: match by name (case-insensitive), keeping ids so overrides survive.
  const rowSizeIds: Id[] = [];
  const byName = new Map(d.sizes.map((s) => [s.name.toLowerCase(), s]));
  const ordered = [];
  for (const r of table.rows) {
    const name = r[sizeIdx].trim();
    const found = byName.get(name.toLowerCase());
    if (found) {
      report.sizesMatched.push(found.name);
      rowSizeIds.push(found.id);
      ordered.push(found);
    } else {
      const s = { id: newId('size'), name };
      report.sizesAdded.push(name);
      rowSizeIds.push(s.id);
      ordered.push(s);
      d.sizes.push(s);
    }
  }
  if (opts.mode === 'replace') {
    for (const s of project.sizes) {
      if (!rowSizeIds.includes(s.id)) {
        d = removeSize({ ...d, sizes: [...d.sizes] }, s.id);
        report.sizesRemoved.push(s.name);
      }
    }
    d.sizes = ordered; // table order
    if (!d.sizes.some((s) => s.id === d.baseSizeId)) d.baseSizeId = d.sizes[Math.floor(d.sizes.length / 2)].id;
  }
  if (!d.sizes.some((s) => s.id === d.baseSizeId)) d.baseSizeId = d.sizes[0].id;

  // Row source: mark estimated rows on their size.
  const sourceIdx = mapping.findIndex((m) => m.kind === 'source');
  if (sourceIdx >= 0) {
    table.rows.forEach((r, ri) => {
      const s = d.sizes.find((x) => x.id === rowSizeIds[ri]);
      if (!s) return;
      if (isEstimatedSource(r[sourceIdx] ?? '')) {
        s.estimated = true;
        report.estimatedSizes.push(s.name);
      } else delete s.estimated;
    });
  }

  // Measurements.
  mapping.forEach((target, col) => {
    if (target.kind !== 'measurement') return;
    let m: Measurement | undefined = d.measurements.find((x) => x.name === target.name);
    if (!m) {
      const std = STANDARD_COLUMNS[target.name];
      m = newMeasurement(target.name, std?.label ?? table.headers[col], std?.kind ?? (/hip|bust|chest|waist|bicep|wrist|circ/i.test(target.name) ? 'circumference' : 'length'));
      d.measurements.push(m);
      report.measurementsCreated.push(target.name);
    }
    if (opts.mode === 'replace') m.table = {};
    table.rows.forEach((r, ri) => {
      const raw = r[col] ?? '';
      if (raw.trim() === '') return;
      const v = parseNumber(raw);
      if (v === null) {
        report.warnings.push(`"${raw}" for ${target.name} in size ${r[sizeIdx]} is not a number; skipped.`);
        return;
      }
      m!.table[rowSizeIds[ri]] = Math.round(v * factor * 1e4) / 1e4;
      report.valuesSet++;
    });
    if (m.estimate) {
      m.estimate = false; // now backed by real data
    }
  });

  return { project: d, report };
}

export function describeReport(r: ImportReport): string[] {
  const lines: string[] = [];
  lines.push(`${r.valuesSet} values imported.`);
  if (r.sizesMatched.length) lines.push(`Updated sizes: ${r.sizesMatched.join(', ')}.`);
  if (r.sizesAdded.length) lines.push(`Added sizes: ${r.sizesAdded.join(', ')}.`);
  if (r.sizesRemoved.length) lines.push(`Removed sizes: ${r.sizesRemoved.join(', ')}.`);
  if (r.measurementsCreated.length) lines.push(`New measurements: ${r.measurementsCreated.join(', ')}.`);
  if (r.estimatedSizes.length) lines.push(`Estimated rows (marked “est.”): ${r.estimatedSizes.join(', ')}.`);
  return [...lines, ...r.warnings];
}
