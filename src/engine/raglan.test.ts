import { describe, expect, it } from 'vitest';
import { generateYoke, yokeNames, ZONES, type YokeResult } from './contiguous';
import { setOpening } from './garment';
import { dim, type Project, type YokeSpec } from './model';
import { computePanel } from './panel';
import { defaultRaglan, raglanPanel } from './raglan';
import { fixtureProject, sizeId } from './testFixtures';

const p = fixtureProject();
const card = setOpening(p, 'cardigan');
const M = sizeId(p, 'M');
const XS = sizeId(p, '4XS');
const spc = 2.2;
const gen = (spec: Partial<YokeSpec> = {}, project: Project = p, size = M) => generateYoke(project, { ...defaultRaglan(), ...spec }, size);
const kinds = (y: YokeResult, r: number, kind: string) => y.rows[r - 1].incs.filter((i) => i.kind === kind).length;

describe('raglan: cast-on and row layout', () => {
  it('casts on the back neck, each sleeve top between two 2-st raglan lines, and one front stitch each side', () => {
    const y = gen();
    const bn = Math.round(15 * spc);
    expect(y.castOnZones.back).toBe(bn);
    expect(y.castOnZones.leftFront).toBe(1);
    expect(y.castOnZones.rightFront).toBe(1);
    expect(y.castOnZones.leftSleeve).toBe(y.raglan!.sleeveTopSts + 4);
    expect(y.castOnZones.rightSleeve).toBe(y.castOnZones.leftSleeve);
    expect(y.seamSts).toBe(2);
    expect(y.start).toBe('back');
  });

  it('row 1 is a RS row: M1R before each line, M1L after it, outside the line stitches', () => {
    const y = gen();
    const r1 = y.rows[0];
    expect(r1.rs).toBe(true);
    const body = r1.incs.filter((i) => i.kind === 'body');
    expect(body.map((i) => [i.zone, i.at, i.symbol])).toEqual([
      ['leftFront', r1.zones.leftFront - 1, 'm1r'],
      ['back', 0, 'm1l'],
      ['back', r1.zones.back - 1, 'm1r'],
      ['rightFront', 0, 'm1l'],
    ]);
    const sleeve = r1.incs.filter((i) => i.kind === 'sleeve');
    expect(sleeve.map((i) => [i.zone, i.at, i.symbol])).toEqual([
      ['leftSleeve', 2, 'm1l'],
      ['leftSleeve', r1.zones.leftSleeve - 3, 'm1r'],
      ['rightSleeve', 2, 'm1l'],
      ['rightSleeve', r1.zones.rightSleeve - 3, 'm1r'],
    ]);
  });

  it('each row adds exactly its increases and cast-ons, in every size, pullover and cardigan, both starts', () => {
    for (const project of [p, card]) {
      for (const start of ['back', 'neck'] as const) {
        for (const s of project.sizes) {
          const y = generateYoke(project, defaultRaglan('round', start), s.id);
          expect(y.ok, `${s.name} ${start}: ${y.issues.map((i) => i.message).join('; ')}`).toBe(true);
          let before = y.castOn;
          for (const r of y.rows) {
            const added = r.incs.length + r.castOns.reduce((a, c) => a + c.count, 0);
            expect(r.total).toBe(before + added);
            expect(r.total).toBe(ZONES.reduce((a, k) => a + r.zones[k], 0));
            before = r.total;
          }
        }
      }
    }
  });
});

describe('raglan: rates solved from the measurements', () => {
  it('the body and sleeves reach their widths at the split (with the underarm cast-on), in every size', () => {
    for (const s of p.sizes) {
      const y = gen({}, p, s.id);
      const body = Math.round((y.params.bodyWidth.value) * spc);
      const sleeve = Math.round(y.params.sleeveWidth.value * spc);
      expect(Math.abs(y.held.body + 2 * y.underarmCo - body)).toBeLessThanOrEqual(2); // 4 sts per body increase row
      expect(Math.abs(y.held.leftSleeve + y.underarmCo - sleeve)).toBeLessThanOrEqual(1);
    }
  });

  it('increases every other row (RS rows, every other round) while that is enough', () => {
    const y = gen({}, p, XS);
    expect(y.raglan!.bodyFast).toBe(0);
    expect(y.raglan!.sleeveFast).toBe(0);
    for (const r of y.raglan!.bodyRows) expect(r % 2).toBe(1);
    for (const r of y.raglan!.sleeveRows) expect(r % 2).toBe(1);
    // Spread down the depth from row 1, the last one near the split.
    expect(y.raglan!.bodyRows[0]).toBe(1);
    expect(y.raglan!.bodyRows.at(-1)!).toBeGreaterThan(y.counts.total - 3);
  });

  it('adds every-row increases (the rows between) where every other row is not enough', () => {
    const big = sizeId(p, '4X');
    const y = gen({}, p, big);
    expect(y.raglan!.bodyFast).toBeGreaterThan(0);
    const even = y.raglan!.bodyRows.filter((r) => r % 2 === 0);
    expect(even.length).toBe(y.raglan!.bodyFast);
    // Every odd row increases on the body then.
    const odd = y.rows.filter((r) => r.row % 2 === 1).map((r) => r.row);
    expect(odd.every((r) => kinds(y, r, 'body') === 4)).toBe(true);
    expect(y.issues.some((i) => i.message.startsWith('Body: every other row'))).toBe(true);
  });

  it('raises the underarm cast-on when even every row is not enough', () => {
    const y = gen({ depth: { ...defaultRaglan().depth, backLength: dim(10) } });
    const normal = gen();
    expect(y.underarmCo).toBeGreaterThan(normal.underarmCo);
    expect(y.raglan!.bodyRows.length).toBe(y.counts.total);
    expect(y.issues.some((i) => i.message.includes('underarm cast-on is raised'))).toBe(true);
  });

  it('the depth is the back length from the neck (plus extra)', () => {
    const y = gen();
    const deeper = gen({ depth: { ...defaultRaglan().depth, extra: dim(2) } });
    expect(deeper.counts.total - y.counts.total).toBe(6);
    expect(y.derived.backLengthCm).toBeCloseTo(y.counts.total / 3);
  });
});

