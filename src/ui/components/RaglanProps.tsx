import { defaultShortRows, type YokeResult } from '../../engine/contiguous';
import { generateBodyAndSleeves, missingYokePanels } from '../../engine/contiguousGarment';
import { edgesOf } from '../../engine/edgeTreatments';
import { garmentChoice, NECKLINES, necklinesFor, setNeckline } from '../../engine/garmentSetup';
import { dim, type DimExpr, type NecklineShape, type YokeSpec, type YokeStart } from '../../engine/model';
import type { Units } from '../../engine/units';
import { computePanel } from '../../engine/panel';
import { defaultOffShoulder, RAGLAN_SLEEVE_TOP } from '../../engine/raglan';
import { SYMBOLS } from '../../engine/symbols';
import { editPanel } from '../edit';
import { len } from '../format';
import { ExprField } from './ExprField';
import { NeckbandFold } from './NeckbandFold';
import { IssueList, type PropsContext } from './Properties';
import { NeckWorked, ParamField, ShortRowsWorked } from './YokeProps';

/** Rows as runs: "1–41 every 2nd, 44, 50". */
export function rowRuns(rows: number[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i;
    const step = rows[i + 1] - rows[i];
    while (j + 1 < rows.length && rows[j + 1] - rows[j] === step) j++;
    if (j - i >= 2) {
      out.push(`${rows[i]}–${rows[j]}${step === 1 ? ' every row' : ` every ${step === 2 ? '2nd' : step === 3 ? '3rd' : `${step}th`}`}`);
      i = j + 1;
    } else {
      out.push(String(rows[i]));
      i++;
    }
  }
  return out.join(', ');
}

/** Increase rows in words: every other row (counted from `first`, the first row that can increase) plus the extra
 * rows between, or the rows as runs. */
function incRows(rows: number[], fast: number, first = 1): string {
  if (!rows.length) return 'none';
  if (!fast) return `rows ${rowRuns(rows)}`;
  const slow = rows.filter((r) => (r - first) % 2 === 0);
  return `every other row (rows ${slow[0]}–${slow[slow.length - 1]}), plus rows ${rows.filter((r) => (r - first) % 2 === 1).join(', ')}`;
}

/** The off-shoulder band in words: its stitch, depth and rows (a folded band: finished depth, knit twice). */
function bandWords(o: NonNullable<YokeResult['offShoulder']>, units: Units): string {
  if (o.noBand) return 'none (switched off), the ring cast on as the top edge';
  if (!o.fold) return `${o.pattern.name}, ${len(o.bandCm, units)}, ${o.bandRows} rows`;
  return `folded, ${len(o.bandCm, units)} finished: ${o.fold.depthRows} rows of facing, a ${o.fold.turn} turning round and ${o.fold.depthRows} rows outside, ${o.fold.close === 'knit' ? 'knit closed' : 'sewn down'} (${o.bandRows} rows)`;
}

/** Open a measurement in the Measurements view (App listens). */
const openMeasurement = (name: string) => window.dispatchEvent(new CustomEvent('knitbit:measurement', { detail: name }));

