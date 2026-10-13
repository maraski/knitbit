// Safety-net auto-save to a key-value store (localStorage in the browser).
// Failures are reported, never thrown: storage may be full, disabled, or contain stale data.

import type { Project } from './model';
import { loadProject, serializeProject, type LoadResult } from './schema';

export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const AUTOSAVE_KEY = 'knitbit.autosave.v1';

export function writeAutosave(storage: KVStorage, project: Project): string | null {
  try {
    storage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), project: serializeProject(project) }));
    return null;
  } catch (e) {
    return `Auto-save failed: ${(e as Error).message}`;
  }
}

export type AutosaveRead = { found: false } | ({ found: true; savedAt: string } & LoadResult);

export function readAutosave(storage: KVStorage): AutosaveRead {
  let text: string | null;
  try {
    text = storage.getItem(AUTOSAVE_KEY);
  } catch {
    return { found: false };
  }
  if (!text) return { found: false };
  try {
    const { savedAt, project } = JSON.parse(text) as { savedAt: string; project: string };
    return { found: true, savedAt, ...loadProject(project) };
  } catch (e) {
    return { found: true, savedAt: '', ok: false, errors: [`Auto-save is unreadable: ${(e as Error).message}`] };
  }
}

export function clearAutosave(storage: KVStorage): void {
  try {
    storage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* ignore */
  }
}
