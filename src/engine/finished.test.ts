import { describe, expect, it } from 'vitest';
import { defaultEdges } from './edgeTreatments';
import { finishedMeasurements, panelRole, type FinishedId } from './finished';
import { buildGarment, type GarmentSpec } from './garmentSetup';
import { buildScope } from './measurements';
import type { Project } from './model';
import { computePanel } from './panel';
import { renameReferences } from './expr';
import { fixtureProject, sizeId } from './testFixtures';

const base = () => ({ ...fixtureProject(), panels: [], joins: [] });
const spec = (s: Partial<GarmentSpec>): GarmentSpec => ({ method: 'seamed', opening: 'closed', neckline: 'round', sleeve: 'set-in', ease: 'standard', edges: defaultEdges(), ...s });
const values = (p: Project, size = 'M') => Object.fromEntries(finishedMeasurements(p, sizeId(p, size)).map((r) => [r.id, r.cm])) as Partial<Record<FinishedId, number | null>>;
const named = (p: Project, name: string) => p.panels.find((x) => x.name === name)!;

describe('panelRole', () => {
  it('reads bodices, sleeves, the yoke and strips', () => {
    const p = buildGarment(base(), spec({ method: 'contiguous', sleeve: 'contiguous', opening: 'cardigan' }));
    expect(p.panels.map((x) => `${x.name}:${panelRole(x)}`)).toEqual(
      expect.arrayContaining(['Yoke:yoke', 'Back:back', 'Left front:front', 'Right front:front', 'Left sleeve:sleeve', 'Neckband:band', 'Button band:band']),
    );
  });
});

