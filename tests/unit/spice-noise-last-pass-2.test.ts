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
