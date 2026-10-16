import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { regionTransitions } from '../../engine/regionShaping';
import { sizeText } from './EstMark';
import { JOIN_TAGS } from '../../engine/joins';
import { edgePaths } from '../edgePaths';
import { alignShift, localOutline, toLocal, type AlignRef } from '../../engine/layout';
import { sizeColor } from '../sizeColors';
import { SizeGrid, SizeLegend } from './LayoutView';
import type { SizeMode } from './SizeModeBar';
import type { Project } from '../../engine/model';
import type { EdgeKey, Join, KnitDirection } from '../../engine/model';
import { rowCentre, type ComputedPanel, type ComputedSegment, type Edge, type Marker, type ShapeEvent } from '../../engine/panel';
import { SYMBOLS, type SymbolId } from '../../engine/symbols';
import { wedgeBands } from '../../engine/bust';
import { freeCells } from '../../engine/free';
import { lineX } from '../../engine/lines';
import { bandColor } from '../glyphs';
import type { MarkerActions } from '../markerActions';
import type { Units } from '../../engine/units';
import { len, rows as rowsText, sts } from '../format';
import { sameSelection, type Selection } from '../selection';

interface Props {
  computed: ComputedPanel;
  direction: KnitDirection;
  units: Units;
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** Changing this re-fits the view (e.g. a different panel). */
  fitKey: string;
  /** Outlines of all sizes (stitch/row units), so one fit holds every size at the same scale. */
  fitOutlines: { x: number; y: number }[][];
  /** Marker editing; omitted = read-only. */
  markers?: MarkerActions;
  /** Joins touching this panel, drawn along their edges. */
  joins?: { join: Join; edge: EdgeKey }[];
  /** Overlay / grid of several sizes (computed panels in size order). */
  mode?: SizeMode;
  compare?: ComputedPanel[];
  align?: AlignRef;
  project?: Project;
  /** Draw-a-line mode: two clicks give the ends (cm up from the lower edge, cm from the row's centre). */
  drawLine?: boolean;
  onDrawLine?: (a: { h: number; x: number }, b: { h: number; x: number }) => void;
  /**
   * Waypoint dragging: a new height (cm up from the lower edge, row-snapped) or a width factor (new / current) for the
   * whole width or one half. `size` = this size only (Alt held). `key` coalesces one drag into one undo step.
   */
  onDragWaypoint?: (wpId: string, change: { kind: 'height'; h: number } | { kind: 'width'; part: 'width' | 'left' | 'right'; factor: number }, size: boolean, key: string) => void;
  /** A cardigan front or band: its band (stitch x range), button positions (cm up), buttonholes, and dragging. */
  bands?: SchematicBands;
}

export interface SchematicBands {
  bandX: [number, number];
  integrated: boolean;
  label: string;
  edgeRows: number; // rows of the straight front edge (0 = no band drawn)
  buttons: number[]; // cm up from the lower edge
  kind: 'button' | 'hole';
  /** Buttonholes on this panel (a band strip, or an integrated front): knit row and first-cell x. */
  holes: { row: number; x: number; index: number }[];
  holeWidth: number;
  onDrag?: (index: number, hCm: number, key: string) => void;
}

interface View {
  scale: number; // px per cm
  ox: number; // screen px of world origin
  oy: number;
}

interface Pt {
  x: number;
  y: number;
}

const PAD = { left: 130, right: 170, top: 56, bottom: 56 };

interface MarkerDrag {
  seg: ComputedSegment;
  edge: Edge;
  index: number;
  stepLike: boolean; // drawn at the top of the previous row
  key: string; // one undo step per drag
  row: number; // current absolute row
  others: number[]; // rows of the edge's other markers (fixed during the drag)
  moved: boolean;
}

const isStepLike = (e: ShapeEvent) => e.kind === 'bindoff' || e.kind === 'caston' || e.kind === 'turn';

