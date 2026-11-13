/**
 * The rounding-noise rule after the critic of the last pass's fixes (13 November 2026; decision 0015, "After the last
 * pass"; C8b, C9w and C9x in docs/spice-facts/explanations.md), run on the real engine as the page runs a netlist
 * (solveText).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { solveText } from '../../src/app/model.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { describeResults, shownSweep } from '../../src/spice/describe.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { leastWorkMs } from './work-time.ts';

const root = resolve(import.meta.dirname, '../..');
let ngspice: NgspiceEngine;
beforeAll(async () => {
  ngspice = await NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(root, 'engine/dist/ngspice.wasm')));
});

const netlist = (...l: string[]): string => `* t\n${l.join('\n')}\n.end\n`;

describe('the sweep\'s words name a transistor inside a subcircuit by its terminals too (C6: "the current in q.x1.q1" four times)', () => {
  it('ngspice names it q.x1.q1 and m.x2.x3.m1: "the collector current of q.x1.q1", "the drain current of m.x2.x3.m1"', async () => {
    const r = await solveText(
      netlist('Vcc c 0 5', 'Ib 0 b 10u', 'X1 c b 0 amp', 'X2 c 0 mstage', '.subckt amp c b e', 'Q1 c b e qn', '.ends', '.subckt mstage d s', 'X3 d s inner', '.ends', '.subckt inner d s', 'M1 d g s s mn', 'Vg g s 2', '.ends', '.model qn npn(bf=100)', '.model mn nmos level=1 vto=1 kp=1m', '.options savecurrents', '.op', '.dc Vcc 0 5 1'),
      ngspice,
    );
    const speech = r.words.sweeps[0]!.speech;
    for (const said of ['the collector current of q.x1.q1 is 1 milliamp', 'the emitter current of q.x1.q1 is minus 1.01 milliamps', 'the base current of q.x1.q1 is 10 microamps', 'the substrate current of q.x1.q1 is 5 picoamps', 'the drain current of m.x2.x3.m1 is 500 microamps', 'the source current of m.x2.x3.m1 is minus 500 microamps', 'the gate current of m.x2.x3.m1 is 0 amps', 'the bulk current of m.x2.x3.m1 is minus 5.01 picoamps'])
      expect(speech).toContain(said);
    expect(speech).not.toMatch(/the current in (q|m)\.x/);
    // A source inside a subcircuit has one current: it keeps "the current in".
    expect(speech).toContain('the current in v.x2.x3.vg is 0 amps');
  });
});

describe('the work of a sweep\'s real values that ngspice gives as 0 is bounded with the sweep (C4)', () => {
  it('40 wires of 1 µΩ side by side into a 1 TΩ meter, swept over 45,000 points of 44 results, every wire\'s real current given as 0 at every point: each is shown exactly, and describeResults stays quick (it took 142 to 160 ms)', async () => {
    const wires = Array.from({ length: 40 }, (_, k) => `RW${k + 1} top m 1u`);
    const text = netlist('V1 top 0 10', ...wires, 'RM m 0 1T', '.op', '.dc V1 0 4.5 0.0001');
    const r = await solveText(text, ngspice);
    const dc = r.results.dc!;
    expect([dc.scale.values.length, dc.series.length]).toEqual([45_000, 44]);
    const given = dc.series.find((s) => s.name === 'i(@rw1[i])')!.values;
    const shown = shownSweep(r.netlist, r.results)!.series.find((s) => s.name === 'i(@rw1[i])')!.values;
    const last = dc.scale.values.length - 1;
    expect([given[1], given[last]]).toEqual([0, 0]);
    // 4.5 V over 1 TΩ, a fortieth through each wire (the exact value at ngspice's own last x).
    expect(shown[last]! / (dc.scale.values[last]! / 1e12 / 40)).toBeCloseTo(1, 12);
    expect(r.words.warnings.some((m) => m.code === 'rounded-to-0' && m.title === '41 results are not 0 at some points of the DC sweep, though ngspice gave 0')).toBe(true);
    const copies = [0, 1, 2].map(() => structuredClone(r.results));
    const [ms] = leastWorkMs([() => describeResults(parseNetlist(text), copies.pop()!, r.run)], 3);
    expect(ms).toBeLessThan(80);
  }, 120_000);
});
