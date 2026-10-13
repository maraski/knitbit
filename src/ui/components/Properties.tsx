import type { DimExpr, Id, Panel, Project, SegmentMethod, Waypoint } from '../../engine/model';
import { defaultAutoMethod, defaultBust, defaultPrincess, dim, newId, newWaypoint, type ShapingPlacement } from '../../engine/model';
import { BustProps } from './BustProps';
import { JOIN_TAGS, sameEdge } from '../../engine/joins';
import type { EdgeKey, JoinTag } from '../../engine/model';
import { produce } from '../edit';
import type { ComputedPanel, ComputedSegment, ComputedWaypoint, EdgeShaping, Issue } from '../../engine/panel';
import type { RoundingResult } from '../../engine/rounding';
import { isCountSymbol, MARKER_SYMBOLS, SYMBOLS } from '../../engine/symbols';
import type { Units } from '../../engine/units';
import type { MarkerActions } from '../markerActions';
import { editPanel, editSegment, editWaypoint } from '../edit';
import { fmtNum, len, signed, sts } from '../format';
import type { Selection } from '../selection';
import { ExprField } from './ExprField';

export interface PropsContext {
  project: Project;
  panel: Panel;
  computed: ComputedPanel;
  sizeId: Id;
  sizeName: string;
  scope: Record<string, number>; // measurements + ease + this panel's waypoint values
  units: Units;
  update: (fn: (p: Project) => Project, key?: string | null) => void;
  select: (s: Selection) => void;
  markers: MarkerActions;
  selection: Selection;
}

export function Properties({ ctx, selection }: { ctx: PropsContext; selection: Selection }) {
  switch (selection.kind) {
    case 'waypoint': {
      const wp = ctx.panel.waypoints.find((w) => w.id === selection.id);
      return wp ? <WaypointProps ctx={ctx} wp={wp} /> : <PanelProps ctx={ctx} />;
    }
    case 'segment': {
      const seg = ctx.computed.segments.find((s) => s.fromWaypoint === selection.fromWaypoint);
      return seg ? <SegmentProps ctx={ctx} seg={seg} /> : <PanelProps ctx={ctx} />;
    }
    case 'neckline':
      return ctx.panel.neckline ? <NecklineProps ctx={ctx} /> : <PanelProps ctx={ctx} />;
    case 'bust':
      return ctx.panel.bust ? <BustProps ctx={ctx} /> : <PanelProps ctx={ctx} />;
    default:
      return <PanelProps ctx={ctx} />;
  }
}

// ---------- panel ----------

