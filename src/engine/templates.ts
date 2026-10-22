// Panel templates: starting points that generate ordinary, fully editable panels.
// Widths use total circumference ease split front/back (ease/2 per body panel). Heights are measured up
// from the garment's lower edge whatever the knitting direction.

import { defaultAutoMethod, defaultBust, dim, newId, newPanel, newSegment, newWaypoint, type Join, type KnitDirection, type NecklineShape, type Panel, type SleeveLength } from './model';
import { sleeveName, withSleeveLength } from './sleeveLength';

export type TemplateId = 'top' | 'back' | 'front' | 'sleeve' | 'rectangle' | 'neckband' | 'yoke';
export type SleeveType = 'set-in' | 'drop' | 'straight';

export interface TemplateOptions {
  direction?: KnitDirection;
  neckline?: NecklineShape;
  sleeve?: SleeveType;
  sleeveLength?: SleeveLength; // sleeves: long (default), three-quarter, elbow, short or cap (set-in only)
  joinInRound?: boolean; // body: worked in the round up to the underarm
  /**
   * Top-down bodices. 'shoulders-first' (default): the back is cast on at the shoulders, the front shoulders are
   * picked up from it, and the underarm cast-on is split half each. 'standalone': each panel cast on on its own.
   */
  construction?: 'shoulders-first' | 'standalone';
  shoulderSlope?: 'shortrows' | 'none'; // top-down: German short rows, or straight shoulders
  backNeck?: 'straight' | 'shaped'; // top-down back: cast on straight across, or a shaped back neck
  /**
   * Set-in bodices: after the armhole decreases reach the cross back (front: cross front), widen again to the back
   * shoulder width at the shoulder line (default). Off: straight up from the armhole to the shoulder.
   */
  shoulderFlare?: boolean;
}

export const TEMPLATES: { id: TemplateId; label: string; description: string; options: (keyof TemplateOptions)[] }[] = [
  {
    id: 'top',
    label: 'Top-down top (back + front)',
    description: 'Back cast on at the shoulders; front shoulders picked up from it; neck joined at the centre; underarms cast on half each, then in the round. Joins are tagged for you.',
    options: ['neckline', 'shoulderSlope', 'backNeck', 'shoulderFlare', 'joinInRound'],
  },
  { id: 'back', label: 'Back bodice', description: 'Hem, waist, set-in armholes, shoulder slope and back neck.', options: ['direction', 'shoulderSlope', 'backNeck', 'shoulderFlare', 'joinInRound'] },
  { id: 'front', label: 'Front bodice', description: 'Like the back, with a front neckline.', options: ['direction', 'neckline', 'shoulderSlope', 'shoulderFlare', 'joinInRound'] },
  { id: 'sleeve', label: 'Sleeve', description: 'Set-in cap, drop shoulder or straight, long to short (or a cap sleeve), with a ribbed cuff.', options: ['direction', 'sleeve', 'sleeveLength'] },
  { id: 'rectangle', label: 'Plain rectangle', description: 'Two waypoints, no shaping.', options: ['direction'] },
  { id: 'neckband', label: 'Neckband strip', description: 'A ribbed strip; its length is a starting estimate.', options: [] },
  {
    id: 'yoke',
    label: 'Contiguous yoke',
    description: 'A top-down yoke worked in one piece from the back neck, with set-in-look sleeve caps (the contiguous method by Susie Myers, SusieM on Ravelry). Its phases are set in the panel properties.',
    options: ['neckline'],
  },
];

/** Measurements each template's expressions rely on that may be missing (seeded estimates). */
export const TEMPLATE_MEASUREMENTS: Record<TemplateId, string[]> = {
  top: ['back_shoulder_width', 'shoulder_drop', 'back_neck_width', 'front_neck_drop', 'back_neck_drop', 'waist_to_underarm', 'waist_shift', 'hps_to_apex', 'apex_to_apex', 'underarm_co'],
  back: ['back_shoulder_width', 'shoulder_drop', 'back_neck_width', 'back_neck_drop', 'waist_to_underarm', 'waist_shift', 'underarm_co'],
  front: ['back_shoulder_width', 'shoulder_drop', 'back_neck_width', 'front_neck_drop', 'back_neck_drop', 'waist_to_underarm', 'waist_shift', 'hps_to_apex', 'apex_to_apex', 'underarm_co'],
  sleeve: ['cap_height', 'cap_ease'],
  rectangle: [],
  neckband: ['back_neck_width', 'front_neck_drop'],
  yoke: ['back_neck_width', 'back_shoulder_width', 'shoulder_drop', 'back_neck_drop', 'front_neck_drop', 'underarm_co'],
};

