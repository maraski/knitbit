// The view on screen as a standalone SVG for the PNG export: the same drawing as the Schematic, Chart or Layout tab
// in the current size mode, in its `exportMode` (no handles, hover, selection or zoom), with its styles inlined. Its
// width and height are CSS px at 1×.
//
// Views not in the main chunk (layout, yoke) are imported here on demand, as the app does; the Schematic comes from
// `exportViews`. A chart is drawn whole with the PDF's ChartSheet (every row and stitch, not just the scrolled part).

import type { ReactNode } from 'react';
import { buildChart, collapseColumns, HELD, PLAIN, type Chart, type DisplayCol } from '../engine/chart';
import { buttonPlan } from '../engine/buttons';
import { cachedPanel, panelJoins, type PanelCache } from '../engine/joins';
import type { AlignRef } from '../engine/layout';
import { buildScope } from '../engine/measurements';
import type { Id, Project } from '../engine/model';
import { panelExtras, resolvePanelDims, type ComputedPanel } from '../engine/panel';
import { sizeText } from '../ui/components/EstMark';
import { LEGEND_SVG_H, SizeLegendSvg } from '../ui/components/SizeLegendSvg';
import { bandColor } from '../ui/glyphs';
import { schematicBands } from '../ui/schematicBands';
import { PANEL_SELECTION } from '../ui/selection';
import { ChartSheet, KeySwatches, readPalette, sheetGutters } from './ChartSheet';
import { renderSvg, sheetSvg } from './render';
import { CELL_MM } from './tiles';
import { exportViews } from './views';

export type PngSizeMode = 'single' | 'overlay' | 'grid';

/** What's on screen: the tab, the piece, the size and the size mode, and the pane's size (px). */
export interface PngSpec {
  project: Project;
  view: 'schematic' | 'chart' | 'layout';
  /** A yoke piece: seen from above, or laid flat. */
  yoke?: 'top' | 'front';
  panelId: Id | null;
  sizeId: Id;
  mode: PngSizeMode;
  /** Sizes shown in overlay / grid, in size order. */
  compare: Id[];
  align: AlignRef;
  /** The drawing pane (a chart ignores it: it's drawn whole). */
  width: number;
  height: number;
  /** The Chart tab's "Collapse plain middle". */
  collapse?: boolean;
}

/** A whole chart: px per mm of the PDF's sheet, so a cell is 18 px and the numbers about 9 px at 1×. */
const PX_PER_MM = 4;

/** The size mode as drawn: the chart has no overlay, and the laid-flat yoke draws one size. */
export function effectiveMode(spec: PngSpec, project: Project = spec.project): PngSizeMode {
  const panel = project.panels.find((p) => p.id === spec.panelId);
  if (spec.view === 'chart' && spec.mode === 'overlay') return 'single';
  if (panel?.yoke && spec.view !== 'layout' && spec.yoke === 'front') return 'single';
  return spec.mode;
}

/** "Back schematic", "Yoke top view chart", "layout": the view part of the file name and the dialog's title. */
export function viewName(spec: PngSpec): string {
  if (spec.view === 'layout') return 'layout';
  const panel = spec.project.panels.find((p) => p.id === spec.panelId);
  const name = panel?.name ?? 'piece';
  if (panel?.yoke) return `${name} ${spec.yoke === 'front' ? 'laid flat' : 'top view'}${spec.view === 'chart' ? ' chart' : ''}`;
  return `${name} ${spec.view}`;
}

/** The size part of the file name: the size's name, or "<n>-sizes-overlay" / "<n>-sizes-grid". */
export function sizesName(spec: PngSpec): string {
  const mode = effectiveMode(spec);
  if (mode !== 'single') return `${spec.compare.length}-sizes-${mode}`;
  return spec.project.sizes.find((s) => s.id === spec.sizeId)?.name ?? 'size';
}

