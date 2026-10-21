import { useEffect, useState } from 'react';
import { CONTIGUOUS_CREDIT, OPENINGS, parseTags, setOpening } from '../../engine/garment';
import { changeMethod, garmentChoice, METHODS, NECKLINES, setNeckline, setSleeve, SLEEVES, sleevesFor, type GarmentMethod, type SleeveChoice } from '../../engine/garmentSetup';
import type { FrontOpening, Id, Project } from '../../engine/model';
import { generateBodyAndSleeves, missingYokePanels } from '../../engine/contiguousGarment';
import { EdgeSettings } from './EdgeSettings';

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project, key?: string | null) => void;
}

/** A change that rebuilds pieces, shown with what it does until the knitter confirms it. */
interface Pending {
  title: string;
  notes: string[];
  apply: (p: Project) => Project;
}

/** Garment tab: how it's built, front, neckline, sleeves, edges, tags and the export credit line. */
export function GarmentSettings({ project, update, sizeId }: Props & { sizeId: Id }) {
  const choice = garmentChoice(project);
  const method = METHODS.find((m) => m.id === (choice.method === 'custom' ? 'blank' : choice.method))!;
  const opening = OPENINGS.find((o) => o.id === choice.opening)!;
  const [changes, setChanges] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const sleeves = sleevesFor(choice.method);

  const askMethod = (m: Exclude<GarmentMethod, 'blank'>) => {
    const notes: string[] = [];
    changeMethod(project, m, notes); // to say what changes
    setPending({ title: `Rebuild as ${METHODS.find((x) => x.id === m)!.label.toLowerCase()}?`, notes, apply: (p) => changeMethod(p, m) });
  };
  const askSleeve = (sl: SleeveChoice) => {
    const notes: string[] = [];
    setSleeve(project, sl, notes);
    setPending({ title: `Change the sleeves to ${SLEEVES.find((x) => x.id === sl)!.label.toLowerCase()}?`, notes: [...notes, 'Undo goes back.'], apply: (p) => setSleeve(p, sl) });
  };

  return (
    <>
      <h4>How it’s built</h4>
      <div className="field">
        <select value={choice.method === 'custom' ? 'custom' : choice.method} onChange={(e) => askMethod(e.target.value as Exclude<GarmentMethod, 'blank'>)} aria-label="Construction method">
          {choice.method === 'custom' && <option value="custom" disabled>Custom (your own pieces)</option>}
          {METHODS.filter((m) => m.id !== 'blank').map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <div className="hint">{method.description}</div>
      </div>
      {pending && (
        <div className="method-changes" role="alertdialog" aria-label={pending.title}>
          <strong>{pending.title}</strong>
          <ul className="hint">{pending.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          <span className="inline">
            <button className="primary" onClick={() => { update(pending.apply); setPending(null); }}>Rebuild pieces</button>
            <button onClick={() => setPending(null)}>Cancel</button>
          </span>
        </div>
      )}
      <div className="field">
        <label>Front</label>
        <select
          value={choice.opening}
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
        <div className="hint">{opening.description}</div>
      </div>
      {changes.length > 0 && (
        <ul className="hint changes">
          {changes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
      {choice.method !== 'custom' && (
        <div className="row2">
          <div className="field">
            <label>Neckline</label>
            <select value={choice.neckline} onChange={(e) => update((p) => setNeckline(p, e.target.value as typeof choice.neckline))} title="Sets the front neck to this shape’s defaults">
              {NECKLINES.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Sleeves</label>
            <select value={choice.sleeve} onChange={(e) => askSleeve(e.target.value as SleeveChoice)} disabled={sleeves.length < 2}>
              {SLEEVES.filter((x) => x.id === choice.sleeve || sleeves.includes(x.id)).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </div>
        </div>
      )}
      <EdgeSettings project={project} sizeId={sizeId} update={update} />
      <h4>Project</h4>
      <TagsField project={project} update={update} />
      <label className="check">
        <input type="checkbox" checked={project.settings.exportCredit !== false} onChange={(e) => update((p) => ({ ...p, settings: { ...p.settings, exportCredit: e.target.checked } }))} />
        Credit the construction method in export footers
      </label>
      {choice.method === 'contiguous' && <p className="hint credit">{CONTIGUOUS_CREDIT}</p>}
    </>
  );
}

/** Contiguous construction: make the yoke, body and sleeves the yoke lacks (shown in Pieces; never automatic). */
export function ContiguousPanels({ project, update }: Props) {
  const hasYoke = project.panels.some((p) => p.yoke);
  const missing = missingYokePanels(project);
  if (hasYoke && !missing.length) return null;
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