describe('raglan: the front neck', () => {
  it('pullover, increases: the front edges increase, the centre is cast on at row R and the rounds start', () => {
    const y = gen();
    const R = y.counts.neckRow!;
    expect(R % 2).toBe(1);
    expect(y.rows.filter((r) => r.neck).length).toBe(y.neck.perSide);
    expect(y.rows[R - 1].castOns).toEqual([{ zone: 'rightFront', count: y.neck.centre, where: 'centre-front' }]);
    expect(y.rows[R - 1].round).toBe(false);
    expect(y.rows[R].round).toBe(true);
    expect(y.counts.joinRow).toBe(R);
  });

  it('V neck: neck increases all the way down, no centre (but an odd stitch)', () => {
    const y = generateYoke(p, defaultRaglan('v'), M);
    expect(y.neck.centre).toBe(y.castOnZones.back % 2); // an odd back neck leaves 1 st at the point
    expect(y.neck.perSide * 2 + y.neck.centre).toBe(y.castOnZones.back);
    expect(y.ok).toBe(true);
  });

  it('cardigan: flat throughout, each front casts on its share of the centre at its front edge', () => {
    const y = generateYoke(card, defaultRaglan(), M);
    expect(y.counts.joinRow).toBeNull();
    expect(y.rows.every((r) => !r.round)).toBe(true);
    const R = y.counts.neckRow!;
    expect(y.rows[R - 1].castOns).toEqual([{ zone: 'rightFront', count: y.neck.frontEdgeCo, where: 'front-edge' }]);
    expect(y.rows[R].castOns).toEqual([{ zone: 'leftFront', count: y.neck.frontEdgeCo, where: 'front-edge' }]);
    // WS rows don't increase while every other row is enough (neck increases are on RS rows here too).
    const small = generateYoke(card, defaultRaglan(), XS);
    expect(small.raglan!.bodyFast + small.raglan!.sleeveFast).toBe(0);
    expect(small.rows.filter((r) => !r.rs && r.incs.some((i) => i.kind !== 'neck')).length).toBe(0);
  });

  it('whole-neck start: the fronts are cast on, short rows raise the back, the half rows of a pullover make no increases', () => {
    const y = generateYoke(p, defaultRaglan('round', 'neck'), M);
    expect(y.start).toBe('neck');
    expect(y.castOnZones.leftFront).toBeGreaterThan(1);
    const sr = y.shortRows!;
    expect(sr.pairs).toBeGreaterThan(0);
    expect(y.rows[0].plain).toBe(true);
    expect(y.rows[0].incs).toEqual([]);
    expect(y.rows[sr.endRow - 1].incs).toEqual([]);
    expect(y.rows[1].span).toBeDefined();
    expect(y.counts.joinRow).toBe(sr.endRow);
    expect(y.rows.filter((r) => r.neck)).toEqual([]);
  });
});

describe('raglan: as a panel', () => {
  it('computes as a yoke panel with the raglan phase, and gives the yoke.* names', () => {
    const panel = raglanPanel();
    const q = { ...p, garment: { ...p.garment, construction: 'contiguous' as const }, panels: [panel] };
    const c = computePanel(q, panel, M);
    expect(c.ok).toBe(true);
    expect(c.yoke!.phases.map((ph) => ph.id)).toContain('R');
    const n = yokeNames(q, M);
    if (!('values' in n)) throw new Error(n.error);
    expect(n.values['yoke.sleeve_w']).toBeCloseTo((c.yoke!.held.leftSleeve + c.yoke!.underarmCo) / spc);
  });

  it('kfb and other symbols are used on both sides of each line', () => {
    const y = gen({ increase: { type: 'kfb', symbol: 'kfb' } });
    expect(new Set(y.rows[0].incs.map((i) => i.symbol))).toEqual(new Set(['kfb']));
    const yo = gen({ increase: { type: 'other', symbol: 'yo' } });
    expect(new Set(yo.rows[0].incs.map((i) => i.symbol))).toEqual(new Set(['yo']));
  });

  it('a wider raglan line moves the sleeve increases inside it', () => {
    const y = gen({ seamSts: dim(3) });
    const r1 = y.rows[0];
    expect(r1.incs.filter((i) => i.kind === 'sleeve' && i.zone === 'leftSleeve').map((i) => i.at)).toEqual([3, r1.zones.leftSleeve - 4]);
  });
});
