import { describe, expect, it } from 'vitest';
import { defaultCardigan } from './bands';
import { buttonPlan } from './buttons';
import { defaultYoke, generateYoke } from './contiguous';
import { generateBodyAndSleeves } from './contiguousGarment';
import { addStrips, bandEdges, defaultEdges } from './edgeTreatments';
import { setConstruction, setOpening } from './garment';
import { measureEdge } from './joins';
import type { CardiganOptions, NecklineShape, Project } from './model';
import { fixtureProject, sizeId } from './testFixtures';

function contiguous(opening: 'closed' | 'cardigan', card: Partial<CardiganOptions> = {}): Project {
  let p = setOpening(setConstruction({ ...fixtureProject(), panels: [] }, 'contiguous'), opening);
  p = generateBodyAndSleeves({ ...p, edges: defaultEdges(), cardigan: { ...defaultCardigan(), ...card } });
  return addStrips(p);
}
const yokeOf = (p: Project) => p.panels.find((x) => x.yoke)!;
const name = (p: Project, id: string) => p.panels.find((x) => x.id === id)!.name;

describe('the yoke neck and front edges', () => {
  it('pullover: the neck is the cast-on, two neck slopes and the centre cast-on; no front edges', () => {
    const p = contiguous('closed');
    const M = sizeId(p, 'M');
    const yk = yokeOf(p);
    const y = generateYoke(p, yk.yoke!, M);
    const neck = measureEdge(p, { panelId: yk.id, edge: { kind: 'neck' } }, M, p.settings.pickUp);
    const slope = Math.round((y.neck.row - 1) * 0.75);
    expect(neck.stitches).toBe(y.castOn + y.neck.centre);
    expect(neck.pickup).toBe(y.castOn + y.neck.centre + 2 * slope);
    const front = measureEdge(p, { panelId: yk.id, edge: { kind: 'front', side: 'right' } }, M, p.settings.pickUp);
    expect(front.ok).toBe(false);
  });

  it('cardigan: front edges from the front-edge cast-on down to the split', () => {
    const p = contiguous('cardigan');
    const M = sizeId(p, 'M');
    const yk = yokeOf(p);
    const y = generateYoke(p, yk.yoke!, M);
    const R = y.neck.row;
    const right = measureEdge(p, { panelId: yk.id, edge: { kind: 'front', side: 'right' } }, M, p.settings.pickUp);
    const left = measureEdge(p, { panelId: yk.id, edge: { kind: 'front', side: 'left' } }, M, p.settings.pickUp);
    expect(right.rows).toBe(y.rows.length - R);
    expect(left.rows).toBe(y.rows.length - R - 1);
    const neck = measureEdge(p, { panelId: yk.id, edge: { kind: 'neck' } }, M, p.settings.pickUp);
    expect(neck.stitches).toBe(y.castOn + 2 * y.neck.frontEdgeCo);
  });
});

describe('bands, neckband and buttons on a contiguous cardigan', () => {
  it('separate bands: the front panel edge and then the yoke front edge, up to the neck', () => {
    const p = contiguous('cardigan');
    const edges = bandEdges(p, 'buttonhole').map((r) => `${name(p, r.panelId)}:${r.edge.kind}${r.edge.kind === 'front' && r.edge.side ? `:${r.edge.side}` : ''}`);
    expect(edges).toEqual(['Right front:front', 'Yoke:front:right']);
  });

  it('continuous band: up the right front, around the yoke neck, down the left front', () => {
    const p = contiguous('cardigan', { bands: 'continuous' });
    const edges = bandEdges(p, 'continuous').map((r) => `${name(p, r.panelId)}:${r.edge.kind}${r.edge.kind === 'front' && r.edge.side ? `:${r.edge.side}` : ''}`);
    expect(edges).toEqual(['Right front:front', 'Yoke:front:right', 'Yoke:neck', 'Yoke:front:left', 'Left front:front']);
  });

  it('the neckband is picked up around the yoke neck', () => {
    const p = contiguous('closed');
    const j = p.joins!.find((x) => x.edge === 'neckband')!;
    expect(j.edges.map((r) => `${name(p, r.panelId)}:${r.edge.kind}`)).toEqual(['Yoke:neck']);
  });

  it('spaces the buttons over the whole front edge, yoke included', () => {
    const p = contiguous('cardigan');
    const M = sizeId(p, 'M');
    const plan = buttonPlan(p, M)!;
    const yk = yokeOf(p);
    const yokeEdge = measureEdge(p, { panelId: yk.id, edge: { kind: 'front', side: 'right' } }, M, p.settings.pickUp).lengthCm;
    expect(plan.frontEdgeCm).toBeCloseTo(plan.bodyEdgeCm + yokeEdge);
    expect(plan.positions[0]).toBeCloseTo(plan.frontEdgeCm - 1.5);
    expect(plan.positions.filter((h) => h > plan.bodyEdgeCm).length).toBeGreaterThan(0);
    // All buttonholes land on the buttonhole band.
    const band = p.panels.find((x) => x.band === 'buttonhole')!;
    expect(plan.holes.every((h) => h.panelId === band.id)).toBe(true);
  });
});

describe('neck shapes on a contiguous yoke', () => {
  const p = fixtureProject();
  const M = sizeId(p, 'M');
  const bn = Math.round(15 * 2.2);
  const neck = (shape: NecklineShape) => generateYoke(p, { ...defaultYoke(shape) }, M).neck;

  it('round: half the increases every row next to the centre, cast on the centre', () => {
    const n = neck('round');
    expect(n.centre + 2 * n.perSide).toBe(bn);
    expect(n.row % 2).toBe(1);
  });

  it('V: no centre cast-on (or one stitch), deeper', () => {
    const v = neck('v');
    expect(v.centre).toBe(bn % 2);
    expect(v.row).toBeGreaterThan(neck('round').row);
  });

  it('square: all centre, no increases; boat: wider and shallow, mostly centre', () => {
    expect(neck('square')).toMatchObject({ perSide: 0, centre: bn });
    const b = neck('boat');
    expect(b.backNeck).toBeGreaterThan(bn);
    expect(b.centre + 2 * b.perSide).toBe(b.backNeck);
    expect(b.perSide).toBeLessThanOrEqual(Math.ceil(b.backNeck * 0.1));
    expect(b.row).toBeLessThan(neck('round').row);
  });

  it('a boat neck is cast on wider than the back neck; older yokes without a width keep the back neck', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    const round = generateYoke(p, defaultYoke('round'), M);
    const boat = generateYoke(p, defaultYoke('boat'), M);
    const spc = boat.stitchesPerCm;
    expect(boat.castOnZones.back).toBe(Math.round((round.params.neckWidth.value + 6) * spc));
    expect(boat.castOnZones.back - round.castOnZones.back).toBeGreaterThanOrEqual(Math.round(6 * spc) - 1);
    // Shorter shoulders: the back still reaches the same width after them.
    expect(boat.counts.A).toBeLessThan(round.counts.A);
    const legacy = defaultYoke('boat');
    delete legacy.neck.width;
    expect(generateYoke(p, legacy, M).castOnZones.back).toBe(round.castOnZones.back);
  });
});
