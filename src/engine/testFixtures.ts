// Shared fixtures for engine tests.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv';
import { defaultAutoMethod, dim, newPanel, newSegment, newWaypoint, type Project } from './model';
import { projectFromTable } from './seed';

export const SAMPLE_CSV = readFileSync(fileURLToPath(new URL('../../samples/sizing_table_cm.csv', import.meta.url)), 'utf8');

export function sizeId(p: Project, name: string): string {
  const s = p.sizes.find((x) => x.name === name);
  if (!s) throw new Error(`no size ${name}`);
  return s.id;
}

/** A project from the sample table with one panel that uses every kind of segment method. */
export function fixtureProject(): Project {
  const { project } = projectFromTable(parseCsv(SAMPLE_CSV), 'Fixture top');
  const p = newPanel('Back');
  const hem = newWaypoint('hem', 0, 'full_hip/2 + ease/4');
  const waist = newWaypoint('waist', 'hem_to_waist', 'waist/2 + ease/4');
  const under = newWaypoint('underarm', 'hem_to_waist + waist_to_armhole', 'upper_chest/2 + ease/4');
  const shoulder = newWaypoint('shoulder', 'hem_to_waist + back_waist_length - shoulder_slope', 'shoulder_width');
  shoulder.symmetric = false;
  shoulder.left = dim('shoulder_width/2');
  shoulder.right = dim('shoulder_width/2 + 0.5', { [sizeId(project, 'M')]: 20 });
  p.waypoints = [hem, waist, under, shoulder];
  p.segments = [
    newSegment(hem.id),
    { ...newSegment(waist.id, { ...defaultAutoMethod(), rhythm: { type: 'mixed', a: 4, b: 6 } }), manual: { [sizeId(project, 'S')]: { left: [{ row: 3, delta: 1, symbol: 'm1l' }] } } },
    { ...newSegment(under.id, { kind: 'steps', steps: [4, 3, 2], maxPerStep: 4 }), right: { kind: 'shortrows', steps: null, maxPerStep: 5, style: 'german' }, mirror: false },
  ];
  p.sections = [{ id: 'sec1', name: 'Hem rib', fromHeight: dim(0), toHeight: dim(5), pattern: { name: '2x2 rib', multiple: 4, offset: 2 } }];
  p.neckline = { shape: 'round', width: dim('neck_width'), depth: dim('back_neck_depth'), centre: 'hold', centreWidth: dim('neck_width * 0.6'), side: 'rs' };
  project.panels = [p, { ...newPanel('Plain'), inTheRound: true }];
  return project;
}
