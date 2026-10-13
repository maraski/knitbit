# Knitbit: handoff

_Last updated 2026-10-13. Git: initial commit `b99db67` on `main` (milestones 1–8). 148 tests passing; typecheck and build clean._

> **Milestone count:** the plan has **12 milestones**. **1–8 are complete**; **9–12 remain**. This document covers all
> of them (the request said "3 completed / 3 remaining"; the real numbers are 8 and 4).

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
React views: Schematic (SVG), MeasurementsView (grid), property panels, CheckPanel
Cross-panel: projectChecks() (engine/checks.ts), joinReport() (engine/joins.ts)
```

**Coordinate system (engine/panel.ts):** x in stitches from the panel centre line (negative = left edge as seen from
the RS); y in knit rows from the cast-on (row r spans y = r−1 … r). Top-down panels are computed in knitting order and
flagged `topDown`; the renderer flips them so every panel is drawn **upright**.

---

## 2. Completed milestones (1–8)

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

**UI / tooling**
- **Imperial shown as decimals**, not fractions. cm shown to 2 decimals (the table uses quarter cm).
- **Undo covers project edits only**, not view state (size, panel, zoom). Units toggle *is* a project edit.
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
    │   ├── checks.ts              projectChecks, groupChecks
    │   ├── testFixtures.ts        fixtureProject() from the sample CSV, sizeId()
    │   └── *.test.ts              148 tests
    └── ui/
        ├── App.tsx                layout, view state (size, panel, centre view, selection), shortcuts, wiring
        ├── store.ts               useProjectStore (history + autosave), sampleProject()
        ├── edit.ts                produce(), editPanel/editWaypoint/editSegment
        ├── markerActions.ts       marker edits → undoable updates
        ├── selection.ts           Selection union
        ├── format.ts, fileio.ts, app.css
        └── components/
            ├── Schematic.tsx      ★ SVG renderer, zoom/pan, labels, markers, handles, bust, joins
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
- **`engine/model.ts`**: change data shapes here first, then `schema.ts` validators, then README's JSON section.
- **`ui/components/Schematic.tsx`**: all drawing is in screen pixels computed from world cm (`S(xSts, row)`), so text
  and strokes stay a constant size while zooming.

### Half-finished / not yet built
- **Side-to-side panels**: geometry is rotated, but dimension labels, waypoint labels, hover readout, the bust overlay
  and section bands are only drawn for vertical panels (`vertical` flag in Schematic).
- **`panel.shapingInset`** (2 sts in) is stored and editable but not used anywhere yet (intended for the chart).
- **`panel.layout` {x, y, rotation}** is stored (default 0) but unused until the garment layout (M9).
- **Short-row bust shaping is not drawn into the outline**: the extra centre-front length is shown as an overlay wedge
  with a label; the outline and all row numbers are counted at the side edges. The chart (M10) must insert the short
  rows (labelled SR1…SRn after `bust.shortRows.afterRow`).
- **Overlay of bust shaping across sizes**: only a per-size table for now (overlay view is M9).
- **Set-in sleeve cap is too short for the armhole** (see §5). Fix planned: derive cap height from armhole length.
- **Sleeve template's `cap_height`** is a seeded estimate `armhole_depth × 0.65`; no link yet to the body panels.
- **Joins don't auto-suggest** anything (by design); there is no "common joins" helper.

---

## 5. Known bugs, gotchas and workarounds

**Template / design issues (visible in the check panel or join reports)**
- **Sleeve cap edge ≈ 20–30 % shorter than front + back armhole** (M: 50 vs 61 cm; 4X: 64 vs 83 cm). Workaround: raise
  `cap_height` per size or in its rule. Planned fix in §7.
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
- **Libraries**: React only at runtime so far. No state library, no math library, no CSV library.
- **Commits**: end messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Process with the user**: one milestone at a time; run tests + app; report what to look at; wait for the go-ahead.
  Flag deviations from agreed formulas instead of changing them silently.

---

## 7. Remaining milestones and next steps

Also open from M8 (awaiting the user's answer): **make the set-in cap height follow the armhole length** (recommended).
Concretely: in `templates.sleeve('set-in')` replace `cap_height` with a solver, or add an engine helper that, given the
joined armhole edges (via a seam join), finds the cap height whose cap edge length ≈ armhole length + chosen ease.
Simplest: expose a project-level computed name (e.g. `armhole_len` from the front+back armhole, evaluated outside the
sleeve panel to avoid cycles) and a closed-form cap height from the cap's horizontal run.

### M9: Garment layout view + size display modes
1. Add a third centre view **Layout** (`App.tsx` `CenterView`). New `ui/components/LayoutView.tsx`.
2. Draw every panel's `outline` at one shared scale (px per cm), translated by `panel.layout.x/y` (cm) and
   `rotation`; draggable (pointer events → `update(…, 'drag:layout…')`), selecting a panel on click.
3. **Auto-arrange "T-shape"**: back and front side by side at the same baseline, sleeves to the sides at underarm
   height (rotate 90°), bands below. Write it as a pure function in a new `engine/layout.ts` (tested), writing `panel.layout`.
4. Colour edges by join tag (reuse `JOIN_TAGS`, `panelJoins`), and draw **seam pair links** (dashed connector between
   the midpoints of each seam's two sides; midpoints from the same edge path logic as `Schematic.joinEdgePts`; move that
   logic into a shared helper, e.g. `ui/edgePaths.ts`).
5. **Size display modes** for Schematic and Layout: *single* (current), *overlay* (selected sizes as nested outlines,
   sequential colour ramp + legend, aligned at a chosen reference: hem / underarm / shoulder / waypoint name),
   *side-by-side grid* (same scale). Add a size multi-select in the toolbar. For overlay use `allSizes` already computed in `App.tsx`.
6. Overlay bust wedges/darts per size (brief requirement).
7. Tests: layout arrange function; alignment offsets per reference.

### M10: Stitch chart + symbols & legend
1. New engine module `engine/chart.ts`: from `ComputedPanel` build a row-by-row model: for each knit row, the live
   stitch cells (with `shapingInset` positions for decreases/increases using event symbols), no-stitch cells outside
   the outline, bind-off/cast-on cells, neck split, held stitches, **inserted short rows** (bust and short-row
   segments) with turn symbols, worked-stitch counts and running count. Row numbering: flat (alternating
   direction, RS odd from `firstFlatRow`) vs in the round (all right-to-left); repeat brackets from `pattern`/sections.
2. `ui/components/ChartView.tsx`: SVG grid, **virtualised** (render only visible rows/cols; simplify to bands at low
   zoom), zoom/pan, row/stitch number guides, "collapse plain middle" toggle (agreed default: full chart with option).
3. Draw all symbols as SVG glyphs (`symbols.ts` has ids/labels/abbr; add glyph paths), custom symbol support (label +
   colour stored in project, e.g. `project.symbols`), **legend generated from symbols actually used**.
4. Manual marker editing from the chart (reuse `markerActions`).
5. Tests: chart row counts equal `computePanel` counts; short rows inserted where `bust.shortRows.afterRow` says; RS/WS
   reading direction; in-the-round numbering; symbol legend contents.

### M11: Export (PDF + PNG)
1. Add `jspdf` + `svg2pdf.js` (exact versions pinned).
2. Export current view or **all sizes**: multi-page PDF with title, gauge, units, size, legend; **1:1 scale** (cm on
   paper) or fit-to-page; PNG at chosen resolution (serialize SVG → canvas → blob).
3. Make Schematic/Chart/Layout renderable off-screen with explicit size and no interactive layers (handles, hover).
4. Use `fileio.downloadText` pattern for binary downloads.

### M12: Polish
1. Sleeve cap height from armhole length (if not done earlier).
2. Waypoint rename propagation (like `renameMeasurement`, using `renameReferences` on `<old>.*` names) and dangling
   reference cleanup on waypoint delete (joins, `joinAt`).
3. Side-to-side panels: labels/dimensions for rotated drawing.
4. Keyboard shortcuts overview, confirm dialogs → in-app modals, empty states, performance (memoise per panel/size).
5. Demo project; final README/JSON schema pass.

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
