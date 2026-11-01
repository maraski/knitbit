import { describe, expect, it } from 'vitest';
import { projectChecks } from './checks';
import { defaultEdges } from './edgeTreatments';
import { buildGarment, changeMethod, setNeckline, type GarmentSpec } from './garmentSetup';
import { stitchesPerCm } from './gauge';
import { buildScope } from './measurements';
import { dim, type FrontOpening, type NecklineShape, type Panel, type Project, type StrapGives } from './model';
import { computePanel } from './panel';
import { loadProject as parseProject, serializeProject } from './schema';
import { defaultStrapWidth, derivedStrap, NECK_FOLLOWS, relinkStrap, setStrap, STRAP_NECK, STRAP_SHOULDER, strapLinks, strapReadout, strapScope } from './strap';
import { fixtureProject, sizeId } from './testFixtures';

const base = () => ({ ...fixtureProject(), panels: [], joins: [] });
const garment = (method: GarmentSpec['method'], opening: FrontOpening = 'closed', neckline: NecklineShape = 'round') =>
  buildGarment(base(), { method, opening, neckline, sleeve: method === 'seamed' || method === 'top-down' ? 'set-in' : 'contiguous', ease: 'standard', edges: defaultEdges() });
const named = (p: Project, name: string) => p.panels.find((x) => x.name === name)!;
const wp = (x: Panel, name: string) => x.waypoints.find((w) => w.name === name)!;
const errors = (p: Project) => projectChecks(p).filter((c) => c.issue.severity === 'error').map((c) => `${c.sizeName} ${c.panelName}: ${c.issue.message}`);
const bodices = (p: Project) => p.panels.filter((x) => x.template === 'back' || x.template === 'front');
const counts = (p: Project) => p.panels.map((x) => p.sizes.map((s) => computePanel(p, x, s.id).counts));

describe('strap width: turning it on moves nothing', () => {
  for (const method of ['seamed', 'top-down'] as const) {
    for (const neckline of ['round', 'v', 'square'] as const) {
      for (const gives of ['neck', 'armhole'] as const) {
        it(`${method} ${neckline}, gives at ${gives}`, () => {
          const p = garment(method, 'closed', neckline);
          expect(p.garment.strap).toBeUndefined(); // only a boat neck starts with one
          const w = defaultStrapWidth(p);
          expect(w.expr).toBe('(shoulder_w - back_neck_width) / 2');
          const q = setStrap(p, { width: w, gives });
          expect(counts(q)).toEqual(counts(p));
          for (const x of bodices(q)) expect(strapLinks(q, x).unlinked).toEqual([]);
        });
      }
    }
  }

  it('no shoulder flare: the default strap reads the end of the armhole shaping', () => {
    const p = garment('seamed');
    const flat = { ...p, panels: p.panels.map((x) => (x.template === 'back' || x.template === 'front' ? { ...x, waypoints: x.waypoints.map((w) => (w.name === 'shoulder' ? { ...w, width: dim('armhole_end.width') } : w.name === 'armhole_end' ? { ...w, width: dim('cross_back_w + 1') } : w)) } : x)) };
    expect(defaultStrapWidth(flat).expr).toBe('(cross_back_w + 1 - back_neck_width) / 2');
    for (const gives of ['neck', 'armhole'] as const) expect(counts(setStrap(flat, { width: defaultStrapWidth(flat), gives }))).toEqual(counts(flat));
    // Armhole: the shoulder is carried straight up, so the end of the armhole shaping is what moves.
    const a = setStrap(flat, { width: dim(3), gives: 'armhole' });
    expect(wp(named(a, 'Back'), 'armhole_end').width.expr).toBe(STRAP_SHOULDER);
    expect(wp(named(a, 'Back'), 'shoulder').width.expr).toBe('armhole_end.width');
    expect(errors(a)).toEqual([]);
  });
});

