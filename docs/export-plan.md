# Plan: PDF and PNG export

Goal: print a project to knit from. One click makes a PDF with the gauge, the size table, every piece's schematic
and its stitch chart for the sizes you pick, and any view on screen can be saved as a PNG.

**Status: planned (2026-10-22), nothing built.** This replaces the short M11 outline in HANDOFF.md §5. The credit
footer is already in place: `exportFooter()` in [garment.ts](../src/engine/garment.ts), tested in
[garment.test.ts](../src/engine/garment.test.ts), switched by `settings.exportCredit` (Garment tab, on by default).

## Decisions (the user's answers, 2026-10-22)

| Question | Answer |
|---|---|
| Who it's for | **A working copy to knit from.** No cover page, branding or copyright block. The contiguous credit goes in the footer when the project uses that method. A "pattern to share" layout can come later. |
| Written instructions | **Visual only**, as Knitbit is today: schematics, tables, charts, joins. The only text is short facts the engine already works out (cast-on, stitch counts at waypoints, rows). No row-by-row prose. |
| v1 sections, in order | **Header** (name, gauge, units, sizes, date) → **size table** → **schematic per piece** → **stitch chart per piece with a symbol key**. |
| Where it happens | **In the browser: jsPDF + svg2pdf.js**, loaded only when you export (already allowed in HANDOFF §3). Not the print dialog. |
| Sizes | **Pick sizes, one PDF.** The dialog ticks the current size; tick more to add them. |
| Paper | **A4 portrait by default, A4 / US Letter choice in the dialog** (remembered). A page turns landscape when its content fits better that way. |
| Charts bigger than a page | **Tile at a readable cell size**, split by rows and, if needed, by stitches, with row/stitch numbers on every tile, one row/column of overlap and "continues on p. N" marks. |
| Colour | **Colour, but black-and-white safe**: the app's tints stay, and every symbol is also a black glyph, so a mono printer loses nothing. |
| Schematic scale | **Fit to page**, with the scale noted (for example "1 : 4"). Dimensions are labelled anyway. |
| PNG | **The current view as an image** (schematic, chart, layout or yoke top view) at 1×, 2× or 3×, white background, no hover or drag handles. |
| Later (after v1) | **Yoke top view** page, **layout + joins** page with a joins table, a free-text **notes** field printed under the header. Not wanted: a checks summary. |

Defaults chosen without asking (say if any is wrong):

- **Order by size, then piece.** With several sizes ticked, the PDF has the header and size table once, then a section
  per size (schematics, then charts), so you can print just your size's pages. The size table shows only the ticked
  sizes, with the base size marked.
- **Units** are the project's units (cm or inches, decimals as in the app); stitch and row counts are the same in both.
- **File name:** `<project name>-<size>.pdf` for one size, `<project name>-<n>-sizes.pdf` for more,
  `<project name>-<view>-<size>.png` for a PNG. Characters that aren't allowed in file names become `-`.
- **Chart cell size** 4.5 mm (about 6 rows to the inch), smallest allowed 3.5 mm. The collapse-plain-middle option
  from the Chart tab applies to the export too when it is on, so wide plain pieces take fewer tiles.
- **Size table v1** = the body measurements per size (as on the Measurements tab, read-only, without rules or
  estimates marks) plus a key-numbers table per piece: cast-on, stitches at each waypoint, total rows, length. Finished
  garment circumferences (chest, hip, upper arm summed over the pieces) are an open question below.

## What gets exported: page by page

A4 portrait is 210 × 297 mm. Margins 12 mm; header band 10 mm; footer band 10 mm. Every page has the same frame:

```
┌───────────────────────────────────────────────┐
│ Raglan cardigan · size M          p. 3 of 14  │  header band: project · size · page
├───────────────────────────────────────────────┤
│                                               │
│                 (page content)                │
│                                               │
├───────────────────────────────────────────────┤
│ This garment is worked seamlessly from the    │  footer: exportFooter() lines (if any),
│ top-down using the contiguous sleeve method…  │  then "Made with Knitbit · 22 Oct 2026"
└───────────────────────────────────────────────┘
```

