// A chart sheet (ChartSheet / KeySwatches) rendered off-screen into a plain SVG element for svg2pdf. The glyphs
// from ui/glyphs.tsx are styled by class on screen (app.css); here those classes become attributes, since svg2pdf
// doesn't read stylesheets. Kept apart from pdf.ts so the PDF tests (Node, no DOM) can stand it in.

import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

/** Render `node` (an <svg>) into a detached element and return it, glyph classes turned into attributes. */
export function renderSvg(node: ReactElement, ink: string): SVGSVGElement {
  const host = document.createElement('div');
  const root = createRoot(host);
  flushSync(() => root.render(node));
  const svg = host.querySelector('svg');
  if (!svg) throw new Error('chart sheet did not render');
  svg.remove();
  root.unmount();
  for (const el of svg.querySelectorAll('.glyph')) {
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', ink);
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
  }
  for (const el of svg.querySelectorAll('.glyph-fill')) el.setAttribute('fill', ink);
  for (const el of svg.querySelectorAll<SVGTextElement>('.glyph-text')) {
    el.setAttribute('fill', ink);
    el.setAttribute('font-weight', 'bold');
    if (el.style.fontSize) el.setAttribute('font-size', String(parseFloat(el.style.fontSize)));
    el.removeAttribute('style');
  }
  return svg;
}
