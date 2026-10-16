import { describe, expect, it } from 'vitest';
import { backNeckPositions, defaultYoke, generateYoke, SLOPED_SHOULDER, ZONES, type YokeResult, type ZoneCounts } from './contiguous';
import { setOpening } from './garment';
import { buildScope } from './measurements';
import { dim, type Project, type YokeSpec } from './model';
import { fixtureProject, sizeId } from './testFixtures';

const p = fixtureProject();
const M = sizeId(p, 'M');
const spc = 2.2;
const rpc = 3;
const gen = (spec: Partial<YokeSpec> = {}, project: Project = p, size = M) => generateYoke(project, { ...defaultYoke(), ...spec }, size);
const kinds = (y: YokeResult, r: number, kind: string) => y.rows[r - 1].incs.filter((i) => i.kind === kind).length;

describe('cast-on and row layout', () => {
  it('casts on the back neck plus 6: edge, 2 seam, back neck, 2 seam, edge', () => {
    const y = gen();
    const bn = Math.round(15 * spc);
    expect(y.castOn).toBe(bn + 6);
    expect(y.castOnZones).toEqual({ leftFront: 1, leftSleeve: 2, back: bn, rightSleeve: 2, rightFront: 1 });
  });

  it('row 1 is a RS row with 4 seam increases, one each side of each seam group', () => {
    const y = gen();
    const r1 = y.rows[0];
    expect(r1.rs).toBe(true);
    const seams = r1.incs.filter((i) => i.kind === 'seam');
    expect(seams.map((i) => i.zone)).toEqual(['leftFront', 'back', 'back', 'rightFront']);
    // Next to the seams: the left front's last stitch, the back's first and last, the right front's first.
    expect(seams.map((i) => i.at)).toEqual([r1.zones.leftFront - 1, 0, r1.zones.back - 1, 0]);
    expect(r1.zones.leftSleeve).toBe(2);
  });
});

