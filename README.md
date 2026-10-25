# Knitbit

A browser-based visualizer for knitted panel shaping in women's tops: schematics, size grading,
shaping placement, bust shaping and stitch charts. It does not write pattern text and does not decide
how panels are joined.
Projects are auto-saved in the browser and, optionally, online with Google sign-in (see *Saving online*).

**Sizing**: an 11-size table of body measurements (4XS–4X, cm) with bust by cup (A/B to G/H), hips straight or curvy,
and bust dart data; a measurement dictionary with tooltips; project-wide fit choices (cup, hem level, broad back);
optional region sizing (upper body, lower body and sleeves from different sizes) and custom one-off sizes. See
*Sizing tables*, *Region sizing*, *Bust shaping* and *Project JSON → Loading and migrations*.

**Sizing data credit:** Body measurements adapted from Ysolda Teague's designer size chart, ysolda.com/designer-size-chart.
The adapted table (`samples/sizing_table_ysolda_cm.csv`) is for personal use and should not be redistributed as a chart.

**Starting a garment**: **New…** opens the *New garment* dialog (also on first run): how it's built, front,
neckline, sleeves, fit, edges, sizes and gauge in one screen. See *Starting a garment*.

**Garment options** (Garment tab), combined freely: **Construction** *Panels* (the panels you draw) or
*Contiguous, top-down* (a generator that makes a top-down yoke: contiguous, raglan or modified raglan, and the body
and sleeves that continue from it, all ordinary editable panels), and **Front opening** *Closed / pullover* or *Cardigan* (mirrored left/right fronts,
bands, buttons). Edge treatments (hem, cuff, neckband, front bands) are set once for the project. See *Garment
options*, *Cardigan fronts*, *Edge treatments*, *Cardigan bands and buttons*, *Contiguous yoke* and *Raglan yoke*.

