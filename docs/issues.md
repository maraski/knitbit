# Checks: every issue code

_Generated from `src/engine/issueCatalogue.ts` by `src/engine/issueCatalogue.test.ts` (run it with `UPDATE_ISSUES_DOC=1` after adding a code); the test fails when a code is missing._

Severity: **error** = can't be knitted as written (no chart or pattern); **warning** = can be knitted, but probably not what you want (fit, rounding that changes a width, a false-looking shape); **info** = how it will be worked, or a choice the app made. Knock-ons take their root's severity and are counted once.

Every error and warning has a **Fix** naming the field as the properties show it, this size's value (now) and what it needs, with *Go to field*; *Apply* marks a one-click change (per-size overrides for the failing sizes, or the expression when every size needs the same value; one undo step).

## Panels

| Code | Severity | Message | Cause | Fix |
|---|---|---|---|---|
| `panel.waypoints` | error | A panel needs at least two waypoints (e.g. hem and top). | A panel with fewer than two waypoints. | Add a waypoint. |
| `panel.negative-count` | error | The stitch count goes negative (…) at row …. | More is taken off than there is (usually a neck wider than the panel: then it is folded under that error). | The neck's fix, or widen the waypoints above that row. |
| `waypoint.duplicate-name` | error | Two waypoints are named "…"; names must be unique. | Two waypoints with the same name. | Rename one of them (Go to field: Name). |
| `waypoint.expr` | error | <Waypoint> height / width: <expression error>. | A waypoint expression that cannot be worked out (an unknown name is "“x” isn't a measurement or a name this piece knows"). | Correct the expression (Go to field). |
| `waypoint.order` | warning | Waypoints are not in height order; they are drawn in height order. | A waypoint lower than the one before it in the list. | Change the heights. |
| `waypoint.lowest-not-zero` | info | The lowest waypoint is at … cm; heights are measured from it. | The lowest waypoint is not at 0. | — |
| `waypoint.no-stitches` | error | <Waypoint>: width … cm gives … stitches. | A width of no stitches. | Make the width at least … cm (Go to field). |
| `waypoint.rounding` | warning | <Waypoint>: Cannot make the count even/odd: a multiple of … plus … selvedge is always …. | The rounding parity can't be met with the pattern multiple. | Set Rounding parity to any, or change the multiple or selvedges. |
| `waypoint.shaping-short` | warning | At <waypoint> the shaping reaches … sts (… cm), but the target is … sts (… cm). | The segment's method doesn't make the whole width change. | Change the segment's shaping, or the waypoint's width to what it reaches. |
| `section.expr` | error | Section "…": <expression error> | A pattern section's height can't be worked out. | Correct the section's heights. |

## Segments