export function Schematic({ computed: c, direction, units, selection, onSelect, fitKey, fitOutlines, markers, joins = [], mode = 'single', compare = [], align = 'hem', project, drawLine = false, onDrawLine, onDragWaypoint, bands }: Props) {
  const wpDrag = useRef<{ wpId: string; kind: 'height' | 'width'; part: 'width' | 'left' | 'right'; half0: number; key: string; x: number; y: number; moved: boolean; last: string } | null>(null);
  const [wpReadout, setWpReadout] = useState<{ sx: number; sy: number; text: string } | null>(null);
  const [drawPts, setDrawPts] = useState<{ first: { h: number; x: number; sx: number; sy: number } | null; cursor: { sx: number; sy: number } | null }>({ first: null, cursor: null });
  useEffect(() => {
    if (!drawLine) setDrawPts({ first: null, cursor: null });
  }, [drawLine]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View | null>(null);
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const markerDrag = useRef<MarkerDrag | null>(null);
  const [dragRow, setDragRow] = useState<number | null>(null);

  const spc = c.stitchesPerCm;
  const rpc = c.rowsPerCm;

  // Knit row → height in the garment (top-down panels are computed from the top but drawn upright).
  const T = c.totalRows;
  const garmentRow = useCallback((r: number) => (c.topDown ? T - r : r), [c.topDown, T]);

  // Panel space (stitches, rows) → oriented cm, with y pointing down the screen.
  const orient = useCallback(
    (xSts: number, yRows: number): Pt => {
      const X = xSts / spc;
      const Y = garmentRow(yRows) / rpc;
      if (direction === 'side-to-side') return { x: Y, y: X };
      return { x: X, y: -Y };
    },
    [direction, spc, rpc, garmentRow],
  );

  const bbox = useMemo(() => {
    // Other sizes have their own row counts; for top-down panels flip each outline by its own height.
    const upright = (o: { x: number; y: number }[]) => {
      if (!c.topDown) return o;
      const h = Math.max(...o.map((p) => p.y));
      return o.map((p) => ({ x: p.x, y: T - (h - p.y) }));
    };
    const pts = (fitOutlines.length ? fitOutlines.map(upright).flat() : c.outline).map((p) => orient(p.x, p.y));
    if (!pts.length) return { x0: -10, y0: -10, x1: 10, y1: 10 };
    return {
      x0: Math.min(...pts.map((p) => p.x)),
      y0: Math.min(...pts.map((p) => p.y)),
      x1: Math.max(...pts.map((p) => p.x)),
      y1: Math.max(...pts.map((p) => p.y)),
    };
  }, [c.outline, c.topDown, T, fitOutlines, orient]);

  const fit = useCallback(() => {
    const bw = Math.max(1, bbox.x1 - bbox.x0);
    const bh = Math.max(1, bbox.y1 - bbox.y0);
    const scale = Math.max(0.5, Math.min((size.w - PAD.left - PAD.right) / bw, (size.h - PAD.top - PAD.bottom) / bh));
    const ox = PAD.left + (size.w - PAD.left - PAD.right - bw * scale) / 2 - bbox.x0 * scale;
    const oy = PAD.top + (size.h - PAD.top - PAD.bottom - bh * scale) / 2 - bbox.y0 * scale;
    setView({ scale, ox, oy });
  }, [bbox, size]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit on first render, panel change and resize; keep the user's zoom when only the size changes.
  const fittedFor = useRef('');
  useEffect(() => {
    const key = `${fitKey}|${size.w}x${size.h}|${direction}`;
    if (fittedFor.current !== key && c.ok) {
      fittedFor.current = key;
      fit();
    }
  }, [fitKey, size, direction, fit, c.ok]);

  useEffect(() => {
    const onFit = () => fit();
    window.addEventListener('knitbit:fit', onFit);
    return () => window.removeEventListener('knitbit:fit', onFit);
  }, [fit]);

  // Wheel zoom (non-passive so we can prevent page scroll).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView((v) => {
        if (!v) return v;
        const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        const scale = Math.min(200, Math.max(0.3, v.scale * k));
        const f = scale / v.scale;
        return { scale, ox: mx - (mx - v.ox) * f, oy: my - (my - v.oy) * f };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  if (!c.ok) {
    return (
      <div className="canvas-empty" ref={wrapRef}>
        <p>This panel can't be drawn in this size.</p>
        <ul>{c.issues.filter((i) => i.severity === 'error').map((i, k) => <li key={k} className="err">{i.message}</li>)}</ul>
      </div>
    );
  }

  const v = view ?? { scale: 4, ox: size.w / 2, oy: size.h / 2 };
  const S = (xSts: number, yRows: number): Pt => {
    const p = orient(xSts, yRows);
    return { x: v.ox + p.x * v.scale, y: v.oy + p.y * v.scale };
  };
  const path = (pts: Pt[], close = false) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('') + (close ? 'Z' : '');

  const vertical = direction !== 'side-to-side';
  const panelDef = project?.panels.find((p) => p.id === c.panelId);
  const transitions = project && panelDef && mode === 'single' ? regionTransitions(project, panelDef, c) : [];
  const top = c.totalRows;
  // Waypoints from the garment's bottom to its top, whatever the knitting direction.
  const gw = c.topDown ? [...c.waypoints].reverse() : c.waypoints;
  const minX = Math.min(...c.leftEdge);
  const maxX = Math.max(...c.rightEdge);

  // ---- waypoint labels on the right, nudged apart so they don't overlap ----
  const wpLabels = gw.map((w) => ({ w, y: S(maxX, w.row).y }));
  if (vertical) {
    const order = [...wpLabels].sort((a, b) => b.y - a.y); // bottom first
    for (let i = 1; i < order.length; i++) if (order[i - 1].y - order[i].y < 15) order[i].y = order[i - 1].y - 15;
  }

  const isSel = (s: Selection) => sameSelection(selection, s);
  const click = (s: Selection) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (suppressClick.current) return;
    onSelect(s);
  };

  const edgePts = (edge: number[], from: number, to: number) => {
    const pts: Pt[] = [];
    for (let r = Math.max(0, from); r <= to; r++) {
      pts.push(S(edge[r], r - 1 < 0 ? 0 : r - 1));
      pts.push(S(edge[r], r));
    }
    return pts;
  };

  /** Screen paths for an edge (one or more pieces). */
  const joinEdgePts = (edge: EdgeKey): Pt[][] => edgePaths(c, edge).map((piece) => piece.map((p) => S(p.x, p.y)));

  /** Where a segment's shaping on this row is drawn: the side edge, or the princess line for incs/decs. */
  const shapeX = (seg: ComputedSegment, edge: Edge, row: number, kind: ShapeEvent['kind']) => {
    if (seg.placement !== 'edge' && c.princess && (kind === 'dec' || kind === 'inc')) {
      return rowCentre(c, row) + (edge === 'left' ? -1 : 1) * c.princess.offset;
    }
    return edge === 'left' ? c.leftEdge[row] : c.rightEdge[row];
  };

  const buttonDrag = useRef<{ index: number; key: string; last: number } | null>(null);
  /** Garment point under the pointer: cm up from the lower edge and cm from that row's centre. */
  const garmentAt = (clientX: number, clientY: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    const X = (sx - v.ox) / v.scale;
    const Y = -(sy - v.oy) / v.scale;
    const g = Math.max(0, Math.min(top, Math.round(Y * rpc)));
    const row = c.topDown ? top - g : g;
    const centre = rowCentre(c, row) / spc;
    return { h: Y, x: X - centre, sx, sy };
  };
  const startWpDrag = (e: React.PointerEvent, w: ComputedPanel['waypoints'][number], kind: 'height' | 'width', part: 'width' | 'left' | 'right') => {
    if (!onDragWaypoint || !vertical || e.button !== 0 || drawLine) return;
    e.stopPropagation();
    const half0 = part === 'left' ? -w.leftPos : part === 'right' ? w.rightPos : (w.rightPos - w.leftPos) / 2;
    if (half0 <= 0) return;
    wrapRef.current?.setPointerCapture(e.pointerId);
    wpDrag.current = { wpId: w.id, kind, part, half0, key: `drag:wp:${Date.now()}`, x: e.clientX, y: e.clientY, moved: false, last: '' };
    onSelect({ kind: 'waypoint', id: w.id });
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (drawLine && vertical) {
      e.stopPropagation();
      const p = garmentAt(e.clientX, e.clientY);
      if (!drawPts.first) setDrawPts({ first: p, cursor: { sx: p.sx, sy: p.sy } });
      else {
        onDrawLine?.({ h: drawPts.first.h, x: drawPts.first.x }, { h: p.h, x: p.x });
        setDrawPts({ first: null, cursor: null });
      }
      suppressClick.current = true;
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, ox: v.ox, oy: v.oy, moved: false };
    suppressClick.current = false;
  };
  /** Knit row under the pointer as a float (row r spans r-1 … r). */
  const knitYAt = (clientX: number, clientY: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const wx = (clientX - r.left - v.ox) / v.scale;
    const wy = (clientY - r.top - v.oy) / v.scale;
    const G = (direction === 'side-to-side' ? wx : -wy) * rpc;
    return c.topDown ? top - G : G;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const bd = buttonDrag.current;
    if (bd && bands?.onDrag) {
      const p = garmentAt(e.clientX, e.clientY);
      const g = Math.max(0, Math.min(bands.edgeRows, Math.round(p.h * rpc)));
      if (g !== bd.last) {
        bd.last = g;
        bands.onDrag(bd.index, g / rpc, bd.key);
      }
      setWpReadout({ sx: p.sx, sy: p.sy, text: `button ${bd.index + 1} · ${len(g / rpc, units)} up · this size` });
      return;
    }
    const wd = wpDrag.current;
    if (wd && onDragWaypoint) {
      if (!wd.moved && Math.hypot(e.clientX - wd.x, e.clientY - wd.y) < 3) return;
      wd.moved = true;
      suppressClick.current = true;
      const p = garmentAt(e.clientX, e.clientY);
      if (wd.kind === 'height') {
        const g = Math.max(0, Math.round(p.h * rpc));
        const sig = `h${g}`;
        if (sig !== wd.last) {
          wd.last = sig;
          onDragWaypoint(wd.wpId, { kind: 'height', h: g / rpc }, e.altKey, wd.key);
        }
        setWpReadout({ sx: p.sx, sy: p.sy, text: `row ${c.topDown ? top - g : g} · ${len(g / rpc, units)} up${e.altKey ? ' · this size only' : ''}` });
      } else {
        // Half width from the centre line, snapped to half stitches.
        const r = wrapRef.current!.getBoundingClientRect();
        const X = (e.clientX - r.left - v.ox) / v.scale;
        const half = Math.max(1, Math.round(Math.abs(X) * spc * 2) / 2);
        const factor = half / wd.half0;
        const sig = `w${half}`;
        if (sig !== wd.last) {
          wd.last = sig;
          onDragWaypoint(wd.wpId, { kind: 'width', part: wd.part, factor }, e.altKey, wd.key);
        }
        setWpReadout({ sx: p.sx, sy: p.sy, text: `${wd.part === 'width' ? sts(Math.round(half * 2)) : `${wd.part} half ${sts(half)}`}${e.altKey ? ' · this size only' : ''}` });
      }
      return;
    }
    if (drawLine && drawPts.first) {
      const r = wrapRef.current!.getBoundingClientRect();
      setDrawPts((d) => ({ ...d, cursor: { sx: e.clientX - r.left, sy: e.clientY - r.top } }));
    }
    const md = markerDrag.current;
    if (md && markers) {
      const y = knitYAt(e.clientX, e.clientY);
      // Step markers sit at the top of the previous row, so the row is the one above that line.
      const row = Math.max(md.seg.rowFrom, Math.min(md.seg.rowTo, Math.round(md.stepLike ? y + 1 : y)));
      const others = md.others;
      if (row !== md.row && !others.includes(row)) {
        markers.move(md.seg.fromWaypoint, md.edge, md.index, row - md.seg.rowFrom + 1, md.key);
        md.index = others.filter((r) => r < row).length; // position after re-sorting
        md.row = row;
        md.moved = true;
        setDragRow(row);
      }
      return;
    }
    const r = wrapRef.current!.getBoundingClientRect();
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) > 3) {
        d.moved = true;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      }
      if (d.moved) setView({ ...v, ox: d.ox + dx, oy: d.oy + dy });
    }
    // Hover row readout.
    const wx = (e.clientX - r.left - v.ox) / v.scale;
    const wy = (e.clientY - r.top - v.oy) / v.scale;
    const G = Math.round((direction === 'side-to-side' ? wx : -wy) * rpc);
    const row = c.topDown ? top - G : G;
    setHoverRow(row >= 0 && row <= top ? row : null);
  };
  const onPointerUp = () => {
    if (buttonDrag.current) {
      buttonDrag.current = null;
      setWpReadout(null);
      suppressClick.current = true;
      return;
    }
    if (wpDrag.current) {
      if (wpDrag.current.moved) suppressClick.current = true;
      wpDrag.current = null;
      setWpReadout(null);
      return;
    }
    const md = markerDrag.current;
    if (md) {
      markerDrag.current = null;
      setDragRow(null);
      suppressClick.current = true;
      onSelect({ kind: 'segment', fromWaypoint: md.seg.fromWaypoint, edge: md.edge, marker: md.index });
      return;
    }
    if (drag.current?.moved) suppressClick.current = true;
    drag.current = null;
  };

  // Width labels normally sit above their line; near the neck notch they go below so they don't collide.
  // Inside the neck notch there is no room: the width goes into the side label instead.
  const labelBelow = (row: number) => (c.neck ? garmentRow(row) >= garmentRow(c.neck.splitRow - 1) - 12 : false);
  const inNeck = (row: number) => (c.neck ? garmentRow(row) > garmentRow(c.neck.splitRow - 1) + 2 && row !== c.neck.openRow : false);

  // A waypoint just below another (e.g. underarm and the bind-off 2 rows up) puts its width label below its line.
  const crowdedAbove = (i: number) => i + 1 < gw.length && Math.abs(S(0, gw[i + 1].row).y - S(0, gw[i].row).y) < 16;

  const hem = gw[0];
  const topWp = gw[gw.length - 1];
  const finishedCm = (n: number, selvedge: number) => (n - selvedge) / spc;

  // ---- several sizes at once ----
  if (mode === 'grid' && project) {
    const cells = compare.filter((x) => x.ok).map((x) => ({
      sid: x.sizeId,
      name: (() => { const s = project.sizes.find((z) => z.id === x.sizeId); return s ? sizeText(s, project) : ''; })(),
      shapes: [localOutline(x)],
      caption: `${x.counts[x.topDown ? x.totalRows : 0]} sts · ${x.totalRows} rows`,
    }));
    return (
      <div className="canvas" ref={wrapRef}>
        <SizeGrid cells={cells} size={size} project={project} />
        <div className="canvas-hint">Grid: every size at the same scale</div>
      </div>
    );
  }
  if (mode === 'overlay' && project && direction !== 'side-to-side') {
    const L = (p: Pt) => ({ x: v.ox + p.x * v.scale, y: v.oy - p.y * v.scale });
    const sizeIdx = (sid: string) => project.sizes.findIndex((z) => z.id === sid);
    const shown = compare.filter((x) => x.ok).sort((a, b) => sizeIdx(b.sizeId) - sizeIdx(a.sizeId));
    return (
      <div className="canvas" ref={wrapRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <svg width={size.w} height={size.h} className="schematic">
          {shown.map((x) => {
            const shift = alignShift(x, c, align);
            const color = sizeColor(sizeIdx(x.sizeId), project.sizes.length);
            const pts = localOutline(x).map((p) => L({ x: p.x, y: p.y + shift }));
            const bust = x.bust;
            return (
              <g key={x.sizeId} style={{ color }}>
                <path d={path(pts, true)} className={`overlay-outline${x.sizeId === c.sizeId ? ' current' : ''}`} style={{ stroke: color }} />
                {bust?.shortRows && (() => {
                  const bands = wedgeBands(bust);
                  const at = (xs: number, row: number) => { const q = toLocal(x, { x: xs, y: row }); return L({ x: q.x, y: q.y + shift }); };
                  const ptsL = bands.flatMap((w) => [at(w.leftX, w.from), at(w.leftX, w.to)]);
                  const ptsR = bands.flatMap((w) => [at(w.rightX, w.from), at(w.rightX, w.to)]);
                  return <path d={path([...ptsL, ...ptsR.reverse()], true)} className="overlay-wedge" style={{ stroke: color, fill: color }} />;
                })()}
                {bust && [bust.apex.leftX, bust.apex.rightX].map((ax, k) => {
                  if (x.half && (x.half.keep === 'right' ? ax <= x.half.cfX : ax >= x.half.cfX)) return null;
                  const q = toLocal(x, { x: ax, y: bust.apex.row });
                  const sp = L({ x: q.x, y: q.y + shift });
                  return <circle key={k} cx={sp.x} cy={sp.y} r={3} className="overlay-apex" style={{ stroke: color }} />;
                })}
              </g>
            );
          })}
        </svg>
        <SizeLegend project={project} sizes={compare.map((x) => x.sizeId)} current={c.sizeId} align={align} />
        <div className="canvas-hint">Overlay: outlines aligned at the {align}{c.bust ? ' · bust points and short-row wedges per size' : ''}</div>
      </div>
    );
  }

  return (
    <div
      className="canvas"
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHoverRow(null)}
      onClick={() => !suppressClick.current && !drawLine && onSelect({ kind: 'panel' })}
      style={drawLine ? { cursor: 'crosshair' } : undefined}
    >
      <svg width={size.w} height={size.h} className="schematic">
        <defs>
          <pattern id="section-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
          </pattern>
          <clipPath id="panel-clip">
            <path d={path(c.outline.map((p) => S(p.x, p.y)), true)} />
          </clipPath>
        </defs>

        {/* panel body */}
        <path d={path(c.outline.map((p) => S(p.x, p.y)), true)} className="outline" />

        {/* in-the-round part */}
        {c.roundRows && vertical && (() => {
          const a = S(minX, c.roundRows.from - 1);
          const b = S(maxX, c.roundRows.to);
          const y0 = Math.min(a.y, b.y);
          const h = Math.abs(b.y - a.y);
          const joinRow = c.topDown ? c.roundRows.from - 1 : c.roundRows.to;
          const j0 = S(c.leftEdge[joinRow], joinRow);
          const j1 = S(c.rightEdge[joinRow], joinRow);
          const whole = c.roundRows.from === 1 && c.roundRows.to === c.totalRows;
          return (
            <g className="round-part" pointerEvents="none">
              <rect x={a.x} y={y0} width={b.x - a.x} height={h} clipPath="url(#panel-clip)" className="round-fill" />
              {!whole && <line x1={j0.x - 10} y1={j0.y} x2={j1.x + 10} y2={j1.y} className="join-line" />}
              <text x={whole ? (j0.x + j1.x) / 2 : j0.x + 8} y={whole ? y0 + h / 2 : j0.y + 13} textAnchor={whole ? 'middle' : 'start'} className="round-label">
                {whole ? 'worked in the round' : 'joined in the round below'}
              </text>
            </g>
          );
        })()}

        {/* pattern sections */}
        {vertical &&
          c.sections.map((sec) => {
            const a = S(minX, sec.fromRow);
            const b = S(maxX, sec.toRow);
            const y0 = Math.min(a.y, b.y);
            const h = Math.max(2, Math.abs(b.y - a.y));
            return (
              <g key={sec.id} className="section" pointerEvents="none">
                <rect x={a.x} y={y0} width={b.x - a.x} height={h} fill="url(#section-hatch)" clipPath="url(#panel-clip)" />
                <text x={(a.x + b.x) / 2} y={y0 + h / 2 + 4} textAnchor="middle" className="section-label">
                  {sec.name} · {sec.patternName} ({sec.multiple}{sec.offset ? ` + ${sec.offset}` : ''})
                </text>
              </g>
            );
          })}

        {/* region sizing: segments running between regions that follow different sizes */}
        {vertical &&
          transitions.map((t) => {
            const a = S(minX, t.lower.row);
            const b = S(maxX, t.upper.row);
            const y0 = Math.min(a.y, b.y);
            const h = Math.max(2, Math.abs(b.y - a.y));
            return (
              <g key={t.lower.waypointId} className="region-band" pointerEvents="none">
                <rect x={a.x} y={y0} width={b.x - a.x} height={h} clipPath="url(#panel-clip)" className="region-fill" />
                <text x={(a.x + b.x) / 2} y={y0 + h / 2 + 4} textAnchor="middle" className="region-label">
                  {t.label}
                </text>
              </g>
            );
          })}

        {/* waypoint lines and width labels */}
        {gw.map((w, i) => {
          const a = S(c.leftEdge[w.row], w.row);
          const b = S(c.rightEdge[w.row], w.row);
          const sel = isSel({ kind: 'waypoint', id: w.id });
          const showWidth = i > 0 && !(w === topWp && c.neck) && !inNeck(w.row);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          return (
            <g key={w.id} className={`wp${sel ? ' selected' : ''}`} onClick={click({ kind: 'waypoint', id: w.id })}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="wp-line" />
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className={`hit${onDragWaypoint && vertical && i > 0 && sel ? ' drag-y' : ''}`}
                onPointerDown={(e) => i > 0 && sel && startWpDrag(e, w, 'height', 'width')}
              />
              {onDragWaypoint && vertical && i > 0 && sel && (
                <g className="wp-grip" onPointerDown={(e) => startWpDrag(e, w, 'height', 'width')}>
                  <rect x={(a.x + b.x) / 2 - 14} y={(a.y + b.y) / 2 - 7} width={28} height={14} rx={7} />
                  <path d={`M${(a.x + b.x) / 2 - 6},${(a.y + b.y) / 2 - 2} h12 M${(a.x + b.x) / 2 - 6},${(a.y + b.y) / 2 + 2} h12`} />
                  <title>Drag up or down (or use ↑ ↓; Alt: this size only)</title>
                </g>
              )}

              {showWidth && vertical && (
                <text x={mid.x} y={mid.y + (labelBelow(w.row) || crowdedAbove(i) ? 13 : -5)} className="dim-text" textAnchor="middle">
                  {len(finishedCm(w.actualStitches, w.selvedge), units)} · {sts(w.actualStitches)}
                </text>
              )}
            </g>
          );
        })}

        {/* hem width below the panel */}
        {vertical && (() => {
          const a = S(c.leftEdge[hem.row], hem.row);
          const b = S(c.rightEdge[hem.row], hem.row);
          const dy = 22;
          const n = c.counts[hem.row];
          return (
            <g className="dim">
              <DimLine a={{ x: a.x, y: a.y + dy }} b={{ x: b.x, y: b.y + dy }} />
              <text x={(a.x + b.x) / 2} y={a.y + dy + 14} className="dim-text" textAnchor="middle">
                {hem.name}: {len(finishedCm(n, hem.selvedge), units)} · {c.topDown ? 'bind off' : 'cast on'} {sts(n)}
              </text>
            </g>
          );
        })()}

        {/* top-down: how the first row is made */}
        {vertical && c.topDown && (() => {
          const a = S(minX, 0);
          const n = c.counts[0];
          const pickup = project?.panels.find((x) => x.id === c.panelId)?.startFrom === 'pickup';
          return (
            <text x={a.x} y={a.y - 46} className="dim-text start-label">
              {pickup ? `pick up ${sts(n)} along the back shoulders` : `cast on ${sts(n)}`}
            </text>
          );
        })()}

        {/* height chain on the left */}
        {vertical &&
          gw.slice(1).map((w, i) => {
            const lo = gw[i];
            const x = S(minX, 0).x - 26;
            const y0 = S(0, lo.row).y;
            const y1 = S(0, w.row).y;
            const h = Math.abs(y1 - y0);
            const n = Math.abs(w.row - lo.row);
            const cm = n / rpc;
            const full = `${len(cm, units)} · ${n} r`;
            const short = `${n} r`;
            const label = h > textWidth(full) + 8 ? full : h > textWidth(short) + 6 ? short : null;
            return (
              <g key={w.id} className="dim">
                <DimLine a={{ x, y: y0 }} b={{ x, y: y1 }} />
                {label && (
                  <text x={x - 6} y={(y0 + y1) / 2} className="dim-text" textAnchor="middle" transform={`rotate(-90 ${x - 6} ${(y0 + y1) / 2})`}>
                    {label}
                  </text>
                )}
              </g>
            );
          })}
        {vertical && (() => {
          const x = S(minX, 0).x - 64;
          const y0 = S(0, 0).y;
          const y1 = S(0, top).y;
          return (
            <g className="dim">
              <DimLine a={{ x, y: y0 }} b={{ x, y: y1 }} />
              <text x={x - 6} y={(y0 + y1) / 2} className="dim-text strong" textAnchor="middle" transform={`rotate(-90 ${x - 6} ${(y0 + y1) / 2})`}>
                {len(top / rpc, units)} · {rowsText(top)}
              </text>
            </g>
          );
        })()}

        {/* waypoint names on the right */}
        {vertical &&
          wpLabels.map(({ w, y }) => {
            const end = S(c.rightEdge[w.row], w.row);
            const x = S(maxX, 0).x + 18;
            const sel = isSel({ kind: 'waypoint', id: w.id });
            return (
              <g key={w.id} className={`wp-label${sel ? ' selected' : ''}`} onClick={click({ kind: 'waypoint', id: w.id })}>
                <path d={`M${end.x + 3},${end.y} L${x - 4},${y}`} className="leader" />
                <text x={x} y={y + 4} className="wp-name">
                  {w.name}
                  <tspan className="wp-meta">
                    {' '}row {w.row}
                    {w.actualStitches !== w.stitches ? ` · ${w.actualStitches}/${w.stitches} sts` : inNeck(w.row) ? ` · ${len(finishedCm(w.actualStitches, w.selvedge), units)} · ${sts(w.actualStitches)}` : ''}
                  </tspan>
                </text>
              </g>
            );
          })}

        {/* neckline dimensions */}
        {c.neck && vertical && (() => {
          const o = c.neck.openRow;
          const nl = c.neckLeft[o]!;
          const nr = c.neckRight[o]!;
          const a = S(nl, o);
          const b = S(nr, o);
          const dy = -20;
          const splitY = S(0, c.neck.splitRow - 1).y;
          const cx = S(c.neck.centreX, 0).x;
          return (
            <g className="dim" onClick={click({ kind: 'neckline' })}>
              <DimLine a={{ x: a.x, y: a.y + dy }} b={{ x: b.x, y: b.y + dy }} />
              <text x={(a.x + b.x) / 2} y={a.y + dy - 6} className="dim-text" textAnchor="middle">
                neck {len((nr - nl) / spc, units)} · {sts(nr - nl)}
              </text>
              <DimLine a={{ x: cx, y: a.y }} b={{ x: cx, y: splitY }} />
              {Math.abs(splitY - a.y) > 14 && (
                <text x={cx + 5} y={(a.y + splitY) / 2 + 4} className="dim-text">
                  {len(c.neck.depthRows / rpc, units)} · {c.neck.depthRows} r
                </text>
              )}
            </g>
          );
        })()}

        {/* join tags along edges */}
        {joins.map(({ join, edge }, i) => {
          const pts = joinEdgePts(edge);
          if (!pts.length) return null;
          const sel = selection.kind === 'join' && selection.id === join.id;
          return (
            <g key={`${join.id}-${i}`} className={`join-edge${sel ? ' selected' : ''}`} onClick={click({ kind: 'join', id: join.id })}>
              {pts.map((p, k) => <path key={k} d={path(p)} stroke={JOIN_TAGS[join.tag].color} />)}
              <title>{`${join.name} (${JOIN_TAGS[join.tag].label})`}</title>
            </g>
          );
        })}

        {/* edge segments: hit areas + selection highlight */}
        {c.segments.map((seg) =>
          (['left', 'right'] as const).map((edge) => {
            const pts = edgePts(edge === 'left' ? c.leftEdge : c.rightEdge, seg.rowFrom, seg.rowTo);
            const sel = isSel({ kind: 'segment', fromWaypoint: seg.fromWaypoint });
            return (
              <g
                key={`${seg.fromWaypoint}-${edge}`}
                onClick={click({ kind: 'segment', fromWaypoint: seg.fromWaypoint, edge })}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!markers) return;
                  const target = seg.mirror ? 'left' : edge;
                  const row = Math.max(seg.rowFrom, Math.min(seg.rowTo, Math.round(knitYAt(e.clientX, e.clientY))));
                  markers.add(seg, target, row - seg.rowFrom + 1);
                  onSelect({ kind: 'segment', fromWaypoint: seg.fromWaypoint, edge: target });
                }}
              >
                {sel && <path d={path(pts)} className="edge-selected" />}
                <path d={path(pts)} className="hit" />
              </g>
            );
          }),
        )}
        {c.neck && (
          <g onClick={click({ kind: 'neckline' })}>
            {(['neckLeft', 'neckRight'] as const).map((k) => {
              const arr = k === 'neckLeft' ? c.neckLeft : c.neckRight;
              const pts: Pt[] = [];
              for (let r = 0; r <= top; r++) if (arr[r] !== null) pts.push(S(arr[r]!, r));
              return (
                <g key={k}>
                  {isSel({ kind: 'neckline' }) && <path d={path(pts)} className="edge-selected" />}
                  <path d={path(pts)} className="hit" />
                </g>
              );
            })}
          </g>
        )}

        {/* princess lines */}
        {c.princess &&
          c.segments
            .filter((seg) => seg.placement !== 'edge')
            .map((seg) =>
              (['left', 'right'] as const).map((edge) => {
                const pts: Pt[] = [];
                for (let r = Math.max(0, seg.rowFrom - 1); r <= seg.rowTo; r++) pts.push(S(shapeX(seg, edge, r, 'dec'), r));
                return <path key={`pl-${seg.fromWaypoint}-${edge}`} d={path(pts)} className="princess-line" />;
              }),
            )}

        {/* shaping lines */}
        {vertical &&
          c.lines.map((l) => {
            const sel = selection.kind === 'line' && selection.id === l.id;
            const centre = (r: number) => rowCentre(c, r);
            const twins = l.mirror ? [1, -1] : [1];
            return (
              <g key={l.id} className={`shaping-line${sel ? ' selected' : ''}`} onClick={click({ kind: 'line', id: l.id })}>
                {twins.map((sgn) => {
                  const a = S(centre(l.ends[0].row) + sgn * l.ends[0].x, l.ends[0].row);
                  const b = S(centre(l.ends[1].row) + sgn * l.ends[1].x, l.ends[1].row);
                  return (
                    <g key={sgn}>
                      <path d={`M${a.x},${a.y} L${b.x},${b.y}`} className="line-path" />
                      <path d={`M${a.x},${a.y} L${b.x},${b.y}`} className="hit" />
                      {l.events.map((ev, k) => {
                        const p = S(centre(ev.row) + sgn * lineX(l, ev.row), ev.row);
                        return <circle key={k} cx={p.x} cy={p.y} r={2.2} className={ev.delta < 0 ? 'mk-dec' : 'mk-inc'} />;
                      })}
                    </g>
                  );
                })}
                <title>{`${l.name}: ${l.amount > 0 ? '+' : ''}${l.amount} sts${l.mirror ? ' per line, mirrored' : ''}`}</title>
              </g>
            );
          })}
        {/* width handles of the selected waypoint (on top, so the edges don't cover them) */}
        {onDragWaypoint && vertical && selection.kind === 'waypoint' && (() => {
          const w = c.waypoints.find((x) => x.id === selection.id);
          if (!w) return null;
          return (['left', 'right'] as const).map((side) => {
            const p = S(side === 'left' ? c.leftEdge[w.row] : c.rightEdge[w.row], w.row);
            const part = w.symmetric ? 'width' : side;
            return (
              <rect key={side} x={p.x - 5} y={p.y - 5} width={10} height={10} className="wp-handle" onPointerDown={(e) => startWpDrag(e, w, 'width', part)}>
                <title>Drag to change the width (Alt: this size only)</title>
              </rect>
            );
          });
        })()}
        {wpReadout && (
          <text x={wpReadout.sx + 12} y={wpReadout.sy - 10} className="drag-label">
            {wpReadout.text}
          </text>
        )}
        {drawLine && drawPts.first && drawPts.cursor && (
          <line x1={drawPts.first.sx} y1={drawPts.first.sy} x2={drawPts.cursor.sx} y2={drawPts.cursor.sy} className="draw-preview" />
        )}

        {/* painted stitches */}
        {vertical &&
          (project?.panels.find((x) => x.id === c.panelId)?.freeStitches ?? [])
            .filter((f) => f.sizeId === c.sizeId && f.row >= 1 && f.row <= top)
            .flatMap((f) =>
              freeCells(f).map((cell, k) => {
                const p = S(rowCentre(c, f.row) + cell.x + 0.5, f.row - 0.5);
                return (
                  <rect key={`${f.id}-${k}`} x={p.x - 2} y={p.y - 2} width={4} height={4} className="free-st" fill={bandColor(cell.symbol, project?.symbols) ?? 'var(--muted)'}>
                    <title>{`Painted ${cell.symbol}, row ${f.row}`}</title>
                  </rect>
                );
              }),
            )}

        {/* shaping markers */}
        <g className="markers">
          {c.markers.map((m, i) => (
            <MarkerGlyph key={i} m={m} p={S(m.x, m.kind === 'dec' || m.kind === 'inc' ? m.row : m.row - 1)} />
          ))}
        </g>

        {/* cardigan band, buttons and buttonholes */}
        {bands && vertical && (() => {
          const gy = (hCm: number) => (c.topDown ? top - hCm * rpc : hCm * rpc);
          const parts: React.ReactNode[] = [];
          const [x1, x2] = bands.bandX;
          if (bands.edgeRows > 0 && x2 > x1) {
            const a = S(x1, c.topDown ? top : 0);
            const b = S(x2, c.topDown ? top - bands.edgeRows : bands.edgeRows);
            parts.push(<rect key="band" x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} className={`band-strip${bands.integrated ? ' integrated' : ''}`} />);
            const lab = S((x1 + x2) / 2, c.topDown ? top - bands.edgeRows / 2 : bands.edgeRows / 2);
            parts.push(
              <text key="bandlabel" transform={`translate(${lab.x + 3},${lab.y}) rotate(-90)`} textAnchor="middle" className="band-label">
                {bands.label}
              </text>,
            );
          }
          bands.buttons.forEach((h, i) => {
            const p = S((x1 + x2) / 2, gy(h));
            parts.push(
              <g
                key={`b${i}`}
                className={`button-mark ${bands.kind}${bands.onDrag ? ' draggable' : ''}`}
                onPointerDown={(e) => {
                  if (!bands.onDrag || e.button !== 0) return;
                  e.stopPropagation();
                  wrapRef.current?.setPointerCapture(e.pointerId);
                  buttonDrag.current = { index: i, key: `drag:button:${Date.now()}`, last: -1 };
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {bands.kind === 'button' ? <circle cx={p.x} cy={p.y} r={5} /> : <rect x={p.x - 6} y={p.y - 2} width={12} height={4} rx={2} />}
                <title>{`Button ${i + 1}: ${len(h, units)} up${bands.onDrag ? ' — drag to move (this size)' : ''}`}</title>
              </g>,
            );
          });
          for (const h of bands.holes) {
            const p = S(h.x + bands.holeWidth / 2, h.row - 0.5);
            parts.push(
              <rect key={`h${h.index}`} x={p.x - 5} y={p.y - 2} width={10} height={4} rx={2} className="button-mark hole on-panel">
                <title>{`Buttonhole ${h.index + 1}: row ${h.row}`}</title>
              </rect>,
            );
          }
          return <g className="bands">{parts}</g>;
        })()}

        {/* bust shaping */}
        {c.bust && vertical && (() => {
          const b = c.bust;
          const sel = selection.kind === 'bust';
          const parts: React.ReactNode[] = [];
          const sr = b.shortRows;
          // A cardigan front shows only what lies on its own half.
          const onHalf = (x: number) => !c.half || (c.half.keep === 'right' ? x > c.half.cfX : x < c.half.cfX);
          if (sr && sr.pairs.length) {
            // Extra rows exist between each pair's turns: a stepped wedge, 2 rows per pair, in working order
            // (drawn over the rows that follow in knitting order).
            const bands = wedgeBands(b);
            const base = sr.afterRow;
            const ptsL: Pt[] = bands.flatMap((w) => [S(w.leftX, w.from), S(w.leftX, w.to)]);
            const ptsR: Pt[] = bands.flatMap((w) => [S(w.rightX, w.from), S(w.rightX, w.to)]);
            const poly = [...ptsL, ...[...ptsR].reverse()];
            parts.push(<path key="wedge" d={path(poly, true)} className={`bust-wedge${sr.kind === 'dart' ? ' dart' : ''}`} />);
            if (sr.kind === 'dart') {
              // Draw the classic dart legs from the side edge to the tip.
              for (const side of c.half ? [c.half.keep === 'right' ? 1 : -1] : [-1, 1]) {
                const edgeX = side < 0 ? c.leftEdge[base] : c.rightEdge[base];
                const tipX = rowCentre(c, base) + side * sr.tipX;
                const a = S(edgeX, base);
                const t = S(tipX, base + sr.extraRows / 2);
                const z = S(edgeX, base + sr.extraRows);
                parts.push(<path key={`leg${side}`} d={`M${a.x},${a.y} L${t.x},${t.y} L${z.x},${z.y}`} className="dart-legs" />);
              }
            }
            if (sel) {
              bands.forEach((w, k) => {
                const pr = sr.pairs[k];
                const pl = S(w.leftX, w.from + 1);
                const pr2 = S(w.rightX, w.from + 1);
                if (sr.oneSide) {
                  const at = sr.oneSide === 'left' ? pl : pr2;
                  parts.push(
                    <text key={`o${pr.index}`} x={at.x + (sr.oneSide === 'left' ? -4 : 4)} y={at.y + 3} textAnchor={sr.oneSide === 'left' ? 'end' : 'start'} className="turn-label">
                      SR{2 * pr.index - 1}–{2 * pr.index} · {pr.rsWorked}
                    </text>,
                  );
                  return;
                }
                parts.push(
                  <text key={`l${pr.index}`} x={pl.x - 4} y={pl.y + 3} textAnchor="end" className="turn-label">
                    SR{2 * pr.index - 1} · {pr.rsWorked}
                  </text>,
                  <text key={`r${pr.index}`} x={pr2.x + 4} y={pr2.y + 3} className="turn-label">
                    SR{2 * pr.index} · {pr.wsWorked}
                  </text>,
                );
              });
            }
            const top = S(rowCentre(c, base), c.topDown ? base : base + sr.extraRows);
            parts.push(
              <text key="srlabel" x={top.x} y={top.y - 4} textAnchor="middle" className="bust-label">
                +{sr.extraRows} short rows after row {sr.afterRow} · +{len(sr.extraRows / rpc, units)} at centre front
              </text>,
            );
          }
          const d = b.darts;
          if (d) {
            for (const [key, x] of [['l', d.leftX], ['r', d.rightX]] as const) {
              if (!onHalf(x)) continue;
              const left: Pt[] = [];
              const right: Pt[] = [];
              for (let r = 0; r <= top; r++) {
                if (d.interior[r] <= 0 && (r === 0 || d.interior[r - 1] <= 0)) continue;
                const w = d.interior[r] / 4; // half of one dart's width
                left.push(S(x - w, r));
                right.push(S(x + w, r));
              }
              if (left.length) parts.push(<path key={`d${key}`} d={path([...left, ...right.reverse()], true)} className="bust-dart" />);
              for (const r of d.incRows) parts.push(<circle key={`i${key}${r}`} cx={S(x, r).x} cy={S(x, r).y} r={1.8} className={c.topDown ? 'mk-dec' : 'mk-inc'} />);
              for (const r of d.decRows) parts.push(<circle key={`c${key}${r}`} cx={S(x, r).x} cy={S(x, r).y} r={1.8} className={c.topDown ? 'mk-inc' : 'mk-dec'} />);
            }
          }
          // Bust points.
          for (const [key, x] of [['l', b.apex.leftX], ['r', b.apex.rightX]] as const) {
            if (!onHalf(x)) continue;
            const p = S(x, b.apex.row);
            parts.push(
              <g key={`apex${key}`} className="apex">
                <circle cx={p.x} cy={p.y} r={4.5} />
                <path d={`M${p.x - 6},${p.y} L${p.x + 6},${p.y} M${p.x},${p.y - 6} L${p.x},${p.y + 6}`} />
              </g>,
            );
          }
          return (
            <g className={`bust${sel ? ' selected' : ''}`} onClick={click({ kind: 'bust' })}>
              {parts}
            </g>
          );
        })()}

        {/* editable handles for the selected segment edge */}
        {markers && selection.kind === 'segment' && (() => {
          const seg = c.segments.find((s) => s.fromWaypoint === selection.fromWaypoint);
          if (!seg) return null;
          const editable: Edge = seg.mirror ? 'left' : selection.edge ?? 'left';
          return (
            <g className="handles">
              {seg[editable].events.map((ev, i) => {
                const p = S(shapeX(seg, editable, ev.row, ev.kind), isStepLike(ev) ? ev.row - 1 : ev.row);
                const sel = selection.marker === i && selection.edge === editable;
                const sym = SYMBOLS[ev.symbol as SymbolId];
                return (
                  <g
                    key={i}
                    className={`handle k-${ev.kind}${sel ? ' selected' : ''}`}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      (e.currentTarget.ownerSVGElement?.parentElement as HTMLElement | null)?.setPointerCapture(e.pointerId);
                      markerDrag.current = {
                        seg,
                        edge: editable,
                        index: i,
                        stepLike: isStepLike(ev),
                        key: `drag:${Date.now()}`,
                        row: ev.row,
                        others: seg[editable].events.filter((_, j) => j !== i).map((x) => x.row),
                        moved: false,
                      };
                      suppressClick.current = true;
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <circle cx={p.x} cy={p.y} r={6} />
                    <title>{`Row ${ev.row}: ${sym?.abbr ?? ev.symbol} ${ev.delta > 0 ? '+' : ''}${ev.delta} — drag to move, Delete to remove`}</title>
                  </g>
                );
              })}
            </g>
          );
        })()}

        {/* drag readout */}
        {dragRow !== null && markerDrag.current && (() => {
          const md = markerDrag.current;
          const p = S(shapeX(md.seg, md.edge, dragRow, md.stepLike ? 'bindoff' : 'dec'), md.stepLike ? dragRow - 1 : dragRow);
          return (
            <text x={p.x + (md.edge === 'left' ? -12 : 12)} y={p.y - 8} className="drag-label" textAnchor={md.edge === 'left' ? 'end' : 'start'}>
              row {dragRow} · {sts(c.counts[dragRow])}
            </text>
          );
        })()}

        {/* hover readout */}
        {hoverRow !== null && dragRow === null && vertical && (() => {
          const a = S(c.leftEdge[hoverRow], hoverRow);
          const b = S(c.rightEdge[hoverRow], hoverRow);
          return (
            <g className="hover" pointerEvents="none">
              <line x1={a.x - 8} y1={a.y} x2={b.x + 8} y2={b.y} />
              <text x={b.x + 12} y={b.y - 6}>
                row {hoverRow} · {sts(c.counts[hoverRow])} · {len(hoverRow / rpc, units)}
              </text>
            </g>
          );
        })()}
      </svg>
      <div className="canvas-hint">
        Scroll to zoom · drag to pan · F to fit
        {markers && selection.kind === 'segment' ? ' · drag a marker to move it · double-click the edge to add one · Delete removes the selected marker' : ' · click an edge to edit its shaping'}
      </div>
    </div>
  );
}

/** Rough width of 10.5px label text, enough to decide whether a label fits. */
function textWidth(t: string): number {
  return t.length * 5.6;
}

function DimLine({ a, b }: { a: Pt; b: Pt }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * 4;
  const ny = (dx / L) * 4;
  return (
    <g className="dim-line">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      <line x1={a.x - nx} y1={a.y - ny} x2={a.x + nx} y2={a.y + ny} />
      <line x1={b.x - nx} y1={b.y - ny} x2={b.x + nx} y2={b.y + ny} />
    </g>
  );
}

function MarkerGlyph({ m, p }: { m: Marker; p: Pt }) {
  switch (m.kind) {
    case 'dec':
      return <circle cx={p.x} cy={p.y} r={2.4} className="mk-dec" />;
    case 'inc':
      return <circle cx={p.x} cy={p.y} r={2.4} className="mk-inc" />;
    case 'turn':
      return <path d={`M${p.x - 3},${p.y + 2.5} L${p.x + 3},${p.y + 2.5} L${p.x},${p.y - 3}Z`} className="mk-turn" />;
    default:
      return <rect x={p.x - 2.5} y={p.y - 2.5} width={5} height={5} className={m.kind === 'caston' ? 'mk-inc' : 'mk-bo'} />;
  }
}
