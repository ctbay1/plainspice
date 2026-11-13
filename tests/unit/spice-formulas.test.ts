/**
 * Node names inside formulas, on .pz lines and after .end, and E, F, G and H lines written as a formula, a
 * table or a polynomial (the last pass, 13 November 2026: code review C3-1 and C3-5).
 *
 * - The parser reads these lines as ngspice does (docs/spice-facts/traps.md, missing-value-15 to -17,
 *   model-not-in-engine-7 to -14): a formula's nodes are named there (NodeInfo.refs) but connect nothing;
 *   POLY(n)'s control nodes are nodes; .pz names its four nodes bare.
 * - The checks say nothing false about them, and say PlainSpice's engine can't run POLY or TABLE.
 * - Every rename, the checks' fixes and the drawing editor's, leaves the old name nowhere ngspice reads it
 *   (non-ascii-node-15 to -19, invisible-character-67, look-alike-letter-18, space-character-24).
 * - A character that looks like a space in a formula stops ngspice: its fix takes it out (space-character-22, -23, nbsp-4).
 */
import { describe, expect, it } from 'vitest';
import { buildSchematic } from '../../src/schematic/index.ts';
import { describeCircuit } from '../../src/spice/describe.ts';
import { explainLine } from '../../src/spice/explain.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { checkTraps } from '../../src/spice/traps.ts';

const DIVIDER = 'V1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n';

const refsOf = (text: string, key: string): string[] => (parseNetlist(text).nodes.get(key)?.refs ?? []).map((t) => `${t.text}@${t.from}`);
const ids = (text: string): string[] => checkTraps(parseNetlist(text)).map((t) => t.id);

