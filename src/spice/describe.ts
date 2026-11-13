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
import { withoutInvisible } from './characters.ts';
import { elementInfo } from './elements.ts';
import { articleBefore, dcStopsNgspice, ignoredAnalysis, isExpression, isKnownDotCommand, leftOutModel, nodeNameInWords, readAfterEnd, readAnalysis, sweptBy, unusedSubcircuit, type AnalysisReading, type SweepReading } from './explain.ts';
import { behaviouralKind, isBuilt } from './graph.ts';
import { atSentenceStart, nameSaysNode } from './node-words.ts';
import { add, agrees, ANSWER_FLOOR, ANSWER_GAP, answers, carried, carrierSides, checkWork, currentDouble, currentIsZero, div, equal, exactModel, fraction, fromDouble, isZero, MAX_WORK, neg, newBudget, ONE, operatingPoint, overCommon, partCurrent, RESIDUAL_SHARE, solveExact, sub, toDouble, treeCurrents, unitSource, withCurrents, ZERO, type Answer, type Budget, type Carried, type ExactModel, type ExactPart, type Fraction, type NgspiceValues } from './exact.ts';
import { readNumber } from './numbers.ts';
import { lowerAscii, ngspiceSpelling, parseNetlist } from './parse.ts';
import type { Element, ElementLetter, Netlist, NetlistLine, NodeRef } from './types.ts';

const MINUS = '−';
const ARROW = '→';

// ------------------------------------------------------------------ result types

export interface NodeVoltageWords {
  /**
   * The node's key, for every lookup: the netlist's name with its ASCII letters in lower case
   * ("giriş", "gİrİŞ" for GİRİŞ), µ as u ("au" for aµ), which is ngspice's own spelling for every name
   * in plain ASCII; ngspice writes each byte of a letter outside ASCII as '_' (W16).
   */
  node: string;
  /**
   * The node's name in words (S7): as first written when it has a character outside ASCII ("GİRİŞ",
   * "aµ"), else the key, ngspice's own spelling ("in" for IN, W6). Never lower-cased by hand.
   */
  name: string;
  /** ngspice's own spelling, when it is not `node` ("giri__" for "giriş", W16). */
  ngspice?: string;
  /** ngspice's value; 0 when it is rounding noise (C9d), which `noise` keeps. */
  value: number;
  /**
   * ngspice's own value when it is rounding noise and PlainSpice says 0 V instead (C9d): the node is
   * joined to ground through parts that carry no current, and the value is below ngspice's voltage
   * tolerance (vntol, 1 µV, C9c). Shown with ngspice's spelling, never as a voltage.
   */
  noise?: number;
  /**
   * ngspice's own value, exactly 0, where the circuit makes the voltage real and PlainSpice shows the
   * exact one instead (decision 0015): too small beside the numbers ngspice works it out from, its
   * arithmetic rounds it to 0. Shown in the ngspice column of the Numbers panel.
   */
  given?: number;
  /** "12 V" */
  text: string;
  /** "12 volts" */
  speech: string;
  /**
   * Nodes with the same level are at the same voltage, and ground's level is 0: exactly, for a circuit
   * PlainSpice solves exactly, or joined by parts with no voltage across them by the rule for other
   * circuits (roundingNoise). The voltage across a part whose two ends share a level is 0 (the card's
   * "across it"), whatever ngspice's last bits say (C9: 4.499999999999999 against 4.5).
   */
  level?: number;
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
   * ngspice's own value when it is rounding noise and PlainSpice says 0 A instead (C9–C9d): below
   * ngspice's current tolerance (abstol, 1 pA), on a part whose own numbers say its current is 0
   * (both ends at the same voltage, the only current left at one of its nodes, or a copy of a current
   * that is 0: see roundingNoise). Shown with ngspice's spelling, never as a current.
   */
  noise?: number;
  /**
   * ngspice's own value, exactly 0, where the circuit makes the current real and PlainSpice shows the
   * exact one instead (decision 0015): a 1 nΩ wire in series with 10 MΩ carries 454.1 pA, but the
   * 4.5e-19 V across it is too small for ngspice's arithmetic beside the 4.541 mV at its ends, so both
   * ends come out as the same number. Shown in the ngspice column of the Numbers panel.
   */
  given?: number;
  /**
   * With `given`, for a resistor: the exact voltage across it (its first node's minus its second's),
   * which ngspice's two equal end voltages do not show (4.541e-19 V across that wire). The card says
   * it, so the part's card keeps Ohm's law.
   */
  across?: number;
  /** Node the current comes from, through the part (ngspice's name; ground is "0"). */
  from: string;
  /** Node it flows to. */
  to: string;
  /**
   * `from` and `to` as the words name them (S7): as first written for a name outside ASCII ("GİRİŞ",
   * never the key's "gİrİŞ"), else the key; ground is "0". For a page that names them apart from `text`.
   */
  fromName: string;
  toName: string;
  /** A 0 V source: it measures the current (the ammeter trick) and makes no power claim. */
  ammeter: boolean;
  /** "3 A from n1 to 0 through R1", "Vx measures 1 A flowing from a to x" */
  text: string;
  speech: string;
  power?: PowerWords;
}

export interface QuantityWords {
  /** PlainSpice's value: 0 where ngspice gave rounding noise of a 0 (S8), which `noise` keeps. */
  value: number;
  text: string;
  speech: string;
  /** ngspice's own value when it is rounding noise of a ratio the circuit makes exactly 0 (decision 0015, C9p). */
  noise?: number;
}

export interface TransferFunctionWords {
  /**
   * The .tf output and input as written ("v(a)", "V1"), every label's formula: never with an invisible
   * character in it, which reads as another name (S11: "v(ou<ZWSP>t)" is "v(out)"; the words name it).
   */
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
  /** The last point as the live region says it after a run: its first four values, then how many more ("When V1 is 12 volts: the voltage at node out is 8 volts, …"); '' without one. */
  end?: string;
  /** "DC sweep of V1 from 0 V to 12 V: 13 points. At V1 = 12 V: v(out) = 8 V, …" */
  text: string;
  speech: string;
  /** The value of each result at the last point. */
  /** Each result at the last point: `noise` keeps ngspice's rounding noise of a 0, `given` ngspice's 0 of a real value shown exactly. */
  final: { name: string; value: number; text: string; speech: string; noise?: number; given?: number }[];
}

export interface MessageWords {
  /**
   * The diagnostic code (src/engine/diagnostics.ts), one PlainSpice adds for messages that file does
   * not classify (unknown-control-source, unknown-dot-command, meas-skipped), or one of: unreliable,
   * no-analysis, no-results, tf-node-missing, rounding-noise (a note: currents said as 0 A, C9), rounded-to-0
   * and imprecise-answers (decision 0015), sweep-not-checked (a sweep too large to look through, SWEEP_VALUES).
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
 * because a name may be an ordinary word; a name that already says node goes alone ("node1", never
 * "node node1": node-words.ts); ground stays "ground" (written "0" in results). Inside the templates
 * below, so every page that builds a sentence from them (the overview, the drawing's descriptions,
 * the cards) says it the same way. Callers pass a name through `said` first, so a node named like
 * ground arrives quoted.
 */
function nodeIn(n: string): string {
  return n === 'ground' || n === '0' ? 'ground' : n === '?' || n === '' || nameSaysNode(n) ? n : `node ${n}`;
}

/** Names that look like ground but are ordinary nodes where they are not ground (W9, W13, W14). */
const GROUND_LIKE = /^(gnd|ground|00)$/i;

/**
 * A node's name for the sentences: ground ("0") is "ground"; an ordinary node named like ground is
 * quoted, as Explain quotes it, so 'node "ground"' never reads as ground (words review W8, critic of
 * its fix); a character in the name that is not what it looks like is named, never shown hidden in it
 * ("out (written with a zero-width space in it)", S11), as Explain names it. The templates above read
 * "ground" as ground, as the drawing's and the cards' words pass it.
 */
const said = (n: string): string => (n === '0' ? 'ground' : GROUND_LIKE.test(n) ? `"${n}"` : nodeNameInWords(n));
/** said, for the other modules that build sentences from these templates (the drawing's, the cards'). */
export const sentenceNode = said;

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
  // P9: true of every 0 V source, the turned-off source of a Thévenin example too (student review): what
  // it is and what ngspice does with it, not a purpose the circuit may not have.
  ammeter: (name: string, a: string, b: string): string =>
    `${name}: a 0 V source from ${nodeIn(a)} to ${nodeIn(b)}: a wire, through which ngspice measures the current (the ammeter trick).`,
  // P16, A20, P21: an AC value is its size in an .ac analysis; with no DC value the source is 0 V in .op.
  acSource: (name: string, size: string, a: string, b: string): string =>
    `${name}: an AC source${size ? ` of ${size}` : ''} in an .ac analysis, 0 V in DC, with its + side at ${nodeIn(a)} and its ${MINUS} side at ${nodeIn(b)}.`,
  swept: (name: string, a: string, b: string): string => `${name}: a voltage source with its + side at ${nodeIn(a)} and its ${MINUS} side at ${nodeIn(b)}, swept by .dc.`,
  iSource: (name: string, v: string, a: string, b: string): string =>
    `${name}: ${v ? `${articleBefore(v)} ${v} current source` : 'a current source'} pushing current from ${nodeIn(a)} into ${nodeIn(b)}.`,
  /** A negative value (P4): its size, pushed the way the current really flows, from the second node into the first (critic of words re-check 12). */
  iSourceBack: (name: string, v: string, size: string, a: string, b: string): string =>
    `${name}: ${articleBefore(v)} ${v} current source: its value is negative, so it pushes ${size} from ${nodeIn(b)} into ${nodeIn(a)}.`,
  /** The same with a transient function too: so it pushes in .op, where .tran follows the function (P4c; critic of its fix). */
  iSourceBackOp: (name: string, v: string, size: string, a: string, b: string): string =>
    `${name}: ${articleBefore(v)} ${v} current source: its value is negative, so in .op it pushes ${size} from ${nodeIn(b)} into ${nodeIn(a)}.`,
  /** A current source a .dc line sweeps: no one value there, as for V (P4b). */
  iSwept: (name: string, a: string, b: string): string => `${name}: a current source pushing current from ${nodeIn(a)} into ${nodeIn(b)}, swept by .dc.`,
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
  /** A .tf output that is no node's name (ngspice's own words for it, when they do not read as v(...)). */
  atVector: (v: string): string => `at ${v}`,
  between: (a: string, b: string): string => `between ${nodeIn(a)} and ${nodeIn(b)}`,
  coupling: (name: string, l1: string, l2: string, k: string): string => `${name}: couples ${l1} and ${l2} (coupling ${k}).`,
  otherPart: (name: string, what: string, nodes: string): string => `${name}: ${what}${nodes ? ` (${nodes})` : ''}.`,
  // "+ node a" already says "node"; a terminal reads "collector at node c", "emitter at ground". At
  // ground a "node" label loses the word: "− side at ground", as the V sentence says, "from ground",
  // or "ground" alone (critic of the W8 fix: no "− node at ground"); so it does before a name that
  // says node itself: "+ node1", "node1 and ground" (re-check of W8: no "+ node node1").
  labelled: (label: string, n: string): string => {
    if (nodeIn(n) !== 'ground') {
      if (!label.endsWith('node')) return `${label} at ${nodeIn(n)}`;
      return nameSaysNode(n) ? `${label.replace(/\s*node$/, '')} ${n}`.trim() : `${label} ${n}`;
    }
    const rest = label.replace(/\s*node$/, '');
    if (rest === label) return `${label} at ground`;
    if (!rest) return 'ground';
    if (/[+−]$/.test(rest)) return `${rest} side at ground`;
    return rest === 'from' || rest === 'to' ? `${rest} ground` : `${label} at ground`;
  },
  modelOf: (m: string): string => `model ${m}`,
  subcircuitOf: (m: string): string => `subcircuit ${m}`,
  analysis: (list: string): string => `Analysis: ${list}.`,
  analyses: (list: string): string => `Analyses: ${list}.`,
  noAnalysis: 'No analysis line (.op, .dc, .tran, .tf or .ac), so ngspice will run nothing.',
  noAnalysisControl: 'No analysis line (.op, .dc, .tran, .tf or .ac): ngspice runs the commands in the .control block instead.',
  analysisAfterEnd: 'The analysis is written after .end, where ngspice still reads it.',
  /** A3f: the only analysis lines are in a subcircuit no X line uses. */
  analysisIgnored: 'Its analysis lines are inside a subcircuit that no X line uses, where ngspice ignores them, so ngspice will run nothing.',
  opName: 'operating point',
  tfName: (out: string, input: string): string => `transfer function from ${input} to ${out}`,
  dcName: (sweeps: string, points: string): string => `DC sweep of ${sweeps}${points}`,
  // re-check critic CR1-11: a .dc line ngspice 47 cannot read is never told as a sweep that runs.
  dcStopsName: 'a DC sweep at which ngspice 47 stops ("Bad syntax!"): see Checks',
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
  outputR: (at: string, r: string): string => `output resistance ${at}: ${r}, the Thévenin resistance seen ${at} (ngspice calls it the output impedance)`,
  outputRSpeech: (at: string, r: string): string => `the output resistance ${at} is ${r}, the Thévenin resistance`,
  outputRCurrent: (out: string, r: string): string =>
    `ngspice's output impedance for ${out}: ${r}, a stand-in number rather than a resistance of your circuit`,
  outputRCurrentSpeech: (out: string, r: string): string => `ngspice reports ${r} as the output impedance for ${out}; it is not a resistance of your circuit`,
  ratioWords: { 'V/V': 'volts per volt', 'V/A': 'volts per amp, which is ohms', 'A/V': 'amps per volt', 'A/A': 'amps per amp' } as Record<string, string>,
  ratioWordsOne: { 'V/V': 'volt per volt', 'V/A': 'volt per amp, which is an ohm', 'A/V': 'amp per volt', 'A/A': 'amp per amp' } as Record<string, string>,
  voltageOf: (n: string): string => `the voltage at ${nodeIn(n)}`,
  voltageBetween: (a: string, b: string): string => `the voltage between ${nodeIn(a)} and ${nodeIn(b)}`,
  currentIn: (name: string): string => `the current in ${name}`,
  /** A transistor's current at one of its terminals (C8b): "the collector current of Q1". */
  terminalCurrent: (name: string, terminal: string): string => `the ${terminal} current of ${name}`,
  /**
   * The terminal of each current savecurrents gives a BJT, a MOSFET and a JFET, by the letter in brackets, as
   * ngspice's own devhelp describes it (C8b): @q1[is] is the substrate's, @m1[is] the source's.
   */
  terminals: {
    Q: { ic: 'collector', ib: 'base', ie: 'emitter', is: 'substrate' },
    M: { id: 'drain', ig: 'gate', is: 'source', ib: 'bulk' },
    J: { id: 'drain', ig: 'gate', is: 'source', igd: 'gate-to-drain' },
  } as Readonly<Record<string, Readonly<Record<string, string>>>>,
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
  /** A sweep's last point as the live region says it: its first four values, then how many more, as summaryNodes. */
  summaryValues: (values: readonly string[]): string => (values.length > 4 ? `${values.slice(0, 4).join(', ')} and ${values.length - 4} more ${values.length === 5 ? 'value' : 'values'}` : values.join(', ')),
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
  capNodeTitle: (n: string): string => `${atSentenceStart(nodeIn(said(n)))} has no DC path to ground`,
  capNodeWhy: (n: string, what: string): string =>
    `In .op a capacitor is an open circuit, so ${nodeIn(said(n))}, which connects only to ${what}, is cut off: its voltage has no single answer (a singular matrix). ngspice's fallback numbers can be wrong, even for other nodes.`,
  onlyCapacitors: 'capacitors',
  onlyCurrentSources: 'current sources',
  capacitorsAndCurrentSources: 'capacitors and current sources',
  floatingTitle: (n: string): string => `${atSentenceStart(nodeIn(said(n)))} is not connected to the rest of the circuit`,
  floatingWhy: (n: string): string =>
    `${atSentenceStart(nodeIn(said(n)))} has no path to ground (node 0), so its voltage has no single answer (a singular matrix). Connect it to the rest of the circuit, or remove the part.`,
  shortLineTitle: (name: string): string => `${name} is missing fields`,
  shortLineWhy: (name: string): string =>
    `An E or G line needs four nodes and a number, and ${name} has fewer, so PlainSpice's engine finds no single answer (a singular matrix) and gives no results. (Native ngspice says "not enough parameters".)`,
  singularTitle: (n: string): string => `No single answer at ${nodeIn(said(n))}`,
  singularWhy: (n: string): string =>
    `ngspice's equations have no single answer (a singular matrix), so the numbers it prints can't be trusted. ngspice points at ${nodeIn(said(n))}: check that it has a DC path to ground (node 0).`,
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
  // M4b, M4c: two names that differ by more than capital letters, said as the duplicate-name check says them.
  duplicateSpelledTitle: (first: string, here: string): string => `${first} and ${here} are the same name for ngspice`,
  duplicateSpelledWhy: (rule: string, here: string, first: string, line: number, spelled: string): string =>
    `Each part needs its own name. ngspice ${rule}, so ${here} here is the same name as ${first} on line ${line}: both are ${spelled}. ngspice stops at the second one ("device already exists"). Rename one of them with the letters a to z.`,
  microRule: 'reads the micro sign \u00b5 as u',
  underscoresRule: 'writes each letter other than a to z (or A to Z) in a name as underscores',
  bothRules: 'reads the micro sign \u00b5 as u and writes the other letters outside a to z (or A to Z) in a name as underscores',
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
  tstopZeroTitle: 'The .tran stop time must be more than 0',
  tstopZeroWhy: 'ngspice stops when the stop time it reads is 0 or less ("TSTOP is invalid"). The stop time is the length of the run, like 5m.',
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
  // C9–C9e: currents and node voltages ngspice gives as rounding noise of a 0 are said as 0, with what
  // ngspice gave and why the true value is 0 (roundingNoise).
  /** `nodes` as `said` gives them; a node in a sentence is "node out", a name that says node goes alone (node-words.ts). */
  noiseTitle: (currents: readonly string[], nodes: readonly string[]): string => {
    if (!currents.length) return nodes.length === 1 ? `${atSentenceStart(nodeIn(nodes[0]!))} is shown as 0 V` : `${nodes.length} node voltages are shown as 0 V`;
    const shown = currents.length === 1 ? `${currents[0]}'s current is shown as 0 A` : `${currents.length} currents are shown as 0 A`;
    return !nodes.length ? shown : `${shown}, and ${nodes.length === 1 ? nodeIn(nodes[0]!) : `${nodes.length} node voltages`} as 0 V`;
  },
  noiseGaveCurrent: (name: string, value: string): string => `${name} ${value} A`,
  noiseGaveVoltage: (node: string, value: string): string => `${nodeIn(node)} ${value} V`,
  noiseSame: (name: string, a: string, b: string, v: string): string => `the two ends of ${name}, ${nodeIn(a)} and ${nodeIn(b)}, are at the same voltage, ${v}`,
  noiseCopies: (name: string, gain: string, control: string): string => `${name} pushes ${gain} × the current in ${control}, which is 0`,
  noiseReads: (name: string, c: string, d: string): string => `${name} reads the voltage between ${nodeIn(c)} and ${nodeIn(d)}, which is 0`,
  noiseNode: (n: string): string => `every other current at ${nodeIn(n)} is 0, and the currents at a node add up to 0`,
  /** For several parts: what each of them does, by the kinds of reason found ("has its two ends at the same voltage, or ..."); `others` when some have no plainer reason than the whole circuit. */
  noiseEach: (kinds: readonly ('same' | 'copies' | 'reads' | 'node')[], others = false): string => {
    const words = { same: 'has its two ends at the same voltage', copies: 'copies a current that is 0', reads: 'reads a voltage that is 0', node: 'carries the only current left at one of its nodes (the currents at a node add up to 0)' };
    const list = [...kinds.map((k) => words[k]), ...(others ? ['is 0 for the circuit as a whole'] : [])];
    return `each of these parts ${list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`}`;
  },
  /** `list` already says "node out" for each node (cappedList); `count` is how many nodes it names. */
  noiseGround: (list: string, count: number): string => `${list} ${count === 1 ? 'is' : 'are'} joined to ground through parts with no voltage across them`,
  /** The end of a list cut short (N4): "R5, Vm0, Vm1, Vm2 and 3991 more currents, each in the tables above". */
  noiseMore: (shown: string, currents: number, voltages: number, nodes: number): string => {
    const more: string[] = [];
    if (currents) more.push(`${currents} ${currents === 1 ? 'current' : 'currents'}`);
    if (voltages) more.push(`${voltages} node ${voltages === 1 ? 'voltage' : 'voltages'}`);
    if (nodes) more.push(`${nodes} ${nodes === 1 ? 'node' : 'nodes'}`);
    return `${shown} and ${listWords(more).replace(/^(\d+)/, '$1 more')}${currents || voltages ? ', each in the tables above' : ''}`;
  },
  /**
   * `exact`: PlainSpice solved the circuit exactly and the 0 is its own; otherwise the rule for other
   * circuits found it, only below ngspice's tolerances.
   */
  noiseWhy: (gave: string, reason: string, currents: number, voltages: number, exact = false, diodes?: DiodeWhy): string => {
    const one = currents + voltages === 1;
    const what = !voltages ? (one ? 'a current' : 'currents') : !currents ? (one ? 'a voltage' : 'voltages') : 'currents and voltages';
    const shows = !voltages ? '0 A' : !currents ? '0 V' : '0 A and 0 V';
    const head = `ngspice gave ${gave}. ${one ? 'That is' : 'Those are'} rounding noise, what its arithmetic leaves of ${what} that ${one ? 'is' : 'are'} 0${reason ? `: ${reason}` : ''}.`;
    if (exact) return `${head} Solved exactly, with fractions, from the netlist's values, the circuit makes ${one ? 'it' : 'each of them'} exactly 0${diodeClause(diodes)}, so PlainSpice shows ${shows}.`;
    const below = !voltages
      ? "below 1 pA, ngspice's current tolerance (its abstol option)"
      : !currents
        ? "below 1 µV, ngspice's voltage tolerance (its vntol option)"
        : "below 1 pA and 1 µV, ngspice's tolerances for currents and voltages (its abstol and vntol options)";
    return `${head} ${one ? 'It is' : 'They are'} ${below}, so PlainSpice shows ${shows}.`;
  },
  // C9n: a real current or voltage ngspice's arithmetic rounded to exactly 0, shown as the exact solution gives it.
  lostTitle: (currents: readonly string[], nodes: readonly string[]): string => {
    const what = [
      currents.length === 1 ? `${currents[0]}'s current` : currents.length ? `${currents.length} currents` : '',
      nodes.length === 1 ? `the voltage at ${nodeIn(nodes[0]!)}` : nodes.length ? `${nodes.length} node voltages` : '',
    ].filter(Boolean).join(' and ');
    return `${what[0]!.toUpperCase()}${what.slice(1)} ${currents.length + nodes.length === 1 ? 'is' : 'are'} not 0, though ngspice gave 0`;
  },
  lostGaveCurrent: (name: string): string => `${name} exactly 0 A`,
  lostGaveVoltage: (node: string): string => `${nodeIn(node)} exactly 0 V`,
  lostShows: (name: string, value: string): string => `${name} ${value}`,
  /** A resistor whose two ends ngspice gave as the same number: `across` is the exact voltage across it, `at` its ends' voltage. */
  lostEnds: (name: string, across: string, at: string, a: string, b: string): string =>
    `But a current flows through ${name}: the ${across} across it is too small beside the ${at} at its ends, ${nodeIn(a)} and ${nodeIn(b)}, for ngspice's arithmetic (about 16 significant digits), so both ends come out as the same number.`,
  lostAny: (one: boolean): string =>
    `${one ? 'It is' : 'Each is'} too small beside the larger numbers ngspice works ${one ? 'it' : 'them'} out from for its arithmetic (about 16 significant digits), so ${one ? 'it comes' : 'they come'} out as 0.`,
  lostCarries: (name: string, value: string): string => `${name} carries ${value}`,
  lostIsAt: (node: string, value: string): string => `${nodeIn(node)} is at ${value}`,
  /** `shows`: for one value, what it is ("R3 carries 454.1 pA") and its value; for several, the list of their exact values. */
  lostWhy: (gave: string, reason: string, shows: string, value: string | undefined): string =>
    `ngspice gave ${gave}. ${reason} Solved exactly, with fractions, from the netlist's values, ${value !== undefined ? `${shows}, so PlainSpice shows ${value}` : `none of them is 0, so PlainSpice shows each as the exact solution gives it: ${shows}`}.`,
  // Where ngspice's answers are farther from the exact ones than the page's digits (opCheck 'imprecise'):
  // PlainSpice shows ngspice's numbers and says that they are off, and by how much.
  offTitle: 'Some of ngspice\'s answers here are off',
  offVoltage: (node: string, exact: string, given: string): string => `${nodeIn(node)} is at ${exact}, where ngspice gives ${given}`,
  /** A current's size; `reversed` when ngspice gives it flowing the other way. */
  offCurrent: (name: string, exact: string, given: string, reversed: boolean): string => `${name} carries ${exact}, where ngspice gives ${given}${reversed ? ' the other way' : ''}`,
  offNoCurrent: (name: string, given: string): string => `${name} carries no current, where ngspice gives ${given}`,
  /** The items, each with a comma of its own, joined by semicolons; a list cut short counts the rest (never "and 1 more"). */
  offList: (items: readonly string[], more: number): string =>
    more ? `${items.join('; ')}; and ${more} more` : items.length === 1 ? items[0]! : `${items.slice(0, -1).join('; ')}; and ${items[items.length - 1]}`,
  offWhy: (list: string): string =>
    `Solved exactly, with fractions, from the netlist's values, ${list}. ngspice computes with about 16 significant digits, and solving this circuit loses most of them. PlainSpice shows ngspice's numbers as it gives them, so they may not agree with each other.`,
  // S8, C9p: a .tf ratio and .dc points ngspice gives as rounding noise of a 0.
  noiseTfTitle: 'The transfer function is shown as 0',
  noiseTfWhy: (tf: string, value: string, output: string, input: string, ratio: string): string =>
    `ngspice gave ${tf} = ${value}. That is rounding noise, what its arithmetic leaves of a ratio that is 0: ${output} does not change when ${input} changes. Solved exactly, with fractions, from the netlist's values, the circuit makes the ratio exactly 0, so PlainSpice shows 0 ${ratio}.`,
  noiseSweepTitle: (names: readonly string[], kind: string): string =>
    names.length === 1 ? `${names[0]} is shown as 0 at some points of the ${kind}` : `${names.length} results are shown as 0 at some points of the ${kind}`,
  noiseSweepGave: (name: string, value: string, unit: string, at: string): string => `${name} ${value}${unit ? ` ${unit}` : ''} at ${at}`,
  /** The end of a sweep's list cut short (N4). */
  noiseSweepMore: (shown: string, more: number): string => `${shown} and ${more} more, each in the Plot panel's table`,
  // C9n at a sweep's points: a real value ngspice gave as exactly 0 there, shown exactly.
  lostSweepTitle: (names: readonly string[], kind: string): string =>
    names.length === 1 ? `${names[0]} is not 0 at some points of the ${kind}, though ngspice gave 0` : `${names.length} results are not 0 at some points of the ${kind}, though ngspice gave 0`,
  lostSweepGave: (name: string, at: string): string => `${name} exactly 0 at ${at}`,
  lostSweepShows: (name: string, value: string, at: string): string => `${name} ${value} at ${at}`,
  lostSweepWhy: (gave: string, shows: string, one: boolean): string =>
    `ngspice gave ${gave}. ${one ? 'It is' : 'Each is'} too small beside the larger numbers ngspice works ${one ? 'it' : 'them'} out from for its arithmetic (about 16 significant digits), so ${one ? 'it comes' : 'they come'} out as 0. Solved exactly, with fractions, from the netlist's values, ${one ? 'it is not 0, so PlainSpice shows it' : 'none of them is 0, so PlainSpice shows each'} as the exact solution gives it, in these words and in the Plot panel: ${shows}.`,
  // A sweep too large to look through for rounding noise (SWEEP_VALUES): left as ngspice gives it, but at the .op's own state.
  sweepLargeTitle: (kind: string): string => `The ${kind} is shown as ngspice gives it`,
  sweepLargeWhy: (points: number, results: number, most: number, at: string | undefined): string =>
    `It has ${points} points of ${results} ${results === 1 ? 'result' : 'results'}, more values than PlainSpice looks through for rounding noise (${most} in all). So at its points a value the circuit makes exactly 0 may show ngspice's rounding noise, and a tiny value ngspice's arithmetic rounded to 0 shows 0${at ? `, except at ${at}, the operating point's own state, where the sweep shows what the operating point shows` : ''}.`,
  noiseSweepWhy: (gave: string, one: boolean, diodes?: DiodeWhy): string =>
    `ngspice gave ${gave}. ${one ? 'That is' : 'Those are'} rounding noise, what its arithmetic leaves of ${one ? 'a value' : 'values'} that ${one ? 'is' : 'are'} 0 there. Solved exactly, with fractions, from the netlist's values, the circuit makes ${one ? 'it' : 'each of them'} exactly 0 there${diodeClause(diodes, true)}, so PlainSpice shows 0 in these words and in the Plot panel.`,
} as const;

