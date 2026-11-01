// A modified raglan (contiguous yoke, whole-neck start) with a front neck deeper than its short rows: the short rows
// raise the back as for the shape's default neck (a crew neck's when deeper), each front is cast on with what the turns
// need, and the rest of the neck is front-neck increases after the short rows and the closing cast-on, carrying on into
// the front body when it is deeper than the split.

import { describe, expect, it } from 'vitest';
import { projectChecks } from './checks';
import { defaultYoke, generateYoke } from './contiguous';
import { defaultEdges } from './edgeTreatments';
import { setOpening } from './garment';
import { buildGarment } from './garmentSetup';
import { measureEdge } from './joins';
import { setStrap } from './strap';
import { dim, type FrontOpening, type NecklineShape, type Project, type YokeSpec } from './model';
import { defaultRaglan } from './raglan';
import { fixtureProject, sizeId } from './testFixtures';

type Shape = 'round' | 'square' | 'boat';
const build = (opening: FrontOpening, neckline: Shape) =>
  buildGarment({ ...fixtureProject(), panels: [], joins: [] }, { method: 'modified-raglan', opening, neckline, sleeve: 'contiguous', ease: 'standard', edges: defaultEdges() });
const editYoke = (p: Project, edit: (y: YokeSpec) => void): Project => ({
  ...p,
  panels: p.panels.map((x) => (x.yoke ? { ...x, yoke: (() => { const y = structuredClone(x.yoke!); edit(y); return y; })() } : x)),
});
const withDepth = (p: Project, depth: number | null) => (depth === null ? p : editYoke(p, (y) => void (y.neck.depth = dim(depth))));
const yokeOf = (p: Project) => p.panels.find((x) => x.yoke)!;
const errors = (p: Project) => projectChecks(p).filter((c) => c.issue.severity === 'error').map((c) => `${c.panelName}: ${c.issue.message}`);

describe('modified raglan deep neck: sample table at 22 × 30', () => {
  for (const opening of ['closed', 'cardigan'] as const) {
    for (const shape of ['round', 'square', 'boat'] as const) {
      for (const depth of [null, 8, 15, 25]) {
        it(`${shape} × ${opening}, front neck ${depth ?? 'default'}${depth ? ' cm' : ''}: no errors in any size`, () => {
          const p = withDepth(build(opening, shape), depth);
          expect(yokeOf(p).yoke!.start).toBe('neck');
          expect(errors(p)).toEqual([]);
        });
      }
    }
  }
});

