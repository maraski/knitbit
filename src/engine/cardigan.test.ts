import { describe, expect, it } from 'vitest';
import { linkFronts, syncFrontPairs, unlinkFronts } from './cardigan';
import { buildChart } from './chart';
import { addStrips, applyEdgeTreatments, defaultEdges } from './edgeTreatments';
import { setOpening } from './garment';
import { measureEdge } from './joins';
import type { Panel, Project } from './model';
import { computePanel } from './panel';
import { bodice, sleeve, topDownTop } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

function withPanels(panels: Panel[], joins: Project['joins'] = []): Project {
  return { ...fixtureProject(), panels, joins };
}

function cardigan(p: Project, notes: string[] = []): Project {
  return setOpening(p, 'cardigan', notes);
}

const fronts = (p: Project) => ({ left: p.panels.find((x) => x.half?.side === 'left')!, right: p.panels.find((x) => x.half?.side === 'right')! });

describe('splitting a front into a cardigan pair', () => {
  it('makes a linked, flat Left front / Right front pair and reports it', () => {
    const notes: string[] = [];
    const front = { ...bodice('front'), joinAt: 'x' };
    const p = cardigan(withPanels([bodice('back', { joinInRound: true }), front]), notes);
    const { left, right } = fronts(p);
    expect(p.panels.map((x) => x.name)).toEqual(['Back', 'Right front', 'Left front']);
    expect(left.id).toBe(front.id);
    expect(left.half).toEqual({ side: 'left', pair: right.id, cfSelvedge: 1 });
    expect(right.half).toEqual({ side: 'right', pair: left.id, cfSelvedge: 1 });
    expect([left.joinAt, right.joinAt, p.panels[0].joinAt]).toEqual([null, null, null]);
    expect(notes).toEqual([
      'Front split into Left front and Right front (a mirrored pair: edit either, the other follows).',
      'Front was worked in the round; the fronts are flat.',
      'Back is worked flat (cardigan).',
    ]);
  });

  it('moves joins to the front that carries the edge', () => {
    const set = topDownTop();
    const p = cardigan(withPanels(set.panels, set.joins));
    const { left, right } = fronts(p);
    const [pickup, underarm] = p.joins!;
    expect(pickup.edges.map((e) => e.panelId)).toEqual([left.id, right.id]);
    // The front's left side is the right front's side edge, its right side the left front's.
    expect(underarm.edges.map((e) => [e.panelId === left.id ? 'L' : 'R', e.edge.kind === 'side' && e.edge.side])).toEqual([
      ['R', 'left'],
      ['L', 'right'],
    ]);
  });

  it('merges back into one front with the original joins', () => {
    const set = topDownTop();
    const start = withPanels(set.panels, set.joins);
    const back = setOpening(cardigan(start), 'closed');
    expect(back.panels.map((x) => x.name)).toEqual(['Back', 'Front']);
    expect(back.panels[1].half).toBeNull();
    expect(back.joins!.map((j) => j.edges)).toEqual(start.joins!.map((j) => j.edges));
  });
});

