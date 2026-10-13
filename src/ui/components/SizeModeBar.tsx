import { useState } from 'react';
import type { AlignRef } from '../../engine/layout';
import type { Id, Project } from '../../engine/model';
import { sizeColor } from '../sizeColors';

export type SizeMode = 'single' | 'overlay' | 'grid';

interface Props {
  project: Project;
  mode: SizeMode;
  setMode: (m: SizeMode) => void;
  compare: Id[];
  setCompare: (ids: Id[]) => void;
  align: AlignRef;
  setAlign: (a: AlignRef) => void;
  modes?: SizeMode[]; // which modes this view offers (default: all)
}

const ALIGNS: { value: AlignRef; label: string }[] = [
  { value: 'hem', label: 'lower edge' },
  { value: 'waist', label: 'waist' },
  { value: 'underarm', label: 'underarm' },
  { value: 'shoulder', label: 'shoulder' },
  { value: 'top', label: 'top' },
];

export function SizeModeBar({ project, mode, setMode, compare, setCompare, align, setAlign, modes = ['single', 'overlay', 'grid'] }: Props) {
  const [open, setOpen] = useState(false);
  const chosen = project.sizes.filter((s) => compare.includes(s.id));
  return (
    <div className="size-mode">
      <div className="segmented" title="How sizes are shown">
        {modes.map((m) => (
          <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
            {m === 'single' ? 'One size' : m === 'overlay' ? 'Overlay' : 'Grid'}
          </button>
        ))}
      </div>
      {mode !== 'single' && (
        <span className="size-pick">
          <button onClick={() => setOpen(!open)} title="Which sizes to show">
            Sizes: {chosen.length === project.sizes.length ? 'all' : chosen.map((s) => s.name).join(', ') || 'none'} ▾
          </button>
          {open && (
            <div className="popover" onMouseLeave={() => setOpen(false)}>
              <div className="button-row">
                <button className="link" onClick={() => setCompare(project.sizes.map((s) => s.id))}>all</button>
                <button className="link" onClick={() => setCompare([])}>none</button>
              </div>
              {project.sizes.map((s, i) => (
                <label key={s.id} className="check">
                  <input
                    type="checkbox"
                    checked={compare.includes(s.id)}
                    onChange={(e) => setCompare(e.target.checked ? project.sizes.filter((x) => x.id === s.id || compare.includes(x.id)).map((x) => x.id) : compare.filter((x) => x !== s.id))}
                  />
                  <i className="swatch" style={{ background: sizeColor(i, project.sizes.length) }} />
                  {s.name}
                </label>
              ))}
            </div>
          )}
        </span>
      )}
      {mode === 'overlay' && (
        <label className="align">
          align at{' '}
          <select value={align} onChange={(e) => setAlign(e.target.value as AlignRef)}>
            {ALIGNS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
