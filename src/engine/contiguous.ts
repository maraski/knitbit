// Contiguous yoke generator (the contiguous method by Susie Myers, SusieM on Ravelry): one piece worked top-down
// from the back neck, with the shoulder seams, back, fronts and set-in-look sleeve caps growing row by row.
// Pure: a YokeSpec + measurements in, every row's zone counts, increases and cast-ons out.
//
// Row layout, as seen from the RS (left = wearer's left): [left front | left seam/sleeve | back | right seam/sleeve |
// right front]. Row 1 is a RS row: it places the markers and makes the first increases. Flat rows alternate RS/WS.
//
// Two ways to start (`spec.start`):
// - 'back' (as the method's PDF): cast on the back neck, both seams and one front stitch each side; the fronts grow
//   from the neck points with neck increases, then a centre cast-on closes the neck (a pullover joins in the round).
// - 'neck' (whole neck): cast on the fronts too; German short rows raise the back above the front, turning in the
//   fronts a step nearer centre front each time. A pullover is joined at the cast-on with the round starting at the
//   left back shoulder marker: row 1 runs from there to the first turn, the short rows go turn to turn, and the last
//   flat row runs from the last turn back to the marker (neither of those two half rows increases). Rounds follow.

import { plugIn } from './bust';
import { distributeAcross, distributeAuto } from './distribute';
import { evaluate, scopeFrom } from './expr';
import { rowsPerCm, stitchesPerCm } from './gauge';
import { buildScope } from './measurements';
import { ceil1, cmText, exprErrorText, field, fixOf, floor1, rowsCm, stsCm, YOKE_LABELS, type IssueFix } from './issues';
import type { DimExpr, Id, NecklineShape, Project, StitchPattern, StrapGives, YokeSpec, YokeStart } from './model';
import { dim, newPanel, type Panel } from './model';
import { backNeckFor, bodiceNeck, FRONT_NECKS } from './templates';
import { defaultRaglan, generateRaglan, offShoulderRaised } from './raglan';

export type Zone = 'leftFront' | 'leftSleeve' | 'back' | 'rightSleeve' | 'rightFront';
export const ZONES: Zone[] = ['leftFront', 'leftSleeve', 'back', 'rightSleeve', 'rightFront'];
export type ZoneCounts = Record<Zone, number>;

/** Phases of a row; 'band' = an off-shoulder raglan's band, knit first (raglan.ts). */
export type YokePhase = 'A' | 'C' | 'D' | 'E' | 'R' | 'band';

export interface YokeInc {
  zone: Zone;
  /** Index of the new stitch within its zone (as seen from the RS, after the row). */
  at: number;
  symbol: string;
  /** 'band': an off-shoulder raglan's increase round, from the band to the ring. */
  kind: 'seam' | 'backNeck' | 'neck' | 'sleeve' | 'body' | 'band';
}

export interface YokeCastOn {
  zone: Zone;
  count: number;
  where: 'centre-front' | 'front-edge';
}

export interface YokeRow {
  row: number;
  /** Short-row section (whole-neck start): the stitches this row works, [from, to) in row order (after the row);
   * absent = every stitch. `turn` = the stitch it turns after (German short row). */
  span?: [number, number];
  turn?: { side: 'left' | 'right'; at: number };
  /** A half row with no increases (a pullover's first and last short-row-section rows). */
  plain?: boolean;
  /** An off-shoulder raglan's band row (rib, in the round, no increases). */
  band?: boolean;
  /** A folded band's row: the facing (folded inside), the turning round (the fold), the outer half, or its last row,
   * where a knit-closed band is joined to the cast-on. */
  bandPart?: 'facing' | 'turn' | 'outer' | 'join';
  phase: YokePhase;
  /** Phase B (back neck increases) is worked on this row too. */
  backNeck: boolean;
  /** Front neck increases on this row. */
  neck: boolean;
  round: boolean;
  rs: boolean;
  /** The markers moved at the start of this row (each seam group widens to the cap top). */
  markersMoved: boolean;
  zones: ZoneCounts; // after the row
  total: number;
  incs: YokeInc[];
  castOns: YokeCastOn[];
}

export interface YokeParam {
  label: string;
  expr: string;
  plugged: string;
  value: number;
  overridden: boolean;
  unit: 'cm' | 'rows' | 'sts' | '';
}

export interface PhaseSummary {
  /** 'band', 'ring': an off-shoulder raglan's band and its increase round to the ring. */
  id: 'A' | 'B' | 'neck' | 'C' | 'D' | 'E' | 'R' | 'band' | 'ring';
  label: string;
  from: number; // first row
  to: number; // last row
  stsBefore: number;
  stsAfter: number;
  incsPerRow: string;
}

export interface YokeIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** Stable id of the kind of problem (see `Issue.code`). */
  code?: string;
  /** The value to change: a key in `YokeResult.params`. */
  param?: string;
  fix?: IssueFix;
}

export interface YokeResult {
  ok: boolean;
  issues: YokeIssue[];
  castOn: number;
  /** Cast-on layout: [edge, seam, back neck, seam, edge]. */
  castOnZones: ZoneCounts;
  rows: YokeRow[];
  phases: PhaseSummary[];
  params: Record<string, YokeParam>;
  counts: { A: number; B: number; C: number; D: number; E: number; total: number; neckRow: number | null; joinRow: number | null; rapidBase: number };
  start: YokeStart;
  /** Whole-neck start: the short rows. `turns[i]` = stitches left unworked at each front's centre-front end by pair
   * i + 1; `endRow` = the last flat row of the section (the round starts after it on a pullover). `fromRow`: the
   * section's first row (absent = row 1; an off-shoulder raglan's back raise starts after its band and increase round).
   * `frontNeck`: a front neck deeper than the short rows give: each front is cast on with `castOn` sts (what the turns
   * need), `opening` sts apart at the cast-on (`backDepth`: the back neck's cm below the neck point); the rest of the neck is front-neck increases and the closing cast-on, as
   * the back start's (`neck`), worked flat until then. */
  shortRows: { pairs: number; first: number; step: number; turns: number[]; endRow: number; frontSts: number; fromRow?: number; frontNeck?: { castOn: number; opening: number; backDepth: number } } | null;
  seamSts: number;
  capTopSts: number;
  /** Stitches left at the split: each sleeve on hold, the body continues. */
  held: { leftSleeve: number; body: number; rightSleeve: number };
  /** Stitches cast on at each underarm (body and sleeve share them). */
  underarmCo: number;
  bodyIncs: { perEdge: number; rows: number[] };
  /** Stitch counts at the end of phase A (before the markers move). */
  endOfA: ZoneCounts;
  /** The front neck as worked: depth in rows (before making it a RS row), the cast-on row, increases per side,
   * the centre (pullover cast-on), and a cardigan's cast-on at each front edge less the closing width. */
  neck: { depthRows: number; row: number; perSide: number; backNeck: number; centre: number; closingSts: number; frontEdgeCo: number };
  /** A back-start front neck deeper than the split: the front body works the rest. `rows` from the split to the
   * closing row (the body's rows 1..rows), the increases per side still to make on the body's `increaseRows`, then the
   * pullover's centre cast-on or a cardigan's cast-on at each front edge. Absent when the neck closes in the yoke. */
  neckContinues?: { rows: number; perSide: number; centre: number; frontEdgeCo: number; increaseRows: number[] };
  derived: {
    seamCm: number;
    backEndOfACm: number;
    frontEndOfACm: number; // both fronts plus the neck between them
    sleeveCm: number; // sleeve at the underarm, cast-on included
    bodyCm: number; // body at the underarm, cast-ons included
    armholeCm: number; // around the armhole: both edges, cap top and the underarm cast-on
    backLengthCm: number; // rows from the cast-on to the split
  };
  stitchesPerCm: number;
  rowsPerCm: number;
  /** The garment's strap drives this yoke (see `yokeStrap`): the seam is `rows` long; 'neck' solved the neck cast-on
   * (`neckSts`), 'armhole' the back's width after the shoulders (`backSts`, the markers moved). */
  strap?: { gives: StrapGives; rows: number; incRows: number; neckSts: number; backSts: number };
  /** A raglan yoke (raglan.ts): the sleeve top at the cast-on, the rows the body and the sleeves increase on (4 sts
   * each), how many of those are extra rows beyond every other row, and the raglan line's length. */
  raglan?: { sleeveTopSts: number; bodyRows: number[]; sleeveRows: number[]; bodyFast: number; sleeveFast: number; lineCm: number };
  /** An off-shoulder raglan: the band (its count is the cast-on, rows 1..bandRows, in `pattern`), the ring after the
   * increase round (row `incRow`), the arm arc (sts between the raglan lines), the back raise (cm) and how many rows
   * the centre front works (all but the short rows). A folded band (`fold`): `bandCm` is its finished depth, worked
   * as `depthRows` of facing, the turning round and `depthRows` outside (bandRows = 2 × depthRows + 1); the facing and
   * the turning round (`hiddenRows`) fold inside, so they're added to the yoke's depth. */
  offShoulder?: {
    bandSts: number;
    bandRows: number;
    bandCm: number;
    pattern: StitchPattern;
    ringSts: number;
    ringZones: ZoneCounts;
    incRow: number;
    armSts: number;
    backRaiseCm: number;
    frontRows: number;
    fold?: { turn: 'purl' | 'picot'; close: 'knit' | 'sewn'; depthRows: number; hiddenRows: number };
    /** No band (the Neckband edge is off): the ring is the cast-on, bandRows and incRow 0, the raglan from row 1. */
    noBand?: boolean;
  };
}

