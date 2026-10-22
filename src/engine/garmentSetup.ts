// Starting a garment: the construction method, front, neckline and sleeve chosen together (New garment dialog,
// Garment tab), and the pieces, joins and edge defaults each choice makes. Nothing new is stored: the choices are
// read back from the pieces (garmentChoice), so older projects show their method without a migration.

import { yokePanel, yokeWithNeck } from './contiguous';
import { raglanPanel } from './raglan';
import { generateBodyAndSleeves } from './contiguousGarment';
import { applyEdgeTreatments } from './edgeTreatments';
import { ensureEstimates } from './estimates';
import { conformToGarment, CONTIGUOUS_TAG, RAGLAN_TAG, setConstruction } from './garment';
import { dropPanelFromJoins } from './joins';
import type { EaseSettings, EdgeRef, EdgeTreatments, FrontOpening, Join, NecklineShape, Panel, Project, SleeveLength } from './model';
import { dim, newId } from './model';
import { sleeveLengthNeeds, sleeveLengthOf, SLEEVE_LENGTHS, sleeveName, withSleeveLength } from './sleeveLength';
import { backNeckFor, bodice, FRONT_NECKS, sleeve, sleeveLengthsFor, TEMPLATE_MEASUREMENTS, topDownTop, type SleeveType, type TemplateId } from './templates';

/**
 * How the garment is built. 'blank' makes no pieces (drawn by hand); a project without bodices reads as 'custom'.
 * The yoke methods (contiguous, raglan, modified raglan) are all a top-down yoke (construction 'contiguous'); which
 * one is read from the yoke: a raglan yoke, or a contiguous yoke started with the whole neck (modified raglan).
 */
export type GarmentMethod = 'seamed' | 'top-down' | 'contiguous' | 'raglan' | 'modified-raglan' | 'blank';
export type SleeveChoice = SleeveType | 'contiguous' | 'raglan' | 'none';
export type YokeMethod = 'contiguous' | 'raglan' | 'modified-raglan';

export const isYokeMethod = (m: GarmentMethod | 'custom'): m is YokeMethod => m === 'contiguous' || m === 'raglan' || m === 'modified-raglan';

/** Methods; those with a `group` are shown as one card with a choice between them (New garment dialog). */
export const METHODS: { id: GarmentMethod; label: string; short: string; description: string; group?: { id: 'raglan'; label: string; choice: string } }[] = [
  { id: 'seamed', label: 'Seamed panels, bottom-up', short: 'Seamed panels', description: 'Back, front and sleeves knit flat from the hem up and sewn together.' },
  { id: 'top-down', label: 'Top-down, shoulders first', short: 'Top-down', description: 'Back cast on at the shoulders, fronts picked up from it, joined at the underarms and knit down in the round.' },
  { id: 'contiguous', label: 'Contiguous yoke, top-down', short: 'Contiguous', description: 'One piece from the back neck with set-in-look sleeves (Susie Myers’ contiguous method); body and sleeves continue from the yoke.' },
  {
    id: 'raglan',
    label: 'Raglan, top-down',
    short: 'Raglan',
    description: 'One piece from the neck with four raglan lines to the underarms; body and sleeves continue from the yoke.',
    group: { id: 'raglan', label: 'Raglan, top-down', choice: 'Classic' },
  },
  {
    id: 'modified-raglan',
    label: 'Modified raglan, top-down',
    short: 'Modified raglan',
    description: 'The whole neck cast on and short rows raising the back (PetiteKnit style), then shoulder and sleeve-cap increases; body and sleeves continue from the yoke.',
    group: { id: 'raglan', label: 'Raglan, top-down', choice: 'Modified' },
  },
  { id: 'blank', label: 'Start from blank', short: 'Custom', description: 'No pieces yet: add and draw your own.' },
];

export const NECKLINES: { id: NecklineShape; label: string }[] = [
  { id: 'round', label: 'Round' },
  { id: 'v', label: 'V' },
  { id: 'square', label: 'Square' },
  { id: 'boat', label: 'Boat' },
];

