import { useEffect, useState } from 'react';
import { backNeckPositions, defaultShortRows, STRAP_YOKE_BACK, STRAP_YOKE_NECK, yokeWithNeck, type YokeParam } from '../../engine/contiguous';
import { generateBodyAndSleeves, missingYokePanels } from '../../engine/contiguousGarment';
import { NECKLINES, necklinesFor, setNeckline } from '../../engine/garmentSetup';
import { cmText } from '../../engine/issues';
import { dim, type DimExpr, type NecklineShape, type YokeSpec } from '../../engine/model';
import { computePanel } from '../../engine/panel';
import { strapLinks, strapScope, yokeStrapReadout } from '../../engine/strap';
import { SYMBOLS } from '../../engine/symbols';
import { editPanel } from '../edit';
import { len } from '../format';
import { ExprField } from './ExprField';
import { IssueList, type PropsContext } from './Properties';
import { YokeStrapLine } from './StrapSettings';

const UNIT_LABEL: Record<YokeParam['unit'], string> = { cm: 'cm', rows: 'rows', sts: 'sts', '': '' };

/** A contiguous yoke's panel properties: its phases, the phase table for this size, and every size side by side. */
export function YokeProps({ ctx }: { ctx: PropsContext }) {
  const { panel, computed: c, update, sizeId, sizeName, project } = ctx;
  const spec = panel.yoke!;
  const y = c.yoke;
  // The whole-neck start is the modified raglan method; switching start is a method change (Garment tab).
  const modified = spec.start === 'neck';
  const setYoke = (fn: (s: YokeSpec) => void, key: string | null = null) => update((p) => editPanel(p, panel.id, (pp) => fn(pp.yoke!)), key);
  // The yoke's own names (the boat neck's centre and back length use them), as this size works them.
  const local: Record<string, number> = y ? { neck_w: y.params.neckWidth?.value ?? ctx.scope.back_neck_width, neck_depth: y.params.neckDepth?.value ?? 0, back_depth: y.params.neckBackDepth?.value ?? ctx.scope.back_neck_drop } : {};
  // The strap's solved neck or back width (the linked fields name them).
  if (y?.strap) Object.assign(local, { [STRAP_YOKE_NECK]: y.params.neckWidth?.value ?? 0, [STRAP_YOKE_BACK]: y.params.backWidth?.value ?? 0 });
  const scope = { ...ctx.scope, ...local };
  const linked = strapLinks(project, panel).linked;
  // A strap-solved neck keeps the back-start front neck's increases per side: the centre takes the rest.
  const keptShaping = y?.strap?.gives === 'neck' && !modified;
  const cm = (label: string, get: (s: YokeSpec) => DimExpr, set: (s: YokeSpec, d: DimExpr) => void, key: string, note?: string) => (
    <ExprField label={label} value={get(spec)} sizeId={sizeId} sizeName={sizeName} scope={scope} units={ctx.units} fieldKey={`yoke.${key}`} note={note} onChange={(d, k) => setYoke((s) => set(s, d), `yoke.${panel.id}.${k}`)} />
  );
  const num = (label: string, param: string, get: (s: YokeSpec) => DimExpr, set: (s: YokeSpec, d: DimExpr) => void) => (
    <ParamField label={label} value={get(spec)} param={y?.params[param]} sizeId={sizeId} sizeName={sizeName} fieldKey={`yoke.${param}`} onChange={(d, k) => setYoke((s) => set(s, d), `yoke.${panel.id}.${param}.${k}`)} />
  );

  return (
    <div className="props yoke-props">
      <h3>{modified ? 'Modified raglan yoke' : 'Contiguous yoke'}</h3>
      <div className="field">
        <label>Name</label>
        <input value={panel.name} onChange={(e) => update((p) => editPanel(p, panel.id, (pp) => void (pp.name = e.target.value)), `panel.${panel.id}.name`)} />
      </div>
      <p className="hint">
        Worked top-down in one piece from the neck{modified ? ': the whole neck cast on and short rows raising the back (PetiteKnit style), then the shoulder and sleeve-cap phases of' : ':'} the
        contiguous method by Susie Myers (SusieM on Ravelry). Rows come from these phases, not from waypoints. Row 1 is a RS row that places the markers.
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

      <h4>Start</h4>
      <p className="hint">
        Cast on {modified ? 'the whole neck; short rows raise the back (modified raglan)' : 'the back neck only, as the method’s PDF; the front neck is shaped by increases'}. The other start is
        the {modified ? 'contiguous' : 'modified raglan'} method: change it in the Garment tab.
      </p>
      {spec.start === 'neck' && (
        <>
          {num('Front cast-on, both fronts (cm)', 'frontCo', (s) => (s.shortRows ?? defaultShortRows()).frontCo, (s, d) => ((s.shortRows ??= defaultShortRows()).frontCo = d))}
          {num('Short-row pairs', 'srPairs', (s) => (s.shortRows ?? defaultShortRows()).pairs, (s, d) => ((s.shortRows ??= defaultShortRows()).pairs = d))}
          {num('First turn, sts past the shoulder marker', 'srFirst', (s) => (s.shortRows ?? defaultShortRows()).first, (s, d) => ((s.shortRows ??= defaultShortRows()).first = d))}
          {num('Sts between turns', 'srStep', (s) => (s.shortRows ?? defaultShortRows()).step, (s, d) => ((s.shortRows ??= defaultShortRows()).step = d))}
          {y?.shortRows && <ShortRowsWorked y={y} cardigan={project.garment.opening === 'cardigan'} />}
        </>
      )}

      <h4>A · Shoulders</h4>
      {strapScope(project) === 'yoke' && <YokeStrapLine project={project} panel={panel} sizeId={sizeId} units={ctx.units} update={update} />}
      {y?.strap ? (
        <p className="hint">
          The strap width (Garment → Shoulders) sets the seam: {y.strap.rows} rows,{' '}
          {y.strap.gives === 'neck' ? 'the neck width is solved so the back reaches its width below' : 'the neck is kept and the back width follows (the cross back is no longer followed)'}. The seam length setting isn’t used while the strap is linked.
        </p>
      ) : (
        <div className="field">
          <label>Until</label>
          <select value={spec.shoulder.mode} onChange={(e) => setYoke((s) => void (s.shoulder.mode = e.target.value as 'cross-back' | 'length'))}>
            <option value="cross-back">the back reaches the cross back</option>
            <option value="length">the seam reaches the shoulder length</option>
          </select>
        </div>
      )}
      {spec.shoulder.mode === 'cross-back' || y?.strap
        ? cm('Back width after the markers move (cm)', (s) => s.shoulder.backWidth, (s, d) => (s.shoulder.backWidth = d), 'backWidth', linked.includes('yoke.backWidth') ? 'from strap width' : undefined)
        : (
          <>
            {cm('Shoulder seam length (cm)', (s) => s.shoulder.length, (s, d) => (s.shoulder.length = d), 'length')}
            {cm('Shorten the seam by (cm)', (s) => s.shoulder.shorten, (s, d) => (s.shoulder.shorten = d), 'shorten')}
          </>
        )}
      {num(y?.strap ? 'Extra rows (with the strap: the back is 2 sts wider each)' : 'Extra rows (increases tighten the seam)', 'extraRows', (s) => s.shoulder.extraRows, (s, d) => (s.shoulder.extraRows = d))}
      {strapScope(project) === 'yoke' && <StrapAllSizes ctx={ctx} />}

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
            // Off-shoulder makes a raglan yoke (the back raised) with its measurements and band: the garment's neckline.
            if (shape === 'off-shoulder') return update((p) => setNeckline(p, shape));
            setYoke((s) => {
              Object.assign(s, yokeWithNeck(s, shape));
              // Short rows can't make a V's depth: a V neck takes the back start with its neck increases (only a
              // classic raglan offers V with the whole-neck start; the modified raglan has no V).
              if (shape === 'v' && s.start === 'neck') {
                s.start = 'back';
                if (s.style !== 'raglan') s.backNeck.perRow = dim(2);
              }
            });
          }}
        >
          {/* Short rows can't make a V's depth: the modified raglan has no V. Off-shoulder: the modified raglan's, a pullover's. */}
          {NECKLINES.filter((n) => n.id === spec.neck.shape || necklinesFor(modified ? 'modified-raglan' : 'contiguous', project.garment.opening).includes(n.id)).map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
      </div>
      {cm('Neck width, cast on across the back (cm)', (s) => s.neck.width ?? dim('back_neck_width'), (s, d) => (s.neck.width = d), 'neckWidth', linked.includes('yoke.neckWidth') ? 'from strap width' : undefined)}
      {cm(spec.neck.shape === 'boat' ? 'Front depth, from the strap top (cm)' : 'Depth below the neck point (cm)', (s) => s.neck.depth, (s, d) => (s.neck.depth = d), 'neckDepth')}
      {spec.neck.shape === 'boat' && cm('Back depth, from the strap top (cm)', (s) => s.neck.backDepth ?? dim('back_neck_drop'), (s, d) => (s.neck.backDepth = d), 'neckBackDepth')}
      {spec.neck.shape !== 'v' && spec.neck.shape !== 'square' && cm('Centre (cm)', (s) => s.neck.centre, (s, d) => (s.neck.centre = d), 'neckCentre', keptShaping ? `from strap width: the shaping is kept, ${y!.neck.centre} sts cast on` : undefined)}
      {spec.neck.shape === 'v' && keptShaping && y!.neck.centre > 0 && <p className="hint">From strap width: the V keeps its shaping, so it has a flat bottom of {y!.neck.centre} sts cast on.</p>}
      {y && !y.shortRows && <NeckWorked y={y} cardigan={project.garment.opening === 'cardigan'} rpc={y.rowsPerCm} />}

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

      <h4>Body and sleeves</h4>
      {(() => {
        const missing = missingYokePanels(project);
        const made = project.panels.filter((p) => p.fromYoke);
        return (
          <>
            {made.length > 0 && <p className="hint">Continuing from the held stitches: {made.map((p) => p.name).join(', ')}. Their underarm widths are yoke.back_w, yoke.front_w and yoke.sleeve_w.</p>}
            {missing.length > 0 && (
              <button onClick={() => update((p) => generateBodyAndSleeves(p))}>
                Add {missing.map((m) => ({ back: 'back', front: 'front', leftSleeve: 'left sleeve', rightSleeve: 'right sleeve' })[m]).join(', ')}
              </button>
            )}
          </>
        );
      })()}

      <h4>All sizes</h4>
      <AllSizes ctx={ctx} />
    </div>
  );
}

