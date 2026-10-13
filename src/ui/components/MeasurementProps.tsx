import { useEffect, useState } from 'react';
import { EstMark } from './EstMark';
import { CATEGORY_LABELS, dictionaryEntry } from '../../engine/dictionary';
import { evaluate } from '../../engine/expr';
import {
  addSize,
  convertToIncrementRule,
  measurementUsage,
  moveSize,
  removeMeasurement,
  removeSize,
  renameMeasurement,
  renameSize,
  setBaseSize,
  trendFlags,
  uniformSteps,
  updateMeasurement,
  validateNewName,
} from '../../engine/grading';
import { buildScope, easeScope, resolveMeasurements } from '../../engine/measurements';
import type { GradingRule, Id, Measurement, Project } from '../../engine/model';
import { fromDisplay, roundTo, toDisplay, unitLabel, type Units } from '../../engine/units';
import { len } from '../format';

interface Ctx {
  project: Project;
  update: (fn: (p: Project) => Project, key?: string | null) => void;
  sizeId: Id;
  onSelect: (name: string | null) => void;
}

/** Number input in display units that stores cm. Local text so partial typing works. */
function LengthInput({ cm, units, onChange, placeholder, allowEmpty }: { cm: number | null; units: Units; onChange: (cm: number | null) => void; placeholder?: string; allowEmpty?: boolean }) {
  const shown = cm === null ? '' : String(roundTo(toDisplay(cm, units), 2));
  const [text, setText] = useState(shown);
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(shown);
  }, [shown, focus]);
  return (
    <input
      className="num"
      value={focus ? text : shown}
      placeholder={placeholder}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onChange={(e) => {
        setText(e.target.value);
        const t = e.target.value.trim().replace(',', '.');
        if (t === '') return allowEmpty ? onChange(null) : undefined;
        const n = Number(t);
        if (Number.isFinite(n)) onChange(fromDisplay(n, units));
      }}
    />
  );
}

