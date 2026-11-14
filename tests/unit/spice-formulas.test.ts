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
 * - Words ngspice takes out of an E, F, G or H line before it reads it are no nodes (unknown-word-53, -54).
 */
import { describe, expect, it } from 'vitest';
import { applyEdit, buildSchematic } from '../../src/schematic/index.ts';
import { applyChanges } from '../../src/schematic/format.ts';
import { describeCircuit, explainDiagnostic } from '../../src/spice/describe.ts';
import { explainLine } from '../../src/spice/explain.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { applyFix, checkTraps, nodeReferences } from '../../src/spice/traps.ts';
import type { Element, TextChange } from '../../src/spice/types.ts';
import { leastWorkMs } from './work-time.ts';

const T = '\u00e7\u0131k\u0131\u015f'; // çıkış
const ZW = '\u200b';
const THIN = '\u2009';
const NBSP = '\u00a0';
const CYR_O = '\u043e';
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

/** Every form of line that names a node, before and after .end (C3-1). */
const FORMS = (n: string): [string, string[], string[], string?][] => [
  ['B V=', [`B1 b 0 V=v(${n})*2`, 'Rb b 0 1k'], []],
  ['B V={}', [`B1 b 0 V={v(${n})*2}`, 'Rb b 0 1k'], []],
  ['B I=', [`B2 0 b I=v(${n})/1k`, 'Rb b 0 1k'], []],
  ['B v(a,b)', [`B1 b 0 V=v(giris,${n})`, 'Rb b 0 1k'], []],
  ['B V( )', [`B1 b 0 V=V( ${n} )*2`, 'Rb b 0 1k'], []],
  ['E VALUE=', [`E1 e 0 VALUE={v(${n})*2}`, 'Re e 0 1k'], []],
  ['E vol=', [`E1 e 0 vol='v(${n})*2'`, 'Re e 0 1k'], []],
  ['G cur=', [`G1 0 g cur={v(${n})/1k}`, 'Rg g 0 1k'], []],
  ['E POLY', [`E1 e 0 POLY(1) ${n} 0 0 2`, 'Re e 0 1k'], []],
  ['E TABLE', [`E1 e 0 TABLE {v(${n})} = (0,0) (5,10)`, 'Re e 0 1k'], []],
  ['R formula', [`R4 x 0 R={1k+v(${n})}`, 'Rx giris x 1k'], []],
  ['C formula', [`C4 x 0 {1u*(1+v(${n}))}`, 'Rx giris x 1k'], []],
  ['.pz', [`.pz giris 0 ${n} 0 vol pz`], [], 'V1 giris 0 dc 10 ac 1'],
  ['.print bare', ['.dc V1 0 10 1', `.print dc ${n}`], []],
  ['.tf', [`.tf v(${n}) V1`], []],
  ['.control', ['.control', 'op', `print v(${n})`, `save ${n}`, '.endc'], []],
  ['*#', [`*# let x = v(${n})*2`], []],
  ['.save bare', [`.save ${n}`], []],
  ['.global', [`.global ${n}`], []],
  ['.func', [`.func vo() {v(${n})}`, 'B1 b 0 V=vo()*2', 'Rb b 0 1k'], []],
  ['after .end: part', [], [`R3 ${n} 0 1k`]],
  ['after .end: .tf', [], [`.tf v(${n}) V1`]],
  ['after .end: B', [], [`B9 b9 0 V=v(${n})`, 'R9 b9 0 1k']],
  ['after .end: .control', [], ['.control', `print v(${n})`, `save ${n}`, '.endc']],
  ['after .end: .save', [], [`.save ${n}`]],
  ['after .end: .func', [], [`.func vo() {v(${n})}`]],
];
const netlistOf = (node: string, extra: string[], after: string[], src = 'V1 giris 0 10'): string => ['* t', src, `R1 giris ${node} 1k`, `R2 ${node} 0 1k`, ...extra, '.op', '.end', ...after, ''].join('\n');
/** The lines ngspice reads: not the title, not comments, not inside .subckt ... .ends. */
const readLines = (text: string): string[] => {
  let depth = 0;
  return text.split('\n').slice(1).filter((l) => {
    if (/^\s*\.subckt/i.test(l)) depth += 1;
    const inside = depth > 0;
    if (/^\s*\.ends/i.test(l)) depth -= 1;
    return !inside && !/^\s*\*(?!#)/.test(l);
  });
};

describe('every rename leaves the old name nowhere ngspice reads it (C3-1)', () => {
  const kinds: [string, string, string[]][] = [
    ['a Turkish letter', T, ['non-ascii-node']],
    ['an invisible character', `ou${ZW}t`, ['invisible-character']],
    ['a thin space', `o${THIN}ut`, ['space-character']],
    ['a no-break space', `o${NBSP}ut`, ['nbsp']],
    ['a look-alike letter', `${CYR_O}ut`, ['look-alike-letter']],
  ];
  for (const [what, node, checks] of kinds) {
    it(`the fix for ${what}, on every form of line`, () => {
      for (const [form, extra, after, src] of FORMS(node)) {
        const text = netlistOf(node, extra, after, src);
        const trap = checkTraps(parseNetlist(text)).find((t) => checks.includes(t.id) && t.fixes.length > 0 && t.line === 3);
        expect(trap, `${what} / ${form}`).toBeDefined();
        const fixed = applyFix(text, trap!.fixes[0]!);
        expect(readLines(fixed).filter((l) => l.includes(node)), `${what} / ${form}: ${trap!.fixes[0]!.label}`).toEqual([]);
      }
    });
  }

  // CR1-1: the other lines write the name with a capital first letter, as ngspice spells it the same (both
  // ____k____, __ut, ...): the same node, renamed with it, and no "one node for ngspice" error.
  const capitals: [string, string, string, string[]][] = [
    ['a Turkish letter', T, '\u00c7\u0131k\u0131\u015f', ['non-ascii-node']],
    ['a look-alike letter', `${CYR_O}ut`, '\u041eut', ['look-alike-letter']],
  ];
  for (const [what, node, capital, checks] of capitals) {
    it(`the fix for ${what}, where the other lines write it with a capital letter (CR1-1)`, () => {
      for (const [form, extra, after, src] of FORMS(capital)) {
        // POLY's control nodes are a part's ends, as on part lines: two names there are the error's (non-ascii-node-2).
        if (form === 'E POLY') continue;
        const text = netlistOf(node, extra, after, src);
        const traps = checkTraps(parseNetlist(text));
        expect(traps.filter((t) => t.severity === 'error' && ['non-ascii-node', ...checks].includes(t.id)).map((t) => t.title), `${what} / ${form}`).toEqual([]);
        const trap = traps.find((t) => checks.includes(t.id) && t.fixes.length > 0 && t.line === 3);
        expect(trap, `${what} / ${form}`).toBeDefined();
        const fixed = applyFix(text, trap!.fixes[0]!);
        expect(readLines(fixed).filter((l) => l.includes(node) || l.includes(capital)), `${what} / ${form}: ${trap!.fixes[0]!.label}`).toEqual([]);
      }
    });
  }

  it('two names ngspice makes one (ş and ç): the fix renames each in the formulas and after .end too', () => {
    const text = '* t\nV1 a 0 10\nR1 a ş 1k\nR2 ş ç 1k\nR3 ç 0 1k\nB1 b 0 V=v(ş)+v(ç)\nRb b 0 1k\n.op\n.end\nR4 ç 0 1k\n';
    const trap = checkTraps(parseNetlist(text)).find((t) => t.id === 'non-ascii-node')!;
    const fixed = applyFix(text, trap.fixes[0]!);
    expect(readLines(fixed).filter((l) => /[şç]/.test(l))).toEqual([]);
  });

  it('aµ and au: the fix renames the µ spelling only, in a formula and after .end too', () => {
    const text = '* t\nV1 aµ 0 12\nR1 aµ au 1k\nR2 au 0 2k\nB1 b 0 V=v(aµ)\nRb b 0 1k\n.op\n.end\nR3 aµ 0 1k\n';
    const trap = checkTraps(parseNetlist(text)).find((t) => t.id === 'non-ascii-node')!;
    expect(trap.fixes[0]!.label).toBe('Rename node aµ to au2');
    const fixed = applyFix(text, trap.fixes[0]!);
    expect(readLines(fixed).filter((l) => l.includes('µ'))).toEqual([]);
    expect(fixed).toContain('B1 b 0 V=v(au2)');
    expect(fixed).toContain('R2 au 0 2k');
    expect(fixed).toContain('R3 au2 0 1k');
  });

  it('a word ngspice reads as the node that no reader finds is renamed too: a command for ngspice that names it bare', () => {
    const text = netlistOf(T, ['.control', 'op', `let doubled = 2*${T}`, `print ${T} doubled`, '.endc'], ['.control', `print ${T}`, '.endc']);
    const trap = checkTraps(parseNetlist(text)).find((t) => t.id === 'non-ascii-node')!;
    expect(readLines(applyFix(text, trap.fixes[0]!)).filter((l) => l.includes(T))).toEqual([]);
  });

  it('a subcircuit\'s own node of the same name stays as it is', () => {
    const text = `* t\nV1 giris 0 10\nR1 giris ${T} 1k\nR2 ${T} 0 1k\nX1 ${T} 0 sub\n.subckt sub ${T} b\nB1 b 0 V=v(${T})*2\n.ends\n.op\n.end\n`;
    const trap = checkTraps(parseNetlist(text)).find((t) => t.id === 'non-ascii-node')!;
    const fixed = applyFix(text, trap.fixes[0]!);
    expect(fixed).toContain(`X1 cikis 0 sub\n.subckt sub ${T} b\nB1 b 0 V=v(${T})*2\n.ends`);
  });

  it('nodeReferences lists every word ngspice reads as the node, after .end too, in netlist order', () => {
    const text = netlistOf('out', ['B1 b 0 V=v(out)*2', '.pz giris 0 out 0 vol pz', '.print dc out', '.control', 'save out', '.endc'], ['R3 out 0 1k', '.tf v(out) V1']);
    const refs = nodeReferences(parseNetlist(text), 'out');
    expect(refs.map((t) => text.slice(t.from, t.to))).toEqual(Array(8).fill('out'));
    const at = refs.map((t) => t.from);
    expect(at).toEqual(at.slice().sort((a, b) => a - b));
    const lines = new Set(refs.map((t) => text.slice(0, t.from).split('\n').length));
    expect([...lines]).toEqual([3, 4, 5, 6, 7, 9, 13, 14]);
  });
});

describe('the drawing editor\'s rename leaves the old name nowhere ngspice reads it (C3-1)', () => {
  for (const [form, extra, after, src] of FORMS('out')) {
    if (form === '*#') continue; // a let names no node the parser reads; ngspice reads out as written there
    it(form, () => {
      const text = netlistOf('out', extra, after, src);
      const r = applyEdit(buildSchematic(text), { kind: 'rename-node', node: 'out', name: 'vout' }, { drawingInText: true });
      expect(r.ok, r.reason).toBe(true);
      const left = readLines(r.text).filter((l) => !/^\s*\*@/.test(l) && /(^|[\s(,=])out([\s),=*/+]|$)/.test(l) && !/^\s*(\.control|\.endc|op)\s*$/.test(l));
      expect(left, form === '.control' ? 'print v(out), save out' : form).toEqual([]);
    });
  }

  it('ground: the formula reads v(0) after the node is joined to ground', () => {
    const text = netlistOf('out', ['B1 b 0 V=v(out)*2', 'Rb b 0 1k'], ['R3 out 0 1k']);
    const s = buildSchematic(text);
    const r = applyEdit(s, { kind: 'rename-node', node: 'out', name: '0' }, { drawingInText: true });
    expect(r.ok, r.reason).toBe(true);
    expect(r.text).toContain('B1 b 0 V=v(0)*2');
    expect(r.text).toContain('R3 0 0 1k');
  });
});

describe('a character that looks like a space in a formula (space-character-22 to -24, nbsp-4)', () => {
  it('stops ngspice: an error whose fix takes it out', () => {
    for (const [line, ch, id, says] of [
      [`B1 e 0 V=v(out)${THIN}*2`, THIN, 'space-character', "'unknown parameter (_)'"],
      [`B1 e 0 V={v(out)${THIN}*2}`, THIN, 'space-character', "'unknown parameter (_)'"],
      [`E1 e 0 VALUE={v(out)${THIN}*2}`, THIN, 'space-character', "'unknown parameter (_)'"],
      [`B1 e 0 V=v${THIN}(out)*2`, THIN, 'space-character', "'Undefined parameter [v]'"],
      [`B1 e 0 V=v(out)${NBSP}*2`, NBSP, 'nbsp', "'unknown parameter (_)'"],
      [`G1 0 e cur={v(out)${THIN}*2m}`, THIN, 'space-character', "'unknown parameter (_)'"],
      [`E1 e 0 VALUE={v${THIN}(out)*2}`, THIN, 'space-character', "'Undefined parameter [v]'"],
      [`B1 e 0 V={v${NBSP}(out)*2}`, NBSP, 'nbsp', "'Undefined parameter [v]'"],
    ] as const) {
      const text = `* t\n${DIVIDER}${line}\nRe e 0 1k\n.op\n.end\n`;
      const traps = checkTraps(parseNetlist(text));
      expect(traps.map((t) => `${t.id} ${t.severity}`), line).toEqual([`${id} error`]);
      expect(traps[0]!.ngspice, line).toContain(says);
      expect(traps[0]!.fixes.map((f) => f.label), line).toEqual(['Take it out']);
      const fixed = applyFix(text, traps[0]!.fixes[0]!);
      expect(fixed, line).not.toContain(ch);
      expect(ids(fixed), line).toEqual([]);
    }
  });

  it('inside a node\'s name in a formula it is the node\'s check, never "Replace it with a normal space" (v(o ut) stops ngspice)', () => {
    for (const formula of [`V=v(o${THIN}ut)*2`, `V={v(o${THIN}ut)*2}`]) {
      const text = `* t\nV1 giris 0 10\nR1 giris o${THIN}ut 1k\nR2 o${THIN}ut 0 1k\nB1 b 0 ${formula}\nRb b 0 1k\n.op\n.end\n`;
      const traps = checkTraps(parseNetlist(text));
      expect(traps.map((t) => t.id), formula).toEqual(['space-character']);
      expect(traps.flatMap((t) => t.fixes.map((f) => f.label)), formula).toEqual(['Take it out: name the node out']);
      expect(applyFix(text, traps[0]!.fixes[0]!), formula).toContain('v(out)*2');
    }
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

describe('words ngspice takes out of an E, F, G or H line before it reads it (C3-5, unknown-word-53, -54)', () => {
  const KINDS = '* t\nV1 in 0 5\nVs in mid 0\nR1 mid out 1k\nR2 out 0 1k\n';

  it("HSPICE's word for the kind, on a line of exactly seven words (E, G) or six (F, H), is no node and no source", () => {
    const n = parseNetlist(`${KINDS}E1 e 0 vcvs out 0 2\nG1 0 g vccs out 0 2m\nF1 0 f cccs Vs 2\nH1 h 0 ccvs Vs 1k\nRe e 0 1k\nRg g 0 1k\nRf f 0 1k\nRh h 0 1k\n.op\n.end\n`);
    const [e, g, f, h] = [5, 6, 7, 8].map((i) => n.lines[i]!.element!) as [Element, Element, Element, Element];
    expect(e.nodes.map((r) => r.name)).toEqual(['e', '0', 'out', '0']);
    expect(e.value?.number?.value).toBe(2);
    expect(g.nodes.map((r) => r.name)).toEqual(['0', 'g', 'out', '0']);
    expect(g.value?.number?.value).toBe(0.002);
    expect([f.controlSource?.text, f.value?.number?.value]).toEqual(['Vs', 2]);
    expect([h.controlSource?.text, h.value?.number?.value]).toEqual(['Vs', 1000]);
    expect([...n.nodes.keys()].filter((k) => /vcvs|vccs/.test(k))).toEqual([]);
    expect(checkTraps(n)).toEqual([]);
  });

  it('with one word more ngspice keeps the word as a node and stops at the next one ("unknown parameter (2)"), and so do the checks', () => {
    const text = `* t\n${DIVIDER}E1 e 0 vcvs out 0 2 m=1\nRe e 0 1k\n.op\n.end\n`;
    expect(parseNetlist(text).lines[4]!.element!.nodes.map((r) => r.name)).toEqual(['e', '0', 'vcvs', 'out']);
    // Native ngspice 47 and 42 stop there too, before any simulation: no polynomial, and no singular matrix at vcvs (CR1-8).
    const traps = checkTraps(parseNetlist(text));
    expect(traps.map((t) => t.id)).toEqual(['unknown-word']);
    expect(traps[0]!.ngspice).toBe("ngspice stops: 'unknown parameter (2)', native ngspice 47 and 42 too. [unknown-word-53]");
    expect(traps[0]!.why).toContain('reads vcvs as a control node and 0 as the gain, and stops at 2');
    const g = checkTraps(parseNetlist(`* t\n${DIVIDER}G1 0 e vccs out 0 2m m=1\nRe e 0 1k\n.op\n.end\n`));
    expect(g.map((t) => [t.id, t.ngspice])).toEqual([['unknown-word', "ngspice stops: 'unknown parameter (2m)', native ngspice 47 and 42 too. [unknown-word-53]"]]);
    // Seven words with numbers only are still a polynomial for native ngspice (unknown-word-4).
    expect(checkTraps(parseNetlist(`* t\n${DIVIDER}E1 e 0 out 0 2 3\nRe e 0 1k\n.op\n.end\n`))[0]!.ngspice).toContain('reads the extra number as part of a polynomial and runs');
  });

  it('two words between the output nodes and VALUE= or cur= are dropped: no nodes, nothing connected, no trap', () => {
    const n = parseNetlist(`* t\n${DIVIDER}E1 e 0 in 0 VALUE={v(out)*2}\nG1 0 g in 0 cur={v(out)*2m}\nE2 e2 0 out 0 VALUE={2}\nRe e 0 1k\nRg g 0 1k\nRe2 e2 0 1k\n.op\n.end\n`);
    const [e, g, e2] = [4, 5, 6].map((i) => n.lines[i]!.element!) as [Element, Element, Element];
    expect(e.nodes.map((r) => r.name)).toEqual(['e', '0']);
    expect(e.form?.kind).toBe('formula');
    expect(e.form?.dropped?.map((t) => t.text)).toEqual(['in', '0']);
    expect(e.reads!.map((r) => r.name)).toEqual(['out']);
    expect(g.nodes.map((r) => r.name)).toEqual(['0', 'g']);
    expect(g.form?.keyword.text).toBe('cur');
    expect(e2.reads).toBeUndefined();
    expect(n.nodes.get('in')!.connections.map((c) => c.element)).toEqual(['v1', 'r1']);
    expect(checkTraps(n)).toEqual([]);
  });

  it('three or more words, such as a gain left on the line, are dropped too; one word stops native ngspice: a warning whose fix takes it out', () => {
    const n = parseNetlist(`* t\n${DIVIDER}E1 e 0 out 0 2 VALUE={v(out)*2}\nE2 e2 0 a b c d VALUE={2}\nRe e 0 1k\nRe2 e2 0 1k\n.op\n.end\n`);
    expect(n.lines[4]!.element!.form?.dropped?.map((t) => t.text)).toEqual(['out', '0', '2']);
    expect(n.lines[5]!.element!.nodes.map((r) => r.name)).toEqual(['e2', '0']);
    expect(checkTraps(n)).toEqual([]);
    const one = `* t\n${DIVIDER}E1 e 0 x VALUE={2}\nRe e 0 1k\n.op\n.end\n`;
    const traps = checkTraps(parseNetlist(one));
    expect(traps.map((t) => [t.id, t.severity, t.title])).toEqual([['missing-fields', 'warning', "Native ngspice stops at E1's word x"]]);
    expect(applyFix(one, traps[0]!.fixes[0]!)).toBe(one.replace('x VALUE', 'VALUE'));
    // A setting ends the search: after m=1, value= starts no formula.
    expect(parseNetlist(`* t\n${DIVIDER}E1 e 0 out 0 2 m=1 value={3}\n.op\n.end\n`).lines[4]!.element!.form).toBeUndefined();
  });

  it("a formula ngspice can't read (no braces and a number first, VALUE without =, or nothing) is an error, and braces fix it (fatal-syntax-12 to -16)", () => {
    const said = (line: string): string[] => {
      const text = `* t\n${DIVIDER}${line}\nRe e 0 1k\n.op\n.end\n`;
      return checkTraps(parseNetlist(text)).map((t) => `${t.id}: ${t.title}${t.fixes[0] ? ` -> ${applyFix(text, t.fixes[0]).split('\n')[4]}` : ''}`);
    };
    expect(said('E1 e 0 VALUE=3')).toEqual(["fatal-syntax: ngspice can't read E1's formula without braces -> E1 e 0 VALUE={3}"]);
    expect(said('E1 e 0 VALUE=2*v(out)')).toEqual(["fatal-syntax: ngspice can't read E1's formula without braces -> E1 e 0 VALUE={2*v(out)}"]);
    expect(said('G1 0 e cur=2m*v(out)')).toEqual(["fatal-syntax: ngspice can't read G1's formula without braces -> G1 0 e cur={2m*v(out)}"]);
    expect(said('E1 e 0 VALUE v(out)*2')).toEqual(["fatal-syntax: ngspice can't read E1's formula without braces -> E1 e 0 VALUE {v(out)*2}"]);
    expect(said('E1 e 0 VALUE=')).toEqual(['fatal-syntax: E1 has an empty formula']);
    expect(said('E1 e 0 VALUE={}')).toEqual(['fatal-syntax: E1 has an empty formula']);
    expect(said('E1 e 0 VALUE')).toEqual(['fatal-syntax: E1 has an empty formula']);
    const words = (line: string): string => checkTraps(parseNetlist(`* t\n${DIVIDER}${line}\nRe e 0 1k\n.op\n.end\n`))[0]!.ngspice;
    expect(words('G1 0 e cur=2m*v(out)')).toContain("'mal formed G source instance' (ngspice 42: 'mal formed G line')");
    expect(words('E1 e 0 VALUE')).toContain("'mal formed E source instance' (ngspice 42: 'mal formed E line')");
    expect(words('E1 e 0 VALUE=')).toContain("ngspice 47 stops with a fatal error: 'YYparse error, syntax error, in expression'");
    for (const runs of ['E1 e 0 VALUE=v(out)*2', 'E1 e 0 VALUE=(v(out)*2)', 'E1 e 0 VALUE=v(out)*(1+1)', 'G1 0 e cur=v(out)*2m', "E1 e 0 vol='v(out)*2'"]) {
      expect(said(runs), runs).toEqual([]);
    }
    // Without braces the formula is the rest of the line, with its last bracket.
    expect(parseNetlist(`* t\n${DIVIDER}E1 e 0 VALUE=v(out)*(1+1)\n.op\n.end\n`).lines[4]!.element!.form?.formula?.text).toBe('v(out)*(1+1)');
  });

  it('Explain says how many words ngspice drops, and that native ngspice stops at one', () => {
    const n = parseNetlist(`* t\n${DIVIDER}E1 e 0 x VALUE={2}\nE2 e2 0 out 0 2 VALUE={v(out)*2}\n.op\n.end\n`);
    expect(explainLine(n, 4)!.notes).toContain("PlainSpice's engine drops the word before the formula (x), so it changes nothing here: the output is the formula alone. Native ngspice stops at it (see the checks).");
    expect(explainLine(n, 5)!.notes).toContain('ngspice drops the three words before the formula (out 0 2), so they change nothing: the output is the formula alone.');
  });

  it('Explain shows them as words ngspice takes out or drops, and names a form line as the overview does', () => {
    const n = parseNetlist(`${KINDS}E1 e 0 vcvs out 0 2\nH1 h 0 ccvs Vs 1k\nE2 e2 0 in 0 VALUE={v(out)*2}\nRe e 0 1k\n.op\n.end\n`);
    const e = explainLine(n, 5)!;
    expect(e.fields.map((f) => `${f.label}: ${f.text}`)).toEqual(['name: E1', '+ node: e', '− node: 0', 'kind: vcvs', 'control + node: out', 'control − node: 0', 'gain: 2']);
    expect(e.fields[3]!.meaning).toBe("vcvs: HSPICE's word for this kind of part, which ngspice takes out");
    expect(explainLine(n, 6)!.fields.map((f) => f.label)).toEqual(['name', '+ node', '− node', 'kind', 'control source', 'volts per amp']);
    const e2 = explainLine(n, 7)!;
    expect(e2.heading).toBe('E2: a voltage source given by a formula');
    expect(e2.fields.map((f) => `${f.label}: ${f.text}`)).toEqual(['name: E2', '+ node: e2', '− node: 0', 'dropped word: in', 'dropped word: 0', 'formula: VALUE', 'formula: {v(out)*2}']);
    expect(e2.fields[0]!.meaning).toBe('the first letter, E, makes it a dependent voltage source');
    expect(e2.notes).toContain('ngspice drops the two words before the formula (in 0), so they change nothing: the output is the formula alone.');
  });

  it("the Numbers panel says PlainSpice's engine can't run a TABLE or a POLY, not that the line starts with an unknown letter", () => {
    const table = parseNetlist(`* t\n${DIVIDER}E1 e 0 TABLE {v(out)} = (0,0) (5,10)\nRe e 0 1k\n.op\n.end\n`);
    // What our engine prints for it (model-not-in-engine-8): "unknown device type", on line 5.
    const t = explainDiagnostic({ severity: 'error', code: 'unknown-device', text: 'unknown device type - error', line: 5 }, table);
    expect([t.title, t.line]).toEqual(["PlainSpice's engine can't run E1's TABLE", 5]);
    expect(t.why).toContain('Native ngspice 47 runs it.');
    const poly = parseNetlist('* t\nV1 in 0 5\nVx in out 0\nR2 out 0 1k\nF1 0 e POLY(1) Vx 0 2\nRe e 0 1k\n.op\n.end\n');
    // model-not-in-engine-9: our engine's words for it.
    const text = "Error: XSPICE is required to run the 'poly' option in instance f1 0 e poly(1) vx 0 2";
    const p = explainDiagnostic({ severity: 'error', code: 'error', text }, poly);
    expect([p.title, p.line]).toEqual(["PlainSpice's engine can't run F1's POLY", 5]);
  });
});

describe("the round-1 critic of these fixes (13 November 2026)", () => {
  const TC = 'Çıkış'; // Çıkış
  const traps = (text: string) => checkTraps(parseNetlist(text));
  const formula = (line: string): string => `* t\n${DIVIDER}${line}\nRe e 0 1k\n.op\n.end\n`;
  const SPACE_LIKE_ANY = /[   -   　]/;

  it('CR1-1: a name written with a capital letter in a formula, on .pz or after .end is the node: one warning, and the rename reaches it', () => {
    for (const extra of [[`B1 b 0 V=v(${TC})*2`, 'Rb b 0 1k'], [`E1 e 0 VALUE={v(${TC})*2}`, 'Re e 0 1k'], [`.pz giris 0 ${TC} 0 vol pz`]]) {
      const text = netlistOf(T, extra, []);
      const found = traps(text);
      expect(found.map((t) => `${t.id} ${t.severity}`), extra[0]).toEqual(['non-ascii-node warning']);
      expect(found[0]!.fixes[0]!.label).toBe(`Rename node ${T} to cikis`);
      expect(applyFix(text, found[0]!.fixes[0]!), extra[0]).toContain(extra[0]!.replace(TC, 'cikis'));
    }
    const after = netlistOf(T, [], [`R3 ${TC} 0 1k`]);
    expect(applyFix(after, traps(after).find((t) => t.id === 'non-ascii-node')!.fixes[0]!)).toContain('.end\nR3 cikis 0 1k');
    // The guard matches ngspice's spelling too: a command for ngspice that names the node bare, with a capital.
    const command = netlistOf(T, ['.control', 'op', `print ${TC}`, '.endc'], []);
    expect(applyFix(command, traps(command)[0]!.fixes[0]!)).toContain('print cikis');
    // The drawing editor's rename reaches them as well.
    const r = applyEdit(buildSchematic(netlistOf(T, [`B1 b 0 V=v(${TC})*2`, 'Rb b 0 1k'], [`R3 ${TC} 0 1k`])), { kind: 'rename-node', node: T, name: 'vout' }, { drawingInText: true });
    expect(r.ok, r.reason).toBe(true);
    expect(readLines(r.text).filter((l) => l.includes(T) || l.includes(TC))).toEqual([]);
  });

  it('CR1-1: two names parts connect to that ngspice makes one are still the error, and a name a formula reads goes with the one written like it', () => {
    const text = `* t\nV1 a 0 10\nR1 a şıkış 1k\nR2 şıkış ${T} 1k\nR3 ${T} 0 1k\nB1 b 0 V=v(${TC})\nRb b 0 1k\n.op\n.end\n`;
    const [error] = traps(text).filter((t) => t.severity === 'error');
    expect(error!.title).toBe(`Node şıkış and node ${T} are one node for ngspice`);
    expect(applyFix(text, error!.fixes[0]!)).toContain('B1 b 0 V=v(cikis)');
  });

  it('CR1-3: a rename reaches a bare name on .save, the names on .global and inside its subcircuits, and a .func\'s formula; a .probe word stays', () => {
    const text = `* t\n.global ${T}\nV1 giris 0 10\nR1 giris ${T} 1k\nX1 sub\n.subckt sub\nR2 ${T} 0 1k\n.ends\n.func vo() {v(${T})}\nB1 b 0 V=vo()*2\nRb b 0 1k\n.save ${T} b\n.op\n.end\n.save ${T}\n`;
    const fixed = applyFix(text, traps(text).find((t) => t.id === 'non-ascii-node')!.fixes[0]!);
    expect(fixed.split('\n').filter((l) => l.includes(T))).toEqual([]);
    expect(fixed).toContain('.save cikis b\n');
    // A bare name on .probe is no node for ngspice ("Strange parameter", ignored): the editor's rename leaves it.
    const probe = applyEdit(buildSchematic(netlistOf('out', ['.probe out'], [])), { kind: 'rename-node', node: 'out', name: 'vout' }, { drawingInText: true });
    expect(probe.text).toContain('.probe out\n');
    // A subcircuit's own end of that name is the subcircuit's, not the .global node.
    const own = `* t\n.global ${T}\nV1 giris 0 10\nR1 giris ${T} 1k\nX1 ${T} sub\n.subckt sub ${T}\nR2 ${T} 0 1k\n.ends\n.op\n.end\n`;
    expect(applyFix(own, traps(own).find((t) => t.id === 'non-ascii-node')!.fixes[0]!)).toContain(`.subckt sub ${T}\nR2 ${T} 0 1k`);
    // The parser reads a .func's v(...) as nodes, even a word of the function's own.
    expect(parseNetlist('* t\n.func vd(a,b) {v(a)-v(b)}\nV1 a 0 1\n.op\n.end\n').nodes.get('a')!.refs.length).toBe(2);
  });

  it('CR1-11: the rename leaves a title and an echo as written', () => {
    const text = netlistOf(T, ['.control', `echo ${T} devresi`, 'op', '.endc'], []).replace('* t\n', `* t\n.title ${T} devresi\n`);
    const fixed = applyFix(text, traps(text).find((t) => t.id === 'non-ascii-node')!.fixes[0]!);
    expect(fixed).toContain(`.title ${T} devresi`);
    expect(fixed).toContain(`echo ${T} devresi`);
    expect(fixed).toContain('R2 cikis 0 1k');
  });

  it('CR1-2: one error for every character that looks like a space in a formula, after a number and at the end too, and its fix leaves none', () => {
    for (const line of [`B1 e 0 V=2${NBSP}*${NBSP}v(out)`, `B1 e 0 V=v(out)*2${NBSP}`, `B1 e 0 V=v(out)*2${THIN}`, `B1 e 0 V=2${THIN}*v(out)`, `B1 e 0 V=v(out)${NBSP}*${NBSP}2`, `E1 e 0 VALUE=v(out)*2${THIN}`, `B1 e 0\n+ V=v(out)${THIN}*\n+ 2${NBSP}`]) {
      const text = formula(line);
      const found = traps(text);
      expect(found.map((t) => `${t.id} ${t.severity}`), line).toEqual([`${line.includes(NBSP) && !line.includes(THIN) ? 'nbsp' : line.indexOf(NBSP) >= 0 && line.indexOf(NBSP) < line.indexOf(THIN) ? 'nbsp' : 'space-character'} error`]);
      expect(found[0]!.ngspice, line).not.toContain('__2');
      const fixed = applyFix(text, found[0]!.fixes[0]!);
      expect(fixed, line).not.toMatch(SPACE_LIKE_ANY);
      expect(traps(fixed), line).toEqual([]);
    }
    // A blank stays between the formula and B's own setting.
    const tc = formula(`B1 e 0 V=v(out)*2${THIN}tc1=0`);
    expect(applyFix(tc, traps(tc)[0]!.fixes[0]!)).toContain('B1 e 0 V=v(out)*2 tc1=0\n');
  });

  it("CR1-4, CR1-6: the words ngspice says, by what stands before the character, each with its own fact", () => {
    for (const [line, says] of [
      [`B1 e 0 V=${THIN}v(out)*2`, "ngspice stops: 'parameter value out of range or the wrong type'. [space-character-25]"],
      [`B1 e 0 V=${NBSP}v(out)*2`, "ngspice stops: 'parameter value out of range or the wrong type'. [space-character-25]"],
      [`B1 e 0 V={${THIN}v(out)*2}`, "ngspice stops: 'parameter value out of range or the wrong type'. [space-character-25]"],
      [`E1 e 0 VALUE={${THIN}v(out)*2}`, "ngspice stops: 'parameter value out of range or the wrong type'. [space-character-25]"],
      [`G1 0 e cur={${THIN}v(out)*2m}`, "ngspice stops: 'parameter value out of range or the wrong type'. [space-character-25]"],
      [`B1 e 0 V=+${THIN}v(out)*2`, "ngspice stops: 'parameter value out of range or the wrong type'. [space-character-25]"],
      [`B1 e 0 I=-${THIN}v(out)/1k`, "ngspice stops: 'The internal check of parse tree … failed', then 'parameter value out of range or the wrong type'. [space-character-26]"],
      [`B1 e 0 V=v(out)*${THIN}2`, "ngspice stops: 'The internal check of parse tree … failed', then 'parameter value out of range or the wrong type'. [space-character-26]"],
      [`B1 e 0 V=v(out)>1&&${THIN}v(in)>1?10:0`, "ngspice stops: 'The internal check of parse tree … failed', then 'parameter value out of range or the wrong type'. [space-character-26]"],
      [`B1 e 0 V=2${THIN}*v(out)`, "ngspice stops: 'unknown parameter (_)'. [space-character-27]"],
      [`B1 e 0 V={v(out)*2}${THIN}`, "ngspice stops: 'unknown parameter (_)'. [space-character-27]"],
      [`B1 e 0 V=v(out)${THIN}*2`, "ngspice stops: 'unknown parameter (_)'. [space-character-22]"],
      [`B1 e 0 V=v(out)${NBSP}*2`, "ngspice stops: 'unknown parameter (_)'. [nbsp-4]"],
      [`B1 e 0 V=(${THIN}v(out))*2`, "ngspice 47 stops with a fatal error: 'YYparse error, syntax error, in expression' (ngspice 42: 'PTerror: syntax error'). [space-character-28]"],
      [`B1 e 0 V=max(v(out),${THIN}1)*2`, "ngspice 47 stops with a fatal error: 'YYparse error, syntax error, in expression' (ngspice 42: 'PTerror: syntax error'). [space-character-28]"],
      [`B1 e 0 V=v${THIN}(out)*2`, "ngspice stops: 'Undefined parameter [v]'. [space-character-23]"],
      [`B1 e 0 V=v${NBSP}(out)*2`, "ngspice stops: 'Undefined parameter [v]'. [nbsp-5]"],
      [`B1 e 0 V=abs${THIN}(v(out))*2`, 'ngspice stops with an error on this line. [space-character-29]'],
    ] as const) {
      const found = traps(formula(line));
      expect(found.map((t) => t.ngspice), line).toEqual([says]);
    }
  });

  it('CR1-5: an emoji or a math letter before a thin space stops no check, and no fix leaves half of one', () => {
    const lines = [
      `* t\n.title \u{1F600}${THIN}devre\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nC1 out x 1u\n.op\n.end\n`,
      `* t\nV1 in 0 5\nR1 in out 1k \u{1F600}${THIN}x\nR2 out 0 1k\nC1 out x 1u\n.op\n.end\n`,
      `* t\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nC1 out x 1u\nB1 e 0 V=v(out)*2+\u{1D465}${THIN}*2\nRe e 0 1k\n.op\n.end\n`,
    ];
    for (const text of lines) {
      let found: ReturnType<typeof traps> = [];
      expect(() => (found = traps(text)), text).not.toThrow();
      expect(found.map((t) => t.id), text).toContain('floating-dc');
      expect(found.some((t) => t.id === 'space-character'), text).toBe(true);
      for (const t of found) for (const f of t.fixes) expect(applyFix(text, f), `${t.id}: ${f.label}`).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
    }
  });

  it('CR1-9: Explain finds the keyword of a formula line once, whatever the number of words before it', () => {
    const calls = (n: number): number => {
      const net = parseNetlist(`* t\n${DIVIDER}E1 e 0 ${Array.from({ length: n }, (_, k) => `w${k}`).join(' ')} VALUE={2}\nRe e 0 1k\n.op\n.end\n`);
      const fields = net.lines[4]!.element!.fields;
      let count = 0;
      const own = fields.findIndex.bind(fields);
      fields.findIndex = ((...args: Parameters<typeof own>) => {
        count += 1;
        return own(...args);
      }) as typeof fields.findIndex;
      expect(explainLine(net, 4)!.fields.length).toBe(n + 5);
      return count;
    };
    expect(calls(4000)).toBe(calls(4));
  });

  it('CR1-10: a node called value is no formula in braces: the fix renames the node, on every E or G line that reads it as VALUE', () => {
    const text = '* t\nV1 in 0 5\nR1 in value 1k\nR2 value 0 1k\nE1 e 0 value 0 2\nG1 0 g value 0 2m\nRe e 0 1k\nRg g 0 1k\n.op\n.end\n';
    const found = traps(text);
    expect(found.map((t) => [t.id, t.title])).toEqual([
      ['fatal-syntax', "ngspice reads value on E1's line as the start of a formula"],
      ['fatal-syntax', "ngspice reads value on G1's line as the start of a formula"],
    ]);
    expect(found[0]!.ngspice).toBe("ngspice stops with a fatal error: 'mal formed E source instance' (ngspice 42: 'mal formed E line'). [fatal-syntax-17]");
    expect(found[0]!.fixes.map((f) => f.label)).toEqual(['Rename the node value to val']);
    // One fix for every such line, made once: thousands of them stay fast.
    expect(found[1]!.fixes[0]).toBe(found[0]!.fixes[0]);
    const fixed = applyFix(text, found[0]!.fixes[0]!);
    expect(fixed).toContain('E1 e 0 val 0 2\nG1 0 g val 0 2m');
    expect(traps(fixed)).toEqual([]);
    // With no node of that name there is nothing to rename, and still no braces; a formula with blanks around an operator keeps them.
    expect(traps(formula('E1 e 0 value 0 2'))[0]!.fixes).toEqual([]);
    expect(traps(formula('E1 e 0 VALUE v(out) * 2'))[0]!.fixes.map((f) => f.label)).toEqual(['Put it in braces: {v(out) * 2}']);
  });

  it('CR1-12: Explain and the overview say a formula line has no formula yet, never "?"', () => {
    for (const line of ['E1 e 0 VALUE', 'E1 e 0 VALUE=', 'E1 e 0 VALUE={}', 'G1 0 e cur=']) {
      const n = parseNetlist(formula(line));
      const e = explainLine(n, 4)!;
      expect(e.summary, line).toContain('has no formula yet');
      expect(e.summary, line).not.toContain('?');
      const words = describeCircuit(n);
      expect(words, line).toContain('given by a formula, but its line has no formula yet.');
      expect(words, line).not.toContain('?');
    }
    expect(explainLine(parseNetlist(formula('E1 e 0 POLY(1)')), 4)!.summary).toBe("E1's output is a polynomial, written POLY, but the line names no controls yet.");
    expect(explainLine(parseNetlist(formula('E1 e 0 TABLE')), 4)!.summary).toBe("E1's output follows a table of points, written TABLE, but the line does not say yet what the table looks up.");
  });

  it('missing-fields-10: one word before a formula is warned about only where native ngspice stops at it', () => {
    for (const line of ['E1 e 0 x VALUE={v(out)*2}', 'E1 e 0 x VALUE {2}', 'E1 e 0 x VALUE=v(out)*2', "E1 e 0 x vol='v(out)*2'", 'G1 0 e x cur={v(out)*2m}']) expect(ids(formula(line)), line).toEqual([]);
    for (const line of ['E1 e 0 x VALUE={2}', 'E1 e 0 x VALUE = {2}', 'G1 0 e x cur={2m}', "E1 e 0 x vol='2'", 'E1 e 0 x VALUE={2} ; see (1)']) expect(ids(formula(line)), line).toEqual(['missing-fields']);
  });
});

describe('the round-2 critic of these fixes (13 November 2026)', () => {
  const traps = (text: string) => checkTraps(parseNetlist(text));
  const formula = (line: string): string => `* t\n.param truek=2\n${DIVIDER}${line}\nRe e 0 1k\n.op\n.end\n`;
  const said = (line: string): string[] => {
    const text = formula(line);
    return traps(text).map((t) => `${t.id}: ${t.title}${t.fixes[0] ? ` -> ${applyFix(text, t.fixes[0]).split('\n')[5]}` : ''}`);
  };

  it('CR2-1: a formula without braces that starts with a sign before a letter or a bracket, or with a bracket, runs: no trap, and the whole formula is shown (fatal-syntax-19)', () => {
    // Native ngspice 47 and 42 (-b -r) and our engine run every one of these (e from -5 V to 7.5 V).
    for (const line of [
      'E1 e 0 VALUE=-v(out)*2', 'E1 e 0 VALUE=+v(out)*2', 'E1 e 0 VALUE=-(v(out))*2', 'E1 e 0 VALUE=-abs(v(out))', 'E1 e 0 vol=-v(out)',
      'G1 0 e cur=-v(out)/1k', 'E1 e 0 VALUE=(1+v(out))*2', 'E1 e 0 VALUE=(1+2)*v(out)', 'E1 e 0 VALUE=(2)*v(out)', 'E1 e 0 VALUE=(2)',
      'E1 e 0 VALUE=( 2 )', 'E1 e 0 vol=(2)', 'E1 e 0 VALUE=-(2)', 'G1 0 e cur=(2m)', 'E1 e 0 VALUE = -v(out)*2', 'E1 e 0 VALUE= (1+v(out))*2',
      'E1 e 0 VALUE=(1+v(out)) * 2', 'E1 e 0 VALUE=-truek*v(out)', 'E1 e 0 VALUE=(-2)*v(out)', 'E1 e 0 x VALUE=-v(out)*2', 'E1 e 0 x VALUE=(2)',
    ]) {
      expect(said(line), line).toEqual([]);
    }
    const shown = (line: string): string | undefined => parseNetlist(formula(line)).lines[5]!.element!.form?.formula?.text;
    expect(shown('E1 e 0 VALUE=(1+v(out))*2')).toBe('(1+v(out))*2');
    expect(shown('E1 e 0 VALUE = (1+v(out))*2')).toBe('(1+v(out))*2');
    expect(shown('E1 e 0 VALUE=-v(out)*2')).toBe('-v(out)*2');
    expect(shown('G1 0 e cur=(2m)')).toBe('(2m)');
    const n = parseNetlist(formula('E1 e 0 VALUE=(1+v(out))*2'));
    expect(explainLine(n, 5)!.summary).toContain('is given by the formula (1+v(out))*2.');
    expect(describeCircuit(n)).toContain('E1: a voltage source given by a formula: the voltage at node e, measured from ground, is (1+v(out))*2.');
    expect(describeCircuit(parseNetlist(formula('G1 0 e cur=-v(out)/1k')))).toContain('G1: a current source given by a formula, pushing -v(out)/1k from ground into node e.');
  });

  it('CR2-1: a sign and a number, or a name that starts with true or false, gets no braces from ngspice: the error, and braces fix it (fatal-syntax-18)', () => {
    for (const [line, fixed] of [
      ['E1 e 0 VALUE=-2', 'E1 e 0 VALUE={-2}'], ['E1 e 0 VALUE=+2', 'E1 e 0 VALUE={+2}'], ['E1 e 0 VALUE=-.5', 'E1 e 0 VALUE={-.5}'],
      ['E1 e 0 VALUE=-2*v(out)', 'E1 e 0 VALUE={-2*v(out)}'], ['E1 e 0 VALUE=-.5*v(out)', 'E1 e 0 VALUE={-.5*v(out)}'],
      ['E1 e 0 VALUE=.5*v(out)*4', 'E1 e 0 VALUE={.5*v(out)*4}'], ['E1 e 0 VALUE=truek*v(out)', 'E1 e 0 VALUE={truek*v(out)}'],
      ['G1 0 e cur=-2m*v(out)', 'G1 0 e cur={-2m*v(out)}'], ['E1 e 0 VALUE (1+v(out))*2', 'E1 e 0 VALUE {(1+v(out))*2}'],
    ]) {
      expect(said(line!), line).toEqual([`fatal-syntax: ngspice can't read ${line!.slice(0, 2)}'s formula without braces -> ${fixed}`]);
    }
    const t = traps(formula('E1 e 0 VALUE=-2*v(out)'))[0]!;
    expect(t.why).toBe("ngspice takes E1's formula from its { to the end of the line. After VALUE= it adds the braces itself, as for VALUE=v(out)*2 or VALUE=-v(out)*2, but not before a number (with a sign or not), so write VALUE={-2*v(out)}.");
    expect(t.ngspice).toBe("ngspice stops with a fatal error: 'mal formed E source instance' (ngspice 42: 'mal formed E line'). [fatal-syntax-12, fatal-syntax-13, fatal-syntax-14, fatal-syntax-18]");
    expect(traps(formula('E1 e 0 VALUE=truek*v(out)'))[0]!.why).toContain('but not before a number (with a sign or not), or a name that starts with true or false, so write VALUE={truek*v(out)}.');
    expect(traps(formula('E1 e 0 VALUE (1+v(out))*2'))[0]!.why).toBe("ngspice takes E1's formula from its { to the end of the line, and adds the braces itself only after VALUE=, so write VALUE {(1+v(out))*2}.");
    // A '.' with no digit after it is no number, in braces or not: no fix.
    expect(traps(formula('E1 e 0 VALUE=.v(out)'))[0]!.fixes).toEqual([]);
  });
  it('CR2-6: after VALUE without =, ngspice takes the formula from its { and drops what stands before it: a no-break space, a thin space, words (nbsp-7, missing-fields-11)', () => {
    const line5 = (line: string): Element => parseNetlist(formula(line)).lines[5]!.element!;
    for (const line of [
      `E1 e 0 VALUE ${NBSP}{v(out)*2}`, `E1 e 0 VALUE${NBSP}{v(out)*2}`, `E1 e 0 VALUE${THIN}{v(out)*2}`, `E1 e 0 VALUE${ZW}{v(out)*2}`, `E1 e 0 VALUE ${NBSP} {v(out)*2}`,
      `G1 0 e VALUE${NBSP}{v(out)*2m}`, `E1 e 0 VALUE${NBSP}=v(out)*2`, `E1 e 0 VALUE${NBSP}= {v(out)*2}`, 'E1 e 0 VALUE x {v(out)*2}', "E1 e 0 VALUE x 'v(out)*2'",
      `E1 e 0 x VALUE${NBSP}{v(out)*2}`,
    ]) {
      expect(ids(formula(line)), line).toEqual([]);
      const e = line5(line);
      expect(e.form?.keyword.text, line).toBe('VALUE');
      expect(e.nodes.length, line).toBe(2);
      expect(e.reads?.map((r) => r.name), line).toEqual(['out']);
      // The characters that look like a space are in no word, so no check reads them.
      expect(e.fields.some((f) => /[  ​]/.test(f.token.text)), line).toBe(false);
    }
    expect(line5(`E1 e 0 VALUE${NBSP}{v(out)*2}`).form?.formula?.text).toBe('{v(out)*2}');
    expect(line5('E1 e 0 VALUE x {v(out)*2}').form?.dropped?.map((t) => t.text)).toEqual(['x']);
    // A v(out) before the brace is dropped too: the formula reads no node, and gives 2 V (missing-fields-11).
    expect(line5('E1 e 0 VALUE v(out) {2}').reads).toBeUndefined();
    // Right after =, the character stops ngspice, as at the start of any formula (space-character-25); taken out, the line runs.
    const nbsp = traps(formula(`E1 e 0 VALUE=${NBSP}{v(out)*2}`));
    expect(nbsp.map((x) => [x.id, x.ngspice])).toEqual([['nbsp', "ngspice stops: 'parameter value out of range or the wrong type'. [space-character-25]"]]);
    expect(applyFix(formula(`E1 e 0 VALUE=${NBSP}{v(out)*2}`), nbsp[0]!.fixes[0]!)).toBe(formula('E1 e 0 VALUE={v(out)*2}'));
    // With no { at all, VALUE<no-break space>v(out)*2 stops ngspice, and braces mend it (fatal-syntax-14).
    expect(said(`E1 e 0 VALUE${NBSP}v(out)*2`)).toEqual([`fatal-syntax: ngspice can't read E1's formula without braces -> E1 e 0 VALUE${NBSP}{v(out)*2}`]);
    // Explain names the dropped words, and says native ngspice stops at one only where it does (missing-fields-9, -10).
    const n = parseNetlist(formula('E1 e 0 VALUE x {v(out)*2}'));
    expect(explainLine(n, 5)!.fields.map((f) => `${f.label}: ${f.text}`)).toEqual(['name: E1', '+ node: e', '− node: 0', 'formula: VALUE', 'dropped word: x', 'formula: {v(out)*2}']);
    const runs = 'ngspice drops the word before the formula (x), so it changes nothing: the output is the formula alone.';
    expect(explainLine(n, 5)!.notes).toContain(runs);
    expect(explainLine(parseNetlist(formula('E1 e 0 x VALUE={v(out)*2}')), 5)!.notes).toContain(runs);
    expect(explainLine(parseNetlist(formula('E1 e 0 x VALUE={2}')), 5)!.notes.join(' ')).toContain('Native ngspice stops at it (see the checks).');
  });
  it('CR2-4: a node called value anywhere on an E or G line is read as VALUE: the error and the rename, never braces; with braces after it, a warning (fatal-syntax-17, -20)', () => {
    const net = (line: string): string => `* t\nV1 in 0 5\nR1 in mid 1k\nR2 mid value 1k\nR3 value 0 1k\n${line}\nRe e 0 1k\n.op\n.end\n`;
    const valueTraps = (text: string) => traps(text).filter((t) => t.id === 'fatal-syntax' || t.id === 'model-not-in-engine');
    for (const [line, fixed] of [
      ['E1 e 0 mid value 2', 'E1 e 0 mid val 2'], // the control − node (the critic's v3)
      ['E1 e 0 value mid 2', 'E1 e 0 val mid 2'], // the control + node (CR1-10)
      ['E1 value 0 mid 0 2', 'E1 val 0 mid 0 2'], // an output node
      ['E1 e value mid 0 2', 'E1 e val mid 0 2'],
      ['G1 0 value mid 0 2m', 'G1 0 val mid 0 2m'],
      ['G1 0 e mid value 2m', 'G1 0 e mid val 2m'],
      ['E1 e 0 POLY(1) value 0 0 2', 'E1 e 0 POLY(1) val 0 0 2'],
    ] as const) {
      const found = valueTraps(net(line));
      expect(found.map((t) => [t.severity, t.title]), line).toEqual([['error', `ngspice reads value on ${line.slice(0, 2)}'s line as the start of a formula`]]);
      expect(found[0]!.fixes.map((f) => f.label), line).toEqual(['Rename the node value to val']);
      expect(applyFix(net(line), found[0]!.fixes[0]!), line).toBe(net(fixed).replace('R2 mid value', 'R2 mid val').replace('R3 value', 'R3 val'));
      expect(valueTraps(applyFix(net(line), found[0]!.fixes[0]!)).filter((t) => t.id === 'fatal-syntax'), line).toEqual([]);
    }
    const minus = valueTraps(net('E1 e 0 mid value 2'))[0]!;
    expect(minus.why).toBe("ngspice reads the word value as VALUE, the start of a formula, wherever it stands on an E or G line, so it takes 2 for E1's formula, which it can't read. A node can't be called value here: give it another name, such as val.");
    expect(minus.ngspice).toBe("ngspice stops with a fatal error: 'mal formed E source instance' (ngspice 42: 'mal formed E line'). [fatal-syntax-17, fatal-syntax-20]");
    expect(valueTraps(net('E1 value 0 mid 0 2'))[0]!.why).toContain('so it takes 0 mid 0 2 for E1\'s formula');
    // On a POLY line native ngspice stops at value; PlainSpice's engine at the POLY first. No "native ngspice 47 runs it".
    expect(valueTraps(net('E1 e 0 POLY(1) value 0 0 2'))[0]!.ngspice).toBe("Native ngspice stops with a fatal error: 'mal formed E source instance' (ngspice 42: 'mal formed E line'). PlainSpice's engine stops at the POLY first: 'XSPICE is required to run the 'poly' option'. [fatal-syntax-20]");
    // With braces after it ngspice runs the line, as the constant 2 V: a warning, and the rename (fatal-syntax-20).
    for (const line of ['E1 e 0 mid value {2}', 'E1 e 0 value 0 {2}']) {
      const braced = valueTraps(net(line));
      expect(braced.map((t) => [t.severity, t.title]), line).toEqual([['warning', "ngspice reads value on E1's line as the start of a formula"]]);
      expect(braced[0]!.ngspice).toBe("ngspice runs E1 as the formula {2} and says nothing: in one test E1 e 0 mid value {2} gave 2 V, whatever the voltage at mid. [fatal-syntax-20]");
      expect(braced[0]!.fixes.map((f) => f.label)).toEqual(['Rename the node value to val']);
    }
    // A formula after VALUE stays a formula, whatever nodes the circuit has; with no node called value, VALUE 2 is a constant to brace.
    expect(valueTraps(net('E1 e 0 x VALUE {v(mid)*2}'))).toEqual([]);
    expect(valueTraps(net('E1 e 0 VALUE={v(mid)*2}'))).toEqual([]);
    expect(said('E1 e 0 x VALUE 2')).toEqual(["fatal-syntax: ngspice can't read E1's formula without braces -> E1 e 0 x VALUE {2}"]);
  });
  it("CR2-5: one inside i(...)'s bracket is the source's name: 'unknown controlling source', after any other one's message (space-character-31)", () => {
    const net = (line: string): string => `* t\nV1 in 0 5\nVs in mid 0\nR1 mid out 1k\nR2 out 0 1k\n${line}\nRe e 0 1k\n.op\n.end\n`;
    const quote = (line: string): string => traps(net(line))[0]!.ngspice;
    // Native ngspice 47 and 42 print these (space-character-31; the critic's matrix).
    expect(quote(`B1 e 0 V=i(V${THIN}s)*1k`)).toBe("ngspice stops: 'unknown controlling source v___s'. [space-character-31]");
    expect(quote(`B1 e 0 V=i(Vs${THIN})*1k`)).toBe("ngspice stops: 'unknown controlling source vs___'. [space-character-31]");
    expect(quote(`B1 e 0 V=i(V${NBSP}s)*1k`)).toBe("ngspice stops: 'unknown controlling source v__s'. [space-character-31]");
    expect(quote(`E1 e 0 VALUE={i(V${THIN}s)*1k}`)).toBe("ngspice stops: 'unknown controlling source v___s'. [space-character-31]");
    // Before the name its bytes are spelled otherwise: only that ngspice stops.
    expect(quote(`B1 e 0 V=i(${THIN}Vs)*1k`)).toBe('ngspice stops with an error on this line. [space-character-29]');
    // Any other one comes first; a v of its own before one is still 'Undefined parameter [v]' (space-character-23).
    expect(quote(`B1 e 0 V=i(V${THIN}s)*${THIN}1k`)).toContain("'The internal check of parse tree … failed'");
    expect(quote(`B1 e 0 V=i(V${THIN}s)*1k+v${THIN}(out)`)).toBe("ngspice stops: 'Undefined parameter [v]'. [space-character-23]");
    expect(quote(`B1 e 0 V=v${THIN}*2`)).toBe("ngspice stops: 'Undefined parameter [v]'. [space-character-23]");
    // Taken out, the formula runs (space-character-31: e = 2.5 V).
    const t = traps(net(`B1 e 0 V=i(V${THIN}s)*1k`))[0]!;
    expect(applyFix(net(`B1 e 0 V=i(V${THIN}s)*1k`), t.fixes[0]!)).toBe(net('B1 e 0 V=i(Vs)*1k'));
  });
  it("CR2-2: a name only a formula reads, with a character ngspice keeps, and no part on it: an error saying ngspice stops ('singular matrix'), never 'without a message' (space-character-32, nbsp-8, invisible-character-68, look-alike-letter-19, non-ascii-node-26)", () => {
    const net = (name: string, line = 'B1 e 0 V=v(NAME)*2', parts = 'out'): string => `* t\nV1 in 0 5\nR1 in ${parts} 1k\nR2 ${parts} 0 1k\n${line.replace('NAME', name)}\nRe e 0 1k\n.op\n.end\n`;
    for (const [name, id, title, spelled, fact, fixLabel] of [
      [`out${NBSP}`, 'nbsp', 'out with a no-break space', 'out__', 'nbsp-8', 'Take it out: connect to node out'],
      [`o${THIN}ut`, 'space-character', 'out with a thin space', 'o___ut', 'space-character-32', 'Take it out: connect to node out'],
      [`out${ZW}`, 'invisible-character', 'out with a zero-width space', 'out___', 'invisible-character-68', 'Take it out: connect to node out'],
      [`${CYR_O}ut`, 'look-alike-letter', `${CYR_O}ut with the Cyrillic letter ${CYR_O}`, '__ut', 'look-alike-letter-19', 'Connect to node out'],
    ] as const) {
      const found = traps(net(name));
      expect(found.map((t) => [t.id, t.severity, t.title]), id).toEqual([[id, 'error', `B1's formula reads a node nothing connects to: ${title}`]]);
      expect(found[0]!.ngspice, id).toBe(`ngspice warns 'singular matrix: check node ${spelled}' and then stops: 'The operating point could not be simulated successfully'. No results. [${fact}]`);
      expect(found[0]!.why, id).toContain(`So the formula reads the node ${spelled}, not the node out, and no part connects to that node.`);
      expect(found[0]!.why, id).not.toContain('the parts on it');
      expect(found[0]!.fixes.map((f) => f.label), id).toEqual([fixLabel]);
      expect(applyFix(net(name), found[0]!.fixes[0]!), id).toBe(net('out'));
      // An E's formula too.
      expect(traps(net(name, 'E1 e 0 VALUE={v(NAME)*2}')).map((t) => [t.id, t.severity]), id).toEqual([[id, 'error']]);
      // With no node out for the parts, taking the character out would mend nothing: no fix.
      expect(traps(net(name, undefined, 'mid'))[0]!.fixes, id).toEqual([]);
    }
    // Turkish letters: no part is on a node ngspice spells ____k____, so "Rename çıkış to cikis" would leave it failing.
    const turk = traps(net(T));
    expect(turk.map((t) => [t.id, t.severity, t.title])).toEqual([['non-ascii-node', 'error', `B1's formula reads a node nothing connects to: ${T}`]]);
    expect(turk[0]!.ngspice).toBe("ngspice warns 'singular matrix: check node ____k____' and then stops: 'The operating point could not be simulated successfully'. No results. [non-ascii-node-26]");
    expect(turk[0]!.fixes).toEqual([]);
    // With the parts on cikis, the name was written for that node: the fix connects the formula to it.
    const there = traps(net(T, undefined, 'cikis'));
    expect(there[0]!.fixes.map((f) => f.label)).toEqual(['Connect to node cikis']);
    expect(applyFix(net(T, undefined, 'cikis'), there[0]!.fixes[0]!)).toBe(net('cikis', undefined, 'cikis'));
    // A part on the name: the words for a node the parts are on, as before (space-character-10).
    expect(traps(`* t\nV1 in 0 5\nR1 in o${THIN}ut 1k\nR2 o${THIN}ut 0 1k\n.op\n.end\n`)[0]!.ngspice).toContain('[space-character-10]');
    // So is a part after a plain .end, which ngspice reads (S25): native 47 and 42 give b = 10 V and 0 V, no singular matrix.
    const afterEnd = (name: string, parts: string): string => `* t\nV1 giris 0 10\nR1 giris out 1k\nR2 out 0 1k\nB1 b 0 V=v(${name})*2\nRb b 0 1k\n.op\n.end\n${parts}`;
    expect(traps(afterEnd(T, `R3 ${T} giris 1k\nR4 ${T} 0 1k\n`)).map((t) => [t.id, t.severity])).toEqual([['non-ascii-node', 'warning'], ['after-end', 'warning']]);
    expect(traps(afterEnd(`o${THIN}ut`, `R3 o${THIN}ut 0 1k\n`)).map((t) => [t.id, t.severity])).toEqual([['space-character', 'warning'], ['after-end', 'warning']]);
  });
  it('CR2-3: two spellings that differ only in capital letters on part lines are one node, as written: a warning, one name for both, and no dangling or floating words (non-ascii-node-27)', () => {
    const TC = 'Çıkış'; // Çıkış
    const divider = `* t\nV1 giris 0 10\nR1 giris ${TC} 1k\nR2 ${T} 0 1k\n.op\n.end\n`;
    const found = traps(divider);
    expect(found.map((t) => [t.id, t.severity, t.title])).toEqual([['non-ascii-node', 'warning', `ngspice spells node ${TC} and node ${T} as ____k____: one node`]]);
    expect(found[0]!.ngspice).toBe(`ngspice makes node ${TC} and node ${T} one node, without a message: in one test a divider written with both spellings gave 5 V at node ____k____, as written. [non-ascii-node-27]`);
    expect(found[0]!.fixes.map((f) => f.label)).toEqual([`Rename node ${TC} and node ${T} to Cikis`]);
    expect(applyFix(divider, found[0]!.fixes[0]!)).toBe('* t\nV1 giris 0 10\nR1 giris Cikis 1k\nR2 Cikis 0 1k\n.op\n.end\n');
    // A linear E's control node written with the capital: no "no DC path to ground" (the critic's ecap-ctl).
    const ecap = `* t\nV1 giris 0 10\nR1 giris ${T} 1k\nR2 ${T} 0 1k\nE1 e 0 ${TC} 0 2\nRe e 0 1k\n.op\n.end\n`;
    expect(traps(ecap).map((t) => [t.id, t.severity])).toEqual([['non-ascii-node', 'warning']]);
    expect(applyFix(ecap, traps(ecap)[0]!.fixes[0]!)).toContain('E1 e 0 cikis 0 2');
    // A part after .end that writes the capital: "Rename" and "Move .end to the bottom" give one circuit in either order.
    const after = `* t\nV1 giris 0 10\nR1 giris ${T} 1k\nR2 ${T} 0 1k\n.op\n.end\nR3 ${TC} 0 1k\n`;
    const step = (text: string, id: string): string => applyFix(text, traps(text).find((t) => t.id === id)!.fixes[0]!);
    const renameFirst = step(step(after, 'non-ascii-node'), 'after-end');
    const moveFirst = step(step(after, 'after-end'), 'non-ascii-node');
    expect(moveFirst).toBe(renameFirst);
    expect(moveFirst).toBe('* t\nV1 giris 0 10\nR1 giris cikis 1k\nR2 cikis 0 1k\n.op\nR3 cikis 0 1k\n.end\n');
    expect(traps(moveFirst)).toEqual([]);
    // Different letters ngspice spells alike stay the error; the spellings of one node keep one name.
    const mixed = `* t\nV1 giris 0 10\nR1 giris ${TC} 1k\nR2 ${T} 0 1k\nR3 çıkıç 0 1k\n.op\n.end\n`;
    const error = traps(mixed).find((t) => t.severity === 'error')!;
    expect(error.title).toBe(`Node ${TC}, node ${T} and node çıkıç are one node for ngspice`);
    expect(applyFix(mixed, error.fixes[0]!)).toBe('* t\nV1 giris 0 10\nR1 giris Cikis 1k\nR2 Cikis 0 1k\nR3 cikic 0 1k\n.op\n.end\n');
    // The drawing editor's rename of either spelling renames both: the circuit stays the one ngspice simulated.
    for (const node of [T, TC]) {
      const edited = applyEdit(buildSchematic(parseNetlist(divider)), { kind: 'rename-node', node, name: 'vout' });
      expect(edited.text, node).toContain('R1 giris vout 1k\nR2 vout 0 1k');
    }
  });
  it('X1: a part with an end on each of two spellings that differ only in capital letters has them joined by ngspice: the error, never "as this netlist means", and its fix gives each a name of its own (non-ascii-node-28)', () => {
    const TC = 'Çıkış'; // Çıkış
    const across = (part: string): string => `* t\nV1 in 0 10\nR1 in ${TC} 1k\n${part}\nR3 ${T} 0 1k\n.op\n.end\n`;
    // A resistor, a current source, a voltage source, and an E reading between the two spellings (native 47 and 42:
    // R2 carries 0 A, I1's 1 mA changes nothing, 'instance v2 is a shorted VSRC', E1 reads 0 V).
    for (const part of [`R2 ${TC} ${T} 1k`, `I1 ${TC} ${T} 1m`, `V2 ${TC} ${T} 1`, `E1 out 0 ${TC} ${T} 2\nRo out 0 1k`]) {
      const text = across(part);
      const found = traps(text);
      expect(found.map((t) => [t.id, t.severity, t.title]), part).toEqual([['non-ascii-node', 'error', `Node ${TC} and node ${T} are one node for ngspice`]]);
      expect(found[0]!.why, part).toContain('It simulates a different circuit from the one written here.');
      expect(found[0]!.why, part).not.toContain('as this netlist means');
      expect(found[0]!.fixes.map((f) => f.label), part).toEqual([`Write Cikis for ${TC} and cikis2 for ${T}`]);
      const fixed = applyFix(text, found[0]!.fixes[0]!);
      expect(fixed, part).toContain('R1 in Cikis 1k');
      expect(fixed, part).toContain('R3 cikis2 0 1k');
      expect(traps(fixed), part).toEqual([]);
    }
    expect(applyFix(across(`R2 ${TC} ${T} 1k`), traps(across(`R2 ${TC} ${T} 1k`))[0]!.fixes[0]!)).toBe('* t\nV1 in 0 10\nR1 in Cikis 1k\nR2 Cikis cikis2 1k\nR3 cikis2 0 1k\n.op\n.end\n');
    // A part after a plain .end, which ngspice reads (S25), joins them too.
    const after = `* t\nV1 in 0 10\nR1 in ${TC} 1k\nR3 ${T} 0 1k\n.op\n.end\nR2 ${TC} ${T} 1k\n`;
    expect(traps(after).filter((t) => t.id === 'non-ascii-node').map((t) => t.severity)).toEqual(['error']);
    // The drawing editor renames only the spelling picked, as the netlist names two nodes there.
    const edited = applyEdit(buildSchematic(parseNetlist(across(`R2 ${TC} ${T} 1k`))), { kind: 'rename-node', node: TC, name: 'vout' });
    expect(edited.text).toContain(`R1 in vout 1k\nR2 vout ${T} 1k\nR3 ${T} 0 1k`);
    expect(nodeReferences(parseNetlist(across(`R2 ${TC} ${T} 1k`)), TC).map((t) => t.text)).toEqual([TC, TC]);
    // Inside a subcircuit the names are its own: a part across there leaves the divider outside one node, as written.
    const inner = `* t\nV1 giris 0 10\nR1 giris ${TC} 1k\nR2 ${T} 0 1k\nX1 a sub\n.subckt sub p\nR9 ${TC} ${T} 1k\nR8 p 0 1k\n.ends\nVa a 0 1\n.op\n.end\n`;
    expect(traps(inner).filter((t) => t.id === 'non-ascii-node').map((t) => [t.severity, t.title])).toEqual([['warning', `ngspice spells node ${TC} and node ${T} as ____k____: one node`]]);
  });
  it('X4, P3: the formula-only and case-group words name nodes by the node-words rule ("node out", never bare, never "the node node1")', () => {
    const TC = '\u00c7\u0131k\u0131\u015f'; // Çıkış
    const net = (name: string, parts = 'out'): string => `* t\nV1 ${parts} 0 1\nR1 ${parts} 0 1k\nB1 b 0 V=v(${name})*2\nR2 b 0 1k\n.op\n.end\n`;
    // [formula's name, the parts' node, the fix, the end of the why]
    for (const [name, parts, label, why] of [
      [`${CYR_O}ut`, 'out', 'Connect to node out', 'So the formula reads the node __ut, not the node out, and no part connects to that node.'],
      [T, 'cikis', 'Connect to node cikis', 'So the formula reads the node ____k____, not the node cikis, and no part connects to that node.'],
      ['\u0131n', 'in', 'Connect to node in', 'So the formula reads the node __n, not the node in, and no part connects to that node.'],
      // Beside an ordinary node called ground, quoted as the ground-misnamed check quotes it.
      [`gr${CYR_O}und`, 'ground', 'Connect to node "ground"', 'So the formula reads the node gr__und, not the node "ground", and no part connects to that node.'],
      ['\u011fround', 'ground', 'Connect to node "ground"', 'So the formula reads the node __round, not the node "ground", and no part connects to that node.'],
      // A name that says node goes alone.
      [`node1${ZW}`, 'node1', 'Take it out: connect to node1', 'So the formula reads node1___, not node1, and no part connects to that node.'],
    ] as const) {
      const found = traps(net(name, parts)).find((t) => t.severity === 'error')!;
      expect(found.fixes.map((f) => f.label), name).toEqual([label]);
      expect(found.why, name).toContain(why);
      expect(found.why, name).not.toMatch(/node node1|the node node/);
    }
    // The case group: its why and what ngspice does name both spellings as nodes, as its title does.
    const group = traps(`* t\nV1 in 0 10\nR1 in ${TC} 1k\nR2 ${T} 0 1k\n.op\n.end\n`)[0]!;
    expect(group.why.startsWith(`Node ${TC} and node ${T} differ only in capital letters`)).toBe(true);
    expect(group.why).toContain('Its printout and results call the node ____k____');
    expect(group.ngspice.startsWith(`ngspice makes node ${TC} and node ${T} one node`)).toBe(true);
    expect(group.ngspice).toContain('gave 5 V at node ____k____, as written');
    // Names that say node keep their own words: never "node Node\u00e7".
    const nodes = traps('* t\nV1 in 0 10\nR1 in Node\u00e7 1k\nR2 node\u00c7 0 1k\n.op\n.end\n')[0]!;
    for (const text of [nodes.title, nodes.why, nodes.ngspice, ...nodes.fixes.map((f) => f.label)]) expect(text).not.toMatch(/node node|the node node/i);
    // A node called value keeps "the node value", the form of "name the node out": no bare name.
    const value = traps('* t\nV1 in 0 5\nR1 in value 1k\nR2 value 0 1k\nE1 e 0 value 0 2\nRe e 0 1k\n.op\n.end\n').find((t) => t.id === 'fatal-syntax')!;
    expect(value.fixes.map((f) => f.label)).toEqual(['Rename the node value to val']);
  });
});

describe('a rename fix and the drawing editor\'s rename apply their changes in one pass (the integration check, X5)', () => {
  const traps = (text: string) => checkTraps(parseNetlist(text));
  // The splices from the end that applyFix and applyChanges made before: the results must stay the same.
  const spliced = (text: string, changes: readonly TextChange[]): string => {
    let out = text;
    for (const c of [...changes].sort((a, b) => b.from - a.from || b.to - a.to)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
    return out;
  };
  it('gives what the splices gave, for changes at one place, side by side and overlapping alike', () => {
    let seed = 7;
    const next = (n: number): number => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
    for (let trial = 0; trial < 3000; trial++) {
      const text = 'abcdefghijklmnopqrstuvwxyz0123'.slice(0, 1 + next(30));
      const changes: TextChange[] = [];
      for (let k = next(6); k > 0; k--) {
        const from = next(text.length + 1);
        const to = trial % 5 === 0 ? from + next(4) : Math.min(text.length, from + next(3));
        changes.push({ from, to: trial % 97 === 0 ? from - 1 : to, insert: ['', 'X', 'YZ', 'çıkış'][next(4)]! });
      }
      const want = spliced(text, changes);
      expect(applyFix(text, { label: 'fix', changes }), JSON.stringify([text, changes])).toBe(want);
      expect(applyChanges(text, changes), JSON.stringify([text, changes])).toBe(want);
    }
    // At one place the later change's words come first; an insertion goes before a replacement that starts there.
    expect(applyChanges('xy', [{ from: 1, to: 1, insert: 'A' }, { from: 1, to: 1, insert: 'B' }])).toBe('xBAy');
    expect(applyChanges('xyz', [{ from: 1, to: 2, insert: 'R' }, { from: 1, to: 1, insert: 'I' }])).toBe('xIRz');
  });
  it('takes work in step with the changes: thousands of v(çıkış) in one formula, renamed by the fix and on the drawing', () => {
    const formula = (n: number, word: string): string => `* t\nV1 in 0 1\nR1 in ${T} 1k\nR2 ${T} 0 1k\nB1 b 0 V=${Array(n).fill(word).join('+')}\nRb b 0 1k\n.op\n.end\n`;
    const fixOf = (text: string) => traps(text).find((t) => t.id === 'non-ascii-node')!.fixes[0]!;
    const big = formula(16000, `v(${T})`);
    const bigFix = fixOf(big);
    expect(bigFix.changes.length).toBe(16002);
    expect(applyFix(big, bigFix)).not.toContain(T);
    // 3e61833 spliced 16,002 changes in 1,945 ms of processor time (load 1.7); in one pass it takes a few.
    const [once] = leastWorkMs([() => applyFix(big, bigFix)], 3);
    expect(once).toBeLessThan(200);
    // A quarter of the changes takes about a quarter of the work, not a sixteenth (each timed 10 times over).
    const small = formula(4000, `v(${T})`);
    const smallFix = fixOf(small);
    const [quarter, whole] = leastWorkMs([() => { for (let k = 0; k < 10; k++) applyFix(small, smallFix); }, () => { for (let k = 0; k < 10; k++) applyFix(big, bigFix); }], 3);
    expect(whole).toBeLessThan(Math.max(10 * quarter, 40));
    // The drawing editor's rename of node in, read 8,000 times by one formula: 1,146 ms at 3e61833, about 17 now.
    const editor = `* t\nV1 in 0 1\nR1 in out 1k\nR2 out 0 1k\nB1 b 0 V=${Array(8000).fill('v(in)\u2009*\u20092').join('+')}\nRb b 0 1k\n.op\n.end\n`;
    const s = buildSchematic(editor);
    let renamed = '';
    const [edit] = leastWorkMs([() => (renamed = applyEdit(s, { kind: 'rename-node', node: 'in', name: 'vin' }).text)], 3);
    expect(renamed.match(/v\(vin\)/g)?.length).toBe(8000);
    expect(edit).toBeLessThan(400);
    // A node named bare 40,000 times on .save, in a text with a letter outside ASCII: 8,134 ms at 3e61833, about 110 now.
    const saved = `* t\u0131\nV1 a 0 1\nR1 a b 1k\nR2 b 0 1k\n.op\n.save ${Array(40000).fill('a').join(' ')}\n.end\n`;
    const s2 = buildSchematic(saved);
    let savedText = '';
    const [save] = leastWorkMs([() => (savedText = applyEdit(s2, { kind: 'rename-node', node: 'a', name: 'vin' }).text)], 1);
    expect(savedText.match(/\bvin\b/g)?.length).toBe(40003);
    expect(save).toBeLessThan(1500);
  });
});