describe('phases, row by row', () => {
  const y = gen();
  const { A, C, D, total } = y.counts;

  it('phase A: exactly 4 seam increases every row, seam groups unchanged', () => {
    for (let r = 1; r <= A; r++) {
      expect(kinds(y, r, 'seam')).toBe(4);
      expect(y.rows[r - 1].zones.leftSleeve).toBe(2);
    }
  });

  it('every zone total follows from the previous row, its increases, cast-ons and the marker move', () => {
    let prev: ZoneCounts = { ...y.castOnZones };
    for (const row of y.rows) {
      const exp = { ...prev };
      if (row.markersMoved) {
        const k = (y.capTopSts - y.seamSts) / 2;
        exp.leftFront -= k;
        exp.back -= 2 * k;
        exp.rightFront -= k;
        exp.leftSleeve += 2 * k;
        exp.rightSleeve += 2 * k;
      }
      for (const inc of row.incs) exp[inc.zone] += 1;
      for (const co of row.castOns) {
        if (co.where === 'centre-front') {
          exp.leftFront += Math.floor(co.count / 2);
          exp.rightFront += co.count - Math.floor(co.count / 2);
        } else exp[co.zone] += co.count;
      }
      expect(row.zones).toEqual(exp);
      expect(row.total).toBe(ZONES.reduce((a, z) => a + row.zones[z], 0));
      for (const inc of row.incs) {
        expect(inc.at).toBeGreaterThanOrEqual(0);
        expect(inc.at).toBeLessThan(row.zones[inc.zone]);
      }
      prev = row.zones;
    }
  });

  it('moves the markers once, at the start of phase C, so each cap top has 6 sts', () => {
    const moved = y.rows.filter((r) => r.markersMoved);
    expect(moved.map((r) => r.row)).toEqual([A + 1]);
    const before = y.rows[A - 1].zones;
    const after = y.rows[A].zones;
    expect(after.leftSleeve).toBe(6 + 2); // the cap top, plus the first rapid row's 2 increases
    expect(after.leftFront).toBe(before.leftFront - 2 + (y.rows[A].neck ? 1 : 0));
  });

  it('phase C: 4 sleeve increases every row, both ends of each sleeve; the body does not increase', () => {
    for (let r = A + 1; r <= A + C; r++) {
      const row = y.rows[r - 1];
      expect(kinds(y, r, 'sleeve')).toBe(4);
      expect(row.incs.filter((i) => i.kind === 'sleeve').map((i) => [i.zone, i.at === 0 ? 'start' : 'end'])).toEqual([
        ['leftSleeve', 'start'],
        ['leftSleeve', 'end'],
        ['rightSleeve', 'start'],
        ['rightSleeve', 'end'],
      ]);
      expect(kinds(y, r, 'seam')).toBe(0);
    }
  });

  it('phase D: 4 sleeve increases every second row', () => {
    const dRows = y.rows.filter((r) => r.phase === 'D' && r.incs.some((i) => i.kind === 'sleeve')).map((r) => r.row);
    expect(dRows.length).toBeGreaterThan(0);
    for (let i = 1; i < dRows.length; i++) expect(dRows[i] - dRows[i - 1]).toBe(2);
    for (const r of dRows) expect(kinds(y, r, 'sleeve')).toBe(4);
    expect(dRows[dRows.length - 1]).toBe(A + C + D);
  });

  it('splits at the back length from the neck, deepened until the cap is at most half rapid', () => {
    const base = Math.round((4.5 + 20.75 - 2.75) * rpc);
    expect(total).toBeGreaterThanOrEqual(base);
    expect(y.rows.length).toBe(total);
    expect(C).toBeLessThanOrEqual((total - A) / 2);
    const flat = gen({ depth: { ...defaultYoke().depth, deepen: false } });
    expect(flat.counts.total).toBe(base);
    // One row less would need more than half the armhole rapid (or leave the sleeve short).
    const less = gen({ depth: { ...defaultYoke().depth, deepen: false, extra: dim((total - base - 1) / rpc) } });
    expect(less.counts.C > (less.counts.total - less.counts.A) / 2 || less.issues.some((i) => /short of its width/.test(i.message))).toBe(true);
    expect(y.issues.some((i) => /^Yoke deepened by \d+ rows \(\d+\.\d cm\)/.test(i.message))).toBe(total > base);
  });

  it('adds extra depth on top', () => {
    const y2 = gen({ depth: { ...defaultYoke().depth, deepen: false, extra: dim(2) } });
    expect(y2.counts.total).toBe(Math.round((4.5 + 20.75 - 2.75) * rpc) + 6);
  });
});

