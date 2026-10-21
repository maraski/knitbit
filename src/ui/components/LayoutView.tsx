import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { sizeText } from './EstMark';
import { SizeGrid, SizeLegend } from './SizeGrid';
import { JOIN_TAGS } from '../../engine/joins';
import { alignShift, arrangeT, bbox, isUnarranged, localOutline, place, toLocal, type AlignRef, type Placement, type Rotation } from '../../engine/layout';
import type { Id, Project } from '../../engine/model';
import type { ComputedPanel, Point } from '../../engine/panel';
import { produce } from '../edit';
import { edgeMidpoint, edgePaths } from '../edgePaths';
import { sizeColor } from '../sizeColors';
import type { SizeMode } from './SizeModeBar';
import { cancelDrag, pinchView, slop, usePinch, useTouchUi, zoomView } from '../touch';

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project, key?: string | null) => void;
  sizeId: Id;
  mode: SizeMode;
  compare: Id[]; // sizes shown in overlay / grid, in size order
  align: AlignRef;
  computed: (panelId: Id, sizeId: Id) => ComputedPanel;
  selectedPanel: Id | null;
  onSelectPanel: (id: Id) => void;
  onSelectJoin: (id: Id) => void;
}

interface View {
  scale: number; // px per cm
  ox: number;
  oy: number; // screen y of world y = 0 (world y points up)
}

const PAD = 40;

