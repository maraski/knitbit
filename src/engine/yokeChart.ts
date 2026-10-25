// A contiguous yoke's stitch chart: zone colours, marker lines, increase symbols, per-zone counts and a phase column.
// Part of the chart code, kept apart from yokePanel.ts so the schematic doesn't load it. An off-shoulder raglan's
// band rows show their rib (purls), with the band's repeat in the left gutter; a folded band its turning and joining rounds.

import type { Chart, ChartRepeat, ChartRow } from './chart';
import { cellInfo, JOIN, PLAIN } from './chart';
import { ZONES } from './contiguous';
import type { Panel, Project, StitchPattern } from './model';
import type { ComputedPanel } from './panel';
import { zoneStarts } from './yokePanel';

/** Whether stitch `i` of a band row (from the start of the round) is a purl, for the edge stitches Knitbit knows; a
 * custom pattern is left plain (its repeat is marked). In the round, RS facing. */
export function bandPurl(pattern: StitchPattern, i: number, row: number): boolean {
  switch (pattern.name) {
    case '1x1 rib':
      return i % 2 === 1;
    case '2x2 rib':
      return i % 4 >= 2;
    case 'seed':
      return (i + row) % 2 === 1;
    case 'garter':
      return row % 2 === 0;
    default:
      return false;
  }
}

/** A folded band row's cell for stitch `i`, or null for a plain knit stitch. */
export function foldCell(part: 'facing' | 'turn' | 'outer' | 'join', turn: 'purl' | 'picot', i: number): string | null {
  if (part === 'join') return JOIN;
  if (part !== 'turn') return null;
  return turn === 'purl' ? 'purl' : i % 2 === 0 ? 'yo' : 'k2tog';
}

export function buildYokeChart(project: Project, panel: Panel, c: ComputedPanel): Chart {
  const y = c.yoke!;
  const os = y.offShoulder;
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
    if (yr.band && os) {
      for (let i = 0; i < yr.total; i++) {
        const k = starts[0] + i;
        if (k < 0 || k >= cols) continue;
        // A folded band: plain but for its turning round (purl, or picot: yo, k2tog) and its joining round.
        const v = yr.bandPart ? foldCell(yr.bandPart, os.fold?.turn ?? 'purl', i) : bandPurl(os.pattern, i, yr.row) ? 'purl' : null;
        if (v) cells[k] = v;
      }
    }
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
  // The off-shoulder band and its one increase round get short labels: the gutter is narrow (the band's stitch is on
  // its repeat bracket).
  const bandLabel = (label: string) => (label.startsWith('Band facing') ? 'Facing' : label.startsWith('Turning') ? 'Turn' : 'Band');
  const phaseLabel = (p: (typeof y.phases)[number]) => (p.id === 'band' ? bandLabel(p.label) : p.id === 'ring' ? 'Inc' : `${p.id} · ${p.label}`);
  const phases: NonNullable<Chart['phases']> = y.phases.filter((p) => p.id !== 'B' && p.id !== 'neck').map((p) => ({ label: phaseLabel(p), fromRow: p.from, toRow: p.to }));
  const repeats: ChartRepeat[] = os && os.bandRows > 0
    ? [{ name: `Band: ${os.pattern.name}`, fromRow: 1, toRow: os.bandRows, multiple: os.pattern.multiple, offset: os.pattern.offset, startCol: zoneStarts(y.rows[0], x0)[0] }]
    : [];
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
    repeats,
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
