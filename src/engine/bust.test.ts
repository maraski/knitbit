import { describe, expect, it } from 'vitest';
import { plugIn } from './bust';
import { buildScope } from './measurements';
import { dim, type BustMethod, type Panel } from './model';
import { computePanel } from './panel';
import { loadProject, serializeProject } from './schema';
import { bodice, fromTemplate } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

function front(method: BustMethod = 'shortrows', mod?: (p: Panel) => void): Panel {
  const f = bodice('front');
  f.bust!.method = method;
  mod?.(f);
  return f;
}

describe('bust formulas', () => {
  it('shows the formulas with the numbers plugged in', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    const c = computePanel(p, front(), M);
    expect(c.bust!.D).toBe(10);
    expect(c.bust!.width).toMatchObject({ plugged: '(124.5 - 114.5) * 1.0', value: 10, overridden: false });
    expect(c.bust!.length).toMatchObject({ plugged: 'max(0, (124.5 - 114.5) - 0) * 0.5', value: 5 });
    expect(plugIn('bust/2 + ease/2', buildScope(p, M))).toBe('124.5/2 + 5/2');
  });

  it('takes a per-size override', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    const c = computePanel(p, front('shortrows', (f) => (f.bust!.length = dim('max(0, (bust - upper_chest) - 0) * 0.5', { [M]: 3 }))), M);
    expect(c.bust!.length).toMatchObject({ value: 3, overridden: true });
    expect(c.bust!.shortRows!.pairs).toHaveLength(5); // 3 cm × 3 rows/cm / 2 = 4.5 → 5 pairs
  });

  it('adds the bust width at the side seams only when asked', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    const under = (f: Panel) => computePanel(p, f, M).waypoints.find((w) => w.name === 'underarm')!.widthCm;
    expect(under(front()) - under(bodice('back'))).toBeCloseTo(10, 6);
    expect(under(front('shortrows', (f) => (f.bust!.sideWidth = false)))).toBeCloseTo(under(bodice('back')), 6);
    expect(under(front('vertical-dart'))).toBeCloseTo(under(bodice('back')), 6); // darts carry the width instead
  });
});

describe('short rows', () => {
  it('build a symmetric wedge centred on the bust point', () => {
    const p = fixtureProject();
    for (const s of p.sizes) {
      const c = computePanel(p, front(), s.id);
      const sr = c.bust!.shortRows!;
      const label = s.name;
      expect(sr.pairs.length, label).toBe(Math.round((c.bust!.length.value * c.rowsPerCm) / 2));
      expect(sr.extraRows).toBe(sr.pairs.length * 2);
      for (const pr of sr.pairs) expect(pr.leftUnworked, label).toBe(pr.rightUnworked);
      // Shortening: each pair turns further in.
      for (let i = 1; i < sr.pairs.length; i++) expect(sr.pairs[i].leftUnworked, label).toBeGreaterThan(sr.pairs[i - 1].leftUnworked);
      // The first short row is a RS row, and the wedge straddles the bust point.
      expect((sr.afterRow + 1 - c.firstFlatRow) % 2, label).toBe(0);
      expect(Math.abs(sr.afterRow + sr.pairs.length - c.bust!.apex.row), label).toBeLessThanOrEqual(1);
      expect(c.issues.filter((i) => i.severity !== 'info').map((i) => i.message), label).toEqual([]);
    }
  });

  it('work out stitches worked before each turn', () => {
    const p = fixtureProject();
    const c = computePanel(p, front(), sizeId(p, 'M'));
    const sr = c.bust!.shortRows!;
    const [a, b] = sr.pairs;
    expect(a.rsWorked).toBe(sr.liveStitches - a.leftUnworked);
    expect(a.wsWorked).toBe(sr.liveStitches - a.leftUnworked - a.rightUnworked);
    expect(b.rsWorked).toBe(sr.liveStitches - b.leftUnworked - a.rightUnworked);
  });

  it('warn on accidental asymmetry and on crowded turns', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    const base = computePanel(p, front(), M).bust!.shortRows!.pairs;
    const left = base.map((x) => x.leftUnworked);
    const right = [...left];
    right[2] += 1;
    const c = computePanel(p, front('shortrows', (f) => (f.bust!.manual[M] = { left, right })), M);
    expect(c.bust!.shortRows!.manual).toBe(true);
    expect(c.issues.some((i) => /asymmetric/.test(i.message))).toBe(true);
    const crowded = computePanel(p, front('shortrows', (f) => (f.bust!.shortRows.zoneWidth = dim(2))), M);
    expect(crowded.issues.some((i) => /Turns are only/.test(i.message))).toBe(true);
  });

  it('a horizontal dart turns between the side and a tip short of the bust point', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    const c = computePanel(p, front('horizontal-dart'), M);
    const sr = c.bust!.shortRows!;
    expect(sr.kind).toBe('dart');
    const innermost = Math.max(...sr.pairs.map((x) => x.leftUnworked));
    const half = (c.rightEdge[sr.afterRow] - c.leftEdge[sr.afterRow]) / 2;
    expect(half - innermost).toBeGreaterThan(c.bust!.apex.offsetCm * c.stitchesPerCm); // tip outside the bust point
    const under = computePanel(p, front('horizontal-dart', (f) => (f.bust!.dart.placement = 'underarm')), M);
    const uRow = under.waypoints.find((w) => w.name === 'underarm')!.row;
    expect(under.bust!.shortRows!.afterRow).toBeLessThan(uRow);
    expect(under.bust!.shortRows!.afterRow).toBeGreaterThan(c.bust!.shortRows!.afterRow);
  });
});

describe('vertical darts', () => {
  it('open below the bust and close above it, in every size and both directions', () => {
    const p = fixtureProject();
    for (const dir of ['bottom-up', 'top-down'] as const) {
      for (const s of p.sizes) {
        const c = computePanel(p, front('vertical-dart', (f) => (f.direction = dir)), s.id);
        const d = c.bust!.darts!;
        const label = `${dir} ${s.name}`;
        expect(d.perDart, label).toBe(Math.round((c.bust!.width.value / 2) * c.stitchesPerCm));
        expect(Math.max(...d.interior), label).toBe(2 * d.perDart);
        expect(d.interior[0], label).toBe(0);
        expect(d.interior[c.totalRows], label).toBe(0);
        expect(c.counts[c.bust!.apex.row] - c.counts[0], label).toBeGreaterThan(0);
        expect(c.issues.filter((i) => i.severity !== 'info').map((i) => i.message), label).toEqual([]);
      }
    }
  });
});

describe('short-row shoulders keep their stitches live', () => {
  it('top-down bodices cast on both shoulders and keep them through the slope', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    const c = computePanel(p, fromTemplate('back', { direction: 'top-down' }), M);
    const shoulder = c.waypoints.find((w) => w.name === 'shoulder')!;
    const neckSide = c.waypoints.find((w) => w.name === 'neck_side')!;
    expect(c.counts[0]).toBe(shoulder.stitches - neckSide.stitches); // both shoulders, neck opening excluded
    expect(c.held[0]).toBeGreaterThan(0);
    expect(c.held[shoulder.row]).toBe(0);
  });
});

describe('bust settings save and load', () => {
  it('round-trips', () => {
    const p = fixtureProject();
    p.panels = [front('vertical-dart', (f) => (f.bust!.manual[sizeId(p, 'M')] = { incRows: [60, 70], decRows: [100, 104] }))];
    const r = loadProject(serializeProject(p));
    expect(r.ok && r.project.panels[0].bust).toEqual(p.panels[0].bust);
  });
});
