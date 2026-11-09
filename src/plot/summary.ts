/**
 * summarisePlot(): the plot in plain words, for the caption under the heading (everyone reads
 * it) and for screen readers. Pure: no DOM, no uPlot, so the app can also use it on its own.
 *
 * One sentence per series, in the spec's order and in ngspice's point order, for example
 *   "v(out) rises from 0 V to 4.966 V over 5 ms; final value 4.966 V."
 *   "v(out) rises in a straight line from 0 V to 8 V as V1 goes from 0 V to 12 V (slope 0.6667 V/V)."
 *   "i(v1) goes from 0 A to −33.71 µA over 5 ms; lowest −4.995 mA at 1.01 µs, highest 0 A at 0 s; final value −33.71 µA."
 * Every number goes through formatSI (src/format/si.ts).
 */
import { formatNumber, formatSI } from '../format/si.ts';
import { pointCount } from './data.ts';
import { PLOT_STRINGS } from './strings.ts';
import type { PlotSeries, PlotSpec, PlotUnit } from './types.ts';

/**
 * How close is "the same". ngspice results carry rounding noise far below what four significant
 * digits show, so a step backwards smaller than a millionth of the series' range does not stop
 * it "rising", and a straight line may be off by a millionth of its range.
 */
const MONOTONIC_TOLERANCE = 1e-6;
const STRAIGHT_TOLERANCE = 1e-6;
/** A series whose range is below a billionth of its size "stays at" one value. */
const CONSTANT_TOLERANCE = 1e-9;

interface Shape {
  first: number;
  last: number;
  min: number;
  minAt: number;
  max: number;
  maxAt: number;
  rising: boolean;
  falling: boolean;
  constant: boolean;
  straight: boolean;
  /** Sign changes (through zero), and where the first one is (x, linearly interpolated). */
  crossings: number;
  firstCrossing: number;
}

const at = (values: ArrayLike<number>, k: number): number => values[k] ?? Number.NaN;

function shapeOf(x: ArrayLike<number>, y: ArrayLike<number>, n: number): Shape {
  const first = at(y, 0);
  const last = at(y, n - 1);
  let min = Infinity;
  let max = -Infinity;
  let minAt = 0;
  let maxAt = 0;
  // These loops run over every point (100 000 or more), so they index directly (k < n, the
  // shortest vector's length, so every index exists) and assign without destructuring: on a
  // rising curve every point is a new maximum, and an array per point made this slow.
  for (let k = 0; k < n; k++) {
    const v = y[k]!;
    if (v < min) {
      min = v;
      minAt = k;
    }
    if (v > max) {
      max = v;
      maxAt = k;
    }
  }
  const range = max - min;
  const constant = range === 0 || range <= CONSTANT_TOLERANCE * Math.max(Math.abs(min), Math.abs(max));
  const step = MONOTONIC_TOLERANCE * range;
  let rising = !constant;
  let falling = !constant;
  let crossings = 0;
  let firstCrossing = Number.NaN;
  let lastSign = 0;
  let lastSignAt = 0;
  // Compare with the highest (lowest) value so far, not with the previous point: a slow sag of
  // many tiny steps after a peak is still a peak (an overshoot must not read as "rises").
  let highest = -Infinity;
  let lowest = Infinity;
  for (let k = 0; k < n; k++) {
    const v = y[k]!;
    if (v < highest - step) rising = false;
    if (v > lowest + step) falling = false;
    if (v > highest) highest = v;
    if (v < lowest) lowest = v;
    const sign = v > 0 ? 1 : v < 0 ? -1 : 0;
    if (sign !== 0) {
      if (lastSign !== 0 && sign !== lastSign) {
        crossings += 1;
        if (crossings === 1) firstCrossing = crossingX(x, y, lastSignAt, k);
      }
      lastSign = sign;
      lastSignAt = k;
    }
  }
  let straight = false;
  const x0 = at(x, 0);
  const dx = at(x, n - 1) - x0;
  if ((rising || falling) && dx !== 0) {
    const slope = (last - first) / dx;
    straight = true;
    const limit = STRAIGHT_TOLERANCE * range;
    for (let k = 1; k < n - 1 && straight; k++) {
      if (Math.abs(y[k]! - (first + slope * (x[k]! - x0))) > limit) straight = false;
    }
  }
  return { first, last, min, minAt, max, maxAt, rising, falling, constant, straight, crossings, firstCrossing };
}

