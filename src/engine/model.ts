// The project data model. Plain JSON-serializable objects only.
// All lengths are centimetres. Ids are opaque strings.

import type { Align, IntervalOrder, RowSide } from './distribute';
import type { Gauge } from './gauge';
import type { Parity } from './rounding';
import type { Units } from './units';

export const SCHEMA_VERSION = 2;

export type Id = string;

// ---------- sizes & measurements ----------

export type BodyRegion = 'upper' | 'lower' | 'sleeves';

export interface Size {
  id: Id;
  name: string; // e.g. "3XS", "M", "2X"
  estimated?: boolean; // the sizing-table row is an estimate (its source column says "estimated")
  /**
   * Region sizing (when the project turns it on): which size each body region takes its measurements from.
   * A missing region follows this size.
   */
  regions?: Partial<Record<BodyRegion, Id>>;
  /** A one-off size (e.g. "me") with its own measurements, seeded from a table row (by size name). */
  custom?: { seededFrom: string };
}

/** How a measurement gets values for sizes that have neither a table value nor a manual override. */
export type GradingRule =
  | { type: 'none' }
  /** Base value at the project's base size; `steps[sizeId]` = change from the previous size to that size. */
  | { type: 'increment'; baseValue: number; defaultStep: number; steps: Record<Id, number> }
  /** Derived from other measurements, e.g. `cross_back + 3`. */
  | { type: 'expression'; expr: string };

export interface Measurement {
  name: string; // identifier used in expressions
  label: string;
  kind: 'circumference' | 'length';
  rule: GradingRule;
  table: Record<Id, number>; // values imported from a sizing table, by size id
  manual: Record<Id, number>; // per-size manual overrides (win over everything)
  estimate?: boolean; // seeded estimate the user should check
  note?: string;
  /** Body region for region sizing; default from the measurement dictionary, else upper body. */
  region?: BodyRegion;
}

/** Where a resolved measurement value came from (shown as a subtle indicator). */
export type ValueSource = 'table' | 'rule' | 'manual';

/** Which bust column of the sizing table `bust` (and `apex_to_apex`, `dart_height`) follow; custom = `bust_custom`. */
export type CupChoice = 'ab' | 'cd' | 'ef' | 'gh' | 'custom';

export type HemChoice = 'high_hip' | 'hip_seat_straight' | 'hip_seat_curvy';

/** Project-level choices that pick sizing-table columns for the names templates use. */
export interface FitChoices {
  cup: CupChoice;
  /** Which circumference the hem follows (`hem_circ`) and the matching waist-to-hem length (`hem_drop`). Default high hip. */
  hem?: HemChoice;
  /** Use the broad-back columns for `shoulder_w` and `cross_back_w`. */
  broadBack?: boolean;
}

/** Ease is total circumference ease in cm, split between panels by the expressions that use it. */
export interface EaseSettings {
  global: number; // `ease` in expressions
  per: Record<string, number>; // `ease.<measurement>`; falls back to global
}

// ---------- panel geometry ----------

/** A dimension given as an expression, with optional per-size fixed overrides (cm). */
export interface DimExpr {
  expr: string;
  overrides: Record<Id, number>;
}

export interface Waypoint {
  id: Id;
  name: string; // hem, waist, bust, underarm, shoulder, …
  height: DimExpr; // from the panel's start edge
  symmetric: boolean;
  width: DimExpr; // full width, used when symmetric
  left: DimExpr; // half-width from the centre line to the left edge, used when not symmetric
  right: DimExpr; // half-width to the right edge, used when not symmetric
}

export type Rhythm = { type: 'auto' } | { type: 'fixed'; every: number } | { type: 'mixed'; a: number; b: number };

export type SegmentMethod =
  /** Spread increases/decreases over the rows of the segment. */
  | { kind: 'auto'; side: RowSide; align: Align; order: IntervalOrder; rhythm: Rhythm; perSide: number }
  /** Bind off (or cast on) in steps at the start of the segment, e.g. armhole or shoulder steps. */
  | { kind: 'steps'; steps: number[] | null; maxPerStep: number; align?: Align } // null = auto-suggest; align default 'start'
  /** Shoulder slope etc. worked with short rows instead of bind-off steps. */
  | { kind: 'shortrows'; steps: number[] | null; maxPerStep: number; style: ShortRowStyle; align?: Align }
  /** Width changes with no shaping (a warning is shown if widths differ). */
  | { kind: 'straight' };

