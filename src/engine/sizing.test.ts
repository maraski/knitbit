import { describe, expect, it } from 'vitest';
import { renameReferences } from './expr';
import {
  addSize,
  convertToIncrementRule,
  measurementUsage,
  moveSize,
  removeSize,
  renameMeasurement,
  setBaseSize,
  trendFlags,
  uniformSteps,
  validateNewName,
} from './grading';
import { resolveMeasurements } from './measurements';
import { dim } from './model';
import { computePanel } from './panel';
import { applyImport, readSizingTable, suggestMapping, validateMapping } from './sizing';
import { backBodice } from './templates';
import { fixtureProject, SAMPLE_CSV, sizeId } from './testFixtures';

const values = (p: ReturnType<typeof fixtureProject>, name: string) => p.sizes.map((s) => resolveMeasurements(p, s.id).values[name]?.value);

describe('reading sizing tables', () => {
  it('reads the sample CSV', () => {
    const r = readSizingTable(SAMPLE_CSV, 'sizing_table_cm.csv');
    expect(r.ok && r.format).toBe('csv');
    expect(r.ok && r.table.rows).toHaveLength(10);
  });

  it('reads JSON in three shapes', () => {
    const a = readSizingTable('[{"bust": 90, "size": "S"}, {"size": "M", "bust": 100}]');
    expect(a.ok && a.table).toEqual({ headers: ['size', 'bust'], rows: [['S', '90'], ['M', '100']] });
    const b = readSizingTable('{"sizes": [{"size": "S", "bust": 90}]}');
    expect(b.ok && b.table.rows).toEqual([['S', '90']]);
    const c = readSizingTable('{"S": {"bust": 90}, "M": {"bust": 100, "waist": 80}}');
    expect(c.ok && c.table).toEqual({ headers: ['size', 'bust', 'waist'], rows: [['S', '90', ''], ['M', '100', '80']] });
  });

  it('explains bad input', () => {
    expect(readSizingTable('')).toEqual({ ok: false, error: 'The file is empty.' });
    expect(readSizingTable('{ nope')).toMatchObject({ ok: false, error: expect.stringMatching(/Not valid JSON/) });
    expect(readSizingTable('{"schemaVersion": 1, "panels": []}')).toMatchObject({ ok: false, error: expect.stringMatching(/project file/) });
    expect(readSizingTable('size\nS')).toMatchObject({ ok: false });
  });
});

describe('column mapping', () => {
  it('recognises the standard columns and synonyms', () => {
    const p = fixtureProject();
    const r = readSizingTable('Size,Full Bust (cm),High bust,Hips,Shoulder to shoulder,Notes\nS,90,85,95,38,petite');
    if (!r.ok) throw new Error(r.error);
    const m = suggestMapping(r.table, p);
    expect(m).toEqual([
      { kind: 'size' },
      { kind: 'measurement', name: 'bust' },
      { kind: 'measurement', name: 'upper_chest' },
      { kind: 'measurement', name: 'full_hip' },
      { kind: 'measurement', name: 'shoulder_to_shoulder' },
      { kind: 'ignore' },
    ]);
  });

  it('validates mappings', () => {
    const r = readSizingTable('size,bust\nS,90\nS,92');
    if (!r.ok) throw new Error(r.error);
    expect(validateMapping(r.table, [{ kind: 'ignore' }, { kind: 'measurement', name: 'bust' }])).toContain('Choose which column holds the size names.');
    expect(validateMapping(r.table, [{ kind: 'size' }, { kind: 'measurement', name: 'bust' }])).toContain('Size "S" appears twice.');
    expect(validateMapping(r.table, [{ kind: 'size' }, { kind: 'measurement', name: '2bad' }])[0]).toMatch(/not a valid/);
  });
});

