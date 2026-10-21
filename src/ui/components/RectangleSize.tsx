// Size of a plain rectangle panel: bottom width, top width and height, each fixed for every size, graded from a
// measurement, the same as the bottom (top width) or a custom expression. Loaded on first use.

import { useEffect, useMemo, useState } from 'react';
import { evaluate } from '../../engine/expr';
import type { DimExpr, Project } from '../../engine/model';
import { computePanel, waypointKey } from '../../engine/panel';
import { clearRectOverrides, convertRule, heightBase, readRule, rectWaypoints, ruleExpr, setRectDim, setRectExpr, type RectDim, type SizeRule } from '../../engine/rectSize';
import { fromDisplay, roundTo, toDisplay, unitLabel } from '../../engine/units';
import { len, rows, sts } from '../format';
import { ExprField } from './ExprField';
import type { PropsContext } from './Properties';

const MODES: { id: SizeRule['mode']; label: string }[] = [
  { id: 'fixed', label: 'Same for all sizes' },
  { id: 'measure', label: 'From a measurement' },
  { id: 'same', label: 'Same as the bottom' },
  { id: 'custom', label: 'Expression' },
];

/** A number input that keeps what is typed until it parses; `parse` may accept expressions such as 1/3. */
function NumInput({ value, onCommit, parse = (t) => Number(t.replace(',', '.')), title }: { value: number; onCommit: (n: number) => void; parse?: (t: string) => number; title?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((t) => (Math.abs(parse(t) - value) < 1e-3 ? t : String(value))); // keeps e.g. 1/3 as typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className="num"
      value={text}
      title={title}
      onChange={(e) => {
        setText(e.target.value);
        const n = parse(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onCommit(n);
      }}
    />
  );
}

const parseFraction = (t: string) => {
  const r = evaluate(t.replace(',', '.'), {});
  return r.ok && r.value > 0 ? r.value : NaN;
};

interface FieldProps {
  ctx: PropsContext;
  which: RectDim;
  label: string;
  value: DimExpr;
  bottomKey: string;
  currentCm: number;
  perSize: { name: string; text: string; current: boolean }[];
}

function RuleField({ ctx, which, label, value, bottomKey, currentCm, perSize }: FieldProps) {
  const { project, panel, units } = ctx;
  const names = project.measurements.map((m) => m.name);
  const rule = readRule(value.expr, names, which === 'top' ? bottomKey : undefined, which === 'height' ? heightBase(panel) : undefined);
  // Once "Expression" is chosen it stays, even while the text being typed looks like a simpler rule.
  const [asExpr, setAsExpr] = useState(false);
  const mode = asExpr ? 'custom' : rule.mode;
  const key = `rect.${panel.id}.${which}`;
  const apply = (r: SizeRule, k: string | null = key) => ctx.update((p: Project) => setRectDim(p, panel.id, which, r, units), k);
  const d = (cm: number) => roundTo(toDisplay(cm, units), 2);

  const switchTo = (to: SizeRule['mode']) => {
    setAsExpr(to === 'custom');
    // Lengths default to the whole measurement, widths to half a circumference.
    const kind = which === 'height' ? 'length' : 'circumference';
    const pick = project.measurements.find((m) => m.name === (which === 'height' ? 'arm_length' : 'bust')) ?? project.measurements.find((m) => m.kind === kind) ?? project.measurements[0];
    const m = pick?.name ?? '';
    const fraction = pick?.kind === 'circumference' ? 0.5 : 1;
    if (to === 'measure' && !m) return;
    apply(convertRule(to, rule, currentCm, units, m, fraction, bottomKey), null);
  };

  const overridden = project.sizes.filter((s) => s.id in value.overrides);

  return (
    <div className="field rect-dim">
      <label>{label}</label>
      <select value={mode} onChange={(e) => switchTo(e.target.value as SizeRule['mode'])}>
        {MODES.filter((m) => m.id !== 'same' || which === 'top').map((m) => (
          <option key={m.id} value={m.id} disabled={m.id === 'measure' && !names.length}>{m.label}</option>
        ))}
      </select>
      {mode === 'fixed' && rule.mode === 'fixed' && (
        <div className="inline-inputs">
          <NumInput value={d(rule.value)} onCommit={(n) => apply({ mode: 'fixed', value: fromDisplay(n, units) })} />
          <span className="muted">{unitLabel(units)}</span>
        </div>
      )}
      {mode === 'measure' && rule.mode === 'measure' && (
        <div className="inline-inputs">
          <select value={rule.measurement} onChange={(e) => apply({ ...rule, measurement: e.target.value }, null)} title="Measurement">
            {project.measurements.map((m) => <option key={m.name} value={m.name}>{m.label || m.name}</option>)}
          </select>
          <span className="muted">×</span>
          <NumInput value={roundTo(rule.fraction, 4)} parse={parseFraction} onCommit={(n) => apply({ ...rule, fraction: n })} title="Fraction of the measurement, e.g. 0.5 or 1/3" />
          <span className="muted">+</span>
          <NumInput value={d(rule.ease)} onCommit={(n) => apply({ ...rule, ease: fromDisplay(n, units) })} title="Ease (negative for less)" />
          <span className="muted">{unitLabel(units)}</span>
        </div>
      )}
      {mode === 'same' && <div className="hint">Follows the bottom width in every size: no shaping.</div>}
      {mode === 'custom' && (
        <ExprField
          label="Expression"
          value={value}
          onChange={(next, k) => ctx.update((p) => setRectExpr(p, panel.id, which, next), `${key}.${k}`)}
          fieldKey="expr"
          sizeId={ctx.sizeId}
          sizeName={ctx.sizeName}
          scope={ctx.scope}
          units={units}
        />
      )}
      {mode === 'measure' && <div className="hint"><code>{ruleExpr(rule, units, bottomKey)}</code></div>}
      {mode !== 'custom' && overridden.length > 0 && (
        <div className="hint warn">
          {overridden.map((s) => s.name).join(', ')} {overridden.length === 1 ? 'has its' : 'have their'} own fixed value, which wins over this.{' '}
          <button className="link" onClick={() => ctx.update((p) => clearRectOverrides(p, panel.id, which))}>clear</button>
        </div>
      )}
      <div className="size-values">
        {perSize.map((s, i) => (
          <span key={i} className={s.current ? 'current' : ''}>
            <b>{s.name}</b> {s.text}
          </span>
        ))}
      </div>
    </div>
  );

}

export function RectangleSize({ ctx }: { ctx: PropsContext }) {
  const { project, panel, units } = ctx;
  const { bottom, top } = rectWaypoints(panel);
  const bottomKey = waypointKey(bottom.name);
  // Every size's result, so the grading can be checked at a glance.
  const all = useMemo(() => project.sizes.map((s) => ({ size: s, c: computePanel(project, panel, s.id) })), [project, panel]);
  const values = (pick: (c: (typeof all)[number]['c']) => string) =>
    all.map(({ size, c }) => ({ name: size.name, current: size.id === ctx.sizeId, text: c.ok ? pick(c) : '—' }));
  const wpOf = (c: (typeof all)[number]['c'], id: string) => c.waypoints.find((w) => w.id === id);
  const width = (id: string) => values((c) => {
    const w = wpOf(c, id);
    return w ? `${len(w.widthCm, units)} · ${sts(w.stitches)}` : '—';
  });
  const height = values((c) => {
    const w = wpOf(c, top.id);
    return w ? `${len(w.heightCm, units)} · ${rows(w.row)}` : '—';
  });
  const cur = ctx.computed.ok ? ctx.computed : null;
  const cw = (id: string) => cur?.waypoints.find((w) => w.id === id);

  return (
    <div className="rect-size">
      <h4>Size</h4>
      <p className="hint">Each fixed for every size, graded from a measurement (× fraction + ease), or any expression.</p>
      <RuleField ctx={ctx} which="bottom" label="Bottom width" value={bottom.width} bottomKey={bottomKey} currentCm={cw(bottom.id)?.widthCm ?? 0} perSize={width(bottom.id)} />
      <RuleField ctx={ctx} which="top" label="Top width" value={top.width} bottomKey={bottomKey} currentCm={cw(top.id)?.widthCm ?? 0} perSize={width(top.id)} />
      <RuleField ctx={ctx} which="height" label="Height" value={top.height} bottomKey={bottomKey} currentCm={cw(top.id)?.heightCm ?? 0} perSize={height} />
    </div>
  );
}
