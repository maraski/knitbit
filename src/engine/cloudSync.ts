// Online project sync: decides whether to upload, download, do nothing or report a conflict.
// No Firebase here. The online store is the `ProjectRemote` interface (see docs/cloud-save-plan.md), tested with an
// in-memory fake (testRemote.ts). Projects travel as serialized text so loadProject's migrations and checks still apply.

import { newId, type Project } from './model';
import { loadProject, serializeProject } from './schema';
import type { KVStorage } from './autosave';

// ---------- the online store ----------

/** One stored project, as text. `updatedAt` is the server's time, used only for equality (it's an opaque token). */
export interface RemoteDoc {
  id: string;
  name: string;
  schema: number; // project.schemaVersion when it was saved
  data: string; // serializeProject(project)
  updatedAt: string;
}

/** A list entry. `editedAt` is when it was last saved online (ms since epoch), for display; null if unknown. */
export type RemoteSummary = Pick<RemoteDoc, 'id' | 'name' | 'updatedAt'> & { editedAt: number | null };

export type SaveResult =
  | { ok: true; updatedAt: string }
  /** The stored updatedAt was not `ifUpdatedAt`: someone else saved in between (null = there is no stored copy). */
  | { ok: false; conflict: true; currentUpdatedAt: string | null };

export interface ProjectRemote {
  /** Projects of the signed-in user, without deleted ones. */
  list(): Promise<RemoteSummary[]>;
  /** null when there is no such project or it was deleted. */
  get(id: string): Promise<RemoteDoc | null>;
  /**
   * Saves only if the stored copy's updatedAt is still `ifUpdatedAt`; null means the project must not exist yet
   * (a deleted project still exists, so it can't be saved under the same id again).
   */
  save(doc: Omit<RemoteDoc, 'updatedAt'>, ifUpdatedAt: string | null): Promise<SaveResult>;
  /** Soft delete: the project leaves `list` and `get` but is kept for a while. */
  remove(id: string): Promise<void>;
}

export function toRemoteDoc(project: Project): Omit<RemoteDoc, 'updatedAt'> {
  return { id: project.id, name: project.name, schema: project.schemaVersion, data: serializeProject(project) };
}

// ---------- what this device last saw online ----------

/**
 * Written after every successful upload or download. `fingerprint` identifies the project content that was in sync,
 * so the device can tell whether its own copy changed since, whatever its auto-save timestamps say.
 */
export interface SyncMarker {
  projectId: string;
  remoteUpdatedAt: string;
  fingerprint: string;
}