/** A raglan yoke's panel properties: its raglan lines, neck, depth and widths, how they're worked, every size. */
export function RaglanProps({ ctx }: { ctx: PropsContext }) {
  const { panel, computed: c, update, sizeId, sizeName, project } = ctx;
  const spec = panel.yoke!;
  const y = c.yoke;
  const rg = y?.raglan;
  const cardigan = project.garment.opening === 'cardigan';
  const setYoke = (fn: (s: YokeSpec) => void, key: string | null = null) => update((p) => editPanel(p, panel.id, (pp) => fn(pp.yoke!)), key);
  // An off-shoulder yoke's depth uses its back raise (back_raise, cm).
  const scope = y?.offShoulder ? { ...ctx.scope, back_raise: y.offShoulder.backRaiseCm } : ctx.scope;
  const cm = (label: string, get: (s: YokeSpec) => DimExpr, set: (s: YokeSpec, d: DimExpr) => void, key: string) => (
    <ExprField label={label} value={get(spec)} sizeId={sizeId} sizeName={sizeName} scope={scope} units={ctx.units} fieldKey={`yoke.${key}`} onChange={(d, k) => setYoke((s) => set(s, d), `yoke.${panel.id}.${k}`)} />
  );
  const num = (label: string, param: string, get: (s: YokeSpec) => DimExpr, set: (s: YokeSpec, d: DimExpr) => void) => (
    <ParamField label={label} value={get(spec)} param={y?.params[param]} sizeId={sizeId} sizeName={sizeName} onChange={(d, k) => setYoke((s) => set(s, d), `yoke.${panel.id}.${param}.${k}`)} />
  );
  const sr = (s: YokeSpec) => (s.shortRows ??= defaultShortRows());
  const os = spec.neck.shape === 'off-shoulder';
  const o = y?.offShoulder;
  const osSet = (s: YokeSpec) => (s.offShoulder ??= defaultOffShoulder());
  const choice = garmentChoice(project);
  const necks = necklinesFor(choice.method, project.garment.opening);
  const setShape = (shape: NecklineShape) =>
    update((p) =>
      // The whole garment's neckline: an off-shoulder one brings its settings, its measurements and its band.
      editPanel(setNeckline(p, shape), panel.id, (pp) => {
        // Short rows can't make a V's depth: a V neck is shaped by the front neck increases.
        if (shape === 'v') pp.yoke!.start = 'back';
      }),
    );

  // Off-shoulder: the two measurements, the band, ring and arm arcs, and the back raise with its short rows.
  const meas = (name: string, label: string) => {
    const m = project.measurements.find((x) => x.name === name);
    return (
      <div className="field">
        <label>{label}</label>
        <span className="inline">
          <b>{ctx.scope[name] !== undefined ? len(ctx.scope[name], ctx.units) : '—'}</b>
          <span className="muted small">{name}{m?.estimate ? ' · estimate, measure it' : ''} ({sizeName})</span>
          <button className="link" onClick={() => openMeasurement(name)}>edit in Measurements</button>
        </span>
      </div>
    );
  };
  const pct = (param: string) => (y?.params[param] ? ` (${Math.round(y.params[param].value * 100)} %)` : '');
  const offShoulder = (
    <>
      {meas('off_shoulder_circ', 'Off-shoulder circumference')}
      {meas('off_shoulder_drop', 'Drop: shoulder point to the band’s top edge')}
      {!o?.noBand && num(`Band ease, a fraction of off_shoulder_circ${pct('bandEase')}`, 'bandEase', (s) => (s.offShoulder ?? defaultOffShoulder()).bandEase, (s, d) => (osSet(s).bandEase = d))}
      {num(`Ring ease ${o?.noBand ? 'at the cast-on' : 'after the increase round'}${pct('ringEase')}`, 'ringEase', (s) => (s.offShoulder ?? defaultOffShoulder()).ringEase, (s, d) => (osSet(s).ringEase = d))}
      {cm('Arm arc, each sleeve at the ring, between the lines (cm)', (s) => (s.offShoulder ?? defaultOffShoulder()).armArc, (s, d) => (osSet(s).armArc = d), 'armArc')}
      {cm(`Back raise, short rows after the ${o?.noBand ? 'cast-on' : 'increase round'} (cm)`, (s) => (s.offShoulder ?? defaultOffShoulder()).backRaise, (s, d) => (osSet(s).backRaise = d), 'backRaise')}
      <p className="hint">
        A back raise reads back as the Modified raglan, 0 (a level band) as the Classic: it’s the same garment either way. The band is the Neckband edge (Garment tab):
        {o ? ` ${bandWords(o, ctx.units)}` : ''}.
      </p>
      {(!edgesOf(project).neckband.enabled || edgesOf(project).neckband.method === 'with-panel') && <NeckbandFold project={project} update={update} />}
      {(o?.backRaiseCm ?? 0) > 0 && (
        <>
          {num('Short-row pairs', 'srPairs', (s) => (s.shortRows ?? defaultShortRows()).pairs, (s, d) => (sr(s).pairs = d))}
          {num('First turn, sts past the raglan marker', 'srFirst', (s) => (s.shortRows ?? defaultShortRows()).first, (s, d) => (sr(s).first = d))}
          {num('Sts between turns', 'srStep', (s) => (s.shortRows ?? defaultShortRows()).step, (s, d) => (sr(s).step = d))}
          {y?.shortRows && <ShortRowsWorked y={y} cardigan={false} />}
        </>
      )}
    </>
  );

  return (
    <div className="props yoke-props">
      <h3>{os ? 'Off-shoulder raglan yoke' : 'Raglan yoke'}</h3>
      <div className="field">
        <label>Name</label>
        <input value={panel.name} onChange={(e) => update((p) => editPanel(p, panel.id, (pp) => void (pp.name = e.target.value)), `panel.${panel.id}.name`)} />
      </div>
      {os ? (
        <p className="hint">
          Worked top-down in one piece from below the shoulders:{' '}
          {o?.noBand ? 'the ring (fronts, arm arcs and back) is cast on all round, with no band' : 'a band is cast on all round and knit first, an increase round takes it to the ring (fronts, arm arcs and back)'}
          {o?.backRaiseCm ? ', short rows raise the back' : ''}, then four raglan lines run to the underarms. The body and sleeves each increase every other row
          (more often where they need to) to reach their widths at the split.
        </p>
      ) : (
        <p className="hint">
          Worked top-down in one piece from the neck, with four raglan lines to the underarms. The body and sleeves each increase every other row (more often where they need
          to) to reach their widths at the split. Row 1 is a RS row that places the markers.
        </p>
      )}
      <IssueList issues={c.issues} ctx={ctx} />

      {y && rg && (
        <>
          <h4>Rows ({sizeName})</h4>
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
                <tr key={`${ph.id}${ph.from}`}>
                  <td>{ph.label}</td>
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
          <div className="formula">
            {o?.noBand ? (
              <div>
                No band: cast on <b>{o.ringSts}</b> all round ({len(o.ringSts / y.stitchesPerCm, ctx.units)}) and join in the round: left front {o.ringZones.leftFront} · left sleeve {o.ringZones.leftSleeve} ({y.seamSts} + {o.armSts} +{' '}
                {y.seamSts}) · back {o.ringZones.back} · right sleeve {o.ringZones.rightSleeve} · right front {o.ringZones.rightFront}.
              </div>
            ) : o ? (
              <>
                <div>
                  Cast on <b>{o.bandSts}</b> all round for the band and join in the round;{' '}
                  {o.fold ? (
                    <>
                      stockinette, rows 1–{o.fold.depthRows} (the facing); row {o.fold.depthRows + 1}, {o.fold.turn === 'picot' ? 'picot turning round: *yo, k2tog*' : 'purl turning round'}; rows {o.fold.depthRows + 2}–{o.bandRows} stockinette
                      {o.fold.close === 'knit' ? `, knitting each stitch together with its cast-on loop on row ${o.bandRows}` : ', then sew the facing down inside'} ({len(o.bandCm, ctx.units)} finished).
                    </>
                  ) : (
                    <>
                      {o.pattern.name}, rows 1–{o.bandRows} ({len(o.bandCm, ctx.units)}).
                    </>
                  )}
                </div>
                <div>
                  Row {o.incRow}, the increase round: {o.ringSts - o.bandSts} sts spread evenly to <b>{o.ringSts}</b> ({len(o.ringSts / y.stitchesPerCm, ctx.units)}): left front {o.ringZones.leftFront} · left
                  sleeve {o.ringZones.leftSleeve} ({y.seamSts} + {o.armSts} + {y.seamSts}) · back {o.ringZones.back} · right sleeve {o.ringZones.rightSleeve} · right front {o.ringZones.rightFront}.
                </div>
              </>
            ) : (
            <div>
              Cast on <b>{y.castOn}</b>: left front {y.castOnZones.leftFront} · left sleeve {y.castOnZones.leftSleeve} ({y.seamSts} + {rg.sleeveTopSts} + {y.seamSts}) · back {y.castOnZones.back} · right
              sleeve {y.castOnZones.rightSleeve} · right front {y.castOnZones.rightFront}.
            </div>
            )}
            <div>Body: 4 sts on {rg.bodyRows.length} rows: {incRows(rg.bodyRows, rg.bodyFast, o ? o.incRow + 1 : 1)}.</div>
            <div>Sleeves: 2 sts each on {rg.sleeveRows.length} rows: {incRows(rg.sleeveRows, rg.sleeveFast, o ? o.incRow + 1 : 1)}.</div>
            <div>
              Split after row <b>{y.counts.total}</b> ({len(y.derived.backLengthCm, ctx.units)}): sleeves {y.held.leftSleeve} sts on hold each, body {y.held.body} sts, cast on {y.underarmCo} at each
              underarm. Raglan line about {len(rg.lineCm, ctx.units)} long.
            </div>
          </div>
        </>
      )}

      <h4>Raglan lines</h4>
      <div className="row2">
        <div className="field">
          <label>Increases</label>
          <select value={spec.increase.type} onChange={(e) => setYoke((s) => void (s.increase.type = e.target.value as YokeSpec['increase']['type']))}>
            <option value="m1">M1R before / M1L after the line</option>
            <option value="kfb">kfb (pfb on WS rows)</option>
            <option value="other">Other symbol (e.g. yarn over)</option>
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
      {num('Line stitches (knit between the increases)', 'seamSts', (s) => s.seamSts, (s, d) => (s.seamSts = d))}
      {!os && cm('Sleeve top at the cast-on, between the lines (cm)', (s) => s.raglan?.sleeveTop ?? dim(RAGLAN_SLEEVE_TOP), (s, d) => (s.raglan = { ...s.raglan, sleeveTop: d }), 'sleeveTop')}

      <h4>Neck</h4>
      <div className="field">
        <label>Shape</label>
        <select value={spec.neck.shape} onChange={(e) => setShape(e.target.value as NecklineShape)} title="Sets the garment's neckline (as the Garment tab does)">
          {NECKLINES.filter((n) => n.id === spec.neck.shape || necks.includes(n.id)).map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
      </div>
      {os ? (
        offShoulder
      ) : (
      <>
      <div className="field">
        <label>Cast on</label>
        <select
          value={spec.start ?? 'back'}
          onChange={(e) => {
            const start = e.target.value as YokeStart;
            setYoke((s) => {
              s.start = start;
              s.shortRows ??= defaultShortRows();
            });
          }}
        >
          <option value="back">back neck and sleeve tops; front neck increases, then cast on the centre</option>
          <option value="neck" disabled={spec.neck.shape === 'v'}>the whole neck; short rows raise the back</option>
        </select>
      </div>
      {cm('Neck width, cast on across the back (cm)', (s) => s.neck.width ?? dim('back_neck_width'), (s, d) => (s.neck.width = d), 'neckWidth')}
      {cm('Depth below the neck point (cm)', (s) => s.neck.depth, (s, d) => (s.neck.depth = d), 'neckDepth')}
      {spec.neck.shape !== 'v' && spec.neck.shape !== 'square' && cm('Centre (cm)', (s) => s.neck.centre, (s, d) => (s.neck.centre = d), 'neckCentre')}
      {spec.start === 'neck' ? (
        <>
          {num('Front cast-on, both fronts (cm)', 'frontCo', (s) => (s.shortRows ?? defaultShortRows()).frontCo, (s, d) => (sr(s).frontCo = d))}
          {num('Short-row pairs', 'srPairs', (s) => (s.shortRows ?? defaultShortRows()).pairs, (s, d) => (sr(s).pairs = d))}
          {num('First turn, sts past the raglan marker', 'srFirst', (s) => (s.shortRows ?? defaultShortRows()).first, (s, d) => (sr(s).first = d))}
          {num('Sts between turns', 'srStep', (s) => (s.shortRows ?? defaultShortRows()).step, (s, d) => (sr(s).step = d))}
          {y?.shortRows && <ShortRowsWorked y={y} cardigan={cardigan} />}
        </>
      ) : (
        y && <NeckWorked y={y} cardigan={cardigan} rpc={y.rowsPerCm} />
      )}
      </>
      )}

      <h4>Depth and widths</h4>
      {cm(os ? 'Back length, band top to underarm (cm)' : 'Back length, neck to underarm (cm)', (s) => s.depth.backLength, (s, d) => (s.depth.backLength = d), 'backLength')}
      {os && <p className="hint">back_raise is the back raise below (0 for a level band).</p>}
      {cm('Extra depth (cm)', (s) => s.depth.extra, (s, d) => (s.depth.extra = d), 'extra')}
      {cm('Body at the underarm, cast-ons included (cm)', (s) => s.body.width, (s, d) => (s.body.width = d), 'bodyWidth')}
      {cm('Sleeve at the underarm, cast-on included (cm)', (s) => s.sleeveWidth, (s, d) => (s.sleeveWidth = d), 'sleeveWidth')}
      {cm('Underarm cast-on, each (cm)', (s) => s.underarm.castOn, (s, d) => (s.underarm.castOn = d), 'underarmCo')}
      {y && (
        <p className="hint">
          {y.underarmCo} sts each{y.params.underarmCo && y.underarmCo !== Math.round(y.params.underarmCo.value * y.stitchesPerCm) ? ' (raised: the raglan is too shallow for its increases)' : ''}; body {y.held.body} + 2 × {y.underarmCo} ={' '}
          {y.held.body + 2 * y.underarmCo} sts ({len(y.derived.bodyCm, ctx.units)}); sleeve {y.held.leftSleeve} + {y.underarmCo} = {y.held.leftSleeve + y.underarmCo} sts ({len(y.derived.sleeveCm, ctx.units)}).
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

/** Every size side by side: cast-on, depth, increase rows, underarm cast-on, held stitches. */
function AllSizes({ ctx }: { ctx: PropsContext }) {
  const { project, panel } = ctx;
  const all = project.sizes.map((s) => ({ s, y: computePanel(project, panel, s.id).yoke }));
  const rate = (n: number, fast: number) => (fast ? `${n} (${fast} extra)` : String(n));
  const os = all.some(({ y }) => y?.offShoulder);
  return (
    <div className="table-scroll">
      <table className="yoke-table">
        <thead>
          <tr>
            <th>Size</th>
            <th>{os ? 'Band / ring' : 'CO'}</th>
            <th>Rows</th>
            <th>Body inc rows</th>
            <th>Sleeve inc rows</th>
            <th>Back length</th>
            <th>Under­arm CO</th>
            <th>Sleeve / body / sleeve</th>
          </tr>
        </thead>
        <tbody>
          {all.map(({ s, y }) =>
            y?.raglan ? (
              <tr key={s.id} className={s.id === ctx.sizeId ? 'current' : ''}>
                <td>{s.name}</td>
                <td>{y.offShoulder ? `${y.offShoulder.noBand ? '—' : y.offShoulder.bandSts} / ${y.offShoulder.ringSts}` : y.castOn}</td>
                <td>{y.counts.total}</td>
                <td>{rate(y.raglan.bodyRows.length, y.raglan.bodyFast)}</td>
                <td>{rate(y.raglan.sleeveRows.length, y.raglan.sleeveFast)}</td>
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
