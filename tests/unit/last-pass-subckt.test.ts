/**
 * The last pass before milestone 2's release (13 November 2026, decision 0017, "After the last pass"):
 * .tf and other analysis lines inside subcircuits, and the words for lines ngspice skips. Every
 * netlist here runs through our engine; native ngspice 47 and 42 give the same numbers (facts A3f and A3g
 * in docs/spice-facts/explanations.md).
 *
 * - regress-2: a gnd in the v( ) of a .tf inside a subcircuit an X line uses is ground, as at the top
 *   level (A3g); and the summary names every warning it counts, four and how many more.
 * - facts F2: ngspice "skips" those lines, the word for a whole line it does not read (W11).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import type { RunResult } from '../../src/engine/types.ts';
import { solve } from '../../src/notebook/index.ts';
import { describeCircuit, describeResults } from '../../src/spice/describe.ts';
import { explainNetlist } from '../../src/spice/explain.ts';
import { parseNetlist } from '../../src/spice/parse.ts';

const root = resolve(import.meta.dirname, '../..');
/** formatSI writes a no-break space between number and unit; expectations here use a plain space. */
const sp = (s: string | undefined): string => (s ?? '').replace(/\u00a0/g, ' ');

let engine: Promise<NgspiceEngine>;
beforeAll(() => {
  engine = NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(root, 'engine/dist/ngspice.wasm')));
});

/** A run of ngspice that gave nothing and said nothing (exit 0), as PlainSpice runs it. */
const nothing = (): RunResult => ({ ok: false, unreliable: false, exitCode: 0, stdout: '', stderr: '', plots: [], diagnostics: [], timings: { instantiateMs: 0, runMs: 0, parseMs: 0 } });

