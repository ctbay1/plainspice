/**
 * The operating point of a circuit worked out exactly, with fractions: what PlainSpice uses to tell a
 * value the circuit makes exactly 0 from a tiny real one (rounding noise, decision 0015; C9 to C9t in
 * docs/spice-facts/explanations.md). Plain TypeScript: no floating point in the solution, BigInt
 * fractions only.
 *
 * - `readExact` reads a value word the way ngspice reads it (src/spice/numbers.ts: its scale letters,
 *   "2A" as 2 attoamps, "10M" as 10 milli), but as the exact decimal the netlist writes, not as the
 *   double ngspice rounds it to (N15: ngspice reads "0.3" as 0.30000000000000004).
 * - `exactModel` takes a netlist only when PlainSpice knows exactly what each of its parts is in an
 *   operating point: R; C (open, P11); L (a wire); V and I with a plain DC value or none (0: P9, P16);
 *   E and G with four nodes and a plain gain; F and H that read a V, E or H (P10, P10b) with a plain
 *   gain; and a diode, as a part whose current is left free (at most MAX_DIODES). Anything else leaves
 *   the decision to describe.ts's rule for other circuits: a transistor, a switch, a subcircuit, a B
 *   source, POLY, VALUE or TABLE, a source with a transient function, a part with settings (m=, tc1=,
 *   ...), .param and expressions, .options and .temp lines, a .control block, a value below ngspice's
 *   smallest resistance, too many unknowns or parts.
 * - `solveExact` solves the circuit's nodal equations with fractions, for several right-hand sides at
 *   once (the operating point, a unit current through each diode, a swept source at 1, a .tf input at
 *   1), within a counted amount of work (MAX_WORK).
 * - `treeCurrents` gives each diode the current Kirchhoff's law gives it from ngspice's other values.
 * - `agrees` checks that ngspice simulated that same circuit: its node voltages and branch currents,
 *   put into the exact equations, leave only what its own rounding can leave.
 * - `answersAgree` checks that ngspice solved it to the digits the page shows: each answer whose exact
 *   value is not 0 is that value to within 5e-5 of it, beyond what rounding leaves (ANSWER_FLOOR);
 *   `answers` lists them, and the currents of the R, G and F too, for the note where they are off.
 */
import type { NumberReading } from './types.ts';
import { isSpaceCode, numberWordEnd } from './numbers.ts';

// ------------------------------------------------------------------ fractions

/** A fraction n/d with d > 0, not always in lowest terms (sizes are kept down as it goes). */
export interface Fraction {
  readonly n: bigint;
  readonly d: bigint;
}

export const ZERO: Fraction = { n: 0n, d: 1n };
export const ONE: Fraction = { n: 1n, d: 1n };

const SAFE = 9007199254740992n;

/** The greatest common divisor of |a| and |b| (Euclid; doubles while both fit in 53 bits). */
export function gcd(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b !== 0n) {
    if (a < SAFE && b < SAFE) {
      let x = Number(a);
      let y = Number(b);
      while (y !== 0) {
        const t = x % y;
        x = y;
        y = t;
      }
      return BigInt(x);
    }
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** A fraction in lowest terms. */
export function fraction(n: bigint, d: bigint = 1n): Fraction {
  if (d === 0n) throw new RangeError('fraction with a zero denominator');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n === 0n) return ZERO;
  if (d === 1n) return { n, d };
  const g = gcd(n, d);
  return g === 1n ? { n, d } : { n: n / g, d: d / g };
}

export const isZero = (x: Fraction): boolean => x.n === 0n;
export const neg = (x: Fraction): Fraction => (x.n === 0n ? x : { n: -x.n, d: x.d });
export const abs = (x: Fraction): Fraction => (x.n < 0n ? { n: -x.n, d: x.d } : x);
export const add = (x: Fraction, y: Fraction): Fraction =>
  x.n === 0n ? y : y.n === 0n ? x : x.d === y.d ? fraction(x.n + y.n, x.d) : fraction(x.n * y.d + y.n * x.d, x.d * y.d);
export const sub = (x: Fraction, y: Fraction): Fraction => add(x, neg(y));
export const mul = (x: Fraction, y: Fraction): Fraction => (x.n === 0n || y.n === 0n ? ZERO : fraction(x.n * y.n, x.d * y.d));
export const div = (x: Fraction, y: Fraction): Fraction => fraction(x.n * y.d, x.d * y.n);
export const equal = (x: Fraction, y: Fraction): boolean => (x.d === y.d ? x.n === y.n : x.n * y.d === y.n * x.d);
/** Sign of x − y. */
export const compare = (x: Fraction, y: Fraction): number => {
  const l = x.n * y.d;
  const r = y.n * x.d;
  return l < r ? -1 : l > r ? 1 : 0;
};

/** The exact value of a finite double. */
export function fromDouble(v: number): Fraction {
  if (!Number.isFinite(v)) throw new RangeError('not a finite number');
  if (v === 0) return ZERO;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, v);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const exponent = (hi >>> 20) & 0x7ff;
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (exponent !== 0) mantissa |= 1n << 52n;
  const e = (exponent === 0 ? 1 : exponent) - 1075;
  const n = v < 0 ? -mantissa : mantissa;
  return e >= 0 ? { n: n << BigInt(e), d: 1n } : fraction(n, 1n << BigInt(-e));
}

/** The double nearest to x, ties to even (for words only: never for a decision about 0). */
export function toDouble(x: Fraction): number {
  if (x.n === 0n) return 0;
  const negative = x.n < 0n;
  const n = negative ? -x.n : x.n;
  const d = x.d;
  const sign = negative ? -1 : 1;
  const e = bitLength(n) - bitLength(d);
  if (e > 1025) return sign * Number.POSITIVE_INFINITY;
  if (n << 1022n < d) {
    // Below the smallest normal double: a whole number of 2^-1074, rounded to nearest, ties to even.
    const scaled = n << 1074n;
    let q = scaled / d;
    const r2 = (scaled - q * d) * 2n;
    if (r2 > d || (r2 === d && (q & 1n) === 1n)) q += 1n;
    return sign * Number(q) * 2 ** -1074;
  }
  // 66 bits or more, and a sticky bit for whatever the division left, so Number() rounds once, rightly.
  const shift = 66 - e;
  const scaled = shift >= 0 ? n << BigInt(shift) : n;
  const by = shift >= 0 ? d : d << BigInt(-shift);
  let q = scaled / by;
  if (q * by !== scaled) q |= 1n;
  // Scaling by a power of 2 is exact for a normal result; done in two steps so no factor underflows.
  return sign * Number(q) * 2 ** -Math.trunc(shift / 2) * 2 ** -(shift - Math.trunc(shift / 2));
}

/** The number of bits of |x|. */
export function bitLength(x: bigint): number {
  if (x < 0n) x = -x;
  if (x === 0n) return 0;
  const s = x.toString(16);
  return (s.length - 1) * 4 + (32 - Math.clz32(Number.parseInt(s[0]!, 16)));
}

// ------------------------------------------------------------------ reading a value exactly

const TEN = 10n;
const pow10 = (k: number): bigint => TEN ** BigInt(k);

/** Scale letters as INPevaluate reads them (numbers.ts), as powers of ten. */
const SCALES: Readonly<Record<string, number>> = { t: 12, g: 9, k: 3, u: -6, n: -9, p: -12, f: -15, a: -18, m: -3 };

/**
 * The most significant digits a word may write to be read exactly: a double holds 17, and no
 * beginner writes 100. A longer word is left to the rule for other circuits.
 */
const MAX_DIGITS = 100;
/**
 * Doubles lie between 4.9e-324 and 1.8e308. A word whose value is outside 10^-325 to 10^310 is no
 * double: ngspice reads it as 0 or as infinity, never as the value written. It is not read exactly,
 * and no power of ten is built for it: 10^999999999 alone, for a word like 1e-999999999, takes half a
 * minute and then fails (the critic of the re-check's fixes).
 */
const DECIMAL_EXPONENTS = { least: -325, most: 310 } as const;

/**
 * The value ngspice reads from a value word, as the exact decimal the word writes: "4.7k" is 4700,
 * "0.3" is 3/10, "2A" is 2/10^18 (atto), "10M" is 1/100 (milli), "1mil" is 254/10^7. The grammar is
 * readNumber's (src/spice/numbers.ts), which mirrors ngspice's INPevaluate: the same word end, sign,
 * digits, exponent ('e' or 'd') and at most one scale letter; anything after it is ignored. ngspice
 * itself computes digits × 10^n in doubles (N15), so its value can be a unit or two in the last
 * place away from this one; `exactModel` checks that it is never more (`READ_ULPS`). Undefined where
 * readNumber reads no number, for an exponent too long for ngspice's int, for more than MAX_DIGITS
 * significant digits, and for a value no double can be (DECIMAL_EXPONENTS). Digits that are all 0
 * are 0, whatever the exponent.
 */
