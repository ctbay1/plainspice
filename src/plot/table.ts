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

/** The columns of the table and the file: x, each series, and next to a series that has them its values as ngspice gave them. */
function columns(spec: PlotSpec): { head: string; values: ArrayLike<number>; unit: PlotSeries['unit'] }[] {
  const out = [{ head: header(spec.x), values: spec.x.values, unit: spec.x.unit }];
  for (const s of spec.series) {
    out.push({ head: header(s), values: s.values, unit: s.unit });
    if (s.given) out.push({ head: header({ ...s, label: PLOT_STRINGS.givenColumn(s.label) }), values: s.given, unit: s.unit });
  }
  return out;
}

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
  const ys = columns(spec).slice(1);
  return {
    header: [header(spec.x), ...ys.map((c) => c.head)],
    rows: indices.map((k, r) => [xText[r] ?? '', ...ys.map((c) => formatSI(c.values[k] ?? Number.NaN, c.unit))]),
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
  const all = columns(spec);
  const lines = [all.map((c) => csvField(c.head)).join(',')];
  for (let k = 0; k < n; k++) lines.push(all.map((c) => String(c.values[k] ?? '')).join(','));
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
