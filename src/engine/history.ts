// Undo/redo over immutable snapshots. Edits that share a coalesce key within a short window
// (e.g. typing in one field) merge into a single undo step.

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  lastKey: string | null;
  lastTime: number;
}

export const HISTORY_LIMIT = 200;
export const COALESCE_MS = 1000;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null, lastTime: 0 };
}

/**
 * Record a new state. Pass `key` to merge consecutive edits of the same thing within a short window.
 * Keys starting with `drag:` always merge (one undo step per drag, however long it takes).
 */
export function commit<T>(h: History<T>, next: T, key: string | null = null, now = Date.now()): History<T> {
  if (next === h.present) return h;
  const merge = key !== null && key === h.lastKey && (key.startsWith('drag:') || now - h.lastTime < COALESCE_MS);
  const past = merge ? h.past : [...h.past, h.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], lastKey: key, lastTime: now };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  const prev = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], lastKey: null, lastTime: 0 };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next, future: rest, lastKey: null, lastTime: 0 };
}

/** Drop the step made by edits with this key, if they were the last ones (a drag cut short by a pinch). Not redoable. */
export function revert<T>(h: History<T>, key: string): History<T> {
  if (h.lastKey !== key || !h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: h.future, lastKey: null, lastTime: 0 };
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0;
export const canRedo = <T>(h: History<T>) => h.future.length > 0;
