// Go to field: where a fix's field is on screen (which sidebar, which tab, its `data-field` keys), and the short
// highlight once it is there. The app selects the piece, size and selection first; the field may load lazily, so
// `flashField` waits for it.

import type { FieldRef } from '../engine/issues';
import type { Selection } from './selection';

export type SidebarTab = 'garment' | 'pieces' | 'settings';

export interface FieldSpot {
  side: 'left' | 'right';
  /** `data-field` values to look for, the first found wins (ExprField uses its fieldKey). */
  keys: string[];
  /** Left sidebar: the tab the field is on. */
  tab?: SidebarTab;
  /** Right sidebar: what to select so the field's properties show. */
  selection?: Selection;
}

// Yoke parameters whose properties field has another key than the param.
const YOKE_DOM: Record<string, string> = { shoulderLength: 'length', extraDepth: 'extra' };
const BUST_DOM: Record<string, string[]> = { width: ['w'], length: ['l', 'lnw'], apexHeight: ['h'], apexOffset: ['o'], zoneWidth: ['z'], vertical: ['b'], pairs: ['bust.pairs'] };
const SETTINGS: Record<string, { tab: SidebarTab; keys: string[] }> = {
  strap: { tab: 'garment', keys: ['width'] },
  edges: { tab: 'garment', keys: ['edges.frontBands.depth', 'edges.neckband.depth', 'edges.hem.depth'] },
  cuff: { tab: 'garment', keys: ['edges.cuff.depth'] },
  buttons: { tab: 'garment', keys: ['cardigan.top', 'cardigan.overlap'] },
  construction: { tab: 'garment', keys: ['garment.method'] },
  front: { tab: 'garment', keys: ['garment.method'] },
  joins: { tab: 'pieces', keys: [] },
  seamTolerance: { tab: 'settings', keys: ['settings.tol'] },
  regionGap: { tab: 'settings', keys: ['settings.regionGap'] },
};

export function fieldSpot(f: FieldRef): FieldSpot {
  switch (f.target) {
    case 'yoke':
      return { side: 'right', keys: [`yoke.${YOKE_DOM[f.key] ?? f.key}`], selection: { kind: 'panel' } };
    case 'neckline':
      return { side: 'right', keys: [f.key], selection: { kind: 'neckline' } };
    case 'waypoint':
      return { side: 'right', keys: f.key === 'width' ? ['width', 'left'] : [f.key], selection: f.id ? { kind: 'waypoint', id: f.id } : { kind: 'panel' } };
    case 'segment':
      return { side: 'right', keys: [f.key], selection: f.id ? { kind: 'segment', fromWaypoint: f.id } : { kind: 'panel' } };
    case 'bust':
      return { side: 'right', keys: BUST_DOM[f.key] ?? [], selection: { kind: 'bust' } };
    case 'line':
      return { side: 'right', keys: f.key === 'start' ? ['fromh', 'fromx'] : f.key === 'end' ? ['toh', 'tox'] : ['amount'], selection: f.id ? { kind: 'line', id: f.id } : { kind: 'panel' } };
    case 'join':
      return { side: 'right', keys: [], selection: f.id ? { kind: 'join', id: f.id } : { kind: 'panel' } };
    case 'panel':
      return { side: 'right', keys: [`panel.${f.key === 'paint' ? 'lines' : f.key}`], selection: { kind: 'panel' } };
    case 'settings': {
      const s = SETTINGS[f.key] ?? { tab: 'garment' as const, keys: [] };
      return { side: 'left', tab: s.tab, keys: s.keys };
    }
    case 'measurement':
      return { side: 'right', keys: [] };
  }
}

/** Scroll the field into view and outline it briefly; waits up to 3 s for lazily loaded properties. */
export function flashField(spot: FieldSpot): void {
  if (!spot.keys.length) return;
  const start = performance.now();
  const find = () => {
    const box = document.querySelector(`.sidebar.${spot.side}`);
    for (const k of spot.keys) {
      const el = box?.querySelector<HTMLElement>(`[data-field="${CSS.escape(k)}"]`);
      if (el) return el;
    }
    return null;
  };
  const step = () => {
    const el = find();
    if (!el) {
      if (performance.now() - start < 3000) window.setTimeout(step, 60);
      return;
    }
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('field-flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('field-flash');
    window.setTimeout(() => el.classList.remove('field-flash'), 1800);
  };
  // After React has rendered the new selection.
  window.setTimeout(step, 30);
}
