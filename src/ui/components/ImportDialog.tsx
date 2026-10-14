import { useMemo, useState } from 'react';
import type { CsvTable } from '../../engine/csv';
import type { Project } from '../../engine/model';
import { applyImport, describeReport, readSizingTable, suggestMapping, validateMapping, type ColumnTarget, type ImportOptions } from '../../engine/sizing';
import { pickTextFile } from '../fileio';
import sampleCsv from '../../../samples/sizing_table_ysolda_cm.csv?raw';
import { isLegacyColumn } from '../../engine/dictionary';

interface Props {
  project: Project;
  onCancel: () => void;
  onImport: (next: Project, summary: string[]) => void;
}

export function ImportDialog({ project, onCancel, onImport }: Props) {
  const [source, setSource] = useState<{ name: string; table: CsvTable; format: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnTarget[]>([]);
  const [opts, setOpts] = useState<ImportOptions>({ units: 'cm', mode: 'merge' });
  const [paste, setPaste] = useState('');

  const load = (name: string, text: string) => {
    const r = readSizingTable(text, name);
    if (!r.ok) {
      setError(r.error);
      setSource(null);
      return;
    }
    setError(null);
    setSource({ name, table: r.table, format: r.format });
    setMapping(suggestMapping(r.table, project));
  };

  const problems = source ? validateMapping(source.table, mapping) : [];
  const known = useMemo(() => project.measurements.map((m) => m.name), [project]);

  const setTarget = (i: number, value: string) => {
    const next = [...mapping];
    if (value === '__ignore') next[i] = { kind: 'ignore' };
    else if (value === '__size') next[i] = { kind: 'size' };
    else if (value === '__source') next[i] = { kind: 'source' };
    else if (value === '__new') next[i] = { kind: 'measurement', name: source!.table.headers[i].toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'measurement' };
    else next[i] = { kind: 'measurement', name: value };
    setMapping(next);
  };

  const doImport = () => {
    if (!source || problems.length) return;
    const { project: next, report } = applyImport(project, source.table, mapping, opts);
    onImport(next, describeReport(report));
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-label="Import sizing table">
        <div className="modal-head">
          <h3>Import sizing table</h3>
          <button className="icon" onClick={onCancel} aria-label="Close">×</button>
        </div>

        {!source && (
          <div className="modal-body">
            <p>One row per size, one column per measurement, and a column with the size names. CSV or JSON.</p>
            <p className="hint">
              Columns named like the measurement dictionary (e.g. <code>upper_chest</code>, <code>bust_cd_cup</code>) are mapped automatically; a
              <code> source</code> column marks rows that say “estimated”. <code>legacy_…</code> columns are left unmapped. The sample table is
              adapted from Ysolda Teague’s designer size chart (personal use; see About).
            </p>
            <div className="button-row">
              <button
                onClick={async () => {
                  const f = await pickTextFile('.csv,.json,.txt,text/csv,application/json');
                  if (f) load(f.name, f.text);
                }}
              >
                Choose file…
              </button>
              <button onClick={() => load('sizing_table_ysolda_cm.csv', sampleCsv)}>Use the sample table</button>
            </div>
            <div className="field">
              <label>…or paste CSV / JSON</label>
              <textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'size,bust,waist\nS,90,72\nM,100,82'} />
            </div>
            <button disabled={!paste.trim()} onClick={() => load('pasted', paste)}>Read pasted text</button>
            {error && <p className="err">{error}</p>}
          </div>
        )}

        {source && (
          <div className="modal-body">
            <p className="muted small">
              {source.name} · {source.format.toUpperCase()} · {source.table.rows.length} sizes · {source.table.headers.length} columns{' '}
              <button className="link" onClick={() => setSource(null)}>choose another</button>
            </p>
            <div className="import-scroll">
              <table className="import-table">
                <thead>
                  <tr>
                    {source.table.headers.map((h, i) => (
                      <th key={i}>
                        <div className="small">{h}{isLegacyColumn(h) && <span className="tag" title="Legacy column: reference only, not used in calculations">legacy</span>}</div>
                        <select
                          value={mapping[i].kind === 'ignore' ? '__ignore' : mapping[i].kind === 'size' ? '__size' : mapping[i].kind === 'source' ? '__source' : (mapping[i] as { name: string }).name}
                          onChange={(e) => setTarget(i, e.target.value)}
                          className={mapping[i].kind === 'ignore' ? 'muted' : ''}
                        >
                          <option value="__ignore">Ignore</option>
                          <option value="__size">Size name</option>
                          <option value="__source">Row source (table / estimated)</option>
                          {mapping[i].kind === 'measurement' && !known.includes((mapping[i] as { name: string }).name) && (
                            <option value={(mapping[i] as { name: string }).name}>New: {(mapping[i] as { name: string }).name}</option>
                          )}
                          <option value="__new" disabled={mapping[i].kind === 'measurement' && !known.includes((mapping[i] as { name: string }).name)}>
                            New measurement…
                          </option>
                          <optgroup label="Existing measurements">
                            {known.map((n) => <option key={n} value={n}>{n}</option>)}
                          </optgroup>
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {source.table.rows.slice(0, 12).map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, ci) => <td key={ci} className={mapping[ci].kind === 'ignore' ? 'muted' : ''}>{c}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row2">
              <div className="field">
                <label>Values are in</label>
                <select value={opts.units} onChange={(e) => setOpts({ ...opts, units: e.target.value as ImportOptions['units'] })}>
                  <option value="cm">Centimetres</option>
                  <option value="in">Inches</option>
                </select>
              </div>
              <div className="field">
                <label>Sizes</label>
                <select value={opts.mode} onChange={(e) => setOpts({ ...opts, mode: e.target.value as ImportOptions['mode'] })}>
                  <option value="merge">Update matching sizes, add new ones</option>
                  <option value="replace">Replace all sizes with this table</option>
                </select>
              </div>
            </div>
            {opts.mode === 'replace' && (
              <p className="hint">
                Sizes not in the table are removed with their values and overrides. Sizes with the same name keep their overrides. You can undo the import.
              </p>
            )}
            {problems.length > 0 && <ul className="issues">{problems.map((p) => <li key={p} className="issue issue-error">{p}</li>)}</ul>}
            <div className="modal-foot">
              <button onClick={onCancel}>Cancel</button>
              <button className="primary" disabled={problems.length > 0} onClick={doImport}>Import</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
