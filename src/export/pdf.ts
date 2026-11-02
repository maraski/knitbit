// The PDF: page frame (header band, footer, "p. N of M"), A4 / Letter, portrait / landscape, and the renderer of each
// part of the plan. Loaded only on export (the dialog imports it with import()); jsPDF and svg2pdf.js are imported
// nowhere else. Text is the built-in Helvetica: see text.ts for the character swaps; arrows are drawn as small SVG
// shapes (svg2pdf), so they stay vector like the chart symbols.
//
// A new kind of page: add its section to plan.ts and a renderer to RENDERERS. A renderer draws from `w.y` down,
// calling `w.ensure(h)` before anything `h` mm tall (it turns the page when needed) or `w.newPage()`.

import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import { exportFooter } from '../engine/garment';
import { cachedPanel, type PanelCache } from '../engine/joins';
import type { Id, Project } from '../engine/model';
import { drawCharts } from './charts';
import { orderedSizes, planExport, type ExportOptions, type Paper, type Part } from './plan';
import { bodyTable, exportDate, finishedTable, headerInfo, joinRows, pieceEntries, piecesTable, type Table } from './tables';
import { helveticaText, printable, splitArrows, type Arrow } from './text';
import { printScale, scaleText, waypointTable, yokeTable } from './schematics';
import type { Fitted } from './render';

export type Orientation = 'portrait' | 'landscape';

/** Paper sizes in mm, portrait. */
export const PAPER_MM: Record<Paper, [number, number]> = { a4: [210, 297], letter: [215.9, 279.4] };
const MARGIN = 12;
const HEADER_BAND = 10;
const FOOTER_BAND = 10;
const PT = 0.3528; // mm per point
const INK: [number, number, number] = [30, 28, 24];
const MUTED: [number, number, number] = [110, 106, 98];
const RULE: [number, number, number] = [190, 186, 178];
const WARN: [number, number, number] = [160, 60, 30];

export interface TextStyle {
  size?: number; // pt
  bold?: boolean;
  color?: [number, number, number];
  align?: 'left' | 'right' | 'center';
}

interface PendingArrow {
  page: number;
  arrow: Arrow;
  x: number;
  y: number; // baseline
  size: number; // mm (the font's cap height or so)
  color: [number, number, number];
}

/** Lays out pages: the content box, a flowing cursor `y`, text in Helvetica, and the frame drawn at the end. */
export class Writer {
  readonly doc: jsPDF;
  y = 0;
  private labels: string[] = [];
  private arrows: PendingArrow[] = [];
  /** The header band's text for pages started from now on. */
  label = '';
  readonly footer: string[];

  constructor(
    readonly paper: Paper,
    footerLines: string[],
  ) {
    this.doc = new jsPDF({ unit: 'mm', format: PAPER_MM[paper], orientation: 'portrait', compress: true });
    this.footer = footerLines;
    this.labels.push('');
    this.y = this.box().top;
  }

  /** The current page's content box (inside the margins, header and footer bands). */
  box(): { left: number; right: number; top: number; bottom: number; width: number; height: number } {
    const w = this.doc.internal.pageSize.getWidth();
    const h = this.doc.internal.pageSize.getHeight();
    const top = MARGIN + HEADER_BAND + 4;
    const bottom = h - MARGIN - this.footerHeight(w) - 3;
    return { left: MARGIN, right: w - MARGIN, top, bottom, width: w - 2 * MARGIN, height: bottom - top };
  }

  /** The content box of a page in the given orientation, before it exists (for choosing one). */
  boxFor(orientation: Orientation): { width: number; height: number } {
    const [a, b] = PAPER_MM[this.paper];
    const [w, h] = orientation === 'portrait' ? [a, b] : [b, a];
    return { width: w - 2 * MARGIN, height: h - MARGIN - this.footerHeight(w) - 3 - (MARGIN + HEADER_BAND + 4) };
  }

  private footerLinesFor(width: number): string[] {
    this.font({ size: 7 });
    return this.footer.flatMap((l) => this.doc.splitTextToSize(this.clean(l), width - 2 * MARGIN) as string[]);
  }

