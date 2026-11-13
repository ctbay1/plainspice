/**
 * Solving a netlist for the drawing: ngspice runs it (src/engine, exactly like `ngspice -b -r`, with
 * `.options savecurrents` added for an operating point: src/spice/run-netlist.ts), and the results
 * come back in words (src/spice/describe.ts) with the beginner checks (src/spice/traps.ts). A
 * run's numbers are answers only when ngspice found them trustworthy and no check found an error;
 * otherwise the drawing shows none. Plain TypeScript.
 *
 * `liveSolver` re-solves as the student types: runs never overlap, and while one runs only the
 * newest request waits (the ones in between are dropped), so the numbers always end on the text
 * as it is now.
 */
import { interpretPlots } from '../engine/results.ts';
import type { RunResult } from '../engine/types.ts';
import { annotateLines, describeResults, netlistNode, type LineAnnotation, type ResultsInWords } from '../spice/describe.ts';
import { parseNetlist } from '../spice/parse.ts';
import { textToRun } from '../spice/run-netlist.ts';
import { checkTraps } from '../spice/traps.ts';
import type { Trap } from '../spice/types.ts';

/** What runs ngspice: the page's EngineClient (a Web Worker), or the engine itself in Node. */
export interface Runner {
  run(netlist: string): Promise<RunResult>;
}

export interface Solution {
  /** The netlist text that was solved. */
  text: string;
  /** ok: the numbers are answers; check: a check found an error; unreliable or failed: ngspice's own verdict. */
  status: 'ok' | 'unreliable' | 'failed' | 'check';
  words: ResultsInWords;
  /** Short results for the ends of the part lines ("4 A, a → n1"); empty unless the numbers are answers. */
  annotations: LineAnnotation[];
  checks: Trap[];
  /** How long ngspice took, in milliseconds. */
  ms: number;
  /**
   * When the numbers are not answers because ngspice's equations have no single answer: the node
   * (or branch) it points at ("singular matrix: check node n1"), by the netlist's key (ngspice's
   * "__iki__" is ÇIKIŞ, M2d), and the model's words for it (describe.ts: "No single answer at node
   * n1"), for the drawing to say there.
   */
  noSingleAnswer?: { at: string; title: string };
}

/** The numbers worth drawing: only when the run is trustworthy and no check found an error. */
export const answers = (s: Solution | undefined): ResultsInWords | undefined => (s?.status === 'ok' ? s.words : undefined);

export async function solve(text: string, runner: Runner, now: () => number = () => performance.now()): Promise<Solution> {
  const netlist = parseNetlist(text);
  const checks = checkTraps(netlist);
  const t0 = now();
  const run = await runner.run(textToRun(netlist));
  const ms = now() - t0;
  const results = interpretPlots(run.plots);
  const words = describeResults(netlist, results, run);
  const status = checks.some((c) => c.severity === 'error') ? 'check' : words.status;
  const annotations = status === 'ok' ? annotateLines(netlist, results, run) : [];
  const solution: Solution = { text, status, words, annotations, checks, ms };
  const singular = status === 'ok' ? undefined : run.diagnostics.find((d) => d.code === 'singular-matrix' && d.subject);
  const title = words.warnings.find((m) => m.code === 'singular-matrix')?.title;
  if (singular?.subject && title) solution.noSingleAnswer = { at: netlistNode(netlist, singular.subject), title };
  return solution;
}

export interface LiveSolver {
  /** Solve this text when ngspice is free (newest wins). */
  request(text: string): void;
  /** True while a run is going or waiting. */
  busy(): boolean;
  /** Resolves when nothing is running or waiting. */
  idle(): Promise<void>;
}

export function liveSolver<T>(solveText: (text: string) => Promise<T>, onResult: (result: T, text: string) => void, onError?: (error: unknown, text: string) => void): LiveSolver {
  let running = false;
  let waiting: string | undefined;
  let idlers: (() => void)[] = [];
  const settle = (): void => {
    if (running || waiting !== undefined) return;
    const done = idlers;
    idlers = [];
    for (const f of done) f();
  };
  const next = async (): Promise<void> => {
    if (running || waiting === undefined) return;
    const text = waiting;
    waiting = undefined;
    running = true;
    try {
      onResult(await solveText(text), text);
    } catch (error) {
      onError?.(error, text);
    } finally {
      running = false;
      if (waiting !== undefined) void next();
      else settle();
    }
  };
  return {
    request(text) {
      waiting = text;
      void next();
    },
    busy: () => running || waiting !== undefined,
    idle: () => (running || waiting !== undefined ? new Promise<void>((resolve) => idlers.push(resolve)) : Promise.resolve()),
  };
}
