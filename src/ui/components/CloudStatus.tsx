// Toolbar corner for online saving: "Sign in with Google", or the save status and an avatar menu with Sign out.
// Renders nothing when cloud save isn't configured. Also opens the (lazy) conflict dialog.

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Cloud } from '../cloud/useCloud';
import { statusLabel } from '../cloud/status';

const ConflictDialog = lazy(() => import('./ConflictDialog').then((m) => ({ default: m.ConflictDialog })));

export function CloudStatus({ cloud }: { cloud: Cloud }) {
  const [now, setNow] = useState(() => Date.now());
  const [menu, setMenu] = useState(false);
  const [later, setLater] = useState<object | null>(null); // the conflict put off with "Decide later"
  const box = useRef<HTMLDivElement>(null);
  const { user, state } = cloud;

  // Keeps "· 2 min ago" current.
  useEffect(() => {
    if (!user) return;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [user]);
  useEffect(() => setNow(Date.now()), [state]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  if (!cloud.available || user === undefined) return null;
  if (!user) {
    return (
      <button onClick={cloud.signIn} title="Save projects online and open them on any device">
        Sign in with Google
      </button>
    );
  }
  const conflict = state.conflict;
  // The label becomes a button where there's something to do: reopen the conflict, or sign in again.
  const act = conflict ? () => setLater(null) : state.status === 'auth' ? cloud.signIn : null;
  return (
    <div className="cloud" ref={box}>
      {act ? (
        <button className={`cloud-status cloud-${state.status}`} title={state.message ?? undefined} role="status" onClick={act}>
          {statusLabel(state, now)}
        </button>
      ) : (
        <span className={`cloud-status cloud-${state.status}`} title={state.message ?? undefined} role="status">
          {statusLabel(state, now)}
        </span>
      )}
      {conflict && later !== conflict && (
        <Suspense fallback={null}>
          <ConflictDialog conflict={conflict} local={cloud.project} onResolve={cloud.resolveConflict} onClose={() => setLater(conflict)} />
        </Suspense>
      )}
      <button className="cloud-avatar" onClick={() => setMenu((m) => !m)} title={user.email || user.name} aria-haspopup="menu" aria-expanded={menu}>
        {user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : <span>{(user.name || '?').slice(0, 1).toUpperCase()}</span>}
      </button>
      {menu && (
        <div className="cloud-menu" role="menu">
          <div className="cloud-who">
            <strong>{user.name}</strong>
            {user.email && user.email !== user.name && <span>{user.email}</span>}
          </div>
          <button
            role="menuitem"
            onClick={() => {
              setMenu(false);
              cloud.signOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
