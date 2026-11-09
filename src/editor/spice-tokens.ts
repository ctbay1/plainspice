/**
 * A small SPICE netlist tokenizer for the editor: highlighting, and finding node names for the
 * node colour marks. Plain functions, no CodeMirror, so they are easy to test.
 *
 * It follows what ngspice 47 does with a netlist, checked by reading its source
 * (src/frontend/inpcom.c, src/spicelib/parser/inpeval.c) and by running native ngspice 47:
 *
 * - Line 1 is the title, whatever it says; ngspice never looks for comments in it.
 * - Leading spaces are ignored. A line whose first character is '*' is a comment; ngspice 47 also
 *   turns lines starting with '#', ';', '//' into comments silently, and lines starting with '$'
 *   or one of = [ ] ? ( ) & % " ! : , into comments with a warning. (ngspice 42 rejects '#'.)
 * - End-of-line comments start at ';' or '//' anywhere, or at '$' after a space, tab or comma
 *   (inside .control ... .endc only '$ ' with a space counts). Text in single or double quotes is
 *   skipped. A '*' in the middle of a line is NOT a comment, and neither is a single '/'.
 * - A line starting with '*#' or '##' (spaces before it allowed) is a command that ngspice runs,
 *   as if it were inside .control; '* #' and '#' are plain comments.
 * - A '+' line continues the statement before it; blank lines and '*', '#', '$', '//' comment lines
 *   in between are skipped. A ';' line or an odd-character line in between takes the '+' line
 *   instead, and it is lost in that comment.
 * - Inside a part line ngspice ends a number at '+' or '-' after a digit or letter (but not the sign
 *   of an exponent, 1e-3): "1k-2" is two numbers, 1k and -2 (R1 then gets -2 ohms). Unbraced
 *   arithmetic such as 2*3, 2/4 or 2^3 in a part's value is an error; {2*3} and '2*3' work.
 * - Numbers: digits, an optional exponent (e or d), then one scale suffix: T G Meg K mil M(milli)
 *   U N P F(femto) A(atto) in any case, or the micro sign µ (U+00B5, which ngspice reads as u;
 *   the Greek letter μ U+03BC is NOT read). Any letters after that are ignored: 10kOhm is 10k,
 *   5V is 5, 1Mohm is one milliohm. 3A is 3 atto (3e-18), 1F is one femto.
 * - Lines after a plain ".end" are still read by ngspice 47 (it turns that .end into a comment and
 *   adds its own at the very end), so nothing after .end is styled as ignored. (After ".end;x" the
 *   lines are not read; the trap checks can say so.)
 *
 * The tokenizer only colours and marks text. Deciding whether something is a mistake is the
 * trap checks' job (src/spice/traps.ts).
 */

export type SpiceTokenType =
  | 'title' // line 1
  | 'comment' // a comment line, or an end-of-line comment (including its marker)
  | 'control' // a line inside .control ... .endc (not used by PlainSpice's analyses)
  | 'element' // the name of a part: R1, V1, Itest (the first letter decides the kind)
  | 'elementRef' // a part named elsewhere: F1/H1's controlling source, .dc V1, i(Vx), K1's inductors
  | 'continuation' // the '+' that starts a continuation line
  | 'node'
  | 'ground' // node 0 (or gnd)
  | 'number' // the digits of a number: 10 in 10k
  | 'scale' // the scale suffix ngspice applies: k in 10k, meg, m, u, n, p, f, a, t, g, mil, µ
  | 'scaleCapitalM' // a capital M: milli in SPICE (people often mean mega; the trap list says so)
  | 'ignored' // letters after a number that ngspice ignores: Ohm in 10kOhm, V in 5V
  | 'directive' // .op, .tran, .end ...
  | 'function' // PULSE( SIN( PWL( ... and v( i( in output variables
  | 'keyword' // DC, AC, dec, uic, ON, OFF, params: ...
  | 'parameter' // the name in name=value
  | 'model' // a model or subcircuit name
  | 'expression' // {...} or '...'
  | 'string' // "..." or a file name
  | 'operator' // =
  | 'punctuation' // ( ) ,
  | 'invalid' // a word ngspice cannot read here (a line starting with a digit, a '+' with nothing to continue)
  | 'word'; // anything else (no style)

