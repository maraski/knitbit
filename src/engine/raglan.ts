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
//
// Off-shoulder (`neck.shape` 'off-shoulder', always the whole-ring start, pullover only): a rib band is cast on all
// round below the shoulders (off_shoulder_circ less the band ease) and knit first, in the round; an increase round
// takes it to the ring (front | arm arc | back | arm arc), optional German short rows raise the back, and then the
// raglan rates are solved as above over the rest of the depth (armhole_depth − off_shoulder_drop + the back raise).

import { defaultShortRows, defaultYoke, generateYoke, shortRowSpan, ZONES, type PhaseSummary, type YokeCastOn, type YokeInc, type YokeIssue, type YokeParam, type YokePhase, type YokeResult, type YokeRow, type ZoneCounts } from './contiguous';
import { plugIn } from './bust';
import { distributeAcross } from './distribute';
import { edgePattern, edgesOf } from './edgeTreatments';
import { evaluate, scopeFrom } from './expr';
import { rowsPerCm, stitchesPerCm } from './gauge';
import { buildScope } from './measurements';
import type { DimExpr, Id, NecklineShape, Project, StitchPattern, YokeSpec, YokeStart } from './model';
import { dim, newPanel, type Panel } from './model';

/** Default sleeve top at the cast-on (cm). */
export const RAGLAN_SLEEVE_TOP = 'back_neck_width / 3';

/** Measurements an off-shoulder yoke needs beyond a raglan's (seeded as estimates when it is made). */
export const OFF_SHOULDER_NEEDS = ['off_shoulder_circ', 'off_shoulder_drop'];

/** Off-shoulder depth, band top to underarm at the back: the front's, plus the back raise (`back_raise`, cm). */
export const OFF_SHOULDER_DEPTH = 'armhole_depth - off_shoulder_drop + back_raise';

/** An off-shoulder band without a Neckband edge set to "knit with the panels": 4 cm of 1×1 rib. */
export const OFF_SHOULDER_BAND = { depth: 4, pattern: { name: '1x1 rib', multiple: 2, offset: 0 } as StitchPattern };

/** A folded band's stitch: stockinette; a picot turning round (yo, k2tog) needs an even count. */
export function foldedPattern(turn: 'purl' | 'picot'): StitchPattern {
  return { name: 'stockinette, folded', multiple: turn === 'picot' ? 2 : 1, offset: 0 };
}

/** Which part of a folded band row `r` (1-based) is: facing, turning round, outer half, or the outer half's last row
 * when it joins the band to the cast-on. */
export function foldPart(fold: { close: 'knit' | 'sewn'; depthRows: number }, r: number): 'facing' | 'turn' | 'outer' | 'join' {
  const d = fold.depthRows;
  return r <= d ? 'facing' : r === d + 1 ? 'turn' : r === 2 * d + 1 && fold.close === 'knit' ? 'join' : 'outer';
}

/** Off-shoulder settings: band −10 %, ring 0 %, each arm arc half the bicep; the back raised 2 cm (Modified) or level. */
export function defaultOffShoulder(raised = false): NonNullable<YokeSpec['offShoulder']> {
  return { bandEase: dim(-0.1), ringEase: dim(0), armArc: dim('bicep * 0.5'), backRaise: dim(raised ? 2 : 0) };
}

/** An off-shoulder yoke whose back is raised (read back as the Modified raglan): any back raise other than 0. */
export function offShoulderRaised(spec: YokeSpec): boolean {
  const e = spec.offShoulder?.backRaise.expr.trim() ?? '';
  return e !== '' && Number(e) !== 0;
}

/**
 * A new raglan yoke: 2-st raglan lines with M1R / M1L, the front neck shaped by increases unless `start` = 'neck'.
 * Off-shoulder always casts on the whole ring; there `start` = 'neck' (the Modified card) raises the back.
 */
