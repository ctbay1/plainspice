/**
 * The number reader against what native ngspice 47 and 42 actually used.
 *
 * SUFFIX_CASES is the research run of 48 value spellings (each spelling put on a current source,
 * a resistor and a capacitor, read back with `print @i1[dc]`, `@r1[resistance]`,
 * `@c1[capacitance]` at 16 digits, in ngspice 42 and 47). All six readings agree except where
 * ngspice 47 raises a tiny resistance to 1e-12 Ω: that is the resistor's minimum, not the reading,
 * so the reading is tested. See docs/spice-facts/numbers-and-syntax.md.
 */
import { describe, expect, it } from 'vitest';
import { formatSpiceNumber, numberWordEnd, pow10, readNumber } from '../../src/spice/numbers.ts';

/** [case, spelling, value ngspice used (null: error), ngspice 47 resistor value when clamped, error message]. */
const SUFFIX_CASES: ReadonlyArray<readonly [string, string, number | null, number | null, string | null]> = [
  ['00', '1M', 0.001, null, null],
  ['01', '1m', 0.001, null, null],
  ['02', '1meg', 1000000, null, null],
  ['03', '1MEG', 1000000, null, null],
  ['04', '1Meg', 1000000, null, null],
  ['05', '1mil', 2.5399999999999997e-5, null, null],
  ['06', '3A', 3.0000000000000002e-18, 1e-12, null],
  ['07', '3a', 3.0000000000000002e-18, 1e-12, null],
  ['08', '1F', 1e-15, 1e-12, null],
  ['09', '1f', 1e-15, 1e-12, null],
  ['10', '1u', 1e-6, null, null],
  ['11', '1\u00b5', 1e-6, null, null],
  ['12', '10k', 10000, null, null],
  ['13', '10K', 10000, null, null],
  ['14', '1g', 1000000000, null, null],
  ['15', '1t', 1000000000000, null, null],
  ['16', '1p', 1e-12, null, null],
  ['17', '1n', 1e-9, null, null],
  ['18', '2.2k', 2200, null, null],
  ['19', '2k2', 2000, null, null],
  ['20', '10kOhm', 10000, null, null],
  ['21', '10V', 10, null, null],
  ['22', '1e3', 1000, null, null],
  ['23', '1E3', 1000, null, null],
  ['24', '1 k', null, null, 'unknown parameter (k)'],
  ['25', '1.', 1, null, null],
  ['26', '.5', 0.5, null, null],
  ['27', '1MOhm', 0.001, null, null],
  ['28', '1Mohm', 0.001, null, null],
  ['29', '4.7MΩ', 0.0047, null, null],
  ['30', '1kΩ', 1000, null, null],
  ['31', '1\u03bc', 1, null, null],
  ['32', '1G', 1000000000, null, null],
  ['33', '1T', 1000000000000, null, null],
  ['34', '1mA', 0.001, null, null],
  ['35', '100mV', 0.1, null, null],
  ['36', '1e3k', 1000000, null, null],
  ['37', '-2', -2, null, null],
  ['38', '+3', 3, null, null],
  ['39', '5 V', null, null, 'no such parameter on this device or parameter is missing'],
  ['40', '1x', 1, null, null],
  ['41', '4k7', 4000, null, null],
  ['42', '0.5', 0.5, null, null],
  ['43', '1e-3', 0.001, null, null],
  ['44', '1d3', 1000, null, null],
  ['45', '1meg5', 1000000, null, null],
  ['46', '1.5.2', 1.5, null, null],
  ['47', '1_000', 1, null, null],
];

describe('readNumber reproduces the 48 recorded ngspice readings', () => {
  it('has all 48 cases', () => {
    expect(SUFFIX_CASES).toHaveLength(48);
  });

  it.each(SUFFIX_CASES.filter(([, , used]) => used !== null))('case %s: %j reads as %s', (_id, spelling, used, clamped) => {
    const r = readNumber(spelling);
    expect(r).toBeDefined();
    expect(r!.value).toBe(used);
    expect(r!.rest).toBeUndefined();
    // ngspice 47 keeps the reading but raises a resistance below 1e-12 Ω to 1e-12 Ω.
    if (clamped !== null) expect([used! < 1e-12, clamped]).toEqual([true, 1e-12]);
  });

  it.each(SUFFIX_CASES.filter(([, , used]) => used === null))(
    'case %s: %j is two words, so ngspice stops (%s)',
    (_id, spelling, _used, _clamped, error) => {
      const r = readNumber(spelling)!;
      const [number, word] = spelling.split(' ') as [string, string];
      // The number's word is only the digits; the scale letter is a second word that ngspice
      // reads as a parameter name, and it has no such parameter.
      expect(r.value).toBe(Number(number));
      expect(r.rest).toBe(` ${word}`);
      expect(error).toMatch(/parameter/);
    },
  );
});

