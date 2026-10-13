// Seeding a project from a sizing table, plus estimated measurements the table doesn't have.

import type { CsvTable } from './csv';
import { DICTIONARY, isEstimatedSource, isLegacyColumn, SOURCE_COLUMN } from './dictionary';
import { newId, newMeasurement, newProject, type Measurement, type Project, type Size } from './model';

/** Labels and kinds for the old (pre-Ysolda) sizing-table columns, still found in older projects and tables. */
const OLD_COLUMNS: Record<string, { label: string; kind: Measurement['kind'] }> = {
  upper_chest: { label: 'Upper chest', kind: 'circumference' },
  bust: { label: 'Bust', kind: 'circumference' },
  waist: { label: 'Waist', kind: 'circumference' },
  full_hip: { label: 'Full hip', kind: 'circumference' },
  cross_chest_back: { label: 'Cross chest / back', kind: 'length' },
  waist_to_armhole: { label: 'Waist to armhole', kind: 'length' },
  back_waist_length: { label: 'Back waist length', kind: 'length' },
  armhole_depth: { label: 'Armhole depth', kind: 'length' },
  bicep: { label: 'Bicep', kind: 'circumference' },
  wrist: { label: 'Wrist', kind: 'circumference' },
  arm_length: { label: 'Arm length', kind: 'length' },
};

/** Labels and kinds for the standard sizing-table columns: the measurement dictionary plus the old names. */
export const STANDARD_COLUMNS: Record<string, { label: string; kind: Measurement['kind'] }> = {
  ...OLD_COLUMNS,
  ...Object.fromEntries(DICTIONARY.map((d) => [d.name, { label: d.label, kind: d.kind }])),
};

/**
 * Old measurement names the templates still use, derived from the new (Ysolda) columns when a table has them.
 * Seeded only when every column they need is in the table and the old name is not.
 */
export const DERIVED_FROM_NEW: Record<string, { expr: string; needs: string[] }> = {
  bust: { expr: 'bust_cd_cup', needs: ['bust_cd_cup'] },
  full_hip: { expr: 'hip_seat_straight', needs: ['hip_seat_straight'] },
  cross_chest_back: { expr: 'cross_back', needs: ['cross_back'] },
  waist_to_armhole: {
    expr: 'back_neck_drop + back_waist_length - shoulder_drop - armhole_depth',
    needs: ['back_neck_drop', 'back_waist_length', 'shoulder_drop', 'armhole_depth'],
  },
  shoulder_width: { expr: 'back_shoulder_width', needs: ['back_shoulder_width'] },
  neck_width: { expr: 'back_neck_width', needs: ['back_neck_width'] },
  back_neck_depth: { expr: 'back_neck_drop', needs: ['back_neck_drop'] },
  front_neck_depth: { expr: 'front_neck_drop', needs: ['front_neck_drop'] },
  shoulder_slope: { expr: 'shoulder_drop', needs: ['shoulder_drop'] },
  bust_point_depth: { expr: 'hps_to_apex', needs: ['hps_to_apex'] },
  apex_to_apex: { expr: 'apex_to_apex_d', needs: ['apex_to_apex_d'] },
  hem_to_waist: { expr: 'waist_to_high_hip', needs: ['waist_to_high_hip'] },
};

/**
 * Measurements not in the sizing table, seeded as graded estimates (cm). All flagged `estimate`
 * so the UI can mark them for checking. Expressions refer to table columns.
 */
export const ESTIMATED_MEASUREMENTS: { name: string; label: string; expr: string; note: string }[] = [
  { name: 'shoulder_width', label: 'Shoulder width', expr: 'round(cross_chest_back + 3, 0.5)', note: 'Shoulder point to shoulder point across the back.' },
  { name: 'neck_width', label: 'Back neck width', expr: 'round(13 + upper_chest * 0.03, 0.5)', note: 'Width of the neck opening at the top of the back.' },
  { name: 'back_neck_depth', label: 'Back neck depth', expr: '2', note: 'Drop of the back neckline below the shoulder line.' },
  { name: 'front_neck_depth', label: 'Front neck depth', expr: 'round(5.5 + upper_chest * 0.02, 0.5)', note: 'Crew-neck depth below the shoulder line.' },
  { name: 'shoulder_slope', label: 'Shoulder slope', expr: 'round(1.5 + upper_chest * 0.012, 0.5)', note: 'Height difference between the neck side and the shoulder point.' },
  { name: 'hem_to_waist', label: 'Hem to waist', expr: '15', note: 'Length of the body below the natural waist.' },
  { name: 'bust_point_depth', label: 'Shoulder to bust point', expr: 'round(20 + bust * 0.07, 0.5)', note: 'High point of shoulder down to the bust apex.' },
  { name: 'apex_to_apex', label: 'Apex to apex', expr: 'round(14 + bust * 0.04, 0.5)', note: 'Horizontal distance between bust points.' },
  { name: 'cap_height', label: 'Sleeve cap height', expr: 'round(armhole_depth * 0.65, 0.5)', note: 'Set-in sleeve cap height (not used by the set-in template, which fits the cap to the armhole).' },
  { name: 'underarm_co', label: 'Underarm cast-on', expr: 'round(upper_chest * 0.05, 0.5)', note: 'Width cast on at each underarm to join front and back (cm, front and back together: half each). Top-down, shoulders-first tops.' },
  { name: 'cap_ease', label: 'Sleeve cap ease', expr: '1.5', note: 'How much longer the cap edge is than the armhole it is sewn into (cm, both sides together).' },
  {
    name: 'waist_shift',
    label: 'Waist shift (back → front)',
    expr: '(bust - waist) / 4',
    note: 'Share of the bust-to-waist narrowing taken by the back: back waist = waist/2 + ease/2 − waist_shift, front waist = waist/2 + ease/2 + waist_shift.',
  },
];