export function MeasurementProps({ ctx, name }: { ctx: Ctx; name: string }) {
  const { project, update } = ctx;
  const m = project.measurements.find((x) => x.name === name);
  const [nameText, setNameText] = useState(name);
  useEffect(() => setNameText(name), [name]);
  if (!m) return <SizesProps ctx={ctx} />;

  const units = project.units;
  const dict = dictionaryEntry(m.name);
  const set = (fn: (mm: Measurement) => void, key: string | null = null) => update((p) => updateMeasurement(p, name, fn), key);
  const nameError = nameText !== name ? validateNewName(project, nameText, name) : null;
  const commitName = () => {
    if (nameText === name || nameError) return setNameText(name);
    update((p) => renameMeasurement(p, name, nameText));
    ctx.onSelect(nameText);
  };
  const usage = measurementUsage(project, name);
  const flags = trendFlags(project, name);
  const sizeName = (id: Id) => project.sizes.find((s) => s.id === id)?.name ?? '?';
  const baseName = sizeName(project.baseSizeId);
  const current = resolveMeasurements(project, ctx.sizeId);
  const cur = current.values[name];
  const manualCount = Object.keys(m.manual).length;
  const tableCount = Object.keys(m.table).length;

  const setRuleType = (type: GradingRule['type']) =>
    set((mm) => {
      if (type === 'none') mm.rule = { type: 'none' };
      else if (type === 'expression') mm.rule = { type: 'expression', expr: mm.rule.type === 'expression' ? mm.rule.expr : String(cur ? roundTo(cur.value, 2) : 0) };
      else {
        const base = resolveMeasurements(project, project.baseSizeId).values[name]?.value ?? 0;
        mm.rule = { type: 'increment', baseValue: base, defaultStep: 0, steps: {} };
      }
    });

  return (
    <div className="props">
      <h3>Measurement</h3>
      {dict && (
        <p className="small muted dict-def" title={dict.tooltip}>
          <strong>{CATEGORY_LABELS[dict.category]}</strong> · {dict.tooltip}
          {dict.legacy && <span className="tag">reference only</span>}
        </p>
      )}
      <div className="field">
        <label>Name (used in expressions)</label>
        <input value={nameText} onChange={(e) => setNameText(e.target.value.trim())} onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        {nameError ? <div className="err small">{nameError}</div> : nameText !== name && <div className="hint">Renaming updates every expression that uses it.</div>}
      </div>
      <div className="row2">
        <div className="field">
          <label>Label</label>
          <input value={m.label} onChange={(e) => set((mm) => void (mm.label = e.target.value), `m.${name}.label`)} />
        </div>
        <div className="field">
          <label>Kind</label>
          <select value={m.kind} onChange={(e) => set((mm) => void (mm.kind = e.target.value as Measurement['kind']))}>
            <option value="circumference">Circumference</option>
            <option value="length">Length / width</option>
          </select>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={!!m.estimate} onChange={(e) => set((mm) => void (mm.estimate = e.target.checked))} />
        Estimate (needs checking)
      </label>
      {m.note !== undefined && (
        <div className="field">
          <label>Note</label>
          <textarea rows={2} value={m.note} onChange={(e) => set((mm) => void (mm.note = e.target.value), `m.${name}.note`)} />
        </div>
      )}

      <h4>Value in {sizeName(ctx.sizeId)}</h4>
      <p className="small">
        {cur ? (
          <>
            {len(cur.value, units)} <span className={`dot src-${cur.source}`} /> <span className="muted">from {cur.source}</span>
          </>
        ) : (
          <span className="err">{current.errors[name]}</span>
        )}
        {cur?.source === 'manual' && (
          <>
            {' '}
            <button className="link" onClick={() => set((mm) => void delete mm.manual[ctx.sizeId])}>reset</button>
          </>
        )}
      </p>

      <h4>Grading rule</h4>
      <p className="hint">Used for sizes with no table value and no manual value.</p>
      <div className="field">
        <select value={m.rule.type} onChange={(e) => setRuleType(e.target.value as GradingRule['type'])}>
          <option value="none">None</option>
          <option value="increment">Base size + steps</option>
          <option value="expression">Expression</option>
        </select>
      </div>
      {m.rule.type === 'expression' && <RuleExpression ctx={ctx} m={m} />}
      {m.rule.type === 'increment' && <RuleSteps ctx={ctx} m={m} baseName={baseName} />}
      <div className="button-row">
        {tableCount > 0 && (
          <button onClick={() => update((p) => convertToIncrementRule(p, name))} title="Make a base-size + steps rule that reproduces the current values, and clear the table values">
            Convert values to steps
          </button>
        )}
        {tableCount > 0 && (
          <button onClick={() => set((mm) => void (mm.table = {}))} title="Remove imported values so the rule applies">
            Clear table values ({tableCount})
          </button>
        )}
        {manualCount > 0 && <button onClick={() => set((mm) => void (mm.manual = {}))}>Clear manual values ({manualCount})</button>}
      </div>

      <h4>Ease for this measurement</h4>
      <div className="override">
        <code>ease.{name}</code>
        <LengthInput
          cm={name in project.ease.per ? project.ease.per[name] : null}
          units={units}
          allowEmpty
          placeholder={String(roundTo(toDisplay(project.ease.global, units), 2))}
          onChange={(cm) =>
            update(
              (p) => {
                const per = { ...p.ease.per };
                if (cm === null) delete per[name];
                else per[name] = cm;
                return { ...p, ease: { ...p.ease, per } };
              },
              `ease.${name}`,
            )
          }
        />
        <span className="muted">{unitLabel(units)} (empty = global)</span>
      </div>

      {flags.length > 0 && (
        <ul className="issues">
          {flags.map((f) => (
            <li key={f.sizeId} className="issue issue-info">{sizeName(f.sizeId)}: {f.message}</li>
          ))}
        </ul>
      )}

      <h4>Used in</h4>
      {usage.length ? (
        <ul className="usage">{usage.map((u) => <li key={u}>{u}</li>)}</ul>
      ) : (
        <p className="muted small">Not used yet.</p>
      )}
      <div className="actions">
        <button
          className="danger"
          onClick={() => {
            if (usage.length && !window.confirm(`"${name}" is used in ${usage.length} place(s). Delete it anyway? Those expressions will show errors. You can undo.`)) return;
            update((p) => removeMeasurement(p, name));
            ctx.onSelect(null);
          }}
        >
          Delete measurement
        </button>
      </div>
    </div>
  );
}

function RuleExpression({ ctx, m }: { ctx: Ctx; m: Measurement }) {
  if (m.rule.type !== 'expression') return null;
  const scope = { ...buildScope(ctx.project, ctx.sizeId), ...easeScope(ctx.project) };
  delete scope[m.name];
  const r = evaluate(m.rule.expr, scope);
  return (
    <div className="field">
      <input
        className="expr"
        value={m.rule.expr}
        spellCheck={false}
        onChange={(e) => ctx.update((p) => updateMeasurement(p, m.name, (mm) => void (mm.rule = { type: 'expression', expr: e.target.value })), `m.${m.name}.expr`)}
      />
      <div className="expr-result">{r.ok ? `= ${len(r.value, ctx.project.units)}` : <span className="err">{r.error}</span>}</div>
    </div>
  );
}

