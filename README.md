# Knitbit

A local-only visualizer for knitted panel shaping in women's tops: schematics, size grading,
shaping placement, bust shaping and stitch charts. It does not write pattern text and does not decide
how panels are joined.

**Sizing data credit:** Body measurements adapted from Ysolda Teague's designer size chart, ysolda.com/designer-size-chart.
The adapted table (`samples/sizing_table_ysolda_cm.csv`) is for personal use and should not be redistributed as a chart.

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
  - `joins.ts`: measuring tagged edges, seam comparison, pick-up suggestions. `edges.ts`: edge length along the outline.
  - `waypointDrag.ts`: proportional waypoint height/width edits, linked panels, match.
  - `layout.ts`: garment layout geometry (local cm frame, rotation, placement), size alignment, T-shape auto-arrange.
  - `free.ts`: painted stitches (paint, erase, repeat, mirror, copy to all sizes). `lines.ts`: shaping lines.
  - `chart.ts`: the stitch chart grid built from a computed panel (cells, short rows, repeats, legend, column folding).
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
| Functions | `min(a, b, …)`, `max(a, b, …)`, `abs(x)`, `sqrt(x)`, `round(x[, step])`, `floor(x[, step])`, `ceil(x[, step])`, `clamp(x, lo, hi)` |
| Armhole | `armhole_len`: the armhole a sleeve is sewn into (see Templates) |

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

## Dragging waypoints and linked panels

On the schematic (one size), **click a waypoint's dashed line to activate it** (it turns blue and gets a grip in the
middle; dragging an inactive line just pans the view). Then **drag the line or its grip** up or down to move it (snaps
to whole rows), and **drag the squares at its ends** to change its width (snaps to half stitches per side; on an
asymmetric waypoint each end moves its own half). Or use the keyboard: **↑ ↓** one row, **← →** one stitch each side
narrower/wider, **Shift** for 5. A readout shows the row or stitch count; each drag (or run of key presses) is one
undo step.

Every size follows **proportionally**:
- a dragged **height** is rewritten as a fraction of the way between the waypoints below and above,
  `armhole_bo.height + (shoulder.height - armhole_bo.height) * 0.42`, so it keeps its relative place in every size
  (neighbours that refer back to it are skipped to avoid loops; the top or bottom waypoint keeps a fixed distance from
  its neighbour);
- a dragged **width** multiplies its expression, `(cross_chest_back + 1) * 1.18`; repeated drags fold into one factor.

Hold **Alt** while dragging to change **this size only** (a per-size fixed value). Typed formulas are replaced when
you drag (the old one stays in undo).

**Linked panels** (Panel → *Linked panel*, e.g. Back ↔ Front, set by you): dragging a waypoint also moves the
waypoint **with the same name** on the linked panel **by the same amount** (the same rows in this size, then
proportionally in the others; widths by the same proportion), so differences you built in are kept. To line them up
instead, a linked waypoint's properties have *Make Front's armhole_end match this one: height / width / both*.

## Templates

Templates are starting points: everything they generate is an ordinary, editable panel. Add them from the Panels tab;
duplicate (⧉) or delete (×) any panel there. Options: knitting direction, neckline, sleeve type, and for bodices
"in the round below the underarm"; top-down bodices also have construction, shoulders and back neck.

