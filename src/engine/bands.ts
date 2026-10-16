// Cardigan bands and buttons: the settings' defaults, the expression names they provide (band_w, band_overlap,
// closing_r), and button positions. Pure; depends only on the model and the expression evaluator.

import { evaluate, scopeFrom } from './expr';
import type { BandAttach, BandRole, CardiganOptions, Id, Project } from './model';
import { dim } from './model';

export const DEFAULT_CLOSING = '2 * band_w - band_overlap';

export function defaultCardigan(): CardiganOptions {
  return {
    bands: 'separate',
    attach: { button: 'pickup', buttonhole: 'pickup', continuous: 'pickup' },
    buttonholeSide: 'right',
    overlap: dim('band_w'),
    closing: dim(DEFAULT_CLOSING),
    buttons: { count: 7, top: dim(1.5), bottom: dim(2), manual: {} },
    buttonhole: { style: 'yo-k2tog', symbol: 'buttonhole', width: 2, note: '' },
  };
}

export function cardiganOf(project: Pick<Project, 'cardigan'>): CardiganOptions {
  return project.cardigan ?? defaultCardigan();
}

export const ATTACH_LABELS: Record<BandAttach, string> = {
  pickup: 'Picked up along the edge',
  sideways: 'Knit sideways as a strip, sewn on',
  integrated: 'Integrated: extra stitches at the front edge',
};

export const BAND_NAMES: Record<BandRole, string> = { button: 'Button band', buttonhole: 'Buttonhole band', continuous: 'Front band' };

/** The bands this project has (none unless it is a cardigan with front bands switched on). */
export function bandRoles(project: Pick<Project, 'garment' | 'edges' | 'cardigan'>): BandRole[] {
  if (project.garment.opening !== 'cardigan' || !project.edges?.frontBands.enabled) return [];
  return cardiganOf(project).bands === 'continuous' ? ['continuous'] : ['button', 'buttonhole'];
}

export function attachOf(project: Pick<Project, 'cardigan'>, role: BandRole): BandAttach {
  return cardiganOf(project).attach[role];
}

/** The band on a front: its role and how it is attached. `side` is the front as worn. */
export function bandOnFront(project: Pick<Project, 'garment' | 'edges' | 'cardigan'>, side: 'left' | 'right'): { role: BandRole; attach: BandAttach } | null {
  const roles = bandRoles(project);
  if (!roles.length) return null;
  const c = cardiganOf(project);
  const role: BandRole = c.bands === 'continuous' ? 'continuous' : side === c.buttonholeSide ? 'buttonhole' : 'button';
  return { role, attach: c.attach[role] };
}

export interface BandValues {
  band_w: number;
  band_overlap: number;
  closing_r: number;
  errors: string[];
}

function evalOne(expr: string, overrides: Record<Id, number>, sizeId: Id, scope: Record<string, number>, what: string, errors: string[]): number {
  if (sizeId in overrides) return overrides[sizeId];
  const r = evaluate(expr, scopeFrom(scope));
  if (r.ok) return r.value;
  errors.push(`${what}: ${r.error}`);
  return 0;
}

/**
 * `band_w` (front band width), `band_overlap` and `closing_r` (width taken off the whole front) for one size.
 * All zero when the project has no front bands; a cardigan without bands still uses its overlap and closing.
 */
export function bandValues(project: Project, sizeId: Id, base: Record<string, number>): BandValues {
  const errors: string[] = [];
  if (project.garment.opening !== 'cardigan') return { band_w: 0, band_overlap: 0, closing_r: 0, errors };
  const c = cardiganOf(project);
  const fb = project.edges?.frontBands;
  const band_w = fb?.enabled ? evalOne(fb.depth.expr, fb.depth.overrides, sizeId, base, 'Front band width', errors) : 0;
  const band_overlap = evalOne(c.overlap.expr, c.overlap.overrides, sizeId, { ...base, band_w }, 'Band overlap', errors);
  const closing_r = evalOne(c.closing.expr, c.closing.overrides, sizeId, { ...base, band_w, band_overlap }, 'Closing width', errors);
  return { band_w, band_overlap, closing_r, errors };
}

/**
 * Button positions in one size, cm up from the front's lower edge (top button first): evenly spaced between
 * `top` below the top of the front edge and `bottom` above the lower edge, unless dragged by hand in this size.
 */
export function buttonPositions(project: Project, sizeId: Id, edgeTopCm: number, scope: Record<string, number>): { positions: number[]; manual: boolean; errors: string[] } {
  const c = cardiganOf(project);
  const n = Math.max(0, Math.round(c.buttons.count));
  const manual = c.buttons.manual[sizeId];
  if (manual && manual.length === n) return { positions: [...manual], manual: true, errors: [] };
  const errors: string[] = [];
  const top = evalOne(c.buttons.top.expr, c.buttons.top.overrides, sizeId, scope, 'Top button', errors);
  const bottom = evalOne(c.buttons.bottom.expr, c.buttons.bottom.overrides, sizeId, scope, 'Bottom button', errors);
  const hi = edgeTopCm - top;
  if (n === 0) return { positions: [], manual: false, errors };
  if (n === 1) return { positions: [hi], manual: false, errors };
  const step = (hi - bottom) / (n - 1);
  return { positions: Array.from({ length: n }, (_, i) => hi - i * step), manual: false, errors };
}

/** Move one button in one size: the size keeps its own positions from then on (starting from `current`). */
export function setButtonPosition(project: Project, sizeId: Id, current: number[], index: number, hCm: number): Project {
  const c = cardiganOf(project);
  const positions = [...(c.buttons.manual[sizeId] ?? current)];
  if (index < 0 || index >= positions.length) return project;
  positions[index] = Math.round(hCm * 100) / 100;
  return { ...project, cardigan: { ...c, buttons: { ...c.buttons, manual: { ...c.buttons.manual, [sizeId]: positions } } } };
}
