/**
 * src/spice/describe.ts without the engine: the circuit overview, results in words from made-up
 * results (directions, power, ammeters, .tf, sweeps, messages, the live summary), the notes for
 * the editor, and the plain words for every diagnostic code. The same words on real engine runs
 * are checked in tests/golden/facts-explain.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AnalysisResults } from '../../src/engine/results.ts';
import type { EngineDiagnostic, RawPlot, RunResult } from '../../src/engine/types.ts';
import { DESCRIBE_STRINGS, DESCRIBED_PARTS, annotateLines, describeCircuit, describeResults, explainDiagnostic, roundingNoise, sentenceNode } from '../../src/spice/describe.ts';
import { parseNetlist } from '../../src/spice/parse.ts';

const MINUS = '−';
const root = resolve(import.meta.dirname, '../..');
/** formatSI writes a no-break space between number and unit; expectations here use a plain space. */
const sp = (s: string | undefined): string => (s ?? '').replace(/ /g, ' ');

function run(partial: Partial<RunResult> = {}): RunResult {
  return {
    ok: true,
    unreliable: false,
    exitCode: 0,
    stdout: '',
    stderr: '',
    plots: [],
    diagnostics: [],
    timings: { instantiateMs: 0, runMs: 0, parseMs: 0 },
    ...partial,
  };
}

type Origin = 'branch' | 'device';
function op(nodes: Record<string, number>, currents: [element: string, value: number, origin: Origin][] = []): AnalysisResults {
  return {
    op: {
      nodes: Object.entries(nodes).map(([node, value]) => ({ node, value })),
      currents: currents.map(([element, value, origin]) => ({ element, value, origin, vector: origin === 'branch' ? `i(${element})` : `i(@${element}[i])` })),
    },
    other: [],
  };
}

const diag = (code: string, text: string, extra: Partial<EngineDiagnostic> = {}): EngineDiagnostic => ({
  severity: 'error',
  code,
  text,
  ...extra,
});

const F5 = '* F5\nItest 0 a 1\nVx a x 0\nR2 x n1 2\nR1 n1 0 4\nF1 0 n1 Vx 2\n.options savecurrents\n.op\n.end\n';
const F5_RESULTS = op({ a: 14, x: 14, n1: 12 }, [
  ['vx', 1, 'branch'],
  ['itest', 1, 'device'],
  ['r2', 1, 'device'],
  ['r1', 3, 'device'],
  ['f1', 2, 'device'],
]);

describe('describeCircuit', () => {
  it('says what every 0 V source is, without a purpose it may not have: the turned-off source of a Thevenin example too (student review)', () => {
    const rth = readFileSync(join(root, 'examples/p02/p02-2-test-current.cir'), 'utf8');
    const meter = readFileSync(join(root, 'examples/sp01/sp01-2-ammeter.cir'), 'utf8');
    const said = (text: string): string => sp(describeCircuit(parseNetlist(text)));
    expect(said(rth)).toContain('V1: a 0 V source from node s to ground: a wire, through which ngspice measures the current (the ammeter trick).');
    expect(said(meter)).toContain('Vm: a 0 V source from node n2 to node n2b: a wire, through which ngspice measures the current (the ammeter trick).');
    for (const text of [rth, meter]) expect(said(text)).not.toContain('used as an ammeter');
  });

  it('describes F5 in netlist order, as the brief asks', () => {
    expect(sp(describeCircuit(parseNetlist(F5)))).toBe(
      '5 parts and 3 nodes besides ground (a, x, n1). Itest: a 1 A current source pushing current from ground into node a. Vx: a 0 V source from node a to node x: a wire, through which ngspice measures the current (the ammeter trick). R2: a 2 Ω resistor between node x and node n1. R1: a 4 Ω resistor between node n1 and ground. F1: a current-controlled current source pushing 2 × the current in Vx from ground into node n1. Analysis: operating point.',
    );
  });

  it('describes every explained letter', () => {
    const text = sp(
      describeCircuit(
        parseNetlist('* t\nV1 c 0 2\nVs c d 0\nR1 d 0 1k\nC1 d 0 1u\nL1 d e 1m\nE1 o1 0 c 0 2\nG1 0 o2 c 0 0.5\nF1 0 o3 Vs 3\nH1 o4 0 Vs 4\nI1 0 o5 1m\nK1 L1 L2 0.9\nL2 f 0 1m\nVp p 0 PULSE(0 5 0 1u 1u 1 2)\n.op\n'),
      ),
    );
    expect(text).toContain(`V1: a 2 V source with its + side at node c and its ${MINUS} side at ground.`);
    expect(text).toContain('Vs: a 0 V source from node c to node d: a wire, through which ngspice measures the current (the ammeter trick).');
    expect(text).toContain('R1: a 1 kΩ resistor between node d and ground.');
    expect(text).toContain('C1: a 1 µF capacitor between node d and ground.');
    expect(text).toContain('L1: a 1 mH inductor between node d and node e.');
    expect(text).toContain('E1: a voltage-controlled voltage source: the voltage at node o1, measured from ground, is 2 × the voltage at node c, measured from ground.');
    expect(text).toContain('G1: a voltage-controlled current source pushing 500 mA for every volt at node c, from ground into node o2.');
    expect(text).toContain('F1: a current-controlled current source pushing 3 × the current in Vs from ground into node o3.');
    expect(text).toContain('H1: a current-controlled voltage source: the voltage at node o4, measured from ground, is 4 V for every amp in Vs.');
    expect(text).toContain('I1: a 1 mA current source pushing current from ground into node o5.');
    expect(text).toContain('K1: couples L1 and L2 (coupling 0.9).');
    expect(text).toContain(`Vp: a PULSE voltage source with its + side at node p and its ${MINUS} side at ground.`);
  });

  it('describes other parts with their node labels and model', () => {
    const text = sp(describeCircuit(parseNetlist('* t\nD1 a 0 dmod\nQ1 c b 0 qn\nX1 a b amp\n.model dmod D\n.model qn NPN\n.op\n')));
    expect(text).toContain(`D1: a diode (+ node a, ${MINUS} side at ground, model dmod).`);
    expect(text).toContain('Q1: a bipolar junction transistor (collector at node c, base at node b, emitter at ground, model qn).');
    expect(text).toContain('X1: a subcircuit (node a and node b, subcircuit amp).');
  });

  it('says when nothing is connected to ground, when there are no parts, and when nothing will run (M1, M20)', () => {
    expect(sp(describeCircuit(parseNetlist('* t\nV1 a b 6\nR1 a b 2\n.op\n')))).toContain('2 parts and 2 nodes (a, b). Nothing is connected to ground (node 0).');
    expect(describeCircuit(parseNetlist('* empty\n'))).toBe('No parts yet. No analysis line (.op, .dc, .tran, .tf or .ac), so ngspice will run nothing.');
  });

  it('leaves the parts of a subcircuit out of the count and names the subcircuit', () => {
    const text = describeCircuit(parseNetlist('* t\n.subckt amp in out\nRin in out 1k\n.ends\nX1 a 0 amp\nR1 a 0 1\n.op\n'));
    expect(text).toMatch(/^2 parts and 1 node besides ground \(a\)\./);
    expect(text).toContain('1 subcircuit definition (amp).');
    expect(text).not.toContain('Rin');
  });

  it('lists the analyses with their numbers', () => {
    const text = sp(describeCircuit(parseNetlist('* t\nV1 a 0 0\nR1 a 0 1\n.op\n.dc V1 0 12 1\n.tran 10u 5m\n.tf v(a) V1\n.ac dec 10 1 1k\n')));
    expect(text).toContain(
      'Analyses: operating point; DC sweep of V1 from 0 V to 12 V in steps of 1 V (13 points); transient, from 0 to 5 ms; transfer function from V1 to v(a); AC analysis from 1 Hz to 1 kHz.',
    );
  });
});

describe('describeResults: node voltages and currents', () => {
  const words = describeResults(parseNetlist(F5), F5_RESULTS, run());

  it('gives every node its value in text and in speech, in netlist order, with its colour', () => {
    expect(words.status).toBe('ok');
    expect(words.nodes.map((n) => [n.node, sp(n.text), n.speech, n.colourIndex])).toEqual([
      ['a', '14 V', '14 volts', 0],
      ['x', '14 V', '14 volts', 1],
      ['n1', '12 V', '12 volts', 2],
    ]);
  });

  it('gives every current its direction from SPICE\'s sign, and each source its power (C1–C5)', () => {
    expect(words.currents.map((c) => [c.name, sp(c.text), c.from, c.to, c.ammeter, sp(c.power?.text)])).toEqual([
      ['Itest', '1 A from ground to node a through Itest', '0', 'a', false, 'Itest delivers 14 W'],
      ['Vx', 'Vx measures 1 A flowing from node a to node x', 'a', 'x', true, ''],
      ['R2', '1 A from node x to node n1 through R2', 'x', 'n1', false, ''],
      ['R1', '3 A from node n1 to ground through R1', 'n1', '0', false, ''],
      ['F1', '2 A from ground to node n1 through F1', '0', 'n1', false, 'F1 delivers 24 W'],
    ]);
    expect(words.currents[0]).toMatchObject({ element: 'itest', line: 2, value: 1 });
    expect(words.currents.find((c) => c.name === 'R1')?.speech).toBe('3 amps flow from node n1 to ground through R1');
    expect(words.currents.find((c) => c.name === 'R2')?.speech).toBe('1 amp flows from node x to node n1 through R2');
    expect(words.currents.find((c) => c.name === 'Vx')?.speech).toBe('Vx measures 1 amp flowing from node a to node x');
    expect(words.currents.find((c) => c.name === 'F1')?.power).toMatchObject({ watts: 24, delivers: true, speech: 'F1 delivers 24 watts' });
  });

  it('writes the live summary', () => {
    expect(sp(words.summary)).toBe('Simulation finished: node a = 14 V, node x = 14 V, node n1 = 12 V; 5 currents. Open the results for details.');
  });

  it('a voltage source that delivers power reads negative; one that absorbs reads positive (C1, C2)', () => {
    const n = parseNetlist('* t\nV1 a 0 6\nV2 b 0 12\nR1 b a 3\n.op\n');
    const w = describeResults(n, op({ a: 6, b: 12 }, [['v1', 2, 'branch'], ['v2', -2, 'branch']]), run());
    expect(w.currents.map((c) => [sp(c.text), sp(c.power?.text)])).toEqual([
      ['2 A from node a to ground through V1', 'V1 absorbs 12 W'],
      ['2 A from ground to node b through V2', 'V2 delivers 24 W'],
    ]);
  });

  it('says "no current", skips parts it does not know, keeps one current per inductor, and leaves out switches (C8)', () => {
    const n = parseNetlist('* t\nV1 a 0 6\nL1 a b 1m\nC1 b 0 1u\nR1 b 0 3\nS1 a c a 0 sw\nR2 c 0 1\n.model sw SW\n.op\n');
    const w = describeResults(
      n,
      op({ a: 6, b: 6, c: 0 }, [
        ['v1', -2, 'branch'],
        ['l1', 2, 'branch'],
        ['l1', 2, 'device'],
        ['c1', 0, 'device'],
        ['r1', 2, 'device'],
        ['s1', 1e-9, 'device'],
        ['x1.r9', 1, 'device'],
      ]),
      run(),
    );
    expect(w.currents.map((c) => c.element)).toEqual(['v1', 'l1', 'c1', 'r1']);
    expect(sp(w.currents.find((c) => c.element === 'c1')?.text)).toBe('no current through C1');
    expect(w.currents.find((c) => c.element === 'c1')?.speech).toBe('no current flows through C1');
  });

  it('a 0 V source with no current measures no current, and a source written without a value is an ammeter too (P16)', () => {
    const n = parseNetlist('* t\nV1 a 0 6\nVx a b\nR1 b 0 2\nVy a c 0\n.op\n');
    const w = describeResults(n, op({ a: 6, b: 6, c: 6 }, [['vx', 3, 'branch'], ['vy', 0, 'branch']]), run());
    expect(w.currents.map((c) => sp(c.text))).toEqual(['Vx measures 3 A flowing from node a to node b', 'Vy measures no current']);
  });

  it('nodes the netlist does not name get no colour, and "gnd" is skipped like the editor does', () => {
    const n = parseNetlist('* t\nV1 a 0 6\nR1 a b 2\nVx b gnd\nR2 c 0 1\n.op\n');
    const w = describeResults(n, op({ a: 6, b: 6, gnd: 6, c: 0, 'q1#base': 1 }), run());
    expect(w.nodes.map((x) => [x.node, x.colourIndex])).toEqual([
      ['a', 0],
      ['b', 1],
      ['gnd', undefined],
      ['c', 2],
      ['q1#base', undefined],
    ]);
  });
});