export interface SpiceToken {
  /** UTF-16 offsets within the line. */
  from: number;
  to: number;
  type: SpiceTokenType;
  /** Node and ground tokens: the name as ngspice uses it (lower-case; ground is always "0"). */
  node?: string;
  /** Node tokens inside a .subckt definition: the name belongs to the subcircuit only. */
  local?: boolean;
}

type PieceKind = 'word' | 'open' | 'close' | 'comma' | 'equals' | 'expression' | 'string' | 'punct';

interface PieceText {
  readonly kind: PieceKind;
  readonly text: string;
}

interface Piece extends PieceText {
  readonly from: number;
  readonly to: number;
}

/**
 * An element line or dot command, with the pieces of all its lines so far (continuations add to
 * it). Kind 'comment': a ';' or odd-character line, which swallows the '+' lines after it.
 */
export interface Statement {
  readonly kind: 'element' | 'directive' | 'comment';
  /** Upper-case element letter ("R"), lower-case directive name (".tran"), or the comment's first character. */
  readonly head: string;
  readonly pieces: readonly PieceText[];
}

/** What the tokenizer knows at the start of a line. Never mutated: each line returns a new one. */
export interface LineState {
  /** Physical lines read so far: 0 means the next line is line 1 (the title). */
  readonly line: number;
  readonly inControl: boolean;
  /** Nesting depth of .subckt definitions. */
  readonly subckt: number;
  /** The statement a '+' line would continue. */
  readonly statement: Statement | null;
}

export const START_STATE: LineState = Object.freeze({ line: 0, inControl: false, subckt: 0, statement: null });

