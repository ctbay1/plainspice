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

describe('a sweep\'s point at the .op\'s own value of the swept source, bit for bit, at the very double of the decimal the netlist writes for it, or at the very double of the decimal its steps say (start + k·step), is that value, as the .op is judged at the netlist\'s decimals', () => {
  const sweepText = (r: Awaited<ReturnType<typeof solveText>>): string => sp(r.words.sweeps[0]!.text);
  const last = (r: Awaited<ReturnType<typeof solveText>>, name: string): number => {
    const s = shownSweep(r.netlist, r.results)!.series.find((x) => x.name === name)!.values;
    return s[s.length - 1]!;
  };

  it('vlost: ".dc V1 0 0.3 0.15" ends at the very double of the netlist\'s own 0.3, 0.29999999999999998890 (ngspice\'s .op reads it as 0.30000000000000004), where V2, idle at 300 mV, carries no current: ngspice\'s 0 there is shown as 0 A, never −3.701e-21 A (the circuit at that double) with "Solved exactly … none of them is 0" beside the .op\'s "no current"', async () => {
    const r = await solveText(netlist('V1 a 0 0.3', 'R1 a b 1k', 'R2 b 0 1k', 'V2 c 0 0.15', 'R3 b c 1k', '.op', '.dc V1 0 0.3 0.15'), ngspice);
    // ngspice's .op reads 0.3 as 0.30000000000000004; the sweep adds 0.15 twice and lands on 0.3's own double.
    expect([r.results.op!.nodes.find((n) => n.node === 'a')!.value, r.results.dc!.scale.values[2]]).toEqual([0.30000000000000004, 0.3]);
    expect([by(r), text(r.words, 'V2')]).toEqual(['exact', 'no current through V2']);
    expect(sweepText(r)).toContain('At V1 = 300 mV: v(a) = 300 mV, v(b) = 150 mV, v(c) = 150 mV, i(v2) = 0 A, i(v1) = −150 µA');
    expect([message(r.words, 'rounded-to-0'), last(r, 'i(v2)')]).toEqual([undefined, 0]);
  });

  it('mid: ".dc V1 0 0.6 0.15" passes 0.3\'s double in the middle of the sweep, neither the netlist\'s value of V1 (0.6) nor the .op\'s: it is the decimal its steps say, start + 2·step = 300 mV, where V2 carries no current, and ngspice\'s 0 there is shown as 0 A, never −3.701e-21 A (the circuit at that double) with "Solved exactly … none of them is 0"', async () => {
    const r = await solveText(netlist('V1 a 0 0.6', 'R1 a b 1k', 'R2 b 0 1k', 'V2 c 0 0.15', 'R3 b c 1k', '.op', '.dc V1 0 0.6 0.15'), ngspice);
    expect([by(r), r.results.dc!.scale.values[2], r.results.op!.nodes.find((n) => n.node === 'a')!.value]).toEqual(['exact', 0.3, 0.6000000000000001]);
    const shown = shownSweep(r.netlist, r.results)!;
    for (const name of ['i(v2)', 'i(@r3[i])']) expect([r.results.dc!.series.find((s) => s.name === name)!.values[2], shown.series.find((s) => s.name === name)!.values[2]], name).toEqual([0, 0]);
    expect(message(r.words, 'rounded-to-0')).toBeUndefined();
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

describe('by the rule, a point\'s own numbers show the .op\'s 0s only at the .op\'s value: a point a few steps of a double from it keeps ngspice\'s numbers, but where ngspice gives it the very number the .op\'s 0 stands for', () => {
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

  it('a balanced bridge with a .param line keeps the .op\'s 0 at ngspice\'s point nearest the .op\'s value, where ngspice gives it the .op\'s very number (C9x.4): R5 of ".dc V1 0 10 0.1" at 9.99999999999998 V, the ammeter of ".dc V1 0 5 0.1" at 4.999999999999998 V, and that point of a sweep of two sources are each shown 0 with the note, never ngspice\'s −1.776 aA beside the .op\'s "R5: rounding noise, 0 A", nor the point named "9.99999999999998 V, not 10 V" (R5\'s current is 0 at every V1)', async () => {
    const bridge = ['.param R=1k', 'V1 in 0 10', 'R1 in a {R}', 'R2 a 0 2k', 'R3 in b 1k', 'R4 b 0 2k'];
    const noiseNotes = (r: Awaited<ReturnType<typeof solveText>>): string => r.words.warnings.filter((m) => m.code === 'rounding-noise').map((m) => sp(m.why)).join(' ');
    const at = (r: Awaited<ReturnType<typeof solveText>>, name: string, k: number): [number, number] => [r.results.dc!.series.find((s) => s.name === name)!.values[k]!, shownSweep(r.netlist, r.results)!.series.find((s) => s.name === name)!.values[k]!];
    const one = await solveText(netlist(...bridge, 'R5 a b 500', '.op', '.dc V1 0 10 0.1'), ngspice);
    const r5 = one.results.op!.currents.find((c) => c.element === 'r5')!.value;
    expect([by(one), text(one.words, 'R5'), one.results.dc!.scale.values[100], r5, at(one, 'i(@r5[i])', 100)]).toEqual(['rule', 'no current through R5', 9.99999999999998, -1.7763568394002505e-18, [r5, 0]]);
    expect(sp(one.words.sweeps[0]!.text)).toContain('At V1 = 10 V: v(in) = 10 V, v(a) = 6.667 V, v(b) = 6.667 V, i(v1) = −6.667 mA, i(@r1[i]) = 3.333 mA, i(@r2[i]) = 3.333 mA, i(@r3[i]) = 3.333 mA, i(@r4[i]) = 3.333 mA, i(@r5[i]) = 0 A.');
    expect(message(one.words, 'sweep-point')).toBeUndefined();
    expect(noiseNotes(one)).toContain("At ngspice's point nearest the operating point's 10 V, 9.99999999999998 V (its 100 mV step added up in doubles), ngspice gives it the very number the operating point shows as 0, as the operating point's note says.");
    const meter = await solveText(netlist('.param R=1k', 'V1 in 0 5', 'R1 in a {R}', 'R2 a 0 2k', 'R3 in b 1k', 'R4 b 0 2k', 'R5 a m 500', 'Vm m b 0', '.op', '.dc V1 0 5 0.1'), ngspice);
    expect([by(meter), text(meter.words, 'Vm'), meter.results.dc!.scale.values[50], at(meter, 'i(vm)', 50)[1], at(meter, 'i(@r5[i])', 50)[1]]).toEqual(['rule', 'Vm measures no current', 4.999999999999998, 0, 0]);
    expect(at(meter, 'i(vm)', 50)[0]).toBe(meter.results.op!.currents.find((c) => c.element === 'vm')!.value);
    expect(sp(meter.words.sweeps[0]!.text)).toContain('At V1 = 5 V: v(in) = 5 V, v(a) = 3.333 V, v(b) = 3.333 V, v(m) = 3.333 V, i(vm) = 0 A,');
    expect(message(meter.words, 'sweep-point')).toBeUndefined();
    const two = await solveText(netlist(...bridge, 'R5 a b 500', 'I2 0 c 1m', 'Rc c 0 1k', '.options savecurrents', '.op', '.dc V1 0 10 0.1 I2 0 1m 1m'), ngspice);
    expect([by(two), two.results.dc!.scale.values[201], at(two, 'i(@r5[i])', 201)]).toEqual(['rule', 9.99999999999998, [-1.7763568394002505e-18, 0]]);
    expect(sp(two.words.sweeps[0]!.text)).toContain('At the last point: v(in) = 10 V, v(a) = 6.667 V, v(b) = 6.667 V, v(c) = 1 V, i(v1) = −6.667 mA, i(@r1[i]) = 3.333 mA, i(@r2[i]) = 3.333 mA, i(@r3[i]) = 3.333 mA, i(@r4[i]) = 3.333 mA, i(@r5[i]) = 0 A,');
    expect(noiseNotes(two)).toContain('ngspice gives it the very number the operating point shows as 0');
  });
});

describe('by the rule, a point at the very double of the decimal the netlist writes for the swept source is the .op\'s value too, as the .op is judged at that decimal', () => {
  it('dr-34: ngspice reads "4.5m" as 0.0045000000000000005 for the .op, and ".dc I1 0 0.0045 0.3m" ends at 0.0045\'s own double: that point is the .op\'s 4.5 mA, where ngspice\'s −6.939 aA for V2 (its .op gives exactly 0) is rounding noise of a 0 by the rule, shown 0 with a note that says the .op shows it as 0; it was named "I1 = 4.5 mA, not 4.5 mA", as if the point had drifted', async () => {
    const r = await solveText(netlist('.param rp=10k', 'I1 0 a 4.5m', 'R1 a 0 {rp}', 'V2 b 0 45', 'R2 a b 1k', '.options savecurrents', '.op', '.dc I1 0 0.0045 0.3m'), ngspice);
    const dc = r.results.dc!;
    expect([by(r), dc.scale.values[15], r.results.op!.currents.find((c) => c.element === 'i1')!.value]).toEqual(['rule', 0.0045, 0.0045000000000000005]);
    expect(message(r.words, 'sweep-point')).toBeUndefined();
    expect(sp(r.words.sweeps[0]!.text)).toContain('At I1 = 4.5 mA: v(a) = 45 V, v(b) = 45 V, i(v2) = 0 A,');
    expect(r.words.warnings.filter((m) => m.code === 'rounding-noise').map((m) => sp(m.why)).join(' ')).toContain('At I1 = 4.5 mA, the operating point\'s own state, ngspice\'s own numbers there show that each of them is rounding noise of a 0, and the operating point shows them as 0.');
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

describe('a .tf of nodes or a part inside a subcircuit, beside the rule\'s .op, gets the note that it may be rounding noise where the .op shows its output as 0 (cross-2, regress-2)', () => {
  const tfNote = (r: Awaited<ReturnType<typeof solveText>>): string | undefined => sp(r.words.warnings.find((m) => m.title === 'The transfer function may be rounding noise')?.why) || undefined;
  it('the balanced bridge inside a subcircuit, .tf v(x1.p,x1.q): ngspice\'s 1.11e-16 V/V stays, with the note "node x1.p and node x1.q are at the same voltage", as the same bridge in the main circuit beside an X line gets (it had nothing said)', async () => {
    const r = await solveText(netlist('V1 in 0 0.3', 'X1 in bridge', '.subckt bridge a', 'R1 a p 0.3', 'R2 p 0 0.7', 'R3 a q 0.3', 'R4 q 0 0.7', 'R5 p q 1k', '.ends', '.tf v(x1.p,x1.q) V1', '.op'), ngspice);
    expect([by(r), sp(r.words.tf!.transferFunction!.text), r.words.tf!.transferFunction!.maybe]).toEqual(['rule', 'v(x1.p,x1.q)/V1 = 1.11e-16 (V/V)', 'zero']);
    expect(tfNote(r)).toBe("ngspice gave v(x1.p,x1.q)/V1 = 1.110223e-16. In the operating point node x1.p and node x1.q are at the same voltage, and this ratio is less than a billionth of a volt for each volt of V1, so it may be rounding noise, what ngspice's arithmetic leaves of a ratio that is exactly 0, or a real ratio that small. PlainSpice cannot tell which from ngspice's numbers alone, so it shows it as ngspice gives it.");
    const top = await solveText(netlist('V1 in 0 0.3', 'R1 in p 0.3', 'R2 p 0 0.7', 'R3 in q 0.3', 'R4 q 0 0.7', 'R5 p q 1k', 'X9 in 0 dummy', '.subckt dummy a b', 'R9 a b 1k', '.ends', '.tf v(p,q) V1', '.op'), ngspice);
    expect(tfNote(top)).toContain('In the operating point node p and node q are at the same voltage');
  });

  it('regress-2\'s bridge with its ammeter inside a subcircuit, .tf v(x1.a,x1.b): −5.551e-17 V/V with the note; a node shown real inside it, v(x1.a), gets none (0.5 V/V)', async () => {
    const sub = ['V1 top 0 9', 'X1 top 0 br', '.subckt br t g', 'R1 t a 10k', 'R2 a g 10k', 'R3 t b 4.7k', 'R4 b g 4.7k', 'R5 a m 1k', 'Vm m b 0', '.ends', '.options savecurrents', '.op'];
    const r = await solveText(netlist(...sub, '.tf v(x1.a,x1.b) V1'), ngspice);
    expect([sp(r.words.tf!.transferFunction!.text), r.words.tf!.transferFunction!.maybe]).toEqual(['v(x1.a,x1.b)/V1 = −5.551e-17 (V/V)', 'zero']);
    expect(tfNote(r)).toContain('In the operating point node x1.a and node x1.b are at the same voltage');
    const one = await solveText(netlist(...sub, '.tf v(x1.a) V1'), ngspice);
    expect([sp(one.words.tf!.transferFunction!.text), one.words.tf!.transferFunction!.maybe, tfNote(one)]).toEqual(['v(x1.a)/V1 = 0.5 (V/V)', undefined, undefined]);
  });

  it('m322: the .tf of an ammeter inside a subcircuit, i(v.x1.vs), says "v.x1.vs measures no current", never "i(v.x1.vs) is at 0 V, ground\'s voltage", the words for a node; the same ammeter in the main circuit reads as before', async () => {
    const r = await solveText(netlist('V1 in 0 12', 'X1 in bridge', '.subckt bridge t', 'R1 t p 1.5', 'R2 p 0 3.3', 'R3 t q 1.5', 'R4 q 0 3.3', 'R5 p m 1', 'Vs m q 0', '.ends', '.tf i(v.x1.vs) V1', '.op'), ngspice);
    expect(tfNote(r)).toContain('In the operating point v.x1.vs measures no current, and this ratio is less than a billionth of the current through V1 for each of its volts (416.7 mA)');
    expect(tfNote(r)).not.toContain("ground's voltage");
    const top = await solveText(netlist('V1 in 0 12', 'R1 in p 1.5', 'R2 p 0 3.3', 'R3 in q 1.5', 'R4 q 0 3.3', 'R5 p m 1', 'Vs m q 0', 'X9 in 0 dummy', '.subckt dummy a b', 'R9 a b 1k', '.ends', '.tf i(Vs) V1', '.op'), ngspice);
    expect(tfNote(top)).toContain('In the operating point Vs measures no current');
  });
});
