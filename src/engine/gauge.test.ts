import { describe, expect, it } from 'vitest';
import { cmToRows, cmToStitches, convertGauge, rowsToCm, rowStitchRatio, stitchesPerCm, stitchesToCm, validateGauge, type Gauge } from './gauge';

const metric: Gauge = { stitches: 22, rows: 30, basis: '10cm' };
const imperial: Gauge = { stitches: 20, rows: 28, basis: '4in' };

describe('gauge', () => {
  it('converts widths and heights to raw counts', () => {
    expect(stitchesPerCm(metric)).toBeCloseTo(2.2, 10);
    expect(cmToStitches(52, metric)).toBeCloseTo(114.4, 10);
    expect(cmToRows(20, metric)).toBeCloseTo(60, 10);
    expect(stitchesToCm(110, metric)).toBeCloseTo(50, 10);
    expect(rowsToCm(60, metric)).toBeCloseTo(20, 10);
  });

  it('uses 10.16 cm for a 4 in swatch', () => {
    expect(cmToStitches(10.16, imperial)).toBeCloseTo(20, 10);
    expect(cmToRows(inToCmLocal(8), imperial)).toBeCloseTo(56, 10);
  });

  it('re-expresses a gauge over another basis without changing it', () => {
    const g = convertGauge(metric, '4in');
    expect(g.stitches).toBeCloseTo(22.352, 3);
    expect(cmToStitches(37, g)).toBeCloseTo(cmToStitches(37, metric), 10);
    expect(convertGauge(g, '10cm').stitches).toBeCloseTo(22, 10);
  });

  it('gives the rows-per-stitch ratio', () => {
    expect(rowStitchRatio(metric)).toBeCloseTo(30 / 22, 10);
  });

  it('validates', () => {
    expect(validateGauge(metric)).toEqual([]);
    expect(validateGauge({ stitches: 0, rows: -1, basis: '10cm' })).toHaveLength(2);
  });
});

function inToCmLocal(i: number) {
  return i * 2.54;
}