describe('regress-2: a gnd in a .tf inside a subcircuit an X line uses is ground (A3g)', () => {
  // ngspice runs such a .tf as the main circuit's (A3f) and turns gnd into 0 on every line first:
  // native 47 and 42 name the output v(out,0) and give 1/3 and 333.3 Ω; v(a,gnd) is v(a,0), 0 and 1 Ω.
  const SUB = (out: string): string => `* t\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.tf ${out} V1\n.ends\nX1 out 0 s\n.end\n`;
  const every = (text: string, w: Awaited<ReturnType<typeof solve>>['words']): string => {
    const n = parseNetlist(text);
    return [w.summary, w.summarySpeech, ...w.warnings.flatMap((m) => [m.title, m.why]), w.tf?.at, w.tf?.transferFunction?.speech, w.tf?.outputResistance?.text,
      ...explainNetlist(n).flatMap((e) => [e.summary, ...e.fields.map((f) => f.meaning), ...e.notes])].join('\n');
  };

  it('v(out,gnd) there is measured from ground: no warning, and nothing calls gnd a node', async () => {
    const text = SUB('v(out,gnd)');
    const s = await solve(text, await engine);
    expect(s.status).toBe('ok');
    expect(s.words.warnings).toEqual([]);
    expect(s.words.tf?.at).toBe('between node out and ground');
    expect(s.words.tf?.transferFunction?.speech).toBe('the transfer function from V1 to the voltage between node out and ground is 0.3333 volts per volt');
    const line = explainNetlist(parseNetlist(text))[6]!;
    expect(line.fields.find((f) => f.label === 'output')?.meaning).toBe('the output: the voltage at node out, measured from ground');
    expect(line.notes).toEqual([]);
    expect(every(text, s.words)).not.toMatch(/"gnd"|node gnd/);
    // v(gnd) alone there is v(0), ground's own voltage, as at the top level (A3b).
    expect((await solve(SUB('v(gnd)'), await engine)).words.tf?.at).toBe('at ground');
  }, 30000);

  it('v(a,gnd) there: one warning, for a, which ngspice makes a new node with nothing on it; gnd is ground', async () => {
    const text = SUB('v(a,gnd)');
    const s = await solve(text, await engine);
    expect(s.words.warnings.map((w) => w.title)).toEqual(['a is not a node of the circuit']);
    expect(s.words.tf?.at).toBe('between node a and ground');
    expect(sp(s.words.summary)).toBe('Simulation finished: transfer function v(a,gnd)/V1 = 0 (V/V); input resistance seen by V1: 1.5 kΩ; output resistance between node a and ground: 1 Ω. 1 warning: a is not a node of the circuit. Open the results for details.');
    expect(explainNetlist(parseNetlist(text))[6]!.notes).toEqual(['a is not a node of the circuit: ngspice says nothing and reports a transfer function of 0.']);
    expect(every(text, s.words)).not.toMatch(/"gnd"|node gnd/);
  }, 30000);

  it('beside an ordinary node called gnd, the .tf\'s gnd is still ground (native: v(out,0), 1/3)', async () => {
    const text = '* t\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nR3 in x 1k\nVx x gnd\nR4 x 0 1k\n.subckt s a b\nR9 a b 1k\n.tf v(out,gnd) V1\n.ends\nX1 out 0 s\n.end\n';
    const s = await solve(text, await engine);
    expect([s.words.tf?.at, sp(s.words.tf?.transferFunction?.text)]).toEqual(['between node out and ground', 'v(out,gnd)/V1 = 0.3333 (V/V)']);
  }, 30000);

  it('the summary names every warning it counts: the first four, then how many more', async () => {
    const two = await solve('* t\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.tf v(zz,yy) V1\n.end\n', await engine);
    expect(sp(two.words.summary)).toContain('. 2 warnings: zz is not a node of the circuit; yy is not a node of the circuit. Open the results for details.');
    expect(two.words.summarySpeech).toContain('. 2 warnings: zz is not a node of the circuit; yy is not a node of the circuit. Open the results for details.');
    // Five and six resistors of 0 Ω: ngspice 47 warns for each (P13).
    const zeros = (k: number): string => `* t\nV1 in 0 5\nR0 in n0 1k\n${Array.from({ length: k }, (_, i) => `R${i + 1} n${i} ${i === k - 1 ? '0' : `n${i + 1}`} 0`).join('\n')}\nR9 n0 0 1k\n.op\n.end\n`;
    const four = 'R1 is too small for ngspice; R2 is too small for ngspice; R3 is too small for ngspice; R4 is too small for ngspice';
    const five = await solve(zeros(5), await engine);
    expect(five.words.warnings.filter((m) => m.severity !== 'note')).toHaveLength(5);
    expect(five.words.summary).toContain(`. 5 warnings: ${four}; and 1 more warning. Open the results for details.`);
    const six = await solve(zeros(6), await engine);
    expect(six.words.summary).toContain(`. 6 warnings: ${four}; and 2 more warnings. Open the results for details.`);
    expect(six.words.summarySpeech).toContain(`. 6 warnings: ${four}; and 2 more warnings. Open the results for details.`);
  }, 30000);
});

describe('facts F2: ngspice "skips" an analysis line in a subcircuit no X line uses (W11)', () => {
  it('Explain\'s note and the overview say "skips", never "ignores", for those lines', () => {
    const text = '* t\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.tf v(a,gnd) V1\n.ends\n.end\n';
    const n = parseNetlist(text);
    const note = explainNetlist(n)[6]!.notes;
    expect(note).toEqual(['ngspice skips this line: it is inside the subcircuit s (from line 5), and no X line uses that subcircuit. Put analysis lines in the main circuit, outside .subckt … .ends.']);
    expect(describeCircuit(n)).toContain('Its analysis lines are inside a subcircuit that no X line uses, where ngspice skips them, so ngspice will run nothing.');
    expect([...note, describeCircuit(n), describeResults(n, { other: [] }, nothing()).warnings[0]!.why].filter((x) => /ignor/.test(x))).toEqual([]);
  });
});
