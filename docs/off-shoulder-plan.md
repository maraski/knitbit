# Plan: off-shoulder garments

Goal: design an off-shoulder top (the opening sits below the shoulders and around the upper arms) in Knitbit, with
the band, the yoke, the body and the sleeves all worked out per size.

**Status: planned (2026-10-23), nothing built yet.**

## Your answers (2026-10-23)

| Question | Answer |
|---|---|
| Route for the first version | **Raglan:** an "Off-shoulder" neckline on the top-down raglan yoke. |
| Where it appears | Neckline list on the **Raglan, top-down** card, under both Classic and Modified. Off-shoulder always uses the raglan-line yoke with a cast-on all round the ring. **Modified** only adds short rows that raise the back. |
| Band | **Rib, knit first** at the cast-on with negative ease (default −10% of the off-shoulder circumference), then an increase round up to the yoke's count. Folded elastic casing is a later option. |
| Back raise | **Level band** by default. German short rows to raise the back are optional (Modified switches them on). |
| Band height below the shoulder | `off_shoulder_drop` = **5 cm**, editable per size. |
| Split between body and arms at the cast-on | **Arm arc = `bicep × 0.5`** per sleeve (the outer half of the upper arm), editable. The rest of the ring is split evenly between front and back. |
| Sleeves | **All lengths, cap → long** (the raglan's sleeve lengths). |
| Fronts | Pullover only in v1. You didn't pick the cardigan option, so it's listed under Later. |
| Tube top + separate straps | **Skip.** The rectangle pieces, rectangle size rules and joins already cover it well enough. |

## Why this route

- An off-shoulder top worked top-down is a **raglan whose neck ring is big and low**. There's no front-neck shaping,
  and no shoulders to shape because they aren't covered. Everything after the cast-on is what
  [raglan.ts](../src/engine/raglan.ts) already does:
  - It solves the body and sleeve rates (every other row, then the rows between, then a raised underarm cast-on).
  - It holds the stitches at the split.
  - [contiguousGarment.ts](../src/engine/contiguousGarment.ts) makes the body and sleeves (every length) from the held stitches.
- The raglan already has a cast-on all round the ring (`start: 'neck'`), and German short rows can raise the back, so
  the optional back raise comes for free.
- **Modified raglan** runs the contiguous generator (shoulder increases first, then the sleeve cap), so it can't make
  an off-shoulder yoke. Off-shoulder therefore always makes a raglan-style yoke. On the Modified card it just switches
  the back raise on. That keeps one generator and one set of tests.
- The neckline is the right place for it because off-shoulder changes where the yoke starts. It doesn't change how
  the rest of the garment is built. A separate method would duplicate the raglan card.

```
 band: off_shoulder_circ × (1 − 10%) sts, rib, knit first     ─┐ off_shoulder_drop (5 cm)
 increase round to the yoke's start count                       │ below the shoulder point
 ┌── front ──┬─ arm arc ─┬── back ──┬─ arm arc ─┐ ring          ─┘
 │           │ bicep×0.5 │          │ bicep×0.5 │
 └─╲─────────┴─────────╱─┴╲─────────┴─────────╱─┘
    four raglan lines, body / sleeve rates solved as now
    depth (band top → underarm) = armhole_depth − off_shoulder_drop  (+ back raise at the back)
 ── split: body and sleeves continue from the held stitches + underarm cast-on
```

## Measurements and defaults

| Name | New? | Default | Notes |
|---|---|---|---|
| `off_shoulder_circ` | **new**, estimate | `round(upper_chest + bicep * 0.6, 0.5)` (≈ 103 cm for upper chest 86, bicep 28) | Measured arms down, around both upper arms and the torso at band height. Marked as an estimate like the other seeded ones ([estimates.ts](../src/engine/estimates.ts)), region upper body. |
| `off_shoulder_drop` | **new**, estimate | `5` | Shoulder point down to the band's top edge. Fixed default, editable per size (like the boat neck's depths). |
| `bicep`, `armhole_depth`, `upper_chest`, `underarm_co` | existing | — | Sleeve and body targets and the depth, as the raglan already uses. |

