// Computing one panel in one size: waypoint expressions → rounded rows and stitches → shaping events
// per edge → row-by-row edge positions → outline. Pure; the UI only draws the result.
//
// Coordinates: x in stitches from the panel's centre line (negative = left edge as seen from the RS),
// y in rows from the cast-on (row r spans y = r-1 … r). Flat knitting: row 1 is a RS row, so bind-offs
// at the start of a row land on the right edge on odd rows and the left edge on even rows.
//
// Waypoint heights are always measured up from the garment's lower edge, so a panel keeps its upright shape.
// A top-down panel is computed in knitting order (row 1 at the top); `topDown` tells the renderer to flip it.

import { distributeAuto, distributeFixed, distributeMixed, describeSchedule, eligibleRows, placeIntervals, splitEvenly, type RowSide, type RowSpan, type ShapingSchedule } from './distribute';
import { resolveDefinitions } from './expr';
import { rowsPerCm, stitchesPerCm } from './gauge';
import { missingAliasHint } from './fit';
import { buildScope, evaluateDim } from './measurements';
import type { FrontHalf, Id, ManualEvent, Panel, Project, Segment, SegmentMethod, ShapingPlacement } from './model';
import { defaultAutoMethod, defaultPrincess } from './model';
import { roundNearest, roundRows, roundStitches, type RoundingResult } from './rounding';
import { bustValues, computeBust, type ComputedBust } from './bust';
import { sideEdgeLength } from './edges';
import { measureEdge } from './joins';
import { computeYokePanel } from './yokePanel';
import { yokeNames, type YokeResult } from './contiguous';
import { defaultSymbol } from './symbols';
import { bandOnFront } from './bands';
import { edgePattern } from './edgeTreatments';
import { freeCells, freeInterior } from './free';
import { computeLines, type ComputedLine } from './lines';

export type Edge = 'left' | 'right';
export type EventKind = 'dec' | 'inc' | 'bindoff' | 'caston' | 'turn';

export interface ShapeEvent {
  row: number; // absolute row (1-based); the change is complete at the end of this row
  delta: number; // stitch change at this edge (negative = fewer stitches)
  kind: EventKind;
  symbol?: string;
}

export type IssueRef =
  | { kind: 'line'; id: Id }
  | { kind: 'panel' }
  | { kind: 'waypoint'; id: Id }
  | { kind: 'segment'; fromWaypoint: Id; edge?: Edge }
  | { kind: 'neckline' }
  | { kind: 'bust' }
  | { kind: 'join'; id: Id };

export interface Issue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  ref: IssueRef;
}

export interface ComputedWaypoint {
  id: Id;
  name: string;
  key: string; // identifier used in expressions: `<key>.height`, `<key>.width`
  heightCm: number; // target, relative to the panel's first waypoint
  row: number;
  rowRounding: RoundingResult;
  symmetric: boolean;
  widthCm: number; // target
  leftCm: number;
  rightCm: number;
  stitches: number; // target stitch count after rounding (incl. selvedges)
  stitchRounding: RoundingResult[]; // one (symmetric) or two (left, right)
  leftPos: number; // target x of the left edge (≤ 0)
  rightPos: number;
  actualStitches: number; // what the shaping actually reaches at this row
  /** A cardigan front: the whole front's target width (both fronts, closed) at this waypoint. */
  wholeCm?: number;
  selvedge: number; // selvedge stitches included in `stitches` (0 in the round)
  inRound: boolean;
  overridden: { height: boolean; width: boolean };
}

export interface ComputedSection {
  id: Id;
  name: string;
  fromRow: number; // knit rows, fromRow ≤ toRow
  toRow: number;
  multiple: number;
  offset: number;
  patternName: string;
}

export interface EdgeShaping {
  method: SegmentMethod['kind'] | 'manual';
  target: number; // stitch change this edge needs
  events: ShapeEvent[];
  summary: string;
}

export interface ComputedSegment {
  fromWaypoint: Id;
  toWaypoint: Id;
  index: number;
  rowFrom: number; // first row of the segment
  rowTo: number; // last row (the upper waypoint's row)
  mirror: boolean;
  implicit: boolean; // no stored segment: default auto shaping was used
  /** Where increases/decreases are worked; 'both' = 1 st at the edge, the rest at the princess line. */
  placement: ShapingPlacement;
  left: EdgeShaping;
  right: EdgeShaping;
}

