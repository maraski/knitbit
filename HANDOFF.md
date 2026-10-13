# Knitbit: handoff

_Last updated 2026-10-13. Git `main`: `b99db67` (milestones 1–8), `d1e84e3` (first handoff), `ea7908c` (fitted cap +
M9), `6ee297f` (M10 + bust/princess options); painted stitches, shaping lines and the shoulders-first construction are in the working tree
(uncommitted at the time of writing). 201 tests passing; typecheck and build clean._

> **Milestone count:** the plan has **12 milestones**. **1–10 are complete**; **11–12 remain** (export, polish).

---

## 1. Project goal and architecture

### Goal
A **local-only** web app (no auth, backend, hosting) for one knitter to **see** the shaping of each knitted panel of a
women's top: schematics, size grading, increase/decrease/yarn-over placement, bust shaping, joins and (later) stitch
charts. It does **not** write pattern text and does **not** decide how panels are joined; it records and annotates
what the knitter decides.

The original brief is long; the authoritative summary of requirements lives in this file plus `README.md`.
Key brief points still to deliver are listed in §7.

### Architecture

```
src/
  engine/     Pure TypeScript calculation engine. No React, no DOM. Everything in centimetres.
              Every module has (or is covered by) Vitest tests.
  ui/         React 19 views. SVG rendering (no canvas). State = one Project object + undo history.
  main.tsx    Entry point.
samples/      Sample sizing table (CSV + identical JSON).
```

**Data flow**

```
Project (JSON-serialisable, src/engine/model.ts)
  │  edits via pure functions (engine/grading.ts, engine/manual.ts, ui/edit.ts produce())
  ▼
History<Project> (engine/history.ts) ──► autosave to localStorage (engine/autosave.ts)
  │
  ▼  per panel × size, recomputed on every render via useMemo
computePanel(project, panel, sizeId)  → ComputedPanel   (engine/panel.ts)
  ├─ measurements → expression scope (engine/measurements.ts, engine/expr.ts)
  ├─ waypoints → rows/stitches (engine/rounding.ts, engine/gauge.ts)
  ├─ segments → shaping events (engine/distribute.ts) or manual markers (engine/manual.ts)
  ├─ neckline, bust (engine/bust.ts), held short-row stitches
  └─ per-row edge positions, live stitch counts, outline polygon, markers, issues
  ▼
React views: Schematic (SVG), LayoutView (all panels), MeasurementsView (grid), property panels, CheckPanel
Cross-panel: projectChecks() (engine/checks.ts), joinReport() (engine/joins.ts), arrangeT() (engine/layout.ts)
App.tsx keeps one memoised computePanel cache per project version (computedFor) shared by every view.
```

**Coordinate system (engine/panel.ts):** x in stitches from the panel centre line (negative = left edge as seen from
the RS); y in knit rows from the cast-on (row r spans y = r−1 … r). Top-down panels are computed in knitting order and
flagged `topDown`; the renderer flips them so every panel is drawn **upright**.

---

## 2. Completed milestones (1–10)