describe('describeResults: .tf', () => {
  const tfResults = (transferFunction: number, out: { at: string; value: number }, input: { source: string; value: number }): AnalysisResults => ({
    tf: { transferFunction, outputImpedance: out, inputImpedance: input },
    other: [],
  });

  it('F4: the ratio, the input resistance and the Thévenin resistance (A3)', () => {
    const w = describeResults(parseNetlist('* F4\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\nR3 n1 a 2\n.tf v(a) V1\n'), tfResults(1 / 3, { at: 'v(a)', value: 4 }, { source: 'v1', value: 9 }), run());
    const tf = w.tf!;
    expect(tf).toMatchObject({ output: 'v(a)', input: 'V1', ratio: 'V/V' });
    expect(sp(tf.transferFunction?.text)).toBe('v(a)/V1 = 0.3333 (V/V)');
    expect(tf.transferFunction?.speech).toBe('the transfer function from V1 to the voltage at node a is 0.3333 volts per volt');
    expect(sp(tf.inputResistance?.text)).toBe('input resistance seen by V1: 9 Ω (ngspice calls it the input impedance)');
    expect(tf.inputResistance?.speech).toBe('the input resistance seen by V1 is 9 ohms');
    expect(sp(tf.outputResistance?.text)).toBe('output resistance at node a: 4 Ω, the Thévenin resistance seen at node a (ngspice calls it the output impedance)');
    expect(sp(w.summary)).toBe('Simulation finished: transfer function v(a)/V1 = 0.3333 (V/V); input resistance seen by V1: 9 Ω; output resistance at node a: 4 Ω. Open the results for details.');
  });

  it('a current output: ngspice\'s 1e20 Ω is not called a resistance (A5)', () => {
    const w = describeResults(parseNetlist('* t\nV1 a 0 10\nR1 a b 2\nVm b c 0\nR2 c 0 3\n.tf i(Vm) V1\n'), tfResults(1 / 6, { at: 'i(vm)', value: 1e20 }, { source: 'v1', value: 4 }), run());
    expect(w.tf?.ratio).toBe('A/V');
    expect(sp(w.tf?.transferFunction?.text)).toBe('i(Vm)/V1 = 0.1667 (A/V)');
    expect(sp(w.tf?.outputResistance?.text)).toBe("ngspice's output impedance for i(Vm): 1e+20 Ω, a stand-in number rather than a resistance of your circuit");
    expect(w.tf?.outputResistance?.speech).toBe('ngspice reports 1 times 10 to the power 20 ohms as the output impedance for i(Vm); it is not a resistance of your circuit');
  });

  it('a differential output, and a current-source input in V/A (A4)', () => {
    const w = describeResults(parseNetlist('* t\nI1 0 a 1\nR1 a b 4\nR2 b 0 2\n.tf v(a,b) I1\n'), tfResults(1, { at: 'v(a,b)', value: 3 }, { source: 'i1', value: 6 }), run());
    expect(w.tf?.ratio).toBe('V/A');
    expect(w.tf?.transferFunction?.speech).toBe('the transfer function from I1 to the voltage between node a and node b is 1 volt per amp, which is an ohm');
    expect(sp(w.tf?.outputResistance?.text)).toContain('output resistance between node a and node b: 3 Ω');
  });

  it('warns when the .tf output node is not in the circuit (A6)', () => {
    const w = describeResults(parseNetlist('* t\nV1 n1 0 6\nR1 n1 0 2\n.tf v(n9) V1\n'), tfResults(0, { at: 'v(n9)', value: 1 }, { source: 'v1', value: 2 }), run());
    expect(w.warnings.map((m) => [m.code, m.title, m.line])).toEqual([['tf-node-missing', 'n9 is not a node of the circuit', 4]]);
    expect(w.summary).toContain('1 warning: n9 is not a node of the circuit.');
  });
});

describe('describeResults: sweeps', () => {
  const sweep = (scaleName: string, unit: 'V' | 'A' | 's', scale: number[], series: [string, 'V' | 'A', number[]][]) => ({
    scale: { name: scaleName, values: Float64Array.from(scale), unit },
    series: series.map(([name, u, v]) => ({ name, values: Float64Array.from(v), unit: u })),
  });

  it('a .dc sweep: range, points and the values at the end (A7)', () => {
    const n = parseNetlist('* D1\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 0 12 1\n');
    const v = Array.from({ length: 13 }, (_, i) => i);
    const w = describeResults(n, { dc: sweep('v(v-sweep)', 'V', v, [['v(out)', 'V', v.map((x) => (2 * x) / 3)], ['i(v1)', 'A', v.map((x) => -x / 3000)]]), other: [] }, run());
    expect(w.sweeps).toHaveLength(1);
    expect(sp(w.sweeps[0]!.text)).toBe('DC sweep of V1 from 0 V to 12 V in steps of 1 V: 13 points. At V1 = 12 V: v(out) = 8 V, i(v1) = −4 mA.');
    expect(sp(w.sweeps[0]!.speech)).toBe('DC sweep of V1 from 0 V to 12 V in steps of 1 V: 13 points. When V1 is 12 volts: the voltage at node out is 8 volts, the current in V1 is minus 4 milliamps.');
    expect(w.sweeps[0]!.final.map((f) => [f.name, f.value])).toEqual([['v(out)', 8], ['i(v1)', -0.004]]);
    expect(w.summary).toBe('Simulation finished: a DC sweep of 13 points. Open the results for details.');
  });

  it('a nested .dc sweep says "at the last point"', () => {
    const n = parseNetlist('* t\nV1 a 0 0\nR1 a 0 1k\nV2 b 0 0\nR2 b 0 1k\n.dc V1 0 2 1 V2 0 1 1\n');
    const w = describeResults(n, { dc: sweep('v(v-sweep)', 'V', [0, 1, 2, 0, 1, 2], [['v(b)', 'V', [0, 0, 0, 1, 1, 1]]]), other: [] }, run());
    expect(sp(w.sweeps[0]!.text)).toBe('DC sweep of V1 from 0 V to 2 V in steps of 1 V and V2 from 0 V to 1 V in steps of 1 V: 6 points. At the last point: v(b) = 1 V.');
  });

  it('a transient: ngspice\'s time points and the values at the end (A16)', () => {
    const n = parseNetlist('* T1\nV1 in 0 PULSE(0 5 0 1u 1u 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m\n');
    const w = describeResults(n, { tran: sweep('time', 's', [0, 0.001, 0.005], [['v(out)', 'V', [0, 3.16, 4.966]], ['i(@c1[i])', 'A', [0, 1e-3, 3.4e-5]]]), other: [] }, run());
    expect(sp(w.sweeps[0]!.text)).toBe('Transient from 0 s to 5 ms: 3 time points. At 5 ms: v(out) = 4.966 V, i(@c1[i]) = 34 µA.');
    expect(w.sweeps[0]!.speech).toContain('At 5 milliseconds: the voltage at node out is 4.966 volts, the current in C1 is 34 microamps.');
  });

  it('other analyses are counted, not described', () => {
    const plot: RawPlot = { title: '', date: '', plotname: 'AC Analysis', flags: 'complex', complex: true, points: 1, variables: [], real: [] };
    const w = describeResults(parseNetlist('* t\nV1 a 0 AC 1\nR1 a 0 1\n.ac lin 1 1k 1k\n'), { other: [plot] }, run());
    expect(w.status).toBe('ok');
    expect(w.summary).toBe('Simulation finished: 1 other analysis that PlainSpice does not describe yet. Open the results for details.');
  });
});