export function readExact(text: string): Fraction | undefined {
  const s = text.includes('\r') ? text.replaceAll('\r', '') : text;
  if (s.length === 0) return undefined;
  const first = s.charCodeAt(0);
  // A quote or a brace starts an expression; a separator starts no word (readNumber).
  if (first === 39 || first === 34 || first === 123 || isSpaceCode(first) || first === 44 || first === 61 || first === 40 || first === 41) return undefined;
  const t = s.includes('µ') ? s.replaceAll('µ', 'u') : s;
  const end = numberWordEnd(t, 0);
  let i = 0;
  let negative = false;
  if (t[i] === '+') i += 1;
  else if (t[i] === '-') {
    i += 1;
    negative = true;
  }
  const digit = (k: number): boolean => k < end && t.charCodeAt(k) >= 48 && t.charCodeAt(k) <= 57;
  if (i >= end || (!digit(i) && t[i] !== '.')) return undefined;
  let digits = '';
  let exponent = 0;
  let mil = false;
  /** The digits from i on, as one slice (a word can have thousands). */
  const run = (): string => {
    const from = i;
    while (digit(i)) i += 1;
    return t.slice(from, i);
  };
  digits = run();
  const done = (): Fraction | undefined => {
    // Leading zeros say nothing; trailing ones go into the exponent. Every size is checked before a power is built.
    let lead = 0;
    while (lead < digits.length && digits.charCodeAt(lead) === 48) lead += 1;
    if (lead === digits.length) return ZERO;
    let last = digits.length;
    while (digits.charCodeAt(last - 1) === 48) last -= 1;
    const sig = digits.slice(lead, last);
    const e = exponent + digits.length - last;
    const magnitude = sig.length - 1 + e + (mil ? 2 : 0);
    if (sig.length > MAX_DIGITS || magnitude < DECIMAL_EXPONENTS.least || magnitude > DECIMAL_EXPONENTS.most) return undefined;
    const n = BigInt(sig) * (mil ? 254n : 1n);
    const v = e >= 0 ? fraction(n * pow10(e)) : fraction(n, pow10(-e));
    return negative ? neg(v) : v;
  };
  if (i >= end || t[i] === ':') return done();
  if (t[i] === '.') {
    i += 1;
    if (i >= end) return done();
    const decimals = run();
    digits += decimals;
    exponent -= decimals.length;
  }
  const e = i < end ? t.charCodeAt(i) | 0x20 : 0;
  if (e === 0x65 || e === 0x64) {
    i += 1;
    let sign = 1;
    if (i < end && t[i] === '+') i += 1;
    else if (i < end && t[i] === '-') {
      i += 1;
      sign = -1;
    }
    let written = run();
    let zeros = 0;
    while (zeros < written.length && written.charCodeAt(zeros) === 48) zeros += 1;
    written = written.slice(zeros);
    // ngspice keeps the exponent in a C int; a longer one wraps there (numbers.ts), so it is not read here.
    if (written.length > 9) return undefined;
    exponent += sign * Number(written || '0');
  }
  if (i < end) {
    const c = t.charCodeAt(i) | 0x20;
    const c1 = i + 1 < end ? t.charCodeAt(i + 1) | 0x20 : 0;
    const c2 = i + 2 < end ? t.charCodeAt(i + 2) | 0x20 : 0;
    if (t.charCodeAt(i) < 128 && c === 0x6d && i + 2 < end && c1 === 0x65 && c2 === 0x67 && t.charCodeAt(i + 1) < 128 && t.charCodeAt(i + 2) < 128) exponent += 6;
    else if (t.charCodeAt(i) < 128 && c === 0x6d && i + 2 < end && c1 === 0x69 && c2 === 0x6c && t.charCodeAt(i + 1) < 128 && t.charCodeAt(i + 2) < 128) {
      // mil: 25.4e-6, which ngspice applies as mantissa × 25.4 and an exponent 6 lower.
      mil = true;
      exponent -= 7;
    } else if (t.charCodeAt(i) < 128) {
      const k = SCALES[String.fromCharCode(c)];
      if (k !== undefined) exponent += k;
    }
  }
  return done();
}

/** How far ngspice's double may be from the exact value of the same word, in units in the last place. */
export const READ_ULPS = 4;

/** The exact value of a value field, when ngspice's double for it is that value to within READ_ULPS. */
export function exactValue(reading: NumberReading | undefined): Fraction | undefined {
  if (!reading || !Number.isFinite(reading.value)) return undefined;
  const v = reading.value;
  // Below the smallest normal double ngspice's value has fewer digits: not this value. Looked at before the word is read.
  if (v !== 0 && Math.abs(v) < 2 ** -1022) return undefined;
  const x = readExact(reading.text);
  if (!x) return undefined;
  if (v === 0) return isZero(x) ? x : undefined;
  const diff = abs(sub(x, fromDouble(v)));
  return compare(diff, fromDouble(READ_ULPS * ulp(v))) <= 0 ? x : undefined;
}

const ulpView = new DataView(new ArrayBuffer(8));
/** The step from |x| to the next double. */
export function ulp(x: number): number {
  ulpView.setFloat64(0, Math.abs(x));
  const exponent = ulpView.getUint16(0) >>> 4;
  return exponent === 0 ? Number.MIN_VALUE : 2 ** (exponent - 1075);
}

// ------------------------------------------------------------------ the circuit, exactly

/**
 * The parts whose operating point PlainSpice knows exactly, and the diode: a part with two ends whose
 * current, whatever it is, flows in at one end and out at the other (its series resistance, its gmin and
 * its junction, all inside it). Its current is left free: a value that is 0 for every current the
 * diodes could carry is exactly 0 (describe.ts roundingNoise).
 */
export type ExactKind = 'R' | 'C' | 'L' | 'V' | 'I' | 'E' | 'F' | 'G' | 'H' | 'D';

export interface ExactPart {
  /** The part's name as ngspice spells it in its results ("r1", "r__" for "Rş"; W18). */
  key: string;
  kind: ExactKind;
  /** Its first and second node (indexes into ExactModel.nodes; -1 is ground). */
  a: number;
  b: number;
  /** E and G: the nodes whose voltage they read (c − d). */
  c: number;
  d: number;
  /** F and H: the part whose current they read (an index into ExactModel.parts). */
  control: number;
  /**
   * R: its resistance; V: its volts; I: its amps; E and F: their gain; G: amps per volt; H: volts per
   * amp. C and L: 0 (an open circuit and a wire in an operating point). D: 0, its current being free (a
   * solution gives it as an I's level).
   */
  value: Fraction;
  /** V, E, H and L: the index of the unknown that is their current (a branch); else -1. */
  branch: number;
}

export interface ExactModel {
  /** Node names as ngspice spells them in its results (W16), ground left out. */
  nodes: string[];
  parts: ExactPart[];
  /** Unknowns: the node voltages, then the branch currents. */
  size: number;
}

/** Element-like input: what exactModel needs of a parsed part (src/spice/types.ts Element). */
export interface PartInput {
  letter?: string;
  key: string;
  nodes: readonly { name: string; ground: boolean }[];
  fields: readonly { role: string; token: { text: string } }[];
  value?: { token: { text: string }; number?: NumberReading };
  controlSource?: { text: string };
  sourceFunction?: unknown;
}

/** The roles a part's words may have, besides its name, nodes and control source, to be modelled exactly. */
const PLAIN_ROLES: Readonly<Record<ExactKind, readonly string[]>> = {
  R: ['value'],
  C: ['value'],
  L: ['value'],
  V: ['value', 'source-function'],
  I: ['value', 'source-function'],
  E: ['gain'],
  F: ['gain'],
  G: ['transconductance'],
  H: ['transresistance'],
  // A diode's model and settings change only its own current, which is left free.
  D: [],
};
const NODE_ROLES = new Set(['node', 'plus', 'minus', 'from', 'to', 'control-plus', 'control-minus']);

/**
 * ngspice's smallest resistance: a resistor written smaller is given 1e-12 Ω instead (P13). Such a
 * line is not modelled exactly (its check says why).
 */
const SMALLEST_RESISTANCE = fraction(1n, 10n ** 12n);

/**
 * Dot commands that change nothing in an operating point of these parts: the analyses, and what only
 * chooses what ngspice prints or saves. `.options` lines are looked at one option at a time.
 */
const HARMLESS_DOTS = new Set([
  '.op', '.tf', '.dc', '.tran', '.ac', '.noise', '.disto', '.pz', '.sens', '.sp', '.four', '.fourier',
  '.end', '.title', '.save', '.print', '.plot', '.probe', '.width', '.meas', '.measure',
  // A model card changes only the current of the parts that use it: a diode's, which is left free.
  '.model',
]);
const OPTIONS = new Set(['.options', '.option', '.opt']);
/**
 * Options that cannot change the operating point of a circuit of R, C, L, V, I, E, F, G and H: what is
 * saved and printed, and the tolerances and iteration limits of ngspice's iterations, which a linear
 * circuit meets at its first solution. Any other option (gmin, rshunt, temp, scale, ...) leaves the
 * decision to the rule for other circuits.
 */
const HARMLESS_OPTIONS = new Set([
  'savecurrents', 'abstol', 'vntol', 'reltol', 'chgtol', 'trtol', 'itl1', 'itl2', 'itl3', 'itl4', 'itl5', 'itl6',
  'numdgt', 'acct', 'noacct', 'list', 'nolist', 'nomod', 'nopage', 'node', 'opts', 'warn', 'maxwarns', 'method', 'maxord', 'interp', 'keepopinfo',
]);

/** At most this many unknowns (node voltages and branch currents) are solved exactly (measured: decision 0015). */
export const MAX_UNKNOWNS = 150;
/**
 * At most this many parts are modelled exactly. Each part adds a term or more to the equations and about
 * four to each check of ngspice's values, each counted TERM_WORK, so past MAX_WORK / (5 × TERM_WORK)
 * parts the solve and one check cannot fit in MAX_WORK: the netlist is left to the other rule before any
 * value is read (reading the values of a 256 kB netlist of 12,000 resistors alone took 40 to 80 ms).
 */
export const MAX_PARTS = 1600;
/**
 * At most this many diodes are modelled exactly: each one's current is left free and takes a solution of
 * its own (describe.ts), and a check of ngspice's values with it. A beginner's circuit has a few (the
 * corpora's have one to three); more leave the netlist to the other rule.
 */
export const MAX_DIODES = 16;

/** Why a netlist is not modelled exactly, for tests and records: undefined when it is. */
export type NotExact =
  | 'directive'
  | 'part'
  | 'value'
  | 'control'
  | 'size'
  | 'names';

/** The lines of a netlist that matter to the check of its dot commands. */
export interface NetlistInput {
  lines: readonly { kind: string; text: string; directive?: { name: string; args: readonly { text: string }[] } }[];
}

/**
 * The netlist as a circuit PlainSpice knows exactly, or why it is not one. `parts` are the parts
 * ngspice reads (describe.ts partsOf: outside subcircuits, after a plain .end too), and only those it
 * builds (an R, C or L line with no value is left out, P15). `afterEnd` are the lines after .end
 * that ngspice still reads.
 */
