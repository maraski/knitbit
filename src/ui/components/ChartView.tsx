// Stitch chart view: the computed panel as a grid of cells, drawn upright (row 1 at the bottom for bottom-up
// panels, at the top for top-down ones). Rows are virtualised; plain stitches are drawn as runs.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildChart, collapseColumns, HELD, PLAIN, type Chart, type ChartRow, type DisplayCol } from '../../engine/chart';
import type { CustomSymbol, Id, Panel, Project } from '../../engine/model';
import { newId } from '../../engine/model';
import type { ComputedPanel } from '../../engine/panel';
import type { MarkerActions } from '../markerActions';
import type { Selection } from '../selection';
import { bandColor, cellFill, Glyph, Swatch } from '../glyphs';
import { signed } from '../format';
import { cellX, clearFree, copyFreeToAllSizes, eraseStitch, findFree, freeFor, paintStitch, withOnlySize } from '../../engine/free';
import { computePanel } from '../../engine/panel';
import { SYMBOLS, type SymbolId } from '../../engine/symbols';
import { cancelDrag, handledDoubleTap, isDoubleTap, slop, usePinch, useTouchUi } from '../touch';

interface Props {
  project: Project;
  panel: Panel;
  computed: ComputedPanel;
  selection: Selection;
  onSelect: (s: Selection) => void;
  markers?: MarkerActions;
  update: (fn: (p: Project) => Project, key?: string | null) => void;
  grid?: { computed: ComputedPanel; name: string }[]; // grid mode: one small chart per size
}

const PREF_KEY = 'knitbit.chart.v1';
export interface Brush {
  on: boolean;
  symbol: string; // symbol id, or 'erase'
  mirror: boolean;
  every: number;
  times: number;
}
interface Prefs {
  cell: number;
  collapse: boolean;
  brush: Brush;
}
const DEFAULT_BRUSH: Brush = { on: false, symbol: 'purl', mirror: true, every: 0, times: 1 };
function readPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}');
    return { cell: typeof v.cell === 'number' ? v.cell : 14, collapse: !!v.collapse, brush: { ...DEFAULT_BRUSH, ...(v.brush ?? {}), on: false } };
  } catch {
    return { cell: 14, collapse: false, brush: DEFAULT_BRUSH };
  }
}

/** Stitches you can paint: everything except edge-only (bind off / cast on / turns) and plain knit. */
const PAINTABLE: SymbolId[] = (Object.keys(SYMBOLS) as SymbolId[]).filter((id) => !['knit', 'bo', 'co', 'turn-wt', 'turn-german'].includes(id));

const GUT = 46; // side gutters (row numbers)
const TOP = 22;
const BOT = 26;
const MIN_CELL = 3;
const MAX_CELL = 40;

export function ChartView({ project, panel, computed: c, selection, onSelect, markers, update, grid }: Props) {
  const [prefs, setPrefs] = useState(readPrefs);
  const cs = prefs.cell;
  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);
  const setCell = (n: number) => setPrefs((p) => ({ ...p, cell: Math.max(MIN_CELL, Math.min(MAX_CELL, Math.round(n * 2) / 2)) }));

  const chart = useMemo(() => (c.ok ? buildChart(project, panel, c) : null), [project, panel, c]);
  const custom = project.symbols ?? [];

  if (grid) {
    // One scale for every size, so the charts compare.
    const extent = Math.max(1, ...grid.filter((g) => g.computed.ok).map((g) => Math.max(g.computed.counts.reduce((a, b) => Math.max(a, b), 0) * 1.1, g.computed.totalRows / 1.3)));
    const gcs = Math.max(1, Math.min(4, 300 / extent));
    return (
      <div className="chart-view">
        <div className="chart-grid">
          {grid.map((g) => (
            <GridChart key={g.computed.sizeId} project={project} panel={panel} c={g.computed} name={g.name} cs={gcs} />
          ))}
          {!grid.length && <p className="muted pad">No sizes chosen.</p>}
        </div>
        <LegendPanel chart={chart} project={project} update={update} />
      </div>
    );
  }

  return (
    <div className="chart-view">
      {chart ? (
        <ChartCanvas
          chart={chart}
          c={c}
          panel={panel}
          update={update}
          custom={custom}
          cs={cs}
          setCell={setCell}
          collapse={prefs.collapse}
          setCollapse={(v) => setPrefs((p) => ({ ...p, collapse: v }))}
          brush={prefs.brush}
          setBrush={(b) => setPrefs((p) => ({ ...p, brush: { ...p.brush, ...b } }))}
          selection={selection}
          onSelect={onSelect}
          markers={markers}
        />
      ) : (
        <div className="canvas-empty">
          <p>This panel can't be charted in this size: see the checks below.</p>
        </div>
      )}
      <LegendPanel chart={chart} project={project} update={update} />
    </div>
  );
}

// ---------- the full chart ----------

interface CanvasProps {
  chart: Chart;
  c: ComputedPanel;
  panel: Panel;
  update: Props['update'];
  brush: Brush;
  setBrush: (b: Partial<Brush>) => void;
  custom: CustomSymbol[];
  cs: number;
  setCell: (n: number) => void;
  collapse: boolean;
  setCollapse: (v: boolean) => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  markers?: MarkerActions;
}