describe('applying an import', () => {
  it('merges into matching sizes, adds new sizes and measurements, converts inches', () => {
    const p = fixtureProject();
    const r = readSizingTable('size,bust,shoulder_to_shoulder\nM,50,16\n5X,75,20');
    if (!r.ok) throw new Error(r.error);
    const { project, report } = applyImport(p, r.table, suggestMapping(r.table, p), { units: 'in', mode: 'merge' });
    expect(report.sizesMatched).toEqual(['M']);
    expect(report.sizesAdded).toEqual(['5X']);
    expect(report.measurementsCreated).toEqual(['shoulder_to_shoulder']);
    expect(project.sizes).toHaveLength(11);
    expect(resolveMeasurements(project, sizeId(project, 'M')).values.bust).toEqual({ value: 127, source: 'table' });
    expect(resolveMeasurements(project, sizeId(project, 'S')).values.bust.value).toBe(114.5); // untouched
    expect(project.measurements.find((m) => m.name === 'shoulder_to_shoulder')!.table[sizeId(project, '5X')]).toBe(50.8);
  });

  it('replaces sizes, keeping ids of sizes that stay so overrides survive', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    p.panels[0].waypoints[1].width = dim('waist/2', { [M]: 50, [sizeId(p, 'S')]: 45 });
    const r = readSizingTable('size,bust\nS,90\nM,100');
    if (!r.ok) throw new Error(r.error);
    const { project, report } = applyImport(p, r.table, suggestMapping(r.table, p), { units: 'cm', mode: 'replace' });
    expect(project.sizes.map((s) => s.name)).toEqual(['S', 'M']);
    expect(report.sizesRemoved).toHaveLength(8);
    expect(sizeId(project, 'M')).toBe(M);
    expect(project.panels[0].waypoints[1].width.overrides).toEqual({ [M]: 50, [sizeId(p, 'S')]: 45 });
    expect(project.baseSizeId).toBe(M);
  });

  it('a table value replaces an estimate', () => {
    const p = fixtureProject();
    const r = readSizingTable('size,shoulder_width\nM,40');
    if (!r.ok) throw new Error(r.error);
    const { project } = applyImport(p, r.table, suggestMapping(r.table, p), { units: 'cm', mode: 'merge' });
    const m = project.measurements.find((x) => x.name === 'shoulder_width')!;
    expect(m.estimate).toBe(false);
    expect(resolveMeasurements(project, sizeId(project, 'M')).values.shoulder_width).toEqual({ value: 40, source: 'table' });
    expect(resolveMeasurements(project, sizeId(project, 'S')).values.shoulder_width.source).toBe('rule');
  });

  it('reports non-numeric cells', () => {
    const p = fixtureProject();
    const r = readSizingTable('size,bust\nM,big');
    if (!r.ok) throw new Error(r.error);
    expect(applyImport(p, r.table, suggestMapping(r.table, p), { units: 'cm', mode: 'merge' }).report.warnings[0]).toMatch(/"big" for bust/);
  });
});

