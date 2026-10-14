// Bust shaping for front panels: the suggested amounts (as editable formulas with the numbers shown),
// short-row wedges, horizontal (short-row) darts and vertical darts. Pure; computePanel calls it.

import { distributeAuto, splitEvenly, type RowSide, type RowSpan } from './distribute';
import { evaluate, renameReferences, scopeFrom } from './expr';
import { evaluateDim } from './measurements';
import { DEFAULT_LENGTH_NO_WIDTH, dim, type BustShaping, type DimExpr, type Id, type Panel } from './model';
import { roundNearest } from './rounding';

export interface BustFormula {
  expr: string;
  plugged: string; // the expression with the numbers plugged in
  value: number;
  overridden: boolean;
}

export interface ShortRowPair {
  index: number; // 1-based, in working order
  leftUnworked: number; // stitches left unworked at the left edge (as seen from the RS) when turning
  rightUnworked: number;
  rsWorked: number; // stitches worked on the RS short row before turning
  wsWorked: number; // stitches worked on the WS short row before turning
  leftX: number; // turn positions, stitch units from the centre line
  rightX: number;
}

export interface BustIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface ComputedBust {
  method: BustShaping['method'];
  D: number; // bust − upper_chest, cm
  /** Short rows / horizontal dart with no extra width at the front: W = 0, L from the no-width formula. */
  noFrontWidth: boolean;
  width: BustFormula;
  length: BustFormula;
  apex: { row: number; heightCm: number; offsetCm: number; leftX: number; rightX: number };
  shortRows: {
    kind: 'wedge' | 'dart';
    afterRow: number; // short rows are worked after this knit row
    pairs: ShortRowPair[];
    extraRows: number; // rows added at centre front
    style: 'german' | 'wrap-turn';
    liveStitches: number;
    manual: boolean;
    tipX: number; // dart: distance of the tip from the centre (sts)
    span: 'zone' | 'apex-to-side';
    step: number; // apex-to-side: stitches between turns (0 otherwise)
  } | null;
  darts: {
    leftX: number;
    rightX: number;
    perDart: number; // stitches each dart adds at the bust
    incRows: number[]; // knit rows widening going up the garment (bottom-up: increases)
    decRows: number[]; // knit rows narrowing going up
    interior: number[]; // per knit row: extra stitches the darts hold (both darts together)
    manual: boolean;
  } | null;
  issues: BustIssue[];
}

/** An expression with the names it uses replaced by their values, e.g. "max(0, (124.5 - 114.5) - 0) * 0.5". */
export function plugIn(expr: string, scope: Record<string, number>): string {
  return renameReferences(expr, (n) => (n in scope ? fmt(scope[n]) : undefined));
}

function fmt(x: number): string {
  return String(Math.round(x * 100) / 100);
}

function formula(d: DimExpr, sizeId: Id, scope: Record<string, number>): BustFormula | { error: string } {
  const r = evaluateDim(d, sizeId, scope);
  if (!r.ok) return { error: r.error };
  return { expr: d.expr, plugged: plugIn(d.expr, scope), value: r.value.value, overridden: r.value.overridden };
}

/** Width is added at the front unless the knitter turned it off (short rows and horizontal darts only). */
export function addsFrontWidth(b: BustShaping): boolean {
  return b.method === 'vertical-dart' || b.frontWidth !== false;
}

/** The L formula in use: the usual one, or the longer one when no width is added at the front. */
export function lengthDim(b: BustShaping): DimExpr {
  return addsFrontWidth(b) ? b.length : (b.lengthNoWidth ?? dim(DEFAULT_LENGTH_NO_WIDTH));
}

/**
 * The bust amounts for waypoint expressions. Evaluated against measurements and ease only, so they
 * never depend on the panel's own waypoints.
 */