/** A chart cell under the pointer: its row, chart column and display row index. */
interface Hit {
  row: ChartRow;
  col: number;
  yi: number;
}

interface Drag {
  fromWaypoint: Id;
  edge: 'left' | 'right';
  index: number;
  row: number;
  others: number[];
  key: string;
  moved: boolean;
}

function ChartCanvas({ chart, c, panel, update, brush, setBrush, custom, cs, setCell, collapse, setCollapse, selection, onSelect, markers }: CanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // The last cell painted (display row index, chart column): Shift-click draws a line from it.
  const anchor = useRef<{ yi: number; col: number } | null>(null);
  const stroke = useRef<{ key: string; erase: boolean; seen: Set<string>; last: { x: number; y: number } } | null>(null);
  /** One finger scrolling the chart (a mouse uses the scroll bars and wheel). */
  const pan = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean } | null>(null);
  const panelStart = panel.startFrom ?? 'caston';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (!typing && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 'p') setBrush({ on: !brush.on });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [brush.on, setBrush]);
  const [view, setView] = useState({ top: 0, height: 800 });
  const drag = useRef<Drag | null>(null);
  const [hover, setHover] = useState<{ row: ChartRow; col: number } | null>(null);

  // Upright: bottom-up charts read from the bottom, top-down from the top.
  const display = useMemo(() => (chart.topDown ? chart.rows : [...chart.rows].reverse()), [chart]);
  const dcols: DisplayCol[] = useMemo(() => (collapse ? collapseColumns(chart) : Array.from({ length: chart.cols }, (_, k) => ({ col: k }))), [chart, collapse]);
  const xOfCol = useMemo(() => {
    const m = new Map<number, number>();
    dcols.forEach((d, i) => 'col' in d && m.set(d.col, i));
    return m;
  }, [dcols]);
  const W = dcols.length * cs;
  const H = display.length * cs;
  const fine = cs >= 7;

  // Scroll so the chart's first row is in view when a panel is opened.
  const firstKey = `${chart.panelId}`;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = chart.topDown ? 0 : el.scrollHeight;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    anchor.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => setView({ top: el.scrollTop, height: el.clientHeight });
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    const fit = () => {
      const w = (el.clientWidth - 2 * GUT - 40) / Math.max(1, dcols.length);
      const h = (el.clientHeight - TOP - BOT - 20) / Math.max(1, display.length);
      setCell(Math.min(w, h));
    };
    window.addEventListener('knitbit:fit', fit);
    return () => {
      el.removeEventListener('scroll', sync);
      ro.disconnect();
      window.removeEventListener('knitbit:fit', fit);
    };
  }, [dcols.length, display.length, setCell]);

  // Ctrl/⌘ + wheel (and a trackpad pinch, which arrives as Ctrl + wheel, or as gesture events in Safari)
  // zooms around the pointer. The unrounded size carries over between events: a pinch sends many tiny
  // steps, each of which would round back to the same half-pixel cell size.
  const zoomTo = useRef<number | null>(null);
  const gestureFrom = useRef(0);
  // Scroll position for the zoomed chart: set once the new cell size has rendered (or on the next frame, if the
  // rounded size didn't change), so it isn't clamped to the old size. Several zoom steps can arrive before that.
  const pendingScroll = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const to = pendingScroll.current;
    if (!el || !to) return;
    el.scrollLeft = to.x;
    el.scrollTop = to.y;
    pendingScroll.current = null;
  }, [cs]);
  const zoomAtRef = useRef<(next: number, clientX: number, clientY: number, toX?: number, toY?: number) => void>(() => {});
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (zoomTo.current !== null && Math.abs(zoomTo.current - cs) > 0.5) zoomTo.current = null; // changed elsewhere
    // The chart point under (clientX, clientY) ends up under (toX, toY): the same place for the wheel, the fingers' midpoint for a pinch.
    const zoomAt = (next: number, clientX: number, clientY: number, toX = clientX, toY = clientY) => {
      const from = zoomTo.current ?? cs;
      next = Math.max(MIN_CELL, Math.min(MAX_CELL, next));
      zoomTo.current = next;
      const r = el.getBoundingClientRect();
      const base = pendingScroll.current ?? { x: el.scrollLeft, y: el.scrollTop };
      const px = clientX - r.left + base.x;
      const py = clientY - r.top + base.y;
      const k = next / from;
      setCell(next);
      const to = { x: px * k - (toX - r.left), y: py * k - (toY - r.top) };
      pendingScroll.current = to;
      requestAnimationFrame(() => {
        if (pendingScroll.current !== to) return; // already set, or a later step will
        el.scrollLeft = to.x;
        el.scrollTop = to.y;
        pendingScroll.current = null;
      });
    };
    zoomAtRef.current = zoomAt;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt((zoomTo.current ?? cs) * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.004)), e.clientX, e.clientY);
    };
    // Safari: pinch gestures (scale is relative to the gesture's start).
    type Gesture = Event & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      if (touching()) return; // a touch pinch: handled from its pointer events
      gestureFrom.current = zoomTo.current ?? cs;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (touching()) return;
      const g = e as Gesture;
      zoomAt(gestureFrom.current * g.scale, g.clientX, g.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, [cs, setCell]);

  // Two fingers zoom and scroll; a second finger landing takes back the stroke or marker move the first one started.
  const touchUi = useTouchUi();
  const touching = usePinch(scrollRef, {
    start: () => {
      if (stroke.current) cancelDrag(stroke.current.key);
      if (drag.current) cancelDrag(drag.current.key);
      stroke.current = null;
      drag.current = null;
      pan.current = null;
      setHover(null);
    },
    move: (s) => {
      const r = scrollRef.current!.getBoundingClientRect();
      zoomAtRef.current((zoomTo.current ?? cs) * s.k, s.from.x + r.left, s.from.y + r.top, s.to.x + r.left, s.to.y + r.top);
    },
  });

  // Visible rows only (plus a margin).
  const first = Math.max(0, Math.floor((view.top - TOP) / cs) - 10);
  const last = Math.min(display.length, Math.ceil((view.top + view.height - TOP) / cs) + 10);

  const selMarker = selection.kind === 'segment' && selection.marker !== undefined ? selection : null;
  const segOf = (fw: Id) => c.segments.find((s) => s.fromWaypoint === fw);

  // Count shown beside rows where it changes.
  const countChanged = useMemo(() => {
    const s = new Set<string>();
    let prev = chart.castOn;
    for (const r of chart.rows) {
      if (!r.shortRow && r.count !== prev) s.add(r.key);
      if (!r.shortRow) prev = r.count;
    }
    return s;
  }, [chart]);

  // Pointer positions are measured from the chart's own origin: the SVG is centred in the scroll area when it is
  // narrower than it (after Fit or zooming out), so the scroll area's edge is not the chart's.
  const gridXY = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { xi: Math.floor((clientX - r.left - GUT) / cs), yi: Math.floor((clientY - r.top - TOP) / cs) };
  };
  const rowAt = (clientY: number): number => Math.max(0, Math.min(display.length - 1, gridXY(0, clientY).yi));
  const colAt = (clientX: number): DisplayCol | undefined => dcols[gridXY(clientX, 0).xi];

  /** Chart cell under the pointer: the display row and column (null in a folded gap or outside). */
  const cellAt = (clientX: number, clientY: number): Hit | null => {
    const { xi, yi } = gridXY(clientX, clientY);
    const d = dcols[xi];
    const row = display[yi];
    if (!d || !('col' in d) || !row) return null;
    return { row, col: d.col, yi };
  };
  const paintAt = (hit: Hit, toggle: boolean) => {
    const st = stroke.current;
    if (!st || hit.row.shortRow) return;
    const id = `${hit.row.knitRow}:${hit.col}`;
    if (st.seen.has(id)) return;
    st.seen.add(id);
    const v = hit.row.cells[hit.col];
    if (v === '' || v === HELD) return; // outside the fabric
    anchor.current = { yi: hit.yi, col: hit.col };
    const r = hit.row.knitRow;
    const x = cellX(c, chart.x0, hit.col, r);
    const existing = findFree(panel, c.sizeId, r, x);
    if (st.erase || (toggle && existing && existing.symbol === brush.symbol && Math.abs(existing.x - x) < 1e-6)) {
      if (toggle && existing) st.erase = true; // a stroke that starts by removing keeps removing
      update((p) => eraseStitch(p, panel.id, c.sizeId, r, x), st.key);
      return;
    }
    update((p) => paintStitch(p, panel.id, c.sizeId, r, x, brush.symbol, { mirror: brush.mirror, every: brush.every, times: brush.times }, c.totalRows), st.key);
  };
  /** Eyedropper: the stitch in a cell becomes the brush (a plain stitch picks the eraser). */
  const pickAt = (hit: Hit) => {
    const v = hit.row.cells[hit.col];
    if (v === PLAIN) setBrush({ symbol: 'erase' });
    else if ((PAINTABLE as string[]).includes(v) || custom.some((s) => s.id === v)) setBrush({ symbol: v });
  };
  /** Shift-click: every cell on the straight line from the last painted cell to this one. */
  const lineTo = (hit: Hit) => {
    const a = anchor.current;
    const x0 = a ? xOfCol.get(a.col) : undefined;
    const x1 = xOfCol.get(hit.col);
    if (!a || x0 === undefined || x1 === undefined || !display[a.yi]) return false;
    const n = Math.max(Math.abs(x1 - x0), Math.abs(hit.yi - a.yi));
    for (let k = 1; k <= n; k++) {
      const xi = Math.round(x0 + ((x1 - x0) * k) / n);
      const yi = Math.round(a.yi + ((hit.yi - a.yi) * k) / n);
      const d = dcols[xi];
      if (d && 'col' in d && display[yi]) paintAt({ row: display[yi], col: d.col, yi }, false);
    }
    return true;
  };
  /** Starts a paint stroke (or picks a stitch); false when the press isn't painting. */
  const startPaint = (e: React.PointerEvent) => {
    if (!brush.on || (e.button !== 0 && e.button !== 2)) return false;
    const hit = cellAt(e.clientX, e.clientY);
    if (!hit) return false;
    e.preventDefault();
    if (e.metaKey || e.ctrlKey) {
      pickAt(hit);
      return true;
    }
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    stroke.current = { key: `drag:paint:${Date.now()}`, erase: e.button === 2 || brush.symbol === 'erase', seen: new Set(), last: { x: e.clientX, y: e.clientY } };
    if (!(e.shiftKey && lineTo(hit))) paintAt(hit, true);
    return true;
  };
  const onPaintDown = (e: React.PointerEvent) => {
    if (startPaint(e) || e.pointerType !== 'touch') return;
    const el = scrollRef.current!;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pan.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (stroke.current) {
      // Visit every cell between the last pointer position and this one, so fast strokes don't skip.
      const { last } = stroke.current;
      const steps = Math.max(1, Math.ceil(Math.hypot(e.clientX - last.x, e.clientY - last.y) / Math.max(2, cs / 2)));
      for (let k = 1; k <= steps; k++) {
        const hit = cellAt(last.x + ((e.clientX - last.x) * k) / steps, last.y + ((e.clientY - last.y) * k) / steps);
        if (hit) paintAt(hit, false);
      }
      stroke.current.last = { x: e.clientX, y: e.clientY };
      return;
    }
    const pn = pan.current;
    if (pn) {
      const dx = e.clientX - pn.x;
      const dy = e.clientY - pn.y;
      if (!pn.moved && Math.hypot(dx, dy) > slop(e)) {
        pn.moved = true;
        setHover(null);
      }
      if (pn.moved) {
        scrollRef.current!.scrollLeft = pn.sl - dx;
        scrollRef.current!.scrollTop = pn.st - dy;
      }
      return;
    }
    const d = drag.current;
    if (!d || !markers) return;
    const seg = segOf(d.fromWaypoint);
    if (!seg) return;
    // Nearest knit row under the pointer (short rows aren't marker rows).
    let i = rowAt(e.clientY);
    while (i > 0 && display[i].shortRow) i--;
    const row = Math.max(seg.rowFrom, Math.min(seg.rowTo, display[i].knitRow));
    if (row !== d.row && !d.others.includes(row)) {
      markers.move(d.fromWaypoint, d.edge, d.index, row - seg.rowFrom + 1, d.key);
      d.index = d.others.filter((r) => r < row).length;
      d.row = row;
      d.moved = true;
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const painting = !!stroke.current;
    stroke.current = null;
    const p = pan.current;
    pan.current = null;
    const d = drag.current;
    drag.current = null;
    if (d) onSelect({ kind: 'segment', fromWaypoint: d.fromWaypoint, edge: d.edge, marker: d.index });
    // A finger tap shows that stitch's readout (tapping outside the chart hides it); two taps add a marker.
    if (e.pointerType === 'touch' && !painting && (p ? !p.moved : d && !d.moved)) {
      const hit = cellAt(e.clientX, e.clientY);
      setHover(hit ? { row: hit.row, col: hit.col } : null);
      if (hit && isDoubleTap(e)) onDouble(hit.row, hit.col);
    }
  };

  const onCellDown = (e: React.PointerEvent, row: ChartRow, k: number) => {
    const ref = row.refs[k];
    if (brush.on || !ref || e.button !== 0) return;
    e.stopPropagation();
    const seg = segOf(ref.fromWaypoint);
    if (!seg) return;
    const list = seg[ref.edge].events;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { ...ref, row: list[ref.index]?.row ?? row.knitRow, others: list.filter((_, j) => j !== ref.index).map((x) => x.row), key: `drag:chart:${Date.now()}`, moved: false };
    onSelect({ kind: 'segment', fromWaypoint: ref.fromWaypoint, edge: ref.edge, marker: ref.index });
  };

  /** Double-click a stitch in a shaped stretch: add a marker on that row at the nearer edge. */
  const onDouble = (row: ChartRow, k: number) => {
    if (brush.on || !markers || row.shortRow) return;
    const seg = c.segments.find((s) => row.knitRow >= s.rowFrom && row.knitRow <= s.rowTo && s.rowTo > s.rowFrom);
    if (!seg) return;
    const firstCol = row.cells.findIndex((v) => v !== '');
    const lastCol = row.cells.length - 1 - [...row.cells].reverse().findIndex((v) => v !== '');
    const edge = k - firstCol <= lastCol - k ? 'left' : 'right';
    const target = seg.mirror ? 'left' : edge;
    markers.add(seg, target, row.knitRow - seg.rowFrom + 1);
    onSelect({ kind: 'segment', fromWaypoint: seg.fromWaypoint, edge: target });
  };

  const rowsSvg: React.ReactNode[] = [];
  for (let i = first; i < last; i++) {
    const row = display[i];
    const y = TOP + i * cs;
    const parts: React.ReactNode[] = [];
    // Runs of plain / held stitches.
    let runStart = -1;
    let runKind = '';
    const flush = (end: number) => {
      if (runStart < 0) return;
      parts.push(<rect key={`r${runStart}`} x={GUT + runStart * cs} y={y} width={(end - runStart) * cs} height={cs} className={runKind === HELD ? 'cell-held' : 'cell-plain'} />);
      runStart = -1;
    };
    dcols.forEach((d, xi) => {
      const v = 'col' in d ? row.cells[d.col] : row.cells[d.from];
      const runnable = v === PLAIN || v === HELD;
      if (runnable && runStart >= 0 && v === runKind) return;
      flush(xi);
      if (runnable) {
        runStart = xi;
        runKind = v;
      }
    });
    flush(dcols.length);
    // Contiguous yoke: tint each zone, and draw the markers between zones.
    for (const zr of chart.zoneRuns?.[row.key] ?? []) {
      const xs = dcols.map((d, xi) => ('col' in d && d.col >= zr.from && d.col < zr.to ? xi : -1)).filter((xi) => xi >= 0);
      if (xs.length) parts.push(<rect key={`z${zr.zone}`} x={GUT + xs[0] * cs} y={y} width={(xs[xs.length - 1] - xs[0] + 1) * cs} height={cs} className={`zone-tint zone-${zr.zone}`} />);
    }
    // Symbol cells.
    dcols.forEach((d, xi) => {
      if (!('col' in d)) return;
      const v = row.cells[d.col];
      if (v === '' || v === PLAIN || v === HELD) return;
      const x = GUT + xi * cs;
      const ref = row.refs[d.col];
      const selected = !!(ref && selMarker && ref.fromWaypoint === selMarker.fromWaypoint && ref.edge === (selMarker.edge ?? 'left') && ref.index === selMarker.marker);
      const band = bandColor(v, custom);
      parts.push(
        <g
          key={`s${d.col}`}
          className={`sym${ref ? ' editable' : ''}${selected ? ' selected' : ''}`}
          onPointerDown={(e) => onCellDown(e, row, d.col)}
        >
          {ref && touchUi && !brush.on && cs < 28 && <rect x={x + cs / 2 - 14} y={y + cs / 2 - 14} width={28} height={28} className="touch-hit" />}
          {fine ? (
            <>
              <rect x={x} y={y} width={cs} height={cs} fill={cellFill(v, custom)} className="cell-border" />
              <g transform={`translate(${x},${y}) scale(${cs})`}>
                <Glyph id={v} custom={custom} />
              </g>
            </>
          ) : (
            <rect x={x} y={y} width={cs} height={cs} fill={band ?? cellFill(v, custom)} />
          )}
          {selected && <rect x={x - 1} y={y - 1} width={cs + 2} height={cs + 2} className="cell-selected" />}
          {row.free[d.col] && fine && <rect x={x + 0.75} y={y + 0.75} width={cs - 1.5} height={cs - 1.5} className="painted-cell" />}
        </g>,
      );
    });
    for (const mc of chart.markerCols?.[row.key] ?? []) {
      const xi = xOfCol.get(mc);
      if (xi !== undefined) parts.push(<line key={`m${mc}`} x1={GUT + xi * cs} x2={GUT + xi * cs} y1={y} y2={y + cs} className="marker-line" />);
    }
    // Row labels: where the row starts.
    const label = (
      <text className={`row-label${row.shortRow ? ' sr' : ''}`} y={y + cs / 2 + 3.5}>
        {row.label}
      </text>
    );
    const fs = Math.min(11, Math.max(7, cs * 0.75));
    const showLabel = cs >= 8 || row.shortRow || (!row.shortRow && row.knitRow % 5 === 0);
    parts.push(
      <g key="lbl" style={{ fontSize: fs }}>
        {showLabel && (row.rtl ? <g transform={`translate(${GUT + W + 4},0)`}>{label}</g> : <g transform={`translate(${GUT - 4},0)`} textAnchor="end">{label}</g>)}
        {countChanged.has(row.key) && cs >= 8 && (
          <text x={GUT + W + 30} y={y + cs / 2 + 3.5} className="row-count">
            {row.count}
            {chart.zoneCounts?.[row.key] && <tspan className="zone-counts"> {chart.zoneCounts[row.key].join(' · ')}</tspan>}
          </text>
        )}
      </g>,
    );
    rowsSvg.push(
      <g
        key={row.key}
        onDoubleClick={(e) => {
          if (handledDoubleTap()) return;
          const d = colAt(e.clientX);
          if (d && 'col' in d) onDouble(row, d.col);
        }}
        onPointerMove={(e) => {
          if (drag.current || e.pointerType === 'touch') return;
          const d = colAt(e.clientX);
          setHover(d && 'col' in d ? { row, col: d.col } : null);
        }}
      >
        {parts}
      </g>,
    );
  }

  // Column numbers (stitch 1 at the right, as a RS row is read), every 10 (every 5 when roomy).
  const colLabels: React.ReactNode[] = [];
  const every = cs >= 14 ? 5 : cs >= 6 ? 10 : 20;
  dcols.forEach((d, xi) => {
    if (!('col' in d)) {
      colLabels.push(
        <g key={`gap${xi}`}>
          <rect x={GUT + xi * cs} y={TOP} width={cs} height={H} className="gap-col" />
          <text x={GUT + xi * cs + cs / 2} y={TOP - 6} textAnchor="middle" className="col-label">
            ⋯{d.gap}
          </text>
          <title>{`${d.gap} plain stitches folded`}</title>
        </g>,
      );
      return;
    }
    const n = chart.cols - d.col;
    if (n % every === 0 || n === 1) {
      const x = GUT + xi * cs + cs / 2;
      colLabels.push(
        <text key={`t${d.col}`} x={x} y={TOP - 6} textAnchor="middle" className="col-label">{n}</text>,
        <text key={`b${d.col}`} x={x} y={TOP + H + 14} textAnchor="middle" className="col-label">{n}</text>,
      );
    }
  });

  // Every 10th stitch / row: a stronger grid line.
  const tens: React.ReactNode[] = [];
  if (cs >= 5) {
    dcols.forEach((d, xi) => {
      if ('col' in d && (chart.cols - d.col) % 10 === 0) tens.push(<line key={`v${xi}`} x1={GUT + xi * cs} x2={GUT + xi * cs} y1={TOP} y2={TOP + H} className="ten" />);
    });
    display.forEach((r, i) => {
      if (!r.shortRow && r.knitRow % 10 === 0) {
        const y = chart.topDown ? TOP + (i + 1) * cs : TOP + i * cs;
        tens.push(<line key={`h${i}`} x1={GUT} x2={GUT + W} y1={y} y2={y} className="ten" />);
      }
    });
  }

  // Vertical stripes (an integrated front band): tinted columns with a label above.
  const stripes: React.ReactNode[] = chart.stripes.map((st, k) => {
    const xs = dcols.map((d, xi) => ('col' in d && d.col >= st.fromCol && d.col < st.toCol ? xi : -1)).filter((xi) => xi >= 0);
    if (!xs.length) return null;
    const x1 = GUT + Math.min(...xs) * cs;
    const x2 = GUT + (Math.max(...xs) + 1) * cs;
    return (
      <g key={`st${k}`}>
        <rect x={x1} y={TOP} width={x2 - x1} height={H} className="chart-stripe" />
        <text x={(x1 + x2) / 2} y={TOP - 14} textAnchor="middle" className="repeat-label">{st.name}</text>
      </g>
    );
  });
  // Buttonhole rows: a mark in the right gutter.
  const holeMarks: React.ReactNode[] = [];
  display.forEach((r, i) => {
    const b = !r.shortRow && chart.buttonholeRows[r.knitRow];
    if (!b) return;
    holeMarks.push(
      <text key={`bh${i}`} x={GUT * 2 + W + 34} y={TOP + i * cs + cs / 2 + 3.5} className="buttonhole-mark">
        ◦ buttonhole {b.join(', ')}
      </text>,
    );
  });

  // Contiguous yoke phases: a labelled band down the left gutter.
  const phaseCol: React.ReactNode[] = (chart.phases ?? []).map((ph, k) => {
    const idx = display.map((r, i) => (!r.shortRow && r.knitRow >= ph.fromRow && r.knitRow <= ph.toRow ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return null;
    const y1 = TOP + Math.min(...idx) * cs;
    const y2 = TOP + (Math.max(...idx) + 1) * cs;
    return (
      <g key={`ph${k}`} className={`phase-band phase-${k % 2}`}>
        <rect x={2} y={y1} width={12} height={y2 - y1} />
        <text transform={`translate(${11},${(y1 + y2) / 2}) rotate(-90)`} textAnchor="middle">{ph.label}</text>
      </g>
    );
  });

  // Pattern sections: a bracket in the left gutter and repeat lines.
  const repeats: React.ReactNode[] = chart.repeats.map((rp, k) => {
    const idx = display.map((r, i) => (!r.shortRow && r.knitRow >= rp.fromRow && r.knitRow <= rp.toRow ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return null;
    const y1 = TOP + Math.min(...idx) * cs;
    const y2 = TOP + (Math.max(...idx) + 1) * cs;
    const lines: React.ReactNode[] = [];
    if (rp.multiple > 1) {
      for (let col = rp.startCol + rp.offset; col < chart.cols; col += rp.multiple) {
        const xi = xOfCol.get(col);
        if (xi !== undefined) lines.push(<line key={col} x1={GUT + xi * cs} x2={GUT + xi * cs} y1={y1} y2={y2} className="repeat-line" />);
      }
    }
    return (
      <g key={k}>
        {lines}
        <path d={`M${GUT - 30},${y1 + 2} h-4 V${y2 - 2} h4`} className="repeat-bracket" />
        <text transform={`translate(${GUT - 37},${(y1 + y2) / 2}) rotate(-90)`} textAnchor="middle" className="repeat-label">
          {rp.name}
          {rp.multiple > 1 ? ` · ${rp.multiple}${rp.offset ? ` + ${rp.offset}` : ''}` : ''}
        </text>
      </g>
    );
  });

  const hoverText = hover
    ? `${hover.row.shortRow ? `${hover.row.label} (after row ${hover.row.knitRow})` : `Row ${hover.row.knitRow}`} · ${hover.row.round ? 'round' : hover.row.rs ? 'RS' : 'WS'} ${hover.row.rtl ? '←' : '→'} · st ${chart.cols - hover.col} · ${hover.row.worked} worked · ${hover.row.count} on needle` +
      (chart.zoneCounts?.[hover.row.key] ? ` (${chart.zoneCounts[hover.row.key].map((n, i) => `${chart.zoneNames?.[i] ?? i} ${n}`).join(', ')})` : '') +
      (chart.phases ? ` · ${chart.phases.find((p) => hover.row.knitRow >= p.fromRow && hover.row.knitRow <= p.toRow)?.label ?? ''}` : '')
    : null;

  return (
    <div className="chart-main">
      <div className="chart-tools">
        <button onClick={() => setCell(cs / 1.25)} title="Zoom out (⌘ + scroll)">−</button>
        <button onClick={() => setCell(cs * 1.25)} title="Zoom in (⌘ + scroll)">+</button>
        <button onClick={() => window.dispatchEvent(new Event('knitbit:fit'))} title="Fit (F)">Fit</button>
        <label className="check" title="Fold long runs of identical plain columns">
          <input type="checkbox" checked={collapse} onChange={(e) => setCollapse(e.target.checked)} /> Collapse plain middle
        </label>
        <span className="sep" />
        <button className={brush.on ? 'active' : ''} onClick={() => setBrush({ on: !brush.on })} title="Paint stitches anywhere (P)">
          ✎ Paint
        </button>
        {brush.on && (
          <>
            <select value={brush.symbol} onChange={(e) => setBrush({ symbol: e.target.value })} title="Stitch to paint">
              <option value="erase">Eraser</option>
              {PAINTABLE.map((id) => (
                <option key={id} value={id}>
                  {SYMBOLS[id].abbr || '·'} – {SYMBOLS[id].label}
                  {typeof SYMBOLS[id].change === 'number' && SYMBOLS[id].change !== 0 ? ` (${signed(SYMBOLS[id].change as number)})` : ''}
                </option>
              ))}
              {custom.map((cs2) => <option key={cs2.id} value={cs2.id}>{cs2.abbr} – {cs2.label}{cs2.change ? ` (${signed(cs2.change)})` : ''}</option>)}
            </select>
            <label className="check" title="Also paint the mirror image across the centre (leaning stitches swap)">
              <input type="checkbox" checked={brush.mirror} onChange={(e) => setBrush({ mirror: e.target.checked })} /> Mirror
            </label>
            <label className="check" title="Repeat up the panel: every N rows, this many times in all (0 = no repeat)">
              every <input className="num tiny" type="number" min={0} value={brush.every} onChange={(e) => setBrush({ every: Math.max(0, Math.round(Number(e.target.value)) || 0) })} /> rows ×
              <input className="num tiny" type="number" min={1} value={brush.times} onChange={(e) => setBrush({ times: Math.max(1, Math.round(Number(e.target.value)) || 1) })} />
            </label>
            <span className="muted small">{freeFor(panel, c.sizeId).length} painted</span>
            <button
              onClick={() => {
                if (!window.confirm(`Copy this size's ${freeFor(panel, c.sizeId).length} painted stitches to every size? Painted stitches in the other sizes are replaced.`)) return;
                update((p) => {
                  const base = withOnlySize(p, panel.id, c.sizeId);
                  const pn = base.panels.find((x) => x.id === panel.id)!;
                  return copyFreeToAllSizes(p, panel.id, c.sizeId, (sid) => computePanel(base, pn, sid));
                });
              }}
              title="Place these stitches in every size, at the same relative position (between the same waypoints, same fraction of the width)"
            >
              Copy to all sizes
            </button>
            <button onClick={() => window.confirm('Remove all painted stitches in this size?') && update((p) => clearFree(p, panel.id, c.sizeId))}>Clear size</button>
          </>
        )}
      </div>
      <div
        className={`chart-scroll${brush.on ? ' painting' : ''}`}
        ref={scrollRef}
        onPointerDown={onPaintDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={(e) => e.pointerType !== 'touch' && setHover(null)}
        onContextMenu={(e) => brush.on && e.preventDefault()}
      >
        <svg ref={svgRef} width={GUT * 2 + W + 30 + (holeMarks.length ? 110 : 0) + (chart.zoneCounts ? 110 : 0)} height={TOP + H + BOT} className="chart-svg">
          <defs>
            <pattern id="chart-grid" patternUnits="userSpaceOnUse" x={GUT} y={TOP} width={cs} height={cs}>
              <rect width={cs} height={cs} fill="var(--cell)" />
              {cs >= 5 && <path d={`M${cs},0 V${cs} H0`} fill="none" stroke="var(--grid)" strokeWidth={0.6} />}
            </pattern>
            <pattern id="chart-held" patternUnits="userSpaceOnUse" x={GUT} y={TOP} width={cs} height={cs}>
              <rect width={cs} height={cs} fill="var(--cell-held)" />
              <path d={`M0,${cs} L${cs},0`} stroke="var(--line-strong)" strokeWidth={0.8} />
              {cs >= 5 && <path d={`M${cs},0 V${cs} H0`} fill="none" stroke="var(--grid)" strokeWidth={0.6} />}
            </pattern>
          </defs>
          {rowsSvg}
          {tens}
          {colLabels}
          {repeats}
          {phaseCol}
          {stripes}
          {holeMarks}
          <text x={GUT + W / 2} y={chart.topDown ? TOP + H + BOT - 2 : TOP + H + BOT - 2} textAnchor="middle" className="chart-note">
            {chart.topDown ? `Worked top-down: row 1 at the top · ${panelStart === 'pickup' ? 'pick up' : 'cast on'} ${chart.castOn} sts` : `Cast on ${chart.castOn} sts`}
          </text>
        </svg>
      </div>
      <div className="chart-hint">
        {hoverText ?? `${chart.rows.length} rows · ${chart.cols} sts wide · RS rows read right to left, WS left to right`}
        {brush.on
          ? ' · Paint: click or drag to paint, Shift-click for a line from the last stitch, ⌘/Ctrl-click to pick up a stitch, click a painted stitch again (or right-click) to remove · each stroke is one undo'
          : markers && !hoverText
            ? ` · drag a shaping symbol up or down · ${touchUi ? 'double-tap' : 'double-click'} a stitch to add a marker`
            : ''}
      </div>
    </div>
  );
}

// ---------- grid of sizes ----------

function GridChart({ project, panel, c, name, cs }: { project: Project; panel: Panel; c: ComputedPanel; name: string; cs: number }) {
  const chart = useMemo(() => (c.ok ? buildChart(project, panel, c) : null), [project, panel, c]);
  if (!chart) return <figure className="chart-card"><figcaption>{name}: can't chart</figcaption></figure>;
  const display = chart.topDown ? chart.rows : [...chart.rows].reverse();
  const custom = project.symbols ?? [];
  return (
    <figure className="chart-card">
      <svg width={chart.cols * cs} height={display.length * cs}>
        {display.map((row, i) => {
          const parts: React.ReactNode[] = [];
          let a = -1;
          let kind = '';
          const flush = (b: number) => {
            if (a >= 0 && kind !== '') parts.push(<rect key={a} x={a * cs} y={i * cs} width={(b - a) * cs} height={cs} fill={kind === HELD ? 'var(--cell-held-strong)' : kind === PLAIN ? 'var(--fill)' : (bandColor(kind, custom) ?? 'var(--fill)')} />);
          };
          row.cells.forEach((v, k) => {
            if (v === kind && a >= 0) return;
            flush(k);
            a = k;
            kind = v;
          });
          flush(row.cells.length);
          return <g key={row.key}>{parts}</g>;
        })}
      </svg>
      <figcaption>
        <strong>{name}</strong> · {chart.cols} sts · {chart.rows.length} rows
      </figcaption>
    </figure>
  );
}

// ---------- legend + custom symbols ----------

function LegendPanel({ chart, project, update }: { chart: Chart | null; project: Project; update: Props['update'] }) {
  const custom = project.symbols ?? [];
  const setSym = (id: Id, patch: Partial<CustomSymbol>, key: string | null = null) =>
    update((p) => {
      const d = structuredClone(p);
      const s = d.symbols?.find((x) => x.id === id);
      if (s) Object.assign(s, patch);
      return d;
    }, key);
  return (
    <aside className="chart-legend">
      <h4>Legend</h4>
      {chart ? (
        <ul>
          {chart.legend.map((l) => (
            <li key={l.id}>
              <Swatch id={l.id} custom={custom} />
              <span>
                {l.abbr && <strong>{l.abbr} </strong>}
                {l.label}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No chart.</p>
      )}
      <h4>My symbols</h4>
      <p className="muted small">Your own stitches, usable as shaping markers (pick them in a marker's Stitch menu).</p>
      {custom.map((s) => (
        <div key={s.id} className="custom-sym">
          <input type="color" value={s.color} onChange={(e) => setSym(s.id, { color: e.target.value }, `sym.${s.id}.color`)} title="Colour" />
          <input className="abbr" value={s.abbr} onChange={(e) => setSym(s.id, { abbr: e.target.value }, `sym.${s.id}.abbr`)} title="Abbreviation" />
          <input value={s.label} onChange={(e) => setSym(s.id, { label: e.target.value }, `sym.${s.id}.label`)} title="Meaning" />
          <input className="num tiny" type="number" value={s.change} onChange={(e) => setSym(s.id, { change: Math.round(Number(e.target.value)) || 0 }, `sym.${s.id}.change`)} title="Stitch change when used as a marker" />
          <button
            className="icon"
            title="Delete symbol"
            onClick={() =>
              update((p) => {
                const d = structuredClone(p);
                d.symbols = (d.symbols ?? []).filter((x) => x.id !== s.id);
                return d;
              })
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          update((p) => {
            const d = structuredClone(p);
            d.symbols = [...(d.symbols ?? []), { id: newId('custom'), label: 'My stitch', abbr: 'X', color: '#f2d17a', change: 0 }];
            return d;
          })
        }
      >
        + Add symbol
      </button>
      {custom.length > 0 && <p className="muted small">Stitch change: {custom.map((s) => `${s.abbr} ${signed(s.change)}`).join(', ')}</p>}
    </aside>
  );
}
