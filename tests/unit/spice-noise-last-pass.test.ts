/**
 * The rounding-noise rule and the results words after the last pass before milestone 2's release (13 November
 * 2026; decision 0015, "After the last pass"; C8b and C9w in docs/spice-facts/explanations.md), run on the real
 * engine as the page runs a netlist (solveText).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { solveText } from '../../src/app/model.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { tfRows } from '../../src/app/components/NumbersPanel.tsx';
import { formatSI } from '../../src/format/si.ts';
import { DESCRIBE_STRINGS, describeResults, roundingNoise, shownSweep, SWEEP_VALUES, sweepTooLarge, type ResultsInWords } from '../../src/spice/describe.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { leastWorkMs } from './work-time.ts';

const root = resolve(import.meta.dirname, '../..');
let ngspice: NgspiceEngine;
beforeAll(async () => {
  ngspice = await NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(root, 'engine/dist/ngspice.wasm')));
});

const sp = (s: string | undefined): string => (s ?? '').replace(/[\u00a0\u2009\u202f]/g, ' ');
const netlist = (...l: string[]): string => `* t\n${l.join('\n')}\n.end\n`;
/** Every note's title and words. */
const notes = (w: ResultsInWords): string[] => w.warnings.flatMap((m) => [sp(m.title), sp(m.why)]);
/** "node node1", "Node node_A": the word before a name that says it already (node-words.ts). */
const DOUBLED = /\bnode\s+node\S/i;