export type ShortRowStyle = 'wrap-turn' | 'german';

/** A shaping marker placed by hand. `row` is relative to the segment's first row (1-based). */
export interface ManualEvent {
  row: number;
  delta: number; // stitch change at this edge
  symbol: string; // symbol id, e.g. 'k2tog', 'ssk', 'm1l', 'yo'
}

export type ShapingPlacement = 'edge' | 'princess' | 'both';

/** A point in a panel: height up from the garment's lower edge and distance from the centre line (− = left), cm. */
export interface Anchor {
  height: DimExpr;
  x: DimExpr;
}

/**
 * A shaping line drawn inside a panel: increases/decreases worked along it, spread over the rows between its ends.
 * `amount` is the stitch change going up the garment from the lower end (an expression in stitches); a fisheye
 * line makes that change up to its middle and undoes it above. Mirrored lines get a twin on the other half.
 */
export interface ShapingLine {
  id: Id;
  name: string;
  from: Anchor;
  to: Anchor;
  amount: DimExpr; // stitches (per line), e.g. "-8" or "round(3 / st_w)"
  kind: 'one-way' | 'fisheye';
  sides: 'both' | 'one'; // shape on both sides of the line (2 sts per row) or one side
  rowSide: 'rs' | 'any';
  mirror: boolean;
  manual: Record<Id, number[]>; // hand-placed knit rows per size
}

/**
 * A stitch painted anywhere in the fabric, for one size: on knit row `row`, in the cell whose left edge is `x`
 * stitches from the row's centre (negative = left of centre, as seen from the RS). Increases/decreases change the
 * count and widen/narrow the panel evenly about the centre; other stitches are only drawn.
 */
export interface FreeStitch {
  id: Id;
  sizeId: Id;
  row: number;
  x: number;
  symbol: string;
  mirror: boolean; // also worked mirrored across the centre (leaning stitches swap)
}

/** Two vertical shaping lines, mirrored about the centre (princess-seam waist shaping, as in fisheye darts). */
export interface Princess {
  position: DimExpr; // distance of each line from the centre line (cm)
  sides: 'both' | 'one'; // shape on both sides of the marker (2 sts per line per row) or on one side
}

export function defaultPrincess(): Princess {
  return { position: dim('apex_to_apex / 2'), sides: 'both' };
}

/** Shaping of one edge between waypoint `fromWaypoint` and the next waypoint up. */
export interface Segment {
  fromWaypoint: Id;
  left: SegmentMethod;
  right: SegmentMethod;
  mirror: boolean; // right edge follows the left edge's method
  /**
   * Where increases/decreases are worked: at the side edges (default), at the panel's princess lines (the edges
   * stay straight in the fabric), or both. Only applies to increases/decreases, not bind-off/cast-on steps.
   */
  placement?: ShapingPlacement;
  /** Manual marker lists by size id; when present they replace the auto-suggestion for that size and edge. */
  manual: Record<Id, { left?: ManualEvent[]; right?: ManualEvent[] }>;
}

export type KnitDirection = 'bottom-up' | 'top-down' | 'side-to-side';
export type PanelEdge = 'bottom' | 'top' | 'left' | 'right';

export interface StitchPattern {
  name: string; // e.g. "stockinette", "2x2 rib", "lace"
  multiple: number;
  offset: number;
}

/** A band of rows worked in a different stitch pattern, e.g. a ribbed hem or cuff. */
export interface PatternSection {
  id: Id;
  name: string;
  fromHeight: DimExpr;
  toHeight: DimExpr;
  pattern: StitchPattern;
}

export type NecklineShape = 'round' | 'v' | 'square' | 'boat';

export interface Neckline {
  shape: NecklineShape;
  width: DimExpr; // neck opening width at the top of the panel
  depth: DimExpr; // measured down from the top of the panel
  centre: 'bindoff' | 'hold'; // what happens to the centre stitches
  centreWidth: DimExpr; // width taken off at the centre in one go (round neck); 0 for V
  side: 'rs' | 'any'; // which rows the side shaping uses
}

export type BustMethod = 'shortrows' | 'horizontal-dart' | 'vertical-dart' | 'none';

/**
 * Bust shaping for a front panel. Amounts are expressions (cm) over measurements and ease only;
 * the results are available to waypoint expressions as `bust_w`, `bust_l` and `bust_side_w`.
 */