  private footerHeight(width: number): number {
    return Math.max(FOOTER_BAND, this.footerLinesFor(width).length * 3.1 + 2);
  }

  get page(): number {
    return this.doc.getNumberOfPages();
  }

  /** Start a page (the first call uses the document's first page). */
  newPage(orientation: Orientation = 'portrait'): void {
    if (this.fresh) {
      this.fresh = false;
      if (orientation === 'landscape') {
        this.doc.deletePage(1);
        this.doc.addPage(PAPER_MM[this.paper], orientation);
      }
    } else {
      this.doc.addPage(PAPER_MM[this.paper], orientation);
      this.labels.push('');
    }
    this.labels[this.page - 1] = this.label;
    this.y = this.box().top;
  }
  private fresh = true;

  /** Turn the current page, still empty and the last one, to `orientation`. */
  reorient(orientation: Orientation): void {
    const { width, height } = this.doc.internal.pageSize;
    if ((width > height) === (orientation === 'landscape')) return;
    this.doc.deletePage(this.page);
    this.doc.addPage(PAPER_MM[this.paper], orientation);
    this.y = this.box().top;
  }

  /** Room for `h` mm below the cursor, on a new page if this one is full. True when it turned the page. */
  ensure(h: number): boolean {
    if (this.y + h <= this.box().bottom) return false;
    this.newPage();
    return true;
  }

  font(s: TextStyle): void {
    this.doc.setFont('helvetica', s.bold ? 'bold' : 'normal');
    this.doc.setFontSize(s.size ?? 9);
    this.doc.setTextColor(...(s.color ?? INK));
  }

  /** Helvetica-safe text: the swaps made, anything still unprintable as "?". Arrows are kept for `text`. */
  clean(s: string): string {
    let out = '';
    for (const ch of helveticaText(s)) out += ch === '→' || ch === '←' || ch === '↑' || ch === '↓' || printable(ch) ? ch : '?';
    return out;
  }

  private arrowWidth(size: number): number {
    return size * PT * 0.8;
  }

  /** Width of a text in the given style (arrows included). */
  width(s: string, style: TextStyle = {}): number {
    this.font(style);
    const size = style.size ?? 9;
    return splitArrows(this.clean(s)).reduce((a, r) => a + ('text' in r ? this.doc.getTextWidth(r.text) : this.arrowWidth(size)), 0);
  }

  /** Text on one line at baseline `y`; `x` is the left, right or centre per `align`. */
  text(s: string, x: number, y: number, style: TextStyle = {}): void {
    const size = style.size ?? 9;
    const total = this.width(s, style);
    let at = style.align === 'right' ? x - total : style.align === 'center' ? x - total / 2 : x;
    this.font(style);
    for (const r of splitArrows(this.clean(s))) {
      if ('text' in r) {
        this.doc.text(r.text, at, y);
        at += this.doc.getTextWidth(r.text);
      } else {
        this.arrows.push({ page: this.doc.getCurrentPageInfo().pageNumber, arrow: r.arrow, x: at, y, size: size * PT * 0.7, color: style.color ?? INK });
        at += this.arrowWidth(size);
      }
    }
  }

  /** Wrap `s` to `width` mm; returns the lines (cleaned). */
  wrap(s: string, width: number, style: TextStyle = {}): string[] {
    this.font(style);
    return this.doc.splitTextToSize(this.clean(s), width) as string[];
  }

  rule(x1: number, y: number, x2: number, color = RULE, weight = 0.2): void {
    this.doc.setDrawColor(...color);
    this.doc.setLineWidth(weight);
    this.doc.line(x1, y, x2, y);
  }

