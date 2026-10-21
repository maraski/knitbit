import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildChart, PLAIN } from '../../engine/chart';
import { ZONES, zoneName, type YokeResult } from '../../engine/contiguous';
import type { CustomSymbol, Id, Panel, Project } from '../../engine/model';
import type { ComputedPanel } from '../../engine/panel';
import type { Units } from '../../engine/units';
import { boundaryAngle, boundaryPoints, hitStitch, polar, stitchAngle, topGeometry, zoneOffsets, type TopGeometry, type TopRing } from '../../engine/yokeTop';
import { zoneStarts } from '../../engine/yokePanel';
import { len } from '../format';
import { cellFill, Glyph, Swatch } from '../glyphs';
import { sizeColor } from '../sizeColors';

type Mode = 'single' | 'overlay' | 'grid';

/** Buttons on a contiguous cardigan's yoke: the positions (cm up from the hem) above the front panels. */
export interface YokeButtons {
  positions: number[];
  bodyEdgeCm: number;
  holeSide: 'left' | 'right';
  onDrag?: (index: number, hCm: number, key: string) => void;
}

interface Props {
  buttons?: YokeButtons;
  project: Project;
  panel: Panel;
  computed: ComputedPanel;
  /** Schematic: zones, phases and labels. Chart: every row as a ring with its stitches' symbols. */
  view: 'schematic' | 'chart';
  mode: Mode;
  compare: ComputedPanel[];
  units: Units;
}

interface ViewState {
  scale: number; // px per cm
  ox: number; // screen px of the centre
  oy: number;
}

const PAD = 40;
const KEY_H = 150;

// ---------- geometry helpers (cm) ----------

/** SVG path of an annular sector between radii r0 < r1, from angle a0 to a1 (a1 < a0: counter-clockwise on screen). */
function sector(r0: number, r1: number, a0: number, a1: number, P: (x: number, y: number) => { x: number; y: number }): string {
  const large = Math.abs(a0 - a1) > Math.PI ? 1 : 0;
  const o0 = polar(r1, a0);
  const o1 = polar(r1, a1);
  const i1 = polar(r0, a1);
  const i0 = polar(r0, a0);
  const s = (p: { x: number; y: number }) => {
    const q = P(p.x, p.y);
    return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  };
  const R1 = P(r1, 0).x - P(0, 0).x;
  const R0 = P(r0, 0).x - P(0, 0).x;
  return `M${s(o0)}A${R1.toFixed(1)},${R1.toFixed(1)} 0 ${large} 0 ${s(o1)}L${s(i1)}A${R0.toFixed(1)},${R0.toFixed(1)} 0 ${large} 1 ${s(i0)}Z`;
}

function boundaryLine(g: TopGeometry, b: number, P: (x: number, y: number) => { x: number; y: number }): string {
  return boundaryPoints(g, b)
    .map((p, i) => {
      const q = P(p.x, p.y);
      return `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
    })
    .join('');
}

/** One zone over every row as a single shape (no seams between rows): out along its first marker, round the outer
 * edge, back along its second marker, round the neck. */
function zoneShape(g: TopGeometry, zi: number, P: (x: number, y: number) => { x: number; y: number }): string {
  const pts: { x: number; y: number }[] = [...boundaryPoints(g, zi)];
  const last = g.rings[g.rings.length - 1];
  const lo = zoneOffsets(last.zones);
  const steps = Math.max(2, Math.ceil(lo[zi + 1] - lo[zi]));
  for (let j = 1; j < steps; j++) pts.push(polar(last.r1, boundaryAngle(last, lo[zi] + ((lo[zi + 1] - lo[zi]) * j) / steps)));
  pts.push(...boundaryPoints(g, zi + 1).reverse());
  const first = g.rings[0];
  const fo = zoneOffsets(first.zones);
  const fsteps = Math.max(2, Math.ceil(fo[zi + 1] - fo[zi]));
  for (let j = fsteps - 1; j > 0; j--) pts.push(polar(first.r0, boundaryAngle(first, fo[zi] + ((fo[zi + 1] - fo[zi]) * j) / fsteps)));
  return pts.map((p, i) => {
    const q = P(p.x, p.y);
    return `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  }).join('') + 'Z';
}

