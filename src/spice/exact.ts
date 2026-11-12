/**
 * The operating point of a circuit worked out exactly, with fractions: what PlainSpice uses to tell a
 * value the circuit makes exactly 0 from a tiny real one (rounding noise, decision 0015; C9 to C9p in
 * docs/spice-facts/explanations.md). Plain TypeScript: no floating point in the solution, BigInt
 * fractions only.
 *
 * - `readExact` reads a value word the way ngspice reads it (src/spice/numbers.ts: its scale letters,
 *   "2A" as 2 attoamps, "10M" as 10 milli), but as the exact decimal the netlist writes, not as the
 *   double ngspice rounds it to (N15: ngspice reads "0.3" as 0.30000000000000004).
 * - `exactModel` takes a netlist only when PlainSpice knows exactly what each of its parts is in an
 *   operating point: R; C (open, P11); L (a wire); V and I with a plain DC value or none (0: P9, P16);
 *   E and G with four nodes and a plain gain; F and H that read a V, E or H (P10, P10b) with a plain
 *   gain. Anything else leaves the decision to describe.ts's rule for other circuits: a diode, a
 *   transistor, a switch, a subcircuit, a B source, POLY, VALUE or TABLE, a source with a transient
 *   function, a part with settings (m=, tc1=, r=, ...), .param and expressions, .options and .temp
 *   lines, a .control block, a value below ngspice's smallest resistance, too many unknowns.
 * - `solveExact` solves the circuit's nodal equations with fractions, for several right-hand sides at
 *   once (the operating point, a swept source at 1, a .tf input at 1).
 * - `residualsAgree` checks that ngspice simulated that same circuit: its node voltages and branch
 *   currents, put into the exact equations, leave only what its own rounding can leave.
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
export const equal = (x: Fraction, y: Fraction): boolean => x.n * y.d === y.n * x.d;
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
 * The value ngspice reads from a value word, as the exact decimal the word writes: "4.7k" is 4700,
 * "0.3" is 3/10, "2A" is 2/10^18 (atto), "10M" is 1/100 (milli), "1mil" is 254/10^7. The grammar is
 * readNumber's (src/spice/numbers.ts), which mirrors ngspice's INPevaluate: the same word end, sign,
 * digits, exponent ('e' or 'd') and at most one scale letter; anything after it is ignored. ngspice
 * itself computes digits × 10^n in doubles (N15), so its value can be a unit or two in the last
 * place away from this one; `exactModel` checks that it is never more (`READ_ULPS`). Undefined where
 * readNumber reads no number, and for an exponent too long for ngspice's int.
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
  while (digit(i)) digits += t[i++];
  const done = (): Fraction => {
    const n = BigInt(digits || '0');
    const v = exponent >= 0 ? fraction(n * pow10(exponent)) : fraction(n, pow10(-exponent));
    return negative ? neg(v) : v;
  };
  if (i >= end || t[i] === ':') return done();
  if (t[i] === '.') {
    i += 1;
    if (i >= end) return done();
    while (digit(i)) {
      digits += t[i++];
      exponent -= 1;
    }
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
    let written = '';
    while (digit(i)) written += t[i++];
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
      digits = (BigInt(digits || '0') * 254n).toString();
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
  const x = readExact(reading.text);
  if (!x) return undefined;
  const v = reading.value;
  if (v === 0) return isZero(x) ? x : undefined;
  // Below the smallest normal double ngspice's value has fewer digits: not this value.
  if (Math.abs(v) < 2 ** -1022) return undefined;
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

/** The parts whose operating point PlainSpice knows exactly. */
export type ExactKind = 'R' | 'C' | 'L' | 'V' | 'I' | 'E' | 'F' | 'G' | 'H';

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
   * amp. C and L: 0 (an open circuit and a wire in an operating point).
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
export const MAX_UNKNOWNS = 200;

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
    if (el.nodes.length !== (fourNodes ? 4 : 2)) return 'part';
    if (reads !== !!el.controlSource) return 'part';
    if ((kind === 'V' || kind === 'I') && el.sourceFunction) return 'part';
    const allowed = PLAIN_ROLES[kind];
    for (const f of el.fields.slice(1)) {
      if (NODE_ROLES.has(f.role) || (reads && f.role === 'control-source')) continue;
      if (!allowed.includes(f.role)) return 'part';
    }
    let value = ZERO;
    if (el.value) {
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
  if (size > MAX_UNKNOWNS) return 'size';
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

/** One equation: coefficients by unknown. */
type Row = Map<number, Fraction>;

/** Adds c to row[k]. */
function put(row: Row, k: number, c: Fraction): void {
  if (k < 0 || isZero(c)) return;
  const had = row.get(k);
  const v = had ? add(had, c) : c;
  if (isZero(v)) row.delete(k);
  else row.set(k, v);
}

/**
 * The circuit's equations (modified nodal analysis): Kirchhoff's current law at each node (the
 * currents leaving it add up to 0), then one equation for each branch (V, E, H, L). `sources` says
 * which independent sources take part in the right-hand side: all of them at their values (the
 * operating point), or one of them at 1 and the rest at 0 (a sweep's slope, a .tf input).
 */
function equations(model: ExactModel): Row[] {
  const rows: Row[] = Array.from({ length: model.size }, () => new Map());
  for (const p of model.parts) {
    const { a, b } = p;
    switch (p.kind) {
      case 'R': {
        const g = div(ONE, p.value);
        if (a >= 0) {
          put(rows[a]!, a, g);
          put(rows[a]!, b, neg(g));
        }
        if (b >= 0) {
          put(rows[b]!, b, g);
          put(rows[b]!, a, neg(g));
        }
        break;
      }
      case 'G': {
        // gm × (v(c) − v(d)) leaves node a and enters node b.
        for (const [n, s] of [[a, ONE], [b, neg(ONE)]] as const) {
          if (n < 0) continue;
          put(rows[n]!, p.c, mul(s, p.value));
          put(rows[n]!, p.d, neg(mul(s, p.value)));
        }
        break;
      }
      case 'F': {
        const k = model.parts[p.control]!.branch;
        if (a >= 0) put(rows[a]!, k, p.value);
        if (b >= 0) put(rows[b]!, k, neg(p.value));
        break;
      }
      case 'V':
      case 'E':
      case 'H':
      case 'L': {
        const k = p.branch;
        if (a >= 0) put(rows[a]!, k, ONE);
        if (b >= 0) put(rows[b]!, k, neg(ONE));
        const row = rows[k]!;
        put(row, a, ONE);
        put(row, b, neg(ONE));
        if (p.kind === 'E') {
          put(row, p.c, neg(p.value));
          put(row, p.d, p.value);
        } else if (p.kind === 'H') put(row, model.parts[p.control]!.branch, neg(p.value));
        break;
      }
      default:
        // C: an open circuit; I: only on the right-hand side.
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
    else if (p.kind === 'I') {
      // A current source pushes its current from a, through itself, into b: it leaves a.
      const v = level(p);
      if (p.a >= 0) rhs[p.a] = sub(rhs[p.a]!, v);
      if (p.b >= 0) rhs[p.b] = add(rhs[p.b]!, v);
    }
  }
  return rhs;
}

/** The work an exact solve may take before PlainSpice leaves the decision to the other rule (measured: decision 0015). */
export const MAX_BITS = 2048;
export const MAX_STEPS = 2_000_000;

class OverBudget extends Error {}

/** A row's whole numbers are divided by their common factor once one of them is longer than this. */
const CONTENT_BITS = 1024n;

/**
 * Solves the equations for each right-hand side, exactly. Each equation is first multiplied by the
 * least common multiple of its denominators, so it has whole numbers only; Gaussian elimination then
 * keeps them whole (a row becomes p × itself − c × the pivot's row, with p and c divided by their
 * common factor), choosing as pivot the unknown that appears in the fewest equations, so a circuit's
 * sparse equations stay sparse and a ladder's numbers grow by a few digits a section. The unknowns are
 * fractions in lowest terms. Undefined when the equations have no single answer (a singular matrix), or
 * when the numbers grow past MAX_BITS or the work past MAX_STEPS.
 */
export function solveExact(model: ExactModel, sides: Fraction[][]): Fraction[][] | undefined {
  const n = model.size;
  const eq = equations(model);
  const rows: Map<number, bigint>[] = [];
  const rhs: bigint[][] = [];
  for (let r = 0; r < n; r++) {
    let l = 1n;
    for (const c of eq[r]!.values()) l = lcm(l, c.d);
    for (const side of sides) l = lcm(l, side[r]!.d);
    rows.push(new Map([...eq[r]!].map(([k, c]) => [k, c.n * (l / c.d)])));
    rhs.push(sides.map((side) => side[r]!.n * (l / side[r]!.d)));
  }
  const limit = 1n << BigInt(MAX_BITS);
  const big = 1n << CONTENT_BITS;
  let steps = 0;
  const inColumn: Set<number>[] = Array.from({ length: n }, () => new Set());
  rows.forEach((row, r) => {
    for (const k of row.keys()) inColumn[k]!.add(r);
  });
  const done = new Uint8Array(n);
  const order: [number, number][] = [];
  try {
    for (let step = 0; step < n; step++) {
      let col = -1;
      for (let k = 0; k < n; k++) if (!done[k] && (col < 0 || inColumn[k]!.size < inColumn[col]!.size)) col = k;
      const candidates = inColumn[col]!;
      if (candidates.size === 0) return undefined;
      let r = -1;
      for (const q of candidates) if (r < 0 || rows[q]!.size < rows[r]!.size) r = q;
      const pivotRow = rows[r]!;
      const pivot = pivotRow.get(col)!;
      for (const q of Array.from(candidates)) {
        if (q === r) continue;
        const row = rows[q]!;
        const side = rhs[q]!;
        const g = gcd(pivot, row.get(col)!);
        const a = pivot / g;
        const b = row.get(col)! / g;
        let largest = 0n;
        if (a !== 1n) {
          for (const [k, v] of row) row.set(k, v * a);
          for (let s = 0; s < side.length; s++) side[s] = side[s]! * a;
        }
        for (const [k, c] of pivotRow) {
          const had = row.get(k);
          const v = (had ?? 0n) - b * c;
          steps += 1;
          if (v === 0n) {
            row.delete(k);
            inColumn[k]!.delete(q);
          } else {
            if (had === undefined) inColumn[k]!.add(q);
            row.set(k, v);
          }
        }
        const from = rhs[r]!;
        for (let s = 0; s < side.length; s++) if (from[s] !== 0n) side[s] = side[s]! - b * from[s]!;
        for (const v of row.values()) if ((v < 0n ? -v : v) > largest) largest = v < 0n ? -v : v;
        for (const v of side) if ((v < 0n ? -v : v) > largest) largest = v < 0n ? -v : v;
        if (largest > big) {
          // Divide the row by the common factor of its numbers: an equation may be scaled freely.
          let f = 0n;
          for (const v of row.values()) if ((f = gcd(f, v)) === 1n) break;
          if (f !== 1n) for (const v of side) if ((f = gcd(f, v)) === 1n) break;
          if (f > 1n) {
            for (const [k, v] of row) row.set(k, v / f);
            for (let s = 0; s < side.length; s++) side[s] = side[s]! / f;
            largest /= f;
          }
        }
        if (largest > limit || steps > MAX_STEPS) throw new OverBudget();
      }
      for (const k of pivotRow.keys()) inColumn[k]!.delete(r);
      done[col] = 1;
      order.push([col, r]);
    }
  } catch (e) {
    if (e instanceof OverBudget) return undefined;
    throw e;
  }
  const x: Fraction[][] = sides.map(() => Array.from({ length: n }, () => ZERO));
  for (let i = order.length - 1; i >= 0; i--) {
    const [col, r] = order[i]!;
    const row = rows[r]!;
    const pivot = row.get(col)!;
    for (let s = 0; s < sides.length; s++) {
      // (rhs − Σ c·x) / pivot, over one common denominator, reduced once.
      let num = rhs[r]![s]!;
      let den = 1n;
      for (const [k, c] of row) {
        if (k === col) continue;
        const xk = x[s]![k]!;
        if (xk.n === 0n) continue;
        if (den === xk.d) num -= c * xk.n;
        else {
          num = num * xk.d - c * xk.n * den;
          den *= xk.d;
        }
      }
      x[s]![col] = fraction(num, den * pivot);
    }
  }
  return x;
}

/** The least common multiple of two positive whole numbers. */
function lcm(a: bigint, b: bigint): bigint {
  return a === b || b === 1n ? a : a === 1n ? b : (a / gcd(a, b)) * b;
}

/** The right-hand side of the operating point: every source at its value. */
export const operatingPoint = (model: ExactModel): Fraction[] => rightHandSide(model, (p) => p.value);
/** The right-hand side of a slope: `part` at 1 (one volt or one amp), every other source at 0. */
export const unitSource = (model: ExactModel, part: number): Fraction[] => rightHandSide(model, (p) => (p === model.parts[part] ? ONE : ZERO));

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
 * How much of an equation ngspice's own rounding may leave: a share of the sizes of its terms. ngspice
 * solves the equations of a circuit of these parts once, with an LU factorisation in doubles (its
 * Newton iterations of a linear circuit repeat the same solution), and such a solution leaves each
 * equation unbalanced by a few units in the last place of its largest terms, times a growth factor
 * that is small in practice: 2^-44 (about 6e-14) at most over every netlist PlainSpice was measured on
 * (decision 0015). A circuit that is not the one ngspice simulated (another value, another part)
 * leaves a whole share of a term. 2^-30 (about 1e-9) lies between the two by more than ten thousand
 * times on each side.
 */
export const RESIDUAL_SHARE = 2 ** -30;
/** A part's current as ngspice reports it is its own numbers' product to a few units in the last place: 2^-40 is far beyond that. */
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

/** Sum of fractions, and of their sizes. */
class Sum {
  value: Fraction = ZERO;
  size: Fraction = ZERO;
  term(x: Fraction): void {
    this.value = add(this.value, x);
    this.size = add(this.size, abs(x));
  }
  /** |value| / size: the share of its terms that is left (0 when every term is 0). */
  share(): Fraction {
    return isZero(this.value) ? ZERO : isZero(this.size) ? ONE : div(abs(this.value), this.size);
  }
}

/** How closely ngspice's values solve the model's equations (`shares`). */
export interface Shares {
  /**
   * The largest amount by which ngspice's values leave one of the equations unbalanced (Kirchhoff's
   * current law at a node; a V, E, H or L's own equation), over the largest sum of the sizes of the
   * terms of any equation. ngspice solves all the equations together, with one LU factorisation in
   * doubles, so what its rounding leaves in an equation is a share of the whole system, not of that
   * equation's own terms: a chain of 0 V sources that carries no current can show 1e-16 A against
   * 1e-16 A, and a 0 V source next to a 1 mΩ wire 8e-10 V against 9 V (decision 0015).
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

/** A product of node voltages is checked only when their difference is at least this share of them. */
const RESOLVED = fraction(1n, 1n << 20n);
/** Below the smallest normal double a product has fewer digits: gaps that small say nothing. */
const SMALLEST_NORMAL = fraction(1n, 1n << 1022n);

/**
 * How closely ngspice's values solve this model's equations (Shares). `level` gives each independent
 * source's value in that solution. Undefined when a value the equations need is missing.
 */
export function shares(model: ExactModel, ng: NgspiceValues, level: (p: ExactPart) => Fraction): Shares | undefined {
  const volts: (Fraction | undefined)[] = model.nodes.map((n) => {
    const v = ng.voltage(n);
    return v === undefined || !Number.isFinite(v) ? undefined : fromDouble(v);
  });
  if (volts.some((v) => v === undefined)) return undefined;
  const branch = new Map<number, Fraction>();
  for (const p of model.parts) {
    if (p.branch < 0) continue;
    const i = ng.branch(p.key);
    if (i === undefined || !Number.isFinite(i)) return undefined;
    branch.set(p.branch, fromDouble(i));
  }
  const v = (n: number): Fraction => (n < 0 ? ZERO : volts[n]!);
  const sums: Sum[] = model.nodes.map(() => new Sum());
  let products = ZERO;
  const worse = (a: Fraction, b: Fraction): Fraction => (compare(b, a) > 0 ? b : a);
  /** v(x) − v(y), when it is not a near cancellation of the two. */
  const resolved = (x: number, y: number): boolean => {
    const d = abs(sub(v(x), v(y)));
    const big = compare(abs(v(x)), abs(v(y))) > 0 ? abs(v(x)) : abs(v(y));
    return compare(d, mul(RESOLVED, big)) >= 0;
  };
  for (const p of model.parts) {
    let terms: Fraction[] = [];
    let product: Fraction | undefined;
    switch (p.kind) {
      case 'R':
        terms = [div(v(p.a), p.value), neg(div(v(p.b), p.value))];
        if (resolved(p.a, p.b)) product = add(terms[0]!, terms[1]!);
        break;
      case 'C':
        break;
      case 'I':
        terms = [level(p)];
        product = level(p);
        break;
      case 'G':
        terms = [mul(p.value, v(p.c)), neg(mul(p.value, v(p.d)))];
        if (resolved(p.c, p.d)) product = add(terms[0]!, terms[1]!);
        break;
      case 'F':
        terms = [mul(p.value, branch.get(model.parts[p.control]!.branch)!)];
        product = terms[0];
        break;
      default: {
        terms = [branch.get(p.branch)!];
        // Its own equation: v(a) − v(b) and what the part makes of it.
        const own = new Sum();
        own.term(v(p.a));
        own.term(neg(v(p.b)));
        if (p.kind === 'V') own.term(neg(level(p)));
        else if (p.kind === 'E') {
          own.term(neg(mul(p.value, v(p.c))));
          own.term(mul(p.value, v(p.d)));
        } else if (p.kind === 'H') own.term(neg(mul(p.value, branch.get(model.parts[p.control]!.branch)!)));
        sums.push(own);
      }
    }
    for (const t of terms) {
      if (p.a >= 0) sums[p.a]!.term(t);
      if (p.b >= 0) sums[p.b]!.term(neg(t));
    }
    if (product !== undefined && compare(abs(product), SMALLEST_NORMAL) >= 0) {
      const reported = ng.device(p.key);
      if (reported !== undefined) {
        if (!Number.isFinite(reported)) return undefined;
        const gap = abs(sub(fromDouble(reported), product));
        products = worse(products, isZero(gap) ? ZERO : div(gap, abs(product)));
      }
    }
  }
  let largest = ZERO;
  let left = ZERO;
  for (const s of sums) {
    largest = worse(largest, s.size);
    left = worse(left, abs(s.value));
  }
  return { equations: isZero(left) ? ZERO : isZero(largest) ? ONE : div(left, largest), products };
}

/**
 * True when ngspice's values solve this model's equations as closely as its own rounding can
 * (RESIDUAL_SHARE), and the other parts' currents it reports are their own numbers' products
 * (PRODUCT_SHARE): then the model is the circuit ngspice simulated, and every difference between its
 * values and the exact ones (the noise of a 0 among them) is what that rounding leaves.
 */
export function agrees(model: ExactModel, ng: NgspiceValues, level: (p: ExactPart) => Fraction): boolean {
  const s = shares(model, ng, level);
  return !!s && compare(s.equations, fromDouble(RESIDUAL_SHARE)) <= 0 && compare(s.products, fromDouble(PRODUCT_SHARE)) <= 0;
}
