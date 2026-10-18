import { describe, expect, it } from 'vitest';
import type { KVStorage } from './autosave';
import {
  asCopy,
  decideSync,
  fingerprint,
  markerFor,
  readSyncMarker,
  resolveConflict,
  syncProject,
  toRemoteDoc,
  writeSyncMarker,
  type LocalCopy,
  type SyncMarker,
  type SyncOutcome,
} from './cloudSync';
import { SCHEMA_VERSION, type Project } from './model';
import { serializeProject } from './schema';
import { fixtureProject } from './testFixtures';
import { MemoryRemote } from './testRemote';

const SAVED_AT = '2026-10-18T10:00:00.000Z';

function local(project: Project): LocalCopy {
  return { project, savedAt: SAVED_AT };
}

function edited(project: Project, name = 'Edited'): Project {
  return { ...project, name, updatedAt: '2026-10-18T11:00:00.000Z' };
}

/** A remote holding `project`, and the marker of a device that last synced exactly that. */
function synced(project: Project): { remote: MemoryRemote; marker: SyncMarker } {
  const remote = new MemoryRemote();
  const updatedAt = remote.put(toRemoteDoc(project));
  return { remote, marker: markerFor(project, updatedAt) };
}

function newerSchemaDoc(project: Project) {
  const raw = { ...JSON.parse(serializeProject(project)), schemaVersion: SCHEMA_VERSION + 1 };
  return { id: project.id, name: project.name, schema: SCHEMA_VERSION + 1, data: JSON.stringify(raw) };
}

describe('decideSync', () => {
  it('uploads on first sign-in when the project is only on this device', () => {
    const p = fixtureProject();
    expect(decideSync(local(p), null, null)).toMatchObject({ action: 'upload', ifUpdatedAt: null });
  });

  it('downloads when there is nothing local', () => {
    const p = fixtureProject();
    const doc = { ...toRemoteDoc(p), updatedAt: 't1' };
    const d = decideSync(null, null, doc);
    expect(d.action).toBe('download');
    if (d.action === 'download') {
      expect(d.project).toEqual(p);
      expect(d.marker).toEqual(markerFor(p, 't1'));
    }
  });

  it('does nothing when nothing is local or online', () => {
    expect(decideSync(null, null, null)).toMatchObject({ action: 'nothing', marker: null });
  });

  it('does nothing when neither side changed', () => {
    const p = fixtureProject();
    const doc = { ...toRemoteDoc(p), updatedAt: 't1' };
    expect(decideSync(local(p), markerFor(p, 't1'), doc)).toMatchObject({ action: 'nothing', marker: markerFor(p, 't1') });
  });

  it('treats identical content as in sync even without a marker', () => {
    const p = fixtureProject();
    const doc = { ...toRemoteDoc(p), updatedAt: 't7' };
    expect(decideSync(local(p), null, doc)).toMatchObject({ action: 'nothing', marker: markerFor(p, 't7') });
  });

  it('uploads changes made offline, guarded by the last-seen updatedAt', () => {
    const p = fixtureProject();
    const doc = { ...toRemoteDoc(p), updatedAt: 't1' };
    expect(decideSync(local(edited(p)), markerFor(p, 't1'), doc)).toMatchObject({ action: 'upload', ifUpdatedAt: 't1' });
  });

  it('downloads changes saved by another device', () => {
    const p = fixtureProject();
    const other = edited(p, 'From the laptop');
    const doc = { ...toRemoteDoc(other), updatedAt: 't2' };
    const d = decideSync(local(p), markerFor(p, 't1'), doc);
    expect(d).toMatchObject({ action: 'download', marker: markerFor(other, 't2') });
    expect(d.action === 'download' && d.project.name).toBe('From the laptop');
  });

  it('reports a conflict when both sides changed', () => {
    const p = fixtureProject();
    const doc = { ...toRemoteDoc(edited(p, 'Online')), updatedAt: 't2' };
    const d = decideSync(local(edited(p, 'Here')), markerFor(p, 't1'), doc);
    expect(d).toMatchObject({ action: 'conflict', remoteUpdatedAt: 't2' });
    if (d.action === 'conflict') {
      expect(d.local.project.name).toBe('Here');
      expect(d.remote.name).toBe('Online');
    }
  });

  it('reports a conflict when a never-synced device holds a different version', () => {
    const p = fixtureProject();
    const doc = { ...toRemoteDoc(edited(p, 'Online')), updatedAt: 't2' };
    expect(decideSync(local(p), null, doc).action).toBe('conflict');
  });

  it('ignores a marker that belongs to another project', () => {
    const p = fixtureProject();
    const doc = { ...toRemoteDoc(edited(p, 'Online')), updatedAt: 't2' };
    const marker = { ...markerFor(p, 't2'), projectId: 'someone-else' };
    expect(decideSync(local(p), marker, doc).action).toBe('conflict');
  });

  it('notices that the online copy was deleted instead of uploading it again', () => {
    const p = fixtureProject();
    expect(decideSync(local(p), markerFor(p, 't1'), null)).toMatchObject({ action: 'remote-deleted' });
  });

  it('never overwrites an online copy saved with a newer schema', () => {
    const p = fixtureProject();
    const doc = { ...newerSchemaDoc(p), updatedAt: 't2' };
    for (const d of [decideSync(local(edited(p)), markerFor(p, 't1'), doc), decideSync(local(p), null, doc), decideSync(null, null, doc)]) {
      expect(d.action).toBe('blocked');
      expect(d.action === 'blocked' && d.errors[0]).toMatch(/newer version of Knitbit/);
    }
  });

  it('blocks a damaged online copy', () => {
    const p = fixtureProject();
    const d = decideSync(local(p), null, { ...toRemoteDoc(p), data: '{ nope', updatedAt: 't1' });
    expect(d.action === 'blocked' && d.errors[0]).toMatch(/Not valid JSON/);
  });
});

