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

/** An off-shoulder band's type (single, in the Neckband's stitch, or folded) and a folded band's turning round and
 * closing. Shown with the Neckband edge (Garment tab) and in the yoke's properties; loaded only for off-shoulder. */
export function NeckbandFold({ project, update }: Props) {
  const nb = edgesOf(project).neckband;
  const set = (fold: EdgeTreatment['fold']) =>
    update((p) => {
      const { fold: _, ...rest } = edgesOf(p).neckband;
      return applyEdgeTreatments({ ...p, edges: { ...edgesOf(p), neckband: fold ? { ...rest, fold } : rest } });
    });
  const fold = nb.fold;
  return (
    <>
      <div className="field">
        <label>Band</label>
        <select value={fold ? 'folded' : 'single'} onChange={(e) => set(e.target.value === 'folded' ? defaultFold() : undefined)}>
          <option value="single">Single, in the Neckband stitch (rib)</option>
          <option value="folded">Folded: stockinette, knit twice the depth</option>
        </select>
      </div>
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
