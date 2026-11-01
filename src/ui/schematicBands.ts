// A cardigan front's band, buttons and buttonholes as the Schematic draws them (or a band strip's buttonholes). Shared
// by the Schematic tab (which adds dragging) and the PDF export.

import { bandOnFront } from '../engine/bands';
import { buttonPlan } from '../engine/buttons';
import { frontEdgeRows, type PanelCache } from '../engine/joins';
import type { Id, Panel, Project } from '../engine/model';
import type { ComputedPanel } from '../engine/panel';
import type { SchematicBands } from './components/Schematic';
import { len } from './format';

/** `scope`: the panel's resolved values (for `band_w`, `band_overlap`). Undefined for a piece without a band. */
export function schematicBands(project: Project, panel: Panel, computed: ComputedPanel, sizeId: Id, scope: Record<string, number>, cache: PanelCache = new Map()): SchematicBands | undefined {
  if (!computed.ok || (!panel.half && !panel.band)) return undefined;
  const plan = buttonPlan(project, sizeId, cache);
  const holes = (plan?.holes ?? []).filter((h) => h.panelId === panel.id).map((h) => ({ row: h.row, x: h.x, index: h.index }));
  if (panel.band) return { bandX: [0, 0], integrated: false, label: '', edgeRows: 0, buttons: [], kind: 'hole', holes, holeWidth: plan?.holeWidth ?? 2 };
  const half = computed.half!;
  const onFront = bandOnFront(project, panel.half!.side);
  const bandW = scope.band_w ?? 0;
  let bandX: [number, number] = [0, 0];
  if (onFront?.attach === 'integrated') {
    const sel = panel.half!.cfSelvedge;
    const start = half.keep === 'right' ? half.cfX + sel : half.cfX - sel - half.bandSts;
    bandX = [start, start + half.bandSts];
  } else if (onFront) {
    const w = bandW * computed.stitchesPerCm;
    bandX = half.keep === 'right' ? [half.cfX - w, half.cfX] : [half.cfX, half.cfX + w];
  }
  return {
    bandX,
    integrated: onFront?.attach === 'integrated',
    label: onFront ? `${onFront.attach === 'integrated' ? 'integrated ' : ''}band ${len(bandW, project.units)} · overlap ${len(scope.band_overlap ?? 0, project.units)}` : '',
    edgeRows: onFront ? frontEdgeRows(computed) : 0,
    buttons: plan?.positions ?? [],
    kind: plan?.holeFrontId === panel.id ? 'hole' : 'button',
    holes,
    holeWidth: plan?.holeWidth ?? 2,
  };
}
