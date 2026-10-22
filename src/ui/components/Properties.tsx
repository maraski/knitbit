import type { Id, Panel, Project } from '../../engine/model';
import { defaultBust, dim, newId, newWaypoint } from '../../engine/model';
import { lazy, Suspense } from 'react';
import { linePresets } from '../linePresets';
import { linkPanels } from '../../engine/waypointDrag';
import { frontPartner, linkFronts, unlinkFronts } from '../../engine/cardigan';
import { JOIN_TAGS, sameEdge } from '../../engine/joins';
import type { EdgeKey, JoinTag } from '../../engine/model';
import { produce } from '../edit';
import type { ComputedPanel, ComputedWaypoint, Issue } from '../../engine/panel';
import type { Units } from '../../engine/units';
import type { MarkerActions } from '../markerActions';
import { editPanel } from '../edit';
import { len, signed, sts } from '../format';
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

// Panels for a particular kind of selection load the first time one is shown, keeping them out of the main chunk.
const WaypointProps = lazy(() => import('./WaypointProps').then((m) => ({ default: m.WaypointProps })));
const SegmentProps = lazy(() => import('./SegmentProps').then((m) => ({ default: m.SegmentProps })));
const NecklineProps = lazy(() => import('./NecklineProps').then((m) => ({ default: m.NecklineProps })));
const BustProps = lazy(() => import('./BustProps').then((m) => ({ default: m.BustProps })));
const LineProps = lazy(() => import('./LineProps').then((m) => ({ default: m.LineProps })));
const YokeProps = lazy(() => import('./YokeProps').then((m) => ({ default: m.YokeProps })));
const RaglanProps = lazy(() => import('./RaglanProps').then((m) => ({ default: m.RaglanProps })));
const RectangleSize = lazy(() => import('./RectangleSize').then((m) => ({ default: m.RectangleSize })));

/** Shown in place of a property panel while its code loads. */
export function PropsLoading() {
  return <p className="muted pad">Loading…</p>;
}

export function Properties({ ctx, selection }: { ctx: PropsContext; selection: Selection }) {
  return (
    <Suspense fallback={<PropsLoading />}>
      <SelectionProps ctx={ctx} selection={selection} />
    </Suspense>
  );
}

function SelectionProps({ ctx, selection }: { ctx: PropsContext; selection: Selection }) {
  if (ctx.panel.yoke) return ctx.panel.yoke.style === 'raglan' ? <RaglanProps ctx={ctx} /> : <YokeProps ctx={ctx} />;
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
    case 'line':
      return ctx.panel.shapingLines?.some((l) => l.id === selection.id) ? <LineProps ctx={ctx} id={selection.id} /> : <PanelProps ctx={ctx} />;
    default:
      return <PanelProps ctx={ctx} />;
  }
}

// ---------- panel ----------