export function estimatedMeasurements(): Measurement[] {
  return ESTIMATED_MEASUREMENTS.map((e) => ({
    ...newMeasurement(e.name, e.label),
    rule: { type: 'expression', expr: e.expr },
    estimate: true,
    note: e.note,
  }));
}

/** Add any estimated measurements that are missing (e.g. when a template needs one an older project lacks). */
export function ensureEstimates(project: Project, names: string[]): { project: Project; added: string[] } {
  const have = new Set(project.measurements.map((m) => m.name));
  const add = estimatedMeasurements().filter((m) => names.includes(m.name) && !have.has(m.name));
  if (!add.length) return { project, added: [] };
  return { project: { ...project, measurements: [...project.measurements, ...add] }, added: add.map((m) => m.name) };
}

export interface SeedResult {
  project: Project;
  warnings: string[];
}

/**
 * Build a project from a sizing table that already uses measurement names as headers
 * (first column = size). The mapping UI in the importer produces this shape.
 */
export function projectFromTable(table: CsvTable, name = 'Untitled top', baseSizeName = 'M'): SeedResult {
  const warnings: string[] = [];
  const project = newProject(name);
  const sizeCol = table.headers.findIndex((h) => h.toLowerCase() === 'size');
  const col = sizeCol >= 0 ? sizeCol : 0;
  const sourceCol = table.headers.findIndex((h, i) => i !== col && h.toLowerCase() === SOURCE_COLUMN);

  const sizes: Size[] = table.rows.map((r) => ({ id: newId('size'), name: r[col], ...(sourceCol >= 0 && isEstimatedSource(r[sourceCol] ?? '') ? { estimated: true } : {}) }));
  project.sizes = sizes;
  project.baseSizeId = (sizes.find((s) => s.name === baseSizeName) ?? sizes[Math.floor(sizes.length / 2)])?.id ?? '';

  project.measurements = table.headers
    .map((h, i) => [h, i] as const)
    .filter(([h, i]) => i !== col && i !== sourceCol && !isLegacyColumn(h))
    .map(([h, i]) => {
      const std = STANDARD_COLUMNS[h];
      const m = newMeasurement(h, std?.label ?? h, std?.kind ?? 'length');
      table.rows.forEach((r, ri) => {
        const v = Number(r[i]);
        if (r[i] === '' || r[i] === undefined) return;
        if (Number.isFinite(v)) m.table[sizes[ri].id] = v;
        else warnings.push(`"${r[i]}" for ${h} in size ${sizes[ri].name} is not a number; skipped.`);
      });
      return m;
    });

  const existing = new Set(project.measurements.map((m) => m.name));
  const derive = (n: string) => {
    const d = DERIVED_FROM_NEW[n];
    return d && !existing.has(n) && d.needs.every((x) => existing.has(x)) ? d : null;
  };
  // Old names the templates use, from the new columns.
  for (const n of ['bust', 'full_hip', 'cross_chest_back', 'waist_to_armhole']) {
    const d = derive(n);
    if (!d) continue;
    const std = STANDARD_COLUMNS[n];
    project.measurements.push({ ...newMeasurement(n, std.label, std.kind), rule: { type: 'expression', expr: d.expr }, note: `Derived from the sizing table: ${d.expr}.` });
  }
  const have = new Set(project.measurements.map((m) => m.name));
  for (const e of estimatedMeasurements()) {
    if (have.has(e.name)) continue;
    const d = derive(e.name);
    project.measurements.push(d ? { ...e, rule: { type: 'expression', expr: d.expr }, estimate: false, note: `Derived from the sizing table: ${d.expr}.` } : e);
  }
  return { project, warnings };
}
