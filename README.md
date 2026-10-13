# Knitbit

A local-only visualizer for knitted panel shaping in women's tops: schematics, size grading,
shaping placement, bust shaping and stitch charts. It does not write pattern text and does not decide
how panels are joined.

## Running

Requires Node 20+.

```bash
npm install
npm run dev        # app at http://localhost:5173
npm test           # unit tests (Vitest)
npm run typecheck
```

## Project layout

- `src/engine/`: pure TypeScript calculation engine (no React). Everything is stored in centimetres.
  - `units.ts`: cm ↔ in conversion and display formatting (decimals).
  - `gauge.ts`: gauge per 10 cm or per 4 in (10.16 cm), and conversion between lengths and stitch/row counts.
  - `rounding.ts`: raw count → whole stitches (nearest → pattern multiple → selvedges → parity), with every step recorded.
  - `expr.ts`: the expression language (below).
  - `distribute.ts`: spreads increases/decreases over rows (auto, fixed rhythm, mixed rhythm) and across a row.
  - `model.ts`: project data types and factories.
  - `measurements.ts`: per-size measurement resolution and the expression scope.
  - `seed.ts`: project from a sizing table, plus estimated measurements.
  - `schema.ts`: JSON validation, migrations, load/save. `history.ts`: undo/redo. `autosave.ts`: localStorage safety net.
  - `panel.ts`: computes one panel in one size (rows, stitches, shaping events, neckline, outline, issues).
  - `templates.ts`: panel templates (back, front with 4 necklines, 3 sleeves, rectangle, neckband; bottom-up or top-down).
  - `sizing.ts`: reading CSV/JSON sizing tables, column mapping, applying an import.
  - `grading.ts`: size and measurement operations (rename everywhere, increment rules, base size, zigzag check).
  - `symbols.ts`: the stitch symbol set and what each does as a shaping marker.
  - `manual.ts`: hand-editing shaping markers (move, add, remove, retype, reset).
  - `checks.ts`: project-wide checks for the check panel.
  - `bust.ts`: bust shaping (formulas with numbers plugged in, short-row wedges, horizontal and vertical darts).
  - `joins.ts`: measuring tagged edges, seam comparison, pick-up suggestions.
- `src/ui/`: React views.
- `samples/`: sample sizing tables (`sizing_table_cm.csv`, `sizing_table_cm.json`, same data).

## Expression syntax

Waypoint dimensions and custom measurements are expressions. They evaluate to **centimetres**.

| Feature | Example |
|---|---|
| Numbers (cm) | `12.5`, `.5` |
| Unit suffixes | `2in`, `2 in`, `2"`, `15mm`, `3cm` |
| Measurements | `upper_chest`, `cross_chest_back`, `neck_width` |
| Gauge | `row_h` (height of one row), `st_w` (width of one stitch), e.g. `underarm.height + 2 * row_h` |
| Dotted names | `ease.bust` |
| Operators | `+ - * / ^` and parentheses; `^` is right-associative; unary minus binds looser than `^` (`-2^2 = -4`) |
| Functions | `min(a, b, …)`, `max(a, b, …)`, `abs(x)`, `round(x[, step])`, `floor(x[, step])`, `ceil(x[, step])`, `clamp(x, lo, hi)` |

Examples:

```
upper_chest/2 + ease/4
(bust - upper_chest) * 0.5
max(neck_width, 15) + 1in
round(cross_chest_back * 0.45, 0.5)
```

Names must start with a letter or underscore. `cm`, `mm`, `in` and the function names are reserved.
Errors report the position in the expression. Measurements that refer to each other are resolved in
dependency order; circular references are reported with the full cycle (`a → b → a`).

## Rounding

Raw counts are rounded in this order, and each step is shown in the UI:

1. Nearest whole stitch (halves round up).
2. Nearest pattern multiple, e.g. 4, or 4+2 (ties round up).
3. Selvedge/seam stitches added on top.
4. Parity (even/odd), stepping one pattern multiple toward the raw target. If the multiple is even, parity cannot change and a warning is shown.

## Shaping distribution

- **Auto**: spreads *n* events over the eligible rows as evenly as possible. Rows can be any row, RS only (odd rows; row 1 is RS) or WS only. Uneven spacing produces mixed rhythms such as every 8th/10th row, interleaved (or grouped short-first/long-first).
- **Fixed**: every *k*th row.
- **Mixed**: two rhythms *a* and *b*, using as many of the longer one as fit.
- **Alignment**: leftover plain rows go before the shaping (`end`, the default, so the target width is reached at the waypoint), after it (`start`), or split (`center`).
- An odd stitch change shaped on both edges gives the extra stitch to whichever edge keeps the panel centred, and warns.