export function fingerprint(project: Project): string {
  // FNV-1a over the serialized text, plus its length. Only compared with itself, never stored online.
  const text = serializeProject(project);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}-${text.length}`;
}

export function markerFor(project: Project, remoteUpdatedAt: string): SyncMarker {
  return { projectId: project.id, remoteUpdatedAt, fingerprint: fingerprint(project) };
}

export const SYNC_MARKER_KEY = 'knitbit.syncMarker.v1';

export function readSyncMarker(storage: KVStorage): SyncMarker | null {
  try {
    const m = JSON.parse(storage.getItem(SYNC_MARKER_KEY) ?? 'null') as SyncMarker | null;
    return m && typeof m.projectId === 'string' && typeof m.remoteUpdatedAt === 'string' && typeof m.fingerprint === 'string' ? m : null;
  } catch {
    return null;
  }
}

export function writeSyncMarker(storage: KVStorage, marker: SyncMarker | null): void {
  try {
    if (marker) storage.setItem(SYNC_MARKER_KEY, JSON.stringify(marker));
    else storage.removeItem(SYNC_MARKER_KEY);
  } catch {
    /* ignore: at worst the next sync asks about a conflict that isn't one */
  }
}

// ---------- deciding ----------

/** The local auto-save (readAutosave's project and savedAt). */
export interface LocalCopy {
  project: Project;
  savedAt: string;
}

export type SyncDecision =
  | { action: 'nothing'; reason: string; marker: SyncMarker | null }
  | { action: 'upload'; reason: string; ifUpdatedAt: string | null }
  | { action: 'download'; reason: string; project: Project; marker: SyncMarker; notes: string[] }
  | { action: 'conflict'; reason: string; local: LocalCopy; remote: Project; remoteUpdatedAt: string }
  /** This device synced the project before, but it's gone online. Ask before uploading it again. */
  | { action: 'remote-deleted'; reason: string }
  /** The online copy can't be read by this app (newer schema, damaged). It is never overwritten. */
  | { action: 'blocked'; reason: string; errors: string[] };

/**
 * What to do with one project, given this device's copy (null = nothing local), the last-synced marker and the
 * online copy (null = none or deleted). Pure: performs nothing.
 */
export function decideSync(local: LocalCopy | null, marker: SyncMarker | null, remote: RemoteDoc | null): SyncDecision {
  const id = local?.project.id ?? remote?.id;
  const m = marker && marker.projectId === id ? marker : null;

  let remoteProject: Project | null = null;
  let notes: string[] = [];
  if (remote) {
    const r = loadProject(remote.data);
    if (!r.ok) {
      return { action: 'blocked', reason: `The online copy of "${remote.name}" can't be opened by this version of Knitbit, so it won't be overwritten.`, errors: r.errors };
    }
    remoteProject = r.project;
    notes = r.migrationNotes;
  }

  if (!local) {
    if (!remote || !remoteProject) return { action: 'nothing', reason: 'Nothing here or online.', marker: null };
    return { action: 'download', reason: 'Opening the online copy.', project: remoteProject, marker: markerFor(remoteProject, remote.updatedAt), notes };
  }

  if (!remote || !remoteProject) {
    if (m) return { action: 'remote-deleted', reason: `"${local.project.name}" was deleted online.` };
    return { action: 'upload', reason: `"${local.project.name}" isn't online yet.`, ifUpdatedAt: null };
  }

  // Same content on both sides (e.g. just downloaded and auto-saved again): only the marker needs refreshing.
  const localPrint = fingerprint(local.project);
  if (localPrint === fingerprint(remoteProject)) {
    return { action: 'nothing', reason: 'Already in sync.', marker: markerFor(local.project, remote.updatedAt) };
  }

  // Without a marker this device never synced this project, so both sides count as changed.
  const localChanged = !m || m.fingerprint !== localPrint;
  const remoteChanged = !m || m.remoteUpdatedAt !== remote.updatedAt;
  if (localChanged && remoteChanged) {
    return { action: 'conflict', reason: `"${local.project.name}" was changed on this device and online.`, local, remote: remoteProject, remoteUpdatedAt: remote.updatedAt };
  }
  if (localChanged) return { action: 'upload', reason: 'This device has newer changes.', ifUpdatedAt: remote.updatedAt };
  if (remoteChanged) return { action: 'download', reason: 'Another device saved newer changes.', project: remoteProject, marker: markerFor(remoteProject, remote.updatedAt), notes };
  // Unreachable in practice: neither side changed but the content differs (a fingerprint collision).
  return { action: 'nothing', reason: 'Already in sync.', marker: m };
}

// ---------- doing ----------

export type SyncOutcome =
  | { kind: 'in-sync'; marker: SyncMarker | null }
  | { kind: 'uploaded'; marker: SyncMarker }
  | { kind: 'downloaded'; project: Project; marker: SyncMarker; notes: string[] }
  | { kind: 'conflict'; local: LocalCopy; remote: Project | null; remoteUpdatedAt: string | null; message: string }
  | { kind: 'remote-deleted'; message: string }
  | { kind: 'blocked'; message: string; errors: string[] }
  /** `cause` is the thrown error, so callers can tell a network problem from a sign-in one. */
  | { kind: 'error'; message: string; cause?: unknown };

