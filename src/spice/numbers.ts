/**
 * How ngspice reads a number such as "1meg", "10kOhm", "3A" or "1,5k".
 *
 * Mirrored from ngspice 47 (src/spicelib/parser/): first the word splitter INPgetUTok
 * (inpgtok.c) decides where the number's word ends, then INPevaluate (inpeval.c) reads the
 * word. Every rule below was checked by running native ngspice 47, native ngspice 42 and our
 * WebAssembly engine on the same netlists: docs/spice-facts/numbers-and-syntax.md, with the
 * engine run asserted by tests/golden/facts-numbers.test.ts. The IDs in brackets name the claims.
 *
 * The rules a student meets, in ngspice's own order:
 * - A word ends at a space, tab, ',', '=', '(' or ')', and also at '*', '/', '^', and at a '+'
 *   or '-' that comes after a digit or a letter, except the sign right after an exponent 'e'.
 *   So "1,5k" is the two words "1" and "5k", and "1d-3" is "1d" and "-3" ("1e-3" stays whole)
 *   (N8, N10, N12, N13).
 * - The word must start with a digit or '.', after an optional sign; otherwise it is not a number.
 * - Digits, an optional '.', more digits, then an optional exponent: 'e' or 'd' (any case), an
 *   optional sign and digits (N7, N11).
 * - Then at most one scale letter, any case: T G K U N P F A, M (milli), MEG, MIL. The micro sign
 *   'µ' (U+00B5) counts as U because ngspice turns it into 'u' first; the Greek letter 'μ'
 *   (U+03BC) is not a scale letter (N1-N3, N5, N18).
 * - Everything after that is ignored: "10kOhm" is 10 kΩ, "1MOhm" is 1 mΩ, "2k2" is 2 kΩ (N4, N6).
 *
 * The value is computed exactly as ngspice computes it, sign × digits × 10^exponent, with the
 * same double-precision rounding (so "0.3" reads as 0.30000000000000004, as in ngspice; N15, N16).
 */
import type { NumberReading } from './types.ts';

const C_TAB = 9;
const C_SPACE = 32;
const C_PLUS = 43;
const C_MINUS = 45;
const C_DOT = 46;
const C_COLON = 58;
const C_STAR = 42;
const C_SLASH = 47;
const C_CARET = 94;
const C_COMMA = 44;
const C_EQUALS = 61;
const C_LPAREN = 40;
const C_RPAREN = 41;
const C_QUOTE = 39;
const C_DQUOTE = 34;
const C_LBRACE = 123;
const MICRO_SIGN = '\u00b5';

/** C's isspace in the "C" locale. ngspice turns every run of these into one space before parsing. */
export function isSpaceCode(c: number): boolean {
  return c === C_SPACE || (c >= C_TAB && c <= 13);
}

const isDigitCode = (c: number): boolean => c >= 48 && c <= 57;

/**
 * Where ngspice's number word (INPgetUTok) ends, starting at `start`: the index just after the
 * word. Characters that are separators everywhere (space, tab, ',', '=', '(', ')') end it, and
 * so do '*', '/', '^' and a '+' or '-' that follows a digit or a letter, except the sign right
 * after an 'e' exponent. A word that would be empty takes one character, as in ngspice.
 */
export function numberWordEnd(text: string, start = 0): number {
  let i = start;
  // As INPgetUTok's signstate: 0 at the start, 1 after a leading sign, a digit or '.', 2 after an
  // 'e' that follows those (a sign may come next), 3 after anything else (a sign ends the word).
  let state = 0;
  for (; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (isSpaceCode(c) || c === C_EQUALS || c === C_LPAREN || c === C_RPAREN || c === C_COMMA) break;
    if (c === C_PLUS || c === C_MINUS) {
      if (state === 1 || state === 3) break;
      state += 1;
      continue;
    }
    if (c === C_STAR || c === C_SLASH || c === C_CARET) break;
    if (isDigitCode(c) || c === C_DOT) state = state > 1 ? 3 : 1;
    else if ((c | 0x20) === 0x65 && state === 1) state = 2;
    else state = 3;
  }
  if (i === start && i < text.length) i += 1;
  return i;
}

/**
 * 10^n exactly as native ngspice gets it from C's pow(10.0, n) (glibc). Correctly rounded
 * decimal parsing agrees with glibc for every n from -340 to 308 except 23 and 210 (checked by
 * running native ngspice 47 and 42 on "1e-340" ... "1e308"). Our WebAssembly engine (musl's pow)
 * agrees with glibc everywhere except n = 126, where it is one unit in the last place higher.
 */
