// Contiguous yoke generator (the contiguous method by Susie Myers, SusieM on Ravelry): one piece worked top-down
// from the back neck, with the shoulder seams, back, fronts and set-in-look sleeve caps growing row by row.
// Pure: a YokeSpec + measurements in, every row's zone counts, increases and cast-ons out.
//
// Row layout, as seen from the RS (left = wearer's left): [left front | left seam/sleeve | back | right seam/sleeve |
// right front]. Row 1 is a RS row: it places the markers and makes the first increases. Flat rows alternate RS/WS;
// a pullover is joined in the round when the front neck is cast on, and every row after that is a round.

import { plugIn } from './bust';
import { distributeAcross, distributeAuto } from './distribute';
import { evaluate, scopeFrom } from './expr';
import { rowsPerCm, stitchesPerCm } from './gauge';
import { buildScope } from './measurements';
import type { DimExpr, Id, NecklineShape, Project, YokeSpec } from './model';
import { dim, newPanel, type Panel } from './model';
import { FRONT_NECKS } from './templates';

export type Zone = 'leftFront' | 'leftSleeve' | 'back' | 'rightSleeve' | 'rightFront';
export const ZONES: Zone[] = ['leftFront', 'leftSleeve', 'back', 'rightSleeve', 'rightFront'];
export type ZoneCounts = Record<Zone, number>;

export type YokePhase = 'A' | 'C' | 'D' | 'E';

export interface YokeInc {
  zone: Zone;
  /** Index of the new stitch within its zone (as seen from the RS, after the row). */
  at: number;
  symbol: string;
  kind: 'seam' | 'backNeck' | 'neck' | 'sleeve' | 'body';
}

export interface YokeCastOn {
  zone: Zone;
  count: number;
  where: 'centre-front' | 'front-edge';
}

export interface YokeRow {
  row: number;
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
  id: 'A' | 'B' | 'neck' | 'C' | 'D' | 'E';
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
}

// ---------- defaults ----------

export const SLOPED_SHOULDER = 'sqrt(((back_shoulder_width - back_neck_width) / 2) ^ 2 + shoulder_drop ^ 2)';

export function defaultYoke(shape: NecklineShape = 'round'): YokeSpec {
  const n = FRONT_NECKS[shape];
  return {
    increase: { type: 'm1', symbol: 'kfb' },
    seamSts: dim(2),
    shoulder: { mode: 'cross-back', backWidth: dim('cross_back_w + 1'), length: dim(SLOPED_SHOULDER), shorten: dim(0), extraRows: dim(0) },
    backNeck: { perRow: dim(2), rows: dim(8), manual: {} },
    cap: { topSts: dim(6), rapidRows: dim('armhole_depth / 6 / row_h'), solve: true },
    sleeveWidth: dim('bicep + ease.bicep'),
    depth: { mode: 'back-length', backLength: dim('shoulder_drop + armhole_depth - back_neck_drop'), extra: dim(0), deepen: true, maxRapid: dim(0.5) },
    body: { width: dim('upper_chest + ease'), increases: true, zone: dim(0.6) },
    underarm: { castOn: dim('underarm_co') },
    neck: { shape, depth: dim(n.depth), centre: dim(n.centre) },
  };
}

const sum = (z: ZoneCounts) => ZONES.reduce((a, k) => a + z[k], 0);

/** Symbols for an increase on the left / right side of a marker (the new stitch leans away from it). */
function incSymbols(spec: YokeSpec): { before: string; after: string } {
  if (spec.increase.type === 'kfb') return { before: 'kfb', after: 'kfb' };
  if (spec.increase.type === 'other') return { before: spec.increase.symbol, after: spec.increase.symbol };
  // M1R just before a marker (left of it as seen from the RS), M1L just after.
  return { before: 'm1r', after: 'm1l' };
}

// ---------- generator ----------

