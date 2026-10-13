// Shaping lines: increases/decreases along a line drawn inside a panel (darts, sway-back shaping, slanted lines).
// Ends are expressions in cm (height up from the lower edge, distance from the centre), so lines grade with the
// sizes. The stitch change widens/narrows the panel evenly about the centre, like the vertical bust darts.

import { distributeAuto, type RowSide, type RowSpan } from './distribute';
import { evaluate, scopeFrom } from './expr';
import { evaluateDim } from './measurements';
import type { Anchor, Id, Panel, ShapingLine } from './model';
import { dim, newId } from './model';
import { roundNearest } from './rounding';

export interface LineEvent {
  row: number; // knit row
  delta: number; // stitch change of this line on this row (knit order), e.g. −2 for both sides of the line
}

export interface ComputedLine {
  id: Id;
  name: string;
  mirror: boolean;
  sides: 'both' | 'one';
  /** Ends in knit rows and stitches from the row's centre (the line runs straight between them). */
  ends: [{ row: number; x: number }, { row: number; x: number }];
  events: LineEvent[];
  amount: number; // stitches, as evaluated (garment-up change)
  manual: boolean;
  issues: { severity: 'error' | 'warning' | 'info'; message: string }[];
}

/** Line x (sts from the row centre) at a knit row, interpolated between its ends. */
export function lineX(l: ComputedLine, row: number): number {
  const [a, b] = l.ends;
  if (a.row === b.row) return a.x;
  const t = Math.max(0, Math.min(1, (row - a.row) / (b.row - a.row)));
  return a.x + t * (b.x - a.x);
}

interface Ctx {
  panel: Panel;
  sizeId: Id;
  scope: Record<string, number>;
  spc: number;
  rpc: number;
  totalRows: number;
  topDown: boolean;
  h0: number;
  isRS: (r: number) => boolean;
  isFlatRow: (r: number) => boolean;
  halfWidth: (r: number) => number;
}

/** All of a panel's lines for one size, plus the extra stitches they hold per row (both twins counted). */
export function computeLines(ctx: Ctx): { lines: ComputedLine[]; interior: number[] } {
  const T = ctx.totalRows;
  const change = new Array<number>(T + 1).fill(0);
  const out: ComputedLine[] = [];
  for (const l of ctx.panel.shapingLines ?? []) {
    const c = computeLine(l, ctx);
    out.push(c);
    for (const e of c.events) if (e.row >= 1 && e.row <= T) change[e.row] += e.delta * (l.mirror ? 2 : 1);
  }
  let acc = 0;
  return { lines: out, interior: change.map((d) => (acc += d)) };
}

