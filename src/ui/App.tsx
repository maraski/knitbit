import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { CascadePicker } from './components/CascadePicker';
import { sizeText } from './components/EstMark';
import type { Id } from '../engine/model';
import { buildScope } from '../engine/measurements';
import { computePanel, panelExtras, resolvePanelDims, type ComputedPanel } from '../engine/panel';
import type { AlignRef } from '../engine/layout';
import { SizeModeBar, type SizeMode } from './components/SizeModeBar';
import { lineFromPoints } from '../engine/lines';
import { dragHeight, dragWidth } from '../engine/waypointDrag';
import { editPanel } from './edit';
import { loadProject, serializeProject } from '../engine/schema';
import { CheckPanel } from './components/CheckPanel';
import { JoinProps } from './components/JoinProps';
import { MeasurementProps, SizesProps } from './components/MeasurementProps';
import { Properties, type PropsContext } from './components/Properties';
import { Schematic, type SchematicBands } from './components/Schematic';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { YokeButtons } from './components/YokeTopView';
import { len } from './format';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { downloadText, pickTextFile, safeFilename } from './fileio';
import { markerActions } from './markerActions';
import { frontEdgeRows, panelJoins, type PanelCache } from '../engine/joins';
import { buttonPlan } from '../engine/buttons';
import { bandOnFront, setButtonPosition } from '../engine/bands';
import { applyEdgeTreatments } from '../engine/edgeTreatments';
import { PANEL_SELECTION, type Selection } from './selection';
import { mergeSampleTable, migrationNotice, sampleProject, useProjectStore, type Notice } from './store';

// Screens other than the schematic load on first use, keeping them out of the initial download.
const LayoutView = lazy(() => import('./components/LayoutView').then((m) => ({ default: m.LayoutView })));
const ChartView = lazy(() => import('./components/ChartView').then((m) => ({ default: m.ChartView })));
const YokeTopView = lazy(() => import('./components/YokeTopView').then((m) => ({ default: m.YokeTopView })));
const MeasurementsView = lazy(() => import('./components/MeasurementsView').then((m) => ({ default: m.MeasurementsView })));
const ImportDialog = lazy(() => import('./components/ImportDialog').then((m) => ({ default: m.ImportDialog })));

const VIEW_KEY = 'knitbit.view.v1';
type CenterView = 'schematic' | 'chart' | 'layout' | 'measurements';

