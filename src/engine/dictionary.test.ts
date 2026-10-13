import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { DICTIONARY, dictionaryEntry, isLegacyColumn, measurementTooltip } from './dictionary';
import { resolveMeasurements } from './measurements';
import { newProject } from './model';
import { projectFromTable } from './seed';
import { applyImport, describeReport, readSizingTable, suggestMapping, validateMapping } from './sizing';
import { sizeId, YSOLDA_CSV } from './testFixtures';

const table = parseCsv(YSOLDA_CSV);

describe('measurement dictionary', () => {
  it('covers every column of the shipped table', () => {
    const cols = table.headers.filter((h) => h !== 'size' && h !== 'source');
    expect(cols.filter((c) => !dictionaryEntry(c))).toEqual([]);
    expect(cols).toHaveLength(DICTIONARY.length);
  });

  it('gives each entry a category, region, definition and tooltip', () => {
    for (const d of DICTIONARY) {
      expect(d.definition.length, d.name).toBeGreaterThan(5);
      expect(d.tooltip.length, d.name).toBeGreaterThan(d.definition.length - 1);
    }
    expect(dictionaryEntry('bicep')?.region).toBe('sleeves');
    expect(dictionaryEntry('waist_to_full_hip')?.region).toBe('lower');
    expect(dictionaryEntry('back_waist_length')?.region).toBe('upper');
    expect(dictionaryEntry('bust_cd_cup')?.kind).toBe('circumference');
    expect(measurementTooltip({ name: 'hps_to_apex', label: 'x' })).toMatch(/high point shoulder/);
  });

  it('marks the legacy columns', () => {
    expect(table.headers.filter(isLegacyColumn)).toEqual(['legacy_bust_merged', 'legacy_full_hip', 'legacy_cross_chest_back', 'legacy_waist_to_armhole']);
  });
});

describe('importing the Ysolda table', () => {
  it('reads 11 sizes, 4XS to 4X', () => {
    const r = readSizingTable(YSOLDA_CSV, 'sizing_table_ysolda_cm.csv');
    if (!r.ok) throw new Error(r.error);
    expect(r.table.rows.map((x) => x[0])).toEqual(['4XS', '3XS', '2XS', 'XS', 'S', 'M', 'L', '1X', '2X', '3X', '4X']);
  });

  it('auto-maps by exact header name, the source column, and leaves legacy columns unmapped', () => {
    const m = suggestMapping(table, newProject());
    const at = (h: string) => m[table.headers.indexOf(h)];
    expect(at('size')).toEqual({ kind: 'size' });
    expect(at('source')).toEqual({ kind: 'source' });
    expect(at('cross_back')).toEqual({ kind: 'measurement', name: 'cross_back' }); // not the old cross_chest_back synonym
    expect(at('bust_gh_cup')).toEqual({ kind: 'measurement', name: 'bust_gh_cup' });
    expect(at('apex_to_apex_h')).toEqual({ kind: 'measurement', name: 'apex_to_apex_h' });
    for (const h of table.headers.filter(isLegacyColumn)) expect(at(h)).toEqual({ kind: 'ignore' });
    expect(validateMapping(table, m)).toEqual([]);
  });

  it('imports values in cm and marks the estimated row', () => {
    const p = newProject();
    const { project, report } = applyImport(p, table, suggestMapping(table, p), { units: 'cm', mode: 'replace' });
    expect(project.sizes.filter((s) => s.estimated).map((s) => s.name)).toEqual(['4XS']);
    expect(report.estimatedSizes).toEqual(['4XS']);
    expect(describeReport(report).join(' ')).toMatch(/Estimated rows.*4XS/);
    expect(project.measurements.some((x) => x.name.startsWith('legacy_'))).toBe(false);
    const v = resolveMeasurements(project, sizeId(project, 'M')).values;
    expect(v.upper_chest.value).toBe(114.5);
    expect(v.bust_cd_cup.value).toBe(122);
    expect(v.shoulder_drop.value).toBe(4.5);
    expect(project.measurements.find((x) => x.name === 'bicep')?.kind).toBe('circumference');
    expect(project.measurements.find((x) => x.name === 'cross_front')?.label).toBe('Cross front');
  });

  it('clears the estimated mark when a later import says the row is from the table', () => {
    const p = applyImport(newProject(), table, suggestMapping(table, newProject()), { units: 'cm', mode: 'replace' }).project;
    const r = readSizingTable('size,source,upper_chest\n4XS,table,64');
    if (!r.ok) throw new Error(r.error);
    const next = applyImport(p, r.table, suggestMapping(r.table, p), { units: 'cm', mode: 'merge' }).project;
    expect(next.sizes.find((s) => s.name === '4XS')?.estimated).toBeUndefined();
  });

  it('seeds the sample project without legacy columns, deriving the names the templates still use', () => {
    const { project, warnings } = projectFromTable(table, 'Sample');
    expect(warnings).toEqual([]);
    expect(project.sizes).toHaveLength(11);
    expect(project.sizes.find((s) => s.name === '4XS')?.estimated).toBe(true);
    expect(project.measurements.some((x) => x.name === 'source' || x.name.startsWith('legacy_'))).toBe(false);
    const v = resolveMeasurements(project, sizeId(project, 'M')).values;
    expect(v.waist_to_armhole.value).toBeCloseTo(19.5); // 2.75 + 42 − 4.5 − 20.75
    expect(v.cross_chest_back.value).toBe(40);
    expect(v.shoulder_width.value).toBe(43.25);
    expect(project.measurements.find((x) => x.name === 'shoulder_width')?.estimate).toBe(false);
  });
});
