import { describe, expect, it } from 'vitest';
import { addCustomSize, removeSize, setRegionSize, trendFlags } from './grading';
import { resolveMeasurements } from './measurements';
import type { Project } from './model';
import { computePanel } from './panel';
import { regionTransitions, waypointRegions } from './regionShaping';
import { isMixed, regionSources, sizeLabel, sizesApart } from './regions';
import { loadProject, serializeProject } from './schema';
import { bodice, sleeve } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

function mixed(lower = 'L', sleeves?: string): Project {
  let p = fixtureProject();
  p.settings.regionSizing = true;
  p = setRegionSize(p, sizeId(p, 'M'), 'lower', sizeId(p, lower));
  if (sleeves) p = setRegionSize(p, sizeId(p, 'M'), 'sleeves', sizeId(p, sleeves));
  p.panels = [bodice('back'), bodice('front'), sleeve('set-in')];
  return p;
}

const wps = (p: Project, panelIdx: number, size: string) => Object.fromEntries(computePanel(p, p.panels[panelIdx], sizeId(p, size)).waypoints.map((w) => [w.name, w]));

describe('region sizing: measurements', () => {
  it('is off by default: region choices are ignored until the project turns it on', () => {
    const p = mixed();
    p.settings.regionSizing = false;
    const M = sizeId(p, 'M');
    expect(regionSources(p, M)).toEqual({ upper: M, lower: M, sleeves: M });
    expect(resolveMeasurements(p, M).values.waist.value).toBe(109.25);
    expect(sizeLabel(p, p.sizes.find((s) => s.id === M)!)).toBe('M');
  });

  it('takes each region from its size; this size’s manual values still win', () => {
    const p = mixed('L', 'S');
    const M = sizeId(p, 'M');
    const L = sizeId(p, 'L');
    const v = resolveMeasurements(p, M).values;
    expect(v.waist).toEqual({ value: 119.5, source: 'table', from: L });
    expect(v.hem_circ).toEqual({ value: 131, source: 'table', from: L }); // high hip of L
    expect(v.hem_drop.value).toBe(11.5);
    expect(v.upper_chest).toEqual({ value: 114.5, source: 'table' });
    expect(v.back_waist_length.value).toBe(42); // stays with the upper body
    expect(v.bicep.value).toBe(36.5); // S sleeves
    expect(v.waist_shift.value).toBeCloseTo((122 - 119.5) / 4, 6); // formulas see the mixed values
    p.measurements.find((m) => m.name === 'waist')!.manual[M] = 112;
    expect(resolveMeasurements(p, M).values.waist).toEqual({ value: 112, source: 'manual' });
    expect(sizeLabel(p, p.sizes.find((s) => s.id === M)!)).toBe('M (lower L, sleeves S)');
    expect(isMixed(p, M)).toBe(true);
    expect(isMixed(p, L)).toBe(false);
  });

  it('a removed size releases the regions that followed it', () => {
    const p = mixed();
    const q = removeSize(p, sizeId(p, 'L'));
    expect(q.sizes.find((s) => s.name === 'M')!.regions).toBeUndefined();
  });

  it('survives saving and loading', () => {
    const p = mixed('L', 'S');
    const r = loadProject(serializeProject(p));
    expect(r.ok && r.project.sizes.find((s) => s.name === 'M')!.regions).toEqual({ lower: sizeId(p, 'L'), sleeves: sizeId(p, 'S') });
  });
});

