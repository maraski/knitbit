// The key box of both yoke views (seen from above and laid flat): the cast-on, the band, the phases' last rows, the
// short rows or front neck, and the split.

import { buildScope } from '../../engine/measurements';
import type { Project } from '../../engine/model';
import type { ComputedPanel } from '../../engine/panel';
import type { Units } from '../../engine/units';
import { len } from '../format';

/** `fold`: a folded band is drawn folded inside; `front`: the laid-flat view (lines, not rings). */
export function YokeKey({ project, computed: c, units, fold, front = false }: { project: Project; computed: ComputedPanel; units: Units; fold: boolean; front?: boolean }) {
  const y = c.yoke!;
  return (
    <div className="yoke-key">
      {y.offShoulder?.noBand ? (
        <>
          <div>
            No band: the ring cast on all round, <b>{y.offShoulder.ringSts}</b> ({len(y.offShoulder.ringSts / y.stitchesPerCm, units)}): front {y.offShoulder.ringZones.leftFront} · sleeve {y.offShoulder.ringZones.leftSleeve} · back {y.offShoulder.ringZones.back} · sleeve {y.offShoulder.ringZones.rightSleeve} · front {y.offShoulder.ringZones.rightFront}
          </div>
          <div>
            Top edge {len(buildScope(project, c.sizeId).off_shoulder_drop ?? 0, units)} below the shoulder point · raglan lines {y.seamSts} sts · about {len(y.raglan!.lineCm, units)} · increases to row {y.counts.total - y.counts.E}
          </div>
        </>
      ) : y.offShoulder ? (
        <>
          <div>
            Band: cast on <b>{y.offShoulder.bandSts}</b> all round ({len(y.offShoulder.bandSts / y.stitchesPerCm, units)}) ·{' '}
            {y.offShoulder.fold
              ? `folded stockinette · facing rows 1–${y.offShoulder.fold.depthRows}${fold ? ' (drawn folded inside)' : ''}, ${y.offShoulder.fold.turn} turning round row ${y.offShoulder.fold.depthRows + 1}, outside to row ${y.offShoulder.bandRows}${y.offShoulder.fold.close === 'knit' ? ' (joined to the cast-on)' : ', facing sewn down'} · ${len(y.offShoulder.bandCm, units)} finished`
              : `${y.offShoulder.pattern.name} · rows 1–${y.offShoulder.bandRows} (${len(y.offShoulder.bandCm, units)})`}
          </div>
          <div>
            Increase round, row {y.offShoulder.incRow}: to the ring, <b>{y.offShoulder.ringSts}</b> ({len(y.offShoulder.ringSts / y.stitchesPerCm, units)}): front {y.offShoulder.ringZones.leftFront} · sleeve {y.offShoulder.ringZones.leftSleeve} · back {y.offShoulder.ringZones.back} · sleeve {y.offShoulder.ringZones.rightSleeve} · front {y.offShoulder.ringZones.rightFront}
          </div>
          <div>
            Band’s top edge {len(buildScope(project, c.sizeId).off_shoulder_drop ?? 0, units)} below the shoulder point · raglan lines {y.seamSts} sts · about {len(y.raglan!.lineCm, units)} · increases to row {y.counts.total - y.counts.E}
          </div>
        </>
      ) : y.raglan ? (
        <>
          <div>
            Cast on <b>{y.castOn}</b> round the {y.shortRows ? 'whole' : 'back'} neck: front {y.castOnZones.leftFront} · sleeve {y.castOnZones.leftSleeve} · back neck {y.castOnZones.back} ({len(y.castOnZones.back / y.stitchesPerCm, units)}) · sleeve {y.castOnZones.rightSleeve} · front {y.castOnZones.rightFront}
          </div>
          <div>
            Raglan lines {y.seamSts} sts · about {len(y.raglan.lineCm, units)} · increases to row {y.counts.total - y.counts.E}
          </div>
        </>
      ) : (
        <>
          <div>
            Cast on <b>{y.castOn}</b> round the {y.shortRows ? 'whole' : 'back'} neck: front {y.castOnZones.leftFront} · seam {y.seamSts} · back neck {y.castOnZones.back} ({len(y.castOnZones.back / y.stitchesPerCm, units)}) · seam {y.seamSts} · front {y.castOnZones.rightFront}
          </div>
          <div>
            Shoulder seam <b>{y.counts.A}</b> rows · {len(y.derived.seamCm, units)}
          </div>
        </>
      )}
      {y.counts.C + y.counts.D > 0 && (
        <div>
          Cap <b>{y.counts.C + y.counts.D}</b> rows · {len((y.counts.C + y.counts.D) / y.rowsPerCm, units)}
        </div>
      )}
      <div className="key-rings">Dashed {front ? 'lines' : 'rings'}, from the {y.offShoulder ? (y.offShoulder.noBand ? 'cast-on' : 'band') : 'neck'} {front ? 'down' : 'out'}:</div>
      {y.offShoulder && !y.offShoulder.noBand && <div>end of the band · row {y.offShoulder.bandRows}; the increase round · row {y.offShoulder.incRow} · {y.offShoulder.ringSts} sts</div>}
      {y.phases
        .filter((ph) => ph.id === 'A' || ph.id === 'C' || ph.id === 'D' || (ph.id === 'R' && y.counts.E > 0))
        .map((ph) => (
          <div key={ph.id}>
            end of {ph.id} ({ph.label}) · row {ph.to} · {ph.stsAfter} sts
          </div>
        ))}
      {y.counts.neckRow !== null && y.counts.neckRow <= y.counts.total && (!y.offShoulder || !!y.shortRows?.pairs) && (
        <div>
          {y.shortRows
            ? `short rows${y.offShoulder ? ' (back raise)' : ''}: rows ${y.shortRows.fromRow ?? 1}–${y.counts.neckRow}${y.counts.joinRow !== null ? ', then rounds (start at the left back marker)' : ''}`
            : `${y.counts.joinRow ? 'neck joined in the round' : 'neck cast on at the front edges'} · row ${y.counts.neckRow}`}
        </div>
      )}
      <div>
        Split after row <b>{y.counts.total}</b>: sleeves {y.held.leftSleeve} sts on hold, body {y.held.body} + 2 × {y.underarmCo} cast on
      </div>
    </div>
  );
}
