import { useMemo } from 'react';
import { buildScope } from '../../engine/measurements';
import { CUPS, CUSTOM_BUST, cupLabel, customCupNames, fitAliasList } from '../../engine/fit';
import { removeMeasurement } from '../../engine/grading';
import { DEFAULT_LENGTH_NO_WIDTH, defaultBust, dim, type BustMethod, type BustShaping, type CupChoice, type DimExpr, type Panel } from '../../engine/model';
import { computePanel } from '../../engine/panel';
import { editPanel } from '../edit';
import { fmtNum, len } from '../format';
import { ExprField } from './ExprField';
import { sizeText } from './EstMark';
import { IssueList, type PropsContext } from './Properties';

const METHODS: Record<BustMethod, string> = {
  shortrows: 'Short rows (wedge at the bust point)',
  'horizontal-dart': 'Horizontal dart (short rows from the side)',
  'vertical-dart': 'Vertical darts (increases / decreases)',
  none: 'None',
};

export function BustProps({ ctx }: { ctx: PropsContext }) {
  const { panel, update, computed: c } = ctx;
  const b = panel.bust ?? defaultBust();
  const cb = c.bust;
  const set = (fn: (x: BustShaping) => void, key: string | null = null) =>
    update((p) => editPanel(p, panel.id, (pn) => {
      pn.bust ??= defaultBust();
      fn(pn.bust);
    }), key);
  const setDim = (fn: (x: BustShaping, d: DimExpr) => void, name: string) => (d: DimExpr, k: string) => set((x) => fn(x, d), `bust.${panel.id}.${name}.${k}`);
  const common = { sizeId: ctx.sizeId, sizeName: ctx.sizeName, scope: ctx.scope, units: ctx.units };
  const ms = buildScope(ctx.project, ctx.sizeId);
  const manual = b.manual[ctx.sizeId];
  const usesTurns = b.method === 'shortrows' || b.method === 'horizontal-dart';

  return (
    <div className="props">
      <h3>Bust shaping</h3>
      <div className="field">
        <label>Method</label>
        <select value={b.method} onChange={(e) => set((x) => void (x.method = e.target.value as BustMethod))}>
          {Object.entries(METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {b.method !== 'none' && (
        <>
          <CupPicker ctx={ctx} />
          <div className="estimate">
            <div className="estimate-head">Starting estimate · {ctx.sizeName}</div>
            <p className="small">
              Bust difference <strong>D</strong> = bust ({cupLabel(ctx.project.fit.cup)}) − upper_chest = {fmtNum(ms.bust ?? 0)} − {fmtNum(ms.upper_chest ?? 0)} ={' '}
              <strong>{len((ms.bust ?? 0) - (ms.upper_chest ?? 0), ctx.units)}</strong>
            </p>
            {usesTurns && (
              <label className="check" title="The dart heights in the sizing table assume some width is also added at the front.">
                <input type="checkbox" checked={b.frontWidth !== false} onChange={(e) => set((x) => void (x.frontWidth = e.target.checked))} />
                Extra width added at the front
              </label>
            )}
            {cb?.noFrontWidth ? (
              <p className="small">Extra width W (bust_w) = <strong>0</strong>: no width is added at the front.</p>
            ) : (
              <ExprField
                label="Extra width W (bust_w)"
                value={b.width}
                onChange={setDim((x, d) => void (x.width = d), 'w')}
                fieldKey="w"
                {...common}
                detail={cb && <span className="plugged">= {cb.width.plugged}</span>}
              />
            )}
            {cb?.noFrontWidth ? (
              <ExprField
                label="Extra centre-front length L (bust_l), no front width"
                value={b.lengthNoWidth ?? dim(DEFAULT_LENGTH_NO_WIDTH)}
                onChange={setDim((x, d) => void (x.lengthNoWidth = d), 'lnw')}
                fieldKey="lnw"
                {...common}
                detail={cb && <span className="plugged">= {cb.length.plugged}</span>}
              />
            ) : (
              <ExprField
                label="Extra centre-front length L (bust_l)"
                value={b.length}
                onChange={setDim((x, d) => void (x.length = d), 'l')}
                fieldKey="l"
                {...common}
                detail={cb && <span className="plugged">= {cb.length.plugged}</span>}
              />
            )}
            <p className="hint">
              Defaults: W = D × 1.0. L = <code>dart_height</code>, the sizing table’s suggested dart height for the cup, which assumes some width is
              also added at the front. With no front width the length has to hold all the bust volume, so L = <code>dart_height + D × 0.25</code>.
              Edit the numbers in the formulas, or fix a value for one size.
            </p>
            <OwnCupNames ctx={ctx} />
            {!isDefault(b) && (
              <button className="link" onClick={() => set((x) => resetToTableDefaults(x))} title="W, L, the no-width L, the bust point and its correction">
                Use the sizing-table defaults
              </button>
            )}
          </div>

          {usesTurns && (
            <label className="check">
              <input type="checkbox" checked={b.sideWidth} onChange={(e) => set((x) => void (x.sideWidth = e.target.checked))} />
              Also add W at the side seams (<code>bust_side_w</code>)
            </label>
          )}
          {usesTurns && b.sideWidth && !panel.waypoints.some((w) => (w.symmetric ? w.width.expr : w.left.expr + w.right.expr).includes('bust_side_w')) && (
            <p className="notice-inline">No waypoint uses <code>bust_side_w</code>, so the side width isn't added. Add <code>+ bust_side_w</code> to the underarm width.</p>
          )}

          <h4>Bust point</h4>
          <ExprField label="Height (up from the lower edge)" value={b.apexHeight} onChange={setDim((x, d) => void (x.apexHeight = d), 'h')} fieldKey="h" {...common} detail={cb && <>→ row {cb.apex.row}</>} />
          <ExprField
            label="Vertical correction (bust_apex_corr, taken off hps_to_apex)"
            value={b.apexCorrection ?? dim(0)}
            onChange={setDim((x, d) => void (x.apexCorrection = d), 'corr')}
            fieldKey="corr"
            {...common}
          />
          <p className="hint">
            <code>hps_to_apex</code> is measured over the bust, so it is a little longer than the straight vertical drop; the correction (starting
            estimate 5 %) raises the bust point by that much. Set it to 0 to use the measurement as it is.
          </p>
          <ExprField label="Distance from centre front" value={b.apexOffset} onChange={setDim((x, d) => void (x.apexOffset = d), 'o')} fieldKey="o" {...common} />

          {b.method === 'shortrows' && (
            <>
              <h4>Short rows</h4>
              <div className="button-row">
                <button
                  title="Turns from the bust point out to the side seam, starting at the bust point, German short rows"
                  onClick={() =>
                    set((x) => {
                      x.shortRows.span = 'apex-to-side';
                      x.shortRows.start = 'apex';
                      x.shortRows.order = panel.direction === 'top-down' ? 'lengthening' : 'shortening';
                      x.shortRows.style = 'german';
                      x.shortRows.edgeSts = 0; // the outermost turn at the side seam (flat rows keep 1 st)
                    })
                  }
                >
                  Preset: bust point → side seam ({panel.direction === 'top-down' ? 'top-down' : 'bottom-up'})
                </button>
              </div>
              <ShortRowSettings b={b} set={set} />
              <EdgeSts b={b} set={set} />
              <div className="row2">
                <div className="field">
                  <label>Turns span</label>
                  <select value={b.shortRows.span ?? 'zone'} onChange={(e) => set((x) => void (x.shortRows.span = e.target.value as 'zone' | 'apex-to-side'))}>
                    <option value="zone">Around the bust point</option>
                    <option value="apex-to-side">Bust point → side seam</option>
                  </select>
                </div>
                <div className="field">
                  <label>Start</label>
                  <select value={b.shortRows.start ?? 'centred'} onChange={(e) => set((x) => void (x.shortRows.start = e.target.value as 'centred' | 'apex'))}>
                    <option value="centred">Centred on the bust point</option>
                    <option value="apex">At the bust point</option>
                  </select>
                </div>
              </div>
              {(b.shortRows.span ?? 'zone') === 'zone' ? (
                <ExprField label="Turn zone width (centred on the bust point)" value={b.shortRows.zoneWidth} onChange={setDim((x, d) => void (x.shortRows.zoneWidth = d), 'z')} fieldKey="z" {...common} />
              ) : (
                <p className="small muted">
                  First turn at the bust point, then every {cb?.shortRows?.step ? `${fmtNum(Math.round(cb.shortRows.step * 10) / 10)} sts` : '… sts'} towards the side seam
                  {typeof b.shortRows.edgeSts === 'number'
                    ? `, spread evenly so the outermost turn is ${b.shortRows.edgeSts} st${b.shortRows.edgeSts === 1 ? '' : 's'} from the side edge.`
                    : ' (stitches between the bust point and the side ÷ turns per side, rounded down; the last turn is one step before the edge).'}
                  {b.shortRows.start === 'apex' ? (panel.direction === 'top-down' ? ' They begin on the bust-point row.' : ' They finish at the bust-point row.') : ''}
                </p>
              )}
            </>
          )}
          {b.method === 'horizontal-dart' && (
            <>
              <h4>Dart</h4>
              <div className="field">
                <label>Placement</label>
                <select value={b.dart.placement} onChange={(e) => set((x) => void (x.dart.placement = e.target.value as 'side' | 'underarm'))}>
                  <option value="side">Side dart (at bust point height)</option>
                  <option value="underarm">Underarm dart (just below the armhole)</option>
                </select>
              </div>
              <ShortRowSettings b={b} set={set} />
              <EdgeSts b={b} set={set} />
              <ExprField label="Tip stops short of the bust point by" value={b.dart.tipGap} onChange={setDim((x, d) => void (x.dart.tipGap = d), 't')} fieldKey="t" {...common} />
              <p className="hint">Knitted horizontal darts are worked as short rows: the unworked stitches at each side form the dart.</p>
            </>
          )}
          {b.method === 'vertical-dart' && (
            <>
              <h4>Vertical darts</h4>
              <ExprField label="Start (lower point)" value={b.vertical.bottom} onChange={setDim((x, d) => void (x.vertical.bottom = d), 'b')} fieldKey="b" {...common} />
              <ExprField label="Gap below / above the bust point" value={b.vertical.gap} onChange={setDim((x, d) => void (x.vertical.gap = d), 'g')} fieldKey="g" {...common} />
              <ExprField label="Close by (upper point)" value={b.vertical.top} onChange={setDim((x, d) => void (x.vertical.top = d), 't')} fieldKey="t" {...common} />
            </>
          )}

          {cb?.shortRows && (
            <>
              <h4>Turns in {ctx.sizeName}</h4>
              <p className="small">
                {cb.shortRows.pairs.length} pairs ({cb.shortRows.extraRows} short rows) after row {cb.shortRows.afterRow}, on {cb.shortRows.liveStitches} sts ·{' '}
                {cb.shortRows.style === 'german' ? 'German short rows' : 'wrap and turn'}
                {manual && (
                  <>
                    {' '}· <button className="link" onClick={() => set((x) => void delete x.manual[ctx.sizeId])}>reset to even spacing</button>
                  </>
                )}
              </p>
              <table className="events editable">
                <thead>
                  <tr><th>Pair</th><th>RS: work</th><th>Leave L</th><th>WS: work</th><th>Leave R</th></tr>
                </thead>
                <tbody>
                  {cb.shortRows.pairs.map((pr, i) => (
                    <tr key={i}>
                      <td>SR{2 * pr.index - 1}–{2 * pr.index}</td>
                      <td>{pr.rsWorked}</td>
                      <td>
                        <TurnInput value={pr.leftUnworked} onChange={(v) => setTurn(i, 'left', v)} />
                      </td>
                      <td>{pr.wsWorked}</td>
                      <td>
                        <TurnInput value={pr.rightUnworked} onChange={(v) => setTurn(i, 'right', v)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint">"Leave" = stitches left unworked at that edge when turning. Changing one side alone makes the shaping asymmetric (flagged).</p>
            </>
          )}
          {cb?.darts && (
            <>
              <h4>Dart rows in {ctx.sizeName}</h4>
              <p className="small">
                Each dart adds {cb.darts.perDart} sts at the bust, 2 per shaping row (one each side of the dart line).
                {manual && (
                  <>
                    {' '}<button className="link" onClick={() => set((x) => void delete x.manual[ctx.sizeId])}>reset</button>
                  </>
                )}
              </p>
              <RowsInput label={c.topDown ? 'Lower dart rows (decreases going down)' : 'Increase rows (below the bust)'} rows={cb.darts.incRows} onChange={(rows) => set((x) => void (x.manual[ctx.sizeId] = { ...x.manual[ctx.sizeId], incRows: rows, decRows: x.manual[ctx.sizeId]?.decRows ?? cb.darts!.decRows }))} />
              <RowsInput label={c.topDown ? 'Upper dart rows (increases going down)' : 'Decrease rows (above the bust)'} rows={cb.darts.decRows} onChange={(rows) => set((x) => void (x.manual[ctx.sizeId] = { ...x.manual[ctx.sizeId], decRows: rows, incRows: x.manual[ctx.sizeId]?.incRows ?? cb.darts!.incRows }))} />
            </>
          )}

          <IssueList issues={c.issues.filter((i) => i.ref.kind === 'bust')} ctx={ctx} />

          <h4>All sizes</h4>
          <SizeTable ctx={ctx} />
        </>
      )}
      <div className="actions">
        <button className="danger" onClick={() => { update((p) => editPanel(p, panel.id, (pn) => void (pn.bust = null))); ctx.select({ kind: 'panel' }); }}>
          Remove bust shaping
        </button>
      </div>
    </div>
  );

  function setTurn(i: number, side: 'left' | 'right', v: number) {
    const pairs = cb!.shortRows!.pairs;
    set((x) => {
      const m = (x.manual[ctx.sizeId] ??= {});
      const left = m.left ?? pairs.map((p) => p.leftUnworked);
      const right = m.right ?? pairs.map((p) => p.rightUnworked);
      (side === 'left' ? left : right)[i] = v;
      m.left = left;
      m.right = right;
    });
  }
}

/** Stitches between the side edge and the outermost turn (blank = automatic). */
function EdgeSts({ b, set }: { b: BustShaping; set: (fn: (x: BustShaping) => void, key?: string | null) => void }) {
  const v = b.shortRows.edgeSts;
  return (
    <div className="field">
      <label>Outermost turn: sts from the side edge</label>
      <input
        className="num"
        type="number"
        min={0}
        placeholder="auto"
        value={typeof v === 'number' ? v : ''}
        onChange={(e) => set((x) => void (x.shortRows.edgeSts = e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value)))), 'bust.edgeSts')}
      />
      <div className="hint">
        0 = turn right at the side seam (flat rows keep at least 1 st). Blank = automatic: 2 sts in{(b.shortRows.span ?? 'zone') === 'apex-to-side' && b.method === 'shortrows' ? ', and bust point → side seam stops one step before the edge' : ''}.
      </div>
    </div>
  );
}

function ShortRowSettings({ b, set }: { b: BustShaping; set: (fn: (x: BustShaping) => void, key?: string | null) => void }) {
  return (
    <div className="row3">
      <div className="field">
        <label>Style</label>
        <select value={b.shortRows.style} onChange={(e) => set((x) => void (x.shortRows.style = e.target.value as 'german' | 'wrap-turn'))}>
          <option value="german">German</option>
          <option value="wrap-turn">Wrap & turn</option>
        </select>
      </div>
      <div className="field">
        <label>Pairs</label>
        <input
          className="num"
          type="number"
          min={0}
          placeholder="auto"
          value={b.shortRows.pairs ?? ''}
          onChange={(e) => set((x) => void (x.shortRows.pairs = e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value)))), 'bust.pairs')}
        />
      </div>
      <div className="field">
        <label>Order</label>
        <select value={b.shortRows.order} onChange={(e) => set((x) => void (x.shortRows.order = e.target.value as 'shortening' | 'lengthening'))}>
          <option value="shortening">Each row shorter</option>
          <option value="lengthening">Each row longer</option>
        </select>
      </div>
    </div>
  );
}

function TurnInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      className="num tiny"
      type="number"
      min={0}
      defaultValue={value}
      key={value}
      onBlur={(e) => {
        const v = Math.round(Number(e.target.value));
        if (Number.isFinite(v) && v !== value) onChange(Math.max(0, v));
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function RowsInput({ label, rows, onChange }: { label: string; rows: number[]; onChange: (rows: number[]) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        defaultValue={rows.join(', ')}
        key={rows.join(',')}
        onBlur={(e) => {
          const next = e.target.value.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0).map(Math.round);
          if (next.join(',') !== rows.join(',')) onChange(next);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}

/** One row per size: how the bust shaping grades. */
/** The fields "Use the sizing-table defaults" resets. */
const TABLE_DEFAULT_KEYS = ['width', 'length', 'lengthNoWidth', 'apexCorrection', 'apexHeight', 'apexOffset'] as const;

function isDefault(b: BustShaping): boolean {
  const d = defaultBust();
  return TABLE_DEFAULT_KEYS.every((k) => b[k]?.expr === d[k]!.expr);
}

function resetToTableDefaults(x: BustShaping): void {
  const d = defaultBust();
  for (const k of TABLE_DEFAULT_KEYS) x[k] = { expr: d[k]!.expr, overrides: x[k]?.overrides ?? {} };
}

/** The project's cup choice, edited here too because the bust helper is where it matters. */
function CupPicker({ ctx }: { ctx: PropsContext }) {
  const { project, update } = ctx;
  const cup = project.fit.cup;
  const hasCustom = project.measurements.some((m) => m.name === CUSTOM_BUST);
  const custom = customCupNames(project, buildScope(project, ctx.sizeId));
  return (
    <div className="field">
      <label>Cup (whole project)</label>
      <select value={cup} onChange={(e) => update((p) => ({ ...p, fit: { ...p.fit, cup: e.target.value as CupChoice } }))}>
        {CUPS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        <option value="custom">Custom bust circumference</option>
      </select>
      {cup === 'custom' && !hasCustom && (
        <p className="notice-inline small">
          No <code>{CUSTOM_BUST}</code> yet.{' '}
          <button
            className="link"
            onClick={() =>
              update((p) => ({
                ...p,
                measurements: [...p.measurements, { name: CUSTOM_BUST, label: 'Bust (custom)', kind: 'circumference', rule: { type: 'expression', expr: 'bust_cd_cup' }, table: {}, manual: {}, note: 'Your bust circumference: type it per size in the Measurements grid (starts as the C/D column).' }],
              }))
            }
          >
            Add it (starts as the C/D column; type your values in the grid)
          </button>
        </p>
      )}
      {cup === 'custom' && custom && (
        <div className="hint">
          {ctx.sizeName}: dart height and apex to apex from the nearest cup by D, {cupLabel(custom.cup)}.
        </div>
      )}
    </div>
  );
}

/** Measurements of the project's own that win over the cup columns (e.g. an estimated apex_to_apex from an older project). */
function OwnCupNames({ ctx }: { ctx: PropsContext }) {
  const own = fitAliasList(ctx.project).filter((a) => ['bust', 'dart_height', 'apex_to_apex'].includes(a.name) && ctx.project.measurements.some((m) => m.name === a.name));
  if (!own.length) return null;
  return (
    <p className="notice-inline small">
      {own.map((a) => (
        <span key={a.name}>
          <code>{a.name}</code> is a measurement of this project and wins over <code>{a.expr}</code>.{' '}
          <button className="link" onClick={() => ctx.update((p) => removeMeasurement(p, a.name))}>
            Use {a.expr}
          </button>{' '}
        </span>
      ))}
    </p>
  );
}

function SizeTable({ ctx }: { ctx: PropsContext }) {
  const rows = useMemo(
    () =>
      ctx.project.sizes.map((s) => {
        const c = computePanel(ctx.project, ctx.panel as Panel, s.id);
        const b = c.bust;
        const sr = b?.shortRows;
        const gaps = sr ? sr.pairs.slice(1).map((p, i) => Math.abs(p.leftUnworked - sr.pairs[i].leftUnworked)) : [];
        return {
          id: s.id,
          name: sizeText(s, ctx.project),
          D: b?.D ?? 0,
          W: b?.width.value ?? 0,
          L: b?.length.value ?? 0,
          apex: b ? b.apex.heightCm : null,
          steps: sr ? `${sr.pairs.length} pairs` : b?.darts ? `${b.darts.perDart} sts/dart` : '—',
          gap: gaps.length ? Math.min(...gaps) : null,
          problems: c.issues.filter((i) => i.ref.kind === 'bust' && i.severity !== 'info').length,
        };
      }),
    [ctx.project, ctx.panel],
  );
  return (
    <table className="events size-table">
      <thead>
        <tr><th>Size</th><th>D</th><th>W</th><th>L</th><th title="Bust point height, up from the lower edge (cm)">Bust pt</th><th>Shaping</th><th>Min gap</th><th /></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={r.id === ctx.sizeId ? 'selected' : ''}>
            <td>{r.name}</td>
            <td>{fmtNum(Math.round(r.D * 100) / 100)}</td>
            <td>{fmtNum(Math.round(r.W * 100) / 100)}</td>
            <td>{fmtNum(Math.round(r.L * 100) / 100)}</td>
            <td>{r.apex === null ? '—' : fmtNum(Math.round(r.apex * 10) / 10)}</td>
            <td>{r.steps}</td>
            <td>{r.gap ?? '—'}</td>
            <td>{r.problems ? <span className="err">⚠ {r.problems}</span> : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