export function defaultRaglan(shape: NecklineShape = 'round', start: YokeStart = 'back'): YokeSpec {
  const os = shape === 'off-shoulder';
  const y = defaultYoke(os ? 'round' : shape, os ? 'neck' : start);
  const r: YokeSpec = {
    ...y,
    style: 'raglan',
    raglan: { sleeveTop: dim(RAGLAN_SLEEVE_TOP) },
    increase: { type: 'm1', symbol: 'kfb' },
    seamSts: dim(2),
    backNeck: { ...y.backNeck, perRow: dim(0) },
    depth: { ...y.depth, mode: 'back-length', deepen: false },
  };
  if (!os) return r;
  return {
    ...r,
    offShoulder: defaultOffShoulder(start === 'neck'),
    depth: { ...r.depth, backLength: dim(OFF_SHOULDER_DEPTH) },
    // The band's top edge, off_shoulder_drop below the shoulder point (no front neck shaping).
    neck: { shape: 'off-shoulder', depth: dim('off_shoulder_drop'), centre: dim(0) },
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
  const os = spec.neck.shape === 'off-shoulder';
  // Off-shoulder is a pullover only for now: a cardigan front is worked as a pullover (with an error).
  if (os && project.garment.opening === 'cardigan') issues.push({ severity: 'error', message: 'An off-shoulder neckline is pullover only for now: choose a pullover front or another neckline.' });
  const cardigan = project.garment.opening === 'cardigan' && !os;

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
  const seamOf = () => Math.max(0, Math.round(val('seamSts', 'Raglan line stitches', spec.seamSts, 'sts')));

  // ---- the start: the neck (the contiguous generator's), or the off-shoulder band, increase round and back raise ----
  const o = os ? offShoulderStart(project, spec, scope, val, sts, rowsOf, seamOf(), issues) : null;
  let ny: YokeResult | null = null;
  if (!o) {
    // The fronts cast on, the short rows (whole neck), or the front neck increases and centre cast-on (back start); its
    // shoulder and cap phases unused.
    ny = generateYoke(project, { ...spec, style: 'contiguous', backNeck: { ...spec.backNeck, perRow: dim(0) }, cap: { ...spec.cap, solve: false }, depth: { ...spec.depth, deepen: false } }, sizeId);
    issues.push(...ny.issues.filter((i) => /^(Short|Front|Neck|First turn|Sts between|The neck width|Integrated)/.test(i.message)));
    for (const k of ['neckWidth', 'neckDepth', 'neckCentre', 'frontCo', 'srPairs', 'srFirst', 'srStep']) if (ny.params[k]) params[k] = ny.params[k];
  }
  const shortRows = o ? o.shortRows : ny!.shortRows;
  const neck = o ? o.neck : ny!.neck;
  const wholeNeck = !!shortRows;
  const { perSide, centre, frontEdgeCo, row: R } = neck;
  const bn = neck.backNeck;
  const neckSet = new Set(o ? [] : ny!.rows.filter((r) => r.neck).map((r) => r.row));
  const plain = o ? o.plain : new Set(ny!.rows.filter((r) => r.plain).map((r) => r.row));
  // The first row that can increase (off-shoulder: after the band and the increase round) and the short rows' first row.
  const first = o ? o.first : 1;
  const srFrom = shortRows?.fromRow ?? 1;

  // ---- cast-on: the sleeve tops, each between its raglan lines (off-shoulder: the ring's zones, after the band) ----
  const seam = o ? o.seam : seamOf();
  const top = o ? o.armSts : Math.max(0, sts(val('sleeveTop', 'Sleeve top at the cast-on', spec.raglan?.sleeveTop ?? dim(RAGLAN_SLEEVE_TOP), 'cm')));
  const sleeve0 = top + 2 * seam;
  if (sleeve0 < 1) issues.push({ severity: 'error', message: 'The sleeve tops have no stitches: widen the sleeve top or the raglan lines.' });
  const FL = o ? o.ring.leftFront : ny!.castOnZones.leftFront;
  const FR = o ? o.ring.rightFront : ny!.castOnZones.rightFront;
  const ringZones: ZoneCounts = { leftFront: FL, leftSleeve: sleeve0, back: bn, rightSleeve: sleeve0, rightFront: FR };
  const castOnZones: ZoneCounts = o ? o.band : ringZones;
  const castOn = sum(castOnZones);

  // ---- depth: rows from the cast-on to the split ----
  let Y: number;
  if (spec.depth.mode === 'armhole') {
    Y = rowsOf(scope.armhole_depth ?? 0);
    params.backLength = { label: 'Armhole depth', expr: 'armhole_depth', plugged: String(scope.armhole_depth ?? 0), value: scope.armhole_depth ?? 0, overridden: false, unit: 'cm' };
  } else Y = rowsOf(val('backLength', 'Back length, neck to underarm', spec.depth.backLength, 'cm', o ? { back_raise: o.backRaise } : {}));
  Y += rowsOf(val('extraDepth', 'Extra yoke depth', spec.depth.extra, 'cm'));
  // A folded band's facing and turning round fold inside: they don't count towards the depth.
  const hidden = o?.fold?.hiddenRows ?? 0;
  Y += hidden;
  if (Y < 2) {
    issues.push({ severity: 'error', message: `The raglan is ${Y} rows deep: deepen it.` });
    Y = Math.max(Y, 1);
  }
  // A pullover joins at the end of the neck (whole neck: after the short rows); off-shoulder at the cast-on, with the
  // back-raise short rows worked flat in between.
  const joinRow = o ? 0 : cardigan ? null : R;
  const inShortRows = (r: number) => !!shortRows && shortRows.pairs > 0 && r >= srFrom && r <= shortRows.endRow;
  const isRound = (r: number) => (o ? !inShortRows(r) : joinRow !== null && r > joinRow);
  const isRS = (r: number) => isRound(r) || (r - srFrom) % 2 === 0;

  // ---- increase rows: every other row (RS rows / every other round), then the rows between ----
  const slow: number[] = [];
  const fast: number[] = [];
  for (let r = first; r <= Y; r++) if (!plain.has(r)) ((r - first) % 2 === 0 ? slow : fast).push(r);
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
  const narrow = o ? 'Narrow the ring (ring ease) or move the arm arc' : 'Narrow the neck';
  if (bodyNeed(N) < -0.5) issues.push({ severity: 'warning', message: `With ${N} sts cast on at each underarm the body is ${Math.round(-4 * bodyNeed(N))} sts wider than its target (${bodyTarget} sts) without any raglan increases. ${narrow} or cast on less at the underarm.` });
  if (sleeveNeed(N) < -0.5) issues.push({ severity: 'warning', message: `With ${N} sts cast on at each underarm the sleeve is ${Math.round(-2 * sleeveNeed(N))} sts wider than its target (${sleeveFull} sts) without any raglan increases. ${o ? 'Narrow the arm arc' : 'Narrow the sleeve top'} or cast on less at the underarm.` });
  const bodyRows = pickRows(nb, slow, fast);
  const sleeveRows = pickRows(ns, slow, fast);
  const bodyFast = Math.max(0, nb - slow.length);
  const sleeveFast = Math.max(0, ns - slow.length);
  if (bodyFast) issues.push({ severity: 'info', message: `Body: every other row isn't enough, so ${bodyFast} of its ${nb} increase rows are the rows between (increasing on the body every row there).` });
  if (sleeveFast) issues.push({ severity: 'info', message: `Sleeves: every other row isn't enough, so ${sleeveFast} of their ${ns} increase rows are the rows between.` });
  if (R > Y) issues.push({ severity: 'error', message: o ? `The band${shortRows?.pairs ? ', increase round and short rows end' : ' and increase round end'} on row ${R}, below the underarm split (row ${Y}). A shallower band, fewer short rows or a smaller off_shoulder_drop.` : shortRows ? `The short rows end on row ${R}, below the underarm split (row ${Y}). Fewer pairs or a deeper raglan.` : `The front neck closes on row ${R}, below the underarm split (row ${Y}). Make the neck shallower or the raglan deeper.` });
  const bodySet = new Set(bodyRows);
  const sleeveSet = new Set(sleeveRows);
  const lastInc = Math.max(0, ...bodyRows, ...sleeveRows);

  // ---- simulate ----
  const sym = spec.increase.type === 'kfb' ? { before: 'kfb', after: 'kfb' } : spec.increase.type === 'other' ? { before: spec.increase.symbol, after: spec.increase.symbol } : { before: 'm1r', after: 'm1l' };
  const z: ZoneCounts = { ...castOnZones };
  const rows: YokeRow[] = [];
  for (let r = 1; r <= Y; r++) {
    const band = !!o && r <= o.bandRows;
    const phase: YokePhase = band ? 'band' : r <= lastInc ? 'R' : 'E';
    const incs: YokeInc[] = [];
    const castOns: YokeCastOn[] = [];
    // Off-shoulder: the increase round takes each zone from its share of the band to the ring, spread evenly.
    if (o && !o.noBand && r === o.bandRows + 1) {
      for (const k of ZONES) {
        for (const at of distributeAcross(ringZones[k], Math.max(0, ringZones[k] - z[k]))) incs.push({ zone: k, at, symbol: sym.after, kind: 'band' });
        z[k] = ringZones[k];
      }
    }
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
    if (band) row.band = true;
    if (band && o?.fold) row.bandPart = foldPart(o.fold, r);
    if (shortRows && r >= srFrom && r <= shortRows.endRow) Object.assign(row, shortRowSpan(shortRows, r - srFrom + 1, row, cardigan), plain.has(r) ? { plain: true } : {});
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
  if (o && !o.noBand) {
    if (o.fold) {
      const d = o.fold.depthRows;
      add('band', 'Band facing, stockinette, in the round', 1, Math.min(d, Y), `${castOn} sts, no increases`);
      add('band', `Turning round, ${o.fold.turn === 'picot' ? 'picot (yo, k2tog)' : 'purl'}`, d + 1, Math.min(d + 1, Y), 'the fold');
      add('band', 'Band outside, stockinette', d + 2, Math.min(o.bandRows, Y), o.fold.close === 'knit' ? `last round: each st knit together with its cast-on loop` : 'sew the facing down afterwards');
    } else add('band', `Band, ${o.pattern.name}, in the round`, 1, Math.min(o.bandRows, Y), `${castOn} sts, no increases`);
    add('ring', 'Increase round', o.bandRows + 1, Math.min(o.bandRows + 1, Y), `${o.ringSts - castOn} sts spread evenly`);
  }
  if (o) {
    if (shortRows?.pairs) add('neck', 'Short rows (back raise)', srFrom, Math.min(shortRows.endRow, Y), `${shortRows.pairs} pairs, German short rows, then in the round`);
  } else if (shortRows) {
    if (shortRows.pairs) add('neck', 'Short rows (neck)', 1, Math.min(R, Y), `${shortRows.pairs} pairs, German short rows${cardigan ? '' : ', then in the round'}`);
  } else if (perSide > 0 || R <= Y) add('neck', cardigan ? 'Front neck (open)' : 'Front neck, joined', 1, Math.min(R, Y), `${perSide} per side${cardigan ? '' : `, cast on ${centre}`}`);
  const rate = (n: number, f: number) => `${n} rows${f ? ` (${f} of them between)` : ''}`;
  add('R', 'Raglan', first, lastInc, `body 4 on ${rate(nb, bodyFast)}, sleeves 4 on ${rate(ns, sleeveFast)}`);
  add('E', 'Straight to the split', Math.max(first, lastInc + 1), Y, 'none');

  if (o) {
    // The band's top edge sits off_shoulder_drop below the shoulder point; the split should be armhole_depth below
    // it. The front (centre front) works every row but the short rows.
    const frontRows = rows.filter((r) => !r.span || r.span[0] <= 0).length;
    const below = (frontRows - o.bandRows) / rpc;
    if (below < 4) issues.push({ severity: 'error', message: `Only ${below.toFixed(1)} cm between the band and the underarm at the front: the raglan has no room to grow. A smaller off_shoulder_drop or a shallower band.` });
    o.frontRows = frontRows;
  }

  const lineCm = Math.hypot((Y - first + 1) / rpc, nb / spc);
  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    castOn,
    castOnZones,
    rows,
    phases,
    params,
    counts: { A: 0, B: 0, C: 0, D: 0, E: Y - Math.max(first - 1, lastInc), total: Y, neckRow: shortRows && !shortRows.pairs ? null : R, joinRow, rapidBase: 0 },
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
      backLengthCm: (Y - hidden) / rpc,
    },
    stitchesPerCm: spc,
    rowsPerCm: rpc,
    raglan: { sleeveTopSts: top, bodyRows, sleeveRows, bodyFast, sleeveFast, lineCm },
    ...(o ? { offShoulder: { bandSts: castOn, bandRows: o.bandRows, bandCm: o.bandCm, pattern: o.pattern, ringSts: o.ringSts, ringZones, incRow: o.noBand ? 0 : o.bandRows + 1, armSts: o.armSts, backRaiseCm: o.backRaise, frontRows: o.frontRows, ...(o.fold ? { fold: o.fold } : {}), ...(o.noBand ? { noBand: true } : {}) } } : {}),
  };
}

