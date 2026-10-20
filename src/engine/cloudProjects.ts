// The Projects dialog's online operations: list order, rename, duplicate, delete, and what opens after deleting
// the open project. No Firebase here: everything goes through ProjectRemote and is tested with MemoryRemote.

import { asCopy, toRemoteDoc, type ProjectRemote, type RemoteDoc, type RemoteSummary } from './cloudSync';
import type { Project } from './model';
import { loadProject, type LoadResult } from './schema';

/** Newest first; projects without a known edit time go last; ties by name. Returns a new array. */
export function sortProjects(list: RemoteSummary[]): RemoteSummary[] {
  return [...list].sort((a, b) => (b.editedAt ?? -Infinity) - (a.editedAt ?? -Infinity) || a.name.localeCompare(b.name));
}

export const MAX_NAME_LENGTH = 100;

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/** A project name as typed: trimmed, inner runs of spaces collapsed, not empty, not too long. */
export function checkName(typed: string): NameCheck {
  const name = typed.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Give the project a name.' };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: `Keep the name under ${MAX_NAME_LENGTH} characters.` };
  return { ok: true, name };
}

/** Reads an online project the way Open… reads a file (migrations, notices). null: gone or deleted meanwhile. */
export async function fetchProject(remote: ProjectRemote, id: string): Promise<{ doc: RemoteDoc; result: LoadResult } | null> {
  const doc = await remote.get(id);
  return doc ? { doc, result: loadProject(doc.data) } : null;
}

export type OpResult = { ok: true } | { ok: false; error: string };

/**
 * Renames a project that isn't open (the open one is renamed in the app, and its normal cloud save carries the new
 * name). Only saves if nobody changed the online copy since it was read.
 */
export async function renameOnline(remote: ProjectRemote, id: string, typed: string, now = new Date()): Promise<OpResult> {
  const check = checkName(typed);
  if (!check.ok) return check;
  const got = await fetchProject(remote, id);
  if (!got) return { ok: false, error: 'That project is no longer online.' };
  if (!got.result.ok) return { ok: false, error: "This version of Knitbit can't open that project, so it can't rename it." };
  const renamed: Project = { ...got.result.project, name: check.name, updatedAt: now.toISOString() };
  const r = await remote.save(toRemoteDoc(renamed), got.doc.updatedAt);
  return r.ok ? { ok: true } : { ok: false, error: 'Another device just changed that project. Try again.' };
}

/**
 * Saves a copy online as "… (copy)", under a new id. `local` is this device's version of the open project, which may
 * be newer than its online copy; other projects are copied from online.
 */
export async function duplicateOnline(remote: ProjectRemote, id: string, local?: Project): Promise<{ ok: true; project: Project } | { ok: false; error: string }> {
  let source = local?.id === id ? local : null;
  if (!source) {
    const got = await fetchProject(remote, id);
    if (!got) return { ok: false, error: 'That project is no longer online.' };
    if (!got.result.ok) return { ok: false, error: "This version of Knitbit can't open that project, so it can't copy it." };
    source = got.result.project;
  }
  const copy = asCopy(source);
  const r = await remote.save(toRemoteDoc(copy), null);
  return r.ok ? { ok: true, project: copy } : { ok: false, error: `Couldn't save "${copy.name}" online.` };
}

/**
 * After deleting the open project, the most recently edited remaining online project opens. Falling back to a fresh
 * sample instead would add a new "My top" online every time the open project is deleted. With nothing left online,
 * the app starts a fresh sample project (which then saves online like New).
 */
export type AfterDelete = { open: 'online'; id: string } | { open: 'sample' };

export function afterDeletingOpen(deletedId: string, remaining: RemoteSummary[]): AfterDelete {
  const next = sortProjects(remaining.filter((p) => p.id !== deletedId))[0];
  return next ? { open: 'online', id: next.id } : { open: 'sample' };
}

/**
 * Soft-deletes a project. If it was the open one, also returns what to open next and that project's online copy
 * (null for a fresh sample, or when it couldn't be read, in which case the sample opens too).
 */
export async function deleteOnline(
  remote: ProjectRemote,
  id: string,
  openId: string,
): Promise<{ next: null } | { next: AfterDelete; fetched: { doc: RemoteDoc; result: LoadResult } | null }> {
  await remote.remove(id);
  if (id !== openId) return { next: null };
  const next = afterDeletingOpen(id, await remote.list());
  if (next.open === 'sample') return { next, fetched: null };
  const fetched = await fetchProject(remote, next.id);
  return fetched?.result.ok ? { next, fetched } : { next: { open: 'sample' }, fetched: null };
}

/**
 * First sign-in (or any sync start): ask before uploading when the open project isn't online, this device never
 * synced it (no marker, otherwise it was deleted online and decideSync reports that) and other projects are online.
 * With nothing online, the project is uploaded as before.
 */
export function shouldAskBeforeUpload(projectId: string, hasMarker: boolean, online: RemoteSummary[]): boolean {
  if (hasMarker) return false;
  if (online.some((p) => p.id === projectId)) return false;
  return online.length > 0;
}