export function generateYoke(project: Project, spec: YokeSpec, sizeId: Id): YokeResult {
  const spc = stitchesPerCm(project.gauge);
  const rpc = rowsPerCm(project.gauge);
  const scope = buildScope(project, sizeId);
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
      else issues.push({ severity: 'error', message: `${label}: ${r.error}` });
    }
    params[key] = { label, expr: d.expr, plugged: plugIn(d.expr, s), value, overridden, unit };
    return value;
  };
  const sts = (cm: number) => Math.round(cm * spc);
  const rowsOf = (cm: number) => Math.round(cm * rpc);

  // ---- cast-on ----
  const seam = Math.max(1, Math.round(val('seamSts', 'Seam stitches', spec.seamSts, 'sts')));
  const bn = sts(scope.back_neck_width ?? 0);
  if (!(bn > 0)) issues.push({ severity: 'error', message: 'back_neck_width gives no back neck stitches.' });
  const castOnZones: ZoneCounts = { leftFront: 1, leftSleeve: seam, back: bn, rightSleeve: seam, rightFront: 1 };
  const castOn = sum(castOnZones);

  // ---- phase B: back neck increases on RS rows over the first `rows` rows ----
  const bPer = Math.max(0, Math.round(val('backNeckPerRow', 'Back neck increases per row', spec.backNeck.perRow, 'sts')));
  const bRows = Math.max(0, Math.round(val('backNeckRows', 'Back neck rows', spec.backNeck.rows, 'rows')));
  const bIncRows: number[] = [];
  for (let r = 1; r <= bRows; r += 2) bIncRows.push(r);
  const bTotal = bPer * bIncRows.length;
  if (bPer && (bPer < 2 || bPer > 4)) issues.push({ severity: 'info', message: `Back neck: ${bPer} increases per row (the method suggests 2 to 4).` });

  // ---- cap top: the markers move so each seam group widens to the cap top ----
  const capTop = Math.max(seam, Math.round(val('capTopSts', 'Cap top stitches', spec.cap.topSts, 'sts')));
  let k = (capTop - seam) / 2;
  if (!Number.isInteger(k)) {
    issues.push({ severity: 'warning', message: `Cap top ${capTop} sts − seam ${seam} sts is odd; the markers move ${Math.floor(k)} st each side (cap top ${seam + 2 * Math.floor(k)} sts).` });
    k = Math.floor(k);
  }
  const capTopSts = seam + 2 * k;

  // ---- phase A: shoulder rows ----
  const extra = Math.round(val('extraRows', 'Extra seam rows', spec.shoulder.extraRows, 'rows'));
  let A: number;
  if (spec.shoulder.mode === 'length') {
    const len = val('shoulderLength', 'Shoulder seam length', spec.shoulder.length, 'cm');
    const shorten = val('shorten', 'Shorten the seam by', spec.shoulder.shorten, 'cm');
    A = rowsOf(len - shorten) + extra;
  } else {
    const target = sts(val('backWidth', 'Back width after the shoulders', spec.shoulder.backWidth, 'cm'));
    // back after A and the marker move = bn + 2A + B − 2k
    A = Math.round((target + 2 * k - bn - bTotal) / 2) + extra;
  }
  if (A < 1) {
    issues.push({ severity: 'error', message: `The shoulder phase has ${A} rows: the back is already as wide as the target. Narrow the back neck or widen the target.` });
    A = Math.max(1, A);
  }
  if (bRows > A) issues.push({ severity: 'info', message: `Back neck increases (rows 1–${bRows}) run past the shoulder phase (${A} rows).` });

  // ---- yoke depth (the split row); may deepen further below so the cap isn't mostly rapid ----
  let Y0: number;
  if (spec.depth.mode === 'armhole') {
    Y0 = A + rowsOf(scope.armhole_depth ?? 0);
    params.backLength = { label: 'Armhole depth below the seam', expr: 'armhole_depth', plugged: String(scope.armhole_depth ?? 0), value: scope.armhole_depth ?? 0, overridden: false, unit: 'cm' };
  } else {
    Y0 = rowsOf(val('backLength', 'Back length, neck to underarm', spec.depth.backLength, 'cm'));
  }
  Y0 += rowsOf(val('extraDepth', 'Extra yoke depth', spec.depth.extra, 'cm'));

  // ---- front neck ----
  const depthCm = val('neckDepth', 'Front neck depth', spec.neck.depth, 'cm');
  const centreCm = val('neckCentre', 'Front neck centre', spec.neck.centre, 'cm');
  // The fronts start at the neck points: the neck opening is the back neck. V: no centre; square: all centre.
  const centreRaw = spec.neck.shape === 'square' ? bn : spec.neck.shape === 'v' ? 0 : Math.min(bn, sts(centreCm));
  const perSide = Math.max(0, Math.floor((bn - centreRaw) / 2));
  const centre = bn - 2 * perSide; // pullover cast-on at centre front
  const depthRows = Math.max(1, rowsOf(depthCm));
  let R = depthRows;
  if (R % 2 === 0) R += 1; // the centre is cast on at the end of a RS row
  const neckRows: number[] = [];
  if (perSide > 0) {
    if (spec.neck.shape === 'v') {
      const s = distributeAuto(perSide, { from: 1, to: R - 1 }, { side: 'rs', align: 'start' });
      for (const w of s.warnings) issues.push({ severity: 'warning', message: `Front neck: ${w}` });
      neckRows.push(...s.rows);
    } else {
      // Every row next to the centre (the last rows before the cast-on), then every other row above.
      const fast = Math.ceil(perSide / 2);
      const dists: number[] = [];
      for (let d = 1; d <= fast; d++) dists.push(d);
      for (let j = fast, d = fast + 2; j < perSide; j++, d += 2) dists.push(d);
      if (dists[dists.length - 1] > R - 1) {
        const s = distributeAuto(perSide, { from: 1, to: R - 1 }, { side: 'any', align: 'start' });
        if (!s.feasible) issues.push({ severity: 'error', message: `Front neck: ${perSide} increases per side do not fit in ${R - 1} rows.` });
        neckRows.push(...s.rows);
      } else neckRows.push(...dists.map((d) => R - d));
    }
  }
  const neckSet = new Set(neckRows);
  // Cardigan: each front casts on its share of the centre at its front edge, less half the closing width (bands).
  const closingSts = cardigan ? sts(scope.closing_r ?? 0) : 0;
  const frontEdgeCo = cardigan ? Math.max(0, Math.round((centre - closingSts) / 2)) : 0;
  if (cardigan && project.edges?.frontBands.enabled && project.cardigan?.attach && Object.values(project.cardigan.attach).includes('integrated')) {
    issues.push({ severity: 'warning', message: 'Integrated front bands are not worked into a contiguous yoke yet; the yoke has none.' });
  }

  // ---- body at the split (before body increases) and the underarm cast-on ----
  const backAtSplit = bn + 2 * A + bTotal - 2 * k;
  const frontsAtSplit = 2 * (1 + A + perSide - k) + (cardigan ? 2 * frontEdgeCo : centre);
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
      if (N < 0) notes.push({ severity: 'error', message: `The yoke body (${bodyYoke} sts) is already ${-2 * N} sts wider than the body target (${bodyTarget} sts): the underarm cast-on would be ${N}. Shorten the shoulders.` });
    } else {
      N = N0;
      const need = bodyTarget - bodyYoke - 2 * N;
      perEdge = Math.max(0, Math.ceil(need / 4));
      if (need < 0) notes.push({ severity: 'warning', message: `With ${N} sts cast on at each underarm the body is ${-need} sts wider than its target (${bodyTarget} sts).` });
      if (perEdge > zoneRows) {
        N = Math.ceil((bodyTarget - bodyYoke - 4 * zoneRows) / 2);
        perEdge = zoneRows;
        notes.push({ severity: 'info', message: `Body increases fill the lower ${zoneRows} armhole rows; the underarm cast-on is raised from ${N0} to ${N} sts.` });
      }
    }
    N = Math.max(0, N);
    const bodyRows: number[] = [];
    if (perEdge > 0) {
      const s = distributeAuto(perEdge, { from: Y - zoneRows + 1, to: Y }, { side: 'any', align: 'end', order: 'longFirst' });
      for (const w of s.warnings) notes.push({ severity: 'warning', message: `Body increases: ${w}` });
      bodyRows.push(...s.rows);
    }
    // Sleeve: rapid (every row), then slow (every second row: RS rows / every other round) to the split.
    const sleeveTarget = sleeveFull - N;
    const slowRows = (C: number) => {
      const out: number[] = [];
      let r = A + C + 1;
      while (r <= Y && !isRS(r)) r++;
      for (; r <= Y; r += 2) out.push(r);
      return out;
    };
    const sleeveMax = (C: number) => capTopSts + 2 * C + 2 * slowRows(C).length;
    let C = Math.min(rapidBase, Math.max(0, X));
    if (spec.cap.solve) while (C < X && sleeveMax(C) < sleeveTarget) C++;
    const reached = sleeveMax(C) >= sleeveTarget;
    const dNeed = Math.max(0, Math.ceil((sleeveTarget - (capTopSts + 2 * C)) / 2));
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
    if (plan.Y > Y0) issues.push({ severity: 'info', message: `Yoke deepened by ${plan.Y - Y0} rows (${((plan.Y - Y0) / rpc).toFixed(1)} cm) so the sleeve reaches its width with at most ${Math.round(maxRapid * 100)} % of the armhole rows rapid.` });
  }
  const { Y, X, perEdge, N, bodyRows, sleeveTarget, C, D, dRows, zoneRows } = plan;
  issues.push(...plan.notes);
  if (X < 2) issues.push({ severity: 'error', message: `The armhole has ${X} rows after the shoulder phase (${A} rows of ${Y}): shorten the shoulders or deepen the yoke.` });
  if (!plan.reached) {
    const have = plan.sleeveMax + N;
    issues.push({ severity: 'warning', message: `The sleeve reaches ${have} sts (${(have / spc).toFixed(1)} cm) at the underarm, ${sleeveTarget + N - have} sts short of its width: ${spec.cap.solve ? 'even with every armhole row rapid. Deepen the yoke or cast on more at the underarm' : 'lengthen the rapid phase (or let it solve)'}.` });
  }
  if (R > Y) issues.push({ severity: 'error', message: `The front neck closes on row ${R}, below the underarm split (row ${Y}). Make the neck shallower or the yoke deeper.` });
  const E = Math.max(0, Y - A - C - D);
  const bodySet = new Set(bodyRows);
  const dSet = new Set(dRows);
  if (spec.cap.solve && C > rapidBase) issues.push({ severity: 'info', message: `Rapid cap rows lengthened from ${rapidBase} to ${C} so the sleeve reaches its width.` });
  if (C > X / 2) issues.push({ severity: 'info', message: `Hint: the cap may look flat: ${C} of the ${X} armhole rows are rapid. A deeper yoke gives a rounder cap.` });

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
    const seamLike = phase === 'A' || bodySet.has(r);
    const sleeveInc = phase === 'C' || dSet.has(r);
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
    if (r === R) {
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
    if (cardigan && r === R + 1 && frontEdgeCo > 0 && r <= Y) {
      z.leftFront += frontEdgeCo;
      castOns.push({ zone: 'leftFront', count: frontEdgeCo, where: 'front-edge' });
    }
    rows.push({ row: r, phase, backNeck: bIndex >= 0, neck, round: isRound(r), rs: isRS(r), markersMoved, zones: { ...z }, total: sum(z), incs, castOns });
    if (r === A) endOfA = { ...z };
  }
  if (cardigan && R === Y && frontEdgeCo > 0) issues.push({ severity: 'warning', message: 'The left front edge cast-on falls after the split.' });

  // ---- results ----
  for (const row of rows) {
    for (const zone of ZONES) {
      if (row.zones[zone] < 0) {
        issues.push({ severity: 'error', message: `Row ${row.row}: the ${zoneName(zone)} has ${row.zones[zone]} sts.` });
        break;
      }
    }
  }
  if (k > 0 && (endOfA.leftFront <= k || endOfA.back <= 2 * k)) issues.push({ severity: 'error', message: `The markers can't move ${k} sts: the fronts have ${endOfA.leftFront} sts at the end of the shoulders.` });
  if (rows.some((r) => r.total <= 0)) issues.push({ severity: 'error', message: 'A row has no stitches.' });

  const last = rows[rows.length - 1]?.zones ?? z;
  const held = { leftSleeve: last.leftSleeve, body: last.leftFront + last.back + last.rightFront, rightSleeve: last.rightSleeve };
  if (Object.values(held).some((v) => v <= 0)) issues.push({ severity: 'error', message: `Held stitches at the split: ${held.leftSleeve} / ${held.body} / ${held.rightSleeve}.` });

  // Phase table.
  const stsAt = (r: number) => (r <= 0 ? castOn : rows[Math.min(r, rows.length) - 1]?.total ?? castOn);
  const phases: PhaseSummary[] = [];
  const add = (id: PhaseSummary['id'], label: string, from: number, to: number, incsPerRow: string) => {
    if (to >= from) phases.push({ id, label, from, to, stsBefore: stsAt(from - 1), stsAfter: stsAt(to), incsPerRow });
  };
  add('A', 'Shoulders', 1, A, '4 every row');
  if (bIncRows.length && bPer) add('B', 'Back neck', 1, Math.min(bIncRows[bIncRows.length - 1], Y), `${bPer} every 2nd row (with A)`);
  if (perSide > 0 || R <= Y) add('neck', cardigan ? 'Front neck (open)' : 'Front neck, joined', 1, Math.min(R, Y), `${perSide} per side${cardigan ? '' : `, cast on ${centre}`}`);
  add('C', 'Cap, rapid', A + 1, A + C, '4 every row');
  add('D', 'Cap, slow', A + C + 1, A + C + D, '4 every 2nd row');
  add('E', 'Armhole, straight', A + C + D + 1, Y, perEdge ? `body: ${perEdge} per edge` : 'none');

  const seamCm = A / rpc;
  const gapAtA = cardigan ? 0 : R <= A ? 0 : Math.max(0, bn - 2 * neckRows.filter((r) => r <= A).length);
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
    counts: { A, B: bRows, C, D, E, total: Y, neckRow: R, joinRow, rapidBase },
    seamSts: seam,
    capTopSts,
    held,
    underarmCo: N,
    bodyIncs: { perEdge, rows: bodyRows },
    endOfA,
    neck: { depthRows, row: R, perSide, backNeck: bn, centre, closingSts, frontEdgeCo },
    derived: {
      seamCm,
      backEndOfACm: endOfA.back / spc,
      frontEndOfACm: (endOfA.leftFront + endOfA.rightFront + gapAtA) / spc,
      sleeveCm: (held.leftSleeve + N) / spc,
      bodyCm: (held.body + 2 * N) / spc,
      armholeCm: 2 * edgeLen + (capTopSts + N) / spc,
      backLengthCm: Y / rpc,
    },
    stitchesPerCm: spc,
    rowsPerCm: rpc,
  };
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
export function yokePanel(shape: NecklineShape = 'round'): Panel {
  const p = newPanel('Yoke');
  p.template = 'yoke';
  p.direction = 'top-down';
  p.yoke = defaultYoke(shape);
  p.notes = 'Contiguous method by Susie Myers (SusieM on Ravelry): worked top-down in one piece from the back neck.';
  return p;
}

