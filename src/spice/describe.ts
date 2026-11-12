/**
 * The circuit and its results in words: a short overview for screen readers, every result with
 * its unit and direction, short notes for the end of netlist lines, and ngspice's messages in
 * plain words. Plain TypeScript: no UI framework, no DOM.
 *
 * Every statement about how SPICE behaves was checked by running native ngspice 47, native 42 and
 * our WebAssembly engine; the IDs in brackets name the claims in docs/spice-facts/explanations.md
 * (P, A, C, M; tests/golden/facts-explain.test.ts) and docs/spice-facts/numbers-and-syntax.md (N, S, W).
 *
 * Directions come from SPICE's signs (C1–C8): a part's current (@r1[i], @f1[i] … with
 * `.options savecurrents`) is positive from its first node, through it, to its second node; a
 * voltage source's current (and E's, H's and L's) is positive entering at its + node, so a source
 * that delivers power reads negative. Power is (V(first node) − V(second node)) × current, the
 * power the part absorbs; a negative value means it delivers power.
 */
import type { AnalysisResults, ElementCurrent, Sweep, SweepSeries } from '../engine/results.ts';
import type { EngineDiagnostic, RunResult } from '../engine/types.ts';
import { formatLikeNgspice, formatNumber, formatSI, speakSI } from '../format/si.ts';
import { elementInfo } from './elements.ts';
import { articleBefore, isKnownDotCommand, leftOutModel, readAfterEnd, readAnalysis, sweptBy, type AnalysisReading, type SweepReading } from './explain.ts';
import { isBuilt } from './graph.ts';
import { lowerAscii, ngspiceSpelling, parseNetlist } from './parse.ts';
import type { Element, ElementLetter, Netlist, NetlistLine, NodeRef } from './types.ts';

const MINUS = '−';
const ARROW = '→';

// ------------------------------------------------------------------ result types

export interface NodeVoltageWords {
  /**
   * The node's name as the netlist writes it, lower-case ASCII letters ("giriş"), and as ngspice
   * reports it for every other name; ngspice writes each byte of a letter outside ASCII as '_' (W16).
   */
  node: string;
  /** ngspice's own spelling, when it is not `node` ("giri__" for "giriş", W16). */
  ngspice?: string;
  value: number;
  /** "12 V" */
  text: string;
  /** "12 volts" */
  speech: string;
  /**
   * The node's colour in netlist order: the same index assignNodeColours([...netlist.nodes.keys()])
   * gives (src/theme/nodes.ts), which skips "0" and "gnd". Absent for nodes the netlist does not name.
   */
  colourIndex?: number;
}

export interface PowerWords {
  /** Always positive. */
  watts: number;
  /** True when the part delivers power (SPICE's absorbed power is negative). */
  delivers: boolean;
  /** "V1 delivers 18 W" */
  text: string;
  speech: string;
}

export interface CurrentWords {
  /** Lower-case part name, as the netlist writes it (ngspice's own spelling differs for letters outside ASCII, W18). */
  element: string;
  /** The results vector it comes from, in ngspice's spelling: "i(v1)", "i(@r__[i])". */
  vector?: string;
  /** The part's name as written in the netlist ("R1", "Vx"). */
  name: string;
  /** 1-based line of the part. */
  line?: number;
  /**
   * SPICE's value, with its sign; 0 when ngspice's value is rounding noise (C9), which `noise` keeps.
   * Every word, arrow and power claim follows this value.
   */
  value: number;
  /**
   * ngspice's own value when it is rounding noise and PlainSpice says 0 A instead (C9–C9c): below
   * ngspice's current tolerance (abstol, 1 pA) and a million million times below the circuit's own
   * currents. Shown with ngspice's spelling, never as a current.
   */
  noise?: number;
  /** Node the current comes from, through the part (ngspice's name; ground is "0"). */
  from: string;
  /** Node it flows to. */
  to: string;
  /** A 0 V source: it measures the current (the ammeter trick) and makes no power claim. */
  ammeter: boolean;
  /** "3 A from n1 to 0 through R1", "Vx measures 1 A flowing from a to x" */
  text: string;
  speech: string;
  power?: PowerWords;
}

export interface QuantityWords {
  value: number;
  text: string;
  speech: string;
}

export interface TransferFunctionWords {
  /** The .tf output and input as written ("v(a)", "V1"). */
  output: string;
  input: string;
  /** "V/V", "V/A", "A/V" or "A/A". */
  ratio: string;
  /** For a voltage output, where it is measured: "at a", "between a and b". */
  at?: string;
  transferFunction?: QuantityWords;
  inputResistance?: QuantityWords;
  outputResistance?: QuantityWords;
}

export interface SweepWords {
  kind: 'dc' | 'tran';
  points: number;
  /** "DC sweep of V1 from 0 V to 12 V: 13 points. At V1 = 12 V: v(out) = 8 V, …" */
  text: string;
  speech: string;
  /** The value of each result at the last point. */
  final: { name: string; value: number; text: string; speech: string }[];
}

export interface MessageWords {
  /**
   * The diagnostic code (src/engine/diagnostics.ts), one PlainSpice adds for messages that file does
   * not classify (unknown-control-source, unknown-dot-command, meas-skipped), or one of: unreliable,
   * no-analysis, no-results, tf-node-missing, rounding-noise (a note: currents said as 0 A, C9).
   */
  code: string;
  severity: 'error' | 'warning' | 'note';
  title: string;
  why: string;
  /** 1-based netlist line it is about. */
  line?: number;
}

export interface ResultsInWords {
  /** ok: trustworthy results; unreliable: numbers from a failed DC solution; failed: no results. */
  status: 'ok' | 'unreliable' | 'failed';
  /**
   * ngspice itself reported an error (an exit code other than 0, or an error message). False when it
   * finished quietly, even without results: an empty .dc sweep, or only a .control block (M4).
   */
  ngspiceError: boolean;
  nodes: NodeVoltageWords[];
  currents: CurrentWords[];
  tf?: TransferFunctionWords;
  sweeps: SweepWords[];
  /** ngspice's messages in plain words, most important first (warnings and errors). */
  warnings: MessageWords[];
  /** One paragraph for a polite live region. */
  summary: string;
  /** The same paragraph for speech: units in words ("14 volts"), no symbols to spell out. */
  summarySpeech: string;
}

export interface LineAnnotation {
  /** 1-based line number. */
  line: number;
  /** "3 A, n1 → 0", "delivers 18 W, 3 A out of +" */
  text: string;
  /** The same in words, e.g. "3 amps flow from n1 to ground". */
  speech: string;
}

export interface DiagnosticWords {
  title: string;
  why: string;
  line?: number;
}

// ------------------------------------------------------------------ strings

/**
 * A node in a sentence, the way the editor says it (EDIT_STRINGS.node, decision 0017): "node in",
 * because a name may be an ordinary word; ground stays "ground" (written "0" in results). Inside the
 * templates below, so every page that builds a sentence from them (the overview, the drawing's
 * descriptions, the cards) says it the same way.
 */
function nodeIn(n: string): string {
  return n === 'ground' || n === '0' ? 'ground' : n === '?' || n === '' ? n : `node ${n}`;
}