// ---------- defaults ----------

export const SLOPED_SHOULDER = 'sqrt(((back_shoulder_width - back_neck_width) / 2) ^ 2 + shoulder_drop ^ 2)';

/** Short-row defaults: the fronts cast on as wide as the neck; pairs from the height the back is raised (`sr_depth` −
 * back neck depth: the front neck depth up to the shape's default, a deeper neck a crew neck's, the rest of it worked as
 * front-neck increases); turns from `first` sts past the shoulder marker, stepped evenly to the centre part. */
export function defaultShortRows(): NonNullable<YokeSpec['shortRows']> {
  return {
    frontCo: dim('neck_w'),
    pairs: dim('round(max(0, sr_depth - back_depth) / row_h / 2)'),
    first: dim(3),
    step: dim('max(1, floor((front_side - centre_side - first_turn) / max(1, pairs - 1)))'),
  };
}

/** New yokes start with the whole neck, except a V neck: its depth needs the neck increases of the method's start. */
export function defaultYoke(shape: NecklineShape = 'round', start: YokeStart = shape === 'v' ? 'back' : 'neck'): YokeSpec {
  const n = FRONT_NECKS[bodiceNeck(shape)];
  const boat = shape === 'boat';
  return {
    start,
    shortRows: defaultShortRows(),
    increase: { type: 'm1', symbol: 'kfb' },
    seamSts: dim(2),
    shoulder: { mode: 'cross-back', backWidth: dim('cross_back_w + 1'), length: dim(SLOPED_SHOULDER), shorten: dim(0), extraRows: dim(0) },
    // The method's back neck increases; the whole-neck start raises the back with short rows instead.
    backNeck: { perRow: dim(start === 'neck' ? 0 : 2), rows: dim(8), manual: {} },
    cap: { topSts: dim(6), rapidRows: dim('armhole_depth / 6 / row_h'), solve: true },
    sleeveWidth: dim('bicep + ease.bicep'),
    // A boat neck starts down the shoulder line (the strap's share of the shoulder drop) and its own back depth below.
    depth: { mode: 'back-length', backLength: dim(boat ? BOAT_BACK_LENGTH : 'shoulder_drop + armhole_depth - back_neck_drop'), extra: dim(0), deepen: true, maxRapid: dim(0.5) },
    body: { width: dim('upper_chest + ease'), increases: true, zone: dim(0.6) },
    underarm: { castOn: dim('underarm_co') },
    neck: { shape, depth: dim(n.depth), centre: dim(n.centre), width: dim(n.width), ...(boat ? { backDepth: dim(backNeckFor('boat').depth) } : {}) },
  };
}

/** Back length, neck to underarm, of a boat neck: from the strap top (down the shoulder line) less the back depth. */
const BOAT_BACK_LENGTH = 'shoulder_drop * min(1, (shoulder_w - neck_w) / max(1, shoulder_w - back_neck_width)) + armhole_depth - back_depth';

/**
 * A yoke with another neck shape: the neck takes the new shape's defaults, and any other setting still at the old
 * shape's default follows the new shape's default (settings you changed are kept). Off-shoulder is always a raglan
 * yoke: from a modified raglan (a contiguous yoke started with the whole neck) it raises the back, and back from a
 * raised one it makes a modified raglan again (a level one goes back to the classic raglan).
 */
export function yokeWithNeck(yoke: YokeSpec, shape: NecklineShape): YokeSpec {
  const os = (s: NecklineShape) => s === 'off-shoulder';
  const modified = os(yoke.neck.shape) ? offShoulderRaised(yoke) : yoke.style !== 'raglan' && yoke.start === 'neck';
  // A raglan keeps its start (both make every shape); its defaults are the raglan's.
  const base = (s: NecklineShape, from: boolean) => {
    if (os(s)) return defaultRaglan(s, modified ? 'neck' : 'back');
    if (os(yoke.neck.shape) && !from) return modified ? defaultYoke(s, 'neck') : defaultRaglan(s, 'back');
    return yoke.style === 'raglan' ? defaultRaglan(s, yoke.start ?? 'back') : defaultYoke(s);
  };
  const before = base(yoke.neck.shape, true) as unknown as Record<string, unknown>;
  const after = base(shape, false) as unknown as Record<string, unknown>;
  const next = { ...yoke } as unknown as Record<string, unknown>;
  for (const k of Object.keys(after)) if (JSON.stringify(next[k]) === JSON.stringify(before[k])) next[k] = after[k];
  // Settings the new kind of yoke doesn't have go, when they were still the old defaults (a contiguous yoke has no style).
  for (const k of Object.keys(before)) if (!(k in after) && JSON.stringify(next[k]) === JSON.stringify(before[k])) delete next[k];
  if (os(shape) || os(yoke.neck.shape)) {
    if (after.style) next.style = after.style;
    else delete next.style;
  }
  // The whole neck is the new shape's (a boat neck's back depth goes with it).
  return { ...(next as unknown as YokeSpec), neck: base(shape, false).neck };
}

const sum = (z: ZoneCounts) => ZONES.reduce((a, k) => a + z[k], 0);

/** Symbols for an increase on the left / right side of a marker (the new stitch leans away from it). */
function incSymbols(spec: YokeSpec): { before: string; after: string } {
  if (spec.increase.type === 'kfb') return { before: 'kfb', after: 'kfb' };
  if (spec.increase.type === 'other') return { before: spec.increase.symbol, after: spec.increase.symbol };
  // M1R just before a marker (left of it as seen from the RS), M1L just after.
  return { before: 'm1r', after: 'm1l' };
}

// ---------- fixes for the generators' errors (shared with raglan.ts) ----------

/** Short rows whose last turn is past centre front: the most pairs that fit (`side − first − (p − 1) × step ≥ 1`). */
export function shortRowsFitFix(pairs: number, side: number, first: number, step: number): Omit<YokeIssue, 'message'> {
  const most = side - first - 1 < 0 ? 0 : Math.floor((side - first - 1) / step) + 1;
  return {
    severity: 'error',
    code: 'yoke.short-rows-fit',
    param: 'srPairs',
    fix: fixOf(`Make Short-row pairs at most ${most} (now ${pairs}), or a smaller Sts between turns.`, [field.yoke('srPairs'), field.yoke('srStep')], { now: String(pairs), need: `≤ ${most}`, apply: { field: field.yoke('srPairs'), value: most, unit: '' } }),
  };
}

/**
 * Short rows ending on row R, below the split on row Y (whole-neck start): the most pairs that end by row Y (the short
 * rows end on row 2 × pairs + 1), or how much deeper the yoke must be. (A front neck deeper than the split isn't an
 * error: it continues into the front body, see `neckContinuation`.)
 */
export function belowSplitFix(R: number, Y: number, rpc: number, pairs: number): Omit<YokeIssue, 'message'> {
  const deeper = cmText(Math.ceil(((R - Y) / rpc) * 10) / 10);
  const most = Math.max(0, Math.floor((Y - 1) / 2));
  return {
    severity: 'error',
    code: 'yoke.short-rows-below-split',
    param: 'srPairs',
    fix: fixOf(`Make Short-row pairs at most ${most} (now ${pairs}), or add ${deeper} to Extra depth.`, [field.yoke('srPairs'), field.yoke('extraDepth')], { now: String(pairs), need: `≤ ${most}`, apply: { field: field.yoke('srPairs'), value: most, unit: '' } }),
  };
}

/**
 * A back-start front neck that closes on row R, below the split on row Y: the yoke works its increases up to the split
 * and the front body carries on with the rest, renumbered from the body's row 1, then the centre cast-on (a pullover
 * joins in the round there) or a cardigan's front-edge cast-ons. Its info says so.
 */
export function neckContinuation(R: number, Y: number, rpc: number, neckRows: number[], centre: number, frontEdgeCo: number, cardigan: boolean): { neckContinues: NonNullable<YokeResult['neckContinues']>; issue: YokeIssue } {
  const increaseRows = neckRows.filter((r) => r > Y && r < R).map((r) => r - Y).sort((a, b) => a - b);
  // A cardigan closing on the split row itself: both front-edge cast-ons move to the body's first row.
  const rows = Math.max(1, R - Y);
  const n = increaseRows.length;
  const more = n ? `${n} more increase${n === 1 ? '' : 's'} each side, then ` : '';
  const close = cardigan ? (frontEdgeCo > 0 ? `cast on ${frontEdgeCo} sts at each front edge` : 'the fronts are straight from there') : centre > 0 ? `cast on ${centre} sts and join in the round` : 'join in the round';
  return {
    neckContinues: { rows, perSide: n, centre, frontEdgeCo, increaseRows },
    issue: { severity: 'info', code: 'yoke.neck-continues', param: 'neckDepth', message: `The front neck continues ${rows} row${rows === 1 ? '' : 's'} (${cmText(Math.round((rows / rpc) * 10) / 10)}) into the front body: ${more}${close}.` },
  };
}

/**
 * Whole-neck start, a front neck deeper than the short rows give: how the depth is shared (the back neck below the neck
 * point, the short rows' back raise, and the rest worked as front-neck increases and the closing cast-on).
 */
