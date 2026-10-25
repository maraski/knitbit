// A yoke laid flat (yokeFront.ts): folded at the top of each sleeve, the back half above the front half, both
// upright and RS facing. The schematic draws the zones in cm with the markers, phases and labels; the chart every
// stitch as a cell with its symbol. Hover (a tap on touch) reads out the stitch and its row's shaping.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildChart, PLAIN, type Chart } from '../../engine/chart';
import { ZONES, zoneName, type YokeResult } from '../../engine/contiguous';
import type { CustomSymbol, Panel, Project } from '../../engine/model';
import type { ComputedPanel } from '../../engine/panel';
import type { Units } from '../../engine/units';
import { boundaryLineFront, frontGeometry, hitFront, partShapes, type FrontGeometry, type FrontRow, type Half } from '../../engine/yokeFront';
import { zoneStarts } from '../../engine/yokePanel';
import { stitchReadout } from '../../engine/yokeShaping';
import { zoneOffsets } from '../../engine/yokeTop';
import { len } from '../format';
import { cellFill, Glyph, Swatch } from '../glyphs';
import { sizeColor } from '../sizeColors';
import { cancelDrag, pinchView, TOUCH_SLOP, usePinch, useTouchUi, zoomView } from '../touch';
import { YokeKey } from './YokeKey';
import type { YokeButtons } from './YokeTopView';

type Mode = 'single' | 'overlay' | 'grid';

interface Props {
  buttons?: YokeButtons;
  project: Project;
  panel: Panel;
  computed: ComputedPanel;
  view: 'schematic' | 'chart';
  mode: Mode;
  compare: ComputedPanel[];
  units: Units;
}

interface ViewState {
  scale: number; // px per world unit (cm on the schematic, a stitch on the chart)
  ox: number;
  oy: number;
}

type Pt = { x: number; y: number };
/** Screen point of a half's point: x in stitches from its centre line, y down from the cast-on (cm on the schematic,
 * rows on the chart). */
type ToScreen = (half: Half, x: number, y: number) => Pt;

const PAD = 40;
const KEY_H = 150;
const HALVES: Half[] = ['back', 'front'];
const TITLE: Record<Half, string> = { back: 'Back · seen from behind', front: 'Front · seen from the front' };

/** World layout of the two halves: the back from y = 0, the front from `frontY0`; x from xmin to xmax. */
interface Layout {
  chart: boolean;
  H: number;
  frontY0: number;
  xmin: number;
  xmax: number;
  spc: number;
}

function layoutFor(gs: FrontGeometry[], chart: boolean, spc: number): Layout {
  const H = Math.max(1, ...gs.map((g) => (chart ? g.rows.length : g.height)));
  const xs = chart ? 1 : 1 / spc;
  const xmin = Math.min(0, ...gs.map((g) => Math.min(g.extent.back.min, g.extent.front.min))) * xs;
  const xmax = Math.max(0, ...gs.map((g) => Math.max(g.extent.back.max, g.extent.front.max))) * xs;
  // Room between the halves for the back's split label and the front's title.
  return { chart, H, frontY0: H + Math.max(H * 0.45, (xmax - xmin) * 0.12), xmin, xmax, spc };
}

const path = (pts: Pt[], close = false) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('') + (close ? 'Z' : '');

/** A half's widest stitches on a row (worked stitches, from the zone parts). */
function extentOf(r: FrontRow, half: Half): { min: number; max: number } | null {
  const ps = r.parts.filter((p) => p.half === half);
  if (!ps.length) return null;
  return { min: Math.min(...ps.map((p) => p.x0)), max: Math.max(...ps.map((p) => p.x1)) };
}

/** Rows that end a phase (dashed lines), as the top view draws its rings. */
function phaseRows(y: YokeResult): number[] {
  const { A, C, D, neckRow, total, E } = y.counts;
  const os = y.offShoulder;
  const rows: number[] = [];
  if (y.raglan) rows.push(total - E);
  rows.push(A);
  if (C) rows.push(A + C);
  if (D) rows.push(A + C + D);
  if (os && !os.noBand) rows.push(os.bandRows);
  if (neckRow && neckRow <= total && (!os || !!y.shortRows?.pairs)) rows.push(neckRow);
  return [...new Set(rows)].filter((r) => r > 0 && r < total);
}

