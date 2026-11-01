import { useMemo, useState } from 'react';
import { groupChecks, projectChecks, rootChecks, type CheckGroup } from '../../engine/checks';
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const all = useMemo(() => projectChecks(project), [project]);
  const filtered = all.filter((c) => (scope === 'all' || c.sizeId === sizeId) && (notes || c.issue.severity !== 'info'));
  const groups = groupChecks(filtered);
  // Root causes only: a knock-on (a piece waiting on the yoke) isn't counted again.
  const roots = rootChecks(all.filter((c) => scope === 'all' || c.sizeId === sizeId));
  const count = (sev: string) => roots.filter((c) => c.issue.severity === sev).length;
  const errors = count('error');
  const warnings = count('warning');
  const infos = count('info');
  const toggle = (key: string) => setExpanded((s) => {
    const n = new Set(s);
    if (!n.delete(key)) n.add(key);
    return n;
  });

  const row = (g: CheckGroup, knockOn = false) => {
    const here = g.sizes.find((s) => s.id === sizeId);
    const fix = (here ?? g.sizes[0]).fix;
    // The need differs by size: list it per size (this size first).
    const needs = g.sizes.filter((s) => s.fix?.need);
    const perSize = needs.length > 1 && new Set(needs.map((s) => s.fix!.need)).size > 1;
    const knockOns = g.knockOns.length;
    const where = [...new Set(g.knockOns.filter((k) => k.issue.ref.kind !== 'join').map((k) => k.panelName)), ...(g.knockOns.some((k) => k.issue.ref.kind === 'join') ? ['joins'] : [])];
    return (
      <li key={g.key} className={`issue issue-${g.issue.severity}${knockOn ? ' issue-knock-on' : ''}`}>
        <div className="check-row">
          <button className="link" onClick={() => onGo(g, here ? sizeId : g.sizes[0].id)}>
            <strong>{g.panelName}</strong> · {here?.message ?? g.issue.message}
          </button>
          <span className="check-sizes">
            {g.sizes.length === project.sizes.length ? 'all sizes' : g.sizes.map((s) => s.name).join(', ')}
          </span>
        </div>
        {fix?.text && (
          <div className="issue-fix">
            <strong>Fix:</strong> {fix.text}
            {perSize && <span className="check-needs"> {fix.fields[0]?.label}: {[...(here?.fix?.need ? [here] : []), ...needs.filter((s) => s !== here)].map((s) => `${s.fix!.need} (${s.name})`).join(' · ')}</span>}
          </div>
        )}
        {knockOns > 0 && (
          <>
            <button className="link check-knock-toggle" onClick={() => toggle(g.key)}>
              {expanded.has(g.key) ? '▾' : '▸'} +{knockOns} knock-on problem{knockOns > 1 ? 's' : ''} in {where.join(', ')}
            </button>
            {expanded.has(g.key) && <ul className="check-list check-knock-ons">{g.knockOns.map((k) => row(k, true))}</ul>}
          </>
        )}
      </li>
    );
  };

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
          {groups.length === 0 ? <p className="muted small">Nothing to report.</p> : <ul className="check-list">{groups.map((g) => row(g))}</ul>}
        </div>
      )}
    </div>
  );
}
