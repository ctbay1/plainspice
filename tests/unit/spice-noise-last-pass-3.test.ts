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
    const [small, large] = [1500, 6000].map((n) => dividers(n));
    const runs = await Promise.all([small, large].map((text) => solveText(text, ngspice)));
    // Past MAX_PARTS: the rule decides, and every middle node is at 5 V, one double.
    for (const r of runs) expect(r.words.nodes.find((n) => n.node === 'n1')?.text.replace(/ /g, ' ')).toBe('5 V');
    const copies = runs.map((r) => [0, 1, 2].map(() => structuredClone(r.results)));
    const [a, b] = leastWorkMs([() => describeResults(parseNetlist(small!), copies[0]!.pop()!, runs[0]!.run), () => describeResults(parseNetlist(large!), copies[1]!.pop()!, runs[1]!.run)], 3);
    expect(b / a).toBeLessThan(7);
  }, 180_000);
});
