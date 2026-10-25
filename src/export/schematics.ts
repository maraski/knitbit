// The schematic pages as data: which pieces get a page, the print scale, and the table under each drawing. Pure; pdf.ts
// draws them, render.tsx draws the schematic itself.

import type { ComputedPanel } from '../engine/panel';
import { formatLength, unitLabel, type Units } from '../engine/units';
import type { Table } from './tables';

/** Print scales offered, as the N of "1 : N" (1 cm on paper = N cm of fabric). */
export const SCALES = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50];

/**
 * The largest standard scale no bigger than the fitted one. `pxPerCm`: the fitted drawing's px per cm of fabric;
 * `mmPerPx`: how big a drawing px prints. Returns the scale's N and its px per cm.
 */
export function printScale(pxPerCm: number, mmPerPx: number): { n: number; pxPerCm: number } {
  const exact = 10 / (pxPerCm * mmPerPx);
  const n = SCALES.find((s) => s >= exact - 1e-9) ?? Math.ceil(exact / 10) * 10;
  return { n, pxPerCm: 10 / (n * mmPerPx) };
}

/** "1 : 4", "1 : 2.5". */
export const scaleText = (n: number) => `1 : ${n}`;

const num = (cm: number, units: Units) => formatLength(cm, units, { withUnit: false });

/** The waypoints in knitting order: name, row, height from the first row, stitches. */
export function waypointTable(c: ComputedPanel, units: Units): Table {
  const rpc = c.rowsPerCm;
  const wps = [...c.waypoints].sort((a, b) => a.row - b.row);
  return {
    title: 'Waypoints',
    columns: [
      { label: 'Waypoint', align: 'left', weight: 2.4 },
      { label: 'Row', align: 'right', weight: 0.8 },
      { label: `Height (${unitLabel(units)})`, align: 'right', weight: 1.2 },
      { label: 'Stitches', align: 'right' },
    ],
    rows: wps.map((w) => ({ cells: [w.name, String(w.row), num(w.row / rpc, units), w.actualStitches !== w.stitches ? `${w.actualStitches} (${w.stitches})` : String(w.actualStitches)] })),
    note: `In knitting order: rows and height from the ${c.topDown ? 'top (worked top-down)' : 'lower edge'}${wps.some((w) => w.actualStitches !== w.stitches) ? ' · (n): the target where the shaping reaches a different count' : ''}.`,
  };
}

/** A yoke's phases: rows and the stitches after each. */
export function yokeTable(c: ComputedPanel, units: Units): Table {
  const y = c.yoke!;
  return {
    title: 'Yoke phases',
    columns: [
      { label: 'Phase', align: 'left', weight: 2.4 },
      { label: 'Rows', align: 'right', weight: 1.2 },
      { label: `Depth (${unitLabel(units)})`, align: 'right', weight: 1.2 },
      { label: 'Sts after', align: 'right' },
      { label: 'Increases', align: 'left', weight: 1.6 },
    ],
    rows: y.phases.map((p) => ({ cells: [p.label, p.from === p.to ? String(p.from) : `${p.from}–${p.to}`, num((p.to - p.from + 1) / y.rowsPerCm, units), String(p.stsAfter), p.incsPerRow] })),
    note: `Cast on ${y.castOn} · split after row ${y.counts.total}: sleeves ${y.held.leftSleeve} sts each on hold, body ${y.held.body} + 2 × ${y.underarmCo} cast on.`,
  };
}
