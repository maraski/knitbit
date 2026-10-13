import { describe, expect, it } from 'vitest';
import { computePanel } from './panel';
import { fromTemplate, TEMPLATES, type TemplateId, type TemplateOptions } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

const CASES: [TemplateId, TemplateOptions][] = [
  ['back', {}],
  ['back', { direction: 'top-down' }],
  ['back', { joinInRound: true }],
  ['back', { joinInRound: true, direction: 'top-down' }],
  ['front', { neckline: 'round' }],
  ['front', { neckline: 'v' }],
  ['front', { neckline: 'square' }],
  ['front', { neckline: 'boat' }],
  ['front', { direction: 'top-down' }],
  ['front', { direction: 'top-down', neckline: 'v', joinInRound: true }],
  ['top', {}],
  ['top', { neckline: 'v', joinInRound: true, shoulderSlope: 'none' }],
  ['back', { direction: 'top-down', shoulderSlope: 'none' }],
  ['back', { direction: 'top-down', backNeck: 'shaped', joinInRound: true }],
  ['front', { direction: 'top-down', shoulderSlope: 'none', neckline: 'square', joinInRound: true }],
  ['back', { direction: 'top-down', construction: 'standalone' }],
  ['front', { direction: 'top-down', construction: 'standalone' }],
  ['sleeve', { sleeve: 'set-in' }],
  ['sleeve', { sleeve: 'set-in', direction: 'top-down' }],
  ['sleeve', { sleeve: 'drop' }],
  ['sleeve', { sleeve: 'straight' }],
  ['rectangle', {}],
  ['neckband', {}],
];

describe('templates', () => {
  it('every template computes with no errors or warnings in every size', () => {
    const p = fixtureProject();
    for (const [id, opts] of CASES) {
      const panel = fromTemplate(id, opts);
      for (const s of p.sizes) {
        const c = computePanel(p, panel, s.id);
        const label = `${id} ${JSON.stringify(opts)} ${s.name}`;
        expect(c.ok, label).toBe(true);
        expect(c.issues.filter((i) => i.severity !== 'info').map((i) => i.message), label).toEqual([]);
      }
    }
  });

  it('lists every template id', () => {
    expect(TEMPLATES.map((t) => t.id).sort()).toEqual(['back', 'front', 'neckband', 'rectangle', 'sleeve', 'top']);
  });

  it('front and back share side seams: same rows, front wider at the waist by 2 × waist_shift', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    const back = computePanel(p, fromTemplate('back'), M);
    const front = computePanel(p, fromTemplate('front'), M);
    const at = (c: typeof back, n: string) => c.waypoints.find((w) => w.name === n)!;
    for (const n of ['hem', 'waist', 'underarm', 'shoulder']) expect(at(front, n).row, n).toBe(at(back, n).row);
    expect(at(front, 'waist').widthCm - at(back, 'waist').widthCm).toBeCloseTo(5, 6); // (124.5 − 114.5)/4 × 2
  });

  it('necklines differ as expected', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    const neck = (shape: 'round' | 'v' | 'square' | 'boat') => computePanel(p, fromTemplate('front', { neckline: shape }), M).neck!;
    expect(neck('square').perSide).toBe(0);
    expect(neck('v').centreSts).toBe(0);
    expect(neck('v').depthRows).toBeGreaterThan(neck('round').depthRows);
    expect(neck('boat').widthSts).toBeGreaterThan(neck('round').widthSts);
  });
});

