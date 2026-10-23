// Off-shoulder M3: a folded band (stockinette, knit twice its finished depth with a turning round, knit closed or
// sewn), no elastic. The single rib band and old projects are covered by offShoulder.test.ts and the yoke snapshot.
import { describe, expect, it } from 'vitest';
import { buildChart, JOIN } from './chart';
import { generateYoke, type YokeResult } from './contiguous';
import { contiguousChecks } from './contiguousChecks';
import { applyEdgeTreatments, defaultEdges, defaultFold, edgesForNeckline, edgeStitchLabel, offShoulderNeckband } from './edgeTreatments';
import { buildGarment, garmentChoice, setNeckline, type GarmentSpec } from './garmentSetup';
import { buildScope } from './measurements';
import { dim, type EdgeTreatment, type Project } from './model';
import { computePanel } from './panel';
import { foldPart } from './raglan';
import { loadProject } from './schema';
import { fixtureProject, sizeId } from './testFixtures';
import { topGeometry } from './yokeTop';

const base = () => ({ ...fixtureProject(), panels: [], joins: [] });
const spec = (s: Partial<GarmentSpec>): GarmentSpec => ({ method: 'raglan', opening: 'closed', neckline: 'off-shoulder', sleeve: 'raglan', ease: 'standard', ...s });
const classic = buildGarment(base(), spec({}));
const modified = buildGarment(base(), spec({ method: 'modified-raglan', sleeve: 'contiguous' }));
const M = sizeId(classic, 'M');
const spc = 2.2;
const yokePanel = (p: Project) => p.panels.find((x) => x.yoke)!;
/** The project with its neckband as the off-shoulder band (1×1 rib, 4 cm, with the yoke), optionally folded. */
const withBand = (p: Project, fold?: EdgeTreatment['fold'], depth = 4): Project =>
  applyEdgeTreatments({ ...p, edges: { ...defaultEdges(), neckband: { ...offShoulderNeckband(), depth: dim(depth), ...(fold ? { fold } : {}) } } });
const gen = (p: Project, size = M) => generateYoke(p, yokePanel(p).yoke!, size);
const errors = (y: YokeResult) => y.issues.filter((i) => i.severity === 'error').map((i) => i.message);

describe('off-shoulder folded band: rows', () => {
  for (const close of ['knit', 'sewn'] as const) {
    it(`${close === 'knit' ? 'knit closed' : 'sewn'}: facing, turning round and outside, twice the depth plus one row, in every size`, () => {
      const rib = withBand(classic);
      const fold = withBand(classic, { turn: 'purl', close });
      for (const s of classic.sizes) {
        const r = gen(rib, s.id);
        const y = gen(fold, s.id);
        const o = y.offShoulder!;
        const D = Math.round(4 * y.rowsPerCm);
        expect(o.fold).toEqual({ turn: 'purl', close, depthRows: D, hiddenRows: D + 1 });
        expect(o.bandRows, s.name).toBe(2 * D + 1);
        expect(r.offShoulder!.bandRows).toBe(D);
        expect(o.bandCm).toBe(4);
        expect(o.incRow).toBe(2 * D + 2);
        // Band ease stays −10 % (stockinette rounds to any count).
        expect(y.castOn, s.name).toBe(Math.round(buildScope(fold, s.id).off_shoulder_circ * 0.9 * spc));
        const parts = y.rows.slice(0, o.bandRows).map((row) => row.bandPart);
        expect(parts).toEqual([...Array(D).fill('facing'), 'turn', ...Array(D - 1).fill('outer'), close === 'knit' ? 'join' : 'outer']);
        for (const row of y.rows.slice(0, o.bandRows)) expect(row).toMatchObject({ band: true, phase: 'band', round: true, incs: [], total: y.castOn });
        expect(y.rows[o.bandRows].bandPart).toBeUndefined();
        // The facing and the turning round fold inside: the yoke is that much longer, its finished depth the same.
        expect(y.counts.total, s.name).toBe(r.counts.total + D + 1);
        expect(y.derived.backLengthCm).toBeCloseTo(r.derived.backLengthCm, 9);
        expect(y.offShoulder!.frontRows).toBe(r.offShoulder!.frontRows + D + 1);
        expect(errors(y), s.name).toEqual([]);
      }
    });
  }

  it('the band phases name the facing, the turning round and the outside', () => {
    const y = gen(withBand(classic, { turn: 'picot', close: 'knit' }));
    const D = y.offShoulder!.fold!.depthRows;
    expect(y.phases.filter((p) => p.id === 'band').map((p) => [p.label, p.from, p.to])).toEqual([
      ['Band facing, stockinette, in the round', 1, D],
      ['Turning round, picot (yo, k2tog)', D + 1, D + 1],
      ['Band outside, stockinette', D + 2, 2 * D + 1],
    ]);
    expect(y.phases.find((p) => p.label.startsWith('Band outside'))!.incsPerRow).toMatch(/cast-on loop/);
    expect(gen(withBand(classic, { turn: 'purl', close: 'sewn' })).phases.find((p) => p.label.startsWith('Band outside'))!.incsPerRow).toMatch(/sew/);
  });

  it('a picot turning round rounds the band to an even count', () => {
    for (const s of classic.sizes) {
      const y = gen(withBand(classic, { turn: 'picot', close: 'knit' }), s.id);
      expect(y.castOn % 2, s.name).toBe(0);
      expect(y.offShoulder!.pattern).toEqual({ name: 'stockinette, folded', multiple: 2, offset: 0 });
    }
  });

  it('follows the Neckband depth as the finished depth', () => {
    const y = gen(withBand(classic, defaultFold(), 2.5));
    const D = Math.round(2.5 * y.rowsPerCm);
    expect(y.offShoulder!.bandRows).toBe(2 * D + 1);
    expect(y.offShoulder!.bandCm).toBe(2.5);
  });

  it('is ignored when the neckband is not knit with the yoke (the 4 cm rib fallback)', () => {
    const p: Project = { ...classic, edges: { ...defaultEdges(), neckband: { ...defaultEdges().neckband, fold: defaultFold() } } };
    const y = gen(p);
    expect(y.offShoulder!.fold).toBeUndefined();
    expect(y.offShoulder!.pattern.name).toBe('1x1 rib');
  });

  it('foldPart: facing, turn, outside, and the join only when knit closed', () => {
    expect([1, 3, 4, 5, 7].map((r) => foldPart({ close: 'knit', depthRows: 3 }, r))).toEqual(['facing', 'facing', 'turn', 'outer', 'join']);
    expect(foldPart({ close: 'sewn', depthRows: 3 }, 7)).toBe('outer');
  });
});

