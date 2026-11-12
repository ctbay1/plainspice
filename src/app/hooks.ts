/** Small React hooks for the shell: media queries, the on-screen keyboard, where an element is, the text size. */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

/** A media query's current answer, kept up to date. */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mq = globalThis.matchMedia?.(query);
      mq?.addEventListener('change', cb);
      return () => mq?.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => globalThis.matchMedia?.(query).matches ?? false, () => false);
}

/**
 * How much of the window an on-screen keyboard covers, in pixels (visualViewport: the part of the
 * page the reader can see). 0 with no keyboard, or where the browser shrinks the page for it.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const update = (): void => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}

export interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}
export const NO_RECT: Rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
const sameRect = (a: Rect, b: Rect): boolean => Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

/** Where an element is on the screen, kept up to date (size changes and window resizes). */
export function useRect<T extends HTMLElement>(): [(el: T | null) => void, Rect] {
  const [rect, setRect] = useState<Rect>(NO_RECT);
  const stop = useRef<(() => void) | undefined>(undefined);
  const ref = useCallback((el: T | null) => {
    stop.current?.();
    stop.current = undefined;
    if (!el) {
      setRect(NO_RECT);
      return;
    }
    const update = (): void => {
      const r = el.getBoundingClientRect();
      const next = { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      setRect((old) => (sameRect(old, next) ? old : next));
    };
    update();
    const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    ro?.observe(el);
    window.addEventListener('resize', update);
    stop.current = () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
  return [ref, rect];
}

/**
 * Whether an element's content is taller than the element itself (so it scrolls), kept up to date as
 * either changes: the element's size (a window resized, the stack around it squeezed), its children's
 * sizes (the words in them wrapping again), and what is in it (other words, a child replaced by another,
 * which is then watched in its turn).
 */
export function useOverflowing<T extends HTMLElement>(): [(el: T | null) => void, boolean] {
  const [over, setOver] = useState(false);
  const stop = useRef<(() => void) | undefined>(undefined);
  const ref = useCallback((el: T | null) => {
    stop.current?.();
    stop.current = undefined;
    if (!el) {
      setOver(false);
      return;
    }
    const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => update());
    const update = (): void => {
      setOver(el.scrollHeight > el.clientHeight + 1);
      // Watching an element already watched does nothing; a new child is watched from now on.
      for (const child of el.children) ro?.observe(child);
    };
    ro?.observe(el);
    const mo = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(update);
    mo?.observe(el, { childList: true, subtree: true, characterData: true });
    update();
    stop.current = () => {
      ro?.disconnect();
      mo?.disconnect();
    };
  }, []);
  return [ref, over];
}

/** The window's size, kept up to date. */
export function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: globalThis.innerWidth ?? 0, height: globalThis.innerHeight ?? 0 }));
  useEffect(() => {
    const update = (): void => setSize((old) => (old.width === window.innerWidth && old.height === window.innerHeight ? old : { width: window.innerWidth, height: window.innerHeight }));
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return size;
}

/** The page's text size against the usual 16 px: 1.25 and 1.5 with the Text size setting, more where the device asks. */
function readTextScale(): number {
  if (typeof document === 'undefined') return 1;
  const px = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(px) && px > 0 ? px / 16 : 1;
}

/**
 * The text size (see readTextScale), read again when `changed` changes (the Text size setting, which
 * is on <html> before the render that follows it) or the window's width does (a browser's zoom).
 */
export function useTextScale(changed: unknown, width: number): number {
  // Read from the page as it is: both keys are what can change it.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(readTextScale, [changed, width]);
}