describe('strap width: what gives', () => {
  it('neck: one neck width on back and front, from the shoulder line; front and back in step', () => {
    const p = setStrap(garment('seamed'), { width: dim(3), gives: 'neck' });
    const spc = stitchesPerCm(p.gauge);
    for (const name of ['Back', 'Front']) {
      const x = named(p, name);
      expect(wp(x, 'neck_side').width.expr).toBe(STRAP_NECK);
      expect(x.neckline!.width.expr).toBe(NECK_FOLLOWS);
      expect(wp(x, 'shoulder').width.expr).toBe('shoulder_w'); // the shoulder line stays
    }
    // The curve keeps its shaping each side; the extra width is bound off at the centre.
    expect(named(p, 'Front').neckline!.centreWidth.expr).toBe('neck_w - back_neck_width * 0.6');
    expect(named(p, 'Back').neckline!.centreWidth.expr).toBe('neck_w - 2');
    for (const s of p.sizes) {
      const back = strapReadout(p, named(p, 'Back'), s.id)!;
      const front = strapReadout(p, named(p, 'Front'), s.id)!;
      expect(back.strapCm, s.name).toBeCloseTo(3, 5);
      expect(back.neckCm).toBeCloseTo(buildScope(p, s.id).shoulder_w - 6, 5);
      expect(front.neckCm).toBeCloseTo(back.neckCm, 5);
      expect(Math.abs(back.strapSts - 3 * spc)).toBeLessThanOrEqual(1);
      expect(front.strapSts).toBe(back.strapSts);
    }
  });

  it('armhole: the neck stays, the shoulder line moves in, the armhole shaping follows', () => {
    const p0 = garment('seamed');
    const p = setStrap(p0, { width: dim(3), gives: 'armhole' });
    for (const name of ['Back', 'Front']) {
      const x = named(p, name);
      expect(wp(x, 'neck_side').width.expr).toBe('back_neck_width');
      expect(wp(x, 'shoulder').width.expr).toBe(STRAP_SHOULDER);
      expect(wp(x, 'armhole_end').width.expr).toBe(`min(${wp(named(p0, name), 'armhole_end').width.expr}, shoulder.width)`);
    }
    for (const s of p.sizes) {
      const sc = buildScope(p, s.id);
      const r = strapReadout(p, named(p, 'Back'), s.id)!;
      expect(r.neckCm).toBeCloseTo(sc.back_neck_width, 5);
      expect(r.shoulderCm).toBeCloseTo(sc.back_neck_width + 6, 5);
      const c = computePanel(p, named(p, 'Back'), s.id);
      const end = c.waypoints.find((w) => w.key === 'armhole_end')!;
      expect(end.widthCm).toBeLessThanOrEqual(r.shoulderCm + 1e-9);
    }
  });

  it('a new width alone changes strap_w; the linked fields stay linked', () => {
    const p = setStrap(garment('top-down'), { width: dim(3), gives: 'neck' });
    const q = setStrap(p, { width: dim(5, { [sizeId(p, 'M')]: 4 }), gives: 'neck' });
    expect(q.panels).toEqual(p.panels);
    expect(derivedStrap(q, sizeId(q, 'M'))).toBeCloseTo(4, 5);
    expect(derivedStrap(q, sizeId(q, 'S'))).toBeCloseTo(5, 5);
  });

  it('typing a linked field unlinks it; re-link puts it back; switching mode keeps typed values', () => {
    const p = setStrap(garment('seamed'), { width: dim(3), gives: 'neck' });
    const front = named(p, 'Front');
    const typed: Project = { ...p, panels: p.panels.map((x) => (x.id === front.id ? { ...x, neckline: { ...x.neckline!, width: dim('back_neck_width + 2') } } : x)) };
    expect(strapLinks(typed, named(typed, 'Front')).unlinked).toEqual(['neckline.width']);
    expect(strapLinks(typed, named(typed, 'Back')).unlinked).toEqual([]);
    const re = relinkStrap(typed, front.id);
    expect(named(re, 'Front')).toEqual(front);
    // To armhole and back: the typed width stays typed; the other fields follow the mode.
    const a = setStrap(typed, { width: dim(3), gives: 'armhole' });
    expect(named(a, 'Front').neckline!.width.expr).toBe('back_neck_width + 2');
    expect(wp(named(a, 'Front'), 'neck_side').width.expr).toBe('back_neck_width');
    expect(named(a, 'Front').neckline!.centreWidth.expr).toBe('back_neck_width * 0.4');
    const n = setStrap(a, { width: dim(3), gives: 'neck' });
    expect(wp(named(n, 'Front'), 'shoulder').width.expr).toBe('shoulder_w');
    expect(wp(named(n, 'Front'), 'neck_side').width.expr).toBe(STRAP_NECK);
  });

  it('turning it off gives every field its own value back', () => {
    const p = garment('seamed', 'cardigan', 'v');
    for (const gives of ['neck', 'armhole'] as const) {
      const off = setStrap(setStrap(p, { width: dim(2), gives }), null);
      expect(off.garment.strap).toBeUndefined();
      expect(off.panels).toEqual(p.panels);
    }
  });

  it('cardigan fronts are linked like the whole front', () => {
    const p = setStrap(garment('top-down', 'cardigan'), { width: dim(4), gives: 'neck' });
    for (const name of ['Left front', 'Right front']) {
      expect(wp(named(p, name), 'neck_side').width.expr).toBe(STRAP_NECK);
      expect(named(p, name).neckline!.width.expr).toBe(NECK_FOLLOWS);
    }
  });

  it('a method change links the new bodices; the yoke methods have no strap here', () => {
    const p = setStrap(garment('seamed'), { width: dim(3), gives: 'neck' });
    const t = changeMethod(p, 'top-down');
    for (const x of bodices(t)) expect(strapLinks(t, x).unlinked, x.name).toEqual([]);
    expect(wp(named(t, 'Back'), 'neck_side').width.expr).toBe(STRAP_NECK);
    expect(Object.keys(t.garment.strap!.saved).sort()).toEqual(bodices(t).map((x) => x.id).sort());
    expect(strapScope(t)).toBe('panels');
    expect(strapScope(changeMethod(p, 'raglan'))).toBe('raglan');
    expect(strapScope(changeMethod(p, 'contiguous'))).toBe('yoke');
  });

  it('the boat neck: its 3 cm is the strap; old boat necks keep their expressions', () => {
    const b = garment('seamed', 'closed', 'boat');
    expect(b.garment.strap).toMatchObject({ width: { expr: '3' }, gives: 'neck' });
    expect(wp(named(b, 'Back'), 'neck_side').width.expr).toBe(STRAP_NECK);
    expect(named(b, 'Front').neckline!.centreWidth.expr).toBe('neck_w - 2 * min(3, neck_depth * 0.75)');
    for (const s of b.sizes) expect(strapReadout(b, named(b, 'Front'), s.id)!.strapCm).toBeCloseTo(3, 5);
    // An old boat neck (made before the strap setting): no strap, its stored `shoulder_w - 6` as it was.
    const old: Project = { ...b, garment: { construction: 'panels', opening: 'closed' }, panels: b.panels.map((x) => (x.template === 'back' || x.template === 'front' ? { ...x, neckline: x.neckline && { ...x.neckline, width: dim('shoulder_w - 6') }, waypoints: x.waypoints.map((w) => (w.name === 'neck_side' ? { ...w, width: dim('shoulder_w - 6') } : w)) } : x)) };
    expect(counts(old)).toEqual(counts(b));
    const again = parseProject(serializeProject(old));
    expect(again.ok && again.project.garment.strap).toBeUndefined();
    expect(again.ok && again.project.panels).toEqual(old.panels);
    // A strap set on a round neck is kept by a change to V; to a boat it becomes 3 cm.
    const r = setStrap(garment('seamed'), { width: dim(4), gives: 'neck' });
    expect(setNeckline(r, 'v').garment.strap!.width.expr).toBe('4');
    expect(wp(named(setNeckline(r, 'v'), 'Front'), 'neck_side').width.expr).toBe(STRAP_NECK);
    expect(setNeckline(r, 'boat').garment.strap!.width.expr).toBe('3');
  });

  it('a project saved with a strap loads back the same', () => {
    const p = setStrap(garment('seamed'), { width: dim(3, { [sizeId(fixtureProject(), 'M')]: 2.5 }), gives: 'armhole' });
    const r = parseProject(serializeProject(p));
    expect(r.ok).toBe(true);
    expect(r.ok && r.project.garment.strap).toEqual(p.garment.strap);
  });
});