/** Every sentence this module writes, in one object so a Turkish UI can replace it later. */
export const DESCRIBE_STRINGS = {
  ground: 'ground',
  /** A node in a sentence: "node in"; ground is "ground". */
  node: nodeIn,
  // ---- describeCircuit
  counts: (parts: number, nodes: number, names: string): string =>
    `${parts} ${parts === 1 ? 'part' : 'parts'} and ${nodes} ${nodes === 1 ? 'node' : 'nodes'} besides ground${names ? ` (${names})` : ''}.`,
  countsNoGround: (parts: number, nodes: number, names: string): string =>
    `${parts} ${parts === 1 ? 'part' : 'parts'} and ${nodes} ${nodes === 1 ? 'node' : 'nodes'}${names ? ` (${names})` : ''}. Nothing is connected to ground (node 0).`,
  noParts: 'No parts yet.',
  moreParts: (n: number): string => `And ${n} more ${n === 1 ? 'part' : 'parts'}.`,
  resistor: (name: string, v: string, a: string, b: string): string =>
    `${name}: ${v ? `${articleBefore(v)} ${v} resistor` : 'a resistor'} between ${nodeIn(a)} and ${nodeIn(b)}.`,
  capacitor: (name: string, v: string, a: string, b: string): string =>
    `${name}: ${v ? `${articleBefore(v)} ${v} capacitor` : 'a capacitor'} between ${nodeIn(a)} and ${nodeIn(b)}.`,
  inductor: (name: string, v: string, a: string, b: string): string =>
    `${name}: ${v ? `${articleBefore(v)} ${v} inductor` : 'an inductor'} between ${nodeIn(a)} and ${nodeIn(b)}.`,
  vSource: (name: string, v: string, a: string, b: string): string =>
    `${name}: ${v ? `${articleBefore(v)} ${v} source` : 'a voltage source'} with its + side at ${nodeIn(a)} and its ${MINUS} side at ${nodeIn(b)}.`,
  vFunction: (name: string, fn: string, a: string, b: string): string =>
    `${name}: a ${fn} voltage source with its + side at ${nodeIn(a)} and its ${MINUS} side at ${nodeIn(b)}.`,
  // P9: true of every 0 V source, the turned-off source of a Thevenin example too (student review): what
  // it is and what ngspice does with it, not a purpose the circuit may not have.
  ammeter: (name: string, a: string, b: string): string =>
    `${name}: a 0 V source from ${nodeIn(a)} to ${nodeIn(b)}: a wire, through which ngspice measures the current (the ammeter trick).`,
  swept: (name: string, a: string, b: string): string => `${name}: a voltage source with its + side at ${nodeIn(a)} and its ${MINUS} side at ${nodeIn(b)}, swept by .dc.`,
  iSource: (name: string, v: string, a: string, b: string): string =>
    `${name}: ${v ? `${articleBefore(v)} ${v} current source` : 'a current source'} pushing current from ${nodeIn(a)} into ${nodeIn(b)}.`,
  iFunction: (name: string, fn: string, a: string, b: string): string => `${name}: a ${fn} current source pushing current from ${nodeIn(a)} into ${nodeIn(b)}.`,
  vcvs: (name: string, out: string, gain: string, control: string): string =>
    `${name}: a voltage-controlled voltage source: ${out}, is ${gain} × ${control}.`,
  cccs: (name: string, gain: string, control: string, a: string, b: string): string =>
    `${name}: a current-controlled current source pushing ${gain} × the current in ${control} from ${nodeIn(a)} into ${nodeIn(b)}.`,
  vccs: (name: string, gm: string, control: string, a: string, b: string): string =>
    `${name}: a voltage-controlled current source pushing ${gm} for every volt ${control}, from ${nodeIn(a)} into ${nodeIn(b)}.`,
  ccvs: (name: string, out: string, r: string, control: string): string =>
    `${name}: a current-controlled voltage source: ${out}, is ${r} for every amp in ${control}.`,
  voltageAt: (n: string, ref: string): string => `the voltage at ${nodeIn(n)}, measured from ${nodeIn(ref)}`,
  at: (n: string): string => `at ${nodeIn(n)}`,
  between: (a: string, b: string): string => `between ${nodeIn(a)} and ${nodeIn(b)}`,
  coupling: (name: string, l1: string, l2: string, k: string): string => `${name}: couples ${l1} and ${l2} (coupling ${k}).`,
  otherPart: (name: string, what: string, nodes: string): string => `${name}: ${what}${nodes ? ` (${nodes})` : ''}.`,
  // "+ node a" already says "node"; a terminal reads "collector at node c", "emitter at ground".
  labelled: (label: string, n: string): string => (label.endsWith('node') && nodeIn(n) !== 'ground' ? `${label} ${n}` : `${label} at ${nodeIn(n)}`),
  modelOf: (m: string): string => `model ${m}`,
  subcircuitOf: (m: string): string => `subcircuit ${m}`,
  analysis: (list: string): string => `Analysis: ${list}.`,
  analyses: (list: string): string => `Analyses: ${list}.`,
  noAnalysis: 'No analysis line (.op, .dc, .tran, .tf or .ac), so ngspice will run nothing.',
  noAnalysisControl: 'No analysis line (.op, .dc, .tran, .tf or .ac): ngspice runs the commands in the .control block instead.',
  analysisAfterEnd: 'The analysis is written after .end, where ngspice still reads it.',
  opName: 'operating point',
  tfName: (out: string, input: string): string => `transfer function from ${input} to ${out}`,
  dcName: (sweeps: string, points: string): string => `DC sweep of ${sweeps}${points}`,
  dcSweep: (source: string, start: string, stop: string, step: string): string => `${source} from ${start} to ${stop} in steps of ${step}`,
  points: (n: number): string => ` (${n} ${n === 1 ? 'point' : 'points'})`,
  tranName: (stop: string): string => `transient, from 0 to ${stop}`,
  acName: (from: string, to: string): string => `AC analysis from ${from} to ${to}`,
  otherAnalysis: (name: string): string => `${name}`,
  subcircuits: (n: number, names: string): string => `${n} subcircuit ${n === 1 ? 'definition' : 'definitions'} (${names}).`,
  // ---- results
  amps: (a: string, from: string, to: string, name: string): string => `${a} from ${nodeIn(from)} to ${nodeIn(to)} through ${name}`,
  ampsSpeech: (a: string, verb: string, from: string, to: string, name: string): string => `${a} ${verb} from ${nodeIn(from)} to ${nodeIn(to)} through ${name}`,
  noCurrent: (name: string): string => `no current through ${name}`,
  noCurrentSpeech: (name: string): string => `no current flows through ${name}`,
  measures: (name: string, a: string, from: string, to: string): string => `${name} measures ${a} flowing from ${nodeIn(from)} to ${nodeIn(to)}`,
  measuresNothing: (name: string): string => `${name} measures no current`,
  delivers: (name: string, w: string): string => `${name} delivers ${w}`,
  absorbs: (name: string, w: string): string => `${name} absorbs ${w}`,
  transfer: (out: string, input: string, value: string, ratio: string): string => `${out}/${input} = ${value} (${ratio})`,
  transferSpeech: (out: string, input: string, value: string, ratio: string): string =>
    `the transfer function from ${input} to ${out} is ${value} ${ratio}`,
  inputR: (input: string, r: string): string => `input resistance seen by ${input}: ${r} (ngspice calls it the input impedance)`,
  inputRSpeech: (input: string, r: string): string => `the input resistance seen by ${input} is ${r}`,
  outputR: (at: string, r: string): string => `output resistance ${at}: ${r}, the Thevenin resistance seen ${at} (ngspice calls it the output impedance)`,
  outputRSpeech: (at: string, r: string): string => `the output resistance ${at} is ${r}, the Thevenin resistance`,
  outputRCurrent: (out: string, r: string): string =>
    `ngspice's output impedance for ${out}: ${r}, a stand-in number rather than a resistance of your circuit`,
  outputRCurrentSpeech: (out: string, r: string): string => `ngspice reports ${r} as the output impedance for ${out}; it is not a resistance of your circuit`,
  ratioWords: { 'V/V': 'volts per volt', 'V/A': 'volts per amp, which is ohms', 'A/V': 'amps per volt', 'A/A': 'amps per amp' } as Record<string, string>,
  ratioWordsOne: { 'V/V': 'volt per volt', 'V/A': 'volt per amp, which is an ohm', 'A/V': 'amp per volt', 'A/A': 'amp per amp' } as Record<string, string>,
  voltageOf: (n: string): string => `the voltage at ${nodeIn(n)}`,
  voltageBetween: (a: string, b: string): string => `the voltage between ${nodeIn(a)} and ${nodeIn(b)}`,
  currentIn: (name: string): string => `the current in ${name}`,
  dcSweepText: (what: string, points: number): string => `DC sweep of ${what}: ${points} ${points === 1 ? 'point' : 'points'}.`,
  dcNoPoints: (what: string): string => `DC sweep of ${what}: no points.`,
  tranText: (from: string, to: string, points: number): string => `Transient from ${from} to ${to}: ${points} time ${points === 1 ? 'point' : 'points'}.`,
  atEnd: (where: string, values: string): string => `At ${where}: ${values}.`,
  atEndSpeech: (where: string, values: string): string => `When ${where}: ${values}.`,
  atLastPoint: 'the last point',
  sweepAt: (name: string, value: string): string => `${name} = ${value}`,
  sweepAtSpeech: (name: string, value: string): string => `${name} is ${value}`,
  valueIs: (name: string, value: string): string => `${name} = ${value}`,
  valueIsSpeech: (name: string, value: string): string => `${name} is ${value}`,
  summaryOk: (parts: string, warnings: number, first: string): string =>
    `Simulation finished: ${parts}.${warnings ? ` ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}: ${first}.` : ''} Open the results for details.`,
  summaryUnreliable: (why: string): string => `Simulation finished, but its numbers can't be trusted: ${why}. Open the results for details.`,
  summaryFailed: (why: string): string => `ngspice stopped with an error: ${why}. Open the results for details.`,
  summaryEmpty: (why: string): string => `ngspice finished but gave no results: ${why}. Open the results for details.`,
  summaryNodes: (list: string, more: number): string => (more ? `${list} and ${more} more ${more === 1 ? 'node' : 'nodes'}` : list),
  summaryCurrents: (n: number): string => `${n} ${n === 1 ? 'current' : 'currents'}`,
  summaryTf: (value: string): string => `transfer function ${value}`,
  summaryDc: (n: number): string => `a DC sweep of ${n} ${n === 1 ? 'point' : 'points'}`,
  summaryTran: (to: string, n: number): string => `a transient to ${to}, ${n} time ${n === 1 ? 'point' : 'points'}`,
  summaryOther: (n: number): string => `${n} other ${n === 1 ? 'analysis' : 'analyses'} that PlainSpice does not describe yet`,
  summaryNothing: 'no results to show',
  // ---- annotations
  noteAmps: (a: string, from: string, to: string): string => `${a}, ${from} ${ARROW} ${to}`,
  noteAmpsSpeech: (a: string, verb: string, from: string, to: string): string => `${a} ${verb} from ${nodeIn(from)} to ${nodeIn(to)}`,
  noteNoCurrent: '0 A',
  noteNoCurrentSpeech: 'no current flows',
  noteAcross: (v: string): string => `${v} across`,
  noteAcrossSpeech: (v: string, name: string): string => `${v} across ${name}`,
  noteSource: (power: string, a: string, dir: string): string => `${power}, ${a} ${dir}`,
  noteOutOfPlus: 'out of +',
  noteIntoPlus: 'into +',
  noteOutOfPlusSpeech: 'out of its + side',
  noteIntoPlusSpeech: 'into its + side',
  noteDelivers: (w: string): string => `delivers ${w}`,
  noteAbsorbs: (w: string): string => `absorbs ${w}`,
  noteMeasures: (a: string, from: string, to: string): string => `measures ${a} flowing from ${nodeIn(from)} to ${nodeIn(to)}`,
  // ---- messages
  unreliableTitle: "These numbers can't be trusted",
  unreliableWhy:
    "ngspice could not find a DC solution: its equations have no single answer (a singular matrix). It printed numbers from a fallback (a \"transient op\"), and they can be wrong, even for nodes that look fine.",
  noAnalysisTitle: 'Nothing to run',
  noAnalysisWhy: 'There is no analysis line (.op, .dc, .tran, .tf or .ac), so ngspice ran nothing, and with a results file it says nothing about it.',
  noAnalysisAtWhy: (line: number): string =>
    `Line ${line} starts with @, so ngspice stopped reading there and never saw the analysis lines after it. It ran nothing.`,
  noAnalysisTitleWhy: (word: string): string => `Line 1 is always the title, so ngspice never runs the ${word} written there. It ran nothing.`,
  controlOnlyTitle: 'ngspice ran the .control block',
  controlOnlyWhy:
    'ngspice ran the commands in the .control block; what they printed is in the ngspice output tab. PlainSpice shows the results of analysis lines such as .op, .dc and .tran, and this netlist has none.',
  noResultsTitle: 'No results',
  noResultsWhy: 'ngspice finished without writing any results, and it printed no message that says why.',
  noGroundTitle: 'No ground (node 0)',
  noGroundWhy:
    "Without ground, SPICE can't pin the voltages down. It warns about a singular matrix, which means its equations have no single answer, and any numbers it still prints can't be trusted. Connect one node to ground: call it 0.",
  loopTitle: (name: string): string => `${name} is in a loop of voltage sources or shorts`,
  loopWhyV: (name: string): string =>
    `${name} has another voltage source, a 0 V source or a wire across it, so the current in ${name} has no single answer (a singular matrix). Two voltage sources cannot sit across the same two nodes.`,
  loopWhyL: (name: string): string =>
    `In .op an inductor is a short circuit, and ${name} sits across a voltage source (or in a loop of them), so its current has no single answer (a singular matrix). ngspice's fallback numbers for it can't be trusted.`,
  capNodeTitle: (n: string): string => `Node ${n} has no DC path to ground`,
  capNodeWhy: (n: string, what: string): string =>
    `In .op a capacitor is an open circuit, so node ${n}, which connects only to ${what}, is cut off: its voltage has no single answer (a singular matrix). ngspice's fallback numbers can be wrong, even for other nodes.`,
  onlyCapacitors: 'capacitors',
  onlyCurrentSources: 'current sources',
  capacitorsAndCurrentSources: 'capacitors and current sources',
  floatingTitle: (n: string): string => `Node ${n} is not connected to the rest of the circuit`,
  floatingWhy: (n: string): string =>
    `Node ${n} has no path to ground (node 0), so its voltage has no single answer (a singular matrix). Connect it to the rest of the circuit, or remove the part.`,
  shortLineTitle: (name: string): string => `${name} is missing fields`,
  shortLineWhy: (name: string): string =>
    `An E or G line needs four nodes and a number, and ${name} has fewer, so PlainSpice's engine finds no single answer (a singular matrix) and gives no results. (Native ngspice says "not enough parameters".)`,
  singularTitle: (n: string): string => `No single answer at node ${n}`,
  singularWhy: (n: string): string =>
    `ngspice's equations have no single answer (a singular matrix), so the numbers it prints can't be trusted. ngspice points at ${n}: check that it has a DC path to ground (node 0).`,
  steppingTitle: "ngspice's other ways to find a DC solution failed too",
  steppingWhy: 'After the singular matrix, ngspice tried gmin stepping and source stepping, ways to approach the solution gradually. They failed as well.',
  fallbackTitle: 'The numbers come from a fallback and can be wrong',
  fallbackWhy: 'Because the DC solution failed, ngspice estimated the operating point another way (a "transient op"). Those numbers can be wrong, even for nodes that look fine.',
  fallbackFailedTitle: 'The fallback failed too: no results',
  fallbackFailedWhy: 'ngspice\'s fallback (the "transient op") could not find an operating point either, so there are no results.',
  opFailedTitle: 'No operating point',
  opFailedWhy: 'ngspice could not find the operating point, so it ran no analysis.',
  timestepTitle: 'Time step too small',
  timestepWhy: 'ngspice made its time steps smaller and smaller and gave up.',
  duplicateTitle: (name: string): string => `Two parts are called ${name}`,
  duplicateWhy: (earlier: string): string =>
    `Each part needs its own name, and SPICE ignores capital letters${earlier}. ngspice stops at the second one ("device already exists"). Rename one of them.`,
  duplicateEarlier: (here: string, name: string, line: number): string => `, so ${here} here is the same name as ${name} on line ${line}`,
  unknownDeviceTitle: (c: string): string => `A line starts with ${c}`,
  unknownDeviceWhy: (c: string): string =>
    `A part's line starts with the letter that says what it is: R, C, L, V, I, E, F, G, H … This line starts with ${c}, so ngspice stops: "unknown device type".`,
  unknownDeviceGenericTitle: 'ngspice does not know this kind of part',
  unknownDeviceGenericWhy: 'A part\'s line starts with the letter that says what it is: R, C, L, V, I, E, F, G, H … ngspice stops: "unknown device type".',
  unknownSubcktTitle: (name: string): string => `No subcircuit called ${name}`,
  unknownSubcktWhy: (part: string, name: string): string => `${part} uses a subcircuit called ${name}, but no .subckt ${name} … .ends defines it, so ngspice stops.`,
  missingModelTitle: (name: string): string => `No model for ${name}`,
  missingModelWhy: (name: string, model: string): string => `${name} needs a .model line called ${model}, and there is none, so ngspice stops.`,
  leftOutModelTitle: (name: string): string => `The model of ${name} is not in PlainSpice's engine`,
  leftOutModelWhy: (model: string, level: string, name: string, kind: string, message: string, mosfet: boolean): string =>
    `The .model line for ${model} uses level=${level}, which selects ${name}, ${kind} that PlainSpice's engine leaves out, so ngspice says "${message}".${mosfet ? ' For a simple MOSFET, use level=1.' : ''}`,
  missingFieldsTitle: 'Not enough fields on a line',
  missingFieldsWhy: 'This line has fewer fields than its part needs: E and G need four nodes and a number, F and H two nodes, a control source and a number.',
  spaceTitle: (word: string): string => `A space before "${word}"`,
  spaceWhy: (word: string): string =>
    `ngspice reads a number and the letters after a space as two words, and "${word}" means nothing on this line, so it stops ("unknown parameter"). Write the number and its scale letter together, like 1k.`,
  commaTitle: 'A comma in a number',
  commaWhy: 'A comma separates words in SPICE, so 1,5 is the number 1 and then 5, which ngspice cannot use here ("unknown parameter"). Use a decimal point: 1.5.',
  signTitle: 'A sign in the middle of a value',
  signWhy: (word: string): string =>
    `A + or − after a digit or a letter starts a new word in ngspice, so it read "${word}" as a separate word and stopped ("unknown parameter"). For an exponent, write e: 1e-3.`,
  starTitle: (c: string): string => `A ${c} in the middle of a line`,
  starWhy: (c: string): string =>
    `A ${c} in the middle of a line does not start a comment: ngspice reads it as a word it cannot use and stops ("unknown parameter"). Start an end-of-line comment with ; instead.`,
  unknownParamTitle: (word: string): string => `ngspice cannot use "${word}" here`,
  unknownParamWhy: (word: string): string => `ngspice does not know the word "${word}" on this line, so it stops ("unknown parameter").`,
  lineIgnoredTitle: (name: string): string => `${name} was left out`,
  lineIgnoredWhy: (what: string): string => `A ${what} needs a value, and this line has none, so ngspice leaves it out of the circuit.`,
  noValueTitle: (name: string, unit: string): string => `${name} has no value: 0 ${unit}`,
  noValueWhy: 'This source has no DC value, so ngspice uses 0. An AC value alone is not a DC value.',
  tooSmallTitle: (name: string): string => `${name} is too small for ngspice`,
  tooSmallWhy:
    'ngspice 47 cannot use 0 Ω (or anything below 10⁻¹² Ω): it uses 10⁻¹² Ω instead, and the currents next to it come out inaccurate. To make two nodes one, give them the same name; to measure the current there, use a 0 V source.',
  tfMissingTitle: (name: string): string => `.tf: there is no ${name}`,
  tfMissingWhy: (name: string): string => `The input of .tf must be a voltage or current source of the circuit, and there is no ${name}, so ngspice ran no analysis.`,
  tfTypeTitle: (name: string): string => `.tf: ${name} is not a source`,
  tfTypeWhy: (name: string): string => `The input of .tf must be a voltage source (V) or a current source (I); ${name} is neither, so ngspice ran no analysis.`,
  sweepMissingTitle: (name: string): string => `.dc: there is no ${name}`,
  sweepMissingWhy: (name: string): string =>
    `A .dc sweep changes a voltage source, a current source or a resistor of the circuit, or the temperature (TEMP); there is no ${name}, so ngspice stops.`,
  badSyntaxDcTitle: '.dc needs a step that is not 0',
  badSyntaxDcWhy: 'ngspice 47 cannot sweep with a step of 0, or with no step at all, and stops ("Bad syntax!").',
  badSyntaxTitle: 'ngspice cannot read this line',
  badSyntaxWhy: 'ngspice stopped at this line ("Bad syntax!").',
  tstopTitle: '.tran needs a step and a stop time',
  tstopWhy: 'With one number, ngspice has no stop time ("TSTOP is invalid"). Write a step and then the stop time, like .tran 10u 5m.',
  tstepTitle: 'The .tran step must be more than 0',
  tstepWhy: 'ngspice stops when the step is 0 ("TSTEP is invalid").',
  tstartTitle: 'tstart must come before tstop',
  tstartWhy: 'The third number of .tran, tstart, is where the saved results begin; it must be less than the stop time ("TSTART is invalid").',
  inductorTitle: (name: string): string => `There is no inductor called ${name}`,
  inductorWhy: (k: string, name: string): string => `${k} couples two inductors by name, and there is no ${name}, so ngspice stops.`,
  notInBuildTitle: "This part is not in PlainSpice's engine",
  notInBuildWhy: (device: string): string =>
    `PlainSpice's engine leaves out some chip-design and transmission-line models, and this line needs one (${device}), so ngspice stops.`,
  undefinedParamTitle: (name: string): string => `No .param defines ${name}`,
  undefinedParamWhy: (name: string): string => `An expression uses the name ${name}, but no .param line gives it a value, so ngspice stops. Add .param ${name}=… above it.`,
  braceTitle: 'An expression is not closed',
  braceWhy: 'ngspice found a { (or a \') without its closing } (or \'), and stopped with a fatal error.',
  bLineTitle: 'A B line needs V= or I=',
  bLineWhy: 'A B line needs an expression, V=… or I=…; without one ngspice stops with a fatal error.',
  fatalTitle: 'ngspice stopped',
  fatalWhy: 'ngspice met an error it cannot recover from and stopped; the message before this one says why.',
  notParsedTitle: 'ngspice could not read the circuit',
  notParsedWhy: 'An error in the netlist stopped ngspice before it could simulate; the message before this one says which.',
  notParsedLineWhy: (line: number): string => `An error on line ${line} stopped ngspice before it could simulate.`,
  abortedTitle: 'The simulation was stopped',
  abortedWhy: 'ngspice stopped the run because of the error before this message.',
  nothingTitle: 'Nothing to run',
  nothingWhy: 'There is no analysis line (.op, .dc, .tran, .tf or .ac), so ngspice ran nothing.',
  leadingTitle: 'A line became a comment',
  leadingWhy: 'ngspice turns a line that starts with $ & ! % ( ) = " [ ] ? , : or a form feed into a comment, with this warning.',
  includeTitle: (file: string): string => `ngspice cannot find the file ${file}`,
  includeWhy: 'PlainSpice runs in your browser and has no other files to give ngspice, so .include and .lib cannot read anything, and ngspice stops.',
  errorTitle: 'ngspice reported an error',
  warningTitle: 'ngspice warns',
  modelWordTitle: (word: string): string => `ngspice looked for a model called ${word}`,
  modelWordWhy: (word: string, model: string): string =>
    `ngspice printed "can't find model '${model}'": besides reading the value ${word}, it looked for a model with that name and found none. The Checks tab says what ngspice makes of this value.`,
  saysWhy: (text: string): string => `ngspice says: ${text}`,
  controlVectorTitle: 'A .control command ran before the results existed',
  controlVectorWhy: (v: string): string =>
    `ngspice runs a .control block first, before the analyses of the dot commands, so a command there asked for "${v}" before any analysis had made it.`,
  tfNodeTitle: (n: string): string => `${n} is not a node of the circuit`,
  tfNodeWhy: (n: string): string =>
    `The .tf output names ${n}, which no part connects to. ngspice says nothing and reports a transfer function of 0, so these .tf numbers mean nothing.`,
  crashTitle: 'The simulation engine crashed',
  crashWhy: 'Something went wrong inside the engine itself. Try again; if it keeps happening, the netlist may be too large or meet a bug in ngspice.',
  rawfileTitle: 'The results could not be read',
  rawfileWhy: 'PlainSpice could not read the results file ngspice wrote.',
  rawfileEmptyDcTitle: 'The .dc sweep has no points',
  rawfileEmptyDcWhy: (line: number): string =>
    `With the numbers on line ${line}, start is past stop for this step, so ngspice runs no points and writes empty results without a message.`,
  controlSourceTitle: (part: string, name: string): string => `${part} cannot read the current of ${name}`,
  controlSourceMissingWhy: (name: string): string => `There is no voltage source called ${name}, so ngspice stops ("unknown controlling source").`,
  controlSourceWrongWhy: (name: string, what: string): string =>
    `F and H read a current. But SPICE can only read the current through a voltage source, and ${name} is ${what}. Put a 0 V source in that branch and read its current: the ammeter trick.`,
  unknownDotTitle: (name: string): string => `ngspice does not know ${name}`,
  unknownDotWhy: (name: string): string => `${name} is not a dot command ngspice knows, so it stops ("unimplemented dot command").`,
  measTitle: '.meas was skipped',
  measWhy: 'PlainSpice\'s engine writes a results file, and then ngspice skips .meas.',
  // C9–C9c: a current ngspice gives as rounding noise, said as 0 A, with what ngspice gave.
  noiseTitle: (names: string[]): string => (names.length === 1 ? `${names[0]}'s current is shown as 0 A` : `${names.length} currents are shown as 0 A`),
  noiseWhy: (gave: string, one: boolean): string =>
    `ngspice gave ${gave}. ${one ? 'That is rounding noise, what ngspice\'s arithmetic leaves of a current that is 0' : 'Those are rounding noise, what ngspice\'s arithmetic leaves of currents that are 0'}: far below 1 pA, ngspice's current tolerance (its abstol option), so PlainSpice shows 0 A.`,
  noiseGave: (name: string, value: string): string => `${name} ${value} A`,
} as const;

