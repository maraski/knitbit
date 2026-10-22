import { describe, expect, it } from 'vitest';
import { projectChecks } from './checks';
import { defaultEdges } from './edgeTreatments';
import { buildGarment, changeMethod, garmentChoice, lengthFor, lengthsFor, setSleeve, setSleeveLength, type GarmentSpec } from './garmentSetup';
import { buildScope } from './measurements';
import type { FrontOpening, Panel, Project, SleeveLength } from './model';
import { computePanel, type ComputedPanel } from './panel';
import { loadProject } from './schema';
import { sleeveName } from './sleeveLength';
import { sleeve } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

const base = () => ({ ...fixtureProject(), panels: [], joins: [] });
const spec = (s: Partial<GarmentSpec>): GarmentSpec => ({ method: 'seamed', opening: 'closed', neckline: 'round', sleeve: 'set-in', ease: 'standard', ...s });
const isSleeve = (x: Panel) => (x.template ?? '').startsWith('sleeve');
const sleeves = (p: Project) => p.panels.filter(isSleeve);
const wp = (c: ComputedPanel, name: string) => c.waypoints.find((w) => w.name === name)!;
const SIZES = ['4XS', 'M', '4X'];

describe('sleeve lengths: every method, front and length builds and computes', () => {
  const methods: [GarmentSpec['method'], GarmentSpec['sleeve'][]][] = [
    ['seamed', ['set-in', 'drop', 'straight']],
    ['top-down', ['set-in', 'drop', 'straight']],
    ['contiguous', ['contiguous']],
  ];
  for (const [method, types] of methods) {
    for (const type of types) {
      for (const opening of ['closed', 'cardigan'] as FrontOpening[]) {
        it(`${method} · ${type} · ${opening}`, () => {
          for (const length of lengthsFor(type)) {
            const p = buildGarment(base(), spec({ method, opening, sleeve: type, sleeveLength: length }));
            expect(garmentChoice(p).sleeveLength).toBe(length);
            for (const sl of sleeves(p)) expect(sl.sleeveLength).toBe(length === 'long' ? undefined : length);
            for (const name of SIZES) {
              for (const panel of sleeves(p)) {
                const c = computePanel(p, panel, sizeId(p, name));
                expect(c.ok, `${length} ${name} ${panel.name}: ${c.issues.map((i) => i.message).join('; ')}`).toBe(true);
              }
            }
            // Checks cover every size: once per garment, at the lengths that change the most.
            if (length === 'cap' || length === 'short') expect(projectChecks(p).filter((c) => c.issue.severity === 'error'), `${length}`).toEqual([]);
          }
        });
      }
    }
  }

  it('a cap is offered for set-in and contiguous sleeves only', () => {
    expect(lengthsFor('set-in')).toContain('cap');
    expect(lengthsFor('contiguous')).toContain('cap');
    expect(lengthsFor('drop')).not.toContain('cap');
    expect(lengthsFor('straight')).not.toContain('cap');
    expect(lengthsFor('none')).toEqual([]);
    expect(lengthFor('drop', 'cap')).toBe('short');
    expect(lengthFor('none', 'elbow')).toBe('long');
  });
});

