import { CUPS, CUSTOM_BUST, fitAliases, fitAliasList, HEMS } from '../../engine/fit';
import type { CupChoice, FitChoices, HemChoice, Project } from '../../engine/model';

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project, key?: string | null) => void;
}

/** Project-level fit choices: which sizing-table columns `bust`, `hem_circ`, `shoulder_w` … follow. */
export function FitSettings({ project, update }: Props) {
  const fit = project.fit;
  const set = (patch: Partial<FitChoices>) => update((p) => ({ ...p, fit: { ...p.fit, ...patch } }));
  const live = fitAliases(project);
  const missing = fitAliasList(project).filter((a) => !(a.name in live) && !project.measurements.some((m) => m.name === a.name));
  const overridden = fitAliasList(project).filter((a) => project.measurements.some((m) => m.name === a.name));
  return (
    <>
      <h4>Fit</h4>
      <div className="field">
        <label>Cup (bust, dart height, apex to apex)</label>
        <select value={fit.cup} onChange={(e) => set({ cup: e.target.value as CupChoice })}>
          {CUPS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          <option value="custom">Custom bust ({CUSTOM_BUST})</option>
        </select>
      </div>
      <div className="field">
        <label>Hem at (hem_circ, hem_drop)</label>
        <select value={fit.hem ?? 'high_hip'} onChange={(e) => set({ hem: e.target.value as HemChoice })}>
          {HEMS.map((h) => <option key={h.id} value={h.id}>{h.label} (waist to hem: {h.drop})</option>)}
        </select>
      </div>
      <label className="check" title="shoulder_w and cross_back_w use back_shoulder_width_broad and cross_back_broad">
        <input type="checkbox" checked={!!fit.broadBack} onChange={(e) => set({ broadBack: e.target.checked })} />
        Broad back (shoulder_w, cross_back_w)
      </label>
      <p className="hint">
        These pick sizing-table columns for names the templates use: {fitAliasList(project).map((a) => `${a.name} = ${a.expr}`).join(', ')}.
      </p>
      {missing.length > 0 && (
        <p className="err small">Not in this project: {missing.map((a) => a.expr).join(', ')}. Import or merge the sizing table, or pick another choice.</p>
      )}
      {overridden.length > 0 && (
        <p className="hint">Your own measurement wins over the choice for: {overridden.map((a) => a.name).join(', ')} (delete it in Measurements to follow the choice).</p>
      )}
    </>
  );
}
