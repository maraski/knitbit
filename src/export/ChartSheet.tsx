// One tile of a stitch chart for the PDF: a row range × a column range of `buildChart`'s grid, drawn in mm with the
// app's glyphs (ui/glyphs.tsx), row numbers on both sides, stitch numbers above and below, and the counts column.
// Based on GridChart / ChartCanvas in ChartView.tsx, without anything interactive. Colours are passed in resolved
// (`Palette`), never as CSS classes or var(), because svg2pdf only reads plain attributes; `sheetDom.tsx` gives the
// glyphs' own classes the same treatment after rendering.
//
// Plain stitches are runs of white rects with the grid drawn as one path of lines, not an SVG <pattern>: svg2pdf
// turns a pattern into a tiling pattern per run, which is much slower on a big chart.

import type { ReactNode } from 'react';
import { HELD, PLAIN, type Chart, type DisplayCol } from '../engine/chart';
import type { CustomSymbol } from '../engine/model';
import { cellFill, Glyph } from '../ui/glyphs';
import { countRows, stitchLabels, type Tile } from './tiles';

/** The CSS variables the chart uses, read once from the page (`readPalette`), with the light theme as fallback. */
const VARS = {
  fg: '#22211f',
  muted: '#77736b',
  accent: '#2f6690',
  turn: '#d08a1e',
  cell: '#ffffff',
  grid: '#c9c4b8',
  'line-strong': '#cfcbc2',
  'cell-held': '#ece9e2',
  'cell-bo': '#e6e2f6',
  'cell-co': '#e2f0e6',
  'cell-hold': '#efe2f2',
  'cell-none': '#d8d5ce',
  'cell-dec': '#fbe9e4',
  'cell-inc': '#e4f2e8',
  'cell-turn': '#fbefd9',
};
export type Palette = Record<keyof typeof VARS, string>;

/** The chart colours from the page's CSS variables (the fallbacks outside a browser). */
export function readPalette(): Palette {
  const out = { ...VARS };
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined' || !document.documentElement) return out;
  const style = getComputedStyle(document.documentElement);
  for (const k of Object.keys(out) as (keyof Palette)[]) out[k] = style.getPropertyValue(`--${k}`).trim() || out[k];
  return out;
}

/** A colour from glyphs.tsx (a `var(--x)` or a custom symbol's colour) resolved against the palette. */
export function resolveColor(v: string, palette: Palette): string {
  const m = /^var\(--([\w-]+)\)$/.exec(v);
  return m ? (palette[m[1] as keyof Palette] ?? VARS.fg) : v;
}

// Yoke zone tints and marker lines, as in app.css (fixed colours there too).
const ZONES = ['#3f8a5a', '#b0662a', '#2f6690', '#b0662a', '#3f8a5a'];
const MARKER = '#c0392b';

/** Sizes in mm. */
export const SHEET = {
  font: 2.3, // row and stitch numbers (about 6.5 pt)
  label: 2.2, // repeat names, gap counts
  rowLabel: 7, // a row-number gutter
  numbers: 4.2, // stitch numbers above / below
  side: 4.5, // a repeat bracket or phase band
  line: 0.12, // grid
  glyph: 0.26, // glyph strokes
} as const;

/** Width of digits and letters in Helvetica, mm (digits are 0.556 em; a rough mean for letters). */
export const textMm = (s: string, size: number) => s.length * size * 0.56;

export interface SheetLayout {
  left: number; // gutter widths, mm
  right: number;
  top: number;
  bottom: number;
}

/** The gutters around the cells: row numbers both sides, repeats / phases on the left, counts on the right. */
export function sheetGutters(chart: Chart): SheetLayout {
  const longest = (xs: string[]) => Math.max(0, ...xs.map((s) => textMm(s, SHEET.font)));
  const counts = chart.rows.map((r) => `${r.count}${chart.zoneCounts?.[r.key] ? ` ${chart.zoneCounts[r.key].join(' · ')}` : ''}`);
  const holes = Object.values(chart.buttonholeRows).map((b) => `buttonhole ${b.join(', ')}`);
  const rowW = Math.max(SHEET.rowLabel, longest(chart.rows.map((r) => r.label)) + 2);
  return {
    left: rowW + (chart.repeats.length ? SHEET.side : 0) + (chart.phases?.length ? SHEET.side : 0),
    right: rowW + longest(counts) + 2 + (holes.length ? longest(holes) + 2 : 0),
    top: SHEET.numbers + (chart.stripes.length ? 3 : 0),
    bottom: SHEET.numbers,
  };
}

interface Props {
  chart: Chart;
  dcols: DisplayCol[];
  tile: Pick<Tile, 'rows' | 'cols' | 'overlapRow' | 'overlapCol'>;
  cell: number; // mm
  gutters: SheetLayout;
  palette: Palette;
  /** Custom symbols, abbreviations already made printable. */
  custom: CustomSymbol[];
}

