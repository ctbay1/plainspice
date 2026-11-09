/**
 * The data side of the plot (src/plot/data.ts, format.ts, palette.ts): drawing order, panels,
 * index searches, axis tick labels and series styles. The two sweep shapes below are what
 * native ngspice 47 writes (see the comment at the top of src/plot/data.ts).
 */
import { describe, expect, it } from 'vitest';
import { indexRange, lowerBound, nearestIndex, pointCount, preparePlot } from '../../src/plot/data.ts';
import { cursorDigits, tickLabels } from '../../src/plot/format.ts';
import { markerPath, PLOT_DASHES, PLOT_MARKERS, seriesStyle } from '../../src/plot/palette.ts';
import { parseCssColour } from '../../src/plot/theme.ts';
import type { PlotSeries, PlotSpec, PlotUnit } from '../../src/plot/types.ts';

const series = (label: string, unit: PlotUnit, values: ArrayLike<number>): PlotSeries => ({ label, unit, values });
const plain = (texts: string[]): string[] => texts.map((t) => t.replace(/\u00A0/g, ' '));

describe('preparePlot', () => {
  it('uses engine Float64Arrays without copying, and groups series by unit into panels', () => {
    const t = new Float64Array([0, 1e-3, 2e-3]);
    const v = new Float64Array([0, 1, 2]);
    const i = new Float64Array([0, -1e-3, -2e-3]);
    const spec: PlotSpec = { title: 'T', kind: 'tran', x: series('time', 's', t), series: [series('v(in)', 'V', v), series('i(v1)', 'A', i), series('v(out)', 'V', v)] };
    const p = preparePlot(spec);
    expect(p.x).toBe(t);
    expect(p.series[0]!.values).toBe(v);
    expect(p.plottable).toBe(true);
    expect(p.reversed).toBe(false);
    expect(p.panels).toEqual([
      { unit: 'V', series: [0, 2] },
      { unit: 'A', series: [1] },
    ]);
    expect(p.series.map((s) => s.style.colour)).toEqual([0, 1, 2]);
  });

  it('one panel when every series has the same unit', () => {
    const p = preparePlot({ title: 'D', kind: 'dc', x: series('V1', 'V', [0, 1]), series: [series('v(a)', 'V', [0, 1]), series('v(b)', 'V', [1, 0])] });
    expect(p.panels).toEqual([{ unit: 'V', series: [0, 1] }]);
  });

  it('draws a downward sweep (.dc V1 12 0 -3) in increasing order', () => {
    const p = preparePlot({ title: 'D', kind: 'dc', x: series('V1', 'V', [12, 9, 6, 3, 0]), series: [series('v(out)', 'V', [8, 6, 4, 2, 0])] });
    expect(p.reversed).toBe(true);
    expect(p.plottable).toBe(true);
    expect([...p.x]).toEqual([0, 3, 6, 9, 12]);
    expect([...p.series[0]!.values]).toEqual([0, 2, 4, 6, 8]);
  });

  it('cannot draw a sweep inside a sweep (.dc V1 0 2 1 V2 0 1 1: x repeats)', () => {
    const p = preparePlot({
      title: 'D',
      kind: 'dc',
      x: series('V1', 'V', [0, 1, 2, 0, 1, 2]),
      series: [series('v(out)', 'V', [0, 0.667, 1.333, 0.333, 1, 1.667])],
    });
    expect(p.plottable).toBe(false);
  });

  it('no points, NaN in x, plain arrays, different lengths', () => {
    expect(preparePlot({ title: 'x', kind: 'dc', x: series('V1', 'V', []), series: [] }).plottable).toBe(false);
    expect(preparePlot({ title: 'x', kind: 'dc', x: series('V1', 'V', [0, Number.NaN, 2]), series: [] }).plottable).toBe(false);
    const p = preparePlot({ title: 'x', kind: 'dc', x: series('V1', 'V', [0, 1, 2, 3]), series: [series('v', 'V', [5, 6])] });
    expect(p.n).toBe(2);
    expect(p.x).toBeInstanceOf(Float64Array);
    expect([...p.x]).toEqual([0, 1]);
    expect(pointCount({ title: 'x', kind: 'dc', x: series('V1', 'V', [0, 1, 2]), series: [series('v', 'V', [1, 2, 3, 4])] })).toBe(3);
  });
});