describe('describeResults: messages and status', () => {
  const noGround = parseNetlist('* t\nV1 a b 6\nR1 a b 2\n.op\n');
  const unreliable = run({
    unreliable: true,
    diagnostics: [
      diag('singular-matrix', 'Warning: singular matrix:  check node b', { severity: 'warning', subject: 'b' }),
      diag('gmin-stepping-failed', 'Warning: Dynamic gmin stepping failed', { severity: 'warning' }),
      diag('source-stepping-failed', 'Warning: source stepping failed', { severity: 'warning' }),
      diag('transient-op-fallback', 'Note: Transient op started', { severity: 'warning' }),
    ],
  });

  it('an unreliable run: "can\'t be trusted" first, then the cause; the stepping messages are folded in (M1)', () => {
    const w = describeResults(noGround, op({ a: 9.0003, b: 3.0003 }, [['v1', -3, 'branch']]), unreliable);
    expect(w.status).toBe('unreliable');
    expect(w.warnings.map((m) => m.code)).toEqual(['unreliable', 'singular-matrix']);
    expect(w.warnings[0]).toMatchObject({ title: DESCRIBE_STRINGS.unreliableTitle });
    expect(w.warnings[1]).toMatchObject({ title: 'No ground (node 0)' });
    expect(w.warnings[1]!.why).toContain("Without ground, SPICE can't pin the voltages down.");
    expect(w.summary).toBe("Simulation finished, but its numbers can't be trusted: no ground (node 0). Open the results for details.");
  });

  it('a failed run: the specific error, without ngspice\'s closing lines (M4)', () => {
    const n = parseNetlist('* t\nV1 n1 0 6\nR1 n1 0 2\nr1 n1 0 4\n.op\n');
    const w = describeResults(
      n,
      { other: [] },
      run({
        ok: false,
        exitCode: 1,
        diagnostics: [
          diag('duplicate-name', 'device already exists, bail out', { line: 4 }),
          diag('circuit-not-parsed', 'Error: circuit not parsed.'),
          diag('error', "Error: there aren't any circuits loaded."),
          diag('warning', "warning, can't find model 'x' from line", { severity: 'warning' }),
        ],
      }),
    );
    expect(w.status).toBe('failed');
    expect(w.warnings.map((m) => [m.code, m.title, m.line])).toEqual([['duplicate-name', 'Two parts are called R1', 4]]);
    expect(w.warnings[0]!.why).toBe(
      'Each part needs its own name, and SPICE ignores capital letters, so r1 here is the same name as R1 on line 3. ngspice stops at the second one ("device already exists"). Rename one of them.',
    );
    expect(w.ngspiceError).toBe(true);
    expect(w.summary).toBe('ngspice stopped with an error: two parts are called R1. Open the results for details.');
  });

  it('names both parts and ngspice\'s reason when two names differ by more than capital letters: R\u015f and R\u00e7, R\u00b5 and Ru (S9; M4b, M4c)', () => {
    const failed = (text: string): ReturnType<typeof describeResults> =>
      describeResults(parseNetlist(text), { other: [] }, run({ ok: false, exitCode: 1, diagnostics: [diag('duplicate-name', 'device already exists, bail out', { line: 4 })] }));
    const letters = failed('* t\nV1 a 0 6\nR\u015f a 0 2\nR\u00e7 a 0 3\n.op\n.end\n');
    // It said "Two parts are called R\u00e7 \u2026 SPICE ignores capital letters", beside the Checks panel's right reason.
    expect(letters.warnings.map((m) => [m.title, m.why, m.line])).toEqual([
      [
        'R\u015f and R\u00e7 are the same name for ngspice',
        'Each part needs its own name. ngspice writes each letter other than a to z (or A to Z) in a name as underscores, so R\u00e7 here is the same name as R\u015f on line 3: both are r__. ngspice stops at the second one ("device already exists"). Rename one of them with the letters a to z.',
        4,
      ],
    ]);
    // The summary keeps the names' capitals ("two parts are called R1" is lowered, a name is not).
    expect(letters.summary).toBe('ngspice stopped with an error: R\u015f and R\u00e7 are the same name for ngspice. Open the results for details.');
    expect(failed('* t\nV1 a 0 6\nRu a 0 2\nR\u00b5 a 0 3\n.op\n.end\n').summary).toBe('ngspice stopped with an error: Ru and R\u00b5 are the same name for ngspice. Open the results for details.');
    const micro = failed('* t\nV1 a 0 6\nR\u00b5 a 0 2\nRu a 0 3\n.op\n.end\n').warnings[0]!;
    expect([micro.title, micro.why]).toEqual([
      'R\u00b5 and Ru are the same name for ngspice',
      'Each part needs its own name. ngspice reads the micro sign \u00b5 as u, so Ru here is the same name as R\u00b5 on line 3: both are ru. ngspice stops at the second one ("device already exists"). Rename one of them with the letters a to z.',
    ]);
  });

  it('no results and no message: no analysis line, or nothing at all (M20)', () => {
    const none = describeResults(parseNetlist('* t\nR1 a 0 1\n'), { other: [] }, run({ ok: false }));
    expect(none.warnings.map((m) => m.code)).toEqual(['no-analysis']);
    // ngspice ran nothing and said nothing (exit 0): it gave no results, it did not stop with an error (M4).
    expect(none.ngspiceError).toBe(false);
    expect(none.summary).toBe('ngspice finished but gave no results: nothing to run. Open the results for details.');
    const empty = describeResults(parseNetlist('* t\nR1 a 0 1\n.op\n'), { other: [] }, run({ ok: false }));
    expect(empty.warnings.map((m) => m.code)).toEqual(['no-results']);
  });

  it('finds messages ngspice prints that diagnostics.ts does not classify (P10, A28, A29)', () => {
    const f = describeResults(
      parseNetlist('* t\nV1 a 0 6\nR1 a 0 2\nF1 0 o R1 2\nR2 o 0 1\n.op\n'),
      { other: [] },
      run({ ok: false, stderr: 'Fatal error: f1: unknown controlling source r1\ndoAnalyses: no such parameter\nrun simulation(s) aborted', diagnostics: [diag('run-aborted', 'run simulation(s) aborted')] }),
    );
    expect(f.warnings.map((m) => [m.code, m.title, m.line])).toEqual([['unknown-control-source', 'F1 cannot read the current of R1', 4]]);
    expect(f.warnings[0]!.why).toContain('F and H read a current. But SPICE can only read the current through a voltage source, and R1 is a resistor.');
    const meas = describeResults(parseNetlist('* t\nV1 a 0 1\n.tran 1u 1m\n.meas tran x max v(a)\n'), { other: [] }, run({ stderr: 'No .measure possible in batch mode (-b) with -r rawfile set!' }));
    expect(meas.warnings.map((m) => [m.code, m.severity, m.line])).toEqual([['meas-skipped', 'note', 4]]);
    const dot = describeResults(parseNetlist('* t\n.foo\n.op\n'), { other: [] }, run({ ok: false, stderr: " unimplemented dot command '.foo'", diagnostics: [diag('circuit-not-parsed', 'Error: circuit not parsed.', { line: 2 })] }));
    expect(dot.warnings.map((m) => [m.code, m.title, m.line])).toEqual([['unknown-dot-command', 'ngspice does not know .foo', 2]]);
  });

  it('an ok run with a warning says so in the live summary', () => {
    const w = describeResults(
      parseNetlist('* t\nV1 a 0 6\nR1 a b 0\nR2 b 0 1k\n.op\n'),
      op({ a: 6, b: 6 }, [['v1', -0.005859375, 'branch']]),
      run({ diagnostics: [diag('resistor-too-small', 'Warning: Value of resistor r1 is too small, set to 1.000000e-12', { severity: 'warning', subject: 'r1' })] }),
    );
    expect(w.status).toBe('ok');
    expect(sp(w.summary)).toBe('Simulation finished: node a = 6 V, node b = 6 V; 1 current. 1 warning: R1 is too small for ngspice. Open the results for details.');
  });
});

describe('annotateLines', () => {
  it('F5: one short note per part line', () => {
    const n = parseNetlist(F5);
    expect(annotateLines(n, F5_RESULTS).map((a) => [a.line, sp(a.text), a.speech])).toEqual([
      [2, '1 A, 0 → a, delivers 14 W', '1 amp flows from ground to node a; delivers 14 watts'],
      [3, '1 A, a → x', 'measures 1 amp flowing from node a to node x'],
      [4, '1 A, x → n1', '1 amp flows from node x to node n1'],
      [5, '3 A, n1 → 0', '3 amps flow from node n1 to ground'],
      [6, '2 A, 0 → n1, delivers 24 W', '2 amps flow from ground to node n1; delivers 24 watts'],
    ]);
  });

  it('voltage sources say whether they deliver or absorb, and which way the current goes at +', () => {
    const n = parseNetlist('* t\nV1 a 0 6\nV2 b 0 12\nR1 b a 3\n.op\n');
    const notes = annotateLines(n, op({ a: 6, b: 12 }, [['v1', 2, 'branch'], ['v2', -2, 'branch']]));
    expect(notes.map((a) => [a.line, sp(a.text)])).toEqual([
      [2, 'absorbs 12 W, 2 A into +'],
      [3, 'delivers 24 W, 2 A out of +'],
      [4, '6 V across'],
    ]);
    expect(notes[1]!.speech).toBe('delivers 24 watts; 2 amps flow out of its + side');
  });

  it('gives nothing without an operating point, or when the numbers can\'t be trusted', () => {
    const n = parseNetlist(F5);
    expect(annotateLines(n, { other: [] })).toEqual([]);
    expect(annotateLines(n, F5_RESULTS, run({ unreliable: true }))).toEqual([]);
    expect(annotateLines(n, F5_RESULTS, run({ ok: false }))).toEqual([]);
  });

  it('skips parts ngspice leaves out, K lines and subcircuit parts', () => {
    const n = parseNetlist('* t\nV1 a 0 6\nR1 a 0\nL1 a 0 1m\nL2 b 0 1m\nK1 L1 L2 0.5\n.subckt s x y\nRs x y 1\n.ends\n.op\n');
    const lines = annotateLines(n, op({ a: 6, b: 0 })).map((a) => a.line);
    expect(lines).toEqual([2, 4, 5]);
  });
});

describe('the core review of 10 Nov 2026 (docs/spice-facts/review.md)', () => {
  it('gives the message ngspice prints for a left-out BJT model, and the level=1 hint only for MOSFETs', () => {
    const net = parseNetlist('* t\nV1 c 0 1\nQ1 c 0 0 qm\n.model qm npn level=8\n.op\n.end\n');
    const w = explainDiagnostic(diag('missing-model', '', { line: 3 }), net);
    expect(w.why).toBe('The .model line for qm uses level=8, which selects HICUM2, a chip-design model that PlainSpice\'s engine leaves out, so ngspice says "Unable to find definition of given model".');
  });

  it('blames an E line for a singular matrix only when it has too few nodes (M9), not for a missing gain', () => {
    const net = parseNetlist('* t\nV1 c 0 3\nE1 a 0 c 0\nC1 a b 1u\nC2 b 0 1u\n.op\n.end\n');
    expect(explainDiagnostic(diag('singular-matrix', '', { severity: 'warning', subject: 'a' }), net).title).not.toContain('E1');
  });
});

