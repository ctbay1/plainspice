/**
 * The card's "across it" readout for a part whose ends are at the same voltage (words re-check 1;
 * decision 0015): 0 V with no "is higher" line, as the part's "0 A through it" and the drawing say,
 * whatever ngspice's last bits are (C9: v(a) = 4.499999999999999 against v(b) = 4.5). A part with a
 * real voltage across it keeps it: V1 and F1 in C9b carry rounding noise but have 12 V across them.
 * Run with the real engine, as the page runs a netlist.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { cardContent, type CardState } from '../../src/app/card.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { NOTEBOOK_OPTIONS, solve, type Solution } from '../../src/notebook/index.ts';
import { buildSchematic } from '../../src/schematic/index.ts';

const root = resolve(import.meta.dirname, '../..');
let ngspice: NgspiceEngine;
beforeAll(async () => {
  ngspice = await NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(root, 'engine/dist/ngspice.wasm')));
});

const sp = (s: string): string => s.replace(/[  ]/g, ' ');
const C9 = '* bridge\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\n.op\n.end\n';
const C9B = '* circuit\nV1 in 0 12\nR1 in a 1k\nR2 a x 2k\nVm x gnd\nR3 a b 3k\nF1 0 b V1 2\n.op\n.end\n';

/** A part's card on `text`, solved by the real engine; `before` is the run the card opened on. */
async function card(text: string, name: string, before?: Solution): Promise<{ through?: string; across: { value: string; sub: string[]; speech: string; was?: string } }> {
  const sol = await solve(text, ngspice);
  const s = buildSchematic(text, NOTEBOOK_OPTIONS);
  const part = s.circuit.parts.find((p) => p.name === name)!;
  const state: CardState = { key: part.key, start: part.valueText, input: part.valueText, before, session: 1, kept: part.valueText };
  const readouts = cardContent(part, state, s, sol, text).readouts;
  const through = readouts.find((r) => r.tone === 'current');
  const across = readouts.find((r) => r.tone === 'voltage')!;
  const out = { across: { value: sp(across.value), sub: (across.sub ?? []).map(sp), speech: sp(across.speech), ...(across.was ? { was: sp(across.was) } : {}) } };
  return through ? { through: sp(through.value), ...out } : out;
}

describe('the card says 0 V across a part whose ends are at the same voltage (words re-check 1)', () => {
  it('C9: R5 is 0 A through it and 0 V across it, with no "node b is higher" and no attovolts in its speech', async () => {
    const r5 = await card(C9, 'R5');
    expect(r5.through).toBe('0 A');
    expect(r5.across.value).toBe('0 V');
    expect(r5.across.sub).toEqual(['V(a) − V(b) = 0 V']);
    expect(r5.across.speech).toBe('0 volts across R5. V(a) minus V(b) is 0 volts');
  });

  it('C9b: R1 and R3 are 0 V across them; V1 and F1, whose currents are noise too, keep their real 12 V', async () => {
    expect((await card(C9B, 'R1')).across.value).toBe('0 V');
    expect((await card(C9B, 'R3')).across.value).toBe('0 V');
    const v1 = await card(C9B, 'V1');
    expect([v1.through, v1.across.value, v1.across.sub[0]]).toEqual(['0 A', '12 V', 'node in is higher']);
    const f1 = await card(C9B, 'F1');
    expect([f1.through, f1.across.value, f1.across.sub[0]]).toEqual(['0 A', '12 V', 'node b is higher']);
  });

  it('C9l: a real 2.696 fA keeps its real 2.696 pV across R5', async () => {
    const r5 = await card(C9.replace('.op', 'Rvm a 0 1e15\n.op'), 'R5');
    expect([r5.through, r5.across.value, r5.across.sub[0]]).toEqual(['2.696 fA', '2.696 pV', 'node b is higher']);
  });

  it('an F that copies a 0 into R6, tied to a node at 5 V: R6 is 0 V across it, V2 keeps its 5 V', async () => {
    const text = '* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a m 1k\nVm m b 0\nF1 0 out Vm 1000\nR6 out q 1k\nV2 q 0 5\n.op\n.end\n';
    expect((await card(text, 'R6')).across.value).toBe('0 V');
    expect((await card(text, 'V2')).across.value).toBe('5 V');
  });

  it('the crossed-out number from before the last change is 0 V too, never 888.2 aV', async () => {
    const before = await solve(C9, ngspice);
    const now = C9.replace('R2 a 0 10k', 'R2 a 0 12k');
    const r5 = await card(now, 'R5', before);
    expect(r5.across.was).toBe('0 V');
    expect(r5.across.value).not.toBe('0 V');
  });
});

describe('after the critic of the re-check\'s fixes: the card keeps Ohm\'s law where ngspice\'s numbers and the exact solution meet', () => {
  it('the rule for other circuits: the H of 1 GΩ shows Rl\'s 193.5 pA, so the card says the 193.5 nV across it, not 0 V; with a diode, solved exactly, Rl carries 0 A with 0 V across', async () => {
    // .temp 27: a line PlainSpice does not model exactly (the rule decides); ngspice runs at 27 °C anyway.
    const text = '* t\nV1 top 0 9\nR1 top a 180k\nR2 a 0 3.9meg\nR3 top b 18k\nR4 b 0 390k\nR5 a m 4.7\nVm m b 0\nH1 out 0 Vm 1g\nRl out 0 1k\n.temp 27\n.op\n.end\n';
    const rl = await card(text, 'Rl');
    expect([rl.through, rl.across.value, rl.across.sub]).toEqual(['193.5 pA', '193.5 nV', ['ground is higher', 'V(out) − V(0) = −193.5 nV']]);
    // R5 keeps ngspice's 378 aA, in series with Vm's 193.5 aA (H1 makes out from it), and the 17.76 fV across it.
    expect((await card(text, 'R5')).across.value).toBe('1.776 fV');
    const diode = text.replace('.temp 27', 'D1 0 top dmod\n.model dmod d');
    const exact = await card(diode, 'Rl');
    expect([exact.through, exact.across.value]).toEqual(['0 A', '0 V']);
  });

  it('a 1 nΩ wire whose real 454.1 pA ngspice gives as 0 (both its ends the same number): the card says the exact 4.541e-19 V across it', async () => {
    const text = '* t\nV1 top1 0 1.5\nR1 top1 d2 270k\nR2 d2 0 820\nR3 d2 p3 1n\nR4 p3 0 10meg\n.op\n.end\n';
    const r3 = await card(text, 'R3');
    expect([r3.through, r3.across.value, r3.across.sub]).toEqual(['454.1 pA', '4.541e-19 V', ['node d2 is higher', 'V(d2) − V(p3) = 4.541e-19 V']]);
  });

  it('an E reading the balanced bridge carries a real 5 mA between two nodes at exactly 5 V: 0 V across it, and no power', async () => {
    const text = '* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nV2 x 0 5\nE1 x y a b 1000\nRy y 0 1k\n.op\n.end\n';
    const sol = await solve(text, ngspice);
    // ngspice leaves y 8.9e-13 V below x: with it, E1 would absorb 4.4 fW.
    expect(sol.words.nodes.find((n) => n.node === 'y')!.value).not.toBe(5);
    const e1 = await card(text, 'E1');
    expect([e1.through, e1.across.value]).toEqual(['5 mA', '0 V']);
    expect(sol.words.currents.find((c) => c.name === 'E1')!.power).toBeUndefined();
  });
});
