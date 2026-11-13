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
import { formatSI } from '../../src/format/si.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { describeResults, roundingNoise, shownSweep, SWEEP_VALUES, type ResultsInWords } from '../../src/spice/describe.ts';
import { exactModel } from '../../src/spice/exact.ts';
import { readAfterEnd } from '../../src/spice/explain.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { leastWorkMs } from './work-time.ts';

const root = resolve(import.meta.dirname, '../..');
let ngspice: NgspiceEngine;
beforeAll(async () => {
  ngspice = await NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(root, 'engine/dist/ngspice.wasm')));
});

const netlist = (...l: string[]): string => `* t\n${l.join('\n')}\n.end\n`;
const sp = (s: string | undefined): string => (s ?? '').replace(/[\u00a0\u2009\u202f]/g, ' ');
const by = (r: Awaited<ReturnType<typeof solveText>>): string => roundingNoise(r.netlist, r.results).by;
const node = (w: ResultsInWords, name: string): string => sp(w.nodes.find((n) => n.node === name)?.text);
const current = (w: ResultsInWords, name: string): ResultsInWords['currents'][number] | undefined => w.currents.find((c) => c.name === name);
const message = (w: ResultsInWords, code: string): string | undefined => {
  const m = w.warnings.find((x) => x.code === code);
  return m && `${sp(m.title)}: ${sp(m.why)}`;
};

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

