/**
 * Rounding noise after the re-check of 12 November 2026 (decision 0015; C9 to C9p in
 * docs/spice-facts/explanations.md), run on the real engine, as the page runs a netlist (solveText):
 * a circuit PlainSpice solves exactly is decided by its exact solution. A value whose exact value is 0
 * is shown as 0, whatever size ngspice gives it; a value whose exact value is not 0 is shown as ngspice
 * gives it, however tiny. The netlists are the re-check's (noise N1 to N4, spice S1 and S3, code-6).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { plotSpecs } from '../../src/app/components/PlotPanel.tsx';
import { solveText } from '../../src/app/model.ts';
import { csvText, tableRows } from '../../src/plot/table.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { describeResults, roundingNoise, type ResultsInWords } from '../../src/spice/describe.ts';
import { agrees, exactModel, shares, toDouble, type ExactModel } from '../../src/spice/exact.ts';
import { readAfterEnd } from '../../src/spice/explain.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { leastWorkMs } from './work-time.ts';

const root = resolve(import.meta.dirname, '../..');
let ngspice: NgspiceEngine;
beforeAll(async () => {
  ngspice = await NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(root, 'engine/dist/ngspice.wasm')));
});

const sp = (s: string): string => s.replace(/[  ]/g, ' ');
const lines = (...l: string[]): string => `* t\n${l.join('\n')}\n.op\n.end\n`;
async function solved(text: string): Promise<{ words: ResultsInWords; by: string }> {
  const r = await solveText(text, ngspice);
  return { words: r.words, by: roundingNoise(r.netlist, r.results).by };
}
/** The parts and nodes shown as noise of 0. */
const noise = (w: ResultsInWords): string[] => [...w.currents.filter((c) => c.noise !== undefined).map((c) => c.name), ...w.nodes.filter((n) => n.noise !== undefined).map((n) => `node ${n.node}`)];
const node = (w: ResultsInWords, name: string): string => sp(w.nodes.find((n) => n.node === name)!.text);
const current = (w: ResultsInWords, name: string): string => sp(w.currents.find((c) => c.name === name)!.text);
const note = (w: ResultsInWords): string | undefined => w.warnings.find((m) => m.code === 'rounding-noise')?.why;

describe('N1: a real voltage or current is never shown as 0 (C9n)', () => {
  it('a ladder node read by a 1 TΩ meter through a 1 µΩ wire keeps its 732.4 nV, and the meter its 0.73 aA', async () => {
    const { words, by } = await solved(lines('V1 n0 0 1.5', 'R1 n0 n1 1.5k', 'R2 n1 0 12', 'R3 n1 n2 1.5k', 'R4 n2 0 12', 'R5 n2 n3 1.5k', 'R6 n3 0 12', 'R7 n3 n4 1.5k', 'R8 n4 0 12', 'Rw n3 p 1u', 'Rvm p 0 1t'));
    expect([node(words, 'n3'), node(words, 'p'), node(words, 'n4')]).toEqual(['732.4 nV', '732.4 nV', '5.813 nV']);
    expect(current(words, 'R6')).toBe('61.04 nA from node n3 to ground through R6');
    expect(current(words, 'Rvm')).toBe('7.324e-19 A from node p to ground through Rvm');
    expect(noise(words)).toEqual([]);
    expect(note(words)).toBeUndefined();
    expect(by).toBe('exact');
  });

  it('with a diode, which the rule for other circuits decides, the same ladder keeps them too: a resistor\'s 0 proves nothing there', async () => {
    const { words, by } = await solved(lines('V1 n0 0 1.5', 'R1 n0 n1 1.5k', 'R2 n1 0 12', 'R3 n1 n2 1.5k', 'R4 n2 0 12', 'R5 n2 n3 1.5k', 'R6 n3 0 12', 'R7 n3 n4 1.5k', 'R8 n4 0 12', 'Rw n3 p 1u', 'Rvm p 0 1t', 'D1 0 n0 dmod', '.model dmod d'));
    expect([node(words, 'n3'), node(words, 'p')]).toEqual(['732.4 nV', '732.4 nV']);
    expect(current(words, 'Rvm')).toBe('7.324e-19 A from node p to ground through Rvm');
    expect(noise(words)).toEqual([]);
    expect(by).toBe('rule');
  });

  it('a divider read by a 1e20 Ω meter through a 100 Ω probe keeps its 240 nV', async () => {
    const { words } = await solved(lines('V1 in 0 24', 'R1 in mid 1g', 'R2 mid 0 10', 'Rp mid p 100', 'Rvm p 0 1e20'));
    expect([node(words, 'mid'), node(words, 'p')]).toEqual(['240 nV', '240 nV']);
    expect(current(words, 'R2')).toBe('24 nA from node mid to ground through R2');
    expect(noise(words)).toEqual([]);
  });

  it('a node a 1 nV source sets is at 1 nV, and the 37 fA that flows from it is shown', async () => {
    const { words } = await solved(lines('V1 top 0 1n', 'R1 top s 1', 'R2 s 0 1e20', 'Vm top v 0', 'R3 v 0 27k'));
    expect([node(words, 'top'), node(words, 's'), node(words, 'v')]).toEqual(['1 nV', '1 nV', '1 nV']);
    expect(current(words, 'R3')).toBe('37.04 fA from node v to ground through R3');
    expect(noise(words)).toEqual([]);
  });
});

