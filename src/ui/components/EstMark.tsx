import type { Project, Size } from '../../engine/model';
import { REGIONS, regionSources } from '../../engine/regions';

export const EST_TITLE = 'Estimated row: the sizing table marks this size as estimated, not measured.';

/** A subtle mark after the name of a size whose sizing-table row is estimated. */
export function EstMark({ size }: { size: Size }) {
  return size.estimated ? <sup className="est-size" title={EST_TITLE}>est</sup> : null;
}

/** Regions of a size that follow other sizes, e.g. "lower L, sleeves S" (empty when none). */
export function regionMix(project: Project, size: Size): string {
  const src = regionSources(project, size.id);
  const name = (id: string) => project.sizes.find((s) => s.id === id)?.name ?? '?';
  return REGIONS.filter((r) => src[r.id] !== size.id).map((r) => `${r.short} ${name(src[r.id])}`).join(', ');
}

/** A size name with its marks: estimated row, custom size, and region mix (e.g. M · lower L). */
export function SizeName({ project, size }: { project: Project; size: Size }) {
  const mix = regionMix(project, size);
  return (
    <>
      {size.name}
      <EstMark size={size} />
      {size.custom && <sup className="est-size" title={`Custom size, seeded from ${size.custom.seededFrom}`}>custom</sup>}
      {mix && <span className="size-mix" title="Region sizing: these regions take their measurements from other sizes"> · {mix}</span>}
    </>
  );
}

/** Plain-text size name for <option>s and SVG text, which can't hold markup. */
export function sizeText(size: Size, project?: Project): string {
  const mix = project ? regionMix(project, size) : '';
  return `${size.name}${size.estimated ? ' (est.)' : ''}${size.custom ? ' (custom)' : ''}${mix ? ` · ${mix}` : ''}`;
}
