/**
 * Live runs (decision 0016): a moment after every change (LIVE_DELAY_MS, about 200 ms) ngspice runs
 * the netlist again, and the results update in place. Plain TypeScript; React reads the state with
 * useSyncExternalStore.
 *
 * - Runs never overlap. While one runs, only the newest text waits; the ones in between are
 *   dropped, so the numbers always end on the text as it is now.
 * - Run (Ctrl+Enter) runs at once, whatever the state, and Stop stops the run in progress.
 * - Live runs pause when running again on every change would be a bad idea: the last run took longer
 *   than SLOW_RUN_MS, the netlist asks ngspice for very many points (a long .tran), the student
 *   stopped a run, a run timed out, or a link asked not to run when opened. While paused, a change
 *   only marks the numbers as old, and the status line says to press Run; a Run that comes back
 *   quickly turns live runs on again. (Very many points is judged again on every change: a netlist
 *   changed to ask for fewer runs live again at once.)
 * - A new circuit (an example, a link) starts afresh: a run still going for the old one is dropped
 *   (stopped when it is a slow one), and the pause is lifted. A link that asks to run (run=1) runs
 *   as if Run had been pressed, however many points it asks for.
 * - While ngspice itself is still loading (`ready`: the first visit downloads it), the run waits
 *   and says so (`running.loading`); Run turns into Stop only for a run that has been going for a
 *   while once ngspice is in, never for the download.
 */

/** The pause after a change before ngspice runs it. */
export const LIVE_DELAY_MS = 200;
/** A run longer than this pauses live runs: running it on every keystroke would keep ngspice busy. */
export const SLOW_RUN_MS = 1500;
/** A run that has taken this long so far turns Run into Stop. */
export const STOP_AFTER_MS = 300;

/** Why live runs wait for Run. */
export type LivePause =
  | { reason: 'slow'; ms: number }
  | { reason: 'long'; points: number }
  | { reason: 'stopped' }
  | { reason: 'timeout'; seconds: number }
  | { reason: 'link' };

/** What the last run gave, for the text it ran. */
export type LiveOutcome<R> =
  | { kind: 'none' }
  /** `manual`: Run asked for it (the Run button, Ctrl+Enter, Ctrl+K, a link that runs, a Run that waited), not a change. */
  | { kind: 'done'; text: string; result: R; manual?: boolean }
  /** No analysis line: ngspice would have nothing to do, so it was not asked. */
  | { kind: 'nothing'; text: string }
  | { kind: 'stopped'; text: string }
  | { kind: 'timeout'; text: string; seconds: number; points?: number }
  /**
   * `manual` as for 'done': a run Run asked for is said even when it fails for the reason said last.
   * `refused`: the text was never given to ngspice (`isRefused`), so it is no failure of ngspice's.
   */
  | { kind: 'failed'; text: string; reason: string; manual?: boolean; refused?: boolean };

export interface LiveState<R> {
  outcome: LiveOutcome<R>;
  /**
   * The run in progress: its text, whether it has taken long (Run becomes Stop), whether Run started
   * it, and whether it is still waiting for ngspice to load.
   */
  running: { text: string; slow: boolean; manual: boolean; loading?: boolean } | null;
  /** Live runs are paused (Run still runs). */
  paused?: LivePause;
  /** A text is waiting to run (the pause after a change, or the run in progress). */
  waiting: boolean;
}

/** What to do with a text before running it on its own. */
export type LivePlan = { run: true } | { run: false; reason: 'nothing' } | { run: false; reason: 'long'; points: number };

