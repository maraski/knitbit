// Stitch chart: a ComputedPanel turned into a grid of cells, one chart row per knit row, with the bust
// short rows inserted where they are worked. Pure data; the chart view draws it.
//
// Columns: one per stitch position across the panel's widest extent, column 0 at the left (as seen from the
// RS). A row shows the stitches on the needle at the end of that row, plus anything bound off in it.
// Shaping symbols sit `shapingInset` stitches in from the edge ("k2, ssk … k2tog, k2").

import type { CustomSymbol, FreeStitch, Id, Panel, Project } from './model';
import { freeCells, freeFor, freeInterior } from './free';
import { lineX } from './lines';
import { rowCentre, type ComputedPanel, type ComputedSegment, type Edge, type ShapeEvent } from './panel';
import { defaultSymbol, symbolInfo, type SymbolInfo } from './symbols';

/** '' = no stitch (outside the panel), 'k' = plain stitch, 'h' = held (live, not worked), else a symbol id. */
export type Cell = string;

export const PLAIN = 'k';
export const HELD = 'h';
/** Centre neck stitches placed on hold (not a built-in symbol). */
export const HOLD = 'hold';

/** Which marker a symbol cell came from, for editing from the chart. */
export interface CellRef {
  fromWaypoint: Id;
  edge: Edge; // the editable edge (the left one when the segment is mirrored)
  index: number; // index in that edge's events
}

export interface ChartRow {
  key: string;
  knitRow: number; // the knit row; short rows carry the row they follow
  label: string; // "12", or "SR3" for an inserted short row
  shortRow: { index: number; rs: boolean } | null;
  round: boolean;
  rs: boolean; // RS row (always true in the round)
  /** Reading direction: right to left for RS rows and rounds. */
  rtl: boolean;
  cells: Cell[];
  refs: Record<number, CellRef>; // column → marker
  free: Record<number, Id>; // column → painted stitch
  worked: number; // stitches worked in this row (incl. bound off)
  count: number; // live stitches at the end of the row
}

export interface ChartRepeat {
  name: string;
  fromRow: number;
  toRow: number;
  multiple: number;
  offset: number;
  /** Column of the left edge in the section's first row, for drawing repeat lines. */
  startCol: number;
}

export interface Chart {
  panelId: Id;
  sizeId: Id;
  cols: number;
  /** Stitch x (from the centre line) of column 0's left edge. */
  x0: number;
  rows: ChartRow[]; // knit order
  topDown: boolean;
  castOn: number;
  repeats: ChartRepeat[];
  legend: SymbolInfo[];
}

/** Leaning stitches swap when mirrored across a marker. */
const MIRROR: Record<string, string> = { ssk: 'k2tog', k2tog: 'ssk', m1l: 'm1r', m1r: 'm1l' };

const LEGEND_EXTRA: Record<string, SymbolInfo> = {
  [HELD]: { id: HELD, label: 'Held: live, not worked in this row', abbr: '', custom: false },
  [HOLD]: { id: HOLD, label: 'Place on hold', abbr: 'hold', custom: false },
};

/** Legend entry for any cell value. */
export function cellInfo(id: string, custom: CustomSymbol[] = []): SymbolInfo {
  if (id === PLAIN) return { ...symbolInfo('knit'), id: PLAIN };
  return LEGEND_EXTRA[id] ?? symbolInfo(id, custom);
}