function computeLine(l: ShapingLine, ctx: Ctx): ComputedLine {
  const issues: ComputedLine['issues'] = [];
  const T = ctx.totalRows;
  const base: ComputedLine = { id: l.id, name: l.name, mirror: l.mirror, sides: l.sides, ends: [{ row: 0, x: 0 }, { row: 0, x: 0 }], events: [], amount: 0, manual: false, issues };
  const at = (a: Anchor, which: string) => {
    const h = evaluateDim(a.height, ctx.sizeId, ctx.scope);
    const x = evaluateDim(a.x, ctx.sizeId, ctx.scope);
    if (!h.ok) issues.push({ severity: 'error', message: `${which} height: ${h.error}` });
    if (!x.ok) issues.push({ severity: 'error', message: `${which} position: ${x.error}` });
    if (!h.ok || !x.ok) return null;
    const g = Math.max(0, Math.min(T, roundNearest((h.value.value - ctx.h0) * ctx.rpc)));
    return { row: ctx.topDown ? T - g : g, x: x.value.value * ctx.spc };
  };
  const a = at(l.from, 'Start');
  const b = at(l.to, 'End');
  const amt = evaluateDim(l.amount, ctx.sizeId, ctx.scope);
  if (!amt.ok) issues.push({ severity: 'error', message: `Stitches: ${amt.error}` });
  if (!a || !b || !amt.ok) return base;
  // Ends in knit order.
  const ends: ComputedLine['ends'] = a.row <= b.row ? [a, b] : [b, a];
  const amount = Math.round(amt.value.value);
  const res: ComputedLine = { ...base, ends, amount };
  const span: RowSpan = { from: ends[0].row + 1, to: ends[1].row };
  if (span.to < span.from) {
    if (amount !== 0) issues.push({ severity: 'error', message: 'Both ends are on the same row; give the line some height.' });
    return res;
  }
  const per = l.sides === 'both' ? 2 : 1;

  // Knit-order changes: a fisheye line makes `amount` in the first half (in knit order) and undoes it in the second;
  // a one-way line's garment-up change runs backwards in knit order when the panel is worked top-down.
  const phases: { span: RowSpan; delta: number }[] = [];
  if (l.kind === 'fisheye') {
    const mid = Math.floor((span.from + span.to) / 2);
    phases.push({ span: { from: span.from, to: mid }, delta: amount }, { span: { from: mid + 1, to: span.to }, delta: -amount });
  } else {
    phases.push({ span, delta: ctx.topDown ? -amount : amount });
  }

  const manual = l.manual[ctx.sizeId];
  const events: LineEvent[] = [];
  if (manual) {
    // Hand-placed rows: each takes `per` sts in the direction of its phase; the last of a phase takes what's left.
    res.manual = true;
    for (const ph of phases) {
      const rows = manual.filter((r) => r >= ph.span.from && r <= ph.span.to).sort((x, y) => x - y);
      let left = Math.abs(ph.delta);
      for (const r of rows) {
        const k = Math.min(per, left);
        if (k <= 0) break;
        events.push({ row: r, delta: Math.sign(ph.delta) * k });
        left -= k;
      }
      if (left > 0) issues.push({ severity: 'warning', message: `Hand-placed rows leave ${left} st${left === 1 ? '' : 's'} unshaped${l.kind === 'fisheye' ? ' in one half' : ''}.` });
    }
    const outside = manual.filter((r) => r < span.from || r > span.to);
    if (outside.length) issues.push({ severity: 'warning', message: `Rows ${outside.join(', ')} are outside the line and were ignored.` });
  } else {
    for (const ph of phases) {
      const n = Math.ceil(Math.abs(ph.delta) / per);
      if (n === 0) continue;
      const side: RowSide = l.rowSide === 'any' || !ctx.isFlatRow(ph.span.from) ? (l.rowSide === 'any' ? 'any' : 'rs') : ctx.isRS(ph.span.from) === (ph.span.from % 2 === 1) ? 'rs' : 'ws';
      let r = distributeAuto(n, ph.span, { side, align: 'center' });
      if (!r.feasible && side !== 'any') {
        const any = distributeAuto(n, ph.span, { side: 'any', align: 'center' });
        if (any.feasible) {
          issues.push({ severity: 'info', message: 'Not enough RS rows, so the shaping is worked on every row.' });
          r = any;
        }
      }
      for (const w of r.warnings) issues.push({ severity: r.feasible ? 'warning' : 'error', message: w });
      let left = Math.abs(ph.delta);
      for (const row of r.rows) {
        const k = Math.min(per, left);
        if (k <= 0) break;
        events.push({ row, delta: Math.sign(ph.delta) * k });
        left -= k;
      }
    }
  }
  events.sort((x, y) => x.row - y.row);
  res.events = events;

  if (per === 2 && events.some((e) => Math.abs(e.delta) === 1)) issues.push({ severity: 'info', message: 'An odd stitch is worked on one side of the line only.' });
  // Position checks.
  for (const e of [ends[0], ends[1]]) {
    const h = ctx.halfWidth(Math.max(0, Math.min(T, e.row)));
    if (Math.abs(e.x) > h - 2) issues.push({ severity: 'warning', message: `An end is ${roundNearest(Math.abs(e.x))} sts from the centre, at or beyond the edge (half width ${roundNearest(h)} sts).` });
  }
  if (l.mirror && Math.abs(ends[0].x) < 1 && Math.abs(ends[1].x) < 1) issues.push({ severity: 'warning', message: 'A mirrored line on the centre overlaps its twin.' });
  const net = events.reduce((s2, e) => s2 + e.delta, 0) * (l.mirror ? 2 : 1);
  if (net !== 0) {
    issues.push({ severity: 'info', message: `Changes the stitch count by ${net > 0 ? '+' : ''}${net} from row ${ends[1].row} on; later widths move with it.` });
  }
  return res;
}

/** A new line between two points (cm), grading with the panel: heights from the nearest waypoint below, x as a fraction of that waypoint's half width. */
export function lineFromPoints(panel: Panel, scope: Record<string, number>, p1: { h: number; x: number }, p2: { h: number; x: number }, name: string): ShapingLine {
  const anchor = (p: { h: number; x: number }): Anchor => {
    const named = panel.waypoints
      .map((w) => ({ key: wpKey(w.name), h: scope[`${wpKey(w.name)}.height`], w: scope[`${wpKey(w.name)}.width`] }))
      .filter((w) => Number.isFinite(w.h));
    const below = named.filter((w) => w.h <= p.h + 1e-9).sort((a, b) => b.h - a.h)[0] ?? named.sort((a, b) => a.h - b.h)[0];
    const r = (v: number) => Math.round(v * 10) / 10;
    const height = below ? `${below.key}.height${p.h - below.h >= 0 ? ' + ' : ' - '}${r(Math.abs(p.h - below.h))}` : String(r(p.h));
    const half = below && below.w > 0 ? below.w / 2 : 0;
    const x = half > 0 ? `${below!.key}.width / 2 * ${Math.round((p.x / half) * 1000) / 1000}` : String(r(p.x));
    return { height: dim(height), x: dim(x) };
  };
  const [lo, hi] = p1.h <= p2.h ? [p1, p2] : [p2, p1];
  return { id: newId('line'), name, from: anchor(lo), to: anchor(hi), amount: dim(-4), kind: 'fisheye', sides: 'both', rowSide: 'rs', mirror: true, manual: {} };
}

/** Same as panel.waypointKey (kept here to avoid an import cycle). */
function wpKey(name: string): string {
  const k = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[0-9]/.test(k) || k === '' ? `wp_${k}` : k;
}

/** Evaluate an amount expression on its own (for UI previews). */
export function evalAmount(expr: string, scope: Record<string, number>): number | null {
  const r = evaluate(expr, scopeFrom(scope));
  return r.ok ? r.value : null;
}