/** The view as a standalone SVG (styles inlined), with width and height in px at 1×. */
export async function viewSvg(spec: PngSpec): Promise<SVGSVGElement> {
  const { project, sizeId } = spec;
  const mode = effectiveMode(spec);
  const cache: PanelCache = new Map();
  const computed = (panelId: Id, sid: Id): ComputedPanel => cachedPanel(project, panelId, sid, cache)!;
  const box = { width: Math.max(200, Math.round(spec.width)), height: Math.max(150, Math.round(spec.height)) };

  if (spec.view === 'layout') {
    const { LayoutView } = await import('../ui/components/LayoutView');
    return renderSvg(<LayoutView project={project} sizeId={sizeId} mode={mode} compare={spec.compare} align={spec.align} computed={computed} exportMode={box} />);
  }

  const panel = project.panels.find((p) => p.id === spec.panelId);
  if (!panel) throw new Error('No piece selected.');
  const c = computed(panel.id, sizeId);
  const compare = (mode === 'single' ? [sizeId] : spec.compare).map((sid) => computed(panel.id, sid));

  if (panel.yoke && spec.yoke !== 'front') {
    const { YokeTopView } = await import('../ui/components/YokeTopView');
    const plan = project.garment.opening === 'cardigan' ? buttonPlan(project, sizeId) : null;
    const buttons = plan ? { positions: plan.positions, bodyEdgeCm: plan.bodyEdgeCm, holeSide: project.cardigan?.buttonholeSide ?? 'right' } : undefined;
    return renderSvg(<YokeTopView project={project} panel={panel} computed={c} view={spec.view} mode={mode} compare={compare} units={project.units} buttons={buttons} exportMode={box} />);
  }

  if (spec.view === 'chart') {
    if (mode === 'grid') return chartGridSvg(project, panel.id, spec.compare, computed);
    if (!c.ok) throw new Error('This piece can’t be charted in this size: fix its problems first.');
    return chartSvg(project, buildChart(project, panel, c), sizeId, !!spec.collapse);
  }

  if (panel.yoke) {
    // Laid flat: the PDF's schematic of the yoke, at the pane's size.
    const { YokeFrontSheet } = await import('../ui/components/YokeFrontView');
    return renderSvg(<YokeFrontSheet computed={c} units={project.units} width={box.width} height={box.height} />);
  }

  const { Schematic } = exportViews;
  if (!Schematic) throw new Error('The schematic view is not loaded.');
  if (!c.ok) throw new Error('This piece can’t be drawn in this size: fix its problems first.');
  const scope = { ...buildScope(project, sizeId), ...panelExtras(project, panel, sizeId), ...resolvePanelDims(project, panel, sizeId).values };
  // An overlay's size legend (HTML on screen) is drawn under it here, so the Schematic keeps it out of the main chunk.
  const legendH = mode === 'overlay' ? LEGEND_SVG_H : 0;
  const drawing = (
    <Schematic
      computed={c}
      direction={panel.direction}
      units={project.units}
      selection={PANEL_SELECTION}
      onSelect={() => {}}
      fitKey={panel.id}
      // One size fits itself; an overlay fits every size shown, as on screen.
      fitOutlines={mode === 'overlay' ? compare.filter((x) => x.ok).map((x) => x.outline) : []}
      joins={panelJoins(project, panel.id)}
      mode={mode}
      compare={compare}
      align={spec.align}
      project={project}
      bands={mode === 'single' ? schematicBands(project, panel, c, sizeId, scope, cache) : undefined}
      exportMode={{ width: box.width, height: box.height - legendH }}
    />
  );
  if (!legendH) return renderSvg(drawing);
  return renderSvg(
    <svg width={box.width} height={box.height} viewBox={`0 0 ${box.width} ${box.height}`} className="schematic">
      {drawing}
      <SizeLegendSvg project={project} sizes={spec.compare} current={sizeId} align={spec.align} x={12} y={box.height - legendH + 8} width={box.width - 24} />
    </svg>,
  );
}

// ---------- the chart, whole ----------

const TITLE_H = 30; // px, over the chart
const KEY_ROW = 6.5; // mm per key entry
const KEY_SWATCH = 4.5; // mm

/** The whole chart (the PDF's sheet with every row and stitch), a title over it and its symbol key under it. */
function chartSvg(project: Project, chart: Chart, sizeId: Id, collapse: boolean): SVGSVGElement {
  if (!chart.rows.length || !chart.cols) throw new Error('This piece has no chart.');
  const palette = readPalette();
  const custom = project.symbols ?? [];
  const dcols: DisplayCol[] = collapse ? collapseColumns(chart) : Array.from({ length: chart.cols }, (_, k) => ({ col: k }));
  const gutters = sheetGutters(chart);
  const tile = { rows: { from: 0, to: chart.rows.length - 1 }, cols: { from: 0, to: dcols.length - 1 }, overlapRow: null, overlapCol: null };
  const sheetW = gutters.left + dcols.length * CELL_MM + gutters.right;
  const sheetH = gutters.top + chart.rows.length * CELL_MM + gutters.bottom;

  // The key in as many columns as fit under the chart (at least one, about 60 mm each).
  const legend = chart.legend;
  const cols = Math.max(1, Math.min(legend.length, Math.floor(sheetW / 60)));
  const perCol = Math.ceil(legend.length / cols);
  const colW = Math.max(60, sheetW / cols);
  const keyH = legend.length ? 8 + perCol * KEY_ROW : 0;
  const widthMm = Math.max(sheetW, cols * colW);
  const W = Math.ceil(widthMm * PX_PER_MM + 24);
  const H = Math.ceil(TITLE_H + (sheetH + keyH) * PX_PER_MM + 16);
  const size = project.sizes.find((s) => s.id === sizeId);
  const panel = project.panels.find((p) => p.id === chart.panelId);
  const title = `${panel?.name ?? 'Chart'} · size ${size ? sizeText(size, project) : '?'} · ${chart.rows.length} rows × ${chart.cols} sts`;
  const sub = chart.topDown ? 'row 1 at the top · RS rows read right to left, WS rows left to right' : 'row 1 at the bottom · RS rows read right to left, WS rows left to right';
  const font = 'system-ui, -apple-system, "Segoe UI", sans-serif';

  const node = (
    <svg xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily={font}>
      <text x={12} y={17} fontSize={13} fontWeight="bold" fill={palette.fg}>{title}</text>
      <text x={12} y={30} fontSize={10.5} fill={palette.muted}>{sub}</text>
      <g transform={`translate(12,${TITLE_H + 4}) scale(${PX_PER_MM})`}>
        <ChartSheet chart={chart} dcols={dcols} tile={tile} cell={CELL_MM} gutters={gutters} palette={palette} custom={custom} />
        {legend.length > 0 && (
          <g transform={`translate(${gutters.left},${sheetH + 2})`}>
            <text x={0} y={3.5} fontSize={3.2} fontWeight="bold" fill={palette.fg} fontFamily={font}>Key</text>
            {Array.from({ length: cols }, (_, k) => {
              const ids = legend.slice(k * perCol, (k + 1) * perCol);
              if (!ids.length) return null;
              return (
                <g key={k} transform={`translate(${k * colW},6)`}>
                  <KeySwatches ids={ids.map((l) => l.id)} size={KEY_SWATCH} pitch={ids.map((_, i) => i * KEY_ROW)} palette={palette} custom={custom} />
                  {ids.map((l, i) => (
                    <text key={l.id} x={KEY_SWATCH + 2} y={i * KEY_ROW + 3.3} fontSize={2.8} fill={palette.fg} fontFamily={font}>
                      {l.abbr ? `${l.abbr}: ${l.label}` : l.label}
                    </text>
                  ))}
                </g>
              );
            })}
          </g>
        )}
      </g>
    </svg>
  );
  return sheetSvg(node, palette.fg);
}