## How a panel is computed

1. Waypoint expressions are evaluated for the size. Waypoints can refer to each other as `<name>.height`,
   `<name>.width`, `<name>.left`, `<name>.right` (names are lower-cased, spaces become `_`).
2. Heights are measured **up from the garment's lower edge** (the lowest waypoint), whatever the knitting direction,
   so panels are always drawn upright. Heights become rows (`round(height × rows/cm)`).
   **Top-down** panels reverse the numbering: row 1 is at the top, decreases going up become increases going down,
   bind-off steps become cast-on steps, "shaping ends at the waypoint" becomes "starts at the waypoint", and the
   neckline sits at the cast-on (shoulders worked separately, centre cast on to join).
   Widths become stitches with the rounding rules above. Templates default to an **even** total so both edges shape in pairs.
3. Between consecutive waypoints, each edge's stitch change is shaped by the segment's method:
   *spread* (auto distribution), *steps* (bind off/cast on at the start of rows), *short rows* or *straight*.
   Flat knitting: row 1 is RS. Start-of-row steps land on the **right** edge on RS (odd) rows and on the **left** edge on WS (even) rows.
   Mirrored segments with an odd change give the extra stitch to whichever edge keeps the panel centred, and say so.
4. Manual markers for a size replace the auto-suggestion for that edge. A mismatch with the target is flagged.
5. The neckline is cut from the top: the centre stitches are bound off (or held) on a RS row, then each side decreases.
   Round, square and boat necks work half the decreases every row, then every other row. V necks spread them to the top.
   The last neck decrease falls one row before the top, because the final row of a flat panel works one side only.
6. Every row's edge positions and live stitch count are recorded. The check list flags targets that are not reached,
   shaping that doesn't fit its rows, and a neck wider than the shoulders.

## Templates

Templates are starting points: everything they generate is an ordinary, editable panel. Add them from the Panels tab;
duplicate (⧉) or delete (×) any panel there. Options: knitting direction, neckline, sleeve type, and for bodices
"in the round below the underarm".

