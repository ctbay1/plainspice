/**
 * The circuit a drawing shows, read from a parsed netlist (src/spice/parse.ts): its parts, its nodes,
 * what controls each dependent source, the lines it cannot draw, and the dot lines. Plain
 * TypeScript: no DOM.
 *
 * - Parts: R, C, L, V, I, E, F, G and H outside subcircuit definitions, in netlist order, each with
 *   its name as written, its two output nodes (pin 0 = the first node), its value as written and
 *   what controls it (E and G: the voltage between two nodes; F and H: the current in a named
 *   voltage source). Node names are ngspice's (lower-case ASCII); ground is "0", which includes
 *   "gnd" except where the parser says ngspice keeps it as an ordinary node (W8–W12).
 * - Not drawn: every other part line, each with its line and the reason, so the UI can list it:
 *   other kinds of part (X, B, K, D, Q, M, switches, lines ...), an E, F, G or H given by a formula, a
 *   table or a polynomial (VALUE=, TABLE, POLY: C3-5), lines inside .subckt ... .ends,
 *   parts after .end that ngspice still reads (S25), a second line with the same name (ngspice
 *   stops there, "device already exists"), and lines with fewer than two nodes.
 * - Hidden connections: a node that a line not drawn also names (a diode, a subcircuit, a part after
 *   .end ...) is not open, even when the drawing shows one pin on it: `CircuitNode.hidden` lists those
 *   lines, so the scene marks the node instead of drawing an open end (lines inside a subcircuit have
 *   their own nodes and do not count).
 * - Couplings and sensing: the K lines that couple a drawn inductor (P21), and the F and H parts that
 *   read the current in a drawn source, so a style can show them.
 * - Dot lines are listed separately (analyses flagged), so the UI can show them next to the drawing.
 */
import { readAfterEnd } from '../spice/explain.ts';
import { isBuilt } from '../spice/graph.ts';
import { readNumber } from '../spice/numbers.ts';
import { lowerAscii, parseNetlist } from '../spice/parse.ts';
import type { Element, ElementLetter, Netlist, NetlistLine } from '../spice/types.ts';
import { isPartLetter, type PartLetter } from './symbols.ts';

/** E and G: the voltage between two nodes ('' when the line leaves a node out). */
export interface VoltageControl {
  kind: 'voltage';
  plus: string;
  minus: string;
  /** As written. */
  plusText: string;
  minusText: string;
}

/** F and H: the current in a voltage source ('' when the line leaves it out). */
export interface CurrentControl {
  kind: 'current';
  /** Lower-case name of the source. */
  source: string;
  /** As written. */
  sourceText: string;
}

export type PartControl = VoltageControl | CurrentControl;

export interface CircuitPart {
  /** Lower-case name: ngspice treats R1 and r1 as one part. */
  key: string;
  /** As written. */
  name: string;
  letter: PartLetter;
  /** Index of its line in Netlist.lines (0-based). */
  line: number;
  /** ngspice's names of the nodes at pin 0 and pin 1 (lower-case; ground is "0"). */
  nodes: readonly [string, string];
  /** The same nodes as written. */
  nodeText: readonly [string, string];
  /** The main value as written: resistance, voltage, gain ...; '' when the line has none. */
  valueText: string;
  /** The number ngspice reads from it, when it reads one. */
  value?: number;
  /** A V or I source's PULSE(...), SIN(...), PWL(...) ... as written. */
  sourceFunction?: string;
  /** The same function: its name (lower-case) and its arguments as written. */
  fn?: { name: string; args: string[] };
  /** A V or I source's AC value as written, keyword first: "AC 1", "AC 1 90". */
  ac?: string;
  control?: PartControl;
  /** An inductor: the K lines that couple it, with the other inductor's name as written (P21). */
  coupled: { by: string; with: string; line: number }[];
  /** A source whose current an F or H reads: those parts' keys, in netlist order. */
  sensedBy: string[];
  /** False when ngspice leaves the line out of the circuit (an R, C or L with nothing after its nodes, P15). */
  built: boolean;
}

export interface PinRef {
  /** Part key. */
  part: string;
  pin: 0 | 1;
}

/** A line the drawing does not show that names a node: the node continues there. */
export interface HiddenRef {
  /** The part's name as written. */
  name: string;
  /** Index in Netlist.lines (0-based). */
  line: number;
  /** 1-based line number. */
  lineNumber: number;
}

export interface CircuitNode {
  /** ngspice's name (lower-case); "0" is ground. */
  name: string;
  /** As first written ("0" for ground). */
  text: string;
  ground: boolean;
  /** The drawn pins on this node, in netlist order. */
  pins: PinRef[];
  /** Lines not drawn that connect to this node too (never empty for a node that only they name: such nodes are not listed). */
  hidden: HiddenRef[];
}

export type NotDrawnReason = 'part-kind' | 'in-subcircuit' | 'after-end' | 'duplicate-name' | 'missing-nodes';

