import { describe, expect, it } from 'vitest';
import { newPanel, type Project, type YokeSpec } from './model';
import { computePanel } from './panel';
import { fixtureProject } from './testFixtures';
import { loadYokeEngine, needsYokeEngine, yokeEngine } from './yokeEngine';

// This file imports nothing that loads contiguous.ts, so the generators start unloaded.
describe('yoke generators on demand', () => {
  it('shows a yoke as loading until the generators load, then computes it', async () => {
    const stub: Project = { ...fixtureProject(), panels: [{ ...newPanel('Yoke'), yoke: {} as YokeSpec }], joins: [] };
    expect(yokeEngine()).toBeNull();
    expect(needsYokeEngine(stub)).toBe(true);
    expect(needsYokeEngine({ ...stub, panels: [newPanel('Back')] })).toBe(false);
    const c = computePanel(stub, stub.panels[0], stub.baseSizeId);
    expect(c.ok).toBe(false);
    expect(c.issues.map((i) => i.message)).toEqual(['Loading the yoke…']);

    await loadYokeEngine();
    expect(yokeEngine()).not.toBeNull();
    expect(needsYokeEngine(stub)).toBe(false);
    const { generateYoke, yokePanel } = await import('./contiguous');
    const p: Project = { ...stub, panels: [yokePanel()] };
    const y = generateYoke(p, p.panels[0].yoke!, stub.baseSizeId);
    expect(y.rows.length).toBeGreaterThan(0);
    expect(computePanel(p, p.panels[0], stub.baseSizeId).counts).toHaveLength(y.rows.length + 1);
  });
});
