// Starting a garment: the construction method, front, neckline and sleeve chosen together (New garment dialog,
// Garment tab), and the pieces, joins and edge defaults each choice makes. Nothing new is stored: the choices are
// read back from the pieces (garmentChoice), so older projects show their method without a migration.

import { defaultYoke, yokePanel } from './contiguous';
import { generateBodyAndSleeves } from './contiguousGarment';
import { applyEdgeTreatments } from './edgeTreatments';
import { ensureEstimates } from './estimates';
import { conformToGarment, setConstruction } from './garment';
import { dropPanelFromJoins } from './joins';
import type { EaseSettings, EdgeRef, EdgeTreatments, FrontOpening, Join, NecklineShape, Panel, Project, SleeveLength, YokeSpec } from './model';
import { dim, newId } from './model';
import { sleeveLengthNeeds, sleeveLengthOf, SLEEVE_LENGTHS, sleeveName, withSleeveLength } from './sleeveLength';
import { bodice, FRONT_NECKS, sleeve, sleeveLengthsFor, TEMPLATE_MEASUREMENTS, topDownTop, type SleeveType, type TemplateId } from './templates';

/** How the garment is built. 'blank' makes no pieces (drawn by hand); a project without bodices reads as 'custom'. */
export type GarmentMethod = 'seamed' | 'top-down' | 'contiguous' | 'blank';
export type SleeveChoice = SleeveType | 'contiguous' | 'none';

export const METHODS: { id: GarmentMethod; label: string; short: string; description: string }[] = [
  { id: 'seamed', label: 'Seamed panels, bottom-up', short: 'Seamed panels', description: 'Back, front and sleeves knit flat from the hem up and sewn together.' },
  { id: 'top-down', label: 'Top-down, shoulders first', short: 'Top-down', description: 'Back cast on at the shoulders, fronts picked up from it, joined at the underarms and knit down in the round.' },
  { id: 'contiguous', label: 'Contiguous yoke, top-down', short: 'Contiguous', description: 'One piece from the neck with set-in-look sleeves (Susie Myers’ contiguous method); body and sleeves continue from the yoke.' },
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
  { id: 'none', label: 'None (sleeveless)' },
];

/** Sleeves each method can make. */
export function sleevesFor(method: GarmentMethod | 'custom'): SleeveChoice[] {
  if (method === 'contiguous') return ['contiguous'];
  if (method === 'blank') return [];
  return ['set-in', 'drop', 'straight', 'none'];
}

