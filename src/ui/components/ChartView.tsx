// Stitch chart view: the computed panel as a grid of cells, drawn upright (row 1 at the bottom for bottom-up
// panels, at the top for top-down ones). Rows are virtualised; plain stitches are drawn as runs.

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildChart, collapseColumns, HELD, PLAIN, type Chart, type ChartRow, type DisplayCol } from '../../engine/chart';
import type { CustomSymbol, Id, Panel, Project } from '../../engine/model';
import { newId } from '../../engine/model';
import type { ComputedPanel } from '../../engine/panel';
import type { MarkerActions } from '../markerActions';
import type { Selection } from '../selection';
import { bandColor, cellFill, Glyph, Swatch } from '../glyphs';
import { signed } from '../format';

interface Props {
  project: Project;
  panel: Panel;
  computed: ComputedPanel;
  selection: Selection;
  onSelect: (s: Selection) => void;
  markers?: MarkerActions;
  update: (fn: (p: Project) => Project, key?: string | null) => void;
  grid?: { computed: ComputedPanel; name: string }[]; // grid mode: one small chart per size
}

const PREF_KEY = 'knitbit.chart.v1';
function readPrefs(): { cell: number; collapse: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}');
    return { cell: typeof v.cell === 'number' ? v.cell : 14, collapse: !!v.collapse };
  } catch {
    return { cell: 14, collapse: false };
  }
}

const GUT = 46; // side gutters (row numbers)
const TOP = 22;
const BOT = 26;
const MIN_CELL = 3;
const MAX_CELL = 40;

export function ChartView({ project, panel, computed: c, selection, onSelect, markers, update, grid }: Props) {
  const [prefs, setPrefs] = useState(readPrefs);
  const cs = prefs.cell;
  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);
  const setCell = (n: number) => setPrefs((p) => ({ ...p, cell: Math.max(MIN_CELL, Math.min(MAX_CELL, Math.round(n * 2) / 2)) }));

  const chart = useMemo(() => (c.ok ? buildChart(project, panel, c) : null), [project, panel, c]);
  const custom = project.symbols ?? [];

  if (grid) {
    // One scale for every size, so the charts compare.
    const extent = Math.max(1, ...grid.filter((g) => g.computed.ok).map((g) => Math.max(g.computed.counts.reduce((a, b) => Math.max(a, b), 0) * 1.1, g.computed.totalRows / 1.3)));
    const gcs = Math.max(1, Math.min(4, 300 / extent));
    return (
      <div className="chart-view">
        <div className="chart-grid">
          {grid.map((g) => (
            <GridChart key={g.computed.sizeId} project={project} panel={panel} c={g.computed} name={g.name} cs={gcs} />
          ))}
          {!grid.length && <p className="muted pad">No sizes chosen.</p>}
        </div>
        <LegendPanel chart={chart} project={project} update={update} />
      </div>
    );
  }

  return (
    <div className="chart-view">
      {chart ? (
        <ChartCanvas chart={chart} c={c} custom={custom} cs={cs} setCell={setCell} collapse={prefs.collapse} setCollapse={(v) => setPrefs((p) => ({ ...p, collapse: v }))} selection={selection} onSelect={onSelect} markers={markers} />
      ) : (
        <div className="canvas-empty">
          <p>This panel can't be charted in this size: see the checks below.</p>
        </div>
      )}
      <LegendPanel chart={chart} project={project} update={update} />
    </div>
  );
}

// ---------- the full chart ----------

interface CanvasProps {
  chart: Chart;
  c: ComputedPanel;
  custom: CustomSymbol[];
  cs: number;
  setCell: (n: number) => void;
  collapse: boolean;
  setCollapse: (v: boolean) => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  markers?: MarkerActions;
}

interface Drag {
  fromWaypoint: Id;
  edge: 'left' | 'right';
  index: number;
  row: number;
  others: number[];
  key: string;
  moved: boolean;
}