export const SLEEVES: { id: SleeveChoice; label: string }[] = [
  { id: 'set-in', label: 'Set-in cap' },
  { id: 'drop', label: 'Drop shoulder' },
  { id: 'straight', label: 'Straight' },
  { id: 'contiguous', label: 'Contiguous (set-in look)' },
  { id: 'raglan', label: 'Raglan' },
  { id: 'none', label: 'None (sleeveless)' },
];

/** Sleeves each method can make. */
export function sleevesFor(method: GarmentMethod | 'custom'): SleeveChoice[] {
  if (method === 'raglan') return ['raglan'];
  if (isYokeMethod(method)) return ['contiguous'];
  if (method === 'blank') return [];
  return ['set-in', 'drop', 'straight', 'none'];
}

/** Necklines each method can make: the whole-neck start's short rows can't make a V's depth. */
export function necklinesFor(method: GarmentMethod | 'custom'): NecklineShape[] {
  const all = NECKLINES.map((n) => n.id);
  return method === 'modified-raglan' ? all.filter((n) => n !== 'v') : all;
}

/** A neckline the method can make: `shape`, or round. */
const necklineFor = (method: GarmentMethod | 'custom', shape: NecklineShape): NecklineShape => (necklinesFor(method).includes(shape) ? shape : 'round');

/** Lengths a sleeve type can be made in, longest first (a cap needs a cap: set-in, or a yoke's sleeves). */
export function lengthsFor(sleeve: SleeveChoice): SleeveLength[] {
  if (sleeve === 'none') return [];
  // A yoke's sleeves (contiguous or raglan) come from its held stitches, so they can be any length.
  return sleeve === 'contiguous' || sleeve === 'raglan' ? SLEEVE_LENGTHS.map((l) => l.id).reverse() : sleeveLengthsFor(sleeve);
}

/** `length` if the sleeve can have it; else the nearest it can (a cap becomes short), long without one. */
export function lengthFor(sleeve: SleeveChoice, length: SleeveLength): SleeveLength {
  const ok = lengthsFor(sleeve);
  return ok.includes(length) ? length : length === 'cap' && ok.includes('short') ? 'short' : 'long';
}

export type EasePresetId = 'close' | 'standard' | 'relaxed' | 'oversized';

/** Total circumference ease, plus bicep and wrist ease (the other `ease.*` names keep following the total). */
export const EASE_PRESETS: { id: EasePresetId; label: string; global: number; bicep: number; wrist: number }[] = [
  { id: 'close', label: 'Close fitting', global: 0, bicep: 2.5, wrist: 2.5 },
  { id: 'standard', label: 'Standard', global: 5, bicep: 5, wrist: 5 },
  { id: 'relaxed', label: 'Relaxed', global: 10, bicep: 7.5, wrist: 5 },
  { id: 'oversized', label: 'Oversized', global: 20, bicep: 12, wrist: 5 },
];

export function withEasePreset(ease: EaseSettings, id: EasePresetId): EaseSettings {
  const e = EASE_PRESETS.find((x) => x.id === id)!;
  const per = { ...ease.per, bicep: e.bicep, wrist: e.wrist };
  return { global: e.global, per };
}

/** The preset the project's ease matches, or null (set by hand). */
export function easePresetOf(ease: EaseSettings): EasePresetId | null {
  const at = (name: string) => ease.per[name] ?? ease.global;
  return EASE_PRESETS.find((e) => e.global === ease.global && at('bicep') === e.bicep && at('wrist') === e.wrist)?.id ?? null;
}

/** What the New garment dialog asks. */
export interface GarmentSpec {
  method: GarmentMethod;
  opening: FrontOpening;
  neckline: NecklineShape;
  sleeve: SleeveChoice;
  /** Absent = long. */
  sleeveLength?: SleeveLength;
  ease: EasePresetId;
  /** Hem, cuff, neckband and front bands; absent = leave the project's settings (not applied yet). */
  edges?: EdgeTreatments;
}