export function exactModel(netlist: NetlistInput, parts: readonly PartInput[], afterEnd: readonly { text: string }[] = []): ExactModel | NotExact {
  if (parts.length > MAX_PARTS) return 'size';
  for (const line of netlist.lines) {
    if (line.kind === 'control' || line.kind === 'invalid') return 'directive';
    const d = line.directive;
    if (!d) continue;
    if (OPTIONS.has(d.name)) {
      for (const a of d.args) {
        const word = a.text.toLowerCase();
        if (/^[0-9.+-]/.test(word)) continue;
        if (!HARMLESS_OPTIONS.has(word)) return 'directive';
      }
      continue;
    }
    if (!HARMLESS_DOTS.has(d.name)) return 'directive';
  }
  for (const line of afterEnd) if (/^\s*\./.test(line.text) && !/^\s*\.(op|tf|dc|tran|ac|end)\b/i.test(line.text)) return 'directive';

  const nodes: string[] = [];
  const nodeIndex = new Map<string, number>();
  const node = (ref: { name: string; ground: boolean } | undefined): number => {
    if (!ref || ref.ground || ref.name === '0') return -1;
    const name = spelling(ref.name);
    let k = nodeIndex.get(name);
    if (k === undefined) {
      k = nodes.length;
      nodes.push(name);
      nodeIndex.set(name, k);
    }
    return k;
  };
  const out: ExactPart[] = [];
  const byKey = new Map<string, number>();
  const controls: string[] = [];
  for (const el of parts) {
    const kind = el.letter as ExactKind | undefined;
    if (!kind || !(kind in PLAIN_ROLES)) return 'part';
    const fourNodes = kind === 'E' || kind === 'G';
    const reads = kind === 'F' || kind === 'H';
    // A diode with a thermal node has a third end.
    if (el.nodes.length !== (fourNodes ? 4 : 2)) return 'part';
    if (reads !== !!el.controlSource) return 'part';
    if ((kind === 'V' || kind === 'I') && el.sourceFunction) return 'part';
    const allowed = PLAIN_ROLES[kind];
    if (kind !== 'D') {
      for (const f of el.fields.slice(1)) {
        if (NODE_ROLES.has(f.role) || (reads && f.role === 'control-source')) continue;
        if (!allowed.includes(f.role)) return 'part';
      }
    }
    let value = ZERO;
    if (kind === 'D') {
      // Its current is free: nothing of its line is read.
    } else if (el.value) {
      const v = exactValue(el.value.number);
      if (!v) return 'value';
      value = v;
    } else if (kind !== 'V' && kind !== 'I') return 'value';
    if (kind === 'R' && compare(abs(value), SMALLEST_RESISTANCE) < 0) return 'value';
    if (kind === 'C' || kind === 'L') value = ZERO;
    const key = spelling(el.key);
    if (byKey.has(key)) return 'names';
    byKey.set(key, out.length);
    const [p, q, c, d] = el.nodes;
    out.push({ key, kind, a: node(p), b: node(q), c: fourNodes ? node(c) : -1, d: fourNodes ? node(d) : -1, control: -1, value, branch: -1 });
    controls.push(reads ? spelling(el.controlSource!.text) : '');
  }
  // F and H read the current of a V, E or H (P10, P10b); any other part stops ngspice.
  for (let k = 0; k < out.length; k++) {
    if (!controls[k]) continue;
    const c = byKey.get(controls[k]!);
    const kind = c === undefined ? undefined : out[c]!.kind;
    if (kind !== 'V' && kind !== 'E' && kind !== 'H') return 'control';
    out[k]!.control = c!;
  }
  let size = nodes.length;
  for (const p of out) if (p.kind === 'V' || p.kind === 'E' || p.kind === 'H' || p.kind === 'L') p.branch = size++;
  if (size > MAX_UNKNOWNS || out.filter((p) => p.kind === 'D').length > MAX_DIODES) return 'size';
  return { nodes, parts: out, size };
}

/** A node's or part's name as ngspice spells it in its results (parse.ts ngspiceSpelling, W16-W18). */
function spelling(name: string): string {
  let out = '';
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    if (c === 0xb5) out += 'u';
    else if (c < 0x20 || c === 0x7f) out += '_';
    else if (c < 0x80) out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : ch;
    else out += '_'.repeat(c < 0x800 ? 2 : c < 0x10000 ? 3 : 4);
  }
  return out;
}

// ------------------------------------------------------------------ the equations

/** One term of an equation: the coefficient `c` of unknown `k`. */
interface Term {
  k: number;
  c: Fraction;
}

/**
 * The circuit's equations (modified nodal analysis): Kirchhoff's current law at each node (the
 * currents leaving it add up to 0), then one equation for each branch (V, E, H, L), as lists of terms,
 * not yet added up: solveExact adds each row's terms as whole numbers over the row's one denominator,
 * with no common factor searched for in a growing sum (1,000 resistors side by side at one node made
 * each sum of fractions slower than the last, the critic of round 2 of the re-check's fixes).
 */
function equations(model: ExactModel): Term[][] {
  const rows: Term[][] = Array.from({ length: model.size }, () => []);
  const put = (row: number, k: number, c: Fraction): void => {
    if (row >= 0 && k >= 0 && !isZero(c)) rows[row]!.push({ k, c });
  };
  for (const p of model.parts) {
    const { a, b } = p;
    switch (p.kind) {
      case 'R': {
        // 1/R, R of either sign; R's value is in lowest terms, so 1/R is too.
        const g: Fraction = p.value.n < 0n ? { n: -p.value.d, d: -p.value.n } : { n: p.value.d, d: p.value.n };
        put(a, a, g);
        put(a, b, neg(g));
        put(b, b, g);
        put(b, a, neg(g));
        break;
      }
      case 'G':
        // gm × (v(c) − v(d)) leaves node a and enters node b.
        put(a, p.c, p.value);
        put(a, p.d, neg(p.value));
        put(b, p.c, neg(p.value));
        put(b, p.d, p.value);
        break;
      case 'F': {
        const k = model.parts[p.control]!.branch;
        put(a, k, p.value);
        put(b, k, neg(p.value));
        break;
      }
      case 'V':
      case 'E':
      case 'H':
      case 'L': {
        const k = p.branch;
        put(a, k, ONE);
        put(b, k, neg(ONE));
        put(k, a, ONE);
        put(k, b, neg(ONE));
        if (p.kind === 'E') {
          put(k, p.c, neg(p.value));
          put(k, p.d, p.value);
        } else if (p.kind === 'H') put(k, model.parts[p.control]!.branch, neg(p.value));
        break;
      }
      default:
        // C: an open circuit; I and D: only on the right-hand side.
        break;
    }
  }
  return rows;
}

/**
 * The right-hand side of the equations: each independent source at `level(part)` (its value for the
 * operating point; 1 for the one source of a slope, 0 for the others).
 */
function rightHandSide(model: ExactModel, level: (p: ExactPart) => Fraction): Fraction[] {
  const rhs: Fraction[] = Array.from({ length: model.size }, () => ZERO);
  for (const p of model.parts) {
    if (p.kind === 'V') rhs[p.branch] = level(p);
    else if (p.kind === 'I' || p.kind === 'D') {
      // A current source pushes its current from a, through itself, into b: it leaves a. So does a diode's current.
      const v = level(p);
      if (p.a >= 0) rhs[p.a] = sub(rhs[p.a]!, v);
      if (p.b >= 0) rhs[p.b] = add(rhs[p.b]!, v);
    }
  }
  return rhs;
}

/**
 * The work the exact solution of one netlist may take, the solve and every check of ngspice's values
 * against it, before PlainSpice leaves the decision to the other rule; counted the same way on every
 * computer, so a circuit is decided exactly, or not, everywhere (decision 0015). Each combination of two
 * rows counts ROW_WORK; each entry it writes counts ENTRY_WORK plus the square of its size in 64-bit
 * words (the pivot's, measured once a step), since multiplying and dividing whole numbers of 4,096 bits
 * takes thousands of times as long as small ones; the back substitution counts the same way, with the
 * determinant's size, before it starts. Building the equations and each check of ngspice's values
 * (`shares`) count TERM_WORK for each term they add, before they start: a term costs up to about 3 µs
 * with numbers of 4,096 bits, and 1,000 resistors side by side at one node froze the page for 12.9 s
 * while only the elimination was counted (the critic of round 2 of the re-check's fixes). Measured over
 * 174 grids, meshes, ladders and networks of E and G sources of up to 146 unknowns, with values of 1, 3
 * and 7 digits, on a machine shared with other builds: from 2.6e-6 to 9.1e-6 ms of processor time a
 * unit of the elimination. A whole number past MAX_BITS stops it too: in the elimination, and in the
 * one denominator of an equation's terms or of a check's sum (a node with hundreds of resistors of
 * different values has a denominator of thousands of bits).
 */
export const MAX_WORK = 8_000_000;
const ROW_WORK = 2000;
const ENTRY_WORK = 16;
/** What one term counts when an equation or a check's sum is added up as whole numbers (MAX_WORK). */
export const TERM_WORK = 1000;
export const MAX_BITS = 4096;

/**
 * The work left for one netlist's exact solution and its checks (MAX_WORK); spent as they go. Each run's
 * checks get a budget of their own (describe.ts), from what the netlist's solve, worked out once, left:
 * the same text run again is checked again with the same budget, and decided the same way.
 */
export interface Budget {
  left: number;
}
/** A new budget of MAX_WORK. */
export const newBudget = (): Budget => ({ left: MAX_WORK });
/**
 * What one check of ngspice's values against the exact equations counts (`shares`, and `treeCurrents`
 * with diodes), before it starts: about four terms for each part and one for each unknown, TERM_WORK each.
 */
export const checkWork = (model: ExactModel): number => (4 * model.parts.length + model.size) * TERM_WORK;

