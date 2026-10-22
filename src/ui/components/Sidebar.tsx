import { useState } from 'react';
import { DEFAULT_REGION_GAP } from '../../engine/fitChecks';
import { FitSettings } from './FitSettings';
import { ContiguousPanels, GarmentSettings } from './GarmentSettings';
import { conformToGarment } from '../../engine/garment';
import { EASE_PRESETS, easePresetOf, extraPieces, garmentChoice, isYokeMethod, withEasePreset, type EasePresetId } from '../../engine/garmentSetup';
import { convertGauge, type GaugeBasis } from '../../engine/gauge';
import { newId, type Id, type Project, type SleeveLength } from '../../engine/model';
import { ensureEstimates } from '../../engine/estimates';
import { fromTemplate, sleeveLengthsFor, TEMPLATE_MEASUREMENTS, TEMPLATES, type TemplateId, type TemplateOptions } from '../../engine/templates';
import { SLEEVE_LENGTHS, sleeveLengthNeeds } from '../../engine/sleeveLength';
import { roundTo } from '../../engine/units';
import { dropPanelFromJoins, JOIN_TAGS, joinReport, type PanelCache } from '../../engine/joins';
import type { Join, JoinTag } from '../../engine/model';
import { produce } from '../edit';
import { signed } from '../format';

interface Props {
  project: Project;
  sizeId: Id;
  panelId: Id | null;
  update: (fn: (p: Project) => Project, key?: string | null) => void;
  selectPanel: (id: Id | null) => void;
  selectedJoin: Id | null;
  selectJoin: (id: Id) => void;
}

type Tab = 'garment' | 'pieces' | 'settings';
const TAB_KEY = 'knitbit.sidebarTab.v1';

function readTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t === 'garment' || t === 'pieces' || t === 'settings' ? t : 'garment';
  } catch {
    return 'garment';
  }
}