export function pow10(n: number): number {
  if (n > 308) return Number.POSITIVE_INFINITY;
  if (n < -400) return 0;
  if (n === 23) return 1.0000000000000001e23;
  if (n === 210) return 1.0000000000000001e210;
  return Number(`1e${n}`);
}

interface Scale {
  exponent: number;
  factor: number;
  name: string;
  length: number;
  mil?: true;
}

const SINGLE_LETTER_SCALES: Readonly<Record<string, Omit<Scale, 'length'>>> = {
  t: { exponent: 12, factor: 1e12, name: 'tera' },
  g: { exponent: 9, factor: 1e9, name: 'giga' },
  k: { exponent: 3, factor: 1e3, name: 'kilo' },
  u: { exponent: -6, factor: 1e-6, name: 'micro' },
  n: { exponent: -9, factor: 1e-9, name: 'nano' },
  p: { exponent: -12, factor: 1e-12, name: 'pico' },
  f: { exponent: -15, factor: 1e-15, name: 'femto' },
  a: { exponent: -18, factor: 1e-18, name: 'atto' },
  m: { exponent: -3, factor: 1e-3, name: 'milli' },
};

/** ASCII letters to lower case, nothing else: ngspice compares bytes ("K", U+212A, is not "k"). */
const lowerCode = (c: number): number => (c >= 65 && c <= 90 ? c + 32 : c);

/** The scale letters at `i` of the word t[0, end), as INPevaluate reads them (case-insensitive). */
function scaleAt(t: string, i: number, end: number): Scale | undefined {
  if (i >= end) return undefined;
  const c = lowerCode(t.charCodeAt(i));
  if (c === 0x6d && i + 2 < end) {
    const c1 = lowerCode(t.charCodeAt(i + 1));
    const c2 = lowerCode(t.charCodeAt(i + 2));
    if (c1 === 0x65 && c2 === 0x67) return { exponent: 6, factor: 1e6, name: 'mega', length: 3 };
    if (c1 === 0x69 && c2 === 0x6c) return { exponent: -6, factor: 25.4e-6, name: 'mil', length: 3, mil: true };
  }
  const single = c < 128 ? SINGLE_LETTER_SCALES[String.fromCharCode(c)] : undefined;
  return single ? { ...single, length: 1 } : undefined;
}

/**
 * Reads `text` as one value word, the way ngspice reads a value on a netlist line, or returns
 * undefined when ngspice would not read a number there ("abc", "-", "e5", "{1k*2}").
 *
 * - `value` is the number ngspice uses, bit for bit (native ngspice 47 and 42).
 * - `scale` names the scale letters ngspice applied ("M" in "1M" is milli).
 * - `ignored` is what ngspice skips silently ("Ohm" in "10kOhm", "2" in "2k2").
 * - `rest` is text that is not part of this number's word: ngspice reads it as the next word
 *   (",5k" in "1,5k", "-3" in "1d-3", " k" in "1 k").
 *
 * Carriage returns are removed first, as ngspice does when it reads a line. Expressions in
 * braces or quotes are not numbers here: ngspice evaluates them, PlainSpice does not.
 */
