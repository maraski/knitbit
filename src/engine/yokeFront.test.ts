import { describe, expect, it } from 'vitest';
import { defaultYoke, generateYoke, ZONES, type YokeResult } from './contiguous';
import { applyEdgeTreatments, defaultEdges, offShoulderNeckband } from './edgeTreatments';
import { setOpening } from './garment';
import { buildGarment, type GarmentSpec } from './garmentSetup';
import { dim, type Project } from './model';
import { defaultRaglan } from './raglan';
import { fixtureProject, sizeId } from './testFixtures';
import { boundaryLineFront, frontGeometry, hitFront, partShapes, pieceOf, type FrontGeometry } from './yokeFront';
import { rowShaping, shapingText, zoneAt } from './yokeShaping';
import { zoneOffsets } from './yokeTop';

const p = fixtureProject();
const M = sizeId(p, 'M');
const cardigan = setOpening(p, 'cardigan');
const base = () => ({ ...fixtureProject(), panels: [], joins: [] });
const spec = (s: Partial<GarmentSpec>): GarmentSpec => ({ method: 'raglan', opening: 'closed', neckline: 'off-shoulder', sleeve: 'raglan', ease: 'standard', ...s });
/** `fold` true: a folded band; 'none': no band (the Neckband switched off); `modified`: the back raised. */
const offShoulder = (fold: boolean | 'none', modified = false): Project => {
  const g = buildGarment(base(), spec(modified ? { method: 'modified-raglan', sleeve: 'contiguous' } : {}));
  return applyEdgeTreatments({ ...g, edges: { ...defaultEdges(), neckband: { ...offShoulderNeckband(), depth: dim(4), enabled: fold !== 'none', ...(fold === true ? { fold: { turn: 'purl', close: 'knit' } } : {}) } } });
};
/** (By the size's name: the garment is built on its own copy of the fixture.) */
const genOS = (q: Project, s = M) => generateYoke(q, q.panels.find((x) => x.yoke)!.yoke!, sizeId(q, p.sizes.find((z) => z.id === s)!.name));

/** Every yoke the views draw: contiguous (PDF start), modified raglan (whole neck, short rows), classic raglan, each
 * pullover and cardigan, and the off-shoulder raglan with a rib band and a folded one. */
const cases: [string, (s: string) => YokeResult][] = [
  ['contiguous', (s) => generateYoke(p, defaultYoke('round', 'back'), s)],
  ['contiguous cardigan', (s) => generateYoke(cardigan, defaultYoke('round', 'back'), s)],
  ['modified raglan', (s) => generateYoke(p, defaultYoke('round', 'neck'), s)],
  ['modified raglan cardigan', (s) => generateYoke(cardigan, defaultYoke('round', 'neck'), s)],
  ['classic raglan', (s) => generateYoke(p, defaultRaglan('round'), s)],
  ['classic raglan cardigan', (s) => generateYoke(cardigan, defaultRaglan('round'), s)],
  ['classic raglan V neck', (s) => generateYoke(p, defaultRaglan('v'), s)],
  ['off-shoulder rib band', (s) => genOS(offShoulder(false), s)],
  ['off-shoulder folded band', (s) => genOS(offShoulder(true), s)],
  ['off-shoulder no band', (s) => genOS(offShoulder('none'), s)],
  ['off-shoulder no band, back raised', (s) => genOS(offShoulder('none', true), s)],
];

const worked = (g: FrontGeometry, row: number) => g.rows[row].parts.reduce((n, q) => n + q.x1 - q.x0, 0);