const SPACE = /[ \t\f\v\r]/;
/** Characters that end a word (ngspice splits words at spaces, parentheses, commas and '='). */
const WORD_END = /[ \t\f\v\r(),={}'"]/;
/** First characters that ngspice 47 turns into a comment line (with a warning), see inpcom.c. */
const ODD_FIRST = '=[]?()&%"!:,\f';

const SOURCE_FUNCTIONS = new Set(['pulse', 'sin', 'pwl', 'exp', 'sffm', 'am', 'trnoise', 'trrandom', 'pat']);
const SOURCE_KEYWORDS = new Set(['dc', 'ac', 'distof1', 'distof2']);
const VOLTAGE_OUTPUTS = new Set(['v', 'vr', 'vi', 'vm', 'vp', 'vdb']);
const CURRENT_OUTPUTS = new Set(['i', 'ir', 'ii', 'im', 'ip', 'idb']);
const CONTROLLED_FORMS = new Set(['value', 'vol', 'cur', 'table', 'poly', 'laplace', 'freq']);
const DEVICE_KEYWORDS = new Set(['on', 'off', 'ic', 'area', 'temp', 'dtemp']);
const ANALYSIS_KEYWORDS = new Set(['op', 'dc', 'ac', 'tran', 'noise', 'disto', 'pz', 'tf', 'sens', 'sp']);
const MEASURE_KEYWORDS = new Set([
  'trig', 'targ', 'find', 'when', 'at', 'val', 'rise', 'fall', 'cross', 'td', 'from', 'to',
  'avg', 'max', 'min', 'pp', 'rms', 'integ', 'deriv', 'param', 'last',
]);

/** How many node fields each kind of element has (X is "all but the last word"; K has none). */
const NODE_COUNT: Readonly<Record<string, number>> = {
  R: 2, C: 2, L: 2, V: 2, I: 2, D: 2, B: 2, E: 4, G: 4, F: 2, H: 2,
  Q: 3, J: 3, Z: 3, M: 4, S: 4, W: 2, T: 4, O: 4, U: 3, Y: 4,
};

// ------------------------------------------------------------------ public API

/** Tokenize one physical line, given the state after the previous line. */
export function tokenizeLine(text: string, state: LineState): { tokens: SpiceToken[]; state: LineState } {
  const lineNo = state.line + 1;
  const start = firstNonSpace(text, 0);

  if (state.line === 0) {
    // Line 1 is always the title: SPICE skips it, even when it looks like a part.
    const tokens: SpiceToken[] = start < 0 ? [] : [{ from: start, to: trimmedEnd(text), type: 'title' }];
    return { tokens, state: { ...state, line: lineNo, statement: null } };
  }
  const next: LineState = { ...state, line: lineNo };
  if (start < 0) return { tokens: [], state: next }; // blank: a '+' after it still continues

  const first = text[start]!;
  const firstWord = text.slice(start, wordEnd(text, start, text.length)).toLowerCase();
  // ngspice switches to the .control comment rules on the .control line itself and back on .endc.
  const controlRules = (state.inControl && !firstWord.startsWith('.endc')) || firstWord.startsWith('.control');
  const commentAt = commentStart(text, start, controlRules);
  const codeEnd = commentAt < 0 ? text.length : commentAt;
  const tokens: SpiceToken[] = [];
  const finish = (s: LineState): { tokens: SpiceToken[]; state: LineState } => {
    if (commentAt >= 0) tokens.push({ from: commentAt, to: trimmedEnd(text), type: 'comment' });
    return { tokens, state: s };
  };

  if (commentAt === start) {
    // "*#" and "##" lines are commands that ngspice runs, even outside .control.
    if (text.startsWith('*#', start) || text.startsWith('##', start)) {
      tokens.push({ from: start, to: trimmedEnd(text), type: 'control' });
      return { tokens, state: next };
    }
    // ngspice reads a ';' or odd-character line as a part line first and only later turns it into
    // a comment, so a '+' line after it joins that comment. Other comment lines are skipped.
    const swallows = first === ';' || ODD_FIRST.includes(first);
    return finish(swallows ? { ...next, statement: { kind: 'comment', head: first, pieces: [] } } : next);
  }

  if (state.inControl) {
    if (firstWord.startsWith('.endc')) {
      tokens.push({ from: start, to: start + firstWord.length, type: 'directive' });
      return finish({ ...next, inControl: false, statement: null });
    }
    const end = trimmedEnd(text, codeEnd);
    if (end > start) tokens.push({ from: start, to: end, type: 'control' });
    return finish(next);
  }

  if (first === '+' && state.statement?.kind === 'comment') {
    // Joined to the comment line before it: ngspice never sees this text.
    tokens.push({ from: start, to: trimmedEnd(text), type: 'comment' });
    return { tokens, state: next };
  }

  if (first === '+') {
    tokens.push({ from: start, to: start + 1, type: state.statement ? 'continuation' : 'invalid' });
    const pieces = lex(text, start + 1, codeEnd);
    if (!state.statement) {
      // ngspice: "Illegal continuation line: ignored."
      for (const p of pieces) tokens.push({ from: p.from, to: p.to, type: 'word' });
      return finish(next);
    }
    const statement: Statement = { ...state.statement, pieces: state.statement.pieces.concat(pieces.map(plain)) };
    emit(tokens, pieces, classifyStatement(statement, state.subckt > 0), statement.pieces.length - pieces.length, statement.kind === 'element');
    return finish({ ...next, statement });
  }

  const pieces = lex(text, start, codeEnd);

  if (first === '.') {
    if (firstWord === '.title') {
      // .title sets the title: the rest of the line is the title, not code.
      tokens.push({ from: start, to: start + 6, type: 'directive' });
      const rest = firstNonSpace(text, start + 6);
      if (rest >= 0 && rest < codeEnd) tokens.push({ from: rest, to: trimmedEnd(text, codeEnd), type: 'title' });
      return finish({ ...next, statement: null });
    }
    const statement: Statement = { kind: 'directive', head: firstWord, pieces: pieces.map(plain) };
    // A .subckt line's own nodes are local; .ends closes the definition after this line.
    const inSubckt = state.subckt > 0 || firstWord === '.subckt';
    emit(tokens, pieces, classifyStatement(statement, inSubckt), 0, false);
    let subckt = state.subckt;
    if (firstWord === '.subckt') subckt++;
    else if (firstWord === '.ends' && subckt > 0) subckt--;
    return finish({ ...next, subckt, inControl: firstWord.startsWith('.control'), statement });
  }

  if (/[a-z]/i.test(first)) {
    const statement: Statement = { kind: 'element', head: first.toUpperCase(), pieces: pieces.map(plain) };
    emit(tokens, pieces, classifyStatement(statement, state.subckt > 0), 0, true);
    return finish({ ...next, statement });
  }

  // Not a part, a dot command, a comment or a continuation (e.g. it starts with a digit).
  pieces.forEach((p, i) => tokens.push({ from: p.from, to: p.to, type: i === 0 ? 'invalid' : 'word' }));
  return finish({ ...next, statement: null });
}

/** The state after an empty line (CodeMirror's stream parser reports those separately). */
export function blankLineState(state: LineState): LineState {
  return state.line === 0 ? { ...state, line: 1, statement: null } : { ...state, line: state.line + 1 };
}

/** Tokenize a whole netlist; one token list per physical line (split on \n, \r\n or \r). */
export function tokenizeNetlist(text: string): SpiceToken[][] {
  let state = START_STATE;
  return text.split(/\r\n|\r|\n/).map((line) => {
    if (line.length === 0) {
      state = blankLineState(state);
      return [];
    }
    const r = tokenizeLine(line, state);
    state = r.state;
    return r.tokens;
  });
}

/** Where the comment on a line starts (a whole-line or end-of-line comment), or -1. Not for line 1. */
export function commentStart(text: string, start: number, inControl = false): number {
  const c = text[start];
  if (c === undefined) return -1;
  if (c === '*' || c === '#' || c === ';' || c === '$' || ODD_FIRST.includes(c) || text.startsWith('//', start)) {
    return start;
  }
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      // ngspice skips quoted text; a backslash before a quote does not close it.
      let j = i + 1;
      while (j < text.length && (text[j] !== ch || text[j - 1] === '\\')) j++;
      i = j;
      continue;
    }
    if (ch === ';') return i;
    if (ch === '/' && text[i + 1] === '/') return i;
    if (ch === '$') {
      const before = text[i - 1];
      if (inControl ? text[i + 1] === ' ' : before === ' ' || before === '\t' || before === ',') return i;
    }
  }
  return -1;
}

