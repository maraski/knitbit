// Spreading shaping (increases / decreases) over a span of rows, and across a row.
// Pure functions: rows are absolute row numbers in the panel (row 1 = first row after cast-on).

export interface RowSpan {
  from: number; // first row shaping may occur on (inclusive)
  to: number; // last row shaping may occur on (inclusive)
}

/** Which rows may carry shaping. 'rs' = odd rows (row 1 is RS), 'ws' = even rows. In the round use 'any'. */
export type RowSide = 'any' | 'rs' | 'ws';

/** Where leftover plain rows go: before the first event ('end'), after the last ('start'), or split ('center'). */
export type Align = 'end' | 'start' | 'center';

/** How unequal intervals are ordered: interleaved as evenly as possible, or grouped. */
export type IntervalOrder = 'spread' | 'shortFirst' | 'longFirst';

export interface DistributeOptions {
  side?: RowSide;
  align?: Align;
  order?: IntervalOrder;
}

export interface IntervalGroup {
  every: number; // rows between consecutive events
  times: number;
}

export interface ShapingSchedule {
  rows: number[]; // absolute rows carrying an event, ascending
  groups: IntervalGroup[]; // run-length summary of the intervals between consecutive events
  leadRows: number; // plain rows in the span before the first event
  trailRows: number; // plain rows in the span after the last event
  requested: number;
  feasible: boolean; // false when not every requested event could be placed
  warnings: string[];
}

export function spanLength(span: RowSpan): number {
  return Math.max(0, span.to - span.from + 1);
}

export function rowMatchesSide(row: number, side: RowSide): boolean {
  if (side === 'any') return true;
  const odd = row % 2 !== 0;
  return side === 'rs' ? odd : !odd;
}

export function eligibleRows(span: RowSpan, side: RowSide = 'any'): number[] {
  const out: number[] = [];
  for (let r = span.from; r <= span.to; r++) if (rowMatchesSide(r, side)) out.push(r);
  return out;
}

/**
 * Split `total` units into `n` intervals that differ by at most 1, ordered as requested.
 * e.g. 22 into 5 → [4,5,4,5,4] (spread) or [4,4,4,5,5] (shortFirst).
 */
export function splitEvenly(total: number, n: number, order: IntervalOrder = 'spread'): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const rem = total - base * n;
  if (order === 'shortFirst') return [...Array(n - rem).fill(base), ...Array(rem).fill(base + 1)];
  if (order === 'longFirst') return [...Array(rem).fill(base + 1), ...Array(n - rem).fill(base)];
  // Bresenham: long intervals as evenly interleaved as possible, symmetric where it can be.
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const long = Math.floor(((i + 1) * rem + n / 2) / n) - Math.floor((i * rem + n / 2) / n);
    out.push(base + long);
  }
  return out;
}

/**
 * Place events separated by the given row intervals inside the span.
 * Intervals[0] is measured from the row before the span; the block is then slid
 * according to `align`, keeping events on the requested side (RS/WS).
 */
export function placeIntervals(intervals: number[], span: RowSpan, side: RowSide = 'any', align: Align = 'end'): number[] | null {
  if (intervals.length === 0) return [];
  const pos: number[] = [];
  let r = span.from - 1;
  for (const iv of intervals) {
    r += iv;
    pos.push(r);
  }
  const lead = pos[0] - span.from;
  const trail = span.to - pos[pos.length - 1];
  const slack = lead + trail;
  if (slack < 0) return null;
  const wantLead = align === 'start' ? 0 : align === 'end' ? slack : Math.floor(slack / 2);
  // Nudge by up to 2 rows to land on the right side; prefer the closest, then the most balanced.
  let best: { moved: number[]; score: number } | null = null;
  for (let d = -2; d <= 2; d++) {
    const moved = pos.map((p) => p + wantLead - lead + d);
    if (moved[0] < span.from || moved[moved.length - 1] > span.to || !moved.every((p) => rowMatchesSide(p, side))) continue;
    const balance = Math.abs(moved[0] - span.from - (span.to - moved[moved.length - 1]));
    const score = Math.abs(d) * 1000 + (align === 'center' ? balance : 0);
    if (!best || score < best.score) best = { moved, score };
  }
  if (best) return best.moved;
  return null;
}

function summarize(rows: number[]): IntervalGroup[] {
  const groups: IntervalGroup[] = [];
  for (let i = 1; i < rows.length; i++) {
    const every = rows[i] - rows[i - 1];
    const last = groups[groups.length - 1];
    if (last && last.every === every) last.times++;
    else groups.push({ every, times: 1 });
  }
  return groups;
}

