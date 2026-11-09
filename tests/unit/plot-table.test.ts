/**
 * tableRows, csvText and csvFileName (src/plot/table.ts): the plot's data as a decimated table
 * (every value via formatSI) and as a CSV file with every point at full precision.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatSI } from '../../src/format/si.ts';
import { csvFileName, csvText, decimateIndices, tableRows } from '../../src/plot/table.ts';
import type { PlotSeries, PlotSpec, PlotUnit } from '../../src/plot/types.ts';

interface NativeVector {
  name: string;
  type: string;
  values: number[];
}
const native = (id: string): NativeVector[] =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, `../golden/native/ngspice-47/${id}.json`), 'utf8')).plots[0].vectors;
const unitOf = (v: NativeVector): PlotUnit => (v.name === 'time' ? 's' : v.type === 'current' ? 'A' : v.type === 'voltage' ? 'V' : '');
const fromNative = (id: string, kind: 'dc' | 'tran', xLabel: string): PlotSpec => {
  const [x, ...rest] = native(id);
  return {
    title: id,
    kind,
    x: { label: xLabel, unit: unitOf(x!), values: Float64Array.from(x!.values) },
    series: rest.map((v) => ({ label: v.name, unit: unitOf(v), values: Float64Array.from(v.values) })),
  };
};
const series = (label: string, unit: PlotUnit, values: ArrayLike<number>): PlotSeries => ({ label, unit, values });
/** Plain spaces instead of formatSI's no-break space, for readable expectations. */
const plain = (rows: string[][]): string[][] => rows.map((r) => r.map((c) => c.replace(/\u00A0/g, ' ')));

describe('decimateIndices', () => {
  it('keeps every point when there are few', () => {
    expect(decimateIndices(13, 200)).toEqual([...Array(13).keys()]);
    expect(decimateIndices(0, 200)).toEqual([]);
    expect(decimateIndices(1, 200)).toEqual([0]);
  });
  it('spaces rows evenly, always with the first and the last point, never twice the same', () => {
    const idx = decimateIndices(100_000, 200);
    expect(idx).toHaveLength(200);
    expect(idx[0]).toBe(0);
    expect(idx.at(-1)).toBe(99_999);
    for (let r = 1; r < idx.length; r++) expect(idx[r]! - idx[r - 1]!).toBeGreaterThanOrEqual(502);
    const just = decimateIndices(201, 200);
    expect(new Set(just).size).toBe(200);
  });
  it('treats a silly maxRows as 2 rows', () => {
    expect(decimateIndices(10, 0)).toEqual([0, 9]);
    expect(decimateIndices(10, Number.NaN)).toEqual([0, 9]);
    expect(decimateIndices(10, 2.9)).toEqual([0, 9]);
  });
});