export function LayoutView({ project, update, sizeId, mode, compare, align, computed, selectedPanel, onSelectPanel, onSelectJoin }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [view, setView] = useState<View | null>(null);
  const drag = useRef<{ kind: 'pan' | 'panel'; id?: Id; x: number; y: number; start: Placement; ox: number; oy: number; key: string; moved: boolean } | null>(null);

  const current = useMemo(() => new Map(project.panels.map((p) => [p.id, computed(p.id, sizeId)])), [project, sizeId, computed]);
  const everySize = useMemo(() => new Map(project.panels.map((p) => [p.id, project.sizes.map((s) => computed(p.id, s.id))])), [project, computed]);
  const unarranged = isUnarranged(project);
  const placements: Record<Id, Placement> = useMemo(() => {
    if (unarranged) return arrangeT(project, current, everySize);
    return Object.fromEntries(project.panels.map((p) => [p.id, { x: p.layout.x, y: p.layout.y, rotation: p.layout.rotation as Rotation }]));
  }, [project, current, everySize, unarranged]);

  // Shapes to draw: per panel, per size shown.
  const sizesShown = mode === 'single' ? [sizeId] : compare.length ? compare : [sizeId];
  const shapes = useMemo(() => {
    const out: { panelId: Id; sizeId: Id; pts: Point[]; c: ComputedPanel; shift: number }[] = [];
    for (const panel of project.panels) {
      const at = placements[panel.id];
      const anchor = current.get(panel.id)!;
      if (!at || !anchor?.ok) continue;
      for (const sid of sizesShown) {
        const c = computed(panel.id, sid);
        if (!c.ok) continue;
        const shift = mode === 'overlay' ? alignShift(c, anchor, align) : 0;
        out.push({ panelId: panel.id, sizeId: sid, c, shift, pts: localOutline(c).map((p) => place({ x: p.x, y: p.y + shift }, at)) });
      }
    }
    return out;
  }, [project, placements, current, computed, sizesShown.join(','), mode, align]);

  const world = useMemo(() => bbox(shapes.flatMap((s) => s.pts)), [shapes]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = () => {
    const bw = Math.max(1, world.maxX - world.minX);
    const bh = Math.max(1, world.maxY - world.minY);
    const scale = Math.max(0.3, Math.min((size.w - 2 * PAD) / bw, (size.h - 2 * PAD) / bh));
    setView({ scale, ox: PAD + (size.w - 2 * PAD - bw * scale) / 2 - world.minX * scale, oy: PAD + (size.h - 2 * PAD - bh * scale) / 2 + world.maxY * scale });
  };
  const fitKey = `${size.w}x${size.h}|${mode}|${project.panels.length}`;
  const fitted = useRef('');
  useEffect(() => {
    if (fitted.current !== fitKey && shapes.length) {
      fitted.current = fitKey;
      fit();
    }
  });
  useEffect(() => {
    const onFit = () => fit();
    window.addEventListener('knitbit:fit', onFit);
    return () => window.removeEventListener('knitbit:fit', onFit);
  });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView((v) => v && zoomView(v, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), { x: mx, y: my }, 0.2, 60));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  // Two fingers zoom and pan; a second finger landing puts back a panel the first one started moving.
  const touchUi = useTouchUi();
  usePinch(wrapRef, {
    start: () => {
      if (drag.current?.kind === 'panel') cancelDrag(drag.current.key);
      drag.current = null;
    },
    move: (s) => setView((v) => v && pinchView(v, s, 0.2, 60)),
  });

  const v = view ?? { scale: 3, ox: size.w / 2, oy: size.h / 2 };
  const scr = (p: Point) => ({ x: v.ox + p.x * v.scale, y: v.oy - p.y * v.scale });
  const d = (pts: Point[], close = false) => pts.map((p, i) => { const q = scr(p); return `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join('') + (close ? 'Z' : '');

  // Writes current placements (when they were only the on-the-fly T arrangement) plus a change, as one edit.
  const commitPlacement = (id: Id, at: Placement, key: string | null) =>
    update(
      (p) =>
        produce(p, (draft) => {
          for (const panel of draft.panels) {
            const cur = panel.id === id ? at : placements[panel.id];
            if (cur) panel.layout = { x: round(cur.x), y: round(cur.y), rotation: cur.rotation };
          }
        }),
      key,
    );

  const onPointerDown = (e: React.PointerEvent, panelId?: Id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).closest('.layout')?.setPointerCapture?.(e.pointerId);
    if (panelId && mode !== 'grid') onSelectPanel(panelId);
    drag.current = {
      kind: panelId && mode !== 'grid' ? 'panel' : 'pan',
      id: panelId,
      x: e.clientX,
      y: e.clientY,
      start: panelId ? placements[panelId] : { x: 0, y: 0, rotation: 0 },
      ox: v.ox,
      oy: v.oy,
      key: `drag:layout:${Date.now()}`,
      moved: false,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < slop(e)) return;
    g.moved = true;
    if (g.kind === 'pan') setView({ ...v, ox: g.ox + dx, oy: g.oy + dy });
    else if (g.id) commitPlacement(g.id, { ...g.start, x: snap(g.start.x + dx / v.scale), y: snap(g.start.y - dy / v.scale) }, g.key);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const rotateSelected = (by: 90 | -90) => {
    if (!selectedPanel) return;
    const at = placements[selectedPanel];
    commitPlacement(selectedPanel, { ...at, rotation: (((at.rotation + by) % 360) + 360) % 360 as Rotation }, null);
  };
  const autoArrange = () => {
    const arranged = arrangeT(project, current, everySize);
    update((p) =>
      produce(p, (draft) => {
        for (const panel of draft.panels) {
          const at = arranged[panel.id];
          if (at) panel.layout = { x: round(at.x), y: round(at.y), rotation: at.rotation };
        }
      }),
    );
    fitted.current = '';
  };

  if (mode === 'grid') {
    return (
      <div className="canvas layout" ref={wrapRef}>
        <SizeGridLayout project={project} placements={placements} compare={sizesShown} computed={computed} size={size} />
        <div className="canvas-hint">Grid: every size at the same scale</div>
      </div>
    );
  }

  // Join edges and seam links (current size).
  const joinParts: React.ReactNode[] = [];
  const midpoint = (panelId: Id, edge: Parameters<typeof edgePaths>[1]) => {
    const c = current.get(panelId);
    const at = placements[panelId];
    if (!c?.ok || !at) return null;
    const m = edgeMidpoint(c, edge);
    return m ? place(toLocal(c, m), at) : null;
  };
  if (mode === 'single') {
    for (const j of project.joins ?? []) {
      const color = JOIN_TAGS[j.tag].color;
      for (const ref of [...j.edges, ...j.partner]) {
        const c = current.get(ref.panelId);
        const at = placements[ref.panelId];
        if (!c?.ok || !at) continue;
        for (const piece of edgePaths(c, ref.edge)) {
          const pts = piece.map((p) => place(toLocal(c, p), at));
          joinParts.push(<path key={`${j.id}-${joinParts.length}`} d={d(pts)} stroke={color} className="join-edge-path" onClick={(e) => { e.stopPropagation(); onSelectJoin(j.id); }} />);
          if (touchUi) joinParts.push(<path key={`${j.id}-${joinParts.length}`} d={d(pts)} className="hit" onClick={(e) => { e.stopPropagation(); onSelectJoin(j.id); }} />);
        }
      }
      if (j.tag === 'seam' && j.edges[0] && j.partner[0]) {
        const a = midpoint(j.edges[0].panelId, j.edges[0].edge);
        const b = midpoint(j.partner[0].panelId, j.partner[0].edge);
        if (a && b) {
          const sa = scr(a);
          const sb = scr(b);
          joinParts.push(
            <g key={`${j.id}-link`} className="seam-link" onClick={(e) => { e.stopPropagation(); onSelectJoin(j.id); }}>
              <path d={`M${sa.x},${sa.y} L${sb.x},${sb.y}`} stroke={color} />
              <circle cx={sa.x} cy={sa.y} r={3} fill={color} />
              <circle cx={sb.x} cy={sb.y} r={3} fill={color} />
              <title>{j.name}</title>
            </g>,
          );
        }
      }
    }
  }

  const sizeIndex = (sid: Id) => project.sizes.findIndex((s) => s.id === sid);
  return (
    <div className="canvas layout" ref={wrapRef} onPointerDown={(e) => onPointerDown(e)} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <svg width={size.w} height={size.h} className={`schematic layout-svg${touchUi ? ' touch' : ''}`}>
        {shapes
          .slice()
          .sort((a, b) => sizeIndex(b.sizeId) - sizeIndex(a.sizeId))
          .map((s) => {
            const isCurrent = s.sizeId === sizeId;
            const sel = s.panelId === selectedPanel;
            const style = mode === 'overlay' ? { stroke: sizeColor(sizeIndex(s.sizeId), project.sizes.length) } : undefined;
            return (
              <path
                key={`${s.panelId}-${s.sizeId}`}
                d={d(s.pts, true)}
                className={`layout-panel${mode === 'overlay' ? ' overlay' : ''}${isCurrent ? ' current' : ''}${sel ? ' selected' : ''}`}
                style={style}
                onPointerDown={(e) => onPointerDown(e, s.panelId)}
              />
            );
          })}
        {joinParts}
        {project.panels.map((panel) => {
          const s = shapes.find((x) => x.panelId === panel.id && x.sizeId === sizeId) ?? shapes.find((x) => x.panelId === panel.id);
          if (!s) return null;
          const b = bbox(s.pts);
          const c = scr({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
          return (
            <text key={panel.id} x={c.x} y={c.y} textAnchor="middle" className="layout-label" pointerEvents="none">
              {panel.name}
            </text>
          );
        })}
      </svg>
      <div className="layout-tools">
        <button onClick={autoArrange} title="Back and front side by side, sleeves either side, the rest underneath">Auto-arrange (T)</button>
        <button onClick={() => rotateSelected(90)} disabled={!selectedPanel} title="Rotate the selected panel 90° anticlockwise">⟲</button>
        <button onClick={() => rotateSelected(-90)} disabled={!selectedPanel} title="Rotate the selected panel 90° clockwise">⟳</button>
        {unarranged && <span className="muted small">Shown in a T-shape; drag a panel or press Auto-arrange to keep positions.</span>}
      </div>
      {mode === 'overlay' && <SizeLegend project={project} sizes={sizesShown} current={sizeId} align={align} />}
      <div className="canvas-hint">Drag panels to move · {touchUi ? 'pinch to zoom' : 'scroll to zoom'} · drag the background to pan · F to fit · {touchUi ? 'tap' : 'click'} a coloured edge or link to open its join</div>
    </div>
  );
}

function round(x: number) {
  return Math.round(x * 10) / 10;
}
function snap(x: number) {
  return Math.round(x * 2) / 2;
}

/** Small multiples: the whole arrangement once per size, all at one scale. */
function SizeGridLayout({ project, placements, compare, computed, size }: { project: Project; placements: Record<Id, Placement>; compare: Id[]; computed: (p: Id, s: Id) => ComputedPanel; size: { w: number; h: number } }) {
  const cells = compare.map((sid) => ({
    sid,
    name: (() => { const s = project.sizes.find((z) => z.id === sid); return s ? sizeText(s, project) : ''; })(),
    shapes: project.panels.flatMap((panel) => {
      const c = computed(panel.id, sid);
      const at = placements[panel.id];
      return c.ok && at ? [localOutline(c).map((p) => place(p, at))] : [];
    }),
  }));
  return <SizeGrid cells={cells} size={size} project={project} />;
}
