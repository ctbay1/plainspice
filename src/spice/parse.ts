/**
 * The netlist parser: what ngspice 47 reads from a netlist file, line by line and word by word.
 *
 * It mirrors ngspice's front end (src/frontend/inpcom.c) and element parsers
 * (src/spicelib/parser/inp2*.c, inpgtok.c, inpdpar.c) for the netlists students write. Every rule
 * below was checked by running native ngspice 47, native ngspice 42 and our WebAssembly engine:
 * docs/spice-facts/numbers-and-syntax.md, asserted by tests/golden/facts-numbers.test.ts. The IDs in
 * brackets (S1, W9, ...) name the claims there.
 *
 * Lines (`NetlistLine.kind`):
 * - Line 1 is the title, whatever it says, because ngspice always skips it (S1-S3). One exception:
 *   a first line starting with '@' is 'invalid', because ngspice stops reading before the title (S4).
 * - Leading spaces and tabs never matter, and carriage returns are deleted wherever they are
 *   (a '\r' inside a word joins its two halves, as in ngspice) (S32-S35).
 * - 'comment': starts with '*' or '#', or ';' (silently), or one of = [ ] ? ( ) & % $ " ! : , and
 *   form feed (ngspice warns once and makes it a comment), or a whole-line '//' comment (S6-S11).
 * - 'control': between .control and .endc (both included), and lines starting with "*#" or "##",
 *   which ngspice runs as commands even outside .control (S16, S17, S31).
 * - 'continuation': starts with '+', or follows a line that ends in two backslashes. It belongs to
 *   the last line before it that is not a comment or blank (`continues`), even across '*', '#',
 *   '$' and '//' comment lines; but a ';' line or an odd-character line in between takes the
 *   continuation itself, and it is lost in that comment. With no such line before it (right after
 *   the title) ngspice ignores it silently, and `continues` is undefined (S5, S18-S24).
 * - End-of-line comments are cut off first: ';' anywhere, '$' after a space, tab or comma, and
 *   '//' (inside .control: ';', '//' and '$' followed by a space) (S12-S15).
 * - 'directive': starts with '.'; 'element': starts with a letter A-Z (any case; the micro sign
 *   counts as 'u'); anything else is 'invalid' (digits, '-', '_', '/', non-ASCII letters...).
 * - '.end' (any case; also ".end;comment"): the lines after it are 'after-end' and are not parsed
 *   as parts, although ngspice still reads them from a file (a ".end;comment" makes it stop)
 *   (S25-S28). A line starting with '@' is 'invalid' and ngspice stops reading there: the lines
 *   after it are 'after-end' too (S29, S30). Blank lines and comments keep their kind after either.
 *
 * Words (`Token`): on element lines, words are read the way ngspice reads each field. Names, nodes
 * and model names (INPgetNetTok) end at a space, tab, ',', '=' or ')'. Numbers and parameter names
 * (INPgetUTok, INPgetTok) also end at '(', '*', '/', '^' and at a '+' or '-' after a digit or letter
 * (so "1,5k" is "1" and "5k", "1d-3" is "1d" and "-3", "1k-2" is "1k" and "-2"; N8-N14, W1-W5).
 * On other lines, words are separated by spaces, tabs, ',', '=', '(' and ')'. Separators are never
 * part of a word, an expression in braces or quotes is one word, and
 * `text.slice(token.from, token.to)` is always `token.text`.
 *
 * Fields (`Element.fields`): one field per word, in order, with its role. A keyword belongs to the
 * field it introduces: "DC 6" is two 'value' fields, "PULSE(0 5 ...)" is 'source-function' fields,
 * "w=1u" is two 'parameter' fields. When ngspice reads two numbers for the main value, both are
 * 'value' fields and `Element.value` is the one ngspice uses (the second: "1,5k" is 5 kΩ; V1, V2).
 * Words ngspice cannot use as a parameter (where it stops with "unknown parameter") are 'other':
 * the parameter names of V, I, R, C, L, E, F, G and H follow ngspice 47's tables; on other parts
 * any name is taken as a parameter.
 *
 * Nodes: lower-case (ASCII letters only, like ngspice; W6, W7). "0" is ground, and so is "gnd" in
 * any case, except as the last word of its line, where ngspice keeps it as an ordinary node called
 * "gnd" (W8-W12). "ground" and "00" are ordinary nodes (W13, W14). Ground is listed under "0" in
 * `Netlist.nodes`. Nodes named in directives (".tf v(a) V1") are listed with their references; a
 * node named only there has no connections. Nodes inside .subckt ... .ends are local to the
 * subcircuit and are not listed. The keys keep letters outside ASCII as written ("giriş"), although
 * ngspice writes each of their bytes as '_' ("giri__", W16): `ngspiceSpelling` gives ngspice's name,
 * so two names it makes one (W17) can be found, and its results matched to the netlist's names.
 *
 * The parser never throws, whatever the input.
 */
import { isSpaceCode, numberWordEnd, readNumber } from './numbers.ts';
import type {
  Connection,
  Directive,
  Element,
  ElementLetter,
  Field,
  FieldRole,
  LineKind,
  Netlist,
  NetlistLine,
  NodeInfo,
  NodeRef,
  NumberReading,
  Token,
  ValueField,
} from './types.ts';

const TAB = 9;
const FORM_FEED = 12;
const SPACE = 32;
const BANG = 33;
const DQUOTE = 34;
const HASH = 35;
const DOLLAR = 36;
const PERCENT = 37;
const AMPERSAND = 38;
const QUOTE = 39;
const LPAREN = 40;
const RPAREN = 41;
const STAR = 42;
const PLUS = 43;
const COMMA = 44;
const DOT = 46;
const SLASH = 47;
const COLON = 58;
const SEMICOLON = 59;
const EQUALS = 61;
const QUESTION = 63;
const AT = 64;
const LBRACKET = 91;
const BACKSLASH = 92;
const RBRACKET = 93;
const LBRACE = 123;
const RBRACE = 125;
const BOM = 0xfeff;
const MICRO_SIGN = '\u00b5';

/** First characters ngspice turns into a comment, with one warning (inpcom.c, inp_check_syntax). */
const ODD_FIRST = new Set([
  EQUALS, LBRACKET, RBRACKET, QUESTION, LPAREN, RPAREN, AMPERSAND, PERCENT, DOLLAR, DQUOTE, BANG, COLON, COMMA, FORM_FEED,
]);

