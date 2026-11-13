/**
 * Beginner trap checks: mistakes ngspice reads differently from what the student meant, or stops
 * on, found before running. Each trap says what ngspice really does, why in plain words, and offers
 * one-click fixes (text changes in netlist offsets). Plain TypeScript: no UI framework, no DOM.
 *
 * Every claim in a trap's `ngspice` text was checked by running native ngspice 47, native ngspice
 * 42 and our WebAssembly engine on a small netlist: docs/spice-facts/traps.md (the claim IDs in
 * brackets below, e.g. [mega-as-milli-1], name its sections), asserted on every golden run by
 * tests/golden/facts-traps.test.ts. Where our engine differs from native ngspice 47 (it is built
 * without XSPICE, OSDI and some device models), the text says both.
 *
 * Choices that keep the checks quiet on correct circuits (the channel's episode netlists are a
 * test): a lower-case m on a resistor is not flagged (the channel teaches m = milli); a node with
 * one connection is only an info note unless another node name looks like a typo of it, and not
 * even that when a directive names the node (an open terminal you measure); voltage loops through
 * an inductor and capacitor-only nodes are fine when every analysis is `.tran ... uic` (ngspice then
 * skips the DC operating point).
 */
import { formatNumber, formatSI, speakSI } from '../format/si.ts';
import {
  cleanWord,
  describeCharacter,
  hasInvisible,
  hasSpaceLike,
  INVISIBLE,
  isPlainName,
  lookAlikeName,
  lookAlikeOf,
  nameOfCharacter,
  plainLetters,
  SPACE_LIKE,
  spacedValue,
  withoutInvisible,
  withoutSpaces,
  withSpaces,
  zeroForLetterO,
} from './characters.ts';
import { isKnownDotCommand, nodeNameInWords, oddCharacters, plainForms, readAfterEnd, unusedSubcircuit } from './explain.ts';
import { buildGraph, behaviouralKind, hasReadableCurrent, type CircuitGraph, type DcGroup, type VoltageLoop } from './graph.ts';
import { nameSaysNode } from './node-words.ts';
import { formatSpiceNumber, readNumber } from './numbers.ts';
import { isReportOnlyParameter, lowerAscii, ngspiceName, ngspiceSpelling, parseNetlist } from './parse.ts';
import { hasSaveCurrents } from './run-netlist.ts';
import type {
  Element,
  ElementLetter,
  Field,
  FieldRole,
  Fix,
  Netlist,
  NetlistLine,
  NodeInfo,
  NumberReading,
  Span,
  TextChange,
  Token,
  Trap,
  TrapSeverity,
} from './types.ts';

/** Every trap id, in the order docs/spice-facts/traps.md describes them. */
export const TRAP_IDS = [
  'mega-as-milli',
  'unit-letter',
  'greek-mu',
  'rkm-notation',
  'decimal-comma',
  'sign-in-value',
  'space-before-suffix',
  'midline-comment',
  'nbsp',
  'missing-value',
  'missing-fields',
  'control-source',
  'missing-title',
  'no-ground',
  'ground-misnamed',
  'dangling-node',
  'floating-dc',
  'current-source-no-path',
  'voltage-loop',
  'duplicate-name',
  'unknown-letter',
  'missing-model',
  'missing-subcircuit',
  'model-not-in-engine',
  'dc-sweep-problems',
  'tran-problems',
  'tf-problems',
  'no-analysis',
  'missing-end',
  'after-end',
  'zero-ohm',
  'fatal-syntax',
  'include-not-available',
  'lost-continuation',
  'unknown-word',
  'unknown-dot-command',
  'non-ascii-node',
  'invisible-character',
  'look-alike-letter',
  'space-character',
] as const;

export type TrapId = (typeof TRAP_IDS)[number];

/** Applies a fix's changes to the text they were computed on (positions refer to that text). */
export function applyFix(text: string, fix: Fix): string {
  let out = text;
  for (const c of [...fix.changes].sort((a, b) => b.from - a.from || b.to - a.to)) {
    out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  }
  return out;
}

// ------------------------------------------------------------------ context

interface ModelCard {
  name: string;
  /** Model type, lower-case: "d", "npn", "nmos", "ltra", ... */
  type: string;
  /** The level, found the way ngspice's INPfindLev finds it (1 when none). */
  level: number;
  line: number;
  token: Token;
}

interface Ctx {
  n: Netlist;
  text: string;
  graph: CircuitGraph;
  traps: Trap[];
  /** Element lines outside subcircuits, whether or not ngspice builds them. */
  top: number[];
  models: Map<string, ModelCard>;
  subckts: Set<string>;
  /** Names an expression in braces can use: .param, .func, and a subcircuit's own parameters, lower-case. */
  params: Set<string>;
  /**
   * Names of .param lines outside subcircuits, after .end too, lower-case: the names ngspice also reads
   * as a part's value at the top level (unknown-word-22, -36, -37; not a subcircuit's own, a .func's:
   * unknown-word-33 to -35).
   */
  topParams: Set<string>;
  /**
   * Names params has from inside a subcircuit (its .subckt line or a .param line in it), lower-case, to the
   * subcircuit's name as written, and the names of .func lines: why such a name is no value outside it.
   */
  innerParams: Map<string, string>;
  funcs: Set<string>;
  /** Lower-case name of each element outside subcircuits, to its first line. */
  byKey: Map<string, number>;
  /** Every element name in use (subcircuits included), lower-case: new names must avoid them. */
  names: Set<string>;
  /** Some analysis needs the DC operating point (anything but `.tran ... uic`), or there is none. */
  opNeeded: boolean;
  hasControl: boolean;
  /** A line starting with '@' (ngspice stops reading there). */
  atLine?: number;
  /**
   * Parts ngspice can't read as written (a missing node, an unknown letter, a missing model...).
   * Their nodes are often misread (a value taken for a node), so the circuit checks leave them out.
   */
  broken: Set<number>;
  /** Lines of the parts ngspice builds outside subcircuits (CircuitGraph.elements). */
  built: Set<number>;
  /** For a line with continuation lines, the index of its last continuation line. */
  lastContinuation: Map<number, number>;
  /** A dot command ngspice does not know looks like a misspelt analysis (".tarn"). */
  analysisTypo?: boolean;
  /** Keys of the traps found so far ("id|from|to"), so a trap is never added twice. */
  seen: Set<string>;
  /** Traps found so far, by 1-based line. */
  byLine: Map<number, Trap[]>;
  /** For freshName: the next number to try after each stem (lower-case). */
  nextNumber: Map<string, number>;
  /** Value words with a character that looks like a space, by offset, that checkSpaceInValue read: checkSpaces leaves them alone. */
  spaced: Set<number>;
  /** The characters that look like a space inside node names checkSpaceNodes explains, by offset (a name inside {v(…)} too): checkSpaces leaves them alone. */
  spacedChars: Set<number>;
  /** The drawing's `*@ label` lines, by the node they name as ngspice reads it, with the name as written (lower-case), read on the first rename (labelChanges). */
  labels?: Map<string, { span: Span; form: string }[]>;
  /** The node names on the commands for ngspice (.control, *#, ##), by node, read on the first use (controlNodes). */
  controlNodes?: Map<string, CommandRef[]>;
  /** Every word ngspice reads as a node's name, by node, read on the first rename (referencesOf). */
  references?: Map<string, Token[]>;
  /** The words with a character outside printable ASCII on the lines ngspice reads, by name as ngspice reads it, read on the first rename (namedElsewhere). */
  oddWords?: Map<string, Token[]>;
  /** The commands for ngspice save only names ngspice does not find, read on the first use (savesNothing). */
  savesNothing?: boolean;
  /** The .print and .plot cards as ngspice -b reads them, read on the first use (printCards). */
  printCards?: PrintCard[];
  /** The node names on those lines, by node, read on the first use (printNodes). */
  printNodes?: Map<string, PrintRef[]>;
  /** ngspice -b would save nothing but names it can't parse on those lines, read on the first use (printsNothing). */
  printsNothing?: boolean;
  /** The analyses the netlist runs, by the word a .print line gives them (dc, tran ...), read on the first use. */
  runTypes?: Set<string>;
  /** The netlist has lines after .end, read on the first use. */
  afterEnd?: boolean;
  /**
   * The words a character check explains, by offset: the number meant and how its fix writes it, or 'split' for a
   * word glued by a character that looks like a space, which may be two words (re-check critic CR2-1).
   */
  meant: Map<number, { value: number; text: string } | 'split'>;
  /** Each part line's places (partPlaces), worked out once. */
  places: Map<number, (Place | null | undefined)[]>;
  /** For each part line inside subcircuits, their names, outermost first, lower-case. */
  subOf: Map<number, string[]>;
  /** The names a subcircuit gives values to (its .subckt line and the .param lines inside it), lower-case (CR2-5). */
  subParams: Map<string, Set<string>>;
}

const GROUND = '0';
/** The true minus sign for display text (netlist text keeps the ASCII hyphen). */
const MINUS = '\u2212';
/** The micro sign, which ngspice reads as u (W15). */
const MICRO = '\u00b5';
/** Small counts in words. */
const COUNT_WORDS: Readonly<Record<number, string>> = { 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six' };
const MAIN_ROLES: ReadonlySet<FieldRole> = new Set(['value', 'gain', 'transconductance', 'transresistance']);
const NODE_ROLES: ReadonlySet<FieldRole> = new Set(['node', 'plus', 'minus', 'from', 'to', 'control-plus', 'control-minus']);
const VALUE_LETTERS: ReadonlySet<string> = new Set(['R', 'C', 'L', 'V', 'I', 'E', 'F', 'G', 'H']);
const UNIT: Partial<Record<ElementLetter, string>> = { R: 'Ω', C: 'F', L: 'H', V: 'V', I: 'A' };

function lineAt(n: Netlist, offset: number): NetlistLine {
  let lo = 0;
  let hi = n.lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (n.lines[mid]!.span.from <= offset) lo = mid;
    else hi = mid - 1;
  }
  return n.lines[lo]!;
}

function add(
  c: Ctx,
  id: TrapId,
  severity: TrapSeverity,
  span: Span,
  title: string,
  why: string,
  ngspice: string,
  fixes: Fix[] = [],
): void {
  const key = `${id}|${span.from}|${span.to}`;
  if (c.seen.has(key)) return;
  c.seen.add(key);
  const line = lineAt(c.n, span.from).number;
  const trap: Trap = { id, severity, line, span: { from: span.from, to: span.to }, title, why, ngspice, fixes };
  c.traps.push(trap);
  const onLine = c.byLine.get(line);
  if (onLine) onLine.push(trap);
  else c.byLine.set(line, [trap]);
}

const change = (from: number, to: number, insert: string): TextChange => ({ from, to, insert });
const replace = (t: Span, insert: string): TextChange => change(t.from, t.to, insert);
const fix = (label: string, ...changes: TextChange[]): Fix => ({ label, changes: changes.sort((a, b) => a.from - b.from) });

/** "a", "a and b", "a, b and c" (or "a, b or c"). */
function list(items: readonly string[], word = 'and'): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${word} ${items[items.length - 1]}`;
}

const el = (c: Ctx, i: number): Element => c.n.lines[i]!.element!;
const nameOf = (e: Element): string => e.name.text;
const fieldAfter = (e: Element, f: Field): Field | undefined => e.fields[e.fields.indexOf(f) + 1];

/** Where a new line goes after line i and its continuation lines: the start of the next line. */
function insertLineAfter(c: Ctx, i: number, line: string): TextChange {
  const last = c.lastContinuation.get(i) ?? i;
  const next = c.n.lines[last + 1];
  if (next) return change(next.span.from, next.span.from, `${line}\n`);
  return change(c.text.length, c.text.length, `${c.text.endsWith('\n') || c.text.length === 0 ? '' : '\n'}${line}\n`);
}

/** A part name not used yet: base itself, or base with the next free number (names compared as ngspice reads them, µ as u). */
function freshName(c: Ctx, base: string): string {
  if (!c.names.has(ngspiceName(base))) return base;
  const m = /^(.*?)(\d+)$/.exec(base);
  const stem = m ? m[1]! : base;
  // Start after the last number handed out for this stem, so many duplicates stay fast.
  const stemKey = ngspiceName(stem);
  let k = Math.max(m ? Number(m[2]) + 1 : 2, c.nextNumber.get(stemKey) ?? 0);
  while (c.names.has(ngspiceName(`${stem}${k}`))) k += 1;
  c.nextNumber.set(stemKey, k + 1);
  return `${stem}${k}`;
}

/** Changes that rename a node everywhere it is named (parts and directives). */
const renameNode = (info: NodeInfo, to: string): TextChange[] => info.refs.map((t) => replace(t, to));

/**
 * Two node names that look like a typo of each other: one character more or less (n12 and n2), or
 * two neighbouring letters swapped (otu and out). Names differing in one digit (n1, n2) are a
 * numbering, not a typo, and one-character names are too short to tell.
 */
export function looksLikeTypo(a: string, b: string): boolean {
  if (a === b) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length < 2) return false;
  if (l.length === s.length + 1) {
    for (let k = 0; k < l.length; k++) if (l.slice(0, k) + l.slice(k + 1) === s) return true;
    return false;
  }
  if (l.length !== s.length || s.length < 3) return false;
  for (let k = 0; k + 1 < s.length; k++) {
    if (s[k] === l[k + 1] && s[k + 1] === l[k] && s.slice(0, k) === l.slice(0, k) && s.slice(k + 2) === l.slice(k + 2)) {
      return !(/\d/.test(s[k]!) && /\d/.test(s[k + 1]!)) && s[k] !== s[k + 1];
    }
  }
  return false;
}

/**
 * Names indexed for looksLikeTypo: a name's look-alikes are found from its one-character-shorter
 * variants and its swaps instead of by comparing every pair, which kept a netlist with thousands of
 * nodes from taking seconds.
 */
export class TypoIndex {
  private readonly order = new Map<string, number>();
  /** A name with one character left out, to the names it comes from. */
  private readonly shorter = new Map<string, Set<string>>();

  constructor(names: Iterable<string>) {
    for (const n of names) {
      if (this.order.has(n)) continue;
      this.order.set(n, this.order.size);
      for (let k = 0; k < n.length; k++) {
        const d = n.slice(0, k) + n.slice(k + 1);
        const set = this.shorter.get(d);
        if (set) set.add(n);
        else this.shorter.set(d, new Set([n]));
      }
    }
  }

  /** Every indexed name y with looksLikeTypo(name, y), in the order the names were given. */
  lookAlikes(name: string): string[] {
    const found = new Set<string>(this.shorter.get(name));
    for (let k = 0; k < name.length; k++) {
      const d = name.slice(0, k) + name.slice(k + 1);
      if (this.order.has(d)) found.add(d);
    }
    for (let k = 0; k + 1 < name.length; k++) {
      const swapped = name.slice(0, k) + name[k + 1] + name[k] + name.slice(k + 2);
      if (this.order.has(swapped)) found.add(swapped);
    }
    return [...found].filter((y) => looksLikeTypo(name, y)).sort((a, b) => this.order.get(a)! - this.order.get(b)!);
  }
}

/** The value in plain units for a part's main value: "1 mΩ", "a gain of 0.001". */
function amount(value: number, letter: ElementLetter | undefined): string {
  const ratio = Number.isInteger(value) && Math.abs(value) < 1e15 ? `${value < 0 ? MINUS : ''}${Math.abs(value)}` : formatNumber(value);
  if (letter === 'E' || letter === 'F') return `a gain of ${ratio}`;
  if (letter === 'G') return `${ratio} A/V`;
  if (letter === 'H') return `${ratio} V/A`;
  return formatSI(value, letter ? (UNIT[letter] ?? '') : '');
}

/**
 * The value in words and in symbols, for titles a screen reader reads aloud: "1 milliohm (1 mΩ)".
 * Speech does not carry letter case, so "1 mΩ, not 1 MΩ" alone would sound like the same thing twice.
 */
function amountSaid(value: number, letter: ElementLetter | undefined): string {
  const unit = letter ? UNIT[letter] : undefined;
  return unit ? `${speakSI(value, unit)} (${formatSI(value, unit)})` : amount(value, letter);
}

/** The number as written, without its scale letters and the letters after them ("4.7" of "4.7MOhm"). */
function numberPart(r: NumberReading): string {
  const tail = (r.scale?.letters ?? '') + (r.ignored ?? '') + (r.rest ?? '');
  return r.text.slice(0, r.text.length - tail.length);
}

/** The ngspice level of a .model line: the number after the first "level" (inpfindl.c). */
function modelLevel(rest: string): number {
  const at = rest.indexOf('level');
  if (at < 0) return 1;
  let p = at + 5;
  while (p < rest.length && ' \t=,()+'.includes(rest[p]!)) p += 1;
  const r = readNumber(rest.slice(p));
  if (!r) return 0;
  const level = Math.trunc(r.value + 0.5);
  return level < 0 || level > 99 ? 1 : level;
}

function context(n: Netlist): Ctx {
  const graph = buildGraph(n);
  const c: Ctx = {
    n,
    text: n.text,
    graph,
    traps: [],
    top: n.elements.filter((i) => !graph.inSubcircuit.has(i)),
    models: new Map(),
    subckts: new Set(),
    params: new Set(),
    topParams: new Set(),
    innerParams: new Map(),
    funcs: new Set(),
    byKey: new Map(),
    names: new Set(n.elements.map((i) => n.lines[i]!.element!.key)),
    opNeeded: true,
    broken: new Set(),
    built: new Set(graph.elements),
    lastContinuation: new Map(),
    seen: new Set(),
    byLine: new Map(),
    nextNumber: new Map(),
    spaced: new Set(),
    spacedChars: new Set(),
    meant: new Map(),
    places: new Map(),
    subOf: new Map(),
    subParams: new Map(),
    hasControl: n.lines.some((l) => l.kind === 'control' && /^\s*\.control/i.test(l.text)),
  };
  for (const i of c.top) if (!c.byKey.has(el(c, i).key)) c.byKey.set(el(c, i).key, i);
  for (const l of n.lines) {
    if (l.continues !== undefined) c.lastContinuation.set(l.continues, Math.max(l.index, c.lastContinuation.get(l.continues) ?? 0));
  }
  let depth = 0;
  const within: string[] = [];
  let chain: string[] = [];
  for (const l of n.lines) {
    if (l.element && chain.length > 0) c.subOf.set(l.index, chain);
    if (l.kind === 'invalid' && /^[\s\ufeff]*@/.test(l.text) && c.atLine === undefined) c.atLine = l.index;
    // A .param line after .end is read too, even after .end;comment (unknown-word-36, -37).
    if (l.kind === 'after-end' && lowerAscii(l.tokens[0]?.text ?? '') === '.param') {
      for (const t of l.tokens.slice(1)) if (/^[ \t]*=/.test(c.text.slice(t.to, l.span.to))) c.topParams.add(lowerAscii(t.text));
    }
    const d = l.directive;
    if (!d) continue;
    if (d.name === '.subckt' || d.name === '.macro') {
      depth += 1;
      within.push(d.args[0]?.text ?? '');
      chain = within.map(lowerAscii);
    } else if (d.name === '.ends' || d.name === '.eom') {
      depth = Math.max(0, depth - 1);
      within.pop();
      chain = within.map(lowerAscii);
    } else if (d.name === '.param' && depth === 0) {
      for (const t of d.args) if (/^[ \t]*=/.test(c.text.slice(t.to, cardEnd(c, l.index)))) c.topParams.add(lowerAscii(t.text));
    }
    if (depth > 0 && (d.name === '.subckt' || d.name === '.macro' || d.name === '.param')) {
      const sub = lowerAscii(within.at(-1) ?? '');
      const own = c.subParams.get(sub) ?? new Set<string>();
      c.subParams.set(sub, own);
      for (const t of d.args.slice(d.name === '.param' ? 0 : 1)) {
        if (!/^[ \t]*=/.test(c.text.slice(t.to, cardEnd(c, l.index)))) continue;
        own.add(lowerAscii(t.text));
        if (!c.innerParams.has(lowerAscii(t.text))) c.innerParams.set(lowerAscii(t.text), within.at(-1) ?? '');
      }
    }
    const first = d.args[0];
    if (d.name === '.model' && first) {
      const second = d.args[1];
      const restFrom = second ? second.to : first.to;
      const card = lowerAscii(n.text.slice(restFrom, cardEnd(c, l.index)));
      const type = second ? lowerAscii(second.text) : '';
      c.models.set(lowerAscii(first.text), { name: first.text, type, level: modelLevel(card), line: l.index, token: first });
    } else if ((d.name === '.subckt' || d.name === '.macro') && first) {
      c.subckts.add(lowerAscii(first.text));
      paramNames(c, d.args, l.index);
    } else if (d.name === '.param') {
      paramNames(c, d.args, l.index);
    } else if (d.name === '.func' && first) {
      c.params.add(lowerAscii(first.text));
      c.funcs.add(lowerAscii(first.text));
    }
  }
  const analyses = n.analyses.map((i) => n.lines[i]!.directive!);
  c.opNeeded = analyses.length === 0 || analyses.some((d) => !(d.name === '.tran' && d.args.some((t) => lowerAscii(t.text) === 'uic')));
  return c;
}

/** Where line i's card (with its continuation lines) ends in the netlist. */
function cardEnd(c: Ctx, i: number): number {
  return c.n.lines[c.lastContinuation.get(i) ?? i]!.span.to;
}

/** Names defined as name=value among a directive's words (.param, .subckt ... params:). */
function paramNames(c: Ctx, args: Token[], line: number): void {
  const end = cardEnd(c, line);
  for (const t of args) {
    let p = t.to;
    while (p < end && (c.text[p] === ' ' || c.text[p] === '\t')) p += 1;
    if (c.text[p] === '=') c.params.add(lowerAscii(t.text));
  }
}

// ------------------------------------------------------------------ how values are written

/** RKM code such as 2k2, 4k7, 1M5, 4R7: digits, one letter standing for the decimal point, digits. */
const RKM = /^([+-]?\d+)([rRkKmMuUnNpPgGtT\u00b5])(\d+)([A-Za-z\u03a9\u2126]*)$/;
const RKM_SCALE: Record<string, [factor: number, spelling: string]> = {
  r: [1, ''],
  k: [1e3, 'k'],
  M: [1e6, 'meg'],
  m: [1e-3, 'm'],
  u: [1e-6, 'u'],
  '\u00b5': [1e-6, 'u'],
  n: [1e-9, 'n'],
  p: [1e-12, 'p'],
  g: [1e9, 'g'],
  t: [1e12, 't'],
};

/**
 * "ngspice reads 2k2 as 2 kΩ (R1) and says nothing. [rkm-notation-1]", except for a resistor read as 0,
 * which ngspice 47 cannot use and warns about (zeroOhm; re-check critic CR1-1): never "says nothing" there.
 */
function saysNothing(head: string, claims: string, letter: ElementLetter | undefined, who: readonly string[] | undefined, value: number): string {
  const zero = zeroOhm(letter, value, who);
  return zero ? `${head}, ${zero.says} [${claims}, ${zero.claims}]` : `${head} and says nothing. [${claims}]`;
}

function checkValueSpelling(c: Ctx, i: number): void {
  const e = el(c, i);
  const v = e.value;
  const r = v?.number;
  if (!v || !r || !e.letter || !VALUE_LETTERS.has(e.letter) || v.token.text !== r.text) return;
  const text = v.token.text;
  const letter = e.letter;
  const unit = UNIT[letter] ?? '';
  const name = nameOf(e);

  const rkm = RKM.exec(text);
  if (rkm && !/^0+$/.test(rkm[3]!)) {
    const key = rkm[2] === 'M' ? 'M' : rkm[2] === '\u00b5' ? '\u00b5' : rkm[2]!.toLowerCase();
    const [factor, spelling] = RKM_SCALE[key]!;
    const meant = `${rkm[1]}.${rkm[3]}${spelling}`;
    const asRead = rkm[2]!.toLowerCase() === 'r' ? rkm[1]! : `${rkm[1]}${rkm[2]}`;
    add(
      c,
      'rkm-notation',
      'warning',
      v.token,
      `${text} is read as ${asRead}, not ${meant}`,
      `On resistor codes and schematics ${text} means ${meant}: the letter stands for the decimal point. SPICE stops reading the number at the letter and ignores the ${rkm[3]} after it. Write ${meant}.`,
      saysNothing(`ngspice reads ${text} as ${amount(r.value, letter)} (${name})`, 'rkm-notation-1', letter, printedNames(c, i), r.value),
      [fix(`Write ${meant} (${amount(Number(`${rkm[1]}.${rkm[3]}`) * factor, letter)})`, replace(v.token, meant))],
    );
    return;
  }

  const digits = numberPart(r);
  const base = readNumber(digits)?.value;
  if (base === undefined) return;

  if (r.scale?.name === 'milli' && r.scale.letters === 'M') {
    const mega = fix(`Make it ${digits}meg (${amount(base * 1e6, letter)})`, replace(v.token, `${digits}meg`));
    const milli = fix(`Keep milli: write ${digits}m`, replace(v.token, `${digits}m`));
    const gain = letter === 'E' || letter === 'F' || letter === 'G' || letter === 'H';
    const ohms = letter === 'R';
    add(
      c,
      'mega-as-milli',
      'warning',
      v.token,
      ohms || gain ? `${text} means ${amountSaid(r.value, letter)}, not ${amountSaid(base * 1e6, letter)}` : `${text} means ${amountSaid(r.value, letter)}`,
      `SPICE ignores capital letters, so a capital M is the same as a small m: milli. For mega, write meg: ${digits}meg.`,
      saysNothing(`ngspice reads ${text} as ${amount(r.value, letter)}${r.ignored ? ` (it ignores the ${r.ignored})` : ''}`, 'mega-as-milli-1, mega-as-milli-2, mega-as-milli-3', letter, printedNames(c, i), r.value),
      ohms || gain ? [mega, milli] : [milli, mega],
    );
    return;
  }

  if (r.scale?.name === 'atto' || (letter === 'C' && r.scale?.name === 'femto')) {
    const atto = r.scale.name === 'atto';
    const shown = atto ? 'A' : 'F';
    const meant = speakSI(base, unit);
    add(
      c,
      'unit-letter',
      atto || r.scale.letters === 'F' ? 'warning' : 'info',
      v.token,
      `${text} means ${speakSI(r.value, unit)}`,
      atto
        ? `${shown} is not amps here: SPICE reads it as the scale letter a, atto (10⁻¹⁸), and it does not use units. Write the number alone: ${digits} means ${meant}.`
        : `F is not farads here: SPICE reads it as the scale letter f, femto (10⁻¹⁵), and it does not use units. Write the number alone: ${digits} means ${meant}.`,
      saysNothing(`ngspice reads ${text} as ${speakSI(r.value, unit)}`, 'unit-letter-1, unit-letter-2', letter, printedNames(c, i), r.value),
      [fix(`Write ${digits} (${meant})`, replace(v.token, digits))],
    );
  }
}

/**
 * What ngspice does with a word at one place of a line, for the character checks, each from its own runs
 * (re-check S2, its critic's CR1-2 and CR1-5, the second critic's CR2-1 and CR2-3). `verdict` is given the number
 * ngspice reads there (undefined when it reads none: the word as ngspice spells it is `spelled`) and the number
 * meant, and says one of three things: what this word's reading makes ngspice do (`own`: the words after "it
 * reads 0, ", or for a word it reads no number from, the whole sentence); that ngspice runs on without a message
 * (`silent`), where runs show it; or nothing (`none`) where no run shows what ngspice does, as when the line has
 * a problem of its own whatever this word reads, which its own check says. `claims` are the runs.
 */
interface Place {
  /** Whose number it is, for the titles: "This value", "A word in V1's PULSE", "C1's ic value". */
  subject: string;
  verdict: (read: number | undefined, meant: number | undefined, spelled: string) => Verdict;
}

type Verdict = { kind: 'own'; says: string; claims: string; stops: boolean } | { kind: 'silent' | 'none'; claims: string };

const AC_DEFAULTS = "ngspice warns: 'Warning, ngspice assumes default parameter(s) for ac simulation'";
const stop = (says: string, claims: string): Verdict => ({ kind: 'own', says, claims, stops: true });
const runs = (says: string, claims: string): Verdict => ({ kind: 'own', says, claims, stops: false });
const silent = (claims: string): Verdict => ({ kind: 'silent', claims });
const none = (claims: string): Verdict => ({ kind: 'none', claims });

type Directive = NonNullable<NetlistLine['directive']>;

/**
 * A word of an analysis line as ngspice reads it: its number (a number written with a character that is not
 * what it looks like is read up to that character), 'word' when it reads none, or 'expr' for a word in braces
 * or quotes, which numparam works out first, to a number the checks do not know.
 */
type Reading = number | 'word' | 'expr';
const readingOf = (t: Token): Reading => (/^[{']/.test(t.text) ? 'expr' : (readNumber(t.text)?.value ?? 'word'));

/**
 * What ngspice does with an analysis line as it reads it, in its own order (inp2dot.c, dctrcurv.c, acan.c,
 * noisean.c of ngspice 47, and the runs that show each part): '' when it runs the line without a message, '?'
 * where no run shows what it does (or a number in braces decides it), else codes for what it does. The checks
 * compare it with the outcome of the line with one word read as meant, to tell what that word's reading does
 * and whether the line has a problem of its own (re-check critic CR2-1): a character in one word never hides
 * the line's other problems, and "without a message" is said only of a line ngspice runs without one.
 */
function lineOutcome(c: Ctx, d: Directive, w: readonly (Reading | undefined)[]): string {
  if (d.name === '.tran') return tranOutcome(d.args, w);
  if (d.name === '.dc') return dcOutcome(c, d.args, w);
  if (d.name === '.ac') return acOutcome(d.args, w);
  if (d.name === '.noise') return noiseOutcome(c, d.args, w);
  return '?';
}

/**
 * .tran tstep tstop [tstart [tmax]] [uic], as dot_tran reads it: the step and the stop whatever they are (a word
 * that is no number, uic too, reads 0), each checked as it is read, then a start and a largest step when numbers
 * follow, then one word, which must be uic. The first problem stops ngspice (tran-problems-1 to -9,
 * invisible-character-8 to -11, -28 to -31). A step longer than the run is no problem for ngspice (tran-problems-3).
 */
function tranOutcome(words: readonly Token[], w: readonly (Reading | undefined)[]): string {
  const step = w[0];
  if (step === undefined) return 'TSTEP@-';
  if (step === 'expr') return '?';
  if (step === 'word' || step <= 0) return 'TSTEP@0';
  const tstop = w[1];
  if (tstop === undefined) return 'TSTOP@-';
  if (tstop === 'expr') return '?';
  if (tstop === 'word' || tstop <= 0) return 'TSTOP@1';
  let i = 2;
  const start = w[2];
  if (start !== undefined && start !== 'word') {
    if (start === 'expr') return '?';
    if (start >= tstop) return 'TSTART@2';
    i = 3;
    if (w[3] !== undefined && w[3] !== 'word') i = 4;
  }
  if (i < words.length && lowerAscii(words[i]!.text) !== 'uic') return `UNKNOWN@${i}`;
  return step > tstop ? 'LONGSTEP' : '';
}

/**
 * .dc as ngspice 47 reads it (dot_dc): a name, a start, a stop and a step, and a second sweep when anything
 * follows; it stops with 'Bad syntax!' when a sweep lacks a word or a step is 0, and a word that is no number
 * reads 0 and is read again at the next place, so it ends at the step (dc-sweep-problems-1, -9 to -13). Then
 * the run: each sweep's source (dc-sweep-problems-6, -7, -14), then its points: one sweep the wrong way has none
 * (-3, -4); in two sweeps a sweep the wrong way never moves (-20, -21), both have none (-22); a step past the end
 * gives the first point only (-5, -23, -24).
 */
function dcOutcome(c: Ctx, words: readonly Token[], w: readonly (Reading | undefined)[]): string {
  const two = words.length > 4;
  for (const s of two ? [0, 1] : [0]) {
    if (words[4 * s] === undefined) return 'BAD@-';
    for (let j = 4 * s + 1; j <= 4 * s + 3; j++) {
      if (words[j] === undefined) return 'BAD@-';
      if (w[j] === 'word') return `BAD@${j}`;
    }
    if (w[4 * s + 3] === 0) return `BAD@${4 * s + 3}`;
  }
  for (const s of two ? [0, 1] : [0]) {
    const name = lowerAscii(words[4 * s]!.text);
    if (name !== 'temp' && !sweepable(c.byKey.has(name) ? el(c, c.byKey.get(name)!) : undefined)) return `NOTFOUND@${4 * s}`;
  }
  const v = w.slice(0, two ? 8 : 4);
  if (v.includes('expr')) return '?';
  const at = (j: number): number => v[j] as number;
  const wrong = (s: number): boolean => {
    const [start, end, step] = [at(4 * s + 1), at(4 * s + 2), at(4 * s + 3)];
    return (step > 0 && start > end) || (step < 0 && start < end);
  };
  const big = (s: number): boolean => {
    const [start, end, step] = [at(4 * s + 1), at(4 * s + 2), at(4 * s + 3)];
    return !wrong(s) && start !== end && Math.abs(step) > Math.abs(end - start);
  };
  if (!two) return wrong(0) ? 'NOPOINTS' : big(0) ? 'FIRSTONLY' : '';
  if (wrong(0) && wrong(1)) return 'NOPOINTS';
  const flags = [wrong(0) ? 'STUCK0' : big(0) ? 'BIG0' : '', wrong(1) ? 'STUCK1' : big(1) ? 'BIG1' : ''];
  return flags.filter(Boolean).join('|');
}

/**
 * .ac dec|oct|lin points start stop, as ngspice 47 reads it (dot_ac): points below 1, a start or a stop that
 * does not start with a digit, a start below 0 or a stop below the start make it assume its own numbers and
 * warn, once (invisible-character-16 to -18, -34, -36, -37); then a start of 0 stops a dec or oct sweep (acan.c:
 * 'AC startfreq <= 0', -35), while a lin sweep runs from 0 Hz (invisible-character-57). A stop equal to the start
 * is one point in ngspice 47 and an empty results file in 42: no run is claimed for it.
 */
function acOutcome(words: readonly Token[], w: readonly (Reading | undefined)[]): string {
  const kind = lowerAscii(words[0]?.text ?? '');
  if (!/^(dec|oct|lin)$/.test(kind) || w.slice(1, 4).includes('expr')) return '?';
  const flags: string[] = [];
  let i = 1;
  // A word that is no number reads 0 and is not taken up: the next number reads it again.
  const take = (integer: boolean): number => {
    const r = w[i];
    if (r === undefined || r === 'word' || r === 'expr') return 0;
    i += 1;
    return integer ? Math.floor(0.5 + r) : r;
  };
  const digitFirst = (): boolean => /^(\d|\.\d)/.test(words[i]?.text ?? '');
  if (take(true) < 1) flags.push('PTS');
  if (!digitFirst()) flags.push(`ND@${i}`);
  let start = take(false);
  if (start < 0) {
    flags.push('NEGSTART');
    start = 1;
  }
  if (!digitFirst()) flags.push(`ND@${i}`);
  const end = take(false);
  if (end < start) flags.push('LOWSTOP');
  // The run: a dec or oct sweep stops at a start of 0; a stop equal to the start has no run that shows it.
  if (kind !== 'lin' && start <= 0) flags.push('STARTFREQ');
  else if (end === start) return '?';
  return flags.join('|');
}

/**
 * .noise v(out) source dec|oct|lin points start stop, as ngspice 47 reads it (dot_noise, noisean.c): a start or a
 * stop of 0 or less, or a word that is no number there, is an error of the line ('Frequency of 0 is invalid',
 * invisible-character-19 to -21, -39, -40); then the run: points below 1 warn and abort (-38), a stop equal to the
 * start warns of a single frequency (-41), a stop below the start computes none (-42, -43). The source must be a
 * voltage or current source with an AC value, or ngspice warns and aborts: no run here shows that, nor a lin sweep.
 */
function noiseOutcome(c: Ctx, words: readonly Token[], w: readonly (Reading | undefined)[]): string {
  const j = words.findIndex((x) => /^(dec|oct|lin)$/i.test(x.text));
  if (j < 2 || w.slice(j + 1, j + 4).includes('expr')) return '?';
  const key = c.byKey.get(lowerAscii(words[j - 1]!.text));
  const src = key === undefined ? undefined : el(c, key);
  if (!src || (src.letter !== 'V' && src.letter !== 'I') || !src.fields.some((f) => f.role === 'source-function' && lowerAscii(f.token.text) === 'ac')) return '?';
  let i = j + 1;
  // The word each number is read from: a word that is no number is read again by the next (not taken up).
  const from: (number | undefined)[] = [];
  const take = (integer: boolean): number => {
    const r = w[i];
    from.push(r === undefined ? undefined : i);
    if (r === undefined || r === 'word' || r === 'expr') return 0;
    i += 1;
    return integer ? Math.floor(0.5 + r) : r;
  };
  const points = take(true);
  const start = take(false);
  const end = take(false);
  if (start <= 0 || end <= 0) return `FREQ0@${from[start <= 0 ? 1 : 2] ?? '-'}`;
  if (points < 1) return 'NOSTEPS';
  if (!/^(dec|oct)$/i.test(words[j]!.text)) return '?';
  return end === start ? 'SINGLE' : end < start ? 'NOFREQ' : '';
}

/**
 * The place of word k of an analysis line, when runs show what ngspice does with a word there: the four numbers
 * of .tran, the numbers of the two sweeps of .dc, and the points, start and stop of .ac and .noise. Its verdict
 * weighs what ngspice reads there with the whole line as ngspice reads it (lineOutcome): the line runs without a
 * message ("without a message", invisible-character-22, -44); or what ngspice does with the line is what this
 * place's words say of this word, which are said (invisible-character-8 to -21, -28 to -43; in two sweeps
 * dc-sweep-problems-20 to -24); or ngspice does something else, decided by another word or a word the line
 * lacks, and nothing is claimed: its own check says it (re-check critic CR2-1). Any other place has no recorded run (.disto, .pz, .sens, .sp, a .noise's
 * points per summary ...), or nothing in it counts (.four, which a run with a results file skips:
 * invisible-character-27), so the character checks leave its words alone.
 */
function analysisPlace(c: Ctx, d: Directive, k: number): Place | undefined {
  const args = d.args;
  let n = k;
  if (d.name === '.tran') {
    if (k > 3) return undefined;
  } else if (d.name === '.dc') {
    if (k % 4 === 0 || k >= 8) return undefined;
  } else if (d.name === '.ac') {
    if (!/^(dec|oct|lin)$/i.test(args[0]?.text ?? '') || k < 1 || k > 3) return undefined;
  } else if (d.name === '.noise') {
    const j = args.findIndex((x) => /^(dec|oct|lin)$/i.test(x.text));
    n = k - j;
    if (j < 0 || n < 1 || n > 3) return undefined;
  } else return undefined;
  // The runs that show a number read short at this place: the stops of .dc, .ac and .tran (-22), the others (-44);
  // and the run that shows a word ngspice reads no number from here (invisible-character-8 to -21).
  const quiet = (d.name !== '.noise' && (d.name === '.tran' ? k === 1 : d.name === '.ac' ? k === 3 : k % 4 === 2)) ? 'invisible-character-22' : 'invisible-character-44';
  const unreadRun = `invisible-character-${d.name === '.tran' ? 8 + k : d.name === '.dc' ? (k >= 4 ? 15 : 11 + k) : d.name === '.ac' ? 15 + k : 18 + n}`;
  const base = args.map(readingOf);
  const outcome = (r: Reading): string => lineOutcome(c, d, base.map((x, j) => (j === k ? r : x)));
  return {
    subject: 'This value',
    verdict: (read, meant, spelled) => {
      const R = outcome(read ?? 'word');
      const said = read === undefined ? unreadRun : quiet;
      // A lin .ac sweep has no check of its start: read as 0 it runs from 0 Hz (invisible-character-57).
      if (R === '') return silent(d.name === '.ac' && k === 2 && read !== undefined && read <= 0 ? `${said}, invisible-character-57` : said);
      if (R === '?') return none(said);
      // `alone`: written as meant, this word leaves a line ngspice runs as it is; ngspice 42's part of the .dc
      // words was recorded only on such lines.
      const M = meant === undefined ? '?' : outcome(meant);
      const values = base.map((x, j) => (j === k ? (read ?? 'word') : x));
      return ownVerdict(d, k, n, R, read, { alone: M === '', mixed: M !== '' && M !== '?' && M !== R }, spelled, values, quiet) ?? none(said);
    },
  };
}

/**
 * What ngspice does at analysis place k (n: the place counted from .noise's kind of sweep), when R, the line's
 * outcome as ngspice reads it, is one this place's words describe of this word: the words after "it reads 0, ",
 * or for a word it reads no number from, the whole sentence. Each outcome names the word that decides it (TSTEP@0,
 * BAD@7, FREQ0@5 ...) or lists only what this word does, so the words never take another word's problem for this
 * one's. `alone`: the line runs as meant once this word is written as meant, as on the runs of ngspice 42's part
 * of the .dc words; `mixed`: the line has another problem too, which ngspice meets only after this one
 * (invisible-character-58). undefined: no run shows it, so nothing is said.
 */
function ownVerdict(d: Directive, k: number, n: number, R: string, read: number | undefined, line: { alone: boolean; mixed: boolean }, spelled: string, w: readonly Reading[], quiet: string): Verdict | undefined {
  const args = d.args;
  const { alone, mixed } = line;
  const num = (j: number): number => (typeof w[j] === 'number' ? (w[j] as number) : 0);
  if (d.name === '.tran') {
    if (read === undefined) {
      if (k === 0 && R === 'TSTEP@0') return stop("ngspice stops: 'TSTEP is invalid, must be greater than zero.'", 'invisible-character-8');
      if (k === 1 && R === 'TSTOP@1') return stop("ngspice stops: 'TSTOP is invalid, must be greater than zero.'", 'invisible-character-9');
      if ((k === 2 || k === 3) && R === `UNKNOWN@${k}`) return stop("ngspice stops: 'Error: unknown parameter on .tran - ignored'. It says ignored, but it runs nothing.", `invisible-character-${k === 2 ? 10 : 11}`);
      return undefined;
    }
    if (k === 0 && R === 'TSTEP@0') return stop("and ngspice stops: 'TSTEP is invalid, must be greater than zero.'", `invisible-character-28${read < 0 ? ', tran-problems-7' : ''}${mixed ? ', invisible-character-58' : ''}`);
    if (k === 1 && R === 'TSTOP@1') return stop("and ngspice stops: 'TSTOP is invalid, must be greater than zero.'", `invisible-character-29${read < 0 ? ', tran-problems-9' : ''}`);
    if (k === 1 && R === 'TSTART@2') return stop("which is not after the start time, so ngspice stops: 'TSTART is invalid, must be less than TSTOP.'", 'invisible-character-31');
    if (k === 2 && R === 'TSTART@2') return stop("which is not before the stop time, so ngspice stops: 'TSTART is invalid, must be less than TSTOP.'", 'invisible-character-30');
    if ((k === 0 || k === 1) && R === 'LONGSTEP') return silent(`${quiet}, tran-problems-3`);
    return undefined;
  }
  if (d.name === '.dc') {
    if (read === undefined) {
      if (R !== `BAD@${k}`) return undefined;
      // ngspice 42 reads a one-sweep line on: the word becomes the name of a second sweep (recorded for such a line only).
      const one = alone && args.length <= 4;
      return stop(`ngspice 47 stops: 'Bad syntax!'.${one ? ` ngspice 42 takes the word for the name of a second source to sweep, and stops: 'Voltage source, current source, or resistor named "${spelled}" is not in the circuit'.` : ''}`, `invisible-character-${k >= 4 ? 15 : 11 + k}`);
    }
    if (k % 4 === 3 && R === `BAD@${k}`) return stop(`and a step of 0 stops ngspice 47: 'Bad syntax!'.${alone ? ' ngspice 42 never finishes.' : ''}`, `invisible-character-32, dc-sweep-problems-1${k >= 4 ? ', invisible-character-64' : ''}${mixed ? ', invisible-character-60' : ''}`);
    // A run's outcome is said only when it is exactly this sweep's: nothing else on the line changes it.
    const s = k < 4 ? 0 : 1;
    const name = (j: number): string => shownWord(args[j]!.text);
    if (R === 'NOPOINTS' && args.length <= 4) return runs('so the sweep has no points: ngspice runs none and says nothing.', 'invisible-character-33');
    if (R === 'FIRSTONLY') return silent(`${quiet}, dc-sweep-problems-5`);
    if (R === `STUCK${s}`) {
      return s === 1
        ? runs(`so this sweep goes the wrong way and never moves: ngspice computes the sweep of ${name(0)} once, with ${name(4)} at ${formatNumber(num(5))}, and says nothing.`, 'dc-sweep-problems-20, invisible-character-54')
        : runs(`so this sweep goes the wrong way and never moves: ngspice keeps ${name(0)} at ${formatNumber(num(1))}, takes ${name(4)} from its second value on, and says nothing.`, 'dc-sweep-problems-21, invisible-character-55');
    }
    if (R === `BIG${s}`) return silent(`${quiet}, ${s === 1 ? 'dc-sweep-problems-23' : 'dc-sweep-problems-24'}`);
    return undefined;
  }
  if (d.name === '.ac') {
    const upTo = (f: number): string => `up to 1000 times the start frequency${f > 0 ? ` (${formatSI(1000 * f, 'Hz')})` : ''}`;
    if (read === undefined) {
      if ((k === 1 || k === 2) && R.endsWith('STARTFREQ')) return stop(`${AC_DEFAULTS}, then stops: 'AC startfreq <= 0'.`, `invisible-character-${15 + k}`);
      if (k === 3 && R === 'ND@3|LOWSTOP') return runs(`${AC_DEFAULTS}, and runs anyway, ${upTo(num(2))} instead of the stop written here.`, 'invisible-character-18');
      return undefined;
    }
    if (k === 1 && R === 'PTS') return runs(`so ${AC_DEFAULTS}, and runs anyway with a number of points of its own.`, 'invisible-character-34');
    if (k === 2 && R === 'STARTFREQ') return stop("and ngspice stops: 'AC startfreq <= 0'.", 'invisible-character-35');
    if (k === 2 && R === 'LOWSTOP') return runs(`which is above the stop frequency, so ${AC_DEFAULTS}, and runs anyway, ${upTo(read)}.`, 'invisible-character-37');
    if (k === 3 && R === 'LOWSTOP') return runs(`which is below the start frequency, so ${AC_DEFAULTS}, and runs anyway, ${upTo(num(2))} instead.`, 'invisible-character-36');
    return undefined;
  }
  if (d.name === '.noise') {
    const none2 = 'so ngspice computes no frequencies, without a message: the results are only its two totals, both 0.';
    if (read === undefined) return R === `FREQ0@${k}` ? stop("ngspice stops: 'Frequency of 0 is invalid'.", `invisible-character-${18 + n}`) : undefined;
    if (n === 1 && R === 'NOSTEPS') return stop("and ngspice warns: 'Number of steps for noise measurement has to be larger than 0', then stops: 'run simulation(s) aborted'.", 'invisible-character-38');
    if ((n === 2 || n === 3) && R === `FREQ0@${k}`) return stop("and ngspice stops: 'Frequency of 0 is invalid'.", n === 2 ? 'invisible-character-39' : 'invisible-character-40');
    if (n === 2 && R === 'NOFREQ') return runs(`which is above the stop frequency, ${none2}`, 'invisible-character-43');
    if (n === 3 && R === 'SINGLE') return runs("the same as the start frequency, so ngspice warns: 'Noise measurement at a single frequency ... only!', and computes that one frequency.", 'invisible-character-41');
    if (n === 3 && R === 'NOFREQ') return runs(`which is below the start frequency, ${none2}`, 'invisible-character-42');
  }
  return undefined;
}

/** The functions of a source whose numbers ngspice reads alike, as runs show (invisible-character-45 to -47, -51, -56). */
const LISTED_FUNCTIONS: ReadonlySet<string> = new Set(['pulse', 'sin', 'pwl', 'exp', 'sffm']);
const KEYWORD = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** The settings a number read short was run in, and ngspice ran on without a message (invisible-character-51). */
const QUIET_SETTINGS: ReadonlySet<string> = new Set(['m', 'ic']);

/** Whether the text from `from` to `to` holds the character ch, without copying it. */
function holds(text: string, from: number, to: number, ch: string): boolean {
  for (let p = from; p < to; p++) if (text[p] === ch) return true;
  return false;
}

/**
 * The places of the words of a part line other than the part's own value, worked out in one pass, so a PWL of
 * thousands of points stays linear (re-check critic CR2-2), when runs show what ngspice does with a word there
 * (CR1-5). In a source's PULSE, SIN, PWL, EXP or SFFM ngspice reads the numbers into a list, so a word it cannot
 * read ends the list: with no number before it, it says the value is out of range; with one, that a number is
 * missing; after that, the word is an unknown parameter (invisible-character-45 to -47). The AC value and phase
 * are part values (-48, -49). The value of a setting written name=value is read first, by numparam, which stops
 * at it (-50, -52, -53). What a number read short there does: listVerdict and settingVerdict. null: a place no run
 * shows (AM, TRNOISE, a third word after AC ...), which the character checks leave alone; undefined: the part's
 * own value, or another word.
 */
function partPlaces(c: Ctx, i: number): (Place | null | undefined)[] {
  const e = el(c, i);
  const fields = e.fields;
  // For each word, the keyword that governs it (the nearest before it, past numbers, up to the nodes), and
  // whether a ')' stands between them.
  const keys: number[] = [];
  const shut: boolean[] = [];
  let w = -1;
  let closed = false;
  for (let k = 0; k < fields.length; k++) {
    const f = fields[k]!;
    keys.push(w);
    shut.push(closed);
    if (k === 0 || NODE_ROLES.has(f.role) || f.role === 'control-source') w = -1;
    else if (KEYWORD.test(f.token.text)) {
      w = k;
      closed = false;
    }
    const next = fields[k + 1];
    if (w >= 0 && !closed && next) closed = holds(c.text, w === k ? f.token.to : f.token.from, next.token.from, ')');
  }
  const fn = e.sourceFunction;
  const lists = new Map<number, Field[]>();
  const times = new Map<number, PwlTimes>();
  // A PWL with r= repeats from one of its times, which must then match: its times are not weighed.
  const repeat = e.fields.some((f) => f.role === 'parameter' && lowerAscii(f.token.text) === 'r');
  for (let k = 0; k < fields.length; k++) {
    const at = keys[k]!;
    if (at <= 0 || shut[k] || !fn || fields[at]!.token.from !== fn.token.from || (at === k - 1 && holds(c.text, fields[at]!.token.to, fields[k]!.token.from, '='))) continue;
    const list = lists.get(at);
    if (list) list.push(fields[k]!);
    else lists.set(at, [fields[k]!]);
  }
  const name = nameOf(e);
  return fields.map((f, k) => {
    const at = keys[k]!;
    if (at <= 0) return undefined;
    const key = fields[at]!;
    const word = lowerAscii(key.token.text);
    if (at === k - 1 && holds(c.text, key.token.to, f.token.from, '=')) {
      // A setting's value, or the part's own value written name=value (r=, c=, l=, dc= ...).
      return { subject: `${name}'s ${key.token.text} value`, verdict: (read, meant, spelled) => (read === undefined
        ? stop(`ngspice stops with a fatal error: 'Undefined parameter [${spelled}]'.`, 'invisible-character-50, invisible-character-52, invisible-character-53')
        : settingVerdict(e, e.value?.token === f.token, word, read, printedNames(c, i))) };
    }
    const p = k - at - 1;
    if (fn && fn.token.from === key.token.from) {
      if (shut[k]) return undefined;
      if (!LISTED_FUNCTIONS.has(word)) return null;
      let list = times.get(at);
      if (!list) {
        list = pwlTimes(lists.get(at) ?? []);
        times.set(at, list);
      }
      const pwl = list;
      return { subject: `A word in ${name}'s ${key.token.text}`, verdict: (read, meant, spelled) => (read === undefined
        ? p === 0 ? stop("ngspice stops: 'parameter value out of range or the wrong type'.", 'invisible-character-45')
          : p === 1 ? stop("ngspice 47 stops: 'no such parameter on this device or parameter is missing' (ngspice 42: 'no such parameter on this device').", 'invisible-character-46')
            : stop(`ngspice stops: 'unknown parameter (${spelled})'.`, 'invisible-character-47')
        : listVerdict(e, word, pwl, repeat, p, read, meant)) };
    }
    if (word === 'ac' && key.role === 'source-function') {
      if (p > 1) return null;
      return { subject: `${name}'s AC ${p === 0 ? 'value' : 'phase'}`, verdict: (read, _meant, spelled) => (read === undefined
        ? stop(`ngspice stops: 'unknown parameter (${spelled})'.`, `invisible-character-${p === 0 ? 48 : 49}`)
        : silent(p === 0 ? 'invisible-character-51' : 'invisible-character-56')) };
    }
    return undefined;
  });
}

