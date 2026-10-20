# Plan: projects saved online

Goal: sign in on any device and see your projects. No file downloading or uploading. Saving happens on its own.

**Status: done (M1–M5).** Built as below, with the differences noted under each milestone. User-facing behaviour and
the owner's setup steps are in the README (*Saving online*, *Cloud save setup*); architecture in HANDOFF.md §1. Not
yet tested against a real Firebase project.

## How saving worked before this plan

- **Auto-save** ([autosave.ts](../src/engine/autosave.ts), [store.ts](../src/ui/store.ts)) writes the current project to
  `localStorage` 400 ms after each edit. It keeps only that one project, in that one browser.
- **Save / Open…** ([fileio.ts](../src/ui/fileio.ts)) downloads `*.knitbit.json` and reads it back from a file you pick.
- `serializeProject` / `loadProject` ([schema.ts](../src/engine/schema.ts)) already turn a project into text and back,
  including upgrades from older schema versions. A project is about 50 kB of JSON.
- Each `Project` already has an `id`, `name` and `updatedAt`, which is everything needed to keep a list of projects and
  spot conflicts.
- HANDOFF.md called the app "local-only (no auth, backend, hosting)". It now describes the optional Firebase layer.

## Recommendation: Firebase (Firestore + Google sign-in)

The app stays a static Vite site on Vercel. The browser talks straight to Firebase, so there's **no server code to
write or run**. Security rules make each signed-in user's projects readable and writable only by that user.

| Option | Good | Watch out for |
|---|---|---|
| **Firebase** (recommended) | One-click Google sign-in. Built-in offline cache, so edits made offline sync later (not used: the app uses Firestore lite, see milestone 4). The free tier doesn't go to sleep. Limits (20k writes and 50k reads a day, 1 GiB stored) are far more than one knitter needs. | Google-owned. Firestore can't store arrays inside arrays, so the project is stored as one JSON string (see below). |
| Supabase | Postgres, open source, connects to Vercel in one step. Email magic link or Google sign-in. | **Free projects pause after about a week without use** and have to be woken from the dashboard. That's a poor fit for a hobby tool you might not open for a few weeks. Pro plan is about $25 a month. |
| Vercel Functions + Neon/Blob + Auth.js | Everything stays on Vercel. | You'd write and maintain an API, sessions and auth yourself. The most code and the most to keep secure. |
| Google Drive files | Projects stay in your own Drive. | Google's OAuth verification, plus clumsier listing and conflict handling. Overkill for this. |

Free-tier figures come from third-party summaries as of October 2026. Check the official pricing pages before signing up.

## Data model

One Firestore collection, `projects/{projectId}`:

```
owner      : string    // Firebase user id
name       : string    // for the project list
data       : string    // serializeProject(project): keeps the existing migration path, avoids nested-array limits
schema     : number    // project.schemaVersion
updatedAt  : timestamp // server time, used for conflict checks
createdAt  : timestamp
deleted?   : timestamp // soft delete, kept 30 days
```

As built (M2): a `rev` field (a random token written by every save) is what the conditional save compares, because a
server timestamp isn't known inside the transaction; `updatedAt` is only shown ("last edited"). Soft-deleted documents
are kept but nothing purges them after 30 days yet.

Security rules: you can read, create or update a project only if you are signed in and `owner == your user id`. A
new project's `owner` must be your user id, and `data` must be under 900 kB (Firestore's per-document limit is 1 MiB).

## Sync behaviour

1. **Local first.** The localStorage auto-save keeps working exactly as now, so nothing is lost offline or when signed out.
2. **Cloud save.** When you're signed in, the project is saved online about 2 s after you stop editing, and when the
   tab is hidden or closed. The save only goes through if the online copy hasn't changed since it was last read (a
   transaction on `updatedAt`).
3. **Conflict.** If another device saved in between, nothing is overwritten. A dialog offers: keep this device's
   version, keep the online version, or save this one as a copy.
4. **Opening the app.** If you're signed in, the last project opens. If the local auto-save is newer than the online
   copy (for example, after editing offline), it's uploaded. If both changed, you get the conflict notice above.
5. **Signed out.** The app behaves exactly as it does today.

## UI

- Toolbar: a **Sign in with Google** button. Once signed in, it shows your avatar with a menu (Sign out).
- A save status next to the project name: "Saved online · just now", "Saving…", "Offline: saved on this device", or
  "Conflict".
- **Open…** becomes a **Projects** dialog that lists online projects (name, last edited) with Open, Rename,
  Duplicate and Delete. "Open from file…" stays there for `.knitbit.json` files.
- **Save** stays as **Download a copy** (`.knitbit.json`), useful as a backup. (As built, the button is still labelled **Save**, ⌘S.)
- The first time you sign in, the current local project is offered for upload.

## Code layout

- `src/engine/cloudSync.ts`: pure sync decisions with no Firebase in them. Given the local and online versions, it
  decides whether to upload, download or report a conflict. It depends on a `ProjectRemote` interface
  (`list / get / save(ifUpdatedAt) / remove`) and is tested with an in-memory fake, the same way `autosave.ts` takes
  `KVStorage`.