describe('off-shoulder folded band: every size reaches its targets', () => {
  for (const [name, p0] of [['Classic', classic], ['Modified', modified]] as const) {
    for (const turn of ['purl', 'picot'] as const) {
      it(`${name}, ${turn}: no errors or warnings, body and sleeves on target, short rows after the band`, () => {
        const p = withBand(p0, { turn, close: 'knit' });
        for (const s of p.sizes) {
          const y = gen(p, s.id);
          const sc = buildScope(p, s.id);
          expect(errors(y), s.name).toEqual([]);
          expect(Math.abs(y.held.body + 2 * y.underarmCo - Math.round((sc.upper_chest + sc.ease) * spc)), s.name).toBeLessThanOrEqual(2);
          expect(Math.abs(y.held.leftSleeve + y.underarmCo - Math.round((sc.bicep + sc['ease.bicep']) * spc)), s.name).toBeLessThanOrEqual(1);
          const inc = [...y.raglan!.bodyRows, ...y.raglan!.sleeveRows];
          expect(inc.filter((r) => r <= y.offShoulder!.incRow), s.name).toEqual([]);
          if (name === 'Modified') expect(y.shortRows!.fromRow).toBe(y.offShoulder!.bandRows + 2);
          const warn = contiguousChecks(p, s.id, new Map()).filter((c) => c.issue.severity !== 'info');
          expect(warn.map((c) => c.issue.message), s.name).toEqual([]);
          for (const panel of p.panels) expect(computePanel(p, panel, s.id).ok, `${s.name} ${panel.name}`).toBe(true);
        }
      });
    }
  }
});