/** Where y crosses zero between point a (one sign) and point b (the other sign). */
function crossingX(x: ArrayLike<number>, y: ArrayLike<number>, a: number, b: number): number {
  // A point that is exactly zero is the crossing; otherwise interpolate, which is exactly where
  // the drawn line (straight between points) crosses zero.
  for (let k = a + 1; k < b; k++) if (at(y, k) === 0) return at(x, k);
  const ya = at(y, a);
  const yb = at(y, b);
  return at(x, a) + ((at(x, b) - at(x, a)) * -ya) / (yb - ya);
}

/** "0.6667 V/V" for a ratio of like quantities, "−333.3 µA/V" with an SI prefix, "−0.01 per °C". */
function slopeText(slope: number, unit: PlotUnit, xUnit: PlotUnit): string {
  if (unit === xUnit) return unit ? `${formatNumber(slope)} ${unit}/${xUnit}` : formatNumber(slope);
  if (!unit) return PLOT_STRINGS.summary.perUnit(formatNumber(slope), xUnit);
  if (!xUnit) return formatSI(slope, unit);
  return formatSI(slope, `${unit}/${xUnit}`);
}

function describeSeries(spec: PlotSpec, s: PlotSeries, n: number): string {
  const S = PLOT_STRINGS.summary;
  const { x } = spec;
  const fx = (v: number): string => formatSI(v, x.unit);
  const fy = (v: number): string => formatSI(v, s.unit);
  const where = (k: number): string => (spec.kind === 'tran' ? S.atTime(fx(at(x.values, k))) : S.atSweep(x.label, fx(at(x.values, k))));
  const whereX = (v: number): string => (spec.kind === 'tran' ? S.atTime(fx(v)) : S.atSweep(x.label, fx(v)));

  if (n === 0) return S.noPoints(s.label);
  if (n === 1) return S.onePoint(s.label, fy(at(s.values, 0)), where(0));

  const x0 = at(x.values, 0);
  const xN = at(x.values, n - 1);
  const span =
    spec.kind === 'tran' ? (x0 === 0 ? S.overTime(fx(xN - x0)) : S.fromTo(fx(x0), fx(xN))) : S.asSweep(x.label, fx(x0), fx(xN));
  const shape = shapeOf(x.values, s.values, n);
  const extras: string[] = [];
  let main: string;

  if (shape.constant) {
    // Report the value at the start: for a constant every point shows the same text.
    return S.sentence(S.stays(s.label, fy(shape.first), span), []);
  }
  if (shape.rising || shape.falling) {
    const from = fy(shape.first);
    const to = fy(shape.last);
    if (shape.straight) {
      const slope = slopeText((shape.last - shape.first) / (xN - x0), s.unit, x.unit);
      main = shape.rising ? S.risesStraight(s.label, from, to, span, slope) : S.fallsStraight(s.label, from, to, span, slope);
    } else {
      main = shape.rising ? S.rises(s.label, from, to, span) : S.falls(s.label, from, to, span);
    }
    if (shape.crossings === 1) extras.push(S.crossesOnce(fy(0), whereX(shape.firstCrossing)));
  } else {
    main = S.goes(s.label, fy(shape.first), fy(shape.last), span);
    extras.push(S.extremes(fy(shape.min), where(shape.minAt), fy(shape.max), where(shape.maxAt)));
    if (shape.crossings === 1) extras.push(S.crossesOnce(fy(0), whereX(shape.firstCrossing)));
    else if (shape.crossings > 1) extras.push(S.crossesTimes(fy(0), shape.crossings));
  }
  if (spec.kind === 'tran') extras.push(S.finalValue(fy(shape.last)));
  return S.sentence(main, extras);
}

/** The whole plot in plain words: one sentence per series. */
export function summarisePlot(spec: PlotSpec): string {
  if (spec.series.length === 0) return PLOT_STRINGS.summary.nothing;
  const n = pointCount(spec);
  return spec.series.map((s) => describeSeries(spec, s, n)).join(' ');
}