/**
 * How ngspice splits a number word: the digits, the scale suffix it applies, and the letters it
 * ignores. Returns null when the word does not start like a number.
 */
export function splitNumber(text: string): { digits: number; scale: number; capitalM: boolean } | null {
  const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/.exec(text);
  if (!m) return null;
  const digits = m[0].length;
  const rest = text.slice(digits);
  let scale = 0;
  if (/^(meg|mil)/i.test(rest)) scale = 3;
  // No /i flag here: it would fold the micro sign µ and the Greek μ together, and ngspice
  // reads only the micro sign (U+00B5) as micro.
  else if (/^[tgkmunpfaTGKMUNPFAµ]/.test(rest)) scale = 1;
  return { digits, scale, capitalM: scale === 1 && rest[0] === 'M' };
}

// ------------------------------------------------------------------ lexing

function firstNonSpace(text: string, from: number): number {
  for (let i = from; i < text.length; i++) if (!SPACE.test(text[i]!)) return i;
  return -1;
}

function trimmedEnd(text: string, end = text.length): number {
  let e = end;
  while (e > 0 && SPACE.test(text[e - 1]!)) e--;
  return e;
}

function wordEnd(text: string, from: number, end: number): number {
  let i = from;
  while (i < end && !WORD_END.test(text[i]!)) i++;
  return i;
}