  /** Header band, footer and page numbers on every page, then the arrows. */
  async finish(date: Date): Promise<Blob> {
    const n = this.page;
    for (let i = 1; i <= n; i++) {
      this.doc.setPage(i);
      const w = this.doc.internal.pageSize.getWidth();
      const h = this.doc.internal.pageSize.getHeight();
      const base = MARGIN + HEADER_BAND - 3;
      this.text(this.labels[i - 1] ?? '', MARGIN, base, { size: 8.5, bold: true });
      this.text(`p. ${i} of ${n}`, w - MARGIN, base, { size: 8.5, color: MUTED, align: 'right' });
      this.rule(MARGIN, MARGIN + HEADER_BAND, w - MARGIN, INK, 0.3);
      const lines = [...this.footerLinesFor(w), `Made with Knitbit · ${exportDate(date)}`];
      const top = h - MARGIN - (lines.length - 1) * 3.1;
      this.rule(MARGIN, top - 4, w - MARGIN);
      lines.forEach((l, k) => this.text(l, MARGIN, top + k * 3.1, { size: 7, color: MUTED }));
    }
    for (const a of this.arrows) {
      this.doc.setPage(a.page);
      // Centred on the lower-case letters' height.
      await svg2pdf(arrowSvg(a.arrow, a.color), this.doc, { x: a.x, y: a.y - a.size * 0.85, width: a.size, height: a.size });
    }
    return this.doc.output('blob');
  }
}

/** A small arrow (pointing right, rotated for the others) as an SVG element for svg2pdf. */
function arrowSvg(arrow: Arrow, color: [number, number, number]): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 10 10');
  svg.setAttribute('width', '10');
  svg.setAttribute('height', '10');
  const g = document.createElementNS(ns, 'g');
  const turn = { '→': 0, '↓': 90, '←': 180, '↑': 270 }[arrow];
  g.setAttribute('transform', `rotate(${turn} 5 5)`);
  const stroke = `rgb(${color.join(',')})`;
  const shaft = document.createElementNS(ns, 'path');
  shaft.setAttribute('d', 'M1 5 H7.5');
  shaft.setAttribute('stroke', stroke);
  shaft.setAttribute('stroke-width', '1.2');
  shaft.setAttribute('fill', 'none');
  const head = document.createElementNS(ns, 'path');
  head.setAttribute('d', 'M5.5 2 L9.5 5 L5.5 8 Z');
  head.setAttribute('fill', stroke);
  g.append(shaft, head);
  svg.append(g);
  return svg;
}

// ---------- tables ----------

const ROW_H = 4.6;
const TABLE_SIZE = 8.5;

/** A table at the cursor, full width; it flows onto the next pages with the heading row repeated. */
export function drawTable(w: Writer, t: Table): void {
  const totalWeight = t.columns.reduce((a, c) => a + (c.weight ?? 1), 0);
  // About 25 mm per unit of weight, up to the full width (a table for one size stays narrow).
  const { left } = w.box();
  const width = Math.min(w.box().width, totalWeight * 25);
  // Columns are fitted to the content box; with many sizes the text shrinks rather than overflowing (the first
  // column's labels are cut instead).
  const widths = t.columns.map((c) => (width * (c.weight ?? 1)) / totalWeight);
  const widest = Math.max(...t.columns.map((c, i) => (i === 0 ? 0 : Math.max(w.width(c.label, { size: TABLE_SIZE, bold: true }), ...t.rows.map((r) => w.width(r.cells[i] ?? '', { size: TABLE_SIZE }))) / (widths[i] - 2))));
  const size = widest > 1 ? Math.max(6, TABLE_SIZE / widest) : TABLE_SIZE;
  const xs = widths.map((_, i) => left + widths.slice(0, i).reduce((a, b) => a + b, 0));

  const cell = (text: string, i: number, y: number, style: TextStyle) => {
    const c = t.columns[i];
    const x = c.align === 'right' ? xs[i] + widths[i] - 1 : xs[i] + (i === 0 ? 0 : 1);
    // A first-column label too long for its column is cut with an ellipsis (the column is the widest one).
    let s = text;
    if (i === 0) while (s.length > 1 && w.width(s, style) > widths[i] - 1.5) s = s.slice(0, -2) + '…';
    w.text(s, x, y, { ...style, align: c.align === 'right' ? 'right' : 'left' });
  };
  const heading = () => {
    t.columns.forEach((c, i) => cell(c.label, i, w.y + ROW_H - 1.3, { size, bold: true }));
    w.y += ROW_H;
    w.rule(left, w.y - 0.2, left + width, INK, 0.3);
    w.y += 0.6;
  };

  w.ensure(ROW_H * 3);
  heading();
  t.rows.forEach((r, k) => {
    // Keep a piece's rows together when the group fits on one page.
    let need = ROW_H;
    if (r.groupStart) {
      let end = k + 1;
      while (end < t.rows.length && !t.rows[end].groupStart) end++;
      const group = (end - k) * ROW_H;
      if (group <= w.box().height - 2 * ROW_H) need = group;
    }
    if (w.ensure(need)) heading();
    else if (r.groupStart && k > 0) w.rule(left, w.y, left + width);
    r.cells.forEach((text, i) => cell(text, i, w.y + ROW_H - 1.3, { size }));
    w.y += ROW_H;
  });
  if (t.note) {
    w.ensure(ROW_H);
    w.text(t.note, left, w.y + ROW_H - 1.3, { size: 7.5, color: MUTED });
    w.y += ROW_H;
  }
}

