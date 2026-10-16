import { describe, expect, it } from 'vitest';
import { bandValues, buttonPositions, defaultCardigan, setButtonPosition } from './bands';
import { bandChecks, buttonPlan } from './buttons';
import { buildChart } from './chart';
import { applyEdgeTreatments, defaultEdges } from './edgeTreatments';
import { setOpening } from './garment';
import { joinReport, measureEdge } from './joins';
import { buildScope } from './measurements';
import type { BandAttach, CardiganOptions, Project } from './model';
import { computePanel } from './panel';
import { bodice } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

function cardigan(opts: Partial<CardiganOptions> = {}, attach: BandAttach = 'pickup', direction: 'bottom-up' | 'top-down' = 'bottom-up'): Project {
  const base = { ...fixtureProject(), panels: [bodice('back', { direction }), bodice('front', { direction })] };
  const c = { ...defaultCardigan(), attach: { button: attach, buttonhole: attach, continuous: attach === 'integrated' ? 'pickup' : attach }, ...opts } as CardiganOptions;
  return applyEdgeTreatments({ ...setOpening(base, 'cardigan'), edges: defaultEdges(), cardigan: c });
}

const front = (p: Project, side: 'left' | 'right') => p.panels.find((x) => x.half?.side === side)!;
const M = (p: Project) => sizeId(p, 'M');

describe('closing width', () => {
  it('takes 2 × band_w − band_overlap off the whole front by default', () => {
    const p = cardigan();
    const v = bandValues(p, M(p), buildScope({ ...p, garment: { ...p.garment, opening: 'closed' } }, M(p)));
    expect(v).toEqual({ band_w: 2.5, band_overlap: 2.5, closing_r: 2.5, errors: [] });
  });

  it('each front is (whole front − closing_r) / 2, and the closed fronts match the whole front', () => {
    for (const attach of ['pickup', 'integrated'] as const) {
      const p = cardigan({}, attach);
      for (const s of p.sizes) {
        const c = computePanel(p, front(p, 'left'), s.id);
        const hem = c.waypoints.find((w) => w.name === 'hem')!;
        const body = hem.stitches - hem.selvedge - c.half!.bandSts;
        const target = ((hem.wholeCm! - 2.5) / 2) * c.stitchesPerCm;
        expect(Math.abs(body - target)).toBeLessThanOrEqual(1); // rounded to the nearest stitch
        // Closed: 2 fronts + 2 bands − overlap ≈ the whole front.
        const closed = (2 * body) / c.stitchesPerCm + 2 * 2.5 - 2.5;
        expect(Math.abs(closed - hem.wholeCm!)).toBeLessThan(1);
      }
    }
  });

  it('can be overridden', () => {
    const p = cardigan({ closing: { expr: '0', overrides: {} } });
    const c = computePanel(p, front(p, 'left'), M(p));
    const whole = computePanel({ ...p, garment: { ...p.garment, opening: 'closed' }, panels: [bodice('front')] }, bodice('front'), M(p));
    expect(c.waypoints[0].stitches).toBe(whole.waypoints[0].stitches / 2 + 1);
  });

  it('adds integrated band stitches at the front edge, rounded to the band multiple, and takes them off with the neck', () => {
    const p = cardigan({}, 'integrated');
    const pick = cardigan();
    const c = computePanel(p, front(p, 'left'), M(p));
    const c0 = computePanel(pick, front(pick, 'left'), M(pick));
    expect(c.half!.bandSts).toBe(6); // 2.5 cm × 2.2 sts/cm = 5.5 → 6 (1×1 rib: 2n)
    expect(c.waypoints[0].stitches).toBe(c0.waypoints[0].stitches + 6);
    expect(c.neck!.centreSts).toBe(c0.neck!.centreSts + 6);
    expect(p.panels.some((x) => x.band)).toBe(false);
    const chart = buildChart(p, front(p, 'left'), c);
    expect(chart.stripes).toEqual([{ name: 'Band: 1x1 rib', fromCol: expect.any(Number), toCol: expect.any(Number), multiple: 2, offset: 0 }]);
    expect(chart.stripes[0].toCol - chart.stripes[0].fromCol).toBe(6);
  });
});

