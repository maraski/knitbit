// The garment's choices read back from its pieces (garmentChoice), and the lists the New garment dialog and the
// Garment tab offer. Kept apart from garmentSetup.ts, which builds the pieces: the startup screen only reads choices,
// and the builders bring in the yoke generators (loaded on demand).

import type { EaseSettings, EdgeTreatments, FrontOpening, NecklineShape, Panel, Project, SleeveLength, YokeSpec } from './model';
import { sleeveLengthOf, SLEEVE_LENGTHS } from './sleeveLength';
import { sleeveLengthsFor, type SleeveType, type TemplateId } from './templates';

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
  // The raglans' only (necklinesFor): the selects filter the list by method and front.
  { id: 'off-shoulder', label: 'Off-shoulder' },
];

export const necklineLabel = (shape: NecklineShape) => NECKLINES.find((n) => n.id === shape)?.label ?? shape;

/** What the raglan methods do with an off-shoulder neckline (their descriptions are about the neck). */
export function offShoulderNote(method: GarmentMethod | 'custom'): string {
  if (method === 'raglan') return 'Off-shoulder: raglan lines from a rib band below the shoulders, the band level all round.';
  if (method === 'modified-raglan') return 'Off-shoulder: raglan lines from a rib band below the shoulders, the back raised with short rows.';
  return '';
}

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

/**
 * Necklines each method can make: the whole-neck start's short rows can't make a V's depth; off-shoulder is the
 * raglans' only (a pullover only, for now).
 */
export function necklinesFor(method: GarmentMethod | 'custom', opening: FrontOpening = 'closed'): NecklineShape[] {
  const all = NECKLINES.map((n) => n.id).filter((n) => n !== 'off-shoulder');
  const os: NecklineShape[] = (method === 'raglan' || method === 'modified-raglan') && opening !== 'cardigan' ? ['off-shoulder'] : [];
  return [...(method === 'modified-raglan' ? all.filter((n) => n !== 'v') : all), ...os];
}

/** A neckline the method can make: `shape`, or round. */
export const necklineFor = (method: GarmentMethod | 'custom', shape: NecklineShape, opening: FrontOpening = 'closed'): NecklineShape => (necklinesFor(method, opening).includes(shape) ? shape : 'round');

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

export const isBodice = (p: Panel) => p.template === 'back' || p.template === 'front';
export const isSleeve = (p: Panel) => (p.template ?? '').startsWith('sleeve');
/** Pieces the method makes, and a method change replaces: bodices, sleeves, the yoke and what continues from it. */
export const isGarmentPiece = (p: Panel) => isBodice(p) || isSleeve(p) || !!p.yoke || !!p.fromYoke;

/** The garment's choices, read from its pieces (works for projects made before the New garment dialog). */
export function garmentChoice(p: Project): GarmentChoice {
  const opening = p.garment.opening;
  if (p.garment.construction === 'contiguous') {
    const y = p.panels.find((x) => x.yoke)?.yoke;
    // An off-shoulder yoke is always a raglan's; raising the back is what the Modified card does.
    const method: YokeMethod = y?.style === 'raglan' ? (y.neck.shape === 'off-shoulder' && offShoulderRaised(y) ? 'modified-raglan' : 'raglan') : y?.start === 'neck' ? 'modified-raglan' : 'contiguous';
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

/** An off-shoulder yoke whose back is raised (read back as the Modified raglan): any back raise other than 0. */
export function offShoulderRaised(spec: YokeSpec): boolean {
  const e = spec.offShoulder?.backRaise.expr.trim() ?? '';
  return e !== '' && Number(e) !== 0;
}

/** Single pieces the Pieces tab offers for a method (whole-garment sets come from the method instead). */
export function extraPieces(method: GarmentChoice['method']): TemplateId[] {
  if (isYokeMethod(method)) return ['rectangle', 'neckband'];
  return ['sleeve', 'back', 'front', 'rectangle', 'neckband'];
}

export type YokeRole = NonNullable<Panel['fromYoke']>;
export const YOKE_ROLES: YokeRole[] = ['back', 'front', 'leftSleeve', 'rightSleeve'];

/** Which body and sleeve panels the yoke still lacks (contiguousGarment.ts makes them). */
export function missingYokePanels(project: Project): YokeRole[] {
  const have = new Set(project.panels.map((p) => p.fromYoke).filter(Boolean));
  // A cardigan's front is a pair; either half counts.
  return YOKE_ROLES.filter((r) => !have.has(r));
}
