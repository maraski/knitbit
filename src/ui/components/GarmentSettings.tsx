import { useEffect, useState } from 'react';
import { CONSTRUCTIONS, CONTIGUOUS_CREDIT, OPENINGS, parseTags, setConstruction, setOpening } from '../../engine/garment';
import type { Construction, FrontOpening, Project } from '../../engine/model';
import { generateBodyAndSleeves, missingYokePanels } from '../../engine/contiguousGarment';

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project, key?: string | null) => void;
}

/** Project → Garment: construction, front opening, tags and the export credit line. */
export function GarmentSettings({ project, update }: Props) {
  const g = project.garment;
  const construction = CONSTRUCTIONS.find((c) => c.id === g.construction)!;
  const opening = OPENINGS.find((o) => o.id === g.opening)!;
  const [changes, setChanges] = useState<string[]>([]);
  return (
    <>
      <h4>Garment</h4>
      <div className="field">
        <label>Construction</label>
        <select value={g.construction} onChange={(e) => update((p) => setConstruction(p, e.target.value as Construction))}>
          {CONSTRUCTIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Front opening</label>
        <select
          value={g.opening}
          onChange={(e) => {
            const opening = e.target.value as FrontOpening;
            const notes: string[] = [];
            setOpening(project, opening, notes); // to say what changes
            setChanges(notes);
            update((p) => setOpening(p, opening));
          }}
        >
          {OPENINGS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      <p className="hint">
        {construction.description} {opening.description}
      </p>
      {changes.length > 0 && (
        <ul className="hint changes">
          {changes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
      {g.construction === 'contiguous' && <ContiguousPanels project={project} update={update} />}
      <TagsField project={project} update={update} />
      <label className="check">
        <input type="checkbox" checked={project.settings.exportCredit !== false} onChange={(e) => update((p) => ({ ...p, settings: { ...p.settings, exportCredit: e.target.checked } }))} />
        Credit the construction method in export footers
      </label>
      {g.construction === 'contiguous' && <p className="hint credit">{CONTIGUOUS_CREDIT}</p>}
    </>
  );
}

/** Contiguous construction: make the yoke, body and sleeves when asked (never automatically). */
function ContiguousPanels({ project, update }: Props) {
  const hasYoke = project.panels.some((p) => p.yoke);
  const missing = missingYokePanels(project);
  if (hasYoke && !missing.length) return <p className="hint">The yoke, body and sleeves are in the panel list; the body and sleeves follow the yoke in every size.</p>;
  const what = [...(hasYoke ? [] : ['yoke']), ...missing.map((m) => ({ back: 'back', front: 'front', leftSleeve: 'left sleeve', rightSleeve: 'right sleeve' })[m])];
  return (
    <div className="strips-missing">
      <span className="hint">
        Not made yet: {what.join(', ')}.{project.panels.some((p) => !p.yoke && !p.fromYoke && (p.template === 'back' || p.template === 'front' || (p.template ?? '').startsWith('sleeve'))) ? ' Your other body and sleeve panels are kept; delete them if you don’t need them.' : ''}
      </span>{' '}
      <button onClick={() => update((p) => generateBodyAndSleeves(p))}>Add {hasYoke ? 'body and sleeves' : 'yoke, body and sleeves'}</button>
    </div>
  );
}

function TagsField({ project, update }: Props) {
  const text = project.tags.join(', ');
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const commit = () => {
    const tags = parseTags(draft);
    if (tags.join(', ') !== text) update((p) => ({ ...p, tags }));
    else setDraft(text);
  };
  return (
    <div className="field">
      <label>Tags</label>
      <input
        type="text"
        value={draft}
        placeholder="comma separated"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}
