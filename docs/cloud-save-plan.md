# Plan: projects saved online

Goal: sign in on any device and see your projects. No file downloading or uploading. Saving happens on its own.

## How saving works today

- **Auto-save** ([autosave.ts](../src/engine/autosave.ts), [store.ts](../src/ui/store.ts)) writes the current project to
  `localStorage` 400 ms after each edit. It keeps only that one project, in that one browser.
- **Save / Open…** ([fileio.ts](../src/ui/fileio.ts)) downloads `*.knitbit.json` and reads it back from a file you pick.
- `serializeProject` / `loadProject` ([schema.ts](../src/engine/schema.ts)) already turn a project into text and back,
  including upgrades from older schema versions. A project is about 50 kB of JSON.
- Each `Project` already has an `id`, `name` and `updatedAt`, which is everything needed to keep a list of projects and
  spot conflicts.
- HANDOFF.md calls the app "local-only (no auth, backend, hosting)". That line changes with this work.

## Recommendation: Firebase (Firestore + Google sign-in)

The app stays a static Vite site on Vercel. The browser talks straight to Firebase, so there's **no server code to
write or run**. Security rules make each signed-in user's projects readable and writable only by that user.

| Option | Good | Watch out for |
|---|---|---|
| **Firebase** (recommended) | One-click Google sign-in. Built-in offline cache, so edits made offline sync later. The free tier doesn't go to sleep. Limits (20k writes and 50k reads a day, 1 GiB stored) are far more than one knitter needs. | Google-owned. Firestore can't store arrays inside arrays, so the project is stored as one JSON string (see below). |
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

Security rules: you can read, create or update a project only if you are signed in and `owner == your user id`. A
new project's `owner` must be your user id, and `data` must be under 900 kB (Firestore's per-document limit is 1 MiB).

## Sync behaviour

1. **Local first.** The localStorage auto-save keeps working exactly as now, so nothing is lost offline or when signed out.
2. **Cloud save.** When you're signed in, the project is saved online about 2 s after you stop editing, and when the
   tab is hidden or closed. The save only goes through if the online copy hasn't changed since it was last read (a
   transaction on `updatedAt`).
3. **Conflict.** If another device saved in between, nothing is overwritten. A notice offers: keep this device's
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
- **Save** stays as **Download a copy** (`.knitbit.json`), useful as a backup.
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

1. Create a Firebase project. Enable **Authentication → Google** and **Firestore** (production mode).
2. Add the Vercel domain (and `localhost`) to the authorised domains under Authentication.
3. Add the web-app config to Vercel → Project → Settings → Environment Variables as `VITE_FIREBASE_API_KEY`,
   `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_APP_ID`. Copy them into `.env.local` for
   local dev (add it to `.gitignore`). These values are public by design. The security rules are what protect the data.
4. Deploy `firestore.rules` from the Firebase console or `firebase deploy --only firestore:rules`.

## Milestones

1. **Sync logic + tests**: `cloudSync.ts` and the in-memory fake. Covers conflict and offline cases. No UI yet.
2. **Sign-in + cloud save of the current project**: Firebase module (lazy), Google sign-in, debounced save, status
   label, security rules.
3. **Projects dialog**: list, open, rename, duplicate, delete. First-sign-in upload of the local project.
4. **Conflicts + offline**: conflict notice with its three choices, Firestore offline cache, save when the tab is
   hidden.
5. **Docs**: README section, HANDOFF goal/architecture update, setup steps.

## Open questions

- Only you, or other people too (sharing a project read-only by link)? Sharing adds a `viewers` list or a public flag
  to the rules. It's easy to add later if the data model stays as above.
- Google sign-in only, or also email magic link? Firebase supports both. Google only is less work.
- Keep version history (snapshots, for example daily), or only the latest copy? The latest copy plus a downloadable
  backup is the simple start.