Yoke settings (all expressions with per-size overrides, stored in a new `YokeSpec.offShoulder`):

| Setting | Default | Meaning |
|---|---|---|
| `bandEase` | `-0.10` | Band circumference = `off_shoulder_circ × (1 + bandEase)`. |
| `ringEase` | `0` | Ring after the increase round = `off_shoulder_circ × (1 + ringEase)`: the yoke's start count. |
| `armArc` | `bicep * 0.5` | Each sleeve zone at the cast-on (cm, raglan line stitches added). |
| `backRaise` | `0` (Classic) / `2` (Modified) | cm the back sits above the front, worked as German short rows after the band. |

The band's own stitch and depth come from the project's **Neckband** edge setting, defaults 1×1 rib and 4 cm. See the
next section.

Derived values (shown with formulas in the yoke's parameter table, like the other yoke params):
- body zones at the ring = `off_shoulder_circ × (1 + ringEase) − 2 × armArc`, split half front and half back.
- depth (back length) = `armhole_depth − off_shoulder_drop + backRaise`. The band rows and the increase round count
  inside this depth.
- the body target (`upper_chest + ease`), sleeve target (`bicep + ease.bicep`) and underarm cast-on are unchanged.

## The band

- It's the **Neckband** edge treatment, worked **with the panel**. That option currently says "not available for
  necklines yet"; off-shoulder is the first neckline to get it. The band is a pattern section at the top of the yoke
  (top-down, so these are its first rows) with its own stitch count. It isn't a separate strip, and no join is needed.
- Choosing Off-shoulder sets the neckband to with-panel, 1×1 rib and 4 cm. You can change all three. Switching back to
  another neckline goes back to the neckband defaults (a strip, picked up later).
- The increase round (band count → ring count) is spread evenly ([distribute.ts](../src/engine/distribute.ts)) and
  shown in the chart and the phase table as its own row.
- Later (M3): a **folded casing** for elastic. The band is worked twice as deep in stockinette, with a purl turning
  round, then folded and sewn or knit together. Knitbit would suggest an elastic length, `off_shoulder_circ × 0.85`.
  An **i-cord** edge might come with it.

## Model and UI changes

- **Model** ([model.ts](../src/engine/model.ts)):
  - `NecklineShape` gets `'off-shoulder'`.
  - `YokeSpec.offShoulder?: { bandEase, ringEase, armArc, backRaise }`, all `DimExpr`.
  - Optional fields, so no schema bump. Old files are unchanged.
- **Engine:**
  - `defaultRaglan('off-shoulder', ...)` sets `start: 'neck'`, the off-shoulder settings and the depth expression.
  - `generateRaglan` handles off-shoulder itself instead of running the neck generator:
    - the cast-on zones come from the ring,
    - the band rows and the increase round are plain rows (no raglan increases),
    - then the optional back-raise short rows (reuse `shortRowSpan`),
    - then the existing rate solver and simulation.
  - `FRONT_NECKS` / `backNeckFor` need an entry or a narrower type. Bodice templates never offer off-shoulder.
  - `necklinesFor` returns `'off-shoulder'` only for `raglan` / `modified-raglan`.
  - `yokeWithNeck` switches between off-shoulder and the other shapes, keeping changed settings as it does now.
  - Off-shoulder on the Modified card builds a raglan-style yoke with `backRaise = 2`. `garmentChoice` reads an
    off-shoulder yoke with `backRaise > 0` as Modified, otherwise as Classic, so the dialog round-trips. Nothing new
    is stored.
- **New garment dialog / Garment tab:**
  - "Off-shoulder" appears in the neckline select under the Raglan card only.
  - Choosing it pre-sets the neckband edge as described above.
  - The cardigan front is disabled while off-shoulder is selected (v1).
- **Yoke properties:** an "Off-shoulder" section with band ease, ring ease, arm arc, back raise and the drop
  (a link to the measurement), each showing its formula and value per size like the other yoke settings.
- **Schematic:** the yoke shows the band and the ring circumference, plus the drop below the shoulder point. Body and
  sleeves are unchanged.
- **Chart:** the band rows in rib, the increase round, the back-raise short rows, then the raglan rows.
- **Top view** ([yokeTop.ts](../src/engine/yokeTop.ts)): the ring drawn at the band line, with the four zones at the cast-on.
- **Checks** (in the yoke issues and [contiguousChecks.ts](../src/engine/contiguousChecks.ts)):
  - warning when band ease is above −5% (it may slide down) or below −20% (too tight to pull over the arms),
  - error when `off_shoulder_drop` leaves less than about 4 cm between the band and the underarm,
  - error when the body zones at the ring come out at or below 0 (arm arc too big),
  - info when `off_shoulder_circ` is still an estimate (it matters more here than most estimates),
  - plus the raglan's existing "raised underarm cast-on" and rate messages, which already cover a shallow yoke.
- **Joins:** none new. The body and sleeves continue from the held stitches as now.

## Milestones

Each one is a separate session, in order: M2 needs M1's model and generator, and M3 needs M1's band.

### M1: engine
Model fields, `'off-shoulder'` neckline, `defaultRaglan` / `generateRaglan` off-shoulder branch (ring zones, band rows,
increase round, optional back-raise short rows), the two new measurements as estimates, `necklinesFor` /
`yokeWithNeck` / `garmentChoice`, and the checks.
**Done when:**
- Tests cover the band count at −10%, the ring zones (arms = bicep × 0.5, body split evenly), depth =
  `armhole_depth − 5`, the back raise adding rows only at the back, and the solver hitting the body and sleeve
  targets for every size in the sample table (or saying why).
- Old raglan, modified-raglan and contiguous projects compute exactly as before.
- `npm test`, the typecheck and `npm run build` pass.
- Main chunk growth is noted (see the main-chunk budget).

### M2: UI
New garment dialog and Garment tab neckline (raglan only), the neckband pre-set to with-panel, the Yoke properties
section, and the schematic, chart and top view, with the checks showing in the panel.
**Done when:**
- In the browser: make an off-shoulder Classic raglan and a Modified one (back raise) from the dialog in every size.
- Switch to round and back.
- The chart shows the rib band, the increase round and the raglan rows.
- The top view shows the ring.
- Changing the drop or band ease updates everything.
- The README describes it.

### M3: band options
Folded elastic casing as a neckband stitch/method for off-shoulder (double depth, turning round, elastic length
shown), and possibly an i-cord edge.
**Done when:**
- Picking casing doubles the band rows in the chart and schematic.
- The elastic length shows per size.
- Tests cover the casing rows and the elastic length.

### Later (not planned)
- Off-shoulder cardigan (flat, band running into the front bands).
- A sweetheart or dipped front at the band (the front raised less than the back, or V-shaped).
- Gathered or puff sleeve tops.
- A circular yoke started at the off-shoulder line.
- Bottom-up with a bardot band picked up last.
- Tube top + separate straps stays a do-it-yourself job with rectangles and joins.

## Open risks

- **`off_shoulder_circ` estimate.** Bodies vary a lot here (arm and shoulder build), and nothing in the sizing table
  predicts it well. The fit depends on it, so the app should push you to measure it (the info check). The drop may
  need to be measured too.
- **Arm arc as `bicep × 0.5`.** At band height the arm is usually thicker than the bicep is (deltoid). If samples come
  out with tight sleeve tops, change the default to `bicep * 0.55` or base it on the ring.
- **Pattern sections in the yoke chart.** The yoke chart is generated by the yoke generator, not by the pattern-section
  code that bodice panels use. M1 or M2 may need a small "band rows" path in [yokeChart.ts](../src/engine/yokeChart.ts)
  rather than reusing pattern sections. Check this first in M1.
- **Very shallow yokes.** In small sizes with a large drop, the depth leaves few increase rows. The solver then raises
  the underarm cast-on, which is correct but can look odd. The check is there to make it visible, not to prevent it.
- **Classic/Modified read back from `backRaise`.** If you set the back raise to 0 on a Modified off-shoulder, it reads
  back as Classic. That's acceptable (they're the same garment), but say so in the UI.
- **`NecklineShape` is shared with the bodice templates.** Adding a member touches every `Record<NecklineShape, …>`.
  The typecheck finds them all. The bodices must never offer it.
