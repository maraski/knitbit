// Google sign-in and cloud save of the open project. Firebase is loaded with import() only after Sign in, or at
// startup when the last visit ended signed in (the knitbit.cloud.signedIn flag). Without the VITE_FIREBASE_* env
// vars nothing here runs and `available` is false. The localStorage auto-save (store.ts) is unaffected.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncOutcome } from '../../engine/cloudSync';
import type { Project } from '../../engine/model';
import type { Notice } from '../store';
import { cloudConfig, rememberSignIn, rememberedSignIn } from './config';
import type { CloudUser } from './firebase';
import { CloudSaver, SIGNED_OUT, scopedStorage, type CloudState } from './saver';

type FirebaseModule = typeof import('./firebase');

export interface Cloud {
  available: boolean;
  /** undefined while a remembered session is being restored. */
  user: CloudUser | null | undefined;
  state: CloudState;
  signIn: () => void;
  signOut: () => void;
}

export function useCloud(project: Project, open: (p: Project) => void, notify: (n: Notice) => void): Cloud {
  const available = cloudConfig !== null;
  const [user, setUser] = useState<CloudUser | null | undefined>(() => (available && rememberedSignIn() ? undefined : null));
  const [state, setState] = useState<CloudState>(SIGNED_OUT);
  const mod = useRef<Promise<FirebaseModule> | null>(null);
  const saver = useRef<CloudSaver | null>(null);
  const latest = useRef({ project, open, notify });
  latest.current = { project, open, notify };

  const load = useCallback((): Promise<FirebaseModule> => {
    mod.current ??= import('./firebase').then((m) => {
      m.onUser(setUser, (message) => latest.current.notify({ kind: 'error', title: 'Google sign-in failed', lines: [message] }));
      return m;
    });
    return mod.current;
  }, []);

  useEffect(() => {
    if (user === undefined) {
      load().catch((e: Error) => {
        setUser(null);
        latest.current.notify({ kind: 'error', title: "Couldn't load online saving", lines: [e.message] });
      });
    }
    // Only at startup: later sign-ins go through signIn.
  }, []);

  // A saver per signed-in user; it syncs the open project right away.
  useEffect(() => {
    if (!user || !mod.current) {
      if (user === null) rememberSignIn(false);
      setState(SIGNED_OUT);
      return;
    }
    rememberSignIn(true);
    let cancelled = false;
    let s: CloudSaver | null = null;
    void mod.current.then((m) => {
      if (cancelled) return;
      s = new CloudSaver(
        { remote: m.remoteFor(user.uid), storage: scopedStorage(window.localStorage, user.uid), isOnline: () => navigator.onLine, now: () => Date.now() },
        { onState: setState, onOutcome: (o) => handleOutcome(o, latest.current.open, latest.current.notify) },
      );
      saver.current = s;
      void s.start(latest.current.project);
    });
    return () => {
      cancelled = true;
      void s?.flush();
      s?.dispose();
      saver.current = null;
    };
  }, [user]);

  useEffect(() => {
    saver.current?.changed(project);
  }, [project]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void saver.current?.flush();
    };
    const onOnline = () => void saver.current?.retry();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onHidden);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onHidden);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  const signIn = useCallback(() => {
    // Set before a possible redirect, so the page that comes back restores the session.
    rememberSignIn(true);
    load()
      .then((m) => m.signIn())
      .then((how) => {
        if (how === 'cancelled') rememberSignIn(false);
      })
      .catch((e: Error) => {
        rememberSignIn(false);
        latest.current.notify({ kind: 'error', title: 'Google sign-in failed', lines: [e.message] });
      });
  }, [load]);

  const signOut = useCallback(() => {
    // Save a pending edit first, while still signed in.
    void (saver.current?.flush() ?? Promise.resolve()).finally(() => {
      rememberSignIn(false);
      void mod.current?.then((m) => m.signOut());
    });
  }, []);

  return { available, user, state, signIn, signOut };
}

function handleOutcome(o: SyncOutcome, open: (p: Project) => void, notify: (n: Notice) => void): void {
  switch (o.kind) {
    case 'downloaded':
      open(o.project);
      notify({ kind: 'info', title: `Opened the newer online copy of "${o.project.name}" (undo to go back)`, lines: o.notes });
      break;
    case 'conflict':
      notify({
        kind: 'warning',
        title: 'Conflict: not saved online',
        lines: [
          o.message,
          'Nothing was overwritten. Online saving of this project is paused; your edits are still saved on this device. Use Save to download a copy of this version.',
        ],
      });
      break;
    case 'remote-deleted':
      notify({ kind: 'warning', title: 'Not saved online', lines: [o.message, 'Online saving of this project is paused; it is still saved on this device.'] });
      break;
    case 'blocked':
      notify({ kind: 'error', title: 'Not saved online', lines: [o.message, ...o.errors] });
      break;
    default:
      break;
  }
}