describe('phase targets', () => {
  it('phase A ends when the back (after the marker move) is the cross back + 1 cm', () => {
    for (const s of p.sizes) {
      const y = gen({}, p, s.id);
      const target = Math.round((buildScope(p, s.id).cross_back_w + 1) * spc);
      const back = y.rows[y.counts.A].zones.back - (y.rows[y.counts.A].incs.filter((i) => i.zone === 'back').length);
      expect(Math.abs(back - target)).toBeLessThanOrEqual(1);
    }
  });

  it('length mode: rows = (sloped shoulder − shorten) × row gauge + extra rows', () => {
    const scope = buildScope(p, M);
    const len = Math.sqrt(((scope.back_shoulder_width - scope.back_neck_width) / 2) ** 2 + scope.shoulder_drop ** 2);
    const y = gen({ shoulder: { mode: 'length', backWidth: dim(0), length: dim(SLOPED_SHOULDER), shorten: dim(2), extraRows: dim(3) } });
    expect(y.counts.A).toBe(Math.round((len - 2) * rpc) + 3);
    expect(y.params.shoulderLength.plugged).toBe('sqrt(((43.25 - 15) / 2) ^ 2 + 4.5 ^ 2)');
  });

  it('the sleeve reaches bicep + ease with the underarm cast-on (armhole depth mode, every size)', () => {
    for (const s of p.sizes) {
      const y = gen({ depth: { ...defaultYoke().depth, mode: 'armhole' } }, p, s.id);
      const scope = buildScope(p, s.id);
      const target = Math.round((scope.bicep + scope['ease.bicep']) * spc);
      expect(y.held.leftSleeve + y.underarmCo).toBeGreaterThanOrEqual(target);
      expect(y.held.leftSleeve + y.underarmCo).toBeLessThanOrEqual(target + 1);
      expect(y.held.rightSleeve).toBe(y.held.leftSleeve);
    }
  });

  it('reaches the sleeve width in every size with the default (deepened) yoke, cap at most half rapid', () => {
    for (const s of p.sizes) {
      const y = gen({}, p, s.id);
      expect(y.issues.filter((i) => i.severity === 'error' || /short of its width/.test(i.message))).toEqual([]);
      expect(y.counts.C).toBeLessThanOrEqual((y.counts.total - y.counts.A) / 2);
    }
  });

  it('says when the sleeve cannot reach its width', () => {
    const y = gen({ depth: { ...defaultYoke().depth, deepen: false } }, p, sizeId(p, '4X'));
    expect(y.issues.some((i) => /The sleeve reaches \d+ sts .* short of its width/.test(i.message))).toBe(true);
  });

  it('the body at the underarm (with both cast-ons) is upper chest + ease', () => {
    for (const s of p.sizes) {
      const y = gen({}, p, s.id);
      const scope = buildScope(p, s.id);
      const target = Math.round((scope.upper_chest + scope.ease) * spc);
      const body = y.held.body + 2 * y.underarmCo;
      if (y.bodyIncs.perEdge > 0) expect(body - target).toBeGreaterThanOrEqual(0);
      if (y.bodyIncs.perEdge > 0) expect(body - target).toBeLessThanOrEqual(4);
    }
  });

  it('without body increases, the underarm cast-on is (body target − yoke body) / 2', () => {
    const y = gen({ body: { width: dim('upper_chest + ease'), increases: false, zone: dim(0.6) } });
    const target = Math.round((114.5 + 5) * spc);
    expect(y.underarmCo).toBe(Math.round((target - y.held.body) / 2));
    expect(y.bodyIncs.rows).toEqual([]);
  });

  it('places body increases on the body side of the armhole markers, in the lower part of the armhole', () => {
    const y = gen();
    const { A } = y.counts;
    const X = y.counts.total - A;
    expect(y.bodyIncs.rows.length).toBe(y.bodyIncs.perEdge);
    for (const r of y.bodyIncs.rows) {
      expect(r).toBeGreaterThan(y.counts.total - Math.round(0.6 * X));
      expect(kinds(y, r, 'body')).toBe(4);
    }
  });
});

describe('graded sizes', () => {
  it('computes every size without errors, growing with the size', () => {
    let prev: YokeResult | null = null;
    for (const s of p.sizes) {
      const y = gen({ depth: { ...defaultYoke().depth, mode: 'armhole' } }, p, s.id);
      expect(y.issues.filter((i) => i.severity === 'error')).toEqual([]);
      if (prev) {
        expect(y.castOn).toBeGreaterThanOrEqual(prev.castOn);
        expect(y.held.body).toBeGreaterThanOrEqual(prev.held.body);
      }
      prev = y;
    }
  });

  it('uses per-size overrides', () => {
    const y = gen({ cap: { topSts: dim(6, { [M]: 10 }), rapidRows: dim(4), solve: false } });
    expect(y.capTopSts).toBe(10);
    expect(y.params.capTopSts.overridden).toBe(true);
    expect(y.counts.C).toBe(4);
  });
});

describe('underarm split and held edges', () => {
  it('holds each sleeve and continues the body from the last row', () => {
    const y = gen();
    const last = y.rows[y.rows.length - 1].zones;
    expect(y.held).toEqual({ leftSleeve: last.leftSleeve, body: last.leftFront + last.back + last.rightFront, rightSleeve: last.rightSleeve });
    expect(y.underarmCo).toBe(Math.round(5.5 * spc)); // underarm_co for M (5.5 cm)
    expect(y.derived.bodyCm).toBeCloseTo((y.held.body + 2 * y.underarmCo) / spc);
  });
});