/** How the whole-neck start is worked in this size: the cast-on, the short rows and where the rounds begin (an
 * off-shoulder yoke's back raise: the short rows after its band and increase round). */
export function ShortRowsWorked({ y, cardigan }: { y: NonNullable<PropsContext['computed']['yoke']>; cardigan: boolean }) {
  const sr = y.shortRows!;
  const z = y.castOnZones;
  const from = sr.fromRow ?? 1;
  // A front neck deeper than the short rows: the fronts are open (worked flat) until the closing cast-on.
  const fn = sr.frontNeck;
  const flat = cardigan || !!fn;
  return (
    <div className="formula">
      {!y.offShoulder && <div>
        Cast on <b>{y.castOn}</b>: left front {z.leftFront} · seam {z.leftSleeve} · back {z.back} · seam {z.rightSleeve} · right front {z.rightFront}
        {flat ? ', worked flat.' : ', join in the round; the round starts at the left back shoulder marker (between the back and the left seam).'}
      </div>}
      {sr.pairs > 0 ? (
        <div>
          {flat
            ? `Row ${from} (RS): from the right front edge to ${sr.turns[0]} sts before the left front edge, turn. `
            : `Row ${from} (RS): from the marker to ${sr.turns[0]} sts before centre front, turn (no increases). `}
          Then German short rows, each turn {sr.step} st{sr.step === 1 ? '' : 's'} nearer centre front: turns at {sr.turns.join(', ')} sts from
          {flat ? ' each front edge' : ' centre front'} ({sr.pairs} pairs, rows {from}–{sr.endRow - 1}).{' '}
          {flat
            ? `Row ${sr.endRow} (RS): to the left front edge; then every row across.`
            : `Row ${sr.endRow} (RS): from the last turn back to the marker (no increases); then rounds.`}
        </div>
      ) : (
        <div>No short rows: the back isn't raised.</div>
      )}
      {fn && <DeepNeckWorked y={y} cardigan={cardigan} />}
    </div>
  );
}