function RuleSteps({ ctx, m, baseName }: { ctx: Ctx; m: Measurement; baseName: string }) {
  const { project, update } = ctx;
  if (m.rule.type !== 'increment') return null;
  const rule = m.rule;
  const units = project.units;
  const setRule = (r: Partial<typeof rule>, key: string) => update((p) => updateMeasurement(p, m.name, (mm) => void (mm.rule = { ...rule, ...r })), key);
  const values = project.sizes.map((s) => resolveMeasurements({ ...project, measurements: project.measurements.map((x) => (x.name === m.name ? { ...x, table: {}, manual: {} } : x)) }, s.id).values[m.name]?.value);
  return (
    <>
      <div className="row2">
        <div className="field">
          <label>Value at {baseName} (base)</label>
          <LengthInput cm={rule.baseValue} units={units} onChange={(cm) => cm !== null && setRule({ baseValue: cm }, `m.${m.name}.base`)} />
        </div>
        <div className="field">
          <label>Step per size</label>
          <LengthInput cm={rule.defaultStep} units={units} onChange={(cm) => cm !== null && setRule({ defaultStep: cm }, `m.${m.name}.step`)} />
        </div>
      </div>
      <table className="events steps-table">
        <thead>
          <tr><th>Size</th><th>Step from previous</th><th>Rule value</th></tr>
        </thead>
        <tbody>
          {project.sizes.map((s, i) => (
            <tr key={s.id}>
              <td>{s.name}<EstMark size={s} />{s.id === project.baseSizeId ? ' ●' : ''}</td>
              <td>
                {i === 0 ? (
                  <span className="muted">—</span>
                ) : (
                  <>
                    <LengthInput
                      cm={s.id in rule.steps ? rule.steps[s.id] : null}
                      units={units}
                      allowEmpty
                      placeholder={String(roundTo(toDisplay(rule.defaultStep, units), 2))}
                      onChange={(cm) => {
                        const steps = { ...rule.steps };
                        if (cm === null) delete steps[s.id];
                        else steps[s.id] = cm;
                        setRule({ steps }, `m.${m.name}.step.${s.id}`);
                      }}
                    />
                  </>
                )}
              </td>
              <td>{values[i] !== undefined ? len(values[i]!, units) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {Object.keys(rule.steps).length > 0 && (
        <button className="link" onClick={() => update((p) => uniformSteps(p, m.name, rule.defaultStep))}>Use the same step for every size</button>
      )}
    </>
  );
}

// ---------- sizes ----------

export function SizesProps({ ctx }: { ctx: Ctx }) {
  const { project, update } = ctx;
  const [newSize, setNewSize] = useState('');
  const dupe = project.sizes.some((s) => s.name.toLowerCase() === newSize.trim().toLowerCase());
  return (
    <div className="props">
      <h3>Sizes</h3>
      <p className="hint">The base size anchors step-based grading rules. Select a measurement row to edit it.</p>
      <ul className="size-list">
        {project.sizes.map((s, i) => (
          <li key={s.id}>
            <input
              type="radio"
              name="base"
              checked={s.id === project.baseSizeId}
              onChange={() => update((p) => setBaseSize(p, s.id))}
              title="Base size"
            />
            <input className="size-name" value={s.name} onChange={(e) => update((p) => renameSize(p, s.id, e.target.value), `size.${s.id}.name`)} />
            <EstMark size={s} />
            <button className="icon" disabled={i === 0} onClick={() => update((p) => moveSize(p, s.id, -1))} title="Move up">↑</button>
            <button className="icon" disabled={i === project.sizes.length - 1} onClick={() => update((p) => moveSize(p, s.id, 1))} title="Move down">↓</button>
            <button
              className="icon"
              disabled={project.sizes.length <= 1}
              title="Delete size"
              onClick={() => window.confirm(`Delete size ${s.name} and all its values and overrides? You can undo.`) && update((p) => removeSize(p, s.id))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="inline">
        <input placeholder="New size name" value={newSize} onChange={(e) => setNewSize(e.target.value)} />
        <button
          disabled={!newSize.trim() || dupe}
          onClick={() => {
            update((p) => addSize(p, newSize).project);
            setNewSize('');
          }}
        >
          Add
        </button>
      </div>
      {dupe && <p className="err small">That size already exists.</p>}
      <p className="hint">New sizes get values from grading rules until you import or type them.</p>
    </div>
  );
}