describe('N2: a 0 that a large gain lifts above 1 pA is still 0, and so is every part it drives (C9o)', () => {
  const tia = (out: string): string => lines('V1 top 0 9', 'R1 top a 180k', 'R2 a 0 3.9meg', 'R3 top b 18k', 'R4 b 0 390k', 'R5 a m 4.7', 'Vm m b 0', out, 'Rl out 0 1k');

  it('an H of 1 GΩ reading a balanced bridge: out is 0 V and Rl carries 0 A, not 193.5 pA next to 0 V', async () => {
    const { words } = await solved(tia('H1 out 0 Vm 1g'));
    expect(noise(words)).toEqual(['R5', 'Vm', 'H1', 'Rl', 'node out']);
    expect(words.currents.find((c) => c.name === 'Rl')).toMatchObject({ value: 0, noise: -1.9350975899792844e-10 });
    expect(note(words)).toContain('Rl -1.935098e-10 A and node out -1.935098e-07 V.');
    expect(note(words)).not.toContain('below 1 pA');
  });

  it('an F of 1e6 copying its ammeter: F1 and its load carry 0 A, and out is 0 V', async () => {
    const { words } = await solved(tia('F1 0 out Vm 1e6'));
    expect(noise(words)).toEqual(['R5', 'Vm', 'F1', 'Rl', 'node out']);
    expect(words.currents.find((c) => c.name === 'F1')!.power).toBeUndefined();
  });

  it('an E of 1e6 reading the C9 bridge into 100 Ω; fed through 1 kΩ from 5 V it carries a real 5 mA at 0 V, so no power', async () => {
    const bridge = ['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', 'E1 out 0 a b 1e6'];
    const e = (await solved(lines(...bridge, 'Rl out 0 100'))).words;
    expect(noise(e)).toEqual(['R5', 'E1', 'Rl', 'node out']);
    const fed = (await solved(lines(...bridge, 'V2 x 0 5', 'Rx x out 1k'))).words;
    expect(noise(fed)).toEqual(['R5', 'node out']);
    const e1 = fed.currents.find((c) => c.name === 'E1')!;
    expect([e1.value, e1.noise, e1.power]).toEqual([0.005000000000931323, undefined, undefined]);
    expect(current(fed, 'Rx')).toBe('5 mA from node x to node out through Rx');
  });
});

