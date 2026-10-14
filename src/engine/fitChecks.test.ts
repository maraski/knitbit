import { describe, expect, it } from 'vitest';
import { projectChecks } from './checks';
import { addCustomSize, setRegionSize } from './grading';
import type { Project } from './model';
import { bodice, neckband, sleeve } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

function garment(): Project {
  const p = fixtureProject();
  p.panels = [bodice('back'), bodice('front'), sleeve('set-in'), neckband()];
  return p;
}
const lowerFrom = (p: Project, size: string, lower: string) => setRegionSize({ ...p, settings: { ...p.settings, regionSizing: true } }, sizeId(p, size), 'lower', sizeId(p, lower));
const messages = (p: Project, size: string, re: RegExp) =>
  projectChecks(p)
    .filter((c) => c.sizeId === sizeId(p, size) && re.test(c.issue.message))
    .map((c) => c.issue);

describe('checks from the sizing data', () => {
  it('the shipped garment is clean in every size (hem check off by default)', () => {
    const p = garment();
    const bad = projectChecks(p).filter((c) => c.issue.severity !== 'info');
    expect(bad.map((c) => `${c.panelName} ${c.sizeName}: ${c.issue.message}`)).toEqual([]);
  });

  it('flags a lower body more than 2 sizes from the upper body; the limit is editable; off without region sizing', () => {
    expect(messages(lowerFrom(garment(), 'M', '1X'), 'M', /sizes from upper body/)).toEqual([]); // 2 apart
    const far = lowerFrom(garment(), 'M', '2X');
    const [w] = messages(far, 'M', /sizes from upper body/);
    expect(w).toMatchObject({ severity: 'warning', message: 'Lower body 2X is 3 sizes from upper body M (limit 2): check the shaping between the waist and the underarm.' });
    expect(messages(lowerFrom(garment(), 'M', '2XS'), 'M', /sizes from upper body/)).toHaveLength(1); // smaller counts too
    far.settings.regionGapLimit = 3;
    expect(messages(far, 'M', /sizes from upper body/)).toEqual([]);
    far.settings.regionSizing = false;
    far.settings.regionGapLimit = 0;
    expect(messages(far, 'M', /sizes from upper body/)).toEqual([]);
  });

  it('a custom size counts as the row it was seeded from', () => {
    const p = garment();
    const { project, size } = addCustomSize(p, 'me', sizeId(p, 'M'));
    const q = setRegionSize({ ...project, settings: { ...project.settings, regionSizing: true } }, size.id, 'lower', sizeId(project, '3X'));
    expect(messages(q, 'me', /Lower body 3X is 4 sizes from upper body me/)).toHaveLength(1);
  });

  it('shaping that needs more stitches than the rows allow, where regions meet, says which sizes meet there', () => {
    let p = lowerFrom(garment(), 'M', '4X');
    const M = sizeId(p, 'M');
    p.measurements.find((m) => m.name === 'waist_to_underarm')!.manual[M] = 2; // 6 rows for the whole change
    p = { ...p };
    const errs = messages(p, 'M', /More shaping than the rows allow/);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].message).toMatch(/between waist and underarm, where lower body 4X meets upper body M: lower body 4X → upper body M: decrease \d+ sts each side/);
    expect(errs[0].severity).toBe('error');
    // It replaces the panel's own message for that segment rather than repeating it.
    const plain = projectChecks(p).filter((c) => c.sizeId === M && c.issue.severity === 'error' && !/More shaping/.test(c.issue.message) && c.issue.ref.kind === 'segment' && errs.some((e) => JSON.stringify(e.ref) === JSON.stringify(c.issue.ref)));
    expect(plain).toEqual([]);
  });

  it('hem narrower than bust + ease: only when turned on', () => {
    const p = garment();
    expect(messages(p, 'M', /narrower than the bust plus ease/)).toEqual([]);
    p.settings.hemCheck = true;
    const [w] = messages(p, 'M', /narrower than the bust plus ease/);
    expect(w.message).toBe('The hem (125.5 cm around) is 1.5 cm narrower than the bust plus ease (127.0 cm): it may not pull over the bust.');
    p.fit.hem = 'hip_seat_curvy';
    expect(messages(p, 'M', /narrower than the bust plus ease/)).toEqual([]);
  });

  it('armhole shorter than the scye circumference', () => {
    const p = garment();
    expect(messages(p, 'M', /scye circumference/)).toEqual([]);
    p.measurements.find((m) => m.name === 'scye_circumference')!.manual[sizeId(p, 'M')] = 70;
    const [w] = messages(p, 'M', /scye circumference/);
    expect(w.severity).toBe('warning');
    expect(w.message).toMatch(/^The armhole \(Front \+ Back, \d+\.\d cm\) is shorter than the scye circumference \(70\.0 cm\)/);
  });

  it('neckband shorter than the neck base', () => {
    const p = garment();
    expect(messages(p, 'M', /neck base/)).toEqual([]);
    p.measurements.find((m) => m.name === 'neck_base')!.manual[sizeId(p, 'M')] = 50;
    expect(messages(p, 'M', /neck base/)[0].message).toBe("The neckband (47.0 cm) is shorter than the neck base (50.0 cm): it won't sit around the neck.");
  });
});
