// Cloud saving of the open project, without React or Firebase: debounces edits, runs one sync at a time, keeps the
// sync marker and turns outcomes into a save status. useCloud.ts wires it to the app; saver.test.ts drives it with
// the in-memory remote and fake timers.
//
// Offline: Firestore lite has no offline cache, so nothing is queued here. Edits stay in the localStorage auto-save;
// while the browser is offline no save is attempted, and when it's back (retry) syncProject compares the open project
// with the online copy, which uploads offline edits or reports a conflict. Failed saves retry with backoff.

import type { KVStorage } from '../../engine/autosave';
import { shouldAskBeforeUpload } from '../../engine/cloudProjects';
import {
  fingerprint,
  markerFor,
  readSyncMarker,
  resolveConflict,
  syncProject,
  writeSyncMarker,
  type LocalCopy,
  type ProjectRemote,
  type RemoteSummary,
  type Resolution,
  type SyncOutcome,
} from '../../engine/cloudSync';
import type { Project } from '../../engine/model';
import { type CloudState } from './status';

export type { CloudState, CloudStatus, ConflictOutcome } from './status';

export interface SaverDeps {
  remote: ProjectRemote;
  /** Holds the sync marker (per account, see scopedStorage). */
  storage: KVStorage;
  isOnline: () => boolean;
  now: () => number;
  delayMs?: number;
  /** Waits before retrying failed saves: one per attempt, the last repeats. */
  retryDelaysMs?: readonly number[];
}

export interface SaverEvents {
  onState: (state: CloudState) => void;
  /**
   * Outcomes the app must act on: 'downloaded' (open the newer online copy), 'conflict', 'remote-deleted' and
   * 'blocked' (tell the knitter).
   */
  onOutcome: (outcome: SyncOutcome) => void;
  /**
   * start() found the open project isn't online yet while other projects are: the knitter chooses between
   * uploadNow() and opening an online project. Cloud saving of this project waits meanwhile.
   */
  onAskUpload?: (project: Project, online: RemoteSummary[]) => void;
}

export const SAVE_DELAY_MS = 2000;
export const RETRY_DELAYS_MS: readonly number[] = [2000, 5000, 15000, 60000];

/** Wait before retry number `attempt` (1 = the first retry). */
export function retryDelay(attempt: number, delays: readonly number[] = RETRY_DELAYS_MS): number {
  return delays[Math.min(Math.max(attempt, 1), delays.length) - 1];
}

/**
 * Why a save failed, from the thrown error. 'auth': refused for sign-in reasons, so retrying won't help.
 * 'network': no connection or the service is unreachable. Codes are Firebase's (Firestore and Auth).
 */
export function errorKind(cause: unknown): 'auth' | 'network' | 'other' {
  const code = String((cause as { code?: unknown } | null)?.code ?? '');
  if (/^(permission-denied|unauthenticated)$|^auth\/(user-token-expired|user-disabled|invalid-user-token|user-not-found|requires-recent-login)$/.test(code)) return 'auth';
  if (/^(unavailable|deadline-exceeded)$|^auth\/network-request-failed$/.test(code)) return 'network';
  // fetch() rejects with a TypeError when there is no connection.
  if (cause instanceof TypeError && /fetch|network|load failed/i.test(cause.message)) return 'network';
  return 'other';
}