function ringArc(ring: TopRing, r: number, P: (x: number, y: number) => { x: number; y: number }): string {
  const a0 = boundaryAngle(ring, 0);
  const a1 = boundaryAngle(ring, ring.total);
  const p0 = polar(r, a0);
  const p1 = polar(r, a1);
  const q0 = P(p0.x, p0.y);
  const q1 = P(p1.x, p1.y);
  const R = P(r, 0).x - P(0, 0).x;
  if (ring.gap === 0) {
    const c = P(0, 0);
    return `M${(c.x - R).toFixed(1)},${c.y.toFixed(1)}a${R.toFixed(1)},${R.toFixed(1)} 0 1 0 ${(2 * R).toFixed(1)},0a${R.toFixed(1)},${R.toFixed(1)} 0 1 0 ${(-2 * R).toFixed(1)},0`;
  }
  const large = Math.abs(a0 - a1) > Math.PI ? 1 : 0;
  return `M${q0.x.toFixed(1)},${q0.y.toFixed(1)}A${R.toFixed(1)},${R.toFixed(1)} 0 ${large} 0 ${q1.x.toFixed(1)},${q1.y.toFixed(1)}`;
}

// ---------- the view ----------

export function YokeTopView({ project, panel, computed: c, view, mode, compare, units, buttons }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [vs, setVs] = useState<ViewState | null>(null);
  const [hover, setHover] = useState<{ sx: number; sy: number; text: string } | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const buttonDrag = useRef<{ index: number; key: string; last: number } | null>(null);

  const y = c.yoke;
  const geo = useMemo(() => (y ? topGeometry(y) : null), [y]);
  const all = useMemo(() => compare.filter((x) => x.yoke).map((x) => ({ c: x, g: topGeometry(x.yoke!) })), [compare]);
  const maxR = Math.max(geo?.outerR ?? 1, ...(mode === 'overlay' ? all.map((a) => a.g.outerR) : []));

  // The key box sits at the top left in one-size mode: fit the drawing below it.
  const keyH = mode === 'single' ? KEY_H : 0;
  const fit = useCallback(() => {
    const scale = Math.max(0.5, Math.min(size.w - 2 * PAD, size.h - keyH - 2 * PAD - 40) / (2 * maxR));
    // Centred in the space under the key and above the hint line.
    setVs({ scale, ox: size.w / 2, oy: keyH + (size.h - keyH - 40) / 2 });
  }, [size.w, size.h, maxR, keyH]);

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
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setVs((v) => {
        if (!v) return v;
        const f = Math.exp(-e.deltaY * 0.0015);
        const scale = Math.min(400, Math.max(0.5, v.scale * f));
        const k = scale / v.scale;
        return { scale, ox: mx - (mx - v.ox) * k, oy: my - (my - v.oy) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const chart = useMemo(() => (view === 'chart' && y && c.ok ? buildChart(project, panel, c) : null), [view, y, c, project, panel]);

  if (!y || !geo) return <div className="canvas yoke-top"><p className="muted pad">This yoke can't be drawn in this size.</p></div>;
  const v = vs ?? { scale: 4, ox: size.w / 2, oy: size.h / 2 };
  const P = (x: number, yy: number) => ({ x: v.ox + x * v.scale, y: v.oy + yy * v.scale });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: v.ox, oy: v.oy };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const bd = buttonDrag.current;
    if (bd && buttons?.onDrag) {
      // Distance from the centre → yoke row → cm up from the hem.
      const rad = Math.hypot((e.clientX - r.left - v.ox) / v.scale, (e.clientY - r.top - v.oy) / v.scale);
      const row = Math.max(y.counts.neckRow ?? 1, Math.min(y.rows.length, Math.round((rad - geo.neckR) * y.rowsPerCm)));
      if (row !== bd.last) {
        bd.last = row;
        buttons.onDrag(bd.index, buttons.bodyEdgeCm + (y.rows.length - row) / y.rowsPerCm, bd.key);
      }
      return;
    }
    const d = drag.current;
    if (d) {
      setVs({ ...v, ox: d.ox + e.clientX - d.x, oy: d.oy + e.clientY - d.y });
      return;
    }
    if (mode !== 'single') return;
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const hit = hitStitch(geo, (sx - v.ox) / v.scale, (sy - v.oy) / v.scale);
    if (!hit) return setHover(null);
    const row = y.rows[hit.row - 1];
    const phase = y.phases.find((ph) => ph.id !== 'B' && ph.id !== 'neck' && hit.row >= ph.from && hit.row <= ph.to);
    const counts = ZONES.map((z) => `${zoneName(z)} ${row.zones[z]}`).join(', ');
    const off = zoneOffsets(row.zones);
    const within = hit.index - off[ZONES.indexOf(hit.zone)] + 1;
    setHover({
      sx,
      sy,
      text: `Row ${hit.row} · ${row.round ? 'round' : row.rs ? 'RS' : 'WS'} · ${phase ? `${phase.id} ${phase.label}` : ''} · ${zoneName(hit.zone)} st ${within} · ${row.total} sts (${counts})`,
    });
  };
  const onPointerUp = () => {
    drag.current = null;
    buttonDrag.current = null;
  };
  // Buttons and buttonholes on the yoke's front edges (positions above the front panels).
  const yokeButtons: React.ReactNode[] = [];
  if (buttons && mode === 'single') {
    buttons.positions.forEach((h, i) => {
      if (h <= buttons.bodyEdgeCm + 1e-6) return;
      const row = Math.round(y.rows.length - (h - buttons.bodyEdgeCm) * y.rowsPerCm);
      const ring = geo.rings[Math.max(1, Math.min(geo.rings.length - 1, row))];
      if (!ring) return;
      const rad = (ring.r0 + ring.r1) / 2;
      for (const side of ['left', 'right'] as const) {
        // Just outside each front edge, in the band space at centre front.
        const a = side === 'left' ? boundaryAngle(ring, -1.5) : boundaryAngle(ring, ring.total + 1.5);
        const p = polar(rad, a);
        const q = P(p.x, p.y);
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
            {hole ? <rect x={q.x - 5} y={q.y - 2} width={10} height={4} rx={2} /> : <circle cx={q.x} cy={q.y} r={4.5} />}
            <title>{`Button ${i + 1}: row ${ring.row} of the yoke · ${len(h, units)} up from the hem${buttons.onDrag ? ' — drag to move (this size)' : ''}`}</title>
          </g>,
        );
      }
    });
  }

  if (mode === 'grid') {
    return (
      <div className="canvas yoke-top yoke-grid" ref={wrapRef}>
        {all.map(({ c: cc, g }) => (
          <figure key={cc.sizeId} className="yoke-card">
            <svg viewBox={`${-g.outerR * 1.25} ${-g.outerR * 1.25} ${g.outerR * 2.5} ${g.outerR * 2.5}`} width={220} height={220}>
              <TopSchematic y={cc.yoke!} g={g} P={(x, yy) => ({ x, y: yy })} labels={false} />
            </svg>
            <figcaption>
              {project.sizes.find((s) => s.id === cc.sizeId)?.name} · {cc.yoke!.counts.total} rows · {cc.yoke!.held.leftSleeve} / {cc.yoke!.held.body} / {cc.yoke!.held.rightSleeve}
            </figcaption>
          </figure>
        ))}
      </div>
    );
  }

  return (
    <div className="canvas yoke-top" ref={wrapRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => setHover(null)}>
      <svg width={size.w} height={size.h} className="schematic">
        {mode === 'overlay' ? (
          all.map(({ c: cc, g }, k) => {
            const color = sizeColor(project.sizes.findIndex((s) => s.id === cc.sizeId), project.sizes.length);
            const last = g.rings[g.rings.length - 1];
            return (
              <g key={cc.sizeId} style={{ color }}>
                <path d={ringArc(last, last.r1, P)} className={`yoke-ov${cc.sizeId === c.sizeId ? ' current' : ''}`} style={{ stroke: color }} />
                <path d={ringArc(g.rings[0], g.rings[0].r0, P)} className="yoke-ov" style={{ stroke: color }} />
                {[1, 2, 3, 4].map((b) => <path key={b} d={boundaryLine(g, b, P)} className="yoke-ov thin" style={{ stroke: color }} />)}
                <text x={P(0, last.r1).x} y={P(0, last.r1).y + 14 + k * 0} textAnchor="middle" className="yoke-ov-label" style={{ fill: color }}>
                  {k === 0 || k === all.length - 1 ? project.sizes.find((s) => s.id === cc.sizeId)?.name : ''}
                </text>
              </g>
            );
          })
        ) : view === 'schematic' ? (
          <TopSchematic y={y} g={geo} P={P} labels scale={v.scale} />
        ) : (
          <TopChart y={y} g={geo} P={P} scale={v.scale} chart={chart} custom={project.symbols ?? []} size={size} />
        )}
        {yokeButtons}
      </svg>
      {mode === 'overlay' && (
        <div className="size-legend">
          {all.map(({ c: cc }) => (
            <span key={cc.sizeId}>
              <i style={{ background: sizeColor(project.sizes.findIndex((s) => s.id === cc.sizeId), project.sizes.length) }} /> {project.sizes.find((s) => s.id === cc.sizeId)?.name}
            </span>
          ))}
        </div>
      )}
      {mode === 'single' && (
        <div className="yoke-key">
          <div>
            Cast on <b>{y.castOn}</b> round the back neck: front {y.castOnZones.leftFront} · seam {y.seamSts} · back neck {y.castOnZones.back} ({len(y.castOnZones.back / y.stitchesPerCm, units)}) · seam {y.seamSts} · front {y.castOnZones.rightFront}
          </div>
          <div>
            Shoulder seam <b>{y.counts.A}</b> rows · {len(y.derived.seamCm, units)}
          </div>
          {y.counts.C + y.counts.D > 0 && (
            <div>
              Cap <b>{y.counts.C + y.counts.D}</b> rows · {len((y.counts.C + y.counts.D) / y.rowsPerCm, units)}
            </div>
          )}
          <div className="key-rings">Dashed rings, from the neck out:</div>
          {y.phases
            .filter((ph) => ph.id === 'A' || ph.id === 'C' || ph.id === 'D')
            .map((ph) => (
              <div key={ph.id}>
                end of {ph.id} ({ph.label}) · row {ph.to} · {ph.stsAfter} sts
              </div>
            ))}
          {y.counts.neckRow !== null && y.counts.neckRow <= y.counts.total && (
            <div>
              {y.counts.joinRow ? 'neck joined in the round' : 'neck cast on at the front edges'} · row {y.counts.neckRow}
            </div>
          )}
          <div>
            Split after row <b>{y.counts.total}</b>: sleeves {y.held.leftSleeve} sts on hold, body {y.held.body} + 2 × {y.underarmCo} cast on
          </div>
        </div>
      )}
      {view === 'chart' && chart && mode === 'single' && (
        <div className="yoke-legend">
          {chart.legend.map((l) => (
            <span key={l.id}>
              <Swatch id={l.id} custom={project.symbols ?? []} size={14} /> {l.abbr ? <b>{l.abbr}</b> : null} {l.label}
            </span>
          ))}
        </div>
      )}
      {hover && (
        <div className="hover-readout" style={{ left: Math.min(hover.sx + 12, size.w - 320), top: hover.sy + 12 }}>
          {hover.text}
        </div>
      )}
      <div className="canvas-hint">
        Seen from above: back at the top, fronts at the bottom, the left sleeve on the right · rings = rows, knitted outward from the cast-on round the back neck · scroll to zoom · drag to pan · F to fit
      </div>
    </div>
  );
}

