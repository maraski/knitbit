// Finished garment measurements: what the garment measures once knitted, from the computed stitch and row counts
// divided by the gauge (after rounding to whole stitches, not the targets). Pure; used by the PDF export's size
// tables and could be shown in the app too.
//
// Pieces are found by their role (bodice, sleeve, yoke) and waypoints by name or by the measurement their width or
// height refers to, so renamed waypoints still work. Anything that can't be found is null ("—"), never a guess.

import { parseExpression, references } from './expr';
import { buildScope } from './measurements';
import { cachedPanel, measureEdge, type PanelCache } from './joins';
import { bandOnFront } from './bands';
import type { Id, Panel, Project } from './model';
import type { ComputedPanel, ComputedWaypoint } from './panel';

export type PanelRole = 'yoke' | 'back' | 'front' | 'sleeve' | 'band' | 'other';

/** What a piece is in the garment: from the yoke it continues from, else the template that made it. */
export function panelRole(p: Panel): PanelRole {
  if (p.yoke) return 'yoke';
  if (p.edge || p.band) return 'band';
  if (p.fromYoke === 'back' || p.fromYoke === 'front') return p.fromYoke;
  if (p.fromYoke === 'leftSleeve' || p.fromYoke === 'rightSleeve') return 'sleeve';
  if (p.template === 'back' || p.template === 'front') return p.template;
  if ((p.template ?? '').startsWith('sleeve')) return 'sleeve';
  return 'other';
}

export type FinishedId =
  | 'bust'
  | 'waist'
  | 'hem'
  | 'bodyLength'
  | 'upperArm'
  | 'cuff'
  | 'sleeveLength'
  | 'neck'
  | 'yokeDepth'
  | 'bustEase'
  | 'bandWidth'
  | 'overlap';

export interface FinishedRow {
  id: FinishedId;
  label: string;
  /** cm; null = couldn't be worked out in this size (shown as "—"). */
  cm: number | null;
  /** Shown with + or − (ease). */
  signed?: boolean;
}

/** Row order and labels (the export's table follows this order). */
export const FINISHED_ROWS: { id: FinishedId; label: string; signed?: boolean }[] = [
  { id: 'bust', label: 'Bust / chest' },
  { id: 'bustEase', label: 'Ease at bust', signed: true },
  { id: 'waist', label: 'Waist' },
  { id: 'hem', label: 'Hem' },
  { id: 'bodyLength', label: 'Body length' },
  { id: 'yokeDepth', label: 'Yoke depth' },
  { id: 'upperArm', label: 'Upper arm' },
  { id: 'cuff', label: 'Cuff' },
  { id: 'sleeveLength', label: 'Sleeve length' },
  { id: 'neck', label: 'Neck opening' },
  { id: 'bandWidth', label: 'Front band width' },
  { id: 'overlap', label: 'Front overlap' },
];

/** Names (waypoint keys) and measurement references that identify a landmark row. */
const LANDMARKS = {
  underarm: { names: ['underarm'], width: ['upper_chest', 'bicep', 'yoke.back_w', 'yoke.front_w', 'yoke.sleeve_w'], height: ['waist_to_underarm', 'arm_length'] },
  waist: { names: ['waist'], width: ['waist'], height: [] as string[] },
  hem: { names: ['hem'], width: ['hem_circ', 'high_hip', 'hip_seat_straight', 'hip_seat_curvy'], height: [] as string[] },
  cuff: { names: ['cuff'], width: ['wrist'], height: [] as string[] },
};
type Landmark = keyof typeof LANDMARKS;

function refsOf(expr: string): string[] {
  const ast = parseExpression(expr);
  return ast.ok ? references(ast.value) : [];
}