describe('an op-amp modelled as an E of high gain is never decided by the rule with nothing said (C1: 9.5 V for 9.15 V)', () => {
  it('a non-inverting amplifier with an E of 1e15: ngspice gives out 9.5 V, its gain lifting a step of a double at inm, where the circuit makes 9.15 V; the page shows ngspice\'s numbers with the warning that names the exact ones', async () => {
    const r = await solveText(netlist('V1 in 0 3.3', 'E1 out 0 in inm 1e15', 'R1 inm 0 220', 'R2 out inm 390', 'Rl out 0 390', '.op'), ngspice);
    expect([by(r), node(r.words, 'out'), sp(current(r.words, 'R2')?.text)]).toEqual(['rule', '9.5 V', '15.9 mA from node out to node inm through R2']);
    expect(message(r.words, 'imprecise-answers')).toContain('R2 carries 15 mA, where ngspice gives 15.9 mA; E1 carries 38.46 mA, where ngspice gives 40.26 mA; Rl carries 23.46 mA, where ngspice gives 24.36 mA; and node out is at 9.15 V, where ngspice gives 9.5 V.');
  });

  it('a difference amplifier with an E of 1e12: ngspice gives out −999.9 mV where the circuit makes −1 V, with the warning', async () => {
    const r = await solveText(netlist('V1 a 0 2', 'V2 b 0 1.5', 'R1 a inm 10k', 'R2 inm out 20k', 'R3 b inp 10k', 'R4 inp 0 20k', 'E1 out 0 inp inm 1e12', '.op'), ngspice);
    expect([by(r), node(r.words, 'out')]).toEqual(['rule', '−999.9 mV']);
    expect(message(r.words, 'imprecise-answers')).toContain('node out is at −1 V, where ngspice gives −999.9 mV; E1 carries 100 µA, where ngspice gives 99.99 µA; and R2 carries 100 µA, where ngspice gives 99.99 µA.');
  });

  it('a balanced difference amplifier with an E of 1e9: out, exactly 0 V, which ngspice gives as −476.8 nV, is 0 V with the rounding-noise note, and E1 makes no power (it was "E1 delivers 119.2 pW")', async () => {
    const r = await solveText(netlist('V1 a 0 5', 'R1 a inm 10k', 'R2 inm out 10k', 'R3 a inp 10k', 'R4 inp 0 10k', 'E1 out 0 inp inm 1e9', '.op'), ngspice);
    expect([by(r), node(r.words, 'out'), r.words.nodes.find((n) => n.node === 'out')?.noise, current(r.words, 'E1')?.power]).toEqual(['exact', '0 V', -4.76837158203125e-7, undefined]);
    expect(message(r.words, 'rounding-noise')).toContain('ngspice gave node out -4.768372e-07 V. That is rounding noise');
    expect(message(r.words, 'maybe-noise')).toBeUndefined();
  });

  it('a circuit whose conductances are more than the largest double apart (1e-12 Ω beside 1e300 Ω) is checked, not dropped: describing it threw "not a finite number"', async () => {
    const r = await solveText(netlist('V1 a 0 1', 'R1 a b 1e-12', 'R2 b 0 1e300', 'R3 b 0 1k', '.op'), ngspice);
    expect([r.words.status, by(r)]).toEqual(['ok', 'rule']);
    expect(message(r.words, 'imprecise-answers')).toContain('V1 carries 1 mA, where ngspice gives 976.6 µA; and R1 carries 1 mA, where ngspice gives 999.2 µA.');
  });

  it('where ngspice\'s numbers do not fit the circuit PlainSpice reads, past what its arithmetic can leave, though they agree with their own products (S28: a "+ 3" after .end makes ngspice\'s R1 3 Ω), a note says that they could not be checked, never "node n1 is at 2 V, where ngspice gives 3 V"', async () => {
    const r = await solveText('* a + line after .end\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n', ngspice);
    expect([by(r), node(r.words, 'n1'), message(r.words, 'imprecise-answers')]).toEqual(['rule', '3 V', undefined]);
    expect(message(r.words, 'unchecked-answers')).toBe(
      "PlainSpice could not check ngspice's numbers: ngspice's numbers in the operating point do not fit the circuit PlainSpice reads from this netlist: the currents at one of its nodes do not add up to 0, or a source does not make what it is written to make, by more than ngspice's arithmetic can leave. Either ngspice lost most of its digits solving this circuit, or it reads a line of the netlist otherwise than PlainSpice does. So PlainSpice shows ngspice's numbers as it gives them, finding rounding noise from those numbers alone, and they may not agree with each other.",
    );
    // A note, not a warning: the summary counts none.
    expect(sp(r.words.summary)).toBe('Simulation finished: node n1 = 3 V. Open the results for details.');
  });

  it('a checked point of a sweep whose values do not fit the circuit, though they agree with their own products (doctored), leaves the sweep as ngspice gives it with the same note, "in the DC sweep at V1 = 9 V"', async () => {
    const text = netlist('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', '.options savecurrents', '.op', '.dc V1 0 9 3');
    const r = await solveText(text, ngspice);
    expect(by(r)).toBe('exact');
    const doctored = structuredClone(r.results);
    const dc = doctored.dc!;
    const last = dc.scale.values.length - 1;
    const series = (name: string): Float64Array => dc.series.find((s) => s.name === name)!.values as Float64Array;
    // Node a 1 % high, and every resistor current its own voltages over its resistance: Kirchhoff's law at a fails.
    series('v(a)')[last] = series('v(a)')[last]! * 1.01;
    const v = (n: string): number => (n === '0' ? 0 : series(`v(${n})`)[last]!);
    for (const [name, a, b, ohms] of [['r1', 'top', 'a', 10e3], ['r2', 'a', '0', 10e3], ['r5', 'a', 'b', 1e3]] as const) series(`i(@${name}[i])`)[last] = (v(a) - v(b)) / ohms;
    const w = describeResults(parseNetlist(text), doctored, r.run);
    expect(shownSweep(parseNetlist(text), doctored)).toBe(doctored.dc);
    expect(message(w, 'unchecked-answers')).toContain("ngspice's numbers in the DC sweep at V1 = 9 V do not fit the circuit PlainSpice reads from this netlist");
  });
});

