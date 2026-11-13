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
import { annotateLines, describeResults, roundingNoise, shownSweep, type ResultsInWords } from '../../src/spice/describe.ts';
import { add, agrees, answersGap, div, exactModel, fromDouble, MAX_PARTS, mul, operatingPoint, readExact, shares, solveExact, toDouble, type ExactModel, type Fraction } from '../../src/spice/exact.ts';
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
/** A line PlainSpice does not model exactly (decision 0015), so the rule for other circuits decides; ngspice runs at 27 °C anyway, so its numbers are the same. */
const RULE = '.temp 27';
async function solved(text: string): Promise<{ words: ResultsInWords; by: string }> {
  const r = await solveText(text, ngspice);
  return { words: r.words, by: roundingNoise(r.netlist, r.results).by };
}
/** The parts and nodes shown as noise of 0. */
const noise = (w: ResultsInWords): string[] => [...w.currents.filter((c) => c.noise !== undefined).map((c) => c.name), ...w.nodes.filter((n) => n.noise !== undefined).map((n) => `node ${n.node}`)];
const node = (w: ResultsInWords, name: string): string => sp(w.nodes.find((n) => n.node === name)!.text);
const current = (w: ResultsInWords, name: string): string => sp(w.currents.find((c) => c.name === name)!.text);
const note = (w: ResultsInWords): string | undefined => w.warnings.find((m) => m.code === 'rounding-noise')?.why;
/** The warning that ngspice's answers are off (opCheck 'imprecise'). */
const off = (w: ResultsInWords): { title: string; severity: string; why: string } | undefined => {
  const m = w.warnings.find((x) => x.code === 'imprecise-answers');
  return m && { title: m.title, severity: m.severity, why: sp(m.why ?? '') };
};

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

  it('with a diode, whose current the exact solution leaves free, the same ladder keeps them too; so does the rule for other circuits, which writes no node as 0 V (the critic of round 2)', async () => {
    const ladder = ['V1 n0 0 1.5', 'R1 n0 n1 1.5k', 'R2 n1 0 12', 'R3 n1 n2 1.5k', 'R4 n2 0 12', 'R5 n2 n3 1.5k', 'R6 n3 0 12', 'R7 n3 n4 1.5k', 'R8 n4 0 12', 'Rw n3 p 1u', 'Rvm p 0 1t'];
    const diode = await solved(lines(...ladder, 'D1 0 n0 dmod', '.model dmod d'));
    expect([diode.by, node(diode.words, 'n3'), node(diode.words, 'p'), current(diode.words, 'Rvm'), noise(diode.words)]).toEqual(['exact', '732.4 nV', '732.4 nV', '7.324e-19 A from node p to ground through Rvm', []]);
    // RULE: a line PlainSpice does not model exactly; ngspice runs it at its own temperature, so the numbers are the same.
    const { words, by } = await solved(lines(...ladder, RULE));
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

describe('code-6: the rule for other circuits gives the same words whatever the order of the lines', () => {
  it('an E reading the C9 bridge, decided by the rule: R6 written before or after E1 gives the same words; out keeps ngspice\'s −909.5 fV, so R6 and E1 keep their 909.5 aA, and R5 its 8.882e-19 A, the voltage E1 makes out from', async () => {
    const parts = ['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', 'E1 out 0 a b 1000'];
    // A 0 the rule writes depends only on ngspice's numbers and the 0s before it, which only add: groups of
    // joined nodes give levels only (the critic of round 2), so no part waits on a join to be looked at again.
    const first = await solved(lines('R6 out 0 1k', ...parts, RULE));
    const last = await solved(lines(...parts, 'R6 out 0 1k', RULE));
    expect([first.by, last.by]).toEqual(['rule', 'rule']);
    expect(noise(first.words)).toEqual([]);
    expect(noise(last.words)).toEqual([]);
    expect([node(first.words, 'out'), current(first.words, 'R6'), current(first.words, 'R5')]).toEqual(['−909.5 fV', '909.5 aA from ground to node out through R6', '8.882e-19 A from node b to node a through R5']);
    expect(first.words.currents.map((c) => c.text).sort()).toEqual(last.words.currents.map((c) => c.text).sort());
    const nodes = (w: ResultsInWords): string[] => w.nodes.map((n) => `${n.node} ${n.text} ${n.level}`).sort();
    expect(nodes(first.words)).toEqual(nodes(last.words));
    // The same circuit with a diode is solved exactly: out is 0 V, and R6 and E1 carry 0 A.
    const exact = await solved(lines('R6 out 0 1k', ...parts, 'D1 0 top dmod', '.model dmod d'));
    expect([exact.by, noise(exact.words).sort()]).toEqual(['exact', ['E1', 'R5', 'R6', 'node out']]);
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

describe('after the critic of round 2: .tf and .dc agree with the .op beside them', () => {
  const run = (...l: string[]): Promise<Awaited<ReturnType<typeof solveText>>> => solveText(`* t\n${l.join('\n')}\n.end\n`, ngspice);
  const tia = ['V1 top 0 9', 'R1 top a 180k', 'R2 a 0 3.9meg', 'R3 top b 18k', 'R4 b 0 390k', 'R5 a m 4.7', 'Vm m b 0', 'H1 out 0 Vm 1g', 'Rl out 0 1k'];

  it('the .tf of the bridge an H of 1 GΩ reads is 0 V/V, as its .op makes out 0 V for every V1: ngspice\'s −2.15e-8 is its rounding lifted by the gain; without an .op to show ngspice solved this circuit, a ratio that large is kept', async () => {
    const withOp = await run(...tia, '.op', '.tf v(out) V1');
    expect(withOp.words.tf!.transferFunction).toMatchObject({ value: 0, noise: -2.1500237300155906e-8, text: 'v(out)/V1 = 0 (V/V)' });
    expect(node(withOp.words, 'out')).toBe('0 V');
    expect(sp(withOp.words.warnings.filter((m) => m.code === 'rounding-noise').map((m) => m.why).join(' | '))).toContain('ngspice gave v(out)/V1 = -2.150024e-08. That is rounding noise');
    const current = await run(...tia, '.op', '.tf i(Vm) V1');
    expect(current.words.tf!.transferFunction).toMatchObject({ value: 0, noise: -2.1500237300155906e-17 });
    // The .tf alone: its three numbers are all there is to check, and −2.15e-8 is far above what rounding leaves of a ratio of about 1.
    const alone = await run(...tia, '.tf v(out) V1');
    expect([alone.words.tf!.transferFunction!.value, alone.words.tf!.transferFunction!.noise]).toEqual([-2.1500237300155906e-8, undefined]);
    // The E of 1e6 reading the C9 bridge, with its .op: 0 V/V, not −5.8e-11.
    const e = await run('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', 'E1 out 0 a b 1e6', 'Rl out 0 100', '.op', '.tf v(out) V1');
    expect(e.words.tf!.transferFunction).toMatchObject({ value: 0, noise: -5.820766091346741e-11 });
  });

  it('a .dc point where ngspice gives exactly 0 for a real current is the exact one, as the .op beside it: the 1 nΩ wire of C9n.4 carries 454.1 pA at V1 = 1.5 V in both, with ngspice\'s 0 in the Plot panel\'s own column', async () => {
    const r = await run('V1 top1 0 1.5', 'R1 top1 d2 270k', 'R2 d2 0 820', 'R3 d2 p3 1n', 'R4 p3 0 10meg', '.options savecurrents', '.op', '.dc V1 0 1.5 0.5');
    expect(current(r.words, 'R3')).toBe('454.1 pA from node d2 to node p3 through R3');
    const final = r.words.sweeps[0]!.final.find((f) => f.name === 'i(@r3[i])')!;
    expect(final).toMatchObject({ value: 4.5413907894834974e-10, given: 0 });
    expect(sp(r.words.sweeps[0]!.text)).toContain('i(@r3[i]) = 454.1 pA');
    const note = r.words.warnings.find((m) => m.code === 'rounded-to-0' && m.title.includes('DC sweep'))!;
    expect(sp(note.why)).toContain('PlainSpice shows each as the exact solution gives it, in these words and in the Plot panel: i(@r3[i]) 151.4 pA at V1 = 500 mV, i(@r3[i]) 302.8 pA at V1 = 1 V and i(@r3[i]) 454.1 pA at V1 = 1.5 V.');
    const spec = plotSpecs(r.results, r.netlist)[0]!;
    const r3 = spec.series.find((s) => s.label === 'i(@r3[i])')!;
    expect(Array.from(r3.values)).toEqual([0, 1.5137969298278324e-10, 3.027593859655665e-10, 4.5413907894834974e-10]);
    expect(Array.from(r3.given!)).toEqual([0, 0, 0, 0]);
    // R4, in series with it, keeps ngspice's own numbers, which agree.
    expect(spec.series.find((s) => s.label === 'i(@r4[i])')!.given).toBeUndefined();
  });

  it('past the first 2,000 such points of a long sweep the value is worked out in doubles from the exact a and b, to 8 digits or more, and the last point exactly', async () => {
    const r = await run('V1 top1 0 1.5', 'R1 top1 d2 270k', 'R2 d2 0 820', 'R3 d2 p3 1n', 'R4 p3 0 10meg', '.options savecurrents', '.dc V1 0 1.5 0.00025');
    const spec = plotSpecs(r.results, r.netlist)[0]!;
    const r3 = spec.series.find((s) => s.label === 'i(@r3[i])')!;
    const x = spec.x.values;
    // R3 carries v(d2) / (1n + 10meg), v(d2) being V1 × (820 ∥ (1n + 10meg)) / (270k + 820 ∥ (1n + 10meg)): in doubles, to about 1e-15.
    const exactAt = (k: number): number => { const vd2 = (x[k]! * (1 / (1 / 820 + 1 / (1e7 + 1e-9)))) / (270e3 + 1 / (1 / 820 + 1 / (1e7 + 1e-9))); return vd2 / (1e7 + 1e-9); };
    const given = r3.given!;
    let estimated = 0;
    for (let k = 1; k < x.length; k++) {
      if (given[k] !== 0) continue;
      estimated += 1;
      expect(Math.abs(r3.values[k]! - exactAt(k)) / exactAt(k), String(k)).toBeLessThan(1e-8);
    }
    expect(estimated).toBeGreaterThan(2000);
    // The last point exactly, at the x ngspice swept V1 to (its steps added in doubles), as the Plot panel draws it.
    const last = x.length - 1;
    const final = r.words.sweeps[0]!.final.find((f) => f.name === 'i(@r3[i])')!;
    expect([final.given, final.value]).toEqual([0, r3.values[last]]);
    expect(Math.abs(final.value - exactAt(last)) / exactAt(last)).toBeLessThan(1e-14);
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

  it('grids of resistors with 3-digit values, the slowest kind measured (the critic of the re-check\'s fixes: 226 ms for 9 × 9 with .op, .dc and .tf): under 200 ms, solved exactly or stopped by the counted work', async () => {
    let x = 11;
    const rnd = (): number => (x = (x * 16807) % 2147483647) / 2147483647;
    const value = (): string => `${(1 + rnd() * 8.99).toFixed(2)}${['', 'k', 'k', 'meg', 'm'][Math.floor(rnd() * 5)]}`;
    const grid = (side: number): string => {
      const l = ['V1 g0_0 0 10'];
      for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) {
        if (i + 1 < side) l.push(`Rv${i}_${j} g${i}_${j} g${i + 1}_${j} ${value()}`);
        if (j + 1 < side) l.push(`Rh${i}_${j} g${i}_${j} g${i}_${j + 1} ${value()}`);
      }
      return [...l, `Rg g${side - 1}_${side - 1} 0 ${value()}`].join('\n');
    };
    const ways: string[] = [];
    for (const side of [9, 10, 12]) {
      const op = await timed(`* grid\n${grid(side)}\n.op\n.dc V1 0 10 0.01\n.tf v(g0_1) V1\n.end\n`);
      expect(op.ms, String(side)).toBeLessThan(200);
      ways.push(op.by);
    }
    // The 12 × 12 grid is past the counted work.
    expect(ways[2]).toBe('rule');
  }, 60_000);

  it('parts side by side, which add no unknown: 1,000 resistors of prime values and 150 of 17 digits stay under 200 ms (the critic of round 2: 12.9 s and 390 ms), stopped by the size of one equation\'s denominator; past MAX_PARTS no value is even read', async () => {
    const primes: number[] = [];
    for (let k = 1009; primes.length < 1000; k += 2) if (primes.every((p) => k % p !== 0) && [3, 5, 7, 11, 13, 17, 19, 23, 29, 31].every((p) => k % p !== 0)) primes.push(k);
    const par = ['V1 a 0 9', ...primes.map((p, k) => `R${k} a 0 ${p}`)].join('\n');
    let x = 3;
    const digits = (): string => Array.from({ length: 17 }, (_, k) => String(k === 0 ? 1 + ((x = (x * 16807) % 2147483647) % 9) : (x = (x * 16807) % 2147483647) % 10)).join('');
    const long = ['V1 a 0 9', ...Array.from({ length: 150 }, (_, k) => `R${k} a 0 ${digits()}`)].join('\n');
    for (const [name, body] of [['par', par], ['long', long]]) {
      const op = await timed(`* ${name}\n${body}\n.op\n.end\n`);
      expect(op.by, name).toBe('rule');
      expect(op.ms, name).toBeLessThan(200);
    }
    // 200 resistors of prime values side by side are solved exactly, quickly, with a .dc sweep too.
    const some = ['V1 a 0 9', ...primes.slice(0, 200).map((p, k) => `R${k} a 0 ${p}`)].join('\n');
    const op = await timed(`* some\n${some}\n.op\n.dc V1 0 9 1\n.end\n`);
    expect([op.by, op.ms < 50]).toEqual(['exact', true]);
    expect(MAX_PARTS).toBe(1600);
    const many = parseNetlist(`* many\nV1 a 0 9\n${Array.from({ length: 1600 }, (_, k) => `R${k} a 0 1k`).join('\n')}\n.op\n.end\n`);
    const refused = exactModel(many, many.lines.flatMap((l) => (l.element ? [l.element] : [])), []);
    // Compared as words: a model that is not refused would be printed whole.
    expect(typeof refused === 'string' ? refused : 'modelled exactly').toBe('size');
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

  it('roundingNoise takes ngspice\'s run of another circuit for the other circuit\'s, even where its answers are within the page\'s digits: R2 1 ppm off is decided by the rule alone', async () => {
    const written = parseNetlist(circuit());
    const other = (await solveText(circuit().replace('R2 a 0 10k', 'R2 a 0 10.00001k'), ngspice)).results;
    const own = (await solveText(circuit(), ngspice)).results;
    expect(roundingNoise(written, own).by).toBe('exact');
    expect(roundingNoise(written, other).by).toBe('rule');
    // Within 5e-5 of the exact answers, so only the same-circuit check tells them apart.
    const m = exactModel(written, written.lines.flatMap((l) => (l.element ? [l.element] : [])), readAfterEnd(written)) as ExactModel;
    const nodes = new Map(other.op!.nodes.map((n) => [n.node, n.value]));
    const branch = new Map(other.op!.currents.filter((c) => c.origin === 'branch').map((c) => [c.element, c.value]));
    const ng = { voltage: (n: string) => nodes.get(n), branch: (k: string) => branch.get(k), device: () => undefined };
    expect(answersGap(m, solveExact(m, [operatingPoint(m)])![0]!, ng)!).toBeLessThan(5e-5);
  });

  it('a small source is weighed against the circuit\'s largest voltage: 1 pV read as 1 nV passes, as 1 µV it does not (the values are read by ngspice\'s own grammar)', async () => {
    const nano = await check({ V2: '1n' });
    expect([nano.agrees, nano.equations < 1e-10]).toEqual([true, true]);
    expect((await check({ V2: '1u' })).agrees).toBe(false);
  });
});

describe('after the critic of the re-check\'s fixes: what the exact solution may decide, and how fast', () => {
  const bridge = ['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k'];
  const run = (...l: string[]): Promise<Awaited<ReturnType<typeof solveText>>> => solveText(`* t\n${l.join('\n')}\n.end\n`, ngspice);
  const lost = (w: ResultsInWords): string[] => [...w.currents.filter((c) => c.given !== undefined).map((c) => c.name), ...w.nodes.filter((n) => n.given !== undefined).map((n) => `node ${n.node}`)];
  const lostNote = (w: ResultsInWords): string | undefined => w.warnings.find((m) => m.code === 'rounded-to-0')?.why;

  it('a value with a 9-digit exponent (V2 b 0 1e-999999999, which ngspice reads as 0) keeps every current, at once: it froze the page for 66 s and lost them', async () => {
    const text = lines('V1 a 0 9', 'R1 a 0 1k', 'V2 b 0 1e-999999999', 'R2 b 0 1k');
    const r = await solveText(text, ngspice);
    const [ms] = leastWorkMs([() => describeResults(parseNetlist(text), structuredClone(r.results), r.run)], 1);
    expect(ms).toBeLessThan(500);
    expect(r.words.currents.map((c) => sp(c.text))).toEqual(['9 mA from ground to node a through V1', '9 mA from node a to ground through R1', 'V2 measures no current', 'no current through R2']);
    // The word is no double, so the circuit is not modelled exactly: the rule decides.
    expect(roundingNoise(r.netlist, r.results).by).toBe('rule');
  });

  it('ngspice\'s answers far from the exact ones (a 1e-12 Ω wire in a balanced bridge: 4.321 V and 4.374 V for 4.5 V) are shown as ngspice gives them, no 0 beside them, with a warning that gives the exact values', async () => {
    const { words, by } = await solved(lines(...bridge, 'Rw a m 1e-12', 'R5 m b 1k'));
    expect(by).toBe('rule');
    expect([node(words, 'a'), node(words, 'm'), node(words, 'b')]).toEqual(['4.321 V', '4.321 V', '4.374 V']);
    expect(current(words, 'R5')).toBe('53.56 µA from node b to node m through R5');
    expect(noise(words)).toEqual([]);
    expect(note(words)).toBeUndefined();
    expect(off(words)).toEqual({ title: 'Some of ngspice\'s answers here are off', severity: 'warning', why: 'Solved exactly, with fractions, from the netlist\'s values, R5 carries no current, where ngspice gives 53.56 µA; R1 carries 450 µA, where ngspice gives 467.9 µA; node a is at 4.5 V, where ngspice gives 4.321 V; node m is at 4.5 V, where ngspice gives 4.321 V; and 5 more. ngspice computes with about 16 significant digits, and solving this circuit loses most of them. PlainSpice shows ngspice\'s numbers as it gives them, so they may not agree with each other.' });
    // A bridge with a 1 nΩ wire read by a G of 1000: G1's 13.84 mA, ngspice's, not 0 A next to it.
    const g = await solved(lines('V1 top1 0 15', 'R1 top1 s2 1u', 'R2 s2 0 1meg', 'R3 s2 a3 2.7meg', 'R4 a3 0 3.9k', 'R5 s2 b4 2.7meg', 'R6 b4 0 3.9k', 'R7 a3 m5 1n', 'R8 m5 b4 1meg', 'G1 0 g6 a3 b4 1e3', 'R9 g6 0 1.2k'));
    expect([g.by, current(g.words, 'G1'), node(g.words, 'g6'), noise(g.words)]).toEqual(['rule', '13.84 mA from ground to node g6 through G1', '16.61 V', []]);
    expect(off(g.words)?.why).toContain('node g6 is at 0 V, where ngspice gives 16.61 V;');
  });

  it('ngspice\'s answers off at a few millivolts beside a 12 or 15 V source are compared too (round 1\'s bridges with two resistors changed): ngspice\'s 2.097 V and 82.78 mV are shown, never called rounding noise (the critic of round 2)', async () => {
    // C9s.2 with R4 and R6 at 1.8k: a3 and b4 at 10 mV, where ngspice is 1.75 µV apart.
    const g = await solved(lines('V1 top1 0 15', 'R1 top1 s2 1u', 'R2 s2 0 1meg', 'R3 s2 a3 2.7meg', 'R4 a3 0 1.8k', 'R5 s2 b4 2.7meg', 'R6 b4 0 1.8k', 'R7 a3 m5 1n', 'R8 m5 b4 1meg', 'G1 0 g6 a3 b4 1e3', 'R9 g6 0 1.2k'));
    expect([g.by, node(g.words, 'g6'), current(g.words, 'G1'), current(g.words, 'R9'), noise(g.words), note(g.words)]).toEqual(['rule', '2.097 V', '1.747 mA from ground to node g6 through G1', '1.747 mA from node g6 to ground through R9', [], undefined]);
    expect(sp(off(g.words)!.why)).toContain('node g6 is at 0 V, where ngspice gives 2.097 V; G1 carries no current, where ngspice gives 1.747 mA; R9 carries no current, where ngspice gives 1.747 mA; R8 carries no current, where ngspice gives 1.747 pA; and 3 more.');
    // A 1000:1 divider into the C9 bridge with a 10 pΩ wire, read by an E of 1000: out is ngspice's −82.78 mV.
    const e = await solved(lines('V1 top 0 12', 'Rd1 top s 999k', 'Rd2 s 0 1k', 'R1 s a 10k', 'R2 a 0 10k', 'R3 s b 4.7k', 'R4 b 0 4.7k', 'Rw a m 10p', 'R5 m b 1k', 'E1 out 0 a b 1000', 'Rl out 0 10k'));
    expect([e.by, node(e.words, 'a'), node(e.words, 'out'), current(e.words, 'E1'), current(e.words, 'Rl'), noise(e.words)]).toEqual(['rule', '4.882 mV', '−82.78 mV', '8.278 µA from node out to ground through E1', '8.278 µA from ground to node out through Rl', []]);
    expect(sp(off(e.words)!.why)).toContain('node out is at 0 V, where ngspice gives −82.78 mV; E1 carries no current, where ngspice gives 8.278 µA; Rl carries no current, where ngspice gives 8.278 µA; Rw carries no current, where ngspice gives 86.74 nA; and 10 more.');
  });

  it('where ngspice\'s answers are off, every number is ngspice\'s and the warning names the resistors\' currents that are off too: the unbalanced bridge with a 1e-12 Ω wire shows ngspice\'s Rw 0 A in series with R5\'s 53.56 µA, and the warning says both carry 46.46 µA, R5 the other way (the critic of round 2)', async () => {
    // C9s with R2 12k: ngspice gives a = m = 4.321 V and Rw exactly 0 A; the circuit makes a = m = 4.656 V and 46.46 µA from m to b.
    const { words, by } = await solved(lines('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 12k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'Rw a m 1e-12', 'R5 m b 1k'));
    expect([by, current(words, 'Rw'), current(words, 'R5'), node(words, 'a')]).toEqual(['rule', 'no current through Rw', '53.56 µA from node b to node m through R5', '4.321 V']);
    expect(words.currents.filter((c) => c.given !== undefined || c.noise !== undefined)).toEqual([]);
    expect(off(words)!.why).toBe('Solved exactly, with fractions, from the netlist\'s values, R5 carries 46.46 µA, where ngspice gives 53.56 µA the other way; Rw carries 46.46 µA, where ngspice gives 0 A; R1 carries 434.4 µA, where ngspice gives 467.9 µA; node a is at 4.656 V, where ngspice gives 4.321 V; and 6 more. ngspice computes with about 16 significant digits, and solving this circuit loses most of them. PlainSpice shows ngspice\'s numbers as it gives them, so they may not agree with each other.');
  });

  it('a real current ngspice gives as exactly 0 is the exact one, with ngspice\'s 0 in `given` and a note: a 1 nΩ wire in series with 10 MΩ carries 454.1 pA, as the 10 MΩ does', async () => {
    const { words, by } = await solved(lines('V1 top1 0 1.5', 'R1 top1 d2 270k', 'R2 d2 0 820', 'R3 d2 p3 1n', 'R4 p3 0 10meg'));
    expect(by).toBe('exact');
    expect(current(words, 'R3')).toBe('454.1 pA from node d2 to node p3 through R3');
    expect(current(words, 'R4')).toBe('454.1 pA from node p3 to ground through R4');
    expect(words.currents.find((c) => c.name === 'R3')).toMatchObject({ given: 0, value: 4.5413907894834974e-10, across: 4.541390789483498e-19 });
    expect(lost(words)).toEqual(['R3']);
    expect(noise(words)).toEqual([]);
    expect(sp(lostNote(words)!)).toBe(
      "ngspice gave R3 exactly 0 A. But a current flows through R3: the 4.541e-19 V across it is too small beside the 4.541 mV at its ends, node d2 and node p3, for ngspice's arithmetic (about 16 significant digits), so both ends come out as the same number. Solved exactly, with fractions, from the netlist's values, R3 carries 454.1 pA, so PlainSpice shows 454.1 pA.",
    );
    expect(words.warnings.find((m) => m.code === 'rounded-to-0')).toMatchObject({ severity: 'note', title: "R3's current is not 0, though ngspice gave 0", line: 5 });
  });

  it('N1\'s ladder: the 1 µΩ wire in series with the 1 TΩ meter carries the meter\'s 7.324e-19 A, not "no current"; so do the divider\'s probe and the 1 nV source\'s 1 Ω', async () => {
    const ladder = (await solved(lines('V1 n0 0 1.5', 'R1 n0 n1 1.5k', 'R2 n1 0 12', 'R3 n1 n2 1.5k', 'R4 n2 0 12', 'R5 n2 n3 1.5k', 'R6 n3 0 12', 'R7 n3 n4 1.5k', 'R8 n4 0 12', 'Rw n3 p 1u', 'Rvm p 0 1t'))).words;
    expect([current(ladder, 'Rw'), current(ladder, 'Rvm')]).toEqual(['7.324e-19 A from node n3 to node p through Rw', '7.324e-19 A from node p to ground through Rvm']);
    expect(lost(ladder)).toEqual(['Rw']);
    const divider = (await solved(lines('V1 in 0 24', 'R1 in mid 1g', 'R2 mid 0 10', 'Rp mid p 100', 'Rvm p 0 1e20'))).words;
    expect([current(divider, 'Rp'), lost(divider)]).toEqual(['2.4e-27 A from node mid to node p through Rp', ['Rp']]);
    const source = (await solved(lines('V1 top 0 1n', 'R1 top s 1', 'R2 s 0 1e20', 'Vm top v 0', 'R3 v 0 27k'))).words;
    expect([current(source, 'R1'), lost(source)]).toEqual(['1e-29 A from node top to node s through R1', ['R1']]);
  });

  it('a .dc point is judged at the value ngspice swept the source to: "-1 1 0.1" reaches −1.39e-16 V, where v(a) follows V1 and is real, so no note (it said v(a) was noise at "V1 = 0 V")', async () => {
    const r = await run('V1 a 0 0', 'R1 a b 1k', 'R2 b 0 2k', '.dc V1 -1 1 0.1');
    expect(r.results.dc!.scale.values[10]).toBe(-1.3877787807814457e-16);
    expect(r.words.warnings.some((m) => m.code === 'rounding-noise')).toBe(false);
    const spec = plotSpecs(r.results, r.netlist)[0]!;
    expect(spec.series.find((s) => s.label === 'v(a)')!.values[10]).toBe(-1.3877787807814457e-16);
    expect(spec.series.some((s) => s.given)).toBe(false);
  });

  it('a sweep of 99,999 points is decided with no fractions at each point: describeResults stays well under 50 ms (it took 705 ms at 100,000)', async () => {
    const r = await run(...bridge, 'R5 a m 1k', 'Vm m b 0', '.dc V1 0 9.9998 0.0001');
    const points = r.results.dc!.scale.values.length;
    expect(points).toBeGreaterThan(99_990);
    const text = `* t\n${[...bridge, 'R5 a m 1k', 'Vm m b 0', '.dc V1 0 9.9998 0.0001'].join('\n')}\n.end\n`;
    const [ms] = leastWorkMs([() => describeResults(parseNetlist(text), structuredClone(r.results), r.run)], 3);
    expect(ms).toBeLessThan(50);
    const why = sp(r.words.warnings.find((m) => m.code === 'rounding-noise')!.why);
    expect(why).toMatch(/^ngspice gave i\(vm\) \S+ A at V1 = 100 µV, i\(vm\) \S+ A at V1 = 200 µV, i\(vm\) \S+ A at V1 = 300 µV, i\(vm\) \S+ A at V1 = 400 µV and \d+ more, each in the Plot panel's table\. /);
    expect(r.words.sweeps[0]!.final.find((f) => f.name === 'i(vm)')).toMatchObject({ value: 0 });
  }, 60_000);

  it('doctored .dc results are not this circuit\'s: a point shifted by 1e-6 V or a value 1 ppm off keeps ngspice\'s numbers', async () => {
    const r = await run(...bridge, 'R5 a m 1k', 'Vm m b 0', '.dc V1 0 9 3');
    expect(shownSweep(r.netlist, r.results)).not.toBe(r.results.dc);
    const shifted = structuredClone(r.results);
    shifted.dc!.scale.values[3] = 9.000001;
    expect(shownSweep(r.netlist, shifted)).toBe(shifted.dc);
    const off = structuredClone(r.results);
    const va = off.dc!.series.find((s) => s.name === 'v(a)')!;
    va.values[3] = va.values[3]! * (1 + 1e-6);
    expect(shownSweep(r.netlist, off)).toBe(off.dc);
  });

  it('doctored .tf results are not this circuit\'s: an input or output resistance 1 % off, or a ratio far above what rounding leaves, keeps ngspice\'s ratio', async () => {
    const r = await run(...bridge, 'R5 a b 1k', '.tf v(a,b) V1');
    const ratio = (results: typeof r.results): number | undefined => describeResults(r.netlist, results, r.run).tf!.transferFunction!.noise;
    expect(ratio(structuredClone(r.results))).toBe(-5.551115123125783e-17);
    const inR = structuredClone(r.results);
    inR.tf!.inputImpedance!.value *= 1.01;
    expect(ratio(inR)).toBeUndefined();
    const outR = structuredClone(r.results);
    outR.tf!.outputImpedance!.value *= 1.01;
    expect(ratio(outR)).toBeUndefined();
    const big = structuredClone(r.results);
    big.tf!.transferFunction = 1e-3;
    expect(ratio(big)).toBeUndefined();
  });

  it('the rule for other circuits writes no node as 0 V: the H of 1 GΩ keeps out at −193.5 nV beside Rl\'s 193.5 pA, and Vm its −193.5 aA, which H1 makes them from; with a diode it is solved exactly: all 0 (the critic of round 2)', async () => {
    const tia = ['V1 top 0 9', 'R1 top a 180k', 'R2 a 0 3.9meg', 'R3 top b 18k', 'R4 b 0 390k', 'R5 a m 4.7', 'Vm m b 0', 'H1 out 0 Vm 1g', 'Rl out 0 1k'];
    const { words, by } = await solved(lines(...tia, RULE));
    expect(by).toBe('rule');
    expect(node(words, 'out')).toBe('−193.5 nV');
    expect(current(words, 'Rl')).toBe('193.5 pA from ground to node out through Rl');
    // H1's two ends are shown at different voltages, so the current it makes them from is real, and so is R5's in series with it.
    expect(current(words, 'Vm')).toBe('Vm measures 193.5 aA flowing from node b to node m');
    expect(noise(words)).toEqual([]);
    // m and b are one level (Vm is a 0 V source); a is not, R5 showing its 378 aA; out shares no level, ground's least.
    const level = (n: string): number | undefined => words.nodes.find((x) => x.node === n)!.level;
    expect([level('m') === level('b'), level('m') !== undefined, level('a') === level('m')]).toEqual([true, true, false]);
    expect(words.nodes.filter((n) => n.level === level('out')).map((n) => n.node)).toEqual(['out']);
    expect(level('out')).not.toBe(0);
    const diode = await solved(lines(...tia, 'D1 0 top dmod', '.model dmod d'));
    expect([diode.by, node(diode.words, 'out'), current(diode.words, 'Rl'), noise(diode.words).sort()]).toEqual(['exact', '0 V', 'no current through Rl', ['H1', 'R5', 'Rl', 'Vm', 'node out']]);
  });
});

describe('after the critic of the re-check\'s fixes: where ngspice\'s answers are farther off, the rule decides, helped by the exact solution', () => {
  const lost = (w: ResultsInWords): string[] => w.currents.filter((c) => c.given !== undefined).map((c) => c.name);

  it('V1 of 100 V through 1 Ω and 1e20 Ω: ngspice gives the 1 aA in V1 and R1 as exactly 0, and every other value as the exact one, so the run is decided exactly and both show their exact 1 aA, as R2 does: Kirchhoff\'s law holds (the critic of round 3; the warning sat beside "no current" for both)', async () => {
    const { words, by } = await solved(lines('V1 top1 0 100', 'R1 top1 s2 1', 'R2 s2 0 1e20'));
    expect(by).toBe('exact');
    expect([current(words, 'V1'), current(words, 'R1'), current(words, 'R2')]).toEqual(['1 aA from ground to node top1 through V1', '1 aA from node top1 to node s2 through R1', '1 aA from node s2 to ground through R2']);
    expect(lost(words)).toEqual(['V1', 'R1']);
    expect(words.warnings.find((m) => m.code === 'rounded-to-0')).toBeDefined();
    expect(off(words)).toBeUndefined();
  });

  it('V1 of 1 µV through 1 mΩ and 10 TΩ: ngspice gives V1 217 zA where the circuit makes 100 zA; the rule alone would call V1 and R1 noise (R1\'s ends are one double), the exact solution keeps them as ngspice gives them', async () => {
    const { words, by } = await solved(lines('V1 top1 0 1u', 'R1 top1 s2 1m', 'R2 s2 0 1e13'));
    expect(by).toBe('rule');
    expect(noise(words)).toEqual([]);
    expect([current(words, 'V1'), current(words, 'R1')]).toEqual(['2.168e-19 A from ground to node top1 through V1', '2.118e-19 A from node top1 to node s2 through R1']);
  });

  it('a part with no current of its own between two nodes at one level says 0 V across it: a diode across an E that reads the balanced bridge, solved exactly; by the rule, x and y keep ngspice\'s numbers, 909.5 fV apart', async () => {
    const circuit = ['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', 'V2 x 0 5', 'E1 x y a b 1000', 'Ry y 0 1k', 'D1 x y dmod', '.model dmod d'];
    const r = await solveText(lines(...circuit), ngspice);
    expect(roundingNoise(r.netlist, r.results).by).toBe('exact');
    // ngspice leaves y 8.9e-13 V below x; E1 makes exactly 0 V, whatever current the diode carries (its control, a and b, is exactly 0).
    expect(r.results.op!.nodes.find((n) => n.node === 'y')!.value).not.toBe(5);
    const d1 = annotateLines(r.netlist, r.results, r.run).find((a) => a.line === 11)!;
    expect(sp(d1.text)).toBe('0 V across');
    const rule = await solveText(lines(...circuit, RULE), ngspice);
    expect(roundingNoise(rule.netlist, rule.results).by).toBe('rule');
    expect(sp(annotateLines(rule.netlist, rule.results, rule.run).find((a) => a.line === 11)!.text)).toBe('−909.5 fV across');
  });
});

describe('after the critic of round 2 of the re-check\'s fixes: every run of a netlist is checked with the same budget', () => {
  it('the same text run three times (Run pressed again, or an undo back to it: readNetlist gives the same parsed netlist) is decided the same way each time; with one budget kept for the netlist, the second run lost its sweep\'s note and the third its 0s', async () => {
    const primes: number[] = [];
    for (let k = 1009; primes.length < 200; k += 2) if (primes.every((p) => k % p !== 0) && [3, 5, 7, 11, 13, 17, 19, 23, 29, 31].every((p) => k % p !== 0)) primes.push(k);
    const text = `* the bridge of C9o.2 beside 200 resistors of prime values, swept\n${['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', 'E1 out 0 a b 1e6', 'Rl out 0 100', ...primes.map((p, k) => `Rp${k} top 0 ${p}`)].join('\n')}\n.op\n.dc V1 0 9 1\n.end\n`;
    const said = (w: ResultsInWords): unknown[] => [w.warnings.map((m) => m.code), current(w, 'E1'), node(w, 'out'), sp(w.sweeps[0]!.text).slice(0, 400)];
    const runs: unknown[][] = [];
    for (let k = 0; k < 3; k++) runs.push(said((await solveText(text, ngspice)).words));
    expect(runs[0]!.slice(0, 3)).toEqual([['rounding-noise', 'rounding-noise'], 'no current through E1', '0 V']);
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  });
});

describe('after the critic of round 2: a test for every safeguard of the exact solution and of the rule', () => {
  const lostNote = (w: ResultsInWords): string | undefined => w.warnings.find((m) => m.code === 'rounded-to-0')?.why;
  const near = ['V1 top1 0 10', 'R1 top1 a2 2.7', 'R2 a2 0 3900000', 'R3 top1 b3 10.8', 'R4 b3 0 15600000.000156'];

  it('a node voltage ngspice gives as exactly 0 though the circuit makes it real is the exact one: an E of 1e6 reads a bridge 1e-11 off balance, whose two ends ngspice gives as one double, so e4 is −69.23 pV, not 0 V beside R5\'s 20.98 aA', async () => {
    const { words, by } = await solved(lines(...near, 'E1 e4 0 a2 b3 1e6', 'R5 e4 0 3.3meg'));
    expect(by).toBe('exact');
    expect([node(words, 'e4'), words.nodes.find((n) => n.node === 'e4')!.given]).toEqual(['−69.23 pV', 0]);
    expect([current(words, 'R5'), current(words, 'E1')]).toEqual(['20.98 aA from ground to node e4 through R5', '20.98 aA from node e4 to ground through E1']);
    expect(sp(lostNote(words)!)).toContain('PlainSpice shows each as the exact solution gives it: E1 20.98 aA, R5 20.98 aA and node e4 −69.23 pV.');
  });

  it('the rounded-to-0 note names at most 4 values, the rest counted, in both its lists: three such E give 6 currents and 3 node voltages', async () => {
    const { words } = await solved(lines(...near, 'E1 e4 0 a2 b3 1e6', 'R5 e4 0 3.3meg', 'E2 e5 0 a2 b3 1e6', 'R6 e5 0 3.3meg', 'E3 e6 0 a2 b3 1e6', 'R7 e6 0 3.3meg'));
    expect(sp(lostNote(words)!)).toBe(
      'ngspice gave exactly 0 for E1, R5, E2, R6 and 2 more currents and 3 node voltages, each in the tables above. Each is too small beside the larger numbers ngspice works them out from for its arithmetic (about 16 significant digits), so they come out as 0. Solved exactly, with fractions, from the netlist\'s values, none of them is 0, so PlainSpice shows each as the exact solution gives it: E1 20.98 aA, R5 20.98 aA, E2 20.98 aA, R6 20.98 aA and 2 more currents and 3 node voltages, each in the tables above.',
    );
  });

  it('a value below the smallest double has no number to show and stays 0, with no note claiming it is not 0: the far end of a chain of 30 dividers of 1e12 over 1', async () => {
    const chain = Array.from({ length: 30 }, (_, k) => `Rs${k} n${k} n${k + 1} 1e12\nRg${k} n${k + 1} 0 1`);
    const { words, by } = await solved(lines('V1 n0 0 1', ...chain, '.options savecurrents'));
    expect(by).toBe('exact');
    expect([node(words, 'n26'), node(words, 'n27'), current(words, 'Rs26'), current(words, 'Rg29')]).toEqual(['1e-312 V', '0 V', 'no current through Rs26', 'no current through Rg29']);
    expect(lostNote(words)).toBeUndefined();
    expect(words.currents.filter((c) => c.given !== undefined)).toEqual([]);
  });

  it('a sweep point is noise only where ngspice\'s x is the root exactly: v(x) = 3·V1 − 1 swept by steps of 0.3333333333333333 reaches the double nearest 1/3, where v(x) is a real −55.51 aV that ngspice gives as 0', async () => {
    const r = await solveText('* t\nV1 a 0 0\nRa a 0 1k\nE1 y 0 a 0 3\nRy y 0 1k\nV2 c 0 1\nE2 x 0 y c 1\nRx x 0 1k\n.dc V1 0 1 0.3333333333333333\n.end\n', ngspice);
    expect(r.results.dc!.scale.values[1]).toBe(1 / 3);
    const spec = plotSpecs(r.results, r.netlist)[0]!;
    const x = spec.series.find((s) => s.label === 'v(x)')!;
    expect([x.values[1], x.given?.[1]]).toEqual([-5.551115123125783e-17, 0]);
    expect(sp(r.words.warnings.find((m) => m.code === 'rounded-to-0')!.why)).toContain('v(x) −55.51 aV at V1 = 333.3 mV');
  });

  it('a sweep of the H of 1 GΩ reading a balanced bridge: out is 0 V at every point, though its noise (−193.5 nV at 9 V) is far above what rounding leaves beside the 9 V: an exact 0 is not held to that', async () => {
    const r = await solveText('* t\nV1 top 0 9\nR1 top a 180k\nR2 a 0 3.9meg\nR3 top b 18k\nR4 b 0 390k\nR5 a m 4.7\nVm m b 0\nH1 out 0 Vm 1g\nRl out 0 1k\n.dc V1 0 9 3\n.end\n', ngspice);
    expect(r.words.sweeps[0]!.final.find((f) => f.name === 'v(out)')).toMatchObject({ value: 0, noise: -1.9350975899792844e-7 });
    const out = plotSpecs(r.results, r.netlist)[0]!.series.find((s) => s.label === 'v(out)')!;
    expect(Array.from(out.values)).toEqual([0, 0, 0, 0]);
  });

  it('with a diode, ngspice\'s exactly 0 is kept: two equal diode arms leave a and b one double, and R5 between them is ngspice\'s 0 A, not a value worked out from the diodes\' currents, which only ngspice\'s rounding gives', async () => {
    const { words, by } = await solved(lines('V1 top 0 9', 'D1 top a dmod', 'R2 a 0 10k', 'D2 top b dmod', 'R4 b 0 10k', 'R5 a b 1k', '.model dmod d'));
    expect(by).toBe('exact');
    expect(current(words, 'R5')).toBe('no current through R5');
    expect(words.currents.filter((c) => c.given !== undefined || c.noise !== undefined)).toEqual([]);
    expect(lostNote(words)).toBeUndefined();
  });

  it('a diode with 0 V across it carries 0 A only when no other diode\'s current changes that voltage: D2 feeds node a of a balanced bridge, so D1 in its middle branch has a real voltage, and R5 its real 31.37 fA', async () => {
    const { words, by } = await solved(lines('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'D1 a m dmod', 'R5 m b 1k', 'D2 top q dmod', 'Rq q a 1meg', '.model dmod d'));
    expect(by).toBe('exact');
    expect(current(words, 'R5')).toBe('31.37 fA from node m to node b through R5');
    expect(noise(words)).toEqual([]);
  });

  it('the critic of round 2\'s four circuits with a diode are decided exactly: what the F of 1e6, the H of 1 GΩ and the E of 1e6 make of a balanced bridge is exactly 0, and the fed E carries its 5 mA at 0 V with no power; with a .temp line instead, the rule shows ngspice\'s numbers, which agree with each other', async () => {
    const tia = ['V1 top 0 9', 'R1 top a 180k', 'R2 a 0 3.9meg', 'R3 top b 18k', 'R4 b 0 390k', 'R5 a m 4.7', 'Vm m b 0'];
    const c9 = ['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k'];
    const diode = ['D1 0 top dmod', '.model dmod d'];
    const f = await solved(lines(...tia, 'F1 0 out Vm 1e6', 'Rl out 0 1k', ...diode));
    expect([f.by, current(f.words, 'Vm'), current(f.words, 'F1'), node(f.words, 'out'), noise(f.words)]).toEqual(['exact', 'Vm measures no current', 'no current through F1', '0 V', ['R5', 'Vm', 'F1', 'Rl', 'node out']]);
    const h = await solved(lines(...tia, 'H1 out 0 Vm 1g', 'Rl out 0 1k', ...diode));
    expect([h.by, node(h.words, 'out'), noise(h.words)]).toEqual(['exact', '0 V', ['R5', 'Vm', 'H1', 'Rl', 'node out']]);
    const fed = await solved(lines(...c9, 'E1 out 0 a b 1e6', 'V2 x 0 5', 'Rx x out 1k', ...diode));
    expect([fed.by, node(fed.words, 'out'), current(fed.words, 'E1'), fed.words.currents.find((c) => c.name === 'E1')!.power]).toEqual(['exact', '0 V', '5 mA from node out to ground through E1', undefined]);
    const e = await solved(lines(...c9, 'E1 out 0 a b 1e6', 'Rl out 0 100', ...diode));
    expect([e.by, node(e.words, 'out'), noise(e.words)]).toEqual(['exact', '0 V', ['R5', 'E1', 'Rl', 'node out']]);
    // The rule: E1 into 100 Ω shows ngspice's 9.313 pA beside out's −931.3 pV, as Ohm's law on the page wants,
    // and R5 keeps ngspice's 8.882e-19 A: E1 makes out from the voltage across it, so it is not 0 A on the page.
    const rule = await solved(lines(...c9, 'E1 out 0 a b 1e6', 'Rl out 0 100', RULE));
    expect([rule.by, node(rule.words, 'out'), current(rule.words, 'E1'), current(rule.words, 'Rl'), current(rule.words, 'R5'), noise(rule.words)]).toEqual(['rule', '−931.3 pV', '9.313 pA from node out to ground through E1', '9.313 pA from ground to node out through Rl', '8.882e-19 A from node b to node a through R5', []]);
  });

  it('a node whose only DC path goes through a diode has no single answer with the diode\'s current left free: the circuit is left to the rule (a G drives R6 and D1 in series to ground)', async () => {
    const { by } = await solved(lines('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', 'G1 0 out a b 1m', 'R6 out x 1k', 'D1 x 0 dmod', '.model dmod d'));
    expect(by).toBe('rule');
  });

  it('diodes side by side make a loop of diodes: one of them stands for both (their currents reach the rest of the circuit only as one), so the circuit is still solved exactly', async () => {
    const { words, by } = await solved(lines('V1 top 0 9', 'R1 top a 180k', 'R2 a 0 3.9meg', 'R3 top b 18k', 'R4 b 0 390k', 'R5 a m 4.7', 'Vm m b 0', 'H1 out 0 Vm 1g', 'Rl out 0 1k', 'D1 top x dmod', 'D2 top x dmod', 'Rx x 0 1k', '.model dmod d'));
    expect([by, node(words, 'out'), current(words, 'Rl')]).toEqual(['exact', '0 V', 'no current through Rl']);
  });

  it('a sweep of a circuit with a diode keeps every value the diode\'s current changes as ngspice gives it, even where that current is too small for the check of ngspice\'s values to see: R5 keeps its real −65.73 fA at 9 V, which a model without the diode\'s current would make 0; only at V1 = 0 V, where the circuit makes every value 0 and the diode carries 0 A at 0 V, are ngspice\'s leftovers shown as 0', async () => {
    const r = await solveText('* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nR6 top c 4.6k\nR7 c 0 4.4k\nD1 c a dmod\n.model dmod d\n.options savecurrents\n.dc V1 0 9 3\n.end\n', ngspice);
    expect(r.words.sweeps[0]!.final.find((f) => f.name === 'i(@r5[i])')).toMatchObject({ value: -6.572964394990776e-14 });
    // Every series is shown as ngspice gives it at 3, 6 and 9 V; at 0 V every value is 0.
    const shown = shownSweep(r.netlist, r.results)!;
    r.results.dc!.series.forEach((s, j) => {
      expect(Array.from(shown.series[j]!.values).slice(1), s.name).toEqual(Array.from(s.values).slice(1));
      expect(shown.series[j]!.values[0], s.name).toBe(0);
    });
    expect(r.words.warnings.filter((m) => m.code === 'rounded-to-0')).toEqual([]);
  });

  it('so is one swept away from 0 V with no part currents saved, where the check of ngspice\'s values would let a + b·s through: Vm keeps its real −65.73 fA at 9 V, which a model with the diode at 0 A makes 0 at every point', async () => {
    const r = await solveText('* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a m 1k\nVm m b 0\nR6 top c 4.6k\nR7 c 0 4.4k\nD1 c a dmod\n.model dmod d\n.dc V1 3 9 3\n.end\n', ngspice);
    expect(r.words.sweeps[0]!.final.find((f) => f.name === 'i(vm)')).toMatchObject({ value: -6.572929568108906e-14 });
    expect(r.words.warnings.filter((m) => m.code === 'rounding-noise' || m.code === 'rounded-to-0')).toEqual([]);
  });

  it('the rule for other circuits: the current a real F copies is real (Vm keeps its 193.5 aA beside F1\'s 193.5 pA, 1e6 times it), and a 0 it writes at a node whose shown currents do not add up to 0 gets ngspice\'s number back (G1\'s 888.2 zA beside its two loads, whose ends are not alike)', async () => {
    const f = await solved(lines('V1 top 0 9', 'R1 top a 180k', 'R2 a 0 3.9meg', 'R3 top b 18k', 'R4 b 0 390k', 'R5 a m 4.7', 'Vm m b 0', 'F1 0 out Vm 1e6', 'Rl out 0 1k', RULE));
    expect([f.by, current(f.words, 'Vm'), current(f.words, 'F1'), noise(f.words)]).toEqual(['rule', 'Vm measures 193.5 aA flowing from node b to node m', '193.5 pA from node out to ground through F1', []]);
    // C9r.2: G1 reads a and b, which ngspice gives a step apart, so the rule takes its current as noise; R6 and R7 keep ngspice's attoamps (out is not written as 0 V), so G1 gets its number back,
    // and so does R5 between the two nodes G1 reads: G1's current is made from the voltage across R5.
    const two = await solved(lines('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', 'G1 0 out a b 1m', 'R6 out 0 1k', 'R7 out 0 2k', '.options savecurrents', RULE));
    expect([two.by, current(two.words, 'G1'), current(two.words, 'R6'), current(two.words, 'R7'), current(two.words, 'R5'), noise(two.words)]).toEqual(['rule', '8.882e-19 A from node out to ground through G1', '8.882e-19 A from ground to node out through R6', '4.441e-19 A from ground to node out through R7', '8.882e-19 A from node b to node a through R5', []]);
  });

  it('the rule for other circuits gives ground\'s level only to a node shown as 0 V: an E reading the balanced bridge, fed 5 mA through 1k, keeps ngspice\'s −931.3 pV at out, so E1 shows the power that makes (no node is written as 0 V there); and R5 keeps ngspice\'s 8.882e-19 A, not 0 A with "its two ends at the same voltage", since E1 makes out from that voltage (the critic of round 2)', async () => {
    const { words, by } = await solved(lines('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', 'E1 out 0 a b 1e6', 'V2 x 0 5', 'Rx x out 1k', RULE));
    expect([by, node(words, 'out'), words.nodes.find((n) => n.node === 'out')!.level, current(words, 'E1'), sp(words.currents.find((c) => c.name === 'E1')!.power!.text)]).toEqual(['rule', '−931.3 pV', undefined, '5 mA from node out to ground through E1', 'E1 delivers 4.657 pW']);
    expect([current(words, 'R5'), noise(words), note(words)]).toEqual(['8.882e-19 A from node b to node a through R5', [], undefined]);
    // With R5's current shown, nothing joins a and b: the page does not claim 0 V between them.
    expect(words.nodes.find((n) => n.node === 'a')!.level).not.toBe(words.nodes.find((n) => n.node === 'b')!.level);
  });

  it('the rule for other circuits keeps a controlled source\'s equation on the page: no path of resistors written as 0 joins the two nodes an E reads when it shows a voltage, nor those of a G whose current is shown, and the current an F copies is shown when the F\'s is (the critic of round 2)', async () => {
    const bridge = ['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k'];
    // The E's two control nodes joined through m by two resistors, each with its two ends a step apart: both keep ngspice's 1.776 aA.
    const split = await solved(lines(...bridge, 'R5 a m 500', 'R5b m b 500', 'E1 out 0 a b 1e6', 'V2 x 0 5', 'Rx x out 1k', RULE));
    expect([split.by, node(split.words, 'out'), current(split.words, 'R5'), current(split.words, 'R5b'), noise(split.words)]).toEqual(['rule', '1.863 nV', '1.776 aA from node a to node m through R5', '1.776 aA from node m to node b through R5b', []]);
    // A G of 1e9 S makes 888.2 nA, above ngspice's 1 pA, from the voltage across R5.
    const g = await solved(lines(...bridge, 'R5 a b 1k', 'G1 0 out a b 1e9', 'R6 out 0 1k', RULE));
    expect([g.by, current(g.words, 'G1'), current(g.words, 'R5'), noise(g.words)]).toEqual(['rule', '888.2 nA from node out to ground through G1', '8.882e-19 A from node b to node a through R5', []]);
    // An F of 1000 copies Vm's current, which the rule took as the only current left at m, into two loads whose attoamps
    // Kirchhoff's law keeps: F1 gets its number back, then Vm, the current it copies, and then R5, in series with Vm at m.
    const f = await solved(lines('V1 top 0 9', 'R1 top a 180k', 'R2 a 0 3.9meg', 'R3 top b 18k', 'R4 b 0 390k', 'R5 a m 4.7', 'Vm m b 0', 'F1 0 out Vm 1000', 'R6 out 0 1k', 'R7 out 0 1k', RULE));
    expect([f.by, current(f.words, 'F1'), current(f.words, 'Vm'), current(f.words, 'R5'), noise(f.words)]).toEqual(['rule', '193.5 fA from node out to ground through F1', 'Vm measures 193.5 aA flowing from node b to node m', '377.9 aA from node m to node a through R5', []]);
  });

  it('the rule for other circuits keeps the 0 a controlled source reads where the page does not show what it makes from it: an E of 1 whose two ends are shown alike (no power), and a G and an F into a 0 V ammeter, which carry 0 with it', async () => {
    const bridge = ['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k'];
    const e = await solved(lines(...bridge, 'V3 d 0 4.5', 'E1 c d a b 1', 'Rc c 0 1k', RULE));
    const level = (name: string): number | undefined => e.words.nodes.find((n) => n.node === name)!.level;
    expect([e.by, noise(e.words), e.words.currents.find((c) => c.name === 'E1')!.power, level('c') === level('d')]).toEqual(['rule', ['R5'], undefined, true]);
    const g = await solved(lines(...bridge, 'G1 0 out a b 1m', 'Vo out 0 0', RULE));
    expect([g.by, noise(g.words)]).toEqual(['rule', ['R5', 'G1', 'Vo']]);
    const f = await solved(lines('V1 top 0 9', 'R1 top a 180k', 'R2 a 0 3.9meg', 'R3 top b 18k', 'R4 b 0 390k', 'R5 a m 4.7', 'Vm m b 0', 'F1 0 out Vm 1000', 'Vo out 0 0', RULE));
    expect([f.by, noise(f.words)]).toEqual(['rule', ['R5', 'Vm', 'F1', 'Vo']]);
  });

  it('the rule for other circuits gives an F its number back with the current it copies: F1 of 1000 gets Vm back through its two loads, so F2 of 1, reading the same Vm into a 0 V ammeter, shows 1 × 193.5 aA, not "copies a current that is 0" beside it', async () => {
    const bridge = ['V1 top 0 9', 'R1 top a 180k', 'R2 a 0 3.9meg', 'R3 top b 18k', 'R4 b 0 390k', 'R5 a m 4.7', 'Vm m b 0'];
    const { words, by } = await solved(lines(...bridge, 'F1 0 out Vm 1000', 'R6 out 0 1k', 'R7 out 0 1k', 'F2 0 y Vm 1', 'Vx y 0 0', '.options savecurrents', RULE));
    expect([by, current(words, 'Vm'), current(words, 'F1'), current(words, 'F2'), current(words, 'Vx'), noise(words), note(words)]).toEqual([
      'rule',
      'Vm measures 193.5 aA flowing from node b to node m',
      '193.5 fA from node out to ground through F1',
      '193.5 aA from node y to ground through F2',
      'Vx measures 193.5 aA flowing from ground to node y',
      [],
      undefined,
    ]);
    // An F that copies a real current is real, however tiny: 1e-17 × Vm's 1 mA is 1e-20 A, from top into y and back
    // through R2, whose two ends ngspice gives a step apart (9.000000000000002 V against 9 V). Taken as noise, R2's 0
    // would leave F2 the only current at y, and the rule would write F2's real 1e-20 A as 0 A.
    const tiny = await solved(lines('V1 top 0 9', 'Vm top q 0', 'R1 q 0 9k', 'F2 top y Vm 1e-17', 'R2 y top 1k', '.options savecurrents', RULE));
    expect([tiny.by, current(tiny.words, 'F2'), noise(tiny.words), note(tiny.words)]).toEqual(['rule', '1e-20 A from node top to node y through F2', [], undefined]);
  });

  it('the rule gives a group of 0s back with one look at it: 10,000 resistors of 1 TΩ between the two nodes an E reads, each with its two ends a step apart, all get their numbers back in well under 200 ms (one path at a time, each node balanced again for each of its parts, took 16 s)', async () => {
    const body = ['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', ...Array.from({ length: 10_000 }, (_, k) => `R${k}x a b 1t`), 'Rl out 0 100', RULE];
    const text = lines(...body, 'E1 out 0 a b 1e6');
    const r = await solveText(text, ngspice);
    const [ms] = leastWorkMs([() => roundingNoise(parseNetlist(text), structuredClone(r.results))], 3);
    expect([roundingNoise(r.netlist, r.results).by, roundingNoise(r.netlist, r.results).currents.size]).toEqual(['rule', 0]);
    expect(ms).toBeLessThan(200);
    // Without E1 they are all 0 A, their two ends at the same voltage.
    const without = await solveText(lines(...body), ngspice);
    expect(roundingNoise(without.netlist, without.results).currents.size).toBe(10_000);
  }, 60_000);

  it('a run\'s .op and .dc are decided exactly together or not at all: beside 250 resistors of prime values both are, and out is 0 V in both; beside 320 the work for both does not fit, and both keep ngspice\'s −931.3 pV (the .op alone would fit, and said 0 V beside the sweep\'s −931.3 pV)', async () => {
    const primes: number[] = [];
    for (let k = 1009; primes.length < 320; k += 2) if (primes.every((p) => k % p !== 0) && [3, 5, 7, 11, 13, 17, 19, 23, 29, 31].every((p) => k % p !== 0)) primes.push(k);
    const text = (n: number): string => `* t\n${['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', 'E1 out 0 a b 1e6', 'Rl out 0 100', ...primes.slice(0, n).map((p, k) => `Rp${k} top 0 ${p}`)].join('\n')}\n.op\n.dc V1 0 9 1\n.end\n`;
    const out = async (n: number): Promise<string[]> => {
      const r = await solveText(text(n), ngspice);
      return [node(r.words, 'out'), sp(r.words.sweeps[0]!.final.find((f) => f.name === 'v(out)')!.text)];
    };
    expect(await out(250)).toEqual(['0 V', 'v(out) = 0 V']);
    expect(await out(320)).toEqual(['−931.3 pV', 'v(out) = −931.3 pV']);
  });

  it('where ngspice\'s answers are off, a level the rule gives is kept only where the exact voltages are equal: 2 attoamps through 120 Ω leave i2 1.2e-16 V above top1 exactly, which ngspice gives as one double, so e3 = 2 × V(top1, i2) is not at ground\'s level, though ngspice and the rule give it 0 V (a second loop, 3 aA through 150 Ω at 5 V, which ngspice gives 5.921 aA the other way, keeps the run off)', async () => {
    const { words, by } = await solved(lines('V1 top1 0 9', 'R1 top1 i2 120', 'I1 0 i2 1A', 'R2 top1 i2 10meg', 'E1 e3 0 top1 i2 2', 'R3 e3 0 18', 'V2 top2 0 5', 'R4 top2 j 150', 'I2 0 j 3A'));
    expect([by, node(words, 'e3'), off(words) !== undefined]).toEqual(['rule', '0 V', true]);
    expect(words.nodes.find((n) => n.node === 'e3')!.level).toBeUndefined();
  });

  it('the warning names node voltages before currents among the exact 0s: the bridge with a 1e-12 Ω wire read by a G of 1000 into 1 mΩ puts g at 0 V before G1\'s 53.56 A', async () => {
    const { words } = await solved(lines('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'Rw a m 1e-12', 'R5 m b 1k', 'G1 0 g a b 1000', 'R9 g 0 1m'));
    expect(sp(off(words)!.why)).toContain('values, node g is at 0 V, where ngspice gives −53.56 mV; G1 carries no current, where ngspice gives 53.56 A; R9 carries no current, where ngspice gives 53.56 A;');
  });
});

describe('after the critic of round 2: a sweep\'s real values ngspice gives as 0, worked out exactly or to 8 digits', () => {
  // The 1 nΩ wire R3 of C9n.4 carries V1 × K, K = R2 / (R1 (R2 + S) + R2 S), S = R3 + R4, exactly; with an offset source
  // Vq at q, R2's far end, its current is (V1 + Vq·R1/R2) × K and crosses 0 near V1 = 1.5.
  const ohms = (w: string): Fraction => readExact(w)!;
  const [R1, R2, S] = [ohms('270k'), ohms('820'), add(ohms('1n'), ohms('10meg'))];
  const K = div(R2, add(mul(R1, add(R2, S)), mul(R2, S)));
  const lostPoints = (r: Awaited<ReturnType<typeof solveText>>): { x: ArrayLike<number>; values: ArrayLike<number>; given: ArrayLike<number> } => {
    const spec = plotSpecs(r.results, r.netlist)[0]!;
    const s = spec.series.find((v) => v.label === 'i(@r3[i])')!;
    return { x: spec.x.values, values: s.values, given: s.given! };
  };

  it('the first 2,000 such points and the last are the exact value at ngspice\'s x, rounded once; the others, from the exact a and b in doubles, to 1e-8', async () => {
    const r = await solveText('* t\nV1 top1 0 1.5\nR1 top1 d2 270k\nR2 d2 0 820\nR3 d2 p3 1n\nR4 p3 0 10meg\n.options savecurrents\n.dc V1 0 1.4 0.00025\n.end\n', ngspice);
    const { x, values, given } = lostPoints(r);
    let k0 = 0;
    for (let k = 1; k < x.length; k++) {
      if (given[k] !== 0) continue;
      const exact = toDouble(mul(fromDouble(x[k]!), K));
      if (k0 < 2000 || k === x.length - 1) expect(values[k], String(k)).toBe(exact);
      else expect(Math.abs(values[k]! - exact) / Math.abs(exact), String(k)).toBeLessThan(1e-8);
      k0 += 1;
    }
    expect(k0).toBeGreaterThan(2300);
    // The last point's estimate in doubles would be one step of a double off: the exact value is what is shown.
    const last = x.length - 1;
    expect(toDouble(K) * x[last]!).not.toBe(values[last]);
  });

  it('where the value crosses 0, an estimate in doubles would lose its digits: there the exact value is worked out again', async () => {
    const r = await solveText('* t\nV1 top1 0 1.5\nR1 top1 d2 270k\nR2 d2 q 820\nVq q 0 -4.5555555556m\nR3 d2 p3 1n\nR4 p3 0 10meg\n.options savecurrents\n.dc V1 0.5 2 0.0002\n.end\n', ngspice);
    const { x, values, given } = lostPoints(r);
    const offset = div(mul(ohms('-4.5555555556m'), R1), R2);
    let checked = 0;
    let crossing = 0;
    for (let k = 1; k < x.length; k++) {
      if (given[k] !== 0) continue;
      const exactF = mul(add(fromDouble(x[k]!), offset), K);
      const exact = toDouble(exactF);
      if (exact === 0) continue;
      checked += 1;
      expect(Math.abs(values[k]! - exact) / Math.abs(exact), String(k)).toBeLessThan(1e-8);
      // Points within a millionth of the crossing, where a + b·x cancels.
      if (Math.abs(exact) < 1e-6 * Math.abs(toDouble(mul(fromDouble(x[k]!), K)))) crossing += 1;
    }
    expect(checked).toBeGreaterThan(2000);
    expect(crossing).toBeGreaterThan(0);
  });
});

describe('after the critic of round 2: with a diode, a run\'s .op and its .dc are decided together', () => {
  const tia = ['V1 top 0 9', 'R1 top a 180k', 'R2 a 0 3.9meg', 'R3 top b 18k', 'R4 b 0 390k', 'R5 a m 4.7', 'Vm m b 0', 'H1 out 0 Vm 1g', 'Rl out 0 1k', 'D1 0 top dmod', '.model dmod d'];

  it('the H of 1 GΩ reading a balanced bridge, with a diode, swept to the .op\'s 9 V: out is 0 V in the .op and at every point of the sweep, each diode\'s current left free at each point (the .op said 0 V beside the sweep\'s −193.5 nV at the same point)', async () => {
    const r = await solveText(`* t\n${tia.join('\n')}\n.op\n.dc V1 0 9 3\n.end\n`, ngspice);
    const last = (name: string) => r.words.sweeps[0]!.final.find((f) => f.name === name)!;
    expect([roundingNoise(r.netlist, r.results).by, node(r.words, 'out'), current(r.words, 'Rl')]).toEqual(['exact', '0 V', 'no current through Rl']);
    expect(['v(out)', 'i(h1)', 'i(vm)', 'i(@r5[i])', 'i(@rl[i])'].map((name) => [last(name).value, last(name).noise])).toEqual([
      [0, -1.9350975899792844e-7],
      [0, 1.9350975899792844e-10],
      [0, -1.9350975899792844e-16],
      [0, -3.7794826370218095e-16],
      [0, -1.9350975899792844e-10],
    ]);
    // The diode's own current is real (it is reverse-biased by V1) and stays as ngspice gives it.
    expect(last('i(@d1[id])')).toMatchObject({ value: -9.00999999968093e-12 });
    expect(Array.from(shownSweep(r.netlist, r.results)!.series.find((s) => s.name === 'v(out)')!.values)).toEqual([0, 0, 0, 0]);
    const notes = r.words.warnings.filter((m) => m.code === 'rounding-noise').map((m) => sp(m.why ?? ''));
    // The diode across V1 changes none of them: 0 whatever current it carries (the critic of round 3).
    expect(notes[1]).toContain("Solved exactly, with fractions, from the netlist's values, the circuit makes each of them exactly 0 there, whatever current its diodes carry, so PlainSpice shows 0");
  });

  it('a diode with 0 V across it at one point of the sweep carries 0 A there only: the G reading the balanced bridge drives R6 and R7 to ground and a diode to y, which V2 sets; at V2 = 0, the .op\'s point, R7 and the diode are exactly 0 as in the .op, and at 1 and 2 V they carry the diode\'s real reverse current', async () => {
    const r = await solveText('* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nG1 0 out a b 1m\nR6 out x 1k\nR7 x 0 1k\nD1 x y dmod\nV2 y 0 0\n.model dmod d\n.options savecurrents\n.op\n.dc V2 0 2 1\n.end\n', ngspice);
    expect([roundingNoise(r.netlist, r.results).by, current(r.words, 'R7'), node(r.words, 'x')]).toEqual(['exact', 'no current through R7', '0 V']);
    const shown = shownSweep(r.netlist, r.results)!;
    const series = (name: string): number[] => Array.from(shown.series.find((s) => s.name === name)!.values);
    expect(series('i(@r7[i])')).toEqual([0, 1.3866232302623201e-12, 2.009998735343814e-12]);
    expect(series('i(@d1[id])')).toEqual([0, -1.0099997660113e-12, -2.0099999689147417e-12]);
    expect(series('v(x)')).toEqual([0, 1.38662323026232e-9, 2.009998735343814e-9]);
    // R6 is in series with G1, which reads 0 V at every point: 0 at every point.
    expect(series('i(@r6[i])')).toEqual([0, 0, 0]);
  });

  it('at a point where the circuit makes every value 0, ngspice\'s Newton iterations can leave a diode circuit 1e-25 V here and there: two equal diode arms swept from 0 V show 0 there, each value within 2^-30 of the largest ngspice gives of its kind; R5, 0 because the two diodes, placed alike, carry equal currents, is 0 at every point (the critic of round 3: it kept ngspice\'s numbers)', async () => {
    const r = await solveText('* t\nV1 top 0 9\nD1 top a dmod\nR2 a 0 10k\nD2 top b dmod\nR4 b 0 10k\nR5 a b 1k\n.model dmod d\n.options savecurrents\n.op\n.dc V1 0 9 3\n.end\n', ngspice);
    const given = (name: string): number[] => Array.from(r.results.dc!.series.find((s) => s.name === name)!.values);
    const shown = (name: string): number[] => Array.from(shownSweep(r.netlist, r.results)!.series.find((s) => s.name === name)!.values);
    expect(given('v(a)')[0]).toBe(-7.3985058599438795e-25);
    expect(shown('v(a)')).toEqual([0, ...given('v(a)').slice(1)]);
    expect(shown('i(@d1[id])')).toEqual([0, ...given('i(@d1[id])').slice(1)]);
    expect([given('i(@r5[i])').slice(1), shown('i(@r5[i])')]).toEqual([
      [4.440892098500626e-19, 0, 0],
      [0, 0, 0, 0],
    ]);
  });

  it('a value ngspice gives at such a point that is not that small is not called rounding noise: with v(a) doctored to 1 mV at 0 V, the sweep is left as ngspice gives it', async () => {
    const text = '* t\nV1 top 0 9\nD1 top a dmod\nR2 a 0 10k\nD2 top b dmod\nR4 b 0 10k\nR5 a b 1k\n.model dmod d\n.options savecurrents\n.dc V1 0 9 3\n.end\n';
    const r = await solveText(text, ngspice);
    const doctored = structuredClone(r.results);
    doctored.dc!.series.find((s) => s.name === 'v(a)')!.values[0] = 1e-3;
    const netlist = parseNetlist(text);
    expect(shownSweep(netlist, doctored)).toBe(doctored.dc);
  });

  it('with diodes, a real value ngspice gives as exactly 0 is shown exactly when no diode\'s current changes it, in the .op and at each point of the sweep: the 1 nΩ wire of C9n.4 with a diode across V1 carries 454.1 pA in both; with a diode into its far end, its exact value depends on that diode\'s current, and ngspice\'s 0 stays in both', async () => {
    const wire = ['V1 top1 0 1.5', 'R1 top1 d2 270k', 'R2 d2 0 820', 'R3 d2 p3 1n', 'R4 p3 0 10meg'];
    const run = (diode: string) => solveText(`* t\n${[...wire, diode, '.model dmod d', '.options savecurrents', '.op', '.dc V1 0 1.5 0.5'].join('\n')}\n.end\n`, ngspice);
    const across = await run('D1 0 top1 dmod');
    const last = (r: Awaited<ReturnType<typeof run>>) => r.words.sweeps[0]!.final.find((f) => f.name === 'i(@r3[i])')!;
    expect([current(across.words, 'R3'), across.words.currents.find((c) => c.name === 'R3')!.given, sp(last(across).text), last(across).given]).toEqual(['454.1 pA from node d2 to node p3 through R3', 0, 'i(@r3[i]) = 454.1 pA', 0]);
    expect(sp(across.words.warnings.find((m) => m.code === 'rounded-to-0')!.why ?? '')).toContain("Solved exactly, with fractions, from the netlist's values, R3 carries 454.1 pA, so PlainSpice shows 454.1 pA.");
    const into = await run('D1 p3 top1 dmod');
    expect([roundingNoise(into.netlist, into.results).by, current(into.words, 'R3'), sp(last(into).text), into.words.warnings.filter((m) => m.code === 'rounded-to-0')]).toEqual(['exact', 'no current through R3', 'i(@r3[i]) = 0 A', []]);
  });

  it('with a diode, the .op and the .dc of one run fit in its budget together or neither is decided exactly: a check of ngspice\'s values counts the diodes\' currents too (beside 180 resistors of prime values the .op alone fitted, and said 0 V beside the sweep\'s −931.3 pV)', async () => {
    const primes: number[] = [];
    for (let k = 1009; primes.length < 180; k += 2) if (primes.every((p) => k % p !== 0) && [3, 5, 7, 11, 13, 17, 19, 23, 29, 31].every((p) => k % p !== 0)) primes.push(k);
    const text = (n: number): string => `* t\n${['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', 'E1 out 0 a b 1e6', 'Rl out 0 100', 'D1 0 top dmod', '.model dmod d', ...primes.slice(0, n).map((p, k) => `Rp${k} top 0 ${p}`)].join('\n')}\n.op\n.dc V1 0 9 1\n.end\n`;
    const out = async (n: number): Promise<string[]> => {
      const r = await solveText(text(n), ngspice);
      return [node(r.words, 'out'), sp(r.words.sweeps[0]!.final.find((f) => f.name === 'v(out)')!.text)];
    };
    expect(await out(150)).toEqual(['0 V', 'v(out) = 0 V']);
    expect(await out(180)).toEqual(['−931.3 pV', 'v(out) = −931.3 pV']);
  });
});

describe('after the critic of round 2: a diode\'s current, worked out from ngspice\'s numbers, and the warning beside it', () => {
  it('a .tf of a circuit with a diode is left as ngspice gives it: a reverse-biased diode from a to top passes a change as its conductance, so the bridge\'s v(a,b)/V1 is a real 2.994e-10 V/V, which the circuit with the diode at 0 A makes 0 (C9t.11)', async () => {
    const r = await solveText('* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nD1 a top dmod\n.model dmod d\n.op\n.tf v(a,b) V1\n.end\n', ngspice);
    expect([roundingNoise(r.netlist, r.results).by, r.words.tf!.transferFunction!.value, r.words.tf!.transferFunction!.noise]).toEqual(['exact', 2.994011705226285e-10, undefined]);
  });

  it('a diode taken as carrying 0 A must carry less than ngspice\'s 1 pA by ngspice\'s numbers: in s5-137 nothing drives the loop of D1 and 2.2 MΩ, but ngspice settles on 0.31 µA there, which the circuit\'s gigavolts and kiloamps hid from the checks; the rule decides, in the .op and in the sweep (C9t.10)', async () => {
    const circuit = [
      'V1 top1 0 100', 'R1 top1 a2 3.3k', 'R2 a2 0 12', 'R3 top1 b3 330', 'R4 b3 0 1.2', 'R5 a2 m4 560', 'V2 m4 b3 0', 'F1 0 o5 V2 1e9', 'R6 o5 0 22k', 'H1 h6 0 V2 1meg', 'R7 h6 0 270k',
      'V3 b3 v7 0', 'V4 v7 v8 0', 'V5 v8 v9 0', 'V6 v9 v10 0', 'R8 v10 0 12', 'R9 b3 a11 12', 'R10 a11 0 5.6', 'R11 b3 b12 12000', 'R12 b12 0 5605.6',
      'R13 a11 m13 1.2k', 'R14 m13 m14 100k', 'R15 m14 m15 2.2', 'R16 m15 m16 22k', 'R17 m16 m17 2.2', 'R18 m17 m18 220', 'R19 m18 m19 8.2k', 'R20 m19 b12 22k',
      'D1 d20 top1 dmod', 'R21 d20 top1 2.2meg', 'E1 e21 0 b3 0 1', 'R22 e21 0 27', '.model dmod D(is=1e-14)', '.options savecurrents',
    ];
    const op = await solveText(`* t\n${circuit.join('\n')}\n.op\n.end\n`, ngspice);
    expect([roundingNoise(op.netlist, op.results).by, current(op.words, 'R21'), node(op.words, 'd20'), noise(op.words)]).toEqual(['rule', '308.4 nA from node d20 to node top1 through R21', '100.7 V', []]);
    const dc = await solveText(`* t\n${circuit.join('\n')}\n.dc V1 90 100 5\n.end\n`, ngspice);
    expect(shownSweep(dc.netlist, dc.results)).toBe(dc.results.dc);
  });

  it('a node whose exact value a diode\'s current changes keeps ngspice\'s exactly 0: two diode-fed rails of +9 V and −9 V, and the middle m of two equal resistors between them, which ngspice gives as 0 V; with V1\'s current a step off, the diodes\' currents Kirchhoff\'s law gives made m read 1.7e-15 V', async () => {
    const text = '* t\nV1 p0 0 9\nD1 p0 p dmod\nR1 p 0 1k\nV2 n0 0 -9\nD2 n n0 dmod\nR2 n 0 1k\nRa p m 1k\nRb m n 1k\n.model dmod d\n.options savecurrents\n.op\n.end\n';
    const r = await solveText(text, ngspice);
    expect([node(r.words, 'm'), r.words.nodes.find((n) => n.node === 'm')!.given]).toEqual(['0 V', undefined]);
    const doctored = structuredClone(r.results);
    const v1 = doctored.op!.currents.find((c) => c.element === 'v1')!;
    v1.value = v1.value * (1 + Number.EPSILON);
    const noise = roundingNoise(parseNetlist(text), doctored);
    expect([noise.by, [...noise.lostNodes]]).toEqual(['exact', []]);
  });

  it('a diode\'s current comes from the node whose law ngspice\'s rounding leaves nearest 0: beside a 1 nΩ wire, the wire\'s node gave it 4.1e-10 A for its 6.5e-15 A, and a warning said d2 is at 4.542 mV where it is at 4.541 mV, as ngspice gives it; from ground\'s law the circuit is solved exactly, with no warning', async () => {
    const r = await solveText('* t\nV1 top1 0 1.5\nR1 top1 d2 270k\nR2 d2 0 820\nR3 d2 p3 1n\nR4 p3 0 10meg\nD1 d2 0 dmod\n.model dmod d\n.options savecurrents\n.op\n.end\n', ngspice);
    expect([roundingNoise(r.netlist, r.results).by, off(r.words), node(r.words, 'd2'), current(r.words, 'R4')]).toEqual(['exact', undefined, '4.541 mV', '454.1 pA from node p3 to ground through R4']);
    // ngspice's own R3 has no correct digit (its two ends a step apart over 1 nΩ), and with a diode it is shown as ngspice gives it.
    expect(current(r.words, 'R3')).toBe('867.4 pA from node d2 to node p3 through R3');
  });

  it('with diodes, the warning that ngspice\'s answers are off names only values that no diode\'s current changes, whose exact values PlainSpice knows: the bridge with a 1e-12 Ω wire, fed through 100 Ω with a diode to ground, names Rw and R5 (0 for any current the diode carries), not node a, which depends on it; unbalanced, every value off depends on it, and there is no warning', async () => {
    const fed = (r2: string): string => `* t\nV1 in 0 9\nR0 in top 100\nD1 top 0 dmod\nR1 top a 10k\nR2 a 0 ${r2}\nR3 top b 4.7k\nR4 b 0 4.7k\nRw a m 1e-12\nR5 m b 1k\n.model dmod d\n.options savecurrents\n.op\n.end\n`;
    const balanced = await solveText(fed('10k'), ngspice);
    expect(off(balanced.words)?.why).toBe("Solved exactly, with fractions, from the netlist's values, Rw carries no current, where ngspice gives 55.51 µA; and R5 carries no current, where ngspice gives 2.404 µA. ngspice computes with about 16 significant digits, and solving this circuit loses most of them. PlainSpice shows ngspice's numbers as it gives them, so they may not agree with each other.");
    const unbalanced = await solveText(fed('12k'), ngspice);
    expect([roundingNoise(unbalanced.netlist, unbalanced.results).by, off(unbalanced.words)]).toEqual(['rule', undefined]);
    // Across V1 the diode changes nothing in the bridge, so every value off is named, as without it.
    const across = await solveText('* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nRw a m 1e-12\nR5 m b 1k\nD1 0 top dmod\n.model dmod d\n.options savecurrents\n.op\n.end\n', ngspice);
    expect(off(across.words)?.why).toContain('values, R5 carries no current, where ngspice gives 28.13 µA; R2 carries 450 µA, where ngspice gives 459.4 µA; node a is at 4.5 V, where ngspice gives 4.594 V;');
  });
});

describe('after the critic of round 3 of the re-check\'s fixes: circuits at rest, the floor of each answer, diodes placed alike, and a run\'s .op and .dc together', () => {
  const run = (...l: string[]): Promise<Awaited<ReturnType<typeof solveText>>> => solveText(`* t\n${l.join('\n')}\n.end\n`, ngspice);
  const notes = (w: ResultsInWords): string[] => w.warnings.filter((m) => m.code === 'rounding-noise').map((m) => sp(m.why ?? ''));
  const bridge = ['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', '.options savecurrents', '.op'];

  it('a diode\'s I-V sweep from 0 V: its .op, at rest, is decided exactly, so ngspice\'s Newton leftovers (7.3e-29 V, 7.3e-32 A) are 0 there as at the sweep\'s 0 V point, both notes saying why; a value at rest beyond 2^-30 of vntol is not a leftover, and the .op and its sweep are then left to the rule and to ngspice together', async () => {
    const text = '* t\nV1 in 0 0\nR1 in a 1k\nD1 a 0 dmod\n.model dmod d\n.op\n.dc V1 0 1 0.25\n.end\n';
    const r = await solveText(text, ngspice);
    expect(roundingNoise(r.netlist, r.results).by).toBe('exact');
    expect([node(r.words, 'a'), current(r.words, 'V1'), current(r.words, 'R1')]).toEqual(['0 V', 'V1 measures no current', 'no current through R1']);
    expect(r.words.nodes.find((n) => n.node === 'a')!.noise).toBe(7.323378444748195e-29);
    expect(notes(r.words)[0]).toContain('the circuit makes each of them exactly 0 (D1 has 0 V across it, so it carries no current), so PlainSpice shows 0 A and 0 V.');
    expect(notes(r.words)[1]).toContain('the circuit makes each of them exactly 0 there (D1 has 0 V across it there, so it carries no current), so PlainSpice shows 0');
    expect(Array.from(shownSweep(r.netlist, r.results)!.series.find((s) => s.name === 'v(a)')!.values)[0]).toBe(0);
    // Beside a sweep to 1 V, a leftover may be 2^-30 of 1 V (9.3e-10 V); 1 µV is not one.
    const doctored = structuredClone(r.results);
    doctored.op!.nodes.find((n) => n.node === 'a')!.value = 1e-6;
    const netlist = parseNetlist(text);
    expect(roundingNoise(netlist, doctored).by).toBe('rule');
    // The sweep alone would be decided exactly; beside an .op that is not, it is left as ngspice gives it.
    expect(shownSweep(netlist, doctored)).toBe(doctored.dc);
    // A sweep at rest at every point gives only leftovers: they are held to 2^-30 of vntol and abstol, not of themselves.
    const still = await solveText(text.replace('.dc V1 0 1 0.25', '.dc V1 0 0 1'), ngspice);
    expect([roundingNoise(still.netlist, still.results).by, Array.from(shownSweep(still.netlist, still.results)!.series.find((s) => s.name === 'v(a)')!.values)]).toEqual(['exact', [0]]);
  });

  it('an .op beside a sweep the exact solution does not decide (of a resistor, of two sources) is left to the rule, as the sweep is left to ngspice; beside a sweep of the temperature, whose every point is the .op\'s circuit, both are decided exactly (the critic of round 3: the .op called R5\'s −8.882e-19 A an exact 0 beside the sweep\'s words giving it at the same state)', async () => {
    for (const dc of ['.dc R5 1k 2k 500', '.dc V1 0 9 9 V2 0 1 1']) {
      const r = await run(...bridge, 'V2 x 0 1', 'R6 x 0 1k', dc);
      expect(roundingNoise(r.netlist, r.results).by, dc).toBe('rule');
      expect(note(r.words), dc).toContain("below 1 pA, ngspice's current tolerance (its abstol option)");
      expect(shownSweep(r.netlist, r.results), dc).toBe(r.results.dc);
    }
    const t = await run(...bridge, '.dc TEMP 0 50 25');
    expect(roundingNoise(t.netlist, t.results).by).toBe('exact');
    expect(Array.from(shownSweep(t.netlist, t.results)!.series.find((s) => s.name === 'i(@r5[i])')!.values)).toEqual([0, 0, 0]);
    expect(sp(t.words.sweeps[0]!.text)).toContain('At 50 °C: ');
    expect(notes(t.words)[1]).toContain('ngspice gave i(@r5[i]) -8.881784e-19 A at 0 °C, i(@r5[i]) -8.881784e-19 A at 25 °C and i(@r5[i]) -8.881784e-19 A at 50 °C.');
  });

  it('each answer is held to what rounding leaves of the numbers it is worked out from: an open-loop E making 1.2 MV beside the 5 mV bridge of C9s.4 no longer hides ngspice\'s 4.882 mV for 5.189 mV, so the page shows ngspice\'s numbers with the warning, not R5 as 0 A "at the same voltage, 5.189 mV" (the critic of round 3)', async () => {
    const { words, by } = await solved(lines('V1 top 0 12', 'Rd1 top s 999k', 'Rd2 s 0 1k', 'R1 s a 10k', 'R2 a 0 10k', 'R3 s b 4.7k', 'R4 b 0 4.7k', 'Rw a m 10p', 'R5 m b 1k', 'E1 out 0 top 0 100k', 'Rl out 0 10k'));
    expect(by).toBe('rule');
    expect(current(words, 'R5')).toBe('82.78 nA from node b to node m through R5');
    expect(note(words)).toBeUndefined();
    expect(off(words)!.why).toContain('node a is at 5.189 mV, where ngspice gives 4.882 mV');
  });

  it('what a controlled source makes in another part of the circuit carries its gain times the floor of what it reads, and a chain of ammeters takes the floor of its ends: an H of 1 GΩ reading a bridge 1e-14 off balance, and three 0 V ammeters in a row, stay decided exactly with no warning; a 1 nΩ probe wire on a ladder, whose Schur complement loses digits, is caught', async () => {
    const h = await solved(lines('V1 top1 0 5', 'R1 top1 a2 330', 'R2 a2 0 330', 'R3 top1 b3 1650', 'R4 b3 0 1650.00000000002', 'R5 a2 m4 68k', 'V2 m4 b3 0', 'H1 h5 0 V2 1e9', 'R6 h5 0 120k'));
    expect([h.by, node(h.words, 'h5'), off(h.words)]).toEqual(['exact', '−223.6 pV', undefined]);
    const chain = await solved(lines('V1 top1 0 1', 'R1 top1 a2 390', 'R2 a2 0 1500000', 'R3 top1 b3 3900', 'R4 b3 0 15000000.015', 'V2 a2 m4 0', 'V3 m4 m5 0', 'V4 m5 m6 0', 'R5 m6 b3 220', 'E1 e7 0 top1 0 1m', 'R6 e7 0 2.7k'));
    expect([chain.by, current(chain.words, 'V3'), off(chain.words)]).toEqual(['exact', 'V3 measures 57.68 aA flowing from node m5 to node m4', undefined]);
    const ladder = ['V1 top1 0 5'];
    for (let k = 2; k <= 21; k++) ladder.push(`R${2 * k - 3} ${k === 2 ? 'top1' : `n${k - 1}`} n${k} 27k`, `R${2 * k - 2} n${k} 0 270`);
    const probe = await solved(lines(...ladder, 'R41 n8 p22 1n', 'R42 p22 0 1e14'));
    expect(probe.by).toBe('rule');
    expect(off(probe.words)!.why).toContain('node p22 is at 43.56 fV, where ngspice gives 43.55 fV');
  });

  it('two equal diode arms with a link between their middles: the diodes, placed alike, carry the same current, so the link and its ammeter carry exactly 0, with a note that says so; ngspice\'s numbers must show that even solution, or the diodes are taken one by one (the same run with D2 of another law, described with one model line, keeps R5\'s real 2.019 µA)', async () => {
    const sym = ['V1 top 0 9', 'R0 top t 100', 'D1 t a dmod', 'R1 a c 1k', 'R2 c 0 2.2k', 'D2 t b dmod', 'R3 b d 1k', 'R4 d 0 2.2k', 'R5 c m 4.7k', 'Vm m d 0', '.model dmod d', '.model dmod2 d(is=2e-14)'];
    const { words, by } = await solved(lines(...sym));
    expect([by, current(words, 'R5'), current(words, 'Vm'), noise(words)]).toEqual(['exact', 'no current through R5', 'Vm measures no current', ['R5', 'Vm']]);
    expect(note(words)).toContain('the circuit makes each of them exactly 0 (D1 and D2, placed alike in the circuit, carry the same current), so PlainSpice shows 0 A.');
    const text = lines(...sym);
    const uneven = await solveText(text.replace('D2 t b dmod', 'D2 t b dmod2'), ngspice);
    const w = describeResults(parseNetlist(text), uneven.results, uneven.run);
    expect([roundingNoise(parseNetlist(text), uneven.results).by, sp(w.currents.find((c) => c.name === 'R5')!.text)]).toEqual(['exact', '2.019 µA from node m to node c through R5']);
  });

  it('a real 1 aA that ngspice gives as exactly 0 in a source and a resistor, every other value exact, is decided exactly and shown exactly in both, so Kirchhoff\'s law holds; where ngspice also gives another current with no correct digit (R1 of 150 Ω at 5 V: 5.921 aA the other way for 3 aA), the exact value would sit beside it, and the page keeps ngspice\'s numbers, with the warning (the critic of round 3)', async () => {
    const loop = await solved(lines('V1 top1 0 1.5', 'R1 top1 i2 47', 'I1 0 i2 1A'));
    expect([loop.by, current(loop.words, 'V1'), current(loop.words, 'R1'), current(loop.words, 'I1'), off(loop.words)]).toEqual(['exact', '1 aA from node top1 to ground through V1', '1 aA from node i2 to node top1 through R1', '1 aA from ground to node i2 through I1', undefined]);
    expect(sp(loop.words.warnings.find((m) => m.code === 'rounded-to-0')!.why ?? '')).toContain('V1 1 aA and R1 1 aA');
    const off3 = await solved(lines('V1 top1 0 5', 'R1 top1 i2 150', 'I1 0 i2 3A', 'R2 i2 f3 1e12', 'C1 f3 0 1p'));
    expect([off3.by, current(off3.words, 'V1'), current(off3.words, 'R1')]).toEqual(['rule', 'no current through V1', '5.921 aA from node top1 to node i2 through R1']);
    expect(off(off3.words)!.why).toContain('R1 carries 3 aA, where ngspice gives 5.921 aA the other way; and V1 carries 3 aA, where ngspice gives 0 A.');
  });

  it('with a diode on an ill-conditioned bridge, the warning names the values whose exact value the diode moves too little to change their digits: its 167 fA moves node a2 by 5 nV where ngspice is 0.26 mV off (the critic of round 3: no warning beside numbers 48,000 times off)', async () => {
    const { words, by } = await solved(lines('V1 top1 0 9', 'R1 top1 a2 4.7meg', 'R2 a2 0 33k', 'R3 top1 b3 4.7meg', 'R4 b3 0 33k', 'R5 a2 m4 1n', 'R6 m4 b3 100meg', 'R7 top1 s5 1k', 'R8 s5 0 1e15', 'G1 0 g6 a2 b3 1m', 'R9 g6 0 3.3', 'D1 a2 d7 dmod', 'R10 d7 0 5.6', '.model dmod D(is=1e-14)'));
    expect(by).toBe('rule');
    expect(off(words)!.why).toContain('node a2 is at 62.75 mV, where ngspice gives 63.01 mV');
  });

  it('a test for each check of the diode half of the exact decision (the critic of round 3): a lit LED\'s node keeps its 3.028 V, a node fed only through a diode keeps its level apart from ground\'s, a diode free elsewhere frees the one it feeds at each point of a sweep, and the floor of an ammeter fed by a current source counts the currents of the resistors at its nodes', async () => {
    const led = await solved(lines('V1 top 0 5', 'D1 top a led', 'R1 a 0 220', '.model led d(is=1e-20 n=1.8 rs=2)'));
    expect([led.by, node(led.words, 'a'), noise(led.words), note(led.words)]).toEqual(['exact', '3.028 V', [], undefined]);
    const feed = await solved(lines('V1 top 0 9', 'R1 top x 1k', 'D1 x a dmod', 'R2 a 0 1k', 'E1 out 0 a 0 2', 'Rl out 0 10k', '.model dmod d'));
    const level = (n: string): number | undefined => feed.words.nodes.find((x) => x.node === n)!.level;
    expect([node(feed.words, 'a'), node(feed.words, 'out'), noise(feed.words)]).toEqual(['4.154 V', '8.308 V', []]);
    expect([level('a') !== undefined && level('a') !== 0, level('out') !== undefined && level('out') !== 0, level('a') !== level('out')]).toEqual([true, true, true]);
    const dq = await run('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'D1 a m dmod', 'R5 m b 1k', 'D2 top q dmod', 'Rq q a 1meg', '.model dmod d', '.options savecurrents', '.op', '.dc V1 0 9 3');
    expect(sp(dq.words.sweeps[0]!.final.find((f) => f.name === 'i(@r5[i])')!.text)).toBe('i(@r5[i]) = 31.34 fA');
    const ib = await solved(lines('I1 0 top 1m', 'R1 top a 1k', 'R2 a 0 1k', 'R3 top b 2k', 'R4 b 0 2.000000000002k', 'Vm a m 0', 'R5 m b 1k'));
    expect([ib.by, current(ib.words, 'Vm'), off(ib.words)]).toEqual(['exact', 'Vm measures 133.4 aA flowing from node m to node a', undefined]);
  });

  it('where ngspice\'s answers are off, an exact 0 the rule shows as 0 is not named in the warning (the page shows it as the circuit makes it): R10 of a balanced bridge beside the bridge of C9s, given 950 fA (doctored: beyond 2^-30 of the 957 µA at its nodes, below the rule\'s 1 pA; its ends one step apart, so no product check applies) is "no current", and the warning does not name it', async () => {
    const text = lines('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'Rw a m 1e-12', 'R5 m b 1k', 'R6 top c 10k', 'R7 c 0 10k', 'R8 top d 4.7k', 'R9 d 0 4.7k', 'R10 c d 1k', '.options savecurrents').replace('.op\n', '.op\n');
    const r = await solveText(text, ngspice);
    const doctored = structuredClone(r.results);
    doctored.op!.currents.find((c) => c.element === 'r10')!.value = 9.5e-13;
    const w = describeResults(parseNetlist(text), doctored, r.run);
    expect([roundingNoise(parseNetlist(text), doctored).by, sp(w.currents.find((c) => c.name === 'R10')!.text)]).toEqual(['rule', 'no current through R10']);
    expect(sp(w.warnings.find((m) => m.code === 'imprecise-answers')!.why ?? '')).not.toContain('R10');
  });

  it('a 60-part bridge with 53 ammeters, and 16 diodes swept from 0 V, each with a 99,999-point sweep and every current saved: describeResults stays quick, a series that is noise at every point marked once (the critic of round 3: 142 to 191 ms and 98 to 174 ms)', async () => {
    const amm = ['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a m0 1k'];
    for (let k = 0; k < 53; k++) amm.push(`Vm${k} m${k} ${k === 52 ? 'b' : `m${k + 1}`} 0`);
    const diodes = ['V1 top 0 9'];
    for (let k = 1; k <= 16; k++) diodes.push(`R${k} top a${k} ${1000 + 7 * k}`, `D${k} a${k} b${k} dmod`, `Rb${k} b${k} 0 ${470 + 3 * k}`);
    for (const [name, parts] of [['ammeters', [...amm, '.options savecurrents']], ['diodes', [...diodes, '.model dmod d', '.options savecurrents']]] as const) {
      const text = `* t\n${parts.join('\n')}\n.op\n.dc V1 0 9.9998 0.0001\n.end\n`;
      const r = await solveText(text, ngspice);
      expect(r.results.dc!.scale.values.length, name).toBeGreaterThan(99_990);
      expect(roundingNoise(r.netlist, r.results).by, name).toBe('exact');
      // Fresh copies made before the timing (a copy of 60 series of 99,999 points takes longer than the work timed).
      const copies = [0, 1, 2].map(() => structuredClone(r.results));
      const [ms] = leastWorkMs([() => describeResults(parseNetlist(text), copies.pop()!, r.run)], 3);
      expect(ms, name).toBeLessThan(name === 'ammeters' ? 100 : 50);
    }
  }, 120_000);
});

describe('after the critic of round 4 of the re-check\'s fixes', () => {
  const notes = (w: ResultsInWords): string[] => w.warnings.filter((m) => m.code === 'rounding-noise').map((m) => sp(m.why ?? ''));
  const series = (r: Awaited<ReturnType<typeof solveText>>, name: string): number[] => Array.from(shownSweep(r.netlist, r.results)!.series.find((s) => s.name === name)!.values);

  it('a sweep of a current source into a diode is decided exactly: each point\'s diode currents come from the source at that point, not at its netlist value, so a diode\'s I-V curve from 0 A shows 0 at rest in the .op and at I1 = 0 (it drew ngspice\'s 7.3e-32 A with an arrow)', async () => {
    const r = await solveText('* t\nI1 0 a 0\nD1 a 0 dmod\nR1 a 0 1k\n.model dmod d\n.op\n.dc I1 0 1m 0.25m\n.end\n', ngspice);
    expect(roundingNoise(r.netlist, r.results).by).toBe('exact');
    expect([node(r.words, 'a'), current(r.words, 'R1'), current(r.words, 'I1')]).toEqual(['0 V', 'no current through R1', 'no current through I1']);
    expect(r.words.nodes.find((n) => n.node === 'a')!.noise).toBe(7.323378444748195e-29);
    expect(notes(r.words)[0]).toContain('(D1 has 0 V across it, so it carries no current)');
    expect(notes(r.words)[1]).toContain('ngspice gave v(a) 7.323378e-29 V at I1 = 0 A');
    expect(series(r, 'v(a)')[0]).toBe(0);
    expect(series(r, 'v(a)')[4]).toBe(r.results.dc!.series.find((s) => s.name === 'v(a)')!.values[4]);
  });

  it('the bridge of C9o fed by a current source swept from 0 to 50 µA, read by an H of 1 GΩ, with a diode from ground to top: out is 0 V, and H1 and Rl carry 0 A with no power, in the .op and at every point (they were drawn as 444.1 pA, with 197.2 aW)', async () => {
    const r = await solveText('* t\nI1 0 top 50u\nR1 top a 180k\nR2 a 0 3.9meg\nR3 top b 18k\nR4 b 0 390k\nR5 a m 4.7\nVm m b 0\nH1 out 0 Vm 1g\nRl out 0 1k\nD1 0 top dmod\n.model dmod d\n.op\n.dc I1 0 50u 10u\n.end\n', ngspice);
    expect(roundingNoise(r.netlist, r.results).by).toBe('exact');
    const h1 = r.words.currents.find((c) => c.name === 'H1')!;
    expect([node(r.words, 'out'), current(r.words, 'H1'), current(r.words, 'Rl'), h1.power]).toEqual(['0 V', 'no current through H1', 'no current through Rl', undefined]);
    expect(h1.noise).toBe(4.440892098500626e-10);
    expect(series(r, 'v(out)')).toEqual([0, 0, 0, 0, 0, 0]);
    expect(series(r, 'i(h1)')).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