export function deepNeckNote(sr: NonNullable<YokeResult['shortRows']>, deep: { R: number; perSide: number; centre: number; frontEdgeCo: number }, depthCm: number, backDepthCm: number, rpc: number, cardigan: boolean): YokeIssue {
  const cm = (rows: number) => cmText(Math.round((rows / rpc) * 10) / 10);
  const raise = sr.pairs ? `the short rows raise the back ${cm(2 * sr.pairs)} (${sr.pairs} pair${sr.pairs === 1 ? '' : 's'})` : 'no short rows';
  const from = sr.endRow + 1;
  const incs = deep.perSide ? `${deep.perSide} increase${deep.perSide === 1 ? '' : 's'} each side, then ` : '';
  const close = cardigan ? (deep.frontEdgeCo > 0 ? `cast on ${deep.frontEdgeCo} sts at each front edge` : 'the fronts are straight from there') : `cast on ${deep.centre} sts at centre front and join in the round`;
  return {
    severity: 'info',
    code: 'yoke.neck-below-short-rows',
    param: 'neckDepth',
    message: `Front neck ${cmText(depthCm)}: the back neck is ${cmText(backDepthCm)} below the neck point and ${raise}; the other ${cm(deep.R - sr.endRow)} (rows ${from}–${deep.R}): cast on ${sr.frontNeck?.castOn ?? 0} sts each front, ${incs}${close}${cardigan ? '' : ' (flat until then)'}.`,
  };
}

/** The back-start front neck isn't closed at the split: it closes below it, or a cardigan's left front-edge cast-on (the
 * row after the right's) would fall after it. */
export function continuesPast(R: number, Y: number, cardigan: boolean, frontEdgeCo: number): boolean {
  return R > Y || (cardigan && R === Y && frontEdgeCo > 0);
}

/** Stitches the front body still adds to the front at the split (the neck's remaining increases and its cast-ons). */
export function neckRest(nc: YokeResult['neckContinues'], cardigan: boolean): number {
  return !nc ? 0 : 2 * nc.perSide + (cardigan ? 2 * nc.frontEdgeCo : nc.centre);
}

// ---------- strap width ----------

/** A yoke's neck width linked to the garment's strap (Strap gives at: Neck): the generator solves it. */
export const STRAP_YOKE_NECK = 'strap_neck_w';
/** A yoke's back width linked to the strap (Strap gives at: Armhole): the back is the neck plus the seam's increases. */
export const STRAP_YOKE_BACK = 'strap_back_w';

const linkedTo = (d: DimExpr | undefined, name: string, sizeId: Id) => !!d && d.expr.trim() === name && !(sizeId in d.overrides);

/**
 * Does the garment's strap drive this yoke in this size: its seam `rows` long (strap × row gauge), and what gives.
 * Only through the linked fields (typing over one unlinks it); a yoke without them works as before.
 */
export function yokeStrap(spec: YokeSpec, sizeId: Id, scope: Record<string, number>, rpc: number): { gives: StrapGives; rows: number } | null {
  const w = scope.strap_w;
  if (w === undefined || spec.style === 'raglan') return null;
  const rows = Math.max(1, Math.round(w * rpc));
  if (linkedTo(spec.neck.width, STRAP_YOKE_NECK, sizeId)) return { gives: 'neck', rows };
  if (linkedTo(spec.shoulder.backWidth, STRAP_YOKE_BACK, sizeId)) return { gives: 'armhole', rows };
  return null;
}

// ---------- generator ----------

export function generateYoke(project: Project, spec: YokeSpec, sizeId: Id): YokeResult {
  if (spec.style === 'raglan') return generateRaglan(project, spec, sizeId);
  const scope = buildScope(project, sizeId);
  const strap = yokeStrap(spec, sizeId, scope, rowsPerCm(project.gauge));
  if (strap?.gives !== 'neck') return workYoke(project, spec, sizeId, scope, strap);
  // Strap gives at the neck: the seam is the strap and the back still reaches its width, so the neck is what's left,
  // back = neck + 2 × (seam increase rows − extra rows) + back neck increases − 2 × marker move. A first pass (with the
  // neck as it was before it was linked) counts the increases; none of them depend on the neck.
  const spc = stitchesPerCm(project.gauge);
  const yp = project.panels.find((x) => x.yoke === spec) ?? project.panels.find((x) => x.yoke && x.yoke.style !== 'raglan');
  const was = (yp && project.garment.strap?.saved[yp.id]?.['yoke.neckWidth']) || dim('back_neck_width');
  const withNeck = (d: DimExpr): YokeSpec => ({ ...spec, neck: { ...spec.neck, width: d } });
  const first = workYoke(project, withNeck(linkedTo(was, STRAP_YOKE_NECK, sizeId) ? dim('back_neck_width') : was), sizeId, scope, { gives: 'armhole', rows: strap.rows, solving: true });
  // The front neck keeps its shaping (increases per side, as with the neck it had): a wider neck's extra width goes
  // to the centre cast-on (a V gets a flat bottom), as the panels' necks do.
  const k = (first.capTopSts - first.seamSts) / 2;
  const target = Math.round((first.params.backWidth?.value ?? 0) * spc);
  const extra = Math.round(first.params.extraRows?.value ?? 0);
  const grow = first.strap!.backSts + 2 * k - first.neck.backNeck; // 2 × increase rows + back neck increases
  let bn = target + 2 * k - grow + 2 * extra;
  // The back reaches its width with this neck or one stitch wider (as the seam rounds without a strap): the one
  // nearer the neck as it was, so a strap set to the seam the yoke had moves nothing.
  if (Math.abs(bn + 1 - first.neck.backNeck) < Math.abs(bn - first.neck.backNeck)) bn += 1;
  const r = workYoke(project, withNeck(dim(Math.max(1, bn) / spc)), sizeId, scope, { ...strap, perSide: first.neck.perSide });
  r.params.neckWidth = {
    label: 'Neck width (cast on across the back)',
    expr: STRAP_YOKE_NECK,
    plugged: `(${target} + 2 × ${k} − ${grow}${extra ? ` + 2 × ${extra}` : ''}) sts / ${Math.round(spc * 100) / 100}`,
    value: Math.max(1, bn) / spc,
    overridden: false,
    unit: 'cm',
  };
  r.strap = { ...r.strap!, gives: 'neck' };
  if (bn < 1) {
    // Each seam increase row is one more stitch on the back each side: the widest strap that leaves a neck.
    const s0 = first.strap!;
    const backNeckIncs = grow - 2 * s0.incRows;
    const mostRows = Math.floor((target + 2 * k - backNeckIncs + 2 * extra - 1) / 2) + (s0.rows - s0.incRows);
    const most = Math.floor((mostRows / rowsPerCm(project.gauge)) * 10) / 10;
    r.issues.push({
      severity: 'error',
      code: 'yoke.strap-too-wide',
      param: 'backWidth',
      message: `A ${cmText(scope.strap_w)} strap (${strap.rows} rows) leaves no neck: its increases alone make the back ${cmText((grow - 2 * k) / spc)} wide, more than Back width after the markers move (${cmText(target / spc)}).`,
      fix: { text: `Make the strap narrower (about ${cmText(Math.max(0, most))} at most), widen Back width after the markers move, or let the strap give at the armhole.`, fields: [{ target: 'yoke', key: 'backWidth', label: 'Back width after the markers move' }], now: cmText(scope.strap_w), need: `≤ ${cmText(Math.max(0, most))}` },
    });
    r.ok = false;
  } else if (scope.back_neck_width && bn / spc < 0.75 * scope.back_neck_width) {
    r.issues.push({ severity: 'warning', code: 'yoke.strap-narrow-neck', param: 'neckWidth', message: `The ${cmText(scope.strap_w)} strap leaves a ${cmText(bn / spc)} back neck, much narrower than back_neck_width (${cmText(scope.back_neck_width)}): check that the neck goes over the head. A narrower strap, or letting it give at the armhole, keeps the neck.`, fix: { text: `Make the strap narrower (Garment → Strap width), or set Strap gives at to Armhole to keep the neck.`, fields: [{ target: 'settings', key: 'strap', label: 'Strap width' }], now: cmText(bn / spc), need: `≥ ${cmText(0.75 * scope.back_neck_width)}` } });
  }
  return r;
}

/** `strap`: the seam is `rows` long (see `generateYoke`); `solving` = the neck solve's first pass; `perSide` = the front
 * neck increases each side to keep (back start). */
