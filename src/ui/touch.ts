// Touch support shared by the canvases: two-finger pinch and pan, double taps, and whether the
// last pointer was a finger (to draw bigger hit areas). Mouse, trackpad and pen go through untouched.
import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';

export interface Pt {
  x: number;
  y: number;
}
/** A canvas view: screen = (ox, oy) + world × scale. */
export interface ZoomView {
  scale: number;
  ox: number;
  oy: number;
}
/** One step of a two-finger gesture: zoom by `k`, and the point under `from` moves to `to`. */
export interface PinchStep {
  k: number;
  from: Pt;
  to: Pt;
}

/** Finger movement → pinch step: the distance ratio, and the midpoint before and after. */
export function pinchStep(before: [Pt, Pt], after: [Pt, Pt]): PinchStep {
  const d0 = Math.hypot(before[1].x - before[0].x, before[1].y - before[0].y);
  const d1 = Math.hypot(after[1].x - after[0].x, after[1].y - after[0].y);
  const mid = (p: [Pt, Pt]) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
  return { k: d0 > 0 && d1 > 0 ? d1 / d0 : 1, from: mid(before), to: mid(after) };
}

/** Zoom a view by `k` (scale clamped to min…max) keeping the point under `at` fixed, then move that point to `to`. */
export function zoomView(v: ZoomView, k: number, at: Pt, min: number, max: number, to: Pt = at): ZoomView {
  const scale = Math.min(max, Math.max(min, v.scale * k));
  const f = scale / v.scale;
  return { scale, ox: to.x - (at.x - v.ox) * f, oy: to.y - (at.y - v.oy) * f };
}

/** Applies a pinch step to a view. */
export const pinchView = (v: ZoomView, s: PinchStep, min: number, max: number) => zoomView(v, s.k, s.from, min, max, s.to);

/** How far (px) a finger moves before a press becomes a drag; a mouse uses 3. */
export const TOUCH_SLOP = 8;
export const slop = (e: { pointerType: string }) => (e.pointerType === 'touch' ? TOUCH_SLOP : 3);

/** Asks the store to drop an unfinished drag's edit (the coalesce key it was made with); a pinch interrupted it. */
export const cancelDrag = (key: string) => window.dispatchEvent(new CustomEvent('knitbit:cancel-drag', { detail: key }));

interface PinchHandlers {
  /** A second finger landed: drop any one-finger edit or pan in progress. */
  start: () => void;
  /** Fingers moved; points are relative to the element's top-left corner. */
  move: (s: PinchStep) => void;
}

/**
 * Two-finger pinch zoom and pan on an element. From the moment a second finger lands until every finger is lifted,
 * the fingers' pointer events stop at the element (React handlers never see them), so no edit starts.
 * Returns a function telling whether any finger is down (to ignore Safari's gesture events meanwhile).
 */
export function usePinch(ref: RefObject<HTMLElement | null>, handlers: PinchHandlers) {
  const h = useRef(handlers);
  useEffect(() => {
    h.current = handlers;
  });
  const s = useRef({ pts: new Map<number, Pt>(), pinching: false, el: null as HTMLElement | null, off: () => {} });

  // The element can change (canvases render different wrappers per mode), so rebind when it does.
  useEffect(() => {
    const st = s.current;
    const el = ref.current;
    if (el === st.el) return;
    st.off();
    st.el = el;
    st.pts.clear();
    st.pinching = false;
    if (!el) return;
    const pair = (): [Pt, Pt] => {
      const [a, b] = [...st.pts.values()];
      return [a, b];
    };
    const local = (p: Pt, r: DOMRect) => ({ x: p.x - r.left, y: p.y - r.top });
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      st.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (st.pts.size < 2) return;
      e.stopPropagation();
      e.preventDefault();
      if (!st.pinching) {
        st.pinching = true;
        h.current.start();
      }
    };
    const move = (e: PointerEvent) => {
      if (!st.pts.has(e.pointerId)) return;
      if (!st.pinching) {
        st.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      const before = st.pts.size >= 2 ? pair() : null;
      st.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!before) return;
      const after = pair();
      if (before[0] === after[0] && before[1] === after[1]) return; // a third finger moved
      const r = el.getBoundingClientRect();
      const step = pinchStep(before, after);
      h.current.move({ k: step.k, from: local(step.from, r), to: local(step.to, r) });
    };
    const up = (e: PointerEvent) => {
      if (!st.pts.delete(e.pointerId)) return;
      if (!st.pinching) return;
      e.stopPropagation();
      if (!st.pts.size) st.pinching = false;
    };
    // Safari also reports a touch pinch as gesture events, and would zoom the page with them.
    const gesture = (e: Event) => st.pts.size && e.preventDefault();
    const opts = { capture: true, passive: false };
    el.addEventListener('pointerdown', down, opts);
    el.addEventListener('pointermove', move, opts);
    el.addEventListener('pointerup', up, opts);
    el.addEventListener('pointercancel', up, opts);
    el.addEventListener('gesturestart', gesture, opts);
    el.addEventListener('gesturechange', gesture, opts);
    st.off = () => {
      el.removeEventListener('pointerdown', down, opts);
      el.removeEventListener('pointermove', move, opts);
      el.removeEventListener('pointerup', up, opts);
      el.removeEventListener('pointercancel', up, opts);
      el.removeEventListener('gesturestart', gesture, opts);
      el.removeEventListener('gesturechange', gesture, opts);
    };
  });
  useEffect(
    () => () => {
      s.current.off();
      s.current.off = () => {};
      s.current.el = null; // rebind if mounted again (StrictMode does that)
    },
    [],
  );
  return () => s.current.pts.size > 0;
}

// ---- double tap (a browser's own dblclick isn't reliable on touch screens) ----

let lastTap = { t: -1e9, x: 0, y: 0 };
let lastDouble = -1e9;

/** Call on a touch tap (a press that didn't move); true when it is the second of a double tap. */
export function isDoubleTap(e: { pointerType: string; clientX: number; clientY: number }): boolean {
  if (e.pointerType !== 'touch') return false;
  const now = performance.now();
  const double = now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24;
  lastTap = double ? { t: -1e9, x: 0, y: 0 } : { t: now, x: e.clientX, y: e.clientY };
  if (double) lastDouble = now;
  return double;
}
/** True right after a touch double tap was handled, so a dblclick the browser sends for it is ignored. */
export const handledDoubleTap = () => performance.now() - lastDouble < 600;

// ---- was the last pointer a finger? ----

let touchUi = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const subs = new Set<() => void>();
const onAnyDown = (e: PointerEvent) => {
  const t = e.pointerType === 'touch';
  if (t === touchUi) return;
  touchUi = t;
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  if (!subs.size) window.addEventListener('pointerdown', onAnyDown, true);
  subs.add(f);
  return () => {
    subs.delete(f);
    if (!subs.size) window.removeEventListener('pointerdown', onAnyDown, true);
  };
};
/** True while the user is using fingers (a coarse screen until another pointer is used): draw bigger hit areas. */
export const useTouchUi = () => useSyncExternalStore(subscribe, () => touchUi, () => false);