describe('band strips', () => {
  it('picks up along the front edge and rounds to the band multiple', () => {
    const p = cardigan();
    const band = p.panels.find((x) => x.band === 'buttonhole')!;
    const join = p.joins!.find((j) => j.partner.some((r) => r.panelId === band.id))!;
    expect(join.tag).toBe('pickup');
    expect(join.edges).toEqual([{ panelId: front(p, 'right').id, edge: { kind: 'front' } }]);
    for (const s of p.sizes) {
      const c = computePanel(p, band, s.id);
      const edge = measureEdge(p, join.edges[0], s.id, p.settings.pickUp);
      expect(edge.pickup).toBe(Math.round(edge.rows * 0.75));
      expect(c.counts[0] % 2).toBe(0); // 1×1 rib
      expect(Math.abs(c.counts[0] - edge.pickup)).toBeLessThanOrEqual(1);
      expect(c.totalRows).toBe(Math.round(2.5 * 3)); // band width × row gauge
    }
  });

  it('knits a sideways band as long as the edge, sewn on', () => {
    const p = cardigan({}, 'sideways');
    const band = p.panels.find((x) => x.band === 'button')!;
    const join = p.joins!.find((j) => j.partner.some((r) => r.panelId === band.id))!;
    expect(join.tag).toBe('seam');
    expect(front(p, 'left').id).toBe(join.edges[0].panelId); // buttons on the left front
    const r = joinReport(p, join, M(p));
    const c = computePanel(p, band, M(p));
    expect(c.counts[0]).toBe(6);
    expect(Math.abs(r.a.rows - c.totalRows)).toBeLessThanOrEqual(1);
  });

  it('makes one continuous band up the right front, around the neck and down the left', () => {
    const p = cardigan({ bands: 'continuous' });
    const bands = p.panels.filter((x) => x.band);
    expect(bands.map((b) => b.name)).toEqual(['Front band']);
    const join = p.joins!.find((j) => j.partner.some((r) => r.panelId === bands[0].id))!;
    const names = join.edges.map((r) => `${p.panels.find((x) => x.id === r.panelId)!.name}:${r.edge.kind}`);
    expect(names).toEqual(['Right front:front', 'Right front:neck', 'Back:neck', 'Left front:neck', 'Left front:front']);
  });

  it('removes the strips for a pullover and keeps strip ids when settings change', () => {
    const p = cardigan();
    const id = p.panels.find((x) => x.band === 'buttonhole')!.id;
    const again = applyEdgeTreatments({ ...p, cardigan: { ...p.cardigan!, buttonholeSide: 'right' } });
    expect(again.panels.find((x) => x.band === 'buttonhole')!.id).toBe(id);
    const closed = setOpening(p, 'closed');
    expect(closed.panels.some((x) => x.band)).toBe(false);
    expect(closed.joins!.some((j) => j.edge === 'frontBands')).toBe(false);
  });
});

