/**
 * The netlist model shared by the parser, the trap checks, the explanations, the editor and
 * the app. Plain TypeScript: no UI framework, no DOM.
 *
 * Offsets are UTF-16 code-unit offsets into the whole netlist string (what CodeMirror and
 * String.prototype.slice use). Line numbers are 1-based physical lines, as ngspice reports them
 * ("Error on line 4 ...").
 */

/** A range of the netlist text. */
export interface Span {
  from: number;
  to: number;
}

/** One whitespace-separated word of a line (commas, '=' and parentheses split words too; see parse.ts). */
export interface Token extends Span {
  text: string;
}

/** What one physical line is. */
export type LineKind =
  | 'title' // line 1: SPICE always skips it, whatever it says
  | 'blank'
  | 'comment' // starts with '*' (ngspice also turns some odd first characters into comments)
  | 'element' // a part: "R1 n1 0 2"
  | 'directive' // a dot command: ".op", ".tf v(a) V1", ".end", ...
  | 'continuation' // starts with '+': belongs to the line before
  | 'control' // inside .control ... .endc (not used by PlainSpice's analyses)
  | 'after-end' // after .end
  | 'invalid'; // anything ngspice cannot read as a part, e.g. a line starting with a digit

/** The element types ngspice knows, by first letter (case-insensitive). */
export type ElementLetter =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z';

/** How ngspice reads a number such as "1meg", "10kOhm", "3A" (see numbers.ts; checked against ngspice). */
export interface NumberReading {
  /** The text as written. */
  text: string;
  /** The value ngspice uses. */
  value: number;
  /** The scale letters ngspice applied, e.g. { letters: 'M', factor: 1e-3, name: 'milli' }. */
  scale?: { letters: string; factor: number; name: string };
  /** Letters after the number and scale that ngspice ignores, e.g. "Ohm" in "10kOhm". */
  ignored?: string;
  /**
   * Text after the word that ngspice reads as this number. ngspice does not ignore it: it reads it
   * as the next word, e.g. ",5k" in "1,5k", "-3" in "1d-3", " k" in "1 k" (see numbers.ts).
   */
  rest?: string;
}

/** A value field of a line: the token, and the number ngspice reads from it (if any). */
export interface ValueField {
  token: Token;
  number?: NumberReading;
}

/** A node named on a line. */
export interface NodeRef {
  token: Token;
  /** Node name as ngspice uses it: lower-case. "0", "gnd" (any case) are ground. */
  name: string;
  ground: boolean;
}

/** The meaning of each field of an element line (the channel's field-table words). */
export type FieldRole =
  | 'name'
  | 'node' // R, C, L: either way round
  | 'plus' // + node (V, E, H)
  | 'minus' // - node (V, E, H)
  | 'from' // current flows from this node through the part (I, F, G)
  | 'to' // ... into this node
  | 'control-plus' // E, G: + node of the controlling voltage
  | 'control-minus'
  | 'control-source' // F, H: the voltage source whose current controls the part
  | 'value' // resistance, capacitance, inductance, voltage, current
  | 'gain' // E: V/V, F: A/A
  | 'transconductance' // G: A/V
  | 'transresistance' // H: V/A (ohms)
  | 'source-function' // PULSE(...), SIN(...), PWL(...), EXP(...), AC ...
  | 'model' // D, Q, J, M: model name
  | 'parameter' // name=value
  | 'other';

export interface Field {
  role: FieldRole;
  token: Token;
}

/** A part (element line), with continuation lines merged. */
export interface Element {
  /** The first letter, upper-case; undefined when the line does not start with a letter. */
  letter?: ElementLetter;
  /** The name token, e.g. "R1" (as written). */
  name: Token;
  /** Lower-case name: ngspice treats R1 and r1 as the same part. */
  key: string;
  /** The nodes in netlist order, including E/G control nodes. */
  nodes: NodeRef[];
  /** Every field with its meaning, in order (name first). */
  fields: Field[];
  /** R/C/L value, V/I DC value, E/F/G/H gain; undefined when missing. */
  value?: ValueField;
  /** F, H: the controlling voltage source, lower-case. */
  controlSource?: Token;
  /** V, I: PULSE/SIN/PWL/EXP/SFFM/AM/TRNOISE... with its arguments, when present. */
  sourceFunction?: { name: string; token: Token; args: Token[] };
  /** E, F, G, H written as a formula, a table or a polynomial rather than with a gain (C3-5). */
  form?: ControlledForm;
  /**
   * The nodes a formula on the line reads, inside v(...) (B lines, E and G given by a formula or a table,
   * R, C and L values written as formulas): read only, not connected (C3-1). Absent when there are none.
   */
  reads?: NodeRef[];
}