// ---------- bodices ----------

export const FRONT_NECKS: Record<NecklineShape, { width: string; depth: string; centre: string; top: string }> = {
  round: { width: 'back_neck_width', depth: 'front_neck_drop', centre: 'back_neck_width * 0.4', top: 'back_neck_width' },
  v: { width: 'back_neck_width', depth: 'front_neck_drop * 2', centre: '0', top: 'back_neck_width' },
  square: { width: 'back_neck_width', depth: 'front_neck_drop + 2', centre: 'back_neck_width', top: 'back_neck_width' },
  boat: { width: 'back_neck_width + 6', depth: 'back_neck_drop + 1', centre: 'back_neck_width + 2', top: 'back_neck_width + 6' },
};

function shouldersFirstEarly(direction: KnitDirection, opts: TemplateOptions): boolean {
  return direction === 'top-down' && (opts.construction ?? 'shoulders-first') === 'shoulders-first';
}

/**
 * Back or front bodice. Bottom-up: shoulder slope in bind-off steps up to the neck width.
 * Top-down: the shoulders are cast on either side of the neck and the slope is worked in short rows.
 * The front carries bust shaping (short rows by default) and takes the bust width at its side seams.
 */
export function bodice(kind: 'back' | 'front', opts: TemplateOptions = {}): Panel {
  const direction = opts.direction ?? 'bottom-up';
  const shape = opts.neckline ?? 'round';
  const neck = kind === 'back' ? { width: 'back_neck_width', depth: 'back_neck_drop', centre: 'back_neck_width - 2', top: 'back_neck_width' } : FRONT_NECKS[shape];
  const p = newPanel(kind === 'back' ? 'Back' : 'Front');
  p.template = kind;
  p.direction = direction;
  p.rounding.parity = 'even'; // keeps both edges shaping in pairs
  const shift = kind === 'back' ? '- waist_shift' : '+ waist_shift';

  // Hem at the chosen hem level (Project → Fit): hem_circ is high hip by default, hem_drop the matching waist-to-hem length.
  const hem = newWaypoint('hem', 0, 'hem_circ / 2 + ease / 2');
  const waist = newWaypoint('waist', 'hem_drop', `waist / 2 + ease / 2 ${shift}`);
  const underarm = newWaypoint('underarm', 'waist.height + waist_to_underarm', kind === 'front' ? 'upper_chest / 2 + ease / 2 + bust_side_w' : 'upper_chest / 2 + ease / 2');
  // Underarm bind-off in one go ("bind off X sts at the beginning of the next 2 rows"), then armhole decreases.
  // The front carries the bust width to the underarm, so it binds off more and shapes over a longer span.
  const front = kind === 'front';
  const shouldersFirst = direction === 'top-down' && (opts.construction ?? 'shoulders-first') === 'shoulders-first';
  // Shoulders first: front and back each cast on half of the underarm width.
  // A whole number of stitches per side, so front and back cast on the same count whatever their widths round to.
  const boWidth = shouldersFirst ? 'underarm.width - 2 * round(underarm_co / 2 / st_w) * st_w' : `underarm.width - (underarm.width - armhole_end.width) * ${front ? 0.5 : 0.4}`;
  const bo = newWaypoint('armhole_bo', 'underarm.height + 2 * row_h', boWidth);
  const endAt = shouldersFirstEarly(direction, opts) ? (front ? 0.75 : 0.6) : front ? 0.6 : 0.45;
  // Armhole decreases end at the cross back (front: cross front); with the flare the edge then widens to the
  // shoulder width at the shoulder line, front and back alike so the shoulder seams match. Without it the front
  // ends at the back's width, again so the shoulders match.
  const flare = opts.shoulderFlare ?? true;
  const end = newWaypoint('armhole_end', `underarm.height + armhole_depth * ${endAt}`, front && flare ? 'cross_front + 1' : 'cross_back_w + 1');
  const shoulder = newWaypoint('shoulder', 'underarm.height + armhole_depth', flare ? 'shoulder_w' : 'armhole_end.width');
  p.waypoints = [hem, waist, underarm, bo, end, shoulder];
  p.segments = [
    newSegment(hem.id),
    newSegment(waist.id),
    newSegment(underarm.id, { kind: 'steps', steps: null, maxPerStep: 99, align: 'start' }),
    newSegment(bo.id, { ...defaultAutoMethod(), side: 'any', align: 'start', order: 'shortFirst' }),
    newSegment(end.id, flare ? { ...defaultAutoMethod(), align: 'center' } : { kind: 'straight' }),
  ];
  // Straight shoulders (top-down option): the panel ends at the shoulder line, no slope.
  const sloped = direction !== 'top-down' || (opts.shoulderSlope ?? 'shortrows') === 'shortrows';
  if (sloped) {
    const top = newWaypoint('neck_side', 'shoulder.height + shoulder_drop', neck.top);
    p.waypoints.push(top);
    p.segments.push(
      newSegment(
        shoulder.id,
        direction === 'bottom-up' ? { kind: 'steps', steps: null, maxPerStep: 8, align: 'end' } : { kind: 'shortrows', steps: null, maxPerStep: 8, style: 'german', align: 'end' },
      ),
    );
  }
  if (kind === 'front') p.bust = defaultBust();
  const straightBack = kind === 'back' && direction === 'top-down' && (opts.backNeck ?? 'straight') === 'straight';
  p.neckline = straightBack ? null : { shape: kind === 'back' ? 'round' : shape, width: dim(neck.width), depth: dim(neck.depth), centre: 'bindoff', centreWidth: dim(neck.centre), side: 'rs' };
  if (shouldersFirst && front) p.startFrom = 'pickup';
  if (opts.joinInRound) p.joinAt = underarm.id;
  if (shouldersFirst) {
    p.notes = front
      ? 'Shoulders first: each shoulder is picked up from the back, worked flat with the neck increases; the centre is cast on to join the two sides, and the underarms are cast on to join the back.'
      : 'Shoulders first: cast on at the shoulders and work flat to the underarm; the front shoulders are picked up from this cast-on edge.';
  }
  return p;
}