| Template | Waypoints (bottom to top) | Notes |
|---|---|---|
| **Back** | hem `hem_circ/2 + ease/2` at 0 → waist `waist/2 + ease/2 − waist_shift` at `hem_drop` → underarm `upper_chest/2 + ease/2` at `waist.height + waist_to_underarm` → armhole_bo at `underarm.height + 2 * row_h` (40 % of the armhole width change bound off in one go: the beginning of the next 2 rows) → armhole_end `cross_back_w + 1` at `armhole_depth × 0.45` → shoulder `shoulder_w` at `underarm.height + armhole_depth` (increases from armhole_end: the *widen to the shoulder width* option, on by default; off = straight up at the armhole_end width) → neck_side `back_neck_width` at `shoulder.height + shoulder_drop` (shoulder slope in bind-off steps) | Round back neck, `back_neck_drop`, centre `back_neck_width − 2` |
| **Front** | as the back, waist `+ waist_shift`, underarm `+ bust_side_w`, armhole_end `cross_front + 1` (the same `shoulder_w` at the shoulder, so the shoulder seams match; without the widening the front ends at the back’s `cross_back_w + 1`) | Round: depth `front_neck_drop`, centre `back_neck_width × 0.4`. V: depth `front_neck_drop × 2`, no centre. Square: depth `front_neck_drop + 2`, whole width at once. Boat: `back_neck_width + 6` wide, `back_neck_drop + 1` deep |
| **Sleeve, set-in** | cuff `wrist + ease.wrist` → underarm `bicep + ease.bicep` at `arm_length` → cap_bo 2 rows up (bind-off matching the body's, in one go) → cap_low → cap_high → cap_top `max(8, bicep × 0.22)`, its height **fitted to the armhole** | Bell cap: fast, steady, fast; cap decreases may fall on any row. 2x2 rib cuff section (5 cm) |
| **Sleeve, drop shoulder** | cuff → top `armhole_depth × 2` at `arm_length` | Ribbed cuff |
| **Sleeve, straight** | cuff = top `bicep + ease.bicep` | Rounded to the rib multiple so the count stays constant |
| **Plain rectangle** | bottom → top, 20 × 30 cm | |
| **Neckband strip** | `back_neck_width × 2 + front_neck_drop × 2` long, 2.5 cm deep, 1x1 rib | Length is an estimate until the pick-up helper |

**Set-in cap height follows the armhole.** `armhole_len` is the armhole the sleeve is sewn into, measured along the
edges: the other side of a seam join that contains one of the sleeve's edges, or else the Front + Back panels' left
armholes (underarm → shoulder), or, with no bodies at all, the body's `scye_circumference` (or, without it, an
estimate from `armhole_depth`; noted in the checks). The
cap top height solves `both cap edges ≈ armhole_len + cap_ease` (`cap_ease`, default 1.5 cm, is a graded measurement):
`cap_bo.height + sqrt(((armhole_len + cap_ease)/2 × 0.966 − bind-off run)² − horizontal run²)`; 0.966 allows for the
bell's curve. In the sample sizes the cap comes out 0.3–2.6 cm longer than the armhole; the seam check shows the exact figure.

**Fit choices** (Project tab → *Fit*) pick sizing-table columns for names the templates use. They behave like
measurements with an expression rule (shown in the Measurements grid with a *fit* tag); a measurement of the same name
wins over them.

| Name | Follows | Choice |
|---|---|---|
| `bust` | `bust_ab_cup` / `bust_cd_cup` / `bust_ef_cup` / `bust_gh_cup` / `bust_custom` | cup (default C/D) |
| `dart_height`, `apex_to_apex` | `dart_height_<cup>`, `apex_to_apex_b/d/f/h` | cup |
| `hem_circ` | `high_hip` (default), `hip_seat_straight` or `hip_seat_curvy` | hem |
| `hem_drop` | `waist_to_high_hip` (high hip) or `waist_to_full_hip` (seat) | hem |
| `shoulder_w`, `cross_back_w` | `back_shoulder_width`, `cross_back` (or the `_broad` columns) | broad back |

A template that refers to a choice whose column the project lacks (e.g. an old project without `high_hip`) says so in
the checks: import or merge the sizing table, or pick another choice. `waist_to_underarm` is a derived, editable
measurement: `back_neck_drop + back_waist_length − shoulder_drop − armhole_depth` (HPS → waist minus HPS → underarm).
Vertical bust darts start at the waist.

**Top-down tops are worked shoulders first** (the default for top-down backs and fronts, and the first template,
*Top-down top (back + front)*, which adds both panels and their joins):

1. **Back**: cast on at the shoulders. *Back neck*: **straight** (cast on straight across, the default) or **shaped**
   (a back neckline with increases and the centre cast on). *Shoulders*: **sloped** in German short rows (default)
   or **straight**. Worked flat with the armhole increases to the row before the underarm cast-on.
2. **Front**: each shoulder is **picked up** from the back's cast-on edge (the schematic and chart say "pick up N sts";
   the same slope option applies, so a sloped back gets a sloped front), worked flat with the neck increases and the
   armhole increases, ending on the same row as the back. The centre neck stitches are cast on to join the sides.
3. **Underarms**: `underarm_co` (an estimated measurement, `upper_chest × 0.05`, editable) is cast on at each
   underarm, **half on the front and half on the back**, a whole number of stitches per side so both match. The
   armholes increase from `armhole_end` (`armhole_depth × 0.6` back, `× 0.75` front above the underarm) to there.