describe('explainDiagnostic: every code in plain words', () => {
  const net = parseNetlist(
    '* t\nV1 n1 0 6\nR1 n1 0 2\nr1 n1 0 4\n1k a 0 5\nX1 a 0 amp\nD1 a 0 dmod\nM1 d g 0 0 nm\n.model nm nmos level=8\nK1 L1 L2 0.9\nB1 a 0 5\n.tf v(n1) V9\n.dc V9 0 1\n.tran 5m\n.foo\n$ odd\n',
  );
  const cases: [EngineDiagnostic, string, number | undefined][] = [
    [diag('singular-matrix', '', { severity: 'warning', subject: 'v1#branch' }), 'V1 is in a loop of voltage sources or shorts', 2],
    [diag('gmin-stepping-failed', '', { severity: 'warning' }), "ngspice's other ways to find a DC solution failed too", undefined],
    [diag('source-stepping-failed', '', { severity: 'warning' }), "ngspice's other ways to find a DC solution failed too", undefined],
    [diag('transient-op-fallback', '', { severity: 'warning' }), 'The numbers come from a fallback and can be wrong', undefined],
    [diag('transient-op-failed', ''), 'The fallback failed too: no results', undefined],
    [diag('op-failed', ''), 'No operating point', undefined],
    [diag('timestep-too-small', ''), 'Time step too small', undefined],
    [diag('duplicate-name', '', { line: 4 }), 'Two parts are called R1', 4],
    [diag('unknown-device', '', { line: 5 }), 'A line starts with 1', 5],
    [diag('unknown-subcircuit', 'Error: unknown subckt: x1 a 0 amp', { subject: 'x1' }), 'No subcircuit called amp', 6],
    [diag('missing-model', '', { line: 7 }), 'No model for D1', 7],
    [diag('missing-model', '', { line: 8 }), "The model of M1 is not in PlainSpice's engine", 8],
    [diag('missing-fields', 'Error: not enough parameters in line'), 'Not enough fields on a line', undefined],
    [diag('unknown-parameter', 'unknown parameter (k)', { subject: 'k', line: 3 }), 'A space before "k"', 3],
    [diag('line-ignored', "Warning: 'r1 n1 0' is not a valid resistor instance line, ignored!", { severity: 'warning', subject: 'resistor' }), 'R1 was left out', 3],
    [diag('no-value-dc0', 'Note: v1: has no value, DC 0 assumed', { severity: 'note', subject: 'v1' }), 'V1 has no value: 0 V', 2],
    [diag('resistor-too-small', '', { severity: 'warning', subject: 'r1' }), 'R1 is too small for ngspice', 3],
    [diag('tf-source-missing', '', { subject: 'v9' }), '.tf: there is no V9', 12],
    [diag('tf-source-type', '', { subject: 'r1' }), '.tf: R1 is not a source', 12],
    [diag('sweep-source-missing', '', { subject: 'v9' }), '.dc: there is no V9', 13],
    [diag('bad-syntax', 'Bad syntax!', { line: 13 }), '.dc needs a step that is not 0', 13],
    [diag('bad-syntax', 'Bad syntax!', { line: 2 }), 'ngspice cannot read this line', 2],
    [diag('bad-tran-arguments', 'TSTOP is invalid', { subject: 'TSTOP', line: 14 }), '.tran needs a step and a stop time', 14],
    [diag('bad-tran-arguments', 'TSTEP is invalid', { subject: 'TSTEP' }), 'The .tran step must be more than 0', 14],
    [diag('bad-tran-arguments', 'TSTART is invalid', { subject: 'TSTART' }), 'tstart must come before tstop', 14],
    [diag('missing-inductor', 'Fatal error: k1: coupling to non-existent inductor l1.'), 'There is no inductor called L1', 10],
    [diag('model-not-in-build', 'Device type LossyXmissionLine not supported by this binary', { subject: 'LossyXmissionLine' }), "This part is not in PlainSpice's engine", undefined],
    [diag('undefined-parameter', 'Undefined parameter [rx]', { subject: 'rx', line: 3 }), 'No .param defines rx', 3],
    [diag('fatal-syntax', 'ERROR: mal formed B source instance: b1 a 0 5'), 'A B line needs V= or I=', 11],
    [diag('fatal-syntax', 'Closing "}" not found in line fragment'), 'An expression is not closed', undefined],
    [diag('fatal', 'ERROR: fatal error in ngspice, exit(1)'), 'ngspice stopped', undefined],
    [diag('circuit-not-parsed', 'Error: circuit not parsed.', { line: 15 }), 'ngspice does not know .foo', 15],
    [diag('circuit-not-parsed', 'Error: circuit not parsed.'), 'ngspice could not read the circuit', undefined],
    [diag('run-aborted', 'run simulation(s) aborted'), 'The simulation was stopped', undefined],
    [diag('nothing-to-run', 'no simulations run'), 'Nothing to run', undefined],
    [diag('unusual-leading-character', 'Warning: Unusual leading characters', { severity: 'warning' }), 'A line became a comment', 16],
    [diag('error', 'Error: Could not find include file models.lib'), 'ngspice cannot find the file models.lib', undefined],
    [diag('error', 'Error: something else'), 'ngspice reported an error', undefined],
    [diag('warning', 'Warning from checkvalid: vector a is not available or has zero length.', { severity: 'warning' }), 'A .control command ran before the results existed', undefined],
    [diag('warning', 'Warning: something', { severity: 'warning' }), 'ngspice warns', undefined],
    [diag('engine-crash', 'RuntimeError: unreachable'), 'The simulation engine crashed', undefined],
    [diag('rawfile', 'header without a Binary: or Values: section'), 'The results could not be read', undefined],
  ];

  it.each(cases)('%o', (d, title, line) => {
    const w = explainDiagnostic(d, net);
    expect(w.title).toBe(title);
    expect(w.line).toBe(line);
    expect(w.why.length).toBeGreaterThan(20);
  });

  it('a resistor too small for ngspice: two nodes are made one by a name, in the editor’s words (the words critic, new-4)', () => {
    const w = explainDiagnostic(diag('resistor-too-small', '', { severity: 'warning', subject: 'r1' }), net);
    expect(sp(w.why)).toContain('To make two nodes one, give them the same name; to measure the current there, use a 0 V source.');
    expect(w.why).not.toMatch(/\bjoin/);
  });

  it('a resistor too small for ngspice: the value ngspice 47 says it used, −10⁻¹² Ω for a negative one, and the currents next to it "can" come out inaccurate, as the zero-ohm check says (integration check P4)', () => {
    // zero-ohm-7: "set to -1.000000e-12" for −3e-18; zero-ohm-9 and P24b: where a current source sets the current, it comes out exact.
    const why = (name: string, set: string): string =>
      explainDiagnostic(diag('resistor-too-small', `Warning: Value of resistor ${name} is too small, set to ${set}`, { severity: 'warning', subject: name }), net).why;
    const advice = ' To make two nodes one, give them the same name; to measure the current there, use a 0 V source.';
    expect(why('r1', '1.000000e-12')).toBe(`ngspice 47 cannot use 0 Ω (or anything below 10⁻¹² Ω): it uses 10⁻¹² Ω instead, and the currents next to it can come out inaccurate.${advice}`);
    // The zero-ohm check's words for −3 aΩ, word for word (tests/unit/traps-last-pass-words.test.ts).
    expect(why('r1', '-1.000000e-12')).toBe(`ngspice 47 cannot use a resistance this close to 0: it uses ${MINUS}10⁻¹² Ω instead, and the currents next to it can come out inaccurate.${advice}`);
    // Without ngspice's line (a diagnostic made by hand), the words for 0 and positive values.
    expect(explainDiagnostic(diag('resistor-too-small', '', { severity: 'warning', subject: 'r1' }), net).why).toBe(why('r1', '1.000000e-12'));
  });

  it('tailors the singular matrix to the node ngspice names (M1, M2, M2b, M2c, M3c, M9)', () => {
    const s = (text: string, subject: string): string => explainDiagnostic(diag('singular-matrix', '', { severity: 'warning', subject }), parseNetlist(text)).title;
    expect(s('* t\nV1 a b 6\nR1 a b 2\n', 'b')).toBe('No ground (node 0)');
    expect(s('* t\nV1 a 0 6\nR1 a c 1k\nC1 c b 1u\nC2 b 0 2u\nR2 c 0 1k\n', 'b')).toBe('Node b has no DC path to ground');
    expect(s('* t\nI1 0 a 1m\nC1 a b 1u\nR1 b 0 1k\n', 'a')).toBe('Node a has no DC path to ground');
    expect(s('* t\nV1 n1 0 6\nR1 n1 0 2\nR2 n3 n4 3\n', 'n3')).toBe('Node n3 is not connected to the rest of the circuit');
    expect(s('* t\nV1 a 0 5\nL1 a 0 1m\n', 'l1#branch')).toBe('L1 is in a loop of voltage sources or shorts');
    expect(s('* t\nRref a 0 1\nE1 a 0 5\n', '5')).toBe('E1 is missing fields');
    expect(s('* t\nV1 a 0 5\nR1 a b 1\nR2 b 0 1\n', 'b')).toBe('No single answer at node b');
  });

  it('tailors "unknown parameter" to the slip that causes it (N8, N12, N14, S7)', () => {
    const u = (text: string, subject: string): string => explainDiagnostic(diag('unknown-parameter', '', { subject, line: 2 }), parseNetlist(text)).title;
    expect(u('* t\nV1 n1 0 1 k\n', 'k')).toBe('A space before "k"');
    expect(u('* t\nV1 n1 0 1,5\n', '5')).toBe('A comma in a number');
    expect(u('* t\nV1 n1 0 1d-3\n', '-3')).toBe('A sign in the middle of a value');
    expect(u('* t\nR1 n1 0 2 * 5\n', '*')).toBe('A * in the middle of a line');
    expect(u('* t\nV1 n1 0 1 foo\n', 'foo')).toBe('ngspice cannot use "foo" here');
  });

  it('explains an empty .dc sweep behind a "rawfile" error (A11)', () => {
    const w = explainDiagnostic(diag('rawfile', 'header without a Binary: or Values: section'), parseNetlist('* t\nV1 in 0 0\nR1 in 0 1k\n.dc V1 12 0 1\n'));
    expect(w).toMatchObject({ title: 'The .dc sweep has no points', line: 4 });
  });
});

describe('the app reviews of 10 Nov 2026', () => {
  it('a part ngspice left out has no current and no note, and its savecurrents warning is dropped (words review M5)', () => {
    const n = parseNetlist('* T09a\nV1 a 0 6\nR1 a 0\n.op\n.end\n');
    const r = run({ diagnostics: [diag('line-ignored', "'r1 a 0' is not a valid resistor instance line, ignored!", { severity: 'warning', subject: 'resistor' }), diag('warning', 'Warning: unrecognized variable - @r1[i]', { severity: 'warning' })] });
    const results = op({ a: 6 }, [['v1', 0, 'branch'], ['r1', 0, 'device']]);
    const w = describeResults(n, results, r);
    expect(w.currents.map((c) => c.name)).toEqual(['V1']);
    expect(w.warnings.map((m) => m.title)).toEqual(['R1 was left out']);
    expect(annotateLines(n, results, r).map((a) => a.line)).toEqual([2]);
  });

  it('parts after a plain .end are in the results, as ngspice builds them; not after .end;… (words review M6)', () => {
    const results = op({ a: 6 }, [['v1', -6, 'branch'], ['r1', 3, 'device'], ['r2', 3, 'device']]);
    const after = describeResults(parseNetlist('* t\nV1 a 0 6\nR1 a 0 2\n.op\n.end\nR2 a 0 2\n'), results, run());
    expect(after.currents.map((c) => sp(c.text))).toEqual(['6 A from ground to node a through V1', '3 A from node a to ground through R1', '3 A from node a to ground through R2']);
    expect(annotateLines(parseNetlist('* t\nV1 a 0 6\nR1 a 0 2\n.op\n.end\nR2 a 0 2\n'), results, run()).map((a) => a.line)).toEqual([2, 3, 6]);
    const glued = describeResults(parseNetlist('* t\nV1 a 0 6\nR1 a 0 2\n.op\n.end;x\nR2 a 0 2\n'), results, run());
    expect(glued.currents.map((c) => c.name)).toEqual(['V1', 'R1']);
  });

  it('explains "can\'t find model" for a value word a check covers (words review M7, greek-mu-2)', () => {
    const n = parseNetlist('* t\nV1 a 0 PULSE(0 1 0 1n 1n 1 2)\nR1 a b 1\nC1 b 0 2μF\n.tran 1m 10m\n.end\n');
    const w = explainDiagnostic(diag('warning', "warning, can't find model '2μf' from line", { severity: 'warning' }), n);
    expect(w.title).toBe('ngspice looked for a model called 2μF');
    expect(w.line).toBe(4);
    expect(w.why).toContain("can't find model '2μf'");
  });

  it('says when ngspice finished quietly without results, not that it stopped with an error (words review M4)', () => {
    const n = parseNetlist('* t\nV1 a 0 1\nR1 a 0 1\n.dc V1 12 0 1\n.end\n');
    const w = describeResults(n, { other: [] }, run({ ok: false, diagnostics: [diag('rawfile', 'no data')] }));
    expect(w.status).toBe('failed');
    expect(w.ngspiceError).toBe(false);
    expect(w.summary).toMatch(/^ngspice finished but gave no results: the \.dc sweep has no points\./);
  });

  it('names why nothing ran: a .control block, an @ line, an analysis on the title line (words review M1, A36)', () => {
    const quiet = run({ ok: false });
    const control = describeResults(parseNetlist('* t\nV1 a 0 1\nR1 a 0 1k\n.control\nop\n.endc\n.end\n'), { other: [] }, quiet);
    expect(control.warnings.map((m) => [m.code, m.severity, m.title])).toEqual([['control-only', 'note', 'ngspice ran the .control block']]);
    const at = describeResults(parseNetlist('* t\nV1 a 0 1\nR1 a 0 1k\n@ oops\n.op\n.end\n'), { other: [] }, quiet);
    expect(at.warnings[0]).toMatchObject({ code: 'no-analysis', line: 4 });
    expect(at.warnings[0]!.why).toContain('Line 4 starts with @');
    const title = describeResults(parseNetlist('.op\nV1 a 0 1\nR1 a 0 1k\n.end\n'), { other: [] }, quiet);
    expect(title.warnings[0]!.why).toBe('Line 1 is always the title, so ngspice never runs the .op written there. It ran nothing.');
  });

  it('writes the spoken summary with units in words (a11y review F11, words review m10)', () => {
    const w = describeResults(parseNetlist(F5), F5_RESULTS, run());
    expect(sp(w.summary)).toBe('Simulation finished: node a = 14 V, node x = 14 V, node n1 = 12 V; 5 currents. Open the results for details.');
    expect(w.summarySpeech).toBe('Simulation finished: node a is 14 volts, node x is 14 volts, node n1 is 12 volts; 5 currents. Open the results for details.');
  });

  it('says "an 8 Ω resistor" and "an 11 kΩ resistor", but "a 1.5 kΩ resistor" (words review m12)', () => {
    const text = describeCircuit(parseNetlist('* t\nV1 a 0 18\nR1 a b 8\nR2 b c 11k\nR3 c 0 1.5k\n.op\n.end\n'));
    expect(sp(text)).toContain('V1: an 18 V source');
    expect(sp(text)).toContain('R1: an 8 Ω resistor');
    expect(sp(text)).toContain('R2: an 11 kΩ resistor');
    expect(sp(text)).toContain('R3: a 1.5 kΩ resistor');
  });

  it('a temperature sweep ends "At 100 °C", not "At the temperature = 100 °C" (words review m11)', () => {
    const n = parseNetlist('* t\nV1 a 0 1\nR1 a 0 1k\n.dc TEMP 0 100 50\n.end\n');
    const values = new Float64Array([0, 50, 100]);
    const results: AnalysisResults = { dc: { scale: { name: 'temp-sweep', values, unit: '°C' }, series: [{ name: 'v(a)', values: new Float64Array([1, 1, 1]), unit: 'V' }] }, other: [] };
    const s = describeResults(n, results, run()).sweeps[0]!;
    expect(sp(s.text)).toBe('DC sweep of the temperature from 0 °C to 100 °C in steps of 50 °C: 3 points. At 100 °C: v(a) = 1 V.');
    expect(s.speech).toContain('At 100 degrees Celsius: the voltage at node a is 1 volt.');
  });

  it('writes ngspice\'s 1e20 Ω stand-in and other numbers beyond the prefixes with an exponent (words review m1)', () => {
    const n = parseNetlist('* t\nI1 0 a 3A\nR1 a 0 4\n.op\n.end\n');
    const w = describeResults(n, op({ a: 1.2e-17 }, [['i1', 3e-18, 'device'], ['r1', 3e-18, 'device']]), run());
    expect(sp(w.currents.find((c) => c.name === 'I1')!.power!.text)).toBe('I1 delivers 3.6e-35 W');
    expect(w.currents.find((c) => c.name === 'I1')!.power!.speech).toBe('I1 delivers 3.6 times 10 to the power minus 35 watts');
  });
});

