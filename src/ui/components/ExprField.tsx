import { useEffect, useState } from 'react';
import { evaluateDim } from '../../engine/measurements';
import type { DimExpr, Id } from '../../engine/model';
import { fromDisplay, roundTo, toDisplay, unitLabel, type Units } from '../../engine/units';
import { len } from '../format';

interface Props {
  label: string;
  value: DimExpr;
  sizeId: Id;
  sizeName: string;
  scope: Record<string, number>;
  units: Units;
  onChange: (next: DimExpr, key: string) => void;
  fieldKey: string; // undo-coalescing key
  detail?: React.ReactNode; // e.g. "→ 134 sts"
}

/** An expression input with its evaluated value and an optional fixed value for the current size. */
export function ExprField({ label, value, sizeId, sizeName, scope, units, onChange, fieldKey, detail }: Props) {
  const result = evaluateDim({ expr: value.expr, overrides: {} }, sizeId, scope);
  const overridden = sizeId in value.overrides;
  const [ov, setOv] = useState('');
  useEffect(() => {
    setOv(overridden ? String(roundTo(toDisplay(value.overrides[sizeId], units), 2)) : '');
  }, [overridden, value.overrides, sizeId, units]);

  const setOverride = (text: string) => {
    setOv(text);
    const n = Number(text.replace(',', '.'));
    if (text.trim() === '' || !Number.isFinite(n)) return;
    onChange({ ...value, overrides: { ...value.overrides, [sizeId]: fromDisplay(n, units) } }, `${fieldKey}.ov`);
  };
  const clearOverride = () => {
    const { [sizeId]: _, ...rest } = value.overrides;
    onChange({ ...value, overrides: rest }, `${fieldKey}.ov.clear`);
  };

  return (
    <div className={`field expr-field${overridden ? ' is-overridden' : ''}`}>
      <label>{label}</label>
      <input
        className="expr"
        value={value.expr}
        spellCheck={false}
        onChange={(e) => onChange({ ...value, expr: e.target.value }, fieldKey)}
        title="Expression in cm; use 2in for inches"
      />
      <div className="expr-result">
        {result.ok ? (
          <>
            <span className={overridden ? 'struck' : ''}>= {len(result.value.value, units)}</span>
            {detail && <span className="muted"> {detail}</span>}
          </>
        ) : (
          <span className="err">
            {result.error}
            {result.pos !== undefined && ` (at ${result.pos + 1})`}
          </span>
        )}
      </div>
      <div className="override">
        <span className="muted">Fixed for {sizeName}:</span>
        <input className="num" value={ov} placeholder="—" onChange={(e) => setOverride(e.target.value)} />
        <span className="muted">{unitLabel(units)}</span>
        {overridden && (
          <button className="link" onClick={clearOverride}>
            clear
          </button>
        )}
      </div>
    </div>
  );
}
