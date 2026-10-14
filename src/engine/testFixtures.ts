// Shared fixtures for engine tests.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv';
import { defaultAutoMethod, dim, newPanel, newSegment, newWaypoint, type Project } from './model';
import { projectFromTable } from './seed';

/** The shipped sample table (Ysolda Teague's designer size chart, adapted). */
export const YSOLDA_CSV = readFileSync(fileURLToPath(new URL('../../samples/sizing_table_ysolda_cm.csv', import.meta.url)), 'utf8');

/** The old (pre-Ysolda) sample table, for tests of older tables and migration. */
export const LEGACY_CSV = readFileSync(fileURLToPath(new URL('./fixtures/legacy_sizing_table_cm.csv', import.meta.url)), 'utf8');

export function sizeId(p: Project, name: string): string {
  const s = p.sizes.find((x) => x.name === name);
  if (!s) throw new Error(`no size ${name}`);
  return s.id;
}

/** A project from the shipped sample table with one panel that uses every kind of segment method. */
export function fixtureProject(csv = YSOLDA_CSV): Project {
  const { project } = projectFromTable(parseCsv(csv), 'Fixture top');
  const p = newPanel('Back');
  const hem = newWaypoint('hem', 0, 'hip_seat_straight/2 + ease/4');
  const waist = newWaypoint('waist', 'hem_drop', 'waist/2 + ease/4');
  const under = newWaypoint('underarm', 'hem_drop + waist_to_underarm', 'upper_chest/2 + ease/4');
  const shoulder = newWaypoint('shoulder', 'hem_drop + back_waist_length - shoulder_drop', 'back_shoulder_width');
  shoulder.symmetric = false;
  shoulder.left = dim('back_shoulder_width/2');
  shoulder.right = dim('back_shoulder_width/2 + 0.5', { [sizeId(project, 'M')]: 20 });
  p.waypoints = [hem, waist, under, shoulder];
  p.segments = [
    newSegment(hem.id),
    { ...newSegment(waist.id, { ...defaultAutoMethod(), rhythm: { type: 'mixed', a: 4, b: 6 } }), manual: { [sizeId(project, 'S')]: { left: [{ row: 3, delta: 1, symbol: 'm1l' }] } } },
    { ...newSegment(under.id, { kind: 'steps', steps: [4, 3, 2], maxPerStep: 4 }), right: { kind: 'shortrows', steps: null, maxPerStep: 5, style: 'german' }, mirror: false },
  ];
  p.sections = [{ id: 'sec1', name: 'Hem rib', fromHeight: dim(0), toHeight: dim(5), pattern: { name: '2x2 rib', multiple: 4, offset: 2 } }];
  p.neckline = { shape: 'round', width: dim('back_neck_width'), depth: dim('back_neck_drop'), centre: 'hold', centreWidth: dim('back_neck_width * 0.6'), side: 'rs' };
  project.panels = [p, { ...newPanel('Plain'), inTheRound: true }];
  return project;
}

/**
 * The same project seeded from the old sample table (mapped to the new names, cup E/F): 10 sizes, several seeded
 * estimates. For tests of grading and estimates that need values the shipped table has in its columns.
 */
export function legacyFixtureProject(): Project {
  return fixtureProject(LEGACY_CSV);
}
