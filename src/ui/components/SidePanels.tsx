import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

// Collapsible, resizable left and right side panels (like Figma). Saved with the view state.
export type SidePanels = { left: boolean; right: boolean; leftW: number; rightW: number };

export const PANEL_DEFAULTS: SidePanels = { left: true, right: true, leftW: 250, rightW: 320 };
const MIN_W = 180;
const MAX_W = 520;
// Below this window width the properties panel collapses by itself (it can be reopened).
const NARROW = 900;

const clampW = (w: number) => Math.round(Math.max(MIN_W, Math.min(MAX_W, w)));

export function useSidePanels(saved: Partial<SidePanels> | undefined) {
  const [s, setS] = useState<SidePanels>(() => {
    const v = { ...PANEL_DEFAULTS, ...saved };
    return { ...v, leftW: clampW(v.leftW), rightW: clampW(v.rightW), right: v.right && window.innerWidth >= NARROW };
  });
  // Which panels Cmd/Ctrl+\ hid, so pressing it again brings back just those.
  const hidden = useRef<{ left: boolean; right: boolean } | null>(null);

  useEffect(() => {
    let wasNarrow = window.innerWidth < NARROW;
    const onResize = () => {
      const narrow = window.innerWidth < NARROW;
      if (narrow && !wasNarrow) setS((p) => ({ ...p, right: false }));
      wasNarrow = narrow;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggle = (side: 'left' | 'right') => {
    hidden.current = null;
    setS((p) => ({ ...p, [side]: !p[side] }));
  };
  const toggleBoth = () =>
    setS((p) => {
      if (p.left || p.right) {
        hidden.current = { left: p.left, right: p.right };
        return { ...p, left: false, right: false };
      }
      const back = hidden.current ?? { left: true, right: true };
      hidden.current = null;
      return { ...p, ...back };
    });
  const setWidth = (side: 'left' | 'right', w: number) => setS((p) => ({ ...p, [side === 'left' ? 'leftW' : 'rightW']: clampW(w) }));

  return { panels: s, toggle, toggleBoth, setWidth };
}

const MOD = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘' : 'Ctrl+';
const ALT = MOD === '⌘' ? '⌥' : 'Alt+';

export function PanelToggle({ side, open, onClick }: { side: 'left' | 'right'; open: boolean; onClick: () => void }) {
  const name = side === 'left' ? 'panels list' : 'properties';
  const keys = `${MOD}${ALT}${side === 'left' ? '[' : ']'} · ${MOD}\\ hides both`;
  return (
    <button className={`panel-toggle ${side}${open ? '' : ' closed'}`} onClick={onClick} title={`${open ? 'Hide' : 'Show'} ${name} (${keys})`} aria-label={`${open ? 'Hide' : 'Show'} ${name}`} aria-pressed={open}>
      <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
        <rect x="0.75" y="0.75" width="14.5" height="12.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <rect x={side === 'left' ? 1.5 : 10} y="1.5" width="4.5" height="11" fill="currentColor" opacity={open ? 1 : 0.25} />
      </svg>
    </button>
  );
}

// The border between a side panel and the canvas: drag to resize, double-click for the default width.
export function PanelDivider({ side, width, setWidth }: { side: 'left' | 'right'; width: number; setWidth: (w: number) => void }) {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => setWidth(width + (side === 'left' ? ev.clientX - x0 : x0 - ev.clientX));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing-panel');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    document.body.classList.add('resizing-panel');
  };
  return (
    <div
      className={`panel-divider ${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => setWidth(side === 'left' ? PANEL_DEFAULTS.leftW : PANEL_DEFAULTS.rightW)}
    />
  );
}