export interface LiveOptions<R> {
  /** Run one text in ngspice and read its results (rejects with the engine's errors). */
  solve: (text: string) => Promise<R>;
  /** How long ngspice took for a result, in ms (not counting loading ngspice). */
  msOf: (result: R) => number;
  /** Whether a text can run on its own: not without an analysis, nor when it asks for very many points. */
  plan: (text: string) => LivePlan;
  /** Stop the engine (it rejects the run in progress). */
  cancel: () => void;
  isCancelled: (error: unknown) => boolean;
  isTimeout: (error: unknown) => boolean;
  /** The run failed before ngspice was asked: a text PlainSpice does not give it. */
  isRefused?: (error: unknown) => boolean;
  /** The time limit the engine applies, in seconds (for the words). */
  timeoutSeconds: number;
  /** Points a netlist asks for, when that is many (for the time-out's words). */
  pointsOf?: (text: string) => number | undefined;
  /** Resolves once ngspice is loaded (the run waits for it, without counting it as running long). */
  ready?: () => Promise<unknown>;
  /** True while `ready` would still wait. */
  loading?: () => boolean;
  delayMs?: number;
  slowMs?: number;
  stopAfterMs?: number;
}

export interface LiveRunner<R> {
  getState(): LiveState<R>;
  subscribe(listener: () => void): () => void;
  /** The text changed: run it after a short pause (unless live runs are paused). */
  edited(text: string): void;
  /** Run (Ctrl+Enter): run this text now, even while paused. */
  run(text: string): void;
  /** Stop the run in progress. */
  stop(): void;
  /**
   * A new circuit: forget the old results; run it at once unless `run` is false (a link that asks
   * not to: live runs pause until Run). `manual`: run it as Run would, however many points it asks for.
   */
  load(text: string, options?: { run?: boolean; manual?: boolean }): void;
  /** Resolves when nothing runs or waits (tests). */
  idle(): Promise<void>;
  /** Forget the waiting timers (the page is going away; React's development mode also calls it and goes on). */
  dispose(): void;
}

