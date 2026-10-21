// The shipped sample: a project seeded from the Ysolda sizing table, and merging that table into an older project.
// Loaded on demand (first run, New garment, the migration notice's merge) so the seeding and import code stay out of the
// main chunk.

import { parseCsv } from '../engine/csv';
import type { Project } from '../engine/model';
import { projectFromTable } from '../engine/seed';
import { applyImport, describeReport, suggestMapping } from '../engine/sizing';
import { bodice, sleeve } from '../engine/templates';
import sampleCsv from '../../samples/sizing_table_ysolda_cm.csv?raw';

/** The shipped sizing table as a project with no pieces yet (first run, New garment). */
export function sampleTable(name = 'My top'): Project {
  return projectFromTable(parseCsv(sampleCsv), name).project;
}

export function sampleProject(): Project {
  const p = sampleTable();
  p.panels = [bodice('back'), bodice('front'), sleeve('set-in')];
  return p;
}

/** Merge the shipped sizing table into a project by size name (exact column names; legacy columns ignored). */
export function mergeSampleTable(p: Project): { project: Project; summary: string[] } {
  const table = parseCsv(sampleCsv);
  const { project, report } = applyImport(p, table, suggestMapping(table, p), { units: 'cm', mode: 'merge' });
  return { project, summary: describeReport(report) };
}
