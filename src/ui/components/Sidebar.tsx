import { useState } from 'react';
import { FitSettings } from './FitSettings';
import { convertGauge, type GaugeBasis } from '../../engine/gauge';
import { newId, type Id, type Project } from '../../engine/model';
import { ensureEstimates } from '../../engine/seed';
import { fromTemplate, TEMPLATE_MEASUREMENTS, TEMPLATES, topDownTop, type TemplateId, type TemplateOptions } from '../../engine/templates';
import { roundTo } from '../../engine/units';
import { dropPanelFromJoins, JOIN_TAGS, type PanelCache } from '../../engine/joins';
import type { JoinTag } from '../../engine/model';
import { produce } from '../edit';
import { joinSummary } from './JoinProps';

interface Props {
  project: Project;
  sizeId: Id;
  panelId: Id | null;
  update: (fn: (p: Project) => Project, key?: string | null) => void;
  selectPanel: (id: Id | null) => void;
  selectedJoin: Id | null;
  selectJoin: (id: Id) => void;
}

type Tab = 'panels' | 'joins' | 'project';

export function Sidebar(props: Props) {
  const [tab, setTab] = useState<Tab>('panels');
  return (
    <aside className="sidebar left">
      <nav className="tabs">
        {(['panels', 'joins', 'project'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      <div className="sidebar-body">
        {tab === 'panels' && <PanelList {...props} />}
        {tab === 'joins' && <JoinList {...props} />}
        {tab === 'project' && <ProjectSettings {...props} />}
      </div>
    </aside>
  );
}

function PanelList({ project, panelId, update, selectPanel }: Props) {
  const [tpl, setTpl] = useState<TemplateId>('top');
  const [opts, setOpts] = useState<TemplateOptions>({
    direction: 'bottom-up',
    neckline: 'round',
    sleeve: 'set-in',
    joinInRound: true,
    construction: 'shoulders-first',
    shoulderSlope: 'shortrows',
    backNeck: 'straight',
  });
  const def = TEMPLATES.find((t) => t.id === tpl)!;
  const topDown = tpl === 'top' || opts.direction === 'top-down';
  const shouldersFirst = tpl === 'top' || (opts.direction === 'top-down' && opts.construction === 'shoulders-first');

  const add = () => {
    const set = tpl === 'top' ? topDownTop(opts) : { panels: [fromTemplate(tpl, opts)], joins: [] };
    const names = new Set(project.panels.map((p) => p.name));
    for (const panel of set.panels) {
      if (names.has(panel.name)) for (let i = 2; ; i++) if (!names.has(`${panel.name} ${i}`)) { panel.name = `${panel.name} ${i}`; break; }
      names.add(panel.name);
    }
    update((p) =>
      produce(ensureEstimates(p, TEMPLATE_MEASUREMENTS[tpl]).project, (d) => {
        d.panels.push(...set.panels);
        if (set.joins.length) d.joins = [...(d.joins ?? []), ...set.joins];
      }),
    );
    selectPanel(set.panels[set.panels.length - 1].id);
  };
  const duplicate = (id: Id) => {
    const src = project.panels.find((p) => p.id === id);
    if (!src) return;
    const copy = structuredClone(src);
    copy.id = newId('panel');
    copy.name = `${src.name} copy`;
    const idMap = new Map<string, string>();
    for (const w of copy.waypoints) {
      const nid = newId('wp');
      idMap.set(w.id, nid);
      w.id = nid;
    }
    for (const s of copy.segments) s.fromWaypoint = idMap.get(s.fromWaypoint) ?? s.fromWaypoint;
    if (copy.joinAt) copy.joinAt = idMap.get(copy.joinAt) ?? null;
    copy.linkedTo = null;
    for (const sec of copy.sections) sec.id = newId('sec');
    update((p) => produce(p, (d) => void d.panels.splice(d.panels.findIndex((x) => x.id === id) + 1, 0, copy)));
    selectPanel(copy.id);
  };
  const remove = (id: Id) => {
    const panel = project.panels.find((p) => p.id === id);
    if (!panel || !window.confirm(`Delete panel "${panel.name}"? You can undo this.`)) return;
    const idx = project.panels.indexOf(panel);
    update((p) =>
      produce(p, (d) => {
        d.panels = d.panels.filter((x) => x.id !== id);
        for (const x of d.panels) if (x.linkedTo === id) x.linkedTo = null;
        d.joins = dropPanelFromJoins(d.joins, id);
      }),
    );
    const next = project.panels[idx + 1] ?? project.panels[idx - 1];
    selectPanel(next ? next.id : null);
  };

  return (
    <>
      <ul className="panel-list">
        {project.panels.map((p) => (
          <li key={p.id} className={p.id === panelId ? 'active' : ''}>
            <button className="panel-name" onClick={() => selectPanel(p.id)}>{p.name}</button>
            <span className="panel-actions">
              <button className="icon" title="Duplicate" onClick={() => duplicate(p.id)}>⧉</button>
              <button className="icon" title="Delete" onClick={() => remove(p.id)}>×</button>
            </span>
          </li>
        ))}
        {project.panels.length === 0 && <li className="muted">No panels yet.</li>}
      </ul>
      <h4>Add panel</h4>
      <div className="add-panel">
        <select value={tpl} onChange={(e) => setTpl(e.target.value as TemplateId)}>
          {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <p className="hint">{def.description}</p>
        {def.options.includes('neckline') && (
          <label className="opt">Neckline
            <select value={opts.neckline} onChange={(e) => setOpts({ ...opts, neckline: e.target.value as TemplateOptions['neckline'] })}>
              <option value="round">Round</option>
              <option value="v">V</option>
              <option value="square">Square</option>
              <option value="boat">Boat</option>
            </select>
          </label>
        )}
        {def.options.includes('sleeve') && (
          <label className="opt">Type
            <select value={opts.sleeve} onChange={(e) => setOpts({ ...opts, sleeve: e.target.value as TemplateOptions['sleeve'] })}>
              <option value="set-in">Set-in cap</option>
              <option value="drop">Drop shoulder</option>
              <option value="straight">Straight</option>
            </select>
          </label>
        )}
        {def.options.includes('direction') && (
          <label className="opt">Knitted
            <select value={opts.direction} onChange={(e) => setOpts({ ...opts, direction: e.target.value as TemplateOptions['direction'] })}>
              <option value="bottom-up">Bottom-up</option>
              <option value="top-down">Top-down</option>
            </select>
          </label>
        )}
        {topDown && tpl !== 'top' && (tpl === 'back' || tpl === 'front') && (
          <label className="opt">Construction
            <select value={opts.construction} onChange={(e) => setOpts({ ...opts, construction: e.target.value as TemplateOptions['construction'] })}>
              <option value="shoulders-first">Shoulders first ({tpl === 'front' ? 'picked up from the back' : 'front picked up from it'})</option>
              <option value="standalone">Standalone (cast on at the top)</option>
            </select>
          </label>
        )}
        {topDown && def.options.includes('shoulderSlope') && (
          <label className="opt">Shoulders
            <select value={opts.shoulderSlope} onChange={(e) => setOpts({ ...opts, shoulderSlope: e.target.value as TemplateOptions['shoulderSlope'] })}>
              <option value="shortrows">Sloped (German short rows)</option>
              <option value="none">Straight</option>
            </select>
          </label>
        )}
        {topDown && def.options.includes('backNeck') && (
          <label className="opt">Back neck
            <select value={opts.backNeck} onChange={(e) => setOpts({ ...opts, backNeck: e.target.value as TemplateOptions['backNeck'] })}>
              <option value="straight">Straight (cast on across)</option>
              <option value="shaped">Shaped</option>
            </select>
          </label>
        )}
        {def.options.includes('shoulderFlare') && (
          <label className="check" title="After the armhole decreases reach the cross back/front, widen again to the shoulder width at the shoulder line.">
            <input type="checkbox" checked={opts.shoulderFlare ?? true} onChange={(e) => setOpts({ ...opts, shoulderFlare: e.target.checked })} />
            Widen to the shoulder width above the armhole
          </label>
        )}
        {shouldersFirst && <p className="hint">Underarms: half the cast-on on the front, half on the back (Underarm cast-on, an estimated measurement).</p>}
        {def.options.includes('joinInRound') && (
          <label className="check">
            <input type="checkbox" checked={!!opts.joinInRound} onChange={(e) => setOpts({ ...opts, joinInRound: e.target.checked })} />
            In the round below the underarm
          </label>
        )}
        <button className="primary" onClick={add}>{tpl === 'top' ? 'Add back + front' : `Add ${def.label.toLowerCase()}`}</button>
      </div>
    </>
  );
}

function JoinList({ project, sizeId, update, selectedJoin, selectJoin }: Props) {
  const [tag, setTag] = useState<JoinTag>('seam');
  const cache: PanelCache = new Map();
  const add = () => {
    const id = newId('join');
    const n = (project.joins ?? []).filter((j) => j.tag === tag).length + 1;
    update((p) =>
      produce(p, (d) => {
        d.joins = [...(d.joins ?? []), { id, name: `${JOIN_TAGS[tag].label} ${n}`, tag, edges: [], partner: [], ratio: null, note: '' }];
      }),
    );
    selectJoin(id);
  };
  return (
    <>
      <ul className="panel-list">
        {(project.joins ?? []).map((j) => (
          <li key={j.id} className={j.id === selectedJoin ? 'active' : ''}>
            <button className="panel-name" onClick={() => selectJoin(j.id)}>
              <i className="tag-chip" style={{ background: JOIN_TAGS[j.tag].color }} />
              {j.name}
              <span className="muted small"> · {joinSummary(project, j, sizeId, cache)}</span>
            </button>
          </li>
        ))}
        {!(project.joins ?? []).length && <li className="muted small">No joins yet. Tag edges here, or from an edge's properties.</li>}
      </ul>
      <h4>New join</h4>
      <div className="add-panel">
        <select value={tag} onChange={(e) => setTag(e.target.value as JoinTag)}>
          {Object.entries(JOIN_TAGS).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
        </select>
        <button className="primary" onClick={add}>Add</button>
      </div>
      <h4>Settings</h4>
      <div className="field">
        <label>Seam tolerance (cm)</label>
        <input className="num" type="number" step="0.1" min={0} value={project.settings.seamToleranceCm} onChange={(e) => update((p) => ({ ...p, settings: { ...p.settings, seamToleranceCm: Math.max(0, Number(e.target.value)) } }), 'settings.tol')} />
      </div>
      <div className="field">
        <label>Default pick-up ratio</label>
        <span className="inline">
          <input className="num tiny" type="number" min={1} value={project.settings.pickUp.stitches} onChange={(e) => update((p) => ({ ...p, settings: { ...p.settings, pickUp: { ...p.settings.pickUp, stitches: Math.max(1, Number(e.target.value)) } } }), 'settings.ps')} />
          <span className="muted">sts per</span>
          <input className="num tiny" type="number" min={1} value={project.settings.pickUp.rows} onChange={(e) => update((p) => ({ ...p, settings: { ...p.settings, pickUp: { ...p.settings.pickUp, rows: Math.max(1, Number(e.target.value)) } } }), 'settings.pr')} />
          <span className="muted">rows</span>
        </span>
      </div>
    </>
  );
}

function ProjectSettings({ project, update }: Props) {
  const g = project.gauge;
  const setBasis = (basis: GaugeBasis) =>
    update((p) => {
      const c = convertGauge(p.gauge, basis);
      return { ...p, gauge: { stitches: roundTo(c.stitches, 2), rows: roundTo(c.rows, 2), basis } };
    });
  return (
    <div className="props">
      <h4>Gauge</h4>
      <div className="row3">
        <div className="field">
          <label>Stitches</label>
          <input className="num" type="number" step="0.25" min={0} value={g.stitches} onChange={(e) => update((p) => ({ ...p, gauge: { ...p.gauge, stitches: Number(e.target.value) } }), 'gauge.sts')} />
        </div>
        <div className="field">
          <label>Rows</label>
          <input className="num" type="number" step="0.25" min={0} value={g.rows} onChange={(e) => update((p) => ({ ...p, gauge: { ...p.gauge, rows: Number(e.target.value) } }), 'gauge.rows')} />
        </div>
        <div className="field">
          <label>Over</label>
          <select value={g.basis} onChange={(e) => setBasis(e.target.value as GaugeBasis)}>
            <option value="10cm">10 cm</option>
            <option value="4in">4 in</option>
          </select>
        </div>
      </div>
      <FitSettings project={project} update={update} />
      <h4>Ease</h4>
      <div className="field">
        <label>Total circumference ease (cm)</label>
        <input className="num" type="number" step="0.5" value={project.ease.global} onChange={(e) => update((p) => ({ ...p, ease: { ...p.ease, global: Number(e.target.value) } }), 'ease.global')} />
        <div className="hint">Use <code>ease</code> in expressions; a front or back panel usually takes <code>ease / 2</code>.</div>
      </div>
    </div>
  );
}