const S = DESCRIBE_STRINGS;

// ------------------------------------------------------------------ helpers

/** "a", "a and b", "a, b and c". */
function listWords(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "a resistor", "an inductor". */
function article(what: string): string {
  return /^[aeiou]/i.test(what) && !/^(uni|one)/i.test(what) ? `an ${what}` : `a ${what}`;
}

/** Top-level part lines that ngspice reads, by lower-case name (the first one wins). */
interface Parts {
  byKey: Map<string, NetlistLine>;
  lines: NetlistLine[];
  subckts: string[];
}

const partsCache = new WeakMap<Netlist, Parts>();

function partsOf(netlist: Netlist): Parts {
  const cached = partsCache.get(netlist);
  if (cached) return cached;
  const parts: Parts = { byKey: new Map(), lines: [], subckts: [] };
  let depth = 0;
  for (const line of netlist.lines) {
    const d = line.directive;
    if (d && (d.name === '.subckt' || d.name === '.macro')) {
      depth += 1;
      if (d.args[0]) parts.subckts.push(d.args[0].text);
      continue;
    }
    if (d && (d.name === '.ends' || d.name === '.eom')) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0 || !line.element) continue;
    parts.lines.push(line);
    if (!parts.byKey.has(line.element.key)) parts.byKey.set(line.element.key, line);
  }
  // S25, S26: ngspice still reads the parts after a plain .end, so they are part of the circuit and
  // of its results (the parser gives those lines no element: read each one on its own).
  for (const line of readAfterEnd(netlist)) {
    const element = parseNetlist(`*\n${line.text}`).lines[1]?.element;
    if (!element) continue;
    const part: NetlistLine = { ...line, element };
    parts.lines.push(part);
    if (!parts.byKey.has(element.key)) parts.byKey.set(element.key, part);
  }
  partsCache.set(netlist, parts);
  return parts;
}

