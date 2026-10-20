// Save status shared by the toolbar and the saver. Kept apart from saver.ts so the main chunk doesn't carry the
// sync code, which loads with Firebase.

import type { SyncOutcome } from '../../engine/cloudSync';

/**
 * 'not-uploaded': the open project isn't online and the knitter hasn't chosen to upload it (first sign-in).
 * 'auth': saves are refused for sign-in reasons (signed out elsewhere, expired session); nothing retries until the
 * knitter signs in again.
 */
export type CloudStatus = 'signed-out' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error' | 'not-uploaded' | 'auth';

export type ConflictOutcome = Extract<SyncOutcome, { kind: 'conflict' }>;

export interface CloudState {
  status: CloudStatus;
  /** When the project was last confirmed online (ms since epoch). */
  lastSavedAt: number | null;
  /** Detail for 'error' and 'offline' (shown as a tooltip). */
  message: string | null;
  /** The conflict to resolve (ConflictDialog); cloud saving of that project is paused meanwhile. */
  conflict: ConflictOutcome | null;
}

export const SIGNED_OUT: CloudState = { status: 'signed-out', lastSavedAt: null, message: null, conflict: null };

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
    case 'not-uploaded':
      return 'Only on this device';
    case 'auth':
      return 'Sign in again to keep saving online';
  }
}

function ago(ms: number, at: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
