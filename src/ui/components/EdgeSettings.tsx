import { lazy, Suspense } from 'react';
import { addStrips, applyEdgeTreatments, EDGE_STITCHES, EDGE_TREATMENTS, edgePattern, edgesOf, missingStrips, neckbandWithPanelAllowed } from '../../engine/edgeTreatments';
import { buildScope } from '../../engine/measurements';
import type { EdgeStitch, EdgeTreatment, EdgeTreatmentId, Id, Project } from '../../engine/model';
import { ExprField } from './ExprField';
import { PropsLoading } from './Properties';

// Front-band settings (buttons, attachment) load the first time a cardigan's bands are shown.
const BandSettings = lazy(() => import('./BandSettings').then((m) => ({ default: m.BandSettings })));
// An off-shoulder band's type (single or folded) loads with the first off-shoulder neckband knit with the yoke.
const NeckbandFold = lazy(() => import('./NeckbandFold').then((m) => ({ default: m.NeckbandFold })));

interface Props {
  project: Project;
  sizeId: Id;
  update: (fn: (p: Project) => Project, key?: string | null) => void;
}

/** Project → Edges: hem and cuff ribbing, neckband and (cardigans) front bands, applied to the panels as you change them. */
export function EdgeSettings({ project, sizeId, update }: Props) {
  const edges = edgesOf(project);
  const scope = buildScope(project, sizeId);
  const sizeName = project.sizes.find((s) => s.id === sizeId)?.name ?? '';
  const set = (id: EdgeTreatmentId, t: EdgeTreatment, key: string | null = null) =>
    update((p) => applyEdgeTreatments({ ...p, edges: { ...edgesOf(p), [id]: t } }), key);
  const missing = missingStrips({ ...project, edges: edges });
  const shown = EDGE_TREATMENTS.filter((d) => d.id !== 'frontBands' || project.garment.opening === 'cardigan');
  // Only an off-shoulder band can be knit with the panels (first, with the yoke).
  const nbWithPanel = neckbandWithPanelAllowed(project);

  return (
    <>
      <h4>Edges</h4>
      {!project.edges && <p className="hint">Not applied yet: changing any of these applies them to the panels you have (it never adds or removes panels).</p>}
      {missing.length > 0 && (
        <div className="strips-missing">
          <span className="hint">Not made yet: {missing.join(', ')}.</span>{' '}
          <button onClick={() => update((p) => addStrips({ ...p, edges: edgesOf(p) }))}>Add {missing.length === 1 ? 'strip' : 'strips'}</button>
        </div>
      )}
      {shown.map((d) => {
        const t = edges[d.id];
        const p = edgePattern(t);
        // An off-shoulder band knit with the yoke can be folded (stockinette, no stitch to choose).
        const yokeBand = d.id === 'neckband' && nbWithPanel && t.method === 'with-panel';
        const folded = yokeBand && !!t.fold;
        return (
          <div key={d.id} className={`edge-treatment${t.enabled ? '' : ' off'}`}>
            <label className="check">
              <input type="checkbox" checked={t.enabled} onChange={(e) => set(d.id, { ...t, enabled: e.target.checked })} />
              {d.label}
            </label>
            {d.id === 'neckband' && nbWithPanel && !t.enabled && <p className="hint">Off-shoulder with no band: the yoke’s ring is cast on as the top edge.</p>}
            {t.enabled && (
              <>
                <ExprField
                  label={`${d.depthLabel}${folded ? ', finished' : ''} (cm)`}
                  value={t.depth}
                  sizeId={sizeId}
                  sizeName={sizeName}
                  scope={scope}
                  units={project.units}
                  fieldKey={`edges.${d.id}.depth`}
                  onChange={(depth, key) => set(d.id, { ...t, depth }, key)}
                />
                {yokeBand && (
                  <Suspense fallback={<PropsLoading />}>
                    <NeckbandFold project={project} update={update} />
                  </Suspense>
                )}
                {!folded && (
                <div className="row2">
                  <div className="field">
                    <label>Stitch</label>
                    <select value={t.stitch} onChange={(e) => set(d.id, { ...t, stitch: e.target.value as EdgeStitch })}>
                      {Object.entries(EDGE_STITCHES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      <option value="custom">Custom multiple</option>
                    </select>
                  </div>
                  {t.stitch === 'custom' ? (
                    <div className="field">
                      <label>Multiple + offset</label>
                      <span className="inline">
                        <input className="num tiny" type="number" min={1} value={t.custom.multiple} onChange={(e) => set(d.id, { ...t, custom: { ...t.custom, multiple: Math.max(1, Math.round(Number(e.target.value))) } }, `edges.${d.id}.mult`)} />
                        <span className="muted">+</span>
                        <input className="num tiny" type="number" min={0} value={t.custom.offset} onChange={(e) => set(d.id, { ...t, custom: { ...t.custom, offset: Math.max(0, Math.round(Number(e.target.value))) } }, `edges.${d.id}.off`)} />
                      </span>
                    </div>
                  ) : (
                    <div className="field">
                      <label>Rounds to</label>
                      <span className="muted small">{p.multiple === 1 ? 'any count' : `${p.multiple}n${p.offset ? ` + ${p.offset}` : ''} sts`}</span>
                    </div>
                  )}
                </div>
                )}
                {d.id === 'frontBands' ? (
                  <Suspense fallback={<PropsLoading />}>
                    <BandSettings project={project} sizeId={sizeId} update={update} />
                  </Suspense>
                ) : (
                <div className="field">
                  <label>Worked</label>
                  <select value={d.id === 'neckband' && !nbWithPanel ? 'later' : t.method} onChange={(e) => set(d.id, { ...t, method: e.target.value as EdgeTreatment['method'] })}>
                    <option value="with-panel" disabled={d.id === 'neckband' && !nbWithPanel}>{d.withPanel}</option>
                    <option value="later">{d.later}</option>
                  </select>
                </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}