// The done check: narrow straps (tanks, vests) in every size, both modes, both panel methods.
describe('strap width: 2–5 cm straps in every size', () => {
  const cases: [GarmentSpec['method'], FrontOpening, NecklineShape][] = [];
  for (const method of ['seamed', 'top-down'] as const) for (const opening of ['closed', 'cardigan'] as const) for (const neck of ['round', 'v', 'square', 'boat'] as const) cases.push([method, opening, neck]);
  for (const [method, opening, neck] of cases) {
    for (const gives of ['neck', 'armhole'] as StrapGives[]) {
      it(`${method} ${opening} ${neck}, gives at ${gives}`, { timeout: 60000 }, () => {
        const p = garment(method, opening, neck);
        for (const w of [2, 3, 4, 5]) {
          const q = setStrap(p, { width: dim(w), gives });
          // The one expected limit: top-down, a square neck (9–10 cm deep, straight sides) with a 2 cm strap reaches
          // the armhole shaping, where the front is narrower than the opening (XS, S, 1X, 2X; 4X on the cardigan).
          const expected = method === 'top-down' && neck === 'square' && gives === 'neck' && w === 2;
          const errs = errors(q).filter((e) => !(expected && /Neck wider than the panel at row \d+: .* To fix: widen the strap|The stitch count goes negative/.test(e)));
          expect(errs, `${w} cm`).toEqual([]);
          if (expected) expect(errors(q).length).toBeGreaterThan(0);
        }
      });
    }
  }
});
