/**
 * src/schematic/circuit.ts: the circuit a drawing shows, read from parseNetlist(): parts, nodes,
 * controls, the lines the drawing cannot show (never lost), and the dot lines.
 */
import { describe, expect, it } from 'vitest';
import { isAmmeter } from '../../src/notebook/index.ts';
import { circuitFromNetlist, controlText, valueLabel, valueLines } from '../../src/schematic/index.ts';
import { parseNetlist } from '../../src/spice/parse.ts';

const circuit = (text: string) => circuitFromNetlist(parseNetlist(text));
const sp = (s: string): string => s.replace(/ /g, ' ');

describe('parts', () => {
  it('reads letter, name as written, nodes, value as written and the number ngspice reads', () => {
    const c = circuit('* t\nV1 IN 0 DC 6\nr1 in Out 1.5k\nC1 out 0 1u\nL1 out x 1m\nI1 0 x 3m\n.op\n.end\n');
    expect(c.parts.map((p) => [p.key, p.name, p.letter, p.nodes, p.nodeText, p.valueText, p.value])).toEqual([
      ['v1', 'V1', 'V', ['in', '0'], ['IN', '0'], '6', 6],
      ['r1', 'r1', 'R', ['in', 'out'], ['in', 'Out'], '1.5k', 1500],
      ['c1', 'C1', 'C', ['out', '0'], ['out', '0'], '1u', 1e-6],
      ['l1', 'L1', 'L', ['out', 'x'], ['out', 'x'], '1m', 0.001],
      ['i1', 'I1', 'I', ['0', 'x'], ['0', 'x'], '3m', 0.003],
    ]);
    // Nodes in order of first appearance, written as first written.
    expect([...c.nodes.values()].map((n) => [n.name, n.text, n.pins.length])).toEqual([
      ['in', 'IN', 2],
      ['0', '0', 3],
      ['out', 'Out', 3],
      ['x', 'x', 2],
    ]);
    expect(c.hasGround).toBe(true);
  });

  it('a .param name where a source\'s value goes is shown as written, and that source is no 0 V meter (re-check S6; unknown-word-22)', () => {
    const c = circuit('* t\n.param Vs=5 Av=10\nV1 a 0 Vs\nR1 a 0 1k\nE1 b 0 a 0 Av\nR2 b 0 1k\nV2 c 0\nR3 c 0 1k\nV3 d 0 \u22125\nR4 d 0 1k\n.op\n.end\n');
    const by = (k: string) => c.parts.find((p) => p.key === k)!;
    expect([by('v1').valueText, by('v1').value]).toEqual(['Vs', undefined]);
    expect(isAmmeter(by('v1'))).toBe(false);
    expect(sp(valueLabel(by('e1')))).toBe('Av × V(a)');
    // A source with no value word is one, and a word with other characters stays unshown: the checks name it.
    expect(isAmmeter(by('v2'))).toBe(true);
    expect(by('v3').valueText).toBe('');
  });

  it('reads what controls E, F, G and H (the control is a label, not a wire)', () => {
    const c = circuit('* deps\nVc c 0 3\nE1 out1 0 c 0 2\nG1 0 out2 c d 0.5\nVs c cs 0\nF1 0 out3 Vs 3\nH1 out4 0 Vs 4\nRd d 0 1\n.op\n.end\n');
    const by = (k: string) => c.parts.find((p) => p.key === k)!;
    expect(by('e1').control).toEqual({ kind: 'voltage', plus: 'c', minus: '0', plusText: 'c', minusText: '0' });
    expect(by('g1').control).toEqual({ kind: 'voltage', plus: 'c', minus: 'd', plusText: 'c', minusText: 'd' });
    expect(by('f1').control).toEqual({ kind: 'current', source: 'vs', sourceText: 'Vs' });
    expect(by('e1').nodes).toEqual(['out1', '0']);
    expect(sp(valueLabel(by('e1')))).toBe('2 × V(c)');
    expect(sp(valueLabel(by('g1')))).toBe('0.5 A/V × V(c, d)');
    expect(sp(valueLabel(by('f1')))).toBe('3 × I(Vs)');
    expect(sp(valueLabel(by('h1')))).toBe('4 V/A × I(Vs)');
    expect(controlText(by('h1'))).toBe('I(Vs)');
    // Control nodes are not pins: node c has the pins of Vc and Vs only.
    expect(c.nodes.get('c')!.pins).toEqual([
      { part: 'vc', pin: 0 },
      { part: 'vs', pin: 0 },
    ]);
    expect(c.nodes.has('d')).toBe(true);
  });

  it('keeps a half-written dependent source, with "?" where the control is missing', () => {
    const c = circuit('* t\nRref a 0 1\nE1 a 0 5\nF1 a 0\n.op\n.end\n');
    expect(c.parts.map((p) => p.key)).toEqual(['rref', 'e1', 'f1']);
    expect(sp(valueLabel(c.parts[1]!))).toBe('? × V(5, ?)');
    expect(sp(valueLabel(c.parts[2]!))).toBe('? × I(?)');
  });

  it('writes values in plain units, a source\'s DC value, AC value and function in a few words, "?" for none', () => {
    const c = circuit('* t\nV1 in 0 PULSE(0 5 0 1u 1u 1 2)\nR1 in out 1M\nR2 out 0\nV2 a 0 AC 1\nR3 a 0 {rval}\nV3 b 0 DC 2 SIN(0 1 1k)\nI1 0 b DC 1m AC 1 90\nV4 c 0 PWL(0 0 1m 5 2m 0)\nV5 d 0 SFFM(0 1.5 10k 5 1k)\nR4 c d {2*rload+rsource+rx}\n.op\n.end\n');
    expect(c.parts[0]!.sourceFunction).toBe('PULSE(0 5 0 1u 1u 1 2)');
    expect(c.parts[0]!.fn).toEqual({ name: 'pulse', args: ['0', '5', '0', '1u', '1u', '1', '2'] });
    // P18: the start value and the pulse value; never cut inside the parentheses.
    expect(valueLines(c.parts[0]!).map(sp)).toEqual(['PULSE 0 V → 5 V']);
    expect(sp(valueLabel(c.parts[1]!))).toBe('1 mΩ'); // 1M is a milliohm
    expect(valueLabel(c.parts[2]!)).toBe('?');
    expect(c.parts[2]!.built).toBe(false); // ngspice leaves an R with nothing after its nodes out (P15)
    // An AC value alone is not a DC value (P16): written as it is.
    expect(valueLines(c.parts[3]!)).toEqual(['AC 1']);
    expect(valueLabel(c.parts[4]!)).toBe('{rval}');
    // The DC value first, then the function (P19: offset, amplitude, frequency).
    expect(valueLines(c.parts[5]!).map(sp)).toEqual(['2 V', 'SIN ± 1 V, 1 kHz']);
    expect(valueLines(c.parts[6]!).map(sp)).toEqual(['1 mA', 'AC 1 90']);
    expect(valueLines(c.parts[7]!)).toEqual(['PWL, 3 points']);
    expect(valueLines(c.parts[8]!)).toEqual(['SFFM(…)']);
    expect(valueLabel(c.parts[9]!)).toBe('{2*rload+rsource+…}');
  });

  it('treats gnd as ground except as the last word of its line (W8–W12)', () => {
    const c = circuit('* t\nV1 n1 gnd 6\nR1 n1 GND 2\nR2 n1 gnd\n.op\n.end\n');
    expect(c.parts.map((p) => p.nodes)).toEqual([
      ['n1', '0'],
      ['n1', '0'],
      ['n1', 'gnd'],
    ]);
  });
});