/** A node in written results: ngspice's name; ground is "0". */
const nodeName = (ref: NodeRef): string => (ref.ground ? '0' : ref.name);
/** A node in speech: "ground" for node 0. */
const nodeSpeech = (name: string): string => (name === '0' ? S.ground : name);
/** A node in the circuit overview, as written; ground is "ground". */
const nodeWritten = (ref: NodeRef | undefined): string => (!ref ? '?' : ref.ground ? S.ground : ref.token.text);

function flows(speech: string): string {
  return speech.split(' ')[0] === '1' ? 'flows' : 'flow';
}

/** Ohms in plain units; ngspice's 1e20 stand-in is written with its exponent ("1e+20 Ω", formatSI). */
function ohms(v: number): { text: string; speech: string } {
  return { text: formatSI(v, 'Ω'), speech: speakSI(v, 'Ω') };
}

function dcValue(el: Element): number | undefined {
  return el.value?.number?.value;
}

/** A voltage source whose DC value is 0 (written or missing) and that has no transient function: an ammeter (P9, P16). */
function isAmmeter(el: Element): boolean {
  if (el.letter !== 'V' || el.sourceFunction) return false;
  if (!el.value) return true;
  return el.value.number?.value === 0;
}

function sweptSource(netlist: Netlist, key: string): boolean {
  return sweptBy(netlist, key) !== undefined;
}

// ------------------------------------------------------------------ describeCircuit

function partSentence(netlist: Netlist, line: NetlistLine): string {
  const el = line.element!;
  const name = el.name.text;
  const [a, b, c, d] = el.nodes;
  const v = dcValue(el);
  const fmt = (unit: string): string => (v === undefined ? '' : formatSI(v, unit));
  switch (el.letter) {
    case 'R':
      return S.resistor(name, fmt('Ω'), nodeWritten(a), nodeWritten(b));
    case 'C':
      return S.capacitor(name, fmt('F'), nodeWritten(a), nodeWritten(b));
    case 'L':
      return S.inductor(name, fmt('H'), nodeWritten(a), nodeWritten(b));
    case 'V':
      if (sweptSource(netlist, el.key)) return S.swept(name, nodeWritten(a), nodeWritten(b));
      if (el.sourceFunction && v === undefined) return S.vFunction(name, el.sourceFunction.token.text.toUpperCase(), nodeWritten(a), nodeWritten(b));
      if (isAmmeter(el)) return S.ammeter(name, nodeWritten(a), nodeWritten(b));
      return S.vSource(name, fmt('V'), nodeWritten(a), nodeWritten(b));
    case 'I':
      if (el.sourceFunction && v === undefined) return S.iFunction(name, el.sourceFunction.token.text.toUpperCase(), nodeWritten(a), nodeWritten(b));
      return S.iSource(name, fmt('A'), nodeWritten(a), nodeWritten(b));
    case 'E':
      return S.vcvs(name, S.voltageAt(nodeWritten(a), nodeWritten(b)), v === undefined ? '?' : formatNumber(v), S.voltageAt(nodeWritten(c), nodeWritten(d)));
    case 'G':
      return S.vccs(name, v === undefined ? '?' : formatSI(v, 'A'), d?.ground ? S.at(nodeWritten(c)) : S.between(nodeWritten(c), nodeWritten(d)), nodeWritten(a), nodeWritten(b));
    case 'F':
      return S.cccs(name, v === undefined ? '?' : formatNumber(v), el.controlSource?.text ?? '?', nodeWritten(a), nodeWritten(b));
    case 'H':
      return S.ccvs(name, S.voltageAt(nodeWritten(a), nodeWritten(b)), v === undefined ? '?' : formatSI(v, 'V'), el.controlSource?.text ?? '?');
    case 'K': {
      const [l1, l2] = el.fields.filter((f) => f.role === 'other').map((f) => f.token.text);
      return S.coupling(name, l1 ?? '?', l2 ?? '?', v === undefined ? '?' : formatNumber(v));
    }
    default: {
      const info = el.letter ? elementInfo(el.letter) : undefined;
      const labels = info?.nodeLabels ?? [];
      const nodes = el.nodes.map((ref, k) => S.labelled((labels[Math.min(k, labels.length - 1)] ?? 'node').replace(/ \(.*\)$/, ''), nodeWritten(ref)));
      const model = el.fields.find((f) => f.role === 'model');
      if (model) nodes.push(el.letter === 'X' ? S.subcircuitOf(model.token.text) : S.modelOf(model.token.text));
      return S.otherPart(name, article(info?.name ?? 'part'), nodes.join(', '));
    }
  }
}

function analysisPhrase(netlist: Netlist, r: AnalysisReading): string {
  switch (r.kind) {
    case 'op':
      return S.opName;
    case 'tf':
      return S.tfName(r.output, r.input?.text ?? '?');
    case 'dc': {
      const sweeps = r.sweeps.map((s) => S.dcSweep(sweepName(s), sweepValue(s, s.startValue, s.start?.text), sweepValue(s, s.stopValue, s.stop?.text), sweepValue(s, s.stepValue, s.step?.text)));
      return S.dcName(sweeps.join(' and '), r.points !== undefined ? S.points(r.points) : '');
    }
    case 'tran':
      return S.tranName(r.tstop !== undefined ? formatSI(r.tstop, 's') : '?');
    case 'ac':
      return S.acName(r.fstart !== undefined ? formatSI(r.fstart, 'Hz') : '?', r.fstop !== undefined ? formatSI(r.fstop, 'Hz') : '?');
    case 'other':
      return S.otherAnalysis(netlist.lines[r.line]?.directive?.token.text ?? r.name);
  }
}

function sweepName(s: SweepReading): string {
  return s.kind === 'temperature' ? 'the temperature' : s.source.text;
}

function sweepValue(s: SweepReading, v: number | undefined, text: string | undefined): string {
  return v !== undefined ? (s.unit ? formatSI(v, s.unit) : formatNumber(v)) : (text ?? '?');
}

/** Parts described one by one; a netlist with more (pasted, or from a link) is summed up after these. */
export const DESCRIBED_PARTS = 100;

/**
 * The circuit in a few sentences for screen readers, in netlist order: how many parts and nodes,
 * one short sentence per part (the first DESCRIBED_PARTS of them), then the analyses.
 */
export function describeCircuit(netlist: Netlist): string {
  const parts = partsOf(netlist);
  const out: string[] = [];
  const nodes = [...netlist.nodes.values()].filter((n) => !n.ground && n.connections.length > 0);
  const names = nodes.length > DESCRIBED_PARTS ? '' : nodes.map((n) => n.name).join(', ');
  const grounded = netlist.nodes.get('0')?.connections.length ?? 0;
  if (parts.lines.length === 0) out.push(S.noParts);
  else out.push(grounded > 0 ? S.counts(parts.lines.length, nodes.length, names) : S.countsNoGround(parts.lines.length, nodes.length, names));
  for (const line of parts.lines.slice(0, DESCRIBED_PARTS)) out.push(partSentence(netlist, line));
  if (parts.lines.length > DESCRIBED_PARTS) out.push(S.moreParts(parts.lines.length - DESCRIBED_PARTS));
  if (parts.subckts.length) out.push(S.subcircuits(parts.subckts.length, parts.subckts.join(', ')));
  const analyses = netlist.analyses.map((i) => readAnalysis(netlist, i)).filter((r): r is AnalysisReading => r !== undefined);
  if (analyses.length === 0) {
    // M20; A36: a .control block runs; S25: so does an analysis written after a plain .end.
    if (readAfterEnd(netlist).some((l) => ANALYSIS_WORD.test(l.text))) out.push(S.analysisAfterEnd);
    else out.push(netlist.lines.some((l) => l.kind === 'control' && /^\s*\.control\b/i.test(l.text)) ? S.noAnalysisControl : S.noAnalysis);
  } else {
    const list = analyses.map((r) => analysisPhrase(netlist, r)).join('; ');
    out.push(analyses.length === 1 ? S.analysis(list) : S.analyses(list));
  }
  return out.join(' ');
}

// ------------------------------------------------------------------ results

const SOURCE_LETTERS: ReadonlySet<ElementLetter> = new Set(['V', 'I', 'E', 'F', 'G', 'H', 'B']);
/** Device currents ngspice gets right in .op; switches are not among them (C8). */
const DEVICE_LETTERS: ReadonlySet<ElementLetter> = new Set(['R', 'C', 'L', 'F', 'G', 'I', 'B']);
const BRANCH_LETTERS: ReadonlySet<ElementLetter> = new Set(['V', 'E', 'H', 'L']);

/**
 * ngspice's default current tolerance, abstol (C9c). A current below it is shown as 0 A only when
 * it is also below NOISE_RATIO × the circuit's own current scale
 * (currentScale), so a real tiny current is kept: the 3 aA of a 3a source is the whole circuit there
 * (unit-letter-1), while a balanced bridge leaves −8.88e−19 A next to 0.45 mA (C9).
 */
export const ABSTOL = 1e-12;
/** About 5000 times the rounding of one double (2.2e-16): far below any current a circuit makes. */
export const NOISE_RATIO = 1e-12;

/**
 * How big this circuit's currents are: the largest current ngspice gives, or the largest a node
 * voltage drives through a resistor to ground, whichever is larger. When every true current is 0,
 * every current in the results is noise too, so the resistors give the scale (C9b: 12 V and 1 kΩ).
 */
function currentScale(netlist: Netlist, results: AnalysisResults, volts: Map<string, number>): number {
  let scale = 0;
  for (const c of results.op?.currents ?? []) if (Number.isFinite(c.value)) scale = Math.max(scale, Math.abs(c.value));
  for (const line of partsOf(netlist).lines) {
    const el = line.element!;
    const r = el.letter === 'R' && isBuilt(el) ? el.value?.number?.value : undefined;
    const [a, b] = el.nodes;
    if (!r || !Number.isFinite(r) || !a || !b) continue;
    const v = Math.max(Math.abs(volts.get(nodeName(a)) ?? 0), Math.abs(volts.get(nodeName(b)) ?? 0));
    if (Number.isFinite(v)) scale = Math.max(scale, v / Math.abs(r));
  }
  return scale;
}

/** Rounding noise, not a current (C9–C9c): see ABSTOL. */
export function isNoise(current: number, scale: number): boolean {
  const size = Math.abs(current);
  return size > 0 && size < ABSTOL && size < NOISE_RATIO * scale;
}