| Template | Waypoints (bottom to top) | Notes |
|---|---|---|
| **Back** | hem `(waist + full_hip)/4 + ease/2` → waist `waist/2 + ease/2 − waist_shift` → underarm `upper_chest/2 + ease/2` → armhole_bo at `underarm.height + 2 * row_h` (40 % of the armhole width change bound off in one go: the beginning of the next 2 rows) → armhole_end `cross_chest_back + 1` at `armhole_depth × 0.45` → shoulder at `underarm.height + armhole_depth` → neck_side `neck_width` (shoulder slope in bind-off steps) | Round back neck, `back_neck_depth`, centre `neck_width − 2` |
| **Front** | as the back, waist `+ waist_shift` | Round: depth `front_neck_depth`, centre `neck_width × 0.4`. V: depth `front_neck_depth × 2`, no centre. Square: depth `front_neck_depth + 2`, whole width at once. Boat: `neck_width + 6` wide, `back_neck_depth + 1` deep |
| **Sleeve, set-in** | cuff `wrist + ease.wrist` → underarm `bicep + ease.bicep` at `arm_length` → cap_bo 2 rows up (bind-off matching the body's, in one go) → cap_low → cap_high → cap_top `max(8, bicep × 0.22)` at `underarm.height + cap_height` | Bell cap: fast, steady, fast; cap decreases may fall on any row. 2x2 rib cuff section (5 cm) |
| **Sleeve, drop shoulder** | cuff → top `armhole_depth × 2` at `arm_length` | Ribbed cuff |
| **Sleeve, straight** | cuff = top `bicep + ease.bicep` | Rounded to the rib multiple so the count stays constant |
| **Plain rectangle** | bottom → top, 20 × 30 cm | |
| **Neckband strip** | `neck_width × 2 + front_neck_depth × 2` long, 2.5 cm deep, 1x1 rib | Length is an estimate until the pick-up helper |

**Top-down** bodices start at the shoulder line: both shoulders are cast on either side of the neck, the shoulder
slope is worked in short rows, the neck edges increase, and the centre is cast on to join.

## Working in the round

*Worked* in the panel properties: **Flat**, **In the round** (whole panel), or **In the round below *waypoint***. With
a join (usually the underarm), rows at and below that waypoint are rounds and the rest is flat. Top-down panels are
flat down to the join, then joined. In the round:

- every row is a RS round, so "RS rows" means every other round;
- there are no selvedge stitches (no seam), so the first flat segment above the join keeps them, e.g. the armhole
  bind-off binds off one fewer stitch each side;
- a bind-off segment that starts at the join is worked on the dividing round, both underarms at once (top-down:
  the underarm stitches are cast on where the panels are joined);
- the first flat row is a RS row, and RS/WS (and which edge a bind-off lands on) count from it.

The app never joins panels itself. When two or more panels are set to join, the check panel warns if their round
counts differ and notes when their side shaping falls on different rounds.

## Bust shaping

Front panels carry an optional bust shaping setup (Panel → *Bust shaping*). The amounts are **starting estimates**
from editable formulas, shown with your numbers plugged in, and each can be fixed for any size:

- **D** = `bust − upper_chest` (from the sizing table)
- **W**, extra width over the bust = `(bust - upper_chest) * 1.0` → available to waypoints as `bust_w`
- **L**, extra centre-front length = `max(0, (bust - upper_chest) - 0) * 0.5` (`max(0, D − b) × k`, b = 0, k = 0.5) → `bust_l`
- `bust_side_w` = W when short rows or a horizontal dart also add width at the side seams (on by default); the front
  template's underarm width is `upper_chest / 2 + ease / 2 + bust_side_w`. With vertical darts, or "none", it is 0.

The bust point is an expression too: height `shoulder.height + shoulder_slope − bust_point_depth`, distance from
centre front `apex_to_apex / 2`.

| Method | What it does |
|---|---|
| **Short rows** | `round(L × rows/cm ÷ 2)` pairs (German or wrap & turn), a stepped wedge centred vertically on the bust point. Turns are spread evenly across a zone centred on each bust point (default width `max(6, bust_l × 2.5)` cm), each row shorter or each row longer. The first short row is a RS row. |
| **Horizontal dart** | Knitted horizontal darts are short rows: turns run from the side seam (or just below the underarm) to a tip that stops short of the bust point (default 2.5 cm). Drawn with dart legs. |
| **Vertical darts** | Two darts on lines through the bust points. Each adds W/2, 2 stitches per shaping row (one each side of the dart line). They open from `waist.height + 2.5` to 2 cm below the bust point and close from 2 cm above it to `underarm.height + armhole_depth × 0.5`. When RS rows run out, the shaping moves to every row (noted). The schematic widens accordingly. |

For each size the helper lists every turn: stitches worked on the RS and WS short row, and stitches left unworked at
each edge. You can edit those per size; changing one side only is flagged as asymmetric. Vertical dart rows can be edited
per size too. Checks: turns closer than 2 stitches, turns that cross over, short rows that run into the armhole, darts
that don't fit their rows or don't close. A table shows D, W, L and the steps for every size.

The front template's armhole binds off half its width change in one go and shapes up to `armhole_depth × 0.6`, so it
can absorb the bust width in every size.

## Short-row segments

A segment shaped with **short rows** keeps all its stitches live: the turns shape the outline (e.g. a shoulder slope)
while the stitch count stays at the wider end. Top-down bodices use this for the shoulders: both shoulders are cast on
either side of the neck and the slope is worked in short rows.

## Joins (annotation only)

The app never decides how panels connect; it lets you tag edges and see how they compare. A **join** has a tag,
a name, the edges it covers and a free-text note. Tags: **seam**, **pick up stitches**, **live / held stitches**,
**bound off**, **cast on**, **free edge**. Tagged edges are drawn in their tag's colour on the schematic; click one to open its join.

Edges: a panel's **left** or **right** edge between any two waypoints (e.g. hem → underarm for a side seam,
underarm → shoulder for an armhole), the **lower edge**, the **upper edge** (outside any neckline), or the whole
**neckline** (both slopes and the centre). Tag an edge from its properties (*Tag … edge*), or build joins in the
**Joins** tab. One edge in two differently tagged joins is noted in the check panel.

**Seam check.** A seam has two sides, *this side* and *sewn to*, and each side can be several edges: e.g. a sleeve cap
(both cap edges) sewn to the front and back armholes. For each size it shows rows and length along the edge (slopes
measured as drawn, bind-off steps as horizontal runs), and the difference. Differences above the tolerance (Joins tab,
default 1 cm) are flagged. A suggestion explains how to reconcile them without changing anything: for row-for-row seams
(row counts within 10 %) it suggests where to add rows (the longest unshaped stretch of the shorter side); otherwise it
gives the extra length and the % of ease.

**Pick-up helper.** For a pick-up join: rows × ratio (default 3 sts per 4 rows, editable per join and project-wide)
plus 1 stitch per bound-off, cast-on or held stitch. Shows each edge, the combined total, and the total rounded to
multiples of 2 and 4, for every size.

## Pattern sections