describe('buttons', () => {
  it('spaces buttons evenly between top and bottom', () => {
    const p = cardigan();
    const r = buttonPositions(p, M(p), 50, buildScope(p, M(p)));
    expect(r.positions).toEqual([48.5, 40.75, 33, 25.25, 17.5, 9.75, 2]);
  });

  it('keeps dragged positions per size', () => {
    const p = cardigan();
    const s = M(p);
    const before = buttonPlan(p, s)!.positions;
    const q = setButtonPosition(p, s, before, 2, 30);
    expect(buttonPlan(q, s)!.positions[2]).toBe(30);
    expect(buttonPlan(q, s)!.manual).toBe(true);
    expect(buttonPlan(q, sizeId(q, 'L'))!.manual).toBe(false);
  });

  it('puts buttonholes in the middle row of a picked-up band, spaced along it', () => {
    const p = cardigan();
    const plan = buttonPlan(p, M(p))!;
    expect(plan.holeAttach).toBe('pickup');
    expect(new Set(plan.holes.map((h) => h.row))).toEqual(new Set([4]));
    // Even spacing: gaps differ by at most one stitch.
    expect(Math.max(...plan.spacingSts) - Math.min(...plan.spacingSts)).toBeLessThanOrEqual(1);
    const band = p.panels.find((x) => x.band === 'buttonhole')!;
    const chart = buildChart(p, band, computePanel(p, band, M(p)));
    const row4 = chart.rows.find((r) => r.knitRow === 4)!;
    expect(row4.cells.filter((x) => x === 'yo').length).toBe(7);
    expect(row4.cells.filter((x) => x === 'k2tog').length).toBe(7);
    expect(chart.buttonholeRows[4]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(chart.legend.map((l) => l.id)).toEqual(expect.arrayContaining(['yo', 'k2tog']));
  });

  it('puts buttonholes on the front rows of an integrated band', () => {
    for (const direction of ['bottom-up', 'top-down'] as const) {
      const p = cardigan({}, 'integrated', direction);
      const plan = buttonPlan(p, M(p))!;
      const c = computePanel(p, front(p, 'right'), M(p));
      expect(plan.holes.every((h) => h.panelId === front(p, 'right').id)).toBe(true);
      const rows = plan.holes.map((h) => h.row);
      // Top button nearest the neck: the smallest row top-down, the largest bottom-up.
      expect(rows[0]).toBe(direction === 'top-down' ? Math.min(...rows) : Math.max(...rows));
      const chart = buildChart(p, front(p, 'right'), c);
      expect(Object.keys(chart.buttonholeRows).length).toBe(7);
    }
  });

  it('uses a custom buttonhole symbol and width', () => {
    const p = cardigan({ buttonhole: { style: 'symbol', symbol: 'buttonhole', width: 3, note: '' } });
    const band = p.panels.find((x) => x.band === 'buttonhole')!;
    const chart = buildChart(p, band, computePanel(p, band, M(p)));
    expect(chart.rows.find((r) => r.knitRow === 4)!.cells.filter((x) => x === 'buttonhole').length).toBe(21);
  });
});

describe('band checks', () => {
  const messages = (p: Project, s: string) => bandChecks(p, s, new Map()).map((c) => c.issue.message);

  it('passes the defaults in every size', () => {
    const p = cardigan();
    for (const s of p.sizes) expect(bandChecks(p, s.id, new Map()).filter((c) => c.issue.severity !== 'info')).toEqual([]);
  });

  it('flags buttonholes too close together and outside the edge', () => {
    const p = cardigan({ buttons: { ...defaultCardigan().buttons, count: 40 } });
    expect(messages(p, M(p)).some((m) => /too close together/.test(m))).toBe(true);
    const q = cardigan({ buttons: { ...defaultCardigan().buttons, bottom: { expr: '-5', overrides: {} } } });
    expect(messages(q, M(q)).some((m) => /outside the front edge/.test(m))).toBe(true);
  });

  it('flags a band too shallow for its buttonholes', () => {
    const p = cardigan();
    const q = { ...p, edges: { ...p.edges!, frontBands: { ...p.edges!.frontBands, depth: { expr: '1', overrides: {} } } } };
    expect(messages(applyEdgeTreatments(q), M(q)).some((m) => /within 2 rows of its edge/.test(m))).toBe(true);
  });

  it('says how many to pick up when the pick-up breaks the multiple', () => {
    const p = cardigan();
    const q = applyEdgeTreatments({ ...p, edges: { ...p.edges!, frontBands: { ...p.edges!.frontBands, stitch: 'rib2x2' } } });
    const all = q.sizes.flatMap((s) => messages(q, s.id));
    expect(all.some((m) => /^Picking up \d+ sts doesn't fit 2x2 rib \(4n \+ 2\); the band rounds to \d+: pick up \d+ (more|fewer)\.$/.test(m))).toBe(true);
  });

  it('flags a closed width short of the front, and a neckband with a continuous band', () => {
    const p = cardigan({ closing: { expr: '10', overrides: {} } });
    expect(messages(p, M(p)).some((m) => /^Closed at hem, the fronts measure/.test(m))).toBe(true);
    const q = cardigan({ bands: 'continuous' });
    expect(messages(q, M(q))).toContain('A continuous front band goes around the neck, and a neckband is switched on too.');
  });
});
