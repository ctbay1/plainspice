/**
 * src/spice/explain.ts without the engine: every line kind, every part letter, every dot command,
 * the value spellings, the fixtures line by line, the point counts, and robustness. What these
 * texts claim about ngspice is checked against real runs in tests/golden/facts-explain.test.ts
 * (docs/spice-facts/explanations.md) and tests/golden/facts-numbers.test.ts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ELEMENTS } from '../../src/spice/elements.ts';
import {
  EXPLAIN_STRINGS,
  acSweepPoints,
  dcSweepPoints,
  explainLine,
  explainNetlist,
  isDrawingComment,
  isKnownDotCommand,
  leftOutModel,
  readAnalysis,
  valueWords,
} from '../../src/spice/explain.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { isDrawingLine } from '../../src/schematic/format.ts';
import type { LineExplanation } from '../../src/spice/types.ts';
import { leastWorkMs } from './work-time.ts';

const MINUS = '−';
/** formatSI writes a no-break space between number and unit; expectations here use a plain space. */
const sp = (s: string | undefined): string => (s ?? '').replace(/ /g, ' ');

/** The explanation of line `n` (1-based) of a netlist. */
function line(text: string, n: number): LineExplanation {
  const e = explainLine(parseNetlist(text), n - 1);
  if (!e) throw new Error(`no line ${n}`);
  return e;
}
const rows = (e: LineExplanation): string[][] => e.fields.map((f) => [f.label, f.text, sp(f.meaning)]);
const labels = (e: LineExplanation): string[] => e.fields.map((f) => f.label);
const meaningOf = (e: LineExplanation, label: string, k = 0): string => sp(e.fields.filter((f) => f.label === label)[k]?.meaning);
const notes = (e: LineExplanation): string => sp(e.notes.join(' '));

const root = resolve(import.meta.dirname, '../..');
const fixtureDir = join(root, 'tests/fixtures');
const fixtures = readdirSync(fixtureDir).filter((f) => f.endsWith('.cir')).sort();
const fixture = (name: string): string => readFileSync(join(fixtureDir, name), 'utf8');

describe('explainNetlist: one explanation per physical line, in order', () => {
  it.each(fixtures)('%s is explained line by line without gaps', (name) => {
    const n = parseNetlist(fixture(name));
    const all = explainNetlist(n);
    expect(all.map((e) => e.line)).toEqual(n.lines.map((l) => l.number));
    for (const e of all) {
      expect(e.heading.length, `line ${e.line}`).toBeGreaterThan(3);
      expect(e.summary.length, `line ${e.line}`).toBeGreaterThan(10);
      for (const f of e.fields) {
        expect(f.meaning.length, `line ${e.line} ${f.label}`).toBeGreaterThan(0);
        if (f.span) expect(n.text.slice(f.span.from, f.span.to)).toBe(f.text);
      }
    }
  });

  it('returns undefined outside the netlist', () => {
    const n = parseNetlist('* t\nR1 a 0 1\n');
    expect(explainLine(n, -1)).toBeUndefined();
    expect(explainLine(n, 99)).toBeUndefined();
  });
});

describe('the fixtures, in the channel\'s words', () => {
  it('F1a: the title, V1, R1, .op and .end', () => {
    const text = fixture('f1a-voltage-source.cir');
    expect(line(text, 1)).toMatchObject({ line: 1, heading: 'Title line' });
    expect(line(text, 1).summary).toBe('Line 1 is the title. SPICE always skips it, whatever it says, so a part written here would silently disappear.');
    const v1 = line(text, 2);
    expect(v1.heading).toBe('V1: a voltage source');
    expect(sp(v1.summary)).toBe(`V1 has its + side at node n1 and its ${MINUS} side at ground (node 0). SPICE reads that as V(n1) ${MINUS} V(0) = 6 V. Ground is 0 V, so node n1 sits at 6 V.`);
    expect(rows(v1)).toEqual([
      ['name', 'V1', 'the first letter, V, makes it a voltage source'],
      ['+ node', 'n1', 'the + side is at node n1'],
      [`${MINUS} node`, '0', `the ${MINUS} side is at ground (node 0)`],
      ['value', '6', '6 V'],
    ]);
    expect(v1.fields[1]!.emphasis).toEqual(['+']);
    expect(v1.fields[2]!.emphasis).toEqual([MINUS]);
    expect(notes(v1)).toContain("SPICE counts a source's current as positive when it enters at the first node, here the + side");
    const r1 = line(text, 3);
    expect(sp(r1.summary)).toBe('R1 is a 2 Ω resistor between node n1 and ground (node 0).');
    expect(rows(r1)).toEqual([
      ['name', 'R1', 'the first letter, R, makes it a resistor'],
      ['node', 'n1', 'one end is at node n1'],
      ['node', '0', 'the other end is at ground (node 0)'],
      ['value', '2', '2 Ω'],
    ]);
    expect(notes(r1)).toBe("Resistors work either way round, and the part lines can come in any order. Line 1 is always the title, and the parts go before .end.");
    expect(line(text, 4).heading).toBe('.op: operating point');
    expect(line(text, 4).summary).toBe(
      'Find the DC operating point: every node voltage and the current in every voltage source. Capacitors act as open circuits and inductors as short circuits.',
    );
    expect(line(text, 5).heading).toBe('.end: end of the netlist');
  });

  it('F1b: the swapped source makes n1 −6 V', () => {
    expect(sp(line(fixture('f1b-voltage-source-swapped.cir'), 2).summary)).toBe(
      `V1 has its + side at ground (node 0) and its ${MINUS} side at node n1. SPICE reads that as V(0) ${MINUS} V(n1) = 6 V. Ground is 0 V, so node n1 sits at ${MINUS}6 V.`,
    );
  });

  it('F2a and F2b: from node, to node, current', () => {
    const a = line(fixture('f2a-current-source.cir'), 2);
    expect(labels(a)).toEqual(['name', 'from node', 'to node', 'current']);
    expect(sp(a.summary)).toBe(
      'A current source has its own pattern: name, from node, to node, current. The current flows from the first node, through the source, into the second, the way the arrow points. So I1 pushes 3 A from ground (node 0), through the source, into node n1.',
    );
    expect(a.fields[1]).toMatchObject({ meaning: 'the current comes from ground (node 0)', emphasis: ['from'] });
    expect(a.fields[2]).toMatchObject({ meaning: 'and flows to node n1', emphasis: ['to'] });
    expect(sp(line(fixture('f2b-current-source-swapped.cir'), 2).summary)).toContain('So I1 pushes 3 A from node n1, through the source, into ground (node 0).');
  });

  it('F3a and F3b: 1M is a milliohm, 1meg a megaohm', () => {
    const a = line(fixture('f3a-1M-trap.cir'), 3);
    expect(meaningOf(a, 'value')).toBe('1 mΩ (milli!)');
    expect(sp(a.summary)).toBe('R1 is a 1 mΩ resistor between node n1 and node n2.');
    expect(notes(a)).toContain('SPICE ignores capital letters, so M is the same as m: milli. 1M is 1 mΩ. For mega, write 1meg.');
    expect(meaningOf(line(fixture('f3a-1M-trap.cir'), 4), 'value')).toBe('1 MΩ');
    expect(meaningOf(line(fixture('f3b-1meg.cir'), 3), 'value')).toBe('1 MΩ');
  });

  it('F4: .tf v(a) V1', () => {
    const tf = line(fixture('f4-tf-output-impedance.cir'), 6);
    expect(tf.heading).toBe('.tf: transfer function');
    expect(tf.summary).toBe(
      'Find three DC quantities: the transfer function v(a)/V1 (output ÷ input), the input resistance seen by V1, and the output resistance at node a, which is the Thévenin resistance seen at node a. ngspice calls the two resistances "impedance"; at DC they are resistances, in ohms. The transfer function is in V/V.',
    );
    expect(rows(tf)).toEqual([
      ['command', '.tf', 'transfer function'],
      ['output', 'v(a)', 'the output: the voltage at node a, measured from ground'],
      ['input source', 'V1', 'the input: V1, the voltage source on line 2'],
    ]);
  });

  it('F5: the ammeter Vx and the CCCS F1', () => {
    const text = fixture('f5-thevenin-cccs.cir');
    expect(sp(line(text, 3).summary)).toBe(
      `Vx has its + side at node a and its ${MINUS} side at node x. SPICE reads that as V(a) ${MINUS} V(x) = 0 V. So node a and node x are at the same voltage: Vx works like a wire. A 0 V source is how SPICE measures a current: the ammeter trick.`,
    );
    const f1 = line(text, 6);
    expect(f1.heading).toBe('F1: a current-controlled current source (CCCS)');
    expect(labels(f1)).toEqual(['name', 'from node', 'to node', 'control source', 'gain']);
    expect(sp(f1.summary)).toBe(
      `2 × the current in Vx, pushed from ground (node 0) into node n1. The current in Vx counts as positive when it flows from its + side (node a), through Vx, to its ${MINUS} side (node x).`,
    );
    expect(meaningOf(f1, 'control source')).toBe('it reads the current in Vx, the voltage source on line 3');
    expect(meaningOf(f1, 'gain')).toBe('2: the output current is 2 × the current it reads');
    expect(notes(f1)).toBe(
      'F and H read a current. But SPICE can only read the current through a voltage source. So first, put a 0 V source in the branch you want to measure: the ammeter trick.',
    );
  });

  it('D1: the swept source and .dc with 13 points', () => {
    const text = fixture('d1-dc-divider-sweep.cir');
    expect(line(text, 2).summary).toContain('The .dc on line 5 sweeps this source, so in that analysis its value changes.');
    const dc = line(text, 5);
    expect(sp(dc.summary)).toBe('Sweep V1 from 0 V to 12 V in steps of 1 V: 13 points. At each point ngspice finds the DC operating point (capacitors open, inductors short).');
    expect(labels(dc)).toEqual(['command', 'source', 'start', 'stop', 'step']);
  });

  it('T1: the PULSE arguments and .tran', () => {
    const text = fixture('t1-tran-rc-charge.cir');
    const v1 = line(text, 2);
    expect(labels(v1)).toEqual(['name', '+ node', `${MINUS} node`, 'source function', 'start value', 'pulse value', 'delay', 'rise time', 'fall time', 'pulse width', 'period']);
    expect(meaningOf(v1, 'rise time')).toBe('1 µs: how long it takes to rise');
    expect(sp(v1.summary)).toContain("It has no DC value, so in .op ngspice uses the PULSE source's value at time 0: 0 V.");
    const c1 = line(text, 4);
    expect(notes(c1)).toBe('In .op and .dc a capacitor is an open circuit: no DC current flows through it.');
    const tran = line(text, 5);
    expect(sp(tran.summary)).toBe("Simulate over time from 0 to 5 ms. ngspice picks its own time points, at most 10 µs apart.");
    expect(labels(tran)).toEqual(['command', 'tstep', 'tstop']);
  });
});