/** The SVG of one tile, in mm (its width and height are the gutters plus the cells). */
export function ChartSheet({ chart, dcols, tile, cell: cs, gutters: g, palette: P, custom }: Props) {
  // Upright, like the Chart tab: the first rows at the bottom of a bottom-up chart, at the top of a top-down one.
  const knitIdx = Array.from({ length: tile.rows.to - tile.rows.from + 1 }, (_, i) => tile.rows.from + i);
  const display = chart.topDown ? knitIdx : [...knitIdx].reverse();
  const xis = Array.from({ length: tile.cols.to - tile.cols.from + 1 }, (_, i) => tile.cols.from + i);
  const W = xis.length * cs;
  const H = display.length * cs;
  const X = (xi: number) => g.left + (xi - tile.cols.from) * cs;
  const Y = (yi: number) => g.top + yi * cs;
  const yOf = new Map(display.map((ri, yi) => [ri, yi]));
  const xOfCol = new Map<number, number>();
  xis.forEach((xi) => {
    const d = dcols[xi];
    if ('col' in d) xOfCol.set(d.col, xi);
  });
  const counts = countRows(chart, tile);
  const fmt = (n: number) => +n.toFixed(3);

  const cells: ReactNode[] = [];
  const syms: ReactNode[] = [];
  let grid = '';
  let hatch = '';
  display.forEach((ri, yi) => {
    const row = chart.rows[ri];
    const y = Y(yi);
    // Runs of plain / held stitches, and the grid lines of each stretch of fabric.
    let run = -1;
    let kind = '';
    let fabric = -1;
    const flush = (end: number) => {
      if (run >= 0) cells.push(<rect key={`${ri}r${run}`} x={fmt(X(run))} y={fmt(y)} width={fmt((end - run) * cs)} height={fmt(cs)} fill={kind === HELD ? P['cell-held'] : P.cell} />);
      run = -1;
    };
    const endFabric = (end: number) => {
      if (fabric < 0) return;
      grid += `M${fmt(X(fabric))},${fmt(y)}H${fmt(X(end))}M${fmt(X(fabric))},${fmt(y + cs)}H${fmt(X(end))}`;
      for (let k = fabric; k <= end; k++) grid += `M${fmt(X(k))},${fmt(y)}v${fmt(cs)}`;
      fabric = -1;
    };
    for (const xi of [...xis, tile.cols.to + 1]) {
      const d = dcols[xi];
      const v = d === undefined ? '' : 'col' in d ? row.cells[d.col] : row.cells[d.from];
      const runnable = v === PLAIN || v === HELD;
      if (!(runnable && run >= 0 && v === kind)) {
        flush(xi);
        if (runnable) {
          run = xi;
          kind = v;
        }
      }
      if (v === '' || d === undefined || !('col' in d)) endFabric(xi);
      else if (fabric < 0) fabric = xi;
      if (v === HELD && d && 'col' in d) hatch += `M${fmt(X(xi))},${fmt(y + cs)}l${fmt(cs)},${fmt(-cs)}`;
      if (!d || !('col' in d) || v === '' || runnable) continue;
      const x = X(xi);
      syms.push(
        <g key={`${ri}s${xi}`}>
          <rect x={fmt(x)} y={fmt(y)} width={fmt(cs)} height={fmt(cs)} fill={resolveColor(cellFill(v, custom), P)} />
          <g transform={`translate(${fmt(x)},${fmt(y)}) scale(${fmt(cs)})`} strokeWidth={fmt(SHEET.glyph / cs)}>
            <Glyph id={v} custom={custom} />
          </g>
        </g>,
      );
    }
    // Contiguous yoke: the zones' tints and the markers between them.
    for (const zr of chart.zoneRuns?.[row.key] ?? []) {
      const xs = xis.filter((xi) => {
        const d = dcols[xi];
        return 'col' in d && d.col >= zr.from && d.col < zr.to;
      });
      if (xs.length) cells.push(<rect key={`${ri}z${zr.zone}`} x={fmt(X(xs[0]))} y={fmt(y)} width={fmt((xs[xs.length - 1] - xs[0] + 1) * cs)} height={fmt(cs)} fill={ZONES[zr.zone % ZONES.length]} fillOpacity={0.16} />);
    }
    for (const mc of chart.markerCols?.[row.key] ?? []) {
      const xi = xOfCol.get(mc);
      if (xi !== undefined) syms.push(<line key={`${ri}m${mc}`} x1={fmt(X(xi))} x2={fmt(X(xi))} y1={fmt(y)} y2={fmt(y + cs)} stroke={MARKER} strokeWidth={0.5} />);
    }
  });

  // Every 10th stitch / row: a stronger line.
  let tens = '';
  xis.forEach((xi) => {
    const d = dcols[xi];
    if ('col' in d && (chart.cols - d.col) % 10 === 0) tens += `M${fmt(X(xi))},${fmt(g.top)}v${fmt(H)}`;
  });
  display.forEach((ri, yi) => {
    const r = chart.rows[ri];
    if (!r.shortRow && r.knitRow % 10 === 0) tens += `M${fmt(g.left)},${fmt(chart.topDown ? Y(yi + 1) : Y(yi))}h${fmt(W)}`;
  });

  // The row and stitch shared with the tile before: drawn lighter.
  const overlap: ReactNode[] = [];
  const oy = tile.overlapRow !== null ? yOf.get(tile.overlapRow) : undefined;
  if (oy !== undefined) overlap.push(<rect key="or" x={fmt(g.left)} y={fmt(Y(oy))} width={fmt(W)} height={fmt(cs)} fill="#ffffff" fillOpacity={0.55} />);
  if (tile.overlapCol !== null) overlap.push(<rect key="oc" x={fmt(X(tile.overlapCol))} y={fmt(g.top)} width={fmt(cs)} height={fmt(H)} fill="#ffffff" fillOpacity={0.55} />);

  // Folded plain columns: a dashed column with the number folded.
  const gaps = xis.flatMap((xi) => {
    const d = dcols[xi];
    if ('col' in d) return [];
    return [
      <g key={`gap${xi}`}>
        <rect x={fmt(X(xi))} y={fmt(g.top)} width={fmt(cs)} height={fmt(H)} fill="#ffffff" stroke={P['line-strong']} strokeWidth={0.2} strokeDasharray="0.8 1" />
        <text x={fmt(X(xi) + cs / 2)} y={fmt(g.top - 1.2)} textAnchor="middle" fontSize={SHEET.label} fill={P.muted}>{`…${d.gap}`}</text>
      </g>,
    ];
  });

  // Row numbers on both sides (short rows in the turn colour), and the counts column.
  const rowW = g.left - (chart.repeats.length ? SHEET.side : 0) - (chart.phases?.length ? SHEET.side : 0);
  const labels: ReactNode[] = [];
  display.forEach((ri, yi) => {
    const r = chart.rows[ri];
    const y = fmt(Y(yi) + cs / 2 + SHEET.font * 0.36);
    const style = r.shortRow ? { fill: P.turn, fontWeight: 'bold' as const } : { fill: P.muted };
    labels.push(
      <text key={`l${ri}`} x={fmt(g.left - 1)} y={y} textAnchor="end" {...style}>{r.label}</text>,
      <text key={`r${ri}`} x={fmt(g.left + W + 1)} y={y} {...style}>{r.label}</text>,
    );
    if (counts.has(r.key)) {
      const zones = chart.zoneCounts?.[r.key];
      labels.push(<text key={`c${ri}`} x={fmt(g.left + W + rowW)} y={y} fill={P.accent}>{`${r.count}${zones ? ` ${zones.join(' · ')}` : ''}`}</text>);
    }
    const holes = !r.shortRow && chart.buttonholeRows[r.knitRow];
    if (holes) labels.push(<text key={`b${ri}`} x={fmt(g.left + W + g.right - textMm(`buttonhole ${holes.join(', ')}`, SHEET.font) - 1)} y={y} fill={P.accent}>{`buttonhole ${holes.join(', ')}`}</text>);
  });
  // Stitch numbers above and below.
  for (const { xi, n } of stitchLabels(chart, dcols, tile.cols)) {
    const x = fmt(X(xi) + cs / 2);
    labels.push(
      <text key={`t${xi}`} x={x} y={fmt(g.top - 1.2)} textAnchor="middle" fill={P.muted}>{n}</text>,
      <text key={`u${xi}`} x={x} y={fmt(g.top + H + SHEET.font + 0.8)} textAnchor="middle" fill={P.muted}>{n}</text>,
    );
  }

  // Integrated front band: tinted columns, named above.
  const stripes = chart.stripes.flatMap((st, k) => {
    const xs = xis.filter((xi) => {
      const d = dcols[xi];
      return 'col' in d && d.col >= st.fromCol && d.col < st.toCol;
    });
    if (!xs.length) return [];
    const x1 = X(xs[0]);
    const x2 = X(xs[xs.length - 1] + 1);
    return [
      <g key={`st${k}`}>
        <rect x={fmt(x1)} y={fmt(g.top)} width={fmt(x2 - x1)} height={fmt(H)} fill={P.accent} fillOpacity={0.08} />
        <text x={fmt((x1 + x2) / 2)} y={fmt(g.top - SHEET.numbers - 0.6)} textAnchor="middle" fontSize={SHEET.label} fill={P.accent}>{st.name}</text>
      </g>,
    ];
  });

  // Pattern sections: a bracket in the left gutter and the repeat lines; yoke phases: a band further out.
  const span = (from: number, to: number) => {
    const ys = display.map((ri, yi) => (!chart.rows[ri].shortRow && chart.rows[ri].knitRow >= from && chart.rows[ri].knitRow <= to ? yi : -1)).filter((yi) => yi >= 0);
    return ys.length ? { y1: Y(Math.min(...ys)), y2: Y(Math.max(...ys) + 1) } : null;
  };
  const bracketX = g.left - rowW;
  const repeats = chart.repeats.flatMap((rp, k) => {
    const s = span(rp.fromRow, rp.toRow);
    if (!s) return [];
    let lines = '';
    if (rp.multiple > 1) {
      for (let col = rp.startCol + rp.offset; col < chart.cols; col += rp.multiple) {
        const xi = xOfCol.get(col);
        if (xi !== undefined) lines += `M${fmt(X(xi))},${fmt(s.y1)}V${fmt(s.y2)}`;
      }
    }
    const name = `${rp.name}${rp.multiple > 1 ? ` · ${rp.multiple}${rp.offset ? ` + ${rp.offset}` : ''}` : ''}`;
    return [
      <g key={`rp${k}`}>
        {lines && <path d={lines} stroke={P.accent} strokeWidth={0.25} strokeDasharray="0.9 0.6" strokeOpacity={0.7} fill="none" />}
        <path d={`M${fmt(bracketX - 0.4)},${fmt(s.y1 + 0.5)}h-1V${fmt(s.y2 - 0.5)}h1`} stroke={P.accent} strokeWidth={0.3} fill="none" />
        {s.y2 - s.y1 > textMm(name, SHEET.label) && (
          <text transform={`translate(${fmt(bracketX - 2)},${fmt((s.y1 + s.y2) / 2)}) rotate(-90)`} textAnchor="middle" fontSize={SHEET.label} fill={P.accent}>{name}</text>
        )}
      </g>,
    ];
  });
  const phaseX = bracketX - (chart.repeats.length ? SHEET.side : 0) - SHEET.side;
  const phases = (chart.phases ?? []).flatMap((ph, k) => {
    const s = span(ph.fromRow, ph.toRow);
    if (!s) return [];
    return [
      <g key={`ph${k}`}>
        <rect x={fmt(phaseX + 0.5)} y={fmt(s.y1)} width={3} height={fmt(s.y2 - s.y1)} fill={k % 2 ? P['cell-held'] : P['cell-co']} />
        {s.y2 - s.y1 > textMm(ph.label, SHEET.label) && (
          <text transform={`translate(${fmt(phaseX + 2.8)},${fmt((s.y1 + s.y2) / 2)}) rotate(-90)`} textAnchor="middle" fontSize={SHEET.label} fill={P.fg}>{ph.label}</text>
        )}
      </g>,
    ];
  });

  const width = fmt(g.left + W + g.right);
  const height = fmt(g.top + H + g.bottom);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${height}`} width={width} height={height} fontFamily="helvetica" fontSize={SHEET.font}>
      {cells}
      {stripes}
      {hatch && <path d={hatch} stroke={P['line-strong']} strokeWidth={0.18} fill="none" />}
      {grid && <path d={grid} stroke={P.grid} strokeWidth={SHEET.line} fill="none" />}
      {syms}
      {tens && <path d={tens} stroke={P.muted} strokeWidth={0.22} strokeOpacity={0.7} fill="none" />}
      {overlap}
      {gaps}
      {repeats}
      {phases}
      {labels}
    </svg>
  );
}

/** Key swatches in a column, `size` mm square and `pitch` apart (the labels are written by the PDF beside them). */
export function KeySwatches({ ids, size, pitch, palette: P, custom }: { ids: string[]; size: number; pitch: number[]; palette: Palette; custom: CustomSymbol[] }) {
  const height = (pitch[pitch.length - 1] ?? 0) + size + 0.5;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${size + 0.5} ${height}`} width={size + 0.5} height={height} fontFamily="helvetica">
      {ids.map((id, i) => (
        <g key={id} transform={`translate(0.25,${pitch[i] + 0.25})`}>
          <rect width={size} height={size} fill={id === HELD ? P['cell-held'] : id === PLAIN ? P.cell : resolveColor(cellFill(id, custom), P)} stroke={P.grid} strokeWidth={SHEET.line * 1.5} />
          {id === HELD && <path d={`M0,${size}L${size},0`} stroke={P['line-strong']} strokeWidth={0.18} />}
          <g transform={`scale(${size})`} strokeWidth={SHEET.glyph / size}>
            <Glyph id={id} custom={custom} />
          </g>
        </g>
      ))}
    </svg>
  );
}