// ---------- renderers ----------

export interface RenderContext {
  project: Project;
  options: ExportOptions;
  sizeIds: Id[];
  date: Date;
  cache: PanelCache;
}

export type Renderer = (w: Writer, part: Part, ctx: RenderContext) => void | Promise<void>;

const section = (w: Writer, t: Table) => {
  w.y += 5;
  w.ensure(ROW_H * 4);
  drawTable(w, t);
};

export const RENDERERS: Partial<Record<Part['section'], Renderer>> = {
  header: (w, _part, { project, sizeIds, date }) => {
    const h = headerInfo(project, sizeIds, date);
    const { left, width } = w.box();
    const title = w.wrap(h.title, width, { size: 16, bold: true });
    for (const line of title) {
      w.y += 6.5;
      w.text(line, left, w.y, { size: 16, bold: true });
    }
    w.y += 2;
    for (const line of h.lines) {
      for (const l of w.wrap(line, width, { size: 9.5 })) {
        w.y += 4.6;
        w.text(l, left, w.y, { size: 9.5 });
      }
    }
    w.y += 2;
  },
  notes: (w, _p, { project }) => drawNotes(w, project.notes ?? ''),
  body: (w, _p, { project, sizeIds }) => section(w, bodyTable(project, sizeIds)),
  finished: (w, _p, { project, sizeIds, cache }) => section(w, finishedTable(project, sizeIds, cache)),
  pieces: (w, _p, { project, sizeIds, cache }) => section(w, piecesTable(project, sizeIds, cache)),
  schematics: (w, part, ctx) => drawSchematics(w, part, ctx),
  yoke: (w, part, ctx) => drawYokeTop(w, part, ctx),
  layout: (w, part, ctx) => drawLayout(w, part, ctx),
  joins: (w, part, ctx) => drawJoins(w, part, ctx),
  charts: drawCharts,
};

const sizeLabel = (project: Project, sizeId: Id) => project.sizes.find((s) => s.id === sizeId)?.name ?? '?';

/** The project's notes under the header: paragraphs as typed, wrapped, flowing onto the next pages when long. */
function drawNotes(w: Writer, notes: string): void {
  const { left, width } = w.box();
  const LINE = 4.3;
  w.y += 3;
  w.ensure(LINE * 3);
  w.y += LINE;
  w.text('Notes', left, w.y, { size: 9.5, bold: true });
  w.y += 1;
  for (const para of notes.trim().split(/\r?\n/)) {
    // An empty line in the notes is a half-line gap.
    if (!para.trim()) {
      w.y += LINE / 2;
      continue;
    }
    for (const l of w.wrap(para, width, { size: 9 })) {
      w.ensure(LINE);
      w.y += LINE;
      w.text(l, left, w.y, { size: 9 });
    }
  }
  w.y += 2;
}

/**
 * The joins table for the part's size: each join's name and kind on the left, what to do (with the stitch and row
 * counts), the edges it joins and its note on the right. Flows after the layout when that's printed, else on its own
 * page; a join is never split across pages.
 */
