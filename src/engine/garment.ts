// Project-level garment options: construction (panels / contiguous top-down) and front opening (closed /
// cardigan), the tags they add, the credit line exports carry, and the schema 2 → 3 migration.

import type { Construction, FrontOpening, GarmentOptions, Project } from './model';

export const CONSTRUCTIONS: { id: Construction; label: string; description: string }[] = [
  { id: 'panels', label: 'Panels', description: 'Panels as you draw them (the original behaviour).' },
  {
    id: 'contiguous',
    label: 'Contiguous, top-down',
    description: 'A top-down yoke with set-in-look sleeves, worked in one piece from the back neck (contiguous method by Susie Myers). It generates ordinary, editable panels.',
  },
];

export const OPENINGS: { id: FrontOpening; label: string; description: string }[] = [
  { id: 'closed', label: 'Closed / pullover', description: 'No front opening.' },
  { id: 'cardigan', label: 'Cardigan', description: 'Opens at centre front; fronts, bands and (by default) sleeves are worked flat.' },
];

export const DEFAULT_GARMENT: GarmentOptions = { construction: 'panels', opening: 'closed' };

/** Tag added while the construction is contiguous. */
export const CONTIGUOUS_TAG = 'contiguous';

/** Credit for the contiguous method; goes in the footer of PDF and PNG exports (Project → export credit). */
export const CONTIGUOUS_CREDIT =
  'This garment is worked seamlessly from the top-down using the contiguous sleeve method developed by Susie Myers, SusieM on Ravelry (http://www.ravelry.com/people/SusieM)';

/** Tags a construction adds (and removes again when you switch away from it). */
const CONSTRUCTION_TAGS: Record<Construction, string[]> = { panels: [], contiguous: [CONTIGUOUS_TAG] };

export function setConstruction(p: Project, construction: Construction): Project {
  if (p.garment.construction === construction) return p;
  const drop = new Set(CONSTRUCTION_TAGS[p.garment.construction]);
  const tags = p.tags.filter((t) => !drop.has(t));
  for (const t of CONSTRUCTION_TAGS[construction]) if (!tags.includes(t)) tags.push(t);
  return { ...p, garment: { ...p.garment, construction }, tags };
}

export function setOpening(p: Project, opening: FrontOpening): Project {
  if (p.garment.opening === opening) return p;
  return { ...p, garment: { ...p.garment, opening } };
}

/** Tags from free text: comma separated, trimmed, lower case, no duplicates or blanks. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const t of text.split(',').map((x) => x.trim().toLowerCase())) if (t && !out.includes(t)) out.push(t);
  return out;
}

/** Lines for the footer of an export (empty when there is nothing to credit or the credit is switched off). */
export function exportFooter(p: Pick<Project, 'garment' | 'settings'>): string[] {
  if (p.settings.exportCredit === false) return [];
  return p.garment.construction === 'contiguous' ? [CONTIGUOUS_CREDIT] : [];
}

/** Schema 2 → 3: garment options (construction, front opening) and project tags. The export credit defaults to on. */
export function migrateV2toV3(raw: any, notes: string[]): any {
  const p = { ...raw };
  if (p.garment === undefined) {
    p.garment = { ...DEFAULT_GARMENT };
    notes.push('Construction set to Panels and front opening to Closed / pullover (how the project was built so far).');
  }
  if (p.tags === undefined) {
    p.tags = [];
    notes.push('Added an empty tag list.');
  }
  return p;
}