describe('readNumber: scale letters', () => {
  it.each([
    ['1T', 1e12, 'T', 'tera'],
    ['1G', 1e9, 'G', 'giga'],
    ['1MEG', 1e6, 'MEG', 'mega'],
    ['1K', 1e3, 'K', 'kilo'],
    ['1MIL', 2.5399999999999997e-5, 'MIL', 'mil'],
    ['1M', 1e-3, 'M', 'milli'],
    ['1U', 1e-6, 'U', 'micro'],
    ['1\u00b5', 1e-6, '\u00b5', 'micro'],
    ['1N', 1e-9, 'N', 'nano'],
    ['1P', 1e-12, 'P', 'pico'],
    ['1F', 1e-15, 'F', 'femto'],
    ['1A', 1e-18, 'A', 'atto'],
  ])('%s = %s (%s, %s)', (text, value, letters, name) => {
    const r = readNumber(text)!;
    expect(r.value).toBe(value);
    expect(r.scale).toMatchObject({ letters, name });
  });

  it('reports the scale factor in plain numbers', () => {
    expect(readNumber('2.2k')!.scale).toEqual({ letters: 'k', factor: 1000, name: 'kilo' });
    expect(readNumber('1mil')!.scale!.factor).toBeCloseTo(25.4e-6, 20);
  });

  it('reads M as milli unless EG or IL follows, in any case', () => {
    expect(readNumber('1Meg')!.value).toBe(1e6);
    expect(readNumber('1mEG')!.value).toBe(1e6);
    expect(readNumber('1me')!.value).toBe(1e-3);
    expect(readNumber('1MOhm')).toMatchObject({ value: 1e-3, ignored: 'Ohm' });
    expect(readNumber('1megohm')).toMatchObject({ value: 1e6, ignored: 'ohm' });
    expect(readNumber('1milli')).toMatchObject({ value: 2.5399999999999997e-5, ignored: 'li' });
  });

  it('reads the Greek letter mu as no scale at all (the value stays the bare number)', () => {
    expect(readNumber('1\u03bc')).toEqual({ text: '1\u03bc', value: 1, ignored: '\u03bc' });
  });

  it('compares letters byte by byte, like ngspice (the Kelvin sign is not k)', () => {
    expect(readNumber('1\u212a')).toEqual({ text: '1\u212a', value: 1, ignored: '\u212a' });
  });
});

describe('readNumber: what ngspice ignores, and what it reads as the next word', () => {
  it('ignores letters after the number and its scale letter', () => {
    expect(readNumber('10kOhm')).toEqual({ text: '10kOhm', value: 10000, scale: { letters: 'k', factor: 1000, name: 'kilo' }, ignored: 'Ohm' });
    expect(readNumber('2k2')).toMatchObject({ value: 2000, ignored: '2' });
    expect(readNumber('1_000')).toMatchObject({ value: 1, ignored: '_000' });
    expect(readNumber('1:5')).toMatchObject({ value: 1, ignored: ':5' });
  });

  it('ends the word at a comma: "1,5k" is the two words 1 and 5k', () => {
    expect(readNumber('1,5k')).toEqual({ text: '1,5k', value: 1, rest: ',5k' });
  });

  it("takes a sign only right after 'e': 1e-3 is one word, 1d-3 and 1k-2 are two", () => {
    expect(readNumber('1e-3')).toEqual({ text: '1e-3', value: 0.001 });
    expect(readNumber('1E+3')).toEqual({ text: '1E+3', value: 1000 });
    expect(readNumber('1d3')).toEqual({ text: '1d3', value: 1000 });
    expect(readNumber('1d-3')).toEqual({ text: '1d-3', value: 1, rest: '-3' });
    expect(readNumber('1k-2')).toMatchObject({ value: 1000, rest: '-2' });
    expect(readNumber('5-3')).toMatchObject({ value: 5, rest: '-3' });
  });

  it('ends the word at * / ^ and at = ( )', () => {
    expect(readNumber('10*2')).toMatchObject({ value: 10, rest: '*2' });
    expect(readNumber('1/2')).toMatchObject({ value: 1, rest: '/2' });
    expect(readNumber('2^3')).toMatchObject({ value: 2, rest: '^3' });
    expect(readNumber('5)')).toMatchObject({ value: 5, rest: ')' });
  });

  it('deletes carriage returns first, as ngspice does when it reads a line', () => {
    expect(readNumber('2\r5')).toMatchObject({ value: 25 });
  });
});

describe('readNumber: not a number', () => {
  it.each(['', 'abc', '-', '+', 'e5', 'k', '{1k*2}', "'2*3'", '"1"', ' 5', ',5', '=5', '(5', '--5'])('%j', (text) => {
    expect(readNumber(text)).toBeUndefined();
  });

  it('reads a lone point as zero, like ngspice', () => {
    expect(readNumber('.')!.value).toBe(0);
    expect(Object.is(readNumber('-.')!.value, -0)).toBe(true);
  });
});

