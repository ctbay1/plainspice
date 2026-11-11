/**
 * The plain-TypeScript model the app shows (decision 0002: React only renders). One place that
 * names what the app uses from src/spice/ (parser, trap checks, explanations, descriptions), so the
 * components never depend on those modules' internals. Each call is guarded: a bug in a check or an
 * explanation must never break typing or a run, so it is logged and the app shows less, not nothing.
 *
 * A run (solveText) is what src/notebook/solve.ts does for the drawing, plus what the panels need:
 * ngspice's own output, the analysis results for the plots and tables, and the lines PlainSpice
 * added to the copy that ran.
 */
import type { AnalysisResults } from '../engine/results.ts';
import { interpretPlots } from '../engine/results.ts';
import type { RunResult } from '../engine/types.ts';
import { formatSI, speakSI } from '../format/si.ts';
import type { Solution } from '../notebook/solve.ts';
import {
  annotateLines as annotateLinesImpl,
  describeCircuit as describeCircuitImpl,
  describeResults as describeResultsImpl,
  type CurrentWords,
  type LineAnnotation,
  type MessageWords,
  type NodeVoltageWords,
  type QuantityWords,
  type ResultsInWords,
  type SweepWords,
  type TransferFunctionWords,
} from '../spice/describe.ts';
import { explainLine as explainLineImpl, explainNetlist as explainNetlistImpl, readAnalysis } from '../spice/explain.ts';
import { lowerAscii, parseNetlist } from '../spice/parse.ts';
import { netlistToRun as netlistToRunImpl, type NetlistToRun } from '../spice/run-netlist.ts';
import { checkTraps as checkTrapsImpl } from '../spice/traps.ts';
import type { LineExplanation, Netlist, Trap } from '../spice/types.ts';
import type { LivePlan } from './live.ts';

export { parseNetlist };
export type { NetlistToRun };
export type { CurrentWords, LineAnnotation, MessageWords, NodeVoltageWords, QuantityWords, SweepWords, TransferFunctionWords };
export type ResultsDescription = ResultsInWords;

function guarded<T>(what: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (error) {
    console.error(`PlainSpice: ${what} failed`, error);
    return fallback;
  }
}

/** The beginner traps in a netlist, sorted by line. */
export function checkTraps(netlist: Netlist): Trap[] {
  return guarded('the trap checks', () => checkTrapsImpl(netlist), []);
}

/** The field table of one line (lineIndex is 0-based), or undefined for a line with nothing to explain. */
export function explainLine(netlist: Netlist, lineIndex: number): LineExplanation | undefined {
  return guarded('explaining a line', () => explainLineImpl(netlist, lineIndex), undefined);
}

export function explainNetlist(netlist: Netlist): LineExplanation[] {
  return guarded('explaining the netlist', () => explainNetlistImpl(netlist), []);
}

/** The circuit in words. */
export function describeCircuit(netlist: Netlist): string {
  return guarded('describing the circuit', () => describeCircuitImpl(netlist), '');
}

/** The run's results in words; if describing fails, the node voltages alone, so the numbers still show. */
export function describeResults(netlist: Netlist, results: AnalysisResults, run: RunResult): ResultsDescription {
  const fallback: ResultsDescription = {
    status: run.unreliable ? 'unreliable' : run.ok ? 'ok' : 'failed',
    ngspiceError: run.exitCode !== 0 || run.diagnostics.some((d) => d.severity === 'error'),
    nodes: (results.op?.nodes ?? []).map((n) => ({ node: n.node, value: n.value, text: formatSI(n.value, 'V'), speech: speakSI(n.value, 'V') })),
    currents: [],
    sweeps: [],
    warnings: [],
    summary: '',
    summarySpeech: '',
  };
  return guarded('describing the results', () => describeResultsImpl(netlist, results, run), fallback);
}

/** Short results for the end of each part's line (empty when the run's numbers are not answers). */
export function annotateLines(netlist: Netlist, results: AnalysisResults, run: RunResult): LineAnnotation[] {
  return guarded('annotating the lines', () => annotateLinesImpl(netlist, results, run), []);
}

/** Below this many points a run that times out is not explained by its size. */
const MANY_POINTS = 100_000;

/**
 * At least how many points the netlist's sweeps ask ngspice for, when that is a lot: a .dc's exact
 * count, or a .tran's stop time divided by its largest time step (ngspice takes at least that many
 * steps, A16–A18). Undefined below 100 000 points, where size does not explain a time-out.
 */
export function pointsAskedFor(netlist: Netlist): number | undefined {
  return guarded(
    'counting the points',
    () => {
      let most = 0;
      for (const i of netlist.analyses) {
        const r = readAnalysis(netlist, i);
        if (r?.kind === 'dc' && r.points !== undefined && Number.isFinite(r.points)) most = Math.max(most, r.points);
        if (r?.kind === 'tran' && r.tstop !== undefined && r.maxStep !== undefined && r.maxStep > 0) {
          most = Math.max(most, Math.floor((r.tstop - (r.tstart ?? 0)) / r.maxStep));
        }
      }
      return most >= MANY_POINTS ? most : undefined;
    },
    undefined,
  );
}