/** What one entry written with numbers the size of x counts (MAX_WORK). */
function entryWork(x: bigint): number {
  const words = (x < 0n ? -x : x).toString(16).length / 16;
  return ENTRY_WORK + Math.max(1, words) ** 2;
}

class OverBudget extends Error {}

/** Takes `work` from the budget and gives up: undefined. */
function spent(budget: Budget, work: number): undefined {
  budget.left = Math.max(0, budget.left - work);
  return undefined;
}

/** a / b for whole numbers that divide exactly (Bareiss's elimination); throws when they do not, which would be a mistake here. */
function exactly(a: bigint, b: bigint): bigint {
  const q = a / b;
  if (q * b !== a) throw new OverBudget();
  return q;
}

/**
 * Solves the equations for each right-hand side, exactly, with whole numbers only: each equation is
 * first multiplied by the least common multiple of its denominators, then Bareiss's fraction-free
 * elimination keeps every number a determinant of a part of those equations (so no number grows
 * beyond the size of the whole determinant, and no common factor has to be searched for). The pivot is
 * the entry whose row and column have the fewest others (Markowitz's choice), so a circuit's sparse
 * equations stay sparse; a row the pivot's column does not touch is not rewritten, only its pending
 * factor is remembered (P_k / P_l, applied when the row is next used). The unknowns come out as whole
 * numbers over one common denominator, the determinant, by fraction-free back substitution: every
 * division is exact. Undefined when the equations have no single answer (a singular matrix), or when
 * the work grows past what `budget` has left (MAX_WORK for a new one) or a number past MAX_BITS. The
 * work done is taken from `budget`.
 */
export function solveExact(model: ExactModel, sides: Fraction[][], budget: Budget = newBudget()): Fraction[][] | undefined {
  const n = model.size;
  const eq = equations(model);
  const limit = 1n << BigInt(MAX_BITS);
  // Building the rows: each term counted before any is added (1,000 resistors at one node are 4,000 terms).
  let terms = 0;
  for (const row of eq) terms += row.length;
  let work = (terms + n * sides.length) * TERM_WORK;
  if (work > budget.left) {
    budget.left = 0;
    return undefined;
  }
  const rows: Map<number, bigint>[] = [];
  const rhs: bigint[][] = [];
  for (let r = 0; r < n; r++) {
    // The row's one denominator: the least common multiple of its terms', which must stay within MAX_BITS.
    let l = 1n;
    for (const t of eq[r]!) if (l % t.c.d !== 0n && (l = lcm(l, t.c.d)) > limit) return spent(budget, work);
    for (const side of sides) if (l % side[r]!.d !== 0n && (l = lcm(l, side[r]!.d)) > limit) return spent(budget, work);
    const row = new Map<number, bigint>();
    for (const t of eq[r]!) {
      const v = (row.get(t.k) ?? 0n) + t.c.n * (l / t.c.d);
      if (v === 0n) row.delete(t.k);
      else row.set(t.k, v);
    }
    rows.push(row);
    rhs.push(sides.map((side) => side[r]!.n * (l / side[r]!.d)));
  }
  const inColumn: Set<number>[] = Array.from({ length: n }, () => new Set());
  rows.forEach((row, r) => {
    for (const k of row.keys()) inColumn[k]!.add(r);
  });
  const done = new Uint8Array(n);
  /** The pivots in order; pivot[0] is 1. A row last made true at step l is made true at step k by × pivot[k] / pivot[l]. */
  const pivot: bigint[] = [1n];
  /** What an entry written with each pivot counts (entryWork). */
  const pivotWork: number[] = [entryWork(1n)];
  const epoch = new Int32Array(n);
  /** Brings row q's numbers to what they are after `step` steps. */
  const lift = (q: number, step: number): void => {
    const l = epoch[q]!;
    if (l === step) return;
    const [up, down] = [pivot[step]!, pivot[l]!];
    const row = rows[q]!;
    for (const [k, v] of row) row.set(k, exactly(v * up, down));
    const side = rhs[q]!;
    for (let s = 0; s < side.length; s++) side[s] = exactly(side[s]! * up, down);
    work += (row.size + side.length) * pivotWork[step]!;
    epoch[q] = step;
  };
  const order: { col: number; row: number }[] = [];
  try {
    for (let step = 1; step <= n; step++) {
      // Markowitz's choice: the pivot whose row and column have the fewest other entries.
      let col = -1;
      let r = -1;
      let cost = Number.POSITIVE_INFINITY;
      for (let k = 0; k < n && cost > 0; k++) {
        if (done[k]) continue;
        const rowsOf = inColumn[k]!;
        if (rowsOf.size === 0) return spent(budget, work);
        for (const q of rowsOf) {
          const c = (rowsOf.size - 1) * (rows[q]!.size - 1);
          if (c < cost) [cost, col, r] = [c, k, q];
        }
      }
      lift(r, step - 1);
      const pivotRow = rows[r]!;
      const from = rhs[r]!;
      const p = pivotRow.get(col)!;
      const before = pivot[step - 1]!;
      const each = entryWork(p);
      for (const q of Array.from(inColumn[col]!)) {
        if (q === r) continue;
        lift(q, step - 1);
        const row = rows[q]!;
        const side = rhs[q]!;
        const a = row.get(col)!;
        // Bareiss: (p × row − a × pivot row) / the step before's pivot, exactly.
        for (const [k, v] of row) if (!pivotRow.has(k)) row.set(k, exactly(p * v, before));
        for (const [k, c] of pivotRow) {
          const had = row.get(k);
          const v = exactly(p * (had ?? 0n) - a * c, before);
          if (v === 0n) {
            row.delete(k);
            inColumn[k]!.delete(q);
          } else {
            if (had === undefined) inColumn[k]!.add(q);
            row.set(k, v);
            if ((v < 0n ? -v : v) > limit) throw new OverBudget();
          }
        }
        for (let s = 0; s < side.length; s++) side[s] = exactly(p * side[s]! - a * from[s]!, before);
        work += ROW_WORK + (row.size + pivotRow.size + side.length) * each;
        epoch[q] = step;
        if (work > budget.left) throw new OverBudget();
      }
      for (const k of pivotRow.keys()) inColumn[k]!.delete(r);
      done[col] = 1;
      pivot.push(p);
      pivotWork.push(each);
      order.push({ col, row: r });
    }
  } catch (e) {
    if (e instanceof OverBudget) return spent(budget, work);
    throw e;
  }
  // Fraction-free back substitution: X = det × x is whole, and det × (pivot row's equation) gives it exactly.
  const det = pivot[n]!;
  const backEach = entryWork(det);
  for (const { row: r } of order) work += rows[r]!.size * sides.length * backEach;
  if (work > budget.left) return spent(budget, work);
  const X: bigint[][] = sides.map(() => Array.from({ length: n }, () => 0n));
  try {
    for (let i = order.length - 1; i >= 0; i--) {
      const { col, row: r } = order[i]!;
      const row = rows[r]!;
      const pk = row.get(col)!;
      for (let s = 0; s < sides.length; s++) {
        let v = det * rhs[r]![s]!;
        for (const [k, c] of row) if (k !== col) v -= c * X[s]![k]!;
        X[s]![col] = exactly(v, pk);
      }
    }
  } catch (e) {
    if (e instanceof OverBudget) return spent(budget, work);
    throw e;
  }
  budget.left -= work;
  // One common denominator, positive: x = X / det, not reduced (equal ones have equal X).
  const sign = det < 0n ? -1n : 1n;
  return X.map((side) => side.map((v) => (v === 0n ? ZERO : { n: v * sign, d: det * sign })));
}

/**
 * The unknowns of one solveExact solution as whole numbers over its one positive common denominator
 * (the determinant), so that sums and products of them need no common factor searched for: Euclid's
 * algorithm on numbers of thousands of bits is what made a long sweep and a 150-unknown grid slow.
 */
export function overCommon(x: readonly Fraction[]): { num: bigint[]; den: bigint } {
  let den = 1n;
  for (const v of x) {
    if (v.n !== 0n) {
      den = v.d;
      break;
    }
  }
  return {
    num: x.map((v) => {
      if (v.n !== 0n && v.d !== den) throw new RangeError('not one common denominator');
      return v.n;
    }),
    den,
  };
}

/**
 * A part's current, with SPICE's sign, as a double, from unknowns given as whole numbers over one
 * denominator (overCommon); rounded once, with no common factor searched for. `sourceLevel` is an I's
 * value in that solution (its own value when not given).
 */
export function currentDouble(model: ExactModel, num: readonly bigint[], den: bigint, k: number, sourceLevel?: Fraction): number {
  const p = model.parts[k]!;
  const at = (n: number): bigint => (n < 0 ? 0n : num[n]!);
  /** (top / den) × (fn / fd), with fd ≠ 0 of either sign. */
  const times = (top: bigint, fn: bigint, fd: bigint): number => {
    if (top === 0n || fn === 0n) return 0;
    const [n, d] = [top * fn, den * fd];
    return toDouble(d < 0n ? { n: -n, d: -d } : { n, d });
  };
  switch (p.kind) {
    case 'R':
      // (v(a) − v(b)) / R, R of either sign.
      return times(at(p.a) - at(p.b), p.value.d, p.value.n);
    case 'C':
      return 0;
    case 'I':
    case 'D':
      return toDouble(sourceLevel ?? p.value);
    case 'G':
      return times(at(p.c) - at(p.d), p.value.n, p.value.d);
    case 'F':
      return times(at(model.parts[p.control]!.branch), p.value.n, p.value.d);
    default:
      return times(at(p.branch), 1n, 1n);
  }
}

/** The least common multiple of two positive whole numbers. */
function lcm(a: bigint, b: bigint): bigint {
  return a === b || b === 1n ? a : a === 1n ? b : (a / gcd(a, b)) * b;
}

