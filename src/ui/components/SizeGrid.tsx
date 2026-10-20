import { SizeName } from './EstMark';
import { bbox, type AlignRef } from '../../engine/layout';
import type { Id, Project } from '../../engine/model';
import type { Point } from '../../engine/panel';
import { sizeColor } from '../sizeColors';

export function SizeLegend({ project, sizes, current, align }: { project: Project; sizes: Id[]; current: Id; align?: AlignRef }) {
  return (
    <div className="size-legend">
      {align && <span className="muted">aligned at {align}</span>}
      {project.sizes
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => sizes.includes(s.id))
        .map(({ s, i }) => (
          <span key={s.id} className={s.id === current ? 'current' : ''}>
            <i style={{ background: sizeColor(i, project.sizes.length) }} />
            <SizeName project={project} size={s} />
          </span>
        ))}
    </div>
  );
}

export interface GridCell {
  sid: Id;
  name: string;
  shapes: Point[][]; // world cm, y up
  caption?: string;
}

/** Lays out cells in a grid at one shared scale. */
export function SizeGrid({ cells, size, project }: { cells: GridCell[]; size: { w: number; h: number }; project: Project }) {
  if (!cells.length) return null;
  const boxes = cells.map((c) => bbox(c.shapes.flat()));
  const cw = Math.max(...boxes.map((b) => b.maxX - b.minX), 1);
  const ch = Math.max(...boxes.map((b) => b.maxY - b.minY), 1);
  const n = cells.length;
  let best = { cols: 1, scale: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const scale = Math.min((size.w - 24) / cols / (cw * 1.15), (size.h - 24) / rows / (ch * 1.15 + 28 / 1));
    if (scale > best.scale) best = { cols, scale };
  }
  const { cols, scale } = best;
  const cellW = cw * 1.15 * scale;
  const cellH = ch * 1.15 * scale + 22;
  return (
    <svg width={size.w} height={size.h} className="schematic">
      {cells.map((cell, i) => {
        const b = boxes[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x0 = 12 + col * cellW + (cellW - (b.maxX - b.minX) * scale) / 2;
        const y0 = 12 + row * cellH + 18 + (cellH - 22 - (b.maxY - b.minY) * scale) / 2;
        const scr = (p: Point) => `${(x0 + (p.x - b.minX) * scale).toFixed(1)},${(y0 + (b.maxY - p.y) * scale).toFixed(1)}`;
        const idx = project.sizes.findIndex((s) => s.id === cell.sid);
        return (
          <g key={cell.sid}>
            <text x={12 + col * cellW + cellW / 2} y={12 + row * cellH + 12} textAnchor="middle" className="grid-label">
              {cell.name}
              {cell.caption ? ` · ${cell.caption}` : ''}
            </text>
            {cell.shapes.map((pts, k) => (
              <path key={k} d={'M' + pts.map(scr).join('L') + 'Z'} className="grid-shape" style={{ stroke: sizeColor(idx, project.sizes.length) }} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