/**
 * Why an exact 0 of a circuit with diodes holds (exactNoise, findSweepNoise): the diodes it needs to carry 0 A
 * (0 V across each makes 0 A, C9t.2) and the classes of diodes placed alike it needs to carry equal currents,
 * as the netlist names them; none of either when it is 0 whatever current the diodes carry.
 */
export interface DiodeWhy {
  quiet: string[];
  alike: string[][];
}

/**
 * The words after "the circuit makes it exactly 0" in a circuit with diodes: true of every value the note
 * names. "whatever current its diodes carry" only where that is so (the critic of round 3: "from the netlist's
 * values and its diodes' currents" said the opposite of how the 0 was found, which needs no diode's current);
 * where the 0 needs a diode to carry 0 A or two diodes placed alike to carry the same current, it says so.
 */
function diodeClause(diodes: DiodeWhy | undefined, there = false): string {
  if (!diodes) return '';
  const said: string[] = [];
  const q = diodes.quiet;
  if (q.length) said.push(`${listWords(q)} ${q.length === 1 ? 'has' : 'have'} 0 V across ${q.length === 1 ? 'it' : 'them'}${there ? ' there' : ''}, so ${q.length === 1 ? 'it carries' : 'they carry'} no current`);
  for (const c of diodes.alike) said.push(`${listWords(c)}, placed alike in the circuit, carry the same current`);
  return said.length ? ` (${said.join('; ')})` : ', whatever current its diodes carry';
}

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
/**
 * A node in the circuit overview, as written; ground is "ground", and an ordinary node named like
 * ground is quoted (said). The drawing's part descriptions are these same sentences
 * (src/schematic/navigate.ts calls partSentenceFor).
 */
const nodeWritten = (ref: NodeRef | undefined): string => (!ref ? '?' : ref.ground ? S.ground : said(ref.token.text));
/** A node in a short note at the end of a line: its bare name, "0" for ground, quoted when it is named like ground. */
const bare = (n: string): string => (n !== '0' && GROUND_LIKE.test(n) ? `"${n}"` : n);

/**
 * The verb for a current said in words (speakSI): "1 amp flows", "1 milliamp flows", but "1.5 amps flow" and
 * "1 times 10 to the power minus 29 amps flow", whose unit word is plural though it starts with 1 (the last
 * pass: a 1 nV source's exact 1e-29 A "flows").
 */
function flows(speech: string): string {
  const words = speech.split(' ');
  return words.length === 2 && words[0] === '1' ? 'flows' : 'flow';
}

/** Ohms in plain units; ngspice's 1e20 stand-in is written with its exponent ("1e+20 Ω", formatSI). */
function ohms(v: number): { text: string; speech: string } {
  return { text: formatSI(v, 'Ω'), speech: speakSI(v, 'Ω') };
}

function dcValue(el: Element): number | undefined {
  return el.value?.number?.value;
}

/**
 * A source's AC value, its size in an .ac analysis (A20, P21): the number after the word AC; NaN when
 * AC has no number after it; undefined when the line has no AC value.
 */
export function acValue(el: Element): number | undefined {
  const k = el.fields.findIndex((f) => f.role === 'source-function' && lowerAscii(f.token.text) === 'ac');
  if (k < 0) return undefined;
  const next = el.fields[k + 1];
  return (next?.role === 'source-function' ? readNumber(next.token.text)?.value : undefined) ?? Number.NaN;
}

/**
 * A voltage source whose DC value is 0 (written or missing), with no transient function and no AC
 * value: an ammeter (P9, P16). A source with an AC value is the input of an .ac analysis, though it is
 * 0 V in .op (critic of the fixes: "V1 in 0 AC 1" is no wire). Nor is a source whose value word ngspice
 * cannot read (−5 with a minus sign from a document, -<zero-width space>5): ngspice stops there and
 * measures nothing (look-alike-letter-2, invisible-character-6, space-character-12; re-check C3).
 */
