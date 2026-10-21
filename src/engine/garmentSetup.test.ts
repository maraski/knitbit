import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defaultEdges } from './edgeTreatments';
import { CONTIGUOUS_TAG, setOpening } from './garment';
import { buildGarment, changeMethod, easePresetOf, garmentChoice, garmentLabel, setNeckline, setSleeve, type GarmentSpec } from './garmentSetup';
import { projectChecks } from './checks';
import { joinReport } from './joins';
import type { FrontOpening, Project } from './model';
import { computePanel } from './panel';
import { loadProject } from './schema';
import { bodice, sleeve } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

const base = () => ({ ...fixtureProject(), panels: [], joins: [] });
const spec = (s: Partial<GarmentSpec>): GarmentSpec => ({ method: 'seamed', opening: 'closed', neckline: 'round', sleeve: 'set-in', ease: 'standard', ...s });
const names = (p: Project) => p.panels.map((x) => x.name);

function expectComputes(p: Project) {
  const M = sizeId(p, 'M');
  for (const panel of p.panels) {
    const c = computePanel(p, panel, M);
    expect(c.ok, `${panel.name}: ${c.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ')}`).toBe(true);
  }
  for (const j of p.joins ?? []) {
    const r = joinReport(p, j, M);
    expect(r.a.ok, j.name).toBe(true);
  }
}

describe('New garment: pieces for each method and front', () => {
  const cases: [GarmentSpec['method'], FrontOpening, string[]][] = [
    ['seamed', 'closed', ['Back', 'Front', 'Sleeve']],
    ['seamed', 'cardigan', ['Back', 'Right front', 'Left front', 'Sleeve']],
    ['top-down', 'closed', ['Back', 'Front', 'Sleeve']],
    ['top-down', 'cardigan', ['Back', 'Right front', 'Left front', 'Sleeve']],
    ['contiguous', 'closed', ['Yoke', 'Back', 'Front', 'Left sleeve', 'Right sleeve']],
    ['contiguous', 'cardigan', ['Yoke', 'Back', 'Right front', 'Left front', 'Left sleeve', 'Right sleeve']],
  ];
  for (const [method, opening, panels] of cases) {
    it(`${method} × ${opening}`, () => {
      const p = buildGarment(base(), spec({ method, opening, sleeve: method === 'contiguous' ? 'contiguous' : 'set-in' }));
      expect(names(p)).toEqual(panels);
      expect(p.garment).toEqual({ construction: method === 'contiguous' ? 'contiguous' : 'panels', opening });
      expect(p.tags.includes(CONTIGUOUS_TAG)).toBe(method === 'contiguous');
      expect(garmentChoice(p)).toMatchObject({ method, opening, neckline: 'round' });
      expect(p.joins!.length).toBeGreaterThan(0);
      expectComputes(p);
      expect(projectChecks(p).filter((c) => c.issue.ref.kind === 'join' && c.issue.severity !== 'info')).toEqual([]);
    });
  }

  it('seamed: side and shoulder seams; top-down: shoulders picked up and joined in the round', () => {
    const s = buildGarment(base(), spec({}));
    expect(s.joins!.map((j) => j.name)).toEqual(['Left side seam', 'Right side seam', 'Shoulder seams']);
    expect(s.panels.every((x) => x.direction === 'bottom-up')).toBe(true);
    const t = buildGarment(base(), spec({ method: 'top-down' }));
    expect(t.joins!.map((j) => j.name)).toEqual(['Front shoulders picked up from the back', 'Underarm cast-on']);
    expect(t.panels.every((x) => x.direction === 'top-down')).toBe(true);
    expect(t.panels.find((x) => x.name === 'Front')!.startFrom).toBe('pickup');
  });

  it('neckline, sleeve and ease preset', () => {
    const p = buildGarment(base(), spec({ neckline: 'v', sleeve: 'drop', ease: 'relaxed' }));
    expect(garmentChoice(p)).toMatchObject({ neckline: 'v', sleeve: 'drop' });
    expect(p.ease.global).toBe(10);
    expect(easePresetOf(p.ease)).toBe('relaxed');
    const none = buildGarment(base(), spec({ sleeve: 'none' }));
    expect(names(none)).toEqual(['Back', 'Front']);
    expect(garmentChoice(none).sleeve).toBe('none');
    const y = buildGarment(base(), spec({ method: 'contiguous', neckline: 'boat' }));
    expect(y.panels[0].yoke!.neck.shape).toBe('boat');
  });

  it('blank makes no pieces and reads as custom', () => {
    const p = buildGarment(base(), spec({ method: 'blank' }));
    expect(p.panels).toEqual([]);
    expect(garmentChoice(p).method).toBe('custom');
    expect(garmentLabel(p)).toBe('Custom · pullover');
  });

  it('edge settings: applied, and the neckband and band strips made', () => {
    const edges = defaultEdges();
    edges.hem.enabled = true;
    const p = buildGarment(base(), spec({ opening: 'cardigan', edges }));
    expect(p.panels.find((x) => x.name === 'Back')!.sections.some((s) => s.edge === 'hem')).toBe(true);
    expect(p.panels.some((x) => x.edge === 'neckband')).toBe(true);
    expect(p.panels.some((x) => x.band)).toBe(true);
    expectComputes(p);
    // Without edge settings, nothing is applied (as before).
    expect(buildGarment(base(), spec({})).edges).toBeUndefined();
  });

  it('keeps the sizes and gauge of the base', () => {
    const b = base();
    b.gauge = { stitches: 18, rows: 24, basis: '10cm' };
    const p = buildGarment(b, spec({}));
    expect(p.gauge).toEqual(b.gauge);
    expect(p.sizes).toEqual(b.sizes);
  });
});