function schedule(rows: number[], span: RowSpan, requested: number, warnings: string[]): ShapingSchedule {
  return {
    rows,
    groups: summarize(rows),
    leadRows: rows.length ? rows[0] - span.from : spanLength(span),
    trailRows: rows.length ? span.to - rows[rows.length - 1] : 0,
    requested,
    feasible: rows.length === requested,
    warnings,
  };
}

/**
 * Auto-suggest: spread `n` events over the span as evenly as possible.
 * With side 'rs' this naturally yields mixed rhythms such as "every 4th and 6th row".
 */
export function distributeAuto(n: number, span: RowSpan, opts: DistributeOptions = {}): ShapingSchedule {
  const side = opts.side ?? 'any';
  const warnings: string[] = [];
  if (n <= 0) return schedule([], span, 0, warnings);
  const slots = eligibleRows(span, side);
  const step = side === 'any' ? 1 : 2;
  if (slots.length === 0) {
    warnings.push(`No ${sideName(side)} rows available between rows ${span.from} and ${span.to}.`);
    return schedule([], span, n, warnings);
  }
  if (n > slots.length) {
    warnings.push(
      `Needs ${n} shaping rows but only ${slots.length} ${sideName(side)} rows are available (rows ${span.from}–${span.to}). ` +
        `Shaped every ${side === 'any' ? '' : 'other '}row; ${n - slots.length} event(s) are missing.`,
    );
    return schedule(slots, span, n, warnings);
  }
  // Work in "slot" units (eligible rows), then convert back to rows.
  const firstSlotOffset = slots[0] - span.from; // 0 or 1 when restricted to one side
  const slotIntervals = splitEvenly(slots.length, n, opts.order);
  const rowIntervals = slotIntervals.map((s) => s * step);
  const placed = placeIntervals(rowIntervals, { from: span.from + firstSlotOffset, to: span.to }, side, opts.align ?? 'end');
  const rows = placed ?? slots.slice(-n);
  return schedule(rows, span, n, warnings);
}

/** Fixed rhythm: one event every `every` rows (e.g. every 4th row). */
export function distributeFixed(n: number, every: number, span: RowSpan, opts: DistributeOptions = {}): ShapingSchedule {
  const side = opts.side ?? 'any';
  const warnings: string[] = [];
  if (n <= 0) return schedule([], span, 0, warnings);
  if (every < 1) {
    warnings.push('Rhythm must be at least every row.');
    return schedule([], span, n, warnings);
  }
  if (side !== 'any' && every % 2 !== 0) {
    const r = distributeFixed(n, every, span, { ...opts, side: 'any' });
    return { ...r, warnings: [`Every ${ordinal(every)} row alternates RS and WS rows; shaping is allowed on any row.`, ...r.warnings] };
  }
  for (let count = n; count > 0; count--) {
    const rows = placeIntervals(Array(count).fill(every), span, side, opts.align ?? 'end');
    if (rows) {
      if (count < n) warnings.push(`Every ${ordinal(every)} row fits only ${count} of ${n} events in ${spanLength(span)} rows.`);
      return schedule(rows, span, n, warnings);
    }
  }
  warnings.push(`Every ${ordinal(every)} row fits none of the ${n} events in ${spanLength(span)} rows.`);
  return schedule([], span, n, warnings);
}

/**
 * Mixed rhythm: use two intervals a < b (e.g. every 4th and 6th row), as many long ones as fit,
 * so the shaping fills the span without overrunning it.
 */
export function distributeMixed(n: number, a: number, b: number, span: RowSpan, opts: DistributeOptions = {}): ShapingSchedule {
  if (a > b) [a, b] = [b, a];
  const side = opts.side ?? 'any';
  const warnings: string[] = [];
  if (n <= 0) return schedule([], span, 0, warnings);
  if (side !== 'any' && (a % 2 !== 0 || b % 2 !== 0)) {
    const r = distributeMixed(n, a, b, span, { ...opts, side: 'any' });
    return { ...r, warnings: ['Odd intervals alternate RS and WS rows; shaping is allowed on any row.', ...r.warnings] };
  }
  // Prefer as many long intervals as fit, so the shaping fills the span.
  for (let y = n; y >= 0; y--) {
    const placed = placeIntervals(order(n - y, a, y, b, opts.order ?? 'spread'), span, side, opts.align ?? 'end');
    if (placed) return schedule(placed, span, n, warnings);
  }
  const fallback = distributeFixed(n, a, span, opts);
  return { ...fallback, warnings: [`Even every ${ordinal(a)} row needs more rows than the span has.`, ...fallback.warnings] };
}

