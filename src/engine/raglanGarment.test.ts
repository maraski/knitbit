import { describe, expect, it } from 'vitest';
import { defaultYoke, generateYoke } from './contiguous';
import { contiguousChecks } from './contiguousChecks';
import { CONTIGUOUS_CREDIT, CONTIGUOUS_TAG, exportFooter, RAGLAN_TAG } from './garment';
import { buildGarment, changeMethod, garmentChoice, garmentLabel, necklinesFor, setNeckline, setSleeve, sleevesFor, type GarmentSpec } from './garmentSetup';
import { projectChecks } from './checks';
import { type FrontOpening, type Project } from './model';
import { computePanel } from './panel';
import { loadProject } from './schema';
import { fixtureProject, sizeId } from './testFixtures';

const base = () => ({ ...fixtureProject(), panels: [], joins: [] });
const spec = (s: Partial<GarmentSpec>): GarmentSpec => ({ method: 'raglan', opening: 'closed', neckline: 'round', sleeve: 'raglan', ease: 'standard', ...s });
const names = (p: Project) => p.panels.map((x) => x.name);
const yokeOf = (p: Project) => p.panels.find((x) => x.yoke)!.yoke!;

describe('New garment: raglan and modified raglan', () => {
  const cases: [GarmentSpec['method'], FrontOpening, string[]][] = [
    ['raglan', 'closed', ['Yoke', 'Back', 'Front', 'Left sleeve', 'Right sleeve']],
    ['raglan', 'cardigan', ['Yoke', 'Back', 'Right front', 'Left front', 'Left sleeve', 'Right sleeve']],
    ['modified-raglan', 'closed', ['Yoke', 'Back', 'Front', 'Left sleeve', 'Right sleeve']],
    ['modified-raglan', 'cardigan', ['Yoke', 'Back', 'Right front', 'Left front', 'Left sleeve', 'Right sleeve']],
  ];
  for (const [method, opening, panels] of cases) {
    it(`${method} × ${opening}: a yoke, body and sleeves that start with the held stitches, in every size`, () => {
      const p = buildGarment(base(), spec({ method, opening, sleeve: sleevesFor(method)[0] }));
      expect(names(p)).toEqual(panels);
      expect(p.garment).toEqual({ construction: 'contiguous', opening });
      expect(p.tags).toContain(RAGLAN_TAG);
      expect(p.tags).not.toContain(CONTIGUOUS_TAG);
      expect(garmentChoice(p)).toMatchObject({ method, opening, neckline: 'round', sleeve: method === 'raglan' ? 'raglan' : 'contiguous' });
      for (const s of p.sizes) {
        for (const panel of p.panels) {
          const c = computePanel(p, panel, s.id);
          expect(c.ok, `${s.name} ${panel.name}: ${c.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ')}`).toBe(true);
        }
        // Body and sleeves take exactly the held stitches plus the underarm cast-on (no continuity warnings).
        const cont = contiguousChecks(p, s.id, new Map()).filter((c) => c.issue.severity === 'warning' && /starts with/.test(c.issue.message));
        expect(cont.map((c) => c.issue.message)).toEqual([]);
      }
      expect(projectChecks(p).filter((c) => c.issue.ref.kind === 'join' && c.issue.severity !== 'info')).toEqual([]);
    });
  }

  it('raglan: the yoke is a raglan with the front neck shaped by increases; modified raglan: the whole-neck start', () => {
    const r = yokeOf(buildGarment(base(), spec({})));
    expect(r.style).toBe('raglan');
    expect(r.start).toBe('back');
    const m = yokeOf(buildGarment(base(), spec({ method: 'modified-raglan', sleeve: 'contiguous' })));
    expect(m.style).toBeUndefined();
    expect(m.start).toBe('neck');
    const c = yokeOf(buildGarment(base(), spec({ method: 'contiguous', sleeve: 'contiguous' })));
    expect(c.start).toBe('back');
    expect(garmentLabel(buildGarment(base(), spec({ opening: 'cardigan' })))).toBe('Raglan · cardigan');
  });

  it('a V neck: raglan has one (neck increases); modified raglan has none and makes a round neck', () => {
    expect(necklinesFor('raglan')).toContain('v');
    expect(necklinesFor('modified-raglan')).not.toContain('v');
    const v = buildGarment(base(), spec({ neckline: 'v' }));
    expect(yokeOf(v).neck.shape).toBe('v');
    expect(generateYoke(v, yokeOf(v), sizeId(v, 'M')).ok).toBe(true);
    const m = buildGarment(base(), spec({ method: 'modified-raglan', neckline: 'v', sleeve: 'contiguous' }));
    expect(yokeOf(m).neck.shape).toBe('round');
    expect(yokeOf(m).start).toBe('neck');
  });

  it('the export credit names the contiguous method for contiguous and modified raglan, not for raglan', () => {
    expect(exportFooter(buildGarment(base(), spec({})))).toEqual([]);
    expect(exportFooter(buildGarment(base(), spec({ method: 'modified-raglan', sleeve: 'contiguous' })))).toEqual([CONTIGUOUS_CREDIT]);
    expect(exportFooter(buildGarment(base(), spec({ method: 'contiguous', sleeve: 'contiguous' })))).toEqual([CONTIGUOUS_CREDIT]);
  });
});