/** A whole neck deeper than its short rows: how the depth is shared, and the front neck worked after the short rows. */
function DeepNeckWorked({ y, cardigan }: { y: NonNullable<PropsContext['computed']['yoke']>; cardigan: boolean }) {
  const sr = y.shortRows!;
  const n = y.neck;
  const rpc = y.rowsPerCm;
  const cm = (rows: number) => cmText(Math.round((rows / rpc) * 10) / 10);
  const depth = y.params.neckDepth?.value ?? 0;
  const incRows = y.rows.filter((r) => r.neck).map((r) => r.row);
  const nc = y.neckContinues;
  const close = cardigan
    ? n.frontEdgeCo > 0
      ? <>cast on <b>{n.frontEdgeCo}</b> sts at each front edge (right front on row {n.row}, left front on row {n.row + 1})</>
      : <>the fronts are straight from row {n.row}</>
    : <>cast on <b>{n.centre}</b> sts at centre front at the end of row {n.row} and join in the round</>;
  return (
    <>
      <div>
        Front neck {cmText(depth)}: the back neck is {cmText(sr.frontNeck!.backDepth)} below the neck point, the short rows raise the back{' '}
        <b>{cm(2 * sr.pairs)}</b> ({sr.pairs} pairs); the front neck&rsquo;s other <b>{cm(n.row - sr.endRow)}</b> (rows {sr.endRow + 1}–{n.row}) is worked below them:
      </div>
      <div>
        cast on <b>{sr.frontNeck!.castOn}</b> sts each front (what the turns need), then{' '}
        {n.perSide ? (
          <>
            <b>+{n.perSide}</b> each side inside the edge stitch
            {incRows.length ? ` (rows ${incRows.join(', ')}${nc?.perSide ? `, and ${nc.perSide} more in the front body` : ''})` : nc?.perSide ? ` (${nc.perSide} in the front body)` : ''}
          </>
        ) : (
          'no increases (the neck edges run straight)'
        )}
        , then {close}
        {nc ? ' (in the front body: the split is row ' + y.counts.total + ')' : ''}.
      </div>
    </>
  );
}