| # | Milestone | Delivered |
|---|---|---|
| 1 | **Engine core** | `units` (cm↔in, decimals), `gauge` (per 10 cm or 4 in = 10.16 cm), `rounding` (nearest → pattern multiple → selvedges → parity, every step logged), `expr` (safe arithmetic language with unit suffixes, functions, dotted names, cycle detection), `distribute` (even spread with remainders, fixed rhythm, mixed rhythm, RS/WS/any rows, start/end/centre alignment, across-row placement). Vite + React + Vitest scaffold. |
| 2 | **Data model & persistence** | `model.ts` types and factories; per-size measurement resolution (manual > table > rule); seeded **estimated** measurements; `schema.ts` validation with path-precise errors, schema version + migration hook; `history.ts` undo/redo with coalescing; `autosave.ts`; CSV parser. |
| 3 | **Back bodice schematic** | `computePanel`; back template; three-column UI (sidebar / SVG canvas / properties); dimension lines, waypoint labels, row/stitch counts, hover readout, zoom/pan/fit (fit frames the largest size); waypoint, segment and neckline editors with expression fields and per-size fixed values; units toggle; keyboard shortcuts. Later in M3: **top-down = reversed row numbering, drawn upright**. |
| 4 | **Sizing import & grading** | `sizing.ts` (CSV/JSON in 3 shapes, synonym-based column mapping, merge/replace, inch conversion); `grading.ts` (add/rename/reorder/remove sizes with cleanup, base size, rename a measurement everywhere incl. `ease.<name>`, convert values to base+steps rule, zigzag check); Measurements grid view; import dialog; `waist_shift` estimate so the back gets waist shaping. |
| 5 | **Shaping editing & checks** | `symbols.ts` (CYC-style symbol set, marker deltas, default edge symbols); `manual.ts` (materialise auto → manual per size, move/add/remove/retype/reset); draggable marker handles, double-click to add, Delete to remove; editable marker table with running counts and target totals; project-wide **Checks** bar (`checks.ts`), grouped across sizes. |
| 6 | **Templates, join, sections** | Templates: back, front (round/V/square/boat), sleeve (set-in bell cap / drop / straight), rectangle, neckband; bottom-up or top-down. **In the round below a waypoint** (`panel.joinAt`): rounds, no selvedges, RS parity from first flat row, joined-panel round-count check. Pattern **sections** (rib bands) that round waypoints to their multiple, hatched on the schematic. Insert waypoint above/below. |
| 7 | **Bust shaping helper** | `bust.ts`: agreed formulas shown with numbers plugged in, per-size overrides; `bust_w`, `bust_l`, `bust_side_w` names for waypoint expressions; methods: short-row wedge, horizontal dart (as short rows), vertical darts (fisheye), none; editable turns / dart rows per size; asymmetry, crowding and fit warnings; all-sizes table. Short-row **segments** keep stitches live (top-down short-row shoulders). Post-M7 fix: **underarm bind-off in one go** (`armhole_bo` 2 rows above underarm; at an in-the-round join both sides on the dividing round). New expression names `row_h`, `st_w`. |
| 8 | **Joins (annotation only)** | `joins.ts`: tags (seam, pick up, live/held, bound off, cast on, free), edges (side between two waypoints, lower, upper, neckline), seam comparison (rows + length along edge, tolerance, suggestion), pick-up helper (ratio + 1:1 for horizontal stitches, totals, ×2/×4 rounding), notes; Joins sidebar tab, join editor, quick "Tag … edge" from properties, coloured join edges on the schematic, join checks. |
| — | **Sleeve cap fitted to the armhole** (after M8) | `armhole_len` (from the sleeve's seam join, else Front + Back armholes, else an estimate); `cap_ease` estimate (1.5 cm); set-in `cap_top` height solved from it; `sqrt()` in expressions; `engine/edges.ts` shared edge-length measure. Cap now 1.0–2.4 cm longer than the armhole in all sizes, both directions (was 10–20 cm short). |
| 9 | **Garment layout + size display modes** | `engine/layout.ts` (local cm frame, rotation/placement, `refHeight`/`alignShift`, T-shape `arrangeT` spaced for every size); **Layout** view: all panels at one scale, drag (one undo per drag), rotate ⟲/⟳, Auto-arrange, join-coloured edges, dashed seam links; **One size / Overlay / Grid** for Schematic and Layout with a sequential colour ramp, legend, size picker and alignment reference (lower edge, waist, underarm, shoulder, top); schematic overlay shows each size's bust points and short-row wedges. |
| — | **Shaping options** (after M10, user request) | **Bust short rows bust point → side seam** (`bust.shortRows.span = 'apex-to-side'`, `start = 'apex'`; turns at the apex then every `step` = floor(side sts ÷ turns per side) sts outwards, per the starcrossed knits method; top-down lengthening / bottom-up shortening mirror; preset button; error when step < 1). `wedgeBands()` draws the wedge in working order. **Princess-seam shaping** (`Segment.placement` edge/princess/both, `Panel.princess` {position Dim, default `apex_to_apex / 2`, sides both/one}); `computePanel` multiplies auto `perSide` by the shaping points, puts markers on the lines (`ComputedPanel.princess.offset`), odd stitch one-sided with an info note; `manual.shapingPoints` scales hand-placed marker deltas; chart draws stitch + mirror either side of each line. Tests in `shapingOptions.test.ts`. |
| — | **Experimenting tools** (after M10, user request; "A then B before M11") | **A. Painted stitches** (`engine/free.ts`, `Panel.freeStitches` per size: row, x = cell left edge from the row centre, symbol, mirror): paint/erase/toggle, mirror with leaning swap, repeat every N rows × k, **Copy to all sizes** (proportional between waypoints and across the half width, snapped to the stitch grid), clear; Chart ✎ Paint mode (P), strokes interpolated, one undo per stroke; schematic marks. **B. Shaping lines** (`engine/lines.ts`, `Panel.shapingLines`: two anchors as cm expressions, amount in sts, one-way/fisheye, both/one side, RS/any rows, mirror, manual rows per size): `computeLines` spreads events, `lineX` interpolates; `lineFromPoints` turns two schematic clicks into graded expressions; presets; `LineProps` editor, ✎ Line tool, chart symbols either side of the line. Both feed one interior array in `computePanel` that widens the edges about the centre (edge markers shifted to match; darts too). Tests: `free.test.ts`, `lines.test.ts`. Also: `grading.allDims` now includes bust/princess/line expressions (rename + remove size). |
| — | **Top-down shoulders-first construction** (user's usual method) | `templates.ts`: `construction` (default `shoulders-first` for top-down), `shoulderSlope` (short rows / none), `backNeck` (straight default / shaped); front `startFrom: 'pickup'`; armhole_bo = `underarm.width − 2·round(underarm_co/2/st_w)·st_w` so front and back cast on the same whole number of sts per side (half each); armhole_end at 0.6 (back) / 0.75 (front) of armhole depth so 4X fits; `topDownTop()` returns back + front + 2 joins (front top pick-up; underarm cast-on front sides vs back sides); 'top' template in the sidebar adds the set. Engine: top-down round start = max(underarm join, neck close) with an info note; top-down neck parity now checks row 1 (was the hem: a bug); square neck centre/width rounding; `measureEdge('top')` counts short-row-held cast-on sts. New estimate `underarm_co`. Tests: `construction.test.ts`, template cases. |
| 10 | **Stitch chart + symbols & legend** | `engine/chart.ts` (`buildChart`: per knit row a cell array, `''` outside / `'k'` plain / `'h'` held / symbol id; bind-offs and cast-ons drawn in their row; shaping at `shapingInset`; neck split + mirrored neck shaping; vertical-dart symbols at the dart lines; **bust short rows inserted after `afterRow`** as SR1…SRn with turns and held stitches; RS/WS/round reading direction; worked + live counts; repeats from sections; legend of used symbols; `collapseColumns`). `ui/glyphs.tsx` (CYC-style SVG glyphs in a unit square, cell tints, low-zoom band colours, legend swatch). **Chart** tab (`ChartView.tsx`): upright like the schematic, row-virtualised, plain stitches drawn as runs over an SVG grid pattern, ⌘-scroll zoom, Fit, collapse plain middle, row/stitch numbers, count column, hover readout; select/drag/double-click-add/Delete markers via `markerActions`; One size / Grid (shared scale). **Custom symbols** (`project.symbols`: label, abbr, colour, stitch change) editable in the legend, offered in the marker Stitch menu, `markerDelta` honours them. |

---

## 3. Key decisions and reasoning

All confirmed with the user unless marked _(my call)_.

**Fit & measurements**
- **Front based on `upper_chest`; bust room added by the bust helper.** Upper chest fits shoulders/neck; the bust difference D = bust − upper_chest goes only where it is needed.
- **Ease = total circumference ease**, split equally front/back → body panels use `ease / 2`. (The brief's example `bust/2 + ease/4` was corrected.)
- **Measurements not in the sizing table are seeded as graded estimates** (expression rules, tagged *est.*): shoulder_width, neck_width, back/front neck depth, shoulder_slope, hem_to_waist, bust_point_depth, apex_to_apex, cap_height, waist_shift. Imported values replace them.
- **`waist_shift = (bust − waist) / 4`**: back waist `waist/2 + ease/2 − waist_shift`, front `+ waist_shift`. Reason: user pointed out the waist is visible from the back; in M/L the table has waist = upper_chest so the back had no waist shaping. User accepted /4 by not choosing (/2 = more shaped back).
- **Bust formulas (agreed before M1):** W = D × 1.0, L = max(0, D − b) × k with b = 0, k = 0.5, shown as editable expressions labelled "starting estimate". W is also added at the front side seams (`bust_side_w`) for short rows / horizontal dart (toggle).
- **Horizontal dart = short rows** (user confirmed): knitted horizontal darts cannot be made with increases/decreases row by row.

**Knitting conventions**
- **Row 1 is a RS row**, read right to left; cast-on not counted. Flat start-of-row steps: right edge on RS rows, left edge on WS rows.
- **Shaping worked 2 stitches in** from the selvedge (`panel.shapingInset`, editable; not yet used by any drawing; the chart will use it).
- **Rounding: nearest stitch**, every adjustment shown. **Templates default to an even total stitch count** _(my call, user agreed)_ so both edges shape in pairs.
- **Heights are measured up from the garment's lower edge**; panels are always drawn upright. **Top-down = reversed row numbering** (user's choice after M3), not a flipped drawing. Shaping semantics flip (decrease ↔ increase, bind-off ↔ cast-on, align start ↔ end).
- **Underarm bind-off in one go** (user correction after M7): "bind off X at the beginning of the next 2 rows"; at an in-the-round join, both sides on the dividing round (top-down: cast on where panels join).
- **Body may be joined in the round below the underarm** (`joinAt`); the app never joins panels itself.

**Templates (my calls, reported to user)**
- Back armhole: 40 % of the width change bound off, decreases to `cross_chest_back + 1` at `armhole_depth × 0.45`.
- Front armhole deeper (50 % bound off, decreases to `armhole_depth × 0.6`) so it can absorb the full bust width W in all sizes (4X adds 15.5 cm).
- Vertical darts close above the bust inside the armhole area (`underarm.height + armhole_depth × 0.5`) because the bust point is only ~3 cm below the underarm in this sizing table; fall back to every-row shaping when RS rows run out.
- Short-row turn zone `max(6, bust_l × 2.5)` cm so turns stay ≥ ~2 sts apart.
- Set-in cap is a bell (fast/steady/fast, any-row decreases) with bind-off matching the body's.
- **Cap height follows the armhole length** (user confirmed after M8): solved in closed form inside the waypoint
  expression; the 0.966 factor was calibrated on the sample table so the bell's curved edge lands near `cap_ease`.
- **Layout (my calls):** an unplaced project shows an on-the-fly T-shape that is only saved on the first drag or
  Auto-arrange (opening a view never edits the project); T-shape spacing uses the union of all sizes so overlays don't
  collide; rotation is in 90° steps about the panel's centre line at its lower edge; drags snap to 0.5 cm.
- **Size display state** (mode, chosen sizes, alignment) is view state: saved in `knitbit.view.v1`, not undoable.

**UI / tooling**
- **Imperial shown as decimals**, not fractions. cm shown to 2 decimals (the table uses quarter cm).
- **Undo covers project edits only**, not view state (size, panel, zoom). Units toggle *is* a project edit.
- **Bust short rows, bust point → side seam** (user's usual top-down method, from the starcrossed knits article):
  optional, not the default; first turn exactly at the bust point (not ½" outside); bottom-up mirror included.
- **Painted stitches and shaping lines change the count inside the fabric** and the panel widens/narrows evenly
  about the centre; edge shaping is *not* re-planned around them (they're for experimenting); net changes are
  reported, and running out of stitches at the shoulders/top is a warning. Painted stitches are per size with
  **Copy to all sizes** (user liked this); lines are expressions so they grade by themselves.
- **Top-down = shoulders first** (user's method, confirmed as the default): back cast on at the shoulders, front
  shoulders picked up from it, neck closed at the centre, underarms cast on **half each**, in the round once both the
  underarms and the neck are joined. Shoulder slope (GSR) optional, ideally on both back and front; back neck
  straight by default, shaped as an option. Joins are tagged *because the user chose the construction* (otherwise the
  app still never decides joins). Cardigans: later (button band optional; user prefers ribless).
- **Contiguous method** (Susie Myers; PDF provided by the user) is a different construction the user sometimes
  uses: one continuous row from the start with shoulder-seam increases each side of 2 centre sts every row, then
  sleeve-cap increases. Not modelled yet (it would need sleeves joined to the body from the cast-on).
- **Princess lines** run through the bust points by default (`apex_to_apex / 2` from centre) on every panel; an odd
  stitch is worked one-sided on one row rather than rounding the waist width (user chose this).
- **Chart conventions (M10)**: a row shows the stitches on the needle at the *end* of the row; bound-off stitches
  appear in the row that binds them off; increases/decreases sit `shapingInset` sts in from the edge; chart drawn
  upright (same orientation as the schematic, matching the M3 "keep it upright" decision); bust short rows are extra
  chart rows (SRn) that don't take a knit-row number; stitches numbered from the right. Overlay is not offered for
  charts (One size / Grid only). Custom symbols carry their own stitch change so they can be shaping markers.
- **Size overlay colours: sequential ramp** (for M9). **Stitch chart: full chart with option to collapse plain middle** (M10). **Target browser: Chrome.** **Laptop screens only.**
- Few dependencies: React only at runtime; jsPDF + svg2pdf.js allowed for export (M11).

---

## 4. Current state of the code

### File structure

```
.
├── HANDOFF.md, README.md          README = user-facing reference (expression syntax, JSON schema, import format, behaviour)
├── index.html, package.json, tsconfig.json, vite.config.ts, vitest.config.ts
├── .claude/launch.json            dev server config for the Claude desktop preview (npm run dev, port 5173)
├── samples/sizing_table_cm.csv    10 sizes (3XS–4X), cm; .json is the same data
└── src/
    ├── main.tsx
    ├── engine/                    (≈4.4k lines incl. tests)
    │   ├── units.ts, gauge.ts, rounding.ts, csv.ts
    │   ├── expr.ts                parser/evaluator, references(), resolveDefinitions(), renameReferences()
    │   ├── distribute.ts          shaping distribution
    │   ├── model.ts               ALL data types + factories (Project, Panel, Waypoint, Segment, Neckline, BustShaping, Join…)
    │   ├── measurements.ts        resolveMeasurements, buildScope (+ row_h, st_w, ease), evaluateDim
    │   ├── seed.ts                projectFromTable, STANDARD_COLUMNS, ESTIMATED_MEASUREMENTS, ensureEstimates
    │   ├── schema.ts              validation, MIGRATIONS, loadProject, serializeProject
    │   ├── history.ts, autosave.ts
    │   ├── panel.ts               ★ computePanel (≈1000 lines): the heart of the app
    │   ├── templates.ts           bodice(), sleeve(), rectangle(), neckband(), fromTemplate()
    │   ├── sizing.ts, grading.ts  import + size/measurement operations
    │   ├── symbols.ts, manual.ts  stitch symbols + hand-placed markers
    │   ├── bust.ts                bust helper
    │   ├── joins.ts               edge measuring, seam reports, pick-ups
    │   ├── edges.ts               sideEdgeLength() along the drawn outline (shared by joins + armhole_len)
    │   ├── layout.ts              local cm frame, rotate/place, refHeight/alignShift, arrangeT, isUnarranged
    │   ├── free.ts                painted stitches: freeInterior, paint/erase/copyFreeToAllSizes, MIRROR_SYMBOL
    │   ├── lines.ts               shaping lines: computeLines, lineX, lineFromPoints
    │   ├── chart.ts               buildChart (cells per row, SR rows, refs to markers, repeats, legend), collapseColumns
    │   ├── checks.ts              projectChecks, groupChecks
    │   ├── testFixtures.ts        fixtureProject() from the sample CSV, sizeId()
    │   └── *.test.ts              201 tests (incl. armhole, layout, chart, shapingOptions, free, lines, construction)
    └── ui/
        ├── App.tsx                layout, view state (size, panel, centre view, selection), shortcuts, wiring
        ├── store.ts               useProjectStore (history + autosave), sampleProject()
        ├── edit.ts                produce(), editPanel/editWaypoint/editSegment
        ├── markerActions.ts       marker edits → undoable updates
        ├── edgePaths.ts           edge polylines in stitch/row space (schematic + layout), edgeMidpoint
        ├── sizeColors.ts          sequential size colour ramp
        ├── glyphs.tsx             chart symbol glyphs (unit square), cell tints, band colours, legend Swatch
        ├── selection.ts           Selection union
        ├── format.ts, fileio.ts, app.css
        └── components/
            ├── Schematic.tsx      ★ SVG renderer, zoom/pan, labels, markers, handles, bust, joins, overlay/grid modes
            ├── LineProps.tsx      shaping line editor + presets
            ├── ChartView.tsx      stitch chart: virtualised rows, zoom, collapse, marker editing, grid of sizes, legend + My symbols
            ├── LayoutView.tsx     all panels, drag/rotate/arrange, seam links, overlay; SizeGrid + SizeLegend
            ├── SizeModeBar.tsx    One size / Overlay / Grid, size picker, align-at
            ├── Properties.tsx     ★ panel / waypoint / segment / neckline props, TagEdge, IssueList
            ├── BustProps.tsx, JoinProps.tsx, MeasurementProps.tsx (measurement + sizes)
            ├── MeasurementsView.tsx (grid), ImportDialog.tsx, CheckPanel.tsx
            ├── ExprField.tsx      expression input + evaluated value + per-size fixed value
            ├── Sidebar.tsx        Panels / Joins / Project tabs, add-panel form
            └── Toolbar.tsx
```

### Important modules
- **`engine/panel.ts` → `computePanel`**: evaluates waypoint expressions (with bust values in scope), sorts by height,
  rounds, flips for top-down, determines round/flat rows (`roundRows`, `firstFlatRow`), walks segments
  (auto / steps / shortrows / straight / manual) simulating `leftEdge`/`rightEdge` per row, computes the neckline
  (bottom-up at the top, top-down at the cast-on), bust shaping (darts widen the edges), held short-row stitches,
  counts, outline, markers and issues. Waypoints can reference each other: `underarm.width`, `cap_top.height`.
- **`armholeLength()` in `engine/panel.ts`**: resolves `armhole_len` for panels whose expressions use it, by computing
  other panels (seam join partner, or Front/Back by template). A module-level `measuring` set guards against a panel
  measuring itself. Every computation of a sleeve therefore also computes the body panels it measures.
- **`engine/model.ts`**: change data shapes here first, then `schema.ts` validators, then README's JSON section.
- **`ui/components/Schematic.tsx`**: all drawing is in screen pixels computed from world cm (`S(xSts, row)`), so text
  and strokes stay a constant size while zooming.

### Half-finished / not yet built
- **Side-to-side panels**: geometry is rotated, but dimension labels, waypoint labels, hover readout, the bust overlay
  and section bands are only drawn for vertical panels (`vertical` flag in Schematic).
- **Chart limits**: short-row *segments* (e.g. top-down shoulders) are shown by their held stitches and turn
  symbols in the ordinary knit rows (they are knit rows already), not as extra SR rows. Neck-edge symbols use the
  default ssk/k2tog (the neck's events don't carry a per-side symbol). Vertical-dart symbol positions are
  approximate (the dart line from `bust.darts.leftX/rightX`, shifted with the row's centre). Cables (C4F/C4B) are
  single-cell glyphs; there is no multi-cell cable drawing or stitch-pattern (texture) charting. Repeat lines start
  from the section's first-row left edge. Only rows are virtualised (columns are drawn as runs, cheap enough).
- **Princess shaping limits**: one line position per panel (all its princess segments share it); the line is
  `offset` sts from each row's centre, so it follows a symmetric outline; side-edge joins still measure the drawn
  (sloped) outline although the fabric edge is straight; changing *Shape at* doesn't rescale existing hand-placed
  markers (reset them). Combining short-row and vertical bust darts (as the article mentions) isn't supported:
  bust methods are exclusive.
- **Shoulders-first limits**: the front is still one panel (both halves drawn together); the pick-up join counts
  the front's first-row stitches (one per back cast-on st), it doesn't check the back's shoulder count separately; the
  set's joins aren't updated if you later rename/delete waypoints; cardigan fronts don't exist yet.
- **Experimenting tools limits**: painted stitches can't go on SR (inserted short) rows or held stitches; painting
  bind-off/cast-on/turns isn't offered; a painted or line change never moves the neckline or re-plans shoulder
  bind-offs; shaping lines have no drag handles yet (edit ends/rows in the properties); a one-sided line's width
  change is still drawn symmetrically; lines on side-to-side panels aren't drawn.
- **Chart virtualisation** relies on the scroll element's `scroll` events; programmatic `scrollTop` changes in a
  hidden/throttled browser pane may not re-render until a real scroll.
- **Layout**: no snapping to other panels, no free rotation (90° steps only), no lock/hide per panel.
- **Short-row bust shaping is not drawn into the schematic outline**: the extra centre-front length is shown as an
  overlay wedge with a label; the outline and all row numbers are counted at the side edges. The chart inserts the
  short rows (SR1…SRn after `bust.shortRows.afterRow`).
- **Overlay mode** in the schematic shows outlines, bust points and short-row wedges only: no dimension labels,
  markers, handles or vertical-dart shapes. Side-to-side panels fall back to the single-size drawing.
- **Fit in overlay** frames the unshifted outlines; with a non-hem alignment some sizes can extend past the edge (zoom out / pan).
- **`cap_height`** (estimate `armhole_depth × 0.65`) is still seeded but no longer used by the set-in template.
- **Drop-shoulder sleeve** top width (`armhole_depth × 2`) does not follow the body; only the set-in cap does.
- **Joins don't auto-suggest** anything (by design); there is no "common joins" helper.

---

## 5. Known bugs, gotchas and workarounds

**Template / design issues (visible in the check panel or join reports)**
- **Sleeves added before the cap fix** keep `underarm.height + cap_height` (too short). Re-add the sleeve, or change
  `cap_top`'s height to the fitted expression from the template.
- **`armhole_len` picks Front/Back by `panel.template`** (`'front'`, `'back'`). Panels built from scratch or renamed
  templates need a seam join containing the sleeve's edges instead. The source used is shown as a note per size.
- **Front wider at the waist than at the underarm** when bust method is *none* or *vertical darts* (front waist gets
  `+ waist_shift`, the underarm only gets `bust_side_w` for short rows/horizontal dart). Expected with this table; looks odd.
- **Panels added from templates before a fix keep the old shape** (e.g. the staircase armhole bind-off pre-M7 fix).
  Templates are one-off generators; delete and re-add, or press New.

**Engine gotchas**
- **Renaming a waypoint does not update expressions that reference it** (`underarm.width` etc.); they show
  "Unknown name". Measurement renames *are* propagated (`grading.renameMeasurement`). Waypoint keys are the name
  lower-cased with non-alphanumerics → `_` (`waypointKey`).
- **Deleting a waypoint** leaves dangling references in other waypoints' expressions, in `joinAt` (treated as flat,
  schema warns) and in join edges (join report shows an error).
- **Manual markers are per size and relative to the segment start**; if waypoint heights change, markers outside the
  segment are ignored with a warning.
- **Mirrored step markers** (bind-off/cast-on/turn) move to the adjacent RS row in a single direction per segment
  (after if steps align to the end, else before), matching auto placement. A test checks every segment × size × direction.
- **Neck opening snaps to the top width** when they differ by ≤ selvedge + 1 sts; the neck is centred on the panel's
  top (may be ½ st off the centre line when the width is odd); the last neck decrease is one row before the top (flat
  bottom-up) because the final row belongs to one side only.
- **Odd stitch changes on mirrored segments** give the extra stitch to whichever edge keeps the panel centred (warning).
- **RS rows** are odd rows only when the flat part starts at row 1. After a join, RS parity counts from
  `firstFlatRow`; distribute's `'rs'` means *odd*, so `panel.ts` swaps sides via `sideFor()`.
- **Vertical dart width is drawn by widening both outer edges**, not as interior geometry; `counts` are correct.
- **Short-row segments** (`kind: 'shortrows'`) hold stitches: live count = the wider end (`held[]`), not the outline width.
- **Schema version is still 1**; fields added later are optional (`joinAt`, `bust`, `joins`, step `align`), so no
  migration was needed. An incompatible change must bump `SCHEMA_VERSION` and add `MIGRATIONS[1]`.

**UI gotchas**
- **Layout positions are absolute cm per panel** (not per size). Changing sizes doesn't move panels; very different
  sizes can overlap a hand-made arrangement (Auto-arrange spaces for all sizes).
- **The first drag in an unplaced layout saves every panel's T position** (so the others don't jump to the origin).
- **Every edit recomputes every panel × size** (Checks bar, fit outlines, size tables). Fine at current size; the
  stitch chart may need memoisation per panel/size or a worker.
- **History stores whole-project snapshots** (`structuredClone`, limit 200). Coalescing: same key within 1 s; keys
  starting `drag:` always merge (one undo per drag).
- **Undo shortcuts are ignored while focus is in an input** (native input undo applies instead). Click the canvas first.
- **localStorage keys**: `knitbit.autosave.v1` (project), `knitbit.view.v1` (size, panel, centre view). Clear them to
  start fresh (`localStorage.clear()` in the devtools console).
- **Window confirm dialogs** are used for deletes and New (simple, but they block automated browser testing).
- **Circular import** `BustProps.tsx` ↔ `Properties.tsx` (types + IssueList); harmless with ESM but don't add
  top-level side effects to either.

- **Checks bar "notes"** now include one `armhole_len = … cm, from …` note per sleeve per size (notes are hidden by default).

**Tooling**
- Very new toolchain: **TypeScript 7** (`tsc -b`), **Vite 8**, **Vitest 5**, **React 19**, Node 24. `@types/node` is
  in `tsconfig` `types` only because `testFixtures.ts` reads the sample CSV with `node:fs`.
- When automating the Claude desktop browser pane, screenshots can be taken before React re-renders; verify with
  `javascript_tool` reads instead.

---

## 6. Conventions

- **Engine purity**: nothing in `src/engine` imports React or touches the DOM/localStorage directly
  (`autosave.ts` takes a `KVStorage` interface). Engine functions return new objects; callers never mutate inputs
  (`structuredClone` inside ops; `produce()` in `ui/edit.ts`).
- **Units**: everything stored in **cm**; convert only at display/input (`toDisplay`, `fromDisplay`, `formatLength`).
  Expressions evaluate to cm; bare numbers are cm; `in`/`mm`/`cm`/`"` suffixes convert.
- **Naming**: measurement and expression names are `snake_case` (`upper_chest`, `waist_shift`); waypoint keys likewise
  (`armhole_bo`); computed names `bust_w`, `bust_l`, `bust_side_w`, `row_h`, `st_w`, `ease`, `ease.<measurement>`,
  `<waypoint>.height|width|left|right`. TypeScript: `camelCase` functions, `PascalCase` types/components.
  IDs: `newId(prefix)` → `panel_…`, `wp_…`, `size_…`, `sec_…`, `join_…`.
- **Per-size values**: `Record<sizeId, number>` (`DimExpr.overrides`, `Measurement.table/manual`, `Segment.manual`,
  `BustShaping.manual`). Removing a size must clean these (`grading.removeSize`).
- **Issues**: `{ severity: 'error' | 'warning' | 'info', message, ref }` where `ref` points to panel / waypoint /
  segment(+edge) / neckline / bust / join, so the UI can jump to it. Messages are plain sentences with numbers.
- **Segments are keyed by the garment-lower waypoint** (`fromWaypoint`) regardless of knitting direction.
- **Shaping summaries** are visual descriptions ("row 7, then every 8th row ×5"), never pattern text.
- **Undo keys**: pass a stable key (`wp.<id>.height`, `cell.<m>.<size>`) for typing; `drag:<n>` for drags; `null` for discrete actions.
- **Tests**: Vitest, co-located `*.test.ts` in `src/engine`; use `fixtureProject()` (sample table, base size M) and
  `sizeId(p, 'M')`. Template tests require **zero errors and warnings in all 10 sizes**; keep it that way.
- **Styling**: one stylesheet `ui/app.css`, CSS variables on `:root`, calm tool-like palette; schematic classes are
  prefixed by element (`.wp-line`, `.mk-dec`, `.join-edge`, `.bust-wedge`).
- **Chart cells**: string codes (`''`, `PLAIN='k'`, `HELD='h'`, `HOLD='hold'`, else a symbol id incl. `custom_…`);
  legend entries via `cellInfo()`; glyphs drawn in a unit square and scaled, strokes `vector-effect: non-scaling-stroke`.
- **Libraries**: React only at runtime so far. No state library, no math library, no CSV library.
- **Commits**: end messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Process with the user**: one milestone at a time; run tests + app; report what to look at; wait for the go-ahead.
  Flag deviations from agreed formulas instead of changing them silently.

---

## 7. Remaining milestones and next steps

Done since the first handoff: the set-in cap follows the armhole (user confirmed), M9 (layout + size display modes)
and M10 (stitch chart, glyphs, legend, custom symbols).

### M11: Export (PDF + PNG)
1. Add `jspdf` + `svg2pdf.js` (exact versions pinned).
2. Export current view or **all sizes**: multi-page PDF with title, gauge, units, size, legend; **1:1 scale** (cm on
   paper) or fit-to-page; PNG at chosen resolution (serialize SVG → canvas → blob).
3. Make Schematic/Chart/Layout renderable off-screen with explicit size and no interactive layers (handles, hover);
   LayoutView/SizeGrid already compute everything from props, so they are the easiest to reuse. For the chart,
   render from `buildChart` without virtualisation (all rows), page-split long charts by rows, and include the
   legend (`chart.legend` + `Swatch`); glyphs use CSS variables/classes, so inline computed styles before export.
4. Use `fileio.downloadText` pattern for binary downloads.

### M12: Polish
1. Drop-shoulder sleeve top width from the body's armhole depth / armhole length (like the set-in cap).
2. Waypoint rename propagation (like `renameMeasurement`, using `renameReferences` on `<old>.*` names) and dangling
   reference cleanup on waypoint delete (joins, `joinAt`).
3. Side-to-side panels: labels/dimensions for rotated drawing.
4. Keyboard shortcuts overview, confirm dialogs → in-app modals, empty states, performance (App's `computedFor`
   cache is per project version; the Checks bar and some property tables still call `computePanel` directly).
5. Overlay mode: optional dimension labels for the current size; fit to the shifted outlines.
6. Layout: snapping, lock/hide panels, labels with key widths.
7. Demo project; final README/JSON schema pass.

---

## 8. Commands

Requires Node 20+ (developed on Node 24.13).

```bash
npm install            # install dependencies
npm run dev            # dev server at http://localhost:5173 (strict port)
npm test               # run all tests once (vitest run)
npm run test:watch     # tests in watch mode
npx vitest run src/engine/panel.test.ts   # one test file
npm run typecheck      # tsc -b (type check only, noEmit)
npm run build          # tsc -b && vite build → dist/
npm run preview        # serve the production build
```

Fresh start in the browser: open devtools console and run `localStorage.clear()`, then reload (or use **New** in the toolbar).