export function bustValues(panel: Panel, sizeId: Id, scope: Record<string, number>): Record<string, number> {
  const b = panel.bust;
  const c = b?.apexCorrection ? evaluateDim(b.apexCorrection, sizeId, scope) : null;
  const bust_apex_corr = c?.ok ? c.value.value : 0;
  if (!b || b.method === 'none') return { bust_w: 0, bust_l: 0, bust_side_w: 0, bust_apex_corr };
  const w = evaluateDim(b.width, sizeId, scope);
  const l = evaluateDim(lengthDim(b), sizeId, scope);
  const W = w.ok && addsFrontWidth(b) ? Math.max(0, w.value.value) : 0;
  const L = l.ok ? Math.max(0, l.value.value) : 0;
  const side = (b.method === 'shortrows' || b.method === 'horizontal-dart') && b.sideWidth ? W : 0;
  return { bust_w: W, bust_l: L, bust_side_w: side, bust_apex_corr };
}

export interface BustContext {
  panel: Panel;
  sizeId: Id;
  scope: Record<string, number>; // measurements, ease, bust values and this panel's waypoint values
  spc: number;
  rpc: number;
  totalRows: number;
  topDown: boolean;
  h0: number; // garment height of the lowest waypoint
  leftEdge: number[];
  rightEdge: number[];
  isRS: (row: number) => boolean;
  isFlatRow: (row: number) => boolean;
  underarmRow: number | null; // knit row of the underarm waypoint, if any
}