describe('every part letter', () => {
  const lines: Record<string, string> = {
    A: 'A1 a 0 amod',
    B: 'B1 a 0 V=2*v(c)',
    C: 'C1 a 0 1u',
    D: 'D1 a 0 dmod',
    E: 'E1 a 0 c 0 2',
    F: 'F1 0 a V1 2',
    G: 'G1 0 a c 0 0.5',
    H: 'H1 a 0 V1 4',
    I: 'I1 0 a 3',
    J: 'J1 d g 0 jmod',
    K: 'K1 L1 L2 0.9',
    L: 'L1 a 0 1m',
    M: 'M1 d g 0 0 mmod',
    N: 'N1 a 0 nmod',
    O: 'O1 a 0 b 0 omod',
    P: 'P1 a b 0 c d 0 pmod',
    Q: 'Q1 c b 0 qmod',
    R: 'R1 a 0 1k',
    S: 'S1 a 0 c 0 smod',
    T: 'T1 a 0 b 0 z0=50 td=1n',
    U: 'U1 a b 0 umod',
    V: 'V1 a 0 5',
    W: 'W1 a 0 V1 wmod',
    X: 'X1 a b sub',
    Y: 'Y1 a 0 b 0 ymod',
    Z: 'Z1 d g 0 zmod',
  };

  it.each(ELEMENTS.map((e) => [e.letter, e.name, e.code ?? ''] as const))('%s: %s', (letter, name, code) => {
    const e = line(`* t\n${lines[letter]}\n.end\n`, 2);
    expect(e.heading.startsWith(`${letter}1: a`)).toBe(true);
    expect(e.heading).toContain(name);
    if (code) expect(e.heading).toContain(`(${code})`);
    expect(e.fields[0]).toMatchObject({ label: 'name', text: `${letter}1` });
    expect(e.fields.every((f) => f.meaning.length > 0)).toBe(true);
    expect(e.summary.length).toBeGreaterThan(10);
  });

  it('gives R, C, L, V, I, E, F, G, H and K full field tables in the channel\'s words', () => {
    const table = (l: string): string[] => labels(line(`* t\nV1 c 0 1\nL1 x 0 1m\nL2 y 0 1m\n${l}\n.end\n`, 5));
    expect(table('R2 a 0 1k')).toEqual(['name', 'node', 'node', 'value']);
    expect(table('C1 a 0 1u')).toEqual(['name', 'node', 'node', 'value']);
    expect(table('L3 a 0 1m')).toEqual(['name', 'node', 'node', 'value']);
    expect(table('V2 a 0 5')).toEqual(['name', '+ node', `${MINUS} node`, 'value']);
    expect(table('I1 0 a 3')).toEqual(['name', 'from node', 'to node', 'current']);
    expect(table('E1 a 0 c 0 2')).toEqual(['name', '+ node', `${MINUS} node`, 'control + node', `control ${MINUS} node`, 'gain']);
    // G's and H's values in plain words, the same as the trap texts and elements.ts (review, 10 Nov 2026).
    expect(table('G1 0 a c 0 0.5')).toEqual(['name', 'from node', 'to node', 'control + node', `control ${MINUS} node`, 'amps per volt']);
    expect(table('F1 0 a V1 2')).toEqual(['name', 'from node', 'to node', 'control source', 'gain']);
    expect(table('H1 a 0 V1 4')).toEqual(['name', '+ node', `${MINUS} node`, 'control source', 'volts per amp']);
    expect(table('K1 L1 L2 0.9')).toEqual(['name', 'inductor', 'inductor', 'coupling']);
  });

  it('E, G and H in the channel\'s sentences (P5, P6, P8)', () => {
    const net = '* t\nV1 c 0 2\nVs c d 0\nRd d 0 1\nE1 out1 0 c 0 2\nG1 0 out2 c 0 0.5\nH1 out4 0 Vs 4\nE2 p q c d 1.5\nG2 x y c d 1m\n.end\n';
    expect(line(net, 5).summary).toBe(`The voltage at node out1, measured from ground, is 2 × the voltage at node c, measured from ground. SPICE reads it as V(out1) ${MINUS} V(0) = 2 × (V(c) ${MINUS} V(0)).`);
    expect(sp(line(net, 6).summary)).toBe(`500 mA for every volt at node c, pushed from ground (node 0) into node out2. SPICE reads it as a current of 0.5 × (V(c) ${MINUS} V(0)) flowing from ground, through G1, into node out2.`);
    expect(sp(line(net, 7).summary)).toContain('The voltage at node out4, measured from ground, is 4 V for every amp in Vs.');
    expect(line(net, 8).summary).toContain('The voltage at node p, measured from node q, is 1.5 × the voltage at node c, measured from node d.');
    expect(sp(line(net, 9).summary)).toContain('1 mA for every volt between node c and node d, pushed from node x into node y.');
    expect(meaningOf(line(net, 6), 'amps per volt')).toBe('500 mA for every volt it reads (amps per volt)');
    expect(meaningOf(line(net, 7), 'volts per amp')).toBe('4 V for every amp it reads (volts per amp, which is ohms)');
  });

  it('checks the control source of F and H (P10, P10b, P10c, P10d)', () => {
    const base = '* t\nV1 a 0 6\nR1 a 0 2\nL1 a b 1m\nE1 e 0 a 0 1\n';
    expect(meaningOf(line(`${base}F1 0 o E1 2\n`, 6), 'control source')).toBe('it reads the current in E1, the voltage-controlled voltage source on line 5');
    const r = line(`${base}F1 0 o R1 2\n`, 6);
    expect(meaningOf(r, 'control source')).toBe('it reads the current in R1, but R1 is a resistor, not a voltage source');
    expect(notes(r)).toContain('ngspice can only read the current of a voltage source (V, a controlled one, E or H, or a B line with V=), so it stops: "unknown controlling source".');
    // P10d: a B line with V= can be read; one with I= has no current to read (control-source-5).
    const bv = `${base}B1 c 0 V=2*v(a)\nF1 0 o B1 2\n`;
    expect(meaningOf(line(bv, 7), 'control source')).toBe('it reads the current in B1, the behavioural source on line 6');
    expect(notes(line(bv, 7))).not.toContain('unknown controlling source');
    const bi = line(`${base}B1 0 c I=v(a)/6\nF1 0 o B1 2\n`, 7);
    expect(meaningOf(bi, 'control source')).toBe('it reads the current in B1, but B1 is a behavioural source with I= (a current source), not a voltage source');
    expect(notes(bi)).toContain('B1 has I=, so it is a current source with no current of its own to read: ngspice accepts the name, warns "singular matrix" and stops.');
    expect(meaningOf(line(`${base}H1 o 0 L1 2\n`, 6), 'control source')).toBe('it reads the current in L1, but L1 is an inductor, not a voltage source');
    const missing = line(`${base}F1 0 o Vq 2\n`, 6);
    expect(meaningOf(missing, 'control source')).toBe('it reads the current in Vq, but there is no voltage source called Vq');
    expect(notes(missing)).toContain('There is no voltage source called Vq in this netlist, so ngspice stops: "unknown controlling source".');
  });

  it('K: the inductors it couples (P21, M16)', () => {
    const k = line('* t\nL1 a 0 1m\nK1 L1 L2 0.99\n', 3);
    expect(k.summary).toBe('K1 couples L1 and L2 magnetically, like the two windings of a transformer, with coupling coefficient 0.99.');
    expect(meaningOf(k, 'inductor', 0)).toBe('L1, the inductor on line 2');
    expect(meaningOf(k, 'inductor', 1)).toBe('L2: there is no inductor called L2');
    expect(notes(k)).toBe('There is no inductor called L2, so ngspice stops: "coupling to non-existent inductor".');
    expect(meaningOf(k, 'coupling')).toBe('0.99: the coupling coefficient k');
  });

  it('parts with a model or a subcircuit say whether it is there (M6, M7, M8)', () => {
    const d = line('* t\nD1 a 0 dmod\n', 2);
    expect(labels(d)).toEqual(['name', '+ node (anode)', `${MINUS} node (cathode)`, 'model']);
    expect(meaningOf(d, '+ node (anode)')).toBe('the anode (+ side) is at node a');
    expect(notes(d)).toBe('There is no .model line called dmod, so ngspice stops: it cannot find the model.');
    expect(meaningOf(line('* t\nD1 a 0 dmod\n.model dmod D\n', 2), 'model')).toBe('the model dmod, defined on line 3');
    const x = line('* t\nX1 a b amp\n', 2);
    expect(meaningOf(x, 'subcircuit')).toBe('the subcircuit amp: there is no .subckt amp');
    expect(notes(x)).toBe('There is no .subckt amp, so ngspice stops: "unknown subckt".');
    const m = line('* t\nM1 d g 0 0 nm\n.model nm nmos level=8\n', 2);
    expect(notes(m)).toBe(
      'The .model line for nm uses level=8, which selects BSIM3, a chip-design model that PlainSpice\'s engine leaves out. ngspice stops: "could not find a valid modelname".',
    );
    expect(sp(m.summary)).toContain('M1 is a MOS field-effect transistor: drain at node d, gate at node g, source at ground (node 0) and bulk at ground (node 0).');
  });

  it('parts the engine does not have (A, N, O) say so', () => {
    for (const l of ['A1 a 0 amod', 'N1 a 0 nmod', 'O1 a 0 b 0 omod']) {
      expect(notes(line(`* t\n${l}\n`, 2))).toContain("PlainSpice's engine cannot run this line.");
    }
  });

  it('B lines: V= and its expression, or the fatal error without one (M19)', () => {
    const b = line('* t\nB1 a 0 V=2*v(c)\n', 2);
    expect(b.fields.slice(3).map((f) => f.label)).toEqual(['expression', 'expression', 'expression', 'expression', 'expression']);
    expect(notes(b)).toBe('');
    expect(notes(line('* t\nB1 a 0 5\n', 2))).toBe('A B line needs an expression, V=… or I=…; without one ngspice stops with a fatal error.');
  });

  it('a part inside .subckt says so', () => {
    expect(notes(line('* t\n.subckt amp in out\nRin in out 1k\n.ends\nX1 a b amp\n', 3))).toContain('This part belongs to the subcircuit amp (from line 2)');
    // With no X line that uses amp, ngspice skips the line, and the note says that, with the subcircuit (A3i, the integration check P1).
    expect(notes(line('* t\n.subckt amp in out\nRin in out 1k\n.ends\n', 3))).toBe('ngspice skips this line: it is inside the subcircuit amp (from line 2), and no X line uses that subcircuit.');
  });
});

