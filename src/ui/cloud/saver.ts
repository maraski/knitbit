// Cloud saving of the open project, without React or Firebase: debounces edits, runs one sync at a time, keeps the
// sync marker and turns outcomes into a save status. useCloud.ts wires it to the app; saver.test.ts drives it with
// the in-memory remote and fake timers.

import type { KVStorage } from '../../engine/autosave';
import { fingerprint, readSyncMarker, syncProject, writeSyncMarker, type LocalCopy, type ProjectRemote, type SyncOutcome } from '../../engine/cloudSync';
import type { Project } from '../../engine/model';

export type CloudStatus = 'signed-out' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error';

export type ConflictOutcome = Extract<SyncOutcome, { kind: 'conflict' }>;

export interface CloudState {
  status: CloudStatus;
  /** When the project was last confirmed online (ms since epoch). */
  lastSavedAt: number | null;
  /** Detail for 'error' and 'offline' (shown as a tooltip). */
  message: string | null;
  /** The conflict to resolve (milestone 4); cloud saving of that project is paused meanwhile. */
  conflict: ConflictOutcome | null;
}

export const SIGNED_OUT: CloudState = { status: 'signed-out', lastSavedAt: null, message: null, conflict: null };

export interface SaverDeps {
  remote: ProjectRemote;
  /** Holds the sync marker (per account, see scopedStorage). */
  storage: KVStorage;
  isOnline: () => boolean;
  now: () => number;
  delayMs?: number;
}

export interface SaverEvents {
  onState: (state: CloudState) => void;
  /**
   * Outcomes the app must act on: 'downloaded' (open the newer online copy), 'conflict', 'remote-deleted' and
   * 'blocked' (tell the knitter).
   */
  onOutcome: (outcome: SyncOutcome) => void;
}

export const SAVE_DELAY_MS = 2000;

export function localCopy(project: Project): LocalCopy {
  return { project, savedAt: project.updatedAt };
}

/** The state after an outcome; pure. `paused` outcomes stop cloud saving of that project until it is reopened. */
export function stateAfter(prev: CloudState, outcome: SyncOutcome, online: boolean, now: number): CloudState {
  switch (outcome.kind) {
    case 'in-sync':
    case 'uploaded':
    case 'downloaded':
      return { status: 'saved', lastSavedAt: now, message: null, conflict: null };
    case 'conflict':
      return { ...prev, status: 'conflict', message: outcome.message, conflict: outcome };
    case 'remote-deleted':
    case 'blocked':
      return { ...prev, status: 'error', message: outcome.message, conflict: null };
    case 'error':
      return online
        ? { ...prev, status: 'error', message: outcome.message, conflict: null }
        : { ...prev, status: 'offline', message: outcome.message, conflict: null };
  }
}

function pauses(outcome: SyncOutcome): boolean {
  return outcome.kind === 'conflict' || outcome.kind === 'remote-deleted' || outcome.kind === 'blocked';
}

export class CloudSaver {
  private state: CloudState = { status: 'saving', lastSavedAt: null, message: null, conflict: null };
  private local: LocalCopy | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  /** Id of a project whose cloud saving stopped on a conflict, deletion or unreadable online copy. */
  private pausedId: string | null = null;
  private disposed = false;
  private readonly deps: SaverDeps;
  private readonly events: SaverEvents;

  constructor(deps: SaverDeps, events: SaverEvents) {
    this.deps = deps;
    this.events = events;
  }

  get current(): CloudState {
    return this.state;
  }

  /** Syncs now (sign-in, startup): may upload, download, or report a conflict. */
  start(project: Project): Promise<void> {
    this.local = localCopy(project);
    this.pausedId = null;
    this.cancelTimer();
    return this.run();
  }

  /** The project changed: save it SAVE_DELAY_MS after the last change, unless it's already what's online. */
  changed(project: Project): void {
    if (this.disposed) return;
    this.local = localCopy(project);
    if (this.pausedId !== null) {
      if (this.pausedId === project.id) return;
      this.pausedId = null; // another project was opened
    }
    this.cancelTimer();
    const m = readSyncMarker(this.deps.storage);
    if (m && m.projectId === project.id && m.fingerprint === fingerprint(project)) {
      if (this.state.status !== 'saving' && !this.running) this.set({ ...this.state, status: 'saved', message: null });
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.deps.delayMs ?? SAVE_DELAY_MS);
  }

  /** Saves a pending change right away (tab hidden or closing). */
  flush(): Promise<void> {
    if (this.timer === null) return this.running ?? Promise.resolve();
    this.cancelTimer();
    return this.run();
  }

  /** Tries again after 'offline' or 'error' (back online). */
  retry(): Promise<void> {
    if (this.disposed || this.pausedId !== null || !this.local) return Promise.resolve();
    if (this.state.status !== 'offline' && this.state.status !== 'error') return Promise.resolve();
    this.cancelTimer();
    return this.run();
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private set(state: CloudState): void {
    this.state = state;
    if (!this.disposed) this.events.onState(state);
  }

  private run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        const sent = this.local;
        if (!sent || this.disposed || this.pausedId !== null) break;
        this.set({ ...this.state, status: 'saving' });
        const outcome = await syncProject(this.deps.remote, sent, readSyncMarker(this.deps.storage));
        if (this.disposed) break;
        if (outcome.kind === 'downloaded' && this.local !== sent) {
          // Edited while the online copy was on its way: keep the edits; the next save reports the conflict.
          this.again = true;
          continue;
        }
        if ('marker' in outcome && outcome.marker) writeSyncMarker(this.deps.storage, outcome.marker);
        if (pauses(outcome)) this.pausedId = sent.project.id;
        this.set(stateAfter(this.state, outcome, this.deps.isOnline(), this.deps.now()));
        if (outcome.kind !== 'in-sync' && outcome.kind !== 'uploaded' && outcome.kind !== 'error') this.events.onOutcome(outcome);
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }
}

/** Keeps each account's sync marker apart, so signing in with another account never mixes them up. */
export function scopedStorage(storage: KVStorage, uid: string): KVStorage {
  const k = (key: string) => `${key}:${uid}`;
  return {
    getItem: (key) => storage.getItem(k(key)),
    setItem: (key, value) => storage.setItem(k(key), value),
    removeItem: (key) => storage.removeItem(k(key)),
  };
}

/** The toolbar's save status text. */
export function statusLabel(state: CloudState, now: number): string {
  switch (state.status) {
    case 'signed-out':
      return '';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return state.lastSavedAt === null ? 'Saved online' : `Saved online · ${ago(now - state.lastSavedAt, state.lastSavedAt)}`;
    case 'offline':
      return 'Offline: saved on this device';
    case 'conflict':
      return 'Conflict';
    case 'error':
      return 'Not saved online';
  }
}

function ago(ms: number, at: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
