// Conflict dialog: the open project was changed on this device and online since this device last synced it. Shows
// both versions and offers the three choices of resolveConflict. Loaded with React.lazy from CloudStatus.tsx, so it
// stays out of the main chunk.

import { useEffect, useState } from 'react';
import type { Resolution } from '../../engine/cloudSync';
import type { Project } from '../../engine/model';
import type { ConflictOutcome } from '../cloud/status';
import './ConflictDialog.css';

interface Props {
  conflict: ConflictOutcome;
  /** This device's version as it is now (edits made since the conflict count). */
  local: Project;
  /** Resolves to an error message, or null once resolved. */
  onResolve: (choice: Resolution) => Promise<string | null>;
  /** "Decide later": online saving of this project stays paused. */
  onClose: () => void;
}

export function ConflictDialog({ conflict, local, onResolve, onClose }: Props) {
  const [busy, setBusy] = useState<Resolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remote = conflict.remote;

  // A newer conflict (another device saved again while this was open) replaces the old error.
  useEffect(() => setError(null), [conflict]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const choose = async (choice: Resolution) => {
    setBusy(choice);
    setError(null);
    try {
      setError(await onResolve(choice));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal conflict" role="alertdialog" aria-labelledby="conflict-title" aria-describedby="conflict-what">
        <div className="modal-head">
          <h3 id="conflict-title">Changed in two places</h3>
        </div>
        <div className="modal-body">
          <p id="conflict-what">
            {conflict.message} Nothing has been overwritten. Choose which version to keep. Until you do, this project is
            only saved on this device.
          </p>
          <div className="conflict-versions">
            <Version label="This device" project={local} />
            {remote ? <Version label="Online (saved from another device)" project={remote} /> : <div className="conflict-version"><h4>Online</h4><p className="muted">Deleted online, or couldn't be read.</p></div>}
          </div>
          <div className="conflict-choices">
            <button className="primary" onClick={() => void choose('keep-local')} disabled={busy !== null}>
              {busy === 'keep-local' ? 'Saving…' : "Keep this device's version"}
              <span>Replaces the online version.</span>
            </button>
            <button onClick={() => void choose('keep-remote')} disabled={busy !== null || !remote}>
              {busy === 'keep-remote' ? 'Opening…' : 'Keep the online version'}
              <span>Opens it here. Undo brings this device's version back.</span>
            </button>
            <button onClick={() => void choose('copy')} disabled={busy !== null}>
              {busy === 'copy' ? 'Saving…' : "Save this device's version as a copy"}
              <span>
                Saves "{local.name} (copy)" online and opens it. The online version stays as it is.
              </span>
            </button>
          </div>
          {error && <p className="err" role="alert">{error}</p>}
          <div className="modal-foot">
            <button onClick={onClose} disabled={busy !== null} title="Online saving of this project stays paused">
              Decide later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Version({ label, project }: { label: string; project: Project }) {
  return (
    <div className="conflict-version">
      <h4>{label}</h4>
      <strong>{project.name || 'Untitled'}</strong>
      <span className="muted">Last edited {edited(project.updatedAt)}</span>
    </div>
  );
}

function edited(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'at an unknown time';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
