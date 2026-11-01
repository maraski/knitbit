// Page 1 of the export as data: the header facts and the size tables (body measurements, finished measurements, key
// numbers per piece). Pure: pdf.ts lays these out; strings are as the app writes them (pdf.ts makes them
// Helvetica-safe).

import { finishedMeasurements, FINISHED_ROWS, panelRole } from '../engine/finished';
import { garmentLabel } from '../engine/garmentSetup';
import { cachedPanel, measureEdge, type PanelCache } from '../engine/joins';
import { resolveMeasurements } from '../engine/measurements';
import type { Id, Panel, Project } from '../engine/model';
import { formatLength, unitLabel } from '../engine/units';
import { orderedSizes } from './plan';

export interface TableColumn {
  label: string;
  align: 'left' | 'right';
  /** Share of the width relative to the other columns (default 1). */
  weight?: number;
}

export interface TableRow {
  cells: string[];
  /** First row of a group (a piece): a rule is drawn above it, and the group is kept together where it fits. */
  groupStart?: boolean;
}

export interface Table {
  title: string;
  columns: TableColumn[];
  rows: TableRow[];
  note?: string;
}

export const DASH = '—';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "25 Oct 2026". */
export function exportDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const sizeName = (project: Project, id: Id) => project.sizes.find((s) => s.id === id)?.name ?? '?';
/** Size column headings, the base size marked with "*". */
const sizeColumns = (project: Project, sizeIds: Id[]): TableColumn[] =>
  sizeIds.map((id) => ({ label: `${sizeName(project, id)}${id === project.baseSizeId ? '*' : ''}`, align: 'right' }));
const baseNote = (project: Project, sizeIds: Id[]) => (sizeIds.includes(project.baseSizeId) ? '* base size' : undefined);

const num = (cm: number, project: Project) => formatLength(cm, project.units, { withUnit: false });

/** The block at the top of page 1. */
export function headerInfo(project: Project, sizeIds: Id[], date: Date): { title: string; lines: string[] } {
  const g = project.gauge;
  const basis = g.basis === '4in' ? '4 in' : '10 cm';
  const sizes = orderedSizes(project, sizeIds).map((id) => sizeName(project, id));
  return {
    title: project.name.trim() || 'Untitled',
    lines: [
      `Gauge ${g.stitches} sts × ${g.rows} rows = ${basis}`,
      `Units ${unitLabel(project.units)} · Size${sizes.length === 1 ? '' : 's'} ${sizes.join(', ')} · Exported ${exportDate(date)}`,
      `Construction: ${garmentLabel(project)}`,
    ],
  };
}

/** Body measurements per size, as on the Measurements tab (values only). */
export function bodyTable(project: Project, sizeIds: Id[]): Table {
  const ids = orderedSizes(project, sizeIds);
  const resolved = ids.map((id) => resolveMeasurements(project, id).values);
  const rows: TableRow[] = [];
  for (const m of project.measurements) {
    const vals = resolved.map((r) => r[m.name]?.value);
    if (vals.every((v) => v === undefined)) continue;
    rows.push({ cells: [m.label || m.name, ...vals.map((v) => (v === undefined ? DASH : num(v, project)))] });
  }
  return { title: 'Body measurements', columns: [{ label: 'Body measurements', align: 'left', weight: 3 }, ...sizeColumns(project, ids)], rows, note: baseNote(project, ids) };
}

/** Finished garment measurements per size: rows any ticked size has, "—" where a size can't work one out. */
export function finishedTable(project: Project, sizeIds: Id[], cache: PanelCache = new Map()): Table {
  const ids = orderedSizes(project, sizeIds);
  const perSize = ids.map((id) => new Map(finishedMeasurements(project, id, cache).map((r) => [r.id, r])));
  const rows: TableRow[] = [];
  for (const def of FINISHED_ROWS) {
    if (!perSize.some((m) => m.has(def.id))) continue;
    const cells = perSize.map((m) => {
      const cm = m.get(def.id)?.cm;
      if (cm === null || cm === undefined) return DASH;
      const t = num(Math.abs(cm), project);
      return def.signed ? (t === '0' ? '0' : `${cm < 0 ? '−' : '+'}${t}`) : t;
    });
    rows.push({ cells: [def.label, ...cells] });
  }
  return { title: 'Finished measurements', columns: [{ label: 'Finished measurements', align: 'left', weight: 3 }, ...sizeColumns(project, ids)], rows, note: baseNote(project, ids) };
}

/** A piece as listed: the name, "×2" for a sleeve that stands for both, a cardigan pair once ("mirrored"). */
interface PieceEntry {
  label: string;
  panel: Panel;
  /** The piece stands for two: 'make 2' (a seamed sleeve), 'make 2, mirrored' (a pair of fronts, the left printed). */
  make?: string;
}

export function pieceEntries(project: Project): PieceEntry[] {
  const out: PieceEntry[] = [];
  const done = new Set<Id>();
  for (const p of project.panels) {
    if (done.has(p.id)) continue;
    done.add(p.id);
    const pair = p.half?.pair ? project.panels.find((x) => x.id === p.half!.pair) : undefined;
    if (pair && !done.has(pair.id)) {
      done.add(pair.id);
      // The left front first (it's the one E2 prints), the right mirrors it.
      const [a, b] = p.half!.side === 'left' ? [p, pair] : [pair, p];
      out.push({ label: `${a.name} / ${b.name} (mirrored)`, panel: a, make: 'make 2, mirrored' });
      continue;
    }
    const both = panelRole(p) === 'sleeve' && !p.fromYoke;
    out.push(both ? { label: `${p.name} ×2`, panel: p, make: 'make 2' } : { label: p.name, panel: p });
  }
  return out;
}

/** Stitches made on the first row: the yoke's cast-on, else the cast-on (or picked-up) edge's stitches. */
function firstRow(project: Project, panel: Panel, sizeId: Id, cache: PanelCache): string {
  const c = cachedPanel(project, panel.id, sizeId, cache);
  if (!c || !c.ok) return DASH;
  if (c.yoke) return String(c.yoke.castOn);
  const m = measureEdge(project, { panelId: panel.id, edge: { kind: c.topDown ? 'top' : 'bottom' } }, sizeId, project.settings.pickUp, cache);
  if (!m.ok) return DASH;
  return panel.startFrom === 'pickup' ? `pick up ${m.stitches}` : String(m.stitches);
}

/** Cast-on, rows and length of every piece, one row per ticked size. */
export function piecesTable(project: Project, sizeIds: Id[], cache: PanelCache = new Map()): Table {
  const ids = orderedSizes(project, sizeIds);
  const rows: TableRow[] = [];
  for (const e of pieceEntries(project)) {
    ids.forEach((id, i) => {
      const c = cachedPanel(project, e.panel.id, id, cache);
      const ok = c && c.ok;
      rows.push({
        cells: [i === 0 ? e.label : '', sizeName(project, id), firstRow(project, e.panel, id, cache), ok ? String(c.totalRows) : DASH, ok ? num(c.totalRows / c.rowsPerCm, project) : DASH],
        ...(i === 0 ? { groupStart: true } : {}),
      });
    });
  }
  return {
    title: 'Key numbers per piece',
    columns: [
      { label: 'Piece', align: 'left', weight: 3 },
      { label: 'Size', align: 'left' },
      { label: 'Cast on', align: 'right', weight: 1.4 },
      { label: 'Rows', align: 'right' },
      { label: `Length (${unitLabel(project.units)})`, align: 'right', weight: 1.4 },
    ],
    rows,
  };
}