/**
 * ngspice's names back to the netlist's (W16-W18). ngspice writes each byte of a letter outside ASCII
 * as '_', so its results say "giri__" for the netlist's "giriş". A name maps back when exactly one
 * netlist name is spelled that way; names ngspice made one (W17, W18) stay as ngspice spells them,
 * and the checks say why (non-ascii-node, duplicate-name).
 */
interface Spellings {
  nodes: Map<string, string | null>;
  parts: Map<string, string | null>;
}
const spellingsCache = new WeakMap<Netlist, Spellings>();

function spellingsOf(netlist: Netlist): Spellings {
  const cached = spellingsCache.get(netlist);
  if (cached) return cached;
  const add = (m: Map<string, string | null>, key: string): void => {
    const spelling = ngspiceSpelling(key);
    const had = m.get(spelling);
    m.set(spelling, had === undefined || had === key ? key : null);
  };
  const out: Spellings = { nodes: new Map(), parts: new Map() };
  for (const key of netlist.nodes.keys()) add(out.nodes, key);
  for (const key of partsOf(netlist).byKey.keys()) add(out.parts, key);
  spellingsCache.set(netlist, out);
  return out;
}

/** A node ngspice names in its results, as the netlist writes it (W16). */
function netlistNode(netlist: Netlist, name: string): string {
  const key = lowerAscii(name);
  return spellingsOf(netlist).nodes.get(key) ?? key;
}

/** A part ngspice names in its results, as the netlist writes it (W18). */
function netlistPart(netlist: Netlist, name: string): string {
  const key = lowerAscii(name);
  return spellingsOf(netlist).parts.get(key) ?? key;
}

function voltages(netlist: Netlist, results: AnalysisResults): Map<string, number> {
  const m = new Map<string, number>([['0', 0]]);
  for (const n of results.op?.nodes ?? []) m.set(netlistNode(netlist, n.node), n.value);
  return m;
}

function currentWords(netlist: Netlist, c: ElementCurrent, volts: Map<string, number>, scale: number): CurrentWords | undefined {
  const key = netlistPart(netlist, c.element);
  const line = partsOf(netlist).byKey.get(key);
  const el = line?.element;
  // P15, P15b: a part ngspice left out has no current, even when savecurrents writes a 0 for it.
  if (!el || !el.letter || !isBuilt(el)) return undefined;
  if (c.origin === 'device' && !DEVICE_LETTERS.has(el.letter)) return undefined;
  if (c.origin === 'branch' && !BRANCH_LETTERS.has(el.letter)) return undefined;
  const [p, n] = el.nodes;
  if (!p || !n) return undefined;
  const first = nodeName(p);
  const second = nodeName(n);
  // C9: rounding noise is 0 A, with no direction and no power; `noise` keeps what ngspice gave.
  const noise = isNoise(c.value, scale);
  const v = noise ? 0 : c.value;
  const [from, to] = v < 0 ? [second, first] : [first, second];
  const name = el.name.text;
  const ammeter = isAmmeter(el);
  const a = formatSI(Math.abs(v), 'A');
  const as = speakSI(Math.abs(v), 'A');
  let text: string;
  let speech: string;
  if (ammeter) {
    text = v === 0 ? S.measuresNothing(name) : S.measures(name, a, from, to);
    speech = v === 0 ? S.measuresNothing(name) : S.measures(name, as, nodeSpeech(from), nodeSpeech(to));
  } else if (v === 0) {
    text = S.noCurrent(name);
    speech = S.noCurrentSpeech(name);
  } else {
    text = S.amps(a, from, to, name);
    speech = S.ampsSpeech(as, flows(as), nodeSpeech(from), nodeSpeech(to), name);
  }
  const words: CurrentWords = { element: key, vector: c.vector, name, line: line.number, value: v, from, to, ammeter, text, speech };
  if (noise) words.noise = c.value;
  if (!ammeter && SOURCE_LETTERS.has(el.letter)) {
    const vp = volts.get(first);
    const vn = volts.get(second);
    if (vp !== undefined && vn !== undefined) {
      const absorbed = (vp - vn) * v;
      if (absorbed !== 0) {
        const watts = Math.abs(absorbed);
        const delivers = absorbed < 0;
        const w = formatSI(watts, 'W');
        const ws = speakSI(watts, 'W');
        words.power = {
          watts,
          delivers,
          text: delivers ? S.delivers(name, w) : S.absorbs(name, w),
          speech: delivers ? S.delivers(name, ws) : S.absorbs(name, ws),
        };
      }
    }
  }
  return words;
}

function currentsOf(netlist: Netlist, results: AnalysisResults): CurrentWords[] {
  const volts = voltages(netlist, results);
  const all = results.op?.currents ?? [];
  // An inductor appears twice with savecurrents (i(l1) and @l1[i], the same number): keep the branch one.
  const branch = new Set(all.filter((c) => c.origin === 'branch').map((c) => lowerAscii(c.element)));
  const scale = currentScale(netlist, results, volts);
  const out: CurrentWords[] = [];
  for (const c of all) {
    if (c.origin === 'device' && branch.has(lowerAscii(c.element))) continue;
    const w = currentWords(netlist, c, volts, scale);
    if (w) out.push(w);
  }
  const order = new Map(partsOf(netlist).lines.map((l, i) => [l.element!.key, i]));
  return out.sort((x, y) => (order.get(x.element) ?? 0) - (order.get(y.element) ?? 0));
}

function nodesOf(netlist: Netlist, results: AnalysisResults): NodeVoltageWords[] {
  const keys = [...netlist.nodes.keys()];
  const order = new Map(keys.map((k, i) => [k, i]));
  const colour = new Map<string, number>();
  for (const k of keys) if (k !== '0' && k !== 'gnd') colour.set(k, colour.size);
  // W16: the netlist's own name ("giriş"), not ngspice's spelling ("giri__"), which `ngspice` keeps.
  const list = (results.op?.nodes ?? []).map((n, i) => ({ n, i, node: netlistNode(netlist, n.node) }));
  list.sort((x, y) => (order.get(x.node) ?? keys.length + x.i) - (order.get(y.node) ?? keys.length + y.i));
  return list.map(({ n, node }) => {
    const w: NodeVoltageWords = { node: node === lowerAscii(n.node) ? n.node : node, value: n.value, text: formatSI(n.value, 'V'), speech: speakSI(n.value, 'V') };
    if (node !== lowerAscii(n.node)) w.ngspice = n.node;
    const c = colour.get(node);
    if (c !== undefined) w.colourIndex = c;
    return w;
  });
}

function tfOf(netlist: Netlist, results: AnalysisResults): TransferFunctionWords | undefined {
  const tf = results.tf;
  if (!tf) return undefined;
  const line = netlist.analyses.find((i) => netlist.lines[i]?.directive?.name === '.tf');
  const r = line === undefined ? undefined : readAnalysis(netlist, line);
  const reading = r?.kind === 'tf' ? r : undefined;
  const output = reading?.output ?? tf.outputImpedance?.at ?? '?';
  const input = reading?.input?.text ?? tf.inputImpedance?.source ?? '?';
  const outKind = reading?.outputKind ?? (tf.outputImpedance?.at.startsWith('i(') ? 'current' : 'voltage');
  const inKind = reading?.inputKind === 'current' ? 'current' : 'voltage';
  const ratio = `${outKind === 'current' ? 'A' : 'V'}/${inKind === 'current' ? 'A' : 'V'}`;
  const words: TransferFunctionWords = { output, input, ratio };
  if (tf.transferFunction !== undefined) {
    const v = formatNumber(tf.transferFunction);
    const [n1, n2] = reading?.outputNames ?? [];
    const outSpeech = outKind === 'current' ? S.currentIn(n1 ?? output) : n1 === undefined ? output : n2 === undefined ? S.voltageOf(n1) : S.voltageBetween(n1, n2);
    words.transferFunction = {
      value: tf.transferFunction,
      text: S.transfer(output, input, v, ratio),
      speech: S.transferSpeech(outSpeech, input, v.replace(MINUS, 'minus '), (v === '1' ? S.ratioWordsOne[ratio] : S.ratioWords[ratio]) ?? ratio),
    };
  }
  if (tf.inputImpedance) {
    const o = ohms(tf.inputImpedance.value);
    words.inputResistance = { value: tf.inputImpedance.value, text: S.inputR(input, o.text), speech: S.inputRSpeech(input, o.speech) };
  }
  if (tf.outputImpedance) {
    const o = ohms(tf.outputImpedance.value);
    if (outKind === 'current') {
      // A5: for a current output ngspice reports 1e20 Ω, which is not a resistance of the circuit.
      words.outputResistance = { value: tf.outputImpedance.value, text: S.outputRCurrent(output, o.text), speech: S.outputRCurrentSpeech(output, o.speech) };
    } else {
      const [a, b] = reading?.outputNames ?? [];
      const at = b ? S.between(a ?? '?', b) : S.at(a ?? tf.outputImpedance.at);
      words.at = at;
      words.outputResistance = { value: tf.outputImpedance.value, text: S.outputR(at, o.text), speech: S.outputRSpeech(at, o.speech) };
    }
  }
  return words;
}