/** Fetches the online copy, decides, and uploads when that's the decision. Network errors become `error`, never throws. */
export async function syncProject(remote: ProjectRemote, local: LocalCopy | null, marker: SyncMarker | null, id = local?.project.id): Promise<SyncOutcome> {
  if (!id) return { kind: 'in-sync', marker: null };
  try {
    const d = decideSync(local, marker, await remote.get(id));
    switch (d.action) {
      case 'nothing':
        return { kind: 'in-sync', marker: d.marker };
      case 'download':
        return { kind: 'downloaded', project: d.project, marker: d.marker, notes: d.notes };
      case 'conflict':
        return { kind: 'conflict', local: d.local, remote: d.remote, remoteUpdatedAt: d.remoteUpdatedAt, message: d.reason };
      case 'remote-deleted':
        return { kind: 'remote-deleted', message: d.reason };
      case 'blocked':
        return { kind: 'blocked', message: d.reason, errors: d.errors };
      case 'upload':
        return await upload(remote, local!, d.ifUpdatedAt);
    }
  } catch (e) {
    return { kind: 'error', message: `Couldn't reach the online copy: ${(e as Error).message}`, cause: e };
  }
}

/** A save that lost the race with another device's save turns into a conflict carrying the newer online copy. */
async function upload(remote: ProjectRemote, local: LocalCopy, ifUpdatedAt: string | null): Promise<SyncOutcome> {
  const r = await remote.save(toRemoteDoc(local.project), ifUpdatedAt);
  if (r.ok) return { kind: 'uploaded', marker: markerFor(local.project, r.updatedAt) };
  const current = await remote.get(local.project.id);
  const loaded = current ? loadProject(current.data) : null;
  if (loaded && !loaded.ok) {
    return { kind: 'blocked', message: `The online copy of "${current!.name}" was just saved by a newer version of Knitbit, so it won't be overwritten.`, errors: loaded.errors };
  }
  return {
    kind: 'conflict',
    local,
    remote: loaded?.ok ? loaded.project : null,
    remoteUpdatedAt: r.currentUpdatedAt,
    message: `Another device saved "${local.project.name}" at the same time; nothing was overwritten.`,
  };
}

// ---------- resolving a conflict ----------

export type Resolution = 'keep-local' | 'keep-remote' | 'copy';

/**
 * keep-local: save this device's version over the online one (only if the online copy is still the one shown).
 * keep-remote: open the online version; nothing is written online.
 * copy: save this device's version online as a new project named "… (copy)", which becomes the open project; the
 * online original stays as it is.
 */
export async function resolveConflict(
  remote: ProjectRemote,
  conflict: Extract<SyncOutcome, { kind: 'conflict' }>,
  choice: Resolution,
): Promise<SyncOutcome> {
  try {
    switch (choice) {
      case 'keep-local':
        return await upload(remote, conflict.local, conflict.remoteUpdatedAt);
      case 'keep-remote':
        if (!conflict.remote || !conflict.remoteUpdatedAt) return { kind: 'error', message: 'There is no online version to keep.' };
        return { kind: 'downloaded', project: conflict.remote, marker: markerFor(conflict.remote, conflict.remoteUpdatedAt), notes: [] };
      case 'copy': {
        const copy = asCopy(conflict.local.project);
        const r = await remote.save(toRemoteDoc(copy), null);
        if (!r.ok) return { kind: 'error', message: `Couldn't save "${copy.name}" online.` };
        return { kind: 'downloaded', project: copy, marker: markerFor(copy, r.updatedAt), notes: [] };
      }
    }
  } catch (e) {
    return { kind: 'error', message: `Couldn't reach the online copy: ${(e as Error).message}`, cause: e };
  }
}

/** Same content under a new id and name. Also how a project deleted online is uploaded again. */
export function asCopy(project: Project, suffix = ' (copy)'): Project {
  return { ...project, id: newId('project'), name: project.name + suffix };
}