export function YokeFrontView({ project, panel, computed: c, view, mode, compare, units, buttons }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [vs, setVs] = useState<ViewState | null>(null);
  const [hover, setHover] = useState<{ sx: number; sy: number; text: string } | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const buttonDrag = useRef<{ index: number; key: string; last: number } | null>(null);

  const y = c.yoke;
  const isChart = view === 'chart';
  // The chart shows every row (a folded band's facing too); the schematic the band folded.
  const geo = useMemo(() => (y ? frontGeometry(y, !isChart) : null), [y, isChart]);
  const all = useMemo(() => compare.filter((x) => x.yoke).map((x) => ({ c: x, g: frontGeometry(x.yoke!, true) })), [compare]);
  const spc = y?.stitchesPerCm ?? 1;
  const L = useMemo(() => layoutFor(geo ? (mode === 'overlay' ? [geo, ...all.map((a) => a.g)] : [geo]) : [], isChart, spc), [geo, all, mode, isChart, spc]);

  const fit = useCallback(() => {
    // Beside the key box or under it, whichever leaves the drawing bigger (titles take about 30 px above each half).
    const key = mode === 'single' ? wrapRef.current?.querySelector<HTMLElement>('.yoke-key') : null;
    const keyW = key ? key.offsetWidth + 20 : 0;
    const keyH = key ? Math.max(KEY_H, key.offsetHeight + 10) : 0;
    const wW = L.xmax - L.xmin;
    const wH = L.frontY0 + L.H;
    const area = (left: number, top: number) => {
      const w = size.w - left - 2 * PAD;
      const h = size.h - top - 2 * PAD - 40 - 30;
      return { left, top, w, h, scale: Math.max(0.05, Math.min(w / wW, h / wH)) };
    };
    const a = [area(0, keyH), area(keyW, 0)].sort((p, q) => q.scale - p.scale)[0];
    setVs({ scale: a.scale, ox: a.left + PAD + a.w / 2 - ((L.xmin + L.xmax) / 2) * a.scale, oy: a.top + PAD + 30 + (a.h - wH * a.scale) / 2 });
  }, [size.w, size.h, L, mode]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    fit();
  }, [fit, panel.id, mode, view]);
  useEffect(() => {
    const onFit = () => fit();
    window.addEventListener('knitbit:fit', onFit);
    return () => window.removeEventListener('knitbit:fit', onFit);
  }, [fit]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setVs((v) => v && zoomView(v, Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top }, 0.05, 400));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const touchUi = useTouchUi();
  usePinch(wrapRef, {
    start: () => {
      if (buttonDrag.current) cancelDrag(buttonDrag.current.key);
      buttonDrag.current = null;
      drag.current = null;
      setHover(null);
    },
    move: (s) => setVs((v) => v && pinchView(v, s, 0.05, 400)),
  });

  const chart = useMemo(() => (isChart && y && c.ok ? buildChart(project, panel, c) : null), [isChart, y, c, project, panel]);

  if (!y || !geo) return <div className="canvas yoke-top"><p className="muted pad">This yoke can't be drawn in this size.</p></div>;
  const v = vs ?? { scale: 4, ox: size.w / 2, oy: size.h / 2 };
  const P = (x: number, yy: number) => ({ x: v.ox + x * v.scale, y: v.oy + yy * v.scale });
  const S: ToScreen = (half, x, yy) => P(isChart ? x : x / spc, (half === 'front' ? L.frontY0 : 0) + yy);

  /** The half and its local y (cm or rows) under a screen point. */
  const locate = (sx: number, sy: number): { half: Half; wx: number; ly: number } | null => {
    const wx = (sx - v.ox) / v.scale;
    const wy = (sy - v.oy) / v.scale;
    if (wy >= 0 && wy < L.H) return { half: 'back', wx, ly: wy };
    if (wy >= L.frontY0 && wy < L.frontY0 + L.H) return { half: 'front', wx, ly: wy - L.frontY0 };
    return null;
  };
  /** The stitch (row, index in row order) under a screen point, or null off the fabric. */
  const stitchAt = (sx: number, sy: number): { half: Half; row: number; index: number } | null => {
    const at = locate(sx, sy);
    if (!at) return null;
    if (!isChart) {
      const hit = hitFront(geo, at.half, at.wx * spc, at.ly);
      return hit && { half: at.half, row: hit.row, index: hit.index };
    }
    const row = Math.floor(at.ly);
    if (row < 1 || row >= geo.rows.length || !chart) return null;
    const col = Math.floor(at.wx);
    const r = geo.rows[row];
    for (const p of r.pieces) {
      if (p.half !== at.half) continue;
      const i = col - Math.floor(p.shift);
      if (i < p.i0 || i >= p.i1) continue;
      const cells = chart.rows[row - 1].cells;
      return cells[zoneStarts(y.rows[row - 1], chart.x0)[0] + i] ? { half: at.half, row, index: i } : null;
    }
    return null;
  };
  const readoutAt = (sx: number, sy: number) => {
    const hit = stitchAt(sx, sy);
    return hit ? { sx, sy, text: stitchReadout(y, hit.row, hit.index, project.symbols ?? [], `${hit.half} half`) } : null;
  };
  /** The row at a local y of the front half (for dragging a button). */
  const rowAtY = (ly: number) => (isChart ? Math.floor(ly) : (geo.rows.find((r) => r.row > 0 && ly < r.y1)?.row ?? geo.rows.length - 1));

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: v.ox, oy: v.oy, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const bd = buttonDrag.current;
    if (bd && buttons?.onDrag) {
      const ly = (e.clientY - r.top - v.oy) / v.scale - L.frontY0;
      const row = Math.max(y.counts.neckRow ?? 1, Math.min(y.rows.length, rowAtY(ly)));
      if (row !== bd.last) {
        bd.last = row;
        buttons.onDrag(bd.index, buttons.bodyEdgeCm + (y.rows.length - row) / y.rowsPerCm, bd.key);
      }
      return;
    }
    const d = drag.current;
    if (d) {
      if (!d.moved && e.pointerType === 'touch' && Math.hypot(e.clientX - d.x, e.clientY - d.y) < TOUCH_SLOP) return;
      if (!d.moved && e.pointerType === 'touch') setHover(null);
      d.moved = true;
      setVs({ ...v, ox: d.ox + e.clientX - d.x, oy: d.oy + e.clientY - d.y });
      return;
    }
    if (mode !== 'single' || e.pointerType === 'touch') return;
    setHover(readoutAt(e.clientX - r.left, e.clientY - r.top));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    // A finger tap shows that stitch's readout; tapping off the yoke hides it.
    if (e.pointerType === 'touch' && drag.current && !drag.current.moved && mode === 'single') {
      const r = wrapRef.current!.getBoundingClientRect();
      setHover(readoutAt(e.clientX - r.left, e.clientY - r.top));
    }
    drag.current = null;
    buttonDrag.current = null;
  };

  // Buttons and buttonholes just outside the front edges (a cardigan), above the front panels.
  const yokeButtons: React.ReactNode[] = [];
  if (buttons && mode === 'single') {
    buttons.positions.forEach((h, i) => {
      if (h <= buttons.bodyEdgeCm + 1e-6) return;
      const row = Math.max(1, Math.min(geo.rows.length - 1, Math.round(y.rows.length - (h - buttons.bodyEdgeCm) * y.rowsPerCm)));
      const r = geo.rows[row];
      const ym = isChart ? row + 0.5 : (r.y0 + r.y1) / 2;
      const edges = { left: r.parts.find((p) => p.half === 'front' && p.zone === 'leftFront')?.x0, right: r.parts.find((p) => p.half === 'front' && p.zone === 'rightFront')?.x1 };
      for (const side of ['left', 'right'] as const) {
        const ex = edges[side];
        if (ex === undefined) continue;
        const q = S('front', ex + (side === 'left' ? -1.5 : 1.5), ym);
        const hole = side === buttons.holeSide;
        yokeButtons.push(
          <g
            key={`b${i}${side}`}
            className={`button-mark ${hole ? 'hole' : 'button'}${buttons.onDrag ? ' draggable' : ''}`}
            onPointerDown={(e) => {
              if (!buttons.onDrag || e.button !== 0) return;
              e.stopPropagation();
              wrapRef.current?.setPointerCapture(e.pointerId);
              buttonDrag.current = { index: i, key: `drag:button:${Date.now()}`, last: -1 };
            }}
          >
            {touchUi && buttons.onDrag && <circle cx={q.x} cy={q.y} r={18} className="touch-hit" />}
            {hole ? <rect x={q.x - 5} y={q.y - 2} width={10} height={4} rx={2} /> : <circle cx={q.x} cy={q.y} r={4.5} />}
            <title>{`Button ${i + 1}: row ${row} of the yoke · ${len(h, units)} up from the hem${buttons.onDrag ? ' — drag to move (this size)' : ''}`}</title>
          </g>,
        );
      }
    });
  }

  if (mode === 'grid') {
    return (
      <div className="canvas yoke-top yoke-grid" ref={wrapRef}>
        {all.map(({ c: cc, g }) => {
          const l = layoutFor([g], false, cc.yoke!.stitchesPerCm);
          const s: ToScreen = (half, x, yy) => ({ x: x / l.spc, y: (half === 'front' ? l.frontY0 : 0) + yy });
          const m = (l.xmax - l.xmin) * 0.05;
          return (
            <figure key={cc.sizeId} className="yoke-card yoke-front-card">
              <svg viewBox={`${l.xmin - m} ${-m} ${l.xmax - l.xmin + 2 * m} ${l.frontY0 + l.H + 2 * m}`} width={220} height={220 * Math.min(1.6, (l.frontY0 + l.H + 2 * m) / (l.xmax - l.xmin + 2 * m))}>
                <FrontSchematic y={cc.yoke!} g={g} S={s} labels={false} />
              </svg>
              <figcaption>
                {project.sizes.find((z) => z.id === cc.sizeId)?.name} · {cc.yoke!.counts.total} rows · {cc.yoke!.held.leftSleeve} / {cc.yoke!.held.body} / {cc.yoke!.held.rightSleeve}
              </figcaption>
            </figure>
          );
        })}
      </div>
    );
  }

  return (
    <div className="canvas yoke-top yoke-front" ref={wrapRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={(e) => e.pointerType !== 'touch' && setHover(null)}>
      <svg width={size.w} height={size.h} className="schematic">
        {mode === 'overlay' ? (
          all.map(({ c: cc, g }) => {
            const color = sizeColor(project.sizes.findIndex((z) => z.id === cc.sizeId), project.sizes.length);
            const s: ToScreen = (half, x, yy) => P(x / cc.yoke!.stitchesPerCm, (half === 'front' ? L.frontY0 : 0) + yy);
            return (
              <g key={cc.sizeId}>
                {HALVES.flatMap((half) =>
                  ZONES.flatMap((z) => partShapes(g, half, z).map((pts, k) => <path key={`${half}${z}${k}`} d={path(pts.map((p) => s(half, p.x, p.y)), true)} className={`yoke-ov${cc.sizeId === c.sizeId ? ' current' : ''}`} style={{ stroke: color }} />)),
                )}
              </g>
            );
          })
        ) : isChart ? (
          <FrontChart y={y} g={geo} S={S} scale={v.scale} chart={chart} custom={project.symbols ?? []} size={size} />
        ) : (
          <FrontSchematic y={y} g={geo} S={S} labels units={units} />
        )}
        {HALVES.map((half) => {
          const q = S(half, 0, 0);
          return (
            <text key={half} x={q.x} y={q.y - (isChart ? 20 : half === 'back' ? 26 : 12)} textAnchor="middle" className="yoke-front-title">
              {TITLE[half]}
            </text>
          );
        })}
        {yokeButtons}
      </svg>
      {mode === 'overlay' && (
        <div className="size-legend">
          {all.map(({ c: cc }) => (
            <span key={cc.sizeId}>
              <i style={{ background: sizeColor(project.sizes.findIndex((z) => z.id === cc.sizeId), project.sizes.length) }} /> {project.sizes.find((z) => z.id === cc.sizeId)?.name}
            </span>
          ))}
        </div>
      )}
      {mode === 'single' && <YokeKey project={project} computed={c} units={units} fold={!isChart} front />}
      {isChart && chart && mode === 'single' && (
        <div className="yoke-legend">
          {chart.legend.map((l) => (
            <span key={l.id}>
              <Swatch id={l.id} custom={project.symbols ?? []} size={14} /> {l.abbr ? <b>{l.abbr}</b> : null} {l.label}
            </span>
          ))}
        </div>
      )}
      {hover && (
        <div className="hover-readout" style={{ left: Math.min(hover.sx + 12, size.w - 340), top: hover.sy + 12 }}>
          {hover.text}
        </div>
      )}
      <div className="canvas-hint">
        Laid flat, folded at the top of each sleeve: back above, front below, both RS facing, row 1 at the top · {touchUi ? 'pinch to zoom · drag to pan · tap a stitch for its count' : 'scroll to zoom · drag to pan · F to fit'}
      </div>
    </div>
  );
}

