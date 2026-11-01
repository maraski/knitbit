// Strap width on the contiguous yoke and the modified raglan (milestone M6): the strap is the shoulder seam.
import { describe, expect, it } from 'vitest';
import { projectChecks } from './checks';
import { generateYoke, STRAP_YOKE_BACK, STRAP_YOKE_NECK } from './contiguous';
import { defaultEdges } from './edgeTreatments';
import { buildGarment, setNeckline, type GarmentSpec } from './garmentSetup';
import { rowsPerCm, stitchesPerCm } from './gauge';
import { buildScope } from './measurements';
import { dim, type FrontOpening, type NecklineShape, type Project, type StrapGives } from './model';
import { defaultStrapWidth, relinkStrap, setStrap, strapLinks, strapScope, yokeStrapReadout } from './strap';
import { fixtureProject, sizeId } from './testFixtures';

const base = () => ({ ...fixtureProject(), panels: [], joins: [] });
const garment = (method: GarmentSpec['method'], opening: FrontOpening = 'closed', neckline: NecklineShape = 'round') =>
  buildGarment(base(), { method, opening, neckline, sleeve: method === 'seamed' || method === 'top-down' ? 'set-in' : 'contiguous', ease: 'standard', edges: defaultEdges() });
const yokeOf = (p: Project) => p.panels.find((x) => x.yoke)!;
const gen = (p: Project, size: string) => generateYoke(p, yokeOf(p).yoke!, size);
const errors = (p: Project) => [...new Set(projectChecks(p).filter((c) => c.issue.severity === 'error').map((c) => `${c.sizeName} ${c.panelName}: ${c.issue.message}`))];
const yokes = (p: Project) => p.sizes.map((s) => gen(p, s.id));
const work = (p: Project) => yokes(p).map((y) => ({ castOn: y.castOnZones, rows: y.rows.map((r) => r.zones), held: y.held, neck: y.neck }));

const METHODS = ['contiguous', 'modified-raglan'] as const;
const shapesFor = (m: (typeof METHODS)[number]): NecklineShape[] => (m === 'contiguous' ? ['round', 'v', 'square', 'boat'] : ['round', 'square', 'boat']);
const GIVES: StrapGives[] = ['neck', 'armhole'];

describe('yoke strap: turning it on moves nothing', () => {
  for (const method of METHODS) {
    for (const shape of shapesFor(method).filter((s) => s !== 'boat')) {
      for (const opening of ['closed', 'cardigan'] as const) {
        for (const gives of GIVES) {
          it(`${method} ${shape} ${opening}, gives at ${gives}`, () => {
            const p = garment(method, opening, shape);
            expect(p.garment.strap).toBeUndefined();
            expect(strapScope(p)).toBe('yoke');
            const q = setStrap(p, { width: defaultStrapWidth(p), gives });
            expect(work(q)).toEqual(work(p));
            expect(strapLinks(q, yokeOf(q)).unlinked).toEqual([]);
            expect(strapLinks(q, yokeOf(q)).linked).toContain(gives === 'neck' ? 'yoke.neckWidth' : 'yoke.backWidth');
          });
        }
      }
    }
  }

  it('the default strap is the seam each size has now, to 0.1 cm', () => {
    const p = garment('contiguous');
    const w = defaultStrapWidth(p);
    for (const s of p.sizes) expect(w.overrides[s.id] ?? Number(w.expr)).toBeCloseTo(Math.round(gen(p, s.id).derived.seamCm * 10) / 10, 6);
  });
});