export function buildChart(project: Project, panel: Panel, c: ComputedPanel): Chart {
  const T = c.totalRows;
  const inset = Math.max(0, panel.shapingInset);
  const darts = c.bust?.darts?.interior ?? new Array<number>(T + 1).fill(0);
  const freeI = freeInterior(project, panel, c.sizeId, T);
  const lineChange = new Array<number>(T + 1).fill(0);
  for (const l of c.lines) for (const e of l.events) if (e.row >= 1 && e.row <= T) lineChange[e.row] += e.delta * (l.mirror ? 2 : 1);
  let lineAcc = 0;
  const lineI = lineChange.map((d) => (lineAcc += d));
  const interior = darts.map((v, r) => v + freeI[r] + lineI[r]);
  const freeByRow = new Map<number, FreeStitch[]>();
  for (const f of freeFor(panel, c.sizeId)) freeByRow.set(f.row, [...(freeByRow.get(f.row) ?? []), f]);
  const isRound = (r: number) => !!c.roundRows && r >= c.roundRows.from && r <= c.roundRows.to;
  const isRS = (r: number) => isRound(r) || (((r - c.firstFlatRow) % 2) + 2) % 2 === 0;

  // Stitches held at each edge by short-row segments.
  const heldL = new Array<number>(T + 1).fill(0);
  const heldR = new Array<number>(T + 1).fill(0);
  for (const seg of c.segments) {
    for (const edge of ['left', 'right'] as const) {
      if (seg[edge].method !== 'shortrows') continue;
      const from = Math.max(0, seg.rowFrom - 1);
      const pos = edge === 'left' ? c.leftEdge : c.rightEdge;
      const slice = pos.slice(from, seg.rowTo + 1);
      const outer = edge === 'left' ? Math.min(...slice) : Math.max(...slice);
      for (let r = from; r <= seg.rowTo; r++) (edge === 'left' ? heldL : heldR)[r] = Math.abs(pos[r] - outer);
    }
  }

  // Column frame.
  let minX = Infinity;
  let maxX = -Infinity;
  for (let r = 0; r <= T; r++) {
    minX = Math.min(minX, c.leftEdge[r] - heldL[r]);
    maxX = Math.max(maxX, c.rightEdge[r] + heldR[r]);
  }
  if (!Number.isFinite(minX)) minX = maxX = 0;
  const x0 = minX;
  const cols = Math.max(0, Math.round(maxX - x0));
  const col = (x: number) => Math.round(x - x0);

  // Edge events by row, with their marker refs.
  type Ev = { ev: ShapeEvent; ref: CellRef | null; placement: ComputedSegment['placement'] };
  const evAt = { left: new Map<number, Ev>(), right: new Map<number, Ev>() };
  const refFor = (seg: ComputedSegment, edge: Edge, e: ShapeEvent): CellRef => {
    const editable: Edge = seg.mirror ? 'left' : edge;
    const index = seg[editable].events.findIndex((x) => x.row === e.row);
    return { fromWaypoint: seg.fromWaypoint, edge: editable, index: Math.max(0, index) };
  };
  for (const seg of c.segments) for (const edge of ['left', 'right'] as const) for (const e of seg[edge].events) evAt[edge].set(e.row, { ev: e, ref: refFor(seg, edge, e), placement: seg.placement });
  const neckEv = new Map<number, ShapeEvent>();
  for (const e of c.neck?.events ?? []) neckEv.set(e.row, e);
  const dartRows = new Set([...(c.bust?.darts?.incRows ?? []), ...(c.bust?.darts?.decRows ?? [])]);

  const put = (cells: Cell[], k: number, v: Cell) => {
    if (k >= 0 && k < cells.length && cells[k] !== '') cells[k] = v;
  };
  const fill = (cells: Cell[], a: number, b: number, v: Cell) => {
    for (let k = Math.max(0, Math.min(a, b)); k < Math.min(cols, Math.max(a, b)); k++) cells[k] = v;
  };

  const knitRow = (r: number): ChartRow => {
    const cells: Cell[] = new Array(cols).fill('');
    const refs: Record<number, CellRef> = {};
    const L = col(c.leftEdge[r]);
    const R = col(c.rightEdge[r]);
    const Lp = col(c.leftEdge[r - 1]);
    const Rp = col(c.rightEdge[r - 1]);
    fill(cells, L, R, PLAIN);
    fill(cells, L - heldL[r], L, HELD);
    fill(cells, R, R + heldR[r], HELD);

    // Neck opening.
    const nl = c.neckLeft[r];
    const nr = c.neckRight[r];
    const nlp = c.neckLeft[r - 1];
    const nrp = c.neckRight[r - 1];
    if (nl !== null && nr !== null) {
      fill(cells, col(nl), col(nr), '');
      if (nlp === null && c.neck && !c.neck.atStart) fill(cells, col(nl), col(nr), panel.neckline?.centre === 'hold' ? HOLD : 'bo');
    } else if (nlp !== null && nrp !== null && c.neck?.atStart) {
      fill(cells, col(nlp), col(nrp), 'co');
    }

    // Side edges. Darts widen the drawn edges; don't read that as edge shaping.
    const dI = (interior[r] - interior[r - 1]) / 2;
    const edgeShape = (edge: Edge) => {
      const e = evAt[edge].get(r);
      const left = edge === 'left';
      const now = left ? L : R;
      const before = left ? Lp : Rp;
      const moved = left ? before - now - dI : now - before - dI; // > 0: wider
      if (!e) return;
      const { ev, ref } = e;
      const sym = ev.symbol ?? defaultSymbol(ev.kind, edge, ev.delta);
      const mark = (k: number, v = sym) => {
        put(cells, k, v);
        if (ref && cells[k] === v) refs[k] = ref;
      };
      if (e.placement !== 'edge' && c.princess && (ev.kind === 'dec' || ev.kind === 'inc')) {
        // Princess line: the stored stitch sits on the marker's outer side, its mirror on the inner side.
        let n = Math.abs(ev.delta);
        if (e.placement === 'both') {
          mark(left ? now + inset : now - 1 - inset, defaultSymbol(ev.kind, edge, Math.sign(ev.delta)));
          n -= 1;
        }
        const centre = rowCentre(c, r);
        const k = col(centre + (left ? -1 : 1) * c.princess.offset);
        const outer = left ? k - 1 : k;
        const innerK = left ? k : k - 1;
        if (n >= 1) mark(outer);
        if (n >= 2) mark(innerK, MIRROR[sym] ?? sym);
        return;
      }
      switch (ev.kind) {
        case 'bindoff':
          if (moved < 0) fill(cells, before, now, sym);
          mark(left ? before : before - 1);
          break;
        case 'caston':
          fill(cells, before, now, sym);
          mark(left ? now : now - 1);
          break;
        case 'turn':
          mark(left ? now : now - 1);
          break;
        default: {
          const n = ev.kind === 'inc' ? Math.max(1, Math.abs(ev.delta)) : 1;
          for (let j = 0; j < n; j++) mark(left ? now + inset + j : now - 1 - inset - j);
        }
      }
    };
    edgeShape('left');
    edgeShape('right');

    // Neck edges: the left piece's neck edge is its right edge, and the other way round.
    const ne = neckEv.get(r);
    if (ne && nl !== null && nr !== null) {
      const n = Math.max(1, Math.abs(ne.delta));
      for (let j = 0; j < n; j++) {
        put(cells, col(nl) - 1 - inset - j, defaultSymbol(ne.kind, 'right', ne.delta));
        put(cells, col(nr) + inset + j, defaultSymbol(ne.kind, 'left', ne.delta));
      }
    }

    // Vertical bust darts: shaping either side of each dart line.
    if (dartRows.has(r) && c.bust?.darts) {
      const d = c.bust.darts;
      const change = darts[r] - darts[r - 1]; // both darts together
      const per = Math.abs(change) / 2;
      const centre = rowCentre(c, r);
      const mid = rowCentre(c, r - 1);
      for (const x of [d.leftX, d.rightX]) {
        const k = col(x - mid + centre);
        if (change > 0) {
          put(cells, k - 1, 'm1r');
          if (per > 1) put(cells, k, 'm1l');
        } else if (change < 0) {
          put(cells, k - 1, 'k2tog');
          if (per > 1) put(cells, k, 'ssk');
        }
      }
    }

    // Shaping lines: the stitch on the line's outer side, and its mirror on the inner side.
    for (const l of c.lines) {
      const ev = l.events.find((e) => e.row === r);
      if (!ev) continue;
      const kind = ev.delta < 0 ? 'dec' : 'inc';
      const centre = rowCentre(c, r);
      for (const sgn of l.mirror ? [1, -1] : [1]) {
        const x = sgn * lineX(l, r);
        const k = col(centre + x);
        const leftSide = x < 0;
        const outerSym = defaultSymbol(kind, leftSide ? 'right' : 'left', Math.sign(ev.delta));
        put(cells, leftSide ? k - 1 : k, outerSym);
        if (Math.abs(ev.delta) >= 2) put(cells, leftSide ? k : k - 1, MIRROR[outerSym] ?? outerSym);
      }
    }

    // Painted stitches, drawn over whatever is there (only inside the fabric).
    const free: Record<number, Id> = {};
    const centreR = rowCentre(c, r);
    for (const f of freeByRow.get(r) ?? []) {
      for (const cell of freeCells(f)) {
        const k = col(centreR + cell.x);
        if (k < 0 || k >= cols || cells[k] === '' || cells[k] === HELD) continue;
        cells[k] = cell.symbol;
        free[k] = f.id;
        delete refs[k];
      }
    }

    const round = isRound(r);
    const rs = isRS(r);
    const worked = cells.filter((v) => v !== '' && v !== HELD && v !== HOLD).length;
    return { key: String(r), knitRow: r, label: String(r), shortRow: null, round, rs, rtl: round || rs, cells, refs, free, worked, count: c.counts[r] };
  };

  const rows: ChartRow[] = [];
  const sr = c.bust?.shortRows;
  for (let r = 1; r <= T; r++) {
    rows.push(knitRow(r));
    if (sr && sr.pairs.length && r === sr.afterRow) rows.push(...shortRows(c, sr, col, cols, r));
  }
  if (sr && sr.pairs.length && sr.afterRow === 0) rows.unshift(...shortRows(c, sr, col, cols, 0));

  // Repeats from the panel's pattern sections.
  const repeats: ChartRepeat[] = c.sections.map((s) => ({
    name: s.patternName || s.name,
    fromRow: Math.max(1, s.fromRow + 1),
    toRow: s.toRow,
    multiple: s.multiple,
    offset: s.offset,
    startCol: col(c.leftEdge[Math.max(0, Math.min(T, s.fromRow))]),
  }));

  // Legend: what the chart actually uses.
  const used = new Set<string>();
  for (const row of rows) for (const v of row.cells) if (v !== '') used.add(v);
  const order = [PLAIN, HELD, HOLD];
  const ids = [...used].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const legend = ids.map((id) => cellInfo(id, project.symbols));

  return { panelId: c.panelId, sizeId: c.sizeId, cols, x0, rows, topDown: c.topDown, castOn: c.counts[0] ?? 0, repeats, legend };
}

