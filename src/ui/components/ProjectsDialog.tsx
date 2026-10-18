// Projects dialog (signed in): the online projects, newest first, with Open, Rename, Duplicate and Delete, plus
// "Open from file…". In 'ask' mode (first sign-in) it also offers to upload the open project. Loaded with
// React.lazy from App.tsx, so this file and the sync code it pulls in stay out of the main chunk.

import { useCallback, useEffect, useState } from 'react';
import { checkName, deleteOnline, duplicateOnline, fetchProject, renameOnline, sortProjects } from '../../engine/cloudProjects';
import type { ProjectRemote, RemoteSummary } from '../../engine/cloudSync';
import type { Project } from '../../engine/model';
import type { LoadResult } from '../../engine/schema';
import type { Cloud } from '../cloud/useCloud';
import './ProjectsDialog.css';

type Loaded = Extract<LoadResult, { ok: true }>;

interface Props {
  cloud: Cloud;
  remote: ProjectRemote;
  /** The open project. */
  project: Project;
  /** Opens a loaded project the way Open… does (replace, select, notices). */
  onOpen: (r: Loaded, title: string) => void;
  onOpenFile: () => void;
  /** Starts a fresh sample project (after deleting the last online one). */
  onSample: (title: string) => void;
  /** Renames the open project in the app; its cloud save carries the name. */
  onRenameOpen: (name: string) => void;
}

