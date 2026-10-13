import type { Size } from '../../engine/model';

export const EST_TITLE = 'Estimated row: the sizing table marks this size as estimated, not measured.';

/** A subtle mark after the name of a size whose sizing-table row is estimated. */
export function EstMark({ size }: { size: Size }) {
  return size.estimated ? <sup className="est-size" title={EST_TITLE}>est</sup> : null;
}

/** Plain-text size name for <option>s, which can't hold markup. */
export function sizeText(size: Size): string {
  return size.estimated ? `${size.name} (est.)` : size.name;
}