/**
 * The text ngspice runs: the student's text, plus `.options savecurrents` before .end for an
 * operating point, so every part's current is saved (src/spice/run-netlist.ts). If that fails,
 * the student's text unchanged.
 */
export function netlistToRun(netlist: Netlist): NetlistToRun {
  return guarded('preparing the run', () => netlistToRunImpl(netlist), { text: netlist.text, added: [] });
}

// ------------------------------------------------------------------ reading a text once

/** A text read: parsed and checked. The last few texts are kept, since the drawing, the panels and the runs all read the same one. */
export interface ReadNetlist {
  text: string;
  netlist: Netlist;
  traps: Trap[];
}

const recent: ReadNetlist[] = [];

/** The netlist and its checks for a text (the same objects for the same text, while it is recent). */
export function readNetlist(text: string): ReadNetlist {
  const found = recent.find((r) => r.text === text);
  if (found) return found;
  const netlist = guarded('reading the netlist', () => parseNetlist(text), parseNetlist(''));
  const read = { text, netlist, traps: checkTraps(netlist) };
  recent.unshift(read);
  if (recent.length > 4) recent.length = 4;
  return read;
}

// ------------------------------------------------------------------ a run

/** A run, for the drawing (src/notebook: Solution) and for the panels. */
export interface RunRecord extends Solution {
  /** The netlist that ran (results and explanations refer to its lines). */
  netlist: Netlist;
  /** What ngspice gave: its printout, messages, exit code and timings. */
  run: RunResult;
  results: AnalysisResults;
  /** Lines PlainSpice added to the copy ngspice ran (shown in the ngspice output panel). */
  added: readonly string[];
}

/** What runs ngspice (the app's Engine, or the engine itself in tests). */
export interface Runner {
  run(netlist: string): Promise<RunResult>;
}

/**
 * Runs a text and reads its results. The numbers are answers only when ngspice found them
 * trustworthy and no check found an error (status 'ok'): otherwise the drawing shows none.
 */
export async function solveText(text: string, runner: Runner, now: () => number = () => performance.now()): Promise<RunRecord> {
  const { netlist, traps } = readNetlist(text);
  const toRun = netlistToRun(netlist);
  const t0 = now();
  const run = await runner.run(toRun.text);
  const ms = now() - t0;
  const results = guarded('reading the results', () => interpretPlots(run.plots), { other: [] } as AnalysisResults);
  const words = describeResults(netlist, results, run);
  const status: Solution['status'] = traps.some((c) => c.severity === 'error') ? 'check' : words.status;
  const annotations = status === 'ok' ? annotateLines(netlist, results, run) : [];
  const record: RunRecord = { text, status, words, annotations, checks: traps, ms, netlist, run, results, added: toRun.added };
  const singular = status === 'ok' ? undefined : run.diagnostics.find((d) => d.code === 'singular-matrix' && d.subject);
  const title = words.warnings.find((m) => m.code === 'singular-matrix')?.title;
  if (singular?.subject && title) record.noSingleAnswer = { at: lowerAscii(singular.subject), title };
  return record;
}

/** True when the netlist has at least one part (an empty netlist, or one of comments and dot lines, has nothing to run). */
export function hasParts(netlist: Netlist): boolean {
  return netlist.lines.some((l) => l.kind === 'element' && l.element);
}

/**
 * Whether a text may run on its own (live runs): not without an analysis line (the no-analysis check
 * knows about .control blocks, a title that is an analysis, misspelt analyses and lines after .end),
 * nor without a single part, and not when it asks ngspice for very many points.
 */
export function planRun(text: string): LivePlan {
  const { netlist, traps } = readNetlist(text);
  if (traps.some((trap) => trap.id === 'no-analysis') || !hasParts(netlist)) return { run: false, reason: 'nothing' };
  const points = pointsAskedFor(netlist);
  return points === undefined ? { run: true } : { run: false, reason: 'long', points };
}

/** The first error-level trap of a run: its numbers are then not answers, even when ngspice ran cleanly. */
export function errorTrap(record: RunRecord | undefined): Trap | undefined {
  return record?.checks.find((t) => t.severity === 'error');
}

/** Sweep results (.dc or .tran) that are answers exist, so the Plot panel has something to draw. */
export function hasSweeps(record: RunRecord | undefined): boolean {
  return !!record && !record.run.unreliable && errorTrap(record) === undefined && (record.results.dc !== undefined || record.results.tran !== undefined);
}

/** Traps grouped by severity, most serious first (each group keeps the line order). */
export function groupTraps(traps: readonly Trap[]): { severity: Trap['severity']; traps: Trap[] }[] {
  const order: Trap['severity'][] = ['error', 'warning', 'info'];
  return order.map((severity) => ({ severity, traps: traps.filter((t) => t.severity === severity) })).filter((g) => g.traps.length);
}