const ANALYSES = new Set([
  '.op', '.tf', '.dc', '.tran', '.ac', '.noise', '.disto', '.pz', '.sens', '.sp', '.fourier', '.four',
]);

/** ASCII letters to lower case only, as ngspice does ("Ü1" and "ü1" stay different nodes). */
export function lowerAscii(s: string): string {
  let upper = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 128) return s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
    if (c >= 65 && c <= 90) upper = true;
  }
  return upper ? s.toLowerCase() : s;
}

/**
 * A name as ngspice spells it in its printout and results (W16-W18): it reads the file as bytes, turns
 * the micro sign µ into 'u', then writes every byte that is not a printable ASCII character as '_'
 * (inp_casefix in ngspice's inpcom.c), so each character outside ASCII becomes one '_' per byte of
 * its UTF-8 form: "giriş" is "giri__" (ş is two bytes), "a😀" is "a____". ASCII letters go to lower
 * case. Spaces never occur in a name.
 */
export function ngspiceSpelling(name: string): string {
  let out = '';
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    if (c === 0xb5) out += 'u';
    else if (c < 0x20 || c === 0x7f) out += '_';
    else if (c < 0x80) out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : ch;
    // UTF-8 length; a lone surrogate is written as U+FFFD, three bytes.
    else out += '_'.repeat(c < 0x800 ? 2 : c < 0x10000 ? 3 : 4);
  }
  return out;
}

/** A node or part name as ngspice uses it: micro sign as 'u', ASCII letters in lower case. */
export function ngspiceName(word: string): string {
  return lowerAscii(word.includes(MICRO_SIGN) ? word.replaceAll(MICRO_SIGN, 'u') : word);
}

const isAsciiLetter = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isSeparator = (c: number): boolean => isSpaceCode(c) || c === COMMA || c === EQUALS || c === LPAREN || c === RPAREN;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

// ------------------------------------------------------------------ what ngspice sees of a line

/** One physical line as ngspice reads it: carriage returns deleted, leading blanks removed. */
interface View {
  text: string;
  /** Netlist offset of each character of `text`, or null when they run on from `start`. */
  offsets: number[] | null;
  start: number;
}

function makeView(text: string, from: number, to: number): View {
  let i = from;
  for (; i < to; i++) {
    const c = text.charCodeAt(i);
    if (c !== SPACE && c !== TAB && c !== 13 && c !== BOM) break;
  }
  const body = text.slice(i, to);
  if (!body.includes('\r')) return { text: body, offsets: null, start: i };
  const offsets: number[] = [];
  let visible = '';
  for (let k = i; k < to; k++) {
    if (text.charCodeAt(k) === 13) continue;
    offsets.push(k);
    visible += text[k];
  }
  return { text: visible, offsets, start: i };
}

const rawOffset = (v: View, k: number): number => (v.offsets ? (v.offsets[k] ?? v.start) : v.start + k);

/**
 * Where ngspice cuts a line for an end-of-line comment (inp_stripcomments_line): the end of what
 * remains, trailing blanks removed, or -1 when the whole line becomes a comment.
 */
function codeEnd(s: string, insideControl: boolean): number {
  const n = s.length;
  if (n === 0) return 0;
  const first = s.charCodeAt(0);
  if (first === STAR || first === HASH) return -1;
  let d = 0;
  while (d < n) {
    const c = s.charCodeAt(d);
    d += 1;
    if (c === DQUOTE || c === QUOTE) {
      while (d < n && (s.charCodeAt(d) !== c || s.charCodeAt(d - 1) === BACKSLASH)) d += 1;
      if (d < n) d += 1;
      continue;
    }
    if (d < n && s.charCodeAt(d) === SEMICOLON) break;
    if (c === DOLLAR) {
      if (!insideControl) {
        const before = d >= 2 ? s.charCodeAt(d - 2) : -1;
        if (before === SPACE || before === COMMA || before === TAB) {
          d -= 1;
          break;
        }
      } else if (d < n && s.charCodeAt(d) === SPACE) {
        d -= 1;
        break;
      }
      continue;
    }
    if (c === SLASH && d < n && s.charCodeAt(d) === SLASH) {
      d -= 1;
      break;
    }
  }
  if (d === 0) return -1;
  let e = d;
  while (e > 0 && (s.charCodeAt(e - 1) === SPACE || s.charCodeAt(e - 1) === TAB)) e -= 1;
  return e <= 0 ? -1 : e;
}

/** Index of two backslashes that end the line (shell-style continuation), or -1. */
function trailingBackslashes(s: string): number {
  let e = s.length;
  while (e > 0 && isSpaceCode(s.charCodeAt(e - 1))) e -= 1;
  return e >= 2 && s.charCodeAt(e - 1) === BACKSLASH && s.charCodeAt(e - 2) === BACKSLASH ? e - 2 : -1;
}

// ------------------------------------------------------------------ a card: a line and its continuations

interface Segment {
  /** Where the segment starts in Source.text. */
  at: number;
  /** The line's view; its text may differ from `text` only by blanked characters (same length). */
  view: View;
  /** Where the segment starts in view.text. */
  viewFrom: number;
  line: number;
}

/**
 * The text ngspice parses for one card: the line's code, then each continuation's code after a
 * space (ngspice replaces the '+' with a space), with a way back to netlist offsets.
 */
class Source {
  text = '';
  private readonly segments: Segment[] = [];

  add(text: string, view: View, from: number, to: number, line: number): void {
    if (to <= from) return;
    this.segments.push({ at: this.text.length, view, viewFrom: from, line });
    this.text += text.slice(from, to);
  }

  separate(): void {
    this.text += ' ';
  }

  /** The last segment starting at or before `i` (binary search: a card can have many lines). */
  private segmentAt(i: number): Segment | undefined {
    let lo = 0;
    let hi = this.segments.length - 1;
    let found: Segment | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = this.segments[mid]!;
      if (s.at <= i) {
        found = s;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  }

  offset(i: number): number {
    const s = this.segmentAt(i);
    return s ? rawOffset(s.view, s.viewFrom + (i - s.at)) : 0;
  }

  line(i: number): number {
    return this.segmentAt(i)?.line ?? 0;
  }
}

/** A word of a card: [a, b) in Source.text. */
interface Word {
  a: number;
  b: number;
  /** What ngspice reads (carriage returns already gone). */
  clean: string;
  /** How ngspice reads it as a number, once asked (undefined: not a number). */
  number?: NumberReading | undefined;
}

function groupEnd(s: string, p: number): number {
  const open = s.charCodeAt(p);
  if (open === LBRACE) {
    let depth = 0;
    for (let i = p; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === LBRACE) depth += 1;
      else if (c === RBRACE && --depth === 0) return i + 1;
    }
    return s.length;
  }
  const close = s.indexOf(s[p]!, p + 1);
  return close < 0 ? s.length : close + 1;
}