function ChartCanvas({ chart, c, custom, cs, setCell, collapse, setCollapse, selection, onSelect, markers }: CanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });
  const drag = useRef<Drag | null>(null);
  const [hover, setHover] = useState<{ row: ChartRow; col: number } | null>(null);

  // Upright: bottom-up charts read from the bottom, top-down from the top.
  const display = useMemo(() => (chart.topDown ? chart.rows : [...chart.rows].reverse()), [chart]);
  const dcols: DisplayCol[] = useMemo(() => (collapse ? collapseColumns(chart) : Array.from({ length: chart.cols }, (_, k) => ({ col: k }))), [chart, collapse]);
  const xOfCol = useMemo(() => {
    const m = new Map<number, number>();
    dcols.forEach((d, i) => 'col' in d && m.set(d.col, i));
    return m;
  }, [dcols]);
  const W = dcols.length * cs;
  const H = display.length * cs;
  const fine = cs >= 7;

  // Scroll so the chart's first row is in view when a panel is opened.
  const firstKey = `${chart.panelId}`;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = chart.topDown ? 0 : el.scrollHeight;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => setView({ top: el.scrollTop, height: el.clientHeight });
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    const fit = () => {
      const w = (el.clientWidth - 2 * GUT - 40) / Math.max(1, dcols.length);
      const h = (el.clientHeight - TOP - BOT - 20) / Math.max(1, display.length);
      setCell(Math.min(w, h));
    };
    window.addEventListener('knitbit:fit', fit);
    return () => {
      el.removeEventListener('scroll', sync);
      ro.disconnect();
      window.removeEventListener('knitbit:fit', fit);
    };
  }, [dcols.length, display.length, setCell]);

  // Ctrl/⌘ + wheel zooms around the pointer.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left + el.scrollLeft;
      const py = e.clientY - r.top + el.scrollTop;
      const next = Math.max(MIN_CELL, Math.min(MAX_CELL, cs * Math.exp(-e.deltaY * 0.004)));
      const k = next / cs;
      setCell(next);
      requestAnimationFrame(() => {
        el.scrollLeft = px * k - (e.clientX - r.left);
        el.scrollTop = py * k - (e.clientY - r.top);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [cs, setCell]);

  // Visible rows only (plus a margin).
  const first = Math.max(0, Math.floor((view.top - TOP) / cs) - 10);
  const last = Math.min(display.length, Math.ceil((view.top + view.height - TOP) / cs) + 10);

  const selMarker = selection.kind === 'segment' && selection.marker !== undefined ? selection : null;
  const segOf = (fw: Id) => c.segments.find((s) => s.fromWaypoint === fw);

  // Count shown beside rows where it changes.
  const countChanged = useMemo(() => {
    const s = new Set<string>();
    let prev = chart.castOn;
    for (const r of chart.rows) {
      if (!r.shortRow && r.count !== prev) s.add(r.key);
      if (!r.shortRow) prev = r.count;
    }
    return s;
  }, [chart]);

  const rowAt = (clientY: number): number => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    const y = clientY - r.top + el.scrollTop - TOP;
    return Math.max(0, Math.min(display.length - 1, Math.floor(y / cs)));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !markers) return;
    const seg = segOf(d.fromWaypoint);
    if (!seg) return;
    // Nearest knit row under the pointer (short rows aren't marker rows).
    let i = rowAt(e.clientY);
    while (i > 0 && display[i].shortRow) i--;
    const row = Math.max(seg.rowFrom, Math.min(seg.rowTo, display[i].knitRow));
    if (row !== d.row && !d.others.includes(row)) {
      markers.move(d.fromWaypoint, d.edge, d.index, row - seg.rowFrom + 1, d.key);
      d.index = d.others.filter((r) => r < row).length;
      d.row = row;
      d.moved = true;
    }
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d) onSelect({ kind: 'segment', fromWaypoint: d.fromWaypoint, edge: d.edge, marker: d.index });
  };

  const onCellDown = (e: React.PointerEvent, row: ChartRow, k: number) => {
    const ref = row.refs[k];
    if (!ref || e.button !== 0) return;
    e.stopPropagation();
    const seg = segOf(ref.fromWaypoint);
    if (!seg) return;
    const list = seg[ref.edge].events;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { ...ref, row: list[ref.index]?.row ?? row.knitRow, others: list.filter((_, j) => j !== ref.index).map((x) => x.row), key: `drag:chart:${Date.now()}`, moved: false };
    onSelect({ kind: 'segment', fromWaypoint: ref.fromWaypoint, edge: ref.edge, marker: ref.index });
  };

  /** Double-click a stitch in a shaped stretch: add a marker on that row at the nearer edge. */
  const onDouble = (row: ChartRow, k: number) => {
    if (!markers || row.shortRow) return;
    const seg = c.segments.find((s) => row.knitRow >= s.rowFrom && row.knitRow <= s.rowTo && s.rowTo > s.rowFrom);
    if (!seg) return;
    const firstCol = row.cells.findIndex((v) => v !== '');
    const lastCol = row.cells.length - 1 - [...row.cells].reverse().findIndex((v) => v !== '');
    const edge = k - firstCol <= lastCol - k ? 'left' : 'right';
    const target = seg.mirror ? 'left' : edge;
    markers.add(seg, target, row.knitRow - seg.rowFrom + 1);
    onSelect({ kind: 'segment', fromWaypoint: seg.fromWaypoint, edge: target });
  };

  const rowsSvg: React.ReactNode[] = [];
  for (let i = first; i < last; i++) {
    const row = display[i];
    const y = TOP + i * cs;
    const parts: React.ReactNode[] = [];
    // Runs of plain / held stitches.
    let runStart = -1;
    let runKind = '';
    const flush = (end: number) => {
      if (runStart < 0) return;
      parts.push(<rect key={`r${runStart}`} x={GUT + runStart * cs} y={y} width={(end - runStart) * cs} height={cs} className={runKind === HELD ? 'cell-held' : 'cell-plain'} />);
      runStart = -1;
    };
    dcols.forEach((d, xi) => {
      const v = 'col' in d ? row.cells[d.col] : row.cells[d.from];
      const runnable = v === PLAIN || v === HELD;
      if (runnable && runStart >= 0 && v === runKind) return;
      flush(xi);
      if (runnable) {
        runStart = xi;
        runKind = v;
      }
    });
    flush(dcols.length);
    // Symbol cells.
    dcols.forEach((d, xi) => {
      if (!('col' in d)) return;
      const v = row.cells[d.col];
      if (v === '' || v === PLAIN || v === HELD) return;
      const x = GUT + xi * cs;
      const ref = row.refs[d.col];
      const selected = !!(ref && selMarker && ref.fromWaypoint === selMarker.fromWaypoint && ref.edge === (selMarker.edge ?? 'left') && ref.index === selMarker.marker);
      const band = bandColor(v, custom);
      parts.push(
        <g
          key={`s${d.col}`}
          className={`sym${ref ? ' editable' : ''}${selected ? ' selected' : ''}`}
          onPointerDown={(e) => onCellDown(e, row, d.col)}
        >
          {fine ? (
            <>
              <rect x={x} y={y} width={cs} height={cs} fill={cellFill(v, custom)} className="cell-border" />
              <g transform={`translate(${x},${y}) scale(${cs})`}>
                <Glyph id={v} custom={custom} />
              </g>
            </>
          ) : (
            <rect x={x} y={y} width={cs} height={cs} fill={band ?? cellFill(v, custom)} />
          )}
          {selected && <rect x={x - 1} y={y - 1} width={cs + 2} height={cs + 2} className="cell-selected" />}
        </g>,
      );
    });
    // Row labels: where the row starts.
    const label = (
      <text className={`row-label${row.shortRow ? ' sr' : ''}`} y={y + cs / 2 + 3.5}>
        {row.label}
      </text>
    );
    const fs = Math.min(11, Math.max(7, cs * 0.75));
    const showLabel = cs >= 8 || row.shortRow || (!row.shortRow && row.knitRow % 5 === 0);
    parts.push(
      <g key="lbl" style={{ fontSize: fs }}>
        {showLabel && (row.rtl ? <g transform={`translate(${GUT + W + 4},0)`}>{label}</g> : <g transform={`translate(${GUT - 4},0)`} textAnchor="end">{label}</g>)}
        {countChanged.has(row.key) && cs >= 8 && (
          <text x={GUT + W + 30} y={y + cs / 2 + 3.5} className="row-count">
            {row.count}
          </text>
        )}
      </g>,
    );
    rowsSvg.push(
      <g
        key={row.key}
        onDoubleClick={(e) => {
          const el = scrollRef.current!;
          const xi = Math.floor((e.clientX - el.getBoundingClientRect().left + el.scrollLeft - GUT) / cs);
          const d = dcols[xi];
          if (d && 'col' in d) onDouble(row, d.col);
        }}
        onPointerMove={(e) => {
          if (drag.current) return;
          const el = scrollRef.current!;
          const xi = Math.floor((e.clientX - el.getBoundingClientRect().left + el.scrollLeft - GUT) / cs);
          const d = dcols[xi];
          setHover(d && 'col' in d ? { row, col: d.col } : null);
        }}
      >
        {parts}
      </g>,
    );
  }

  // Column numbers (stitch 1 at the right, as a RS row is read), every 10 (every 5 when roomy).
  const colLabels: React.ReactNode[] = [];
  const every = cs >= 14 ? 5 : cs >= 6 ? 10 : 20;
  dcols.forEach((d, xi) => {
    if (!('col' in d)) {
      colLabels.push(
        <g key={`gap${xi}`}>
          <rect x={GUT + xi * cs} y={TOP} width={cs} height={H} className="gap-col" />
          <text x={GUT + xi * cs + cs / 2} y={TOP - 6} textAnchor="middle" className="col-label">
            ⋯{d.gap}
          </text>
          <title>{`${d.gap} plain stitches folded`}</title>
        </g>,
      );
      return;
    }
    const n = chart.cols - d.col;
    if (n % every === 0 || n === 1) {
      const x = GUT + xi * cs + cs / 2;
      colLabels.push(
        <text key={`t${d.col}`} x={x} y={TOP - 6} textAnchor="middle" className="col-label">{n}</text>,
        <text key={`b${d.col}`} x={x} y={TOP + H + 14} textAnchor="middle" className="col-label">{n}</text>,
      );
    }
  });

  // Every 10th stitch / row: a stronger grid line.
  const tens: React.ReactNode[] = [];
  if (cs >= 5) {
    dcols.forEach((d, xi) => {
      if ('col' in d && (chart.cols - d.col) % 10 === 0) tens.push(<line key={`v${xi}`} x1={GUT + xi * cs} x2={GUT + xi * cs} y1={TOP} y2={TOP + H} className="ten" />);
    });
    display.forEach((r, i) => {
      if (!r.shortRow && r.knitRow % 10 === 0) {
        const y = chart.topDown ? TOP + (i + 1) * cs : TOP + i * cs;
        tens.push(<line key={`h${i}`} x1={GUT} x2={GUT + W} y1={y} y2={y} className="ten" />);
      }
    });
  }

  // Pattern sections: a bracket in the left gutter and repeat lines.
  const repeats: React.ReactNode[] = chart.repeats.map((rp, k) => {
    const idx = display.map((r, i) => (!r.shortRow && r.knitRow >= rp.fromRow && r.knitRow <= rp.toRow ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return null;
    const y1 = TOP + Math.min(...idx) * cs;
    const y2 = TOP + (Math.max(...idx) + 1) * cs;
    const lines: React.ReactNode[] = [];
    if (rp.multiple > 1) {
      for (let col = rp.startCol + rp.offset; col < chart.cols; col += rp.multiple) {
        const xi = xOfCol.get(col);
        if (xi !== undefined) lines.push(<line key={col} x1={GUT + xi * cs} x2={GUT + xi * cs} y1={y1} y2={y2} className="repeat-line" />);
      }
    }
    return (
      <g key={k}>
        {lines}
        <path d={`M${GUT - 30},${y1 + 2} h-4 V${y2 - 2} h4`} className="repeat-bracket" />
        <text transform={`translate(${GUT - 37},${(y1 + y2) / 2}) rotate(-90)`} textAnchor="middle" className="repeat-label">
          {rp.name}
          {rp.multiple > 1 ? ` · ${rp.multiple}${rp.offset ? ` + ${rp.offset}` : ''}` : ''}
        </text>
      </g>
    );
  });

  const hoverText = hover
    ? `${hover.row.shortRow ? `${hover.row.label} (after row ${hover.row.knitRow})` : `Row ${hover.row.knitRow}`} · ${hover.row.round ? 'round' : hover.row.rs ? 'RS' : 'WS'} ${hover.row.rtl ? '←' : '→'} · st ${chart.cols - hover.col} · ${hover.row.worked} worked · ${hover.row.count} on needle`
    : null;

  return (
    <div className="chart-main">
      <div className="chart-tools">
        <button onClick={() => setCell(cs / 1.25)} title="Zoom out (⌘ + scroll)">−</button>
        <button onClick={() => setCell(cs * 1.25)} title="Zoom in (⌘ + scroll)">+</button>
        <button onClick={() => window.dispatchEvent(new Event('knitbit:fit'))} title="Fit (F)">Fit</button>
        <label className="check" title="Fold long runs of identical plain columns">
          <input type="checkbox" checked={collapse} onChange={(e) => setCollapse(e.target.checked)} /> Collapse plain middle
        </label>
      </div>
      <div className="chart-scroll" ref={scrollRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => setHover(null)}>
        <svg width={GUT * 2 + W + 30} height={TOP + H + BOT} className="chart-svg">
          <defs>
            <pattern id="chart-grid" patternUnits="userSpaceOnUse" x={GUT} y={TOP} width={cs} height={cs}>
              <rect width={cs} height={cs} fill="var(--cell)" />
              {cs >= 5 && <path d={`M${cs},0 V${cs} H0`} fill="none" stroke="var(--grid)" strokeWidth={0.6} />}
            </pattern>
            <pattern id="chart-held" patternUnits="userSpaceOnUse" x={GUT} y={TOP} width={cs} height={cs}>
              <rect width={cs} height={cs} fill="var(--cell-held)" />
              <path d={`M0,${cs} L${cs},0`} stroke="var(--line-strong)" strokeWidth={0.8} />
              {cs >= 5 && <path d={`M${cs},0 V${cs} H0`} fill="none" stroke="var(--grid)" strokeWidth={0.6} />}
            </pattern>
          </defs>
          {rowsSvg}
          {tens}
          {colLabels}
          {repeats}
          <text x={GUT + W / 2} y={chart.topDown ? TOP + H + BOT - 2 : TOP + H + BOT - 2} textAnchor="middle" className="chart-note">
            {chart.topDown ? `Worked top-down: row 1 at the top · cast on ${chart.castOn} sts` : `Cast on ${chart.castOn} sts`}
          </text>
        </svg>
      </div>
      <div className="chart-hint">
        {hoverText ?? `${chart.rows.length} rows · ${chart.cols} sts wide · RS rows read right to left, WS left to right`}
        {markers && !hoverText ? ' · drag a shaping symbol up or down · double-click a stitch to add a marker' : ''}
      </div>
    </div>
  );
}

// ---------- grid of sizes ----------

function GridChart({ project, panel, c, name, cs }: { project: Project; panel: Panel; c: ComputedPanel; name: string; cs: number }) {
  const chart = useMemo(() => (c.ok ? buildChart(project, panel, c) : null), [project, panel, c]);
  if (!chart) return <figure className="chart-card"><figcaption>{name}: can't chart</figcaption></figure>;
  const display = chart.topDown ? chart.rows : [...chart.rows].reverse();
  const custom = project.symbols ?? [];
  return (
    <figure className="chart-card">
      <svg width={chart.cols * cs} height={display.length * cs}>
        {display.map((row, i) => {
          const parts: React.ReactNode[] = [];
          let a = -1;
          let kind = '';
          const flush = (b: number) => {
            if (a >= 0 && kind !== '') parts.push(<rect key={a} x={a * cs} y={i * cs} width={(b - a) * cs} height={cs} fill={kind === HELD ? 'var(--cell-held-strong)' : kind === PLAIN ? 'var(--fill)' : (bandColor(kind, custom) ?? 'var(--fill)')} />);
          };
          row.cells.forEach((v, k) => {
            if (v === kind && a >= 0) return;
            flush(k);
            a = k;
            kind = v;
          });
          flush(row.cells.length);
          return <g key={row.key}>{parts}</g>;
        })}
      </svg>
      <figcaption>
        <strong>{name}</strong> · {chart.cols} sts · {chart.rows.length} rows
      </figcaption>
    </figure>
  );
}

// ---------- legend + custom symbols ----------

function LegendPanel({ chart, project, update }: { chart: Chart | null; project: Project; update: Props['update'] }) {
  const custom = project.symbols ?? [];
  const setSym = (id: Id, patch: Partial<CustomSymbol>, key: string | null = null) =>
    update((p) => {
      const d = structuredClone(p);
      const s = d.symbols?.find((x) => x.id === id);
      if (s) Object.assign(s, patch);
      return d;
    }, key);
  return (
    <aside className="chart-legend">
      <h4>Legend</h4>
      {chart ? (
        <ul>
          {chart.legend.map((l) => (
            <li key={l.id}>
              <Swatch id={l.id} custom={custom} />
              <span>
                {l.abbr && <strong>{l.abbr} </strong>}
                {l.label}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No chart.</p>
      )}
      <h4>My symbols</h4>
      <p className="muted small">Your own stitches, usable as shaping markers (pick them in a marker's Stitch menu).</p>
      {custom.map((s) => (
        <div key={s.id} className="custom-sym">
          <input type="color" value={s.color} onChange={(e) => setSym(s.id, { color: e.target.value }, `sym.${s.id}.color`)} title="Colour" />
          <input className="abbr" value={s.abbr} onChange={(e) => setSym(s.id, { abbr: e.target.value }, `sym.${s.id}.abbr`)} title="Abbreviation" />
          <input value={s.label} onChange={(e) => setSym(s.id, { label: e.target.value }, `sym.${s.id}.label`)} title="Meaning" />
          <input className="num tiny" type="number" value={s.change} onChange={(e) => setSym(s.id, { change: Math.round(Number(e.target.value)) || 0 }, `sym.${s.id}.change`)} title="Stitch change when used as a marker" />
          <button
            className="icon"
            title="Delete symbol"
            onClick={() =>
              update((p) => {
                const d = structuredClone(p);
                d.symbols = (d.symbols ?? []).filter((x) => x.id !== s.id);
                return d;
              })
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          update((p) => {
            const d = structuredClone(p);
            d.symbols = [...(d.symbols ?? []), { id: newId('custom'), label: 'My stitch', abbr: 'X', color: '#f2d17a', change: 0 }];
            return d;
          })
        }
      >
        + Add symbol
      </button>
      {custom.length > 0 && <p className="muted small">Stitch change: {custom.map((s) => `${s.abbr} ${signed(s.change)}`).join(', ')}</p>}
    </aside>
  );
}