/** The right-hand side of the operating point: every source at its value. */
export const operatingPoint = (model: ExactModel): Fraction[] => rightHandSide(model, (p) => p.value);
/** The right-hand side of a slope: `part` at 1 (one volt or one amp), every other source at 0. */
export const unitSource = (model: ExactModel, part: number): Fraction[] => rightHandSide(model, (p) => (p === model.parts[part] ? ONE : ZERO));

/** True when a part's current is exactly 0, from the unknowns (comparisons only, no arithmetic). */
export function currentIsZero(model: ExactModel, x: readonly Fraction[], k: number, sourceLevel?: Fraction): boolean {
  const p = model.parts[k]!;
  const v = (n: number): Fraction => (n < 0 ? ZERO : x[n]!);
  switch (p.kind) {
    case 'R':
      return equal(v(p.a), v(p.b));
    case 'C':
      return true;
    case 'I':
    case 'D':
      return isZero(sourceLevel ?? p.value);
    case 'G':
      return isZero(p.value) || equal(v(p.c), v(p.d));
    case 'F':
      return isZero(p.value) || isZero(x[model.parts[p.control]!.branch]!);
    default:
      return isZero(x[p.branch]!);
  }
}

/** A part's current from the unknowns, with SPICE's sign (from its first node, through it, to its second). */
export function partCurrent(model: ExactModel, x: readonly Fraction[], k: number, sourceLevel?: Fraction): Fraction {
  const p = model.parts[k]!;
  const v = (n: number): Fraction => (n < 0 ? ZERO : x[n]!);
  switch (p.kind) {
    case 'R':
      return div(sub(v(p.a), v(p.b)), p.value);
    case 'C':
      return ZERO;
    case 'I':
    case 'D':
      return sourceLevel ?? p.value;
    case 'G':
      return mul(p.value, sub(v(p.c), v(p.d)));
    case 'F':
      return mul(p.value, x[model.parts[p.control]!.branch]!);
    default:
      return x[p.branch]!;
  }
}

// ------------------------------------------------------------------ the same circuit as ngspice's

/**
 * How much ngspice's own rounding may leave of the equations, as a share of the largest sum of the
 * sizes of an equation's terms of the same kind (Shares.equations). ngspice solves the equations of a
 * circuit of these parts once, with an LU factorisation in doubles (its Newton iterations of a linear
 * circuit repeat the same solution), and such a solution leaves a few units in the last place of the
 * whole system, times a growth factor that is small in practice. Measured on the 9,627 netlists of the
 * repository and the re-check's corpora that PlainSpice models exactly, run in our engine (wires of 1 µΩ, meters of 1e20 Ω, gains of
 * 1e9): at most 3.8e-15 for the nodes and 4.4e-11 for the branches, most below 2^-52. 2^-30 (about
 * 9.3e-10) leaves room above that. It says nothing of how far ngspice's answers are from the exact
 * ones where a tiny wire makes the equations ill-conditioned: `answersAgree` does.
 * A circuit other than ngspice's leaves more, measured on one with every kind of part: a node or part
 * it does not have fails at the names; a 9 V source, a gain of an E or of an H 1 ppm off leave 5e-7,
 * 1.8e-7 and 8.8e-9 here; an R, F, G or I value 1 ppm off leaves 1e-6 in its product (PRODUCT_SHARE).
 * A small source is weighed against the circuit's largest voltage, so a 1 pV source read as 1 nV in
 * that 9 V circuit leaves only 5.6e-11 and passes (as 1 µV, 5.6e-8, it fails). The values are read by
 * ngspice's own grammar (readExact, exactValue), so this check is there for a part ngspice simulates
 * differently from the model.
 */
export const RESIDUAL_SHARE = 2 ** -30;
/**
 * A part's current as ngspice reports it is its own numbers' product to a few units in the last place:
 * at most 3.4e-16 over the same 7,756 circuits, against 2^-40 (about 9.1e-13) allowed.
 */
export const PRODUCT_SHARE = 2 ** -40;

/** What ngspice gave for one solution: node voltages by name, branch and part currents by part. */
export interface NgspiceValues {
  /** A node's voltage as ngspice spells the node; undefined when it gave none. */
  voltage(node: string): number | undefined;
  /** The current of a V, E, H or L (its branch); undefined when it gave none. */
  branch(part: string): number | undefined;
  /** The current of another part (savecurrents: @r1[i]); undefined when it gave none. */
  device(part: string): number | undefined;
}

/**
 * A number m / (q × 2^e) with whole m, q > 0 and e of either sign: a double (q = 1) times a value the
 * netlist writes (q its denominator). The checks of ngspice's values add such numbers as whole numbers
 * over one denominator, with no common factor searched for: the powers of 2 by shifting, the q by their
 * least common multiple, which stays small (a resistor's value, a power of ten).
 */
interface Dyadic {
  m: bigint;
  q: bigint;
  e: number;
}

const dyadicView = new DataView(new ArrayBuffer(8));
/** A finite double as m / 2^e exactly (q = 1; m not reduced). */
function dyadic(v: number): Dyadic {
  if (v === 0) return { m: 0n, q: 1n, e: 0 };
  dyadicView.setFloat64(0, v);
  const hi = dyadicView.getUint32(0);
  const lo = dyadicView.getUint32(4);
  const exponent = (hi >>> 20) & 0x7ff;
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (exponent !== 0) mantissa |= 1n << 52n;
  return { m: v < 0 ? -mantissa : mantissa, q: 1n, e: 1075 - (exponent === 0 ? 1 : exponent) };
}
/** x × f for a fraction f (its sign into m, its denominator into q). */
const times = (x: Dyadic, f: Fraction): Dyadic => (f.d < 0n ? { m: -x.m * f.n, q: -x.q * f.d, e: x.e } : { m: x.m * f.n, q: x.q * f.d, e: x.e });
const negD = (x: Dyadic): Dyadic => ({ m: -x.m, q: x.q, e: x.e });
/** A fraction as a Dyadic: a power of 2 below goes into e (a swept source's double), anything else into q. */
function dyadicOf(f: Fraction): Dyadic {
  if (f.d !== 1n && (f.d & (f.d - 1n)) === 0n) return { m: f.n, q: 1n, e: bitLength(f.d) - 1 };
  return { m: f.n, q: f.d, e: 0 };
}
/** x − y for two doubles' Dyadics (q = 1), over 2^max(e). */
function minusD(x: Dyadic, y: Dyadic): Dyadic {
  const e = Math.max(x.e, y.e);
  return { m: (x.m << BigInt(e - x.e)) - (y.m << BigInt(e - y.e)), q: 1n, e };
}
const absBig = (x: bigint): bigint => (x < 0n ? -x : x);

/**
 * The terms of one equation added up as whole numbers over one denominator: the residual |Σ terms| and
 * the size Σ |terms| as the fractions value/den and size/den. Undefined when the denominator's odd part
 * passes MAX_BITS (thousands of resistors of different values at one node), which leaves the decision
 * to the other rule.
 */
function sumOf(terms: readonly Dyadic[], limit: bigint): { value: bigint; size: bigint; den: bigint } | undefined {
  let q = 1n;
  let e = Number.NEGATIVE_INFINITY;
  for (const t of terms) {
    if (t.m === 0n) continue;
    if (q % t.q !== 0n && (q = lcm(q, t.q)) > limit) return undefined;
    if (t.e > e) e = t.e;
  }
  if (e === Number.NEGATIVE_INFINITY) return { value: 0n, size: 0n, den: 1n };
  let value = 0n;
  let size = 0n;
  for (const t of terms) {
    if (t.m === 0n) continue;
    const scaled = (t.m * (q / t.q)) << BigInt(e - t.e);
    value += scaled;
    size += absBig(scaled);
  }
  // den = q × 2^e; e can be below 0 for a double of 2^53 or more.
  return e >= 0 ? { value: absBig(value), size, den: q << BigInt(e) } : { value: absBig(value) << BigInt(-e), size: size << BigInt(-e), den: q };
}

/** The terms of one equation added up exactly, with their sign, as a fraction not in lowest terms; undefined when its denominator passes `limit`. */
function signedSum(terms: readonly Dyadic[], limit: bigint): Fraction | undefined {
  let q = 1n;
  let e = Number.NEGATIVE_INFINITY;
  for (const t of terms) {
    if (t.m === 0n) continue;
    if (q % t.q !== 0n && (q = lcm(q, t.q)) > limit) return undefined;
    if (t.e > e) e = t.e;
  }
  if (e === Number.NEGATIVE_INFINITY) return ZERO;
  let value = 0n;
  for (const t of terms) if (t.m !== 0n) value += (t.m * (q / t.q)) << BigInt(e - t.e);
  if (value === 0n) return ZERO;
  return e >= 0 ? { n: value, d: q << BigInt(e) } : { n: value << BigInt(-e), d: q };
}

/**
 * The currents of the diodes in `tree` (one per branch of a forest of the diodes' graph, describe.ts)
 * that make Kirchhoff's current law hold exactly, with ngspice's node voltages and branch currents, at
 * every node of each tree but one, whose law `agrees` then checks. A diode's current is the rest of the
 * currents at a node where it is the last diode of the tree, worked from the leaves in. The node left out
 * of each tree is the one whose law ngspice's rounding leaves farthest from 0, by an estimate in doubles
 * (a resistor's current, worked out from the voltages at its ends, can be off by a unit in the last place
 * of each over its resistance; a branch's by a unit in its own last place), and ground can be one of the
 * others: its law has only the parts that touch it. A 1 nΩ wire beside a diode made the diode's current
 * from the wire's node 4.1e-10 A where it carried 6.5e-15 A (one step of a double at 4.5 mV over 1 nΩ is
 * 8.7e-10 A), and a warning gave the exact values worked out from it, 1e-4 off. Every other diode (on a
 * loop of diodes) carries 0: its current adds nothing at a node that the tree's cannot, and only what the
 * diodes add at each node reaches the rest of the circuit. ngspice's own diode currents are not used: it
 * reports the current of its last iteration, which can be 1e-4 of it away (a diode with a 10 Ω series
 * resistance). Undefined when a value is missing, a sum's denominator passes MAX_BITS, or `budget` has
 * less left than a check counts (`checkWork`, taken from it).
 */
