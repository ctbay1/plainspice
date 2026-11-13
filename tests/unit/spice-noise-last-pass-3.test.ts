/**
 * The rounding-noise rule after the critic of round 2 of the last pass's fixes (13 November 2026; decision 0015, "After
 * the last pass"; C9w.3 and C9y in docs/spice-facts/explanations.md), run on the real engine as the page runs a netlist
 * (solveText).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { solveText } from '../../src/app/model.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { formatSI } from '../../src/format/si.ts';
import { describeResults, roundingNoise, shownSweep } from '../../src/spice/describe.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { leastWorkMs } from './work-time.ts';

const root = resolve(import.meta.dirname, '../..');
let ngspice: NgspiceEngine;
beforeAll(async () => {
  ngspice = await NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(root, 'engine/dist/ngspice.wasm')));
});

const netlist = (...l: string[]): string => `* t\n${l.join('\n')}\n.end\n`;

describe('the rule\'s proof that a node is real grows with the circuit, not with its square (N3)', () => {
  it('dividers from one source, every middle node at one double: four times the dividers take about four times the work (7,600 of them took 1.2 s, each proven resistor walking every node at that double)', async () => {
    const dividers = (n: number): string => netlist('V1 in 0 10', ...Array.from({ length: n }, (_, k) => `Ra${k + 1} in n${k + 1} 1k\nRb${k + 1} n${k + 1} 0 1k`), '.op');
    const [small, large] = [dividers(1500), dividers(6000)];
    const runs = await Promise.all([small, large].map((text) => solveText(text, ngspice)));
    // Past MAX_PARTS: the rule decides, and every middle node is at 5 V, one double.
    for (const r of runs) expect(r.words.nodes.find((n) => n.node === 'n1')?.text.replace(/\u00a0/g, ' ')).toBe('5 V');
    const copies = runs.map((r) => [0, 1, 2].map(() => structuredClone(r.results)));
    const [a, b] = leastWorkMs([() => describeResults(parseNetlist(small), copies[0]!.pop()!, runs[0]!.run), () => describeResults(parseNetlist(large), copies[1]!.pop()!, runs[1]!.run)], 3);
    expect(b / a).toBeLessThan(7);
  }, 180_000);
});

const sp = (s: string | undefined): string => (s ?? '').replace(/[   ]/g, ' ');
const text = (w: Awaited<ReturnType<typeof solveText>>['words'], name: string): string => sp(w.currents.find((c) => c.name === name)?.text);
const message = (w: Awaited<ReturnType<typeof solveText>>['words'], code: string): string | undefined => {
  const m = w.warnings.find((x) => x.code === code);
  return m && `${sp(m.title)}: ${sp(m.why)}`;
};
const ladder = ['V1 n0 0 1.5', 'R1 n0 n1 1.5k', 'R2 n1 0 12', 'R3 n1 n2 1.5k', 'R4 n2 0 12', 'R5 n2 n3 1.5k', 'R6 n3 0 12', 'R7 n3 n4 1.5k', 'R8 n4 0 12'];

describe('by the rule, a real current ngspice gives as exactly 0 is given back by Kirchhoff\'s law (N6: C9w.3\'s wire drawn "no current" beside its proven series current)', () => {
  it('C9w.3: the 1 µΩ wire Rw, its two ends one double, carries what Vm, the only other part at node p, carries: 7.324e-19 A, with the note that says why; it was drawn "no current through Rw"', async () => {
    const r = await solveText(netlist(...ladder, 'Rw n3 p 1u', 'Vm p q 0', 'Rvm q 0 1t', '.options gmin=1e-12', '.options savecurrents', '.op'), ngspice);
    const rw = r.words.currents.find((c) => c.name === 'Rw')!;
    expect([text(r.words, 'Rw'), rw.given, text(r.words, 'Vm')]).toEqual(['7.324e-19 A from node n3 to node p through Rw', 0, 'Vm measures 7.324e-19 A flowing from node p to node q']);
    expect(rw.across! / (rw.value * 1e-6)).toBeCloseTo(1, 12);
    expect(message(r.words, 'rounded-to-0')).toBe(
      "Rw's current is not 0, though ngspice gave 0: ngspice gave Rw exactly 0 A. But Vm, the only other part at node p, carries 7.324e-19 A, and the currents at a node add up to 0, so Rw carries 7.324e-19 A too. Rw's two ends, node n3 and node p, come out as the same number: the 7.324e-25 V across it is too small beside the 732.4 nV there for ngspice's arithmetic (about 16 significant digits). So PlainSpice shows it as Kirchhoff's law gives it: Rw 7.324e-19 A.",
    );
    expect(message(r.words, 'maybe-noise')).toBeUndefined();
  });

  it('two such wires in a row are each given back, node by node; where the other current at the node is rounding noise of a 0, nothing is (the bridge\'s ammeter: R5 and Vm both no current)', async () => {
    const chain = await solveText(netlist(...ladder, 'Rw1 n3 p1 1u', 'Rw2 p1 p 1u', 'Vm p q 0', 'Rvm q 0 1t', '.options gmin=1e-12', '.options savecurrents', '.op'), ngspice);
    expect([text(chain.words, 'Rw1'), text(chain.words, 'Rw2')]).toEqual(['7.324e-19 A from node n3 to node p1 through Rw1', '7.324e-19 A from node p1 to node p through Rw2']);
    const bridge = await solveText(netlist('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a m 1k', 'Vm m b 0', '.options gmin=1e-12', '.options savecurrents', '.op'), ngspice);
    expect([text(bridge.words, 'R5'), text(bridge.words, 'Vm'), message(bridge.words, 'rounded-to-0')]).toEqual(['no current through R5', 'Vm measures no current', undefined]);
  });
});

describe('a controlled source\'s gain widens the same-circuit check only for the part of the circuit it drives (N4: S28\'s false warning beside an op-amp of 1e6)', () => {
  it('S28\'s "+ 3" after .end beside an op-amp buffer of gain 1e6, or three of 1e5, in parts of the circuit nothing joins to n1: the note that ngspice\'s numbers could not be checked, never "node n1 is at 2 V, where ngspice gives 3 V"', async () => {
    for (const amp of [['E1 y 0 x y 1e6', 'R2 y 0 1k'], ['E1 y 0 x y 1e5', 'E2 z 0 y z 1e5', 'E3 w 0 z w 1e5', 'R2 w 0 1k']]) {
      const r = await solveText(`* S28 beside an op-amp\nV2 x 0 1\n${amp.join('\n')}\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n`, ngspice);
      expect([sp(r.words.nodes.find((n) => n.node === 'n1')?.text), message(r.words, 'imprecise-answers')], amp[0]).toEqual(['3 V', undefined]);
      expect(message(r.words, 'unchecked-answers'), amp[0]).toContain("ngspice's numbers in the operating point do not fit the circuit PlainSpice reads from this netlist");
    }
  });

  it('within the part an op-amp drives, its gain is still counted: the non-inverting amplifier of an E of 1e15 keeps its warning, "node out is at 9.15 V, where ngspice gives 9.5 V", beside a separate 1 A source and 2 Ω', async () => {
    const r = await solveText(netlist('V1 in 0 3.3', 'E1 out 0 in inm 1e15', 'R1 inm 0 220', 'R2 out inm 390', 'Rl out 0 390', 'I1 0 n1 1', 'R3 n1 0 2', '.op'), ngspice);
    expect(message(r.words, 'imprecise-answers')).toContain('node out is at 9.15 V, where ngspice gives 9.5 V');
    expect(sp(r.words.nodes.find((n) => n.node === 'n1')?.text)).toBe('2 V');
  });
});

const idle3 = (dc: string, ...extra: string[]): string => netlist(...extra, 'V1 a 0 9', 'R1 a b 3k', 'R2 b 0 6k', 'V2 c 0 6', 'R3 b c 1k', '.options savecurrents', '.op', dc);
const sweepText = (r: Awaited<ReturnType<typeof solveText>>): string => sp(r.words.sweeps[0]!.text);

describe('a sweep point is named by ngspice\'s own x where a value there reads otherwise than at the value its steps say (N1: "at V1 = 9 V, V2 carries 32.76 aA" beside the .op\'s "V2: no current")', () => {
  it('idle3, ".dc V1 0 9 0.01": ngspice\'s last point is 8.999999999999853 V, where V2, idle at 9 V, carries a real 32.76 aA that ngspice gives as 32.96 aA; the sweep is decided exactly, draws the exact digits, and names the point by its x, with notes that say why; no warning, and the .op keeps "V2: no current"', async () => {
    const r = await solveText(idle3('.dc V1 0 9 0.01'), ngspice);
    expect(r.results.dc!.scale.values[900]).toBe(8.999999999999853);
    expect([text(r.words, 'V2'), text(r.words, 'R3')]).toEqual(['no current through V2', 'no current through R3']);
    expect(sweepText(r)).toContain('At V1 = 8.999999999999853 V: v(a) = 9 V, v(b) = 6 V, v(c) = 6 V, i(v2) = −32.76 aA, i(v1) = −1 mA, i(@r1[i]) = 1 mA, i(@r2[i]) = 1 mA, i(@r3[i]) = −32.76 aA.');
    expect(sp(r.words.sweeps[0]!.speech)).toContain('When V1 is 8.999999999999853 volts: ');
    expect(message(r.words, 'imprecise-answers')).toBeUndefined();
    expect(message(r.words, 'sweep-point')).toBe(
      "The DC sweep's last point is V1 = 8.999999999999853 V, not 9 V: ngspice adds the step, 10 mV, to V1 once a point, in doubles (about 16 significant digits), so its points drift from the values the steps say: its last point is 8.999999999999853 V, 147.4 fV short of 9 V. There the circuit makes i(v2) −32.76 aA, where at 9 V it makes 0 A. So PlainSpice names that point by ngspice's own value.",
    );
    expect(message(r.words, 'exact-digits')).toBe(
      "2 results are shown with their exact digits near 0 in the DC sweep: ngspice gave i(v2) -3.295975e-17 A at V1 = 8.999999999999853 V and i(@r3[i]) -3.286260e-17 A at V1 = 8.999999999999853 V. Each is too small beside the larger numbers ngspice works them out from for its arithmetic (about 16 significant digits) to give their digits. Solved exactly, with fractions, from the netlist's values, i(v2) is −32.76 aA at V1 = 8.999999999999853 V and i(@r3[i]) is −32.76 aA at V1 = 8.999999999999853 V, so PlainSpice shows those, in these words and in the Plot panel.",
    );
    // The Plot panel draws the exact value there too; every other point is ngspice's.
    const shown = shownSweep(r.netlist, r.results)!.series.find((s) => s.name === 'i(v2)')!.values;
    const given = r.results.dc!.series.find((s) => s.name === 'i(v2)')!.values;
    expect([sp(formatSI(shown[900]!, 'A')), shown[899]]).toEqual(['−32.76 aA', given[899]]);
  });

  it('v2idle, ".dc V1 0 12 0.1", ends at 11.999999999999973 V: V2 carries the exact 8.882 aA there, which ngspice gives as 8.674 aA, with no warning; in steps of 0.5 V the sweep lands on 12 V and nothing is said', async () => {
    const v2idle = (dc: string): string => netlist('V1 a 0 12', 'V2 c 0 6', 'R1 a b 1k', 'R2 b c 1k', 'R3 b 0 1k', '.op', dc);
    const r = await solveText(v2idle('.dc V1 0 12 0.1'), ngspice);
    expect(sweepText(r)).toContain('At V1 = 11.999999999999973 V: v(a) = 12 V, v(c) = 6 V, v(b) = 6 V, i(v2) = −8.882 aA,');
    expect([message(r.words, 'imprecise-answers'), text(r.words, 'V2')]).toEqual([undefined, 'no current through V2']);
    const half = await solveText(v2idle('.dc V1 0 12 0.5'), ngspice);
    expect(sweepText(half)).toContain('At V1 = 12 V: v(a) = 12 V, v(c) = 6 V, v(b) = 6 V, i(v2) = 0 A,');
    expect(half.words.warnings.map((m) => m.code)).toEqual([]);
  });

  it('by the rule (idle3 with a .param line), the last point does not show what the .op shows at 9 V: it keeps ngspice\'s numbers, unmarked, and is named by its x, with the note that says so', async () => {
    const r = await solveText(idle3('.dc V1 0 9 0.01', '.param rb=6k').replace('R2 b 0 6k', 'R2 b 0 {rb}'), ngspice);
    expect([by(r), text(r.words, 'V2')]).toEqual(['rule', 'no current through V2']);
    expect(sweepText(r)).toContain('At V1 = 8.999999999999853 V: v(a) = 9 V, v(b) = 6 V, v(c) = 6 V, i(v2) = −32.96 aA,');
    expect(message(r.words, 'sweep-point')).toContain('There ngspice gives i(v2) −32.96 aA, where the operating point, at 9 V, shows 0 A. So PlainSpice names that point by ngspice\'s own value.');
    expect(message(r.words, 'rounding-noise')).toBeUndefined();
  });
});

const by = (r: Awaited<ReturnType<typeof solveText>>): string => roundingNoise(r.netlist, r.results).by;

describe('a point found within the step\'s rounding of the .op\'s value stands for the .op\'s state only where it shows what the .op shows, and the notes say what it is (N2)', () => {
  it('idle3 swept in 10 µV steps, past SWEEP_VALUES: its last point, 8.999999999828448 V, shows V2\'s 38.12 fA beside the .op\'s 0, so the size note names no point as the .op\'s state ("where the sweep shows what the operating point shows" was false), and the point is named by its x', async () => {
    const r = await solveText(idle3('.dc V1 0 9 0.00001'), ngspice);
    const last = r.results.dc!.scale.values.length - 1;
    expect(r.results.dc!.scale.values[last]).toBe(8.999999999828448);
    expect(message(r.words, 'sweep-not-checked')).toBe(
      "The DC sweep is shown as ngspice gives it: It has 900001 points of 8 results, more values than PlainSpice looks through for rounding noise (2000000 in all). So at its points a value the circuit makes exactly 0 may show ngspice's rounding noise, and a tiny value ngspice's arithmetic rounded to 0 shows 0.",
    );
    expect(sweepText(r)).toContain('At V1 = 8.999999999828448 V: v(a) = 9 V, v(b) = 6 V, v(c) = 6 V, i(v2) = −38.12 fA,');
    expect(message(r.words, 'sweep-point')).toContain('its last point is 8.999999999828448 V, 171.6 pV short of 9 V. There the circuit makes i(v2) −38.12 fA, where at 9 V it makes 0 A.');
    expect([by(r), text(r.words, 'V2')]).toEqual(['exact', 'no current through V2']);
  }, 120_000);
});

describe('the rule gives a current back only where rounding can hide it, and a point is renamed only where its label reads as the value it is meant to have', () => {
  it('a current Kirchhoff\'s law gives a wire is drawn only where the voltage it makes across the wire is within a few steps of a double of its ends: doctored to 1 mA, which across 1 µΩ is 1 nV beside node p\'s 732.4 nV, it is not (ngspice\'s numbers then break Kirchhoff\'s law: w9711-10 had 2.33e18 A "through" a resistor at 0 V)', async () => {
    const source = netlist(...ladder, 'Rw n3 p 1u', 'Vm p q 0', 'Rvm q 0 1t', '.options gmin=1e-12', '.options savecurrents', '.op');
    const r = await solveText(source, ngspice);
    expect(text(r.words, 'Rw')).toBe('7.324e-19 A from node n3 to node p through Rw');
    const doctored = structuredClone(r.results);
    for (const c of doctored.op!.currents) if (c.element === 'vm' || c.element === 'rvm') c.value = 1e-3;
    const w = describeResults(parseNetlist(source), doctored, r.run);
    expect([text(w, 'Rw'), w.warnings.some((m) => m.code === 'rounded-to-0')]).toEqual(['no current through Rw', false]);
  });

  it('a sweep from −1 V up to 0 V in 0.2 V steps ends at −55.51 aV, where it is meant to be at 0 V: its label, "V1 = −55.51 aV", already says where it is, so the words keep it, with no note about the point', async () => {
    const r = await solveText(netlist('V1 top 0 9', 'R1 top 0 1k', '.op', '.dc V1 -1 0 0.2'), ngspice);
    expect(r.results.dc!.scale.values[5]).toBe(-5.551115123125783e-17);
    expect(sweepText(r)).toContain('At V1 = −55.51 aV: v(top) = −55.51 aV');
    expect(message(r.words, 'sweep-point')).toBeUndefined();
  });
});