describe('front neck', () => {
  it('pullover: neck increases at the front edges, then the centre cast on at row R and in the round after', () => {
    const y = gen();
    const R = y.counts.neckRow!;
    expect(R % 2).toBe(1);
    expect(R).toBe(Math.round(8.5 * rpc) + (Math.round(8.5 * rpc) % 2 === 0 ? 1 : 0));
    const neckIncs = y.rows.filter((r) => r.neck).length;
    const bn = Math.round(15 * spc);
    const centre = y.rows[R - 1].castOns[0].count;
    expect(y.rows[R - 1].castOns).toEqual([{ zone: 'rightFront', count: centre, where: 'centre-front' }]);
    expect(centre + 2 * neckIncs).toBe(bn); // the neck opening at the top is the back neck
    expect(centre).toBe(Math.round(15 * 0.4 * spc) + ((bn - Math.round(15 * 0.4 * spc)) % 2));
    expect(y.rows.filter((r) => r.round).map((r) => r.row)[0]).toBe(R + 1);
    expect(y.rows.slice(R).every((r) => r.round && r.rs)).toBe(true);
  });

  it('V neck: no centre stitches; square: all centre, no increases', () => {
    const v = gen({ neck: { shape: 'v', depth: dim('front_neck_drop * 2'), centre: dim(0) } });
    expect(v.rows[v.counts.neckRow! - 1].castOns[0].count).toBe(Math.round(15 * spc) % 2);
    const sq = gen({ neck: { shape: 'square', depth: dim('front_neck_drop + 2'), centre: dim('back_neck_width') } });
    expect(sq.rows.some((r) => r.neck)).toBe(false);
    expect(sq.rows[sq.counts.neckRow! - 1].castOns[0].count).toBe(Math.round(15 * spc));
  });

  it('errors when the neck closes below the split', () => {
    const y = gen({ neck: { shape: 'v', depth: dim(40), centre: dim(0) } });
    expect(y.issues.some((i) => /closes on row \d+, below the underarm split/.test(i.message))).toBe(true);
  });

  it('cardigan: flat throughout, each front casts on at its front edge (less the closing width)', () => {
    const c = setOpening(p, 'cardigan');
    const y = gen({}, c);
    expect(y.rows.every((r) => !r.round)).toBe(true);
    const R = y.counts.neckRow!;
    const co = [...y.rows[R - 1].castOns, ...y.rows[R].castOns];
    expect(co.map((x) => [x.zone, x.where])).toEqual([
      ['rightFront', 'front-edge'],
      ['leftFront', 'front-edge'],
    ]);
    expect(co[0].count).toBe(co[1].count);
    expect(y.rows[R - 1].rs).toBe(true);
    expect(y.rows[R].rs).toBe(false);
  });
});

describe('back neck increases (phase B)', () => {
  it('runs during phase A on RS rows over the first 8 rows, 2 per row by default', () => {
    const y = gen();
    expect(y.rows.filter((r) => r.backNeck).map((r) => r.row)).toEqual([1, 3, 5, 7]);
    for (const r of [1, 3, 5, 7]) expect(kinds(y, r, 'backNeck')).toBe(2);
    expect(y.rows.filter((r) => r.backNeck).every((r) => r.phase === 'A')).toBe(true);
  });

  it('spreads them evenly and symmetrically, offset from one row to the next', () => {
    expect(backNeckPositions(37, 2, 0)).toEqual([9, 27]);
    const odd = backNeckPositions(37, 2, 1);
    expect(odd).not.toEqual([9, 27]);
    expect(odd[0] + odd[1]).toBe(9 + 27); // still symmetric about the centre
    expect(backNeckPositions(40, 3, 0)).toEqual([6, 20, 33]);
  });

  it('uses hand-placed positions for a size', () => {
    const y = gen({ backNeck: { perRow: dim(2), rows: dim(8), manual: { [M]: [[3, 30]] } } });
    const b = y.rows[0].incs.filter((i) => i.kind === 'backNeck').map((i) => i.at);
    expect(b).toEqual([1 + 3 + 1, 1 + 30 + 1 + 1]);
  });
});

describe('saving', () => {
  it('round-trips a panel with a yoke', async () => {
    const { loadProject, serializeProject } = await import('./schema');
    const { newPanel } = await import('./model');
    const panel = { ...newPanel('Yoke'), yoke: defaultYoke() };
    const r = loadProject(serializeProject({ ...p, panels: [panel] }));
    expect(r.ok && r.project.panels[0].yoke).toEqual(defaultYoke());
  });
});
