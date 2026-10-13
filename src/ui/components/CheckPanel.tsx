import { useMemo, useState } from 'react';
import { groupChecks, projectChecks, type CheckGroup } from '../../engine/checks';
import type { Id, Project } from '../../engine/model';

interface Props {
  project: Project;
  sizeId: Id;
  onGo: (g: CheckGroup, sizeId: Id) => void;
}

/** Collapsible list of everything odd or impossible, across all panels and sizes. */
export function CheckPanel({ project, sizeId, onGo }: Props) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'size' | 'all'>('all');
  const [notes, setNotes] = useState(false);
  const all = useMemo(() => projectChecks(project), [project]);
  const filtered = all.filter((c) => (scope === 'all' || c.sizeId === sizeId) && (notes || c.issue.severity !== 'info'));
  const groups = groupChecks(filtered);
  const count = (sev: string) => all.filter((c) => c.issue.severity === sev && (scope === 'all' || c.sizeId === sizeId)).length;
  const errors = count('error');
  const warnings = count('warning');
  const infos = count('info');

  return (
    <div className={`check-panel${open ? ' open' : ''}`}>
      <button className="check-head" onClick={() => setOpen(!open)}>
        <span className="check-title">Checks</span>
        {errors > 0 && <span className="pill pill-error">{errors} error{errors > 1 ? 's' : ''}</span>}
        {warnings > 0 && <span className="pill pill-warning">{warnings} warning{warnings > 1 ? 's' : ''}</span>}
        {infos > 0 && <span className="pill pill-info">{infos} note{infos > 1 ? 's' : ''}</span>}
        {errors + warnings + infos === 0 && <span className="muted small">All clear</span>}
        <span className="spacer" />
        <span className="muted">{open ? '▾' : '▴'}</span>
      </button>
      {open && (
        <div className="check-body">
          <div className="check-filters">
            <div className="segmented">
              <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>All sizes</button>
              <button className={scope === 'size' ? 'active' : ''} onClick={() => setScope('size')}>This size</button>
            </div>
            <label className="check">
              <input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} /> Show notes
            </label>
          </div>
          {groups.length === 0 ? (
            <p className="muted small">Nothing to report.</p>
          ) : (
            <ul className="check-list">
              {groups.map((g) => (
                <li key={g.key} className={`issue issue-${g.issue.severity}`}>
                  <button className="link" onClick={() => onGo(g, g.sizes.some((s) => s.id === sizeId) ? sizeId : g.sizes[0].id)}>
                    <strong>{g.panelName}</strong> · {g.sizes.find((s) => s.id === sizeId)?.message ?? g.issue.message}
                  </button>
                  <span className="check-sizes">
                    {g.sizes.length === project.sizes.length ? 'all sizes' : g.sizes.map((s) => s.name).join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
