// Panel templates: starting points that generate ordinary, fully editable panels.
// Widths use total circumference ease split front/back (ease/2 per body panel). Heights are measured up
// from the garment's lower edge whatever the knitting direction.

import { defaultAutoMethod, defaultBust, dim, newId, newPanel, newSegment, newWaypoint, type KnitDirection, type NecklineShape, type Panel } from './model';

export type TemplateId = 'back' | 'front' | 'sleeve' | 'rectangle' | 'neckband';
export type SleeveType = 'set-in' | 'drop' | 'straight';

export interface TemplateOptions {
  direction?: KnitDirection;
  neckline?: NecklineShape;
  sleeve?: SleeveType;
  joinInRound?: boolean; // body: worked in the round up to the underarm
}

export const TEMPLATES: { id: TemplateId; label: string; description: string; options: (keyof TemplateOptions)[] }[] = [
  { id: 'back', label: 'Back bodice', description: 'Hem, waist, set-in armholes, shoulder slope and back neck.', options: ['direction', 'joinInRound'] },
  { id: 'front', label: 'Front bodice', description: 'Like the back, with a front neckline.', options: ['direction', 'neckline', 'joinInRound'] },
  { id: 'sleeve', label: 'Sleeve', description: 'Set-in cap, drop shoulder or straight, with a ribbed cuff.', options: ['direction', 'sleeve'] },
  { id: 'rectangle', label: 'Plain rectangle', description: 'Two waypoints, no shaping.', options: ['direction'] },
  { id: 'neckband', label: 'Neckband strip', description: 'A ribbed strip; its length is a starting estimate.', options: [] },
];

/** Measurements each template's expressions rely on that may be missing (seeded estimates). */
export const TEMPLATE_MEASUREMENTS: Record<TemplateId, string[]> = {
  back: ['hem_to_waist', 'shoulder_slope', 'neck_width', 'back_neck_depth', 'waist_shift'],
  front: ['hem_to_waist', 'shoulder_slope', 'neck_width', 'front_neck_depth', 'back_neck_depth', 'waist_shift', 'bust_point_depth', 'apex_to_apex'],
  sleeve: ['cap_height', 'cap_ease'],
  rectangle: [],
  neckband: ['neck_width', 'front_neck_depth'],
};

// ---------- bodices ----------

const FRONT_NECKS: Record<NecklineShape, { width: string; depth: string; centre: string; top: string }> = {
  round: { width: 'neck_width', depth: 'front_neck_depth', centre: 'neck_width * 0.4', top: 'neck_width' },
  v: { width: 'neck_width', depth: 'front_neck_depth * 2', centre: '0', top: 'neck_width' },
  square: { width: 'neck_width', depth: 'front_neck_depth + 2', centre: 'neck_width', top: 'neck_width' },
  boat: { width: 'neck_width + 6', depth: 'back_neck_depth + 1', centre: 'neck_width + 2', top: 'neck_width + 6' },
};

/**
 * Back or front bodice. Bottom-up: shoulder slope in bind-off steps up to the neck width.
 * Top-down: the shoulders are cast on either side of the neck and the slope is worked in short rows.
 * The front carries bust shaping (short rows by default) and takes the bust width at its side seams.
 */