// ---------- schematic: zones, phases, labels ----------

function TopSchematic({ y, g, P, labels, scale }: { y: YokeResult; g: TopGeometry; P: (x: number, y: number) => { x: number; y: number }; labels: boolean; scale?: number }) {
  const parts: React.ReactNode[] = [];
  ZONES.forEach((_, zi) => parts.push(<path key={`z${zi}`} d={zoneShape(g, zi, P)} className={`yz yz-${zi}`} />));
  const last = g.rings[g.rings.length - 1];
  parts.push(<path key="outer" d={ringArc(last, last.r1, P)} className="yoke-edge" />);
  parts.push(<path key="neck" d={ringArc(g.rings[0], g.rings[0].r0, P)} className="yoke-edge" />);
  parts.push(<path key="fe0" d={boundaryLine(g, 0, P)} className="yoke-edge" />);
  parts.push(<path key="fe5" d={boundaryLine(g, 5, P)} className="yoke-edge" />);
  for (let b = 1; b <= 4; b++) parts.push(<path key={`m${b}`} d={boundaryLine(g, b, P)} className="yoke-marker-line" />);

  const { A, C, D, neckRow, joinRow } = y.counts;
  const phaseRing = (row: number, label: string, key: string, k: number) => {
    const ring = g.rings[row];
    if (!ring || row <= 0) return;
    parts.push(<path key={`pr${key}`} d={ringArc(ring, ring.r1, P)} className="yoke-phase-line" fill="none" />);
    void label;
    void k;
  };
  phaseRing(A, `end of A (shoulders) · row ${A}`, 'a', 0);
  if (C) phaseRing(A + C, `end of C (rapid cap) · row ${A + C}`, 'c', 1);
  if (D) phaseRing(A + C + D, `end of D (slow cap) · row ${A + C + D}`, 'd', 2);
  if (neckRow && neckRow <= y.counts.total) phaseRing(neckRow, `${joinRow ? 'neck joined in the round' : 'neck cast on'} · row ${neckRow}`, 'n', 3);

  if (labels) {
    const at = (r: number, a: number, dy = 0) => {
      const p = polar(r, a);
      const q = P(p.x, p.y);
      return { x: q.x, y: q.y + dy };
    };
    const off = zoneOffsets(last.zones);
    const mid = (zi: number) => (boundaryAngle(last, off[zi]) + boundaryAngle(last, off[zi + 1])) / 2;
    const out = last.r1;
    const t = (key: string, p: { x: number; y: number }, text: string, anchor: 'start' | 'middle' | 'end' = 'middle', cls = 'yoke-held') =>
      parts.push(<text key={key} x={p.x} y={p.y} textAnchor={anchor} className={cls}>{text}</text>);
    // Sleeve labels inside the sleeves (the sides are where the pane runs out of room).
    const inner = (g.rings[y.counts.A]?.r1 ?? out * 0.6) * 0.5 + out * 0.5;
    t('ls', at(inner, mid(1), -2), 'left sleeve');
    t('ls2', at(inner, mid(1), 11), `${y.held.leftSleeve} sts · hold`);
    t('rs', at(inner, mid(3), -2), 'right sleeve');
    t('rs2', at(inner, mid(3), 11), `${y.held.rightSleeve} sts · hold`);
    t('bk', at(inner, 0, 4), `back`);
    t('fr', at(out, Math.PI, 16), `fronts · body ${y.held.body} sts + 2 × ${y.underarmCo} underarm cast-on`);
  }
  if (labels && scale) parts.push(<NeckNotes key="notes" y={y} g={g} P={P} scale={scale} />);
  return <g className="yoke-top-schematic">{parts}</g>;
}

