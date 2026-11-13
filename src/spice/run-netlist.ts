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
 *   lines: "line N" in ngspice's messages still points at line N of the editor. It is left out
 *   when a part's full name inside subcircuits is too long for ngspice to save its current (limit-3).
 * - **The title.** Line 1, and any `.title` line, keeps at most its first 504 bytes: ngspice writes
 *   the title into a space of 513 bytes when it writes its results file, and stops on a longer one
 *   (limit-1). Only the title is cut, so the numbers are those of the whole netlist (limit-2).
 * - **Words that do not fit.** ngspice copies names into spaces of 512 bytes in several places,
 *   sometimes two of them into one, without checking their length (limit-3 to limit-7). Past the end of the
 *   space, native ngspice stops ("buffer overflow detected", "stack smashing detected") or runs on
 *   with its memory overwritten, and PlainSpice's engine runs on, gives no results or crashes. So
 *   PlainSpice does not give ngspice a netlist with such a word (`notRun`, with the line and why):
 *   the student shortens it. No real netlist comes near these lengths; a link can.
 *
 * The ngspice output tab lists what PlainSpice added and changed (`added`, `notes`).
 */
import type { Netlist, NetlistLine } from './types.ts';

export const SAVE_CURRENTS_LINE = '.options savecurrents';

/** The most bytes of a title ngspice can write to its results file: "Title: " + 504 + newline + end = 513 (limit-1). */
export const TITLE_BYTES = 504;
/** The most bytes of a word PlainSpice gives ngspice: two of them, and a few characters, fit in 512 (limit-3 to limit-7). */
export const WORD_BYTES = 250;
/** The most bytes of a v(…) in a formula, a .control line, or a part's full name inside subcircuits (limit-3, limit-5, limit-6, limit-7). */
export const RUN_BYTES = 500;

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
  /** What else PlainSpice did to that copy, a sentence each: a title cut, every current not saved. */
  notes: string[];
  /** Set when PlainSpice must not give this netlist to ngspice: `text` is then not to be run. */
  notRun?: NotRun;
}