export function bodice(kind: 'back' | 'front', opts: TemplateOptions = {}): Panel {
  const direction = opts.direction ?? 'bottom-up';
  const shape = opts.neckline ?? 'round';
  const neck = kind === 'back' ? { width: 'neck_width', depth: 'back_neck_depth', centre: 'neck_width - 2', top: 'neck_width' } : FRONT_NECKS[shape];
  const p = newPanel(kind === 'back' ? 'Back' : 'Front');
  p.template = kind;
  p.direction = direction;
  p.rounding.parity = 'even'; // keeps both edges shaping in pairs
  const shift = kind === 'back' ? '- waist_shift' : '+ waist_shift';

  const hem = newWaypoint('hem', 0, '(waist + full_hip) / 4 + ease / 2');
  const waist = newWaypoint('waist', 'hem_to_waist', `waist / 2 + ease / 2 ${shift}`);
  const underarm = newWaypoint('underarm', 'hem_to_waist + waist_to_armhole', kind === 'front' ? 'upper_chest / 2 + ease / 2 + bust_side_w' : 'upper_chest / 2 + ease / 2');
  // Underarm bind-off in one go ("bind off X sts at the beginning of the next 2 rows"), then armhole decreases.
  // The front carries the bust width to the underarm, so it binds off more and shapes over a longer span.
  const front = kind === 'front';
  const bo = newWaypoint('armhole_bo', 'underarm.height + 2 * row_h', `underarm.width - (underarm.width - armhole_end.width) * ${front ? 0.5 : 0.4}`);
  const end = newWaypoint('armhole_end', front ? 'underarm.height + armhole_depth * 0.6' : 'underarm.height + armhole_depth * 0.45', 'cross_chest_back + 1');
  const shoulder = newWaypoint('shoulder', 'underarm.height + armhole_depth', 'armhole_end.width');
  p.waypoints = [hem, waist, underarm, bo, end, shoulder];
  p.segments = [
    newSegment(hem.id),
    newSegment(waist.id),
    newSegment(underarm.id, { kind: 'steps', steps: null, maxPerStep: 99, align: 'start' }),
    newSegment(bo.id, { ...defaultAutoMethod(), side: 'any', align: 'start', order: 'shortFirst' }),
    newSegment(end.id, { kind: 'straight' }),
  ];
  const top = newWaypoint('neck_side', 'shoulder.height + shoulder_slope', neck.top);
  p.waypoints.push(top);
  p.segments.push(
    newSegment(
      shoulder.id,
      direction === 'bottom-up' ? { kind: 'steps', steps: null, maxPerStep: 8, align: 'end' } : { kind: 'shortrows', steps: null, maxPerStep: 8, style: 'german', align: 'end' },
    ),
  );
  if (kind === 'front') p.bust = defaultBust();
  p.neckline = { shape: kind === 'back' ? 'round' : shape, width: dim(neck.width), depth: dim(neck.depth), centre: 'bindoff', centreWidth: dim(neck.centre), side: 'rs' };
  if (opts.joinInRound) p.joinAt = underarm.id;
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

export function sleeve(type: SleeveType = 'set-in', direction: KnitDirection = 'bottom-up'): Panel {
  const p = newPanel(type === 'set-in' ? 'Sleeve' : type === 'drop' ? 'Sleeve (drop shoulder)' : 'Sleeve (straight)');
  p.template = `sleeve-${type}`;
  p.direction = direction;
  p.rounding.parity = 'even';
  const cuff = newWaypoint('cuff', 0, type === 'straight' ? 'bicep + ease.bicep' : 'wrist + ease.wrist');
  if (type === 'set-in') {
    // Bell-shaped cap: bind off to match the body's armhole bind-off, decrease fast, then steadily, then fast
    // again, and bind off the top. Decreases may fall on any row: caps are steep.
    const underarm = newWaypoint('underarm', 'arm_length', 'bicep + ease.bicep');
    const bo = newWaypoint('cap_bo', 'underarm.height + 2 * row_h', 'underarm.width - 0.4 * (upper_chest / 2 + ease / 2 - cross_chest_back - 1)');
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
  return p;
}

// ---------- others ----------

export function rectangle(direction: KnitDirection = 'bottom-up'): Panel {
  const p = newPanel('Rectangle');
  p.template = 'rectangle';
  p.direction = direction;
  p.waypoints = [newWaypoint('bottom', 0, 20), newWaypoint('top', 30, 20)];
  p.segments = [newSegment(p.waypoints[0].id, { kind: 'straight' })];
  return p;
}

export function neckband(): Panel {
  const p = newPanel('Neckband');
  p.template = 'neckband';
  const length = 'neck_width * 2 + front_neck_depth * 2';
  p.waypoints = [newWaypoint('pick_up', 0, length), newWaypoint('bind_off', 2.5, length)];
  p.segments = [newSegment(p.waypoints[0].id, { kind: 'straight' })];
  p.pattern = { name: '1x1 rib', multiple: 2, offset: 0 };
  p.sections = [{ id: newId('sec'), name: 'Rib', fromHeight: dim(0), toHeight: dim('bind_off.height'), pattern: { name: '1x1 rib', multiple: 2, offset: 0 } }];
  p.notes = 'Length is a starting estimate. The pick-up helper gives the real neckline length.';
  return p;
}

export function fromTemplate(id: TemplateId, opts: TemplateOptions = {}): Panel {
  switch (id) {
    case 'back':
      return bodice('back', opts);
    case 'front':
      return bodice('front', opts);
    case 'sleeve':
      return sleeve(opts.sleeve, opts.direction);
    case 'neckband':
      return neckband();
    default:
      return rectangle(opts.direction);
  }
}