function workYoke(project: Project, spec: YokeSpec, sizeId: Id, scope: Record<string, number>, strap: { gives: StrapGives; rows: number; solving?: boolean; perSide?: number } | null): YokeResult {
  const spc = stitchesPerCm(project.gauge);
  const rpc = rowsPerCm(project.gauge);
  const issues: YokeIssue[] = [];
  const params: Record<string, YokeParam> = {};
  const cardigan = project.garment.opening === 'cardigan';

  const val = (key: string, label: string, d: DimExpr, unit: YokeParam['unit'], extra: Record<string, number> = {}): number => {
    const s = { ...scope, ...extra };
    const overridden = sizeId in d.overrides;
    let value = 0;
    if (overridden) value = d.overrides[sizeId];
    else {
      const r = evaluate(d.expr, scopeFrom(s));
      if (r.ok) value = r.value;
      else issues.push({ severity: 'error', code: 'yoke.expr', param: key, message: `${YOKE_LABELS[key] ?? label}: ${exprErrorText(r.error)}`, fix: fixOf(`Correct the expression in ${YOKE_LABELS[key] ?? label}.`, [field.yoke(key)]) });
    }
    params[key] = { label, expr: d.expr, plugged: plugIn(d.expr, s), value, overridden, unit };
    return value;
  };
  const sts = (cm: number) => Math.round(cm * spc);
  const rowsOf = (cm: number) => Math.round(cm * rpc);

  // ---- cast-on ----
  const seam = Math.max(1, Math.round(val('seamSts', 'Seam stitches', spec.seamSts, 'sts')));
  // The neck opening is cast on across the back; a boat neck widens it (older files have no width: the back neck).
  const neckCm = spec.neck.width ? val('neckWidth', 'Neck width (cast on across the back)', spec.neck.width, 'cm') : scope.back_neck_width ?? 0;
  // A boat neck's back depth (from the strap top); the other necks' back neck is back_neck_drop below the neck point.
  const backDepthCm = spec.neck.backDepth ? val('neckBackDepth', 'Back neck depth', spec.neck.backDepth, 'cm') : scope.back_neck_drop ?? 0;
  const bn = sts(neckCm);
  if (!(bn > 0)) issues.push({ severity: 'error', code: 'yoke.no-back-neck', param: 'neckWidth', message: `The neck width (${cmText(neckCm)}) gives no back neck stitches.`, fix: fixOf(`Make Neck width, cast on across the back at least ${cmText(ceil1(1 / spc))} (now ${cmText(neckCm)}).`, [field.yoke('neckWidth')], { now: cmText(neckCm), need: `≥ ${cmText(ceil1(1 / spc))}` }) });
  const wholeNeck = spec.start === 'neck';
  const closingSts = cardigan ? sts(scope.closing_r ?? 0) : 0;
  // Whole neck: the fronts are cast on too (a cardigan less the closing width, half each side).
  let FL = 1;
  let FR = 1;
  const sr = wholeNeck ? spec.shortRows ?? defaultShortRows() : null;
  if (sr) {
    const fc = Math.max(0, sts(val('frontCo', 'Front cast-on, both fronts', sr.frontCo, 'cm', { neck_w: neckCm })));
    if (cardigan) FL = FR = Math.max(1, Math.round((fc - closingSts) / 2));
    else {
      FL = Math.floor(fc / 2);
      FR = fc - FL;
    }
  }

  // ---- front neck depth and centre (both starts) ----
  const depthCm = val('neckDepth', 'Front neck depth', spec.neck.depth, 'cm');
  const centreCm = val('neckCentre', 'Front neck centre', spec.neck.centre, 'cm', { neck_w: neckCm, neck_depth: depthCm });

  // ---- whole neck: short rows ----
  // A front neck deeper than the short rows give (`deep`): each front is cast on with what the turns need, and the rest
  // of the neck is worked as the back start's: increases inside the edge stitch on the rows after the short rows, then
  // the centre cast-on (a pullover is flat until then) or a cardigan's front-edge cast-ons.
  const plain = new Set<number>();
  let shortRows: YokeResult['shortRows'] = null;
  let deep: { R: number; perSide: number; centre: number; frontEdgeCo: number; opening: number } | null = null;
  if (sr) {
    const full = Math.min(FL, FR);
    // The centre part (lowest, never turned in): half each side, from the front edge.
    const centreAll = spec.neck.shape === 'square' ? FL + FR : spec.neck.shape === 'v' ? 0 : Math.min(FL + FR, sts(centreCm));
    let cSide = Math.max(0, Math.floor(centreAll / 2) - (cardigan ? Math.round(closingSts / 2) : 0));
    // The short rows work the neck up to the shape's default depth; a deeper neck only a crew neck's (front_neck_drop).
    const shapeDepth = evaluate(FRONT_NECKS[bodiceNeck(spec.neck.shape)].depth, scopeFrom({ ...scope, neck_w: neckCm }));
    const dflt = shapeDepth.ok ? shapeDepth.value : depthCm;
    const srDepth = depthCm <= dflt + 1e-9 ? depthCm : Math.min(dflt, scope.front_neck_drop ?? dflt);
    const pairs = Math.max(0, Math.round(val('srPairs', 'Short-row pairs', sr.pairs, '', { neck_depth: depthCm, back_depth: backDepthCm, sr_depth: srDepth })));
    const first = Math.max(1, Math.round(val('srFirst', 'First turn, sts past the shoulder marker', sr.first, 'sts')));
    const end0 = pairs > 0 ? 2 * pairs + 1 : 0;
    const neckRows0 = rowsOf(Math.max(0, depthCm - backDepthCm));
    if (neckRows0 >= end0 + 2) {
      // Turns 2 sts apart where they fit in the neck's sloped part (closer where they don't: a square neck's fronts
      // take the fewest), inside the edge stitch.
      const need = (st: number) => (pairs > 0 ? first + 1 + st * Math.max(0, pairs - 1) : 1);
      const slope = full - cSide;
      const st = pairs > 1 && need(2) > slope ? Math.max(1, Math.floor((slope - first - 1) / (pairs - 1))) : 2;
      let castOn = Math.max(1, Math.min(full, need(st)));
      const R = neckRows0 % 2 ? neckRows0 : neckRows0 + 1;
      let n = Math.max(0, full - cSide - castOn);
      // Each increase on its own row after the short rows (a V: RS rows), before the closing row; any left over widen the
      // fronts' cast-on.
      let room = 0;
      for (let r = end0 + 1; r < R; r++) if (spec.neck.shape !== 'v' || r % 2 === 1) room++;
      if (n > room) {
        castOn += n - room;
        n = room;
      }
      const frontEdgeCo = cardigan ? Math.max(0, full - castOn - n) : 0;
      const centre = cardigan ? 2 * frontEdgeCo + closingSts : FL + FR - 2 * castOn - 2 * n;
      deep = { R, perSide: n, centre, frontEdgeCo, opening: centre + 2 * n };
      FL = FR = castOn;
      cSide = 1;
    }
    const side = Math.min(FL, FR);
    const step = Math.max(1, Math.round(val('srStep', 'Sts between turns', sr.step, 'sts', { front_side: side, centre_side: cSide, first_turn: first, pairs })));
    const turns: number[] = [];
    for (let i = 0; i < pairs; i++) turns.push(side - first - i * step);
    const lastTurn = turns[turns.length - 1] ?? side;
    if (pairs && lastTurn < 1) issues.push({ ...shortRowsFitFix(pairs, side, first, step), message: `Short rows: ${pairs} pairs ${step} st${step === 1 ? '' : 's'} apart don't fit in a front of ${stsCm(side, spc)}: the last turn is past centre front.` });
    else if (pairs && lastTurn < cSide) issues.push({ severity: 'info', code: 'yoke.short-rows-centre', message: `Short rows: the last turns reach into the centre part (${cSide} sts each side of centre front).` });
    if (pairs > 1 && step < 2) issues.push({ severity: 'info', code: 'yoke.short-rows-close', message: `Short rows: turns 1 st apart. Fewer pairs or a wider front cast-on spread them more.` });
    const endRow = pairs > 0 ? 2 * pairs + 1 : 0;
    if (!cardigan && pairs > 0 && !deep) {
      plain.add(1);
      plain.add(endRow);
    }
    shortRows = { pairs, first, step, turns: turns.map((u) => Math.max(1, u)), endRow, frontSts: FL + FR, ...(deep ? { frontNeck: { castOn: FL, opening: deep.opening, backDepth: backDepthCm } } : {}) };
  }
  const castOnZones: ZoneCounts = { leftFront: FL, leftSleeve: seam, back: bn, rightSleeve: seam, rightFront: FR };
  const castOn = sum(castOnZones);
  // The fronts are open at the neck until a closing cast-on: the back start, or a whole neck deeper than its short rows.
  const openFront = !wholeNeck || !!deep;

  // ---- phase B: back neck increases on RS rows over the first `rows` rows ----
  const bPer = Math.max(0, Math.round(val('backNeckPerRow', 'Back neck increases per row', spec.backNeck.perRow, 'sts')));
  const bRows = Math.max(0, Math.round(val('backNeckRows', 'Back neck rows', spec.backNeck.rows, 'rows')));
  const bIncRows: number[] = [];
  for (let r = 1; r <= bRows; r += 2) if (!plain.has(r)) bIncRows.push(r);
  const bTotal = bPer * bIncRows.length;
  if (bPer && (bPer < 2 || bPer > 4)) issues.push({ severity: 'info', code: 'yoke.back-neck-rate', message: `Back neck: ${bPer} increases per row (the method suggests 2 to 4).` });

  // ---- cap top: the markers move so each seam group widens to the cap top ----
  const capTop = Math.max(seam, Math.round(val('capTopSts', 'Cap top stitches', spec.cap.topSts, 'sts')));
  let k = (capTop - seam) / 2;
  if (!Number.isInteger(k)) {
    const even = seam + 2 * Math.floor(k);
    issues.push({ severity: 'warning', code: 'yoke.cap-top-odd', param: 'capTopSts', message: `Cap top ${capTop} sts − seam ${seam} sts is odd; the markers move ${Math.floor(k)} st each side (cap top ${even} sts).`, fix: fixOf(`Make Cap top stitches ${even} or ${even + 2} (now ${capTop}): the seam stitches plus an even number.`, [field.yoke('capTopSts')], { now: String(capTop), need: `${even} or ${even + 2}`, apply: { field: field.yoke('capTopSts'), value: even, unit: 'sts' } }) });
    k = Math.floor(k);
  }
  const capTopSts = seam + 2 * k;

  // ---- phase A: shoulder rows ----
  const extra = Math.round(val('extraRows', 'Extra seam rows', spec.shoulder.extraRows, 'rows'));
  // The shoulders need A increase rows; the half rows of a pullover's short rows make none.
  const incRowsTo = (r: number) => {
    let n = 0;
    for (let i = 1; i <= r; i++) if (!plain.has(i)) n++;
    return n;
  };
  let A: number;
  let strapOut: YokeResult['strap'];
  if (strap) {
    // The strap is the seam: A rows of it. Back after A and the marker move = bn + 2 × increase rows + B − 2k.
    A = strap.rows;
    const backSts = bn + 2 * incRowsTo(A) + bTotal - 2 * k;
    if (strap.gives === 'armhole' && !strap.solving) {
      params.backWidth = { label: 'Back width after the shoulders', expr: STRAP_YOKE_BACK, plugged: `(${bn} + 2 × ${incRowsTo(A)}${bTotal ? ` + ${bTotal}` : ''}${k ? ` − 2 × ${k}` : ''}) sts / ${Math.round(spc * 100) / 100}`, value: backSts / spc, overridden: false, unit: 'cm' };
      const cb = scope.cross_back_w ?? scope.cross_back;
      issues.push({ severity: 'info', code: 'yoke.strap-armhole', param: 'backWidth', message: `The strap gives at the armhole: the neck stays and the back is ${cmText(backSts / spc)} after the markers move${cb !== undefined ? `, so the cross back (${cmText(cb)}) is no longer followed` : ''}. By design: set Strap gives at to Neck to follow it.` });
    } else val('backWidth', 'Back width after the shoulders', spec.shoulder.backWidth, 'cm');
    strapOut = { gives: strap.gives, rows: A, incRows: incRowsTo(A), neckSts: bn, backSts };
  } else if (spec.shoulder.mode === 'length') {
    const len = val('shoulderLength', 'Shoulder seam length', spec.shoulder.length, 'cm');
    const shorten = val('shorten', 'Shorten the seam by', spec.shoulder.shorten, 'cm');
    A = rowsOf(len - shorten) + extra;
  } else {
    const target = sts(val('backWidth', 'Back width after the shoulders', spec.shoulder.backWidth, 'cm'));
    // back after A and the marker move = bn + 2A + B − 2k
    A = Math.round((target + 2 * k - bn - bTotal) / 2) + extra;
  }
  if (A < 1) {
    // The back after A rows is bn + 2A + B − 2k sts: A ≥ 1 needs a target (or seam length) this big.
    const fix: IssueFix =
      spec.shoulder.mode === 'length'
        ? fixOf(`Make Shoulder seam length less Shorten the seam by at least ${cmText(ceil1((1 - extra) / rpc))} (now ${cmText(params.shoulderLength.value - params.shorten.value)}), or Extra rows at least ${extra + 1 - A}.`, [field.yoke('shoulderLength'), field.yoke('shorten'), field.yoke('extraRows')], { now: cmText(params.shoulderLength.value - params.shorten.value), need: `≥ ${cmText(ceil1((1 - extra) / rpc))}`, apply: { field: field.yoke('extraRows'), value: extra + 1 - A, unit: 'rows' } })
        : (() => {
            const need = Math.ceil(((1 - 2 * extra - 2 * k + bn + bTotal) / spc) * 10) / 10;
            return fixOf(`Make Back width after the markers move at least ${cmText(need)} (now ${cmText(params.backWidth.value)}), narrow the Neck width, or make Extra rows at least ${extra + 1 - A}.`, [field.yoke('backWidth'), field.yoke('neckWidth'), field.yoke('extraRows')], { now: cmText(params.backWidth.value), need: `≥ ${cmText(need)}`, apply: { field: field.yoke('extraRows'), value: extra + 1 - A, unit: 'rows' } });
          })();
    issues.push({ severity: 'error', code: 'yoke.shoulder-phase', param: spec.shoulder.mode === 'length' ? 'shoulderLength' : 'backWidth', fix, message: spec.shoulder.mode === 'length' ? `The shoulder phase has ${A} rows: the shoulder seam is too short to work.` : `The shoulder phase has ${A} rows: the back neck (${cmText(bn / spc)}) is already as wide as Back width after the markers move (${cmText(params.backWidth.value)}).` });
    A = Math.max(1, A);
  }
  if (plain.size && spec.shoulder.mode !== 'length' && !strap) {
    const need = A;
    while (incRowsTo(A) < need) A++;
  }
  const AincRows = incRowsTo(A);
  if (bRows > A) issues.push({ severity: 'info', code: 'yoke.back-neck-past-shoulders', message: `Back neck increases (rows 1–${bRows}) run past the shoulder phase (${A} rows).` });

  // ---- yoke depth (the split row); may deepen further below so the cap isn't mostly rapid ----
  let Y0: number;
  if (spec.depth.mode === 'armhole') {
    Y0 = A + rowsOf(scope.armhole_depth ?? 0);
    params.backLength = { label: 'Armhole depth below the seam', expr: 'armhole_depth', plugged: String(scope.armhole_depth ?? 0), value: scope.armhole_depth ?? 0, overridden: false, unit: 'cm' };
  } else {
    Y0 = rowsOf(val('backLength', 'Back length, neck to underarm', spec.depth.backLength, 'cm', { neck_w: neckCm, back_depth: backDepthCm }));
  }
  Y0 += rowsOf(val('extraDepth', 'Extra yoke depth', spec.depth.extra, 'cm'));

  // ---- front neck (back start) ----
  // The fronts start at the neck points: the neck opening is the back neck. V: no centre; square: all centre.
  // A whole-neck start has none of this (no neck increases and no cast-on; the short rows end on row R), unless it is
  // deeper than its short rows: then the increases follow them.
  const centreRaw = spec.neck.shape === 'square' ? bn : spec.neck.shape === 'v' ? 0 : Math.min(bn, sts(centreCm));
  const perSide = deep ? deep.perSide : wholeNeck ? 0 : strap?.perSide !== undefined ? Math.min(strap.perSide, Math.floor(bn / 2)) : Math.max(0, Math.floor((bn - centreRaw) / 2));
  const centre = deep ? deep.centre : bn - 2 * perSide; // pullover cast-on at centre front
  const depthRows = Math.max(1, rowsOf(depthCm));
  let R = depthRows;
  if (R % 2 === 0) R += 1; // the centre is cast on at the end of a RS row
  if (deep) R = deep.R;
  else if (shortRows) R = shortRows.endRow;
  // The first row a front neck increase can go on (after the short rows).
  const lo = deep && shortRows ? shortRows.endRow + 1 : 1;
  const neckRows: number[] = [];
  if (perSide > 0) {
    if (spec.neck.shape === 'v') {
      const s = distributeAuto(perSide, { from: lo, to: R - 1 }, { side: 'rs', align: 'start' });
      // Each increase on its own RS row before the cast-on row: R − 1 ≥ 2 × perSide − 1.
      const deeper = ceil1((2 * perSide) / rpc);
      for (const w of s.warnings) issues.push({ severity: 'warning', code: 'yoke.front-neck-rows', param: 'neckDepth', message: `Front neck: ${w}`, fix: fixOf(`Make Depth below the neck point at least ${cmText(deeper)} (now ${cmText(depthCm)}) so each of the ${perSide} increases has its own RS row.`, [field.yoke('neckDepth')], { now: cmText(depthCm), need: `≥ ${cmText(deeper)}`, apply: { field: field.yoke('neckDepth'), value: deeper, unit: 'cm' } }) });
      neckRows.push(...s.rows);
    } else {
      // Every row next to the centre (the last rows before the cast-on), then every other row above.
      const fast = Math.ceil(perSide / 2);
      const dists: number[] = [];
      for (let d = 1; d <= fast; d++) dists.push(d);
      for (let j = fast, d = fast + 2; j < perSide; j++, d += 2) dists.push(d);
      if (dists[dists.length - 1] > R - lo) {
        const s = distributeAuto(perSide, { from: lo, to: R - 1 }, { side: 'any', align: 'start' });
        const deeper = ceil1((perSide + 1) / rpc);
        if (!s.feasible) issues.push({ severity: 'error', code: 'yoke.front-neck-fit', param: 'neckDepth', message: `Front neck: ${perSide} increases per side do not fit in ${rowsCm(R - 1, rpc)}.`, fix: fixOf(`Make Depth below the neck point at least ${cmText(deeper)} (now ${cmText(depthCm)}), or a wider Centre.`, [field.yoke('neckDepth'), field.yoke('neckCentre')], { now: cmText(depthCm), need: `≥ ${cmText(deeper)}`, apply: { field: field.yoke('neckDepth'), value: deeper, unit: 'cm' } }) });
        neckRows.push(...s.rows);
      } else neckRows.push(...dists.map((d) => R - d));
    }
  }
  const neckSet = new Set(neckRows);
  // Cardigan: each front casts on its share of the centre at its front edge, less half the closing width (bands).
  const frontEdgeCo = deep ? deep.frontEdgeCo : cardigan && !wholeNeck ? Math.max(0, Math.round((centre - closingSts) / 2)) : 0;
  if (cardigan && project.edges?.frontBands.enabled && project.cardigan?.attach && Object.values(project.cardigan.attach).includes('integrated')) {
    issues.push({ severity: 'warning', code: 'yoke.integrated-bands', message: 'Integrated front bands are not worked into a contiguous yoke yet; the yoke has none.', fix: fixOf('Pick up or sew on the front bands instead (Garment → Edges → Front bands).', [field.settings('edges')]) });
  }

  // ---- body at the split (before body increases) and the underarm cast-on ----
  const backAtSplit = bn + 2 * AincRows + bTotal - 2 * k;
  const closing = cardigan ? 2 * frontEdgeCo : centre;
  const frontsAtSplit = deep ? FL + FR + 2 * (AincRows - k + perSide) + closing : wholeNeck ? FL + FR + 2 * (AincRows - k) : 2 * (1 + A + perSide - k) + closing;
  const bodyYoke = backAtSplit + frontsAtSplit;
  const bodyCm = val('bodyWidth', 'Body at the underarm', spec.body.width, 'cm');
  const bodyTarget = sts(bodyCm - (cardigan ? scope.closing_r ?? 0 : 0));
  const zoneFrac = Math.min(1, Math.max(0, val('bodyZone', 'Body increases over', spec.body.zone, '')));
  const N0 = Math.max(0, sts(val('underarmCo', 'Underarm cast-on', spec.underarm.castOn, 'cm')));
  const sleeveFull = sts(val('sleeveWidth', 'Sleeve at the underarm', spec.sleeveWidth, 'cm'));
  const rapidBase = Math.max(0, Math.round(val('rapidRows', 'Rapid cap rows', spec.cap.rapidRows, 'rows')));
  const maxRapid = Math.min(1, Math.max(0, val('maxRapid', 'Rapid rows at most (of the armhole)', spec.depth.maxRapid, '')));
  const joinRow = cardigan ? null : R;
  const isRound = (r: number) => joinRow !== null && r > joinRow;
  const isRS = (r: number) => isRound(r) || r % 2 === 1;

  /** Everything below the shoulders for a split after row Y: body increases, underarm cast-on, cap rows. */
  const planArmhole = (Y: number) => {
    const notes: YokeIssue[] = [];
    const X = Y - A;
    const zoneRows = Math.max(0, Math.round(zoneFrac * X));
    let perEdge = 0;
    let N: number;
    if (!spec.body.increases) {
      N = Math.round((bodyTarget - bodyYoke) / 2);
      if (N < 0) {
        const need = ceil1(bodyYoke / spc + (cardigan ? scope.closing_r ?? 0 : 0));
        notes.push({ severity: 'error', code: 'yoke.body-too-wide', param: 'bodyWidth', message: `The yoke body (${stsCm(bodyYoke, spc)}) is already ${stsCm(-2 * N, spc)} wider than Body at the underarm (${cmText(bodyCm)}): the underarm cast-on would be ${N} sts.`, fix: fixOf(`Make Body at the underarm at least ${cmText(need)} (now ${cmText(bodyCm)}), or shorten the shoulders (a narrower Back width after the markers move or Shoulder seam length).`, [field.yoke('bodyWidth'), field.yoke(spec.shoulder.mode === 'length' ? 'shoulderLength' : 'backWidth')], { now: cmText(bodyCm), need: `≥ ${cmText(need)}` }) });
      }
    } else {
      N = N0;
      const need = bodyTarget - bodyYoke - 2 * N;
      perEdge = Math.max(0, Math.ceil(need / 4));
      if (need < 0) {
        const most = floor1(Math.max(0, Math.floor((bodyTarget - bodyYoke) / 2)) / spc);
        notes.push({ severity: 'warning', code: 'yoke.body-wider', param: 'underarmCo', message: `With ${N} sts cast on at each underarm the body is ${stsCm(-need, spc)} wider than Body at the underarm (${cmText(bodyCm)}).`, fix: fixOf(`Make Underarm cast-on, each at most ${cmText(most)} (now ${cmText(N / spc)}), or a wider Body at the underarm.`, [field.yoke('underarmCo'), field.yoke('bodyWidth')], { now: cmText(N / spc), need: `≤ ${cmText(most)}`, apply: { field: field.yoke('underarmCo'), value: most, unit: 'cm' } }) });
      }
      if (perEdge > zoneRows) {
        N = Math.ceil((bodyTarget - bodyYoke - 4 * zoneRows) / 2);
        perEdge = zoneRows;
        notes.push({ severity: 'info', code: 'yoke.underarm-raised', message: `Body increases fill the lower ${zoneRows} armhole rows; the underarm cast-on is raised from ${N0} to ${N} sts.` });
      }
    }
    N = Math.max(0, N);
    const bodyRows: number[] = [];
    if (perEdge > 0) {
      // Never in the short rows (their half rows don't reach every edge).
      const s = distributeAuto(perEdge, { from: Math.max(Y - zoneRows + 1, (shortRows?.endRow ?? 0) + 1), to: Y }, { side: 'any', align: 'end', order: 'longFirst' });
      for (const w of s.warnings) notes.push({ severity: 'warning', code: 'yoke.body-increase-rows', param: 'bodyZone', message: `Body increases: ${w}`, fix: fixOf(`Spread them over more rows: a larger Body increases over (now ${zoneFrac}), or more Extra depth.`, [field.yoke('bodyZone'), field.yoke('extraDepth')], { now: String(zoneFrac) }) });
      bodyRows.push(...s.rows);
    }
    // Sleeve: rapid (every row), then slow (every second row: RS rows / every other round) to the split.
    const sleeveTarget = sleeveFull - N;
    const slowRows = (C: number) => {
      const out: number[] = [];
      let r = A + C + 1;
      while (r <= Y && !isRS(r)) r++;
      for (; r <= Y; r += 2) if (!plain.has(r)) out.push(r);
      return out;
    };
    const rapid = (C: number) => incRowsTo(A + C) - incRowsTo(A);
    const sleeveMax = (C: number) => capTopSts + 2 * rapid(C) + 2 * slowRows(C).length;
    let C = Math.min(rapidBase, Math.max(0, X));
    if (spec.cap.solve) while (C < X && sleeveMax(C) < sleeveTarget) C++;
    const reached = sleeveMax(C) >= sleeveTarget;
    const dNeed = Math.max(0, Math.ceil((sleeveTarget - (capTopSts + 2 * rapid(C))) / 2));
    const dRows = slowRows(C).slice(0, dNeed);
    const D = dRows.length ? dRows[dRows.length - 1] - (A + C) : 0;
    return { Y, X, zoneRows, perEdge, N, bodyRows, sleeveTarget, C, D, dRows, reached, sleeveMax: sleeveMax(C), notes };
  };

  // Deepen the yoke a row at a time (up to 15 cm) until the sleeve reaches its width with at most `maxRapid` of the
  // armhole rows rapid.
  let plan = planArmhole(Y0);
  const fits = (pl: ReturnType<typeof planArmhole>) => pl.reached && pl.C <= maxRapid * pl.X;
  if (spec.depth.deepen && spec.cap.solve) {
    const limit = Y0 + rowsOf(15);
    while (!fits(plan) && plan.Y < limit) plan = planArmhole(plan.Y + 1);
    if (plan.Y > Y0) issues.push({ severity: 'info', code: 'yoke.deepened', message: `Yoke deepened by ${plan.Y - Y0} rows (${((plan.Y - Y0) / rpc).toFixed(1)} cm) so the sleeve reaches its width with at most ${Math.round(maxRapid * 100)} % of the armhole rows rapid.` });
  }
  const { Y, X, perEdge, N, bodyRows, sleeveTarget, C, D, dRows, zoneRows } = plan;
  issues.push(...plan.notes);
  if (X < 2) {
    const add = ceil1((A + 2 - Y) / rpc);
    const extraNow = params.extraDepth?.value ?? 0;
    issues.push({ severity: 'error', code: 'yoke.armhole-short', param: 'extraDepth', message: `The armhole has ${rowsCm(X, rpc)} after the shoulder phase (${A} of the yoke's ${Y} rows).`, fix: fixOf(`Add ${cmText(add)} to Extra depth (now ${cmText(extraNow)}), or shorten the shoulders.`, [field.yoke('extraDepth'), field.yoke(spec.shoulder.mode === 'length' ? 'shoulderLength' : 'backWidth')], { now: cmText(extraNow), need: `≥ ${cmText(extraNow + add)}`, apply: { field: field.yoke('extraDepth'), value: Math.round((extraNow + add) * 10) / 10, unit: 'cm' } }) });
  }
  if (!plan.reached) {
    const have = plan.sleeveMax + N;
    const coNeed = ceil1((sleeveFull - plan.sleeveMax) / spc);
    issues.push({
      severity: 'warning',
      code: 'yoke.sleeve-short',
      param: spec.cap.solve ? 'extraDepth' : 'rapidRows',
      message: `The sleeve reaches ${stsCm(have, spc)} at the underarm, ${stsCm(sleeveTarget + N - have, spc)} short of Sleeve at the underarm${spec.cap.solve ? ', even with every armhole row rapid' : ''}.`,
      fix: spec.cap.solve
        ? fixOf(`Add Extra depth, or make Underarm cast-on, each at least ${cmText(coNeed)} (now ${cmText(N / spc)}).`, [field.yoke('extraDepth'), field.yoke('underarmCo')], { now: cmText(N / spc), need: `≥ ${cmText(coNeed)}` })
        : fixOf(`Make Rapid rows longer (now ${rapidBase}), or tick Lengthen the rapid phase.`, [field.yoke('rapidRows')], { now: String(rapidBase) }),
    });
  }
  let neckContinues: YokeResult['neckContinues'];
  if (shortRows && shortRows.endRow > Y) issues.push({ ...belowSplitFix(shortRows.endRow, Y, rpc, shortRows.pairs), message: `The short rows end on row ${shortRows.endRow}, ${rowsCm(shortRows.endRow - Y, rpc)} below the underarm split (row ${Y}).` });
  else if (openFront && continuesPast(R, Y, cardigan, frontEdgeCo)) {
    const c = neckContinuation(R, Y, rpc, neckRows, centre, frontEdgeCo, cardigan);
    neckContinues = c.neckContinues;
    issues.push(c.issue);
  }
  if (deep && shortRows) issues.push(deepNeckNote(shortRows, deep, depthCm, backDepthCm, rpc, cardigan));
  const E = Math.max(0, Y - A - C - D);
  const bodySet = new Set(bodyRows);
  const dSet = new Set(dRows);
  if (spec.cap.solve && C > rapidBase) issues.push({ severity: 'info', code: 'yoke.rapid-lengthened', message: `Rapid cap rows lengthened from ${rapidBase} to ${C} so the sleeve reaches its width.` });
  if (C > X / 2) issues.push({ severity: 'info', code: 'yoke.cap-flat', message: `Hint: the cap may look flat: ${C} of the ${X} armhole rows are rapid. A deeper yoke gives a rounder cap.` });

  // ---- simulate ----
  const sym = incSymbols(spec);
  const z: ZoneCounts = { ...castOnZones };
  const rows: YokeRow[] = [];
  let endOfA: ZoneCounts = { ...z };
  for (let r = 1; r <= Math.max(Y, 0); r++) {
    const phase: YokePhase = r <= A ? 'A' : r <= A + C ? 'C' : r <= A + C + D ? 'D' : 'E';
    const incs: YokeInc[] = [];
    const castOns: YokeCastOn[] = [];
    const markersMoved = r === A + 1 && k > 0;
    if (markersMoved) {
      z.leftFront -= k;
      z.back -= 2 * k;
      z.rightFront -= k;
      z.leftSleeve += 2 * k;
      z.rightSleeve += 2 * k;
    }
    // What this row increases: the body side of the seams (phase A every row, then the body increases), the
    // sleeves (every row in C, every second row in D), the back neck (phase B) and the front neck edges.
    const isPlain = plain.has(r);
    const seamLike = (phase === 'A' || bodySet.has(r)) && !isPlain;
    const sleeveInc = (phase === 'C' || dSet.has(r)) && !isPlain;
    const bIndex = bPer > 0 ? bIncRows.indexOf(r) : -1;
    const neck = neckSet.has(r) && r < R;
    const b0 = z.back;
    let bPos: number[] = [];
    if (bIndex >= 0) {
      const manual = spec.backNeck.manual[sizeId]?.[bIndex];
      bPos = [...(manual && manual.length === bPer ? manual : backNeckPositions(b0, bPer, bIndex))].sort((a, b) => a - b);
    }
    z.leftFront += (seamLike ? 1 : 0) + (neck ? 1 : 0);
    z.rightFront += (seamLike ? 1 : 0) + (neck ? 1 : 0);
    z.back += (seamLike ? 2 : 0) + bPos.length;
    if (sleeveInc) {
      z.leftSleeve += 2;
      z.rightSleeve += 2;
    }
    // Indices of the new stitches within each zone after the row, as seen from the RS.
    if (neck) {
      // Inside the edge stitch at each front edge (the left end of the left front, the right end of the right).
      incs.push({ zone: 'leftFront', at: 1, symbol: sym.after, kind: 'neck' });
      incs.push({ zone: 'rightFront', at: z.rightFront - 2, symbol: sym.before, kind: 'neck' });
    }
    if (seamLike) {
      const kind = phase === 'A' ? 'seam' : 'body';
      incs.push({ zone: 'leftFront', at: z.leftFront - 1, symbol: sym.before, kind });
      incs.push({ zone: 'back', at: 0, symbol: sym.after, kind });
      incs.push({ zone: 'back', at: z.back - 1, symbol: sym.before, kind });
      incs.push({ zone: 'rightFront', at: 0, symbol: sym.after, kind });
    }
    // Back neck: increase after stitch p of the back (counted before this row), shifted by the earlier ones.
    bPos.forEach((p, j) => incs.push({ zone: 'back', at: (seamLike ? 1 : 0) + p + 1 + j, symbol: j < bPer / 2 ? sym.before : sym.after, kind: 'backNeck' }));
    if (sleeveInc) {
      for (const sl of ['leftSleeve', 'rightSleeve'] as const) {
        incs.push({ zone: sl, at: 0, symbol: sym.after, kind: 'sleeve' });
        incs.push({ zone: sl, at: z[sl] - 1, symbol: sym.before, kind: 'sleeve' });
      }
    }
    // Front neck closes: pullover casts on the centre and joins; a cardigan casts on at each front edge.
    if (r === R && openFront && !neckContinues) {
      if (!cardigan) {
        const half = Math.floor(centre / 2);
        z.leftFront += half;
        z.rightFront += centre - half;
        castOns.push({ zone: 'rightFront', count: centre, where: 'centre-front' });
      } else if (frontEdgeCo > 0) {
        z.rightFront += frontEdgeCo;
        castOns.push({ zone: 'rightFront', count: frontEdgeCo, where: 'front-edge' });
      }
    }
    if (cardigan && openFront && r === R + 1 && frontEdgeCo > 0 && r <= Y) {
      z.leftFront += frontEdgeCo;
      castOns.push({ zone: 'leftFront', count: frontEdgeCo, where: 'front-edge' });
    }
    const row: YokeRow = { row: r, phase, backNeck: bIndex >= 0, neck, round: isRound(r), rs: isRS(r), markersMoved, zones: { ...z }, total: sum(z), incs, castOns };
    if (shortRows && r <= shortRows.endRow) Object.assign(row, shortRowSpan(shortRows, r, row, cardigan || !!deep), isPlain ? { plain: true } : {});
    rows.push(row);
    if (r === A) endOfA = { ...z };
  }

  // ---- results ----
  for (const row of rows) {
    for (const zone of ZONES) {
      if (row.zones[zone] < 0) {
        issues.push({ severity: 'error', code: 'yoke.zone-negative', message: `Row ${row.row}: the ${zoneName(zone)} has ${row.zones[zone]} sts.`, fix: fixOf('Fewer Cap top stitches (the markers move less), or a wider Neck width, cast on across the back.', [field.yoke('capTopSts'), field.yoke('neckWidth')]) });
        break;
      }
    }
  }
  if (k > 0 && (endOfA.leftFront <= k || endOfA.back <= 2 * k)) {
    const kMax = Math.max(0, Math.min(endOfA.leftFront - 1, Math.floor((endOfA.back - 1) / 2)));
    issues.push({ severity: 'error', code: 'yoke.markers-move', param: 'capTopSts', message: `The markers can't move ${k} sts: the fronts have ${endOfA.leftFront} sts at the end of the shoulders.`, fix: fixOf(`Make Cap top stitches at most ${seam + 2 * kMax} (now ${capTopSts}), or work longer shoulders.`, [field.yoke('capTopSts')], { now: String(capTopSts), need: `≤ ${seam + 2 * kMax}`, apply: { field: field.yoke('capTopSts'), value: seam + 2 * kMax, unit: 'sts' } }) });
  }
  if (rows.some((r) => r.total <= 0)) issues.push({ severity: 'error', code: 'yoke.empty-row', message: 'A row has no stitches.', fix: fixOf('Check the cast-on: Neck width, cast on across the back and Seam stitches.', [field.yoke('neckWidth'), field.yoke('seamSts')]) });

  const last = rows[rows.length - 1]?.zones ?? z;
  const held = { leftSleeve: last.leftSleeve, body: last.leftFront + last.back + last.rightFront, rightSleeve: last.rightSleeve };
  if (Object.values(held).some((v) => v <= 0)) issues.push({ severity: 'error', code: 'yoke.held-empty', message: `Nothing to hold at the split: sleeves ${held.leftSleeve} / body ${held.body} / sleeves ${held.rightSleeve} sts.`, fix: fixOf('Check Sleeve at the underarm, Body at the underarm and Underarm cast-on, each.', [field.yoke('sleeveWidth'), field.yoke('bodyWidth'), field.yoke('underarmCo')]) });

  // Phase table.
  const stsAt = (r: number) => (r <= 0 ? castOn : rows[Math.min(r, rows.length) - 1]?.total ?? castOn);
  const phases: PhaseSummary[] = [];
  const add = (id: PhaseSummary['id'], label: string, from: number, to: number, incsPerRow: string) => {
    if (to >= from) phases.push({ id, label, from, to, stsBefore: stsAt(from - 1), stsAfter: stsAt(to), incsPerRow });
  };
  add('A', 'Shoulders', 1, A, '4 every row');
  if (bIncRows.length && bPer) add('B', 'Back neck', 1, Math.min(bIncRows[bIncRows.length - 1], Y), `${bPer} every 2nd row (with A)`);
  if (deep && shortRows) {
    const close = cardigan ? `cast on ${frontEdgeCo} at each front edge` : `cast on ${centre}, then in the round`;
    add('neck', neckContinues ? 'Short rows, then front neck (continues into the body)' : 'Short rows, then front neck', 1, Math.min(R, Y), `${shortRows.pairs} pairs, then ${perSide} per side${neckContinues ? ` (${perSide - neckContinues.perSide} in the yoke)` : `, ${close}`}`);
  } else if (shortRows) {
    if (shortRows.pairs) add('neck', 'Short rows (neck)', 1, Math.min(R, Y), `${shortRows.pairs} pairs, German short rows${cardigan ? '' : ', then in the round'}`);
  } else if (neckContinues) add('neck', 'Front neck, continues into the body', 1, Y, `${perSide - neckContinues.perSide} of ${perSide} per side`);
  else if (perSide > 0 || R <= Y) add('neck', cardigan ? 'Front neck (open)' : 'Front neck, joined', 1, Math.min(R, Y), `${perSide} per side${cardigan ? '' : `, cast on ${centre}`}`);
  add('C', 'Cap, rapid', A + 1, A + C, '4 every row');
  add('D', 'Cap, slow', A + C + 1, A + C + D, '4 every 2nd row');
  add('E', 'Armhole, straight', A + C + D + 1, Y, perEdge ? `body: ${perEdge} per edge` : 'none');

  const seamCm = A / rpc;
  const gapAtA = cardigan || !openFront ? 0 : R <= A ? 0 : Math.max(0, centre + 2 * perSide - 2 * neckRows.filter((r) => r <= A).length);
  const across = perEdge / spc;
  const lowRows = zoneRows / rpc;
  const edgeLen = X / rpc - lowRows + Math.hypot(lowRows, across);
  const okNow = !issues.some((i) => i.severity === 'error');
  return {
    ok: okNow,
    issues,
    castOn,
    castOnZones,
    rows,
    phases,
    params,
    counts: { A, B: bRows, C, D, E, total: Y, neckRow: shortRows && !shortRows.pairs ? null : R, joinRow, rapidBase },
    start: wholeNeck ? 'neck' : 'back',
    shortRows,
    seamSts: seam,
    capTopSts,
    held,
    underarmCo: N,
    bodyIncs: { perEdge, rows: bodyRows },
    endOfA,
    neck: { depthRows, row: R, perSide, backNeck: bn, centre, closingSts, frontEdgeCo },
    ...(neckContinues ? { neckContinues } : {}),
    derived: {
      seamCm,
      backEndOfACm: endOfA.back / spc,
      frontEndOfACm: (endOfA.leftFront + endOfA.rightFront + gapAtA) / spc,
      sleeveCm: (held.leftSleeve + N) / spc,
      bodyCm: (held.body + 2 * N + neckRest(neckContinues, cardigan)) / spc,
      armholeCm: 2 * edgeLen + (capTopSts + N) / spc,
      backLengthCm: Y / rpc,
    },
    stitchesPerCm: spc,
    rowsPerCm: rpc,
    ...(strapOut ? { strap: strapOut } : {}),
  };
}