function readView(): { sizeId?: Id; panelId?: Id; center?: CenterView; mode?: SizeMode; compare?: Id[]; align?: AlignRef; cascade?: Id[] | null } {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function App() {
  const store = useProjectStore();
  const { project, update } = store;
  const [view] = useState(readView);
  const [sizeId, setSizeId] = useState<Id>(view.sizeId ?? project.baseSizeId);
  const [panelId, setPanelId] = useState<Id | null>(view.panelId ?? project.panels[0]?.id ?? null);
  const [selection, setSelection] = useState<Selection>(PANEL_SELECTION);
  const [center, setCenter] = useState<CenterView>(view.center ?? 'schematic');
  const [sizeMode, setSizeMode] = useState<SizeMode>(view.mode ?? 'single');
  const [drawLine, setDrawLine] = useState(false);
  const wpDragStart = useRef<{ key: string; value: number } | null>(null);
  const [compareRaw, setCompare] = useState<Id[] | null>(view.compare ?? null); // null = all sizes
  const [align, setAlign] = useState<AlignRef>(view.align ?? 'hem');
  const [cascadeRaw, setCascade] = useState<Id[] | null>(view.cascade ?? null); // sizes that follow waypoint drags; null = all
  const cascade = cascadeRaw?.filter((id) => project.sizes.some((s) => s.id === id));
  const compare = (compareRaw ?? project.sizes.map((s) => s.id)).filter((id) => project.sizes.some((s) => s.id === id));
  const [measSel, setMeasSel] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Keep view state pointing at things that exist (after undo, open, delete…).
  const size = project.sizes.find((s) => s.id === sizeId) ?? project.sizes.find((s) => s.id === project.baseSizeId) ?? project.sizes[0];
  const panel = project.panels.find((p) => p.id === panelId) ?? project.panels[0] ?? null;

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ sizeId: size?.id, panelId: panel?.id, center, mode: sizeMode, compare: compareRaw, align, cascade: cascadeRaw }));
    } catch {
      /* ignore */
    }
  }, [size?.id, panel?.id, center, sizeMode, compareRaw, align, cascadeRaw]);

  // One cache of computed panels per project version, shared by every view.
  const computedFor = useMemo(() => {
    const cache = new Map<string, ComputedPanel>();
    return (panelId: Id, sid: Id) => {
      const key = `${panelId}|${sid}`;
      let c = cache.get(key);
      if (!c) {
        c = computePanel(project, project.panels.find((p) => p.id === panelId)!, sid);
        cache.set(key, c);
      }
      return c;
    };
  }, [project]);
  const allSizes = useMemo(() => (panel ? project.sizes.map((s) => computedFor(panel.id, s.id)) : []), [project, panel, computedFor]);
  const computed = allSizes.find((c) => c.sizeId === size?.id) ?? null;
  const fitOutlines = useMemo(() => allSizes.filter((c) => c.ok).map((c) => c.outline), [allSizes]);
  const scope = useMemo(() => {
    if (!panel || !size) return {};
    return { ...buildScope(project, size.id), ...panelExtras(project, panel, size.id), ...resolvePanelDims(project, panel, size.id).values };
  }, [project, panel, size]);

  const markers = useMemo(() => (panel && size ? markerActions(update, panel.id, size.id) : undefined), [update, panel?.id, size?.id]);

  // Contiguous cardigan: buttons on the yoke's front edges, above the front panels.
  const yokeButtons = useMemo((): YokeButtons | undefined => {
    if (!panel?.yoke || !size || project.garment.opening !== 'cardigan') return undefined;
    const plan = buttonPlan(project, size.id);
    if (!plan) return undefined;
    const positions = plan.positions;
    return {
      positions,
      bodyEdgeCm: plan.bodyEdgeCm,
      holeSide: project.cardigan?.buttonholeSide ?? 'right',
      onDrag: (index, h, key) => update((p) => applyEdgeTreatments(setButtonPosition(p, size.id, positions, index, h)), key),
    };
  }, [project, panel, size, update]);

  // Cardigan: the band and buttons on the shown front (or the buttonholes on a band strip).
  const bands = useMemo((): SchematicBands | undefined => {
    if (!panel || !size || !computed?.ok || (!panel.half && !panel.band)) return undefined;
    const cache: PanelCache = new Map();
    const plan = buttonPlan(project, size.id, cache);
    const holes = (plan?.holes ?? []).filter((h) => h.panelId === panel.id).map((h) => ({ row: h.row, x: h.x, index: h.index }));
    if (panel.band) return { bandX: [0, 0], integrated: false, label: '', edgeRows: 0, buttons: [], kind: 'hole', holes, holeWidth: plan?.holeWidth ?? 2 };
    const half = computed.half!;
    const onFront = bandOnFront(project, panel.half!.side);
    const bandW = scope.band_w ?? 0;
    let bandX: [number, number] = [0, 0];
    if (onFront?.attach === 'integrated') {
      const sel = panel.half!.cfSelvedge;
      const start = half.keep === 'right' ? half.cfX + sel : half.cfX - sel - half.bandSts;
      bandX = [start, start + half.bandSts];
    } else if (onFront) {
      const w = bandW * computed.stitchesPerCm;
      bandX = half.keep === 'right' ? [half.cfX - w, half.cfX] : [half.cfX, half.cfX + w];
    }
    const edgeRows = onFront ? frontEdgeRows(computed) : 0;
    const label = onFront ? `${onFront.attach === 'integrated' ? 'integrated ' : ''}band ${len(bandW, project.units)} · overlap ${len(scope.band_overlap ?? 0, project.units)}` : '';
    const isHole = plan?.holeFrontId === panel.id;
    const positions = plan?.positions ?? [];
    return {
      bandX,
      integrated: onFront?.attach === 'integrated',
      label,
      edgeRows,
      buttons: positions,
      kind: isHole ? 'hole' : 'button',
      holes,
      holeWidth: plan?.holeWidth ?? 2,
      onDrag: (index, h, key) => update((p) => applyEdgeTreatments(setButtonPosition(p, size.id, positions, index, h)), key),
    };
  }, [project, panel, size, computed, scope, update]);

  const selectPanel = (id: Id | null) => {
    setPanelId(id);
    setSelection(PANEL_SELECTION);
    setCenter((v) => (v === 'chart' ? 'chart' : 'schematic'));
  };

  const save = () => downloadText(`${safeFilename(project.name)}.knitbit.json`, serializeProject(project));
  const open = async () => {
    const f = await pickTextFile('.json,application/json');
    if (!f) return;
    const r = loadProject(f.text);
    if (!r.ok) return store.setNotice({ kind: 'error', title: `Could not open ${f.name}`, lines: r.errors });
    store.replace(r.project);
    setSizeId(r.project.baseSizeId);
    selectPanel(r.project.panels[0]?.id ?? null);
    if (r.migratedFrom !== null) return store.setNotice(migrationNotice(`Opened ${f.name}`, r.migratedFrom, r.migrationNotes, r.warnings));
    const lines = r.warnings;
    store.setNotice(lines.length ? { kind: 'warning', title: `Opened ${f.name}`, lines } : { kind: 'info', title: `Opened ${f.name}`, lines: [] });
  };
  const newProject = () => {
    if (!window.confirm('Start a new project from the sample sizing table? The current project stays in undo history.')) return;
    const p = sampleProject();
    store.replace(p);
    setSizeId(p.baseSizeId);
    selectPanel(p.panels[0]?.id ?? null);
    store.setNotice(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && k === 'y' && !typing) {
        e.preventDefault();
        store.redo();
      } else if (mod && k === 's') {
        e.preventDefault();
        save();
      } else if (mod && k === 'o') {
        e.preventDefault();
        open();
      } else if (!mod && !typing) {
        const idx = project.sizes.findIndex((s) => s.id === size?.id);
        if (k === '[' && idx > 0) setSizeId(project.sizes[idx - 1].id);
        else if (k === ']' && idx < project.sizes.length - 1) setSizeId(project.sizes[idx + 1].id);
        else if (k === 'f') window.dispatchEvent(new Event('knitbit:fit'));
        else if ((k === 'delete' || k === 'backspace') && selection.kind === 'segment' && selection.marker !== undefined && markers) {
          markers.remove(selection.fromWaypoint, selection.edge ?? 'left', selection.marker);
          setSelection({ ...selection, marker: undefined });
        } else if (k.startsWith('arrow') && center === 'schematic' && sizeMode === 'single' && selection.kind === 'waypoint' && panel && size && computed?.ok && panel.direction !== 'side-to-side') {
          // Nudge the active waypoint: ↑ ↓ one row (Shift: 5), ← → one stitch each side (Shift: 5). Alt: this size only.
          const w = computed.waypoints.find((x) => x.id === selection.id);
          if (!w) return;
          const step = e.shiftKey ? 5 : 1;
          const mode = e.altKey ? 'size' : 'all';
          const key = `nudge:${w.id}:${k}:${mode}`;
          if (k === 'arrowup' || k === 'arrowdown') {
            const first = computed.topDown ? computed.waypoints[computed.waypoints.length - 1] : computed.waypoints[0];
            if (w.id === first.id) return;
            const h = scope[`${w.key}.height`];
            if (h === undefined) return;
            update((p) => dragHeight(p, panel.id, w.id, size.id, h + ((k === 'arrowup' ? 1 : -1) * step) / computed.rowsPerCm, mode, cascade), key);
          } else {
            const sign = k === 'arrowright' ? 1 : -1;
            const parts = w.symmetric ? (['width'] as const) : (['left', 'right'] as const);
            update((p) => {
              let q = p;
              for (const part of parts) {
                const v = scope[`${w.key}.${part}`];
                if (v === undefined) continue;
                const d = (sign * step * (part === 'width' ? 2 : 1)) / computed.stitchesPerCm;
                q = dragWidth(q, panel.id, w.id, size.id, part, Math.max(0.5, v + d), mode, cascade);
              }
              return q;
            }, key);
          }
        } else if (k === 'escape') {
          setDrawLine(false);
          setSelection(PANEL_SELECTION);
          setMeasSel(null);
        }
        else return;
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const ctx: PropsContext | null =
    panel && computed && size
      ? { project, panel, computed, sizeId: size.id, sizeName: size.name, scope, units: project.units, update, select: setSelection, markers: markers!, selection }
      : null;

  return (
    <div className="app">
      <Toolbar
        project={project}
        sizeId={size?.id ?? ''}
        setSize={setSizeId}
        update={update}
        canUndo={store.canUndo}
        canRedo={store.canRedo}
        undo={store.undo}
        redo={store.redo}
        onNew={newProject}
        onOpen={open}
        onSave={save}
      />
      {store.notice && (
        <NoticeBar
          notice={store.notice}
          onClose={() => store.setNotice(null)}
          onAction={() => {
            const r = mergeSampleTable(project);
            store.update(() => r.project);
            store.setNotice({ kind: 'info', title: 'Merged the Ysolda sizing table (undo to go back)', lines: r.summary });
          }}
        />
      )}
      <ErrorBoundary onUndo={store.undo} resetKey={project}>
      <div className="main">
        <Sidebar
          project={project}
          sizeId={size?.id ?? ''}
          panelId={panel?.id ?? null}
          update={update}
          selectPanel={selectPanel}
          selectedJoin={selection.kind === 'join' ? selection.id : null}
          selectJoin={(id) => {
            setSelection({ kind: 'join', id });
            setCenter('schematic');
            const first = project.joins?.find((j) => j.id === id)?.edges[0];
            if (first && project.panels.some((p) => p.id === first.panelId)) setPanelId(first.panelId);
          }}
        />
        <section className="center">
          <div className="canvas-title">
            <div className="segmented">
              <button className={center === 'schematic' ? 'active' : ''} onClick={() => setCenter('schematic')}>Schematic</button>
              <button className={center === 'chart' ? 'active' : ''} onClick={() => setCenter('chart')}>Chart</button>
              <button className={center === 'layout' ? 'active' : ''} onClick={() => setCenter('layout')}>Layout</button>
              <button className={center === 'measurements' ? 'active' : ''} onClick={() => setCenter('measurements')}>Measurements</button>
            </div>
            {center !== 'measurements' && (
              <SizeModeBar
                project={project}
                mode={center === 'chart' && sizeMode === 'overlay' ? 'single' : sizeMode}
                setMode={setSizeMode}
                compare={compare}
                setCompare={setCompare}
                align={align}
                setAlign={setAlign}
                modes={center === 'chart' ? ['single', 'grid'] : undefined}
              />
            )}
            {center === 'layout' && (
              <>
                <span className="spacer" />
                <button onClick={() => window.dispatchEvent(new Event('knitbit:fit'))} title="Fit (F)">Fit</button>
              </>
            )}
            {center === 'chart' && panel && (
              <>
                <strong>{panel.name}</strong>
                <span className="muted">
                  · size {size ? sizeText(size, project) : ''} · {panel.yoke ? 'seen from above, row 1 at the neck' : panel.direction === 'top-down' ? 'row 1 at top' : 'row 1 at bottom'}
                  {panel.direction === 'side-to-side' ? ' · worked side to side (chart in knitting orientation)' : ''}
                </span>
              </>
            )}
            {center === 'schematic' && panel && (
              <>
                <strong>{panel.name}</strong>
                <span className="muted">
                  · size {size ? sizeText(size, project) : ''} · {panel.yoke ? 'seen from above' : panel.direction}
                  {panel.yoke ? '' : panel.direction === 'top-down' ? ' (row 1 at top)' : panel.direction === 'bottom-up' ? ' (row 1 at bottom)' : ''}
                  {panel.inTheRound ? ' · in the round' : panel.joinAt ? ' · round below ' + (panel.waypoints.find((w) => w.id === panel.joinAt)?.name ?? '?') : ''}
                </span>
                <span className="spacer" />
                {sizeMode === 'single' && size && !panel.yoke && <CascadePicker project={project} currentSizeId={size.id} cascade={cascade ?? null} setCascade={setCascade} />}
                {sizeMode === 'single' && !panel.yoke && <Legend />}
                {sizeMode === 'single' && panel.direction !== 'side-to-side' && !panel.yoke && (
                  <button className={drawLine ? 'active' : ''} onClick={() => setDrawLine(!drawLine)} title="Draw a shaping line: click its two ends (Esc cancels)">
                    ✎ Line
                  </button>
                )}
                <button onClick={() => window.dispatchEvent(new Event('knitbit:fit'))} title="Fit (F)">Fit</button>
              </>
            )}
          </div>
          <Suspense fallback={<div className="canvas-empty"><p>Loading…</p></div>}>
            {center === 'layout' ? (
              <LayoutView
                project={project}
                update={update}
                sizeId={size?.id ?? ''}
                mode={sizeMode}
                compare={compare}
                align={align}
                computed={computedFor}
                selectedPanel={panel?.id ?? null}
                onSelectPanel={(id) => {
                  setPanelId(id);
                  setSelection(PANEL_SELECTION);
                }}
                onSelectJoin={(id) => setSelection({ kind: 'join', id })}
              />
            ) : (center === 'chart' || center === 'schematic') && panel?.yoke && computed ? (
              <YokeTopView
                project={project}
                panel={panel}
                computed={computed}
                view={center === 'chart' ? 'chart' : 'schematic'}
                mode={center === 'chart' && sizeMode === 'overlay' ? 'single' : sizeMode}
                compare={(sizeMode === 'single' ? [size?.id ?? ''] : compare).map((sid) => computedFor(panel.id, sid))}
                units={project.units}
                buttons={yokeButtons}
              />
            ) : center === 'chart' && panel && computed ? (
              <ChartView
                project={project}
                panel={panel}
                computed={computed}
                selection={selection}
                onSelect={setSelection}
                markers={markers}
                update={update}
                grid={sizeMode === 'grid' ? compare.map((sid) => ({ computed: computedFor(panel.id, sid), name: (() => { const s = project.sizes.find((z) => z.id === sid); return s ? sizeText(s, project) : ''; })() })) : undefined}
              />
            ) : center === 'measurements' ? (
              <MeasurementsView
                project={project}
                update={update}
                selected={measSel}
                onSelect={setMeasSel}
                currentSizeId={size?.id ?? ''}
                onSize={setSizeId}
                onImport={() => setImporting(true)}
              />
            ) : panel && computed ? (
              <Schematic
                computed={computed}
                direction={panel.direction}
                units={project.units}
                selection={selection}
                onSelect={setSelection}
                fitKey={panel.id}
                fitOutlines={fitOutlines}
                markers={markers}
                joins={panelJoins(project, panel.id)}
                mode={sizeMode}
                compare={compare.map((sid) => computedFor(panel.id, sid))}
                align={align}
                project={project}
                bands={sizeMode === 'single' ? bands : undefined}
                onDragWaypoint={(wpId, ch, sizeOnly, key) => {
                  const w = computed.waypoints.find((x) => x.id === wpId);
                  if (!w || !size) return;
                  const mode = sizeOnly ? 'size' : 'all';
                  if (ch.kind === 'height') {
                    const h0 = (scope[`${w.key}.height`] ?? w.heightCm) - w.heightCm;
                    update((p) => dragHeight(p, panel.id, wpId, size.id, ch.h + h0, mode, cascade), key);
                  } else {
                    if (wpDragStart.current?.key !== key) wpDragStart.current = { key, value: scope[`${w.key}.${ch.part}`] ?? 0 };
                    const start = wpDragStart.current.value;
                    if (start > 0) update((p) => dragWidth(p, panel.id, wpId, size.id, ch.part, start * ch.factor, mode, cascade), key);
                  }
                }}
                drawLine={drawLine && sizeMode === 'single'}
                onDrawLine={(a, b) => {
                  const w0 = computed.waypoints[0];
                  const h0 = (scope[`${w0.key}.height`] ?? w0.heightCm) - w0.heightCm;
                  const n = (panel.shapingLines?.length ?? 0) + 1;
                  const line = lineFromPoints(panel, scope, { h: a.h + h0, x: a.x }, { h: b.h + h0, x: b.x }, `Line ${n}`);
                  update((p) => editPanel(p, panel.id, (pn) => void (pn.shapingLines = [...(pn.shapingLines ?? []), line])));
                  setSelection({ kind: 'line', id: line.id });
                  setDrawLine(false);
                }}
              />
            ) : (
              <div className="canvas-empty">
                <p>No panel selected. Add one from the Panels tab.</p>
              </div>
            )}
          </Suspense>
          <CheckPanel
            project={project}
            sizeId={size?.id ?? ''}
            onGo={(g, sid) => {
              setPanelId(g.panelId);
              setSizeId(sid);
              setCenter('schematic');
              setSelection(g.issue.ref.kind === 'panel' ? PANEL_SELECTION : g.issue.ref);
              if (g.issue.ref.kind === 'join') setPanelId(g.panelId);
            }}
          />
        </section>
        <aside className="sidebar right">
          {selection.kind === 'join' && center !== 'measurements' ? (
            <JoinProps project={project} joinId={selection.id} sizeId={size?.id ?? ''} units={project.units} update={update} onDone={() => setSelection(PANEL_SELECTION)} />
          ) : center === 'measurements' ? (
            measSel ? (
              <MeasurementProps ctx={{ project, update, sizeId: size?.id ?? '', onSelect: setMeasSel, onSize: setSizeId }} name={measSel} />
            ) : (
              <SizesProps ctx={{ project, update, sizeId: size?.id ?? '', onSelect: setMeasSel, onSize: setSizeId }} />
            )
          ) : ctx ? (
            <Properties ctx={ctx} selection={selection} />
          ) : (
            <p className="muted pad">Nothing selected.</p>
          )}
        </aside>
      </div>
      </ErrorBoundary>
      {importing && (
        <Suspense fallback={null}>
          <ImportDialog
            project={project}
            onCancel={() => setImporting(false)}
            onImport={(next, summary) => {
              store.replace(next);
              setImporting(false);
              setCenter('measurements');
              store.setNotice({ kind: summary.length > 4 ? 'warning' : 'info', title: 'Sizing table imported', lines: summary });
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

function Legend() {
  return (
    <span className="legend">
      <span><i className="lg-dec" /> decrease</span>
      <span><i className="lg-inc" /> increase</span>
      <span><i className="lg-bo" /> bind off</span>
    </span>
  );
}

function NoticeBar({ notice, onClose, onAction }: { notice: Notice; onClose: () => void; onAction: () => void }) {
  return (
    <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <div className="notice-head">
        <strong>{notice.title}</strong>
        <button onClick={onClose} aria-label="Dismiss">×</button>
      </div>
      {notice.lines.length > 0 && <ul>{notice.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      {notice.action && <button className="notice-action" onClick={onAction}>{notice.action.label}</button>}
    </div>
  );
}