- `src/ui/cloud/firebase.ts`: the Firebase app, auth and `ProjectRemote` implementation. **Loaded lazily**, only when
  you sign in or are already signed in, so the first page load stays small. That builds on the code splitting just
  done.
- `src/ui/cloud/useCloud.ts`: a hook that combines sign-in state, the debounced save and the save status.
- `src/ui/components/ProjectsDialog.tsx`: the new project list.
- `firestore.rules` checked into the repo, plus a small rules test with the Firebase emulator (optional).

## Setup (done once, by you)

Superseded by the step-by-step guide in the README (*Cloud save setup*), which also covers Vercel environments,
redeploying and how to check it works. Summary:

1. Create a Firebase project. Enable **Authentication → Google** and **Firestore** (production mode).
2. Add the Vercel domain (and `localhost`) to the authorised domains under Authentication.
3. Add the web-app config to Vercel → Project → Settings → Environment Variables as `VITE_FIREBASE_API_KEY`,
   `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_APP_ID`. Copy them into `.env.local` for
   local dev (add it to `.gitignore`). These values are public by design. The security rules are what protect the data.
4. Deploy `firestore.rules` from the Firebase console or `firebase deploy --only firestore:rules`.

## Milestones

1. **Sync logic + tests**: `cloudSync.ts` and the in-memory fake. Covers conflict and offline cases. No UI yet.
   Done in `2d65e95`.
2. **Sign-in + cloud save of the current project**: Firebase module (lazy), Google sign-in, debounced save, status
   label, security rules. Done in `3f4df4b`; `59e23cd` switched to Firestore lite and leaner auth and moved the saver
   and sync code into the lazy chunk.
3. **Projects dialog**: list, open, rename, duplicate, delete. First-sign-in upload of the local project.
   Done in `ae782e6`: `ProjectsDialog.tsx` (lazy) with the operations in `src/engine/cloudProjects.ts`. At sign-in, a project this
   device never synced is uploaded straight away only when nothing else is online; otherwise the dialog asks
   (Upload this project, or open an online one; "Not now" keeps it on this device, status "Only on this device").
   Deleting the open project opens the most recently edited remaining one, or a fresh sample when none is left
   (a sample every time would add a new "My top" online after each delete).
4. **Conflicts + offline**: conflict dialog with its three choices, offline handling, save when the tab is hidden.
   Done in `49dc89d`: `ConflictDialog.tsx` (lazy, opened from `CloudStatus.tsx`) shows both versions' name and last-edited time
   and calls `CloudSaver.resolve` (M1's `resolveConflict`). Edits made while it's open count as this device's
   version; if another device saves again meanwhile, the dialog shows the newer conflict. "Keep the online version"
   and "Save as a copy" open the result with the store's `replace`, so undo goes back. "Decide later" leaves saving
   paused; clicking "Conflict" in the toolbar reopens it.

   **How offline works with Firestore lite.** The app uses `firebase/firestore/lite` (plain HTTPS requests) to keep
   the Firebase chunk about 200 kB instead of about 560 kB. Lite has **no offline cache and no write queue**, so the
   Firestore offline cache planned above is not used. Instead:
   - Edits always go to the localStorage auto-save first, so nothing depends on the network.
   - While `navigator.onLine` is false (or after the `offline` event) no save is attempted and the status reads
     "Offline: saved on this device". Saves that fail with a network error (`unavailable`, `deadline-exceeded`,
     a rejected `fetch`) show the same status.
   - Failed saves retry after 2 s, 5 s, 15 s, then every 60 s. Edits during the wait don't shorten it; the retry
     sends the latest edit. The `online` event retries at once and restarts the backoff.
   - A reconnect runs `syncProject`, which compares the open project with the online copy and the sync marker: it
     uploads offline edits, opens what another device saved, or reports a conflict if both changed.
   - When the tab is hidden or closed, a pending save (debounced or waiting for its retry) is sent at once. If that
     request doesn't finish before the page goes away, the edit is still in the local auto-save, and the next visit's
     startup sync uploads it.
   - Saves refused for sign-in reasons (`permission-denied`, `unauthenticated`, expired or revoked tokens) show
     "Sign in again to keep saving online" and are not retried. Clicking that status signs in again and resyncs.
   - Offline edits only live in this browser until they're uploaded: opening the project on another device before
     then shows the older online copy (and later a conflict, if both are edited).
   The logic is in `src/ui/cloud/saver.ts` and tested in `saver.test.ts` with the in-memory remote and fake timers.
5. **Docs**: README section, HANDOFF goal/architecture update, setup steps. Done in the M5 commit: README *Saving
   online* (for the knitter) and *Cloud save setup* (numbered owner guide with checks), HANDOFF §1/§2/§4, this status.

## Open questions

Decided for now: only you (no sharing), Google sign-in only, latest copy only (plus the downloaded `.knitbit.json` from Save). Still
open for later:

- Only you, or other people too (sharing a project read-only by link)? Sharing adds a `viewers` list or a public flag
  to the rules. It's easy to add later if the data model stays as above.
- Google sign-in only, or also email magic link? Firebase supports both. Google only is less work.
- Keep version history (snapshots, for example daily), or only the latest copy? The latest copy plus a downloadable
  backup is the simple start.
