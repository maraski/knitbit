// Checks for sleeves shorter than long: the cuff band against the sleeve's length, and the shaping between the cuff
// and the underarm (how fast it widens, and how much of it falls in the cuff rib). Called by projectChecks with the
// panels already computed for one size.

import { buildScope } from './measurements';
import type { Id, Panel, Project } from './model';
import type { ComputedPanel, Issue } from './panel';
import { SLEEVE_LENGTHS, sleeveLengthOf } from './sleeveLength';

export interface SleeveCheck {
  panelId: Id;
  panelName: string;
  issue: Issue;
}

const cm = (x: number) => `${(Math.round(x * 10) / 10).toFixed(1)} cm`;

export function sleeveChecks(project: Project, sizeId: Id, computed: { panel: Panel; c: ComputedPanel }[]): SleeveCheck[] {
  const out: SleeveCheck[] = [];
  const short = computed.filter(({ panel, c }) => c.ok && (panel.template ?? '').startsWith('sleeve') && !['long', 'cap'].includes(sleeveLengthOf(panel)));
  if (!short.length) return out;
  const band = buildScope(project, sizeId).cuff_depth ?? 0;
  for (const { panel, c } of short) {
    const push = (severity: Issue['severity'], message: string) => out.push({ panelId: panel.id, panelName: panel.name, issue: { severity, message, ref: { kind: 'panel' } } });
    const cuff = c.waypoints.find((w) => w.name === 'cuff');
    const top = c.waypoints.find((w) => w.name === 'underarm') ?? c.waypoints.find((w) => w.name === 'top');
    if (!cuff || !top) continue;
    const label = SLEEVE_LENGTHS.find((l) => l.id === sleeveLengthOf(panel))!.label.toLowerCase();
    const length = Math.abs(top.heightCm - cuff.heightCm);
    if (band >= length) push('warning', `The cuff band (${cm(band)}) is as long as the ${label} sleeve (${cm(length)}): shorten the cuff band (Garment → Edges) or lengthen the sleeve.`);
    else if (band >= length / 2) push('info', `The cuff band (${cm(band)}) is more than half of the ${label} sleeve (${cm(length)}); a shallower band (Garment → Edges) leaves more plain knitting.`);

    // Shaping between the cuff and the underarm.
    const seg = c.segments.find((s) => (s.fromWaypoint === cuff.id && s.toWaypoint === top.id) || (s.fromWaypoint === top.id && s.toWaypoint === cuff.id));
    if (!seg) continue;
    const perEdge = Math.max(Math.abs(seg.left.target), Math.abs(seg.right.target));
    const rows = seg.rowTo - seg.rowFrom + 1;
    if (perEdge > 0 && rows / perEdge < 2) push('info', `The ${label} sleeve changes by ${perEdge} sts each side in ${rows} rows, more often than every other row: a straighter sleeve (a wider cuff) is easier to knit.`);
    const rib = c.sections.find((s) => s.name === 'Cuff rib');
    if (rib && perEdge > 0) {
      const inRib = seg.left.events.filter((e) => e.row >= rib.fromRow && e.row <= rib.toRow).length;
      if (inRib) push('info', `${inRib} of the ${seg.left.events.length} shaping rows each side fall in the cuff rib (the first ${cm(band)} of the ${cm(length)} sleeve).`);
    }
  }
  return out;
}
