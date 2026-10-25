// Render a view off-screen for the export (PDF now, PNG later): the view in its `exportMode`, rendered synchronously
// into a hidden <div>, its CSS (classes, variables) copied onto every SVG element as attributes, and the SVG returned
// detached. svg2pdf.js and an SVG drawn on a canvas know nothing about the page's stylesheet, so after this the SVG
// stands alone.

import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { panelJoins, type PanelCache } from '../engine/joins';
import { buildScope } from '../engine/measurements';
import type { Id, Panel, Project } from '../engine/model';
import { panelExtras, resolvePanelDims, type ComputedPanel } from '../engine/panel';
import { schematicBands } from '../ui/schematicBands';
import { PANEL_SELECTION } from '../ui/selection';
import { exportViews } from './views';

/** Presentation properties copied from the computed style. */
const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'paint-order'];
const COLOURS = new Set(['fill', 'stroke']);

/** "rgba(r, g, b, a)" → the rgb colour and its alpha; other values as they are. */
function splitAlpha(v: string): { colour: string; alpha: number } {
  const m = v.match(/^rgba\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\s*\)$/);
  return m ? { colour: `rgb(${m[1]}, ${m[2]}, ${m[3]})`, alpha: Number(m[4]) } : { colour: v, alpha: 1 };
}

/** Copy each element's computed style onto it as attributes; drop what doesn't draw (tooltips, display: none). */
export function inlineStyles(svg: SVGSVGElement): void {
  for (const t of [...svg.querySelectorAll('title')]) t.remove();
  for (const el of [svg, ...svg.querySelectorAll<SVGElement>('*')]) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') {
      el.remove();
      continue;
    }
    for (const p of PROPS) {
      let v = cs.getPropertyValue(p).trim();
      if (!v) continue;
      if (COLOURS.has(p)) {
        // A url(…) to a pattern or gradient: just the #id. A colour with alpha: the alpha goes into the opacity.
        const url = v.match(/url\(\s*["']?[^#"')]*(#[^"')]+)["']?\s*\)/);
        if (url) v = `url(${url[1]})`;
        else {
          const { colour, alpha } = splitAlpha(v);
          if (alpha === 0) v = 'none';
          else if (alpha < 1) {
            v = colour;
            const op = Number(cs.getPropertyValue(`${p}-opacity`)) || 1;
            el.setAttribute(`${p}-opacity`, String(op * alpha));
          }
        }
      } else if (p === 'fill-opacity' || p === 'stroke-opacity') {
        if (el.hasAttribute(p)) continue; // set from a colour's alpha above
      } else v = v.replace(/px/g, '');
      el.setAttribute(p, v);
    }
    el.removeAttribute('style');
  }
}

/**
 * Render `node` (a view in export mode, whose root is an <svg>) off-screen and return the SVG with its styles inlined,
 * detached from the page. The host is in the document while it renders, out of sight, since a detached element has no
 * computed style.
 */
export function renderSvg(node: ReactNode): SVGSVGElement {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;contain:strict;width:0;height:0;overflow:visible';
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(node));
    const svg = host.querySelector('svg');
    if (!svg) throw new Error('Nothing to export: the view drew no SVG.');
    inlineStyles(svg);
    return svg.cloneNode(true) as SVGSVGElement;
  } finally {
    root.unmount();
    host.remove();
  }
}

export interface Fitted {
  svg: SVGSVGElement;
  /** Drawing px per cm of fabric, after `snap`. */
  pxPerCm: number;
}

/**
 * A piece's schematic as on the Schematic tab in One size mode (a yoke laid flat), fitted to `width` × `height` px.
 */
export async function pieceSvg(project: Project, panel: Panel, c: ComputedPanel, sizeId: Id, width: number, height: number, snap: (pxPerCm: number) => number, cache: PanelCache = new Map()): Promise<Fitted> {
  let node: ReactNode;
  if (c.yoke) {
    // The yoke views are their own chunk, loaded by the app only for a yoke.
    const { YokeFrontSheet } = await import('../ui/components/YokeFrontView');
    node = <YokeFrontSheet computed={c} units={project.units} width={width} height={height} snap={snap} />;
  } else {
    const { Schematic } = exportViews;
    if (!Schematic) throw new Error('The schematic view is not loaded.');
    const scope = { ...buildScope(project, sizeId), ...panelExtras(project, panel, sizeId), ...resolvePanelDims(project, panel, sizeId).values };
    node = (
      <Schematic
        computed={c}
        direction={panel.direction}
        units={project.units}
        selection={PANEL_SELECTION}
        onSelect={() => {}}
        fitKey={panel.id}
        fitOutlines={[]}
        joins={panelJoins(project, panel.id)}
        project={project}
        bands={schematicBands(project, panel, c, sizeId, scope, cache)}
        exportMode={{ width, height, snap }}
      />
    );
  }
  const svg = renderSvg(node);
  return { svg, pxPerCm: Number(svg.getAttribute('data-px-per-cm')) || 1 };
}
