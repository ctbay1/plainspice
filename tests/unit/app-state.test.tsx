/**
 * The app's state reducer and the small decisions around it (src/app/state.ts): what a run does to
 * the state, which tab a run shows, how traps are grouped, when the Plot tab exists.
 */
import { describe, expect, it } from 'vitest';
import { interpretPlots } from '../../src/engine/results.ts';
import type { EngineDiagnostic, RunResult } from '../../src/engine/types.ts';
import { parseNetlist } from '../../src/app/model.ts';
import { describeResults } from '../../src/spice/describe.ts';
import { groupTraps, hasSweeps, initialState, reducer, tabAfterRun, type AppState, type RunOutcome } from '../../src/app/state.ts';
import type { Trap } from '../../src/spice/types.ts';

const F5 = '* F5\nItest 0 a 1\nVx a x 0\nR2 x n1 2\nR1 n1 0 4\nF1 0 n1 Vx 2\n.op\n.end\n';

function run(over: Partial<RunResult> = {}): RunResult {
  return {
    ok: true,
    unreliable: false,
    exitCode: 0,
    stdout: '',
    stderr: '',
    plots: [],
    diagnostics: [],
    timings: { instantiateMs: 1, runMs: 2, parseMs: 0 },
    ...over,
  };
}

function trap(line: number, severity: Trap['severity'], id = 'x'): Trap {
  return { id, severity, line, span: { from: 0, to: 1 }, title: 't', why: 'w', ngspice: 'n', fixes: [] };
}

function start(): AppState {
  const netlist = parseNetlist(F5);
  return initialState(netlist, [], new Map());
}

describe('reducer', () => {
  it('starts on Results when there are no traps, on Checks when there are', () => {
    expect(start().tab).toBe('results');
    expect(initialState(parseNetlist(F5), [trap(2, 'warning')], new Map()).tab).toBe('checks');
  });

  it('a run: running, then slow (Run becomes Stop), then done with the tab to show', () => {
    let s = reducer(start(), { type: 'run-start' });
    expect(s.running).toEqual({ slow: false });
    s = reducer(s, { type: 'run-slow' });
    expect(s.running).toEqual({ slow: true });
    const netlist = parseNetlist(F5);
    const result = run();
    const results = interpretPlots([]);
    s = reducer(s, { type: 'run-done', result, results, description: describeResults(netlist, results, result), netlist, tab: 'results' });
    expect(s.running).toBeNull();
    expect(s.outcome.kind).toBe('done');
    expect(s.tab).toBe('results');
  });

  it('run-slow after the run ended does nothing (the timer may fire late)', () => {
    const s = start();
    expect(reducer(s, { type: 'run-slow' })).toBe(s);
  });

  it('typing after a run marks the results stale, once (later keystrokes keep the same state)', () => {
    const netlist = parseNetlist(F5);
    const result = run();
    const results = interpretPlots([]);
    let s = reducer(start(), { type: 'run-done', result, results, description: describeResults(netlist, results, result), netlist, tab: 'results' });
    s = reducer(s, { type: 'text-changed' });
    expect(s.outcome.kind === 'done' && s.outcome.stale).toBe(true);
    expect(reducer(s, { type: 'text-changed' })).toBe(s);
    // Without results, typing changes nothing (no re-render per keystroke).
    const fresh = start();
    expect(reducer(fresh, { type: 'text-changed' })).toBe(fresh);
  });

  it('stopped and failed runs end the run and show the Results tab', () => {
    const s = reducer({ ...start(), tab: 'checks' }, { type: 'run-start' });
    const stopped = reducer(s, { type: 'run-stopped' });
    expect(stopped.running).toBeNull();
    expect(stopped.outcome).toEqual({ kind: 'stopped' });
    expect(stopped.tab).toBe('results');
    const failed = reducer(s, { type: 'run-failed', reason: 'The simulation took longer than 20 s and was stopped.' });
    expect(failed.outcome).toEqual({ kind: 'failed', reason: 'The simulation took longer than 20 s and was stopped.' });
  });

  it('a run cancelled because another circuit was loaded only ends the run', () => {
    const s = reducer({ ...start(), tab: 'checks' }, { type: 'run-start' });
    const abandoned = reducer(s, { type: 'run-abandoned' });
    expect(abandoned.running).toBeNull();
    expect(abandoned.outcome).toEqual({ kind: 'none' });
    expect(abandoned.tab).toBe('checks');
  });

  it('loading another circuit forgets the old results and message, and goes back to line 1', () => {
    let s = reducer(start(), { type: 'run-failed', reason: 'x' });
    s = reducer(s, { type: 'notice', notice: { tone: 'info', title: 'Saved circuit.net for LTspice' } });
    s = reducer(s, { type: 'cursor', line: 4 });
    s = reducer(s, { type: 'loaded' });
    expect(s.outcome).toEqual({ kind: 'none' });
    expect(s.notice).toBeNull();
    expect(s.cursorLine).toBe(1);
  });

  it('cursor and tab changes that change nothing keep the same state', () => {
    const s = start();
    expect(reducer(s, { type: 'cursor', line: 1 })).toBe(s);
    expect(reducer(s, { type: 'tab', tab: 'results' })).toBe(s);
    expect(reducer(s, { type: 'tab', tab: 'explained' }).tab).toBe('explained');
  });

  it('engine status', () => {
    expect(reducer(start(), { type: 'engine', engine: { status: 'ready', loadMs: 120 } }).engine).toEqual({ status: 'ready', loadMs: 120 });
  });
});

