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
} from './characters.ts';
import { isKnownDotCommand, readAfterEnd } from './explain.ts';
import { buildGraph, behaviouralKind, hasReadableCurrent, type CircuitGraph, type DcGroup, type VoltageLoop } from './graph.ts';
import { formatSpiceNumber, readNumber } from './numbers.ts';
import { isReportOnlyParameter, lowerAscii, ngspiceName, ngspiceSpelling, parseNetlist } from './parse.ts';
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
  params: Set<string>;
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
  /** The drawing's `*@ label` lines, by the node they name as ngspice reads it, with the name as written (lower-case), read on the first rename (labelChanges). */
  labels?: Map<string, { span: Span; form: string }[]>;
  /** The node names on the commands for ngspice (.control, *#, ##), by node, read on the first use (controlNodes). */
  controlNodes?: Map<string, CommandRef[]>;
  /** The commands for ngspice save only names ngspice does not find, read on the first use (savesNothing). */
  savesNothing?: boolean;
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

/** "a", "a and b", "a, b and c". */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
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
    hasControl: n.lines.some((l) => l.kind === 'control' && /^\s*\.control/i.test(l.text)),
  };
  for (const i of c.top) if (!c.byKey.has(el(c, i).key)) c.byKey.set(el(c, i).key, i);
  for (const l of n.lines) {
    if (l.continues !== undefined) c.lastContinuation.set(l.continues, Math.max(l.index, c.lastContinuation.get(l.continues) ?? 0));
  }
  for (const l of n.lines) {
    if (l.kind === 'invalid' && /^[\s\ufeff]*@/.test(l.text) && c.atLine === undefined) c.atLine = l.index;
    const d = l.directive;
    if (!d) continue;
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
      `ngspice reads ${text} as ${amount(r.value, letter)} (${name}) and says nothing. [rkm-notation-1]`,
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
      `ngspice reads ${text} as ${amount(r.value, letter)}${r.ignored ? ` (it ignores the ${r.ignored})` : ''} and says nothing. [mega-as-milli-1, mega-as-milli-2, mega-as-milli-3]`,
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
      `ngspice reads ${text} as ${speakSI(r.value, unit)} and says nothing. [unit-letter-1, unit-letter-2]`,
      [fix(`Write ${digits} (${meant})`, replace(v.token, digits))],
    );
  }
}

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
function checkOddValue(c: Ctx, t: Token, unit: string | undefined, letter: ElementLetter | undefined, name: string | undefined): void {
  if (hasSpaceLike(t.text)) {
    checkSpaceInValue(c, t, unit, letter, name);
    return;
  }
  const { clean, odd } = cleanWord(t.text);
  if (!odd.length) return;
  const meant = readNumber(clean);
  if (!meant || meant.rest) return;
  const read = readNumber(t.text);
  if (read && read.value === meant.value) return;
  const hidden = odd.find((ch) => INVISIBLE.test(ch));
  const ch = hidden ?? odd[0]!;
  const what = describeCharacter(ch);
  const id: TrapId = hidden ? 'invisible-character' : 'look-alike-letter';
  const shown = (v: number): string => (letter && unit !== undefined ? amount(v, letter) : formatNumber(v));
  const subject = name ? `${name}'s value` : 'This value';
  const fixes = [fix(`Write ${clean}${letter && unit !== undefined ? ` (${amount(meant.value, letter)})` : ''}`, replace(t, clean))];
  if (!read) {
    // Where it is, from the text before it, said first: "Right after the -, it has ..." for
    // -<zero-width space>5 and -５ (invisible-character-6, look-alike-letter-6).
    const lead = withoutInvisible([...t.text].slice(0, [...t.text].indexOf(ch)).join(''));
    add(c, id, 'error', t, `${subject} is not a number for SPICE`,
      `${lead ? `Right after the ${lead}, it has ${what}` : `It starts with ${what}`}${hidden ? ', a character you cannot see (it often comes with text copied from a web page or a PDF)' : ''}, so SPICE does not read the word as a number. Write ${clean}.`,
      `ngspice stops: 'unknown parameter (${ngspiceSpelling(t.text)})'. [${hidden ? (lead ? 'invisible-character-6' : 'invisible-character-5') : lead ? 'look-alike-letter-6' : 'look-alike-letter-2'}]`,
      fixes);
    return;
  }
  // A capital M from another alphabet (the M key of a Greek keyboard): the student means mega, and a
  // plain M is milli in SPICE, so the fixes are mega-as-milli's, never "Write 10M" (look-alike-letter-4).
  if (!hidden && lookAlikeOf(ch) === 'M' && meant.scale?.name === 'milli' && letter && unit !== undefined) {
    const digits = numberPart(meant);
    const megaValue = (readNumber(digits)?.value ?? 0) * 1e6;
    const big = letter === 'R' || 'EFGH'.includes(letter);
    const mega = fix(`Make it ${digits}meg (${amount(megaValue, letter)})`, replace(t, `${digits}meg`));
    const milli = fix(`Keep milli: write ${digits}m`, replace(t, `${digits}m`));
    add(c, id, 'warning', t,
      big ? `${subject} is read as ${shown(read.value)}, not ${shown(megaValue)}` : `${subject} is read as ${shown(read.value)}`,
      `The value has ${what}. SPICE knows only the plain letter M, so it ignores this one like a unit. For mega, write meg (a capital M is milli in SPICE): ${digits}meg.`,
      `ngspice stops reading the number at ${what.replace(/, which looks like .*$/, '')}, without a message: it reads ${shown(read.value)}. [look-alike-letter-4, mega-as-milli-1]`,
      big ? [mega, milli] : [milli, mega]);
    return;
  }
  // Where the character sits: what is read before it, and what it hides after it.
  const at = [...t.text].indexOf(ch);
  const before = withoutInvisible([...t.text].slice(0, at).join(''));
  const after = cleanWord([...t.text].slice(at + 1).join('')).clean;
   // A look-alike: what it looks like ("the plain letter k", "the plain - sign"), the character as
  // "the ..." ("the minus sign (U+2212)"), and the claim: letters from other alphabets are
  // look-alike-letter-1; the Kelvin sign, fullwidth digits and signs, minus signs and dashes, -3.
  const like = lookAlikeOf(ch) ?? '';
  const isLetter = /[A-Za-z]/.test(like);
  const plain = /\d/.test(like) ? `the plain digit ${like}` : isLetter ? `the plain letter ${like}` : like === '.' ? 'the plain decimal point' : `the plain ${like} sign`;
  const the = what.replace(/, which looks like .*$/, '').replace(/^an? /, 'the ');
  const claim = isLetter && /[\u0370-\u04ff\uff21-\uff3a\uff41-\uff5a]/.test(ch) ? 'look-alike-letter-1' : 'look-alike-letter-3';
  add(c, id, 'warning', t, `${subject} is read as ${shown(read.value)}, not ${shown(meant.value)}`,
    hidden
      ? `${capital(what)} sits between ${before} and ${after}: a character you cannot see, which often comes with text copied from a web page or a PDF. SPICE stops reading the number at it, so the ${after} after it does not count. Write ${clean}.`
      : `The value has ${what}. SPICE knows only ${plain}, so it ignores this one like a unit${after ? `, and the ${after} after it` : ''}. Write ${clean}.`,
    hidden
      ? `ngspice stops reading the number at the ${nameOfCharacter(ch)!.replace(/^an? /, '').replace(/ \(U\+[0-9A-F]+\)$/, '')} and ignores the rest of the word, without a message: it reads ${shown(read.value)}. [invisible-character-1, invisible-character-2]`
      : `ngspice stops reading the number at ${the}, without a message: it reads ${shown(read.value)}. [${claim}]`,
    fixes);
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
function checkSpaceInValue(c: Ctx, t: Token, unit: string | undefined, letter: ElementLetter | undefined, name: string | undefined): void {
  const chars = [...t.text];
  const ch = chars.find((x) => SPACE_LIKE.test(x))!;
  const id: TrapId = ch === '\u00a0' ? 'nbsp' : 'space-character';
  const what = describeCharacter(ch);
  const bare = nameOfCharacter(ch, false)!.replace(/^an? /, '');
  const subject = name ? `${name}'s value` : 'This value';
  const shown = (v: number): string => (letter && unit !== undefined ? amount(v, letter) : formatNumber(v));
  if (SPACE_LIKE.test(chars[0]!)) {
    const clean = withoutSpaces(t.text);
    const r = readNumber(clean);
    if (!r || r.rest) return;
    c.spaced.add(t.from);
    add(c, id, 'error', t, `${subject} is not a number for SPICE`,
      `It starts with ${what}, which looks like a space but is none for SPICE (it often comes with text copied from a document or a web page), so SPICE does not read the word as a number. Write ${clean}.`,
      `ngspice stops: 'unknown parameter (${ngspiceSpelling(t.text)})'. [space-character-5]`,
      [fix(`Write ${clean}${letter && unit !== undefined ? ` (${amount(r.value, letter)})` : ''}`, replace(t, clean))]);
    return;
  }
  const meant = spacedValue(t.text);
  const read = readNumber(t.text);
  // A part's value written some other way: one value all the same, never split into words. Elsewhere
  // (a source's PULSE(0<thin space>1 ..., an analysis line) such a word is two numbers glued: checkSpaces'.
  const main = letter !== undefined && unit !== undefined;
  if (!read || (!meant && !main)) return;
  c.spaced.add(t.from);
  // A capacitor's or an inductor's value word is also looked up as a model name (greek-mu-2, space-character-8).
  const model = letter === 'C' || letter === 'L';
  const stops = `ngspice stops reading the number at the ${bare} and ignores the rest of the word${model ? '' : ', without a message'}: it reads ${shown(read.value)}${model ? ", and only warns that it can't find a model with the word's name" : ''}.`;
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
    add(c, id, 'warning', t, `${subject} is read as ${shown(read.value)}`,
      `${capital(what)} sits between ${before} and ${after} (it often comes with text copied from a document or a web page). It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the ${after} after it does not count. Without ${several ? 'these characters' : 'it'}, the value reads ${clean}.`,
      `${stops} [space-character-11${model ? ', space-character-8' : ''}]`,
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
    const milli = fix(`Keep milli: write ${meant.milli.spice}`, replace(t, meant.milli.spice));
    fixes.push(...(big ? [mega, milli] : [milli, mega]));
  } else fixes.push(fix(`Write ${meant.spice}${letter && unit !== undefined ? ` (${shown(meant.value)})` : ''}`, replace(t, meant.spice)));
  const write = meant.unit
    ? `SPICE needs no space and no units${meant.milli ? `, and a capital M is milli in SPICE: for mega, write meg: ${meant.spice}` : `: write ${meant.spice}`}.`
    : `Write the number without ${meant.spaces > 1 ? 'them' : 'it'}: ${meant.spice}.`;
  add(c, id, 'warning', t,
    meant.milli && !big ? `${subject} is read as ${shown(read.value)}` : `${subject} is read as ${shown(read.value)}, not ${shown(meant.value)}`,
    `${capital(what)} sits between ${meant.before} and ${meant.next}, as documents ${digits ? 'group digits' : 'write a number and its unit'}. It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the ${meant.after} after it does not count. ${write}`,
    `${stops} [${claim}]`,
    fixes);
}

/** Every value word of a part line, and the numbers of the analysis lines, through checkOddValue. */
function checkOddValues(c: Ctx, i: number): void {
  const e = el(c, i);
  for (const f of e.fields) {
    if (f.role === 'name' || f.role === 'model' || NODE_ROLES.has(f.role)) continue;
    const main = e.value?.token === f.token || (!e.value && f.role === 'other' && e.fields.indexOf(f) === e.fields.findIndex((x) => x.role === 'other'));
    checkOddValue(c, f.token, main && e.letter ? (UNIT[e.letter] ?? '') : undefined, main ? e.letter : undefined, main ? nameOf(e) : undefined);
  }
}

/** Number-like words with the Greek letter mu, which ngspice ignores (the micro sign works). */
function checkGreekMu(c: Ctx): void {
  const looksLikeNumber = /^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?\u03bc/;
  const visit = (t: Token, unit: string | undefined, letter?: ElementLetter): void => {
    if (!looksLikeNumber.test(t.text)) return;
    const r = readNumber(t.text);
    if (!r) return;
    const shown = unit === undefined ? formatNumber(r.value) : formatSI(r.value, unit);
    const meant = t.text.replaceAll('\u03bc', 'u');
    // greek-mu-2: a capacitor's or an inductor's value word is also looked up as a model name.
    const model = letter === 'C' || letter === 'L';
    add(
      c,
      'greek-mu',
      'warning',
      t,
      `${t.text} is read as ${shown}: SPICE ignores this \u03bc`,
      `This \u03bc is the Greek letter mu, not the micro sign \u00b5 that SPICE knows (phone keyboards often type the Greek one). SPICE ignores it like a unit. Write u for micro: ${meant}.`,
      model
        ? `ngspice reads ${t.text} as ${shown}; it only warns that it can't find a model called '${lowerAscii(t.text)}'. [greek-mu-2]`
        : `ngspice reads ${t.text} as ${shown} and says nothing. [greek-mu-1]`,
      [fix(`Write u for micro: ${meant}`, replace(t, meant))],
    );
  };
  for (const i of c.n.elements) {
    const e = el(c, i);
    for (const f of e.fields) {
      if (f.role === 'name' || f.role === 'model' || NODE_ROLES.has(f.role)) continue;
      const main = e.value?.token === f.token;
      visit(f.token, main && e.letter ? (UNIT[e.letter] ?? '') : undefined, main ? e.letter : undefined);
    }
  }
  for (const i of c.n.analyses) for (const t of c.n.lines[i]!.directive!.args) visit(t, undefined);
}

/** Main value fields of a part, in order. */
const mainFields = (e: Element): Field[] => e.fields.filter((f) => MAIN_ROLES.has(f.role));

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
      ? `ngspice reads two numbers, ${f1.token.text} and ${f2.token.text}, keeps the second one and says nothing${e.letter === 'C' || e.letter === 'L' ? ` except a warning that it can't find a model called '${lowerAscii(written)}'` : ''}: ${nameOf(e)} gets ${second ? amount(second.value, e.letter) : f2.token.text}. [decimal-comma-1, decimal-comma-2, decimal-comma-3]`
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
      `ngspice reads two numbers, ${f1.token.text} and ${f2.token.text}, keeps the second one and says nothing${e.letter === 'C' || e.letter === 'L' ? ` except a warning that it can't find a model called '${lowerAscii(written)}'` : ''}: ${nameOf(e)} gets ${amount(second.value, e.letter)}. [${e.letter === 'R' ? 'sign-in-value-1' : 'sign-in-value-2'}]`,
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
  const r = f1 ? readNumber(f1.token.text) : undefined;
  if (!f1 || !r || r.scale || r.ignored || r.rest) return;
  const f2 = fieldAfter(e, f1);
  if (!f2 || f2.role === 'model' || NODE_ROLES.has(f2.role)) return;
  if (!/^[ \t]+$/.test(c.text.slice(f1.token.to, f2.token.from))) return;
  const m = SUFFIX.exec(f2.token.text);
  if (!m || (!m[1] && !m[2]) || /^\s*=/.test(c.text.slice(f2.token.to, f2.token.to + 8))) return;
  let scale = m[1] ?? '';
  // A lone a/A or f/F after a number is a unit (amps, farads), not atto or femto.
  if (!m[2] && /^[af]$/i.test(scale)) scale = '';
  const n = f1.token.text;
  const span = { from: f1.token.from, to: f2.token.to };
  const written = c.text.slice(span.from, span.to);
  const fixes: Fix[] = [];
  if (scale === 'M') {
    fixes.push(fix(`Make it ${n}meg`, replace(span, `${n}meg`)), fix(`Keep milli: write ${n}m`, replace(span, `${n}m`)));
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
    scale
      ? `SPICE reads ${written} as two words: the number ${n}, then ${f2.token.text} as a separate word. Write the letter right after the number.`
      : `SPICE reads ${written} as two words: the number ${n}, then ${f2.token.text} as a separate word. SPICE needs no units: write the number alone.`,
    suffixVerdict(e.letter, f2.token.text, nameOf(e)),
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
  const name = nameOf(e);
  const kind = { R: 'a resistor', C: 'a capacitor', L: 'an inductor', V: 'a voltage source', I: 'a current source', E: 'an E line', F: 'an F line', G: 'a G line', H: 'an H line' }[e.letter as 'R'];
  const efgh = 'EFGH'.includes(e.letter);
  const prev = e.fields[k - 1];
  const glued = prev !== undefined && prev.token.to === f.token.from && /^[+-]/.test(word);
  const number = readNumber(word) !== undefined;
  const report = isReportOnlyParameter(e.letter, word);
  const why = glued
    ? `A + or ${MINUS} right after a digit or a letter starts a new word in SPICE, so ${prev.token.text}${word} is read as ${prev.token.text} and then ${word}, a word ${name} can't use. For an exponent, write e: 1e-3.`
    : report
      ? `${word} is a value SPICE can report for ${kind} (such as its current or its power), not one a netlist can set, so SPICE stops there.`
      : number
        ? `${efgh ? "PlainSpice's engine" : 'SPICE'} reads ${word} as one number too many for ${name}, so it stops there.`
        : `SPICE reads the words after a part's value as its settings, written name=value (like m=2), and ${word} is not a setting of ${kind}, so it stops there. To add a note at the end of a line, start it with a semicolon: ; like this.`;
  // ngspice quotes the word as it spells it: each byte of a letter outside ASCII is _ (unknown-word-12, W16).
  const message = report ? 'no such parameter on this device or parameter is missing' : `unknown parameter (${ngspiceSpelling(word)})`;
  const spelled = ngspiceSpelling(word) !== lowerAscii(word) ? ', unknown-word-12' : '';
  const claims = report ? 'unknown-word-6' : glued ? 'unknown-word-9' : number ? 'unknown-word-8' : `unknown-word-1, unknown-word-2, unknown-word-3, unknown-word-7${spelled}`;
  const ngspice = efgh
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
 * A character that looks like a space but is none for SPICE, between two words of a line (nbsp-1,
 * space-character-4): ngspice reads it as part of the word, so the words on either side become one.
 * One trap per line, named by its first such character; its fix writes a space for each. A value word
 * read as a number and a unit (checkSpaceInValue) is left out: the space was not meant between words.
 */
function checkSpaces(c: Ctx): void {
  for (const l of c.n.lines) {
    if (l.kind !== 'element' && l.kind !== 'directive' && l.kind !== 'continuation') continue;
    const tokens = l.tokens.filter((x) => hasSpaceLike(x.text) && !c.spaced.has(x.from));
    const t = tokens[0];
    if (!t) continue;
    const changes: TextChange[] = [];
    for (const x of tokens) for (let k = 0; k < x.text.length; k++) if (SPACE_LIKE.test(x.text[k]!)) changes.push(change(x.from + k, x.from + k + 1, ' '));
    const ch = [...t.text].find((x) => SPACE_LIKE.test(x))!;
    const shown = withSpaces(t.text);
    const fixes = [fix('Replace it with a normal space', ...changes)];
    if (ch === '\u00a0') {
      add(
        c,
        'nbsp',
        'warning',
        t,
        `A no-break space glues "${shown}" into one word`,
        'This line has a no-break space (it often comes with text copied from a web page or a PDF). It looks like a space, but SPICE does not treat it as one, so the words on either side become one word.',
        'ngspice reads the no-break space as part of the word and says nothing about it; in one test R1 n1 0<no-break space>2 became a resistor with the node "0 2" and no value, which ngspice then left out. [nbsp-1]',
        fixes,
      );
      continue;
    }
    const what = describeCharacter(ch);
    add(
      c,
      'space-character',
      'warning',
      t,
      `${capital(what)} glues "${shown}" into one word`,
      `This line has ${what}, which often comes with text copied from a document or a web page. It looks like a space, but SPICE does not treat it as one, so the words on either side become one word.`,
      `ngspice reads the ${nameOfCharacter(ch, false)!.replace(/^an? /, '')} as part of the word and says nothing about it; in one test R1 n1 0<thin space>2 became a resistor with the node "0 2" and no value, which ngspice then left out. [space-character-2, space-character-4]`,
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
  const notEnough = "Native ngspice 47 stops: 'not enough parameters in line'.";
  if (L === 'E' || L === 'G') {
    if (nodes < 4) {
      c.broken.add(i);
      add(c, 'missing-fields', 'error', span, `${name} needs four nodes and a ${L === 'E' ? 'gain' : 'value in amps per volt'}`,
        L === 'E' ? `An E line is: name, + node, ${MINUS} node, control + node, control ${MINUS} node, gain: the voltage at the + node is the gain times the control voltage.`
          : `A G line is: name, from node, to node, control + node, control ${MINUS} node, amps per volt.`,
        `${notEnough} PlainSpice's engine (built without XSPICE) misreads the line instead, for example taking a number for a node, and its results can't be used. [missing-fields-4, missing-fields-5]`);
    } else if (!e.value) {
      add(c, 'missing-value', 'error', span, `${name} has no ${L === 'E' ? 'gain' : 'value'}`,
        L === 'E' ? 'An E line ends with its gain: E1 out 0 c 0 2 makes the voltage at out 2 x the voltage at c.'
          : 'A G line ends with its value in amps per volt: G1 0 out c 0 0.5 pushes 0.5 amps for every volt at c.',
        `${notEnough} PlainSpice's engine (built without XSPICE) reads the missing value as 0 and says nothing. [missing-value-4, missing-value-5, missing-value-6, missing-value-7]`);
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
    add(c, 'missing-value', 'error', span, `${name} has no ${L === 'F' ? 'gain' : 'value'}`,
      L === 'F' ? 'An F line ends with its gain: F1 0 out Vs 3 pushes 3 x the current in Vs.' : 'An H line ends with its value in volts per amp: H1 out 0 Vs 4 makes 4 volts for every amp in Vs.',
      `${notEnough} PlainSpice's engine (built without XSPICE) reads the missing value as 0 and says nothing. [missing-value-4, missing-value-5, missing-value-6, missing-value-7]`);
  }
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
  // to o<thin space>ut or to оut (Cyrillic о).
  const odd = (y: NodeInfo): boolean => !y.ground && y.refs.length > 0 && (hasInvisible(y.name) || hasSpaceLike(y.name) || lookAlikeName(y.refs[0]!.text) !== undefined);
  const meantOf = (y: NodeInfo): string => lowerAscii(lookAlikeName(y.refs[0]!.text) ?? withoutSpaces(withoutInvisible(y.name)));
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
    if (candidates.length > 0) {
      add(
        c,
        'dangling-node',
        'warning',
        t,
        `Only ${name} touches ${t.text}`,
        `A node needs at least two connections for current to flow through it. ${t.text} appears only here, so no current flows in ${name}. Did you mean ${list(candidates.slice(0, 2).map((y) => y.name)).replace(' and ', ' or ')}?`,
        `ngspice says nothing: ${name} carries no current, so it changes nothing else in the circuit. [dangling-node-1, dangling-node-2]`,
        candidates.slice(0, 2).map((y) => fix(`Rename ${t.text} to ${y.name}`, replace(t, y.name))),
      );
    } else {
      add(
        c,
        'dangling-node',
        'info',
        t,
        `Only ${name} touches ${t.text}`,
        `No current flows in ${name}, so ${t.text} sits at the same voltage as ${other === GROUND ? 'ground (node 0)' : other}. That is right for an open terminal where you measure a voltage; if ${name} should connect to something, check this node name.`,
        `ngspice says nothing: ${name} carries no current, so it changes nothing else in the circuit. [dangling-node-1]`,
      );
    }
  }
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
    const nodes = list(g.nodes);
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
    const failing = controls.length > 0 && caps.length === 0 && gates.length === 0;
    const mixed = controls.length > 0 && !failing;
    const ngspice = failing
      ? `ngspice warns 'singular matrix: check node ${g.nodes[0]}' and then stops: 'The operating point could not be simulated successfully'. No results. [floating-dc-4]`
      : mixed
        ? `ngspice warns 'singular matrix'; then it either stops or prints numbers that can't be trusted. [floating-dc-1, floating-dc-4]`
        : `ngspice warns 'singular matrix: check node ${g.nodes[0]}', falls back to a 'transient op' and still prints numbers. They can't be trusted: in one test a node that is 3 V at DC came out at 0.0887 V. [floating-dc-1, floating-dc-2, floating-dc-3, floating-dc-5]`;
    const fixes: Fix[] = [];
    if (!failing && !mixed && kinds.size > 0) {
      const target = g.nodes[0]!;
      const name = freshName(c, 'Rdc1');
      const lastTop = c.graph.elements[c.graph.elements.length - 1]!;
      fixes.push(fix(`Add a 1 GΩ resistor from ${target} to ground`, insertLineAfter(c, lastTop, `${name} ${target} 0 1g`)));
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
  const nodes = list(g.nodes);
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
 * no-break space is part of a name (space-character-12).
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
    for (const m of code.matchAll(/\bv(?:m|p|r|i|db)?[ \t]*\(([^)]*)\)/gi)) {
      const inside = from + m.index + m[0].indexOf('(') + 1;
      for (const w of m[1]!.matchAll(/[^ \t,]+/g)) put(inside + w.index, w[0], command, false);
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
 * which PlainSpice adds for .op (src/spice/run-netlist.ts). Only for .dc, .tran and .ac, whose results
 * are node voltages, so that the plain name gives results again (a .tf saves no node voltage at all).
 * Whatever else might save something or take a save back (a .probe line, a delete, lines after .end,
 * which ngspice may read too) leaves it undecided: false. Read once.
 */
function savesNothing(c: Ctx): boolean {
  if (c.savesNothing !== undefined) return c.savesNothing;
  let saves = false;
  let nothing = c.n.analyses.length > 0 && c.n.analyses.every((i) => ['.dc', '.tran', '.ac'].includes(c.n.lines[i]!.directive!.name));
  for (const l of c.n.lines) {
    if (!nothing) break;
    const d = l.directive?.name;
    if (l.kind === 'after-end' || d === '.save' || d === '.probe' || (d !== undefined && /^\.opt(ions?)?$/.test(d) && /savecurrents/i.test(l.text))) {
      nothing = false;
    } else if (l.kind === 'control') {
      const words = commandCode(l).code.split(/[ \t]+/).filter(Boolean);
      const command = lowerAscii(words[0] ?? '');
      const args = words.slice(1);
      if (command === 'delete') nothing = false;
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

/** The line a token is on, or for a continuation line the line it continues (a card's first line). */
function cardOf(c: Ctx, t: Token): NetlistLine {
  const l = lineAt(c.n, t.from);
  return l.kind === 'continuation' && l.continues !== undefined ? c.n.lines[l.continues]! : l;
}

/**
 * The sentences for the lines where ngspice reads a node's name as written, not as the name it gave the
 * node (W16), each said only when such a line names the node (`print`, `command`; each check cites its
 * own claims for them). A .print or .plot line, which ngspice leaves out of the step that writes such
 * letters as `_`: run as ngspice -b it finds no such node there and prints nothing for that line, and
 * runs no analysis when that line was all it had to print, while PlainSpice's run leaves those lines
 * out (non-ascii-node-3). A command for ngspice (.control, *#, ##), where it finds no such node either
 * (non-ascii-node-4), and where a save that leaves it nothing to save gives PlainSpice's run no results
 * (savesNothing). The quoted message spells the name as ngspice does, µ as u and capitals small ("can't
 * parse 'uş'"). With `show` false the words never show the name (an invisible character, a character
 * that looks like a space): they say "the name".
 */
function asWritten(c: Ctx, info: NodeInfo, show: boolean): { said: string[]; print: boolean; command: boolean } {
  const said: string[] = [];
  const printed = info.refs.find((t) => {
    const d = cardOf(c, t).directive?.name;
    return d === '.print' || d === '.plot';
  });
  if (printed) {
    const ignored = `PlainSpice's run leaves .print and .plot lines out (ngspice: "${cardOf(c, printed).directive!.name} line ignored since rawfile was produced.").`;
    said.push(
      show
        ? `On a .print or .plot line it reads the name as written, so it finds no node ${printed.text} there: run as ngspice -b, it warns "can't parse '${ngspiceName(printed.text)}'" and prints nothing for that line, and when that line was all it had to print it runs no analysis. ${ignored}`
        : `On a .print or .plot line it reads the name as written, with the character in it, so it finds no such node there: run as ngspice -b, it warns that it can't parse the name and prints nothing for that line, and when that line was all it had to print it runs no analysis. ${ignored}`,
    );
  }
  const commands = controlNodes(c).get(info.name) ?? [];
  if (commands.length) {
    const save = commands.find((x) => x.command === 'save');
    const star = /^\s*(\*#|##)/.exec(lineAt(c.n, commands[0]!.token.from).text)?.[1];
    const where = star ? `On a ${star} line, a command for ngspice,` : 'In a .control block';
    const saved = save === undefined ? '' : save.bare ? `save ${save.token.text}` : `save v(${save.token.text})`;
    const none = save !== undefined && savesNothing(c) ? `${show ? saved : 'the save of that name'} saves nothing, and since nothing else is saved, PlainSpice's run gives no results ("no data saved")` : '';
    said.push(
      show
        ? `${where} it reads the name as written too, so it finds no node ${commands[0]!.token.text} there${none ? `: ${none}` : ''}.`
        : `${where} it reads the name as written too, with the character in it, so it finds no such node there${none ? `: ${none}` : ''}.`,
    );
  }
  return { said, print: printed !== undefined, command: commands.length > 0 };
}

/**
 * What ngspice does with a node name it spells with underscores, said only as far as it holds in every
 * run (S10): it spells the node so in its printout and results (non-ascii-node-1), "without a message"
 * only when no line where it reads the name as written names the node (asWritten: non-ascii-node-3, -4).
 */
function spelledNodeSentence(c: Ctx, info: NodeInfo, spelled: string): string {
  const { said, print, command } = asWritten(c, info, true);
  // Cites [non-ascii-node-1, non-ascii-node-3, non-ascii-node-4], the last two for their sentences.
  const facts = ['non-ascii-node-1', ...(print ? ['non-ascii-node-3'] : []), ...(command ? ['non-ascii-node-4'] : [])];
  return [`ngspice spells the node ${spelled} in its printout and results${said.length ? '.' : ', without a message.'}`, ...said, `[${facts.join(', ')}]`].join(' ');
}

/** A node renamed on the commands for ngspice too (controlNodes): there ngspice reads the name as written. */
function commandChanges(c: Ctx, info: NodeInfo, to: string): TextChange[] {
  return (controlNodes(c).get(info.name) ?? []).map((x) => replace(x.token, to));
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
  const renaming = (info: NodeInfo, to: string): TextChange[] => [...renameNode(info, to), ...labelChanges(c, info.name, to), ...commandChanges(c, info, to)];
  for (const [spelled, infos] of groups) {
    if (infos.length > 1) {
      const odd = infos.filter((i) => !isPlainName(i.name));
      const names = infos.map((i) => i.refs[0]!.text);
      const to = odd.map((i) => [i, plainFor(i)] as const);
      const at = (odd[odd.length - 1] ?? infos[infos.length - 1]!).refs[0]!;
      // Each name with such letters, where a line names it that ngspice reads as written (S10). Cites
      // [non-ascii-node-2, non-ascii-node-3, non-ascii-node-4], the last two for their sentences.
      const written = odd.map((i) => asWritten(c, i, true));
      const said = [...new Set(written.flatMap((w) => w.said))];
      const facts = ['non-ascii-node-2', ...(written.some((w) => w.print) ? ['non-ascii-node-3'] : []), ...(written.some((w) => w.command) ? ['non-ascii-node-4'] : [])];
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
 * person. Only a resistor, a capacitor or a diode then carries no current for sure, with no voltage
 * across it (non-ascii-node-5, -10); what the joined ends do to another part depends on the part: a
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
  const writing = (form: string, to: string): TextChange[] => [
    ...forms.get(form)!.map((t) => replace(t, to)),
    ...labelChanges(c, info.name, to, form),
    ...(controlNodes(c).get(info.name) ?? []).filter((x) => lowerAscii(x.token.text) === form).map((x) => replace(x.token, to)),
  ];
  const ngspice = `ngspice reads ${MICRO} as u and makes ${list(shown)} one node, ${spelled}, without a message`;
  if (across.length) {
    const names = across.map(nameOf);
    const at = across[0]!.nodes.find((r) => r.name === info.name && lowerAscii(r.token.text) !== kept[0])!.token;
    const to = others.map(([form, refs]) => [form, refs[0]!.text, freeName(plainLetters(refs[0]!.text, true) || 'n1')] as const);
    // A resistor, a capacitor or a diode with an end on each spelling has no voltage across it.
    const still = across.every((e) => (e.letter === 'R' || e.letter === 'C' || e.letter === 'D') && e.nodes.length === 2);
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
        : `ngspice reads ${MICRO} as u and makes ${list(shown)} one node, ${spelled}. [non-ascii-node-5, non-ascii-node-11]`,
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
    const changes = [...renameNode(info, clean), ...commandChanges(c, info, clean), ...(other ? [] : labelChanges(c, info.name, clean))];
    const { said, print, command } = asWritten(c, info, false);
    // Cites [invisible-character-3, invisible-character-7, invisible-character-8], the last two for their sentences.
    const facts = ['invisible-character-3', ...(print ? ['invisible-character-7'] : []), ...(command ? ['invisible-character-8'] : [])];
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
      return !!e.letter && VALUE_LETTERS.has(e.letter) && !e.value && !e.fields.some((f) => f.role === 'model');
    });
    if (valueless) continue;
    for (const r of info.refs) c.spaced.add(r.from);
    const t = info.refs[0]!;
    const ch = [...t.text].find((x) => SPACE_LIKE.test(x))!;
    const clean = withoutSpaces(t.text);
    const other = c.n.nodes.get(lowerAscii(clean));
    const changes = [...renameNode(info, clean), ...commandChanges(c, info, clean), ...(other ? [] : labelChanges(c, info.name, clean))];
    const { said, print, command } = asWritten(c, info, false);
    // Cites [space-character-10, space-character-12, space-character-13], the last two for their sentences.
    const facts = ['space-character-10', ...(print ? ['space-character-12'] : []), ...(command ? ['space-character-13'] : [])];
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
    const changes = [...renameNode(info, clean), ...commandChanges(c, info, clean), ...(other ? [] : labelChanges(c, info.name, clean))];
    const { said, print, command } = asWritten(c, info, true);
    // Cites [look-alike-letter-5, look-alike-letter-7, look-alike-letter-8], the last two for their sentences.
    const facts = ['look-alike-letter-5', ...(print ? ['look-alike-letter-7'] : []), ...(command ? ['look-alike-letter-8'] : [])];
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

function checkDc(c: Ctx, d: NonNullable<NetlistLine['directive']>): void {
  const args = d.args;
  let k = 0;
  while (k < args.length) {
    const src = args[k]!;
    const nums: Token[] = [];
    for (let j = k + 1; j < args.length && nums.length < 3 && readNumber(args[j]!.text); j++) nums.push(args[j]!);
    k += 1 + nums.length;
    const name = lowerAscii(src.text);
    if (name !== 'temp') {
      const target = c.byKey.get(name);
      const targetEl = target === undefined ? undefined : el(c, target);
      if (!sweepable(targetEl)) {
        const sources = independentSources(c);
        add(c, 'dc-sweep-problems', 'error', src, targetEl ? `.dc can't sweep ${src.text}` : `.dc sweeps ${src.text}, which is not in the circuit`,
          `.dc sweeps a voltage source, a current source, a resistor, or the temperature (temp), named first on its line. ${targetEl ? `${nameOf(targetEl)} is none of these.` : `There is no part called ${src.text}.`}`,
          `ngspice stops when the sweep starts: 'Voltage source, current source, or resistor named "${name}" is not in the circuit'. [dc-sweep-problems-6, dc-sweep-problems-7]`,
          sources.length === 1 ? [fix(`Sweep ${nameOf(sources[0]!)} instead`, replace(src, nameOf(sources[0]!)))] : []);
      }
    }
    const [t0, t1, t2] = nums;
    const start = num(t0);
    const stop = num(t1);
    if (start === undefined || stop === undefined || !t1) continue;
    const intro = `.dc ${src.text} ${t0!.text} ${t1.text} ${t2?.text ?? '<step>'} means: sweep ${src.text} from ${t0!.text} to ${t1.text} in steps of ${t2?.text ?? '<step>'}.`;
    const tenth = (stop - start) / 10;
    const tenthText = formatSpiceNumber(tenth);
    const hangs = "ngspice 47 stops: 'Bad syntax!'. ngspice 42 never finishes: it keeps sweeping the first point. [dc-sweep-problems-1, dc-sweep-problems-2]";
    if (!t2) {
      add(c, 'dc-sweep-problems', 'error', { from: src.from, to: t1.to }, '.dc needs a step',
        `.dc needs four things: the source to sweep, the start, the stop and the step. For example .dc ${src.text} ${t0!.text} ${t1.text} ${tenth !== 0 ? tenthText : '1'}.`,
        hangs, tenth !== 0 ? [fix(`Add a step of ${tenthText} (10 steps)`, change(t1.to, t1.to, ` ${tenthText}`))] : []);
      continue;
    }
    const step = num(t2);
    if (step === undefined) continue;
    if (step === 0) {
      add(c, 'dc-sweep-problems', 'error', t2, 'A step of 0 never reaches the stop',
        `${intro} A step of 0 never moves away from the start.`, hangs,
        tenth !== 0 ? [fix(`Use a step of ${tenthText} (10 steps)`, replace(t2, tenthText))] : []);
    } else if (step > 0 && start > stop) {
      add(c, 'dc-sweep-problems', 'error', { from: t0!.from, to: t2.to }, 'This sweep has no points: start is above stop',
        `${intro} Going up in steps of ${t2.text} from ${t0!.text} never gets down to ${t1.text}. Swap the two ends, or use a negative step to sweep downwards.`,
        'ngspice runs no sweep points and says nothing: the results are empty. [dc-sweep-problems-4]',
        [fix(`Swap them: from ${t1.text} to ${t0!.text}`, replace(t0!, t1.text), replace(t1, t0!.text)),
          fix(`Go down: make the step ${formatSpiceNumber(-step)}`, replace(t2, formatSpiceNumber(-step)))]);
    } else if (step < 0 && start < stop) {
      add(c, 'dc-sweep-problems', 'error', t2, 'This sweep has no points: the step goes the wrong way',
        `${intro} Going down in steps of ${t2.text} from ${t0!.text} never gets up to ${t1.text}.`,
        'ngspice runs no sweep points and says nothing: the results are empty. [dc-sweep-problems-3]',
        [fix(`Make the step ${formatSpiceNumber(-step)}`, replace(t2, formatSpiceNumber(-step)))]);
    } else if (start !== stop && Math.abs(step) > Math.abs(stop - start)) {
      add(c, 'dc-sweep-problems', 'warning', t2, 'The step is bigger than the whole sweep',
        `${intro} One step jumps past ${t1.text}, so the sweep has only its first point.`,
        `ngspice computes only the first point (${src.text} = ${t0!.text}) and says nothing. [dc-sweep-problems-5]`,
        [fix(`Use a step of ${tenthText} (10 steps)`, replace(t2, tenthText))]);
    }
  }
}

function checkTran(c: Ctx, d: NonNullable<NetlistLine['directive']>): void {
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
  if (!a1) {
    const step = formatSpiceNumber(tstep / 100);
    add(c, 'tran-problems', 'error', a0, '.tran needs a stop time',
      `.tran needs at least two numbers: the step and the stop time, for example .tran ${step} ${a0.text}. With one number, SPICE takes it as the step and finds no stop time.`,
      "ngspice stops: 'TSTOP is invalid, must be greater than zero.' [tran-problems-1]",
      tstep > 0 ? [fix(`Use ${a0.text} as the stop time: .tran ${step} ${a0.text}`, change(a0.from, a0.from, `${step} `))] : []);
    return;
  }
  const tstop = num(a1);
  if (tstop === undefined) return;
  if (tstep <= 0) {
    const step = formatSpiceNumber(tstop / 100);
    add(c, 'tran-problems', 'error', a0, `The step of .tran must be more than 0`,
      `.tran ${a0.text} ${a1.text} means: steps of ${a0.text} up to ${a1.text}. The step has to be a positive time.`,
      "ngspice stops: 'TSTEP is invalid, must be greater than zero.' [tran-problems-2, tran-problems-7]",
      tstop > 0 ? [fix(`Use a step of ${step}`, replace(a0, step))] : []);
    return;
  }
  const tstart = num(a2);
  if (a2 && tstart !== undefined && tstart >= tstop) {
    add(c, 'tran-problems', 'error', a2, 'The start time is not before the stop time',
      `The third number of .tran is the time to start saving results (${a2.text}); it must be less than the stop time (${a1.text}).`,
      "ngspice stops: 'TSTART is invalid, must be less than TSTOP.' [tran-problems-4, tran-problems-5]",
      [fix(`Remove the start time ${a2.text}`, change(a1.to, a2.to, ''))]);
    return;
  }
  if (tstep > tstop) {
    const step = formatSpiceNumber(tstop / 100);
    add(c, 'tran-problems', 'info', a0, 'The step is longer than the whole run',
      `.tran ${a0.text} ${a1.text} means: steps of ${a0.text} up to ${a1.text}. A step longer than the whole run is probably a slip.`,
      'ngspice runs and says nothing; it chooses its own time steps (in one test, 59 points for .tran 1 5m), so the curve still looks fine. [tran-problems-3]',
      [fix(`Use a step of ${step} (a hundredth of ${a1.text})`, replace(a0, step))]);
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
  const nodeCandidates = (t: Token): Fix[] =>
    [...c.n.nodes.values()]
      .filter((y) => y.connections.length > 0 && looksLikeTypo(lowerAscii(t.text), y.name))
      .slice(0, 2)
      .map((y) => fix(`Use ${y.name}`, replace(t, y.name)));
  if (kind === 'v') {
    outputs.forEach((t, idx) => {
      const name = lowerAscii(t.text);
      if (name === GROUND || name === 'gnd' || (c.n.nodes.get(name)?.connections.length ?? 0) > 0) return;
      add(c, 'tf-problems', 'error', t, `.tf asks about node ${t.text}, which is not in the circuit`,
        `There is no node called ${t.text}: no part connects to it. .tf v(${t.text}) needs a node of the circuit.`,
        idx === 0
          ? 'ngspice says nothing: it makes a new node with nothing connected, as if 1 Ω went from it to ground. The transfer function comes out 0 and the output impedance 1 Ω. [tf-problems-1]'
          : 'ngspice says nothing: it makes a new node with nothing connected, as if 1 Ω went from it to ground, which adds 1 Ω to the output impedance. [tf-problems-2]',
        nodeCandidates(t));
    });
  } else if (outputs[0]) {
    const t = outputs[0];
    const target = c.byKey.get(lowerAscii(t.text));
    if (target === undefined || el(c, target).letter !== 'V') {
      add(c, 'tf-problems', 'error', t, `i(${t.text}) needs a voltage source`,
        `i( ) in .tf reads the current through a voltage source${target === undefined ? `, and there is no part called ${t.text}` : `; ${t.text} is not one`}. To measure a current, put a 0 V source in that branch (the ammeter trick) and write i( ) with its name.`,
        'ngspice says nothing and gives a transfer function of 0 and an output impedance of 1e20 Ω. [tf-problems-5, tf-problems-7]');
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
  const target = c.byKey.get(lowerAscii(src.text));
  const targetEl = target === undefined ? undefined : el(c, target);
  if (!targetEl) {
    add(c, 'tf-problems', 'error', src, `.tf's input ${src.text} is not in the circuit`,
      `The last word of .tf names the input source. There is no part called ${src.text}.`,
      `ngspice stops: 'Transfer function source ${lowerAscii(src.text)} not in circuit'. [tf-problems-3]`, useOnly(src));
  } else if (targetEl.letter !== 'V' && targetEl.letter !== 'I') {
    add(c, 'tf-problems', 'error', src, `.tf's input must be a source, not ${src.text}`,
      `The input of .tf must be an independent source: a voltage source (V) or a current source (I). ${nameOf(targetEl)} is not.`,
      `ngspice stops: 'Transfer function source ${lowerAscii(src.text)} not of proper type'. [tf-problems-4]`, useOnly(src));
  }
}

function checkAnalyses(c: Ctx): void {
  for (const l of c.n.lines) {
    const d = l.directive;
    if (!d || l.kind !== 'directive' || c.graph.inSubcircuit.has(l.index)) continue;
    if (d.name === '.dc') checkDc(c, d);
    else if (d.name === '.tran') checkTran(c, d);
    else if (d.name === '.tf') checkTf(c, d, l);
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
  const fixes: Fix[] = [];
  if (e.fields.length === 4 && a !== b && !c.graph.inSubcircuit.has(i) && !c.graph.voltagePaths.same(a, b)) {
    const name = freshName(c, `V${e.name.text}`);
    fixes.push(fix(`Use a 0 V source instead (${name})`, replace(e.name, name), replace(e.value!.token, '0')));
  }
  const across = a !== b && !c.graph.inSubcircuit.has(i) && c.graph.voltagePaths.same(a, b) ? voltageAcross(c, a, b) : undefined;
  if (across?.nonzero) {
    // zero-ohm-2: ngspice puts 1e-12 ohm there, so the current is the voltage times a million million.
    const sources = across.parts.filter((p) => p.letter !== 'L').map(nameOf);
    add(c, 'zero-ohm', 'error', e.value!.token, `${nameOf(e)} shorts ${list(sources)}: its current has no finite answer`,
      `A resistance of 0 straight across ${sources.length === 1 ? 'a voltage source' : 'voltage sources'} would need an endless current: a resistor's current is its voltage divided by its resistance. For a wire, give both ends the same node name; a wire across a source shorts it, so check where ${nameOf(e)} should go.`,
      `ngspice 47 uses 1e-12 Ω instead and warns: 'Value of resistor ${lowerAscii(nameOf(e))} is too small, set to 1.000000e-12'; in one test a 6 V source then gave 6e12 A, an artefact, not an answer. [zero-ohm-2]`);
    return;
  }
  add(c, 'zero-ohm', 'warning', e.value!.token, `${nameOf(e)} has a resistance of ${formatSI(v, 'Ω')}`,
    "SPICE can't use a resistance of exactly 0: a resistor's current is its voltage divided by its resistance. For a wire, give both ends the same node name; to measure the current in a wire, use a 0 V source (the ammeter trick).",
    `ngspice 47 uses 1e-12 Ω instead and warns: 'Value of resistor ${lowerAscii(nameOf(e))} is too small, set to 1.000000e-12'. ngspice 42 used 0.001 Ω without a word, which changed the answer in the 4th digit. [zero-ohm-1, zero-ohm-2]`,
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
      while (p < s.length && s[p] === ' ') p += 1;
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
  for (const i of netlist.analyses) for (const t of netlist.lines[i]!.directive!.args) checkOddValue(c, t, undefined, undefined, undefined);
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
