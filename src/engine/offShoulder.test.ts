import { describe, expect, it } from 'vitest';
import { buildChart } from './chart';
import { defaultYoke, generateYoke, yokeNames, yokeWithNeck, ZONES, type YokeResult } from './contiguous';
import { contiguousChecks } from './contiguousChecks';
import { defaultEdges, edgesForNeckline, knitWithPanel, missingStrips, offShoulderNeckband, staleStrips } from './edgeTreatments';
import { setOpening } from './garment';
import { buildGarment, changeMethod, garmentChoice, NECKLINES, necklinesFor, setNeckline, type GarmentSpec } from './garmentSetup';
import { buildScope } from './measurements';
import { dim, type Project, type SleeveLength, type YokeSpec } from './model';
import { computePanel } from './panel';
import { defaultOffShoulder, defaultRaglan } from './raglan';
import { loadProject } from './schema';
import { fixtureProject, sizeId } from './testFixtures';
import { topGeometry } from './yokeTop';
import { bandPurl } from './yokeChart';

const base = () => ({ ...fixtureProject(), panels: [], joins: [] });
const spec = (s: Partial<GarmentSpec>): GarmentSpec => ({ method: 'raglan', opening: 'closed', neckline: 'off-shoulder', sleeve: 'raglan', ease: 'standard', ...s });
const yokeOf = (p: Project) => p.panels.find((x) => x.yoke)!.yoke!;
const classic = buildGarment(base(), spec({}));
const modified = buildGarment(base(), spec({ method: 'modified-raglan', sleeve: 'contiguous' }));
const M = sizeId(classic, 'M');
const gen = (p: Project, s: Partial<YokeSpec> = {}, size = M) => generateYoke(p, { ...yokeOf(p), ...s }, size);
const spc = 2.2;
const errors = (y: YokeResult) => y.issues.filter((i) => i.severity === 'error').map((i) => i.message);

/** Rows that work stitch `i` (row order, as seen from the RS) of zone `zone`. */
const worked = (y: YokeResult, zone: (typeof ZONES)[number], at: (n: number) => number) =>
  y.rows.filter((r) => {
    const k = ZONES.slice(0, ZONES.indexOf(zone)).reduce((a, z) => a + r.zones[z], 0) + at(r.zones[zone]);
    return !r.span || (k >= r.span[0] && k < r.span[1]);
  }).length;

describe('off-shoulder: the band', () => {
  it('casts on off_shoulder_circ less 10 %, an even count for 1×1 rib, knit first in the round with no increases', () => {
    for (const s of classic.sizes) {
      const y = gen(classic, {}, s.id);
      const circ = buildScope(classic, s.id).off_shoulder_circ;
      expect(y.castOn, s.name).toBe(Math.round(Math.round(circ * 0.9 * spc) / 2) * 2);
      expect(y.castOn % 2).toBe(0);
      expect(y.offShoulder!.bandSts).toBe(y.castOn);
      const B = y.offShoulder!.bandRows;
      expect(B).toBe(Math.round(4 * y.rowsPerCm));
      for (const r of y.rows.slice(0, B)) {
        expect(r).toMatchObject({ band: true, phase: 'band', round: true, rs: true, incs: [], total: y.castOn });
        expect(r.span).toBeUndefined();
      }
      expect(y.rows[B].band).toBeUndefined();
    }
  });

  it('the increase round takes every zone from its share of the band to the ring, spread evenly', () => {
    const y = gen(classic);
    const o = y.offShoulder!;
    const r = y.rows[o.incRow - 1];
    expect(o.incRow).toBe(o.bandRows + 1);
    expect(r.round).toBe(true);
    expect(r.incs.every((i) => i.kind === 'band' && i.symbol === 'm1l')).toBe(true);
    expect(r.incs.length).toBe(o.ringSts - o.bandSts);
    expect(r.zones).toEqual(o.ringZones);
    for (const z of ZONES) {
      const at = r.incs.filter((i) => i.zone === z).map((i) => i.at);
      expect(at.length).toBe(o.ringZones[z] - y.castOnZones[z]);
      expect(new Set(at).size).toBe(at.length);
    }
    expect(y.phases.filter((p) => p.id === 'band' || p.id === 'ring').map((p) => [p.id, p.label, p.from, p.to])).toEqual([
      ['band', 'Band, 1x1 rib, in the round', 1, o.bandRows],
      ['ring', 'Increase round', o.incRow, o.incRow],
    ]);
    expect(new Set(y.phases.map((p) => p.id)).size).toBe(y.phases.length);
  });

  it('follows the Neckband edge when it is knit with the panels (depth and stitch)', () => {
    const edges = defaultEdges();
    edges.neckband = { ...edges.neckband, method: 'with-panel', depth: dim(3), stitch: 'rib2x2' };
    const y = gen({ ...classic, edges });
    expect(y.offShoulder!.bandRows).toBe(Math.round(3 * y.rowsPerCm));
    expect(y.castOn % 4).toBe(0);
    expect(y.offShoulder!.pattern.name).toBe('2x2 rib');
  });
});

