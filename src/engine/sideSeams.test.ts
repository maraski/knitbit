import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyAcrossSizes, applyFix, canApply } from './applyFix';
import { projectChecks } from './checks';
import { buildGarment, type GarmentMethod } from './garmentSetup';
import { resolveMeasurements } from './measurements';
import type { FrontOpening, Project } from './model';
import { computePanel } from './panel';
import { loadProject } from './schema';
import { sideSeamShapings } from './sideSeams';
import { fixtureProject, sizeId } from './testFixtures';

const base = () => ({ ...fixtureProject(), panels: [], joins: [] });
const METHODS: Exclude<GarmentMethod, 'blank'>[] = ['seamed', 'top-down', 'contiguous', 'raglan', 'modified-raglan'];
const OPENINGS: FrontOpening[] = ['closed', 'cardigan'];
const sleeveOf = (m: GarmentMethod) => (m === 'contiguous' ? 'contiguous' : m === 'raglan' || m === 'modified-raglan' ? 'raglan' : 'set-in');
const garment = (method: Exclude<GarmentMethod, 'blank'>, opening: FrontOpening) =>
  buildGarment(base(), { method, opening, neckline: 'round', sleeve: sleeveOf(method), sleeveLength: 'long', ease: 'standard' });
const shapings = (p: Project, sid: string) => sideSeamShapings(p, sid, (x) => computePanel(p, x, sid));
const sideChecks = (p: Project) => projectChecks(p).filter((c) => c.issue.code === 'join.side-shaping');

describe('even waist split: side seams mirror', () => {
  it('waist_shift follows the Fit choice', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    expect(resolveMeasurements(p, M).values.waist_shift.value).toBe(0);
    expect(resolveMeasurements({ ...p, fit: { ...p.fit, waistSplit: 'back' } }, M).values.waist_shift.value).toBeCloseTo((122 - 109.25) / 4, 6);
    expect(p.measurements.some((m) => m.name === 'waist_shift')).toBe(false); // no longer seeded
  });

  for (const method of METHODS) {
    for (const opening of OPENINGS) {
      it(`${method} × ${opening}: front and back side edges shape on the same rows by the same counts, every size`, () => {
        const p = garment(method, opening);
        for (const s of p.sizes) {
          const list = shapings(p, s.id);
          expect(list.length, s.name).toBe(2); // one pair per side
          for (const { pair, a, b, bustSide } of list) {
            const label = `${s.name} ${pair.name}`;
            expect(a.below, label).toBe(b.below);
            expect(a.rowsBelow, label).toEqual(b.rowsBelow);
            if (bustSide) {
              // Seamed / top-down fronts take the bust width at the side seams above the waist: more increases there.
              expect(a.above, label).toBeGreaterThanOrEqual(b.above);
            } else {
              expect(a.above, label).toBe(b.above);
              expect(a.rowsAbove, label).toEqual(b.rowsAbove);
            }
          }
        }
        expect(sideChecks(p)).toEqual([]);
      });
    }
  }

  it('back-weighted (chosen): noted, not warned about', () => {
    const p = garment('seamed', 'closed');
    const checks = sideChecks({ ...p, fit: { ...p.fit, waistSplit: 'back' } });
    expect(checks).toHaveLength(2 * p.sizes.length);
    expect(new Set(checks.map((c) => c.issue.severity))).toEqual(new Set(['info']));
    expect(checks[0].issue.message).toMatch(/Left side seam: the side seams don't mirror \(hem to waist Front −\d+ sts, Back −\d+ sts/);
  });

  it('princess-line shaping: not compared, and a back-weighted split is suggested', () => {
    const p = garment('seamed', 'closed');
    for (const panel of p.panels.filter((x) => x.template === 'back' || x.template === 'front')) {
      for (const seg of panel.segments.slice(0, 2)) seg.placement = 'princess';
    }
    const checks = projectChecks(p);
    expect(checks.filter((c) => c.issue.code === 'join.side-shaping')).toEqual([]);
    const hint = checks.filter((c) => c.issue.code === 'fit.waist-split-princess');
    expect(hint.length).toBeGreaterThan(0);
    expect(hint[0].issue.fix?.apply?.label).toBe('Back-weighted waist split');
    const sid = sizeId(p, 'M');
    const a = applyAcrossSizes(checks, hint[0].panelId, hint[0].issue)!;
    const next = applyFix(p, a.field, a.values)!;
    expect(next.fit.waistSplit).toBe('back');
    expect(projectChecks(next).filter((c) => c.issue.code === 'fit.waist-split-princess' && c.sizeId === sid)).toEqual([]);
  });

  it('hand-edited waist widths: warned about, naming the widths to change', () => {
    const p = garment('seamed', 'closed');
    const back = p.panels.find((x) => x.template === 'back')!;
    back.waypoints.find((w) => w.name === 'waist')!.width.expr = 'waist / 2 + ease / 2 - 4';
    const checks = sideChecks(p);
    expect(checks.length).toBeGreaterThan(0);
    expect(checks[0].issue.severity).toBe('warning');
    expect(checks[0].issue.fix?.apply).toBeUndefined();
    expect(checks[0].issue.fix?.fields.map((f) => f.label)).toContain('Back: waist width');
  });
});

