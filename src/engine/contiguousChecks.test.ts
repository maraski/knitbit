import { describe, expect, it } from 'vitest';
import { projectChecks } from './checks';
import { SLOPED_SHOULDER } from './contiguous';
import { contiguousChecks } from './contiguousChecks';
import { generateBodyAndSleeves } from './contiguousGarment';
import { setConstruction } from './garment';
import { dim, type Project, type YokeSpec } from './model';
import { fixtureProject, sizeId } from './testFixtures';

function garment(edit: (y: YokeSpec) => void = () => {}): Project {
  const p = generateBodyAndSleeves(setConstruction({ ...fixtureProject(), panels: [] }, 'contiguous'));
  return { ...p, panels: p.panels.map((x) => (x.yoke ? { ...x, yoke: (() => { const y = structuredClone(x.yoke!); edit(y); return y; })() } : x)) };
}
const msgs = (p: Project, size: string) => contiguousChecks(p, sizeId(p, size), new Map()).map((c) => `${c.issue.severity}: ${c.issue.message}`);

describe('contiguous checks', () => {
  it('compares the back and fronts at the end of the shoulders with cross back and cross front, as info', () => {
    const m = msgs(garment(), 'M');
    expect(m).toContain('info: End of the shoulders (row 27): the back is 43.2 cm, 3.2 cm wider than the cross back (40.0 cm).');
    expect(m.some((x) => /^info: End of the shoulders: the fronts \(with the neck between them\) are 40\.5 cm, 2\.7 cm wider than the cross front \(37\.8 cm\)\.$/.test(x))).toBe(true);
  });

  it('warns when the sleeve at the underarm is less than bicep + ease', () => {
    const p = garment((y) => {
      y.sleeveWidth = dim('bicep');
      y.cap.solve = false;
    });
    expect(msgs(p, 'M').some((x) => /^warning: The sleeve at the underarm is [\d.]+ cm \(\d+ \+ \d+ sts\), [\d.]+ cm less than bicep \+ ease \(44\.5 cm\): it may be tight\.$/.test(x))).toBe(true);
  });

  it('compares the armhole with the scye circumference', () => {
    expect(msgs(garment(), '4XS').some((x) => /^warning: Around the armhole .* less than the scye circumference \(35\.3 cm\)/.test(x))).toBe(true);
    expect(msgs(garment(), '4X').some((x) => /^info: Around the armhole is [\d.]+ cm, [\d.]+ cm more than the scye circumference .*: a deep armhole\.$/.test(x))).toBe(true);
    expect(msgs(garment(), 'M').some((x) => /armhole/.test(x))).toBe(false);
  });

  it('hints that the cap may look pointy when the seam is long and the rapid phase short', () => {
    const p = garment((y) => {
      y.shoulder = { ...y.shoulder, mode: 'length', length: dim(SLOPED_SHOULDER) };
      y.cap = { ...y.cap, rapidRows: dim(4), solve: false };
      y.depth = { ...y.depth, deepen: false };
    });
    expect(msgs(p, 'M').some((x) => /^info: Hint: the cap may look pointy: the shoulder seam is \d+ rows but the rapid cap only 4\./.test(x))).toBe(true);
    expect(msgs(garment(), 'M').some((x) => /pointy/.test(x))).toBe(false);
  });

  it('warns when an edited body or sleeve no longer starts with the held stitches plus the cast-on', () => {
    const p = garment();
    const edited = { ...p, panels: p.panels.map((x) => (x.fromYoke === 'leftSleeve' ? { ...x, waypoints: x.waypoints.map((w) => (w.name === 'underarm' ? { ...w, width: dim('yoke.sleeve_w + 2') } : w)) } : x)) };
    expect(msgs(edited, 'M').some((x) => /^warning: Left sleeve starts with \d+ sts, but the yoke holds 86 \+ 12 cast on = 98\.$/.test(x))).toBe(true);
    expect(msgs(p, 'M').some((x) => /starts with/.test(x))).toBe(false);
    const body = { ...p, panels: p.panels.map((x) => (x.fromYoke === 'back' ? { ...x, waypoints: x.waypoints.map((w) => (w.name === 'underarm' ? { ...w, width: dim(50) } : w)) } : x)) };
    expect(msgs(body, 'M').some((x) => /^warning: The body starts with \d+ sts \(Back \d+, Front \d+\), but the yoke holds 240 \+ 2 × 12 cast on = 264\.$/.test(x))).toBe(true);
  });

  it('reports the generator problems (rows that do not fit, counts) through the yoke panel', () => {
    const p = garment((y) => {
      y.neck = { ...y.neck, shape: 'v', depth: dim(40) };
    });
    const all = projectChecks(p).filter((c) => c.sizeName === 'M').map((c) => c.issue.message);
    expect(all.some((x) => /front neck closes on row \d+, below the underarm split/.test(x))).toBe(true);
  });

  it('has no warnings for the defaults in M', () => {
    expect(msgs(garment(), 'M').filter((x) => x.startsWith('warning'))).toEqual([]);
  });
});
