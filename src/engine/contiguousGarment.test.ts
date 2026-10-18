import { describe, expect, it } from 'vitest';
import { generateYoke } from './contiguous';
import { generateBodyAndSleeves, missingYokePanels } from './contiguousGarment';
import { setConstruction, setOpening } from './garment';
import { measureEdge } from './joins';
import { buildScope } from './measurements';
import { dim, type Project } from './model';
import { computePanel } from './panel';
import { rectangle } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

function garment(opening: 'closed' | 'cardigan'): Project {
  return generateBodyAndSleeves(setOpening(setConstruction({ ...fixtureProject(), panels: [] }, 'contiguous'), opening));
}
const byRole = (p: Project, role: string) => p.panels.filter((x) => x.fromYoke === role);

describe('body and sleeves from the yoke (pullover)', () => {
  const p = garment('closed');
  const yoke = p.panels.find((x) => x.yoke)!;

  it('adds the yoke, back, front and two sleeves, top-down, body and sleeves in the round', () => {
    expect(p.panels.map((x) => x.name)).toEqual(['Yoke', 'Back', 'Front', 'Left sleeve', 'Right sleeve']);
    for (const x of p.panels.filter((x) => x.fromYoke)) {
      expect(x.direction).toBe('top-down');
      expect(x.inTheRound).toBe(true);
    }
    expect(missingYokePanels(p)).toEqual([]);
  });

  it('starts each panel with the held stitches plus its share of the underarm cast-on, in every size', () => {
    for (const s of p.sizes) {
      const y = generateYoke(p, yoke.yoke!, s.id);
      const top = (role: string) => computePanel(p, byRole(p, role)[0], s.id).counts[0];
      const N = y.underarmCo;
      expect(top('back') + top('front')).toBe(y.held.body + 2 * N);
      expect(top('leftSleeve')).toBe(y.held.leftSleeve + N);
      expect(top('rightSleeve')).toBe(y.held.rightSleeve + N);
    }
  });

  it('shapes in pairs below the yoke: no odd stitch changes, no errors or warnings, in any size', () => {
    for (const s of p.sizes) {
      for (const x of p.panels.filter((x) => x.fromYoke)) {
        const c = computePanel(p, x, s.id);
        expect(c.ok).toBe(true);
        expect(c.issues.filter((i) => i.severity !== 'info')).toEqual([]);
      }
    }
  });

  it('follows the yoke: a wider cap top makes wider sleeves', () => {
    const M = sizeId(p, 'M');
    const before = computePanel(p, byRole(p, 'leftSleeve')[0], M).counts[0];
    const q = { ...p, panels: p.panels.map((x) => (x.yoke ? { ...x, yoke: { ...x.yoke, sleeveWidth: dim('bicep + ease.bicep + 4') } } : x)) };
    const after = computePanel(q, byRole(q, 'leftSleeve')[0], M).counts[0];
    expect(after).toBeGreaterThan(before);
  });

  it('records the continuations as joins, with the held stitches measured', () => {
    expect(p.joins!.map((j) => [j.name, j.tag])).toEqual([
      ['Body continues from the yoke', 'live'],
      ['Left sleeve continues from the yoke', 'live'],
      ['Right sleeve continues from the yoke', 'live'],
      ['Underarm cast-on', 'caston'],
    ]);
    const M = sizeId(p, 'M');
    const y = generateYoke(p, yoke.yoke!, M);
    const body = p.joins![0];
    expect(measureEdge(p, body.edges[0], M, p.settings.pickUp).stitches).toBe(y.held.body);
    expect(body.partner.map((r) => p.panels.find((x) => x.id === r.panelId)!.name)).toEqual(['Back', 'Front']);
  });

  it('places the bust point from the top, using hps_to_apex', () => {
    const M = sizeId(p, 'M');
    const front = byRole(p, 'front')[0];
    const c = computePanel(p, front, M);
    const y = generateYoke(p, yoke.yoke!, M);
    const sc = buildScope(p, M);
    const underarm = c.waypoints.find((w) => w.name === 'underarm')!;
    const fromTop = c.totalRows / c.rowsPerCm + y.rows.length / y.rowsPerCm - c.bust!.apex.heightCm;
    expect(fromTop).toBeCloseTo(sc.hps_to_apex - sc.hps_to_apex * 0.05, 0);
    expect(c.bust!.shortRows!.pairs.length).toBeGreaterThan(0);
    void underarm;
  });

  it('adds nothing the second time', () => {
    expect(generateBodyAndSleeves(p)).toBe(p);
  });
});

describe('body and sleeves from the yoke (cardigan)', () => {
  const p = garment('cardigan');
  const yoke = p.panels.find((x) => x.yoke)!;

  it('makes a mirrored front pair, and works everything flat', () => {
    expect(p.panels.map((x) => x.name)).toEqual(['Yoke', 'Back', 'Right front', 'Left front', 'Left sleeve', 'Right sleeve']);
    for (const x of p.panels.filter((x) => x.fromYoke)) expect(x.inTheRound).toBe(false);
    expect(byRole(p, 'front').map((x) => x.half!.side).sort()).toEqual(['left', 'right']);
  });

  it('each front starts with its yoke front plus its share of the underarm cast-on', () => {
    for (const s of p.sizes) {
      const y = generateYoke(p, yoke.yoke!, s.id);
      const last = y.rows[y.rows.length - 1].zones;
      const half = y.underarmCo - Math.floor(y.underarmCo / 2);
      for (const f of byRole(p, 'front')) expect(computePanel(p, f, s.id).counts[0]).toBe(last.leftFront + half);
      expect(computePanel(p, byRole(p, 'back')[0], s.id).counts[0]).toBe(last.back + 2 * Math.floor(y.underarmCo / 2));
    }
  });
});

describe('yoke names elsewhere', () => {
  it('reports a panel using yoke.* names when there is no yoke', () => {
    const r = rectangle();
    r.waypoints[0].width = dim('yoke.back_w');
    const p = { ...fixtureProject(), panels: [r] };
    const c = computePanel(p, r, sizeId(p, 'M'));
    expect(c.issues.some((i) => i.message === 'yoke.*: there is no contiguous yoke panel.')).toBe(true);
  });

  it('parity "same as the first row" keeps every width change even', () => {
    const r = rectangle('top-down');
    r.rounding.parity = 'start';
    r.waypoints[0].width = dim(20.5); // bottom: 45.1 → would round to 45
    r.waypoints[1].width = dim(20); // top (first row top-down): 44
    const p = { ...fixtureProject(), panels: [r] };
    const c = computePanel(p, r, sizeId(p, 'M'));
    expect((c.counts[0] - c.counts[c.totalRows]) % 2).toBe(0);
  });
});

describe('ribbing on the generated panels', () => {
  it('lets a hem or cuff rib fix the count; the odd change is a note, not a warning', async () => {
    const { applyEdgeTreatments, defaultEdges } = await import('./edgeTreatments');
    const base = garment('closed');
    const e = defaultEdges();
    const p = applyEdgeTreatments({ ...base, edges: { ...e, hem: { ...e.hem, enabled: true } } });
    for (const s of p.sizes) {
      for (const x of p.panels.filter((x) => x.fromYoke)) {
        const c = computePanel(p, x, s.id);
        expect(c.issues.filter((i) => i.severity !== 'info')).toEqual([]);
        const rib = c.waypoints.find((w) => w.name === (x.fromYoke === 'back' || x.fromYoke === 'front' ? 'hem' : 'cuff'))!;
        expect((rib.stitches - 2) % 4).toBe(0); // 2×2 rib: 4n + 2
      }
    }
  });
});