/**
 * The stitches a short-row-section row works ([from, to) in row order) and where it turns. Turns are counted from each
 * front's centre-front end, which the seam increases (at the other end) don't move. RS rows run from high to low
 * indices: they turn in the left front, WS rows in the right front. A pullover's row 1 runs from the round's start
 * (the left back shoulder marker) to the first turn and the last row from the last turn back to it; a cardigan's
 * row 1 starts at the right front edge and its last row ends at the left front edge.
 */
export function shortRowSpan(sr: NonNullable<YokeResult['shortRows']>, r: number, row: YokeRow, cardigan: boolean): Pick<YokeRow, 'span' | 'turn'> {
  const u = sr.turns;
  const n = sr.pairs;
  const T = row.total;
  const bor = row.zones.leftFront + row.zones.leftSleeve;
  if (r === 2 * n + 1) return { span: cardigan ? [0, T - u[n - 1]] : [bor, T - u[n - 1]] };
  const i = Math.ceil(r / 2) - 1; // pair index
  if (r % 2 === 1) {
    const from = r === 1 ? (cardigan ? T : bor) : T - u[i - 1];
    return { span: [u[i], from], turn: { side: 'left', at: u[i] } };
  }
  return { span: [u[i], T - u[i]], turn: { side: 'right', at: T - u[i] - 1 } };
}