describe('computing cardigan fronts', () => {
  for (const direction of ['bottom-up', 'top-down'] as const) {
    it(`each front is half the whole front plus its front-edge selvedge, mirrored, in every size (${direction})`, () => {
      const p = cardigan(withPanels([bodice('front', { direction })]));
      const { left, right } = fronts(p);
      for (const s of p.sizes) {
        const l = computePanel(p, left, s.id);
        const r = computePanel(p, right, s.id);
        expect(l.ok && r.ok).toBe(true);
        expect(l.issues.filter((i) => i.severity !== 'info')).toEqual([]);
        // Mirrored: the same counts at every waypoint (bind-offs at the start of a row fall one row apart).
        expect(l.waypoints.map((w) => w.stitches)).toEqual(r.waypoints.map((w) => w.stitches));
        expect([l.counts[0], l.counts[l.totalRows]]).toEqual([r.counts[0], r.counts[r.totalRows]]);
        // Straight front edge.
        expect(new Set(l.leftEdge)).toEqual(new Set([-1]));
        expect(new Set(r.rightEdge)).toEqual(new Set([1]));
        for (const w of l.waypoints) expect(w.actualStitches).toBe(w.stitches);
      }
    });
  }

  it('takes the neck centre at the front edge and measures one slope', () => {
    const base = withPanels([bodice('front')]);
    const p = cardigan(base);
    const s = sizeId(p, 'M');
    const whole = computePanel(base, base.panels[0], s);
    const l = computePanel(p, fronts(p).left, s);
    expect(l.neck!.oneSide).toBe(true);
    expect(l.neck!.perSide).toBe(whole.neck!.perSide);
    expect(l.neck!.centreSts).toBe(whole.neck!.centreSts / 2 + 1); // half the centre plus the front-edge selvedge
    expect(l.neck!.summary).toMatch(/^bind off 8 sts at the front edge on row \d+, then −11 at the neck edge$/);
    const neck = measureEdge(p, { panelId: l.panelId, edge: { kind: 'neck' } }, s, p.settings.pickUp);
    const wholeNeck = measureEdge(base, { panelId: whole.panelId, edge: { kind: 'neck' } }, s, base.settings.pickUp);
    expect(neck.pickup).toBe(l.neck!.centreSts + (wholeNeck.pickup - whole.neck!.centreSts) / 2);
  });

  it('casts the neck stitches on at the front edge when top-down', () => {
    const p = cardigan(withPanels([bodice('front', { direction: 'top-down' })]));
    const l = computePanel(p, fronts(p).left, sizeId(p, 'M'));
    expect(l.neck!.summary).toMatch(/^\+11 at the neck edge, then cast on 8 sts at the front edge on row \d+$/);
    expect(l.roundRows).toBeNull();
  });

  it('works bust short rows on one side, turning at the side edge', () => {
    const p = cardigan(withPanels([bodice('front')]));
    const { left, right } = fronts(p);
    const s = sizeId(p, 'M');
    for (const [panel, turnsAt] of [[left, 'right'], [right, 'left']] as const) {
      const c = computePanel(p, panel, s);
      expect(c.bust!.shortRows!.oneSide).toBe(turnsAt);
      const chart = buildChart(p, panel, c);
      const sr = chart.rows.filter((r) => r.shortRow);
      expect(sr.length).toBe(c.bust!.shortRows!.pairs.length * 2);
      // One turn per pair, on the row worked towards the side edge.
      for (let i = 0; i < sr.length; i += 2) {
        expect(sr[i].label).toBe(`SR${i + 1}`);
        expect(sr[i].cells.filter((x) => x.startsWith('turn')).length).toBe(1);
        expect(sr[i + 1].cells.filter((x) => x.startsWith('turn')).length).toBe(0);
        expect(sr[i].rs).toBe(turnsAt === 'left');
      }
    }
  });

  it('rounds a hem rib to its multiple on each front', () => {
    const p = applyEdgeTreatments(cardigan(withPanels([bodice('front')])), []);
    const withHem = applyEdgeTreatments({ ...p, edges: { ...defaultEdges(), hem: { ...defaultEdges().hem, enabled: true } } });
    const { left, right } = fronts(withHem);
    for (const s of withHem.sizes) {
      for (const panel of [left, right]) {
        const c = computePanel(withHem, panel, s.id);
        const hem = c.waypoints.find((w) => w.name === 'hem')!;
        expect((hem.stitches - hem.selvedge) % 4).toBe(2); // 2×2 rib: multiple of 4 + 2, plus both selvedges
      }
    }
  });

  it('measures the armhole on the side edge of either front', () => {
    const p = cardigan(withPanels([bodice('back'), bodice('front'), sleeve('set-in')]));
    const c = computePanel(p, p.panels.find((x) => x.template === 'sleeve-set-in')!, sizeId(p, 'M'));
    expect(c.issues.find((i) => i.message.startsWith('armhole_len'))!.message).toMatch(/from (Left|Right) front \+ Back armholes/);
  });
});

