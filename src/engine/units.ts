// Length units. Everything is stored internally in centimetres;
// conversion happens only at the display/input boundary.

export type Units = 'metric' | 'imperial';

export const CM_PER_INCH = 2.54;

export function cmToIn(cm: number): number {
  return cm / CM_PER_INCH;
}

export function inToCm(inches: number): number {
  return inches * CM_PER_INCH;
}

/** Convert an internal cm value to the number shown in the given units. */
export function toDisplay(cm: number, units: Units): number {
  return units === 'metric' ? cm : cmToIn(cm);
}

/** Convert a number typed in the given units to internal cm. */
export function fromDisplay(value: number, units: Units): number {
  return units === 'metric' ? value : inToCm(value);
}

export function unitLabel(units: Units): string {
  return units === 'metric' ? 'cm' : 'in';
}

/** Default display precision: 0.01 cm (sizing tables use quarter cm) or 0.01 in. Trailing zeros are dropped. */
export function defaultDecimals(_units: Units): number {
  return 2;
}

/** Round to a number of decimals, avoiding binary noise like 12.300000000000001. */
export function roundTo(value: number, decimals: number): number {
  // Shift via exponent notation so 1.005 → 1.01 (multiplying by 100 would give 100.49999…).
  if (!Number.isFinite(value) || String(value).includes('e')) return Math.round(value * 10 ** decimals) / 10 ** decimals;
  const shifted = Math.round(Number(`${value}e${decimals}`));
  return Number(`${shifted}e${-decimals}`);
}

/** Format a cm value for display, e.g. "38.25 cm" or "18 in". Trailing zeros are dropped. */
export function formatLength(
  cm: number,
  units: Units,
  opts: { decimals?: number; withUnit?: boolean } = {},
): string {
  const decimals = opts.decimals ?? defaultDecimals(units);
  const n = roundTo(toDisplay(cm, units), decimals);
  const text = stripZeros(n.toFixed(decimals));
  return opts.withUnit === false ? text : `${text} ${unitLabel(units)}`;
}

function stripZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Parse a user-typed length in the given units. Returns cm, or null if not a number. */
export function parseLength(text: string, units: Units): number | null {
  const n = Number(text.trim().replace(',', '.'));
  return Number.isFinite(n) && text.trim() !== '' ? fromDisplay(n, units) : null;
}