describe('syncProject', () => {
  it('uploads a new project and returns the marker to keep', async () => {
    const p = fixtureProject();
    const remote = new MemoryRemote();
    const r = await syncProject(remote, local(p), null);
    expect(r).toEqual({ kind: 'uploaded', marker: markerFor(p, 't1') });
    expect(await remote.list()).toEqual([{ id: p.id, name: p.name, updatedAt: 't1' }]);
    expect(remote.docs.get(p.id)?.data).toBe(serializeProject(p));
  });

  it('uploads offline edits over the copy this device last saw', async () => {
    const p = fixtureProject();
    const { remote, marker } = synced(p);
    const r = await syncProject(remote, local(edited(p)), marker);
    expect(r.kind).toBe('uploaded');
    expect((await remote.get(p.id))?.name).toBe('Edited');
  });

  it('downloads another device’s changes without writing', async () => {
    const p = fixtureProject();
    const { remote, marker } = synced(p);
    remote.put(toRemoteDoc(edited(p, 'Laptop')));
    const r = await syncProject(remote, local(p), marker);
    expect(r.kind === 'downloaded' && r.project.name).toBe('Laptop');
    expect((await remote.get(p.id))?.updatedAt).toBe('t2');
  });

  it('turns a save rejected by a concurrent write into a conflict', async () => {
    const p = fixtureProject();
    const { remote, marker } = synced(p);
    remote.beforeNextSave = () => remote.put(toRemoteDoc(edited(p, 'Laptop, a moment earlier')));
    const r = await syncProject(remote, local(edited(p, 'Phone')), marker);
    expect(r).toMatchObject({ kind: 'conflict', remoteUpdatedAt: 't2' });
    expect(r.kind === 'conflict' && r.remote?.name).toBe('Laptop, a moment earlier');
    expect((await remote.get(p.id))?.name).toBe('Laptop, a moment earlier');
  });

  it('blocks when the concurrent write came from a newer app version', async () => {
    const p = fixtureProject();
    const { remote, marker } = synced(p);
    remote.beforeNextSave = () => remote.put(newerSchemaDoc(p));
    const r = await syncProject(remote, local(edited(p)), marker);
    expect(r.kind).toBe('blocked');
    expect(remote.docs.get(p.id)?.schema).toBe(SCHEMA_VERSION + 1);
  });

  it('does not upload over a newer-schema online copy', async () => {
    const p = fixtureProject();
    const remote = new MemoryRemote();
    remote.put(newerSchemaDoc(p));
    const r = await syncProject(remote, local(edited(p)), null);
    expect(r.kind).toBe('blocked');
    expect(remote.docs.get(p.id)?.schema).toBe(SCHEMA_VERSION + 1);
  });

  it('reports a project deleted on another device', async () => {
    const p = fixtureProject();
    const { remote, marker } = synced(p);
    await remote.remove(p.id);
    expect((await syncProject(remote, local(p), marker)).kind).toBe('remote-deleted');
    expect(await remote.list()).toEqual([]);
  });

  it('cannot reuse the id of a deleted project; uploading again goes under a new id', async () => {
    const p = fixtureProject();
    const { remote } = synced(p);
    await remote.remove(p.id);
    expect((await syncProject(remote, local(p), null)).kind).toBe('conflict');
    const again = asCopy(p, '');
    expect((await syncProject(remote, local(again), null)).kind).toBe('uploaded');
    expect((await remote.list()).map((s) => s.name)).toEqual([p.name]);
  });

  it('reports network failures without throwing', async () => {
    const remote = new MemoryRemote();
    remote.offline = true;
    const r = await syncProject(remote, local(fixtureProject()), null);
    expect(r).toEqual({ kind: 'error', message: "Couldn't reach the online copy: offline" });
  });
});

