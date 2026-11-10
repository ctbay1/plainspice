/**
 * The plain-TypeScript model the app shows (decision 0002: React only renders). One place that
 * names what the app uses from src/spice/ (parser, trap checks, explanations, descriptions), so the
 * components never depend on those modules' internals. Each call is guarded: a bug in a check or an
 * explanation must never break typing or a run, so it is logged and the app shows less, not nothing.
 */
import type { AnalysisResults } from '../engine/results.ts';
import type { RunResult } from '../engine/types.ts';
import { formatSI, speakSI } from '../format/si.ts';
import type {
  CurrentWords,
  LineAnnotation,
  MessageWords,
  NodeVoltageWords,
  QuantityWords,
  ResultsInWords,
  SweepWords,
  TransferFunctionWords,
} from '../spice/describe.ts';
import { explainLine as explainLineImpl, explainNetlist as explainNetlistImpl, readAnalysis } from '../spice/explain.ts';
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

/** src/spice/describe.ts, the results and the circuit in words. */
export type DescribeModule = typeof import('../spice/describe.ts');
let describing: Promise<DescribeModule> | undefined;

/**
 * describe.ts is needed only after a run and in the Explained tab, so it is not part of the first
 * screen's code (perf review 9): it loads when the browser is idle after start-up, or on first use.
 */
export function loadDescribe(): Promise<DescribeModule> {
  describing ??= import('../spice/describe.ts').catch((error: unknown) => {
    describing = undefined; // offline before it was cached: try again next time
    throw error;
  });
  return describing;
}

/** The circuit in words, once describe.ts has loaded ('' before). */
export function describeCircuit(describe: DescribeModule | null, netlist: Netlist): string {
  return describe ? guarded('describing the circuit', () => describe.describeCircuit(netlist), '') : '';
}

/** The run's results in words; if describing fails, the node voltages alone, so the numbers still show. */
export async function describeResults(netlist: Netlist, results: AnalysisResults, run: RunResult): Promise<ResultsDescription> {
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
  const describe = await loadDescribe().catch((error: unknown) => console.error('PlainSpice: describe.ts could not be loaded', error));
  return describe ? guarded('describing the results', () => describe.describeResults(netlist, results, run), fallback) : fallback;
}

/** Short results for the end of each part's line (empty when the run's numbers are not answers). */
export async function annotateLines(netlist: Netlist, results: AnalysisResults, run: RunResult): Promise<LineAnnotation[]> {
  const describe = await loadDescribe().catch(() => undefined);
  return describe ? guarded('annotating the lines', () => describe.annotateLines(netlist, results, run), []) : [];
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