// ---------- schematic: zones, markers, phases, labels ----------

function FrontSchematic({ y, g, S, labels, units }: { y: YokeResult; g: FrontGeometry; S: ToScreen; labels: boolean; units?: Units }) {
  const outline: React.ReactNode[] = [];
  const ground: React.ReactNode[] = [];
  const fills: React.ReactNode[] = [];
  const lines: React.ReactNode[] = [];
  const text: React.ReactNode[] = [];
  const T = g.rows.length - 1;
  const last = g.rows[T];
  const os = y.offShoulder;
  for (const half of HALVES) {
    ZONES.forEach((z, zi) =>
      partShapes(g, half, z).forEach((pts, k) => {
        const d = path(pts.map((p) => S(half, p.x, p.y)), true);
        // The outline is every shape's stroke drawn under all their fills: only the outer edge shows.
        outline.push(<path key={`o${half}${z}${k}`} d={d} className="yoke-front-outline" />);
        ground.push(<path key={`g${half}${z}${k}`} d={d} className="yoke-front-ground" />);
        fills.push(<path key={`f${half}${z}${k}`} d={d} className={`yz yz-${zi}`} />);
      }),
    );
    if (os && !os.noBand) {
      // The band (knit first) shaded across the half, and the ring after its increase round as a solid line.
      const left: Pt[] = [];
      const right: Pt[] = [];
      for (const r of g.rows.slice(1, Math.min(os.bandRows, T) + 1)) {
        const e = extentOf(r, half);
        if (!e) continue;
        if (!left.length) {
          left.push(S(half, e.min, r.y0));
          right.push(S(half, e.max, r.y0));
        }
        left.push(S(half, e.min, r.y1));
        right.push(S(half, e.max, r.y1));
      }
      if (left.length) lines.push(<path key={`band${half}`} d={path([...left, ...right.reverse()], true)} className="yoke-band" />);
      const ring = g.rows[os.incRow];
      const e = ring && extentOf(ring, half);
      if (e && labels) lines.push(<path key={`ring${half}`} d={path([S(half, e.min, ring.y1), S(half, e.max, ring.y1)])} className="yoke-ring-line" />);
    }
    for (let b = 1; b <= 4; b++) {
      const pts = boundaryLineFront(g, half, b);
      if (pts.length) lines.push(<path key={`m${half}${b}`} d={path(pts.map((p) => S(half, p.x, p.y)))} className="yoke-marker-line" />);
    }
    for (const row of phaseRows(y)) {
      const r = g.rows[row];
      const e = r && extentOf(r, half);
      if (e) lines.push(<path key={`ph${half}${row}`} d={path([S(half, e.min, r.y1), S(half, e.max, r.y1)])} className="yoke-phase-line" />);
    }
  }

  if (labels && units) {
    const t = (key: string, p: Pt, s: string, anchor: 'start' | 'middle' | 'end' = 'middle', cls = 'yoke-held') =>
      text.push(<text key={key} x={p.x} y={p.y} textAnchor={anchor} className={cls}>{s}</text>);
    // Zones, low in each half where they are widest.
    const ly = g.height * 0.78;
    for (const p of last.parts) {
      const name = p.zone === 'back' ? `back · ${last.zones.back} sts` : p.zone.endsWith('Sleeve') ? `½ ${zoneName(p.zone)}` : zoneName(p.zone);
      t(`z${p.half}${p.zone}`, S(p.half, (p.x0 + p.x1) / 2, p.zone.endsWith('Front') ? g.height * 0.9 : ly), name);
    }
    for (const half of HALVES) {
      const e = extentOf(last, half);
      if (!e) continue;
      const mid = g.height * 0.55;
      t(`fl${half}`, { ...S(half, e.min, mid), x: S(half, e.min, mid).x - 6 }, 'fold', 'end', 'yoke-note');
      t(`fr${half}`, { ...S(half, e.max, mid), x: S(half, e.max, mid).x + 6 }, 'fold', 'start', 'yoke-note');
    }
    const below = (half: Half) => ({ ...S(half, 0, g.height), y: S(half, 0, g.height).y + 15 });
    t('splitf', below('front'), `split after row ${T}: body ${y.held.body} + 2 × ${y.underarmCo} underarm cast-on · sleeves ${y.held.leftSleeve} sts each on hold`);
    // How it starts: the cast-on along the top edge of both halves.
    const top = S('back', 0, 0);
    t('co', { x: top.x, y: top.y - 8 }, `cast on ${y.castOn} round the ${os ? (os.noBand ? 'ring, no band' : 'band') : y.shortRows ? 'whole neck' : 'back neck'} (both halves’ top edges) · row 1 below`, 'middle', 'yoke-note');
    if (os && !os.noBand) {
      const band = g.rows[Math.min(os.bandRows, T)];
      t('bandt', S('back', 0, (band.y1 + g.rows[0].y1) / 2 + 0.3), os.fold ? `folded band ${os.bandSts} sts · the top edge is the fold` : `band ${os.bandSts} sts · ${os.pattern.name}`);
      const ring = g.rows[os.incRow];
      if (ring) t('ringt', { ...S('back', 0, ring.y1), y: S('back', 0, ring.y1).y + 12 }, `ring ${os.ringSts} sts · ${len(os.ringSts / y.stitchesPerCm, units)}`);
    }
    // The front neck: short rows, or the row that closes it.
    const { neckRow, joinRow } = y.counts;
    const sr = y.shortRows;
    if (sr && sr.pairs && sr.endRow < y.counts.total) {
      const from = sr.fromRow ?? 1;
      const q = S('front', 0, g.rows[Math.min(sr.endRow, T)].y1);
      const lines = [`rows ${from}–${sr.endRow}: German short rows${os ? ' (back raise)' : ''}`, ...(joinRow !== null ? [`rounds from row ${sr.endRow + 1}`] : [])];
      lines.forEach((s, i) => t(`sr${i}`, { x: q.x, y: q.y + 14 + 12 * i }, s, 'middle', 'yoke-note'));
    } else if (!sr && neckRow && neckRow <= y.counts.total) {
      const n = y.neck;
      const s = joinRow ? (n.centre > 0 ? `row ${neckRow}: cast on ${n.centre}, join in the round` : `row ${neckRow}: join in the round`) : n.frontEdgeCo > 0 ? `rows ${neckRow}–${neckRow + 1}: cast on ${n.frontEdgeCo} at each front edge` : '';
      const q = S('front', 0, g.rows[neckRow].y0);
      if (s) t('neck', { x: q.x, y: q.y - 6 }, s, 'middle', 'yoke-note');
    }
  }
  return (
    <g className="yoke-front-schematic">
      {outline}
      {ground}
      {fills}
      {lines}
      {text}
    </g>
  );
}