/** The computed waypoint for a landmark: by name first, then by what its width or height expression refers to. */
function landmark(panel: Panel, c: ComputedPanel, which: Landmark): ComputedWaypoint | undefined {
  const l = LANDMARKS[which];
  const byName = c.waypoints.find((w) => l.names.includes(w.key));
  if (byName) return byName;
  const wp = panel.waypoints.find((w) => {
    const widthRefs = w.symmetric ? refsOf(w.width.expr) : [...refsOf(w.left.expr), ...refsOf(w.right.expr)];
    return widthRefs.some((r) => l.width.includes(r)) || refsOf(w.height.expr).some((r) => l.height.includes(r));
  });
  return wp ? c.waypoints.find((w) => w.id === wp.id) : undefined;
}

/** The waypoint at the garment's lower edge (hem or cuff): by landmark, else the lowest one. */
function lowerEdge(panel: Panel, c: ComputedPanel, which: 'hem' | 'cuff'): ComputedWaypoint | undefined {
  return landmark(panel, c, which) ?? [...c.waypoints].sort((a, b) => a.heightCm - b.heightCm)[0];
}

/** Selvedge stitches in a row (used up by seams): those of the nearest waypoint, which knows whether it's in the round. */
function selvedgeAt(c: ComputedPanel, r: number): number {
  let best: ComputedWaypoint | undefined;
  for (const w of c.waypoints) if (!best || Math.abs(w.row - r) < Math.abs(best.row - r)) best = w;
  return best?.selvedge ?? 0;
}

/** The fabric's width at the end of knit row `r` (cm), selvedges left out. */
function widthAt(c: ComputedPanel, r: number): number {
  const sts = c.rightEdge[r] - c.leftEdge[r] - selvedgeAt(c, r);
  return Math.max(0, sts) / c.stitchesPerCm;
}

/** The row a lower edge is measured at: just inside a band (rib section) worked at the edge, else the edge itself. */
function insideBand(c: ComputedPanel, edgeRow: number): number {
  const probe = c.topDown ? edgeRow : edgeRow + 1;
  const band = c.sections.find((s) => s.fromRow <= probe && probe <= s.toRow);
  if (!band) return edgeRow;
  return c.topDown ? Math.max(0, band.fromRow - 1) : Math.min(c.totalRows, band.toRow);
}

interface Piece {
  panel: Panel;
  c: ComputedPanel;
}

const sum = (xs: (number | null)[]): number | null => (xs.length && xs.every((x) => x !== null) ? xs.reduce<number>((a, x) => a + x!, 0) : null);

/**
 * Finished measurements of the garment in one size. Each row appears only when the project has the pieces for it
 * (no sleeves: no sleeve rows); a row whose landmark can't be found has `cm: null`.
 */