export interface BustShaping {
  method: BustMethod;
  width: DimExpr; // W: extra width over the bust (total)
  length: DimExpr; // L: extra length at centre front (when width is added at the front)
  /**
   * Short rows / horizontal dart: extra width is added at the front (default). Off: W = 0 and L comes from
   * `lengthNoWidth`, which is longer because the length has to hold all the bust volume. Vertical darts always add width.
   */
  frontWidth?: boolean;
  lengthNoWidth?: DimExpr;
  /** Bust point: subtracted from hps_to_apex, which is measured over the bust and so is longer than the vertical drop. */
  apexCorrection?: DimExpr;
  sideWidth: boolean; // short rows / horizontal dart: also add W at the side seams (bust_side_w = W)
  apexHeight: DimExpr; // bust point height, up from the garment's lower edge
  apexOffset: DimExpr; // bust point distance from centre front
  shortRows: {
    style: ShortRowStyle;
    pairs: number | null;
    order: 'shortening' | 'lengthening';
    zoneWidth: DimExpr;
    /** Where the turns go: a zone centred on the bust point, or from the bust point out to the side seam. */
    span?: 'zone' | 'apex-to-side';
    /** Where the short rows start: centred on the bust point's height, or right at it. */
    start?: 'centred' | 'apex';
  };
  dart: { placement: 'side' | 'underarm'; tipGap: DimExpr };
  vertical: { bottom: DimExpr; gap: DimExpr; top: DimExpr };
  /** Hand-adjusted steps by size: unworked stitches per short-row pair at each edge; vertical dart rows (knit rows). */
  manual: Record<Id, { left?: number[]; right?: number[]; incRows?: number[]; decRows?: number[] }>;
}

/** Bust length when no width is added at the front: the dart height plus a quarter of the bust difference. */
export const DEFAULT_LENGTH_NO_WIDTH = 'dart_height + (bust - upper_chest) * 0.25';

export function defaultBust(): BustShaping {
  return {
    method: 'shortrows',
    width: dim('(bust - upper_chest) * 1.0'),
    length: dim('dart_height'),
    frontWidth: true,
    lengthNoWidth: dim(DEFAULT_LENGTH_NO_WIDTH),
    apexCorrection: dim('hps_to_apex * 0.05'),
    sideWidth: true,
    apexHeight: dim('shoulder.height + shoulder_drop - (hps_to_apex - bust_apex_corr)'),
    apexOffset: dim('apex_to_apex / 2'),
    shortRows: { style: 'german', pairs: null, order: 'shortening', zoneWidth: dim('max(6, bust_l * 2.5)') },
    dart: { placement: 'side', tipGap: dim(2.5) },
    vertical: { bottom: dim('waist.height'), gap: dim(2), top: dim('underarm.height + armhole_depth * 0.5') },
    manual: {},
  };
}

export interface Panel {
  id: Id;
  name: string;
  template: string | null; // which template generated it (informational)
  direction: KnitDirection;
  startEdge: PanelEdge;
  inTheRound: boolean; // the whole panel is worked in the round
  /**
   * Worked in the round below (and up to) this waypoint, flat above it, e.g. a body joined in the round
   * up to the underarm. Direction-independent: top-down panels are flat down to it, then joined.
   */
  joinAt?: Id | null;
  selvedge: { left: number; right: number }; // 0–2 each, flat parts only
  shapingInset: number; // stitches between the edge and the shaping (default 2)
  rounding: { parity: Parity; rowParity: Parity };
  pattern: StitchPattern; // main stitch pattern
  sections: PatternSection[];
  waypoints: Waypoint[]; // ordered by height
  segments: Segment[];
  neckline: Neckline | null;
  bust?: BustShaping | null;
  princess?: Princess | null;
  /** A panel linked by the knitter (e.g. back ↔ front): dragging a waypoint moves the same-named one there too. */
  linkedTo?: Id | null;
  /** How the first row is made: cast on (default) or picked up from another panel (top-down fronts). */
  startFrom?: 'caston' | 'pickup';
  freeStitches?: FreeStitch[];
  shapingLines?: ShapingLine[];
  layout: { x: number; y: number; rotation: 0 | 90 | 180 | 270 };
  notes: string;
}

// ---------- joins (annotation only) ----------

export type JoinTag = 'seam' | 'pickup' | 'live' | 'bindoff' | 'caston' | 'free';

