import { describe, expect, it } from 'vitest';
import { projectChecks } from './checks';
import { joinReport } from './joins';
import { defaultYoke, generateYoke } from './contiguous';
import { defaultEdges } from './edgeTreatments';
import { buildGarment, garmentChoice, setNeckline, type GarmentSpec } from './garmentSetup';
import { rowsPerCm, stitchesPerCm } from './gauge';
import { buildScope } from './measurements';
import type { FrontOpening, Panel, Project } from './model';
import { computePanel, type ComputedPanel } from './panel';
import { fixtureProject, sizeId } from './testFixtures';

const base = () => ({ ...fixtureProject(), panels: [], joins: [] });
const garment = (method: GarmentSpec['method'], opening: FrontOpening = 'closed', neckline: GarmentSpec['neckline'] = 'boat') =>
  buildGarment(base(), { method, opening, neckline, sleeve: method === 'contiguous' ? 'contiguous' : 'set-in', ease: 'standard', edges: defaultEdges() });
const errors = (p: Project, size: string) =>
  p.panels.flatMap((x) => computePanel(p, x, size).issues.filter((i) => i.severity === 'error').map((i) => `${x.name}: ${i.message}`));
const named = (p: Project, name: string) => p.panels.find((x) => x.name === name)!;
const row = (c: ComputedPanel, key: string) => c.waypoints.find((w) => w.key === key)!.row;

/** Stitches outside the neck at the shoulder line, each side (the strap, with any neck shaping still to come). */
function straps(c: ComputedPanel): [number, number] {
  const r = row(c, 'shoulder');
  return [c.neckLeft[r]! - c.leftEdge[r], c.rightEdge[r] - c.neckRight[r]!];
}

describe('boat neck: seamed and top-down panels', () => {
  for (const opening of ['closed', 'cardigan'] as const) {
    it(`seamed ${opening}: front and back reach out to a 3 cm strap, 4 cm and 2 cm deep, in every size`, () => {
      const p = garment('seamed', opening);
      const spc = stitchesPerCm(p.gauge);
      const rpc = rowsPerCm(p.gauge);
      for (const s of p.sizes) {
        expect(errors(p, s.id), s.name).toEqual([]);
        const sw = buildScope(p, s.id).shoulder_w;
        const back = computePanel(p, named(p, 'Back'), s.id);
        expect(back.neck!.shape).toBe('boat');
        expect(Math.abs(back.neck!.widthSts - (sw - 6) * spc)).toBeLessThanOrEqual(3); // rounding, selvedges
        expect(Math.abs(back.neck!.depthRows - 2 * rpc)).toBeLessThanOrEqual(1.5);
        const fronts = opening === 'closed' ? [named(p, 'Front')] : [named(p, 'Right front'), named(p, 'Left front')];
        for (const f of fronts) {
          const c = computePanel(p, f, s.id);
          expect(Math.abs(c.neck!.depthRows - 4 * rpc)).toBeLessThanOrEqual(1.5);
          // A shaped corner (3 cm each side), the rest of the opening bound off at once.
          expect(c.neck!.perSide).toBeGreaterThanOrEqual(Math.floor(2.5 * spc));
        }
        if (opening === 'closed') {
          const front = computePanel(p, fronts[0], s.id);
          expect(front.neck!.widthSts).toBe(back.neck!.widthSts);
          for (const c of [front, back]) {
            for (const strap of straps(c)) {
              expect(strap, s.name).toBeGreaterThan(0);
              expect(strap).toBeLessThanOrEqual(5 * spc); // 3 cm, plus neck decreases still to come above the shoulder line
            }
          }
        }
      }
    });
  }

  it('the strap slopes only its share of the shoulder drop', () => {
    const p = garment('seamed');
    const M = sizeId(p, 'M');
    const sc = buildScope(p, M);
    const back = computePanel(p, named(p, 'Back'), M);
    const at = (k: string) => back.waypoints.find((w) => w.key === k)!;
    const rise = at('neck_side').heightCm - at('shoulder').heightCm;
    const share = (at('shoulder').widthCm - at('neck_side').widthCm) / (sc.shoulder_w - sc.back_neck_width);
    expect(rise).toBeCloseTo(sc.shoulder_drop * share, 5);
    expect(rise).toBeLessThan(sc.shoulder_drop / 2);
    // A round neck keeps the whole drop.
    const r = garment('seamed', 'closed', 'round');
    const rb = computePanel(r, named(r, 'Back'), sizeId(r, 'M'));
    const rat = (k: string) => rb.waypoints.find((w) => w.key === k)!;
    expect(rat('neck_side').heightCm - rat('shoulder').heightCm).toBeCloseTo(sc.shoulder_drop, 5);
  });

  for (const opening of ['closed', 'cardigan'] as const) {
    it(`top-down ${opening}: the back stays straight across the wide neck; the front shoulders are the straps`, () => {
      const p = garment('top-down', opening);
      const spc = stitchesPerCm(p.gauge);
      for (const s of p.sizes) {
        expect(errors(p, s.id), s.name).toEqual([]);
        expect(named(p, 'Back').neckline).toBeNull();
        const back = computePanel(p, named(p, 'Back'), s.id);
        const sw = buildScope(p, s.id).shoulder_w;
        expect(Math.abs(back.counts[row(back, 'shoulder')] - sw * spc)).toBeLessThanOrEqual(3);
        // The cast-on (neck plus the short-row shoulders) is the shoulder width; the slope is only the straps'.
        expect(row(back, 'shoulder')).toBeLessThanOrEqual(Math.ceil(buildScope(p, s.id).shoulder_drop * rowsPerCm(p.gauge) / 2));
        const pick = (p.joins ?? []).find((j) => j.name.startsWith('Front shoulders'))!;
        expect(pick).toBeTruthy();
      }
      const M = sizeId(p, 'M');
      const fronts = p.panels.filter((x) => x.template === 'front');
      const total = fronts.reduce((n, f) => n + computePanel(p, f, M).counts[0], 0);
      expect(total).toBeGreaterThanOrEqual(Math.round(4 * spc)); // two straps of about 3 cm
      expect(total).toBeLessThanOrEqual(Math.round(8 * spc));
    });
  }

  it('garment checks raise no warnings of their own for a boat neck', () => {
    for (const method of ['seamed', 'top-down'] as const) {
      const warn = (p: Project) => projectChecks(p).filter((c) => c.issue.severity !== 'info').map((c) => `${c.sizeName} ${c.panelName}: ${c.issue.message}`);
      expect(warn(garment(method))).toEqual(warn(garment(method, 'closed', 'round')));
    }
  });

  it('the neckband estimate follows the wide neck', () => {
    const p = garment('seamed');
    const nb = p.panels.find((x) => x.template === 'neckband')!;
    const M = sizeId(p, 'M');
    const c = computePanel(p, nb, M);
    const sw = buildScope(p, M).shoulder_w;
    expect(c.waypoints[0].widthCm).toBeCloseTo((sw - 6) * 2 + 6, 5);
  });
});