export interface GarmentChoice {
  method: Exclude<GarmentMethod, 'blank'> | 'custom';
  opening: FrontOpening;
  neckline: NecklineShape;
  sleeve: SleeveChoice;
  /** The sleeves' length ('long' for old projects and without sleeves). */
  sleeveLength: SleeveLength;
}

const isBodice = (p: Panel) => p.template === 'back' || p.template === 'front';
const isSleeve = (p: Panel) => (p.template ?? '').startsWith('sleeve');
/** Pieces the method makes, and a method change replaces: bodices, sleeves, the yoke and what continues from it. */
export const isGarmentPiece = (p: Panel) => isBodice(p) || isSleeve(p) || !!p.yoke || !!p.fromYoke;

/** The garment's choices, read from its pieces (works for projects made before the New garment dialog). */
export function garmentChoice(p: Project): GarmentChoice {
  const opening = p.garment.opening;
  if (p.garment.construction === 'contiguous') {
    const y = p.panels.find((x) => x.yoke)?.yoke;
    const method: YokeMethod = y?.style === 'raglan' ? 'raglan' : y?.start === 'neck' ? 'modified-raglan' : 'contiguous';
    const ys = p.panels.find((x) => x.fromYoke === 'leftSleeve' || x.fromYoke === 'rightSleeve');
    return { method, opening, neckline: y?.neck.shape ?? 'round', sleeve: method === 'raglan' ? 'raglan' : 'contiguous', sleeveLength: ys ? sleeveLengthOf(ys) : 'long' };
  }
  const bodices = p.panels.filter(isBodice);
  const front = bodices.find((x) => x.template === 'front' && x.neckline);
  const sl = p.panels.find((x) => isSleeve(x) && !x.fromYoke);
  const type = (sl?.template ?? '').replace('sleeve-', '');
  return {
    method: !bodices.length ? 'custom' : bodices.some((x) => x.direction === 'top-down') ? 'top-down' : 'seamed',
    opening,
    neckline: front?.neckline!.shape ?? 'round',
    sleeve: type === 'set-in' || type === 'drop' || type === 'straight' ? type : 'none',
    sleeveLength: sl ? sleeveLengthOf(sl) : 'long',
  };
}

/** "Contiguous · cardigan": the method and front, shown by the project name. */
export function garmentLabel(p: Project): string {
  const c = garmentChoice(p);
  return `${METHODS.find((m) => m.id === (c.method === 'custom' ? 'blank' : c.method))!.short} · ${c.opening === 'cardigan' ? 'cardigan' : 'pullover'}`;
}

// ---------- pieces ----------

const wp = (p: Panel, name: string) => p.waypoints.find((w) => w.name === name)!.id;
const side = (p: Panel, s: 'left' | 'right', from: string, to: string): EdgeRef => ({ panelId: p.id, edge: { kind: 'side', side: s, from: wp(p, from), to: wp(p, to) } });
const seam = (name: string, edges: EdgeRef[], partner: EdgeRef[], note: string): Join => ({ id: newId('join'), name, tag: 'seam', edges, partner, ratio: null, note });

function sleeveFor(choice: SleeveChoice, method: GarmentChoice['method'], length: SleeveLength): Panel | null {
  if (choice === 'none' || choice === 'contiguous' || choice === 'raglan') return null;
  return sleeve(choice, method === 'top-down' ? 'top-down' : 'bottom-up', lengthFor(choice, length));
}

/** Measurements the garment's sleeves need at `length` (template estimates plus the length's own). */
const sleeveNeeds = (length: SleeveLength) => [...TEMPLATE_MEASUREMENTS.sleeve, ...sleeveLengthNeeds(length)];

