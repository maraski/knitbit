import { describe, expect, it } from 'vitest';
import { clearAutosave, readAutosave, writeAutosave, type KVStorage } from './autosave';
import { canRedo, canUndo, commit, createHistory, redo, undo } from './history';
import { SCHEMA_VERSION } from './model';
import { loadProject, migrate, serializeProject, validateProject } from './schema';
import { fixtureProject } from './testFixtures';

describe('JSON round-trip', () => {
  it('saves and loads a project unchanged', () => {
    const p = fixtureProject();
    const r = loadProject(serializeProject(p));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.project).toEqual(p);
      expect(r.warnings).toEqual([]);
      expect(r.migratedFrom).toBeNull();
    }
  });

  it('round-trips twice to identical text', () => {
    const text = serializeProject(fixtureProject());
    const r = loadProject(text);
    expect(r.ok && serializeProject(r.project)).toBe(text);
  });
});

describe('load errors', () => {
  it('rejects invalid JSON', () => {
    const r = loadProject('{ nope');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]).toMatch(/Not valid JSON/);
  });

  it('rejects files without a schema version', () => {
    expect(loadProject('{"name":"x"}')).toEqual({ ok: false, errors: ['This file is not a Knitbit project (it has no schemaVersion).'] });
  });

  it('rejects newer schemas', () => {
    const r = loadProject(JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1 }));
    expect(!r.ok && r.errors[0]).toMatch(/newer version of Knitbit/);
  });

  it('points at the exact bad field', () => {
    const p = fixtureProject() as unknown as Record<string, any>;
    p.panels[0].waypoints[1].height.expr = 42;
    p.gauge.basis = '5cm';
    p.panels[0].segments[0].left.kind = 'magic';
    const r = loadProject(JSON.stringify(p));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContain('project.panels[0].waypoints[1].height.expr: expected text, got number 42');
      expect(r.errors).toContain('project.gauge.basis: expected one of "10cm", "4in", got string "5cm"');
      expect(r.errors.some((e) => e.startsWith('project.panels[0].segments[0].left.kind: expected one of "auto"'))).toBe(true);
    }
  });

  it('checks cross-references', () => {
    const p = fixtureProject();
    p.baseSizeId = 'gone';
    p.panels[0].segments[0].fromWaypoint = 'missing';
    p.measurements[1].name = p.measurements[0].name;
    p.measurements[0].manual['ghost'] = 3;
    const v = validateProject(p);
    expect(v.errors).toContain('project.baseSizeId: "gone" is not one of the sizes.');
    expect(v.errors.some((e) => e.includes('fromWaypoint: no waypoint "missing"'))).toBe(true);
    expect(v.errors.some((e) => e.startsWith('Duplicate measurement name'))).toBe(true);
    expect(v.warnings[0]).toMatch(/unknown size id "ghost"/);
  });
});

describe('migrations', () => {
  it('runs registered migrations in order up to the current schema', () => {
    const current = fixtureProject() as unknown as Record<string, unknown>;
    const { settings, ...old } = current;
    const v0 = { ...old, schemaVersion: SCHEMA_VERSION - 1, pickUpRatio: 0.75 };
    const migrations = {
      [SCHEMA_VERSION - 1]: (raw: any) => {
        const { pickUpRatio, ...rest } = raw;
        return { ...rest, settings: { seamToleranceCm: 1, pickUp: { stitches: pickUpRatio * 4, rows: 4 } } };
      },
    };
    const r = loadProject(JSON.stringify(v0), migrations);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.migratedFrom).toBe(SCHEMA_VERSION - 1);
      expect(r.project.schemaVersion).toBe(SCHEMA_VERSION);
      expect(r.project.settings).toEqual(settings);
    }
  });

  it('reports a missing migration step', () => {
    expect(migrate({ schemaVersion: 0 }, {}, 2).errors).toEqual(['No migration from schema 0 to 1.']);
  });
});

describe('autosave', () => {
  const memory = (): KVStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  };

  it('writes and reads back', () => {
    const s = memory();
    const p = fixtureProject();
    expect(writeAutosave(s, p)).toBeNull();
    const r = readAutosave(s);
    expect(r.found && r.ok && r.project).toEqual(p);
    clearAutosave(s);
    expect(readAutosave(s)).toEqual({ found: false });
  });

  it('reports storage failures and corrupt data instead of throwing', () => {
    const full: KVStorage = { getItem: () => '{bad', setItem: () => { throw new Error('quota exceeded'); }, removeItem: () => {} };
    expect(writeAutosave(full, fixtureProject())).toMatch(/quota exceeded/);
    const r = readAutosave(full);
    expect(r.found && !r.ok && r.errors[0]).toMatch(/unreadable/);
  });
});

describe('undo history', () => {
  it('undoes and redoes', () => {
    let h = createHistory(1);
    h = commit(h, 2, null, 0);
    h = commit(h, 3, null, 10);
    expect(h.present).toBe(3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    expect(h.present).toBe(2);
    h = commit(h, 9, null, 20);
    expect(canRedo(h)).toBe(false);
  });

  it('coalesces rapid edits with the same key', () => {
    let h = createHistory('');
    h = commit(h, 'b', 'name', 0);
    h = commit(h, 'bu', 'name', 300);
    h = commit(h, 'bus', 'name', 600);
    h = commit(h, 'bust', 'other', 700);
    expect(h.past).toEqual(['', 'bus']);
    h = commit(h, 'bust2', 'other', 5000); // too late to merge
    expect(h.past).toEqual(['', 'bus', 'bust']);
  });
});
