// PNG of the view on screen: the view drawn off-screen as an SVG (pngViews.tsx), serialised, drawn on a canvas on a
// white background at 1×, 2× or 3×, and saved with `toBlob('image/png')`. No library.
//
// A canvas has a size limit (Chrome: about 16 000 px a side, 268 M pixels; Safari is lower on area). A whole chart
// at 3× can pass it, so the scale drops to the largest that fits, and the caller says so.

import { pngFileName } from './fileName';
import { effectiveMode, sizesName, viewName, viewSvg, type PngSpec } from './pngViews';

/** The canvas limits kept to (a little under Chrome's 16 384 px a side; Safari's 16 777 216 px area on iOS aside). */
export const CANVAS_MAX_SIDE = 16000;
export const CANVAS_MAX_AREA = 268_000_000;

export const PNG_SCALES = [1, 2, 3] as const;

export interface PngScale {
  /** The scale used. */
  scale: number;
  /** The PNG's size in px. */
  width: number;
  height: number;
  /** The scale asked for didn't fit the canvas limit. */
  limited: boolean;
}

/**
 * The scale to draw a `width` × `height` px drawing at: `want`, or, when that passes the canvas limit, the largest
 * scale that fits, rounded down to a tenth.
 */
export function pngScale(width: number, height: number, want: number, limits = { side: CANVAS_MAX_SIDE, area: CANVAS_MAX_AREA }): PngScale {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const max = Math.min(limits.side / w, limits.side / h, Math.sqrt(limits.area / (w * h)));
  const fits = want <= max + 1e-9;
  const scale = fits ? want : Math.max(0.1, Math.floor(max * 10 + 1e-9) / 10);
  return { scale, width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), limited: !fits };
}

/** "3×" / "2.4×". */
export const scaleText = (s: number) => `${+s.toFixed(1)}×`;

/** The message when the scale had to drop. */
export function limitMessage(want: number, got: PngScale): string {
  return `At ${scaleText(want)} this image would be bigger than the browser can draw, so it was saved at ${scaleText(got.scale)} (${got.width} × ${got.height} px).`;
}

/** An SVG (width and height in px) drawn on a white canvas at `scale`, as a PNG blob. */
export async function svgToPng(svg: SVGSVGElement, scale: number): Promise<Blob> {
  const w = Number(svg.getAttribute('width'));
  const h = Number(svg.getAttribute('height'));
  if (!(w > 0 && h > 0)) throw new Error('Nothing to export: the view has no size.');
  const px = { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
  // Drawn at its final size, so lines and text stay sharp (not a 1× bitmap stretched).
  svg.setAttribute('width', String(px.width));
  svg.setAttribute('height', String(px.height));
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const text = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = px.width;
    canvas.height = px.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser couldn’t make an image that big.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, px.width, px.height);
    ctx.drawImage(img, 0, 0, px.width, px.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    // A canvas past the browser's own limit gives no blob rather than an error.
    if (!blob) throw new Error('This browser couldn’t make an image that big: try a smaller scale.');
    // Let the browser drop the bitmap now rather than whenever the canvas is collected.
    canvas.width = canvas.height = 0;
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface PngResult {
  blob: Blob;
  fileName: string;
  size: PngScale;
  /** Said to the user: the scale was lowered to fit. */
  note: string | null;
}

/** The view on screen as a PNG at `want`× (or less, to fit the canvas limit). */
export async function buildPng(spec: PngSpec, want: number): Promise<PngResult> {
  const svg = await viewSvg(spec);
  const size = pngScale(Number(svg.getAttribute('width')), Number(svg.getAttribute('height')), want);
  const blob = await svgToPng(svg, size.scale);
  return { blob, fileName: pngFileName(spec.project.name, viewName(spec), sizesName(spec)), size, note: size.limited ? limitMessage(want, size) : null };
}

/** "Back schematic, size M" / "layout, 4 sizes in a grid": what the dialog says it saves. */
export function describe(spec: PngSpec): string {
  const mode = effectiveMode(spec);
  const name = viewName(spec);
  const what = name.charAt(0).toUpperCase() + name.slice(1);
  if (mode === 'single') return `${what}, size ${sizesName(spec)}`;
  return `${what}, ${spec.compare.length} sizes ${mode === 'grid' ? 'in a grid' : 'overlaid'}`;
}

/** The size the PNG would be at each scale (for the dialog), without drawing it. */
export async function pngSizes(spec: PngSpec): Promise<PngScale[]> {
  const svg = await viewSvg(spec);
  const w = Number(svg.getAttribute('width'));
  const h = Number(svg.getAttribute('height'));
  return PNG_SCALES.map((s) => pngScale(w, h, s));
}
