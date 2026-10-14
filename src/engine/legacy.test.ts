import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { closestCup } from './fit';
import { LEGACY_RENAMES } from './legacy';
import { resolveMeasurements } from './measurements';
import { newMeasurement, SCHEMA_VERSION, type Project } from './model';
import { computePanel } from './panel';
import { loadProject } from './schema';
import { projectFromTable } from './seed';
import { applyImport, suggestMapping } from './sizing';
import { sizeId, YSOLDA_CSV } from './testFixtures';

// A real schema-1 project, saved by Knitbit before the Ysolda table: old sample table, Back + Front + Sleeve,
// a manual cross_chest_back in M, a custom measurement using old names, ease.bust, and a per-size hem override.
const V1_TEXT = readFileSync(fileURLToPath(new URL('./fixtures/project_v1.json', import.meta.url)), 'utf8');
const V1 = JSON.parse(V1_TEXT);

function load(text: string) {
  const r = loadProject(text);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r;
}

const oldTable = (name: string, size: string) => {
  const sid = V1.sizes.find((s: { name: string }) => s.name === size).id;
  return V1.measurements.find((m: { name: string }) => m.name === name).table[sid];
};

describe('schema 1 → 2 migration', () => {
  it('loads an old project and says it was upgraded', () => {
    expect(V1.schemaVersion).toBe(1);
    const r = load(V1_TEXT);
    expect(r.migratedFrom).toBe(1);
    expect(r.project.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r.warnings).toEqual([]);
  });

  it('renames the old measurements and every reference to them', () => {
    const { project: p, migrationNotes } = load(V1_TEXT);
    const names = p.measurements.map((m) => m.name);
    for (const [from, to] of Object.entries(LEGACY_RENAMES)) {
      expect(names, from).not.toContain(from);
      expect(names, to).toContain(to);
      expect(migrationNotes.join('\n')).toContain(`Renamed ${from} → ${to}`);
    }
    for (const kept of ['waist', 'upper_chest', 'bicep', 'wrist', 'arm_length', 'armhole_depth', 'back_waist_length', 'waist_to_armhole']) expect(names).toContain(kept);
    expect(p.measurements.find((m) => m.name === 'hip_seat_straight')!.label).toBe('Hip / seat (straight)');
    expect(p.measurements.find((m) => m.name === 'my_length')!.rule).toEqual({ type: 'expression', expr: 'hip_seat_straight / 4 + back_shoulder_width' });
    const all = JSON.stringify(p.panels);
    for (const from of Object.keys(LEGACY_RENAMES)) expect(all).not.toMatch(new RegExp(`\\b${from}\\b`));
    // Manual values survive the rename.
    expect(resolveMeasurements(p, sizeId(p, 'M')).values.cross_back).toEqual({ value: 39, source: 'manual' });
  });

  it('maps the old bust to the closest cup column, says which, and notes the per-size mix', () => {
    const { project: p, migrationNotes } = load(V1_TEXT);
    expect(p.fit.cup).toBe('ef');
    expect(p.measurements.some((m) => m.name === 'bust')).toBe(false);
    expect(p.measurements.find((m) => m.name === 'bust_ef_cup')?.label).toBe('Bust (E/F cup)');
    const text = migrationNotes.join('\n');
    expect(text).toMatch(/Old bust → bust_ef_cup: the average bust − upper chest is 10\.18 cm, closest to E\/F/);
    expect(text).toMatch(/different cups in different sizes: 3XS A\/B, .*4X G\/H/);
    expect(text).toMatch(/cup choice is set to E\/F/);
    // Expressions still say `bust` and get the same values.
    expect(JSON.stringify(p.panels)).toMatch(/\bbust\b/);
    for (const size of ['3XS', 'M', '4X']) expect(resolveMeasurements(p, sizeId(p, size)).values.bust.value).toBe(oldTable('bust', size));
    expect(p.ease.per.bust).toBe(6);
  });

  it('keeps waist_to_armhole as a custom measurement and reports it', () => {
    const { project: p, migrationNotes } = load(V1_TEXT);
    const m = p.measurements.find((x) => x.name === 'waist_to_armhole')!;
    expect(m.table[sizeId(p, 'M')]).toBe(oldTable('waist_to_armhole', 'M'));
    expect(migrationNotes).toContain('waist_to_armhole kept as a custom measurement (it is not in the new sizing table).');
  });

  it('keeps every value: panels compute with the same numbers and without errors', () => {
    const { project: p } = load(V1_TEXT);
    for (const s of p.sizes) {
      expect(resolveMeasurements(p, s.id).errors, s.name).toEqual({});
      expect(resolveMeasurements(p, s.id).values.hip_seat_straight.value).toBe(oldTable('full_hip', s.name));
      for (const panel of p.panels) {
        const c = computePanel(p, panel, s.id);
        expect(c.issues.filter((i) => i.severity === 'error'), `${panel.name} ${s.name}`).toEqual([]);
      }
    }
    const back = computePanel(p, p.panels[0], sizeId(p, 'M'));
    expect(back.waypoints[0].widthCm).toBe(64); // per-size override kept
  });

  it('removes copies of new columns left by projects seeded from the new table before schema 2', () => {
    const { project } = projectFromTable(parseCsv(YSOLDA_CSV), 'M1 top');
    const copy = (name: string, expr: string) => ({ ...newMeasurement(name), rule: { type: 'expression' as const, expr } });
    const v1: Project = {
      ...project,
      schemaVersion: 1,
      measurements: [...project.measurements, copy('bust', 'bust_gh_cup'), copy('shoulder_width', 'back_shoulder_width')],
    };
    delete (v1 as Partial<Project>).fit;
    const { project: p, migrationNotes } = load(JSON.stringify(v1));
    expect(p.fit.cup).toBe('gh');
    expect(p.measurements.filter((m) => ['bust', 'shoulder_width', 'back_shoulder_width_old'].includes(m.name))).toEqual([]);
    expect(migrationNotes.join('\n')).toMatch(/shoulder_width was a copy of back_shoulder_width/);
    expect(migrationNotes.join('\n')).toMatch(/bust was a copy of bust_gh_cup.*G\/H/);
  });

  it('keeps an old measurement with its own values when the new name is taken', () => {
    const { project } = projectFromTable(parseCsv(YSOLDA_CSV), 'Both');
    const own = { ...newMeasurement('shoulder_width'), table: { [sizeId(project, 'M')]: 40 } };
    const v1 = { ...project, schemaVersion: 1, measurements: [...project.measurements, own] };
    const { project: p, migrationNotes } = load(JSON.stringify(v1));
    expect(p.measurements.find((m) => m.name === 'back_shoulder_width_old')?.table[sizeId(p, 'M')]).toBe(40);
    expect(p.measurements.find((m) => m.name === 'back_shoulder_width')?.table[sizeId(p, 'M')]).toBe(43.25);
    expect(migrationNotes.join('\n')).toMatch(/renamed it back_shoulder_width_old/);
  });

  it('leaves a malformed old file to validation instead of failing inside the migration', () => {
    const r = loadProject(JSON.stringify({ schemaVersion: 1, measurements: 'oops' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).not.toMatch(/Migration .* failed/);
  });

  it('can take the new table afterwards, merged by size name', () => {
    const { project: old } = load(V1_TEXT);
    const table = parseCsv(YSOLDA_CSV);
    const { project: p, report } = applyImport(old, table, suggestMapping(table, old), { units: 'cm', mode: 'merge' });
    expect(report.sizesAdded).toEqual(['4XS']);
    const M = resolveMeasurements(p, sizeId(p, 'M')).values;
    expect(M.hip_seat_straight.value).toBe(124.5); // the new table's value
    expect(M.cross_back).toEqual({ value: 39, source: 'manual' }); // manual values still win
    expect(M.bust.value).toBe(124.5); // E/F, the migrated cup
    expect(p.measurements.find((m) => m.name === 'back_neck_width')?.estimate).toBe(false);
    // The kept custom measurement has no 4XS value: the import says so.
    expect(report.warnings).toContain('New size 4XS has no value for waist_to_armhole; type one in the grid or give it a grading rule.');
    for (const s of p.sizes.filter((x) => x.name !== '4XS')) for (const panel of p.panels) expect(computePanel(p, panel, s.id).issues.filter((i) => i.severity === 'error'), `${panel.name} ${s.name}`).toEqual([]);
  });

  it('picks the closest cup by bust − upper chest', () => {
    expect([4, 6.2, 6.3, 9, 11.2, 20].map(closestCup)).toEqual(['ab', 'ab', 'cd', 'ef', 'ef', 'gh']);
  });
});