**Contiguous method credit:** The contiguous construction follows the contiguous sleeve method developed by Susie
Myers, SusieM on Ravelry (http://www.ravelry.com/people/SusieM). It is a method, not a pattern; Knitbit only models
its phases. Contiguous projects get the tag *contiguous* (raglan and modified raglan get *raglan*), and the
contiguous and modified raglan methods (both use its shoulder and sleeve-cap phases) carry this line in their footer (Garment
tab → *Credit the construction method in export footers*, on by default): *"This garment is worked seamlessly
from the top-down using the contiguous sleeve method developed by Susie Myers, SusieM on Ravelry
(http://www.ravelry.com/people/SusieM)"*. (PDF/PNG export itself is not built yet; `exportFooter()` in
`src/engine/garment.ts` gives it the footer lines.)

## Running

Requires Node 20+.

```bash
npm install
npm run dev        # app at http://localhost:5173
npm test           # unit tests (Vitest)
npm run typecheck
```

## Saving online

Optional, and only shown when the site has been set up for it (see *Cloud save setup* below). Without that setup
there's no sign-in button and the app works entirely in this browser.

**Sign in.** Click **Sign in with Google** in the toolbar (a popup; where popups are blocked, the page goes to Google
and comes back). Once signed in, the toolbar shows a save status and your avatar; the avatar menu has **Sign out**.
You stay signed in on that browser until you sign out. Your projects are visible only to you.

**Saving.** While signed in, the open project is saved online about 2 s after you stop editing, and straight away
when you hide or close the tab. There is no Save step. The status next to the avatar says where things stand:

| Status | Meaning |
|---|---|
| **Saved online · just now** (or *· 5 min ago*, *· 14:32*) | The online copy matches this one. |
| **Saving…** | A save is on its way. |
| **Offline: saved on this device** | No connection. Edits are kept in this browser and sent when you're back online. |
| **Not saved online** | Hover for the reason. A failed save is retried on its own. If the project was deleted online (from another device) or its online copy can't be read, a notice says so and online saving of it pauses; it stays saved on this device. |
| **Conflict** | Changed here and on another device. Click it to choose what to keep (below). |
| **Only on this device** | First sign-in: this project hasn't been uploaded (you chose *Not now*). |
| **Sign in again to keep saving online** | The sign-in expired or was revoked. Click it to sign in again; saving resumes. |

**Projects dialog.** Signed in, **Open…** (⌘O) shows your online projects, most recently edited first, with
**Open**, **Rename**, **Duplicate** and **Delete**, plus **Open from file…** for `.knitbit.json` files. A file you open
is saved online from then on. Deleting the open project opens the most recently edited remaining one, or a fresh
sample if none is left. Deleted projects disappear from the list; there's no undelete in the app.

**First sign-in.** If the open project has never been online: with nothing else online it's uploaded straight away;
otherwise the Projects dialog asks you to **Upload this project** or open one of your online projects. **Not now**
keeps it on this device only.

**Opening the app.** Signed in, the app checks the open project against its online copy: edits made here while
offline are uploaded; if another device saved a newer version, that version opens (undo goes back to this one, with a
notice saying so); if both changed, you get the conflict dialog.

**Offline.** Edits always go to this browser's auto-save first, so nothing is lost without a connection. While
offline nothing is sent; failed saves retry after 2 s, 5 s, 15 s, then every minute, and at once when the connection
returns. Until then, offline edits exist only in this browser: another device shows the older online copy.

**Conflicts.** If the project changed on this device *and* online (another device saved it) since this device last
synced, nothing is overwritten. The **Changed in two places** dialog shows both versions' name and last-edited time:

- **Keep this device's version**: replaces the online version.
- **Keep the online version**: opens it here. Undo brings this device's version back.
- **Save this device's version as a copy**: saves it online as "*name* (copy)" and opens it; the online version stays.

**Decide later** closes the dialog; the project keeps saving on this device but not online until you click
**Conflict** in the toolbar and choose.

**Still there when signed in or out:** the on-device auto-save (below) and **Save** (⌘S), which downloads a
`.knitbit.json` copy, useful as a backup. Signed out, the app behaves as if online saving didn't exist.

## Cloud save setup

For the site owner, done once. Online saving uses Firebase (Google sign-in + Firestore) directly from the browser;
there is no server code. Until steps 1–7 are done the app simply shows no sign-in. Plan and reasoning:
`docs/cloud-save-plan.md`.

1. **Create the Firebase project.** At [console.firebase.google.com](https://console.firebase.google.com), *Create a
   project* (Google Analytics isn't needed). The free **Spark** plan is enough.
2. **Enable Google sign-in.** Build → **Authentication** → *Get started* → **Sign-in method** → **Google** → Enable,
   pick a support email, Save.
3. **Create the Firestore database.** Build → **Firestore Database** → *Create database*, choose a location (it can't
   be changed later; pick one near you, e.g. `europe-west`), and start in **production mode** (everything denied until
   step 6 publishes the rules).
4. **Authorise the domains.** Authentication → **Settings** → **Authorised domains** → *Add domain*: the Vercel
   domain (e.g. `knitbit.vercel.app`) and any custom domain. `localhost` is listed by default; keep it for local dev.
   Sign-in fails with `auth/unauthorized-domain` on any domain not listed, including Vercel preview URLs.
5. **Register a web app and copy its config.** Project settings (⚙) → General → **Your apps** → Web (`</>`), any
   nickname, no Firebase Hosting. From the `firebaseConfig` it shows, four values are used:

   | Variable | From `firebaseConfig` |
   |---|---|
   | `VITE_FIREBASE_API_KEY` | `apiKey` |
   | `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` (`<project-id>.firebaseapp.com`) |
   | `VITE_FIREBASE_PROJECT_ID` | `projectId` |
   | `VITE_FIREBASE_APP_ID` | `appId` |

   - **Vercel:** Project → Settings → **Environment Variables**, add all four for **Production** (and **Preview** if
     you want sign-in on preview deployments; their domains must then be authorised too, step 4).
   - **Local dev:** `cp .env.example .env.local` and fill in the same four (`.env.local` is git-ignored). Restart
     `npm run dev` after changing it.

   These values end up in the public JavaScript by design; they identify the project, they don't grant access. The
   security rules (next step) protect the data. If any of the four is missing, cloud features stay hidden.
6. **Publish the security rules** from `firestore.rules` (each user can read and write only their own projects; a
   project's text must be under 900 kB). Either:
   - Console: Firestore Database → **Rules**, replace the contents with `firestore.rules`, **Publish**; or
   - CLI: `npm install -g firebase-tools`, `firebase login`, then
     `firebase deploy --only firestore:rules --project <project-id>` (uses `firebase.json`).

   Re-publish whenever `firestore.rules` changes. No indexes are needed.
7. **Serve sign-in from the site's own domain** (needed for the redirect fallback). Chrome, Safari and Firefox block
   the storage a sign-in redirect uses when it finishes on `<project-id>.firebaseapp.com` while the app runs on
   another domain: you come back from Google still signed out. `vercel.json` forwards `/__/auth/*` to Firebase, so:
   - In `vercel.json`, the destination must be your `<project-id>.firebaseapp.com` (it is `knitbit-7ea36` here).
   - Vercel: set `VITE_FIREBASE_AUTH_DOMAIN` (Production) to the site's domain, e.g. `knitbit.vercel.app`. Keep
     `<project-id>.firebaseapp.com` in `.env.local` for local dev.
   - Google Cloud console → APIs & Services → **Credentials** → the OAuth 2.0 client *Web client (auto created by
     Google Service)* → **Authorised redirect URIs** → add `https://knitbit.vercel.app/__/auth/handler`, Save.
8. **Redeploy on Vercel.** The variables are read at build time, so an existing deployment doesn't see them:
   Deployments → latest → ⋯ → **Redeploy** (or push a commit).

**Check that it works**

1. Locally (`npm run dev`) or on the deployed site, **Sign in with Google** appears in the toolbar. If it doesn't, a
   variable is missing or the deployment predates it.
2. Sign in. The status turns to **Saved online · just now** within a few seconds of an edit.
3. In the Firebase console, Firestore Database → Data shows a `projects` document with your `owner` (your user id,
   also under Authentication → Users), `name`, `data`, `rev` and `updatedAt`.
4. Open the site in another browser or device, sign in, **Open…**: the project is listed. Edit it in both to see the
   conflict dialog.
5. Errors to look for: `auth/unauthorized-domain` (step 4), `auth/configuration-not-found` or
   `auth/operation-not-allowed` (step 2), **Not saved online** with *Missing or insufficient permissions* (rules not
   published, step 6).

**Limits and cost.** The Spark plan is free. Its quotas are roughly 50k document reads, 20k writes and 20k deletes a
day and 1 GiB stored (a project is about 50 kB, saved at most once per pause in editing), far more than one knitter
uses. These figures are approximate and change; check
[firebase.google.com/pricing](https://firebase.google.com/pricing) before relying on them. Over quota, saves fail
until the daily reset (status **Not saved online**); the on-device copy is unaffected.

**How it's loaded.** The Firebase SDK (`firebase/firestore/lite`, about 200 kB) is a separate chunk, loaded only when
you click Sign in or at startup when you were signed in last time (`knitbit.cloud.signedIn` in localStorage). The
per-account sync marker is `knitbit.syncMarker.v1:<uid>`. Deleted projects are marked `deleted` in Firestore, not
removed; delete them in the console if you want the space back.

## Project layout

- `src/engine/`: pure TypeScript calculation engine (no React). Everything is stored in centimetres.
  - `units.ts`: cm ↔ in conversion and display formatting (decimals).
  - `gauge.ts`: gauge per 10 cm or per 4 in (10.16 cm), and conversion between lengths and stitch/row counts.
  - `rounding.ts`: raw count → whole stitches (nearest → pattern multiple → selvedges → parity), with every step recorded.
  - `expr.ts`: the expression language (below).
  - `distribute.ts`: spreads increases/decreases over rows (auto, fixed rhythm, mixed rhythm) and across a row.
  - `model.ts`: project data types and factories.
  - `measurements.ts`: per-size measurement resolution and the expression scope.
  - `seed.ts`: project from a sizing table, plus estimated and derived measurements.
  - `dictionary.ts`: the measurement dictionary (category, region, definition, tooltip for every sizing-table column).
  - `fit.ts`: fit choices (cup, hem, broad back) and the names they derive (`bust`, `hem_circ`, `shoulder_w` …).
  - `legacy.ts`: old measurement names and the schema 1 → 2 migration.
  - `regions.ts`, `regionShaping.ts`: region sizing (upper / lower / sleeves per size) and the segments between regions.
  - `schema.ts`: JSON validation, migrations, load/save. `history.ts`: undo/redo. `autosave.ts`: localStorage safety net.
  - `panel.ts`: computes one panel in one size (rows, stitches, shaping events, neckline, outline, issues).
  - `templates.ts`: panel templates (back, front with 4 necklines, 3 sleeves, rectangle, neckband; bottom-up or top-down).
  - `sleeveLength.ts`: sleeve lengths (long to cap) applied to any sleeve; `sleeveChecks.ts`: their checks.
  - `sizing.ts`: reading CSV/JSON sizing tables, column mapping, applying an import.
  - `grading.ts`: size and measurement operations (rename everywhere, increment rules, base size, zigzag check).
  - `symbols.ts`: the stitch symbol set and what each does as a shaping marker.
  - `manual.ts`: hand-editing shaping markers (move, add, remove, retype, reset).
  - `checks.ts`: project-wide checks for the check panel; `fitChecks.ts`: the checks from the sizing data (below).
  - `bust.ts`: bust shaping (formulas with numbers plugged in, short-row wedges, horizontal and vertical darts).
  - `joins.ts`: measuring tagged edges, seam comparison, pick-up suggestions. `edges.ts`: edge length along the outline.
  - `waypointDrag.ts`: proportional waypoint height/width edits, linked panels, match.
  - `layout.ts`: garment layout geometry (local cm frame, rotation, placement), size alignment, T-shape auto-arrange.
  - `free.ts`: painted stitches (paint, erase, repeat, mirror, copy to all sizes). `lines.ts`: shaping lines.
  - `chart.ts`: the stitch chart grid built from a computed panel (cells, short rows, repeats, legend, column folding).
  - `garment.ts`: the garment options (construction, front opening), tags, the export credit line, schema 2 → 3.
  - `cardigan.ts`: cardigan fronts as a mirrored pair (split, merge, link, keep in step).
  - `edgeTreatments.ts`: hem, cuff, neckband and front band settings applied as sections, strips and joins.
  - `bands.ts`, `buttons.ts`: band width / overlap / closing width, button positions, buttonholes, band checks.
  - `contiguous.ts`: the contiguous yoke generator (phases A–F, neck, row-by-row zones and increases) and `yoke.*` names.
  - `yokePanel.ts`, `yokeTop.ts`: the yoke as a panel and chart; its top-view geometry.
  - `contiguousGarment.ts`: body and sleeves from the yoke's held stitches. `contiguousChecks.ts`: their checks.
  - `raglan.ts`: the raglan yoke generator (same rows and result as the contiguous yoke; its neck comes from
    `generateYoke`). `generateYoke` hands a `style: 'raglan'` yoke to it.
  - `cloudSync.ts`: online sync decisions (upload, download, conflict) against a `ProjectRemote` interface, the sync
    marker, conflict resolution. `cloudProjects.ts`: Projects dialog operations. `testRemote.ts`: in-memory remote for tests.
- `src/ui/`: React views. `src/ui/cloud/`: online saving (`config.ts` env check, `status.ts` status labels,
  `firebase.ts` Firebase + `ProjectRemote`, loaded lazily, `saver.ts` debounce, retries and status, `useCloud.ts` hook);
  `components/CloudStatus.tsx`, `ProjectsDialog.tsx`, `ConflictDialog.tsx` (the last two lazy).
- `firestore.rules`, `firebase.json`, `.env.example`: Firebase security rules and config (see *Cloud save setup*).
- `samples/`: the sample sizing table (`sizing_table_ysolda_cm.csv`, and `.json` with the same data).
- `src/engine/fixtures/`: test data: the old sample table, and schema-1 and schema-2 project files.

## Expression syntax

Waypoint dimensions and custom measurements are expressions. They evaluate to **centimetres**.

| Feature | Example |
|---|---|
| Numbers (cm) | `12.5`, `.5` |
| Unit suffixes | `2in`, `2 in`, `2"`, `15mm`, `3cm` |
| Measurements | `upper_chest`, `cross_back`, `back_neck_width`; fit names such as `bust`, `hem_circ`, `shoulder_w` (see Templates) |
| Gauge | `row_h` (height of one row), `st_w` (width of one stitch), e.g. `underarm.height + 2 * row_h` |
| Dotted names | `ease.bust` |
| Operators | `+ - * / ^` and parentheses; `^` is right-associative; unary minus binds looser than `^` (`-2^2 = -4`) |
| Functions | `min(a, b, …)`, `max(a, b, …)`, `abs(x)`, `sqrt(x)`, `round(x[, step])`, `floor(x[, step])`, `ceil(x[, step])`, `clamp(x, lo, hi)` |
| Armhole | `armhole_len`: the armhole a sleeve is sewn into (see Templates) |
| Cuff band | `cuff_depth`: the cuff rib knit with the sleeves (cm; 0 when it is picked up later or off); see Sleeve lengths |
| Cardigan bands | `band_w` (front band width), `band_overlap`, `closing_r` (width taken off the whole front); 0 without bands (see Cardigan bands and buttons) |
| Joined edges | `edge_len` (cm), `edge_rows`, `edge_pickup` (sts at the join's ratio): the edges a strip is joined to, e.g. a band's `edge_pickup * st_w` |
| Contiguous yoke | `yoke.back_w`, `yoke.front_w`, `yoke.sleeve_w` (held stitches + underarm cast-on share, cm), `yoke.underarm_co` (cm), `yoke.depth` (neck to split, cm); see Contiguous yoke |

Examples:

```
upper_chest/2 + ease/4
(bust - upper_chest) * 0.5
max(back_neck_width, 15) + 1in
round(cross_back * 0.45, 0.5)
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
   A boat neck takes most of its width off at once and shapes only its corners (see *Boat neck* below).
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
- a dragged **width** multiplies its expression, `(cross_back_w + 1) * 1.18`; repeated drags fold into one factor.

**Choose which sizes follow** with *Drags change: …* in the schematic header (a view setting, all sizes by default):
tick the sizes that should follow the drag. Unticked sizes keep their values: the dragged waypoint (and its linked
partner) gets a per-size fixed value in those sizes, at the value it had before the drag; sizes that already had a
fixed value keep it. *This size only* unticks every other size.

Hold **Alt** while dragging to change **this size only** (a per-size fixed value). Typed formulas are replaced when
you drag (the old one stays in undo).

**Linked panels** (Panel → *Linked panel*, e.g. Back ↔ Front, set by you): dragging a waypoint also moves the
waypoint **with the same name** on the linked panel **by the same amount** (the same rows in this size, then
proportionally in the others; widths by the same proportion), so differences you built in are kept. To line them up
instead, a linked waypoint's properties have *Make Front's armhole_end match this one: height / width / both*.

## Starting a garment

**New…** (toolbar) opens the **New garment** dialog; on first run (nothing saved in the browser) it opens over an
empty project. One screen, one undoable step (undo goes back to the project you had):

- **How it's built**: *Seamed panels, bottom-up* (back, front, sleeve; side and shoulder seams tagged),
  *Top-down, shoulders first* (back cast on at the shoulders, front picked up from it, underarms cast on half each,
  in the round below; sleeves top-down), *Contiguous yoke, top-down* (yoke from the back neck, then body and
  sleeves continuing from it), *Raglan, top-down* with a *Classic* / *Modified* choice (one card; see *Raglan yoke*),
  or *Start from blank* (no pieces).
- **Front**: pullover or cardigan (fronts split into a mirrored pair, bands and buttons).
- **Neckline** (round, V, square, boat; a boat neck sets the back's neck too; the modified raglan has no V, its short
  rows can't make one; *Off-shoulder* for the raglans, pullover only, see *Off-shoulder* below) and **sleeves** (set-in cap, drop shoulder, straight or none; yokes have their own sleeves:
  set-in look, or raglan).
- **Sleeve length**: long, three-quarter, elbow, short or cap sleeve (cap: set-in sleeves and a yoke's sleeves only).
  See *Sleeve lengths*.
- **Fit (ease)**: close (0 cm), standard (5), relaxed (10) or oversized (20) total ease, with bicep and wrist ease.
- **Edges**: hem, cuff, neckband and (cardigans) front bands on or off and their stitch; the neckband and band strips
  are made with the garment. Depths and the rest are in the Garment tab afterwards.
- **Sizes and gauge**: keep this project's sizing table, use the sample table, or import your own next.

*Open the sample project instead* opens the shipped sample (bottom-up back, front and set-in sleeve).

The left sidebar has three tabs:

- **Garment**: the same choices, editable later. Changing **how it's built** shows what it will replace, add and keep,
  and rebuilds the bodices, sleeves and yoke when you confirm (other pieces, sizes, gauge, ease and edges stay; one
  undo step). Changing the **sleeves** replaces the sleeve panels the same way (keeping their length where the new
type has it; a cap becomes short on drop-shoulder and straight sleeves). Changing the **sleeve length** sets every
sleeve's underarm height and cuff width in place (other edits kept; a contiguous yoke's sleeves too). The **neckline** resets the front neck
  (and a yoke's neck) to that shape's defaults in place. Also the edge treatments, tags and export credit.
- **Pieces**: the piece list, *Add a piece* (single pieces that fit the method: sleeve, back, front, rectangle,
  neckband strip; a contiguous garment offers rectangles and strips), and the **Joins** section.
- **Settings**: gauge, fit choices, region sizing, checks, ease (with the presets) and join settings (seam
  tolerance, pick-up ratio).

Nothing new is saved for this: the method, neckline and sleeves are read from the pieces (a sleeve's length is kept
on the sleeve panel, `sleeveLength`; absent = long) (`garmentChoice` in
`src/engine/garmentSetup.ts`), so older projects show theirs without a migration: a contiguous construction reads as
raglan when its yoke is a raglan (`yoke.style: 'raglan'`), modified raglan when the yoke starts with the whole neck
(`yoke.start: 'neck'`, the default for contiguous yokes made before raglan existed), else contiguous; top-down bodices as top-down, other bodices as seamed, and a project without bodices as *Custom*. The
method is shown by the project name, e.g. *Contiguous · cardigan*.

## Templates

Templates are starting points: everything they generate is an ordinary, editable panel. Add single pieces from the Pieces tab (it offers the pieces that fit the garment's method);
duplicate (⧉) or delete (×) any panel there. Options: knitting direction, neckline, sleeve type and length, and for bodices
"in the round below the underarm"; top-down bodices also have construction, shoulders and back neck.

| Template | Waypoints (bottom to top) | Notes |
|---|---|---|
| **Back** | hem `hem_circ/2 + ease/2` at 0 → waist `waist/2 + ease/2 − waist_shift` at `hem_drop` → underarm `upper_chest/2 + ease/2` at `waist.height + waist_to_underarm` → armhole_bo at `underarm.height + 2 * row_h` (40 % of the armhole width change bound off in one go: the beginning of the next 2 rows) → armhole_end `cross_back_w + 1` at `armhole_depth × 0.45` → shoulder `shoulder_w` at `underarm.height + armhole_depth` (increases from armhole_end: the *widen to the shoulder width* option, on by default; off = straight up at the armhole_end width) → neck_side `back_neck_width` at `shoulder.height + shoulder_drop` (shoulder slope in bind-off steps) | Round back neck, `back_neck_drop`, centre `back_neck_width − 2`. With a boat neckline: the boat neck's width, 2 cm deep (see *Boat neck*) |
| **Front** | as the back, waist `+ waist_shift`, underarm `+ bust_side_w`, armhole_end `cross_front + 1` (the same `shoulder_w` at the shoulder, so the shoulder seams match; without the widening the front ends at the back’s `cross_back_w + 1`) | Round: depth `front_neck_drop`, centre `back_neck_width × 0.4`. V: depth `front_neck_drop × 2`, no centre. Square: depth `front_neck_drop + 2`, whole width at once. Boat: `shoulder_w − 6` wide, 4 cm deep (see *Boat neck*) |
| **Sleeve, set-in** | cuff `wrist + ease.wrist` → underarm `bicep + ease.bicep` at `arm_length` → cap_bo 2 rows up (bind-off matching the body's, in one go) → cap_low → cap_high → cap_top `max(8, bicep × 0.22)`, its height **fitted to the armhole** | Bell cap: fast, steady, fast; cap decreases may fall on any row. 2x2 rib cuff section (5 cm) |
| **Sleeve, drop shoulder** | cuff → top `armhole_depth × 2` at `arm_length` | Ribbed cuff |
| **Sleeve, straight** | cuff = top `bicep + ease.bicep` | Rounded to the rib multiple so the count stays constant |
| **Plain rectangle** | bottom → top, 20 × 30 cm | |
| **Neckband strip** | `back_neck_width × 2 + front_neck_drop × 2` long (boat neck: `(shoulder_w − 6) × 2 + 6`), 2.5 cm deep, 1x1 rib | Length is an estimate until the pick-up helper |

**Boat neck.** A true boat neck reaches nearly to the shoulder edges, front and back alike:

- *Width* `shoulder_w − 6`: a 3 cm shoulder strap each side, graded with the shoulder width. Front and back have
  the same width (and the same top, `neck_side`), so the shoulder seams match.
- *Depth*, measured down from the top of the strap: front `4`, back `2` (cm). Each is an expression with per-size values
  (the neckline properties of each panel; on a yoke, *Front depth* and *Back depth*).
- *Shape*: gently curved. The centre `neck_w − 2 × min(3, neck_depth × 0.75)` is bound off (or held) at once and the
  last 3 cm each side are shaped (half every row, then every other row); the shallow back shapes
  `min(3, neck_depth × 0.5)` each side so its decreases fit its rows. `neck_w` and `neck_depth` are the opening's own
  width and depth.
- *Shoulder slope*: the strap slopes only its share of the shoulder drop, as the body's shoulder line does between the
  shoulder point and the neck: `neck_side` sits `shoulder_drop × (shoulder.width − neck_side.width) / (shoulder_w −
  back_neck_width)` above the shoulder line (about 1 cm for a 3 cm strap) instead of the whole `shoulder_drop`.
- *Top-down, shoulders first*: the back stays straight (cast on across the shoulders and the wide neck); only the front
  is shaped. A back (or top-down top) added in the Pieces tab with *Back neck: Shaped* and a boat neckline gets its
  2 cm too.
- *Contiguous yoke*: the wide neck is cast on across the back. The back depth replaces `back_neck_drop`: the
  whole-neck start's short rows raise the back by front depth − back depth (`round(max(0, neck_depth − back_depth) /
  row_h / 2)` pairs), and the back length from the neck to the underarm is `shoulder_drop × min(1, (shoulder_w −
  neck_w) / (shoulder_w − back_neck_width)) + armhole_depth − back_depth`. The shoulder phase is short (about 3 cm of
  seam), as a 3 cm strap is.
- Choosing *Boat* in the Garment tab sets the fronts, the back (and both tops) or the yoke to these defaults;
  choosing another shape puts the round back neck and the full shoulder slope back. Projects saved with the earlier,
  narrower boat neck (`back_neck_width + 6`) keep it until you choose *Boat* again.

**Set-in cap height follows the armhole.** `armhole_len` is the armhole the sleeve is sewn into, measured along the
edges: the other side of a seam join that contains one of the sleeve's edges, or else the Front + Back panels' left
armholes (underarm → shoulder), or, with no bodies at all, the body's `scye_circumference` (or, without it, an
estimate from `armhole_depth`; noted in the checks). The
cap top height solves `both cap edges ≈ armhole_len + cap_ease` (`cap_ease`, default 1.5 cm, is a graded measurement):
`cap_bo.height + sqrt(((armhole_len + cap_ease)/2 × 0.966 − bind-off run)² − horizontal run²)`; 0.966 allows for the
bell's curve. In the sample sizes the cap comes out 0.3–2.6 cm longer than the armhole; the seam check shows the exact figure.

### Sleeve lengths

Every sleeve that runs from a cuff to an underarm (set-in, drop shoulder, straight, a contiguous yoke's sleeves) can be
made at five lengths (`src/engine/sleeveLength.ts`). The length moves the underarm (drop / straight: the top) to its
height above the cuff, and sets the cuff's width on a straight taper from the underarm width to the long sleeve's cuff
(`wrist + ease.wrist`) at that length: `underarm.width + (wrist + ease.wrist − underarm.width) × length / arm_length`.
A straight sleeve keeps one width. The cap above the underarm is unchanged.

| Length | Underarm above the cuff | Cuff width | Measurement (estimate if the table lacks it) |
|---|---|---|---|
| **Long** | `arm_length` | `wrist + ease.wrist` | from the sizing table |
| **Three-quarter** | `three_quarter_length` | taper | `round(arm_length × 0.7, 0.5)` (mid forearm) |
| **Elbow** | `elbow_length` | taper | `round(arm_length × 0.42, 0.5)` |
| **Short** | `short_sleeve_length` | taper | `round(4 + bicep × 0.1, 0.5)` |
| **Cap sleeve** | `max(cuff_depth, 2 × row_h)` | the underarm width | none |

A **cap sleeve** is the full set-in cap with no underarm length: the cuff band, as wide as the underarm, then the cap
(contiguous: the band worked on the held sleeve stitches plus the underarm cast-on). `cuff_depth` is the cuff band knit
with the sleeves (Garment → Edges → Cuff ribbing; 0 when it is picked up later or off). Lengths include the cuff band.
The estimates are in the *sleeves* region for region sizing, and are seeded only when a sleeve uses them. Checks
(`sleeveChecks.ts`): a cuff band as long as the sleeve (warning) or more than half of it (note), shaping more often than
every other row, and shaping rows that fall in the cuff rib (notes). A raglan sleeve can use the same list: it needs a
`cuff` point under an `underarm` point (`withSleeveLength`).

**Fit choices** (Settings tab → *Fit*) pick sizing-table columns for names the templates use. They behave like
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

- **Cup** (project-wide; also under Settings → Fit): A/B, C/D, E/F, G/H, or a custom bust circumference
  (`bust_custom`, added on request, starting as the C/D column; type your values per size in the grid). `bust` follows
  the cup's column.
- **D** = `bust − upper_chest`.
- **W**, extra width over the bust = `(bust - upper_chest) * 1.0` → `bust_w`.
- **L**, extra centre-front length (short rows or horizontal dart) = `dart_height` → `bust_l`: the sizing table's
  suggested dart height for the cup (`dart_height_ab/cd/ef/gh`), which assumes some width is also added at the front.
- **Extra width added at the front** (toggle, on by default; short rows and horizontal darts). Off: W = 0, nothing is
  added at the side seams, and L comes from its own editable formula `dart_height + (bust - upper_chest) * 0.25`,
  longer because the length has to hold all the bust volume. Vertical darts always add width.
- `bust_side_w` = W when short rows or a horizontal dart also add width at the side seams (on by default); the front
  template's underarm width is `upper_chest / 2 + ease / 2 + bust_side_w`. With vertical darts, or "none", it is 0.
- With a custom bust, `dart_height` and `apex_to_apex` come per size from the cup whose typical bust − upper chest
  (A/B 5, C/D 7.5, E/F 10, G/H 12.5 cm) is closest; the helper says which.

The bust point: height `shoulder.height + shoulder_drop − (hps_to_apex − bust_apex_corr)` (the HPS level minus HPS to
apex), distance from centre front `apex_to_apex / 2`, where `apex_to_apex` is the cup's column (A/B → `apex_to_apex_b`,
C/D → `_d`, E/F → `_f`, G/H → `_h`). `bust_apex_corr` is an editable **vertical correction**, starting estimate
`hps_to_apex * 0.05`: HPS to apex is measured over the bust, so it is a little longer than the vertical drop (0 = use
it as measured). A project measurement named `bust`, `dart_height` or `apex_to_apex` (e.g. an estimate from an older
project) wins over the cup's column; the helper points this out and can remove it. *Use the sizing-table defaults*
resets W, L, the no-width L, the bust point and its correction to the formulas above (per-size values are kept).

| Method | What it does |
|---|---|
| **Short rows** | `round(L × rows/cm ÷ 2)` pairs (German or wrap & turn), a stepped wedge centred vertically on the bust point. Turns are spread evenly across a zone centred on each bust point (default width `max(6, bust_l × 2.5)` cm, never closer than 2 sts to centre front), each row shorter or each row longer. The first short row is a RS row. |
| **Short rows, bust point → side seam** | Same method with *Turns span: Bust point → side seam* (and usually *Start: At the bust point*). The first turn is at the bust point; each later one is `step` stitches further towards the side seam, where `step` = stitches between the bust point and the side (less a 2-st margin) ÷ turns per side, rounded down. Top-down: start right after the bust-point row, each row longer. Bottom-up mirror: start near the side seam, each row shorter, finishing at the bust-point row. The preset button sets all of this (and German short rows) for the panel's direction. If the turns don't fit (step < 1 st), you're told to shorten L or stack a second dart. |
| **Horizontal dart** | Knitted horizontal darts are short rows: turns run from the side seam (or just below the underarm) to a tip that stops short of the bust point (default 2.5 cm). Drawn with dart legs. |
| **Vertical darts** | Two darts on lines through the bust points. Each adds W/2, 2 stitches per shaping row (one each side of the dart line). They open from `waist.height` to 2 cm below the bust point and close from 2 cm above it to `underarm.height + armhole_depth × 0.5`. When RS rows run out, the shaping moves to every row (noted). The schematic widens accordingly. |

**Outermost turn: sts from the side edge** (short rows and horizontal darts): blank = automatic (2 sts in; bust point
→ side seam stops one step before the edge, as in the method above). A number puts the outermost turn exactly that
many stitches from the side edge and spaces the turns evenly from the bust point to it; **0** turns right at the side
seam (flat rows keep at least 1 st). The *bust point → side seam* preset sets 0, so the short rows reach the side seams.

In the saved file these are `bust.shortRows.span` (`"zone"` | `"apex-to-side"`), `bust.shortRows.start`
(`"centred"` | `"apex"`) and `bust.shortRows.edgeSts` (number or null), all optional (default zone, centred, automatic). The schematic wedge is drawn in working order over
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

## Garment options

The **Garment** tab sets two options that combine freely (schema 3; older projects load as Panels + Closed, and
the upgrade says so):

| | Panels | Contiguous, top-down |
|---|---|---|
| **Closed / pullover** | the panels you draw (the original behaviour) | a contiguous yoke, joined in the round at the neck; back, front and sleeves in the round |
| **Cardigan** | each front becomes a mirrored Left / Right front pair; body flat | the yoke stays open at centre front; back, Left / Right fronts and sleeves flat |

Nothing is made or removed behind your back: switching an option never adds panels. Cardigan splits each front into a
pair (and Closed merges it back), and **Add strips** / **Add yoke, body and sleeves** make the strips and the
contiguous panels when you ask. The contiguous construction adds the project tag *contiguous* (removed again when you
switch back) and the export credit (above).

**Formulas confirmed while building these options** (each is an editable expression with per-size values):

| Decision | Formula / default |
|---|---|
| Shoulder seam (phase A) | until the back, after the markers move, is `cross_back_w + 1` (the cross back is followed; the back shoulder width is a style option): rows = (target + 2·k − back neck − phase B increases) / 2, k = (cap top − seam) / 2. Option: the sloped length `sqrt(((back_shoulder_width − back_neck_width)/2)² + shoulder_drop²)` − shorten (0) + extra rows (0) |
| Back neck increases (phase B) | during phase A, 2 per row on RS rows 1–7 (the first 8 rows), spread evenly and symmetrically, offset half a gap each row; positions per size by hand |
| Pullover front neck | R = front neck depth × row gauge, made a RS row; increases per side = (back neck − centre) / 2 with centre = 0.4 × `back_neck_width` (round); cast on back neck − 2 × increases at the end of row R and join |
| Underarm cast-on | `underarm_co` each side, with body increases low in the armhole bringing the body to `upper_chest + ease`; without them, (body target − yoke body) / 2 |
| Split | `shoulder_drop + armhole_depth − back_neck_drop` from the neck, deepened until the sleeve reaches `bicep + ease.bicep` with at most half the armhole rows rapid |
| Cardigan closing width | each front = (whole front − `closing_r`) / 2, `closing_r = 2 × band_w − band_overlap`, overlap = band width |

## Cardigan fronts

Garment tab → **Front: Cardigan** splits every front (template *front*) into a **Left front** and a
**Right front**, and works the body flat (a back that was joined in the round becomes flat; sleeves keep their own
choice). Switching back to *Closed* merges each pair into one front again. The app lists what it changed.

- **One description, two halves.** Each front's waypoints, segments, neckline and bust shaping describe the *whole*
  front, as if closed at centre front; the panel is the wearer's left or right half of it. So necklines (round, V,
  square, boat), bust shaping, princess and shaping lines all work as on a pullover front. Seen from the RS, the left
  front's front edge is its left edge, the right front's its right edge.
- **Front edge.** Straight, with its own selvedge (*Front-edge selvedge*, default 1). The neckline's centre
  stitches are taken at the front edge: bottom-up *bind off 8 sts at the front edge, then −11 at the neck edge*;
  top-down *+11 at the neck edge, then cast on 8 sts at the front edge* (the fronts are never joined).
- **Rounding.** Each front is rounded on its own: its half width, to the pattern multiple (e.g. a 2×2 rib hem gives
  4n + 2 sts between the selvedges on each front), plus both selvedges. Parity doesn't apply; the whole front is
  always even.
- **Bust short rows** turn at the side edge only: each pair is a turning row worked from the front edge towards the
  side and a return row back (the left front turns on WS rows, the right front on RS rows).
- **Mirrored pair.** An edit to either front is copied to the other (names, layout, notes and links stay each
  front's own). **Unlink** in the panel properties to edit them separately; *mirror with…* relinks by copying.
- **Joins** follow the split: the front's left side edge belongs to the right front, its right side edge to the
  left front; lower edge, top and neckline joins go to both fronts.
- **Checks:** the armhole (`armhole_len`, scye check) is measured on a front's side edge; hem totals add both fronts.

## Edge treatments

The Garment tab's **Edges** section sets the hem ribbing, cuff ribbing, neckband and (cardigans) front bands for the whole project.
Each can be switched off and has a height (band width for neck and front bands, an expression with per-size values),
a stitch (1×1 rib = 2n, 2×2 rib = 4n + 2, garter, seed = 2n + 1, or a custom multiple + offset) and how it is worked:

| | Knit with the panel | Added later |
|---|---|---|
| Hem | a *Hem rib* pattern section at the lower edge of the back and fronts | a pick-up join on their lower edges |
| Cuff | a *Cuff rib* section on the sleeves | a pick-up join on the sleeves' lower edges |
| Neckband | an off-shoulder neckline only: the band, knit first with the yoke, single or folded; untick it for no band (see *Off-shoulder*) | a *Neckband* strip, picked up from every neckline |
| Front bands | integrated: extra stitches at each front edge | picked up, or knit sideways and sewn on (per band, see below) |

Changing any setting applies them to the panels you have; things made by a treatment are marked (`edge`) and
replaced the next time, so nothing is duplicated. **Settings never add or remove panels.** Strips (the neckband,
front band strips) are made only with **Add strips** in the Garment tab's Edges, which lists what the settings call for
that doesn't exist yet. Once made, a strip follows the settings (same panel, updated in place). A strip the settings
no longer call for (neckband switched off, a band that became integrated or continuous, a cardigan turned pullover)
is kept, with a note in the Checks bar so you can delete it. Sections you add by hand are left alone, except the templates' *Hem rib* / *Cuff rib*, which
the treatment takes over. New panels pick up the settings once you have changed them. Defaults: hem off, cuff 2×2
rib 5 cm with the sleeve, neckband 1×1 rib 2.5 cm added later, front bands 1×1 rib 2.5 cm added later.

## Cardigan bands and buttons

With a cardigan and **Front bands** switched on (Garment tab → Edges), the front bands are made from these settings:

- **Bands:** separate button and buttonhole bands, or **one continuous band** up the right front, around the back
  neck and down the left front (the back neck counts only when the back has a neckline; a neckband switched on at the
  same time is flagged).
- **Buttonholes on:** the right front (default) or the left.
- **Attachment, per band:**
  - *Picked up* along the edge: a strip whose width is `edge_pickup * st_w`, i.e. the pick-up helper's count at
    the join's ratio (default 3 sts per 4 rows), rounded to the band's multiple; worked for `band_w` (rows = band
    width × row gauge). A pick-up join from the front edge(s) to the strip's lower edge.
  - *Knit sideways* and sewn on: `band_w` across and `edge_len` long (rows = edge length × row gauge). A seam join
    between the front edge and the strip's side.
  - *Integrated:* no strip; each front gets `band_w` of extra stitches (rounded to the band's multiple) between its
    front-edge selvedge and the body, shown as a stripe on the chart. The neck takes them off with its centre stitches.
- **Band width** is the front bands' width (Edges); **overlap** (`band_overlap`, default `band_w`) is how far the
  fronts overlap when closed.

**Closing width.** Each front = (whole front − `closing_r`) / 2, with `closing_r = 2 × band_w − band_overlap` (an
editable expression with per-size values). Closed, the two fronts plus both bands less the overlap make the whole
front: 2 × (F − 2w + o)/2 + 2w − o = F. With 2.5 cm bands fully overlapping, `closing_r` = 2.5 cm, so in M the hem
is (62.75 − 2.5) / 2 = 30.13 cm per front. Integrated bands add their stitches on top. The settings show the formula
with this size's numbers plugged in. The cut at the front edge is a whole number of stitches; each front's body is
then rounded to its pattern multiple as before.

**Buttons:** a count, the distance from the top of the front edge (where the neck starts) to the first button, and
from the lower edge to the last; evenly spaced in between. Drag a button on either front's schematic to move it in
that size (the size then keeps its own positions; *Space evenly again* resets it). Positions become:

| Buttonhole band | Buttonholes worked |
|---|---|
| Picked up | in the middle row of the band, at stitch positions along it (the lower-edge end is on the right for the right front and a continuous band, on the left for the left front) |
| Knit sideways | on the band row at the button's height, centred across the band |
| Integrated | on the front's row at the button's height, centred in the band stitches |

The **buttonhole** is a one-row *yo, k2tog* by default, or any symbol (built-in or yours) a number of stitches wide,
with a note. Charts show the buttonhole cells and mark each buttonhole row in the right margin; the schematic shows
the band beside each front (dashed; tinted when integrated), buttons (filled) on one front and slots on the other,
and the buttonholes on the band strip. The Layout shows the band strips upright beside the fronts.

**Checks:** a band shorter than 90 % or longer than 105 % of its edge; a pick-up count that doesn't fit the band's
multiple (with how many more or fewer to pick up); buttonholes within 2 rows of a picked-up band's edge, with less
than one band stitch either side, or closer than 2 sts / 4 rows to each other; buttons outside the front edge; and a
closed width short of the whole front by more than the seam tolerance.

## Contiguous yoke (generator)

The contiguous method was developed by Susie Myers (SusieM on Ravelry). `generateYoke` in `src/engine/contiguous.ts`
works a contiguous yoke row by row from its phase parameters (each an expression with per-size values). Cast on the
back neck (`back_neck_width` × stitch gauge) plus 6; row 1 (RS) is *edge · marker · seam · marker · back neck ·
marker · seam · marker · edge*. Zones, as seen from the RS: left front, left seam/sleeve, back, right seam/sleeve,
right front.

| Phase | Default | What happens |
|---|---|---|
| A, shoulders | until the back, after the markers move, is `cross_back_w + 1` (or *length* mode: `sqrt(((back_shoulder_width − back_neck_width)/2)² + shoulder_drop²)` − shorten) + extra rows (0) | 4 increases every row, one each side of each seam group (M1R before a marker, M1L after; or kfb/pfb, or a symbol) |
| B, back neck | 2 increases on RS rows 1–7 (the first 8 rows), during A | spread evenly and symmetrically across the back, offset half a gap each time; per-size positions by hand |
| Front neck | the neckline's depth (round: `front_neck_drop`), centre `back_neck_width × 0.4` | increases inside the edge stitch at each front edge; the neck opening at the top is the back neck, so the centre cast-on = back neck sts − 2 × increases per side. Pullover: cast on at the end of RS row R and join in the round. Cardigan: each front casts on (centre − `closing_r`) / 2 at its front edge |
| C, cap rapid | markers move so each cap top has 6 sts; rapid rows `armhole_depth / 6`, lengthened until the sleeve can reach its width | 4 increases every row, at both ends of each sleeve |
| D, cap slow | until the sleeve + underarm cast-on = `bicep + ease.bicep` | 4 increases every second row |
| E, armhole | split at `shoulder_drop + armhole_depth − back_neck_drop` from the neck (or *armhole* mode: `armhole_depth` below the seam end), plus extra depth (0 cm), deepened further until the cap is at most half rapid | straight, except body increases on the body side of the armhole markers in the lower 60 % of the armhole |
| F, split | underarm cast-on `underarm_co` each side; raised if the body increases don't fit | the sleeves are held; the body continues |

**Deepening.** The back-length split fits the body, but at a typical gauge the sleeve can't grow fast enough in a
short armhole (2 sts per sleeve per row at most). So the yoke is deepened a row at a time (up to 15 cm) until the
sleeve reaches its width with at most *Rapid rows at most* (default 0.5) of the armhole rows rapid: a middle way
between the back length (body fit) and `armhole_depth` below the seam end (sleeve fit). With the sample table at 22
× 30 that adds 1.3 cm (4XS) to 4 cm (M) to 9 cm (4X); allowing 0.6 / 0.67 / 0.75 rapid adds 3 / 2.3 / 1.7 cm in M and
7.3 / 6.3 / 5.3 cm in 4X. Switch deepening off to split exactly at the back length (a sleeve that falls short is
then a warning).

**The yoke panel.** *Contiguous yoke, top-down* (New garment, or the Garment tab's method) makes a panel that holds the phases (`Panel.yoke`) instead of
waypoints; its properties edit every phase (expressions with per-size values, numbers plugged in) and show the phase
table for this size (rows, stitches before → after, increases per row) and every size side by side (cast-on, rows
per phase, back length, underarm cast-on, held stitches). Removing a size clears its hand-placed back neck positions.

- **Seen from above.** Both the Schematic and the Chart show the yoke from above: the neck in the middle, each row a
  ring around it (spaced by the row height), each stitch an angle by its share of the ring. Back at the top, fronts at
  the bottom, the wearer's left sleeve on the right. Before a pullover's neck is joined (and on a cardigan, all the
  way) the ring is open at centre front. On a whole-neck start each short-row pair is drawn between its turns, so
  the neck steps down to centre front (turns marked DS). Where the fronts cast on at the neck, the edge follows that row round to
  centre front (the bottom of the neck), not a straight line across it. The cast-on is round the back neck (back neck,
  both shoulders' seam stitches and one front stitch each side); zoomed in, the view labels it, marks where row 1
  starts (a RS row starts at the right front edge, going clockwise seen from above) and names the row that closes the
  front neck. Scroll to zoom, drag to pan, F to fit; hover a stitch for its row, RS/WS,
  phase, zone and the per-zone counts. A key (top left) lists the cast-on, shoulder seam, cap height, the phase rings
  and the split. (The Layout still shows the yoke unrolled, each row as wide as its stitches.)
- **Schematic:** the five zones tinted (fronts green, seams/sleeves orange, back blue), the four markers as red lines
  from the neck out, the front edges, dashed rings at the end of A, C and D and where the neck is joined, and the
  held stitches at the split. Overlay draws every size's outline and markers at one scale; Grid shows every size.
- **Chart:** the same rings, one per row, with stitch boundaries when zoomed in; increases and cast-ons drawn at their
  stitches, symbols pointing away from the neck (the knitting direction); markers as bold red lines; cast-on marks round
  the neck; row numbers up centre back (row 1 next to the cast-on); the symbol legend (incl. *place marker on row 1, slip after*) at the bottom right.

**Body and sleeves.** *Add body and sleeves* (Pieces tab when a contiguous garment lacks them, or the yoke's
properties) adds the yoke if there is none and the panels it lacks, all top-down; it never runs on its own and adds
nothing a second time:

| Panel | Starts with (`underarm` width) | Below |
|---|---|---|
| Back | the yoke's back + half the underarm cast-on each side (`yoke.back_w`) | waist and hem as the bodice template |
| Front (pullover) | both fronts + the centre cast-on + half the cast-on each side (`yoke.front_w`) | the same, with bust shaping |
| Left / Right front (cardigan) | each front + its half of the cast-on; `yoke.front_w` describes the whole front, so each half rounds to exactly that | a mirrored pair, as in Panels mode |
| Left / right sleeve | the held sleeve + the whole underarm cast-on (`yoke.sleeve_w`) | tapering to `wrist + ease.wrist` at `arm_length` |

Pullovers work the body and sleeves in the round, cardigans flat (each panel's *Worked* setting can be changed). The
panels use *Stitch count: Same as the first row* (parity of the waypoint the panel starts from), so every change
below the yoke is even and both sides shape in pairs; where a rib's even multiple fixes a count (a 2×2 hem or
cuff) the rib wins and the one odd change is a note, not a warning. Selvedges are 0: the stitches continue from the
yoke.
Joins record it: *Body continues from the yoke* and *Left/Right sleeve continues from the yoke* (live stitches, from
the yoke's held edges: a new edge kind `{ "kind": "held", "part": "leftSleeve" | "body" | "rightSleeve" }`), and
*Underarm cast-on*. Change the yoke and the body and sleeves follow in every size.

**Start.** A contiguous-shaped yoke starts one of two ways, and each is its own method (change it in the Garment tab;
the yoke's properties say which it is):

- **The whole neck, short rows raise the back** = the **modified raglan** method (PetiteKnit style; no V neck): cast on left front,
  seam, back neck, seam, right front. The fronts are cast on as wide as the neck (*Front cast-on*, `neck_w` = the
  neck width; per size). German short rows raise the back above the front: *pairs* = (front neck depth −
  `back_neck_drop`) ÷ row height ÷ 2, the first turn *first* sts past each front shoulder marker, each next turn
  *step* sts nearer centre front (by default spread from the first turn to the neck's centre part). No back neck
  increases and no front neck increases. A pullover is joined at the cast-on with the round starting at the left back
  shoulder marker: row 1 (RS) runs from there to the first turn, rows 2 to 2 × pairs go turn to turn, and the next
  row runs from the last turn back to the marker; those two half rows make no increases (the shoulders get one more
  row instead). Rounds follow. A cardigan is flat throughout: row 1 starts at the right front edge, the last
  short-row row ends at the left front edge. The neck edge is the cast-on; a cardigan's front edges run from the
  short rows to the split. Without back neck increases the shoulder seam is a few rows longer to reach the cross
  back.
- **The back neck only** = the **contiguous** method (as the method's PDF, and every yoke saved before the choice
  existed): below.

**Front neck (back neck start).** The yoke's neck uses the neckline shapes (round, V, square, boat) worked top-down: increases at each
front edge (inside the edge stitch), then a cast-on. The neck opening at the top is cast on across the back (the
fronts begin at the neck points), so its *width* is the back neck: `back_neck_width`, or `shoulder_w − 6` for a
boat neck (out to a 3 cm strap, so the shoulder seams are short). *Width*, *depth* and *centre* are expressions with
per-size values; yokes saved before the width existed keep `back_neck_width`. A boat neck also has a *back depth*
(see *Boat neck*).
The properties show the numbers, e.g. M, round: *Neck row R = depth × row gauge = 8.5 × 3 = 25.5 → 26 → row 27
(a RS row)*; *increases at each front edge = (neck width − centre) / 2 = (33 − 13) / 2 = 10*; then

- **pullover:** cast on the centre (13 sts) at the end of row R and join in the round; the yoke is in rounds after;
- **cardigan:** each front casts on (centre − `closing_r`) / 2 at its front edge (the right front on row R, the left
  front on row R + 1) and the fronts stay open, flat to the split.

V is all increases (no centre, or one stitch), square all centre, boat wide and shallow, mostly centre. A neck that would close
below the split is an error.

**Cardigan edges on a contiguous yoke.** The yoke has a neck edge (cast-on, two neck slopes, and the centre or
front-edge cast-ons) and, on a cardigan, a left and a right front edge (`{ "kind": "front", "side": "left" }`) from
the neck cast-on down to the split. The neckband is picked up around the yoke's neck; a band runs up the front
panel's edge and on up the yoke's front edge to the neck (a continuous band: up the right front, around the yoke
neck, down the left). Buttons are spaced over the whole front edge, hem to neck: those above the front panels are
drawn on the yoke's top view, at the front edges, and can be dragged there. Integrated bands aren't worked into a
contiguous yoke yet (a warning says so).

**Checks.** For a contiguous garment the Checks bar adds, per size:

- *info:* the back and the fronts (with the neck between them) at the end of the shoulders, against `cross_back_w`
  and `cross_front` (the back follows the cross back by design; this shows how close);
- *warning:* the sleeve at the underarm (held sleeve + underarm cast-on) less than `bicep + ease.bicep` by more than
  the seam tolerance (info when it is more than 10 % over);
- *warning:* around the armhole (both armhole edges along the yoke, the cap top and the underarm cast-on) less than
  `scye_circumference` (info when more than 15 % over: a deep armhole). With the sample table this flags 4XS–XS,
  where the back-length split makes a shallow yoke;
- *hint (info):* the cap may look pointy when the shoulder seam has more than twice as many rows as the rapid cap;
  *the cap may look flat* when most armhole rows are rapid;
- *warning:* a body or sleeve panel that no longer starts with the held stitches plus the underarm cast-on (after
  editing its widths);
- from the generator: rows that don't fit (shoulders, armhole, neck below the split, body increases), zero or
  negative counts, the sleeve or body not reaching its width, odd cap tops, and how far the yoke was deepened.

**Bust from the top.** The front's bust point is `underarm.height + yoke.depth − (hps_to_apex − bust_apex_corr)` up
from the hem: measured down from the neck point, where the fronts begin. Short rows add the length; the bust helper
doesn't add side width at the underarm (the yoke sets it).

Body increases bring the body at the underarm (cast-ons included) to `upper_chest + ease`; without them the underarm
cast-on is (body target − yoke body) / 2. The result lists every row's zone counts, increases (with positions and
symbols), cast-ons and marker moves, a phase table, the held edges, and warnings (e.g. a sleeve that can't reach its
width, a cap that is mostly rapid, a neck that closes below the split).


## Raglan yoke (generator)

*Raglan, top-down → Classic* (New garment, or the Garment tab's method) makes a yoke with `yoke.style: 'raglan'`,
worked by `generateRaglan` in `src/engine/raglan.ts`. It gives the same rows and result as the contiguous yoke, so the
top view, chart, body and sleeves from the held stitches (`yoke.*` names), joins and checks all work on it. Top-down
only; a pullover joins in the round at the neck, a cardigan stays flat.

| | Default | What happens |
|---|---|---|
| Cast-on | back neck (`back_neck_width`, or the neckline's width), each sleeve top `back_neck_width / 3` between its two raglan lines (2 sts each), 1 front st each side | row 1 (RS) places the four markers and makes the first increases |
| Raglan lines | 2 sts (k2), M1R before / M1L after (or kfb, or any symbol, e.g. a yarn over) | the body increases just outside each line (fronts and back, 4 sts a row), the sleeves just inside (2 sts each a row) |
| Front neck | as the contiguous yoke: increases at each front edge, then the centre cast-on (pullover: join in the round; cardigan: each front casts on at its edge). Or *the whole neck, short rows raise the back* (no V) | worked out by the contiguous generator, so both yokes shape the neck the same way |
| Depth | `shoulder_drop + armhole_depth − back_neck_drop` (back length, neck to underarm) + extra (0 cm) | the split row |
| Rates | body to `upper_chest + ease`, sleeve to `bicep + ease.bicep`, both less the underarm cast-on (`underarm_co`) | each side's increase rows: every other row (RS rows / every other round), spread from row 1 down to the split; where that isn't enough, the rows between are added, spread evenly; where even every row isn't, the underarm cast-on is raised (a note) |

The properties show the rows for this size (body and sleeve increase rows, how many are extra), the cast-on
breakdown, the split, the raglan line's length, and every size side by side. **Checks**: the body at the split
against its target (more than 2 sts off is a warning), a split higher than `armhole_depth` below the shoulder (may
bind), and as for every yoke: the sleeve against bicep + ease, and the body and sleeves starting with the held
stitches plus the underarm cast-on. The contiguous checks for the cross back, cross front, scye and cap shape don't
apply to a raglan.

**Modified raglan** (*Raglan, top-down → Modified*) is the contiguous yoke with the whole-neck start: the whole neck
cast on, German short rows raising the back, then the shoulder and sleeve-cap phases (see *Contiguous yoke*). Its
yoke has no `style` and `start: 'neck'`; contiguous projects saved with that start open as modified raglan.

### Off-shoulder

*Off-shoulder* is a neckline of the raglans (New garment, the Garment tab, or the yoke's *Neck → Shape*), pullover
only for now (the cardigan front is disabled while it is chosen). The opening sits below the shoulders and around the
upper arms: a rib band is cast on all round and knit first, an increase round takes it up to the ring, and four raglan
lines run from there to the underarms. Under both cards it is a raglan-line yoke (`yoke.style: 'raglan'`,
`neck.shape: 'off-shoulder'`, settings in `yoke.offShoulder`): *Classic* keeps the band level, *Modified* raises the
back 2 cm with German short rows after the increase round. Nothing else is stored: a back raise other than 0 reads
back as Modified, 0 as Classic (the same garment either way).

| | Default | What happens |
|---|---|---|
| Measurements | `off_shoulder_circ` = `round(upper_chest + bicep × 0.6, 0.5)`, `off_shoulder_drop` = 5 cm (estimates, added when you choose it) | arms down, around both upper arms and the torso at band height; the shoulder point down to the band's top edge. Measure the circumference: the band and ring come from it (an info check says so while it is an estimate) |
| Band | the **Neckband** edge, set to *knit with the panels*, 1×1 rib, 4 cm when you choose off-shoulder; `bandEase` −10 % | `off_shoulder_circ × (1 + bandEase)` sts (a multiple of the stitch), rows 1 to the band's depth, in the round, no increases |
| Increase round | `ringEase` 0 % | the row after the band: up to `off_shoulder_circ × (1 + ringEase)`, spread evenly in each zone |
| Ring | `armArc` = `bicep × 0.5` per sleeve | each sleeve zone is the arm arc plus its two raglan lines; the rest is half front, half back |
| Back raise | 0 (Classic) / 2 cm (Modified) | short-row pairs from the back raise (editable: pairs, first turn, step), turning in the fronts |
| No band | off (*Band: Single*) | *Band: None* (or untick the **Neckband** edge): the ring is cast on as the top edge, with no band rows and no increase round; the raglan (and a back raise's short rows) start on row 1, and the depth is unchanged. Only the ring ease holds it up (an info check says so). A neckband set to *picked up later* still gets the 4 cm rib band |
| Folded band | off (*Band: Single*); folded = purl turning round, knit closed | *Band: Folded* (Garment tab → Neckband, or the yoke's Off-shoulder part): stockinette, the depth is the **finished** band, worked as that many rows of facing, a turning round (purl, or picot: yo, k2tog, an even count) and as many rows outside; the outside's last round knits each stitch together with its cast-on loop (*knit closed*), or the facing is sewn down (*sewn*). Same band ease; no elastic |
| Depth | `armhole_depth − off_shoulder_drop + back_raise` (band top to underarm at the back) | the band and the increase round count inside it (a folded band's facing and turning round are added on top: they fold inside); the rates are solved as for the classic raglan |

Choosing off-shoulder pre-sets the neckband and removes a neckband strip (and its pick-up join); choosing another
neckline goes back to the default neckband and makes the strip again. The yoke's properties have an *Off-shoulder*
part (the two measurements with a link to them, band ease, ring ease, arm arc, back raise and the short rows), and the
rows table lists the band, the increase round and the raglan. The top view draws the band as a tinted ring and the
ring after the increase round as a solid line (*ring … sts*); the chart shows the band's rib (k1, p1 for 1×1 rib, its
repeat in the gutter), the increase round (*Inc*) and the raglan rows; the flat panel marks the band as a section and
the ring as a landmark. **Checks**: band ease above −5 % (may slide down) or below −20 % (too tight over the arms), a
band wider than the ring, body zones at or below 0 (arm arc too big), less than 4 cm between the band and the underarm
at the front, a cardigan (errors), and the raglan's split higher than `armhole_depth` measured from the band. Every
sleeve length works, cap to long. A folded band shows its facing, turning round and outside in the rows table and
the chart (*Facing*, *Turn*, *Band*; the joining round as *k-CO*), every row as a ring in the top view's chart, and the
band folded (from its turning round) in the top view's schematic. Later: an i-cord edge. See
`docs/off-shoulder-plan.md`.

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
measured as drawn, bind-off steps as horizontal runs), and the difference. Differences above the tolerance (Settings tab,
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

## Region sizing (upper body, lower body, sleeves)

Off by default. Turn it on under Settings → *Region sizing*; the toolbar then shows **Upper body / Lower body /
Sleeves** pickers for the current size. Each region of each size follows the size itself until you pick another one
(e.g. size M with the lower body from L). Turning region sizing off keeps the choices for later.

- Regions come from the measurement dictionary. **Upper body**: upper chest, bust, cross back/front, shoulders, neck,
  armhole, scye, HPS to apex, bust darts, and back waist length. **Lower body**: waist, high hip, hip/seat, waist to
  hip lengths. **Sleeves**: bicep, wrist, arm length. Any measurement's region can be changed in its properties (custom
  measurements default to upper body). Fit names follow their column (`hem_circ` is lower body).
- A size's own manual values still win. Otherwise each measurement comes from its region's size (manual, table or rule
  there); formula measurements such as `waist_shift` are worked out over the mixed values. Grid cells taken from
  another size have a blue corner and say so on hover.
- **Shaping between regions** is ordinary waypoint shaping: the waypoints' widths come from different sizes, so the
  segment between them increases or decreases the difference. The schematic shades every segment that runs between
  regions with different sizes and labels it in knitting order, e.g. *lower body L → upper body M: decrease 2 sts each
  side* (bottom-up, size M in the sample) or *upper body M → lower body 1X: increase … sts each side* (top-down). A waypoint's region is the
  region of the measurements in its width (through other waypoints' widths; formula measurements only count when
  nothing else does), so the waist (`waist / 2 + ease / 2 − waist_shift`) is lower body and the sleeve cap's lower part,
  sized from the body's armhole, is upper body + sleeves.
- Sizes are labelled with their mix everywhere: *M · lower L* in the toolbar, overlay legend, grid and layout.
- The zigzag check uses each size's own values.

**Custom sizes** (Measurements → Sizes → *Custom size*): a one-off size such as "me", seeded from any table row. The
row's values become **manual values** of the new size (the existing per-size overrides, so you type over them in the
grid), its per-size panel overrides are copied, and formulas recompute. Custom sizes are marked *custom*, are left out
of the zigzag check, count as their row when comparing sizes, and can use region sizing like any size.

## Checks from the sizing data

Shown in the check panel with everything else (`src/engine/fitChecks.ts`). Settings are under Settings → *Checks*.

| Check | When | Severity |
|---|---|---|
| Lower body far from the upper body | Region sizing on and a size's lower body is more than **2** table sizes (editable) from its upper body; custom sizes count as their seed row | warning |
| More shaping than the rows allow, where regions meet | A segment between regions with different sizes can't fit its increases/decreases; restates the panel's own error with the sizes that meet there | error |
| Hem narrower than bust + ease | **Off by default.** The Back + Front hem widths (or an in-the-round body's) add up to less than the chosen bust plus `ease`: it may not pull over the bust. With the high-hip hem and C/D it flags most sizes by 1–2.5 cm | warning |
| Armhole shorter than the scye | Front + Back armhole edges (underarm → shoulder) are shorter than `scye_circumference` | warning |
| Neckband shorter than the neck base | A neckband strip is shorter than `neck_base` | warning |

The sample garment (Back, Front, set-in Sleeve, Neckband) has no warnings in any size with the defaults.

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

## Project JSON (schema version 3)

Saved files are `*.knitbit.json`. All lengths are in cm, whatever the display units. Top level:

```jsonc
{
  "schemaVersion": 3,
  "id": "project_…", "name": "My top",
  "units": "metric" | "imperial",              // display only
  "gauge": { "stitches": 22, "rows": 30, "basis": "10cm" | "4in" },
  "sizes": [{ "id": "size_…", "name": "M",       // in grading order
              "estimated": true,                  // optional: the table row is an estimate
              "regions": { "lower": "size_…" },   // optional: region sizing (upper | lower | sleeves → size id)
              "custom": { "seededFrom": "M" } }], // optional: a one-off size ("me")
  "baseSizeId": "size_…",
  "measurements": [{
    "name": "bust_cd_cup", "label": "Bust (C/D cup)", "kind": "circumference" | "length",
    "rule": { "type": "none" }
          | { "type": "increment", "baseValue": 122, "defaultStep": 10, "steps": { "<sizeId>": 12 } }
          | { "type": "expression", "expr": "cross_back + 3" },
    "table":  { "<sizeId>": 122 },              // imported values
    "manual": { "<sizeId>": 126 },              // overrides
    "estimate": true, "note": "…",              // optional
    "region": "upper" | "lower" | "sleeves"     // optional: overrides the dictionary's region
  }],
  "ease": { "global": 5, "per": { "bust": 8 } },
  "fit": { "cup": "cd",                        // which bust column `bust` follows: ab | cd | ef | gh | custom (bust_custom)
           "hem": "high_hip",                  // optional: high_hip | hip_seat_straight | hip_seat_curvy
           "broadBack": false },               // optional
  "garment": { "construction": "panels" | "contiguous",   // contiguous = top-down contiguous yoke (generator)
               "opening": "closed" | "cardigan" },
  "tags": ["contiguous"],                      // free-form; "contiguous" is added/removed with that construction
  "edges": { "hem": Edge, "cuff": Edge, "neckband": Edge, "frontBands": Edge },   // optional (see Edge treatments)
  "cardigan": {                                // optional (see Cardigan bands and buttons)
    "bands": "separate" | "continuous",
    "attach": { "button": "pickup" | "sideways" | "integrated", "buttonhole": …, "continuous": "pickup" | "sideways" },
    "buttonholeSide": "right" | "left",
    "overlap": Dim, "closing": Dim,            // band_overlap, closing_r
    "buttons": { "count": 7, "top": Dim, "bottom": Dim, "manual": { "<sizeId>": [46.2, 38.8, …] } },
    "buttonhole": { "style": "yo-k2tog" | "symbol", "symbol": "buttonhole", "width": 2, "note": "" }
  },
  "panels": [Panel],
  "joins": [Join],                             // optional
  "symbols": [{ "id": "custom_…", "label": "Twisted decrease", "abbr": "tw",
                "color": "#f2d17a", "change": -1 }],   // optional: your own chart symbols
  "settings": { "seamToleranceCm": 1, "pickUp": { "stitches": 3, "rows": 4 },
                "regionSizing": false, "regionGapLimit": 2, "hemCheck": false,   // these three optional
                "exportCredit": true },        // optional: credit line in export footers (absent = on)
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
  "rounding": { "parity": "any" | "even" | "odd" | "start", "rowParity": "any" | "even" | "odd" },   // start = same as the first row
  "pattern": { "name": "stockinette", "multiple": 1, "offset": 0 },
  "sections": [{ "id": "…", "name": "Hem rib", "fromHeight": Dim, "toHeight": Dim, "pattern": { … },
                 "edge": "hem" }],               // edge optional: made by an edge treatment
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
  "bust": null | {                              // optional; front panels (see Bust shaping)
    "method": "shortrows" | "horizontal-dart" | "vertical-dart" | "none",
    "width": Dim, "length": Dim, "frontWidth": true, "lengthNoWidth": Dim,   // frontWidth, lengthNoWidth optional
    "sideWidth": true, "apexHeight": Dim, "apexOffset": Dim, "apexCorrection": Dim,   // apexCorrection optional
    "shortRows": { "style": "german", "pairs": null, "order": "shortening", "zoneWidth": Dim,
                   "span": "zone", "start": "centred", "edgeSts": null },              // last three optional
    "dart": { "placement": "side" | "underarm", "tipGap": Dim },
    "vertical": { "bottom": Dim, "gap": Dim, "top": Dim },
    "manual": { "<sizeId>": { "left": [3, 6], "right": [3, 6], "incRows": [], "decRows": [] } }
  },
  "princess": null | { "position": Dim, "sides": "both" | "one" },   // optional
  "freeStitches": [{ "id": "st_…", "sizeId": "size_…", "row": 40, "x": -8.5,      // optional; x = cell's left edge
                     "symbol": "k2tog", "mirror": true }],                       //   in sts from the row's centre
  "shapingLines": [{ "id": "line_…", "name": "Dart",                               // optional
                     "from": { "height": Dim, "x": Dim }, "to": { "height": Dim, "x": Dim },
                     "amount": Dim, "kind": "one-way" | "fisheye", "sides": "both" | "one",
                     "rowSide": "rs" | "any", "mirror": true, "manual": { "<sizeId>": [12, 16] } }],
  "startFrom": "caston" | "pickup",            // optional: how the first row is made (top-down fronts: pickup)
  "linkedTo": "panel_…" | null,                // optional: linked panel (waypoint drags follow by name)
  "half": null | { "side": "left" | "right",   // optional: a cardigan front (dimensions = the whole front)
                   "pair": "panel_…" | null,     //   the mirrored other front; null = unlinked
                   "cfSelvedge": 0-2 },
  "edge": "neckband",                          // optional: made by an edge treatment
  "band": "button" | "buttonhole" | "continuous",   // optional: a cardigan band strip
  "yoke": null | YokeSpec,                     // optional: a contiguous yoke (see Contiguous yoke)
  "fromYoke": "back" | "front" | "leftSleeve" | "rightSleeve",   // optional: continues from the yoke
  "layout": { "x": 0, "y": 0, "rotation": 0 | 90 | 180 | 270 },
  "notes": ""
}
```

`Dim` is `{ "expr": "upper_chest/2 + ease/4", "overrides": { "<sizeId>": 60 } }`: an expression plus per-size fixed values.

`Edge` is `{ "enabled": true, "depth": Dim, "stitch": "rib1x1" | "rib2x2" | "garter" | "seed" | "custom",
"custom": { "name": "custom", "multiple": 2, "offset": 0 }, "method": "with-panel" | "later" }`. Joins made by an
edge treatment carry `"edge": "hem" | "cuff" | "neckband" | "frontBands"`. Join edges may also be
`{ "kind": "front" }`: a cardigan front's straight front edge, from the lower edge up to the neck.

`Method` is one of:
- `{ "kind": "auto", "side": "rs"|"ws"|"any", "align": "end"|"start"|"center", "order": "spread"|"shortFirst"|"longFirst", "rhythm": {"type":"auto"} | {"type":"fixed","every":4} | {"type":"mixed","a":4,"b":6}, "perSide": 1 }`
- `{ "kind": "steps", "steps": [4,3,2] | null, "maxPerStep": 4 }` for bind-off/cast-on steps (`null` = auto)
- `{ "kind": "shortrows", "steps": … | null, "maxPerStep": 5, "style": "wrap-turn"|"german" }`
- `{ "kind": "straight" }`

New optional fields don't change the schema version; incompatible changes bump `schemaVersion` and add a migration
(schema 2 renamed measurements for the Ysolda table and added `fit`; schema 3 added `garment` and `tags`).

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

**Schema 2 → 3** (garment options, `src/engine/garment.ts`): adds `garment` = Panels + Closed / pullover (how every
older project was built) and an empty `tags` list, and reports both. Nothing else changes: panels, joins,
measurements and settings load as they were. The export credit setting is absent, which means on. Tests in
`src/engine/garment.test.ts` load `src/engine/fixtures/project_v2.json` (a top-down top + sleeve at schema 2) and the
schema-1 fixture, which goes through both migrations.

### Auto-save

Every change is saved to `localStorage` (`knitbit.autosave.v1`) after a short pause, and restored on start. If the
auto-save can't be read, the app starts from the sample table and says why. Save to a file for anything you want
to keep, or sign in to save online (*Saving online*). Auto-save is only a safety net.

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

#### Columns

`size` (the size name) and `source` (`table` or `estimated`), then these body measurements, all in cm. *Region* is the
body region used by region sizing. The definitions are the tooltips shown in the app.

**Circumference**

| Column | Region | Definition |
|---|---|---|
| `upper_chest` | upper | Circumference of the chest at underarm level. |
| `bust_ab_cup` | upper | Circumference at the fullest part of the bust, for cup size A/B. Cup sizes are based on modern bra cup sizing. |
| `bust_cd_cup` | upper | Circumference at the fullest part of the bust, for cup size C/D. Cup sizes are based on modern bra cup sizing. |
| `bust_ef_cup` | upper | Circumference at the fullest part of the bust, for cup size E/F. Cup sizes are based on modern bra cup sizing. |
| `bust_gh_cup` | upper | Circumference at the fullest part of the bust, for cup size G/H. Cup sizes are based on modern bra cup sizing. |
| `waist` | lower | Circumference at the natural waist. |
| `high_hip` | lower | Circumference at about the level of the hip bones. |
| `hip_seat_straight` | lower | Circumference at the fullest part of the seat, for a straighter figure. |
| `hip_seat_curvy` | lower | Circumference at the fullest part of the seat, for a curvier figure. |
| `neck_base` | upper | Circumference around the base of the neck. Used as a check for neckbands. |
| `shoulder_girth` | upper | Circumference measure of the shoulder area. |
| `scye_circumference` | upper | From the underarm to the shoulder point and back to the underarm. A sanity check for set-in sleeves. |
| `bicep` | sleeves | Circumference at the largest part of the upper arm. |
| `wrist` | sleeves | Circumference at the wrist bone. Garments need wearing ease here so the cuff fits over the hand. |

**Widths**

| Column | Region | Definition |
|---|---|---|
| `back_neck_width` | upper | Straight across between where the neck meets the shoulder on each side. HPS = high point shoulder, where the side of the neck meets the shoulder. |
| `back_shoulder_width` | upper | Between the shoulder points, straight across the back. |
| `back_shoulder_width_broad` | upper | Between the shoulder points, straight across the back, for a broader back. |
| `cross_back` | upper | Width across the back between the break points (the top of the arm/torso crease). |
| `cross_back_broad` | upper | Width across the back between the break points (the top of the arm/torso crease), for a broader back. |
| `cross_front` | upper | Width across the front between the break points (the top of the arm/torso crease). |

**Lengths and drops**

| Column | Region | Definition |
|---|---|---|
| `hps_to_apex` | upper | From the HPS to the bust apex. HPS = high point shoulder, where the side of the neck meets the shoulder. |
| `back_waist_length` | upper | From the cervical bone at the back of the neck to the waist. |
| `armhole_depth` | upper | Vertical distance from the shoulder point to the underarm. |
| `shoulder_drop` | upper | Vertical distance from the HPS level down to the shoulder point. HPS = high point shoulder, where the side of the neck meets the shoulder. |
| `back_neck_drop` | upper | Vertical distance from the HPS level down to the cervical bone. HPS = high point shoulder, where the side of the neck meets the shoulder. |
| `front_neck_drop` | upper | Vertical distance from the HPS level down to the collarbone at centre front. HPS = high point shoulder, where the side of the neck meets the shoulder. |
| `waist_to_high_hip` | lower | From the waist to the high hip, measured at the side of the body. |
| `waist_to_full_hip` | lower | From the waist to the full hip (seat), measured at the side of the body. |
| `arm_length` | sleeves | From the underarm to the wrist with the arm straight. |

**Bust shaping**

| Column | Region | Definition |
|---|---|---|
| `dart_height_ab` | upper | Suggested height to add with horizontal bust darts for cup size A/B, based on volume and assuming some width is also added at the front. |
| `dart_height_cd` | upper | Suggested height to add with horizontal bust darts for cup size C/D, based on volume and assuming some width is also added at the front. |
| `dart_height_ef` | upper | Suggested height to add with horizontal bust darts for cup size E/F, based on volume and assuming some width is also added at the front. |
| `dart_height_gh` | upper | Suggested height to add with horizontal bust darts for cup size G/H, based on volume and assuming some width is also added at the front. |
| `apex_to_apex_b` | upper | Horizontal width between the bust apexes, for cup size B. |
| `apex_to_apex_d` | upper | Horizontal width between the bust apexes, for cup size D. |
| `apex_to_apex_f` | upper | Horizontal width between the bust apexes, for cup size F. |
| `apex_to_apex_h` | upper | Horizontal width between the bust apexes, for cup size H. |

**Legacy (reference only)**

| Column | Region | Definition |
|---|---|---|
| `legacy_bust_merged` | upper | From the old sizing table, kept for reference only. Not used in calculations. |
| `legacy_full_hip` | lower | From the old sizing table, kept for reference only. Not used in calculations. |
| `legacy_cross_chest_back` | upper | From the old sizing table, kept for reference only. Not used in calculations. |
| `legacy_waist_to_armhole` | upper | From the old sizing table, kept for reference only. Not used in calculations. |

**CSV** (comma, semicolon or tab separated; quoted fields allowed; a header row is required):

```csv
size,source,upper_chest,bust_ab_cup,bust_cd_cup,…,waist,high_hip,…
4XS,estimated,63.5,68.5,71,…,58.5,70,…
M,table,114.5,119.5,122,…,109.25,120.5,…
```

**JSON**, in any of these shapes:

```json
[{ "size": "M", "upper_chest": 114.5, "waist": 109.25 }, …]
{ "sizes": [{ "size": "M", "upper_chest": 114.5 }, …] }
{ "M": { "upper_chest": 114.5, "waist": 109.25 }, "L": { … } }
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