describe('values in plain units, with the traps in their spelling', () => {
  const value = (text: string, letter = 'R'): LineExplanation => {
    const l = { R: `R1 a 0 ${text}`, C: `C1 a 0 ${text}`, I: `I1 0 a ${text}`, V: `V1 a 0 ${text}` }[letter]!;
    return line(`* t\n${l}\n`, 2);
  };

  it.each([
    ['1k', 'R', '1 kΩ', ''],
    ['1meg', 'R', '1 MΩ', ''],
    ['1M', 'R', '1 mΩ (milli!)', 'For mega, write 1meg.'],
    ['4.7MOhm', 'R', "4.7 mΩ (milli!; 'Ohm' is ignored)", 'For mega, write 4.7meg.'],
    ['10kOhm', 'R', "10 kΩ ('Ohm' is ignored)", "ngspice ignores 'Ohm' after the number."],
    ['2k2', 'R', "2 kΩ ('2' is ignored)", "ngspice ignores the '2' after the k in 2k2. For 2.2 kΩ, write a decimal point."],
    ['3A', 'I', '3 aA (atto!)', 'A is atto (10⁻¹⁸), so 3A is practically zero.'],
    ['1F', 'C', '1 fF (femto!)', 'F is femto (10⁻¹⁵), so 1F is tiny.'],
    ['1μF', 'C', "1 F ('μF' is ignored)", 'The Greek letter μ is not a scale letter'],
    ['1µF', 'C', "1 µF ('F' is ignored)", "ngspice ignores 'F' after the number."],
    ['10V', 'V', "10 V ('V' is ignored)", "ngspice ignores 'V' after the number."],
    ['-2', 'R', `${MINUS}2 Ω`, 'ngspice accepts a negative resistance without a message.'],
    // The editor's words for one idea: two nodes made one by a name (not "joined").
    ['0', 'R', '0 Ω', 'ngspice 47 cannot use 0 Ω: it warns ("Value of resistor … is too small") and uses 10⁻¹² Ω instead, and the currents next to it come out inaccurate. To make two nodes one, give them the same name'],
    ['3a', 'R', '3 aΩ (atto!)', 'ngspice 47 raises a resistance below 10⁻¹² Ω to 10⁻¹² Ω'],
  ])('%s on %s reads as %s', (text, letter, meaning, note) => {
    const e = value(text, letter);
    const v = e.fields.filter((f) => f.text === text).pop()!;
    expect(sp(v.meaning)).toBe(meaning);
    if (note) expect(notes(e)).toContain(note);
  });

  it('a second number replaces the first on an R line, and the note says why (V2, N9, N13)', () => {
    const comma = line('* t\nR1 n1 0 1,5k\n', 2);
    expect(rows(comma).slice(3)).toEqual([
      ['value', '1', 'not used: ngspice reads the next number, 5 kΩ, and uses that'],
      ['value', '5k', '5 kΩ'],
    ]);
    expect(notes(comma)).toContain('ngspice read two numbers for the value, 1 and 5k, and uses the last one: 5 kΩ. A comma separates words in SPICE: use a decimal point.');
    expect(notes(line('* t\nR1 a 0 1d-3\n', 2))).toContain(`ngspice read two numbers for the value, 1d and -3, and uses the last one: ${MINUS}3 Ω. A + or ${MINUS} after a digit or a letter starts a new word`);
    expect(notes(line('* t\nR1 a 0 1 2\n', 2))).toContain('ngspice read two numbers for the value, 1 and 2, and uses the last one: 2 Ω.');
  });

  it('on a source, the number right after the nodes beats a later DC value (V1)', () => {
    const e = line('* t\nV1 a 0 5 dc 6\n', 2);
    expect(rows(e).slice(3)).toEqual([
      ['value', '5', '5 V'],
      ['value', 'dc', 'DC: the steady (DC) value comes next (DC is optional)'],
      ['value', '6', 'not used: the number right after the nodes wins (5 V)'],
    ]);
  });

  it('values given by name (V3) and parameters', () => {
    expect(meaningOf(line('* t\nR1 a 0 r=2\n', 2), 'value', 0)).toBe('r=: the resistance is given by name');
    expect(meaningOf(line('* t\nI1 0 a c=3\n', 2), 'current', 0)).toBe('c=: the current is given by name');
    const ic = line('* t\nC1 a 0 1u ic=2\n', 2);
    expect(rows(ic).slice(4)).toEqual([
      ['parameter', 'ic', 'ic: its starting value for .tran with uic'],
      ['parameter value', '2', 'its value, 2 V'],
    ]);
  });

  it('an expression, and a .param name in braces (N17, A23)', () => {
    const e = line('* t\n.param rval=2k\nR1 a 0 {rval}\nR2 a 0 {rval*2}\n', 3);
    expect(meaningOf(e, 'value')).toBe('2 kΩ (rval, from .param on line 2)');
    const x = line('* t\n.param rval=2k\nR1 a 0 {rval}\nR2 a 0 {rval*2}\n', 4);
    expect(meaningOf(x, 'value')).toBe('an expression: ngspice works out its value before running');
    expect(x.summary).toContain('Its value is an expression, which ngspice works out before running.');
  });

  it('missing values (P15, P15b, P16)', () => {
    expect(notes(line('* t\nR1 a 0\n', 2))).toContain('This resistor has no value, so ngspice leaves it out of the circuit, with a warning ("… is not a valid resistor instance line, ignored!").');
    expect(notes(line('* t\nC1 a 0\n', 2))).toContain('This capacitor has no value');
    expect(notes(line('* t\nV1 a 0\n', 2))).toContain('This source has no DC value, so in .op ngspice uses 0 V and says so in a note');
    expect(notes(line('* t\nI1 0 a\n', 2))).toContain('so in .op ngspice uses 0 A');
  });

  it('source functions: PULSE, SIN, PWL, EXP and AC (P16–P20b)', () => {
    const sin = line('* t\nV1 a 0 SIN(1 2 1k 1m 100 90)\n', 2);
    expect(labels(sin).slice(3)).toEqual(['source function', 'offset', 'amplitude', 'frequency', 'delay', 'damping', 'phase']);
    expect(meaningOf(sin, 'frequency')).toBe('1 kHz: cycles per second');
    expect(meaningOf(sin, 'phase')).toBe('90°: how far into its cycle the wave starts, in degrees');
    expect(sin.summary).toContain("so in .op ngspice uses the SIN source's value at time 0.");
    const pwl = line('* t\nI1 0 a PWL(0 0 1m 5)\n', 2);
    expect(rows(pwl).slice(4)).toEqual([
      ['time', '0', '0 s: a time'],
      ['value', '0', '0 A: the value at that time'],
      ['time', '1m', '1 ms: a time'],
      ['value', '5', '5 A: the value at that time'],
    ]);
    expect(sp(line('* t\nV1 a 0 EXP(3 5 1m 1m)\n', 2).summary)).toContain("uses the EXP source's value at time 0: 3 V.");
    const ac = line('* t\nV1 a 0 AC 1\n', 2);
    expect(rows(ac).slice(3)).toEqual([
      ['AC value', 'AC', 'AC: the next number is its size in an .ac analysis'],
      ['AC value', '1', '1 V: its size in an .ac analysis (not a DC value)'],
    ]);
    expect(notes(ac)).toContain('An AC value alone is not a DC value.');
  });

  it('valueWords on its own', () => {
    const n = parseNetlist('* t\nR1 a 0 1M\n');
    const token = n.lines[1]!.element!.value!.token;
    expect(valueWords(n, token, 'Ω')).toMatchObject({ value: 0.001, trap: true });
    expect(sp(valueWords(n, { from: 0, to: 2, text: '2k' }, 'Ω').text)).toBe('2 kΩ');
    expect(valueWords(n, { from: 0, to: 3, text: 'abc' }, 'Ω')).toMatchObject({ text: 'abc', trap: false });
  });
});

