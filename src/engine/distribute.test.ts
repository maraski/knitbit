import { describe, expect, it } from 'vitest';
import {
  describeSchedule,
  distributeAcross,
  distributeAuto,
  distributeFixed,
  distributeMixed,
  eventsForChange,
  placeIntervals,
  runningCounts,
  splitEvenly,
} from './distribute';

const diffs = (rows: number[]) => rows.slice(1).map((r, i) => r - rows[i]);

describe('splitEvenly', () => {
  it('splits with remainder spread out', () => {
    const s = splitEvenly(22, 5);
    expect(s.reduce((a, b) => a + b, 0)).toBe(22);
    expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
    expect(s).toEqual([4, 5, 4, 5, 4]);
  });
  it('groups when asked', () => {
    expect(splitEvenly(22, 5, 'shortFirst')).toEqual([4, 4, 4, 5, 5]);
    expect(splitEvenly(22, 5, 'longFirst')).toEqual([5, 5, 4, 4, 4]);
  });
  it('handles exact division and n=0', () => {
    expect(splitEvenly(20, 5)).toEqual([4, 4, 4, 4, 4]);
    expect(splitEvenly(20, 0)).toEqual([]);
  });
});

describe('distributeAuto', () => {
  it('spreads evenly on any row, ending on the last row', () => {
    const s = distributeAuto(5, { from: 1, to: 40 });
    expect(s.rows).toEqual([8, 16, 24, 32, 40]);
    expect(s.feasible).toBe(true);
    expect(describeSchedule(s)).toBe('row 8, then every 8th row ×4');
  });

  it('keeps events on RS rows and mixes rhythms when needed', () => {
    const s = distributeAuto(6, { from: 1, to: 50 }, { side: 'rs' });
    expect(s.rows.every((r) => r % 2 === 1)).toBe(true);
    expect(s.rows[s.rows.length - 1]).toBe(49);
    const d = diffs(s.rows);
    expect(new Set(d)).toEqual(new Set([8, 10]));
    expect(Math.max(...d) - Math.min(...d)).toBe(2);
  });

  it('supports start and center alignment', () => {
    expect(distributeAuto(5, { from: 1, to: 40 }, { side: 'rs', align: 'start' }).rows).toEqual([1, 9, 17, 25, 33]);
    const c = distributeAuto(5, { from: 1, to: 40 }, { side: 'rs', align: 'center' });
    expect(c.rows.every((r) => r % 2 === 1)).toBe(true);
    expect(Math.abs(c.leadRows - c.trailRows)).toBeLessThanOrEqual(2);
  });

  it('works for spans not starting at row 1 and on WS rows', () => {
    const s = distributeAuto(4, { from: 31, to: 60 }, { side: 'ws' });
    expect(s.rows.every((r) => r % 2 === 0 && r >= 31 && r <= 60)).toBe(true);
    expect(s.rows).toHaveLength(4);
  });

  it('flags spans that are too short', () => {
    const s = distributeAuto(12, { from: 1, to: 20 }, { side: 'rs' });
    expect(s.feasible).toBe(false);
    expect(s.rows).toHaveLength(10);
    expect(s.warnings[0]).toMatch(/Needs 12 shaping rows but only 10 RS rows/);
  });

  it('uses every eligible row when n equals the slots', () => {
    expect(distributeAuto(5, { from: 1, to: 10 }, { side: 'rs' }).rows).toEqual([1, 3, 5, 7, 9]);
  });

  it('returns nothing for zero events', () => {
    expect(distributeAuto(0, { from: 1, to: 10 }).rows).toEqual([]);
  });
});

describe('distributeFixed', () => {
  it('places every 4th row, ending at the end of the span', () => {
    const s = distributeFixed(5, 4, { from: 1, to: 30 }, { side: 'rs' });
    expect(diffs(s.rows)).toEqual([4, 4, 4, 4]);
    expect(s.rows[4]).toBe(29);
    expect(s.feasible).toBe(true);
  });

  it('reports when the rhythm does not fit', () => {
    const s = distributeFixed(10, 4, { from: 1, to: 20 }, { side: 'rs' });
    expect(s.feasible).toBe(false);
    expect(s.rows).toHaveLength(5);
    expect(s.warnings[0]).toMatch(/fits only 5 of 10/);
  });

  it('falls back to any row for odd rhythms', () => {
    const s = distributeFixed(3, 3, { from: 1, to: 12 }, { side: 'rs' });
    expect(s.warnings[0]).toMatch(/alternates RS and WS/);
    expect(diffs(s.rows)).toEqual([3, 3]);
  });
});

describe('distributeMixed', () => {
  it('uses as many long intervals as fit', () => {
    // 6 events in 32 rows (RS only): 4th and 6th row rhythm.
    const s = distributeMixed(6, 4, 6, { from: 1, to: 32 }, { side: 'rs' });
    expect(s.feasible).toBe(true);
    expect(s.rows.every((r) => r % 2 === 1 && r <= 32)).toBe(true);
    const d = diffs(s.rows);
    expect(d.every((x) => x === 4 || x === 6)).toBe(true);
    expect(d.filter((x) => x === 6).length).toBeGreaterThanOrEqual(3);
  });

  it('groups short intervals first when asked', () => {
    const s = distributeMixed(5, 4, 6, { from: 1, to: 28 }, { side: 'rs', order: 'shortFirst' });
    const d = diffs(s.rows);
    expect(d).toEqual([...d].sort((a, b) => a - b));
  });
});

describe('placeIntervals', () => {
  it('returns null when the block cannot fit', () => {
    expect(placeIntervals([10, 10, 10], { from: 1, to: 15 })).toBeNull();
  });
});

describe('eventsForChange', () => {
  it('splits an even change over both edges', () => {
    const p = eventsForChange(-12);
    expect(p.events).toHaveLength(6);
    expect(p.events.every((e) => e.left === -1 && e.right === -1)).toBe(true);
    expect(p.warnings).toEqual([]);
  });

  it('warns on an odd change and keeps the total', () => {
    const p = eventsForChange(7);
    expect(p.events).toHaveLength(4);
    expect(p.events.reduce((s, e) => s + e.left + e.right, 0)).toBe(7);
    expect(p.warnings[0]).toMatch(/left edge gets 1 more increase/);
  });

  it('handles single-sided and multi-stitch events', () => {
    expect(eventsForChange(-3, 'right').events).toEqual([{ left: 0, right: -1 }, { left: 0, right: -1 }, { left: 0, right: -1 }]);
    expect(eventsForChange(-8, 'both', 2).events).toHaveLength(2);
  });
});

describe('runningCounts', () => {
  it('tracks the stitch count row by row', () => {
    const c = runningCounts(100, [{ row: 2, delta: -2 }, { row: 4, delta: -2 }, { row: 4, delta: 1 }], 1, 5);
    expect(c.map((x) => x.count)).toEqual([100, 98, 98, 97, 97]);
  });
});

describe('distributeAcross', () => {
  it('spaces changes evenly with half-spaces at the ends', () => {
    expect(distributeAcross(100, 4)).toEqual([12, 37, 62, 87]);
    expect(distributeAcross(10, 0)).toEqual([]);
  });
});