function plain(p: Piece): PieceText {
  return { kind: p.kind, text: p.text };
}

/** Split [from, to) of a line into words, punctuation, {expressions}, 'expressions' and "strings". */
function lex(text: string, from: number, to: number): Piece[] {
  const out: Piece[] = [];
  const push = (kind: PieceKind, a: number, b: number): void => {
    out.push({ kind, text: text.slice(a, b), from: a, to: b });
  };
  let i = from;
  while (i < to) {
    const ch = text[i]!;
    if (SPACE.test(ch)) {
      i++;
    } else if (ch === '(' || ch === ')' || ch === ',' || ch === '=' || ch === '}') {
      push(ch === '(' ? 'open' : ch === ')' ? 'close' : ch === ',' ? 'comma' : ch === '=' ? 'equals' : 'punct', i, i + 1);
      i++;
    } else if (ch === '{') {
      let depth = 0;
      let j = i;
      for (; j < to; j++) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}' && --depth === 0) break;
      }
      j = Math.min(j + 1, to);
      push('expression', i, j);
      i = j;
    } else if (ch === "'" || ch === '"') {
      const close = text.indexOf(ch, i + 1);
      const j = close < 0 || close >= to ? to : close + 1;
      push(ch === "'" ? 'expression' : 'string', i, j);
      i = j;
    } else {
      const j = wordEnd(text, i, to);
      push('word', i, j);
      i = j;
    }
  }
  return out;
}

// ------------------------------------------------------------------ classifying statements

interface Classified {
  type: SpiceTokenType;
  /** A word to split into number, scale and ignored letters (when it looks like a number). */
  value?: boolean;
  node?: string;
  local?: boolean;
}

const isNumberWord = (text: string): boolean => /^[+-]?(?:\d|\.\d)/.test(text);
/** An operator inside the word (a sign right after e/E/d/D is an exponent, not an operator). */
const isArithmetic = (text: string): boolean => /[*/^]/.test(text) || /[^eEdD\s][+-]/.test(text);

/**
 * Give every piece of a statement its type. Works on the whole statement (all its lines), because
 * the meaning of a word depends on its position: the 3rd word of "R1 a b 1k" is a node, the 4th
 * a value.
 */
function classifyStatement(st: Statement, inSubckt: boolean): Classified[] {
  const ps = st.pieces;
  const out: Classified[] = ps.map((p) => ({
    type:
      p.kind === 'open' || p.kind === 'close' || p.kind === 'comma' || p.kind === 'punct'
        ? 'punctuation'
        : p.kind === 'equals'
          ? 'operator'
          : p.kind === 'expression'
            ? 'expression'
            : p.kind === 'string'
              ? 'string'
              : 'word',
  }));
  const taken: boolean[] = ps.map(() => false);
  for (let i = 0; i < ps.length; i++) if (ps[i]!.kind !== 'word') taken[i] = true;
  out[0] = { type: st.kind === 'element' ? 'element' : 'directive' };
  taken[0] = true;

  const lower = (i: number): string => ps[i]!.text.toLowerCase();
  const isWord = (i: number): boolean => ps[i]?.kind === 'word';

  // name=value pairs, and the value after any '=' (also ".ic v(n1)=0").
  for (let i = 1; i < ps.length; i++) {
    if (ps[i]!.kind !== 'equals') continue;
    if (isWord(i - 1) && !taken[i - 1]) {
      out[i - 1] = { type: 'parameter' };
      taken[i - 1] = true;
    }
    if (isWord(i + 1)) {
      out[i + 1] = { type: 'word', value: true };
      taken[i + 1] = true;
    }
  }

  // Calls: a word followed by '(' (PULSE(...), v(a), POLY(2) ...).
  for (let i = 1; i < ps.length; i++) {
    if (!isWord(i) || taken[i] || ps[i + 1]?.kind !== 'open') continue;
    const name = lower(i);
    const isModelType = st.head === '.model' && i === 2;
    out[i] = { type: isModelType ? 'keyword' : 'function' };
    taken[i] = true;
    let depth = 0;
    for (let j = i + 1; j < ps.length; j++) {
      const k = ps[j]!.kind;
      if (k === 'open') depth++;
      else if (k === 'close' && --depth === 0) break;
      else if (k === 'word' && !taken[j]) {
        taken[j] = true;
        if (VOLTAGE_OUTPUTS.has(name) && depth === 1) out[j] = nodeType(ps[j]!.text);
        else if (CURRENT_OUTPUTS.has(name) && depth === 1) out[j] = { type: 'elementRef' };
        else out[j] = { type: 'word', value: true };
      }
    }
  }

  // The words left are positional fields.
  const fields: number[] = [];
  for (let i = 1; i < ps.length; i++) if (isWord(i) && !taken[i]) fields.push(i);

  if (st.kind === 'element') classifyElementFields(st.head, ps, out, fields, lower);
  else classifyDirectiveFields(st.head, out, fields, lower);

  // Nodes inside a .subckt definition are local to it (ground is global).
  if (inSubckt) for (const c of out) if (c.type === 'node') c.local = true;
  return out;
}