describe('a very long netlist', () => {
  it('describes the first DESCRIBED_PARTS parts one by one and counts the rest', () => {
    const text = `* many\nV1 a 0 1\n${Array.from({ length: 300 }, (_, i) => `R${i} a 0 1k`).join('\n')}\n.op\n.end\n`;
    const words = describeCircuit(parseNetlist(text));
    expect(words).toContain('301 parts and 1 node besides ground (a).');
    expect(words).toContain(`And ${301 - DESCRIBED_PARTS} more parts.`);
    expect(words).not.toContain('R299:');
  });
});

describe('after the final reviews (12 November 2026)', () => {
  it('names nodes and parts as the netlist writes them, not as ngspice spells them (kept F3; W16, W18)', () => {
    const n = parseNetlist('* t\nV1 giri\u015f 0 12\nR1 giri\u015f \u00e7\u0131k\u0131\u015f 1k\nR\u015f \u00e7\u0131k\u0131\u015f 0 2k\n.op\n.end\n');
    const w = describeResults(n, op({ giri__: 12, ____k____: 8 }, [['v1', -0.004, 'branch'], ['r1', 0.004, 'device'], ['r__', 0.004, 'device']]), run());
    expect(w.nodes.map((x) => [x.node, x.ngspice, x.colourIndex])).toEqual([
      ['giri\u015f', 'giri__', 0],
      ['\u00e7\u0131k\u0131\u015f', '____k____', 1],
    ]);
    expect(w.summarySpeech).toBe('Simulation finished: node giri\u015f is 12 volts, node \u00e7\u0131k\u0131\u015f is 8 volts; 3 currents. Open the results for details.');
    expect(w.currents.map((c) => [c.element, c.vector, sp(c.text)])).toEqual([
      ['v1', 'i(v1)', '4 mA from ground to node giri\u015f through V1'],
      ['r1', 'i(@r1[i])', '4 mA from node giri\u015f to node \u00e7\u0131k\u0131\u015f through R1'],
      ['r\u015f', 'i(@r__[i])', '4 mA from node \u00e7\u0131k\u0131\u015f to ground through R\u015f'],
    ]);
    // The power needs both node voltages, which are found under the netlist's names.
    expect(sp(w.currents[0]!.power!.text)).toBe('V1 delivers 48 mW');
  });

  it('leaves names ngspice made one as ngspice spells them (W17)', () => {
    const n = parseNetlist('* t\nV1 \u015f 0 12\nR1 \u015f \u00e7 1k\nR2 \u00e7 0 2k\n.op\n.end\n');
    const w = describeResults(n, op({ __: 12 }, [['v1', -0.006, 'branch']]), run());
    expect(w.nodes.map((x) => [x.node, x.ngspice])).toEqual([['__', undefined]]);
  });

  it('names sweep results with the netlist\'s names too (W16)', () => {
    const n = parseNetlist('* t\nV1 giri\u015f 0 0\nR1 giri\u015f 0 1k\n.dc V1 0 2 1\n.end\n');
    const dc = { scale: { name: 'v(v-sweep)', values: Float64Array.from([0, 1, 2]), unit: 'V' as const }, series: [{ name: 'v(giri__)', values: Float64Array.from([0, 1, 2]), unit: 'V' as const }] };
    const s = describeResults(n, { dc, other: [] }, run()).sweeps[0]!;
    expect(sp(s.final[0]!.text)).toBe('v(giri\u015f) = 2 V');
    expect(s.speech).toContain('the voltage at node giri\u015f is 2 volts');
  });

  it('says 0 A for rounding noise of a 0: a resistor whose two ends are at the same voltage (student review; C9)', () => {
    const n = parseNetlist('* bridge\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\n.op\n.end\n');
    // Every current, as the run gives them with savecurrents (C9): a part whose current is not known may carry a real one.
    const r = op({ top: 9, a: 4.499999999999999, b: 4.5 }, [['v1', -0.0014074468085106386, 'branch'], ['r1', 0.0004500000000000001, 'device'], ['r2', 0.00044999999999999993, 'device'], ['r3', 0.0009574468085106382, 'device'], ['r4', 0.0009574468085106382, 'device'], ['r5', -8.881784197001253e-19, 'device']]);
    const w = describeResults(n, r, run());
    expect(w.currents.find((c) => c.name === 'R5')).toMatchObject({ value: 0, noise: -8.881784197001253e-19, from: 'a', to: 'b', text: 'no current through R5' });
    expect(w.currents.find((c) => c.name === 'R1')!.noise).toBeUndefined();
    expect(w.warnings.map((m) => [m.code, m.severity, m.title, m.line])).toEqual([['rounding-noise', 'note', "R5's current is shown as 0 A", 7]]);
    expect(sp(w.warnings[0]!.why)).toBe(
      "ngspice gave R5 -8.881784e-19 A. That is rounding noise, what its arithmetic leaves of a current that is 0: the two ends of R5, node a and node b, are at the same voltage, 4.5 V. Solved exactly, with fractions, from the netlist's values, the circuit makes it exactly 0, so PlainSpice shows 0 A.",
    );
    // Not when the numbers are not answers: the summary of an untrusted run names its first problem.
    expect(describeResults(n, r, run({ unreliable: true })).warnings.some((m) => m.code === 'rounding-noise')).toBe(false);
  });

  it('keeps every tiny current the circuit itself makes, next to large currents too: noise is never decided by comparing sizes (critic of round 1; C9e-C9g, unit-letter-1)', () => {
    const kept = (text: string, r: AnalysisResults, name: string, value: number): void => {
      const w = describeResults(parseNetlist(text), r, run());
      const c = w.currents.find((x) => x.name === name)!;
      expect([c.value, c.noise], name).toEqual([value, undefined]);
      expect(w.nodes.every((x) => x.noise === undefined)).toBe(true);
      expect(w.warnings.some((m) => m.code === 'rounding-noise')).toBe(false);
    };
    // A current source's current is its own value: the 3 aA of 3A alone, and the 2 aA of 2A next to a 4 mA divider (C9e).
    kept('* t\nI1 0 a 3A\nR1 a 0 4\n.op\n.end\n', op({ a: 1.2e-17 }, [['i1', 3e-18, 'device'], ['r1', 3e-18, 'device']]), 'R1', 3e-18);
    kept('* t\nV1 a 0 12\nR1 a b 1k\nR2 b 0 2k\nI1 0 b 2A\n.op\n.end\n', op({ a: 12, b: 8 }, [['v1', -0.004, 'branch'], ['r1', 0.004, 'device'], ['r2', 0.004, 'device'], ['i1', 2e-18, 'device']]), 'I1', 2e-18);
    // A resistor with its two ends 12 V apart carries 120 fA, next to a 1.2 A current (C9f).
    kept('* t\nV1 in 0 12\nR1 in 0 10\nR2 in 0 1e14\n.op\n.end\n', op({ in: 12 }, [['v1', -1.20000000000012, 'branch'], ['r1', 1.2000000000000002, 'device'], ['r2', 1.2e-13, 'device']]), 'R2', 1.2e-13);
    // A 1 nΩ wire makes V/R huge; the 1 TΩ resistor next to it still carries its 0.5 pA (C9g).
    kept('* t\nV1 in 0 0.5\nR1 in a 1n\nR2 a 0 1k\nR3 a 0 1T\n.op\n.end\n', op({ in: 0.5, a: 0.49999999999949996 }, [['v1', -0.000500023365020752, 'branch'], ['r1', 0.0005000444502911704, 'device'], ['r2', 0.0004999999999995, 'device'], ['r3', 4.999999999995e-13, 'device']]), 'R3', 4.999999999995e-13);
    // A diode's leakage: the node with the diode is never used to say a current is 0 (its current is not one PlainSpice reads).
    kept('* t\nV1 in 0 10\nR1 in 0 10\nV2 k 0 0.3\nD1 0 k dmod\n.model dmod d\n.op\n.end\n', op({ in: 10, k: 0.30000000000000004 }, [['v2', -3.099913851083045e-13, 'branch'], ['v1', -1, 'branch'], ['r1', 1, 'device']]), 'V2', -3.099913851083045e-13);
    // 1 pA is not below abstol: kept, whatever the voltages.
    kept('* t\nV1 a 0 1\nR1 a 0 1\nR2 a b 1\nR3 b 0 1\n.op\n.end\n', op({ a: 1, b: 1 }, [['r1', 1, 'device'], ['r3', 1e-12, 'device']]), 'R3', 1e-12);
  });

  it('says 0 A when the circuit\'s own numbers make every current 0, and gives a source no power then (C9b)', () => {
    const n = parseNetlist('* t\nV1 in 0 12\nR1 in a 1k\nR3 a b 3k\nF1 0 b V1 2\n.op\n.end\n');
    const r = op({ in: 12, a: 11.999999999999998, b: 11.999999999999995 }, [['v1', -1.734723475976807e-18, 'branch'], ['r1', 1.7763568394002505e-18, 'device'], ['r3', 1.1842378929335003e-18, 'device'], ['f1', -3.469446951953614e-18, 'device']]);
    const w = describeResults(n, r, run());
    expect(w.currents.map((c) => c.value)).toEqual([0, 0, 0, 0]);
    expect(w.currents.map((c) => c.power)).toEqual([undefined, undefined, undefined, undefined]);
    expect(annotateLines(n, r).find((a) => a.line === 2)).toMatchObject({ text: '0 A', speech: 'no current flows' });
    const note = w.warnings.find((m) => m.code === 'rounding-noise')!;
    expect(note.line).toBeUndefined();
    // The circuit is solved exactly (decision 0015): R1 and R3 have their ends at the same voltage, F1 copies V1's 0, and V1 is the only current left at node in.
    expect(note.why).toContain('each of these parts has its two ends at the same voltage, copies a current that is 0 or carries the only current left at one of its nodes (the currents at a node add up to 0).');
    // The exact solution needs no part's current: without the resistors' currents V1's is still exactly 0 (the old rule kept it).
    expect(describeResults(n, op({ in: 12, a: 12, b: 12 }, [['v1', -1.734723475976807e-18, 'branch']]), run()).currents[0]).toMatchObject({ value: 0, noise: -1.734723475976807e-18 });
  });

  it('passes the noise on: what an F or H makes of a noise current, the resistor it drives and the voltage there are 0 (critic of round 1; C9d)', () => {
    const text = (f: string): string => `* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a m 1k\nVm m b 0\n${f}\nR6 out 0 1k\n.op\n.end\n`;
    const volts = { top: 9, a: 4.499999999999999, b: 4.499999999999999, m: 4.499999999999999, out: -2.1684043449710089e-13 };
    const common: [string, number, Origin][] = [['v1', -0.0014074468085106388, 'branch'], ['r1', 4.5e-4, 'device'], ['r2', 4.5e-4, 'device'], ['r3', 9.574468085106385e-4, 'device'], ['r4', 9.574468085106381e-4, 'device'], ['r5', 0, 'device'], ['vm', -2.168404344971009e-19, 'branch'], ['r6', -2.1684043449710089e-16, 'device']];
    const f = describeResults(parseNetlist(text('F1 0 out Vm 1000')), op(volts, [...common, ['f1', -2.1684043449710089e-16, 'device']]), run());
    expect(f.currents.filter((c) => c.noise !== undefined).map((c) => c.name)).toEqual(['Vm', 'F1', 'R6']);
    const out = f.nodes.find((x) => x.node === 'out')!;
    expect([out.value, out.noise, sp(out.text), out.speech]).toEqual([0, -2.1684043449710089e-13, '0 V', '0 volts']);
    const note = f.warnings.find((m) => m.code === 'rounding-noise')!;
    expect(note.title).toBe('3 currents are shown as 0 A, and node out as 0 V');
    expect(note.why).toContain('and node out -2.168404e-13 V.');
    // R6's two ends, node out and ground, are both exactly at 0 V.
    expect(note.why).toContain('each of these parts has its two ends at the same voltage, copies a current that is 0 or carries the only current left at one of its nodes (the currents at a node add up to 0); and node out is joined to ground through parts with no voltage across them.');
    expect(note.why).toContain("Solved exactly, with fractions, from the netlist's values, the circuit makes each of them exactly 0, so PlainSpice shows 0 A and 0 V.");
    // The note at the end of R6's line agrees with the drawing: no current, and no voltage across.
    expect(annotateLines(parseNetlist(text('F1 0 out Vm 1000')), op(volts, [...common, ['f1', -2.1684043449710089e-16, 'device']])).find((a) => a.line === 10)).toMatchObject({ text: '0 A' });
    // H: its output is 1 MΩ × a current that is 0, so node out is joined to ground through it.
    const h = describeResults(parseNetlist(text('H1 out 0 Vm 1meg')), op(volts, [...common, ['h1', 2.1684043449710089e-16, 'branch']]), run());
    expect(h.currents.filter((c) => c.noise !== undefined).map((c) => c.name)).toEqual(['Vm', 'H1', 'R6']);
    expect(h.nodes.find((x) => x.node === 'out')!.value).toBe(0);
    // A real voltage on a node joined to ground that way would not be noise: only below 1 µV (vntol).
    const big = describeResults(parseNetlist(text('F1 0 out Vm 1000')), op({ ...volts, out: 2e-6 }, [...common, ['f1', -2.1684043449710089e-16, 'device']]), run());
    expect(big.nodes.find((x) => x.node === 'out')!.noise).toBeUndefined();
  });

  it('a node named ground that is not ground is quoted in the results words, so it never reads as ground (critic of round 1; W13)', () => {
    // The critic's netlist: "V1 ground 0 5 / R1 ground 0 1k". It said "5 mA from ground to ground through V1" and "ground is 5 volts".
    const n = parseNetlist('* t\nV1 ground 0 5\nR1 ground 0 1k\n.op\n.end\n');
    const w = describeResults(n, op({ ground: 5 }, [['v1', -0.005, 'branch'], ['r1', 0.005, 'device']]), run());
    expect(sp(w.currents[0]!.text)).toBe('5 mA from ground to node "ground" through V1');
    expect(w.currents[1]!.speech).toBe('5 milliamps flow from node "ground" to ground through R1');
    expect(w.summarySpeech).toBe('Simulation finished: node "ground" is 5 volts; 2 currents. Open the results for details.');
    expect(sp(describeCircuit(n))).toContain('2 parts and 1 node besides ground ("ground").');
    // The note at the end of a line keeps the bare names, ground's "0" and the quoted "ground".
    expect(sp(annotateLines(n, op({ ground: 5 }, [['v1', -0.005, 'branch'], ['r1', 0.005, 'device']])).find((a) => a.line === 3)!.text)).toBe('5 mA, "ground" → 0');
    // gnd as an ordinary node (W9), and 00 (W14), too; ground itself stays "ground".
    expect(sentenceNode('gnd')).toBe('"gnd"');
    expect(sentenceNode('00')).toBe('"00"');
    expect(sentenceNode('0')).toBe('ground');
    expect(sentenceNode('in')).toBe('in');
  });

  it('a terminal at ground reads "− side at ground", and a subcircuit\'s nodes read as a list (critic of round 1; W8)', () => {
    const text = sp(describeCircuit(parseNetlist('* t\nV1 a 0 5\nD1 a 0 dmod\nX1 a 0 sub1\nB1 n 0 V=1\nR3 n 0 1k\nI1 0 a 1\nG1 0 a a 0 1m\n.subckt sub1 p q\nR1 p q 1k\n.ends\n.model dmod d\n.op\n.end\n')));
    expect(text).toContain(`D1: a diode (+ node a, ${MINUS} side at ground, model dmod).`);
    expect(text).toContain('X1: a subcircuit (node a and ground, subcircuit sub1).');
    expect(text).toContain(`B1: a behavioural source (+ node n, ${MINUS} side at ground).`);
    expect(text).not.toContain('node at ground');
  });

  it('an AC source is an AC source, not a wire: its size in .ac, 0 V in DC (critic of round 1; P16, A20)', () => {
    const n = parseNetlist('* RC low-pass\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac dec 5 10 10k\n.end\n');
    expect(sp(describeCircuit(n))).toContain(`V1: an AC source of 1 V in an .ac analysis, 0 V in DC, with its + side at node in and its ${MINUS} side at ground.`);
    expect(sp(describeCircuit(parseNetlist('* t\nV1 in 0 0 AC 2 90\nR1 in 0 1k\n.ac lin 3 1 2\n.end\n')))).toContain('V1: an AC source of 2 V in an .ac analysis, 0 V in DC');
    // In .op it is a source that makes 0 V, so it measures nothing and gives no power: its current is a current.
    const w = describeResults(parseNetlist('* t\nV2 a 0 5\nV1 a b AC 1\nR1 b 0 1k\n.op\n.end\n'), op({ a: 5, b: 5 }, [['v2', -0.005, 'branch'], ['v1', 0.005, 'branch'], ['r1', 0.005, 'device']]), run());
    expect(w.currents.find((c) => c.name === 'V1')).toMatchObject({ ammeter: false, value: 0.005 });
    expect(w.currents.find((c) => c.name === 'V1')!.power).toBeUndefined();
    // A 0 V source with no AC value is still the ammeter trick.
    expect(sp(describeCircuit(parseNetlist('* t\nV1 a 0 6\nVx a b 0\nR1 b 0 2\n.op\n.end\n')))).toContain('Vx: a 0 V source from node a to node b: a wire');
  });

  it('a G that reads a voltage that is 0 makes no current (C9d)', () => {
    const n = parseNetlist('* t\nV1 a 0 9\nR1 a b 10k\nR2 b 0 10k\nR3 a c 4.7k\nR4 c 0 4.7k\nG1 0 o b c 1m\nR5 o 0 1k\n.op\n.end\n');
    const w = describeResults(n, op({ a: 9, b: 4.499999999999999, c: 4.5, o: -8.881784197001252e-16 }, [['v1', -0.0014074468085106386, 'branch'], ['r1', 4.5e-4, 'device'], ['r2', 4.5e-4, 'device'], ['r3', 9.574468085106382e-4, 'device'], ['r4', 9.574468085106382e-4, 'device'], ['g1', -8.881784197001253e-19, 'device'], ['r5', -8.881784197001253e-19, 'device']]), run());
    expect(w.currents.filter((c) => c.noise !== undefined).map((c) => c.name)).toEqual(['G1', 'R5']);
    expect(w.nodes.find((x) => x.node === 'o')!.value).toBe(0);
  });

  it('names a node "node in" in its sentences, as the editor does; ground stays "ground" (words review W8)', () => {
    const n = parseNetlist('* t\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\nG1 0 out in 0 1m\n.op\n.end\n');
    const overview = sp(describeCircuit(n));
    expect(overview).toContain(`V1: a 6 V source with its + side at node in and its ${MINUS} side at ground.`);
    expect(overview).toContain('R1: a 1 kΩ resistor between node in and node out.');
    expect(overview).toContain('G1: a voltage-controlled current source pushing 1 mA for every volt at node in, from ground into node out.');
    const w = describeResults(n, op({ in: 6, out: 4 }, [['v1', -0.002, 'branch'], ['r1', 0.002, 'device'], ['r2', 0.002, 'device'], ['g1', 0.006, 'device']]), run());
    expect(w.summarySpeech).toBe('Simulation finished: node in is 6 volts, node out is 4 volts; 4 currents. Open the results for details.');
    expect(sp(w.summary)).toBe('Simulation finished: node in = 6 V, node out = 4 V; 4 currents. Open the results for details.');
    expect(sp(w.currents.find((c) => c.name === 'R2')!.text)).toBe('2 mA from node out to ground through R2');
    expect(w.currents.find((c) => c.name === 'R1')!.speech).toBe('2 milliamps flow from node in to node out through R1');
    // The short note at the end of a netlist line is a note, not a sentence: it keeps the bare names.
    expect(sp(annotateLines(n, op({ in: 6, out: 4 }, [['v1', -0.002, 'branch'], ['r1', 0.002, 'device']])).find((a) => a.line === 3)?.text)).toBe('2 mA, in → out');
  });
});