/**
 * The Chart tab's grid of sizes: every size's chart as coloured blocks (no symbols) at one scale, named under it, as
 * many to a row as on a wide screen.
 */
function chartGridSvg(project: Project, panelId: Id, sizeIds: Id[], computed: (p: Id, s: Id) => ComputedPanel): SVGSVGElement {
  const panel = project.panels.find((p) => p.id === panelId)!;
  const custom = project.symbols ?? [];
  const items = sizeIds.map((sid) => {
    const c = computed(panelId, sid);
    const size = project.sizes.find((s) => s.id === sid);
    return { sid, c, name: size ? sizeText(size, project) : '', chart: c.ok ? buildChart(project, panel, c) : null };
  });
  const ok = items.filter((i) => i.c.ok);
  // One scale for every size, as on screen.
  const extent = Math.max(1, ...ok.map((i) => Math.max(i.c.counts.reduce((a, b) => Math.max(a, b), 0) * 1.1, i.c.totalRows / 1.3)));
  const cs = Math.max(1, Math.min(4, 300 / extent));
  const GAP = 14;
  const CAP = 18;
  const cardW = Math.max(120, ...items.map((i) => (i.chart?.cols ?? 0) * cs));
  const cardH = Math.max(20, ...items.map((i) => (i.chart?.rows.length ?? 0) * cs));
  const perRow = Math.max(1, Math.min(items.length, Math.floor(1400 / (cardW + GAP))));
  const W = 12 + perRow * (cardW + GAP);
  const H = 12 + Math.ceil(items.length / perRow) * (cardH + CAP + GAP);
  const fillOf = (v: string) => (v === HELD ? 'var(--cell-held-strong)' : v === PLAIN ? 'var(--fill)' : (bandColor(v, custom) ?? 'var(--fill)'));
  const cards: ReactNode[] = items.map((it, k) => {
    const x0 = 12 + (k % perRow) * (cardW + GAP);
    const y0 = 12 + Math.floor(k / perRow) * (cardH + CAP + GAP);
    const parts: ReactNode[] = [];
    const ch = it.chart;
    if (ch) {
      const display = ch.topDown ? ch.rows : [...ch.rows].reverse();
      const left = x0 + (cardW - ch.cols * cs) / 2;
      const top = y0 + cardH - display.length * cs;
      display.forEach((row, i) => {
        let a = -1;
        let kind = '';
        const flush = (b: number) => {
          if (a >= 0 && kind !== '') parts.push(<rect key={`${i}-${a}`} x={left + a * cs} y={top + i * cs} width={(b - a) * cs} height={cs} style={{ fill: fillOf(kind) }} />);
        };
        row.cells.forEach((v, col) => {
          if (v === kind && a >= 0) return;
          flush(col);
          a = col;
          kind = v;
        });
        flush(row.cells.length);
      });
    }
    return (
      <g key={it.sid}>
        {parts}
        <text x={x0 + cardW / 2} y={y0 + cardH + 13} textAnchor="middle" style={{ fontSize: 11 }}>
          {ch ? `${it.name} · ${ch.cols} sts · ${ch.rows.length} rows` : `${it.name}: can’t chart`}
        </text>
      </g>
    );
  });
  return renderSvg(
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="schematic" shapeRendering="crispEdges">
      {cards}
    </svg>,
  );
}