function order(x: number, a: number, y: number, b: number, o: IntervalOrder): number[] {
  if (o === 'shortFirst') return [...Array(x).fill(a), ...Array(y).fill(b)];
  if (o === 'longFirst') return [...Array(y).fill(b), ...Array(x).fill(a)];
  const n = x + y;
  return splitEvenly(n * a + y, n, 'spread').map((v) => (v === a ? a : b));
}

// ---------- stitch change → events ----------

export type ShapedSides = 'both' | 'left' | 'right';

export interface EdgeEvent {
  left: number; // stitch change at the left edge (negative = decrease)
  right: number;
}

export interface EventPlan {
  events: EdgeEvent[];
  warnings: string[];
}

/**
 * Turn a total stitch change into shaping events.
 * `perSide` stitches change at each shaped edge per event (1 for a plain k2tog / M1).
 * An odd change over both sides puts the extra stitch on the left edge of the last event and warns.
 */
export function eventsForChange(change: number, sides: ShapedSides = 'both', perSide = 1): EventPlan {
  const warnings: string[] = [];
  const sign = Math.sign(change);
  let remaining = Math.abs(Math.round(change));
  if (remaining !== Math.abs(change)) warnings.push(`Stitch change ${change} is not a whole number; rounded to ${sign * remaining}.`);
  const events: EdgeEvent[] = [];
  const per = Math.max(1, Math.round(perSide));
  while (remaining > 0) {
    if (sides === 'both') {
      if (remaining >= 2 * per) {
        events.push({ left: sign * per, right: sign * per });
        remaining -= 2 * per;
      } else {
        const l = Math.ceil(remaining / 2);
        const r = remaining - l;
        events.push({ left: sign * l, right: sign * r });
        if (l !== r) warnings.push(`Odd stitch change: the left edge gets ${Math.abs(l - r)} more ${sign < 0 ? 'decrease' : 'increase'} than the right.`);
        remaining = 0;
      }
    } else {
      const d = Math.min(per, remaining);
      events.push(sides === 'left' ? { left: sign * d, right: 0 } : { left: 0, right: sign * d });
      remaining -= d;
    }
  }
  return { events, warnings };
}

// ---------- running counts ----------

export interface RowChange {
  row: number;
  delta: number;
}

/** Stitch count at the end of each row from `fromRow` to `toRow`. */
export function runningCounts(start: number, changes: RowChange[], fromRow: number, toRow: number): { row: number; count: number }[] {
  const byRow = new Map<number, number>();
  for (const c of changes) byRow.set(c.row, (byRow.get(c.row) ?? 0) + c.delta);
  const out: { row: number; count: number }[] = [];
  let count = start;
  for (let r = fromRow; r <= toRow; r++) {
    count += byRow.get(r) ?? 0;
    out.push({ row: r, count });
  }
  return out;
}

// ---------- evenly across a row ----------

/**
 * Positions (0-based stitch index after which to work the change) for `n` changes spread across
 * `stitches` stitches, with half-spaces at both ends, e.g. increasing evenly after a rib.
 */
export function distributeAcross(stitches: number, n: number): number[] {
  if (n <= 0 || stitches <= 0) return [];
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(Math.min(stitches - 1, Math.floor(((k + 0.5) * stitches) / n)));
  return out;
}

// ---------- descriptions ----------

export function ordinal(n: number): string {
  const s = n % 100;
  if (s >= 11 && s <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** e.g. "every 4th row ×3, every 6th row ×2". Visual summary only, not pattern text. */
export function describeGroups(groups: IntervalGroup[]): string {
  return groups.map((g) => `every ${g.every === 1 ? '' : ordinal(g.every) + ' '}row ×${g.times}`).join(', ');
}

/** e.g. "row 7, then every 8th row ×1, every 10th row ×1, every 8th row ×3". */
export function describeSchedule(s: ShapingSchedule): string {
  if (s.rows.length === 0) return 'no shaping';
  const first = `row ${s.rows[0]}`;
  return s.groups.length ? `${first}, then ${describeGroups(s.groups)}` : first;
}

function sideName(side: RowSide): string {
  return side === 'rs' ? 'RS' : side === 'ws' ? 'WS' : '';
}
