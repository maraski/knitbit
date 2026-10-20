// Google sign-in and cloud save of the open project. Firebase is loaded with import() only after Sign in, or at
// startup when the last visit ended signed in (the knitbit.cloud.signedIn flag). Without the VITE_FIREBASE_* env
// vars nothing here runs and `available` is false. The localStorage auto-save (store.ts) is unaffected.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectRemote, Resolution, SyncOutcome } from '../../engine/cloudSync';
import type { Project } from '../../engine/model';
import type { Notice } from '../store';
import { cloudConfig, rememberSignIn, rememberedSignIn } from './config';
import type { CloudUser } from './firebase';
import type { CloudSaver } from './saver';
import { SIGNED_OUT, type CloudState } from './status';

type FirebaseModule = typeof import('./firebase');

export interface Cloud {
  available: boolean;
  /** undefined while a remembered session is being restored. */
  user: CloudUser | null | undefined;
  state: CloudState;
  signIn: () => void;
  signOut: () => void;
  /** The signed-in user's online projects (null while signed out or loading). */
  remote: ProjectRemote | null;
  /** The Projects dialog: 'ask' is the first-sign-in choice (upload this project, or open an online one). */
  dialog: 'closed' | 'browse' | 'ask';
  showProjects: () => void;
  closeProjects: () => void;
  /** Saves a pending edit now, e.g. before listing projects. */
  flush: () => Promise<void>;
  /** "Upload this project" after the first-sign-in question. */
  uploadNow: () => void;
  /** Call before opening an online project in the app, with the online copy's updatedAt. */
  opened: (project: Project, remoteUpdatedAt: string) => void;
  /** Call before deleting a project online, so it is never saved again (`on = false` if the delete failed). */
  forget: (id: string, on?: boolean) => void;
  /** The open project (this device's version in a conflict). */
  project: Project;
  /** Answers the conflict in state.conflict; resolves to an error message to show, or null. */
  resolveConflict: (choice: Resolution) => Promise<string | null>;
}

export function useCloud(project: Project, open: (p: Project) => void, notify: (n: Notice) => void): Cloud {
  const available = cloudConfig !== null;
  const [user, setUser] = useState<CloudUser | null | undefined>(() => (available && rememberedSignIn() ? undefined : null));
  const [state, setState] = useState<CloudState>(SIGNED_OUT);
  const [remote, setRemote] = useState<ProjectRemote | null>(null);
  const [dialog, setDialog] = useState<Cloud['dialog']>('closed');
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
      setRemote(null);
      setDialog('closed');
      return;
    }
    rememberSignIn(true);
    let cancelled = false;
    let s: CloudSaver | null = null;
    void mod.current.then((m) => {
      if (cancelled) return;
      const r = m.remoteFor(user.uid);
      s = new m.CloudSaver(
        { remote: r, storage: m.scopedStorage(window.localStorage, user.uid), isOnline: () => navigator.onLine, now: () => Date.now() },
        { onState: setState, onOutcome: (o) => handleOutcome(o, latest.current.open, latest.current.notify), onAskUpload: () => setDialog('ask') },
      );
      saver.current = s;
      setRemote(r);
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
    const onOffline = () => saver.current?.wentOffline();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onHidden);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onHidden);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const signIn = useCallback(() => {
    // Set before a possible redirect, so the page that comes back restores the session.
    rememberSignIn(true);
    load()
      .then((m) => m.signIn())
      .then((how) => {
        // Signing in again as the same account doesn't change `user`, so restart saving that stopped on sign-in.
        if (how === 'popup' && saver.current?.current.status === 'auth') void saver.current.start(latest.current.project);
        if (how === 'cancelled' && !saver.current) rememberSignIn(false);
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

  const showProjects = useCallback(() => setDialog('browse'), []);
  const closeProjects = useCallback(() => setDialog('closed'), []);
  const flush = useCallback(() => saver.current?.flush() ?? Promise.resolve(), []);
  const uploadNow = useCallback(() => void saver.current?.uploadNow(), []);
  const opened = useCallback((p: Project, at: string) => saver.current?.opened(p, at), []);
  const forget = useCallback((id: string, on?: boolean) => saver.current?.forget(id, on), []);

  const resolveConflict = useCallback(async (choice: Resolution): Promise<string | null> => {
    const o = (await saver.current?.resolve(choice)) ?? null;
    if (o?.kind === 'downloaded') {
      latest.current.open(o.project);
      latest.current.notify(
        choice === 'copy'
          ? { kind: 'info', title: `Saved this device's version online as "${o.project.name}"`, lines: ['The online version stays as it was.'] }
          : { kind: 'info', title: `Opened the online version of "${o.project.name}" (undo to go back)`, lines: [] },
      );
    }
    return o?.kind === 'error' ? o.message : null;
  }, []);

  return { available, user, state, signIn, signOut, remote, dialog, showProjects, closeProjects, flush, uploadNow, opened, forget, project, resolveConflict };
}

function handleOutcome(o: SyncOutcome, open: (p: Project) => void, notify: (n: Notice) => void): void {
  switch (o.kind) {
    case 'downloaded':
      open(o.project);
      notify({ kind: 'info', title: `Opened the newer online copy of "${o.project.name}" (undo to go back)`, lines: o.notes });
      break;
    // 'conflict' opens ConflictDialog (CloudStatus) from state.conflict.
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
