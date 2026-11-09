/**
 * The data side of the plot, no DOM: how many points a spec has, the arrays the renderer draws,
 * which series share a panel, and index searches.
 *
 * Facts about ngspice's output that this relies on (checked by running native ngspice 47):
 * - `.tran` writes time in increasing order.
 * - `.dc V1 12 0 -3` writes the swept value in decreasing order (12, 9, 6, 3, 0): the plot draws
 *   it left to right in increasing order, while the summary and the table keep ngspice's order.
 * - `.dc V1 0 2 1 V2 0 1 1` (one sweep inside another) writes one result whose x repeats
 *   (0, 1, 2, 0, 1, 2). That cannot be drawn as one line yet (families of curves come later),
 *   so `plottable` is false and the figure shows the table instead.
 */
import { seriesStyle, type SeriesStyle } from './palette.ts';
import type { PlotSpec, PlotUnit } from './types.ts';

/** Points in a spec: the shortest of x and the series (they are equal for engine results). */
export function pointCount(spec: PlotSpec): number {
  let n = spec.x.values.length;
  for (const s of spec.series) n = Math.min(n, s.values.length);
  return n;
}

export interface PreparedSeries {
  label: string;
  unit: PlotUnit;
  /** In drawing order (x increasing). */
  values: Float64Array;
  style: SeriesStyle;
}

export interface Panel {
  unit: PlotUnit;
  /** Indices into PreparedPlot.series. */
  series: number[];
}

export interface PreparedPlot {
  n: number;
  /** x in increasing order: the drawing order, and what the cursor's index counts. */
  x: Float64Array;
  xLabel: string;
  xUnit: PlotUnit;
  series: PreparedSeries[];
  /** True when the spec's x decreases (a dc sweep run downwards) and the arrays were reversed. */
  reversed: boolean;
  /** False when there are no points or x changes direction, so it cannot be drawn as lines. */
  plottable: boolean;
  /** Series with the same unit share a panel; panels are stacked when the units differ. */
  panels: Panel[];
}

function toFloat64(values: ArrayLike<number>, n: number, reverse: boolean): Float64Array {
  // Engine vectors are Float64Arrays: use them as they are (uPlot does not copy them either).
  if (!reverse && values instanceof Float64Array) return values.length === n ? values : values.subarray(0, n);
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) out[k] = values[reverse ? n - 1 - k : k] ?? Number.NaN;
  return out;
}

export function preparePlot(spec: PlotSpec): PreparedPlot {
  const n = pointCount(spec);
  const first = spec.x.values[0] ?? Number.NaN;
  const last = spec.x.values[n - 1] ?? Number.NaN;
  const reversed = n > 1 && first > last;
  const x = toFloat64(spec.x.values, n, reversed);
  let plottable = n > 0;
  for (let k = 0; k < n && plottable; k++) {
    const v = x[k] ?? Number.NaN;
    if (!Number.isFinite(v) || (k > 0 && v < (x[k - 1] ?? Number.NaN))) plottable = false;
  }
  const series = spec.series.map((s, i) => ({
    label: s.label,
    unit: s.unit,
    values: toFloat64(s.values, n, reversed),
    style: seriesStyle(i),
  }));
  const panels: Panel[] = [];
  series.forEach((s, i) => {
    const panel = panels.find((p) => p.unit === s.unit);
    if (panel) panel.series.push(i);
    else panels.push({ unit: s.unit, series: [i] });
  });
  return { n, x, xLabel: spec.x.label, xUnit: spec.x.unit, series, reversed, plottable, panels };
}

/** First index whose x is at least `value` (x increasing), or x.length. */
export function lowerBound(x: ArrayLike<number>, value: number): number {
  let lo = 0;
  let hi = x.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((x[mid] ?? Number.NaN) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the x closest to `value` (x increasing, at least one point). */
export function nearestIndex(x: ArrayLike<number>, value: number): number {
  const n = x.length;
  if (n === 0) return 0;
  const k = lowerBound(x, value);
  if (k <= 0) return 0;
  if (k >= n) return n - 1;
  const below = x[k - 1] ?? Number.NaN;
  const above = x[k] ?? Number.NaN;
  return value - below <= above - value ? k - 1 : k;
}

/** First and last index inside [min, max] (x increasing); [k, k] with the nearest point if none is inside. */
export function indexRange(x: ArrayLike<number>, min: number, max: number): [number, number] {
  const n = x.length;
  if (n === 0) return [0, 0];
  let i0 = lowerBound(x, min);
  let i1 = lowerBound(x, max);
  if (i1 >= n || (x[i1] ?? Number.NaN) > max) i1 -= 1;
  i0 = Math.min(Math.max(i0, 0), n - 1);
  i1 = Math.min(Math.max(i1, 0), n - 1);
  if (i1 < i0) {
    const k = nearestIndex(x, (min + max) / 2);
    return [k, k];
  }
  return [i0, i1];
}