describe('resolveConflict', () => {
  async function conflict() {
    const p = fixtureProject();
    const { remote, marker } = synced(p);
    remote.put(toRemoteDoc(edited(p, 'Online')));
    const c = (await syncProject(remote, local(edited(p, 'Here')), marker)) as Extract<SyncOutcome, { kind: 'conflict' }>;
    expect(c.kind).toBe('conflict');
    return { p, remote, c };
  }

  it('keep local saves this device’s version over the online one', async () => {
    const { p, remote, c } = await conflict();
    const r = await resolveConflict(remote, c, 'keep-local');
    expect(r.kind).toBe('uploaded');
    expect((await remote.get(p.id))?.name).toBe('Here');
  });

  it('keep local is refused again if yet another save happened meanwhile', async () => {
    const { p, remote, c } = await conflict();
    remote.put(toRemoteDoc(edited(p, 'Tablet')));
    const r = await resolveConflict(remote, c, 'keep-local');
    expect(r.kind === 'conflict' && r.remote?.name).toBe('Tablet');
    expect((await remote.get(p.id))?.name).toBe('Tablet');
  });

  it('keep remote opens the online version and writes nothing', async () => {
    const { p, remote, c } = await conflict();
    const r = await resolveConflict(remote, c, 'keep-remote');
    expect(r.kind === 'downloaded' && r.project.name).toBe('Online');
    expect(r.kind === 'downloaded' && r.marker).toEqual(markerFor(c.remote!, c.remoteUpdatedAt!));
    expect((await remote.get(p.id))?.updatedAt).toBe(c.remoteUpdatedAt);
  });

  it('save as copy keeps both versions online', async () => {
    const { p, remote, c } = await conflict();
    const r = await resolveConflict(remote, c, 'copy');
    expect(r.kind).toBe('downloaded');
    if (r.kind !== 'downloaded') return;
    expect(r.project.id).not.toBe(p.id);
    expect(r.project.name).toBe('Here (copy)');
    expect(r.marker.projectId).toBe(r.project.id);
    expect((await remote.list()).map((s) => s.name).sort()).toEqual(['Here (copy)', 'Online']);
  });
});

describe('sync marker storage', () => {
  function memoryStorage(): KVStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  }

  it('round-trips and clears', () => {
    const s = memoryStorage();
    const m = markerFor(fixtureProject(), 't3');
    writeSyncMarker(s, m);
    expect(readSyncMarker(s)).toEqual(m);
    writeSyncMarker(s, null);
    expect(readSyncMarker(s)).toBeNull();
  });

  it('ignores damaged markers and failing storage', () => {
    const s = memoryStorage();
    s.data.set('knitbit.syncMarker.v1', '{ nope');
    expect(readSyncMarker(s)).toBeNull();
    s.data.set('knitbit.syncMarker.v1', '{"projectId":1}');
    expect(readSyncMarker(s)).toBeNull();
    const broken: KVStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); }, removeItem: () => {} };
    expect(readSyncMarker(broken)).toBeNull();
    expect(() => writeSyncMarker(broken, markerFor(fixtureProject(), 't1'))).not.toThrow();
  });

  it('fingerprints change with content', () => {
    const p = fixtureProject();
    expect(fingerprint(p)).toBe(fingerprint(structuredClone(p)));
    expect(fingerprint(p)).not.toBe(fingerprint(edited(p)));
  });
});