export interface NotDrawnLine {
  /** Index in Netlist.lines (0-based). */
  line: number;
  /** 1-based line number. */
  lineNumber: number;
  /** The part's name as written. */
  name: string;
  letter?: ElementLetter;
  reason: NotDrawnReason;
  /** The line as written. */
  text: string;
  /** Its nodes (ngspice's names), for saying where it would be. */
  nodes: string[];
}

export interface DotLine {
  line: number;
  lineNumber: number;
  /** Lower-case, with the dot: ".op", ".tf", ".end" ... */
  name: string;
  text: string;
  analysis: boolean;
}

export interface Circuit {
  netlist: Netlist;
  /** The drawn parts, in netlist order. */
  parts: CircuitPart[];
  /** Nodes with at least one drawn pin, in order of first appearance. */
  nodes: Map<string, CircuitNode>;
  /** Some drawn part touches ground. */
  hasGround: boolean;
  notDrawn: NotDrawnLine[];
  dotLines: DotLine[];
}

export const GROUND = '0';

/** The text of a source function as written: from its name to its closing parenthesis. */
function functionText(netlist: Netlist, el: Element): string | undefined {
  const fn = el.sourceFunction;
  if (!fn) return undefined;
  const last = fn.args[fn.args.length - 1] ?? fn.token;
  let end = last.to;
  const rest = netlist.text.slice(end, end + 8);
  const close = /^\s*\)/.exec(rest);
  if (close) end += close[0].length;
  return netlist.text.slice(fn.token.from, end).replace(/\s+/g, ' ');
}

/** "AC 1" or "AC 1 90": the AC keyword of a V or I line and the numbers after it, as written. */
function acText(el: Element): string | undefined {
  const i = el.fields.findIndex((f) => f.role === 'source-function' && lowerAscii(f.token.text) === 'ac');
  if (i < 0) return undefined;
  const words = ['AC'];
  for (const f of el.fields.slice(i + 1, i + 3)) {
    if (f.role !== 'source-function' || readNumber(f.token.text) === undefined) break;
    words.push(f.token.text);
  }
  return words.join(' ');
}

/**
 * A plain name where a part's value goes (V1 a 0 Vs): with .param Vs=5, ngspice uses that value
 * (unknown-word-22), so the part shows the name, as it shows {Vs}, and a source written so is no 0 V
 * meter. Without a .param line the checks flag it (unknown-word-16). A word with other characters
 * stays unshown ('?'): the checks name what is wrong with it.
 */
function nameAsValue(el: Element): string | undefined {
  const k = el.fields.findIndex((f) => f.role === 'other');
  const f = el.fields[k];
  if (!f || el.fields.slice(0, k).some((x) => x.role === 'parameter' || x.role === 'source-function' || x.role === 'model')) return undefined;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(f.token.text) ? f.token.text : undefined;
}

function partOf(netlist: Netlist, line: NetlistLine, el: Element, letter: PartLetter): CircuitPart {
  const [a, b, c, d] = el.nodes;
  const part: CircuitPart = {
    key: el.key,
    name: el.name.text,
    letter,
    line: line.index,
    nodes: [a!.name, b!.name],
    nodeText: [a!.token.text, b!.token.text],
    valueText: el.value?.token.text ?? nameAsValue(el) ?? '',
    built: isBuilt(el),
    coupled: [],
    sensedBy: [],
  };
  const v = el.value?.number?.value;
  if (v !== undefined) part.value = v;
  const fn = functionText(netlist, el);
  if (fn) part.sourceFunction = fn;
  if (el.sourceFunction) part.fn = { name: el.sourceFunction.name, args: el.sourceFunction.args.map((a) => a.text) };
  const ac = acText(el);
  if (ac) part.ac = ac;
  if (letter === 'E' || letter === 'G') {
    part.control = { kind: 'voltage', plus: c?.name ?? '', minus: d?.name ?? '', plusText: c?.token.text ?? '', minusText: d?.token.text ?? '' };
  } else if (letter === 'F' || letter === 'H') {
    const src = el.controlSource;
    part.control = { kind: 'current', source: src ? lowerAscii(src.text) : '', sourceText: src?.text ?? '' };
  }
  return part;
}