describe('off-shoulder folded band: drawing', () => {
  it('the chart: plain facing and outside, a purl turning round, the joining round, Facing / Turn / Band phases', () => {
    const p = withBand(classic, { turn: 'purl', close: 'knit' });
    const panel = yokePanel(p);
    const c = computePanel(p, panel, M);
    const o = c.yoke!.offShoulder!;
    const D = o.fold!.depthRows;
    const chart = buildChart(p, panel, c);
    const st = (i: number) => chart.rows[i].cells.filter((v) => v);
    for (let i = 0; i < o.bandRows; i++) expect(st(i)).toHaveLength(o.bandSts);
    for (let i = 0; i < D; i++) expect(st(i).every((v) => v === 'k')).toBe(true);
    expect(st(D).every((v) => v === 'purl')).toBe(true);
    for (let i = D + 1; i < o.bandRows - 1; i++) expect(st(i).every((v) => v === 'k')).toBe(true);
    expect(st(o.bandRows - 1).every((v) => v === JOIN)).toBe(true);
    expect(chart.legend.map((l) => l.id)).toEqual(expect.arrayContaining([JOIN, 'purl']));
    expect(chart.phases!.slice(0, 4).map((x) => x.label)).toEqual(['Facing', 'Turn', 'Band', 'Inc']);
    expect(chart.repeats[0]).toMatchObject({ name: 'Band: stockinette, folded', fromRow: 1, toRow: o.bandRows, multiple: 1 });
  });

  it('the chart: a picot turning round is yo, k2tog; a sewn band has no joining round', () => {
    const p = withBand(classic, { turn: 'picot', close: 'sewn' });
    const panel = yokePanel(p);
    const c = computePanel(p, panel, M);
    const o = c.yoke!.offShoulder!;
    const chart = buildChart(p, panel, c);
    const turn = chart.rows[o.fold!.depthRows].cells.filter((v) => v);
    expect(turn.every((v, i) => v === (i % 2 ? 'k2tog' : 'yo'))).toBe(true);
    expect(chart.rows.some((r) => r.cells.includes(JOIN))).toBe(false);
  });

  it('the top view draws the band from its fold: the facing and turning round have no width, the yoke the rib’s size', () => {
    const rib = gen(withBand(classic));
    const y = gen(withBand(classic, defaultFold()));
    const g = topGeometry(y);
    const D = y.offShoulder!.fold!.depthRows;
    expect(g.rings).toHaveLength(y.rows.length + 1);
    for (const ring of g.rings.slice(1, D + 2)) expect(ring.r1).toBe(ring.r0);
    expect(g.rings[D + 2].r1).toBeGreaterThan(g.rings[D + 2].r0);
    // (From the cast-on ring: rib rounds the band to an even count, stockinette doesn't.)
    const gr = topGeometry(rib);
    expect(g.outerR - g.neckR).toBeCloseTo(gr.outerR - gr.neckR, 9);
    // The stitch chart's rings: every row, the facing too.
    const flat = topGeometry(y, false);
    for (const ring of flat.rings.slice(1)) expect(ring.r1).toBeGreaterThan(ring.r0);
  });

  it('the flat panel (schematic) shows the band section over all its rows', () => {
    const p = withBand(classic, defaultFold());
    const c = computePanel(p, yokePanel(p), M);
    const o = c.yoke!.offShoulder!;
    expect(c.sections).toEqual([expect.objectContaining({ name: 'Band', fromRow: 1, toRow: o.bandRows, patternName: 'stockinette, folded' })]);
    expect(c.waypoints.find((w) => w.name === 'ring')!.row).toBe(o.incRow);
  });
});

describe('off-shoulder folded band: settings', () => {
  it('saves and loads; an edge without a fold loads as before', () => {
    const p = withBand(modified, { turn: 'picot', close: 'sewn' });
    const r = loadProject(JSON.stringify(p));
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.project.edges!.neckband.fold).toEqual({ turn: 'picot', close: 'sewn' });
    expect(garmentChoice(r.project)).toMatchObject({ method: 'modified-raglan', neckline: 'off-shoulder' });
    const q = loadProject(JSON.stringify(withBand(classic)));
    if (!q.ok) throw new Error(q.errors.join('\n'));
    expect('fold' in q.project.edges!.neckband).toBe(false);
  });

  it('another neckline takes the neckband back to the default strip, without the fold', () => {
    const p = withBand(classic, defaultFold());
    expect(edgesForNeckline(p.edges!, 'round', 'off-shoulder').neckband).toEqual(defaultEdges().neckband);
    const round = setNeckline(p, 'round');
    expect(round.edges!.neckband.fold).toBeUndefined();
    expect(round.panels.some((x) => x.edge === 'neckband')).toBe(true);
  });

  it('labels the band', () => {
    expect(edgeStitchLabel({ ...offShoulderNeckband(), fold: { turn: 'picot', close: 'knit' } })).toBe('folded stockinette, picot turning round');
    expect(edgeStitchLabel(offShoulderNeckband())).toBe('1×1 rib');
  });

  it('a folded band adds no strip or pick-up join', () => {
    const p = withBand(classic, defaultFold());
    expect(p.panels.some((x) => x.edge === 'neckband')).toBe(false);
    expect((p.joins ?? []).some((j) => j.edge === 'neckband')).toBe(false);
  });
});
