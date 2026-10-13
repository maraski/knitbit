import { describe, expect, it } from 'vitest';
import { nearestOfMultiple, roundNearest, roundRows, roundStitches } from './rounding';

describe('rounding', () => {
  it('rounds to the nearest stitch and records it', () => {
    const r = roundStitches(114.4);
    expect(r.value).toBe(114);
    expect(r.steps).toEqual([expect.objectContaining({ rule: 'nearest', from: 114.4, to: 114 })]);
  });

  it('records nothing when the count is already whole', () => {
    expect(roundStitches(100).steps).toEqual([]);
  });

  it('rounds halves up, tolerating float noise', () => {
    expect(roundNearest(22.5)).toBe(23);
    expect(roundNearest(22.499999999999)).toBe(23);
    expect(roundNearest(-2.5)).toBe(-3);
  });

  it('snaps to a pattern multiple (+offset)', () => {
    expect(nearestOfMultiple(113, 4)).toBe(112);
    expect(nearestOfMultiple(114, 4)).toBe(116); // tie goes up
    expect(nearestOfMultiple(113, 4, 2)).toBe(114);
    const r = roundStitches(113.2, { multiple: 8 });
    expect(r.value).toBe(112);
    expect(r.steps.map((s) => s.rule)).toEqual(['nearest', 'multiple']);
  });

  it('adds selvedges after the multiple', () => {
    const r = roundStitches(101, { multiple: 4, selvedge: 2 });
    expect(r.value).toBe(102); // 100 + 2
    expect(r.steps.map((s) => s.rule)).toEqual(['multiple', 'selvedge']);
  });

  it('fixes parity toward the raw target', () => {
    expect(roundStitches(114.4, { parity: 'odd' }).value).toBe(115);
    expect(roundStitches(113.6, { parity: 'odd' }).value).toBe(113);
    expect(roundStitches(113.6, { parity: 'even' }).value).toBe(114);
  });

  it('warns when parity conflicts with an even multiple', () => {
    const r = roundStitches(100, { multiple: 4, parity: 'odd' });
    expect(r.value).toBe(100);
    expect(r.warnings[0]).toMatch(/Cannot make the count odd/);
  });

  it('can fix parity with an odd multiple', () => {
    const r = roundStitches(100, { multiple: 3, offset: 1, parity: 'odd' }); // 100 = 3*33+1, even
    expect(r.value % 2).toBe(1);
    expect((r.value - 1) % 3).toBe(0);
  });

  it('rounds rows with optional parity', () => {
    expect(roundRows(59.6).value).toBe(60);
    expect(roundRows(59.6, 'odd').value).toBe(59);
    expect(roundRows(60.2, 'odd').value).toBe(61);
    expect(roundRows(59.4, 'odd').value).toBe(59);
  });
});
