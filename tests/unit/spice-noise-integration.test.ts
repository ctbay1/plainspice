/**
 * The rounding-noise rule after the integration check of the merged last-pass lanes (14 November 2026; decision 0015,
 * "After the integration check"; C9z in docs/spice-facts/explanations.md), run on the real engine as the page runs a
 * netlist (solveText).
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

const netlist = (...l: string[]): string => `* t\n${l.join('\n')}\n.end\n`;
const sp = (s: string | undefined): string => (s ?? '').replace(/[   ]/g, ' ');
const by = (r: Awaited<ReturnType<typeof solveText>>): string => roundingNoise(r.netlist, r.results).by;
const text = (w: ResultsInWords, name: string): string => sp(w.currents.find((c) => c.name === name)?.text);
const message = (w: ResultsInWords, code: string): string | undefined => {
  const m = w.warnings.find((x) => x.code === code);
  return m && `${sp(m.title)}: ${sp(m.why)}`;
};

describe('by the rule, a wire\'s current that ngspice gives as exactly 0 stays ngspice\'s 0: Kirchhoff\'s law gives nothing back (the fill of the last pass made currents up)', () => {
  it('a divider with a .param line, a 1 nΩ wire and a 10 MΩ load (c4-58): Rw keeps ngspice\'s 0, never "1.431 nA from node p to node n1", where the circuit makes 198 nA from n1 to p; without the .param line the exact solution warns that ngspice\'s 0 is off', async () => {
    const lines = ['V1 n0 0 3.3', 'R1 n0 n1 2.2k', 'Rw n1 p 1n', 'Rload p 0 10meg', '.options savecurrents', '.op'];
    const r = await solveText(netlist('.param rb=3.3k', 'R2 n1 0 {rb}', ...lines), ngspice);
    expect([by(r), text(r.words, 'Rw'), text(r.words, 'Rload')]).toEqual(['rule', 'no current through Rw', '198 nA from node p to ground through Rload']);
    expect(r.words.currents.find((c) => c.name === 'Rw')?.given).toBeUndefined();
    expect(message(r.words, 'rounded-to-0')).toBeUndefined();
    const plain = await solveText(netlist('R2 n1 0 3.3k', ...lines), ngspice);
    expect(message(plain.words, 'imprecise-answers')).toContain('Rw carries 198 nA, where ngspice gives 0 A');
  });

  it('r9731-503: a 1e-12 Ω wire beside an isolated transistor keeps ngspice\'s 0, never "461.5 µA from node a2 to node m4" (the circuit makes 261 fA there)', async () => {
    const r = await solveText(netlist('V1 top1 0 15', 'R1 top1 a2 68k', 'R2 a2 0 470k', 'R3 top1 b3 272k', 'R4 b3 0 1.88meg', 'R5 a2 m4 1e-12', 'R6 m4 b3 1k', 'R7 a2 s5 1e13', 'R8 s5 0 1u', 'Qx qc qb 0 qmod', 'Rqb qb 0 1meg', 'Rqc qc 0 1meg', '.model qmod npn', '.options savecurrents', '.op', '.tf v(a2) V1'), ngspice);
    expect([by(r), text(r.words, 'R5'), message(r.words, 'rounded-to-0')]).toEqual(['rule', 'no current through R5', undefined]);
  });

  it('4,500 wires of 1 µΩ in series into a 0 V ammeter and a 1 TΩ meter: each wire keeps the number ngspice gives it and describing the run does not overflow the stack (the fill recursed once a wire: "Maximum call stack size exceeded" from about 4,000 wires); 149 such wires are not drawn "1.735 pA" the wrong way', async () => {
    const chain = (n: number): string => netlist('V1 a 0 1.5', 'Ra a 1 1.5k', 'Rb 1 0 12', ...Array.from({ length: n }, (_, k) => `R${k + 1} ${k + 1} ${k + 2} 1u`), `Vm ${n + 1} q 0`, 'Rvm q 0 1t', '.options savecurrents', '.op');
    const long = await solveText(chain(4500), ngspice);
    expect([long.status, long.words.currents.length]).toEqual(['ok', 4505]);
    // ngspice's own numbers stay: it gives R2's two ends one step of a double apart, 1.735 pA through 1 µΩ, as at c520a49.
    expect([long.words.currents.filter((c) => c.given !== undefined).map((c) => c.name), text(long.words, 'R1'), text(long.words, 'R4500'), message(long.words, 'rounded-to-0')]).toEqual([[], 'no current through R1', 'no current through R4500', undefined]);
    const short = await solveText(chain(149), ngspice);
    expect([text(short.words, 'R1'), text(short.words, 'R149'), message(short.words, 'rounded-to-0')]).toEqual(['no current through R1', 'no current through R149', undefined]);
  }, 120_000);
});
