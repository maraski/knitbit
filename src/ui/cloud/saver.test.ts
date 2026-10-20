import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KVStorage } from '../../engine/autosave';
import { markerFor, readSyncMarker, toRemoteDoc, writeSyncMarker, type SyncOutcome } from '../../engine/cloudSync';
import type { Project } from '../../engine/model';
import { fixtureProject } from '../../engine/testFixtures';
import { MemoryRemote } from '../../engine/testRemote';
import { CloudSaver, RETRY_DELAYS_MS, SAVE_DELAY_MS, errorKind, retryDelay, scopedStorage, stateAfter } from './saver';
import { SIGNED_OUT, statusLabel, type CloudState } from './status';

function memoryStorage(): KVStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function edited(p: Project, name: string): Project {
  return { ...p, name, updatedAt: new Date().toISOString() };
}

function setup(opts: { online?: boolean; ask?: boolean } = {}) {
  const remote = new MemoryRemote();
  const storage = memoryStorage();
  const states: CloudState[] = [];
  const outcomes: SyncOutcome[] = [];
  const asked: { project: Project; online: string[] }[] = [];
  let online = opts.online ?? true;
  const saver = new CloudSaver(
    { remote, storage, isOnline: () => online, now: () => Date.now() },
    {
      onState: (s) => states.push(s),
      onOutcome: (o) => outcomes.push(o),
      ...(opts.ask ? { onAskUpload: (project: Project, list: { name: string }[]) => asked.push({ project, online: list.map((s) => s.name) }) } : {}),
    },
  );
  return { remote, storage, states, outcomes, asked, saver, setOnline: (v: boolean) => (online = v) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('CloudSaver', () => {
  it('uploads a project that is not online yet on start, and writes the marker', async () => {
    const { remote, storage, saver, states } = setup();
    const p = fixtureProject();
    await saver.start(p);
    expect(remote.docs.get(p.id)?.name).toBe(p.name);
    expect(readSyncMarker(storage)?.projectId).toBe(p.id);
    expect(states.map((s) => s.status)).toEqual(['saving', 'saved']);
  });

  it('saves about 2 s after the last edit, once', async () => {
    const { remote, saver } = setup();
    const p = fixtureProject();
    await saver.start(p);
    const save = vi.spyOn(remote, 'save');
    saver.changed(edited(p, 'A'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 500);
    saver.changed(edited(p, 'AB'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 500);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledTimes(1);
    expect(remote.docs.get(p.id)?.name).toBe('AB');
    expect(saver.current.status).toBe('saved');
  });

  it("doesn't save when the project is unchanged since the last sync", async () => {
    const { remote, saver } = setup();
    const p = fixtureProject();
    await saver.start(p);
    const save = vi.spyOn(remote, 'save');
    saver.changed(p);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
  });

  it('flush saves a pending edit immediately', async () => {
    const { remote, saver } = setup();
    const p = fixtureProject();
    await saver.start(p);
    saver.changed(edited(p, 'Now'));
    await saver.flush();
    expect(remote.docs.get(p.id)?.name).toBe('Now');
  });

  it('runs one sync at a time and saves the latest edit after the one in flight', async () => {
    const { remote, saver } = setup();
    const p = fixtureProject();
    await saver.start(p);
    saver.changed(edited(p, 'First'));
    const first = saver.flush();
    saver.changed(edited(p, 'Second'));
    const second = saver.flush();
    await first;
    await second;
    expect(remote.docs.get(p.id)?.name).toBe('Second');
    expect(saver.current.status).toBe('saved');
  });

  it('reports a download of a newer online copy', async () => {
    const { remote, storage, saver, outcomes } = setup();
    const p = fixtureProject();
    writeSyncMarker(storage, markerFor(p, remote.put(toRemoteDoc(p))));
    remote.put(toRemoteDoc(edited(p, 'From the other device')));
    await saver.start(p);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].kind).toBe('downloaded');
    expect(saver.current.status).toBe('saved');
  });

  it('sets conflict when another device saved in between, and pauses saving that project', async () => {
    const { remote, saver, outcomes } = setup();
    const p = fixtureProject();
    await saver.start(p);
    remote.put(toRemoteDoc(edited(p, 'Other device')));
    saver.changed(edited(p, 'This device'));
    await saver.flush();
    expect(saver.current.status).toBe('conflict');
    expect(saver.current.conflict?.kind).toBe('conflict');
    expect(outcomes.map((o) => o.kind)).toEqual(['conflict']);

    const save = vi.spyOn(remote, 'save');
    saver.changed(edited(p, 'More edits'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
    expect(remote.docs.get(p.id)?.name).toBe('Other device');

    // Opening another project resumes cloud saving.
    const other = { ...fixtureProject(), id: 'project-other', name: 'Other' };
    saver.changed(other);
    await saver.flush();
    expect(remote.docs.get('project-other')?.name).toBe('Other');
    expect(saver.current.status).toBe('saved');
  });

  it('shows offline when the network is down, and retries', async () => {
    const { remote, saver, setOnline } = setup();
    const p = fixtureProject();
    await saver.start(p);
    remote.offline = true;
    setOnline(false);
    saver.changed(edited(p, 'Offline edit'));
    await saver.flush();
    expect(saver.current.status).toBe('offline');
    remote.offline = false;
    setOnline(true);
    await saver.retry();
    expect(saver.current.status).toBe('saved');
    expect(remote.docs.get(p.id)?.name).toBe('Offline edit');
  });

  it('reports error (not offline) when online but the save fails', async () => {
    const { remote, saver } = setup();
    remote.offline = true; // the remote throws; the browser says it's online
    await saver.start(fixtureProject());
    expect(saver.current.status).toBe('error');
    expect(saver.current.message).toMatch(/Couldn't reach/);
  });

  it('stops after dispose', async () => {
    const { remote, saver } = setup();
    const p = fixtureProject();
    await saver.start(p);
    saver.changed(edited(p, 'Late'));
    saver.dispose();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(remote.docs.get(p.id)?.name).toBe(p.name);
  });
});

describe('CloudSaver: first sign-in', () => {
  const other = () => ({ ...fixtureProject(), id: 'project-online', name: 'Online one' });

  it('uploads straight away when nothing is online yet', async () => {
    const { remote, saver, asked } = setup({ ask: true });
    const p = fixtureProject();
    await saver.start(p);
    expect(asked).toEqual([]);
    expect(remote.docs.get(p.id)?.name).toBe(p.name);
  });

  it('asks instead of uploading when other projects are online, and waits', async () => {
    const { remote, saver, asked } = setup({ ask: true });
    remote.put(toRemoteDoc(other()));
    const p = fixtureProject();
    await saver.start(p);
    expect(asked.map((a) => [a.project.id, a.online])).toEqual([[p.id, ['Online one']]]);
    expect(saver.current.status).toBe('not-uploaded');
    saver.changed(edited(p, 'Edited meanwhile'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(remote.docs.has(p.id)).toBe(false);
  });

  it('"Upload this project" saves the latest edit', async () => {
    const { remote, saver } = setup({ ask: true });
    remote.put(toRemoteDoc(other()));
    const p = fixtureProject();
    await saver.start(p);
    saver.changed(edited(p, 'Edited meanwhile'));
    await saver.uploadNow();
    expect(remote.docs.get(p.id)?.name).toBe('Edited meanwhile');
    expect(saver.current.status).toBe('saved');
  });

  it("doesn't ask about a project this device already synced", async () => {
    const { remote, storage, saver, asked } = setup({ ask: true });
    const p = fixtureProject();
    writeSyncMarker(storage, markerFor(p, remote.put(toRemoteDoc(p))));
    remote.put(toRemoteDoc(other()));
    await saver.start(p);
    expect(asked).toEqual([]);
    expect(saver.current.status).toBe('saved');
  });

  it('opening an online project marks it in sync, so nothing is written', async () => {
    const { remote, saver, outcomes } = setup({ ask: true });
    const o = other();
    const at = remote.put(toRemoteDoc(o));
    await saver.start(fixtureProject());
    const save = vi.spyOn(remote, 'save');
    saver.opened(o, at);
    saver.changed(o);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
    expect(saver.current.status).toBe('saved');
  });
});

describe('CloudSaver: deleting the open project', () => {
  it('forget stops a pending save and ignores the project if undo brings it back', async () => {
    const { remote, saver, outcomes } = setup();
    const p = fixtureProject();
    await saver.start(p);
    saver.changed(edited(p, 'Pending'));
    saver.forget(p.id);
    await remote.remove(p.id);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    saver.changed(edited(p, 'Undone back'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(await remote.get(p.id)).toBeNull();
    expect(outcomes).toEqual([]); // no "deleted online" warning

    const next = { ...fixtureProject(), id: 'project-next', name: 'Next' };
    saver.changed(next);
    await saver.flush();
    expect(remote.docs.get('project-next')?.name).toBe('Next');
  });
});

describe('stateAfter', () => {
  it('keeps lastSavedAt through errors', () => {
    const saved = stateAfter(SIGNED_OUT, { kind: 'uploaded', marker: { projectId: 'p', remoteUpdatedAt: 't', fingerprint: 'f' } }, true, 1000);
    expect(saved).toEqual({ status: 'saved', lastSavedAt: 1000, message: null, conflict: null });
    const offline = stateAfter(saved, { kind: 'error', message: 'x' }, false, 2000);
    expect(offline).toMatchObject({ status: 'offline', lastSavedAt: 1000 });
    expect(stateAfter(saved, { kind: 'blocked', message: 'newer', errors: [] }, true, 2000).status).toBe('error');
  });
});

describe('statusLabel', () => {
  const at = new Date(2026, 9, 18, 9, 5).getTime();
  const s = (status: CloudState['status']): CloudState => ({ status, lastSavedAt: at, message: null, conflict: null });
  it('describes each status', () => {
    expect(statusLabel(s('saved'), at + 10_000)).toBe('Saved online · just now');
    expect(statusLabel(s('saved'), at + 5 * 60_000)).toBe('Saved online · 5 min ago');
    expect(statusLabel(s('saved'), at + 2 * 3600_000)).toBe('Saved online · 09:05');
    expect(statusLabel(s('saving'), at)).toBe('Saving…');
    expect(statusLabel(s('offline'), at)).toBe('Offline: saved on this device');
    expect(statusLabel(s('conflict'), at)).toBe('Conflict');
    expect(statusLabel(s('not-uploaded'), at)).toBe('Only on this device');
    expect(statusLabel(s('auth'), at)).toBe('Sign in again to keep saving online');
    expect(statusLabel(s('signed-out'), at)).toBe('');
  });
});

describe('scopedStorage', () => {
  it('keeps keys per account', () => {
    const base = memoryStorage();
    scopedStorage(base, 'u1').setItem('k', 'a');
    scopedStorage(base, 'u2').setItem('k', 'b');
    expect(scopedStorage(base, 'u1').getItem('k')).toBe('a');
    expect([...base.data.keys()]).toEqual(['k:u1', 'k:u2']);
  });
});

describe('errorKind', () => {
  it('tells sign-in problems and network problems from the rest', () => {
    expect(errorKind({ code: 'permission-denied' })).toBe('auth');
    expect(errorKind({ code: 'unauthenticated' })).toBe('auth');
    expect(errorKind({ code: 'auth/user-token-expired' })).toBe('auth');
    expect(errorKind({ code: 'unavailable' })).toBe('network');
    expect(errorKind({ code: 'auth/network-request-failed' })).toBe('network');
    expect(errorKind(new TypeError('Failed to fetch'))).toBe('network');
    expect(errorKind(new Error('boom'))).toBe('other');
    expect(errorKind(undefined)).toBe('other');
  });

  it('turns them into statuses', () => {
    const prev = { ...SIGNED_OUT, status: 'saved' as const, lastSavedAt: 1 };
    expect(stateAfter(prev, { kind: 'error', message: 'x', cause: { code: 'permission-denied' } }, true, 2).status).toBe('auth');
    expect(stateAfter(prev, { kind: 'error', message: 'x', cause: { code: 'unavailable' } }, true, 2).status).toBe('offline');
    expect(stateAfter(prev, { kind: 'error', message: 'x', cause: new Error('x') }, true, 2).status).toBe('error');
  });
});

describe('CloudSaver: retries and offline', () => {
  it('waits 2 s, 5 s, 15 s, then 60 s between retries', () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => retryDelay(n))).toEqual([2000, 5000, 15000, 60000, 60000, 60000]);
    expect(RETRY_DELAYS_MS).toEqual([2000, 5000, 15000, 60000]);
  });

  it('retries a failed save with backoff until it goes through', async () => {
    const { remote, saver } = setup();
    const p = fixtureProject();
    await saver.start(p);
    const get = vi.spyOn(remote, 'get');
    remote.failWith = { code: 'unavailable' };
    saver.changed(edited(p, 'Flaky'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(get).toHaveBeenCalledTimes(1);
    expect(saver.current.status).toBe('offline'); // a network error counts as offline

    const tries = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      return get.mock.calls.length;
    };
    expect(await tries(1999)).toBe(1);
    expect(await tries(1)).toBe(2); // +2 s
    expect(await tries(4999)).toBe(2);
    expect(await tries(1)).toBe(3); // +5 s
    expect(await tries(15000)).toBe(4); // +15 s
    expect(await tries(60000)).toBe(5); // +60 s
    expect(await tries(60000)).toBe(6); // capped at 60 s

    remote.failWith = null;
    expect(await tries(60000)).toBe(7);
    expect(saver.current.status).toBe('saved');
    expect(remote.docs.get(p.id)?.name).toBe('Flaky');
    expect(await tries(10 * 60000)).toBe(7); // nothing more once saved

    // The backoff starts again from 2 s after a success.
    remote.failWith = new Error('server hiccup');
    saver.changed(edited(p, 'Again'));
    expect(await tries(SAVE_DELAY_MS)).toBe(8);
    expect(saver.current.status).toBe('error');
    remote.failWith = null;
    expect(await tries(2000)).toBe(9);
    expect(remote.docs.get(p.id)?.name).toBe('Again');
  });

  it("edits during the backoff don't shorten the wait, and the retry sends the latest one", async () => {
    const { remote, saver } = setup();
    const p = fixtureProject();
    await saver.start(p);
    const get = vi.spyOn(remote, 'get');
    remote.failWith = { code: 'unavailable' };
    saver.changed(edited(p, 'One'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS); // fails; retry in 2 s
    await vi.advanceTimersByTimeAsync(2000); // fails; retry in 5 s
    expect(get).toHaveBeenCalledTimes(2);
    saver.changed(edited(p, 'Two'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(get).toHaveBeenCalledTimes(2);
    remote.failWith = null;
    await vi.advanceTimersByTimeAsync(5000 - SAVE_DELAY_MS);
    expect(get).toHaveBeenCalledTimes(3);
    expect(remote.docs.get(p.id)?.name).toBe('Two');
  });

  it('flush (tab hidden) sends a save that is waiting for its retry right away', async () => {
    const { remote, saver } = setup();
    const p = fixtureProject();
    await saver.start(p);
    remote.failWith = { code: 'unavailable' };
    saver.changed(edited(p, 'Pending'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    remote.failWith = null;
    await saver.flush();
    expect(remote.docs.get(p.id)?.name).toBe('Pending');
    expect(saver.current.status).toBe('saved');
  });

  it("while the browser is offline, tries nothing and waits for the 'online' event", async () => {
    const { remote, saver, setOnline } = setup();
    const p = fixtureProject();
    await saver.start(p);
    const get = vi.spyOn(remote, 'get');
    setOnline(false);
    saver.wentOffline();
    expect(saver.current.status).toBe('offline');
    saver.changed(edited(p, 'Offline 1'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    saver.changed(edited(p, 'Offline 2'));
    await saver.flush(); // tab hidden while offline
    await vi.advanceTimersByTimeAsync(10 * 60000);
    expect(get).not.toHaveBeenCalled();
    expect(saver.current.status).toBe('offline');
    expect(saver.current.lastSavedAt).not.toBeNull();

    setOnline(true);
    await saver.retry();
    expect(remote.docs.get(p.id)?.name).toBe('Offline 2');
    expect(saver.current.status).toBe('saved');
  });

  it('on reconnect, reports a conflict when the project also changed online meanwhile', async () => {
    const { remote, saver, setOnline, outcomes } = setup();
    const p = fixtureProject();
    await saver.start(p);
    setOnline(false);
    saver.changed(edited(p, 'Offline edit'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    remote.put(toRemoteDoc(edited(p, 'Other device')));
    setOnline(true);
    await saver.retry();
    expect(saver.current.status).toBe('conflict');
    expect(outcomes.map((o) => o.kind)).toEqual(['conflict']);
    expect(remote.docs.get(p.id)?.name).toBe('Other device');
  });

  it('on reconnect with no edits here, opens what another device saved', async () => {
    const { remote, saver, setOnline, outcomes } = setup();
    const p = fixtureProject();
    await saver.start(p);
    setOnline(false);
    saver.wentOffline();
    remote.put(toRemoteDoc(edited(p, 'Other device')));
    setOnline(true);
    await saver.retry();
    expect(outcomes.map((o) => o.kind)).toEqual(['downloaded']);
    expect(saver.current.status).toBe('saved');
  });

  it('stops for good on a sign-in problem, until start() (signed in again)', async () => {
    const { remote, saver } = setup();
    const p = fixtureProject();
    await saver.start(p);
    const get = vi.spyOn(remote, 'get');
    remote.failWith = { code: 'permission-denied' };
    saver.changed(edited(p, 'Refused'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(saver.current.status).toBe('auth');
    expect(saver.current.message).toMatch(/Sign in again/);
    saver.changed(edited(p, 'More'));
    await saver.flush();
    await saver.retry();
    await vi.advanceTimersByTimeAsync(60 * 60000);
    expect(get).toHaveBeenCalledTimes(1);

    remote.failWith = null;
    await saver.start(edited(p, 'More'));
    expect(remote.docs.get(p.id)?.name).toBe('More');
    expect(saver.current.status).toBe('saved');
  });
});

describe('CloudSaver: resolving a conflict', () => {
  async function conflicted() {
    const t = setup();
    const p = fixtureProject();
    await t.saver.start(p);
    t.remote.put(toRemoteDoc(edited(p, 'Other device')));
    t.saver.changed(edited(p, 'This device'));
    await t.saver.flush();
    expect(t.saver.current.status).toBe('conflict');
    return { ...t, p };
  }

  it("keep this device's version: overwrites online, includes edits made while deciding, and resumes saving", async () => {
    const { remote, storage, saver, p } = await conflicted();
    saver.changed(edited(p, 'Edited while the dialog was open'));
    const o = await saver.resolve('keep-local');
    expect(o?.kind).toBe('uploaded');
    expect(remote.docs.get(p.id)?.name).toBe('Edited while the dialog was open');
    expect(saver.current).toMatchObject({ status: 'saved', conflict: null });
    expect(readSyncMarker(storage)?.remoteUpdatedAt).toBe(remote.docs.get(p.id)?.updatedAt);

    saver.changed(edited(p, 'Saving again'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(remote.docs.get(p.id)?.name).toBe('Saving again');
  });

  it('keep the online version: hands it to the app, writes nothing online', async () => {
    const { remote, storage, saver, p } = await conflicted();
    const save = vi.spyOn(remote, 'save');
    const o = await saver.resolve('keep-remote');
    expect(o?.kind === 'downloaded' && o.project.name).toBe('Other device');
    expect(save).not.toHaveBeenCalled();
    expect(saver.current).toMatchObject({ status: 'saved', conflict: null });
    expect(readSyncMarker(storage)?.remoteUpdatedAt).toBe(remote.docs.get(p.id)?.updatedAt);
    // The app opens it (store.replace): that is in sync, so nothing is saved.
    if (o?.kind === 'downloaded') saver.changed(o.project);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
  });

  it('save as a copy: a new online project, the original untouched', async () => {
    const { remote, storage, saver, p } = await conflicted();
    const o = await saver.resolve('copy');
    expect(o?.kind).toBe('downloaded');
    const copy = o?.kind === 'downloaded' ? o.project : null;
    expect(copy?.id).not.toBe(p.id);
    expect(copy?.name).toBe('This device (copy)');
    expect(remote.docs.get(copy!.id)?.name).toBe('This device (copy)');
    expect(remote.docs.get(p.id)?.name).toBe('Other device');
    expect(readSyncMarker(storage)?.projectId).toBe(copy!.id);
    expect(saver.current.status).toBe('saved');
  });

  it('a second conflict while the dialog is open replaces the first, and can be resolved', async () => {
    const { remote, saver, p } = await conflicted();
    const first = saver.current.conflict;
    // Another device saves again just before "keep this device's version" arrives.
    remote.beforeNextSave = () => remote.put(toRemoteDoc(edited(p, 'Other device, again')));
    const o = await saver.resolve('keep-local');
    expect(o?.kind).toBe('conflict');
    expect(saver.current.status).toBe('conflict');
    expect(saver.current.conflict).not.toBe(first);
    expect(saver.current.conflict?.remote?.name).toBe('Other device, again');
    expect(remote.docs.get(p.id)?.name).toBe('Other device, again');

    expect((await saver.resolve('keep-local'))?.kind).toBe('uploaded');
    expect(remote.docs.get(p.id)?.name).toBe('This device');
    expect(saver.current.status).toBe('saved');
  });

  it('a network error leaves the conflict open for another try', async () => {
    const { remote, saver } = await conflicted();
    const c = saver.current.conflict;
    remote.failWith = { code: 'unavailable' };
    const o = await saver.resolve('keep-local');
    expect(o?.kind).toBe('error');
    expect(saver.current).toMatchObject({ status: 'conflict', conflict: c });
    remote.failWith = null;
    expect((await saver.resolve('copy'))?.kind).toBe('downloaded');
  });

  it('opening another project drops the conflict and saves that one', async () => {
    const { remote, saver } = await conflicted();
    const other = { ...fixtureProject(), id: 'project-other', name: 'Other' };
    saver.changed(other);
    expect(saver.current.conflict).toBeNull();
    expect(await saver.resolve('keep-local')).toBeNull();
    await saver.flush();
    expect(remote.docs.get('project-other')?.name).toBe('Other');
  });
});
