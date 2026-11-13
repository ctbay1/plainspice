/**
 * The last pass before milestone 2's release (13 November 2026, decision 0017, "After the last pass"):
 * .tf and other analysis lines inside subcircuits, and the words for lines ngspice skips. Every
 * netlist here runs through our engine; native ngspice 47 and 42 give the same numbers (facts A3f, A3g
 * and A3h in docs/spice-facts/explanations.md).
 *
 * - code review C3-6: `.tf v(x1.m) V1` asks about the node m inside the subcircuit X1 uses, by ngspice's
 *   name for it, so it is no error, and Explain says which node it is (A3h); so is a part there, v.x1.vs.
 * - regress-2: a gnd in the v( ) of a .tf inside a subcircuit an X line uses is ground, as at the top
 *   level (A3g); and the summary names every warning it counts, four and how many more.
 * - facts F3: when every analysis line is in a subcircuit no X line uses, the run's message and the
 *   status line say why nothing ran, and never "no results: no results".
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
import { explainNetlist, innerNode } from '../../src/spice/explain.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { checkTraps } from '../../src/spice/traps.ts';

const root = resolve(import.meta.dirname, '../..');
/** formatSI writes a no-break space between number and unit; expectations here use a plain space. */
const sp = (s: string | undefined): string => (s ?? '').replace(/\u00a0/g, ' ');
const tfErrors = (text: string): string[] => checkTraps(parseNetlist(text)).filter((c) => c.id === 'tf-problems').map((c) => c.title);

let engine: Promise<NgspiceEngine>;
beforeAll(() => {
  engine = NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(root, 'engine/dist/ngspice.wasm')));
});

/** A run of ngspice that gave nothing and said nothing (exit 0), as PlainSpice runs it. */
const nothing = (): RunResult => ({ ok: false, unreliable: false, exitCode: 0, stdout: '', stderr: '', plots: [], diagnostics: [], timings: { instantiateMs: 0, runMs: 0, parseMs: 0 } });