/** A stretch of a panel's outline. Side edges run between two waypoints (in either order). */
export type EdgeKey =
  | { kind: 'side'; side: 'left' | 'right'; from: Id; to: Id }
  | { kind: 'bottom' } // the garment's lower edge
  | { kind: 'top' } // the garment's upper edge outside any neckline
  | { kind: 'neck' }; // the whole neckline (both slopes and the centre)

export interface EdgeRef {
  panelId: Id;
  edge: EdgeKey;
}

/**
 * How panels meet, as the knitter decides it. The app measures and annotates; it never changes the knitting.
 * Seams compare `edges` (one side) with `partner` (the other side); pick-ups sum all `edges`.
 */
export interface Join {
  id: Id;
  name: string;
  tag: JoinTag;
  edges: EdgeRef[];
  partner: EdgeRef[];
  ratio: { stitches: number; rows: number } | null; // pick-up ratio; null = the project default
  note: string;
}

// ---------- project ----------

export interface ProjectSettings {
  seamToleranceCm: number;
  pickUp: { stitches: number; rows: number }; // default 3 sts per 4 rows
  /** Upper body, lower body and sleeves may take their measurements from different sizes (per size). Off by default. */
  regionSizing?: boolean;
}

/** A stitch symbol the knitter defines (drawn as a coloured cell with its abbreviation). */
export interface CustomSymbol {
  id: Id; // 'custom_…'
  label: string;
  abbr: string;
  color: string; // CSS colour
  change: number; // stitch change when used as a shaping marker
}

export interface Project {
  schemaVersion: number;
  id: Id;
  name: string;
  units: Units;
  gauge: Gauge;
  sizes: Size[];
  baseSizeId: Id;
  measurements: Measurement[];
  ease: EaseSettings;
  fit: FitChoices;
  panels: Panel[];
  joins?: Join[];
  symbols?: CustomSymbol[];
  settings: ProjectSettings;
  createdAt: string;
  updatedAt: string;
}

// ---------- factories ----------

let idCounter = 0;
export function newId(prefix = 'id'): Id {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${idCounter.toString(36)}`;
}

export function dim(expr: string | number, overrides: Record<Id, number> = {}): DimExpr {
  return { expr: String(expr), overrides };
}

export type AutoMethod = Extract<SegmentMethod, { kind: 'auto' }>;

export function defaultAutoMethod(): AutoMethod {
  return { kind: 'auto', side: 'rs', align: 'end', order: 'spread', rhythm: { type: 'auto' }, perSide: 1 };
}

export function newWaypoint(name: string, height: string | number, width: string | number): Waypoint {
  return {
    id: newId('wp'),
    name,
    height: dim(height),
    symmetric: true,
    width: dim(width),
    left: dim(`(${width}) / 2`),
    right: dim(`(${width}) / 2`),
  };
}

export function newSegment(fromWaypoint: Id, method: SegmentMethod = defaultAutoMethod()): Segment {
  return { fromWaypoint, left: method, right: method, mirror: true, manual: {} };
}

export function newPanel(name: string): Panel {
  return {
    id: newId('panel'),
    name,
    template: null,
    direction: 'bottom-up',
    startEdge: 'bottom',
    inTheRound: false,
    selvedge: { left: 1, right: 1 },
    shapingInset: 2,
    rounding: { parity: 'any', rowParity: 'any' },
    pattern: { name: 'stockinette', multiple: 1, offset: 0 },
    sections: [],
    waypoints: [],
    segments: [],
    neckline: null,
    layout: { x: 0, y: 0, rotation: 0 },
    notes: '',
  };
}

export function newMeasurement(name: string, label = name, kind: Measurement['kind'] = 'length'): Measurement {
  return { name, label, kind, rule: { type: 'none' }, table: {}, manual: {} };
}

export function newProject(name = 'Untitled top'): Project {
  const now = new Date().toISOString();
  const size: Size = { id: newId('size'), name: 'M' };
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('project'),
    name,
    units: 'metric',
    gauge: { stitches: 22, rows: 30, basis: '10cm' },
    sizes: [size],
    baseSizeId: size.id,
    measurements: [],
    ease: { global: 5, per: {} },
    fit: { cup: 'cd' },
    panels: [],
    settings: { seamToleranceCm: 1, pickUp: { stitches: 3, rows: 4 } },
    createdAt: now,
    updatedAt: now,
  };
}
