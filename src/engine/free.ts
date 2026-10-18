// Free stitches: stitches painted anywhere in a panel, for experimenting beyond the shaping options.
// Positions are relative to each row's centre, so they stay put when other shaping changes the width.
// Pure: edits return a new project.

import type { CustomSymbol, FreeStitch, Id, Panel, Project } from './model';
import { newId } from './model';
import { rowCentre, type ComputedPanel } from './panel';
import { isCountSymbol, markerDelta } from './symbols';

/** Leaning stitches swap when mirrored across the centre. */
export const MIRROR_SYMBOL: Record<string, string> = { ssk: 'k2tog', k2tog: 'ssk', m1l: 'm1r', m1r: 'm1l', c4f: 'c4b', c4b: 'c4f' };

/** Stitch change of a painted stitch (bind-off/cast-on/turn symbols aren't paintable and count 0). */
export function freeDelta(symbol: string, custom: CustomSymbol[] = []): number {
  return isCountSymbol(symbol) ? 0 : markerDelta(symbol, 1, custom);
}

/** The cells a free stitch occupies: itself, and its mirror image when mirrored (unless it sits on the centre). */
export function freeCells(f: FreeStitch): { x: number; symbol: string }[] {
  const out = [{ x: f.x, symbol: f.symbol }];
  const mx = -f.x - 1;
  if (f.mirror && Math.abs(mx - f.x) > 1e-9) out.push({ x: mx, symbol: MIRROR_SYMBOL[f.symbol] ?? f.symbol });
  return out;
}

export function freeFor(panel: Panel, sizeId: Id): FreeStitch[] {
  return (panel.freeStitches ?? []).filter((f) => f.sizeId === sizeId);
}

/** Extra stitches the free stitches hold at the end of each row (cumulative), index 0…totalRows. */
export function freeInterior(project: Project, panel: Panel, sizeId: Id, totalRows: number): number[] {
  const change = new Array<number>(totalRows + 1).fill(0);
  for (const f of freeFor(panel, sizeId)) {
    if (f.row < 1 || f.row > totalRows) continue;
    for (const cell of freeCells(f)) change[f.row] += freeDelta(cell.symbol, project.symbols);
  }
  let acc = 0;
  return change.map((d) => (acc += d));
}

// ---------- editing ----------

