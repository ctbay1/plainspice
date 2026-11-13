/**
 * src/spice/exact.ts: a value read exactly as ngspice's grammar reads it, the circuit PlainSpice solves
 * exactly, the exact solution, and the check that ngspice simulated that same circuit (decision 0015).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AnalysisResults } from '../../src/engine/results.ts';
import { roundingNoise } from '../../src/spice/describe.ts';
import {
  agrees,
  ANSWER_FLOOR,
  ANSWER_GAP,
  answersAgree,
  answersGap,
  currentDouble,
  exactModel,
  exactValue,
  fraction,
  fromDouble,
  isZero,
  MAX_UNKNOWNS,
  operatingPoint,
  overCommon,
  partCurrent,
  READ_ULPS,
  readExact,
  shares,
  solveExact,
  toDouble,
  ulp,
  ZERO,
  type ExactModel,
  type Fraction,
} from '../../src/spice/exact.ts';
import { readAfterEnd } from '../../src/spice/explain.ts';
import { readNumber } from '../../src/spice/numbers.ts';
import { parseNetlist } from '../../src/spice/parse.ts';

const root = resolve(import.meta.dirname, '../..');

/** Every netlist the repository has: examples, fixtures, the trap corpus and the facts' spice blocks. */
function corpus(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.cir')) out.push(readFileSync(p, 'utf8'));
    }
  };
  for (const dir of ['examples', 'tests/fixtures', 'tests/corpus']) walk(join(root, dir));
  for (const doc of ['explanations.md', 'numbers-and-syntax.md', 'traps.md']) {
    const text = readFileSync(join(root, 'docs/spice-facts', doc), 'utf8');
    for (const m of text.matchAll(/```spice\n([\s\S]*?)```/g)) out.push(m[1]!);
  }
  return out;
}

const model = (text: string): ExactModel | string => {
  const n = parseNetlist(text);
  return exactModel(n, n.lines.filter((l) => l.element).map((l) => l.element!), readAfterEnd(n));
};
const solve = (m: ExactModel): Fraction[] => solveExact(m, [operatingPoint(m)])![0]!;
const q = (n: bigint, d = 1n): Fraction => fraction(n, d);

