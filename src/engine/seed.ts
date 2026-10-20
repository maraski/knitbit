// Seeding a project from a sizing table, plus estimated measurements the table doesn't have (estimates.ts).

import type { CsvTable } from './csv';
import { DICTIONARY, isEstimatedSource, isLegacyColumn, SOURCE_COLUMN } from './dictionary';
import { DERIVED_FROM_NEW, derivedMeasurement, estimatedMeasurements } from './estimates';
import { fitAliases } from './fit';
import { LEGACY_RENAMES, migrateV1toV2 } from './legacy';
import { newId, newMeasurement, newProject, type Measurement, type Project, type Size } from './model';

export { DERIVED_FROM_NEW, ensureEstimates, ESTIMATED_MEASUREMENTS, estimatedMeasurements } from './estimates';

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

  // An older table (single bust column, old names): map it to the new names like an old project file.
  let seeded: Project = project;
  if (project.measurements.some((m) => m.name === 'bust' || m.name in LEGACY_RENAMES)) {
    const notes: string[] = [];
    seeded = migrateV1toV2(project, notes);
    warnings.push(...notes);
  }

  const existing = new Set(seeded.measurements.map((m) => m.name));
  for (const [n, d] of Object.entries(DERIVED_FROM_NEW)) {
    if (existing.has(n) || !d.needs.every((x) => existing.has(x))) continue;
    seeded.measurements.push(derivedMeasurement(n));
    existing.add(n);
  }
  const covered = new Set([...existing, ...Object.keys(fitAliases(seeded))]);
  seeded.measurements.push(...estimatedMeasurements().filter((e) => !covered.has(e.name)));
  return { project: seeded, warnings };
}

