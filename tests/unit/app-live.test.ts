/**
 * Live runs (src/app/live.ts, decision 0016): ngspice runs a moment after each change (about
 * 200 ms), runs never overlap and the newest text wins; Run runs at once; live runs pause when a run
 * is slow (over 1.5 s), when the netlist asks for very many points, after Stop or a time-out, and
 * when a link asks not to run; a quick Run turns them on again; a new circuit starts afresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveRunner, LIVE_DELAY_MS, SLOW_RUN_MS, STOP_AFTER_MS, type LivePlan, type LiveRunner } from '../../src/app/live.ts';

class Cancelled extends Error {}
class TimedOut extends Error {}
class Refused extends Error {}

interface Fake {
  live: LiveRunner<{ text: string; ms: number }>;
  started: string[];
  /** Finish the oldest unfinished run, taking `ms`. */
  finish: (ms?: number) => Promise<void>;
  fail: (error: Error) => Promise<void>;
  running: () => number;
  most: () => number;
  cancel: ReturnType<typeof vi.fn>;
  plans: Map<string, LivePlan>;
}

function fake(): Fake {
  const started: string[] = [];
  const pending: { text: string; resolve: (v: { text: string; ms: number }) => void; reject: (e: Error) => void }[] = [];
  let running = 0;
  let most = 0;
  const plans = new Map<string, LivePlan>();
  const cancel = vi.fn(() => {
    for (const p of pending.splice(0)) {
      running -= 1;
      p.reject(new Cancelled('stopped'));
    }
  });
  const live = createLiveRunner<{ text: string; ms: number }>({
    solve: (text) =>
      new Promise((resolve, reject) => {
        started.push(text);
        running += 1;
        most = Math.max(most, running);
        pending.push({ text, resolve, reject });
      }),
    msOf: (r) => r.ms,
    plan: (text) => plans.get(text) ?? { run: true },
    cancel,
    isCancelled: (e) => e instanceof Cancelled,
    isTimeout: (e) => e instanceof TimedOut,
    isRefused: (e) => e instanceof Refused,
    timeoutSeconds: 20,
    pointsOf: () => 250_000,
  });
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return {
    live,
    started,
    plans,
    cancel,
    running: () => running,
    most: () => most,
    finish: async (ms = 10) => {
      const p = pending.shift();
      if (!p) throw new Error('nothing is running');
      running -= 1;
      p.resolve({ text: p.text, ms });
      await settle();
    },
    fail: async (error) => {
      const p = pending.shift();
      if (!p) throw new Error('nothing is running');
      running -= 1;
      p.reject(error);
      await settle();
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('live runs', () => {
  it('run a moment after the last change, not on every keystroke', async () => {
    const f = fake();
    f.live.edited('R1 a 0 1');
    vi.advanceTimersByTime(LIVE_DELAY_MS - 50);
    f.live.edited('R1 a 0 1k');
    vi.advanceTimersByTime(LIVE_DELAY_MS - 1);
    expect(f.started).toEqual([]);
    expect(f.live.getState().waiting).toBe(true);
    vi.advanceTimersByTime(1);
    expect(f.started).toEqual(['R1 a 0 1k']);
    await f.finish();
    expect(f.live.getState().outcome).toMatchObject({ kind: 'done', text: 'R1 a 0 1k' });
    expect(f.live.getState().waiting).toBe(false);
  });

  it('never overlap: while one runs only the newest text waits, and it runs next', async () => {
    const f = fake();
    f.live.run('a');
    for (const text of ['ab', 'abc', 'abcd']) {
      f.live.edited(text);
      vi.advanceTimersByTime(LIVE_DELAY_MS);
    }
    expect(f.started).toEqual(['a']);
    await f.finish();
    expect(f.started).toEqual(['a', 'abcd']);
    await f.finish();
    expect(f.most()).toBe(1);
    expect(f.live.getState().outcome).toMatchObject({ kind: 'done', text: 'abcd' });
  });

  it('Run runs at once; a run that takes long turns Run into Stop, and Stop stops it', async () => {
    const f = fake();
    f.live.run('x');
    expect(f.started).toEqual(['x']);
    expect(f.live.getState().running).toEqual({ text: 'x', slow: false, manual: true });
    vi.advanceTimersByTime(STOP_AFTER_MS);
    expect(f.live.getState().running?.slow).toBe(true);
    f.live.stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(f.live.getState().outcome).toEqual({ kind: 'stopped', text: 'x' });
    expect(f.live.getState().paused).toEqual({ reason: 'stopped' });
  });

  it('pause after a slow run: changes then wait for Run, and a quick Run turns them on again', async () => {
    const f = fake();
    f.live.run('slow');
    await f.finish(SLOW_RUN_MS + 400);
    expect(f.live.getState().paused).toEqual({ reason: 'slow', ms: SLOW_RUN_MS + 400 });
    f.live.edited('slow, changed');
    vi.advanceTimersByTime(5 * LIVE_DELAY_MS);
    expect(f.started).toEqual(['slow']);
    f.live.run('slow, changed');
    expect(f.started).toEqual(['slow', 'slow, changed']);
    await f.finish(40);
    expect(f.live.getState().paused).toBeUndefined();
    f.live.edited('live again');
    vi.advanceTimersByTime(LIVE_DELAY_MS);
    expect(f.started.at(-1)).toBe('live again');
  });

  it('a slow live run also pauses: the change typed meanwhile waits for Run', async () => {
    const f = fake();
    f.live.edited('a');
    vi.advanceTimersByTime(LIVE_DELAY_MS);
    f.live.edited('ab');
    vi.advanceTimersByTime(LIVE_DELAY_MS);
    await f.finish(SLOW_RUN_MS + 1);
    expect(f.started).toEqual(['a']);
    expect(f.live.getState().paused?.reason).toBe('slow');
  });

  it('a netlist that asks for very many points does not run on its own; Run runs it', async () => {
    const f = fake();
    f.plans.set('long .tran', { run: false, reason: 'long', points: 250_000 });
    f.live.edited('long .tran');
    vi.advanceTimersByTime(LIVE_DELAY_MS);
    expect(f.started).toEqual([]);
    expect(f.live.getState().paused).toEqual({ reason: 'long', points: 250_000 });
    f.live.run('long .tran');
    expect(f.started).toEqual(['long .tran']);
  });

  it('a netlist changed to ask for fewer points runs live again; while it asks for many, only the count follows', async () => {
    const f = fake();
    f.plans.set('long', { run: false, reason: 'long', points: 250_000 });
    f.plans.set('longer', { run: false, reason: 'long', points: 500_000 });
    f.live.edited('long');
    vi.advanceTimersByTime(LIVE_DELAY_MS);
    expect(f.live.getState().paused).toEqual({ reason: 'long', points: 250_000 });
    f.live.edited('longer');
    expect(f.live.getState().paused).toEqual({ reason: 'long', points: 500_000 });
    expect(f.live.getState().waiting).toBe(false);
    f.live.edited('short');
    expect(f.live.getState().paused).toBeUndefined();
    vi.advanceTimersByTime(LIVE_DELAY_MS);
    expect(f.started).toEqual(['short']);
    await f.finish();
    expect(f.live.getState().outcome).toMatchObject({ kind: 'done', text: 'short' });
  });

  it('a netlist with nothing to run is not sent to ngspice', () => {
    const f = fake();
    f.plans.set('no analysis', { run: false, reason: 'nothing' });
    f.live.run('no analysis');
    expect(f.started).toEqual([]);
    expect(f.live.getState().outcome).toEqual({ kind: 'nothing', text: 'no analysis' });
  });

  it('a time-out pauses live runs and says how many points the netlist asks for', async () => {
    const f = fake();
    f.live.run('t');
    await f.fail(new TimedOut('20 s'));
    expect(f.live.getState().outcome).toEqual({ kind: 'timeout', text: 't', seconds: 20, points: 250_000 });
    expect(f.live.getState().paused).toEqual({ reason: 'timeout', seconds: 20 });
  });

  it('an engine error is reported, and live runs go on', async () => {
    const f = fake();
    f.live.run('e');
    await f.fail(new Error('ngspice could not load'));
    expect(f.live.getState().outcome).toEqual({ kind: 'failed', text: 'e', reason: 'ngspice could not load', manual: true });
    expect(f.live.getState().paused).toBeUndefined();
  });

  it('a failed run’s outcome says whether Run asked for it, as a finished one does (the last pass: C3-2)', async () => {
    const f = fake();
    f.live.edited('e');
    vi.advanceTimersByTime(LIVE_DELAY_MS);
    await f.fail(new Error('the same reason'));
    expect(f.live.getState().outcome).toEqual({ kind: 'failed', text: 'e', reason: 'the same reason', manual: false });
    f.live.run('e');
    await f.fail(new Error('the same reason'));
    expect(f.live.getState().outcome).toEqual({ kind: 'failed', text: 'e', reason: 'the same reason', manual: true });
  });

  it('a text that was never given to ngspice fails as refused, so the words do not blame ngspice (the last pass: C3-4)', async () => {
    const f = fake();
    f.live.run('refused');
    await f.fail(new Refused('Line 4: why'));
    expect(f.live.getState().outcome).toEqual({ kind: 'failed', text: 'refused', reason: 'Line 4: why', manual: true, refused: true });
    expect(f.live.getState().paused).toBeUndefined();
  });

  it('a new circuit starts afresh: the old run is dropped, the pause lifted, the new one runs at once', async () => {
    const f = fake();
    f.live.run('old');
    await f.finish(SLOW_RUN_MS + 1);
    expect(f.live.getState().paused?.reason).toBe('slow');
    f.live.run('old, again');
    f.live.load('new circuit');
    expect(f.live.getState().paused).toBeUndefined();
    expect(f.live.getState().outcome).toEqual({ kind: 'none' });
    // The old run was quick so far: it ends unseen, and the new circuit runs after it.
    await f.finish(5);
    expect(f.live.getState().outcome).toEqual({ kind: 'none' });
    expect(f.started.at(-1)).toBe('new circuit');
    await f.finish(5);
    expect(f.live.getState().outcome).toMatchObject({ kind: 'done', text: 'new circuit' });
  });

  it('a new circuit stops a slow run of the old one', () => {
    const f = fake();
    f.live.run('slow old');
    vi.advanceTimersByTime(STOP_AFTER_MS);
    f.live.load('new');
    expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(f.started).toEqual(['slow old', 'new']);
  });

  it('a link that asks not to run waits for Run; then live runs go on', async () => {
    const f = fake();
    f.live.load('from a link', { run: false });
    expect(f.started).toEqual([]);
    expect(f.live.getState().paused).toEqual({ reason: 'link' });
    f.live.edited('from a link, changed');
    vi.advanceTimersByTime(LIVE_DELAY_MS);
    expect(f.started).toEqual([]);
    f.live.run('from a link, changed');
    await f.finish();
    expect(f.live.getState().paused).toBeUndefined();
  });

  it('an undo back to the text just solved runs nothing', async () => {
    const f = fake();
    f.live.run('a');
    await f.finish();
    f.live.edited('a');
    vi.advanceTimersByTime(LIVE_DELAY_MS);
    expect(f.started).toEqual(['a']);
  });

  it('a run’s outcome says whether Run asked for it: Run, a Run that waited for the run before it, a link that runs; not a change (AP-3)', async () => {
    const f = fake();
    f.live.edited('a');
    vi.advanceTimersByTime(LIVE_DELAY_MS);
    await f.finish();
    expect(f.live.getState().outcome).toMatchObject({ kind: 'done', text: 'a', manual: false });
    f.live.run('a');
    await f.finish();
    expect(f.live.getState().outcome).toMatchObject({ kind: 'done', text: 'a', manual: true });
    // Run pressed while a change runs: the change's outcome is not Run's, the one after it is.
    f.live.edited('ab');
    vi.advanceTimersByTime(LIVE_DELAY_MS);
    f.live.run('ab');
    await f.finish();
    expect(f.live.getState().outcome).toMatchObject({ kind: 'done', text: 'ab', manual: false });
    await f.finish();
    expect(f.live.getState().outcome).toMatchObject({ kind: 'done', text: 'ab', manual: true });
    f.live.load('link', { manual: true });
    await f.finish();
    expect(f.live.getState().outcome).toMatchObject({ kind: 'done', text: 'link', manual: true });
  });

  it('idle() resolves when nothing runs or waits', async () => {
    const f = fake();
    f.live.edited('a');
    let done = false;
    void f.live.idle().then(() => (done = true));
    vi.advanceTimersByTime(LIVE_DELAY_MS);
    await Promise.resolve();
    expect(done).toBe(false);
    await f.finish();
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it('a link that asks to run (run=1) runs as Run would, however many points it asks for', async () => {
    const f = fake();
    f.plans.set('long link', { run: false, reason: 'long', points: 250_000 });
    f.live.load('long link', { run: true, manual: true });
    expect(f.started).toEqual(['long link']);
    // An example opened is a live run: a long one waits for Run.
    f.plans.set('long example', { run: false, reason: 'long', points: 250_000 });
    f.live.load('long example', { run: true });
    expect(f.started).toEqual(['long link']);
    expect(f.live.getState().paused).toEqual({ reason: 'long', points: 250_000 });
  });

  it('while ngspice loads, the run waits and says so; Run turns into Stop only once ngspice is in', async () => {
    let loaded = false;
    let release: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => (release = resolve));
    const started: string[] = [];
    const live = createLiveRunner<{ ms: number }>({
      solve: (text) => {
        started.push(text);
        return new Promise(() => undefined);
      },
      msOf: (r) => r.ms,
      plan: () => ({ run: true }),
      cancel: () => undefined,
      isCancelled: () => false,
      isTimeout: () => false,
      timeoutSeconds: 20,
      ready: () => ready.then(() => (loaded = true)),
      loading: () => !loaded,
    });
    live.load('first screen');
    expect(live.getState().running).toMatchObject({ text: 'first screen', loading: true, slow: false });
    // However long the download takes, it is not a slow run: Run stays Run.
    vi.advanceTimersByTime(STOP_AFTER_MS * 20);
    expect(live.getState().running).toMatchObject({ loading: true, slow: false });
    expect(started).toEqual([]);
    release();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(started).toEqual(['first screen']);
    expect(live.getState().running?.loading).toBeUndefined();
    vi.advanceTimersByTime(STOP_AFTER_MS);
    expect(live.getState().running?.slow).toBe(true);
  });
});