/** Reads the circuit a drawing shows from a parsed netlist. Never throws. */
export function circuitFromNetlist(netlist: Netlist): Circuit {
  const parts: CircuitPart[] = [];
  const notDrawn: NotDrawnLine[] = [];
  const seen = new Set<string>();
  let depth = 0;
  const skip = (line: NetlistLine, el: Element, reason: NotDrawnReason): void => {
    const entry: NotDrawnLine = {
      line: line.index,
      lineNumber: line.number,
      name: el.name.text,
      reason,
      text: line.text.trim(),
      nodes: el.nodes.map((n) => n.name),
    };
    if (el.letter) entry.letter = el.letter;
    notDrawn.push(entry);
  };
  for (const line of netlist.lines) {
    const dname = line.directive?.name;
    if (dname === '.subckt' || dname === '.macro') depth += 1;
    else if (dname === '.ends' || dname === '.eom') depth = Math.max(0, depth - 1);
    const el = line.element;
    if (!el) continue;
    if (depth > 0) {
      skip(line, el, 'in-subcircuit');
      continue;
    }
    if (seen.has(el.key)) {
      skip(line, el, 'duplicate-name');
      continue;
    }
    seen.add(el.key);
    const letter = el.letter;
    // A dependent source given by a formula, a table or a polynomial (E1 e 0 VALUE={...}, C3-5) has no
    // control nodes and gain to draw: listed with the lines not drawn, as a B line is.
    if (!isPartLetter(letter) || el.form) {
      skip(line, el, 'part-kind');
      continue;
    }
    if (el.nodes.length < 2) {
      skip(line, el, 'missing-nodes');
      continue;
    }
    parts.push(partOf(netlist, line, el, letter));
  }
  // S25, S26: ngspice still reads the part lines after a plain .end (the parser gives them no
  // element, so each is read on its own, as describe.ts does). They are not drawn: the checks
  // ask for them to be moved above .end.
  for (const line of readAfterEnd(netlist)) {
    const el = parseNetlist(`*\n${line.text}`).lines[1]?.element;
    if (el) skip(line, el, 'after-end');
  }

  const nodes = new Map<string, CircuitNode>();
  for (const p of parts) {
    p.nodes.forEach((name, i) => {
      let n = nodes.get(name);
      if (!n) {
        n = { name, text: name === GROUND ? GROUND : p.nodeText[i]!, ground: name === GROUND, pins: [], hidden: [] };
        nodes.set(name, n);
      }
      n.pins.push({ part: p.key, pin: i as 0 | 1 });
    });
  }
  // The lines not drawn that connect to drawn nodes (a subcircuit's own lines have their own nodes).
  for (const n of notDrawn) {
    if (n.reason === 'in-subcircuit') continue;
    for (const name of new Set(n.nodes)) {
      const node = nodes.get(name);
      if (node) node.hidden.push({ name: n.name, line: n.line, lineNumber: n.lineNumber });
    }
  }
  // K lines coupling drawn inductors (P21), and the F and H parts reading a drawn source's current.
  const byKey = new Map(parts.map((p) => [p.key, p]));
  for (const n of notDrawn) {
    if (n.letter !== 'K' || n.reason !== 'part-kind') continue;
    const el = netlist.lines[n.line]?.element;
    const named = (el?.fields ?? []).filter((f) => f.role === 'other').map((f) => f.token.text);
    if (named.length !== 2) continue;
    const [a, b] = named as [string, string];
    byKey.get(lowerAscii(a))?.coupled.push({ by: n.name, with: b, line: n.lineNumber });
    byKey.get(lowerAscii(b))?.coupled.push({ by: n.name, with: a, line: n.lineNumber });
  }
  for (const p of parts) {
    if (p.control?.kind !== 'current' || !p.control.source) continue;
    byKey.get(p.control.source)?.sensedBy.push(p.key);
  }

  const analyses = new Set(netlist.analyses);
  const dotLines: DotLine[] = netlist.directives.map((i) => {
    const line = netlist.lines[i]!;
    return { line: i, lineNumber: line.number, name: line.directive!.name, text: line.text.trim(), analysis: analyses.has(i) };
  });
  return { netlist, parts, nodes, hasGround: nodes.has(GROUND), notDrawn, dotLines };
}

/** The part with this key (lower-case name), if the drawing shows it. */
export function partByKey(circuit: Circuit, key: string): CircuitPart | undefined {
  return circuit.parts.find((p) => p.key === key);
}

/** How a node is written on the drawing: as first written in the netlist; ground is "0". */
export function nodeText(circuit: Circuit, name: string): string {
  return circuit.nodes.get(name)?.text ?? name;
}

/**
 * The circuit of some of its parts (by key): the same netlist, those parts, and the nodes they touch
 * (their pins only). Used to lay out a group of parts on its own.
 */
export function subCircuit(circuit: Circuit, keys: ReadonlySet<string>): Circuit {
  const parts = circuit.parts.filter((p) => keys.has(p.key));
  const nodes = new Map<string, CircuitNode>();
  for (const p of parts) {
    p.nodes.forEach((name, i) => {
      let n = nodes.get(name);
      if (!n) {
        n = { name, text: circuit.nodes.get(name)?.text ?? name, ground: name === GROUND, pins: [], hidden: [] };
        nodes.set(name, n);
      }
      n.pins.push({ part: p.key, pin: i as 0 | 1 });
    });
  }
  return { netlist: circuit.netlist, parts, nodes, hasGround: nodes.has(GROUND), notDrawn: [], dotLines: [] };
}

/**
 * The node a name in the drawing means: "gnd" is ground (node 0), except where the netlist has an
 * ordinary node called gnd (gnd as the last word of a line, fact W9), which keeps its own name.
 */
export function labelNode(circuit: Circuit, name: string): string {
  const n = lowerAscii(name);
  return n === 'gnd' && !circuit.nodes.has('gnd') ? GROUND : n;
}
