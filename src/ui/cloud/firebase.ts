// Firebase app, Google sign-in and the Firestore ProjectRemote. Load this module only with `import('./firebase')`
// (see useCloud.ts) so the SDK stays out of the main chunk.
//
// Firestore document projects/{id}: owner, name, data (serializeProject text), schema, rev, updatedAt, createdAt,
// deleted?. `rev` is a random token written by every save; it is the RemoteDoc `updatedAt` that conditional saves
// compare, because a server timestamp isn't known until after the write. `updatedAt` (server time) is for display.
//
// Firestore *lite* (plain HTTPS, no offline cache or live listeners) and auth with localStorage persistence keep this
// chunk about 200 kB instead of 560 kB. Offline edits are covered by the local auto-save; switch the import to
// 'firebase/firestore' if the offline cache is ever wanted.

import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  initializeAuth,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
} from 'firebase/auth';
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore/lite';
import type { ProjectRemote, RemoteDoc, RemoteSummary, SaveResult } from '../../engine/cloudSync';
import { cloudConfig } from './config';

// The saver comes along in this chunk: it is only needed once signed in.
export { CloudSaver, scopedStorage } from './saver';

export interface CloudUser {
  uid: string;
  name: string;
  email: string;
  photoURL: string | null;
}

if (!cloudConfig) throw new Error('Firebase is not configured (VITE_FIREBASE_* env vars).');
const app = initializeApp(cloudConfig);
const auth = initializeAuth(app, { persistence: browserLocalPersistence, popupRedirectResolver: browserPopupRedirectResolver });
const db = getFirestore(app);
const COLLECTION = 'projects';

/** Calls back with the signed-in user, or null, now and on every change. Returns the unsubscribe function. */
export function onUser(cb: (user: CloudUser | null) => void, onError: (message: string) => void): () => void {
  // Finishes a redirect sign-in (the popup fallback); the user itself arrives through onAuthStateChanged.
  getRedirectResult(auth).catch((e: unknown) => onError(message(e)));
  return onAuthStateChanged(auth, (u) =>
    cb(u ? { uid: u.uid, name: u.displayName ?? u.email ?? 'Signed in', email: u.email ?? '', photoURL: u.photoURL } : null),
  );
}

/** Google sign-in in a popup; falls back to a full-page redirect where popups are blocked or unsupported. */
export async function signIn(): Promise<'popup' | 'redirect' | 'cancelled'> {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
    return 'popup';
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'cancelled';
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-environment') {
      await signInWithRedirect(auth, provider); // leaves the page
      return 'redirect';
    }
    throw new Error(message(e));
  }
}

export function signOut(): Promise<void> {
  return fbSignOut(auth);
}

function message(e: unknown): string {
  return (e as Error)?.message ?? String(e);
}

/** A Firestore Timestamp field as ms since epoch (null if missing). */
function millis(v: unknown): number | null {
  return v && typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis(): number }).toMillis() : null;
}

function newRev(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The signed-in user's projects in Firestore. */
export function remoteFor(uid: string): ProjectRemote {
  const ref = (id: string) => doc(db, COLLECTION, id);
  return {
    async list(): Promise<RemoteSummary[]> {
      const snap = await getDocs(query(collection(db, COLLECTION), where('owner', '==', uid)));
      return snap.docs
        .filter((d) => !d.get('deleted'))
        .map((d) => ({ id: d.id, name: String(d.get('name') ?? ''), updatedAt: String(d.get('rev') ?? ''), editedAt: millis(d.get('updatedAt')) }));
    },

    async get(id: string): Promise<RemoteDoc | null> {
      const d = await getDoc(ref(id));
      if (!d.exists() || d.get('deleted')) return null;
      return { id, name: String(d.get('name') ?? ''), schema: Number(d.get('schema')), data: String(d.get('data') ?? ''), updatedAt: String(d.get('rev') ?? '') };
    },

    save(next, ifUpdatedAt): Promise<SaveResult> {
      return runTransaction(db, async (tx) => {
        const current = await tx.get(ref(next.id));
        const currentRev = current.exists() ? String(current.get('rev') ?? '') : null;
        if (currentRev !== ifUpdatedAt) return { ok: false, conflict: true, currentUpdatedAt: currentRev };
        const rev = newRev();
        const fields = { owner: uid, name: next.name, data: next.data, schema: next.schema, rev, updatedAt: serverTimestamp() };
        if (current.exists()) tx.update(ref(next.id), { ...fields, deleted: deleteField() });
        else tx.set(ref(next.id), { ...fields, createdAt: serverTimestamp() });
        return { ok: true, updatedAt: rev };
      });
    },

    async remove(id: string): Promise<void> {
      await runTransaction(db, async (tx) => {
        const current = await tx.get(ref(id));
        if (current.exists()) tx.update(ref(id), { deleted: serverTimestamp(), rev: newRev(), updatedAt: serverTimestamp() });
      });
    },
  };
}