const isGroupStart = (c: number): boolean => c === LBRACE || c === QUOTE || c === DQUOTE;

/** INPgetNetTok: names and nodes end at a blank, ',', '=' or ')'. A '(' stays inside ("a(1"). */
function netWordEnd(s: string, p: number): number {
  let i = p;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (isSpaceCode(c) || c === EQUALS || c === COMMA || c === RPAREN) break;
    i += 1;
  }
  return i === p && p < s.length ? p + 1 : i;
}

/** Words separated by blanks, ',', '=', '(' and ')': for directives and other non-element lines. */
function plainWords(s: string, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  let i = from;
  while (i < to) {
    const c = s.charCodeAt(i);
    if (isSeparator(c)) {
      i += 1;
      continue;
    }
    const start = i;
    if (isGroupStart(c)) i = Math.min(groupEnd(s, i), to);
    else while (i < to && !isSeparator(s.charCodeAt(i))) i += 1;
    out.push([start, i]);
  }
  return out;
}

/** Reads a card's words the way ngspice's element parsers do. */
class Reader {
  pos = 0;
  private readonly s: string;

  constructor(s: string) {
    this.s = s;
  }

  private start(p: number): number {
    let i = p;
    while (i < this.s.length && isSeparator(this.s.charCodeAt(i))) i += 1;
    return i;
  }

  /** The next word without taking it. 'net' for names and nodes, 'word' for numbers and keywords. */
  peek(kind: 'net' | 'word', from = this.pos): Word | undefined {
    const a = this.start(from);
    if (a >= this.s.length) return undefined;
    const c = this.s.charCodeAt(a);
    const b = isGroupStart(c) ? groupEnd(this.s, a) : kind === 'net' ? netWordEnd(this.s, a) : numberWordEnd(this.s, a);
    return { a, b, clean: this.s.slice(a, b) };
  }

  take(w: Word): Word {
    this.pos = w.b;
    return w;
  }

  next(kind: 'net' | 'word'): Word | undefined {
    const w = this.peek(kind);
    return w ? this.take(w) : undefined;
  }

  /**
   * The next word if ngspice would read it as a number here, without taking it. An expression in
   * braces or single quotes counts too: ngspice evaluates it to a number before parsing the line
   * (PlainSpice does not evaluate it, so its `number` stays undefined).
   */
  peekNumber(): Word | undefined {
    const w = this.peek('word');
    if (!w) return undefined;
    const c = w.clean.charCodeAt(0);
    if (c === LBRACE || c === QUOTE) return w;
    w.number = readNumber(w.clean);
    return w.number ? w : undefined;
  }

  /** True when the next non-blank character after `b` is '=' (a name=value parameter). */
  equalsAfter(b: number): boolean {
    let i = b;
    while (i < this.s.length && isSpaceCode(this.s.charCodeAt(i))) i += 1;
    return this.s.charCodeAt(i) === EQUALS;
  }
}

/**
 * Is a node written "gnd" ground? ngspice replaces "gnd" by "0" only between a blank, '(' or ','
 * before it and a blank, ')' or ',' after it, after blanks at the end of the line and around '='
 * are gone (inpcom.c, inp_fix_gnd_name). So "gnd" as the last word stays a node called "gnd".
 */
function gndIsGround(s: string, a: number, b: number): boolean {
  let j = b;
  if (j >= s.length) return false;
  const after = s.charCodeAt(j);
  if (isSpaceCode(after)) {
    while (j < s.length && isSpaceCode(s.charCodeAt(j))) j += 1;
    if (j >= s.length || s.charCodeAt(j) === EQUALS) return false;
  } else if (after !== COMMA && after !== RPAREN) return false;
  let k = a - 1;
  if (k < 0) return false;
  const before = s.charCodeAt(k);
  if (before === LPAREN || before === COMMA) return true;
  if (!isSpaceCode(before)) return false;
  while (k >= 0 && isSpaceCode(s.charCodeAt(k))) k -= 1;
  return k >= 0 && s.charCodeAt(k) !== EQUALS;
}

// ------------------------------------------------------------------ elements

/** Collects an element's fields as its words are read. */
class ElementBuilder {
  readonly fields: Field[] = [];
  readonly nodes: NodeRef[] = [];
  /** The role of each node, in the same order as `nodes`. */
  readonly nodeRoles: FieldRole[] = [];
  /** Where each field's word starts in the card's Source (for its physical line). */
  readonly starts: number[] = [];
  private readonly src: Source;
  private readonly netlistText: string;

  constructor(src: Source, netlistText: string) {
    this.src = src;
    this.netlistText = netlistText;
  }

  token(w: Word): Token {
    const from = this.src.offset(w.a);
    const to = this.src.offset(w.b - 1) + 1;
    return { from, to, text: this.netlistText.slice(from, to) };
  }

  field(w: Word, role: FieldRole): Token {
    const token = this.token(w);
    this.fields.push({ role, token });
    this.starts.push(w.a);
    return token;
  }

  node(w: Word, role: FieldRole): void {
    const token = this.field(w, role);
    const name = ngspiceName(w.clean);
    const ground = name === '0' || (name === 'gnd' && gndIsGround(this.src.text, w.a, w.b));
    this.nodes.push({ token, name: ground ? '0' : name, ground });
    this.nodeRoles.push(role);
  }

  valueField(w: Word): ValueField {
    const token = this.fields[this.starts.lastIndexOf(w.a)]?.token ?? this.token(w);
    const number = w.number ?? readNumber(w.clean);
    return number ? { token, number } : { token };
  }
}

/** 'pair': one number, or two (a resistor's "tc=a b" is read as tc1=a tc2=b; inp2r.c). */
type ParamKind = 'real' | 'vector' | 'string' | 'flag' | 'pair';

interface ParamSpec {
  kind: ParamKind;
  role: FieldRole;
  /** A transient source function such as PULSE: Element.sourceFunction. */
  func?: true;
  /** A value the part can only report (its current, its power): ngspice stops when a line sets it. */
  reportOnly?: true;
}