describe('code review C3-6: ngspice\'s name for a node inside a subcircuit (A3h)', () => {
  // The reviewer's netlist. Native 47 and 42: transfer_function = 0.5, output_impedance_at_v(x1.m) = 500, v1#input_impedance = 2000.
  const DIV = '* t\nV1 in 0 10\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\n.ends\n';
  const tf = (out: string): string => `${DIV}.tf v(${out}) V1\n.end\n`;

  it('v(x1.m) is the node m inside X1: no error, no warning, the numbers are answers, and Explain says which node it is', async () => {
    expect(tfErrors(tf('x1.m'))).toEqual([]);
    const s = await solve(tf('x1.m'), await engine);
    expect(s.status).toBe('ok');
    expect(s.words.warnings).toEqual([]);
    expect(sp(s.words.tf?.transferFunction?.text)).toBe('v(x1.m)/V1 = 0.5 (V/V)');
    expect(sp(s.words.tf?.outputResistance?.text)).toBe('output resistance at node x1.m: 500 Ω, the Thévenin resistance seen at node x1.m (ngspice calls it the output impedance)');
    expect(sp(s.words.summary)).toBe('Simulation finished: transfer function v(x1.m)/V1 = 0.5 (V/V); input resistance seen by V1: 2 kΩ; output resistance at node x1.m: 500 Ω. Open the results for details.');
    expect(explainNetlist(parseNetlist(tf('x1.m')))[8]!.notes).toEqual([
      "x1.m is ngspice's name for node m of the subcircuit div (from line 4), inside X1: ngspice names a node inside a subcircuit by its X line, then a dot.",
    ]);
  }, 30000);

  it('reads the name as ngspice does: capitals do not matter, an X line after .end counts, and a nested one is named by both X lines', async () => {
    expect(tfErrors(tf('X1.M'))).toEqual([]);
    expect(innerNode(parseNetlist(tf('X1.M')), 'x1.m')?.path).toEqual(['X1']);
    // Beside a node of the main circuit (native: v(x1.m,in), −0.5 and 500 Ω).
    const two = await solve(tf('x1.m,in'), await engine);
    expect([tfErrors(tf('x1.m,in')), two.status, sp(two.words.tf?.transferFunction?.text), two.words.tf?.at]).toEqual([[], 'ok', 'v(x1.m,in)/V1 = −0.5 (V/V)', 'between node x1.m and node in']);
    // ngspice reads the lines after a plain .end (S25): an X line there places the subcircuit too.
    const late = '* t\nV1 in 0 10\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\n.ends\n.tf v(x1.m) V1\n.end\nX1 in out div\n';
    expect(tfErrors(late)).toEqual([]);
    expect((await solve(late, await engine)).words.warnings.map((w) => w.code)).toEqual([]);
    // X1 places outer, whose X2 places inner: ngspice names inner's m x1.x2.m, and outer's own n x1.n (0.25 and 0.625).
    const NEST = '* t\nV1 in 0 10\nX1 in out outer\nR9 out 0 1k\n.subckt outer p q\nR1 p n 1k\nX2 n q inner\n.ends\n.subckt inner a b\nR2 a m 1k\nR3 m 0 1k\nR4 m b 1k\n.ends\n';
    for (const [node, ratio] of [['x1.x2.m', '0.25'], ['x1.n', '0.625']] as const) {
      const text = `${NEST}.tf v(${node}) V1\n.end\n`;
      expect(tfErrors(text), node).toEqual([]);
      const s = await solve(text, await engine);
      expect([s.status, sp(s.words.tf?.transferFunction?.text)], node).toEqual(['ok', `v(${node})/V1 = ${ratio} (V/V)`]);
    }
    expect(explainNetlist(parseNetlist(`${NEST}.tf v(x1.x2.m) V1\n.end\n`))[13]!.notes).toEqual([
      "x1.x2.m is ngspice's name for node m of the subcircuit inner (from line 9), inside X2, inside X1: ngspice names a node inside a subcircuit by its X lines, each followed by a dot.",
    ]);
  }, 30000);

  it('keeps the error for a dotted name that is no node: a node of the .subckt line, one the subcircuit lacks, an X line the circuit lacks', async () => {
    // Native 47 and 42 give each of these a new node with nothing on it: a transfer function of 0 and 1 Ω (tf-problems-1).
    for (const out of ['x1.a', 'x1.zz', 'x9.m']) {
      expect(tfErrors(tf(out)), out).toEqual([`.tf asks about node ${out}, which is not in the circuit`]);
      const s = await solve(tf(out), await engine);
      expect([sp(s.words.tf?.transferFunction?.text), s.words.warnings.map((w) => w.title)], out).toEqual([`v(${out})/V1 = 0 (V/V)`, [`${out} is not a node of the circuit`]]);
    }
    // X2 only inside a subcircuit no X line uses places nothing: x2.m is no node (0 and 1 Ω natively).
    const unused = '* t\nV1 in 0 10\nR9 in 0 1k\n.subckt outer p q\nX2 p q div\n.ends\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\n.ends\n.tf v(x2.m) V1\n.end\n';
    expect(tfErrors(unused)).toEqual(['.tf asks about node x2.m, which is not in the circuit']);
    // A node a .global line names is the main circuit's: x1.vdd is no node (0 and 1 Ω natively), x1.m still is.
    const global = (out: string): string => `* t\n.global vdd\nV1 in 0 10\nVd vdd 0 2\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m vdd 1k\nR3 m b 1\n.ends\n.tf v(${out}) V1\n.end\n`;
    expect(tfErrors(global('x1.vdd'))).toEqual(['.tf asks about node x1.vdd, which is not in the circuit']);
    expect(tfErrors(global('x1.m'))).toEqual([]);
  }, 30000);

  it('v.x1.vs, ngspice\'s name for the source Vs inside X1, is a part: the .tf input or its i( ), and Explain says which (code skeptic)', async () => {
    // Native 47 and 42: v(out)/v.x1.vs = 0.3333 with 1.5 kΩ; i(v.x1.vs)/V1 = 3.333e-4; i.x1.is as the input gives 500 V/A.
    const VS = '* t\nV1 in 0 10\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\nVs m q 0\nR4 q 0 1k\n.ends\n';
    const input = `${VS}.tf v(out) v.x1.vs\n.end\n`;
    expect(tfErrors(input)).toEqual([]);
    const s = await solve(input, await engine);
    expect([s.status, sp(s.words.tf?.transferFunction?.text), sp(s.words.tf?.inputResistance?.text)]).toEqual(['ok', 'v(out)/v.x1.vs = 0.3333 (V/V)', 'input resistance seen by v.x1.vs: 1.5 kΩ (ngspice calls it the input impedance)']);
    const line = explainNetlist(parseNetlist(input))[10]!;
    expect(line.fields.find((f) => f.label === 'input source')?.meaning).toBe('the input: v.x1.vs, the voltage source on line 8');
    expect(line.notes).toEqual(["v.x1.vs is ngspice's name for Vs of the subcircuit div (from line 4), inside X1: ngspice names a part inside a subcircuit by its first letter, its X line and its own name, joined by dots."]);
    const current = `${VS}.tf i(v.x1.vs) V1\n.end\n`;
    expect(tfErrors(current)).toEqual([]);
    expect(sp((await solve(current, await engine)).words.tf?.transferFunction?.text)).toBe('i(v.x1.vs)/V1 = 3.333e-4 (A/V)');
    const isource = '* t\nV1 in 0 10\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\nIs 0 m 1m\n.ends\n.tf v(out) i.x1.is\n.end\n';
    expect(tfErrors(isource)).toEqual([]);
    expect(sp((await solve(isource, await engine)).words.tf?.transferFunction?.text)).toBe('v(out)/i.x1.is = 500 (V/A)');
    // x1.vs is no name of a part (0 and 1e20 Ω natively): the error stays.
    expect(tfErrors(`${VS}.tf i(x1.vs) V1\n.end\n`)).toEqual(['i(x1.vs) needs a voltage source']);
  }, 30000);
});

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
    // The gnd on a + line, after a comment line: the parser's own reading of the whole line (native: v(out,0), 1/3).
    const continued = await solve(SUB('v(out,\n* a comment between\n+ gnd)'), await engine);
    expect([continued.words.tf?.at, continued.words.warnings]).toEqual(['between node out and ground', []]);
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

