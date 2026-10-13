import { describe, expect, it } from 'vitest';
import { buildScope, evaluateDim, incrementValue, resolveMeasurements } from './measurements';
import { dim, newMeasurement } from './model';
import { fixtureProject, sizeId } from './testFixtures';

describe('measurement resolution', () => {
  it('uses table values and marks their source', () => {
    const p = fixtureProject();
    const r = resolveMeasurements(p, sizeId(p, 'M'));
    expect(r.values.bust).toEqual({ value: 124.5, source: 'table' });
    expect(r.values.upper_chest.value).toBe(114.5);
    expect(r.errors).toEqual({});
  });

  it('derives estimates from expression rules', () => {
    const p = fixtureProject();
    const r = resolveMeasurements(p, sizeId(p, 'M'));
    expect(r.values.shoulder_width).toEqual({ value: 41.5, source: 'rule' }); // 38.25 + 3 → 41.5
    expect(r.values.neck_width.value).toBe(16.5); // 13 + 3.435 → 16.5
    expect(r.values.cap_height.value).toBe(14.5); // 22.5 * .65 = 14.625 → 14.5
  });

  it('lets manual overrides win, and flows them into dependent rules', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    p.measurements.find((m) => m.name === 'cross_chest_back')!.manual[M] = 40;
    const r = resolveMeasurements(p, M);
    expect(r.values.cross_chest_back).toEqual({ value: 40, source: 'manual' });
    expect(r.values.shoulder_width.value).toBe(43);
  });

  it('grades by increments from the base size, with per-size steps', () => {
    const p = fixtureProject();
    const m = { ...newMeasurement('sleeve_ease'), rule: { type: 'increment' as const, baseValue: 5, defaultStep: 1, steps: { [sizeId(p, 'L')]: 2 } } };
    p.measurements.push(m);
    expect(incrementValue(p, m, sizeId(p, 'M'))).toBe(5);
    expect(incrementValue(p, m, sizeId(p, 'L'))).toBe(7);
    expect(incrementValue(p, m, sizeId(p, '1X'))).toBe(8);
    expect(incrementValue(p, m, sizeId(p, 'S'))).toBe(4);
    expect(incrementValue(p, m, sizeId(p, '3XS'))).toBe(1);
    expect(resolveMeasurements(p, sizeId(p, 'L')).values.sleeve_ease).toEqual({ value: 7, source: 'rule' });
  });

  it('reports measurements with no value', () => {
    const p = fixtureProject();
    p.measurements.push(newMeasurement('mystery'));
    p.measurements.push({ ...newMeasurement('broken'), rule: { type: 'expression', expr: 'mystery * 2' } });
    const r = resolveMeasurements(p, sizeId(p, 'M'));
    expect(r.errors.mystery).toMatch(/No value/);
    expect(r.errors.broken).toMatch(/Unknown name "mystery"/);
  });

  it('exposes global and per-measurement ease', () => {
    const p = fixtureProject();
    p.ease = { global: 5, per: { bust: 8 } };
    const s = buildScope(p, sizeId(p, 'M'));
    expect(s.ease).toBe(5);
    expect(s['ease.bust']).toBe(8);
    expect(s['ease.waist']).toBe(5);
  });

  it('evaluates dimensions with per-size overrides', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    const scope = buildScope(p, M);
    const d = dim('upper_chest/2 + ease/4');
    expect(evaluateDim(d, M, scope)).toEqual({ ok: true, value: { value: 58.5, overridden: false } });
    d.overrides[M] = 60;
    expect(evaluateDim(d, M, scope)).toEqual({ ok: true, value: { value: 60, overridden: true } });
    expect(evaluateDim(dim('nope'), M, scope)).toMatchObject({ ok: false });
  });

  it('every size of the sample resolves all measurements', () => {
    const p = fixtureProject();
    for (const s of p.sizes) expect(resolveMeasurements(p, s.id).errors).toEqual({});
  });
});