/**
 * A number of a source's function read short (re-check critic CR2-3). PWL's times must rise: read out of order,
 * ngspice warns that the source "has non-increasing PWL time points" (invisible-character-59), said when that
 * comes from this word, as the times would rise with the number meant; a PWL with r= (a repeat, which must be
 * one of the times) is not weighed. SFFM's carrier, modulation index and signal frequency are weighed against each
 * other by ngspice in a run (it warns of a modulation index past FC/FM), and the value at time 0 against a DC value
 * written too (a note that it uses the DC value), so no claim is made there. Every other number read short ran
 * without a message (invisible-character-51, -56).
 */
function listVerdict(e: Element, fn: string, list: PwlTimes, repeat: boolean, p: number, read: number, meant: number | undefined): Verdict {
  const quiet = 'invisible-character-51, invisible-character-56';
  if ((fn === 'sffm' && p >= 2 && p <= 4) || p >= (RUN_PLACES[fn] ?? Infinity)) return none(quiet);
  if (p === (fn === 'pwl' ? 1 : 0) && e.value) return none(quiet);
  if (fn !== 'pwl' || p % 2 === 1) return silent(quiet);
  if (repeat) return none(quiet);
  const R = list.falls(p / 2, read);
  if (R === false) return silent(quiet);
  if (R === undefined || meant === undefined || list.falls(p / 2, meant) !== false) return none(quiet);
  return runs(`so the times are not in order, and ngspice warns: 'Warning : ${e.letter === 'I' ? 'current' : 'voltage'} source ${lowerAscii(nameOf(e))} has non-increasing PWL time points.'`, 'invisible-character-59');
}

/** How many numbers of each function the runs read short (invisible-character-51, -56): PULSE's eight, SIN's six ... */
const RUN_PLACES: Readonly<Record<string, number>> = { pulse: 8, sin: 6, exp: 6, sffm: 8 };

/**
 * The times of a PWL (every other number of its list), read as ngspice reads them, and whether they fall with
 * time q read as x (one not after the time before it), answered from a count of the falls made once, so a long
 * PWL with a character in every time stays linear (re-check critic CR2-2). undefined: a time is no number.
 */
interface PwlTimes {
  falls: (q: number, x: number) => boolean | undefined;
}

function pwlTimes(list: readonly Field[]): PwlTimes {
  const fall = (a: number | undefined, b: number | undefined): number => (a !== undefined && b !== undefined && b <= a ? 1 : 0);
  let made: { ts: (number | undefined)[]; count: number; unread: number } | undefined;
  return {
    falls: (q, x) => {
      if (!made) {
        const ts = list.filter((_, j) => j % 2 === 0).map((f) => readNumber(f.token.text)?.value);
        let count = 0;
        for (let j = 1; j < ts.length; j++) count += fall(ts[j - 1], ts[j]);
        made = { ts, count, unread: ts.filter((t) => t === undefined).length };
      }
      const { ts, count, unread } = made;
      // A time other than this one is no number: no run shows what ngspice does then.
      if (unread - (ts[q] === undefined ? 1 : 0) > 0) return undefined;
      const without = count - fall(ts[q - 1], ts[q]) - fall(ts[q], ts[q + 1]);
      return without + fall(ts[q - 1], x) + fall(x, ts[q + 1]) > 0;
    },
  };
}

/**
 * A setting's number read short. A resistor's own value written r= or resistance= and read as 0 is what zero-ohm
 * says of 0 Ω (zero-ohm-5); a source's dc= read short beside a function may now differ from the function's value
 * at time 0, of which ngspice makes a note, so no claim is made there; the other values written name=value (r=,
 * c=, l=, dc=, gain=) and m= and ic= ran without a message (invisible-character-51, -56); any other setting has no
 * run, so nothing is said of it.
 */
function settingVerdict(e: Element, own: boolean, word: string, read: number, who: readonly string[] | undefined): Verdict {
  const quiet = 'invisible-character-51, invisible-character-56';
  if (own) {
    const zero = zeroOhm(e.letter, read, who);
    if (zero) return runs(zero.says, `${zero.claims}, zero-ohm-5`);
    if ((e.letter === 'V' || e.letter === 'I') && e.sourceFunction) return none(quiet);
    return OWN_SETTINGS.has(word) ? silent(quiet) : none(quiet);
  }
  return QUIET_SETTINGS.has(word) ? silent(quiet) : none(quiet);
}

/** The names a part's own value is written after (name=value) in the runs of invisible-character-56. */
const OWN_SETTINGS: ReadonlySet<string> = new Set(['r', 'resistance', 'c', 'l', 'dc', 'gain']);

/**
 * How ngspice names part line i in its messages: as written, in lower case, at the top level; inside a
 * subcircuit, once for each X line that uses it, as letter.instance.name, r.x1.r1 (zero-ohm-6; re-check critic
 * CR2-7). undefined where that is not worked out here: a subcircuit inside another, or one no X line uses.
 */
function printedNames(c: Ctx, i: number): string[] | undefined {
  const own = lowerAscii(el(c, i).name.text);
  const chain = c.subOf.get(i);
  if (!chain) return [own];
  if (chain.length > 1) return undefined;
  const names = c.top
    .map((k) => el(c, k))
    .filter((x) => x.letter === 'X' && lowerAscii(modelField(x)?.token.text ?? '') === chain[0])
    .map((x) => `${own[0]}.${lowerAscii(x.name.text)}.${own}`);
  return names.length > 0 ? names : undefined;
}

/**
 * A resistor's value that ngspice reads as 0 because of how it is written (0<zero-width space>.47,
 * 0R47, 0．47, 1,0): ngspice 47 cannot use 0 Ω, so it uses 1e-12 Ω and warns, and ngspice 42 used 1 mΩ
 * without a word (zero-ohm-1, zero-ohm-4). The check that reads the value says so, never "says
 * nothing", and zero-ohm leaves such a value to it (re-check critic CR1-1). `who`: the resistor's names in
 * ngspice's messages (printedNames), r.x1.r1 inside a subcircuit (zero-ohm-6).
 */
function zeroOhm(letter: ElementLetter | undefined, value: number, who: readonly string[] | undefined): { says: string; claims: string } | undefined {
  if (letter !== 'R' || value !== 0) return undefined;
  return { says: `which ngspice 47 cannot use: it uses 1e-12 Ω instead and ${tooSmall(who)} (ngspice 42 used 0.001 Ω without a word).`, claims: `zero-ohm-1, zero-ohm-4${who?.length === 1 && !who[0]!.includes('.') ? '' : ', zero-ohm-6'}` };
}

/** "warns 'Value of resistor r1 is too small, set to 1.000000e-12'", with ngspice's name for each use of the resistor (zero-ohm-1, -6). */
function tooSmall(who: readonly string[] | undefined): string {
  const quote = (n: string): string => `'Value of resistor ${n} is too small, set to 1.000000e-12'`;
  if (!who) return "warns that the resistor's value is too small, once for each use of its subcircuit";
  return `warns ${quote(who[0]!)}${who.length > 1 ? `, and the same for ${list(who.slice(1))}` : ''}`;
}

/** Claim IDs, each once, in order: "a, b, a" is "a, b". */
const claimList = (...parts: string[]): string => [...new Set(parts.flatMap((p) => p.split(', ')).filter(Boolean))].join(', ');

/**
 * The end of a character check's sentence after "ngspice stops reading the number at ...": what it
 * reads, and what that does. A part's value runs on without a message, except that ngspice also looks
 * a capacitor's or an inductor's value word up as a model name, so it warns that it can't find one
 * (`model`: invisible-character-7, look-alike-letter-7 ...), and that ngspice 47 cannot use a resistor
 * read as 0 (zeroOhm), and that a source's value beside a function may now differ from the function's value
 * at time 0, of which ngspice makes a note (no claim then). At another place the place says (CR1-2, CR1-5,
 * CR2-1, CR2-3): what this word's reading does, "without a message" only where ngspice runs on without one,
 * or nothing where the line has a problem of its own. `claims` are the runs of the reading.
 */
function readTail(
  value: number,
  shown: string,
  claims: string,
  o: { letter?: ElementLetter | undefined; who?: readonly string[] | undefined; place?: Place | undefined; meant?: number | undefined; spelled?: string; model: string; e?: Element | undefined },
): { text: string; stops: boolean } {
  if (o.place) {
    const v = o.place.verdict(value, o.meant, o.spelled ?? '');
    if (v.kind === 'own') return { text: `: it reads ${shown}, ${v.says} [${claimList(claims, v.claims)}]`, stops: v.stops };
    if (v.kind === 'silent') return { text: `, without a message: it reads ${shown}. [${claimList(claims, v.claims)}]`, stops: false };
    return { text: `: it reads ${shown}. [${claimList(claims, v.claims)}]`, stops: false };
  }
  const zero = zeroOhm(o.letter, value, o.who);
  if (zero) return { text: `: it reads ${shown}, ${zero.says} [${claimList(claims, zero.claims)}]`, stops: false };
  if (o.letter === 'C' || o.letter === 'L') return { text: `: it reads ${shown}, and only warns that it can't find a model with the word's name. [${claimList(claims, o.model)}]`, stops: false };
  if ((o.letter === 'V' || o.letter === 'I') && o.e?.sourceFunction) return { text: `: it reads ${shown}. [${claims}]`, stops: false };
  return { text: `, without a message: it reads ${shown}. [${claims}]`, stops: false };
}

/**
 * What ngspice does with a word it reads no number from, at its place: the place's own sentence, or, where the
 * line has a problem of its own whatever this word reads, only that it reads none (re-check critic CR2-1).
 */
function unreadSays(place: Place, spelled: string, meant: number | undefined): string {
  const v = place.verdict(undefined, meant, spelled);
  return v.kind === 'own' ? `${v.says} [${v.claims}]` : `ngspice reads no number from this word, which it spells ${spelled}. [${v.claims}]`;
}

/** A part's main value in words: E's and F's is a gain, the others' a value (re-check critic CR1-14). */
const valueWord = (letter: ElementLetter | undefined): string => (letter === 'E' || letter === 'F' ? 'gain' : 'value');

/** A word as the words show it: its invisible characters taken out, a character that looks like a space shown as a space. */
const shownWord = (s: string): string => withSpaces(withoutInvisible(s));

/** "A zero-width space" from "a zero-width space (U+200B)": the start of a sentence. */
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A value with an invisible character or a letter from another alphabet in it (security review F2):
 * ngspice reads bytes, so an invisible character ends the number and the rest of the word is ignored
 * (1<zero-width space>k is 1 Ω: invisible-character-1, -2), and к, κ, ｋ or м is no scale letter (1к is
 * 1, look-alike-letter-1), nor is the Kelvin sign, a fullwidth digit or full stop, a minus sign or a
 * dash what it looks like (look-alike-letter-3); a word that starts with one is no number at all, and ngspice stops
 * (invisible-character-5, look-alike-letter-2). Flagged only when the reading changes once the
 * invisible characters are removed and the look-alikes written as the letters they look like, so 1kΩ,
 * or a zero-width space after the scale letter, is no trap (invisible-character-4). The Greek mu and
 * the no-break space have checks of their own. The words never show an invisible character: they
 * name it. Runs before checkUnknownWord, which leaves the words it covers alone.
 */
function checkOddValue(c: Ctx, t: Token, unit: string | undefined, letter: ElementLetter | undefined, name: string | undefined, place?: Place, line?: number): void {
  // A character that looks like a space is that check's, unless a character that is not what it looks
  // like comes first, inside the number (4·7<thin space>kΩ): ngspice stops reading there first (re-check C5).
  const chars = [...t.text];
  const space = chars.findIndex((x) => SPACE_LIKE.test(x));
  const first = chars.findIndex((x) => INVISIBLE.test(x) || lookAlikeOf(x) !== undefined);
  if (space >= 0 && !(first > 0 && first < space && /\d/.test(chars[first - 1]!))) {
    checkSpaceInValue(c, t, unit, letter, name, place, line);
    return;
  }
  if (letter && unit !== undefined && name && checkLetterO(c, t, letter, name, line)) return;
  const { clean: cleaned, odd } = cleanWord(t.text, true);
  if (!odd.length) {
    checkStrayCharacter(c, t, unit, letter, name, line);
    return;
  }
  // The rest read the way documents write values when a space-like character follows (4·7<thin space>kΩ is 4.7k).
  const clean = space >= 0 ? spacedValue(cleaned)?.spice : cleaned;
  if (clean === undefined) return;
  const meant = readNumber(clean);
  if (!meant || meant.rest) return;
  const read = readNumber(t.text);
  if (read && read.value === meant.value) return;
  if (space >= 0) c.spaced.add(t.from);
  c.meant.set(t.from, { value: meant.value, text: clean });
  const hidden = odd.find((ch) => INVISIBLE.test(ch));
  const ch = hidden ?? odd[0]!;
  const what = describeCharacter(ch);
  const id: TrapId = hidden ? 'invisible-character' : 'look-alike-letter';
  const shown = (v: number): string => (letter && unit !== undefined ? amount(v, letter) : formatNumber(v));
  const subject = place?.subject ?? (name ? `${name}'s ${valueWord(letter)}` : 'This value');
  const fixes = [fix(`Write ${clean}${letter && unit !== undefined ? ` (${amount(meant.value, letter)})` : ''}`, replace(t, clean))];
  if (!read) {
    // Where it is, from the text before it, said first: "Right after the -, it has ..." for
    // -<zero-width space>5 and -５ (invisible-character-6, look-alike-letter-6). Elsewhere than a part's
    // value ngspice says something else, by the place of the word (re-check S2, CR1-5).
    const lead = withoutInvisible(chars.slice(0, chars.indexOf(ch)).join(''));
    add(c, id, 'error', t, `${subject} is not a number for SPICE`,
      `${lead ? `Right after the ${lead}, it has ${what}` : `It starts with ${what}`}${hidden ? ', a character you cannot see (it often comes with text copied from a web page or a PDF)' : ''}, so SPICE does not read the word as a number. Write ${clean}.`,
      place ? unreadSays(place, ngspiceSpelling(t.text), meant.value) : `ngspice stops: 'unknown parameter (${ngspiceSpelling(t.text)})'. [${hidden ? (lead ? 'invisible-character-6' : INVISIBLE_CLAIMS.has(ch) ? 'invisible-character-5' : 'invisible-character-5, invisible-character-24') : lead ? 'look-alike-letter-6' : lookAlikeOf(ch) === '.' && ch !== '\uff0e' ? 'look-alike-letter-13' : 'look-alike-letter-2'}]`,
      fixes);
    return;
  }
  // What ngspice does with the number it reads: on a part's value, nothing, but a capacitor's or an
  // inductor's word is also looked up as a model name (invisible-character-7, look-alike-letter-7) and a
  // resistor read as 0 is too small for ngspice 47; elsewhere, what the place does with it (readTail).
  const reads = (also: string): { text: string; stops: boolean } =>
    readTail(read.value, shown(read.value), also, { letter, who: line === undefined ? undefined : printedNames(c, line), place, meant: meant.value, spelled: ngspiceSpelling(t.text), model: hidden ? 'invisible-character-7' : 'look-alike-letter-7', e: line === undefined ? undefined : el(c, line) });
  // A capital M from another alphabet (the M key of a Greek keyboard): the student means mega, and a
  // plain M is milli in SPICE, so the fixes are mega-as-milli's, never "Write 10M" (look-alike-letter-4).
  // Neither keeps anything: ngspice reads neither mega nor milli, so the milli fix says what it writes.
  if (!hidden && lookAlikeOf(ch) === 'M' && meant.scale?.name === 'milli' && letter && unit !== undefined) {
    const digits = numberPart(meant);
    const base = readNumber(digits)?.value ?? 0;
    const big = letter === 'R' || 'EFGH'.includes(letter);
    const mega = fix(`Make it ${digits}meg (${amount(base * 1e6, letter)})`, replace(t, `${digits}meg`));
    const milli = fix(`Make it ${digits}m (${amount(base * 1e-3, letter)})`, replace(t, `${digits}m`));
    const tail = reads('look-alike-letter-4, mega-as-milli-1');
    add(c, id, tail.stops ? 'error' : 'warning', t,
      big ? `${subject} is read as ${shown(read.value)}, not ${shown(base * 1e6)}` : `${subject} is read as ${shown(read.value)}`,
      `The value has ${what}. SPICE knows only the plain letter M, so it ignores this one like a unit. For mega, write meg (a capital M is milli in SPICE): ${digits}meg.`,
      `ngspice stops reading the number at ${what.replace(/, which .*$/, '')}${tail.text}`,
      big ? [mega, milli] : [milli, mega]);
    return;
  }
  // Where the character sits: what is read before it, and what it hides after it.
  const at = chars.indexOf(ch);
  const before = withoutInvisible(chars.slice(0, at).join(''));
  const after = withSpaces(cleanWord(chars.slice(at + 1).join(''), true).clean);
   // A look-alike: what it looks like ("the plain letter k", "the plain - sign"), the character as
  // "the ..." ("the minus sign (U+2212)"), and the claim: letters from other alphabets are
  // look-alike-letter-1; the Kelvin sign, fullwidth digits and signs, minus signs and dashes, -3; the
  // decimal points of documents, -9.
  const like = lookAlikeOf(ch) ?? '';
  const isLetter = /[A-Za-z]/.test(like);
  const plain = /\d/.test(like) ? `the plain digit ${like}` : isLetter ? `the plain letter ${like}` : like === '.' ? 'the plain decimal point' : `the plain ${like} sign`;
  const the = what.replace(/, which .*$/, '').replace(/^an? /, 'the ');
  const claim = isLetter && /[Ͱ-ӿＡ-Ｚａ-ｚ]/.test(ch) ? 'look-alike-letter-1' : like === '.' && ch !== '．' ? 'look-alike-letter-9' : 'look-alike-letter-3';
  const tail = reads(hidden ? (INVISIBLE_CLAIMS.has(ch) ? 'invisible-character-1, invisible-character-2' : 'invisible-character-1, invisible-character-23') : claim);
  // Away from a part's value the number meant is said as written (0.1m, not 1e-4), as its fix writes it.
  add(c, id, tail.stops ? 'error' : 'warning', t, `${subject} is read as ${shown(read.value)}, not ${letter && unit !== undefined ? shown(meant.value) : clean}`,
    hidden
      ? `${capital(what)} sits between ${before} and ${after}: a character you cannot see, which often comes with text copied from a web page or a PDF. SPICE stops reading the number at it, so the ${after} after it does not count. Write ${clean}.`
      : `The value has ${what}. SPICE knows only ${plain}, so it ignores this one like a unit${after ? `, and the ${after} after it` : ''}. Write ${clean}.`,
    hidden
      ? `ngspice stops reading the number at the ${nameOfCharacter(ch)!.replace(/^an? /, '').replace(/ \(U\+[0-9A-F]+\)$/, '')} and ignores the rest of the word${tail.text}`
      : `ngspice stops reading the number at ${the}${tail.text}`,
    fixes);
}

/**
 * A part's value with the letter O where a zero belongs (zeroForLetterO): 1Ok is 1 Ω and 1О00 is 1 Ω,
 * and O.47k is no number at all, so ngspice stops (look-alike-letter-10, -11, -15). What ngspice says of
 * the number it reads is readTail's: nothing on R, V and I, a model warning on C and L, and on a
 * resistor read as 0, ngspice 47's warning. The fix writes the zero, never a comment that would leave
 * the part with no value. True when found.
 */