describe('readNumber: the arithmetic is ngspice’s (digits × a power of ten, in doubles)', () => {
  it('gives the same doubles as native ngspice 47 and 42', () => {
    // Verified by running native ngspice (docs/spice-facts/numbers-and-syntax.md, num-arithmetic).
    expect(readNumber('0.3')!.value).toBe(0.30000000000000004);
    expect(readNumber('3.3')!.value).toBe(3.3000000000000003);
    expect(readNumber('1.1')!.value).toBe(1.1);
    expect(readNumber('1e-4')!.value).toBe(0.0001);
    expect(readNumber('2.2k')!.value).toBe(2200);
    expect(readNumber('1e23')!.value).toBe(1.0000000000000001e23);
    expect(readNumber('1e126')!.value).toBe(1e126);
  });

  it('follows the native build on huge numbers (int exponent wraps, overflow is infinity)', () => {
    expect(readNumber('1e4294967296')!.value).toBe(1);
    expect(readNumber('1e4294967297')!.value).toBe(10);
    expect(readNumber('1e400')!.value).toBe(Number.POSITIVE_INFINITY);
    expect(readNumber('1e-400')!.value).toBe(0);
    expect(readNumber('123456789012345678901234567890')!.value).toBe(1.2345678901234566e29);
  });

  it('pow10 matches glibc pow(10, n), including the two exponents where it is not correctly rounded', () => {
    const bits = (x: number): string => Buffer.from(new Float64Array([x]).buffer).toString('hex');
    expect(bits(pow10(23))).toBe('f74ae1c7022db544');
    expect(bits(pow10(210))).toBe('bc6b32317f55886b');
    expect(pow10(-3)).toBe(0.001);
    expect(pow10(309)).toBe(Number.POSITIVE_INFINITY);
    expect(pow10(-500)).toBe(0);
  });
});

describe('numberWordEnd: where ngspice ends a number word (INPgetUTok)', () => {
  it.each([
    ['1,5k', 0, 1],
    ['1e-3 x', 0, 4],
    ['1d-3', 0, 2],
    ['1k-2', 0, 2],
    ['-5', 0, 2],
    ['--5', 0, 1],
    ['*2', 0, 1],
    ['10kOhm', 0, 6],
    ['a b', 2, 3],
    ['', 0, 0],
  ])('%j from %i ends at %i', (text, start, end) => {
    expect(numberWordEnd(text, start)).toBe(end);
  });
});

describe('formatSpiceNumber: netlist-safe spellings for one-click fixes', () => {
  it.each([
    [1e6, '1meg'],
    [2200, '2.2k'],
    [1e-6, '1u'],
    [0.001, '1m'],
    [3, '3'],
    [-0.5, '-500m'],
    [4.7e-6, '4.7u'],
    [100e3, '100k'],
    [1e12, '1t'],
    [1e-12, '1p'],
    [1e15, '1e15'],
    [3e-18, '3e-18'],
    [0, '0'],
    [-0, '0'],
    [12.5, '12.5'],
  ])('%s -> %j', (value, spelling) => {
    expect(formatSpiceNumber(value)).toBe(spelling);
  });

  it('reads back exactly through readNumber for everyday values', () => {
    for (const v of [1e6, 2200, 1e-6, 1e-3, 3, 4.7e-6, 1e3, 1.5e3, 47e3, 10e-9, 0.5, 2.2, 4.7, 0.25, 330, 5e-3, 9.1e3, 0.1, 0.3]) {
      expect(readNumber(formatSpiceNumber(v))!.value, String(v)).toBe(v);
    }
  });

  it('always reads back within 2 units in the last place, as one clean word', () => {
    // ngspice computes digits × 10^n, so even "3.3" reads as 3.3000000000000003: the shortest
    // spelling of a double can come back one unit in the last place away.
    let seed = 7;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 20000; i++) {
      const v = (rnd() < 0.5 ? -1 : 1) * 10 ** (rnd() * 60 - 30) * (1 + rnd());
      const spelling = formatSpiceNumber(v);
      const r = readNumber(spelling);
      expect(r, spelling).toBeDefined();
      expect(r!.ignored ?? r!.rest, spelling).toBeUndefined();
      expect(Math.abs(r!.value - v) / Math.abs(v), spelling).toBeLessThanOrEqual(2 * Number.EPSILON);
    }
  });

  it('never uses the letters that trap beginners (M, F, A, capitals)', () => {
    for (const v of [1e6, 3.3e6, 1e-15, 4.7e-15, 3e-18, 1e-13, 2e15]) {
      const s = formatSpiceNumber(v);
      expect(s).not.toMatch(/[A-Z]/);
      expect(s).not.toMatch(/[fa]$/);
    }
  });

  it('has no spelling for infinity or NaN', () => {
    expect(formatSpiceNumber(Number.POSITIVE_INFINITY)).toBe('Infinity');
    expect(formatSpiceNumber(Number.NaN)).toBe('NaN');
  });
});