describe('a node in Explain\'s sentences (words review W8; done when the lanes were merged)', () => {
  it('says "node in" in a sentence, as the editor, the overview and the cards do; formulas keep the name as written', () => {
    const net = '* t\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\nV2 out m 1\nR3 m 0 1k\n.op\n.end\n';
    // "So in sits 6 V above out" read as an odd sentence: a name may be an ordinary word.
    expect(sp(line(net, 2).summary)).toBe(`V1 has its + side at node in and its ${MINUS} side at ground (node 0). SPICE reads that as V(in) ${MINUS} V(0) = 6 V. Ground is 0 V, so node in sits at 6 V.`);
    expect(sp(line(net, 3).summary)).toBe('R1 is a 1 kΩ resistor between node in and node out.');
    expect(sp(line(net, 5).summary)).toContain(`SPICE reads that as V(out) ${MINUS} V(m) = 1 V. So node out sits 1 V above node m.`);
    expect(rows(line(net, 3)).slice(1, 3).map((r) => r[2])).toEqual(['one end is at node in', 'the other end is at node out']);
  });

  it('never says "node node": a label that already says node keeps the name alone, others say where', () => {
    expect(sp(line('* t\nD1 a 0 dmod\n.model dmod D\n', 2).summary)).toContain(`D1 is a diode: + node a and ${MINUS} node ground (node 0).`);
    expect(sp(line('* t\nQ1 c b 0 qmod\n.model qmod NPN\n', 2).summary)).toContain('Q1 is a bipolar junction transistor: collector at node c, base at node b and emitter at ground (node 0).');
    for (const text of ['* t\nX1 a 0 sub1\n.subckt sub1 p q\nR1 p q 1k\n.ends\n', '* t\nD1 a 0 dmod\n', '* t\nV1 a 0 1\nR1 a 0 1k\n']) {
      const n = parseNetlist(text);
      for (const e of explainNetlist(n)) for (const t of [e.summary, ...e.fields.map((f) => f.meaning)]) expect(t).not.toMatch(/node node/);
    }
  });

  it('keeps ground "ground" and quotes a node named like ground: no "node ground" for either', () => {
    const g = line('* t\nV1 ground 0 5\nR1 ground 0 1k\n', 2);
    expect(sp(g.summary)).toBe(`V1 has its + side at the node "ground" and its ${MINUS} side at ground (node 0). SPICE reads that as V(ground) ${MINUS} V(0) = 5 V. Ground is 0 V, so the node "ground" sits at 5 V.`);
    expect(sp(line('* t\nI1 0 b 1\nG1 0 c b 0 1m\n', 3).summary)).toContain('flowing from ground, through G1, into node c.');
  });
});

describe('nodes and ground (W8–W14)', () => {
  it('0 and gnd are ground; gnd as the last word is not; ground and 00 are ordinary nodes', () => {
    expect(meaningOf(line('* t\nR1 a gnd 1\n', 2), 'node', 1)).toBe('the other end is at ground (node 0); ground: gnd is another name for node 0');
    const vx = line('* t\nV1 a 0 6\nVx b gnd\n', 3);
    expect(vx.fields[2]!.meaning).toBe(`the ${MINUS} side is at the node "gnd", which is not ground here: as the last word of a line, ngspice keeps gnd as an ordinary node`);
    expect(notes(vx)).toContain('so here Vx goes to an ordinary node called gnd, not to ground. Write 0 instead.');
    const g = line('* t\nR6 b ground 1\n', 2);
    expect(g.summary).toBe('R6 is a 1 Ω resistor between node b and the node "ground".');
    expect(notes(g)).toContain('"ground" is an ordinary node name in ngspice: only 0 and gnd are ground (node 0). If you meant ground, write 0.');
    expect(notes(line('* t\nR1 a 00 1\n', 2))).toContain('"00" is an ordinary node name in ngspice');
  });
});

describe('lines that are not parts', () => {
  it('the title: blank, looking like a part, ending in two backslashes, starting with @ (S1–S5)', () => {
    expect(line('\nR1 a 0 1\n', 1).summary).toBe('Line 1 is the title, even when it is blank. SPICE always skips it.');
    expect(notes(line('V1 n1 0 6\nR1 n1 0 2\n', 1))).toContain('This line looks like a part.');
    expect(notes(line('Voltage divider\nR1 a 0 1\n', 1))).toBe('');
    expect(notes(line('title \\\\\nR1 a 0 1\n', 1))).toContain('ngspice skips line 2 as well');
    expect(line('@ title\nR1 a 0 1\n', 1)).toMatchObject({ heading: 'A line starting with @', summary: 'Line 1 starts with @: ngspice reads nothing at all, not even the title.' });
  });

  it('blank lines and every kind of comment (S6, S8, S10, S11, S19, S36, P22)', () => {
    const text = '* t\n\n* star\n# hash\n; semicolon\n$ dollar\n// slashes\n\fformfeed\n! bang\n';
    expect(line(text, 2)).toMatchObject({ heading: 'Blank line', summary: 'SPICE skips blank lines.' });
    expect(line(text, 3).summary).toBe('The star marks a comment, a line SPICE skips.');
    expect(line(text, 4).summary).toContain('in ngspice 47, the version PlainSpice runs');
    expect(line(text, 5).summary).toBe('A line starting with ; is a comment, a line SPICE skips.');
    expect(line(text, 6).summary).toBe('ngspice turns a line starting with $ into a comment and skips it, with a warning ("Unusual leading characters").');
    expect(line(text, 7).summary).toBe('A line starting with // is a comment, a line SPICE skips.');
    expect(line(text, 8).summary).toContain('a form feed');
    expect(line(text, 9).summary).toContain('starting with !');
  });

  it('continuation lines: normal, after two backslashes, into a comment, with nothing before (S18–S24)', () => {
    const plus = '* t\nR1 n1 0\n+ 2\n';
    expect(line(plus, 3).summary).toBe('A line starting with + continues the line before it: SPICE reads it as part of line 2 (R1).');
    expect(rows(line(plus, 3))).toEqual([['value', '2', '2 Ω']]);
    expect(line('* t\nR1 n1 0 \\\\\n2\n', 3).summary).toBe('The line before ends with two backslashes, so SPICE reads this line as part of line 2 (R1).');
    const swallowed = '* t\nR1 n1 0\n; a comment\n+ 2\n';
    expect(line(swallowed, 4).summary).toBe('The line it continues, line 3, is a comment, so ngspice adds these words to that comment and ignores them.');
    expect(notes(line(swallowed, 4))).toBe('So R1 on line 2 does not get these words.');
    expect(notes(line(swallowed, 3))).toContain('A + line below continues this comment');
    expect(line('* t\n+ R1 n1 0 2\n', 2).summary).toBe('There is no line before it to continue (only the title), so ngspice skips it silently.');
    expect(line('* t\n.dc V1 0 2\n+ 1\n', 3).summary).toContain('part of line 2 (.dc)');
  });

  it('.control blocks and *# / ## lines (S16, S17, S31, A27)', () => {
    const text = '* t\n.control\nrun\n.endc\n*# echo hi\n## echo hi\n';
    expect(line(text, 2).heading).toBe('.control: start of ngspice commands');
    expect(line(text, 2).summary).toContain('ngspice runs them first, before the analyses of the dot commands');
    expect(line(text, 3).summary).toBe('A command for ngspice inside .control … .endc, not a part of the circuit.');
    expect(line(text, 4).heading).toBe('.endc: end of ngspice commands');
    expect(line(text, 5).summary).toContain('A line starting with *# is a command for ngspice, not a comment');
    expect(line(text, 6).summary).toContain('## is a command for ngspice');
  });

  it('after .end: still read, or not read after .end;comment or @ (S25–S29)', () => {
    expect(line('* t\nR1 a 0 1\n.end\nR2 a 0 1\n', 4).summary).toBe('This line comes after .end (line 3). ngspice does not stop reading at .end, so it still reads this line. Put it above .end, where it belongs.');
    expect(line('* t\nR1 a 0 1\n.end;x\nR2 a 0 1\n', 4).summary).toBe('ngspice stopped reading at line 3, so it skips this line. A comment glued to .end (.end;…) makes ngspice stop reading there.');
    expect(line('* t\nR1 a 0 1\n@ x\nR2 a 0 1\n', 4).summary).toBe('Line 3 starts with @, so ngspice stopped reading there and skips this line.');
    expect(line('* t\nR1 a 0 1\n@ x\n', 3).summary).toBe('A line starting with @ ends the netlist here: ngspice silently reads nothing after it.');
    expect(notes(line('* t\n.end\n', 2))).toBe('ngspice does not stop reading at .end: it still reads the lines after it. Keep .end as the last line.');
    expect(notes(line('* t\n.end;x\n', 2))).toBe('A comment glued to .end (.end;…) makes ngspice stop reading here.');
  });

  it('lines that are no part (M5, M5b, M21)', () => {
    expect(line('* t\n1k a 0 5\n', 2).summary).toContain('This line starts with 1, so it is not a part');
    expect(line('* t\nÜ1 a 0 5\n', 2).summary).toContain('starts with Ü, which is not a letter A–Z');
    expect(line('* t\n{1 a 0 5\n', 2).summary).toContain('without its closing } it stops with a fatal error');
  });
});

