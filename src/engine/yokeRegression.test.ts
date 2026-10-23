// Regression: the yoke methods made before the off-shoulder neckline compute exactly as they did. The snapshot holds
// a digest of every generator result (and every garment piece) per size; it was written before the off-shoulder code.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultYoke, generateYoke } from './contiguous';
import { setOpening } from './garment';
import { buildGarment } from './garmentSetup';
import type { FrontOpening, NecklineShape, Project, SleeveLength, YokeSpec } from './model';
import { computePanel } from './panel';
import { defaultRaglan } from './raglan';
import { fixtureProject } from './testFixtures';

const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const base = () => ({ ...fixtureProject(), panels: [], joins: [] });
const SHAPES: NecklineShape[] = ['round', 'v', 'square', 'boat'];
const OPENINGS: FrontOpening[] = ['closed', 'cardigan'];

function yokeDigests(project: Project, spec: YokeSpec): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of project.sizes) out[s.name] = digest(generateYoke(project, spec, s.id));
  return out;
}

describe('yoke regression (before off-shoulder)', () => {
  for (const opening of OPENINGS) {
    const p = setOpening(fixtureProject(), opening);
    for (const shape of SHAPES) {
      it(`contiguous, back start × ${shape} × ${opening}`, () => expect(yokeDigests(p, defaultYoke(shape, 'back'))).toMatchSnapshot());
      if (shape !== 'v') it(`contiguous, whole neck (modified raglan) × ${shape} × ${opening}`, () => expect(yokeDigests(p, defaultYoke(shape, 'neck'))).toMatchSnapshot());
      it(`raglan, back start × ${shape} × ${opening}`, () => expect(yokeDigests(p, defaultRaglan(shape, 'back'))).toMatchSnapshot());
      if (shape !== 'v') it(`raglan, whole neck × ${shape} × ${opening}`, () => expect(yokeDigests(p, defaultRaglan(shape, 'neck'))).toMatchSnapshot());
    }
  }

  const methods = ['contiguous', 'raglan', 'modified-raglan'] as const;
  const lengths: SleeveLength[] = ['long', 'short', 'cap'];
  for (const method of methods) {
    for (const opening of OPENINGS) {
      for (const sleeveLength of lengths) {
        it(`garment ${method} × ${opening} × ${sleeveLength}: every piece in every size`, () => {
          const p = buildGarment(base(), { method, opening, neckline: 'round', sleeve: method === 'raglan' ? 'raglan' : 'contiguous', sleeveLength, ease: 'standard' });
          const out: Record<string, string> = {};
          for (const s of p.sizes) out[s.name] = digest(p.panels.map((x) => { const c = computePanel(p, x, s.id); return [x.name, c.ok, c.counts, c.issues.map((i) => i.message)]; }));
          expect(out).toMatchSnapshot();
        });
      }
    }
  }
});
