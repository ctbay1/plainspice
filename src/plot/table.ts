/**
 * The plot's data as a table and as a CSV file. Pure: no DOM, no uPlot.
 *
 * - tableRows(): at most `maxRows` evenly spaced points (first and last always included), every
 *   value through formatSI, in ngspice's point order. A 13-point dc sweep shows every point.
 * - csvText(): every point at full precision (the shortest text that reads back as the same
 *   float64), for a spreadsheet or a script.
 */
import { formatSI } from '../format/si.ts';
import { pointCount } from './data.ts';
import { PLOT_STRINGS } from './strings.ts';
import type { PlotSeries, PlotSpec, PlotTable } from './types.ts';

/** Indices of `maxRows` evenly spaced points out of `n` (all of them when n <= maxRows). */
export function decimateIndices(n: number, maxRows: number): number[] {
  const count = Math.max(0, Math.floor(n));
  const rows = Math.max(2, Math.floor(maxRows) || 2);
  if (count <= rows) return Array.from({ length: count }, (_, k) => k);
  // count > rows, so the step is more than 1 and rounding never repeats an index.
  return Array.from({ length: rows }, (_, r) => Math.round((r * (count - 1)) / (rows - 1)));
}

const header = (s: PlotSeries): string => (s.unit ? `${s.label} (${s.unit})` : s.label);

/** The data table: a header row and evenly spaced rows, every value via formatSI. */
export function tableRows(spec: PlotSpec, maxRows = 200): PlotTable {
  const n = pointCount(spec);
  const indices = decimateIndices(n, maxRows);
  const xs = indices.map((k) => spec.x.values[k] ?? Number.NaN);
  // Four significant digits, or more where neighbouring rows would otherwise show the same x
  // (closely spaced time steps), so every row can be told apart.
  let xText = xs.map((v) => formatSI(v, spec.x.unit));
  for (let digits = 5; digits <= 9 && new Set(xText).size < new Set(xs).size; digits++) {
    xText = xs.map((v) => formatSI(v, spec.x.unit, digits));
  }
  return {
    header: [header(spec.x), ...spec.series.map(header)],
    rows: indices.map((k, r) => [xText[r] ?? '', ...spec.series.map((s) => formatSI(s.values[k] ?? Number.NaN, s.unit))]),
  };
}

/** One CSV field (RFC 4180): quoted when it holds a comma, a quote or a line break. */
function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Every point as CSV: a header with units ("time (s)", "v(out) (V)"), then plain numbers such as
 * 4.966294815432716 and 1e-8 that spreadsheets read as numbers. It starts with a byte order mark,
 * so spreadsheet programs read labels such as "Ω" or Turkish node names as UTF-8.
 */
export function csvText(spec: PlotSpec): string {
  const n = pointCount(spec);
  const columns = [spec.x, ...spec.series];
  const lines = [columns.map((s) => csvField(header(s))).join(',')];
  for (let k = 0; k < n; k++) lines.push(columns.map((s) => String(s.values[k] ?? '')).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** "plot-transient-analysis-v-out.csv": the title in lower case, letters (any language) and digits only. */
export function csvFileName(title: string): string {
  const slug = title
    .toLocaleLowerCase(PLOT_STRINGS.locale)
    .normalize('NFC')
    // Keep combining marks too: "İ" lower-cases to "i" plus a combining dot.
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  // At most 48 characters, cut between words where possible.
  const lastBreak = slug.slice(0, 49).lastIndexOf('-');
  const short = slug.length <= 48 ? slug : lastBreak > 0 ? slug.slice(0, lastBreak) : slug.slice(0, 48);
  // The prefix also keeps names such as "con" or "nul", which Windows reserves, valid.
  return `${PLOT_STRINGS.csvFilePrefix}${short ? `-${short}` : ''}.csv`;
}
