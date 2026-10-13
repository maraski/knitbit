import type { Id, Project } from '../../engine/model';
import { RegionPickers } from './RegionPickers';
import { useState } from 'react';
import { AboutBox } from './AboutBox';
import { sizeText } from './EstMark';

interface Props {
  project: Project;
  sizeId: Id;
  setSize: (id: Id) => void;
  update: (fn: (p: Project) => Project, key?: string | null) => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
}

export function Toolbar(p: Props) {
  const { project } = p;
  const [about, setAbout] = useState(false);
  const idx = project.sizes.findIndex((s) => s.id === p.sizeId);
  const step = (d: number) => {
    const next = project.sizes[Math.min(project.sizes.length - 1, Math.max(0, idx + d))];
    if (next) p.setSize(next.id);
  };
  return (
    <header className="toolbar">
      <span className="brand">Knitbit</span>
      <input
        className="project-name"
        value={project.name}
        onChange={(e) => p.update((x) => ({ ...x, name: e.target.value }), 'project.name')}
        aria-label="Project name"
      />
      <span className="sep" />
      <button onClick={p.undo} disabled={!p.canUndo} title="Undo (⌘Z)">↶</button>
      <button onClick={p.redo} disabled={!p.canRedo} title="Redo (⇧⌘Z)">↷</button>
      <span className="sep" />
      <button onClick={p.onNew} title="New project from the sample sizing table">New</button>
      <button onClick={p.onOpen} title="Open (⌘O)">Open…</button>
      <button onClick={p.onSave} title="Save (⌘S)">Save</button>
      <span className="spacer" />
      <div className="size-picker" title="Size ([ and ])">
        <button onClick={() => step(-1)} disabled={idx <= 0}>‹</button>
        <select value={p.sizeId} onChange={(e) => p.setSize(e.target.value)}>
          {project.sizes.map((s) => (
            <option key={s.id} value={s.id}>
              {sizeText(s, project)}
              {s.id === project.baseSizeId ? ' (base)' : ''}
            </option>
          ))}
        </select>
        <button onClick={() => step(1)} disabled={idx >= project.sizes.length - 1}>›</button>
      </div>
      {project.settings.regionSizing && <RegionPickers project={project} sizeId={p.sizeId} update={p.update} />}
      <div className="segmented" title="Units">
        {(['metric', 'imperial'] as const).map((u) => (
          <button key={u} className={project.units === u ? 'active' : ''} onClick={() => p.update((x) => ({ ...x, units: u }))}>
            {u === 'metric' ? 'cm' : 'in'}
          </button>
        ))}
      </div>
      <button onClick={() => setAbout(true)} title="About Knitbit and the sizing data">About</button>
      {about && <AboutBox onClose={() => setAbout(false)} />}
    </header>
  );
}