const SENSITIVITY_OUTPUTS = ['sens_dc', 'sens_real', 'sens_imag', 'sens_mag', 'sens_ph', 'sens_cplx'];

/** A part's parameter table: names for its main value, other numbers, flags, and report-only values. */
function partParams(main: readonly string[], role: FieldRole, real: readonly string[], flags: readonly string[], reports: readonly string[]): ReadonlyMap<string, ParamSpec> {
  const m = new Map<string, ParamSpec>();
  for (const k of main) m.set(k, { kind: 'real', role });
  for (const k of real) m.set(k, { kind: 'real', role: 'parameter' });
  for (const k of flags) m.set(k, { kind: 'flag', role: 'parameter' });
  for (const k of [...reports, ...SENSITIVITY_OUTPUTS]) m.set(k, { kind: 'flag', role: 'other', reportOnly: true });
  return m;
}

/**
 * The instance parameters of R, C, L, E, F, G and H, as ngspice 47 lists them (devices/res/res.c,
 * cap/cap.c, ind/ind.c, vcvs/vcvs.c, cccs/cccs.c, vccs/vccs.c, ccvs/ccvs.c). INPdevParse
 * (inpdpar.c) stops at any other word after the value with "unknown parameter (word)", and at a
 * value the part can only report with "no such parameter on this device" (unknown-word-1 ... -11 in
 * docs/spice-facts/traps.md). The F and H "control" parameter names a source, like the line's
 * fourth word.
 */
const R_PARAMS = (() => {
  const m = new Map(partParams(['resistance', 'r'], 'value', ['ac', 'temp', 'dtemp', 'l', 'w', 'm', 'tc1', 'tc2', 'tce', 'bv_max', 'scale', 'noisy', 'noise'], ['sens_resist'], ['i', 'p']));
  m.set('tc', { kind: 'pair', role: 'parameter' });
  return m;
})();
const C_PARAMS = partParams(['capacitance', 'cap', 'c'], 'value', ['ic', 'temp', 'dtemp', 'w', 'l', 'm', 'tc1', 'tc2', 'bv_max', 'scale'], ['sens_cap'], ['i', 'p']);
const L_PARAMS = partParams(['inductance'], 'value', ['ic', 'temp', 'dtemp', 'm', 'tc1', 'tc2', 'scale', 'nt'], ['sens_ind'], ['flux', 'v', 'volt', 'i', 'current', 'p']);
const CONTROLLED_REPORTS = ['pos_node', 'neg_node', 'i', 'v', 'p'];
const E_PARAMS = partParams(['gain'], 'gain', [], ['sens_gain'], [...CONTROLLED_REPORTS, 'cont_p_node', 'cont_n_node']);
const G_PARAMS = partParams(['gain'], 'transconductance', ['m'], ['sens_trans'], [...CONTROLLED_REPORTS, 'cont_p_node', 'cont_n_node']);
const F_PARAMS = new Map([...partParams(['gain'], 'gain', ['m'], ['sens_gain'], CONTROLLED_REPORTS), ['control', { kind: 'string', role: 'parameter' } as ParamSpec]]);
const H_PARAMS = new Map([...partParams(['gain'], 'transresistance', [], ['sens_trans'], CONTROLLED_REPORTS), ['control', { kind: 'string', role: 'parameter' } as ParamSpec]]);
const PART_PARAMS: Readonly<Record<'R' | 'C' | 'L' | 'E' | 'F' | 'G' | 'H', ReadonlyMap<string, ParamSpec>>> = {
  R: R_PARAMS, C: C_PARAMS, L: L_PARAMS, E: E_PARAMS, F: F_PARAMS, G: G_PARAMS, H: H_PARAMS,
};

/**
 * What ngspice makes of `word` as a parameter name on an R, C, L, E, F, G or H line: a setting it
 * accepts, a value the part can only report (ngspice stops: "no such parameter on this device"), or
 * unknown (ngspice stops: "unknown parameter"). Undefined for other letters, whose tables PlainSpice
 * does not have. For the editor's highlighting, which must read lines the way the parser does.
 */
export function partParameter(letter: ElementLetter | undefined, word: string): 'setting' | 'report-only' | 'unknown' | undefined {
  const table = letter ? (PART_PARAMS as Partial<Record<ElementLetter, ReadonlyMap<string, ParamSpec>>>)[letter] : undefined;
  if (!table) return undefined;
  const spec = table.get(lowerAscii(word));
  return spec ? (spec.reportOnly ? 'report-only' : 'setting') : 'unknown';
}

/**
 * True when `word` names a value an R, C, L, E, F, G or H part can only report (i, p, flux ...):
 * ngspice stops when a line sets it ("no such parameter on this device", space-before-suffix-12).
 */
export function isReportOnlyParameter(letter: ElementLetter | undefined, word: string): boolean {
  return partParameter(letter, word) === 'report-only';
}

const TRANSIENT_FUNCTIONS = ['pulse', 'sin', 'sine', 'exp', 'pwl', 'sffm', 'am', 'trnoise', 'trrandom'];

/** Instance parameters of V and I sources (ngspice 47, devices/vsrc/vsrc.c and isrc/isrc.c). */
function sourceParams(letter: 'V' | 'I'): ReadonlyMap<string, ParamSpec> {
  const m = new Map<string, ParamSpec>();
  m.set('dc', { kind: 'real', role: 'value' });
  for (const f of TRANSIENT_FUNCTIONS) m.set(f, { kind: 'vector', role: 'source-function', func: true });
  m.set('external', { kind: 'string', role: 'source-function', func: true });
  for (const k of ['ac', 'distof1', 'distof2']) m.set(k, { kind: 'vector', role: 'source-function' });
  for (const k of ['acmag', 'acphase']) m.set(k, { kind: 'real', role: 'source-function' });
  for (const k of ['r', 'td']) m.set(k, { kind: 'real', role: 'parameter' });
  if (letter === 'V') {
    for (const k of ['portnum', 'z0', 'pwr', 'freq', 'phase']) m.set(k, { kind: 'real', role: 'parameter' });
  } else {
    m.set('c', { kind: 'real', role: 'value' });
    m.set('m', { kind: 'real', role: 'parameter' });
  }
  return m;
}

const V_PARAMS = sourceParams('V');
const I_PARAMS = sourceParams('I');

interface ParseOptions {
  /** Role of a leading number (INPdevParse's "leading value"); none when it is not used. */
  leadRole?: FieldRole;
  /** Known parameters with their kind and role; other identifiers are 'parameter' (one number). */
  params?: ReadonlyMap<string, ParamSpec>;
  /** Only the known parameters are valid (V, I): anything else is 'other'. */
  strict?: boolean;
}