describe('facts F3: every analysis line in a subcircuit no X line uses (A3f)', () => {
  const ALONE = (line: string, v1 = '5'): string => `* t\nV1 in 0 ${v1}\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n${line}\n.ends\n.end\n`;
  const WHY = 'ngspice skips an analysis line between .subckt and .ends when no X line uses that subcircuit, so it ran nothing, and with a results file it says nothing about it. Put analysis lines in the main circuit, outside .subckt … .ends.';

  it('the run\'s message and the status line say why nothing ran, with the line to go to', async () => {
    const s = await solve(ALONE('.tf v(a,gnd) V1'), await engine);
    expect(s.status).toBe('failed');
    expect(s.words.warnings.map((m) => [m.code, m.severity, m.title, m.why, m.line])).toEqual([['no-analysis', 'error', '.tf is inside the subcircuit s, which no X line uses', WHY, 7]]);
    expect(s.words.summary).toBe('ngspice finished but gave no results: .tf is inside the subcircuit s, which no X line uses. Open the results for details.');
    for (const line of ['.op', '.dc V1 0 5 1', '.tran 1m 5m']) {
      expect((await solve(ALONE(line), await engine)).words.warnings[0]?.title, line).toBe(`${line.split(' ')[0]} is inside the subcircuit s, which no X line uses`);
    }
  }, 30000);

  it('comes before a note ngspice printed, which is no reason (.ac and .noise: "has no value")', async () => {
    for (const line of ['.ac dec 1 1k 10k', '.noise v(out) V1 dec 1 1k 10k']) {
      const s = await solve(ALONE(line, 'AC 1'), await engine);
      expect(s.words.warnings.map((m) => [m.severity, m.title]), line).toEqual([
        ['error', `${line.split(' ')[0]} is inside the subcircuit s, which no X line uses`],
        ['note', 'V1 has no value: 0 V'],
      ]);
      expect(s.words.summary, line).toBe(`ngspice finished but gave no results: ${line.split(' ')[0]} is inside the subcircuit s, which no X line uses. Open the results for details.`);
    }
  }, 30000);

  it('names several lines together, and says nothing of the kind where ngspice runs an analysis', async () => {
    const one = '* t\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.op\n.tf v(out) V1\n.ends\n.end\n';
    expect((await solve(one, await engine)).words.warnings.map((m) => m.title)).toEqual(['The analysis lines are inside the subcircuit s, which no X line uses']);
    const two = '* t\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.op\n.ends\n.subckt t c d\nR8 c d 1k\n.tf v(out) V1\n.ends\n.end\n';
    expect((await solve(two, await engine)).words.warnings.map((m) => m.title)).toEqual(['The analysis lines are inside subcircuits that no X line uses']);
    // An X line uses it: ngspice runs the line as the main circuit's (A3f), 1/3.
    const used = (await solve(ALONE('.tf v(out) V1').replace('.end\n', 'X1 out 0 s\n.end\n'), await engine)).words;
    expect([used.status, used.warnings]).toEqual(['ok', []]);
    // An analysis line in the main circuit too: it runs, and its results are the words.
    expect((await solve(ALONE('.tf v(a,gnd) V1').replace('.end\n', '.op\n.end\n'), await engine)).words.status).toBe('ok');
  }, 30000);

  it('never says "no results" twice: with no message from ngspice, the summary says so once', () => {
    const empty = describeResults(parseNetlist('* t\nR1 a 0 1\n.op\n'), { other: [] }, nothing());
    expect(empty.warnings.map((m) => m.title)).toEqual(['No results']);
    expect(empty.summary).toBe('ngspice finished without writing any results, and it printed no message that says why. Open the results for details.');
    expect(empty.summarySpeech).toBe(empty.summary);
  });
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

// ------------------------------------------------------------------ the round-1 critic of these fixes

describe('critic1-7: a .tf inside a used subcircuit with 200,000 continuation lines is explained', () => {
  it('explains it without overflowing the stack (Math.max over every continuation line did, at 150,000)', () => {
    const k = 200000;
    const text = `* t\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nX1 out 0 s\n.subckt s a b\nR9 a b 1k\n.tf v(out,gnd)\n${'+ \n'.repeat(k)}+ V1\n.ends\n.end\n`;
    const ex = explainNetlist(parseNetlist(text));
    expect(ex[7]?.heading).toBe('.tf: transfer function');
  }, 60000);
});
