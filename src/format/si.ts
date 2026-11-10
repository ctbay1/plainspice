/**
 * Numbers in plain units: 1.200000e+01 V -> "12 V", 0.0015 A -> "1.5 mA", -6 -> "−6 V".
 *
 * Display uses SI prefixes (k, M, m, µ ...). Note that these are *display* prefixes: in a SPICE
 * netlist "M" means milli and mega is written "meg" (see src/spice/numbers.ts).
 *
 * Below atto (1e-18) and from 1000 tera (1e15) up there is no prefix, so such a number is written
 * with an exponent, the way ngspice writes it ("3.6e-35 W", "1e+20 Ω"): "0.000001 aW" or
 * "100000000 TΩ" would be unreadable.
 */

const PREFIXES: ReadonlyArray<readonly [exponent: number, symbol: string, word: string]> = [
  [12, 'T', 'tera'],
  [9, 'G', 'giga'],
  [6, 'M', 'mega'],
  [3, 'k', 'kilo'],
  [0, '', ''],
  [-3, 'm', 'milli'],
  [-6, 'µ', 'micro'],
  [-9, 'n', 'nano'],
  [-12, 'p', 'pico'],
  [-15, 'f', 'femto'],
  [-18, 'a', 'atto'],
];

const UNIT_WORDS: Record<string, [singular: string, plural: string]> = {
  V: ['volt', 'volts'],
  A: ['amp', 'amps'],
  'Ω': ['ohm', 'ohms'],
  W: ['watt', 'watts'],
  F: ['farad', 'farads'],
  H: ['henry', 'henries'],
  s: ['second', 'seconds'],
  S: ['siemens', 'siemens'],
  Hz: ['hertz', 'hertz'],
  '°C': ['degree Celsius', 'degrees Celsius'],
};

const NBSP = ' ';
const MINUS = '−';

interface Parts {
  negative: boolean;
  mantissa: string;
  prefix: readonly [number, string, string];
}

/** Smaller than the smallest prefix (atto) or at least 1000 times the largest (tera), once rounded. */
function beyondPrefixes(value: number, significant: number): boolean {
  if (!Number.isFinite(value) || value === 0) return false;
  const rounded = Number(Math.abs(value).toPrecision(significant));
  return rounded < 1e-18 || rounded >= 1e15;
}

function split(value: number, significant: number): Parts | undefined {
  if (!Number.isFinite(value)) return undefined;
  if (value === 0) return { negative: false, mantissa: '0', prefix: PREFIXES[4]! };
  // Round first, so 999.96 becomes 1000 and is shown as "1 k", not "1000".
  const rounded = Number(Math.abs(value).toPrecision(significant));
  const exponent = Math.floor(Math.log10(rounded));
  const eng = Math.max(-18, Math.min(12, Math.floor(exponent / 3) * 3));
  const prefix = PREFIXES.find(([e]) => e === eng)!;
  let mantissa = (rounded / 10 ** eng).toPrecision(significant);
  if (mantissa.includes('e')) mantissa = String(Number(mantissa));
  if (mantissa.includes('.')) mantissa = mantissa.replace(/0+$/, '').replace(/\.$/, '');
  return { negative: value < 0, mantissa, prefix };
}

/** "12 V", "1.5 mA", "−6 V", "333.3 m" (no unit). `significant` digits are kept, trailing zeros dropped. */
export function formatSI(value: number, unit = '', significant = 4): string {
  if (beyondPrefixes(value, significant)) return unit ? `${formatNumber(value, significant)}${NBSP}${unit}` : formatNumber(value, significant);
  const p = split(value, significant);
  if (!p) return Number.isNaN(value) ? 'not a number' : value > 0 ? '∞' : `${MINUS}∞`;
  const text = `${p.negative ? MINUS : ''}${p.mantissa}`;
  const suffix = `${p.prefix[1]}${unit}`;
  return suffix ? `${text}${NBSP}${suffix}` : text;
}

/**
 * A number without a unit (a ratio such as a transfer function): "0.3333", "14", "1.5e-9".
 * Plain decimals between 0.001 and 1e6, otherwise exponent notation.
 */
export function formatNumber(value: number, significant = 4): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? 'not a number' : value > 0 ? '∞' : `${MINUS}∞`;
  if (value === 0) return '0';
  const rounded = Number(value.toPrecision(significant));
  const a = Math.abs(rounded);
  const text = a >= 1e-3 && a < 1e6 ? String(rounded) : rounded.toExponential(significant - 1).replace(/\.?0+e/, 'e');
  return text.replace(/^-/, MINUS);
}

/** Words for screen readers: "minus 6 volts", "1.5 milliamps", "4 ohms". */
export function speakSI(value: number, unit = '', significant = 4): string {
  const words = UNIT_WORDS[unit];
  if (beyondPrefixes(value, significant)) {
    // "3.6 times 10 to the power minus 35 watts": an exponent read out in words.
    const [m, e] = Math.abs(value).toExponential(significant - 1).split('e');
    const mantissa = m!.includes('.') ? m!.replace(/0+$/, '').replace(/\.$/, '') : m!;
    const exponent = Number(e);
    const power = `10 to the power ${exponent < 0 ? 'minus ' : ''}${Math.abs(exponent)}`;
    return [value < 0 ? 'minus' : '', mantissa, 'times', power, words ? words[1] : unit].filter(Boolean).join(' ');
  }
  const p = split(value, significant);
  if (!p) return Number.isNaN(value) ? 'not a number' : value > 0 ? 'infinity' : 'minus infinity';
  const plural = p.mantissa !== '1'; // "1 volt", "1 megaohm", "1.5 milliamps"
  const unitWord = words ? words[plural ? 1 : 0] : unit;
  const parts = [p.negative ? 'minus' : '', p.mantissa, `${p.prefix[2]}${unitWord}`].filter(Boolean);
  return parts.join(' ');
}

/** The way ngspice prints a value in batch mode: 7 significant digits, "1.200000e+01". */
export function formatLikeNgspice(value: number): string {
  return value.toExponential(6).replace(/e([+-])(\d)$/, 'e$10$2');
}