interface ParseResult {
  lead?: Word;
  /** The last number given to a parameter whose role is the main value (dc=, gain=, r=...). */
  keyed?: Word;
  func?: { name: string; word: Word; args: Word[] };
}

/** INPdevParse: an optional leading number, then parameters, each with its value(s). */
function parseParameters(r: Reader, b: ElementBuilder, opts: ParseOptions): ParseResult {
  const result: ParseResult = {};
  if (opts.leadRole) {
    const lead = r.peekNumber();
    if (lead) {
      b.field(r.take(lead), opts.leadRole);
      result.lead = lead;
    }
  }
  let stopped = false;
  for (let w = r.next('word'); w; w = r.next('word')) {
    if (stopped) {
      b.field(w, 'other');
      continue;
    }
    const key = lowerAscii(w.clean);
    const spec = opts.params?.get(key) ?? (!opts.strict && IDENTIFIER.test(key) ? undefined : null);
    if (spec === null || spec?.reportOnly) {
      // ngspice stops here: "unknown parameter (...)", or "no such parameter on this device" for
      // a value the part can only report.
      b.field(w, 'other');
      stopped = true;
      continue;
    }
    const role = spec?.role ?? 'parameter';
    const kind: ParamKind = spec?.kind ?? (key === 'ic' ? 'vector' : 'real');
    b.field(w, role);
    const args: Word[] = [];
    if (kind === 'string') {
      const s = r.next('word');
      if (s) {
        b.field(s, role);
        args.push(s);
      }
    } else if (kind !== 'flag') {
      const most = kind === 'vector' ? Number.POSITIVE_INFINITY : kind === 'pair' ? 2 : 1;
      for (let n = r.peekNumber(); n && args.length < most; n = r.peekNumber()) {
        b.field(r.take(n), role);
        args.push(n);
      }
    }
    const last = args[args.length - 1];
    if (last && (role === 'value' || role === 'gain' || role === 'transconductance' || role === 'transresistance')) {
      result.keyed = last;
    }
    if (spec?.func) result.func = { name: key, word: w, args };
  }
  return result;
}

/** Nodes until a known model name (D, Q, M), as ngspice scans them. */
function nodesThenModel(
  r: Reader,
  b: ElementBuilder,
  models: ReadonlySet<string>,
  firstModelIndex: number,
  lastModelIndex: number,
  fallbackIndex: (count: number) => number,
  role: (i: number) => FieldRole,
): void {
  const words: Word[] = [];
  let p = r.pos;
  for (let i = 0; i <= lastModelIndex; i++) {
    const w = r.peek('net', p);
    if (!w) break;
    words.push(w);
    p = w.b;
  }
  let model = -1;
  for (let i = firstModelIndex; i < words.length; i++) {
    if (models.has(ngspiceName(words[i]!.clean))) {
      model = i;
      break;
    }
  }
  if (model < 0) {
    const fallback = fallbackIndex(words.length);
    model = fallback < words.length ? fallback : -1;
  }
  const nodeCount = model < 0 ? words.length : model;
  for (let i = 0; i < nodeCount; i++) b.node(r.take(words[i]!), role(i));
  if (model >= 0) b.field(r.take(words[model]!), 'model');
}

function fixedNodes(r: Reader, b: ElementBuilder, roles: FieldRole[]): void {
  for (const role of roles) {
    const w = r.next('net');
    if (!w) return;
    b.node(w, role);
  }
}

/** X, A, N, P: words up to the parameters; the last one names the subcircuit or model. */
function nodesThenName(r: Reader, b: ElementBuilder): void {
  const bare: Word[] = [];
  for (let w = r.peek('net'); w; w = r.peek('net')) {
    if (lowerAscii(w.clean) === 'params:' || r.equalsAfter(w.b)) break;
    bare.push(r.take(w));
  }
  bare.forEach((w, i) => (i === bare.length - 1 ? b.field(w, 'model') : b.node(w, 'node')));
  const keyword = r.peek('word');
  if (keyword && lowerAscii(keyword.clean) === 'params:') b.field(r.take(keyword), 'parameter');
}

interface ElementParts {
  element: Element;
  /** For each field, where its word starts in the card's Source. */
  starts: number[];
  nodeRoles: FieldRole[];
}

