/**
 * The netlist text PlainSpice gives ngspice for a run: the student's text, with at most one line
 * added and over-long titles cut, or nothing at all when ngspice would write past the end of one
 * of its fixed spaces (the student's text itself is never changed):
 *
 * - **Every current.** When the netlist asks for an operating point (.op) and has no
 *   `.options savecurrents`, the copy that runs gets `.options savecurrents` just before `.end`.
 *   ngspice then also saves the current through every R, C, L, F, G and I part, not only through
 *   the voltage sources (claim A2 in docs/spice-facts/explanations.md), so the results can show
 *   which way every current flows. The node voltages are the same with or without it (A1 and A2
 *   give the same values). The line goes just before `.end`, so it moves none of the student's
 *   lines: "line N" in ngspice's messages still points at line N of the editor.
 * - **The title.** Line 1, whole, and the title of any `.title` line keep at most their first 504
 *   bytes: ngspice writes the title into a space of 513 bytes when it writes its results file, and
 *   stops on a longer one (limit-1). Only the title is cut, so the numbers are those of the whole
 *   netlist (limit-2).
 * - **Names that do not fit.** ngspice copies names into spaces of fixed size in several places,
 *   sometimes two of them into one, without checking their length (limit-3 to limit-7, limit-9,
 *   limit-10), and it makes some names itself: it takes the blanks out of brackets (limit-13), puts
 *   the text of string parameters in place (limit-14) and names what a `.probe` line measures
 *   (limit-15). Past the end of the space, native ngspice stops ("buffer overflow detected", "stack
 *   smashing detected") or runs on with its memory overwritten, and PlainSpice's engine runs on,
 *   gives no results or crashes. So PlainSpice does not give ngspice a netlist with such a name
 *   (`notRun`, with the line and why): the student shortens it. No real netlist comes near these
 *   lengths; a link can. A circuit built with `circbyline` commands is checked the same way, once
 *   (limit-12, limit-16).
 *
 * The ngspice output tab lists what PlainSpice added and changed (`added`, `notes`).
 */
import { parseNetlist } from './parse.ts';
import type { Element, Netlist, NetlistLine } from './types.ts';

export const SAVE_CURRENTS_LINE = '.options savecurrents';

/** The most bytes of a title ngspice can write to its results file: "Title: " + 504 + newline + end = 513 (limit-1). */
export const TITLE_BYTES = 504;
/**
 * The most bytes of a name PlainSpice gives ngspice, as written or as ngspice makes it (r.x1.x2.r1
 * inside subcircuits, i(abc) from i( a b c ), the text of a string parameter, the names of a .probe
 * line): two of them, or one and the words around it, fit in 512 (limit-3 to limit-7, limit-10,
 * limit-13 to limit-15).
 */
export const WORD_BYTES = 250;
/** The most bytes of a v(…) in a formula (one ngspice writes for a .probe line too) or of an analysis command of a .control block (limit-5, limit-6, limit-15). */
export const RUN_BYTES = 500;
/** The most bytes of a .model line's version: ngspice copies it into 100 bytes (limit-9). */
export const VERSION_BYTES = 90;

export interface NotRun {
  /** The line (1-based, as the editor numbers it) where the word or line is. */
  line: number;
  /** Why PlainSpice did not run the netlist, and what to do, in plain words. */
  reason: string;
}

export interface NetlistToRun {
  /** The text ngspice runs. */
  text: string;
  /** The lines PlainSpice added to that text (empty when it is the student's text unchanged). */
  added: string[];
  /** What else PlainSpice did to that copy, a sentence each: a title cut. */
  notes: string[];
  /** Set when PlainSpice must not give this netlist to ngspice: `text` is then not to be run. */
  notRun?: NotRun;
}

/** The words PlainSpice says about the copy ngspice runs. */
const S = {
  titleCut: (line: number, bytes: number, kept: number): string =>
    `PlainSpice cut the title on line ${line} from ${bytes} to ${kept} bytes in the copy ngspice ran: ngspice copies the title into a space of 513 bytes when it writes its results file, and stops on a longer one. A plain letter is one byte; ş or é is two. Your netlist keeps the whole title.`,
  longWord: (line: number, word: string, bytes: number): string =>
    `Line ${line} has a word of ${bytes} bytes (${shown(word)}). PlainSpice gives ngspice words of at most ${WORD_BYTES} bytes: ngspice copies names into spaces of 512 bytes, sometimes two names into one, and writes past the end with longer ones, so its results could not be trusted. Shorten the word.`,
  joinedWord: (line: number, word: string, bytes: number, upTo = false): string =>
    `Line ${line}: ngspice takes the blanks out of the brackets on this line, so ${shown(word)} becomes one word of ${upTo ? 'up to ' : ''}${bytes} bytes. PlainSpice gives ngspice words of at most ${WORD_BYTES} bytes: ngspice copies names into spaces of 512 bytes and writes past the end with longer ones. Shorten the names in the brackets.`,
  longText: (line: number, braces: string, bytes: number): string =>
    `Line ${line}: ${shown(braces)} stands for a text of ${bytes} bytes, which ngspice puts in its place (it joins the quoted pieces and the text parameters in it). PlainSpice gives ngspice words of at most ${WORD_BYTES} bytes: ngspice copies names into spaces of 512 bytes and writes past the end with longer ones. Shorten the text.`,
  noClose: (line: number, open: string): string =>
    `Line ${line}: the ${open} in this formula has no ) after it. ngspice would look for the ) past the end of the line and write over its own memory, so PlainSpice did not run it. Add the ).`,
  longRun: (line: number, run: string, bytes: number): string =>
    `Line ${line}: ${shown(run)}) is ${bytes} bytes long from ${run.slice(0, 2)} to ). ngspice copies it into a space of 512 bytes when it reads a formula, so PlainSpice gives it at most ${RUN_BYTES}. Shorten the names in it.`,
  longCommand: (line: number, command: string, bytes: number): string =>
    `Line ${line}: ngspice writes this analysis command with a dot in front (.${command} and its words, one blank between each) into a space of 512 bytes before it runs it. That makes ${bytes} bytes here, and PlainSpice gives it at most ${RUN_BYTES}. Shorten the line.`,
  longFullName: (line: number, name: string, bytes: number): string =>
    `Line ${line}: inside the subcircuits of this X line, ngspice names a part or a node ${name}, ${bytes} bytes (the names of the X lines, then its own). PlainSpice gives ngspice names of at most ${WORD_BYTES} bytes, these too: ngspice copies such a name, and a few more characters, into a space of 512 bytes when it saves a current or prints it. Shorten the names of the X lines, or of the parts and nodes in the subcircuits.`,
  longVersion: (line: number, version: string, bytes: number): string =>
    `Line ${line}: the version on this .model line, ${shown(version)}, is ${bytes} bytes. ngspice copies it into a space of 100 bytes when a part uses the model, so PlainSpice gives it at most ${VERSION_BYTES}. Shorten it.`,
  longTextVersion: (line: number, braces: string, bytes: number): string =>
    `Line ${line}: the version on this .model line, ${shown(braces)}, stands for a text of ${bytes} bytes, which ngspice puts in its place. ngspice copies the version into a space of 100 bytes when a part uses the model, so PlainSpice gives it at most ${VERSION_BYTES}. Shorten the text.`,
  probeName: (line: number, name: string, bytes: number): string =>
    `Line ${line}: for this .probe line, ngspice makes the name ${shown(name)}, ${bytes} bytes, from the names of a part, its terminal and its node. PlainSpice gives ngspice names of at most ${WORD_BYTES} bytes, these too: ngspice copies such a name, and a few more characters, into a space of 512 bytes when it prints it. Shorten the names.`,
  probeFormula: (line: number, part: string, word: string, bytes: number): string =>
    `Line ${line}: to measure the power of ${shown(part)}, ngspice writes a formula with ${shown(word)}, ${bytes} bytes long (the names of the part, a terminal and a node together). ngspice copies it into a space of 512 bytes when it reads the formula, so PlainSpice gives it at most ${RUN_BYTES}. Shorten the names.`,
  longExpression: (line: number, command: string, expression: string, bytes: number): string =>
    `Line ${line}: ${command} names what a formula gives with the formula's text as ngspice reads it, its words with one blank between each: ${shown(expression)}, ${bytes} bytes. ngspice copies such a name into a space of 512 bytes, so PlainSpice gives it at most ${WORD_BYTES} bytes, like every name. Shorten the formula, or give it a name first with let.`,
  braceChoices: (line: number, word: string): string =>
    `Line ${line}: before it runs this command, ngspice makes a word of its own for each choice in the braces of ${shown(word)} (a comma separates two), so the command is longer than it looks. PlainSpice gives ngspice no choices in braces in a command. Write out the words you want.`,
  longMeasWord: (line: number, word: string, bytes: number): string =>
    `Line ${line}: this meas command has a word of ${bytes} bytes (${shown(word)}). When a word of a meas command is wrong, ngspice writes it with its message ("no such vector as …") into a space of 100 bytes, so PlainSpice gives them at most ${MEAS_BYTES} bytes each. Shorten the word.`,
  circuitTitle: (line: number, bytes: number): string =>
    `Line ${line}: this circbyline line is the title of the circuit it builds, ${bytes} bytes. ngspice copies a title into a space of 513 bytes when it writes its results file, so PlainSpice gives it at most ${TITLE_BYTES} bytes. Shorten it.`,
  circuitDotTitle: (line: number, bytes: number): string =>
    `Line ${line}: this circbyline line gives the circuit it builds a title of ${bytes} bytes, its words after .title. ngspice copies a title into a space of 513 bytes when it writes its results file, so PlainSpice gives it at most ${TITLE_BYTES} bytes. Shorten it.`,
  nestedCircuit: (line: number): string =>
    `Line ${line}: the circuit built with circbyline has a circbyline command of its own. ngspice cannot build a circuit while it is reading one it built (it crashes), so PlainSpice did not run it. Build the circuits one after the other.`,
  failed: 'PlainSpice could not prepare this netlist for ngspice (a bug in PlainSpice), so it did not run it.',
};