describe('after the critic of round 2 (12 November 2026): a current is noise only when nothing real flows through it', () => {
  /** Every current kept as ngspice gave it, every node voltage too, and no rounding-noise note. */
  const kept = (text: string, r: AnalysisResults): ReturnType<typeof describeResults> => {
    const w = describeResults(parseNetlist(text), r, run());
    expect(w.currents.map((c) => [c.name, c.noise]), text).toEqual(w.currents.map((c) => [c.name, undefined]));
    expect(w.currents.map((c) => c.value), text).toEqual(r.op!.currents.map((c) => c.value));
    expect(w.nodes.every((x) => x.noise === undefined), text).toBe(true);
    expect(w.warnings.some((m) => m.code === 'rounding-noise'), text).toBe(false);
    return w;
  };

  it('a tiny current a source makes flows on through every part of its loop: 2A with 1 kΩ, with 2 Ω and 3 Ω, and through two resistors side by side (C9h, C9j)', () => {
    // The critic's netlists. ngspice gives the 2 aA to within its rounding: R1's two ends are 1 unit in the last place apart.
    const loop = kept('* t\nV1 a 0 12\nR1 a b 1k\nI1 0 b 2A\n.op\n.end\n', op({ a: 12, b: 12.000000000000002 }, [['v1', 1.734723475976807e-18, 'branch'], ['r1', -1.7763568394002505e-18, 'device'], ['i1', 2e-18, 'device']]));
    expect(sp(loop.currents.find((c) => c.name === 'R1')!.text)).toBe('1.776 aA from node b to node a through R1');
    expect(sp(loop.currents.find((c) => c.name === 'V1')!.power!.text)).toBe('V1 absorbs 20.82 aW');
    // R2's two ends are the same double, so ngspice gives its 3 aA as exactly 0, and V1 888.2 aA where the
    // circuit makes 3 aA: ngspice's answers are off, so every number is ngspice's, never an exact value
    // mixed in beside them (the critic of round 2), and a warning gives V1's exact 3 aA.
    const series = describeResults(parseNetlist('* t\nV1 a 0 10\nR1 a b 2\nR2 b c 3\nI1 c 0 3A\n.op\n.end\n'), op({ a: 10, b: 10.000000000000002, c: 10.000000000000002 }, [['v1', 8.881784197001252e-16, 'branch'], ['r1', -8.881784197001252e-16, 'device'], ['r2', 0, 'device'], ['i1', 3.0000000000000002e-18, 'device']]), run());
    expect(series.currents.map((c) => [c.name, c.value, c.noise, c.given])).toEqual([['V1', 8.881784197001252e-16, undefined, undefined], ['R1', -8.881784197001252e-16, undefined, undefined], ['R2', 0, undefined, undefined], ['I1', 3.0000000000000002e-18, undefined, undefined]]);
    expect(sp(series.warnings.find((m) => m.code === 'imprecise-answers')!.why)).toContain('V1 carries 3 aA, where ngspice gives 888.2 aA the other way; R1 carries 3 aA, where ngspice gives 888.2 aA the other way; and R2 carries 3 aA, where ngspice gives 0 A.');
    kept('* t\nV1 a 0 12\nR1 a b 1k\nR2 a b 1k\nI1 0 b 2A\n.op\n.end\n', op({ a: 12, b: 12.000000000000002 }, [['v1', 3.469446951953614e-18, 'branch'], ['r1', -1.7763568394002505e-18, 'device'], ['r2', -1.7763568394002505e-18, 'device'], ['i1', 2e-18, 'device']]));
  });

  it('a resistor in series with one 10¹³ times larger carries its real current, though its ends are 10⁻¹³ of 12 V apart; so do the parts a 1 fA source or G drives (C9i)', () => {
    kept('* t\nV1 in 0 12\nR1 in a 10\nR2 a 0 1e14\n.op\n.end\n', op({ in: 12, a: 11.9999999999988 }, [['v1', -1.2012613126444194e-13, 'branch'], ['r1', 1.2008172234345695e-13, 'device'], ['r2', 1.19999999999988e-13, 'device']]));
    kept('* t\nV1 a 0 5\nR1 a b 1k\nR2 b 0 1e18\n.op\n.end\n', op({ a: 5, b: 4.999999999999995 }, [['v1', -5.204170427930421e-18, 'branch'], ['r1', 5.3290705182007515e-18, 'device'], ['r2', 4.999999999999995e-18, 'device']]));
    kept('* t\nI1 0 a 1f\nR1 a b 1\nR2 b 0 1e14\n.op\n.end\n', op({ a: 0.10007999171934437, b: 0.10007999171934337 }, [['i1', 1e-15, 'device'], ['r1', 9.992007221626409e-16, 'device'], ['r2', 1.0007999171934337e-15, 'device']]));
    kept('* t\nV1 c 0 1\nG1 0 a c 0 1f\nR1 a b 1\nR2 b 0 1e14\n.op\n.end\n', op({ c: 1, a: 0.10007999171934537, b: 0.10007999171934437 }, [['v1', 0, 'branch'], ['g1', 1e-15, 'device'], ['r1', 9.992007221626409e-16, 'device'], ['r2', 1.0007999171934437e-15, 'device']]));
  });

  it('two ends more than 4 units in the last place apart are not the same voltage: a 1e15 Ω voltmeter across R2 of the balanced bridge makes 2.7 fA flow through R5 (C9l)', () => {
    const text = '* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nRvm a 0 1e15\n.op\n.end\n';
    const w = kept(text, op({ top: 9, a: 4.499999999990972, b: 4.499999999993667 }, [['v1', -0.0014074468085128885, 'branch'], ['r1', 0.00045000000000090286, 'device'], ['r2', 0.00044999999999909717, 'device'], ['r3', 0.0009574468085119857, 'device'], ['r4', 0.0009574468085092909, 'device'], ['r5', -2.6956215037898802e-15, 'device'], ['rvm', 4.499999999990972e-15, 'device']]));
    expect(sp(w.currents.find((c) => c.name === 'R5')!.text)).toBe('2.696 fA from node b to node a through R5');
    // Without the voltmeter its ends are 1 unit in the last place apart: noise (C9).
    const bridge = describeResults(parseNetlist(text.replace('Rvm a 0 1e15\n', '')), op({ top: 9, a: 4.499999999999999, b: 4.5 }, [['v1', -0.0014074468085106386, 'branch'], ['r1', 0.0004500000000000001, 'device'], ['r2', 0.00044999999999999993, 'device'], ['r3', 0.0009574468085106382, 'device'], ['r4', 0.0009574468085106382, 'device'], ['r5', -8.881784197001253e-19, 'device']]), run());
    expect(bridge.currents.find((c) => c.name === 'R5')!.noise).toBe(-8.881784197001253e-19);
  });

  it('the rule never calls a resistor noise for being the only current left at a node: only its own two ends can show that (C9n; the critic of the re-check\'s fixes)', () => {
    // Doctored numbers: I1's 0 stands for a 0 ngspice gives for a real current (C9n's wire), which the
    // rule cannot tell from a true 0. R1's own ends are 300 nV apart, so its 300 fA stays.
    const text = '* t\nV1 y 0 1\nD1 y 0 dmod\nI1 0 x 0\nR1 x 0 1meg\n.model dmod d\n.op\n.end\n';
    const w = describeResults(parseNetlist(text), op({ y: 1, x: 3e-7 }, [['v1', -1e-14, 'branch'], ['i1', 0, 'device'], ['r1', 3e-13, 'device']]), run());
    expect(roundingNoise(parseNetlist(text), op({ y: 1, x: 3e-7 }, [['v1', -1e-14, 'branch'], ['i1', 0, 'device'], ['r1', 3e-13, 'device']])).by).toBe('rule');
    expect(sp(w.currents.find((c) => c.name === 'R1')!.text)).toBe('300 fA from node x to ground through R1');
    expect(w.currents.find((c) => c.name === 'R1')!.noise).toBeUndefined();
  });

  it('a diode to ground does not make every part at ground real: the noise of C9b stays noise, decided exactly whatever current the diode carries, or by the rule for other circuits', () => {
    // Ground takes every current; the diode's current, left free, reaches only its other node, so V1 and F1 at ground stay noise.
    const text = '* t\nV1 in 0 12\nR1 in a 1k\nR3 a b 3k\nF1 0 b V1 2\nD1 0 dd dmod\nRd dd 0 1k\n.model dmod d\n.op\n.end\n';
    const r = op({ in: 12, a: 11.999999999999998, b: 11.999999999999995, dd: -2.5e-13 }, [['v1', -1.734723475976807e-18, 'branch'], ['r1', 1.7763568394002505e-18, 'device'], ['r3', 1.1842378929335003e-18, 'device'], ['f1', -3.469446951953614e-18, 'device'], ['rd', -2.5e-16, 'device']]);
    const w = describeResults(parseNetlist(text), r, run());
    // D1 and Rd make a loop with nothing to drive it: with every diode at 0 A, D1 has exactly 0 V across it, so it
    // carries 0 A (0 V across a diode makes 0 A), and Rd and dd are exactly 0 too, whatever these numbers say.
    expect(w.currents.filter((c) => c.noise !== undefined).map((c) => c.name)).toEqual(['V1', 'R1', 'R3', 'F1', 'Rd']);
    expect(w.nodes.filter((n) => n.noise !== undefined).map((n) => n.node)).toEqual(['dd']);
    // The words give the reason the decision used: Rd and dd are 0 because D1 carries 0 A at 0 V (the critic of round 3:
    // "from the netlist's values and its diodes' currents" said the opposite of how the 0 was found).
    expect(w.warnings.find((m) => m.code === 'rounding-noise')!.why).toContain("from the netlist's values, the circuit makes each of them exactly 0 (D1 has 0 V across it, so it carries no current), so PlainSpice shows 0 A and 0 V.");
    // A line PlainSpice does not model exactly leaves it to the rule, which says so only below ngspice's tolerances.
    const rule = describeResults(parseNetlist(text.replace('.op', '.options gmin=1e-12\n.op')), r, run());
    expect(rule.currents.filter((c) => c.noise !== undefined).map((c) => c.name)).toEqual(['V1', 'R1', 'R3', 'F1']);
    expect(rule.warnings.find((m) => m.code === 'rounding-noise')!.why).toContain("They are below 1 pA, ngspice's current tolerance (its abstol option), so PlainSpice shows 0 A.");
  });

  it("the rule for other circuits never takes a resistor's 0 as proof: C9d keeps what ngspice gave (C9n); with a diode, solved exactly, its 0s are 0", () => {
    // R5's 0 comes from its two ends being the same double, as the 1 µΩ wire's does in C9n, where a real 0.73 aA
    // flows: by ngspice's numbers alone the two cannot be told apart, so Vm is not "the only current left" at m.
    const text = '* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a m 1k\nVm m b 0\nF1 0 out Vm 1000\nR6 out 0 1k\nD1 top 0 dmod\n.model dmod d\n.options gmin=1e-12\n.op\n.end\n';
    const r = op({ top: 9, a: 4.499999999999999, b: 4.499999999999999, m: 4.499999999999999, out: -2.1684043449710089e-13 }, [['v1', -0.0014074468085106388, 'branch'], ['r1', 4.5e-4, 'device'], ['r2', 4.5e-4, 'device'], ['r3', 9.574468085106385e-4, 'device'], ['r4', 9.574468085106381e-4, 'device'], ['r5', 0, 'device'], ['vm', -2.168404344971009e-19, 'branch'], ['r6', -2.1684043449710089e-16, 'device'], ['f1', -2.1684043449710089e-16, 'device']]);
    const w = describeResults(parseNetlist(text), r, run());
    expect(w.currents.filter((c) => c.noise !== undefined).map((c) => c.name)).toEqual([]);
    expect(w.nodes.find((x) => x.node === 'out')!.value).toBe(-2.1684043449710089e-13);
    // Without the .options line the circuit is solved exactly, the diode's current left free: Vm, F1, R6 and out are exactly 0.
    const exact = describeResults(parseNetlist(text.replace('.options gmin=1e-12\n', '')), r, run());
    expect(exact.currents.filter((c) => c.noise !== undefined).map((c) => c.name)).toEqual(['Vm', 'F1', 'R6']);
    expect(exact.nodes.find((x) => x.node === 'out')!.value).toBe(0);
  });

  it('a part next to a diode may carry its current: a 0.1 mΩ resistor and an ammeter in series with a leaking diode keep their currents', () => {
    // R1's two ends are 1 unit in the last place apart, but the diode's leakage flows through it: PlainSpice does not read a diode's current.
    kept('* t\nV1 in 0 0.3\nR1 in a 0.1m\nVm a k 0\nD1 0 k dmod\n.model dmod d\n.op\n.end\n', op({ in: 0.3, a: 0.29999999999999993, k: 0.29999999999999993 }, [['v1', -5.551115123125783e-13, 'branch'], ['r1', 5.551115123125783e-13, 'device'], ['vm', 5.551115123125783e-13, 'branch']]));
  });

  /** The ladder of C9k, solved here section by section in doubles: its values shrink about 2.4 times a section, become subnormal and then 0, as ngspice's do. */
  const ladder = (sections: number): { text: string; results: AnalysisResults } => {
    const lines = ['* ladder', 'V1 n0 0 10'];
    for (let k = 1; k <= sections; k++) lines.push(`Ra${k} n${k - 1} n${k} 1k`, `Rb${k} n${k} 0 2k`, `Vm${k} n${k} m${k} 0`, `Rc${k} m${k} 0 10k`);
    const z: number[] = [];
    for (let k = sections, next = Infinity; k >= 1; k--) {
      const into = 1 / (1 / 2000 + 1 / 10000 + 1 / (1000 + next));
      z[k] = into;
      next = into;
    }
    const v = [10];
    for (let k = 1; k <= sections; k++) v[k] = (v[k - 1]! * z[k]!) / (1000 + z[k]!);
    const nodes: Record<string, number> = {};
    const currents: [string, number, Origin][] = [['v1', -(v[0]! - v[1]!) / 1000, 'branch']];
    for (let k = 1; k <= sections; k++) {
      nodes[`n${k}`] = v[k]!;
      nodes[`m${k}`] = v[k]!;
      currents.push([`ra${k}`, (v[k - 1]! - v[k]!) / 1000, 'device'], [`rb${k}`, v[k]! / 2000, 'device'], [`vm${k}`, v[k]! / 10000, 'branch'], [`rc${k}`, v[k]! / 10000, 'device']);
    }
    nodes.n0 = 10;
    return { text: [...lines, '.op', '.end'].join('\n'), results: op(nodes, currents) };
  };

  it('a ladder of 1000 sections keeps its real nanovolts and femtoamps, and never calls a number too small for a double noise (C9k)', () => {
    const { text, results } = ladder(1000);
    expect(Math.abs(results.op!.nodes.find((x) => x.node === 'n960')!.value)).toBeLessThan(2 ** -1022);
    const w = kept(text, results);
    expect(sp(w.nodes.find((x) => x.node === 'n30')!.text)).toBe('1.395 nV');
    expect(sp(w.currents.find((c) => c.name === 'Rb30')!.text)).toBe('697.5 fA from node n30 to ground through Rb30');
  });

  it('decides in time proportional to the size of the circuit: a ladder of 1000 sections and a bridge with 2000 ammeters (each was seconds)', () => {
    const chain = (count: number): { text: string; results: AnalysisResults } => {
      const lines = ['* bridge with a chain of ammeters', 'V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a m0 1k'];
      const nodes: Record<string, number> = { top: 9, a: 4.499999999999999, b: 4.5 };
      const currents: [string, number, Origin][] = [['v1', -0.0014074468085106386, 'branch'], ['r1', 0.0004500000000000001, 'device'], ['r2', 0.00044999999999999993, 'device'], ['r3', 0.0009574468085106382, 'device'], ['r4', 0.0009574468085106382, 'device'], ['r5', -8.881784197001253e-19, 'device']];
      // Listed from the far end, as the critic did: a rule that marks one more part in each pass over the netlist is slow here.
      for (let k = count; k >= 1; k--) {
        lines.push(`Vm${k} m${k - 1} m${k} 0`);
        nodes[`m${k - 1}`] = 4.5;
        currents.push([`vm${k}`, -8.881784197001253e-19, 'branch']);
      }
      lines.push(`Vlast m${count} b 0`, '.op', '.end');
      nodes[`m${count}`] = 4.5;
      currents.push(['vlast', -8.881784197001253e-19, 'branch']);
      return { text: lines.join('\n'), results: op(nodes, currents) };
    };
    // Best of 5, the netlist parsed once: roundingNoise is the check that took seconds; describeResults is
    // all the words of a run, worked out on the main thread after every run (about 25 ms and 10 ms here).
    const time = ({ text, results }: { text: string; results: AnalysisResults }): { noiseMs: number; wordsMs: number; noise: number } => {
      const netlist = parseNetlist(text);
      let [noiseMs, wordsMs, noise] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 0];
      for (let k = 0; k < 5; k++) {
        let t0 = performance.now();
        noise = roundingNoise(netlist, results).currents.size;
        noiseMs = Math.min(noiseMs, performance.now() - t0);
        // A fresh copy each time: the words of one run are worked out once, and kept with it.
        const fresh = structuredClone(results);
        t0 = performance.now();
        describeResults(netlist, fresh, run());
        wordsMs = Math.min(wordsMs, performance.now() - t0);
      }
      return { noiseMs, wordsMs, noise };
    };
    time(ladder(50));
    const [smallLadder, largeLadder] = [time(ladder(250)), time(ladder(1000))];
    const [smallChain, largeChain] = [time(chain(500)), time(chain(2000))];
    expect([largeLadder.noise, largeChain.noise]).toEqual([0, 2002]);
    for (const large of [largeLadder, largeChain]) {
      expect(large.noiseMs).toBeLessThan(100);
      expect(large.wordsMs).toBeLessThan(400);
    }
    // Four times the parts: about four times the time. Each pass over the whole netlist marked one more part (sixteen times or worse).
    expect(largeLadder.noiseMs).toBeLessThan(10 * Math.max(smallLadder.noiseMs, 1));
    expect(largeChain.noiseMs).toBeLessThan(10 * Math.max(smallChain.noiseMs, 1));
  });
});

