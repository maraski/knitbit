// Region sizing: upper body, lower body and sleeves may take their measurements from different sizes.
// Off unless the project turns it on; then each size says, per region, which size it follows (default itself).

import { dictionaryEntry } from './dictionary';
import type { BodyRegion, Id, Measurement, Project, Size } from './model';

export const REGIONS: { id: BodyRegion; label: string; short: string }[] = [
  { id: 'upper', label: 'Upper body', short: 'upper' },
  { id: 'lower', label: 'Lower body', short: 'lower' },
  { id: 'sleeves', label: 'Sleeves', short: 'sleeves' },
];

/** The region a measurement belongs to: its own setting, else the dictionary's, else upper body. */
export function regionOf(m: Pick<Measurement, 'name' | 'region'>): BodyRegion {
  return m.region ?? dictionaryEntry(m.name)?.region ?? 'upper';
}

export function regionSizingOn(project: Pick<Project, 'settings'>): boolean {
  return !!project.settings?.regionSizing;
}

/** Which size each region of `sizeId` follows (itself when region sizing is off or the region isn't set). */
export function regionSources(project: Pick<Project, 'settings' | 'sizes'>, sizeId: Id): Record<BodyRegion, Id> {
  const size = project.sizes.find((s) => s.id === sizeId);
  const on = regionSizingOn(project);
  const pick = (r: BodyRegion) => {
    const id = on ? size?.regions?.[r] : undefined;
    return id && id !== sizeId && project.sizes.some((s) => s.id === id) ? id : sizeId;
  };
  return { upper: pick('upper'), lower: pick('lower'), sleeves: pick('sleeves') };
}

/** True when some region of this size follows another size. */
export function isMixed(project: Pick<Project, 'settings' | 'sizes'>, sizeId: Id): boolean {
  const src = regionSources(project, sizeId);
  return REGIONS.some((r) => src[r.id] !== sizeId);
}

/** e.g. "M", "M (lower L)", "M (upper S, sleeves L)". Custom sizes say what they were seeded from. */
export function sizeLabel(project: Pick<Project, 'settings' | 'sizes'>, size: Size): string {
  const src = regionSources(project, size.id);
  const name = (id: Id) => project.sizes.find((s) => s.id === id)?.name ?? '?';
  const parts = REGIONS.filter((r) => src[r.id] !== size.id).map((r) => `${r.short} ${name(src[r.id])}`);
  return parts.length ? `${size.name} (${parts.join(', ')})` : size.name;
}

/** Table sizes only (no custom sizes), in order: the scale for "how many sizes apart". */
export function tableSizes(project: Pick<Project, 'sizes'>): Size[] {
  return project.sizes.filter((s) => !s.custom);
}

/**
 * How many table sizes apart two sizes are. A custom size counts as the row it was seeded from.
 * Null when either can't be placed on the table.
 */
export function sizesApart(project: Pick<Project, 'sizes'>, a: Id, b: Id): number | null {
  const rows = tableSizes(project);
  const pos = (id: Id) => {
    const s = project.sizes.find((x) => x.id === id);
    if (!s) return -1;
    const name = s.custom?.seededFrom ?? s.name;
    return rows.findIndex((x) => x.name === name);
  };
  const i = pos(a);
  const j = pos(b);
  return i < 0 || j < 0 ? null : Math.abs(i - j);
}