function PanelProps({ ctx }: { ctx: PropsContext }) {
  const { panel, computed: c, update } = ctx;
  const set = (fn: (p: Panel) => void, key: string | null = null) => update((p) => editPanel(p, panel.id, fn), key);
  const addWaypoint = () => {
    const last = panel.waypoints[panel.waypoints.length - 1];
    const k = last ? `${last.name}` : 'top';
    const wp = newWaypoint(uniqueName(panel, 'new_point'), last ? `${k}.height + 5` : 0, last ? `${k}.width` : 20);
    set((p) => {
      p.waypoints.push(wp);
    });
    ctx.select({ kind: 'waypoint', id: wp.id });
  };

  return (
    <div className="props">
      <h3>Panel</h3>
      <div className="field">
        <label>Name</label>
        <input value={panel.name} onChange={(e) => set((p) => void (p.name = e.target.value), `panel.${panel.id}.name`)} />
      </div>
      <div className="row2">
        <div className="field">
          <label>Direction</label>
          <select value={panel.direction} onChange={(e) => set((p) => void (p.direction = e.target.value as Panel['direction']))}>
            <option value="bottom-up">Bottom-up</option>
            <option value="top-down">Top-down</option>
            <option value="side-to-side">Side-to-side</option>
          </select>
        </div>
        <div className="field">
          <label>Worked</label>
          <select
            value={panel.inTheRound ? 'round' : panel.joinAt && panel.waypoints.some((w) => w.id === panel.joinAt) ? `join:${panel.joinAt}` : 'flat'}
            onChange={(e) =>
              set((p) => {
                const v = e.target.value;
                p.inTheRound = v === 'round';
                p.joinAt = v.startsWith('join:') ? v.slice(5) : null;
              })
            }
          >
            <option value="flat">Flat</option>
            <option value="round">In the round</option>
            {(c.ok ? (c.topDown ? [...c.waypoints].reverse() : c.waypoints) : []).slice(1, -1).map((w) => (
              <option key={w.id} value={`join:${w.id}`}>In the round below {w.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="row3">
        <div className="field">
          <label>Selvedge L</label>
          <select value={panel.selvedge.left} onChange={(e) => set((p) => void (p.selvedge.left = Number(e.target.value)))}>
            {[0, 1, 2].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Selvedge R</label>
          <select value={panel.selvedge.right} onChange={(e) => set((p) => void (p.selvedge.right = Number(e.target.value)))}>
            {[0, 1, 2].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Shaping inset</label>
          <input className="num" type="number" min={0} value={panel.shapingInset} onChange={(e) => set((p) => void (p.shapingInset = Math.max(0, Number(e.target.value))), `panel.${panel.id}.inset`)} />
        </div>
      </div>
      <div className="row3">
        <div className="field">
          <label>Stitch count</label>
          <select value={panel.rounding.parity} onChange={(e) => set((p) => void (p.rounding.parity = e.target.value as Panel['rounding']['parity']))}>
            <option value="any">Any</option>
            <option value="even">Even</option>
            <option value="odd">Odd</option>
          </select>
        </div>
        <div className="field">
          <label>Multiple</label>
          <input className="num" type="number" min={1} value={panel.pattern.multiple} onChange={(e) => set((p) => void (p.pattern.multiple = Math.max(1, Math.round(Number(e.target.value)))), `panel.${panel.id}.mult`)} />
        </div>
        <div className="field">
          <label>+</label>
          <input className="num" type="number" min={0} value={panel.pattern.offset} onChange={(e) => set((p) => void (p.pattern.offset = Math.max(0, Math.round(Number(e.target.value)))), `panel.${panel.id}.off`)} />
        </div>
      </div>

      <h4>Waypoints</h4>
      <ul className="wp-list">
        {[...(c.ok ? c.waypoints : [])].reverse().map((w) => (
          <li key={w.id}>
            <button className="link" onClick={() => ctx.select({ kind: 'waypoint', id: w.id })}>{w.name}</button>
            <span className="muted"> row {w.row} · {sts(w.actualStitches)}</span>
          </li>
        ))}
      </ul>
      <button onClick={addWaypoint}>+ Add waypoint</button>

      {(panel.joinAt || panel.inTheRound) && c.roundRows && (
        <p className="hint">
          Rounds {c.roundRows.from}–{c.roundRows.to} in the round (no selvedges there); flat rows start with a RS row at row {c.firstFlatRow}.
        </p>
      )}

      <h4>Pattern sections</h4>
      <SectionsEditor ctx={ctx} />

      <h4>Neckline</h4>
      {panel.neckline ? (
        <p>
          <button className="link" onClick={() => ctx.select({ kind: 'neckline' })}>{panel.neckline.shape} neck</button>{' '}
          <button className="link danger" onClick={() => set((p) => void (p.neckline = null))}>remove</button>
        </p>
      ) : (
        <button
          onClick={() => {
            set((p) => {
              p.neckline = { shape: 'round', width: dim('neck_width'), depth: dim('back_neck_depth'), centre: 'bindoff', centreWidth: dim('neck_width - 2'), side: 'rs' };
            });
            ctx.select({ kind: 'neckline' });
          }}
        >
          + Add neckline
        </button>
      )}

      <TagEdge ctx={ctx} edge={{ kind: 'bottom' }} label="lower edge" />
      <TagEdge ctx={ctx} edge={{ kind: 'top' }} label="upper edge" />

      <h4>Bust shaping</h4>
      {panel.bust ? (
        <p>
          <button className="link" onClick={() => ctx.select({ kind: 'bust' })}>
            {panel.bust.method === 'none' ? 'none' : panel.bust.method.replace('-', ' ')}
            {c.bust ? ` · W ${len(c.bust.width.value, ctx.units)}, L ${len(c.bust.length.value, ctx.units)}` : ''}
          </button>
        </p>
      ) : (
        <button
          onClick={() => {
            set((p) => void (p.bust = defaultBust()));
            ctx.select({ kind: 'bust' });
          }}
        >
          + Add bust shaping
        </button>
      )}

      {c.ok && (
        <>
          <h4>Summary ({ctx.sizeName})</h4>
          <dl className="kv">
            <dt>Cast on</dt><dd>{c.counts[0] > 0 ? sts(c.counts[0]) : 'in steps (see first segment)'}</dd>
            <dt>Last row</dt><dd>{sts(c.counts[c.totalRows])}</dd>
            <dt>Rows</dt><dd>{c.totalRows}</dd>
            <dt>Length</dt><dd>{len(c.totalRows / c.rowsPerCm, ctx.units)}</dd>
            <dt>Widest</dt><dd>{sts(Math.max(...c.counts))}</dd>
          </dl>
        </>
      )}
      <IssueList issues={c.issues} ctx={ctx} />
    </div>
  );
}

function SectionsEditor({ ctx }: { ctx: PropsContext }) {
  const { panel, update } = ctx;
  const set = (fn: (p: Panel) => void, key: string | null = null) => update((p) => editPanel(p, panel.id, fn), key);
  const common = { sizeId: ctx.sizeId, sizeName: ctx.sizeName, scope: ctx.scope, units: ctx.units };
  return (
    <>
      {panel.sections.length === 0 && <p className="hint">e.g. a ribbed hem or cuff. Waypoints inside a section round to its stitch multiple.</p>}
      {panel.sections.map((sec, i) => {
        const cs = ctx.computed.sections.find((x) => x.id === sec.id);
        return (
          <div key={sec.id} className="section-box">
            <div className="row2">
              <div className="field">
                <label>Name</label>
                <input value={sec.name} onChange={(e) => set((p) => void (p.sections[i].name = e.target.value), `sec.${sec.id}.name`)} />
              </div>
              <div className="field">
                <label>Stitch pattern</label>
                <input value={sec.pattern.name} onChange={(e) => set((p) => void (p.sections[i].pattern.name = e.target.value), `sec.${sec.id}.pat`)} />
              </div>
            </div>
            <div className="row3">
              <div className="field">
                <label>Multiple</label>
                <input className="num" type="number" min={1} value={sec.pattern.multiple} onChange={(e) => set((p) => void (p.sections[i].pattern.multiple = Math.max(1, Math.round(Number(e.target.value)))), `sec.${sec.id}.m`)} />
              </div>
              <div className="field">
                <label>+</label>
                <input className="num" type="number" min={0} value={sec.pattern.offset} onChange={(e) => set((p) => void (p.sections[i].pattern.offset = Math.max(0, Math.round(Number(e.target.value)))), `sec.${sec.id}.o`)} />
              </div>
              <div className="field">
                <label>&nbsp;</label>
                <button className="link danger" onClick={() => set((p) => void p.sections.splice(i, 1))}>remove</button>
              </div>
            </div>
            <ExprField label="From height" value={sec.fromHeight} onChange={(d, k) => set((p) => void (p.sections[i].fromHeight = d), `sec.${sec.id}.${k}.from`)} fieldKey="from" {...common} />
            <ExprField label="To height" value={sec.toHeight} onChange={(d, k) => set((p) => void (p.sections[i].toHeight = d), `sec.${sec.id}.${k}.to`)} fieldKey="to" {...common} detail={cs && <>→ rows {cs.fromRow}–{cs.toRow}</>} />
          </div>
        );
      })}
      <button
        onClick={() =>
          set((p) =>
            void p.sections.push({ id: newId('sec'), name: 'Hem rib', fromHeight: dim(0), toHeight: dim(5), pattern: { name: '2x2 rib', multiple: 4, offset: 2 } }),
          )
        }
      >
        + Add section
      </button>
    </>
  );
}

function uniqueName(panel: Panel, base: string): string {
  const names = new Set(panel.waypoints.map((w) => w.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base}_${i}`)) return `${base}_${i}`;
}

// ---------- waypoint ----------

function RoundingSteps({ r, label }: { r: RoundingResult; label?: string }) {
  if (!r.steps.length) return null;
  return (
    <ul className="rounding">
      {r.steps.map((s, i) => (
        <li key={i}>
          {label && <span className="muted">{label}: </span>}
          {s.note} <span className="muted">({fmtNum(Math.round(s.from * 100) / 100)} → {s.to})</span>
        </li>
      ))}
    </ul>
  );
}

function WaypointProps({ ctx, wp }: { ctx: PropsContext; wp: Waypoint }) {
  const { panel, update } = ctx;
  const cw = ctx.computed.waypoints.find((w) => w.id === wp.id);
  const set = (fn: (w: Waypoint) => void, key: string | null = null) => update((p) => editWaypoint(p, panel.id, wp.id, fn), key);
  const setDim = (field: 'height' | 'width' | 'left' | 'right') => (d: DimExpr, key: string) => set((w) => void (w[field] = d), `wp.${wp.id}.${key}`);
  const common = { sizeId: ctx.sizeId, sizeName: ctx.sizeName, scope: ctx.scope, units: ctx.units };
  const spc = ctx.computed.stitchesPerCm;

  // Garment order (bottom to top) of computed waypoints, to find the neighbour above / below.
  const garment = ctx.computed.topDown ? [...ctx.computed.waypoints].reverse() : ctx.computed.waypoints;
  const neighbour = (dir: 1 | -1) => {
    const i = garment.findIndex((w) => w.id === wp.id);
    return i >= 0 ? garment[i + dir] : undefined;
  };
  const insert = (dir: 1 | -1) => {
    const other = neighbour(dir);
    if (!other || !cw) return;
    const a = cw.key;
    const b = other.key;
    const fresh = newWaypoint(uniqueName(panel, `${dir > 0 ? a : b}_up`), `(${a}.height + ${b}.height) / 2`, `(${a}.width + ${b}.width) / 2`);
    update((p) =>
      editPanel(p, panel.id, (pn) => {
        const idx = pn.waypoints.findIndex((w) => w.id === wp.id);
        pn.waypoints.splice(dir > 0 ? idx + 1 : idx, 0, fresh);
        // The segment that spanned the gap starts at the lower waypoint; give the new upper part the same method.
        const lowerId = dir > 0 ? wp.id : other.id;
        const s = pn.segments.find((x) => x.fromWaypoint === lowerId);
        if (s) pn.segments.push({ ...structuredClone(s), fromWaypoint: fresh.id, manual: {} });
      }),
    );
    ctx.select({ kind: 'waypoint', id: fresh.id });
  };

  const remove = () => {
    update((p) =>
      editPanel(p, panel.id, (pn) => {
        pn.waypoints = pn.waypoints.filter((w) => w.id !== wp.id);
        pn.segments = pn.segments.filter((s) => s.fromWaypoint !== wp.id);
      }),
    );
    ctx.select({ kind: 'panel' });
  };

  return (
    <div className="props">
      <h3>Waypoint</h3>
      <div className="field">
        <label>Name</label>
        <input value={wp.name} onChange={(e) => set((w) => void (w.name = e.target.value), `wp.${wp.id}.name`)} />
        {cw && <div className="hint">Refer to it as <code>{cw.key}.height</code>, <code>{cw.key}.width</code></div>}
      </div>
      <ExprField label="Height from start edge" value={wp.height} onChange={setDim('height')} fieldKey="height" {...common} detail={cw && <>→ row {cw.row}</>} />
      {cw && <RoundingSteps r={cw.rowRounding} />}

      <label className="check">
        <input
          type="checkbox"
          checked={wp.symmetric}
          onChange={(e) =>
            set((w) => {
              w.symmetric = e.target.checked;
              if (!w.symmetric && cw) {
                w.left = dim(`(${w.width.expr}) / 2`);
                w.right = dim(`(${w.width.expr}) / 2`);
              }
            })
          }
        />
        Symmetric (right mirrors left)
      </label>
      {wp.symmetric ? (
        <ExprField label="Width" value={wp.width} onChange={setDim('width')} fieldKey="width" {...common} detail={cw && <>→ {sts(cw.stitches)}</>} />
      ) : (
        <>
          <ExprField label="Left half (centre to left edge)" value={wp.left} onChange={setDim('left')} fieldKey="left" {...common} />
          <ExprField label="Right half (centre to right edge)" value={wp.right} onChange={setDim('right')} fieldKey="right" {...common} />
        </>
      )}
      {cw && (
        <>
          {cw.stitchRounding.map((r, i) => (
            <RoundingSteps key={i} r={r} label={cw.stitchRounding.length > 1 ? (i ? 'right' : 'left') : undefined} />
          ))}
          <dl className="kv">
            <dt>Target</dt><dd>{len(cw.widthCm, ctx.units)}</dd>
            <dt>Knitted</dt>
            <dd>
              {len((cw.stitches - panel.selvedge.left - panel.selvedge.right) / spc, ctx.units)}{' '}
              <span className="muted">({signed(Math.round(((cw.stitches - panel.selvedge.left - panel.selvedge.right) / spc - cw.widthCm) * 100) / 100)} cm, excl. selvedges)</span>
            </dd>
            <dt>Stitches</dt>
            <dd className={cw.actualStitches !== cw.stitches ? 'err' : ''}>
              {cw.actualStitches === cw.stitches ? sts(cw.stitches) : `reaches ${cw.actualStitches} of ${cw.stitches}`}
            </dd>
          </dl>
        </>
      )}
      <IssueList issues={ctx.computed.issues.filter((i) => i.ref.kind === 'waypoint' && i.ref.id === wp.id)} ctx={ctx} />
      <div className="actions button-row">
        <button onClick={() => insert(1)} disabled={!neighbour(1)}>Insert above</button>
        <button onClick={() => insert(-1)} disabled={!neighbour(-1)}>Insert below</button>
        <button className="danger" onClick={remove} disabled={panel.waypoints.length <= 2}>Delete waypoint</button>
      </div>
    </div>
  );
}

// ---------- segment ----------

const METHOD_LABELS: Record<SegmentMethod['kind'], string> = {
  auto: 'Spread increases / decreases',
  steps: 'Bind off / cast on in steps',
  shortrows: 'Short rows',
  straight: 'Straight',
};

function defaultFor(kind: SegmentMethod['kind']): SegmentMethod {
  switch (kind) {
    case 'auto':
      return defaultAutoMethod();
    case 'steps':
      return { kind: 'steps', steps: null, maxPerStep: 5, align: 'start' };
    case 'shortrows':
      return { kind: 'shortrows', steps: null, maxPerStep: 6, style: 'german', align: 'end' };
    default:
      return { kind: 'straight' };
  }
}

function MethodEditor({ method, onChange, keyBase }: { method: SegmentMethod; onChange: (m: SegmentMethod, key?: string) => void; keyBase: string }) {
  return (
    <>
      <div className="field">
        <label>Method</label>
        <select value={method.kind} onChange={(e) => onChange(defaultFor(e.target.value as SegmentMethod['kind']))}>
          {Object.entries(METHOD_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {method.kind === 'auto' && (
        <>
          <div className="row2">
            <div className="field">
              <label>Shape on</label>
              <select value={method.side} onChange={(e) => onChange({ ...method, side: e.target.value as typeof method.side })}>
                <option value="rs">RS rows</option>
                <option value="ws">WS rows</option>
                <option value="any">Any row</option>
              </select>
            </div>
            <div className="field">
              <label>Sts per edge per row</label>
              <input className="num" type="number" min={1} max={3} value={method.perSide} onChange={(e) => onChange({ ...method, perSide: Math.max(1, Math.round(Number(e.target.value))) }, `${keyBase}.per`)} />
            </div>
          </div>
          <div className="row2">
            <div className="field">
              <label>Rhythm</label>
              <select
                value={method.rhythm.type}
                onChange={(e) => {
                  const t = e.target.value;
                  onChange({ ...method, rhythm: t === 'fixed' ? { type: 'fixed', every: 4 } : t === 'mixed' ? { type: 'mixed', a: 4, b: 6 } : { type: 'auto' } });
                }}
              >
                <option value="auto">Even spread</option>
                <option value="fixed">Every Nth row</option>
                <option value="mixed">Two rhythms</option>
              </select>
            </div>
            {method.rhythm.type === 'fixed' && (
              <div className="field">
                <label>Every</label>
                <input className="num" type="number" min={1} value={method.rhythm.every} onChange={(e) => onChange({ ...method, rhythm: { type: 'fixed', every: Math.max(1, Math.round(Number(e.target.value))) } }, `${keyBase}.every`)} />
              </div>
            )}
            {method.rhythm.type === 'mixed' && (
              <div className="field">
                <label>Every … and …</label>
                <span className="inline">
                  <input className="num" type="number" min={1} value={method.rhythm.a} onChange={(e) => method.rhythm.type === 'mixed' && onChange({ ...method, rhythm: { ...method.rhythm, a: Math.max(1, Math.round(Number(e.target.value))) } }, `${keyBase}.a`)} />
                  <input className="num" type="number" min={1} value={method.rhythm.b} onChange={(e) => method.rhythm.type === 'mixed' && onChange({ ...method, rhythm: { ...method.rhythm, b: Math.max(1, Math.round(Number(e.target.value))) } }, `${keyBase}.b`)} />
                </span>
              </div>
            )}
          </div>
          <div className="row2">
            <div className="field">
              <label>Plain rows go</label>
              <select value={method.align} onChange={(e) => onChange({ ...method, align: e.target.value as typeof method.align })}>
                <option value="end">Before (shaping ends at waypoint)</option>
                <option value="start">After (shaping starts at once)</option>
                <option value="center">Before and after</option>
              </select>
            </div>
            <div className="field">
              <label>Uneven gaps</label>
              <select value={method.order} onChange={(e) => onChange({ ...method, order: e.target.value as typeof method.order })}>
                <option value="spread">Interleaved</option>
                <option value="shortFirst">Shorter first</option>
                <option value="longFirst">Longer first</option>
              </select>
            </div>
          </div>
        </>
      )}
      {(method.kind === 'steps' || method.kind === 'shortrows') && (
        <>
          <div className="row2">
            <div className="field">
              <label>Steps (sts)</label>
              <input
                placeholder="auto"
                defaultValue={method.steps?.join(', ') ?? ''}
                key={method.steps?.join(',') ?? 'auto'}
                onBlur={(e) => {
                  const t = e.target.value.trim();
                  const nums = t === '' ? null : t.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0).map(Math.round);
                  onChange({ ...method, steps: nums && nums.length ? nums : null });
                }}
              />
            </div>
            <div className="field">
              <label>Max per step</label>
              <input className="num" type="number" min={1} value={method.maxPerStep} onChange={(e) => onChange({ ...method, maxPerStep: Math.max(1, Math.round(Number(e.target.value))) }, `${keyBase}.max`)} />
            </div>
          </div>
          <div className="row2">
            <div className="field">
              <label>Place steps</label>
              <select value={method.align ?? 'start'} onChange={(e) => onChange({ ...method, align: e.target.value as 'start' | 'end' | 'center' })}>
                <option value="start">At the start of the segment</option>
                <option value="end">At the end of the segment</option>
                <option value="center">In the middle</option>
              </select>
            </div>
            {method.kind === 'shortrows' && (
              <div className="field">
                <label>Short row style</label>
                <select value={method.style} onChange={(e) => onChange({ ...method, style: e.target.value as typeof method.style })}>
                  <option value="german">German</option>
                  <option value="wrap-turn">Wrap and turn</option>
                </select>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

function EventsTable({ shaping, counts }: { shaping: EdgeShaping; counts: number[] }) {
  if (!shaping.events.length) return <p className="muted small">{shaping.summary}</p>;
  return (
    <>
      <p className="small">{shaping.summary}</p>
      <table className="events">
        <thead>
          <tr><th>Row</th><th>Change</th><th>Sts after</th></tr>
        </thead>
        <tbody>
          {shaping.events.map((e, i) => (
            <tr key={i}>
              <td>{e.row}</td>
              <td>{signed(e.delta)} {e.kind === 'dec' || e.kind === 'inc' ? '' : e.kind === 'turn' ? 'turn' : e.kind === 'bindoff' ? 'BO' : 'CO'}</td>
              <td>{counts[e.row]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Marker table you can edit: row, stitch, count, delete. Edits switch this size to manual markers. */
function EditableEvents({ ctx, seg, edge }: { ctx: PropsContext; seg: ComputedSegment; edge: 'left' | 'right' }) {
  const shaping = seg[edge];
  const counts = ctx.computed.counts;
  const m = ctx.markers;
  const total = shaping.events.reduce((a, e) => a + e.delta, 0);
  const sel = ctx.selection.kind === 'segment' && ctx.selection.fromWaypoint === seg.fromWaypoint && ctx.selection.edge === edge ? ctx.selection.marker : undefined;
  const freeRow = () => {
    const used = new Set(shaping.events.map((e) => e.row));
    const mid = Math.round((seg.rowFrom + seg.rowTo) / 2);
    for (let d = 0; d <= seg.rowTo - seg.rowFrom; d++) {
      for (const r of [mid + d, mid - d]) if (r >= seg.rowFrom && r <= seg.rowTo && !used.has(r)) return r;
    }
    return mid;
  };
  return (
    <>
      <p className="small">{shaping.summary}</p>
      <table className="events editable">
        <thead>
          <tr><th>Row</th><th>Stitch</th><th>Sts</th><th>After</th><th /></tr>
        </thead>
        <tbody>
          {shaping.events.map((e, i) => (
            <tr key={`${i}-${e.row}`} className={sel === i ? 'selected' : ''} onClick={() => ctx.select({ kind: 'segment', fromWaypoint: seg.fromWaypoint, edge, marker: i })}>
              <td>
                <input
                  className="num tiny"
                  type="number"
                  min={seg.rowFrom}
                  max={seg.rowTo}
                  defaultValue={e.row}
                  key={e.row}
                  onBlur={(ev) => {
                    const r = Math.round(Number(ev.target.value));
                    if (Number.isFinite(r) && r !== e.row) m.move(seg.fromWaypoint, edge, i, r - seg.rowFrom + 1);
                  }}
                  onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()}
                />
              </td>
              <td>
                <select value={e.symbol ?? ''} onChange={(ev) => m.setSymbol(seg.fromWaypoint, edge, i, ev.target.value)}>
                  {MARKER_SYMBOLS.map((id) => <option key={id} value={id}>{SYMBOLS[id].abbr} – {SYMBOLS[id].label}</option>)}
                  {(ctx.project.symbols ?? []).map((cs) => <option key={cs.id} value={cs.id}>{cs.abbr} – {cs.label} ({signed(cs.change)})</option>)}
                </select>
              </td>
              <td>
                {e.symbol && isCountSymbol(e.symbol) ? (
                  <input className="num tiny" type="number" min={1} value={Math.abs(e.delta)} onChange={(ev) => m.setSymbol(seg.fromWaypoint, edge, i, e.symbol!, Math.max(1, Math.round(Number(ev.target.value))))} />
                ) : (
                  signed(e.delta)
                )}
              </td>
              <td>{counts[e.row]}</td>
              <td><button className="icon" title="Remove" onClick={(ev) => { ev.stopPropagation(); m.remove(seg.fromWaypoint, edge, i); }}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`small ${total !== shaping.target ? 'err' : 'muted'}`}>
        {signed(total)} of {signed(shaping.target)} sts needed{total !== shaping.target ? ' – the next waypoint will not be reached' : ''}
      </p>
      <button onClick={() => m.add(seg, edge, freeRow() - seg.rowFrom + 1)}>+ Add marker</button>
    </>
  );
}

function sameEvents(a: EdgeShaping, b: EdgeShaping): boolean {
  return a.events.length === b.events.length && a.events.every((e, i) => e.row === b.events[i].row && e.delta === b.events[i].delta);
}

const PLACEMENTS: Record<ShapingPlacement, string> = {
  edge: 'Side edges',
  princess: 'Princess lines',
  both: 'Side edges + princess lines',
};

/** Where this segment's increases/decreases go, and the panel's princess lines. */
function PlacementEditor({ ctx, seg }: { ctx: PropsContext; seg: ComputedSegment }) {
  const { panel, update } = ctx;
  const stored = panel.segments.find((s) => s.fromWaypoint === seg.fromWaypoint);
  const placement = stored?.placement ?? 'edge';
  const pr = panel.princess ?? defaultPrincess();
  const common = { sizeId: ctx.sizeId, sizeName: ctx.sizeName, scope: ctx.scope, units: ctx.units };
  const setPr = (fn: (x: NonNullable<Panel['princess']>) => void, key: string | null = null) =>
    update((p) => editPanel(p, panel.id, (pn) => {
      pn.princess ??= defaultPrincess();
      fn(pn.princess);
    }), key);
  const off = ctx.computed.princess?.offset;
  return (
    <>
      <div className="field">
        <label>Shape at</label>
        <select
          value={placement}
          onChange={(e) =>
            update((p) =>
              editPanel(editSegment(p, panel.id, seg.fromWaypoint, (s) => void (s.placement = e.target.value as ShapingPlacement)), panel.id, (pn) => {
                pn.princess ??= defaultPrincess();
              }),
            )
          }
        >
          {(Object.keys(PLACEMENTS) as ShapingPlacement[]).map((k) => <option key={k} value={k}>{PLACEMENTS[k]}</option>)}
        </select>
      </div>
      {placement !== 'edge' && (
        <div className="subtle-box">
          <ExprField
            label="Princess lines: distance from centre (each side)"
            value={pr.position}
            onChange={(d, k) => setPr((x) => void (x.position = d), `princess.${panel.id}.${k}`)}
            fieldKey="princess"
            {...common}
            detail={off !== undefined && <>→ {Math.round(off * 10) / 10} sts from centre</>}
          />
          <div className="field">
            <label>At each line</label>
            <select value={pr.sides} onChange={(e) => setPr((x) => void (x.sides = e.target.value as 'both' | 'one'))}>
              <option value="both">Both sides of the marker (2 sts per row)</option>
              <option value="one">One side (1 st per row)</option>
            </select>
          </div>
          <p className="hint">
            Shared by every segment of {panel.name} shaped at princess lines. The side edges stay straight in the fabric; the schematic still shows the
            finished width. An odd stitch is worked on one side of the marker only.{stored && Object.keys(stored.manual).length ? ' Hand-placed markers keep their stitch counts: reset them after changing this.' : ''}
          </p>
        </div>
      )}
    </>
  );
}

function SegmentProps({ ctx, seg }: { ctx: PropsContext; seg: ComputedSegment }) {
  const { panel, update } = ctx;
  const stored = panel.segments.find((s) => s.fromWaypoint === seg.fromWaypoint);
  const from = ctx.computed.waypoints.find((w) => w.id === seg.fromWaypoint);
  const to = ctx.computed.waypoints.find((w) => w.id === seg.toWaypoint);
  const left = stored?.left ?? defaultAutoMethod();
  const right = stored?.right ?? defaultAutoMethod();
  const mirror = stored?.mirror ?? true;
  const hasManual = !!stored?.manual[ctx.sizeId];
  const edit = (fn: (s: NonNullable<typeof stored>) => void, key: string | null = null) => update((p) => editSegment(p, panel.id, seg.fromWaypoint, fn), key);
  const keyBase = `seg.${panel.id}.${seg.fromWaypoint}`;

  return (
    <div className="props">
      <h3>Shaping</h3>
      <p className="muted">
        {from?.name} → {to?.name} · rows {seg.rowFrom}–{seg.rowTo} ({Math.max(0, seg.rowTo - seg.rowFrom + 1)} rows)
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={mirror}
          onChange={(e) =>
            edit((s) => {
              s.mirror = e.target.checked;
              if (!s.mirror) s.right = structuredClone(s.left);
            })
          }
        />
        Same on both edges
      </label>
      <PlacementEditor ctx={ctx} seg={seg} />
      {hasManual ? (
        <p className="notice-inline">
          Hand-placed markers for {ctx.sizeName}.{' '}
          <button className="link" onClick={() => ctx.markers.reset(seg.fromWaypoint)}>Reset to auto</button>
        </p>
      ) : (
        <p className="hint">Auto-suggested. Editing a marker below or on the schematic switches {ctx.sizeName} to hand-placed markers.</p>
      )}
      {mirror ? (
        <>
          {!hasManual && <MethodEditor method={left} keyBase={`${keyBase}.l`} onChange={(m, key) => edit((s) => { s.left = m; s.right = structuredClone(m); }, key ?? null)} />}
          <h4>{sameEvents(seg.left, seg.right) ? 'Each edge' : 'Left edge'}</h4>
          <EditableEvents ctx={ctx} seg={seg} edge="left" />
          {!sameEvents(seg.left, seg.right) && (
            <>
              <h4>Right edge (mirrors the left)</h4>
              <EventsTable shaping={seg.right} counts={ctx.computed.counts} />
            </>
          )}
        </>
      ) : (
        <>
          <h4>Left edge</h4>
          {!hasManual && <MethodEditor method={left} keyBase={`${keyBase}.l`} onChange={(m, key) => edit((s) => void (s.left = m), key ?? null)} />}
          <EditableEvents ctx={ctx} seg={seg} edge="left" />
          <h4>Right edge</h4>
          {!hasManual && <MethodEditor method={right} keyBase={`${keyBase}.r`} onChange={(m, key) => edit((s) => void (s.right = m), key ?? null)} />}
          <EditableEvents ctx={ctx} seg={seg} edge="right" />
        </>
      )}
      <IssueList issues={ctx.computed.issues.filter((i) => i.ref.kind === 'segment' && i.ref.fromWaypoint === seg.fromWaypoint)} ctx={ctx} />
      <TagEdge
        ctx={ctx}
        edge={{ kind: 'side', side: ctx.selection.kind === 'segment' && ctx.selection.edge === 'right' ? 'right' : 'left', from: seg.fromWaypoint, to: seg.toWaypoint }}
        label={`${ctx.selection.kind === 'segment' && ctx.selection.edge === 'right' ? 'right' : 'left'} edge ${from?.name ?? ''}–${to?.name ?? ''}`}
      />
      <p className="hint">To tag a longer stretch (e.g. hem to underarm), tag one segment and widen its range in the join.</p>
    </div>
  );
}

// ---------- neckline ----------

function NecklineProps({ ctx }: { ctx: PropsContext }) {
  const { panel, update } = ctx;
  const nk = panel.neckline!;
  const neck = ctx.computed.neck;
  const set = (fn: (n: NonNullable<Panel['neckline']>) => void, key: string | null = null) =>
    update((p) => editPanel(p, panel.id, (pn) => pn.neckline && fn(pn.neckline)), key);
  const setDim = (field: 'width' | 'depth' | 'centreWidth') => (d: DimExpr, key: string) => set((n) => void (n[field] = d), `neck.${panel.id}.${key}`);
  const common = { sizeId: ctx.sizeId, sizeName: ctx.sizeName, scope: ctx.scope, units: ctx.units };
  return (
    <div className="props">
      <h3>Neckline</h3>
      <div className="row2">
        <div className="field">
          <label>Shape</label>
          <select value={nk.shape} onChange={(e) => set((n) => void (n.shape = e.target.value as typeof n.shape))}>
            <option value="round">Round</option>
            <option value="v">V</option>
            <option value="square">Square</option>
            <option value="boat">Boat</option>
          </select>
        </div>
        <div className="field">
          <label>Centre stitches</label>
          <select value={nk.centre} onChange={(e) => set((n) => void (n.centre = e.target.value as typeof n.centre))}>
            <option value="bindoff">Bind off</option>
            <option value="hold">Hold</option>
          </select>
        </div>
      </div>
      <ExprField label="Opening width" value={nk.width} onChange={setDim('width')} fieldKey="width" {...common} detail={neck && <>→ {sts(neck.widthSts)}</>} />
      <ExprField label="Depth (from top)" value={nk.depth} onChange={setDim('depth')} fieldKey="depth" {...common} detail={neck && <>→ {neck.depthRows} rows</>} />
      <ExprField label="Centre width" value={nk.centreWidth} onChange={setDim('centreWidth')} fieldKey="centre" {...common} detail={neck && <>→ {sts(neck.centreSts)}</>} />
      {nk.shape === 'v' && (
        <div className="field">
          <label>Side shaping on</label>
          <select value={nk.side} onChange={(e) => set((n) => void (n.side = e.target.value as typeof n.side))}>
            <option value="rs">RS rows</option>
            <option value="any">Any row</option>
          </select>
        </div>
      )}
      {neck && (
        <>
          <p className="small">{neck.summary}</p>
          {neck.events.length > 0 && (
            <table className="events">
              <thead><tr><th>Row</th><th>Each side</th><th>Sts after</th></tr></thead>
              <tbody>
                {neck.events.map((e, i) => (
                  <tr key={i}><td>{e.row}</td><td>{signed(e.delta)}</td><td>{ctx.computed.counts[e.row]}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      <IssueList issues={ctx.computed.issues.filter((i) => i.ref.kind === 'neckline')} ctx={ctx} />
      <TagEdge ctx={ctx} edge={{ kind: 'neck' }} label="neckline" />
    </div>
  );
}

// ---------- joins ----------

/** Tag an edge: add it to an existing join or start a new one. Shows the joins this edge is already in. */
export function TagEdge({ ctx, edge, label }: { ctx: PropsContext; edge: EdgeKey; label: string }) {
  const ref = { panelId: ctx.panel.id, edge };
  const joins = ctx.project.joins ?? [];
  const inJoins = joins.filter((j) => [...j.edges, ...j.partner].some((r) => sameEdge(r, ref)));
  const choose = (value: string) => {
    if (!value) return;
    if (value.startsWith('new:')) {
      const tag = value.slice(4) as JoinTag;
      const id = newId('join');
      ctx.update((p) =>
        produce(p, (d) => {
          d.joins = [...(d.joins ?? []), { id, name: `${JOIN_TAGS[tag].label}: ${ctx.panel.name} ${label}`, tag, edges: [ref], partner: [], ratio: null, note: '' }];
        }),
      );
      ctx.select({ kind: 'join', id });
    } else {
      const [id, role] = value.split('|');
      ctx.update((p) =>
        produce(p, (d) => {
          const j = d.joins?.find((x) => x.id === id);
          if (j) (role === 'partner' ? j.partner : j.edges).push(ref);
        }),
      );
      ctx.select({ kind: 'join', id });
    }
  };
  return (
    <div className="tag-edge">
      <h4>Joins</h4>
      {inJoins.map((j) => (
        <p key={j.id} className="small">
          <i className="tag-chip" style={{ background: JOIN_TAGS[j.tag].color }} />
          <button className="link" onClick={() => ctx.select({ kind: 'join', id: j.id })}>{j.name}</button>
        </p>
      ))}
      <select value="" onChange={(e) => choose(e.target.value)}>
        <option value="">Tag {label}…</option>
        <optgroup label="New">
          {Object.entries(JOIN_TAGS).map(([k, t]) => <option key={k} value={`new:${k}`}>{t.label}</option>)}
        </optgroup>
        {joins.length > 0 && (
          <optgroup label="Add to">
            {joins.flatMap((j) =>
              j.tag === 'seam'
                ? [<option key={j.id} value={`${j.id}|edges`}>{j.name} (this side)</option>, <option key={`${j.id}p`} value={`${j.id}|partner`}>{j.name} (sewn to)</option>]
                : [<option key={j.id} value={`${j.id}|edges`}>{j.name}</option>],
            )}
          </optgroup>
        )}
      </select>
    </div>
  );
}

// ---------- issues ----------

export function IssueList({ issues, ctx }: { issues: Issue[]; ctx: PropsContext }) {
  if (!issues.length) return null;
  return (
    <ul className="issues">
      {issues.map((i, k) => (
        <li key={k} className={`issue issue-${i.severity}`}>
          <button className="link" onClick={() => ctx.select(i.ref.kind === 'panel' ? { kind: 'panel' } : i.ref)}>
            {i.message}
          </button>
        </li>
      ))}
    </ul>
  );
}

export type { ComputedWaypoint };