/** Lengths a sleeve type can be made in, longest first (a cap needs a cap: set-in or contiguous). */
export function lengthsFor(sleeve: SleeveChoice): SleeveLength[] {
  if (sleeve === 'none') return [];
  return sleeve === 'contiguous' ? SLEEVE_LENGTHS.map((l) => l.id).reverse() : sleeveLengthsFor(sleeve);
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
    const y = p.panels.find((x) => x.yoke);
    const ys = p.panels.find((x) => x.fromYoke === 'leftSleeve' || x.fromYoke === 'rightSleeve');
    return { method: 'contiguous', opening, neckline: y?.yoke!.neck.shape ?? 'round', sleeve: 'contiguous', sleeveLength: ys ? sleeveLengthOf(ys) : 'long' };
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
  if (choice === 'none' || choice === 'contiguous') return null;
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
    back = bodice('back', { direction: 'bottom-up' });
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
  if (method === 'contiguous') {
    const q = ensureEstimates(p, TEMPLATE_MEASUREMENTS.yoke).project;
    return generateBodyAndSleeves({ ...q, panels: [...q.panels, yokePanel(neckline)] }, notes, length);
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
  const construction = spec.method === 'contiguous' ? 'contiguous' : 'panels';
  let p: Project = setConstruction({ ...base, panels: [], joins: [], garment: { construction: base.garment.construction, opening: spec.opening } }, construction);
  p = { ...p, ease: withEasePreset(p.ease, spec.ease), edges: spec.edges ? structuredClone(spec.edges) : undefined, cardigan: undefined };
  p = addPieces(p, spec.method, spec.neckline, spec.sleeve, lengthFor(spec.sleeve, spec.sleeveLength ?? 'long'), []);
  return p.edges ? applyEdgeTreatments(p, [], { create: true }) : p;
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
  q = setConstruction(q, method === 'contiguous' ? 'contiguous' : 'panels');
  const sleeveChoice = sleevesFor(method).includes(now.sleeve) ? now.sleeve : method === 'contiguous' ? 'contiguous' : 'set-in';
  const length = lengthFor(sleeveChoice, now.sleeveLength);
  const added: string[] = [];
  q = addPieces(q, method, now.neckline, sleeveChoice, length, added);
  const fresh = q.panels.filter((x) => !p.panels.some((o) => o.id === x.id));
  const kept = q.panels.filter((x) => p.panels.some((o) => o.id === x.id));
  q = { ...q, panels: [...fresh, ...kept] }; // the garment first, as a new garment lists it
  if (old.length) notes.push(`Replaces ${old.map((x) => x.name).join(', ')}.`);
  if (fresh.length) notes.push(`Adds ${fresh.map((x) => x.name).join(', ')}.`);
  if (kept.length) notes.push(`Keeps ${kept.map((x) => x.name).join(', ')}.`);
  if (sleeveChoice !== now.sleeve && now.sleeve !== 'none') notes.push(`Sleeves become ${SLEEVES.find((s) => s.id === sleeveChoice)!.label.toLowerCase()}: this method has no ${SLEEVES.find((s) => s.id === now.sleeve)!.label.toLowerCase()}.`);
  if (length !== now.sleeveLength && now.sleeve !== 'none') notes.push(`Sleeves become ${lengthLabel(length)}: these sleeves can’t be ${lengthLabel(now.sleeveLength)}.`);
  notes.push('Sizes, gauge, ease and edge settings stay. Undo goes back.');
  return q.edges ? applyEdgeTreatments(q) : q;
}

/**
 * A yoke with another neck shape: the neck takes the new shape's defaults, and any other setting still at the old
 * shape's default follows the new shape's default (settings you changed are kept).
 */
function yokeWithNeck(yoke: YokeSpec, shape: NecklineShape): YokeSpec {
  const before = defaultYoke(yoke.neck.shape) as unknown as Record<string, unknown>;
  const after = defaultYoke(shape) as unknown as Record<string, unknown>;
  const next = { ...yoke } as unknown as Record<string, unknown>;
  for (const k of Object.keys(after)) if (JSON.stringify(next[k]) === JSON.stringify(before[k])) next[k] = after[k];
  return { ...(next as unknown as YokeSpec), neck: { ...yoke.neck, ...defaultYoke(shape).neck } };
}

/** The front neckline (fronts and the yoke) set to a shape's defaults; the back is unchanged. */
export function setNeckline(p: Project, shape: NecklineShape): Project {
  const n = FRONT_NECKS[shape];
  const panels = p.panels.map((x): Panel => {
    if (x.yoke) return { ...x, yoke: yokeWithNeck(x.yoke, shape) };
    if (x.template !== 'front' || !x.neckline) return x;
    return { ...x, neckline: { ...x.neckline, shape, width: dim(n.width), depth: dim(n.depth), centreWidth: dim(n.centre) } };
  });
  return { ...p, panels };
}

/** Replace the sleeve panels (not a contiguous yoke's) with another type; 'none' removes them. */
export function setSleeve(p: Project, choice: SleeveChoice, notes: string[] = []): Project {
  const c = garmentChoice(p);
  if (c.method === 'contiguous' || choice === c.sleeve) return p;
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
  if (method === 'contiguous') return ['rectangle', 'neckband'];
  return ['sleeve', 'back', 'front', 'rectangle', 'neckband'];
}
