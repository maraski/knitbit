// A front neck deeper than the yoke's split (contiguous back start, classic raglan): the yoke works the neck up to the
// split, the front body piece(s) carry on with the rest, and the body is flat until the neck closes.

import { describe, expect, it } from 'vitest';
import { projectChecks } from './checks';
import { generateYoke, yokeNames } from './contiguous';
import { defaultEdges } from './edgeTreatments';
import { buildGarment } from './garmentSetup';
import { joinReport, measureEdge } from './joins';
import { dim, type FrontOpening, type Project, type YokeSpec } from './model';
import { computePanel } from './panel';
import { fixtureProject, sizeId } from './testFixtures';

const build = (method: 'contiguous' | 'raglan' | 'top-down', opening: FrontOpening, neckline: 'v' | 'round') =>
  buildGarment({ ...fixtureProject(), panels: [], joins: [] }, { method, opening, neckline, sleeve: method === 'raglan' ? 'raglan' : method === 'contiguous' ? 'contiguous' : 'set-in', ease: 'standard', edges: defaultEdges() });
const editYoke = (p: Project, edit: (y: YokeSpec) => void): Project => ({
  ...p,
  panels: p.panels.map((x) => (x.yoke ? { ...x, yoke: (() => { const y = structuredClone(x.yoke!); edit(y); return y; })() } : x)),
});
const deep = (method: 'contiguous' | 'raglan', opening: FrontOpening, neckline: 'v' | 'round', depth = 25) =>
  editYoke(build(method, opening, neckline), (y) => {
    y.start = 'back';
    y.neck.depth = dim(depth);
  });
const yokeOf = (p: Project) => p.panels.find((x) => x.yoke)!;