describe('N3: noise of a 0 below 1 pA everywhere, or far more than 4 steps apart, is 0 too', () => {
  it('the C9 bridge fed by a 2 aA source (2A): R5 is 0 A with the note, and the source and the arms keep their attoamps', async () => {
    const { words } = await solved(lines('I1 0 top 2A', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k'));
    expect(noise(words)).toEqual(['R5']);
    expect(words.currents.find((c) => c.name === 'R5')).toMatchObject({ value: 0, noise: -7.888609052210118e-34 });
    expect(current(words, 'I1')).toBe('2 aA from ground to node top through I1');
  });

  it('a balanced bridge with a 1 µΩ wire in its middle branch: 153.7 pA is noise of 0, though above 1 pA', async () => {
    const { words } = await solved(lines('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'Rw a m 1u', 'R5 m b 1k'));
    expect(words.currents.find((c) => c.name === 'R5')).toMatchObject({ value: 0, noise: -1.5369233974382723e-10 });
  });

  it('r11-275: the two bridges ngspice leaves 8.8e7 steps apart show R6 and R13 as 0 A', async () => {
    const { words } = await solved(
      lines('V1 top1 0 3.3', 'R1 top1 a2 270', 'R2 a2 0 820k', 'R3 top1 b3 135', 'R4 b3 0 410k', 'R5 a2 m4 1u', 'R6 m4 b3 4.7meg', 'R7 top1 a5 390k', 'R8 a5 0 220k', 'R9 top1 b6 780k', 'R10 b6 0 440k', 'R11 a5 m7 0.1', 'R12 m7 b6 470', 'R13 b6 a5 1t'),
    );
    expect(noise(words)).toEqual(['R6', 'R12', 'R13']);
  });
});

describe('S1: a balanced circuit whose ends come out more than 4 steps apart (C9m)', () => {
  const arms = (v: string, r1: string, r2: string, r3: string, link: string): string =>
    lines(`V1 n1 0 ${v}`, `R1 n1 n2 ${r1}`, `R2 n2 n3 ${r2}`, `R3 n3 0 ${r3}`, `R4 n1 n4 ${r1}`, `R5 n4 n5 ${r2}`, `R6 n5 0 ${r3}`, `R7 n3 n5 ${link}`);

  it('two equal arms of three resistors and a link: the link carries 0 A, with the note (7, 9 and 7 steps)', async () => {
    for (const [text, gave] of [
      [arms('9', '15k', '330', '33k', '100k'), 6.217248937900877e-20],
      [arms('15', '4.7k', '100', '150k', '3.3k'), -4.8446095620006835e-18],
      [arms('10', '150k', '680', '150k', '470k'), -1.3228189229576335e-20],
    ] as const) {
      const { words } = await solved(text);
      expect(noise(words), text).toEqual(['R7']);
      expect(words.currents.find((c) => c.name === 'R7')!.noise).toBe(gave);
    }
  });

  it('a real current smaller than a 4-step rule could see is kept: a 1e15 Ω link across 495 nV carries 4.95e-22 A', async () => {
    const { words } = await solved(lines('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 10k', 'R4 b 0 10000.0022', 'R5 a b 1e15'));
    expect(noise(words)).toEqual([]);
    expect(words.currents.find((c) => c.name === 'R5')!.value).toBeCloseTo(-4.95e-22, 27);
  });
});

describe('S3: a source that copies or reads a 0 drives loads that carry 0 A, so the drawing keeps Kirchhoff\'s law', () => {
  const bridge = ['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k'];

  it('an F into two loads side by side, and into one load then two side by side; a G into two loads', async () => {
    const f = (await solved(lines(...bridge, 'R5 a m 1k', 'Vm m b 0', 'F1 0 out Vm 1000', 'R6 out 0 1k', 'R7 out 0 1k'))).words;
    expect(noise(f)).toEqual(['Vm', 'F1', 'R6', 'R7', 'node out']);
    const fsp = (await solved(lines(...bridge, 'R5 a m 1k', 'Vm m b 0', 'F1 0 out Vm 1000', 'R6 out x 1k', 'R7 x 0 1k', 'R8 x 0 2k'))).words;
    expect(noise(fsp)).toEqual(['Vm', 'F1', 'R6', 'R7', 'R8', 'node out', 'node x']);
    const g = (await solved(lines(...bridge, 'R5 a b 1k', 'G1 0 out a b 1m', 'R6 out 0 1k', 'R7 out 0 2k'))).words;
    expect(noise(g)).toEqual(['R5', 'G1', 'R6', 'R7', 'node out']);
  });

  it('the null exercise "find V2 so that no current flows through R3": R3 is 0 A and node x is 0 V', async () => {
    const { words } = await solved(lines('V1 a 0 3', 'R1 a x 5k', 'R2 x b 3k', 'V2 b 0 -1.8', 'R3 x 0 1k'));
    expect(noise(words)).toEqual(['R3', 'node x']);
    expect(sp(note(words)!)).toContain('the two ends of R3, node x and ground, are at the same voltage, 0 V; and node x is joined to ground');
  });
});

describe('N4: the note lists at most 4 values, the rest counted, never "and 1 more"', () => {
  /** The C9 bridge with a chain of `count` ammeters in its middle branch. */
  const chain = (count: number): string => {
    const l = ['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a m0 1k'];
    for (let k = 1; k <= count; k++) l.push(`Vm${k} m${k - 1} m${k} 0`);
    l.push(`Vlast m${count} b 0`);
    return lines(...l);
  };

  it('a bridge with 53 ammeters (60 parts): one short paragraph that names four values and counts the rest', async () => {
    const { words } = await solved(chain(53));
    const why = note(words)!;
    // R5's two ends are the same double, so ngspice gives it exactly 0: 54 values, 4 of them named.
    expect(why).toMatch(/^ngspice gave Vm1 \S+ A, Vm2 \S+ A, Vm3 \S+ A, Vm4 \S+ A and 50 more currents, each in the tables above\. /);
    expect(why.length).toBeLessThan(500);
  });

  it('five values are all listed', async () => {
    const why = note((await solved(chain(4))).words)!;
    expect(why).toMatch(/^ngspice gave Vm1 \S+ A, Vm2 \S+ A, Vm3 \S+ A, Vm4 \S+ A and Vlast \S+ A\. /);
    expect(why).not.toMatch(/more/);
  });
});

describe('code-6: the rule for other circuits looks again at a part when two groups of nodes join', () => {
  it('an E reading the C9 bridge, with a diode: R6 written before or after E1 gives the same words', async () => {
    const parts = ['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', 'E1 out 0 a b 1000'];
    const tail = ['D1 0 top dmod', '.model dmod d'];
    // R6 first: it is looked at before E1 joins node out to ground, and must be looked at again after.
    const first = await solved(lines('R6 out 0 1k', ...parts, ...tail));
    const last = await solved(lines(...parts, 'R6 out 0 1k', ...tail));
    expect([first.by, last.by]).toEqual(['rule', 'rule']);
    expect(noise(first.words).sort()).toEqual(['E1', 'R5', 'R6', 'node out']);
    expect(noise(last.words).sort()).toEqual(['E1', 'R5', 'R6', 'node out']);
  });
});

describe('S8: .tf and .dc in a circuit solved exactly give 0 where the circuit makes 0, and keep ngspice\'s numbers in their own columns (C9p)', () => {
  const bridge = ['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k'];
  const run = (...l: string[]): Promise<Awaited<ReturnType<typeof solveText>>> => solveText(`* t\n${l.join('\n')}\n.end\n`, ngspice);

  it('.tf v(a,b) V1 of the balanced bridge is 0 V/V, not -5.551e-17, with a note that gives ngspice\'s number', async () => {
    const { words } = await run(...bridge, 'R5 a b 1k', '.tf v(a,b) V1');
    expect(words.tf!.transferFunction).toMatchObject({ value: 0, noise: -5.551115123125783e-17, text: 'v(a,b)/V1 = 0 (V/V)' });
    expect(words.tf!.transferFunction!.speech).toContain('is 0 volts per volt');
    expect(sp(words.warnings.find((m) => m.code === 'rounding-noise')!.why)).toBe(
      "ngspice gave v(a,b)/V1 = -5.551115e-17. That is rounding noise, what its arithmetic leaves of a ratio that is 0: the voltage between node a and node b does not change when V1 changes. Solved exactly, with fractions, from the netlist's values, the circuit makes the ratio exactly 0, so PlainSpice shows 0 V/V.",
    );
    const i = await run(...bridge, 'R5 a m 1k', 'Vm m b 0', '.tf i(Vm) V1');
    expect(i.words.tf!.transferFunction).toMatchObject({ value: 0, noise: -2.710505431213761e-20 });
  });

  it('a real ratio far smaller than that noise is kept: 1 MΩ over 1e-12 Ω gives 1e-18 V/V, with no note', async () => {
    const { words } = await run('V1 in 0 1', 'R1 in out 1meg', 'R2 out 0 1e-12', '.tf v(out) V1');
    expect([words.tf!.transferFunction!.value, words.tf!.transferFunction!.noise]).toEqual([9.999999999999999e-19, undefined]);
    expect(words.warnings.some((m) => m.code === 'rounding-noise')).toBe(false);
  });

  it('.dc V1 0 9 3: i(vm) is 0 A at every point, in the words, the note and the Plot panel; its table and CSV keep ngspice\'s values beside them', async () => {
    const r = await run(...bridge, 'R5 a m 1k', 'Vm m b 0', '.dc V1 0 9 3');
    const sweep = r.words.sweeps[0]!;
    expect(sweep.final.find((f) => f.name === 'i(vm)')).toMatchObject({ value: 0, noise: -2.168404344971009e-19 });
    expect(sp(sweep.text)).toContain('i(vm) = 0 A');
    expect(sp(r.words.warnings.find((m) => m.code === 'rounding-noise')!.why)).toContain(
      'ngspice gave i(vm) -5.421011e-20 A at V1 = 3 V, i(vm) -1.084202e-19 A at V1 = 6 V and i(vm) -2.168404e-19 A at V1 = 9 V.',
    );
    const spec = plotSpecs(r.results, r.netlist)[0]!;
    const vm = spec.series.find((s) => s.label === 'i(vm)')!;
    expect(Array.from(vm.values)).toEqual([0, 0, 0, 0]);
    expect(Array.from(vm.given!)).toEqual([0, -5.421010862427522e-20, -1.0842021724855044e-19, -2.168404344971009e-19]);
    const table = tableRows(spec);
    expect(table.header).toContain('i(vm) as ngspice gave it (A)');
    expect(csvText(spec)).toContain('-2.168404344971009e-19');
    // The other lines have no second column: their values are ngspice's.
    expect(spec.series.filter((s) => s.given).map((s) => s.label)).toEqual(['i(vm)']);
  });

  it('.dc of a current source: the same for its noise; a sweep of two sources is left as ngspice gave it', async () => {
    const r = await run('I1 0 top 1m', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a m 1k', 'Vm m b 0', '.dc I1 0 1m 0.25m');
    expect(r.words.sweeps[0]!.final.find((f) => f.name === 'i(vm)')).toMatchObject({ value: 0, noise: -4.336808689942018e-19 });
    const two = await run(...bridge, 'V2 b2 0 1', 'R6 b2 0 1k', 'R5 a m 1k', 'Vm m b 0', '.dc V1 0 9 3 V2 0 1 1');
    expect(two.words.sweeps[0]!.final.every((f) => f.noise === undefined)).toBe(true);
  });
});

describe('speed: the exact solve keeps describeResults, which runs on the main thread after every run, quick (decision 0015)', () => {
  const E12 = [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
  /** Circuits from a fixed seed: a ladder, a ladder with ammeters, a random network of resistors, bridges side by side. */
  const circuits = (parts: number, seed: number): Record<string, string> => {
    let x = seed;
    const rnd = (): number => (x = (x * 16807) % 2147483647) / 2147483647;
    const rv = (): string => `${E12[Math.floor(rnd() * 12)]}${['', 'k', 'k', 'meg'][Math.floor(rnd() * 4)]}`;
    const ladder = ['V1 n0 0 10'];
    for (let k = 1; ladder.length + 2 <= parts; k++) ladder.push(`Ra${k} n${k - 1} n${k} ${rv()}`, `Rb${k} n${k} 0 ${rv()}`);
    const ammeters = ['V1 n0 0 10'];
    for (let k = 1; ammeters.length + 4 <= parts; k++) ammeters.push(`Ra${k} n${k - 1} n${k} ${rv()}`, `Rb${k} n${k} 0 ${rv()}`, `Vm${k} n${k} m${k} 0`, `Rc${k} m${k} 0 ${rv()}`);
    const nodes = Math.floor(parts / 3);
    const mesh = ['V1 n1 0 10'];
    for (let k = 2; k <= nodes; k++) mesh.push(`Rt${k} n${k} n${1 + Math.floor(rnd() * (k - 1))} ${rv()}`);
    for (let r = 1; mesh.length < parts; ) {
      const [a, b] = [1 + Math.floor(rnd() * nodes), Math.floor(rnd() * (nodes + 1))];
      if (a !== b) mesh.push(`Rx${r++} n${a} ${b === 0 ? '0' : `n${b}`} ${rv()}`);
    }
    const bridges = ['V1 top 0 9'];
    for (let k = 1; bridges.length + 5 <= parts; k++) {
      const [a, b] = [rv(), rv()];
      bridges.push(`R${k}a top a${k} ${a}`, `R${k}b a${k} 0 ${b}`, `R${k}c top b${k} ${a}`, `R${k}d b${k} 0 ${b}`, `R${k}e a${k} b${k} ${rv()}`);
    }
    return { ladder: ladder.join('\n'), ammeters: ammeters.join('\n'), mesh: mesh.join('\n'), bridges: bridges.join('\n') };
  };
  /** The least processor time of describeResults on a fresh copy of the netlist and the results, and how noise was decided. */
  const timed = async (text: string): Promise<{ ms: number; by: string }> => {
    const r = await solveText(text, ngspice);
    const [ms] = leastWorkMs([() => describeResults(parseNetlist(text), structuredClone(r.results), r.run)], 3);
    return { ms, by: r.results.op ? roundingNoise(r.netlist, r.results).by : 'sweep' };
  };

  it('a circuit of 60 parts is solved exactly in well under 50 ms, and with a .dc sweep of 1001 points too', async () => {
    for (const [name, body] of Object.entries(circuits(60, 7))) {
      const op = await timed(`* ${name}\n${body}\n.op\n.end\n`);
      expect(op.by, name).toBe('exact');
      expect(op.ms, name).toBeLessThan(50);
      const dc = await timed(`* ${name}\n${body}\n.dc V1 0 10 0.01\n.end\n`);
      expect(dc.ms, name).toBeLessThan(50);
    }
  });

  it('at the limits of the exact solve (a random network of 400 resistors on 133 nodes, about a second of work) it stops in time: under 200 ms, then the other rule decides', async () => {
    for (const seed of [7, 11]) {
      const { mesh } = circuits(400, seed);
      const op = await timed(`* mesh\n${mesh}\n.op\n.end\n`);
      expect(op.by, String(seed)).toBe('rule');
      expect(op.ms, String(seed)).toBeLessThan(200);
    }
  });
});

describe('the same-circuit check (exact.ts agrees), measured with the real engine: what it catches (decision 0015)', () => {
  /** One circuit with every kind of part; `o` changes the values ngspice is given, not the model's. */
  const circuit = (o: Record<string, string> = {}): string =>
    lines(`V1 top 0 ${o.V1 ?? '9'}`, 'R1 top a 10k', 'R2 a 0 10k', `I1 0 a ${o.I1 ?? '1m'}`, `E1 e 0 a 0 ${o.E1 ?? '2'}`, 'Re e 0 1k', 'Vm a m 0', 'Rm m 0 1k', `F1 0 f Vm ${o.F1 ?? '3'}`, 'Rf f 0 1k', `G1 0 g a 0 ${o.G1 ?? '1m'}`, 'Rg g 0 1k', `H1 h 0 Vm ${o.H1 ?? '100'}`, 'Rh h 0 1k', `V2 s top ${o.V2 ?? '1p'}`, 'Rs s 0 1meg');
  /** The model of the circuit as written, against ngspice's values for the circuit changed by `o`. */
  const check = async (o: Record<string, string>): Promise<{ agrees: boolean; equations: number; products: number }> => {
    const written = parseNetlist(circuit());
    const m = exactModel(written, written.lines.flatMap((l) => (l.element ? [l.element] : [])), readAfterEnd(written)) as ExactModel;
    const op = (await solveText(circuit(o), ngspice)).results.op!;
    const nodes = new Map(op.nodes.map((n) => [n.node, n.value]));
    const branch = new Map(op.currents.filter((c) => c.origin === 'branch').map((c) => [c.element, c.value]));
    const device = new Map(op.currents.filter((c) => c.origin === 'device').map((c) => [c.element, c.value]));
    const ng = { voltage: (n: string) => nodes.get(n), branch: (k: string) => branch.get(k), device: (k: string) => device.get(k) };
    const s = shares(m, ng, (p) => p.value)!;
    return { agrees: agrees(m, ng, (p) => p.value), equations: toDouble(s.equations), products: toDouble(s.products) };
  };

  it('ngspice\'s own run of the circuit agrees; each kind of value 1 ppm off does not', async () => {
    expect((await check({})).agrees).toBe(true);
    for (const o of [{ V1: '9.000009' }, { I1: '1.000001m' }, { E1: '2.000002' }, { F1: '3.000003' }, { G1: '1.000001m' }, { H1: '100.0001' }]) expect((await check(o)).agrees, JSON.stringify(o)).toBe(false);
    // R, F, G and I by their products; V, E and H by their own equations.
    expect((await check({ G1: '1.000001m' })).products).toBeGreaterThan(9e-7);
    expect((await check({ H1: '100.0001' })).equations).toBeGreaterThan(1e-9);
  });

  it('a small source is weighed against the circuit\'s largest voltage: 1 pV read as 1 nV passes, as 1 µV it does not (the values are read by ngspice\'s own grammar)', async () => {
    const nano = await check({ V2: '1n' });
    expect([nano.agrees, nano.equations < 1e-10]).toEqual([true, true]);
    expect((await check({ V2: '1u' })).agrees).toBe(false);
  });
});