export function treeCurrents(model: ExactModel, tree: readonly number[], ng: NgspiceValues, budget: Budget = newBudget()): Map<number, Fraction> | undefined {
  // Counted as one check of ngspice's values (its terms are a check's), before it starts.
  const work = checkWork(model);
  if (work > budget.left) {
    budget.left = 0;
    return undefined;
  }
  budget.left -= work;
  const volts: Dyadic[] = [];
  const doubles: number[] = [];
  for (const n of model.nodes) {
    const v = ng.voltage(n);
    if (v === undefined || !Number.isFinite(v)) return undefined;
    volts.push(dyadic(v));
    doubles.push(v);
  }
  const branch = new Map<number, Dyadic>();
  const branchDoubles = new Map<number, number>();
  for (const p of model.parts) {
    if (p.branch < 0) continue;
    const i = ng.branch(p.key);
    if (i === undefined || !Number.isFinite(i)) return undefined;
    branch.set(p.branch, dyadic(i));
    branchDoubles.set(p.branch, i);
  }
  const v = (n: number): Dyadic => (n < 0 ? { m: 0n, q: 1n, e: 0 } : volts[n]!);
  const vd = (n: number): number => (n < 0 ? 0 : doubles[n]!);
  // The current leaving each node through the parts other than diodes, ground's last (at `ground`), and what
  // ngspice's rounding may leave in each node's sum.
  const ground = model.nodes.length;
  const at = (n: number): number => (n < 0 ? ground : n);
  const leaving: Dyadic[][] = Array.from({ length: ground + 1 }, () => []);
  const rounding = new Float64Array(ground + 1);
  for (const p of model.parts) {
    let t: Dyadic[] = [];
    let off = 0;
    if (p.kind === 'R') {
      const g: Fraction = { n: p.value.d, d: p.value.n };
      t = [times(v(p.a), g), negD(times(v(p.b), g))];
      off = (ulp(vd(p.a)) + ulp(vd(p.b))) / Math.abs(toDouble(p.value));
    } else if (p.kind === 'I') t = [dyadicOf(p.value)];
    else if (p.kind === 'G') {
      t = [times(v(p.c), p.value), negD(times(v(p.d), p.value))];
      off = Math.abs(toDouble(p.value)) * (ulp(vd(p.c)) + ulp(vd(p.d)));
    } else if (p.kind === 'F') {
      t = [times(branch.get(model.parts[p.control]!.branch)!, p.value)];
      off = Math.abs(toDouble(p.value)) * ulp(branchDoubles.get(model.parts[p.control]!.branch)!);
    } else if (p.branch >= 0) {
      t = [branch.get(p.branch)!];
      off = ulp(branchDoubles.get(p.branch)!);
    }
    for (const x of t) {
      leaving[at(p.a)]!.push(x);
      leaving[at(p.b)]!.push(negD(x));
    }
    for (const n of [at(p.a), at(p.b)]) rounding[n] = rounding[n]! + off;
  }
  const limit = 1n << BigInt(MAX_BITS + 2200);
  const sums = new Map<number, Fraction>();
  const sumAt = (n: number): Fraction | undefined => {
    let s = sums.get(n);
    if (s === undefined) {
      s = signedSum(leaving[n]!, limit);
      if (s === undefined) return undefined;
      sums.set(n, s);
    }
    return s;
  };
  const edges = new Map<number, Set<number>>();
  const link = (n: number, k: number): void => {
    const set = edges.get(n);
    if (set) set.add(k);
    else edges.set(n, new Set([k]));
  };
  for (const k of tree) {
    link(at(model.parts[k]!.a), k);
    link(at(model.parts[k]!.b), k);
  }
  // Each tree's node left out: the one whose sum ngspice's rounding leaves farthest from 0 (ground on a tie).
  const roots = new Set<number>();
  const seen = new Set<number>();
  for (const start of edges.keys()) {
    if (seen.has(start)) continue;
    let root = start;
    const stack = [start];
    seen.add(start);
    for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
      if (rounding[n]! > rounding[root]! || (rounding[n] === rounding[root] && n === ground)) root = n;
      for (const k of edges.get(n)!) {
        const p = model.parts[k]!;
        for (const m of [at(p.a), at(p.b)]) {
          if (!seen.has(m)) {
            seen.add(m);
            stack.push(m);
          }
        }
      }
    }
    roots.add(root);
  }
  const out = new Map<number, Fraction>();
  const queue = [...edges.keys()].filter((n) => !roots.has(n) && edges.get(n)!.size === 1);
  for (let n = queue.pop(); n !== undefined; n = queue.pop()) {
    const set = edges.get(n)!;
    if (set.size !== 1) continue;
    const [k] = set;
    const p = model.parts[k!]!;
    const rest = sumAt(n);
    if (rest === undefined) return undefined;
    // What leaves n through the diode makes the currents leaving n add up to 0.
    const i = n === at(p.a) ? neg(rest) : rest;
    out.set(k!, i);
    set.delete(k!);
    const m = n === at(p.a) ? at(p.b) : at(p.a);
    const other = edges.get(m)!;
    other.delete(k!);
    const had = sumAt(m);
    if (had === undefined) return undefined;
    const now = add(had, m === at(p.a) ? i : neg(i));
    if ((now.d < 0n ? -now.d : now.d) > limit) return undefined;
    sums.set(m, now);
    if (other.size === 1 && !roots.has(m)) queue.push(m);
  }
  return out;
}

/**
 * The unknowns of the operating point with each diode in `tree` at the current `currents` gives it: x0
 * (each diode at 0 A) plus each diode's current times the change a unit current through it makes
 * (`slopes`), over one common denominator (solveExact's, times that of the currents), so overCommon and
 * currentDouble take it.
 */
export function withCurrents(x0: readonly Fraction[], slopes: readonly Fraction[][], tree: readonly number[], currents: ReadonlyMap<number, Fraction>): Fraction[] {
  let det = 1n;
  for (const list of [x0, ...slopes]) for (const v of list) if (v.n !== 0n) det = v.d;
  let d = 1n;
  for (const k of tree) {
    const c = currents.get(k) ?? ZERO;
    if (c.n !== 0n && d % c.d !== 0n) d = lcm(d, c.d);
  }
  const num = x0.map((v) => (v.n === 0n ? 0n : v.n * d));
  tree.forEach((k, j) => {
    const c = currents.get(k) ?? ZERO;
    if (c.n === 0n) return;
    const f = c.n * (d / c.d);
    slopes[j]!.forEach((v, i) => {
      if (v.n !== 0n) num[i] = num[i]! + v.n * f;
    });
  });
  return num.map((n) => (n === 0n ? ZERO : { n, d: det * d }));
}

/** How closely ngspice's values solve this model's equations (`shares`), as fractions not in lowest terms. */
export interface Shares {
  /**
   * The largest amount by which ngspice's values leave one of the equations unbalanced, over the largest
   * sum of the sizes of the terms of any equation of the same kind: Kirchhoff's current law at the
   * nodes (in amps), and the own equations of the V, E, H and L (in volts). ngspice solves all the
   * equations together, with one LU factorisation in doubles, so what its rounding leaves in an equation
   * is a share of the whole system, not of that equation's own terms: a chain of 0 V sources that
   * carries no current can show 1e-16 A against 1e-16 A, and a 0 V source next to a 1 mΩ wire 8e-10 V
   * against 9 V (decision 0015). Measured over the 9,627 netlists of the re-check's corpora and the
   * repository that PlainSpice models exactly: at most 3.8e-15 for the nodes and 4.4e-11 for the branches.
   */
  equations: Fraction;
  /**
   * Each R, F, G and I whose current ngspice reports (savecurrents): its gap from its own numbers'
   * product (a resistor's voltage over its resistance, an F's gain times the current it reads), over
   * that product. Only where the product is well defined by the doubles: not a difference of two
   * node voltages that are nearly the same (there one unit in the last place of either is a large
   * share of it), nor below the smallest normal double.
   */
  products: Fraction;
}

/** The larger of two fractions with positive denominators (not in lowest terms), by cross-multiplying. */
const larger = (a: Fraction, b: Fraction): Fraction => (b.n * a.d > a.n * b.d ? b : a);

/**
 * How closely ngspice's values solve this model's equations (Shares). `level` gives each independent
 * source's value in that solution. Undefined when a value the equations need is missing, when an
 * equation's one denominator passes MAX_BITS, or when the check would take more work than `budget` has
 * left (each term counts TERM_WORK; the work is taken from `budget`).
 */
