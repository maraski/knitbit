# Flexibility and helpful errors: plan

_2026-11-01. Planning only: nothing here is built yet. Base: `main` at `b72d9da`._

The user's report: it is unclear which value makes a shoulder strap narrower (especially on the contiguous yoke);
deepening a neckline past the yoke split gives a wall of errors although real knitting continues the neck shaping
below the underarm; and error messages don't say which value to change.

This plan covers three areas, each with findings (reproduced in the engine and the browser), the user's answers and
the proposed changes, then milestones and risks.

---

## Decisions (user answers, 2026-11-01)

| Question | Answer |
|---|---|
| Narrower strap: what gives? | **Both, the user chooses**: one *Strap width* setting, with *neck widens* or *armhole cuts in* |
| Automation | **Linked drivers + Apply**: a few driver settings (strap width, neck depth) update the values that depend on them; every other problem offers a suggested fix with an *Apply* button. Nothing changes silently |
| Deep neck on yoke methods (contiguous, classic raglan) | **Front body shaping**: the yoke splits as usual, the neck increases carry on at the centre-front edges of the Front body piece(s). A pullover body is worked flat until the neck closes, then joined in the round |
| Deep neck on the modified raglan | **Short rows + neck increases**: the short rows only raise the back (the back neck drop); the rest of the front depth is a narrower front cast-on and front-neck increases, carrying on into the body when needed |
| How errors look | **Root cause + Fix**: one row per root cause, with *Fix: change \<field\> (now 25 cm, needs ≤ 19 cm in 4XS–XS)*, *Go to field* / *Apply*; knock-on errors in other pieces folded under it |
| Sizes in the Checks list | **All sizes, grouped** (as now: one row per problem, its sizes listed, the current size's numbers shown); *This size* filter kept |
| Saved projects | **Keep as saved**: stored values are kept; new behaviour applies to new garments or when the setting is touched. Cases that used to be errors (a neck below the split) simply start working |
| Priorities | **Contiguous deep V**, **narrow straps**, **seamed / top-down**. Classic raglan deep V comes along with the contiguous work (same code path) but isn't a priority on its own |

---

## 1. Shoulder strap width

### Findings

"Strap" here means the shoulder left between the neck opening and the armhole edge at the shoulder line (seamed and
top-down: the width the shoulder slope is worked over; contiguous: the shoulder seam). Numbers below are size M,
sample table, 22 × 30 gauge (`shoulder_w` 44.5 cm, `back_neck_width` 16.4 cm).

| Construction | What sets the strap today | How the values interact |
|---|---|---|
| **Seamed, bottom-up** (Back, Front) | `shoulder` waypoint width (`shoulder_w`), `neck_side` waypoint width (`back_neck_width`), the neckline's *width* (`back_neck_width`) | strap = (shoulder − neck_side) / 2 = (98 − 36) / 2 = 31 sts ≈ 14 cm. The neckline width must equal the `neck_side` width: two separate fields with the same default |
| **Top-down, shoulders first** | same three values; the Back is straight (no neckline) by default, so its neck is `neck_side` alone | same; the Front's neckline width and its `neck_side` width must match the Back's `neck_side` |
| **Boat neck** (seamed, top-down) | neckline width `shoulder_w − 6`, `neck_side` width the same | the only construction where the strap (3 cm) is visible, as the `6` inside an expression |
| **Contiguous yoke** (back-neck start) | yoke *Neck width* (`neck.width`, cast on across the back), *Back width after the shoulders* (`shoulder.backWidth`, `cross_back_w + 1`), back neck increases (B), cap-top move (k); or *length* mode: *Shoulder seam length* − *Shorten* | the strap is the shoulder seam: A rows = (backWidth + 2k − neck sts − B) / 2, so its length is in **rows** (27 rows = 9.0 cm). Four fields can change it, two of them only in *length* mode |
| **Modified raglan** | as contiguous, plus the front cast-on `shortRows.frontCo` (`neck_w`) | as contiguous |
| **Classic raglan** | no strap: neck width and *sleeve top* (`raglan.sleeveTop`) | nothing to narrow; the UI should say so |

Experiments (scratch tests, all sizes; reproduced for M):

- **Seamed or top-down, neckline width +4 cm only:** *"Neck wider than the shoulders at row 168: the left side would
  have -3 sts. Narrow the neck, widen the top, or move the shoulder shaping."* plus *"The stitch count goes negative
  (-6) at row 169."* on Back and Front. The message doesn't say that "the top" is the `neck_side` waypoint.
- **…and `neck_side` +4 cm as well:** works on the Front, but the bottom-up Back now says *"Neckline: 8 decreases per
  side do not fit in 7 rows."* (the back neck is only 2 cm deep). On a boat neck the same change leaves 1 st of strap
  rounding: *"shoulder → neck_side (right edge): 1 steps need 1 RS rows, but only 0 are available."*
- **Contiguous, neck width +4 cm:** seam 27 → 22 rows (9.0 → 7.3 cm); the back at the end of the shoulders stays at
  the cross back. **Back width target −4 cm:** also 22 rows, but the back is 4.6 cm narrower (fit changes).
  **Length mode:** seam jumps to 14.7 cm (the sloped default) and the body is 5 sts too wide.
- **Contiguous boat neck:** the seam is **2 rows (0.7 cm)**, because the boat's cast-on (`shoulder_w − 6` = 38.5 cm)
  is already wider than the cross back: the 3 cm strap of the panel boat neck doesn't carry over. Neck width +4 cm
  → *"The shoulder phase has -2 rows: the back is already as wide as the target."* (error).

**Is there one obvious control? No.** On panels it takes two matching fields (neckline width and `neck_side` width)
per piece, front and back kept in step by hand; on the contiguous yoke the strap is a by-product of the neck width and
the back-width target, in rows.

### Proposal: a *Strap width* driver

A garment-level **Shoulders → Strap width** (cm, per-size overrides, default = today's value so nothing moves) and a
**Strap gives at: Neck | Armhole** choice. Shown in the Garment tab and in each piece's neckline/yoke properties
with a one-line readout per piece, e.g. *Strap 3.0 cm (13 sts) · neck 38.5 cm · shoulder 44.5 cm*.

| Construction | *Neck* gives (default) | *Armhole* gives |
|---|---|---|
| Seamed / top-down | `neck_w = shoulder.width − 2 × strap`; the neckline *width* and the `neck_side` waypoint both read `neck_w` (one value, front and back) | `shoulder.width = neck_w + 2 × strap`: the shoulder line moves in; `armhole_end` (cross back/front) follows when it would be wider than the new shoulder; the armhole length check reports the change |
| Boat neck | strap default 3 cm; `neck_w = shoulder_w − 2 × strap` (replaces the literal `− 6`) | as above |
| Contiguous / modified raglan | the generator solves the neck width so the seam is `strap` long (A rows = strap × row gauge), the back still reaching `backWidth` | the generator keeps the neck and lowers the back-width target to `neck + 2 × strap`; an info check says the cross back is no longer followed (it was a firm rule: [contiguous-cardigan-options]) |
| Contiguous boat | strap 3 cm gives a real 9-row seam (the cast-on narrows to fit) | as above |
| Classic raglan | not shown; a note says a raglan has no shoulder seam (neck width and sleeve top shape the top) | — |

Linked values show as "from strap width" next to the field (expression `neck_w`), and typing a value there unlinks
it (with a *Re-link to strap* button). Old projects open with no strap setting: the readout shows the derived strap,
and choosing a strap writes the linked expressions (one undo step). Neck shaping that no longer fits (the bottom-up
back neck with 8 decreases in 7 rows) gets the *Fix/Apply* treatment of area 3 (e.g. *Apply: back neck depth 3 cm*).

---

## 2. Deep necklines past the yoke split / armhole

### Findings

Scratch test: every method, round and V, front neck depth 15 and 25 cm, all 11 sizes (`projectChecks`):

| Method, neck | 15 cm | 25 cm |
|---|---|---|
| Seamed, round / V | 0 errors | **0 errors** (bottom-up neck shaping starts below the armhole already) |
| Top-down shoulders-first, round / V | 0 | 0 errors, but **10 warnings**: *"Panels joined in the round have different numbers of rounds below the join (Back #, Front #)"*, a false alarm: the Front is flat until the neck closes (an info note says so), so of course it has fewer rounds |
| Contiguous, round / V | 0 | **36 errors, 29 warnings** (4XS–XS) |
| Classic raglan, round / V | 0 | **72 errors, 56 warnings** (8 sizes) |
| Modified raglan, round | **90 errors, 65 warnings** | 101 errors, 73 warnings |

**Browser reproduction** (dev server, New garment → Contiguous yoke, V, pullover; yoke *Depth below the neck point*
= 25): the Checks bar goes from *5 warnings* to **36 errors · 29 warnings**, and the sleeve and body panels show
*"This panel can't be drawn in this size."* The list, all for 4XS–XS:

```
Yoke · The front neck closes on row 75, below the underarm split (row 58). Make the neck shallower or the yoke deeper.
Back · yoke.*: the yoke can't be computed in this size (The front neck closes on row 75, … deeper.).
Back · underarm width: Unknown name "yoke.back_w"
Front · yoke.*: … / Front · underarm width: Unknown name "yoke.front_w"
Left sleeve · yoke.*: … / Left sleeve · underarm width: Unknown name "yoke.sleeve_w"
Right sleeve · (the same two)
Yoke · Body continues from the yoke: Yoke · held body: The panel cannot be computed in this size.   (+ both sleeves)
Back · Underarm cast-on: Back · upper edge: The panel cannot be computed in this size.             (+ Front)
Yoke · Neckband picked up: Yoke · neckline: The panel cannot be computed in this size.
```

One root cause → 9 errors and 6 warnings per size. The split for 4XS is row 58 (19.3 cm), for M row 81 (27 cm):
a 25 cm V works in M and fails in the four smallest sizes, so "it works in my size" and "36 errors" happen together.

Where the limits are:

- `src/engine/contiguous.ts:496` and `src/engine/raglan.ts:230`: `if (R > Y)` → error *"The front neck closes on
  row R, below the underarm split"* (or *"The short rows end on row R…"*). Any error makes `ok: false`, so the yoke
  has no `yoke.*` names and every piece from its held stitches fails (`panel.ts:451`, `contiguousGarment.ts` widths
  `yoke.back_w`/`front_w`/`sleeve_w`), and every join measuring those pieces fails too (`checks.ts` `joinChecks`).
- Modified raglan: the short-row pairs are `(front depth − back_neck_drop) × row gauge / 2`, so the depth is spent in
  short rows: at 15 cm, *"Short rows: 18 pairs 1 sts apart don't fit in a front of 16 sts (the last turn is past
  centre front)"* (`contiguous.ts:313`).
- Seamed and top-down panels already allow a neck below the armhole/underarm join (`panel.ts:606–616`: the front stays
  flat until the neck closes). Only the joined-rounds warning in `checks.ts:36–40` is wrong.
- Tests that assert today's errors: `contiguous.test.ts:253`, `:387`; `contiguousChecks.test.ts:67`, `:75`.

### Proposal: the neck carries on into the front body

**Contiguous and classic raglan (back-neck start), pullover:**

1. The generator works the yoke to the split Y as now, with the neck increases up to Y. When R > Y it no longer errors;
   it reports the rest: `neckContinues = { rows: R − Y, perSide, centre, increaseRows }` (the remaining increase
   rows, renumbered from the body's row 1) and an **info**: *"The front neck continues 17 rows (5.7 cm) into the
   front body: 4 more increases each side, then cast on 13 sts and join in the round."* (illustrative numbers)
2. New `yoke.*` names: `yoke.neck_rows`, `yoke.neck_per_side`, `yoke.neck_centre`. `yoke.front_w` stays the whole
   front width (centre included) so the body panel's width is unchanged.
3. *Add body and sleeves* (and an existing Front body from the yoke) gets a top-down **neckline at its top** derived
   from those names (shape from the yoke, depth `yoke.neck_rows`, width = the opening at the split). The panel
   engine already works a top-down front neckline (increases, then the centre cast-on) and keeps the body flat until
   the neck closes (`panel.ts:606`); the Back follows the same flat rows (it is joined to the Front at the side).
4. The joined-rounds check counts rounds from where the neck closes, so a deep neck doesn't warn
   (top-down panels benefit too).
5. The neckband edge (`joins.ts` yoke neck edge) adds the front body's neck edges, so the pick-up count spans both.
6. Top view and laid-flat view: the split ring labelled *neck continues into the front body (17 rows)*; the front
   body's schematic shows the neck opening at its top.

**Cardigan:** the same, on the Left/Right front pieces: the front-edge increases continue at each centre-front edge
and the front-edge cast-on (closing) happens in the body. Bands and buttons run up the front edge as now (the edge
gains the neck slope). The integrated-band warning is unchanged.

**Modified raglan:** the short rows raise the back by the back depth only (`back_neck_drop`, as for a shallow neck).
The fronts are cast on narrower (the neck width less the shaping still to come), and the rest of the depth is worked
as front-neck increases at the front edges (the back-neck start's code), continuing into the body as above. Pairs
default to the back raise; the field stays editable.

**Checks after the change:**

| Today | After |
|---|---|
| error: neck closes below the split | info: neck continues N rows into the front body |
| error: short rows end below the split (modified raglan) | stays an error only when the *user's own* pair count is too many; the default no longer grows with the depth |
| error ×8 per size: `yoke.*` / `Unknown name yoke.*_w` on body and sleeves | gone (the yoke computes); for real yoke failures, folded under the yoke's error (area 3) |
| warning ×6 per size: joins "panel cannot be computed" | folded under the root error |
| warning: joined panels have different rounds (top-down deep neck) | gone when the difference is the neck's flat rows |
| new warning | the neck still open less than 2 cm above the hem, or the centre cast-on lands inside bust short rows (*"the bust short rows are worked while the front is still open"*: info) |

---

## 3. Errors with context

### Inventory

About 165 issue sources: `panel.ts` 43, `contiguous.ts` 28, `raglan.ts` 23, `bust.ts` 17, `lines.ts` 13,
`buttons.ts` 11, `distribute.ts` 7 (wrapped by `panel.ts`), `checks.ts` 6, `fitChecks.ts` 5, plus `schema`, `sizing`,
`seed`, `rounding`, `yokePanel`, `sleeveChecks`, `contiguousChecks`. They reach the UI through
`ComputedPanel.issues` (`Issue { severity, message, ref }`), the yoke's `YokeIssue { severity, message }` (no ref:
`yokePanel.ts:45` maps them all to `{ kind: 'panel' }`), and `projectChecks` → `groupChecks` → `CheckPanel`, which
already groups one problem across sizes (pattern with the numbers replaced). `IssueList` in the properties links a
message to its `ref` (waypoint, segment, neckline, bust, line, join or panel); it can't point at a field.

Classified (a representative sample; the full list goes in the M2 catalogue):

| Message today | What's wrong | Caused by | What to change (example values) | Problem |
|---|---|---|---|---|
| *The front neck closes on row R, below the underarm split (row Y). Make the neck shallower or the yoke deeper.* | neck deeper than the yoke | yoke neck depth vs yoke depth | becomes info (area 2) | rows not cm; doesn't name fields or the sizes' limits |
| *yoke.\*: the yoke can't be computed in this size (…)* | body/sleeve can't start | the yoke's error | nothing here | internal name; duplicates the root ×4 |
| *underarm width: Unknown name "yoke.back_w"* | same | same | nothing here | internal jargon, pure knock-on |
| *Body continues from the yoke: Yoke · held body: The panel cannot be computed in this size.* | join can't be measured | the yoke's error | nothing here | knock-on, reads like a separate problem |
| *Neck wider than the shoulders at row 168: the left side would have -3 sts. Narrow the neck, widen the top, or move the shoulder shaping.* | neck opening > top width | neckline width vs `neck_side` waypoint width | neckline width ≤ the `neck_side` width (16.4 cm), or widen `neck_side` (→ strap width, area 1) | "the top" is a waypoint name; no values |
| *The stitch count goes negative (-6) at row 169.* | consequence of the above | — | — | knock-on |
| *Short rows: 18 pairs 1 sts apart don't fit in a front of 16 sts…* | too many short rows | neck depth (pairs follow it) | fewer pairs, or a shallower neck (with the limit in cm) | doesn't say pairs come from the depth |
| *The shoulder phase has -2 rows: the back is already as wide as the target. Narrow the back neck or widen the target.* | neck ≥ back width | yoke neck width vs *Back width after the shoulders* | a narrower neck width (with the limit), or the strap setting | "target" = which field? |
| *The armhole has X rows after the shoulder phase…: shorten the shoulders or deepen the yoke.* | shoulders too long | shoulder mode/length, depth extra | *Extra depth* +N cm, or *Shorten* +N cm | fields named loosely |
| *Neckline: 8 decreases per side do not fit in 7 rows.* | neck too shallow for its width | neckline depth, width, centre | a deeper neck or a wider centre (with the limits) | no values in cm |
| *At neck_side the shaping reaches 95 sts, but the target is 92 sts.* | rounding/odd shaping | segment method | segment rows or the waypoint width | ok-ish; no fix |
| *shoulder → neck_side (right edge): 1 steps need 1 RS rows, but only 0 are available.* | segment too short | two waypoint heights | move `neck_side` up 1 row or make the widths equal | tells *where*, not *what to do* |
| *Panels joined in the round have different numbers of rounds below the join (Back 80, Front 63).* | rounds mismatch | heights/neck | — | false alarm for deep necks (area 2) |
| *The raglan splits 22.2 cm higher than the armhole depth…: it may bind. Deepen it.* | shallow raglan | yoke depth | *Extra depth* +1.4 cm | good; lacks the field name |
| *Band ease −3 %: with less than 5 % negative ease the band may slide down.* | — | band ease | band ease between −5 and −20 % | good |
| *Back length, neck to underarm: Unknown name "neck_w"* (Classic raglan + boat) | **a bug**: `raglan.ts:187` doesn't pass `neck_w`/`back_depth` like `contiguous.ts:376` | — | — | 219 checks in every size from one missing name |

Patterns: (1) knock-on errors outnumber root causes about 8 to 1 when a yoke fails; (2) messages give rows and stitches
but the fields are in cm; (3) the remedy names a concept ("the target", "the top", "the shoulders") rather than a
field; (4) no limits ("needs ≤ …"), and no per-size limits even though the failing sizes differ; (5) internal names
(`yoke.*`, `Unknown name`, `neck_side`) reach the user; (6) severities are mostly right, except the cases in area 2.

### Proposal

**Issue model** (engine, backward compatible: `message` stays):

```ts
interface Issue {
  severity: 'error' | 'warning' | 'info';
  message: string;           // what's wrong, in knitting words, cm first (rows/sts in brackets)
  ref: IssueRef;
  code?: string;             // stable id, e.g. 'yoke.neck-below-split', for grouping, tests and docs
  fix?: {
    text: string;            // "Make the neck at most 19.3 cm deep, or deepen the yoke by 1.9 cm."
    fields: FieldRef[];      // what to change: { target: 'yoke' | 'neckline' | 'waypoint' | 'segment' | 'measurement' | 'settings', panelId?, key, label }
    now?: string; need?: string;   // "25 cm", "≤ 19.3 cm" (this size)
    apply?: ProjectPatch;    // optional one-click change (one undo step), only when it is unambiguous
  };
  causedBy?: string;         // the root issue's key: knock-on issues are folded under it
}
```

- `YokeIssue` gains `param` (the key in `YokeResult.params`, e.g. `neckDepth`, `backWidth`) so *Go to field* lands
  on the right `ParamField` in `YokeProps`; panel issues get field-level refs (`waypoint` + `'width' | 'height'`,
  `neckline` + `'width' | 'depth' | 'centre'`).
- **Root causes and folding:** a piece whose `yoke.*`, `armhole_len` or `edge_len` source failed reports one issue
  with `causedBy` = the source's issue key (no `Unknown name …`); joins that can't measure a failed piece do the same.
  `groupChecks` nests them: the row shows the root and *"+ 14 knock-on problems in Back, Front, sleeves, joins"*
  (expandable). The pills count root causes; *Show notes* unchanged.
- **Format** in the Checks list and the properties:

  > **Yoke · Front neck deeper than the yoke** — 4XS, 3XS, 2XS, XS
  > The neck (25 cm) ends 5.7 cm below the underarm split in 4XS (19.3 cm).
  > **Fix:** *Depth below the neck point* ≤ 19.3 cm (4XS) … 24.5 cm (XS), or *Extra depth* +5.7 cm.
  > [Go to field] [Apply: deepen the yoke] · 9 knock-on problems ▸

  (Numbers illustrative except 25 cm and 19.3 cm, measured in 4XS.) The per-size need is shown as a range over the affected sizes, the current size's numbers first.
- **Go to field:** select the piece and size, open the properties, scroll to the field and highlight it (a short
  outline pulse). Works from the Checks list, the panel's issue list and the schematic's issue box.
- **Apply:** only where one change clearly fixes it and changes nothing else in the user's intent (a per-size
  override for the failing sizes by default, or the expression for all sizes when every size fails). Never automatic,
  always one undo step, with a toast *"Set Extra depth to 5.7 cm in 4XS–XS. Undo"*.
- **Severity rules** (written into README): *error* = can't be knitted as written (no chart/pattern); *warning* =
  can be knitted, but probably not what you want (fit, rounding that changes a width, a false-looking shape);
  *info* = how it will be worked, or a choice the app made for you. Knock-ons inherit the root's severity but are
  counted once.
- **Words:** cm before rows/sts; field labels as the properties show them; no internal names (`yoke.*`,
  `neck_side` becomes *the neck point (top of the shoulder)*); every error/warning has a *Fix* part, infos may not.

---

## Milestones

Each milestone is one session and one PR, with tests and a README update. *Done* is checked on the sample table
at 22 × 30, all sizes, plus the browser.

| # | Milestone | Done means | Depends on | Files (main) |
|---|---|---|---|---|
| **M0** | **Classic raglan + boat neck bug** | `raglan.ts` passes `neck_w` and `back_depth` to the back length; Classic raglan boat neck has 0 errors in every size; test | — | `raglan.ts`, test |
| **M1** | **Issue model + knock-on folding** | `Issue.code/fix/causedBy`, `YokeIssue.param`; pieces from a failed yoke, `armhole_len`/`edge_len` users and joins report one folded knock-on; `groupChecks` nests them; the 25 cm contiguous V (before M3) shows **1 error row** (4XS–XS) with *+N knock-on problems*; pills count roots | — | `panel.ts` (issue plumbing), `checks.ts`, `joins.ts`, `contiguous.ts`/`raglan.ts` (`param` only), `yokePanel.ts`, `CheckPanel.tsx`, `Properties.tsx` |
| **M2** | **Messages with Fix + Go to field + Apply** | every error and warning has a `fix` (catalogue in `docs/issues.md` generated from `code`s); *Go to field* reaches the field for yoke params, neckline, waypoints, segments, bust, measurements; *Apply* for the clear cases (yoke extra depth, neck depth, band ease, seam rows, neckline depth); severity review applied | M1 | engine messages; `CheckPanel.tsx`, `Properties.tsx`, `YokeProps.tsx`, `NecklineProps.tsx`, store (apply = one undo step). Can split M2a yoke/raglan, M2b panel/bust/lines, M2c fit/joins/bands |
| **M3** | **Deep neck into the front body: contiguous + classic raglan** (pullover and cardigan) | 25 cm V and scoop on contiguous and Classic raglan: **0 errors** in every size; yoke info *"neck continues N rows…"*; Front (or Left/Right front) shows the remaining increases and the centre cast-on/closing; body flat until the neck closes; no joined-rounds warning; neckband edge spans yoke + body; top/laid-flat views label it; tests replace the four "below the split" tests | — (better after M1) | `contiguous.ts`, `raglan.ts`, `contiguousGarment.ts`, `panel.ts` (scope `yoke.neck_*`), `checks.ts` (rounds), `joins.ts`, yoke views |
| **M4** | **Deep neck on the modified raglan** | short rows default to the back raise only; deeper fronts use a narrower front cast-on + front-neck increases; 15 and 25 cm round necks have 0 errors; old files keep their stored pairs | M3 | `contiguous.ts` (whole-neck start), `YokeProps.tsx` |
| **M5** | **Strap width: seamed + top-down + boat** | Garment → Shoulders: *Strap width* + *gives at Neck/Armhole*; neckline width and `neck_side` read one `neck_w`; front/back in step; readout per piece; boat neck's 3 cm is the strap; 2–5 cm straps in every size with no errors (Fix/Apply where back-neck shaping no longer fits); old projects unchanged until the strap is set | — (Fix texts from M2 if landed) | `templates.ts`, `garmentSetup.ts`, `model.ts`/`schema.ts` (optional field, no version bump), `GarmentSettings.tsx`, `NecklineProps.tsx` |
| **M6** | **Strap width: contiguous + modified raglan** | the yoke solves the neck width (Neck) or back-width target (Armhole) for the strap; contiguous boat neck gets a real 3 cm seam; seam shown in cm and rows; Classic raglan shows *no shoulder seam* note; 2–5 cm straps with no errors | M5 (shared setting) | `contiguous.ts`, `YokeProps.tsx`, `garmentSetup.ts` |

Parallel sessions: **M0** any time. **M1** and **M3** can run in parallel only if M3 doesn't touch issue plumbing
(it changes the R > Y branch and adds `yoke.neck_*`; M1 adds fields to the same issue pushes: expect a small merge).
**M5** is independent of M1–M4 (templates and neckline UI). **M2** after M1; **M4** after M3; **M6** after M5 (and
after M3/M4, which also touch `contiguous.ts`). Suggested order by the user's priorities: M0 → M1 ∥ M5 → M3 → M2 →
M6 → M4.

---

## Risks

- **Saved projects.** Necks below the split were errors, so no working project changes when they start to work.
  The strap setting is optional and absent in old files; linked expressions are written only when the user sets it.
  Modified-raglan short-row defaults change (M4) for new yokes; stored `pairs` overrides stay. Snapshot tests for
  yokes (`__snapshots__`, `yokeRegression.test.ts`) must stay green for the default depths.
- **Front body flat rows.** A deep-neck pullover body is flat above the neck closure; bust short rows, waist shaping
  and side joins already handle flat-then-round on top-down panels, but the Back (joined at the sides) must follow
  the same flat rows. Check bust short rows that start while the front is still open.
- **Neckband length.** The pick-up spans two pieces; `edge_len` / the neckband strip estimate must add both.
- **Apply changes the wrong thing.** Keep *Apply* to single-field, unambiguous fixes; per-size overrides only for the
  failing sizes unless all sizes fail; always one undo step with a toast.
- **Folding hides real problems.** Only fold issues that are *caused by* a source failure (a failed yoke/edge/armhole
  lookup), never independent ones on the same piece; the folded count is always shown and expandable.
- **Armhole-gives strap on the contiguous yoke** breaks the "cross back is always followed" rule by design: an info
  says so, and it is not the default.
- **Export (E2/E3 sessions running now)** reads `issues` for the PDF's checks page: the new fields are additive, but
  the export's text should use `fix.text` once M2 lands.

## Reproducing the findings

Scratch tests (not committed) built garments with `buildGarment` from `fixtureProject()`, changed one value
(`yoke.neck.depth`, `neckline.width`, the `neck_side` waypoint width, `shoulder.backWidth`, `shoulder.mode`) and
counted `projectChecks` by severity, and printed `generateYoke(...).derived.seamCm` / `counts.A`. In the app:
New garment → Contiguous yoke, V, pullover → yoke properties → *Depth below the neck point* = 25 → Checks.