describe('readExact: the value a word writes, read by ngspice\'s grammar', () => {
  it('reads scale letters and the unit-letter traps as ngspice does, as exact decimals', () => {
    expect(readExact('4.7k')).toEqual(q(4700n));
    expect(readExact('0.3')).toEqual(q(3n, 10n));
    expect(readExact('2A')).toEqual(q(2n, 10n ** 18n));
    expect(readExact('10M')).toEqual(q(1n, 100n));
    expect(readExact('1meg')).toEqual(q(10n ** 6n));
    expect(readExact('1MEGohm')).toEqual(q(10n ** 6n));
    expect(readExact('1mil')).toEqual(q(254n, 10n ** 7n));
    expect(readExact('2k2')).toEqual(q(2000n));
    expect(readExact('10kOhm')).toEqual(q(10000n));
    expect(readExact('1e-3')).toEqual(q(1n, 1000n));
    expect(readExact('1d3')).toEqual(q(1000n));
    expect(readExact('-.5u')).toEqual(q(-1n, 2n * 10n ** 6n));
    expect(readExact('1µ')).toEqual(q(1n, 10n ** 6n));
    expect(readExact('1,5k')).toEqual(q(1n));
    for (const word of ['abc', '-', 'e5', '{1k*2}', "'2'", '', ',5']) expect(readExact(word), word).toBeUndefined();
  });

  it('every value word in the repository reads to within READ_ULPS units in the last place of the double ngspice computes (readNumber), and most to the nearest double', () => {
    let words = 0;
    let nearest = 0;
    for (const text of corpus()) {
      for (const line of parseNetlist(text).lines) {
        for (const f of line.element?.fields ?? []) {
          const r = readNumber(f.token.text);
          if (!r || !Number.isFinite(r.value) || Math.abs(r.value) < 2 ** -1022) continue;
          const x = readExact(f.token.text);
          // An exponent longer than 9 digits wraps in ngspice's C int (numbers.ts): not read exactly, on purpose.
          if (/[ed][+-]?\d{10,}/i.test(f.token.text)) {
            expect(x, f.token.text).toBeUndefined();
            continue;
          }
          expect(x, f.token.text).toBeDefined();
          const gap = Math.abs(toDouble(x!) - r.value);
          expect(gap, f.token.text).toBeLessThanOrEqual(READ_ULPS * ulp(r.value));
          words += 1;
          if (toDouble(x!) === r.value) nearest += 1;
        }
      }
    }
    expect(words).toBeGreaterThan(1800);
    expect(nearest / words).toBeGreaterThan(0.95);
  });

  it('a word no double can be is not read, and builds no power of ten: 1e-999999999 at once, where it took half a minute and then failed (the critic of the re-check\'s fixes)', () => {
    const quick = (word: string): Fraction | undefined => {
      const t0 = performance.now();
      const x = readExact(word);
      // Microseconds when right; 26 s, then a RangeError, when 10^999999999 is built.
      expect(performance.now() - t0, word.slice(0, 24)).toBeLessThan(50);
      return x;
    };
    expect(quick('1e-999999999')).toBeUndefined();
    expect(quick('1e-99999999')).toBeUndefined();
    expect(quick('1e+999999999')).toBeUndefined();
    expect(quick('1e-400')).toBeUndefined();
    expect(quick('1e400')).toBeUndefined();
    // Digits that are all 0 are 0, whatever the exponent: ngspice gives 0 too.
    expect(quick('0e-999999999')).toEqual(ZERO);
    expect(quick('-0.000e+999999999')).toEqual(ZERO);
    // The ends of the doubles are still read, and long words of digits are read in one go.
    expect(quick('1e308')).toEqual(q(10n ** 308n));
    expect(quick('2.5e-308')).toEqual(q(25n, 10n ** 309n));
    expect(quick(`0.${'0'.repeat(10_000)}1`)).toBeUndefined();
    expect(quick(`1.${'0'.repeat(150)}1`)).toBeUndefined();
    expect(quick(`1${'0'.repeat(200)}`)).toEqual(q(10n ** 200n));
    // An exponent written with leading zeros is the same exponent, as in ngspice's int.
    expect(quick('1e0000000003')).toEqual(q(1000n));
  });

  it('exactValue takes a word only when ngspice\'s double for it is that value to within READ_ULPS units in the last place', () => {
    expect(exactValue({ text: '0.3', value: 0.30000000000000004 })).toEqual(q(3n, 10n));
    expect(exactValue({ text: '1k', value: 1000 })).toEqual(q(1000n));
    // A double that is not this word's (a reading changed on purpose): not read exactly.
    expect(exactValue({ text: '1k', value: 1000.0000001 })).toBeUndefined();
    expect(exactValue({ text: '0.3', value: 0.3 + 8 * ulp(0.3) })).toBeUndefined();
    // ngspice's 0 for a word that is not 0 (1e-999999999 underflows): not this value; looked at before the word is read.
    expect(exactValue({ text: '1e-999999999', value: 0 })).toBeUndefined();
    expect(exactValue({ text: '0e-999999999', value: 0 })).toEqual(ZERO);
    expect(exactValue({ text: '1e-320', value: 1e-320 })).toBeUndefined();
  });

  it('the suffix corpus: every word native ngspice 47 reads as a current source\'s value is that value to within READ_ULPS', () => {
    const suffixes = JSON.parse(readFileSync(join(root, 'tests/corpus/numbers/suffixes.json'), 'utf8')) as Record<string, { string: string; SI_47?: { values: Record<string, number> } }>;
    let checked = 0;
    for (const { string, SI_47 } of Object.values(suffixes)) {
      const native = SI_47?.values['@i1[dc]'];
      if (native === undefined) continue;
      const x = readExact(string);
      expect(x, string).toBeDefined();
      expect(Math.abs(toDouble(x!) - native), string).toBeLessThanOrEqual(READ_ULPS * ulp(native));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(30);
  });
});

describe('exactModel: only the circuits whose operating point PlainSpice knows exactly', () => {
  const bridge = '* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\n';

  it('takes R, C, L, V, I, E, F, G and H with plain values, .options savecurrents and the analyses', () => {
    const m = model(`${bridge}C1 a 0 1u\nL1 a x 1m\nRx x 0 1k\nI1 0 b 1m\nE1 e 0 a b 2\nG1 0 g a b 1m\nRg g 0 1k\nVm top t 0\nRt t 0 1k\nF1 0 f Vm 2\nRf f 0 1k\nH1 h 0 E1 3\nRh h 0 1k\nV2 v 0 DC 1 AC 1\n.options savecurrents\n.op\n.tf v(a) V1\n.dc V1 0 9 1\n.end\n`);
    expect(typeof m).toBe('object');
  });

  it('takes a diode as a part whose current is left free (its model and settings change only that current), but not one with a thermal node', () => {
    const m = model(`${bridge}D1 a 0 dmod area=2 off\n.model dmod d(is=1e-14 rs=10)\n.op\n.end\n`) as ExactModel;
    expect(m.parts.find((p) => p.key === 'd1')).toMatchObject({ kind: 'D', a: m.nodes.indexOf('a'), b: -1, branch: -1, value: ZERO });
    expect(m.size).toBe(4);
    expect(model(`${bridge}D1 a 0 t dmod\n.model dmod d\n.op\n.end\n`)).toBe('part');
  });

  it('leaves to the other rule a subcircuit, a B source, POLY, a transient source, a part with settings, .param, .temp, other options, a 0 Ω resistor, an F reading a resistor', () => {
    const cases: [string, string][] = [
      ['X1 a 0 sub\n', 'part'],
      ['B1 a 0 V=1\n', 'part'],
      ['E1 a 0 POLY(1) a 0 0 1\n', 'part'],
      ['V2 a 0 SIN(0 1 1k)\n', 'part'],
      ['R9 a 0 1k tc1=0.01\n', 'part'],
      ['R9 a 0 {2*1k}\n', 'value'],
      ['.param r=1k\n', 'directive'],
      ['.temp 50\n', 'directive'],
      ['.options gmin=1e-9\n', 'directive'],
      ['R9 a 0 0\n', 'value'],
      ['F1 0 a R1 2\n', 'control'],
      ['.control\nop\n.endc\n', 'directive'],
    ];
    for (const [line, why] of cases) expect(model(`${bridge}${line}.op\n.end\n`), line).toBe(why);
    const ladder = Array.from({ length: MAX_UNKNOWNS }, (_, k) => `R${k} n${k} n${k + 1} 1k\nRg${k} n${k + 1} 0 1k`).join('\n');
    expect(model(`* t\nV1 n0 0 1\n${ladder}\n.op\n.end\n`)).toBe('size');
  });
});

describe('solveExact: the operating point with fractions', () => {
  it('the balanced bridge: a and b are both exactly 9/2 V, and R5 carries exactly 0 A (C9)', () => {
    const m = model('* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\n.op\n.end\n') as ExactModel;
    // The unknowns share one denominator, the determinant; in lowest terms they are these.
    const x = solve(m);
    const low = (f: Fraction): Fraction => fraction(f.n, f.d);
    expect(low(x[m.nodes.indexOf('a')]!)).toEqual(q(9n, 2n));
    expect(low(x[m.nodes.indexOf('b')]!)).toEqual(q(9n, 2n));
    expect(isZero(partCurrent(m, x, m.parts.findIndex((p) => p.key === 'r5')))).toBe(true);
    expect(low(partCurrent(m, x, m.parts.findIndex((p) => p.key === 'v1')))).toEqual(q(-1323n, 940000n));
  });

  it('P2: an F, a 0 V source and a current source in any order: v(a) = 14, v(n1) = 12, i(vx) = 1', () => {
    const m = model('* t\nF1 0 n1 Vx 2\nR1 n1 0 4\nR2 x n1 2\nVx a x 0\nItest 0 a 1\n.op\n.end\n') as ExactModel;
    const x = solve(m);
    const low = (f: Fraction): Fraction => fraction(f.n, f.d);
    expect([low(x[m.nodes.indexOf('a')]!), low(x[m.nodes.indexOf('n1')]!), low(partCurrent(m, x, m.parts.findIndex((p) => p.key === 'vx')))]).toEqual([q(14n), q(12n), q(1n)]);
  });

  it('a node with no DC path to ground has no single answer: no solution', () => {
    const m = model('* t\nV1 a 0 1\nR1 a 0 1k\nC1 a b 1u\nR2 b c 1k\n.op\n.end\n') as ExactModel;
    expect(solveExact(m, [operatingPoint(m)])).toBeUndefined();
  });
});

describe('agrees: ngspice simulated this same circuit, and its rounding explains every difference', () => {
  const text = '* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\n.op\n.end\n';
  /** C9's values, as native ngspice 47 and our engine give them. */
  const c9 = { nodes: { top: 9, a: 4.499999999999999, b: 4.5 }, branch: { v1: -0.0014074468085106386 }, device: { r1: 0.0004500000000000001, r2: 0.00044999999999999993, r3: 0.0009574468085106382, r4: 0.0009574468085106382, r5: -8.881784197001253e-19 } };
  const values = (v: typeof c9) => ({ voltage: (n: string) => (v.nodes as Record<string, number>)[n], branch: (k: string) => (v.branch as Record<string, number>)[k], device: (k: string) => (v.device as Record<string, number>)[k] });

  it('agrees with ngspice\'s own values: what is left is a few units in the last place', () => {
    const m = model(text) as ExactModel;
    expect(agrees(m, values(c9), (p) => p.value)).toBe(true);
    const s = shares(m, values(c9), (p) => p.value)!;
    expect(toDouble(s.equations)).toBeLessThan(2 ** -50);
  });

  it('does not agree with another circuit: one resistor 1 ppm off, or a current that is not its own numbers\' product', () => {
    const m = model(text.replace('R2 a 0 10k', 'R2 a 0 10.00001k')) as ExactModel;
    expect(agrees(m, values(c9), (p) => p.value)).toBe(false);
    expect(agrees(model(text) as ExactModel, values({ ...c9, device: { ...c9.device, r1: 0.00045000001 } }), (p) => p.value)).toBe(false);
    expect(agrees(model(text) as ExactModel, values({ ...c9, nodes: { top: 9, a: 4.4, b: 4.5 } }), (p) => p.value)).toBe(false);
  });

  it('roundingNoise uses the other rule when the values are not this circuit\'s (a missing node, an extra part)', () => {
    const n = parseNetlist(text);
    const op = (nodes: Record<string, number>, extra: [string, number][] = []): AnalysisResults => ({
      op: {
        nodes: Object.entries(nodes).map(([node, value]) => ({ node, value })),
        currents: [
          { element: 'v1', value: c9.branch.v1, origin: 'branch', vector: 'i(v1)' },
          ...Object.entries(c9.device).map(([element, value]) => ({ element, value, origin: 'device' as const, vector: `i(@${element}[i])` })),
          ...extra.map(([element, value]) => ({ element, value, origin: 'device' as const, vector: `i(@${element}[i])` })),
        ],
      },
      other: [],
    });
    expect(roundingNoise(n, op(c9.nodes)).by).toBe('exact');
    expect(roundingNoise(n, op({ top: 9, a: 4.499999999999999 })).by).toBe('rule');
    expect(roundingNoise(n, op(c9.nodes, [['r9', 1e-3]])).by).toBe('rule');
    expect(roundingNoise(n, op({ ...c9.nodes, z: 1 })).by).toBe('rule');
  });

  it('fromDouble and toDouble are exact both ways', () => {
    for (const v of [0, 1, -0.1, 4.499999999999999, 2 ** -1074, 1.7976931348623157e308, -8.881784197001253e-19]) expect(toDouble(fromDouble(v))).toBe(v);
  });
});

describe('answersAgree: ngspice\'s answers are the exact ones to the page\'s digits (the critic of the re-check\'s fixes)', () => {
  const text = '* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nV2 s 0 1n\nRs s 0 1k\n.op\n.end\n';
  const ng = (nodes: Record<string, number>, branch: Record<string, number>, device: Record<string, number> = {}) => ({ voltage: (n: string) => nodes[n], branch: (k: string) => branch[k], device: (k: string) => device[k] });
  const good = { top: 9, a: 4.499999999999999, b: 4.5, s: 1e-9 };
  const currents = { v1: -0.0014074468085106386, v2: -1e-12 };

  it('ngspice\'s own answers agree; a node voltage or a source\'s current 1e-4 off does not', () => {
    const m = model(text) as ExactModel;
    const x = solve(m);
    expect(answersGap(m, x, ng(good, currents))!).toBeLessThan(1e-15);
    expect(answersAgree(m, x, ng(good, currents))).toBe(true);
    expect(answersAgree(m, x, ng({ ...good, a: 4.5 * (1 + 1e-4) }, currents))).toBe(false);
    expect(answersAgree(m, x, ng(good, { ...currents, v1: currents.v1 * (1 + 1e-4) }))).toBe(false);
    // Just within ANSWER_GAP (5e-5 of the value) still agrees.
    expect(answersAgree(m, x, ng({ ...good, a: 4.5 * (1 + 0.9 * ANSWER_GAP) }, currents))).toBe(true);
  });

  it('a value tiny beside the others of its kind is held to what rounding leaves, 2^-30 of the largest (8.4 nV beside 9 V, 1.3 pA beside 1.4 mA), not skipped (the critic of round 2); a resistor\'s current, a product of the node voltages, is not compared', () => {
    const m = model(text) as ExactModel;
    const x = solve(m);
    expect(answersAgree(m, x, ng({ ...good, s: 2e-9 }, { ...currents, v2: -2e-12 }))).toBe(true);
    // 1 nV off by 9 nV, or 1 pA off by 2 pA: more than rounding leaves.
    expect(answersAgree(m, x, ng({ ...good, s: 1e-8 }, currents))).toBe(false);
    expect(answersAgree(m, x, ng(good, { ...currents, v2: -3e-12 }))).toBe(false);
    expect(ANSWER_FLOOR).toBe(2 ** -30);
    expect(answersAgree(m, x, ng(good, currents, { r1: 1 }))).toBe(true);
    // A value ngspice did not give for an answer it must give: no agreement.
    expect(answersGap(m, x, ng({ a: 4.5, b: 4.5, s: 1e-9 }, currents))).toBeUndefined();
  });
});

describe('whole numbers over one denominator, so that no common factor is searched for in thousands of bits', () => {
  it('overCommon gives the unknowns over the determinant, and currentDouble a part\'s current from them, as partCurrent does', () => {
    const m = model('* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nG1 0 g a top 1m\nRg g 0 1k\nR6 a z -2k\nR7 z 0 3k\n.op\n.end\n') as ExactModel;
    const x = solve(m);
    const { num, den } = overCommon(x);
    expect(den > 0n).toBe(true);
    m.nodes.forEach((_, k) => expect(fraction(num[k]!, den)).toEqual(fraction(x[k]!.n, x[k]!.d)));
    m.parts.forEach((p, k) => expect(currentDouble(m, num, den, k), p.key).toBe(toDouble(partCurrent(m, x, k))));
  });

  it('the solve stops at a counted amount of work, the same on every computer: a 12 × 12 grid of 7-digit values (about a second of work) is left to the other rule', () => {
    let seed = 3;
    const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const value = (): string => `${(1 + rnd() * 8.999999).toFixed(6)}${['', 'k', 'meg'][Math.floor(rnd() * 3)]}`;
    const grid = (side: number): string => {
      const l = ['V1 g0_0 0 10'];
      for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) {
        if (i + 1 < side) l.push(`Rv${i}_${j} g${i}_${j} g${i + 1}_${j} ${value()}`);
        if (j + 1 < side) l.push(`Rh${i}_${j} g${i}_${j} g${i}_${j + 1} ${value()}`);
      }
      return `* grid\n${l.join('\n')}\nRg g${side - 1}_${side - 1} 0 ${value()}\n.op\n.end\n`;
    };
    const big = model(grid(12)) as ExactModel;
    expect(solveExact(big, [operatingPoint(big)])).toBeUndefined();
    const small = model(grid(5)) as ExactModel;
    expect(solveExact(small, [operatingPoint(small)])).toBeDefined();
    // A random network of E12 resistors on 80 nodes: its numbers stay near 2,100 bits, below MAX_BITS, and
    // only the counted work stops it (its whole solve counts 13.7 million, against MAX_WORK's 8 million).
    const E12 = [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
    const e12 = (): string => `${E12[Math.floor(rnd() * 12)]}${['', 'k', 'k', 'meg'][Math.floor(rnd() * 4)]}`;
    const mesh = ['V1 n1 0 10'];
    for (let k = 2; k <= 80; k++) mesh.push(`Rt${k} n${k} n${1 + Math.floor(rnd() * (k - 1))} ${e12()}`);
    for (let r = 0; r < 160; r++) {
      const [a, b] = [1 + Math.floor(rnd() * 80), Math.floor(rnd() * 81)];
      if (a !== b) mesh.push(`Rx${r} n${a} ${b === 0 ? '0' : `n${b}`} ${e12()}`);
    }
    const network = model(`* mesh\n${mesh.join('\n')}\n.op\n.end\n`) as ExactModel;
    expect(solveExact(network, [operatingPoint(network)])).toBeUndefined();
  });
});
