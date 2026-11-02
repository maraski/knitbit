import { describe, expect, it } from 'vitest';
import { fixtureProject, sizeId } from '../engine/testFixtures';
import { CANVAS_MAX_AREA, CANVAS_MAX_SIDE, describe as describeView, limitMessage, pngScale } from './png';
import { effectiveMode, sizesName, viewName, type PngSpec } from './pngViews';
import { pngFileName } from './fileName';

describe('PNG scale and the canvas limit', () => {
  it('keeps the scale asked for when it fits', () => {
    expect(pngScale(1000, 700, 3)).toEqual({ scale: 3, width: 3000, height: 2100, limited: false });
  });
  it('drops to the largest tenth under the side limit', () => {
    // A tall chart: 900 × 7000 px at 1×; 3× would be 21 000 px high.
    const s = pngScale(900, 7000, 3);
    expect(s.limited).toBe(true);
    expect(s.scale).toBe(2.2);
    expect(s.height).toBeLessThanOrEqual(CANVAS_MAX_SIDE);
  });
  it('and under the area limit', () => {
    const s = pngScale(7000, 7000, 3);
    expect(s.limited).toBe(true);
    expect(s.width * s.height).toBeLessThanOrEqual(CANVAS_MAX_AREA);
    expect(s.scale).toBe(2.2);
  });
  it('never drops below a tenth, and says what it did', () => {
    expect(pngScale(1e6, 10, 1).scale).toBe(0.1);
    const s = pngScale(900, 7000, 3);
    expect(limitMessage(3, s)).toBe(`At 3× this image would be bigger than the browser can draw, so it was saved at 2.2× (${s.width} × ${s.height} px).`);
  });
});

describe('what the PNG is called', () => {
  const project = fixtureProject();
  const panel = project.panels[0];
  const M = sizeId(project, 'M');
  const spec = (s: Partial<PngSpec>): PngSpec => ({ project, view: 'schematic', panelId: panel.id, sizeId: M, mode: 'single', compare: project.sizes.map((z) => z.id), align: 'hem', width: 800, height: 600, ...s });

  it('names the view and the size', () => {
    expect(viewName(spec({}))).toBe(`${panel.name} schematic`);
    expect(viewName(spec({ view: 'layout' }))).toBe('layout');
    expect(sizesName(spec({}))).toBe('M');
    expect(sizesName(spec({ mode: 'grid' }))).toBe(`${project.sizes.length}-sizes-grid`);
    expect(pngFileName(project.name, viewName(spec({ view: 'chart' })), sizesName(spec({ view: 'chart' })))).toBe(`${project.name}-${panel.name} chart-M.png`);
    expect(describeView(spec({ mode: 'overlay' }))).toBe(`${panel.name} schematic, ${project.sizes.length} sizes overlaid`);
  });
  it('a chart has no overlay: it exports one size', () => {
    expect(effectiveMode(spec({ view: 'chart', mode: 'overlay' }))).toBe('single');
    expect(effectiveMode(spec({ view: 'chart', mode: 'grid' }))).toBe('grid');
    expect(describeView(spec({ view: 'chart', mode: 'overlay' }))).toBe(`${panel.name} chart, size M`);
  });
});