describe('off-shoulder: the ring', () => {
  it('each sleeve zone is bicep × 0.5 plus its raglan lines; the rest is split evenly between front and back', () => {
    for (const s of classic.sizes) {
      const y = gen(classic, {}, s.id);
      const o = y.offShoulder!;
      const sc = buildScope(classic, s.id);
      expect(o.ringSts).toBe(Math.round(sc.off_shoulder_circ * spc));
      expect(o.armSts).toBe(Math.round(sc.bicep * 0.5 * spc));
      expect(o.ringZones.leftSleeve).toBe(o.armSts + 2 * y.seamSts);
      expect(o.ringZones.rightSleeve).toBe(o.ringZones.leftSleeve);
      const front = o.ringZones.leftFront + o.ringZones.rightFront;
      expect(front + o.ringZones.back + 2 * o.ringZones.leftSleeve).toBe(o.ringSts);
      expect(Math.abs(front - o.ringZones.back), s.name).toBeLessThanOrEqual(1);
      expect(Math.abs(o.ringZones.leftFront - o.ringZones.rightFront)).toBeLessThanOrEqual(1);
      // The band's zones are the ring's, scaled.
      expect(y.castOnZones.leftSleeve).toBe(Math.round(o.ringZones.leftSleeve * (o.bandSts / o.ringSts)));
    }
  });
});