describe('yoke strap: 2–5 cm in both modes, every size (sample table, 22 × 30)', () => {
  for (const method of METHODS) {
    for (const shape of shapesFor(method)) {
      for (const opening of ['closed', 'cardigan'] as const) {
        it(`${method} ${shape} ${opening}`, { timeout: 60000 }, () => {
          const p0 = garment(method, opening, shape);
          const before = errors(p0);
          const rpc = rowsPerCm(p0.gauge);
          const spc = stitchesPerCm(p0.gauge);
          for (const gives of GIVES) {
            for (const w of [2, 3, 4, 5]) {
              const p = setStrap(p0, { width: dim(w), gives });
              // No new errors (a whole-neck square cardigan's short rows don't fit in the smallest sizes already).
              expect(errors(p).filter((e) => !before.includes(e)), `${gives} ${w}`).toEqual([]);
              if (gives === 'neck') expect(errors(p), `${gives} ${w}`).toEqual([]);
              for (const s of p.sizes) {
                const y = gen(p, s.id);
                expect(Math.abs(y.counts.A - w * rpc), `${gives} ${w} ${s.name}`).toBeLessThanOrEqual(1);
                expect(y.strap?.gives).toBe(gives);
                if (gives === 'neck') {
                  // The back still reaches its width after the shoulders (or 1 st more, as the seam rounds).
                  const target = Math.round(y.params.backWidth.value * spc);
                  expect(y.strap!.backSts - target).toBeGreaterThanOrEqual(0);
                  expect(y.strap!.backSts - target).toBeLessThanOrEqual(1);
                } else {
                  expect(y.params.neckWidth.expr).not.toBe(STRAP_YOKE_NECK);
                  expect(y.neck.backNeck).toBe(Math.round(y.params.neckWidth.value * spc));
                  expect(y.issues.some((i) => i.code === 'yoke.strap-armhole')).toBe(true);
                }
              }
            }
          }
        });
      }
    }
  }
});

describe('yoke strap: what gives', () => {
  it('neck: the neck width is solved and shows as linked; the modified raglan front cast-on follows it', () => {
    const p = setStrap(garment('modified-raglan'), { width: dim(3), gives: 'neck' });
    const M = sizeId(p, 'M');
    const spec = yokeOf(p).yoke!;
    expect(spec.neck.width!.expr).toBe(STRAP_YOKE_NECK);
    expect(spec.shoulder.backWidth.expr).toBe('cross_back_w + 1');
    const y = gen(p, M);
    expect(y.params.neckWidth.expr).toBe(STRAP_YOKE_NECK);
    expect(y.params.neckWidth.value * y.stitchesPerCm).toBeCloseTo(y.neck.backNeck, 6);
    expect(y.counts.A).toBe(9);
    expect(y.castOnZones.leftFront + y.castOnZones.rightFront).toBe(y.neck.backNeck); // frontCo = neck_w
    const r = yokeStrapReadout(p, yokeOf(p), M)!;
    expect(r.rows).toBe(9);
    expect(r.strapCm).toBeCloseTo(3, 6);
    expect(r.neckCm).toBeCloseTo(y.neck.backNeck / y.stitchesPerCm, 6);
  });

  it('neck: a wider neck keeps the front neck shaping, the extra width goes to the centre cast-on (a V gets a flat bottom)', () => {
    for (const shape of ['round', 'v'] as const) {
      const p0 = garment('contiguous', 'closed', shape);
      const p = setStrap(p0, { width: dim(3), gives: 'neck' });
      for (const s of p.sizes) {
        const a = gen(p0, s.id).neck;
        const b = gen(p, s.id).neck;
        expect(b.backNeck, s.name).toBeGreaterThan(a.backNeck);
        expect(b.perSide, s.name).toBe(a.perSide);
        expect(b.centre, s.name).toBe(b.backNeck - 2 * a.perSide);
      }
    }
  });

  it('armhole: the neck stays, the back width is the neck plus the seam; an info says the cross back is not followed', () => {
    const p0 = garment('contiguous');
    const p = setStrap(p0, { width: dim(4), gives: 'armhole' });
    expect(yokeOf(p).yoke!.shoulder.backWidth.expr).toBe(STRAP_YOKE_BACK);
    const M = sizeId(p, 'M');
    const y = gen(p, M);
    expect(y.counts.A).toBe(12);
    expect(y.neck.backNeck).toBe(gen(p0, M).neck.backNeck);
    expect(y.params.backWidth.value * y.stitchesPerCm).toBe(y.strap!.backSts);
    expect(y.issues.find((i) => i.code === 'yoke.strap-armhole')!.message).toMatch(/cross back .* no longer followed/);
  });

  it('switching what gives restores the other field; typing unlinks; re-link; stop linking restores everything', () => {
    const p0 = garment('contiguous');
    const n = setStrap(p0, { width: dim(3), gives: 'neck' });
    const a = setStrap(n, { width: dim(3), gives: 'armhole' });
    expect(yokeOf(a).yoke!.neck.width).toEqual(yokeOf(p0).yoke!.neck.width ?? dim('back_neck_width'));
    expect(yokeOf(a).yoke!.shoulder.backWidth.expr).toBe(STRAP_YOKE_BACK);
    const typed: Project = { ...n, panels: n.panels.map((x) => (x.yoke ? { ...x, yoke: { ...x.yoke, neck: { ...x.yoke.neck, width: dim(20) } } } : x)) };
    expect(strapLinks(typed, yokeOf(typed)).unlinked).toEqual(['yoke.neckWidth']);
    expect(gen(typed, sizeId(typed, 'M')).strap).toBeUndefined(); // the knitter's neck: the seam is the yoke's again
    const back = relinkStrap(typed, yokeOf(typed).id);
    expect(yokeOf(back).yoke!.neck.width!.expr).toBe(STRAP_YOKE_NECK);
    const off = setStrap(n, null);
    expect(off.garment.strap).toBeUndefined();
    expect(work(off)).toEqual(work(p0));
  });

  it('a strap too wide for the back says so, with the widest that fits', () => {
    const p = setStrap(garment('contiguous'), { width: dim(20), gives: 'neck' });
    const y = gen(p, sizeId(p, 'M'));
    const e = y.issues.find((i) => i.code === 'yoke.strap-too-wide')!;
    expect(e.severity).toBe('error');
    expect(e.message).toMatch(/leaves no neck/);
    const most = Number(e.fix!.need!.replace(/[^\d.]/g, ''));
    const ok = setStrap(p, { width: dim(most), gives: 'neck' });
    expect(gen(ok, sizeId(p, 'M')).issues.some((i) => i.code === 'yoke.strap-too-wide')).toBe(false);
  });
});