/** A cardigan front: which half it is, its partner, and linking. */
function FrontPairProps({ ctx }: { ctx: PropsContext }) {
  const { panel, project, update } = ctx;
  const half = panel.half!;
  const partner = frontPartner(project, panel);
  const candidates = project.panels.filter((x) => x.half && x.half.side !== half.side && x.id !== panel.id);
  return (
    <div className="front-pair">
      <p className="hint">
        {half.side === 'left' ? 'Left' : 'Right'} front of a cardigan (seen from the RS, its front edge is on the {half.side === 'left' ? 'left' : 'right'}).
        Widths describe the whole front, as if closed at centre front; this panel is its half.
      </p>
      {partner ? (
        <p className="pair-status">
          Mirrored with <b>{partner.name}</b>: edits to either are copied to the other.{' '}
          <button className="link" onClick={() => update((p) => unlinkFronts(p, panel.id))}>Unlink</button>
        </p>
      ) : (
        <div className="field">
          <label>Not linked: mirror with…</label>
          <select value="" onChange={(e) => e.target.value && update((p) => linkFronts(p, panel.id, e.target.value))}>
            <option value="">—</option>
            {candidates.map((x) => <option key={x.id} value={x.id}>{x.name} (copies this front onto it)</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

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
      {panel.half && <FrontPairProps ctx={ctx} />}
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
            disabled={!!panel.half}
            title={panel.half ? 'Cardigan fronts are worked flat' : undefined}
            value={panel.half ? 'flat' : panel.inTheRound ? 'round' : panel.joinAt && panel.waypoints.some((w) => w.id === panel.joinAt) ? `join:${panel.joinAt}` : 'flat'}
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
      {panel.half ? (
        <div className="row3">
          <div className="field">
            <label>Side selvedge</label>
            <select value={panel.half.side === 'left' ? panel.selvedge.right : panel.selvedge.left} onChange={(e) => set((p) => void (p.selvedge = { left: Number(e.target.value), right: Number(e.target.value) }))}>
              {[0, 1, 2].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Front-edge selvedge</label>
            <select value={panel.half.cfSelvedge} onChange={(e) => set((p) => void (p.half = { ...p.half!, cfSelvedge: Number(e.target.value) }))}>
              {[0, 1, 2].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Shaping inset</label>
            <input className="num" type="number" min={0} value={panel.shapingInset} onChange={(e) => set((p) => void (p.shapingInset = Math.max(0, Number(e.target.value))), `panel.${panel.id}.inset`)} />
          </div>
        </div>
      ) : (
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
      )}
      <div className="row3">
        <div className="field">
          <label>Stitch count</label>
          <select
            value={panel.rounding.parity}
            disabled={!!panel.half}
            title={panel.half ? 'Each front is rounded on its own (to the pattern multiple); the whole front is always even' : undefined}
            onChange={(e) => set((p) => void (p.rounding.parity = e.target.value as Panel['rounding']['parity']))}
          >
            <option value="any">Any</option>
            <option value="even">Even</option>
            <option value="odd">Odd</option>
            <option value="start">Same as the first row</option>
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

      {panel.template === 'rectangle' && panel.waypoints.length === 2 && panel.waypoints.every((w) => w.symmetric) && !panel.half && (
        <Suspense fallback={<PropsLoading />}>
          <RectangleSize key={panel.id} ctx={ctx} />
        </Suspense>
      )}

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
              p.neckline = { shape: 'round', width: dim('back_neck_width'), depth: dim('back_neck_drop'), centre: 'bindoff', centreWidth: dim('back_neck_width - 2'), side: 'rs' };
            });
            ctx.select({ kind: 'neckline' });
          }}
        >
          + Add neckline
        </button>
      )}

      <div className="field">
        <label>Linked panel</label>
        <select value={panel.linkedTo ?? ''} onChange={(e) => update((p) => linkPanels(p, panel.id, e.target.value || null))}>
          <option value="">None</option>
          {ctx.project.panels.filter((x) => x.id !== panel.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <div className="hint">Dragging a waypoint here moves the same-named one on the linked panel by the same amount (e.g. back ↔ front).</div>
      </div>

      <TagEdge ctx={ctx} edge={{ kind: 'bottom' }} label="lower edge" />
      <TagEdge ctx={ctx} edge={{ kind: 'top' }} label="upper edge" />

      <h4>Shaping lines</h4>
      {(panel.shapingLines ?? []).length > 0 && (
        <ul className="plain-list">
          {panel.shapingLines!.map((l) => {
            const cl = c.lines.find((x) => x.id === l.id);
            return (
              <li key={l.id}>
                <button className="link" onClick={() => ctx.select({ kind: 'line', id: l.id })}>
                  {l.name}
                </button>{' '}
                <span className="muted small">
                  {l.kind === 'fisheye' ? 'fisheye' : 'one way'} · {cl ? `${signed(cl.amount)} sts` : '–'}
                  {l.mirror ? ' ×2' : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <select
        value=""
        style={{ width: '100%' }}
        onChange={(e) => {
          const preset = linePresets(panel)[Number(e.target.value)];
          if (!preset) return;
          const line = preset.make();
          set((p) => void (p.shapingLines = [...(p.shapingLines ?? []), line]));
          ctx.select({ kind: 'line', id: line.id });
        }}
      >
        <option value="">+ Add shaping line…</option>
        {linePresets(panel).map((p, i) => <option key={i} value={i}>{p.label}</option>)}
      </select>
      <p className="hint">Or draw one on the schematic with ✎ Line.</p>

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

export function uniqueName(panel: Panel, base: string): string {
  const names = new Set(panel.waypoints.map((w) => w.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base}_${i}`)) return `${base}_${i}`;
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