describe('off-shoulder: the depth', () => {
  it('Classic: band top to underarm = armhole_depth − off_shoulder_drop (5 cm) in every size, with a level band', () => {
    for (const s of classic.sizes) {
      const y = gen(classic, {}, s.id);
      const sc = buildScope(classic, s.id);
      expect(sc.off_shoulder_drop).toBe(5);
      expect(y.rows.length, s.name).toBe(Math.round((sc.armhole_depth - 5) * y.rowsPerCm));
      expect(y.shortRows!.pairs).toBe(0);
      expect(y.rows.every((r) => !r.span && r.round)).toBe(true);
      expect(y.offShoulder!.frontRows).toBe(y.rows.length);
    }
  });

  it('a per-size drop moves the band: 8 cm in M only', () => {
    const p = structuredClone(classic);
    const m = p.measurements.find((x) => x.name === 'off_shoulder_drop')!;
    m.manual = { ...m.manual, [M]: 8 };
    const y = gen(p);
    expect(y.rows.length).toBe(Math.round((buildScope(p, M).armhole_depth - 8) * y.rowsPerCm));
    expect(gen(p, {}, sizeId(p, 'S')).rows.length).toBe(gen(classic, {}, sizeId(p, 'S')).rows.length);
  });

  it('Modified: short rows after the increase round raise the back 2 cm; they add rows at the back only', () => {
    for (const s of modified.sizes) {
      const y = gen(modified, {}, s.id);
      const c = gen(classic, {}, sizeId(classic, s.name));
      const sr = y.shortRows!;
      const o = y.offShoulder!;
      const sc = buildScope(modified, s.id);
      expect(sr.pairs).toBe(Math.round(2 * y.rowsPerCm / 2));
      expect(sr.fromRow).toBe(o.incRow + 1);
      expect(sr.endRow).toBe(sr.fromRow! + 2 * sr.pairs);
      expect(y.rows.length).toBe(Math.round((sc.armhole_depth - 5 + 2) * y.rowsPerCm));
      // Nothing before the short rows is turned; they are flat rows, alternating RS and WS; rounds follow.
      expect(y.rows.slice(0, o.incRow).every((r) => !r.span && r.round)).toBe(true);
      const section = y.rows.slice(sr.fromRow! - 1, sr.endRow);
      expect(section.every((r) => r.span && !r.round)).toBe(true);
      expect(section.map((r) => r.rs)).toEqual(section.map((_, i) => i % 2 === 0));
      expect(y.rows.slice(sr.endRow).every((r) => !r.span && r.round)).toBe(true);
      // Centre front skips the whole section; the back works all of it but the first half row (one round with the
      // last): 2 rows more per pair.
      const cf = worked(y, 'leftFront', () => 0);
      const back = worked(y, 'back', (n) => Math.floor(n / 2));
      expect(cf).toBe(y.rows.length - (2 * sr.pairs + 1));
      expect(back - cf).toBe(2 * sr.pairs);
      expect(o.frontRows).toBe(cf);
      // The front is about as deep as the Classic's (the back raise is the difference).
      expect(Math.abs(cf - c.rows.length)).toBeLessThanOrEqual(1);
      // Turns from just past the raglan line toward the middle of the front.
      expect(sr.turns[0]).toBe(o.ringZones.leftFront - 3);
      expect(sr.turns[sr.pairs - 1]).toBeGreaterThanOrEqual(Math.floor(o.ringZones.leftFront / 2));
    }
  });
});

describe('off-shoulder: the solved rates reach the body and sleeve targets in every size', () => {
  for (const [name, p] of [['Classic', classic], ['Modified', modified]] as const) {
    it(`${name}: no errors, body and sleeves within a round's increases of their targets`, () => {
      for (const s of p.sizes) {
        const y = gen(p, {}, s.id);
        const sc = buildScope(p, s.id);
        expect(errors(y), s.name).toEqual([]);
        const body = Math.round((sc.upper_chest + sc.ease) * spc);
        const sleeve = Math.round((sc.bicep + sc['ease.bicep']) * spc);
        // 4 sts per body increase row and 2 per sleeve per row; a raised underarm cast-on says so (info).
        expect(Math.abs(y.held.body + 2 * y.underarmCo - body), s.name).toBeLessThanOrEqual(2);
        expect(Math.abs(y.held.leftSleeve + y.underarmCo - sleeve), s.name).toBeLessThanOrEqual(1);
        if (y.underarmCo > Math.round(sc.underarm_co * spc)) expect(y.issues.some((i) => /underarm cast-on is raised/.test(i.message))).toBe(true);
        // No increases on the band, the increase round or the short rows' half rows.
        const plain = [...y.raglan!.bodyRows, ...y.raglan!.sleeveRows].filter((r) => r <= y.offShoulder!.incRow || y.rows[r - 1].plain);
        expect(plain).toEqual([]);
        const warn = contiguousChecks(p, s.id, new Map()).filter((c) => c.issue.severity !== 'info');
        expect(warn.map((c) => c.issue.message), s.name).toEqual([]);
      }
    });
  }
});

