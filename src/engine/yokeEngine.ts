// The yoke generators (contiguous.ts with raglan.ts) load on demand: only a project with a yoke panel needs them,
// and they are a large part of the engine. contiguous.ts registers itself here when it loads (by any import); until
// then computePanel shows a yoke panel as loading. The app loads them before it shows such a project (ui/store.ts).

import type { generateYoke, yokeNames, yokeNeckContinues } from './contiguous';
import type { Project } from './model';

export type Zone = 'leftFront' | 'leftSleeve' | 'back' | 'rightSleeve' | 'rightFront';
export const ZONES: Zone[] = ['leftFront', 'leftSleeve', 'back', 'rightSleeve', 'rightFront'];

/** `yoke.*` names: each held part plus its share of the underarm cast-on, as widths (cm), the yoke depth, and a front
 * neck that continues into the front body: its rows below the split, increases per side and centre (rows, sts; 0 when
 * the neck closes in the yoke). */
export const YOKE_NAMES = ['yoke.back_w', 'yoke.front_w', 'yoke.sleeve_w', 'yoke.underarm_co', 'yoke.depth', 'yoke.neck_rows', 'yoke.neck_per_side', 'yoke.neck_centre'] as const;

/** A yoke's neck width linked to the garment's strap (Strap gives at: Neck): the generator solves it. */
export const STRAP_YOKE_NECK = 'strap_neck_w';
/** A yoke's back width linked to the strap (Strap gives at: Armhole): the back is the neck plus the seam's increases. */
export const STRAP_YOKE_BACK = 'strap_back_w';

export interface YokeEngine {
  generateYoke: typeof generateYoke;
  yokeNames: typeof yokeNames;
  yokeNeckContinues: typeof yokeNeckContinues;
}

let engine: YokeEngine | null = null;
let loading: Promise<unknown> | null = null;

/** The generators, or null while they aren't loaded. */
export const yokeEngine = (): YokeEngine | null => engine;

export function registerYokeEngine(e: YokeEngine): void {
  engine = e;
}

/** Loads the generators (once). */
export const loadYokeEngine = (): Promise<unknown> => (loading ??= import('./contiguous'));

/** The project has a yoke and the generators aren't loaded yet. */
export const needsYokeEngine = (p: Project): boolean => !engine && p.panels.some((x) => x.yoke);