describe('tableRows', () => {
  it('D1 (.dc, 13 points): every point, units in the header, negative currents with a real minus sign', () => {
    const t = tableRows(fromNative('d1-dc-divider-sweep', 'dc', 'V1'));
    expect(t.header).toEqual(['V1 (V)', 'v(in) (V)', 'v(out) (V)', 'i(v1) (A)']);
    expect(t.rows).toHaveLength(13);
    expect(plain(t.rows).slice(0, 2)).toEqual([
      ['0 V', '0 V', '0 V', '0 A'],
      ['1 V', '1 V', '666.7 mV', '−333.3 µA'],
    ]);
    expect(plain(t.rows).at(-1)).toEqual(['12 V', '12 V', '8 V', '−4 mA']);
  });

  it('T1 (.tran, 520 points): 200 rows from 0 s to 5 ms, every value via formatSI', () => {
    const spec = fromNative('t1-tran-rc-charge', 'tran', 'time');
    const t = tableRows(spec);
    expect(t.header).toEqual(['time (s)', 'v(in) (V)', 'v(out) (V)', 'i(v1) (A)']);
    expect(t.rows).toHaveLength(200);
    expect(plain(t.rows)[0]).toEqual(['0 s', '0 V', '0 V', '0 A']);
    expect(plain(t.rows).at(-1)).toEqual(['5 ms', '5 V', '4.966 V', '−33.71 µA']);
    // Each cell is formatSI of the value at the decimated index.
    const idx = decimateIndices(520, 200);
    t.rows.forEach((row, r) => {
      const k = idx[r]!;
      expect(row[2]).toBe(formatSI(spec.series[1]!.values[k]!, 'V'));
      expect(row[3]).toBe(formatSI(spec.series[2]!.values[k]!, 'A'));
    });
  });

  it('a smaller maxRows', () => {
    const spec = fromNative('t1-tran-rc-charge', 'tran', 'time');
    expect(tableRows(spec, 10).rows).toHaveLength(10);
  });

  it('100 000 points: 200 rows, and the x column gets more digits where four would repeat', () => {
    const n = 100_000;
    // A time grid starting at 1 ms with 10 ns steps: 1.00001 ms, 1.00002 ms ... (4 digits would all read "1 ms").
    const t = Float64Array.from({ length: n }, (_, k) => 1e-3 + k * 1e-8);
    const v = Float64Array.from({ length: n }, (_, k) => Math.sin(k / 1000));
    const table = tableRows({ title: 'x', kind: 'tran', x: series('time', 's', t), series: [series('v(a)', 'V', v)] });
    expect(table.rows).toHaveLength(200);
    const xs = table.rows.map((r) => r[0]);
    expect(new Set(xs).size).toBe(200);
  });

  it('one point, no series, unitless values', () => {
    expect(plain(tableRows({ title: 'x', kind: 'dc', x: series('V1', 'V', [6]), series: [series('v(out)', 'V', [4])] }).rows)).toEqual([['6 V', '4 V']]);
    const xOnly = tableRows({ title: 'x', kind: 'dc', x: series('V1', 'V', [0, 1]), series: [] });
    expect(xOnly.header).toEqual(['V1 (V)']);
    expect(plain(xOnly.rows)).toEqual([['0 V'], ['1 V']]);
    const ratio = tableRows({ title: 'x', kind: 'dc', x: series('V1', 'V', [1]), series: [series('gain', '', [0.25])] });
    expect(ratio.header).toEqual(['V1 (V)', 'gain']);
    expect(plain(ratio.rows)).toEqual([['1 V', '250 m']]);
  });
});

describe('csvText', () => {
  const spec = fromNative('d1-dc-divider-sweep', 'dc', 'V1');
  const text = csvText(spec);
  const lines = text.slice(1).split('\r\n');

  it('starts with a byte order mark and a header with units', () => {
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0]).toBe('V1 (V),v(in) (V),v(out) (V),i(v1) (A)');
  });

  it('has every point, at full precision (reads back as the same float64)', () => {
    expect(lines).toHaveLength(13 + 2); // header, 13 points, and the empty string after the last line break
    expect(lines.at(-1)).toBe('');
    const row = lines[2]!.split(',').map(Number);
    expect(row).toEqual([spec.x.values[1], ...spec.series.map((s) => s.values[1])]);
    expect(lines[2]).toBe('1,1,0.6666666666666666,-0.0003333333333333334');
  });

  it('quotes labels that hold commas or quotes', () => {
    const odd = csvText({ title: 'x', kind: 'dc', x: series('V1', 'V', [0]), series: [series('v(a,b)', 'V', [1]), series('say "hi"', '', [2])] });
    expect(odd.slice(1).split('\r\n')[0]).toBe('V1 (V),"v(a,b) (V)","say ""hi"""');
  });

  it('100 000 points', () => {
    const n = 100_000;
    const t = Float64Array.from({ length: n }, (_, k) => k * 5e-8);
    const big = csvText({ title: 'x', kind: 'tran', x: series('time', 's', t), series: [series('v(out)', 'V', t)] });
    expect(big.split('\r\n')).toHaveLength(n + 2);
  });
});

describe('csvFileName', () => {
  it('makes a file name from the title', () => {
    expect(csvFileName('Transient analysis: v(out) and i(v1) against time')).toBe('plot-transient-analysis-v-out-and-i-v1-against-time.csv');
    expect(csvFileName('DC sweep of V1')).toBe('plot-dc-sweep-of-v1.csv');
  });
  it('keeps letters of any language, and needs no title', () => {
    expect(csvFileName('Çıkış gerilimi')).toBe('plot-çıkış-gerilimi.csv');
    expect(csvFileName('İ')).toMatch(/^plot-i\u0307?\.csv$/);
    expect(csvFileName('???')).toBe('plot.csv');
    expect(csvFileName('CON')).toBe('plot-con.csv');
  });
  it('keeps names short, cut between words', () => {
    expect(csvFileName('a'.repeat(200))).toBe(`plot-${'a'.repeat(48)}.csv`);
    expect(csvFileName('Transient analysis: v(in), v(out) and i(v1) against time')).toBe('plot-transient-analysis-v-in-v-out-and-i-v1-against.csv');
  });
});