describe('off-shoulder: checks', () => {
  const msgs = (y: YokeResult, sev: string) => y.issues.filter((i) => i.severity === sev).map((i) => i.message).join('\n');
  it('band ease above −5 % or below −20 % warns', () => {
    expect(msgs(gen(classic, { offShoulder: { ...defaultOffShoulder(), bandEase: dim(-0.02) } }), 'warning')).toMatch(/slide down/);
    expect(msgs(gen(classic, { offShoulder: { ...defaultOffShoulder(), bandEase: dim(-0.25) } }), 'warning')).toMatch(/too tight/);
    expect(msgs(gen(classic), 'warning')).toBe('');
  });
  it('a band wider than the ring is an error', () => {
    expect(msgs(gen(classic, { offShoulder: { ...defaultOffShoulder(), bandEase: dim(0.05) } }), 'error')).toMatch(/wider than the ring/);
  });
  it('a drop that leaves less than 4 cm between the band and the underarm is an error', () => {
    const p = structuredClone(classic);
    const m = p.measurements.find((x) => x.name === 'off_shoulder_drop')!;
    m.rule = { type: 'expression', expr: 'armhole_depth - 7' };
    expect(msgs(gen(p), 'error')).toMatch(/between the band and the underarm/);
  });
  it('an arm arc too big for the ring is an error', () => {
    expect(msgs(gen(classic, { offShoulder: { ...defaultOffShoulder(), armArc: dim('off_shoulder_circ / 2') } }), 'error')).toMatch(/no room for the body/);
  });
  it('a cardigan is an error (pullover only for now)', () => {
    expect(msgs(gen(setOpening(classic, 'cardigan')), 'error')).toMatch(/pullover only/);
  });
  it('off_shoulder_circ still an estimate: info', () => {
    expect(contiguousChecks(classic, M, new Map()).some((c) => c.issue.severity === 'info' && /off_shoulder_circ is still an estimate/.test(c.issue.message))).toBe(true);
    const p = structuredClone(classic);
    p.measurements.find((x) => x.name === 'off_shoulder_circ')!.estimate = false;
    expect(contiguousChecks(p, M, new Map()).some((c) => /still an estimate/.test(c.issue.message))).toBe(false);
  });
});