/** Back bodice, bottom-up (kept for existing callers). */
export function backBodice(opts: TemplateOptions = {}): Panel {
  return bodice('back', opts);
}

// ---------- sleeves ----------

function cuffSection(p: Panel): void {
  p.sections = [{ id: newId('sec'), name: 'Cuff rib', fromHeight: dim(0), toHeight: dim(5), pattern: { name: '2x2 rib', multiple: 4, offset: 2 } }];
}

/** A cap sleeve is a set-in cap with no underarm length; drop and straight sleeves have no cap to keep. */
export function sleeveLengthsFor(type: SleeveType): SleeveLength[] {
  return type === 'set-in' ? ['long', 'three-quarter', 'elbow', 'short', 'cap'] : ['long', 'three-quarter', 'elbow', 'short'];
}

export function sleeve(type: SleeveType = 'set-in', direction: KnitDirection = 'bottom-up', length: SleeveLength = 'long'): Panel {
  const p = newPanel(type === 'set-in' ? 'Sleeve' : type === 'drop' ? 'Sleeve (drop shoulder)' : 'Sleeve (straight)');
  p.template = `sleeve-${type}`;
  p.direction = direction;
  p.rounding.parity = 'even';
  const cuff = newWaypoint('cuff', 0, type === 'straight' ? 'bicep + ease.bicep' : 'wrist + ease.wrist');
  if (type === 'set-in') {
    // Bell-shaped cap: bind off to match the body's armhole bind-off, decrease fast, then steadily, then fast
    // again, and bind off the top. Decreases may fall on any row: caps are steep.
    const underarm = newWaypoint('underarm', 'arm_length', 'bicep + ease.bicep');
    const bo = newWaypoint('cap_bo', 'underarm.height + 2 * row_h', 'underarm.width - 0.4 * (upper_chest / 2 + ease / 2 - cross_back_w - 1)');
    const low = newWaypoint('cap_low', 'cap_bo.height + 2', 'cap_bo.width - 5');
    const high = newWaypoint('cap_high', 'cap_top.height - 2', 'cap_top.width + 5');
    // Cap height fitted so both cap edges ≈ armhole_len + cap_ease: half of that per edge, minus the bind-off
    // run, is the slope from cap_bo to cap_top (Pythagoras over its horizontal run). The bell's curved path is
    // about 3.4 % longer than that straight slope, hence 0.966.
    const top = newWaypoint(
      'cap_top',
      'cap_bo.height + sqrt(((armhole_len + cap_ease) / 2 * 0.966 - (underarm.width - cap_bo.width) / 2) ^ 2 - ((cap_bo.width - cap_top.width) / 2) ^ 2)',
      'max(8, bicep * 0.22)',
    );
    p.waypoints = [cuff, underarm, bo, low, high, top];
    const anyRow = { ...defaultAutoMethod(), side: 'any' as const };
    p.segments = [
      newSegment(cuff.id, { ...defaultAutoMethod(), align: 'center' }),
      newSegment(underarm.id, { kind: 'steps', steps: null, maxPerStep: 99, align: 'start' }),
      newSegment(bo.id, { ...anyRow, align: 'start' }),
      newSegment(low.id, anyRow),
      newSegment(high.id, { ...anyRow, align: 'end' }),
    ];
  } else {
    const top = newWaypoint('top', 'arm_length', type === 'drop' ? 'armhole_depth * 2' : 'bicep + ease.bicep');
    p.waypoints = [cuff, top];
    p.segments = [newSegment(cuff.id, type === 'drop' ? { ...defaultAutoMethod(), align: 'center' } : { kind: 'straight' })];
    // A straight sleeve keeps one stitch count: round the body to the rib multiple too.
    if (type === 'straight') p.pattern = { name: 'stockinette', multiple: 4, offset: 2 };
  }
  cuffSection(p);
  if (length === 'long' || !sleeveLengthsFor(type).includes(length)) return p;
  return { ...withSleeveLength(p, length)!, name: sleeveName(p.name, length) };
}