| Code | Severity | Message | Cause | Fix |
|---|---|---|---|---|
| `segment.rows` | error or warning | <from> → <to>: Needs … shaping rows but only … RS rows … / Every …th row fits only … of … events … | The shaping doesn't fit the rows between two waypoints (error when it can't be placed at all). | Give the segment at least … rows (… cm): move the upper waypoint, or change the rhythm or sts per edge per row. |
| `segment.any-row` | info | <from> → <to>: Every …th row alternates RS and WS rows; shaping is allowed on any row. | An odd rhythm on flat rows: some shaping falls on WS rows. | — |
| `segment.odd-change` | warning or info | <from> → <to>: odd stitch change (…); the … edge gets one more decrease/increase. | An odd width change shared by two edges (info where a rib multiple fixes the count). | Set Rounding parity to same as the first row, or change the waypoint's width by 1 st. |
| `segment.same-row` | error | <Waypoint> and <waypoint> are on the same row but the width changes. | Two waypoints on one row with different widths. | Move the upper waypoint at least 1 row (… cm) higher, or make the widths equal. |
| `segment.straight-change` | warning | <from> → <to> (… edge): worked straight, but the width changes by … sts. | A straight segment between different widths. | Choose a shaping method, or make the widths equal. |
| `segment.steps-sum` | warning | <from> → <to> (… edge): steps add up to … sts, but … are needed. | Typed steps that don't add up to the width change. | Make Steps (sts) add up to …, or leave them empty. |
| `segment.steps-rows` | error | <from> → <to> (… edge): … steps need … RS rows, but only … are available. | Bind-off / cast-on steps in too few rows. | Give the segment at least … rows, or fewer steps (a larger Max per step). |
| `segment.manual-outside` | warning | A manual marker at segment row … is outside this segment and was ignored. | A hand-placed marker outside its segment. | Move or delete it. |
| `segment.manual-sum` | warning | … edge: manual markers change this edge by … sts; … are needed. | Hand-placed markers that don't make the width change. | Add or remove markers. |
| `segment.princess-expr` | warning | Princess line position: <expression error>. Shaping stays at the side edges. | The princess line distance can't be worked out (the shaping falls back to the edges). | Correct Princess lines: distance from centre. |
| `segment.princess-close` | warning | Princess lines are … sts (… cm) from the centre, too close to the centre / side edges (half width …). | Princess lines too near the centre or the edges. | Make the distance between … and … cm. |
| `segment.princess-steps` | info | <from> → <to>: princess lines only take increases/decreases; these steps stay at the side edges. | Steps or short rows at princess placement. | — |
| `segment.princess-odd` | info | <from> → <to>: the stitch count doesn't divide evenly over the shaping points; row … shapes one side of the marker only. | An odd count at the princess lines. | — |
| `segment.ws-markers` | info | … edge: … markers on WS rows (…), worked as purl-side shaping. | Hand-placed markers on WS rows of RS-row shaping. | — |

## Necklines

| Code | Severity | Message | Cause | Fix |
|---|---|---|---|---|
| `neckline.expr` | error | Neckline <field>: <expression error> | A neckline expression can't be worked out. | Correct the expression (Go to field). |
| `neckline.too-deep` | error | The neckline (… cm) is deeper than the panel (… cm). | A neck depth beyond the panel. | Make Depth (from top) at most … cm. Apply. |
| `neckline.wider-than-top` | error | Neck wider than the panel at row …: the opening is … cm where the panel is … cm, so the … side would have … sts. | The opening is wider than the panel at that height (wider than the neck point, the top of the shoulder, or reaching the armhole shaping). | Make Opening width at most … cm (Apply), or widen the shoulders; with a strap: widen Strap width. |
| `neckline.centre-wide` | warning | The centre (… sts, … cm) is wider than the neck opening (… sts, … cm). | A centre wider than the opening (it is used as the whole opening). | Make Centre width at most … cm. Apply. |
| `neckline.rows` | warning | Neckline: <rows that do not fit> | A V neck's shaping doesn't fit its depth on the chosen rows. | Make Depth (from top) at least … cm (Apply), or shape on any row. |
| `neckline.fit` | error | Neckline: … decreases/increases per side do not fit in … rows (… cm). | The neck is too shallow for its width. | Make Depth (from top) at least … cm (Apply), or a wider Centre width. |
| `neckline.packed` | info | Neckline: decreases/increases were packed closer to fit the neck depth. | A shallow round neck: the shaping is closer than every other row. | — |
| `neckline.shoulder-sts` | info | … + … shoulder sts remain at the top / are cast on at the shoulders. | The shoulder stitches either side of the neck. | — |
| `neckline.below-join` | info | The neck closes on row …, below the underarm join (row …): the body is worked flat until then, in the round from row …. | A top-down neck deeper than the join. | — |
| `body.flat-until-neck` | info | The front neck closes on / is open down to row …: the body is worked flat until then, in the round from row …. | A yoke's front neck continuing into the body. | — |
| `body.neck-near-hem` | warning | The front neck is still open … cm above the lower edge. | A front neck from the yoke that ends near the hem. | Make the yoke's Depth below the neck point shallower, or lengthen the body. |

## Painted stitches