// ---------- where to start: the cast-on, row 1 and the front neck ----------

/** Labels for how the yoke is begun: the cast-on round the back neck and shoulders, where row 1 starts and which way
 * it goes (a RS row starts at the right front edge), and the row that closes the front neck. */
function NeckNotes({ y, g, P, scale }: { y: YokeResult; g: TopGeometry; P: (x: number, y: number) => { x: number; y: number }; scale: number }) {
  const parts: React.ReactNode[] = [];
  const at = (r: number, a: number) => {
    const p = polar(r, a);
    return P(p.x, p.y);
  };
  const ring0 = g.rings[0];
  // Words only once the neck is big enough to hold them (zoomed in); the key box says the same.
  const words = ring0.r0 * scale >= 70;
  if (words) {
    const q = at(ring0.r0 * 0.55, 0);
    parts.push(<text key="co" x={q.x} y={q.y} textAnchor="middle" className="yoke-note">cast on {y.castOn} here</text>);
  }
  const ring1 = g.rings[1];
  if (ring1) {
    // Row 1 starts at the right front edge and runs clockwise (seen from above) round to the left front.
    const rm = (ring1.r0 + ring1.r1) / 2;
    const a0 = boundaryAngle(ring1, ring1.total);
    const span = Math.min(0.6, 36 / Math.max(1, rm * scale));
    const s0 = at(rm, a0 + span * 0.1);
    const e = at(rm, a0 + span);
    const R = rm * scale;
    const t = { x: Math.cos(a0 + span), y: Math.sin(a0 + span) };
    const n = { x: -t.y, y: t.x };
    parts.push(
      <g key="r1" className="yoke-start">
        <path d={`M${s0.x.toFixed(1)},${s0.y.toFixed(1)}A${R.toFixed(1)},${R.toFixed(1)} 0 0 1 ${e.x.toFixed(1)},${e.y.toFixed(1)}`} fill="none" />
        <polygon points={`${e.x + t.x * 7},${e.y + t.y * 7} ${e.x + n.x * 4},${e.y + n.y * 4} ${e.x - n.x * 4},${e.y - n.y * 4}`} />
      </g>,
    );
    const lq = at(rm, a0);
    if (words) parts.push(<text key="r1t" x={lq.x + 8} y={lq.y + 4} className="yoke-note">row 1 ({y.rows[0]?.rs === false ? 'WS' : 'RS'}) starts here</text>);
  }
  const { neckRow, joinRow } = y.counts;
  const ringR = neckRow ? g.rings[neckRow] : undefined;
  if (words && ringR && neckRow! <= y.counts.total) {
    const n = y.neck;
    // Two short lines just above the closing row, so they stay inside the opening where it curves up.
    const lines = joinRow
      ? [n.centre > 0 ? `row ${neckRow}: cast on ${n.centre}` : `row ${neckRow}:`, 'join in the round']
      : n.frontEdgeCo > 0
        ? [`rows ${neckRow}–${neckRow! + 1}: cast on ${n.frontEdgeCo}`, 'at each front edge']
        : [];
    const q = at(ringR.r0, Math.PI);
    lines.forEach((line, i) =>
      parts.push(<text key={`neck${i}`} x={q.x} y={q.y - 8 - 12 * (lines.length - 1 - i)} textAnchor="middle" className="yoke-note">{line}</text>),
    );
  }
  return <g className="yoke-notes">{parts}</g>;
}