// ---------- chart: a cell per stitch ----------

function FrontChart({ y, g, S, scale, chart, custom, size }: { y: YokeResult; g: FrontGeometry; S: ToScreen; scale: number; chart: Chart | null; custom: CustomSymbol[]; size: { w: number; h: number } }) {
  const tints: React.ReactNode[] = [];
  const grid: React.ReactNode[] = [];
  const cells: React.ReactNode[] = [];
  const lines: React.ReactNode[] = [];
  const text: React.ReactNode[] = [];
  if (!chart) return null;
  const T = g.rows.length - 1;
  const showLines = scale >= 6;
  const glyphs = scale >= 7;
  const rowVisible = (half: Half, k: number) => {
    const a = S(half, 0, k).y;
    return a + scale > -20 && a < size.h + 20;
  };
  const cell = (half: Half, col: number, k: number, v: string, key: string) => {
    const q = S(half, col, k);
    if (q.x + scale < -20 || q.x > size.w + 20) return;
    cells.push(<rect key={key} x={q.x} y={q.y} width={scale} height={scale} fill={cellFill(v, custom)} className="yoke-cell" />);
    if (glyphs)
      cells.push(
        <g key={`${key}g`} transform={`translate(${q.x},${q.y}) scale(${scale})`} className="yoke-glyph">
          <Glyph id={v} custom={custom} />
        </g>,
      );
  };
  // The cast-on, above row 1: the stitches whose first row is row 1; on a whole-neck start the fronts' cast-on
  // stitches between the turns are first worked further down, so their cells step down with the short rows.
  const coRow = (k: number, r: FrontRow, from: number, to: number, at: number) => {
    for (let i = from; i < to; i++) {
      const p = r.pieces.find((q) => i >= q.i0 && i < q.i1);
      if (p && rowVisible(p.half, at)) cell(p.half, i + Math.floor(p.shift), at, 'co', `co${k}-${i}`);
    }
  };
  coRow(0, g.rows[0], g.rows[0].lo, g.rows[0].hi, 0);
  // (Short rows after a band, an off-shoulder back raise, leave stitches already worked: no cast-on to show.)
  for (let k = 1; k <= T && (y.shortRows?.fromRow ?? 1) <= 1; k++) {
    const r = g.rows[k];
    const prev = g.rows[k - 1];
    if (r.lo < prev.lo) coRow(k, r, r.lo, prev.lo, k - 1);
    if (r.total - r.hi < prev.total - prev.hi) coRow(k + 0.5, r, r.total - (prev.total - prev.hi), r.hi, k - 1);
  }
  for (let k = 1; k <= T; k++) {
    const r = g.rows[k];
    const row = chart.rows[k - 1];
    const start = zoneStarts(y.rows[k - 1], chart.x0)[0];
    const off = zoneOffsets(r.zones);
    for (const p of r.pieces) {
      if (!rowVisible(p.half, k)) continue;
      const fs = Math.floor(p.shift);
      // Runs of worked stitches in one zone: tinted, with the stitch grid when zoomed in.
      let run: { from: number; zi: number } | null = null;
      let gridD = '';
      const flush = (to: number) => {
        if (!run) return;
        const a = S(p.half, run.from + fs, k);
        const b = S(p.half, to + fs, k + 1);
        tints.push(<rect key={`t${k}${p.half}${run.from}`} x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} className={`yz chart yz-${run.zi}`} />);
        if (showLines) {
          for (let i = run.from; i <= to; i++) {
            const q = S(p.half, i + fs, k);
            gridD += `M${q.x.toFixed(1)},${q.y.toFixed(1)}v${scale.toFixed(1)}`;
          }
          gridD += `M${a.x.toFixed(1)},${b.y.toFixed(1)}H${b.x.toFixed(1)}M${a.x.toFixed(1)},${a.y.toFixed(1)}H${b.x.toFixed(1)}`;
        }
        run = null;
      };
      for (let i = p.i0; i < p.i1; i++) {
        const v = row.cells[start + i];
        const zi = off.findIndex((o, z) => z < 5 && i >= o && i < off[z + 1]);
        if (!v) {
          flush(i);
          continue;
        }
        if (run && run.zi !== zi) flush(i);
        if (!run) run = { from: i, zi };
        if (v !== PLAIN) cell(p.half, i + fs, k, v, `c${k}-${i}`);
      }
      flush(p.i1);
      if (gridD) grid.push(<path key={`g${k}${p.half}${p.i0}`} d={gridD} className="yoke-st-line" />);
    }
  }
  for (const half of HALVES) {
    // Markers: between their stitches, a step on each row.
    for (let b = 1; b <= 4; b++) {
      let d = '';
      let prevX: number | null = null;
      for (let k = 1; k <= T; k++) {
        const r = g.rows[k];
        const i = zoneOffsets(r.zones)[b];
        const p = r.pieces.find((q) => q.half === half && i > q.i0 && i < q.i1);
        if (!p) {
          prevX = null;
          continue;
        }
        const q0 = S(half, i + Math.floor(p.shift), k);
        d += `${prevX === null ? 'M' : 'L'}${q0.x.toFixed(1)},${q0.y.toFixed(1)}v${scale.toFixed(1)}`;
        prevX = q0.x;
      }
      if (d) lines.push(<path key={`m${half}${b}`} d={d} className="yoke-marker-line strong" />);
    }
    // Phases end on their last row's lower edge.
    for (const row of phaseRows(y)) {
      const r = g.rows[row];
      const ps = r.pieces.filter((p) => p.half === half && p.i1 > p.i0);
      if (!ps.length) continue;
      const x0 = Math.min(...ps.map((p) => p.i0 + Math.floor(p.shift)));
      const x1 = Math.max(...ps.map((p) => p.i1 + Math.floor(p.shift)));
      lines.push(<path key={`ph${half}${row}`} d={path([S(half, x0, row + 1), S(half, x1, row + 1)])} className="yoke-phase-line" />);
    }
    // Row numbers left of each half: every row when there's room, else every 5th.
    for (let k = 0; k <= T; k++) {
      if (!(k === 0 || k === 1 || k === T || k % 5 === 0 || scale >= 11)) continue;
      if (scale < 5 && k % 10 !== 0 && k !== 1 && k !== T) continue;
      const r = g.rows[k];
      const ps = r.pieces.filter((p) => p.half === half && p.i1 > p.i0);
      const x0 = ps.length ? Math.min(...ps.map((p) => p.i0 + Math.floor(p.shift))) : 0;
      const q = S(half, x0, k + 0.5);
      if (q.y < -10 || q.y > size.h + 10) continue;
      text.push(<text key={`rn${half}${k}`} x={q.x - 4} y={q.y + 3} textAnchor="end" className="yoke-row-num">{k === 0 ? 'CO' : k}</text>);
    }
  }
  return (
    <g className="yoke-front-chart">
      {tints}
      {grid}
      {cells}
      {lines}
      {text}
    </g>
  );
}