describe('dot commands', () => {
  const dot = (d: string, before = 'V1 a 0 1\nI1 0 b 1\nR1 a 0 1\n'): LineExplanation => {
    const text = `* t\n${before}${d}\n.end\n`;
    return line(text, text.split('\n').indexOf(d.split('\n')[0]!) + 1);
  };

  it('.tf with a current output, a current source input, a missing node or source (A4–A6, M10, M11)', () => {
    const i = dot('.tf i(V1) I1');
    expect(i.summary).toContain('Find the transfer function i(V1)/I1 (output ÷ input) and the input resistance seen by I1.');
    expect(i.summary).toContain('The transfer function is in A/A.');
    expect(notes(i)).toContain('For a current output, ngspice reports an "output impedance" of 1e20 Ω');
    expect(dot('.tf v(a) I1').summary).toContain('The transfer function is in V/A, which is ohms.');
    expect(dot('.tf v(a,b) V1').summary).toContain('the output resistance between node a and node b');
    expect(notes(dot('.tf v(n9) V1'))).toBe('n9 is not a node of the circuit: ngspice says nothing and reports a transfer function of 0.');
    expect(notes(dot('.tf v(a) V9'))).toBe('There is no source called V9, so ngspice runs no analysis.');
    expect(notes(dot('.tf v(a) R1'))).toContain('The input of .tf must be a voltage source (V) or a current source (I)');
  });

  it('.dc: counts, empty sweeps, step 0, nested sweeps, other sources (A7–A15, M12, M13)', () => {
    expect(sp(dot('.dc V1 0 1 0.1').summary)).toContain('Sweep V1 from 0 V to 1 V in steps of 100 mV: 11 points.');
    expect(sp(dot('.dc V1 12 0 -3').summary)).toContain(`from 12 V to 0 V in steps of ${MINUS}3 V: 5 points.`);
    expect(notes(dot('.dc V1 12 0 1'))).toBe('With these numbers the sweep has no points (start is past stop for this step), so ngspice runs nothing and says nothing.');
    expect(notes(dot('.dc V1 0 12 0'))).toBe('A step of 0 (or no step at all) stops ngspice 47: "Bad syntax!".');
    expect(notes(dot('.dc V1 0 12'))).toBe('A step of 0 (or no step at all) stops ngspice 47: "Bad syntax!".');
    expect(dot('.dc V1 0 2 1 I1 0 1 1').summary).toContain('For each value of I1, V1 runs through all its values: 6 points in all.');
    expect(sp(dot('.dc I1 0 3 1').summary)).toContain('Sweep I1 from 0 A to 3 A in steps of 1 A: 4 points.');
    expect(sp(dot('.dc R1 1k 3k 1k').summary)).toContain('Sweep R1 from 1 kΩ to 3 kΩ in steps of 1 kΩ: 3 points.');
    expect(sp(dot('.dc TEMP 0 100 50').summary)).toContain('Sweep the temperature from 0 °C to 100 °C in steps of 50 °C: 3 points.');
    const missing = dot('.dc V9 0 12 1');
    expect(notes(missing)).toBe('There is no V9 in the circuit, so ngspice stops: the source to sweep "is not in the circuit".');
    expect(missing.summary).not.toContain('points');
  });

  it('.tran: the largest step, tstart, tmax, uic, and its errors (A16–A19, P23, M14–M15b)', () => {
    expect(sp(dot('.tran 1m 5m').summary)).toBe('Simulate over time from 0 to 5 ms. ngspice picks its own time points, at most 100 µs apart.');
    const full = dot('.tran 10u 5m 1m 2u uic');
    expect(sp(full.summary)).toBe('Simulate over time from 0 to 5 ms, saving the results from 1 ms on. ngspice picks its own time points, at most 2 µs apart.');
    expect(labels(full)).toEqual(['command', 'tstep', 'tstop', 'tstart', 'tmax', 'uic']);
    expect(full.notes).toEqual([]);
    expect(dot('.tran 5m').summary).toBe('Simulate over time, but this line has no stop time.');
    expect(notes(dot('.tran 5m'))).toContain('TSTOP is invalid');
    expect(notes(dot('.tran 0 5m'))).toContain('TSTEP is invalid');
    expect(notes(dot('.tran 10u 5m 6m'))).toContain('TSTART is invalid');
  });

  it('.ac: dec, oct, lin, and lin with 2 points (A20–A22b)', () => {
    expect(sp(dot('.ac dec 10 1 1k').summary)).toContain('from 1 Hz to 1 kHz, 10 points per decade: 31 points.');
    expect(sp(dot('.ac oct 2 1 8').summary)).toContain('2 points per octave: 7 points.');
    expect(sp(dot('.ac lin 5 1 2').summary)).toContain('5 points in all, evenly spaced. The');
    expect(sp(dot('.ac lin 2 1 2').summary)).toContain('2 points in all, evenly spaced: 1 point.');
    expect(notes(dot('.ac dec 10 1 1k'))).toContain('PlainSpice does not show .ac results yet');
  });

  it('.options, .param, .model, .include, .lib, .print, .plot, .save, .ic, .meas, .subckt, .ends', () => {
    const o = dot('.options savecurrents reltol=1e-4 temp=50');
    expect(rows(o).slice(1)).toEqual([
      ['setting', 'savecurrents', 'savecurrents: save the current through every part (R, C, L, F, G, I, B, diodes, transistors), not only the voltage sources'],
      ['setting', 'reltol', 'reltol: an ngspice setting'],
      ['setting value', '1e-4', 'its value, 1e-4'],
      ['setting', 'temp', 'temp: an ngspice setting'],
      ['setting value', '50', 'its value, 50'],
    ]);
    expect(dot('.option savecurrents').heading).toBe('.option: settings for ngspice');
    expect(rows(dot('.param a=1 b=2k')).slice(1)).toEqual([
      ['name', 'a', 'a: the name'],
      ['value', '1', 'its value, 1'],
      ['name', 'b', 'b: the name'],
      ['value', '2k', 'its value, 2000'],
    ]);
    expect(dot('.model dmod D(is=1e-14)').summary).toBe('Defines the model dmod for diodes: parts that name dmod use its parameters.');
    expect(dot('.model qn NPN').summary).toContain('for NPN bipolar transistors');
    expect(dot('.include models.lib').summary).toContain('ngspice stops: "Could not find include file".');
    expect(rows(dot('.lib lib.lib tt'))[2]).toEqual(['section', 'tt', 'tt: the section of the library to read']);
    expect(dot('.print dc v(a)').summary).toContain('.print line ignored since rawfile was produced');
    expect(dot('.plot dc v(a)').heading).toBe('.plot: plot in text');
    const save = dot('.save v(a) i(V1)');
    expect(save.summary).toContain('(v(a), i(V1))');
    expect(rows(save).slice(1)).toEqual([
      ['result', 'v(a)', 'v(a): a result to keep'],
      ['result', 'i(V1)', 'i(V1): a result to keep'],
    ]);
    expect(rows(dot('.ic v(a)=3'))[1]).toEqual(['node voltage', 'v(a)', 'v(a) starts at 3 V']);
    expect(dot('.meas tran x max v(a)').summary).toContain('No .measure possible in batch mode');
    expect(dot('.subckt amp in out\n.ends').summary).toBe('Starts the subcircuit amp, with the nodes in, out. The parts up to .ends belong to it; an X line uses it.');
  });

  it('other analyses, other known commands, and unknown commands (A29)', () => {
    expect(dot('.noise v(a) V1 dec 10 1 1k').summary).toBe('.noise is another ngspice analysis. PlainSpice does not explain it or its results yet.');
    expect(dot('.global vdd').summary).toBe('.global is a dot command ngspice knows. PlainSpice does not explain it yet.');
    expect(dot('.foo bar').summary).toBe('ngspice does not know the dot command .foo, so it stops: "unimplemented dot command".');
    expect(isKnownDotCommand('.TRAN')).toBe(true);
    expect(isKnownDotCommand('.param')).toBe(true);
    expect(isKnownDotCommand('.foo')).toBe(false);
  });

  it('.op mentions savecurrents only when the netlist lacks it (A2)', () => {
    expect(notes(dot('.op'))).toBe('ngspice saves the current through every part only with .options savecurrents; PlainSpice adds that line to the copy it runs.');
    expect(notes(dot('.op', '.options savecurrents\n'))).toBe('');
  });

  it('.op says PlainSpice adds .options savecurrents only where the copy it runs does: not with a + line after .end (the last pass, regress-3; A2c)', () => {
    const s28 = '* a + line after .end\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n';
    expect(notes(line(s28, 3))).toBe('ngspice saves the current through every part only with .options savecurrents. PlainSpice does not add that line to the copy it runs here, because of the + line after .end (line 6).');
    expect(notes(line(s28, 3))).not.toContain('adds that line');
    // .end moved to the bottom (the after-end check's fix): the copy adds it, and Explain says so.
    expect(notes(line('* a + line after .end\nI1 0 n1 1\n.op\nR1 n1 0 2\n+ 3\n.end\n', 3))).toBe(EXPLAIN_STRINGS.opSaveCurrents);
  });

  it('.op has no note where the student’s own .options savecurrents line, which ngspice reads after .end too, saves every current (the round-1 critic’s CR1-2; A2d)', () => {
    // Native 47 and 42 save @r1[i] and @i1[current] for both: neither "adds" nor "does not add", as with the line before .end.
    expect(notes(line('* t\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.options savecurrents\n', 3))).toBe('');
    expect(notes(line('* t\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end;x\n+ 3\n.options savecurrents\n', 3))).toBe('');
    // After a line starting with @, ngspice reads no more (S29): no current is saved, and Explain says why.
    expect(notes(line('* t\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n@ x\n.options savecurrents\n', 3))).toBe(EXPLAIN_STRINGS.opSaveCurrentsLeftOut(6));
  });
});

