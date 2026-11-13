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
import { DESCRIBE_STRINGS, type ResultsInWords } from '../../src/spice/describe.ts';

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

  it('the note for real values ngspice gave as 0: "3 currents and node9\'s voltage are not 0", "node9 7.324e-25 V"', async () => {
    const ladder = ['V1 n0 0 1.5', 'R1 n0 n1 1.5k', 'R2 n1 0 12', 'R3 n1 n2 1.5k', 'R4 n2 0 12', 'R5 n2 n3 1.5k', 'R6 n3 0 12', 'R7 n3 n4 1.5k', 'R8 n4 0 12', 'Rw n3 p 1u', 'Rvm p 0 1t'];
    const r = await solveText(netlist(...ladder, 'E1 node9 0 n3 p 1', 'Rl node9 0 1k', '.op'), ngspice);
    const lost = r.words.warnings.find((m) => m.code === 'rounded-to-0')!;
    expect(sp(lost.title)).toBe("3 currents and node9's voltage are not 0, though ngspice gave 0");
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

  it('a title that starts with a node: "Node out is shown as 0 V", but "node7 is shown as 0 V" and "node9\'s voltage is not 0"', () => {
    expect(DESCRIBE_STRINGS.noiseTitle([], ['out'])).toBe('Node out is shown as 0 V');
    expect(DESCRIBE_STRINGS.noiseTitle([], ['node7'])).toBe('node7 is shown as 0 V');
    expect(DESCRIBE_STRINGS.noiseTitle(['R5'], ['node7'])).toBe("R5's current is shown as 0 A, and node7 as 0 V");
    expect(DESCRIBE_STRINGS.lostTitle([], ['node9'])).toBe("node9's voltage is not 0, though ngspice gave 0");
    expect(DESCRIBE_STRINGS.lostTitle([], ['out'])).toBe("Node out's voltage is not 0, though ngspice gave 0");
    expect(DESCRIBE_STRINGS.lostGaveVoltage('node9')).toBe('node9 exactly 0 V');
    expect(DESCRIBE_STRINGS.lostIsAt('node9', '1 nV')).toBe('node9 is at 1 nV');
    expect(DESCRIBE_STRINGS.offVoltage('out', '4.5 V', '4.321 V')).toBe('node out is at 4.5 V, where ngspice gives 4.321 V');
  });
});

describe('the verb follows the unit word: "1 amp flows", "1 times 10 to the power minus 29 amps flow" (last pass: regress-4)', () => {
  it('a 1 nV source\'s exact 1e-29 A through R1 flow; a 1 A source\'s 1 amp flows', async () => {
    const r = await solveText(netlist('V1 top 0 1n', 'R1 top s 1', 'R2 s 0 1e20', 'Vm top v 0', 'R3 v 0 27k', '.options savecurrents', '.op'), ngspice);
    expect(r.words.currents.find((c) => c.name === 'R1')!.speech).toBe('1 times 10 to the power minus 29 amps flow from node top to node s through R1');
    expect(r.annotations.find((a) => a.line === 3)!.speech).toContain('1 times 10 to the power minus 29 amps flow from node top to node s');
    const one = await solveText(netlist('I1 0 a 1', 'R1 a 0 2', '.options savecurrents', '.op'), ngspice);
    expect(one.words.currents.find((c) => c.name === 'R1')!.speech).toBe('1 amp flows from node a to ground through R1');
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
