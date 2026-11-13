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
 * - **The title.** Line 1, and any `.title` line, keeps at most its first 504 bytes: ngspice writes
 *   the title into a space of 513 bytes when it writes its results file, and stops on a longer one
 *   (limit-1). Only the title is cut, so the numbers are those of the whole netlist (limit-2).
 * - **Names that do not fit.** ngspice copies names into spaces of fixed size in several places,
 *   sometimes two of them into one, without checking their length (limit-3 to limit-7, limit-9,
 *   limit-10). Past the end of the space, native ngspice stops ("buffer overflow detected", "stack
 *   smashing detected") or runs on with its memory overwritten, and PlainSpice's engine runs on,
 *   gives no results or crashes. So PlainSpice does not give ngspice a netlist with such a name
 *   (`notRun`, with the line and why): the student shortens it. No real netlist comes near these
 *   lengths; a link can.
 *
 * The ngspice output tab lists what PlainSpice added and changed (`added`, `notes`).
 */
import type { Netlist, NetlistLine } from './types.ts';

export const SAVE_CURRENTS_LINE = '.options savecurrents';

/** The most bytes of a title ngspice can write to its results file: "Title: " + 504 + newline + end = 513 (limit-1). */
export const TITLE_BYTES = 504;
/**
 * The most bytes of a name PlainSpice gives ngspice, as written or as ngspice names it inside
 * subcircuits (r.x1.x2.r1): two of them, or one and the words around it, fit in 512 (limit-3 to
 * limit-7, limit-10).
 */
export const WORD_BYTES = 250;
/** The most bytes of a v(…) in a formula or of a .control line (limit-5, limit-6). */
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
  titleCut: (line: number, bytes: number): string =>
    `PlainSpice cut the title on line ${line} from ${bytes} to ${TITLE_BYTES} bytes in the copy ngspice ran: ngspice copies the title into a space of 513 bytes when it writes its results file, and stops on a longer one. A plain letter is one byte; ş or é is two. Your netlist keeps the whole title.`,
  longWord: (line: number, word: string, bytes: number): string =>
    `Line ${line} has a word of ${bytes} bytes (${shown(word)}). PlainSpice gives ngspice words of at most ${WORD_BYTES} bytes: ngspice copies names into spaces of 512 bytes, sometimes two names into one, and writes past the end with longer ones, so its results could not be trusted. Shorten the word.`,
  noClose: (line: number, open: string): string =>
    `Line ${line}: the ${open} in this formula has no ) after it. ngspice would look for the ) past the end of the line and write over its own memory, so PlainSpice did not run it. Add the ).`,
  longRun: (line: number, run: string, bytes: number): string =>
    `Line ${line}: ${shown(run)}) is ${bytes} bytes long from ${run.slice(0, 2)} to ). ngspice copies it into a space of 512 bytes when it reads a formula, so PlainSpice gives it at most ${RUN_BYTES}. Shorten the names in it.`,
  longCommand: (line: number, bytes: number): string =>
    `Line ${line} is a command for ngspice of ${bytes} bytes. ngspice copies a command into a space of 512 bytes, so PlainSpice gives it commands of at most ${RUN_BYTES} bytes. Split the line or shorten it.`,
  longFullName: (line: number, name: string, bytes: number): string =>
    `Line ${line}: inside the subcircuits of this X line, ngspice names a part or a node ${name}, ${bytes} bytes (the names of the X lines, then its own). PlainSpice gives ngspice names of at most ${WORD_BYTES} bytes, these too: ngspice copies such a name, and a few more characters, into a space of 512 bytes when it saves a current or prints it. Shorten the names of the X lines, or of the parts and nodes in the subcircuits.`,
  longVersion: (line: number, version: string, bytes: number): string =>
    `Line ${line}: the version on this .model line, ${shown(version)}, is ${bytes} bytes. ngspice copies it into a space of 100 bytes when a part uses the model, so PlainSpice gives it at most ${VERSION_BYTES}. Shorten it.`,
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

/** A .title line: its first word starts with .title (in any case, after blanks or a byte order mark), anywhere, even after .end (limit-1). */
const DOT_TITLE = /^[﻿ \t\v\f\r]*\.title/i;
/** A title line for ngspice: line 1, and any .title line (limit-1). */
const isTitleLine = (text: string, index: number): boolean => index === 0 || DOT_TITLE.test(text);

/**
 * Where a title line's title starts: ngspice takes a .title line's words after the first one (and the
 * blanks after it), and line 1 whole (limit-1).
 */
function titleStart(text: string): number {
  if (!DOT_TITLE.test(text)) return 0;
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
}

function cardsOf(netlist: Netlist): Card[] {
  const cards = new Map<number, Card>();
  const out: Card[] = [];
  // Every line of an *ng_script file is a command, as in a .control block (from .control to the line before .endc).
  const script = /^\*ng_script/i.test(asRead(netlist.lines[0]?.text ?? ''));
  let control = false;
  for (const line of netlist.lines) {
    const read = asRead(line.text);
    if (/^\.control/i.test(read)) control = true;
    if (/^\.endc/i.test(read)) control = false;
    // ngspice cuts no comment from line 1, the title.
    const code = line.index === 0 ? line.text : withoutComment(read, control || script);
    // A + line is checked on its own after a title line, whose words are cut, not checked.
    const head = line.kind === 'continuation' && line.continues !== undefined ? cards.get(line.continues) : undefined;
    if (head && !isTitleLine(head.line.text, head.line.index)) {
      head.text += ` ${line.text.replace(/^\s*\+/, '')}`;
      head.code += ` ${code.replace(/^\+/, '')}`;
      continue;
    }
    const card = { line, text: line.text, code };
    cards.set(line.index, card);
    out.push(card);
  }
  return out;
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
 * the subcircuit the name outside: a little longer than ngspice's, never shorter.
 */
export function longestFullName(netlist: Netlist): FullName | undefined {
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
    for (const node of e.nodes) if (!node.ground) here.tails.push({ text: node.name, bytes: utf8Bytes(node.name), letter: '' });
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

// ------------------------------------------------------------------ what ngspice cannot take

/** Lines whose words ngspice keeps as names to save or print (gettoks and parseSpecial, limit-4). */
const SAVING = new Set(['.save', '.print', '.plot', '.four', '.fourier', '.probe', '.meas', '.measure', '.sndprint', '.sndparam']);
/** Parts whose line ngspice reads as a formula when it has { } or =, turning it into a B source (inp_compat, limit-5). */
const FORMULA_LETTERS = new Set(['E', 'G', 'F', 'H', 'R', 'C', 'L']);
/** Where a v( or i( starts in a formula: not inside a longer name (inp_modify_exp, limit-5). */
const OPENING = /(?<![A-Za-z0-9_!#$%[\]])[vi]\(/gi;
/** "version" on a .model line, and the word ngspice reads after it (INPfindVer: blanks, = , ( ) + skipped, then up to a blank; limit-9). */
const VERSION = /version[ \t=,()+]*([^ \t\n\v\f\r]*)/gi;

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
  for (let i = 0; i < n; i++) {
    const c = code.charCodeAt(i);
    const pair = c >= 0xd800 && c <= 0xdbff && i + 1 < n && (code.charCodeAt(i + 1) & 0xfc00) === 0xdc00;
    const low = c >= 0xdc00 && c <= 0xdfff && i > 0 && (code.charCodeAt(i - 1) & 0xfc00) === 0xd800;
    before[i + 1] = before[i]! + (pair ? 4 : low ? 0 : utf8(c));
  }
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

/** The first thing in the netlist that ngspice cannot take, by line. */
export function whyNotRun(netlist: Netlist): NotRun | undefined {
  const found: NotRun[] = [];
  const note = (line: number, reason: string): void => void found.push({ line, reason });
  const script = /^\*ng_script/i.test(asRead(netlist.lines[0]?.text ?? ''));
  for (const { line, text, code } of cardsOf(netlist)) {
    if (line.kind === 'blank' || line.kind === 'comment' || isTitleLine(line.text, line.index)) continue;
    const number = line.number;
    // limit-3 to limit-7: every name, as ngspice ends it in a formula or a list.
    const long = text.split(NAME_END).find((w) => utf8Bytes(w) > WORD_BYTES);
    if (long !== undefined) {
      note(number, S.longWord(number, long, utf8Bytes(long)));
      continue;
    }
    // limit-3, limit-5, limit-7: a part's name and first nodes as ngspice takes them (the fourth word of F and H: the
    // source whose current they read).
    if (line.kind === 'element' && line.element) {
      const heads = gettokWords(text, line.element.letter === 'F' || line.element.letter === 'H' ? 4 : 3);
      const head = heads.find((w) => utf8Bytes(w) > WORD_BYTES);
      if (head !== undefined) {
        note(number, S.longWord(number, head, utf8Bytes(head)));
        continue;
      }
    }
    // limit-4: the names a .save (or .print …) line asks for, whole.
    if (line.directive && SAVING.has(line.directive.name)) {
      const word = text.split(SPACES).find((w) => utf8Bytes(w) > WORD_BYTES);
      if (word !== undefined) {
        note(number, S.longWord(number, word, utf8Bytes(word)));
        continue;
      }
    }
    // limit-9: a .model line's version, whole up to a blank (the whole line is searched, its comment too: a little
    // more than ngspice reads, never less).
    if (line.directive?.name === '.model') {
      const version = [...text.matchAll(VERSION)].map((m) => m[1]!).find((v) => utf8Bytes(v) > VERSION_BYTES);
      if (version !== undefined) {
        note(number, S.longVersion(number, version, utf8Bytes(version)));
        continue;
      }
    }
    // limit-5: a formula's v( … ) and i( … ), each copied whole up to its ). Without a ), ngspice reads on past
    // the end of the line in a B source, an E or G source with a formula, and a .model with temper; in
    // other lines it stops with its own message.
    const letter = line.element?.letter;
    const formula =
      letter === 'B' ||
      (letter !== undefined && FORMULA_LETTERS.has(letter) && /[{=]/.test(text)) ||
      line.directive?.name === '.func' ||
      ((line.kind === 'element' || line.directive?.name === '.model') && /temper/i.test(text));
    const readsToClose =
      letter === 'B' || ((letter === 'E' || letter === 'G') && /[{=]|table/i.test(code)) || (line.directive?.name === '.model' && /temper/i.test(code));
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
      if (problem) {
        note(number, problem);
        continue;
      }
    }
    // limit-6: a command of a .control block (every line of an *ng_script file is one), copied whole.
    if (line.kind === 'control' || (script && line.index > 0)) {
      const bytes = utf8Bytes(text);
      if (bytes > RUN_BYTES) note(number, S.longCommand(number, bytes));
    }
  }
  // limit-3, limit-7, limit-10: the names ngspice makes inside subcircuits, saved as currents (with
  // .options savecurrents, which PlainSpice adds for .op, or .save alli) or printed by a .control block.
  const longest = longestFullName(netlist);
  if (longest && longest.bytes > WORD_BYTES) note(longest.line, S.longFullName(longest.line, shown(longest.name), longest.bytes));
  return found.sort((a, b) => a.line - b.line)[0];
}

// ------------------------------------------------------------------ the copy

/**
 * The text with each title cut to its first 504 bytes, between two characters (limit-1, limit-2), and
 * what was cut, a sentence each. Every line keeps its place.
 */
export function cutTitles(text: string): { text: string; notes: string[] } {
  const notes: string[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isTitleLine(line, i)) continue;
    const start = titleStart(line);
    const bytes = utf8Bytes(line.slice(start));
    if (bytes <= TITLE_BYTES) continue;
    lines[i] = line.slice(0, start) + cutToBytes(line.slice(start), TITLE_BYTES);
    notes.push(S.titleCut(i + 1, bytes));
  }
  return { text: notes.length ? lines.join('\n') : text, notes };
}

export function netlistToRun(netlist: Netlist): NetlistToRun {
  const notRun = whyNotRun(netlist);
  const { text, notes } = cutTitles(netlist.text);
  const done = (added: string[], copy: string): NetlistToRun => (notRun ? { text: copy, added, notes, notRun } : { text: copy, added, notes });
  const hasOp = netlist.analyses.some((i) => netlist.lines[i]?.directive?.name === '.op');
  if (!hasOp || hasSaveCurrents(netlist)) return done([], text);
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