describe('after the re-check of the fixes (12 November 2026)', () => {
  it('a source whose value word ngspice cannot read is no ammeter: ngspice stops there, it measures nothing (C3)', () => {
    for (const value of ['−5', '-\u200b5', '－5', '-\u20095', '–5', 'five', 'DC −5']) {
      const text = `* t\nV1 a 0 ${value}\nR1 a 0 1k\n.op\n.end\n`;
      const said = describeCircuit(parseNetlist(text));
      expect(said, value).not.toMatch(/0 V source|ammeter|measures the current/);
      expect(said, value).toContain('V1: a voltage source with its + side at node a and its − side at ground.');
    }
    // A source with no value word, or a 0, is one: ngspice runs it at 0 V and measures its current (P9, P16, P16b).
    for (const value of ['', ' 0', ' DC 0', ' dc']) {
      expect(describeCircuit(parseNetlist(`* t\nV1 a 0${value}\nR1 a 0 1k\n.op\n.end\n`)), value).toContain('V1: a 0 V source from node a to ground: a wire, through which ngspice measures the current (the ammeter trick).');
    }
    // A .param name where the value goes is that value, so no ammeter either (unknown-word-22).
    expect(describeCircuit(parseNetlist('* t\n.param Vs=5\nV1 a 0 Vs\nR1 a 0 1k\n.op\n.end\n'))).not.toContain('ammeter');
  });

  it('a .dc line\'s "Bad syntax!" is its step only when the step is missing or 0; a word that is no number is "ngspice cannot read this line" (S5)', () => {
    const title = (line: string): string => {
      const net = parseNetlist(`* t\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n${line}\n.end\n`);
      return explainDiagnostic({ severity: 'error', code: 'bad-syntax', text: 'Bad syntax!', line: 5 }, net).title;
    };
    for (const line of ['.dc V1 0 5', '.dc V1 0 5 0', '.dc V1 0 5 V2 0 1 0.5', '.dc V1 0 5 1 V2 0 1', '.dc V1 0 5 1 V2 0 1 0']) expect(title(line), line).toBe('.dc needs a step that is not 0');
    for (const line of ['.dc V1 −5 5 1', '.dc V1 0 \u200b5 1', '.dc V1 V1 5 1 -400m', '.dc V1 0 V1 1', '.dc V1 O 5 1', '.dc V1 0 5 1 V2 −1 1 0.5']) expect(title(line), line).toBe('ngspice cannot read this line');
  });
});

