// The size legend drawn in the SVG itself, for the export (an image has no HTML around it). Its own module, so the
// main chunk (which has SizeGrid) doesn't carry it.

import { sizeText } from './EstMark';
import type { AlignRef } from '../../engine/layout';
import type { Id, Project } from '../../engine/model';
import { sizeColor } from '../sizeColors';

/** A swatch and the name per size, in one row from `x`, `y` (the swatches' top), wrapping at `width`; the current size in bold. */
export function SizeLegendSvg({ project, sizes, current, align, x, y, width }: { project: Project; sizes: Id[]; current: Id; align?: AlignRef; x: number; y: number; width: number }) {
  const items: { text: string; colour?: string; bold?: boolean }[] = [];
  if (align) items.push({ text: `aligned at ${align}` });
  project.sizes.forEach((s, i) => {
    if (sizes.includes(s.id)) items.push({ text: sizeText(s, project), colour: sizeColor(i, project.sizes.length), bold: s.id === current });
  });
  let cx = x;
  let cy = y;
  return (
    <g className="size-legend-svg">
      {items.map((it, k) => {
        const w = (it.colour ? 14 : 0) + it.text.length * 6.2 + 12;
        if (cx > x && cx + w > x + width) {
          cx = x;
          cy += 16;
        }
        const at = { x: cx, y: cy };
        cx += w;
        return (
          <g key={k}>
            {it.colour && <rect x={at.x} y={at.y} width={10} height={10} rx={2} fill={it.colour} />}
            <text x={at.x + (it.colour ? 14 : 0)} y={at.y + 9} style={{ fontSize: 11.5, fontWeight: it.bold ? 700 : 400, fill: it.colour ? 'var(--fg)' : 'var(--muted)' }}>
              {it.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Height of `SizeLegendSvg`'s first line plus a gap: room to keep for it under a drawing. */
export const LEGEND_SVG_H = 28;