export function shares(model: ExactModel, ng: NgspiceValues, level: (p: ExactPart) => Fraction, budget: Budget = newBudget()): Shares | undefined {
  const volts: (Dyadic | undefined)[] = model.nodes.map((n) => {
    const v = ng.voltage(n);
    return v === undefined || !Number.isFinite(v) ? undefined : dyadic(v);
  });
  if (volts.some((v) => v === undefined)) return undefined;
  const branch = new Map<number, Dyadic>();
  for (const p of model.parts) {
    if (p.branch < 0) continue;
    const i = ng.branch(p.key);
    if (i === undefined || !Number.isFinite(i)) return undefined;
    branch.set(p.branch, dyadic(i));
  }
  const v = (n: number): Dyadic => (n < 0 ? { m: 0n, q: 1n, e: 0 } : volts[n]!);
  // Every term is counted before any is added: about four for each part.
  const work = checkWork(model);
  if (work > budget.left) {
    budget.left = 0;
    return undefined;
  }
  budget.left -= work;
  const nodeTerms: Dyadic[][] = model.nodes.map(() => []);
  const ownTerms: Dyadic[][] = [];
  let products: Fraction = ZERO;
  /** v(x) − v(y) is not a near cancellation of the two: at least 2^-20 of the larger. */
  const resolved = (x: number, y: number): boolean => {
    const d = minusD(v(x), v(y));
    const e = d.e;
    const big = [v(x), v(y)].reduce((m, t) => {
      const s = absBig(t.m << BigInt(e - t.e));
      return s > m ? s : m;
    }, 0n);
    return absBig(d.m) << 20n >= big;
  };
  for (const p of model.parts) {
    let terms: Dyadic[] = [];
    let product: Dyadic | undefined;
    switch (p.kind) {
      case 'R': {
        const g: Fraction = { n: p.value.d, d: p.value.n };
        terms = [times(v(p.a), g), negD(times(v(p.b), g))];
        if (resolved(p.a, p.b)) product = times(minusD(v(p.a), v(p.b)), g);
        break;
      }
      case 'C':
        break;
      case 'I':
        product = dyadicOf(level(p));
        terms = [product];
        break;
      case 'D':
        // Its current as the solution gives it (Kirchhoff's law at its node); ngspice reports the current of its
        // last iteration, which can be 1e-4 of it away (a diode with a 10 Ω series resistance), so no product.
        terms = [dyadicOf(level(p))];
        break;
      case 'G':
        terms = [times(v(p.c), p.value), negD(times(v(p.d), p.value))];
        if (resolved(p.c, p.d)) product = times(minusD(v(p.c), v(p.d)), p.value);
        break;
      case 'F':
        product = times(branch.get(model.parts[p.control]!.branch)!, p.value);
        terms = [product];
        break;
      default: {
        terms = [branch.get(p.branch)!];
        // Its own equation: v(a) − v(b) and what the part makes of it.
        const own = [v(p.a), negD(v(p.b))];
        if (p.kind === 'V') own.push(negD(dyadicOf(level(p))));
        else if (p.kind === 'E') own.push(negD(times(v(p.c), p.value)), times(v(p.d), p.value));
        else if (p.kind === 'H') own.push(negD(times(branch.get(model.parts[p.control]!.branch)!, p.value)));
        ownTerms.push(own);
      }
    }
    for (const t of terms) {
      if (p.a >= 0) nodeTerms[p.a]!.push(t);
      if (p.b >= 0) nodeTerms[p.b]!.push(negD(t));
    }
    if (product !== undefined && product.m !== 0n) {
      const reported = ng.device(p.key);
      if (reported !== undefined) {
        if (!Number.isFinite(reported)) return undefined;
        // Over the denominator q × 2^e of both: the product's size, and its gap from what ngspice reported.
        const r = dyadic(reported);
        const e = Math.max(product.e, r.e);
        const size = absBig(product.m) << BigInt(e - product.e);
        const gap = absBig(((r.m * product.q) << BigInt(e - r.e)) - size * (product.m < 0n ? -1n : 1n));
        // Below the smallest normal double a product has fewer digits: gaps that small say nothing.
        const normal = e < 0 || size << 1022n >= product.q << BigInt(e);
        if (normal) products = larger(products, gap === 0n ? ZERO : { n: gap, d: size });
      }
    }
  }
  // Each kind of equation against its own kind: Kirchhoff's law at the nodes in amps, the branches' own
  // equations in volts (a 9 V source's equation made a node's 5 nA of misread current look like nothing).
  const limit = 1n << BigInt(MAX_BITS);
  const share = (list: readonly Dyadic[][]): Fraction | undefined => {
    let largest: Fraction = ZERO;
    let left: Fraction = ZERO;
    for (const terms of list) {
      const s = sumOf(terms, limit);
      if (!s) return undefined;
      largest = larger(largest, { n: s.size, d: s.den });
      left = larger(left, { n: s.value, d: s.den });
    }
    return left.n === 0n ? ZERO : largest.n === 0n ? ONE : { n: left.n * largest.d, d: left.d * largest.n };
  };
  const atNodes = share(nodeTerms);
  const atBranches = share(ownTerms);
  if (!atNodes || !atBranches) return undefined;
  return { equations: larger(atNodes, atBranches), products };
}

/**
 * True when ngspice's values solve this model's equations as closely as its own rounding can
 * (RESIDUAL_SHARE), and the other parts' currents it reports are their own numbers' products
 * (PRODUCT_SHARE): then the model is the circuit ngspice simulated, and every difference between its
 * values and the exact ones (the noise of a 0 among them) is what that rounding leaves.
 */
export function agrees(model: ExactModel, ng: NgspiceValues, level: (p: ExactPart) => Fraction, budget: Budget = newBudget()): boolean {
  const s = shares(model, ng, level, budget);
  return !!s && compare(s.equations, fromDouble(RESIDUAL_SHARE)) <= 0 && compare(s.products, fromDouble(PRODUCT_SHARE)) <= 0;
}

// ------------------------------------------------------------------ ngspice's answers beside the exact ones

/**
 * How far ngspice's answer may be from the exact one, as a share of it: 5e-5, less than half a unit in
 * the last of the 4 significant digits the page shows a value with, whatever its first digits (half a
 * unit of 9.999 is 5e-5 of it, of 1.000 5e-4). Within it, ngspice's number is drawn with the exact
 * value's digits, or one unit off in the last where the exact value lies that close to a rounding
 * boundary, so the 0s and the exact values PlainSpice puts in place of ngspice's rounding agree with
 * ngspice's own numbers beside them to the page's digits, wherever those are not tiny beside the others
 * of their kind (ANSWER_FLOOR). ngspice solves a well-conditioned circuit to a few units in the
 * last place of a double (about 1e-16 of a value). A wire far smaller than the resistors around it
 * makes the equations ill-conditioned, and ngspice's answers can then be far off while what they leave
 * of the equations stays small (`agrees`): a 1e-12 Ω wire in the middle branch of a balanced bridge
 * gives its ends as 4.321 V and 4.374 V where the circuit makes both 4.5 V (the critic of the re-check's
 * fixes). There PlainSpice shows ngspice's numbers, by the rule for other circuits, and says that they
 * are off (decision 0015).
 */
export const ANSWER_GAP = 5e-5;
/**
 * What ngspice's rounding may add to the gap of an answer, as a share of the size of the terms of the
 * equations that fix it (`answerScales`): an answer tiny beside the numbers it is worked out from can be
 * off by more than ANSWER_GAP of itself with nothing wrong (a source's 2 aA through 1 kΩ from 12 V is
 * worked out from 12 V, one step of which over 1 kΩ is 1.8 aA, C9h). ngspice's LU solution leaves each
 * equation a few units in the last place of the sizes of its terms (what it leaves of the equations was
 * at most 3.8e-15 of their sizes over the 9,627 netlists of the corpora and the repository that
 * PlainSpice models exactly, RESIDUAL_SHARE), and an unknown that equation fixes is off by that over
 * the equation's own coefficient, where the circuit is well conditioned. 2^-30 (about 9.3e-10) leaves room
 * above that. The scale is each answer's own, not the circuit's largest value: an open-loop E making
 * 1.2 MV beside a bridge at a few millivolts made the floor 1.1 mV for every node, and hid ngspice's
 * 4.882 mV there, 5.9 % from the exact 5.189 mV, which then sat beside a 0 claiming one voltage for both
 * ends of R5 (the critic of round 3 of the re-check's fixes). The bridge's own equations have terms of a
 * few millivolts over its conductances, so its floor is about 1e-11 V, and the 3.1e-4 V gap is caught.
 */
export const ANSWER_FLOOR = 2 ** -30;

/**
 * The scale of each answer for ANSWER_FLOOR, from the exact values `v` (node voltages) and `branchI` (the
 * current of each V, E, H and L, by its branch unknown), in doubles (only a scale): what ngspice works the
 * answer out from, near the answer, not anywhere in the circuit.
 * - A node voltage: the sizes of the terms of Kirchhoff's current law at the node (each resistor's
 *   |v(a)|/R and |v(b)|/R, each source's current) over the node's own conductance, and the sizes of the own
 *   equation of each V, E, H or L at the node (|v(a)| + |v(b)| and what the part makes); the larger. A 1 nΩ
 *   probe wire on a ladder node of 43.56 fV makes that node's terms about 1e-13 V, and ngspice's 43.55 fV
 *   there (its Schur complement loses digits beside the wire's 1e9 S) is caught, where 2^-30 of the 5 V
 *   source at the ladder's other end let it through.
 * - A current: the largest current that flows at its nodes, of the parts there (for a V, E, H or L, at
 *   every node it joins with other such parts: a chain of 0 V ammeters carries a current that Kirchhoff's
 *   law fixes at the chain's ends, where milliamps meet). A current tiny beside the others at its nodes is
 *   held only to the floor (a 0 V ammeter beside milliamps); one that is as large as any there is held to
 *   ANSWER_GAP of itself: in a loop of a 12 V source, 1 kΩ and a source of 2 aA, ngspice gives V1 1.735 aA,
 *   with no correct digit beyond the first, and the warning says so (C9h).
 * The parts of the circuit that conduct to each other (ground taken out) are weighed on their own: an E
 * making 1.2 MV from the 12 V it reads, into a load of its own, leaves the 12 V's floor alone, since
 * ngspice's rounding of what a source makes does not reach what it reads. What a controlled source makes
 * in another such part carries its gain times the scale of what it reads there: ngspice's rounding of a
 * 0 V ammeter's current beside milliamps reaches what an H of 1 GΩ makes of it, 1e9 times larger (an H
 * reading a bridge 1e-14 off balance makes −219.6 pV, which ngspice gives as −223.6 pV, since the
 * ammeter's 1.83 fA comes out as 1.86 fA beside the bridge's milliamps), so a floor from the H's own values
 * would call the ammeter fine and the H's output off. Within one part a source reading its own part (an
 * amplifier with feedback) is solved with it, and the margin of 2^-30 covers it. Where there is nothing to
 * weigh by, the largest value of its kind stands in.
 */
