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
import { solveText } from '../../src/app/model.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { roundingNoise, type ResultsInWords } from '../../src/spice/describe.ts';

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