describe('point counts and analysis readings', () => {
  it('dcSweepPoints follows ngspice\'s loop (A7–A11, A15)', () => {
    expect(dcSweepPoints(0, 12, 1)).toBe(13);
    expect(dcSweepPoints(0, 1, 0.1)).toBe(11);
    expect(dcSweepPoints(0, 12, 5)).toBe(3);
    expect(dcSweepPoints(12, 0, -3)).toBe(5);
    expect(dcSweepPoints(12, 0, 1)).toBe(0);
    expect(dcSweepPoints(0, 12, -1)).toBe(0);
    expect(dcSweepPoints(0, 12, 20)).toBe(1);
    expect(dcSweepPoints(0, 100, 50, true)).toBe(3);
    expect(dcSweepPoints(0, 12, 0)).toBeNaN();
    // Beyond 100,000 points the count comes from the formula; it is right to within one point.
    expect(Math.abs(dcSweepPoints(0, 1, 1e-9) - 1_000_000_001)).toBeLessThanOrEqual(1);
  });

  it('acSweepPoints follows ngspice\'s loop (A20–A22b)', () => {
    expect(acSweepPoints('dec', 10, 1, 1000)).toBe(31);
    expect(acSweepPoints('oct', 2, 1, 8)).toBe(7);
    expect(acSweepPoints('lin', 5, 1, 2)).toBe(5);
    expect(acSweepPoints('lin', 2, 1, 2)).toBe(1);
    expect(acSweepPoints('dec', 3, 1, 2)).toBe(1);
    expect(acSweepPoints('dec', 10, 0, 1000)).toBeNaN();
  });

  it('readAnalysis reads every analysis line', () => {
    const n = parseNetlist('* t\nV1 a 0 1\nI1 0 a 1\nR1 a 0 1\n.op\n.dc V1 0 2 1 I1 0 1 1\n.tran 10u 5m 1m\n.tf v(a) V1\n.ac dec 10 1 1k\n.noise v(a) V1 dec 1 1 10\nR2 a 0 1\n');
    expect(readAnalysis(n, 4)).toEqual({ kind: 'op', line: 4 });
    expect(readAnalysis(n, 5)).toMatchObject({ kind: 'dc', points: 6, sweeps: [{ kind: 'voltage', unit: 'V', points: 3 }, { kind: 'current', unit: 'A', points: 2 }] });
    const tran = readAnalysis(n, 6);
    expect(tran).toMatchObject({ kind: 'tran', uic: false });
    if (tran?.kind !== 'tran') throw new Error('not .tran');
    expect(tran.tstep).toBeCloseTo(1e-5, 15);
    expect(tran.tstop).toBeCloseTo(5e-3, 15);
    expect(tran.tstart).toBeCloseTo(1e-3, 15);
    expect(tran.maxStep).toBe(tran.tstep);
    expect(readAnalysis(n, 7)).toMatchObject({ kind: 'tf', output: 'v(a)', outputKind: 'voltage', outputNames: ['a'], inputKind: 'voltage' });
    expect(readAnalysis(n, 8)).toMatchObject({ kind: 'ac', type: 'dec', perStep: 10, fstart: 1, fstop: 1000, points: 31 });
    expect(readAnalysis(n, 9)).toMatchObject({ kind: 'other', name: '.noise' });
    expect(readAnalysis(n, 10)).toBeUndefined();
  });

  it('leftOutModel knows the levels the engine leaves out, and what ngspice says for each (M8, model-not-in-engine-3, -4)', () => {
    const at = (m: string): ReturnType<typeof leftOutModel> => leftOutModel(parseNetlist(`* t\n${m}\n`), 1);
    const mos = { kind: 'a chip-design model', message: 'could not find a valid modelname', mosfet: true };
    expect(at('.model nm nmos level=8')).toEqual({ level: '8', model: 'BSIM3', ...mos });
    expect(at('.model nm pmos level=54 version=4.8')).toEqual({ level: '54', model: 'BSIM4', ...mos });
    // HICUM and JFET2 make ngspice say something else (verified in traps.md).
    expect(at('.model q npn level=8')).toEqual({ level: '8', model: 'HICUM2', kind: 'a chip-design model', message: 'Unable to find definition of given model', mosfet: false });
    expect(at('.model jm njf level=2')).toEqual({ level: '2', model: 'JFET2', kind: 'a detailed JFET model', message: 'Unknown device type for model jm', mosfet: false });
    expect(at('.model nm nmos level=1')).toBeUndefined();
    expect(at('.model nm nmos')).toBeUndefined();
  });
});

describe('the core review of 10 Nov 2026 (docs/spice-facts/review.md)', () => {
  it('says a part .dc cannot sweep is in the circuit (dc-sweep-problems-7), not that it is missing', () => {
    const e = line('* t\nV1 a 0 1\nR1 a b 1k\nC1 b 0 1u\n.dc C1 0 1 0.1\n.end\n', 5);
    expect(meaningOf(e, 'source')).toBe('C1: a capacitor, which .dc cannot sweep');
    expect(notes(e)).toContain('C1 is a capacitor, and .dc sweeps only a voltage source, a current source, a resistor or the temperature');
    expect(notes(e)).not.toContain('There is no C1');
  });

  it('says a missing gain is read as 0 by our engine (missing-value-4 to -7), not a singular matrix', () => {
    const net = '* t\nV1 c 0 3\nR1 c 0 1\nE1 a 0 c 0\nR2 a 0 1\nVx c d 0\nH1 h 0 Vx\nRh h 0 1\nE2 a 0 2\n.op\n.end\n';
    expect(notes(line(net, 4))).toBe('This line has no gain. PlainSpice\'s engine (built without XSPICE) reads it as 0 and says nothing, so the output is 0; native ngspice 47 stops: "not enough parameters in line".');
    expect(notes(line(net, 7))).toContain('This line has no value in volts per amp.');
    expect(notes(line(net, 9))).toContain('a singular matrix'); // M9: too few nodes
  });

  it('explains 4R7 as a resistor code, not as a unit (rkm-notation-1)', () => {
    expect(notes(line('* t\nI1 0 n1 1\nR1 n1 0 4R7\n.op\n.end\n', 3))).toContain("ngspice ignores the 'R7' in 4R7: on resistor codes R marks the decimal point, but SPICE stops reading at it. For 4.7 Ω, write a decimal point.");
  });

  it('says what ngspice does with a word it cannot use, by part (unknown-word-1 to -11)', () => {
    const net = '* t\nV1 a 0 5\nR1 a 0 1k load\nR2 a 0 1k i\nE1 b 0 a 0 2 fast\nD1 a 0 dmod 1 2\n.model dmod D\n.op\n.end\n';
    expect(meaningOf(line(net, 3), 'extra word')).toBe('ngspice cannot use this word here and stops: "unknown parameter"');
    expect(meaningOf(line(net, 4), 'extra word')).toBe('a value ngspice can report for this part, not one a line can set: ngspice stops ("no such parameter on this device")');
    expect(meaningOf(line(net, 5), 'extra word')).toContain('PlainSpice\'s engine cannot use this word here and stops: "unknown parameter"');
    expect(meaningOf(line(net, 6), 'extra word')).toBe('a word PlainSpice cannot place on this line');
  });

  it('calls .pss, .hb, .sens2 and .endl unknown: ngspice 47 as built stops at them (A29b, A29c, unknown-dot-command-2, -3)', () => {
    for (const d of ['.pss', '.hb', '.sens2', '.endl']) expect(isKnownDotCommand(d), d).toBe(false);
    expect(line('* t\nV1 a 0 1\nR1 a 0 1k\n.hb\n.op\n.end\n', 4).summary).toBe('ngspice does not know the dot command .hb, so it stops: "unimplemented dot command".');
  });

  it('gives the message ngspice prints for each left-out model in the note (model-not-in-engine-3, -4)', () => {
    const net = '* t\nV1 d 0 1\nJ1 d 0 0 jm\n.model jm njf level=2\n.op\n.end\n';
    expect(notes(line(net, 3))).toBe('The .model line for jm uses level=2, which selects JFET2, a detailed JFET model that PlainSpice\'s engine leaves out. ngspice stops: "Unknown device type for model jm".');
  });
});

describe('robustness', () => {
  it('never throws on random netlists, and explains every line', () => {
    let seed = 12345;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const words = ['R1', 'V1', 'I1', 'E1', 'F1', 'G1', 'H1', 'K1', 'L1', 'C1', 'D1', 'X1', 'B1', '0', 'gnd', 'a', 'b', '1k', '1M', '3A', '{x}', 'PULSE(0', '5)', 'dc', 'ac', '.op', '.tf', '.dc', '.tran', '.ac', 'v(a)', 'i(V1)', '+', '*', ';', '@', '$', '\\\\', '=', ',', '(', ')', '.end', '.control', '.endc', '.model', 'level=8', 'Ü', ' ', '\r', '', '1,5k', '1d-3', 'uic', 'TEMP', 'sin(1', 'pwl(0'];
    for (let k = 0; k < 400; k++) {
      const lines: string[] = [];
      const count = 1 + rand(12);
      for (let i = 0; i < count; i++) {
        const n = rand(7);
        const parts: string[] = [];
        for (let j = 0; j < n; j++) parts.push(words[rand(words.length)]!);
        lines.push(parts.join(rand(5) === 0 ? '' : ' '));
      }
      const n = parseNetlist(lines.join('\n'));
      const all = explainNetlist(n);
      expect(all).toHaveLength(n.lines.length);
    }
  });

  // Timed as the work it is (work-time.ts: the processor time, not the clock, which on a busy machine
  // counts the wait for a processor), the least of three tries; 1.9 s for the whole test at load 20 on 4
  // cores, so its own limit is 30 s.
  it('explains 10,000 lines in well under a second', () => {
    const body = Array.from({ length: 2500 }, (_, i) => `V${i} n${i} 0 ${i}\nR${i} n${i} n${i + 1} 1k\n* comment ${i}\n.dc V${i} 0 1 0.1`).join('\n');
    const n = parseNetlist(`* big\n${body}\n.end\n`);
    const all = explainNetlist(n);
    expect(all.length).toBe(n.lines.length);
    const [ms] = leastWorkMs([() => explainNetlist(n)], 3);
    expect(ms).toBeLessThan(1500);
  }, 30_000);

  const channel = '/home/user/solved-circuits/design';
  const channelFiles = existsSync(channel)
    ? (function walk(dir: string): string[] {
        return readdirSync(dir).flatMap((f) => {
          const p = join(dir, f);
          return statSync(p).isDirectory() ? walk(p) : p.endsWith('.cir') ? [p] : [];
        });
      })(channel)
    : [];
  it.skipIf(channelFiles.length === 0)('explains every channel netlist without gaps', () => {
    for (const f of channelFiles) {
      const n = parseNetlist(readFileSync(f, 'utf8'));
      expect(explainNetlist(n).map((e) => e.line), f).toEqual(n.lines.map((l) => l.number));
    }
  });
});

describe('the string catalog', () => {
  it('uses the true minus sign in display text and keeps one word for one idea', () => {
    expect(EXPLAIN_STRINGS.minusSide('n1')).toBe(`the ${MINUS} side is at n1`);
    expect(EXPLAIN_STRINGS.ground).toBe('ground (node 0)');
    // The channel's words for the field tables.
    expect(EXPLAIN_STRINGS.iPattern).toContain('name, from node, to node, current');
  });
});

