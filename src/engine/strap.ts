// Shoulder strap width (seamed and top-down bodices): one garment setting, `strap_w`, and what gives when it
// changes. 'neck': the neck opening and the top of the shoulder slope (`neck_side`) read
// `shoulder.width − 2 × strap_w`, so the neck widens or narrows and the shoulder line stays. 'armhole': the neck stays
// and the shoulder line is `neck_side.width + 2 × strap_w`; the end of the armhole shaping follows it in when it would
// be wider, and moves up the armhole when its decreases need more rows.
//
// Contiguous yoke and modified raglan: the strap is the shoulder seam, `strap_w × row gauge` rows. 'neck': the yoke's
// neck width is solved so the back still reaches its width after the shoulders; 'armhole': the neck stays and the
// back's width is the neck plus the seam's increases (the cross back is no longer followed). The classic raglan has
// no shoulder seam: nothing to set.
//
// The setting works by writing linked expressions into the bodices' fields (one undo step). A field the knitter types
// over is no longer linked (the readout offers to re-link it); each field's own value from before it was linked is
// kept in `strap.saved` and restored when the strap stops driving it. Projects without a strap are unchanged.

import { generateYoke, STRAP_YOKE_BACK, STRAP_YOKE_NECK } from './contiguous';
import { garmentChoice } from './garmentSetup';
import { resolveDefinitions } from './expr';
import { buildScope } from './measurements';
import type { DimExpr, Id, Panel, Project, StrapGives, StrapSettings, Waypoint } from './model';
import { dim } from './model';
import { computePanel, resolvePanelDims } from './panel';

export type StrapField = 'neckline.width' | 'neckline.centre' | 'neck_side.width' | 'shoulder.width' | 'armhole_end.width' | 'armhole_end.height' | 'yoke.neckWidth' | 'yoke.backWidth';

const FIELDS: StrapField[] = ['neckline.width', 'neckline.centre', 'neck_side.width', 'shoulder.width', 'armhole_end.width', 'armhole_end.height', 'yoke.neckWidth', 'yoke.backWidth'];

/** Field labels as the properties show them. */
export const STRAP_FIELD_LABELS: Record<StrapField, string> = {
  'neckline.width': 'Neckline opening width',
  'neckline.centre': 'Neckline centre width',
  'neck_side.width': 'neck_side width (top of the shoulder slope)',
  'shoulder.width': 'shoulder width',
  'armhole_end.width': 'armhole_end width',
  'armhole_end.height': 'armhole_end height',
  'yoke.neckWidth': 'Neck width, cast on across the back',
  'yoke.backWidth': 'Back width after the markers move',
};

export const STRAP_NECK = 'shoulder.width - 2 * strap_w';
export const STRAP_SHOULDER = 'neck_side.width + 2 * strap_w';
/** The neckline's opening is the top of the shoulder slope: one value, never two to keep equal. */
export const NECK_FOLLOWS = 'neck_side.width';
/** The boat neck's strap (it was the `6` in `shoulder_w - 6`). */
export const BOAT_STRAP = '3';

const wpOf = (p: Panel, name: string) => p.waypoints.find((w) => w.name === name);

/** A bodice whose strap the setting drives: a back or front (cardigan fronts too) with a shoulder slope. */
export const isStrapPiece = (p: Panel) => (p.template === 'back' || p.template === 'front') && !p.yoke && !p.fromYoke && !!wpOf(p, 'shoulder') && !!wpOf(p, 'neck_side');

export const strapPieces = (p: Project) => p.panels.filter(isStrapPiece);

/** A yoke with shoulder seams (contiguous, modified raglan): its seam is the strap. A raglan yoke has none. */
export const isStrapYoke = (p: Panel) => !!p.yoke && p.yoke.style !== 'raglan';

/** Everything the setting links: the bodices, or the yoke. */
const strapTargets = (p: Project) => p.panels.filter((x) => isStrapPiece(x) || isStrapYoke(x));

/**
 * Where the strap setting applies: 'panels' (seamed / top-down bodices), 'raglan' (no shoulder seam: nothing to
 * set), 'yoke' (contiguous and modified raglan: set on the yoke, not yet here), or null (no bodices).
 */