/** The pieces and joins a panel method makes (whole front; the opening is applied afterwards). */
function panelPieces(method: 'seamed' | 'top-down', neckline: NecklineShape, sleeveChoice: SleeveChoice, length: SleeveLength): { panels: Panel[]; joins: Join[]; templates: TemplateId[] } {
  let back: Panel;
  let front: Panel;
  const joins: Join[] = [];
  if (method === 'top-down') {
    const top = topDownTop({ neckline, joinInRound: true, shoulderSlope: 'shortrows', backNeck: 'straight' });
    [back, front] = top.panels;
    joins.push(...top.joins);
  } else {
    back = bodice('back', { direction: 'bottom-up', neckline });
    front = bodice('front', { direction: 'bottom-up', neckline });
    joins.push(
      // One join per side (as worn): the front's left edge meets the back's right edge, seen from the RS.
      seam('Left side seam', [side(front, 'right', 'hem', 'underarm')], [side(back, 'left', 'hem', 'underarm')], 'Mattress stitch, hem to underarm.'),
      seam('Right side seam', [side(front, 'left', 'hem', 'underarm')], [side(back, 'right', 'hem', 'underarm')], 'Mattress stitch, hem to underarm.'),
      seam('Shoulder seams', [{ panelId: front.id, edge: { kind: 'top' } }], [{ panelId: back.id, edge: { kind: 'top' } }], 'Three-needle bind-off or sewn.'),
    );
  }
  const panels = [back, front];
  // No sleeve-cap seam: the cap is drafted with ease over the armhole, which a seam join would flag in every size.
  const sl = sleeveFor(sleeveChoice, method, length);
  if (sl) panels.push(sl);
  return { panels, joins, templates: sl ? ['back', 'front', 'sleeve'] : ['back', 'front'] };
}

/** Add the pieces of `method` to the project (its opening and edge settings applied). */
function addPieces(p: Project, method: GarmentMethod, neckline: NecklineShape, sleeveChoice: SleeveChoice, length: SleeveLength, notes: string[]): Project {
  if (method === 'blank') return p;
  if (isYokeMethod(method)) {
    const q = ensureEstimates(p, TEMPLATE_MEASUREMENTS.yoke).project;
    const shape = necklineFor(method, neckline);
    const yoke = method === 'raglan' ? raglanPanel(shape) : yokePanel(shape, method === 'modified-raglan' ? 'neck' : 'back');
    return generateBodyAndSleeves({ ...q, panels: [...q.panels, yoke] }, notes, length);
  }
  const set = panelPieces(method, neckline, sleeveChoice, length);
  const names = set.templates.flatMap((t) => (t === 'sleeve' ? sleeveNeeds(length) : TEMPLATE_MEASUREMENTS[t]));
  const q = ensureEstimates(p, [...new Set(names)]).project;
  return conformToGarment({ ...q, panels: [...q.panels, ...set.panels], joins: [...(q.joins ?? []), ...set.joins] }, notes);
}

/**
 * A new garment on `base`'s sizes, measurements and gauge: its pieces replaced by those of `spec`, with the
 * opening, ease preset and edge treatments set (the neckband and band strips made when the edges call for them).
 */
export function buildGarment(base: Project, spec: GarmentSpec): Project {
  const construction = isYokeMethod(spec.method) ? 'contiguous' : 'panels';
  let p: Project = setConstruction({ ...base, panels: [], joins: [], garment: { construction: base.garment.construction, opening: spec.opening } }, construction);
  p = withMethodTags(p, spec.method);
  p = { ...p, ease: withEasePreset(p.ease, spec.ease), edges: spec.edges ? structuredClone(spec.edges) : undefined, cardigan: undefined };
  p = addPieces(p, spec.method, spec.neckline, spec.sleeve, lengthFor(spec.sleeve, spec.sleeveLength ?? 'long'), []);
  return p.edges ? applyEdgeTreatments(p, [], { create: true }) : p;
}

/** Tags the method adds: "contiguous" for the contiguous yoke, "raglan" for both raglans (each removed again when
 * switching away, as construction tags are). */