function nodeType(text: string): Classified {
  const lower = text.toLowerCase();
  return lower === '0' || lower === 'gnd' ? { type: 'ground', node: '0' } : { type: 'node', node: lower };
}

function classifyElementFields(
  letter: string,
  ps: readonly PieceText[],
  out: Classified[],
  fields: number[],
  lower: (i: number) => string,
): void {
  const set = (i: number | undefined, c: Classified): void => {
    if (i !== undefined) out[i] = c;
  };
  const value = (i: number | undefined): void => set(i, { type: 'word', value: true });

  if (letter === 'K') {
    // K1 L1 L2 0.99: two inductor names, then the coupling.
    set(fields[0], { type: 'elementRef' });
    set(fields[1], { type: 'elementRef' });
    fields.slice(2).forEach(value);
    return;
  }

  if (letter === 'X') {
    // X1 n1 n2 ... subcircuit [params: ...]: every word before the subcircuit name is a node.
    const paramsAt = fields.findIndex((i) => lower(i) === 'params:');
    const positional = paramsAt < 0 ? fields : fields.slice(0, paramsAt);
    positional.forEach((i, k) => set(i, k === positional.length - 1 ? { type: 'model' } : nodeType(ps[i]!.text)));
    if (paramsAt >= 0) {
      set(fields[paramsAt], { type: 'keyword' });
      fields.slice(paramsAt + 1).forEach(value);
    }
    return;
  }

  let nodes = NODE_COUNT[letter] ?? 0;
  if ((letter === 'E' || letter === 'G') && fields.slice(2, 4).some((i) => CONTROLLED_FORMS.has(lower(i)))) nodes = 2;
  if (letter === 'Q' && fields.length >= 5) {
    // Q1 c b e [substrate] model: a 5th word that is a name (not a number or keyword) means the 4th is the substrate.
    const fifth = fields[4]!;
    if (!isNumberWord(ps[fifth]!.text) && !DEVICE_KEYWORDS.has(lower(fifth))) nodes = 4;
  }
  fields.slice(0, nodes).forEach((i) => set(i, nodeType(ps[i]!.text)));
  const rest = fields.slice(nodes);

  switch (letter) {
    case 'V':
    case 'I':
      for (const i of rest) {
        const w = lower(i);
        if (SOURCE_KEYWORDS.has(w)) set(i, { type: 'keyword' });
        else if (SOURCE_FUNCTIONS.has(w)) set(i, { type: 'function' });
        else value(i);
      }
      return;
    case 'E':
    case 'G':
    case 'F':
    case 'H': {
      let k = 0;
      if ((letter === 'F' || letter === 'H') && rest[0] !== undefined && !isNumberWord(ps[rest[0]]!.text)) {
        // F1 n+ n- Vx gain: the voltage source whose current controls the part.
        set(rest[0], CONTROLLED_FORMS.has(lower(rest[0])) ? { type: 'keyword' } : { type: 'elementRef' });
        k = 1;
      }
      for (const i of rest.slice(k)) set(i, CONTROLLED_FORMS.has(lower(i)) ? { type: 'keyword' } : { type: 'word', value: true });
      return;
    }
    case 'B': {
      // B1 n+ n- V={...} or I=2*v(in): everything after the '=' is the expression.
      const eq = ps.findIndex((p) => p.kind === 'equals');
      rest.forEach(value);
      if (eq > 0) for (let i = eq + 1; i < ps.length; i++) out[i] = { type: 'expression' };
      return;
    }
    case 'W': {
      // W1 n+ n- Vctrl model [ON|OFF]
      set(rest[0], { type: 'elementRef' });
      rest.slice(1).forEach((i, k) => set(i, deviceField(ps, i, lower, k === 0)));
      return;
    }
    default: {
      // R/C/L: a value (or a model); D/Q/J/M/S/...: a model name, then numbers and keywords.
      let modelSeen = false;
      for (const i of rest) {
        const c = deviceField(ps, i, lower, !modelSeen);
        if (c.type === 'model') modelSeen = true;
        set(i, c);
      }
    }
  }
}