function shortRows(c: ComputedPanel, sr: NonNullable<NonNullable<ComputedPanel['bust']>['shortRows']>, col: (x: number) => number, cols: number, after: number): ChartRow[] {
  const L = col(c.leftEdge[after]);
  const R = col(c.rightEdge[after]);
  const turn = sr.style === 'german' ? 'turn-german' : 'turn-wt';
  const out: ChartRow[] = [];
  sr.pairs.forEach((p, i) => {
    const prevRight = i === 0 ? 0 : sr.pairs[i - 1].rightUnworked;
    // A cardigan front turns at its side edge only: the turning row runs from the front edge, the return row back to it.
    const one = sr.oneSide;
    const make = (rs: boolean): ChartRow => {
      const cells: Cell[] = new Array(cols).fill('');
      for (let k = L; k < R; k++) cells[k] = HELD;
      const a = L + p.leftUnworked;
      const b = one ? R - p.rightUnworked : rs ? R - prevRight : R - p.rightUnworked;
      for (let k = a; k < b; k++) cells[k] = PLAIN;
      // RS rows run right to left: the right front (side at the left) turns on RS rows, the left front on WS rows.
      if (one === 'left') {
        if (rs) cells[a] = turn;
      } else if (one === 'right') {
        if (!rs) cells[b - 1] = turn;
      } else if (rs) cells[a] = turn;
      else cells[b - 1] = turn;
      const first = one === 'right' ? !rs : rs; // worked first in the pair
      const index = 2 * p.index - (first ? 1 : 0);
      return {
        key: `${after}-sr${index}`,
        knitRow: after,
        label: `SR${index}`,
        shortRow: { index, rs },
        round: false,
        rs,
        rtl: rs,
        cells,
        refs: {},
        free: {},
        worked: rs ? p.rsWorked : p.wsWorked,
        count: sr.liveStitches,
      };
    };
    out.push(...(one === 'right' ? [make(false), make(true)] : [make(true), make(false)]));
  });
  return out;
}

// ---------- collapsing the plain middle ----------

export type DisplayCol = { col: number } | { gap: number; from: number };

/**
 * Columns to draw, with long runs of identical plain columns folded into a gap marker.
 * A column folds when every row has the same cell as in the neighbouring column and no symbol.
 */
export function collapseColumns(chart: Chart, keep = 3, minRun = 10): DisplayCol[] {
  const sig = (k: number) => chart.rows.map((r) => r.cells[k]).join('|');
  const plain = (k: number) => chart.rows.every((r) => r.cells[k] === '' || r.cells[k] === PLAIN || r.cells[k] === HELD);
  const out: DisplayCol[] = [];
  let k = 0;
  while (k < chart.cols) {
    let j = k + 1;
    if (plain(k)) {
      const s = sig(k);
      while (j < chart.cols && plain(j) && sig(j) === s) j++;
    }
    const run = j - k;
    if (run >= minRun + 2 * keep) {
      for (let x = k; x < k + keep; x++) out.push({ col: x });
      out.push({ gap: run - 2 * keep, from: k + keep });
      for (let x = j - keep; x < j; x++) out.push({ col: x });
    } else for (let x = k; x < j; x++) out.push({ col: x });
    k = j;
  }
  return out;
}