// ---------- export: the laid-flat schematic alone ----------

/**
 * The laid-flat schematic fitted to `width` × `height` px for the export (PDF, PNG): titles and labels, no key box,
 * hover, buttons or zoom. `snap` rounds the fitted scale (px per cm); the scale is in `data-px-per-cm`.
 */
export function YokeFrontSheet({ computed: c, units, width, height, snap = (s) => s }: { computed: ComputedPanel; units: Units; width: number; height: number; snap?: (pxPerCm: number) => number }) {
  const y = c.yoke;
  if (!y) return null;
  const g = frontGeometry(y, true);
  const L = layoutFor([g], false, y.stitchesPerCm);
  // Room above for the back's title and the cast-on note, below for the split label.
  const top = 44;
  const bottom = 30;
  const wW = L.xmax - L.xmin;
  const wH = L.frontY0 + L.H;
  const scale = snap(Math.max(0.05, Math.min((width - 2 * PAD) / wW, (height - top - bottom - 2 * PAD) / wH)));
  const ox = width / 2 - ((L.xmin + L.xmax) / 2) * scale;
  const oy = top + PAD + (height - top - bottom - 2 * PAD - wH * scale) / 2;
  const S: ToScreen = (half, x, yy) => ({ x: ox + (x / L.spc) * scale, y: oy + ((half === 'front' ? L.frontY0 : 0) + yy) * scale });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="schematic" data-px-per-cm={scale}>
      <g className="yoke-top">
        <FrontSchematic y={y} g={g} S={S} labels units={units} />
        {HALVES.map((half) => {
          const q = S(half, 0, 0);
          return (
            <text key={half} x={q.x} y={q.y - (half === 'back' ? 26 : 12)} textAnchor="middle" className="yoke-front-title">
              {TITLE[half]}
            </text>
          );
        })}
      </g>
    </svg>
  );
}