describe('the notes name a node by the node-words rule: "node1", never "node node1" (last pass: code C3-3, facts F1)', () => {
  it('the warning that ngspice\'s answers are off: "node1 is at 4.5 V, where ngspice gives 4.321 V"', async () => {
    const r = await solveText(netlist('V1 top 0 9', 'R1 top node1 10k', 'R2 node1 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'Rw node1 node2 1e-12', 'R5 node2 b 1k', '.op'), ngspice);
    const off = sp(r.words.warnings.find((m) => m.code === 'imprecise-answers')?.why);
    expect(off).toContain('node1 is at 4.5 V, where ngspice gives 4.321 V; node2 is at 4.5 V, where ngspice gives 4.321 V');
    expect(notes(r.words).filter((t) => DOUBLED.test(t))).toEqual([]);
  });

  it('the note for real values ngspice gave as 0: "3 currents and the voltage at node9 are not 0", "node9 7.324e-25 V"', async () => {
    const ladder = ['V1 n0 0 1.5', 'R1 n0 n1 1.5k', 'R2 n1 0 12', 'R3 n1 n2 1.5k', 'R4 n2 0 12', 'R5 n2 n3 1.5k', 'R6 n3 0 12', 'R7 n3 n4 1.5k', 'R8 n4 0 12', 'Rw n3 p 1u', 'Rvm p 0 1t'];
    const r = await solveText(netlist(...ladder, 'E1 node9 0 n3 p 1', 'Rl node9 0 1k', '.op'), ngspice);
    const lost = r.words.warnings.find((m) => m.code === 'rounded-to-0')!;
    expect(sp(lost.title)).toBe('3 currents and the voltage at node9 are not 0, though ngspice gave 0');
    expect(sp(lost.why)).toContain('ngspice gave exactly 0 for Rw, E1, Rl and node9.');
    expect(sp(lost.why)).toContain('Rl 7.324e-28 A and node9 7.324e-25 V.');
    expect(notes(r.words).filter((t) => DOUBLED.test(t))).toEqual([]);
  });

  it('the rounding-noise note: "4 currents are shown as 0 A, and node7 as 0 V", "node7 -1.935098e-07 V"', async () => {
    const r = await solveText(netlist('V1 top 0 9', 'R1 top a 180k', 'R2 a 0 3.9meg', 'R3 top b 18k', 'R4 b 0 390k', 'R5 a m 4.7', 'Vm m b 0', 'H1 node7 0 Vm 1g', 'Rl node7 0 1k', '.options savecurrents', '.op'), ngspice);
    const noise = r.words.warnings.find((m) => m.code === 'rounding-noise')!;
    expect(sp(noise.title)).toBe('4 currents are shown as 0 A, and node7 as 0 V');
    expect(sp(noise.why)).toContain('Rl -1.935098e-10 A and node7 -1.935098e-07 V.');
    expect(sp(noise.why)).toContain('and node7 is joined to ground through parts with no voltage across them');
    expect(notes(r.words).filter((t) => DOUBLED.test(t))).toEqual([]);
  });

  it('a title that starts with a node: "Node out is shown as 0 V", but "node7 is shown as 0 V"; "The voltage at node9 is not 0"', () => {
    expect(DESCRIBE_STRINGS.noiseTitle([], ['out'])).toBe('Node out is shown as 0 V');
    expect(DESCRIBE_STRINGS.noiseTitle([], ['node7'])).toBe('node7 is shown as 0 V');
    expect(DESCRIBE_STRINGS.noiseTitle(['R5'], ['node7'])).toBe("R5's current is shown as 0 A, and node7 as 0 V");
    expect(DESCRIBE_STRINGS.lostTitle([], ['node9'])).toBe('The voltage at node9 is not 0, though ngspice gave 0');
    expect(DESCRIBE_STRINGS.lostTitle([], ['out'])).toBe('The voltage at node out is not 0, though ngspice gave 0');
    expect(DESCRIBE_STRINGS.lostTitle(['Rw'], ['out'])).toBe("Rw's current and the voltage at node out are not 0, though ngspice gave 0");
    expect(DESCRIBE_STRINGS.lostGaveVoltage('node9')).toBe('node9 exactly 0 V');
    expect(DESCRIBE_STRINGS.lostIsAt('node9', '1 nV')).toBe('node9 is at 1 nV');
    expect(DESCRIBE_STRINGS.offVoltage('out', '4.5 V', '4.321 V')).toBe('node out is at 4.5 V, where ngspice gives 4.321 V');
  });
  it('a name with a hidden character is named in the notes, and a name outside ASCII is said as written (decisions 0012 and 0016; the skeptic of F1)', async () => {
    const bridge = (out: string): string => netlist('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', `E1 ${out} 0 a b 1e6`, `Rl ${out} 0 100`, '.options savecurrents', '.op');
    const hidden = await solveText(bridge('o\u200but'), ngspice);
    const why = notes(hidden.words).join(' ');
    expect(why).toContain('node out (written with a zero-width space in it) ');
    expect(why).not.toMatch(/\u200b/);
    const turkish = await solveText(bridge('ÇIKIŞ'), ngspice);
    const words = notes(turkish.words).join(' ');
    expect(words).toContain('node ÇIKIŞ');
    expect(words).not.toMatch(/ÇikiŞ|çıkış/);
    // The reasons too: "the two ends of R5, node ÇIKIŞ and node b, are at the same voltage" (the skeptic of C3-3).
    const reason = await solveText(netlist('V1 top 0 9', 'R1 top ÇIKIŞ 10k', 'R2 ÇIKIŞ 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 ÇIKIŞ b 1k', '.options savecurrents', '.op'), ngspice);
    const said = notes(reason.words).join(' ');
    expect(said).toContain('the two ends of R5, node ÇIKIŞ and node b, are at the same voltage');
    expect(said).not.toMatch(/ÇikiŞ/);
  });
});

describe('the verb follows the unit word: "1 amp flows", "1 times 10 to the power minus 29 amps flow" (last pass: regress-4)', () => {
  it('a 1 nV source\'s exact 1e-29 A through R1 flow; a 1 A source\'s 1 amp flows', async () => {
    const r = await solveText(netlist('V1 top 0 1n', 'R1 top s 1', 'R2 s 0 1e20', 'Vm top v 0', 'R3 v 0 27k', '.options savecurrents', '.op'), ngspice);
    expect(r.words.currents.find((c) => c.name === 'R1')!.speech).toBe('1 times 10 to the power minus 29 amps flow from node top to node s through R1');
    expect(r.annotations.find((a) => a.line === 3)!.speech).toContain('1 times 10 to the power minus 29 amps flow from node top to node s');
    const one = await solveText(netlist('I1 0 a 1', 'R1 a 0 2', '.options savecurrents', '.op'), ngspice);
    expect(one.words.currents.find((c) => c.name === 'R1')!.speech).toBe('1 amp flows from node a to ground through R1');
    // 1 kV across 1 pΩ: 1e15 A, said with an exponent, "amps flow" (the skeptic of regress-4).
    const huge = await solveText(netlist('V1 a 0 1k', 'R1 a 0 1p', '.options savecurrents', '.op'), ngspice);
    expect(huge.words.currents.find((c) => c.name === 'R1')!.speech).toBe('1 times 10 to the power 15 amps flow from node a to ground through R1');
    const milli = await solveText(netlist('I1 0 a 1m', 'R1 a 0 2', '.options savecurrents', '.op'), ngspice);
    expect(milli.words.currents.find((c) => c.name === 'R1')!.speech).toBe('1 milliamp flows from node a to ground through R1');
  });
});

describe('a transistor\'s currents are named by their terminals in the sweep\'s words (last pass: transistor-currents-same-name; C8b)', () => {
  it('a BJT, a MOSFET and a JFET swept: "the collector current of Q1", "the drain current of M1", "the gate-to-drain current of J1"', async () => {
    const r = await solveText(
      netlist('V1 vcc 0 9', 'Rc vcc c 1k', 'Rb vcc b 100k', 'Q1 c b 0 qmod', 'Rd vcc d 1k', 'M1 d g 0 0 mmod', 'Vg g 0 2', 'Rj vcc dj 1k', 'J1 dj gj 0 jmod', 'Vgj gj 0 -0.5', '.model qmod npn bf=100', '.model mmod nmos level=1 vto=1 kp=1m', '.model jmod njf vto=-2 beta=1m', '.options savecurrents', '.dc V1 9 9 1'),
      ngspice,
    );
    const speech = r.words.sweeps[0]!.speech;
    for (const said of [
      'the collector current of Q1 is 8.171 milliamps',
      'the emitter current of Q1 is minus 8.253 milliamps',
      'the base current of Q1 is 81.71 microamps',
      'the substrate current of Q1 is 828.6 femtoamps',
      'the drain current of M1 is 500 microamps',
      'the source current of M1 is minus 500 microamps',
      'the gate current of M1 is 0 amps',
      'the bulk current of M1 is minus 8.51 picoamps',
      'the drain current of J1 is 2.25 milliamps',
      'the source current of J1 is minus 2.25 milliamps',
      'the gate current of J1 is minus 7.77 picoamps',
      'the gate-to-drain current of J1 is minus 7.26 picoamps',
      'the current in Rc is 8.171 milliamps',
    ])
      expect(speech).toContain(said);
    expect(speech).not.toMatch(/the current in (Q1|M1|J1)\b/);
  });
});

describe('the sweep decision\'s work is bounded by points × results (last pass: sweep-points-unbounded-time)', () => {
  /** The C9 bridge with 53 ammeters in its middle branch (60 parts), every current saved. */
  const ammeters = (): string[] => {
    const amm = ['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a m0 1k'];
    for (let k = 0; k < 53; k++) amm.push(`Vm${k} m${k} ${k === 52 ? 'b' : `m${k + 1}`} 0`);
    return [...amm, '.options savecurrents', '.op'];
  };
  const sizeNote = (w: ResultsInWords): string | undefined => w.warnings.find((m) => m.code === 'sweep-not-checked')?.why;

  it('a beginner\'s ".dc I1 0 2A 0.5A" (2A is 2 attoamps) runs 444,094 points: the sweep is left as ngspice gives it, a note says so, and describeResults stays quick (it took 74 to 84 ms at 444,094 points of 78 results)', async () => {
    const text = netlist('I1 0 top 1m', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a m 1k', 'Vm m b 0', '.op', '.dc I1 0 2A 0.5A');
    const r = await solveText(text, ngspice);
    const dc = r.results.dc!;
    expect([dc.scale.values.length, dc.series.length]).toEqual([444_094, 11]);
    expect(sweepTooLarge(dc)).toBe(true);
    expect(sp(sizeNote(r.words))).toBe(
      "It has 444094 points of 11 results, more values than PlainSpice looks through for rounding noise (2000000 in all). So at its points a value the circuit makes exactly 0 may show ngspice's rounding noise, and a tiny value ngspice's arithmetic rounded to 0 shows 0.",
    );
    expect(shownSweep(r.netlist, r.results)).toBe(dc);
    // The .op beside it is still decided exactly: no point of the sweep is at its own 1 mA.
    expect([roundingNoise(r.netlist, r.results).by, r.words.currents.find((c) => c.name === 'Vm')!.text]).toEqual(['exact', 'Vm measures no current']);
    const copies = [0, 1, 2].map(() => structuredClone(r.results));
    const [ms] = leastWorkMs([() => describeResults(parseNetlist(text), copies.pop()!, r.run)], 3);
    expect(ms).toBeLessThan(20);
  }, 60_000);

  it('past SWEEP_VALUES the sweep keeps ngspice\'s numbers but at the .op\'s own state, V1 = 9 V, which shows the .op\'s 0s; just under it, the sweep is decided at every point, still quickly', async () => {
    const over = await solveText(netlist(...ammeters(), '.dc V1 0 9 0.000244140625'), ngspice);
    const dc = over.results.dc!;
    expect(dc.scale.values.length * dc.series.length).toBeGreaterThan(SWEEP_VALUES);
    const last = dc.scale.values.length - 1;
    expect(dc.scale.values[last]).toBe(9);
    const vm = (s: { series: { name: string; values: ArrayLike<number> }[] }): ArrayLike<number> => s.series.find((x) => x.name === 'i(vm0)')!.values;
    const shown = shownSweep(over.netlist, over.results)!;
    expect(vm(dc)[last]).not.toBe(0);
    expect([vm(shown)[last], vm(shown)[1]]).toEqual([0, vm(dc)[1]]);
    expect(sp(sizeNote(over.words))).toContain('except at V1 = 9 V, the operating point\'s own state, where the sweep shows what the operating point shows.');
    expect(over.words.currents.find((c) => c.name === 'Vm0')!.text).toBe('Vm0 measures no current');
    const text = netlist(...ammeters(), `.dc V1 0 9.9998 ${9.9998 / 16_999}`);
    const under = await solveText(text, ngspice);
    expect(under.results.dc!.scale.values.length * under.results.dc!.series.length).toBeLessThanOrEqual(SWEEP_VALUES);
    expect(sizeNote(under.words)).toBeUndefined();
    expect(under.words.warnings.filter((m) => m.code === 'rounding-noise').map((m) => m.title)).toContain('54 results are shown as 0 at some points of the DC sweep');
    const copies = [0, 1, 2].map(() => structuredClone(under.results));
    const [ms] = leastWorkMs([() => describeResults(parseNetlist(text), copies.pop()!, under.run)], 3);
    expect(ms).toBeLessThan(50);
  }, 120_000);
});

describe('an attoamp is never drawn as an answer with nothing said: lines that leave the .op as it is are solved exactly, and the rule says what it cannot tell (last pass: regress-1; C9w)', () => {
  const bridge = ['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a m 1k', 'Vm m b 0'];
  const by = (r: Awaited<ReturnType<typeof solveText>>): string => roundingNoise(r.netlist, r.results).by;
  const text = (w: ResultsInWords, name: string): string => sp(w.currents.find((c) => c.name === name)!.text);

  it('the balanced bridge read by a 0 V ammeter, with a .temp line, .options temp, a DC value beside a SIN or a PULSE, or m=1 on R5: solved exactly, Vm is 0 A with the note', async () => {
    const variants: [string, string][] = [
      ['V1 top 0 9', 'V1 top 0 9\n.temp 27'],
      ['V1 top 0 9', 'V1 top 0 9\n.temp 100'],
      ['V1 top 0 9', 'V1 top 0 9\n.options temp=-40'],
      ['V1 top 0 9', 'V1 top 0 DC 9 SIN(9 1 1k)'],
      ['V1 top 0 9', 'V1 top 0 DC 9 PULSE(0 9 1m 1m 1m 5m 10m)'],
      ['R5 a m 1k', 'R5 a m 1k m=1'],
    ];
    for (const [old, line] of variants) {
      const r = await solveText(netlist(...bridge.map((l) => (l === old ? line : l)), '.op'), ngspice);
      expect([by(r), text(r.words, 'Vm')], line).toEqual(['exact', 'Vm measures no current']);
      expect(r.words.warnings.find((m) => m.code === 'rounding-noise')?.why, line).toContain('Solved exactly, with fractions');
    }
  });

  it('by the rule (a line it does not model exactly), an ammeter whose only partner at a node is a resistor ngspice gives exactly 0 A carries 0 too; a real 0.73 aA after a 1 µΩ wire is given back at the next node, with the note', async () => {
    const rule = await solveText(netlist(...bridge, '.options gmin=1e-12', '.op'), ngspice);
    expect([by(rule), text(rule.words, 'Vm')]).toEqual(['rule', 'Vm measures no current']);
    const ladder = ['V1 n0 0 1.5', 'R1 n0 n1 1.5k', 'R2 n1 0 12', 'R3 n1 n2 1.5k', 'R4 n2 0 12', 'R5 n2 n3 1.5k', 'R6 n3 0 12', 'R7 n3 n4 1.5k', 'R8 n4 0 12', 'Rw n3 p 1u', 'Vm p q 0', 'Rvm q 0 1t', '.options savecurrents'];
    const wire = await solveText(netlist(...ladder, '.options gmin=1e-12', '.op'), ngspice);
    expect([by(wire), text(wire.words, 'Vm')]).toEqual(['rule', 'Vm measures 7.324e-19 A flowing from node p to node q']);
    expect(sp(wire.words.warnings.find((m) => m.code === 'maybe-noise')?.title)).toBe('2 currents may be rounding noise');
    // Solved exactly, the same circuit has every one of them real, and the wire's 7.324e-19 A is shown exactly (C9n).
    const exact = await solveText(netlist(...ladder, '.op'), ngspice);
    expect([by(exact), text(exact.words, 'Rw'), exact.words.warnings.some((m) => m.code === 'maybe-noise')]).toEqual(['exact', '7.324e-19 A from node n3 to node p through Rw', false]);
  });

  it('beside a transistor the rule decides: the H of 1 GΩ\'s ammeter and R5 keep ngspice\'s attoamps, which a note says may be rounding noise (it drew "Vm measures 193.5 aA" with nothing said)', async () => {
    const r = await solveText(netlist('V1 top 0 9', 'R1 top a 180k', 'R2 a 0 3.9meg', 'R3 top b 18k', 'R4 b 0 390k', 'R5 a m 4.7', 'Vm m b 0', 'H1 out 0 Vm 1g', 'Rl out 0 1k', 'Q1 top x 0 qmod', 'Rx x 0 1meg', '.model qmod npn', '.options savecurrents', '.op'), ngspice);
    expect([by(r), text(r.words, 'Vm')]).toEqual(['rule', 'Vm measures 193.5 aA flowing from node b to node m']);
    const maybe = r.words.warnings.find((m) => m.code === 'maybe-noise')!;
    expect(sp(maybe.why)).toMatch(/^ngspice gave R5 -3\.779483e-16 A and Vm -1\.935098e-16 A\. /);
    expect(sp(maybe.why)).toContain("PlainSpice cannot tell which from ngspice's numbers alone, so it shows each as ngspice gives it.");
  });
});

describe('on the exact path, ngspice\'s numbers are answers only where the page draws them with their exact digits (last pass: carrier-zero-beside-own-noise, silent-rule-same-circuit-check)', () => {
  const by = (r: Awaited<ReturnType<typeof solveText>>): string => roundingNoise(r.netlist, r.results).by;
  const text = (w: ResultsInWords, name: string): string => sp(w.currents.find((c) => c.name === name)!.text);
  const off = (w: ResultsInWords): string => sp(w.warnings.find((m) => m.code === 'imprecise-answers')?.why);

  it('a G of 1e6 S that the circuit makes exactly 0 keeps ngspice\'s 444.1 pA beside the node it lifts, with the warning; it was drawn "no current" beside its own rounding (g520d)', async () => {
    const r = await solveText(netlist('V1 top 0 3.3', 'Rw top f1 100u', 'Va f1 n 0', 'R2 n 0 150', 'R1 n f2 1e15', 'C1 f2 0 1p', 'G1 0 g n f2 1e6', 'R3 g 0 820k', 'I1 0 g 1n', '.options savecurrents', '.op'), ngspice);
    expect([by(r), text(r.words, 'G1'), sp(r.words.nodes.find((n) => n.node === 'g')!.text)]).toEqual(['rule', '444.1 pA from ground to node g through G1', '1.465 mV']);
    expect(off(r.words)).toContain('G1 carries no current, where ngspice gives 444.1 pA');
    expect(off(r.words)).toContain('node g is at 820 µV, where ngspice gives 1.465 mV; and R3 carries 1 nA, where ngspice gives 1.786 nA.');
  });

  it('the same G lifting a 1 aA load\'s node to 520.1 V for 715.3 fV is named, not drawn as "no current" (i9751-450)', async () => {
    const r = await solveText(netlist('Vf f0 0 3.3', 'Rw f0 f1 100u', 'Rg f1 0 1g', 'Va0 f1 fa0 0', 'Va1 fa0 top1 0', 'R1 top1 f2 1e15', 'C1 f2 0 1p', 'L1 top1 x3 1m', 'R2 x3 0 150', 'G1 0 g4 top1 f2 1e6', 'R3 g4 0 820k', 'I1 0 g4 1e-18', 'R4 g4 i5 5.6meg', 'R5 i5 0 3.3k', '.options savecurrents', '.op'), ngspice);
    expect([by(r), text(r.words, 'G1')]).toEqual(['rule', '727.1 µA from ground to node g4 through G1']);
    expect(off(r.words)).toContain('G1 carries no current, where ngspice gives 727.1 µA');
    expect(off(r.words)).toContain('node g4 is at 715.3 fV, where ngspice gives 520.1 V');
  });

  it('C9m fed through a 1 µΩ wire into two 0 V ammeters: ngspice\'s values leave 1.07e-7 of the equations, beyond 2^-30, yet every answer is drawn with its exact digits, so it is decided exactly: R7 is 0 A with the note (sc9m-w1u: the rule drew 5.329e-20 A, with nothing said)', async () => {
    const r = await solveText(netlist('V1 top 0 9', 'Rw top s 1u', 'Rg s 0 1g', 'Va s v3 0', 'Vb v3 n1 0', 'Rl n1 0 820', 'R1 n1 n2 15k', 'R2 n2 n3 330', 'R3 n3 0 33k', 'R4 n1 n4 15k', 'R5 n4 n5 330', 'R6 n5 0 33k', 'R7 n3 n5 100k', '.options savecurrents', '.op'), ngspice);
    expect([by(r), text(r.words, 'R7')]).toEqual(['exact', 'no current through R7']);
    expect(sp(r.words.warnings.find((m) => m.code === 'rounding-noise')?.why)).toContain('the two ends of R7, node n3 and node n5, are at the same voltage, 6.145 V');
  });

  it('an ill-fed bridge whose real −60.29 zA ngspice gives as 270.8 zA keeps ngspice\'s numbers with the warning; the rule wrote them as 0, "rounding noise" (i9751-394)', async () => {
    const r = await solveText(netlist('Vf f0 0 12', 'Rw f0 f1 100p', 'Rg f1 0 1meg', 'Va0 f1 fa0 0', 'Va1 fa0 fa1 0', 'Va2 fa1 top1 0', 'R1 top1 a2 1.5meg', 'R2 a2 top1 120k', 'R3 top1 b3 4.5meg', 'R4 b3 top1 360k', 'R5 a2 b3 390k', 'R6 b3 a4 1.2', 'R7 a4 0 27000', 'R8 b3 b5 3.6', 'R9 b5 0 81000.000000081', 'R10 a4 m6 820', 'V2 m6 b5 0', 'R11 top1 a7 3.3', 'R12 a7 a2 5.6meg', 'R13 top1 b8 330m', 'R14 b8 a2 560k', 'R15 a7 m9 82', 'R16 m9 m10 820', 'R17 m10 b8 150', 'L1 top1 x11 1m', 'R18 x11 0 4.7', '.options savecurrents', '.op'), ngspice);
    expect([by(r), text(r.words, 'R10'), text(r.words, 'V2')]).toEqual(['rule', '2.708e-19 A from node m6 to node a4 through R10', 'V2 measures 2.168e-19 A flowing from node b5 to node m6']);
    expect(off(r.words)).toContain('R10 carries 6.029e-20 A, where ngspice gives 2.708e-19 A');
    expect(r.words.currents.filter((c) => c.noise !== undefined).map((c) => c.name)).not.toContain('R10');
  });

  it('an exact 0 that an F of 1e9 lifts to 888.2 nA, where every other answer is drawn with its exact digits, is 0 with the note (i9751-1437: the rule drew it with 78.89 pW)', async () => {
    const r = await solveText(netlist('Vf f0 0 15', 'Rw f0 f1 10n', 'Rg f1 0 1e12', 'Va0 f1 fa0 0', 'Va1 fa0 top1 0', 'R1 top1 a2 1.2', 'R2 a2 0 100', 'R3 top1 b3 0.12', 'R4 b3 0 10.01', 'G1 0 g4 a2 b3 1m', 'R5 g4 0 4.7meg', 'R6 a2 b3 820k', 'R7 b3 a5 4.7', 'R8 a5 top1 2.7meg', 'R9 b3 b6 14.1', 'R10 b6 top1 8.1meg', 'V2 a5 m7 0', 'V3 m7 m8 0', 'V4 m8 m9 0', 'V5 m9 m10 0', 'V6 m10 m11 0', 'V7 m11 m12 0', 'R11 m12 b6 2.2', 'F1 0 f13 V5 1e9', 'R12 f13 0 100', '.options savecurrents', '.op'), ngspice);
    const f1 = r.words.currents.find((c) => c.name === 'F1')!;
    expect([by(r), sp(f1.text), f1.power]).toEqual(['exact', 'no current through F1', undefined]);
  });

  it('with a .save line, the values ngspice gives are judged by the page\'s digits: C9m saving v(n3), v(n5) and R7\'s current is decided exactly, R7 0 A with the note (c9m-save: the rule drew 6.217e-20 A); a node missing with no .save line is not this circuit\'s', async () => {
    const r = await solveText(netlist('V1 n1 0 9', 'R1 n1 n2 15k', 'R2 n2 n3 330', 'R3 n3 0 33k', 'R4 n1 n4 15k', 'R5 n4 n5 330', 'R6 n5 0 33k', 'R7 n3 n5 100k', '.save v(n3) v(n5) @r7[i]', '.op'), ngspice);
    expect([by(r), text(r.words, 'R7')]).toEqual(['exact', 'no current through R7']);
  });

  it('a long sweep of the 1 nΩ wire of C9n.4 whose checked point at V1 = 1.125 V ngspice gives one step of a double over 1 nΩ (433.7 pA for 340.6 pA) is shown as ngspice gives it, with a warning that names it, but at its last point, the .op\'s own 1.5 V, a few steps of a double away (1.5000000000000846), which shows the .op\'s exact 454.1 pA (it showed ngspice\'s 0 A there: the critic of the last pass\'s fixes); the .op beside it is still decided exactly', async () => {
    const r = await solveText(netlist('V1 top1 0 1.5', 'R1 top1 d2 270k', 'R2 d2 0 820', 'R3 d2 p3 1n', 'R4 p3 0 10meg', '.options savecurrents', '.op', '.dc V1 0 1.5 0.00025'), ngspice);
    expect([by(r), text(r.words, 'R3')]).toEqual(['exact', '454.1 pA from node d2 to node p3 through R3']);
    const dc = r.results.dc!;
    const last = dc.scale.values.length - 1;
    expect(dc.scale.values[last]).toBe(1.5000000000000846);
    const given = dc.series.find((s) => s.name === 'i(@r3[i])')!.values;
    const shown = shownSweep(r.netlist, r.results)!.series.find((s) => s.name === 'i(@r3[i])')!.values;
    expect([given[last], given[last - 1]]).toEqual([0, 0]);
    expect([sp(formatSI(shown[last]!, 'A')), shown[last - 1]]).toEqual(['454.1 pA', 0]);
    expect(sp(r.words.sweeps[0]!.text)).toContain('At V1 = 1.5 V: v(top1) = 1.5 V, v(d2) = 4.541 mV, v(p3) = 4.541 mV, i(v1) = −5.539 µA, i(@r1[i]) = 5.539 µA, i(@r2[i]) = 5.538 µA, i(@r3[i]) = 454.1 pA');
    const warning = r.words.warnings.find((m) => m.code === 'imprecise-answers')!;
    expect(sp(warning.title)).toBe("Some of ngspice's answers in the DC sweep are off");
    expect(sp(warning.why)).toBe("Solved exactly, with fractions, from the netlist's values, at V1 = 1.125 V, R3 carries 340.6 pA, where ngspice gives 433.7 pA. ngspice computes with about 16 significant digits, and solving this circuit loses most of them there. PlainSpice shows the sweep as ngspice gives it, but at V1 = 1.5 V, the operating point's own state, where it shows what the operating point shows, so its numbers may not agree with each other.");
  });

  it('where the rule decides beside the exact solution with no warning (values that hang on a diode\'s current), the tiny values it cannot tell from noise keep the note, except those real whatever the diode carries (C9w.8: "V2 measures 510 fA" and "node d3 510 fV" were drawn with nothing said)', async () => {
    const lines = ['V1 top1 0 0.5', 'R1 top1 s2 1m', 'R2 s2 0 1e12', 'D1 d3 s2 dmod', 'R3 d3 0 120k', 'R4 d3 x4 1.2', 'C1 x4 0 1n', 'V2 d3 v5 0', 'R5 v5 0 1', 'F1 0 f6 V1 1m', 'R6 f6 0 10', 'V3 n1 0 1n', 'R7 n1 n2 1k', 'R8 n2 0 1k', '.model dmod D(is=1e-14)', '.options savecurrents'];
    const r = await solveText(netlist(...lines, '.op'), ngspice);
    expect([by(r), off(r.words), text(r.words, 'V2'), sp(r.words.nodes.find((n) => n.node === 'd3')!.text)]).toEqual(['rule', '', 'V2 measures 510 fA flowing from node d3 to node v5', '510 fV']);
    const maybe = r.words.warnings.find((m) => m.code === 'maybe-noise')!;
    expect(sp(maybe.title)).toBe('3 currents and 3 node voltages may be rounding noise');
    expect(sp(maybe.why)).toMatch(/^ngspice gave R3 4\.249949e-18 A, V2 5\.099939e-13 A, R5 5\.099939e-13 A, node d3 5\.099939e-13 V and 2 more node voltages, each in the tables above\. /);
    // By the rule alone (ngspice's own gmin written out: the same doubles), the 1 nV divider's 500 fA and n2's 500 pV are in it too.
    const rule = await solveText(netlist(...lines, '.options gmin=1e-12', '.op'), ngspice);
    expect(sp(rule.words.warnings.find((m) => m.code === 'maybe-noise')?.title)).toBe('6 currents and 4 node voltages may be rounding noise');
    // Beside the warning, the note leaves out what the warning names: g520d's R1, 4.441e-31 A, is named once.
    const g = await solveText(netlist('V1 top 0 3.3', 'Rw top f1 100u', 'Va f1 n 0', 'R2 n 0 150', 'R1 n f2 1e15', 'C1 f2 0 1p', 'G1 0 g n f2 1e6', 'R3 g 0 820k', 'I1 0 g 1n', '.options savecurrents', '.op'), ngspice);
    expect([off(g.words).includes('R1 carries no current, where ngspice gives 4.441e-31 A'), g.words.warnings.some((m) => m.code === 'maybe-noise')]).toEqual([true, false]);
  });
});

describe('a .tf ratio is judged against the exact one as the .op beside it is (last pass: tf-lost-ratio-contradiction; C9w.10 to C9w.12)', () => {
  const by = (r: Awaited<ReturnType<typeof solveText>>): string => roundingNoise(r.netlist, r.results).by;
  const text = (w: ResultsInWords, name: string): string => sp(w.currents.find((c) => c.name === name)!.text);
  const lostNote = (w: ResultsInWords): string => sp(w.warnings.find((m) => m.title === 'The transfer function is not 0, though ngspice gave 0')?.why);
  const offTf = (w: ResultsInWords): string => sp(w.warnings.find((m) => m.title === "ngspice's transfer function is off")?.why);
  const divider = ['V1 top 0 10', 'R1 top s 100', 'R2 s 0 1e20', '.options savecurrents'];

  it('a real 1e-18 V/V ngspice gives as exactly 0, beside an .op decided exactly, is shown so, with a note; the Numbers panel keeps ngspice\'s 0 in its own column', async () => {
    const r = await solveText(netlist(...divider, '.op', '.dc V1 0 10 5', '.tf v(top,s) V1'), ngspice);
    const q = r.words.tf!.transferFunction!;
    expect([sp(q.text), q.given, sp(text(r.words, 'R1'))]).toEqual(['v(top,s)/V1 = 1e-18 (V/V)', 0, '1e-19 A from node top to node s through R1']);
    expect(lostNote(r.words)).toContain('Solved exactly, with fractions, from the netlist\'s values, it is 1e-18 V/V, so PlainSpice shows 1e-18 V/V.');
    const [row] = tfRows(r.words.tf!);
    expect([sp(row!.text), row!.given]).toEqual(['1e-18 V/V', 0]);
    // With no .op, the sweep beside it, decided exactly, does the same.
    const noOp = await solveText(netlist(...divider, '.dc V1 0 10 5', '.tf v(top,s) V1'), ngspice);
    expect([sp(noOp.words.tf!.transferFunction!.text), lostNote(noOp.words) !== '']).toEqual(['v(top,s)/V1 = 1e-18 (V/V)', true]);
  });

  it('with nothing beside it decided exactly (a .tf alone, or an .op whose answers are off) ngspice\'s 0 stays, with the warning that names the exact ratio', async () => {
    const alone = await solveText(netlist(...divider.slice(0, 3), '.tf v(top,s) V1'), ngspice);
    expect([alone.words.tf!.transferFunction!.value, offTf(alone.words)]).toEqual([0, "Solved exactly, with fractions, from the netlist's values, v(top,s)/V1 is 1e-18 V/V, where ngspice gives 0 V/V. ngspice computes with about 16 significant digits, and solving this circuit loses most of them. PlainSpice shows ngspice's ratio as it gives it, so it may not agree with the other numbers here."]);
    const off = await solveText(netlist('V1 top1 0 9', 'R1 top1 d2 270k', 'R2 d2 0 820', 'R3 d2 p3 1n', 'R4 p3 0 10meg', '.options savecurrents', '.op', '.tf v(d2,p3) V1'), ngspice);
    expect([by(off), off.words.tf!.transferFunction!.value, offTf(off.words)]).toEqual(['rule', 0, expect.stringContaining('v(d2,p3)/V1 is 3.028e-19 V/V, where ngspice gives 0 V/V.')]);
  });

  it('a nonzero ratio drawn with the exact one\'s digits says nothing; a 0 V ammeter\'s 1e-20 A/V is its own (ngspice gives it, not 0)', async () => {
    const r = await solveText(netlist('V1 top 0 10', 'R1 top m 100', 'Vm m s 0', 'R2 s 0 1e20', '.options savecurrents', '.op', '.tf i(Vm) V1'), ngspice);
    const q = r.words.tf!.transferFunction!;
    expect([sp(q.text), q.given, q.exact, offTf(r.words), lostNote(r.words)]).toEqual(['i(Vm)/V1 = 1e-20 (A/V)', undefined, undefined, '', '']);
  });
});

describe('beside an .op the rule decides, the sweep never gives a number at the .op\'s own state where the .op shows 0 (last pass: rule-op-vs-sweep-tf; C9w.13, C9w.14)', () => {
  const bridge = ['V1 top 0 9', 'R1 top a {rtop}', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', '.options savecurrents', '.op'];
  const r5 = (r: Awaited<ReturnType<typeof solveText>>): number[] => Array.from(shownSweep(r.netlist, r.results)!.series.find((s) => s.name === 'i(@r5[i])')!.values);
  const given = (r: Awaited<ReturnType<typeof solveText>>): number[] => Array.from(r.results.dc!.series.find((s) => s.name === 'i(@r5[i])')!.values);

  it('C9 with a .param line swept in steps of 0.5 V: at 9 V, the .op\'s state, R5 is 0 as in the .op, with a note; the other points keep ngspice\'s numbers', async () => {
    const r = await solveText(netlist('.param rtop=10k', ...bridge, '.dc V1 1 9 0.5'), ngspice);
    expect([roundingNoise(r.netlist, r.results).by, sp(r.words.currents.find((c) => c.name === 'R5')!.text)]).toEqual(['rule', 'no current through R5']);
    const [shown, raw] = [r5(r), given(r)];
    expect([raw[16], shown[16], shown[15], shown[7]]).toEqual([-8.881784197001253e-19, 0, raw[15], raw[7]]);
    expect(raw[15]).not.toBe(0);
    expect(sp(r.words.sweeps[0]!.text)).toContain('i(@r5[i]) = 0 A');
    expect(sp(r.words.warnings.find((m) => m.title === 'i(@r5[i]) is shown as 0 at some points of the DC sweep')?.why)).toContain('at V1 = 9 V. That is the operating point\'s own state');
  });

  it('a sweep of two sources marks its point at V1 = 9 V, V2 = 0 V; beside a transistor the point at 9 V too, and the .tf, a slope the rule cannot decide, stays ngspice\'s', async () => {
    const two = await solveText(netlist('.param rtop=10k', ...bridge, 'V2 x 0 0', 'Rx x 0 1k', '.dc V1 0 9 3 V2 0 1 1'), ngspice);
    expect(sp(two.words.warnings.find((m) => m.title === 'i(@r5[i]) is shown as 0 at some points of the DC sweep')?.why)).toContain('at V1 = 9 V, V2 = 0 V.');
    expect(r5(two)[3]).toBe(0);
    const q = await solveText(netlist('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', 'Q1 top x 0 qmod', 'Rx x 0 1meg', '.model qmod npn', '.options savecurrents', '.op', '.dc V1 0 9 3', '.tf v(a,b) V1'), ngspice);
    expect([roundingNoise(q.netlist, q.results).by, r5(q), sp(q.words.tf!.transferFunction!.text)]).toEqual(['rule', [0, 0, 0, 0], 'v(a,b)/V1 = −5.551e-17 (V/V)']);
  });
});