describe('after the final reviews (12 November 2026)', () => {
  it('names an invisible character or a look-alike in a value instead of quoting it, and says what was meant (security review F2)', () => {
    const zwsp = line('* t\nV1 in 0 6\nR1 in out 1​k\nR2 out 0 1k\n.op\n.end\n', 3);
    expect(meaningOf(zwsp, 'value')).toBe("1 Ω (a zero-width space (U+200B) and the 'k' after it are ignored)");
    expect(notes(zwsp)).toContain('A zero-width space (U+200B), a character you cannot see, ends the number here, so ngspice ignores it and everything after it. Delete it: write 1k.');
    expect(notes(zwsp)).not.toContain("Don't type units");
    for (const text of [zwsp.summary, ...zwsp.notes, ...zwsp.fields.map((f) => f.meaning)]) expect(text).not.toMatch(/[​⁠﻿]/);
    const cyr = line('* t\nI1 0 n1 1\nR1 n1 0 1к\n.op\n.end\n', 3);
    expect(meaningOf(cyr, 'value')).toBe('1 Ω (the Cyrillic letter к, which looks like k, is ignored)');
    expect(notes(cyr)).toContain('The Cyrillic letter к, which looks like k, is a different character for SPICE, so ngspice ignores it and everything after it. Write 1k.');
    // Harmless after the scale letter: said, not called a trap.
    expect(notes(line('* t\nV1 in 0 6\nR1 in out 1k​\n.op\n.end\n', 3))).toContain('There is a zero-width space (U+200B) in this value, a character you cannot see. ngspice ignores it, and here it changes nothing.');
    // In a node name it is named in the sentence too.
    expect(sp(line('* t\nV1 in 0 6\nR2 ou​t 0 2k\n.op\n.end\n', 3).summary)).toBe('R2 is a 2 kΩ resistor between node out (written with a zero-width space in it) and ground (node 0).');
  });

  it('names a character that looks like a space in a value instead of quoting it, and says what a document meant by it (critic of round 1; space-character-1 to -6, nbsp-2)', () => {
    // The critic's divider: Explain said "ngspice ignores ' kΩ' after the number. Don't type units", the space inside the quotes.
    const thin = line('* t\nV1 in 0 10\nR1 in out 4.7\u2009k\u03a9\nR2 out 0 4.7k\n.op\n.end\n', 3);
    expect(sp(meaningOf(thin, 'value'))).toBe("4.7 Ω (a thin space (U+2009) and the 'kΩ' after it are ignored)");
    expect(notes(thin)).toContain('A thin space (U+2009) looks like a space but is none for SPICE, so ngspice stops reading the number at it and ignores everything after it. SPICE needs no space and no units: write 4.7k.');
    expect(notes(thin)).not.toContain("Don't type units");
    for (const text of [thin.summary, ...thin.notes, ...thin.fields.map((f) => f.meaning)]) expect(text).not.toMatch(/[\u1680\u2000-\u200a\u202f\u205f\u3000]/);
    // Groups of digits, mega after the space, a no-break space, and harmless after the scale letter.
    expect(notes(line('* t\nI1 0 n1 1\nR1 n1 0 10\u2009000\n.op\n.end\n', 3))).toContain('Write the number without it: 10000.');
    expect(notes(line('* t\nV1 in 0 10\nR1 in out 1\u2009M\u03a9\n.op\n.end\n', 3))).toContain('SPICE needs no space and no units, and a capital M is milli in SPICE: for mega, write 1meg.');
    expect(notes(line('* t\nV1 in 0 10\nR1 in out 4.7\u00a0k\u03a9\n.op\n.end\n', 3))).toContain('A no-break space (U+00A0) looks like a space but is none for SPICE');
    expect(notes(line('* t\nV1 in 0 10\nR1 in out 4.7k\u2009\u03a9\n.op\n.end\n', 3))).toContain(
      'There is a thin space (U+2009) in this value, which looks like a space but is none for SPICE. ngspice ignores it and what follows it, and here that changes nothing.',
    );
    // Between two words: one word for SPICE, named in the sentence.
    expect(sp(line('* t\nI1 0 n1 1\nR1 n1 0\u20092\n.op\n.end\n', 3).summary)).toBe('R1 is a resistor between node n1 and node 0 2 (one word for SPICE: written with a thin space, not a space).');
  });

  const examples = readdirSync(join(root, 'examples'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(join(root, 'examples', d.name)).filter((f) => f.endsWith('.cir')).map((f) => join('examples', d.name, f)));

  it('gives the drawing lines one entry, in the Netlist and Checks panels\' words, not one "Comment" per line (kept F2, words W11; drawing-1)', () => {
    const n = parseNetlist(readFileSync(join(root, 'examples/p01/p01-3-ccvs-supernode.cir'), 'utf8'));
    const all = explainNetlist(n);
    const drawing = all.filter((e) => e.heading === 'Drawing lines');
    expect(drawing).toHaveLength(1);
    expect(drawing[0]).toMatchObject({ line: 11, lastLine: 32, fields: [], notes: [] });
    expect(drawing[0]!.summary).toBe(
      'These lines say where each part, wire and node name is drawn; PlainSpice reads them to draw the circuit. ngspice skips them: a line that starts with * is a comment.',
    );
    expect(all.filter((e) => e.heading === 'Comment').map((e) => e.line)).toEqual([2]);
    expect(all.map((e) => e.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, ...n.lines.slice(32).map((l) => l.number)]);
    // Asked for any one of the lines, the answer is the same entry.
    for (let i = 10; i < 32; i++) expect(explainLine(n, i)).toEqual(drawing[0]);
  });

  it('a lone drawing line is one too, and an ordinary star comment stays a comment', () => {
    const n = parseNetlist('* t\nR1 a 0 1\n*@ R1 0 0 0\n* a note\n.op\n.end\n');
    expect(explainLine(n, 2)).toMatchObject({ line: 3, heading: 'Drawing line', summary: expect.stringContaining('ngspice skips it: a line that starts with * is a comment.') });
    expect(explainLine(n, 2)!.lastLine).toBeUndefined();
    expect(explainLine(n, 3)).toMatchObject({ line: 4, heading: 'Comment' });
  });

  it.each(examples)('%s: Explain finds the drawing lines exactly where the drawing code does (isDrawingLine)', (path) => {
    const n = parseNetlist(readFileSync(join(root, path), 'utf8'));
    for (const l of n.lines) expect(isDrawingComment(l), `line ${l.number}`).toBe(l.index > 0 && isDrawingLine(l.text));
    const covered = explainNetlist(n).flatMap((e) => Array.from({ length: (e.lastLine ?? e.line) - e.line + 1 }, (_, k) => e.line + k));
    expect(covered).toEqual(n.lines.map((l) => l.number));
  });
});

describe('after the re-check of the fixes (12 November 2026)', () => {
  const allNotes = (e: LineExplanation): string => e.notes.map(sp).join(' ');

  it('a source whose value ngspice cannot read gets no note about a missing value: ngspice stops there (C3; look-alike-letter-2)', () => {
    for (const value of ['−5', '-\u200b5', '－5', '-\u20095', 'five']) {
      for (const [letter, nodes] of [['V', 'a 0'], ['I', '0 a']] as const) {
        const e = line(`* t\n${letter}1 ${nodes} ${value}\nR1 a 0 1k\n.op\n.end\n`, 2);
        expect(allNotes(e), `${letter} ${value}`).not.toMatch(/has no DC value|says so in a note|uses 0/);
      }
    }
    // With nothing after the nodes, or an AC value alone, ngspice notes it (P16); with dc and no number it does not (P16b).
    expect(allNotes(line('* t\nV1 a 0\n.op\n.end\n', 2))).toContain('says so in a note ("has no value, DC 0 assumed")');
    expect(allNotes(line('* t\nV1 a 0 AC 1\n.op\n.end\n', 2))).toContain('says so in a note');
    expect(allNotes(line('* t\nV1 a 0 dc\n.op\n.end\n', 2))).toContain('This source has dc but no number after it, so in .op ngspice uses 0 V, without a message.');
    expect(allNotes(line('* t\nI1 0 a dc\n.op\n.end\n', 2))).toContain('so in .op ngspice uses 0 A, without a message.');
  });

  it('an E, F, G or H line: no gain at all, settings but no number, or a word ngspice cannot read are three different notes (S6)', () => {
    const net = (l: string): LineExplanation => line(`* t\nV1 a 0 1\nR0 a 0 1k\n${l}\nR1 b 0 1k\n.op\n.end\n`, 4);
    expect(allNotes(net('E1 b 0 a 0'))).toContain('native ngspice 47 stops: "not enough parameters in line"');
    for (const l of ['E1 b 0 a 0 gain', 'G1 0 b a 0 m=2', 'F1 0 b V1 m=2', 'H1 b 0 V1 gain']) {
      expect(allNotes(net(l)), l).toContain('has settings but no');
      expect(allNotes(net(l)), l).toContain('so ngspice uses 0 and says nothing: the output is 0.');
      expect(allNotes(net(l)), l).not.toContain('not enough parameters');
    }
    for (const l of ['E1 b 0 a 0 Av', 'E1 b 0 a 0 \u200b2', 'G1 0 b a 0 −1m', 'F1 0 b V1 beta', 'H1 b 0 V1 rm']) {
      const e = net(l);
      expect(allNotes(e), l).not.toMatch(/has no (gain|value)|not enough parameters|settings but no/);
      // The word where the gain goes: ngspice stops there, native 47 too (unknown-word-18 to -21), never "a polynomial".
      const word = e.fields[e.fields.length - 1]!;
      expect(sp(word.meaning), l).toBe('ngspice cannot use this word here and stops: "unknown parameter"');
    }
  });

  it('a .dc number ngspice cannot read is said to stop ngspice 47, never read as a sweep that runs (S5; dc-sweep-problems-9)', () => {
    for (const [dc, label] of [['.dc V1 \u22125 5 1', 'start'], ['.dc V1 0 \u200b5 1', 'stop'], ['.dc V1 O 5 1', 'start'], ['.dc V1 0 V1 1', 'stop']] as const) {
      const e = line(`* t\nV1 in 0 1\nR1 in 0 1k\n${dc}\n.end\n`, 4);
      expect(meaningOf(e, label), dc).toBe('not a number for SPICE (see Checks)');
      expect(allNotes(e), dc).toContain('A word that is no number where a number goes stops ngspice 47: "Bad syntax!".');
      expect(allNotes(e), dc).not.toContain('A step of 0');
      expect(e.summary.includes('\u200b'), dc).toBe(false);
    }
    // A plain sweep keeps its words.
    expect(meaningOf(line('* t\nV1 in 0 1\nR1 in 0 1k\n.dc V1 -5 5 1\n.end\n', 4), 'start')).toBe('start: \u22125 V');
  });

  it('a .param name where a value goes is that value: Explain says so and uses it (unknown-word-22)', () => {
    const e = line('* t\n.param Av=10\nV1 a 0 1\nR0 a 0 1k\nE1 b 0 a 0 Av\nR1 b 0 1k\n.op\n.end\n', 5);
    expect(sp(e.summary)).toContain('is 10 × the voltage at node a');
    expect(rows(e).find((r) => r[1] === 'Av')).toEqual(['gain', 'Av', '10 (Av, from .param on line 2)']);
    // A .param whose value is an expression: still a name ngspice uses, never "ngspice stops" (no trap either).
    const expr = line('* t\n.param Av={2*5}\nV1 a 0 1\nR0 a 0 1k\nE1 b 0 a 0 Av\nR1 b 0 1k\n.op\n.end\n', 5);
    expect(rows(expr).find((r) => r[1] === 'Av')).toEqual(['gain', 'Av', 'Av: a name from a .param line, whose value ngspice uses here']);
    expect(allNotes(expr)).not.toMatch(/no gain|not enough parameters|settings but no/);
    const v = line('* t\n.param Vs=5\nV1 a 0 Vs\nR1 a 0 1k\n.op\n.end\n', 3);
    expect(sp(v.summary)).toContain('SPICE reads that as V(a) − V(0) = 5 V.');
    expect(allNotes(v)).not.toContain('no DC value');
  });

  it('a character outside ASCII inside a number is named, never "Don\'t type units" (C5; look-alike-letter-9, -12)', () => {
    for (const ch of ['。', '•', '·']) {
      const e = line(`* t\nI1 0 n1 1\nR1 n1 0 4${ch}7k\n.op\n.end\n`, 3);
      expect(allNotes(e), ch).not.toContain("Don't type units");
      expect(allNotes(e), ch).toContain('is no part of a number for SPICE, so ngspice stops reading the number at it and ignores the 7k after it, without a message.');
    }
    const dot = line('* t\nI1 0 n1 1\nR1 n1 0 4·7k\n.op\n.end\n', 3);
    expect(allNotes(dot)).toContain('A middle dot (U+00B7), which some documents use as a decimal point, is a different character for SPICE, so ngspice ignores it and everything after it. Write 4.7k.');
    for (const ch of ['\u2028', '\u3164', '\u180e']) {
      const e = line(`* t\nI1 0 n1 1\nR1 n1 0 4.7${ch}k\n.op\n.end\n`, 3);
      expect(allNotes(e), ch).not.toContain("Don't type units");
      for (const f of e.fields) expect(f.meaning.includes(ch), ch).toBe(false);
    }
  });
});

describe('after the critic of the re-check fixes (12 November 2026)', () => {
  const allNotes = (e: LineExplanation): string => e.notes.map(sp).join(' ');

  it('a .dc number in braces or quotes is a number ngspice works out, never "not a number" (CR1-4; dc-sweep-problems-17)', () => {
    for (const [text, k, label, meaning] of [
      ['* t\n.param st=1\nV1 in 0 1\nR1 in 0 1k\n.dc V1 0 5 {st}\n.end\n', 5, 'step', 'step: 1 V (st, from .param on line 2)'],
      ['* t\n.param lo=-5\nV1 in 0 1\nR1 in 0 1k\n.dc V1 {lo} 5 1\n.end\n', 5, 'start', `start: ${MINUS}5 V (lo, from .param on line 2)`],
      ["* t\n.param st=1\nV1 in 0 1\nR1 in 0 1k\n.dc V1 0 5 'st'\n.end\n", 5, 'step', 'step: an expression: ngspice works out its value before running'],
    ] as const) {
      const e = line(text, k);
      expect(meaningOf(e, label), text).toBe(meaning);
      expect(allNotes(e), text).not.toMatch(/Bad syntax|stops/);
      expect(sp(e.summary), text).toMatch(/^Sweep V1 from /);
    }
  });

  it('a .dc line ngspice 47 stops at is said so, never as a sweep that runs (CR1-11)', () => {
    for (const dc of ['.dc V1 −5 5 1', '.dc V1 0 5 0​.5', '.dc V1 0 5 0', '.dc V1 0 5', '.dc V1 0', '.dc V1 0 5 st', '.dc V1 0 5 1 2']) {
      const e = line(`* t\nV1 in 0 1\nR1 in 0 1k\n${dc}\n.end\n`, 4);
      expect(sp(e.summary), dc).toBe('ngspice 47 stops at this line ("Bad syntax!") and sweeps nothing: see Checks.');
      expect(sp(e.summary), dc).not.toContain('At each point');
    }
    // A sweep that runs keeps its words, and words after the second sweep are not a third (dc-sweep-problems-19).
    expect(sp(line('* t\nV1 in 0 1\nR1 in 0 1k\n.dc V1 0 5 1\n.end\n', 4).summary)).toMatch(/^Sweep V1 from 0 V to 5 V in steps of 1 V: 6 points\./);
    const two = line('* t\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 0 5 1 V2 0 1 0.5 7\n.end\n', 5);
    expect(labels(two).filter((l) => /source/.test(l))).toEqual(['source', 'second source']);
  });

  it('the letter O for a zero is named as Checks names it, never "Don\'t type units" (CR1-9; look-alike-letter-10, -15)', () => {
    for (const [value, read, written] of [['1Ok', '1 Ω', '10k'], ['1OOk', '1 Ω', '100k'], ['1OkΩ', '1 Ω', '10kΩ'], ['1оk', '1 Ω', '10k']] as const) {
      const e = line(`* t\nV1 in 0 5\nR1 in a ${value}\nR2 a 0 1k\n.op\n.end\n`, 3);
      expect(allNotes(e), value).toContain(`after the 1 is not the digit 0: SPICE stops reading the number at a letter, so it reads ${read}. Write ${written}.`);
      expect(allNotes(e), value).not.toContain("Don't type units");
    }
    // A unit stays a unit.
    expect(allNotes(line('* t\nV1 in 0 5\nR1 in a 1Ohm\nR2 a 0 1k\n.op\n.end\n', 3))).toContain("ngspice ignores 'Ohm' after the number. Don't type units after numbers.");
  });

  it('the note for a stray character ends as Checks does: a model warning on C and L, nothing more on a resistor read as 0 (CR1-10; look-alike-letter-7, -12)', () => {
    const c = line('* t\nV1 in 0 5\nR1 in a 1k\nC1 a 0 4。7u\n.op\n.end\n', 4);
    expect(allNotes(c)).toContain("ignores the 7u after it, and only warns that it can't find a model with the word's name.");
    expect(allNotes(c)).not.toContain('without a message');
    const l = line('* t\nV1 in 0 5\nR1 in a 1k\nL1 a 0 4。7u\n.op\n.end\n', 4);
    expect(allNotes(l)).toContain("and only warns that it can't find a model");
    const zero = line('* t\nV1 in 0 5\nR1 in a 0。47\nR2 a 0 1k\n.op\n.end\n', 3);
    expect(allNotes(zero)).not.toContain('without a message');
    expect(allNotes(zero)).toContain('ngspice 47 cannot use 0 Ω');
    expect(allNotes(line('* t\nV1 in 0 5\nR1 in a 4。7k\nR2 a 0 1k\n.op\n.end\n', 3))).toContain('ignores the 7k after it, without a message.');
  });

  it('only a top-level .param line\'s names are values, after .end too; a sign with a space on an E line is read as a polynomial natively (CR1-7, CR1-3)', () => {
    const sub = line('* t\n.subckt foo x y Vs=5\nR1 x y 1k\n.ends\nV1 a 0 Vs\nR1 a 0 1k\n.op\n.end\n', 5);
    expect(meaningOf(sub, 'value')).toBe('ngspice cannot use this word here and stops: "unknown parameter"');
    const inner = line('* t\n.subckt foo x y\n.param Vs=5\nR1 x y 1k\n.ends\nV1 a 0 Vs\nR1 a 0 1k\n.op\n.end\n', 6);
    expect(meaningOf(inner, 'value')).toBe('ngspice cannot use this word here and stops: "unknown parameter"');
    const after = line('* t\nV1 a 0 Vs\nR1 a 0 1k\n.op\n.end\n.param Vs=5\n', 2);
    expect(meaningOf(after, 'value')).toBe('5 V (Vs, from .param on line 6)');
    const e = line('* t\nV1 a 0 1\nR0 a 0 1k\nE1 b 0 a 0 - 2\nR1 b 0 1k\n.op\n.end\n', 4);
    expect(rows(e).find((r) => r[1] === '-')![2]).toContain('native ngspice 47, with XSPICE, reads extra words on E, F, G and H lines as a polynomial');
    // A word alone where E's gain goes is ngspice's "unknown parameter" (unknown-word-18).
    expect(rows(line('* t\nV1 a 0 1\nR0 a 0 1k\nE1 b 0 a 0 Av\nR1 b 0 1k\n.op\n.end\n', 4)).find((r) => r[1] === 'Av')![2]).toBe('ngspice cannot use this word here and stops: "unknown parameter"');
  });
});
