import { setRegionSize } from '../../engine/grading';
import type { Id, Project } from '../../engine/model';
import { REGIONS, regionSources } from '../../engine/regions';
import { sizeText } from './EstMark';

interface Props {
  project: Project;
  sizeId: Id;
  update: (fn: (p: Project) => Project, key?: string | null) => void;
}

/** Region sizing: which size the upper body, lower body and sleeves of the current size take their measurements from. */
export function RegionPickers({ project, sizeId, update }: Props) {
  const src = regionSources(project, sizeId);
  const self = project.sizes.find((s) => s.id === sizeId);
  if (!self) return null;
  return (
    <div className="region-pickers" title="Region sizing for this size: each body region can take its measurements from another size">
      {REGIONS.map((r) => (
        <label key={r.id} className={src[r.id] !== sizeId ? 'mixed' : ''}>
          {r.label}
          <select value={src[r.id]} onChange={(e) => update((p) => setRegionSize(p, sizeId, r.id, e.target.value))}>
            {project.sizes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id === sizeId ? `${s.name} (this size)` : sizeText(s)}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