describe('the parser reads a formula\'s nodes as named there, not connected (C3-1)', () => {
  it('B lines: V= and I=, braces or not, v(a,b), V( a ), and gnd or 0 as ground', () => {
    const text = `* t\n${DIVIDER}B1 b 0 V={v(out)*2}\nB2 0 c I=V( out )/1k + v(in , out)\nB3 d 0 V=v(gnd)+v(0)\nRb b 0 1k\n.op\n.end\n`;
    const n = parseNetlist(text);
    const out = n.nodes.get('out')!;
    expect(out.refs.map((t) => t.text)).toEqual(['out', 'out', 'out', 'out', 'out']);
    // R1 and R2 connect to out; B1 and B2 only read it.
    expect(out.connections.map((c) => c.element)).toEqual(['r1', 'r2']);
    expect(n.lines[4]!.element!.reads!.map((r) => r.name)).toEqual(['out']);
    expect(n.lines[5]!.element!.reads!.map((r) => r.name)).toEqual(['out', 'in', 'out']);
    expect(n.lines[6]!.element!.reads!.map((r) => [r.name, r.ground])).toEqual([['0', true], ['0', true]]);
  });

  it('a v that ends another word, or a v with no bracket after it, reads no node', () => {
    const n = parseNetlist(`* t\n${DIVIDER}B1 b 0 V=xv(out)+v*2+abs(v(in))\nRb b 0 1k\n.op\n.end\n`);
    expect(n.lines[4]!.element!.reads!.map((r) => r.name)).toEqual(['in']);
  });

  it('E and G given by a formula: two nodes, no gain, and the nodes the formula reads (missing-value-15 to -17)', () => {
    for (const [line, kind, keyword] of [
      ['E1 e 0 VALUE={v(out)*2}', 'formula', 'VALUE'],
      ['E1 e 0 value = {v(out)*2}', 'formula', 'value'],
      ['E1 e 0 VALUE {v(out)*2}', 'formula', 'VALUE'],
      ['E1 e 0 VALUE=v(out)*2', 'formula', 'VALUE'],
      ['E1 e 0 vol={v(out)*2}', 'formula', 'vol'],
      ["E1 e 0 vol='v(out)*2'", 'formula', 'vol'],
      ['G1 0 e VALUE={v(out)*2m}', 'formula', 'VALUE'],
      ['G1 0 e cur={v(out)*2m}', 'formula', 'cur'],
      ['E1 e 0 TABLE {v(out)} = (0,0) (5,10)', 'table', 'TABLE'],
    ] as const) {
      const e = parseNetlist(`* t\n${DIVIDER}${line}\nRe e 0 1k\n.op\n.end\n`).lines[4]!.element!;
      expect(e.nodes.map((r) => r.name), line).toEqual(line.startsWith('E') ? ['e', '0'] : ['0', 'e']);
      expect(e.form?.kind, line).toBe(kind);
      expect(e.form?.keyword.text, line).toBe(keyword);
      expect(e.value, line).toBeUndefined();
      expect(e.reads!.map((r) => r.name), line).toEqual(['out']);
    }
    // The formula on a continuation line is the same formula.
    const n = parseNetlist(`* t\n${DIVIDER}E1 e 0 VALUE=\n+ {v(out)*2}\nRe e 0 1k\n.op\n.end\n`);
    expect(n.lines[4]!.element!.form!.formula!.text).toBe('{v(out)*2}');
    expect(refsOf(n.text, 'out').length).toBe(3);
  });

  it('POLY(n): E and G read n pairs of control nodes, F and H n voltage sources; then the coefficients', () => {
    const e = parseNetlist(`* t\n${DIVIDER}E1 e 0 POLY(2) out 0 in 0 0 1 1\nRe e 0 1k\n.op\n.end\n`).lines[4]!.element!;
    expect(e.form).toMatchObject({ kind: 'poly', dimension: 2 });
    expect(e.nodes.map((r) => r.name)).toEqual(['e', '0', 'out', '0', 'in', '0']);
    expect(e.fields.filter((f) => f.role === 'control-plus').map((f) => f.token.text)).toEqual(['out', 'in']);
    const f = parseNetlist('* t\nV1 in 0 5\nVx in out 0\nR2 out 0 1k\nF1 0 e POLY(1) Vx 0 2\nRe e 0 1k\n.op\n.end\n').lines[4]!.element!;
    expect(f.form).toMatchObject({ kind: 'poly', dimension: 1 });
    expect(f.nodes.map((r) => r.name)).toEqual(['0', 'e']);
    expect(f.fields.filter((x) => x.role === 'control-source').map((x) => x.token.text)).toEqual(['Vx']);
    // XSPICE's words end at ( and ) as at a blank: POLY (1) and poly( 1 ) are the same.
    expect(parseNetlist(`* t\n${DIVIDER}E1 e 0 poly ( 1 ) out 0 0 2\n.op\n.end\n`).lines[4]!.element!.form).toMatchObject({ kind: 'poly', dimension: 1 });
  });

  it('E with control nodes and then TABLE= is a table too (LTspice\'s way, model-not-in-engine-14)', () => {
    const e = parseNetlist(`* t\n${DIVIDER}E1 e 0 out 0 table=(0,0,5,10)\n.op\n.end\n`).lines[4]!.element!;
    expect(e.form?.kind).toBe('table');
    expect(e.nodes.map((r) => r.name)).toEqual(['e', '0', 'out', '0']);
  });

  it('R, C and L values written as formulas read their nodes; a plain value reads none', () => {
    const n = parseNetlist(`* t\n${DIVIDER}R4 x 0 R={1k+v(out)}\nC4 y 0 {1u*(1+v(in))}\nR5 x y 1k\n.op\n.end\n`);
    expect(n.lines[4]!.element!.reads!.map((r) => r.name)).toEqual(['out']);
    expect(n.lines[5]!.element!.reads!.map((r) => r.name)).toEqual(['in']);
    expect(n.lines[6]!.element!.reads).toBeUndefined();
  });

  it('.pz names its four nodes bare', () => {
    const n = parseNetlist(`* t\n${DIVIDER}C1 out 0 1u\n.pz in 0 out 0 vol pz\n.end\n`);
    expect(refsOf(n.text, 'out')).toContain(`out@${n.text.indexOf('.pz in 0 out') + 9}`);
    expect(n.nodes.get('in')!.refs.length).toBe(3);
  });

  it('a formula inside a subcircuit reads the subcircuit\'s own nodes: not listed', () => {
    const n = parseNetlist(`* t\n${DIVIDER}X1 out q sub\n.subckt sub a b\nB1 b 0 V=v(a)*2\n.ends\n.op\n.end\n`);
    expect(n.nodes.has('a')).toBe(false);
  });

  it('reads a formula of thousands of v( in one pass, with their ) or without', () => {
    const closed = parseNetlist(`* t\n${DIVIDER}B1 b 0 V=${'v(out)+'.repeat(20000)}0\nRb b 0 1k\n.op\n.end\n`);
    expect(closed.lines[4]!.element!.reads!.length).toBe(20000);
    // Without ), a name ends at the next (: "out+v", then the next v( starts after it.
    const open = `* t\n${DIVIDER}B1 b 0 V=${'v(out+'.repeat(40000)}\nRb b 0 1k\n.op\n.end\n`;
    const t0 = performance.now();
    const n = parseNetlist(open);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(n.lines[4]!.element!.reads!.length).toBe(20000);
  });
});