export function Sidebar(props: Props) {
  const [tab, setTabState] = useState<Tab>(readTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  };
  return (
    <aside className="sidebar left">
      <nav className="tabs">
        {(['garment', 'pieces', 'settings'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      <div className="sidebar-body">
        {tab === 'garment' && <div className="props"><GarmentSettings project={props.project} sizeId={props.sizeId} update={props.update} /></div>}
        {tab === 'pieces' && (
          <>
            <PanelList {...props} />
            <details className="joins-section" open>
              <summary>Joins</summary>
              <JoinList {...props} />
            </details>
          </>
        )}
        {tab === 'settings' && <ProjectSettings {...props} />}
      </div>
    </aside>
  );
}

function PanelList({ project, panelId, update, selectPanel }: Props) {
  const method = garmentChoice(project).method;
  const offered = extraPieces(method);
  // Pieces follow the method's direction; a custom garment chooses per piece.
  const fixedDirection = method === 'seamed' ? 'bottom-up' : method === 'top-down' ? 'top-down' : null;
  const [picked, setTpl] = useState<TemplateId>('sleeve');
  const tpl = offered.includes(picked) ? picked : offered[0];
  const [chosen, setOpts] = useState<TemplateOptions>({
    direction: 'bottom-up',
    neckline: garmentChoice(project).neckline,
    sleeve: 'set-in',
    joinInRound: true,
    construction: 'shoulders-first',
    shoulderSlope: 'shortrows',
    backNeck: 'straight',
  });
  const opts: TemplateOptions = fixedDirection && tpl !== 'rectangle' ? { ...chosen, direction: fixedDirection, joinInRound: fixedDirection === 'top-down' } : chosen;
  const def = TEMPLATES.find((t) => t.id === tpl)!;
  const topDown = opts.direction === 'top-down';
  const shouldersFirst = opts.direction === 'top-down' && opts.construction === 'shoulders-first' && (tpl === 'back' || tpl === 'front');

  const add = () => {
    const set = { panels: [fromTemplate(tpl, opts)], joins: [] };
    const names = new Set(project.panels.map((p) => p.name));
    for (const panel of set.panels) {
      if (names.has(panel.name)) for (let i = 2; ; i++) if (!names.has(`${panel.name} ${i}`)) { panel.name = `${panel.name} ${i}`; break; }
      names.add(panel.name);
    }
    update((p) =>
      conformToGarment(
        produce(ensureEstimates(p, [...TEMPLATE_MEASUREMENTS[tpl], ...(tpl === 'sleeve' ? sleeveLengthNeeds(opts.sleeveLength) : [])]).project, (d) => {
          d.panels.push(...set.panels);
          if (set.joins.length) d.joins = [...(d.joins ?? []), ...set.joins];
        }),
      ),
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
    if (copy.half) copy.half = { ...copy.half, pair: null };
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
        for (const x of d.panels) if (x.half?.pair === id) x.half.pair = null;
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
        {project.panels.length === 0 && <li className="muted">No pieces yet.</li>}
      </ul>
      {isYokeMethod(method) && <ContiguousPanels project={project} update={update} />}
      <h4>Add a piece</h4>
      <div className="add-panel">
        <select value={tpl} onChange={(e) => setTpl(e.target.value as TemplateId)}>
          {TEMPLATES.filter((t) => offered.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <p className="hint">{def.description}</p>
        {def.options.includes('neckline') && (
          <label className="opt">Neckline
            <select value={opts.neckline} onChange={(e) => setOpts({ ...chosen, neckline: e.target.value as TemplateOptions['neckline'] })}>
              <option value="round">Round</option>
              <option value="v">V</option>
              <option value="square">Square</option>
              <option value="boat">Boat</option>
            </select>
          </label>
        )}
        {def.options.includes('sleeve') && (
          <label className="opt">Type
            <select value={opts.sleeve} onChange={(e) => { const sleeve = e.target.value as NonNullable<TemplateOptions['sleeve']>; setOpts({ ...chosen, sleeve, sleeveLength: sleeve !== 'set-in' && chosen.sleeveLength === 'cap' ? 'short' : chosen.sleeveLength }); }}>
              <option value="set-in">Set-in cap</option>
              <option value="drop">Drop shoulder</option>
              <option value="straight">Straight</option>
            </select>
          </label>
        )}
        {def.options.includes('sleeveLength') && (
          <label className="opt">Length
            <select value={opts.sleeveLength ?? 'long'} onChange={(e) => setOpts({ ...chosen, sleeveLength: e.target.value as SleeveLength })}>
              {SLEEVE_LENGTHS.filter((l) => sleeveLengthsFor(opts.sleeve ?? 'set-in').includes(l.id)).reverse().map((l) => <option key={l.id} value={l.id}>{l.id === 'cap' ? 'Cap sleeve' : l.label}</option>)}
            </select>
          </label>
        )}
        {def.options.includes('direction') && (!fixedDirection || tpl === 'rectangle') && (
          <label className="opt">Knitted
            <select value={opts.direction} onChange={(e) => setOpts({ ...chosen, direction: e.target.value as TemplateOptions['direction'] })}>
              <option value="bottom-up">Bottom-up</option>
              <option value="top-down">Top-down</option>
            </select>
          </label>
        )}
        {topDown && (tpl === 'back' || tpl === 'front') && (
          <label className="opt">{tpl === 'front' ? 'Front worked from' : 'Back worked from'}
            <select value={opts.construction} onChange={(e) => setOpts({ ...chosen, construction: e.target.value as TemplateOptions['construction'] })}>
              <option value="shoulders-first">{tpl === 'front' ? 'The back’s shoulders (picked up)' : 'Its shoulders (the fronts are picked up from it)'}</option>
              <option value="standalone">Its own cast-on at the top</option>
            </select>
          </label>
        )}
        {topDown && def.options.includes('shoulderSlope') && (
          <label className="opt">Shoulders
            <select value={opts.shoulderSlope} onChange={(e) => setOpts({ ...chosen, shoulderSlope: e.target.value as TemplateOptions['shoulderSlope'] })}>
              <option value="shortrows">Sloped (German short rows)</option>
              <option value="none">Straight</option>
            </select>
          </label>
        )}
        {topDown && def.options.includes('backNeck') && (
          <label className="opt">Back neck
            <select value={opts.backNeck} onChange={(e) => setOpts({ ...chosen, backNeck: e.target.value as TemplateOptions['backNeck'] })}>
              <option value="straight">Straight (cast on across)</option>
              <option value="shaped">Shaped</option>
            </select>
          </label>
        )}
        {def.options.includes('shoulderFlare') && (
          <label className="check" title="After the armhole decreases reach the cross back/front, widen again to the shoulder width at the shoulder line.">
            <input type="checkbox" checked={opts.shoulderFlare ?? true} onChange={(e) => setOpts({ ...chosen, shoulderFlare: e.target.checked })} />
            Widen to the shoulder width above the armhole
          </label>
        )}
        {shouldersFirst && <p className="hint">Underarms: half the cast-on on the front, half on the back (Underarm cast-on, an estimated measurement).</p>}
        {def.options.includes('joinInRound') && !fixedDirection && (
          <label className="check">
            <input type="checkbox" checked={!!opts.joinInRound} onChange={(e) => setOpts({ ...chosen, joinInRound: e.target.checked })} />
            In the round below the underarm
          </label>
        )}
        <button className="primary" onClick={add}>Add {def.label.toLowerCase()}</button>
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
      <h4>Region sizing</h4>
      <label className="check">
        <input
          type="checkbox"
          checked={!!project.settings.regionSizing}
          onChange={(e) => update((p) => ({ ...p, settings: { ...p.settings, regionSizing: e.target.checked } }))}
        />
        Upper body, lower body and sleeves sized separately
      </label>
      <p className="hint">
        Each size gets Upper body / Lower body / Sleeves pickers (in the toolbar), all following the size itself until you change them.
        The shaping between regions follows from the waypoints and is labelled on the schematic. Turning this off keeps your choices.
      </p>
      <h4>Checks</h4>
      <div className="field">
        <label>Flag a lower body more than … sizes from the upper body</label>
        <input
          className="num"
          type="number"
          min={0}
          step={1}
          value={project.settings.regionGapLimit ?? DEFAULT_REGION_GAP}
          onChange={(e) => update((p) => ({ ...p, settings: { ...p.settings, regionGapLimit: Math.max(0, Math.round(Number(e.target.value))) } }), 'settings.regionGap')}
        />
        <div className="hint">Region sizing only.</div>
      </div>
      <label className="check">
        <input type="checkbox" checked={!!project.settings.hemCheck} onChange={(e) => update((p) => ({ ...p, settings: { ...p.settings, hemCheck: e.target.checked } }))} />
        Flag a hem narrower than the bust plus ease
      </label>
      <p className="hint">Off by default: with the high-hip hem it flags most sizes by 1–2.5 cm, and the hem is easy to change.</p>
      <h4>Ease</h4>
      <div className="field">
        <label>Preset</label>
        <select value={easePresetOf(project.ease) ?? ''} onChange={(e) => e.target.value && update((p) => ({ ...p, ease: withEasePreset(p.ease, e.target.value as EasePresetId) }))}>
          {!easePresetOf(project.ease) && <option value="">Custom</option>}
          {EASE_PRESETS.map((e) => <option key={e.id} value={e.id}>{e.label} ({e.global} cm, bicep {e.bicep}, wrist {e.wrist})</option>)}
        </select>
      </div>
      <div className="field">
        <label>Total circumference ease (cm)</label>
        <input className="num" type="number" step="0.5" value={project.ease.global} onChange={(e) => update((p) => ({ ...p, ease: { ...p.ease, global: Number(e.target.value) } }), 'ease.global')} />
        <div className="hint">Use <code>ease</code> in expressions; a front or back panel usually takes <code>ease / 2</code>.</div>
      </div>
      <h4>Joins</h4>
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
    </div>
  );
}

/** Used by panels to show which joins touch them. */
function joinSummary(project: Project, join: Join, sizeId: Id, cache: PanelCache): string {
  const r = joinReport(project, join, sizeId, cache);
  if (join.tag === 'seam') return r.b ? `Δ ${signed(Math.round(r.diffCm * 10) / 10)} cm` : 'one side';
  if (join.tag === 'pickup') return `${r.a.pickup} sts`;
  return `${join.edges.length} edge${join.edges.length === 1 ? '' : 's'}`;
}