A section is a band of rows in a different stitch pattern (hem rib, cuff, lace band) with its own stitch multiple.
Waypoints inside a section round to that multiple (e.g. 2x2 rib: multiple of 4 + 2). Sections are hatched on the schematic.

## Measurements

Each measurement resolves per size with this precedence (shown as a coloured dot in the UI):

1. **manual**: a per-size override you typed.
2. **table**: a value imported from the sizing table.
3. **rule**: the grading rule, either *increment* (base value at the base size plus per-size steps) or *expression* (derived from other measurements).

Measurements missing from the sizing table are seeded as **estimates** with expression rules. Check them:

| Name | Default rule (cm) |
|---|---|
| `shoulder_width` | `round(cross_chest_back + 3, 0.5)` |
| `neck_width` | `round(13 + upper_chest * 0.03, 0.5)` |
| `back_neck_depth` | `2` |
| `front_neck_depth` | `round(5.5 + upper_chest * 0.02, 0.5)` |
| `shoulder_slope` | `round(1.5 + upper_chest * 0.012, 0.5)` |
| `hem_to_waist` | `15` |
| `bust_point_depth` | `round(20 + bust * 0.07, 0.5)`: high point of shoulder to apex |
| `apex_to_apex` | `round(14 + bust * 0.04, 0.5)` |
| `cap_height` | `round(armhole_depth * 0.65, 0.5)` |
| `waist_shift` | `(bust - waist) / 4`: share of the bust-to-waist narrowing taken by the back. Back waist `waist/2 + ease/2 − waist_shift`, front waist `+ waist_shift`. Use `/ 2` for a more shaped back. |

**Ease** is total circumference ease in cm. `ease` is the global value; `ease.<measurement>` is a
per-measurement value that falls back to the global one. Expressions decide how it is split, e.g. a back panel
using `upper_chest/2 + ease/2` takes half.

## Project JSON (schema version 1)

Saved files are `*.knitbit.json`. All lengths are in cm, whatever the display units. Top level:

```jsonc
{
  "schemaVersion": 1,
  "id": "project_…", "name": "My top",
  "units": "metric" | "imperial",              // display only
  "gauge": { "stitches": 22, "rows": 30, "basis": "10cm" | "4in" },
  "sizes": [{ "id": "size_…", "name": "M" }],  // in grading order
  "baseSizeId": "size_…",
  "measurements": [{
    "name": "bust", "label": "Bust", "kind": "circumference" | "length",
    "rule": { "type": "none" }
          | { "type": "increment", "baseValue": 124.5, "defaultStep": 10, "steps": { "<sizeId>": 12 } }
          | { "type": "expression", "expr": "cross_chest_back + 3" },
    "table":  { "<sizeId>": 124.5 },            // imported values
    "manual": { "<sizeId>": 126 },              // overrides
    "estimate": true, "note": "…"               // optional
  }],
  "ease": { "global": 5, "per": { "bust": 8 } },
  "panels": [Panel],
  "settings": { "seamToleranceCm": 1, "pickUp": { "stitches": 3, "rows": 4 } },
  "createdAt": "ISO date", "updatedAt": "ISO date"
}
```

A **Panel**:

```jsonc
{
  "id": "panel_…", "name": "Back", "template": "back-bodice" | null,
  "direction": "bottom-up" | "top-down" | "side-to-side",
  "startEdge": "bottom" | "top" | "left" | "right",
  "inTheRound": false,
  "selvedge": { "left": 0-2, "right": 0-2 },
  "shapingInset": 2,                            // stitches in from the edge
  "rounding": { "parity": "any" | "even" | "odd", "rowParity": "any" | "even" | "odd" },
  "pattern": { "name": "stockinette", "multiple": 1, "offset": 0 },
  "sections": [{ "id": "…", "name": "Hem rib", "fromHeight": Dim, "toHeight": Dim, "pattern": { … } }],
  "waypoints": [{
    "id": "wp_…", "name": "waist",
    "height": Dim,                              // up from the garment's lower edge
    "symmetric": true,
    "width": Dim,                               // used when symmetric
    "left": Dim, "right": Dim                   // half-widths from the centre line, used when not symmetric
  }],
  "segments": [{                                // shaping from a waypoint up to the next one
    "fromWaypoint": "wp_…", "mirror": true,
    "left": Method, "right": Method,
    "manual": { "<sizeId>": { "left": [{ "row": 3, "delta": -1, "symbol": "ssk" }], "right": […] } }
  }],
  "neckline": null | { "shape": "round" | "v" | "square" | "boat", "width": Dim, "depth": Dim,
                       "centre": "bindoff" | "hold", "centreWidth": Dim, "side": "rs" | "any" },
  "layout": { "x": 0, "y": 0, "rotation": 0 | 90 | 180 | 270 },
  "notes": ""
}
```