const AUTH_MESSAGE = 'Online saving stopped: your sign-in ended (signed out on another device, or it expired). Edits are still saved on this device. Sign in again to keep saving online.';
const OFFLINE_MESSAGE = 'No connection. Edits are saved on this device and go online when the connection is back.';

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
    case 'error': {
      const kind = errorKind(outcome.cause);
      if (kind === 'auth') return { ...prev, status: 'auth', message: AUTH_MESSAGE, conflict: null };
      return online && kind !== 'network'
        ? { ...prev, status: 'error', message: outcome.message, conflict: null }
        : { ...prev, status: 'offline', message: outcome.message, conflict: null };
    }
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
  /** Projects deleted online from this device: never saved again (e.g. after undo brings one back). */
  private readonly dropped = new Set<string>();
  private disposed = false;
  /** Failed attempts in a row; the timer is a retry (not an edit's debounce) while this is above 0 and it's set. */
  private attempts = 0;
  private retrying = false;
  /** Saves were refused for sign-in reasons: nothing is sent until start() (signed in again). */
  private authBlocked = false;
  private resolving = false;
  private readonly deps: SaverDeps;
  private readonly events: SaverEvents;

  constructor(deps: SaverDeps, events: SaverEvents) {
    this.deps = deps;
    this.events = events;
  }

  get current(): CloudState {
    return this.state;
  }

  /**
   * Syncs now (sign-in, startup): may upload, download, or report a conflict. A project this device never synced is
   * only uploaded straight away when nothing else is online; otherwise onAskUpload decides.
   */
  async start(project: Project): Promise<void> {
    this.local = localCopy(project);
    this.pausedId = null;
    this.authBlocked = false;
    this.attempts = 0;
    this.cancelTimer();
    const m = readSyncMarker(this.deps.storage);
    if (this.events.onAskUpload && m?.projectId !== project.id) {
      let online: RemoteSummary[] | null = null;
      try {
        online = await this.deps.remote.list();
      } catch {
        /* the sync below reports the network problem */
      }
      if (this.disposed) return;
      // Still the same project (nothing else was opened while listing) and the knitter should choose.
      if (online && this.local?.project.id === project.id && shouldAskBeforeUpload(project.id, false, online)) {
        this.pausedId = project.id;
        this.cancelTimer();
        this.set({ ...this.state, status: 'not-uploaded', message: `"${project.name}" is only on this device.`, conflict: null });
        this.events.onAskUpload(project, online);
        return;
      }
    }
    return this.run();
  }

  /** "Upload this project": resumes cloud saving of the open project after onAskUpload. */
  uploadNow(): Promise<void> {
    if (this.disposed || !this.local) return Promise.resolve();
    this.pausedId = null;
    this.cancelTimer();
    return this.run();
  }

  /**
   * An online project was opened (Projects dialog): it is in sync as read, so record that before the app's change
   * arrives. Otherwise a project upgraded by loadProject would look changed on both sides.
   */
  opened(project: Project, remoteUpdatedAt: string): void {
    if (this.disposed) return;
    writeSyncMarker(this.deps.storage, markerFor(project, remoteUpdatedAt));
    this.local = localCopy(project);
    this.pausedId = null;
    this.cancelTimer();
    this.set({ status: 'saved', lastSavedAt: this.deps.now(), message: null, conflict: null });
  }

  /**
   * The project is being deleted online from this device: stop saving it, now and if it comes back through undo.
   * `on = false` takes that back (the delete failed).
   */
  forget(id: string, on = true): void {
    if (!on) {
      this.dropped.delete(id);
      return;
    }
    this.dropped.add(id);
    if (this.local?.project.id === id) this.cancelTimer();
  }

  /** The project changed: save it SAVE_DELAY_MS after the last change, unless it's already what's online. */
  changed(project: Project): void {
    if (this.disposed) return;
    this.local = localCopy(project);
    if (this.dropped.has(project.id)) {
      this.cancelTimer();
      return;
    }
    if (this.authBlocked) return; // kept on this device; start() syncs it after signing in again
    if (this.pausedId !== null) {
      if (this.pausedId === project.id) return;
      this.pausedId = null; // another project was opened: its conflict no longer applies
      if (this.state.conflict) this.set({ ...this.state, status: 'saving', message: null, conflict: null });
    }
    // A pending retry sends the latest edit anyway; a shorter debounce would only hit a failing service sooner.
    if (this.retrying && this.timer !== null) return;
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

  /** Back online: tries again now after 'offline' or 'error', and restarts the backoff. */
  retry(): Promise<void> {
    if (this.disposed || this.pausedId !== null || this.authBlocked || !this.local) return Promise.resolve();
    if (this.state.status !== 'offline' && this.state.status !== 'error') return Promise.resolve();
    this.attempts = 0;
    this.cancelTimer();
    return this.run();
  }

  /** The browser went offline: say so now rather than at the next save. */
  wentOffline(): void {
    if (this.disposed || this.pausedId !== null || this.authBlocked) return;
    if (this.state.status === 'saved') this.set({ ...this.state, status: 'offline', message: OFFLINE_MESSAGE });
  }

  /**
   * Answers the conflict in `current.conflict` (ConflictDialog). Edits made while it was open count as this device's
   * version. Returns the outcome: 'downloaded' means the app must open `project` (the online version, or the copy);
   * 'conflict' means another device saved again meanwhile (the state carries the newer one); 'error' leaves the
   * conflict as it was. Null when there was nothing to resolve.
   */
  async resolve(choice: Resolution): Promise<SyncOutcome | null> {
    const c = this.state.conflict;
    if (this.disposed || !c || this.resolving) return null;
    this.resolving = true;
    try {
      const local = this.local?.project.id === c.local.project.id ? this.local : c.local;
      const outcome = await resolveConflict(this.deps.remote, { ...c, local }, choice);
      // Disposed, or another project opened meanwhile: that project's saving has taken over.
      if (this.disposed || this.state.conflict !== c) return null;
      switch (outcome.kind) {
        case 'uploaded':
        case 'downloaded':
          writeSyncMarker(this.deps.storage, outcome.marker);
          if (outcome.kind === 'downloaded') this.local = localCopy(outcome.project);
          this.pausedId = null;
          this.attempts = 0;
          this.set(stateAfter(this.state, outcome, this.deps.isOnline(), this.deps.now()));
          // Edited while "keep this device's version" was on its way: save that too.
          if (outcome.kind === 'uploaded' && this.local && this.local !== local) this.changed(this.local.project);
          break;
        case 'conflict':
          this.set(stateAfter(this.state, outcome, this.deps.isOnline(), this.deps.now()));
          break;
        case 'blocked':
        case 'remote-deleted':
          this.set(stateAfter(this.state, outcome, this.deps.isOnline(), this.deps.now()));
          this.events.onOutcome(outcome);
          break;
        default:
          break; // 'error': the conflict stays for another try
      }
      return outcome;
    } finally {
      this.resolving = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.retrying = false;
  }

  private scheduleRetry(): void {
    this.cancelTimer();
    this.attempts++;
    this.retrying = true;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.retrying = false;
      void this.run();
    }, retryDelay(this.attempts, this.deps.retryDelaysMs));
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
        if (!sent || this.disposed || this.authBlocked || this.pausedId !== null || this.dropped.has(sent.project.id)) break;
        if (!this.deps.isOnline()) {
          // Nothing to try until the 'online' event (retry); the edit is in the local auto-save.
          this.cancelTimer();
          this.set({ ...this.state, status: 'offline', message: OFFLINE_MESSAGE, conflict: null });
          break;
        }
        this.set({ ...this.state, status: 'saving' });
        const outcome = await syncProject(this.deps.remote, sent, readSyncMarker(this.deps.storage));
        if (this.disposed) break;
        if (this.dropped.has(sent.project.id)) continue; // deleted while this sync was on its way
        if (outcome.kind === 'downloaded' && this.local !== sent) {
          // Edited while the online copy was on its way: keep the edits; the next save reports the conflict.
          this.again = true;
          continue;
        }
        if ('marker' in outcome && outcome.marker) writeSyncMarker(this.deps.storage, outcome.marker);
        if (pauses(outcome)) this.pausedId = sent.project.id;
        const online = this.deps.isOnline();
        this.set(stateAfter(this.state, outcome, online, this.deps.now()));
        if (outcome.kind !== 'error') this.attempts = 0;
        else if (this.state.status === 'auth') this.authBlocked = true;
        else if (online && !this.again) this.scheduleRetry(); // offline: the 'online' event retries

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