/** The words PlainSpice says about the copy ngspice runs. */
const S = {
  titleCut: (line: number, bytes: number): string =>
    `PlainSpice cut the title on line ${line} from ${bytes} to ${TITLE_BYTES} bytes in the copy ngspice ran: ngspice copies the title into a space of 513 bytes when it writes its results file, and stops on a longer one. A plain letter is one byte; ş or é is two. Your netlist keeps the whole title.`,
  noSaveCurrents: (name: string, bytes: number): string =>
    `PlainSpice did not add ${SAVE_CURRENTS_LINE} to the copy ngspice ran: inside the subcircuits a part is named ${name}, ${bytes} bytes, and ngspice copies the name of each part whose current it saves into a space of 512 bytes. So ngspice saved only the currents it always saves (voltage sources, E and H sources, inductors).`,
  longWord: (line: number, word: string, bytes: number): string =>
    `Line ${line} has a word of ${bytes} bytes (${shown(word)}). PlainSpice gives ngspice words of at most ${WORD_BYTES} bytes: ngspice copies names into spaces of 512 bytes, sometimes two names into one, and writes past the end with longer ones, so its results could not be trusted. Shorten the word.`,
  noClose: (line: number, open: string): string =>
    `Line ${line}: the ${open} in this formula has no ) after it. ngspice would look for the ) past the end of the line and write over its own memory, so PlainSpice did not run it. Add the ).`,
  longRun: (line: number, run: string, bytes: number): string =>
    `Line ${line}: ${shown(run)}) is ${bytes} bytes long from ${run.slice(0, 2)} to ). ngspice copies it into a space of 512 bytes when it reads a formula, so PlainSpice gives it at most ${RUN_BYTES}. Shorten the names in it.`,
  longCommand: (line: number, bytes: number): string =>
    `Line ${line} is a command for ngspice of ${bytes} bytes. ngspice copies a command into a space of 512 bytes, so PlainSpice gives it commands of at most ${RUN_BYTES} bytes. Split the line or shorten it.`,
  longFullName: (line: number, what: string, name: string, bytes: number): string =>
    `Line ${line} asks ngspice to ${what}, and inside the subcircuits a part is named ${name}, ${bytes} bytes. ngspice copies such a name into a space of 512 bytes, so PlainSpice gives it names of at most ${RUN_BYTES} bytes. Shorten the names of the X lines or of the parts in the subcircuits.`,
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
const DOT_TITLE = /^[\uFEFF \t\v\f\r]*\.title/i;
/** A title line for ngspice: line 1, and any .title line (limit-1). */
const isTitleLine = (text: string, index: number): boolean => index === 0 || DOT_TITLE.test(text);

/**
 * Where a title line's title starts: ngspice takes a .title line's words after the first one (and the
 * blanks after it), and line 1 whole (limit-1).
 */
function titleStart(text: string): number {
  if (!DOT_TITLE.test(text)) return 0;
  return /^[\uFEFF \t\v\f\r]*\S*[ \t\v\f\r]*/.exec(text)![0].length;
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

/** The code of a line before anything that may start an end-of-line comment (; $ //): no more than ngspice keeps. */
const beforeComment = (s: string): string => s.split(/;|\$|\/\//, 1)[0]!;

/**
 * A card as ngspice joins it: the line, then each + line after it, with a space for the '+'. `code`
 * is the same without what may be an end-of-line comment of each line, which ngspice cuts first.
 */
interface Card {
  line: NetlistLine;
  text: string;
  code: string;
}

function cardsOf(netlist: Netlist): Card[] {
  const cards = new Map<number, Card>();
  const out: Card[] = [];
  for (const line of netlist.lines) {
    // A + line is checked on its own after a title line, whose words are cut, not checked.
    const head = line.kind === 'continuation' && line.continues !== undefined ? cards.get(line.continues) : undefined;
    if (head && !isTitleLine(head.line.text, head.line.index)) {
      const rest = line.text.replace(/^\s*\+/, '');
      head.text += ` ${rest}`;
      head.code += ` ${beforeComment(rest)}`;
      continue;
    }
    const card = { line, text: line.text, code: beforeComment(line.text) };
    cards.set(line.index, card);
    out.push(card);
  }
  return out;
}

// ------------------------------------------------------------------ names inside subcircuits

/**
 * The longest name ngspice gives a part, in bytes: its own name at the top, and "letter.x1.x2.name"
 * inside subcircuits, e.g. r.xzz.xxx.rz for Rz inside Xxx inside Xzz (limit-3).
 */
export function longestPartName(netlist: Netlist): { name: string; bytes: number; line: number } | undefined {
  interface Inside {
    parts: { name: string; bytes: number; line: number }[];
    xs: { name: string; bytes: number; target: string; line: number }[];
  }
  const top: Inside = { parts: [], xs: [] };
  const defs = new Map<string, Inside[]>();
  const open: Inside[] = [];
  const cards = cardsOf(netlist);
  for (const { line, code } of cards) {
    const d = line.directive;
    if (d && (d.name === '.subckt' || d.name === '.macro')) {
      const def: Inside = { parts: [], xs: [] };
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
    if (line.kind !== 'element' || !line.element) continue;
    const here = open.at(-1) ?? top;
    const words = gettokWords(code.replace(/[ \t]*=[ \t]*/g, '='), Number.MAX_SAFE_INTEGER);
    const name = (words[0] ?? '').toLowerCase();
    const bytes = utf8Bytes(name);
    if (line.element.letter === 'X') {
      // The subcircuit is the last word before the parameters (name=value, or after "params:").
      const params = words.findIndex((w) => w.toLowerCase() === 'params:');
      const target = (params < 0 ? words : words.slice(0, params)).filter((w) => !w.includes('=')).at(-1)?.toLowerCase() ?? '';
      here.xs.push({ name, bytes, target, line: line.number });
    } else here.parts.push({ name, bytes, line: line.number });
  }
  // The longest "x.….name" inside a subcircuit (without the letter in front), and that part's letter.
  type Path = { name: string; bytes: number; letter: string };
  const memo = new Map<string, Path | undefined>();
  const visiting = new Set<string>();
  const inside = (target: string, depth: number): Path | undefined => {
    if (memo.has(target)) return memo.get(target);
    if (visiting.has(target)) return undefined; // ngspice refuses a subcircuit inside itself
    // Each level adds at least "x." to a name, so past 250 levels every name inside is over 500 bytes.
    if (depth > 250) return { name: target, bytes: Number.MAX_SAFE_INTEGER, letter: 'x' };
    visiting.add(target);
    let best: Path | undefined;
    for (const def of defs.get(target) ?? []) {
      for (const p of def.parts) if (!best || p.bytes > best.bytes) best = { name: p.name, bytes: p.bytes, letter: p.name[0] ?? '' };
      for (const x of def.xs) {
        const deeper = inside(x.target, depth + 1);
        if (!deeper) continue;
        const bytes = Math.min(Number.MAX_SAFE_INTEGER, x.bytes + 1 + deeper.bytes);
        if (!best || bytes > best.bytes) best = { name: `${x.name}.${deeper.name}`, bytes, letter: deeper.letter };
      }
    }
    visiting.delete(target);
    memo.set(target, best);
    return best;
  };
  let longest: { name: string; bytes: number; line: number } | undefined;
  for (const p of top.parts) if (!longest || p.bytes > longest.bytes) longest = p;
  for (const x of top.xs) {
    const deeper = inside(x.target, 1);
    if (!deeper) continue;
    // ngspice puts the part's letter in front: r.x1.r1.
    const name = `${deeper.letter}.${x.name}.${deeper.name}`;
    const bytes = Math.min(Number.MAX_SAFE_INTEGER, 2 + x.bytes + 1 + deeper.bytes);
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
  const script = /^\uFEFF?\*ng_script/i.test(netlist.lines[0]?.text ?? '');
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
  // limit-3, limit-7: the student's own request to save every current, or the currents inside every part.
  const request =
    netlist.lines.find((l) => l.directive && OPTIONS.has(l.directive.name) && l.directive.args.some((a) => a.text.toLowerCase() === 'savecurrents')) ??
    netlist.lines.find((l) => l.directive?.name === '.save' && l.directive.args.some((a) => a.text.toLowerCase() === 'alli'));
  if (request) {
    const longest = longestPartName(netlist);
    if (longest && longest.bytes > RUN_BYTES) {
      const what = request.directive?.name === '.save' ? 'save the currents inside every part (.save alli)' : `save every part's current (${SAVE_CURRENTS_LINE})`;
      note(request.number, S.longFullName(request.number, what, shown(longest.name), longest.bytes));
    }
  }
  return found.sort((a, b) => a.line - b.line)[0];
}

// ------------------------------------------------------------------ the copy

export function netlistToRun(netlist: Netlist): NetlistToRun {
  const notes: string[] = [];
  const notRun = whyNotRun(netlist);
  // limit-1: each title keeps its first 504 bytes; every line keeps its place.
  const lines = netlist.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isTitleLine(line, i)) continue;
    const start = titleStart(line);
    const bytes = utf8Bytes(line.slice(start));
    if (bytes <= TITLE_BYTES) continue;
    lines[i] = line.slice(0, start) + cutToBytes(line.slice(start), TITLE_BYTES);
    notes.push(S.titleCut(i + 1, bytes));
  }
  const text = notes.length ? lines.join('\n') : netlist.text;
  const done = (added: string[], copy: string): NetlistToRun => (notRun ? { text: copy, added, notes, notRun } : { text: copy, added, notes });
  const hasOp = netlist.analyses.some((i) => netlist.lines[i]?.directive?.name === '.op');
  if (!hasOp || hasSaveCurrents(netlist)) return done([], text);
  // limit-3: ngspice saves a part's current under its full name; a name too long for that space is not saved.
  const longest = longestPartName(netlist);
  if (longest && longest.bytes > RUN_BYTES) {
    notes.push(S.noSaveCurrents(shown(longest.name), longest.bytes));
    return done([], text);
  }
  const end = netlist.end === undefined ? undefined : netlist.lines[netlist.end];
  if (end) {
    // Where .end starts in the copy, after any title cut before it.
    const at = lines.slice(0, end.index).reduce((n, l) => n + l.length + 1, 0);
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