export interface ComputedNeck {
  shape: string;
  atStart: boolean; // top-down: the neck is at the cast-on and the centre is cast on to join the shoulders
  splitRow: number; // row on which the centre stitches are bound off / held (bottom-up) or cast on (top-down)
  openRow: number; // knit row at the neck's open end (the garment's top): totalRows bottom-up, 0 top-down
  centreX: number; // middle of the centre stitches (may be off the centre line by ½ st)
  depthRows: number;
  centreSts: number; // a cardigan front: the stitches its own half takes off (or casts on) at the front edge
  widthSts: number;
  /** A cardigan front: only one neck edge (`perSide` shaping), the centre stitches are at the front edge. */
  oneSide?: boolean;
  perSide: number;
  events: ShapeEvent[]; // neck-edge decreases, same rows on both sides
  summary: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface Marker {
  edge: Edge | 'neckLeft' | 'neckRight';
  row: number;
  x: number; // edge position after the event
  delta: number;
  kind: EventKind;
  segment: number; // segment index, or -1 for the neckline
  atLine?: boolean; // on a princess line, not the edge
}

export interface ComputedPanel {
  panelId: Id;
  sizeId: Id;
  ok: boolean; // false when the geometry could not be computed (see issues)
  topDown: boolean; // rows run from the garment's top; draw row r at garment height totalRows − r
  stitchesPerCm: number;
  rowsPerCm: number;
  waypoints: ComputedWaypoint[];
  segments: ComputedSegment[];
  neck: ComputedNeck | null;
  totalRows: number;
  /** Knit rows worked in the round (whole panel, or the part below the join), or null if all flat. */
  roundRows: { from: number; to: number } | null;
  /** Knit row 1 of the flat part is a RS row; RS rows are those with the same parity as this. */
  firstFlatRow: number;
  sections: ComputedSection[];
  bust: ComputedBust | null;
  /** Shaping lines drawn in the panel, for this size. */
  lines: ComputedLine[];
  /** Princess lines, when any segment shapes at them: distance of each line from the row's centre (sts). */
  princess: { offset: number; sides: 'both' | 'one' } | null;
  /** Stitches held (live but not worked) by short-row segments, per knit row. */
  held: number[];
  leftEdge: number[]; // x of the left edge at the end of each row (index = row; 0 = cast-on)
  rightEdge: number[];
  neckLeft: (number | null)[];
  neckRight: (number | null)[];
  counts: number[]; // live stitches at the end of each row
  outline: Point[]; // closed polygon, stitch/row units
  markers: Marker[];
  issues: Issue[];
  /**
   * Cardigan front: the half of the whole front this panel shows, and the whole front's centre per knit row
   * (for anything placed relative to the centre: princess and shaping lines, darts, painted stitches).
   */
  half?: {
    side: 'left' | 'right';
    keep: Edge;
    cfX: number;
    centre: number[];
    /** Integrated band: stitches next to the front-edge selvedge, worked in the band pattern. */
    bandSts: number;
    band: { name: string; multiple: number; offset: number } | null;
  };
  /** A contiguous yoke: the generator's result (rows, zones, phases, held edges). */
  yoke?: YokeResult;
}

/** The centre a row's centre-relative positions are measured from (the whole front's centre for a cardigan front). */
export function rowCentre(c: Pick<ComputedPanel, 'leftEdge' | 'rightEdge' | 'half'>, r: number): number {
  return c.half ? c.half.centre[r] ?? 0 : (c.leftEdge[r] + c.rightEdge[r]) / 2;
}

/** Identifier for a waypoint name: "Under arm" → "under_arm". */
export function waypointKey(name: string): string {
  const k = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[0-9]/.test(k) || k === '' ? `wp_${k}` : k;
}

/**
 * Expression definitions for a panel's waypoints, so dimensions can refer to each other,
 * e.g. `underarm.width - 4`. Per-size overrides become literal numbers.
 */
export function waypointDefinitions(panel: Panel, sizeId: Id): Record<string, string> {
  const defs: Record<string, string> = {};
  const val = (d: { expr: string; overrides: Record<Id, number> }) => (sizeId in d.overrides ? String(d.overrides[sizeId]) : d.expr);
  for (const wp of panel.waypoints) {
    const k = waypointKey(wp.name);
    defs[`${k}.height`] = val(wp.height);
    if (wp.symmetric) {
      defs[`${k}.width`] = val(wp.width);
      defs[`${k}.left`] = `(${k}.width) / 2`;
      defs[`${k}.right`] = `(${k}.width) / 2`;
    } else {
      defs[`${k}.left`] = val(wp.left);
      defs[`${k}.right`] = val(wp.right);
      defs[`${k}.width`] = `${k}.left + ${k}.right`;
    }
  }
  return defs;
}

/** Evaluate all waypoint dimensions of a panel for one size. */
export function resolvePanelDims(project: Project, panel: Panel, sizeId: Id) {
  const base = buildScope(project, sizeId);
  const extra = panelExtras(project, panel, sizeId);
  return resolveDefinitions(waypointDefinitions(panel, sizeId), { ...base, ...bustValues(panel, sizeId, base), ...extra });
}

/** Names a panel takes from other panels: armhole_len, edge_len / edge_rows / edge_pickup, yoke.* (only those it uses). */
export function panelExtras(project: Project, panel: Panel, sizeId: Id): Record<string, number> {
  const extra: Record<string, number> = {};
  if (usesName(panel, 'armhole_len')) {
    const a = armholeLength(project, panel, sizeId);
    if ('value' in a) extra.armhole_len = a.value;
  }
  if (EDGE_NAMES.some((n) => usesName(panel, n))) {
    const j = joinedEdge(project, panel, sizeId);
    if ('lengthCm' in j) Object.assign(extra, { edge_len: j.lengthCm, edge_rows: j.rows, edge_pickup: j.pickup });
  }
  if (usesYoke(panel)) {
    const n = yokeNames(project, sizeId);
    if ('values' in n) Object.assign(extra, n.values);
  }
  return extra;
}

/** The panel's expressions mention a `yoke.*` name (and it isn't the yoke itself). */
function usesYoke(panel: Panel): boolean {
  if (panel.yoke) return false;
  const exprs = [
    ...panel.waypoints.flatMap((w) => [w.height.expr, w.width.expr, w.left.expr, w.right.expr]),
    ...panel.sections.flatMap((x) => [x.fromHeight.expr, x.toHeight.expr]),
    ...(panel.bust ? [panel.bust.apexHeight.expr, panel.bust.apexOffset.expr, panel.bust.vertical.top.expr, panel.bust.vertical.bottom.expr] : []),
  ];
  return exprs.some((e) => /(^|[^A-Za-z0-9_.])yoke\./.test(e));
}

function usesName(panel: Panel, name: string): boolean {
  const re = new RegExp(`(^|[^A-Za-z0-9_.])${name}(?![A-Za-z0-9_])`);
  const exprs = [
    ...panel.waypoints.flatMap((w) => [w.height.expr, w.width.expr, w.left.expr, w.right.expr]),
    ...panel.sections.flatMap((x) => [x.fromHeight.expr, x.toHeight.expr]),
  ];
  return exprs.some((e) => re.test(e));
}

// Panels being computed while resolving armhole_len / edge_len, to stop a panel measuring itself (directly or in a loop).
const measuring = new Set<string>();

const EDGE_NAMES = ['edge_len', 'edge_rows', 'edge_pickup'];

/**
 * The edges a strip (band, neckband) is joined to, for `edge_len` (cm along them), `edge_rows` and `edge_pickup`
 * (the pick-up helper's count at the join's ratio): the other side of the first join this panel is part of.
 */
export function joinedEdge(project: Project, panel: Panel, sizeId: Id): { lengthCm: number; rows: number; pickup: number; source: string } | { error: string } {
  const key = `${panel.id}|${sizeId}`;
  if (measuring.has(key)) return { error: 'edge_len refers back to this panel.' };
  const j = (project.joins ?? []).find((x) => x.partner.some((r) => r.panelId === panel.id) || x.edges.some((r) => r.panelId === panel.id));
  if (!j) return { error: 'this panel is not in a join; join it to the edges it is attached to.' };
  const other = j.partner.some((r) => r.panelId === panel.id) ? j.edges : j.partner;
  if (!other.length || other.some((r) => r.panelId === panel.id)) return { error: `the join "${j.name}" has no other side to measure.` };
  measuring.add(key);
  try {
    let lengthCm = 0;
    let rows = 0;
    let pickup = 0;
    const ratio = j.ratio ?? project.settings.pickUp;
    for (const r of other) {
      if (measuring.has(`${r.panelId}|${sizeId}`)) return { error: 'edge_len: the joined panels measure each other.' };
      const m = measureEdge(project, r, sizeId, ratio);
      if (!m.ok) return { error: `${m.label}: ${m.error}` };
      lengthCm += m.lengthCm;
      rows += m.rows;
      pickup += m.pickup;
    }
    return { lengthCm, rows, pickup, source: `join "${j.name}"` };
  } finally {
    measuring.delete(key);
  }
}

/**
 * The armhole a sleeve is sewn into, for `armhole_len` (cm, measured along the edges).
 * Uses the seam join that contains one of this panel's edges, if any (the other side's side edges);
 * otherwise the Front + Back panels' armholes (left edge, underarm → shoulder).
 */
export function armholeLength(project: Project, panel: Panel, sizeId: Id): { value: number; source: string } | { error: string } {
  const key = `${panel.id}|${sizeId}`;
  if (measuring.has(key)) return { error: 'armhole_len refers back to this panel.' };
  measuring.add(key);
  try {
    const measure = (panelId: Id, side: Edge, from: Id, to: Id): number | null => {
      const other = project.panels.find((p) => p.id === panelId);
      if (!other || other.id === panel.id || measuring.has(`${other.id}|${sizeId}`)) return null;
      const c = computePanel(project, other, sizeId);
      return c.ok ? sideEdgeLength(c, side, from, to)?.lengthCm ?? null : null;
    };
    for (const j of project.joins ?? []) {
      if (j.tag !== 'seam') continue;
      const mine = j.edges.some((e) => e.panelId === panel.id) ? j.partner : j.partner.some((e) => e.panelId === panel.id) ? j.edges : null;
      if (!mine || !mine.length) continue;
      let total = 0;
      for (const ref of mine) {
        if (ref.edge.kind !== 'side') return { error: `The seam "${j.name}" has a non-side edge; armhole_len needs side edges.` };
        const v = measure(ref.panelId, ref.edge.side, ref.edge.from, ref.edge.to);
        if (v === null) return { error: `Could not measure an edge of the seam "${j.name}".` };
        total += v;
      }
      return { value: total, source: `seam "${j.name}"` };
    }
    let total = 0;
    const names: string[] = [];
    for (const tpl of ['front', 'back']) {
      const body = project.panels.find((p) => p.template === tpl);
      const u = body?.waypoints.find((w) => waypointKey(w.name) === 'underarm');
      const sh = body?.waypoints.find((w) => waypointKey(w.name) === 'shoulder');
      if (!body || !u || !sh) {
        // No body to measure: the body's scye circumference when the sizing table has it, else an estimate from the
        // armhole depth plus its horizontal shaping, both sides.
        const m = buildScope(project, sizeId);
        if (m.scye_circumference !== undefined) return { value: m.scye_circumference, source: 'scye_circumference (no Front and Back panels to measure)' };
        if (m.armhole_depth === undefined) return { error: 'No seam join, no Front and Back panels, and no armhole_depth to estimate from.' };
        const across = Math.max(0, ((m.upper_chest ?? 0) / 2 + (m.ease ?? 0) / 2 - (m.cross_back ?? 0)) / 2);
        return { value: 2 * Math.hypot(m.armhole_depth, across) + 2 * across * 0.4, source: 'an estimate (no Front and Back panels to measure)' };
      }
      const v = measure(body.id, armholeSide(body), u.id, sh.id);
      if (v === null) return { error: `Could not measure the ${body.name} armhole.` };
      total += v;
      names.push(body.name);
    }
    return { value: total, source: `${names.join(' + ')} armholes` };
  } finally {
    measuring.delete(key);
  }
}

/** The edge an armhole is on: the left edge, except on a left cardigan front (whose left edge is the front edge). */
export function armholeSide(panel: Panel): Edge {
  return panel.half?.side === 'left' ? 'right' : 'left';
}

function emptyPanel(panel: Panel, sizeId: Id, spc: number, rpc: number, issues: Issue[]): ComputedPanel {
  return {
    panelId: panel.id,
    sizeId,
    ok: false,
    topDown: panel.direction === 'top-down',
    stitchesPerCm: spc,
    rowsPerCm: rpc,
    waypoints: [],
    segments: [],
    neck: null,
    totalRows: 0,
    roundRows: null,
    firstFlatRow: 1,
    princess: null,
    lines: [],
    sections: [],
    bust: null,
    held: [],
    leftEdge: [],
    rightEdge: [],
    neckLeft: [],
    neckRight: [],
    counts: [],
    outline: [],
    markers: [],
    issues,
  };
}

export function computePanel(project: Project, panel: Panel, sizeId: Id): ComputedPanel {
  if (panel.yoke) return computeYokePanel(project, panel, sizeId);
  const raw = computePanelRaw(project, panel, sizeId);
  const c = panel.half ? cropHalf(raw, panel, panel.half, halfFrame(project, panel.half, raw.stitchesPerCm, buildScope(project, sizeId))) : raw;
  // Explain unknown names that follow a fit choice (e.g. hem_circ when the table has no high_hip).
  if (!c.issues.some((i) => /Unknown name "/.test(i.message))) return c;
  const issues = c.issues.map((i) => {
    const m = /Unknown name "([\w.]+)"/.exec(i.message);
    const hint = m && missingAliasHint(project, m[1]);
    return hint ? { ...i, message: `${i.message}: ${hint}.` } : i;
  });
  return { ...c, issues };
}

function computePanelRaw(project: Project, panel: Panel, sizeId: Id): ComputedPanel {
  const spc = stitchesPerCm(project.gauge);
  const rpc = rowsPerCm(project.gauge);
  const issues: Issue[] = [];
  const topDown = panel.direction === 'top-down';

  if (panel.waypoints.length < 2) {
    issues.push({ severity: 'error', message: 'A panel needs at least two waypoints (e.g. hem and top).', ref: { kind: 'panel' } });
    return emptyPanel(panel, sizeId, spc, rpc, issues);
  }

  const keys = panel.waypoints.map((w) => waypointKey(w.name));
  keys.forEach((k, i) => {
    if (keys.indexOf(k) !== i) issues.push({ severity: 'error', message: `Two waypoints are named "${k}"; names must be unique.`, ref: { kind: 'waypoint', id: panel.waypoints[i].id } });
  });

  // ---- evaluate expressions ----
  if (usesName(panel, 'armhole_len')) {
    const a = armholeLength(project, panel, sizeId);
    issues.push(
      'value' in a
        ? { severity: 'info', message: `armhole_len = ${a.value.toFixed(1)} cm, from ${a.source}.`, ref: { kind: 'panel' } }
        : { severity: 'error', message: `armhole_len: ${a.error}`, ref: { kind: 'panel' } },
    );
  }
  if (EDGE_NAMES.some((n) => usesName(panel, n))) {
    const j = joinedEdge(project, panel, sizeId);
    issues.push(
      'lengthCm' in j
        ? { severity: 'info', message: `edge_len = ${j.lengthCm.toFixed(1)} cm, edge_rows = ${j.rows}, edge_pickup = ${j.pickup} sts, from ${j.source}.`, ref: { kind: 'panel' } }
        : { severity: 'error', message: `edge_len: ${j.error}`, ref: { kind: 'panel' } },
    );
  }
  if (usesYoke(panel)) {
    const n = yokeNames(project, sizeId);
    if ('error' in n) issues.push({ severity: 'error', message: `yoke.*: ${n.error}`, ref: { kind: 'panel' } });
  }
  const { values, errors } = resolvePanelDims(project, panel, sizeId);
  let failed = false;
  panel.waypoints.forEach((wp, i) => {
    const k = keys[i];
    for (const field of ['height', ...(wp.symmetric ? ['width'] : ['left', 'right'])]) {
      const e = errors[`${k}.${field}`];
      if (e) {
        failed = true;
        issues.push({ severity: 'error', message: `${wp.name} ${field}: ${e}`, ref: { kind: 'waypoint', id: wp.id } });
      }
    }
  });
  if (failed) return emptyPanel(panel, sizeId, spc, rpc, issues);

  // ---- in-the-round part and pattern sections (garment heights) ----
  // A cardigan front is always flat.
  const half = panel.half ?? null;
  const inTheRound = panel.inTheRound && !half;
  const joinWp = !inTheRound && !half && panel.joinAt ? panel.waypoints.find((w) => w.id === panel.joinAt) : undefined;
  const joinH = joinWp ? values[`${waypointKey(joinWp.name)}.height`] : undefined;
  const inRoundAt = (h: number) => inTheRound || (joinH !== undefined && h <= joinH + 1e-9);
  const scope = { ...buildScope(project, sizeId), ...panelExtras(project, panel, sizeId), ...values };
  const frame = half ? halfFrame(project, half, spc, scope) : null;
  const rawSections = panel.sections.flatMap((sec) => {
    const a = evaluateDim(sec.fromHeight, sizeId, scope);
    const b = evaluateDim(sec.toHeight, sizeId, scope);
    if (!a.ok || !b.ok) {
      issues.push({ severity: 'error', message: `Section "${sec.name}": ${!a.ok ? a.error : !b.ok ? b.error : ''}`, ref: { kind: 'panel' } });
      return [];
    }
    return [{ sec, from: Math.min(a.value.value, b.value.value), to: Math.max(a.value.value, b.value.value) }];
  });
  const sectionAt = (h: number) => rawSections.find((x) => h >= x.from - 1e-9 && h < x.to - 1e-9);

  // ---- waypoints: rows and stitches ----
  // Parity 'start': the waypoint the panel is knitted from rounds freely; the others take its parity, so every
  // width change is even and both edges shape in pairs.
  let startIdx = -1;
  let startParity: 'even' | 'odd' | 'any' = 'any';
  if (panel.rounding.parity === 'start' && panel.waypoints.length) {
    const hs = keys.map((k) => values[`${k}.height`]);
    startIdx = hs.indexOf(topDown ? Math.max(...hs) : Math.min(...hs));
    const k = keys[startIdx];
    const sh = values[`${k}.height`];
    const pat = sectionAt(sh)?.sec.pattern ?? panel.pattern;
    const sel = inRoundAt(sh) ? 0 : panel.selvedge.left + panel.selvedge.right;
    const n = roundStitches((values[`${k}.left`] + values[`${k}.right`]) * spc, { multiple: pat.multiple, offset: pat.offset, selvedge: sel }).value;
    startParity = n % 2 === 0 ? 'even' : 'odd';
  }
  let wps = panel.waypoints.map((wp, i): ComputedWaypoint => {
    const k = keys[i];
    const heightCm = values[`${k}.height`];
    const leftCm = values[`${k}.left`];
    const rightCm = values[`${k}.right`];
    const inRound = inRoundAt(heightCm);
    const selL = inRound ? 0 : panel.selvedge.left;
    const selR = inRound ? 0 : panel.selvedge.right;
    const pattern = sectionAt(heightCm)?.sec.pattern ?? panel.pattern;
    const parity = panel.rounding.parity === 'start' ? (i === startIdx ? 'any' : startParity) : panel.rounding.parity;
    const rules = { multiple: pattern.multiple, offset: pattern.offset, parity };
    let stitchRounding: RoundingResult[];
    let leftPos: number;
    let rightPos: number;
    if (half) {
      // Round each front on its own (pattern multiple, both selvedges); the whole front is twice that, less the
      // centre-front selvedges. The other half follows the same rule (mirrored), or its own width when asymmetric.
      // Each front's body is (whole front − closing_r) / 2; it starts `cut` sts from the centre line.
      const keepRight = half.side === 'left';
      const shift = frame!.closingCm / 2;
      const roundHalf = (cm: number, sel: number) => roundStitches((cm - shift) * spc, { multiple: pattern.multiple, offset: pattern.offset, selvedge: sel + half.cfSelvedge });
      const kept = roundHalf(keepRight ? rightCm : leftCm, keepRight ? selR : selL);
      const inner = frame!.cut + kept.value - half.cfSelvedge;
      const other = wp.symmetric ? inner : frame!.cut + roundHalf(keepRight ? leftCm : rightCm, keepRight ? selL : selR).value - half.cfSelvedge;
      stitchRounding = [kept];
      leftPos = -(keepRight ? other : inner);
      rightPos = keepRight ? inner : other;
    } else if (wp.symmetric) {
      const r = roundStitches((leftCm + rightCm) * spc, { ...rules, selvedge: selL + selR });
      stitchRounding = [r];
      leftPos = -r.value / 2;
      rightPos = r.value / 2;
    } else {
      const l = roundStitches(leftCm * spc, { selvedge: selL });
      const r = roundStitches(rightCm * spc, { selvedge: selR });
      stitchRounding = [l, r];
      leftPos = -l.value;
      rightPos = r.value;
    }
    return {
      id: wp.id,
      name: wp.name,
      key: k,
      heightCm,
      row: 0,
      rowRounding: roundRows(0),
      symmetric: wp.symmetric,
      widthCm: leftCm + rightCm,
      leftCm,
      rightCm,
      stitches: rightPos - leftPos,
      stitchRounding,
      leftPos,
      rightPos,
      actualStitches: 0,
      selvedge: selL + selR,
      inRound,
      overridden: {
        height: sizeId in wp.height.overrides,
        width: wp.symmetric ? sizeId in wp.width.overrides : sizeId in wp.left.overrides || sizeId in wp.right.overrides,
      },
    };
  });

  const sorted = [...wps].sort((a, b) => a.heightCm - b.heightCm);
  if (sorted.some((w, i) => w !== wps[i])) {
    issues.push({ severity: 'warning', message: 'Waypoints are not in height order; they are drawn in height order.', ref: { kind: 'panel' } });
    wps = sorted;
  }
  const h0 = wps[0].heightCm;
  const roundRows_ = (h: number) => roundRows(h * rpc).value;
  for (const w of wps) w.heightCm -= h0;
  if (h0 !== 0) issues.push({ severity: 'info', message: `The lowest waypoint is at ${h0.toFixed(1)} cm; heights are measured from it.`, ref: { kind: 'waypoint', id: wps[0].id } });
  for (const w of wps) {
    w.rowRounding = roundRows(w.heightCm * rpc, panel.rounding.rowParity);
    w.row = w.rowRounding.value;
    if (w.stitches <= 0) issues.push({ severity: 'error', message: `${w.name}: width gives ${w.stitches} stitches.`, ref: { kind: 'waypoint', id: w.id } });
    for (const r of w.stitchRounding) for (const m of r.warnings) issues.push({ severity: 'warning', message: `${w.name}: ${m}`, ref: { kind: 'waypoint', id: w.id } });
  }
  if (topDown) {
    // Knitting order: start at the garment's top. Rows are rounded in garment terms first, then
    // counted down from the top, so both directions give exactly mirrored row numbers.
    const top = wps[wps.length - 1];
    const H = top.heightCm;
    const R = top.row;
    for (const w of wps) {
      w.heightCm = H - w.heightCm;
      w.row = R - w.row;
    }
    wps.reverse();
  }

  const totalRows = wps[wps.length - 1].row;

  // Which knit rows are flat, and which flat rows are RS. Bottom-up with a join: rounds first, then flat
  // from the row after the join. Top-down: flat from row 1 down to the join, then rounds.
  const joinRow = joinWp ? wps.find((w) => w.id === joinWp.id)!.row : null;
  let roundPart: { from: number; to: number } | null = null;
  if (inTheRound) roundPart = { from: 1, to: totalRows };
  else if (joinRow !== null) {
    let from = joinRow + 1;
    // Top-down with a front neckline: the fronts are joined at the centre when the neck shaping is done. If that is
    // below the underarm join (a deep V), the body stays flat until then.
    if (topDown && panel.neckline) {
      const d = evaluateDim(panel.neckline.depth, sizeId, scope);
      if (d.ok) {
        let split = roundRows(d.value.value * rpc).value;
        if (split % 2 === 0) split += 1; // the centre is cast on on a RS row
        if (split >= from) {
          issues.push({ severity: 'info', message: `The neck closes on row ${split}, below the underarm join (row ${joinRow}): the body is worked flat until then, in the round from row ${split + 1}.`, ref: { kind: 'neckline' } });
          from = split + 1;
        }
      }
    }
    roundPart = topDown ? { from: Math.min(from, totalRows + 1), to: totalRows } : { from: 1, to: joinRow };
    if (topDown && roundPart.from > roundPart.to) roundPart = null;
  }
  const isFlatRow = (r: number) => !roundPart || r < roundPart.from || r > roundPart.to;
  const firstFlatRow = !roundPart || roundPart.from > 1 ? 1 : roundPart.to + 1;
  const rsOdd = firstFlatRow % 2 === 1;
  const isRS = (r: number) => (r - firstFlatRow) % 2 === 0;
  const flat = isFlatRow(topDown ? 1 : totalRows); // the garment's top (where any neckline is): row 1 when top-down

  const sections: ComputedSection[] = rawSections.map((x) => {
    const g = (h: number) => roundRows_(h - h0);
    const a = g(x.from);
    const b = g(x.to);
    const top = topDown ? totalRows : 0;
    const ka = topDown ? top - a : a;
    const kb = topDown ? top - b : b;
    return { id: x.sec.id, name: x.sec.name, fromRow: Math.min(ka, kb), toRow: Math.max(ka, kb), multiple: x.sec.pattern.multiple, offset: x.sec.pattern.offset, patternName: x.sec.pattern.name };
  });

  const leftEdge = new Array<number>(totalRows + 1).fill(0);
  const rightEdge = new Array<number>(totalRows + 1).fill(0);
  let L = wps[0].leftPos;
  let R = wps[0].rightPos;
  leftEdge[0] = L;
  rightEdge[0] = R;
  wps[0].actualStitches = R - L;

  // ---- segments ----
  const segments: ComputedSegment[] = [];
  const markers: Marker[] = [];

  // Princess lines (only evaluated when a segment shapes at them).
  const usesPrincess = panel.segments.some((x) => x.placement === 'princess' || x.placement === 'both');
  let princessOut: ComputedPanel['princess'] = null;
  if (usesPrincess) {
    const pr = panel.princess ?? defaultPrincess();
    const pv = evaluateDim(pr.position, sizeId, scope);
    if (!pv.ok) issues.push({ severity: 'error', message: `Princess line position: ${pv.error}. Shaping stays at the side edges.`, ref: { kind: 'panel' } });
    else princessOut = { offset: pv.value.value * spc, sides: pr.sides };
  }

  for (let i = 0; i < wps.length - 1; i++) {
    const lo = wps[i]; // in knitting order
    const hi = wps[i + 1];
    // Segments are stored against the garment-lower waypoint whatever the knitting direction.
    const gLower = topDown ? hi : lo;
    const gUpper = topDown ? lo : hi;
    const stored = panel.segments.find((s) => s.fromWaypoint === gLower.id);
    const seg: Segment = stored
      ? topDown
        ? flipSegment(stored)
        : stored
      : { fromWaypoint: gLower.id, left: defaultAutoMethod(), right: defaultAutoMethod(), mirror: true, manual: {} };
    const span: RowSpan = { from: lo.row + 1, to: hi.row };
    const ref: IssueRef = { kind: 'segment', fromWaypoint: gLower.id };
    const label = `${gLower.name} → ${gUpper.name}`;
    const segFlat = isFlatRow(Math.max(1, span.from));
    const joinStep = segFlat && joinRow !== null && roundPart ? (!topDown && span.from === joinRow + 1 ? 'start' : topDown && span.to === joinRow ? 'end' : undefined) : undefined;
    const rc: RowCtx = { flat: segFlat, rsOdd, joinStep };

    // Stitch change each edge needs, from where the edges actually are now.
    let dL: number;
    let dR: number;
    if (seg.mirror) {
      const total = roundNearest(hi.rightPos - hi.leftPos - (R - L));
      // Split the change; when it is odd, give the extra stitch to whichever edge keeps the panel centred.
      const a = Math.trunc(total / 2);
      const b = total - a;
      const offCentre = (l: number, r: number) => Math.abs(L - l + (R + r));
      [dL, dR] = offCentre(b, a) <= offCentre(a, b) ? [b, a] : [a, b];
      if (dL !== dR) {
        const which = Math.abs(dL) > Math.abs(dR) ? 'left' : 'right';
        issues.push({ severity: 'warning', message: `${label}: odd stitch change (${total}); the ${which} edge gets one more ${total < 0 ? 'decrease' : 'increase'}.`, ref });
      }
    } else {
      dL = roundNearest(L - hi.leftPos);
      dR = roundNearest(hi.rightPos - R);
    }

    if (span.to < span.from && (dL !== 0 || dR !== 0)) {
      issues.push({ severity: 'error', message: `${lo.name} and ${hi.name} are on the same row but the width changes; move them apart.`, ref });
    }

    const manual = seg.manual[sizeId];
    const leftManual = manual?.left;
    const rightManual = manual?.right ?? (seg.mirror && leftManual ? mirrorManual(leftManual, seg.left, rc, span.from, Math.max(0, span.to - span.from + 1)) : undefined);
    // Princess placement: each line takes 2 sts per shaping row (both sides of the marker) or 1, plus 1 at the
    // edge for 'both'. Only increases/decreases move; bind-off/cast-on/short-row steps stay at the edges.
    const wanted: ShapingPlacement = princessOut ? (seg.placement ?? 'edge') : 'edge';
    const pointsAt = (m: SegmentMethod) => (wanted === 'edge' || m.kind !== 'auto' ? 1 : (princessOut!.sides === 'both' ? 2 : 1) + (wanted === 'both' ? 1 : 0));
    const atLine = (m: SegmentMethod): SegmentMethod => (m.kind === 'auto' && pointsAt(m) > 1 ? { ...m, perSide: m.perSide * pointsAt(m) } : m);
    const placement: ShapingPlacement = wanted !== 'edge' && (seg.left.kind === 'auto' || seg.left.kind === 'straight' || leftManual) ? wanted : 'edge';
    if (wanted !== 'edge' && placement === 'edge') {
      issues.push({ severity: 'info', message: `${label}: princess lines only take increases/decreases; these steps stay at the side edges.`, ref });
    }
    const leftMethod = placement === 'edge' ? seg.left : atLine(seg.left);
    const rightMethod = placement === 'edge' ? (seg.mirror ? seg.left : seg.right) : atLine(seg.mirror ? seg.left : seg.right);

    let left: EdgeShaping;
    let right: EdgeShaping;
    if (!leftManual && !rightManual && seg.mirror && leftMethod.kind === 'auto') {
      [left, right] = pairedAuto(leftMethod, dL, dR, span, issues, ref, label, rc);
    } else {
      left = leftManual ? manualEdge(leftManual, dL, span, issues, { ...ref, edge: 'left' }) : edgeShaping(leftMethod, dL, span, 'left', rc, issues, { ...ref, edge: 'left' }, label);
      right = rightManual ? manualEdge(rightManual, dR, span, issues, { ...ref, edge: 'right' }) : edgeShaping(rightMethod, dR, span, 'right', rc, issues, { ...ref, edge: 'right' }, label);
    }

    // At a princess line the stored symbol is the stitch on the marker's outer side (towards the side edge),
    // so the left line's outer stitch leans like a right edge's, and the other way round.
    const lineSide = (edge: Edge): Edge => (placement === 'edge' ? edge : edge === 'left' ? 'right' : 'left');
    // At a line each stitch is shaped singly (ssk / k2tog, not sk2p), whatever the marker's total.
    const symDelta = (d: number) => (placement === 'edge' ? d : Math.sign(d));
    for (const e of left.events) e.symbol ??= defaultSymbol(e.kind, lineSide('left'), symDelta(e.delta));
    for (const e of right.events) e.symbol ??= defaultSymbol(e.kind, lineSide('right'), symDelta(e.delta));
    if (placement !== 'edge') {
      const full = princessOut!.sides === 'both' ? 2 + (placement === 'both' ? 1 : 0) : 1 + (placement === 'both' ? 1 : 0);
      const odd = [...left.events, ...right.events].filter((e) => (e.kind === 'dec' || e.kind === 'inc') && Math.abs(e.delta) < full && full > 1);
      if (odd.length) {
        issues.push({ severity: 'info', message: `${label}: the stitch count doesn't divide evenly over the shaping points; row ${odd.map((e) => e.row).filter((r, i, a) => a.indexOf(r) === i).join(', ')} shapes one side of the marker only.`, ref });
      }
    }

    // Simulate the rows of this segment.
    const byRow = (evs: ShapeEvent[]) => {
      const m = new Map<number, number>();
      for (const e of evs) m.set(e.row, (m.get(e.row) ?? 0) + e.delta);
      return m;
    };
    const lRows = byRow(left.events);
    const rRows = byRow(right.events);
    for (let r = span.from; r <= span.to; r++) {
      L -= lRows.get(r) ?? 0;
      R += rRows.get(r) ?? 0;
      leftEdge[r] = L;
      rightEdge[r] = R;
    }
    const lineX = (edge: Edge, r: number) => (leftEdge[r] + rightEdge[r]) / 2 + (edge === 'left' ? -1 : 1) * princessOut!.offset;
    const markX = (edge: Edge, e: ShapeEvent) =>
      placement !== 'edge' && (e.kind === 'dec' || e.kind === 'inc') ? lineX(edge, e.row) : edge === 'left' ? leftEdge[e.row] : rightEdge[e.row];
    const onLine = (e: ShapeEvent) => placement !== 'edge' && (e.kind === 'dec' || e.kind === 'inc');
    for (const e of left.events) markers.push({ edge: 'left', row: e.row, x: markX('left', e), delta: e.delta, kind: e.kind, segment: i, atLine: onLine(e) });
    for (const e of right.events) markers.push({ edge: 'right', row: e.row, x: markX('right', e), delta: e.delta, kind: e.kind, segment: i, atLine: onLine(e) });

    hi.actualStitches = R - L;
    if (hi.actualStitches !== hi.stitches) {
      issues.push({
        severity: 'warning',
        message: `At ${hi.name} the shaping reaches ${hi.actualStitches} sts, but the target is ${hi.stitches} sts.`,
        ref: { kind: 'waypoint', id: hi.id },
      });
    }
    segments.push({ fromWaypoint: gLower.id, toWaypoint: gUpper.id, index: i, rowFrom: span.from, rowTo: span.to, mirror: seg.mirror, implicit: !stored, placement, left, right });
  }

  if (princessOut) {
    for (const seg of segments) {
      if (seg.placement === 'edge') continue;
      const narrowest = Math.min(...Array.from({ length: Math.max(1, seg.rowTo - seg.rowFrom + 1) }, (_, k) => (rightEdge[seg.rowFrom + k] - leftEdge[seg.rowFrom + k]) / 2));
      if (princessOut.offset < 2 || princessOut.offset > narrowest - 3) {
        issues.push({ severity: 'warning', message: `Princess lines are ${roundNearest(princessOut.offset)} sts from the centre, too close to the ${princessOut.offset < 2 ? 'centre' : 'side edges'} (half width ${roundNearest(narrowest)} sts).`, ref: { kind: 'segment', fromWaypoint: seg.fromWaypoint } });
      }
    }
  }

  // ---- neckline ----
  const neckLeft = new Array<number | null>(totalRows + 1).fill(null);
  const neckRight = new Array<number | null>(totalRows + 1).fill(null);
  let neck: ComputedNeck | null = null;
  if (panel.neckline) {
    neck = computeNeck(project, panel, sizeId, { spc, rpc, totalRows, leftEdge, rightEdge, flat, isRS, atStart: topDown }, issues);
    if (neck) {
      // The left shoulder's neck edge is that piece's right edge, and vice versa.
      for (const e of neck.events) e.symbol ??= defaultSymbol(e.kind, 'right', e.delta);
      const cl = neck.centreX - neck.centreSts / 2;
      const cr = neck.centreX + neck.centreSts / 2;
      const evRows = new Map<number, number>();
      for (const e of neck.events) evRows.set(e.row, (evRows.get(e.row) ?? 0) + e.delta);
      if (!neck.atStart) {
        // Bottom-up: centre leaves on the split row, then each neck edge moves outward as it decreases.
        let nl = cl;
        let nr = cr;
        for (let r = neck.splitRow; r <= totalRows; r++) {
          const d = evRows.get(r) ?? 0;
          nl += d;
          nr -= d;
          neckLeft[r] = nl;
          neckRight[r] = nr;
        }
      } else {
        // Top-down: neck edges move inward with each increase until the centre is cast on at the join row.
        let nl = cl;
        let nr = cr;
        for (let r = neck.splitRow - 1; r >= 0; r--) {
          neckLeft[r] = nl;
          neckRight[r] = nr;
          const d = evRows.get(r) ?? 0; // increase worked on row r: before it the edge was further out
          nl -= d;
          nr += d;
        }
      }
      for (const e of neck.events) {
        markers.push({ edge: 'neckLeft', row: e.row, x: neckLeft[e.row]!, delta: e.delta, kind: e.kind, segment: -1 });
        markers.push({ edge: 'neckRight', row: e.row, x: neckRight[e.row]!, delta: e.delta, kind: e.kind, segment: -1 });
      }
      let reported = false;
      for (let r = 0; r <= totalRows && !reported; r++) {
        if (neckLeft[r] === null) continue;
        const sl = neckLeft[r]! - leftEdge[r];
        const sr = rightEdge[r] - neckRight[r]!;
        if (sl < -1e-9 || sr < -1e-9) {
          issues.push({
            severity: 'error',
            message: `Neck wider than the shoulders at row ${r}: the ${sl < 0 ? 'left' : 'right'} side would have ${roundNearest(Math.min(sl, sr))} sts. Narrow the neck, widen the top, or move the shoulder shaping.`,
            ref: { kind: 'neckline' },
          });
          reported = true;
        }
      }
      const o = neck.openRow;
      const remainL = (neckLeft[o] ?? 0) - leftEdge[o];
      const remainR = rightEdge[o] - (neckRight[o] ?? 0);
      if (remainL > 0 || remainR > 0) {
        const where = neck.atStart ? 'are cast on at the shoulders' : 'remain at the top';
        issues.push({ severity: 'info', message: `${Math.max(0, remainL)} + ${Math.max(0, remainR)} shoulder sts ${where}.`, ref: { kind: 'neckline' } });
      }
    }
  }

  // ---- bust shaping ----
  let bust: ComputedBust | null = null;
  if (panel.bust && panel.bust.method !== 'none') {
    const underarm = wps.find((w) => w.key === 'underarm');
    bust = computeBust({
      panel,
      sizeId,
      scope: { ...scope, ...bustValues(panel, sizeId, buildScope(project, sizeId)) },
      spc,
      rpc,
      totalRows,
      topDown,
      h0,
      leftEdge,
      rightEdge,
      isRS,
      isFlatRow,
      underarmRow: underarm ? underarm.row : null,
    });
    for (const i of bust?.issues ?? []) issues.push({ ...i, message: `Bust: ${i.message}`, ref: { kind: 'bust' } });
    if (bust?.darts) {
      // Darts add stitches inside the panel; draw them as extra width shared by both sides.
      for (let r = 0; r <= totalRows; r++) {
        const w = bust.darts.interior[r] / 2;
        leftEdge[r] -= w;
        rightEdge[r] += w;
      }
    }
  }

  // ---- shaping lines and free stitches: inside the fabric, so they widen/narrow the panel about the centre ----
  const lineRes = computeLines({
    panel,
    sizeId,
    scope,
    spc,
    rpc,
    totalRows,
    topDown,
    h0,
    isRS,
    isFlatRow,
    halfWidth: (r) => (rightEdge[r] - leftEdge[r]) / 2,
  });
  const lineOut = lineRes.lines;
  for (const l of lineOut) for (const i of l.issues) issues.push({ ...i, message: `Line "${l.name}": ${i.message}`, ref: { kind: 'line', id: l.id } });
  const freeOnly = freeInterior(project, panel, sizeId, totalRows);
  const free = freeOnly.map((v, r) => v + lineRes.interior[r]);
  const freeRows: number[] = [];
  if (free.some((v) => v !== 0)) {
    for (let r = 0; r <= totalRows; r++) {
      leftEdge[r] -= free[r] / 2;
      rightEdge[r] += free[r] / 2;
      if (r > 0 && free[r] !== free[r - 1]) freeRows.push(r);
    }
    const net = free[totalRows];
    // Narrowing that is never undone: the shoulder/top bind-offs were planned without it.
    if (neck) {
      const o = neck.openRow;
      if ((neckLeft[o] ?? 0) - leftEdge[o] < -1e-6 || rightEdge[o] - (neckRight[o] ?? 0) < -1e-6) {
        issues.push({ severity: 'warning', message: `Painted stitches / shaping lines run out of stitches at the shoulders (${net} sts overall): the shoulder bind-offs were planned for the original width. Add increases back, use a fisheye line, or treat it as an experiment.`, ref: { kind: 'panel' } });
      }
    } else if (rightEdge[totalRows] - leftEdge[totalRows] < 0) {
      issues.push({ severity: 'warning', message: `Painted stitches / shaping lines run out of stitches before the top.`, ref: { kind: 'panel' } });
    }
    const netFree = freeOnly[totalRows];
    if (freeOnly.some((v) => v !== 0)) issues.push({ severity: 'info', message: `Painted stitches change the count by ${netFree > 0 ? '+' : ''}${netFree} st${Math.abs(netFree) === 1 ? '' : 's'} by the last row; the shaping after them is unchanged, so later widths move with them.`, ref: { kind: 'panel' } });
  }
  // Edge markers follow widened edges (darts and painted stitches).
  const widen = (r: number) => (bust?.darts ? bust.darts.interior[r] / 2 : 0) + free[r] / 2;
  for (const m of markers) {
    if (m.atLine || (m.edge !== 'left' && m.edge !== 'right')) continue;
    m.x += (m.edge === 'left' ? -1 : 1) * widen(m.row);
  }

  // ---- stitches held by short-row segments (live, but outside the turns) ----
  const held = new Array<number>(totalRows + 1).fill(0);
  for (const seg of segments) {
    for (const edge of ['left', 'right'] as const) {
      if (seg[edge].method !== 'shortrows') continue;
      const from = Math.max(0, seg.rowFrom - 1);
      const pos = edge === 'left' ? leftEdge : rightEdge;
      const slice = pos.slice(from, seg.rowTo + 1);
      const outer = edge === 'left' ? Math.min(...slice) : Math.max(...slice);
      for (let r = from; r <= seg.rowTo; r++) held[r] += Math.abs(pos[r] - outer);
    }
  }

  const counts = leftEdge.map((l, r) => {
    const outer = rightEdge[r] - l + held[r];
    const cut = neckLeft[r] !== null ? neckRight[r]! - neckLeft[r]! : 0;
    return roundNearest(outer - cut);
  });
  const negative = counts.findIndex((n) => n < 0);
  if (negative >= 0) issues.push({ severity: 'error', message: `The stitch count goes negative (${counts[negative]}) at row ${negative}.`, ref: { kind: 'panel' } });

  // Hand-placed decreases/increases on WS rows of a flat panel whose shaping is meant for RS rows.
  {
    for (const seg of segments) {
      if (!isFlatRow(Math.max(1, seg.rowFrom))) continue;
      const stored = panel.segments.find((x) => x.fromWaypoint === seg.fromWaypoint);
      for (const edge of ['left', 'right'] as const) {
        const method = stored ? (stored.mirror ? stored.left : stored[edge]) : null;
        if (seg[edge].method !== 'manual' || method?.kind !== 'auto' || method.side !== 'rs') continue;
        const ws = seg[edge].events.filter((e) => (e.kind === 'dec' || e.kind === 'inc') && !isRS(e.row));
        if (ws.length) {
          issues.push({
            severity: 'info',
            message: `${edge === 'left' ? 'Left' : 'Right'} edge: ${ws.length} marker${ws.length > 1 ? 's' : ''} on WS rows (${ws.map((e) => e.row).join(', ')}), worked as purl-side shaping.`,
            ref: { kind: 'segment', fromWaypoint: seg.fromWaypoint, edge },
          });
        }
      }
    }
  }

  const extraRows = [...(bust?.darts ? [...bust.darts.incRows, ...bust.darts.decRows] : []), ...freeRows];

  // Painted stitches outside the fabric on their row.
  {
    let outside = 0;
    for (const f of panel.freeStitches ?? []) {
      if (f.sizeId !== sizeId) continue;
      if (f.row < 1 || f.row > totalRows) {
        outside++;
        continue;
      }
      const centre = (leftEdge[f.row] + rightEdge[f.row]) / 2;
      for (const cell of freeCells(f)) {
        const a = centre + cell.x;
        const inNeck = neckLeft[f.row] !== null && a + 0.5 > neckLeft[f.row]! && a + 0.5 < neckRight[f.row]!;
        if (a < leftEdge[f.row] - 1e-6 || a + 1 > rightEdge[f.row] + 1e-6 || inNeck) outside++;
      }
    }
    if (outside) issues.push({ severity: 'warning', message: `${outside} painted stitch${outside === 1 ? ' is' : 'es are'} outside the fabric on ${outside === 1 ? 'its' : 'their'} row and ${outside === 1 ? 'is' : 'are'} not drawn.`, ref: { kind: 'panel' } });
  }
  const outline = buildOutline(wps, segments, leftEdge, rightEdge, neckLeft, neckRight, neck, topDown, extraRows);

  return {
    panelId: panel.id,
    sizeId,
    ok: true,
    topDown,
    stitchesPerCm: spc,
    rowsPerCm: rpc,
    waypoints: wps,
    segments,
    neck,
    totalRows,
    roundRows: roundPart,
    firstFlatRow,
    sections,
    bust,
    princess: princessOut,
    lines: lineOut,
    held,
    leftEdge,
    rightEdge,
    neckLeft,
    neckRight,
    counts,
    outline,
    markers,
    issues,
  };
}

// ---------- edge shaping ----------

function flipAlign<T extends string>(a: T): T {
  return (a === 'start' ? 'end' : a === 'end' ? 'start' : a) as T;
}

/** A segment as seen when knitting downwards: "near the lower waypoint" becomes "near the end". */
function flipSegment(seg: Segment): Segment {
  const flip = (m: SegmentMethod): SegmentMethod =>
    m.kind === 'auto' ? { ...m, align: flipAlign(m.align) } : m.kind === 'steps' || m.kind === 'shortrows' ? { ...m, align: flipAlign(m.align ?? 'start') } : m;
  return { ...seg, left: flip(seg.left), right: flip(seg.right) };
}

/** Where a segment is worked: flat or in the round, and whether flat RS rows are the odd ones. */
interface RowCtx {
  flat: boolean;
  rsOdd: boolean;
  /**
   * Set when a step segment meets the in-the-round join: the underarm stitches are bound off on the dividing
   * round (bottom-up, 'start') or cast on where the panels are joined (top-down, 'end'): both edges on one row.
   */
  joinStep?: 'start' | 'end';
}

/** RS/WS as row parity: when RS rows are even (flat part after rounds), swap. */
function sideFor(side: RowSide, rc: RowCtx): RowSide {
  if (!rc.flat || rc.rsOdd || side === 'any') return side;
  return side === 'rs' ? 'ws' : 'rs';
}

function schedule(method: Extract<SegmentMethod, { kind: 'auto' }>, n: number, span: RowSpan, rc: RowCtx): ShapingSchedule {
  const opts = { side: sideFor(method.side, rc), align: method.align, order: method.order };
  switch (method.rhythm.type) {
    case 'fixed':
      return distributeFixed(n, method.rhythm.every, span, opts);
    case 'mixed':
      return distributeMixed(n, method.rhythm.a, method.rhythm.b, span, opts);
    default:
      return distributeAuto(n, span, opts);
  }
}

function perSideLabel(d: number): string {
  return `${d > 0 ? '+' : '−'}${Math.abs(d)}`;
}

/** Both edges shaped on the same rows (the usual k2, ssk … k2tog, k2 row). */
function pairedAuto(
  method: Extract<SegmentMethod, { kind: 'auto' }>,
  dL: number,
  dR: number,
  span: RowSpan,
  issues: Issue[],
  ref: IssueRef,
  label: string,
  rc: RowCtx,
): [EdgeShaping, EdgeShaping] {
  const p = Math.max(1, Math.round(method.perSide));
  const n = Math.max(Math.ceil(Math.abs(dL) / p), Math.ceil(Math.abs(dR) / p));
  const empty = (target: number): EdgeShaping => ({ method: 'auto', target, events: [], summary: 'no shaping' });
  if (n === 0) return [empty(dL), empty(dR)];
  const s = schedule(method, n, span, rc);
  for (const w of s.warnings) issues.push({ severity: s.feasible ? 'warning' : 'error', message: `${label}: ${w}`, ref });
  const make = (d: number): ShapeEvent[] => {
    let remaining = Math.abs(d);
    const sign = Math.sign(d);
    const out: ShapeEvent[] = [];
    for (const row of s.rows) {
      if (remaining <= 0) break;
      const k = Math.min(p, remaining);
      out.push({ row, delta: sign * k, kind: sign < 0 ? 'dec' : 'inc' });
      remaining -= k;
    }
    return out;
  };
  const summary = (d: number) => (d === 0 ? 'no shaping' : `${perSideLabel(d)} sts: ${describeSchedule(s)}`);
  return [
    { method: 'auto', target: dL, events: make(dL), summary: summary(dL) },
    { method: 'auto', target: dR, events: make(dR), summary: summary(dR) },
  ];
}

/** The side a bind-off/cast-on at the start of a row uses for this edge. */
function startOfRowSide(edge: Edge, rc: RowCtx): RowSide {
  if (!rc.flat) return 'any';
  return sideFor(edge === 'right' ? 'rs' : 'ws', rc);
}

export function autoSteps(total: number, maxPerStep: number): number[] {
  if (total <= 0) return [];
  const k = Math.ceil(total / Math.max(1, maxPerStep));
  return splitEvenly(total, k, 'longFirst');
}

function edgeShaping(method: SegmentMethod, d: number, span: RowSpan, edge: Edge, rc: RowCtx, issues: Issue[], ref: IssueRef, label: string): EdgeShaping {
  const where = `${label} (${edge} edge)`;
  switch (method.kind) {
    case 'straight':
      if (d !== 0) issues.push({ severity: 'warning', message: `${where}: worked straight, but the width changes by ${d} sts.`, ref });
      return { method: 'straight', target: d, events: [], summary: 'straight' };
    case 'auto': {
      const p = Math.max(1, Math.round(method.perSide));
      const n = Math.ceil(Math.abs(d) / p);
      if (n === 0) return { method: 'auto', target: d, events: [], summary: 'no shaping' };
      const s = schedule(method, n, span, rc);
      for (const w of s.warnings) issues.push({ severity: s.feasible ? 'warning' : 'error', message: `${where}: ${w}`, ref });
      let remaining = Math.abs(d);
      const events: ShapeEvent[] = [];
      for (const row of s.rows) {
        const k = Math.min(p, remaining);
        if (k <= 0) break;
        events.push({ row, delta: Math.sign(d) * k, kind: d < 0 ? 'dec' : 'inc' });
        remaining -= k;
      }
      return { method: 'auto', target: d, events, summary: `${perSideLabel(d)} sts: ${describeSchedule(s)}` };
    }
    case 'steps':
    case 'shortrows': {
      const steps = method.steps ?? autoSteps(Math.abs(d), method.maxPerStep);
      const sum = steps.reduce((a, b) => a + b, 0);
      if (sum !== Math.abs(d)) {
        issues.push({ severity: 'warning', message: `${where}: steps add up to ${sum} sts, but ${Math.abs(d)} are needed.`, ref });
      }
      if (steps.length === 0) return { method: method.kind, target: d, events: [], summary: 'no shaping' };
      const atJoin = method.kind === 'steps' && rc.joinStep !== undefined;
      const side = atJoin ? 'any' : startOfRowSide(edge, rc);
      const step = side === 'any' ? 1 : 2;
      const align = atJoin ? rc.joinStep! : method.align ?? 'start';
      let rows = placeIntervals(Array(steps.length).fill(step), span, side, align);
      if (!rows) {
        const avail = eligibleRows(span, side);
        rows = align === 'end' ? avail.slice(-steps.length) : avail.slice(0, steps.length);
        issues.push({
          severity: 'error',
          message: `${where}: ${steps.length} steps need ${steps.length} ${side === 'any' ? '' : side.toUpperCase() + ' '}rows, but only ${avail.length} are available.`,
          ref,
        });
      }
      const sign = Math.sign(d) || -1;
      const kind: EventKind = method.kind === 'shortrows' ? 'turn' : sign < 0 ? 'bindoff' : 'caston';
      const symbol = method.kind === 'shortrows' ? (method.style === 'german' ? 'turn-german' : 'turn-wt') : undefined;
      const events: ShapeEvent[] = rows.map((row, j) => ({ row, delta: sign * steps[j], kind, ...(symbol ? { symbol } : {}) }));
      const verb = method.kind === 'shortrows' ? 'short rows leaving' : sign < 0 ? 'bind off' : 'cast on';
      const where2 = atJoin ? (sign < 0 ? ' on the dividing round' : ' where the panels are joined') : '';
      return { method: method.kind, target: d, events, summary: `${verb} ${steps.join(', ')}${where2}` };
    }
  }
}

function eventKindFor(e: ManualEvent): EventKind {
  if (e.symbol === 'bo') return 'bindoff';
  if (e.symbol === 'co') return 'caston';
  if (e.symbol === 'turn' || e.symbol.startsWith('turn-')) return 'turn';
  return e.delta < 0 ? 'dec' : 'inc';
}

function manualEdge(list: ManualEvent[], d: number, span: RowSpan, issues: Issue[], ref: IssueRef): EdgeShaping {
  const events: ShapeEvent[] = [];
  for (const e of list) {
    const row = span.from - 1 + e.row;
    if (row < span.from || row > span.to) {
      issues.push({ severity: 'warning', message: `A manual marker at segment row ${e.row} is outside this segment and was ignored.`, ref });
      continue;
    }
    events.push({ row, delta: e.delta, kind: eventKindFor(e), symbol: e.symbol });
  }
  events.sort((a, b) => a.row - b.row);
  const sum = events.reduce((a, e) => a + e.delta, 0);
  if (sum !== d) {
    const edge = ref.kind === 'segment' && ref.edge === 'right' ? 'Right' : 'Left';
    issues.push({ severity: 'warning', message: `${edge} edge: manual markers change this edge by ${sum} sts; ${d} are needed.`, ref });
  }
  return { method: 'manual', target: d, events, summary: `manual: ${events.length} marker${events.length === 1 ? '' : 's'}` };
}

/**
 * Mirror left-edge manual markers onto the right edge. Leaning stitches swap (ssk ↔ k2tog, M1L ↔ M1R).
 * Start-of-row markers (bind off, cast on, turns) move to the adjacent RS row: the one after when the
 * steps sit at the end of the segment, the one before otherwise, matching the auto placement.
 */
function mirrorManual(list: ManualEvent[], method: SegmentMethod, rc: RowCtx, _from: number, rows: number): ManualEvent[] {
  const flat = rc.flat;
  const stepLike = method.kind === 'steps' || method.kind === 'shortrows';
  const startOfRow = (sym: string) => sym === 'bo' || sym === 'co' || sym.startsWith('turn');
  const shifted = list.filter((e) => flat && (stepLike || startOfRow(e.symbol))).map((e) => e.row);
  // One direction for the whole segment: after when steps hug the end (if the last one still fits), else before.
  let dir = stepLike && method.align === 'end' ? 1 : -1;
  if (shifted.length) {
    if (dir === 1 && Math.max(...shifted) + 1 > rows) dir = -1;
    else if (dir === -1 && Math.min(...shifted) - 1 < 1) dir = 1;
  }
  const swap: Record<string, string> = { ssk: 'k2tog', k2tog: 'ssk', m1l: 'm1r', m1r: 'm1l' };
  return list.map((e) => {
    const row = flat && (stepLike || startOfRow(e.symbol)) ? e.row + dir : e.row;
    return { ...e, symbol: swap[e.symbol] ?? e.symbol, row };
  });
}

// ---------- neckline ----------

function computeNeck(
  project: Project,
  panel: Panel,
  sizeId: Id,
  g: { spc: number; rpc: number; totalRows: number; leftEdge: number[]; rightEdge: number[]; flat: boolean; isRS: (r: number) => boolean; atStart: boolean },
  issues: Issue[],
): ComputedNeck | null {
  const nk = panel.neckline!;
  const ref: IssueRef = { kind: 'neckline' };
  const scope = { ...buildScope(project, sizeId), ...panelExtras(project, panel, sizeId), ...resolvePanelDims(project, panel, sizeId).values };
  const defs = {
    'neck.width': sizeId in nk.width.overrides ? String(nk.width.overrides[sizeId]) : nk.width.expr,
    'neck.depth': sizeId in nk.depth.overrides ? String(nk.depth.overrides[sizeId]) : nk.depth.expr,
    'neck.centre': sizeId in nk.centreWidth.overrides ? String(nk.centreWidth.overrides[sizeId]) : nk.centreWidth.expr,
  };
  const r = resolveDefinitions(defs, scope);
  for (const [k, e] of Object.entries(r.errors)) issues.push({ severity: 'error', message: `Neckline ${k.slice(5)}: ${e}`, ref });
  if (Object.keys(r.errors).length) return null;

  const T = g.totalRows;
  const depthRows = roundRows(r.values['neck.depth'] * g.rpc).value;
  const openRow = g.atStart ? 0 : T;
  let splitRow: number;
  if (!g.atStart) {
    splitRow = T - depthRows + 1;
    if (g.flat && !g.isRS(splitRow)) splitRow -= 1; // bind off the centre on a RS row
  } else {
    splitRow = depthRows;
    if (g.flat && !g.isRS(splitRow)) splitRow += 1; // cast on the centre on a RS row
  }
  if (splitRow < 1 || splitRow > T) {
    issues.push({ severity: 'error', message: 'The neckline is deeper than the panel.', ref });
    return null;
  }

  // Centre the opening on the middle of the panel's top. Neck edges must sit on whole-stitch
  // boundaries of each side, i.e. share the fractional part (0 or ½) of that side's outer edge.
  const lo = g.leftEdge[openRow];
  const ro = g.rightEdge[openRow];
  const centreX = (lo + ro) / 2;
  const fracL = lo - Math.floor(lo);
  const fracR = ro - Math.floor(ro);
  const outerTop = roundNearest(ro - lo);
  let width = roundNearest(r.values['neck.width'] * g.spc);
  const slack = panel.selvedge.left + panel.selvedge.right + 1;
  if (outerTop !== width && Math.abs(outerTop - width) <= slack) {
    // The neck opening is meant to equal the top of the panel; selvedges and rounding make them differ slightly.
    width = outerTop;
  }
  // A square neck takes its whole opening off at once.
  const centreRaw = nk.shape === 'square' ? width : Math.max(0, r.values['neck.centre'] * g.spc);
  const nl0 = fracL + roundNearest(centreX - centreRaw / 2 - fracL);
  const nr0 = fracR + roundNearest(centreX + centreRaw / 2 - fracR);
  const centre = Math.max(0, nr0 - nl0);
  if (nk.shape === 'square') width = Math.max(width, centre); // the whole opening goes at once; rounding can differ by a stitch
  let perSide = Math.floor((width - centre) / 2);
  if (perSide < 0) {
    issues.push({ severity: 'warning', message: `The centre (${centre} sts) is wider than the neck opening (${width} sts).`, ref });
    perSide = 0;
  }

  // Rows available for neck-edge shaping. Bottom-up flat: the last row belongs to one side only (its final
  // shoulder bind-off), so finish a row early. Top-down: the rows before the centre is cast on.
  const span: RowSpan = g.atStart ? { from: 1, to: splitRow - 1 } : { from: splitRow + 1, to: T - (g.flat ? 1 : 0) };
  // Distances from the centre line; d = 1 is the row next to it. Mapped to rows at the end.
  const toRow = (d: number) => (g.atStart ? splitRow - d : splitRow + d);
  const room = span.to - span.from + 1;
  let dists: number[] = [];
  const verb = g.atStart ? 'increases' : 'decreases';
  if (perSide > 0) {
    if (nk.shape === 'v') {
      // Spread to the open end; side parity is about real rows, so place in row space.
      const s = distributeAuto(perSide, span, { side: nk.side, align: g.atStart ? 'start' : 'end' });
      for (const w of s.warnings) issues.push({ severity: 'warning', message: `Neckline: ${w}`, ref });
      dists = s.rows.map((row) => Math.abs(row - splitRow));
    } else {
      // Round / square / boat: half the shaping on every row next to the centre, the rest every other row.
      const fast = Math.ceil(perSide / 2);
      for (let k = 1; k <= fast; k++) dists.push(k);
      for (let k = fast, d = fast + 2; k < perSide; k++, d += 2) dists.push(d);
      if (dists[dists.length - 1] > room) {
        const s = distributeAuto(perSide, { from: 1, to: Math.max(0, room) }, { side: 'any', align: 'start' });
        dists = s.rows;
        if (!s.feasible) issues.push({ severity: 'error', message: `Neckline: ${perSide} ${verb} per side do not fit in ${Math.max(0, room)} rows.`, ref });
        else issues.push({ severity: 'info', message: `Neckline: ${verb} were packed closer to fit the neck depth.`, ref });
      }
    }
  }
  const events: ShapeEvent[] = dists
    .map((d) => toRow(d))
    .sort((a, b) => a - b)
    .map((row) => ({ row, delta: g.atStart ? 1 : -1, kind: g.atStart ? ('inc' as const) : ('dec' as const) }));
  const held = nk.centre === 'hold';
  const summary = g.atStart
    ? `+${perSide} each side at the neck edge, then cast on centre ${centre} sts on row ${splitRow} to join`
    : `${held ? 'place' : 'bind off'} centre ${centre} sts on row ${splitRow}${centre && held ? ' on hold' : ''}, then −${perSide} each side`;
  return {
    shape: nk.shape,
    atStart: g.atStart,
    splitRow,
    openRow,
    centreX: (nl0 + nr0) / 2,
    depthRows: g.atStart ? splitRow : T - splitRow + 1,
    centreSts: centre,
    widthSts: width,
    perSide,
    events,
    summary,
  };
}

// ---------- outline ----------

function pushPt(pts: Point[], x: number, y: number): void {
  const last = pts[pts.length - 1];
  if (last && Math.abs(last.x - x) < 1e-9 && Math.abs(last.y - y) < 1e-9) return;
  pts.push({ x, y });
}

/** One outer edge in knitting order. Bind-off / cast-on steps are drawn as stairs, except at the shoulder slope. */
function edgePath(
  wps: ComputedWaypoint[],
  segments: ComputedSegment[],
  edge: Edge,
  pos: number[],
  topDown: boolean,
  extraRows: number[] = [],
): Point[] {
  const pts: Point[] = [];
  pushPt(pts, pos[0], 0);
  for (const seg of segments) {
    const start = seg.rowFrom - 1;
    pushPt(pts, pos[start], start);
    const shaping = seg[edge];
    // The segment at the garment's top (shoulder slope) is drawn as a slope, not stairs.
    const smooth = seg.index === (topDown ? 0 : segments.length - 1);
    let prev = pos[start];
    // Rows where something inside the panel (vertical darts) changes the width are drawn as slopes too.
    const extra = extraRows.filter((r) => r >= seg.rowFrom && r <= seg.rowTo).map((row) => ({ row, delta: 0, kind: 'inc' as EventKind }));
    for (const e of [...shaping.events, ...extra].sort((a, b) => a.row - b.row)) {
      const now = pos[e.row];
      if (!smooth && (e.kind === 'bindoff' || e.kind === 'caston' || e.kind === 'turn' || Math.abs(e.delta) > 1)) {
        pushPt(pts, prev, e.row - 1);
        pushPt(pts, now, e.row - 1);
      } else {
        pushPt(pts, now, e.row);
      }
      prev = now;
    }
    pushPt(pts, pos[seg.rowTo], seg.rowTo);
  }
  pushPt(pts, pos[wps[wps.length - 1].row], wps[wps.length - 1].row);
  return pts;
}

function buildOutline(
  wps: ComputedWaypoint[],
  segments: ComputedSegment[],
  leftEdge: number[],
  rightEdge: number[],
  neckLeft: (number | null)[],
  neckRight: (number | null)[],
  neck: ComputedNeck | null,
  topDown: boolean,
  extraRows: number[] = [],
): Point[] {
  const left = edgePath(wps, segments, 'left', leftEdge, topDown, extraRows);
  const right = edgePath(wps, segments, 'right', rightEdge, topDown, extraRows);
  const poly: Point[] = [];
  // Neck edges from the centre line out to the open end.
  const neckPaths = (n: ComputedNeck) => {
    const lineY = n.splitRow - 1;
    const nl: Point[] = [{ x: n.centreX - n.centreSts / 2, y: lineY }];
    const nr: Point[] = [{ x: n.centreX + n.centreSts / 2, y: lineY }];
    const rows = n.events.map((e) => e.row);
    for (const r of n.atStart ? [...rows].reverse() : rows) {
      pushPt(nl, neckLeft[r]!, n.atStart ? r - 1 : r);
      pushPt(nr, neckRight[r]!, n.atStart ? r - 1 : r);
    }
    pushPt(nl, neckLeft[n.openRow]!, n.openRow);
    pushPt(nr, neckRight[n.openRow]!, n.openRow);
    return { nl, nr };
  };

  for (const p of left) pushPt(poly, p.x, p.y);
  if (neck && !neck.atStart) {
    const { nl, nr } = neckPaths(neck);
    for (const p of [...nl].reverse()) pushPt(poly, p.x, p.y);
    for (const p of nr) pushPt(poly, p.x, p.y);
  }
  for (const p of [...right].reverse()) pushPt(poly, p.x, p.y);
  if (neck && neck.atStart) {
    // Back along the cast-on edge, up the right neck edge, across the centre, down the left neck edge.
    const { nl, nr } = neckPaths(neck);
    for (const p of [...nr].reverse()) pushPt(poly, p.x, p.y);
    for (const p of nl) pushPt(poly, p.x, p.y);
  }
  return poly;
}

// ---------- cardigan fronts ----------

/** Where a cardigan front sits in the whole front: the cut at its front edge and any integrated band. */
interface HalfFrame {
  /** Stitches from the centre line to the start of this front's body (closing_r / 2, rounded). */
  cut: number;
  /** Integrated band stitches between the front-edge selvedge and the body. */
  bandSts: number;
  bandPattern: { name: string; multiple: number; offset: number } | null;
  closingCm: number;
  bandCm: number;
}

function halfFrame(project: Project, half: FrontHalf, spc: number, scope: Record<string, number>): HalfFrame {
  const closingCm = scope.closing_r ?? 0;
  const band = bandOnFront(project, half.side);
  const integrated = band?.attach === 'integrated';
  const bandCm = integrated ? scope.band_w ?? 0 : 0;
  const pattern = integrated && project.edges ? edgePattern(project.edges.frontBands) : null;
  const bandSts = integrated && bandCm > 0 ? roundStitches(bandCm * spc, { multiple: pattern!.multiple, offset: pattern!.offset }).value : 0;
  return { cut: roundNearest((closingCm / 2) * spc), bandSts, bandPattern: pattern, closingCm, bandCm };
}

/**
 * One half of a whole front, computed as a pullover front and cut at the centre line: the left front keeps the
 * right half (as seen from the RS), the right front the left half. The centre-front edge is straight, gets
 * `cfSelvedge` stitches, and takes the neck's centre stitches at its top (bound off / cast on at the front edge).
 */
function cropHalf(full: ComputedPanel, panel: Panel, half: FrontHalf, frame: HalfFrame): ComputedPanel {
  if (!full.ok) return full;
  const keep: Edge = half.side === 'left' ? 'right' : 'left';
  const drop: Edge = keep === 'right' ? 'left' : 'right';
  const keepRight = keep === 'right';
  const cf = half.cfSelvedge;
  // The front edge: the body starts `cut` sts from the centre; integrated band stitches and the selvedge lie outside it.
  const edgeIn = frame.cut - frame.bandSts - cf;
  const cfX = keepRight ? edgeIn : -edgeIn;
  const T = full.totalRows;
  const centre = full.leftEdge.map((l, r) => (l + full.rightEdge[r]) / 2);
  const side = keepRight ? full.rightEdge : full.leftEdge;
  const leftEdge = keepRight ? full.leftEdge.map(() => cfX) : [...full.leftEdge];
  const rightEdge = keepRight ? [...full.rightEdge] : full.rightEdge.map(() => cfX);

  // Neck: the cut runs from the centre-front edge to this half's neck edge.
  const neckLeft = new Array<number | null>(T + 1).fill(null);
  const neckRight = new Array<number | null>(T + 1).fill(null);
  const neckEdge = keepRight ? full.neckRight : full.neckLeft;
  for (let r = 0; r <= T; r++) {
    const n = neckEdge[r];
    if (n === null || (keepRight ? n <= cfX : n >= cfX)) continue;
    if (keepRight) [neckLeft[r], neckRight[r]] = [cfX, n];
    else [neckLeft[r], neckRight[r]] = [n, cfX];
  }
  let neck: ComputedNeck | null = null;
  if (full.neck) {
    const n = full.neck;
    const atSplit = neckEdge[n.atStart ? n.splitRow - 1 : n.splitRow];
    const centreSts = atSplit === null ? 0 : roundNearest(Math.abs(atSplit - cfX));
    const summary = n.atStart
      ? `+${n.perSide} at the neck edge, then cast on ${centreSts} sts at the front edge on row ${n.splitRow}`
      : `${panel.neckline?.centre === 'hold' ? 'place' : 'bind off'} ${centreSts} sts at the front edge on row ${n.splitRow}${panel.neckline?.centre === 'hold' && centreSts ? ' on hold' : ''}, then −${n.perSide} at the neck edge`;
    neck = { ...n, centreSts, widthSts: Math.round(n.widthSts / 2), oneSide: true, summary };
  }

  // The front edge is straight; only this half's side edge keeps its shaping.
  const straight = (target = 0) => ({ method: 'straight' as const, target, events: [], summary: 'centre front, straight' });
  const segments = full.segments.map((seg) => ({ ...seg, [drop]: straight() }));
  const markers = full.markers.filter((m) => {
    if (m.edge === 'neckLeft' || m.edge === 'neckRight') return m.edge === (keepRight ? 'neckRight' : 'neckLeft');
    if (m.atLine) return keepRight ? m.x > cfX : m.x < cfX;
    return m.edge === keep;
  });

  // Stitches held by short-row segments at this half's side edge.
  const held = new Array<number>(T + 1).fill(0);
  for (const seg of segments) {
    if (seg[keep].method !== 'shortrows') continue;
    const from = Math.max(0, seg.rowFrom - 1);
    const slice = side.slice(from, seg.rowTo + 1);
    const outer = keepRight ? Math.max(...slice) : Math.min(...slice);
    for (let r = from; r <= seg.rowTo; r++) held[r] += Math.abs(side[r] - outer);
  }
  const counts = leftEdge.map((l, r) => roundNearest(rightEdge[r] - l + held[r] - (neckLeft[r] !== null ? neckRight[r]! - neckLeft[r]! : 0)));

  const waypoints = full.waypoints.map((w) => {
    const leftPos = keepRight ? cfX : w.leftPos;
    const rightPos = keepRight ? w.rightPos : cfX;
    const cm = (keepRight ? w.rightCm : w.leftCm) - frame.closingCm / 2 + frame.bandCm;
    return {
      ...w,
      leftPos,
      rightPos,
      stitches: rightPos - leftPos,
      actualStitches: roundNearest(rightEdge[w.row] - leftEdge[w.row]),
      widthCm: cm,
      wholeCm: w.widthCm,
      leftCm: keepRight ? 0 : cm,
      rightCm: keepRight ? cm : 0,
      selvedge: (keepRight ? panel.selvedge.right : panel.selvedge.left) + cf,
    };
  });

  // Bust short rows turn at this half's side only; the return row runs to the front edge.
  let bust = full.bust;
  if (bust?.shortRows) {
    const sr = bust.shortRows;
    const live = counts[sr.afterRow] ?? 0;
    const pairs = sr.pairs.map((p) => {
      const unworked = keepRight ? p.rightUnworked : p.leftUnworked;
      return {
        ...p,
        leftUnworked: keepRight ? 0 : p.leftUnworked,
        rightUnworked: keepRight ? p.rightUnworked : 0,
        leftX: keepRight ? cfX : p.leftX,
        rightX: keepRight ? p.rightX : cfX,
        rsWorked: live - unworked,
        wsWorked: live - unworked,
      };
    });
    bust = { ...bust, shortRows: { ...sr, pairs, liveStitches: live, oneSide: keep } };
  }

  // Rows where the side edge moves without an edge event (darts, painted stitches): drawn as slopes.
  const evRows = new Set(segments.flatMap((sg) => sg[keep].events.map((e) => e.row)));
  const extraRows: number[] = [];
  for (let r = 1; r <= T; r++) if (side[r] !== side[r - 1] && !evRows.has(r)) extraRows.push(r);
  const sidePath = edgePath(waypoints, segments, keep, side, full.topDown, extraRows);
  const outline = halfOutline(sidePath, cfX, keepRight ? neckRight : neckLeft, neck, T, full.topDown);

  return {
    ...full,
    waypoints,
    segments,
    neck,
    bust,
    held,
    leftEdge,
    rightEdge,
    neckLeft,
    neckRight,
    counts,
    outline,
    markers,
    half: { side: half.side, keep, cfX, centre, bandSts: frame.bandSts, band: frame.bandPattern },
  };
}

/** Outline of a cardigan front: the straight front edge, the neck edge, and the side edge. */
function halfOutline(sidePath: Point[], cfX: number, neckX: (number | null)[], neck: ComputedNeck | null, T: number, topDown: boolean): Point[] {
  const poly: Point[] = [];
  const neckPts: Point[] = [];
  if (neck) {
    const lineY = neck.splitRow - 1;
    const first = neckX[neck.atStart ? lineY : neck.splitRow];
    pushPt(neckPts, cfX, lineY);
    if (first !== null && first !== undefined) pushPt(neckPts, first, lineY);
    const rows = neck.events.map((e) => e.row);
    for (const r of neck.atStart ? [...rows].reverse() : rows) if (neckX[r] !== null) pushPt(neckPts, neckX[r]!, neck.atStart ? r - 1 : r);
    if (neckX[neck.openRow] !== null) pushPt(neckPts, neckX[neck.openRow]!, neck.openRow);
  }
  // The front edge from the garment's lower edge up to the neck (or the top).
  const lower = topDown ? T : 0;
  const upper = topDown ? 0 : T;
  pushPt(poly, cfX, lower);
  if (neckPts.length) for (const p of neckPts) pushPt(poly, p.x, p.y);
  else pushPt(poly, cfX, upper);
  // Then the side edge from the top back down to the lower edge.
  for (const p of topDown ? sidePath : [...sidePath].reverse()) pushPt(poly, p.x, p.y);
  return poly;
}