describe('yoke strap: boat neck and scope', () => {
  for (const method of METHODS) {
    it(`${method}: a new boat yoke gets a 3 cm strap: a 9-row seam in every size, no errors`, () => {
      const p = garment(method, 'closed', 'boat');
      expect(p.garment.strap?.width.expr).toBe('3');
      for (const s of p.sizes) expect(gen(p, s.id).counts.A, s.name).toBe(9);
      expect(errors(p)).toEqual([]);
    });
  }

  it('an old boat yoke (no strap) keeps its short seam until the strap is set', () => {
    const p0 = garment('contiguous', 'closed', 'boat');
    const old: Project = setStrap(p0, null);
    const { strap: _, ...g } = old.garment;
    const p = { ...old, garment: g };
    const M = sizeId(p, 'M');
    expect(gen(p, M).counts.A).toBeLessThan(4);
    expect(gen(setStrap(p, { width: dim(3), gives: 'neck' }), M).counts.A).toBe(9);
  });

  it('a neckline change keeps the strap driving the new neck', () => {
    const p = setStrap(garment('contiguous'), { width: dim(3), gives: 'neck' });
    const q = setNeckline(p, 'square');
    expect(yokeOf(q).yoke!.neck.width!.expr).toBe(STRAP_YOKE_NECK);
    expect(gen(q, sizeId(q, 'M')).counts.A).toBe(9);
  });

  it('classic raglan and the off-shoulder raglan have no shoulder seam: no strap to set', () => {
    expect(strapScope(garment('raglan'))).toBe('raglan');
    expect(strapScope(garment('modified-raglan', 'closed', 'off-shoulder'))).toBe('raglan');
    const p = setStrap(garment('raglan'), { width: dim(3), gives: 'neck' });
    const y = yokeOf(p).yoke!;
    expect(y.neck.width?.expr).not.toBe(STRAP_YOKE_NECK);
    expect(buildScope(p, sizeId(p, 'M')).strap_w).toBe(3);
  });
});