describe('linked fronts', () => {
  const start = () => cardigan(withPanels([bodice('front')]));
  const editWaist = (p: Project, id: string, expr: string): Project => ({
    ...p,
    panels: p.panels.map((x) => (x.id === id ? { ...x, waypoints: x.waypoints.map((w) => (w.name === 'waist' ? { ...w, width: { ...w.width, expr } } : w)) } : x)),
  });
  const waist = (p: Project, id: string) => p.panels.find((x) => x.id === id)!.waypoints.find((w) => w.name === 'waist')!.width.expr;

  it('copies an edit to either front onto the other', () => {
    const p = start();
    const { left, right } = fronts(p);
    const a = syncFrontPairs(p, editWaist(p, left.id, '40'));
    expect(waist(a, right.id)).toBe('40');
    const b = syncFrontPairs(a, editWaist(a, right.id, '42'));
    expect(waist(b, left.id)).toBe('42');
    expect(b.panels.find((x) => x.id === right.id)!.name).toBe('Right front');
  });

  it('keeps own names, layout and side', () => {
    const p = start();
    const { left, right } = fronts(p);
    const moved = { ...p, panels: p.panels.map((x) => (x.id === left.id ? { ...x, name: 'L', layout: { x: 5, y: 0, rotation: 0 as const } } : x)) };
    expect(syncFrontPairs(p, moved)).toBe(moved);
    expect(fronts(moved).right.half!.side).toBe('right');
    void right;
  });

  it('stops following once unlinked, and relinks by copying', () => {
    const s0 = start();
    const p = unlinkFronts(s0, fronts(s0).left.id);
    const { left, right } = fronts(p);
    expect(left.half!.pair).toBeNull();
    const a = syncFrontPairs(p, editWaist(p, left.id, '40'));
    expect(waist(a, right.id)).not.toBe('40');
    const linked = linkFronts(a, left.id, right.id);
    expect(waist(linked, right.id)).toBe('40');
    expect(fronts(linked).right.half!.pair).toBe(left.id);
  });
});

describe('edge treatments', () => {
  it('adds hem sections to body panels, a cuff to sleeves, and a neckband strip with its pick-up', () => {
    const p0 = withPanels([bodice('back'), bodice('front'), sleeve('set-in')]);
    const p = addStrips({ ...p0, edges: { ...defaultEdges(), hem: { ...defaultEdges().hem, enabled: true } } });
    expect(p.panels[0].sections.map((s) => [s.name, s.edge, s.pattern.multiple])).toEqual([['Hem rib', 'hem', 4]]);
    expect(p.panels[2].sections.map((s) => [s.name, s.edge])).toEqual([['Cuff rib', 'cuff']]);
    const strip = p.panels.find((x) => x.edge === 'neckband')!;
    expect(strip.name).toBe('Neckband');
    const join = p.joins!.find((j) => j.edge === 'neckband')!;
    expect(join.edges.map((e) => e.panelId)).toEqual([p.panels[0].id, p.panels[1].id]);
    expect(join.partner).toEqual([{ panelId: strip.id, edge: { kind: 'bottom' } }]);
  });

  it('is idempotent and follows changed settings', () => {
    const p0 = withPanels([bodice('back'), sleeve('set-in')]);
    const once = applyEdgeTreatments(p0);
    const twice = applyEdgeTreatments(once);
    expect(twice.panels.length).toBe(once.panels.length);
    expect(twice.joins!.length).toBe(once.joins!.length);
    const e = defaultEdges();
    const later = applyEdgeTreatments({ ...twice, edges: { ...e, cuff: { ...e.cuff, method: 'later', stitch: 'garter' }, neckband: { ...e.neckband, enabled: false } } });
    expect(later.panels.find((x) => x.template === 'sleeve-set-in')!.sections).toEqual([]);
    expect(later.joins!.map((j) => j.name)).toEqual(['Cuff rib (added later)']);
    expect(later.joins![0].note).toBe('Garter, 5 cm, worked after the panels.');
    expect(later.panels.some((x) => x.edge === 'neckband')).toBe(false);
  });

  it('uses a custom multiple', () => {
    const e = defaultEdges();
    const p = applyEdgeTreatments({ ...withPanels([sleeve('set-in')]), edges: { ...e, cuff: { ...e.cuff, stitch: 'custom', custom: { name: 'custom', multiple: 6, offset: 3 } } } });
    expect(p.panels[0].sections[0].pattern).toEqual({ name: 'custom', multiple: 6, offset: 3 });
  });
});