/**
 * Back neck increase positions (stitch index within the back, before this row's increases): spread evenly and
 * symmetrically, each increase row offset by half a gap from the last so they don't stack.
 */
export function backNeckPositions(backSts: number, n: number, rowIndex: number): number[] {
  if (n <= 0 || backSts <= 0) return [];
  const base = distributeAcross(backSts, n);
  if (rowIndex % 2 === 0) return base;
  // Shift towards the centre by half a gap, mirrored so the row stays symmetric.
  const gap = backSts / n;
  const shift = Math.max(1, Math.floor(gap / 4));
  const mid = (n - 1) / 2;
  return base.map((p, i) => Math.min(backSts - 1, Math.max(0, p + (i < mid ? shift : i > mid ? -shift : 0))));
}

export function zoneName(z: Zone): string {
  return { leftFront: 'left front', leftSleeve: 'left sleeve', back: 'back', rightSleeve: 'right sleeve', rightFront: 'right front' }[z];
}

/** A new contiguous yoke panel (top-down, flat, generated from its phases). */
export function yokePanel(shape: NecklineShape = 'round', start?: YokeStart): Panel {
  const p = newPanel('Yoke');
  p.template = 'yoke';
  p.direction = 'top-down';
  p.yoke = defaultYoke(shape, start);
  p.notes = 'Contiguous method by Susie Myers (SusieM on Ravelry): worked top-down in one piece from the neck.';
  return p;
}