// ---------- names for the panels that continue from the yoke ----------

/** `yoke.*` names: each held part plus its share of the underarm cast-on, as widths (cm), and the yoke depth. */
export const YOKE_NAMES = ['yoke.back_w', 'yoke.front_w', 'yoke.sleeve_w', 'yoke.underarm_co', 'yoke.depth'] as const;

/**
 * Values of the `yoke.*` names in one size, from the project's contiguous yoke: the back and front at the split with
 * half the underarm cast-on at each side, the sleeve with the whole cast-on, and the yoke's depth (rows from the neck).
 * A cardigan front is described as the whole front (both halves), as cardigan fronts are, so that each half rounds to
 * exactly the yoke's front plus its cast-on.
 */
export function yokeNames(project: Project, sizeId: Id): { values: Record<string, number> } | { error: string } {
  const panel = project.panels.find((p) => p.yoke);
  if (!panel) return { error: 'there is no contiguous yoke panel.' };
  const y = generateYoke(project, panel.yoke!, sizeId);
  if (!y.ok || !y.rows.length) return { error: `the yoke can't be computed in this size (${y.issues.find((i) => i.severity === 'error')?.message ?? 'no rows'}).` };
  const spc = y.stitchesPerCm;
  const last = y.rows[y.rows.length - 1].zones;
  const N = y.underarmCo;
  const backHalf = Math.floor(N / 2);
  const frontHalf = N - backHalf;
  const cardigan = project.garment.opening === 'cardigan';
  const closing = cardigan ? buildScope(project, sizeId).closing_r ?? 0 : 0;
  const front = cardigan
    ? 2 * (last.leftFront + frontHalf - 1) / spc + closing // the edge stitch is the front-edge selvedge
    : (last.leftFront + last.rightFront + 2 * frontHalf) / spc;
  return {
    values: {
      'yoke.back_w': (last.back + 2 * backHalf) / spc,
      'yoke.front_w': front,
      'yoke.sleeve_w': (last.leftSleeve + N) / spc,
      'yoke.underarm_co': N / spc,
      'yoke.depth': y.rows.length / y.rowsPerCm,
    },
  };
}