describe('deep neck past the yoke split', () => {
  for (const method of ['contiguous', 'raglan'] as const) {
    for (const opening of ['closed', 'cardigan'] as const) {
      for (const neckline of ['v', 'round'] as const) {
        const p = deep(method, opening, neckline);
        const fronts = p.panels.filter((x) => x.fromYoke === 'front');
        const backPanel = p.panels.find((x) => x.fromYoke === 'back')!;

        it(`${method} × ${opening} × ${neckline}, 25 cm: no errors in any size, and no stitch-count or rounds warnings`, () => {
          const checks = projectChecks(p);
          expect(checks.filter((c) => c.issue.severity === 'error')).toEqual([]);
          expect(checks.filter((c) => /body starts with|joined in the round have different|cannot be computed/.test(c.issue.message))).toEqual([]);
        });

        it(`${method} × ${opening} × ${neckline}: the front body works the rest of the neck, the body flat until it closes`, () => {
          let continuing = 0;
          for (const size of p.sizes) {
            const y = generateYoke(p, yokeOf(p).yoke!, size.id);
            const nc = y.neckContinues;
            const front = fronts.map((f) => computePanel(p, f, size.id));
            if (!nc) {
              expect(front.every((c) => !c.neck)).toBe(true);
              continue;
            }
            continuing++;
            expect(y.issues.some((i) => i.code === 'yoke.neck-continues' && i.severity === 'info')).toBe(true);
            for (const c of front) {
              expect(c.ok).toBe(true);
              expect(c.neck).toMatchObject({ atStart: true, perSide: nc.perSide });
              expect(c.neck!.events.map((e) => e.row)).toEqual(nc.increaseRows.map((r) => r + c.neck!.splitRow - nc.rows));
              expect(c.neck!.splitRow % 2).toBe(1);
            }
            if (opening === 'closed') {
              // The centre cast-on, then in the round; the Back is flat for the same rows.
              const c = front[0];
              expect(c.neck!.centreSts).toBe(nc.centre);
              expect(c.roundRows?.from).toBe(c.neck!.splitRow + 1);
              expect(computePanel(p, backPanel, size.id).roundRows?.from).toBe(c.neck!.splitRow + 1);
            } else {
              // Each front casts on at its front edge (the yoke's front-edge cast-on).
              for (const c of front) expect(c.neck!.centreSts).toBe(nc.frontEdgeCo);
            }
          }
          expect(continuing).toBeGreaterThan(0);
        });

        it(`${method} × ${opening} × ${neckline}: the neckband picks up along the yoke neck and the front body's neck edges`, () => {
          const join = (p.joins ?? []).find((j) => j.name === 'Neckband picked up')!;
          expect(join).toBeDefined();
          const s = sizeId(p, '4XS');
          const ratio = p.settings.pickUp;
          const yokeNeck = measureEdge(p, { panelId: yokeOf(p).id, edge: { kind: 'neck' } }, s, ratio);
          const bodyNecks = fronts.map((f) => measureEdge(p, { panelId: f.id, edge: { kind: 'neck' } }, s, ratio));
          expect(bodyNecks.every((m) => m.ok && m.pickup > 0)).toBe(true);
          const r = joinReport(p, join, s);
          expect(r.a.ok).toBe(true);
          expect(yokeNeck.pickup).toBe(r.a.pickup);
          // The yoke's part: the cast-on and the slopes down to the split, then the body's.
          const y = generateYoke(p, yokeOf(p).yoke!, s);
          const alone = y.castOn + 2 * Math.round(y.counts.total * (ratio.stitches / ratio.rows));
          expect(r.a.pickup).toBe(alone + bodyNecks.reduce((a, m) => a + m.pickup, 0));
        });
      }
    }
  }

  it('the yoke.* neck names: 0 when the neck closes in the yoke, its rows, increases and centre when it continues', () => {
    const p = deep('contiguous', 'closed', 'round');
    const s = sizeId(p, '4XS');
    const v = (yokeNames(p, s) as { values: Record<string, number> }).values;
    const nc = generateYoke(p, yokeOf(p).yoke!, s).neckContinues!;
    expect([v['yoke.neck_rows'], v['yoke.neck_per_side'], v['yoke.neck_centre']]).toEqual([nc.rows, nc.perSide, nc.centre]);
    const shallow = build('contiguous', 'closed', 'round');
    const w = (yokeNames(shallow, sizeId(shallow, '4XS')) as { values: Record<string, number> }).values;
    expect([w['yoke.neck_rows'], w['yoke.neck_per_side'], w['yoke.neck_centre']]).toEqual([0, 0, 0]);
  });

  it('a default-depth yoke gives the body pieces no neck and works them in the round from row 1', () => {
    const p = build('contiguous', 'closed', 'v');
    for (const x of p.panels.filter((q) => q.fromYoke === 'front' || q.fromYoke === 'back')) {
      const c = computePanel(p, x, sizeId(p, 'M'));
      expect(c.neck).toBeNull();
      expect(c.roundRows?.from).toBe(1);
    }
  });

  it('notes bust short rows worked while the front is still open', () => {
    const p = deep('contiguous', 'closed', 'v', 30);
    const front = p.panels.find((x) => x.fromYoke === 'front')!;
    const c = computePanel(p, front, sizeId(p, '4XS'));
    if (c.bust?.shortRows && c.neck && c.bust.shortRows.afterRow < c.neck.splitRow) expect(c.issues.some((i) => i.code === 'bust.open-front')).toBe(true);
  });
});

describe('joined-rounds check with a deep top-down neck', () => {
  it('counts rounds from where the neck closes: no false warning', () => {
    const p0 = build('top-down', 'closed', 'v');
    const p = { ...p0, panels: p0.panels.map((x) => (x.neckline && x.template === 'front' ? { ...x, neckline: { ...x.neckline, depth: dim(25) } } : x)) };
    const checks = projectChecks(p);
    expect(checks.some((c) => /neck closes on row \d+, below the underarm join/.test(c.issue.message))).toBe(true);
    expect(checks.filter((c) => /joined in the round have different/.test(c.issue.message))).toEqual([]);
  });
});