describe('boat neck: contiguous yoke', () => {
  for (const opening of ['closed', 'cardigan'] as const) {
    it(`whole-neck start, ${opening}: cast on the wide neck, short rows raise the back by front − back depth`, () => {
      const p = garment('contiguous', opening);
      const spc = stitchesPerCm(p.gauge);
      const rpc = rowsPerCm(p.gauge);
      const yoke = p.panels.find((x) => x.yoke)!;
      expect(yoke.yoke!.neck.backDepth?.expr).toBe('2');
      for (const s of p.sizes) {
        expect(errors(p, s.id), s.name).toEqual([]);
        const y = generateYoke(p, yoke.yoke!, s.id);
        const sc = buildScope(p, s.id);
        expect(y.castOnZones.back).toBe(Math.round((sc.shoulder_w - 6) * spc));
        expect(y.params.neckBackDepth.value).toBe(2);
        expect(y.params.srPairs.value).toBe(Math.round((4 - 2) * rpc / 2));
        // Neck to underarm: the strap's share of the shoulder drop, plus the armhole, less the back depth.
        const share = Math.min(1, 6 / (sc.shoulder_w - sc.back_neck_width));
        expect(y.params.backLength.value).toBeCloseTo(sc.shoulder_drop * share + sc.armhole_depth - 2, 5);
      }
    });
  }

  it('back start: a boat neck works too, with a short shoulder seam', () => {
    const p = fixtureProject();
    for (const s of p.sizes) {
      const round = generateYoke(p, defaultYoke('round', 'back'), s.id);
      const boat = generateYoke(p, defaultYoke('boat', 'back'), s.id);
      expect(boat.issues.filter((i) => i.severity === 'error'), s.name).toEqual([]);
      expect(boat.castOnZones.back).toBeGreaterThan(round.castOnZones.back * 1.8);
      expect(boat.counts.A).toBeLessThan(round.counts.A);
      expect(boat.counts.A).toBeGreaterThan(0);
    }
  });

  it('older yokes without a back depth keep back_neck_drop', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    const old = defaultYoke('boat');
    delete old.neck.backDepth;
    const y = generateYoke(p, old, M);
    expect(y.params.neckBackDepth).toBeUndefined();
    expect(y.params.backLength.value).toBeCloseTo(generateYoke(p, { ...old, depth: { ...old.depth } }, M).params.backLength.value, 5);
    const sc = buildScope(p, M);
    const share = Math.min(1, 6 / (sc.shoulder_w - sc.back_neck_width));
    expect(y.params.backLength.value).toBeCloseTo(sc.shoulder_drop * share + sc.armhole_depth - sc.back_neck_drop, 5);
  });
});