describe('region sizing: shaping between regions', () => {
  it('classifies waypoints by the region their width comes from', () => {
    const p = mixed();
    const back = p.panels[0];
    const regions = waypointRegions(p, back);
    const of = (n: string) => [...regions.get(back.waypoints.find((w) => w.name === n)!.id)!];
    expect(of('hem')).toEqual(['lower']);
    expect(of('waist')).toEqual(['lower']); // waist_shift is a formula, not a region
    expect(of('underarm')).toEqual(['upper']);
    expect(of('armhole_bo')).toEqual(['upper']);
    const sl = p.panels[2];
    const s = waypointRegions(p, sl);
    expect([...s.get(sl.waypoints.find((w) => w.name === 'cuff')!.id)!]).toEqual(['sleeves']);
    expect([...s.get(sl.waypoints.find((w) => w.name === 'cap_bo')!.id)!].sort()).toEqual(['sleeves', 'upper']); // the cap follows the armhole
  });

  it('a larger lower body: hem and waist from L, underarm from M, and the waist → underarm segment decreases (bottom-up)', () => {
    const p = mixed('L');
    const m = wps(p, 0, 'M');
    const l = wps(p, 0, 'L');
    expect(m.hem.stitches).toBe(l.hem.stitches);
    expect(m.underarm.stitches).toBe(wps(fixtureWith(p), 0, 'M').underarm.stitches);
    const c = computePanel(p, p.panels[0], sizeId(p, 'M'));
    const t = regionTransitions(p, p.panels[0], c);
    expect(t).toHaveLength(1);
    expect(t[0].lower.name).toBe('waist');
    expect(t[0].upper.name).toBe('underarm');
    const n = (m.underarm.stitches - m.waist.stitches) / 2;
    expect(t[0].perSideUp).toBe(n);
    expect(t[0].label).toBe(`lower body L → upper body M: ${n > 0 ? 'increase' : 'decrease'} ${Math.abs(n)} sts each side`);
    // Compared with a plain M the waist is wider, so less widening (or more narrowing) towards the underarm.
    const plain = wps(fixtureWith(p), 0, 'M');
    expect(m.underarm.stitches - m.waist.stitches).toBeLessThan(plain.underarm.stitches - plain.waist.stitches);
  });

  it('top-down the same segment is worked from the upper body: a larger lower body means increases', () => {
    const p = mixed('1X');
    p.panels = [bodice('back', { direction: 'top-down' })];
    const c = computePanel(p, p.panels[0], sizeId(p, 'M'));
    const [t] = regionTransitions(p, p.panels[0], c);
    expect(t.perSideUp).toBeLessThan(0); // the waist (1X) is wider than the underarm (M)
    expect(t.label).toMatch(/^upper body M → lower body 1X: increase \d+ sts each side$/);
  });

  it('a smaller lower body narrows more towards the hem', () => {
    const p = mixed('S');
    const m = wps(p, 0, 'M');
    const plain = wps(fixtureWith(p), 0, 'M');
    expect(m.waist.stitches).toBeLessThan(plain.waist.stitches);
    expect(regionTransitions(p, p.panels[0], computePanel(p, p.panels[0], sizeId(p, 'M')))[0].label).toMatch(/^lower body S → upper body M/);
  });

  it('sleeves from another size: the sleeve top follows the sleeve size, the cap joins the upper-body armhole', () => {
    const p = mixed('M', 'L');
    const c = computePanel(p, p.panels[2], sizeId(p, 'M'));
    const t = regionTransitions(p, p.panels[2], c);
    // The cap's lower part is sized from the armhole (upper body M), its top from the sleeve (L).
    expect(t.map((x) => `${x.lower.name}→${x.upper.name}`)).toEqual(['underarm→cap_bo', 'cap_low→cap_high']);
  });

  it('no transitions for a size that follows itself, or a project without region sizing', () => {
    const p = mixed('L');
    expect(regionTransitions(p, p.panels[0], computePanel(p, p.panels[0], sizeId(p, 'L')))).toEqual([]);
    p.settings.regionSizing = false;
    expect(regionTransitions(p, p.panels[0], computePanel(p, p.panels[0], sizeId(p, 'M')))).toEqual([]);
  });

  it('mixed sizes compute without errors in every combination two sizes apart', () => {
    for (const lower of ['S', 'L', '1X']) {
      const p = mixed(lower, 'L');
      for (const panel of p.panels) {
        const bad = computePanel(p, panel, sizeId(p, 'M')).issues.filter((i) => i.severity === 'error');
        expect(bad.map((i) => i.message), `${panel.name} lower ${lower}`).toEqual([]);
      }
    }
  });
});

describe('custom sizes', () => {
  it('seeds a one-off size from a table row as manual values, editable on their own', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    p.panels = [bodice('back')];
    p.panels[0].waypoints[0].width.overrides[M] = 64;
    const { project: q, size } = addCustomSize(p, 'me', M);
    expect(size.custom).toEqual({ seededFrom: 'M' });
    const me = q.measurements.find((m) => m.name === 'upper_chest')!;
    expect(me.manual[size.id]).toBe(114.5);
    expect(q.measurements.find((m) => m.name === 'waist_to_underarm')!.manual[size.id]).toBeUndefined(); // formula
    expect(resolveMeasurements(q, size.id).values.waist_to_underarm.value).toBeCloseTo(19.5, 6);
    expect(q.panels[0].waypoints[0].width.overrides[size.id]).toBe(64);
    me.manual[size.id] = 118;
    expect(resolveMeasurements(q, size.id).values.upper_chest).toEqual({ value: 118, source: 'manual' });
    expect(resolveMeasurements(q, M).values.upper_chest.value).toBe(114.5);
    expect(sizesApart(q, size.id, sizeId(q, 'L'))).toBe(1); // placed at the row it came from
    expect(trendFlags(q, 'upper_chest')).toEqual([]); // not part of the grading
  });

  it('can use region sizing too', () => {
    let p = fixtureProject();
    p.settings.regionSizing = true;
    const made = addCustomSize(p, 'me', sizeId(p, 'M'));
    p = setRegionSize(made.project, made.size.id, 'lower', sizeId(made.project, 'L'));
    const me = p.sizes.find((s) => s.name === 'me')!;
    expect(resolveMeasurements(p, me.id).values.waist.value).toBe(109.25); // own manual value wins over L
    p.measurements.find((m) => m.name === 'waist')!.manual = {};
    expect(resolveMeasurements(p, me.id).values.waist.value).toBe(119.5);
    expect(sizeLabel(p, me)).toBe('me (lower L)');
  });
});

/** The same project with region sizing off: plain sizes for comparison. */
function fixtureWith(p: Project): Project {
  return { ...p, settings: { ...p.settings, regionSizing: false } };
}