describe('finishedMeasurements', () => {
  it('seamed pullover: circumferences are the pieces’ widths without selvedges, after rounding', () => {
    const p = buildGarment(base(), spec({}));
    const M = sizeId(p, 'M');
    const v = values(p);
    const back = computePanel(p, named(p, 'Back'), M);
    const front = computePanel(p, named(p, 'Front'), M);
    const wp = (c: typeof back, key: string) => c.waypoints.find((w) => w.key === key)!;
    // The hem waypoint has no rib section here (the hem band is picked up later), so the hem is the cast-on.
    const hemSts = (c: typeof back) => wp(c, 'hem').actualStitches - wp(c, 'hem').selvedge;
    expect(v.hem).toBeCloseTo((hemSts(back) + hemSts(front)) / back.stitchesPerCm, 6);
    // The bust is at least the underarm width (the widest row between the bust and the underarm).
    const under = (c: typeof back) => wp(c, 'underarm').actualStitches - wp(c, 'underarm').selvedge;
    expect(v.bust!).toBeGreaterThanOrEqual((under(back) + under(front)) / back.stitchesPerCm - 1e-9);
    expect(v.bustEase).toBeCloseTo(v.bust! - buildScope(p, M).bust, 6);
    expect(v.waist).not.toBeNull();
    expect(v.waist!).toBeLessThan(v.hem!);
    expect(v.bodyLength).toBeCloseTo(back.totalRows / back.rowsPerCm, 6);
    expect(v.upperArm! > v.cuff!).toBe(true);
    expect(v.sleeveLength).toBeGreaterThan(30);
    expect(v.neck).toBeGreaterThan(30);
    // No yoke, no bands.
    expect(v).not.toHaveProperty('yokeDepth');
    expect(v).not.toHaveProperty('bandWidth');
  });

  it('grades: bigger sizes measure more', () => {
    const p = buildGarment(base(), spec({}));
    const s = values(p, 'S');
    const l = values(p, 'L');
    for (const id of ['bust', 'hem', 'upperArm'] as const) expect(l[id]!).toBeGreaterThan(s[id]!);
  });

  it('cardigan: measured closed (bands added, overlap once) and the band rows shown', () => {
    const closed = values(buildGarment(base(), spec({})));
    const p = buildGarment(base(), spec({ opening: 'cardigan' }));
    const v = values(p);
    const scope = buildScope(p, sizeId(p, 'M'));
    expect(v.bandWidth).toBe(scope.band_w);
    expect(v.overlap).toBe(scope.band_overlap);
    // The fronts are cut narrower by the closing width, so closed the cardigan is within a few stitches of the pullover.
    expect(Math.abs(v.bust! - closed.bust!)).toBeLessThan(2);
    expect(Math.abs(v.hem! - closed.hem!)).toBeLessThan(2);
  });

  it('contiguous: body length runs from the back neck, and the yoke depth is shown', () => {
    const p = buildGarment(base(), spec({ method: 'contiguous', sleeve: 'contiguous' }));
    const M = sizeId(p, 'M');
    const v = values(p);
    const yoke = computePanel(p, p.panels.find((x) => x.yoke)!, M).yoke!;
    const back = computePanel(p, named(p, 'Back'), M);
    expect(v.yokeDepth).toBeCloseTo(yoke.derived.backLengthCm, 6);
    expect(v.bodyLength).toBeCloseTo(yoke.derived.backLengthCm + back.totalRows / back.rowsPerCm, 6);
    // The neck is the yoke's neck edge.
    expect(v.neck).toBeGreaterThan(30);
    // Sleeves from the yoke: in the round, no selvedges.
    const sl = computePanel(p, named(p, 'Left sleeve'), M);
    expect(v.upperArm).toBeCloseTo(sl.waypoints.find((w) => w.key === 'underarm')!.actualStitches / sl.stitchesPerCm, 6);
  });

  it('rows only for the pieces there are', () => {
    const p = buildGarment(base(), spec({ sleeve: 'none' }));
    const v = values(p);
    expect(v).toHaveProperty('bust');
    expect(v).not.toHaveProperty('upperArm');
    expect(v).not.toHaveProperty('sleeveLength');
    expect(finishedMeasurements(base(), sizeId(base(), 'M'))).toEqual([]);
  });

  it('finds renamed waypoints by the measurements they use, else shows —', () => {
    const p = buildGarment(base(), spec({}));
    const renamed = structuredClone(p);
    // Rename it everywhere (expressions refer to `underarm.height`).
    const ren = (e: string) => renameReferences(e, (n) => (n.startsWith('underarm.') ? n.replace('underarm.', 'chest_line.') : undefined));
    for (const x of renamed.panels) {
      for (const w of x.waypoints) {
        if (w.name === 'underarm') w.name = 'chest line';
        for (const d of [w.height, w.width, w.left, w.right]) d.expr = ren(d.expr);
      }
      if (x.bust) x.bust.vertical.top.expr = ren(x.bust.vertical.top.expr);
    }
    const v = values(renamed);
    expect(v.bust).toBeCloseTo(values(p).bust!, 6);
    // Renamed and its width no longer tied to a measurement: the bust can't be found.
    const lost = structuredClone(renamed);
    for (const x of lost.panels.filter((x) => panelRole(x) === 'back' || panelRole(x) === 'front')) {
      const w = x.waypoints.find((w) => w.name === 'chest line')!;
      w.width = { expr: '50', overrides: {} };
      w.height = { expr: '35', overrides: {} };
    }
    expect(values(lost).bust).toBeNull();
    expect(values(lost).bustEase).toBeNull();
  });

  it('the hem is measured above a rib knit with the piece', () => {
    const p = buildGarment(base(), spec({}));
    const M = sizeId(p, 'M');
    const ribbed = structuredClone(p);
    for (const x of ribbed.panels.filter((x) => panelRole(x) === 'back' || panelRole(x) === 'front')) {
      x.sections = [{ id: `rib-${x.id}`, name: 'Hem rib', fromHeight: { expr: '0', overrides: {} }, toHeight: { expr: '5', overrides: {} }, pattern: { name: '2x2 rib', multiple: 4, offset: 2 } }];
    }
    const back = computePanel(ribbed, named(ribbed, 'Back'), M);
    const front = computePanel(ribbed, named(ribbed, 'Front'), M);
    const at = (c: typeof back) => (c.rightEdge[c.sections[0].toRow] - c.leftEdge[c.sections[0].toRow] - 2) / c.stitchesPerCm;
    expect(back.sections[0].toRow).toBeGreaterThan(5);
    expect(values(ribbed).hem).toBeCloseTo(at(back) + at(front), 6);
  });
});
