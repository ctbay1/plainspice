/**
 * summarisePlot (src/plot/summary.ts): the plot in plain words. The T1 and D1 fixtures use the
 * vectors recorded from native ngspice 47 (tests/golden/native/), so these are the sentences a
 * student sees for those circuits.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Unit } from '../../src/engine/results.ts';
import { summarisePlot } from '../../src/plot/summary.ts';
import type { PlotSeries, PlotSpec, PlotUnit } from '../../src/plot/types.ts';

// The plot's units must cover every unit the engine reports (type check only).
const engineUnit: Unit = 'V' as Unit;
const plotUnit: PlotUnit = engineUnit;
void plotUnit;

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
const series = (label: string, unit: PlotUnit, values: number[]): PlotSeries => ({ label, unit, values });
/**
 * formatSI joins a number and its unit with a no-break space (so "4.966 V" never breaks across
 * lines); the expected sentences below are written with plain spaces for readability.
 */
const summary = (spec: PlotSpec): string => summarisePlot(spec).replace(/\u00A0/g, ' ');
const tran = (t: number[], ...s: PlotSeries[]): PlotSpec => ({ title: 't', kind: 'tran', x: series('time', 's', t), series: s });
const dc = (x: number[], ...s: PlotSeries[]): PlotSpec => ({ title: 'd', kind: 'dc', x: series('V1', 'V', x), series: s });

describe('summarisePlot on recorded ngspice results', () => {
  it('T1, an RC circuit charging (.tran, 520 points)', () => {
    expect(summary(fromNative('t1-tran-rc-charge', 'tran', 'time'))).toBe(
      'v(in) rises from 0 V to 5 V over 5 ms; final value 5 V. ' +
        'v(out) rises from 0 V to 4.966 V over 5 ms; final value 4.966 V. ' +
        'i(v1) goes from 0 A to −33.71 µA over 5 ms; lowest −4.998 mA at 1 µs, highest 0 A at 0 s; final value −33.71 µA.',
    );
  });

  it('D1, a divider swept from 0 to 12 V (.dc, 13 points): straight lines with their slopes, negative current', () => {
    expect(summary(fromNative('d1-dc-divider-sweep', 'dc', 'V1'))).toBe(
      'v(in) rises in a straight line from 0 V to 12 V as V1 goes from 0 V to 12 V (slope 1 V/V). ' +
        'v(out) rises in a straight line from 0 V to 8 V as V1 goes from 0 V to 12 V (slope 0.6667 V/V). ' +
        'i(v1) falls in a straight line from 0 A to −4 mA as V1 goes from 0 V to 12 V (slope −333.3 µA/V).',
    );
  });
});