function isAmmeter(el: Element): boolean {
  if (el.letter !== 'V' || el.sourceFunction || acValue(el) !== undefined) return false;
  if (el.fields.some((f) => f.role === 'other')) return false;
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
      if (acValue(el) !== undefined && !v) {
        const ac = acValue(el)!;
        return S.acSource(name, Number.isNaN(ac) ? '' : formatSI(ac, 'V'), nodeWritten(a), nodeWritten(b));
      }
      return S.vSource(name, fmt('V'), nodeWritten(a), nodeWritten(b));
    case 'I':
      if (sweptSource(netlist, el.key)) return S.iSwept(name, nodeWritten(a), nodeWritten(b));
      if (el.sourceFunction && v === undefined) return S.iFunction(name, el.sourceFunction.token.text.toUpperCase(), nodeWritten(a), nodeWritten(b));
      if (v !== undefined && v < 0) return (el.sourceFunction ? S.iSourceBackOp : S.iSourceBack)(name, fmt('A'), formatSI(-v, 'A'), nodeWritten(a), nodeWritten(b));
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
      const named = el.nodes.map((ref, k) => [(labels[Math.min(k, labels.length - 1)] ?? 'node').replace(/ \(.*\)$/, ''), nodeWritten(ref)] as const);
      // Ends that are all plain nodes, as a subcircuit's, read as one list: "node a and ground".
      const plainEnds = named.every(([label]) => label === 'node');
      const nodes = plainEnds && named.length ? [listWords(named.map(([label, n]) => S.labelled(label, n)))] : named.map(([label, n]) => S.labelled(label, n));
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
    case 'tf': {
      // A node whose name has a character that is not what it looks like is said in words, the character
      // named (S11), never as "v(out)", which reads as another node.
      const [a, b] = r.outputNodes.map((n) => said(n.ground ? '0' : n.token.text));
      const odd = r.outputNodes.some((n) => nodeNameInWords(n.token.text) !== n.token.text);
      const out = !odd || a === undefined ? r.output : b === undefined ? S.voltageOf(a) : S.voltageBetween(a, b);
      return S.tfName(out, r.input?.text ?? '?');
    }
    case 'dc': {
      if (dcStopsNgspice(r)) return S.dcStopsName;
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

/**
 * The sentence describeCircuit says for one part, by its key ("r1"); '' when there is no such part.
 * For the pages that describe one part at a time (the drawing's part descriptions), so they say what
 * the overview says, an AC source and a node named like ground included.
 */
export function partSentenceFor(netlist: Netlist, key: string): string {
  const line = partsOf(netlist).byKey.get(lowerAscii(key));
  return line ? partSentence(netlist, line) : '';
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
  // The names as the results' words say them (S7), a name like ground quoted and a hidden character named (S11).
  const names = nodes.length > DESCRIBED_PARTS ? '' : nodes.map((n) => said(shownNode(netlist, n.name))).join(', ');
  const grounded = netlist.nodes.get('0')?.connections.length ?? 0;
  if (parts.lines.length === 0) out.push(S.noParts);
  else out.push(grounded > 0 ? S.counts(parts.lines.length, nodes.length, names) : S.countsNoGround(parts.lines.length, nodes.length, names));
  for (const line of parts.lines.slice(0, DESCRIBED_PARTS)) out.push(partSentence(netlist, line));
  if (parts.lines.length > DESCRIBED_PARTS) out.push(S.moreParts(parts.lines.length - DESCRIBED_PARTS));
  if (parts.subckts.length) out.push(S.subcircuits(parts.subckts.length, parts.subckts.join(', ')));
  // A3f: an analysis line in a subcircuit no X line uses is ignored, so it is not among the analyses.
  const run = netlist.analyses.filter((i) => !ignoredAnalysis(netlist, i));
  const analyses = run.map((i) => readAnalysis(netlist, i)).filter((r): r is AnalysisReading => r !== undefined);
  if (analyses.length === 0) {
    // M20; A36: a .control block runs; S25: so does an analysis written after a plain .end.
    const control = netlist.lines.some((l) => l.kind === 'control' && /^\s*\.control\b/i.test(l.text));
    if (readAfterEnd(netlist).some((l) => ANALYSIS_WORD.test(l.text))) out.push(S.analysisAfterEnd);
    else if (run.length < netlist.analyses.length && !control) out.push(S.analysisIgnored);
    else out.push(control ? S.noAnalysisControl : S.noAnalysis);
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

// ------------------------------------------------------------------ rounding noise (C9–C9u)

/** ngspice's current tolerance, abstol (C9c). The rule for other circuits calls only a current below it noise. */
export const ABSTOL = 1e-12;
/**
 * ngspice's voltage tolerance, vntol (C9c). The rule for other circuits calls only a node voltage below
 * it noise, and takes a voltage of at least this much across a resistor as real (C9f, C9i).
 */
export const VNTOL = 1e-6;
/**
 * The rule for circuits PlainSpice does not solve exactly takes two node voltages as the same, up to
 * ngspice's rounding, when they differ by at most this many units in the last place of the larger one
 * (ulp, the step between two neighbouring doubles). It is a rule of thumb, not a law: a balanced
 * bridge leaves 1 (C9) or 2 (C9b), but other balanced circuits leave 7, 9 or more (C9m), and a real
 * current can be smaller than the rounding (C9l). The circuits PlainSpice solves exactly never use it.
 * On 1,000 random circuits with diodes, 2 instead of 4 showed 4 fewer real currents as 0 and 16 more
 * values that are 0 with ngspice's noise: more wrong values in all (decision 0015).
 */
export const SAME_VOLTAGE_ULPS = 4;
/**
 * The rule for other circuits: the currents known to be real at a node add up to 0, up to ngspice's
 * rounding, when their sum is at most this fraction of the largest of them. C9's 0.45 mA in and out of
 * node a leave 1.7e-19 A, 4e-16 of them; a bridge whose middle resistor is a million times smaller
 * than its arms leaves up to 8e-11 (C9l).
 */
export const KCL_ROUNDING = 1e-9;
/**
 * Below the smallest normal double, 2^-1022 (about 2.2e-308), a double has fewer digits, down to one:
 * the rule for other circuits never calls a number there noise (the far end of a ladder of 1000
 * sections, C9k). An exact solution needs no such floor.
 */
const SMALLEST_NORMAL = 2 ** -1022;

/** Why a current ngspice gave is rounding noise of a current that is 0 (roundingNoise). */
export type NoiseWhy =
  /** A resistor or capacitor whose two ends are at the same voltage (`v`, when it is known exactly). */
  | { kind: 'same'; a: string; b: string; v?: number }
  /** An F that copies the current of a source whose current is 0 (`control` as the netlist writes it). */
  | { kind: 'copies'; control: string }
  /** A G that reads a voltage that is 0, between nodes `c` and `d`. */
  | { kind: 'reads'; c: string; d: string }
  /** Every other current at `node` is 0: Kirchhoff's current law makes this one 0 too. */
  | { kind: 'node'; node: string }
  /** 0 in the exact solution, for no plainer reason than the circuit as a whole. */
  | { kind: 'exact' };

export interface RoundingNoise {
  /** Parts, by key, whose current ngspice gave as rounding noise of 0, and why the current is 0. */
  currents: Map<string, NoiseWhy>;
  /** Nodes whose voltage ngspice gave as rounding noise of 0. */
  nodes: Set<string>;
  /** Of `nodes`, those joined to ground through parts with no voltage across them (the note says so). */
  grounded: Set<string>;
  /**
   * How it was decided: 'exact' from PlainSpice's exact solution of the circuit (exact.ts), which
   * ngspice's values were checked against; 'rule' by the rule for the circuits it does not solve
   * exactly (a transistor, a subcircuit, ...) and for those whose answers ngspice gave farther off than
   * the page's digits (`off`).
   */
  by: 'exact' | 'rule';
  /**
   * Each node's level: nodes with the same level are at the same voltage (exactly, or joined by parts
   * with no voltage across them by the rule for other circuits), ground's level is 0. Nodes with no
   * level are compared by the values ngspice gave.
   */
  levels: Map<string, number>;
  /**
   * Parts, by key, whose current ngspice gave as exactly 0 though the circuit makes it real (by the
   * exact solution only): the exact current, which PlainSpice shows instead (decision 0015; C9n), and
   * for a resistor the exact voltage across it, which ngspice's two equal end voltages do not show.
   */
  lostCurrents: Map<string, { value: number; across?: number }>;
  /** Nodes whose voltage ngspice gave as exactly 0 though the circuit makes it real: the exact voltage. */
  lostNodes: Map<string, number>;
  /**
   * Where ngspice's answers are farther from the exact ones than the page's digits (opCheck 'imprecise'),
   * those answers, worst first, with the netlist's names: the note says ngspice's numbers are off there.
   */
  off?: Answer[];
  /**
   * True when the circuit has diodes: the exact solution leaves their currents free, and a 0 is 0 whatever
   * current they carry, or because a diode with no voltage across it carries none, or because diodes placed
   * alike carry equal currents (opCheck, diodeStructure).
   */
  diodes?: boolean;
  /** With diodes, decided exactly: what the 0s the note names need of the diodes (DiodeWhy). */
  diodeWhy?: DiodeWhy;
}

/** No rounding noise and nothing lost: what a run without an operating point has. */
const noNoise = (by: RoundingNoise['by']): RoundingNoise => ({ currents: new Map(), nodes: new Set(), grounded: new Set(), by, levels: new Map(), lostCurrents: new Map(), lostNodes: new Map() });

const ulpView = new DataView(new ArrayBuffer(8));
/** The step from |x| to the next double: 2^-52 of |x|'s power of 2. */
function ulp(x: number): number {
  ulpView.setFloat64(0, Math.abs(x));
  const exponent = ulpView.getUint16(0) >>> 4;
  return exponent === 0 ? Number.MIN_VALUE : 2 ** (exponent - 1075);
}

/** The same voltage up to ngspice's rounding, by the rule for other circuits: at most SAME_VOLTAGE_ULPS apart. */
const sameVoltage = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= SAME_VOLTAGE_ULPS * ulp(Math.max(Math.abs(a), Math.abs(b)));

/** Parts whose current flows in at their first node and out at their second, nowhere else (E's and G's control nodes take none). */
const TWO_ENDED: ReadonlySet<ElementLetter> = new Set(['R', 'C', 'L', 'V', 'I', 'E', 'F', 'G', 'H', 'B']);

/** A voltage source that is 0 V in .op: a written or missing 0, no transient function (P9, P16). */
const zeroVolts = (el: Element): boolean => el.letter === 'V' && !el.sourceFunction && (!el.value || el.value.number?.value === 0);

/** One name per group of nodes joined together (union-find with shorter paths). */
class Groups {
  private readonly up = new Map<string, string>();
  find(n: string): string {
    let r = n;
    for (let u = this.up.get(r); u !== undefined; u = this.up.get(r)) r = u;
    for (let x = n, u = this.up.get(x); u !== undefined && u !== r; x = u, u = this.up.get(x)) this.up.set(x, r);
    return r;
  }
  /** Joins the groups of a and b; returns the old and the new name of the group that changed, or undefined. */
  join(a: string, b: string, keep?: (x: string, y: string) => boolean): [string, string] | undefined {
    let [x, y] = [this.find(a), this.find(b)];
    if (x === y) return undefined;
    if (keep?.(x, y)) [x, y] = [y, x];
    this.up.set(x, y);
    return [x, y];
  }
}

/**
 * Which currents and node voltages of an operating point ngspice gave as rounding noise of a 0, and
 * which nodes are at the same voltage (decision 0015; C9 to C9u).
 *
 * For a circuit PlainSpice solves exactly (exact.ts: R, C, L, V, I, E, F, G and H with plain values,
 * and diodes, whose currents are left free; the circuit ngspice simulated, as its values show, and
 * solved by ngspice to the digits the page shows; beside a sweep that is decided exactly too), the exact
 * solution decides: a current or node voltage whose exact value is 0 (for every current the diodes could
 * carry, those that carry 0 A at 0 V at 0 and those placed alike equal, diodeStructure) is noise of 0,
 * whatever size ngspice gives it (an H of 1 GΩ makes 193.5 pA of a balanced bridge's noise, C9o); one whose
 * exact value is not 0 is real, however tiny, and shown as ngspice gives it (732 nV and 61 nA beside a 1 TΩ
 * meter, C9n), or as the exact solution gives it where ngspice's arithmetic rounded it to exactly 0 (the
 * 1 µΩ wire in series with that meter; `lostCurrents`, `lostNodes`; with diodes only where no diode's
 * current changes it). Two nodes are at the same voltage when their exact voltages are equal. A circuit at
 * rest, every exact value 0, is decided when ngspice's Newton leftovers are within 2^-30 of its tolerances
 * (atRest), and so is one where no current flows but a source holds a voltage, where the check that ngspice
 * simulated this circuit cannot weigh its leftovers (still). Beside a sweep the exact solution does not follow
 * (of a resistor, of two sources), the .op is decided exactly with the sweep's points at its own state
 * (opStateSweep).
 *
 * Where ngspice's answers are not the exact ones to the page's digits (a 1e-12 Ω wire beside kilohms
 * gives 4.321 V for 4.5 V), a 0 or an exact value from the exact solution would sit beside ngspice's
 * other numbers and break Ohm's law on the page: the rule decides from ngspice's own numbers
 * (ruleNoise), every number shown is ngspice's, the exact solution only keeps the rule's words true
 * (`withExact`), and a warning names the answers that are off (`off`). For other circuits (a
 * transistor, a subcircuit, ...) the rule decides alone, and calls a value noise only where ngspice's
 * numbers show it is 0. The checks of ngspice's values get the same budget on every run (`checkBudget`).
 */
export function roundingNoise(netlist: Netlist, results: AnalysisResults): RoundingNoise {
  const op = results.op;
  if (!op) return noNoise('rule');
  const ex = exactOf(netlist);
  // A sweep the exact solution decides is checked at some of its points (sweepChecks): its share of the run's
  // budget is kept for it.
  const seen = ex ? opCheck(ex, op, results.dc ? sweepReserve(netlist, results, ex) : 0, results.dc) : undefined;
  if (ex && seen?.check === 'same') {
    // A run's .op and .dc are decided together: the .op is decided exactly only beside a sweep that is too
    // (decidedSweep). An .op decided exactly beside a sweep left as ngspice gives it called R5's −8.882e-19 A
    // rounding noise of an exact 0, where the sweep's words gave it as a current at the same state (the critic of
    // round 3). A sweep the exact solution does not follow (of a resistor, of two sources) is decided at its points
    // at the .op's own state, which show the .op's 0s (opStateSweep). Otherwise the rule decides, held to the exact
    // solution (withExact), with no warning: ngspice's answers are not off.
    const sweep = results.dc ? sweepNoise(netlist, results) : undefined;
    // With diodes placed alike, both must take them as carrying equal currents, or neither (a sweep with no point
    // checked takes them neither way).
    if (!results.dc || (sweep && (!ex.diodes || sweep.alike === undefined || seen.view.alike === undefined || sweep.alike === seen.view.alike))) return exactNoise(netlist, ex, seen.view, op);
    return withExact(netlist, ex, seen.view, ruleNoise(netlist, results), []);
  }
  const rule = ruleNoise(netlist, results);
  return ex && seen?.check === 'imprecise' ? withExact(netlist, ex, seen.view, rule, seen.off) : rule;
}

/**
 * The sweep of a run as PlainSpice shows it decided (sweepNoise), or undefined when it is left as ngspice
 * gives it: a run's .op and .dc are decided exactly together or not at all, so a sweep beside an .op that is
 * not decided exactly is left as ngspice gives it too (s9101-849: the rule shows the .op's 14.44 µA around a
 * loop that nothing drives, where ngspice settles on it, while the sweep, decided exactly, showed the same
 * resistor as rounding noise of 0 at the .op's own 100 V; the critic of round 3).
 */
function decidedSweep(netlist: Netlist, results: AnalysisResults): SweepNoise | undefined {
  const noise = results.dc ? sweepNoise(netlist, results) : undefined;
  if (!noise || !results.op) return noise;
  return noiseOf(netlist, results).by === 'exact' ? noise : undefined;
}

// ---- the exact solution (exact.ts)

/** The circuit solved exactly, once per netlist: its operating point, and the slopes its .dc and .tf need. */
interface Exact {
  model: ExactModel;
  /** The operating point: the node voltages, then the branch currents (each diode at 0 A). */
  op: Fraction[];
  /** Part and node indexes, by the names ngspice gives them in its results. */
  part: Map<string, number>;
  node: Map<string, number>;
  /**
   * .dc of one V or I: that source, and how much every unknown changes for 1 V or 1 A of it (with each diode at
   * 0 A); of the temperature: part −1, and no change.
   */
  sweep?: { part: number; slope: Fraction[] };
  /** .tf: its input and how much every unknown changes for 1 V or 1 A of it; for a voltage output, the voltages 1 A into it makes. */
  tf?: { part: number; slope: Fraction[]; into?: Fraction[] };
  /**
   * The work the solve took (exact.ts MAX_WORK), done once per netlist. Each run's checks of ngspice's
   * values get what it leaves of MAX_WORK, afresh (`checkBudget`): a budget kept with the netlist and
   * spent run after run made the same text, run again (Run pressed twice, or an undo back to it), lose
   * its sweep's decision and then its operating point's to the other rule.
   */
  solveWork: number;
  /**
   * The controlled sources that read another part of the circuit than their output's, and how much each
   * unknown changes for a unit change of what each makes, solved with the operating point (exact.ts
   * carrierSides): the floor of the answers they move (answerScales).
   */
  carried: Carried[];
  /**
   * The diodes, whose currents are left free: one diode for each branch of a forest of the diodes' graph
   * (the currents of these span every current the diodes can carry into the rest of the circuit), each
   * with the change a unit current through it makes in every unknown. `own`: true for a diode whose current
   * is its own (on no loop of diodes), so its current is the one its own diode law gives; `line`: its words
   * after its nodes (its model and settings), the same for two diodes with the same law (diodeStructure).
   */
  diodes?: { tree: number[]; slopes: Fraction[][]; own: boolean[]; line: string[] };
}

/** One operating point beside the exact solution: its values, and the solutions a value must be 0 in to be exactly 0. */
interface View {
  /** The unknowns: the exact operating point, each diode at the current Kirchhoff's law gives it from ngspice's values. */
  x: Fraction[];
  /**
   * The solutions a value must be 0 in to be 0 for every current the diodes could carry: the operating
   * point with each diode at 0 A, and for each class of free diodes (diodeStructure) the change a unit
   * current through each of its diodes together makes. [x] without diodes.
   */
  all: Fraction[][];
  /** Each current source's and diode's current in `x`. */
  level: (p: ExactPart) => Fraction;
  /** A diode of each class whose summed unit-current solution follows the operating point in `all`, in order (the others carry 0 A). */
  live?: number[];
  /** With diodes: true when diodes that sit alike are taken as carrying equal currents (diodeStructure). */
  alike?: boolean;
  /** With diodes: which carry 0 A and which carry equal currents (diodeStructure). */
  shape?: DiodeStructure;
}

const exactCache = new WeakMap<Netlist, Exact | null>();

/** The netlist's circuit solved exactly, or undefined when PlainSpice does not model it exactly (exact.ts). */
function exactOf(netlist: Netlist): Exact | undefined {
  const had = exactCache.get(netlist);
  if (had !== undefined) return had ?? undefined;
  let ex: Exact | null = null;
  const parts = partsOf(netlist).lines.map((l) => l.element!).filter((el) => el.letter && isBuilt(el));
  const model = exactModel(netlist, parts, readAfterEnd(netlist));
  if (typeof model !== 'string') {
    const part = new Map(model.parts.map((p, k) => [p.key, k]));
    const node = new Map(model.nodes.map((n, k) => [n, k]));
    const partOf = (name: string | undefined): number | undefined => (name === undefined ? undefined : part.get(ngspiceSpelling(name)));
    const sides = [operatingPoint(model)];
    // Diodes: one more solution for each branch of a forest of their graph, a unit current through it.
    const forest = new Groups();
    const tree: number[] = [];
    model.parts.forEach((p, k) => {
      if (p.kind === 'D' && forest.join(String(p.a), String(p.b))) tree.push(k);
    });
    const diodes = model.parts.some((p) => p.kind === 'D');
    for (const k of tree) sides.push(unitSource(model, k));
    // A forest diode on a loop of diodes stands for the loop's currents too; one on none carries its own current.
    const ownCurrent = tree.map((k) => {
      const others = model.parts.filter((p, j) => p.kind === 'D' && j !== k);
      const seen = new Set([model.parts[k]!.a]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const p of others) {
          if (seen.has(p.a) !== seen.has(p.b)) {
            seen.add(p.a);
            seen.add(p.b);
            grew = true;
          }
        }
      }
      return !seen.has(model.parts[k]!.b);
    });
    const byKey = new Map(parts.map((el) => [ngspiceSpelling(el.key), el]));
    const lineOf = (k: number): string => (byKey.get(model.parts[k]!.key)?.fields.slice(3).map((f) => f.token.text.toLowerCase()).join(' ') ?? `#${k}`);
    // .dc of one source (decision 0015): every value is a + b·s, so one more solution gives every point; with
    // diodes, a + b·s plus what each diode's current at that point makes (findSweepNoise). A .tf of a circuit with
    // a diode is left as ngspice gives it: its ratio depends on the diode's conductance at the operating point.
    let sweep: { part: number; at: number } | undefined;
    const dc = netlist.analyses.map((i) => readAnalysis(netlist, i)).find((r) => r?.kind === 'dc');
    if (dc?.kind === 'dc' && dc.sweeps.length === 1 && (dc.sweeps[0]!.kind === 'voltage' || dc.sweeps[0]!.kind === 'current')) {
      const k = partOf(dc.sweeps[0]!.source.text);
      if (k !== undefined && (model.parts[k]!.kind === 'V' || model.parts[k]!.kind === 'I')) {
        sweep = { part: k, at: sides.length };
        sides.push(unitSource(model, k));
      }
    } else if (dc?.kind === 'dc' && dc.sweeps.length === 1 && dc.sweeps[0]!.kind === 'temperature') {
      // A sweep of the temperature: no part modelled exactly changes with it (a resistor's temperature
      // coefficients are settings, which leave it to the rule), and a diode's current, which does, is left free:
      // every point is the operating point's circuit, a + 0·s.
      sweep = { part: -1, at: -1 };
    }
    let tf: { part: number; at: number; into?: number } | undefined;
    const tfLine = netlist.analyses.map((i) => readAnalysis(netlist, i)).find((r) => r?.kind === 'tf');
    if (!diodes && tfLine?.kind === 'tf' && tfLine.input) {
      const k = partOf(tfLine.input.text);
      if (k !== undefined && (model.parts[k]!.kind === 'V' || model.parts[k]!.kind === 'I')) {
        tf = { part: k, at: sides.length };
        sides.push(unitSource(model, k));
        const [a, b] = tfLine.outputKind === 'voltage' ? tfLine.outputNames.map((n) => nodeIndex(model, node, n)) : [];
        if (a !== undefined && a !== -2 && (b === undefined || b !== -2)) {
          // 1 A from b into a, every source at 0: the voltage it makes between a and b is the output resistance.
          const into = model.nodes.map(() => ZERO).concat(model.parts.filter((p) => p.branch >= 0).map(() => ZERO));
          if (a >= 0) into[a] = ONE;
          if (b !== undefined && b >= 0) into[b] = neg(ONE);
          tf.into = sides.length;
          sides.push(into);
        }
      }
    }
    // The controlled sources that read another part: a unit change of what each makes (answerScales).
    const carriers = carrierSides(model);
    const carriersAt = sides.length;
    for (const c of carriers) sides.push(c.side);
    const budget = newBudget();
    const x = solveExact(model, sides, budget);
    if (x) {
      ex = { model, op: x[0]!, part, node, solveWork: MAX_WORK - budget.left, carried: carried(carriers, x.slice(carriersAt)) };
      if (diodes) ex.diodes = { tree, slopes: x.slice(1, 1 + tree.length), own: ownCurrent, line: tree.map(lineOf) };
      if (sweep) ex.sweep = { part: sweep.part, slope: sweep.at < 0 ? x[0]!.map(() => ZERO) : x[sweep.at]! };
      if (tf) {
        ex.tf = { part: tf.part, slope: x[tf.at]! };
        if (tf.into !== undefined) ex.tf.into = x[tf.into]!;
      }
    }
  }
  exactCache.set(netlist, ex);
  return ex ?? undefined;
}

/**
 * A budget for one run's checks of ngspice's values against the exact solution: what the solve left of
 * MAX_WORK, less `reserved` (the other analysis's checks in the same run: the operating point's for its
 * sweep, the sweep's for its operating point). The same for every run of the netlist, so its decisions are
 * too; one run's work stays within MAX_WORK; and its .op and .dc are decided exactly together or not at all
 * (an .op decided exactly beside a sweep left as ngspice gives it said 0 V where the sweep's words, at the
 * same point, said ngspice's noise).
 */
function checkBudget(ex: Exact, reserved = 0): Budget {
  return { left: Math.max(0, MAX_WORK - ex.solveWork - reserved) };
}

/** What one check of ngspice's values at one point takes from a run's budget: with diodes, their currents first (exact.ts treeCurrents). */
const checkCost = (ex: Exact): number => checkWork(ex.model) * (ex.diodes ? 2 : 1);

/** A node's index in the model by a name as written (−1 for ground, −2 when it has none). */
function nodeIndex(model: ExactModel, node: Map<string, number>, written: string): number {
  const name = ngspiceSpelling(written);
  if (name === '0' || (name === 'gnd' && !node.has('gnd'))) return -1;
  return node.get(name) ?? -2;
}

/** ngspice's values of one solution, as exact.ts reads them, by the names ngspice gives them. */
function ngspiceValues(nodes: Map<string, number>, branch: Map<string, number>, device: Map<string, number>): NgspiceValues {
  return { voltage: (n) => nodes.get(n), branch: (k) => branch.get(k), device: (k) => device.get(k) };
}

/**
 * How ngspice's operating point stands to the exact solution. 'same': it is this circuit's (it names the
 * same nodes and parts, and its values solve the exact equations as closely as its own rounding can,
 * exact.ts `agrees`), solved to the digits the page shows (no answer whose exact value is not 0 is drawn
 * with other digits and more than 5e-5 from it beyond what rounding leaves, judgeAnswers). 'imprecise': this
 * circuit's, but ngspice's answers are farther from the exact ones (a 1e-12 Ω wire beside kilohms:
 * 4.321 V for 4.5 V); `off` lists them. 'other': not this circuit's, as far as its values show, or more
 * work to check than the run's budget has. With diodes, each diode's current is the one
 * Kirchhoff's law gives it from ngspice's other values (exact.ts treeCurrents), and the rest is checked
 * against that. The checks get the budget `checkBudget` gives every run of the netlist, less `reserved`
 * (the run's sweep checks, which come after).
 */
function opCheck(ex: Exact, op: NonNullable<AnalysisResults['op']>, reserved = 0, dc?: Sweep, given?: Budget): { check: 'same' | 'imprecise'; view: View; off: Answer[] } | { check: 'other' } {
  const nodes = new Map<string, number>();
  const branch = new Map<string, number>();
  const device = new Map<string, number>();
  for (const n of op.nodes) {
    if (!ex.node.has(n.node)) return { check: 'other' };
    nodes.set(n.node, n.value);
  }
  for (const c of op.currents) {
    // A diode's own current (savecurrents' @d1[id]) is its last iteration's: not used.
    const diode = /^@([^[\]]+)\[id\]$/i.exec(c.element);
    if (diode && ex.model.parts[ex.part.get(diode[1]!) ?? -1]?.kind === 'D') continue;
    const k = ex.part.get(c.element);
    if (k === undefined) return { check: 'other' };
    const p = ex.model.parts[k]!;
    if (c.origin === 'branch') {
      if (p.branch < 0) return { check: 'other' };
      branch.set(c.element, c.value);
    } else if (p.kind !== 'V' && p.kind !== 'E' && p.kind !== 'H') device.set(c.element, c.value);
  }
  const ng = ngspiceValues(nodes, branch, device);
  const budget = given ?? checkBudget(ex, reserved);
  let view: View = { x: ex.op, all: [ex.op], level: (p) => p.value };
  if (ex.diodes) {
    const { model } = ex;
    const { tree, slopes } = ex.diodes;
    const currents = treeCurrents(model, tree, ng, budget);
    if (!currents) return { check: 'other' };
    // Which diodes carry 0 A and which carry equal currents (diodeStructure), from the voltage across each with
    // every diode at 0 A and the voltage a unit current through each makes across each.
    const op0 = overCommon(ex.op);
    const across = (x: { num: readonly bigint[] }, k: number): bigint => (model.parts[k]!.a < 0 ? 0n : x.num[model.parts[k]!.a]!) - (model.parts[k]!.b < 0 ? 0n : x.num[model.parts[k]!.b]!);
    const unit = slopes.map((x) => overCommon(x));
    const beta = tree.map((k) => unit.map((x) => across(x, k)));
    const zero0 = (t: number): boolean => across(op0, tree[t]!) === 0n;
    const key0 = (t: number): string => across(op0, tree[t]!).toString(16);
    let shape = diodeStructure(ex, zero0, key0, beta, true);
    const sitAlike = hasAlike(shape);
    // ngspice must have settled on the even solution, or the diodes are taken one by one (a circuit that sits
    // alike can settle unevenly, as a latch does).
    const alike = sitAlike && even(ex, shape, currents, ng);
    if (!alike) shape = diodeStructure(ex, zero0, key0, beta, false);
    // A diode taken as carrying 0 A must carry less than ngspice's current tolerance by ngspice's numbers:
    // ngspice can settle on a current that nothing drives (s5-137: a diode and 2.2 MΩ in a loop, 0.31 µA
    // through the 2.2 MΩ at 0.68 V, the diode given 2.5 mA), and its numbers are then not this circuit's.
    if (!quietAgrees(tree.filter((_, t) => shape.quiet[t]), currents)) return { check: 'other' };
    view = viewOf(ex, ex.op, slopes, shape, currents);
    // Undefined where no diodes sit alike (at rest none is free): either way is then the same decision.
    if (sitAlike) view.alike = alike;
    view.shape = shape;
  }
  // At rest, every value exactly 0 (every source at 0, every diode carrying 0 A at 0 V): no equation has anything
  // to weigh ngspice's Newton leftovers against (a diode's I-V sweep from 0 V: 7.3e-29 V at its node, 7.3e-32 A
  // through its resistor), so each must be within ANSWER_FLOOR of ngspice's own tolerances, vntol and abstol, or
  // of the largest value of its kind its sweep gives (atRest; the critic of round 3: the .op drew them with arrows
  // while the sweep beside it called the same values rounding noise of exact 0s). A circuit where no current flows
  // but a source holds a voltage (still) is checked as any other, and where its node equations hold nothing but
  // leftovers, so that the same-circuit check cannot weigh them (a 5 V source charging only a capacitor beside the
  // diode, the critic of round 4), as a circuit at rest, its held voltages against their exact values.
  const rest = (): { check: 'same'; view: View; off: Answer[] } | { check: 'other' } => (atRest(ex, view, op, dc) ? { check: 'same', view, off: [] } : { check: 'other' });
  if (view.all.every((x) => x.every(isZero))) return rest();
  if (!agrees(ex.model, ng, view.level, budget)) return still(ex, view) ? rest() : { check: 'other' };
  const judged = judgeAnswers(ex, view, ng);
  if (!judged) return { check: 'other' };
  if (judged.same) return { check: 'same', view, off: [] };
  const { all, free, indexOf, pageOff } = judged;
  // With diodes, the warning names a value only where its exact value is known to the page's digits: no diode's
  // current changes it, or what the diodes' currents (worked out from ngspice's off numbers) add to it is below
  // ANSWER_GAP of it and far below its gap from ngspice's (a 167 fA diode moves a bridge's node by 5 nV, where
  // ngspice is 0.26 mV off: leaving it out left ngspice's numbers, 48,000 times off, with no warning; the critic
  // of round 3).
  const diodeTerm = (a: Answer): number | undefined => {
    const k = indexOf(a);
    if (k === undefined) return undefined;
    const p = a.kind === 'current' ? ex.model.parts[k]! : undefined;
    const value = (x: readonly Fraction[]): Fraction => (!p ? x[k]! : p.branch >= 0 ? x[p.branch]! : partCurrent(ex.model, x, k, ZERO));
    return Math.abs(toDouble(sub(value(view.x), value(ex.op))));
  };
  const known = (a: Answer): boolean => {
    if (free(a)) return true;
    if (a.exact === 0) return false;
    const t = diodeTerm(a);
    return t !== undefined && t <= ANSWER_GAP * Math.abs(a.exact) && t <= DIODE_SHARE * Math.abs(a.given - a.exact);
  };
  return { check: 'imprecise', view, off: all.filter((a) => (a.gap > ANSWER_GAP || pageOff(a)) && known(a)) };
}

/**
 * Whether ngspice's answers of one solution are this circuit's, to the page's digits (opCheck, and each checked
 * point of a sweep): `same` when no answer whose exact value is not 0 is off on the page (`pageOff`), or when the
 * only ones that are off are values ngspice gives as exactly 0 that no diode's current changes, every other value
 * (the currents of the R, G and F too) agreeing: the exact values stand in for those 0s (lostValues), and
 * Kirchhoff's law holds on the page (V1 of 1.5 V through 47 Ω and a source of 1 aA: ngspice gives V1 and R1
 * exactly 0 A, and the warning sat beside "V1: no current", "R1: no current" and "I1: 1 aA", the critic of round
 * 3). Where another current ngspice works out is off too (R1 of 150 Ω at 5 V, which ngspice gives 5.921 aA the
 * other way for 3 aA), an exact value beside it would break that law, and the answers are off: `all` lists every
 * value with its gap, devices too.
 *
 * An answer is off on the page when it is drawn with other digits than its exact value (formatSI, as the words
 * draw it; the currents of the R, G and F that ngspice reports are answers here too, beyond what rounding leaves of
 * the numbers ngspice works each out from, exact.ts `ownGap`) and either is more than ANSWER_GAP from it beyond
 * what rounding leaves (exact.ts `answers`), or is a
 * node at exactly the voltage of another whose numbers ngspice gives are drawn differently, beyond rounding: a 0
 * between them would claim one voltage for two tags that differ (64.62 mV and 64.63 mV beside a 1 nΩ wire, each
 * within ANSWER_GAP of the exact 64.62 mV, the critic of round 4). An answer drawn with the exact value's digits is not
 * off, however far: V1's 372.4098 µA for 372.4395 µA is drawn "372.4 µA" either way, and a warning named it as
 * "372.4 µA, where ngspice gives 372.4 µA" until it was left out, which left the rule deciding with nothing said
 * (C9m fed through a 30 nΩ wire drew R7's exact 0 as 6.217e-20 A, the critic of round 4). Undefined when ngspice
 * gave no value for one of them.
 */
function judgeAnswers(ex: Exact, view: View, ng: NgspiceValues): { same: true } | { same: false; all: Answer[]; free: (a: Answer) => boolean; indexOf: (a: Answer) => number | undefined; pageOff: (a: Answer) => boolean } | undefined {
  // Every number the page draws from ngspice's answers: the node voltages, the currents of the V, E, H and L, and
  // those of the R, G and F that ngspice reports (a resistor's, worked out from two node voltages each drawn
  // with the exact value's digits, can be drawn off: 2.829 µA beside 2.827 µA where both are 2.828 µA).
  const all = answers(ex.model, view.x, ng, view.level, true, ex.carried);
  if (!all) return undefined;
  const drawnOff = offOnPage(ex, view, all);
  const pageOff = (a: Answer): boolean => drawnOff(a, a.ownGap ?? a.gap);
  if (!all.some(pageOff)) return { same: true };
  const slopes = view.all.slice(1);
  const indexOf = (a: Answer): number | undefined => (a.kind === 'voltage' ? ex.node.get(a.name) : ex.part.get(a.name));
  /** No diode's current changes it: its exact value is the circuit's, whatever current the diodes carry. */
  const free = (a: Answer): boolean => {
    if (!slopes.length) return true;
    const k = indexOf(a);
    if (k === undefined) return false;
    if (a.kind === 'voltage') return slopes.every((x) => isZero(x[k]!));
    const p = ex.model.parts[k]!;
    return p.branch >= 0 ? slopes.every((x) => isZero(x[p.branch]!)) : slopes.every((x) => currentIsZero(ex.model, x, k, ZERO));
  };
  // An exact value put in for ngspice's 0 must agree with the currents beside it as ngspice gives them: each R, G
  // and F current is held here to the currents at its nodes, not to the voltages it is worked out from.
  if (all.every((a) => !drawnOff(a, a.gap) || (a.given === 0 && free(a)))) return { same: true };
  return { same: false, all, free, indexOf, pageOff };
}

/**
 * Which answers of one solution are off on the page (judgeAnswers): drawn with other digits than the exact value,
 * and `gap` more than ANSWER_GAP (its gap beyond rounding, exact.ts `answers`), or a node whose exact voltage
 * another node shares (in every solution of the view, as its level on the page) while the numbers ngspice gives
 * the two are drawn differently, beyond rounding. Within rounding, two such numbers are drawn differently only
 * where the exact voltage lies on a rounding boundary of the page's digits (0.34375 V, which ngspice gives as
 * 0.34375 and 0.34374999999999983, drawn 343.8 mV and 343.7 mV): ngspice lost nothing there, and a warning that
 * says it lost most of its digits would not be true.
 */
function offOnPage(ex: Exact, view: View, list: readonly Answer[]): (a: Answer, gap: number) => boolean {
  const drawn = (a: Answer, v: number): string => formatSI(v, a.kind === 'voltage' ? 'V' : 'A');
  const misdrawn = (a: Answer): boolean => drawn(a, a.exact) !== drawn(a, a.given);
  // Nodes at one exact voltage, by the same key as their level (exactly): 0 is "0" over any denominator.
  const groups = new Map<string, Answer[]>();
  for (const a of list) {
    const k = a.kind === 'voltage' && a.exact !== 0 ? ex.node.get(a.name) : undefined;
    if (k === undefined) continue;
    const key = view.all.map((x) => (isZero(x[k]!) ? '0' : `${x[k]!.n.toString(16)}/${x[k]!.d.toString(16)}`)).join('|');
    const g = groups.get(key);
    if (g) g.push(a);
    else groups.set(key, [a]);
  }
  const split = new Set<string>();
  for (const g of groups.values()) if (g.length > 1 && g.some((a) => drawn(a, a.given) !== drawn(g[0]!, g[0]!.given))) for (const a of g) split.add(a.name);
  return (a, gap) => a.exact !== 0 && misdrawn(a) && (gap > ANSWER_GAP || (a.kind === 'voltage' && split.has(a.name) && gap > 0));
}

/** With diodes, the warning names an off value whose diode terms are at most this share of its gap from ngspice's (opCheck). */
const DIODE_SHARE = 1e-3;

/** True when each diode in `quiet` carries less than ngspice's current tolerance (ABSTOL) by Kirchhoff's law with ngspice's values (exact.ts treeCurrents). */
function quietAgrees(quiet: Iterable<number>, currents: ReadonlyMap<number, Fraction>): boolean {
  for (const k of quiet) if (Math.abs(toDouble(currents.get(k) ?? ZERO)) >= ABSTOL) return false;
  return true;
}

/** The largest size ngspice gives a node voltage and a current at the points of a sweep the run checks (sweepChecks), or 0 without a sweep. */
function sweepScale(dc: Sweep | undefined): { voltage: number; current: number } {
  const l = { voltage: 0, current: 0 };
  if (!dc) return l;
  for (const k of checkPoints(dc.scale.values.length)) {
    for (const s of dc.series) {
      const v = Math.abs(s.values[k] ?? 0);
      if (!Number.isFinite(v)) continue;
      const kind = /^v\(/i.test(s.name) ? 'voltage' : 'current';
      if (v > l[kind]) l[kind] = v;
    }
  }
  return l;
}

/**
 * True when no current flows anywhere in the view's one solution, exactly: every part's current is 0, every diode
 * carries 0 A with 0 V across it (none is free), and a source can only hold its nodes at a voltage (a 5 V source
 * charging only a capacitor). The node voltages are then only the voltages the sources hold.
 */
function still(ex: Exact, view: View): boolean {
  if (view.all.length !== 1) return false;
  const x = view.all[0]!;
  return ex.model.parts.every((p, k) => p.kind === 'D' || currentIsZero(ex.model, x, k, p.kind === 'I' ? view.level(p) : undefined));
}

/**
 * True when ngspice's values of a circuit at rest are what its Newton iterations leave of it: each node voltage
 * within ANSWER_FLOOR of its exact voltage (one a source holds; else 0), of vntol (1 µV) or of the largest node
 * voltage the run's sweep gives, the largest of the three, and each current within ANSWER_FLOOR of abstol (1 pA)
 * or of the sweep's largest current, the larger (9.3e-16 V and 9.3e-22 A for a node at 0 V and a current, without a
 * sweep). The circuit makes every current 0 there, so these only check that ngspice settled near that answer, not
 * on another (a circuit with positive feedback can have more than one), and that its sources are the netlist's. A
 * held voltage never sits across a resistor here: one that did would give the same-circuit check its scale (opCheck).
 */
function atRest(ex: Exact, view: View, op: NonNullable<AnalysisResults['op']>, dc: Sweep | undefined): boolean {
  const l = sweepScale(dc);
  const amps = ANSWER_FLOOR * Math.max(ABSTOL, l.current);
  return (
    op.nodes.every((n) => {
      const k = ex.node.get(n.node);
      const exact = k === undefined || isZero(view.x[k]!) ? 0 : toDouble(view.x[k]!);
      return Math.abs(n.value - exact) <= ANSWER_FLOOR * Math.max(VNTOL, Math.abs(exact), l.voltage);
    }) && op.currents.every((c) => Math.abs(c.value) <= amps)
  );
}

/** Which diodes of the forest carry 0 A, and which carry the same current as each other (diodeStructure). */
interface DiodeStructure {
  /** By place in the forest: true for a diode that carries 0 A. */
  quiet: boolean[];
  /** The others, in classes of diodes that carry the same current (one diode each where none sit alike). */
  classes: number[][];
}

/**
 * Which diodes of the forest (by place) carry 0 A and which carry equal currents, for every current the
 * diodes could carry, from the voltage across each with every diode at 0 A (`zero0`, `key0`: whether it is 0,
 * and a key equal for equal voltages) and the voltage a unit current through each makes across each
 * (`beta[t][l]`, whole numbers over one denominator).
 * - A diode whose voltage is 0, and stays 0 whatever current the others carry, carries 0 A: 0 V across a
 *   diode makes 0 A (C9t.2). Found from all those at 0 V down: one whose voltage a free class's current changes
 *   is free.
 * - Two diodes with the same line (model and settings) and their own currents (on no loop of diodes) carry
 *   the same current when they sit alike: the same voltage across each with every diode at 0 A, and the same
 *   voltage across each from each class's currents together (an equitable partition of the diodes, refined
 *   until it holds). Then the circuit's equations give one solution with their currents equal, and ngspice's
 *   numbers must show that solution: within RESIDUAL_SHARE of each other by Kirchhoff's law with ngspice's
 *   values (`currents`), or else they are taken one by one (a circuit that sits alike can settle unevenly,
 *   as a latch does). Two equal diode arms with a link between their middles: the link's current is c·I1 −
 *   c·I2, exactly 0 with I1 = I2; taken one by one it was drawn with ngspice's 1.89e-19 A (the critic of
 *   round 3).
 */
function diodeStructure(ex: Exact, zero0: (t: number) => boolean, key0: (t: number) => string, beta: readonly (readonly bigint[])[], alike: boolean): DiodeStructure {
  const { tree, own, line } = ex.diodes!;
  const m = tree.length;
  const sum = (t: number, members: readonly number[]): bigint => members.reduce((acc, l) => acc + beta[t]![l]!, 0n);
  /** The coarsest classes of `live` with one line, one voltage at 0 A and one voltage from each class's currents. */
  const partition = (live: readonly number[]): number[][] => {
    let color = new Map(live.map((t) => [t, own[t] ? `${line[t]}|${key0(t)}` : `#${t}`]));
    for (;;) {
      const groups = new Map<string, number[]>();
      for (const t of live) {
        const c = color.get(t)!;
        const list = groups.get(c);
        if (list) list.push(t);
        else groups.set(c, [t]);
      }
      const classes = [...groups.values()];
      const next = new Map(live.map((t) => [t, `${color.get(t)}|${classes.map((c) => sum(t, c).toString(16)).join(',')}`]));
      const names = new Map<string, string>();
      for (const v of next.values()) if (!names.has(v)) names.set(v, String(names.size));
      if (names.size === classes.length) return classes;
      color = new Map(live.map((t) => [t, names.get(next.get(t)!)!]));
    }
  };
  const quiet = Array.from({ length: m }, (_, t) => zero0(t));
  for (;;) {
    const live = tree.map((_, t) => t).filter((t) => !quiet[t]);
    const classes = alike ? partition(live) : live.map((t) => [t]);
    let changed = false;
    for (let t = 0; t < m; t++) {
      if (quiet[t] && classes.some((c) => sum(t, c) !== 0n)) {
        quiet[t] = false;
        changed = true;
      }
    }
    if (!changed) return { quiet, classes };
  }
}

/**
 * True when ngspice's numbers show the even solution: each class's currents (Kirchhoff's law with ngspice's
 * values, exact.ts treeCurrents) within what ngspice's rounding leaves in those laws, RESIDUAL_SHARE of the
 * largest sum of the sizes of a node's terms, ground's too (`agrees` holds ngspice's values to the same): two
 * equal diodes to ground got 4.622080e-13 A from their own node and 4.622093e-13 A from ground's law, a sum of
 * milliamps. A circuit that settles unevenly, as a latch does, gives currents that differ by far more.
 */
function even(ex: Exact, shape: DiodeStructure, currents: ReadonlyMap<number, Fraction>, ng: NgspiceValues, level: (p: ExactPart) => Fraction = (p) => p.value): boolean {
  const { tree } = ex.diodes!;
  if (shape.classes.every((c) => c.length === 1)) return true;
  // The sizes of the terms of Kirchhoff's law at each node and at ground (index nodes.length), from ngspice's values.
  const { model } = ex;
  const ground = model.nodes.length;
  const size = new Float64Array(ground + 1);
  const v = (k: number): number => (k < 0 ? 0 : Math.abs(ng.voltage(model.nodes[k]!) ?? 0));
  const add = (p: ExactPart, s: number): void => {
    if (!Number.isFinite(s)) return;
    for (const k of [p.a, p.b]) size[k < 0 ? ground : k] = size[k < 0 ? ground : k]! + s;
  };
  for (const p of model.parts) {
    const gain = Math.abs(toDouble(p.value));
    if (p.kind === 'R') add(p, (v(p.a) + v(p.b)) / gain);
    else if (p.kind === 'G') add(p, gain * (v(p.c) + v(p.d)));
    else if (p.kind === 'F') add(p, gain * Math.abs(ng.branch(model.parts[p.control]!.key) ?? 0));
    else if (p.kind === 'I') add(p, Math.abs(toDouble(level(p))));
    else if (p.kind === 'D') add(p, Math.abs(toDouble(currents.get(model.parts.indexOf(p)) ?? ZERO)));
    else if (p.branch >= 0) add(p, Math.abs(ng.branch(p.key) ?? 0));
  }
  const allowed = RESIDUAL_SHARE * size.reduce((m, x) => Math.max(m, x), 0);
  return shape.classes.every((c) => {
    const values = c.map((t) => toDouble(currents.get(tree[t]!) ?? ZERO));
    return values.every((x) => Math.abs(x - values[0]!) <= allowed);
  });
}

/** True when some class holds more than one diode: diodes that sit alike are taken as carrying equal currents. */
const hasAlike = (shape: DiodeStructure): boolean => shape.classes.some((c) => c.length > 1);

/**
 * The view of one solution with diodes: the unknowns with each class of free diodes at its currents' mean (the
 * same for each), and the solutions a value must be 0 in: `base` (every diode at 0 A) and one for each class,
 * the sum of its diodes' unit-current solutions (`slopes`, by place in the forest).
 */
function viewOf(ex: Exact, base: Fraction[], slopes: readonly Fraction[][], shape: DiodeStructure, currents: ReadonlyMap<number, Fraction>): View {
  const { model } = ex;
  const { tree } = ex.diodes!;
  // Over the slopes' one denominator, as withCurrents takes them: numerators added, no common factor searched for.
  const sums = shape.classes.map((c) => (c.length === 1 ? slopes[c[0]!]! : slopes[c[0]!]!.map((_, i) => sumOver(c.map((t) => slopes[t]![i]!)))));
  const mean = new Map<number, Fraction>();
  shape.classes.forEach((c, j) => {
    const total = c.reduce((acc, t) => add(acc, currents.get(tree[t]!) ?? ZERO), ZERO);
    mean.set(j, c.length === 1 ? total : div(total, fraction(BigInt(c.length))));
  });
  const level = new Map<ExactPart, Fraction>();
  shape.classes.forEach((c) => c.forEach((t) => level.set(model.parts[tree[t]!]!, currents.get(tree[t]!) ?? ZERO)));
  const live = shape.classes.map((_, j) => j);
  return { x: withCurrents(base, sums, live, mean), all: [base, ...sums], level: (p) => (p.kind === 'D' ? (level.get(p) ?? ZERO) : p.value), live: shape.classes.map((c) => tree[c[0]!]!) };
}

/** The sum of fractions over one denominator (or 0), as one fraction over it, not in lowest terms. */
function sumOver(list: readonly Fraction[]): Fraction {
  let n = 0n;
  let d = 1n;
  for (const v of list) {
    if (v.n === 0n) continue;
    if (n !== 0n && v.d !== d) return list.reduce((acc, x) => add(acc, x), ZERO);
    n += v.n;
    d = v.d;
  }
  return n === 0n ? ZERO : { n, d };
}

/** What a run's sweep checks take from its budget, kept for them by the .op's check: a check for each point it checks (SweepPlan.checks). */
function sweepReserve(netlist: Netlist, results: AnalysisResults, ex: Exact): number {
  const dc = results.dc;
  if (!dc) return 0;
  // A sweep the exact solution does not follow, or one too large to look through (SWEEP_VALUES), is checked only at its
  // points at the .op's own state (opStateSweep).
  if (!ex.sweep || sweepTooLarge(dc)) return (opStatePoints(netlist, results, ex)?.points.length ?? 0) * checkCost(ex);
  return (sweepPlan(netlist, results)?.checks.length ?? checkPoints(dc.scale.values.length).length) * checkCost(ex);
}

/**
 * What the exact solution says is 0 and equal, for every current the diodes could carry (the quiet ones at
 * 0 A, those placed alike equal): a value is 0 only when it is 0 in each of the view's solutions (one,
 * without diodes), two nodes are at the same voltage only when they are in each. A diode's own current is
 * never 0 here: it is free.
 */
function exactly(ex: Exact, view: View): { zero: boolean[]; nodeZero: (k: number) => boolean; same: (a: number, b: number) => boolean; key: (k: number) => string } {
  const { model } = ex;
  const { all } = view;
  const tree = view.live ?? [];
  // A current source's or diode's current in solution s: its level in the operating point, a unit diode's in its own slope.
  const levelIn = (s: number, p: ExactPart): Fraction => (s === 0 ? (p.kind === 'D' ? ZERO : p.value) : p === model.parts[tree[s - 1]!] ? ONE : ZERO);
  const zero = model.parts.map((p, k) => p.kind !== 'D' && all.every((x, s) => currentIsZero(model, x, k, p.kind === 'I' ? levelIn(s, p) : undefined)));
  const at = (x: readonly Fraction[], n: number): Fraction => (n < 0 ? ZERO : x[n]!);
  return {
    zero,
    nodeZero: (k) => all.every((x) => isZero(x[k]!)),
    same: (a, b) => all.every((x) => equal(at(x, a), at(x, b))),
    // Equal fractions over solveExact's one denominator have equal numerators (and 0 is 0/1, as ground's).
    key: (k) => all.map((x) => (k < 0 ? '0/1' : `${x[k]!.n.toString(16)}/${x[k]!.d.toString(16)}`)).join('|'),
  };
}

/**
 * The real currents and node voltages ngspice gave as exactly 0 (C9n): its arithmetic rounds a value
 * that is tiny beside the numbers it is worked out from to 0, where the exact solution has it. A value
 * below the smallest double (about 4.9e-324) has no number to show: it stays as ngspice gave it. With
 * diodes, only a value that no free diode's current changes, whose exact value does not depend on the
 * diodes' currents: those only ngspice's numbers give, to their rounding (a diode across a null of 0 V
 * carries exactly 0, but Kirchhoff's law with ngspice's numbers leaves it 4.4e-19 A, and that made a node
 * ngspice rightly gives as 0 V read 2.4e-16 V), and a diode's own current is never shown as a part's.
 */
function lostValues(netlist: Netlist, ex: Exact, view: View, op: NonNullable<AnalysisResults['op']>, out: RoundingNoise): void {
  const { model } = ex;
  const { x } = view;
  const { zero, nodeZero } = exactly(ex, view);
  const slopes = view.all.slice(1);
  const whole = overCommon(x);
  const at = (n: number): bigint => (n < 0 ? 0n : whole.num[n]!);
  for (const c of op.currents) {
    const k = c.value === 0 ? ex.part.get(c.element) : undefined;
    if (k === undefined || zero[k]) continue;
    const p = model.parts[k]!;
    if (p.kind === 'D' || !slopes.every((s) => currentIsZero(model, s, k, ZERO))) continue;
    const value = currentDouble(model, whole.num, whole.den, k, view.level(p));
    if (value === 0) continue;
    // A resistor: the voltage across it too, which ngspice's two equal end voltages do not show.
    out.lostCurrents.set(netlistPart(netlist, c.element), p.kind === 'R' ? { value, across: toDouble({ n: at(p.a) - at(p.b), d: whole.den }) } : { value });
  }
  for (const n of op.nodes) {
    const k = n.value === 0 ? ex.node.get(n.node) : undefined;
    if (k === undefined || nodeZero(k) || isZero(x[k]!) || !slopes.every((s) => isZero(s[k]!))) continue;
    const value = toDouble(x[k]!);
    if (value !== 0) out.lostNodes.set(netlistNode(netlist, n.node), value);
  }
}

/**
 * The rule's decision for a circuit PlainSpice solves exactly whose answers ngspice gave farther from
 * the exact ones than the page's digits (opCheck 'imprecise'): the run is decided as other circuits are,
 * from ngspice's own numbers, and every number on the page is ngspice's (the critic of round 2 of the
 * re-check's fixes: the exact value of a current ngspice gave as 0, beside ngspice's other numbers a few
 * per cent off, pushed current into one node from both sides). The exact solution only keeps the rule
 * from calling a real value noise (a value whose exact value is not 0 stays as ngspice gave it), keeps a
 * level only for nodes whose exact voltages are equal, and gives the answers that are off (`off`) for
 * the note that says so. A reason "every other current at this node is 0" stays only where the exact
 * solution makes it so.
 */
function withExact(netlist: Netlist, ex: Exact, view: View, rule: RoundingNoise, off: readonly Answer[]): RoundingNoise {
  const { model } = ex;
  const { zero, same } = exactly(ex, view);
  // The rule writes no node voltage as 0 V, so only its currents and levels are looked at.
  const out: RoundingNoise = noNoise('rule');
  if (ex.diodes) out.diodes = true;
  const partIndex = (key: string): number | undefined => ex.part.get(ngspiceSpelling(key));
  const nodeOf = (name: string): number => (name === '0' ? -1 : (ex.node.get(ngspiceSpelling(name)) ?? -2));
  for (const [key, why] of rule.currents) {
    const k = partIndex(key);
    if (k === undefined || !zero[k]) continue;
    if (why.kind === 'node') {
      const n = nodeOf(why.node);
      const others = model.parts.map((p, j) => (j !== k && n >= 0 && (p.a === n || p.b === n) ? j : -1)).filter((j) => j >= 0);
      out.currents.set(key, others.every((j) => zero[j]) ? why : { kind: 'exact' });
    } else out.currents.set(key, why);
  }
  // A level is kept for a group of nodes whose exact voltages are all equal (ground's: all 0).
  const groups = new Map<number, string[]>();
  for (const [name, level] of rule.levels) {
    const list = groups.get(level);
    if (list) list.push(name);
    else groups.set(level, [name]);
  }
  for (const [level, names] of groups) {
    const ks = names.map((name) => nodeOf(name));
    const first = level === 0 ? -1 : ks[0]!;
    if (first !== -2 && ks.every((k) => k !== -2 && same(k, first))) for (const name of names) out.levels.set(name, level);
  }
  // The answers that are off, with the netlist's names; an exact 0 the rule shows as 0 is not off on the page.
  out.off = [];
  for (const a of off) {
    const name = a.kind === 'voltage' ? netlistNode(netlist, a.name) : netlistPart(netlist, a.name);
    if (a.exact === 0 && a.kind === 'current' && out.currents.has(name)) continue;
    out.off.push({ ...a, name });
  }
  return out;
}

/** roundingNoise for a circuit solved exactly. */
function exactNoise(netlist: Netlist, ex: Exact, view: View, op: NonNullable<AnalysisResults['op']>): RoundingNoise {
  const { model } = ex;
  const { x } = view;
  const out: RoundingNoise = { ...noNoise('exact'), levels: new Map([['0', 0]]) };
  if (ex.diodes) out.diodes = true;
  const v = (n: number): Fraction => (n < 0 ? ZERO : x[n]!);
  const named = (n: number): string => (n < 0 ? '0' : netlistNode(netlist, model.nodes[n]!));
  const { zero, nodeZero, same, key } = exactly(ex, view);
  // The parts whose current flows at each node, for "every other current at this node is 0".
  const at: number[][] = model.nodes.map(() => []);
  model.parts.forEach((p, k) => {
    if (p.a >= 0) at[p.a]!.push(k);
    if (p.b >= 0 && p.b !== p.a) at[p.b]!.push(k);
  });
  // Nodes joined to ground through parts with no voltage across them, exactly.
  const joined = new Groups();
  for (const p of model.parts) if (same(p.a, p.b)) joined.join(String(p.a), String(p.b));
  // Levels: one for each exact voltage, 0 for ground's.
  const levelOf = new Map<string, number>([[key(-1), 0]]);
  model.nodes.forEach((_, k) => {
    const id = key(k);
    let level = levelOf.get(id);
    if (level === undefined) levelOf.set(id, (level = levelOf.size));
    out.levels.set(named(k), level);
  });
  const why = (k: number): NoiseWhy => {
    const p = model.parts[k]!;
    if (p.kind === 'R' || p.kind === 'C') return { kind: 'same', a: named(p.a), b: named(p.b), v: toDouble(v(p.a)) };
    if (p.kind === 'F' && zero[p.control]) {
      const control = model.parts[p.control]!.key;
      return { kind: 'copies', control: partsOf(netlist).byKey.get(netlistPart(netlist, control))?.element?.name.text ?? control };
    }
    if (p.kind === 'G' && same(p.c, p.d)) return { kind: 'reads', c: named(p.c), d: named(p.d) };
    for (const n of [p.a, p.b]) if (n >= 0 && at[n]!.every((j) => j === k || zero[j])) return { kind: 'node', node: named(n) };
    return { kind: 'exact' };
  };
  for (const c of op.currents) {
    if (c.value === 0 || !Number.isFinite(c.value)) continue;
    const k = ex.part.get(c.element);
    if (k !== undefined && zero[k]) out.currents.set(netlistPart(netlist, c.element), why(k));
  }
  for (const n of op.nodes) {
    if (n.value === 0 || !Number.isFinite(n.value)) continue;
    const k = ex.node.get(n.node);
    if (k === undefined || !nodeZero(k)) continue;
    const name = netlistNode(netlist, n.node);
    out.nodes.add(name);
    if (joined.find(String(k)) === joined.find('-1')) out.grounded.add(name);
  }
  // What the 0s need of the diodes, for the note's words: a diode carrying 0 A that one of them would change with
  // its current, and a class of diodes placed alike whose currents, one by one, would change it.
  if (ex.diodes && view.shape) {
    const shape = view.shape;
    const { slopes } = ex.diodes;
    const zeroIn = (x: readonly Fraction[], kind: 'part' | 'node', k: number): boolean => (kind === 'node' ? isZero(x[k]!) : currentIsZero(model, x, k, ZERO));
    const relied: { kind: 'part' | 'node'; k: number }[] = [];
    for (const key of out.currents.keys()) {
      const k = ex.part.get(ngspiceSpelling(key));
      if (k !== undefined) relied.push({ kind: 'part', k });
    }
    for (const name of out.nodes) {
      const k = ex.node.get(ngspiceSpelling(name));
      if (k !== undefined) relied.push({ kind: 'node', k });
    }
    out.diodeWhy = diodeWhy(ex, netlist, shape, (t) => relied.some((v) => !zeroIn(slopes[t]!, v.kind, v.k)));
  }
  // ngspice's arithmetic rounded these real values to exactly 0 (C9n's wire): PlainSpice shows the exact ones.
  lostValues(netlist, ex, view, op, out);
  return out;
}

/**
 * The diodes a set of 0s needs (DiodeWhy), by the netlist's names: each diode carrying 0 A whose current would
 * change one of them (`changes(t)`, by place in the forest), and each class of diodes placed alike with a diode
 * whose current, on its own, would.
 */
function diodeWhy(ex: Exact, netlist: Netlist, shape: DiodeStructure, changes: (t: number) => boolean): DiodeWhy {
  const { tree } = ex.diodes!;
  const name = (t: number): string => {
    const key = ex.model.parts[tree[t]!]!.key;
    return partsOf(netlist).byKey.get(netlistPart(netlist, key))?.element?.name.text ?? key;
  };
  return {
    quiet: tree.map((_, t) => t).filter((t) => shape.quiet[t] && changes(t)).map(name),
    alike: shape.classes.filter((c) => c.length > 1 && c.some(changes)).map((c) => c.map(name)),
  };
}

// ---- .tf and .dc in a circuit solved exactly (S8)

/**
 * ngspice's .tf ratio when it is rounding noise of a ratio the circuit makes exactly 0, else undefined
 * (decision 0015, C9p). In a circuit PlainSpice solves exactly every value is a + b·s in the input s,
 * so the ratio is b, from one more exact solution with the input at 1 V or 1 A. ngspice's .tf gives no
 * node voltages, so its input and output resistances must be the exact ones to within ANSWER_GAP (5e-5
 * of each, as an operating point's answers). Then, as in an operating point, an exact 0 is 0 whatever
 * size ngspice gives it when the netlist's .op shows that ngspice simulated this circuit and solved it to
 * the page's digits (opCheck 'same'): its .tf solves the same equations with the same factorisation,
 * and a gain lifts its rounding as it does the .op's (an H of 1 GΩ reading a balanced bridge gives
 * −2.15e-8 V/V where its .op gives out 0 V, the critic of round 2 of the re-check's fixes). Without that
 * .op, only a ratio within RESIDUAL_SHARE of the largest change the input makes in a value of the
 * output's kind is taken as rounding noise: the three numbers of a .tf are all there is to check.
 */
function transferNoise(netlist: Netlist, results: AnalysisResults, reading: Extract<AnalysisReading, { kind: 'tf' }> | undefined): number | undefined {
  const tf = results.tf;
  const given = tf?.transferFunction;
  if (!tf || given === undefined || given === 0 || !Number.isFinite(given) || !reading) return undefined;
  const ex = exactOf(netlist);
  if (!ex?.tf) return undefined;
  const { model, tf: t } = ex;
  const input = model.parts[t.part]!;
  // Whole numbers over one denominator (overCommon): no common factor is searched for in numbers of thousands of bits.
  const { num, den } = overCommon(t.slope);
  const v = (n: number): bigint => (n < 0 ? 0n : num[n]!);
  /** top / den × f as a double, f = fn / fd. */
  const double = (top: bigint, fn = 1n, fd = 1n): number => {
    const [n, d] = [top * fn, den * fd];
    return n === 0n ? 0 : toDouble(d < 0n ? { n: -n, d: -d } : { n, d });
  };
  let ratio: bigint;
  /** The largest change the input makes in a value of the output's kind (only without an .op that agrees). */
  let scale: () => number;
  if (reading.outputKind === 'voltage') {
    const [a, b] = reading.outputNames.map((n) => nodeIndex(model, ex.node, n));
    if (a === undefined || a === -2 || b === -2) return undefined;
    ratio = v(a) - (b === undefined ? 0n : v(b));
    scale = () => num.slice(0, model.nodes.length).reduce((m, x) => Math.max(m, Math.abs(double(x))), 0);
  } else {
    const k = ex.part.get(ngspiceSpelling(reading.outputNames[0] ?? ''));
    if (k === undefined || model.parts[k]!.branch < 0) return undefined;
    ratio = num[model.parts[k]!.branch]!;
    scale = () => model.parts.reduce((m, _, j) => Math.max(m, Math.abs(currentDouble(model, num, den, j, j === t.part ? ONE : ZERO))), 0);
  }
  const near = (given: number | undefined, exact: number | undefined): boolean => {
    if (given === undefined || exact === undefined) return true;
    return Number.isFinite(exact) && Math.abs(given - exact) <= ANSWER_GAP * Math.abs(exact);
  };
  // The input resistance: the input source's own voltage over its current, every other source at 0.
  const through = input.kind === 'V' ? v(input.branch) : v(input.b) - v(input.a);
  const inputR = through === 0n ? undefined : input.kind === 'V' ? toDouble(through < 0n ? { n: den, d: -through } : { n: -den, d: through }) : double(through);
  const outputR = t.into && reading.outputKind === 'voltage' ? (() => {
    const into = overCommon(t.into!);
    const [a, b] = reading.outputNames.map((n) => nodeIndex(model, ex.node, n));
    const at = (n: number | undefined): bigint => (n === undefined || n < 0 ? 0n : into.num[n]!);
    const top = at(a) - at(b);
    return top === 0n ? undefined : toDouble({ n: top, d: into.den });
  })() : undefined;
  if (ratio !== 0n || !near(tf.inputImpedance?.value, inputR) || !near(tf.outputImpedance?.value, outputR)) return undefined;
  const sameOp = !!results.op && noiseOf(netlist, results).by === 'exact';
  if (!sameOp && Math.abs(given) > RESIDUAL_SHARE * scale()) return undefined;
  return given;
}

/** A .dc sweep in a circuit solved exactly: by series, the points where ngspice gave rounding noise of an exact 0, and those where it gave 0 for a real value. */
interface SweepNoise {
  /**
   * By series index, the points in order (an index into the sweep's values) where ngspice gave a number for a
   * value the circuit makes exactly 0 there; 'all' for a series the circuit makes 0 at every point, whose every
   * number ngspice gave is noise (one mark, not 99,999 indexes: the critic of round 3).
   */
  zero: Map<number, number[] | 'all'>;
  /**
   * By series index, the points in order where ngspice gave exactly 0 though the circuit makes the value
   * real (C9n at a sweep's points; the critic of round 2 of the re-check's fixes), and the exact values.
   */
  lost: Map<number, { points: number[]; values: number[] }>;
  /** The swept source as written; for a sweep of the temperature, "TEMP". */
  source: string;
  /** True for a sweep of the temperature: its points are said as temperatures ("at 50 °C"). */
  temperature: boolean;
  /** True when the circuit has diodes: a 0 is 0 whatever current they carry at that point (the note says so). */
  diodes: boolean;
  /** With diodes: true when diodes that sit alike are taken as carrying equal currents (diodeStructure). */
  alike?: boolean;
  /** With diodes: what the noise points need of the diodes (DiodeWhy). */
  diodeWhy?: DiodeWhy;
  /** A point's name for the notes, when the swept source and its value do not say it (a sweep of two sources). */
  name?: (k: number) => string;
}

/**
 * The points of a sweep's series that are noise (every point where ngspice gave a number, for 'all'): how many,
 * and the first `limit` of them, which is all a note names (a sweep can have 99,999 points and 53 such series:
 * listing every one took 150 ms, the critic of round 3).
 */
function noisePoints(points: readonly number[] | 'all', values: ArrayLike<number>, limit: number): { count: number; first: number[] } {
  if (points !== 'all') return { count: points.length, first: points.slice(0, limit) };
  const first: number[] = [];
  for (let k = 0; k < values.length && first.length < limit; k++) if (values[k] !== 0 && Number.isFinite(values[k]!)) first.push(k);
  // The count in one pass over the typed array, with no array built: v - v is 0 for a finite number, NaN for an
  // infinity or NaN.
  const a = values instanceof Float64Array ? values : Float64Array.from(values);
  let skipped = 0;
  for (let k = 0; k < a.length; k++) {
    const v = a[k]!;
    if (v === 0 || v - v !== 0) skipped += 1;
  }
  return { count: a.length - skipped, first };
}

/** The points where a series is `v` (0, an infinity or NaN), by the array's own search: a sweep can have 99,999 points and dozens of series. */
function pointsOf(values: ArrayLike<number>, v: number): number[] {
  const out: number[] = [];
  const a = values as Float64Array;
  if (Number.isNaN(v)) {
    if (typeof a.includes === 'function' && !a.includes(Number.NaN)) return out;
    for (let k = 0; k < values.length; k++) if (Number.isNaN(values[k]!)) out.push(k);
    return out;
  }
  if (typeof a.indexOf !== 'function') {
    for (let k = 0; k < values.length; k++) if (values[k] === v) out.push(k);
    return out;
  }
  for (let k = a.indexOf(v); k !== -1; k = a.indexOf(v, k + 1)) out.push(k);
  return out;
}

/** True when point k of a series is noise of a 0 (SweepNoise.zero). */
function noiseAt(points: readonly number[] | 'all' | undefined, values: ArrayLike<number>, k: number): boolean {
  if (points === undefined || values[k] === 0 || !Number.isFinite(values[k]!)) return false;
  return points === 'all' || (points.length > 0 && points[points.length - 1] === k) || points.includes(k);
}

/**
 * At most this many of a sweep's points where ngspice gives 0 for a real value get their exact value
 * worked out with whole numbers (3 to 6.5 µs a point, measured); past them, and never at the last point,
 * the value is worked out in doubles from the exact a and b of a + b·s, which leaves it 8 significant
 * digits or more wherever a + b·s is not within 2^-24 of a and b·s (where it crosses 0), and there the
 * whole numbers are used again.
 */
const SWEEP_EXACT_POINTS = 2000;

const sweepCache = new WeakMap<AnalysisResults, { netlist: Netlist; noise: SweepNoise | undefined }>();

/** At most this many points of a sweep are checked against the exact equations: its first, its last and some between. */
const SWEEP_CHECKS = 5;

/**
 * At most this many of a sweep's values, its points times its results, are looked through for rounding noise
 * (findSweepNoise reads each series a few times: its work grows with both). A larger sweep is left as ngspice
 * gives it, but at its points at the .op's own state (opStateSweep), and a note says so (sweepSizeNote): a
 * beginner's ".dc I1 0 2A 0.5A" (2A is 2 attoamps) runs 444,089 points, and a 51-part ladder's 444,094 points of
 * 78 results took 74 to 84 ms of processor time, its 2.2 million 303 to 327 ms (the last pass).
 */
export const SWEEP_VALUES = 2_000_000;

/** True when a sweep has more values than SWEEP_VALUES: it is left as ngspice gives it, but at the .op's own state. */
export function sweepTooLarge(dc: Sweep): boolean {
  return dc.scale.values.length * Math.max(1, dc.series.length) > SWEEP_VALUES;
}

/** The points of a sweep of `n` points that are checked against the exact equations (SWEEP_CHECKS of them, or all of a shorter one). */
function checkPoints(n: number): number[] {
  if (n <= 0) return [];
  return [...new Set([0, n - 1, ...Array.from({ length: SWEEP_CHECKS - 2 }, (_, i) => Math.round(((i + 1) * (n - 1)) / (SWEEP_CHECKS - 1)))])];
}

/**
 * The points of a .dc sweep where ngspice gave rounding noise of a value the circuit makes exactly 0
 * (decision 0015, C9p), once per run. In a circuit PlainSpice solves exactly every value is a + b·s in
 * the swept source s, so the operating point and one more exact solution give every point; in a sweep of the
 * temperature every point is the operating point's circuit (b = 0). Each point is judged at the value ngspice
 * swept the source to, the sweep's own x, read exactly: ngspice adds the step up in doubles, so "-1 1 0.1"
 * reaches −1.39e-16 V where the student wrote 0, and a node that follows the source is a real −1.39e-16 V
 * there, as the Plot panel's x says (the critic of the re-check's fixes). So a + b·s is 0 at every point when
 * a and b are, and otherwise only where ngspice's x is −a/b exactly: a search through the doubles, with no
 * fractions at each point (a sweep can have 99,999 points). ngspice's values at the first point, the last,
 * three between and each point where a diode may carry 0 A must solve the exact equations as closely as its
 * rounding can (exact.ts `agrees`), and be the exact answers to the page's digits (`answersAgree`), as for an
 * operating point; at a point where the circuit is at rest, each within ANSWER_FLOOR of ngspice's tolerances
 * or of the sweep's largest value of its kind (atRest). With diodes, each diode's current is left free at
 * each point, as in the operating point, with the same classes of diodes that sit alike (diodeStructure): a
 * value is 0 at a point where a + b·s is 0 and no class free there changes it, and a diode with exactly 0 V
 * across it there, whatever the free ones carry, carries 0 A (the H of 1 GΩ with a diode said out 0 V in the
 * .op beside the sweep's −193.5 nV at the same 9 V). Undefined for a sweep of two sources or of a resistor,
 * and for a circuit not solved exactly: the .op beside it is then not decided exactly either (decidedSweep).
 */
function sweepNoise(netlist: Netlist, results: AnalysisResults): SweepNoise | undefined {
  const cached = sweepCache.get(results);
  if (cached?.netlist === netlist) return cached.noise;
  // A sweep too large to look through (SWEEP_VALUES) is decided at its points at the .op's own state only.
  const noise = exactOf(netlist)?.sweep && !(results.dc && sweepTooLarge(results.dc)) ? findSweepNoise(netlist, results) : opStateSweep(netlist, results);
  sweepCache.set(results, { netlist, noise });
  return noise;
}

/**
 * The points of a sweep the exact solution does not follow (of a resistor, or of two sources) where every swept
 * part is at its netlist value, so that the circuit there is the netlist's, as in its .op (a sweep of the
 * temperature changes no part modelled exactly): ngspice's x is the part's value exactly (it sets a resistor to
 * the sweep's value and works its conductance out as in the .op, dctrcurv.c), and in a sweep of two sources the
 * outer one is at its start plus its step added once for each run of the inner one, in doubles, as ngspice adds
 * it. With each point's name for the notes. Undefined for any other sweep, or when the points do not come as the
 * two sweeps' counts say.
 */
function opStatePoints(netlist: Netlist, results: AnalysisResults, ex: Exact): { points: number[]; name: (k: number) => string } | undefined {
  // Once per run: the .op's check, the sweep's decision and the size note each need them, and a sweep can have
  // hundreds of thousands of points.
  const cached = statePointsCache.get(results);
  if (cached?.netlist === netlist) return cached.at;
  const at = findStatePoints(netlist, results, ex);
  statePointsCache.set(results, { netlist, at });
  return at;
}

const statePointsCache = new WeakMap<AnalysisResults, { netlist: Netlist; at: { points: number[]; name: (k: number) => string } | undefined }>();

function findStatePoints(netlist: Netlist, results: AnalysisResults, ex: Exact): { points: number[]; name: (k: number) => string } | undefined {
  const dc = results.dc;
  const line = netlist.analyses.find((i) => netlist.lines[i]?.directive?.name === '.dc');
  const r = line === undefined ? undefined : readAnalysis(netlist, line);
  if (!dc || r?.kind !== 'dc' || r.sweeps.length < 1 || r.sweeps.length > 2) return undefined;
  const xs = dc.scale.values;
  /** The double ngspice gives a swept part in the .op, its netlist value; undefined for the temperature; null for a sweep of anything else. */
  const target = (sw: SweepReading): number | undefined | null => {
    if (sw.kind === 'temperature') return undefined;
    const kind = sw.kind === 'voltage' ? 'V' : sw.kind === 'current' ? 'I' : sw.kind === 'resistance' ? 'R' : undefined;
    const k = kind ? ex.part.get(ngspiceSpelling(sw.source.text)) : undefined;
    const p = k === undefined ? undefined : ex.model.parts[k]!;
    if (!p || p.kind !== kind) return null;
    const v = partsOf(netlist).byKey.get(netlistPart(netlist, p.key))?.element?.value?.number?.value ?? (kind === 'R' ? undefined : 0);
    return v === undefined || !Number.isFinite(v) ? null : v;
  };
  const label = (sw: SweepReading, v: number): string => (sw.kind === 'temperature' ? formatSI(v, sw.unit) : S.sweepAt(sweepName(sw), formatSI(v, sw.unit)));
  const [inner, outer] = r.sweeps as [SweepReading, SweepReading | undefined];
  const t1 = target(inner);
  if (t1 === null) return undefined;
  if (!outer) {
    // A sweep of the temperature alone (too large to look through, SWEEP_VALUES): its point at the .op's own temperature.
    const at = t1 ?? OP_TEMPERATURE;
    const points: number[] = [];
    for (let k = 0; k < xs.length; k++) if (xs[k] === at) points.push(k);
    return { points, name: (k) => label(inner, xs[k]!) };
  }
  const t2 = target(outer);
  const n1 = inner.points;
  const n2 = outer.points;
  if (t2 === null || (t1 === undefined && t2 === undefined) || !n1 || !n2 || n1 * n2 !== xs.length || outer.startValue === undefined || outer.stepValue === undefined) return undefined;
  // The outer source's value for each run of the inner one, as ngspice adds its step (in kelvin for the temperature).
  const temperature = outer.kind === 'temperature';
  const values: number[] = [];
  for (let j = 0, v = outer.startValue + (temperature ? KELVIN : 0); j < n2; j++, v += outer.stepValue) values.push(temperature ? v - KELVIN : v);
  const points: number[] = [];
  for (let k = 0; k < xs.length; k++) if ((t1 === undefined || xs[k] === t1) && (t2 === undefined || values[Math.floor(k / n1)] === t2)) points.push(k);
  return { points, name: (k) => `${label(inner, xs[k]!)}, ${label(outer, values[Math.floor(k / n1)]!)}` };
}

/** 0 °C in kelvin, as ngspice adds it to a temperature (CONSTCtoK). */
const KELVIN = 273.15;
/** The temperature of an operating point PlainSpice solves exactly, in °C: ngspice's default (A15). */
const OP_TEMPERATURE = 27;

/**
 * A sweep the exact solution does not follow (of a resistor, of two sources), decided at its points at the .op's
 * own state (opStatePoints), each checked as an operating point (opCheck, its values the sweep's there) and given
 * the .op's 0s and exact values (exactNoise); every other point is left as ngspice gives it. With no such point,
 * nothing is marked, and nothing at the .op's state contradicts its 0s. Undefined when a point is not this
 * circuit's to the page's digits, or the points cannot be told: the .op is then not decided exactly either.
 */
function opStateSweep(netlist: Netlist, results: AnalysisResults): SweepNoise | undefined {
  const dc = results.dc;
  const ex = exactOf(netlist);
  if (!dc || !ex) return undefined;
  const at = opStatePoints(netlist, results, ex);
  if (!at) return undefined;
  const budget = checkBudget(ex, results.op ? checkCost(ex) : 0);
  const zero = new Map<number, number[]>();
  const lost = new Map<number, { points: number[]; values: number[] }>();
  const quiet = new Set<string>();
  const classes = new Map<string, string[]>();
  let alike: boolean | undefined;
  for (const k of at.points) {
    const op = pointOp(dc, k);
    const seen = opCheck(ex, op, 0, dc, budget);
    if (seen.check !== 'same' || (alike !== undefined && seen.view.alike !== undefined && seen.view.alike !== alike)) return undefined;
    alike ??= seen.view.alike;
    const noise = exactNoise(netlist, ex, seen.view, op);
    const { same } = exactly(ex, seen.view);
    for (const q of noise.diodeWhy?.quiet ?? []) quiet.add(q);
    for (const c of noise.diodeWhy?.alike ?? []) classes.set(c.join(' '), c);
    dc.series.forEach((series, j) => {
      const value = series.values[k]!;
      const m = /^([vi])\((.*)\)$/i.exec(series.name);
      if (!m || !Number.isFinite(value)) return;
      const inner = m[2]!;
      const device = /^@([^[\]]+)\[(i|id|current)\]$/i.exec(inner);
      let isZero0 = false;
      let exact: number | undefined;
      if (m[1]!.toLowerCase() === 'v') {
        const name = netlistNode(netlist, inner);
        isZero0 = noise.nodes.has(name);
        exact = noise.lostNodes.get(name);
      } else if (device && device[2]!.toLowerCase() === 'id') {
        // A diode with exactly 0 V across it, whatever current the free ones carry, carries 0 A (C9t.2).
        const d = ex.part.get(device[1]!);
        const p = d === undefined ? undefined : ex.model.parts[d]!;
        isZero0 = !!p && p.kind === 'D' && same(p.a, p.b);
      } else {
        const key = netlistPart(netlist, device ? device[1]! : inner);
        isZero0 = noise.currents.has(key);
        exact = noise.lostCurrents.get(key)?.value;
      }
      if (isZero0 && value !== 0) {
        const list = zero.get(j);
        if (list) list.push(k);
        else zero.set(j, [k]);
      } else if (exact !== undefined && value === 0) {
        const list = lost.get(j);
        if (list) {
          list.points.push(k);
          list.values.push(exact);
        } else lost.set(j, { points: [k], values: [exact] });
      }
    });
  }
  const out: SweepNoise = { zero, lost, source: '', temperature: false, diodes: !!ex.diodes, name: at.name };
  if (ex.diodes) {
    if (alike !== undefined) out.alike = alike;
    out.diodeWhy = { quiet: [...quiet], alike: [...classes.values()] };
  }
  return out;
}

/** The values of a sweep at point k, as an operating point (results.ts interpretOperatingPoint): node voltages, branch currents, part currents. */
function pointOp(dc: Sweep, k: number): NonNullable<AnalysisResults['op']> {
  const nodes: { node: string; value: number }[] = [];
  const currents: ElementCurrent[] = [];
  for (const s of dc.series) {
    const value = s.values[k];
    const m = /^([vi])\((.*)\)$/i.exec(s.name);
    if (value === undefined || !m) continue;
    if (m[1]!.toLowerCase() === 'v') {
      if (!m[2]!.includes(',')) nodes.push({ node: m[2]!, value });
      continue;
    }
    const device = /^@([^[\]]+)\[(i|current)\]$/i.exec(m[2]!);
    if (device) currents.push({ element: device[1]!, value, origin: 'device', vector: s.name });
    else currents.push({ element: m[2]!, value, origin: 'branch', vector: s.name });
  }
  return { nodes, currents };
}

/**
 * What a .dc sweep's decision needs from the exact solution alone, before any of ngspice's values (sweepPlan):
 * every unknown as (a + b·s + Σ c[j]·I_j) / den, each series as a linear function of the unknowns, the
 * voltage across each diode of the forest, which diodes carry 0 A and which carry equal currents at every
 * point, the points where a diode free elsewhere has 0 V across it, and the points the run checks (`checks`:
 * the first, the last, three between, and those).
 */
interface SweepPlan {
  ex: Exact;
  sweep: SweepReading;
  swept: ExactPart | undefined;
  tree: number[];
  den: bigint;
  a: bigint[];
  b: bigint[];
  c: bigint[][];
  xs: ArrayLike<number>;
  n: number;
  forms: (((v: readonly bigint[]) => bigint) | [bigint, bigint] | null)[];
  factor: (Fraction | undefined)[];
  kinds: { kind: 'voltage' | 'branch' | 'device'; name: string }[];
  across: { a: bigint; b: bigint; c: bigint[] }[];
  shapeAt: (x: Fraction | undefined, alike: boolean) => DiodeStructure;
  freeEverywhere: DiodeStructure;
  specialX: Map<number, Fraction>;
  specialPoints: number[];
  checks: number[];
}

const planCache = new WeakMap<AnalysisResults, { netlist: Netlist; plan: SweepPlan | undefined }>();

/** planSweep, once per run: the .op's check keeps the budget its checks need (sweepReserve), and the sweep spends it. */
function sweepPlan(netlist: Netlist, results: AnalysisResults): SweepPlan | undefined {
  const cached = planCache.get(results);
  if (cached?.netlist === netlist) return cached.plan;
  const plan = planSweep(netlist, results);
  planCache.set(results, { netlist, plan });
  return plan;
}

function planSweep(netlist: Netlist, results: AnalysisResults): SweepPlan | undefined {
  const dc = results.dc;
  const ex = dc ? exactOf(netlist) : undefined;
  if (!dc || !ex?.sweep) return undefined;
  const line = netlist.analyses.find((i) => netlist.lines[i]?.directive?.name === '.dc');
  const r = line === undefined ? undefined : readAnalysis(netlist, line);
  const sweep = r?.kind === 'dc' && r.sweeps.length === 1 ? r.sweeps[0]! : undefined;
  if (!sweep) return undefined;
  const { model, sweep: sw } = ex;
  // The swept source; none in a sweep of the temperature.
  const swept = sw.part >= 0 ? model.parts[sw.part]! : undefined;
  // Whole numbers over one denominator (the operating point, the slope and each diode's unit current share
  // solveExact's): with the swept source at s and diode j of the forest (exactOf) at the current I_j, unknown i
  // is (a[i] + b[i]·s + Σ c[j][i]·I_j) / den, a with the source at 0 and every diode at 0 A, b its change for
  // 1 V or 1 A, c[j] the change a unit current through diode j makes.
  const tree = ex.diodes?.tree ?? [];
  const solutions = [overCommon(ex.op), overCommon(sw.slope), ...(ex.diodes?.slopes ?? []).map((x) => overCommon(x))];
  const dens = solutions.filter((w) => w.num.some((v) => v !== 0n)).map((w) => w.den);
  if (dens.some((d) => d !== dens[0])) return undefined;
  const sd = swept ? swept.value.d : 1n;
  const den = (dens[0] ?? 1n) * sd;
  const [op, slope] = solutions as [(typeof solutions)[number], (typeof solutions)[number]];
  const a = op.num.map((v, i) => v * sd - (swept ? swept.value.n * slope.num[i]! : 0n));
  const b = slope.num.map((v) => v * sd);
  const c = solutions.slice(2).map((w) => w.num.map((v) => v * sd));
  const xs = dc.scale.values;
  const n = xs.length;
  for (let k = 0; k < n; k++) if (!Number.isFinite(xs[k]!)) return undefined;
  const at = (v: readonly bigint[], node: number): bigint => (node < 0 ? 0n : v[node]!);
  // Each series as a linear function of the unknowns, up to a factor that is not 0 (a resistor's 1/R, a G's
  // gain): a node's voltage, a branch's current, a part's current (savecurrents), or a diode's voltage for its
  // own current (0 exactly where that is 0 V). `null` for a series that is 0 at every point (a capacitor, a G
  // or F of gain 0); a pair [a, b] of its own for a current source's, which no diode changes.
  const forms: (((v: readonly bigint[]) => bigint) | [bigint, bigint] | null)[] = [];
  /** What turns a series' (a + b·s) / den into its value: 1 for a voltage or a branch's current, 1/R, a G's or an F's gain; undefined for a current source's, which ngspice gives as its value, and a diode's. */
  const factor: (Fraction | undefined)[] = [];
  const kinds: { kind: 'voltage' | 'branch' | 'device'; name: string }[] = [];
  for (const s of dc.series) {
    const m = /^([vi])\((.*)\)$/i.exec(s.name);
    const inner = m?.[2] ?? '';
    const device = /^@([^[\]]+)\[(i|id|current)\]$/i.exec(inner);
    let form: ((v: readonly bigint[]) => bigint) | [bigint, bigint] | null | undefined;
    let f: Fraction | undefined = ONE;
    if (m?.[1] === 'v' && !inner.includes(',')) {
      const k = ex.node.get(inner);
      if (k !== undefined) {
        form = (v) => at(v, k);
        kinds.push({ kind: 'voltage', name: inner });
      }
    } else if (m?.[1] === 'i' && device) {
      const k = ex.part.get(device[1]!);
      const p = k === undefined ? undefined : model.parts[k]!;
      // A diode's current is "id"; every other part's "i" or "current".
      if (p && (p.kind === 'D') === (device[2]!.toLowerCase() === 'id')) {
        const across = (x: number, y: number) => (v: readonly bigint[]): bigint => at(v, x) - at(v, y);
        if (p.kind === 'R') [form, f] = [across(p.a, p.b), p.value.n < 0n ? { n: -p.value.d, d: -p.value.n } : { n: p.value.d, d: p.value.n }];
        else if (p.kind === 'G') [form, f] = [isZero(p.value) ? null : across(p.c, p.d), p.value];
        else if (p.kind === 'F') [form, f] = [isZero(p.value) ? null : (v) => at(v, model.parts[p.control]!.branch), p.value];
        else if (p.kind === 'I') [form, f] = [p === swept ? [0n, 1n] : isZero(p.value) ? null : [1n, 0n], undefined];
        // 0 V across a diode makes 0 A through it, and any other voltage a current that is not 0.
        else if (p.kind === 'D') [form, f] = [across(p.a, p.b), undefined];
        else if (p.kind === 'C') form = null;
        else if (p.branch >= 0) form = (v) => at(v, p.branch);
        if (form !== undefined) kinds.push({ kind: 'device', name: device[1]! });
      }
    } else if (m?.[1] === 'i') {
      const k = ex.part.get(inner);
      if (k !== undefined && model.parts[k]!.branch >= 0) {
        form = (v) => at(v, model.parts[k]!.branch);
        kinds.push({ kind: 'branch', name: inner });
      }
    }
    if (form === undefined) return undefined;
    forms.push(form);
    factor.push(f);
  }
  // The diodes: the voltage across each in a, b and each c[l] (a + b·s at 0 A; beta[t][l] for a unit current
  // through diode l). Which carry 0 A and which carry equal currents (diodeStructure): at every point, from a
  // and b together (the same at each s); at a point where a diode free elsewhere has exactly 0 V across it,
  // from that point's own voltages, worked out again there.
  const across = tree.map((k) => {
    const p = model.parts[k]!;
    const of = (v: readonly bigint[]): bigint => at(v, p.a) - at(v, p.b);
    return { a: of(a), b: of(b), c: c.map(of) };
  });
  const beta = across.map((d) => d.c);
  const shapeAt = (x: Fraction | undefined, alike: boolean): DiodeStructure =>
    diodeStructure(
      ex,
      (t) => (x === undefined ? across[t]!.a === 0n && across[t]!.b === 0n : across[t]!.a * x.d + across[t]!.b * x.n === 0n),
      (t) => (x === undefined ? `${across[t]!.a.toString(16)}/${across[t]!.b.toString(16)}` : (across[t]!.a * x.d + across[t]!.b * x.n).toString(16)),
      beta,
      alike,
    );
  const freeEverywhere = ex.diodes ? shapeAt(undefined, true) : { quiet: [], classes: [] };
  // The points where a diode free elsewhere may have 0 V across it: ngspice's x is −a/b of its voltage exactly.
  const specialX = new Map<number, Fraction>();
  freeEverywhere.classes.forEach((cls) => {
    const d = across[cls[0]!]!;
    if (d.b === 0n) return;
    const root = toDouble(d.b < 0n ? { n: d.a, d: -d.b } : { n: -d.a, d: d.b });
    const x = Number.isFinite(root) ? fromDouble(root) : undefined;
    if (x && d.a * x.d + d.b * x.n === 0n && !specialX.has(root) && xs.includes(root)) specialX.set(root, x);
  });
  /** The points at those x, in order (looked up once: a sweep can have 99,999 points). */
  const specialPoints: number[] = [];
  if (specialX.size) for (let k = 0; k < n; k++) if (specialX.has(xs[k]!)) specialPoints.push(k);
  // ngspice's values at the checked points must solve the exact equations as closely as its rounding can, and be
  // the exact answers to the page's digits. Their budget is the run's, less the operating point's check when the
  // run has one (it comes first). With diodes, each point's diode currents are the ones Kirchhoff's law gives
  // them from ngspice's other values there (exact.ts treeCurrents), as for the operating point; with classes of
  // diodes that sit alike, ngspice's currents must show the even solution at each of those points, or the
  // diodes are taken one by one there and everywhere.
  const checks = [...new Set([...checkPoints(n), ...specialPoints])];
  return { ex, sweep, swept, tree, den, a, b, c, xs, n, forms, factor, kinds, across, shapeAt, freeEverywhere, specialX, specialPoints, checks };
}

function findSweepNoise(netlist: Netlist, results: AnalysisResults): SweepNoise | undefined {
  const plan = sweepPlan(netlist, results);
  const dc = results.dc;
  if (!plan || !dc) return undefined;
  const { ex, sweep, swept, tree, den, a, b, c, xs, n, forms, factor, kinds, shapeAt, freeEverywhere, specialX, specialPoints, checks } = plan;
  const { model } = ex;
  const kindOf = (j: number): 'voltage' | 'current' => (kinds[j]!.kind === 'voltage' ? 'voltage' : 'current');
  /** No current anywhere at ngspice's x (still): every part's current, a + b·s of the unknowns, exactly 0 there, every diode at 0 A. */
  const stillAt = (x: Fraction): boolean => {
    const zero = (i: number): boolean => a[i]! * x.d + b[i]! * x.n === 0n;
    const same = (m: number, q: number): boolean => ((m < 0 ? 0n : a[m]!) - (q < 0 ? 0n : a[q]!)) * x.d + ((m < 0 ? 0n : b[m]!) - (q < 0 ? 0n : b[q]!)) * x.n === 0n;
    return model.parts.every((p) => {
      switch (p.kind) {
        case 'R':
          return same(p.a, p.b);
        case 'C':
        case 'D':
          return true;
        case 'I':
          return isZero(p === swept ? x : p.value);
        case 'G':
          return isZero(p.value) || same(p.c, p.d);
        case 'F':
          return isZero(p.value) || zero(model.parts[p.control]!.branch);
        default:
          return zero(p.branch);
      }
    });
  };
  const decide = (alike: boolean): { shapes: Map<number, DiodeStructure>; everywhere: DiodeStructure } | undefined => {
    const budget = checkBudget(ex, results.op ? checkCost(ex) : 0);
    const everywhere = ex.diodes ? shapeAt(undefined, alike) : { quiet: [], classes: [] };
    const shapes = new Map<number, DiodeStructure>();
    for (const [root, x] of specialX) shapes.set(root, ex.diodes ? shapeAt(x, alike) : everywhere);
    let scale: { voltage: number; current: number } | undefined;
    for (const k of checks) {
      const x = fromDouble(xs[k]!);
      const shape = shapes.get(xs[k]!) ?? everywhere;
      if (checkCost(ex) > budget.left) return undefined;
      /** At rest there (atRest): each voltage within ANSWER_FLOOR of its exact value, of vntol or of the sweep's largest, each current within ANSWER_FLOOR of abstol or of the sweep's largest. */
      const settled = (): boolean => {
        if (dc.series.every((s) => s.values[k] === 0)) return true;
        scale ??= sweepScale(dc);
        const l = scale;
        const volt = (node: number): number => (node < 0 ? 0 : toDouble({ n: a[node]! * x.d + b[node]! * x.n, d: den * x.d }));
        const amps = ANSWER_FLOOR * Math.max(ABSTOL, l.current);
        return dc.series.every((s, j) => {
          const given = s.values[k]!;
          if (kindOf(j) !== 'voltage') return Math.abs(given) <= amps;
          const exact = volt(ex.node.get(kinds[j]!.name)!);
          return Math.abs(given - exact) <= ANSWER_FLOOR * Math.max(VNTOL, Math.abs(exact), l.voltage);
        });
      };
      if (!shape.classes.length && a.every((ai, i) => ai * x.d + b[i]! * x.n === 0n)) {
        // At rest, every value exactly 0, counted as the check it stands for, so the run's .op and .dc still fit in
        // its budget together or not at all.
        budget.left -= checkCost(ex);
        if (!settled()) return undefined;
        continue;
      }
      const nodes = new Map<string, number>();
      const branch = new Map<string, number>();
      const device = new Map<string, number>();
      dc.series.forEach((s, j) => {
        const what = kinds[j]!;
        (what.kind === 'voltage' ? nodes : what.kind === 'branch' ? branch : device).set(what.name, s.values[k]!);
      });
      const ng = ngspiceValues(nodes, branch, device);
      const unknowns: Fraction[] = a.map((ai, i) => ({ n: ai * x.d + b[i]! * x.n, d: den * x.d }));
      let view: View = { x: unknowns, all: [unknowns], level: (p) => (p === swept ? x : p.value) };
      if (ex.diodes) {
        // A swept current source is at this point's value, not its netlist one (the critic of round 4).
        const level = (p: ExactPart): Fraction => (p === swept ? x : p.value);
        const currents = treeCurrents(model, tree, ng, budget, level);
        if (!currents) return undefined;
        if (!quietAgrees(tree.filter((_, t) => shape.quiet[t]), currents)) return undefined;
        if (alike && !even(ex, shape, currents, ng, level)) return undefined;
        const slopes = c.map((cj) => cj.map((v) => (v === 0n ? ZERO : { n: v * x.d, d: den * x.d })));
        const withDiodes = viewOf(ex, unknowns, slopes, shape, currents);
        view = { ...withDiodes, level: (p) => (p === swept ? x : withDiodes.level(p)) };
      }
      // Where no current flows but a source holds a voltage, and the same-circuit check cannot weigh the leftovers,
      // the point is checked as one at rest (opCheck).
      if (!agrees(model, ng, view.level, budget)) {
        if (!shape.classes.length && stillAt(x) && settled()) continue;
        return undefined;
      }
      if (!judgeAnswers(ex, view, ng)?.same) return undefined;
    }
    return { shapes, everywhere };
  };
  const tryAlike = !!ex.diodes && hasAlike(freeEverywhere);
  let alike = tryAlike;
  let decided = decide(alike);
  if (!decided && tryAlike) decided = decide((alike = false));
  if (!decided) return undefined;
  const { shapes, everywhere } = decided;
  const shapeOf = (k: number): DiodeStructure => shapes.get(xs[k]!) ?? everywhere;
  // a + b·s is 0 at every point when a and b are, else only at s = −a/b, where ngspice's x must be that number
  // exactly; and with diodes, only where no class of diodes free there changes it.
  const zero = new Map<number, number[] | 'all'>();
  const lost = new Map<number, { points: number[]; values: number[] }>();
  let exactLeft = SWEEP_EXACT_POINTS;
  // What the noise points need of the diodes, for the note's words (DiodeWhy): by structure, the series' diode
  // coefficients at the noise points.
  const needs: { shape: DiodeStructure; cs: bigint[] }[] = [];
  /** The points at one x, found once for every series whose root it is (most series of a sweep share theirs). */
  const pointsAtX = new Map<number, number[]>();
  const atX = (x: number): number[] => {
    let list = pointsAtX.get(x);
    if (!list) pointsAtX.set(x, (list = pointsOf(xs, x)));
    return list;
  };
  dc.series.forEach((s, j) => {
    const form = forms[j]!;
    const pair: [bigint, bigint] | null = typeof form === 'function' ? [form(a), form(b)] : form;
    const cs = typeof form === 'function' ? c.map(form) : [];
    /** True when a class of diodes free in `shape` changes this series. */
    const changes = (shape: DiodeStructure): boolean => shape.classes.some((cls) => cls.reduce((acc, t) => acc + (cs[t] ?? 0n), 0n) !== 0n);
    const values = s.values;
    /** ngspice's x where a + b·s is exactly 0, when there is one (b not 0, and −a/b a double). */
    let root: number | undefined;
    if (!changes(everywhere)) {
      if (pair === null || (pair[0] === 0n && pair[1] === 0n)) {
        // Marked only where ngspice gave a number somewhere (it gives a capacitor's 0 as 0).
        for (let k = 0; k < n; k++) {
          if (values[k] !== 0 && Number.isFinite(values[k]!)) {
            zero.set(j, 'all');
            needs.push({ shape: everywhere, cs });
            break;
          }
        }
      } else if (pair[1] !== 0n) {
        const [p, q] = pair;
        const r = toDouble(q < 0n ? { n: p, d: -q } : { n: -p, d: q });
        const x = Number.isFinite(r) ? fromDouble(r) : undefined;
        if (x && p * x.d + q * x.n === 0n) {
          root = r;
          const points = atX(r).filter((k) => values[k] !== 0 && Number.isFinite(values[k]!));
          if (points.length) {
            zero.set(j, points);
            for (const k of points) needs.push({ shape: shapeOf(k), cs });
          }
        }
      }
    } else if (pair !== null) {
      // It changes with a class of diodes' current: 0 only at a point where every class it changes with carries 0 A.
      const [p, q] = pair;
      const points: number[] = [];
      for (const k of specialPoints) {
        if (changes(shapeOf(k)) || values[k] === 0 || !Number.isFinite(values[k]!)) continue;
        const x = fromDouble(xs[k]!);
        if (p * x.d + q * x.n === 0n) {
          points.push(k);
          needs.push({ shape: shapeOf(k), cs });
        }
      }
      if (points.length) zero.set(j, points);
    }
    // The points where ngspice gave exactly 0 though a + b·s is not 0 there: a real value its arithmetic rounded
    // to 0. With diodes, only for a series no free class of diodes changes (lostValues).
    const f = factor[j];
    if (changes(everywhere) || pair === null || f === undefined || (pair[0] === 0n && pair[1] === 0n)) return;
    const [p, q] = pair;
    /** The value at point k, exactly: f × (p + q·x) / den, x ngspice's own x. */
    const exactAt = (k: number): number => {
      const x = fromDouble(xs[k]!);
      const top = (p * x.d + q * x.n) * f.n;
      const bottom = den * x.d * f.d;
      return top === 0n ? 0 : toDouble(bottom < 0n ? { n: -top, d: -bottom } : { n: top, d: bottom });
    };
    let alpha: number | undefined;
    let beta2 = 0;
    const list = { points: [] as number[], values: [] as number[] };
    for (const k of pointsOf(values, 0)) {
      if (xs[k] === root) continue;
      let v: number | undefined;
      if (exactLeft <= 0 && k !== n - 1) {
        if (alpha === undefined) {
          const d = den * f.d;
          const sign = d < 0n ? -1n : 1n;
          alpha = toDouble({ n: p * f.n * sign, d: d * sign });
          beta2 = toDouble({ n: q * f.n * sign, d: d * sign });
        }
        const bx = beta2 * xs[k]!;
        const est = alpha + bx;
        if (Math.abs(est) >= 2 ** -24 * (Math.abs(alpha) + Math.abs(bx))) v = est;
      }
      if (v === undefined) {
        v = exactAt(k);
        exactLeft -= 1;
      }
      if (v !== 0) {
        list.points.push(k);
        list.values.push(v);
      }
    }
    if (list.points.length) lost.set(j, list);
  });
  const out: SweepNoise = { zero, lost, source: sweep.source.text, temperature: !swept, diodes: !!ex.diodes };
  if (ex.diodes) {
    if (tryAlike) out.alike = alike;
    const quiet = new Set<string>();
    const classes = new Map<string, string[]>();
    for (const { shape, cs } of needs) {
      const why = diodeWhy(ex, netlist, shape, (t) => (cs[t] ?? 0n) !== 0n);
      for (const q of why.quiet) quiet.add(q);
      for (const c of why.alike) classes.set(c.join(' '), c);
    }
    out.diodeWhy = { quiet: [...quiet], alike: [...classes.values()] };
  }
  return out;
}

/**
 * A .dc sweep as PlainSpice shows it: ngspice's values, with 0 where they are rounding noise of a value
 * the circuit makes exactly 0 (decision 0015, C9p). For the Plot panel: its lines, words, cursor and
 * table. The same object when nothing is noise.
 */
export function shownSweep(netlist: Netlist, results: AnalysisResults): Sweep | undefined {
  const dc = results.dc;
  const noise = dc ? decidedSweep(netlist, results) : undefined;
  if (!dc || !noise || (!noise.zero.size && !noise.lost.size)) return dc;
  // A series that is noise at every point shows 0 at every point: one array of 0s for all of them (a sweep can
  // have 99,999 points and 53 such series, the critic of round 3).
  let zeros: Float64Array | undefined;
  return {
    scale: dc.scale,
    series: dc.series.map((s, j) => {
      const at = noise.zero.get(j);
      const lost = noise.lost.get(j);
      if (!at && !lost) return s;
      let finite = true;
      for (let k = 0; k < s.values.length && finite; k++) finite = s.values[k]! - s.values[k]! === 0;
      if (at === 'all' && !lost && finite) return { ...s, values: (zeros ??= new Float64Array(s.values.length)) };
      const values = Float64Array.from(s.values);
      if (at === 'all') values.forEach((v, k) => Number.isFinite(v) && (values[k] = 0));
      else for (const k of at ?? []) values[k] = 0;
      // C9n at a sweep's points: a real value ngspice's arithmetic rounded to 0 is the exact one.
      lost?.points.forEach((k, i) => (values[k] = lost.values[i]!));
      return { ...s, values };
    }),
  };
}

// ---- the rule for other circuits

/**
 * roundingNoise for a circuit PlainSpice does not solve exactly (a transistor, a switch, a subcircuit, a
 * B source, a part with settings, .param, past the exact solution's limits, ...), from ngspice's own
 * numbers, never by comparing sizes across the circuit: a 2 aA source next to a 4 mA circuit is a real
 * 2 aA (C9e). Linear in the size of the circuit: each step looks again only at the parts a change can
 * affect. Every node keeps the voltage ngspice gives (the critic of round 2 of the re-check's fixes: no
 * guard could tell a node's real 433.7 fV, behind a bridge 1e-13 off balance, from noise), so each 0
 * this rule writes must agree with the numbers the page shows beside it.
 *
 * First, the currents that are real, which are never noise:
 * - a current of at least 1 pA (abstol); a current source's (I, or B with I=): its own value;
 * - a resistor with a real voltage across it (at least 1 µV and more than rounding), a G that reads one;
 * - an F that copies a real current; the current an H reads when its two ends are shown at voltages
 *   that are not alike (it makes them from that current);
 * - a part at a node with a part whose current ngspice does not give by name (a diode with a third
 *   node, a transistor, a subcircuit, a switch): it may carry that part's current;
 * - Kirchhoff's current law: where the real currents at a node do not add up to 0 (by more than
 *   rounding), the node's other parts carry the difference (C9h-C9k); and a part in series with a real
 *   current (the only two parts at a node) carries it too.
 * Then a current below 1 pA that is not real is noise when ngspice's numbers show it is 0:
 * - a resistor or capacitor whose two ends ngspice gives voltages within SAME_VOLTAGE_ULPS (the page
 *   shows them alike);
 * - an F that copies a current that is 0, a G whose two control nodes are shown alike;
 * - a source (not a resistor or capacitor) that carries the only current left at one of its nodes: every
 *   other current there is 0, and the currents at a node add up to 0. A node with a part whose current
 *   ngspice does not give by name is never used.
 * A resistor's current that ngspice gives as exactly 0 (its two ends the same double) proves nothing:
 * rounding can hide a real current there (C9n, where a 1 µΩ wire in series with a 1 TΩ meter carries
 * 0.73 aA), so it never makes another part's current 0.
 * Last, the page's own equations. Kirchhoff's current law: at a node where the currents shown do not add
 * up to 0 (to KCL_ROUNDING of the largest), every 0 written there gets ngspice's number back, and so on
 * from node to node (an F that copies a 0 into loads ngspice gives attoamps: S3). And a controlled
 * source's: a value it makes is shown beside the value it makes it from. An F whose current is shown
 * copies a current that is shown, and each F that copies a current given back gets its number too (an
 * F of 1 beside an F of 1000, both reading one ammeter); an E whose two ends are shown at voltages that
 * are not alike, or a G whose current is shown, reads a voltage that is not 0, so its two control nodes
 * are not in one group of nodes joined by resistors written as 0: each 0 of such a group gets its number
 * back (an E of 1e6 reading the balanced bridge of C9 makes out −931.3 pV from the voltage across R5, so
 * R5 keeps ngspice's 8.882e-19 A, not 0 A with "its two ends at the same voltage"). Each number given
 * back can unbalance a node, and each node balanced again can give a source its number back: until
 * nothing changes. A chain of controlled sources (an E reading what another E makes), and a source whose value
 * is an expression (value=, a B source), are not followed. Such a rule can still write a real current
 * smaller than ngspice's rounding as 0 (C9l): a resistor whose ends are 4 units in the last place apart
 * can carry one; decision 0015 says how often that was measured.
 */
function ruleNoise(netlist: Netlist, results: AnalysisResults): RoundingNoise {
  const out = noNoise('rule');
  const op = results.op!;
  const volts = voltages(netlist, results);
  const amps = new Map<string, number>();
  for (const c of op.currents) {
    const key = netlistPart(netlist, c.element);
    // An inductor has a branch and a device current, the same number: the branch one counts.
    if (c.origin === 'branch' || !amps.has(key)) amps.set(key, c.value);
  }
  const parts = partsOf(netlist)
    .lines.map((l) => l.element!)
    .filter((el) => el.letter && isBuilt(el));
  const byKey = new Map(parts.map((el) => [el.key, el]));
  const controlOf = (el: Element): string | undefined => (el.controlSource ? netlistPart(netlist, el.controlSource.text) : undefined);
  const volt = (ref: NodeRef | undefined): number | undefined => (ref ? volts.get(nodeName(ref)) : undefined);

  // Each part's two ends, and the parts whose current flows at each node. A node with a part whose
  // current is not known is `unknown`: Kirchhoff's current law cannot be used there.
  const ends = new Map<string, [string, string]>();
  const at = new Map<string, Element[]>();
  const unknown = new Set<string>();
  for (const el of parts) {
    const two = TWO_ENDED.has(el.letter!);
    if (!two || !amps.has(el.key)) {
      for (const ref of two ? el.nodes.slice(0, 2) : el.nodes) unknown.add(nodeName(ref));
      continue;
    }
    const [p, n] = el.nodes;
    if (!p || !n || nodeName(p) === nodeName(n)) continue;
    const pair: [string, string] = [nodeName(p), nodeName(n)];
    ends.set(el.key, pair);
    for (const node of pair) {
      const list = at.get(node);
      if (list) list.push(el);
      else at.set(node, [el]);
    }
  }
  const counted = (node: string): boolean => node !== '0' && !unknown.has(node);
  // The F and H that read each source's current.
  const readers = new Map<string, Element[]>();
  for (const el of parts) {
    const control = (el.letter === 'F' || el.letter === 'H') && controlOf(el);
    if (!control) continue;
    const list = readers.get(control);
    if (list) list.push(el);
    else readers.set(control, [el]);
  }

  // ---- 1. The currents that are real.
  const real = new Set<string>();
  interface Balance {
    all: number;
    largest: number;
    tiny: number;
    largestTiny: number;
    open: number;
    done: boolean;
  }
  const balance = new Map<string, Balance>();
  for (const [node, list] of at) if (counted(node)) balance.set(node, { all: 0, largest: 0, tiny: 0, largestTiny: 0, open: list.length, done: false });
  const toCheck: string[] = [];
  const makeReal = (first: Element): void => {
    const stack = [first];
    for (let el = stack.pop(); el; el = stack.pop()) {
      if (real.has(el.key)) continue;
      real.add(el.key);
      const amp = amps.get(el.key) ?? 0;
      for (const node of ends.get(el.key) ?? []) {
        const b = balance.get(node);
        if (!b) continue;
        // The current leaving the node through this part.
        const leaving = node === ends.get(el.key)![0] ? amp : -amp;
        b.all += leaving;
        b.largest = Math.max(b.largest, Math.abs(amp));
        if (Math.abs(amp) < ABSTOL) {
          b.tiny += leaving;
          b.largestTiny = Math.max(b.largestTiny, Math.abs(amp));
        }
        b.open -= 1;
        toCheck.push(node);
      }
      // An F copies its control's current: a real current copied is real (the current a real F copies is
      // given back in step 3, with every F that copies it).
      for (const r of readers.get(el.key) ?? []) if (r.letter === 'F' && amps.get(r.key)) stack.push(r);
    }
  };
  const realVoltage = (x: NodeRef | undefined, y: NodeRef | undefined): boolean => {
    const [a, b] = [volt(x), volt(y)];
    return a !== undefined && b !== undefined && Math.abs(a - b) >= VNTOL && !sameVoltage(a, b);
  };
  /** Two voltages ngspice gives, which the page shows as they are, that are not the same up to its rounding. */
  const realVoltageAcross = (x: NodeRef | undefined, y: NodeRef | undefined): boolean => {
    const [a, b] = [volt(x), volt(y)];
    return a !== undefined && b !== undefined && !sameVoltage(a, b);
  };
  /** Two voltages ngspice gives that are the same up to its rounding: the page shows them alike. */
  const shownSame = (x: NodeRef | undefined, y: NodeRef | undefined): boolean => {
    const [a, b] = [volt(x), volt(y)];
    return a !== undefined && b !== undefined && sameVoltage(a, b);
  };
  // An H whose two ends ngspice gives different voltages, which the page shows, makes them from its control current: real.
  for (const el of parts) {
    if (el.letter !== 'H') continue;
    const control = controlOf(el);
    const read = control === undefined ? undefined : byKey.get(control);
    if (read && amps.get(read.key) && realVoltageAcross(el.nodes[0], el.nodes[1])) makeReal(read);
  }
  for (const el of parts) {
    const amp = amps.get(el.key);
    if (!amp) continue;
    const [p, n, c, d] = el.nodes;
    if (
      !(Math.abs(amp) < ABSTOL) ||
      el.letter === 'I' ||
      (el.letter === 'B' && behaviouralKind(el) !== 'v') ||
      (el.letter === 'R' && realVoltage(p, n)) ||
      (el.letter === 'G' && realVoltage(c, d)) ||
      ends.get(el.key)?.some((node) => node !== '0' && unknown.has(node))
    )
      makeReal(el);
  }
  // Kirchhoff's current law: where the real currents at a node do not add up to 0, the other parts there
  // carry the difference; the tiny ones are checked on their own, since they are below the rounding
  // of large ones (C9h-C9k). A part in series with a real current carries it too.
  const clearlyNot0 = (sum: number, largest: number): boolean => largest > 0 && Math.abs(sum) > KCL_ROUNDING * largest;
  for (let node = toCheck.pop(); node !== undefined; node = toCheck.pop()) {
    const b = balance.get(node)!;
    const list = at.get(node)!;
    if (b.done || !b.open) continue;
    if ((list.length === 2 && b.open === 1) || clearlyNot0(b.tiny, b.largestTiny) || clearlyNot0(b.all, b.largest)) {
      b.done = true;
      for (const el of list) if (!real.has(el.key)) makeReal(el);
    }
  }

  // ---- 2. The currents that are noise of a 0.
  // A current ngspice gives as exactly 0 is 0 only where it is not a difference of two node voltages: a
  // resistor's or a G's 0 can be rounding that hides a real current (C9n).
  const differenceOf = (key: string): boolean => {
    const letter = byKey.get(key)?.letter;
    return letter === 'R' || letter === 'G';
  };
  const zero = (key: string | undefined): boolean =>
    key !== undefined && !real.has(key) && (out.currents.has(key) || (amps.get(key) === 0 && !differenceOf(key)));
  const candidate = (el: Element): boolean => {
    const amp = amps.get(el.key);
    return amp !== undefined && Math.abs(amp) >= SMALLEST_NORMAL && Math.abs(amp) < ABSTOL && !real.has(el.key);
  };
  // How many currents at each node are not 0: when one is left, it is 0 too.
  const left = new Map<string, number>();
  for (const [node, list] of at) if (counted(node)) left.set(node, list.filter((el) => !zero(el.key)).length);
  // The one part at a node whose current is not yet known to be 0 (whyZero decides whether that makes it 0).
  const lastAt = (node: string): Element | undefined => at.get(node)!.find((x) => !zero(x.key));
  const whyZero = (el: Element): NoiseWhy | undefined => {
    const [p, n, c, d] = el.nodes;
    // Only where the page shows the two voltages alike: no node is written as 0 V, so parts that join two
    // nodes do not make their numbers the same on the page.
    if ((el.letter === 'R' || el.letter === 'C') && p && n && shownSame(p, n)) return { kind: 'same', a: nodeName(p), b: nodeName(n) };
    if (el.letter === 'F' && zero(controlOf(el))) return { kind: 'copies', control: byKey.get(controlOf(el)!)?.name.text ?? el.controlSource!.text };
    if (el.letter === 'G' && c && d && shownSame(c, d)) return { kind: 'reads', c: nodeName(c), d: nodeName(d) };
    // A resistor or a capacitor is 0 only when its own ends are the same: being the only current left at a
    // node would claim that the voltage across it is noise, and another part's 0 there can be ngspice's
    // rounding of a real current (C9n).
    if (el.letter !== 'R' && el.letter !== 'C') for (const node of ends.get(el.key) ?? []) if (counted(node) && left.get(node) === 1) return { kind: 'node', node };
    return undefined;
  };
  // Each decision depends only on ngspice's numbers and on the 0s already written, which only add: one
  // pass, and each part looked at again only when a 0 at its node or of its control can change it.
  const queue = parts.filter(candidate);
  for (const [node, count] of left) {
    const last = count === 1 ? lastAt(node) : undefined;
    if (last) queue.push(last);
  }
  for (let k = 0; k < queue.length; k++) {
    const el = queue[k]!;
    if (!candidate(el) || out.currents.has(el.key)) continue;
    const why = whyZero(el);
    if (!why) continue;
    out.currents.set(el.key, why);
    for (const node of ends.get(el.key) ?? []) {
      const count = left.get(node);
      if (count === undefined) continue;
      left.set(node, count - 1);
      const last = count - 1 === 1 ? lastAt(node) : undefined;
      if (last) queue.push(last);
    }
    // An F copies a current that is 0.
    for (const r of readers.get(el.key) ?? []) if (r.letter === 'F') queue.push(r);
  }

  // ---- 3. The page's own equations. Kirchhoff's current law: at each node, the currents shown add up to
  // 0, to KCL_ROUNDING of the largest of them; where they do not, every 0 written there gets its number
  // back (an F that copies a 0 into loads whose currents ngspice gives as attoamps: S3), and so on from
  // node to node. A controlled source's equation: an F whose current is shown copies a current that is
  // shown; an E whose two ends are shown at voltages that are not alike, or a G whose current is shown,
  // reads a voltage that is not 0, so the resistors written as 0 that join its two control nodes into one
  // group get their numbers back (the critic of round 2: R5 0 A, "its two ends at the same voltage",
  // beside an E of 1e6 that makes out −931.3 pV from that voltage). No node voltage is written as 0 V.
  const shownAmp = (el: Element): number => (out.currents.has(el.key) ? 0 : (amps.get(el.key) ?? 0));
  const balanced = (node: string): boolean => {
    let sum = 0;
    let largest = 0;
    for (const el of at.get(node) ?? []) {
      const a = shownAmp(el);
      sum += node === ends.get(el.key)![0] ? a : -a;
      largest = Math.max(largest, Math.abs(a));
    }
    return largest === 0 || Math.abs(sum) <= KCL_ROUNDING * largest;
  };
  const toBalance = [...at.keys()].filter((node) => counted(node) && (at.get(node) ?? []).some((el) => out.currents.has(el.key)));
  // How many 0s each node has had given back, and how many when it was last balanced: a node is looked at
  // again only when a 0 at it has changed since (a node can be queued once for each of its parts).
  const changes = new Map<string, number>();
  const lookedAt = new Map<string, number>();
  /**
   * Gives a 0 written for a part its number back, and balances its nodes again (not `from`, being balanced).
   * An F that copies the current given back gets its number too: a 0 written for it ("copies a current that
   * is 0") beside the current it copies, shown, broke its equation on the page (an F of 1 into a 0 V
   * ammeter, reading the Vm that an F of 1000 beside it had given back).
   */
  const giveBack = (key: string, from?: string): boolean => {
    if (!out.currents.delete(key)) return false;
    for (const node of ends.get(key) ?? []) {
      changes.set(node, (changes.get(node) ?? 0) + 1);
      if (node !== from && counted(node)) toBalance.push(node);
    }
    for (const r of readers.get(key) ?? []) if (r.letter === 'F') giveBack(r.key);
    return true;
  };
  /**
   * The resistors and capacitors written as 0 that join a group of nodes holding both `from` and `to`, or
   * undefined when no such group holds both. Their 0s claim one voltage for the whole group.
   */
  const zeroGroup = (from: string, to: string): string[] | undefined => {
    const seen = new Set([from]);
    const queue = [from];
    const keys = new Set<string>();
    for (let k = 0; k < queue.length; k++) {
      const node = queue[k]!;
      for (const el of at.get(node) ?? []) {
        if ((el.letter !== 'R' && el.letter !== 'C') || !out.currents.has(el.key)) continue;
        keys.add(el.key);
        const [p, n] = ends.get(el.key)!;
        const next = p === node ? n : p;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen.has(to) ? [...keys] : undefined;
  };
  const gains = parts.filter((el) => el.letter === 'E' || el.letter === 'G' || el.letter === 'F');
  /** A controlled source whose value the page shows: an E's two ends not alike, a G's or an F's current. */
  const makes = (el: Element): boolean => (el.letter === 'E' ? realVoltageAcross(el.nodes[0], el.nodes[1]) : !out.currents.has(el.key) && !!amps.get(el.key));
  for (;;) {
    for (let node = toBalance.pop(); node !== undefined; node = toBalance.pop()) {
      if (lookedAt.get(node) === (changes.get(node) ?? 0)) continue;
      if (!balanced(node)) for (const el of at.get(node)!) giveBack(el.key, node);
      lookedAt.set(node, changes.get(node) ?? 0);
    }
    let given = false;
    // The nodes joined by resistors and capacitors written as 0, so that only two control nodes they join
    // are looked at; in this pass a group's 0s are given back all together, and its nodes are then free.
    let joined: Groups | undefined;
    const free = new Set<string>();
    for (const el of gains) {
      if (!makes(el)) continue;
      const control = el.letter === 'F' ? controlOf(el) : undefined;
      if (control !== undefined) {
        if (giveBack(control)) given = true;
        continue;
      }
      const [c, d] = [el.nodes[2], el.nodes[3]];
      if (el.letter === 'F' || !c || !d || nodeName(c) === nodeName(d)) continue;
      if (!joined) {
        joined = new Groups();
        for (const key of out.currents.keys()) {
          const letter = byKey.get(key)?.letter;
          const pair = letter === 'R' || letter === 'C' ? ends.get(key) : undefined;
          if (pair) joined.join(pair[0], pair[1]);
        }
      }
      if (free.has(nodeName(c)) || joined.find(nodeName(c)) !== joined.find(nodeName(d))) continue;
      for (const key of zeroGroup(nodeName(c), nodeName(d)) ?? []) {
        if (giveBack(key)) given = true;
        for (const node of ends.get(key) ?? []) free.add(node);
      }
    }
    if (!given) break;
  }

  // ---- 4. Levels: one for each group of nodes joined by parts with no voltage across them; ground's is
  // 0. Joined: an inductor, a 0 V source, a resistor or capacitor whose current is written as 0, an E whose
  // two control nodes are shown alike, an H whose control current is written as 0. A level is a claim the
  // page makes (0 V across a part between two of its nodes, no power), so it must agree with the numbers
  // it shows (the critic of the re-check's fixes): a node of ground's group has ground's level only when
  // it is shown as 0 V; a group with a resistor between two of its nodes whose current is shown as real
  // has no level (an H of 1 GΩ joins out to ground while Rl shows its 193.5 pA, and out its −193.5 nV);
  // nor has a group whose nodes are shown at voltages that are not alike. Nodes with no level are
  // compared by ngspice's values.
  const group = new Groups();
  for (const el of parts) {
    const [p, n, c, d] = el.nodes;
    if (!p || !n) continue;
    const joins =
      el.letter === 'L' ||
      zeroVolts(el) ||
      ((el.letter === 'R' || el.letter === 'C') && out.currents.has(el.key)) ||
      (el.letter === 'E' && shownSame(c, d)) ||
      (el.letter === 'H' && zero(controlOf(el)));
    if (joins) group.join(nodeName(p), nodeName(n));
  }
  const ground = group.find('0');
  const broken = new Set<string>();
  for (const el of parts) {
    const pair = el.letter === 'R' ? ends.get(el.key) : undefined;
    const amp = amps.get(el.key);
    if (pair && amp !== undefined && amp !== 0 && !out.currents.has(el.key) && group.find(pair[0]) === group.find(pair[1])) broken.add(group.find(pair[0]));
  }
  const first = new Map<string, number>();
  for (const [node, value] of volts) {
    const root = group.find(node);
    if (root === ground) continue;
    const had = first.get(root);
    if (had === undefined) first.set(root, value);
    else if (!sameVoltage(had, value)) broken.add(root);
  }
  const levelOf = new Map<string, number>([[ground, 0]]);
  for (const [node, value] of volts) {
    const root = group.find(node);
    if (broken.has(root) || (root === ground && node !== '0' && value !== 0)) continue;
    let level = levelOf.get(root);
    if (level === undefined) levelOf.set(root, (level = levelOf.size));
    out.levels.set(node, level);
  }
  return out;
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

/**
 * A node's name in the results' words (S7, words re-check 8): as first written when it has a character
 * outside ASCII ("GİRİŞ", "aµ", which ngspice spells g__r____ and au, and the key keeps half lower-cased
 * or as au), else its key, which is ngspice's own spelling ("in" for IN, W6); ground is "0". Keys stay
 * for every lookup.
 */
function shownNode(netlist: Netlist, key: string): string {
  if (key === '0') return key;
  const written = netlist.nodes.get(key)?.refs[0]?.text;
  return written !== undefined && !PRINTABLE_ASCII.test(written) ? written : key;
}
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/** A node ngspice names in its results or messages, as the netlist writes it (W16): its key ("ÇikiŞ" for ngspice's "__iki__"). */
export function netlistNode(netlist: Netlist, name: string): string {
  const key = lowerAscii(name);
  return spellingsOf(netlist).nodes.get(key) ?? key;
}

/** A part ngspice names in its results, as the netlist writes it (W18). */
function netlistPart(netlist: Netlist, name: string): string {
  const key = lowerAscii(name);
  return spellingsOf(netlist).parts.get(key) ?? key;
}

/** The node voltages ngspice gave, by the netlist's names; ground is "0". */
function voltages(netlist: Netlist, results: AnalysisResults): Map<string, number> {
  const m = new Map<string, number>([['0', 0]]);
  for (const n of results.op?.nodes ?? []) m.set(netlistNode(netlist, n.node), n.value);
  return m;
}

const noiseCache = new WeakMap<AnalysisResults, { netlist: Netlist; noise: RoundingNoise }>();

/** roundingNoise, once per run: the words, the notes and the drawing all use it. */
function noiseOf(netlist: Netlist, results: AnalysisResults): RoundingNoise {
  const cached = noiseCache.get(results);
  if (cached?.netlist === netlist) return cached.noise;
  const noise = roundingNoise(netlist, results);
  noiseCache.set(results, { netlist, noise });
  return noise;
}

/** The node voltages as PlainSpice shows them: rounding noise of a 0 is 0 (C9d), a real voltage ngspice rounded to 0 is the exact one (C9n). */
function shownVoltages(netlist: Netlist, results: AnalysisResults): Map<string, number> {
  const m = voltages(netlist, results);
  const noise = noiseOf(netlist, results);
  for (const n of noise.nodes) m.set(n, 0);
  for (const [n, v] of noise.lostNodes) m.set(n, v);
  return m;
}

/** Two nodes at the same level: the same voltage, exactly or by the rule for other circuits (RoundingNoise.levels). */
function sameLevel(noisy: RoundingNoise, a: string, b: string): boolean {
  const la = a === '0' ? 0 : noisy.levels.get(a);
  const lb = b === '0' ? 0 : noisy.levels.get(b);
  return la !== undefined && la === lb;
}

function currentWords(netlist: Netlist, c: ElementCurrent, volts: Map<string, number>, noisy: RoundingNoise): CurrentWords | undefined {
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
  // C9, C9b, C9d: rounding noise of a 0 is 0 A, with no direction and no power; `noise` keeps what ngspice gave.
  // C9n: a real current ngspice's arithmetic rounded to exactly 0 is the exact one; `given` keeps ngspice's 0.
  const noise = c.value !== 0 && noisy.currents.has(key);
  const lost = c.value === 0 ? noisy.lostCurrents.get(key) : undefined;
  const v = noise ? 0 : (lost?.value ?? c.value);
  const [from, to] = v < 0 ? [second, first] : [first, second];
  const name = el.name.text;
  const ammeter = isAmmeter(el);
  const a = formatSI(Math.abs(v), 'A');
  const as = speakSI(Math.abs(v), 'A');
  let text: string;
  let speech: string;
  // The nodes as the results' words name them (S7): GİRİŞ as written, never half lower-cased.
  const [fromName, toName] = [shownNode(netlist, from), shownNode(netlist, to)];
  const f = said(fromName);
  const t = said(toName);
  if (ammeter) {
    text = v === 0 ? S.measuresNothing(name) : S.measures(name, a, f, t);
    speech = v === 0 ? S.measuresNothing(name) : S.measures(name, as, f, t);
  } else if (v === 0) {
    text = S.noCurrent(name);
    speech = S.noCurrentSpeech(name);
  } else {
    text = S.amps(a, f, t, name);
    speech = S.ampsSpeech(as, flows(as), f, t, name);
  }
  const words: CurrentWords = { element: key, vector: c.vector, name, line: line.number, value: v, from, to, fromName, toName, ammeter, text, speech };
  if (noise) words.noise = c.value;
  if (lost) {
    words.given = c.value;
    if (lost.across !== undefined) words.across = lost.across;
  }
  if (!ammeter && SOURCE_LETTERS.has(el.letter)) {
    const vp = volts.get(first);
    const vn = volts.get(second);
    if (vp !== undefined && vn !== undefined) {
      // No voltage across it (its two ends at one level), no power, whatever the last bits (N2's E1 at 0 V).
      const absorbed = sameLevel(noisy, first, second) ? 0 : (vp - vn) * v;
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
  const volts = shownVoltages(netlist, results);
  const all = results.op?.currents ?? [];
  // An inductor appears twice with savecurrents (i(l1) and @l1[i], the same number): keep the branch one.
  const branch = new Set(all.filter((c) => c.origin === 'branch').map((c) => lowerAscii(c.element)));
  const noisy = noiseOf(netlist, results);
  const out: CurrentWords[] = [];
  for (const c of all) {
    if (c.origin === 'device' && branch.has(lowerAscii(c.element))) continue;
    const w = currentWords(netlist, c, volts, noisy);
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
  const noise = noiseOf(netlist, results);
  return list.map(({ n, node }) => {
    // C9d: rounding noise of a 0 is 0 V; `noise` keeps what ngspice gave. C9n: a real voltage ngspice
    // rounded to exactly 0 is the exact one; `given` keeps ngspice's 0.
    const lost = n.value === 0 ? noise.lostNodes.get(node) : undefined;
    const value = noise.nodes.has(node) ? 0 : (lost ?? n.value);
    const w: NodeVoltageWords = { node: node === lowerAscii(n.node) ? n.node : node, name: shownNode(netlist, node), value, text: formatSI(value, 'V'), speech: speakSI(value, 'V') };
    if (lost !== undefined) w.given = n.value;
    else if (value !== n.value) w.noise = n.value;
    const level = noise.levels.get(node);
    if (level !== undefined) w.level = level;
    if (node !== lowerAscii(n.node)) w.ngspice = n.node;
    const c = colour.get(node);
    if (c !== undefined) w.colourIndex = c;
    return w;
  });
}

function tfOf(netlist: Netlist, results: AnalysisResults): TransferFunctionWords | undefined {
  const tf = results.tf;
  if (!tf) return undefined;
  // Not a .tf in a subcircuit no X line uses, which ngspice ignores (A3f: its words named v(out)'s numbers v(a,gnd)).
  const line = netlist.analyses.find((i) => netlist.lines[i]?.directive?.name === '.tf' && !unusedSubcircuit(netlist, i));
  const r = line === undefined ? undefined : readAnalysis(netlist, line);
  const reading = r?.kind === 'tf' ? r : undefined;
  // A .tf after .end, which ngspice runs (S25, A3c, A3d), has no reading: ngspice's names, as the netlist
  // writes them (W16, W18), its input's kind by the part's letter (a current source: V/A, A4) and a
  // current output by its part ("i(Vm)", "the current in Vm").
  const part = (name: string): Element | undefined => partsOf(netlist).byKey.get(netlistPart(netlist, name))?.element;
  const inPart = reading || !tf.inputImpedance ? undefined : part(tf.inputImpedance.source);
  const outPart = reading || !tf.outputImpedance?.at.startsWith('i(') ? undefined : part(tf.outputImpedance.at.slice(2, -1));
  const output = withoutInvisible(reading?.output ?? (outPart ? `i(${outPart.name.text})` : tf.outputImpedance ? tfVector(netlist, tf.outputImpedance.at) : '?'));
  const input = reading?.input?.text ?? inPart?.name.text ?? tf.inputImpedance?.source ?? '?';
  const outKind = reading?.outputKind ?? (tf.outputImpedance?.at.startsWith('i(') ? 'current' : 'voltage');
  const inKind = (reading ? reading.inputKind === 'current' : inPart?.letter === 'I') ? 'current' : 'voltage';
  const ratio = `${outKind === 'current' ? 'A' : 'V'}/${inKind === 'current' ? 'A' : 'V'}`;
  const words: TransferFunctionWords = { output, input, ratio };
  if (tf.transferFunction !== undefined) {
    // S8: a ratio the circuit makes exactly 0 is 0; ngspice's rounding noise is kept in `noise` (decision 0015, C9p).
    const noise = transferNoise(netlist, results, reading);
    const value = noise === undefined ? tf.transferFunction : 0;
    const v = formatNumber(value);
    const [n1, n2] = tfNodes(netlist, reading, tf);
    const outSpeech = outKind === 'current' ? S.currentIn(reading?.outputNames[0] ?? outPart?.name.text ?? output) : n1 === undefined ? output : n2 === undefined ? S.voltageOf(n1) : S.voltageBetween(n1, n2);
    words.transferFunction = {
      value,
      text: S.transfer(output, input, v, ratio),
      speech: S.transferSpeech(outSpeech, input, v.replace(MINUS, 'minus '), (v === '1' ? S.ratioWordsOne[ratio] : S.ratioWords[ratio]) ?? ratio),
    };
    if (noise !== undefined) words.transferFunction.noise = noise;
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
      const [a, b] = tfNodes(netlist, reading, tf);
      const at = b ? S.between(a ?? '?', b) : a !== undefined ? S.at(a) : S.atVector(tf.outputImpedance.at);
      words.at = at;
      words.outputResistance = { value: tf.outputImpedance.value, text: S.outputR(at, o.text), speech: S.outputRSpeech(at, o.speech) };
    }
  }
  return words;
}

/**
 * A voltage output's nodes in the .tf words, each said one way in the text and in the speech (code
 * review 1, 4, 5): ground is "ground", a gnd that ngspice makes 0 there included (A3b); an
 * ordinary node named like ground is quoted (W13). With no reading of the line (a .tf written after
 * .end, which ngspice runs: S25, A3c), the nodes in ngspice's own name for the output, "v(out,mid)", as the
 * netlist writes them (W16), never "node v(out)".
 */
function tfNodes(netlist: Netlist, reading: Extract<AnalysisReading, { kind: 'tf' }> | undefined, tf: NonNullable<AnalysisResults['tf']>): string[] {
  if (reading) return reading.outputNodes.map((n) => said(n.ground ? '0' : n.token.text));
  const m = /^v\((.*)\)$/i.exec(tf.outputImpedance?.at ?? '');
  return m ? m[1]!.split(',').map((x) => said(afterEndNode(netlist, x) ?? shownNode(netlist, netlistNode(netlist, x)))) : [];
}

/**
 * A node of a .tf written after .end (S25, A3c) as that line writes it, for ngspice's spelling of it,
 * when it has a character outside ASCII ("ou<zero-width space>t" for ou___t, which no other line may
 * name: critic of the S11 fix, round 2); undefined otherwise, and ngspice's own name in lower case
 * stays for a plain one (W6).
 */
function afterEndNode(netlist: Netlist, spelling: string): string | undefined {
  const line = readAfterEnd(netlist).find((l) => /^\s*\.tf\b/i.test(l.text));
  const word = line?.tokens.slice(1).find((t) => ngspiceSpelling(t.text) === spelling)?.text;
  return word !== undefined && !/^[\x20-\x7e]*$/.test(word) ? word : undefined;
}

/** A .tf output's formula from ngspice's name for it, as netlistVector writes it, with the nodes of a .tf after .end as written. */
function tfVector(netlist: Netlist, name: string): string {
  const m = /^v\((.*)\)$/i.exec(name);
  return m ? `v(${m[1]!.split(',').map((x) => afterEndNode(netlist, x) ?? shownNode(netlist, netlistNode(netlist, x))).join(',')})` : netlistVector(netlist, name);
}

/** "the voltage at out" / "the current in V1" for a sweep result's name. */
function seriesSpeech(netlist: Netlist, s: SweepSeries): string {
  const m = /^([vi])\((.*)\)$/i.exec(s.name);
  if (!m) return s.name;
  if (m[1]!.toLowerCase() === 'v') {
    const [a, b] = m[2]!.split(',').map((x) => said(shownNode(netlist, netlistNode(netlist, x))));
    return b === undefined ? S.voltageOf(a!) : S.voltageBetween(a!, b);
  }
  // i(v1) is a branch current; i(@r1[i]) a part's current with savecurrents; i(@q1[ic]) a transistor's current at
  // one of its terminals, each named, so its four currents are not all "the current in Q1" (C8b).
  const device = /^@([^[\]]+)\[([^\]]*)\]$/.exec(m[2]!);
  const inner = device?.[1] ?? /^@([^[\]]+)\[/.exec(m[2]!)?.[1] ?? m[2]!;
  const el = partsOf(netlist).byKey.get(netlistPart(netlist, inner))?.element;
  const name = el?.name.text ?? inner;
  const terminal = device && el?.letter ? S.terminals[el.letter]?.[lowerAscii(device[2]!)] : undefined;
  return terminal ? S.terminalCurrent(name, terminal) : S.currentIn(name);
}

/**
 * A results vector's name with the netlist's names in it: "v(giriş)" for ngspice's "v(giri__)" (W16,
 * W18), "v(GİRİŞ)" and "v(aµ)" as written (S7). The Plot panel names its lines with it too.
 */
export function netlistVector(netlist: Netlist, name: string): string {
  const m = /^([vi])\((.*)\)$/i.exec(name);
  if (!m) return name;
  if (m[1]!.toLowerCase() === 'v') return `${m[1]}(${m[2]!.split(',').map((x) => shownNode(netlist, netlistNode(netlist, x))).join(',')})`;
  const device = /^@([^[\]]+)(\[.*)$/.exec(m[2]!);
  return device ? `${m[1]}(@${netlistPart(netlist, device[1]!)}${device[2]})` : `${m[1]}(${netlistPart(netlist, m[2]!)})`;
}

/**
 * Each result at the last point; `noisy` gives, by series, the points where ngspice gave rounding noise of
 * a 0 and those where it gave 0 for a real value (sweepNoise), so the words agree with the .op's at the
 * same point (the critic of round 2 of the re-check's fixes).
 */
function finals(netlist: Netlist, sweep: Sweep, noisy?: SweepNoise): SweepWords['final'] {
  const last = sweep.scale.values.length - 1;
  return sweep.series.map((s, j) => {
    const given = s.values[s.values.length - 1] ?? Number.NaN;
    // The points are in order: the last point is noise when it ends the list, lost when it ends that list.
    const at = noisy?.zero.get(j);
    const noise = s.values.length - 1 === last && noiseAt(at, s.values, last);
    const lost = noisy?.lost.get(j);
    const real = s.values.length - 1 === last && lost !== undefined && lost.points[lost.points.length - 1] === last ? lost.values[lost.values.length - 1] : undefined;
    const value = noise ? 0 : (real ?? given);
    const unit = s.unit === '°C' || s.unit === 's' ? s.unit : s.unit;
    const f: SweepWords['final'][number] = {
      name: s.name,
      value,
      text: S.valueIs(netlistVector(netlist, s.name), formatSI(value, unit)),
      speech: S.valueIsSpeech(seriesSpeech(netlist, s), speakSI(value, unit)),
    };
    if (noise) f.noise = given;
    if (real !== undefined) f.given = given;
    return f;
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
    const f = finals(netlist, sweep, decidedSweep(netlist, results));
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
    const end = points && f.length ? (one && one.kind !== 'temperature' ? S.atEndSpeech : S.atEnd)(whereSpeech, S.summaryValues(f.map((x) => x.speech))) : '';
    out.push({ kind: 'dc', points, end, text, speech, final: f });
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
    const end = points && f.length ? S.atEnd(speakSI(t[points - 1] ?? 0, 's'), S.summaryValues(f.map((x) => x.speech))) : '';
    out.push({ kind: 'tran', points, end, text, speech, final: f });
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
      // A3f: ngspice ignores a .tf in a subcircuit no X line uses, so its nodes are no message's.
      if (r?.kind !== 'tf' || r.outputKind !== 'voltage' || unusedSubcircuit(netlist, i)) continue;
      // The nodes as the parser reads them (a gnd ngspice makes 0 is ground: A3b), named as said.
      for (const n of r.outputNodes) {
        // Ground is always a node; a circuit with nothing on it gets ngspice's own message (M1).
        const info = netlist.nodes.get(n.name);
        const name = said(n.token.text);
        if (!n.ground && (!info || info.connections.length === 0)) push({ code: 'tf-node-missing', severity: 'warning', title: S.tfNodeTitle(name), why: S.tfNodeWhy(name), line: i + 1 });
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
  // A title that starts with a name keeps its capital: R1, RS, .tf, a name with a letter outside a to z
  // (Rş), and the two names of "Ru and Rµ are the same name for ngspice" (M4b, M4c).
  const lower = (s: string): string =>
    s && !/^[A-Z]{2}|^[A-Z]\d|^\.|^[A-Z]\S*[^\sa-z]|^\S+ and \S+ are the same name/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s;
  if (status === 'failed') return (ngspiceError ? S.summaryFailed : S.summaryEmpty)(firstProblem ? lower(firstProblem.title) : S.summaryNothing);
  if (status === 'unreliable') {
    const specific = words.warnings.find((m) => m.code !== 'unreliable');
    return S.summaryUnreliable(lower(specific?.title ?? S.unreliableTitle));
  }
  const parts: string[] = [];
  if (words.nodes.length) {
    // "node in is 6 volts": a node's name may be an ordinary word (W8, decision 0017).
    const shown = words.nodes.slice(0, 4).map((n) => (speech ? S.valueIsSpeech(S.node(said(n.name)), n.speech) : S.valueIs(S.node(said(n.name)), n.text)));
    parts.push(S.summaryNodes(shown.join(', '), words.nodes.length - shown.length));
  }
  if (words.currents.length) parts.push(S.summaryCurrents(words.currents.length));
  const tf = words.tf;
  if (tf?.transferFunction) parts.push(speech ? tf.transferFunction.speech : S.summaryTf(tf.transferFunction.text));
  if (tf?.inputResistance) parts.push(speech ? tf.inputResistance.speech : tf.inputResistance.text.replace(/ \(ngspice calls.*\)$/, ''));
  if (tf?.outputResistance) parts.push(speech ? tf.outputResistance.speech : tf.outputResistance.text.replace(/, the Thévenin.*$| \(ngspice calls.*\)$/, ''));
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

/** At most this many values are listed in a note; the rest are counted ("and 3991 more currents"), never "and 1 more" (N4). */
const NOTE_LIST = 4;

/** "a, b, c, d and 3991 more currents": a list of at most NOTE_LIST + 1 items, the rest counted by kind. */
function cappedList(items: readonly { text: string; kind: 'current' | 'voltage' | 'node' }[]): string {
  if (items.length <= NOTE_LIST + 1) return listWords(items.map((x) => x.text));
  const rest = items.slice(NOTE_LIST);
  const count = (kind: string): number => rest.filter((x) => x.kind === kind).length;
  return S.noiseMore(items.slice(0, NOTE_LIST).map((x) => x.text).join(', '), count('current'), count('voltage'), count('node'));
}

/**
 * The note for the currents and voltages said as 0 because ngspice gave rounding noise of a 0
 * (C9–C9p): what ngspice gave, and why the true value is 0. For one part, its own reason ("the two
 * ends of R5, node a and node b, are at the same voltage, 4.5 V"); for several, the kinds of reason.
 * Every reason is true of every value it names: for a circuit solved exactly, a plain reason is given
 * only where the exact solution shows it; the last sentence says how the 0 was found. Lists stop at
 * NOTE_LIST values: every value is in the Numbers panel's tables (N4).
 */
function noiseNote(netlist: Netlist, results: AnalysisResults, words: SummaryInput): MessageWords | undefined {
  const noise = noiseOf(netlist, results);
  const currents = words.currents.filter((c) => c.noise !== undefined);
  const nodes = words.nodes.filter((n) => n.noise !== undefined);
  if (!currents.length && !nodes.length) return undefined;
  const gave = cappedList([
    ...currents.map((c) => ({ text: S.noiseGaveCurrent(c.name, formatLikeNgspice(c.noise!)), kind: 'current' as const })),
    ...nodes.map((n) => ({ text: S.noiseGaveVoltage(said(n.name), formatLikeNgspice(n.noise!)), kind: 'voltage' as const })),
  ]);
  const volts = shownVoltages(netlist, results);
  const reasonFor = (c: CurrentWords): string => {
    const why = noise.currents.get(c.element)!;
    const el = partsOf(netlist).byKey.get(c.element)?.element;
    switch (why.kind) {
      case 'same':
        return S.noiseSame(c.name, said(why.a), said(why.b), formatSI(why.v ?? volts.get(why.a) ?? 0, 'V'));
      case 'copies':
        return S.noiseCopies(c.name, el?.value?.number ? formatNumber(el.value.number.value) : '?', why.control);
      case 'reads':
        return S.noiseReads(c.name, said(why.c), said(why.d));
      case 'node':
        return S.noiseNode(said(why.node));
      case 'exact':
        return '';
    }
  };
  const found = new Set(currents.map((c) => noise.currents.get(c.element)!.kind));
  const kinds = (['same', 'copies', 'reads', 'node'] as const).filter((k) => found.has(k));
  const reasons: string[] = [];
  if (currents.length === 1) {
    const reason = reasonFor(currents[0]!);
    if (reason) reasons.push(reason);
  } else if (kinds.length) reasons.push(S.noiseEach(kinds, found.has('exact')));
  const grounded = nodes.filter((n) => noise.grounded.has(n.node));
  if (grounded.length) reasons.push(S.noiseGround(cappedList(grounded.map((n) => ({ text: nodeIn(said(n.name)), kind: 'node' as const }))), grounded.length));
  const note: MessageWords = {
    code: 'rounding-noise',
    severity: 'note',
    title: S.noiseTitle(
      currents.map((c) => c.name),
      nodes.map((n) => said(n.name)),
    ),
    why: S.noiseWhy(gave, reasons.join('; and '), currents.length, nodes.length, noise.by === 'exact', noise.by === 'exact' && noise.diodes ? (noise.diodeWhy ?? { quiet: [], alike: [] }) : undefined),
  };
  if (currents.length === 1 && !nodes.length && currents[0]!.line !== undefined) note.line = currents[0]!.line;
  return note;
}

/**
 * The note for the currents and node voltages that ngspice's arithmetic rounded to exactly 0 though the
 * circuit makes them real (C9n): PlainSpice shows the exact values, and says why ngspice gave 0. For one
 * resistor whose two ends ngspice gave as the same number, that is its reason; for others a reason true
 * of every value it names. Lists stop at NOTE_LIST values, as the noise note's.
 */
function lostNote(netlist: Netlist, results: AnalysisResults, words: SummaryInput): MessageWords | undefined {
  const currents = words.currents.filter((c) => c.given !== undefined);
  const nodes = words.nodes.filter((n) => n.given !== undefined);
  if (!currents.length && !nodes.length) return undefined;
  const one = currents.length + nodes.length === 1;
  const items = (text: (name: string, value: number, unit: 'A' | 'V') => string): { text: string; kind: 'current' | 'voltage' }[] => [
    ...currents.map((c) => ({ text: text(c.name, c.value, 'A'), kind: 'current' as const })),
    ...nodes.map((n) => ({ text: text(nodeIn(said(n.name)), n.value, 'V'), kind: 'voltage' as const })),
  ];
  const gave = one
    ? currents.length ? S.lostGaveCurrent(currents[0]!.name) : S.lostGaveVoltage(said(nodes[0]!.name))
    : `exactly 0 for ${cappedList(items((name) => name))}`;
  let reason = S.lostAny(one);
  const el = one && currents.length ? partsOf(netlist).byKey.get(currents[0]!.element)?.element : undefined;
  const [p, n] = el?.nodes ?? [];
  const ohms = el?.letter === 'R' ? el.value?.number?.value : undefined;
  if (p && n && ohms !== undefined) {
    const volts = voltages(netlist, results);
    const [va, vb] = [volts.get(nodeName(p)), volts.get(nodeName(n))];
    if (va !== undefined && va === vb) reason = S.lostEnds(currents[0]!.name, formatSI(Math.abs(currents[0]!.value * ohms), 'V'), formatSI(va, 'V'), said(nodeName(p)), said(nodeName(n)));
  }
  // A current's size (its direction is on the drawing and in the tables), a node voltage with its sign.
  const size = (v: number, unit: 'A' | 'V'): string => formatSI(unit === 'A' ? Math.abs(v) : v, unit);
  const value = one ? (currents.length ? size(currents[0]!.value, 'A') : size(nodes[0]!.value, 'V')) : undefined;
  const shows =
    value === undefined
      ? cappedList(items((name, v, unit) => S.lostShows(name, size(v, unit))))
      : currents.length ? S.lostCarries(currents[0]!.name, value) : S.lostIsAt(said(nodes[0]!.name), value);
  const note: MessageWords = {
    code: 'rounded-to-0',
    severity: 'note',
    title: S.lostTitle(
      currents.map((c) => c.name),
      nodes.map((x) => said(x.name)),
    ),
    why: S.lostWhy(gave, reason, shows, value),
  };
  if (one && currents.length && currents[0]!.line !== undefined) note.line = currents[0]!.line;
  return note;
}

/**
 * The note for a circuit PlainSpice solves exactly whose answers ngspice gave farther from the exact ones
 * than the page's digits (opCheck 'imprecise'; the critic of round 2 of the re-check's fixes): the page
 * shows ngspice's numbers, and this says they are off, with the exact values of those farthest off (at
 * most NOTE_LIST of them when there are more than NOTE_LIST + 1): first the exact 0s ngspice gives as
 * numbers (node g6 at 0 V, where ngspice gives 2.097 V), node voltages before currents and the largest
 * first, then the others by how far they are from the exact value, as a share of it (a current ngspice
 * gives the other way, then one it gives as 0 A where a current flows). Node voltages, the currents of the
 * V, E, H and L, and those of the R, G and F that ngspice reports are named; with diodes, only those that
 * no diode's current changes (opCheck), and no warning when none of them is off.
 */
function offNote(netlist: Netlist, results: AnalysisResults): MessageWords | undefined {
  // A value whose exact and given numbers read the same at the page's digits is not off on the page: 5e-5 of a
  // value is within its last digit when its first digits are large (24.003 nA and 24 nA both read 24 nA).
  const unit = (a: Answer): 'V' | 'A' => (a.kind === 'voltage' ? 'V' : 'A');
  const off = noiseOf(netlist, results).off?.filter((a) => a.exact === 0 || formatSI(a.exact, unit(a)) !== formatSI(a.given, unit(a)));
  if (!off?.length) return undefined;
  const share = (a: Answer): number => (a.exact === 0 ? Number.POSITIVE_INFINITY : Math.abs(a.given - a.exact) / Math.abs(a.exact));
  // The exact 0s first, node voltages before currents (volts and amps are not compared), then by how far off.
  const list = [...off].sort((x, y) => share(y) - share(x) || (x.exact === 0 && x.kind !== y.kind ? (x.kind === 'voltage' ? -1 : 1) : 0) || Math.abs(y.given) - Math.abs(x.given));
  const items = list.map((a) => {
    if (a.kind === 'voltage') return S.offVoltage(said(shownNode(netlist, a.name)), formatSI(a.exact, 'V'), formatSI(a.given, 'V'));
    const name = partsOf(netlist).byKey.get(a.name)?.element?.name.text ?? a.name;
    if (a.exact === 0) return S.offNoCurrent(name, formatSI(Math.abs(a.given), 'A'));
    return S.offCurrent(name, formatSI(Math.abs(a.exact), 'A'), formatSI(Math.abs(a.given), 'A'), a.given !== 0 && Math.sign(a.given) !== Math.sign(a.exact));
  });
  const shown = items.length <= NOTE_LIST + 1 ? S.offList(items, 0) : S.offList(items.slice(0, NOTE_LIST), items.length - NOTE_LIST);
  return { code: 'imprecise-answers', severity: 'warning', title: S.offTitle, why: S.offWhy(shown) };
}

/** The note for a .tf ratio shown as 0 because ngspice gave rounding noise of a 0 (S8, C9p). */
function tfNoiseNote(netlist: Netlist, words: SummaryInput): MessageWords | undefined {
  const tf = words.tf;
  const noise = tf?.transferFunction?.noise;
  if (!tf || noise === undefined) return undefined;
  const line = netlist.analyses.find((i) => netlist.lines[i]?.directive?.name === '.tf');
  const r = line === undefined ? undefined : readAnalysis(netlist, line);
  const [n1, n2] = r?.kind === 'tf' ? r.outputNames : [];
  const output = r?.kind === 'tf' && r.outputKind === 'current' ? S.currentIn(n1 ?? tf.output) : n1 === undefined ? tf.output : n2 === undefined ? S.voltageOf(said(n1)) : S.voltageBetween(said(n1), said(n2));
  const m: MessageWords = {
    code: 'rounding-noise',
    severity: 'note',
    title: S.noiseTfTitle,
    why: S.noiseTfWhy(`${tf.output}/${tf.input}`, formatLikeNgspice(noise), output, tf.input, tf.ratio),
  };
  if (line !== undefined) m.line = line + 1;
  return m;
}

/** A point of a sweep in a note: "V1 = 3 V", or "50 °C" in a sweep of the temperature (as the sweep's words say it). */
function sweepPoint(noise: SweepNoise, dc: Sweep, k: number): string {
  if (noise.name) return noise.name(k);
  const value = formatSI(dc.scale.values[k]!, dc.scale.unit);
  return noise.temperature ? value : S.sweepAt(noise.source, value);
}

/** The note for the points of a .dc sweep shown as 0 because ngspice gave rounding noise of a 0 (S8, C9p). */
function sweepNoiseNote(netlist: Netlist, results: AnalysisResults): MessageWords | undefined {
  const noise = results.dc ? decidedSweep(netlist, results) : undefined;
  if (!results.dc || !noise?.zero.size) return undefined;
  const dc = results.dc;
  const names: string[] = [];
  // Only the points the note names are put in words: a series can be noise at each of 99,999 points.
  const gave: string[] = [];
  let count = 0;
  for (const [j, marked] of noise.zero) {
    const s = dc.series[j]!;
    const points = noisePoints(marked, s.values, NOTE_LIST + 1 - gave.length);
    if (!points.count) continue;
    const name = netlistVector(netlist, s.name);
    names.push(name);
    count += points.count;
    for (const k of points.first) gave.push(S.noiseSweepGave(name, formatLikeNgspice(s.values[k]!), s.unit, sweepPoint(noise, dc, k)));
  }
  if (!count) return undefined;
  const list = count <= NOTE_LIST + 1 ? listWords(gave) : S.noiseSweepMore(gave.slice(0, NOTE_LIST).join(', '), count - NOTE_LIST);
  const line = netlist.analyses.find((i) => netlist.lines[i]?.directive?.name === '.dc');
  const m: MessageWords = { code: 'rounding-noise', severity: 'note', title: S.noiseSweepTitle(names, 'DC sweep'), why: S.noiseSweepWhy(list, count === 1, noise.diodes ? (noise.diodeWhy ?? { quiet: [], alike: [] }) : undefined) };
  if (line !== undefined) m.line = line + 1;
  return m;
}

/**
 * The note for the points of a .dc sweep where ngspice gave exactly 0 though the circuit makes the value
 * real, shown exactly (C9n at a sweep's points; the critic of round 2 of the re-check's fixes). Only the
 * points it names are put in words.
 */
function sweepLostNote(netlist: Netlist, results: AnalysisResults): MessageWords | undefined {
  const noise = results.dc ? decidedSweep(netlist, results) : undefined;
  if (!results.dc || !noise?.lost.size) return undefined;
  const dc = results.dc;
  const names: string[] = [];
  const gave: string[] = [];
  const shows: string[] = [];
  let count = 0;
  for (const [j, { points, values }] of noise.lost) {
    const s = dc.series[j]!;
    const name = netlistVector(netlist, s.name);
    names.push(name);
    count += points.length;
    for (let i = 0; i < points.length && gave.length <= NOTE_LIST; i++) {
      const at = sweepPoint(noise, dc, points[i]!);
      gave.push(S.lostSweepGave(name, at));
      shows.push(S.lostSweepShows(name, formatSI(values[i]!, s.unit), at));
    }
  }
  const list = (items: string[]): string => (count <= NOTE_LIST + 1 ? listWords(items) : S.noiseSweepMore(items.slice(0, NOTE_LIST).join(', '), count - NOTE_LIST));
  const line = netlist.analyses.find((i) => netlist.lines[i]?.directive?.name === '.dc');
  const m: MessageWords = { code: 'rounded-to-0', severity: 'note', title: S.lostSweepTitle(names, 'DC sweep'), why: S.lostSweepWhy(list(gave), list(shows), count === 1) };
  if (line !== undefined) m.line = line + 1;
  return m;
}

/**
 * The note for a sweep too large to look through for rounding noise (SWEEP_VALUES), in a circuit whose sweep
 * PlainSpice would otherwise decide exactly: it is shown as ngspice gives it, but at its points at the .op's own
 * state, which show what the .op shows (opStateSweep).
 */
function sweepSizeNote(netlist: Netlist, results: AnalysisResults): MessageWords | undefined {
  const dc = results.dc;
  const ex = dc && sweepTooLarge(dc) ? exactOf(netlist) : undefined;
  if (!dc || !ex?.sweep || (results.op && noiseOf(netlist, results).by !== 'exact')) return undefined;
  const noise = decidedSweep(netlist, results);
  const points = results.op && noise ? (opStatePoints(netlist, results, ex)?.points ?? []) : [];
  const at = noise && points.length ? listWords(points.slice(0, NOTE_LIST).map((k) => sweepPoint(noise, dc, k))) : undefined;
  const line = netlist.analyses.find((i) => netlist.lines[i]?.directive?.name === '.dc');
  const m: MessageWords = { code: 'sweep-not-checked', severity: 'note', title: S.sweepLargeTitle('DC sweep'), why: S.sweepLargeWhy(dc.scale.values.length, dc.series.length, SWEEP_VALUES, at) };
  if (line !== undefined) m.line = line + 1;
  return m;
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
  // C9–C9e: what ngspice gave for each current and voltage said as 0, last, as a note (it is no
  // problem). Only with numbers that are answers: a failed or untrusted run is summed up by its first message.
  const note = status === 'ok' ? noiseNote(netlist, results, words) : undefined;
  if (note) words.warnings.push(note);
  // C9n: the real values ngspice's arithmetic rounded to 0, shown exactly.
  const lost = status === 'ok' ? lostNote(netlist, results, words) : undefined;
  if (lost) words.warnings.push(lost);
  // ngspice's answers farther from the exact ones than the page's digits: shown as ngspice gives them, with a warning.
  const off = status === 'ok' ? offNote(netlist, results) : undefined;
  if (off) words.warnings.push(off);
  // S8, C9p: the same for a .tf ratio and for the points of a .dc sweep.
  for (const extra of status === 'ok' ? [tfNoiseNote(netlist, words), sweepNoiseNote(netlist, results), sweepLostNote(netlist, results), sweepSizeNote(netlist, results)] : []) if (extra) words.warnings.push(extra);
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
  const volts = shownVoltages(netlist, results);
  const byKey = new Map(currentsOf(netlist, results).map((c) => [c.element, c]));
  const out: LineAnnotation[] = [];
  for (const line of partsOf(netlist).lines) {
    const el = line.element!;
    // P15, P15b: an R, C or L line with nothing after its nodes is left out of the circuit, so it gets no note.
    if (!isBuilt(el)) continue;
    const c = byKey.get(el.key);
    if (c) {
      out.push(sourceOrPartNote(line, el, c, (key) => shownNode(netlist, key)));
      continue;
    }
    const [p, n] = el.nodes;
    if (!p || !n || !el.letter || el.letter === 'K') continue;
    const vp = volts.get(nodeName(p));
    const vn = volts.get(nodeName(n));
    if (vp === undefined || vn === undefined) continue;
    const across = sameLevel(noiseOf(netlist, results), nodeName(p), nodeName(n)) ? 0 : vp - vn;
    out.push({ line: line.number, text: S.noteAcross(formatSI(across, 'V')), speech: S.noteAcrossSpeech(speakSI(across, 'V'), el.name.text) });
  }
  return out;
}

/** `shown`: a node's key as the results' words name it (S7). */
function sourceOrPartNote(line: NetlistLine, el: Element, c: CurrentWords, shown: (key: string) => string): LineAnnotation {
  const a = formatSI(Math.abs(c.value), 'A');
  const as = speakSI(Math.abs(c.value), 'A');
  const [from, to] = [shown(c.from), shown(c.to)];
  if (c.ammeter) {
    return {
      line: line.number,
      text: c.value === 0 ? S.noteNoCurrent : S.noteAmps(a, bare(from), bare(to)),
      speech: c.value === 0 ? S.measuresNothing(c.name) : S.noteMeasures(as, said(from), said(to)),
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
  const base = S.noteAmps(a, bare(from), bare(to));
  const baseSpeech = S.noteAmpsSpeech(as, flows(as), said(from), said(to));
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

/**
 * Whether ngspice 47's 'Bad syntax!' on a .dc line is its step: missing or 0 in a sweep whose other
 * numbers read. A word that is no number where a number goes (−5 with a minus sign from a document,
 * V1 again) stops it too, and then the step is not the problem. Read by place, as checkDc does: where
 * the step goes, a part's name or temp starts the next sweep, so that sweep has no step.
 */
function dcStepIsTheProblem(netlist: Netlist, line: number | undefined): boolean {
  const reading = line === undefined ? undefined : readAnalysis(netlist, line - 1);
  if (reading?.kind !== 'dc') return true;
  // A word in braces or quotes is a number numparam works out (dc-sweep-problems-17; re-check critic CR1-4):
  // a step written so can only be the problem when it comes to 0.
  let expressionStep = false;
  for (const s of reading.sweeps) {
    if (!s.start || !s.stop) return false;
    if ((s.startValue === undefined && !isExpression(s.start)) || (s.stopValue === undefined && !isExpression(s.stop))) return false;
    if (s.step && s.stepValue === undefined && !isExpression(s.step)) return lowerAscii(s.step.text) === 'temp' || partNamed(netlist, s.step.text) !== undefined;
    if (!s.step || s.stepValue === 0) return true;
    if (isExpression(s.step)) expressionStep = true;
  }
  return expressionStep;
}

/** Whether the .tran line (1-based) has a word where the stop time goes, uic aside. */
function tranHasStop(netlist: Netlist, line: number | undefined): boolean {
  const d = line === undefined ? undefined : netlist.lines[line - 1]?.directive;
  return d?.name === '.tran' && d.args.filter((t) => lowerAscii(t.text) !== 'uic').length >= 2;
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
  // ngspice points at the node in its own spelling ("__iki__" for ÇIKIŞ, "ou___t": W16, M2d): its key finds
  // it, and the words name it as the results' words do, as first written, the character named (S7, S11).
  const key = netlistNode(netlist, subject);
  const node = netlist.nodes.get(key);
  const shown = shownNode(netlist, key);
  // M9: an E or G line with fewer than four nodes leaves a node with no single answer in our engine.
  // A missing gain is read as 0 without a singular matrix (missing-value-4, -5), so only too few nodes count.
  const short = node?.connections.map((c) => partsOf(netlist).byKey.get(c.element)).find((l) => (l?.element?.letter === 'E' || l?.element?.letter === 'G') && l.element.nodes.length < 4);
  if (short?.element) return { title: S.shortLineTitle(short.element.name.text), why: S.shortLineWhy(short.element.name.text), line: short.number };
  if (node && node.connections.length > 0) {
    const letters = node.connections.map((c) => partsOf(netlist).byKey.get(c.element)?.element?.letter);
    if (letters.every((l) => l === 'C' || l === 'I')) {
      const what = letters.every((l) => l === 'C') ? S.onlyCapacitors : letters.every((l) => l === 'I') ? S.onlyCurrentSources : S.capacitorsAndCurrentSources;
      return { title: S.capNodeTitle(shown), why: S.capNodeWhy(shown, what) }; // M2, M2b, M2d
    }
    // A node whose parts lead nowhere else: every part on it has its other end on nodes with nothing more (M2c).
    const isolated = node.connections.every((c) => {
      const el = partsOf(netlist).byKey.get(c.element)?.element;
      return el !== undefined && el.nodes.every((r) => !r.ground && (netlist.nodes.get(r.name)?.connections.length ?? 0) <= 1);
    });
    if (isolated) return { title: S.floatingTitle(shown), why: S.floatingWhy(shown) };
  }
  return { title: S.singularTitle(shown), why: S.singularWhy(shown) };
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
      // M4, W7. ngspice compares names as it spells them (W18, W15), so the earlier part is found the same
      // way: Rç's is Rş, both r__ (M4b), and Ru's is Rµ, both ru (M4c). Names that differ by more than
      // capital letters get the reason that makes them one, as the duplicate-name check gives it (S9).
      const here = netlist.lines[(d.line ?? 0) - 1]?.element;
      const spelled = here ? ngspiceSpelling(here.key) : '';
      const first = here ? partsOf(netlist).lines.find((l) => ngspiceSpelling(l.element!.key) === spelled) : undefined;
      if (here && first && first.number !== d.line && lowerAscii(first.element!.name.text) !== lowerAscii(here.name.text)) {
        const names = [first.element!.name.text, here.name.text];
        const micro = names.some((n) => n.includes('\u00b5'));
        const others = names.some((n) => [...n].some((ch) => ch.codePointAt(0)! >= 0x80 && ch !== '\u00b5'));
        const rule = micro && others ? S.bothRules : micro ? S.microRule : S.underscoresRule;
        return withLine({ title: S.duplicateSpelledTitle(names[0]!, names[1]!), why: S.duplicateSpelledWhy(rule, names[1]!, names[0]!, first.number, spelled) });
      }
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
      // M13, M13b: on a .dc line, the step only when it is missing or 0 (dc-sweep-problems-1, -2); a word that is
      // no number where one goes says 'Bad syntax!' too (dc-sweep-problems-9, -10; re-check S5).
      const isDc = /^\s*\.dc\b/i.test(lineText(netlist, d.line)) && dcStepIsTheProblem(netlist, d.line);
      return withLine(isDc ? { title: S.badSyntaxDcTitle, why: S.badSyntaxDcWhy } : { title: S.badSyntaxTitle, why: S.badSyntaxWhy });
    }
    case 'bad-tran-arguments': {
      const which = (d.subject ?? '').toUpperCase();
      const at = d.line ?? dotLine(netlist, '.tran');
      // With a word where the stop time goes, "TSTOP is invalid" means a stop of 0 or less, not one number
      // (tran-problems-8, -9, invisible-character-29; re-check critic CR1-13).
      const stop = tranHasStop(netlist, at) ? { title: S.tstopZeroTitle, why: S.tstopZeroWhy } : { title: S.tstopTitle, why: S.tstopWhy };
      const w = which === 'TSTEP' ? { title: S.tstepTitle, why: S.tstepWhy } : which === 'TSTART' ? { title: S.tstartTitle, why: S.tstartWhy } : stop;
      return withLine(w, at); // M14, M15, M15b
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