describe('tabAfterRun', () => {
  const error = (line?: number): EngineDiagnostic => ({ severity: 'error', code: 'error', text: 'Error', ...(line === undefined ? {} : { line }) });

  it('shows the results after a good or an unreliable run', () => {
    expect(tabAfterRun(run(), [trap(2, 'error')])).toBe('results');
    expect(tabAfterRun(run({ ok: false, unreliable: true }), [trap(2, 'error')])).toBe('results');
  });

  it('shows the checks when ngspice stopped and a check explains it (an error trap, or a trap on the line ngspice names)', () => {
    expect(tabAfterRun(run({ ok: false, diagnostics: [error()] }), [trap(3, 'error')])).toBe('checks');
    expect(tabAfterRun(run({ ok: false, diagnostics: [error(4)] }), [trap(4, 'warning')])).toBe('checks');
  });

  it('shows the results (with ngspice’s message) when no check explains the error', () => {
    expect(tabAfterRun(run({ ok: false, diagnostics: [error(4)] }), [trap(2, 'info')])).toBe('results');
    expect(tabAfterRun(run({ ok: false, diagnostics: [error(4)] }), [])).toBe('results');
  });
});

describe('groupTraps', () => {
  it('errors first, then warnings, then notes; each group keeps line order; empty groups left out', () => {
    const groups = groupTraps([trap(2, 'warning', 'a'), trap(3, 'error', 'b'), trap(5, 'warning', 'c'), trap(7, 'error', 'd')]);
    expect(groups.map((g) => g.severity)).toEqual(['error', 'warning']);
    expect(groups[0]!.traps.map((t) => t.id)).toEqual(['b', 'd']);
    expect(groups[1]!.traps.map((t) => t.id)).toEqual(['a', 'c']);
  });
});

describe('hasSweeps', () => {
  it('only for a finished run with .dc or .tran results whose numbers are answers', () => {
    const netlist = parseNetlist(F5);
    const sweep = {
      scale: { name: 'time', values: new Float64Array([0, 1]), unit: 's' as const },
      series: [{ name: 'v(out)', values: new Float64Array([0, 1]), unit: 'V' as const }],
    };
    const result = run();
    const done = (unreliable: boolean, traps: Trap[] = []): RunOutcome => ({
      kind: 'done',
      result: run({ unreliable }),
      results: { tran: sweep, other: [] },
      description: describeResults(netlist, { other: [] }, result),
      netlist,
      added: [],
      traps,
      stale: false,
    });
    expect(hasSweeps(done(false))).toBe(true);
    expect(hasSweeps(done(true))).toBe(false);
    expect(hasSweeps({ kind: 'none' })).toBe(false);
    // An error-level check on the netlist that ran: its sweep is not an answer either (words review B1).
    expect(hasSweeps(done(false, [trap(2, 'error')]))).toBe(false);
    expect(hasSweeps(done(false, [trap(2, 'warning')]))).toBe(true);
  });
});