describe('off-shoulder garments', () => {
  it('is offered for the raglans only, pullover only', () => {
    expect(necklinesFor('raglan')).toContain('off-shoulder');
    expect(necklinesFor('modified-raglan')).toContain('off-shoulder');
    expect(necklinesFor('raglan', 'cardigan')).not.toContain('off-shoulder');
    for (const m of ['contiguous', 'seamed', 'top-down', 'custom'] as const) expect(necklinesFor(m)).not.toContain('off-shoulder');
  });

  it('seeds the two new measurements as estimates only when used', () => {
    const names = (p: Project) => p.measurements.map((m) => m.name);
    expect(names(base())).not.toContain('off_shoulder_circ');
    expect(names(buildGarment(base(), spec({ neckline: 'round' })))).not.toContain('off_shoulder_circ');
    for (const n of ['off_shoulder_circ', 'off_shoulder_drop']) expect(classic.measurements.find((m) => m.name === n)).toMatchObject({ estimate: true, region: 'upper' });
    expect(buildScope(classic, M).off_shoulder_circ).toBe(Math.round((buildScope(classic, M).upper_chest + buildScope(classic, M).bicep * 0.6) * 2) / 2);
  });

  it('Classic and Modified both make a raglan-line yoke; garmentChoice reads them back by the back raise', () => {
    expect(yokeOf(classic)).toMatchObject({ style: 'raglan', start: 'neck', neck: { shape: 'off-shoulder' }, offShoulder: { backRaise: dim(0) } });
    expect(yokeOf(modified)).toMatchObject({ style: 'raglan', start: 'neck', neck: { shape: 'off-shoulder' }, offShoulder: { backRaise: dim(2) } });
    expect(garmentChoice(classic)).toMatchObject({ method: 'raglan', neckline: 'off-shoulder', sleeve: 'raglan' });
    expect(garmentChoice(modified)).toMatchObject({ method: 'modified-raglan', neckline: 'off-shoulder', sleeve: 'contiguous' });
    // A back raise of 0 on the Modified card reads back as Classic (the same garment).
    const level = { ...modified, panels: modified.panels.map((x) => (x.yoke ? { ...x, yoke: { ...x.yoke, offShoulder: defaultOffShoulder(false) } } : x)) };
    expect(garmentChoice(level).method).toBe('raglan');
  });

  it('switching between Classic and Modified keeps off-shoulder; a yoke method without it goes round', () => {
    const notes: string[] = [];
    const m = changeMethod(classic, 'modified-raglan', notes);
    expect(garmentChoice(m)).toMatchObject({ method: 'modified-raglan', neckline: 'off-shoulder' });
    expect(garmentChoice(changeMethod(m, 'raglan'))).toMatchObject({ method: 'raglan', neckline: 'off-shoulder' });
    const c: string[] = [];
    expect(garmentChoice(changeMethod(classic, 'contiguous', c)).neckline).toBe('round');
    expect(c.join(' ')).toMatch(/no Off-shoulder neck/);
  });

  const lengths: SleeveLength[] = ['long', 'three-quarter', 'elbow', 'short', 'cap'];
  for (const [method, sleeve] of [['raglan', 'raglan'], ['modified-raglan', 'contiguous']] as const) {
    for (const sleeveLength of lengths) {
      it(`${method} × ${sleeveLength}: every piece computes and charts in every size; body and sleeves take the held stitches`, () => {
        const p = buildGarment(base(), spec({ method, sleeve, sleeveLength }));
        expect(garmentChoice(p)).toMatchObject({ method, neckline: 'off-shoulder', sleeveLength });
        for (const s of p.sizes) {
          for (const panel of p.panels) {
            const c = computePanel(p, panel, s.id);
            expect(c.ok, `${s.name} ${panel.name}: ${c.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ')}`).toBe(true);
            if (panel.yoke) {
              const chart = buildChart(p, panel, c);
              expect(chart.rows.length).toBe(c.yoke!.rows.length);
              expect(chart.castOn).toBe(c.yoke!.castOn);
              expect(topGeometry(c.yoke!).rings.length).toBe(c.yoke!.rows.length + 1);
            }
          }
          const cont = contiguousChecks(p, s.id, new Map()).filter((c) => /starts with/.test(c.issue.message));
          expect(cont.map((c) => c.issue.message)).toEqual([]);
          expect('values' in yokeNames(p, s.id)).toBe(true);
        }
      });
    }
  }

  it('saves and loads', () => {
    const r = loadProject(JSON.stringify(modified));
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(yokeOf(r.project)).toEqual(yokeOf(modified));
    expect(garmentChoice(r.project).method).toBe('modified-raglan');
  });
});

describe('off-shoulder: neckline changes', () => {
  it('a classic raglan goes off-shoulder (level) and back to its own defaults; changed settings stay', () => {
    const y = defaultRaglan('round', 'back');
    const os = yokeWithNeck(y, 'off-shoulder');
    expect(os).toEqual(defaultRaglan('off-shoulder', 'back'));
    expect(yokeWithNeck(os, 'round')).toEqual(y);
    const seam3 = yokeWithNeck(yokeWithNeck({ ...y, seamSts: dim(3) }, 'off-shoulder'), 'round');
    expect(seam3).toEqual({ ...y, seamSts: dim(3) });
  });

  it('a modified raglan (whole-neck contiguous yoke) goes off-shoulder with the back raised, and back', () => {
    const y = defaultYoke('round', 'neck');
    const os = yokeWithNeck(y, 'off-shoulder');
    expect(os).toEqual(defaultRaglan('off-shoulder', 'neck'));
    expect(yokeWithNeck(os, 'round')).toEqual(y);
  });

  it('setNeckline on a raglan garment seeds the measurements and keeps the method', () => {
    const round = buildGarment(base(), spec({ neckline: 'round' }));
    const p = setNeckline(round, 'off-shoulder');
    expect(p.measurements.some((m) => m.name === 'off_shoulder_circ')).toBe(true);
    expect(garmentChoice(p)).toMatchObject({ method: 'raglan', neckline: 'off-shoulder' });
    expect(garmentChoice(setNeckline(p, 'round'))).toMatchObject({ method: 'raglan', neckline: 'round' });
    const mod = setNeckline(buildGarment(base(), spec({ method: 'modified-raglan', sleeve: 'contiguous', neckline: 'round' })), 'off-shoulder');
    expect(garmentChoice(mod)).toMatchObject({ method: 'modified-raglan', neckline: 'off-shoulder' });
    expect(garmentChoice(setNeckline(mod, 'round'))).toMatchObject({ method: 'modified-raglan', neckline: 'round' });
  });
});