describe('Garment tab: changing the method', () => {
  it('rebuilds the garment pieces, keeps the others, and says what changes', () => {
    let p = buildGarment(base(), spec({ neckline: 'square' }));
    const rect = { ...bodice('back'), template: 'rectangle', name: 'Pocket' };
    p = { ...p, panels: [...p.panels, rect] };
    const notes: string[] = [];
    const q = changeMethod(p, 'contiguous', notes);
    expect(names(q)).toEqual(['Yoke', 'Back', 'Front', 'Left sleeve', 'Right sleeve', 'Pocket']);
    expect(garmentChoice(q)).toMatchObject({ method: 'contiguous', neckline: 'square' });
    expect(q.joins!.every((j) => [...j.edges, ...j.partner].every((r) => q.panels.some((x) => x.id === r.panelId)))).toBe(true);
    expect(notes[0]).toBe('Replaces Back, Front, Sleeve.');
    expect(notes[1]).toBe('Adds Yoke, Back, Front, Left sleeve, Right sleeve.');
    expect(notes[2]).toBe('Keeps Pocket.');
    expect(q.sizes).toBe(p.sizes);
    expectComputes({ ...q, panels: q.panels.filter((x) => x.name !== 'Pocket') });

    const back = changeMethod(q, 'top-down');
    expect(garmentChoice(back)).toMatchObject({ method: 'top-down', neckline: 'square', sleeve: 'set-in' });
    expect(back.tags.includes(CONTIGUOUS_TAG)).toBe(false);
    expect(changeMethod(back, 'top-down')).toBe(back);
  });

  it('keeps a cardigan a cardigan', () => {
    const p = buildGarment(base(), spec({ opening: 'cardigan' }));
    const q = changeMethod(p, 'contiguous');
    expect(names(q)).toContain('Left front');
    expect(q.panels.filter((x) => x.fromYoke).every((x) => !x.inTheRound)).toBe(true);
    expectComputes(q);
  });

  it('changes the neckline in place and swaps the sleeves', () => {
    const p = buildGarment(base(), spec({}));
    const v = setNeckline(p, 'v');
    expect(garmentChoice(v).neckline).toBe('v');
    expect(v.panels.map((x) => x.id)).toEqual(p.panels.map((x) => x.id));
    const notes: string[] = [];
    const d = setSleeve(v, 'straight', notes);
    expect(garmentChoice(d).sleeve).toBe('straight');
    expect(notes).toEqual(['Replaces Sleeve.', 'Adds Sleeve (straight).']);
    expect(names(setSleeve(d, 'none'))).toEqual(['Back', 'Front']);
    const y = setNeckline(buildGarment(base(), spec({ method: 'contiguous' })), 'v');
    expect(y.panels[0].yoke!.neck.shape).toBe('v');
    expectComputes(y);
  });

  it('opening changes still go through setOpening', () => {
    const p = setOpening(buildGarment(base(), spec({ method: 'top-down' })), 'cardigan');
    expect(garmentLabel(p)).toBe('Top-down · cardigan');
  });
});

describe('older projects: the method is read from their pieces', () => {
  it('the old sample (bottom-up back, front, set-in sleeve) reads as seamed', () => {
    const p = { ...base(), panels: [bodice('back'), bodice('front'), sleeve('set-in')] };
    expect(garmentChoice(p)).toEqual({ method: 'seamed', opening: 'closed', neckline: 'round', sleeve: 'set-in' });
    expect(garmentLabel(p)).toBe('Seamed panels · pullover');
  });

  it('a schema 2 file loads and reads its method without new fields', () => {
    const text = readFileSync(fileURLToPath(new URL('./fixtures/project_v2.json', import.meta.url)), 'utf8');
    const r = loadProject(text);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    const c = garmentChoice(r.project);
    expect(['seamed', 'top-down', 'custom']).toContain(c.method);
    expect(Object.keys(r.project.garment).sort()).toEqual(['construction', 'opening']);
  });
});