// ---------- chart: rings of stitches with their symbols ----------

function TopChart({
  y,
  g,
  P,
  scale,
  chart,
  custom,
  size,
}: {
  y: YokeResult;
  g: TopGeometry;
  P: (x: number, y: number) => { x: number; y: number };
  scale: number;
  chart: ReturnType<typeof buildChart> | null;
  custom: CustomSymbol[];
  size: { w: number; h: number };
}) {
  const parts: React.ReactNode[] = [];
  const rowPx = scale / y.rowsPerCm;
  const visible = (p: { x: number; y: number }) => p.x > -40 && p.y > -40 && p.x < size.w + 40 && p.y < size.h + 40;
  ZONES.forEach((_, zi) => parts.push(<path key={`z${zi}`} d={zoneShape(g, zi, P)} className={`yz chart yz-${zi}`} />));
  for (const ring of g.rings.slice(1)) {
    parts.push(<path key={`rl${ring.row}`} d={ringArc(ring, ring.r1, P)} className="yoke-row-line" />);
    // Stitch boundaries, when zoomed in far enough to see them.
    const cellPx = ((2 * Math.PI * ring.r1) / ring.slots) * scale;
    if (cellPx >= 7 && rowPx >= 6) {
      let d = '';
      for (let i = 0; i <= ring.total; i++) {
        const a = boundaryAngle(ring, i);
        const p0 = polar(ring.r0, a);
        const q0 = P(p0.x, p0.y);
        if (!visible(q0)) continue;
        const p1 = polar(ring.r1, a);
        const q1 = P(p1.x, p1.y);
        d += `M${q0.x.toFixed(1)},${q0.y.toFixed(1)}L${q1.x.toFixed(1)},${q1.y.toFixed(1)}`;
      }
      if (d) parts.push(<path key={`sl${ring.row}`} d={d} className="yoke-st-line" />);
    }
  }
  // The cast-on (the start): a band of cast-on cells just inside the neck, one per stitch.
  const ring0 = g.rings[0];
  const ri = Math.max(ring0.r0 * 0.5, ring0.r0 - 1 / y.rowsPerCm);
  const coCell = Math.min(rowPx, ((2 * Math.PI * ri) / ring0.slots) * scale);
  for (let i = 0; i < ring0.total; i++) {
    const am = stitchAngle(ring0, i);
    const cp = polar((ri + ring0.r0) / 2, am);
    const cq = P(cp.x, cp.y);
    if (!visible(cq)) continue;
    parts.push(<path key={`co${i}`} d={sector(ri, ring0.r0, boundaryAngle(ring0, i), boundaryAngle(ring0, i + 1), P)} fill={cellFill('co', custom)} className="yoke-cell" />);
    if (coCell >= 7)
      parts.push(
        <g key={`cog${i}`} transform={`translate(${cq.x},${cq.y}) rotate(${(am * 180) / Math.PI}) scale(${coCell}) translate(-0.5,-0.5)`} className="yoke-glyph">
          <Glyph id="co" custom={custom} />
        </g>,
      );
  }
  // Symbols: every cell that isn't a plain stitch.
  if (chart) {
    chart.rows.forEach((row, k) => {
      const ring = g.rings[k + 1];
      const start = zoneStarts(y.rows[k], chart.x0)[0];
      row.cells.forEach((v, col) => {
        if (!v || v === PLAIN) return;
        const i = col - start;
        if (i < 0 || i >= ring.total) return;
        const a0 = boundaryAngle(ring, i);
        const a1 = boundaryAngle(ring, i + 1);
        const am = stitchAngle(ring, i);
        const cp = polar((ring.r0 + ring.r1) / 2, am);
        const cq = P(cp.x, cp.y);
        if (!visible(cq)) return;
        parts.push(<path key={`c${k}-${col}`} d={sector(ring.r0, ring.r1, a0, a1, P)} fill={cellFill(v, custom)} className="yoke-cell" />);
        const cell = Math.min(rowPx, ((2 * Math.PI * ring.r1) / ring.slots) * scale);
        if (cell >= 7) {
          // The glyph upright along the row: "up" points away from the neck (the knitting direction is outward).
          const deg = (am * 180) / Math.PI;
          parts.push(
            <g key={`g${k}-${col}`} transform={`translate(${cq.x},${cq.y}) rotate(${deg}) scale(${cell}) translate(-0.5,-0.5)`} className="yoke-glyph">
              <Glyph id={v} custom={custom} />
            </g>,
          );
        }
      });
    });
  }
  for (let b = 1; b <= 4; b++) parts.push(<path key={`m${b}`} d={boundaryLine(g, b, P)} className="yoke-marker-line strong" />);
  parts.push(<path key="fe0" d={boundaryLine(g, 0, P)} className="yoke-edge" />);
  parts.push(<path key="fe5" d={boundaryLine(g, 5, P)} className="yoke-edge" />);
  parts.push(<path key="neck" d={ringArc(g.rings[0], g.rings[0].r0, P)} className="yoke-edge" />);
  // Row numbers every 5 rows up the centre-back line, where row 1 sits against the cast-on.
  for (const ring of g.rings.slice(1)) {
    if (ring.row % 5 !== 0 && ring.row !== 1 && ring.row !== g.rings.length - 1) continue;
    if (rowPx < 5 && ring.row % 10 !== 0) continue;
    const p = polar((ring.r0 + ring.r1) / 2, 0);
    const q = P(p.x, p.y);
    parts.push(<text key={`rn${ring.row}`} x={q.x + 4} y={q.y + 3} className="yoke-row-num">{ring.row}</text>);
  }
  (chart?.phases ?? []).forEach((ph, k) => {
    const ring = g.rings[ph.toRow];
    if (!ring) return;
    parts.push(<path key={`ph${k}`} d={ringArc(ring, ring.r1, P)} className="yoke-phase-line" fill="none" />);
  });
  parts.push(<NeckNotes key="notes" y={y} g={g} P={P} scale={scale} />);
  return <g className="yoke-top-chart">{parts}</g>;
}

export type { Id };
