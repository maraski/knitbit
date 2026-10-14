import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTIGUOUS_CREDIT, CONTIGUOUS_TAG, exportFooter, parseTags, setConstruction, setOpening } from './garment';
import { newProject, SCHEMA_VERSION } from './model';
import { computePanel } from './panel';
import { loadProject, serializeProject } from './schema';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const V2_TEXT = fixture('project_v2.json');

describe('schema 2 → 3 migration', () => {
  it('loads an old project as Panels + Closed and reports what changed', () => {
    const r = loadProject(V2_TEXT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migratedFrom).toBe(2);
    expect(r.project.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r.project.garment).toEqual({ construction: 'panels', opening: 'closed' });
    expect(r.project.tags).toEqual([]);
    expect(r.migrationNotes).toEqual([
      'Construction set to Panels and front opening to Closed / pullover (how the project was built so far).',
      'Added an empty tag list.',
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('leaves panels, joins and measurements untouched', () => {
    const old = JSON.parse(V2_TEXT);
    const r = loadProject(V2_TEXT);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.project.panels).toEqual(old.panels);
    expect(r.project.joins).toEqual(old.joins);
    expect(r.project.measurements).toEqual(old.measurements);
    expect(r.project.settings).toEqual(old.settings);
  });

  it('computes the same panels after migrating', () => {
    const r = loadProject(V2_TEXT);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    const old = JSON.parse(V2_TEXT);
    for (const panel of r.project.panels) {
      for (const size of r.project.sizes) {
        const after = computePanel(r.project, panel, size.id);
        const before = computePanel({ ...old, garment: r.project.garment, tags: [] }, panel, size.id);
        expect(after.counts).toEqual(before.counts);
      }
    }
  });

  it('migrates a schema 1 project through 2 to 3', () => {
    const r = loadProject(fixture('project_v1.json'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migratedFrom).toBe(1);
    expect(r.project.garment).toEqual({ construction: 'panels', opening: 'closed' });
    expect(r.migrationNotes.at(-1)).toBe('Added an empty tag list.');
  });

  it('keeps options a file already has', () => {
    const raw = { ...JSON.parse(V2_TEXT), garment: { construction: 'contiguous', opening: 'cardigan' }, tags: ['mine'] };
    const r = loadProject(JSON.stringify(raw));
    expect(r.ok && r.project.garment).toEqual({ construction: 'contiguous', opening: 'cardigan' });
    expect(r.ok && r.project.tags).toEqual(['mine']);
    expect(r.ok && r.migrationNotes).toEqual([]);
  });

  it('round-trips a current project', () => {
    const r = loadProject(V2_TEXT);
    if (!r.ok) throw new Error();
    const again = loadProject(serializeProject(r.project));
    expect(again.ok && again.project).toEqual(r.project);
    expect(again.ok && again.migratedFrom).toBeNull();
  });

  it('rejects unknown option values with the exact path', () => {
    const p = { ...newProject(), garment: { construction: 'raglan', opening: 'closed' } };
    const r = loadProject(JSON.stringify(p));
    expect(!r.ok && r.errors).toContain('project.garment.construction: expected one of "panels", "contiguous", got string "raglan"');
  });
});

describe('garment options', () => {
  it('defaults to Panels + Closed', () => {
    expect(newProject().garment).toEqual({ construction: 'panels', opening: 'closed' });
  });

  it('adds the contiguous tag and removes it again', () => {
    let p = { ...newProject(), tags: ['summer'] };
    p = setConstruction(p, 'contiguous');
    expect(p.tags).toEqual(['summer', CONTIGUOUS_TAG]);
    expect(setConstruction(p, 'contiguous')).toBe(p);
    p = setConstruction(p, 'panels');
    expect(p.tags).toEqual(['summer']);
  });

  it('does not duplicate a tag the knitter already added', () => {
    const p = setConstruction({ ...newProject(), tags: [CONTIGUOUS_TAG] }, 'contiguous');
    expect(p.tags).toEqual([CONTIGUOUS_TAG]);
  });

  it('sets the front opening independently', () => {
    const p = setOpening(setConstruction(newProject(), 'contiguous'), 'cardigan');
    expect(p.garment).toEqual({ construction: 'contiguous', opening: 'cardigan' });
  });

  it('parses tags', () => {
    expect(parseTags(' Summer, cotton,,summer , ')).toEqual(['summer', 'cotton']);
  });

  it('puts the credit in the export footer for contiguous only, unless switched off', () => {
    const p = newProject();
    expect(exportFooter(p)).toEqual([]);
    const c = setConstruction(p, 'contiguous');
    expect(exportFooter(c)).toEqual([CONTIGUOUS_CREDIT]);
    expect(exportFooter({ ...c, settings: { ...c.settings, exportCredit: false } })).toEqual([]);
    expect(CONTIGUOUS_CREDIT).toContain('Susie Myers, SusieM on Ravelry (http://www.ravelry.com/people/SusieM)');
  });
});