describe('off-shoulder: the neckband is the band (M2)', () => {
  const withEdges = (s: Partial<GarmentSpec>) => buildGarment(base(), spec({ edges: defaultEdges(), ...s }));
  const strips = (p: Project) => p.panels.filter((x) => x.edge === 'neckband' || x.template === 'neckband');
  const neckJoins = (p: Project) => (p.joins ?? []).filter((j) => j.edge === 'neckband');

  it('the neckline list has it, offered for the raglans only', () => {
    expect(NECKLINES.map((n) => n.id)).toContain('off-shoulder');
    expect(necklinesFor('contiguous')).not.toContain('off-shoulder');
    expect(necklinesFor('top-down')).not.toContain('off-shoulder');
  });

  it('a new off-shoulder garment pre-sets the neckband to 4 cm of 1×1 rib knit with the yoke: no strip, no pick-up', () => {
    for (const p of [withEdges({}), withEdges({ method: 'modified-raglan', sleeve: 'contiguous' })]) {
      expect(p.edges!.neckband).toEqual(offShoulderNeckband());
      expect(knitWithPanel('neckband', p.edges!.neckband, p)).toBe(true);
      expect(strips(p)).toEqual([]);
      expect(neckJoins(p)).toEqual([]);
      expect(missingStrips(p)).toEqual([]);
      const y = computePanel(p, p.panels.find((x) => x.yoke)!, sizeId(p, 'M')).yoke!;
      expect(y.offShoulder!.bandCm).toBe(4);
    }
  });

  it('a stitch chosen in the dialog stays; a with-panel neckband on another neckline goes back to the strip', () => {
    const rib2 = withEdges({ edges: { ...defaultEdges(), neckband: { ...offShoulderNeckband(), stitch: 'rib2x2' } } });
    expect(computePanel(rib2, rib2.panels.find((x) => x.yoke)!, sizeId(rib2, 'M')).yoke!.offShoulder!.pattern.name).toBe('2x2 rib');
    const round = withEdges({ neckline: 'round', edges: { ...defaultEdges(), neckband: offShoulderNeckband() } });
    expect(round.edges!.neckband).toEqual(defaultEdges().neckband);
    expect(strips(round)).toHaveLength(1);
    expect(edgesForNeckline(defaultEdges(), 'off-shoulder', 'round').neckband).toEqual(offShoulderNeckband());
  });

  it('round → off-shoulder → round: the strip goes and comes back, with the default neckband', () => {
    const round = withEdges({ neckline: 'round' });
    expect(strips(round)).toHaveLength(1);
    expect(neckJoins(round)).toHaveLength(1);
    const os = setNeckline(round, 'off-shoulder');
    expect(os.edges!.neckband).toEqual(offShoulderNeckband());
    expect(strips(os)).toEqual([]);
    expect(neckJoins(os)).toEqual([]);
    expect(staleStrips(os)).toEqual([]);
    const back = setNeckline(os, 'round');
    expect(garmentChoice(back)).toMatchObject({ method: 'raglan', neckline: 'round' });
    expect(back.edges!.neckband).toEqual(defaultEdges().neckband);
    expect(strips(back)).toHaveLength(1);
    expect(neckJoins(back)).toHaveLength(1);
  });

  it('a method without off-shoulder takes the neckband back to the strip', () => {
    const p = changeMethod(withEdges({}), 'contiguous');
    expect(garmentChoice(p).neckline).toBe('round');
    expect(p.edges!.neckband).toEqual(defaultEdges().neckband);
  });
});