4. **In the round** below the underarm (pullovers): the round starts only when the underarms are joined **and** the
   neck is closed; a deep V that closes below the underarm keeps the body flat until then (noted in the checks).
5. Bust and waist shaping as usual.

The set adds two ordinary, editable joins: *Front shoulders picked up from the back* (pick up, with the stitch count)
and *Underarm cast-on* (front sides vs back sides). Choose **Construction: Standalone** on a top-down back or front for
the old behaviour (each panel cast on at its own top). Cardigans (left/right fronts, optional button band) are planned.

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
| **Short rows, bust point → side seam** | Same method with *Turns span: Bust point → side seam* (and usually *Start: At the bust point*). The first turn is at the bust point; each later one is `step` stitches further towards the side seam, where `step` = stitches between the bust point and the side (less a 2-st margin) ÷ turns per side, rounded down. Top-down: start right after the bust-point row, each row longer. Bottom-up mirror: start near the side seam, each row shorter, finishing at the bust-point row. The preset button sets all of this (and German short rows) for the panel's direction. If the turns don't fit (step < 1 st), you're told to shorten L or stack a second dart. |
| **Horizontal dart** | Knitted horizontal darts are short rows: turns run from the side seam (or just below the underarm) to a tip that stops short of the bust point (default 2.5 cm). Drawn with dart legs. |
| **Vertical darts** | Two darts on lines through the bust points. Each adds W/2, 2 stitches per shaping row (one each side of the dart line). They open from `waist.height + 2.5` to 2 cm below the bust point and close from 2 cm above it to `underarm.height + armhole_depth × 0.5`. When RS rows run out, the shaping moves to every row (noted). The schematic widens accordingly. |

In the saved file these are `bust.shortRows.span` (`"zone"` | `"apex-to-side"`) and `bust.shortRows.start`
(`"centred"` | `"apex"`), both optional (default zone, centred). The schematic wedge is drawn in working order over
the rows that follow the insertion point, so its wide edge is where the first (longest) short rows are.

For each size the helper lists every turn: stitches worked on the RS and WS short row, and stitches left unworked at
each edge. You can edit those per size; changing one side only is flagged as asymmetric. Vertical dart rows can be edited
per size too. Checks: turns closer than 2 stitches, turns that cross over, short rows that run into the armhole, darts
that don't fit their rows or don't close. A table shows D, W, L and the steps for every size.

The front template's armhole binds off half its width change in one go and shapes up to `armhole_depth × 0.6`, so it
can absorb the bust width in every size.

## Princess-seam shaping

Increases and decreases can be worked at two vertical **princess lines** instead of, or as well as, the side edges
(Shaping → *Shape at*: Side edges / Princess lines / Side edges + princess lines). The choice is per segment, so
waist decreases and hip increases can differ, and per panel (front only, or front and back).

- **Position**: `panel.princess.position`, the distance of each line from the centre line, default `apex_to_apex / 2`
  (through the bust points), shared by all of the panel's princess segments; editable with per-size fixed values.
- **At each line**: both sides of the marker (2 sts per line per shaping row, e.g. "ssk, sm, k2tog") or one side
  (1 st). With *Side edges + princess lines* each half also shapes 1 st at the edge (3 sts per half per row).
- The stitch counts at each waypoint are unchanged; you just need about half as many shaping rows. When the change
  doesn't divide evenly, the odd stitch is worked on one side of the marker on one row (noted in the checks).
- The schematic keeps drawing the finished width, with the lines dashed and the markers on them; the chart puts the
  symbols either side of each line. Hand-placed markers on a princess segment count all their stitches (a k2tog marker
  at a two-sided line is −2). Bind-off/cast-on steps stay at the edges.

## Experimenting: painted stitches and shaping lines

For shaping the options don't cover, two free-form tools. Both work *inside* the fabric: stitches they add or remove
widen or narrow the panel evenly about the centre (like vertical darts), the stitch counts, Checks, seam lengths and
the chart all follow, and the edge shaping is not changed, so later widths move with them (a note says by how much;
a warning appears if the shoulders or top run out of stitches).

