import { useState } from 'react';
import type { Id, Project } from '../../engine/model';
import { SizeName } from './EstMark';

interface Props {
  project: Project;
  currentSizeId: Id;
  cascade: Id[] | null; // sizes that follow a waypoint drag; null = all
  setCascade: (ids: Id[] | null) => void;
}

/** Which sizes follow when a waypoint line is dragged or nudged (the current size always does). View setting. */
export function CascadePicker({ project, currentSizeId, cascade, setCascade }: Props) {
  const [open, setOpen] = useState(false);
  const others = project.sizes.filter((s) => s.id !== currentSizeId);
  const on = (id: Id) => cascade === null || cascade.includes(id);
  const count = others.filter((s) => on(s.id)).length;
  const label = count === others.length ? 'all sizes' : count === 0 ? 'this size only' : `${count + 1} of ${project.sizes.length} sizes`;
  const toggle = (id: Id, v: boolean) => {
    const cur = others.filter((s) => on(s.id)).map((s) => s.id);
    const next = v ? [...cur, id] : cur.filter((x) => x !== id);
    setCascade(next.length === others.length ? null : next);
  };
  return (
    <span className="size-pick">
      <button onClick={() => setOpen(!open)} title="Which sizes follow when you drag or nudge a waypoint line (Alt while dragging = this size only)">
        Drags change: {label} ▾
      </button>
      {open && (
        <div className="popover" onMouseLeave={() => setOpen(false)}>
          <div className="button-row">
            <button className="link" onClick={() => setCascade(null)}>all</button>
            <button className="link" onClick={() => setCascade([])}>this size only</button>
          </div>
          {project.sizes.map((s) => (
            <label key={s.id} className="check">
              <input type="checkbox" checked={s.id === currentSizeId || on(s.id)} disabled={s.id === currentSizeId} onChange={(e) => toggle(s.id, e.target.checked)} />
              <SizeName project={project} size={s} />
              {s.id === currentSizeId && <span className="muted small"> (this size)</span>}
            </label>
          ))}
          <p className="hint">Unticked sizes keep their values: the waypoint gets a fixed value for them. Ticked sizes follow proportionally.</p>
        </div>
      )}
    </span>
  );
}