function parseElement(src: Source, netlistText: string, models: ReadonlySet<string>): ElementParts | undefined {
  const r = new Reader(src.text);
  const b = new ElementBuilder(src, netlistText);
  const nameWord = r.next('net');
  if (!nameWord) return undefined;
  const nameToken = b.field(nameWord, 'name');
  const key = ngspiceName(nameWord.clean);
  const first = key.charCodeAt(0);
  const letter = isAsciiLetter(first) ? (String.fromCharCode(first).toUpperCase() as ElementLetter) : undefined;

  let value: Word | undefined;
  let controlSource: Token | undefined;
  let func: ParseResult['func'];

  switch (letter) {
    case 'R':
    case 'C':
    case 'L': {
      // Rname n1 n2 [value] [model] [r=value] [parameters] (inp2r.c, inp2c.c, inp2l.c). A second
      // plain number replaces the first (V2), which is why "1,5k" is 5 kΩ (N13).
      fixedNodes(r, b, ['node', 'node']);
      if (b.nodes.length < 2) break;
      const own = letter.toLowerCase();
      const firstNumber = r.peekNumber();
      if (firstNumber) {
        b.field(r.take(firstNumber), 'value');
        value = firstNumber;
      }
      const next = r.peek('net');
      if (next && lowerAscii(next.clean) === own) {
        // "r=5": ngspice reads the number after it as the resistance (only if none came before).
        b.field(r.take(next), 'value');
        const v = value ? undefined : r.peekNumber();
        if (v) {
          b.field(r.take(v), 'value');
          value = v;
        }
      } else if (next && models.has(ngspiceName(next.clean))) {
        b.field(r.take(next), 'model');
      }
      // Then a number that replaces the value, and name=value parameters; any other word stops
      // ngspice ("unknown parameter"; unknown-word-1 ... -3).
      const res = parseParameters(r, b, { leadRole: 'value', params: PART_PARAMS[letter], strict: true });
      value = res.lead ?? res.keyed ?? value;
      break;
    }
    case 'V':
    case 'I': {
      // Vname n+ n- [[DC] value] [AC ...] [PULSE(...) ...] (inp2v.c, inp2i.c): a leading number
      // beats "dc", and the last "dc" beats an earlier one (V1). A word that is no parameter of a
      // source stops ngspice (N8, N12, N14).
      fixedNodes(r, b, letter === 'V' ? ['plus', 'minus'] : ['from', 'to']);
      const res = parseParameters(r, b, { leadRole: 'value', params: letter === 'V' ? V_PARAMS : I_PARAMS, strict: true });
      value = res.lead ?? res.keyed;
      func = res.func;
      break;
    }
    case 'E':
    case 'G': {
      // Ename n+ n- nc+ nc- gain (inp2e.c, inp2g.c)
      const out: FieldRole[] = letter === 'E' ? ['plus', 'minus'] : ['from', 'to'];
      fixedNodes(r, b, [...out, 'control-plus', 'control-minus']);
      const role: FieldRole = letter === 'E' ? 'gain' : 'transconductance';
      // Our engine (no XSPICE) stops at any other word: "unknown parameter" (unknown-word-4).
      const res = parseParameters(r, b, { leadRole: role, params: PART_PARAMS[letter], strict: true });
      value = res.lead ?? res.keyed;
      break;
    }
    case 'F':
    case 'H': {
      // Fname n+ n- Vcontrol gain (inp2f.c, inp2h.c)
      fixedNodes(r, b, letter === 'F' ? ['from', 'to'] : ['plus', 'minus']);
      const control = b.nodes.length === 2 ? r.next('net') : undefined;
      if (control) controlSource = b.field(control, 'control-source');
      const role: FieldRole = letter === 'F' ? 'gain' : 'transresistance';
      const res = parseParameters(r, b, { leadRole: role, params: PART_PARAMS[letter], strict: true });
      value = res.lead ?? res.keyed;
      break;
    }
    case 'K': {
      // Kname L1 L2 coupling (inp2k.c)
      for (let i = 0; i < 2; i++) {
        const w = r.next('net');
        if (w) b.field(w, 'other');
      }
      const coupling: ParamSpec = { kind: 'real', role: 'value' };
      const params = new Map([['k', coupling], ['coefficient', coupling]]);
      const res = parseParameters(r, b, { leadRole: 'value', params });
      value = res.lead ?? res.keyed;
      break;
    }
    case 'D':
      // Dname anode cathode [thermal node] model [area] ... (inp2d.c)
      nodesThenModel(r, b, models, 2, 3, () => 2, (i) => (i === 0 ? 'plus' : i === 1 ? 'minus' : 'node'));
      parseParameters(r, b, { leadRole: 'parameter' });
      break;
    case 'Q':
      // Qname c b e [substrate] [thermal] model ... (inp2q.c)
      nodesThenModel(r, b, models, 3, 5, () => 3, () => 'node');
      parseParameters(r, b, { leadRole: 'parameter' });
      break;
    case 'M':
      // Mname d g s b model ... (inp2m.c; up to 7 nodes for some models)
      nodesThenModel(r, b, models, 3, 7, (count) => (count > 4 ? 4 : 3), () => 'node');
      parseParameters(r, b, { leadRole: 'parameter' });
      break;
    case 'J':
    case 'Z':
    case 'U': {
      // Jname d g s model / Zname d g s model / Uname n1 n2 n3 model
      fixedNodes(r, b, ['node', 'node', 'node']);
      const model = b.nodes.length === 3 ? r.next('net') : undefined;
      if (model) b.field(model, 'model');
      parseParameters(r, b, { leadRole: 'parameter' });
      break;
    }
    case 'O':
    case 'S': {
      // Oname n1 n2 n3 n4 model / Sname n+ n- nc+ nc- model
      const last: FieldRole[] = letter === 'S' ? ['control-plus', 'control-minus'] : ['node', 'node'];
      fixedNodes(r, b, ['node', 'node', ...last]);
      const model = b.nodes.length === 4 ? r.next('net') : undefined;
      if (model) b.field(model, 'model');
      parseParameters(r, b, {});
      break;
    }
    case 'W': {
      // Wname n+ n- Vcontrol model
      fixedNodes(r, b, ['node', 'node']);
      const control = b.nodes.length === 2 ? r.next('net') : undefined;
      if (control) controlSource = b.field(control, 'control-source');
      const model = control ? r.next('net') : undefined;
      if (model) b.field(model, 'model');
      parseParameters(r, b, {});
      break;
    }
    case 'T':
    case 'Y':
      // Tname n1 n2 n3 n4 z0=... td=... / Yname n1 gnd1 n2 gnd2 ...
      fixedNodes(r, b, ['node', 'node', 'node', 'node']);
      parseParameters(r, b, {});
      break;
    case 'B':
      // Bname n+ n- V=expression / I=expression
      fixedNodes(r, b, ['node', 'node']);
      for (let w = r.next('word'); w; w = r.next('word')) b.field(w, 'parameter');
      break;
    case 'X':
    case 'A':
    case 'N':
    case 'P':
      nodesThenName(r, b);
      parseParameters(r, b, {});
      break;
    default:
      break;
  }
  // Anything the grammar did not read (only possible for odd lines) is still a word.
  for (let w = r.next('word'); w; w = r.next('word')) b.field(w, 'other');

  const element: Element = { name: nameToken, key, nodes: b.nodes, fields: b.fields };
  if (letter) element.letter = letter;
  if (value) element.value = b.valueField(value);
  if (controlSource) element.controlSource = controlSource;
  if (func) element.sourceFunction = { name: func.name, token: b.token(func.word), args: func.args.map((w) => b.token(w)) };
  return { element, starts: b.starts, nodeRoles: b.nodeRoles };
}

// ------------------------------------------------------------------ the netlist

interface LineState {
  from: number;
  to: number;
  view: View;
  kind: LineKind;
  /** End of the line's code in view.text (after end-of-line comments), or -1 for a comment. */
  code: number;
  /** Start of the code: after the '+' of a continuation line. */
  codeStart: number;
  /** A continuation made by two backslashes at the end of the line before. */
  shell: boolean;
  continues?: number;
  tokens: Token[];
  element?: Element;
  /** Roles of the element's nodes, in order. */
  nodeRoles?: FieldRole[];
  directive?: Directive;
}

