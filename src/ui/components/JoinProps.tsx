import { useMemo } from 'react';
import { cachedPanel, edgeLabel, JOIN_TAGS, joinRatio, joinReport, type PanelCache, type SideTotal } from '../../engine/joins';
import type { EdgeKey, EdgeRef, Id, Join, JoinTag, Project } from '../../engine/model';
import type { Units } from '../../engine/units';
import { produce } from '../edit';
import { len, signed } from '../format';

interface Props {
  project: Project;
  joinId: Id;
  sizeId: Id;
  units: Units;
  update: (fn: (p: Project) => Project, key?: string | null) => void;
  onDone: () => void;
}

function editJoin(p: Project, id: Id, fn: (j: Join) => void): Project {
  return produce(p, (d) => {
    const j = d.joins?.find((x) => x.id === id);
    if (j) fn(j);
  });
}

export function JoinProps({ project, joinId, sizeId, units, update, onDone }: Props) {
  const join = project.joins?.find((j) => j.id === joinId);
  const cache: PanelCache = useMemo(() => new Map(), [project, sizeId]);
  const report = useMemo(() => (join ? joinReport(project, join, sizeId, cache) : null), [project, join, sizeId, cache]);
  if (!join || !report) return <p className="muted pad">This join no longer exists.</p>;
  const set = (fn: (j: Join) => void, key: string | null = null) => update((p) => editJoin(p, join.id, fn), key);
  const sizeName = project.sizes.find((s) => s.id === sizeId)?.name ?? '';
  const ratio = joinRatio(project, join);

  return (
    <div className="props">
      <h3>Join</h3>
      <div className="row2">
        <div className="field">
          <label>Name</label>
          <input value={join.name} onChange={(e) => set((j) => void (j.name = e.target.value), `join.${join.id}.name`)} />
        </div>
        <div className="field">
          <label>Tag</label>
          <select value={join.tag} onChange={(e) => set((j) => void (j.tag = e.target.value as JoinTag))}>
            {Object.entries(JOIN_TAGS).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          </select>
        </div>
      </div>

      <h4>{join.tag === 'seam' ? 'This side' : 'Edges'}</h4>
      <EdgeList project={project} refs={join.edges} onChange={(refs) => set((j) => void (j.edges = refs))} />
      {join.tag === 'seam' && (
        <>
          <h4>Sewn to</h4>
          <EdgeList project={project} refs={join.partner} onChange={(refs) => set((j) => void (j.partner = refs))} />
        </>
      )}

      {join.tag === 'pickup' && (
        <div className="field">
          <label>Pick-up ratio (along rows)</label>
          <span className="inline">
            <input className="num tiny" type="number" min={1} value={ratio.stitches} onChange={(e) => set((j) => void (j.ratio = { ...ratio, stitches: Math.max(1, Number(e.target.value)) }), `join.${join.id}.rs`)} />
            <span className="muted">sts per</span>
            <input className="num tiny" type="number" min={1} value={ratio.rows} onChange={(e) => set((j) => void (j.ratio = { ...ratio, rows: Math.max(1, Number(e.target.value)) }), `join.${join.id}.rr`)} />
            <span className="muted">rows</span>
            {join.ratio && <button className="link" onClick={() => set((j) => void (j.ratio = null))}>use default</button>}
          </span>
          <div className="hint">Bound-off, cast-on and held stitches count 1 for 1.</div>
        </div>
      )}

      <h4>In {sizeName}</h4>
      <SideTable title={join.tag === 'seam' ? 'This side' : undefined} side={report.a} units={units} pickup={join.tag === 'pickup'} />
      {report.b && <SideTable title="Sewn to" side={report.b} units={units} pickup={false} />}
      {report.b && report.a.ok && report.b.ok && (
        <p className={report.withinTolerance ? 'small' : 'small err'}>
          Difference: {signed(report.diffRows)} rows, {signed(Math.round(report.diffCm * 10) / 10)} cm {report.withinTolerance ? `(within ${project.settings.seamToleranceCm} cm)` : `(more than the ${project.settings.seamToleranceCm} cm tolerance)`}
        </p>
      )}
      {report.suggestion && <p className="notice-inline small">{report.suggestion}</p>}
      {join.tag === 'pickup' && report.a.ok && (
        <p className="small">
          Pick up <strong>{report.a.pickup} sts</strong>
          {report.multiples.map((m) => ` · multiple of ${m.multiple}: ${m.value}`).join('')}
        </p>
      )}

      {(join.tag === 'seam' || join.tag === 'pickup') && <AllSizes project={project} join={join} sizeId={sizeId} />}

      <div className="field">
        <label>Note</label>
        <textarea rows={3} value={join.note} placeholder="e.g. mattress stitch; ease the cap top" onChange={(e) => set((j) => void (j.note = e.target.value), `join.${join.id}.note`)} />
      </div>
      <p className="hint">Joins are annotations: the app never changes the knitting to make them fit.</p>
      <div className="actions">
        <button
          className="danger"
          onClick={() => {
            update((p) => produce(p, (d) => void (d.joins = (d.joins ?? []).filter((x) => x.id !== join.id))));
            onDone();
          }}
        >
          Delete join
        </button>
      </div>
    </div>
  );
}

function SideTable({ title, side, units, pickup }: { title?: string; side: SideTotal; units: Units; pickup: boolean }) {
  if (!side.measures.length) return <p className="muted small">No edges yet.</p>;
  return (
    <table className="events join-table">
      <thead>
        <tr><th>{title ?? 'Edge'}</th><th>Rows</th><th>Length</th>{pickup && <th>Pick up</th>}</tr>
      </thead>
      <tbody>
        {side.measures.map((m, i) => (
          <tr key={i}>
            <td title={m.parts.join(', ')}>{m.label}{!m.ok && <div className="err small">{m.error}</div>}</td>
            <td>{m.ok ? m.rows : '—'}</td>
            <td>{m.ok ? len(m.lengthCm, units) : '—'}</td>
            {pickup && <td>{m.ok ? m.pickup : '—'}</td>}
          </tr>
        ))}
        {side.measures.length > 1 && (
          <tr className="total">
            <td>Total</td>
            <td>{side.rows}</td>
            <td>{len(side.lengthCm, units)}</td>
            {pickup && <td>{side.pickup}</td>}
          </tr>
        )}
      </tbody>
    </table>
  );
}

function AllSizes({ project, join, sizeId }: { project: Project; join: Join; sizeId: Id }) {
  const rows = useMemo(() => {
    const cache: PanelCache = new Map();
    return project.sizes.map((s) => ({ s, r: joinReport(project, join, s.id, cache) }));
  }, [project, join]);
  return (
    <>
      <h4>All sizes</h4>
      <table className="events size-table">
        <thead>
          {join.tag === 'seam' ? (
            <tr><th>Size</th><th>This side</th><th>Sewn to</th><th>Δ rows</th><th>Δ cm</th></tr>
          ) : (
            <tr><th>Size</th><th>Pick up</th><th>×2</th><th>×4</th></tr>
          )}
        </thead>
        <tbody>
          {rows.map(({ s, r }) => (
            <tr key={s.id} className={s.id === sizeId ? 'selected' : ''}>
              <td>{s.name}</td>
              {join.tag === 'seam' ? (
                <>
                  <td>{r.a.rows} r · {r.a.lengthCm.toFixed(1)}</td>
                  <td>{r.b ? `${r.b.rows} r · ${r.b.lengthCm.toFixed(1)}` : '—'}</td>
                  <td>{signed(r.diffRows)}</td>
                  <td className={r.withinTolerance ? '' : 'err'}>{signed(Math.round(r.diffCm * 10) / 10)}</td>
                </>
              ) : (
                <>
                  <td>{r.a.pickup}</td>
                  <td>{r.multiples[0]?.value}</td>
                  <td>{r.multiples[1]?.value}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const EDGE_KINDS: { value: string; label: string }[] = [
  { value: 'left', label: 'Left edge' },
  { value: 'right', label: 'Right edge' },
  { value: 'bottom', label: 'Lower edge' },
  { value: 'top', label: 'Upper edge' },
  { value: 'neck', label: 'Neckline' },
];

/** Edit a list of edges: panel, which edge, and for side edges the waypoint range. */
function EdgeList({ project, refs, onChange }: { project: Project; refs: EdgeRef[]; onChange: (refs: EdgeRef[]) => void }) {
  const setAt = (i: number, r: EdgeRef) => onChange(refs.map((x, k) => (k === i ? r : x)));
  const defaultEdge = (panelId: Id, kind: string): EdgeKey => {
    const panel = project.panels.find((p) => p.id === panelId);
    const wps = panel?.waypoints ?? [];
    if (kind === 'left' || kind === 'right') return { kind: 'side', side: kind, from: wps[0]?.id ?? '', to: wps[1]?.id ?? '' };
    return { kind: kind as 'bottom' | 'top' | 'neck' };
  };
  return (
    <div className="edge-list">
      {refs.map((r, i) => {
        const panel = project.panels.find((p) => p.id === r.panelId);
        const kind = r.edge.kind === 'side' ? r.edge.side : r.edge.kind;
        return (
          <div key={i} className="edge-row">
            <select value={r.panelId} onChange={(e) => setAt(i, { panelId: e.target.value, edge: defaultEdge(e.target.value, kind) })}>
              {!panel && <option value={r.panelId}>(deleted panel)</option>}
              {project.panels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={kind} onChange={(e) => setAt(i, { panelId: r.panelId, edge: defaultEdge(r.panelId, e.target.value) })}>
              {EDGE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            {r.edge.kind === 'side' && panel && (
              <span className="inline">
                <select value={r.edge.from} onChange={(e) => r.edge.kind === 'side' && setAt(i, { ...r, edge: { ...r.edge, from: e.target.value } })}>
                  {panel.waypoints.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <span className="muted">→</span>
                <select value={r.edge.to} onChange={(e) => r.edge.kind === 'side' && setAt(i, { ...r, edge: { ...r.edge, to: e.target.value } })}>
                  {panel.waypoints.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </span>
            )}
            <button className="icon" title="Remove edge" onClick={() => onChange(refs.filter((_, k) => k !== i))}>×</button>
          </div>
        );
      })}
      <button
        onClick={() => {
          const panel = project.panels[0];
          if (panel) onChange([...refs, { panelId: panel.id, edge: defaultEdge(panel.id, 'left') }]);
        }}
        disabled={!project.panels.length}
      >
        + Add edge
      </button>
    </div>
  );
}

/** Used by panels to show which joins touch them. */
export function joinSummary(project: Project, join: Join, sizeId: Id, cache: PanelCache): string {
  const r = joinReport(project, join, sizeId, cache);
  if (join.tag === 'seam') return r.b ? `Δ ${signed(Math.round(r.diffCm * 10) / 10)} cm` : 'one side';
  if (join.tag === 'pickup') return `${r.a.pickup} sts`;
  return `${join.edges.length} edge${join.edges.length === 1 ? '' : 's'}`;
}

export { cachedPanel, edgeLabel };
