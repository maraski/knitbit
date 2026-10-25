import { applyEdgeTreatments, defaultFold, edgesOf } from '../../engine/edgeTreatments';
import type { EdgeTreatment, Project } from '../../engine/model';

type Fold = NonNullable<EdgeTreatment['fold']>;

const FOLD_TURNS: { id: Fold['turn']; label: string }[] = [
  { id: 'purl', label: 'Purl round (a crisp fold)' },
  { id: 'picot', label: 'Picot: yo, k2tog (a scalloped edge)' },
];
const FOLD_CLOSINGS: { id: Fold['close']; label: string }[] = [
  { id: 'knit', label: 'Knit closed: each stitch together with its cast-on loop' },
  { id: 'sewn', label: 'Sewn down afterwards' },
];

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project, key?: string | null) => void;
}

/** An off-shoulder band's type (none, single in the Neckband's stitch, or folded) and a folded band's turning round and
 * closing. Shown with the Neckband edge (Garment tab) and in the yoke's properties; loaded only for off-shoulder. */
export function NeckbandFold({ project, update }: Props) {
  const nb = edgesOf(project).neckband;
  // Any band is knit with the yoke; none = the Neckband switched off (the ring is the cast-on).
  const set = (fold: EdgeTreatment['fold'], enabled = true) =>
    update((p) => {
      const { fold: _, ...rest } = edgesOf(p).neckband;
      return applyEdgeTreatments({ ...p, edges: { ...edgesOf(p), neckband: { ...rest, enabled, ...(enabled ? { method: 'with-panel' as const } : {}), ...(fold ? { fold } : {}) } } });
    });
  const fold = nb.enabled ? nb.fold : undefined;
  const kind = !nb.enabled ? 'none' : fold ? 'folded' : 'single';
  return (
    <>
      <div className="field">
        <label>Band</label>
        <select value={kind} onChange={(e) => set(e.target.value === 'folded' ? defaultFold() : undefined, e.target.value !== 'none')}>
          <option value="none">None: the ring is cast on as the top edge</option>
          <option value="single">Single, in the Neckband stitch (rib, garter, seed…)</option>
          <option value="folded">Folded: stockinette, knit twice the depth</option>
        </select>
      </div>
      {!nb.enabled && <p className="hint">No band: the yoke starts with the ring’s cast-on, and only the ring ease holds it up. The Neckband edge is switched off.</p>}
      {fold && (
        <>
          <div className="row2">
            <div className="field">
              <label>Turning round</label>
              <select value={fold.turn} onChange={(e) => set({ ...fold, turn: e.target.value as typeof fold.turn })}>
                {FOLD_TURNS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Closed</label>
              <select value={fold.close} onChange={(e) => set({ ...fold, close: e.target.value as typeof fold.close })}>
                {FOLD_CLOSINGS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <p className="hint">
            The depth is the finished band: the facing (folded inside) and the outside are each that deep, with the turning round between as the top edge. It still grips by
            its band ease.
          </p>
        </>
      )}
    </>
  );
}
