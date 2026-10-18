import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KVStorage } from '../../engine/autosave';
import { markerFor, readSyncMarker, toRemoteDoc, writeSyncMarker, type SyncOutcome } from '../../engine/cloudSync';
import type { Project } from '../../engine/model';
import { fixtureProject } from '../../engine/testFixtures';
import { MemoryRemote } from '../../engine/testRemote';
import { CloudSaver, SAVE_DELAY_MS, scopedStorage, stateAfter } from './saver';
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