export function strapScope(p: Project): 'panels' | 'raglan' | 'yoke' | null {
  const m = garmentChoice(p).method;
  if (m === 'raglan') return 'raglan';
  // An off-shoulder modified raglan is a raglan yoke (raglan lines, no seam).
  if (m === 'contiguous' || m === 'modified-raglan') return p.panels.some(isStrapYoke) ? 'yoke' : 'raglan';
  return strapPieces(p).length ? 'panels' : null;
}

function getField(p: Panel, f: StrapField): DimExpr | null {
  if (f === 'yoke.neckWidth') return isStrapYoke(p) ? p.yoke!.neck.width ?? dim('back_neck_width') : null;
  if (f === 'yoke.backWidth') return isStrapYoke(p) ? p.yoke!.shoulder.backWidth : null;
  if (f === 'neckline.width') return p.neckline?.width ?? null;
  if (f === 'neckline.centre') return p.neckline?.centreWidth ?? null;
  const [name, prop] = f.split('.') as [string, 'width' | 'height'];
  const w = wpOf(p, name);
  return w ? w[prop] : null;
}

function setField(p: Panel, f: StrapField, d: DimExpr): Panel {
  if (f === 'yoke.neckWidth') return { ...p, yoke: { ...p.yoke!, neck: { ...p.yoke!.neck, width: d } } };
  if (f === 'yoke.backWidth') return { ...p, yoke: { ...p.yoke!, shoulder: { ...p.yoke!.shoulder, backWidth: d } } };
  if (f === 'neckline.width') return p.neckline ? { ...p, neckline: { ...p.neckline, width: d } } : p;
  if (f === 'neckline.centre') return p.neckline ? { ...p, neckline: { ...p.neckline, centreWidth: d } } : p;
  const [name, prop] = f.split('.') as [string, 'width' | 'height'];
  const waypoints = p.waypoints.map((w): Waypoint => {
    if (w.name !== name) return w;
    // A symmetric waypoint's halves follow its width (as the waypoint properties keep them).
    return prop === 'width' ? { ...w, symmetric: true, width: d, left: dim(`(${d.expr}) / 2`), right: dim(`(${d.expr}) / 2`) } : { ...w, height: d };
  });
  return { ...p, waypoints };
}

/**
 * A wider neck keeps its curve: the shaping each side stays what it was (`width − centre` at the neck's own
 * width) and the extra width goes to the centre bind-off (top-down: the centre cast-on). A V gets a flat bottom.
 */