it('a yoke body made before the split was carried down: the fix says to carry it down', () => {
  const p = garment('contiguous', 'closed');
  for (const panel of p.panels.filter((x) => x.fromYoke === 'back' || x.fromYoke === 'front')) {
    for (const w of panel.waypoints) if (w.name === 'hem' || w.name === 'waist') w.width.expr = w.width.expr.replace(/ \+ \(yoke\.\w+ - yoke\.\w+\) \/ 2/, '');
  }
  const checks = sideChecks(p);
  expect(checks.length).toBeGreaterThan(0);
  expect(checks[0].issue.message).toMatch(/waist to underarm/);
  expect(checks[0].issue.fix?.text).toMatch(/carry the difference down/);
  expect(checks[0].issue.fix?.fields.map((f) => f.label)).toEqual(['Front: hem width', 'Front: waist width', 'Back: hem width', 'Back: waist width']);
});

describe('older projects keep their back-weighted waist', () => {
  const text = readFileSync(fileURLToPath(new URL('./fixtures/project_v2.json', import.meta.url)), 'utf8');

  it('the old waist_shift estimate still wins; the check offers the even split, which mirrors the seams', () => {
    const r = loadProject(text);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    const p = r.project;
    const M = sizeId(p, 'M');
    expect(resolveMeasurements(p, M).values.waist_shift.value).toBeGreaterThan(0);
    const checks = sideChecks(p);
    expect(checks.length).toBeGreaterThan(0);
    const c = checks[0];
    expect(c.issue.severity).toBe('warning');
    expect(c.issue.fix?.apply?.label).toBe('Even waist split');
    expect(canApply(p, c.issue.fix!.apply!)).toBe(true);
    const a = applyAcrossSizes(projectChecks(p), c.panelId, c.issue)!;
    const next = applyFix(p, a.field, a.values)!;
    expect(next.fit.waistSplit).toBe('even');
    expect(next.measurements.some((m) => m.name === 'waist_shift')).toBe(false);
    expect(resolveMeasurements(next, M).values.waist_shift.value).toBe(0);
    expect(sideChecks(next)).toEqual([]);
    // Stored expressions are unchanged: the waypoints still say waist_shift.
    expect(next.panels.find((x) => x.name === 'Back')!.waypoints.find((w) => w.name === 'waist')!.width.expr).toContain('waist_shift');
  });

  it('a hand-edited waist_shift is not removed: the fix names it', () => {
    const r = loadProject(text);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    const p = r.project;
    const m = p.measurements.find((x) => x.name === 'waist_shift')!;
    if (m.rule.type === 'expression') m.rule.expr = '(bust - waist) / 5';
    const c = sideChecks(p)[0];
    expect(c.issue.fix?.apply).toBeUndefined();
    expect(c.issue.fix?.text).toMatch(/waist_shift measurement/);
  });
});
