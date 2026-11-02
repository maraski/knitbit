// Which fields a fix's Apply can set (applyFix.ts sets them). Apart from the setters, which need the yoke generators'
// defaults, so the issue lists can show their Apply buttons with only the startup code; the setters load on a click.

import type { FixApply } from './issues';
import type { Project } from './model';

/** The yoke parameters Apply sets (applyFix.ts has where each lives in the YokeSpec). */
export const YOKE_APPLY_KEYS = [
  'seamSts', 'frontCo', 'srPairs', 'srFirst', 'srStep', 'backWidth', 'shoulderLength', 'shorten', 'extraRows',
  'backNeckPerRow', 'backNeckRows', 'neckWidth', 'neckDepth', 'neckBackDepth', 'neckCentre', 'capTopSts',
  'rapidRows', 'sleeveWidth', 'backLength', 'extraDepth', 'maxRapid', 'bodyWidth', 'bodyZone', 'underarmCo',
  'sleeveTop', 'bandEase', 'ringEase', 'armArc', 'backRaise',
] as const;
export type YokeApplyKey = (typeof YOKE_APPLY_KEYS)[number];

export const NECK_KEYS = { width: 'width', depth: 'depth', centre: 'centreWidth' } as const;
export const WAYPOINT_KEYS = ['height', 'width', 'left', 'right'] as const;

const has = (list: readonly string[], k: string) => list.includes(k);

/** Can Apply set this field in this project? */
export function canApply(project: Project, a: FixApply): boolean {
  const f = a.field;
  if (f.target === 'settings') return f.key === 'waistSplit';
  const panel = project.panels.find((p) => p.id === f.panelId);
  if (!panel) return false;
  if (f.target === 'yoke') return !!panel.yoke && has(YOKE_APPLY_KEYS, f.key);
  if (f.target === 'neckline') return !!panel.neckline && f.key in NECK_KEYS;
  if (f.target === 'waypoint') return panel.waypoints.some((w) => w.id === f.id) && has(WAYPOINT_KEYS, f.key);
  return false;
}
