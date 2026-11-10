/**
 * The plain-TypeScript model the app shows (decision 0002: React only renders). One place that
 * names what the app uses from src/spice/ (parser, trap checks, explanations, descriptions), so the
 * components never depend on those modules' internals. Each call is guarded: a bug in a check or an
 * explanation must never break typing or a run, so it is logged and the app shows less, not nothing.
 */
import type { AnalysisResults } from '../engine/results.ts';
import type { RunResult } from '../engine/types.ts';
import { formatSI, speakSI } from '../format/si.ts';
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
import { explainLine as explainLineImpl, explainNetlist as explainNetlistImpl } from '../spice/explain.ts';
import { parseNetlist } from '../spice/parse.ts';
import { netlistToRun as netlistToRunImpl, type NetlistToRun } from '../spice/run-netlist.ts';
import { checkTraps as checkTrapsImpl } from '../spice/traps.ts';
import type { LineExplanation, Netlist, Trap } from '../spice/types.ts';

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

export function describeCircuit(netlist: Netlist): string {
  return guarded('describing the circuit', () => describeCircuitImpl(netlist), '');
}

/** The run's results in words; if describing fails, the node voltages alone, so the numbers still show. */
export function describeResults(netlist: Netlist, results: AnalysisResults, run: RunResult): ResultsDescription {
  return guarded('describing the results', () => describeResultsImpl(netlist, results, run), {
    status: run.unreliable ? 'unreliable' : run.ok ? 'ok' : 'failed',
    nodes: (results.op?.nodes ?? []).map((n) => ({ node: n.node, value: n.value, text: formatSI(n.value, 'V'), speech: speakSI(n.value, 'V') })),
    currents: [],
    sweeps: [],
    warnings: [],
    summary: '',
  });
}

/** Short results for the end of each part's line (empty when the run's numbers are not answers). */
export function annotateLines(netlist: Netlist, results: AnalysisResults, run: RunResult): LineAnnotation[] {
  return guarded('annotating the lines', () => annotateLinesImpl(netlist, results, run), []);
}

/**
 * The text ngspice runs: the student's text, plus `.options savecurrents` before .end for an
 * operating point, so every part's current is saved (src/spice/run-netlist.ts). If that fails,
 * the student's text unchanged.
 */
export function netlistToRun(netlist: Netlist): NetlistToRun {
  return guarded('preparing the run', () => netlistToRunImpl(netlist), { text: netlist.text, added: [] });
}
