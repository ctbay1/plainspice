/**
 * The real PlainSpice model behind the milestone-2 design prototypes (design/prototypes/*): ngspice 47
 * in its Web Worker, the parser, the beginner checks, the line explanations and the results in
 * words, exactly as the app uses them. The prototypes only draw: every number and every sentence on
 * screen comes from here, so "change R1 and watch the numbers move" is a real simulation.
 *
 * Throwaway code for choosing a design (milestone 2, step 1); the chosen direction is then built
 * into src/ properly.
 */
import { EngineClient } from '../../../src/engine/client.ts';
import { interpretPlots } from '../../../src/engine/results.ts';
import { formatSI, speakSI } from '../../../src/format/si.ts';
import { describeCircuit, describeResults, annotateLines, type CurrentWords, type LineAnnotation, type NodeVoltageWords, type ResultsInWords } from '../../../src/spice/describe.ts';
import { explainNetlist } from '../../../src/spice/explain.ts';
import { parseNetlist } from '../../../src/spice/parse.ts';
import { textToRun } from '../../../src/spice/run-netlist.ts';
import { checkTraps } from '../../../src/spice/traps.ts';
import type { LineExplanation, Trap } from '../../../src/spice/types.ts';
import { assignNodeColours } from '../../../src/theme/nodes.ts';

export { formatSI, speakSI };
export type { CurrentWords, LineAnnotation, LineExplanation, NodeVoltageWords, ResultsInWords, Trap };

/** The first screen of milestone 2: a 6 V source and two resistors, already solved. */
export interface Divider {
  /** The values as a student types them: "6", "1k", "2.2k". */
  v1: string;
  r1: string;
  r2: string;
}

export const FIRST_CIRCUIT: Divider = { v1: '6', r1: '1k', r2: '2k' };

/** The netlist the drawing stands for (the Netlist panel shows exactly this text). */
export function dividerNetlist(d: Divider): string {
  return ['* A voltage divider: change R1 and watch the numbers move', `V1 in 0 ${d.v1}`, `R1 in out ${d.r1}`, `R2 out 0 ${d.r2}`, '.op', '.end', ''].join('\n');
}

export interface Solution {
  /** The netlist that was solved. */
  netlist: string;
  /** 'ok', or why the numbers are not answers ('unreliable', 'failed', or 'check' for an error-level check). */
  status: 'ok' | 'unreliable' | 'failed' | 'check';
  /** Node voltages in volts, by node name ("in", "out"; ground is not listed). */
  voltages: Map<string, number>;
  /** Node voltages in words, with the text ("4 V") and speech ("4 volts") to show. */
  nodes: NodeVoltageWords[];
  /** Every part's current with its direction ("2 mA from in to out through R1") and source power. */
  currents: CurrentWords[];
  /** Short notes for the end of each netlist line ("2 mA, in → out"). */
  annotations: LineAnnotation[];
  /** The whole result in words, for a live region (summarySpeech for screen readers). */
  words: ResultsInWords;
  /** The beginner checks found in the netlist (what the Checks panel lists). */
  checks: Trap[];
  /** How long ngspice took, in ms. */
  ms: number;
}

let client: EngineClient | undefined;
function engine(): EngineClient {
  client ??= new EngineClient({ timeoutMs: 20_000 });
  return client;
}

/** Start loading ngspice now (about 0.6 MB), so the first solve is quick. */
export function warmUp(): Promise<number> {
  return engine().warmUp();
}

/** Run the netlist in ngspice (like `ngspice -b -r`) and put the results in words. */
export async function solve(netlistText: string): Promise<Solution> {
  const netlist = parseNetlist(netlistText);
  const checks = checkTraps(netlist);
  const t0 = performance.now();
  const run = await engine().run(textToRun(netlist));
  const ms = performance.now() - t0;
  const results = interpretPlots(run.plots);
  const words = describeResults(netlist, results, run);
  const checkError = checks.some((c) => c.severity === 'error');
  const status = checkError ? 'check' : words.status;
  const voltages = new Map(words.nodes.map((n) => [n.node, n.value]));
  const annotations = status === 'ok' ? annotateLines(netlist, results, run) : [];
  return { netlist: netlistText, status, voltages, nodes: words.nodes, currents: words.currents, annotations, words, checks, ms };
}

/**
 * Live solving for an editor: call `request(netlist)` as often as you like (every keystroke, every
 * slider step). Runs never overlap; while one runs, only the newest request waits, the rest are
 * dropped. `onResult` gets every finished solution, newest last.
 */
export function liveSolver(onResult: (s: Solution) => void, onError?: (e: unknown) => void): { request: (netlist: string) => void } {
  let running = false;
  let waiting: string | undefined;
  const next = async (): Promise<void> => {
    if (running || waiting === undefined) return;
    const text = waiting;
    waiting = undefined;
    running = true;
    try {
      onResult(await solve(text));
    } catch (error) {
      onError?.(error);
    } finally {
      running = false;
      void next();
    }
  };
  return {
    request(netlist: string) {
      waiting = netlist;
      void next();
    },
  };
}

/** The Checks panel: beginner traps with why, what ngspice does, and one-click fixes. */
export function check(netlistText: string): Trap[] {
  return checkTraps(parseNetlist(netlistText));
}

/** The Explain panel: every line of the netlist in plain words, with its field table. */
export function explain(netlistText: string): LineExplanation[] {
  return explainNetlist(parseNetlist(netlistText));
}

/** "The circuit in words": parts and nodes, for screen readers and the Explain panel. */
export function describe(netlistText: string): string {
  return describeCircuit(parseNetlist(netlistText));
}

/** The app's colour-blind-safe node colours (src/theme/nodes.ts), by node name. */
export function nodeColours(netlistText: string): Map<string, string> {
  return assignNodeColours(parseNetlist(netlistText).nodes.keys());
}