function checkLetterO(c: Ctx, t: Token, letter: ElementLetter, name: string, line?: number): boolean {
  const meantText = zeroForLetterO(t.text, letter);
  const meant = meantText === undefined ? undefined : readNumber(meantText);
  if (!meantText || !meant) return false;
  const read = readNumber(t.text);
  if (read && read.value === meant.value) return false;
  // The first O that is read as a letter, as the student sees it, with the Os right after it (1OOk).
  const chars = [...t.text];
  const isO = (ch: string): boolean => /^[Oo]$/.test(cleanWord(ch, true).clean);
  const at = chars.findIndex(isO);
  let end = at;
  while (end < chars.length && isO(chars[end]!)) end += 1;
  const many = end - at > 1 && chars.slice(at, end).every((x) => /[Oo]/.test(x));
  const ch = chars[at]!;
  const the = many ? `the letters ${chars.slice(at, end).join('')}` : /[Oo]/.test(ch) ? `the letter ${ch}` : describeCharacter(ch).replace(/, which .*$/, '');
  const what = valueWord(letter);
  const fixes = [fix(`Write ${meantText} (${amount(meant.value, letter)})`, replace(t, meantText))];
  if (!read) {
    add(c, 'look-alike-letter', 'error', t, `${name}'s ${what} starts with the letter O, not the digit 0`,
      `It starts with ${the}, which looks like the digit 0, so SPICE does not read the word as a number. Write ${meantText}.`,
      `ngspice stops: 'unknown parameter (${ngspiceSpelling(t.text)})'. [look-alike-letter-11]`,
      fixes);
    return true;
  }
  const before = withoutInvisible(chars.slice(0, at).join(''));
  const after = cleanWord(chars.slice(many ? end : at + 1).join(''), true).clean;
  const them = many ? 'them' : 'it';
  const tail = readTail(read.value, amount(read.value, letter), 'look-alike-letter-10, look-alike-letter-15', { letter, who: line === undefined ? [lowerAscii(name)] : printedNames(c, line), model: 'look-alike-letter-7', e: line === undefined ? undefined : el(c, line) });
  add(c, 'look-alike-letter', 'warning', t, `${name}'s ${what} is read as ${amount(read.value, letter)}, not ${amount(meant.value, letter)}`,
    `The ${what} has ${the} after the ${before}, not ${many ? `the digits ${'0'.repeat(end - at)}` : 'the digit 0'}. SPICE stops reading the number at a letter, so it ignores ${them}${after ? ` and the ${after} after ${them}` : ''}. Write ${meantText}.`,
    `ngspice stops reading the number at ${the}${tail.text}`,
    fixes);
  return true;
}

