import type { CustomSymbol } from './model';

// The stitch symbol set (Craft Yarn Council style). Glyphs are drawn by the chart view; this module
// holds what each symbol means, including the stitch change it makes when used as a shaping marker.

export type SymbolId =
  | 'knit'
  | 'purl'
  | 'yo'
  | 'k2tog'
  | 'ssk'
  | 'sk2p'
  | 's2kp'
  | 'm1l'
  | 'm1r'
  | 'kfb'
  | 'slip'
  | 'nostitch'
  | 'turn-wt'
  | 'turn-german'
  | 'co'
  | 'bo'
  | 'buttonhole'
  | 'c4f'
  | 'c4b';

export interface StitchSymbol {
  id: SymbolId;
  label: string;
  abbr: string;
  /** Stitch change when used as an edge shaping marker; 'count' = the marker carries its own count (bind off 4). */
  change: number | 'count' | null;
  group: 'basic' | 'decrease' | 'increase' | 'edge' | 'short-row' | 'cable' | 'other';
}

export const SYMBOLS: Record<SymbolId, StitchSymbol> = {
  knit: { id: 'knit', label: 'Knit (RS), purl (WS)', abbr: 'k', change: null, group: 'basic' },
  purl: { id: 'purl', label: 'Purl (RS), knit (WS)', abbr: 'p', change: null, group: 'basic' },
  yo: { id: 'yo', label: 'Yarn over', abbr: 'yo', change: 1, group: 'increase' },
  k2tog: { id: 'k2tog', label: 'Knit 2 together (right-leaning)', abbr: 'k2tog', change: -1, group: 'decrease' },
  ssk: { id: 'ssk', label: 'Slip, slip, knit (left-leaning)', abbr: 'ssk', change: -1, group: 'decrease' },
  sk2p: { id: 'sk2p', label: 'Slip 1, k2tog, pass slipped st over', abbr: 'sk2p', change: -2, group: 'decrease' },
  s2kp: { id: 's2kp', label: 'Slip 2, k1, pass 2 slipped sts over (centred)', abbr: 's2kp', change: -2, group: 'decrease' },
  m1l: { id: 'm1l', label: 'Make 1 left', abbr: 'M1L', change: 1, group: 'increase' },
  m1r: { id: 'm1r', label: 'Make 1 right', abbr: 'M1R', change: 1, group: 'increase' },
  kfb: { id: 'kfb', label: 'Knit front and back', abbr: 'kfb', change: 1, group: 'increase' },
  slip: { id: 'slip', label: 'Slip purlwise', abbr: 'sl', change: null, group: 'basic' },
  nostitch: { id: 'nostitch', label: 'No stitch', abbr: '', change: null, group: 'other' },
  'turn-wt': { id: 'turn-wt', label: 'Short row: wrap and turn', abbr: 'w&t', change: 'count', group: 'short-row' },
  'turn-german': { id: 'turn-german', label: 'Short row: German (turn, make double stitch)', abbr: 'DS', change: 'count', group: 'short-row' },
  co: { id: 'co', label: 'Cast on', abbr: 'CO', change: 'count', group: 'edge' },
  bo: { id: 'bo', label: 'Bind off', abbr: 'BO', change: 'count', group: 'edge' },
  buttonhole: { id: 'buttonhole', label: 'Buttonhole', abbr: 'bh', change: null, group: 'other' },
  c4f: { id: 'c4f', label: '2/2 cable, front (left cross)', abbr: 'C4F', change: null, group: 'cable' },
  c4b: { id: 'c4b', label: '2/2 cable, back (right cross)', abbr: 'C4B', change: null, group: 'cable' },
};

/** Symbols that make sense as an edge shaping marker, in menu order. */
export const MARKER_SYMBOLS: SymbolId[] = ['ssk', 'k2tog', 'sk2p', 's2kp', 'm1l', 'm1r', 'kfb', 'yo', 'bo', 'co', 'turn-german', 'turn-wt'];

/**
 * Default symbol for a shaping event at an edge (as seen from the RS). A RS row starts at the right edge:
 * "k2, ssk … k2tog, k2" for decreases and "k2, M1L … M1R, k2" for increases.
 */
export function defaultSymbol(kind: 'dec' | 'inc' | 'bindoff' | 'caston' | 'turn', edge: 'left' | 'right', delta = -1): SymbolId {
  switch (kind) {
    case 'dec':
      return delta <= -2 ? 'sk2p' : edge === 'right' ? 'ssk' : 'k2tog';
    case 'inc':
      return edge === 'right' ? 'm1l' : 'm1r';
    case 'bindoff':
      return 'bo';
    case 'caston':
      return 'co';
    default:
      return 'turn-german';
  }
}

/** Stitch change of a marker with this symbol; `count` is used by bind-off / cast-on / turn markers. */
export function markerDelta(symbol: string, count = 1, custom: CustomSymbol[] = []): number {
  const c = custom.find((x) => x.id === symbol);
  if (c) return c.change;
  const s = SYMBOLS[symbol as SymbolId];
  if (!s || s.change === null) return 0;
  if (s.change === 'count') return symbol === 'co' ? Math.abs(count) : -Math.abs(count);
  return s.change;
}

export function isCountSymbol(symbol: string): boolean {
  return SYMBOLS[symbol as SymbolId]?.change === 'count';
}

export interface SymbolInfo {
  id: string;
  label: string;
  abbr: string;
  color?: string; // custom symbols only
  custom: boolean;
}

/** Label/abbreviation for a built-in or custom symbol id (unknown ids are shown by id). */
export function symbolInfo(id: string, custom: CustomSymbol[] = []): SymbolInfo {
  const c = custom.find((x) => x.id === id);
  if (c) return { id, label: c.label, abbr: c.abbr, color: c.color, custom: true };
  const s = SYMBOLS[id as SymbolId];
  if (s) return { id, label: s.label, abbr: s.abbr, custom: false };
  return { id, label: id, abbr: id, custom: false };
}
