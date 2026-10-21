// A contiguous yoke's stitch chart: zone colours, marker lines, increase symbols, per-zone counts and a phase column.
// Part of the chart code, kept apart from yokePanel.ts so the schematic doesn't load it.

import type { Chart, ChartRow } from './chart';
import { cellInfo, PLAIN } from './chart';
import { ZONES } from './contiguous';
import type { Panel, Project } from './model';
import type { ComputedPanel } from './panel';
import { zoneStarts } from './yokePanel';

export function buildYokeChart(project: Project, panel: Panel, c: ComputedPanel): Chart {
  const y = c.yoke!;
  const cols = Math.max(0, ...c.counts);
  const x0 = -cols / 2;
  const rows: ChartRow[] = [];
  const zoneRuns: Chart['zoneRuns'] = {};
  const markerCols: Chart['markerCols'] = {};
  const zoneCounts: Chart['zoneCounts'] = {};
  for (const yr of y.rows) {
    const cells = new Array<string>(cols).fill('');
    const starts = zoneStarts(yr, x0);
    // A short row works only its span; the rest of the row stays blank.
    const [from, to] = yr.span ?? [0, yr.total];
    for (let k = starts[0] + from; k < starts[0] + to; k++) if (k >= 0 && k < cols) cells[k] = PLAIN;
    for (const inc of yr.incs) {
      const k = starts[ZONES.indexOf(inc.zone)] + inc.at;
      if (k >= 0 && k < cols) cells[k] = inc.symbol;
    }
    for (const co of yr.castOns) {
      const zi = ZONES.indexOf(co.zone);
      if (co.where === 'centre-front') {
        // Cast on at the end of the row and joined: drawn at both ends (half each), where the round closes.
        const half = Math.floor(co.count / 2);
        for (let j = 0; j < half; j++) cells[starts[0] + j] = 'co';
        for (let j = 0; j < co.count - half; j++) cells[starts[5] - 1 - j] = 'co';
      } else if (co.zone === 'rightFront') for (let j = 0; j < co.count; j++) cells[starts[zi + 1] - 1 - j] = 'co';
      else for (let j = 0; j < co.count; j++) cells[starts[zi] + j] = 'co';
    }
    if (yr.turn) {
      const k = starts[0] + yr.turn.at;
      if (k >= 0 && k < cols && cells[k] === PLAIN) cells[k] = 'turn-german';
    }
    const key = String(yr.row);
    zoneRuns[key] = ZONES.map((_, zi) => ({ from: starts[zi], to: starts[zi + 1], zone: zi }));
    markerCols[key] = starts.slice(1, 5);
    zoneCounts[key] = ZONES.map((z) => yr.zones[z]);
    rows.push({
      key,
      knitRow: yr.row,
      label: key,
      shortRow: null,
      round: yr.round,
      rs: yr.rs,
      rtl: yr.rs,
      cells,
      refs: {},
      free: {},
      worked: yr.total,
      count: yr.total,
    });
  }
  const phases: NonNullable<Chart['phases']> = y.phases.filter((p) => p.id !== 'B' && p.id !== 'neck').map((p) => ({ label: `${p.id} · ${p.label}`, fromRow: p.from, toRow: p.to }));
  const used = new Set<string>([PLAIN, 'marker']);
  for (const r of rows) for (const v of r.cells) if (v) used.add(v);
  const legend = [...used].map((id) => cellInfo(id, project.symbols));
  return {
    panelId: panel.id,
    sizeId: c.sizeId,
    cols,
    x0,
    rows,
    topDown: true,
    castOn: y.castOn,
    repeats: [],
    stripes: [],
    buttonholeRows: {},
    legend,
    zoneRuns,
    markerCols,
    zoneCounts,
    zoneNames: ['left front', 'left sleeve', 'back', 'right sleeve', 'right front'],
    phases,
  };
}
