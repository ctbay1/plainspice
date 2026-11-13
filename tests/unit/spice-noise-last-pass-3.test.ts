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
import { describeResults } from '../../src/spice/describe.ts';
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