export function finishedMeasurements(project: Project, sizeId: Id, cache: PanelCache = new Map()): FinishedRow[] {
  const computed = (p: Panel): Piece | null => {
    const c = cachedPanel(project, p.id, sizeId, cache);
    return c && c.ok ? { panel: p, c } : null;
  };
  const roles = project.panels.map((p) => ({ p, role: panelRole(p) }));
  const bodyPanels = roles.filter((x) => x.role === 'back' || x.role === 'front').map((x) => x.p);
  const sleevePanel = roles.find((x) => x.role === 'sleeve')?.p;
  const yokePanel = roles.find((x) => x.role === 'yoke')?.p;
  const backPanel = roles.find((x) => x.role === 'back')?.p;
  const cardigan = project.garment.opening === 'cardigan';
  const scope = buildScope(project, sizeId);

  const rows: FinishedRow[] = [];
  const add = (id: FinishedId, cm: number | null) => {
    const def = FINISHED_ROWS.find((r) => r.id === id)!;
    rows.push({ id, label: def.label, cm: cm !== null && Number.isFinite(cm) ? cm : null, ...(def.signed ? { signed: true } : {}) });
  };

  // ---- body circumferences ----
  if (bodyPanels.length) {
    const pieces = bodyPanels.map(computed);
    const all = pieces.every((x): x is Piece => x !== null) ? pieces : null;
    // A cardigan measured closed: the bands are added (unless knit into the fronts) and the overlap taken off once.
    const integrated = (['left', 'right'] as const).some((s) => bandOnFront(project, s)?.attach === 'integrated');
    const closing = cardigan ? (integrated ? 0 : 2 * (scope.band_w ?? 0)) - (scope.band_overlap ?? 0) : 0;
    const around = (per: (x: Piece) => number | null) => {
      const s = all ? sum(all.map(per)) : null;
      return s === null ? null : s + closing;
    };

    const bust = around(({ panel, c }) => {
      const under = landmark(panel, c, 'underarm');
      if (!under) return null;
      const from = c.bust?.apex.row ?? landmark(panel, c, 'waist')?.row ?? lowerEdge(panel, c, 'hem')?.row;
      if (from === undefined) return null;
      let widest = 0;
      for (let r = Math.min(from, under.row); r <= Math.max(from, under.row); r++) widest = Math.max(widest, widthAt(c, r));
      return widest;
    });
    add('bust', bust);
    const body = scope.bust;
    add('bustEase', bust !== null && body !== undefined ? bust - body : null);

    // The waist only when the body is shaped there: the whole body narrower there than at both the hem and the bust.
    const waistAt = (x: Piece) => {
      const w = landmark(x.panel, x.c, 'waist');
      return w ? widthAt(x.c, w.row) : null;
    };
    const hemAt = ({ panel, c }: Piece) => {
      const hem = lowerEdge(panel, c, 'hem');
      return hem ? widthAt(c, insideBand(c, hem.row)) : null;
    };
    const waist = around(waistAt);
    const hem = around(hemAt);
    if (!all) add('waist', null);
    else if (waist !== null && hem !== null && bust !== null && waist < hem - 1e-9 && waist < bust - 1e-9) add('waist', waist);
    add('hem', hem);
  }

  // ---- lengths ----
  const yoke = yokePanel ? computed(yokePanel) : null;
  if (backPanel) {
    const back = computed(backPanel);
    let len: number | null = null;
    if (back) {
      const hem = lowerEdge(back.panel, back.c, 'hem');
      const top = back.c.topDown ? 0 : back.c.totalRows;
      if (hem) len = Math.abs(top - hem.row) / back.c.rowsPerCm;
      // Continued from a yoke: the yoke's back (back neck to the split) is part of the length.
      if (len !== null && back.panel.fromYoke) len = yoke?.c.yoke ? len + yoke.c.yoke.derived.backLengthCm : null;
    }
    add('bodyLength', len);
  }
  if (yokePanel) add('yokeDepth', yoke?.c.yoke ? yoke.c.yoke.derived.backLengthCm : null);

  // ---- sleeves ----
  if (sleevePanel) {
    const s = computed(sleevePanel);
    const under = s ? landmark(s.panel, s.c, 'underarm') : undefined;
    const cuff = s ? lowerEdge(s.panel, s.c, 'cuff') : undefined;
    add('upperArm', s && under ? widthAt(s.c, under.row) : null);
    add('cuff', s && cuff ? widthAt(s.c, insideBand(s.c, cuff.row)) : null);
    add('sleeveLength', s && under && cuff ? Math.abs(under.row - cuff.row) / s.c.rowsPerCm : null);
  }

  // ---- neck: the yoke's neck edge, else every bodice's neckline (a straight top-down back neck too) ----
  const ratio = project.settings.pickUp;
  if (yokePanel) {
    const m = measureEdge(project, { panelId: yokePanel.id, edge: { kind: 'neck' } }, sizeId, ratio, cache);
    add('neck', m.ok ? m.lengthCm : null);
  } else if (bodyPanels.length) {
    const ms = bodyPanels.map((p) => measureEdge(project, { panelId: p.id, edge: { kind: 'neck' } }, sizeId, ratio, cache));
    const withNeck = ms.filter((m) => m.ok);
    add('neck', withNeck.length ? withNeck.reduce((a, m) => a + m.lengthCm, 0) : null);
  }

  // ---- cardigan bands ----
  if (cardigan && (scope.band_w ?? 0) > 0) {
    add('bandWidth', scope.band_w);
    add('overlap', scope.band_overlap ?? null);
  }

  const order = FINISHED_ROWS.map((r) => r.id);
  return rows.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

