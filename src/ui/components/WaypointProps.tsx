// Properties for a selected waypoint: its position, rounding and partner matching. Loaded on first use.

import type { DimExpr, Waypoint } from '../../engine/model';
import { dim, newWaypoint } from '../../engine/model';
import { matchPartner, partnerWaypoint } from '../../engine/waypointDrag';
import type { RoundingResult } from '../../engine/rounding';
import { editPanel, editWaypoint } from '../edit';
import { fmtNum, len, signed, sts } from '../format';
import { ExprField } from './ExprField';
import { IssueList, uniqueName, type PropsContext } from './Properties';

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

/** "Match" buttons: line the linked panel's same-named waypoint up with this one. */
function PartnerMatch({ ctx, wp }: { ctx: PropsContext; wp: Waypoint }) {
  const pw = partnerWaypoint(ctx.project, ctx.panel, wp.id);
  if (!ctx.panel.linkedTo) return null;
  const partner = ctx.project.panels.find((p) => p.id === ctx.panel.linkedTo);
  if (!pw) return <p className="hint">{partner?.name ?? 'The linked panel'} has no waypoint called “{wp.name}”, so it doesn't follow this one.</p>;
  const match = (what: { height: boolean; width: boolean }) => ctx.update((p) => matchPartner(p, ctx.panel.id, wp.id, ctx.sizeId, what));
  return (
    <div className="button-row">
      <span className="muted small">Make {pw.partner.name}’s {wp.name} match this one:</span>
      <button onClick={() => match({ height: true, width: false })}>height</button>
      <button onClick={() => match({ height: false, width: true })}>width</button>
      <button onClick={() => match({ height: true, width: true })}>both</button>
    </div>
  );
}

export function WaypointProps({ ctx, wp }: { ctx: PropsContext; wp: Waypoint }) {
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
      <p className="hint">Drag its line on the schematic to move it, its end squares to change the width: every size follows proportionally (Alt: this size only).</p>
      <PartnerMatch ctx={ctx} wp={wp} />
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
        <ExprField
          label={ctx.panel.half ? 'Width of the whole front (both fronts)' : 'Width'}
          value={wp.width}
          onChange={setDim('width')}
          fieldKey="width"
          {...common}
          detail={cw && <>→ {sts(cw.stitches)}{ctx.panel.half ? ' this front' : ''}</>}
        />
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