/** A long word, as the words above show it: its first characters. */
function shown(word: string): string {
  const chars = [...word];
  return chars.length > 16 ? `${chars.slice(0, 16).join('')}…` : word;
}

const OPTIONS = new Set(['.options', '.option', '.opt']);

/** The netlist already has `.options savecurrents` (on the line or a continuation of it). */
export function hasSaveCurrents(netlist: Netlist): boolean {
  return netlist.directives.some((i) => {
    const d = netlist.lines[i]?.directive;
    return !!d && OPTIONS.has(d.name) && d.args.some((a) => a.text.toLowerCase() === 'savecurrents');
  });
}

// ------------------------------------------------------------------ bytes

/** The bytes of one code point in UTF-8 (a lone surrogate is written as U+FFFD, 3 bytes). */
const utf8 = (cp: number): number => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/** The length of a text in UTF-8, as ngspice reads it from the file PlainSpice writes. */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (const ch of s) n += utf8(ch.codePointAt(0)!);
  return n;
}

/** The bytes of UTF-8 that the UTF-16 unit at `i` adds: a surrogate pair counts 4 at its first half. */
function unitBytes(s: string, i: number): number {
  const c = s.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff) return i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00 ? 4 : 3;
  if (c >= 0xdc00 && c <= 0xdfff) return i > 0 && (s.charCodeAt(i - 1) & 0xfc00) === 0xd800 ? 0 : 3;
  return utf8(c);
}

/** The longest start of a text that is at most `max` bytes in UTF-8, cut between two characters. */
export function cutToBytes(s: string, max: number): string {
  let n = 0;
  let end = 0;
  for (const ch of s) {
    n += utf8(ch.codePointAt(0)!);
    if (n > max) break;
    end += ch.length;
  }
  return s.slice(0, end);
}

// ------------------------------------------------------------------ the lines as ngspice reads them