describe('Garment tab: raglan', () => {
  it('changing contiguous to raglan rebuilds the yoke, body and sleeves, swaps the tag and says the sleeves change only when they were panels', () => {
    const c = buildGarment(base(), spec({ method: 'contiguous', sleeve: 'contiguous' }));
    const notes: string[] = [];
    const r = changeMethod(c, 'raglan', notes);
    expect(garmentChoice(r).method).toBe('raglan');
    expect(r.tags).toEqual(expect.arrayContaining([RAGLAN_TAG]));
    expect(r.tags).not.toContain(CONTIGUOUS_TAG);
    expect(notes.some((n) => n.startsWith('Sleeves become'))).toBe(false); // part of the method
    const fromSeamed: string[] = [];
    changeMethod(buildGarment(base(), spec({ method: 'seamed', sleeve: 'set-in' })), 'raglan', fromSeamed);
    expect(fromSeamed.some((n) => n.startsWith('Sleeves become raglan'))).toBe(true);
    const back = changeMethod(r, 'contiguous');
    expect(back.tags).toContain(CONTIGUOUS_TAG);
    expect(back.tags).not.toContain(RAGLAN_TAG);
    const seamed = changeMethod(r, 'seamed');
    expect(seamed.tags).not.toContain(RAGLAN_TAG);
    expect(garmentChoice(seamed).method).toBe('seamed');
  });

  it('a V-neck raglan changed to modified raglan becomes round, and says so', () => {
    const v = buildGarment(base(), spec({ neckline: 'v' }));
    const notes: string[] = [];
    const m = changeMethod(v, 'modified-raglan', notes);
    expect(garmentChoice(m)).toMatchObject({ method: 'modified-raglan', neckline: 'round' });
    expect(notes.some((n) => n.includes('neckline becomes round'))).toBe(true);
  });

  it('the neckline changes on the raglan in place, keeping its start; the sleeves stay raglan', () => {
    const r = buildGarment(base(), spec({}));
    const boat = setNeckline(r, 'boat');
    expect(yokeOf(boat).style).toBe('raglan');
    expect(yokeOf(boat).neck.shape).toBe('boat');
    expect(yokeOf(boat).start).toBe('back');
    expect(setSleeve(r, 'set-in')).toBe(r);
  });
});

describe('older projects: modified raglan without a migration', () => {
  it('a saved contiguous yoke with the whole-neck start opens as modified raglan; one without a start as contiguous', () => {
    const p = buildGarment(base(), spec({ method: 'contiguous', sleeve: 'contiguous' }));
    // As saved before raglan: no style field; the whole-neck start was the default for new yokes.
    const whole = { ...p, panels: p.panels.map((x) => (x.yoke ? { ...x, yoke: defaultYoke('round', 'neck') } : x)) };
    const r = loadProject(JSON.stringify(whole));
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.migrationNotes).toEqual([]);
    expect(garmentChoice(r.project).method).toBe('modified-raglan');
    expect(yokeOf(r.project).style).toBeUndefined();
    const { start: _, ...legacy } = defaultYoke('round', 'back');
    const old = { ...p, panels: p.panels.map((x) => (x.yoke ? { ...x, yoke: legacy } : x)) };
    const q = loadProject(JSON.stringify(old));
    if (!q.ok) throw new Error(q.errors.join('\n'));
    expect(garmentChoice(q.project).method).toBe('contiguous');
  });
});