describe('summarisePlot shapes', () => {
  it('keeps each number with its unit (no-break space)', () => {
    expect(summarisePlot(tran([0, 1e-3], series('v(a)', 'V', [0, 4.966])))).toContain('4.966\u00A0V');
  });

  it('keeps ngspice\'s order for a sweep run downwards (.dc V1 12 0 -3)', () => {
    // Values as native ngspice 47 wrote them for that sweep.
    const spec = dc([12, 9, 6, 3, 0], series('v(out)', 'V', [8, 6, 4, 2, 0]));
    expect(summary(spec)).toBe('v(out) falls in a straight line from 8 V to 0 V as V1 goes from 12 V to 0 V (slope 0.6667 V/V).');
  });

  it('says where a rising line crosses zero', () => {
    const spec = dc([0, 1, 2, 3, 4], series('i(r1)', 'A', [-2e-3, -1e-3, 0.5e-3, 1e-3, 3e-3]));
    // Not straight; crosses between 1 V and 2 V, where the drawn line crosses zero (1.667 V).
    expect(summary(spec)).toBe('i(r1) rises from −2 mA to 3 mA as V1 goes from 0 V to 4 V; crossing 0 A at V1 = 1.667 V.');
  });

  it('a point that is exactly zero is the crossing', () => {
    const spec = dc([0, 1, 2], series('v(a)', 'V', [-1, 0, 1]));
    expect(summary(spec)).toBe('v(a) rises in a straight line from −1 V to 1 V as V1 goes from 0 V to 2 V (slope 1 V/V); crossing 0 V at V1 = 1 V.');
  });

  it('counts the crossings of a wave and gives its extremes', () => {
    // A triangle wave with exact zeros (a sampled sine is never exactly 0 at its crossings).
    const v = [0, 1, 2, 1, 0, -1, -2, -1, 0, 1, 2, 1, 0];
    const t = v.map((_, k) => k * 1e-4);
    expect(summary(tran(t, series('v(x)', 'V', v)))).toBe(
      'v(x) goes from 0 V to 0 V over 1.2 ms; lowest −2 V at 600 µs, highest 2 V at 200 µs; crossing 0 V 2 times; final value 0 V.',
    );
  });

  it('an overshoot that sags back in many tiny steps is not "rises"', () => {
    // Up to 5 V, then down by 4 mV in 1000 steps of 4 µV: each step is below the tolerance
    // (a millionth of the 5 V range), but the sag as a whole is not.
    const n = 2001;
    const t = Array.from({ length: n }, (_, k) => k * 1e-6);
    const v = t.map((_, k) => (k <= 1000 ? (5 * k) / 1000 : 5 - (0.004 * (k - 1000)) / 1000));
    expect(summary(tran(t, series('v(o)', 'V', v)))).toBe(
      'v(o) goes from 0 V to 4.996 V over 2 ms; lowest 0 V at 0 s, highest 5 V at 1 ms; final value 4.996 V.',
    );
  });

  it('a constant says "stays at" (no final value: it is the same)', () => {
    expect(summary(tran([0, 1e-3, 2e-3], series('v(vcc)', 'V', [5, 5, 5])))).toBe('v(vcc) stays at 5 V over 2 ms.');
  });

  it('a transient that does not start at 0 gives its time range', () => {
    expect(summary(tran([1e-3, 2e-3, 3e-3], series('v(a)', 'V', [1, 2, 4])))).toBe(
      'v(a) rises from 1 V to 4 V from 1 ms to 3 ms; final value 4 V.',
    );
  });

  it('a ramp in a transient gets its slope in units per second', () => {
    expect(summary(tran([0, 1e-3, 2e-3], series('v(c)', 'V', [0, 1, 2])))).toBe(
      'v(c) rises in a straight line from 0 V to 2 V over 2 ms (slope 1 kV/s); final value 2 V.',
    );
  });

  it('one point', () => {
    expect(summary(dc([6], series('v(out)', 'V', [4])))).toBe('v(out) is 4 V at V1 = 6 V.');
    expect(summary(tran([0], series('i(v1)', 'A', [-2e-3])))).toBe('i(v1) is −2 mA at 0 s.');
  });

  it('no points, no series', () => {
    expect(summary(dc([], series('v(out)', 'V', [])))).toBe('v(out) has no points.');
    expect(summary(dc([0, 1]))).toBe('There is nothing to plot.');
  });

  it('uses the shortest vector when lengths differ', () => {
    expect(summary(dc([0, 1, 2, 3], series('v(a)', 'V', [0, 1])))).toBe(
      'v(a) rises in a straight line from 0 V to 1 V as V1 goes from 0 V to 1 V (slope 1 V/V).',
    );
  });

  it('other units: resistance and temperature sweeps, and a quantity without a unit', () => {
    const r: PlotSpec = { title: 'r', kind: 'dc', x: series('R1', 'Ω', [1e3, 2e3]), series: [series('v(out)', 'V', [6, 8])] };
    expect(summary(r)).toBe('v(out) rises in a straight line from 6 V to 8 V as R1 goes from 1 kΩ to 2 kΩ (slope 2 mV/Ω).');
    const temp: PlotSpec = { title: 't', kind: 'dc', x: series('temperature', '°C', [0, 50, 100]), series: [series('gain', '', [2, 1.5, 1])] };
    expect(summary(temp)).toBe('gain falls in a straight line from 2 to 1 as temperature goes from 0 °C to 100 °C (slope −0.01 per °C).');
  });
});
