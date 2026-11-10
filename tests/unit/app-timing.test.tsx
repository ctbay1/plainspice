// @vitest-environment jsdom
/**
 * The app's timing helpers (src/app/timing.ts): the debounce behind "check after a pause in typing"
 * and the autosave, and the hook that keeps one debounced function for a component's whole life
 * (and saves the last edits when the app goes away).
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce, useDebounced, whenIdle } from '../../src/app/timing.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('debounce', () => {
  it('calls once, with the last arguments, after the pause', () => {
    const fn = vi.fn();
    const d = debounce(fn, 150);
    d(1);
    vi.advanceTimersByTime(100);
    d(2);
    vi.advanceTimersByTime(149);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('flush calls a waiting call now; cancel drops it; neither calls when nothing waits', () => {
    const fn = vi.fn();
    const d = debounce(fn, 150);
    d.flush();
    expect(fn).not.toHaveBeenCalled();
    d('a');
    d.flush();
    expect(fn).toHaveBeenCalledExactlyOnceWith('a');
    d('b');
    d.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('useDebounced', () => {
  it('is the same function across renders and calls the newest callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ fn }) => useDebounced(fn, 100), { initialProps: { fn: first } });
    const d = result.current;
    rerender({ fn: second });
    expect(result.current).toBe(d);
    d();
    vi.advanceTimersByTime(100);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('on unmount: cancels by default, or makes the waiting call (the last autosave)', () => {
    const dropped = vi.fn();
    const saved = vi.fn();
    const a = renderHook(() => useDebounced(dropped, 500));
    const b = renderHook(() => useDebounced(saved, 500, { flushOnUnmount: true }));
    a.result.current();
    b.result.current();
    a.unmount();
    b.unmount();
    vi.advanceTimersByTime(1000);
    expect(dropped).not.toHaveBeenCalled();
    expect(saved).toHaveBeenCalledTimes(1);
  });
});

describe('whenIdle', () => {
  it('runs soon where requestIdleCallback is missing, and can be cancelled', () => {
    const fn = vi.fn();
    whenIdle(fn);
    const cancel = whenIdle(() => fn('never'));
    cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledExactlyOnceWith();
  });
});