describe('index searches (x increasing)', () => {
  const x = new Float64Array([0, 1, 2, 4, 8]);
  it('lowerBound', () => {
    expect([-1, 0, 0.5, 2, 3, 8, 9].map((v) => lowerBound(x, v))).toEqual([0, 0, 1, 2, 3, 4, 5]);
  });
  it('nearestIndex', () => {
    expect([-5, 0.4, 0.6, 3, 3.1, 7, 100].map((v) => nearestIndex(x, v))).toEqual([0, 0, 1, 2, 3, 4, 4]);
    expect(nearestIndex(new Float64Array(0), 1)).toBe(0);
  });
  it('indexRange', () => {
    expect(indexRange(x, 0, 8)).toEqual([0, 4]);
    expect(indexRange(x, 0.5, 4)).toEqual([1, 3]);
    expect(indexRange(x, 4.5, 7)).toEqual([3, 3]); // nothing inside: the nearest point to the middle
    expect(indexRange(x, -10, 100)).toEqual([0, 4]);
  });
});

describe('tickLabels: one SI prefix per axis', () => {
  it('time, current, voltage, resistance and unitless axes', () => {
    expect(plain(tickLabels([0, 0.0005, 0.001, 0.0015, 0.002], 's'))).toEqual(['0 ms', '0.5 ms', '1 ms', '1.5 ms', '2 ms']);
    expect(plain(tickLabels([-0.004, -0.002, 0], 'A'))).toEqual(['−4 mA', '−2 mA', '0 mA']);
    expect(plain(tickLabels([0, 4, 8, 12], 'V'))).toEqual(['0 V', '4 V', '8 V', '12 V']);
    expect(plain(tickLabels([0, 500, 1000], 'Ω'))).toEqual(['0 kΩ', '0.5 kΩ', '1 kΩ']);
    expect(plain(tickLabels([0, 0.25, 0.5], ''))).toEqual(['0 m', '250 m', '500 m']);
    expect(plain(tickLabels([0, 25, 50, 75], '°C'))).toEqual(['0 °C', '25 °C', '50 °C', '75 °C']);
  });
  it('tiny and large values, floating-point noise, a single zero', () => {
    expect(plain(tickLabels([1e-9, 2e-9, 3e-9], 's'))).toEqual(['1 ns', '2 ns', '3 ns']);
    expect(plain(tickLabels([0.1 + 0.2, 0.6], 'V'))).toEqual(['300 mV', '600 mV']);
    expect(plain(tickLabels([999.99e-6, 0], 'A'))).toEqual(['1 mA', '0 mA']);
    expect(plain(tickLabels([0], 'V'))).toEqual(['0 V']);
    expect(plain(tickLabels([2e6, 4e6], 'Ω'))).toEqual(['2 MΩ', '4 MΩ']);
  });
});

describe('cursorDigits', () => {
  it('four digits normally, more where neighbouring points would read the same', () => {
    expect(cursorDigits([0, 1e-3, 2e-3], 1, 's')).toBe(4);
    expect(cursorDigits([1e-3, 1.00001e-3, 1.00002e-3], 1, 's')).toBe(6);
    expect(cursorDigits([5], 0, 'V')).toBe(4);
  });
});

describe('series styles', () => {
  it('four colours, dashes and markers; from the fifth series on the marker shifts', () => {
    const styles = Array.from({ length: 16 }, (_, i) => seriesStyle(i));
    expect(styles.slice(0, 4).map((s) => [s.colour, s.dash, s.marker])).toEqual([
      [0, [], 'circle'],
      [1, [8, 4], 'square'],
      [2, [2, 3], 'triangle'],
      [3, [8, 3, 2, 3], 'diamond'],
    ]);
    const keys = styles.map((s) => `${s.colour}|${s.dash.join(',')}|${s.marker}`);
    expect(new Set(keys).size).toBe(16);
    expect(PLOT_DASHES).toHaveLength(4);
    expect(PLOT_MARKERS).toHaveLength(4);
  });
  it('marker paths are closed SVG paths', () => {
    for (const shape of PLOT_MARKERS) expect(markerPath(shape, 10, 10, 4)).toMatch(/^M.*Z$/);
  });
});

describe('parseCssColour (computed colours, for the canvas theme)', () => {
  it('reads the forms browsers return', () => {
    expect(parseCssColour('rgb(255, 253, 246)')).toEqual([1, 253 / 255, 246 / 255]);
    expect(parseCssColour('rgba(0, 0, 0, 0.5)')).toEqual([0, 0, 0]);
    expect(parseCssColour('rgb(30 42 69 / 1)')).toEqual([30 / 255, 42 / 255, 69 / 255]);
    expect(parseCssColour('color(srgb 0.1 0.2 0.3)')).toEqual([0.1, 0.2, 0.3]);
    expect(parseCssColour('#1E2A45')).toEqual([30 / 255, 42 / 255, 69 / 255]);
  });
  it('gives up on anything else (the theme then uses its fallback)', () => {
    expect(parseCssColour('var(--surface, #fff)')).toBeUndefined();
    expect(parseCssColour('')).toBeUndefined();
  });
});