describe('off-shoulder: chart, top view and panel (M2)', () => {
  const p = buildGarment(base(), spec({ edges: defaultEdges(), method: 'modified-raglan', sleeve: 'contiguous' }));
  const panel = p.panels.find((x) => x.yoke)!;
  const c = computePanel(p, panel, sizeId(p, 'M'));
  const y = c.yoke!;
  const o = y.offShoulder!;

  it('the chart shows the rib band (k1, p1), its repeat, the increase round and the raglan phases', () => {
    const chart = buildChart(p, panel, c);
    for (const row of chart.rows.slice(0, o.bandRows)) {
      const st = row.cells.filter((v) => v);
      expect(st).toHaveLength(o.bandSts);
      expect(st.every((v, i) => v === (i % 2 ? 'purl' : 'k'))).toBe(true);
    }
    expect(chart.rows[o.bandRows].cells.filter((v) => v === 'm1l')).toHaveLength(o.ringSts - o.bandSts);
    expect(chart.rows[o.bandRows + 1].cells.includes('purl')).toBe(false);
    expect(chart.repeats).toEqual([expect.objectContaining({ name: 'Band: 1x1 rib', fromRow: 1, toRow: o.bandRows, multiple: 2 })]);
    expect(chart.phases!.map((x) => x.label)).toEqual(['Band', 'Inc', 'R · Raglan', ...(y.counts.E ? ['E · Straight to the split'] : [])]);
    expect(bandPurl({ name: '2x2 rib', multiple: 4, offset: 2 }, 2, 1)).toBe(true);
  });

  it('the top view starts with the band ring, widens at the increase round, and turns the back raise after it', () => {
    const g = topGeometry(y);
    expect(g.rings[0]).toMatchObject({ total: o.bandSts, gap: 0, lo: 0, hi: o.bandSts });
    expect(g.rings[o.bandRows].total).toBe(o.bandSts);
    expect(g.rings[o.incRow].total).toBe(o.ringSts);
    // No short rows on the band or the increase round; the first pair turns in the fronts after it.
    for (const ring of g.rings.slice(1, o.incRow + 1)) expect([ring.lo, ring.total - ring.hi]).toEqual([0, 0]);
    const sr = y.shortRows!;
    expect(sr.pairs).toBeGreaterThan(0);
    expect(g.rings[sr.fromRow!].lo).toBe(sr.turns[0]);
    expect(g.rings[sr.endRow + 1].lo).toBe(0);
  });

  it('the flat panel marks the band as a section and the ring as a landmark', () => {
    expect(c.sections).toEqual([expect.objectContaining({ name: 'Band', fromRow: 1, toRow: o.bandRows, patternName: '1x1 rib' })]);
    expect(c.waypoints.map((w) => w.name)).toEqual(['neck', 'ring', 'underarm']);
    expect(c.waypoints[1]).toMatchObject({ row: o.incRow, stitches: o.ringSts });
  });

  it('every size and every sleeve length makes the drawing without errors', () => {
    for (const len of ['long', 'three-quarter', 'elbow', 'short', 'cap'] as SleeveLength[]) {
      const q = buildGarment(base(), spec({ edges: defaultEdges(), sleeveLength: len }));
      const yp = q.panels.find((x) => x.yoke)!;
      for (const s of q.sizes) {
        const cc = computePanel(q, yp, s.id);
        expect(cc.ok, `${len} ${s.name}`).toBe(true);
        topGeometry(cc.yoke!);
        buildChart(q, yp, cc);
      }
    }
  });
});