function drawJoins(w: Writer, part: Part, { project, cache }: RenderContext): void {
  const rows = joinRows(project, part.sizeId!, cache);
  const { left, right, width } = w.box();
  const nameW = Math.min(52, width * 0.3);
  const textW = width - nameW - 3;
  const LINE = 4.1;
  const SMALL = 3.3;
  w.y += part.newPage ? 5 : 8;
  w.ensure(16);
  w.text(`Joins · size ${sizeLabel(project, part.sizeId!)}`, left, w.y, { size: 12, bold: true });
  w.y += 3;
  w.rule(left, w.y, right, INK, 0.3);
  if (!rows.length) {
    w.y += 6;
    w.text('This project has no joins.', left, w.y, { size: 9.5, color: MUTED });
    return;
  }
  for (const r of rows) {
    const name = w.wrap(r.name, nameW, { size: 9, bold: true });
    const kind = w.wrap(r.kind, nameW, { size: 7.5 });
    const text = w.wrap(r.text, textW, { size: 9 });
    const edges = w.wrap(r.edges, textW, { size: 7.5 });
    const note = r.note ? w.wrap(`Note: ${r.note}`, textW, { size: 7.5 }) : [];
    const h = Math.max(name.length * LINE + kind.length * SMALL, text.length * LINE + (edges.length + note.length) * SMALL) + 2.5;
    w.ensure(h);
    const top = w.y + 1.2;
    let y = top;
    for (const l of name) w.text(l, left, (y += LINE), { size: 9, bold: true });
    for (const l of kind) w.text(l, left, (y += SMALL), { size: 7.5, color: MUTED });
    y = top;
    const x = left + nameW + 3;
    for (const l of text) w.text(l, x, (y += LINE), { size: 9, bold: r.problem, color: r.problem ? WARN : INK });
    for (const l of edges) w.text(l, x, (y += SMALL), { size: 7.5, color: MUTED });
    for (const l of note) w.text(l, x, (y += SMALL), { size: 7.5 });
    w.y += h;
    w.rule(left, w.y, right);
  }
}

/** The header band's text: the project, and the size for per-size pages (else the ticked sizes). */
function bandLabel(project: Project, sizeIds: Id[], part: Part): string {
  const name = (id: Id) => project.sizes.find((s) => s.id === id)?.name ?? '?';
  const sizes = part.sizeId ? `size ${name(part.sizeId)}` : `size${sizeIds.length === 1 ? '' : 's'} ${sizeIds.map(name).join(', ')}`;
  return `${project.name.trim() || 'Untitled'} · ${sizes}`;
}

/**
 * Build the PDF for the ticked sizes and sections. `onProgress(done, total)` after each part; the browser gets a
 * turn between parts so a long export doesn't freeze the tab.
 */