describe('beside an .op the rule decides, the sweep\'s point at the .op\'s own state is found within what ngspice\'s adding up of the step leaves, and the .tf beside it gets a note (C2)', () => {
  const bridge = ['V1 top 0 9', 'R1 top a {rtop}', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', '.options savecurrents', '.op'];
  const r5At = (r: Awaited<ReturnType<typeof solveText>>, k: number): [number, number] => {
    const pick = (dc: { series: { name: string; values: ArrayLike<number> }[] }): number => dc.series.find((s) => s.name === 'i(@r5[i])')!.values[k]!;
    return [pick(r.results.dc!), pick(shownSweep(r.netlist, r.results)!)];
  };

  it('".dc V1 0 9 0.01" ends at 8.999999999999853 V, where ngspice gives R5 the .op\'s very −8.882e-19 A: the sweep shows 0 there, as the .op does, with a .param line, beside a transistor, and with a .control block that runs', async () => {
    const variants = [
      ['.param rtop=10k', ...bridge, '.dc V1 0 9 0.01'],
      ['.param rtop=10k', ...bridge, 'Q1 top x 0 qmod', 'Rx x 0 1meg', '.model qmod npn', '.dc V1 0 9 0.01'],
      ['.param rtop=10k', ...bridge, '.dc V1 0 9 0.01', '.control', 'run', '.endc'],
    ];
    for (const lines of variants) {
      const r = await solveText(netlist(...lines), ngspice);
      const last = r.results.dc!.scale.values.length - 1;
      expect(r.results.dc!.scale.values[last], lines.join(' | ')).toBe(8.999999999999853);
      expect([by(r), sp(current(r.words, 'R5')?.text), r5At(r, last)], lines.join(' | ')).toEqual(['rule', 'no current through R5', [-8.881784197001253e-19, 0]]);
      expect(sp(r.words.sweeps[0]!.text), lines.join(' | ')).toContain('i(@r5[i]) = 0 A');
      expect(message(r.words, 'rounding-noise'), lines.join(' | ')).toBeDefined();
      expect(r.words.warnings.filter((m) => m.code === 'rounding-noise').map((m) => sp(m.why)), lines.join(' | ')).toContain(
        "ngspice gave i(@r5[i]) -8.881784e-19 A at V1 = 9 V. That is the operating point's own state, where ngspice gives the operating point's numbers, and the operating point shows it as 0, as its note says. So PlainSpice shows 0 there too, in these words and in the Plot panel; at the other points the sweep is as ngspice gives it.",
      );
    }
  });

  it('a sweep that never comes within a quarter of a step of the .op\'s 9 V (to 8.5 V) has no point at its state, and keeps ngspice\'s numbers', async () => {
    const r = await solveText(netlist('.param rtop=10k', ...bridge, '.dc V1 0 8.5 0.01'), ngspice);
    expect(by(r)).toBe('rule');
    expect(shownSweep(r.netlist, r.results)).toBe(r.results.dc);
  });

  it('the .tf beside an .op the rule decides, a slope it cannot decide, gets the note that it may be rounding noise where the .op shows its output as 0 and it is less than a billionth of its input\'s own response: v(a,b)/V1 = −5.551e-17 V/V beside R5\'s two ends at one voltage (it was drawn with nothing said); a ratio of 0.5, of 3.6 V/A from a source of 1 aA, or a ladder\'s far node gets none', async () => {
    const r = await solveText(netlist('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a b 1k', 'Q1 top x 0 qmod', 'Rx x 0 1meg', '.model qmod npn', '.options savecurrents', '.op', '.tf v(a,b) V1'), ngspice);
    const tf = r.words.tf!.transferFunction!;
    expect([by(r), sp(tf.text), tf.maybe, tf.noise]).toEqual(['rule', 'v(a,b)/V1 = −5.551e-17 (V/V)', 'zero', undefined]);
    const note = r.words.warnings.find((m) => m.title === 'The transfer function may be rounding noise')!;
    expect([note.code, note.severity, sp(note.why)]).toEqual([
      'maybe-noise',
      'note',
      "ngspice gave v(a,b)/V1 = -5.551115e-17. In the operating point node a and node b are at the same voltage, and this ratio is less than a billionth of a volt for each volt of V1, so it may be rounding noise, what ngspice's arithmetic leaves of a ratio that is exactly 0, or a real ratio that small. PlainSpice cannot tell which from ngspice's numbers alone, so it shows it as ngspice gives it.",
    ]);
    const half = await solveText(netlist('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'Q1 top x 0 qmod', 'Rx x 0 1meg', '.model qmod npn', '.op', '.tf v(a) V1'), ngspice);
    expect([sp(half.words.tf!.transferFunction!.text), half.words.tf!.transferFunction!.maybe, half.words.warnings.some((m) => m.code === 'maybe-noise')]).toEqual(['v(a)/V1 = 0.5 (V/V)', undefined, false]);
    // Its own input resistance, 3.6 Ω, is the scale of a ratio in V/A: the .op's 3.6 aV for 1 aA says nothing of it.
    const small = await solveText(netlist('I1 0 a 1A', 'R1 a 0 3.6', 'Q1 a x 0 qmod', 'Rx x 0 1meg', '.model qmod npn', '.op', '.tf v(a) I1'), ngspice);
    expect([sp(small.words.tf!.transferFunction!.text), small.words.tf!.transferFunction!.maybe]).toEqual(['v(a)/I1 = 3.6 (V/A)', undefined]);
    // An ammeter's current per volt is weighed by the current through the input for each of its volts.
    const amm = await solveText(netlist('V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a m 1k', 'Vm m b 0', 'Q1 top x 0 qmod', 'Rx x 0 1meg', '.model qmod npn', '.op', '.tf i(Vm) V1'), ngspice);
    expect(sp(amm.words.warnings.find((m) => m.title === 'The transfer function may be rounding noise')?.why)).toMatch(/^ngspice gave i\(Vm\)\/V1 = \S+\. In the operating point Vm measures no current, and this ratio is less than a billionth of the current through V1 for each of its volts \(156\.4 µA\), so it may be rounding noise/);
    // A ladder's far node, real however small, is not 0 in the operating point: no note.
    const ladder = ['V1 n0 0 1.5', 'R1 n0 n1 1.5k', 'R2 n1 0 12', 'R3 n1 n2 1.5k', 'R4 n2 0 12', 'R5 n2 n3 1.5k', 'R6 n3 0 12', 'R7 n3 n4 1.5k', 'R8 n4 0 12', 'R9 n4 n5 1.5k', 'R10 n5 0 12', 'Q1 n0 x 0 qmod', 'Rx x 0 1meg', '.model qmod npn'];
    const far = await solveText(netlist(...ladder, '.op', '.tf v(n5) V1'), ngspice);
    const ratio = far.words.tf!.transferFunction!;
    expect(Math.abs(ratio.value)).toBeLessThan(2 ** -30);
    expect([ratio.maybe, far.words.warnings.some((m) => m.code === 'maybe-noise' && m.title.startsWith('The transfer function'))]).toEqual([undefined, false]);
  });
});

describe('by the rule, a node proven real proves the current of a resistor from it to ground, and Kirchhoff\'s law spreads it (C7)', () => {
  it('a .param ladder read through a 1 µΩ wire, a 0 V ammeter and a 1 TΩ meter, with a dangling 1e20 Ω resistor: node4 has node3\'s very double, so Rvm\'s node4 / 1 TΩ is real, and Vm in series: no note calls them maybe noise beside node4\'s real 738.2 nV', async () => {
    const r = await solveText(netlist('.param x=1', 'V1 n0 0 1.5', 'R1 n0 n1 1.5k', 'R2 n1 0 12', 'R3 n1 n2 1.5k', 'R4 n2 0 12', 'R5 n2 node3 1.5k', 'R6 node3 0 12', 'Rw node3 p 1u', 'Vm p node4 0', 'Rvm node4 0 1t', 'R9 node3 nodeq 1e20', '.op'), ngspice);
    expect([by(r), node(r.words, 'node4'), sp(current(r.words, 'Rvm')?.text), sp(current(r.words, 'Vm')?.text)]).toEqual(['rule', '738.2 nV', '7.382e-19 A from node4 to ground through Rvm', 'Vm measures 7.382e-19 A flowing from node p to node4']);
    expect(message(r.words, 'maybe-noise')).toBeUndefined();
  });
});

describe('a .control block that only runs is modelled exactly, behind the same-circuit check (C8)', () => {
  const modelled = (text: string): string => {
    const n = parseNetlist(text);
    const m = exactModel(n, n.lines.flatMap((l) => (l.element ? [l.element] : [])), readAfterEnd(n));
    return typeof m === 'string' ? m : 'modelled';
  };

  it('".control / run / .endc", with comments and blank lines, leaves the circuit to the exact solution; any other control line does not', () => {
    const base = '* t\nV1 a 0 1\nR1 a 0 1\n.op\n';
    expect(modelled(`${base}.control\n* again\nrun\n\n.endc\n.end\n`)).toBe('modelled');
    expect(modelled(`${base}.control\nRUN\n.endc\n.end\n`)).toBe('modelled');
    for (const line of ['op', 'set filetype=ascii', 'print v(a)', 'alter R1 2', 'run\nwrite out.raw']) expect(modelled(`${base}.control\n${line}\n.endc\n.end\n`), line).toBe('directive');
  });

  it('the H of 1 GΩ reading a balanced bridge\'s ammeter, run from a .control block: out is 0 V and H1 carries no current, with the note, as without the block (it drew "node out: −193.5 nV" and "H1 delivers 37.45 aW")', async () => {
    const lines = ['V1 top 0 9', 'R1 top a 180k', 'R2 a 0 3.9meg', 'R3 top b 18k', 'R4 b 0 390k', 'R5 a m 4.7', 'Vm m b 0', 'H1 out 0 Vm 1g', 'Rl out 0 1k', '.options savecurrents', '.op'];
    for (const extra of [[], ['.control', 'run', '.endc']]) {
      const r = await solveText(netlist(...lines, ...extra), ngspice);
      expect([by(r), node(r.words, 'out'), sp(current(r.words, 'H1')?.text), current(r.words, 'H1')?.power], extra.join(' ')).toEqual(['exact', '0 V', 'no current through H1', undefined]);
      expect(message(r.words, 'rounding-noise'), extra.join(' ')).toContain('ngspice gave R5 -3.779483e-16 A, Vm -1.935098e-16 A, H1 1.935098e-10 A, Rl -1.935098e-10 A and node out -1.935098e-07 V.');
    }
  });
});

describe('the paths no test held (C9): a temperature sweep too large to look through, at a .temp line\'s own temperature; a sweep judged from the values a .save line keeps', () => {
  /** The C9 bridge with 53 ammeters in its middle branch, every current saved. */
  const ammeters = (): string[] => {
    const amm = ['V1 top 0 9', 'R1 top a 10k', 'R2 a 0 10k', 'R3 top b 4.7k', 'R4 b 0 4.7k', 'R5 a m0 1k'];
    for (let k = 0; k < 53; k++) amm.push(`Vm${k} m${k} ${k === 52 ? 'b' : `m${k + 1}`} 0`);
    return [...amm, '.options savecurrents', '.op'];
  };

  it('.temp 50 beside a sweep of the temperature over more values than SWEEP_VALUES: its point at 50 °C, the .op\'s own temperature (not ngspice\'s 27 °C), shows the .op\'s 0s, and 27 °C keeps ngspice\'s numbers', async () => {
    const r = await solveText(netlist(...ammeters(), '.temp 50', '.dc TEMP 0 100 0.005'), ngspice);
    const dc = r.results.dc!;
    expect(dc.scale.values.length * dc.series.length).toBeGreaterThan(SWEEP_VALUES);
    const near = (t: number): number => Array.from(dc.scale.values).reduce((best, x, k) => (Math.abs(x - t) < Math.abs(dc.scale.values[best]! - t) ? k : best), 0);
    const [at50, at27] = [near(50), near(27)];
    expect([sp(formatSI(dc.scale.values[at50]!, '°C')), sp(formatSI(dc.scale.values[at27]!, '°C'))]).toEqual(['50 °C', '27 °C']);
    const given = dc.series.find((x) => x.name === 'i(vm0)')!.values;
    const shown = shownSweep(r.netlist, r.results)!.series.find((x) => x.name === 'i(vm0)')!.values;
    expect([given[at50] !== 0, shown[at50], shown[at27]]).toEqual([true, 0, given[at27]]);
    expect(message(r.words, 'sweep-not-checked')).toContain("except at 50 °C, the operating point's own state, where the sweep shows what the operating point shows.");
  }, 120_000);

  const c9m = ['V1 n1 0 9', 'R1 n1 n2 15k', 'R2 n2 n3 330', 'R3 n3 0 33k', 'R4 n1 n4 15k', 'R5 n4 n5 330', 'R6 n5 0 33k', 'R7 n3 n5 100k'];

  it('C9m with ".save v(n3) v(n5) @r7[i]" and a sweep: the sweep is judged from the values the .save line keeps, so R7, exactly 0 at every point, is 0 in the sweep too', async () => {
    const r = await solveText(netlist(...c9m, '.save v(n3) v(n5) @r7[i]', '.op', '.dc V1 0 9 3'), ngspice);
    const given = Array.from(r.results.dc!.series.find((x) => x.name === 'i(@r7[i])')!.values);
    expect(given.some((v) => v !== 0)).toBe(true);
    expect([by(r), Array.from(shownSweep(r.netlist, r.results)!.series.find((x) => x.name === 'i(@r7[i])')!.values)]).toEqual(['exact', [0, 0, 0, 0]]);
  });

  it('the 1 nΩ wire of C9w.7 with ".save v(d2) v(p3) @r3[i]": the saved values are off at its checked point (433.7 pA for 340.6 pA), so the sweep is not decided, and the warning names it', async () => {
    const r = await solveText(netlist('V1 top1 0 1.5', 'R1 top1 d2 270k', 'R2 d2 0 820', 'R3 d2 p3 1n', 'R4 p3 0 10meg', '.save v(d2) v(p3) @r3[i]', '.op', '.dc V1 0 1.5 0.00025'), ngspice);
    expect(message(r.words, 'imprecise-answers')).toContain('at V1 = 1.125 V, R3 carries 340.6 pA, where ngspice gives 433.7 pA.');
  });
});