describe('lines the drawing does not show', () => {
  it('lists every other part line with its line and reason, never losing one', () => {
    const c = circuit(
      [
        '* everything',
        'V1 a 0 5',
        'R1 a b 1k',
        'D1 b 0 dmod',
        '.model dmod D',
        'X1 a c div',
        'B1 c 0 V=2*v(a)',
        'K1 L1 L2 0.9',
        'L1 a 0 1m',
        'L2 c 0 1m',
        'R1 a 0 2k',
        'R9 a',
        '.subckt div in out',
        'R1 in out 1k',
        '.ends',
        '.op',
        '.end',
        'R5 a 0 3',
        '',
      ].join('\n'),
    );
    expect(c.parts.map((p) => p.name)).toEqual(['V1', 'R1', 'L1', 'L2']);
    expect(c.notDrawn.map((n) => [n.name, n.lineNumber, n.reason])).toEqual([
      ['D1', 4, 'part-kind'],
      ['X1', 6, 'part-kind'],
      ['B1', 7, 'part-kind'],
      ['K1', 8, 'part-kind'],
      ['R1', 11, 'duplicate-name'],
      ['R9', 12, 'missing-nodes'],
      ['R1', 14, 'in-subcircuit'],
      ['R5', 18, 'after-end'],
    ]);
    expect(c.notDrawn[0]!.text).toBe('D1 b 0 dmod');
    expect(c.notDrawn[0]!.nodes).toEqual(['b', '0']);
    expect(c.notDrawn[0]!.letter).toBe('D');
  });

  it('lists the dot lines separately, analyses flagged', () => {
    const c = circuit('* t\nV1 a 0 1\nR1 a 0 1\n.options savecurrents\n.op\n.tf v(a) V1\n.end\n');
    expect(c.dotLines.map((d) => [d.name, d.lineNumber, d.analysis, d.text])).toEqual([
      ['.options', 4, false, '.options savecurrents'],
      ['.op', 5, true, '.op'],
      ['.tf', 6, true, '.tf v(a) V1'],
      ['.end', 7, false, '.end'],
    ]);
  });

  it('never throws, whatever the text', () => {
    for (const text of ['', '\n\n', 'only a title', '* t\n+ continuation\n', '* t\nR', '* t\nE1\n', '* t\n.subckt x a\nR1 a 0 1\n']) {
      expect(() => circuit(text)).not.toThrow();
    }
  });
});