export function ProjectsDialog({ cloud, remote, project, onOpen, onOpenFile, onSample, onRenameOpen }: Props) {
  const [list, setList] = useState<RemoteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // id of the row being worked on, or '*'
  const [renaming, setRenaming] = useState<{ id: string; draft: string; error: string | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const close = cloud.closeProjects;
  const localOnly = cloud.state.status === 'not-uploaded';

  const reload = useCallback(async () => {
    try {
      await cloud.flush(); // so the open project's latest edit is in the list
      setList(sortProjects(await remote.list()));
      setError(null);
    } catch (e) {
      setError(`Couldn't load your online projects: ${(e as Error).message}`);
    }
  }, [cloud.flush, remote]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !renaming && !confirmDelete && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, renaming, confirmDelete]);

  /** Runs one row action, showing errors in the dialog. */
  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(`Something went wrong online: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const open = (s: RemoteSummary) =>
    act(s.id, async () => {
      const got = await fetchProject(remote, s.id);
      if (!got) {
        setError(`"${s.name}" is no longer online.`);
        return reload();
      }
      if (!got.result.ok) {
        setError([`Could not open "${s.name}".`, ...got.result.errors].join(' '));
        return;
      }
      cloud.opened(got.result.project, got.doc.updatedAt);
      onOpen(got.result, `Opened "${got.result.project.name}"`);
      close();
    });

  const rename = (s: RemoteSummary, draft: string) => {
    const check = checkName(draft);
    if (!check.ok) return setRenaming({ id: s.id, draft, error: check.error });
    if (check.name === s.name) return setRenaming(null);
    if (s.id === project.id) {
      onRenameOpen(check.name);
      setList((l) => l && l.map((x) => (x.id === s.id ? { ...x, name: check.name } : x)));
      return setRenaming(null);
    }
    void act(s.id, async () => {
      const r = await renameOnline(remote, s.id, check.name);
      if (!r.ok) return setRenaming({ id: s.id, draft, error: r.error });
      setRenaming(null);
      await reload();
    });
  };

  const duplicate = (s: RemoteSummary) =>
    act(s.id, async () => {
      const r = await duplicateOnline(remote, s.id, project);
      if (!r.ok) return setError(r.error);
      await reload();
    });

  const remove = (s: RemoteSummary) =>
    act(s.id, async () => {
      setConfirmDelete(null);
      const isOpen = s.id === project.id;
      if (isOpen) cloud.forget(s.id); // before the delete, so a pending save can't bring it back
      let r: Awaited<ReturnType<typeof deleteOnline>>;
      try {
        r = await deleteOnline(remote, s.id, project.id);
      } catch (e) {
        if (isOpen && (await remote.get(s.id).catch(() => null))) cloud.forget(s.id, false); // still online: keep saving it
        throw e;
      }
      if (r.next === null) return reload();
      if (r.next.open === 'online' && r.fetched?.result.ok) {
        cloud.opened(r.fetched.result.project, r.fetched.doc.updatedAt);
        onOpen(r.fetched.result, `Deleted "${s.name}" and opened "${r.fetched.result.project.name}"`);
      } else {
        onSample(`Deleted "${s.name}". Nothing else is online, so a new sample project is open.`);
      }
      close();
    });

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal projects" role="dialog" aria-label="Projects">
        <div className="modal-head">
          <h3>Projects</h3>
          <button className="icon" onClick={close} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {localOnly && (
            <div className="projects-ask" role="status">
              <p>
                <strong>"{project.name}"</strong> is only on this device. Upload it to keep it with your online projects, or open one of them below.
              </p>
              <button
                className="primary"
                onClick={() => {
                  cloud.uploadNow();
                  close();
                }}
              >
                Upload this project
              </button>
            </div>
          )}
          {error && <p className="err">{error}</p>}
          {list === null ? (
            !error && <p className="muted">Loading your projects…</p>
          ) : list.length === 0 ? (
            <p className="muted">No projects online yet. The open project saves online as you edit.</p>
          ) : (
            <ul className="projects-list">
              {list.map((s) => {
                const isOpen = s.id === project.id;
                const rowBusy = busy === s.id;
                return (
                  <li key={s.id} className={isOpen ? 'open' : ''} aria-busy={rowBusy}>
                    {renaming?.id === s.id ? (
                      <form
                        className="projects-rename"
                        onSubmit={(e) => {
                          e.preventDefault();
                          rename(s, renaming.draft);
                        }}
                      >
                        <input
                          autoFocus
                          value={renaming.draft}
                          aria-label="New name"
                          onChange={(e) => setRenaming({ id: s.id, draft: e.target.value, error: null })}
                          onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                        />
                        <button type="submit" disabled={rowBusy}>Rename</button>
                        <button type="button" onClick={() => setRenaming(null)}>Cancel</button>
                        {renaming.error && <span className="err">{renaming.error}</span>}
                      </form>
                    ) : (
                      <>
                        <div className="projects-name">
                          <strong>{s.name || 'Untitled'}</strong>
                          {isOpen && <span className="projects-tag">open</span>}
                          <span className="muted">{edited(s.editedAt)}</span>
                        </div>
                        {confirmDelete === s.id ? (
                          <div className="projects-actions">
                            <span>Delete{isOpen ? ' the open project' : ''}?</span>
                            <button className="danger" onClick={() => void remove(s)}>Delete</button>
                            <button onClick={() => setConfirmDelete(null)}>Cancel</button>
                          </div>
                        ) : (
                          <div className="projects-actions">
                            <button onClick={() => void open(s)} disabled={isOpen || busy !== null}>Open</button>
                            <button onClick={() => setRenaming({ id: s.id, draft: s.name, error: null })} disabled={busy !== null}>Rename</button>
                            <button onClick={() => void duplicate(s)} disabled={busy !== null}>Duplicate</button>
                            <button className="danger" onClick={() => setConfirmDelete(s.id)} disabled={busy !== null}>Delete</button>
                          </div>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="modal-foot">
            <button
              onClick={() => {
                close();
                onOpenFile();
              }}
              title="Open a .knitbit.json file"
            >
              Open from file…
            </button>
            <span className="spacer" />
            <button onClick={close}>{localOnly ? 'Not now' : 'Close'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function edited(at: number | null): string {
  if (at === null) return '';
  const d = new Date(at);
  const today = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `edited today ${time}`;
  return `edited ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })}`;
}