function centreFor(width: string, centre: string): string {
  const w = width.trim();
  const c = centre.trim();
  if (c === '0') return `max(0, neck_w - ${/^[A-Za-z_][\w.]*$/.test(w) ? w : `(${w})`})`;
  const k = c.match(new RegExp(`^${escape(w)} \\* ([0-9.]+)$`));
  if (k) return `neck_w - ${w} * ${round(1 - Number(k[1]))}`;
  const less = c.match(new RegExp(`^${escape(w)} - ([0-9.]+)$`));
  if (less) return `neck_w - ${less[1]}`;
  return `max(0, neck_w - ((${w}) - (${c})))`;
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** The pieces' fields the strap drives in a mode, with their linked expressions (built from the saved originals). */
function linkedExprs(p: Panel, gives: StrapGives, saved: Record<string, DimExpr>): Partial<Record<StrapField, string>> {
  const orig = (f: StrapField) => (saved[f] ?? getField(p, f))!.expr;
  const out: Partial<Record<StrapField, string>> = {};
  // A yoke: the generator solves the linked one (the neck, or the back width) for the seam, and a wider neck keeps
  // the front neck's shaping (contiguous.ts).
  if (isStrapYoke(p)) return gives === 'neck' ? { 'yoke.neckWidth': STRAP_YOKE_NECK } : { 'yoke.backWidth': STRAP_YOKE_BACK };
  if (p.neckline) out['neckline.width'] = NECK_FOLLOWS;
  if (gives === 'neck') {
    out['neck_side.width'] = STRAP_NECK;
    if (p.neckline && (p.neckline.shape === 'round' || p.neckline.shape === 'v')) out['neckline.centre'] = centreFor(orig('neckline.width'), orig('neckline.centre'));
    return out;
  }
  // Without the shoulder flare the shoulder line is the end of the armhole shaping, carried straight up.
  const straightUp = orig('shoulder.width').trim() === 'armhole_end.width';
  if (wpOf(p, 'armhole_end')) {
    if (straightUp) out['armhole_end.width'] = STRAP_SHOULDER;
    else {
      out['shoulder.width'] = STRAP_SHOULDER;
      out['armhole_end.width'] = `min(${orig('armhole_end.width')}, shoulder.width)`;
    }
    // A narrow shoulder needs more armhole decreases (one per row): the end of the armhole shaping moves up as far as
    // they need. A wide one needs more increases above it (one every RS row): it moves down as far as those need.
    // Never above two rows under the shoulder line.
    if (wpOf(p, 'armhole_bo')) {
      const up = `armhole_bo.height + ((armhole_bo.width - armhole_end.width) / 2 / st_w + 1) * row_h`;
      const down = `shoulder.height - (2 + max(0, shoulder.width - armhole_end.width) / st_w) * row_h`;
      out['armhole_end.height'] = `min(${down}, max(${orig('armhole_end.height')}, ${up}))`;
    }
  } else out['shoulder.width'] = STRAP_SHOULDER;
  return out;
}

const isLinked = (d: DimExpr | null, expr: string | undefined) => !!d && expr !== undefined && d.expr === expr && Object.keys(d.overrides).length === 0;

/**
 * Re-link one piece from mode `from` (null = not linked yet) to `to` (null = unlinked). A field the knitter typed
 * over stays as typed unless it is in `force`; a field the new mode no longer drives gets its saved value back.
 */
function relinkPiece(p: Panel, from: StrapGives | null, to: StrapGives | null, saved0: Record<string, DimExpr>, force: Set<StrapField> = new Set()): { panel: Panel; saved: Record<string, DimExpr> } {
  const saved = { ...saved0 };
  const old = from ? linkedExprs(p, from, saved) : {};
  let panel = p;
  const write: StrapField[] = [];
  for (const f of FIELDS) {
    const cur = getField(p, f);
    if (!cur) continue;
    const wasLinked = isLinked(cur, old[f]);
    const inNew = to ? f in linkedExprs(p, to, saved) : false;
    if (inNew) {
      if (f in old && !wasLinked && !force.has(f)) continue; // typed over by the knitter: theirs
      if (!wasLinked && !(f in saved)) saved[f] = structuredClone(cur);
      write.push(f);
    } else if (wasLinked) {
      panel = setField(panel, f, saved[f] ?? cur);
      delete saved[f];
    }
  }
  if (to) {
    const next = linkedExprs(p, to, saved);
    for (const f of write) panel = setField(panel, f, dim(next[f]!));
  }
  return { panel, saved };
}

function withPieces(p: Project, fn: (x: Panel, saved: Record<string, DimExpr>) => { panel: Panel; saved: Record<string, DimExpr> } | null, strap: StrapSettings | undefined): Project {
  // Saved values of pieces that are gone (replaced by a method change) go with them.
  const saved = Object.fromEntries(Object.entries(strap?.saved ?? {}).filter(([id]) => p.panels.some((x) => x.id === id)));
  const panels = p.panels.map((x) => {
    if (!isStrapPiece(x) && !isStrapYoke(x)) return x;
    const r = fn(x, saved[x.id] ?? {});
    if (!r) return x;
    if (Object.keys(r.saved).length) saved[x.id] = r.saved;
    else delete saved[x.id];
    return r.panel;
  });
  return { ...p, panels, garment: { ...p.garment, strap: strap && { ...strap, saved } } };
}

/** The strap each size has now on the Back (or the first bodice): half of shoulder − neck_side, cm. */
export function derivedStrap(p: Project, sizeId: Id, piece?: Panel): number | null {
  const x = piece ?? strapPieces(p).find((q) => q.template === 'back') ?? strapPieces(p)[0];
  if (!x) return null;
  const v = resolvePanelDims(p, x, sizeId).values;
  const s = v['shoulder.width'];
  const n = v['neck_side.width'];
  return s === undefined || n === undefined ? null : (s - n) / 2;
}

/**
 * The strap setting's starting value: the garment's strap as it is, so turning the setting on moves nothing. A
 * plain number when every size has the same strap, else the Back's own expressions, else a fixed value per size.
 */
export function defaultStrapWidth(p: Project): DimExpr {
  const yoke = p.panels.find(isStrapYoke);
  if (yoke) return defaultYokeStrap(p, yoke);
  const back = strapPieces(p).find((q) => q.template === 'back') ?? strapPieces(p)[0];
  const vals = p.sizes.map((s) => ({ id: s.id, v: derivedStrap(p, s.id, back) }));
  const known = vals.filter((x): x is { id: Id; v: number } => x.v !== null);
  if (!back || !known.length) return dim(BOAT_STRAP);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  if (known.every((x) => Math.abs(x.v - known[0].v) < 0.05)) return dim(r1(known[0].v));
  // The Back's shoulder and neck_side widths, written out over garment names only.
  const own = (name: string) => wpOf(back, name)?.width.expr ?? '';
  let s = own('shoulder');
  if (s.trim() === 'armhole_end.width') s = own('armhole_end');
  const text = `(${s} - (${own('neck_side')})) / 2`.replace(/\((\w+)\)/g, '$1');
  const ok = p.sizes.every((sz, i) => {
    const r = resolveDefinitions({ x: text }, buildScope(p, sz.id));
    return vals[i].v === null || (r.values.x !== undefined && Math.abs(r.values.x - vals[i].v!) < 1e-6);
  });
  if (ok) return dim(text);
  const base = known.find((x) => x.id === p.baseSizeId) ?? known[0];
  return dim(r1(base.v), Object.fromEntries(known.filter((x) => x !== base).map((x) => [x.id, r1(x.v)])));
}

/** The yoke's seam as it is in each size, to 0.1 cm (finer than a row, so it gives the same rows back). */
function defaultYokeStrap(p: Project, yoke: Panel): DimExpr {
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const vals = p.sizes.map((s) => ({ id: s.id, v: r1(generateYoke(p, yoke.yoke!, s.id).derived.seamCm) }));
  if (!vals.length) return dim(BOAT_STRAP);
  const base = vals.find((x) => x.id === p.baseSizeId) ?? vals[0];
  return dim(base.v, Object.fromEntries(vals.filter((x) => x.id !== base.id && x.v !== base.v).map((x) => [x.id, x.v])));
}

/**
 * Set the strap (one undo step). First time: links every bodice. A different `gives`: re-links the fields that were
 * linked (fields typed over stay). A new width alone just changes `strap_w`. null: unlinks everything (each field
 * gets its own value back) and removes the setting.
 */
export function setStrap(p: Project, next: { width: DimExpr; gives: StrapGives } | null, notes: string[] = []): Project {
  const cur = p.garment.strap;
  if (!next) {
    if (!cur) return p;
    const q = withPieces(p, (x, saved) => relinkPiece(x, cur.gives, null, saved), cur);
    notes.push('The strap no longer drives the neck and shoulders: each field keeps its own value.');
    const { strap: _, ...garment } = q.garment;
    return { ...q, garment };
  }
  const strap: StrapSettings = { width: next.width, gives: next.gives, saved: cur?.saved ?? {} };
  if (cur && cur.gives === next.gives) return { ...p, garment: { ...p.garment, strap } };
  return withPieces(p, (x, saved) => relinkPiece(x, cur?.gives ?? null, next.gives, saved), strap);
}

/** Re-link one piece's fields to the strap (the "Re-link to strap" button): typed-over values are replaced. */
export function relinkStrap(p: Project, panelId: Id): Project {
  const strap = p.garment.strap;
  if (!strap) return p;
  return withPieces(p, (x, saved) => (x.id === panelId ? relinkPiece(x, strap.gives, strap.gives, saved, new Set(FIELDS)) : null), strap);
}

/**
 * After pieces were made or their necks reset (a new garment, a method or neckline change): link the bodices that
 * aren't linked yet; a new boat neck gets its 3 cm strap when the garment has none. `reset` (a neckline change): the
 * neck fields' saved values are replaced by the new shape's.
 */
export function applyStrap(p: Project, opts: { reset?: boolean } = {}, notes: string[] = []): Project {
  let strap = p.garment.strap;
  if (!strapTargets(p).length) return p;
  if (!strap) {
    if (garmentChoice(p).neckline !== 'boat') return p;
    strap = { width: dim(BOAT_STRAP), gives: 'neck', saved: {} };
    notes.push('A boat neck leaves a 3 cm strap: Garment → Shoulders → Strap width.');
  }
  const neckKeys: StrapField[] = ['neckline.width', 'neckline.centre', 'neck_side.width', 'yoke.neckWidth'];
  const s = strap;
  return withPieces(
    p,
    (x, saved0) => {
      const fresh = !s.saved[x.id];
      if (!fresh && !opts.reset) return null;
      const saved = { ...saved0 };
      if (opts.reset) for (const k of neckKeys) delete saved[k];
      return relinkPiece(x, opts.reset && !fresh ? s.gives : null, s.gives, saved, opts.reset ? new Set(neckKeys) : new Set());
    },
    s,
  );
}

/** Which of a piece's fields the strap drives now, and which of them were typed over (no longer linked). */
export function strapLinks(p: Project, panel: Panel): { linked: StrapField[]; unlinked: StrapField[] } {
  const strap = p.garment.strap;
  if (!strap || !(isStrapPiece(panel) || isStrapYoke(panel))) return { linked: [], unlinked: [] };
  const want = linkedExprs(panel, strap.gives, strap.saved[panel.id] ?? {});
  const linked: StrapField[] = [];
  const unlinked: StrapField[] = [];
  for (const f of FIELDS) {
    if (!(f in want)) continue;
    (isLinked(getField(panel, f), want[f]) ? linked : unlinked).push(f);
  }
  return { linked, unlinked };
}

/** Is this waypoint field (or the neckline's) driven by the strap? For the "from strap width" marks. */
export function strapLinked(p: Project, panel: Panel, field: StrapField): boolean {
  return strapLinks(p, panel).linked.includes(field);
}

export interface StrapReadout {
  strapCm: number;
  strapSts: number; // each side, at the shoulder line
  neckCm: number;
  shoulderCm: number;
}

/** One line per piece: the strap at the shoulder line (cm and sts each side), the neck and the shoulder width. */
export function strapReadout(p: Project, panel: Panel, sizeId: Id): StrapReadout | null {
  if (!isStrapPiece(panel)) return null;
  const c = computePanel(p, panel, sizeId);
  const sh = c.waypoints.find((w) => w.key === 'shoulder');
  const ns = c.waypoints.find((w) => w.key === 'neck_side');
  if (!sh || !ns) return null;
  return { strapCm: (sh.widthCm - ns.widthCm) / 2, strapSts: (sh.stitches - ns.stitches) / 2, neckCm: ns.widthCm, shoulderCm: sh.widthCm };
}

export interface YokeStrapReadout {
  strapCm: number;
  rows: number;
  neckCm: number;
  /** The back at the end of the shoulders (before the markers move), as the yoke's own readout gives it. */
  backCm: number;
}

/** The yoke's strap (its shoulder seam) in a size: cm and rows, the neck cast-on and the back at the end of A. */
export function yokeStrapReadout(p: Project, panel: Panel, sizeId: Id): YokeStrapReadout | null {
  if (!isStrapYoke(panel)) return null;
  const y = generateYoke(p, panel.yoke!, sizeId);
  return { strapCm: y.derived.seamCm, rows: y.counts.A, neckCm: y.neck.backNeck / y.stitchesPerCm, backCm: y.derived.backEndOfACm };
}
