/**
 * Numbers on the plot, always through src/format/si.ts: formatSI for what is shown, speakSI for
 * what is spoken. This file adds two plot-specific rules on top.
 */
import { formatNumber, formatSI } from '../format/si.ts';
import type { PlotUnit } from './types.ts';

const NBSP = '\u00A0';

/**
 * Axis tick labels with one SI prefix for the whole axis ("0 ms, 0.5 ms, 1 ms, 1.5 ms" rather
 * than "0 s, 500 µs, 1 ms, 1.5 ms"), so the ticks read as one scale. The prefix and unit come from
 * formatSI itself (formatSI(10^e) is "1 ms"), so the prefix symbols live in one place.
 */
export function tickLabels(values: readonly number[], unit: PlotUnit): string[] {
  let maxAbs = 0;
  for (const v of values) if (Number.isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
  if (maxAbs === 0) return values.map((v) => formatSI(v, unit));
  // Round first, like formatSI does, so 999.99 µ is read as 1 m.
  const rounded = Number(maxAbs.toPrecision(4));
  const exponent = Math.max(-18, Math.min(12, Math.floor(Math.floor(Math.log10(rounded)) / 3) * 3));
  const one = formatSI(10 ** exponent, unit);
  const space = one.indexOf(NBSP);
  // formatSI(10^e) should read "1" + space + prefix + unit; if floating point ever breaks that,
  // fall back to formatting each tick on its own (still correct, just mixed prefixes).
  if (one.slice(0, space < 0 ? undefined : space) !== '1') return values.map((v) => formatSI(v, unit));
  const suffix = space < 0 ? '' : one.slice(space + 1);
  return values.map((v) => {
    if (!Number.isFinite(v)) return formatSI(v, unit);
    const mantissa = formatNumber(v / 10 ** exponent, 4);
    return suffix ? `${mantissa}${NBSP}${suffix}` : mantissa;
  });
}

/**
 * The x value at the cursor with enough digits to tell it from the points next to it, so each
 * arrow-key press changes what a screen reader says even where time steps are tiny (four
 * significant digits by default, up to nine).
 */
export function cursorDigits(x: ArrayLike<number>, index: number, unit: PlotUnit): number {
  const here = x[index] ?? Number.NaN;
  const neighbours = [x[index - 1], x[index + 1]].filter((v): v is number => v !== undefined && v !== here);
  for (let digits = 4; digits < 9; digits++) {
    const text = formatSI(here, unit, digits);
    if (neighbours.every((v) => formatSI(v, unit, digits) !== text)) return digits;
  }
  return 9;
}