export async function buildPdf(project: Project, options: ExportOptions, opts: { date?: Date; onProgress?: (done: number, total: number) => void } = {}): Promise<Blob> {
  const date = opts.date ?? new Date();
  const sizeIds = orderedSizes(project, options.sizeIds);
  const ctx: RenderContext = { project, options, sizeIds, date, cache: new Map() };
  const parts = planExport(project, { ...options, sizeIds });
  const w = new Writer(options.paper, exportFooter(project));
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    w.label = bandLabel(project, sizeIds, part);
    if (part.newPage) w.newPage();
    await RENDERERS[part.section]?.(w, part, ctx);
    opts.onProgress?.(i + 1, parts.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return w.finish(date);
}

// ---------- schematics ----------

/** How big a drawing px prints: 10.5 px labels come out at about 7.8 pt. */
const MM_PER_PX = 0.26;

/** Text in a rendered SVG made Helvetica-safe; text halos (paint-order: stroke) dropped, as svg2pdf paints them on top. */
function forPdf(svg: SVGSVGElement, w: Writer): void {
  for (const t of svg.querySelectorAll<SVGElement>('text, tspan')) {
    t.setAttribute('font-family', 'helvetica');
    const weight = t.getAttribute('font-weight') ?? '';
    t.setAttribute('font-weight', weight === 'bold' || Number(weight) >= 600 ? 'bold' : 'normal');
    if ((t.getAttribute('paint-order') ?? '').startsWith('stroke')) t.setAttribute('stroke', 'none');
    t.removeAttribute('paint-order');
    for (const n of t.childNodes) if (n.nodeType === 3) n.textContent = w.clean(n.textContent ?? '').replace(/[→←↑↓]/g, '-');
  }
}

/** A table's height as drawTable lays it out (heading, rows, note). */
const tableHeight = (t: Table) => (t.rows.length + 1) * ROW_H + 0.6 + (t.note ? ROW_H : 0);

/**
 * One page per piece for the part's size: the title (piece, size, "make 2"), the scale, the drawing fitted to the
 * page at a standard scale, and the waypoint (or yoke phase) table under it. A page turns landscape when the drawing
 * prints bigger that way.
 */
async function drawSchematics(w: Writer, part: Part, { project, cache }: RenderContext): Promise<void> {
  const sizeId = part.sizeId!;
  const sizeName = project.sizes.find((s) => s.id === sizeId)?.name ?? '?';
  const snap = (px: number) => printScale(px, MM_PER_PX).pxPerCm;
  const { pieceSvg } = await import('./render');
  const [pw, ph] = PAPER_MM[w.paper];
  const TITLE_H = 9;
  const entries = pieceEntries(project);
  for (let i = 0; i < entries.length; i++) {
    const { panel, make } = entries[i];
    const c = cachedPanel(project, panel.id, sizeId, cache);
    const table = c?.ok ? (c.yoke ? yokeTable(c, project.units) : waypointTable(c, project.units)) : null;
    // The content box in each orientation (the frame takes the same height off both). A long table keeps the
    // drawing at least 60% of the page and flows on.
    const frame = w.doc.internal.pageSize.getHeight() - w.box().height;
    const boxes = (['portrait', 'landscape'] as const).map((o) => {
      const [W, H] = o === 'portrait' ? [pw, ph] : [ph, pw];
      const room = H - frame - TITLE_H;
      return { o, width: W - 2 * MARGIN, height: room - 14 - Math.min(table ? tableHeight(table) : 0, room * 0.4) };
    });
    const fits = [];
    if (c?.ok) for (const b of boxes.filter((b) => b.height > 40)) fits.push({ ...b, ...(await pieceSvg(project, panel, c, sizeId, b.width / MM_PER_PX, b.height / MM_PER_PX, snap, cache)) });
    const best = fits.length ? fits.reduce((a, b) => (b.pxPerCm > a.pxPerCm + 1e-9 ? b : a)) : null;
    const o = best?.o ?? 'portrait';
    if (i === 0) w.reorient(o);
    else w.newPage(o);
    const { left, right, width } = w.box();
    w.y += 5;
    w.text(`${panel.name} · size ${sizeName}`, left, w.y, { size: 12, bold: true });
    const n = best ? printScale(best.pxPerCm, MM_PER_PX).n : null;
    w.text([make, n !== null ? `scale ${scaleText(n)}` : ''].filter(Boolean).join(' · '), right, w.y, { size: 9.5, bold: !!make, align: 'right' });
    w.y += TITLE_H - 5;
    if (!c?.ok || !best || !table) {
      const why = c?.issues.find((x) => x.severity === 'error')?.message ?? '';
      for (const l of w.wrap(`This piece can't be drawn in size ${sizeName}. ${why}`, width, { size: 9.5 })) {
        w.y += 5;
        w.text(l, left, w.y, { size: 9.5 });
      }
      continue;
    }
    // At the drawing's own size (the scale is exact), centred across the page.
    forPdf(best.svg, w);
    const dw = Math.min(width, Number(best.svg.getAttribute('width')) * MM_PER_PX || best.width);
    const dh = Math.min(best.height, Number(best.svg.getAttribute('height')) * MM_PER_PX || best.height);
    w.y += 4;
    await svg2pdf(best.svg, w.doc, { x: left + (width - dw) / 2, y: w.y, width: dw, height: dh });
    w.y += dh + 6;
    drawTable(w, table);
  }
}

// ---------- yoke top view and layout ----------

/** A drawing fitted to the page by its view (not snapped to a standard scale): "1 : 7.3". */
const fittedScale = (pxPerCm: number) => scaleText(Math.round((10 / (pxPerCm * MM_PER_PX)) * 10) / 10);

/**
 * A page with a title and one drawing fitted to it, portrait or landscape (whichever prints it bigger). `render`
 * draws the view into a box of the given px; `keep` (mm) is left free under the drawing (the joins after the layout).
 * With `why`, nothing is drawn and the page says why.
 */
async function drawFittedPage(w: Writer, title: string, render: (wpx: number, hpx: number) => Promise<Fitted>, opts: { keep?: number; why?: string } = {}): Promise<void> {
  const [pw, ph] = PAPER_MM[w.paper];
  const TITLE_H = 9;
  const frame = w.doc.internal.pageSize.getHeight() - w.box().height;
  const fits: (Fitted & { o: Orientation; width: number; height: number })[] = [];
  if (!opts.why) {
    for (const o of ['portrait', 'landscape'] as const) {
      const [W, H] = o === 'portrait' ? [pw, ph] : [ph, pw];
      const room = H - frame - TITLE_H - 6;
      const box = { width: W - 2 * MARGIN, height: room - Math.min(opts.keep ?? 0, room * 0.4) };
      fits.push({ o, ...box, ...(await render(box.width / MM_PER_PX, box.height / MM_PER_PX)) });
    }
  }
  const best = fits.length ? fits.reduce((a, b) => (b.pxPerCm > a.pxPerCm + 1e-9 ? b : a)) : null;
  w.newPage(best?.o ?? 'portrait');
  const { left, right, width } = w.box();
  w.y += 5;
  w.text(title, left, w.y, { size: 12, bold: true });
  if (best) w.text(`scale ${fittedScale(best.pxPerCm)}`, right, w.y, { size: 9.5, align: 'right' });
  w.y += TITLE_H - 5;
  if (!best) {
    for (const l of w.wrap(opts.why ?? '', width, { size: 9.5 })) {
      w.y += 5;
      w.text(l, left, w.y, { size: 9.5 });
    }
    return;
  }
  forPdf(best.svg, w);
  const dw = Math.min(width, Number(best.svg.getAttribute('width')) * MM_PER_PX || best.width);
  const dh = Math.min(best.height, Number(best.svg.getAttribute('height')) * MM_PER_PX || best.height);
  w.y += 4;
  await svg2pdf(best.svg, w.doc, { x: left + (width - dw) / 2, y: w.y, width: dw, height: dh });
  w.y += dh + 2;
}

/** Each yoke seen from above, a page per yoke for the part's size. */
async function drawYokeTop(w: Writer, part: Part, { project, cache }: RenderContext): Promise<void> {
  const sizeId = part.sizeId!;
  const { yokeTopSvg } = await import('./render');
  for (const panel of project.panels.filter((p) => p.yoke)) {
    const c = cachedPanel(project, panel.id, sizeId, cache);
    const why = c?.ok && c.yoke ? undefined : `This yoke can't be drawn in size ${sizeLabel(project, sizeId)}. ${c?.issues.find((x) => x.severity === 'error')?.message ?? ''}`;
    await drawFittedPage(w, `${panel.name} top view · size ${sizeLabel(project, sizeId)}`, (wpx, hpx) => yokeTopSvg(project, panel, c!, wpx, hpx), { why });
  }
}

/** The Layout tab for the part's size; the joins table flows on under it, so room is kept for it. */
async function drawLayout(w: Writer, part: Part, { project, options, cache }: RenderContext): Promise<void> {
  const sizeId = part.sizeId!;
  const { layoutSvg } = await import('./render');
  const joins = options.sections.includes('joins') ? (project.joins ?? []).length : 0;
  const why = project.panels.length ? undefined : 'This project has no pieces.';
  await drawFittedPage(w, `Layout · size ${sizeLabel(project, sizeId)}`, (wpx, hpx) => layoutSvg(project, sizeId, wpx, hpx, cache), { keep: joins ? 20 + 12 * joins : 0, why });
}