// ---------- others ----------

export function rectangle(direction: KnitDirection = 'bottom-up'): Panel {
  const p = newPanel('Rectangle');
  p.template = 'rectangle';
  p.direction = direction;
  // The top follows the bottom; the panel properties set either one fixed, from a measurement or as an expression.
  p.waypoints = [newWaypoint('bottom', 0, 20), newWaypoint('top', 30, 'bottom.width')];
  p.segments = [newSegment(p.waypoints[0].id, { kind: 'straight' })];
  return p;
}

export function neckband(): Panel {
  const p = newPanel('Neckband');
  p.template = 'neckband';
  const length = 'back_neck_width * 2 + front_neck_drop * 2';
  p.waypoints = [newWaypoint('pick_up', 0, length), newWaypoint('bind_off', 2.5, length)];
  p.segments = [newSegment(p.waypoints[0].id, { kind: 'straight' })];
  p.pattern = { name: '1x1 rib', multiple: 2, offset: 0 };
  p.sections = [{ id: newId('sec'), name: 'Rib', fromHeight: dim(0), toHeight: dim('bind_off.height'), pattern: { name: '1x1 rib', multiple: 2, offset: 0 } }];
  p.notes = 'Length is a starting estimate. The pick-up helper gives the real neckline length.';
  return p;
}

/**
 * A top-down top worked shoulders first: back and front, with the joins this construction implies (front shoulders
 * picked up from the back's cast-on edge; underarms cast on half each). The joins are ordinary, editable joins.
 */
export function topDownTop(opts: TemplateOptions = {}): { panels: Panel[]; joins: Join[] } {
  const o: TemplateOptions = { ...opts, direction: 'top-down', construction: 'shoulders-first' };
  const back = bodice('back', o);
  const front = bodice('front', o);
  const wp = (p: Panel, name: string) => p.waypoints.find((w) => w.name === name)!.id;
  const side = (p: Panel, s: 'left' | 'right') => ({ panelId: p.id, edge: { kind: 'side' as const, side: s, from: wp(p, 'underarm'), to: wp(p, 'armhole_bo') } });
  const joins: Join[] = [
    {
      id: newId('join'),
      name: 'Front shoulders picked up from the back',
      tag: 'pickup',
      edges: [{ panelId: front.id, edge: { kind: 'top' } }],
      partner: [],
      ratio: null,
      note: 'Pick up along the back shoulders (cast-on edge), one stitch per cast-on stitch; work each front shoulder flat.',
    },
    {
      id: newId('join'),
      name: 'Underarm cast-on',
      tag: 'caston',
      edges: [side(front, 'left'), side(front, 'right')],
      partner: [side(back, 'right'), side(back, 'left')],
      ratio: null,
      note: 'Cast on half the underarm stitches on the front and half on the back to join them.',
    },
  ];
  return { panels: [back, front], joins };
}

export function fromTemplate(id: TemplateId, opts: TemplateOptions = {}): Panel {
  switch (id) {
    case 'top':
      return topDownTop(opts).panels[1]; // single-panel callers get the front; use topDownTop() for the set
    case 'back':
      return bodice('back', opts);
    case 'front':
      return bodice('front', opts);
    case 'sleeve':
      return sleeve(opts.sleeve, opts.direction, opts.sleeveLength);
    case 'neckband':
      return neckband();
    default:
      return rectangle(opts.direction);
  }
}
