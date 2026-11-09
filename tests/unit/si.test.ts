import { describe, expect, it } from 'vitest';
import { formatLikeNgspice, formatNumber, formatSI, speakSI } from '../../src/format/si.ts';

const NB = ' ';

describe('formatSI: numbers in plain units', () => {
  it.each([
    [12, 'V', `12${NB}V`],
    [1.2e1, 'V', `12${NB}V`],
    [-6, 'V', `−6${NB}V`],
    [0.0015, 'A', `1.5${NB}mA`],
    [5.999999994, 'V', `6${NB}V`],
    [1e6, 'Ω', `1${NB}MΩ`],
    [1e-3, 'Ω', `1${NB}mΩ`],
    [3e-18, 'A', `3${NB}aA`],
    [999.96, 'Ω', `1${NB}kΩ`],
    [4.966295, 'V', `4.966${NB}V`],
    [0, 'V', `0${NB}V`],
    [2.2e-6, 'F', `2.2${NB}µF`],
  ])('%s %s -> %s', (value, unit, text) => {
    expect(formatSI(value, unit)).toBe(text);
  });
  it('shows infinity and NaN in words', () => {
    expect(formatSI(Number.POSITIVE_INFINITY, 'Ω')).toBe('∞');
    expect(formatSI(Number.NaN, 'V')).toBe('not a number');
  });
});

describe('formatNumber: ratios without a unit', () => {
  it.each([
    [1 / 3, '0.3333'],
    [14, '14'],
    [-0.5, '−0.5'],
    [1.5e-9, '1.5e-9'],
    [2e7, '2e+7'],
  ])('%s -> %s', (value, text) => expect(formatNumber(value)).toBe(text));
});

describe('speakSI: words for screen readers', () => {
  it.each([
    [-6, 'V', 'minus 6 volts'],
    [1, 'V', '1 volt'],
    [0.0015, 'A', '1.5 milliamperes'],
    [4, 'Ω', '4 ohms'],
    [1e6, 'Ω', '1 megaohm'],
    [1e-3, 'A', '1 milliampere'],
  ])('%s %s -> %s', (value, unit, text) => expect(speakSI(value, unit)).toBe(text));
});

describe('formatLikeNgspice', () => {
  it('prints 7 significant digits with a two-digit exponent, like ngspice -b', () => {
    expect(formatLikeNgspice(12)).toBe('1.200000e+01');
    expect(formatLikeNgspice(1 / 3)).toBe('3.333333e-01');
    expect(formatLikeNgspice(-6)).toBe('-6.000000e+00');
  });
});