// ---------- names for the panels that continue from the yoke ----------

/** `yoke.*` names: each held part plus its share of the underarm cast-on, as widths (cm), the yoke depth, and a front
 * neck that continues into the front body: its rows below the split, increases per side and centre (rows, sts; 0 when
 * the neck closes in the yoke). */
export const YOKE_NAMES = ['yoke.back_w', 'yoke.front_w', 'yoke.sleeve_w', 'yoke.underarm_co', 'yoke.depth', 'yoke.neck_rows', 'yoke.neck_per_side', 'yoke.neck_centre'] as const;

/**
 * Values of the `yoke.*` names in one size, from the project's contiguous yoke: the back and front at the split with
 * half the underarm cast-on at each side, the sleeve with the whole cast-on, and the yoke's depth (rows from the neck).
 * A cardigan front is described as the whole front (both halves), as cardigan fronts are, so that each half rounds to
 * exactly the yoke's front plus its cast-on. A front neck that continues into the body still counts in the front's
 * width (its remaining increases and the centre, or a cardigan's front-edge cast-ons): the body works them.
 * `yoke.neck_centre` is the whole front's centre (a cardigan's: both front-edge cast-ons and the closing between them,
 * less the two edge stitches, which the fronts keep as their front-edge selvedges).
 */
export function yokeNames(project: Project, sizeId: Id): { values: Record<string, number> } | { error: string; source?: { panel: Panel; yoke: YokeResult } } {
  const panel = project.panels.find((p) => p.yoke);
  if (!panel) return { error: 'there is no contiguous yoke panel.' };
  const y = generateYoke(project, panel.yoke!, sizeId);
  if (!y.ok || !y.rows.length) return { error: `the yoke can't be worked out in this size (${y.issues.find((i) => i.severity === 'error')?.message ?? 'no rows'}).`, source: { panel, yoke: y } };
  const spc = y.stitchesPerCm;
  const last = y.rows[y.rows.length - 1].zones;
  const N = y.underarmCo;
  const backHalf = Math.floor(N / 2);
  const frontHalf = N - backHalf;
  const cardigan = project.garment.opening === 'cardigan';
  const closing = cardigan ? buildScope(project, sizeId).closing_r ?? 0 : 0;
  const nc = y.neckContinues;
  const centre = !nc ? 0 : cardigan ? Math.max(0, 2 * nc.frontEdgeCo + y.neck.closingSts - 2) : nc.centre;
  const front = cardigan
    ? 2 * (last.leftFront + neckRest(nc, true) / 2 + frontHalf - 1) / spc + closing // the edge stitch is the front-edge selvedge
    : (last.leftFront + last.rightFront + neckRest(nc, false) + 2 * frontHalf) / spc;
  return {
    values: {
      'yoke.back_w': (last.back + 2 * backHalf) / spc,
      'yoke.front_w': front,
      'yoke.sleeve_w': (last.leftSleeve + N) / spc,
      'yoke.underarm_co': N / spc,
      'yoke.depth': y.rows.length / y.rowsPerCm,
      'yoke.neck_rows': nc?.rows ?? 0,
      'yoke.neck_per_side': nc?.perSide ?? 0,
      'yoke.neck_centre': centre,
    },
  };
}

/**
 * The front neck in one size when it continues past the yoke's split (null when it closes in the yoke, or the yoke
 * fails): what the body pieces from the yoke work at their top, and the neck's shape.
 */
export function yokeNeckContinues(project: Project, sizeId: Id): { neck: NonNullable<YokeResult['neckContinues']>; shape: NecklineShape } | null {
  const panel = project.panels.find((p) => p.yoke);
  if (!panel) return null;
  const y = generateYoke(project, panel.yoke!, sizeId);
  return y.ok && y.neckContinues ? { neck: y.neckContinues, shape: panel.yoke!.neck.shape } : null;
}