/** How the front neck is worked in this size, with the numbers plugged in. */
export function NeckWorked({ y, cardigan, rpc }: { y: NonNullable<PropsContext['computed']['yoke']>; cardigan: boolean; rpc: number }) {
  const n = y.neck;
  const depthCm = y.params.neckDepth?.value ?? 0;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return (
    <div className="formula">
      <div>
        Neck row R = depth × row gauge = {r2(depthCm)} × {r2(rpc)} = {r2(depthCm * rpc)} → {n.depthRows}
        {n.row !== n.depthRows ? ` → row ${n.row} (a RS row)` : ` (a RS row)`}.
      </div>
      <div>
        Increases at each front edge: (neck width − centre) / 2 = ({n.backNeck} − {n.centre}) / 2 = <b>{n.perSide}</b>
        {n.perSide ? `, on rows ${y.rows.filter((r) => r.neck).map((r) => r.row).join(', ')}` : ''}.
      </div>
      {y.neckContinues && (
        <div>
          The split is row {y.counts.total}: the neck is still open there. The front body works the last <b>{y.neckContinues.perSide}</b> increases each side
          {y.neckContinues.perSide ? ` (rows ${y.neckContinues.increaseRows.map((r) => r + y.counts.total).join(', ')}, counting on from the yoke)` : ''} and closes the neck on row {n.row}
          {cardigan ? '' : ', worked flat (the back too) until then'}.
        </div>
      )}
      {cardigan ? (
        <div>
          Each front casts on (centre − closing_r) / 2 = ({n.centre} − {n.closingSts}) / 2 = <b>{n.frontEdgeCo}</b> sts at its front edge ({y.neckContinues ? 'on the front body' : `right front on row ${n.row}, left front on row ${n.row + 1}`}); the
          fronts stay open, flat to the split.
        </div>
      ) : (
        <div>
          Cast on <b>{n.centre}</b> sts at centre front at the end of row {n.row}{y.neckContinues ? ' (on the front body)' : ''} (neck width − 2 × increases = {n.backNeck} − 2 × {n.perSide}) and join in the round.
        </div>
      )}
    </div>
  );
}

/** An expression in rows, stitches or a fraction (not cm), with its numbers plugged in and a per-size value. */
export function ParamField({ label, value, param, sizeId, sizeName, onChange, fieldKey }: { label: string; value: DimExpr; param?: YokeParam; sizeId: string; sizeName: string; onChange: (d: DimExpr, key: string) => void; fieldKey?: string }) {
  const overridden = sizeId in value.overrides;
  const [ov, setOv] = useState('');
  useEffect(() => setOv(overridden ? String(value.overrides[sizeId]) : ''), [overridden, value.overrides, sizeId]);
  const unit = param ? UNIT_LABEL[param.unit] : '';
  return (
    <div className={`field expr-field${overridden ? ' is-overridden' : ''}`} data-field={fieldKey}>
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

/** The strap (shoulder seam) in every size side by side: cm and rows, the neck cast-on and the back at the end of A. */
function StrapAllSizes({ ctx }: { ctx: PropsContext }) {
  const { project, panel } = ctx;
  const all = project.sizes.map((s) => ({ s, r: yokeStrapReadout(project, panel, s.id) }));
  const cm = (x: number) => len(Math.round(x * 10) / 10, ctx.units);
  return (
    <div className="table-scroll">
      <table className="yoke-table">
        <thead>
          <tr>
            <th>Size</th>
            <th>Strap</th>
            <th>Rows</th>
            <th>Neck</th>
            <th>Back at end of A</th>
          </tr>
        </thead>
        <tbody>
          {all.map(({ s, r }) =>
            r ? (
              <tr key={s.id} className={s.id === ctx.sizeId ? 'current' : ''}>
                <td>{s.name}</td>
                <td>{cm(r.strapCm)}</td>
                <td>{r.rows}</td>
                <td>{cm(r.neckCm)}</td>
                <td>{cm(r.backCm)}</td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </div>
  );
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
