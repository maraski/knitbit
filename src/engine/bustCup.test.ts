import { describe, expect, it } from 'vitest';
import { bustValues } from './bust';
import { customCupNames } from './fit';
import { buildScope, resolveMeasurements } from './measurements';
import { dim, newMeasurement, type BustMethod, type CupChoice, type Panel, type Project } from './model';
import { computePanel } from './panel';
import { bodice } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

function setup(cup: CupChoice = 'cd', mod?: (f: Panel) => void, method: BustMethod = 'shortrows') {
  const p = fixtureProject();
  p.fit.cup = cup;
  const front = bodice('front');
  front.bust!.method = method;
  mod?.(front);
  p.panels = [front, bodice('back')];
  return { p, front, M: sizeId(p, 'M') };
}
const bust = (p: Project, f: Panel, size: string) => computePanel(p, f, sizeId(p, size)).bust!;
const under = (p: Project, panel: Panel, M: string) => computePanel(p, panel, M).waypoints.find((w) => w.name === 'underarm')!.widthCm;

describe('bust difference by cup', () => {
  it('D = the cup’s bust − upper_chest; W = D; L = the cup’s dart height (size M)', () => {
    const expected = { ab: [5, 2], cd: [7.5, 3.75], ef: [10, 5.5], gh: [12.5, 7.5] } as const;
    for (const [cup, [D, dart]] of Object.entries(expected)) {
      const { p, front } = setup(cup as CupChoice);
      const b = bust(p, front, 'M');
      expect(b.D, cup).toBe(D);
      expect(b.width.value, cup).toBe(D);
      expect(b.length.value, cup).toBe(dart);
      expect(b.length.expr).toBe('dart_height');
    }
  });

  it('every size: D follows the table for the chosen cup', () => {
    const { p, front } = setup('ef');
    for (const s of p.sizes) {
      const v = resolveMeasurements(p, s.id).values;
      expect(computePanel(p, front, s.id).bust!.D, s.name).toBeCloseTo(v.bust_ef_cup.value - v.upper_chest.value, 9);
    }
  });

  it('without extra width at the front: W = 0, nothing added at the side seams, and a longer L from its own formula', () => {
    const { p, front, M } = setup('cd', (f) => (f.bust!.frontWidth = false));
    const b = bust(p, front, 'M');
    expect(b.noFrontWidth).toBe(true);
    expect(b.width.value).toBe(0);
    expect(b.length).toMatchObject({ expr: 'dart_height + (bust - upper_chest) * 0.25', plugged: '3.75 + (122 - 114.5) * 0.25', value: 5.625 });
    expect(bustValues(front, M, buildScope(p, M))).toMatchObject({ bust_w: 0, bust_side_w: 0, bust_l: 5.625 });
    expect(under(p, front, M)).toBeCloseTo(under(p, p.panels[1], M), 6);
    // The formula is editable, with per-size values.
    front.bust!.lengthNoWidth = dim('dart_height * 1.5', { [M]: 6 });
    expect(bust(p, front, 'M').length).toMatchObject({ value: 6, overridden: true });
    expect(bust(p, front, 'L').length.value).toBeCloseTo(3.75 * 1.5, 9);
  });

  it('vertical darts always add width (the toggle only applies to short rows and horizontal darts)', () => {
    const { p, front } = setup('cd', (f) => (f.bust!.frontWidth = false), 'vertical-dart');
    expect(bust(p, front, 'M').width.value).toBe(7.5);
  });

  it('a custom bust: D from bust_custom, dart height and apex width from the nearest cup per size', () => {
    const { p, front, M } = setup('custom');
    p.measurements.push({ ...newMeasurement('bust_custom', 'Bust (custom)', 'circumference'), rule: { type: 'expression', expr: 'bust_cd_cup' }, manual: { [M]: 126 } });
    const v = resolveMeasurements(p, M).values;
    expect(v.bust.value).toBe(126);
    expect(customCupNames(p, buildScope(p, M))?.cup).toBe('gh'); // D 11.5: closer to 12.5 than to 10
    expect(v.dart_height.value).toBe(7.5);
    expect(v.apex_to_apex.value).toBe(25.5);
    const L = resolveMeasurements(p, sizeId(p, 'L')).values; // follows bust_cd_cup: C/D
    expect(L.dart_height.value).toBe(3.75);
    expect(bust(p, front, 'M').D).toBe(11.5);
  });
});

describe('bust point', () => {
  it('sits apex_to_apex / 2 from centre front, using the cup’s apex column (A/B → b … G/H → h)', () => {
    for (const [cup, col] of [['ab', 23], ['cd', 23.5], ['ef', 24.5], ['gh', 25.5]] as const) {
      const { p, front } = setup(cup);
      expect(bust(p, front, 'M').apex.offsetCm, cup).toBe(col / 2);
    }
  });

  it('drops hps_to_apex below the HPS level, less an editable vertical correction (starting estimate 5 %)', () => {
    const { p, front, M } = setup();
    const c = computePanel(p, front, M);
    const hps = c.waypoints.find((w) => w.name === 'neck_side')!.heightCm; // the HPS level
    expect(c.bust!.apex.heightCm).toBeCloseTo(hps - 31.5 * 0.95, 6);
    front.bust!.apexCorrection = dim(0);
    expect(bust(p, front, 'M').apex.heightCm).toBeCloseTo(hps - 31.5, 6);
    front.bust!.apexCorrection = dim('hps_to_apex * 0.05', { [M]: 3 });
    expect(bust(p, front, 'M').apex.heightCm).toBeCloseTo(hps - 28.5, 6);
  });

  it('older bust setups without a correction still work (correction 0)', () => {
    const { p, front } = setup('cd', (f) => {
      delete f.bust!.apexCorrection;
      f.bust!.apexHeight = dim('shoulder.height + shoulder_drop - hps_to_apex');
    });
    expect(bust(p, front, 'M').issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('every method, cup and size', () => {
  it('computes without errors, front width on and off, both directions', () => {
    for (const cup of ['ab', 'cd', 'ef', 'gh'] as const) {
      for (const method of ['shortrows', 'horizontal-dart', 'vertical-dart'] as const) {
        for (const frontWidth of [true, false]) {
          for (const direction of ['bottom-up', 'top-down'] as const) {
            const p = fixtureProject();
            p.fit.cup = cup;
            const f = bodice('front', { direction });
            f.bust!.method = method;
            f.bust!.frontWidth = frontWidth;
            for (const s of p.sizes) {
              const errs = computePanel(p, f, s.id).issues.filter((i) => i.severity === 'error').map((i) => i.message);
              expect(errs, `${cup} ${method} width=${frontWidth} ${direction} ${s.name}`).toEqual([]);
            }
          }
        }
      }
    }
  });
});