/** "the voltage at out" / "the current in V1" for a sweep result's name. */
function seriesSpeech(netlist: Netlist, s: SweepSeries): string {
  const m = /^([vi])\((.*)\)$/i.exec(s.name);
  if (!m) return s.name;
  if (m[1]!.toLowerCase() === 'v') {
    const [a, b] = m[2]!.split(',').map((x) => netlistNode(netlist, x));
    return b === undefined ? S.voltageOf(a!) : S.voltageBetween(a!, b);
  }
  // i(v1) is a branch current; i(@r1[i]) a part's current with savecurrents.
  const inner = /^@([^[\]]+)\[/.exec(m[2]!)?.[1] ?? m[2]!;
  const part = partsOf(netlist).byKey.get(netlistPart(netlist, inner));
  return S.currentIn(part?.element?.name.text ?? inner);
}

/** A results vector's name with the netlist's names in it: "v(giriş)" for ngspice's "v(giri__)" (W16, W18). */
function netlistVector(netlist: Netlist, name: string): string {
  const m = /^([vi])\((.*)\)$/i.exec(name);
  if (!m) return name;
  if (m[1]!.toLowerCase() === 'v') return `${m[1]}(${m[2]!.split(',').map((x) => netlistNode(netlist, x)).join(',')})`;
  const device = /^@([^[\]]+)(\[.*)$/.exec(m[2]!);
  return device ? `${m[1]}(@${netlistPart(netlist, device[1]!)}${device[2]})` : `${m[1]}(${netlistPart(netlist, m[2]!)})`;
}

function finals(netlist: Netlist, sweep: Sweep): SweepWords['final'] {
  return sweep.series.map((s) => {
    const value = s.values[s.values.length - 1] ?? Number.NaN;
    const unit = s.unit === '°C' || s.unit === 's' ? s.unit : s.unit;
    return {
      name: s.name,
      value,
      text: S.valueIs(netlistVector(netlist, s.name), formatSI(value, unit)),
      speech: S.valueIsSpeech(seriesSpeech(netlist, s), speakSI(value, unit)),
    };
  });
}

function sweepsOf(netlist: Netlist, results: AnalysisResults): SweepWords[] {
  const out: SweepWords[] = [];
  if (results.dc) {
    const sweep = results.dc;
    const line = netlist.analyses.find((i) => netlist.lines[i]?.directive?.name === '.dc');
    const r = line === undefined ? undefined : readAnalysis(netlist, line);
    const dc = r?.kind === 'dc' ? r : undefined;
    const points = sweep.scale.values.length;
    const sweeps = dc?.sweeps ?? [];
    const what = sweeps.length
      ? sweeps.map((s) => S.dcSweep(sweepName(s), sweepValue(s, s.startValue, s.start?.text), sweepValue(s, s.stopValue, s.stop?.text), sweepValue(s, s.stepValue, s.step?.text))).join(' and ')
      : sweep.scale.name;
    const f = finals(netlist, sweep);
    const last = sweep.scale.values[points - 1];
    const firstSweep = sweeps[0];
    const one = sweeps.length === 1 && firstSweep && last !== undefined ? firstSweep : undefined;
    // "At 100 °C: …" for a temperature sweep, "At V1 = 12 V: …" for a source.
    const where = !one ? S.atLastPoint : one.kind === 'temperature' ? formatSI(last!, sweep.scale.unit) : S.sweepAt(sweepName(one), formatSI(last!, sweep.scale.unit));
    const whereSpeech = !one ? S.atLastPoint : one.kind === 'temperature' ? speakSI(last!, sweep.scale.unit) : S.sweepAtSpeech(sweepName(one), speakSI(last!, sweep.scale.unit));
    const head = points ? S.dcSweepText(what, points) : S.dcNoPoints(what);
    const text = points && f.length ? `${head} ${S.atEnd(where, f.map((x) => x.text).join(', '))}` : head;
    const speech =
      points && f.length ? `${head} ${(one && one.kind !== 'temperature' ? S.atEndSpeech : S.atEnd)(whereSpeech, f.map((x) => x.speech).join(', '))}` : head;
    out.push({ kind: 'dc', points, text, speech, final: f });
  }
  if (results.tran) {
    const sweep = results.tran;
    const t = sweep.scale.values;
    const points = t.length;
    const f = finals(netlist, sweep);
    const from = formatSI(t[0] ?? 0, 's');
    const to = formatSI(t[points - 1] ?? 0, 's');
    const head = S.tranText(from, to, points);
    const text = points && f.length ? `${head} ${S.atEnd(to, f.map((x) => x.text).join(', '))}` : head;
    const speech = points && f.length ? `${head} ${S.atEnd(speakSI(t[points - 1] ?? 0, 's'), f.map((x) => x.speech).join(', '))}` : head;
    out.push({ kind: 'tran', points, text, speech, final: f });
  }
  return out;
}

// ------------------------------------------------------------------ messages

/** Messages ngspice prints that src/engine/diagnostics.ts does not classify, but a beginner needs (P10, A28, A29). */
function unclassified(run: RunResult): EngineDiagnostic[] {
  const text = `${run.stderr}\n${run.stdout}`;
  const out: EngineDiagnostic[] = [];
  const control = /unknown controlling source (\S+)/i.exec(text);
  if (control) out.push({ severity: 'error', code: 'unknown-control-source', text: control[0], subject: control[1]! });
  const dot = /unimplemented dot command '([^']+)'/i.exec(text);
  if (dot) out.push({ severity: 'error', code: 'unknown-dot-command', text: dot[0], subject: dot[1]! });
  if (/No \.measure possible in batch mode/i.test(text)) out.push({ severity: 'note', code: 'meas-skipped', text: 'No .measure possible in batch mode (-b) with -r rawfile set!' });
  return out;
}

/** Codes that only repeat an earlier message (dropped when a more specific one is there). */
const FOLLOW_UPS = new Set(['circuit-not-parsed', 'run-aborted', 'fatal', 'op-failed', 'timestep-too-small']);
/** ngspice's closing lines after a netlist error, which say nothing new. */
const CLOSING_LINES = /there aren't any circuits loaded|incomplete or empty netlist|no simulations run|can't find model/i;

function isFollowUp(d: EngineDiagnostic): boolean {
  return FOLLOW_UPS.has(d.code) || ((d.code === 'error' || d.code === 'warning') && CLOSING_LINES.test(d.text));
}
/** Folded into the "these numbers can't be trusted" message. */
const FOLDED_WHEN_UNRELIABLE = new Set(['gmin-stepping-failed', 'source-stepping-failed', 'transient-op-fallback']);

/**
 * "unrecognized variable - @r1[i]": the current of a part ngspice left out (or that is not in the
 * circuit at all), asked for by `.options savecurrents`. It says nothing the "left out" message does
 * not, and PlainSpice usually added that line itself (M5).
 */