describe('yoke laid flat: two halves', () => {
  for (const [name, gen] of cases) {
    it(`${name}: every stitch drawn once, in one half, in every size`, () => {
      for (const s of p.sizes) {
        const y = gen(s.id);
        if (!y.ok) continue;
        const g = frontGeometry(y, false);
        expect(g.rows.length).toBe(y.rows.length + 1);
        for (const r of g.rows) {
          // The pieces cover the row exactly: end to end from 0 to the row's total (checked per piece, not per stitch,
          // to keep the every-size run fast).
          const sorted = [...r.pieces].filter((q) => q.i1 > q.i0).sort((a, b) => a.i0 - b.i0);
          let at = 0;
          for (const q of sorted) {
            if (q.i0 !== at) expect(q.i0).toBe(at);
            at = q.i1;
          }
          if (at !== r.total) expect(at).toBe(r.total);
          // The zone parts are the worked stitches.
          const w = worked(g, r.row);
          if (w !== r.hi - r.lo) expect(w).toBe(r.hi - r.lo);
        }
      }
    });
  }

  it('folds each sleeve down its middle, an odd centre stitch on the back', () => {
    const y = generateYoke(p, defaultRaglan('round'), M);
    const g = frontGeometry(y);
    for (const r of g.rows) {
      const off = zoneOffsets(r.zones);
      const back = r.pieces.find((q) => q.half === 'back')!;
      expect(back.i0 - off[1]).toBe(Math.floor(r.zones.leftSleeve / 2));
      expect(back.i1 - off[3]).toBe(Math.ceil(r.zones.rightSleeve / 2));
    }
  });

  it('puts the back half on its centre-back line and the wearer’s left on the left (seen from behind)', () => {
    const y = generateYoke(p, defaultRaglan('round'), M);
    const g = frontGeometry(y);
    const last = g.rows[g.rows.length - 1];
    const back = last.parts.find((q) => q.half === 'back' && q.zone === 'back')!;
    expect(back.x0).toBeCloseTo(-back.x1);
    const ls = last.parts.find((q) => q.half === 'back' && q.zone === 'leftSleeve')!;
    const rs = last.parts.find((q) => q.half === 'back' && q.zone === 'rightSleeve')!;
    expect(ls.x1).toBeCloseTo(back.x0);
    expect(rs.x0).toBeCloseTo(back.x1);
  });

  it('puts the front half on centre front and the wearer’s left on the right (seen from the front)', () => {
    const y = generateYoke(p, defaultRaglan('round'), M);
    const g = frontGeometry(y);
    const last = g.rows[g.rows.length - 1];
    const lf = last.parts.find((q) => q.half === 'front' && q.zone === 'leftFront')!;
    const rf = last.parts.find((q) => q.half === 'front' && q.zone === 'rightFront')!;
    // A pullover joined in the round: the fronts meet at centre front.
    expect(lf.x0).toBeCloseTo(rf.x1);
    expect(lf.x0 + rf.x1).toBeCloseTo(0, 0);
    expect(lf.x1).toBeGreaterThan(0);
    expect(rf.x0).toBeLessThan(0);
    const ls = last.parts.find((q) => q.half === 'front' && q.zone === 'leftSleeve')!;
    expect(ls.x0).toBeCloseTo(lf.x1);
  });

  it('leaves the band space open at centre front on a cardigan', () => {
    const y = generateYoke(cardigan, defaultRaglan('round'), M);
    const g = frontGeometry(y);
    for (const r of g.rows.slice(1)) {
      const lf = r.parts.find((q) => q.half === 'front' && q.zone === 'leftFront');
      const rf = r.parts.find((q) => q.half === 'front' && q.zone === 'rightFront');
      if (lf && rf) expect(lf.x0).toBeGreaterThanOrEqual(rf.x1);
    }
  });

  it('draws the front neck: the PDF start’s fronts grow in from the neck points; short rows work the fronts later', () => {
    for (const y of [generateYoke(p, defaultYoke('round', 'back'), M), generateYoke(p, defaultYoke('round', 'neck'), M)]) {
      const g = frontGeometry(y);
      const edge = (row: number) => g.rows[row].parts.find((q) => q.half === 'front' && q.zone === 'leftFront')?.x0 ?? Infinity;
      // The left front's centre-front edge moves towards centre front, never away.
      for (let r = 2; r < g.rows.length; r++) expect(edge(r)).toBeLessThanOrEqual(edge(r - 1) + 1e-9);
      expect(edge(1)).toBeGreaterThan(edge(g.rows.length - 1));
      // The back starts at row 1 at full cast-on width.
      expect(g.rows[1].parts.some((q) => q.half === 'back' && q.zone === 'back')).toBe(true);
    }
  });

  it('gives a folded band’s facing and turning round no height in the schematic, and all rows in the chart', () => {
    const y = genOS(offShoulder(true));
    const f = y.offShoulder!.fold!;
    const g = frontGeometry(y);
    expect(g.rows[f.depthRows].y1).toBeCloseTo(0);
    expect(g.rows[f.depthRows + 1].y1).toBeCloseTo(0);
    expect(g.height).toBeCloseTo((y.rows.length - f.hiddenRows) / y.rowsPerCm);
    expect(frontGeometry(y, false).height).toBeCloseTo(y.rows.length / y.rowsPerCm);
  });

  it('finds the stitch under a point in either half', () => {
    const y = generateYoke(p, defaultRaglan('round'), M);
    const g = frontGeometry(y);
    const r = g.rows[20];
    for (const part of r.parts) {
      const hit = hitFront(g, part.half, (part.x0 + part.x1) / 2, (r.y0 + r.y1) / 2)!;
      expect(hit.row).toBe(20);
      expect(hit.zone).toBe(part.zone);
      expect(pieceOf(r, hit.index)!.half).toBe(part.half);
      expect(zoneAt(r.zones, hit.index)).toBe(part.zone);
    }
    expect(hitFront(g, 'back', g.extent.back.max + 5, (r.y0 + r.y1) / 2)).toBeNull();
    expect(hitFront(g, 'back', 0, g.height + 1)).toBeNull();
  });

  it('draws each zone as shapes and the markers inside the halves', () => {
    const y = generateYoke(p, defaultRaglan('round'), M);
    const g = frontGeometry(y);
    for (const z of ZONES) {
      const half = z === 'back' ? 'back' : z.endsWith('Front') ? 'front' : null;
      if (half) expect(partShapes(g, half, z)).toHaveLength(1);
    }
    // Raglan lines: left front | left sleeve and right sleeve | right front on the front, the back's two on the back.
    expect(boundaryLineFront(g, 'front', 1).length).toBeGreaterThan(2);
    expect(boundaryLineFront(g, 'front', 4).length).toBeGreaterThan(2);
    expect(boundaryLineFront(g, 'back', 2).length).toBeGreaterThan(2);
    expect(boundaryLineFront(g, 'back', 1)).toHaveLength(0);
  });
});