| Code | Severity | Message | Cause | Fix |
|---|---|---|---|---|
| `paint.runs-out` | warning | Painted stitches / shaping lines run out of stitches at the shoulders / before the top. | Decreases from painted stitches or lines never undone. | Add the stitches back with increases, or use a fisheye line. |
| `paint.count-change` | info | Painted stitches change the count by … sts by the last row; … | Painted stitches that change the count. | — |
| `paint.outside` | warning | … painted stitches are outside the fabric on their row and are not drawn. | Painted stitches left outside a changed shape. | Move or erase them in the chart. |

## Values from other pieces

| Code | Severity | Message | Cause | Fix |
|---|---|---|---|---|
| `knock-on.yoke` | error | Waits on <Yoke>: <the yoke's error> | A piece whose widths come from the yoke, which can't be worked out (folded under the yoke's error). | The yoke's fix. |
| `knock-on.armhole` | error | Waits on <piece>: <that piece's error> | A sleeve's armhole_len, measured from a piece that can't be worked out. | That piece's fix. |
| `knock-on.edge` | error | Waits on <piece>: <that piece's error> | A band's edge_len, measured from a piece that can't be worked out. | That piece's fix. |
| `knock-on.join` | error | <join>: <edge> can't be measured until that panel can be computed. | A join measuring a piece that can't be worked out (counted once, with its root). | That piece's fix. |
| `source.yoke` | error | Waits on the yoke: there is no contiguous yoke panel. | Widths that use the yoke, without a yoke. | Add a yoke, or change those widths. |
| `source.armhole` | error | The armhole can't be measured: …. | armhole_len without an armhole to measure. | Check the join the piece is measured from. |
| `source.edge` | error | The joined edge can't be measured: …. | edge_len without a joined edge to measure. | Check the join the piece is measured from. |
| `source.armhole-info` | info | armhole_len = … cm, from …. | Where a sleeve cap takes its armhole length. | — |
| `source.edge-info` | info | edge_len = … cm, edge_rows = …, edge_pickup = … sts, from …. | Where a band takes its edge length. | — |

## Bust shaping

| Code | Severity | Message | Cause | Fix |
|---|---|---|---|---|
| `bust.expr` | error | Bust: Width / Length / Bust point height / Bust point offset / Dart heights: <expression error> | A bust expression can't be worked out. | Correct the expression (Go to field). |
| `bust.apex-outside` | error | Bust: The bust point (… cm up) is outside the panel. | The bust point height is below or above the panel. | Make the bust point height between … and … cm. |
| `bust.apex-edge` | warning | Bust: The bust point (… cm from centre front) is at or beyond the side edge. | A bust point offset (apex_to_apex) as wide as the panel. | Make Distance from centre front at most … cm. |
| `bust.no-difference` | info | Bust: Bust and upper chest differ by … cm; little or no bust shaping is needed. | bust ≤ upper_chest. | — |
| `bust.no-short-rows` | info | Bust: The extra length rounds to no short rows. | A tiny extra length. | — |
| `bust.turns-fit` | error | Bust: … turns per side don't fit between the bust point and the side seam (… sts, … cm). | Too many turns for the room. | Set Pairs to at most …, or a shorter extra length. |
| `bust.no-room` | error | Bust: There is no room for the turns between the bust point and the side edge. | The bust point at the side edge. | Bring the bust point nearer centre front, or a narrower zone. |
| `bust.turns-close` | warning | Bust: Turns are only … st apart: … short-row pairs are a lot for this width. | Many pairs in a narrow zone. | Set Pairs to at most …, or a wider Turn zone width. |
| `bust.turns-cross` | error | Bust: Some short rows work fewer than 4 stitches; the turns cross over. | Turns too near the centre. | Fewer pairs, or turns further from the centre. |
| `bust.asymmetric` | warning | Bust: Left and right turns differ: the bust shaping is asymmetric. | Different hand-set turns on each side. | Type the same turns, or clear them. |
| `bust.above-underarm` | warning | Bust: The short rows start above the underarm, inside the armhole shaping. | A high bust point or many pairs. | Lower the bust point, or fewer pairs. |
| `bust.open-front` | info | Bust: the short rows are worked while the front neck is still open (…). | Bust short rows beside a deep front neck from the yoke. | — |
| `bust.dart-every-row` | info | Bust: Vertical darts (…): not enough RS rows, so the dart shaping is worked on every row. | Dart shaping in few rows. | — |
| `bust.dart-rows` | error or warning | Bust: Vertical darts (…): <rows that do not fit> | The darts' shaping doesn't fit their height. | Give the darts more height, or less extra width. |
| `bust.dart-unbalanced` | warning | Bust: The darts open … and close … times: the extra width does not return to zero. | Different numbers of hand-set increase and decrease rows. | Make them the same number, or clear them. |
| `bust.dart-order` | error | Bust: The dart closes before it opens. | Hand-set decrease rows below the increase rows. | Increase rows below the bust point, decrease rows above. |

## Shaping lines

| Code | Severity | Message | Cause | Fix |
|---|---|---|---|---|
| `line.expr` | error | Line "…": Start / End height / position / Stitches: <expression error> | A line expression can't be worked out. | Correct the expression. |
| `line.flat` | error | Line "…": Both ends are on the same row. | A line with no height. | Move the End at least 1 row above the Start. |
| `line.manual-short` | warning | Line "…": Hand-placed rows leave … sts unshaped. | Too few hand-placed rows. | Add rows, or clear them. |
| `line.manual-outside` | warning | Line "…": Rows … are outside the line and were ignored. | Hand-placed rows outside the line. | Remove them. |
| `line.every-row` | info | Line "…": Not enough RS rows, so the shaping is worked on every row. | A short line with much shaping. | — |
| `line.rows` | error or warning | Line "…": <rows that do not fit> | The line's shaping doesn't fit its height. | Give the line more height, or fewer stitches. |
| `line.odd` | info | Line "…": An odd stitch is worked on one side of the line only. | An odd count on a two-sided line. | — |
| `line.at-edge` | warning | Line "…": An end is … sts (… cm) from the centre, at or beyond the edge (…). | A line end outside the fabric. | Make Distance from centre at most … cm. |
| `line.mirror-overlap` | warning | Line "…": A mirrored line on the centre overlaps its twin. | A mirrored line on the centre line. | Move it off the centre, or untick Mirror. |
| `line.count-change` | info | Line "…": Changes the stitch count by … from row … on; later widths move with it. | A one-way line. | — |

## Contiguous yoke (and the raglan necks)

| Code | Severity | Message | Cause | Fix |
|---|---|---|---|---|
| `yoke.expr` | error | <Yoke field>: <expression error> | A yoke expression can't be worked out. | Correct the expression (Go to field). |
| `yoke.no-back-neck` | error | The neck width (… cm) gives no back neck stitches. | A neck width under one stitch. | Make Neck width, cast on across the back at least … cm. |
| `yoke.short-rows-fit` | error | Short rows: … pairs … sts apart don't fit in a front of … sts (… cm): the last turn is past centre front. | Too many short-row pairs for the front cast-on. | Make Short-row pairs at most … (Apply), or a smaller Sts between turns. |
| `yoke.short-rows-centre` | info | Short rows: the last turns reach into the centre part (… sts each side of centre front). | Many pairs on a round neck. | — |
| `yoke.short-rows-close` | info | Short rows: turns 1 st apart. … | Turns 1 st apart. | — |
| `yoke.short-rows-below-split` | error | The short rows end on row …, … rows (… cm) below the underarm split (row …). | Whole-neck short rows deeper than the yoke. | Make Short-row pairs at most … (Apply), or add … cm to Extra depth. |
| `yoke.back-neck-rate` | info | Back neck: … increases per row (the method suggests 2 to 4). | Back neck increases outside the method's range. | — |
| `yoke.cap-top-odd` | warning | Cap top … sts − seam … sts is odd; the markers move … st each side (cap top … sts). | An odd difference between the cap top and the seam. | Make Cap top stitches … or … (Apply: the count worked). |
| `yoke.shoulder-phase` | error | The shoulder phase has … rows: the back neck (… cm) is already as wide as Back width after the markers move (… cm). / the shoulder seam is too short to work. | A neck as wide as the back target (or a seam length under a row). | Make Back width after the markers move at least … cm, narrow the Neck width, or Extra rows at least … (Apply). |
| `yoke.strap-too-wide` | error | A … strap (… rows) leaves no neck: its increases alone make the back … wide, more than Back width after the markers move (… cm). | Strap width (gives at the neck) wider than the back target allows. | Make the strap narrower (about … at most), widen Back width after the markers move, or let the strap give at the armhole. |
| `yoke.strap-narrow-neck` | warning | The … strap leaves a … back neck, much narrower than back_neck_width (…): check that the neck goes over the head. | A wide strap that gives at the neck. | Make the strap narrower, or set Strap gives at to Armhole to keep the neck. |
| `yoke.strap-armhole` | info | The strap gives at the armhole: the neck stays and the back is … after the markers move, so the cross back (…) is no longer followed. | Strap gives at: Armhole (by design). | — |
| `yoke.back-neck-past-shoulders` | info | Back neck increases (rows 1–…) run past the shoulder phase (… rows). | More back neck rows than shoulder rows. | — |
| `yoke.front-neck-every-row` | info | Front neck: … increases each side don't fit on RS rows in … rows (… cm), so some are on WS rows too (at most every row). For RS rows only, make Depth below the neck point at least … cm or the neck narrower. | A V neck wide for its depth. | — |
| `yoke.front-neck-rows` | error | Front neck: <rows that do not fit> | A V neck's increases don't fit the neck depth even on every row. | Make Depth below the neck point at least … cm (Apply), or the Neck width narrower. |
| `yoke.front-neck-fit` | error | Front neck: … increases per side do not fit in … rows (… cm). | A round neck too shallow for its width. | Make Depth below the neck point at least … cm (Apply), or a wider Centre. |
| `yoke.neck-continues` | info | The front neck continues … rows (… cm) into the front body: …. | A front neck deeper than the yoke: the front body works the rest. | — |
| `yoke.short-rows-capped` | info | Short rows: the default … pairs don't fit in a front of … sts (… cm), so … pairs, turns 1 st apart; the rest of the front neck is worked below them. | A modified raglan front too narrow for the default short rows (e.g. a square cardigan in the small sizes). | — |
| `yoke.neck-below-short-rows` | info | Front neck … cm: the back neck is … cm below the neck point and the short rows raise the back … cm (… pairs); the other … cm (rows …–…): cast on … sts each front, … increases each side, then cast on … sts at centre front and join in the round. | A modified raglan front neck deeper than its short rows: the fronts are cast on narrower and the rest is front-neck increases. | — |
| `yoke.integrated-bands` | warning | Integrated front bands are not worked into a contiguous yoke yet; the yoke has none. | Integrated bands on a contiguous cardigan. | Pick up or sew on the front bands instead. |
| `yoke.body-too-wide` | error | The yoke body (… sts, … cm) is already … wider than Body at the underarm (… cm): the underarm cast-on would be … sts. | Long shoulders and no body increases. | Make Body at the underarm at least … cm, or shorten the shoulders. |
| `yoke.body-wider` | warning | With … sts cast on at each underarm the body is … wider than Body at the underarm (… cm). | An underarm cast-on bigger than the body needs. | Make Underarm cast-on, each at most … cm (Apply), or a wider body. |
| `yoke.underarm-raised` | info | Body increases fill the lower … armhole rows; the underarm cast-on is raised from … to … sts. | The body increases alone don't reach the body width. | — |
| `yoke.body-increase-rows` | warning | Body increases: <rows that do not fit> | The body increases don't fit their zone. | A larger Body increases over, or more Extra depth. |
| `yoke.deepened` | info | Yoke deepened by … rows (… cm) so the sleeve reaches its width with at most … % of the armhole rows rapid. | Deepen until the cap is not mostly rapid. | — |
| `yoke.armhole-short` | error | The armhole has … rows (… cm) after the shoulder phase (… of the yoke's … rows). | Shoulders as long as the yoke. | Add … cm to Extra depth (Apply), or shorten the shoulders. |
| `yoke.sleeve-short` | warning | The sleeve reaches … sts (… cm) at the underarm, … short of Sleeve at the underarm. | The cap can't increase enough in the armhole rows. | Add Extra depth or a larger Underarm cast-on (at least … cm); without solving, longer Rapid rows. |
| `yoke.rapid-lengthened` | info | Rapid cap rows lengthened from … to … so the sleeve reaches its width. | Solving the rapid phase. | — |
| `yoke.cap-flat` | info | Hint: the cap may look flat: … of the … armhole rows are rapid. A deeper yoke gives a rounder cap. | Mostly rapid cap rows. | — |
| `yoke.zone-negative` | error | Row …: the <zone> has … sts. | The markers moved past a zone's stitches. | Fewer Cap top stitches, or a wider Neck width. |
| `yoke.markers-move` | error | The markers can't move … sts: the fronts have … sts at the end of the shoulders. | A cap top wider than the fronts allow. | Make Cap top stitches at most … (Apply), or longer shoulders. |
| `yoke.empty-row` | error | A row has no stitches. | An empty cast-on. | Check the cast-on fields. |
| `yoke.held-empty` | error | Nothing to hold at the split: sleeves … / body … / sleeves … sts. | A zone with no stitches at the split. | Check the sleeve, body and underarm widths. |
| `yoke.band-below-split` | error | The band, increase round (and short rows) end on row …, … rows (… cm) below the underarm split (row …). | An off-shoulder band deeper than the raglan. | Add … cm to Extra depth (Apply), fewer short-row pairs, or a shallower band. |
| `yoke.fit-cross-back` | info | End of the shoulders (row …): the back is … cm, … wider/narrower than the cross back (… cm). | How the back compares with the cross back. | — |
| `yoke.fit-cross-front` | info | End of the shoulders: the fronts (with the neck between them) are … cm, … than the cross front (… cm). | How the fronts compare with the cross front. | — |
| `yoke.fit-sleeve-tight` | warning | The sleeve at the underarm is … cm (… + … sts), … less than bicep + ease (… cm): it may be tight. | A sleeve narrower than bicep + ease. | Make Sleeve at the underarm at least … cm, or a larger underarm cast-on. |
| `yoke.fit-sleeve-wide` | info | The sleeve at the underarm is … cm, … more than bicep + ease (… cm). | A roomy sleeve. | — |
| `yoke.fit-armhole-short` | warning | Around the armhole (…) is … cm, … less than the scye circumference (… cm): the sleeve may be tight at the underarm. | A shallow yoke for the scye. | Add … cm to Extra depth (Apply), or a larger underarm cast-on. |
| `yoke.fit-armhole-deep` | info | Around the armhole is … cm, … more than the scye circumference (… cm): a deep armhole. | A deep yoke. | — |
| `yoke.cap-pointy` | info | Hint: the cap may look pointy: the shoulder seam is … rows but the rapid cap only …. … | A long seam with few rapid rows. | — |
| `yoke.body-start` | warning | The body starts with … sts (…), but the yoke holds … + 2 × … cast on = …. | The body pieces' top widths no longer follow the yoke. | Make their underarm widths follow the yoke again, or re-add them. |
| `yoke.sleeve-start` | warning | <Sleeve> starts with … sts, but the yoke holds … + … cast on = …. | A sleeve's top width no longer follows the yoke. | Make its underarm width follow the yoke again. |

## Raglan

| Code | Severity | Message | Cause | Fix |
|---|---|---|---|---|
| `raglan.off-shoulder-cardigan` | error | An off-shoulder neckline is pullover only for now. | Off-shoulder on a cardigan. | Choose a pullover front or another neckline. |
| `raglan.no-sleeve-top` | error | The sleeve tops have no stitches. | A sleeve top and raglan lines of no stitches. | Make Sleeve top at the cast-on at least … cm, or more line stitches. |
| `raglan.too-shallow` | error | The raglan is … rows (… cm) deep. | A back length under 2 rows. | Add … cm to Extra depth (Apply), or a longer back length. |
| `raglan.underarm-raised` | info | Even increasing every row, the raglan doesn't reach the body and sleeve widths in … rows: the underarm cast-on is raised from … to … sts. … | A shallow raglan for the widths. | — |
| `raglan.body-wider` | warning | With … sts cast on at each underarm the body is … wider than Body at the underarm without any raglan increases. | A wide neck or ring for the body. | Make Underarm cast-on, each at most … cm (Apply), or a narrower neck / less ring ease. |
| `raglan.sleeve-wider` | warning | With … sts cast on at each underarm the sleeve is … wider than Sleeve at the underarm without any raglan increases. | A wide sleeve top for the sleeve. | Make Underarm cast-on, each at most … cm (Apply), or a narrower sleeve top / arm arc. |
| `raglan.body-every-row` | info | Body: every other row isn't enough, so … of its … increase rows are the rows between … | Fast body increases. | — |
| `raglan.sleeve-every-row` | info | Sleeves: every other row isn't enough, so … of their … increase rows are the rows between. | Fast sleeve increases. | — |
| `raglan.band-room` | error | Only … cm between the band and the underarm at the front: the raglan has no room to grow (it needs 4 cm). | An off-shoulder band too near the underarm. | Add … cm to Extra depth (Apply), a shallower band, or a smaller off_shoulder_drop. |
| `raglan.missing-measurement` | error | Off-shoulder needs the off_shoulder_circ / off_shoulder_drop measurement (…). | A sizing table without the off-shoulder measurements. | Add the measurement (Measurements). |
| `raglan.no-band` | info | No band (the Neckband is off): the ring is cast on as the top edge, … | Off-shoulder with the neckband off. | — |
| `raglan.band-ease-loose` | warning | Band ease … %: with less than 5 % negative ease the band may slide down. | Band ease above −5 %. | Make Band ease −0.05 (−5 %) or less. Apply. |
| `raglan.band-ease-tight` | warning | Band ease … %: more than 20 % negative ease may be too tight to pull over the arms. | Band ease below −20 %. | Make Band ease −0.2 (−20 %) or more. Apply. |
| `raglan.ring-full` | error | The ring (… sts) has no room for the body after two sleeve zones of … sts. | A wide arm arc for the ring. | Make Arm arc at most … cm (Apply), or more ring ease. |
| `raglan.band-wider-than-ring` | error | The band (… sts) is wider than the ring (… sts). | Band ease above ring ease. | Make Band ease less than Ring ease. |
| `raglan.body-off` | warning | The body at the underarm is … cm (…), … more/less than its target (… cm). | The raglan increases (4 a row) can't meet the body width. | A smaller / larger underarm cast-on, or a narrower neck / deeper raglan. |
| `raglan.shallow-split` | warning | The raglan splits … cm higher than the armhole depth (… cm below the shoulder): it may bind at the underarm. | A raglan shallower than the armhole depth. | Add … cm to Extra depth. Apply. |
| `raglan.estimate` | info | off_shoulder_circ is still an estimate: measure it (…). | An estimated off-shoulder circumference. | — |

## Joins

| Code | Severity | Message | Cause | Fix |
|---|---|---|---|---|
| `joins.rounds-differ` | error | Panels joined in the round have different numbers of rounds below the join (…). | Pieces knitted together in the round that reach the join at different rounds. | Make the join waypoint the same height on each piece, or work them flat. |
| `joins.shaping-rounds` | info | Joined panels shape their side seams on different rounds (…). | Different side shaping in joined pieces. | — |
| `join.measure` | warning | <join>: <edge>: <why it can't be measured> | A join's edge that can't be measured. | Check the join's edges. |
| `join.one-side` | info | <join>: seam has only one side; add the edge it is sewn to. | A seam with one side. | — |
| `join.seam-differ` | warning | <join>: the sides differ by … cm (… rows), more than the … cm tolerance. | Seam sides of different lengths. | Make the sides the same length, or a larger Seam tolerance. |
| `join.same-edge` | info | The same edge is in "…" (…) and "…" (…). | One edge in two joins. | — |

## Fit checks

| Code | Severity | Message | Cause | Fix |
|---|---|---|---|---|
| `fit.region-gap` | warning | Lower body … is … sizes from upper body … (limit …): check the shaping between the waist and the underarm. | Region sizing far apart. | Closer sizes, or a larger gap limit. |
| `fit.region-shaping` | error | More shaping than the rows allow between … and …, where … meets …: …. (…) | Region sizing with a segment that cannot fit its shaping (replaces that segment error). | Bring the sizes closer, or the segment's fix. |
| `fit.hem-narrow` | warning | The hem (… cm around) is … cm narrower than the bust plus ease (… cm): it may not pull over the bust. | A narrow hem (hem check on). | Widen the hem by … cm each, or turn off the hem check. |
| `fit.armhole-short` | warning | The armhole (Front + Back, … cm) is shorter than the scye circumference (… cm): … | Shallow set-in armholes. | Deepen the armholes by about … cm. |
| `fit.neckband-short` | warning | The neckband (… cm) is shorter than the neck base (… cm): it won't sit around the neck. | A short neckband. | Make its width at least … cm. Apply. |

## Short sleeves

| Code | Severity | Message | Cause | Fix |
|---|---|---|---|---|
| `sleeve.cuff-long` | warning | The cuff band (… cm) is as long as the … sleeve (… cm). | A cuff band as long as a short sleeve. | A shallower cuff band (Garment → Edges → Cuffs), or a longer sleeve. |
| `sleeve.cuff-half` | info | The cuff band (… cm) is more than half of the … sleeve (… cm); … | A deep cuff on a short sleeve. | — |
| `sleeve.fast-shaping` | info | The … sleeve changes by … sts each side in … rows, more often than every other row: … | Fast sleeve shaping. | — |
| `sleeve.shaping-in-rib` | info | … of the … shaping rows each side fall in the cuff rib (…). | Shaping in the cuff rib. | — |

## Bands and buttons

| Code | Severity | Message | Cause | Fix |
|---|---|---|---|---|
| `bands.stale-strip` | info | <strip> no longer matches the edge settings (Project → Edges); delete it if you don't need it. | A band strip left from older settings. | — |
| `bands.short` | warning | <strip> is … cm long, … cm shorter than its edge (… cm): it may pull the front up. | Too few stitches picked up. | Pick up more (a larger ratio on the join). |
| `bands.long` | warning | <strip> is … cm long, … cm longer than its edge (… cm): it may ripple. | Too many stitches picked up. | Pick up fewer (a smaller ratio on the join). |
| `bands.pickup-multiple` | info | Picking up … sts doesn't fit … (…); the band rounds to …: pick up … more/fewer. | A pick-up that doesn't fit the band pattern. | — |
| `bands.double-neck` | warning | A continuous front band goes around the neck, and a neckband is switched on too. | Two neck edges. | Switch off the Neckband, or separate front bands. |
| `bands.closed-narrow` | warning | Closed at …, the fronts measure … cm (…), … cm short of the front's … cm. | Narrow bands or a large overlap. | Wider bands, or a smaller overlap. |
| `buttons.expr` | error | <button setting>: <expression error> | A button placement expression can't be worked out. | Correct the button placement. |
| `buttons.outside` | error | Button … is at … cm, outside the front edge (0–… cm). | A button beyond the front edge. | Keep the buttons between 0 and … cm. |
| `buttons.hole-wide` | warning | Buttonholes (… sts) leave fewer than 1 (band) stitch each side in a …-st band. | A buttonhole as wide as the band. | A narrower buttonhole, or a wider band. |
| `buttons.no-strip` | warning | No front band / buttonhole band strip to put the buttonholes on. | Picked-up or sewn-on bands without strips. | Add band strips (Garment → Edges). |
| `buttons.band-narrow` | warning | The band is … rows (… cm) deep: the buttonholes (row …) are within 2 rows of its edge. | A narrow picked-up band. | Make the band at least … cm (5 rows). |
| `buttons.close` | warning | Buttonholes are … sts / rows apart (on the band): too close together. | Many buttons close together. | Fewer buttons, or spread them. |
