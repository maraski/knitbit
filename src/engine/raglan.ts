// Raglan yoke generator: worked top-down from the neck with four raglan lines running to the underarms. Same row
// layout and result as the contiguous yoke (contiguous.ts), so the panel, chart, top view, body and sleeves that
// continue from it and the checks all work on it unchanged.
//
// Row layout, as seen from the RS: [left front | left sleeve | back | right sleeve | right front]. Each sleeve zone
// starts and ends with the raglan line's stitches (`seamSts`, k2 by default). Increases sit outside the lines: the
// body's just before / after them (on the fronts and the back), the sleeve's just inside them, M1R before a line and
// M1L after it. Row 1 is a RS row that places the markers and makes the first increases.
//
// Rates: the depth is set (back length, neck to underarm); the body and the sleeves each get the increases that make
// them as wide as their targets at the split, every other row, spread down the depth, plus every-row increases where
// every other row is not enough. When even every row isn't, the underarm cast-on makes up the rest.
//
// Two ways to start (`spec.start`), as the contiguous yoke: 'back' (default) casts on the back neck, the sleeve tops
// with their lines and one front stitch each side, increases at the front neck edges and casts on the centre to
// close the neck; 'neck' casts on the whole neck and raises the back with German short rows.

import { defaultYoke, generateYoke, shortRowSpan, ZONES, type PhaseSummary, type YokeCastOn, type YokeInc, type YokeIssue, type YokeParam, type YokePhase, type YokeResult, type YokeRow, type ZoneCounts } from './contiguous';
import { plugIn } from './bust';
import { evaluate, scopeFrom } from './expr';
import { rowsPerCm, stitchesPerCm } from './gauge';
import { buildScope } from './measurements';
import type { DimExpr, Id, NecklineShape, Project, YokeSpec, YokeStart } from './model';
import { dim, newPanel, type Panel } from './model';

/** Default sleeve top at the cast-on (cm). */
export const RAGLAN_SLEEVE_TOP = 'back_neck_width / 3';

/** A new raglan yoke: 2-st raglan lines with M1R / M1L, the front neck shaped by increases unless `start` = 'neck'. */
export function defaultRaglan(shape: NecklineShape = 'round', start: YokeStart = 'back'): YokeSpec {
  const y = defaultYoke(shape, start);
  return {
    ...y,
    style: 'raglan',
    raglan: { sleeveTop: dim(RAGLAN_SLEEVE_TOP) },
    increase: { type: 'm1', symbol: 'kfb' },
    seamSts: dim(2),
    backNeck: { ...y.backNeck, perRow: dim(0) },
    depth: { ...y.depth, mode: 'back-length', deepen: false },
  };
}

/** A new raglan yoke panel (top-down, generated from the raglan lines). */
export function raglanPanel(shape: NecklineShape = 'round', start: YokeStart = 'back'): Panel {
  const p = newPanel('Yoke');
  p.template = 'yoke';
  p.direction = 'top-down';
  p.yoke = defaultRaglan(shape, start);
  p.notes = 'Raglan yoke: worked top-down in one piece from the neck, with four raglan lines to the underarms.';
  return p;
}

const sum = (z: ZoneCounts) => ZONES.reduce((a, k) => a + z[k], 0);

/** `n` of `list`, spread evenly from its first to its last entry. */
function spread(list: number[], n: number): number[] {
  if (n <= 0) return [];
  if (n >= list.length) return list.slice();
  if (n === 1) return [list[0]];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
  return out;
}

/** Rows for `n` increase rows: every other row first (`slow`), then extra rows (`fast`) spread between them. */
function pickRows(n: number, slow: number[], fast: number[]): number[] {
  if (n <= slow.length) return spread(slow, n);
  return [...slow, ...spread(fast, n - slow.length)].sort((a, b) => a - b);
}