export function createLiveRunner<R>(options: LiveOptions<R>): LiveRunner<R> {
  const delay = options.delayMs ?? LIVE_DELAY_MS;
  const slowMs = options.slowMs ?? SLOW_RUN_MS;
  const stopAfter = options.stopAfterMs ?? STOP_AFTER_MS;
  let state: LiveState<R> = { outcome: { kind: 'none' }, running: null, waiting: false };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  /** A text waiting for the run in progress to end. */
  let queued: { text: string; manual: boolean } | undefined;
  /** The run in progress belongs to this generation; a new circuit starts the next. */
  let generation = 0;
  let idlers: (() => void)[] = [];

  /** Change the state and tell the listeners; `pause` sets (or, with undefined, lifts) the pause. */
  const set = (next: Omit<Partial<LiveState<R>>, 'paused'>, pause?: { paused: LivePause | undefined }): void => {
    const merged: LiveState<R> = { ...state, ...next };
    if (pause) {
      if (pause.paused) merged.paused = pause.paused;
      else delete merged.paused;
    }
    state = merged;
    for (const l of Array.from(listeners)) l();
    if (!state.running && !state.waiting) {
      const done = idlers;
      idlers = [];
      for (const f of done) f();
    }
  };

  const request = (text: string, manual: boolean): void => {
    if (state.running) {
      // Newest wins: a manual Run is never replaced by a change typed after it.
      queued = { text, manual: manual || (queued?.manual ?? false) };
      set({ waiting: true });
      return;
    }
    void start(text, manual);
  };

  const start = async (text: string, manual: boolean): Promise<void> => {
    const plan = options.plan(text);
    if (!plan.run && plan.reason === 'nothing') {
      set({ outcome: { kind: 'nothing', text }, waiting: false });
      return;
    }
    if (!plan.run && plan.reason === 'long' && !manual) {
      set({ waiting: false }, { paused: { reason: 'long', points: plan.points } });
      return;
    }
    const gen = generation;
    const loading = options.loading?.() ?? false;
    set({ running: loading ? { text, slow: false, manual, loading: true } : { text, slow: false, manual }, waiting: queued !== undefined });
    clearTimeout(slowTimer);
    let outcome: LiveOutcome<R>;
    let paused: LivePause | undefined = state.paused;
    try {
      if (loading && options.ready) {
        await options.ready();
        if (gen !== generation) return;
        if (state.running?.text === text) set({ running: { text, slow: false, manual } });
      }
      // Run becomes Stop once ngspice has been at it for a while (not while it loads).
      slowTimer = setTimeout(() => {
        if (gen === generation && state.running?.text === text) set({ running: { ...state.running, slow: true } });
      }, stopAfter);
      const result = await options.solve(text);
      if (gen !== generation) return;
      outcome = { kind: 'done', text, result, manual };
      const ms = options.msOf(result);
      if (ms > slowMs) paused = { reason: 'slow', ms };
      // A Run that came back quickly turns live runs on again.
      else if (manual) paused = undefined;
    } catch (error) {
      if (gen !== generation) return;
      if (options.isCancelled(error)) {
        outcome = { kind: 'stopped', text };
        paused = { reason: 'stopped' };
        queued = undefined;
      } else if (options.isTimeout(error)) {
        const points = options.pointsOf?.(text);
        outcome = points === undefined ? { kind: 'timeout', text, seconds: options.timeoutSeconds } : { kind: 'timeout', text, seconds: options.timeoutSeconds, points };
        paused = { reason: 'timeout', seconds: options.timeoutSeconds };
        queued = undefined;
      } else {
        const reason = error instanceof Error ? error.message : String(error);
        outcome = options.isRefused?.(error) ? { kind: 'failed', text, reason, manual, refused: true } : { kind: 'failed', text, reason, manual };
      }
    } finally {
      if (gen === generation) clearTimeout(slowTimer);
    }
    const next = queued;
    queued = undefined;
    // The next text runs at once if live runs are on, or if Run asked for it.
    const runNext = next !== undefined && (next.manual || paused === undefined);
    set({ outcome, running: null, waiting: runNext }, { paused });
    if (runNext) void start(next.text, next.manual);
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    edited(text) {
      clearTimeout(timer);
      timer = undefined;
      if (state.paused?.reason === 'long') {
        // Asking for very many points is a property of the text: judged again on each change, so a
        // netlist changed to ask for fewer runs live again.
        const plan = options.plan(text);
        if (!plan.run && plan.reason === 'long') {
          if (plan.points !== state.paused.points) set({ waiting: false }, { paused: { reason: 'long', points: plan.points } });
          return;
        }
        set({}, { paused: undefined });
      } else if (state.paused) {
        // The numbers are now for an older text; nothing runs until Run.
        if (state.waiting && !state.running) set({ waiting: false });
        return;
      }
      const o = state.outcome;
      if (!state.running && o.kind === 'done' && o.text === text) return; // already solved (an undo back to it)
      set({ waiting: true });
      timer = setTimeout(() => {
        timer = undefined;
        request(text, false);
      }, delay);
    },
    run(text) {
      clearTimeout(timer);
      timer = undefined;
      request(text, true);
    },
    stop() {
      clearTimeout(timer);
      timer = undefined;
      queued = undefined;
      if (state.running) options.cancel();
      else if (state.waiting) set({ waiting: false });
    },
    load(text, { run = true, manual = false } = {}) {
      clearTimeout(timer);
      timer = undefined;
      queued = undefined;
      const wasSlow = state.running?.slow ?? false;
      generation += 1;
      clearTimeout(slowTimer);
      // A slow run of the old circuit is stopped; a quick one ends on its own, unseen.
      if (wasSlow) options.cancel();
      set({ outcome: { kind: 'none' }, running: null, waiting: false }, { paused: run ? undefined : { reason: 'link' } });
      if (run) request(text, manual);
    },
    idle: () => (state.running || state.waiting ? new Promise<void>((resolve) => idlers.push(resolve)) : Promise.resolve()),
    dispose() {
      clearTimeout(timer);
      timer = undefined;
      queued = undefined;
      if (state.waiting && !state.running) set({ waiting: false });
    },
  };
}
