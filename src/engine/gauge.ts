// Gauge: stitches and rows over a swatch width of 10 cm or 4 in.
// Stored as entered (so the UI can show exactly what was typed), converted to per-cm for math.

import { inToCm } from './units';

export type GaugeBasis = '10cm' | '4in';

export interface Gauge {
  stitches: number; // stitches over the basis length
  rows: number; // rows over the basis length
  basis: GaugeBasis;
}

export function basisLengthCm(basis: GaugeBasis): number {
  return basis === '10cm' ? 10 : inToCm(4); // 10.16 cm
}

export function stitchesPerCm(g: Gauge): number {
  return g.stitches / basisLengthCm(g.basis);
}

export function rowsPerCm(g: Gauge): number {
  return g.rows / basisLengthCm(g.basis);
}

/** Re-express a gauge over a different basis (e.g. 22 sts / 10 cm → 22.35 sts / 4 in). */
export function convertGauge(g: Gauge, basis: GaugeBasis): Gauge {
  if (g.basis === basis) return { ...g };
  const k = basisLengthCm(basis) / basisLengthCm(g.basis);
  return { stitches: g.stitches * k, rows: g.rows * k, basis };
}

/** Raw (unrounded) stitch count for a width in cm. */
export function cmToStitches(cm: number, g: Gauge): number {
  return cm * stitchesPerCm(g);
}

/** Raw (unrounded) row count for a height in cm. */
export function cmToRows(cm: number, g: Gauge): number {
  return cm * rowsPerCm(g);
}

export function stitchesToCm(sts: number, g: Gauge): number {
  return sts / stitchesPerCm(g);
}

export function rowsToCm(rows: number, g: Gauge): number {
  return rows / rowsPerCm(g);
}

/** Row-to-stitch ratio (rows per stitch). Used e.g. for pick-up ratios and chart cell aspect. */
export function rowStitchRatio(g: Gauge): number {
  return rowsPerCm(g) / stitchesPerCm(g);
}

export function validateGauge(g: Gauge): string[] {
  const errors: string[] = [];
  if (!(g.stitches > 0)) errors.push('Gauge stitches must be greater than 0.');
  if (!(g.rows > 0)) errors.push('Gauge rows must be greater than 0.');
  return errors;
}
