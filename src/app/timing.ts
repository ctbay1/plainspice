/** Small timing helpers (debounce, idle callbacks) used by the app shell. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
  /** Run now if a call is waiting. */
  flush(): void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: A | undefined;
  const d = ((...args: A) => {
    last = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const a = last!;
      last = undefined;
      fn(...a);
    }, ms);
  }) as Debounced<A>;
  d.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    last = undefined;
  };
  d.flush = () => {
    if (timer === undefined || !last) return;
    clearTimeout(timer);
    timer = undefined;
    const a = last;
    last = undefined;
    fn(...a);
  };
  return d;
}

/** Run when the browser is idle (or soon, where requestIdleCallback is missing, e.g. Safari). */
export function whenIdle(fn: () => void, timeout = 2000): () => void {
  const w = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(fn, { timeout });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, 200);
  return () => clearTimeout(id);
}

/**
 * A debounced function that is the same object for the component's whole life and always calls
 * the newest `fn` (so it can be handed to the editor once). When the component goes away, a waiting
 * call is cancelled, or made at once with `flushOnUnmount` (e.g. saving the last edits).
 */
export function useDebounced<A extends unknown[]>(fn: (...args: A) => void, ms: number, { flushOnUnmount = false } = {}): Debounced<A> {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  // The ref is read when the debounced call fires (an event), not while rendering; the rule
  // cannot see that debounce() only schedules its function.
  // oxlint-disable-next-line react/refs
  const [debounced] = useState(() => debounce((...args: A) => latest.current(...args), ms));
  useEffect(() => () => (flushOnUnmount ? debounced.flush() : debounced.cancel()), [debounced, flushOnUnmount]);
  return debounced;
}