/** A line's code with the two trailing backslashes of a shell continuation blanked out. */
function codeOf(view: View, insideControl: boolean, shell: boolean): { text: string; end: number } {
  let text = view.text;
  const k = shell || !startsComment(text) ? trailingBackslashes(text) : -1;
  if (k >= 0) text = `${text.slice(0, k)}  ${text.slice(k + 2)}`;
  // A shell continuation is read with a '+' in front, which matters for the '$' rule.
  const end = shell ? codeEnd(`+${text}`, insideControl) - 1 : codeEnd(text, insideControl);
  return { text, end: shell && end < 0 ? 0 : end };
}

/** ngspice skips '*' and '$' lines when it looks for two backslashes at the end of a line. */
const startsComment = (s: string): boolean => s.charCodeAt(0) === STAR || s.charCodeAt(0) === DOLLAR;

function classify(t: string, code: number, insideControl: boolean, controlMarker: boolean): LineKind {
  const c = t.charCodeAt(0);
  // "*#" runs as a command; '#' becomes '*', so "##" does too (ngspice 47).
  if (c === STAR || c === HASH) return t.charCodeAt(1) === HASH ? 'control' : 'comment';
  if (code < 0) return 'comment';
  if (c === SEMICOLON || ODD_FIRST.has(c)) return 'comment';
  if (c === PLUS) return 'continuation';
  if (insideControl || controlMarker) return 'control';
  if (c === DOT) return 'directive';
  if (isAsciiLetter(c)) return 'element';
  return 'invalid';
}

/**
 * Parses a netlist into lines, parts, directives and nodes, mirroring what ngspice 47 reads from
 * a file. Never throws.
 */
export function parseNetlist(text: string): Netlist {
  const states: LineState[] = [];
  let at = 0;
  for (;;) {
    const nl = text.indexOf('\n', at);
    const end = nl < 0 ? text.length : nl;
    const to = end > at && text.charCodeAt(end - 1) === 13 ? end - 1 : end;
    states.push({
      from: at,
      to,
      view: makeView(text, at, to),
      kind: 'blank',
      code: 0,
      codeStart: 0,
      shell: false,
      tokens: [],
    });
    if (nl < 0) break;
    at = nl + 1;
  }

  // Pass 1: what each line is, in reading order.
  const codeTexts: string[] = [];
  let ended = false;
  let insideControl = false;
  let pendingShell = false;
  let end: number | undefined;
  /** The .end line or the line starting with '@': ngspice's reading of the circuit ends there. */
  let stop = states.length;
  states.forEach((st, i) => {
    const vt = st.view.text;
    codeTexts[i] = vt;
    if (i === 0) {
      if (vt.charCodeAt(0) === AT) {
        st.kind = 'invalid';
        ended = true;
      } else {
        st.kind = 'title';
        pendingShell = !startsComment(vt) && trailingBackslashes(vt) >= 0;
      }
      return;
    }
    if (vt.length === 0) {
      st.kind = 'blank';
      return;
    }
    if (ended) {
      const code = codeEnd(vt, false);
      const c = vt.charCodeAt(0);
      st.kind = code < 0 || c === SEMICOLON || ODD_FIRST.has(c) ? 'comment' : 'after-end';
      st.code = code;
      return;
    }
    if (vt.charCodeAt(0) === AT) {
      st.kind = 'invalid';
      st.code = codeEnd(vt, false);
      ended = true;
      stop = i;
      return;
    }
    const t = vt.includes(MICRO_SIGN) ? vt.replaceAll(MICRO_SIGN, 'u') : vt;
    // Only dot lines can open or close .control or end the netlist.
    const lower = t.charCodeAt(0) === DOT ? lowerAscii(t.slice(0, 9)) : '';
    const startsControl = lower.startsWith('.control');
    const endsControl = !startsControl && lower.startsWith('.endc');
    if (startsControl) insideControl = true;
    const controlComments = insideControl && !endsControl;
    const readEnd = lower.startsWith('.end') && (lower.length === 4 || isSpaceCode(lower.charCodeAt(4)));

    st.shell = pendingShell && !readEnd;
    const { text: codeText, end: code } = codeOf(st.view, controlComments, st.shell);
    codeTexts[i] = codeText;
    st.code = code;
    if (st.shell) {
      st.kind = 'continuation';
    } else {
      st.kind = classify(t, code, insideControl, startsControl || endsControl);
      if (st.kind === 'continuation') st.codeStart = 1;
    }
    if (readEnd && !st.shell) st.kind = 'directive';
    if (st.kind === 'directive' && code > 0) {
      const name = lowerAscii(t.slice(0, numberWordEnd(t.slice(0, code), 0)));
      if (name === '.end') {
        end = i;
        stop = i;
        ended = true;
      }
    }
    // A shell continuation is read with a '+' in front, so the comment test does not apply.
    pendingShell = (st.shell || !startsComment(vt)) && trailingBackslashes(vt) >= 0;
    if (endsControl) insideControl = false;
  });

  // Pass 2: join continuation lines to the last line before them that is not a comment
  // (inpcom.c, inp_stitch_continuation_lines; comments are cut before, odd characters after).
  let previous: number | undefined;
  for (let i = 1; i < stop; i++) {
    const st = states[i]!;
    if (st.kind === 'blank' || st.code < 0) continue;
    if (st.kind === 'continuation') {
      if (previous !== undefined) st.continues = previous;
      continue;
    }
    const first = firstVisible(st.view.text);
    if (first === DOLLAR || first === HASH || first === STAR || Number.isNaN(first)) continue;
    previous = i;
  }

  const cards = new Map<number, number[]>();
  states.forEach((st, i) => {
    if (st.continues === undefined) return;
    const list = cards.get(st.continues);
    if (list) list.push(i);
    else cards.set(st.continues, [i]);
  });
  const sourceOf = (i: number): Source => {
    const src = new Source();
    const st = states[i]!;
    src.add(codeTexts[i] ?? st.view.text, st.view, st.codeStart, Math.max(st.codeStart, st.code), i);
    for (const k of cards.get(i) ?? []) {
      const c = states[k]!;
      src.separate();
      src.add(codeTexts[k] ?? c.view.text, c.view, c.codeStart, Math.max(c.codeStart, c.code), k);
    }
    return src;
  };
  const addToken = (line: number, token: Token): void => {
    states[line]?.tokens.push(token);
  };
  const tokenOf = (src: Source, a: number, b: number): Token => {
    const from = src.offset(a);
    const to = src.offset(b - 1) + 1;
    return { from, to, text: text.slice(from, to) };
  };

  // Pass 3: directives first (element lines need the .model names), then elements.
  const models = new Set<string>();
  const inCard = new Set<number>();
  states.forEach((st, i) => {
    if (st.kind !== 'directive') return;
    const src = sourceOf(i);
    const s = src.text;
    let p = 0;
    while (p < s.length && isSeparator(s.charCodeAt(p))) p += 1;
    if (p >= s.length) return;
    const nameEnd = numberWordEnd(s, p);
    const nameToken = tokenOf(src, p, nameEnd);
    addToken(src.line(p), nameToken);
    const args = plainWords(s, nameEnd, s.length).map(([a, b]) => {
      const token = tokenOf(src, a, b);
      addToken(src.line(a), token);
      return token;
    });
    const name = lowerAscii(s.slice(p, nameEnd));
    st.directive = { name, token: nameToken, args };
    for (const k of cards.get(i) ?? []) inCard.add(k);
    if (name === '.model') {
      const first = plainWords(s, nameEnd, s.length)[0];
      if (first) models.add(ngspiceName(s.slice(first[0], first[1])));
    }
  });

  const directiveRefs = new Map<number, { token: Token; name: string; ground: boolean }[]>();
  states.forEach((st, i) => {
    if (st.directive) directiveRefs.set(i, nodeRefsInDirective(sourceOf(i), text));
  });

  states.forEach((st, i) => {
    if (st.kind !== 'element') return;
    const src = sourceOf(i);
    const parts = parseElement(src, text, models);
    for (const k of cards.get(i) ?? []) inCard.add(k);
    if (!parts) return;
    st.element = parts.element;
    st.nodeRoles = parts.nodeRoles;
    parts.element.fields.forEach((f, k) => addToken(src.line(parts.starts[k] ?? 0), f.token));
  });

  // Every other line with words: its own words.
  states.forEach((st, i) => {
    const own = st.kind === 'control' || st.kind === 'invalid' || st.kind === 'after-end' || st.kind === 'continuation';
    if (!own) return;
    if (inCard.has(i)) return;
    const vt = codeTexts[i] ?? st.view.text;
    let start = st.codeStart;
    if (st.kind === 'after-end' && vt.charCodeAt(0) === PLUS) start = 1;
    const stop = st.code < 0 ? 0 : st.code;
    for (const [a, b] of plainWords(vt, start, stop)) {
      const from = rawOffset(st.view, a);
      const to = rawOffset(st.view, b - 1) + 1;
      st.tokens.push({ from, to, text: text.slice(from, to) });
    }
  });

  // Pass 4: the netlist, and its nodes.
  const lines: NetlistLine[] = [];
  const elements: number[] = [];
  const directives: number[] = [];
  const analyses: number[] = [];
  const nodes = new Map<string, NodeInfo>();
  const nodeInfo = (name: string, ground: boolean): NodeInfo => {
    let info = nodes.get(name);
    if (!info) {
      info = { name, ground, refs: [], connections: [] };
      nodes.set(name, info);
    }
    return info;
  };
  let subcircuitDepth = 0;
  states.forEach((st, i) => {
    // Each line's words come from one reader, in order, so they are already sorted.
    const line: NetlistLine = {
      index: i,
      number: i + 1,
      span: { from: st.from, to: st.to },
      text: text.slice(st.from, st.to),
      kind: st.kind,
      tokens: st.tokens,
    };
    if (st.continues !== undefined) line.continues = st.continues;
    if (st.element) {
      line.element = st.element;
      elements.push(i);
      if (subcircuitDepth === 0) {
        const element = st.element;
        element.nodes.forEach((ref, k) => {
          const info = nodeInfo(ref.name, ref.ground);
          info.refs.push(ref.token);
          const connection: Connection = { line: i, element: element.key, role: st.nodeRoles?.[k] ?? 'node' };
          info.connections.push(connection);
        });
      }
    }
    if (st.directive) {
      line.directive = st.directive;
      directives.push(i);
      const name = st.directive.name;
      if (ANALYSES.has(name)) analyses.push(i);
      if (name === '.subckt' || name === '.macro') subcircuitDepth += 1;
      else if (name === '.ends' || name === '.eom') subcircuitDepth = Math.max(0, subcircuitDepth - 1);
      else if (subcircuitDepth === 0) {
        for (const ref of directiveRefs.get(i) ?? []) nodeInfo(ref.name, ref.ground).refs.push(ref.token);
      }
    }
    lines.push(line);
  });

  const netlist: Netlist = { text, lines, elements, directives, analyses, nodes };
  if (end !== undefined) netlist.end = end;
  return netlist;
}

