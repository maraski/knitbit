// Properties for a selected neckline. Loaded on first use.

import type { DimExpr, Panel } from '../../engine/model';
import { editPanel } from '../edit';
import { signed, sts } from '../format';
import { ExprField } from './ExprField';
import { IssueList, TagEdge, type PropsContext } from './Properties';

export function NecklineProps({ ctx }: { ctx: PropsContext }) {
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