type Val = (key: string, label: string, d: DimExpr, unit: YokeParam['unit'], extra?: Record<string, number>) => number;

/**
 * The off-shoulder start: the ring (sleeve zones = arm arc + the raglan lines, the rest half front, half back), the
 * band's count (a multiple of its stitch pattern) and zones (the ring's, scaled), its rows, and the back-raise short
 * rows after the increase round (turning in the fronts, as the whole-neck start's, from just past the raglan line
 * towards the front's middle).
 */
function offShoulderStart(project: Project, spec: YokeSpec, scope: Record<string, number>, val: Val, sts: (cm: number) => number, rowsOf: (cm: number) => number, seam: number, issues: YokeIssue[]) {
  const os = spec.offShoulder ?? defaultOffShoulder();
  const circ = scope.off_shoulder_circ;
  if (circ === undefined) issues.push({ severity: 'error', message: 'Off-shoulder needs the off_shoulder_circ measurement (around both upper arms and the torso at band height).' });
  if (scope.off_shoulder_drop === undefined) issues.push({ severity: 'error', message: 'Off-shoulder needs the off_shoulder_drop measurement (shoulder point down to the band).' });
  const c = circ ?? 0;
  // No band when the Neckband edge is switched off: the ring is cast on and the raglan starts at once.
  const nbEdge = edgesOf(project).neckband;
  const noBand = !nbEdge.enabled;
  const bandEase = noBand ? 0 : val('bandEase', 'Band ease (fraction of off_shoulder_circ)', os.bandEase, '');
  const ringEase = val('ringEase', 'Ring ease (fraction of off_shoulder_circ)', os.ringEase, '');
  const armCm = Math.max(0, val('armArc', 'Arm arc at the ring, each sleeve (between the raglan lines)', os.armArc, 'cm'));
  const backRaise = Math.max(0, val('backRaise', 'Back raise (short rows)', os.backRaise, 'cm'));
  if (noBand) issues.push({ severity: 'info', message: 'No band (the Neckband is off): the ring is cast on as the top edge, and only its ease (ring ease) holds the garment up.' });
  else if (bandEase > -0.05) issues.push({ severity: 'warning', message: `Band ease ${Math.round(bandEase * 100)} %: with less than 5 % negative ease the band may slide down.` });
  else if (bandEase < -0.2) issues.push({ severity: 'warning', message: `Band ease ${Math.round(bandEase * 100)} %: more than 20 % negative ease may be too tight to pull over the arms.` });

  // The ring after the increase round.
  const ringSts = Math.max(0, sts(c * (1 + ringEase)));
  const armSts = sts(armCm);
  const sleeve = armSts + 2 * seam;
  const bodySts = ringSts - 2 * sleeve;
  if (bodySts <= 0) issues.push({ severity: 'error', message: `The ring (${ringSts} sts) has no room for the body after two sleeve zones of ${sleeve} sts: a smaller arm arc.` });
  const back = Math.max(0, Math.floor(bodySts / 2));
  const front = Math.max(0, bodySts - back);
  const ring: ZoneCounts = { leftFront: Math.floor(front / 2), leftSleeve: sleeve, back, rightSleeve: sleeve, rightFront: front - Math.floor(front / 2) };

  // The band: from the Neckband edge when it is knit with the panels, else 4 cm of 1×1 rib (none when it is off).
  const withPanel = nbEdge.enabled && nbEdge.method === 'with-panel';
  // A folded band: stockinette, its finished depth knit twice with a turning round between (picot pairs its stitches).
  const f0 = withPanel ? nbEdge.fold : undefined;
  const pattern = f0 ? foldedPattern(f0.turn) : withPanel ? edgePattern(nbEdge) : OFF_SHOULDER_BAND.pattern;
  const bandCm = withPanel ? val('bandDepth', f0 ? 'Band depth, finished (Neckband edge)' : 'Band depth (Neckband edge)', nbEdge.depth, 'cm') : OFF_SHOULDER_BAND.depth;
  const depthRows = Math.max(1, rowsOf(bandCm));
  const bandRows = noBand ? 0 : f0 ? 2 * depthRows + 1 : depthRows;
  const fold = f0 ? { turn: f0.turn, close: f0.close, depthRows, hiddenRows: depthRows + 1 } : undefined;
  const m = Math.max(1, pattern.multiple);
  const bandSts = noBand ? ringSts : Math.max(m, Math.round(sts(c * (1 + bandEase)) / m) * m);
  if (!noBand && bandSts > ringSts) issues.push({ severity: 'error', message: `The band (${bandSts} sts) is wider than the ring (${ringSts} sts): its ease must be below the ring's.` });
  // The band's zones: the ring's scaled to the band, the rest of the count on the fronts.
  const f = ringSts > 0 ? Math.min(1, bandSts / ringSts) : 0;
  const bSleeve = Math.round(sleeve * f);
  const bBack = Math.round(back * f);
  const bFront = Math.max(0, bandSts - 2 * bSleeve - bBack);
  const band: ZoneCounts = { leftFront: Math.floor(bFront / 2), leftSleeve: bSleeve, back: bBack, rightSleeve: bSleeve, rightFront: bFront - Math.floor(bFront / 2) };

  // The back raise: German short rows after the increase round, turning in the fronts.
  const sr = spec.shortRows ?? defaultShortRows();
  const side = Math.min(ring.leftFront, ring.rightFront);
  const cSide = Math.floor(side / 2);
  const pairs = Math.max(0, Math.round(val('srPairs', 'Short-row pairs', sr.pairs, '', { neck_depth: backRaise, back_depth: 0 })));
  const firstTurn = Math.max(1, Math.round(val('srFirst', 'First turn, sts past the raglan marker', sr.first, 'sts')));
  const step = Math.max(1, Math.round(val('srStep', 'Sts between turns', sr.step, 'sts', { front_side: side, centre_side: cSide, first_turn: firstTurn, pairs })));
  const turns: number[] = [];
  for (let i = 0; i < pairs; i++) turns.push(side - firstTurn - i * step);
  const lastTurn = turns[turns.length - 1] ?? side;
  if (pairs && lastTurn < 1) issues.push({ severity: 'error', message: `Short rows: ${pairs} pairs ${step} sts apart don't fit in a front of ${side} sts (the last turn is past centre front). Fewer pairs or a smaller step.` });
  if (pairs > 1 && step < 2) issues.push({ severity: 'info', message: `Short rows: turns 1 st apart. Fewer pairs spread them more.` });
  // The first row after the band and its increase round (row 1 without a band).
  const fromRow = noBand ? 1 : bandRows + 2;
  const endRow = pairs > 0 ? fromRow + 2 * pairs : 0;
  // No raglan increases on the band, the increase round, or the half rows that start and end the short rows.
  const plain = new Set<number>();
  if (pairs > 0) {
    plain.add(fromRow);
    plain.add(endRow);
  }
  const shortRows: NonNullable<YokeResult['shortRows']> = { pairs, first: firstTurn, step, turns: turns.map((u) => Math.max(1, u)), endRow, frontSts: ring.leftFront + ring.rightFront, fromRow };
  const R = pairs > 0 ? endRow : noBand ? 0 : bandRows + 1;
  const neck: YokeResult['neck'] = { depthRows: 0, row: R, perSide: 0, backNeck: back, centre: 0, closingSts: 0, frontEdgeCo: 0 };
  return { ring, band, bandRows, bandCm: noBand ? 0 : bandCm, pattern, fold: noBand ? undefined : fold, noBand, first: fromRow, ringSts, armSts, seam, backRaise, shortRows, plain, neck, frontRows: 0 };
}
