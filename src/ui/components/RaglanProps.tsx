import { defaultShortRows } from '../../engine/contiguous';
import { generateBodyAndSleeves, missingYokePanels } from '../../engine/contiguousGarment';
import { dim, type DimExpr, type NecklineShape, type YokeSpec, type YokeStart } from '../../engine/model';
import { computePanel } from '../../engine/panel';
import { defaultRaglan, RAGLAN_SLEEVE_TOP } from '../../engine/raglan';
import { SYMBOLS } from '../../engine/symbols';
import { FRONT_NECKS } from '../../engine/templates';
import { editPanel } from '../edit';
import { len } from '../format';
import { ExprField } from './ExprField';
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

/** Increase rows in words: every other row plus the extra rows between, or the rows as runs. */
function incRows(rows: number[], fast: number): string {
  if (!rows.length) return 'none';
  if (!fast) return `rows ${rowRuns(rows)}`;
  const odd = rows.filter((r) => r % 2 === 1);
  return `every other row (rows ${odd[0]}–${odd[odd.length - 1]}), plus rows ${rows.filter((r) => r % 2 === 0).join(', ')}`;
}

/** A raglan yoke's panel properties: its raglan lines, neck, depth and widths, how they're worked, every size. */
export function RaglanProps({ ctx }: { ctx: PropsContext }) {
  const { panel, computed: c, update, sizeId, sizeName, project } = ctx;
  const spec = panel.yoke!;
  const y = c.yoke;
  const rg = y?.raglan;
  const cardigan = project.garment.opening === 'cardigan';
  const setYoke = (fn: (s: YokeSpec) => void, key: string | null = null) => update((p) => editPanel(p, panel.id, (pp) => fn(pp.yoke!)), key);
  const cm = (label: string, get: (s: YokeSpec) => DimExpr, set: (s: YokeSpec, d: DimExpr) => void, key: string) => (
    <ExprField label={label} value={get(spec)} sizeId={sizeId} sizeName={sizeName} scope={ctx.scope} units={ctx.units} fieldKey={`yoke.${key}`} onChange={(d, k) => setYoke((s) => set(s, d), `yoke.${panel.id}.${k}`)} />
  );
  const num = (label: string, param: string, get: (s: YokeSpec) => DimExpr, set: (s: YokeSpec, d: DimExpr) => void) => (
    <ParamField label={label} value={get(spec)} param={y?.params[param]} sizeId={sizeId} sizeName={sizeName} onChange={(d, k) => setYoke((s) => set(s, d), `yoke.${panel.id}.${param}.${k}`)} />
  );
  const sr = (s: YokeSpec) => (s.shortRows ??= defaultShortRows());

  return (
    <div className="props yoke-props">
      <h3>Raglan yoke</h3>
      <div className="field">
        <label>Name</label>
        <input value={panel.name} onChange={(e) => update((p) => editPanel(p, panel.id, (pp) => void (pp.name = e.target.value)), `panel.${panel.id}.name`)} />
      </div>
      <p className="hint">
        Worked top-down in one piece from the neck, with four raglan lines to the underarms. The body and sleeves each increase every other row (more often where they need
        to) to reach their widths at the split. Row 1 is a RS row that places the markers.
      </p>
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
                <tr key={ph.id}>
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
            <div>
              Cast on <b>{y.castOn}</b>: left front {y.castOnZones.leftFront} · left sleeve {y.castOnZones.leftSleeve} ({y.seamSts} + {rg.sleeveTopSts} + {y.seamSts}) · back {y.castOnZones.back} · right
              sleeve {y.castOnZones.rightSleeve} · right front {y.castOnZones.rightFront}.
            </div>
            <div>Body: 4 sts on {rg.bodyRows.length} rows: {incRows(rg.bodyRows, rg.bodyFast)}.</div>
            <div>Sleeves: 2 sts each on {rg.sleeveRows.length} rows: {incRows(rg.sleeveRows, rg.sleeveFast)}.</div>
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
      {cm('Sleeve top at the cast-on, between the lines (cm)', (s) => s.raglan?.sleeveTop ?? dim(RAGLAN_SLEEVE_TOP), (s, d) => (s.raglan = { ...s.raglan, sleeveTop: d }), 'sleeveTop')}

      <h4>Neck</h4>
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
      <div className="field">
        <label>Shape</label>
        <select
          value={spec.neck.shape}
          onChange={(e) => {
            const shape = e.target.value as NecklineShape;
            setYoke((s) => {
              s.neck = defaultRaglan(shape).neck;
              // Short rows can't make a V's depth: a V neck is shaped by the front neck increases.
              if (shape === 'v') s.start = 'back';
            });
          }}
        >
          {(Object.keys(FRONT_NECKS) as NecklineShape[]).map((k) => <option key={k} value={k}>{k}</option>)}
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

      <h4>Depth and widths</h4>
      {cm('Back length, neck to underarm (cm)', (s) => s.depth.backLength, (s, d) => (s.depth.backLength = d), 'backLength')}
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
  return (
    <div className="table-scroll">
      <table className="yoke-table">
        <thead>
          <tr>
            <th>Size</th>
            <th>CO</th>
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
                <td>{y.castOn}</td>
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