describe('row shaping counts', () => {
  for (const [name, gen] of cases) {
    it(`${name}: increases and cast-ons add up to each row's change`, () => {
      for (const s of p.sizes) {
        const y = gen(s.id);
        for (const r of y.rows) {
          const sh = rowShaping(y, r.row);
          // (A picot round's yarn overs aren't counted as increases: its k2togs take them back.)
          expect(sh.incs + sh.castOn).toBe(sh.change);
          expect(ZONES.reduce((n, z) => n + sh.incByZone[z], 0)).toBe(sh.incs);
          expect(shapingText(sh).length).toBeGreaterThan(0);
        }
      }
    });
  }

  it('names a raglan row’s increases by symbol and zone', () => {
    const y = generateYoke(p, defaultRaglan('round'), M);
    const r = y.rows.find((x) => x.incs.length === 8 && x.incs.every((i) => i.kind !== 'neck'))!;
    const sh = rowShaping(y, r.row);
    expect(sh.incs).toBe(8);
    expect(sh.items.filter((i) => i.kind === 'inc').map((i) => i.count)).toEqual([4, 4]);
    const t = shapingText(sh);
    expect(t).toMatch(/^8 inc: 4 M1[LR], 4 M1[LR] \(left front 1, left sleeve 2, back 2, right sleeve 2, right front 1\)$/);
  });

  it('counts German short-row turns and the plain half rows', () => {
    const y = generateYoke(p, defaultYoke('round', 'neck'), M);
    const sr = y.shortRows!;
    let turns = 0;
    for (let r = 1; r <= sr.endRow; r++) turns += rowShaping(y, r).turns;
    expect(turns).toBe(y.rows.filter((r) => r.turn).length);
    expect(turns).toBeGreaterThan(0);
    const t = y.rows.find((r) => r.turn)!;
    expect(shapingText(rowShaping(y, t.row))).toMatch(/1 German short-row turn \((left|right) front\)/);
    const half = y.rows.find((r) => r.plain);
    if (half) expect(shapingText(rowShaping(y, half.row))).toContain('half row, no increases');
  });

  it('counts the centre-front cast-on that joins a pullover', () => {
    const y = generateYoke(p, defaultYoke('round', 'back'), M);
    const sh = rowShaping(y, y.counts.neckRow!);
    expect(sh.castOn).toBe(y.neck.centre);
    expect(sh.castOnWhere).toBe('centre-front');
    expect(shapingText(sh)).toContain(`cast on ${y.neck.centre} at centre front, join`);
  });

  it('starts an off-shoulder yoke with no band at the ring: every row drawn with height, the raglan from row 1', () => {
    for (const modified of [false, true]) {
      const y = genOS(offShoulder('none', modified));
      expect(y.offShoulder).toMatchObject({ noBand: true, bandRows: 0, incRow: 0 });
      const g = frontGeometry(y);
      expect(g.rows[0].total).toBe(y.offShoulder!.ringSts);
      expect(g.height).toBeCloseTo(y.rows.length / y.rowsPerCm);
      expect(frontGeometry(y, false).height).toBeCloseTo(g.height);
      for (const r of g.rows.slice(1)) if (r.y1 <= r.y0) expect(r.y1).toBeGreaterThan(r.y0);
    }
  });

  it('reads no band rounds without a band: row 1 is a raglan row (or a short row), never the band or an increase round', () => {
    const classic = genOS(offShoulder('none'));
    const t1 = shapingText(rowShaping(classic, 1));
    expect(rowShaping(classic, 1).band).toBeUndefined();
    expect(t1).not.toMatch(/band|increase round|turning|joining/);
    expect(rowShaping(classic, 1).incs).toBe(classic.rows[0].total - classic.castOn);
    const raised = genOS(offShoulder('none', true));
    expect(raised.shortRows!.fromRow).toBe(1);
    for (let r = 1; r <= raised.rows.length; r++) {
      const sh = rowShaping(raised, r);
      if (sh.band || sh.notes.some((n) => /band|increase round/.test(n))) expect(sh.notes).toEqual([]);
    }
  });

  it('describes the off-shoulder band, its increase round and a folded band’s turning and joining rounds', () => {
    const rib = genOS(offShoulder(false));
    expect(shapingText(rowShaping(rib, 1))).toBe('band: 1x1 rib');
    const inc = rowShaping(rib, rib.offShoulder!.incRow);
    expect(inc.incs).toBe(rib.offShoulder!.ringSts - rib.offShoulder!.bandSts);
    expect(shapingText(inc)).toContain('increase round to the ring');
    const fold = genOS(offShoulder(true));
    const f = fold.offShoulder!.fold!;
    expect(shapingText(rowShaping(fold, 1))).toBe('band facing (folds inside)');
    expect(shapingText(rowShaping(fold, f.depthRows + 1))).toBe(`turning round: purl ${fold.offShoulder!.bandSts}`);
    expect(shapingText(rowShaping(fold, fold.offShoulder!.bandRows))).toBe(`joining round: ${fold.offShoulder!.bandSts} sts knit together with their cast-on loops`);
  });

  it('says so when a row has no shaping', () => {
    const y = generateYoke(p, defaultRaglan('round'), M);
    const plain = y.rows.find((r) => r.row > 1 && !r.incs.length && !r.castOns.length && !r.turn && !r.band)!;
    expect(shapingText(rowShaping(y, plain.row))).toBe('no shaping');
  });
});
