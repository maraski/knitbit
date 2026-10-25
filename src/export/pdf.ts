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
import type { PanelCache } from '../engine/joins';
import type { Id, Project } from '../engine/model';
import { drawCharts } from './charts';
import { orderedSizes, planExport, type ExportOptions, type Paper, type Part } from './plan';
import { bodyTable, exportDate, finishedTable, headerInfo, piecesTable, type Table } from './tables';
import { helveticaText, printable, splitArrows, type Arrow } from './text';

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
  body: (w, _p, { project, sizeIds }) => section(w, bodyTable(project, sizeIds)),
  finished: (w, _p, { project, sizeIds, cache }) => section(w, finishedTable(project, sizeIds, cache)),
  pieces: (w, _p, { project, sizeIds, cache }) => section(w, piecesTable(project, sizeIds, cache)),
  charts: drawCharts,
};

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