function edit(p: Project, panelId: Id, fn: (list: FreeStitch[], panel: Panel) => void): Project {
  const d = structuredClone(p);
  const panel = d.panels.find((x) => x.id === panelId);
  if (!panel) return p;
  panel.freeStitches ??= [];
  fn(panel.freeStitches, panel);
  return d;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** The free stitch occupying a cell (directly or as its mirror image). */
export function findFree(panel: Panel, sizeId: Id, row: number, x: number): FreeStitch | undefined {
  return freeFor(panel, sizeId).find((f) => f.row === row && freeCells(f).some((c) => near(c.x, x)));
}

export interface PaintOptions {
  mirror: boolean;
  every: number; // repeat every N rows (0 = no repeat)
  times: number; // total placements including the first
}

/**
 * Paint `symbol` into the cell at (row, x), repeated up the panel if asked. Any stitch already in a target cell is
 * replaced. Rows past the panel's last row are skipped.
 */
export function paintStitch(p: Project, panelId: Id, sizeId: Id, row: number, x: number, symbol: string, opts: PaintOptions, totalRows: number): Project {
  return edit(p, panelId, (list, panel) => {
    const n = opts.every > 0 ? Math.max(1, Math.round(opts.times)) : 1;
    for (let k = 0; k < n; k++) {
      const r = row + k * opts.every;
      if (r < 1 || r > totalRows) continue;
      const cells = [x, ...(opts.mirror ? [-x - 1] : [])];
      for (const cx of cells) {
        const old = findFree(panel, sizeId, r, cx);
        if (old) list.splice(list.indexOf(old), 1);
      }
      list.push({ id: newId('st'), sizeId, row: r, x, symbol, mirror: opts.mirror });
    }
  });
}

/** Remove the free stitch in a cell (with its mirror image). */
export function eraseStitch(p: Project, panelId: Id, sizeId: Id, row: number, x: number): Project {
  const panel = p.panels.find((q) => q.id === panelId);
  if (!panel || !findFree(panel, sizeId, row, x)) return p;
  return edit(p, panelId, (list, pn) => {
    const f = findFree(pn, sizeId, row, x)!;
    list.splice(list.indexOf(f), 1);
  });
}

export function clearFree(p: Project, panelId: Id, sizeId: Id): Project {
  return edit(p, panelId, (list) => {
    for (let i = list.length - 1; i >= 0; i--) if (list[i].sizeId === sizeId) list.splice(i, 1);
  });
}

/** The project with only `sizeId`'s free stitches on this panel (to measure other sizes without their own). */
export function withOnlySize(p: Project, panelId: Id, sizeId: Id): Project {
  const d = structuredClone(p);
  const panel = d.panels.find((x) => x.id === panelId);
  if (panel?.freeStitches) panel.freeStitches = panel.freeStitches.filter((f) => f.sizeId === sizeId);
  return d;
}

/**
 * Copy this size's free stitches to every other size (replacing theirs). Each stitch keeps its place
 * proportionally: rows by their position between the surrounding waypoints, stitches by their fraction of the
 * row's half width, snapped to that size's stitch grid.
 */
export function copyFreeToAllSizes(p: Project, panelId: Id, fromSizeId: Id, compute: (sizeId: Id) => ComputedPanel): Project {
  const panel = p.panels.find((x) => x.id === panelId);
  if (!panel) return p;
  const src = freeFor(panel, fromSizeId);
  const from = compute(fromSizeId);
  if (!from.ok) return p;
  const out: FreeStitch[] = (panel.freeStitches ?? []).filter((f) => f.sizeId === fromSizeId);
  for (const size of p.sizes) {
    if (size.id === fromSizeId) continue;
    const to = compute(size.id);
    if (!to.ok) continue;
    for (const f of src) {
      const row = mapRow(from, to, f.row);
      if (row < 1 || row > to.totalRows) continue;
      out.push({ ...f, id: newId('st'), sizeId: size.id, row, x: mapX(from, to, f.row, row, f.x) });
    }
  }
  return edit(p, panelId, (list) => {
    list.splice(0, list.length, ...out);
  });
}

function mapRow(from: ComputedPanel, to: ComputedPanel, row: number): number {
  const wps = [...from.waypoints].sort((a, b) => a.row - b.row);
  let lo = wps[0];
  let hi = wps[wps.length - 1];
  for (let i = 0; i < wps.length - 1; i++) {
    if (row >= wps[i].row && row <= wps[i + 1].row) {
      lo = wps[i];
      hi = wps[i + 1];
      break;
    }
  }
  const lo2 = to.waypoints.find((w) => w.id === lo.id);
  const hi2 = to.waypoints.find((w) => w.id === hi.id);
  if (!lo2 || !hi2) return Math.round((row / Math.max(1, from.totalRows)) * to.totalRows);
  const t = hi.row === lo.row ? 0 : (row - lo.row) / (hi.row - lo.row);
  return Math.round(lo2.row + t * (hi2.row - lo2.row));
}

function mapX(from: ComputedPanel, to: ComputedPanel, row: number, row2: number, x: number): number {
  const h1 = (from.rightEdge[row] - from.leftEdge[row]) / 2;
  const h2 = (to.rightEdge[row2] - to.leftEdge[row2]) / 2;
  const mid = (x + 0.5) * (h1 > 0 ? h2 / h1 : 1); // cell middle, scaled
  // Snap the cell's left edge onto the target row's stitch grid (edges may sit on half stitches).
  const L = to.leftEdge[row2];
  const centre = (L + to.rightEdge[row2]) / 2;
  const left = Math.round(centre + mid - 0.5 - L) + L;
  return left - centre;
}

/** Cell left edge (relative to the row's centre) for a chart column. */
export function cellX(c: ComputedPanel, x0: number, col: number, row: number): number {
  return x0 + col - rowCentre(c, row);
}
