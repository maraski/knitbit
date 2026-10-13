import { useEffect, useMemo, useState } from 'react';
import type { Id } from '../engine/model';
import { buildScope } from '../engine/measurements';
import { computePanel, resolvePanelDims } from '../engine/panel';
import { loadProject, serializeProject } from '../engine/schema';
import { CheckPanel } from './components/CheckPanel';
import { ImportDialog } from './components/ImportDialog';
import { JoinProps } from './components/JoinProps';
import { MeasurementProps, SizesProps } from './components/MeasurementProps';
import { MeasurementsView } from './components/MeasurementsView';
import { Properties, type PropsContext } from './components/Properties';
import { Schematic } from './components/Schematic';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { downloadText, pickTextFile, safeFilename } from './fileio';
import { markerActions } from './markerActions';
import { panelJoins } from '../engine/joins';
import { PANEL_SELECTION, type Selection } from './selection';
import { sampleProject, useProjectStore, type Notice } from './store';

const VIEW_KEY = 'knitbit.view.v1';
type CenterView = 'schematic' | 'measurements';

function readView(): { sizeId?: Id; panelId?: Id; center?: CenterView } {
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
  const [measSel, setMeasSel] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Keep view state pointing at things that exist (after undo, open, delete…).
  const size = project.sizes.find((s) => s.id === sizeId) ?? project.sizes.find((s) => s.id === project.baseSizeId) ?? project.sizes[0];
  const panel = project.panels.find((p) => p.id === panelId) ?? project.panels[0] ?? null;

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ sizeId: size?.id, panelId: panel?.id, center }));
    } catch {
      /* ignore */
    }
  }, [size?.id, panel?.id, center]);

  const allSizes = useMemo(() => (panel ? project.sizes.map((s) => computePanel(project, panel, s.id)) : []), [project, panel]);
  const computed = allSizes.find((c) => c.sizeId === size?.id) ?? null;
  const fitOutlines = useMemo(() => allSizes.filter((c) => c.ok).map((c) => c.outline), [allSizes]);
  const scope = useMemo(() => {
    if (!panel || !size) return {};
    return { ...buildScope(project, size.id), ...resolvePanelDims(project, panel, size.id).values };
  }, [project, panel, size]);

  const markers = useMemo(() => (panel && size ? markerActions(update, panel.id, size.id) : undefined), [update, panel?.id, size?.id]);

  const selectPanel = (id: Id | null) => {
    setPanelId(id);
    setSelection(PANEL_SELECTION);
    setCenter('schematic');
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
    const lines = [...(r.migratedFrom !== null ? [`Upgraded from schema ${r.migratedFrom}.`] : []), ...r.warnings];
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
        } else if (k === 'escape') {
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
      {store.notice && <NoticeBar notice={store.notice} onClose={() => store.setNotice(null)} />}
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
              <button className={center === 'measurements' ? 'active' : ''} onClick={() => setCenter('measurements')}>Measurements</button>
            </div>
            {center === 'schematic' && panel && (
              <>
                <strong>{panel.name}</strong>
                <span className="muted">
                  · size {size?.name} · {panel.direction}
                  {panel.direction === 'top-down' ? ' (row 1 at top)' : panel.direction === 'bottom-up' ? ' (row 1 at bottom)' : ''}
                  {panel.inTheRound ? ' · in the round' : panel.joinAt ? ' · round below ' + (panel.waypoints.find((w) => w.id === panel.joinAt)?.name ?? '?') : ''}
                </span>
                <span className="spacer" />
                <Legend />
                <button onClick={() => window.dispatchEvent(new Event('knitbit:fit'))} title="Fit (F)">Fit</button>
              </>
            )}
          </div>
          {center === 'measurements' ? (
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
            />
          ) : (
            <div className="canvas-empty">
              <p>No panel selected. Add one from the Panels tab.</p>
            </div>
          )}
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
          {selection.kind === 'join' && center === 'schematic' ? (
            <JoinProps project={project} joinId={selection.id} sizeId={size?.id ?? ''} units={project.units} update={update} onDone={() => setSelection(PANEL_SELECTION)} />
          ) : center === 'measurements' ? (
            measSel ? (
              <MeasurementProps ctx={{ project, update, sizeId: size?.id ?? '', onSelect: setMeasSel }} name={measSel} />
            ) : (
              <SizesProps ctx={{ project, update, sizeId: size?.id ?? '', onSelect: setMeasSel }} />
            )
          ) : ctx ? (
            <Properties ctx={ctx} selection={selection} />
          ) : (
            <p className="muted pad">Nothing selected.</p>
          )}
        </aside>
      </div>
      {importing && (
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

function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return (
    <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <div className="notice-head">
        <strong>{notice.title}</strong>
        <button onClick={onClose} aria-label="Dismiss">×</button>
      </div>
      {notice.lines.length > 0 && <ul>{notice.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </div>
  );
}