describe('modified raglan deep neck: how it is worked', () => {
  it('default necks are all short rows, as before (the new default pairs are the old ones at the default depth)', () => {
    const OLD = 'round(max(0, neck_depth - back_depth) / row_h / 2)';
    for (const opening of ['closed', 'cardigan'] as const) {
      const p = setOpening(fixtureProject(), opening);
      for (const shape of ['round', 'square', 'boat'] as NecklineShape[]) {
        for (const spec of [defaultYoke(shape, 'neck'), defaultRaglan(shape, 'neck')]) {
          const old = { ...spec, shortRows: { ...spec.shortRows!, pairs: dim(OLD) } };
          for (const s of p.sizes) {
            const a = generateYoke(p, spec, s.id);
            const b = generateYoke(p, old, s.id);
            expect(a.shortRows!.frontNeck).toBeUndefined();
            expect(JSON.stringify({ ...a, params: { ...a.params, srPairs: null } })).toBe(JSON.stringify({ ...b, params: { ...b.params, srPairs: null } }));
          }
        }
      }
    }
  });

  it('15 cm round pullover: short rows raise the back, fronts cast on narrower, increases after the short rows, centre cast-on and join', () => {
    const p = withDepth(build('closed', 'round'), 15);
    for (const size of p.sizes) {
      const y = generateYoke(p, yokeOf(p).yoke!, size.id);
      const sr = y.shortRows!;
      const fn = sr.frontNeck!;
      expect(fn).toBeDefined();
      expect(sr.endRow).toBeLessThan(y.neck.row);
      // Each front cast on with what the turns need (2 sts apart where they fit); the last turn leaves the edge stitch.
      expect(y.castOnZones.leftFront).toBe(fn.castOn);
      expect(y.castOnZones.rightFront).toBe(fn.castOn);
      expect(sr.turns[sr.turns.length - 1]).toBeGreaterThanOrEqual(1);
      // The neck is the whole neck: cast-on fronts + increases + centre = the front cast-on (neck_w).
      const fc = Math.round((y.params.frontCo.value) * y.stitchesPerCm);
      expect(2 * fn.castOn + 2 * y.neck.perSide + y.neck.centre).toBe(fc);
      // The increases come after the short rows, before the closing row; flat until then, rounds after.
      const incRows = y.rows.filter((r) => r.neck).map((r) => r.row);
      expect(incRows.every((r) => r > sr.endRow && r < y.neck.row)).toBe(true);
      if (!y.neckContinues) {
        expect(incRows.length).toBe(y.neck.perSide);
        expect(y.rows[y.neck.row - 1].castOns).toEqual([{ zone: 'rightFront', count: y.neck.centre, where: 'centre-front' }]);
      }
      expect(y.counts.joinRow).toBe(y.neck.row);
      expect(y.rows.some((r) => r.plain)).toBe(false);
      expect(y.issues.some((i) => i.code === 'yoke.neck-below-short-rows' && i.severity === 'info')).toBe(true);
    }
    // Size M: the numbers in the note.
    const m = generateYoke(p, yokeOf(p).yoke!, sizeId(p, 'M'));
    const note = m.issues.find((i) => i.code === 'yoke.neck-below-short-rows')!.message;
    expect(note).toMatch(/^Front neck 15 cm: the back neck is [\d.]+ cm below the neck point and the short rows raise the back .* \(\d+ pairs\); the other .* cast on \d+ sts each front, (\d+ increases? each side, then )?cast on \d+ sts at centre front and join in the round \(flat until then\)\.$/);
  });

  it('the short rows default to a crew neck when deeper: the same pairs at 15 and 25 cm as at the default depth', () => {
    const base = build('closed', 'round');
    for (const size of base.sizes) {
      const pairs = (p: Project) => generateYoke(p, yokeOf(p).yoke!, size.id).shortRows!.pairs;
      expect(pairs(withDepth(base, 15))).toBe(pairs(base));
      expect(pairs(withDepth(base, 25))).toBe(pairs(base));
    }
  });

  it('a square neck: no increases, the fronts keep the turn stitches and the centre is the rest', () => {
    const p = withDepth(build('closed', 'square'), 15);
    for (const size of p.sizes) {
      const y = generateYoke(p, yokeOf(p).yoke!, size.id);
      expect(y.neck.perSide).toBe(0);
      expect(y.neck.centre).toBe(Math.round(y.params.frontCo.value * y.stitchesPerCm) - 2 * y.shortRows!.frontNeck!.castOn);
      expect(y.neck.centre).toBeGreaterThan(0);
    }
  });

  it('cardigan: each front casts on its share at the front edge (right on row R, left on R + 1)', () => {
    const p = withDepth(build('cardigan', 'round'), 15);
    for (const size of p.sizes) {
      const y = generateYoke(p, yokeOf(p).yoke!, size.id);
      if (y.neckContinues) continue;
      const R = y.neck.row;
      expect(y.neck.frontEdgeCo).toBeGreaterThan(0);
      expect(y.rows[R - 1].castOns).toEqual([{ zone: 'rightFront', count: y.neck.frontEdgeCo, where: 'front-edge' }]);
      expect(y.rows[R].castOns).toEqual([{ zone: 'leftFront', count: y.neck.frontEdgeCo, where: 'front-edge' }]);
      expect(y.counts.joinRow).toBeNull();
    }
  });

  it('25 cm: the neck continues into the front body (as the back start), body flat until it closes', () => {
    for (const opening of ['closed', 'cardigan'] as const) {
      const p = withDepth(build(opening, 'round'), 25);
      let continuing = 0;
      for (const size of p.sizes) {
        const y = generateYoke(p, yokeOf(p).yoke!, size.id);
        if (!y.neckContinues) continue;
        continuing++;
        expect(y.issues.some((i) => i.code === 'yoke.neck-continues')).toBe(true);
        expect(y.neckContinues.rows).toBe(Math.max(1, y.neck.row - y.counts.total));
      }
      expect(continuing).toBeGreaterThan(0);
      const checks = projectChecks(p);
      expect(checks.filter((c) => /joined in the round have different|cannot be computed/.test(c.issue.message))).toEqual([]);
    }
  });

  it('the neckband picks up the cast-on, both neck slopes and the closing cast-on', () => {
    const p = withDepth(build('closed', 'round'), 15);
    const s = sizeId(p, 'M');
    const y = generateYoke(p, yokeOf(p).yoke!, s);
    const m = measureEdge(p, { panelId: yokeOf(p).id, edge: { kind: 'neck' } }, s, p.settings.pickUp);
    expect(m.ok).toBe(true);
    expect(m.stitches).toBe(y.castOn + y.neck.centre);
    expect(m.rows).toBeGreaterThan(0);
  });

  it('the Classic raglan with the whole-neck option works a deep neck the same way', () => {
    for (const opening of ['closed', 'cardigan'] as const) {
      for (const depth of [15, 25]) {
        const base = buildGarment({ ...fixtureProject(), panels: [], joins: [] }, { method: 'raglan', opening, neckline: 'round', sleeve: 'raglan', ease: 'standard', edges: defaultEdges() });
        const p = editYoke(base, (y) => {
          y.start = 'neck';
          y.shortRows = defaultRaglan('round', 'neck').shortRows;
          y.neck.depth = dim(depth);
        });
        expect(errors(p), `${opening} ${depth}`).toEqual([]);
        const y = generateYoke(p, yokeOf(p).yoke!, sizeId(p, 'M'));
        expect(y.shortRows!.frontNeck).toBeDefined();
        expect(y.neck.row).toBeGreaterThan(y.shortRows!.endRow);
      }
    }
  });

  it("a user's own pairs value is kept: too many still errors with the Short-row pairs fix", () => {
    const p = editYoke(withDepth(build('closed', 'round'), 15), (y) => void (y.shortRows!.pairs = dim(20)));
    const y = generateYoke(p, yokeOf(p).yoke!, sizeId(p, 'M'));
    expect(y.shortRows!.pairs).toBe(20);
    const e = y.issues.find((i) => i.code === 'yoke.short-rows-fit')!;
    expect(e.severity).toBe('error');
    expect(e.fix!.apply!.field.key).toBe('srPairs');
  });

  it('a strap-solved neck (Strap gives at: Neck) drives the front cast-on plus the increases', () => {
    const base = withDepth(build('closed', 'round'), 15);
    const p = setStrap(base, { width: dim(3), gives: 'neck' });
    expect(yokeOf(p).yoke!.neck.width?.expr).toBe('strap_neck_w');
    for (const size of p.sizes) {
      const y = generateYoke(p, yokeOf(p).yoke!, size.id);
      expect(y.strap?.gives).toBe('neck');
      const fc = Math.round(y.params.frontCo.value * y.stitchesPerCm);
      expect(y.params.frontCo.value).toBeCloseTo(y.params.neckWidth.value, 6);
      expect(2 * y.shortRows!.frontNeck!.castOn + 2 * y.neck.perSide + y.neck.centre).toBe(fc);
    }
    expect(errors(p)).toEqual([]);
  });
});