export function computeBust(ctx: BustContext): ComputedBust | null {
  const b = ctx.panel.bust;
  if (!b || b.method === 'none') return null;
  const issues: BustIssue[] = [];
  const { spc, rpc, totalRows: T } = ctx;
  const s = ctx.scope;
  const D = (s.bust ?? 0) - (s.upper_chest ?? 0);

  const noFrontWidth = !addsFrontWidth(b);
  const wf = noFrontWidth ? { expr: '0', plugged: '0 (no extra width at the front)', value: 0, overridden: false } : formula(b.width, ctx.sizeId, s);
  const lf = formula(lengthDim(b), ctx.sizeId, s);
  const hf = evaluateDim(b.apexHeight, ctx.sizeId, s);
  const of = evaluateDim(b.apexOffset, ctx.sizeId, s);
  const errs = [
    'error' in wf ? `Width: ${wf.error}` : null,
    'error' in lf ? `Length: ${lf.error}` : null,
    !hf.ok ? `Bust point height: ${hf.error}` : null,
    !of.ok ? `Bust point offset: ${of.error}` : null,
  ].filter((x): x is string => !!x);
  if (errs.length || 'error' in wf || 'error' in lf || !hf.ok || !of.ok) {
    return { method: b.method, D, noFrontWidth, width: blank(b.width), length: blank(lengthDim(b)), apex: { row: 0, heightCm: 0, offsetCm: 0, leftX: 0, rightX: 0 }, shortRows: null, darts: null, issues: errs.map((m) => ({ severity: 'error', message: m })) };
  }

  // Garment height (cm) → knit row.
  const knitRow = (h: number) => {
    const g = Math.max(0, Math.min(T, roundNearest((h - ctx.h0) * rpc)));
    return ctx.topDown ? T - g : g;
  };
  const apexRow = knitRow(hf.value.value);
  const centre = (r: number) => (ctx.leftEdge[r] + ctx.rightEdge[r]) / 2;
  const offsetSts = of.value.value * spc;
  const apex = { row: apexRow, heightCm: hf.value.value, offsetCm: of.value.value, leftX: centre(apexRow) - offsetSts, rightX: centre(apexRow) + offsetSts };
  if (hf.value.value <= ctx.h0 || apexRow <= 0 || apexRow >= T) issues.push({ severity: 'error', message: 'The bust point is outside the panel.' });
  const half = (ctx.rightEdge[apexRow] - ctx.leftEdge[apexRow]) / 2;
  if (offsetSts >= half - 2) issues.push({ severity: 'warning', message: 'The bust point is at or beyond the side edge; check apex_to_apex.' });
  if (D <= 0) issues.push({ severity: 'info', message: `Bust and upper chest differ by ${fmt(D)} cm; little or no bust shaping is needed.` });

  const out: ComputedBust = { method: b.method, D, noFrontWidth, width: wf, length: lf, apex, shortRows: null, darts: null, issues };
  const manual = b.manual[ctx.sizeId];

  if (b.method === 'shortrows' || b.method === 'horizontal-dart') {
    const L = Math.max(0, lf.value);
    const autoPairs = roundNearest((L * rpc) / 2);
    const n = Math.max(0, b.shortRows.pairs ?? autoPairs);
    if (n === 0) {
      issues.push({ severity: 'info', message: 'The extra length rounds to no short rows.' });
      return out;
    }
    // Where to insert: centred on the bust point, or just below the underarm for an underarm dart.
    const span = b.method === 'shortrows' ? (b.shortRows.span ?? 'zone') : 'zone';
    const startAtApex = b.method === 'shortrows' && b.shortRows.start === 'apex';
    let after: number;
    if (b.method === 'horizontal-dart' && b.dart.placement === 'underarm' && ctx.underarmRow !== null) {
      const gap = roundNearest(2 * rpc);
      after = ctx.topDown ? ctx.underarmRow + gap : ctx.underarmRow - gap - 1;
    } else if (startAtApex) {
      // Right at the bust point: top-down they begin once the bust-point row is worked; bottom-up they finish
      // just before it. Either way the extra length sits just below the bust point.
      after = ctx.topDown ? apexRow : apexRow - 1;
    } else {
      after = apexRow - (ctx.topDown ? -n : n);
    }
    after = Math.max(0, Math.min(T - 1, after));
    // Start the short rows with a RS row.
    if (ctx.isFlatRow(after + 1) && !ctx.isRS(after + 1)) after = Math.max(0, after - 1);

    const cx = centre(after);
    const halfL = cx - ctx.leftEdge[after];
    const halfR = ctx.rightEdge[after] - cx;
    const hHalf = Math.min(halfL, halfR);
    const live = roundNearest(ctx.rightEdge[after] - ctx.leftEdge[after]);
    // Stitches kept between the side edge and the outermost turn: automatic, or the knitter's number (flat rows keep at
    // least 1 st so the turn is a turn; in the round the front's edge is the side seam, so 0 is allowed).
    const edgeSts = b.shortRows.edgeSts;
    const fixedEdge = typeof edgeSts === 'number' && Number.isFinite(edgeSts);
    const margin = fixedEdge ? Math.max(ctx.isFlatRow(after + 1) ? 1 : 0, Math.round(edgeSts)) : Math.max(2, ctx.panel.selvedge.left + 1);
    let inner: number;
    let outer: number;
    let tipX = 0;
    let step = 0; // apex-to-side: stitches between turns
    if (span === 'apex-to-side') {
      // First turn at the bust point, then every `step` sts towards the side seam ("stitches before turn" =
      // side stitches ÷ turns per side, rounded down).
      inner = Math.max(1, Math.round(offsetSts));
      outer = hHalf - margin;
      // Classic: every floor(side sts ÷ turns) sts, the last turn one step before the edge. With a fixed edge
      // distance the turns are spread evenly from the bust point to exactly that distance from the edge.
      step = fixedEdge ? (n > 1 ? (outer - inner) / (n - 1) : outer - inner) : Math.floor((outer - inner) / n);
      if (step < 1) {
        issues.push({ severity: 'error', message: `${n} turns per side don't fit between the bust point and the side seam (${Math.max(0, Math.floor(outer - inner))} sts). Reduce the length or stack a second dart.` });
        return out;
      }
    } else if (b.method === 'shortrows') {
      const zw = evaluateDim(b.shortRows.zoneWidth, ctx.sizeId, s);
      const z = (zw.ok ? zw.value.value : 6) * spc;
      // Never closer than 2 sts to the centre, so the centre short rows still work at least 4 sts.
      inner = Math.max(2, offsetSts - z / 2);
      outer = Math.min(hHalf - margin, offsetSts + z / 2);
    } else {
      const tg = evaluateDim(b.dart.tipGap, ctx.sizeId, s);
      inner = Math.max(1, offsetSts + (tg.ok ? tg.value.value : 2.5) * spc);
      outer = hHalf - margin;
      tipX = inner;
    }
    if (outer <= inner) {
      issues.push({ severity: 'error', message: 'There is no room for the turns between the bust point and the side edge.' });
      return out;
    }
    // Unworked stitches at the edge for each turn, evenly spaced from the outermost to the innermost turn.
    const uMin = Math.round(hHalf - outer);
    const uMax = Math.round(hHalf - inner);
    let u: number[];
    if (span === 'apex-to-side') {
      u = fixedEdge
        ? Array.from({ length: n }, (_, j) => Math.round(hHalf - (n === 1 ? inner : inner + ((n - 1 - j) * (outer - inner)) / (n - 1))))
        : Array.from({ length: n }, (_, j) => Math.round(hHalf - (inner + (n - 1 - j) * step)));
    }
    else if (n === 1) u = [Math.round((uMin + uMax) / 2)];
    else {
      const gaps = splitEvenly(uMax - uMin, n - 1, 'spread');
      u = [uMin];
      for (const g of gaps) u.push(u[u.length - 1] + g);
    }
    if (b.shortRows.order === 'lengthening') u.reverse(); // first short row is the shortest
    const left = manual?.left?.length === n ? manual.left : u;
    const right = manual?.right?.length === n ? manual.right : manual?.left?.length === n ? manual.left : u;
    const pairs: ShortRowPair[] = left.map((lu, i) => {
      const ru = right[i];
      const prevRight = i === 0 ? 0 : right[i - 1];
      return {
        index: i + 1,
        leftUnworked: lu,
        rightUnworked: ru,
        rsWorked: live - lu - prevRight,
        wsWorked: live - lu - ru,
        leftX: ctx.leftEdge[after] + lu,
        rightX: ctx.rightEdge[after] - ru,
      };
    });
    const spacing = left.slice(1).map((v, i) => Math.abs(v - left[i]));
    const minGap = spacing.length ? Math.min(...spacing) : Infinity;
    if (minGap < 2) {
      issues.push({ severity: 'warning', message: `Turns are only ${minGap} st${minGap === 1 ? '' : 's'} apart: ${n} short-row pairs are a lot for this width. Reduce the length, widen the zone, or set fewer pairs.` });
    }
    if (pairs.some((p) => p.wsWorked < 4)) issues.push({ severity: 'error', message: 'Some short rows work fewer than 4 stitches; the turns cross over.' });
    if (left.some((v, i) => v !== right[i])) issues.push({ severity: 'warning', message: 'Left and right turns differ: the bust shaping is asymmetric.' });
    if (ctx.underarmRow !== null && (ctx.topDown ? after < ctx.underarmRow : after + 1 > ctx.underarmRow)) {
      issues.push({ severity: 'warning', message: 'The short rows start above the underarm, inside the armhole shaping.' });
    }
    out.shortRows = {
      kind: b.method === 'shortrows' ? 'wedge' : 'dart',
      afterRow: after,
      pairs,
      extraRows: 2 * n,
      style: b.shortRows.style,
      liveStitches: live,
      manual: !!(manual?.left || manual?.right),
      tipX,
      span,
      step,
    };
    return out;
  }

  // ---- vertical darts ----
  const W = Math.max(0, wf.value);
  const perDart = roundNearest((W / 2) * spc);
  const bottom = evaluateDim(b.vertical.bottom, ctx.sizeId, s);
  const gap = evaluateDim(b.vertical.gap, ctx.sizeId, s);
  const top = evaluateDim(b.vertical.top, ctx.sizeId, s);
  if (!bottom.ok || !gap.ok || !top.ok) {
    issues.push({ severity: 'error', message: `Dart heights: ${[bottom, gap, top].map((r) => (!r.ok ? r.error : '')).filter(Boolean).join('; ')}` });
    return out;
  }
  const gapRows = Math.max(0, roundNearest(gap.value.value * rpc));
  // Garment rows: widening below the bust, narrowing above it.
  const gb = roundNearest((bottom.value.value - ctx.h0) * rpc);
  const ga = roundNearest((hf.value.value - ctx.h0) * rpc);
  const gt = roundNearest((top.value.value - ctx.h0) * rpc);
  const toKnit = (g: number) => (ctx.topDown ? T - g : g);
  const spanOf = (g1: number, g2: number): RowSpan => {
    const a = toKnit(g1);
    const c = toKnit(g2);
    return { from: Math.max(1, Math.min(a, c)), to: Math.min(T, Math.max(a, c)) };
  };
  const lowSpan = spanOf(gb + 1, ga - gapRows);
  const highSpan = spanOf(ga + gapRows, gt);
  const nRows = Math.ceil(perDart / 2);
  // Shape on RS rows. distribute's 'rs' means odd rows, so flip when this flat part's RS rows are even.
  // In the round every other round is used ('rs').
  const sideFor = (span: RowSpan): RowSide => {
    if (!ctx.isFlatRow(span.from)) return 'rs';
    const rsIsOdd = ctx.isRS(span.from) === (span.from % 2 === 1);
    return rsIsOdd ? 'rs' : 'ws';
  };
  const place = (span: RowSpan, label: string) => {
    if (nRows === 0) return [];
    let r = distributeAuto(nRows, span, { side: sideFor(span), align: 'center' });
    if (!r.feasible) {
      const any = distributeAuto(nRows, span, { side: 'any', align: 'center' });
      if (any.feasible) {
        issues.push({ severity: 'info', message: `Vertical darts (${label}): not enough RS rows, so the dart shaping is worked on every row.` });
        r = any;
      }
    }
    for (const w of r.warnings) issues.push({ severity: r.feasible ? 'warning' : 'error', message: `Vertical darts (${label}): ${w}` });
    return r.rows;
  };
  const widenRows = manual?.incRows ?? place(lowSpan, 'below the bust');
  const narrowRows = manual?.decRows ?? place(highSpan, 'above the bust');
  if (widenRows.length !== narrowRows.length) issues.push({ severity: 'warning', message: 'The darts open and close a different number of times: the extra width does not return to zero.' });

  // Stitches each dart adds per shaping row: 2 (one each side of the dart line), the last one 1 if odd.
  const perRow = (k: number) => (k === nRows - 1 && perDart % 2 === 1 ? 1 : 2);
  const interior = new Array<number>(T + 1).fill(0);
  const change = new Map<number, number>();
  const sortedW = [...widenRows].sort((a, c) => a - c);
  const sortedN = [...narrowRows].sort((a, c) => a - c);
  // In knit order bottom-up: widen then narrow. Top-down: knit order meets the narrowing (upper) part first.
  sortedW.forEach((r, k) => change.set(r, (change.get(r) ?? 0) + (ctx.topDown ? -1 : 1) * 2 * perRow(ctx.topDown ? sortedW.length - 1 - k : k)));
  sortedN.forEach((r, k) => change.set(r, (change.get(r) ?? 0) + (ctx.topDown ? 1 : -1) * 2 * perRow(ctx.topDown ? k : sortedN.length - 1 - k)));
  let acc = 0;
  for (let r = 0; r <= T; r++) {
    acc += change.get(r) ?? 0;
    interior[r] = acc;
  }
  if (Math.min(...interior) < 0) issues.push({ severity: 'error', message: 'The dart closes before it opens; check the dart rows.' });
  out.darts = {
    leftX: centre(apexRow) - offsetSts,
    rightX: centre(apexRow) + offsetSts,
    perDart,
    incRows: sortedW,
    decRows: sortedN,
    interior,
    manual: !!(manual?.incRows || manual?.decRows),
  };
  return out;
}

function blank(d: DimExpr): BustFormula {
  return { expr: d.expr, plugged: d.expr, value: 0, overridden: false };
}

/** Evaluate a bust formula on its own (for the per-size table). */
export function evaluateFormula(expr: string, scope: Record<string, number>): number | null {
  const r = evaluate(expr, scopeFrom(scope));
  return r.ok ? r.value : null;
}

/**
 * The short-row wedge as bands in knit rows, in working order: pair i occupies knit rows after + 2i … after + 2i + 2
 * (drawn over the following rows, as the extra rows aren't in the outline).
 */
export function wedgeBands(b: ComputedBust): { leftX: number; rightX: number; from: number; to: number; index: number }[] {
  const sr = b.shortRows;
  if (!sr) return [];
  return sr.pairs.map((p, i) => ({ leftX: p.leftX, rightX: p.rightX, from: sr.afterRow + 2 * i, to: sr.afterRow + 2 * i + 2, index: p.index }));
}