describe('grading operations', () => {
  it('converts table values to an increment rule that reproduces them exactly', () => {
    const p = fixtureProject();
    const before = values(p, 'bust');
    const q = convertToIncrementRule(p, 'bust');
    const m = q.measurements.find((x) => x.name === 'bust')!;
    expect(m.rule.type).toBe('increment');
    expect(m.table).toEqual({});
    expect(resolveMeasurements(q, q.baseSizeId).values.bust.source).toBe('rule');
    values(q, 'bust').forEach((v, i) => expect(v).toBeCloseTo(before[i]!, 6));
  });

  it('keeps values when the base size changes', () => {
    const q = convertToIncrementRule(fixtureProject(), 'bust');
    const before = values(q, 'bust');
    const r = setBaseSize(q, sizeId(q, '2X'));
    values(r, 'bust').forEach((v, i) => expect(v).toBeCloseTo(before[i]!, 6));
  });

  it('applies a uniform step', () => {
    const q = uniformSteps(convertToIncrementRule(fixtureProject(), 'wrist'), 'wrist', 0.5);
    const v = values(q, 'wrist') as number[];
    expect(v[5] - v[4]).toBeCloseTo(0.5, 6);
    expect(v[1] - v[0]).toBeCloseTo(0.5, 6);
  });

  it('adds, moves and removes sizes, cleaning up per-size data', () => {
    const p = fixtureProject();
    const S = sizeId(p, 'S');
    p.measurements[0].manual[S] = 1;
    p.panels[0].waypoints[0].width.overrides[S] = 9;
    p.panels[0].segments[1].manual[S] = { left: [] };
    const { project: a, size } = addSize(p, '5X');
    expect(a.sizes[a.sizes.length - 1]).toEqual(size);
    const b = moveSize(a, size.id, -1);
    expect(b.sizes[b.sizes.length - 2].id).toBe(size.id);
    const c = removeSize(b, S);
    expect(c.sizes.some((s) => s.id === S)).toBe(false);
    expect(c.measurements[0].manual[S]).toBeUndefined();
    expect(c.panels[0].waypoints[0].width.overrides[S]).toBeUndefined();
    expect(c.panels[0].segments[1].manual[S]).toBeUndefined();
    const M = sizeId(p, 'M');
    expect(removeSize(p, M).baseSizeId).not.toBe(M);
  });

  it('renames a measurement everywhere it is used', () => {
    const p = fixtureProject();
    p.ease.per.bust = 8;
    p.panels[0].waypoints[2].width = dim('bust/2 + ease.bust/2 + bust_point_depth*0');
    const q = renameMeasurement(p, 'bust', 'full_bust');
    expect(q.measurements.some((m) => m.name === 'full_bust')).toBe(true);
    expect(q.panels[0].waypoints[2].width.expr).toBe('full_bust/2 + ease.full_bust/2 + bust_point_depth*0');
    expect(q.measurements.find((m) => m.name === 'apex_to_apex')!.rule).toEqual({ type: 'expression', expr: 'round(14 + full_bust * 0.04, 0.5)' });
    expect(q.ease.per).toEqual({ full_bust: 8 });
    expect(resolveMeasurements(q, q.baseSizeId).errors).toEqual({});
  });

  it('finds usages and validates names', () => {
    const p = fixtureProject();
    expect(measurementUsage(p, 'upper_chest')).toContain('Back › underarm width');
    expect(measurementUsage(p, 'bust')).toContain('measurement apex_to_apex');
    expect(validateNewName(p, 'bust')).toMatch(/already exists/);
    expect(validateNewName(p, 'bust', 'bust')).toBeNull();
    expect(validateNewName(p, 'a.b')).toMatch(/dots/);
  });

  it('flags values that go against the size trend', () => {
    const p = fixtureProject();
    expect(trendFlags(p, 'waist_to_armhole')).toEqual([]); // rises then falls: a grading shape, not a zigzag
    expect(trendFlags(p, 'bust')).toEqual([]);
    p.measurements.find((m) => m.name === 'bust')!.manual[sizeId(p, 'M')] = 110;
    const flags = trendFlags(p, 'bust');
    expect(flags.map((f) => p.sizes.find((s) => s.id === f.sizeId)!.name)).toEqual(['M']);
    expect(flags[0].message).toMatch(/Smaller than S/);
  });
});

describe('renameReferences', () => {
  it('only touches whole names', () => {
    const map = (n: string) => (n === 'bust' ? 'b2' : undefined);
    expect(renameReferences('bust + bust_point + waist.bust + 2"', map)).toBe('b2 + bust_point + waist.bust + 2"');
    expect(renameReferences('bust +', map)).toBe('b2 +'); // still reaches invalid expressions
  });
});

describe('waist shift on the back', () => {
  it('gives the back waist shaping in every size', () => {
    const p = fixtureProject();
    p.panels = [backBodice()];
    for (const s of p.sizes) {
      const c = computePanel(p, p.panels[0], s.id);
      const w = Object.fromEntries(c.waypoints.map((x) => [x.name, x]));
      expect(w.waist.stitches, s.name).toBeLessThan(w.underarm.stitches);
      expect(c.issues.filter((i) => i.severity === 'error')).toEqual([]);
    }
  });
});