**Painted stitches** (Chart → ✎ Paint, or P). Pick a stitch (every symbol except bind-off/cast-on/turns, plus your
own), then click or drag to paint; click a painted stitch again, right-click, or use the Eraser to remove. **Mirror**
(on by default) paints the mirror image across the centre with leaning stitches swapped (ssk ↔ k2tog, M1L ↔ M1R).
**Every N rows × k** repeats each placement up the panel. Each stroke is one undo step. Painted cells have a thin blue
outline; on the schematic they show as small coloured marks. Painted stitches belong to one size: **Copy to all
sizes** places this size's stitches in every size (replacing theirs) at the same relative place: between the same two
waypoints at the same fraction of the way, and at the same fraction of the half width, snapped to that size's
stitches. **Clear size** removes this size's. Shaping-row positions are relative to each row's centre, so they stay
put when other shaping changes the width.

**Shaping lines** (Panel → *Shaping lines*, or Schematic → ✎ Line and click the two ends). A line has:
- two ends, each a height (up from the lower edge) and a distance from the centre (− = left half), as expressions.
  Lines drawn on the schematic are stored relative to the waypoint below and that waypoint's width, e.g.
  `waist.height + 2` and `waist.width / 2 * -0.5`, so they grade with the sizes. Chips fill in waypoints, the
  centre, the bust point, ⅓ in from the side or 3 cm from the side;
- **stitches** per line (an expression in stitches, e.g. `-6`, or `round(-3 / st_w)` for 3 cm), with per-size
  fixed values; − decreases going up the garment;
- **shape**: *one way* (keeps the change) or *fisheye* (makes the change up to the middle, then undoes it; drawn
  lines start as fisheye so nothing runs out of stitches);
- **at the line**: both sides (2 sts per shaping row, the stitch on the outer side and its mirror on the inner side)
  or one side; **RS rows** or any row (falls back to every row with a note); **mirror** on the other half (default on).

Rows are spread evenly (centred) between the ends; a slanted line moves across as it rises. Per size you can edit the
rows by hand in the line's table (Reset to auto goes back). Presets: fisheye dart through the bust point, waist dart
⅓ in from the side, slanted side-front dart, sway-back dart at the centre back.

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

## Layout and size display

The centre view has four tabs: **Schematic** (one panel), **Chart** (one panel, stitch by stitch), **Layout** (all
panels) and **Measurements**.