`Dim` is `{ "expr": "upper_chest/2 + ease/4", "overrides": { "<sizeId>": 60 } }`: an expression plus per-size fixed values.

`Method` is one of:
- `{ "kind": "auto", "side": "rs"|"ws"|"any", "align": "end"|"start"|"center", "order": "spread"|"shortFirst"|"longFirst", "rhythm": {"type":"auto"} | {"type":"fixed","every":4} | {"type":"mixed","a":4,"b":6}, "perSide": 1 }`
- `{ "kind": "steps", "steps": [4,3,2] | null, "maxPerStep": 4 }` for bind-off/cast-on steps (`null` = auto)
- `{ "kind": "shortrows", "steps": … | null, "maxPerStep": 5, "style": "wrap-turn"|"german" }`
- `{ "kind": "straight" }`

Fields will be added as later milestones land (join tags, bust shaping, symbols). New optional fields don't
change the schema version; incompatible changes bump `schemaVersion` and add a migration.

### Loading and migrations

`loadProject` parses the JSON, checks `schemaVersion`, runs `MIGRATIONS[n]` (n → n+1) step by step up to the current
version, then validates. Errors name the exact field, e.g.
`project.panels[0].waypoints[1].height.expr: expected text, got number 42`. Files from a newer version are
refused, not guessed at.

### Auto-save

Every change is saved to `localStorage` (`knitbit.autosave.v1`) after a short pause, and restored on start. If the
auto-save can't be read, the app starts from the sample table and says why. Save to a file for anything you want
to keep. Auto-save is only a safety net.

## Undo

Undo and redo cover every project edit, but not view changes (zoom, selected size). Rapid edits to the same field merge into one step.
Shortcuts: ⌘Z undo, ⇧⌘Z redo, ⌘S save, ⌘O open, `[` / `]` previous/next size, `F` fit the view, `Esc` select the panel.
On the canvas: scroll to zoom, drag to pan, hover for row/stitch count, click an edge, waypoint or the neck to edit it.

## Sizing tables

### Import format

One row per size, one column per measurement, plus one column with the size names. Values in cm or inches
(chosen on import). Size order in the file becomes the grading order.

**CSV** (comma, semicolon or tab separated; quoted fields allowed; a header row is required):

```csv
size,upper_chest,bust,waist,full_hip,cross_chest_back,waist_to_armhole,back_waist_length,armhole_depth,bicep,wrist,arm_length
3XS,73.5,78.75,71,84,29.5,18,34.75,16.75,25.75,14.75,44.5
M,114.5,124.5,114.5,132,38.25,19.25,42,22.5,41.25,17,47
```

**JSON**, in any of these shapes:

```json
[{ "size": "M", "bust": 124.5, "waist": 114.5 }, …]
{ "sizes": [{ "size": "M", "bust": 124.5 }, …] }
{ "M": { "bust": 124.5, "waist": 114.5 }, "L": { … } }
```

### Column mapping

The importer suggests a target for each column: the size column, an existing measurement (by name, label or a
common synonym such as *hips → full_hip*, *high bust → upper_chest*, *cross back → cross_chest_back*), a new
measurement named after the header, or *ignore* (for columns with no numbers). Every choice can be changed.

- **Update matching sizes, add new ones** (merge): sizes are matched by name, ignoring case. Values in the file replace
  table values for those sizes; blank cells leave existing values alone.
- **Replace all sizes**: the project's sizes become exactly the file's, in file order. Sizes with the same name keep
  their ids, so manual values and per-size overrides on panels survive. Other sizes are removed with all their data.

An import is one undoable step. Imported values replace seeded estimates (the *est.* tag is removed).

### Editing and grading

The **Measurements** view is a sizes × measurements grid. Each cell shows where its value comes from:
plain = table, blue italic = rule, orange = manual. Typing in a cell sets a manual value for that size; clearing it
goes back to the table or rule. ▴ marks a zigzag (a size that goes against both neighbours, e.g. M smaller than S
while S and L both grow). Nothing is changed automatically.

Select a measurement to rename it (every expression that uses it is updated, including `ease.<name>`), change its
label, kind and grading rule, set per-measurement ease, see where it is used, or delete it.
**Convert values to steps** makes a *base size + steps* rule that reproduces the current values exactly and clears
the table values, so you can then grade by editing steps. Changing the base size keeps all rule values the same.
With no measurement selected, the right panel manages sizes: rename, reorder, add, delete, and pick the base size.