describe('sleeve length and cuff width', () => {
  const p = buildGarment(base(), spec({ sleeveLength: 'long' }));
  const at = (length: SleeveLength, type: 'set-in' | 'drop' | 'straight' = 'set-in') => {
    const q = setSleeve(setSleeveLength(p, length === 'cap' && type !== 'set-in' ? 'short' : length), type);
    return { q, sl: sleeves(q)[0] };
  };

  it('the underarm sits at the length measurement above the cuff; the long sleeve is unchanged', () => {
    for (const name of SIZES) {
      for (const [length, measure] of [['short', 'short_sleeve_length'], ['elbow', 'elbow_length'], ['three-quarter', 'three_quarter_length'], ['long', 'arm_length']] as const) {
        const { q, sl } = at(length);
        const S = sizeId(q, name);
        const scope = buildScope(q, S);
        const c = computePanel(q, sl, S);
        expect(wp(c, 'underarm').heightCm, `${length} ${name}`).toBeCloseTo(scope[measure], 6);
      }
    }
    const long = sleeve('set-in');
    expect(sleeves(p)[0].waypoints.map((w) => [w.name, w.height.expr, w.width.expr])).toEqual(long.waypoints.map((w) => [w.name, w.height.expr, w.width.expr]));
  });

  it('the cuff is read off a straight taper from bicep + ease to wrist + ease', () => {
    for (const name of SIZES) {
      for (const length of ['short', 'elbow', 'three-quarter'] as const) {
        const { q, sl } = at(length);
        const S = sizeId(q, name);
        const s = buildScope(q, S);
        const c = computePanel(q, sl, S);
        const top = s.bicep + s['ease.bicep'];
        const expected = top + (s.wrist + s['ease.wrist'] - top) * (wp(c, 'underarm').heightCm / s.arm_length);
        expect(wp(c, 'cuff').widthCm, `${length} ${name}`).toBeCloseTo(expected, 6);
      }
      // Shorter sleeves have wider cuffs, never wider than the underarm.
      const widths = (['long', 'three-quarter', 'elbow', 'short'] as const).map((l) => {
        const { q, sl } = at(l);
        return computePanel(q, sl, sizeId(q, name)).waypoints[0].stitches;
      });
      expect([...widths].sort((a, b) => a - b)).toEqual(widths);
      const { q, sl } = at('short');
      expect(widths[3]).toBeLessThanOrEqual(wp(computePanel(q, sl, sizeId(q, name)), 'underarm').stitches);
    }
  });

  it('a straight sleeve keeps one width at every length; a drop sleeve tapers from its top', () => {
    const { q, sl } = at('elbow', 'straight');
    const c = computePanel(q, sl, sizeId(q, 'M'));
    expect(wp(c, 'cuff').stitches).toBe(wp(c, 'top').stitches);
    const d = at('short', 'drop');
    const dc = computePanel(d.q, d.sl, sizeId(d.q, 'M'));
    expect(wp(dc, 'cuff').stitches).toBeLessThan(wp(dc, 'top').stitches);
    expect(wp(dc, 'top').heightCm).toBeCloseTo(buildScope(d.q, sizeId(d.q, 'M')).short_sleeve_length, 6);
  });

  it('short sleeves: the shaping between cuff and underarm fits its rows, at most one change every other row', () => {
    for (const name of SIZES) {
      for (const length of ['short', 'elbow', 'three-quarter'] as const) {
        const { q, sl } = at(length);
        const c = computePanel(q, sl, sizeId(q, name));
        const seg = c.segments[0];
        const change = (wp(c, 'underarm').stitches - wp(c, 'cuff').stitches) / 2;
        expect(seg.left.target).toBe(change);
        expect(seg.left.events.reduce((n, e) => n + e.delta, 0)).toBe(change);
        const rows = seg.left.events.map((e) => e.row);
        expect(rows.every((r) => r >= seg.rowFrom && r <= seg.rowTo)).toBe(true);
        for (let i = 1; i < rows.length; i++) expect(rows[i] - rows[i - 1], `${length} ${name}`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('cap sleeve: a full set-in cap with no underarm length', () => {
  const long = buildGarment(base(), spec({}));
  const cap = buildGarment(base(), spec({ sleeveLength: 'cap' }));

  it('is named for its length and stores it', () => {
    expect(sleeves(cap)[0].name).toBe('Cap sleeve');
    expect(sleeves(cap)[0].sleeveLength).toBe('cap');
  });

  it('cuff band straight up to the underarm, then the same cap as the long sleeve', () => {
    for (const name of SIZES) {
      const c = computePanel(cap, sleeves(cap)[0], sizeId(cap, name));
      const l = computePanel(long, sleeves(long)[0], sizeId(long, name));
      // The band: as wide as the underarm, 5 cm (the default cuff rib) high, with no shaping.
      expect(wp(c, 'cuff').stitches).toBe(wp(c, 'underarm').stitches);
      expect(wp(c, 'underarm').stitches).toBe(wp(l, 'underarm').stitches);
      expect(wp(c, 'underarm').heightCm).toBeCloseTo(5, 6);
      expect(c.segments[0].left.events).toEqual([]);
      const rib = c.sections.find((s) => s.name === 'Cuff rib')!;
      expect(rib.toRow).toBe(wp(c, 'underarm').row);
      // The cap: every point the same stitch count and the same rows above the underarm.
      for (const k of ['cap_bo', 'cap_low', 'cap_high', 'cap_top']) {
        expect(wp(c, k).stitches, `${k} ${name}`).toBe(wp(l, k).stitches);
        expect(wp(c, k).row - wp(c, 'underarm').row, `${k} ${name}`).toBe(wp(l, k).row - wp(l, 'underarm').row);
      }
    }
  });

  it('follows the cuff band setting; without a band knit with it, two rows below the cap', () => {
    const M = sizeId(cap, 'M');
    const edges = defaultEdges();
    edges.cuff.depth = { expr: '3', overrides: {} };
    const three = { ...cap, edges };
    expect(wp(computePanel(three, sleeves(three)[0], M), 'underarm').heightCm).toBeCloseTo(3, 6);
    const later = { ...cap, edges: { ...edges, cuff: { ...edges.cuff, method: 'later' as const } } };
    const c = computePanel(later, sleeves(later)[0], M);
    expect(wp(c, 'underarm').row).toBe(2);
  });

  it('contiguous: the held sleeve stitches plus the underarm cast-on, worked straight for the band', () => {
    const p = buildGarment(base(), spec({ method: 'contiguous', sleeve: 'contiguous', sleeveLength: 'cap' }));
    const M = sizeId(p, 'M');
    for (const sl of sleeves(p)) {
      expect(sl.name).toMatch(/^(Left|Right) sleeve$/);
      const c = computePanel(p, sl, M);
      expect(wp(c, 'cuff').stitches).toBe(wp(c, 'underarm').stitches);
      expect(Math.abs(wp(c, 'cuff').heightCm - wp(c, 'underarm').heightCm)).toBeCloseTo(5, 6);
      expect(c.segments[0].left.events).toEqual([]);
    }
    expect(projectChecks(p).filter((c) => c.issue.severity !== 'info' && /sleeve/i.test(c.panelName))).toEqual([]);
  });
});

describe('changing the length', () => {
  it('sets every sleeve in place, renames a sleeve still named for its length, keeps other edits', () => {
    let p = buildGarment(base(), spec({ sleeve: 'drop' }));
    const id = sleeves(p)[0].id;
    p = { ...p, panels: p.panels.map((x) => (x.id === id ? { ...x, notes: 'mine' } : x)) };
    const notes: string[] = [];
    const q = setSleeveLength(p, 'elbow', notes);
    const sl = sleeves(q)[0];
    expect(sl.id).toBe(id);
    expect(sl.name).toBe('Elbow sleeve (drop shoulder)');
    expect(sl.notes).toBe('mine');
    expect(garmentChoice(q).sleeveLength).toBe('elbow');
    expect(q.measurements.some((m) => m.name === 'elbow_length' && m.estimate && m.region === 'sleeves')).toBe(true);
    expect(notes.join(' ')).toMatch(/elbow/);
    const back = setSleeveLength(q, 'long');
    expect(sleeves(back)[0].name).toBe('Sleeve (drop shoulder)');
    expect(sleeves(back)[0].waypoints).toEqual(sleeves(p)[0].waypoints);
    expect(setSleeveLength(q, 'cap')).toBe(q); // drop shoulders have no cap
  });

  it('a renamed sleeve keeps its name; a contiguous yoke’s sleeves change too', () => {
    const p = buildGarment(base(), spec({}));
    const named = { ...p, panels: p.panels.map((x) => (isSleeve(x) ? { ...x, name: 'Arm' } : x)) };
    expect(sleeves(setSleeveLength(named, 'short'))[0].name).toBe('Arm');
    const y = setSleeveLength(buildGarment(base(), spec({ method: 'contiguous', sleeve: 'contiguous' })), 'three-quarter');
    expect(sleeves(y).map((x) => [x.name, x.sleeveLength])).toEqual([['Left sleeve', 'three-quarter'], ['Right sleeve', 'three-quarter']]);
  });

  it('the type and the method keep the length where they can', () => {
    const p = buildGarment(base(), spec({ sleeveLength: 'cap' }));
    const notes: string[] = [];
    const d = setSleeve(p, 'drop', notes);
    expect(garmentChoice(d).sleeveLength).toBe('short');
    expect(notes.join(' ')).toMatch(/can’t be cap sleeves/);
    const y = changeMethod(p, 'contiguous');
    expect(garmentChoice(y)).toMatchObject({ sleeve: 'contiguous', sleeveLength: 'cap' });
    const t = changeMethod(buildGarment(base(), spec({ sleeveLength: 'elbow', sleeve: 'straight' })), 'top-down');
    expect(garmentChoice(t)).toMatchObject({ sleeve: 'straight', sleeveLength: 'elbow' });
    expect(sleeves(t)[0].direction).toBe('top-down');
  });

  it('a regenerated contiguous sleeve matches the one left', () => {
    const p = buildGarment(base(), spec({ method: 'contiguous', sleeve: 'contiguous', sleeveLength: 'short' }));
    expect(sleeves(p).every((x) => x.sleeveLength === 'short')).toBe(true);
  });

  it('is saved and loaded; old projects stay long', () => {
    const p = buildGarment(base(), spec({ sleeveLength: 'three-quarter' }));
    const r = loadProject(JSON.stringify(p));
    expect(r.ok && garmentChoice(r.project).sleeveLength).toBe('three-quarter');
    expect(garmentChoice({ ...base(), panels: [sleeve('set-in')] }).sleeveLength).toBe('long');
  });

  it('names', () => {
    expect(sleeveName('Sleeve', 'long')).toBe('Sleeve');
    expect(sleeveName('Sleeve (straight)', 'three-quarter')).toBe('Three-quarter sleeve (straight)');
  });
});

describe('sleeve checks', () => {
  it('a cuff band as long as a short sleeve is a warning; more than half is a note', () => {
    const p = buildGarment(base(), spec({ sleeveLength: 'short' }));
    const msgs = (q: Project) => projectChecks(q).filter((c) => /cuff band/.test(c.issue.message)).map((c) => c.issue.severity);
    expect(msgs(p).length).toBeGreaterThan(0);
    expect(msgs(p).every((s) => s === 'info')).toBe(true);
    const edges = defaultEdges();
    edges.cuff.depth = { expr: '12', overrides: {} };
    expect(msgs({ ...p, edges })).toContain('warning');
    edges.cuff.depth = { expr: '2', overrides: {} };
    expect(msgs({ ...p, edges })).toEqual([]);
    expect(msgs(buildGarment(base(), spec({})))).toEqual([]);
  });

  it('notes shaping faster than every other row', () => {
    const p = buildGarment(base(), spec({ sleeveLength: 'short' }));
    // A narrow cuff (wrist + ease) only 6 cm below the underarm.
    const fast = {
      ...p,
      panels: p.panels.map((x) => (isSleeve(x) ? { ...x, waypoints: x.waypoints.map((w) => (w.name === 'cuff' ? { ...w, width: { expr: 'wrist + ease.wrist', overrides: {} } } : w.name === 'underarm' ? { ...w, height: { expr: '6', overrides: {} } } : w)) } : x)),
    };
    expect(projectChecks(fast).some((c) => /more often than every other row/.test(c.issue.message))).toBe(true);
  });
});