function withMethodTags(p: Project, method: GarmentMethod): Project {
  const tag = method === 'contiguous' ? CONTIGUOUS_TAG : method === 'raglan' || method === 'modified-raglan' ? RAGLAN_TAG : null;
  const tags = p.tags.filter((t) => t !== CONTIGUOUS_TAG && t !== RAGLAN_TAG);
  return { ...p, tags: tag ? [...tags, tag] : tags };
}

/**
 * Switch an existing garment to another method: its bodices, sleeves and yoke are replaced by the new method's
 * pieces (neckline and sleeve kept where the new method has them); other pieces, sizes, gauge, ease and edge
 * settings stay. `notes` says what changed. One project → one undo step.
 */
export function changeMethod(p: Project, method: Exclude<GarmentMethod, 'blank'>, notes: string[] = []): Project {
  const now = garmentChoice(p);
  if (now.method === method) return p;
  const old = p.panels.filter(isGarmentPiece);
  let joins = p.joins ?? [];
  for (const x of old) joins = dropPanelFromJoins(joins, x.id);
  let q: Project = { ...p, panels: p.panels.filter((x) => !isGarmentPiece(x)), joins };
  q = withMethodTags(setConstruction(q, isYokeMethod(method) ? 'contiguous' : 'panels'), method);
  const sleeveChoice = sleevesFor(method).includes(now.sleeve) ? now.sleeve : isYokeMethod(method) ? sleevesFor(method)[0] : 'set-in';
  const length = lengthFor(sleeveChoice, now.sleeveLength);
  const added: string[] = [];
  q = addPieces(q, method, now.neckline, sleeveChoice, length, added);
  const fresh = q.panels.filter((x) => !p.panels.some((o) => o.id === x.id));
  const kept = q.panels.filter((x) => p.panels.some((o) => o.id === x.id));
  q = { ...q, panels: [...fresh, ...kept] }; // the garment first, as a new garment lists it
  if (old.length) notes.push(`Replaces ${old.map((x) => x.name).join(', ')}.`);
  if (fresh.length) notes.push(`Adds ${fresh.map((x) => x.name).join(', ')}.`);
  if (kept.length) notes.push(`Keeps ${kept.map((x) => x.name).join(', ')}.`);
  // Between yoke methods the sleeves are part of the method: no note.
  if (sleeveChoice !== now.sleeve && now.sleeve !== 'none' && !isYokeMethod(now.method)) notes.push(`Sleeves become ${SLEEVES.find((s) => s.id === sleeveChoice)!.label.toLowerCase()}: this method has no ${SLEEVES.find((s) => s.id === now.sleeve)!.label.toLowerCase()}.`);
  if (length !== now.sleeveLength && now.sleeve !== 'none') notes.push(`Sleeves become ${lengthLabel(length)}: these sleeves can’t be ${lengthLabel(now.sleeveLength)}.`);
  if (necklineFor(method, now.neckline) !== now.neckline) notes.push(`The neckline becomes round: this method has no ${NECKLINES.find((n) => n.id === now.neckline)!.label} neck.`);
  notes.push('Sizes, gauge, ease and edge settings stay. Undo goes back.');
  return q.edges ? applyEdgeTreatments(q) : q;
}

/**
 * The neckline (fronts, backs and the yoke) set to a shape's defaults. The front takes the shape; the back takes
 * its matching back neck (a boat neck's wide back, a round back neck otherwise; a straight back stays straight),
 * and both tops follow the opening so the shoulder seams match.
 */
export function setNeckline(p: Project, shape: NecklineShape): Project {
  const panels = p.panels.map((x): Panel => {
    if (x.yoke) return { ...x, yoke: yokeWithNeck(x.yoke, shape) };
    if (!isBodice(x)) return x;
    const n = x.template === 'front' ? { ...FRONT_NECKS[shape], shape } : backNeckFor(shape);
    const neckline = x.neckline && { ...x.neckline, shape: n.shape, width: dim(n.width), depth: dim(n.depth), centreWidth: dim(n.centre) };
    const waypoints = x.waypoints.map((w) => (w.name === 'neck_side' ? { ...w, height: dim(`shoulder.height + ${n.rise}`), width: dim(n.top) } : w));
    return { ...x, neckline, waypoints };
  });
  return { ...p, panels };
}

