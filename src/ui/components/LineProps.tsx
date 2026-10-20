import { useEffect, useState } from 'react';
import { evaluateDim } from '../../engine/measurements';
import type { DimExpr, ShapingLine } from '../../engine/model';
import { dim, newId } from '../../engine/model';
import { lineX } from '../../engine/lines';
import { waypointKey } from '../../engine/panel';
import { editPanel } from '../edit';
import { signed } from '../format';
import { ExprField } from './ExprField';
import { IssueList, type PropsContext } from './Properties';

type Set = (fn: (l: ShapingLine) => void, key?: string | null) => void;

export function LineProps({ ctx, id }: { ctx: PropsContext; id: string }) {
  const { panel, update, computed: c } = ctx;
  const l = panel.shapingLines?.find((x) => x.id === id);
  const cl = c.lines.find((x) => x.id === id);
  if (!l) return <p className="muted pad">This line no longer exists.</p>;
  const set: Set = (fn, key = null) =>
    update((p) => editPanel(p, panel.id, (pn) => {
      const x = pn.shapingLines?.find((q) => q.id === id);
      if (x) fn(x);
    }), key);
  const common = { sizeId: ctx.sizeId, sizeName: ctx.sizeName, scope: ctx.scope, units: ctx.units };
  const issues = c.issues.filter((i) => i.ref.kind === 'line' && i.ref.id === id);
  const manual = l.manual[ctx.sizeId];
  const setRows = (rows: number[] | null) =>
    set((x) => {
      if (rows) x.manual[ctx.sizeId] = [...rows].sort((a, b) => a - b);
      else delete x.manual[ctx.sizeId];
    });
  const autoRows = cl?.events.map((e) => e.row) ?? [];
  const rows = manual ?? autoRows;
  const span = cl ? { from: cl.ends[0].row + 1, to: cl.ends[1].row } : null;

  return (
    <div className="props">
      <h3>Shaping line</h3>
      <div className="field">
        <label>Name</label>
        <input value={l.name} onChange={(e) => set((x) => void (x.name = e.target.value), `line.${id}.name`)} />
      </div>
      <div className="row2">
        <div className="field">
          <label>Shape</label>
          <select value={l.kind} onChange={(e) => set((x) => void (x.kind = e.target.value as ShapingLine['kind']))}>
            <option value="one-way">One way (keeps the change)</option>
            <option value="fisheye">Fisheye (to the middle, then back)</option>
          </select>
        </div>
        <div className="field">
          <label>At the line</label>
          <select value={l.sides} onChange={(e) => set((x) => void (x.sides = e.target.value as 'both' | 'one'))}>
            <option value="both">Both sides (2 sts per row)</option>
            <option value="one">One side (1 st per row)</option>
          </select>
        </div>
      </div>
      <StitchField
        label={l.kind === 'fisheye' ? 'Stitches per line, up to the middle (− = decrease)' : 'Stitches per line, going up the garment (− = decrease)'}
        value={l.amount}
        onChange={(d, k) => set((x) => void (x.amount = d), `line.${id}.amount.${k}`)}
        ctx={ctx}
      />
      <div className="row2">
        <div className="field">
          <label>Rows</label>
          <select value={l.rowSide} onChange={(e) => set((x) => void (x.rowSide = e.target.value as 'rs' | 'any'))}>
            <option value="rs">RS rows</option>
            <option value="any">Any row</option>
          </select>
        </div>
        <label className="check" style={{ alignSelf: 'end' }}>
          <input type="checkbox" checked={l.mirror} onChange={(e) => set((x) => void (x.mirror = e.target.checked))} /> Mirror on the other half
        </label>
      </div>

      {(['from', 'to'] as const).map((end) => (
        <div key={end} className="subtle-box">
          <h4>{end === 'from' ? 'Lower end' : 'Upper end'}</h4>
          <ExprField label="Height (up from the lower edge)" value={l[end].height} onChange={(d, k) => set((x) => void (x[end].height = d), `line.${id}.${end}.h.${k}`)} fieldKey={`${end}h`} {...common} />
          <Chips
            items={panel.waypoints.map((w) => ({ label: w.name, expr: `${waypointKey(w.name)}.height` }))}
            onPick={(expr) => set((x) => void (x[end].height = dim(expr)))}
          />
          <ExprField label="Distance from centre (− = left half)" value={l[end].x} onChange={(d, k) => set((x) => void (x[end].x = d), `line.${id}.${end}.x.${k}`)} fieldKey={`${end}x`} {...common} />
          <Chips
            items={[
              { label: 'centre', expr: '0' },
              { label: 'bust point', expr: '-apex_to_apex / 2' },
              { label: '⅓ in from side', expr: `-${waypointKey(panel.waypoints[0]?.name ?? 'hem')}.width / 6` },
              { label: '3 cm from side', expr: `-${waypointKey(panel.waypoints[0]?.name ?? 'hem')}.width / 2 + 3` },
            ]}
            onPick={(expr) => set((x) => void (x[end].x = dim(expr)))}
          />
        </div>
      ))}

      <h4>Rows for {ctx.sizeName}</h4>
      {cl && span ? (
        <>
          <p className="small muted">
            Rows {span.from}–{span.to} · {cl.amount} sts per line{l.mirror ? ' (×2 with its twin)' : ''} · {manual ? 'hand-placed' : 'auto'}
            {manual && (
              <>
                {' · '}
                <button className="link" onClick={() => setRows(null)}>Reset to auto</button>
              </>
            )}
          </p>
          <table className="events editable">
            <thead>
              <tr><th>Row</th><th>Sts</th><th>From centre</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const ev = cl.events.find((e) => e.row === r);
                return (
                  <tr key={`${i}-${r}`}>
                    <td>
                      <RowInput value={r} min={span.from} max={span.to} onChange={(v) => setRows(rows.map((x, j) => (j === i ? v : x)))} />
                    </td>
                    <td>{ev ? signed(ev.delta) : '–'}</td>
                    <td>{Math.round(lineX(cl, r) * 10) / 10} sts</td>
                    <td><button className="icon" title="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button
            onClick={() => {
              const used = new Set(rows);
              const mid = Math.round((span.from + span.to) / 2);
              let r = mid;
              for (let d = 0; d <= span.to - span.from; d++) {
                const cand = [mid + d, mid - d].find((x) => x >= span.from && x <= span.to && !used.has(x));
                if (cand !== undefined) {
                  r = cand;
                  break;
                }
              }
              setRows([...rows, r]);
            }}
          >
            + Add row
          </button>
          <p className="hint">Editing a row switches {ctx.sizeName} to hand-placed rows; each row takes {l.sides === 'both' ? 2 : 1} st{l.sides === 'both' ? 's' : ''} at the line.</p>
        </>
      ) : (
        <p className="muted small">Not computed for this size.</p>
      )}
      <IssueList issues={issues} ctx={ctx} />

      <div className="button-row">
        <button
          onClick={() =>
            update((p) => editPanel(p, panel.id, (pn) => {
              const x = pn.shapingLines?.find((q) => q.id === id);
              if (x) pn.shapingLines!.push({ ...structuredClone(x), id: newId('line'), name: `${x.name} copy` });
            }))
          }
        >
          Duplicate
        </button>
        <button
          className="danger"
          onClick={() => {
            update((p) => editPanel(p, panel.id, (pn) => void (pn.shapingLines = (pn.shapingLines ?? []).filter((q) => q.id !== id))));
            ctx.select({ kind: 'panel' });
          }}
        >
          Delete line
        </button>
      </div>
    </div>
  );
}

function Chips({ items, onPick }: { items: { label: string; expr: string }[]; onPick: (expr: string) => void }) {
  return (
    <div className="chips">
      {items.map((it) => (
        <button key={it.label} className="chip" title={it.expr} onClick={() => onPick(it.expr)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

function RowInput({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <input
      className="num tiny"
      type="number"
      min={min}
      max={max}
      defaultValue={value}
      key={value}
      onBlur={(e) => {
        const r = Math.round(Number(e.target.value));
        if (Number.isFinite(r) && r !== value) onChange(Math.max(min, Math.min(max, r)));
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** An expression that evaluates to a number of stitches (not a length), with a per-size fixed value. */
function StitchField({ label, value, onChange, ctx }: { label: string; value: DimExpr; onChange: (d: DimExpr, key: string) => void; ctx: PropsContext }) {
  const r = evaluateDim({ expr: value.expr, overrides: {} }, ctx.sizeId, ctx.scope);
  const fixed = ctx.sizeId in value.overrides;
  const [ov, setOv] = useState('');
  useEffect(() => setOv(fixed ? String(value.overrides[ctx.sizeId]) : ''), [fixed, value.overrides, ctx.sizeId]);
  return (
    <div className={`field expr-field${fixed ? ' is-overridden' : ''}`}>
      <label>{label}</label>
      <input className="expr" value={value.expr} spellCheck={false} onChange={(e) => onChange({ ...value, expr: e.target.value }, 'expr')} title="Stitches; e.g. -8, or round(-3 / st_w) for 3 cm" />
      <div className="expr-result">
        {r.ok ? <span className={fixed ? 'struck' : ''}>= {signed(Math.round(r.value.value))} sts</span> : <span className="err">{r.error}</span>}
      </div>
      <div className="override">
        <span className="muted">Fixed for {ctx.sizeName}:</span>
        <input
          className="num tiny"
          value={ov}
          placeholder="—"
          onChange={(e) => {
            setOv(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange({ ...value, overrides: { ...value.overrides, [ctx.sizeId]: Math.round(n) } }, 'ov');
          }}
        />
        {fixed && (
          <button
            className="link"
            onClick={() => {
              const { [ctx.sizeId]: _, ...rest } = value.overrides;
              onChange({ ...value, overrides: rest }, 'ov.clear');
            }}
          >
            clear
          </button>
        )}
      </div>
    </div>
  );
}