function deviceField(ps: readonly PieceText[], i: number, lower: (i: number) => string, modelAllowed: boolean): Classified {
  if (isNumberWord(ps[i]!.text)) return { type: 'word', value: true };
  if (DEVICE_KEYWORDS.has(lower(i))) return { type: 'keyword' };
  return modelAllowed ? { type: 'model' } : { type: 'word' };
}

function classifyDirectiveFields(head: string, out: Classified[], fields: number[], lower: (i: number) => string): void {
  const set = (i: number | undefined, c: Classified): void => {
    if (i !== undefined) out[i] = c;
  };
  const value = (i: number | undefined): void => set(i, { type: 'word', value: true });
  const textOf = (i: number): string => lower(i);

  switch (head) {
    case '.subckt': {
      set(fields[0], { type: 'model' });
      const paramsAt = fields.findIndex((i) => textOf(i) === 'params:');
      const nodes = paramsAt < 0 ? fields.slice(1) : fields.slice(1, paramsAt);
      for (const i of nodes) set(i, nodeType(textOf(i)));
      if (paramsAt >= 0) set(fields[paramsAt], { type: 'keyword' });
      return;
    }
    case '.ends':
      set(fields[0], { type: 'model' });
      return;
    case '.model':
      set(fields[0], { type: 'model' });
      set(fields[1], { type: 'keyword' });
      fields.slice(2).forEach(value);
      return;
    case '.global':
      for (const i of fields) set(i, nodeType(textOf(i)));
      return;
    case '.tf':
      // .tf v(out) V1: the output (a call, handled above) and the input source.
      set(fields[fields.length - 1], { type: 'elementRef' });
      return;
    case '.dc':
      // .dc V1 0 12 1 [V2 0 5 1]: a source (or TEMP or a parameter), then start, stop, step.
      fields.forEach((i, k) => set(i, k % 4 === 0 ? (textOf(i) === 'temp' ? { type: 'keyword' } : { type: 'elementRef' }) : { type: 'word', value: true }));
      return;
    case '.noise':
      // .noise v(out) V1 dec 10 1 1meg
      fields.forEach((i, k) => {
        const w = textOf(i);
        if (k === 0 && !isNumberWord(w)) set(i, { type: 'elementRef' });
        else if (w === 'dec' || w === 'oct' || w === 'lin') set(i, { type: 'keyword' });
        else value(i);
      });
      return;
    case '.include':
    case '.inc':
    case '.lib':
      for (const i of fields) set(i, { type: 'string' });
      return;
    case '.options':
    case '.option':
    case '.opt':
      for (const i of fields) set(i, isNumberWord(textOf(i)) ? { type: 'word', value: true } : { type: 'keyword' });
      return;
    case '.print':
    case '.plot':
    case '.probe':
    case '.save':
      fields.forEach((i, k) => {
        const w = textOf(i);
        if ((k === 0 && ANALYSIS_KEYWORDS.has(w)) || w === 'all') set(i, { type: 'keyword' });
        else value(i);
      });
      return;
    case '.meas':
    case '.measure':
      fields.forEach((i, k) => {
        const w = textOf(i);
        if ((k === 0 && ANALYSIS_KEYWORDS.has(w)) || MEASURE_KEYWORDS.has(w)) set(i, { type: 'keyword' });
        else value(i);
      });
      return;
    default:
      // .ac dec 10 1 1meg, .tran 10u 5m uic, .temp 27, .param r=1k ...
      for (const i of fields) {
        const w = textOf(i);
        if (['dec', 'oct', 'lin', 'uic', 'all'].includes(w)) set(i, { type: 'keyword' });
        else value(i);
      }
  }
}

