import { describe, expect, it } from 'vitest';
import { cmToIn, formatLength, fromDisplay, inToCm, parseLength, roundTo, toDisplay } from './units';

describe('units', () => {
  it('converts cm and inches both ways', () => {
    expect(inToCm(1)).toBe(2.54);
    expect(cmToIn(25.4)).toBeCloseTo(10, 10);
    expect(cmToIn(inToCm(17.25))).toBeCloseTo(17.25, 10);
  });

  it('display/input round-trips through internal cm', () => {
    expect(toDisplay(10, 'metric')).toBe(10);
    expect(toDisplay(10.16, 'imperial')).toBeCloseTo(4, 10);
    expect(fromDisplay(4, 'imperial')).toBeCloseTo(10.16, 10);
    expect(fromDisplay(toDisplay(114.5, 'imperial'), 'imperial')).toBeCloseTo(114.5, 10);
  });

  it('formats with decimals, not fractions, and trims zeros', () => {
    expect(formatLength(38.25, 'metric')).toBe('38.25 cm');
    expect(formatLength(45.721, 'metric')).toBe('45.72 cm');
    expect(formatLength(45.72, 'imperial')).toBe('18 in');
    expect(formatLength(114.5, 'imperial')).toBe('45.08 in');
    expect(formatLength(40, 'metric', { withUnit: false })).toBe('40');
  });

  it('rounds without float noise', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
  });

  it('parses typed lengths', () => {
    expect(parseLength('12,5', 'metric')).toBe(12.5);
    expect(parseLength('2', 'imperial')).toBe(5.08);
    expect(parseLength('', 'metric')).toBeNull();
    expect(parseLength('abc', 'metric')).toBeNull();
  });
});
