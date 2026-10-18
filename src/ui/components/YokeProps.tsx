import { useEffect, useState } from 'react';
import { backNeckPositions, defaultYoke, type YokeParam } from '../../engine/contiguous';
import { FRONT_NECKS } from '../../engine/templates';
import type { DimExpr, NecklineShape, YokeSpec } from '../../engine/model';
import { computePanel } from '../../engine/panel';
import { SYMBOLS } from '../../engine/symbols';
import { editPanel } from '../edit';
import { len } from '../format';
import { ExprField } from './ExprField';
import { IssueList, type PropsContext } from './Properties';

const UNIT_LABEL: Record<YokeParam['unit'], string> = { cm: 'cm', rows: 'rows', sts: 'sts', '': '' };

/** A contiguous yoke's panel properties: its phases, the phase table for this size, and every size side by side. */
export function YokeProps({ ctx }: { ctx: PropsContext }) {
  const { panel, computed: c, update, sizeId, sizeName, project } = ctx;
  const spec = panel.yoke!;
  const y = c.yoke;
  const setYoke = (fn: (s: YokeSpec) => void, key: string | null = null) => update((p) => editPanel(p, panel.id, (pp) => fn(pp.yoke!)), key);
  const cm = (label: string, get: (s: YokeSpec) => DimExpr, set: (s: YokeSpec, d: DimExpr) => void, key: string) => (
    <ExprField label={label} value={get(spec)} sizeId={sizeId} sizeName={sizeName} scope={ctx.scope} units={ctx.units} fieldKey={`yoke.${key}`} onChange={(d, k) => setYoke((s) => set(s, d), `yoke.${panel.id}.${k}`)} />
  );
  const num = (label: string, param: string, get: (s: YokeSpec) => DimExpr, set: (s: YokeSpec, d: DimExpr) => void) => (
    <ParamField label={label} value={get(spec)} param={y?.params[param]} sizeId={sizeId} sizeName={sizeName} onChange={(d, k) => setYoke((s) => set(s, d), `yoke.${panel.id}.${param}.${k}`)} />
  );

  return (
    <div className="props yoke-props">
      <h3>Contiguous yoke</h3>
      <div className="field">
        <label>Name</label>
        <input value={panel.name} onChange={(e) => update((p) => editPanel(p, panel.id, (pp) => void (pp.name = e.target.value)), `panel.${panel.id}.name`)} />
      </div>
      <p className="hint">
        Worked top-down in one piece from the back neck: the contiguous method by Susie Myers (SusieM on Ravelry). Rows come from these phases, not from
        waypoints. Row 1 is a RS row that places the markers.
      </p>
      <IssueList issues={c.issues} ctx={ctx} />

      {y && (
        <>
          <h4>Phases ({sizeName})</h4>
          <table className="yoke-table">
            <thead>
              <tr>
                <th>Phase</th>
                <th>Rows</th>
                <th>Sts</th>
                <th>Increases</th>
              </tr>
            </thead>
            <tbody>
              {y.phases.map((ph) => (
                <tr key={ph.id}>
                  <td>
                    {ph.id} · {ph.label}
                  </td>
                  <td>
                    {ph.from}–{ph.to} ({ph.to - ph.from + 1})
                  </td>
                  <td>
                    {ph.stsBefore} → {ph.stsAfter}
                  </td>
                  <td>{ph.incsPerRow}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            Cast on {y.castOn} ({y.castOnZones.leftFront} + {y.seamSts} + {y.castOnZones.back} + {y.seamSts} + {y.castOnZones.rightFront}). Split after row {y.counts.total}: sleeves {y.held.leftSleeve} sts on hold
            each, body {y.held.body} sts, cast on {y.underarmCo} at each underarm. Shoulder seam {len(y.derived.seamCm, ctx.units)}; back at the end of A{' '}
            {len(y.derived.backEndOfACm, ctx.units)} (cross back {len(ctx.scope.cross_back ?? 0, ctx.units)}); fronts {len(y.derived.frontEndOfACm, ctx.units)} (cross front{' '}
            {len(ctx.scope.cross_front ?? 0, ctx.units)}).
          </p>
        </>
      )}

      <h4>Increases</h4>
      <div className="row2">
        <div className="field">
          <label>Type</label>
          <select value={spec.increase.type} onChange={(e) => setYoke((s) => void (s.increase.type = e.target.value as YokeSpec['increase']['type']))}>
            <option value="m1">M1L / M1R pair</option>
            <option value="kfb">kfb (pfb on WS rows)</option>
            <option value="other">Other symbol</option>
          </select>
        </div>
        {spec.increase.type === 'other' && (
          <div className="field">
            <label>Symbol</label>
            <select value={spec.increase.symbol} onChange={(e) => setYoke((s) => void (s.increase.symbol = e.target.value))}>
              {Object.values(SYMBOLS).map((x) => <option key={x.id} value={x.id}>{x.abbr || x.id} – {x.label}</option>)}
              {(project.symbols ?? []).map((x) => <option key={x.id} value={x.id}>{x.abbr} – {x.label}</option>)}
            </select>
          </div>
        )}
      </div>
      {num('Seam stitches (more = rounder cap)', 'seamSts', (s) => s.seamSts, (s, d) => (s.seamSts = d))}

      <h4>A · Shoulders</h4>
      <div className="field">
        <label>Until</label>
        <select value={spec.shoulder.mode} onChange={(e) => setYoke((s) => void (s.shoulder.mode = e.target.value as 'cross-back' | 'length'))}>
          <option value="cross-back">the back reaches the cross back</option>
          <option value="length">the seam reaches the shoulder length</option>
        </select>
      </div>
      {spec.shoulder.mode === 'cross-back'
        ? cm('Back width after the markers move (cm)', (s) => s.shoulder.backWidth, (s, d) => (s.shoulder.backWidth = d), 'backWidth')
        : (
          <>
            {cm('Shoulder seam length (cm)', (s) => s.shoulder.length, (s, d) => (s.shoulder.length = d), 'length')}
            {cm('Shorten the seam by (cm)', (s) => s.shoulder.shorten, (s, d) => (s.shoulder.shorten = d), 'shorten')}
          </>
        )}
      {num('Extra rows (increases tighten the seam)', 'extraRows', (s) => s.shoulder.extraRows, (s, d) => (s.shoulder.extraRows = d))}

      <h4>B · Back neck</h4>
      {num('Increases per row (2–4)', 'backNeckPerRow', (s) => s.backNeck.perRow, (s, d) => (s.backNeck.perRow = d))}
      {num('Over the first … rows (every second row)', 'backNeckRows', (s) => s.backNeck.rows, (s, d) => (s.backNeck.rows = d))}
      {y && <BackNeckPositions ctx={ctx} />}

      <h4>Front neck</h4>
      <div className="field">
        <label>Shape</label>
        <select
          value={spec.neck.shape}
          onChange={(e) => {
            const shape = e.target.value as NecklineShape;
            const d = defaultYoke(shape).neck;
            setYoke((s) => void (s.neck = d));
          }}
        >
          {(Object.keys(FRONT_NECKS) as NecklineShape[]).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
      {cm('Depth below the neck point (cm)', (s) => s.neck.depth, (s, d) => (s.neck.depth = d), 'neckDepth')}
      {spec.neck.shape !== 'v' && spec.neck.shape !== 'square' && cm('Centre (cm)', (s) => s.neck.centre, (s, d) => (s.neck.centre = d), 'neckCentre')}

      <h4>C, D · Sleeve cap</h4>
      {num('Cap top stitches (markers move to)', 'capTopSts', (s) => s.cap.topSts, (s, d) => (s.cap.topSts = d))}
      {num('Rapid rows (every row)', 'rapidRows', (s) => s.cap.rapidRows, (s, d) => (s.cap.rapidRows = d))}
      <label className="check">
        <input type="checkbox" checked={spec.cap.solve} onChange={(e) => setYoke((s) => void (s.cap.solve = e.target.checked))} />
        Lengthen the rapid phase until the sleeve can reach its width
      </label>
      {cm('Sleeve at the underarm, cast-on included (cm)', (s) => s.sleeveWidth, (s, d) => (s.sleeveWidth = d), 'sleeveWidth')}

      <h4>E · Armhole and split</h4>
      <div className="field">
        <label>Split</label>
        <select value={spec.depth.mode} onChange={(e) => setYoke((s) => void (s.depth.mode = e.target.value as 'back-length' | 'armhole'))}>
          <option value="back-length">by the back length from the neck</option>
          <option value="armhole">armhole depth below the seam end</option>
        </select>
      </div>
      {spec.depth.mode === 'back-length' && cm('Back length, neck to underarm (cm)', (s) => s.depth.backLength, (s, d) => (s.depth.backLength = d), 'backLength')}
      {cm('Extra depth (cm)', (s) => s.depth.extra, (s, d) => (s.depth.extra = d), 'extra')}
      <label className="check">
        <input type="checkbox" checked={spec.depth.deepen} onChange={(e) => setYoke((s) => void (s.depth.deepen = e.target.checked))} />
        Deepen until the cap is not mostly rapid
      </label>
      {spec.depth.deepen && num('Rapid rows at most (fraction of the armhole)', 'maxRapid', (s) => s.depth.maxRapid, (s, d) => (s.depth.maxRapid = d))}
      {cm('Body at the underarm, cast-ons included (cm)', (s) => s.body.width, (s, d) => (s.body.width = d), 'bodyWidth')}
      <label className="check">
        <input type="checkbox" checked={spec.body.increases} onChange={(e) => setYoke((s) => void (s.body.increases = e.target.checked))} />
        Body increases low in the armhole (off: the underarm cast-on makes up the body)
      </label>
      {spec.body.increases && num('Body increases over (fraction of the armhole, from the split)', 'bodyZone', (s) => s.body.zone, (s, d) => (s.body.zone = d))}

      <h4>F · Underarm</h4>
      {cm('Underarm cast-on, each (cm)', (s) => s.underarm.castOn, (s, d) => (s.underarm.castOn = d), 'underarmCo')}
      {y && (
        <p className="hint">
          {y.underarmCo} sts each; body {y.held.body} + 2 × {y.underarmCo} = {y.held.body + 2 * y.underarmCo} sts ({len(y.derived.bodyCm, ctx.units)}); sleeve {y.held.leftSleeve} + {y.underarmCo} ={' '}
          {y.held.leftSleeve + y.underarmCo} sts ({len(y.derived.sleeveCm, ctx.units)}).
        </p>
      )}

      <h4>All sizes</h4>
      <AllSizes ctx={ctx} />
    </div>
  );
}

/** An expression in rows, stitches or a fraction (not cm), with its numbers plugged in and a per-size value. */
function ParamField({ label, value, param, sizeId, sizeName, onChange }: { label: string; value: DimExpr; param?: YokeParam; sizeId: string; sizeName: string; onChange: (d: DimExpr, key: string) => void }) {
  const overridden = sizeId in value.overrides;
  const [ov, setOv] = useState('');
  useEffect(() => setOv(overridden ? String(value.overrides[sizeId]) : ''), [overridden, value.overrides, sizeId]);
  const unit = param ? UNIT_LABEL[param.unit] : '';
  return (
    <div className={`field expr-field${overridden ? ' is-overridden' : ''}`}>
      <label>{label}</label>
      <input className="expr" value={value.expr} spellCheck={false} onChange={(e) => onChange({ ...value, expr: e.target.value }, 'expr')} />
      {param && (
        <div className="expr-result">
          <span className={overridden ? 'struck' : ''}>
            {param.plugged !== param.expr && param.plugged !== String(param.value) ? `= ${param.plugged} ` : ''}= {Math.round(param.value * 100) / 100} {unit}
          </span>
        </div>
      )}
      <div className="override">
        <span className="muted">Fixed for {sizeName}:</span>
        <input
          className="num"
          value={ov}
          placeholder="—"
          onChange={(e) => {
            setOv(e.target.value);
            const n = Number(e.target.value.replace(',', '.'));
            if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange({ ...value, overrides: { ...value.overrides, [sizeId]: n } }, 'ov');
          }}
        />
        <span className="muted">{unit}</span>
        {overridden && (
          <button
            className="link"
            onClick={() => {
              const { [sizeId]: _, ...rest } = value.overrides;
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

/** Back neck increase positions for this size: spread evenly by default, or typed per increase row. */
function BackNeckPositions({ ctx }: { ctx: PropsContext }) {
  const { panel, computed: c, update, sizeId, sizeName } = ctx;
  const y = c.yoke!;
  const rows = y.rows.filter((r) => r.backNeck);
  const manual = panel.yoke!.backNeck.manual[sizeId];
  const set = (i: number, text: string) =>
    update(
      (p) =>
        editPanel(p, panel.id, (pp) => {
          const m = (pp.yoke!.backNeck.manual[sizeId] ??= rows.map((r, j) => backNeckPositions(prevBack(y, r.row), r.incs.filter((x) => x.kind === 'backNeck').length, j)));
          m[i] = text.split(/[ ,]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
        }),
      `yoke.${panel.id}.bn.${i}`,
    );
  if (!rows.length) return null;
  return (
    <div className="field">
      <label>Positions in {sizeName} (increase after back stitch n, counted before the row)</label>
      {rows.map((r, i) => {
        const auto = backNeckPositions(prevBack(y, r.row), r.incs.filter((x) => x.kind === 'backNeck').length, i);
        return (
          <div key={r.row} className="inline">
            <span className="muted small">row {r.row}</span>
            <input className="expr" defaultValue={(manual?.[i] ?? auto).join(', ')} key={`${sizeId}-${(manual?.[i] ?? auto).join(',')}`} onBlur={(e) => set(i, e.target.value)} />
          </div>
        );
      })}
      {manual && (
        <button
          className="link"
          onClick={() =>
            update((p) =>
              editPanel(p, panel.id, (pp) => {
                delete pp.yoke!.backNeck.manual[sizeId];
              }),
            )
          }
        >
          spread evenly again
        </button>
      )}
    </div>
  );
}

function prevBack(y: NonNullable<PropsContext['computed']['yoke']>, row: number): number {
  return row <= 1 ? y.castOnZones.back : y.rows[row - 2].zones.back;
}

/** Every size side by side: rows per phase, cast-on, split, underarm cast-on, held stitches. */
function AllSizes({ ctx }: { ctx: PropsContext }) {
  const { project, panel } = ctx;
  const all = project.sizes.map((s) => ({ s, y: computePanel(project, panel, s.id).yoke }));
  return (
    <div className="table-scroll">
      <table className="yoke-table">
        <thead>
          <tr>
            <th>Size</th>
            <th>CO</th>
            <th>A</th>
            <th>C</th>
            <th>D</th>
            <th>E</th>
            <th>Rows</th>
            <th>Back length</th>
            <th>Under­arm CO</th>
            <th>Sleeve / body / sleeve</th>
          </tr>
        </thead>
        <tbody>
          {all.map(({ s, y }) =>
            y ? (
              <tr key={s.id} className={s.id === ctx.sizeId ? 'current' : ''}>
                <td>{s.name}</td>
                <td>{y.castOn}</td>
                <td>{y.counts.A}</td>
                <td>{y.counts.C}</td>
                <td>{y.counts.D}</td>
                <td>{y.counts.E}</td>
                <td>{y.counts.total}</td>
                <td>{len(y.derived.backLengthCm, ctx.units)}</td>
                <td>{y.underarmCo}</td>
                <td>
                  {y.held.leftSleeve} / {y.held.body} / {y.held.rightSleeve}
                  {y.issues.some((i) => i.severity !== 'info') ? ' ⚠' : ''}
                </td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </div>
  );
}