export function generateRaglan(project: Project, spec: YokeSpec, sizeId: Id): YokeResult {
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

  // ---- the neck: the contiguous yoke's, worked out by its generator (its shoulder and cap phases unused) ----
  // The fronts cast on, the short rows (whole neck), or the front neck increases and centre cast-on (back start).
  const ny = generateYoke(project, { ...spec, style: 'contiguous', backNeck: { ...spec.backNeck, perRow: dim(0) }, cap: { ...spec.cap, solve: false }, depth: { ...spec.depth, deepen: false } }, sizeId);
  issues.push(...ny.issues.filter((i) => /^(Short|Front|Neck|First turn|Sts between|The neck width|Integrated)/.test(i.message)));
  for (const k of ['neckWidth', 'neckDepth', 'neckCentre', 'frontCo', 'srPairs', 'srFirst', 'srStep']) if (ny.params[k]) params[k] = ny.params[k];
  const { shortRows, neck } = ny;
  const wholeNeck = !!shortRows;
  const { perSide, centre, frontEdgeCo, row: R } = neck;
  const bn = neck.backNeck;
  const neckSet = new Set(ny.rows.filter((r) => r.neck).map((r) => r.row));
  const plain = new Set(ny.rows.filter((r) => r.plain).map((r) => r.row));

  // ---- cast-on: the sleeve tops, each between its raglan lines ----
  const seam = Math.max(0, Math.round(val('seamSts', 'Raglan line stitches', spec.seamSts, 'sts')));
  const top = Math.max(0, sts(val('sleeveTop', 'Sleeve top at the cast-on', spec.raglan?.sleeveTop ?? dim(RAGLAN_SLEEVE_TOP), 'cm')));
  const sleeve0 = top + 2 * seam;
  if (sleeve0 < 1) issues.push({ severity: 'error', message: 'The sleeve tops have no stitches: widen the sleeve top or the raglan lines.' });
  const FL = ny.castOnZones.leftFront;
  const FR = ny.castOnZones.rightFront;
  const castOnZones: ZoneCounts = { leftFront: FL, leftSleeve: sleeve0, back: bn, rightSleeve: sleeve0, rightFront: FR };
  const castOn = sum(castOnZones);

  // ---- depth: rows from the cast-on to the split ----
  let Y: number;
  if (spec.depth.mode === 'armhole') {
    Y = rowsOf(scope.armhole_depth ?? 0);
    params.backLength = { label: 'Armhole depth', expr: 'armhole_depth', plugged: String(scope.armhole_depth ?? 0), value: scope.armhole_depth ?? 0, overridden: false, unit: 'cm' };
  } else Y = rowsOf(val('backLength', 'Back length, neck to underarm', spec.depth.backLength, 'cm'));
  Y += rowsOf(val('extraDepth', 'Extra yoke depth', spec.depth.extra, 'cm'));
  if (Y < 2) {
    issues.push({ severity: 'error', message: `The raglan is ${Y} rows deep: deepen it.` });
    Y = Math.max(Y, 1);
  }
  const joinRow = cardigan ? null : R;
  const isRound = (r: number) => joinRow !== null && r > joinRow;
  const isRS = (r: number) => isRound(r) || r % 2 === 1;

  // ---- increase rows: every other row (RS rows / every other round), then the rows between ----
  const slow: number[] = [];
  const fast: number[] = [];
  for (let r = 1; r <= Y; r++) if (!plain.has(r)) (r % 2 === 1 ? slow : fast).push(r);
  const cap = slow.length + fast.length;
  const bodyBase = FL + FR + bn + (wholeNeck ? 0 : 2 * perSide + (cardigan ? 2 * frontEdgeCo : centre));
  const bodyTarget = sts(val('bodyWidth', 'Body at the underarm', spec.body.width, 'cm') - (cardigan ? scope.closing_r ?? 0 : 0));
  const sleeveFull = sts(val('sleeveWidth', 'Sleeve at the underarm', spec.sleeveWidth, 'cm'));
  const N0 = Math.max(0, sts(val('underarmCo', 'Underarm cast-on', spec.underarm.castOn, 'cm')));
  const bodyNeed = (N: number) => (bodyTarget - bodyBase - 2 * N) / 4;
  const sleeveNeed = (N: number) => (sleeveFull - sleeve0 - N) / 2;
  let N = N0;
  if (bodyNeed(N) > cap || sleeveNeed(N) > cap) {
    N = Math.max(N0, Math.ceil((bodyTarget - bodyBase - 4 * cap) / 2), sleeveFull - sleeve0 - 2 * cap);
    issues.push({ severity: 'info', message: `Even increasing every row, the raglan doesn't reach the body and sleeve widths in ${Y} rows: the underarm cast-on is raised from ${N0} to ${N} sts. A deeper raglan keeps it smaller.` });
  }
  const nb = Math.min(cap, Math.max(0, Math.round(bodyNeed(N))));
  const ns = Math.min(cap, Math.max(0, Math.round(sleeveNeed(N))));
  if (bodyNeed(N) < -0.5) issues.push({ severity: 'warning', message: `With ${N} sts cast on at each underarm the body is ${Math.round(-4 * bodyNeed(N))} sts wider than its target (${bodyTarget} sts) without any raglan increases. Narrow the neck or cast on less at the underarm.` });
  if (sleeveNeed(N) < -0.5) issues.push({ severity: 'warning', message: `With ${N} sts cast on at each underarm the sleeve is ${Math.round(-2 * sleeveNeed(N))} sts wider than its target (${sleeveFull} sts) without any raglan increases. Narrow the sleeve top or cast on less at the underarm.` });
  const bodyRows = pickRows(nb, slow, fast);
  const sleeveRows = pickRows(ns, slow, fast);
  const bodyFast = Math.max(0, nb - slow.length);
  const sleeveFast = Math.max(0, ns - slow.length);
  if (bodyFast) issues.push({ severity: 'info', message: `Body: every other row isn't enough, so ${bodyFast} of its ${nb} increase rows are the rows between (increasing on the body every row there).` });
  if (sleeveFast) issues.push({ severity: 'info', message: `Sleeves: every other row isn't enough, so ${sleeveFast} of their ${ns} increase rows are the rows between.` });
  if (R > Y) issues.push({ severity: 'error', message: shortRows ? `The short rows end on row ${R}, below the underarm split (row ${Y}). Fewer pairs or a deeper raglan.` : `The front neck closes on row ${R}, below the underarm split (row ${Y}). Make the neck shallower or the raglan deeper.` });
  const bodySet = new Set(bodyRows);
  const sleeveSet = new Set(sleeveRows);
  const lastInc = Math.max(0, ...bodyRows, ...sleeveRows);

  // ---- simulate ----
  const sym = spec.increase.type === 'kfb' ? { before: 'kfb', after: 'kfb' } : spec.increase.type === 'other' ? { before: spec.increase.symbol, after: spec.increase.symbol } : { before: 'm1r', after: 'm1l' };
  const z: ZoneCounts = { ...castOnZones };
  const rows: YokeRow[] = [];
  for (let r = 1; r <= Y; r++) {
    const phase: YokePhase = r <= lastInc ? 'R' : 'E';
    const incs: YokeInc[] = [];
    const castOns: YokeCastOn[] = [];
    const body = bodySet.has(r);
    const sleeve = sleeveSet.has(r);
    const neck = neckSet.has(r) && r < R;
    z.leftFront += (body ? 1 : 0) + (neck ? 1 : 0);
    z.rightFront += (body ? 1 : 0) + (neck ? 1 : 0);
    z.back += body ? 2 : 0;
    if (sleeve) {
      z.leftSleeve += 2;
      z.rightSleeve += 2;
    }
    // Indices of the new stitches within each zone after the row, as seen from the RS.
    if (neck) {
      incs.push({ zone: 'leftFront', at: 1, symbol: sym.after, kind: 'neck' });
      incs.push({ zone: 'rightFront', at: z.rightFront - 2, symbol: sym.before, kind: 'neck' });
    }
    if (body) {
      incs.push({ zone: 'leftFront', at: z.leftFront - 1, symbol: sym.before, kind: 'body' });
      incs.push({ zone: 'back', at: 0, symbol: sym.after, kind: 'body' });
      incs.push({ zone: 'back', at: z.back - 1, symbol: sym.before, kind: 'body' });
      incs.push({ zone: 'rightFront', at: 0, symbol: sym.after, kind: 'body' });
    }
    if (sleeve) {
      for (const sl of ['leftSleeve', 'rightSleeve'] as const) {
        incs.push({ zone: sl, at: seam, symbol: sym.after, kind: 'sleeve' });
        incs.push({ zone: sl, at: z[sl] - seam - 1, symbol: sym.before, kind: 'sleeve' });
      }
    }
    if (r === R && !wholeNeck) {
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
    if (cardigan && !wholeNeck && r === R + 1 && frontEdgeCo > 0) {
      z.leftFront += frontEdgeCo;
      castOns.push({ zone: 'leftFront', count: frontEdgeCo, where: 'front-edge' });
    }
    const row: YokeRow = { row: r, phase, backNeck: false, neck, round: isRound(r), rs: isRS(r), markersMoved: false, zones: { ...z }, total: sum(z), incs, castOns };
    if (shortRows && r <= shortRows.endRow) Object.assign(row, shortRowSpan(shortRows, r, row, cardigan), plain.has(r) ? { plain: true } : {});
    rows.push(row);
  }
  if (cardigan && R === Y && frontEdgeCo > 0) issues.push({ severity: 'warning', message: 'The left front edge cast-on falls after the split.' });
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
  if (shortRows) {
    if (shortRows.pairs) add('neck', 'Short rows (neck)', 1, Math.min(R, Y), `${shortRows.pairs} pairs, German short rows${cardigan ? '' : ', then in the round'}`);
  } else if (perSide > 0 || R <= Y) add('neck', cardigan ? 'Front neck (open)' : 'Front neck, joined', 1, Math.min(R, Y), `${perSide} per side${cardigan ? '' : `, cast on ${centre}`}`);
  const rate = (n: number, f: number) => `${n} rows${f ? ` (${f} of them between)` : ''}`;
  add('R', 'Raglan', 1, lastInc, `body 4 on ${rate(nb, bodyFast)}, sleeves 4 on ${rate(ns, sleeveFast)}`);
  add('E', 'Straight to the split', lastInc + 1, Y, 'none');

  const lineCm = Math.hypot(Y / rpc, nb / spc);
  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    castOn,
    castOnZones,
    rows,
    phases,
    params,
    counts: { A: 0, B: 0, C: 0, D: 0, E: Y - lastInc, total: Y, neckRow: shortRows && !shortRows.pairs ? null : R, joinRow, rapidBase: 0 },
    start: wholeNeck ? 'neck' : 'back',
    shortRows,
    seamSts: seam,
    capTopSts: sleeve0,
    held,
    underarmCo: N,
    bodyIncs: { perEdge: nb, rows: bodyRows },
    endOfA: { ...castOnZones },
    neck,
    derived: {
      seamCm: lineCm,
      backEndOfACm: bn / spc,
      frontEndOfACm: (FL + FR) / spc,
      sleeveCm: (held.leftSleeve + N) / spc,
      bodyCm: (held.body + 2 * N) / spc,
      armholeCm: 2 * lineCm + N / spc,
      backLengthCm: Y / rpc,
    },
    stitchesPerCm: spc,
    rowsPerCm: rpc,
    raglan: { sleeveTopSts: top, bodyRows, sleeveRows, bodyFast, sleeveFast, lineCm },
  };
}