**Layout** draws every panel at one scale (cm, y up). Panels keep their position and rotation (`panel.layout`, cm,
rotation 0/90/180/270 anticlockwise about the panel's centre line at its lower edge). Until a panel has been placed,
the layout shows an automatic **T-shape**: back and front side by side on a common lower edge, a sleeve either side
with its cap pointing at the body at underarm height, everything else underneath. Spacing leaves room for the largest
size. Drag a panel to move it (snaps to 0.5 cm; one undo step per drag), ⟲ / ⟳ rotate the selected panel,
**Auto-arrange (T)** re-applies the T-shape. Join edges are drawn in their tag colour and each seam's two sides are
linked by a dashed line; click either to open the join.

**Size display** (Schematic and Layout): **One size**, **Overlay** (selected sizes as nested outlines in a sequential
light-to-dark ramp with a legend, aligned at the lower edge, waist, underarm, shoulder or top; the schematic overlay
also shows each size's bust points and short-row wedges), or **Grid** (each selected size side by side at the same
scale; in Layout, the whole arrangement per size). Choose the sizes with *Sizes ▾*. These are view settings, not undoable.

## Stitch chart

The **Chart** tab draws the selected panel one square per stitch, one row per knit row, **upright** like the
schematic (row 1 at the bottom for bottom-up panels, at the top for top-down ones). It is a picture of the shaping,
not pattern text.

- **Cells.** Each row shows the stitches on the needle at the end of that row. Bound-off stitches are drawn in the
  row that binds them off (BO); cast-on stitches in the row that casts them on (CO). Decreases and increases sit
  `shapingInset` stitches in from the edge (default 2: "k2, ssk … k2tog, k2"), using the marker's symbol. Neck
  centre stitches are bound off or placed on hold on the split row; neck-edge shaping is mirrored on both sides.
  Stitches held by short-row segments are hatched; vertical bust darts show their increases/decreases either side
  of each dart line.
- **Bust short rows** are inserted where they are worked, right after knit row `bust.shortRows.afterRow`, labelled
  **SR1, SR2, …** (odd = RS, even = WS). Each shows the stitches it works, the turn (German double stitch ◆ or
  wrap & turn ◇) and the held stitches beyond it. They aren't counted as knit rows, so row numbers match the schematic.
- **Reading direction.** Flat RS rows read right to left (number on the right), WS rows left to right (number on
  the left); in the round every round reads right to left. Stitches are numbered from the right. A blue number
  beside a row is the stitch count after it, shown where it changes. Every 10th stitch and row has a stronger line.
- **Repeats.** Pattern sections get a bracket in the left margin with their name and multiple, and dashed lines
  every *multiple* stitches.
- **Collapse plain middle** folds long runs of identical plain columns into a ⋯n column (off by default).
- **Zoom**: −/+, ⌘/Ctrl + scroll, **Fit** (F). Below about 7 px per stitch symbols are drawn as coloured bands.
- **Editing.** Click a shaping symbol to select its marker (the marker table opens on the right), drag it up or down
  to move it (one undo step), Delete removes it, double-click a stitch to add a marker on that row at the nearer
  edge. As on the schematic, the first edit switches that size to hand-placed markers.
- **Legend** lists exactly the symbols the chart uses. **My symbols** adds your own: a colour, an abbreviation, a
  meaning and a stitch change; they appear in every marker's *Stitch* menu and are drawn as a coloured cell with
  the abbreviation.
- **Sizes**: One size or Grid (each selected size's chart at one shared scale). Overlay doesn't apply to charts.

## Pattern sections

A section is a band of rows in a different stitch pattern (hem rib, cuff, lace band) with its own stitch multiple.
Waypoints inside a section round to that multiple (e.g. 2x2 rib: multiple of 4 + 2). Sections are hatched on the schematic.

## Measurements

Each measurement resolves per size with this precedence (shown as a coloured dot in the UI):

1. **manual**: a per-size override you typed.
2. **table**: a value imported from the sizing table.
3. **rule**: the grading rule, either *increment* (base value at the base size plus per-size steps) or *expression* (derived from other measurements).

Measurements the templates need that the sizing table lacks are seeded as **estimates** with expression rules. The
shipped table has most of them; the first group is only seeded for older tables. Check them:

| Name | Default rule (cm) |
|---|---|
| `back_shoulder_width` | `round(cross_back + 3, 0.5)` (older tables only) |
| `back_neck_width` | `round(13 + upper_chest * 0.03, 0.5)` (older tables only) |
| `back_neck_drop` | `2` (older tables only) |
| `front_neck_drop` | `round(5.5 + upper_chest * 0.02, 0.5)` (older tables only) |
| `shoulder_drop` | `round(1.5 + upper_chest * 0.012, 0.5)` (older tables only) |
| `hps_to_apex` | `round(20 + bust * 0.07, 0.5)` (older tables only) |
| `apex_to_apex` | `round(14 + bust * 0.04, 0.5)` (tables without the apex columns) |
| `cap_height` | `round(armhole_depth * 0.65, 0.5)` |
| `underarm_co` | `round(upper_chest * 0.05, 0.5)` |
| `cap_ease` | `1.5` |
| `waist_shift` | `(bust - waist) / 4`: share of the bust-to-waist narrowing taken by the back. Back waist `waist/2 + ease/2 − waist_shift`, front waist `+ waist_shift`. Use `/ 2` for a more shaped back. |

**Ease** is total circumference ease in cm. `ease` is the global value; `ease.<measurement>` is a
per-measurement value that falls back to the global one. Expressions decide how it is split, e.g. a back panel
using `upper_chest/2 + ease/2` takes half.

## Project JSON (schema version 2)

Saved files are `*.knitbit.json`. All lengths are in cm, whatever the display units. Top level:

```jsonc
{
  "schemaVersion": 2,
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
  "fit": { "cup": "cd" },              // which bust column `bust` follows: ab | cd | ef | gh | custom (bust_custom)
  "panels": [Panel],
  "joins": [Join],                             // optional
  "symbols": [{ "id": "custom_…", "label": "Twisted decrease", "abbr": "tw",
                "color": "#f2d17a", "change": -1 }],   // optional: your own chart symbols
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
    "placement": "edge" | "princess" | "both",  // optional, default edge
    "left": Method, "right": Method,
    "manual": { "<sizeId>": { "left": [{ "row": 3, "delta": -1, "symbol": "ssk" }], "right": […] } }
  }],
  "neckline": null | { "shape": "round" | "v" | "square" | "boat", "width": Dim, "depth": Dim,
                       "centre": "bindoff" | "hold", "centreWidth": Dim, "side": "rs" | "any" },
  "princess": null | { "position": Dim, "sides": "both" | "one" },   // optional
  "freeStitches": [{ "id": "st_…", "sizeId": "size_…", "row": 40, "x": -8.5,      // optional; x = cell's left edge
                     "symbol": "k2tog", "mirror": true }],                       //   in sts from the row's centre
  "shapingLines": [{ "id": "line_…", "name": "Dart",                               // optional
                     "from": { "height": Dim, "x": Dim }, "to": { "height": Dim, "x": Dim },
                     "amount": Dim, "kind": "one-way" | "fisheye", "sides": "both" | "one",
                     "rowSide": "rs" | "any", "mirror": true, "manual": { "<sizeId>": [12, 16] } }],
  "startFrom": "caston" | "pickup",            // optional: how the first row is made (top-down fronts: pickup)
  "linkedTo": "panel_…" | null,                // optional: linked panel (waypoint drags follow by name)
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
refused, not guessed at. Each migration reports every change it makes; the app shows the list when it opens an old
file or restores an old auto-save.

**Schema 1 → 2** (the Ysolda sizing table, `src/engine/legacy.ts`):

| Old name | New name |
|---|---|
| `full_hip` | `hip_seat_straight` |
| `cross_chest_back` | `cross_back` |
| `shoulder_width` | `back_shoulder_width` |
| `neck_width` | `back_neck_width` |
| `back_neck_depth` | `back_neck_drop` |
| `front_neck_depth` | `front_neck_drop` |
| `shoulder_slope` | `shoulder_drop` |
| `bust_point_depth` | `hps_to_apex` |
| `bust` | the closest cup column, e.g. `bust_ef_cup` (see below) |

- References in every expression (panels, bust, princess and shaping lines, measurement rules, `ease.<name>`) follow
  the rename, and renamed measurements take the dictionary label. Values, manual values and overrides are unchanged.
- `bust`: the cup is the one whose typical bust − upper chest (A/B 5, C/D 7.5, E/F 10, G/H 12.5 cm) is closest to the
  project's average; the project's cup choice (`fit.cup`) is set to it, and the report says which cup was picked and
  lists sizes whose own difference points to another cup. Expressions keep saying `bust`, which now follows the cup
  choice.
- `waist`, `upper_chest`, `bicep`, `wrist`, `arm_length`, `armhole_depth` and `back_waist_length` keep their names;
  `waist_to_armhole` stays as a custom measurement.
- If the new name is already taken: an old measurement that only copied the new one (`= back_shoulder_width`) is
  removed; one with its own values is kept as `<new name>_old`.
- After an upgrade the app offers **Merge the Ysolda sizing table by size name** (an ordinary, undoable merge import).
  Old tables imported or seeded with a single `bust` column go through the same mapping.

The tests in `src/engine/legacy.test.ts` load `src/engine/fixtures/project_v1.json`, a real schema-1 project.

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
(chosen on import). Size order in the file becomes the grading order. An optional `source` column says where a row
came from (`table` or `estimated`); estimated rows get a subtle *est* mark on the size name.

The sample table, `samples/sizing_table_ysolda_cm.csv` (and the same data as `.json`), has 11 sizes (4XS to 4X) of
body measurements in cm, adapted from Ysolda Teague's designer size chart (2026, 5 cm grade version, pairs of grade
columns averaged; 4XS estimated). Every column is described in the measurement dictionary
(`src/engine/dictionary.ts`), which supplies the labels and the tooltips shown in the app. `legacy_…` columns are
from an older table, kept for reference only and never used in calculations.

**CSV** (comma, semicolon or tab separated; quoted fields allowed; a header row is required):

```csv
size,source,upper_chest,bust_ab_cup,bust_cd_cup,…,waist,high_hip,…
4XS,estimated,63.5,68.5,71,…,58.5,70,…
M,table,114.5,119.5,122,…,109.25,120.5,…
```

**JSON**, in any of these shapes:

```json
[{ "size": "M", "bust": 124.5, "waist": 114.5 }, …]
{ "sizes": [{ "size": "M", "bust": 124.5 }, …] }
{ "M": { "bust": 124.5, "waist": 114.5 }, "L": { … } }
```

### Column mapping

The importer suggests a target for each column, and every choice can be changed:

1. the size column, and the `source` column (*Row source*);
2. `legacy_…` columns: *ignore*;
3. **exact header names** from the measurement dictionary or the project's measurements;
4. otherwise an existing measurement by label or a common synonym (*hips → full_hip*, *high bust → upper_chest*), a
   new measurement named after the header, or *ignore* (for columns with no numbers).

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
