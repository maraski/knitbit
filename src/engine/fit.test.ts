import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fitAliases, missingAliasHint } from './fit';
import { resolveMeasurements } from './measurements';
import { newMeasurement, type Panel, type Project } from './model';
import { computePanel } from './panel';
import { loadProject } from './schema';
import { ensureEstimates } from './seed';
import { bodice, sleeve, TEMPLATE_MEASUREMENTS } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

const wpExpr = (p: Panel, name: string, part: 'height' | 'width') => p.waypoints.find((w) => w.name === name)![part].expr;
const at = (p: Project, panel: Panel, size: string) => Object.fromEntries(computePanel(p, panel, sizeId(p, size)).waypoints.map((w) => [w.name, w]));

describe('fit choices', () => {
  it('derive names from the chosen columns, and follow changes', () => {
    const p = fixtureProject();
    const v = (q: Project) => resolveMeasurements(q, sizeId(q, 'M')).values;
    expect(fitAliases(p)).toMatchObject({ bust: 'bust_cd_cup', hem_circ: 'high_hip', hem_drop: 'waist_to_high_hip', shoulder_w: 'back_shoulder_width', cross_back_w: 'cross_back' });
    const curvy = { ...p, fit: { ...p.fit, cup: 'gh' as const, hem: 'hip_seat_curvy' as const, broadBack: true } };
    expect(v(curvy).bust.value).toBe(127);
    expect(v(curvy).apex_to_apex.value).toBe(25.5);
    expect(v(curvy).hem_circ.value).toBe(129.5);
    expect(v(curvy).hem_drop.value).toBe(21);
    expect(v(curvy).shoulder_w.value).toBe(47);
    expect(v(curvy).cross_back_w.value).toBe(43.75);
  });

  it('a measurement of the same name wins over the choice', () => {
    const p = fixtureProject();
    const M = sizeId(p, 'M');
    p.measurements.push({ ...newMeasurement('hem_circ'), table: { [M]: 130 } });
    expect(fitAliases(p).hem_circ).toBeUndefined();
    expect(resolveMeasurements(p, M).values.hem_circ.value).toBe(130);
  });

  it('explain a derived name whose column is missing', () => {
    const p = fixtureProject();
    p.measurements = p.measurements.filter((m) => m.name !== 'high_hip');
    expect(missingAliasHint(p, 'hem_circ')).toMatch(/hem_circ follows high_hip \(hem at high hip\)/);
    expect(missingAliasHint(p, 'bust')).toBeNull();
    p.panels = [bodice('back')];
    const c = computePanel(p, p.panels[0], sizeId(p, 'M'));
    expect(c.issues.some((i) => /Unknown name "hem_circ": hem_circ follows high_hip/.test(i.message))).toBe(true);
  });
});

describe('template bindings (new sizing table)', () => {
  it('use the new measurements', () => {
    const back = bodice('back');
    const front = bodice('front');
    expect(wpExpr(back, 'hem', 'width')).toBe('hem_circ / 2 + ease / 2');
    expect(wpExpr(back, 'waist', 'height')).toBe('hem_drop');
    expect(wpExpr(back, 'underarm', 'height')).toBe('waist.height + waist_to_underarm');
    expect(wpExpr(back, 'underarm', 'width')).toBe('upper_chest / 2 + ease / 2');
    expect(wpExpr(front, 'underarm', 'width')).toBe('upper_chest / 2 + ease / 2 + bust_side_w');
    expect(wpExpr(back, 'armhole_end', 'width')).toBe('cross_back_w + 1');
    expect(wpExpr(front, 'armhole_end', 'width')).toBe('cross_front + 1');
    expect(wpExpr(back, 'shoulder', 'width')).toBe('shoulder_w');
    expect(wpExpr(back, 'neck_side', 'height')).toBe('shoulder.height + shoulder_drop');
    expect(wpExpr(back, 'neck_side', 'width')).toBe('back_neck_width');
    expect(back.neckline!.depth.expr).toBe('back_neck_drop');
    expect(front.neckline!.depth.expr).toBe('front_neck_drop');
    expect(front.bust!.apexHeight.expr).toBe('shoulder.height + shoulder_drop - hps_to_apex');
    expect(front.bust!.apexOffset.expr).toBe('apex_to_apex / 2');
    const sl = sleeve('set-in');
    expect(wpExpr(sl, 'cuff', 'width')).toBe('wrist + ease.wrist');
    expect(wpExpr(sl, 'underarm', 'height')).toBe('arm_length');
    expect(wpExpr(sl, 'underarm', 'width')).toBe('bicep + ease.bicep');
  });

  it('put the waist at hem_drop and the underarm waist_to_underarm above it; HPS → waist = back_neck_drop + back_waist_length', () => {
    const p = fixtureProject();
    const back = bodice('back');
    p.panels = [back];
    const w = at(p, back, 'M');
    expect(w.waist.heightCm).toBe(11.5);
    expect(w.underarm.heightCm).toBeCloseTo(31, 6); // 11.5 + 19.5
    expect(w.neck_side.heightCm - w.waist.heightCm).toBeCloseTo(2.75 + 42, 6);
  });

  it('flare from the cross back to the shoulder width, or go straight up', () => {
    const p = fixtureProject();
    const back = bodice('back');
    const front = bodice('front');
    const straight = bodice('back', { shoulderFlare: false });
    p.panels = [back, front, straight];
    const b = at(p, back, 'M');
    const f = at(p, front, 'M');
    const s = at(p, straight, 'M');
    expect(b.armhole_end.widthCm).toBe(41);
    expect(b.shoulder.widthCm).toBe(43.25);
    expect(f.armhole_end.widthCm).toBe(38.75);
    expect(f.shoulder.stitches).toBe(b.shoulder.stitches); // shoulder seams match
    expect(b.shoulder.stitches).toBeGreaterThan(b.armhole_end.stitches); // increases above the armhole
    expect(s.shoulder.widthCm).toBe(41);
    expect(straight.segments.find((x) => x.fromWaypoint === straight.waypoints.find((w) => w.name === 'armhole_end')!.id)!.left.kind).toBe('straight');
  });

  it('compute without warnings in every size, both directions, flare on and off', () => {
    const p = fixtureProject();
    for (const direction of ['bottom-up', 'top-down'] as const) {
      for (const shoulderFlare of [true, false]) {
        const panels = [bodice('back', { direction, shoulderFlare }), bodice('front', { direction, shoulderFlare }), sleeve('set-in', direction)];
        p.panels = panels;
        for (const s of p.sizes) {
          for (const panel of panels) {
            const bad = computePanel(p, panel, s.id).issues.filter((i) => i.severity !== 'info');
            expect(bad.map((i) => i.message), `${direction} flare=${shoulderFlare} ${panel.name} ${s.name}`).toEqual([]);
          }
        }
      }
    }
  });

  it('a template added to a migrated old project gets waist_to_underarm and explains the missing hem column', () => {
    const r = loadProject(readFileSync(fileURLToPath(new URL('./fixtures/project_v1.json', import.meta.url)), 'utf8'));
    if (!r.ok) throw new Error(r.errors.join('\n'));
    const { project, added } = ensureEstimates(r.project, TEMPLATE_MEASUREMENTS.back);
    expect(added).toContain('waist_to_underarm');
    const back = bodice('back');
    project.panels.push(back);
    const c = computePanel(project, back, sizeId(project, 'M'));
    expect(c.issues.find((i) => i.severity === 'error')?.message).toMatch(/hem_circ follows high_hip .* import or merge the sizing table/);
  });
});
