// Every issue code the engine reports: its severity, what the message says, the cause and the fix it offers. The
// source of docs/issues.md (issueCatalogue.test.ts writes it and fails when a code is missing here or the doc is stale).
//
// Severity rules: error = can't be knitted as written (no chart or pattern); warning = can be knitted, but probably
// not what you want (fit, rounding that changes a width, a false-looking shape); info = how it will be worked, or a
// choice the app made. Knock-ons take their root's severity and are counted once.

export type Severity = 'error' | 'warning' | 'info';

export interface CatalogueEntry {
  severity: Severity | `${Severity} or ${Severity}`;
  /** The message, with its numbers as … */
  message: string;
  cause: string;
  /** What the fix says (errors and warnings); "Apply" marks a one-click change. */
  fix?: string;
}

export const ISSUE_CATALOGUE: Record<string, CatalogueEntry> = {
  // ---------- panels: waypoints ----------
  'panel.waypoints': { severity: 'error', message: 'A panel needs at least two waypoints (e.g. hem and top).', cause: 'A panel with fewer than two waypoints.', fix: 'Add a waypoint.' },
  'panel.negative-count': { severity: 'error', message: 'The stitch count goes negative (…) at row ….', cause: 'More is taken off than there is (usually a neck wider than the panel: then it is folded under that error).', fix: "The neck's fix, or widen the waypoints above that row." },
  'waypoint.duplicate-name': { severity: 'error', message: 'Two waypoints are named "…"; names must be unique.', cause: 'Two waypoints with the same name.', fix: 'Rename one of them (Go to field: Name).' },
  'waypoint.expr': { severity: 'error', message: '<Waypoint> height / width: <expression error>.', cause: 'A waypoint expression that cannot be worked out (an unknown name is "“x” isn\'t a measurement or a name this piece knows").', fix: 'Correct the expression (Go to field).' },
  'waypoint.order': { severity: 'warning', message: 'Waypoints are not in height order; they are drawn in height order.', cause: 'A waypoint lower than the one before it in the list.', fix: 'Change the heights.' },
  'waypoint.lowest-not-zero': { severity: 'info', message: 'The lowest waypoint is at … cm; heights are measured from it.', cause: 'The lowest waypoint is not at 0.' },
  'waypoint.no-stitches': { severity: 'error', message: '<Waypoint>: width … cm gives … stitches.', cause: 'A width of no stitches.', fix: 'Make the width at least … cm (Go to field).' },
  'waypoint.rounding': { severity: 'warning', message: "<Waypoint>: Cannot make the count even/odd: a multiple of … plus … selvedge is always ….", cause: "The rounding parity can't be met with the pattern multiple.", fix: 'Set Rounding parity to any, or change the multiple or selvedges.' },
  'waypoint.shaping-short': { severity: 'warning', message: 'At <waypoint> the shaping reaches … sts (… cm), but the target is … sts (… cm).', cause: "The segment's method doesn't make the whole width change.", fix: "Change the segment's shaping, or the waypoint's width to what it reaches." },
  'section.expr': { severity: 'error', message: 'Section "…": <expression error>', cause: "A pattern section's height can't be worked out.", fix: "Correct the section's heights." },

  // ---------- panels: segments ----------
  'segment.rows': { severity: 'error or warning', message: '<from> → <to>: Needs … shaping rows but only … RS rows … / Every …th row fits only … of … events …', cause: "The shaping doesn't fit the rows between two waypoints (error when it can't be placed at all).", fix: 'Give the segment at least … rows (… cm): move the upper waypoint, or change the rhythm or sts per edge per row.' },
  'segment.any-row': { severity: 'info', message: '<from> → <to>: Every …th row alternates RS and WS rows; shaping is allowed on any row.', cause: 'An odd rhythm on flat rows: some shaping falls on WS rows.' },
  'segment.odd-change': { severity: 'warning or info', message: '<from> → <to>: odd stitch change (…); the … edge gets one more decrease/increase.', cause: 'An odd width change shared by two edges (info where a rib multiple fixes the count).', fix: "Set Rounding parity to same as the first row, or change the waypoint's width by 1 st." },
  'segment.same-row': { severity: 'error', message: '<Waypoint> and <waypoint> are on the same row but the width changes.', cause: 'Two waypoints on one row with different widths.', fix: 'Move the upper waypoint at least 1 row (… cm) higher, or make the widths equal.' },
  'segment.straight-change': { severity: 'warning', message: '<from> → <to> (… edge): worked straight, but the width changes by … sts.', cause: "A straight segment between different widths.", fix: 'Choose a shaping method, or make the widths equal.' },
  'segment.steps-sum': { severity: 'warning', message: '<from> → <to> (… edge): steps add up to … sts, but … are needed.', cause: "Typed steps that don't add up to the width change.", fix: 'Make Steps (sts) add up to …, or leave them empty.' },
  'segment.steps-rows': { severity: 'error', message: '<from> → <to> (… edge): … steps need … RS rows, but only … are available.', cause: 'Bind-off / cast-on steps in too few rows.', fix: 'Give the segment at least … rows, or fewer steps (a larger Max per step).' },
  'segment.manual-outside': { severity: 'warning', message: 'A manual marker at segment row … is outside this segment and was ignored.', cause: 'A hand-placed marker outside its segment.', fix: 'Move or delete it.' },
  'segment.manual-sum': { severity: 'warning', message: '… edge: manual markers change this edge by … sts; … are needed.', cause: "Hand-placed markers that don't make the width change.", fix: 'Add or remove markers.' },
  'segment.princess-expr': { severity: 'warning', message: 'Princess line position: <expression error>. Shaping stays at the side edges.', cause: "The princess line distance can't be worked out (the shaping falls back to the edges).", fix: 'Correct Princess lines: distance from centre.' },
  'segment.princess-close': { severity: 'warning', message: 'Princess lines are … sts (… cm) from the centre, too close to the centre / side edges (half width …).', cause: 'Princess lines too near the centre or the edges.', fix: 'Make the distance between … and … cm.' },
  'segment.princess-steps': { severity: 'info', message: '<from> → <to>: princess lines only take increases/decreases; these steps stay at the side edges.', cause: 'Steps or short rows at princess placement.' },
  'segment.princess-odd': { severity: 'info', message: "<from> → <to>: the stitch count doesn't divide evenly over the shaping points; row … shapes one side of the marker only.", cause: 'An odd count at the princess lines.' },
  'segment.ws-markers': { severity: 'info', message: '… edge: … markers on WS rows (…), worked as purl-side shaping.', cause: 'Hand-placed markers on WS rows of RS-row shaping.' },

  // ---------- panels: neckline ----------
  'neckline.expr': { severity: 'error', message: 'Neckline <field>: <expression error>', cause: "A neckline expression can't be worked out.", fix: 'Correct the expression (Go to field).' },
  'neckline.too-deep': { severity: 'error', message: 'The neckline (… cm) is deeper than the panel (… cm).', cause: 'A neck depth beyond the panel.', fix: 'Make Depth (from top) at most … cm. Apply.' },
  'neckline.wider-than-top': { severity: 'error', message: 'Neck wider than the panel at row …: the opening is … cm where the panel is … cm, so the … side would have … sts.', cause: 'The opening is wider than the panel at that height (wider than the neck point, the top of the shoulder, or reaching the armhole shaping).', fix: 'Make Opening width at most … cm (Apply), or widen the shoulders; with a strap: widen Strap width.' },
  'neckline.centre-wide': { severity: 'warning', message: 'The centre (… sts, … cm) is wider than the neck opening (… sts, … cm).', cause: 'A centre wider than the opening (it is used as the whole opening).', fix: 'Make Centre width at most … cm. Apply.' },
  'neckline.rows': { severity: 'warning', message: 'Neckline: <rows that do not fit>', cause: "A V neck's shaping doesn't fit its depth on the chosen rows.", fix: 'Make Depth (from top) at least … cm (Apply), or shape on any row.' },
  'neckline.fit': { severity: 'error', message: 'Neckline: … decreases/increases per side do not fit in … rows (… cm).', cause: 'The neck is too shallow for its width.', fix: 'Make Depth (from top) at least … cm (Apply), or a wider Centre width.' },
  'neckline.packed': { severity: 'info', message: 'Neckline: decreases/increases were packed closer to fit the neck depth.', cause: 'A shallow round neck: the shaping is closer than every other row.' },
  'neckline.shoulder-sts': { severity: 'info', message: '… + … shoulder sts remain at the top / are cast on at the shoulders.', cause: 'The shoulder stitches either side of the neck.' },
  'neckline.below-join': { severity: 'info', message: 'The neck closes on row …, below the underarm join (row …): the body is worked flat until then, in the round from row ….', cause: 'A top-down neck deeper than the join.' },
  'body.flat-until-neck': { severity: 'info', message: 'The front neck closes on / is open down to row …: the body is worked flat until then, in the round from row ….', cause: "A yoke's front neck continuing into the body." },
  'body.neck-near-hem': { severity: 'warning', message: 'The front neck is still open … cm above the lower edge.', cause: 'A front neck from the yoke that ends near the hem.', fix: "Make the yoke's Depth below the neck point shallower, or lengthen the body." },

  // ---------- panels: painted stitches ----------
  'paint.runs-out': { severity: 'warning', message: 'Painted stitches / shaping lines run out of stitches at the shoulders / before the top.', cause: 'Decreases from painted stitches or lines never undone.', fix: 'Add the stitches back with increases, or use a fisheye line.' },
  'paint.count-change': { severity: 'info', message: 'Painted stitches change the count by … sts by the last row; …', cause: 'Painted stitches that change the count.' },
  'paint.outside': { severity: 'warning', message: '… painted stitches are outside the fabric on their row and are not drawn.', cause: 'Painted stitches left outside a changed shape.', fix: 'Move or erase them in the chart.' },

  // ---------- panels: values from other pieces ----------
  'knock-on.yoke': { severity: 'error', message: 'Waits on <Yoke>: <the yoke\'s error>', cause: "A piece whose widths come from the yoke, which can't be worked out (folded under the yoke's error).", fix: "The yoke's fix." },
  'knock-on.armhole': { severity: 'error', message: "Waits on <piece>: <that piece's error>", cause: "A sleeve's armhole_len, measured from a piece that can't be worked out.", fix: "That piece's fix." },
  'knock-on.edge': { severity: 'error', message: "Waits on <piece>: <that piece's error>", cause: "A band's edge_len, measured from a piece that can't be worked out.", fix: "That piece's fix." },
  'knock-on.join': { severity: 'error', message: "<join>: <edge> can't be measured until that panel can be computed.", cause: "A join measuring a piece that can't be worked out (counted once, with its root).", fix: "That piece's fix." },
  'source.yoke': { severity: 'error', message: 'Waits on the yoke: there is no contiguous yoke panel.', cause: 'Widths that use the yoke, without a yoke.', fix: 'Add a yoke, or change those widths.' },
  'source.armhole': { severity: 'error', message: "The armhole can't be measured: ….", cause: 'armhole_len without an armhole to measure.', fix: 'Check the join the piece is measured from.' },
  'source.edge': { severity: 'error', message: "The joined edge can't be measured: ….", cause: 'edge_len without a joined edge to measure.', fix: 'Check the join the piece is measured from.' },
  'source.armhole-info': { severity: 'info', message: 'armhole_len = … cm, from ….', cause: 'Where a sleeve cap takes its armhole length.' },
  'source.edge-info': { severity: 'info', message: 'edge_len = … cm, edge_rows = …, edge_pickup = … sts, from ….', cause: 'Where a band takes its edge length.' },

  // ---------- bust ----------
  'bust.expr': { severity: 'error', message: 'Bust: Width / Length / Bust point height / Bust point offset / Dart heights: <expression error>', cause: "A bust expression can't be worked out.", fix: 'Correct the expression (Go to field).' },
  'bust.apex-outside': { severity: 'error', message: 'Bust: The bust point (… cm up) is outside the panel.', cause: 'The bust point height is below or above the panel.', fix: 'Make the bust point height between … and … cm.' },
  'bust.apex-edge': { severity: 'warning', message: 'Bust: The bust point (… cm from centre front) is at or beyond the side edge.', cause: 'A bust point offset (apex_to_apex) as wide as the panel.', fix: 'Make Distance from centre front at most … cm.' },
  'bust.no-difference': { severity: 'info', message: 'Bust: Bust and upper chest differ by … cm; little or no bust shaping is needed.', cause: 'bust ≤ upper_chest.' },
  'bust.no-short-rows': { severity: 'info', message: 'Bust: The extra length rounds to no short rows.', cause: 'A tiny extra length.' },
  'bust.turns-fit': { severity: 'error', message: "Bust: … turns per side don't fit between the bust point and the side seam (… sts, … cm).", cause: 'Too many turns for the room.', fix: 'Set Pairs to at most …, or a shorter extra length.' },
  'bust.no-room': { severity: 'error', message: 'Bust: There is no room for the turns between the bust point and the side edge.', cause: 'The bust point at the side edge.', fix: 'Bring the bust point nearer centre front, or a narrower zone.' },
  'bust.turns-close': { severity: 'warning', message: 'Bust: Turns are only … st apart: … short-row pairs are a lot for this width.', cause: 'Many pairs in a narrow zone.', fix: 'Set Pairs to at most …, or a wider Turn zone width.' },
  'bust.turns-cross': { severity: 'error', message: 'Bust: Some short rows work fewer than 4 stitches; the turns cross over.', cause: 'Turns too near the centre.', fix: 'Fewer pairs, or turns further from the centre.' },
  'bust.asymmetric': { severity: 'warning', message: 'Bust: Left and right turns differ: the bust shaping is asymmetric.', cause: 'Different hand-set turns on each side.', fix: 'Type the same turns, or clear them.' },
  'bust.above-underarm': { severity: 'warning', message: 'Bust: The short rows start above the underarm, inside the armhole shaping.', cause: 'A high bust point or many pairs.', fix: 'Lower the bust point, or fewer pairs.' },
  'bust.open-front': { severity: 'info', message: 'Bust: the short rows are worked while the front neck is still open (…).', cause: 'Bust short rows beside a deep front neck from the yoke.' },
  'bust.dart-every-row': { severity: 'info', message: 'Bust: Vertical darts (…): not enough RS rows, so the dart shaping is worked on every row.', cause: 'Dart shaping in few rows.' },
  'bust.dart-rows': { severity: 'error or warning', message: 'Bust: Vertical darts (…): <rows that do not fit>', cause: "The darts' shaping doesn't fit their height.", fix: 'Give the darts more height, or less extra width.' },
  'bust.dart-unbalanced': { severity: 'warning', message: 'Bust: The darts open … and close … times: the extra width does not return to zero.', cause: 'Different numbers of hand-set increase and decrease rows.', fix: 'Make them the same number, or clear them.' },
  'bust.dart-order': { severity: 'error', message: 'Bust: The dart closes before it opens.', cause: 'Hand-set decrease rows below the increase rows.', fix: 'Increase rows below the bust point, decrease rows above.' },

  // ---------- shaping lines ----------
  'line.expr': { severity: 'error', message: 'Line "…": Start / End height / position / Stitches: <expression error>', cause: "A line expression can't be worked out.", fix: 'Correct the expression.' },
  'line.flat': { severity: 'error', message: 'Line "…": Both ends are on the same row.', cause: 'A line with no height.', fix: 'Move the End at least 1 row above the Start.' },
  'line.manual-short': { severity: 'warning', message: 'Line "…": Hand-placed rows leave … sts unshaped.', cause: 'Too few hand-placed rows.', fix: 'Add rows, or clear them.' },
  'line.manual-outside': { severity: 'warning', message: 'Line "…": Rows … are outside the line and were ignored.', cause: 'Hand-placed rows outside the line.', fix: 'Remove them.' },
  'line.every-row': { severity: 'info', message: 'Line "…": Not enough RS rows, so the shaping is worked on every row.', cause: 'A short line with much shaping.' },
  'line.rows': { severity: 'error or warning', message: 'Line "…": <rows that do not fit>', cause: "The line's shaping doesn't fit its height.", fix: 'Give the line more height, or fewer stitches.' },
  'line.odd': { severity: 'info', message: 'Line "…": An odd stitch is worked on one side of the line only.', cause: 'An odd count on a two-sided line.' },
  'line.at-edge': { severity: 'warning', message: 'Line "…": An end is … sts (… cm) from the centre, at or beyond the edge (…).', cause: 'A line end outside the fabric.', fix: 'Make Distance from centre at most … cm.' },
  'line.mirror-overlap': { severity: 'warning', message: 'Line "…": A mirrored line on the centre overlaps its twin.', cause: 'A mirrored line on the centre line.', fix: 'Move it off the centre, or untick Mirror.' },
  'line.count-change': { severity: 'info', message: 'Line "…": Changes the stitch count by … from row … on; later widths move with it.', cause: 'A one-way line.' },

  // ---------- contiguous yoke (and the raglans that use its neck) ----------
  'yoke.expr': { severity: 'error', message: '<Yoke field>: <expression error>', cause: "A yoke expression can't be worked out.", fix: 'Correct the expression (Go to field).' },
  'yoke.no-back-neck': { severity: 'error', message: 'The neck width (… cm) gives no back neck stitches.', cause: 'A neck width under one stitch.', fix: 'Make Neck width, cast on across the back at least … cm.' },
  'yoke.short-rows-fit': { severity: 'error', message: "Short rows: … pairs … sts apart don't fit in a front of … sts (… cm): the last turn is past centre front.", cause: 'Too many short-row pairs for the front cast-on.', fix: 'Make Short-row pairs at most … (Apply), or a smaller Sts between turns.' },
  'yoke.short-rows-centre': { severity: 'info', message: 'Short rows: the last turns reach into the centre part (… sts each side of centre front).', cause: 'Many pairs on a round neck.' },
  'yoke.short-rows-close': { severity: 'info', message: 'Short rows: turns 1 st apart. …', cause: 'Turns 1 st apart.' },
  'yoke.short-rows-below-split': { severity: 'error', message: 'The short rows end on row …, … rows (… cm) below the underarm split (row …).', cause: 'Whole-neck short rows deeper than the yoke.', fix: 'Make Short-row pairs at most … (Apply), or add … cm to Extra depth.' },
  'yoke.back-neck-rate': { severity: 'info', message: 'Back neck: … increases per row (the method suggests 2 to 4).', cause: 'Back neck increases outside the method\'s range.' },
  'yoke.cap-top-odd': { severity: 'warning', message: 'Cap top … sts − seam … sts is odd; the markers move … st each side (cap top … sts).', cause: 'An odd difference between the cap top and the seam.', fix: 'Make Cap top stitches … or … (Apply: the count worked).' },
  'yoke.shoulder-phase': { severity: 'error', message: 'The shoulder phase has … rows: the back neck (… cm) is already as wide as Back width after the markers move (… cm). / the shoulder seam is too short to work.', cause: 'A neck as wide as the back target (or a seam length under a row).', fix: 'Make Back width after the markers move at least … cm, narrow the Neck width, or Extra rows at least … (Apply).' },
  'yoke.strap-too-wide': { severity: 'error', message: 'A … strap (… rows) leaves no neck: its increases alone make the back … wide, more than Back width after the markers move (… cm).', cause: 'Strap width (gives at the neck) wider than the back target allows.', fix: 'Make the strap narrower (about … at most), widen Back width after the markers move, or let the strap give at the armhole.' },
  'yoke.strap-narrow-neck': { severity: 'warning', message: 'The … strap leaves a … back neck, much narrower than back_neck_width (…): check that the neck goes over the head.', cause: 'A wide strap that gives at the neck.', fix: 'Make the strap narrower, or set Strap gives at to Armhole to keep the neck.' },
  'yoke.strap-armhole': { severity: 'info', message: 'The strap gives at the armhole: the neck stays and the back is … after the markers move, so the cross back (…) is no longer followed.', cause: 'Strap gives at: Armhole (by design).' },
  'yoke.back-neck-past-shoulders': { severity: 'info', message: 'Back neck increases (rows 1–…) run past the shoulder phase (… rows).', cause: 'More back neck rows than shoulder rows.' },
  'yoke.front-neck-every-row': { severity: 'info', message: "Front neck: … increases each side don't fit on RS rows in … rows (… cm), so some are on WS rows too (at most every row). For RS rows only, make Depth below the neck point at least … cm or the neck narrower.", cause: 'A V neck wide for its depth.' },
  'yoke.front-neck-rows': { severity: 'error', message: 'Front neck: <rows that do not fit>', cause: "A V neck's increases don't fit the neck depth even on every row.", fix: 'Make Depth below the neck point at least … cm (Apply), or the Neck width narrower.' },
  'yoke.front-neck-fit': { severity: 'error', message: 'Front neck: … increases per side do not fit in … rows (… cm).', cause: 'A round neck too shallow for its width.', fix: 'Make Depth below the neck point at least … cm (Apply), or a wider Centre.' },
  'yoke.neck-continues': { severity: 'info', message: 'The front neck continues … rows (… cm) into the front body: ….', cause: 'A front neck deeper than the yoke: the front body works the rest.' },
  'yoke.short-rows-capped': { severity: 'info', message: 'Short rows: the default … pairs don\'t fit in a front of … sts (… cm), so … pairs, turns 1 st apart; the rest of the front neck is worked below them.', cause: 'A modified raglan front too narrow for the default short rows (e.g. a square cardigan in the small sizes).' },
  'yoke.neck-below-short-rows': { severity: 'info', message: 'Front neck … cm: the back neck is … cm below the neck point and the short rows raise the back … cm (… pairs); the other … cm (rows …–…): cast on … sts each front, … increases each side, then cast on … sts at centre front and join in the round.', cause: 'A modified raglan front neck deeper than its short rows: the fronts are cast on narrower and the rest is front-neck increases.' },
  'yoke.integrated-bands': { severity: 'warning', message: 'Integrated front bands are not worked into a contiguous yoke yet; the yoke has none.', cause: 'Integrated bands on a contiguous cardigan.', fix: 'Pick up or sew on the front bands instead.' },
  'yoke.body-too-wide': { severity: 'error', message: 'The yoke body (… sts, … cm) is already … wider than Body at the underarm (… cm): the underarm cast-on would be … sts.', cause: 'Long shoulders and no body increases.', fix: 'Make Body at the underarm at least … cm, or shorten the shoulders.' },
  'yoke.body-wider': { severity: 'warning', message: 'With … sts cast on at each underarm the body is … wider than Body at the underarm (… cm).', cause: 'An underarm cast-on bigger than the body needs.', fix: 'Make Underarm cast-on, each at most … cm (Apply), or a wider body.' },
  'yoke.underarm-raised': { severity: 'info', message: 'Body increases fill the lower … armhole rows; the underarm cast-on is raised from … to … sts.', cause: 'The body increases alone don\'t reach the body width.' },
  'yoke.body-increase-rows': { severity: 'warning', message: 'Body increases: <rows that do not fit>', cause: "The body increases don't fit their zone.", fix: 'A larger Body increases over, or more Extra depth.' },
  'yoke.deepened': { severity: 'info', message: 'Yoke deepened by … rows (… cm) so the sleeve reaches its width with at most … % of the armhole rows rapid.', cause: 'Deepen until the cap is not mostly rapid.' },
  'yoke.armhole-short': { severity: 'error', message: "The armhole has … rows (… cm) after the shoulder phase (… of the yoke's … rows).", cause: 'Shoulders as long as the yoke.', fix: 'Add … cm to Extra depth (Apply), or shorten the shoulders.' },
  'yoke.sleeve-short': { severity: 'warning', message: 'The sleeve reaches … sts (… cm) at the underarm, … short of Sleeve at the underarm.', cause: "The cap can't increase enough in the armhole rows.", fix: 'Add Extra depth or a larger Underarm cast-on (at least … cm); without solving, longer Rapid rows.' },
  'yoke.rapid-lengthened': { severity: 'info', message: 'Rapid cap rows lengthened from … to … so the sleeve reaches its width.', cause: 'Solving the rapid phase.' },
  'yoke.cap-flat': { severity: 'info', message: 'Hint: the cap may look flat: … of the … armhole rows are rapid. A deeper yoke gives a rounder cap.', cause: 'Mostly rapid cap rows.' },
  'yoke.zone-negative': { severity: 'error', message: 'Row …: the <zone> has … sts.', cause: 'The markers moved past a zone\'s stitches.', fix: 'Fewer Cap top stitches, or a wider Neck width.' },
  'yoke.markers-move': { severity: 'error', message: "The markers can't move … sts: the fronts have … sts at the end of the shoulders.", cause: 'A cap top wider than the fronts allow.', fix: 'Make Cap top stitches at most … (Apply), or longer shoulders.' },
  'yoke.empty-row': { severity: 'error', message: 'A row has no stitches.', cause: 'An empty cast-on.', fix: 'Check the cast-on fields.' },
  'yoke.held-empty': { severity: 'error', message: 'Nothing to hold at the split: sleeves … / body … / sleeves … sts.', cause: 'A zone with no stitches at the split.', fix: 'Check the sleeve, body and underarm widths.' },
  'yoke.band-below-split': { severity: 'error', message: 'The band, increase round (and short rows) end on row …, … rows (… cm) below the underarm split (row …).', cause: "An off-shoulder band deeper than the raglan.", fix: 'Add … cm to Extra depth (Apply), fewer short-row pairs, or a shallower band.' },
  'yoke.fit-cross-back': { severity: 'info', message: 'End of the shoulders (row …): the back is … cm, … wider/narrower than the cross back (… cm).', cause: 'How the back compares with the cross back.' },
  'yoke.fit-cross-front': { severity: 'info', message: 'End of the shoulders: the fronts (with the neck between them) are … cm, … than the cross front (… cm).', cause: 'How the fronts compare with the cross front.' },
  'yoke.fit-sleeve-tight': { severity: 'warning', message: 'The sleeve at the underarm is … cm (… + … sts), … less than bicep + ease (… cm): it may be tight.', cause: 'A sleeve narrower than bicep + ease.', fix: 'Make Sleeve at the underarm at least … cm, or a larger underarm cast-on.' },
  'yoke.fit-sleeve-wide': { severity: 'info', message: 'The sleeve at the underarm is … cm, … more than bicep + ease (… cm).', cause: 'A roomy sleeve.' },
  'yoke.fit-armhole-short': { severity: 'warning', message: 'Around the armhole (…) is … cm, … less than the scye circumference (… cm): the sleeve may be tight at the underarm.', cause: 'A shallow yoke for the scye.', fix: 'Add … cm to Extra depth (Apply), or a larger underarm cast-on.' },
  'yoke.fit-armhole-deep': { severity: 'info', message: 'Around the armhole is … cm, … more than the scye circumference (… cm): a deep armhole.', cause: 'A deep yoke.' },
  'yoke.cap-pointy': { severity: 'info', message: 'Hint: the cap may look pointy: the shoulder seam is … rows but the rapid cap only …. …', cause: 'A long seam with few rapid rows.' },
  'yoke.body-start': { severity: 'warning', message: 'The body starts with … sts (…), but the yoke holds … + 2 × … cast on = ….', cause: "The body pieces' top widths no longer follow the yoke.", fix: 'Make their underarm widths follow the yoke again, or re-add them.' },
  'yoke.sleeve-start': { severity: 'warning', message: '<Sleeve> starts with … sts, but the yoke holds … + … cast on = ….', cause: "A sleeve's top width no longer follows the yoke.", fix: 'Make its underarm width follow the yoke again.' },

  // ---------- raglan ----------
  'raglan.off-shoulder-cardigan': { severity: 'error', message: 'An off-shoulder neckline is pullover only for now.', cause: 'Off-shoulder on a cardigan.', fix: 'Choose a pullover front or another neckline.' },
  'raglan.no-sleeve-top': { severity: 'error', message: 'The sleeve tops have no stitches.', cause: 'A sleeve top and raglan lines of no stitches.', fix: 'Make Sleeve top at the cast-on at least … cm, or more line stitches.' },
  'raglan.too-shallow': { severity: 'error', message: 'The raglan is … rows (… cm) deep.', cause: 'A back length under 2 rows.', fix: 'Add … cm to Extra depth (Apply), or a longer back length.' },
  'raglan.underarm-raised': { severity: 'info', message: "Even increasing every row, the raglan doesn't reach the body and sleeve widths in … rows: the underarm cast-on is raised from … to … sts. …", cause: 'A shallow raglan for the widths.' },
  'raglan.body-wider': { severity: 'warning', message: 'With … sts cast on at each underarm the body is … wider than Body at the underarm without any raglan increases.', cause: 'A wide neck or ring for the body.', fix: 'Make Underarm cast-on, each at most … cm (Apply), or a narrower neck / less ring ease.' },
  'raglan.sleeve-wider': { severity: 'warning', message: 'With … sts cast on at each underarm the sleeve is … wider than Sleeve at the underarm without any raglan increases.', cause: 'A wide sleeve top for the sleeve.', fix: 'Make Underarm cast-on, each at most … cm (Apply), or a narrower sleeve top / arm arc.' },
  'raglan.body-every-row': { severity: 'info', message: "Body: every other row isn't enough, so … of its … increase rows are the rows between …", cause: 'Fast body increases.' },
  'raglan.sleeve-every-row': { severity: 'info', message: "Sleeves: every other row isn't enough, so … of their … increase rows are the rows between.", cause: 'Fast sleeve increases.' },
  'raglan.band-room': { severity: 'error', message: 'Only … cm between the band and the underarm at the front: the raglan has no room to grow (it needs 4 cm).', cause: 'An off-shoulder band too near the underarm.', fix: 'Add … cm to Extra depth (Apply), a shallower band, or a smaller off_shoulder_drop.' },
  'raglan.missing-measurement': { severity: 'error', message: 'Off-shoulder needs the off_shoulder_circ / off_shoulder_drop measurement (…).', cause: 'A sizing table without the off-shoulder measurements.', fix: 'Add the measurement (Measurements).' },
  'raglan.no-band': { severity: 'info', message: 'No band (the Neckband is off): the ring is cast on as the top edge, …', cause: 'Off-shoulder with the neckband off.' },
  'raglan.band-ease-loose': { severity: 'warning', message: 'Band ease … %: with less than 5 % negative ease the band may slide down.', cause: 'Band ease above −5 %.', fix: 'Make Band ease −0.05 (−5 %) or less. Apply.' },
  'raglan.band-ease-tight': { severity: 'warning', message: 'Band ease … %: more than 20 % negative ease may be too tight to pull over the arms.', cause: 'Band ease below −20 %.', fix: 'Make Band ease −0.2 (−20 %) or more. Apply.' },
  'raglan.ring-full': { severity: 'error', message: 'The ring (… sts) has no room for the body after two sleeve zones of … sts.', cause: 'A wide arm arc for the ring.', fix: 'Make Arm arc at most … cm (Apply), or more ring ease.' },
  'raglan.band-wider-than-ring': { severity: 'error', message: 'The band (… sts) is wider than the ring (… sts).', cause: 'Band ease above ring ease.', fix: 'Make Band ease less than Ring ease.' },
  'raglan.body-off': { severity: 'warning', message: 'The body at the underarm is … cm (…), … more/less than its target (… cm).', cause: 'The raglan increases (4 a row) can\'t meet the body width.', fix: 'A smaller / larger underarm cast-on, or a narrower neck / deeper raglan.' },
  'raglan.shallow-split': { severity: 'warning', message: 'The raglan splits … cm higher than the armhole depth (… cm below the shoulder): it may bind at the underarm.', cause: 'A raglan shallower than the armhole depth.', fix: 'Add … cm to Extra depth. Apply.' },
  'raglan.estimate': { severity: 'info', message: 'off_shoulder_circ is still an estimate: measure it (…).', cause: 'An estimated off-shoulder circumference.' },

  // ---------- project checks ----------
  'joins.rounds-differ': { severity: 'error', message: 'Panels joined in the round have different numbers of rounds below the join (…).', cause: 'Pieces knitted together in the round that reach the join at different rounds.', fix: 'Make the join waypoint the same height on each piece, or work them flat.' },
  'joins.shaping-rounds': { severity: 'info', message: 'Joined panels shape their side seams on different rounds (…).', cause: 'Different side shaping in joined pieces.' },
  'join.measure': { severity: 'warning', message: '<join>: <edge>: <why it can\'t be measured>', cause: "A join's edge that can't be measured.", fix: "Check the join's edges." },
  'join.one-side': { severity: 'info', message: '<join>: seam has only one side; add the edge it is sewn to.', cause: 'A seam with one side.' },
  'join.side-shaping': { severity: 'warning or info', message: "<join>: the side seams don't mirror (hem to waist <front> … sts, <back> … sts; waist to underarm … at this edge).", cause: 'Front and back side edges sewn (or knitted) together shape differently: a back-weighted waist split (info when chosen under Fit), or different hem / waist / underarm widths. The bust width at the front side seams above the waist and princess-line shaping are not reported.', fix: 'Use an even waist split (Apply), or make the hem, waist and underarm widths match.' },
  'fit.waist-split-princess': { severity: 'info', message: '<Panel> shapes the waist at princess lines with an even waist split; a back-weighted split (Settings → Fit) takes more of the narrowing at the back.', cause: 'Princess-line waist shaping with the even split.', fix: 'Back-weighted waist split (Apply), or keep even.' },
  'join.seam-differ': { severity: 'warning', message: '<join>: the sides differ by … cm (… rows), more than the … cm tolerance.', cause: 'Seam sides of different lengths.', fix: 'Make the sides the same length, or a larger Seam tolerance.' },
  'join.same-edge': { severity: 'info', message: 'The same edge is in "…" (…) and "…" (…).', cause: 'One edge in two joins.' },
  'fit.region-gap': { severity: 'warning', message: 'Lower body … is … sizes from upper body … (limit …): check the shaping between the waist and the underarm.', cause: 'Region sizing far apart.', fix: 'Closer sizes, or a larger gap limit.' },
  'fit.region-shaping': { severity: 'error', message: 'More shaping than the rows allow between … and …, where … meets …: …. (…)', cause: 'Region sizing with a segment that cannot fit its shaping (replaces that segment error).', fix: "Bring the sizes closer, or the segment's fix." },
  'fit.hem-narrow': { severity: 'warning', message: 'The hem (… cm around) is … cm narrower than the bust plus ease (… cm): it may not pull over the bust.', cause: 'A narrow hem (hem check on).', fix: 'Widen the hem by … cm each, or turn off the hem check.' },
  'fit.armhole-short': { severity: 'warning', message: 'The armhole (Front + Back, … cm) is shorter than the scye circumference (… cm): …', cause: 'Shallow set-in armholes.', fix: 'Deepen the armholes by about … cm.' },
  'fit.neckband-short': { severity: 'warning', message: "The neckband (… cm) is shorter than the neck base (… cm): it won't sit around the neck.", cause: 'A short neckband.', fix: 'Make its width at least … cm. Apply.' },
  'sleeve.cuff-long': { severity: 'warning', message: 'The cuff band (… cm) is as long as the … sleeve (… cm).', cause: 'A cuff band as long as a short sleeve.', fix: 'A shallower cuff band (Garment → Edges → Cuffs), or a longer sleeve.' },
  'sleeve.cuff-half': { severity: 'info', message: 'The cuff band (… cm) is more than half of the … sleeve (… cm); …', cause: 'A deep cuff on a short sleeve.' },
  'sleeve.fast-shaping': { severity: 'info', message: 'The … sleeve changes by … sts each side in … rows, more often than every other row: …', cause: 'Fast sleeve shaping.' },
  'sleeve.shaping-in-rib': { severity: 'info', message: '… of the … shaping rows each side fall in the cuff rib (…).', cause: 'Shaping in the cuff rib.' },

  // ---------- bands and buttons ----------
  'bands.stale-strip': { severity: 'info', message: "<strip> no longer matches the edge settings (Project → Edges); delete it if you don't need it.", cause: 'A band strip left from older settings.' },
  'bands.short': { severity: 'warning', message: '<strip> is … cm long, … cm shorter than its edge (… cm): it may pull the front up.', cause: 'Too few stitches picked up.', fix: 'Pick up more (a larger ratio on the join).' },
  'bands.long': { severity: 'warning', message: '<strip> is … cm long, … cm longer than its edge (… cm): it may ripple.', cause: 'Too many stitches picked up.', fix: 'Pick up fewer (a smaller ratio on the join).' },
  'bands.pickup-multiple': { severity: 'info', message: "Picking up … sts doesn't fit … (…); the band rounds to …: pick up … more/fewer.", cause: "A pick-up that doesn't fit the band pattern." },
  'bands.double-neck': { severity: 'warning', message: 'A continuous front band goes around the neck, and a neckband is switched on too.', cause: 'Two neck edges.', fix: 'Switch off the Neckband, or separate front bands.' },
  'bands.closed-narrow': { severity: 'warning', message: "Closed at …, the fronts measure … cm (…), … cm short of the front's … cm.", cause: 'Narrow bands or a large overlap.', fix: 'Wider bands, or a smaller overlap.' },
  'buttons.expr': { severity: 'error', message: '<button setting>: <expression error>', cause: "A button placement expression can't be worked out.", fix: 'Correct the button placement.' },
  'buttons.outside': { severity: 'error', message: 'Button … is at … cm, outside the front edge (0–… cm).', cause: 'A button beyond the front edge.', fix: 'Keep the buttons between 0 and … cm.' },
  'buttons.hole-wide': { severity: 'warning', message: 'Buttonholes (… sts) leave fewer than 1 (band) stitch each side in a …-st band.', cause: 'A buttonhole as wide as the band.', fix: 'A narrower buttonhole, or a wider band.' },
  'buttons.no-strip': { severity: 'warning', message: 'No front band / buttonhole band strip to put the buttonholes on.', cause: 'Picked-up or sewn-on bands without strips.', fix: 'Add band strips (Garment → Edges).' },
  'buttons.band-narrow': { severity: 'warning', message: 'The band is … rows (… cm) deep: the buttonholes (row …) are within 2 rows of its edge.', cause: 'A narrow picked-up band.', fix: 'Make the band at least … cm (5 rows).' },
  'buttons.close': { severity: 'warning', message: 'Buttonholes are … sts / rows apart (on the band): too close together.', cause: 'Many buttons close together.', fix: 'Fewer buttons, or spread them.' },
};