describe('the checks read E, F, G and H lines written as a formula, a table or a polynomial (C3-5)', () => {
  const formulas = [
    'E1 e 0 VALUE={v(out)*2}', 'E1 e 0 value = {v(out)*2}', 'E1 e 0 VALUE {v(out)*2}', 'E1 e 0 VALUE=v(out)*2', 'E1 e 0 vol={v(out)*2}',
    "E1 e 0 vol='v(out)*2'", 'G1 0 e value={v(out)*2m}', 'G1 0 e cur={v(out)*2m}', 'E1 e 0 VALUE=\n+ {v(out)*2}',
  ];
  it('a formula: no trap, where the checks said "E1 has no gain" and "value has no DC path to ground" (missing-value-15 to -17)', () => {
    for (const line of formulas) expect(ids(`* t\n${DIVIDER}${line}\nRe e 0 1k\n.op\n.end\n`), line).toEqual([]);
  });

  it('POLY and TABLE: one error, that PlainSpice\'s engine can\'t run them, and nothing else (model-not-in-engine-7 to -14)', () => {
    for (const line of ['E1 e 0 POLY(1) out 0 0 2', 'G1 0 e POLY(1) out 0 0 2m', 'E1 e 0 POLY(2) out 0 in 0 0 1 1', 'E1 e 0 TABLE {v(out)} = (0,0) (5,10)', 'G1 0 e TABLE {v(out)} = (0,0) (5,10m)', 'E1 e 0 out 0 table=(0,0,5,10)']) {
      const traps = checkTraps(parseNetlist(`* t\n${DIVIDER}${line}\nRe e 0 1k\n.op\n.end\n`));
      expect(traps.map((t) => `${t.id} ${t.severity}`), line).toEqual(['model-not-in-engine error']);
      expect(traps[0]!.title, line).toMatch(/^PlainSpice's engine can't run [EG]1's (POLY|TABLE)$/);
    }
    const f = checkTraps(parseNetlist('* t\nV1 in 0 5\nVx in out 0\nR2 out 0 1k\nF1 0 e POLY(1) Vx 0 2\nRe e 0 1k\n.op\n.end\n'));
    expect(f.map((t) => t.id)).toEqual(['model-not-in-engine']);
  });

  it('POLY(1) with the coefficients 0 and k: the fix writes the plain gain k; any other polynomial gets none', () => {
    const fixOf = (line: string): string | undefined => checkTraps(parseNetlist(`* t\n${DIVIDER}Vx out x 0\n${line}\nRe e 0 1k\n.op\n.end\n`))[0]?.fixes[0]?.label;
    expect(fixOf('E1 e 0 POLY(1) out 0 0 2')).toBe('Write it without POLY: E1 e 0 out 0 2');
    expect(fixOf('G1 0 e poly(1) out 0 0 2m')).toBe('Write it without POLY: G1 0 e out 0 2m');
    expect(fixOf('H1 e 0 POLY(1) Vx 0 1k')).toBe('Write it without POLY: H1 e 0 Vx 1k');
    expect(fixOf('E1 e 0 POLY(1) out 0 1 2')).toBeUndefined();
    expect(fixOf('E1 e 0 POLY(1) out 0 0 2 3')).toBeUndefined();
    expect(fixOf('E1 e 0 POLY(2) out 0 in 0 0 1 1')).toBeUndefined();
  });

  it('a singular matrix at a node a formula source drives does not say the source has too few nodes', async () => {
    const { explainDiagnostic } = await import('../../src/spice/describe.ts');
    const n = parseNetlist(`* t\n${DIVIDER}G1 0 c cur={v(out)*2m}\nC1 c 0 1u\n.op\n.end\n`);
    const words = explainDiagnostic({ code: 'singular-matrix', subject: 'c', message: '' } as never, n);
    expect(words.title).not.toMatch(/G1/);
  });
});

describe('Explain, the overview and the drawing for E, F, G and H written as a formula, a table or a polynomial', () => {
  it('Explain says what the output is and which nodes the formula reads', () => {
    const n = parseNetlist(`* t\n${DIVIDER}E1 e 0 VALUE={v(out)*2}\nG1 0 g cur={v(in,out)*2m}\nRe e 0 1k\nRg g 0 1k\n.op\n.end\n`);
    const e = explainLine(n, 4)!;
    expect(e.summary).toBe('The voltage at node e, measured from ground, is given by the formula {v(out)*2}. ngspice works the formula out at every point of the analysis, from the voltages it names: node out.');
    expect(e.fields.map((f) => `${f.label}: ${f.text}`)).toEqual(['name: E1', '+ node: e', '− node: 0', 'formula: VALUE', 'formula: {v(out)*2}']);
    expect(e.notes.join(' ')).toContain('ngspice turns the line into a B source');
    expect(e.notes.join(' ')).not.toMatch(/no gain\. PlainSpice's engine|four nodes/);
    const g = explainLine(n, 5)!;
    expect(g.summary).toBe('The current given by the formula {v(in,out)*2m} is pushed from ground (node 0), through the source, into node g. ngspice works the formula out at every point of the analysis, from the voltages it names: node in and node out.');
  });

  it('Explain says PlainSpice\'s engine cannot run POLY or TABLE, and labels POLY(2)\'s second pair as control nodes', () => {
    const n = parseNetlist(`* t\n${DIVIDER}E1 e 0 POLY(2) out 0 in 0 0 1 1\nE2 f 0 TABLE {v(out)} = (0,0) (5,10)\n.op\n.end\n`);
    const poly = explainLine(n, 4)!;
    expect(poly.summary).toBe("E1's output is a polynomial of the voltage at node out, measured from ground and the voltage at node in, measured from ground, written POLY.");
    expect(poly.fields.filter((f) => /control/.test(f.label)).map((f) => f.label)).toEqual(['control + node', 'control − node', 'control + node', 'control − node']);
    expect(poly.notes.join(' ')).toContain("PlainSpice's engine cannot run this line");
    const table = explainLine(n, 5)!;
    expect(table.summary).toBe("E2's output follows a table of points of {v(out)}, written TABLE.");
  });

  it('the overview says a source given by a formula, never "? × the voltage at ?"', () => {
    const words = describeCircuit(parseNetlist(`* t\n${DIVIDER}E1 e 0 VALUE={v(out)*2}\nG1 0 g cur={v(out)*2m}\nE2 f 0 POLY(1) out 0 0 2\nRe e 0 1k\n.op\n.end\n`));
    expect(words).toContain('E1: a voltage source given by a formula: the voltage at node e, measured from ground, is {v(out)*2}.');
    expect(words).toContain('G1: a current source given by a formula, pushing {v(out)*2m} from ground into node g.');
    expect(words).toContain("E2: a dependent source written as a polynomial (POLY), which PlainSpice's engine cannot run.");
    expect(words).not.toContain('?');
    // The nodes a formula reads are no extra nodes of the circuit.
    expect(words).toMatch(/^7 parts and 5 nodes besides ground \(in, out, e, g, f\)/);
  });

  it('the drawing leaves them out, as it does a B line, and says so', () => {
    const s = buildSchematic(`* t\n${DIVIDER}E1 e 0 VALUE={v(out)*2}\nE2 f 0 POLY(1) out 0 0 2\nRe e 0 1k\nRf f 0 1k\n.op\n.end\n`);
    expect(s.circuit.parts.map((p) => p.name)).toEqual(['V1', 'R1', 'R2', 'Re', 'Rf']);
    expect(s.circuit.notDrawn.map((n) => `${n.name} ${n.reason}`)).toEqual(['E1 part-kind', 'E2 part-kind']);
    expect(s.problems).toEqual([]);
  });
});
