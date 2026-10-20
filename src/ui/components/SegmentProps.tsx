// Properties for a selected segment: its shaping method, placement and events. Loaded on first use.

import type { Panel, SegmentMethod } from '../../engine/model';
import { defaultAutoMethod, defaultPrincess, type ShapingPlacement } from '../../engine/model';
import type { ComputedSegment, EdgeShaping } from '../../engine/panel';
import { isCountSymbol, MARKER_SYMBOLS, SYMBOLS } from '../../engine/symbols';
import { editPanel, editSegment } from '../edit';
import { signed } from '../format';
import { ExprField } from './ExprField';
import { IssueList, TagEdge, type PropsContext } from './Properties';

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

export function SegmentProps({ ctx, seg }: { ctx: PropsContext; seg: ComputedSegment }) {
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