describe('connections the drawing does not show', () => {
  it('lists, for each drawn node, the lines not drawn that name it (a subcircuit\'s own lines excepted)', () => {
    const c = circuit('* t\nV1 a 0 5\nR1 a b 1k\nD1 b 0 dmod\nX1 a b sub\n.model dmod D\n.subckt sub b q\nR9 b q 1k\n.ends\n.op\n.end\nR5 b 0 3\n');
    const hidden = (n: string): string[] => c.nodes.get(n)!.hidden.map((h) => `${h.name}@${h.lineNumber}`);
    expect(hidden('b')).toEqual(['D1@4', 'X1@5', 'R5@12']);
    expect(hidden('a')).toEqual(['X1@5']);
    expect(hidden('0')).toEqual(['D1@4', 'R5@12']);
  });

  it('knows which K lines couple an inductor (P21) and which F or H reads a source', () => {
    const c = circuit('* t\nV1 a 0 AC 1\nL1 a 0 1m\nL2 b 0 1m\nR1 b 0 50\nK1 L1 L2 0.9\nVs a s 0\nF1 0 s Vs 2\nH1 s 0 Vs 3\n.ac dec 10 1k 1meg\n.end\n');
    const by = (k: string) => c.parts.find((p) => p.key === k)!;
    expect(by('l1').coupled).toEqual([{ by: 'K1', with: 'L2', line: 6 }]);
    expect(by('l2').coupled).toEqual([{ by: 'K1', with: 'L1', line: 6 }]);
    expect(by('vs').sensedBy).toEqual(['f1', 'h1']);
    expect(by('v1').sensedBy).toEqual([]);
  });
});