/** Replace the sleeve panels (not a contiguous yoke's) with another type; 'none' removes them. */
export function setSleeve(p: Project, choice: SleeveChoice, notes: string[] = []): Project {
  const c = garmentChoice(p);
  if (isYokeMethod(c.method) || choice === c.sleeve) return p;
  const old = p.panels.filter((x) => isSleeve(x) && !x.fromYoke);
  // Joins made for the old sleeves (cap seams…) go with them.
  const joins = (p.joins ?? []).filter((j) => ![...j.edges, ...j.partner].some((r) => old.some((x) => x.id === r.panelId)));
  let q: Project = { ...p, panels: p.panels.filter((x) => !old.includes(x)), joins };
  const length = lengthFor(choice, c.sleeveLength);
  const sl = sleeveFor(choice, c.method, length);
  if (sl) {
    q = ensureEstimates(q, sleeveNeeds(length)).project;
    q = { ...q, panels: [...q.panels, sl] };
  }
  if (old.length) notes.push(`Replaces ${old.map((x) => x.name).join(', ')}.`);
  if (sl) notes.push(`Adds ${sl.name}.`);
  if (sl && length !== c.sleeveLength && c.sleeve !== 'none') notes.push(`${SLEEVES.find((s) => s.id === choice)!.label} sleeves can’t be ${lengthLabel(c.sleeveLength)}: made ${lengthLabel(length)}.`);
  return conformToGarment(q);
}

/** The sleeve templates' long-sleeve names (a sleeve still called one of these, with its length, is renamed). */
const SLEEVE_BASE_NAMES = ['Sleeve', 'Sleeve (drop shoulder)', 'Sleeve (straight)'];

const lengthLabel = (l: SleeveLength) => (l === 'cap' ? 'cap sleeves' : SLEEVE_LENGTHS.find((x) => x.id === l)!.label.toLowerCase());

/**
 * All the garment's sleeves (a contiguous yoke's too) at another length: underarm height and cuff width set from
 * it, everything else kept; a sleeve still named for its old length is renamed. Sleeves redrawn by hand are left.
 */
export function setSleeveLength(p: Project, length: SleeveLength, notes: string[] = []): Project {
  const c = garmentChoice(p);
  const to = lengthFor(c.sleeve, length);
  if (c.sleeve === 'none' || to !== length) return p;
  const skipped: string[] = [];
  const changed: string[] = [];
  const panels = p.panels.map((x) => {
    if (!isSleeve(x) || sleeveLengthOf(x) === length) return x;
    const next = withSleeveLength(x, length);
    if (!next) {
      skipped.push(x.name);
      return x;
    }
    const base = x.name.replace(new RegExp(`^${SLEEVE_LENGTHS.find((l) => l.id === sleeveLengthOf(x))!.prefix} (.)`), (_, ch: string) => ch.toUpperCase());
    const renamed = SLEEVE_BASE_NAMES.includes(base) && sleeveName(base, sleeveLengthOf(x)) === x.name ? sleeveName(base, length) : x.name;
    changed.push(x.name);
    return { ...next, name: renamed };
  });
  if (changed.length) notes.push(`Sets ${changed.join(', ')} to ${lengthLabel(length)}: the underarm height and the cuff width follow; other edits are kept.`);
  if (skipped.length) notes.push(`Leaves ${skipped.join(', ')} as drawn (no cuff and underarm points to set).`);
  return ensureEstimates({ ...p, panels }, sleeveLengthNeeds(length)).project;
}

/** Single pieces the Pieces tab offers for a method (whole-garment sets come from the method instead). */
export function extraPieces(method: GarmentChoice['method']): TemplateId[] {
  if (isYokeMethod(method)) return ['rectangle', 'neckband'];
  return ['sleeve', 'back', 'front', 'rectangle', 'neckband'];
}