describe('joined in the round below the underarm', () => {
  it('drops selvedges and works rounds below the join, flat above with a RS first row', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    const flat = computePanel(p, fromTemplate('back'), M);
    const joined = computePanel(p, fromTemplate('back', { joinInRound: true }), M);
    const at = (c: typeof flat, n: string) => c.waypoints.find((w) => w.name === n)!;
    expect(at(joined, 'hem').selvedge).toBe(0);
    expect(at(joined, 'underarm').inRound).toBe(true);
    expect(at(joined, 'armhole_bo').selvedge).toBe(2);
    expect(at(joined, 'hem').stitches).toBe(at(flat, 'hem').stitches - 2);
    expect(joined.roundRows).toEqual({ from: 1, to: at(joined, 'underarm').row });
    expect(joined.firstFlatRow).toBe(at(joined, 'underarm').row + 1);
    // The armhole bind-off keeps the selvedge stitches: one fewer bound off each side.
    const bo = (c: typeof flat) => c.segments.find((s) => s.fromWaypoint === at(c, 'underarm').id)!;
    expect(bo(joined).left.events.reduce((a, e) => a + e.delta, 0)).toBe(bo(flat).left.events.reduce((a, e) => a + e.delta, 0) + 1);
    // At the join both underarms are bound off in one go on the dividing row; flat panels use the next 2 rows.
    expect(bo(joined).left.events).toHaveLength(1);
    expect(bo(joined).left.events[0].row).toBe(joined.firstFlatRow);
    expect(bo(joined).right.events[0].row).toBe(joined.firstFlatRow);
    expect(bo(joined).left.summary).toMatch(/on the dividing round/);
    expect(bo(flat).left.events).toHaveLength(1);
    // Flat: the beginning of the next 2 rows (right edge on the RS row, left edge on the WS row).
    const seg = bo(flat);
    expect(seg.right.events[0].row % 2).toBe(1);
    expect(seg.left.events[0].row % 2).toBe(0);
    expect([seg.left.events[0].row, seg.right.events[0].row].sort()).toEqual([seg.rowFrom, seg.rowFrom + 1]);
    // RS parity of the flat part counts from its first row.
    expect((joined.neck!.splitRow - joined.firstFlatRow) % 2).toBe(0);
  });

  it('top-down: flat from row 1 to the underarm, then rounds; underarm stitches cast on where the panels join', () => {
    const p = fixtureProject();
    const c = computePanel(p, fromTemplate('back', { joinInRound: true, direction: 'top-down' }), sizeId(p, 'M'));
    const under = c.waypoints.find((w) => w.name === 'underarm')!;
    expect(c.firstFlatRow).toBe(1);
    expect(c.roundRows).toEqual({ from: under.row + 1, to: c.totalRows });
    const seg = c.segments.find((s) => s.fromWaypoint === under.id)!;
    expect(seg.left.events.map((e) => [e.row, e.kind])).toEqual([[under.row, 'caston']]);
    expect(seg.right.events.map((e) => e.row)).toEqual([under.row]);
    expect(seg.left.summary).toMatch(/where the panels are joined/);
  });
});

describe('joined panel checks', () => {
  it('flags joined panels whose rounds differ, and notes different shaping rounds', async () => {
    const { projectChecks } = await import('./checks');
    const p = fixtureProject();
    const back = fromTemplate('back', { joinInRound: true });
    const front = fromTemplate('front', { joinInRound: true });
    p.panels = [back, front];
    const ok = projectChecks(p).filter((c) => /joined/i.test(c.issue.message));
    expect(ok.filter((c) => c.issue.severity === 'warning')).toEqual([]);
    expect(ok.some((c) => c.issue.severity === 'info')).toBe(true); // front has more waist shaping than the back
    front.waypoints.find((w) => w.name === 'underarm')!.height.expr = 'hem_to_waist + waist_to_armhole + 2';
    const bad = projectChecks(p).filter((c) => c.issue.severity === 'warning' && /different numbers of rounds/.test(c.issue.message));
    expect(bad.length).toBe(p.sizes.length * 2);
  });
});

describe('pattern sections', () => {
  it('rounds waypoints inside a section to its multiple', () => {
    const p = fixtureProject();
    const s = fromTemplate('sleeve', { sleeve: 'set-in' });
    for (const size of p.sizes) {
      const c = computePanel(p, s, size.id);
      const cuff = c.waypoints.find((w) => w.name === 'cuff')!;
      expect((cuff.stitches - cuff.selvedge - 2) % 4, size.name).toBe(0); // 2x2 rib: multiple of 4 + 2
      expect(c.sections[0]).toMatchObject({ name: 'Cuff rib', fromRow: 0, multiple: 4, offset: 2 });
      expect(c.sections[0].toRow).toBe(15);
    }
  });
});