/** ASCII white space: ngspice splits words only there (isspace in the C locale). */
const SPACE = /[ \t\n\v\f\r]/;
const SPACES = /[ \t\n\v\f\r]+/;
/** What ends a name: white space, brackets of formulas and lists, quotes, operators (not ! # $ % [ ] _ . @). */
const NAME_END = /[ \t\n\v\f\r(),={}'"+\-*/^<>?:&|;~`]+/;
/** One character that ends a name (NAME_END). */
const NAME_END_CHAR = /[ \t\n\v\f\r(),={}'"+\-*/^<>?:&|;~`]/;

/** A .title line: its first word starts with .title (in any case, after blanks or a byte order mark), anywhere, even after .end (limit-1). */
const DOT_TITLE = /^[﻿ \t\v\f\r]*\.title/i;
/** A title line for ngspice: line 1, and any .title line (limit-1). */
const isTitleLine = (text: string, index: number): boolean => index === 0 || DOT_TITLE.test(text);

/**
 * Where a title line's title starts in the copy's cut: line 1 is cut whole (native ngspice 47 and 42
 * read it as written when it starts with a blank, " .title …" too), and a .title line after its first
 * word and the blanks after it (limit-1).
 */
function titleStart(text: string, index: number): number {
  if (index === 0 || !DOT_TITLE.test(text)) return 0;
  return /^[﻿ \t\v\f\r]*\S*[ \t\v\f\r]*/.exec(text)![0].length;
}

/**
 * ngspice's gettok: the next word, ended by white space, or by a comma outside brackets. ngspice
 * takes a part's name and its first nodes this way when it saves currents and turns formulas
 * into B sources (inp_savecurrents, inp_compat), so these words can hold brackets and '='.
 */
function gettokWords(s: string, count: number): string[] {
  const out: string[] = [];
  let p = 0;
  while (out.length < count) {
    while (p < s.length && SPACE.test(s[p]!)) p += 1;
    if (p >= s.length) break;
    const start = p;
    let depth = 0;
    while (p < s.length && !SPACE.test(s[p]!)) {
      const c = s[p]!;
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      else if (c === ',' && depth < 1) break;
      p += 1;
    }
    out.push(s.slice(start, p));
    while (p < s.length && (SPACE.test(s[p]!) || s[p] === ',')) p += 1;
  }
  return out;
}

/** A line as ngspice's reader gives it: every '\r' and the leading blanks gone, then a byte order mark (limit-5). */
const asRead = (text: string): string => text.replace(/\r/g, '').replace(/^[ \t]+/, '').replace(/^﻿/, '');

/**
 * A line without its end-of-line comment, exactly as ngspice cuts it (inp_stripcomments_line,
 * limit-5): at a ';' (not the first character), at '//', and at a '$' after a blank or a comma
 * (inside a .control block: a '$' before a blank), but not inside quotes. A shorter cut would hide
 * words that ngspice reads: `B1 c 0 V=1$+v(b` is a formula to ngspice.
 */
function withoutComment(s: string, control: boolean): string {
  if (s === '' || s[0] === '*' || s[0] === '#') return s;
  let d = 0;
  while (d < s.length) {
    const c = s[d]!;
    d += 1;
    if (c === '"' || c === "'") {
      while (d < s.length && (s[d] !== c || s[d - 1] === '\\')) d += 1;
      if (d < s.length) d += 1;
      continue;
    }
    if (s[d] === ';') return s.slice(0, d);
    if (!control && c === '$') {
      if (d - 2 >= 0 && (s[d - 2] === ' ' || s[d - 2] === ',' || s[d - 2] === '\t')) return s.slice(0, d - 1);
    } else if (control && c === '$' && s[d] === ' ') return s.slice(0, d - 1);
    else if (c === '/' && s[d] === '/') return s.slice(0, d - 1);
  }
  return s;
}

/**
 * A card as ngspice joins it: the line, then each + line after it, with a space for the '+'. `code`
 * is the same without each line's end-of-line comment, which ngspice cuts first.
 */
interface Card {
  line: NetlistLine;
  text: string;
  code: string;
  /** In a .control block (from .control to the line before .endc, after .end too), where every line ngspice reads is a command. */
  control: boolean;
}

/** The .end line, which ngspice turns into a comment as it reads it, and reads on (limit-18). */
const isEndLine = (read: string): boolean => /^\.end(?:[ \t\n\v\f\r]|$)/i.test(read);

function cardsOf(netlist: Netlist): Card[] {
  const cards = new Map<number, Card>();
  const out: Card[] = [];
  // Every line of an *ng_script file is a command, as in a .control block (from .control to the line before .endc).
  const script = /^\*ng_script/i.test(asRead(netlist.lines[0]?.text ?? ''));
  const end = netlist.end;
  let control = false;
  /** The last line a + line joins as ngspice joins them (inp_stitch_continuation_lines): not blank, no comment, no + line, not .title or .end. */
  let last: Card | undefined;
  for (const line of netlist.lines) {
    const read = asRead(line.text);
    if (/^\.control/i.test(read)) control = true;
    if (/^\.endc/i.test(read)) control = false;
    // ngspice cuts no comment from line 1, the title.
    const code = line.index === 0 ? line.text : withoutComment(read, control || script);
    // After .end the parser joins no + line, but ngspice reads on and joins them as before it (limit-18).
    const after = end !== undefined && line.index > end && read.startsWith('+');
    // A + line is checked on its own after a title line, whose words are cut, not checked.
    const head = after ? last : line.kind === 'continuation' && line.continues !== undefined ? cards.get(line.continues) : undefined;
    if (head && !isTitleLine(head.line.text, head.line.index)) {
      head.text += ` ${line.text.replace(/^\s*\+/, '')}`;
      head.code += ` ${code.replace(/^\+/, '')}`;
      continue;
    }
    const card = { line, text: line.text, code, control };
    cards.set(line.index, card);
    out.push(card);
    if (line.index > 0 && !/^[#$*+]/.test(read) && code.trim() !== '' && !DOT_TITLE.test(read) && !isEndLine(read)) last = card;
  }
  return out;
}

// ------------------------------------------------------------------ names ngspice joins (limit-13, limit-14)

/** A text made from a line's code, and for each of its UTF-16 units the place in the code it comes from. */
interface Traced {
  s: string;
  at: number[];
}

const traced = (s: string): Traced => ({ s, at: Array.from({ length: s.length }, (_, i) => i) });

/**
 * ngspice's stripWhiteSpacesInsideParens (src/misc/string.c): the leading blanks go, and after each
 * '(' every blank up to the first ')'. gettoks does this to a .save, .print, .plot, .four or .meas
 * line, inp_meas_current to a part's line with an i( in it, and print, plot, meas and the other
 * commands that read names, to their words (limit-13): `i( a b c )` is the name i(abc) to ngspice.
 */
function stripInsideParens(t: Traced): Traced {
  const chars: string[] = [];
  const at: number[] = [];
  const n = t.s.length;
  let i = 0;
  while (i < n && SPACE.test(t.s[i]!)) i += 1;
  while (i < n) {
    const ch = t.s[i]!;
    chars.push(ch);
    at.push(t.at[i]!);
    i += 1;
    if (ch !== '(') continue;
    while (i < n) {
      const c = t.s[i]!;
      const from = t.at[i]!;
      i += 1;
      if (SPACE.test(c)) continue;
      chars.push(c);
      at.push(from);
      if (c === ')') break;
    }
  }
  return { s: chars.join(''), at };
}

/** The first word of a traced text (words end where `end` matches one character) over `max` bytes, and the code it comes from. */
function wordOver(t: Traced, end: RegExp, max: number, code: string): { word: string; bytes: number; from: number; to: number } | undefined {
  let start = -1;
  let bytes = 0;
  for (let i = 0; i <= t.s.length; i++) {
    if (i === t.s.length || end.test(t.s[i]!)) {
      if (start >= 0 && bytes > max) {
        const from = t.at[start]!;
        const to = t.at[i - 1]! + 1;
        return { word: code.slice(from, to), bytes, from, to };
      }
      start = -1;
      bytes = 0;
      continue;
    }
    if (start < 0) start = i;
    bytes += unitBytes(t.s, i);
  }
  return undefined;
}

/** numparam's identifiers (fetchid): a letter, '_', '[', ']' or a byte past ASCII, then those, digits and '.'. */
const ID_START = /[A-Za-z_[\]\u0080-\uffff]/;
const ID_CHAR = /[A-Za-z0-9_.[\]\u0080-\uffff]/;

/** A piece of a string expression: quoted text, or the name of a string parameter ({name} or name). */
type Piece = { text: string } | { name: string };

/**
 * numparam's string_expr (src/frontend/numparam/xpressn.c): blanks first, then quoted texts and string
 * parameters ({name} or name) with nothing between them. The pieces, or undefined when the text is
 * something else (a number, a formula).
 */
function stringPieces(s: string, from: number, to: number, isString: (name: string) => boolean): { pieces: Piece[]; end: number; quoted: boolean } | undefined {
  let t = from;
  while (t < to && (s[t] === ' ' || s[t] === '\t')) t += 1;
  const pieces: Piece[] = [];
  let quoted = false;
  while (t < to) {
    if (s[t] === '"') {
      const close = s.indexOf('"', t + 1);
      const stop = close < 0 || close >= to ? to : close;
      pieces.push({ text: s.slice(t + 1, stop) });
      t = stop < to ? stop + 1 : to;
      quoted = true;
      continue;
    }
    let name: string;
    if (s[t] === '{') {
      const close = s.indexOf('}', t + 1);
      const stop = close < 0 || close >= to ? to : close;
      name = s.slice(t + 1, stop).trim();
      t = stop < to ? stop + 1 : to;
    } else {
      const start = t;
      if (!ID_START.test(s[t]!)) break;
      while (t < to && ID_CHAR.test(s[t]!)) t += 1;
      name = s.slice(start, t);
    }
    if (!isString(name.toLowerCase())) return undefined;
    pieces.push({ name: name.toLowerCase() });
  }
  return pieces.length ? { pieces, end: t, quoted } : undefined;
}

/**
 * numparam's string parameters, and how many bytes of text each can stand for (limit-14): numparam
 * joins quoted texts and string parameters written together ("a""b"{s}), in a .param line, a .subckt
 * line's defaults and an X line's values, and puts the text in place of {name}. A name defined more
 * than once (in subcircuits, by X lines) counts with its longest text: a little more than ngspice uses,
 * never less.
 */
function stringParameters(cards: Card[]): (name: string) => number {
  /** Each definition's pieces, by lower-case name. */
  const defs = new Map<string, Piece[][]>();
  const quotedNames = new Set<string>();
  for (const { line, code } of cards) {
    const d = line.directive?.name;
    if (d !== '.param' && d !== '.subckt' && line.element?.letter !== 'X') continue;
    // Every "name = text" of the line, outside quotes.
    for (let i = 0; i < code.length; ) {
      if (code[i] === '"') {
        const close = code.indexOf('"', i + 1);
        i = close < 0 ? code.length : close + 1;
        continue;
      }
      if (!ID_START.test(code[i]!) || (i > 0 && ID_CHAR.test(code[i - 1]!))) {
        i += 1;
        continue;
      }
      const start = i;
      while (i < code.length && ID_CHAR.test(code[i]!)) i += 1;
      let k = i;
      while (k < code.length && (code[k] === ' ' || code[k] === '\t')) k += 1;
      if (code[k] !== '=' || code[k + 1] === '=') continue;
      const value = stringPieces(code, k + 1, code.length, () => true);
      if (!value) continue;
      const name = code.slice(start, i).toLowerCase();
      if (value.quoted) quotedNames.add(name);
      const list = defs.get(name);
      if (list) list.push(value.pieces);
      else defs.set(name, [value.pieces]);
      i = Math.max(value.end, k + 1);
    }
  }
  // A parameter is a string when one of its texts is quoted, or names another string parameter: from the quoted
  // ones, through the names that use each, so every name is handled once (a chain p0=p1, p1=p2 … too).
  const usedBy = new Map<string, string[]>();
  for (const [name, list] of defs)
    for (const pieces of list)
      for (const p of pieces) {
        if (!('name' in p)) continue;
        const users = usedBy.get(p.name);
        if (users) users.push(name);
        else usedBy.set(p.name, [name]);
      }
  const strings = new Set(quotedNames);
  for (const todo = [...quotedNames]; todo.length; )
    for (const user of usedBy.get(todo.pop()!) ?? [])
      if (!strings.has(user)) {
        strings.add(user);
        todo.push(user);
      }
  // The longest text of each, worked out once, depth first without recursion (a chain of 12,000 names is no
  // deeper for the stack than one): a name being worked out counts nothing where it is used inside itself.
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const add = (a: number, b: number): number => Math.min(a + b, Number.MAX_SAFE_INTEGER);
  const size = (root: string): number => {
    const known = memo.get(root);
    if (known !== undefined) return known;
    interface Frame {
      name: string;
      list: Piece[][];
      /** The definition and the piece of it being added up, its bytes so far, and the most of the definitions done. */
      def: number;
      piece: number;
      bytes: number;
      most: number;
    }
    const frame = (name: string): Frame => {
      visiting.add(name);
      return { name, list: defs.get(name) ?? [], def: 0, piece: 0, bytes: 0, most: 0 };
    };
    const stack = [frame(root)];
    let done = 0;
    while (stack.length) {
      const f = stack.at(-1)!;
      const pieces = f.list[f.def];
      if (!pieces) {
        visiting.delete(f.name);
        memo.set(f.name, f.most);
        stack.pop();
        done = f.most;
        const up = stack.at(-1);
        if (up) {
          up.bytes = add(up.bytes, done);
          up.piece += 1;
        }
        continue;
      }
      const p = pieces[f.piece];
      if (!p) {
        f.most = Math.max(f.most, f.bytes);
        f.def += 1;
        f.piece = 0;
        f.bytes = 0;
        continue;
      }
      if ('text' in p) {
        f.bytes = add(f.bytes, utf8Bytes(p.text));
        f.piece += 1;
        continue;
      }
      const known = memo.get(p.name);
      if (known !== undefined || !strings.has(p.name) || visiting.has(p.name)) {
        f.bytes = add(f.bytes, known ?? 0);
        f.piece += 1;
        continue;
      }
      stack.push(frame(p.name));
    }
    return done;
  };
  return (name: string) => (strings.has(name) ? size(name) : -1);
}

/** The bytes a number takes where numparam puts it in place of {…} ("% 23.15e", its blanks not counted). */
const NUMBER_BYTES = 23;

/** A {…} of a line, as numparam's stripbraces finds it (braces inside count), and the text it stands for. */
interface Braces {
  from: number;
  /** Just past the closing }. */
  to: number;
  /** The bytes of text numparam puts in its place: a string's, or a number's. */
  bytes: number;
  string: boolean;
}

function bracesOf(code: string, textBytes: (name: string) => number): Braces[] {
  const out: Braces[] = [];
  for (let i = code.indexOf('{'); i >= 0; i = code.indexOf('{', i)) {
    let depth = 1;
    let j = i + 1;
    for (; j < code.length && depth > 0; j++) {
      if (code[j] === '{') depth += 1;
      else if (code[j] === '}') depth -= 1;
    }
    const inner = depth === 0 ? j - 1 : j;
    const value = stringPieces(code, i + 1, inner, (name) => textBytes(name) >= 0);
    const string = !!value && value.end >= inner;
    let bytes = NUMBER_BYTES;
    if (string) {
      bytes = 0;
      for (const p of value.pieces) bytes += 'text' in p ? utf8Bytes(p.text) : textBytes(p.name);
    }
    out.push({ from: i, to: j, bytes: Math.min(bytes, Number.MAX_SAFE_INTEGER), string });
    i = j;
  }
  return out;
}

/**
 * The code with each {…} replaced as numparam replaces it: a blank on each side and its text, here as
 * that many letters (limit-14). Only for measuring: a text over WORD_BYTES is refused before this.
 */
function withTexts(code: string, braces: Braces[]): Traced {
  if (!braces.length) return traced(code);
  const parts: string[] = [];
  const at: number[] = [];
  let k = 0;
  const keep = (from: number, to: number): void => {
    parts.push(code.slice(from, to));
    for (let i = from; i < to; i++) at.push(i);
  };
  for (const b of braces) {
    keep(k, b.from);
    const n = Math.min(b.bytes, WORD_BYTES + 1);
    parts.push(` ${'W'.repeat(n)} `);
    at.push(b.from);
    for (let i = 0; i < n; i++) at.push(i === n - 1 ? b.to - 1 : b.from);
    at.push(b.to - 1);
    k = b.to;
  }
  keep(k, code.length);
  return { s: parts.join(''), at };
}

// ------------------------------------------------------------------ names inside subcircuits

export interface FullName {
  /** The name as ngspice makes it, lower-case: r.x1.x2.r1 for a part, x1.x2.n1 for a node. */
  name: string;
  bytes: number;
  /** The X line outside every subcircuit that the name comes through. */
  line: number;
}

/**
 * The longest name ngspice gives a part or a node inside the subcircuits, in bytes (limit-3,
 * limit-10): a part is "letter.x1.x2.name" (r.xzz.xxx.rz for Rz inside Xxx inside Xzz), a node
 * "x1.x2.name". The nodes of an X line inside a subcircuit count too, though ngspice gives a pin of
 * the subcircuit the name outside: a little longer than ngspice's, never shorter. `bytesOf` gives a
 * node's bytes as ngspice names it: a node written {t} has the bytes of the text t stands for (limit-14).
 */
export function longestFullName(netlist: Netlist, bytesOf: (name: string) => number = utf8Bytes): FullName | undefined {
  /** A name at the end of a full name: a part's (with its letter in front, "r.") or a node's. */
  interface Tail {
    text: string;
    bytes: number;
    letter: string;
  }
  interface Inside {
    tails: Tail[];
    xs: { name: string; bytes: number; target: string; line: number }[];
  }
  const top: Inside = { tails: [], xs: [] };
  const defs = new Map<string, Inside[]>();
  const open: Inside[] = [];
  for (const line of netlist.lines) {
    const d = line.directive;
    if (d && (d.name === '.subckt' || d.name === '.macro')) {
      const def: Inside = { tails: [], xs: [] };
      const name = d.args[0]?.text.toLowerCase() ?? '';
      const same = defs.get(name);
      if (same) same.push(def);
      else defs.set(name, [def]);
      open.push(def);
      continue;
    }
    if (d && (d.name === '.ends' || d.name === '.eom')) {
      open.pop();
      continue;
    }
    const e = line.kind === 'element' ? line.element : undefined;
    if (!e) continue;
    const here = open.at(-1) ?? top;
    if (e.letter === 'X') {
      const target = e.fields.find((f) => f.role === 'model')?.token.text.toLowerCase() ?? '';
      here.xs.push({ name: e.key, bytes: utf8Bytes(e.key), target, line: line.number });
    }
    // Outside every subcircuit a name stays as written (the word rule covers it).
    if (here === top) continue;
    for (const node of e.nodes) if (!node.ground) here.tails.push({ text: node.name, bytes: bytesOf(node.name), letter: '' });
    if (e.letter !== 'X') here.tails.push({ text: e.key, bytes: utf8Bytes(e.key), letter: e.key[0] ?? '' });
  }
  // The longest "x.….name" inside a subcircuit (without a part's letter in front), and that letter.
  type Path = { text: string; bytes: number; letter: string };
  const weight = (p: Path): number => p.bytes + (p.letter ? 2 : 0);
  const memo = new Map<string, Path | undefined>();
  const visiting = new Set<string>();
  const inside = (target: string, depth: number): Path | undefined => {
    if (memo.has(target)) return memo.get(target);
    if (visiting.has(target)) return undefined; // ngspice refuses a subcircuit inside itself
    // Each level adds at least "x." to a name, so past 125 levels every name inside is over 250 bytes.
    if (depth > 125) return { text: target, bytes: Number.MAX_SAFE_INTEGER, letter: '' };
    visiting.add(target);
    let best: Path | undefined;
    for (const def of defs.get(target) ?? []) {
      for (const t of def.tails) if (!best || weight(t) > weight(best)) best = t;
      for (const x of def.xs) {
        const deeper = inside(x.target, depth + 1);
        if (!deeper) continue;
        const path = { text: `${x.name}.${deeper.text}`, bytes: Math.min(Number.MAX_SAFE_INTEGER, x.bytes + 1 + deeper.bytes), letter: deeper.letter };
        if (!best || weight(path) > weight(best)) best = path;
      }
    }
    visiting.delete(target);
    memo.set(target, best);
    return best;
  };
  let longest: FullName | undefined;
  for (const x of top.xs) {
    const deeper = inside(x.target, 1);
    if (!deeper) continue;
    // ngspice puts a part's letter in front: r.x1.r1; a node has none: x1.n1.
    const name = `${deeper.letter ? `${deeper.letter}.` : ''}${x.name}.${deeper.text}`;
    const bytes = Math.min(Number.MAX_SAFE_INTEGER, weight(deeper) + x.bytes + 1);
    if (!longest || bytes > longest.bytes) longest = { name, bytes, line: x.line };
  }
  return longest;
}

// ------------------------------------------------------------------ the names of a .probe line (limit-15)

/**
 * ngspice's get_terminal_name (src/frontend/inpc_probe.c): the name of a part's terminal k (1, 2, …)
 * in the names a .probe line makes: n1 and n2 for most parts, a and c for a diode, d g s for a JFET,
 * d g s b_tj tc n6 n7 for a MOSFET, c b e s t for a bipolar transistor, and the subcircuit's own pin
 * name for an X line.
 */
function terminalName(e: Element, k: number, pins: Map<string, string[]>): string {
  const n = `n${k}`;
  switch (e.key[0]) {
    case 'd':
      return k === 1 ? 'a' : k === 2 ? 'c' : 'nn';
    case 'j':
    case 'z':
      return ['d', 'g', 's'][k - 1] ?? 'nn';
    case 'm':
      return ['d', 'g', 's', 'b_tj', 'tc', 'n6', 'n7'][k - 1] ?? 'nn';
    case 'q':
      return ['c', 'b', 'e', 's', 't'][k - 1] ?? 'nn';
    case 'x': {
      const target = e.fields.find((f) => f.role === 'model')?.token.text.toLowerCase() ?? '';
      return pins.get(target)?.[k - 1] ?? n;
    }
    case 'a':
      return 'nn';
    default:
      return n;
  }
}

/** A name ngspice makes, and its bytes. */
type Named = { text: string; bytes: number };

/** The requests of a .probe line, `what(args)`: the letters just before each ( and the text up to the next ) (in one pass, however long the line). */
function probeRequests(body: string): { what: string; args: string }[] {
  const out: { what: string; args: string }[] = [];
  let from = 0;
  for (let open = body.indexOf('(', from); open >= 0; open = body.indexOf('(', from)) {
    let start = open;
    while (start > from && /[A-Za-z]/.test(body[start - 1]!)) start -= 1;
    if (start === open) {
      from = open + 1;
      continue;
    }
    const close = body.indexOf(')', open + 1);
    if (close < 0) break;
    out.push({ what: body.slice(start, open), args: body.slice(open + 1, close) });
    from = close + 1;
  }
  return out;
}

/** The terminals ngspice puts a 0 V source on for a .probe line: the first two of F, G, S and W, every one of the others. */
const probedTerminals = (e: Element): number => (/^[fgsw]/.test(e.key) ? Math.min(2, e.nodes.length) : e.nodes.length);

/**
 * The longest name alli keeps (or a .probe line with nothing ngspice can read as a request): part#branch for a
 * part with two terminals, part:terminal#branch for each terminal of one with more, for every part but E, H,
 * V, K and A parts and B sources of a voltage (inp_probe). The same for every such line, so worked out once.
 */
function probeAllName(parts: Map<string, { e: Element; code: string }>, pins: Map<string, string[]>): Named | undefined {
  let name: Named | undefined;
  const keep = (text: string): void => {
    const bytes = utf8Bytes(text);
    if (!name || bytes > name.bytes) name = { text, bytes };
  };
  for (const { e, code: line } of parts.values()) {
    if (/^[ehvka]/.test(e.key) || (e.key[0] === 'b' && /v=/i.test(line.replace(/^\S+/, '')))) continue;
    const n = probedTerminals(e);
    if (n === 2) keep(`${e.key}#branch`);
    else for (let k = 1; k <= n; k++) keep(`${e.key}:${terminalName(e, k, pins)}#branch`);
  }
  return name;
}

/**
 * The names ngspice makes for a .probe line (inp_probe and setallvsources, src/frontend/inpc_probe.c),
 * the longest kept as a result's name and the longest a formula holds: i(R1) and alli keep R1#branch
 * or R1:n1#branch, vd(a,b) keeps vd_a:b, vd(R1:1,R2:2) vd_r1:n1_r2:n2, and p(R1) keeps R1:power and
 * writes a formula with i(vcurr_r1:probe_int_n1:1_a) and v(probe_int_a_r1_1) for each terminal.
 * `allName` gives what alli keeps (probeAllName), worked out once for all the .probe lines.
 */
function probeNames(
  code: string,
  parts: Map<string, { e: Element; code: string }>,
  pins: Map<string, string[]>,
  allName: () => Named | undefined,
): { name?: Named; formula?: { part: string; text: string; bytes: number } } {
  let name: Named | undefined;
  let formula: { part: string; text: string; bytes: number } | undefined;
  const keepNamed = (named: Named): void => {
    if (!name || named.bytes > name.bytes) name = named;
  };
  const keep = (text: string): void => keepNamed({ text, bytes: utf8Bytes(text) });
  const write = (part: string, text: string): void => {
    const bytes = utf8Bytes(text);
    if (!formula || bytes > formula.bytes) formula = { part, text, bytes };
  };
  /** A terminal written as a number or as a name: its name, or (a name ngspice maps) the longest the part has. */
  const terminal = (e: Element, written: string): string => {
    if (written === '0') return '0';
    if (/^\d+$/.test(written)) return terminalName(e, Number(written), pins);
    let longest = '';
    for (let k = 1; k <= e.nodes.length; k++) {
      const t = terminalName(e, k, pins);
      if (utf8Bytes(t) > utf8Bytes(longest)) longest = t;
    }
    return longest;
  };
  const body = code.replace(/^\s*\S+/, '');
  const asked = probeRequests(body);
  // alli, or nothing ngspice can read as a request (an empty .probe line too): every part.
  const all = asked.length === 0 || /(^|[^A-Za-z0-9_])alli([^A-Za-z0-9_]|$)/i.test(body);
  if (all) {
    const every = allName();
    if (every) keepNamed(every);
  }
  for (const m of asked) {
    const what = m.what.toLowerCase();
    const args = m.args.split(',').map((a) => a.trim());
    if (what === 'p' || what === 'i') {
      // ngspice reads i(m1:s) as i(m1,s).
      const [first = '', second] = what === 'i' ? args[0]!.split(':').concat(args.slice(1)).map((a) => a.trim()) : [args[0]!];
      const e = parts.get(first.toLowerCase())?.e;
      if (!e) continue;
      if (what === 'i') {
        // The current i(…) keeps: part#branch for two terminals, part:terminal#branch for the one asked for or each of more.
        if (all) continue;
        const n = probedTerminals(e);
        if (second) keep(`${e.key}:${terminal(e, second)}#branch`);
        else if (n === 2) keep(`${e.key}#branch`);
        else for (let k = 1; k <= n; k++) keep(`${e.key}:${terminalName(e, k, pins)}#branch`);
        continue;
      }
      keep(`${e.key}:power`);
      const n = e.key[0] === 'd' ? Math.min(2, e.nodes.length) : probedTerminals(e);
      for (let k = 1; k <= n; k++) {
        const node = e.nodes[k - 1]?.name ?? '';
        write(e.key, `i(vcurr_${e.key}:probe_int_${terminalName(e, k, pins)}:${k}_${node})`);
        write(e.key, `v(probe_int_${node}_${e.key}_${k})`);
      }
      write(e.key, `v(${e.key}probe_int_vref)`);
    } else if (what === 'vd') {
      const pieces = args.map((a) => a.split(':').map((p) => p.trim()));
      if (pieces.every((p) => p.length === 1)) {
        keep(pieces.length > 1 ? `vd_${pieces[0]![0]}:${pieces[1]![0]}` : `vd_${pieces[0]![0]}`);
        continue;
      }
      const named = pieces.map(([part = '', ...terms]) => {
        const e = parts.get(part.toLowerCase())?.e;
        return e ? [part.toLowerCase(), ...terms.map((t) => terminal(e, t))] : [part.toLowerCase(), ...terms];
      });
      keep(named.length > 1 ? `vd_${named.map((p) => p.join(':')).join('_')}` : `vd_${named[0]!.join(':')}`);
    }
  }
  return { ...(name ? { name } : {}), ...(formula ? { formula } : {}) };
}

// ------------------------------------------------------------------ the commands ngspice runs

/**
 * The analysis commands, which ngspice writes with a dot in front into a space of 512 bytes before it runs
 * them (if_run, src/frontend/spiceif.c; limit-6). Other commands are not copied that way: their words keep
 * to the word rules.
 */
const ANALYSES = new Set(['tran', 'ac', 'dc', 'op', 'pz', 'disto', 'adjsen', 'sens', 'tf', 'noise', 'pss', 'sp', 'hb']);
/**
 * The commands that read names through ngspice's expression reader, which takes the blanks out of
 * brackets when the line has a v( or an i( (ft_getpnames_quotes), or through gettoks (meas), which does
 * whenever it has a ( (limit-13).
 */
const READS_NAMES = new Set(['print', 'write', 'wrdata', 'plot', 'asciiplot', 'gnuplot', 'hardcopy', 'xgraph', 'pyplot', 'fourier', 'spec', 'fft', 'psd', 'alter', 'altermod', 'if', 'while', 'dowhile', 'eprint', 'eprvcd']);
const MEASURES = new Set(['meas', 'measure']);
/**
 * The commands that name what a formula gives with the formula's text and copy that name into 512 bytes
 * (vec_basename: print and write, asciiplot through vec_eq, fft, psd and spec for their results; limit-17).
 */
const NAMES_EXPRESSIONS = new Set(['print', 'write', 'asciiplot', 'fft', 'psd', 'spec']);
/** The most bytes of a word of a meas command: ngspice writes it into a space of 100 bytes with its error message (limit-17). */
export const MEAS_BYTES = 50;
/** The operators of ngspice's formulas (PPlex, src/frontend/parse.c, and a few more): characters, and words (gt, lt, …). */
const OPERATOR = /[+\-*/^%,<>=&|~!?:]/;
const WORD_OPERATORS = new Set(['gt', 'lt', 'ge', 'le', 'eq', 'ne', 'and', 'or', 'not']);

/**
 * The formulas of a command's words joined with one blank each (wl_flatten), each with the text ngspice
 * names its result with: from its first word to its last, the blanks between them too (the parser's
 * copy_substring; limit-17). An operand after an operand, outside brackets, starts the next formula, as
 * ngspice's parser takes `print v(a) v(b)+v(c)` as two; where it could join two, they count as one.
 */
function formulasOf(flat: string): Named[] {
  const out: Named[] = [];
  let start = -1;
  let end = -1;
  let depth = 0;
  let afterOperand = false;
  const close = (): void => {
    if (start >= 0) {
      const text = flat.slice(start, end);
      out.push({ text, bytes: utf8Bytes(text) });
    }
    start = -1;
  };
  for (let i = 0; i < flat.length; ) {
    const c = flat[i]!;
    if (SPACE.test(c)) {
      i += 1;
      continue;
    }
    if (c === '(' || c === '[' || c === ')' || c === ']' || OPERATOR.test(c)) {
      if (c === '(' || c === '[') depth += 1;
      else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
      if (start < 0) start = i;
      end = i + 1;
      afterOperand = c === ')' || c === ']';
      i += 1;
      continue;
    }
    let j = i + 1;
    if (c === '"') {
      const close = flat.indexOf('"', i + 1);
      j = close < 0 ? flat.length : close + 1;
    } else while (j < flat.length && !SPACE.test(flat[j]!) && !/[()[\]"]/.test(flat[j]!) && !OPERATOR.test(flat[j]!)) j += 1;
    const operator = WORD_OPERATORS.has(flat.slice(i, j).toLowerCase());
    if (!operator && depth === 0 && afterOperand) close();
    if (start < 0) start = i;
    end = j;
    afterOperand = !operator;
    i = j;
  }
  close();
  return out;
}

/**
 * The formulas of a command that reads them, each as ngspice names its result (ft_getpnames_quotes,
 * src/frontend/parse.c; limit-17): the words joined with one blank each; when they hold a v( or an i(,
 * without the blanks inside brackets, and with quotes around an argument of v(…) or i(…) that starts with a
 * digit or holds an operator (v(1p) is v("1p")); a name with v(" or i(" in it ngspice then writes again
 * without its quotes, in at most 99 bytes. Undefined when a v( has no ) after it: ngspice names nothing then.
 */
function namedFormulas(flat: string): Named[] | undefined {
  if (!/[vViI]\(/.test(flat)) return formulasOf(flat);
  const s = stripInsideParens(traced(flat)).s;
  const quoted = (arg: string): string => (!/^\d*$/.test(arg) && (/^\d/.test(arg) || ARITH.test(arg)) ? `"${arg}"` : arg);
  const out: string[] = [];
  // The first ) at or after a place, which only moves on: looked for again only past the one found, so that
  // i(i(i(… without a ) stays linear.
  let searched = -1;
  let found = -1;
  const closeAfter = (from: number): number => {
    if (searched < 0 || (found >= 0 && from > found)) {
      searched = from;
      found = s.indexOf(')', from);
    }
    return found;
  };
  for (let t = 0; t < s.length; ) {
    const c = s[t]!.toLowerCase();
    const before = s[t - 1];
    if ((c === 'v' || c === 'i') && s[t + 1] === '(' && s[t + 2] !== '"' && (before === undefined || SPACE.test(before) || ARITH.test(before) || before === '.')) {
      const close = closeAfter(t + 2);
      if (close < 0) {
        if (c === 'v') return undefined;
        // "closing ) is missing …, ignored": ngspice reads on from the (, without the i.
        t += 1;
        continue;
      }
      const arg = s.slice(t + 2, close);
      const comma = c === 'v' ? arg.indexOf(',') : -1;
      out.push(`${c}(`, comma < 0 ? quoted(arg) : `${quoted(arg.slice(0, comma))},${quoted(arg.slice(comma + 1))}`);
      t = close;
    }
    out.push(s[t]!);
    t += 1;
  }
  return formulasOf(out.join('')).map((f) => {
    if (!f.text.includes('v("') && !f.text.includes('i("')) return f;
    const text = cutToBytes(f.text.replaceAll('"', ''), 99);
    return { text, bytes: utf8Bytes(text) };
  });
}

/** A command's text with the blanks around each = taken out, as meas reads its words (name=value is one). */
function glueEquals(s: string): string {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== ' ' && s[i] !== '\t') {
      out.push(s[i]!);
      continue;
    }
    let j = i;
    while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j += 1;
    if (s[j] !== '=' && out.at(-1) !== '=') out.push(s.slice(i, j));
    i = j - 1;
  }
  return out.join('');
}

/**
 * First characters ngspice makes '*' in a netlist that is not an *ng_script file (inp_check_syntax: the odd
 * ones with a warning, ';' silently): such a line is a comment, but with a '#' second it is a *# line, a
 * command (limit-18).
 */
const STARRED = new Set(['=', '[', ']', '?', '(', ')', '&', '%', '$', '"', '!', ':', ',', '\f', ';']);

/**
 * The text ngspice runs as a command for a card (its comment cut, its + lines joined), or undefined when it
 * runs none (inp_spsource, src/frontend/inp.c; limit-18). In a netlist: every line of a .control block that is
 * no comment, after .end too, and anywhere a line that starts with *# (or ## or # after one of the characters
 * above, which ngspice makes *), from after the mark and its blanks; a pre_ in front of the command is taken
 * off (ngspice runs it before it reads the circuit). In an *ng_script file: every line but comments, .control,
 * .endc and option lines, a *# line from its third character. A .title or .end line is none: ngspice makes it
 * a comment as it reads it.
 */
function commandText(read: string, code: string, control: boolean, script: boolean): string | undefined {
  const starred = read[0] === '*' || read[0] === '#' || (!script && STARRED.has(read[0] ?? ''));
  if (starred) {
    if (read[1] !== '#') return undefined;
    if (script) return code.slice(2);
  } else if (DOT_TITLE.test(read) || isEndLine(read) || (script ? /^(?:\.control|\.endc|option)/i.test(read) : !control || /^\.(?:control|endc)/i.test(read))) return undefined;
  if (script) return code;
  // A line of a .control block has its blanks made one, quoted or not (but an echo line's); a *# line keeps them.
  const text = starred ? code.slice(2).replace(/^[ \t\n\v\f\r]+/, '') : /^echo/i.test(code) ? code : fewerBlanks(code);
  return /^pre_/i.test(text) ? text.slice(4) : text;
}

/**
 * ngspice's inp_remove_ws (src/frontend/inpcom.c), which it runs on every line of a netlist that is no
 * comment, a .control block's too (limit-19): each run of white space becomes one blank, quoted or not; none
 * is left before or after an =, nor inside { } before or after an operator or a comma.
 */
function fewerBlanks(s: string): string {
  const out: string[] = [];
  let braces = 0;
  let i = 0;
  if (SPACE.test(s[0] ?? '')) out.push(s[i++]!);
  const glued = (c: string | undefined): boolean => c === '=' || (braces > 0 && c !== undefined && (ARITH.test(c) || c === ','));
  while (i < s.length) {
    const c = s[i]!;
    if (c === '{') braces += 1;
    if (c === '}') braces -= 1;
    if (SPACE.test(c)) {
      while (i < s.length && SPACE.test(s[i]!)) i += 1;
      if (i < s.length && !glued(s[i])) out.push(' ');
      continue;
    }
    out.push(c);
    i += 1;
    if (glued(c)) while (i < s.length && SPACE.test(s[i]!)) i += 1;
  }
  return out.join('');
}

/**
 * A command line as ngspice's control reader makes it into words (cp_lexer, src/frontend/parser/lexical.c;
 * limit-19). A blank or a tab ends a word, and a comma outside brackets (which is dropped); < > ; & are words
 * of their own (but <= and >= at a word's start, $& and $<, and a ; inside brackets); '…' keeps what is
 * inside it, blanks too, without the quotes; "…" and `…` keep it with them; a backslash is dropped and the
 * character after it read as any other (so \" starts a quote). A line whose first character is * or # has
 * no words.
 */
function controlWords(text: string): string[] {
  const words: string[] = [];
  let word = '';
  let paren = 0;
  let read = 0;
  let i = 0;
  const next = (): string => (i < text.length ? text[i++]! : '\n');
  const newWord = (): void => {
    if (word !== '') words.push(word);
    word = '';
  };
  /** A character that may be a word of its own: < > ; & (but $<). */
  const add = (c: string): void => {
    const alone = c === '<' || c === '>' || c === ';' || c === '&';
    const glued = alone && c === '<' && word.endsWith('$');
    if (alone && !glued) newWord();
    word += c;
    if (alone && !glued) newWord();
  };
  for (let c = next(); ; ) {
    // An escape character is skipped.
    if (c === '\x1b') {
      c = next();
      continue;
    }
    read += 1;
    if (c === '\\' || c === '\x16') {
      c = next();
      read += 1;
    }
    if ((c === '#' || c === '*') && read === 1) return [];
    if (c === '(' || c === '[') paren += 1;
    else if (c === ')' || c === ']') paren -= 1;
    if (c === '\n') {
      newWord();
      break;
    }
    /** The character that ended a quote early (the end of the line, an escape), handled again as ngspice does. */
    let again: string | undefined;
    if (c === ' ' || c === '\t') newWord();
    else if (c === "'") {
      for (let q = next(); q !== "'"; q = next()) {
        if (q === '\n' || q === '\x1b') {
          again = q;
          break;
        }
        word += q;
      }
    } else if (c === '"' || c === '`') {
      word += c;
      for (let q = next(); ; q = next()) {
        if (q === c) {
          word += c;
          break;
        }
        if (q === '\n' || q === '\x1b') {
          again = q;
          break;
        }
        word += q === '\\' ? next() : q;
      }
    } else if (c === ',' && paren < 1 && word !== '') newWord();
    else if (c === ';' && paren > 0) word += c;
    else if (c === '&' && word.endsWith('$')) word += c;
    else if ((c === '<' || c === '>') && word === '' && text[i] === '=') word += c;
    else add(c);
    c = again ?? next();
  }
  return words;
}

/** The commands of a line's words, as docommand runs them: a ';' word ends one. */
function commandsOf(words: string[]): string[][] {
  const commands: string[][] = [];
  let command: string[] = [];
  for (const w of words) {
    if (w !== ';') command.push(w);
    else if (command.length) {
      commands.push(command);
      command = [];
    }
  }
  if (command.length) commands.push(command);
  return commands;
}

/**
 * How many words ngspice makes of a command's word as it expands its braces (cp_doglob, brac1 and brac2,
 * src/frontend/parser/glob.c): {a,b} one for each choice, {…}{…} one for each pair, nested braces too; -1
 * when a { has no } (ngspice then runs nothing of the line: "Error: missing }."). Counted up to 2 ** 30.
 */
function braceWords(word: string): number {
  const most = 2 ** 30;
  /** For each open brace, the choices before the last comma; and the words of each sequence so far, outermost first. */
  const choices: number[] = [];
  const sequence: number[] = [1];
  for (let i = word.indexOf('{'); i >= 0 && i < word.length; i++) {
    const c = word[i];
    if (c === '{') {
      choices.push(0);
      sequence.push(1);
    } else if (c === ',' && choices.length) {
      choices[choices.length - 1] = Math.min(most, choices.at(-1)! + sequence.pop()!);
      sequence.push(1);
    } else if (c === '}' && choices.length) {
      const all = Math.min(most, choices.pop()! + sequence.pop()!);
      sequence[sequence.length - 1] = Math.min(most, sequence.at(-1)! * all);
    }
  }
  return choices.length ? -1 : sequence[0]!;
}

/** A word with each pair of braces taken out, as ngspice expands it when every pair holds one choice. */
function withoutBraces(word: string): string {
  if (!word.includes('{')) return word;
  const drop = new Set<number>();
  const open: number[] = [];
  for (let i = 0; i < word.length; i++) {
    if (word[i] === '{') open.push(i);
    else if (word[i] === '}' && open.length) {
      drop.add(open.pop()!);
      drop.add(i);
    }
  }
  const out: string[] = [];
  for (let i = 0; i < word.length; i++) if (!drop.has(i)) out.push(word[i]!);
  return out.join('');
}

/** Our engine's home folder, which ngspice puts in place of a ~ that starts a command's word (cp_doglob; `echo ~` gives it): 14 bytes (limit-19). */
const HOME = '/home/web_user';

// ------------------------------------------------------------------ what ngspice cannot take

/** Lines whose words ngspice keeps as names to save or print (gettoks and parseSpecial, limit-4). */
const SAVING = new Set(['.save', '.print', '.plot', '.four', '.fourier', '.probe', '.meas', '.measure', '.sndprint', '.sndparam']);
/** Of those, the lines ngspice reads with gettoks, which takes the blanks out of their brackets first (limit-13). */
const GETTOKS = new Set(['.save', '.print', '.plot', '.four', '.fourier', '.meas', '.measure', '.sndprint', '.sndparam']);
/** Parts whose line ngspice reads as a formula when it has { } or =, turning it into a B source (inp_compat, limit-5). */
const FORMULA_LETTERS = new Set(['E', 'G', 'F', 'H', 'R', 'C', 'L']);
/** Where a v( or i( starts in a formula: not inside a longer name (inp_modify_exp, limit-5). */
const OPENING = /(?<![A-Za-z0-9_!#$%[\]])[vi]\(/gi;
/** "version" on a .model line, and the word ngspice reads after it (INPfindVer: blanks, = , ( ) + skipped, then up to a blank; limit-9). */
const VERSION = /version[ \t=,()+]*([^ \t\n\v\f\r]*)/gi;
/** ngspice's is_arith_char (src/misc/string.c). */
const ARITH = /[+\-*/()<>?:|&^!%\\]/;

/**
 * Each v( or i( of a formula's code, with the ) that ends it for ngspice (-1: none) and its length in
 * bytes, in passes over the code that do not grow with the number of v( (limit-5). Inside { }, ngspice
 * reads the expression alone, so its ) must come before the }.
 */
function formulaRuns(code: string): { at: number; close: number; bytes: number }[] {
  const n = code.length;
  const nextClose = new Int32Array(n + 1).fill(-1);
  const nextShut = new Int32Array(n + 1).fill(-1);
  for (let i = n - 1; i >= 0; i--) {
    nextClose[i] = code[i] === ')' ? i : nextClose[i + 1]!;
    nextShut[i] = code[i] === '}' ? i : nextShut[i + 1]!;
  }
  // The bytes of UTF-8 before each place (a surrogate pair counts 4, at its first half).
  const before = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) before[i + 1] = before[i]! + unitBytes(code, i);
  const out: { at: number; close: number; bytes: number }[] = [];
  let lastOpen = -1;
  let lastShut = -1;
  let k = 0;
  for (const m of code.matchAll(OPENING)) {
    const at = m.index;
    for (; k < at; k++) {
      if (code[k] === '{') lastOpen = k;
      else if (code[k] === '}') lastShut = k;
    }
    const shut = lastOpen > lastShut ? nextShut[at]! : -1;
    const found = nextClose[at]!;
    const close = found >= 0 && (shut < 0 || found < shut) ? found : -1;
    out.push({ at, close, bytes: close < 0 ? 0 : before[close + 1]! - before[at]! });
  }
  return out;
}

/**
 * A part's line that inp_meas_current rewrites (src/frontend/inpcom.c): one with an i(…) of a part that
 * is not a voltage source, after an operator, a {, an = or a blank. ngspice then takes the blanks out
 * of every bracket of the line (limit-13).
 */
function measuresCurrent(stripped: string): boolean {
  const s = stripped.toLowerCase();
  for (let at = s.indexOf('i(', 1); at > 0; at = s.indexOf('i(', at + 1)) {
    const before = s[at - 1]!;
    if (before === '%' && s[0] === 'a') continue;
    if ((ARITH.test(before) || before === '{' || before === '=' || SPACE.test(before)) && s[at + 2] !== 'v') return true;
  }
  return false;
}

/** The line that ends a circuit built with circbyline: ngspice then reads it (create_circbyline). */
const CIRCUIT_END = /^\.end(?:[ \t]|$)/i;

/**
 * The first thing in the netlist that ngspice cannot take, by line. `lineOf` gives the line of the
 * student's text for a line of this netlist: a circuit made of circbyline commands is checked as the
 * netlist ngspice reads from them (limit-12), and its problems are said at the commands' lines. Such a
 * circuit is checked once (`built`): a circbyline command inside it is refused, and each of its .title
 * lines is measured as its title (limit-16). Every line ngspice runs as a command (limit-18) is checked
 * as its words are when ngspice runs it (limit-19).
 */
export function whyNotRun(netlist: Netlist, lineOf: (line: number) => number = (line) => line, built = false): NotRun | undefined {
  const found: NotRun[] = [];
  const note = (line: number, reason: string): void => void found.push({ line, reason });
  const script = /^\*ng_script/i.test(asRead(netlist.lines[0]?.text ?? ''));
  const cards = cardsOf(netlist);
  const textBytes = stringParameters(cards);
  /** The circuit lines of circbyline commands, as ngspice joins their words, and the lines they are on. */
  const circuit: { text: string; line: number }[] = [];
  /** The parts outside every subcircuit, and each subcircuit's pins, for the names a .probe line makes. */
  const parts = new Map<string, { e: Element; code: string }>();
  const pins = new Map<string, string[]>();
  let depth = 0;
  for (const { line, code } of cards) {
    const d = line.directive?.name;
    if (d === '.subckt') {
      if (depth === 0) {
        const words = code.split(SPACES).filter(Boolean);
        const own: string[] = [];
        for (let k = 2; k < words.length && !/^params:/i.test(words[k]!) && !words[k]!.includes('=') && !words[k + 1]?.startsWith('='); k++) own.push(words[k]!.toLowerCase());
        pins.set(words[1]?.toLowerCase() ?? '', own);
      }
      depth += 1;
    } else if (d === '.ends') depth = Math.max(0, depth - 1);
    else if (depth === 0 && line.element) parts.set(line.element.key, { e: line.element, code });
  }
  /** A netlist that sets noquotesinoutput: ngspice then names a formula with the blanks inside its brackets (limit-17). */
  const noQuotes = /noquotesinoutput/i.test(netlist.text);
  // What alli keeps is the same for every .probe line: worked out once, at the first that needs it.
  let every: { name: Named | undefined } | undefined;
  const allName = (): Named | undefined => (every ??= { name: probeAllName(parts, pins) }).name;

  /**
   * What is wrong with one command, as ngspice runs it: its words as the control reader makes them, with the
   * braces and a leading ~ expanded unless the line starts with circbyline (`glob`; limit-19). circbyline
   * commands keep their line for the circuit they build.
   */
  const commandProblem = (words: string[], number: number, glob: boolean): string | undefined => {
    if (glob) {
      // limit-19: a word for each choice in braces, which the line does not show.
      const many = words.find((w) => braceWords(w) > 1);
      if (many !== undefined) return S.braceChoices(number, many);
    }
    const said = glob ? words.map((w) => withoutBraces(w)).map((w) => (w.startsWith('~') ? `${HOME}${w.slice(1)}` : w)) : words;
    const first = said[0]!.toLowerCase();
    if (first === 'circbyline') {
      // limit-16: ngspice cannot build a circuit while it reads one it built.
      if (built) return S.nestedCircuit(number);
      circuit.push({ text: said.slice(1).join(' '), line: number });
      return undefined;
    }
    const flat = said.join(' ');
    // limit-6: an analysis command, written with a dot in front into 512 bytes.
    if (ANALYSES.has(first)) {
      const bytes = 1 + utf8Bytes(flat);
      if (bytes > RUN_BYTES) return S.longCommand(number, first, bytes);
    }
    // limit-13: a command that reads names without the blanks inside brackets.
    if ((READS_NAMES.has(first) && /[vi]\(/i.test(flat)) || (MEASURES.has(first) && flat.includes('('))) {
      const joined = wordOver(stripInsideParens(traced(flat)), NAME_END_CHAR, WORD_BYTES, flat);
      if (joined) return S.joinedWord(number, joined.word, joined.bytes);
    }
    // limit-17: print, write, asciiplot, fft, psd and spec name what a formula gives with its words, a name like any other.
    if (NAMES_EXPRESSIONS.has(first)) {
      const args = said.slice(1).join(' ');
      // With `set noquotesinoutput` somewhere, the blanks inside brackets may stay: either way counts.
      const named = [...(namedFormulas(args) ?? []), ...(noQuotes ? formulasOf(args) : [])];
      const long = named.find((f) => f.bytes > WORD_BYTES);
      if (long) return S.longExpression(number, first, long.text, long.bytes);
    }
    // limit-17: a meas command's words (a name=value as one), written with an error message into 100 bytes.
    if (MEASURES.has(first)) {
      const word = stripInsideParens(traced(glueEquals(flat)))
        .s.split(SPACES)
        .slice(1)
        .find((w) => utf8Bytes(w) > MEAS_BYTES);
      if (word !== undefined) return S.longMeasWord(number, word, utf8Bytes(word));
    }
    return undefined;
  };

  for (const card of cards) {
    const { line, code } = card;
    // limit-18: the text ngspice runs as a command, if it runs this line as one.
    const commandLine = line.index > 0 ? commandText(asRead(line.text), code, card.control, script) : undefined;
    if (commandLine === undefined && (line.kind === 'blank' || line.kind === 'comment' || isTitleLine(line.text, line.index))) {
      // limit-16: a .title line of a circuit built with circbyline gives that circuit its title.
      if (built && line.index > 0 && DOT_TITLE.test(line.text)) {
        const bytes = utf8Bytes(line.text.slice(titleStart(line.text, line.index)));
        if (bytes > TITLE_BYTES) note(lineOf(line.number), S.circuitDotTitle(lineOf(line.number), bytes));
      }
      continue;
    }
    const number = lineOf(line.number);
    const d = line.directive?.name;
    // limit-3 to limit-7: every name, as ngspice ends it in a formula or a list (the comment cut first, which
    // ngspice never reads).
    const long = code.split(NAME_END).find((w) => utf8Bytes(w) > WORD_BYTES);
    if (long !== undefined) {
      note(number, S.longWord(number, long, utf8Bytes(long)));
      continue;
    }
    if (commandLine !== undefined) {
      // limit-18, limit-19: each command of the line, as ngspice's control reader makes its words; it expands
      // braces and a ~ unless the line's first word is circbyline, for all of the line's commands.
      const words = controlWords(commandLine);
      const glob = words[0] !== 'circbyline';
      for (const command of commandsOf(words)) {
        const problem = commandProblem(command, number, glob);
        if (problem) {
          note(number, problem);
          break;
        }
      }
      continue;
    }
    // limit-14: the text numparam puts in place of each {…}, a word of its own (not in the lines that define
    // parameters, .param and .subckt, whose texts are checked where they are used).
    const braces = d === '.param' || d === '.subckt' ? [] : bracesOf(code, textBytes);
    const longText = braces.find((b) => b.string && b.bytes > WORD_BYTES);
    if (longText) {
      note(number, S.longText(number, code.slice(longText.from, longText.to), longText.bytes));
      continue;
    }
    // limit-3, limit-5, limit-7: a part's name and first nodes as ngspice takes them (the fourth word of F and H: the
    // source whose current they read).
    if (line.kind === 'element' && line.element) {
      const heads = gettokWords(code, line.element.letter === 'F' || line.element.letter === 'H' ? 4 : 3);
      const head = heads.find((w) => utf8Bytes(w) > WORD_BYTES);
      if (head !== undefined) {
        note(number, S.longWord(number, head, utf8Bytes(head)));
        continue;
      }
    }
    // limit-4: the names a .save (or .print …) line asks for, whole; limit-13: as gettoks reads them, without the
    // blanks inside brackets, and limit-14 with the texts and numbers numparam puts in place of {…}.
    if (d && SAVING.has(d)) {
      const word = code.split(SPACES).find((w) => utf8Bytes(w) > WORD_BYTES);
      if (word !== undefined) {
        note(number, S.longWord(number, word, utf8Bytes(word)));
        continue;
      }
      if (GETTOKS.has(d)) {
        const joined = wordOver(stripInsideParens(withTexts(code, braces)), SPACE, WORD_BYTES, code);
        if (joined) {
          // A number in {…} is counted at its longest, 23 bytes: the word is up to that long.
          const numbers = braces.some((b) => !b.string && b.from < joined.to && b.to > joined.from);
          note(number, S.joinedWord(number, joined.word, joined.bytes, numbers));
          continue;
        }
      }
    }
    // limit-13: a part's line with an i(…) that ngspice turns into a 0 V source's current, without the blanks
    // inside its brackets (before numparam, so the {…} as written).
    if (line.kind === 'element' && /i\(/i.test(code)) {
      const stripped = stripInsideParens(traced(code));
      if (measuresCurrent(stripped.s)) {
        const joined = wordOver(stripped, NAME_END_CHAR, WORD_BYTES, code);
        if (joined) {
          note(number, S.joinedWord(number, joined.word, joined.bytes));
          continue;
        }
      }
    }
    // limit-9: a .model line's version, whole up to a blank; limit-14: a {…} there is the text numparam puts in
    // its place, with a blank on each side.
    if (d === '.model') {
      const at = new Map(braces.map((b) => [b.from, b]));
      let problem: string | undefined;
      for (const m of code.matchAll(VERSION)) {
        const b = at.get(m.index + m[0].length - m[1]!.length);
        if (b) {
          if (b.bytes > VERSION_BYTES) problem = S.longTextVersion(number, code.slice(b.from, b.to), b.bytes);
        } else {
          // Up to a {…}, before which numparam puts a blank.
          const version = m[1]!.split('{')[0]!;
          if (utf8Bytes(version) > VERSION_BYTES) problem = S.longVersion(number, version, utf8Bytes(version));
        }
        if (problem) break;
      }
      if (problem) {
        note(number, problem);
        continue;
      }
    }
    // limit-15: the names a .probe line makes, and the formula it writes for p(…).
    if (d === '.probe') {
      const made = probeNames(code, parts, pins, allName);
      if (made.formula && made.formula.bytes > RUN_BYTES) {
        note(number, S.probeFormula(number, made.formula.part, made.formula.text, made.formula.bytes));
        continue;
      }
      if (made.name && made.name.bytes > WORD_BYTES) {
        note(number, S.probeName(number, made.name.text, made.name.bytes));
        continue;
      }
    }
    // limit-5: a formula's v( … ) and i( … ), each copied whole up to its ). Without a ), ngspice reads on past
    // the end of the line in a B source, an E or G source with a formula, and a .model with temper; in
    // other lines it stops with its own message.
    const letter = line.element?.letter;
    const formula =
      letter === 'B' ||
      (letter !== undefined && FORMULA_LETTERS.has(letter) && /[{=]/.test(code)) ||
      d === '.func' ||
      ((line.kind === 'element' || d === '.model') && /temper/i.test(code));
    const readsToClose = letter === 'B' || ((letter === 'E' || letter === 'G') && /[{=]|table/i.test(code)) || (d === '.model' && /temper/i.test(code));
    if (formula) {
      let problem: string | undefined;
      for (const { at, close, bytes } of formulaRuns(code)) {
        if (close < 0) {
          if (readsToClose) problem = S.noClose(number, code.slice(at, at + 2));
          break;
        }
        if (bytes > RUN_BYTES) {
          problem = S.longRun(number, code.slice(at, close), bytes);
          break;
        }
      }
      if (problem) note(number, problem);
    }
  }
  // limit-3, limit-7, limit-10: the names ngspice makes inside subcircuits, saved as currents (with
  // .options savecurrents, which PlainSpice adds for .op, or .save alli) or printed by a .control block.
  const nodeBytes = (name: string): number => {
    const b = name.startsWith('{') ? bracesOf(name, textBytes)[0] : undefined;
    return b?.string && b.to === name.length ? b.bytes : utf8Bytes(name);
  };
  const longest = longestFullName(netlist, nodeBytes);
  if (longest && longest.bytes > WORD_BYTES) note(lineOf(longest.line), S.longFullName(lineOf(longest.line), shown(longest.name), longest.bytes));
  // limit-12: ngspice reads the lines of circbyline commands as a netlist, which meets the same spaces, one
  // circuit at each .end; limit-16: the first line is that circuit's title.
  const circuits: { text: string; line: number }[][] = [];
  let current: { text: string; line: number }[] = [];
  for (const c of circuit) {
    if (c.text.trim() === '') continue;
    current.push(c);
    if (CIRCUIT_END.test(c.text.trim())) {
      circuits.push(current);
      current = [];
    }
  }
  if (current.length) circuits.push(current);
  for (const lines of circuits) {
    const title = utf8Bytes(lines[0]!.text.trim());
    if (title > TITLE_BYTES) {
      found.push({ line: lines[0]!.line, reason: S.circuitTitle(lines[0]!.line, title) });
      continue;
    }
    const inside = whyNotRun(parseNetlist(lines.map((c) => c.text).join('\n')), (line) => lines[line - 1]?.line ?? lines[0]!.line, true);
    if (inside) found.push(inside);
  }
  return found.sort((a, b) => a.line - b.line)[0];
}

// ------------------------------------------------------------------ the copy

/**
 * The text with each title cut to its first 504 bytes, between two characters (limit-1, limit-2): line
 * 1 whole, and a .title line's words after .title. What was cut, a sentence each. Every line keeps its place.
 */
export function cutTitles(text: string): { text: string; notes: string[] } {
  const notes: string[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isTitleLine(line, i)) continue;
    const start = titleStart(line, i);
    const bytes = utf8Bytes(line.slice(start));
    if (bytes <= TITLE_BYTES) continue;
    const kept = cutToBytes(line.slice(start), TITLE_BYTES);
    lines[i] = line.slice(0, start) + kept;
    notes.push(S.titleCut(i + 1, bytes, utf8Bytes(kept)));
  }
  return { text: notes.length ? lines.join('\n') : text, notes };
}

/**
 * A + line after .end that ngspice joins to a line before .end (limit-18): .end is a comment to it, so the + line
 * continues the last line before it, which a line added just before .end would take its place as.
 */
function joinsAcrossEnd(netlist: Netlist, end: number): boolean {
  for (let i = end + 1; i < netlist.lines.length; i++) {
    const read = asRead(netlist.lines[i]!.text);
    if (read.startsWith('+')) return true;
    if (!/^[#$*]/.test(read) && withoutComment(read, false).trim() !== '' && !DOT_TITLE.test(read) && !isEndLine(read)) return false;
  }
  return false;
}

export function netlistToRun(netlist: Netlist): NetlistToRun {
  const notRun = whyNotRun(netlist);
  const { text, notes } = cutTitles(netlist.text);
  const done = (added: string[], copy: string): NetlistToRun => (notRun ? { text: copy, added, notes, notRun } : { text: copy, added, notes });
  const hasOp = netlist.analyses.some((i) => netlist.lines[i]?.directive?.name === '.op');
  // With a + line right after .end, the line would change what ngspice reads: it runs without it (every
  // voltage is the same, A2), as the student wrote it.
  if (!hasOp || hasSaveCurrents(netlist) || (netlist.end !== undefined && joinsAcrossEnd(netlist, netlist.end))) return done([], text);
  const end = netlist.end === undefined ? undefined : netlist.lines[netlist.end];
  if (end) {
    // Where .end starts in the copy, after any title cut before it (every line keeps its place).
    const at = text.split('\n', end.index).reduce((n, l) => n + l.length + 1, 0);
    return done([SAVE_CURRENTS_LINE], `${text.slice(0, at)}${SAVE_CURRENTS_LINE}\n${text.slice(at)}`);
  }
  const gap = text === '' || text.endsWith('\n') ? '' : '\n';
  return done([SAVE_CURRENTS_LINE], `${text}${gap}${SAVE_CURRENTS_LINE}\n`);
}

/** The text to give ngspice, or an error that says why PlainSpice does not run it. */
export function textToRun(netlist: Netlist): string {
  const run = netlistToRun(netlist);
  if (run.notRun) throw new Error(run.notRun.reason);
  return run.text;
}

export { S as RUN_COPY_WORDS };