export function answerScales(model: ExactModel, v: readonly number[], branchI: (p: ExactPart) => number, level: (p: ExactPart) => number): { volts: number[]; amps: (p: ExactPart) => number } {
  const n = model.nodes.length;
  const at = (k: number): number => (k < 0 ? 0 : Math.abs(v[k]!));
  const signed = (k: number): number => (k < 0 ? 0 : v[k]!);
  const largestV = v.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  /** Union-find over the nodes (ground, -1, is never joined). */
  const groups = (): { find: (k: number) => number; join: (a: number, b: number) => void } => {
    const up = Int32Array.from({ length: n }, (_, k) => k);
    const find = (k: number): number => {
      while (up[k] !== k) k = up[k] = up[up[k]!]!;
      return k;
    };
    return { find, join: (a, b) => (a >= 0 && b >= 0 ? void (up[find(a)] = find(b)) : undefined) };
  };
  // The parts that conduct to each other, and the nodes the V, E, H and L join.
  const part = groups();
  const joined = groups();
  /** Per node: the sizes of the terms of Kirchhoff's law (amps), its conductance, the largest own equation of a branch there (volts), and the largest current that flows there. */
  const terms = new Float64Array(n);
  const conductance = new Float64Array(n);
  const own = new Float64Array(n);
  const flow = new Float64Array(n);
  let largestI = 0;
  const add = (p: ExactPart, size: number, current: number): void => {
    const c = Math.abs(current);
    for (const k of [p.a, p.b]) {
      if (k < 0) continue;
      if (Number.isFinite(size)) terms[k] = terms[k]! + size;
      if (Number.isFinite(c) && c > flow[k]!) flow[k] = c;
    }
    if (Number.isFinite(c) && c > largestI) largestI = c;
  };
  for (const p of model.parts) {
    if (p.kind === 'C') continue;
    part.join(p.a, p.b);
    const gain = Math.abs(toDouble(p.value));
    if (p.kind === 'R') {
      const g = 1 / gain;
      add(p, (at(p.a) + at(p.b)) * g, (signed(p.a) - signed(p.b)) * g);
      for (const k of [p.a, p.b]) if (k >= 0) conductance[k] = conductance[k]! + g;
    } else if (p.kind === 'I' || p.kind === 'D') add(p, Math.abs(level(p)), level(p));
    else if (p.kind === 'G') {
      add(p, gain * (at(p.c) + at(p.d)), gain * (signed(p.c) - signed(p.d)));
      // A G that reads its own node acts there as a conductance.
      for (const k of [p.a, p.b]) if (k >= 0 && (k === p.c || k === p.d)) conductance[k] = conductance[k]! + gain;
    } else if (p.kind === 'F') {
      const i = gain * branchI(model.parts[p.control]!);
      add(p, Math.abs(i), i);
    } else {
      joined.join(p.a, p.b);
      add(p, Math.abs(branchI(p)), branchI(p));
      const makes = p.kind === 'V' ? gain : p.kind === 'E' ? gain * (at(p.c) + at(p.d)) : p.kind === 'H' ? gain * Math.abs(branchI(model.parts[p.control]!)) : 0;
      const size = at(p.a) + at(p.b) + makes;
      for (const k of [p.a, p.b]) if (k >= 0 && size > own[k]!) own[k] = size;
    }
  }
  const ok = (s: number, otherwise: number): number => (Number.isFinite(s) && s > 0 ? s : otherwise);
  const volts0 = Array.from({ length: n }, (_, k) => ok(Math.max(conductance[k]! > 0 ? terms[k]! / conductance[k]! : 0, own[k]!), largestV));
  const flowJoined = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const r = joined.find(k);
    if (flow[k]! > flowJoined[r]!) flowJoined[r] = flow[k]!;
  }
  // What controlled sources carry into another part of the circuit: a voltage scale (E, H) and a current
  // scale (G, F) for each part, worked through chains of them as many times as there are controlled sources.
  const carriedV = new Float64Array(n);
  const carriedI = new Float64Array(n);
  const scaleV = (k: number): number => {
    if (k < 0) return 0;
    const r = part.find(k);
    return Math.max(volts0[k]!, carriedV[r]!, conductance[k]! > 0 ? carriedI[r]! / conductance[k]! : 0);
  };
  const amps = (p: ExactPart): number => {
    let s = 0;
    for (const k of [p.a, p.b]) {
      if (k < 0) continue;
      const r = part.find(k);
      s = Math.max(s, p.branch >= 0 ? flowJoined[joined.find(k)]! : flow[k]!, carriedI[r]!, carriedV[r]! * conductance[k]!);
    }
    return ok(s, largestI);
  };
  const controlled = model.parts.filter((p) => p.kind === 'E' || p.kind === 'G' || p.kind === 'F' || p.kind === 'H');
  for (let pass = 0; pass < controlled.length; pass++) {
    let changed = false;
    for (const p of controlled) {
      const out = p.a >= 0 ? p.a : p.b;
      if (out < 0) continue;
      const r = part.find(out);
      const control = p.kind === 'F' || p.kind === 'H' ? model.parts[p.control]! : undefined;
      const reads = control ? [control.a, control.b] : [p.c, p.d];
      if (reads.some((k) => k >= 0 && part.find(k) === r)) continue;
      const gain = Math.abs(toDouble(p.value));
      const size = gain * (control ? amps(control) : scaleV(p.c) + scaleV(p.d));
      const into = p.kind === 'E' || p.kind === 'H' ? carriedV : carriedI;
      if (Number.isFinite(size) && size > into[r]!) {
        into[r] = size;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const volts = Array.from({ length: n }, (_, k) => scaleV(k));
  return { volts, amps };
}

/** One of ngspice's answers beside the exact one: a node voltage, or the current of a V, E, H or L. */
export interface Answer {
  kind: 'voltage' | 'current';
  /** The node or the part, as ngspice spells it. */
  name: string;
  exact: number;
  given: number;
  /**
   * How far it is, beyond what rounding leaves (ANSWER_FLOOR of its scale, `answerScales`), as a share of
   * the exact value; for an exact value of 0, 0 within what rounding leaves and Infinity beyond it.
   */
  gap: number;
}

/**
 * ngspice's answers beside the exact unknowns `x` of one solution: every node voltage and every V, E, H
 * and L current. The current of an R, F or G is not among them: ngspice works it out from these answers
 * (a resistor's from the voltages at its ends, which can cancel to a few digits), and `agrees` holds it
 * to that product. With `devices`, for the note that names the answers that are off, the current of each
 * R, G and F that ngspice reports follows them (a wire ngspice gives as 0 A where 46.46 µA flows).
 * Undefined when ngspice gave no value for one of the answers. Worked out in doubles from the
 * exact values (each rounded once, with no arithmetic on the fractions): a bound of 5e-5 needs no more.
 * Each answer is held to ANSWER_FLOOR of its own scale (`answerScales`): a 0 V ammeter beside milliamps
 * is weighed against the milliamps that flow at its nodes, a node against the terms of its own equations.
 */
export function answers(model: ExactModel, x: readonly Fraction[], ng: NgspiceValues, level: (p: ExactPart) => Fraction = (p) => p.value, devices = false): Answer[] | undefined {
  const exactV = model.nodes.map((_, k) => (isZero(x[k]!) ? 0 : toDouble(x[k]!)));
  const branches = model.parts.filter((p) => p.branch >= 0);
  const exactI = branches.map((p) => (isZero(x[p.branch]!) ? 0 : toDouble(x[p.branch]!)));
  const branchOf = new Map(branches.map((p, k) => [p.branch, exactI[k]!]));
  const { volts, amps } = answerScales(model, exactV, (p) => branchOf.get(p.branch) ?? 0, (p) => toDouble(level(p)));
  const out: Answer[] = [];
  const one = (kind: Answer['kind'], name: string, exact: number, given: number | undefined, scale: number): boolean => {
    if (given === undefined || !Number.isFinite(given)) return false;
    const beyond = Math.max(0, Math.abs(given - exact) - ANSWER_FLOOR * scale);
    out.push({ kind, name, exact, given, gap: exact !== 0 ? beyond / Math.abs(exact) : beyond > 0 ? Number.POSITIVE_INFINITY : 0 });
    return true;
  };
  for (let k = 0; k < model.nodes.length; k++) if (!one('voltage', model.nodes[k]!, exactV[k]!, ng.voltage(model.nodes[k]!), volts[k]!)) return undefined;
  for (let k = 0; k < branches.length; k++) if (!one('current', branches[k]!.key, exactI[k]!, ng.branch(branches[k]!.key), amps(branches[k]!))) return undefined;
  if (devices) {
    // For the note only, never for the decision: each R, G and F whose current ngspice reports, exact from the
    // unknowns over one denominator (a resistor's ends can be nearly the same voltage).
    const whole = overCommon(x);
    model.parts.forEach((p, k) => {
      if (p.kind !== 'R' && p.kind !== 'G' && p.kind !== 'F') return;
      one('current', p.key, currentDouble(model, whole.num, whole.den, k), ng.device(p.key), amps(p));
    });
  }
  return out;
}

/**
 * The largest gap of ngspice's answers from the exact unknowns `x` beyond what rounding leaves, as a
 * share of the exact value (`answers`), over the answers whose exact value is not 0: 0 when every one is
 * within ANSWER_FLOOR of the largest of its kind. What ngspice gives for an exact 0 is not weighed here:
 * roundingNoise decides it, and an H of 1 GΩ lifts a balanced bridge's rounding to 193.5 nV with every
 * other answer exact to 16 digits (C9o). Undefined when ngspice gave no value for one of them.
 */
export function answersGap(model: ExactModel, x: readonly Fraction[], ng: NgspiceValues): number | undefined {
  const list = answers(model, x, ng);
  return list?.reduce((m, a) => (a.exact !== 0 ? Math.max(m, a.gap) : m), 0);
}

/** True when each of ngspice's answers is within ANSWER_GAP of the exact one, beyond what rounding leaves (answersGap). */
export function answersAgree(model: ExactModel, x: readonly Fraction[], ng: NgspiceValues): boolean {
  const gap = answersGap(model, x, ng);
  return gap !== undefined && gap <= ANSWER_GAP;
}
