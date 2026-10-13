import { useEffect, useMemo, useState } from 'react';
import { EstMark } from './EstMark';
import { measurementTooltip } from '../../engine/dictionary';
import { trendFlags, validateNewName, addMeasurement } from '../../engine/grading';
import { resolveMeasurements, type ResolvedMeasurements } from '../../engine/measurements';
import type { Id, Measurement, Project } from '../../engine/model';
import { fromDisplay, roundTo, toDisplay, unitLabel, type Units } from '../../engine/units';
import { produce } from '../edit';
import { fmtNum } from '../format';

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project, key?: string | null) => void;
  selected: string | null; // measurement name
  onSelect: (name: string | null) => void;
  currentSizeId: Id;
  onSize: (id: Id) => void;
  onImport: () => void;
}

/** The sizes × measurements grid. Typing in a cell sets a manual value for that size. */
export function MeasurementsView({ project, update, selected, onSelect, currentSizeId, onSize, onImport }: Props) {
  const units = project.units;
  const resolved = useMemo(() => {
    const out: Record<Id, ResolvedMeasurements> = {};
    for (const s of project.sizes) out[s.id] = resolveMeasurements(project, s.id);
    return out;
  }, [project]);
  const flags = useMemo(() => {
    const out: Record<string, Record<Id, string>> = {};
    for (const m of project.measurements) {
      const f = trendFlags(project, m.name);
      if (f.length) out[m.name] = Object.fromEntries(f.map((x) => [x.sizeId, x.message]));
    }
    return out;
  }, [project]);

  const [newName, setNewName] = useState('');
  const newError = newName ? validateNewName(project, newName) : null;
  const add = () => {
    if (!newName || newError) return;
    update((p) => addMeasurement(p, newName, newName.replace(/_/g, ' ')));
    onSelect(newName);
    setNewName('');
  };

  const setCell = (m: Measurement, sizeId: Id, cm: number | null) =>
    update(
      (p) =>
        produce(p, (d) => {
          const mm = d.measurements.find((x) => x.name === m.name)!;
          if (cm === null) delete mm.manual[sizeId];
          else mm.manual[sizeId] = cm;
        }),
      `cell.${m.name}.${sizeId}`,
    );

  return (
    <div className="grid-view">
      <div className="grid-toolbar">
        <button onClick={onImport}>Import sizing table…</button>
        <span className="muted small">
          Values in {unitLabel(units)}. Type in a cell to override one size; clear it to go back.
        </span>
        <span className="spacer" />
        <span className="legend">
          <span><i className="dot src-table" /> table</span>
          <span><i className="dot src-rule" /> rule</span>
          <span><i className="dot src-manual" /> manual</span>
          <span><i className="flag-mark">▴</i> zigzag</span>
        </span>
      </div>
      <div className="grid-scroll">
        <table className="mgrid">
          <thead>
            <tr>
              <th className="sticky">Measurement</th>
              <th>Rule</th>
              {project.sizes.map((s) => (
                <th key={s.id} className={`sz${s.id === currentSizeId ? ' current' : ''}`} onClick={() => onSize(s.id)} title="Show this size">
                  {s.name}
                  <EstMark size={s} />
                  {s.id === project.baseSizeId && <span className="base-mark" title="Base size">●</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {project.measurements.map((m) => (
              <tr key={m.name} className={selected === m.name ? 'selected' : ''} onClick={() => onSelect(m.name)}>
                <td className="sticky">
                  <code title={measurementTooltip(m)}>{m.name}</code>
                  {m.estimate && <span className="tag">est.</span>}
                  <div className="muted small" title={measurementTooltip(m)}>{m.label}</div>
                </td>
                <td className="rule small muted">{ruleText(m, units)}</td>
                {project.sizes.map((s) => {
                  const v = resolved[s.id].values[m.name];
                  const err = resolved[s.id].errors[m.name];
                  const flag = flags[m.name]?.[s.id];
                  return (
                    <td key={s.id} className={`cell${v ? ` src-${v.source}` : ''}${s.id === currentSizeId ? ' current' : ''}`} title={err ?? flag ?? (v ? `From ${v.source}` : '')}>
                      <Cell
                        value={v ? v.value : null}
                        manual={v?.source === 'manual'}
                        units={units}
                        onCommit={(cm) => setCell(m, s.id, cm)}
                        error={!!err}
                      />
                      {flag && <span className="flag-mark">▴</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-add">
        <input placeholder="new_measurement_name" value={newName} onChange={(e) => setNewName(e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button onClick={add} disabled={!newName || !!newError}>+ Add measurement</button>
        {newError && <span className="err small">{newError}</span>}
      </div>
    </div>
  );
}

function ruleText(m: Measurement, units: Units): string {
  switch (m.rule.type) {
    case 'expression':
      return `= ${m.rule.expr}`;
    case 'increment': {
      const step = roundTo(toDisplay(m.rule.defaultStep, units), 2);
      const extra = Object.keys(m.rule.steps).length;
      return `${step >= 0 ? '+' : ''}${fmtNum(step)} per size${extra ? ` (${extra} custom)` : ''}`;
    }
    default:
      return Object.keys(m.table).length ? 'table' : '—';
  }
}

/** A number cell with local text state, so partial input like "12." is not clobbered. */
function Cell({ value, manual, units, onCommit, error }: { value: number | null; manual: boolean; units: Units; onCommit: (cm: number | null) => void; error: boolean }) {
  const shown = value === null ? '' : String(roundTo(toDisplay(value, units), 2));
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);
  return (
    <input
      className={`cell-input${manual ? ' manual' : ''}${error ? ' error' : ''}`}
      value={editing ? text : error ? '—' : shown}
      onFocus={() => {
        setEditing(true);
        setText(shown);
      }}
      onBlur={() => {
        setEditing(false);
        if (text.trim() === '' && manual) onCommit(null);
      }}
      onChange={(e) => {
        setText(e.target.value);
        const t = e.target.value.trim().replace(',', '.');
        if (t === '') return;
        const n = Number(t);
        if (Number.isFinite(n)) onCommit(fromDisplay(n, units));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