function leftOutCurrent(netlist: Netlist, d: EngineDiagnostic): boolean {
  const m = /unrecognized variable - @([^[\s]+)\[/i.exec(d.text);
  if (!m) return false;
  const el = partsOf(netlist).byKey.get(lowerAscii(m[1]!))?.element;
  return !el || !isBuilt(el);
}

const ANALYSIS_WORD = /^\s*(\.(?:op|tf|dc|tran|ac|noise|disto|pz|sens|sp|four|fourier))\b/i;

/** Why a run without analysis lines gave nothing: a .control block, an @ line, the title line (M20, S29, A34). */
function nothingRanWords(netlist: Netlist): MessageWords {
  if (netlist.lines.some((l) => l.kind === 'control' && /^\s*\.control\b/i.test(l.text))) {
    return { code: 'control-only', severity: 'note', title: S.controlOnlyTitle, why: S.controlOnlyWhy };
  }
  const at = netlist.lines.find((l) => l.index > 0 && l.kind === 'invalid' && l.text.trimStart().startsWith('@'));
  if (at && netlist.lines.some((l) => l.index > at.index && ANALYSIS_WORD.test(l.text))) {
    return { code: 'no-analysis', severity: 'error', title: S.noAnalysisTitle, why: S.noAnalysisAtWhy(at.number), line: at.number };
  }
  const title = ANALYSIS_WORD.exec(netlist.lines[0]?.text ?? '');
  if (title) return { code: 'no-analysis', severity: 'error', title: S.noAnalysisTitle, why: S.noAnalysisTitleWhy(title[1]!), line: 1 };
  return { code: 'no-analysis', severity: 'error', title: S.noAnalysisTitle, why: S.noAnalysisWhy };
}

function messagesOf(netlist: Netlist, run: RunResult, results: AnalysisResults): MessageWords[] {
  const diagnostics = [...run.diagnostics, ...unclassified(run)];
  const out: MessageWords[] = [];
  const seen = new Set<string>();
  const push = (m: MessageWords): void => {
    const key = `${m.code}|${m.title}|${m.line ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(m);
  };
  const hasResults = !!(results.op || results.tf || results.dc || results.tran || results.other.length);
  if (run.unreliable && hasResults) push({ code: 'unreliable', severity: 'warning', title: S.unreliableTitle, why: S.unreliableWhy });
  const specific = diagnostics.some((d) => (d.severity === 'error' || d.code === 'singular-matrix') && !isFollowUp(d));
  for (const d of diagnostics) {
    if (run.unreliable && FOLDED_WHEN_UNRELIABLE.has(d.code)) continue;
    if (isFollowUp(d) && (specific || out.some((m) => m.severity === 'error'))) continue;
    // Once the run has failed for a known reason, ngspice's other warnings are noise.
    if (d.code === 'warning' && !run.ok && specific) continue;
    if (d.code === 'warning' && leftOutCurrent(netlist, d)) continue;
    const words = explainDiagnostic(d, netlist);
    const m: MessageWords = { code: d.code, severity: d.severity, title: words.title, why: words.why };
    if (words.line !== undefined) m.line = words.line;
    push(m);
  }
  // A6: a .tf output node that no part connects to gives numbers without any message.
  if (results.tf) {
    for (const i of netlist.analyses) {
      const r = readAnalysis(netlist, i);
      if (r?.kind !== 'tf' || r.outputKind !== 'voltage') continue;
      for (const n of r.outputNames) {
        const key = lowerAscii(n);
        const info = netlist.nodes.get(key === 'gnd' ? '0' : key);
        if (!info || info.connections.length === 0) push({ code: 'tf-node-missing', severity: 'warning', title: S.tfNodeTitle(n), why: S.tfNodeWhy(n), line: i + 1 });
      }
    }
  }
  if (!run.ok && !hasResults && out.length === 0) {
    if (netlist.analyses.length === 0 && !readAfterEnd(netlist).some((l) => ANALYSIS_WORD.test(l.text))) push(nothingRanWords(netlist)); // M20
    else push({ code: 'no-results', severity: 'error', title: S.noResultsTitle, why: S.noResultsWhy });
  }
  // The general warning first, then the cause (a singular matrix explains the rest), then errors, warnings, notes.
  const rank = (m: MessageWords): number =>
    m.code === 'unreliable' ? 0 : m.code === 'singular-matrix' ? 1 : m.severity === 'error' ? 2 : m.severity === 'warning' ? 3 : 4;
  return out.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map((x) => x.m);
}

// ------------------------------------------------------------------ describeResults

type SummaryInput = Omit<ResultsInWords, 'summary' | 'summarySpeech' | 'status' | 'ngspiceError'>;

/**
 * The one-paragraph summary: written with unit symbols ("a = 14 V") for the page, or for speech
 * with the units in words ("a is 14 volts"), so a screen reader never spells out "mV" or "kΩ".
 */
function summaryOf(status: ResultsInWords['status'], ngspiceError: boolean, words: SummaryInput, results: AnalysisResults, speech: boolean): string {
  const firstProblem = words.warnings.find((m) => m.code !== 'unreliable' && m.severity !== 'note') ?? words.warnings[0];
  const lower = (s: string): string => (s && !/^[A-Z]{2}|^[A-Z]\d|^\./.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);
  if (status === 'failed') return (ngspiceError ? S.summaryFailed : S.summaryEmpty)(firstProblem ? lower(firstProblem.title) : S.summaryNothing);
  if (status === 'unreliable') {
    const specific = words.warnings.find((m) => m.code !== 'unreliable');
    return S.summaryUnreliable(lower(specific?.title ?? S.unreliableTitle));
  }
  const parts: string[] = [];
  if (words.nodes.length) {
    // "node in is 6 volts": a node's name may be an ordinary word (W8, decision 0017).
    const shown = words.nodes.slice(0, 4).map((n) => (speech ? S.valueIsSpeech(S.node(n.node), n.speech) : S.valueIs(S.node(n.node), n.text)));
    parts.push(S.summaryNodes(shown.join(', '), words.nodes.length - shown.length));
  }
  if (words.currents.length) parts.push(S.summaryCurrents(words.currents.length));
  const tf = words.tf;
  if (tf?.transferFunction) parts.push(speech ? tf.transferFunction.speech : S.summaryTf(tf.transferFunction.text));
  if (tf?.inputResistance) parts.push(speech ? tf.inputResistance.speech : tf.inputResistance.text.replace(/ \(ngspice calls.*\)$/, ''));
  if (tf?.outputResistance) parts.push(speech ? tf.outputResistance.speech : tf.outputResistance.text.replace(/, the Thevenin.*$| \(ngspice calls.*\)$/, ''));
  for (const s of words.sweeps) {
    if (s.kind === 'dc') parts.push(S.summaryDc(s.points));
    else {
      const end = results.tran?.scale.values[s.points - 1] ?? 0;
      parts.push(S.summaryTran(speech ? speakSI(end, 's') : formatSI(end, 's'), s.points));
    }
  }
  if (results.other.length) parts.push(S.summaryOther(results.other.length));
  const problems = words.warnings.filter((m) => m.severity !== 'note');
  return S.summaryOk(parts.length ? parts.join('; ') : S.summaryNothing, problems.length, problems[0] ? lower(problems[0].title) : '');
}

/**
 * The results of one run in words: node voltages, currents with their direction and the power of
 * each source, the .tf results, sweep summaries, ngspice's messages in plain words, and a one-
 * paragraph summary for a live region. Part currents other than those of voltage sources need
 * `.options savecurrents` in the netlist that was run (A1, A2).
 */
export function describeResults(netlist: Netlist, results: AnalysisResults, run: RunResult): ResultsInWords {
  const hasResults = !!(results.op || results.tf || results.dc || results.tran || results.other.length);
  // M3: an unreliable run with no results at all has failed; any other run without results too.
  const status: ResultsInWords['status'] = !hasResults ? 'failed' : run.unreliable ? 'unreliable' : run.ok ? 'ok' : 'failed';
  // 'rawfile' is PlainSpice's own message (it could not read the results file), not ngspice's.
  const ngspiceError =
    run.exitCode !== 0 || run.diagnostics.some((d) => d.severity === 'error' && d.code !== 'rawfile') || unclassified(run).some((d) => d.severity === 'error');
  const words: SummaryInput = {
    nodes: nodesOf(netlist, results),
    currents: currentsOf(netlist, results),
    sweeps: sweepsOf(netlist, results),
    warnings: messagesOf(netlist, run, results),
  };
  const tf = tfOf(netlist, results);
  if (tf) words.tf = tf;
  // C9–C9c: what ngspice gave for each current said as 0 A, last, as a note (it is no problem). Only
  // with numbers that are answers: a failed or untrusted run is summed up by its first message.
  const noisy = words.currents.filter((c) => c.noise !== undefined);
  if (status === 'ok' && noisy.length) {
    const gave = noisy.map((c) => S.noiseGave(c.name, formatLikeNgspice(c.noise!)));
    const note: MessageWords = { code: 'rounding-noise', severity: 'note', title: S.noiseTitle(noisy.map((c) => c.name)), why: S.noiseWhy(listWords(gave), noisy.length === 1) };
    if (noisy.length === 1 && noisy[0]!.line !== undefined) note.line = noisy[0]!.line;
    words.warnings.push(note);
  }
  return {
    status,
    ngspiceError,
    ...words,
    summary: summaryOf(status, ngspiceError, words, results, false),
    summarySpeech: summaryOf(status, ngspiceError, words, results, true),
  };
}

// ------------------------------------------------------------------ annotateLines

/**
 * Short results for the end of each part's line, after an operating point: "3 A, n1 → 0" for a
 * part, "delivers 18 W, 3 A out of +" for a source, "12 V across" when ngspice gave no current.
 * Only part lines get a note. Empty when the run's numbers can't be trusted (pass `run`).
 */
export function annotateLines(netlist: Netlist, results: AnalysisResults, run?: RunResult): LineAnnotation[] {
  if (!results.op || (run && (run.unreliable || !run.ok))) return [];
  const volts = voltages(netlist, results);
  const byKey = new Map(currentsOf(netlist, results).map((c) => [c.element, c]));
  const out: LineAnnotation[] = [];
  for (const line of partsOf(netlist).lines) {
    const el = line.element!;
    // P15, P15b: an R, C or L line with nothing after its nodes is left out of the circuit, so it gets no note.
    if (!isBuilt(el)) continue;
    const c = byKey.get(el.key);
    if (c) {
      out.push(sourceOrPartNote(line, el, c));
      continue;
    }
    const [p, n] = el.nodes;
    if (!p || !n || !el.letter || el.letter === 'K') continue;
    const vp = volts.get(nodeName(p));
    const vn = volts.get(nodeName(n));
    if (vp === undefined || vn === undefined) continue;
    const across = vp - vn;
    out.push({ line: line.number, text: S.noteAcross(formatSI(across, 'V')), speech: S.noteAcrossSpeech(speakSI(across, 'V'), el.name.text) });
  }
  return out;
}

function sourceOrPartNote(line: NetlistLine, el: Element, c: CurrentWords): LineAnnotation {
  const a = formatSI(Math.abs(c.value), 'A');
  const as = speakSI(Math.abs(c.value), 'A');
  if (c.ammeter) {
    return {
      line: line.number,
      text: c.value === 0 ? S.noteNoCurrent : S.noteAmps(a, c.from, c.to),
      speech: c.value === 0 ? S.measuresNothing(c.name) : S.noteMeasures(as, nodeSpeech(c.from), nodeSpeech(c.to)),
    };
  }
  const voltageType = el.letter === 'V' || el.letter === 'E' || el.letter === 'H';
  if (voltageType && c.power && c.value !== 0) {
    // C1, C2: positive current enters at the + node; a source that delivers power pushes it out of +.
    const outOfPlus = c.value < 0;
    const w = formatSI(c.power.watts, 'W');
    const ws = speakSI(c.power.watts, 'W');
    return {
      line: line.number,
      text: S.noteSource(c.power.delivers ? S.noteDelivers(w) : S.noteAbsorbs(w), a, outOfPlus ? S.noteOutOfPlus : S.noteIntoPlus),
      speech: `${c.power.delivers ? S.noteDelivers(ws) : S.noteAbsorbs(ws)}; ${as} ${flows(as)} ${outOfPlus ? S.noteOutOfPlusSpeech : S.noteIntoPlusSpeech}`,
    };
  }
  if (c.value === 0) return { line: line.number, text: S.noteNoCurrent, speech: S.noteNoCurrentSpeech };
  const base = S.noteAmps(a, c.from, c.to);
  const baseSpeech = S.noteAmpsSpeech(as, flows(as), nodeSpeech(c.from), nodeSpeech(c.to));
  if (c.power) {
    const w = formatSI(c.power.watts, 'W');
    const ws = speakSI(c.power.watts, 'W');
    return {
      line: line.number,
      text: `${base}, ${c.power.delivers ? S.noteDelivers(w) : S.noteAbsorbs(w)}`,
      speech: `${baseSpeech}; ${c.power.delivers ? S.noteDelivers(ws) : S.noteAbsorbs(ws)}`,
    };
  }
  return { line: line.number, text: base, speech: baseSpeech };
}

// ------------------------------------------------------------------ explainDiagnostic

/** A name ngspice reports in lower case, as the netlist writes it (on 1-based `line` when given). */
function written(netlist: Netlist, name: string, line?: number): string {
  const key = lowerAscii(name);
  const lines = line !== undefined ? [netlist.lines[line - 1]] : netlist.lines;
  for (const l of lines) {
    const t = l?.tokens.find((x) => lowerAscii(x.text) === key);
    if (t) return t.text;
  }
  for (const l of lines) {
    const m = l ? new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').exec(l.text) : null;
    if (m) return m[0];
  }
  return name;
}

function lineText(netlist: Netlist, line: number | undefined): string {
  return line === undefined ? '' : (netlist.lines[line - 1]?.text ?? '');
}

function partNamed(netlist: Netlist, name: string | undefined): NetlistLine | undefined {
  return name ? partsOf(netlist).byKey.get(lowerAscii(name)) : undefined;
}

/** The analysis line of a dot command, 1-based. */
function dotLine(netlist: Netlist, name: string): number | undefined {
  for (const i of netlist.directives) if (netlist.lines[i]?.directive?.name === name) return i + 1;
  return undefined;
}

/** What a node connects to, for the singular-matrix message (M1, M2, M2b, M2c). */
function singularWords(netlist: Netlist, subject: string): DiagnosticWords {
  const ground = netlist.nodes.get('0');
  if (!ground || ground.connections.length === 0) return { title: S.noGroundTitle, why: S.noGroundWhy }; // M1
  const branch = /^(.+)#branch$/i.exec(subject);
  if (branch) {
    const part = partNamed(netlist, branch[1]);
    const name = part?.element?.name.text ?? branch[1]!;
    if (part?.element?.letter === 'L') return { title: S.loopTitle(name), why: S.loopWhyL(name), line: part.number }; // M3c
    const w: DiagnosticWords = { title: S.loopTitle(name), why: S.loopWhyV(name) }; // M3, M3b
    if (part) w.line = part.number;
    return w;
  }
  const node = netlist.nodes.get(lowerAscii(subject));
  // M9: an E or G line with fewer than four nodes leaves a node with no single answer in our engine.
  // A missing gain is read as 0 without a singular matrix (missing-value-4, -5), so only too few nodes count.
  const short = node?.connections.map((c) => partsOf(netlist).byKey.get(c.element)).find((l) => (l?.element?.letter === 'E' || l?.element?.letter === 'G') && l.element.nodes.length < 4);
  if (short?.element) return { title: S.shortLineTitle(short.element.name.text), why: S.shortLineWhy(short.element.name.text), line: short.number };
  if (node && node.connections.length > 0) {
    const letters = node.connections.map((c) => partsOf(netlist).byKey.get(c.element)?.element?.letter);
    if (letters.every((l) => l === 'C' || l === 'I')) {
      const what = letters.every((l) => l === 'C') ? S.onlyCapacitors : letters.every((l) => l === 'I') ? S.onlyCurrentSources : S.capacitorsAndCurrentSources;
      return { title: S.capNodeTitle(subject), why: S.capNodeWhy(subject, what) }; // M2, M2b
    }
    // A node whose parts lead nowhere else: every part on it has its other end on nodes with nothing more (M2c).
    const isolated = node.connections.every((c) => {
      const el = partsOf(netlist).byKey.get(c.element)?.element;
      return el !== undefined && el.nodes.every((r) => !r.ground && (netlist.nodes.get(r.name)?.connections.length ?? 0) <= 1);
    });
    if (isolated) return { title: S.floatingTitle(subject), why: S.floatingWhy(subject) };
  }
  return { title: S.singularTitle(subject), why: S.singularWhy(subject) };
}

const SCALE_WORDS = new Set(['t', 'g', 'meg', 'k', 'm', 'u', 'n', 'p', 'f', 'a', 'mil']);

function unknownParameterWords(netlist: Netlist, d: EngineDiagnostic): DiagnosticWords {
  const word = d.subject ?? '';
  const text = lineText(netlist, d.line);
  const lower = lowerAscii(word);
  let w: DiagnosticWords;
  // N12: "1 k", "1 kOhm", "10 uF": a scale letter (and perhaps a unit) written apart from its number.
  const scaleWord = SCALE_WORDS.has(lower) || /^(t|g|meg|k|m|u|\u00b5|n|p|f|a|mil)(ohms?|\u03a9|v|a|f|h|s|hz)$/i.test(word);
  if (scaleWord && /\d\s+\S/.test(text)) w = { title: S.spaceTitle(word), why: S.spaceWhy(word) };
  else if (/^[+-]?\d/.test(word) && text.includes(',')) w = { title: S.commaTitle, why: S.commaWhy }; // N14
  else if (/^[+-]\d/.test(word)) w = { title: S.signTitle, why: S.signWhy(word) }; // N8
  else if (word === '*' || word === '#' || word === '/') w = { title: S.starTitle(word), why: S.starWhy(word) }; // S7, S9, S15
  else w = { title: S.unknownParamTitle(word), why: S.unknownParamWhy(word) };
  if (d.line !== undefined) w.line = d.line;
  return w;
}

/**
 * One ngspice message in plain words, with the netlist line it is about when PlainSpice can tell.
 * Each "why" was checked against a real run (docs/spice-facts/explanations.md, M1–M21).
 */
export function explainDiagnostic(d: EngineDiagnostic, netlist: Netlist): DiagnosticWords {
  const withLine = (w: DiagnosticWords, line: number | undefined = d.line): DiagnosticWords => (line !== undefined ? { ...w, line } : w);
  switch (d.code) {
    case 'singular-matrix':
      return singularWords(netlist, d.subject ?? '?');
    case 'gmin-stepping-failed':
    case 'source-stepping-failed':
      return { title: S.steppingTitle, why: S.steppingWhy };
    case 'transient-op-fallback':
      return { title: S.fallbackTitle, why: S.fallbackWhy };
    case 'transient-op-failed':
      return { title: S.fallbackFailedTitle, why: S.fallbackFailedWhy };
    case 'op-failed':
      return { title: S.opFailedTitle, why: S.opFailedWhy };
    case 'timestep-too-small':
      return { title: S.timestepTitle, why: S.timestepWhy };
    case 'duplicate-name': {
      // M4, W7
      const here = netlist.lines[(d.line ?? 0) - 1]?.element;
      const first = here ? partsOf(netlist).byKey.get(here.key) : undefined;
      const name = first?.element?.name.text ?? here?.name.text ?? '?';
      const earlier = first && first.number !== d.line ? S.duplicateEarlier(here?.name.text ?? name, first.element!.name.text, first.number) : '';
      return withLine({ title: S.duplicateTitle(name), why: S.duplicateWhy(earlier) });
    }
    case 'unknown-device': {
      const c = lineText(netlist, d.line).trimStart()[0];
      return withLine(c ? { title: S.unknownDeviceTitle(c), why: S.unknownDeviceWhy(c) } : { title: S.unknownDeviceGenericTitle, why: S.unknownDeviceGenericWhy }); // M5, M5b
    }
    case 'unknown-subcircuit': {
      // M6: the subject is the part's name; the subcircuit is the last word of its line.
      const part = partNamed(netlist, d.subject);
      const sub = part?.element?.fields.find((f) => f.role === 'model')?.token.text ?? '?';
      return withLine({ title: S.unknownSubcktTitle(sub), why: S.unknownSubcktWhy(part?.element?.name.text ?? d.subject ?? '?', sub) }, d.line ?? part?.number);
    }
    case 'missing-model': {
      const el = netlist.lines[(d.line ?? 0) - 1]?.element;
      const model = el?.fields.find((f) => f.role === 'model')?.token.text;
      const name = el?.name.text ?? '?';
      if (model) {
        const at = dotModel(netlist, model);
        const left = at === undefined ? undefined : leftOutModel(netlist, at);
        if (left) return withLine({ title: S.leftOutModelTitle(name), why: S.leftOutModelWhy(model, left.level, left.model, left.kind, left.message, left.mosfet) }); // M8
        return withLine({ title: S.missingModelTitle(name), why: S.missingModelWhy(name, model) }); // M7
      }
      return withLine({ title: S.missingModelTitle(name), why: S.missingModelWhy(name, '?') });
    }
    case 'missing-fields':
      return withLine({ title: S.missingFieldsTitle, why: S.missingFieldsWhy }); // M9 (native ngspice)
    case 'unknown-parameter':
      return unknownParameterWords(netlist, d);
    case 'line-ignored': {
      // P15, P15b: "'r1 a 0' is not a valid resistor instance line, ignored!"
      const m = /'([^\s']+)/.exec(d.text);
      const part = partNamed(netlist, m?.[1]);
      const what = d.subject ?? 'part';
      return withLine({ title: S.lineIgnoredTitle(part?.element?.name.text ?? m?.[1] ?? '?'), why: S.lineIgnoredWhy(what) }, part?.number);
    }
    case 'no-value-dc0': {
      const part = partNamed(netlist, d.subject);
      const unit = part?.element?.letter === 'I' ? 'A' : 'V';
      return withLine({ title: S.noValueTitle(part?.element?.name.text ?? d.subject ?? '?', unit), why: S.noValueWhy }, part?.number); // P16
    }
    case 'resistor-too-small': {
      const part = partNamed(netlist, d.subject);
      return withLine({ title: S.tooSmallTitle(part?.element?.name.text ?? d.subject ?? '?'), why: S.tooSmallWhy }, part?.number); // P13, P24
    }
    case 'tf-source-missing': {
      const at = dotLine(netlist, '.tf');
      const name = written(netlist, d.subject ?? '?', at);
      return withLine({ title: S.tfMissingTitle(name), why: S.tfMissingWhy(name) }, at); // M10
    }
    case 'tf-source-type': {
      const part = partNamed(netlist, d.subject);
      const name = part?.element?.name.text ?? d.subject ?? '?';
      return withLine({ title: S.tfTypeTitle(name), why: S.tfTypeWhy(name) }, dotLine(netlist, '.tf')); // M11
    }
    case 'sweep-source-missing': {
      const at = dotLine(netlist, '.dc');
      const name = written(netlist, d.subject ?? '?', at);
      return withLine({ title: S.sweepMissingTitle(name), why: S.sweepMissingWhy(name) }, at); // M12
    }
    case 'bad-syntax': {
      const isDc = /^\s*\.dc\b/i.test(lineText(netlist, d.line));
      return withLine(isDc ? { title: S.badSyntaxDcTitle, why: S.badSyntaxDcWhy } : { title: S.badSyntaxTitle, why: S.badSyntaxWhy }); // M13, M13b
    }
    case 'bad-tran-arguments': {
      const which = (d.subject ?? '').toUpperCase();
      const w = which === 'TSTEP' ? { title: S.tstepTitle, why: S.tstepWhy } : which === 'TSTART' ? { title: S.tstartTitle, why: S.tstartWhy } : { title: S.tstopTitle, why: S.tstopWhy };
      return withLine(w, d.line ?? dotLine(netlist, '.tran')); // M14, M15, M15b
    }
    case 'missing-inductor': {
      // M16: "coupling to non-existent inductor l2."
      const k = /^\s*(?:Fatal error:\s*)?(\S+):/i.exec(d.text)?.[1];
      const part = partNamed(netlist, k);
      const name = written(netlist, /non-existent inductor\s+([^\s.]+)/i.exec(d.text)?.[1] ?? '?', part?.number);
      return withLine({ title: S.inductorTitle(name), why: S.inductorWhy(part?.element?.name.text ?? k ?? 'K', name) }, part?.number);
    }
    case 'model-not-in-build':
      return withLine({ title: S.notInBuildTitle, why: S.notInBuildWhy(d.subject ?? '?') }); // L1
    case 'undefined-parameter': {
      const name = written(netlist, d.subject ?? '?', d.line);
      return withLine({ title: S.undefinedParamTitle(name), why: S.undefinedParamWhy(name) }); // M17
    }
    case 'fatal-syntax': {
      const b = /mal formed B (?:source instance|line):\s*(\S+)/i.exec(d.text);
      if (b) return withLine({ title: S.bLineTitle, why: S.bLineWhy }, d.line ?? partNamed(netlist, b[1])?.number); // M19
      return withLine({ title: S.braceTitle, why: S.braceWhy }); // M18, M21
    }
    case 'fatal':
      return withLine({ title: S.fatalTitle, why: S.fatalWhy });
    case 'circuit-not-parsed': {
      const text = lineText(netlist, d.line).trimStart();
      const dot = /^(\.\S+)/.exec(text);
      if (dot && netlist.lines[(d.line ?? 0) - 1]?.directive && !isKnownDotCommand(dot[1]!)) {
        return withLine({ title: S.unknownDotTitle(dot[1]!), why: S.unknownDotWhy(dot[1]!) }); // A29
      }
      return withLine({ title: S.notParsedTitle, why: d.line !== undefined ? S.notParsedLineWhy(d.line) : S.notParsedWhy });
    }
    case 'run-aborted':
      return withLine({ title: S.abortedTitle, why: S.abortedWhy });
    case 'nothing-to-run':
      return withLine({ title: S.nothingTitle, why: S.nothingWhy }); // M20 (native ngspice -b)
    case 'unusual-leading-character': {
      // S10, S36: the first line that starts with one of these characters.
      const odd = netlist.lines.find((l) => l.index > 0 && l.kind === 'comment' && /^[=[\]?()&%$"!:,\f]/.test(l.text.trimStart()));
      return withLine({ title: S.leadingTitle, why: S.leadingWhy }, d.line ?? odd?.number);
    }
    case 'unknown-control-source': {
      // P10, P10c
      const part = partNamed(netlist, d.subject);
      const user = netlist.lines.find((l) => l.element?.controlSource && lowerAscii(l.element.controlSource.text) === lowerAscii(d.subject ?? ''));
      const userName = user?.element?.name.text ?? 'F';
      const name = part?.element?.name.text ?? d.subject ?? '?';
      const what = part?.element?.letter ? article(elementInfo(part.element.letter)?.name ?? 'part') : undefined;
      return withLine({ title: S.controlSourceTitle(userName, name), why: what ? S.controlSourceWrongWhy(name, what) : S.controlSourceMissingWhy(name) }, user?.number);
    }
    case 'unknown-dot-command': {
      const at = netlist.lines.find((l) => l.directive && lowerAscii(l.directive.token.text) === lowerAscii(d.subject ?? ''));
      return withLine({ title: S.unknownDotTitle(d.subject ?? '?'), why: S.unknownDotWhy(d.subject ?? '?') }, at?.number); // A29
    }
    case 'meas-skipped':
      return withLine({ title: S.measTitle, why: S.measWhy }, dotLine(netlist, '.meas') ?? dotLine(netlist, '.measure')); // A28
    case 'engine-crash':
      return { title: S.crashTitle, why: S.crashWhy };
    case 'rawfile': {
      // A11: a .dc with no points leaves a results file without data.
      for (const i of netlist.analyses) {
        const r = readAnalysis(netlist, i);
        if (r?.kind === 'dc' && r.points === 0) return { title: S.rawfileEmptyDcTitle, why: S.rawfileEmptyDcWhy(i + 1), line: i + 1 };
      }
      return { title: S.rawfileTitle, why: S.rawfileWhy };
    }
    case 'error': {
      const file = /Could not find (?:include|library) file\s+(\S+)/i.exec(d.text);
      if (file) return withLine({ title: S.includeTitle(file[1]!), why: S.includeWhy }, d.line ?? dotLine(netlist, '.include') ?? dotLine(netlist, '.lib')); // A26, A33
      return withLine({ title: S.errorTitle, why: S.saysWhy(d.text) });
    }
    default: {
      const vector = /vector (\S+) is not available or has zero length/i.exec(d.text);
      if (vector) return withLine({ title: S.controlVectorTitle, why: S.controlVectorWhy(vector[1]!) }); // A27
      const model = /can't find model '([^']+)'/i.exec(d.text);
      const part = model ? partWithWord(netlist, model[1]!) : undefined;
      if (part) {
        // decimal-comma-2, space-before-suffix-7, greek-mu-2: a value word ngspice also tried as a model name.
        return withLine({ title: S.modelWordTitle(part.word), why: S.modelWordWhy(part.word, model![1]!) }, d.line ?? part.line);
      }
      return withLine({ title: d.severity === 'error' ? S.errorTitle : S.warningTitle, why: S.saysWhy(d.text) });
    }
  }
}

/** The first part line with a word (after its name and nodes) that is `word` in lower case, as written. */
function partWithWord(netlist: Netlist, word: string): { word: string; line: number } | undefined {
  const key = lowerAscii(word);
  for (const line of partsOf(netlist).lines) {
    const el = line.element!;
    const skip = el.nodes.length + 1;
    const words = line.text.replace(/;.*$/, '').trim().split(/\s+/).slice(skip);
    const found = words.find((w) => lowerAscii(w) === key);
    if (found) return { word: found, line: line.number };
  }
  return undefined;
}

function dotModel(netlist: Netlist, model: string): number | undefined {
  const key = lowerAscii(model);
  for (const i of netlist.directives) {
    const d = netlist.lines[i]?.directive;
    if (d?.name === '.model' && d.args[0] && lowerAscii(d.args[0].text) === key) return i;
  }
  return undefined;
}