/**
 * Where ngspice splits a value word of a part line: at '+' or '-' after a digit or letter, except
 * the sign of an exponent (1e-3). "1k-2" -> ["1k", "-2"].
 */
export function valueParts(text: string): { from: number; to: number }[] {
  const parts: { from: number; to: number }[] = [];
  let start = 0;
  for (let i = 1; i < text.length; i++) {
    const ch = text[i]!;
    const prev = text[i - 1]!;
    const exponentSign = (prev === 'e' || prev === 'E') && /[0-9.]/.test(text[i - 2] ?? '');
    if ((ch === '+' || ch === '-') && /[0-9a-z]/i.test(prev) && !exponentSign) {
      parts.push({ from: start, to: i });
      start = i;
    }
  }
  parts.push({ from: start, to: text.length });
  return parts;
}

/** Number, scale suffix and ignored letters of one number word, at offset `at` of the line. */
function pushNumber(tokens: SpiceToken[], text: string, at: number): boolean {
  const n = splitNumber(text);
  if (!n) return false;
  tokens.push({ from: at, to: at + n.digits, type: 'number' });
  let pos = at + n.digits;
  if (n.scale) {
    tokens.push({ from: pos, to: pos + n.scale, type: n.capitalM ? 'scaleCapitalM' : 'scale' });
    pos += n.scale;
  }
  if (pos < at + text.length) tokens.push({ from: pos, to: at + text.length, type: 'ignored' });
  return true;
}

/** Append the tokens of this line's pieces (the last ones of the statement), splitting numbers. */
function emit(tokens: SpiceToken[], pieces: readonly Piece[], classified: readonly Classified[], offset: number, partLine: boolean): void {
  pieces.forEach((p, k) => {
    const c: Classified = classified[offset + k] ?? { type: 'word' };
    if (c.node !== undefined) {
      const t: SpiceToken = { from: p.from, to: p.to, type: c.type, node: c.node };
      if (c.local) t.local = true;
      tokens.push(t);
      return;
    }
    if (!c.value) {
      tokens.push({ from: p.from, to: p.to, type: c.type });
      return;
    }
    if (!partLine) {
      // Dot commands: .param x=2*rval is arithmetic, not a number with ignored letters.
      if (isArithmetic(p.text)) tokens.push({ from: p.from, to: p.to, type: 'expression' });
      else if (!pushNumber(tokens, p.text, p.from)) tokens.push({ from: p.from, to: p.to, type: c.type });
      return;
    }
    // Part lines: read the value the way ngspice does.
    for (const part of valueParts(p.text)) {
      const text = p.text.slice(part.from, part.to);
      const op = text.search(/[*/^]/);
      const head = op < 0 ? text : text.slice(0, op);
      if (head && !pushNumber(tokens, head, p.from + part.from)) tokens.push({ from: p.from + part.from, to: p.from + part.from + head.length, type: 'word' });
      // Unbraced arithmetic in a part's value is an error in ngspice (write {2*3}).
      if (op >= 0) tokens.push({ from: p.from + part.from + op, to: p.from + part.to, type: 'invalid' });
    }
  });
}
