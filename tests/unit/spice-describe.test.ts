/**
 * src/spice/describe.ts without the engine: the circuit overview, results in words from made-up
 * results (directions, power, ammeters, .tf, sweeps, messages, the live summary), the notes for
 * the editor, and the plain words for every diagnostic code. The same words on real engine runs
 * are checked in tests/golden/facts-explain.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { AnalysisResults } from '../../src/engine/results.ts';
import type { EngineDiagnostic, RawPlot, RunResult } from '../../src/engine/types.ts';
import { DESCRIBE_STRINGS, DESCRIBED_PARTS, annotateLines, describeCircuit, describeResults, explainDiagnostic } from '../../src/spice/describe.ts';
import { parseNetlist } from '../../src/spice/parse.ts';

const MINUS = '−';
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
  it('describes F5 in netlist order, as the brief asks', () => {
    expect(sp(describeCircuit(parseNetlist(F5)))).toBe(
      '5 parts and 3 nodes besides ground (a, x, n1). Itest: a 1 A current source pushing current from ground into a. Vx: a 0 V source from a to x, used as an ammeter. R2: a 2 Ω resistor between x and n1. R1: a 4 Ω resistor between n1 and ground. F1: a current-controlled current source pushing 2 × the current in Vx from ground into n1. Analysis: operating point.',
    );
  });

  it('describes every explained letter', () => {
    const text = sp(
      describeCircuit(
        parseNetlist('* t\nV1 c 0 2\nVs c d 0\nR1 d 0 1k\nC1 d 0 1u\nL1 d e 1m\nE1 o1 0 c 0 2\nG1 0 o2 c 0 0.5\nF1 0 o3 Vs 3\nH1 o4 0 Vs 4\nI1 0 o5 1m\nK1 L1 L2 0.9\nL2 f 0 1m\nVp p 0 PULSE(0 5 0 1u 1u 1 2)\n.op\n'),
      ),
    );
    expect(text).toContain(`V1: a 2 V source with its + side at c and its ${MINUS} side at ground.`);
    expect(text).toContain('Vs: a 0 V source from c to d, used as an ammeter.');
    expect(text).toContain('R1: a 1 kΩ resistor between d and ground.');
    expect(text).toContain('C1: a 1 µF capacitor between d and ground.');
    expect(text).toContain('L1: a 1 mH inductor between d and e.');
    expect(text).toContain('E1: a voltage-controlled voltage source: the voltage at o1, measured from ground, is 2 × the voltage at c, measured from ground.');
    expect(text).toContain('G1: a voltage-controlled current source pushing 500 mA for every volt at c from ground into o2.');
    expect(text).toContain('F1: a current-controlled current source pushing 3 × the current in Vs from ground into o3.');
    expect(text).toContain('H1: a current-controlled voltage source: the voltage at o4, measured from ground, is 4 V for every amp in Vs.');
    expect(text).toContain('I1: a 1 mA current source pushing current from ground into o5.');
    expect(text).toContain('K1: couples L1 and L2 (coupling 0.9).');
    expect(text).toContain(`Vp: a PULSE voltage source with its + side at p and its ${MINUS} side at ground.`);
  });

  it('describes other parts with their node labels and model', () => {
    const text = sp(describeCircuit(parseNetlist('* t\nD1 a 0 dmod\nQ1 c b 0 qn\nX1 a b amp\n.model dmod D\n.model qn NPN\n.op\n')));
    expect(text).toContain(`D1: a diode (+ node a, ${MINUS} node ground, model dmod).`);
    expect(text).toContain('Q1: a bipolar junction transistor (collector c, base b, emitter ground, model qn).');
    expect(text).toContain('X1: a subcircuit (node a, node b, subcircuit amp).');
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
      ['Itest', '1 A from 0 to a through Itest', '0', 'a', false, 'Itest delivers 14 W'],
      ['Vx', 'Vx measures 1 A flowing from a to x', 'a', 'x', true, ''],
      ['R2', '1 A from x to n1 through R2', 'x', 'n1', false, ''],
      ['R1', '3 A from n1 to 0 through R1', 'n1', '0', false, ''],
      ['F1', '2 A from 0 to n1 through F1', '0', 'n1', false, 'F1 delivers 24 W'],
    ]);
    expect(words.currents[0]).toMatchObject({ element: 'itest', line: 2, value: 1 });
    expect(words.currents.find((c) => c.name === 'R1')?.speech).toBe('3 amps flow from n1 to ground through R1');
    expect(words.currents.find((c) => c.name === 'R2')?.speech).toBe('1 amp flows from x to n1 through R2');
    expect(words.currents.find((c) => c.name === 'Vx')?.speech).toBe('Vx measures 1 amp flowing from a to x');
    expect(words.currents.find((c) => c.name === 'F1')?.power).toMatchObject({ watts: 24, delivers: true, speech: 'F1 delivers 24 watts' });
  });

  it('writes the live summary', () => {
    expect(sp(words.summary)).toBe('Simulation finished: a = 14 V, x = 14 V, n1 = 12 V; 5 currents. Open the results for details.');
  });

  it('a voltage source that delivers power reads negative; one that absorbs reads positive (C1, C2)', () => {
    const n = parseNetlist('* t\nV1 a 0 6\nV2 b 0 12\nR1 b a 3\n.op\n');
    const w = describeResults(n, op({ a: 6, b: 12 }, [['v1', 2, 'branch'], ['v2', -2, 'branch']]), run());
    expect(w.currents.map((c) => [sp(c.text), sp(c.power?.text)])).toEqual([
      ['2 A from a to 0 through V1', 'V1 absorbs 12 W'],
      ['2 A from 0 to b through V2', 'V2 delivers 24 W'],
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
    expect(w.currents.map((c) => sp(c.text))).toEqual(['Vx measures 3 A flowing from a to b', 'Vy measures no current']);
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

  it('F4: the ratio, the input resistance and the Thevenin resistance (A3)', () => {
    const w = describeResults(parseNetlist('* F4\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\nR3 n1 a 2\n.tf v(a) V1\n'), tfResults(1 / 3, { at: 'v(a)', value: 4 }, { source: 'v1', value: 9 }), run());
    const tf = w.tf!;
    expect(tf).toMatchObject({ output: 'v(a)', input: 'V1', ratio: 'V/V' });
    expect(sp(tf.transferFunction?.text)).toBe('v(a)/V1 = 0.3333 (V/V)');
    expect(tf.transferFunction?.speech).toBe('the transfer function from V1 to the voltage at a is 0.3333 volts per volt');
    expect(sp(tf.inputResistance?.text)).toBe('input resistance seen by V1: 9 Ω (ngspice calls it the input impedance)');
    expect(tf.inputResistance?.speech).toBe('the input resistance seen by V1 is 9 ohms');
    expect(sp(tf.outputResistance?.text)).toBe('output resistance at a: 4 Ω, the Thevenin resistance seen at a (ngspice calls it the output impedance)');
    expect(sp(w.summary)).toBe('Simulation finished: transfer function v(a)/V1 = 0.3333 (V/V); input resistance seen by V1: 9 Ω; output resistance at a: 4 Ω. Open the results for details.');
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
    expect(w.tf?.transferFunction?.speech).toBe('the transfer function from I1 to the voltage at a and b is 1 volt per amp, which is an ohm');
    expect(sp(w.tf?.outputResistance?.text)).toContain('output resistance between a and b: 3 Ω');
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
    expect(sp(w.sweeps[0]!.speech)).toBe('DC sweep of V1 from 0 V to 12 V in steps of 1 V: 13 points. When V1 is 12 volts: the voltage at out is 8 volts, the current in V1 is minus 4 milliamps.');
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
    expect(w.sweeps[0]!.speech).toContain('At 5 milliseconds: the voltage at out is 4.966 volts, the current in C1 is 34 microamps.');
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
    expect(sp(w.summary)).toBe('Simulation finished: a = 6 V, b = 6 V; 1 current. 1 warning: R1 is too small for ngspice. Open the results for details.');
  });
});

describe('annotateLines', () => {
  it('F5: one short note per part line', () => {
    const n = parseNetlist(F5);
    expect(annotateLines(n, F5_RESULTS).map((a) => [a.line, sp(a.text), a.speech])).toEqual([
      [2, '1 A, 0 → a, delivers 14 W', '1 amp flows from ground to a; delivers 14 watts'],
      [3, '1 A, a → x', 'measures 1 amp flowing from a to x'],
      [4, '1 A, x → n1', '1 amp flows from x to n1'],
      [5, '3 A, n1 → 0', '3 amps flow from n1 to ground'],
      [6, '2 A, 0 → n1, delivers 24 W', '2 amps flow from ground to n1; delivers 24 watts'],
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
    '* t\nV1 n1 0 6\nR1 n1 0 2\nr1 n1 0 4\n1k a 0 5\nX1 a 0 amp\nD1 a 0 dmod\nM1 d g 0 0 nm\n.model nm nmos level=8\nK1 L1 L2 0.9\nB1 a 0 5\n.tf v(n1) V9\n.dc V9 0 1 1\n.tran 5m\n.foo\n$ odd\n',
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
    expect(after.currents.map((c) => sp(c.text))).toEqual(['6 A from 0 to a through V1', '3 A from a to 0 through R1', '3 A from a to 0 through R2']);
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
    expect(sp(w.summary)).toBe('Simulation finished: a = 14 V, x = 14 V, n1 = 12 V; 5 currents. Open the results for details.');
    expect(w.summarySpeech).toBe('Simulation finished: a is 14 volts, x is 14 volts, n1 is 12 volts; 5 currents. Open the results for details.');
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
    expect(s.speech).toContain('At 100 degrees Celsius: the voltage at a is 1 volt.');
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