describe('after the critic of the re-check fixes (12 November 2026)', () => {
  it('a .dc line ngspice 47 stops at is no sweep in the circuit\'s words (CR1-11)', () => {
    for (const dc of ['.dc V1 \u22125 5 1', '.dc V1 0 5 0\u200b.5', '.dc V1 0', '.dc V1 0 5 1 2']) {
      const said = describeCircuit(parseNetlist(`* t\nV1 in 0 1\nR1 in 0 1k\n${dc}\n.end\n`));
      expect(said, dc).toContain('Analysis: a DC sweep at which ngspice 47 stops ("Bad syntax!"): see Checks.');
      expect(said, dc).not.toContain('Analysis: DC sweep of');
    }
    expect(sp(describeCircuit(parseNetlist('* t\n.param st=1\nV1 in 0 1\nR1 in 0 1k\n.dc V1 0 5 {st}\n.end\n')))).toContain('Analysis: DC sweep of V1 from 0 V to 5 V in steps of {st}.');
  });

  it('a .dc "Bad syntax!" with a number in braces is its step only when that step is in braces; a missing stop is not the step (CR1-4)', () => {
    const title = (head: string, dc: string): string => {
      const net = parseNetlist(`* t\n${head}V1 in 0 1\nR1 in 0 1k\n${dc}\n.end\n`);
      const n = net.lines.findIndex((l) => l.directive?.name === '.dc') + 1;
      return explainDiagnostic({ severity: 'error', code: 'bad-syntax', text: 'Bad syntax!', line: n }, net).title;
    };
    expect(title('.param st=0\n', '.dc V1 0 5 {st}')).toBe('.dc needs a step that is not 0');
    expect(title('.param lo=0\n', '.dc V1 {lo} 5 0')).toBe('.dc needs a step that is not 0');
    expect(title('.param lo=0\n', '.dc V1 {lo} 5 x')).toBe('ngspice cannot read this line');
    expect(title('', '.dc V1 0')).toBe('ngspice cannot read this line');
  });

  it('"TSTOP is invalid" on a .tran line with a stop time is a stop of 0 or less, not one number (CR1-13; tran-problems-8, invisible-character-29)', () => {
    const said = (tran: string): { title: string; why: string } => {
      const net = parseNetlist(`* t\nV1 in 0 1\nR1 in 0 1k\n${tran}\n.end\n`);
      return explainDiagnostic({ severity: 'error', code: 'bad-tran-arguments', text: 'TSTOP is invalid, must be greater than zero.', subject: 'TSTOP', line: 4 }, net);
    };
    for (const tran of ['.tran 0.1m 0', '.tran 0.1m -1m', '.tran 0.1m 0\u200b.5', '.tran 0.1m 0 uic']) {
      expect(said(tran).title, tran).toBe('The .tran stop time must be more than 0');
      expect(said(tran).why, tran).not.toContain('With one number');
    }
    expect(said('.tran 5m').title).toBe('.tran needs a step and a stop time');
    expect(said('.tran 5m uic').title).toBe('.tran needs a step and a stop time');
  });
});

describe('after the critic of round 2 of the re-check\'s fixes: where ngspice\'s answers are off, the exact solution keeps the rule\'s words true', () => {
  // The bridge of C9s (a 1e-12 Ω wire: ngspice's answers 4 % off, so the rule decides, with ngspice's own values below), and
  // beside it V2 at 9.0000000000000036 V, two steps of a double above V1's 9 V, with resistors of 1 G and 2 G between them.
  const text =
    '* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nRw a m 1e-12\nR5 m b 1k\nV2 t 0 9.0000000000000036\nRh top w 1g\nRx w t 1g\nVm w y 0\nRy y q 1g\nRq1 top q 2g\nRq2 q t 2g\n.op\n.end\n';
  const [t, w] = [9.000000000000004, 9.000000000000002];
  const results = op({ top: 9, a: 4.32056594239515, b: 4.374128347650329, m: 4.32056594239515, t, w, y: w, q: w }, [
    ['v1', -0.001452171416898713, 'branch'], ['r1', 0.00046794340576048507, 'device'], ['r2', 0.000432056594239515, 'device'], ['r3', 0.000984228011138228, 'device'],
    ['r4', 0.0009306656058830487, 'device'], ['rw', 0, 'device'], ['r5', -0.00005356240525517908, 'device'],
    ['v2', -((t - w) / 1e9 + (t - w) / 2e9), 'branch'], ['rh', (9 - w) / 1e9, 'device'], ['rx', (w - t) / 1e9, 'device'], ['vm', 1e-30, 'branch'],
    ['ry', 0, 'device'], ['rq1', (9 - w) / 2e9, 'device'], ['rq2', (w - t) / 2e9, 'device'],
  ]);

  it('the rule takes Rh and Rx, whose ends ngspice gives a step apart, as noise, and Vm as the only current left at w; the exact solution keeps Rh and Rx real, so Vm\'s 0 (exactly 0) is not said to be "the only current left at w"', () => {
    const words = describeResults(parseNetlist(text), results, run());
    expect(words.warnings.some((m) => m.code === 'imprecise-answers')).toBe(true);
    expect(words.currents.filter((c) => c.noise !== undefined).map((c) => c.name)).toEqual(['Vm']);
    // Rh, Rx, Rq1, Rq2 and V2 carry real attoamps, a millionth of a millionth of what flows elsewhere: shown as ngspice gives them.
    for (const name of ['Rh', 'Rx', 'Rq1', 'Rq2', 'V2']) expect(words.currents.find((c) => c.name === name)!.value, name).not.toBe(0);
    const why = words.warnings.find((m) => m.code === 'rounding-noise')!.why;
    expect(why).not.toContain('every other current');
    expect(why).toBe("ngspice gave Vm 1.000000e-30 A. That is rounding noise, what its arithmetic leaves of a current that is 0. It is below 1 pA, ngspice's current tolerance (its abstol option), so PlainSpice shows 0 A.");
  });
});
