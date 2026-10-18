import { describe, expect, it } from 'vitest';
import { afterDeletingOpen, checkName, deleteOnline, duplicateOnline, fetchProject, renameOnline, shouldAskBeforeUpload, sortProjects } from './cloudProjects';
import { toRemoteDoc, type RemoteSummary } from './cloudSync';
import type { Project } from './model';
import { fixtureProject } from './testFixtures';
import { MemoryRemote } from './testRemote';

function named(name: string): Project {
  return { ...fixtureProject(), id: `project-${name.toLowerCase().replace(/\W+/g, '-')}`, name };
}

function summary(id: string, editedAt: number | null, name = id): RemoteSummary {
  return { id, name, updatedAt: `r-${id}`, editedAt };
}

/** A remote holding the projects, saved in the order given (so the last one is the newest). */
function remoteWith(...projects: Project[]): MemoryRemote {
  const remote = new MemoryRemote();
  for (const p of projects) remote.put(toRemoteDoc(p));
  return remote;
}

describe('sortProjects', () => {
  it('lists newest first, unknown times last, ties by name', () => {
    const list = [summary('a', 1000), summary('b', null), summary('c', 3000), summary('e', 2000, 'Zed'), summary('d', 2000, 'Alpha')];
    expect(sortProjects(list).map((s) => s.id)).toEqual(['c', 'd', 'e', 'a', 'b']);
    expect(list[0].id).toBe('a'); // not sorted in place
  });

  it('puts the latest save first with the in-memory remote', async () => {
    const remote = remoteWith(named('Old'), named('Middle'), named('New'));
    expect(sortProjects(await remote.list()).map((s) => s.name)).toEqual(['New', 'Middle', 'Old']);
  });
});

describe('checkName', () => {
  it('trims and collapses spaces', () => {
    expect(checkName('  Cabled   cardigan ')).toEqual({ ok: true, name: 'Cabled cardigan' });
  });

  it('refuses empty and over-long names', () => {
    expect(checkName('   ').ok).toBe(false);
    expect(checkName('x'.repeat(101)).ok).toBe(false);
    expect(checkName('x'.repeat(100)).ok).toBe(true);
  });
});

describe('renameOnline', () => {
  it('renames the online copy and keeps its content', async () => {
    const p = named('Before');
    const remote = remoteWith(p);
    expect(await renameOnline(remote, p.id, ' After ', new Date('2026-10-18T12:00:00Z'))).toEqual({ ok: true });
    const got = await fetchProject(remote, p.id);
    expect(got?.doc.name).toBe('After');
    expect(got?.result.ok && got.result.project).toMatchObject({ name: 'After', updatedAt: '2026-10-18T12:00:00.000Z', panels: p.panels });
  });

  it('refuses a bad name without touching the remote', async () => {
    const p = named('Keep');
    const remote = remoteWith(p);
    const before = remote.docs.get(p.id)?.updatedAt;
    expect((await renameOnline(remote, p.id, '')).ok).toBe(false);
    expect(remote.docs.get(p.id)?.updatedAt).toBe(before);
  });

  it("doesn't overwrite another device's save in between", async () => {
    const p = named('Race');
    const remote = remoteWith(p);
    remote.beforeNextSave = () => remote.put(toRemoteDoc({ ...p, name: 'Other device' }));
    const r = await renameOnline(remote, p.id, 'Mine');
    expect(r.ok).toBe(false);
    expect(remote.docs.get(p.id)?.name).toBe('Other device');
  });

  it('reports a project that is gone', async () => {
    const r = await renameOnline(new MemoryRemote(), 'project-missing', 'X');
    expect(r).toEqual({ ok: false, error: 'That project is no longer online.' });
  });
});

describe('duplicateOnline', () => {
  it('saves a copy under a new id, leaving the original', async () => {
    const p = named('Raglan');
    const remote = remoteWith(p);
    const r = await duplicateOnline(remote, p.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.id).not.toBe(p.id);
    expect(sortProjects(await remote.list()).map((s) => s.name)).toEqual(['Raglan (copy)', 'Raglan']);
  });

  it("copies this device's newer version of the open project", async () => {
    const p = named('Open');
    const remote = remoteWith(p);
    const r = await duplicateOnline(remote, p.id, { ...p, name: 'Open, edited' });
    expect(r.ok && r.project.name).toBe('Open, edited (copy)');
  });
});

describe('afterDeletingOpen', () => {
  it('opens the most recently edited remaining project', () => {
    expect(afterDeletingOpen('x', [summary('x', 9000), summary('a', 1000), summary('b', 5000)])).toEqual({ open: 'online', id: 'b' });
  });

  it('falls back to a fresh sample when nothing else is online', () => {
    expect(afterDeletingOpen('x', [summary('x', 9000)])).toEqual({ open: 'sample' });
    expect(afterDeletingOpen('x', [])).toEqual({ open: 'sample' });
  });
});

describe('deleteOnline', () => {
  it('soft-deletes another project and opens nothing', async () => {
    const open = named('Open');
    const other = named('Other');
    const remote = remoteWith(other, open);
    expect(await deleteOnline(remote, other.id, open.id)).toEqual({ next: null });
    expect((await remote.list()).map((s) => s.name)).toEqual(['Open']);
    expect(remote.docs.get(other.id)?.deleted).toBe(true); // kept, only hidden
  });

  it('deleting the open project returns the newest remaining one, read like Open…', async () => {
    const older = named('Older');
    const newer = named('Newer');
    const open = named('Open');
    const remote = remoteWith(older, newer, open);
    const r = await deleteOnline(remote, open.id, open.id);
    expect(r.next).toEqual({ open: 'online', id: newer.id });
    expect('fetched' in r && r.fetched?.result.ok && r.fetched.result.project.name).toBe('Newer');
    expect((await remote.list()).map((s) => s.id)).not.toContain(open.id);
  });

  it('deleting the only project falls back to a sample', async () => {
    const open = named('Only');
    const remote = remoteWith(open);
    expect(await deleteOnline(remote, open.id, open.id)).toEqual({ next: { open: 'sample' }, fetched: null });
  });

  it('skips to a sample when the next project cannot be read', async () => {
    const open = named('Open');
    const remote = new MemoryRemote();
    remote.put({ id: 'project-bad', name: 'Damaged', schema: 1, data: '{ nope' });
    remote.put(toRemoteDoc(open));
    expect(await deleteOnline(remote, open.id, open.id)).toEqual({ next: { open: 'sample' }, fetched: null });
  });
});

describe('shouldAskBeforeUpload', () => {
  const online = [summary('a', 1000)];
  it('asks when this project is not online, never synced, and others are', () => {
    expect(shouldAskBeforeUpload('local', false, online)).toBe(true);
  });
  it('uploads straight away when nothing is online', () => {
    expect(shouldAskBeforeUpload('local', false, [])).toBe(false);
  });
  it("doesn't ask for a project that is already online or was synced before", () => {
    expect(shouldAskBeforeUpload('a', false, online)).toBe(false);
    expect(shouldAskBeforeUpload('local', true, online)).toBe(false);
  });
});