function firstVisible(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > SPACE) return c;
  }
  return Number.NaN;
}

/**
 * Nodes named in a directive: the words inside v(...), vm(...), vp(...), vr(...), vi(...), vdb(...).
 *
 * Each word is named once, by the first bracket that holds it, and each closing bracket is
 * looked for once: a line of v( with no ) (or with one ) at its end) is read in one pass. Read
 * again from every v(, such a line made references by the square of its length: a .print line
 * of 2000 v( (4 kB) gave 2 million of them, and 8000 used up the memory of the tab.
 */
function nodeRefsInDirective(src: Source, netlistText: string): { token: Token; name: string; ground: boolean }[] {
  const s = src.text;
  const out: { token: Token; name: string; ground: boolean }[] = [];
  const words = plainWords(s, 0, s.length);
  let next = 0; // the first word no bracket has named yet
  let stop = -1; // the first ) at or after the last place looked from, or the line's end
  for (let k = 0; k < words.length; k++) {
    const [a, b] = words[k]!;
    if (!/^v(m|p|r|i|db)?$/.test(lowerAscii(s.slice(a, b)))) continue;
    let p = b;
    while (p < s.length && isSpaceCode(s.charCodeAt(p))) p += 1;
    if (s.charCodeAt(p) !== LPAREN) continue;
    if (stop < p) {
      const close = s.indexOf(')', p);
      stop = close < 0 ? s.length : close;
    }
    for (let j = Math.max(k + 1, next); j < words.length && words[j]![0] < stop; j++) {
      next = j + 1;
      const [wa, wb] = words[j]!;
      const name = ngspiceName(s.slice(wa, wb));
      const ground = name === '0' || (name === 'gnd' && gndIsGround(s, wa, wb));
      const from = src.offset(wa);
      const to = src.offset(wb - 1) + 1;
      out.push({ token: { from, to, text: netlistText.slice(from, to) }, name: ground ? '0' : name, ground });
    }
  }
  return out;
}
