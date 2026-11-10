/**
 * The app's state and its reducer: plain data and a pure function, so every change can be tested
 * without a browser. The netlist TEXT is not here: it lives in the editor (decision 0002); the
 * state holds what was read from it (the parsed netlist, its traps and node colours) and what
 * ngspice gave back.
 */
import type { AnalysisResults } from '../engine/results.ts';
import type { RunResult } from '../engine/types.ts';
import type { Netlist, Trap } from '../spice/types.ts';
import type { ResultsDescription } from './model.ts';

export type TabKey = 'checks' | 'results' | 'plot' | 'explained' | 'output';

export type EngineStatus =
  | { status: 'waiting' }
  | { status: 'loading' }
  | { status: 'ready'; loadMs: number }
  | { status: 'failed'; reason: string };

/** What the last run gave. */
export type RunOutcome =
  | { kind: 'none' }
  | {
      kind: 'done';
      result: RunResult;
      results: AnalysisResults;
      description: ResultsDescription;
      /** The netlist that ran (results and explanations refer to its lines). */
      netlist: Netlist;
      /** The netlist text changed after this run: the results are kept but marked as old. */
      stale: boolean;
    }
  | { kind: 'stopped' }
  | { kind: 'failed'; reason: string };

export interface Notice {
  /** 'problem': something went wrong (shown with an error icon); 'info': for the record. */
  tone: 'info' | 'problem';
  title: string;
  text?: string;
  items?: string[];
}

export interface AppState {
  netlist: Netlist;
  traps: Trap[];
  colours: Map<string, string>;
  /** 1-based line of the editor's cursor. */
  cursorLine: number;
  tab: TabKey;
  engine: EngineStatus;
  /** A run is in progress; `slow` once it has taken more than ~300 ms (Run becomes Stop). */
  running: { slow: boolean } | null;
  outcome: RunOutcome;
  notice: Notice | null;
}

export type Action =
  | { type: 'parsed'; netlist: Netlist; traps: Trap[]; colours: Map<string, string> }
  | { type: 'text-changed' }
  | { type: 'cursor'; line: number }
  | { type: 'tab'; tab: TabKey }
  | { type: 'engine'; engine: EngineStatus }
  | { type: 'run-start' }
  | { type: 'run-slow' }
  | { type: 'run-done'; result: RunResult; results: AnalysisResults; description: ResultsDescription; netlist: Netlist; tab: TabKey }
  | { type: 'run-stopped' }
  /** The run was cancelled because another circuit was loaded: nothing to report. */
  | { type: 'run-abandoned' }
  | { type: 'run-failed'; reason: string }
  | { type: 'notice'; notice: Notice | null }
  | { type: 'loaded' };

export function initialState(netlist: Netlist, traps: Trap[], colours: Map<string, string>): AppState {
  return {
    netlist,
    traps,
    colours,
    cursorLine: 1,
    tab: traps.length ? 'checks' : 'results',
    engine: { status: 'waiting' },
    running: null,
    outcome: { kind: 'none' },
    notice: null,
  };
}

/** Sweep results (.dc or .tran) exist, so the Plot tab is shown. */
export function hasSweeps(outcome: RunOutcome): boolean {
  return outcome.kind === 'done' && !outcome.result.unreliable && (outcome.results.dc !== undefined || outcome.results.tran !== undefined);
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'parsed':
      return { ...state, netlist: action.netlist, traps: action.traps, colours: action.colours };
    case 'text-changed':
      return state.outcome.kind === 'done' && !state.outcome.stale ? { ...state, outcome: { ...state.outcome, stale: true } } : state;
    case 'cursor':
      return state.cursorLine === action.line ? state : { ...state, cursorLine: action.line };
    case 'tab':
      return state.tab === action.tab ? state : { ...state, tab: action.tab };
    case 'engine':
      return { ...state, engine: action.engine };
    case 'run-start':
      return { ...state, running: { slow: false } };
    case 'run-slow':
      return state.running ? { ...state, running: { slow: true } } : state;
    case 'run-done': {
      const outcome: RunOutcome = {
        kind: 'done',
        result: action.result,
        results: action.results,
        description: action.description,
        netlist: action.netlist,
        stale: false,
      };
      return { ...state, running: null, outcome, tab: action.tab };
    }
    case 'run-abandoned':
      return state.running ? { ...state, running: null } : state;
    case 'run-stopped':
      return { ...state, running: null, outcome: { kind: 'stopped' }, tab: 'results' };
    case 'run-failed':
      return { ...state, running: null, outcome: { kind: 'failed', reason: action.reason }, tab: 'results' };
    case 'notice':
      return { ...state, notice: action.notice };
    case 'loaded':
      // A new circuit (an example or a link): the old results belong to another circuit.
      return { ...state, outcome: { kind: 'none' }, notice: null, cursorLine: 1 };
  }
}

/**
 * Which tab to show after a run: the results, or the checks when ngspice stopped with an error
 * that one of the checks explains (an error-level trap, or a trap on a line ngspice names).
 */
export function tabAfterRun(result: RunResult, traps: readonly Trap[]): TabKey {
  if (result.ok || result.unreliable) return 'results';
  const named = new Set(result.diagnostics.flatMap((d) => (d.line === undefined ? [] : [d.line])));
  return traps.some((t) => t.severity === 'error' || named.has(t.line)) ? 'checks' : 'results';
}

/** Traps grouped by severity, most serious first (each group keeps the line order). */
export function groupTraps(traps: readonly Trap[]): { severity: Trap['severity']; traps: Trap[] }[] {
  const order: Trap['severity'][] = ['error', 'warning', 'info'];
  return order.map((severity) => ({ severity, traps: traps.filter((t) => t.severity === severity) })).filter((g) => g.traps.length);
}