**Page 1: header and size table**

```
┌───────────────────────────────────────────────┐
│ RAGLAN CARDIGAN                               │
│ Gauge 22 sts × 30 rows = 10 cm (after blocking│
│ Units cm · Sizes M, L · Exported 22 Oct 2026  │
│ Construction: top-down, cardigan              │
│ [later: notes]                                │
│                                               │
│ Body measurements          M*      L          │
│ ─────────────────────────────────────────     │
│ Bust                       96     106         │
│ Upper chest                90      98         │
│ Waist                      80      90         │
│ …                                             │
│ * base size                                   │
│                                               │
│ Pieces       Cast on   Rows   Length          │
│ Back         M 106     L 118  …               │
│ Front (L/R)  …                                │
│ Sleeve ×2    …                                │
└───────────────────────────────────────────────┘
```

Long tables flow onto the next page with the heading row repeated.

**Then, per ticked size: one schematic page per piece**

```
┌───────────────────────────────────────────────┐
│ Back · size M                    scale 1 : 4  │
│                                               │
│        ┌──────────────────────┐ ← 26 cm / 58 st│
│       /                        \              │
│      │                          │ ─ waypoint  │
│      │                          │   labels    │
│      │                          │             │
│      └──────────────────────────┘             │
│         48 cm · 106 sts                       │
│                                               │
│ Waypoint      Height  Rows  Sts               │
│ Hem              0      0   106               │
│ Waist           14     42    96               │
│ …                                             │
└───────────────────────────────────────────────┘
```

The schematic is the same drawing as the Schematic tab in *One size* mode, minus the interactive layers. A pair of
cardigan fronts prints as one page (the left front, labelled "make 2, mirrored"), as does a sleeve.

**Then, per ticked size: the charts of each piece, tiled**

```
┌───────────────────────────────────────────────┐
│ Back chart · size M · rows 1–52 · sts 1–40    │
│ tile 1 of 6                             [map] │
│  52 ▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢ │ │
│  …                                       → p.6│
│   1 ▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢ │ │
│     40      30        20        10        1   │
│ ↑ continues on p. 7                           │
│ Key: ▢ knit (RS) / purl (WS)  ╱ k2tog  ╲ ssk … │
└───────────────────────────────────────────────┘
```

- Tiles go **bottom to top, right to left**, the way a flat chart is read (row 1 at the bottom, read from the right;
  top-down pieces keep the app's reversed numbering). A small map in the corner shows which tile this is.
- Each tile repeats the row numbers on both sides, the stitch numbers below, and the counts column. Neighbouring tiles
  overlap by one row and one stitch, drawn lighter.
- The **symbol key** (only the symbols used in that piece, including custom symbols with their abbreviation) sits at
  the foot of each chart's first tile; if it doesn't fit there it gets its own block on the next page.
- Short-row rows (SR1…) and repeats appear exactly as in the Chart tab.

**Later pages (milestone E5)**

- **Yoke top view** (contiguous projects): its own page per size, after the schematics, scaled to fit.
- **Layout + joins**: the Layout view for the size, then a joins table: "Front neck: pick up 64 sts along 86 rows
  (3 sts per 4 rows)", from `joinReport`.

## PNG

An *Export PNG* item exports the view that's on screen, for the current size and size mode (one size, overlay or
grid): schematic, chart, layout or yoke top view. Choices: 1× / 2× / 3× resolution. Background white, no selection,
hover readout, drag handles or touch grips. The chart is exported whole (all rows, not just the scrolled part), so a
large chart at 3× may hit the browser's canvas size limit (about 16 000 px a side, 268 M pixels in Chrome); the dialog
drops to the largest scale that fits and says so.