describe('boat neck: changing the neckline', () => {
  const neckSide = (x: Panel) => x.waypoints.find((w) => w.name === 'neck_side')!;

  it('round → boat sets the back too, and its top follows; boat → round puts the round back neck back', () => {
    const r = garment('seamed', 'closed', 'round');
    const b = setNeckline(r, 'boat');
    expect(garmentChoice(b).neckline).toBe('boat');
    for (const name of ['Back', 'Front']) {
      expect(named(b, name).neckline!.shape).toBe('boat');
      expect(neckSide(named(b, name)).width.expr).toBe('shoulder_w - 6');
    }
    expect(named(b, 'Back').neckline!.depth.expr).toBe('2');
    expect(named(b, 'Front').neckline!.depth.expr).toBe('4');
    const M = sizeId(b, 'M');
    expect(errors(b, M)).toEqual([]);
    const back = setNeckline(b, 'round');
    expect(named(back, 'Back').neckline).toEqual(named(r, 'Back').neckline);
    expect(neckSide(named(back, 'Back'))).toEqual(neckSide(named(r, 'Back')));
    expect(neckSide(named(back, 'Front'))).toEqual(neckSide(named(r, 'Front')));
  });

  it('a straight top-down back stays straight; the yoke takes the boat defaults and back depth', () => {
    const t = setNeckline(garment('top-down', 'closed', 'round'), 'boat');
    expect(named(t, 'Back').neckline).toBeNull();
    expect(neckSide(named(t, 'Back')).width.expr).toBe('shoulder_w - 6');
    expect(errors(t, sizeId(t, 'M'))).toEqual([]);
    const y = setNeckline(garment('contiguous', 'closed', 'round'), 'boat');
    const spec = y.panels.find((x) => x.yoke)!.yoke!;
    expect(spec.neck).toEqual(defaultYoke('boat').neck);
    expect(spec.depth.backLength).toEqual(defaultYoke('boat').depth.backLength);
    const again = setNeckline(y, 'round').panels.find((x) => x.yoke)!.yoke!;
    expect(again.neck.backDepth).toBeUndefined();
    expect(again.depth.backLength).toEqual(defaultYoke('round').depth.backLength);
  });
});

describe('join measures: shoulder seams and the straight back neck', () => {
  const report = (p: Project, name: RegExp, size: string) => joinReport(p, (p.joins ?? []).find((j) => name.test(j.name))!, size);

  for (const neckline of ['round', 'boat'] as const) {
    for (const opening of ['closed', 'cardigan'] as const) {
      it(`seamed ${opening}, ${neckline}: the shoulder seams count the bind-off steps and match the top-down pick-up`, () => {
        const p = garment('seamed', opening, neckline);
        const t = garment('top-down', opening, neckline);
        for (const s of p.sizes) {
          const r = report(p, /^Shoulder seams/, s.id);
          expect(r.a.pickup, s.name).toBeGreaterThan(0);
          // A cardigan's two half fronts may round a stitch differently from the back.
          expect(Math.abs(r.a.pickup - r.b!.pickup)).toBeLessThanOrEqual(opening === 'cardigan' ? 2 : 0);
          // Both shoulders, from the shoulder point to the neck: the same stitches the top-down front picks up.
          const tsize = t.sizes.find((x) => x.name === s.name)!.id;
          expect(Math.abs(r.a.pickup - report(t, /^Front shoulders/, tsize).a.pickup)).toBeLessThanOrEqual(2);
        }
      });

      it(`top-down ${opening}, ${neckline}: the neckband picks up the straight back neck too`, () => {
        const p = garment('top-down', opening, neckline);
        const spc = stitchesPerCm(p.gauge);
        const back = named(p, 'Back');
        const nb = (p.joins ?? []).find((j) => j.name.startsWith('Neckband'))!;
        expect(nb.edges.some((e) => e.panelId === back.id && e.edge.kind === 'neck')).toBe(true);
        for (const s of p.sizes) {
          const m = report(p, /^Neckband/, s.id).a.measures.find((x) => x.label.startsWith('Back'))!;
          expect(m.ok, s.name).toBe(true);
          const neckW = computePanel(p, back, s.id).waypoints.find((w) => w.key === 'neck_side')!.widthCm;
          expect(Math.abs(m.stitches - neckW * spc)).toBeLessThanOrEqual(3); // the cast-on rounds to whole stitches
        }
      });
    }
  }
});