/**
 * An E, F, G or H line written in another form than its nodes and a gain, read as ngspice reads it
 * (C3-5; inp_compat in its inpcom.c, the POLY translation in its xspice/enh/enhtrans.c):
 * - 'formula': E with VALUE= or vol=, G with VALUE= or cur=, then a formula: ngspice makes it a B source,
 *   so the output follows the formula, and the nodes it names inside v(...) are only read;
 * - 'table': E or G with TABLE: a table of points of a formula (or of a control voltage), which ngspice
 *   builds from an XSPICE block;
 * - 'poly': E, F, G or H with POLY(n): n controls (E and G: n pairs of nodes; F and H: n voltage
 *   sources), then the coefficients of a polynomial, also an XSPICE block.
 */
export interface ControlledForm {
  kind: 'formula' | 'table' | 'poly';
  /** The word that names the form, as written: VALUE, vol, cur, TABLE or POLY. */
  keyword: Token;
  /** 'formula' and 'table': the formula as written (v(out)*2, {v(out)*2}), when the line has one. */
  formula?: Token;
  /** 'poly': the n of POLY(n), when it is a whole number above 0. */
  dimension?: number;
  /** 'formula': the words between the output nodes and VALUE= that ngspice drops (E1 e 0 in 0 VALUE={...}). */
  dropped?: Token[];
}

/** A dot command. */
export interface Directive {
  /** Lower-case, with the dot: ".op", ".tf", ".dc", ".tran", ".ac", ".end", ".options", ... */
  name: string;
  token: Token;
  args: Token[];
}

export interface NetlistLine {
  /** 0-based index into Netlist.lines. */
  index: number;
  /** 1-based physical line number, as ngspice reports it. */
  number: number;
  /** The line's text without its line break. */
  span: Span;
  text: string;
  kind: LineKind;
  tokens: Token[];
  /** For kind 'element' (merged with its continuation lines). */
  element?: Element;
  /** For kind 'directive'. */
  directive?: Directive;
  /** For kind 'continuation': index of the line it continues. */
  continues?: number;
}

/** One terminal of a part, attached to a node. */
export interface Connection {
  /** Index of the element's line in Netlist.lines. */
  line: number;
  /** The element's lower-case name. */
  element: string;
  role: FieldRole;
}

export interface NodeInfo {
  /** Lower-case node name. */
  name: string;
  ground: boolean;
  /** Every place the node is named (for highlighting and renaming). */
  refs: Token[];
  connections: Connection[];
}

export interface Netlist {
  text: string;
  lines: NetlistLine[];
  /** Indexes into lines of the element lines. */
  elements: number[];
  /** Indexes into lines of the directive lines. */
  directives: number[];
  /** Indexes into lines of .op, .tf, .dc, .tran, .ac, .noise, ... */
  analyses: number[];
  /** Index of the .end line, if any. */
  end?: number;
  /** Every node, keyed by lower-case name (ground appears as "0" even when written "gnd"). */
  nodes: Map<string, NodeInfo>;
}

// ------------------------------------------------------------------ checks ("traps")

export type TrapSeverity = 'error' | 'warning' | 'info';

/** A text change, in netlist offsets (CodeMirror's ChangeSpec shape). */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/** A one-click fix: a label for the button and the changes it makes. */
export interface Fix {
  label: string;
  changes: TextChange[];
}

/**
 * A beginner trap found before running. Every claim in `ngspice` was checked by running
 * ngspice (see docs/spice-facts/).
 */
export interface Trap {
  /** Stable id, e.g. "mega-as-milli", "atto-amps", "no-ground". */
  id: string;
  severity: TrapSeverity;
  /** 1-based line number. */
  line: number;
  /** What to underline. */
  span: Span;
  /** Short title in plain words, e.g. "1M means one milliohm". */
  title: string;
  /** Why it is a trap, in plain words a first-year student can follow (1–3 sentences). */
  why: string;
  /** What ngspice does with it (verified), e.g. "ngspice reads 1M as 0.001 Ω and says nothing." */
  ngspice: string;
  fixes: Fix[];
}

// ------------------------------------------------------------------ explanations

/** One row of a line's field table: "+ node | n1 | the + side is at n1". */
export interface FieldExplanation {
  /** The field's label in the channel's words: "name", "+ node", "from node", "value", ... */
  label: string;
  /** The token as written ('' when missing). */
  text: string;
  /** Where it is in the netlist, for highlighting. */
  span?: Span;
  /** What it means here, in plain words: "the + side is at n1", "6 V". */
  meaning: string;
  /** Words in `meaning` that carry the meaning (+, −, from, to): the UI emphasises them. */
  emphasis?: string[];
}

/** The explanation of one line: a heading, a sentence, and its field table. */
export interface LineExplanation {
  /** 1-based line number. */
  line: number;
  /**
   * For an entry that explains several lines at once, the last of them (1-based): the drawing lines,
   * a run of "* plainspice-drawing" and "*@" comment lines, get one entry (final reviews, kept F2).
   */
  lastLine?: number;
  /** "V1: a voltage source", "Title line", ".op: operating point". */
  heading: string;
  /** One or two sentences, e.g. "SPICE reads it as V(n1) − V(0) = 6 V. Ground is 0 V, so n1 sits at 6 V." */
  summary: string;
  fields: FieldExplanation[];
  /** Extra notes (e.g. "In .op a capacitor is an open circuit"). */
  notes: string[];
}