export function readNumber(text: string): NumberReading | undefined {
  const s = text.includes('\r') ? text.replaceAll('\r', '') : text;
  if (s.length === 0) return undefined;
  const first = s.charCodeAt(0);
  if (first === C_QUOTE || first === C_DQUOTE || first === C_LBRACE) return undefined;
  if (isSpaceCode(first) || first === C_COMMA || first === C_EQUALS || first === C_LPAREN || first === C_RPAREN) {
    return undefined;
  }
  // ngspice translates the micro sign to 'u' before parsing; one character for one, so indexes hold.
  const t = s.includes(MICRO_SIGN) ? s.replaceAll(MICRO_SIGN, 'u') : s;
  const end = numberWordEnd(t, 0);

  let i = 0;
  let sign = 1;
  if (t.charCodeAt(i) === C_PLUS) i += 1;
  else if (t.charCodeAt(i) === C_MINUS) {
    i += 1;
    sign = -1;
  }
  if (i >= end || (!isDigitCode(t.charCodeAt(i)) && t.charCodeAt(i) !== C_DOT)) return undefined;

  let mantis = 0;
  let expo1 = 0;
  let expo2 = 0;
  let expsgn = 1;
  // Same operations in the same order as inpeval.c, so the rounding is the same.
  while (i < end && isDigitCode(t.charCodeAt(i))) {
    mantis = 10 * mantis + t.charCodeAt(i) - 48;
    i += 1;
  }

  if (i >= end || t.charCodeAt(i) === C_COLON) return reading(text, s, end, mantis * sign, i);
  if (t.charCodeAt(i) === C_DOT) {
    i += 1;
    if (i >= end) return reading(text, s, end, mantis * sign, i);
    while (i < end && isDigitCode(t.charCodeAt(i))) {
      mantis = 10 * mantis + t.charCodeAt(i) - 48;
      expo1 -= 1;
      i += 1;
    }
  }
  const e = i < end ? t.charCodeAt(i) | 0x20 : 0;
  if (e === 0x65 || e === 0x64) {
    // 'e' or 'd'. The exponent is a C int: wrap like the native build does on overflow.
    i += 1;
    if (i < end && t.charCodeAt(i) === C_PLUS) i += 1;
    else if (i < end && t.charCodeAt(i) === C_MINUS) {
      i += 1;
      expsgn = -1;
    }
    while (i < end && isDigitCode(t.charCodeAt(i))) {
      expo2 = (Math.imul(10, expo2) + t.charCodeAt(i) - 48) | 0;
      i += 1;
    }
  }
  const scale = scaleAt(t, i, end);
  if (scale) {
    expo1 += scale.exponent;
    if (scale.mil) mantis *= 25.4;
    i += scale.length;
  }
  return reading(text, s, end, sign * mantis * pow10((expo1 + Math.imul(expsgn, expo2)) | 0), i, scale);
}

/** The reading of `s` (= `text` without carriage returns) whose word ends at `end`. */
function reading(text: string, s: string, end: number, value: number, consumed: number, scale?: Scale): NumberReading {
  const r: NumberReading = { text, value };
  if (scale) r.scale = { letters: s.slice(consumed - scale.length, consumed), factor: scale.factor, name: scale.name };
  if (consumed < end) r.ignored = s.slice(consumed, end);
  if (end < s.length) r.rest = s.slice(end);
  return r;
}

const SPELLING_SCALES: ReadonlyArray<readonly [exponent: number, letters: string]> = [
  [12, 't'],
  [9, 'g'],
  [6, 'meg'],
  [3, 'k'],
  [0, ''],
  [-3, 'm'],
  [-6, 'u'],
  [-9, 'n'],
  [-12, 'p'],
];

/**
 * A netlist spelling of `value` for one-click fixes: 1e6 -> "1meg", 2200 -> "2.2k", 1e-6 -> "1u",
 * 0.001 -> "1m", 3 -> "3", -0.5 -> "-500m". ngspice reads it back as one clean word (nothing
 * ignored) and as `value` itself, or one unit in the last place away: ngspice computes digits ×
 * 10^n, so even "3.3" reads as 3.3000000000000003 (docs/spice-facts/numbers-and-syntax.md, N15).
 *
 * It never uses the letters that trap beginners: mega is "meg" (never "M"), and values below
 * 1p or from 1e15 up use an exponent ("3e-18", not "3a"; "1e15", not "1000t") because "F" and
 * "A" read as femto and atto. The digits are the shortest that identify `value` as a double.
 * Infinity and NaN have no netlist spelling; they come back as "Infinity" / "NaN".
 */
export function formatSpiceNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  const [mantissaText, exponentText] = Math.abs(value).toExponential().split('e') as [string, string];
  const digits = mantissaText.replace('.', '').replace(/0+$/, '') || '0';
  const exponent = Number(exponentText);
  const sign = value < 0 ? '-' : '';
  if (exponent >= 15 || exponent < -12) {
    const mantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${mantissa}e${exponent}`;
  }
  const scaleExponent = Math.floor(exponent / 3) * 3;
  const letters = SPELLING_SCALES.find(([x]) => x === scaleExponent)?.[1] ?? '';
  const whole = exponent - scaleExponent + 1;
  const integer = digits.slice(0, whole).padEnd(whole, '0');
  const fraction = digits.slice(whole);
  return `${sign}${integer}${fraction ? `.${fraction}` : ''}${letters}`;
}
