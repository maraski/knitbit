// Sleeve lengths: cap, short, elbow, three-quarter or long, for any sleeve that runs from a cuff up to an underarm
// (set-in, drop shoulder, straight, contiguous; raglan can use the same list). The length sets the underarm's height
// above the cuff and the cuff's width, read off a straight taper from the underarm width (bicep) to the long sleeve's
// cuff (wrist) at that length. A cap sleeve has no underarm length: just the cuff band, then the cap.

import { dim, type Panel, type SleeveLength } from './model';

export const SLEEVE_LENGTHS: { id: SleeveLength; label: string; prefix: string }[] = [
  { id: 'cap', label: 'Cap', prefix: 'Cap' },
  { id: 'short', label: 'Short', prefix: 'Short' },
  { id: 'elbow', label: 'Elbow', prefix: 'Elbow' },
  { id: 'three-quarter', label: 'Three-quarter', prefix: 'Three-quarter' },
  { id: 'long', label: 'Long', prefix: '' },
];

/** The measurement each length uses for underarm → cuff (cm); seeded as estimates where the table lacks them. */
export const SLEEVE_LENGTH_NAMES: Record<Exclude<SleeveLength, 'cap'>, string> = {
  short: 'short_sleeve_length',
  elbow: 'elbow_length',
  'three-quarter': 'three_quarter_length',
  long: 'arm_length',
};

/** Estimated measurements a length needs (none for long and cap). */
export function sleeveLengthNeeds(length: SleeveLength = 'long'): string[] {
  return length === 'long' || length === 'cap' ? [] : [SLEEVE_LENGTH_NAMES[length]];
}

export const sleeveLengthOf = (p: Panel): SleeveLength => p.sleeveLength ?? 'long';

/** Underarm height above the cuff. A cap sleeve: the cuff band knit with the sleeve, or 2 rows without one. */
export function sleeveHeightExpr(length: SleeveLength): string {
  return length === 'cap' ? 'max(cuff_depth, 2 * row_h)' : SLEEVE_LENGTH_NAMES[length];
}

/**
 * Cuff width at `length`: the long cuff for long sleeves, the underarm width for a cap, otherwise the straight taper
 * from the underarm (`top`, a waypoint key) to the long cuff, `length / arm_length` of the way down.
 */
export function cuffWidthExpr(length: SleeveLength, top: string, longCuff: string): string {
  if (length === 'long') return longCuff;
  if (length === 'cap') return `${top}.width`;
  return `${top}.width + (${longCuff} - ${top}.width) * ${SLEEVE_LENGTH_NAMES[length]} / arm_length`;
}

/** "Short sleeve (drop shoulder)" from "Sleeve (drop shoulder)". */
export function sleeveName(base: string, length: SleeveLength): string {
  const prefix = SLEEVE_LENGTHS.find((l) => l.id === length)!.prefix;
  return prefix ? `${prefix} ${base.charAt(0).toLowerCase()}${base.slice(1)}` : base;
}

/** The waypoint a sleeve's length is measured to: its underarm (set-in, contiguous), else its top (drop, straight). */
function topWaypoint(p: Panel) {
  return p.waypoints.find((w) => w.name === 'underarm') ?? p.waypoints.find((w) => w.name === 'top');
}

/** Long cuff width of a sleeve template: wrist + ease, except a straight sleeve, which keeps one width. */
function longCuff(p: Panel, top: string): string {
  return p.template === 'sleeve-straight' ? `${top}.width` : 'wrist + ease.wrist';
}

/**
 * The sleeve at another length: its underarm height and cuff width set from the length (other edits kept). Null when
 * the sleeve has no `cuff` waypoint under an `underarm` / `top` one to set (renamed or redrawn by hand).
 */
export function withSleeveLength(p: Panel, length: SleeveLength): Panel | null {
  const cuff = p.waypoints[0];
  const top = topWaypoint(p);
  if (!cuff || cuff.name !== 'cuff' || !top || top === cuff) return null;
  const width = cuffWidthExpr(length, top.name, longCuff(p, top.name));
  const waypoints = p.waypoints.map((w) => {
    if (w.id === top.id) return { ...w, height: dim(sleeveHeightExpr(length)) };
    if (w.id === cuff.id) return { ...w, symmetric: true, width: dim(width), left: dim(`(${width}) / 2`), right: dim(`(${width}) / 2`) };
    return w;
  });
  const next: Panel = { ...p, waypoints };
  if (length === 'long') delete next.sleeveLength;
  else next.sleeveLength = length;
  return next;
}