/** The invisible characters of the first runs (invisible-character-1, -2); the others are invisible-character-23's. */
const INVISIBLE_CLAIMS = new Set(['\u00ad', '\u200b', '\u200c', '\u200d', '\u200e', '\u200f', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2060', '\u2061', '\u2062', '\u2063', '\u2064', '\u2066', '\u2067', '\u2068', '\u2069', '\ufeff']);

/**
 * A part's number that stops at a character outside plain ASCII that no check above knows, with a
 * digit right after it, as a separator inside the number would be (4。7k, 4•7k): ngspice writes each
 * such byte as _ and stops reading the number there, without a message (W16; look-alike-letter-12),
 * so the value is read short. What was meant is not clear, so there is no fix; the words name the
 * character. The Greek mu and the micro sign have their own checks.
 */
function checkStrayCharacter(c: Ctx, t: Token, unit: string | undefined, letter: ElementLetter | undefined, name: string | undefined, line?: number): void {
  if (!letter || unit === undefined || !name) return;
  const read = readNumber(t.text);
  if (!read?.ignored) return;
  const [ch, next] = [...read.ignored];
  const code = ch!.codePointAt(0)!;
  if (code < 0x80 || ch === 'μ' || next === undefined || !/^\d/.test(next) || lookAlikeOf(ch!) !== undefined) return;
  const what = describeCharacter(ch!);
  const after = [...read.ignored].slice(1).join('');
  const tail = readTail(read.value, amount(read.value, letter), 'look-alike-letter-12', { letter, who: line === undefined ? [lowerAscii(name)] : printedNames(c, line), model: 'look-alike-letter-7', e: line === undefined ? undefined : el(c, line) });
  add(c, 'look-alike-letter', 'warning', t, `${name}'s ${valueWord(letter)} is read as ${amount(read.value, letter)}`,
    `The ${valueWord(letter)} has ${what}, which is no part of a number for SPICE: it stops reading the number there, so the ${after} after it does not count.`,
    `ngspice stops reading the number at ${what}${tail.text}`);
}

/**
 * A value with a character that looks like a space in it (critic of the final-review fixes, security
 * review F2): ngspice reads the character as part of the word, so the number ends there and the rest
 * is ignored: 4.7<thin space>kΩ is 4.7 Ω, 10<thin space>000 is 10, 10<thin space>000<thin space>Ω is
 * 10 Ω (space-character-1 to -3, -7, -8, nbsp-2), and a word that starts with one is no number, so
 * ngspice stops (space-character-5). The word is read the way documents write values (spacedValue): a
 * number, the space, a scale letter and a unit, or groups of digits with or without a unit. Flagged
 * when that differs from what ngspice reads, with a fix that writes it for SPICE ("Write 4.7k"; after
 * a capital M, mega or milli, as mega-as-milli offers them). A number written some other way is
 * flagged, when it is a part's value, if taking the characters out changes what ngspice reads, and the
 * fix takes them out (space-character-11). Never "Replace it with a normal space" inside a part's value:
 * 10 000 Ω would be three words, and ngspice stops (space-character-9). Any other word (a source's
 * PULSE(0<thin space>1 ..., an analysis line) not written as a value is two numbers glued, and a word
 * that is no number at all is left to checkSpaces. The words name the character, never show it.
 */
function checkSpaceInValue(c: Ctx, t: Token, unit: string | undefined, letter: ElementLetter | undefined, name: string | undefined, place?: Place, line?: number): void {
  const chars = [...t.text];
  const ch = chars.find((x) => SPACE_LIKE.test(x))!;
  const id: TrapId = ch === '\u00a0' ? 'nbsp' : 'space-character';
  const what = describeCharacter(ch);
  const bare = nameOfCharacter(ch, false)!.replace(/^an? /, '');
  const subject = place?.subject ?? (name ? `${name}'s ${valueWord(letter)}` : 'This value');
  const shown = (v: number): string => (letter && unit !== undefined ? amount(v, letter) : formatNumber(v));
  if (SPACE_LIKE.test(chars[0]!)) {
    const clean = withoutSpaces(t.text);
    const r = readNumber(clean);
    if (!r || r.rest) return;
    c.spaced.add(t.from);
    c.meant.set(t.from, { value: r.value, text: clean });
    add(c, id, 'error', t, `${subject} is not a number for SPICE`,
      `It starts with ${what}, which looks like a space but is none for SPICE (it often comes with text copied from a document or a web page), so SPICE does not read the word as a number. Write ${clean}.`,
      place ? unreadSays(place, ngspiceSpelling(t.text), r.value) : `ngspice stops: 'unknown parameter (${ngspiceSpelling(t.text)})'. [space-character-5]`,
      [fix(`Write ${clean}${letter && unit !== undefined ? ` (${amount(r.value, letter)})` : ''}`, replace(t, clean))]);
    return;
  }
  // A sign, then characters that look like a space (-<thin space>5): the word is no number either, and
  // ngspice stops. Said as for an invisible character there, the place first, and the fix writes the
  // sign and the number together, the rest read as documents write values (-<thin space>5<thin space>V
  // is -5). Never "Replace it with a normal space": - 5 stops ngspice too, at the - (re-check C2;
  // space-character-12, -13, -14, nbsp-3).
  const sign = chars[0] === '-' || chars[0] === '+' ? chars[0] : lookAlikeOf(chars[0]!);
  if ((sign === '-' || sign === '+') && SPACE_LIKE.test(chars[1] ?? '')) {
    let k = 1;
    while (k < chars.length && SPACE_LIKE.test(chars[k]!)) k += 1;
    const body = chars.slice(k).join('');
    const spaced = hasSpaceLike(body) ? spacedValue(body) : undefined;
    const written = `${sign}${spaced ? spaced.spice : body}`;
    const r = readNumber(written);
    if (!r || r.rest || (hasSpaceLike(body) && !spaced)) return;
    c.spaced.add(t.from);
    c.meant.set(t.from, { value: r.value, text: written });
    const ascii = chars[0] === sign;
    add(c, id, 'error', t, `${subject} is not a number for SPICE`,
      `${ascii ? `Right after the ${sign}, it has ${what}` : `It starts with ${describeCharacter(chars[0]!)}, then ${what}`}, which looks like a space but is none for SPICE (it often comes with text copied from a document or a web page), so SPICE does not read the word as a number. Write ${written}.`,
      place ? unreadSays(place, ngspiceSpelling(t.text), r.value) : `ngspice stops: 'unknown parameter (${ngspiceSpelling(t.text)})'. [${!ascii ? 'space-character-14' : id === 'nbsp' ? 'nbsp-3' : 'space-character-12'}]`,
      [fix(`Write ${written}${letter && unit !== undefined ? ` (${amount(r.value, letter)})` : ''}`, replace(t, written))]);
    return;
  }
  const meant = spacedValue(t.text);
  const read = readNumber(t.text);
  // A part's value written some other way: one value all the same, never split into words. Elsewhere
  // (a source's PULSE(0<thin space>1 ..., an analysis line) such a word is two numbers glued: checkSpaces'.
  const main = letter !== undefined && unit !== undefined;
  if (!read || (!meant && !main)) return;
  c.spaced.add(t.from);
  // What ngspice does with the number it reads (readTail): on a part's value nothing, but a capacitor's or
  // an inductor's word is also looked up as a model name (greek-mu-2, space-character-8), and a resistor
  // read as 0 is too small for ngspice 47; elsewhere, what the place does with it.
  const model = letter === 'C' || letter === 'L';
  const stops = (claims: string, value: number, text: string): { text: string; stops: boolean } => {
    c.meant.set(t.from, { value, text });
    const tail = readTail(read.value, shown(read.value), claims, { letter, who: line === undefined ? undefined : printedNames(c, line), place, meant: value, spelled: ngspiceSpelling(t.text), model: 'space-character-8', e: line === undefined ? undefined : el(c, line) });
    return { text: `ngspice stops reading the number at the ${bare} and ignores the rest of the word${tail.text}`, stops: tail.stops };
  };
  if (!meant) {
    // Not written the way documents write a value (1<thin space>2, 0.000<thin space>001): say what ngspice
    // reads, and offer to take the characters out when that changes it.
    const clean = withoutSpaces(t.text);
    const meantClean = readNumber(clean);
    if (!meantClean || meantClean.rest || meantClean.value === read.value) return;
    const at = chars.findIndex((x) => SPACE_LIKE.test(x));
    const before = chars.slice(0, at).join('');
    const after = withSpaces(chars.slice(at + 1).join(''));
    const several = chars.filter((x) => SPACE_LIKE.test(x)).length > 1;
    const said = stops('space-character-11', meantClean.value, clean);
    add(c, id, said.stops ? 'error' : 'warning', t, `${subject} is read as ${shown(read.value)}`,
      `${capital(what)} sits between ${before} and ${after} (it often comes with text copied from a document or a web page). It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the ${after} after it does not count. Without ${several ? 'these characters' : 'it'}, the value reads ${clean}.`,
      said.text,
      [fix(`Take ${several ? 'them' : 'it'} out: write ${clean} (${shown(meantClean.value)})`, replace(t, clean))]);
    return;
  }
  // After the scale letter it changes nothing: 4.7k<thin space>Ω is 4.7 kΩ (space-character-6).
  if (read.value === meant.value) return;
  const digits = meant.kind === 'digits';
  const grouped = digits ? (meant.unit || meant.spaces > 1 ? 'space-character-7' : 'space-character-3') : '';
  const claim = [
    ch === '\u00a0' ? 'nbsp-2' : ch === '\u2009' ? (digits ? '' : 'space-character-1') : 'space-character-2',
    grouped,
    model ? 'space-character-8' : '',
  ]
    .filter(Boolean)
    .join(', ');
  // A capital M is mega in a document and milli in SPICE: both spellings, as mega-as-milli offers them.
  const big = letter === 'R' || (letter !== undefined && 'EFGH'.includes(letter));
  const fixes: Fix[] = [];
  if (meant.milli) {
    const mega = fix(`Make it ${meant.spice} (${shown(meant.value)})`, replace(t, meant.spice));
    const milli = fix(`Make it ${meant.milli.spice} (${shown(meant.milli.value)})`, replace(t, meant.milli.spice));
    fixes.push(...(big ? [mega, milli] : [milli, mega]));
  } else fixes.push(fix(`Write ${meant.spice}${letter && unit !== undefined ? ` (${shown(meant.value)})` : ''}`, replace(t, meant.spice)));
  const write = meant.unit
    ? `SPICE needs no space and no units${meant.milli ? `, and a capital M is milli in SPICE: for mega, write meg: ${meant.spice}` : `: write ${meant.spice}`}.`
    : `Write the number without ${meant.spaces > 1 ? 'them' : 'it'}: ${meant.spice}.`;
  const said = stops(claim, meant.value, meant.spice);
  add(c, id, said.stops ? 'error' : 'warning', t,
    meant.milli && !big ? `${subject} is read as ${shown(read.value)}` : `${subject} is read as ${shown(read.value)}, not ${main ? shown(meant.value) : meant.spice}`,
    `${capital(what)} sits between ${meant.before} and ${meant.next}, as documents ${digits ? 'group digits' : 'write a number and its unit'}. It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the ${meant.after} after it does not count. ${write}`,
    said.text,
    fixes);
}

/**
 * Every value word of a part line through checkOddValue: the part's own value by the part's rules, a
 * word of a source's function, of its AC value or of a setting by its place (partPlaces), and a place no
 * run shows left alone (re-check critic CR1-5). In one pass, so a PWL of thousands of points stays linear
 * (CR2-2). The number after a sign standing alone where the value goes (- 1<zero-width space>0) is the sign
 * branch's of unknown-word, which says the line stops at the sign (CR2-6).
 */
function checkOddValues(c: Ctx, i: number): void {
  const e = el(c, i);
  // The words the checks before this one explain (4·7 kΩ: the space before the unit): a few traps at most.
  const last = e.fields[e.fields.length - 1]!.token.from;
  const before: Trap[] = [];
  for (let ln = lineAt(c.n, e.name.from).number; ln <= lineAt(c.n, last).number; ln++) before.push(...(c.byLine.get(ln) ?? []));
  const places = placesOf(c, i);
  const firstOther = e.value ? -1 : e.fields.findIndex((x) => x.role === 'other');
  const signed = signSplit(c, e);
  if (signed) c.spaced.add(signed.next.token.from);
  // A character that looks like a space in a formula is no value's: checkFormulaSpaces' (CR1-2).
  const formula = formulaOf(c, e);
  e.fields.forEach((f, k) => {
    if (f.role === 'name' || f.role === 'model' || NODE_ROLES.has(f.role) || f === signed?.next) return;
    if (formula && f.token.from >= formula.from && hasSpaceLike(f.token.text)) return;
    if (before.some((t) => t.span.from <= f.token.from && f.token.to <= t.span.to)) return;
    const place = places[k];
    if (place === null) return;
    if (place) {
      checkOddValue(c, f.token, undefined, undefined, undefined, place, i);
      return;
    }
    const main = e.value?.token === f.token || k === firstOther;
    checkOddValue(c, f.token, main && e.letter ? (UNIT[e.letter] ?? '') : undefined, main ? e.letter : undefined, main ? nameOf(e) : undefined, undefined, main ? i : undefined);
  });
}

/** A part line's places (partPlaces), worked out once for the checks that read them. */
function placesOf(c: Ctx, i: number): (Place | null | undefined)[] {
  let places = c.places.get(i);
  if (!places) {
    places = partPlaces(c, i);
    c.places.set(i, places);
  }
  return places;
}

/**
 * A sign standing alone where the part's value goes, a space after it, then a number (`- 5`, `- 1<zero-width
 * space>0`): two words for SPICE, and a sign alone is no number (space-character-13). The value meant is the
 * sign and the number written together, with any character that is not what it looks like taken out, so the
 * fix never writes one back and its label never shows one (re-check C2, critic CR2-6).
 */
function signSplit(c: Ctx, e: Element): { sign: Field; next: Field; joined: string } | undefined {
  if (e.value) return undefined;
  const k = e.fields.findIndex((f) => f.role === 'other');
  const f = e.fields[k];
  const next = e.fields[k + 1];
  if (!f || !next || e.fields.slice(0, k).some((x) => x.role === 'parameter' || x.role === 'source-function' || x.role === 'model')) return undefined;
  const sign = cleanWord(f.token.text, true).clean;
  if (!/^[+-]$/.test(sign) || !readNumber(next.token.text) || !/^[ \t]+$/.test(c.text.slice(f.token.to, next.token.from))) return undefined;
  const body = cleanWord(next.token.text, true).clean;
  const joined = `${sign}${hasSpaceLike(body) ? (spacedValue(body)?.spice ?? withoutSpaces(body)) : body}`;
  const r = readNumber(joined);
  return r && !r.rest ? { sign: f, next, joined } : undefined;
}

/** Number-like words with the Greek letter mu, which ngspice ignores (the micro sign works). */
function checkGreekMu(c: Ctx): void {
  const looksLikeNumber = /^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?\u03bc/;
  const visit = (t: Token, unit: string | undefined, letter?: ElementLetter, who?: readonly string[], place?: Place, beside?: boolean): void => {
    if (!looksLikeNumber.test(t.text)) return;
    const r = readNumber(t.text);
    if (!r) return;
    const shown = unit === undefined ? formatNumber(r.value) : formatSI(r.value, unit);
    const meant = t.text.replaceAll('\u03bc', 'u');
    const meantValue = readNumber(meant)?.value;
    if (meantValue !== undefined) c.meant.set(t.from, { value: meantValue, text: meant });
    // greek-mu-2: a capacitor's or an inductor's value word is also looked up as a model name. At a place of
    // its own, what the place does with the number read (analysisPlace, partPlaces; re-check critics CR1-2,
    // CR2-1, CR2-3): never "says nothing" where the line stops, warns or has a problem of its own.
    const model = letter === 'C' || letter === 'L';
    const v = place?.verdict(r.value, meantValue, ngspiceSpelling(t.text));
    add(
      c,
      'greek-mu',
      v?.kind === 'own' && v.stops ? 'error' : 'warning',
      t,
      `${t.text} is read as ${shown}: SPICE ignores this \u03bc`,
      `This \u03bc is the Greek letter mu, not the micro sign \u00b5 that SPICE knows (phone keyboards often type the Greek one). SPICE ignores it like a unit. Write u for micro: ${meant}.`,
      model
        ? `ngspice reads ${t.text} as ${shown}; it only warns that it can't find a model called '${lowerAscii(t.text)}'. [greek-mu-2]`
        : v?.kind === 'own'
          ? `ngspice reads ${t.text} as ${shown}, ${v.says} [${claimList('greek-mu-1', v.claims)}]`
          : v?.kind === 'silent'
            ? `ngspice reads ${t.text} as ${shown} and says nothing. [${claimList('greek-mu-1', v.claims)}]`
            : v
              ? `ngspice reads ${t.text} as ${shown}. [${claimList('greek-mu-1', v.claims)}]`
              : beside
                ? `ngspice reads ${t.text} as ${shown}. [greek-mu-1]`
                : saysNothing(`ngspice reads ${t.text} as ${shown}`, 'greek-mu-1', letter, who, r.value),
      [fix(`Write u for micro: ${meant}`, replace(t, meant))],
    );
  };
  for (const i of c.n.elements) {
    const e = el(c, i);
    // A word of a source's function or a setting is said by its place, as the character checks say it.
    const places = e.fields.some((f) => looksLikeNumber.test(f.token.text)) ? placesOf(c, i) : [];
    e.fields.forEach((f, k) => {
      if (f.role === 'name' || f.role === 'model' || NODE_ROLES.has(f.role) || places[k] === null) return;
      const main = e.value?.token === f.token;
      // A source's value beside a function may differ from the function's value at time 0, of which ngspice makes a note: no claim.
      const beside = main && (e.letter === 'V' || e.letter === 'I') && e.sourceFunction !== undefined;
      visit(f.token, main && e.letter ? (UNIT[e.letter] ?? '') : undefined, main ? e.letter : undefined, main ? printedNames(c, i) : undefined, places[k] ?? undefined, beside);
    });
  }
  // On an analysis line only at a place a run shows (analysisPlace).
  for (const i of c.n.analyses) {
    const d = c.n.lines[i]!.directive!;
    d.args.forEach((t, k) => {
      const place = analysisPlace(c, d, k);
      if (place) visit(t, undefined, undefined, undefined, place);
    });
  }
}

/** Main value fields of a part, in order. */
const mainFields = (e: Element): Field[] => e.fields.filter((f) => MAIN_ROLES.has(f.role));

/**
 * "ngspice reads two numbers, 1 and 5k, keeps the second one and says nothing: R1 gets 5 kΩ" (decimal
 * comma, a sign inside the value), with the model warning on C and L, and ngspice 47's warning when a
 * resistor gets 0 (zeroOhm: 1,0 is 0 Ω for ngspice; re-check critic CR1-1).
 */
function keepsSecond(first: string, second: string, written: string, e: Element, value: number | undefined, claims: string, who: readonly string[] | undefined): string {
  const gets = `${nameOf(e)} gets ${value !== undefined ? amount(value, e.letter) : second}`;
  const zero = value === undefined ? undefined : zeroOhm(e.letter, value, who);
  if (zero) return `ngspice reads two numbers, ${first} and ${second}, and keeps the second one: ${gets}, ${zero.says} [${claims}, ${zero.claims}]`;
  return `ngspice reads two numbers, ${first} and ${second}, keeps the second one and says nothing${e.letter === 'C' || e.letter === 'L' ? ` except a warning that it can't find a model called '${lowerAscii(written)}'` : ''}: ${gets}. [${claims}]`;
}

function checkDecimalComma(c: Ctx, i: number): void {
  const e = el(c, i);
  if (!e.letter || !VALUE_LETTERS.has(e.letter)) return;
  for (const f1 of mainFields(e)) {
    const f2 = fieldAfter(e, f1);
    if (!f2 || !/^[+-]?\d+$/.test(f1.token.text) || c.text[f1.token.to] !== ',' || f2.token.from !== f1.token.to + 1) continue;
    if (!/^\d/.test(f2.token.text)) continue;
    const meant = `${f1.token.text}.${f2.token.text}`;
    const span = { from: f1.token.from, to: f2.token.to };
    const written = c.text.slice(span.from, span.to);
    const second = readNumber(f2.token.text);
    const passive = e.letter === 'R' || e.letter === 'C' || e.letter === 'L';
    const source = e.letter === 'V' || e.letter === 'I';
    const ngspice = passive
      ? keepsSecond(f1.token.text, f2.token.text, written, e, second?.value, 'decimal-comma-1, decimal-comma-2, decimal-comma-3', printedNames(c, i))
      : source
        ? `ngspice stops: 'unknown parameter (${ngspiceSpelling(f2.token.text)})'. [decimal-comma-4, decimal-comma-5]`
        : `PlainSpice's engine stops: 'unknown parameter (${ngspiceSpelling(f2.token.text)})'. Native ngspice 47, which has the XSPICE extension, reads the two numbers as the coefficients of a polynomial instead. [decimal-comma-6, decimal-comma-7, decimal-comma-8, decimal-comma-9]`;
    add(
      c,
      'decimal-comma',
      passive ? 'warning' : 'error',
      span,
      `${written}: SPICE reads the comma as a space`,
      `SPICE writes decimals with a point. A comma separates words, so ${written} is two numbers, ${f1.token.text} and ${f2.token.text}.`,
      ngspice,
      [fix(`Write ${meant}`, replace(span, meant))],
    );
    return;
  }
}

/**
 * "1k-2" or "1d-3" as the value of R, C or L: a + or − after a digit or letter starts a new number
 * in ngspice, so it reads two numbers and the part silently takes the second: −2 Ω, −3 Ω
 * (sign-in-value-1, N9, N10). On C and L ngspice also warns that it can't find a model named after
 * the whole word (sign-in-value-2). On V, I, E, F, G and H ngspice stops instead: unknown-word.
 */
function checkSignInValue(c: Ctx, i: number): void {
  const e = el(c, i);
  if (e.letter !== 'R' && e.letter !== 'C' && e.letter !== 'L') return;
  for (const f1 of mainFields(e)) {
    const f2 = fieldAfter(e, f1);
    if (!f2 || !MAIN_ROLES.has(f2.role) || f2.token.from !== f1.token.to || !/^[+-]\d/.test(f2.token.text)) continue;
    const first = readNumber(f1.token.text);
    const second = readNumber(f2.token.text);
    if (!first || !second) continue;
    const span = { from: f1.token.from, to: f2.token.to };
    const written = c.text.slice(span.from, span.to);
    const shownSecond = f2.token.text.replace(/^-/, MINUS);
    const fixes: Fix[] = [];
    // "1d-3" meant as an exponent: SPICE writes it with e.
    const exponent = /^([+-]?\d+\.?\d*|[+-]?\.\d+)[dDeE]$/.exec(f1.token.text);
    const meant = exponent ? `${exponent[1]}e${f2.token.text}` : undefined;
    if (meant && readNumber(meant)) fixes.push(fix(`Write ${meant} (${amount(readNumber(meant)!.value, e.letter)})`, replace(span, meant)));
    else fixes.push(fix(`Keep ${f1.token.text} (${amount(first.value, e.letter)})`, replace(span, f1.token.text)));
    add(
      c,
      'sign-in-value',
      'warning',
      span,
      `${written}: SPICE reads two numbers, ${f1.token.text} and ${shownSecond}`,
      `A + or ${MINUS} right after a digit or a letter starts a new number in SPICE, so ${written} is two numbers, and ${nameOf(e)} takes the second one. For an exponent, write e: 1e-3.`,
      keepsSecond(f1.token.text, f2.token.text, written, e, second.value, e.letter === 'R' ? 'sign-in-value-1' : 'sign-in-value-2', printedNames(c, i)),
      fixes,
    );
    return;
  }
}

/** A scale letter, a unit, or both, written as a separate word after a number: "k", "V", "kOhm". */
const SUFFIX = /^(meg|mil|[tgkmunpfa\u00b5])?(ohms?|\u03a9|volts?|v|amps?|a|f|h|hz|s)?$/i;

/**
 * What ngspice does with "1 k" and the like, by part and word. Some words are names of the part's
 * own settings: m is the multiplier of R, C, L, I, G and F, so "1 m" runs with a multiplier of 0;
 * p (and v on an inductor) can only be read back, not set [space-before-suffix-1 ... -14].
 */
function suffixVerdict(letter: ElementLetter, word: string, name: string): string {
  const w = lowerAscii(word);
  // As ngspice quotes the word: µ as u, Ω as __ (space-before-suffix-16, -17; W16).
  const said = ngspiceSpelling(word);
  if (w === 'm') {
    const silent: Partial<Record<ElementLetter, string>> = {
      R: `${name} then carries no current at all`,
      C: `${name} then has no capacitance at all`,
      I: `${name} then pushes no current at all`,
    };
    const text = silent[letter];
    if (text) return `ngspice takes m as ${name}'s multiplier, given no value, and says nothing: ${text}.${letter === 'R' ? " (It only warns that it can't find a model called m.)" : ''} [space-before-suffix-7, space-before-suffix-8, space-before-suffix-10]`;
    if (letter === 'L') return `ngspice takes m as ${name}'s multiplier, given no value, and says nothing; a .tran then stops: 'Timestep too small'. [space-before-suffix-9]`;
    if (letter === 'G' || letter === 'F') return `PlainSpice's engine takes m as ${name}'s multiplier, given no value, and says nothing: ${name} then gives no current. Native ngspice 47, which has the XSPICE extension, reads the extra word as part of a polynomial and stops: 'MIF-ERROR ... Bad real value'. [space-before-suffix-11]`;
  }
  if ((w === 'p' && 'RCL'.includes(letter)) || (w === 'v' && letter === 'L')) {
    return `ngspice stops: 'no such parameter on this device or parameter is missing' (${w} is a value ngspice can report for the part, not one you can set). [space-before-suffix-12]`;
  }
  if ('EFGH'.includes(letter)) {
    // p, v (and i) name values E, F, G and H can only report: a different message (space-before-suffix-15).
    const message = isReportOnlyParameter(letter, w) ? 'no such parameter on this device or parameter is missing' : `unknown parameter (${said})`;
    return `PlainSpice's engine stops: '${message}'. Native ngspice 47, which has the XSPICE extension, reads the extra word as part of a polynomial and stops too: 'MIF-ERROR ... Bad real value'. [space-before-suffix-6, space-before-suffix-13, space-before-suffix-14, space-before-suffix-15]`;
  }
  if (letter === 'R') return `ngspice looks for a model called ${w}, warns 'can't find model', and stops: 'unknown parameter (${said})'. [space-before-suffix-1${said !== w ? ', space-before-suffix-16' : ''}]`;
  return `ngspice stops: 'unknown parameter (${said})'. [space-before-suffix-2, space-before-suffix-3, space-before-suffix-4, space-before-suffix-5${said !== w ? ', space-before-suffix-17' : ''}]`;
}

function checkSpaceBeforeSuffix(c: Ctx, i: number): void {
  const e = el(c, i);
  if (!e.letter || !VALUE_LETTERS.has(e.letter)) return;
  const f1 = mainFields(e).find((f) => readNumber(f.token.text));
  // The number as a document wrote it: 4·7 kΩ from a British document is 4.7 and kΩ (re-check C5).
  const n0 = f1?.token.text ?? '';
  const odd = cleanWord(n0, true).odd[0];
  const r = f1 ? readNumber(cleanWord(n0, true).clean) : undefined;
  if (!f1 || !r || r.scale || r.ignored || r.rest) return;
  const f2 = fieldAfter(e, f1);
  if (!f2 || f2.role === 'model' || NODE_ROLES.has(f2.role)) return;
  if (!/^[ \t]+$/.test(c.text.slice(f1.token.to, f2.token.from))) return;
  const m = SUFFIX.exec(f2.token.text);
  if (!m || (!m[1] && !m[2]) || /^\s*=/.test(c.text.slice(f2.token.to, f2.token.to + 8))) return;
  let scale = m[1] ?? '';
  // A lone a/A or f/F after a number is a unit (amps, farads), not atto or femto.
  if (!m[2] && /^[af]$/i.test(scale)) scale = '';
  const n = cleanWord(n0, true).clean;
  const span = { from: f1.token.from, to: f2.token.to };
  const written = c.text.slice(span.from, span.to);
  const fixes: Fix[] = [];
  if (scale === 'M') {
    // ngspice reads neither: the M is a word of its own (a setting, or unknown). So the milli fix says what it writes.
    fixes.push(fix(`Make it ${n}meg (${amount(r.value * 1e6, e.letter)})`, replace(span, `${n}meg`)), fix(`Make it ${n}m (${amount(r.value * 1e-3, e.letter)})`, replace(span, `${n}m`)));
  } else {
    const joined = `${n}${scale === '\u00b5' ? 'u' : scale.toLowerCase()}`;
    fixes.push(fix(`Write ${joined}`, replace(span, joined)));
  }
  add(
    c,
    'space-before-suffix',
    'error',
    span,
    `${written}: the space splits the value in two`,
    odd
      ? `SPICE reads ${written} as two words, ${n0} and ${f2.token.text}, and stops reading ${n0} at ${describeCharacter(odd).replace(/, which .*$/, '').replace(/^an? /, 'the ')}. Write ${fixes[0]!.changes[0]!.insert}.`
      : scale
        ? `SPICE reads ${written} as two words: the number ${n}, then ${f2.token.text} as a separate word. Write the letter right after the number.`
        : `SPICE reads ${written} as two words: the number ${n}, then ${f2.token.text} as a separate word. SPICE needs no units: write the number alone.`,
    odd ? suffixVerdict(e.letter, f2.token.text, nameOf(e)).replace(/\]$/, ', space-before-suffix-18]') : suffixVerdict(e.letter, f2.token.text, nameOf(e)),
    fixes,
  );
}

function checkMidlineComment(c: Ctx, i: number): void {
  const e = el(c, i);
  if (!e.letter || !VALUE_LETTERS.has(e.letter)) return;
  const f = e.fields.find((x) => x.role === 'other' && /^[*#/]/.test(x.token.text));
  if (!f) return;
  const ch = f.token.text[0]!;
  add(
    c,
    'midline-comment',
    'error',
    f.token,
    `${ch} in the middle of a line is not a comment`,
    `A ${ch} starts a comment only at the beginning of a line. For a comment after a part, use a semicolon: ; like this.`,
    'EFGH'.includes(e.letter)
      ? `PlainSpice's engine stops: 'unknown parameter (${ngspiceSpelling(f.token.text)})'. Native ngspice 47, which has the XSPICE extension, reads the rest as part of a polynomial and stops too: 'MIF-ERROR ... Bad real value'. [midline-comment-7, midline-comment-10, midline-comment-11, midline-comment-12]`
      : `ngspice stops: 'unknown parameter (${ngspiceSpelling(f.token.text)})'. [midline-comment-1 ... midline-comment-6, midline-comment-9]`,
    [fix('Use ; for the comment', change(f.token.from, f.token.from + 1, ';'))],
  );
}

/** The runs of a word where each part's value goes (unknown-word-13 to -21; a name in braces with .param: unknown-word-23). */
const VALUE_PLACE_CLAIMS: Readonly<Record<string, string>> = {
  R: 'unknown-word-13', C: 'unknown-word-14', L: 'unknown-word-15', V: 'unknown-word-16', I: 'unknown-word-17',
  E: 'unknown-word-18', F: 'unknown-word-19', G: 'unknown-word-20', H: 'unknown-word-21',
};

/**
 * A word after a part's value that ngspice can't use there: not a parameter of the part, a value
 * the part can only report, or one number too many. ngspice stops at it (unknown-word-1 ... -11).
 * Words that a more specific trap explains (a comma, a space before a scale letter, a mid-line
 * comment) are left to that trap.
 */
function checkUnknownWord(c: Ctx, i: number): void {
  const e = el(c, i);
  if (!e.letter || !VALUE_LETTERS.has(e.letter)) return;
  const k = e.fields.findIndex((f) => f.role === 'other');
  const f = e.fields[k];
  if (!f || (c.byLine.get(lineAt(c.n, f.token.from).number) ?? []).some((t) => t.span.from <= f.token.from && f.token.to <= t.span.to)) return;
  const word = f.token.text;
  // A word with a character that is not what it looks like, at a place no run shows (in AM( ), TRNOISE( ) ...),
  // is left alone, as the character checks leave it (partPlace; re-check critic CR1-5).
  if (placesOf(c, i)[k] === null && (hasInvisible(word) || hasSpaceLike(word) || cleanWord(word, true).odd.length > 0)) return;
  const name = nameOf(e);
  const kind = { R: 'a resistor', C: 'a capacitor', L: 'an inductor', V: 'a voltage source', I: 'a current source', E: 'an E line', F: 'an F line', G: 'a G line', H: 'an H line' }[e.letter as 'R'];
  const efgh = 'EFGH'.includes(e.letter);
  // A word where the value goes, with no value before it (re-check S6): a name from a .param line is
  // that value, as ngspice reads it (unknown-word-22, -23); any other word is no number, and ngspice
  // stops there, on E, F, G and H lines too (no polynomial: nothing came before it). Its words are
  // not a setting's, and there is no fix that comments it out, which would leave the part with no value.
  // Outside a subcircuit only a top-level .param line's names count, after .end too: not a subcircuit's
  // own parameters, a .param inside one, nor a .func's name (unknown-word-33 to -37; re-check critic CR1-7);
  // inside one, those and its own (and those of the subcircuits around it), never another's (CR2-5).
  if (!e.value && e.fields.slice(0, k).every((x) => x.role !== 'parameter' && x.role !== 'source-function' && x.role !== 'model')) {
    const chain = c.subOf.get(i) ?? [];
    const key = lowerAscii(word);
    if (c.topParams.has(key) || chain.some((sub) => c.subParams.get(sub)?.has(key) === true)) return;
    const what = efgh ? (e.letter === 'E' || e.letter === 'F' ? 'gain' : 'value') : 'value';
    // A sign with a space after it (- 5): two words, and a sign alone is no number (space-character-13).
    const signed = signSplit(c, e);
    if (signed?.sign === f) {
      const { next, joined } = signed;
      // What ngspice says, part by part (re-check critic CR1-3): E, F, G and H lines are read as a
      // polynomial by native ngspice 47 and 42 (both built with XSPICE); C and L look the word up as a
      // model first; R, V and I stop at the sign. The value is written without any character that is not
      // what it looks like, which the words never show (CR2-6).
      const quote = `'unknown parameter (${ngspiceSpelling(word)})'`;
      const says = efgh
        ? `PlainSpice's engine stops: ${quote}. Native ngspice 47 and 42 read the line as a polynomial and stop: 'MIF-ERROR ... Bad real value'. [unknown-word-${25 + 'EFGH'.indexOf(e.letter)}]`
        : e.letter === 'C' || e.letter === 'L'
          ? `ngspice looks for a model called ${lowerAscii(word)}, warns 'can't find model', and stops: ${quote}. [unknown-word-${e.letter === 'C' ? 29 : 30}]`
          : `ngspice stops: ${quote}. [${e.letter === 'V' ? 'space-character-13' : e.letter === 'R' ? 'unknown-word-31' : 'unknown-word-32'}]`;
      add(c, 'unknown-word', 'error', f.token, `${name}'s ${what} is not a number`,
        `The ${shownWord(word)} and the ${shownWord(next.token.text)} are two words for SPICE: a space after a sign splits the value in two, and a sign alone is no number, so SPICE stops there. Write ${joined}.`,
        says,
        [fix(`Write ${joined} (${amount(readNumber(joined)!.value, e.letter)})`, change(f.token.from, next.token.to, joined))]);
      return;
    }
    // A setting written name=value where the value goes (gm=1m): the part has no setting of that name, and
    // its value is the number alone. ngspice stops at the name, on every part, with no model warning and no
    // polynomial (unknown-word-42 to -50; re-check critic CR2-8).
    const after = e.fields[k + 1];
    if (after && /^[ \t]*=[ \t]*$/.test(c.text.slice(f.token.to, after.token.from))) {
      const value = readNumber(after.token.text) !== undefined && !/^[{']/.test(after.token.text) ? after.token.text : undefined;
      add(c, 'unknown-word', 'error', f.token, `${name} has no setting called ${shownWord(word)}`,
        `${shownWord(word)}=${shownWord(after.token.text)} stands where ${name}'s ${what} goes, but ${kind} has no setting called ${shownWord(word)}: its ${what} is the number alone, so SPICE stops there.${value ? ` Write ${shownWord(value)}.` : ''}`,
        `ngspice stops: 'unknown parameter (${ngspiceSpelling(word)})'. [unknown-word-${42 + 'RCLVIEFGH'.indexOf(e.letter)}]`,
        value && !hasInvisible(value) && !hasSpaceLike(value) ? [fix(`Write ${value}`, change(f.token.from, after.token.to, value))] : []);
      return;
    }
    const model = e.letter === 'R' || e.letter === 'C' || e.letter === 'L';
    const named = /^[A-Za-z_][A-Za-z0-9_]*$/.test(word);
    // A name with a value only inside a subcircuit, or a .func's, is said as what it is (unknown-word-33 to -35;
    // inside another subcircuit, -38 and -39).
    const inner = c.innerParams.get(key);
    const func = c.funcs.has(key);
    const within = chain.length > 0;
    const more = !named ? '' : func ? `, unknown-word-35${within ? ', unknown-word-39' : ''}` : inner !== undefined ? `, unknown-word-23, unknown-word-33, unknown-word-34${within ? ', unknown-word-38' : ''}` : ', unknown-word-23';
    add(c, 'unknown-word', 'error', f.token, `${name}'s ${what} is not a number`,
      !named
        ? `${word} stands where ${name}'s ${what} goes, but it is not a number for SPICE, so SPICE stops there. Write the number with the plain digits 0 to 9.`
        : func
          ? `${word} stands where ${name}'s ${what} goes, but it is the name of a function (on a .func line), not a number, so SPICE stops there. Write the number itself.`
          : inner !== undefined
            ? `${word} stands where ${name}'s ${what} goes, but it has a value only inside the subcircuit ${inner}, and this line is outside it, so SPICE stops there. Write the number itself, or give ${word} a value on a .param line outside the subcircuit and write it in braces: {${word}}.`
            : `${word} stands where ${name}'s ${what} goes, but it is not a number, and no .param line gives it a value, so SPICE stops there. Write the number itself, or give ${word} a value on a .param line and write it in braces: {${word}}.`,
      `${model ? `ngspice looks for a model called ${lowerAscii(word)}, warns 'can't find model', and stops` : 'ngspice stops'}: 'unknown parameter (${ngspiceSpelling(word)})'. [${VALUE_PLACE_CLAIMS[e.letter]}${more}]`);
    return;
  }
  const prev = e.fields[k - 1];
  const glued = prev !== undefined && prev.token.to === f.token.from && /^[+-]/.test(word);
  const number = readNumber(word) !== undefined;
  const report = isReportOnlyParameter(e.letter, word);
  // m= on an E or an H line (F and G take m, their multiplier): ngspice stops at it, natively too, with no
  // polynomial; another name=value there is read as part of a polynomial (unknown-word-40, -41; re-check critic CR2-8).
  const next = e.fields[k + 1];
  const multiplier = (e.letter === 'E' || e.letter === 'H') && lowerAscii(word) === 'm' && next !== undefined && /^[ \t]*=[ \t]*$/.test(c.text.slice(f.token.to, next.token.from));
  const why = glued
    ? `A + or ${MINUS} right after a digit or a letter starts a new word in SPICE, so ${prev.token.text}${word} is read as ${prev.token.text} and then ${word}, a word ${name} can't use. For an exponent, write e: 1e-3.`
    : report
      ? `${word} is a value SPICE can report for ${kind} (such as its current or its power), not one a netlist can set, so SPICE stops there.`
      : number
        ? `${efgh ? "PlainSpice's engine" : 'SPICE'} reads ${word} as one number too many for ${name}, so it stops there.`
        : `SPICE reads the words after a part's value as its settings, written name=value${multiplier ? '' : ' (like m=2)'}, and ${word} is not a setting of ${kind}, so it stops there. To add a note at the end of a line, start it with a semicolon: ; like this.`;
  // ngspice quotes the word as it spells it: each byte of a letter outside ASCII is _ (unknown-word-12, W16).
  const message = report ? 'no such parameter on this device or parameter is missing' : `unknown parameter (${ngspiceSpelling(word)})`;
  const spelled = ngspiceSpelling(word) !== lowerAscii(word) ? ', unknown-word-12' : '';
  const claims = report ? 'unknown-word-6' : glued ? 'unknown-word-9' : number ? 'unknown-word-8' : `unknown-word-1, unknown-word-2, unknown-word-3, unknown-word-7${spelled}`;
  const ngspice = multiplier
    ? `ngspice stops: '${message}'. Native ngspice 47 and 42 stop there too: they read no polynomial here. [unknown-word-${e.letter === 'E' ? 40 : 41}]`
    : efgh
    ? number
      ? `PlainSpice's engine stops: '${message}'. Native ngspice 47, which has the XSPICE extension, reads the extra number as part of a polynomial and runs. [unknown-word-4]`
      : `PlainSpice's engine stops: '${message}'. Native ngspice 47, which has the XSPICE extension, reads the extra word as part of a polynomial and stops too: 'MIF-ERROR ... Bad real value'. [${report ? 'unknown-word-11' : 'unknown-word-5'}]`
    : `ngspice stops: '${message}'. [${claims}]`;
  const fixes: Fix[] = [];
  if (glued && /[dDeE]$/.test(prev.token.text) && /^[+-]\d/.test(word) && readNumber(`${prev.token.text.slice(0, -1)}e${word}`)) {
    const meant = `${prev.token.text.slice(0, -1)}e${word}`;
    fixes.push(fix(`Write ${meant}`, change(prev.token.from, f.token.to, meant)));
  } else if (!number && !glued) {
    fixes.push(fix(`Make ${word} and the rest of the line a comment`, change(f.token.from, f.token.from, '; ')));
  }
  add(c, 'unknown-word', 'error', f.token, `SPICE can't use ${word} on this line`, why, ngspice, fixes);
}

/**
 * A glued word on an analysis line is one number for ngspice, read up to the character: what its place
 * does with that number (analysisPlace), never "says nothing" where ngspice stops or warns (`.dc V1 0 5
 * 0<thin space>.5`; space-character-16, -17; re-check critic CR1-2). Elsewhere on an analysis line no run
 * shows what follows, so nothing is said of it. The fix is the one that can make the line run: a
 * normal space keeps the number read at this place, so it is offered only when that number does no harm
 * and the line lacks a word (`.dc V1 0 5<thin space>1`, `.tran 1u<thin space>2m`); otherwise the fix takes
 * the character out and writes one number (`.dc V1 0 5 0.5`), as a normal space would leave one word too
 * many or the same number.
 */
function gluedOnAnalysis(c: Ctx, l: NetlistLine, t: Token, bare: string): { says: string; stops: boolean; whole: Fix | undefined; space: boolean } | undefined {
  const d = l.directive;
  if (!d || !c.n.analyses.includes(l.index)) return undefined;
  const k = d.args.findIndex((x) => x.from === t.from);
  const place = k >= 0 ? analysisPlace(c, d, k) : undefined;
  const read = place ? readNumber(t.text) : undefined;
  if (!place || !read) return { says: `ngspice reads the ${bare} as part of the word, so the words on either side are one word for it. [space-character-2, space-character-16]`, stops: false, whole: undefined, space: true };
  const chars = [...t.text];
  const before = withoutInvisible(chars.slice(0, chars.findIndex((x) => SPACE_LIKE.test(x))).join(''));
  const shown = readNumber(before)?.value === read.value ? before : formatNumber(read.value);
  const whole = withoutInvisible(withoutSpaces(t.text));
  const asOne = readNumber(whole);
  // What the number read does there, weighed with the line as ngspice reads it (re-check critic CR2-1).
  const v = place.verdict(read.value, asOne && !asOne.rest ? asOne.value : undefined, ngspiceSpelling(t.text));
  const out = v.kind === 'own' ? v : undefined;
  // Whether the line has all the words its analysis takes, so that a normal space would make one too many.
  const kind = d.args.findIndex((x) => /^(dec|oct|lin)$/i.test(x.text));
  const complete =
    d.name === '.dc' ? d.args.length % 4 === 0 : d.name === '.tran' ? d.args.filter((x) => lowerAscii(x.text) !== 'uic').length >= 2 : kind >= 0 && d.args.length >= kind + 4;
  const one = asOne && !asOne.rest && asOne.value !== read.value && (out !== undefined || complete) ? asOne : undefined;
  // The plain checks read the word as the number its fix writes, or not at all where two words may be meant.
  c.meant.set(t.from, one ? { value: one.value, text: whole } : 'split');
  return {
    says: `ngspice reads the ${bare} as part of the word, so its number ends there: it reads ${shown}${out ? `, ${out.says} [${claimList('space-character-16, space-character-17', out.claims)}]` : '. [space-character-18]'}`,
    stops: out?.stops === true,
    whole: one ? fix(`Take it out: write ${whole}`, replace(t, whole)) : undefined,
    space: out === undefined && !complete,
  };
}

/** The part a line belongs to: its own, or for a continuation line the part it continues. */
function cardOf(c: Ctx, l: NetlistLine): Element | undefined {
  return l.element ?? (l.continues === undefined ? undefined : c.n.lines[l.continues]?.element);
}

/**
 * Where a formula stands on a part that has one (C3-1): on a B line after its two nodes, on an E or G line
 * written with VALUE=, vol= or cur= after that word (ngspice makes it a B line). `body` is where the formula
 * itself starts: after a B line's V= or I=, or the E or G line's formula; undefined when there is none.
 */
function formulaOf(c: Ctx, e: Element | undefined): { from: number; body: number | undefined } | undefined {
  if (e?.letter === 'B') {
    if (e.nodes.length !== 2) return undefined;
    const from = e.nodes[1]!.token.to;
    const key = e.fields.find((f) => f.token.from >= from);
    const equals = key && /^[vViI]$/.test(key.token.text) ? /^[ \t]*=/.exec(c.text.slice(key.token.to, key.token.to + 200)) : null;
    return { from, body: key && equals ? key.token.to + equals[0].length : undefined };
  }
  if (e?.form?.kind === 'formula') return { from: e.form.keyword.to, body: e.form.formula?.from };
  return undefined;
}

/** The words B takes after its formula, which a character that looks like a space keeps apart from it (PTlex in ngspice's inpptree.c). */
const B_SETTINGS = /^(tc1|tc2|temp|dtemp|reciproctc)=/i;

/**
 * What ngspice says of a formula whose first character that looks like a space stands at `at` (CR1-4): its
 * bytes become names (_), and what ngspice says depends on what stands before it, past blanks, in the formula
 * (space-character-22, -23, -25 to -28, nbsp-4, -5, run in native ngspice 47 and 42 and our engine):
 * - at the start of the formula (after V=, I=, VALUE=, a {, a quote, or a + there): 'parameter value out of
 *   range or the wrong type';
 * - after an operator (* / ^ + - < > == && || :), or a - at the start: 'The internal check of parse tree \u2026
 *   failed', then the same;
 * - after an opening bracket, a comma or a ? (a sign there too): ngspice 47 'YYparse error', a fatal one, and
 *   ngspice 42 'PTerror: syntax error';
 * - after a number, a closing bracket or the formula's }: 'unknown parameter (_)';
 * - after a v that is a word of its own (v(out) written v<thin space>(out)): 'Undefined parameter [v]'.
 * Anywhere else (after a name, a function's name before its bracket, inside V=), only that it stops (space-character-29).
 */
function formulaStops(c: Ctx, at: number, body: number | undefined, nbsp: boolean): string {
  const somewhere = 'ngspice stops with an error on this line. [space-character-29]';
  if (body === undefined || at < body) return somewhere;
  const s = c.text;
  // The character before p in the formula, past blanks and the start of a continuation line (+).
  const back = (p: number): number => {
    let q = p;
    for (;;) {
      while (q >= body && ' \t\r\n'.includes(s[q]!)) q -= 1;
      if (q < body || s[q] !== '+') return q;
      let r = q - 1;
      while (r >= body && (s[r] === ' ' || s[r] === '\t')) r -= 1;
      if (r >= body && s[r] !== '\n') return q;
      q = r;
    }
  };
  const atStart = (q: number): boolean => q < body || ('{\'"'.includes(s[q]!) && back(q - 1) < body);
  const START = "ngspice stops: 'parameter value out of range or the wrong type'. [space-character-25]";
  const OPERATOR = "ngspice stops: 'The internal check of parse tree \u2026 failed', then 'parameter value out of range or the wrong type'. [space-character-26]";
  const OPEN = "ngspice 47 stops with a fatal error: 'YYparse error, syntax error, in expression' (ngspice 42: 'PTerror: syntax error'). [space-character-28]";
  const p = back(at - 1);
  if (atStart(p)) return START;
  const ch = s[p]!;
  if ('(,?'.includes(ch)) return OPEN;
  if (ch === '+' || ch === '-') {
    const q = back(p - 1);
    if (atStart(q)) return ch === '+' ? START : OPERATOR;
    if ('(,?'.includes(s[q]!)) return OPEN;
    return /[A-Za-z0-9_.)}]/.test(s[q]!) ? OPERATOR : somewhere;
  }
  if ('*/^<>:'.includes(ch) || (ch === '&' && s[p - 1] === '&') || (ch === '|' && s[p - 1] === '|') || (ch === '=' && s[p - 1] === '=')) return OPERATOR;
  if (ch === ')') return `ngspice stops: 'unknown parameter (_)'. [${nbsp ? 'nbsp-4' : 'space-character-22'}]`;
  if (ch === '}') return "ngspice stops: 'unknown parameter (_)'. [space-character-27]";
  if (!/[A-Za-z0-9_.]/.test(ch)) return somewhere;
  let a = p;
  while (a > body && /[A-Za-z0-9_.]/.test(s[a - 1]!)) a -= 1;
  // A character outside ASCII is part of a name for ngspice: the word is longer than it looks.
  if (a > body && s.charCodeAt(a - 1) >= 0x80) return somewhere;
  const word = s.slice(a, p + 1);
  if (/^[0-9.]/.test(word)) return "ngspice stops: 'unknown parameter (_)'. [space-character-27]";
  if (word === 'v' || word === 'V') return `ngspice stops: 'Undefined parameter [v]'. [${nbsp ? 'nbsp-5' : 'space-character-23'}]`;
  return somewhere;
}

/**
 * Characters that look like a space in a part's formula (C3-1, CR1-2): ngspice reads each of their bytes as
 * a name and stops, wherever one stands (formulaStops), and a formula needs no spaces. One error for the
 * part, named by the first such character, whose fix takes them all out, from the formula's start to the
 * end of its last line, after a number and at the end too; one that keeps a setting of B's apart from the
 * formula (tc1=) becomes a normal space. The characters inside a node's name are checkSpaceNodes'.
 */
function checkFormulaSpaces(c: Ctx, i: number, region: { from: number; body: number | undefined }): void {
  const e = el(c, i);
  const last = c.lastContinuation.get(i) ?? i;
  const tokens: Token[] = [];
  for (let k = i; k <= last; k++) {
    const line = c.n.lines[k]!;
    if (k === i || line.continues === i) tokens.push(...line.tokens.filter((x) => x.to > region.from));
  }
  const odd: number[] = [];
  for (const x of tokens) for (let k = Math.max(0, region.from - x.from); k < x.text.length; k++) if (SPACE_LIKE.test(x.text[k]!) && !c.spacedChars.has(x.from + k)) odd.push(x.from + k);
  if (!odd.length) return;
  const changes: TextChange[] = [];
  for (let k = 0; k < odd.length; k++) {
    let end = k;
    while (end + 1 < odd.length && odd[end + 1] === odd[end]! + 1) end += 1;
    const keepsApart = e.letter === 'B' && B_SETTINGS.test(c.text.slice(odd[end]! + 1, odd[end]! + 16)) && !/[ \t]/.test(c.text[odd[k]! - 1] ?? ' ');
    changes.push(change(odd[k]!, odd[end]! + 1, keepsApart ? ' ' : ''));
    k = end;
  }
  const at = odd[0]!;
  const t = tokens.find((x) => x.from <= at && at < x.to)!;
  const ch = c.text[at]!;
  const what = describeCharacter(ch);
  add(c, ch === '\u00a0' ? 'nbsp' : 'space-character', 'error', t, `${capital(what)} stops the formula of ${nameOf(e)}`,
    `This formula has ${what}, which often comes with text copied from a document or a web page. It looks like a space, but SPICE does not treat it as one: it reads it as part of a name, and the formula has no such name. A formula needs no spaces.`,
    formulaStops(c, at, region.body, ch === '\u00a0'),
    [fix(odd.length > 1 ? 'Take them out' : 'Take it out', ...changes)]);
}

/**
 * A character that looks like a space but is none for SPICE, between two words of a line (nbsp-1,
 * space-character-4): ngspice reads it as part of the word, so the words on either side become one.
 * One trap per line, named by its first such character; its fix writes a space for each. A value word
 * read as a number and a unit (checkSpaceInValue) is left out: the space was not meant between words.
 * On an analysis line, what ngspice does with the word is its place's (gluedOnAnalysis). In a part's formula
 * they are checkFormulaSpaces', once for the part.
 */
function checkSpaces(c: Ctx): void {
  for (const l of c.n.lines) {
    if (l.kind !== 'element' && l.kind !== 'directive' && l.kind !== 'continuation') continue;
    // The characters inside a node's name are checkSpaceNodes', also inside a formula ({v(o<thin>ut)}). By UTF-16
    // offset, as the text is indexed: a character above U+FFFF (an emoji, a math letter) is two (CR1-5).
    const odd = (x: Token): number[] => {
      const out: number[] = [];
      for (let k = 0; k < x.text.length; k++) if (SPACE_LIKE.test(x.text[k]!) && !c.spacedChars.has(x.from + k)) out.push(x.from + k);
      return out;
    };
    const card = cardOf(c, l);
    const region = card ? formulaOf(c, card) : undefined;
    if (region && l.kind === 'element') checkFormulaSpaces(c, l.index, region);
    const tokens = l.tokens.filter((x) => hasSpaceLike(x.text) && !c.spaced.has(x.from) && (!region || x.to <= region.from) && odd(x).length > 0);
    const t = tokens[0];
    if (!t) continue;
    const changes: TextChange[] = [];
    for (const x of tokens) for (const at of odd(x)) changes.push(change(at, at + 1, ' '));
    const ch = c.text[odd(t)[0]!]!;
    const shown = shownWord(t.text);
    const bare = nameOfCharacter(ch, false)!.replace(/^an? /, '');
    const glued = gluedOnAnalysis(c, l, t, bare);
    for (const x of tokens.slice(1)) c.meant.set(x.from, 'split');
    const replaceAll = fix('Replace it with a normal space', ...changes);
    const fixes = !glued ? [replaceAll] : [...(glued.whole ? [glued.whole] : []), ...(glued.space ? [replaceAll] : [])];
    const severity: TrapSeverity = glued?.stops ? 'error' : 'warning';
    if (ch === '\u00a0') {
      add(
        c,
        'nbsp',
        severity,
        t,
        `A no-break space glues "${shown}" into one word`,
        'This line has a no-break space (it often comes with text copied from a web page or a PDF). It looks like a space, but SPICE does not treat it as one, so the words on either side become one word.',
        glued?.says ?? 'ngspice reads the no-break space as part of the word and says nothing about it; in one test R1 n1 0<no-break space>2 became a resistor with the node "0 2" and no value, which ngspice then left out. [nbsp-1]',
        fixes,
      );
      continue;
    }
    const what = describeCharacter(ch);
    add(
      c,
      'space-character',
      severity,
      t,
      `${capital(what)} glues "${shown}" into one word`,
      `This line has ${what}, which often comes with text copied from a document or a web page. It looks like a space, but SPICE does not treat it as one, so the words on either side become one word.`,
      glued?.says ?? `ngspice reads the ${bare} as part of the word and says nothing about it; in one test R1 n1 0<thin space>2 became a resistor with the node "0 2" and no value, which ngspice then left out. [space-character-2, space-character-4]`,
      fixes,
    );
  }
}

// ------------------------------------------------------------------ incomplete part lines

function checkIncomplete(c: Ctx, i: number): void {
  const e = el(c, i);
  const L = e.letter;
  if (!L || !VALUE_LETTERS.has(L)) return;
  const name = nameOf(e);
  const span = e.name;
  const kind = { R: 'resistor', C: 'capacitor', L: 'inductor', V: 'voltage source', I: 'current source' }[L as 'R'];
  const A = L === 'L' ? 'An' : 'A';
  const nodes = e.nodes.length;
  if (L === 'R' || L === 'C' || L === 'L') {
    if (nodes < 2) {
      c.broken.add(i);
      add(c, 'missing-fields', 'warning', span, `${name} needs two nodes`,
        `${A} ${kind} line is: name, node, node, value. ${name} has ${nodes === 0 ? 'no nodes' : 'only one node'}.`,
        `ngspice leaves ${name} out of the circuit and warns: 'not a valid ${kind} instance line, ignored!'. [missing-fields-1]`);
    } else if (!e.value && !e.fields.some((f) => f.role === 'model')) {
      if (e.fields.length === 3) {
        add(c, 'missing-value', 'warning', span, `${name} has no value`,
          `${A} ${kind} line is: name, node, node, value. Without a value SPICE can't use the ${kind}.`,
          `ngspice leaves ${name} out of the circuit and warns: 'not a valid ${kind} instance line, ignored!'. [missing-value-1, missing-value-2]`);
      } else if (!e.fields.some((f) => f.role === 'other')) {
        // Settings but no value: ngspice keeps the part (missing-value-8 ... -10). A word it can't use is unknown-word's.
        add(c, 'missing-value', 'warning', span, `${name} has no value`,
          L === 'R'
            ? `${A} ${kind} line is: name, node, node, value. ${name} has settings but no value, so SPICE uses 1 mΩ, almost a wire.`
            : `${A} ${kind} line is: name, node, node, value. ${name} has settings but no value, so it has no ${L === 'C' ? 'capacitance' : 'inductance'} at all.`,
          L === 'R'
            ? `ngspice keeps ${name} at 1 mΩ and warns: '${lowerAscii(name)}: resistance too low or not given, set to 1 mOhm'. [missing-value-8]`
            : L === 'C'
              ? `ngspice keeps ${name} without any capacitance and says nothing: in one test it held no charge at all. [missing-value-9]`
              : `ngspice keeps ${name} without any inductance and says nothing, so it is a plain wire. [missing-value-10]`);
      }
    }
    return;
  }
  if (L === 'V' || L === 'I') {
    const unit = L === 'V' ? '0 V' : '0 A';
    if (nodes < 2) {
      c.broken.add(i);
      add(c, 'missing-fields', 'error', span, `${name} needs two nodes`,
        L === 'V' ? `A voltage source line is: name, + node, ${MINUS} node, value. ${name} has ${nodes === 0 ? 'no nodes' : 'only one node'}.`
          : `A current source line is: name, from node, to node, current. ${name} has ${nodes === 0 ? 'no nodes' : 'only one node'}.`,
        `ngspice stops with a fatal error: 'Not enough parameters'. [missing-fields-2, missing-fields-3]`);
    } else if (e.fields.length === 3) {
      const last = e.nodes[1]!.token;
      add(c, 'missing-value', 'warning', span, `${name} has no value`,
        L === 'V' ? `A voltage source line is: name, + node, ${MINUS} node, value. Without a value SPICE uses ${unit}, which is only right for an ammeter (a 0 V source that measures a current).`
          : `A current source line is: name, from node, to node, current. Without a value SPICE uses ${unit}, which is the same as no source at all.`,
        `ngspice uses ${unit} and only notes: '${lowerAscii(name)}: has no value, DC 0 assumed'. [missing-value-3]`,
        L === 'V' ? [fix('Write 0 (a 0 V source: an ammeter)', change(last.to, last.to, ' 0'))] : []);
    }
    return;
  }
  // A formula, a table or a polynomial where the control and the gain go (C3-5): nothing is missing.
  if (e.form) {
    if (e.form.kind !== 'formula') checkXspiceForm(c, i);
    else checkFormulaForm(c, i);
    return;
  }
  const notEnough = "Native ngspice 47 stops: 'not enough parameters in line'.";
  if (L === 'E' || L === 'G') {
    if (nodes < 4) {
      c.broken.add(i);
      add(c, 'missing-fields', 'error', span, `${name} needs four nodes and a ${L === 'E' ? 'gain' : 'value in amps per volt'}`,
        L === 'E' ? `An E line is: name, + node, ${MINUS} node, control + node, control ${MINUS} node, gain: the voltage at the + node is the gain times the control voltage.`
          : `A G line is: name, from node, to node, control + node, control ${MINUS} node, amps per volt.`,
        `${notEnough} PlainSpice's engine (built without XSPICE) misreads the line instead, for example taking a number for a node, and its results can't be used. [missing-fields-4, missing-fields-5]`);
    } else if (!e.value) {
      noGain(c, i, L === 'E' ? 'An E line ends with its gain: E1 out 0 c 0 2 makes the voltage at out 2 x the voltage at c.'
        : 'A G line ends with its value in amps per volt: G1 0 out c 0 0.5 pushes 0.5 amps for every volt at c.');
    }
    return;
  }
  // F, H. A number where the control source goes means the control source was left out.
  if (nodes < 2 || !e.controlSource || (!e.value && readNumber(e.controlSource.text))) {
    c.broken.add(i);
    add(c, 'missing-fields', 'error', span, `${name} needs two nodes and a control source`,
      `${L === 'F' ? 'An F line is: name, from node, to node, control source, gain' : `An H line is: name, + node, ${MINUS} node, control source, volts per amp`}. F and H read a current, and SPICE can only read the current through a voltage source, so the control source is the name of a voltage source.`,
      `${notEnough} PlainSpice's engine stops: '${lowerAscii(name)}: unknown controlling source'. [missing-fields-6, missing-fields-7, missing-fields-8]`);
  } else if (!e.value) {
    noGain(c, i, L === 'F' ? 'An F line ends with its gain: F1 0 out Vs 3 pushes 3 x the current in Vs.' : 'An H line ends with its value in volts per amp: H1 out 0 Vs 4 makes 4 volts for every amp in Vs.');
  }
}

/**
 * An E, F, G or H line written with POLY(n), or an E or G line written with TABLE (C3-5): ngspice
 * builds it from an XSPICE block, which PlainSpice's engine leaves out, so the engine stops ("XSPICE is
 * required to run the 'poly' option", "unknown device type"), while native ngspice 47 runs it
 * (model-not-in-engine-7, -8). POLY(1) with the coefficients 0 and k is the plain gain k
 * (model-not-in-engine-9): its fix writes that, which the engine runs. An error: no results.
 */
function checkXspiceForm(c: Ctx, i: number): void {
  const e = el(c, i);
  const form = e.form!;
  c.broken.add(i);
  const name = nameOf(e);
  if (form.kind === 'table') {
    add(c, 'model-not-in-engine', 'error', form.keyword, `PlainSpice's engine can't run ${name}'s TABLE`,
      `TABLE makes ${name}'s output follow a table of points, which ngspice builds from an XSPICE block. PlainSpice's engine leaves XSPICE out; first- and second-year circuits don't need it. A gain, or a formula written VALUE={...}, works instead.`,
      "PlainSpice's engine stops: 'unknown device type'. Native ngspice 47 runs it. [model-not-in-engine-8]");
    return;
  }
  // The plain gain for POLY(1) a b 0 k: the control (two nodes, or a source), then k.
  const controls = e.fields.filter((f) => f.role === 'control-plus' || f.role === 'control-minus' || f.role === 'control-source');
  const at = e.fields.findIndex((f) => f.token === form.keyword);
  const coefficients = e.fields.slice(at + 2).filter((f) => !controls.includes(f));
  const zero = coefficients[0] && readNumber(coefficients[0].token.text);
  const gain = coefficients[1];
  const plain =
    form.dimension === 1 && controls.length === ('EG'.includes(e.letter!) ? 2 : 1) && coefficients.length === 2 && zero && !zero.rest && zero.value === 0 && gain && readNumber(gain.token.text)
      ? `${[...controls, gain].map((f) => f.token.text).join(' ')}`
      : undefined;
  const lineEnd = e.fields[e.fields.length - 1]!.token.to;
  const written = plain ? `${c.text.slice(e.name.from, form.keyword.from)}${plain}` : undefined;
  add(c, 'model-not-in-engine', 'error', form.keyword, `PlainSpice's engine can't run ${name}'s POLY`,
    `POLY makes ${name}'s output a polynomial of its controls, which ngspice builds from an XSPICE block. PlainSpice's engine leaves XSPICE out; first- and second-year circuits don't need it. ${'EG'.includes(e.letter!) ? 'For a gain, write the control nodes and then the gain' : 'For a gain, write the control source and then the gain'}${written ? `: ${written}` : ''}.`,
    "PlainSpice's engine stops: 'XSPICE is required to run the 'poly' option'. Native ngspice 47 runs it. [model-not-in-engine-7, model-not-in-engine-9]",
    written ? [fix(`Write it without POLY: ${written}`, change(form.keyword.from, lineEnd, plain!))] : []);
}

/**
 * An E or G given by a formula that ngspice cannot read (C3-5). ngspice takes the formula from its '{' to the
 * end of the line, and adds the braces itself only after '=' and before a letter or a bracket (v(out)*2, k*2,
 * (v(out)*2)): VALUE=3, VALUE=2*v(out) and VALUE v(out)*2 stop it (fatal-syntax-12 to -15). One word between
 * the output nodes and the formula stops native ngspice, whose XSPICE first reads the line as a polynomial;
 * PlainSpice's engine drops it, as ngspice drops two or more (missing-fields-9, unknown-word-54, -55).
 */
function checkFormulaForm(c: Ctx, i: number): void {
  const e = el(c, i);
  const form = e.form!;
  const name = nameOf(e);
  const kw = form.keyword.text;
  const word = form.dropped?.length === 1 ? form.dropped[0]! : undefined;
  if (word) {
    add(c, 'missing-fields', 'warning', word, `Native ngspice stops at ${name}'s word ${word.text}`,
      `ngspice drops the words between ${name}'s output nodes and ${kw}, so ${word.text} changes nothing in PlainSpice. With exactly one word there, native ngspice first reads the line as a polynomial (an XSPICE step that PlainSpice's engine leaves out) and stops.`,
      `Native ngspice 47 and 42 stop: 'not enough parameters in line'. PlainSpice's engine drops ${word.text} and runs the formula. [missing-fields-9]`,
      [fix(`Take out ${word.text}`, change(word.from, form.keyword.from, ''))]);
  }
  const formula = form.formula;
  const equals = /^[ \t]*=/.test(c.text.slice(form.keyword.to, form.keyword.to + 200));
  if (!formula || /^(\{\s*\}|'\s*'|"\s*")$/.test(formula.text)) {
    // VALUE= or VALUE={} with nothing in it (fatal-syntax-15).
    c.broken.add(i);
    add(c, 'fatal-syntax', 'error', formula ?? form.keyword, `${name} has an empty formula`,
      `After ${kw}= comes the formula, for example ${kw}={2*v(in)}.`,
      equals || formula ? "ngspice 47 stops with a fatal error: 'YYparse error, syntax error, in expression'. [fatal-syntax-15]"
        : `ngspice stops with a fatal error: 'mal formed ${e.letter} source instance' (ngspice 42: 'mal formed ${e.letter} line'). [fatal-syntax-15]`);
    return;
  }
  if (/^[{'"]/.test(formula.text)) return;
  if (equals && !/^[0-9.+-]/.test(formula.text)) return;
  c.broken.add(i);
  const braced = `{${formula.text}}`;
  add(c, 'fatal-syntax', 'error', formula, `ngspice can't read ${name}'s formula without braces`,
    `ngspice takes ${name}'s formula from its { to the end of the line. It adds the braces itself only after ${kw}= and before a letter or a bracket, as in ${kw}=v(out)*2, so write ${kw}=${braced}.`,
    `ngspice stops with a fatal error: 'mal formed ${e.letter} source instance' (ngspice 42: 'mal formed ${e.letter} line'). [fatal-syntax-12, fatal-syntax-13, fatal-syntax-14]`,
    formula.text.includes('=') ? [] : [fix(`Put it in braces: ${braced}`, change(formula.from, formula.to, braced))]);
}

/**
 * An E, F, G or H line with no gain (or value), told apart by what follows the nodes and the control
 * source (re-check S6). Nothing at all: native ngspice 47 stops, and PlainSpice's engine reads 0
 * (missing-value-4 to -7). Settings but no number ("gain", "m=2"): native 47, 42 and our engine all run
 * with 0 and say nothing (missing-value-11, -12). A word ngspice cannot read where the gain goes is no
 * missing gain: the character checks or unknown-word say what it is.
 */
function noGain(c: Ctx, i: number, line: string): void {
  const e = el(c, i);
  if (e.fields.some((f) => f.role === 'other')) return;
  const name = nameOf(e);
  const gain = e.letter === 'E' || e.letter === 'F';
  const nothing = e.fields.length === (e.letter === 'E' || e.letter === 'G' ? 5 : 4);
  add(c, 'missing-value', 'error', e.name, `${name} has no ${gain ? 'gain' : 'value'}`,
    nothing ? line : `${line} ${name} has settings but no ${gain ? 'gain' : 'value'}, so its output is 0.`,
    nothing
      ? "Native ngspice 47 stops: 'not enough parameters in line'. PlainSpice's engine (built without XSPICE) reads the missing value as 0 and says nothing. [missing-value-4, missing-value-5, missing-value-6, missing-value-7]"
      : `ngspice uses 0 and says nothing: in one test ${name}'s output stayed at 0. [missing-value-11, missing-value-12]`);
}

function checkControlSource(c: Ctx, i: number): void {
  const e = el(c, i);
  if ((e.letter !== 'F' && e.letter !== 'H') || !e.controlSource) return;
  const t = e.controlSource;
  if (c.broken.has(i)) return;
  const key = lowerAscii(t.text);
  const target = c.byKey.get(key);
  const targetEl = target === undefined ? undefined : el(c, target);
  if (targetEl && hasReadableCurrent(targetEl)) return;
  c.broken.add(i);
  const why = 'F and H read a current. But SPICE can only read the current through a voltage source. So first, put a 0 V source in the branch you want to measure: the ammeter trick.';
  if (targetEl?.letter === 'B') {
    // A B line with I= is accepted as the control, but it has no branch current (control-source-5).
    add(c, 'control-source', 'error', t, `${t.text} is a current source: it has no current to read`, why,
      `ngspice finds no current to read in ${key}: it warns 'singular matrix: check node ${key}#branch' and then stops: 'The operating point could not be simulated successfully'. No results. [control-source-5]`);
    return;
  }
  const candidates = c.top.map((k) => el(c, k)).filter((x) => hasReadableCurrent(x) && looksLikeTypo(x.key, key));
  add(
    c,
    'control-source',
    'error',
    t,
    targetEl ? `${t.text} is not a voltage source` : `There is no voltage source called ${t.text}`,
    why,
    `ngspice stops: '${lowerAscii(nameOf(e))}: unknown controlling source ${key}'. [control-source-1, control-source-2, control-source-6]`,
    candidates.slice(0, 2).map((x) => fix(`Use ${nameOf(x)}`, replace(t, nameOf(x)))),
  );
}

// ------------------------------------------------------------------ the title line

const DOT_COMMANDS = new Set([
  '.op', '.tf', '.dc', '.tran', '.ac', '.noise', '.disto', '.pz', '.sens', '.sp', '.four', '.fourier', '.model', '.param',
  '.include', '.inc', '.lib', '.end', '.subckt', '.ends', '.options', '.option', '.opt', '.print', '.plot', '.save', '.control',
  '.ic', '.nodeset', '.meas', '.measure', '.temp', '.global', '.func', '.csparam',
]);

function checkTitle(c: Ctx): void {
  const title = c.n.lines[0];
  if (!title || title.kind !== 'title') return;
  const parsed = parseNetlist(`*\n${title.text}`);
  const l = parsed.lines[1];
  if (!l) return;
  const bom = c.text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const addTitle = fix('Add a title line above it', change(bom, bom, '* my circuit\n'));
  const at = title.span.from + (title.text.length - title.text.trimStart().length);
  if (l.kind === 'directive' && l.directive && DOT_COMMANDS.has(l.directive.name)) {
    const word = l.directive.token.text;
    add(c, 'missing-title', 'warning', { from: at, to: at + word.length }, `Line 1 is the title, so ${word} never runs`,
      'SPICE always skips the first line, so make it a title. A command written there is never run.',
      `ngspice reads line 1 as the title and never runs ${word}; it says nothing about it. [missing-title-2]`, [addTitle]);
    return;
  }
  const e = l.element;
  if (l.kind !== 'element' || !e?.letter || !'RCLVIEFGHDQJM'.includes(e.letter) || e.nodes.length < 2) return;
  if (VALUE_LETTERS.has(e.letter) && !e.value?.number && !e.sourceFunction && !e.controlSource) return;
  const used = e.nodes.some((r) => !r.ground && (c.n.nodes.get(r.name)?.connections.length ?? 0) > 0);
  if (!used) return;
  const word = e.name.text;
  add(c, 'missing-title', 'warning', { from: at, to: at + word.length }, `Line 1 is the title, so ${word} is left out`,
    'SPICE always skips the first line, so make it a title. A part written there would silently disappear.',
    `ngspice reads line 1 as the title and builds the circuit without ${word}; it says nothing. [missing-title-1]`, [addTitle]);
}

// ------------------------------------------------------------------ ground and nodes

/** Node names a student may mean as ground. ngspice's ground is only 0, and gnd (not as a line's last word). */
const GROUND_LIKE = /^(ground|gnd|earth|agnd|dgnd|gnd0|0{2,})$/;

function firstRef(info: NodeInfo): Token | undefined {
  return info.refs[0];
}

function checkGround(c: Ctx): void {
  if (c.graph.elements.length === 0) return;
  const named = [...c.n.nodes.values()].filter((x) => !x.ground && x.connections.length > 0);
  if (!c.graph.hasGround) {
    let cand = named.find((x) => GROUND_LIKE.test(x.name));
    if (!cand) {
      const firstV = c.graph.elements.map((i) => el(c, i)).find((e) => e.letter === 'V' && e.nodes.length >= 2);
      const firstI = c.graph.elements.map((i) => el(c, i)).find((e) => e.letter === 'I' && e.nodes.length >= 2);
      const pick = firstV?.nodes[1] ?? firstI?.nodes[1] ?? c.graph.elements.map((i) => el(c, i)).find((e) => e.nodes.length >= 2)?.nodes[1];
      cand = pick ? c.n.nodes.get(pick.name) : undefined;
    }
    const anchor = cand ? firstRef(cand) : el(c, c.graph.elements[0]!).name;
    if (!anchor) return;
    add(
      c,
      'no-ground',
      'error',
      anchor,
      'No ground: no node is called 0',
      "Without ground, SPICE can't pin the voltages down. It warns about a singular matrix, which means its equations have no single answer, and any numbers it still prints can't be trusted. Every circuit needs one node called 0 (gnd works too).",
      "ngspice warns 'singular matrix', falls back to a 'transient op' and still prints numbers. They are not the answer: in one test a 6 V source's + node came out at 9.000333 V. [no-ground-1]",
      cand ? [fix(`Make ${cand.name} the ground (rename it to 0)`, ...renameNode(cand, GROUND))] : [],
    );
    return;
  }
  for (const x of named) {
    if (!GROUND_LIKE.test(x.name)) continue;
    const t = firstRef(x);
    if (!t) continue;
    const gnd = x.name === 'gnd';
    add(
      c,
      'ground-misnamed',
      'warning',
      t,
      gnd ? 'gnd at the end of a line is not ground' : `${t.text} is not ground: ground is node 0`,
      gnd
        ? 'ngspice turns gnd into ground (node 0) only when another word follows it on the line. As the last word, gnd is an ordinary node, so this part is not connected to ground.'
        : `In SPICE, ground is the node called 0 (gnd works too). ${t.text} is just another node name, so the parts on it are not connected to ground.`,
      gnd
        ? 'ngspice says nothing. In one test a 0 V ammeter written Vx b gnd read 0 A, because its gnd was a separate node. [ground-misnamed-2]'
        : `ngspice says nothing and treats ${x.name} as an ordinary node. In one test, V1 n1 ${x.name === '00' ? '00' : 'ground'} 6 with R1 n1 0 2 gave v(n1) = 0 and no current at all. [ground-misnamed-1, ground-misnamed-3]`,
      [fix(`Rename ${t.text} to 0`, ...renameNode(x, GROUND))],
    );
  }
}

function checkDangling(c: Ctx): void {
  if (!c.graph.hasGround) return;
  const nodes = [...c.n.nodes.values()];
  const floating = new Set(c.graph.floating.flatMap((g) => g.nodes));
  // A name with an invisible character, a character that looks like a space or a look-alike letter,
  // and the name it looks like, are the invisible-character, space-character and look-alike-letter
  // checks': their fix joins them, so no "Did you mean" offers to rename out to ou<zero-width space>t,
  // to o<thin space>ut or to оut (Cyrillic о). The name it looks like is the plain one, with every such
  // character taken out (о<zero-width space>ut is out: critic of the S11 fix, round 2).
  const odd = oddNode;
  const meantOf = (y: NodeInfo): string => lowerAscii(plainForms(y.refs[0]!.text).at(-1) ?? y.name);
  const hidden = new Set(nodes.filter(odd).map(meantOf));
  const connected = nodes.filter((y) => y.connections.length > 0 && !odd(y));
  let index: TypoIndex | undefined;
  let sourcePairs: Set<string> | undefined;
  for (const x of nodes) {
    if (x.ground || x.connections.length !== 1 || x.refs.length !== 1) continue;
    if (odd(x) || hidden.has(x.name)) continue;
    const conn = x.connections[0]!;
    const e = el(c, conn.line);
    if ((e.letter !== 'R' && e.letter !== 'L') || e.nodes.length !== 2 || !c.built.has(conn.line)) continue;
    if (c.broken.has(conn.line)) continue;
    if (floating.has(x.name)) continue;
    const t = x.refs[0]!;
    const other = e.nodes.find((r) => r.token !== t)?.name ?? '';
    index ??= new TypoIndex(connected.map((y) => y.name));
    sourcePairs ??= new Set(
      c.graph.elements.flatMap((k) => {
        const s = el(c, k);
        const [a, b] = s.nodes;
        return (s.letter === 'V' || s.letter === 'E' || s.letter === 'H') && a && b ? [`${a.name}\n${b.name}`, `${b.name}\n${a.name}`] : [];
      }),
    );
    const pairs = sourcePairs;
    // A voltage source across the look-alike and the other end: renaming to it would short that source.
    const voltageAcross = (a: string, b: string): boolean => a === b ? false : pairs.has(`${a}\n${b}`);
    const candidates = index
      .lookAlikes(x.name)
      .map((name) => c.n.nodes.get(name)!)
      .filter((y) => y !== x && y.name !== other)
      .map((y, order) => ({ y, order, across: voltageAcross(y.name, other) }))
      .sort((a, b) => Number(a.across) - Number(b.across) || b.y.connections.length - a.y.connections.length || a.order - b.order)
      .map((k) => k.y);
    const name = nameOf(e);
    // The nodes as the results' words name them: a name like ground quoted, ÇIKIŞ as first written (S7).
    const here = /^(gnd|ground|00)$/i.test(t.text) ? `"${t.text}"` : t.text;
    if (candidates.length > 0) {
      add(
        c,
        'dangling-node',
        'warning',
        t,
        `Only ${name} touches ${here}`,
        `A node needs at least two connections for current to flow through it. ${here} appears only here, so no current flows in ${name}. Did you mean ${list(candidates.slice(0, 2).map((y) => nodeWords(c, y.name))).replace(' and ', ' or ')}?`,
        `ngspice says nothing: ${name} carries no current, so it changes nothing else in the circuit. [dangling-node-1, dangling-node-2]`,
        candidates.slice(0, 2).map((y) => fix(`Rename ${here} to ${nodeWords(c, y.name)}`, replace(t, writtenNode(c, y.name)))),
      );
    } else {
      add(
        c,
        'dangling-node',
        'info',
        t,
        `Only ${name} touches ${here}`,
        `No current flows in ${name}, so ${here} sits at the same voltage as ${other === GROUND ? 'ground (node 0)' : nodeWords(c, other)}. That is right for an open terminal where you measure a voltage; if ${name} should connect to something, check this node name.`,
        `ngspice says nothing: ${name} carries no current, so it changes nothing else in the circuit. [dangling-node-1]`,
      );
    }
  }
}

/** A node's key as the netlist first writes it when it has a character outside ASCII (ÇIKIŞ, never the key's ÇikiŞ: S7), else the key. */
function writtenNode(c: Ctx, key: string): string {
  const written = c.n.nodes.get(key)?.refs[0]?.text ?? key;
  return /^[\x20-\x7e]*$/.test(written) ? key : written;
}

/**
 * A node's key in a check's words, as the results' words say it: as first written for a name outside
 * ASCII, a name like ground quoted (an ordinary node, W13), a character that is not what it looks like
 * named, never shown hidden (S11; critic of the words re-check's fix).
 */
function nodeWords(c: Ctx, key: string): string {
  const name = writtenNode(c, key);
  return /^(gnd|ground|00)$/i.test(name) ? `"${name}"` : nodeNameInWords(name);
}

/** A floating group's first node reference, in netlist order. */
function groupAnchor(c: Ctx, g: DcGroup): Token | undefined {
  let best: Token | undefined;
  for (const name of g.nodes) {
    const t = c.n.nodes.get(name)?.refs.find((r) => lineAt(c.n, r.from).element);
    if (t && (!best || t.from < best.from)) best = t;
  }
  return best;
}

function checkFloating(c: Ctx): void {
  for (const whole of c.graph.floating) {
    const g: DcGroup = {
      nodes: whole.nodes,
      attachments: whole.attachments.filter((a) => !c.broken.has(a.line)),
      conductors: whole.conductors.filter((k) => !c.broken.has(k)),
    };
    if (g.attachments.length === 0 && g.conductors.length === 0) continue;
    const kinds = new Set(g.attachments.map((a) => a.kind));
    const current = g.attachments.filter((a) => a.kind === 'current');
    const nodes = list(g.nodes.map((n) => nodeWords(c, n)));
    const plural = g.nodes.length > 1;
    if (current.length > 0) {
      currentSourceNoPath(c, g, kinds);
      continue;
    }
    if (!c.opNeeded && [...kinds].every((k) => k === 'capacitor')) continue;
    const anchor = groupAnchor(c, g);
    if (!anchor) continue;
    const caps = g.attachments.filter((a) => a.kind === 'capacitor');
    const controls = g.attachments.filter((a) => a.kind === 'control');
    const gates = g.attachments.filter((a) => a.kind === 'gate');
    const names = (xs: { line: number }[]): string => list([...new Set(xs.map((a) => nameOf(el(c, a.line))))]);
    let why: string;
    if (kinds.size === 0) {
      why = `${names(g.conductors.map((line) => ({ line })))} connect${g.conductors.length === 1 ? 's' : ''} ${nodes}, but nothing connects ${plural ? 'them' : 'it'} to the rest of the circuit, so SPICE can't pin ${plural ? 'their voltages' : 'its voltage'} down.`;
    } else if (controls.length > 0 && caps.length === 0 && gates.length === 0) {
      why = `${nodes} ${plural ? 'are' : 'is'} used only as the control input of ${names(controls)}, which senses a voltage but draws no current. Nothing sets ${plural ? 'their voltages' : 'its voltage'}, so SPICE's equations have no single answer.`;
    } else if (gates.length > 0 && caps.length === 0 && controls.length === 0) {
      why = `A MOSFET's gate draws no current, so nothing sets the voltage at ${nodes}. SPICE's equations then have no single answer.`;
    } else if (caps.length > 0 && controls.length === 0 && gates.length === 0) {
      why = `At DC a capacitor is an open circuit, so nothing connects ${nodes} to ground. SPICE can't pin ${plural ? 'their voltages' : 'its voltage'} down: its equations have no single answer.`;
    } else {
      why = `Only parts that draw no DC current (capacitors, control inputs, MOSFET gates) reach ${nodes}, so SPICE can't pin ${plural ? 'their voltages' : 'its voltage'} down.`;
    }
    // Control inputs alone stop ngspice (floating-dc-4, -10); joined by a resistor, they get numbers (floating-dc-9).
    const failing = controls.length > 0 && caps.length === 0 && gates.length === 0 && g.conductors.length === 0;
    const mixed = controls.length > 0 && !failing;
    // ngspice's warning names one node: this one, in its own spelling ("check node __iki__", M2d), when it
    // is the only node with no DC path; else any of them, not always the first (critic of the fix:
    // "check node x" for node1 and x, floating-dc-7; "check node a" only, beside b, floating-dc-8, -10).
    const named = g.nodes.length === 1 && c.graph.floating.length === 1;
    const warns = named
      ? `ngspice warns 'singular matrix: check node ${ngspiceSpelling(g.nodes[0]!)}'`
      : "ngspice warns 'singular matrix: check node …' (it names one of the nodes with no DC path)";
    const ngspice = failing
      ? `${warns} and then stops: 'The operating point could not be simulated successfully'. No results. [floating-dc-4${named ? '' : ', floating-dc-10'}]`
      : mixed
        ? `ngspice warns 'singular matrix'; then it either stops or prints numbers that can't be trusted. [floating-dc-1, floating-dc-4${g.conductors.length > 0 ? ', floating-dc-9' : ''}]`
        : `${warns}, falls back to a 'transient op' and still prints numbers. They can't be trusted: in one test a node that is 3 V at DC came out at 0.0887 V. [floating-dc-1, floating-dc-2, floating-dc-3, floating-dc-5${named ? '' : ', floating-dc-7, floating-dc-8'}]`;
    const fixes: Fix[] = [];
    if (!failing && !mixed && kinds.size > 0) {
      const target = g.nodes[0]!;
      const name = freshName(c, 'Rdc1');
      const lastTop = c.graph.elements[c.graph.elements.length - 1]!;
      fixes.push(fix(`Add a 1 GΩ resistor from ${nodeWords(c, target)} to ground`, insertLineAfter(c, lastTop, `${name} ${writtenNode(c, target)} 0 1g`)));
    }
    add(
      c,
      'floating-dc',
      'error',
      anchor,
      `${nodes} ${plural ? 'have' : 'has'} no DC path to ground`,
      fixes.length > 0 ? `${why} Engineers often add a very large resistor (1 GΩ) from such a node to ground: it gives SPICE a DC path and changes almost nothing else.` : why,
      ngspice,
      fixes,
    );
  }
}

function currentSourceNoPath(c: Ctx, g: DcGroup, kinds: Set<string>): void {
  const current = g.attachments.filter((a) => a.kind === 'current');
  const src = el(c, current[0]!.line);
  const sources = [...new Set(current.map((a) => a.line))].map((k) => el(c, k));
  const onlyI = sources.every((s) => s.letter === 'I');
  const other = [...kinds].filter((k) => k !== 'current');
  const nodes = list(g.nodes.map((n) => nodeWords(c, n)));
  let ngspice: string;
  if (other.length === 0 && g.conductors.length === 0 && onlyI) {
    ngspice = 'ngspice says nothing and acts as if there were 1 Ω from the node to ground: in one test, 1 A into such a node gave 1 V. [current-source-no-path-2, current-source-no-path-3]';
  } else if (other.every((k) => k === 'capacitor') && onlyI) {
    ngspice = "ngspice warns 'singular matrix', falls back to a 'transient op' and prints numbers that can't be trusted. [current-source-no-path-1]";
  } else if (other.length === 0 && g.conductors.length === 0) {
    ngspice = "ngspice warns 'singular matrix' and then stops: 'The operating point could not be simulated successfully'. No results. [current-source-no-path-4, current-source-no-path-5]";
  } else {
    ngspice = "ngspice warns 'singular matrix'; then it either stops or prints numbers that can't be trusted. [current-source-no-path-1, current-source-no-path-4]";
  }
  const series = sources.length > 1 && other.length === 0;
  const why = series
    ? `${list(sources.map(nameOf))} are in series with nothing else at ${nodes}, and two current sources in series each insist on their own current. The current has nowhere else to go, so the voltage at ${nodes} is not defined.`
    : `A current source pushes its current through whatever it is connected to. Here ${nodes} ${g.nodes.length > 1 ? 'have' : 'has'} no DC path back to ground${other.includes('capacitor') ? ' (a capacitor is an open circuit at DC)' : ''}, so the current has nowhere to go and the voltage there is not defined.`;
  add(c, 'current-source-no-path', 'error', src.name, `${nameOf(src)}'s current has nowhere to go`, why, ngspice);
}

function checkLoops(c: Ctx): void {
  for (const loop of c.graph.loops) loopTrap(c, loop);
}

function loopTrap(c: Ctx, loop: VoltageLoop): void {
  if (loop.inductor && !c.opNeeded) return;
  if (c.broken.has(loop.line) || loop.others.some((k) => c.broken.has(k))) return;
  const e = el(c, loop.line);
  const name = nameOf(e);
  const others = loop.others.map((k) => el(c, k));
  const members = [...others, e];
  const node = e.nodes[0]?.name ?? '';
  if (loop.self) {
    const what = e.letter === 'V' ? 'VSRC' : e.letter === 'E' ? 'VCVS' : e.letter === 'H' ? 'CCVS' : '';
    add(
      c,
      'voltage-loop',
      'error',
      e.name,
      `${name} has both ends on node ${node}`,
      e.letter === 'L'
        ? `${name} connects node ${node} to itself, so it does nothing, and its current is not defined: SPICE's equations have no single answer.`
        : `A source with both ends on the same node is shorted by itself: it can't make any voltage, and SPICE's equations have no single answer.`,
      e.letter === 'L'
        ? "ngspice warns 'singular matrix', falls back to a 'transient op' and prints numbers it can't trust. [voltage-loop-11]"
        : `ngspice stops: 'instance ${lowerAscii(name)} is a shorted ${what}'. [voltage-loop-8, voltage-loop-9, voltage-loop-10]`,
    );
    return;
  }
  const inductors = members.filter((m) => m.letter === 'L');
  const sources = members.filter((m) => m.letter !== 'L');
  const sameEnds = others.length === 1;
  let title: string;
  let why: string;
  if (loop.inductor) {
    title = inductors.length === 1 && sources.length === 1 ? `${nameOf(inductors[0]!)} shorts ${nameOf(sources[0]!)} at DC` : `${list(members.map(nameOf))} form a loop at DC`;
    why = `At DC an inductor is a plain wire, so ${list(inductors.map(nameOf))} ${sources.length > 0 ? `short${inductors.length === 1 ? 's' : ''} ${list(sources.map(nameOf))}` : `form${inductors.length === 1 ? 's' : ''} a loop of wires`}. SPICE's equations then have no single answer.`;
  } else {
    title = sameEnds ? `${nameOf(others[0]!)} and ${name} are in parallel` : `${list(members.map(nameOf))} form a loop of voltage sources`;
    why = sameEnds
      ? `Two voltage sources in parallel each insist on their own voltage, and even equal ones leave SPICE unable to split the current between them: its equations have no single answer.`
      : `Voltage sources in a loop each insist on their own voltage, and SPICE can't split the current around the loop: its equations have no single answer.`;
  }
  add(
    c,
    'voltage-loop',
    'error',
    e.name,
    title,
    why,
    loop.inductor
      ? "ngspice warns 'singular matrix', falls back to a 'transient op' and prints numbers that can't be trusted. [voltage-loop-5]"
      : c.opNeeded
        ? "ngspice warns 'singular matrix' and then stops: 'The operating point could not be simulated successfully'. No results. [voltage-loop-1, voltage-loop-2, voltage-loop-3, voltage-loop-4]"
        : "With uic there is no operating point, but the loop still fails: ngspice warns 'singular matrix' and then stops: 'Timestep too small'. No results. [voltage-loop-7]",
  );
}

// ------------------------------------------------------------------ names, letters and models

function checkDuplicates(c: Ctx): void {
  const scopes: Map<string, Element>[] = [new Map()];
  for (const l of c.n.lines) {
    const d = l.directive?.name;
    if (d === '.subckt' || d === '.macro') scopes.push(new Map());
    else if ((d === '.ends' || d === '.eom') && scopes.length > 1) scopes.pop();
    const e = l.element;
    if (!e) continue;
    const scope = scopes[scopes.length - 1]!;
    // ngspice compares names as it spells them: capital letters aside, µ is u (W15) and each other letter
    // outside a to z is underscores, so Rş and Rç are both r__ (duplicate-name-3, W18), and Rµ and Ru are
    // both ru (duplicate-name-4).
    const spelled = ngspiceSpelling(e.key);
    const first = scope.get(spelled);
    if (!first) {
      scope.set(spelled, e);
      continue;
    }
    // Names that differ by more than capital letters (decided by the names as written: the key already
    // reads µ as u) get the reason that makes them one, never "SPICE ignores capital letters" (S9).
    const byLetters = lowerAscii(first.name.text) !== lowerAscii(e.name.text);
    const names = [first.name.text, e.name.text];
    const micro = names.some((x) => x.includes(MICRO));
    const others = names.some((x) => !isPlainName(x));
    const plain = byLetters ? plainLetters(e.name.text) : undefined;
    // A name in plain letters; when that is taken too, the next number after it (Ru2, not Rµ, which is ru).
    const renamed = freshName(c, plain && !c.names.has(lowerAscii(plain)) && !scope.has(ngspiceSpelling(lowerAscii(plain))) ? plain : plain || e.name.text);
    c.names.add(ngspiceName(renamed));
    add(
      c,
      'duplicate-name',
      'error',
      e.name,
      first.name.text === e.name.text ? `Two parts are called ${e.name.text}` : byLetters ? `${first.name.text} and ${e.name.text} are the same name for ngspice` : `${first.name.text} and ${e.name.text} are the same name`,
      byLetters
        ? `Every part needs its own name. ngspice ${micro && !others ? `reads the micro sign ${MICRO} as u` : lettersRule(names, 'a name')}, so ${first.name.text} and ${e.name.text} are both ${spelled}.`
        : 'Every part needs its own name, and SPICE ignores capital letters, so R1 and r1 count as the same name.',
      byLetters
        ? `ngspice stops at the second one: 'device already exists, bail out'. [${micro && others ? 'duplicate-name-3, duplicate-name-4' : micro ? 'duplicate-name-4' : 'duplicate-name-3'}]`
        : "ngspice stops at the second one: 'device already exists, bail out'. [duplicate-name-1, duplicate-name-2]",
      [fix(`Rename it ${renamed}`, replace(e.name, renamed))],
    );
  }
}

// ------------------------------------------------------------------ names ngspice spells with underscores

/**
 * The drawing's line for a node's name (`*@ label <node> x y`, src/schematic/format.ts), renamed with
 * the node, so a fix that renames a node keeps its name on the drawing. The label lines are read once,
 * on the first rename: reading every line again for each node renamed took seconds for a link with
 * thousands of such nodes (code-2). They are kept by the node they name as ngspice reads it, the micro
 * sign as u, as the parser keys the nodes, so `*@ label µş` is the label of the node µş (key uş) and
 * goes with it (names lane critic, 5); with `form`, only the labels written that way (aµ, not au:
 * checkMicroNode renames one spelling of a node).
 */
function labelChanges(c: Ctx, key: string, to: string, form?: string): TextChange[] {
  if (!c.labels) {
    const labels = new Map<string, { span: Span; form: string }[]>();
    for (const l of c.n.lines) {
      if (l.kind !== 'comment') continue;
      const m = /^(\s*\*@\s*label\s+)(\S+)/i.exec(l.text);
      if (!m) continue;
      const from = l.span.from + m[1]!.length;
      const label = { span: { from, to: from + m[2]!.length }, form: lowerAscii(m[2]!) };
      const name = ngspiceName(m[2]!);
      const same = labels.get(name);
      if (same) same.push(label);
      else labels.set(name, [label]);
    }
    c.labels = labels;
  }
  return (c.labels.get(key) ?? []).filter((x) => form === undefined || x.form === form).map((x) => replace(x.span, to));
}

/** A node named on a command line for ngspice: the word, its command, and whether it stands bare (save out) or inside v(...). */
interface CommandRef {
  token: Token;
  command: string;
  bare: boolean;
}

/** The words save takes besides names: what else to save (ngspice's beginPlot, outitf.c). */
const SAVE_WORDS: ReadonlySet<string> = new Set(['all', 'allv', 'alli', 'nosub', 'nointernals', 'none']);

/**
 * Commands for ngspice after which what a save does is not decided by reading the lines in order:
 * delete takes saves back; reset, source, remcirc, removecirc, setcirc, circbyline, edit and snload load,
 * reset or switch the circuit (after reset every vector is saved again: names lane critic 2, 4); and the
 * words that decide which commands run (ngspice's control.c), so a save inside `if 0` never runs.
 */
const UNDECIDED_COMMANDS: ReadonlySet<string> = new Set([
  'delete', 'reset', 'source', 'remcirc', 'removecirc', 'setcirc', 'circbyline', 'edit', 'snload',
  'if', 'else', 'end', 'while', 'repeat', 'dowhile', 'foreach', 'break', 'continue', 'label', 'goto',
]);

/**
 * A command line's code, after its *# or ## and before its comment (inside .control a ';', a '//' or a
 * '$' and a space starts one: S12-S15), with the offset where it starts.
 */
function commandCode(l: NetlistLine): { code: string; from: number } {
  const head = /^\s*(?:\*#|##)?/.exec(l.text)![0].length;
  let end = l.text.length;
  for (let i = head; i < l.text.length; i++) {
    const ch = l.text[i];
    if (ch === '"' || ch === "'") {
      const close = l.text.indexOf(ch, i + 1);
      if (close < 0) break;
      i = close;
    } else if (ch === ';' || (ch === '/' && l.text[i + 1] === '/') || (ch === '$' && l.text[i + 1] === ' ')) {
      end = i;
      break;
    }
  }
  return { code: l.text.slice(head, end), from: l.span.from + head };
}

/**
 * The node names on the commands for ngspice, the lines of a .control block and *# and ## lines: inside
 * v(...) (`save v(out)`, `print v(a, b)` ...), and for save a bare name too (`save out`). By node as the
 * parser keys them, with the command, read once. ngspice reads these lines as written, so a name it
 * spells with underscores is no node there (non-ascii-node-4); a fix that renames such a node renames
 * it there too. Words end only at an ASCII space, a tab or a comma, as for ngspice: a thin space or a
 * no-break space is part of a name (space-character-20).
 */
function controlNodes(c: Ctx): Map<string, CommandRef[]> {
  if (c.controlNodes) return c.controlNodes;
  const out = new Map<string, CommandRef[]>();
  const put = (from: number, text: string, command: string, bare: boolean): void => {
    const ref = { token: { from, to: from + text.length, text }, command, bare };
    const key = ngspiceName(text);
    const same = out.get(key);
    if (same) same.push(ref);
    else out.set(key, [ref]);
  };
  for (const l of c.n.lines) {
    if (l.kind !== 'control') continue;
    const { code, from } = commandCode(l);
    const command = lowerAscii(/^[ \t]*([^ \t(]*)/.exec(code)![1]!);
    // Each v( and the first ) after it, found once; with no ) left, no later v( closes either. A regex
    // that looked for the ) from every v( read the rest of the line again each time: one long line of
    // v( froze the page for seconds (names lane critic 2, 2).
    const open = /\bv(?:m|p|r|i|db)?[ \t]*\(/gi;
    for (let m = open.exec(code); m; m = open.exec(code)) {
      const inside = m.index + m[0].length;
      const close = code.indexOf(')', inside);
      if (close < 0) break;
      for (const w of code.slice(inside, close).matchAll(/[^ \t,]+/g)) put(from + inside + w.index, w[0], command, false);
      open.lastIndex = close + 1;
    }
    if (command !== 'save') continue;
    // The words outside brackets after save, other than a function's name (v, i ...) and save's own words.
    let depth = 0;
    let first = true;
    for (const w of code.matchAll(/[()]|[^ \t,()]+/g)) {
      if (w[0] === '(') depth += 1;
      else if (w[0] === ')') depth = Math.max(0, depth - 1);
      else if (first) first = false;
      else if (depth === 0 && !/^[ \t]*\(/.test(code.slice(w.index + w[0].length)) && !/[@#[\]=]/.test(w[0]) && !SAVE_WORDS.has(lowerAscii(w[0]))) {
        put(from + w.index, w[0], command, true);
      }
    }
  }
  c.controlNodes = out;
  return out;
}

/**
 * True when the commands for ngspice save something, and every save names only nodes ngspice does not
 * find: names it reads as written there, with a character outside printable ASCII (the micro sign
 * aside), as v(çıkış) or bare. PlainSpice's run, which runs the analyses again at the end to write its
 * results file, then has nothing to save: ngspice says "no data saved … analysis not run", and there are
 * no results (non-ascii-node-4). Anything else to save keeps the analysis running (non-ascii-node-7 to
 * -9): a name ngspice finds (v(in), in, i(v1), @r1[i]), save all, a .save line, .options savecurrents,
 * which PlainSpice adds for .op (src/spice/run-netlist.ts), also on a continuation line. Only for .dc,
 * .tran and .ac, whose results are node voltages, so that the plain name gives results again (a .tf
 * saves no node voltage at all). Whatever else might save something, take a save back or skip it leaves
 * it undecided: false. That is a .probe line, lines after .end (ngspice may read them too), a delete, a
 * command that loads or resets the circuit (reset: every vector is saved again), and a word that
 * decides which commands run (if, while, goto ...: a save inside `if 0` never runs). Read once.
 */
function savesNothing(c: Ctx): boolean {
  if (c.savesNothing !== undefined) return c.savesNothing;
  let saves = false;
  let nothing = c.n.analyses.length > 0 && c.n.analyses.every((i) => ['.dc', '.tran', '.ac'].includes(c.n.lines[i]!.directive!.name)) && !hasSaveCurrents(c.n);
  for (const l of c.n.lines) {
    if (!nothing) break;
    const d = l.directive?.name;
    if (l.kind === 'after-end' || d === '.save' || d === '.probe') {
      nothing = false;
    } else if (l.kind === 'control') {
      const words = commandCode(l).code.split(/[ \t]+/).filter(Boolean);
      const command = lowerAscii(words[0] ?? '');
      const args = words.slice(1);
      if (UNDECIDED_COMMANDS.has(command)) nothing = false;
      else if (command === 'save' && args.length) {
        saves = true;
        nothing = args.every((w) => {
          const name = /^v\(([^(),]+)\)$/i.exec(w)?.[1] ?? (/^[^(),@#[\]=]+$/.test(w) ? w : undefined);
          return name !== undefined && !isPlainName(name);
        });
      }
    }
  }
  c.savesNothing = saves && nothing;
  return c.savesNothing;
}

/** The words ngspice takes out of a .plot line before it saves the rest (its plot_opts, dotcards.c). */
const PLOT_OPTIONS: ReadonlySet<string> = new Set(['linear', 'xlog', 'ylog', 'loglog']);

/** What may save something under ngspice -b besides the .print and .plot lines, or read lines we do not see. */
const SAVING_DIRECTIVES: ReadonlySet<string> = new Set([
  '.save', '.probe', '.meas', '.measure', '.four', '.fourier', '.sndparam', '.sndprint', '.include', '.inc', '.lib', '.alter',
]);

/** A name ngspice -b tries to save from a word of a .print or .plot line: the name as it reads it, and where it stands. */
interface PrintName {
  name: string;
  token: Token;
}

/** A word of a .print or .plot line after its analysis type, as ngspice -b reads it (gettoks, dotcards.c). */
interface PrintItem {
  /** The node names it saves: the word itself when bare (out), the names inside brackets (v(a), v(a,b)). */
  names: PrintName[];
  bare: boolean;
  /** One name alone: bare, or the only name inside v(...), vm(...), vp(...), vr(...) or vdb(...). */
  lone: boolean;
}

/** A .print or .plot card as ngspice -b reads it: its directive, its analysis type (lower-case) and its words. */
interface PrintCard {
  directive: string;
  type: string;
  items: PrintItem[];
}

/** A node named on a .print or .plot line: where, on which kind of line, for which analysis, and whether bare. */
interface PrintRef {
  name: string;
  token: Token;
  directive: string;
  type: string;
  bare: boolean;
}

const isBlank = (ch: string): boolean => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\v' || ch === '\f';

/**
 * One word of a .print or .plot line, read as ngspice's gettoks reads it: a word that starts with a
 * bracket is dropped; a word with no bracket is a name as it stands (`.print dc out` prints v(out));
 * otherwise the name is what follows the last opening bracket, up to a comma or the closing bracket,
 * with a second name after the comma (v(a,b)), and a word whose last bracket follows an i (i(V1),
 * vi(x)) names a source's current, no node.
 */
function printItem(chars: readonly string[], at: readonly number[], text: string): PrintItem {
  const word = chars.join('');
  if (word.startsWith('(')) return { names: [], bare: false, lone: false };
  const name = (from: number, to: number): PrintName | undefined => {
    if (to <= from) return undefined;
    const a = at[from]!;
    const b = at[to - 1]! + 1;
    return { name: chars.slice(from, to).join(''), token: { from: a, to: b, text: text.slice(a, b) } };
  };
  const l = word.lastIndexOf('(');
  if (l < 0) {
    const bare = name(0, chars.length)!;
    return { names: [bare], bare: true, lone: true };
  }
  if (/[iI]/.test(word[l - 1] ?? '')) return { names: [], bare: false, lone: false };
  const r = word.indexOf(')');
  const comma = word.indexOf(',');
  if ((comma >= 0 && comma < l) || (r >= 0 && r < l) || (comma >= 0 && r < comma)) return { names: [], bare: false, lone: false };
  const first = name(l + 1, comma >= 0 ? comma : r >= 0 ? r : chars.length);
  const second = comma >= 0 ? name(comma + 1, r) : undefined;
  const names = [first, second].filter((x): x is PrintName => x !== undefined);
  const call = lowerAscii(word.slice(0, word.indexOf('(')));
  const lone = names.length === 1 && comma < 0 && word.indexOf('(') === l && r === chars.length - 1 && ['v', 'vm', 'vp', 'vr', 'vdb'].includes(call);
  return { names, bare: false, lone };
}

/**
 * The .print and .plot cards as ngspice -b reads them (ft_savedotargs and gettoks in its dotcards.c):
 * the card joined with its continuation lines, its comment left out, the analysis type its first word,
 * then words split at blanks and at commas outside brackets, with the blanks inside brackets left out;
 * on a .plot line ngspice drops linear, xlog, ylog and loglog. Read once.
 */
function printCards(c: Ctx): PrintCard[] {
  if (c.printCards) return c.printCards;
  const cards: PrintCard[] = [];
  for (const i of c.n.directives) {
    const d = c.n.lines[i]!.directive!;
    if (d.name !== '.print' && d.name !== '.plot') continue;
    // Each line of the card up to the end of its last word and the brackets, commas and blanks after it:
    // a comment starts with none of them. A continuation line joins after a space, as in ngspice.
    const chars: string[] = [];
    const at: number[] = [];
    const last = c.lastContinuation.get(i) ?? i;
    for (let k = i; k <= last; k++) {
      const line = c.n.lines[k]!;
      if (k > i && line.continues !== i) continue;
      let p = k === i ? d.token.to : line.span.from + /^[ \t]*\+?/.exec(line.text)![0].length;
      let end = p;
      for (const t of line.tokens) if (t.to > end) end = t.to;
      while (end < line.span.to && ' \t,=()'.includes(c.text[end]!)) end += 1;
      if (k > i) {
        chars.push(' ');
        at.push(-1);
      }
      for (; p < end; p++) {
        chars.push(c.text[p]!);
        at.push(p);
      }
    }
    const n = chars.length;
    let q = 0;
    while (q < n && isBlank(chars[q]!)) q += 1;
    const typeFrom = q;
    let depth = 0;
    while (q < n && !isBlank(chars[q]!)) {
      const ch = chars[q]!;
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === ',' && depth < 1) break;
      q += 1;
    }
    const type = lowerAscii(chars.slice(typeFrom, q).join(''));
    const items: PrintItem[] = [];
    for (;;) {
      while (q < n && (isBlank(chars[q]!) || chars[q] === ',')) q += 1;
      if (q >= n) break;
      const word: string[] = [];
      const from: number[] = [];
      let inside = false;
      depth = 0;
      for (; q < n; q++) {
        const ch = chars[q]!;
        if (!inside && (isBlank(ch) || (ch === ',' && depth < 1))) break;
        if (inside && isBlank(ch)) continue;
        word.push(ch);
        from.push(at[q]!);
        if (ch === '(') {
          depth += 1;
          inside = true;
        } else if (ch === ')') {
          depth -= 1;
          inside = false;
        }
      }
      if (d.name === '.plot' && PLOT_OPTIONS.has(lowerAscii(word.join('')))) continue;
      items.push(printItem(word, from, c.text));
    }
    cards.push({ directive: d.name, type, items });
  }
  c.printCards = cards;
  return cards;
}

/** The node names on .print and .plot lines, by node as the parser keys them (ngspiceName), read once. */
function printNodes(c: Ctx): Map<string, PrintRef[]> {
  if (c.printNodes) return c.printNodes;
  const out = new Map<string, PrintRef[]>();
  for (const card of printCards(c)) {
    for (const item of card.items) {
      for (const { name, token } of item.names) {
        const ref = { name, token, directive: card.directive, type: card.type, bare: item.bare };
        const key = ngspiceName(name);
        const same = out.get(key);
        if (same) same.push(ref);
        else out.set(key, [ref]);
      }
    }
  }
  c.printNodes = out;
  return out;
}

/**
 * True when ngspice -b would save nothing at all, so it runs no analysis ("no data saved … analysis not
 * run"): every analysis is a .dc, .tran or .ac (an .op or .tf saves everything for itself), nothing but
 * the .print and .plot lines asks to save anything (no .save, .probe, .meas, .four or savecurrents, no
 * command for ngspice, no line after .end), and every word of every .print and .plot line is one name
 * ngspice can't parse: bare or alone in v(...), with a character outside printable ASCII, the micro sign
 * aside (non-ascii-node-3). Anything else, a name it finds (v(in), i(V1)), two names in one v(...),
 * leaves it undecided: false (the analysis runs: non-ascii-node-13). Read once.
 */
function printsNothing(c: Ctx): boolean {
  if (c.printsNothing !== undefined) return c.printsNothing;
  const cards = printCards(c);
  let nothing = cards.length > 0 && c.n.analyses.length > 0 && c.n.analyses.every((i) => ['.dc', '.tran', '.ac'].includes(c.n.lines[i]!.directive!.name)) && !hasSaveCurrents(c.n);
  for (const l of c.n.lines) {
    if (!nothing) break;
    if (l.kind === 'control' || l.kind === 'after-end' || SAVING_DIRECTIVES.has(l.directive?.name ?? '')) nothing = false;
  }
  c.printsNothing =
    nothing &&
    cards.every((card) => card.items.length > 0 && card.items.every((item) => item.lone && !isPlainName(item.names[0]!.name) && !/[@#[\]=]/.test(item.names[0]!.name)));
  return c.printsNothing;
}

/**
 * The sentences for the lines where ngspice reads a node's name as written, not as the name it gave the
 * node (W16), each said only when such a line names one of the nodes (`print`, `command`; each check
 * cites its own claims for them); for several nodes that ngspice makes one, one sentence of each kind,
 * listing the names. A .print or .plot line, which ngspice leaves out of the step that writes such
 * letters as `_`: run as ngspice -b it finds no such node there, warns "can't parse" (unless a save
 * of the name came first: non-ascii-node-14) and prints nothing for that line, and, when nothing else
 * can be printed or saved, runs no analysis (printsNothing, non-ascii-node-13), while PlainSpice's run
 * leaves those lines out (non-ascii-node-3). Only a line whose analysis the netlist runs counts: ngspice
 * saves a .print tran line's names only for a .tran, and warns about them only then. The name may stand
 * inside v(...) or bare (printNodes). A command for ngspice (.control, *#, ##), where it finds no such
 * node either (non-ascii-node-4), and where a save that leaves it nothing to save gives PlainSpice's run
 * no results (savesNothing). The quoted message spells the name as ngspice does, µ as u and capitals
 * small ("can't parse 'uş'"). With `show` false the words never show the name (an invisible character,
 * a character that looks like a space): they say "the name".
 */
function asWritten(c: Ctx, infos: readonly NodeInfo[], show: boolean): { said: string[]; print: boolean; command: boolean } {
  const said: string[] = [];
  const runs = (c.runTypes ??= new Set(c.n.analyses.map((i) => c.n.lines[i]!.directive!.name.slice(1))));
  const afterEnd = (c.afterEnd ??= c.n.lines.some((l) => l.kind === 'after-end'));
  // For each node, the first .print or .plot line for an analysis the netlist runs, and whether ngspice
  // warns about the name: ngspice saves a name once, so only when the first line that names it is for an
  // analysis that runs, and no save of the name in a command for ngspice, which it reads before them,
  // came first (non-ascii-node-14); lines after .end may hold such a save too.
  const printed: PrintRef[] = [];
  const warned: string[] = [];
  for (const info of infos) {
    const refs = printNodes(c).get(info.name) ?? [];
    const ref = refs.find((r) => runs.has(r.type));
    if (!ref) continue;
    printed.push(ref);
    if (!afterEnd && runs.has(refs[0]!.type) && !(controlNodes(c).get(info.name) ?? []).some((x) => x.command === 'save')) warned.push(ngspiceName(refs[0]!.name));
  }
  if (printed.length) {
    const ignored = `PlainSpice's run leaves .print and .plot lines out (ngspice: "${printed[0]!.directive} line ignored since rawfile was produced.").`;
    const lines = new Set(printed.map((r) => lineAt(c.n, r.token.from).continues ?? lineAt(c.n, r.token.from).index)).size;
    const that = lines === 1 ? 'that line' : 'those lines';
    const none = printsNothing(c) ? '; with nothing else it can print or save, it runs no analysis ("no data saved")' : '';
    const warns = !warned.length ? '' : show ? `warns ${list(warned.map((x) => `"can't parse '${x}'"`))}${warned.length > 1 ? ',' : ''} and ` : 'warns that it can\'t parse the name and ';
    said.push(
      !show
        ? `On a .print or .plot line it reads the name as written, with the character in it, so it finds no such node there: run as ngspice -b, it ${warns}prints nothing for that line${none}. ${ignored}`
        : `On a .print or .plot line it reads ${printed.length === 1 ? 'the name' : 'each name'} as written, so it finds no node ${list(printed.map((r) => r.name), 'or')} there: run as ngspice -b, it ${warns}prints nothing for ${that}${none}. ${ignored}`,
    );
  }
  const commands = infos.map((info) => controlNodes(c).get(info.name) ?? []).filter((x) => x.length > 0);
  if (commands.length) {
    // Each node's first save, those on one line said as one save (save v(ş) v(ç)).
    const saves = new Map<number, string[]>();
    for (const x of commands.flatMap((y) => y.find((z) => z.command === 'save') ?? [])) {
      const line = lineAt(c.n, x.token.from).index;
      saves.set(line, [...(saves.get(line) ?? []), x.bare ? x.token.text : `v(${x.token.text})`]);
    }
    const star = /^\s*(\*#|##)/.exec(lineAt(c.n, commands[0]![0]!.token.from).text)?.[1];
    const where = star ? `On a ${star} line, a command for ngspice,` : 'In a .control block';
    const saved = list([...saves.values()].map((names) => `save ${names.join(' ')}`));
    const none = saves.size && savesNothing(c) ? `${show ? `${saved} ${saves.size === 1 ? 'saves' : 'save'}` : 'the save of that name saves'} nothing, and since nothing else is saved, PlainSpice's run gives no results ("no data saved")` : '';
    said.push(
      show
        ? `${where} it reads ${commands.length === 1 ? 'the name' : 'each name'} as written too, so it finds no node ${list(commands.map((x) => x[0]!.token.text), 'or')} there${none ? `: ${none}` : ''}.`
        : `${where} it reads the name as written too, with the character in it, so it finds no such node there${none ? `: ${none}` : ''}.`,
    );
  }
  return { said, print: printed.length > 0, command: commands.length > 0 };
}

/**
 * What ngspice does with a node name it spells with underscores, said only as far as it holds in every
 * run (S10): it spells the node so in its printout and results (non-ascii-node-1), "without a message"
 * only when no line where it reads the name as written names the node (asWritten: non-ascii-node-3, -4).
 */
function spelledNodeSentence(c: Ctx, info: NodeInfo, spelled: string): string {
  const { said, print, command } = asWritten(c, [info], true);
  // Cites [non-ascii-node-1, non-ascii-node-3, non-ascii-node-4], the last two for their sentences.
  const facts = ['non-ascii-node-1', ...(print ? ['non-ascii-node-3'] : []), ...(command ? ['non-ascii-node-4'] : [])];
  return [`ngspice spells the node ${spelled} in its printout and results${said.length ? '.' : ', without a message.'}`, ...said, `[${facts.join(', ')}]`].join(' ');
}

/**
 * Every word ngspice reads as a node's name outside subcircuits, by node as the parser keys them (C3-1):
 * on part lines its nodes, and the nodes a formula reads inside v(...) (B lines, E and G written with
 * VALUE=, vol=, cur= or TABLE, R, C and L values written as formulas); on dot commands the words inside
 * v(...) and .pz's four nodes (all NodeInfo.refs); a name bare on a .print or .plot line (printNodes);
 * the commands for ngspice (controlNodes); and all of these on the lines after a plain .end, which
 * ngspice reads as part of the circuit (S25, readAfterEnd), each line read as the parser would read it
 * before .end. A rename that changes them all changes no part's connection and no formula. Read once.
 */
function referencesOf(c: Ctx): Map<string, Token[]> {
  if (c.references) return c.references;
  const found = new Map<string, Map<number, Token>>();
  const put = (key: string, t: Token): void => {
    let same = found.get(key);
    if (!same) found.set(key, (same = new Map()));
    if (!same.has(t.from)) same.set(t.from, t);
  };
  for (const [key, info] of c.n.nodes) for (const t of info.refs) put(key, t);
  for (const [key, refs] of printNodes(c)) for (const r of refs) put(key, r.token);
  for (const [key, refs] of controlNodes(c)) for (const r of refs) put(key, r.token);
  const after = readAfterEnd(c.n);
  if (after.length) {
    // The lines after .end, read on their own as the lines before it are: a later .end becomes a
    // comment of the same length, so that every one of them is read (S25).
    const from = after[0]!.span.from;
    const body = c.text.slice(from, after[after.length - 1]!.span.to).replace(/^([ \t]*)\.(end(?=[ \t;\r]|$))/gim, '$1*$2');
    const shift = from - 2;
    for (const [key, tokens] of referencesOf(context(parseNetlist(`*\n${body}`)))) {
      for (const t of tokens) put(key, { from: t.from + shift, to: t.to + shift, text: t.text });
    }
  }
  c.references = new Map([...found].map(([key, same]) => [key, [...same.values()].sort((a, b) => a.from - b.from)]));
  return c.references;
}

const referencesCache = new WeakMap<Netlist, Map<string, Token[]>>();

/**
 * Every word ngspice reads as the node `key` (lower-case, as the parser keys it) outside subcircuits,
 * in netlist order (referencesOf): what the drawing editor's renames change (src/schematic/edit.ts).
 */
export function nodeReferences(netlist: Netlist, key: string): Token[] {
  let all = referencesCache.get(netlist);
  if (!all) {
    all = referencesOf(context(netlist));
    referencesCache.set(netlist, all);
  }
  return all.get(key) ?? [];
}

/**
 * The words on the lines ngspice reads, outside subcircuits, that are a node's name (with `form`,
 * written that way) and that no reader above found (C3-1): a form of line PlainSpice does not read,
 * such as a command for ngspice that names the node bare (print çıkış). Only for a name with a
 * character outside printable ASCII (the checks below; µ too), which no keyword, model or parameter
 * of ngspice's is: there such a word names the node. Words end at a blank, ',', '(', ')' or '=', as
 * the names ngspice reads do, and on a command for ngspice, which reads an expression, at an operator too.
 */
function namedElsewhere(c: Ctx, key: string, found: readonly Token[], form?: string): Token[] {
  if (!c.oddWords) {
    // Read once for all the nodes (a link with thousands of such names stays fast: code-2).
    const words = new Map<string, Token[]>();
    const read = new Set(readAfterEnd(c.n).map((l) => l.index));
    let depth = 0;
    for (const l of c.n.lines) {
      const head = /^[ \t]*\.(subckt|macro|ends|eom)\b/i.exec(l.text)?.[1]?.toLowerCase();
      if (head === 'subckt' || head === 'macro') depth += 1;
      const inside = depth > 0;
      if (head === 'ends' || head === 'eom') depth = Math.max(0, depth - 1);
      if (inside || head) continue;
      const reads = l.kind === 'element' || l.kind === 'directive' || l.kind === 'continuation' || l.kind === 'control' || read.has(l.index);
      if (!reads || /^[\x20-\x7e\t]*$/.test(l.text)) continue;
      let end = 0;
      for (const t of l.tokens) end = Math.max(end, t.to - l.span.from);
      const command = l.kind === 'control';
      const { code, from } = command ? commandCode(l) : { code: l.text.slice(0, end), from: l.span.from };
      // A command reads an expression: there a name also ends at an operator (let x = 2*çıkış).
      for (const w of code.matchAll(command ? /[^ \t\r\n\v\f,()=+\-*/^%<>&|!{}[\]"';]+/g : /[^ \t\r\n\v\f,()=]+/g)) {
        if (/^[\x20-\x7e]*$/.test(w[0])) continue;
        const name = ngspiceName(w[0]);
        const same = words.get(name) ?? [];
        same.push({ from: from + w.index, to: from + w.index + w[0].length, text: w[0] });
        words.set(name, same);
      }
    }
    c.oddWords = words;
  }
  const known = new Set(found.map((t) => t.from));
  return (c.oddWords.get(key) ?? []).filter((t) => !known.has(t.from) && (form === undefined || lowerAscii(t.text) === form));
}

/**
 * The changes that rename a node everywhere ngspice reads its name (referencesOf), and, for a name with a
 * character outside printable ASCII, wherever else a line ngspice reads names it (namedElsewhere), so a
 * working circuit stays the same circuit (C3-1). With `form`, only the words written that way
 * (checkMicroNode renames one spelling of a node). The drawing's label lines are the caller's (labelChanges).
 */
function renamesOf(c: Ctx, key: string, to: string, form?: string): TextChange[] {
  const found = (referencesOf(c).get(key) ?? []).filter((t) => form === undefined || lowerAscii(t.text) === form);
  return [...found, ...namedElsewhere(c, key, found, form)].map((t) => replace(t, to));
}

/**
 * New names for nodes, each `wanted` when ngspice spells it like no name in `taken`, else wanted2,
 * wanted3 ... (and then taken too). Never ground's own names, 0 and gnd (W8), which would join the node
 * to ground, nor a name that reads as ground (GROUND_LIKE: ground, earth, 00 ...), which the
 * ground-misnamed check would flag: gñd becomes gnd2, gröund ground2 (code-3). The next number to try
 * is kept for each name, so thousands of names with the same plain letters stay fast (code-2).
 */
function nodeNamer(taken: Set<string>): (wanted: string) => string {
  const next = new Map<string, number>();
  const free = (name: string): boolean => {
    const spelled = ngspiceSpelling(name);
    return !taken.has(spelled) && spelled !== GROUND && !GROUND_LIKE.test(spelled);
  };
  return (wanted) => {
    const base = wanted || 'n';
    let name = base;
    if (!free(name)) {
      const key = ngspiceSpelling(base);
      let k = next.get(key) ?? 2;
      while (!free(`${base}${k}`)) k += 1;
      next.set(key, k + 1);
      name = `${base}${k}`;
    }
    taken.add(ngspiceSpelling(name));
    return name;
  };
}

/**
 * How ngspice writes the letters of a name outside a to z (W16): as underscores, and the micro sign as u
 * (W15), said when one of the names has it, so the u of "u__" for µş is not left unexplained.
 */
function lettersRule(names: readonly string[], what: string): string {
  return names.some((x) => x.includes(MICRO))
    ? `reads the micro sign ${MICRO} as u and writes the other letters outside a to z (or A to Z) in ${what} as underscores`
    : `writes each letter other than a to z (or A to Z) in ${what} as underscores`;
}

/**
 * Node names ngspice spells with underscores (W16, W17). It reads only printable ASCII in a name and
 * writes every byte of any other character as '_', so giriş is giri__ in its printout and results
 * (non-ascii-node-1), and names it spells the same are one node: ş and ç are both __
 * (non-ascii-node-2). A name on its own: a warning, with a fix to plain letters. Names that become
 * one: an error, because ngspice then simulates another circuit; the fix gives each its plain letters.
 * A name with an invisible character is the invisible-character check's. µ alone is fine (ngspice reads
 * u), but one node written with µ in one place and u in another (aµ, au) looks like two nodes: a warning
 * when a part has an end on each, whose ends it joins (non-ascii-node-5, -11), else a note.
 * The fixes never give a name ngspice already uses, that would join two nodes, nor one of ground's
 * (nodeNamer).
 */
function checkNodeNames(c: Ctx): void {
  const groups = new Map<string, NodeInfo[]>();
  for (const info of c.n.nodes.values()) {
    if (info.ground || info.refs.length === 0) continue;
    const spelled = ngspiceSpelling(info.name);
    const g = groups.get(spelled);
    if (g) g.push(info);
    else groups.set(spelled, [info]);
  }
  const freeName = nodeNamer(new Set(groups.keys()));
  const plainFor = (info: NodeInfo): string => freeName(plainLetters(info.refs[0]!.text, true) || 'n1');
  const renaming = (info: NodeInfo, to: string): TextChange[] => [...renamesOf(c, info.name, to), ...labelChanges(c, info.name, to)];
  for (const [spelled, infos] of groups) {
    if (infos.length > 1) {
      const odd = infos.filter((i) => !isPlainName(i.name));
      const names = infos.map((i) => i.refs[0]!.text);
      const to = odd.map((i) => [i, plainFor(i)] as const);
      const at = (odd[odd.length - 1] ?? infos[infos.length - 1]!).refs[0]!;
      // The names with such letters, where a line names them that ngspice reads as written (S10), one
      // sentence for them all (names lane critic 2, 7). Cites [non-ascii-node-2, non-ascii-node-3,
      // non-ascii-node-4], the last two for their sentences.
      const { said, print, command } = asWritten(c, odd, true);
      const facts = ['non-ascii-node-2', ...(print ? ['non-ascii-node-3'] : []), ...(command ? ['non-ascii-node-4'] : [])];
      add(c, 'non-ascii-node', 'error', at, `${list(names)} are one node for ngspice`,
        `ngspice ${lettersRule(names, 'a node name')}, so ${list(names)} ${names.length === 2 ? 'both' : 'all'} become ${spelled}: one node. It simulates a different circuit from the one written here. Give each node a name in plain letters.`,
        [`ngspice spells ${list(names)} as ${spelled} and makes them one node${said.length ? '' : ', without a message'}: in one test this put both ends of a resistor on that node, so it carried no current.`, ...said, `[${facts.join(', ')}]`].join(' '),
        to.length ? [fix(`Write ${list(to.map(([i, n]) => `${n} for ${i.refs[0]!.text}`))}`, ...to.flatMap(([i, n]) => renaming(i, n)))] : []);
      continue;
    }
    const info = infos[0]!;
    // The characters that look like a space, the invisible ones and the look-alikes have checks of their
    // own (nbsp, space-character, invisible-character, look-alike-letter).
    if (isPlainName(info.name) || hasInvisible(info.name) || hasSpaceLike(info.name) || lookAlikeName(info.refs[0]!.text) !== undefined) continue;
    const written = info.refs[0]!.text;
    const letter = [...written].find((ch) => !isPlainName(ch))!;
    const to = plainFor(info);
    add(c, 'non-ascii-node', 'warning', info.refs[0]!, `ngspice spells the node ${written} as ${spelled}`,
      `ngspice ${lettersRule([written], 'a node name')} (${letter} as ${ngspiceSpelling(letter)}), so its printout and results call this node ${spelled}, and two names can become one node. A name in plain letters avoids both.`,
      spelledNodeSentence(c, info, spelled),
      [fix(`Rename ${written} to ${to}`, ...renaming(info, to))]);
  }
  for (const info of c.n.nodes.values()) checkMicroNode(c, info, freeName);
}

/**
 * One node written with the micro sign in one place and u in another (aµ and au, words re-check 8):
 * ngspice reads µ as u (W15), and so does PlainSpice's parser, so they are one node, and the drawing
 * shows them joined, but nothing said why. Only spellings on part lines count: a directive that writes
 * the node the other way still names the node meant. A part with an end on each spelling has those ends
 * joined: a warning, whose fix gives the µ spelling a plain name of its own, as the netlist reads to a
 * person. Only a resistor, a capacitor (without a starting voltage, ic=) or a diode then carries no
 * current for sure, with no voltage across it (non-ascii-node-5, -10); what the joined ends do to another
 * part depends on the part: a capacitor with ic= discharges at the first point under uic (-12), a
 * current source still drives its current, a dependent source or a transistor still works, a voltage
 * source stops ngspice and an inductor makes its matrix singular (non-ascii-node-11; the voltage-loop
 * check says so for those two), so for them the words say only which ends are joined. With no part
 * across, a note, whose fix writes the node one way, as ngspice reads it. A name with other letters
 * outside a to z is the check above's.
 */
function checkMicroNode(c: Ctx, info: NodeInfo, freeName: (wanted: string) => string): void {
  if (info.ground || info.refs.length < 2 || !isPlainName(info.name)) return;
  const forms = new Map<string, Token[]>();
  for (const t of info.refs) {
    const k = lowerAscii(t.text);
    const refs = forms.get(k);
    if (refs) refs.push(t);
    else forms.set(k, [t]);
  }
  if (forms.size < 2) return;
  const onParts = new Set<string>();
  const across: Element[] = [];
  for (const line of new Set(info.connections.map((k) => k.line))) {
    const e = el(c, line);
    const own = new Set(e.nodes.filter((r) => r.name === info.name).map((r) => lowerAscii(r.token.text)));
    for (const f of own) onParts.add(f);
    if (own.size > 1) across.push(e);
  }
  if (onParts.size < 2) return;
  const all = [...forms];
  const kept = all.find(([k]) => !k.includes(MICRO)) ?? all[0]!;
  const others = all.filter((x) => x !== kept);
  const shown = all.map(([, refs]) => refs[0]!.text);
  const micro = others.map(([, refs]) => refs[0]!.text);
  const spelled = ngspiceSpelling(info.name);
  const writing = (form: string, to: string): TextChange[] => [...renamesOf(c, info.name, to, form), ...labelChanges(c, info.name, to, form)];
  const ngspice = `ngspice reads ${MICRO} as u and makes ${list(shown)} one node, ${spelled}, without a message`;
  if (across.length) {
    const names = across.map(nameOf);
    const at = across[0]!.nodes.find((r) => r.name === info.name && lowerAscii(r.token.text) !== kept[0])!.token;
    const to = others.map(([form, refs]) => [form, refs[0]!.text, freeName(plainLetters(refs[0]!.text, true) || 'n1')] as const);
    // A resistor, a capacitor or a diode with an end on each spelling has no voltage across it; but a
    // capacitor given a starting voltage (ic=) starts with it under uic, and carries −5000 A at the first
    // point (non-ascii-node-12; names lane critic 2, 5): no current claim for it.
    const startsCharged = (e: Element): boolean => e.letter === 'C' && e.fields.some((f) => f.role === 'parameter' && lowerAscii(f.token.text) === 'ic');
    const twoEnded = (e: Element): boolean => (e.letter === 'R' || e.letter === 'C' || e.letter === 'D') && e.nodes.length === 2;
    const still = across.every((e) => twoEnded(e) && !startsCharged(e));
    // Otherwise the facts for the parts there: another part (non-ascii-node-11), a capacitor that starts charged (-12).
    const cited = ['non-ascii-node-5', ...(across.some((e) => !twoEnded(e)) ? ['non-ascii-node-11'] : []), ...(across.some(startsCharged) ? ['non-ascii-node-12'] : [])];
    const joined = across.map((e) => {
      const k = e.nodes.filter((r) => r.name === info.name).length;
      const many = COUNT_WORDS[k] ?? String(k);
      return k < e.nodes.length ? `${many} ends of ${nameOf(e)}` : k === 2 ? `both ends of ${nameOf(e)}` : `all ${many} ends of ${nameOf(e)}`;
    });
    add(c, 'non-ascii-node', 'warning', at, `${list(shown)} are one node for ngspice`,
      still
        ? `ngspice reads the micro sign ${MICRO} as u, so ${list(shown)} are the same node: ${list(names)} ${names.length === 1 ? 'has both ends on it and carries' : 'have both ends on it and carry'} no current. Give ${list(micro)} a name of its own in plain letters.`
        : `ngspice reads the micro sign ${MICRO} as u, so ${list(shown)} are the same node, which joins ${list(joined)}. Give ${list(micro)} a name of its own in plain letters.`,
      still
        ? across.every((e) => e.letter === 'R')
          ? `${ngspice}: in one test a resistor with an end on each carried no current. [non-ascii-node-5]`
          : `${ngspice}: in tests a resistor, a capacitor and a diode with an end on each carried no current. [non-ascii-node-5, non-ascii-node-10]`
        : `ngspice reads ${MICRO} as u and makes ${list(shown)} one node, ${spelled}. [${cited.join(', ')}]`,
      [fix(to.length === 1 ? `Rename ${to[0]![1]} to ${to[0]![2]}` : `Write ${list(to.map(([, from, n]) => `${n} for ${from}`))}`, ...to.flatMap(([form, , n]) => writing(form, n)))]);
    return;
  }
  const one = kept[1][0]!.text;
  add(c, 'non-ascii-node', 'info', others[0]![1][0]!, `${list(shown)} are one node for ngspice`,
    `ngspice reads the micro sign ${MICRO} as u, so ${list(shown)} are the same node, written two ways. If they should be two nodes, give ${list(micro)} a name of its own in plain letters.`,
    `${ngspice}. [non-ascii-node-5]`,
    [fix(`Write ${one} for ${list(micro)}`, ...others.flatMap(([form]) => writing(form, one)))]);
}

/**
 * A node name with an invisible character in it (security review F2; invisible-character-3): ngspice
 * keeps it in the name, written with underscores, so ou<zero-width space>t is the node ou___t, not out,
 * and the parts on it are not connected to out. The fix takes the character out; when a node of that
 * name exists, that joins them, as the student meant. The words name the character, never show it.
 */
function checkInvisibleNodes(c: Ctx): void {
  for (const info of c.n.nodes.values()) {
    if (info.ground || info.refs.length === 0 || !hasInvisible(info.name)) continue;
    const t = info.refs[0]!;
    const ch = [...t.text].find((x) => INVISIBLE.test(x))!;
    const what = nameOfCharacter(ch)!;
    const clean = withoutInvisible(t.text);
    const other = c.n.nodes.get(lowerAscii(clean));
    const changes = [...renamesOf(c, info.name, clean), ...(other ? [] : labelChanges(c, info.name, clean))];
    const { said, print, command } = asWritten(c, [info], false);
    // Cites [invisible-character-3, invisible-character-65, invisible-character-66], the last two for their sentences.
    const facts = ['invisible-character-3', ...(print ? ['invisible-character-65'] : []), ...(command ? ['invisible-character-66'] : [])];
    add(c, 'invisible-character', 'warning', t, `${capital(what)} hides in the node name ${clean}`,
      `It is a character you cannot see (it often comes with text copied from a web page or a PDF), and SPICE keeps it in the name, so this is ${other ? `not the node ${clean} the other lines name but another node` : `a node called ${ngspiceSpelling(info.name)} for ngspice`}.`,
      [`ngspice keeps the character in the name, as underscores (${ngspiceSpelling(info.name)}), and makes a separate node${said.length ? '' : ', without a message'}: in one test the resistor on it carried no current.`, ...said, `[${facts.join(', ')}]`].join(' '),
      [fix(other ? `Take it out: connect to ${clean}` : `Take it out: name the node ${clean}`, ...changes)]);
  }
}

/**
 * A node name with a character that looks like a space in it (critic of round 2; space-character-10):
 * ngspice keeps it in the name, written with underscores, so o<thin space>ut is the node o___ut, not
 * out, and the parts on it are not connected to out. As for an invisible character, the fix takes it
 * out, which joins the node to out when the netlist has one, as was meant; "Replace it with a normal
 * space" would make the line a word longer (space-character-9). Left to checkSpaces when a part on the
 * node has no value: there the character stands where a space was meant (space-character-4). Runs
 * before checkSpaces. The words name the character, never show it.
 */
function checkSpaceNodes(c: Ctx): void {
  for (const info of c.n.nodes.values()) {
    if (info.ground || info.refs.length === 0 || !hasSpaceLike(info.name) || hasInvisible(info.name)) continue;
    const valueless = info.connections.some((k) => {
      const e = el(c, k.line);
      // A formula, a table or a polynomial is no missing value (C3-5).
      return !!e.letter && VALUE_LETTERS.has(e.letter) && !e.value && !e.form && !e.fields.some((f) => f.role === 'model');
    });
    if (valueless) continue;
    for (const r of info.refs) {
      c.spaced.add(r.from);
      for (let k = 0; k < r.text.length; k++) if (SPACE_LIKE.test(r.text[k]!)) c.spacedChars.add(r.from + k);
    }
    const t = info.refs[0]!;
    const ch = [...t.text].find((x) => SPACE_LIKE.test(x))!;
    const clean = withoutSpaces(t.text);
    const other = c.n.nodes.get(lowerAscii(clean));
    const changes = [...renamesOf(c, info.name, clean), ...(other ? [] : labelChanges(c, info.name, clean))];
    const { said, print, command } = asWritten(c, [info], false);
    // Cites [space-character-10, space-character-20, space-character-21], the last two for their sentences.
    const facts = ['space-character-10', ...(print ? ['space-character-20'] : []), ...(command ? ['space-character-21'] : [])];
    add(c, ch === '\u00a0' ? 'nbsp' : 'space-character', 'warning', t, `The node ${withSpaces(t.text)} has ${nameOfCharacter(ch)!} in it`,
      `It looks like a space, but SPICE does not treat it as one: it keeps it in the name, so this is ${other ? `not the node ${clean} the other lines name but another node, and the parts on it are not connected to ${clean}` : `a node called ${ngspiceSpelling(info.name)} for ngspice`}.`,
      [`ngspice keeps the character in the name, as underscores (${ngspiceSpelling(info.name)}), and makes a separate node${said.length ? '' : ', without a message'}: in one test the resistor on it carried no current.`, ...said, `[${facts.join(', ')}]`].join(' '),
      [fix(other ? `Take it out: connect to ${clean}` : `Take it out: name the node ${clean}`, ...changes)]);
  }
}

/**
 * A node name with a letter from another alphabet that looks like a Latin one (critic of the
 * final-review fixes; look-alike-letter-5): ngspice writes its bytes as '_', so оut with a Cyrillic о is
 * the node __ut, not out, and the parts on it are not connected to out. The words name the letter
 * ("the Cyrillic letter о, which looks like o"); the fix writes the plain letters, which joins the node
 * to the one of that name when there is one, as was meant. Only when every letter outside ASCII is such
 * a look-alike: a name with a Turkish letter too is the non-ascii-node check's.
 */
function checkLookAlikeNodes(c: Ctx): void {
  for (const info of c.n.nodes.values()) {
    if (info.ground || info.refs.length === 0 || hasInvisible(info.name) || hasSpaceLike(info.name)) continue;
    const t = info.refs[0]!;
    const clean = lookAlikeName(t.text);
    if (clean === undefined) continue;
    const ch = cleanWord(t.text).odd[0]!;
    const like = lookAlikeOf(ch)!;
    const other = c.n.nodes.get(lowerAscii(clean));
    const changes = [...renamesOf(c, info.name, clean), ...(other ? [] : labelChanges(c, info.name, clean))];
    const { said, print, command } = asWritten(c, [info], true);
    // Cites [look-alike-letter-5, look-alike-letter-16, look-alike-letter-17], the last two for their sentences.
    const facts = ['look-alike-letter-5', ...(print ? ['look-alike-letter-16'] : []), ...(command ? ['look-alike-letter-17'] : [])];
    add(c, 'look-alike-letter', 'warning', t, `The node ${t.text} has ${describeCharacter(ch).replace(/, which looks like .*$/, '')}`,
      other
        ? `It looks like ${like}, but SPICE knows only the plain letter ${like}, so this is not the node ${clean} the other lines name: it is another node, and the parts on it are not connected to ${clean}.`
        : `It looks like ${like}, but SPICE knows only the plain letter ${like}, so ngspice calls this node ${ngspiceSpelling(info.name)}.`,
      [`ngspice writes the letter's bytes as underscores (${ngspiceSpelling(info.name)}) and makes a separate node${said.length ? '' : ', without a message'}: in one test the resistor on it carried no current.`, ...said, `[${facts.join(', ')}]`].join(' '),
      [fix(other ? `Connect to ${clean}` : `Rename ${t.text} to ${clean}`, ...changes)]);
  }
}

/** The model a part names: its 'model' field, or for Y (whose model is a word after the nodes) the first such word. */
function modelField(e: Element): Field | undefined {
  const f = e.fields.find((x) => x.role === 'model');
  if (f || e.letter !== 'Y') return f;
  return e.fields.find((x) => x.role === 'parameter');
}

const hasModel = (c: Ctx, e: Element): boolean => {
  const f = modelField(e);
  return f !== undefined && c.models.has(lowerAscii(f.token.text));
};

const commentFix = (c: Ctx, l: NetlistLine): Fix => {
  const at = l.span.from + (l.text.length - l.text.replace(/^[\s\ufeff]+/, '').length);
  return fix('Make the line a comment', change(at, at, '* '));
};

interface Confusable {
  title: string;
  why: string;
  ngspice: string;
  /** The line is fine: what the letter needs is there. */
  ok: (c: Ctx, e: Element) => boolean;
}

const needsModel = (what: string, message: string, claim: string): Omit<Confusable, 'title'> => ({
  why: `In SPICE, a line starting with this letter is a ${what}, and it needs a .model line that describes it.`,
  ngspice: `ngspice stops: '${message}'. [${claim}]`,
  ok: hasModel,
});

const CONFUSABLE: Partial<Record<ElementLetter, Confusable>> = {
  W: {
    title: 'W is a current-controlled switch, not a wire',
    why: 'In SPICE, a line starting with W is a switch controlled by the current in a voltage source, and it needs a .model line. For a wire, give both ends the same node name, or use a 0 V source, a wire that also measures its current.',
    ngspice: "ngspice stops: 'Unable to find definition of model'. [unknown-letter-8, unknown-letter-9]",
    ok: hasModel,
  },
  S: { title: 'S is a voltage-controlled switch: it needs a .model line', ...needsModel('voltage-controlled switch', 'Unable to find definition of model', 'unknown-letter-10') },
  T: {
    title: 'T is a transmission line, not a transformer',
    why: 'In SPICE, a line starting with T is a transmission line, which needs z0= and td=. A transformer is two inductors (L lines) coupled by a K line.',
    ngspice: "ngspice stops: 'transmission line z0 must be given'. [unknown-letter-11]",
    ok: (_c, e) => e.fields.some((f) => /^z[0o]$/i.test(f.token.text)),
  },
  U: { title: 'U is a uniform RC line: it needs a .model line', ...needsModel('uniform RC line', 'Unable to find definition of model', 'unknown-letter-13') },
  Y: { title: 'Y is a lossy transmission line: it needs a .model line', ...needsModel('lossy transmission line', 'model name is not found', 'unknown-letter-14') },
  Z: { title: 'Z is a MESFET: it needs a .model line', ...needsModel('MESFET (a kind of transistor)', 'Unable to find definition of model', 'unknown-letter-15') },
  P: {
    title: 'P is a set of coupled lines: it needs a .model line',
    ...needsModel('set of coupled transmission lines', 'model name is not found', 'unknown-letter-16'),
    ok: (c, e) => {
      const model = pLineModel(e);
      return model !== undefined && c.models.has(lowerAscii(model.text));
    },
  },
  K: {
    title: 'K couples two inductors',
    why: 'In SPICE, a line starting with K couples two inductors (L lines) into a transformer, for example K1 L1 L2 0.99. Its first two words after the name must be inductor names.',
    ngspice: "ngspice stops: 'coupling to non-existent inductor'. [unknown-letter-12]",
    ok: (c, e) => {
      const named = e.fields.filter((f) => f.role === 'other').slice(0, 2);
      return named.length === 2 && named.every((f) => {
        const k = c.byKey.get(lowerAscii(f.token.text));
        return k !== undefined && el(c, k).letter === 'L';
      });
    },
  },
};

function checkLetters(c: Ctx): void {
  for (const l of c.n.lines) {
    if (l.kind === 'invalid') {
      const body = l.text.replace(/^[\s\ufeff]+/, '');
      const ch = [...body][0] ?? '';
      if (ch === '@') {
        add(
          c,
          'unknown-letter',
          'error',
          { from: l.span.to - body.length, to: l.span.to - body.length + 1 },
          'SPICE stops reading at a line starting with @',
          'Everything after this line is lost, including the analysis and .end. To write a note, start the line with * instead.',
          l.index === 0
            ? "ngspice reads nothing at all, so nothing runs; PlainSpice's engine says 'there aren't any circuits loaded'. [unknown-letter-5]"
            : 'ngspice silently stops reading the netlist at this line. [unknown-letter-4]',
          [commentFix(c, l)],
        );
        continue;
      }
      const brace = ch === '{' || ch === "'";
      add(
        c,
        'unknown-letter',
        'error',
        { from: l.span.to - body.length, to: l.span.to - body.length + ch.length },
        `SPICE can't read a line starting with ${ch}`,
        `Every part line starts with a letter that says what the part is: R for a resistor, V for a voltage source, and so on. A line starting with ${ch} is not a part. To keep it as a note, start it with * to make it a comment.`,
        brace
          ? "ngspice stops with a fatal error: 'Closing \"}\" not found in line fragment'. [unknown-letter-3]"
          : "ngspice stops: 'unknown device type - error'. [unknown-letter-1, unknown-letter-2]",
        [commentFix(c, l)],
      );
      continue;
    }
    const e = l.element;
    if (!e?.letter) continue;
    if (e.letter === 'A' || e.letter === 'N') {
      const a = e.letter === 'A';
      c.broken.add(l.index);
      add(
        c,
        'unknown-letter',
        'error',
        e.name,
        a ? 'A lines (XSPICE) are not in PlainSpice' : 'N lines (Verilog-A) are not in PlainSpice',
        a
          ? "In ngspice, a line starting with A is an XSPICE code model (a digital gate or a building block such as a gain block). PlainSpice's engine leaves XSPICE out; first- and second-year circuits don't need it."
          : "In ngspice, a line starting with N is a device from a compiled Verilog-A model (OSDI). PlainSpice's engine leaves OSDI out; first- and second-year circuits don't need it.",
        `PlainSpice's engine stops: 'unknown device type - error'. Native ngspice 47 ${a ? 'runs A lines' : 'reads N lines with an OSDI model'}. [unknown-letter-6, unknown-letter-7]`,
      );
      continue;
    }
    const conf = CONFUSABLE[e.letter];
    if (!conf || conf.ok(c, e)) continue;
    c.broken.add(l.index);
    // ngspice names the word it took for the model when there is one (unknown-letter-17).
    const pModel = e.letter === 'P' ? pLineModel(e) : undefined;
    const ngspice = pModel ? `ngspice stops: 'Unable to find definition of model ${lowerAscii(pModel.text)}'. [unknown-letter-17]` : conf.ngspice;
    const fixes: Fix[] = [];
    if (e.letter === 'W' && e.fields.length === 3 && e.nodes.length === 2) {
      const name = freshName(c, `V${e.name.text}`);
      fixes.push(fix(`Use a 0 V source as the wire (${name})`, replace(e.name, name), change(e.nodes[1]!.token.to, e.nodes[1]!.token.to, ' 0')));
    }
    add(c, 'unknown-letter', 'error', e.name, conf.title, conf.why, ngspice, fixes);
  }
}

/**
 * The word ngspice reads as a P line's model (inp2p.c): it counts the words after the name, takes
 * n = (count - 2) / 2 lines, and reads n nodes, a ground, n nodes, a ground, then the model. With no
 * word left there, it says 'model name is not found' (unknown-letter-16); otherwise it looks for a
 * .model line of that name (unknown-letter-17).
 */
function pLineModel(e: Element): Token | undefined {
  const words: Token[] = [];
  for (const f of e.fields.slice(1)) {
    if ((f.role !== 'node' && f.role !== 'model') || /^(length|len)$/i.test(f.token.text)) break;
    words.push(f.token);
  }
  const n = Math.max(0, Math.trunc((words.length - 2) / 2));
  return words[2 * n + 2];
}

function checkModels(c: Ctx): void {
  const reported = new Set<string>();
  for (const i of c.n.elements) {
    const e = el(c, i);
    if (!e.letter) continue;
    const f = modelField(e);
    const key = f ? lowerAscii(f.token.text) : undefined;
    if (e.letter === 'X') {
      if (key && c.subckts.has(key)) continue;
      c.broken.add(i);
      add(c, 'missing-subcircuit', 'error', f?.token ?? e.name, `${nameOf(e)} needs a .subckt definition`,
        `A line starting with X uses a subcircuit, defined between .subckt ${f?.token.text ?? 'name'} ... and .ends. This netlist has no such definition.`,
        `ngspice stops: 'unknown subckt'. [missing-subcircuit-1]`);
      continue;
    }
    if ('DQJM'.includes(e.letter)) {
      if (key && c.models.has(key)) {
        modelNotInEngine(c, i, f!, c.models.get(key)!, reported);
        continue;
      }
      c.broken.add(i);
      const what = { D: 'diode', Q: 'bipolar transistor (BJT)', J: 'JFET', M: 'MOSFET' }[e.letter as 'D'];
      const message = e.letter === 'J' ? 'Unable to find definition of model' : 'could not find a valid modelname';
      const fixes: Fix[] = [];
      // A number where the model name goes ("D1 a 0 5") is no model name: .model 5 D would not work.
      const numeric = f !== undefined && readNumber(f.token.text) !== undefined;
      if (e.letter === 'D' && e.nodes.length >= 2) {
        const model = f && !numeric ? f.token.text : c.models.has('dmod') ? undefined : 'dmod';
        if (model) {
          const changes = [insertLineAfter(c, i, `.model ${model} D`)];
          if (!f) changes.push(change(e.nodes[1]!.token.to, e.nodes[1]!.token.to, ` ${model}`));
          else if (numeric) changes.push(replace(f.token, model));
          fixes.push(fix(numeric ? `Use a standard diode model: ${model}` : `Add .model ${model} D (a standard diode)`, ...changes));
        }
      }
      add(c, 'missing-model', 'error', f?.token ?? e.name, `${nameOf(e)} needs a .model line`,
        f && numeric
          ? `A ${what} has no value: its behaviour comes from a .model line, which the part line names after the nodes, for example D1 anode cathode dmod with .model dmod D. Here that place holds the number ${f.token.text}.`
          : f
          ? `The behaviour of a ${what} comes from a .model line, which the part line names (here ${f.token.text}). This netlist has no .model ${f.token.text}.`
          : `The behaviour of a ${what} comes from a .model line, and the part line names it after the nodes, for example D1 anode cathode dmod with .model dmod D.`,
        `ngspice stops: '${message}'. [missing-model-1, missing-model-2, missing-model-4, missing-model-5, missing-model-6]`, fixes);
      continue;
    }
    if (f && key && c.models.has(key)) modelNotInEngine(c, i, f, c.models.get(key)!, reported);
    if (e.letter === 'O') {
      c.broken.add(i);
      add(c, 'model-not-in-engine', 'error', e.name, 'O lines (lossy lines, LTRA) are not in PlainSpice',
        "A line starting with O is a lossy transmission line (LTRA). PlainSpice's engine leaves LTRA out (its code has no licence that allows it); first- and second-year circuits don't need it.",
        "PlainSpice's engine stops: 'Device type LossyXmissionLine not supported by this binary'. Native ngspice 47 runs it. [model-not-in-engine-5]");
    }
  }
}

/** Models PlainSpice's engine leaves out (engine/build.sh, REMOVED_MODELS), by .model type and level (inpdomod.c). */
function leftOut(card: ModelCard): string | undefined {
  const mos: Record<number, string> = {
    4: 'BSIM1', 5: 'BSIM2', 8: 'BSIM3', 49: 'BSIM3', 14: 'BSIM4', 54: 'BSIM4', 10: 'BSIM-SOI', 58: 'BSIM-SOI',
    55: 'BSIM3-SOI', 56: 'BSIM3-SOI', 57: 'BSIM3-SOI', 60: 'SOI3', 68: 'HiSIM2', 73: 'HiSIM_HV',
  };
  if (['nmos', 'pmos', 'nsoi', 'psoi'].includes(card.type)) return mos[card.level];
  if ((card.type === 'npn' || card.type === 'pnp') && card.level === 8) return 'HICUM2';
  if ((card.type === 'njf' || card.type === 'pjf') && card.level === 2) return 'JFET2';
  if (card.type === 'ltra') return 'LTRA';
  return undefined;
}

function modelNotInEngine(c: Ctx, i: number, f: Field, card: ModelCard, reported: Set<string>): void {
  const model = leftOut(card);
  if (!model || el(c, i).letter === 'O') return;
  c.broken.add(i);
  if (reported.has(lowerAscii(card.name))) return;
  reported.add(lowerAscii(card.name));
  const message =
    card.type === 'npn' || card.type === 'pnp'
      ? "'Unable to find definition of given model'"
      : card.type === 'njf' || card.type === 'pjf'
        ? `'Unknown device type for model ${lowerAscii(card.name)}'`
        : "'could not find a valid modelname'";
  const level = card.type === 'ltra' ? 'The LTRA type' : `level=${card.level}`;
  add(
    c,
    'model-not-in-engine',
    'error',
    f.token,
    `PlainSpice's engine has no ${model} model`,
    `${level} in .model ${card.name} selects ${model}, a ${model === 'JFET2' ? 'detailed JFET model' : 'model for chip design'}. PlainSpice's engine leaves it out (${model === 'JFET2' ? 'its code comes without a licence that allows it' : "its licence terms differ from ngspice's"}), and first- and second-year circuits don't need it${['nmos', 'pmos'].includes(card.type) ? ': level=1 is the classic MOSFET model' : ''}.`,
    `Native ngspice 47 runs it; PlainSpice's engine stops: ${message}. [model-not-in-engine-1, model-not-in-engine-2, model-not-in-engine-3, model-not-in-engine-4]`,
  );
}

// ------------------------------------------------------------------ analysis lines

const num = (t: Token | undefined): number | undefined => (t ? readNumber(t.text)?.value : undefined);
const sweepable = (e: Element | undefined): boolean => e?.letter === 'V' || e?.letter === 'I' || e?.letter === 'R';

function independentSources(c: Ctx): Element[] {
  return c.top.map((k) => el(c, k)).filter((e) => e.letter === 'V' || e.letter === 'I');
}

/**
 * A .dc line read by place, as ngspice 47 reads it (inp2dot.c, dot_dc): a name, then the start, the stop
 * and the step; then, when anything follows, a second sweep read the same way; anything after that is
 * ignored (dc-sweep-problems-19). ngspice 47 stops ('Bad syntax!') when the line ends before a sweep has
 * its three numbers, or when a step is 0; a word that is no number reads as 0 there and is never taken
 * up, so that stops it too (dc-sweep-problems-1, -2, -9 to -13, -18). A word in braces or quotes is a
 * number numparam works out first (dc-sweep-problems-17). A number where the second sweep's name goes is
 * one number too many (CR1-6); a name with a character that is not what it looks like is said so (CR1-12);
 * "Sweep V1 instead" is never offered for a source the line already sweeps. Where the step goes, a part's
 * name or temp starts the next sweep: the step is missing. A word a character check explains is read as
 * ngspice reads it, and a conclusion its reading decides is that check's (readAround; re-check critic
 * CR2-1): the line's other problems are still said here. Where ngspice 47 stops reading the line, a missing
 * source is said as each version meets it (dc-sweep-problems-25), and nothing is said of points it never
 * computes. In two sweeps a sweep the wrong way is no empty result: it never moves (dc-sweep-problems-20 to
 * -24; CR2-4).
 */
function checkDc(c: Ctx, d: Directive): void {
  const args = d.args;
  const around = readAround(c, d);
  if (around.skip) return;
  // What ngspice 47 does with the line as it reads it: 'Bad syntax!' (BAD), a missing source (NOTFOUND), or a run.
  const outcome = lineOutcome(c, d, args.map(readingOf));
  const unread = outcome.startsWith('BAD');
  const runs = !unread && !outcome.startsWith('NOTFOUND');
  const sweepName = (t: Token): boolean => lowerAscii(t.text) === 'temp' || c.byKey.has(lowerAscii(t.text));
  // A word in braces or quotes is worked out by numparam before ngspice reads the line (dc-sweep-problems-17).
  const expression = (t: Token): boolean => /^[{']/.test(t.text);
  const isNumber = (t: Token): boolean => !expression(t) && readNumber(t.text) !== undefined;
  const sources = independentSources(c);
  // The sources the line sweeps already: "Sweep V1 instead" must not make it sweep V1 twice.
  const named = new Set(args.filter((t, k) => k === 0 || (k === 4 && !isNumber(t))).map((t) => lowerAscii(t.text)));
  const instead = sources.length === 1 && !named.has(sources[0]!.key) ? sources[0] : undefined;
  const two = args.length > 4;
  const missing = [0, 4].some((j) => args[j] !== undefined && (j === 0 || two) && lowerAscii(args[j]!.text) !== 'temp' && !sweepable(c.byKey.has(lowerAscii(args[j]!.text)) ? el(c, c.byKey.get(lowerAscii(args[j]!.text))!) : undefined));
  let k = 0;
  for (let sweep = 0; sweep < 2 && k < args.length; sweep++) {
    const src = args[k]!;
    if (sweep === 1 && isNumber(src)) {
      // A number where the second sweep's name goes (.dc V1 0 5 1 2): one number too many. ngspice 47
      // takes it for a name, and stops at the line unless three more words follow; 42 looks for the part.
      let last = k;
      while (last + 1 < args.length && isNumber(args[last + 1]!)) last += 1;
      const extra = args.slice(k, last + 1);
      const words = extra.map((t) => shownWord(t.text)).join(' ');
      const whole = args.length >= k + 4;
      add(c, 'dc-sweep-problems', 'error', { from: src.from, to: args[last]!.to }, `${extra.length === 1 ? 'One number' : `${extra.length} numbers`} too many on this .dc line`,
        `.dc ${args.slice(0, 4).map((t) => shownWord(t.text)).join(' ')} is a whole sweep: the source, the start, the stop and the step. SPICE takes the next word, ${shownWord(src.text)}, for the name of a second source to sweep, and there is no part called ${shownWord(src.text)}.`,
        whole
          ? `ngspice stops when the sweep starts: 'Voltage source, current source, or resistor named "${ngspiceSpelling(src.text)}" is not in the circuit'. [dc-sweep-problems-14]`
          : `ngspice 47 stops: 'Bad syntax!'. ngspice 42 takes ${shownWord(src.text)} for the name of a second source to sweep, and stops: 'Voltage source, current source, or resistor named "${ngspiceSpelling(src.text)}" is not in the circuit'. [dc-sweep-problems-13]`,
        [fix(`Delete ${words}`, change(args[k - 1]!.to, args[last]!.to, ''))]);
      return;
    }
    const nums: Token[] = [];
    let j = k + 1;
    for (; j < args.length && nums.length < 3; j++) {
      if (nums.length === 2 && !isNumber(args[j]!) && !expression(args[j]!) && sweepName(args[j]!)) break;
      nums.push(args[j]!);
    }
    k = j;
    const name = shownWord(src.text);
    const bad = nums.findIndex((t) => !expression(t) && readNumber(t.text) === undefined);
    if (bad >= 0) {
      const t = nums[bad]!;
      // A word a character check explains: that check says what ngspice does with it there.
      if (c.meant.has(t.from)) return;
      const place = ['start', 'stop', 'step'][bad]!;
      // The letter O typed for the digit 0 (.dc V1 O 5 1): say so, and write the zero; never a step of 0 (re-check C4, CR1-8).
      const zero = bad === 2 ? undefined : /^[Oo]$/.test(cleanWord(t.text, true).clean) ? '0' : zeroForLetterO(t.text);
      const letterO = zero !== undefined || /^[Oo]$/.test(cleanWord(t.text, true).clean);
      // A name from a .param line is that number only in braces (dc-sweep-problems-17, -18).
      const param = c.topParams.has(lowerAscii(t.text)) && KEYWORD.test(t.text);
      add(c, 'dc-sweep-problems', 'error', t, `The ${place} of this sweep is not a number`,
        `.dc ${name} needs three numbers after the name: the start, the stop and the step, for example .dc ${name} 0 5 1. Here ${shownWord(t.text)} stands where the ${place} goes${!letterO ? '' : bad === 2 ? ': a letter O, not a number, and the digit 0 would not do either: a step of 0 never moves away from the start' : ', with a letter O where the digit 0 belongs'}.${param ? ` To use the value ${t.text} has on its .param line, write it in braces: {${t.text}}.` : ''}`,
        `ngspice 47 stops: 'Bad syntax!'. [dc-sweep-problems-9, dc-sweep-problems-10${param ? ', dc-sweep-problems-18' : ''}]`,
        zero !== undefined ? [fix(`Write ${zero}`, replace(t, zero))] : param ? [fix(`Write {${t.text}}`, replace(t, `{${t.text}}`))] : []);
      return;
    }
    if (nums.length < 2) {
      // The line ends before the stop (.dc V1, .dc V1 0, a second sweep's name alone): ngspice 47 stops, 42 never finishes.
      add(c, 'dc-sweep-problems', 'error', { from: src.from, to: (nums[nums.length - 1] ?? src).to }, `.dc needs a start, a stop and a step for ${name}`,
        `.dc sweeps a source from a start to a stop in steps, three numbers after its name: .dc ${name} 0 5 1 sweeps it from 0 to 5 in steps of 1. Here ${name} has ${nums.length === 0 ? 'no number after it' : `only ${shownWord(nums[0]!.text)} after it`}.`,
        `ngspice 47 stops: 'Bad syntax!'. ngspice 42 never finishes. [${sweep === 0 ? 'dc-sweep-problems-11' : 'dc-sweep-problems-12'}]`);
      return;
    }
    const key = lowerAscii(src.text);
    if (key !== 'temp') {
      const target = c.byKey.get(key);
      const targetEl = target === undefined ? undefined : el(c, target);
      const meant = withoutInvisible(cleanWord(src.text).clean);
      const odd = !targetEl && meant !== src.text && c.byKey.has(lowerAscii(meant)) ? cleanWord(src.text).odd[0] : undefined;
      // ngspice 47 stops reading a line it cannot read before the run, where a missing source is met; 42 meets it (dc-sweep-problems-25).
      const stops = (message: string, claims: string): string => (unread
        ? `ngspice 47 stops reading the line first ('Bad syntax!'). ngspice 42 stops when the sweep starts: '${message}'. [${claims}, dc-sweep-problems-25]`
        : `ngspice stops when the sweep starts: '${message}'. [${claims}]`);
      if (odd !== undefined) {
        // A character that is not what it looks like in the name (<zero-width space>V1, V１): ngspice keeps it,
        // so the name is no part's (dc-sweep-problems-15, -16; re-check critic CR1-12). Named, never shown.
        const what = describeCharacter(odd);
        add(c, 'dc-sweep-problems', 'error', src, INVISIBLE.test(odd) ? `${capital(what)} hides in the name ${meant}` : `The name ${meant} is written with ${what.replace(/, which .*$/, '')}`,
          INVISIBLE.test(odd)
            ? `It is a character you cannot see (it often comes with text copied from a web page or a PDF), and SPICE keeps it in the name, so .dc names no part of the circuit: not ${meant}.`
            : `It looks like ${lookAlikeOf(odd)}, but SPICE knows only the plain ${/\d/.test(lookAlikeOf(odd) ?? '') ? 'digit' : 'letter'} ${lookAlikeOf(odd)}, so .dc names no part of the circuit: not ${meant}.`,
          stops(`Voltage source, current source, or resistor named "${ngspiceSpelling(src.text)}" is not in the circuit`, INVISIBLE.test(odd) ? 'dc-sweep-problems-15' : 'dc-sweep-problems-16'),
          [fix(INVISIBLE.test(odd) ? `Take it out: sweep ${meant}` : `Write ${meant}`, replace(src, meant))]);
      } else if (!sweepable(targetEl)) {
        add(c, 'dc-sweep-problems', 'error', src, targetEl ? `.dc can't sweep ${name}` : `.dc sweeps ${name}, which is not in the circuit`,
          `.dc sweeps a voltage source, a current source, a resistor, or the temperature (temp), named first on its line. ${targetEl ? `${nameOf(targetEl)} is none of these.` : `There is no part called ${name}.`}`,
          stops(`Voltage source, current source, or resistor named "${ngspiceSpelling(src.text)}" is not in the circuit`, 'dc-sweep-problems-6, dc-sweep-problems-7'),
          instead ? [fix(`Sweep ${nameOf(instead)} instead`, replace(src, nameOf(instead)))] : []);
      }
    }
    const [t0, t1, t2] = nums;
    // A conclusion from a number whose reading a character check says is that check's.
    if (around.mine(t0) || around.mine(t1) || around.mine(t2)) return;
    const value = (t: Token | undefined): number | undefined => (t && !expression(t) ? readNumber(t.text)?.value : undefined);
    const start = value(t0);
    const stop = value(t1);
    if (start === undefined || stop === undefined || !t1) continue;
    const [m0, m1, m2] = [t0, t1, t2].map((t) => (t ? around.meant(t) : undefined));
    const [w0, w1, w2] = [m0, m1, m2].map((m) => (m ? shownWord(m.text) : '<step>'));
    const intro = `.dc ${name} ${w0} ${w1} ${w2} means: sweep ${name} from ${w0} to ${w1} in steps of ${w2}.`;
    const tenth = ((m1!.value ?? stop) - (m0!.value ?? start)) / 10;
    const tenthText = formatSpiceNumber(tenth);
    // With a source missing, ngspice 42 stops there instead of sweeping for ever (dc-sweep-problems-25).
    const hangs = missing
      ? "ngspice 47 stops: 'Bad syntax!'. ngspice 42 stops at the missing source instead. [dc-sweep-problems-1, dc-sweep-problems-25]"
      : "ngspice 47 stops: 'Bad syntax!'. ngspice 42 never finishes: it keeps sweeping the first point. [dc-sweep-problems-1, dc-sweep-problems-2]";
    if (!t2) {
      add(c, 'dc-sweep-problems', 'error', { from: src.from, to: t1.to }, '.dc needs a step',
        `.dc needs four things: the source to sweep, the start, the stop and the step. For example .dc ${name} ${w0} ${w1} ${tenth !== 0 ? tenthText : '1'}.`,
        hangs, tenth !== 0 ? [fix(`Add a step of ${tenthText} (10 steps)`, change(t1.to, t1.to, ` ${tenthText}`))] : []);
      continue;
    }
    const step = value(t2);
    if (step === undefined) continue;
    if (step === 0) {
      add(c, 'dc-sweep-problems', 'error', t2, 'A step of 0 never reaches the stop',
        `${intro} A step of 0 never moves away from the start.`, hangs,
        tenth !== 0 ? [fix(`Use a step of ${tenthText} (10 steps)`, replace(t2, tenthText))] : []);
      continue;
    }
    // The points: only on a line ngspice runs (not one it stops at, for 'Bad syntax!' or a missing source).
    if (!runs) continue;
    const wrong = (step > 0 && start > stop) || (step < 0 && start < stop);
    const back = formatSpiceNumber(-(m2!.value ?? step));
    const swap = [fix(`Swap them: from ${w1} to ${w0}`, replace(t0!, m1!.text), replace(t1, m0!.text)),
      fix(`Go down: make the step ${back}`, replace(t2, back))];
    // In two sweeps (dc-sweep-problems-20 to -24): a sweep the wrong way never moves, both make no points.
    const other = two ? shownWord(args[sweep === 0 ? 4 : 0]!.text) : '';
    const firstName = shownWord(args[0]!.text);
    const startOf = (s: number): string => shownWord(around.meant(args[4 * s + 1]!).text);
    const empty = !two || outcome === 'NOPOINTS';
    const stuck = sweep === 1
      ? `ngspice computes the sweep of ${firstName} once, with ${name} at its start, ${startOf(1)}, and says nothing. [dc-sweep-problems-20]`
      : `ngspice keeps ${name} at its start, ${startOf(0)}, takes ${other} from its second value on, and says nothing. [dc-sweep-problems-21]`;
    if (wrong && step > 0) {
      add(c, 'dc-sweep-problems', empty ? 'error' : 'warning', { from: t0!.from, to: t2.to }, empty ? 'This sweep has no points: start is above stop' : 'This sweep never moves: start is above stop',
        `${intro} Going up in steps of ${w2} from ${w0} never gets down to ${w1}. Swap the two ends, or use a negative step to sweep downwards.`,
        empty ? `ngspice runs no sweep points and says nothing: the results are empty. [${two ? 'dc-sweep-problems-22' : 'dc-sweep-problems-4'}]` : stuck,
        swap);
    } else if (wrong) {
      add(c, 'dc-sweep-problems', empty ? 'error' : 'warning', t2, empty ? 'This sweep has no points: the step goes the wrong way' : 'This sweep never moves: the step goes the wrong way',
        `${intro} Going down in steps of ${w2} from ${w0} never gets up to ${w1}.`,
        empty ? `ngspice runs no sweep points and says nothing: the results are empty. [${two ? 'dc-sweep-problems-22' : 'dc-sweep-problems-3'}]` : stuck,
        [fix(`Make the step ${back}`, replace(t2, back))]);
    } else if (start !== stop && Math.abs(step) > Math.abs(stop - start)) {
      add(c, 'dc-sweep-problems', 'warning', t2, 'The step is bigger than the whole sweep',
        `${intro} One step jumps past ${w1}, so the sweep has only its first point.`,
        !two
          ? `ngspice computes only the first point (${name} = ${w0}) and says nothing. [dc-sweep-problems-5]`
          : sweep === 1
            ? `ngspice computes the sweep of ${firstName} once, with ${name} at ${w0}, and says nothing. [dc-sweep-problems-23]`
            : `ngspice computes ${name} = ${w0} only, at each value of ${other}, and says nothing. [dc-sweep-problems-24]`,
        [fix(`Use a step of ${tenthText} (10 steps)`, replace(t2, tenthText))]);
    }
  }
}

/**
 * How the plain checks of an analysis line (checkTran, checkDc) treat the words a character check explains
 * (re-check critic CR2-1): `skip` when a word glued by a character that looks like a space may be two words,
 * so the line's words are not known; else `mine`, the words whose character check says what ngspice does with
 * the line, or whose reading changes it (lineOutcome): a conclusion that uses one is left to that check, and
 * ngspice stops there. The other words are read as ngspice reads them, and a conclusion from them is the same with the
 * number meant, so it stands beside the character check (`.tran 0 2<zero-width space>m`: the step of 0).
 * `meant` gives the number meant and its spelling, for fixes, so none writes a character back.
 */
function readAround(c: Ctx, d: Directive): { skip: boolean; mine: (t: Token | undefined) => boolean; meant: (t: Token) => { value: number | undefined; text: string } } {
  const base = d.args.map(readingOf);
  const outcome = lineOutcome(c, d, base);
  const mine = new Set<number>();
  let skip = false;
  d.args.forEach((t, j) => {
    const m = c.meant.get(t.from);
    if (m === 'split') skip = true;
    else if (m) {
      const read = base[j];
      const said = analysisPlace(c, d, j)?.verdict(typeof read === 'number' ? read : undefined, m.value, ngspiceSpelling(t.text)).kind === 'own';
      if (said || lineOutcome(c, d, base.map((x, q) => (q === j ? m.value : x))) !== outcome) mine.add(t.from);
    }
  });
  return {
    skip,
    mine: (t) => t !== undefined && mine.has(t.from),
    meant: (t) => {
      const m = c.meant.get(t.from);
      return m && m !== 'split' ? m : { value: num(t), text: t.text };
    },
  };
}

/**
 * The numbers of a .tran line as ngspice reads them: the step, the stop time, the start time, each checked in
 * that order, as ngspice stops at the first problem (tranOutcome). A word a character check explains is read
 * as ngspice reads it; a conclusion its reading decides is that check's, which says what ngspice does there
 * (re-check critic CR2-1), and the line's other problems are still said here: `.tran 0 2<zero-width space>m`
 * has a step of 0. Words are shown as meant, and fixes write the number meant, never a character back.
 */
function checkTran(c: Ctx, d: Directive): void {
  const around = readAround(c, d);
  if (around.skip) return;
  const args = d.args.filter((t) => lowerAscii(t.text) !== 'uic');
  const [a0, a1, a2] = args;
  if (!a0) {
    add(c, 'tran-problems', 'error', d.token, '.tran needs a step and a stop time',
      '.tran needs at least two numbers: the step and the stop time, for example .tran 10u 5m (steps of 10 \u00b5s up to 5 ms).',
      "ngspice stops: 'TSTEP is invalid, must be greater than zero.' [tran-problems-6]");
    return;
  }
  const tstep = num(a0);
  if (tstep === undefined) return;
  const [m0, m1, m2] = [a0, a1, a2].map((t) => (t ? around.meant(t) : undefined));
  const [w0, w1, w2] = [m0, m1, m2].map((m) => (m ? shownWord(m.text) : ''));
  if (!a1) {
    const meant = m0!.value ?? tstep;
    const step = formatSpiceNumber(meant / 100);
    add(c, 'tran-problems', 'error', a0, '.tran needs a stop time',
      `.tran needs at least two numbers: the step and the stop time, for example .tran ${step} ${w0}. With one number, SPICE takes it as the step and finds no stop time.`,
      "ngspice stops: 'TSTOP is invalid, must be greater than zero.' [tran-problems-1]",
      meant > 0 ? [fix(`Use ${w0} as the stop time: .tran ${step} ${w0}`, m0!.text === a0.text ? change(a0.from, a0.from, `${step} `) : replace(a0, `${step} ${m0!.text}`))] : []);
    return;
  }
  // ngspice reads the step first, whatever the stop time is (inp2dot.c).
  if (tstep <= 0) {
    if (around.mine(a0)) return;
    const stopMeant = m1!.value;
    const step = stopMeant === undefined ? '' : formatSpiceNumber(stopMeant / 100);
    add(c, 'tran-problems', 'error', a0, `The step of .tran must be more than 0`,
      `.tran ${w0} ${w1} means: steps of ${w0} up to ${w1}. The step has to be a positive time.`,
      "ngspice stops: 'TSTEP is invalid, must be greater than zero.' [tran-problems-2, tran-problems-7]",
      stopMeant !== undefined && stopMeant > 0 ? [fix(`Use a step of ${step}`, replace(a0, step))] : []);
    return;
  }
  const tstop = num(a1);
  if (tstop === undefined) return;
  if (tstop <= 0) {
    if (around.mine(a1)) return;
    // ngspice reads the step first, then the stop time (inp2dot.c): a stop of 0 or less stops it (tran-problems-8).
    const stopMeant = m1!.value ?? tstop;
    add(c, 'tran-problems', 'error', a1, 'The stop time of .tran must be more than 0',
      `.tran ${w0} ${w1} means: steps of ${w0} up to ${w1}. The stop time has to be a positive time, the length of the run.`,
      "ngspice stops: 'TSTOP is invalid, must be greater than zero.' [tran-problems-8]",
      stopMeant < 0 ? [fix(`Make it ${formatSpiceNumber(-stopMeant)}`, replace(a1, formatSpiceNumber(-stopMeant)))] : []);
    return;
  }
  const tstart = num(a2);
  if (a2 && tstart !== undefined && tstart >= tstop) {
    if (around.mine(a1) || around.mine(a2)) return;
    add(c, 'tran-problems', 'error', a2, 'The start time is not before the stop time',
      `The third number of .tran is the time to start saving results (${w2}); it must be less than the stop time (${w1}).`,
      "ngspice stops: 'TSTART is invalid, must be less than TSTOP.' [tran-problems-4, tran-problems-5]",
      [fix(`Remove the start time ${w2}`, change(a1.to, a2.to, ''))]);
    return;
  }
  if (tstep > tstop) {
    if (around.mine(a0) || around.mine(a1)) return;
    const step = formatSpiceNumber((m1!.value ?? tstop) / 100);
    add(c, 'tran-problems', 'info', a0, 'The step is longer than the whole run',
      `.tran ${w0} ${w1} means: steps of ${w0} up to ${w1}. A step longer than the whole run is probably a slip.`,
      'ngspice runs and says nothing; it chooses its own time steps (in one test, 59 points for .tran 1 5m), so the curve still looks fine. [tran-problems-3]',
      [fix(`Use a step of ${step} (a hundredth of ${w1})`, replace(a0, step))]);
  }
}

function checkTf(c: Ctx, d: NonNullable<NetlistLine['directive']>, line: NetlistLine): void {
  const args = d.args;
  const kind = args[0] ? lowerAscii(args[0].text) : '';
  if (kind !== 'v' && kind !== 'i') return;
  const outputs: Token[] = [];
  let k = 1;
  if (args[1]) outputs.push(args[1]);
  if (kind === 'v' && args[1] && args[2] && c.text.slice(args[1].to, args[2].from).includes(',')) {
    outputs.push(args[2]);
    k = 3;
  } else k = 2;
  const src = args[k];
  // The circuit's nodes and parts, with those of the parts written after a plain .end, which ngspice
  // reads (S25): a .tf after .end (A3c) may name them.
  const late = afterEndParts(c.n);
  const connected = (key: string): boolean => (c.n.nodes.get(key)?.connections.length ?? 0) > 0 || late.some((e) => e.nodes.some((r) => r.name === key));
  const partOf = (key: string): Element | undefined => {
    const at = c.byKey.get(key);
    return at !== undefined ? el(c, at) : late.find((e) => e.key === key);
  };
  // A node is offered as first written when it has a character outside ASCII ("Use ÇIKIŞ", never the
  // key's "Use ÇikiŞ": S7, decision 0016), a name like ground quoted and such a character named. Never an
  // ordinary node called gnd: written in v( ), gnd is ground (A3b). Never a node whose name has a
  // character that is not what it looks like: the button would write it into the .tf (critic of the
  // fix, round 2); the character's own check takes it out of the part lines.
  const nodeCandidates = (t: Token): Fix[] =>
    [...c.n.nodes.values()]
      .filter((y) => y.connections.length > 0 && y.name !== 'gnd' && !oddNode(y) && looksLikeTypo(lowerAscii(t.text), y.name))
      .slice(0, 2)
      .map((y) => fix(`Use ${nodeWords(c, y.name)}`, replace(t, writtenNode(c, y.name))));
  if (kind === 'v') {
    outputs.forEach((t, idx) => {
      const name = lowerAscii(t.text);
      if (name === GROUND || name === 'gnd' || connected(name)) return;
      // S11: a name that is a node of the circuit but for characters that are not what they look like
      // (invisible ones, ones that look like a space, letters from another alphabet; one kind or more:
      // о<zero-width space>ut is out, critic of the fix, round 2) is another node with nothing on it, so
      // ngspice's .tf numbers mean nothing, as for any such node (tf-problems-8): an error, in words
      // that name the characters, never "There is no node called out" nor "Use out".
      const forms = plainForms(t.text);
      const near = forms.find((x) => x !== GROUND && connected(lowerAscii(x)));
      if (near !== undefined) {
        oddTfNode(c, t, near, idx);
        return;
      }
      // Ground but for such a character: 0, or gnd, which v( ) reads as ground (A3b).
      const ground = forms.find((x) => x === GROUND || lowerAscii(x) === 'gnd');
      if (ground !== undefined) {
        oddTfNode(c, t, ground, idx, true);
        return;
      }
      // Its mirror: the parts' node has such a character and the .tf writes the name plainly (critic of
      // the fix, round 2: "There is no node called out", with a button that wrote a third hidden
      // character into the .tf). Said so, and left to the character's own check on the part lines.
      const plain = lowerAscii(plainForms(t.text).at(-1) ?? t.text);
      const mirror = [...c.n.nodes.values()].find((y) => y.connections.length > 0 && oddNode(y) && lowerAscii(plainForms(y.refs[0]!.text).at(-1)!) === plain);
      if (mirror) {
        mirrorTfNode(c, t, mirror, idx);
        return;
      }
      // Otherwise such a character is named, never shown hidden in the name (decision 0012); a name like
      // ground is quoted, and a name that says node goes alone ("node5", never "node node5"), as Explain
      // says them on the same line (words re-check 3 and 4, decision 0017).
      const named = tfNamed(t.text);
      add(c, 'tf-problems', 'error', t, `.tf asks about ${nameSaysNode(named) ? named : `node ${named}`}, which is not in the circuit`,
        `There is no node called ${named}: no part connects to it. .tf v(${withoutInvisible(t.text)}) needs a node of the circuit.`,
        idx === 0
          ? 'ngspice says nothing: it makes a new node with nothing connected, as if 1 Ω went from it to ground. The transfer function comes out 0 and the output impedance 1 Ω. [tf-problems-1]'
          : 'ngspice says nothing: it makes a new node with nothing connected, as if 1 Ω went from it to ground, which adds 1 Ω to the output impedance. [tf-problems-2]',
        nodeCandidates(t));
    });
  } else if (outputs[0]) {
    const t = outputs[0];
    const target = partOf(lowerAscii(t.text));
    if (target === undefined || target.letter !== 'V') {
      // A voltage source but for a character that is not what it looks like (critic of the fix, round 2).
      const near = target === undefined ? plainForms(t.text).map((x) => partOf(lowerAscii(x))).find((e) => e?.letter === 'V') : undefined;
      if (near) oddTfPart(c, t, near, 'output');
      else {
        add(c, 'tf-problems', 'error', t, `i(${withoutInvisible(t.text)}) needs a voltage source`,
          `i( ) in .tf reads the current through a voltage source${target === undefined ? `, and there is no part called ${nodeNameInWords(t.text)}` : `; ${t.text} is not one`}. To measure a current, put a 0 V source in that branch (the ammeter trick) and write i( ) with its name.`,
          'ngspice says nothing and gives a transfer function of 0 and an output impedance of 1e20 Ω. [tf-problems-5, tf-problems-7]');
      }
    }
  }
  const sources = independentSources(c);
  const useOnly = (t: Token): Fix[] => (sources.length === 1 ? [fix(`Use ${nameOf(sources[0]!)}`, replace(t, nameOf(sources[0]!)))] : []);
  if (!src) {
    const last = args[args.length - 1] ?? d.token;
    add(c, 'tf-problems', 'error', { from: d.token.from, to: line.span.to > last.to ? last.to + (c.text[last.to] === ')' ? 1 : 0) : last.to }, '.tf needs an input source',
      '.tf needs the output and the input source, for example .tf v(out) V1: how v(out) changes per volt of V1.',
      "ngspice stops: 'Transfer function source  not in circuit'. [tf-problems-6]",
      sources.length === 1 ? [fix(`Use ${nameOf(sources[0]!)} as the input`, change(last.to + (c.text[last.to] === ')' ? 1 : 0), last.to + (c.text[last.to] === ')' ? 1 : 0), ` ${nameOf(sources[0]!)}`))] : []);
    return;
  }
  const targetEl = partOf(lowerAscii(src.text));
  if (!targetEl) {
    // A source but for a character that is not what it looks like: named, never shown (critic of the fix, round 2).
    const near = plainForms(src.text).map((x) => partOf(lowerAscii(x))).find((e) => e?.letter === 'V' || e?.letter === 'I');
    if (near) oddTfPart(c, src, near, 'input');
    else {
      const named = nodeNameInWords(src.text);
      add(c, 'tf-problems', 'error', src, `.tf's input ${named} is not in the circuit`,
        `The last word of .tf names the input source. There is no part called ${named}.`,
        `ngspice stops: 'Transfer function source ${ngspiceSpelling(src.text)} not in circuit'. [tf-problems-3]`, useOnly(src));
    }
  } else if (targetEl.letter !== 'V' && targetEl.letter !== 'I') {
    add(c, 'tf-problems', 'error', src, `.tf's input must be a source, not ${src.text}`,
      `The input of .tf must be an independent source: a voltage source (V) or a current source (I). ${nameOf(targetEl)} is not.`,
      `ngspice stops: 'Transfer function source ${ngspiceSpelling(src.text)} not of proper type'. [tf-problems-4]`, useOnly(src));
  }
}

/** A .tf node's name in a check's words: a name like ground quoted (W13), a character that is not what it looks like named (S11). */
const tfNamed = (text: string): string => (/^(gnd|ground|00)$/i.test(text) ? `"${text}"` : nodeNameInWords(text));

/** "the node out", 'the node "ground"', and a name that says node alone: "node1" (words re-check 3 and 4, critic of the fix, round 2). */
function theNode(text: string): string {
  const named = tfNamed(text);
  return nameSaysNode(named) ? named : `the node ${named}`;
}

/**
 * A node of the circuit whose name has a character that is not what it looks like: an invisible one,
 * one that looks like a space, or a letter from another alphabet in a Latin word. Its own check names
 * it on the part lines (invisible-character, space-character, look-alike-letter), and its fix joins it
 * to the node it looks like, so no other check offers it.
 */
function oddNode(y: NodeInfo): boolean {
  return !y.ground && y.refs.length > 0 && (hasInvisible(y.name) || hasSpaceLike(y.name) || lookAlikeName(y.refs[0]!.text) !== undefined);
}

const afterEndCache = new WeakMap<Netlist, Element[]>();

/** The parts written after a plain .end, which ngspice reads (S25, after-end-1), each line read on its own. */
function afterEndParts(n: Netlist): Element[] {
  let parts = afterEndCache.get(n);
  if (!parts) {
    parts = readAfterEnd(n).flatMap((l) => {
      const e = parseNetlist(`*\n${l.text}`).lines[1]?.element;
      return e ? [e] : [];
    });
    afterEndCache.set(n, parts);
  }
  return parts;
}

/** A character in a title: "a zero-width space (U+200B)", "the Cyrillic letter о". */
const characterWhat = (ch: string): string => nameOfCharacter(ch) ?? describeCharacter(ch).replace(/, which looks like .*$/, '');

/** Why such a character makes another name, for a name with several of them. */
function characterWhy(ch: string): string {
  if (INVISIBLE.test(ch)) return `${nameOfCharacter(ch, false)!} is a character you cannot see, and SPICE keeps it in the name`;
  if (SPACE_LIKE.test(ch)) return `${nameOfCharacter(ch, false)!} looks like a space, but SPICE keeps it in the name`;
  const like = lookAlikeOf(ch)!;
  return `${characterWhat(ch)} looks like ${like}, but SPICE knows only the plain letter ${like}`;
}

/** Why the characters `odd` of a name make another name: one character's words as before (S11), several each named. */
function oddWhy(odd: readonly string[]): string {
  const one = odd.length === 1 ? odd[0]! : undefined;
  if (one === undefined) return odd.map(characterWhy).join('; ').replace(/^./, (x) => x.toUpperCase());
  if (INVISIBLE.test(one)) return 'It is a character you cannot see, and SPICE keeps it in the name';
  if (SPACE_LIKE.test(one)) return 'It looks like a space, but SPICE keeps it in the name';
  const like = lookAlikeOf(one)!;
  return `It looks like ${like}, but SPICE knows only the plain letter ${like}`;
}

/** The fix's label for writing a name without the characters `odd`: "Take it out: use out", "Write the plain letter o: out". */
function oddFixLabel(odd: readonly string[], shown: string): string {
  const one = odd.length === 1 ? odd[0]! : undefined;
  if (one === undefined) return `Write the name in plain letters: ${shown}`;
  return INVISIBLE.test(one) || SPACE_LIKE.test(one) ? `Take it out: use ${shown}` : `Write the plain letter ${lookAlikeOf(one)!}: ${shown}`;
}

/**
 * A .tf output written with characters that are not what they look like, which make it another node
 * than `clean`, the node of the circuit it looks like (S11, critic of its fix, rounds 1 and 2;
 * tf-problems-8). The characters are named, never shown, the node as the other words name it ('the
 * node "ground"', "node1"; ground is "ground (node 0)"); the fix writes the name as the other lines
 * do, as the character's own warning does for the whole node. An ordinary node called gnd gets none:
 * written in v( ), gnd is ground (A3b).
 */
function oddTfNode(c: Ctx, t: Token, clean: string, idx: number, ground = false): void {
  // The characters `clean` was made without, each once, in the order they come.
  const odd = oddCharacters(t.text).filter((ch) => !clean.includes(ch));
  const node = ground ? 'ground (node 0)' : theNode(clean);
  add(c, 'tf-problems', 'error', t, `.tf asks about a node with ${list(odd.map(characterWhat))} in its name, not ${node}`,
    `${oddWhy(odd)}, so this is not ${node}${ground ? '' : ' the other lines name'} but another node, one no part connects to.`,
    idx === 0
      ? 'ngspice says nothing: it makes a new node with nothing connected, as if 1 Ω went from it to ground. The transfer function comes out 0 and the output impedance 1 Ω. [tf-problems-1, tf-problems-8]'
      : 'ngspice says nothing: it makes a new node with nothing connected, as if 1 Ω went from it to ground, which adds 1 Ω to the output impedance. [tf-problems-2, tf-problems-8]',
    !ground && lowerAscii(clean) === 'gnd' ? [] : [fix(oddFixLabel(odd, ground ? clean : tfNamed(clean)), replace(t, clean))]);
}

/**
 * A .tf output written plainly where the parts' node has a character that is not what it looks like
 * (critic of the S11 fix, round 2; tf-problems-9): the .tf asks about another node, one no part
 * connects to. No fix: a button here would write the character into the .tf; taking it out of the part
 * lines, as the character's own check does, makes the .tf right.
 */
function mirrorTfNode(c: Ctx, t: Token, y: NodeInfo, idx: number): void {
  const odd = oddCharacters(y.refs[0]!.text);
  const one = odd.length === 1 ? odd[0]! : undefined;
  const what = list(odd.map(characterWhat));
  const like = one !== undefined && !INVISIBLE.test(one) && !SPACE_LIKE.test(one) ? lookAlikeOf(one)! : undefined;
  const reason = one === undefined
    ? `${what}, and SPICE keeps such characters in the name`
    : like !== undefined
      ? `${what}, which looks like ${like}, but SPICE knows only the plain letter ${like}`
      : INVISIBLE.test(one)
        ? `${what}, a character you cannot see, and SPICE keeps it in the name`
        : `${what}, which looks like a space, but SPICE keeps it in the name`;
  const mend = one === undefined ? 'Write the name in plain letters in the part lines' : like !== undefined ? `Write the plain letter ${like} in the part lines` : 'Take the character out of the part lines';
  const asked = tfNamed(t.text);
  add(c, 'tf-problems', 'error', t, `.tf asks about ${nameSaysNode(asked) ? asked : `node ${asked}`}, but the parts are on another node: ${nodeWords(c, y.name)}`,
    `The part lines write their node with ${reason}, so no part connects to ${theNode(t.text)}, which .tf asks about. ${mend}, and the .tf asks about their node.`,
    idx === 0
      ? 'ngspice says nothing: it makes a new node with nothing connected, as if 1 Ω went from it to ground. The transfer function comes out 0 and the output impedance 1 Ω. [tf-problems-1, tf-problems-9]'
      : 'ngspice says nothing: it makes a new node with nothing connected, as if 1 Ω went from it to ground, which adds 1 Ω to the output impedance. [tf-problems-2, tf-problems-9]');
}

/**
 * A .tf's i( ) or input written with characters that are not what they look like, where the name
 * without them is a source of the circuit (critic of the S11 fix, round 2; tf-problems-10). The
 * characters are named, never shown, and ngspice's message is quoted in its own spelling (v___1).
 */
function oddTfPart(c: Ctx, t: Token, part: Element, role: 'output' | 'input'): void {
  const odd = oddCharacters(t.text).filter((ch) => !part.name.text.includes(ch));
  const what = list(odd.map(characterWhat));
  const name = nameOf(part);
  if (role === 'output') {
    add(c, 'tf-problems', 'error', t, `i( ) in .tf asks about a part with ${what} in its name, not ${name}`,
      `${oddWhy(odd)}, so this is not the voltage source ${name} the other lines name: no part has this name, so i( ) reads no current.`,
      'ngspice says nothing and gives a transfer function of 0 and an output impedance of 1e20 Ω. [tf-problems-7, tf-problems-10]',
      [fix(oddFixLabel(odd, name), replace(t, name))]);
  } else {
    add(c, 'tf-problems', 'error', t, `.tf's input is a part with ${what} in its name, not ${name}`,
      `${oddWhy(odd)}, so this is not the source ${name} the other lines name: no part has this name.`,
      `ngspice stops: 'Transfer function source ${ngspiceSpelling(t.text)} not in circuit'. [tf-problems-3, tf-problems-10]`,
      [fix(oddFixLabel(odd, name), replace(t, name))]);
  }
}

function checkAnalyses(c: Ctx): void {
  for (const l of c.n.lines) {
    const d = l.directive;
    // ngspice ignores an analysis line in a subcircuit no X line uses (A3f); in one an X line uses, it
    // runs the line as the main circuit's (graph.inSubcircuit holds part lines only).
    if (!d || l.kind !== 'directive' || unusedSubcircuit(c.n, l.index)) continue;
    if (d.name === '.dc') checkDc(c, d);
    else if (d.name === '.tran') checkTran(c, d);
    else if (d.name === '.tf') checkTf(c, d, l);
  }
  // ngspice runs a .tf written after a plain .end (S25, A3c), so it is checked as one above it is (critic
  // of the S11 fix, round 2: a hidden character there drew its 0 as an answer). The parser keeps such a
  // line's words in order: the command, then its arguments.
  for (const l of readAfterEnd(c.n)) {
    const [first, ...args] = l.tokens;
    if (first && lowerAscii(first.text) === '.tf') checkTf(c, { name: '.tf', token: first, args }, l);
  }
}

function checkEnd(c: Ctx): void {
  if (c.top.length === 0 || c.atLine !== undefined) return;
  const titleIsAnalysis = (() => {
    const t = c.n.lines[0]?.text.trim().toLowerCase() ?? '';
    return /^\.(op|tf|dc|tran|ac|noise|disto|pz|sens|sp|four|fourier)\b/.test(t);
  })();
  // A misspelt analysis has its own trap (unknown-dot-command), which says what to fix. ngspice still
  // reads the lines after a plain .end, so an analysis written there runs (after-end-1, S25).
  const analysisAfterEnd = readAfterEnd(c.n).some((l) => /^\s*\.(op|tf|dc|tran|ac|noise|disto|pz|sens|sp|four|fourier)\b/i.test(l.text));
  if (c.n.analyses.length === 0 && !c.hasControl && !titleIsAnalysis && !c.analysisTypo && !analysisAfterEnd) {
    const endLine = c.n.end === undefined ? undefined : c.n.lines[c.n.end];
    const lastEl = c.n.lines[c.top[c.top.length - 1]!]!;
    const anchor = endLine?.directive?.token ?? lastEl.element!.name;
    const insert = endLine
      ? change(endLine.span.from, endLine.span.from, '.op\n')
      : change(c.text.length, c.text.length, `${c.text.endsWith('\n') ? '' : '\n'}.op\n`);
    add(c, 'no-analysis', 'error', anchor, 'No analysis: nothing will run',
      'A netlist describes a circuit; an analysis line tells SPICE what to work out. .op finds the DC voltages and currents, .dc sweeps a source, .tran shows how the circuit changes in time.',
      "ngspice reads the circuit and runs nothing. In batch mode it ends with 'no simulations run!'; PlainSpice's engine gives no results and no message. [no-analysis-1]",
      [fix(endLine ? 'Add .op before .end' : 'Add .op at the end', insert)]);
  }
  if (c.n.end === undefined) {
    const last = [...c.n.lines].reverse().find((l) => l.kind !== 'blank');
    if (!last) return;
    const tail = c.text.endsWith('\n') ? '' : '\n';
    // .end is the netlist's last line, but ngspice does not stop reading there (S25, after-end-1),
    // so the words say where new lines go, not that .end stops anything; and nothing about other
    // SPICE programs, which no fact here backs.
    add(c, 'missing-end', 'info', last.span.to > last.span.from ? last.span : { from: last.span.from, to: last.span.from }, 'No .end line',
      "A netlist ends with .end, its last line. ngspice runs this one without it, so this is only a note: add .end at the bottom, and keep new lines above it, because ngspice still reads lines written after .end.",
      'ngspice reads the file to its last line and runs it normally, without a message; with a .end, it still reads the lines after it. [missing-end-1, after-end-1]',
      [fix('Add .end at the bottom', change(c.text.length, c.text.length, `${tail}.end\n`))]);
    return;
  }
  const endLine = c.n.lines[c.n.end]!;
  const after = c.n.lines.filter((l) => l.index > c.n.end! && l.kind === 'after-end');
  const first = after[0];
  if (!first) return;
  const glued = c.text[endLine.directive!.token.to] === ';';
  const next = c.n.lines[c.n.end + 1]!;
  const tail = c.text.endsWith('\n') ? '' : '\n';
  const endText = endLine.text.trim();
  add(c, 'after-end', 'warning', first.span, 'Lines after .end',
    glued
      ? 'ngspice stops reading at this .end, so it skips the lines after it. Keep .end as the last line.'
      : 'ngspice does not stop reading at .end: it still reads these lines when it runs a file, so they are part of the circuit. Keep .end as the last line.',
    glued
      ? 'ngspice stops reading at a .end with a comment glued to it (.end;...) and skips every line after it, without a message. [after-end-2]'
      : 'ngspice still reads the lines after .end from a file and builds them into the circuit, without a message: in one test a resistor after .end changed the source current from −2 A to −5 A. [after-end-1]',
    [fix('Move .end to the bottom', change(endLine.span.from, next.span.from, ''), change(c.text.length, c.text.length, `${tail}${endText}\n`))]);
}

/**
 * The voltage sources (V, the outputs of E and H) and inductors joining nodes a and b, found along
 * one path, and whether their voltages could add up to more than 0 V: true unless every part on the
 * path is an inductor or a V source with a plain number, and those numbers cancel.
 */
function voltageAcross(c: Ctx, a: string, b: string): { parts: Element[]; nonzero: boolean } | undefined {
  const edges = new Map<string, { e: Element; to: string; sign: number }[]>();
  const link = (from: string, edge: { e: Element; to: string; sign: number }): void => {
    const list = edges.get(from);
    if (list) list.push(edge);
    else edges.set(from, [edge]);
  };
  for (const k of c.graph.elements) {
    const e = el(c, k);
    if (c.broken.has(k) || !e.letter || !'VEHL'.includes(e.letter) || e.nodes.length < 2) continue;
    const [p, n] = [e.nodes[0]!.name, e.nodes[1]!.name];
    link(p, { e, to: n, sign: 1 });
    link(n, { e, to: p, sign: -1 });
  }
  const back = new Map<string, { from: string; e: Element; sign: number }>();
  const queue = [a];
  const seen = new Set([a]);
  while (queue.length && !seen.has(b)) {
    const x = queue.shift()!;
    for (const edge of edges.get(x) ?? []) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      back.set(edge.to, { from: x, e: edge.e, sign: edge.sign });
      queue.push(edge.to);
    }
  }
  if (!seen.has(b)) return undefined;
  const parts: Element[] = [];
  let sum = 0;
  let known = true;
  for (let x = b; x !== a; ) {
    const step = back.get(x)!;
    parts.unshift(step.e);
    if (step.e.letter === 'V' && !step.e.sourceFunction && step.e.value?.number) sum += step.sign * step.e.value.number.value;
    else if (step.e.letter !== 'L' && !(step.e.letter === 'V' && !step.e.value && !step.e.sourceFunction)) known = false;
    x = step.from;
  }
  return { parts, nonzero: !known || sum !== 0 };
}

function checkZeroOhm(c: Ctx, i: number): void {
  const e = el(c, i);
  const v = e.value?.number?.value;
  if (e.letter !== 'R' || v === undefined || Math.abs(v) >= 1e-12 || e.nodes.length < 2) return;
  const [a, b] = [e.nodes[0]!.name, e.nodes[1]!.name];
  const across = a !== b && !c.graph.inSubcircuit.has(i) && c.graph.voltagePaths.same(a, b) ? voltageAcross(c, a, b) : undefined;
  if (across?.nonzero) {
    // zero-ohm-2: ngspice puts 1e-12 ohm there, so the current is the voltage times a million million.
    const sources = across.parts.filter((p) => p.letter !== 'L').map(nameOf);
    add(c, 'zero-ohm', 'error', e.value!.token, `${nameOf(e)} shorts ${list(sources)}: its current has no finite answer`,
      `A resistance of 0 straight across ${sources.length === 1 ? 'a voltage source' : 'voltage sources'} would need an endless current: a resistor's current is its voltage divided by its resistance. For a wire, give both ends the same node name; a wire across a source shorts it, so check where ${nameOf(e)} should go.`,
      `ngspice 47 uses 1e-12 Ω instead and warns: 'Value of resistor ${lowerAscii(nameOf(e))} is too small, set to 1.000000e-12'; in one test a 6 V source then gave 6e12 A, an artefact, not an answer. [zero-ohm-2]`);
    return;
  }
  // A 0 that another check already explains (0<zero-width space>.47, 0R47, 0k47, 0．47 ...: the student
  // meant 470 mΩ, and ngspice reads 0 only because of how it is written) is that check's: its fix
  // writes what was meant, where "Use a 0 V source" would make a short (re-check C1), and its words say
  // what ngspice 47 does with 0 Ω, as these do (zeroOhm; its critic, CR1-1).
  const tok = e.value!.token;
  if (v === 0 && (c.byLine.get(lineAt(c.n, tok.from).number) ?? []).some((t) => t.id !== 'zero-ohm' && t.span.from <= tok.from && tok.to <= t.span.to)) return;
  const fixes: Fix[] = [];
  if (e.fields.length === 4 && a !== b && !c.graph.inSubcircuit.has(i) && !c.graph.voltagePaths.same(a, b)) {
    const name = freshName(c, `V${e.name.text}`);
    fixes.push(fix(`Use a 0 V source instead (${name})`, replace(e.name, name), replace(e.value!.token, '0')));
  }
  // ngspice names a resistor inside a subcircuit by the X line that uses it: r.x1.r1 (zero-ohm-6; re-check critic CR2-7).
  const who = printedNames(c, i);
  const inside = !(who?.length === 1 && !who[0]!.includes('.'));
  add(c, 'zero-ohm', 'warning', e.value!.token, `${nameOf(e)} has a resistance of ${formatSI(v, 'Ω')}`,
    "SPICE can't use a resistance of exactly 0: a resistor's current is its voltage divided by its resistance. For a wire, give both ends the same node name; to measure the current in a wire, use a 0 V source (the ammeter trick).",
    `ngspice 47 uses 1e-12 Ω instead and ${tooSmall(who)}. ngspice 42 used 0.001 Ω without a word, which changed the answer in the 4th digit. [zero-ohm-1, zero-ohm-2${inside ? ', zero-ohm-6' : ''}]`,
    fixes);
}

// ------------------------------------------------------------------ syntax ngspice can't read at all

/** Names numparam knows without a .param inside { }: checked, `pi`, `e` and `true` are not among them. */
const BUILT_IN = new Set(['temper', 'hertz', 'time']);

function checkSyntax(c: Ctx): void {
  for (const l of c.n.lines) {
    if (l.kind !== 'element' && l.kind !== 'directive') continue;
    const e = l.element;
    // Expressions: braces and single quotes must close; names in them need a .param.
    for (const t of l.tokens) {
      const open = t.text[0];
      if (open !== '{' && open !== "'") continue;
      const closed = open === '{' ? balancedBraces(t.text) : t.text.length > 1 && t.text.endsWith("'");
      if (!closed) {
        const closer = open === '{' ? '}' : "'";
        add(c, 'fatal-syntax', 'error', t, `A ${open} is never closed`,
          `Braces { } (or single quotes ' ') hold an expression that SPICE works out, like {2*R}. Each opening one needs its closing partner on the same line.`,
          "ngspice stops with a fatal error: 'Closing \"}\" not found in line fragment'. [fatal-syntax-1, fatal-syntax-2]",
          [fix(`Close it: ${t.text}${closer}`, change(t.to, t.to, closer))]);
        continue;
      }
      // A .func body uses the function's own arguments (fatal-syntax-10).
      if (l.directive?.name === '.model' || l.directive?.name === '.subckt' || l.directive?.name === '.func') continue;
      for (const name of expressionNames(t.text)) {
        if (c.params.has(name) || BUILT_IN.has(name)) continue;
        const constant = name === 'pi' ? '3.141592653589793' : name === 'e' ? '2.718281828459045' : undefined;
        const at = c.n.lines[1] ? c.n.lines[1].span.from : c.text.length;
        add(c, 'fatal-syntax', 'error', t, `${name} is not defined: add a .param line`,
          constant
            ? `An expression in braces can use only names defined on a .param line, and SPICE does not define ${name} for you there.`
            : `An expression in braces can use only names defined on a .param line, for example .param ${name}=2k. This netlist has no .param for ${name}.`,
          `ngspice stops with a fatal error: 'Undefined parameter [${name}]'. [fatal-syntax-3, fatal-syntax-4]`,
          constant ? [fix(`Add .param ${name}=${constant}`, change(at, at, `.param ${name}=${constant}\n`))] : []);
        break;
      }
    }
    if (e?.letter === 'B') {
      const kind = behaviouralKind(e);
      const params = e.fields.filter((f) => f.role === 'parameter');
      if (!kind || params.length < 2) c.broken.add(l.index);
      if (!kind) {
        add(c, 'fatal-syntax', 'error', e.name, `${nameOf(e)} needs V= or I=`,
          'A line starting with B is a behavioural source: its voltage or current is a formula, written V=... or I=..., for example B1 out 0 V=2*v(in).',
          "ngspice stops with a fatal error: 'mal formed B source instance'. [fatal-syntax-7]");
      } else if (params.length < 2) {
        add(c, 'fatal-syntax', 'error', params[0]?.token ?? e.name, `${nameOf(e)} has an empty formula`,
          `After ${kind.toUpperCase()}= comes the formula, for example B1 out 0 V=2*v(in).`,
          "ngspice 47 stops with a fatal error: 'YYparse error, syntax error, in expression'. [fatal-syntax-8]");
      }
    }
  }
}

function balancedBraces(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
  }
  return depth === 0;
}

/**
 * Lower-case names used as values in an expression (a name followed by '(' is a function). What
 * v( ) and i( ) enclose are node and source names, not parameters: ngspice accepts {2*v(in)} and
 * {2*i(V1)} without a .param (fatal-syntax-11).
 */
export function expressionNames(expr: string): string[] {
  const out: string[] = [];
  const s = expr.replace(/^[{']|[}']$/g, '');
  let k = 0;
  while (k < s.length) {
    const ch = s[k]!;
    if (/[0-9.]/.test(ch)) {
      while (k < s.length && /[0-9.]/.test(s[k]!)) k += 1;
      if (/[eE]/.test(s[k] ?? '') && /[+\-0-9]/.test(s[k + 1] ?? '')) {
        k += 2;
        while (k < s.length && /[0-9]/.test(s[k]!)) k += 1;
      }
      while (k < s.length && /[A-Za-z]/.test(s[k]!)) k += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const from = k;
      while (k < s.length && /[A-Za-z0-9_]/.test(s[k]!)) k += 1;
      let p = k;
      // A character that looks like a space before the ( is the space-character check's (space-character-23).
      while (p < s.length && (s[p] === ' ' || SPACE_LIKE.test(s[p]!))) p += 1;
      const word = lowerAscii(s.slice(from, k));
      if (s[p] !== '(') out.push(word);
      else if (word === 'v' || word === 'i') {
        const close = s.indexOf(')', p);
        k = close < 0 ? s.length : close + 1;
      }
      continue;
    }
    k += 1;
  }
  return out;
}

function checkIncludes(c: Ctx): void {
  for (const l of c.n.lines) {
    const d = l.directive;
    if (!d) continue;
    const include = d.name === '.include' || d.name === '.inc';
    if (d.name === '.lib' && d.args.length < 2) {
      // ngspice's .lib takes a file and a section; with one word it is no command it knows (include-not-available-3).
      add(c, 'include-not-available', 'error', d.token, '.lib needs a file and a section',
        `In ngspice, .lib reads one section of a library file and takes two words: the file, then the section. PlainSpice can't open other files anyway, so copy what you need into the netlist.`,
        `ngspice does not recognise .lib with ${d.args.length === 0 ? 'no words' : 'one word'} and stops before anything runs, with 'unimplemented dot command' for .lib. [include-not-available-3]`);
      continue;
    }
    if (!include && d.name !== '.lib') continue;
    const file = d.args[0]?.text ?? '';
    add(c, 'include-not-available', 'error', d.token, "PlainSpice can't read other files",
      `This line asks SPICE to read ${file || 'a file'} from your computer. PlainSpice runs ngspice inside this page with only the netlist you see, so it can't open other files. Copy what you need from that file into the netlist instead.`,
      include
        ? `ngspice stops with a fatal error: 'Could not find include file ${file}'. [include-not-available-1]`
        : `ngspice stops with a fatal error: 'Could not find library file ${file}'. [include-not-available-2]`);
  }
}

/** Dot commands a typo usually comes from, for the unknown-dot-command fixes. */
const COMMON_DOTS = [
  '.op', '.tran', '.dc', '.ac', '.tf', '.end', '.ends', '.model', '.param', '.subckt', '.include', '.lib', '.options',
  '.option', '.print', '.plot', '.save', '.ic', '.meas', '.measure', '.func', '.temp', '.global', '.nodeset', '.noise', '.four',
];
const ANALYSIS_DOTS = new Set(['.op', '.tran', '.dc', '.ac', '.tf', '.noise', '.four']);

/** Two dot-command names one slip apart: a letter more, less, swapped or changed (".tarn", ".opp", ".trab"). */
function nearDot(a: string, b: string): boolean {
  if (looksLikeTypo(a, b)) return true;
  if (a.length !== b.length || a.length < 4) return false;
  let diff = 0;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k] && ++diff > 1) return false;
  return diff === 1;
}

/** Dot commands ngspice does not know stop it before anything runs (unknown-dot-command-1; A29). */
function checkUnknownDots(c: Ctx): Set<number> {
  const analysisTypos = new Set<number>();
  const lastLine = [...c.n.lines].reverse().find((l) => l.kind !== 'blank' && l.kind !== 'comment')?.index;
  let depth = 0;
  for (const l of c.n.lines) {
    const d = l.directive;
    if (d?.name === '.subckt' || d?.name === '.macro') depth += 1;
    else if (d?.name === '.ends' || d?.name === '.eom') depth = Math.max(0, depth - 1);
    if (!d || l.kind !== 'directive' || isKnownDotCommand(d.name)) continue;
    // .end only fits as the last line, and .ends only inside a subcircuit (an extra .ends is a fatal error).
    const fits = (x: string): boolean => (x === '.end' ? l.index === lastLine : x === '.ends' ? depth > 0 : true);
    const near = COMMON_DOTS.filter((x) => fits(x) && nearDot(d.name, x)).slice(0, 2);
    if (near.some((x) => ANALYSIS_DOTS.has(x))) analysisTypos.add(l.index);
    const word = d.token.text;
    add(c, 'unknown-dot-command', 'error', d.token, `ngspice does not know ${word}`,
      `A line starting with a dot is a dot command for SPICE, and ${word} is not one ngspice knows${near.length ? `. Did you mean ${near.join(' or ')}?` : '.'} To keep the line as a note, start it with * instead.`,
      `ngspice stops before running anything, with 'unimplemented dot command' for ${lowerAscii(word)}. [unknown-dot-command-1, unknown-dot-command-2]`,
      [...near.map((x) => fix(`Use ${x}`, replace(d.token, x))), commentFix(c, l)]);
  }
  return analysisTypos;
}

function checkContinuations(c: Ctx): void {
  for (const l of c.n.lines) {
    // A line continued by two backslashes at the end of the line before has no '+' of its own.
    const lead = /^[\s\ufeff]*\+/.exec(l.text);
    if (l.kind !== 'continuation' || !lead) continue;
    const plus = l.span.from + lead[0].length - 1;
    if (l.continues === undefined) {
      add(c, 'lost-continuation', 'warning', { from: plus, to: plus + 1 }, 'This + line has nothing to continue',
        'A line starting with + continues the line above it. Right after the title there is nothing to continue, so this line is lost. If it is a part, remove the +.',
        'ngspice has no line to join it to and skips it silently. [lost-continuation-3]',
        [fix('Remove the +', change(plus, plus + 1, ''))]);
      continue;
    }
    const target = c.n.lines[l.continues]!;
    if (target.kind !== 'comment') continue;
    const at = target.span.from + (target.text.length - target.text.replace(/^[\s\ufeff]+/, '').length);
    const meant = c.n.lines.slice(0, target.index).reverse().find((x) => x.kind === 'element' || x.kind === 'directive');
    const what = meant?.element ? nameOf(meant.element) : 'the line above';
    add(c, 'lost-continuation', 'warning', { from: plus, to: plus + 1 }, `This + line is lost in the comment above it`,
      `A + line continues the last line before it, and ngspice counts a comment starting with ${target.text.trim()[0]} as such a line. So the words on this line go into the comment, not into ${what}. Comments starting with * may sit in between.`,
      `ngspice joins the + line to the comment line, so its words are lost and ${what} is read without them (in one test ngspice then left the part out: 'not a valid resistor instance line'). [lost-continuation-1, lost-continuation-2]`,
      [fix('Make the comment start with *', change(at, at + 1, '*'))]);
  }
}

// ------------------------------------------------------------------ all checks

/**
 * Finds the beginner traps in a netlist, sorted by line, then column. Never throws.
 */
export function checkTraps(netlist: Netlist): Trap[] {
  const c = context(netlist);
  // Line by line first: these also mark the parts ngspice can't read (Ctx.broken).
  for (const i of netlist.elements) {
    checkValueSpelling(c, i);
    checkDecimalComma(c, i);
    checkSignInValue(c, i);
    checkSpaceBeforeSuffix(c, i);
    checkMidlineComment(c, i);
    checkOddValues(c, i);
    checkUnknownWord(c, i);
    checkIncomplete(c, i);
    checkZeroOhm(c, i);
  }
  for (const i of c.top) checkControlSource(c, i);
  checkLetters(c);
  checkModels(c);
  checkSyntax(c);
  checkGreekMu(c);
  for (const i of netlist.analyses) {
    const d = netlist.lines[i]!.directive!;
    d.args.forEach((t, k) => {
      const place = analysisPlace(c, d, k);
      if (place) checkOddValue(c, t, undefined, undefined, undefined, place);
    });
  }
  checkSpaceNodes(c);
  checkSpaces(c);
  checkTitle(c);
  checkDuplicates(c);
  checkIncludes(c);
  checkContinuations(c);
  c.analysisTypo = checkUnknownDots(c).size > 0;
  // Then the circuit as a whole.
  checkGround(c);
  checkInvisibleNodes(c);
  checkLookAlikeNodes(c);
  checkNodeNames(c);
  checkDangling(c);
  checkFloating(c);
  checkLoops(c);
  checkAnalyses(c);
  checkEnd(c);
  return c.traps.sort((a, b) => a.line - b.line || a.span.from - b.span.from || a.span.to - b.span.to || a.id.localeCompare(b.id));
}
