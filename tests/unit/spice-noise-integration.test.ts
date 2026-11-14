/**
 * The rounding-noise rule after the integration check of the merged last-pass lanes (14 November 2026; decision 0015,
 * "After the integration check"; C9z in docs/spice-facts/explanations.md), run on the real engine as the page runs a
 * netlist (solveText).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { solveText } from '../../src/app/model.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { roundingNoise, shownSweep, type ResultsInWords } from '../../src/spice/describe.ts';

const root = resolve(import.meta.dirname, '../..');
let ngspice: NgspiceEngine;
beforeAll(async () => {
  ngspice = await NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(root, 'engine/dist/ngspice.wasm')));
});

const netlist = (...l: string[]): string => `* t\n${l.join('\n')}\n.end\n`;
const sp = (s: string | undefined): string => (s ?? '').replace(/[   ]/g, ' ');
const by = (r: Awaited<ReturnType<typeof solveText>>): string => roundingNoise(r.netlist, r.results).by;
const text = (w: ResultsInWords, name: string): string => sp(w.currents.find((c) => c.name === name)?.text);
const message = (w: ResultsInWords, code: string): string | undefined => {
  const m = w.warnings.find((x) => x.code === code);
  return m && `${sp(m.title)}: ${sp(m.why)}`;
};

describe('by the rule, a wire\'s current that ngspice gives as exactly 0 stays ngspice\'s 0: Kirchhoff\'s law gives nothing back (the fill of the last pass made currents up)', () => {
  it('a divider with a .param line, a 1 nΩ wire and a 10 MΩ load (c4-58): Rw keeps ngspice\'s 0, never "1.431 nA from node p to node n1", where the circuit makes 198 nA from n1 to p; without the .param line the exact solution warns that ngspice\'s 0 is off', async () => {
    const lines = ['V1 n0 0 3.3', 'R1 n0 n1 2.2k', 'Rw n1 p 1n', 'Rload p 0 10meg', '.options savecurrents', '.op'];
    const r = await solveText(netlist('.param rb=3.3k', 'R2 n1 0 {rb}', ...lines), ngspice);
    expect([by(r), text(r.words, 'Rw'), text(r.words, 'Rload')]).toEqual(['rule', 'no current through Rw', '198 nA from node p to ground through Rload']);
    expect(r.words.currents.find((c) => c.name === 'Rw')?.given).toBeUndefined();
    expect(message(r.words, 'rounded-to-0')).toBeUndefined();
    const plain = await solveText(netlist('R2 n1 0 3.3k', ...lines), ngspice);
    expect(message(plain.words, 'imprecise-answers')).toContain('Rw carries 198 nA, where ngspice gives 0 A');
  });

  it('r9731-503: a 1e-12 Ω wire beside an isolated transistor keeps ngspice\'s 0, never "461.5 µA from node a2 to node m4" (the circuit makes 261 fA there)', async () => {
    const r = await solveText(netlist('V1 top1 0 15', 'R1 top1 a2 68k', 'R2 a2 0 470k', 'R3 top1 b3 272k', 'R4 b3 0 1.88meg', 'R5 a2 m4 1e-12', 'R6 m4 b3 1k', 'R7 a2 s5 1e13', 'R8 s5 0 1u', 'Qx qc qb 0 qmod', 'Rqb qb 0 1meg', 'Rqc qc 0 1meg', '.model qmod npn', '.options savecurrents', '.op', '.tf v(a2) V1'), ngspice);
    expect([by(r), text(r.words, 'R5'), message(r.words, 'rounded-to-0')]).toEqual(['rule', 'no current through R5', undefined]);
  });

  it('4,500 wires of 1 µΩ in series into a 0 V ammeter and a 1 TΩ meter: each wire keeps the number ngspice gives it and describing the run does not overflow the stack (the fill recursed once a wire: "Maximum call stack size exceeded" from about 4,000 wires); 149 such wires are not drawn "1.735 pA" the wrong way', async () => {
    const chain = (n: number): string => netlist('V1 a 0 1.5', 'Ra a 1 1.5k', 'Rb 1 0 12', ...Array.from({ length: n }, (_, k) => `R${k + 1} ${k + 1} ${k + 2} 1u`), `Vm ${n + 1} q 0`, 'Rvm q 0 1t', '.options savecurrents', '.op');
    const long = await solveText(chain(4500), ngspice);
    expect([long.status, long.words.currents.length]).toEqual(['ok', 4505]);
    // ngspice's own numbers stay: it gives R2's two ends one step of a double apart, 1.735 pA through 1 µΩ, as at c520a49.
    expect([long.words.currents.filter((c) => c.given !== undefined).map((c) => c.name), text(long.words, 'R1'), text(long.words, 'R4500'), message(long.words, 'rounded-to-0')]).toEqual([[], 'no current through R1', 'no current through R4500', undefined]);
    const short = await solveText(chain(149), ngspice);
    expect([text(short.words, 'R1'), text(short.words, 'R149'), message(short.words, 'rounded-to-0')]).toEqual(['no current through R1', 'no current through R149', undefined]);
  }, 120_000);
});

describe('a sweep\'s point at the .op\'s own value of the swept source, bit for bit, or at the very double of the decimal its steps say, is that value, as the .op is judged at the netlist\'s decimals', () => {
  const sweepText = (r: Awaited<ReturnType<typeof solveText>>): string => sp(r.words.sweeps[0]!.text);
  const last = (r: Awaited<ReturnType<typeof solveText>>, name: string): number => {
    const s = shownSweep(r.netlist, r.results)!.series.find((x) => x.name === name)!.values;
    return s[s.length - 1]!;
  };

  it('vlost: ".dc V1 0 0.3 0.15" ends at 0.3\'s double, 0.29999999999999998890, where V2, idle at 300 mV, carries no current: ngspice\'s 0 there is shown as 0 A, never −3.701e-21 A (the circuit at that double) with "Solved exactly … none of them is 0" beside the .op\'s "no current"', async () => {
    const r = await solveText(netlist('V1 a 0 0.3', 'R1 a b 1k', 'R2 b 0 1k', 'V2 c 0 0.15', 'R3 b c 1k', '.op', '.dc V1 0 0.3 0.15'), ngspice);
    // ngspice's .op reads 0.3 as 0.30000000000000004; the sweep adds 0.15 twice and lands on 0.3's own double.
    expect([r.results.op!.nodes.find((n) => n.node === 'a')!.value, r.results.dc!.scale.values[2]]).toEqual([0.30000000000000004, 0.3]);
    expect([by(r), text(r.words, 'V2')]).toEqual(['exact', 'no current through V2']);
    expect(sweepText(r)).toContain('At V1 = 300 mV: v(a) = 300 mV, v(b) = 150 mV, v(c) = 150 mV, i(v2) = 0 A, i(v1) = −150 µA');
    expect([message(r.words, 'rounded-to-0'), last(r, 'i(v2)')]).toEqual([undefined, 0]);
  });

  it('is3: ".dc I1 0 1m 0.5m" ends at the .op\'s own 1 mA, where V2 carries no current: "At I1 = 1 mA: … i(v2) = 0 A", never 1.041e-20 A', async () => {
    const r = await solveText(netlist('I1 0 a 1m', 'R1 a 0 1k', 'V2 b 0 1', 'R2 a b 1k', '.op', '.dc I1 0 1m 0.5m'), ngspice);
    expect(sweepText(r)).toContain('At I1 = 1 mA: v(a) = 1 V, v(b) = 1 V, i(v2) = 0 A,');
    expect([message(r.words, 'rounded-to-0'), last(r, 'i(v2)')]).toEqual([undefined, 0]);
  });

  it('dr-81: ".dc V1 0 1.2 0.6" ends at ngspice\'s own 1.2 V of the .op, 1.2000000000000002, where ngspice gives V2 the very 1.084e-19 A the .op shows as rounding noise: the sweep shows 0 there too, with the noise note at "V1 = 1.2 V", never "1.2000000000000002 V, not 1.2 V" with 42.29 zA drawn beside the .op\'s 0', async () => {
    const r = await solveText(netlist('V1 a 0 1.2', 'R1 a b 2.2k', 'R2 b 0 2.2k', 'V2 c 0 0.6', 'R3 b c 1k', '.options savecurrents', '.op', '.dc V1 0 1.2 0.6'), ngspice);
    expect(r.results.dc!.scale.values[2]).toBe(1.2000000000000002);
    expect(r.results.dc!.series.find((s) => s.name === 'i(v2)')!.values[2]).toBe(r.results.op!.currents.find((c) => c.element === 'v2')!.value);
    expect([text(r.words, 'V2'), last(r, 'i(v2)'), message(r.words, 'sweep-point'), message(r.words, 'exact-digits')]).toEqual(['no current through V2', 0, undefined, undefined]);
    expect(message(r.words, 'rounding-noise')).toBeDefined();
    expect(sweepText(r)).toContain('At V1 = 1.2 V: v(a) = 1.2 V, v(b) = 600 mV, v(c) = 600 mV, i(v2) = 0 A,');
    expect(r.words.warnings.filter((m) => m.code === 'rounding-noise').map((m) => sp(m.why)).join(' ')).toContain('ngspice gave i(v2) 1.084202e-19 A at V1 = 1.2 V and i(@r3[i]) 1.110223e-19 A at V1 = 1.2 V. Those are rounding noise');
  });

  it('dr-380: ".dc I1 0 0.0045 0.03m" ends at ngspice\'s own 4.5m of the .op, 0.0045000000000000005: the point is the .op\'s 4.5 mA, with V2\'s 0, and no note names it otherwise (it read "I1 = 4.5 mA, not 4.5 mA", with i(v2) 4.047e-19 A)', async () => {
    const r = await solveText(netlist('I1 0 a 4.5m', 'R1 a 0 3.3k', 'V2 b 0 14.85', 'R2 a b 1k', '.options savecurrents', '.op', '.dc I1 0 0.0045 0.03m'), ngspice);
    expect(r.results.dc!.scale.values[150]).toBe(0.0045000000000000005);
    expect(sweepText(r)).toContain('At I1 = 4.5 mA: v(a) = 14.85 V, v(b) = 14.85 V, i(v2) = 0 A,');
    expect([message(r.words, 'sweep-point'), message(r.words, 'rounded-to-0'), last(r, 'i(v2)')]).toEqual([undefined, undefined, 0]);
  });

  it('a point that drifted from both is still named by ngspice\'s own value, now with that value\'s own digits: ".dc I1 0 1.2m 0.1m" ends at 0.0012000000000000003, past the .op\'s 0.0012000000000000001, and reads "I1 = 1.2000000000000003 mA", never "1.2000000000000004 mA" (formatSI\'s division by the prefix changed the last digit)', async () => {
    const r = await solveText(netlist('I1 0 a 1.2m', 'R1 a 0 1k', 'V2 b 0 1.2', 'R2 a b 1k', '.options savecurrents', '.op', '.dc I1 0 1.2m 0.1m'), ngspice);
    expect(r.results.dc!.scale.values[12]).toBe(0.0012000000000000003);
    expect(sweepText(r)).toContain('At I1 = 1.2000000000000003 mA: v(a) = 1.2 V, v(b) = 1.2 V, i(v2) = 1.643e-19 A,');
    expect(sp(r.words.sweeps[0]!.speech)).toContain('When I1 is 1.2000000000000003 milliamps: ');
    expect(message(r.words, 'sweep-point')).toBe(
      "The DC sweep's last point is I1 = 1.2000000000000003 mA, not 1.2 mA: ngspice adds the step, 100 µA, to I1 once a point, in doubles (about 16 significant digits), so its points drift from the values the steps say: its last point is 1.2000000000000003 mA, 3.286e-19 A past 1.2 mA. There the circuit makes i(v2) 1.643e-19 A, where at 1.2 mA it makes 0 A. So PlainSpice names that point by ngspice's own value.",
    );
  });
});

describe('by the rule, only a point at the .op\'s value bit for bit shows the .op\'s 0s: a point a few steps of a double from it keeps ngspice\'s numbers', () => {
  it('dr29: ".dc V1 -8.15 4.95 0.05" passes 4.499999999999973 V, where the circuit makes −2.436 aA through V2 and R3; ngspice\'s −1.735 aA and −1.89 aA stay there, with no note calling them "rounding noise of a 0"', async () => {
    const r = await solveText(netlist('.param rp=10k', 'V1 a 0 4.5', 'R1 a b {rp}', 'R2 b 0 10k', 'V2 c 0 2.25', 'R3 b c 470', '.options savecurrents', '.op', '.dc V1 -8.15 4.95 0.05'), ngspice);
    const k = r.results.dc!.scale.values.indexOf(4.499999999999973);
    expect([by(r), text(r.words, 'V2'), k]).toEqual(['rule', 'no current through V2', 253]);
    const shown = shownSweep(r.netlist, r.results)!;
    for (const name of ['i(v2)', 'i(@r3[i])']) expect(shown.series.find((s) => s.name === name)!.values[k], name).toBe(r.results.dc!.series.find((s) => s.name === name)!.values[k]);
    expect(r.words.warnings.map((m) => sp(m.why)).join(' ')).not.toContain('rounding noise of a 0');
    expect(r.words.warnings.filter((m) => m.code === 'rounding-noise').map((m) => sp(m.why)).join(' ')).not.toContain('DC sweep');
  });

  it('the point at the .op\'s value bit for bit still shows its 0s: ".dc V1 0 9 3" of the .param bridge reaches 9 V exactly, where ngspice gives R5 the very −8.882e-19 A the .op shows as 0', async () => {
    const r = await solveText(netlist('.param rtop=10k', 'V1 top 0 9', 'R1 top a {rtop}', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', '.options savecurrents', '.op', '.dc V1 0 9 3'), ngspice);
    expect(sp(r.words.sweeps[0]!.text)).toContain('At V1 = 9 V: v(top) = 9 V, v(a) = 4.5 V, v(b) = 4.5 V, i(v1) = −1.407 mA, i(@r1[i]) = 450 µA, i(@r2[i]) = 450 µA, i(@r3[i]) = 957.4 µA, i(@r4[i]) = 957.4 µA, i(@r5[i]) = 0 A.');
    expect(r.words.warnings.filter((m) => m.code === 'rounding-noise').map((m) => sp(m.why)).join(' ')).toContain('At V1 = 9 V, the operating point\'s own state, ngspice gives it the very number the operating point shows as 0');
  });
});

describe('a swept source whose value the netlist does not write as a number has no point at the .op\'s state: never the sweep\'s 0 V or 0 A point (P4)', () => {
  const twoBridges = (swept: string[], dc: string): string => netlist(...swept, 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', 'V2 top2 0 9', 'R6 top2 c 10k', 'R7 c 0 10k', 'R8 top2 d 4.7k', 'R9 d 0 4.7k', 'R10 c d 1k', '.op', dc);
  it('V1 set by a .param, by a SIN with no DC value, I1 set by a .param, and V2 of a two-source sweep set by a .param: no note says "the operating point\'s own state", and R10 keeps ngspice\'s −8.882e-19 A at every point (it was zeroed at V1 = 0 V, while the .op is at 9 V)', async () => {
    const runs = [
      twoBridges(['.param Vs=9', 'V1 top 0 {Vs}'], '.dc V1 0 9 3'),
      twoBridges(['V1 top 0 SIN(9 1 1k)'], '.dc V1 0 9 3'),
      twoBridges(['.param Is=1m', 'I1 0 top {Is}', 'R0 top 0 9k'], '.dc I1 0 1m 0.5m'),
      netlist('.param V2v=5', 'V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', 'V2 x 0 {V2v}', 'R6 x 0 1k', '.op', '.dc V1 0 9 3 V2 0 5 5'),
    ];
    for (const source of runs) {
      const r = await solveText(source, ngspice);
      expect(r.words.warnings.map((m) => sp(m.why)).join(' '), source).not.toContain("the operating point's own state");
      const r10 = r.results.dc!.series.find((s) => s.name === 'i(@r10[i])');
      if (r10) expect(Array.from(shownSweep(r.netlist, r.results)!.series.find((s) => s.name === 'i(@r10[i])')!.values), source).toEqual(Array.from(r10.values));
    }
  });

  it('regress-1\'s ammeter bridge with its supply set by a .param: the sweep\'s 9 V point keeps ngspice\'s −2.168e-19 A for Vm, as at c520a49, beside the .op\'s "Vm measures no current" (open: the rule does not read the .op\'s own value of such a source)', async () => {
    const r = await solveText(netlist('.param Vs=9', 'V1 top 0 {Vs}', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a m 1k', 'Vm m b 0', '.op', '.dc V1 0 9 3'), ngspice);
    expect([by(r), text(r.words, 'Vm')]).toEqual(['rule', 'Vm measures no current']);
    expect(sp(r.words.sweeps[0]!.text)).toContain('At V1 = 9 V: v(top) = 9 V, v(a) = 4.5 V, v(b) = 4.5 V, v(m) = 4.5 V, i(vm) = −2.168e-19 A,');
  });
});