The Measurements tab is an HTML table, not a drawing, so it has no PNG (it's in the PDF).

## Technical approach

### Why jsPDF + svg2pdf.js and not the print dialog

| | jsPDF + svg2pdf.js (chosen) | `window.print()` + print CSS |
|---|---|---|
| Output | A real `.pdf` file, the same on every computer | Depends on the print dialog's margins, scale and headers |
| Page breaks, chart tiling | Exact: we place every tile and number | CSS `break-inside` is coarse; tiling a big SVG across pages is very fiddly |
| Vector quality | Lines and text stay vector (svg2pdf draws SVG as PDF paths) | Vector too |
| Fonts | Built-in Helvetica unless we embed one (see risks) | System fonts, everything renders |
| Page numbers, "continues on p. N" | Easy | Not possible reliably |
| Download size | About 161 kB gzip, loaded only on export | Nothing |

Measured on 2026-10-22 with a throwaway esbuild bundle of `jspdf@4.2.1` + `svg2pdf.js@2.8.1`: the main import is
**161 kB gzip** (508 kB minified). jsPDF's optional `html2canvas` (48 kB), `canvg` (54 kB) and `dompurify` (12 kB) are
split into their own chunks and only load for `doc.html()` / `addSvgAsImage`, which this plan doesn't use. The
main chunk (about 81 kB gzip) must not change; check with `npm run build` before and after each milestone.

PNG needs no library: serialise the SVG, draw it on a canvas, `canvas.toBlob('image/png')`.

### Code layout

```
src/export/                    new folder, everything here is behind a dynamic import()
  plan.ts         pure: which pages, in what order, for the chosen sizes and sections (tested)
  tiles.ts        pure: split a chart (rows × cols, cell size, page box) into tiles with overlap and numbering (tested)
  tables.ts       pure: size-table and key-numbers rows from the project (tested)
  pdf.ts          jsPDF document: page frame, header/footer, tables, placing SVGs with svg2pdf
  render.tsx      render a view off-screen: createRoot + flushSync into a detached <div>, then inline styles
  png.ts          SVG → canvas → PNG blob
  fileName.ts     file names (tested)
src/ui/components/ExportDialog.tsx   lazy, like NewGarmentDialog: sizes, paper, sections, Export
```

- `App.tsx` gets an **Export…** toolbar button; it lazy-loads `ExportDialog`, which on *Export* does
  `await import('../export/pdf')`. jsPDF and svg2pdf are imported only from `src/export/`.
- `fileio.ts` gains `downloadBlob(filename, blob)` next to `downloadText` (same pattern).
- **Views get an `exportMode` prop** (Schematic, LayoutView, YokeTopView, SizeGrid): no handles, hover, selection,
  touch grips or zoom state; an explicit width and height; the drawing fitted to that box. ChartView's virtualised
  canvas isn't reused: a new `ChartSheet` draws one tile (row range × column range) from `buildChart` with the same
  glyphs (`ui/glyphs.tsx`), row/stitch numbers and counts. `GridChart` already draws a whole chart without
  virtualisation and is the starting point.
- **CSS variables must be resolved** before svg2pdf or canvas sees the SVG: neither understands `var(--cell-dec)` or
  class styles. `render.tsx` walks the rendered SVG and copies the computed `fill`, `stroke`, `stroke-width`,
  `font-*` and `opacity` onto each element as attributes. One function, used by PDF and PNG alike.
- **Dimensions on paper:** svg2pdf places an SVG at (x, y, width, height) in mm, so "fit to page" is the SVG's
  viewBox scaled into the content box; the printed scale is that factor converted from the panel's cm.

### Fonts and characters

jsPDF's built-in fonts only cover WinAnsi (Latin-1 plus a few). The app's text uses `×`, `−` (minus sign), `–`, `·`,
`≈`, `→`, `½`, and project names may contain anything. Choice for E1: embed **one open font** (for example Inter or
Noto Sans, regular + bold, subset to Latin + the symbols above, about 60–90 kB, loaded with the export chunk) so the
PDF matches the app. Fallback if that's too heavy: map the few symbols to ASCII (`x`, `-`, `->`) in `pdf.ts`.

## Milestones

Each ends with tests passing, typecheck and build clean, the main chunk size unchanged (± 0.5 kB), and the README /
HANDOFF updated. E2 and E3 touch different files and can be built at the same time once E1 is merged; E4 needs E2's
`exportMode`; E5 needs E1–E3.

**E1: export foundations and page 1.** `jspdf` and `svg2pdf.js` pinned to exact versions; `src/export/` with
`plan.ts`, `tables.ts`, `fileName.ts`, `pdf.ts` (page frame, header band, footer with `exportFooter()` and "Made with
Knitbit", page numbers "p. N of M", A4/Letter, portrait/landscape) and the embedded font; `downloadBlob`;
`ExportDialog` (sizes with the current one ticked, paper size remembered in localStorage, section checkboxes for the
ones that exist so far); Export… toolbar button. *Done when:* exporting gives a PDF with the header and size table for
the ticked sizes, tables flow across pages, the contiguous credit is in the footer only when it should be, and the
build shows jsPDF in its own chunk and the main chunk unchanged.

**E2: schematics.** `exportMode` on Schematic; `render.tsx` (off-screen render + inlined styles); one page per piece
per size, fit to page with the scale noted, the waypoint table under it; cardigan pairs and sleeves printed once
("make 2"). *Done when:* every piece of the sample project and of a contiguous and a cardigan project prints with
correct labels and no handles, lines stay vector (zoom the PDF), and colours match the app.

**E3: charts.** `tiles.ts` (tiling with overlap, numbering, page links; tested on small, wide, tall and top-down
charts); `ChartSheet` tile renderer; symbol key per piece; collapse-plain-middle honoured; "continues on p. N" and the
tile map. *Done when:* a 150-stitch × 200-row chart prints as readable tiles that line up when laid side by side,
every used symbol is in the key, custom symbols show their abbreviation, short rows and top-down numbering match the
Chart tab, and the chart is readable printed in black and white.

**E4: PNG of the current view.** `exportMode` on LayoutView, YokeTopView and SizeGrid (grid/overlay); `png.ts`;
*Export PNG* with 1×/2×/3× and the canvas-limit fallback. *Done when:* each of the four views exports as a PNG
matching the screen without interactive bits, and a big chart at 3× falls back with a message instead of failing.

**E5: extras.** Yoke top view page for contiguous projects; layout + joins page with the joins table from
`joinReport`; an optional `notes` field on the project (no schema bump: absent = empty; a text area on the Garment
tab), printed under the header. *Done when:* a contiguous project's PDF has its top view page, a top-down project's
PDF lists every join with stitch counts, and notes appear on page 1 and round-trip through save, load and cloud sync.

## Open questions and risks

- **Finished measurements.** Should the size table also show finished garment measurements (chest, waist, hip, upper
  arm, length, summed from the pieces at the right waypoints)? Useful, but the engine has no such summary yet;
  recommend adding it to E1's tables only if the waypoint names are reliable enough (to be checked), otherwise later.
- **svg2pdf coverage.** It handles paths, text, patterns and clip paths, but not CSS (hence the inlining step), and
  `<pattern>` grids can be slow on huge charts. ChartView draws plain stitches as runs over an SVG grid pattern; the
  export renderer may draw grid lines directly instead. Try both in E3 and keep the faster.
- **Big PDFs.** 11 sizes × 6 pieces of charts could be hundreds of pages and take a while; the dialog shows a progress
  count and builds pages one at a time (yielding to the browser) so the tab doesn't freeze.
- **Text width.** Schematic labels are placed with an estimated `textWidth()`; with an embedded font the printed text
  may be slightly wider or narrower than on screen. Check label collisions in E2.
- **iPad.** Downloads from Safari on iPad open in a viewer; that's fine but untested.
- **Pattern-to-share layout** (cover, photo, materials, copyright) and written instructions are out of scope; the
  page planner (`plan.ts`) keeps sections as a list so they can be added later without rework.
