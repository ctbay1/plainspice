/**
 * The netlist parser and the element catalog. Each behaviour tested here was checked by running
 * native ngspice 47, native ngspice 42 and our WebAssembly engine on the same netlist
 * (docs/spice-facts/numbers-and-syntax.md; the engine runs are tests/golden/facts-numbers.test.ts).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ELEMENTS, EXPLAINED_LETTERS, elementInfo, fieldLabel } from '../../src/spice/elements.ts';
import { lowerAscii, parseNetlist, partParameter } from '../../src/spice/parse.ts';
import type { Element, FieldRole, LineKind, Netlist } from '../../src/spice/types.ts';
import { leastWorkMs } from './work-time.ts';

const root = resolve(import.meta.dirname, '../..');

const kinds = (n: Netlist): LineKind[] => n.lines.map((l) => l.kind);
const element = (n: Netlist, key: string): Element => {
  const found = n.lines.find((l) => l.element?.key === key)?.element;
  if (!found) throw new Error(`no element ${key}`);
  return found;
};
const roles = (e: Element): string[] => e.fields.map((f) => `${f.role}:${f.token.text}`);
const nodeNames = (e: Element): string[] => e.nodes.map((r) => r.name);
const valueOf = (e: Element): number | undefined => e.value?.number?.value;

/** Every token of every line, field and node is an exact slice of the netlist. */
function expectExactSpans(n: Netlist): void {
  const { text } = n;
  for (const line of n.lines) {
    expect(text.slice(line.span.from, line.span.to)).toBe(line.text);
    expect(line.text.includes('\n')).toBe(false);
    for (const t of line.tokens) {
      expect(text.slice(t.from, t.to), JSON.stringify(t)).toBe(t.text);
      expect(t.to).toBeGreaterThan(t.from);
      expect(t.from).toBeGreaterThanOrEqual(line.span.from);
    }
    for (let k = 1; k < line.tokens.length; k++) expect(line.tokens[k]!.from).toBeGreaterThanOrEqual(line.tokens[k - 1]!.to);
    if (line.element) {
      for (const f of line.element.fields) expect(text.slice(f.token.from, f.token.to)).toBe(f.token.text);
      for (const r of line.element.nodes) expect(line.element.fields.some((f) => f.token === r.token)).toBe(true);
    }
    if (line.continues !== undefined) expect(line.continues).toBeLessThan(line.index);
  }
  for (const [key, info] of n.nodes) {
    expect(info.name).toBe(key);
    expect(info.ground).toBe(key === '0');
    for (const c of info.connections) expect(n.lines[c.line]?.element?.key).toBe(c.element);
  }
  expect(n.elements).toEqual(n.lines.filter((l) => l.kind === 'element').map((l) => l.index));
  expect(n.directives).toEqual(n.lines.filter((l) => l.kind === 'directive').map((l) => l.index));
}

describe('lines: what each line is', () => {
  it('reads line 1 as the title whatever it says (a part there disappears)', () => {
    const n = parseNetlist('V1 n1 0 6\nR1 n1 0 2\n.op\n.end\n');
    expect(kinds(n)).toEqual(['title', 'element', 'directive', 'directive', 'blank']);
    expect(n.elements).toEqual([1]);
    expect(n.lines[0]!.tokens).toEqual([]);
  });

  it('reads a blank first line as the title, and a dot command there too', () => {
    expect(kinds(parseNetlist('\nV1 n1 0 6\n.op'))).toEqual(['title', 'element', 'directive']);
    const n = parseNetlist('.op\nV1 n1 0 6\nR1 n1 0 2\n.end');
    expect(n.lines[0]!.kind).toBe('title');
    expect(n.analyses).toEqual([]);
  });

  it('stops at a first line starting with @: nothing at all is read', () => {
    const n = parseNetlist('@ title\nV1 n1 0 6\n* note\nR1 n1 0 2\n.op\n.end');
    expect(kinds(n)).toEqual(['invalid', 'after-end', 'comment', 'after-end', 'after-end', 'after-end']);
    expect(n.elements).toEqual([]);
  });

  it('reads comment lines: *, #, ;, the odd first characters, and whole-line //', () => {
    const n = parseNetlist(['t', '* star', '# hash', '; semicolon', '$ dollar', '! bang', '% p', '( p', '= e', '" q', '[ b', '] b', '? q', ': c', ', c', '& a', '// slashes', '\f form feed'].join('\n'));
    expect(kinds(n).slice(1)).toEqual(Array(17).fill('comment'));
  });

  it('reads *# and ## lines as commands, which ngspice runs even outside .control', () => {
    expect(kinds(parseNetlist('t\n*# echo hi\n## echo x\n#* not a command'))).toEqual(['title', 'control', 'control', 'comment']);
  });

  it('reads everything between .control and .endc as control lines', () => {
    const n = parseNetlist('t\nR1 a 0 1\n.control\n* note\nR2 a 0 2\nrun\n+ more\n.endc\n.op');
    expect(kinds(n)).toEqual(['title', 'element', 'control', 'comment', 'control', 'control', 'continuation', 'control', 'directive']);
    expect(n.elements).toEqual([1]);
    expect(n.lines[6]!.continues).toBe(5);
  });

  it('reads directives, parts and invalid lines by their first character', () => {
    const n = parseNetlist('t\n.tran 1u 1m\nr1 a 0 1\n1abc\n-x\n_y\n/z\né1 a 0 1\n\u00b51 a 0 1');
    expect(kinds(n)).toEqual(['title', 'directive', 'element', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'element']);
    expect(element(n, 'u1').letter).toBe('U');
  });

  it('ignores leading spaces and tabs', () => {
    const n = parseNetlist('t\n   R1 n1 0\n\t+ 2\n   * c\n  .op');
    expect(kinds(n)).toEqual(['title', 'element', 'continuation', 'comment', 'directive']);
    expect(valueOf(element(n, 'r1'))).toBe(2);
  });

  it('marks lines after .end (any case, also ".end;comment") as after-end; blanks and comments keep their kind', () => {
    for (const end of ['.end', '.END', '.end;the end', '.end ; x', '.end\tx']) {
      const n = parseNetlist(`t\nR1 a 0 2\n.op\n${end}\nR2 a 0 2\n* c\n\n+ 3\n.op`);
      expect(kinds(n), end).toEqual(['title', 'element', 'directive', 'directive', 'after-end', 'comment', 'blank', 'after-end', 'after-end']);
      expect(n.end).toBe(3);
      expect(n.elements).toEqual([1]);
      expect(n.analyses).toEqual([2]);
    }
  });

  it('does not take .ends, .endc or .endl for .end', () => {
    const n = parseNetlist('t\n.subckt s a b\nR1 a b 1\n.ends\n.endl\nR2 x 0 1\n.end');
    expect(n.end).toBe(6);
    expect(kinds(n)).toEqual(['title', 'directive', 'element', 'directive', 'directive', 'element', 'directive']);
  });

  it('stops at a line starting with @ (also indented): it is invalid and the rest is after-end', () => {
    const n = parseNetlist('t\nI1 0 n1 1\nR1 n1 0 2\n.op\n   @ anything\nR2 n1 0 2\n.end');
    expect(kinds(n)).toEqual(['title', 'element', 'element', 'directive', 'invalid', 'after-end', 'after-end']);
    expect(n.end).toBeUndefined();
  });

  it('keeps one NetlistLine per physical line, numbered from 1, without the line break', () => {
    const n = parseNetlist('t\r\nR1 a 0 1\r\n\r\n.op');
    expect(n.lines.map((l) => [l.number, l.text])).toEqual([
      [1, 't'],
      [2, 'R1 a 0 1'],
      [3, ''],
      [4, '.op'],
    ]);
  });
});

describe('end-of-line comments', () => {
  it('cuts at ; anywhere (with or without a space)', () => {
    const n = parseNetlist('t\nR1 n1 0 2;5\nR2 n2 0 3 ; 5');
    expect(valueOf(element(n, 'r1'))).toBe(2);
    expect(valueOf(element(n, 'r2'))).toBe(3);
    expect(n.lines[1]!.tokens.map((t) => t.text)).toEqual(['R1', 'n1', '0', '2']);
  });

  it('cuts at $ only after a space, tab or comma', () => {
    const n = parseNetlist('t\nR1 n1 0 2 $ 5\nR2 n2 0 3 $5\nR3 n3 0 4$ 5\nR4 n4 0 6,$ 5\nR5 n5 0 7\t$5');
    expect([1, 2, 3, 4, 5].map((k) => valueOf(element(n, `r${k}`)))).toEqual([2, 3, 5, 6, 7]);
    expect(roles(element(n, 'r3'))).toEqual(['name:R3', 'node:n3', 'node:0', 'value:4$', 'value:5']);
  });

  it('cuts at // but not at a single /', () => {
    const n = parseNetlist('t\nR1 n1 0 2 // 5\nR2 n2 0 3//5\nR3 n3 0 2 / 5');
    expect(valueOf(element(n, 'r1'))).toBe(2);
    expect(valueOf(element(n, 'r2'))).toBe(3);
    expect(roles(element(n, 'r3'))).toEqual(['name:R3', 'node:n3', 'node:0', 'value:2', 'other:/', 'other:5']);
  });

  it('does not cut at * or # in the middle of a line (ngspice stops: unknown parameter)', () => {
    const n = parseNetlist('t\nR1 n1 0 2 * 5\nR2 n1 0 2 # 5');
    expect(roles(element(n, 'r1')).slice(4)).toEqual(['other:*', 'other:5']);
    expect(roles(element(n, 'r2')).slice(4)).toEqual(['other:#', 'other:5']);
  });

  it('inside .control, takes $ as a comment only when a space follows', () => {
    const n = parseNetlist('t\n.control\nset x=$y $ comment\n.endc');
    expect(n.lines[2]!.tokens.map((t) => t.text)).toEqual(['set', 'x', '$y']);
  });
});

describe('continuation lines', () => {
  it('joins a + line to the line before it', () => {
    const n = parseNetlist('t\nI1 0 n1 1\nR1 n1 0\n+ 2\n.op');
    expect(n.lines[3]).toMatchObject({ kind: 'continuation', continues: 2 });
    const r1 = element(n, 'r1');
    expect(roles(r1)).toEqual(['name:R1', 'node:n1', 'node:0', 'value:2']);
    expect(r1.value!.token.from).toBe(n.lines[3]!.span.from + 2);
    expect(n.lines[3]!.tokens.map((t) => t.text)).toEqual(['2']);
  });

  it('skips *, #, $, // comment lines and blank lines in between', () => {
    const n = parseNetlist(['t', 'I1 0 n1 1', 'R1 n1 0', '* c', '', '+ 2', 'R2 n2 0', '# c', '+ 3', 'R3 n3 0', '$ c', '+ 4', 'R4 n4 0', '// c', '+ 5'].join('\n'));
    expect([1, 2, 3, 4].map((k) => valueOf(element(n, `r${k}`)))).toEqual([2, 3, 4, 5]);
  });

  it('loses the continuation into a ; or odd-character comment line in between (the part has no value)', () => {
    for (const comment of ['; c', '! c']) {
      const n = parseNetlist(`t\nI1 0 n1 1\nR0 n1 0 1k\nR1 n1 0\n${comment}\n+ 2\n.op`);
      expect(n.lines[5]).toMatchObject({ kind: 'continuation', continues: 4 });
      expect(element(n, 'r1').value).toBeUndefined();
      expect(n.lines[5]!.tokens.map((t) => t.text)).toEqual(['2']);
    }
  });

  it('gives a + line right after the title nothing to continue (ngspice ignores it silently)', () => {
    const n = parseNetlist('* t\n+ R1 n1 0 2\nI1 0 n1 1\nR2 n1 0 4');
    expect(n.lines[1]!.kind).toBe('continuation');
    expect(n.lines[1]!.continues).toBeUndefined();
    expect(n.elements).toEqual([2, 3]);
  });

  it('continues dot commands too', () => {
    const n = parseNetlist('t\nV1 in 0 1\n.dc V1 0 2\n+ 1\n.end');
    expect(n.lines[2]!.directive!.args.map((t) => t.text)).toEqual(['V1', '0', '2', '1']);
    expect(n.lines[3]!.tokens.map((t) => t.text)).toEqual(['1']);
  });

  it('joins the line after one ending in two backslashes, whatever that line starts with', () => {
    const n = parseNetlist('t\nI1 0 n1 1\nR1 n1 0 \\\\\n2\n.op');
    expect(n.lines[3]).toMatchObject({ kind: 'continuation', continues: 2 });
    expect(valueOf(element(n, 'r1'))).toBe(2);
    expect(n.lines[2]!.tokens.map((t) => t.text)).toEqual(['R1', 'n1', '0']);
  });

  it('loses line 2 when the title ends in two backslashes', () => {
    const n = parseNetlist('title \\\\\nI1 0 n1 1\nR1 n1 0 2');
    expect(n.lines[1]).toMatchObject({ kind: 'continuation' });
    expect(n.lines[1]!.continues).toBeUndefined();
    expect(n.elements).toEqual([2]);
  });
});

describe('words', () => {
  it('splits element lines where ngspice does: commas, = and the number rules', () => {
    const words = (s: string): string[] => parseNetlist(`t\n${s}`).lines[1]!.tokens.map((t) => t.text);
    expect(words('R1 n1,0 2')).toEqual(['R1', 'n1', '0', '2']);
    expect(words('R1 n1 0 1,5k')).toEqual(['R1', 'n1', '0', '1', '5k']);
    expect(words('R1 n1 0 r=2')).toEqual(['R1', 'n1', '0', 'r', '2']);
    expect(words('R1 n1 0 1d-3')).toEqual(['R1', 'n1', '0', '1d', '-3']);
    expect(words('R1 n1 0 1e-3')).toEqual(['R1', 'n1', '0', '1e-3']);
    expect(words('V1 in 0 PULSE(0 5 0 1u 1u 1 2)')).toEqual(['V1', 'in', '0', 'PULSE', '0', '5', '0', '1u', '1u', '1', '2']);
    expect(words('V1 in 0 PULSE (0, 5)')).toEqual(['V1', 'in', '0', 'PULSE', '0', '5']);
    expect(words('R1 a(1) 0 2')).toEqual(['R1', 'a(1', '0', '2']);
    expect(words('R1 a 0 {1k*2}')).toEqual(['R1', 'a', '0', '{1k*2}']);
    expect(words("R2 a 0 '2*3'")).toEqual(['R2', 'a', '0', "'2*3'"]);
  });

  it('splits other lines at blanks, commas, = and parentheses', () => {
    const n = parseNetlist('t\n.tf v(a,b) V1\n.model D1 D(Is=2.52n Rs=0.568)\n1x y');
    expect(n.lines[1]!.tokens.map((t) => t.text)).toEqual(['.tf', 'v', 'a', 'b', 'V1']);
    expect(n.lines[2]!.tokens.map((t) => t.text)).toEqual(['.model', 'D1', 'D', 'Is', '2.52n', 'Rs', '0.568']);
    expect(n.lines[3]!.tokens.map((t) => t.text)).toEqual(['1x', 'y']);
  });

  it('keeps a no-break space inside a word, as ngspice does', () => {
    const n = parseNetlist('t\nI1 0 n1 1\nR1 n1 0\u00a02');
    expect(roles(element(n, 'r1'))).toEqual(['name:R1', 'node:n1', 'node:0\u00a02']);
  });

  it('joins the two halves of a word around a carriage return (ngspice deletes it)', () => {
    const n = parseNetlist('t\nI1 0 n1 1\nR1 n1 0 2\r5\n.op');
    const r1 = element(n, 'r1');
    expect(r1.value!.token.text).toBe('2\r5');
    expect(valueOf(r1)).toBe(25);
    expectExactSpans(n);
  });
});

describe('fields of each part', () => {
  const n = parseNetlist(
    [
      'fields',
      'R1 a 0 2k',
      'C1 a 0 1u',
      'L1 a 0 1m',
      'V1 a 0 6',
      'V2 a 0 DC 6 AC 1 0',
      'I1 0 a 3',
      'E1 out1 0 c 0 2',
      'G1 0 out2 c 0 0.5',
      'F1 0 out3 Vs 3',
      'H1 out4 0 Vs 4',
      'K1 L1 L2 0.9',
      '.model dm D',
      'D1 a k dm',
      'Q1 c b e qm',
      'J1 d g s jm',
      'M1 d g s b nm w=1u l=2u',
      'X1 a b sub params: w=1',
      'B1 a 0 V=V(b)*2',
      'S1 a 0 c 0 sw',
      'W1 a 0 Vs csw',
      'T1 a 0 b 0 z0=50 td=1n',
      'O1 a 0 b 0 lmod',
      'U1 a b c um',
      'Y1 a 0 b 0 ym',
      'Z1 d g s zm',
      'A1 a b am',
      'N1 a b nm2',
      'P1 a b 0 c d 0 pm',
    ].join('\n'),
  );

  it.each([
    ['r1', ['name:R1', 'node:a', 'node:0', 'value:2k'], ['a', '0'], 2000],
    ['c1', ['name:C1', 'node:a', 'node:0', 'value:1u'], ['a', '0'], 1e-6],
    ['l1', ['name:L1', 'node:a', 'node:0', 'value:1m'], ['a', '0'], 1e-3],
    ['v1', ['name:V1', 'plus:a', 'minus:0', 'value:6'], ['a', '0'], 6],
    ['v2', ['name:V2', 'plus:a', 'minus:0', 'value:DC', 'value:6', 'source-function:AC', 'source-function:1', 'source-function:0'], ['a', '0'], 6],
    ['i1', ['name:I1', 'from:0', 'to:a', 'value:3'], ['0', 'a'], 3],
    ['e1', ['name:E1', 'plus:out1', 'minus:0', 'control-plus:c', 'control-minus:0', 'gain:2'], ['out1', '0', 'c', '0'], 2],
    ['g1', ['name:G1', 'from:0', 'to:out2', 'control-plus:c', 'control-minus:0', 'transconductance:0.5'], ['0', 'out2', 'c', '0'], 0.5],
    ['f1', ['name:F1', 'from:0', 'to:out3', 'control-source:Vs', 'gain:3'], ['0', 'out3'], 3],
    ['h1', ['name:H1', 'plus:out4', 'minus:0', 'control-source:Vs', 'transresistance:4'], ['out4', '0'], 4],
    ['k1', ['name:K1', 'other:L1', 'other:L2', 'value:0.9'], [], 0.9],
    ['d1', ['name:D1', 'plus:a', 'minus:k', 'model:dm'], ['a', 'k'], undefined],
    ['q1', ['name:Q1', 'node:c', 'node:b', 'node:e', 'model:qm'], ['c', 'b', 'e'], undefined],
    ['j1', ['name:J1', 'node:d', 'node:g', 'node:s', 'model:jm'], ['d', 'g', 's'], undefined],
    ['m1', ['name:M1', 'node:d', 'node:g', 'node:s', 'node:b', 'model:nm', 'parameter:w', 'parameter:1u', 'parameter:l', 'parameter:2u'], ['d', 'g', 's', 'b'], undefined],
    ['x1', ['name:X1', 'node:a', 'node:b', 'model:sub', 'parameter:params:', 'parameter:w', 'parameter:1'], ['a', 'b'], undefined],
    ['s1', ['name:S1', 'node:a', 'node:0', 'control-plus:c', 'control-minus:0', 'model:sw'], ['a', '0', 'c', '0'], undefined],
    ['w1', ['name:W1', 'node:a', 'node:0', 'control-source:Vs', 'model:csw'], ['a', '0'], undefined],
    ['t1', ['name:T1', 'node:a', 'node:0', 'node:b', 'node:0', 'parameter:z0', 'parameter:50', 'parameter:td', 'parameter:1n'], ['a', '0', 'b', '0'], undefined],
    ['o1', ['name:O1', 'node:a', 'node:0', 'node:b', 'node:0', 'model:lmod'], ['a', '0', 'b', '0'], undefined],
    ['u1', ['name:U1', 'node:a', 'node:b', 'node:c', 'model:um'], ['a', 'b', 'c'], undefined],
    ['z1', ['name:Z1', 'node:d', 'node:g', 'node:s', 'model:zm'], ['d', 'g', 's'], undefined],
    ['a1', ['name:A1', 'node:a', 'node:b', 'model:am'], ['a', 'b'], undefined],
    ['n1', ['name:N1', 'node:a', 'node:b', 'model:nm2'], ['a', 'b'], undefined],
  ] as const)('%s', (key, fields, nodes, value) => {
    const e = element(n, key);
    expect(roles(e)).toEqual(fields);
    expect(nodeNames(e)).toEqual(nodes);
    expect(valueOf(e)).toBe(value);
    expect(e.letter).toBe(key[0]!.toUpperCase());
  });

  it('records the controlling source of F, H and W as written', () => {
    expect(element(n, 'f1').controlSource?.text).toBe('Vs');
    expect(element(n, 'h1').controlSource?.text).toBe('Vs');
    expect(element(n, 'w1').controlSource?.text).toBe('Vs');
  });

  it('reads B, Y and P lines without failing (best effort)', () => {
    expect(nodeNames(element(n, 'b1'))).toEqual(['a', '0']);
    expect(nodeNames(element(n, 'y1'))).toEqual(['a', '0', 'b', '0']);
    expect(nodeNames(element(n, 'p1'))).toEqual(['a', 'b', '0', 'c', 'd', '0']);
  });

  it('finds the model of D, Q and M by its .model line, like ngspice', () => {
    const m = parseNetlist('t\n.model dm D\n.model qm NPN\nD1 a k t dm\nQ1 c b e s qm\nQ2 c b e qm');
    expect(roles(element(m, 'd1'))).toEqual(['name:D1', 'plus:a', 'minus:k', 'node:t', 'model:dm']);
    expect(nodeNames(element(m, 'q1'))).toEqual(['c', 'b', 'e', 's']);
    expect(nodeNames(element(m, 'q2'))).toEqual(['c', 'b', 'e']);
  });

  it('marks words ngspice cannot use on a source line as other (it stops with "unknown parameter")', () => {
    const m = parseNetlist('t\nV1 n1 0 1 k\nV2 n1 0 1,5\nV3 n1 0 1d-3');
    expect(roles(element(m, 'v1'))).toEqual(['name:V1', 'plus:n1', 'minus:0', 'value:1', 'other:k']);
    expect(roles(element(m, 'v2'))).toEqual(['name:V2', 'plus:n1', 'minus:0', 'value:1', 'other:5']);
    expect(roles(element(m, 'v3'))).toEqual(['name:V3', 'plus:n1', 'minus:0', 'value:1d', 'other:-3']);
  });

  // ngspice 47's parameter tables for R, C, L, E, F, G and H (unknown-word-1 ... -11 in traps.md).
  it('knows the settings of R, C, L, E, F, G and H, and marks any other word other', () => {
    const m = parseNetlist(
      't\nR1 a 0 1k load\nR2 a 0 1k tc1=1m m=2 ac=2k\nR3 a 0 1k tc=0.1 0.2\nR4 a 0 1k i\nC1 a 0 1u big\nC2 a 0 1u ic=1 m=2\nL1 a 0 1m v\nL2 a 0 1m ic=0 nt=5\n' +
        'E1 b 0 a 0 2 m\nG1 0 b a 0 2 m\nF1 0 b Vx 2 m\nH1 b 0 Vx 2 fast\nR5 a 0 1k 2k 3k',
    );
    expect(roles(element(m, 'r1')).slice(3)).toEqual(['value:1k', 'other:load']);
    expect(roles(element(m, 'r2')).slice(3)).toEqual(['value:1k', 'parameter:tc1', 'parameter:1m', 'parameter:m', 'parameter:2', 'parameter:ac', 'parameter:2k']);
    // "tc=a b" is read as tc1=a tc2=b (inp2r.c).
    expect(roles(element(m, 'r3')).slice(3)).toEqual(['value:1k', 'parameter:tc', 'parameter:0.1', 'parameter:0.2']);
    // i, p, v ... can only be reported, not set.
    expect(roles(element(m, 'r4')).slice(3)).toEqual(['value:1k', 'other:i']);
    expect(roles(element(m, 'c1')).slice(3)).toEqual(['value:1u', 'other:big']);
    expect(roles(element(m, 'c2')).slice(3)).toEqual(['value:1u', 'parameter:ic', 'parameter:1', 'parameter:m', 'parameter:2']);
    expect(roles(element(m, 'l1')).slice(3)).toEqual(['value:1m', 'other:v']);
    expect(roles(element(m, 'l2')).slice(3)).toEqual(['value:1m', 'parameter:ic', 'parameter:0', 'parameter:nt', 'parameter:5']);
    // G and F have a multiplier m; E and H do not.
    expect(roles(element(m, 'e1')).slice(5)).toEqual(['gain:2', 'other:m']);
    expect(roles(element(m, 'g1')).slice(5)).toEqual(['transconductance:2', 'parameter:m']);
    expect(roles(element(m, 'f1')).slice(4)).toEqual(['gain:2', 'parameter:m']);
    expect(roles(element(m, 'h1')).slice(4)).toEqual(['transresistance:2', 'other:fast']);
    expect(roles(element(m, 'r5')).slice(3)).toEqual(['value:1k', 'value:2k', 'other:3k']);
    expect(element(m, 'r5').value?.token.text).toBe('2k');
    expect([partParameter('R', 'TC1'), partParameter('L', 'flux'), partParameter('C', 'load'), partParameter('D', 'area')]).toEqual(['setting', 'report-only', 'unknown', undefined]);
  });
});

describe('the value ngspice uses', () => {
  const value = (line: string): number | undefined => valueOf(parseNetlist(`t\n${line}`).lines[1]!.element!);

  it('takes the second of two numbers on a resistor line ("1,5k" is 5 kΩ)', () => {
    expect(value('R1 n1 0 1,5k')).toBe(5000);
    expect(value('R1 n1 0 1 2')).toBe(2);
    expect(value('R1 n1 0 1k-2')).toBe(-2);
    expect(value('R1 n1 0 1d-3')).toBe(-3);
    const e = parseNetlist('t\nR1 n1 0 1,5k').lines[1]!.element!;
    expect(roles(e)).toEqual(['name:R1', 'node:n1', 'node:0', 'value:1', 'value:5k']);
    expect(e.value!.token.text).toBe('5k');
  });

  it('reads r=, c=, l= and resistance= as the value', () => {
    expect(value('R1 n1 0 r=2')).toBe(2);
    expect(value('C1 n1 0 c=1u')).toBe(1e-6);
    expect(value('L1 n1 0 l=1m')).toBe(1e-3);
    expect(value('R1 n1 0 resistance=5')).toBe(5);
    expect(value('R1 n1 0 1 r=2')).toBe(2);
  });

  it('lets a plain number beat dc on a source line, and the last dc beat an earlier one', () => {
    expect(value('V1 n1 0 5 dc 6')).toBe(5);
    expect(value('V2 n2 0 dc 6 dc 7')).toBe(7);
    expect(value('V1 n1 0 dc=6')).toBe(6);
    expect(value('I1 0 n1 c=3')).toBe(3);
  });

  it('has no value for a source given only as a source function', () => {
    const e = parseNetlist('t\nV1 in 0 PULSE(0 5 0 1u 1u 1 2)').lines[1]!.element!;
    expect(e.value).toBeUndefined();
    expect(e.sourceFunction?.name).toBe('pulse');
    expect(e.sourceFunction?.token.text).toBe('PULSE');
    expect(e.sourceFunction?.args.map((t) => t.text)).toEqual(['0', '5', '0', '1u', '1u', '1', '2']);
  });

  it('reads "dc 0 trnoise(...)" as DC 0 with a source function', () => {
    const e = parseNetlist('t\nV1 a 0 dc 0 trnoise(20n 0.5n 0 0)').lines[1]!.element!;
    expect(valueOf(e)).toBe(0);
    expect(e.sourceFunction?.name).toBe('trnoise');
  });

  it('reads source functions with or without parentheses', () => {
    for (const line of ['V1 n1 0 PULSE(2 5 0 1u 1u 1 2)', 'V1 n1 0 PULSE (2 5 0 1u 1u 1 2)', 'V1 n1 0 pulse 2 5 0 1u 1u 1 2']) {
      const e = parseNetlist(`t\n${line}`).lines[1]!.element!;
      expect(e.sourceFunction?.args.map((t) => t.text), line).toEqual(['2', '5', '0', '1u', '1u', '1', '2']);
    }
  });

  it('has no value when it is missing', () => {
    expect(value('R1 a 0')).toBeUndefined();
    expect(value('V1 a 0')).toBeUndefined();
    expect(value('E1 a 0 b 0')).toBeUndefined();
  });

  it('keeps the reading of the value: scale letters and ignored letters', () => {
    const e = parseNetlist('t\nR1 n1 n2 1MOhm').lines[1]!.element!;
    expect(e.value!.number).toMatchObject({ value: 1e-3, scale: { letters: 'M', name: 'milli' }, ignored: 'Ohm' });
    expect(parseNetlist('t\nR1 a 0 {1k*2}').lines[1]!.element!.value).toEqual({ token: expect.objectContaining({ text: '{1k*2}' }) });
  });
});

describe('nodes', () => {
  it('reads 0 and gnd in any case as ground, listed under "0"', () => {
    const n = parseNetlist('t\nV1 a gnd 6\nR1 a GND 2\nV2 b Gnd 3\nR2 b 0 3\n.op');
    expect([...n.nodes.keys()]).toEqual(['a', '0', 'b']);
    const ground = n.nodes.get('0')!;
    expect(ground.ground).toBe(true);
    expect(ground.refs.map((t) => t.text)).toEqual(['gnd', 'GND', 'Gnd', '0']);
    expect(ground.connections.map((c) => [c.element, c.role])).toEqual([
      ['v1', 'minus'],
      ['r1', 'node'],
      ['v2', 'minus'],
      ['r2', 'node'],
    ]);
  });

  it('keeps gnd as an ordinary node when it is the last word of its line, as ngspice does', () => {
    for (const line of ['Vx b gnd', 'Vx b gnd   ', 'Vx b gnd ; ammeter']) {
      const n = parseNetlist(`t\nV1 a 0 6\nR1 a b 2\n${line}\n.op`);
      expect(nodeNames(element(n, 'vx')), line).toEqual(['b', 'gnd']);
      expect(n.nodes.get('gnd')?.ground).toBe(false);
    }
    const continued = parseNetlist('t\nV1 a 0 6\nR1 a b 2\nVx b gnd\n+ 0\n.op');
    expect(element(continued, 'vx').nodes[1]).toMatchObject({ name: '0', ground: true });
  });

  it('reads ground and 00 as ordinary nodes', () => {
    expect(nodeNames(element(parseNetlist('t\nV1 a ground 6'), 'v1'))).toEqual(['a', 'ground']);
    expect(nodeNames(element(parseNetlist('t\nV1 a 00 6'), 'v1'))).toEqual(['a', '00']);
  });

  it('ignores capital letters in node names (ASCII only, like ngspice)', () => {
    const n = parseNetlist('t\nV1 N1 0 6\nR1 n1 0 2\nR2 Ü1 0 1\nR3 ü1 0 1');
    expect(n.nodes.get('n1')!.connections).toHaveLength(2);
    expect(n.nodes.has('Ü1')).toBe(true);
    expect(n.nodes.has('ü1')).toBe(true);
  });

  it('lists every terminal and every reference, including nodes named in directives', () => {
    const n = parseNetlist('t\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\nR3 n1 a 2\n.tf v(a) V1\n.print dc v(n9)');
    expect(n.nodes.get('n1')!.connections.map((c) => `${c.element}:${c.role}`)).toEqual(['r1:node', 'r2:node', 'r3:node']);
    expect(n.nodes.get('a')!.refs.map((t) => t.text)).toEqual(['a', 'a']);
    expect(n.nodes.get('a')!.connections).toHaveLength(1);
    expect(n.nodes.get('n9')).toMatchObject({ connections: [], refs: [expect.objectContaining({ text: 'n9' })] });
  });

  it('leaves the local nodes of a subcircuit out', () => {
    const n = parseNetlist('t\n.subckt div in out\nR1 in out 1k\nR2 out 0 1k\n.ends\nX1 a b div\nV1 a 0 1');
    expect([...n.nodes.keys()]).toEqual(['a', 'b', '0']);
  });

  it('lists the element lines, directives, analyses and the .end line', () => {
    const n = parseNetlist('t\nV1 a 0 1\nR1 a 0 1\n.options savecurrents\n.op\n.tran 1u 1m\n.dc V1 0 1 0.1\n.tf v(a) V1\n.ac dec 10 1 1k\n.end');
    expect(n.elements).toEqual([1, 2]);
    expect(n.directives).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(n.analyses).toEqual([4, 5, 6, 7, 8]);
    expect(n.end).toBe(9);
    expect(n.lines[3]!.directive).toMatchObject({ name: '.options', args: [expect.objectContaining({ text: 'savecurrents' })] });
  });
});

describe('fixtures', () => {
  const fixturesDir = join(root, 'tests/fixtures');
  const expected: Record<string, { parts: [string, string[], number | undefined][]; analyses: string[] }> = {
    'd1-dc-divider-sweep': { parts: [['v1', ['in', '0'], 0], ['r1', ['in', 'out'], 1000], ['r2', ['out', '0'], 2000]], analyses: ['.dc'] },
    'f1a-voltage-source': { parts: [['v1', ['n1', '0'], 6], ['r1', ['n1', '0'], 2]], analyses: ['.op'] },
    'f1b-voltage-source-swapped': { parts: [['v1', ['0', 'n1'], 6], ['r1', ['n1', '0'], 2]], analyses: ['.op'] },
    'f2a-current-source': { parts: [['i1', ['0', 'n1'], 3], ['r1', ['n1', '0'], 4]], analyses: ['.op'] },
    'f2b-current-source-swapped': { parts: [['i1', ['n1', '0'], 3], ['r1', ['n1', '0'], 4]], analyses: ['.op'] },
    'f3a-1M-trap': { parts: [['v1', ['n1', '0'], 6], ['r1', ['n1', 'n2'], 1e-3], ['r2', ['n2', '0'], 1e6]], analyses: ['.op'] },
    'f3b-1meg': { parts: [['v1', ['n1', '0'], 6], ['r1', ['n1', 'n2'], 1e6], ['r2', ['n2', '0'], 1e6]], analyses: ['.op'] },
    'f4-tf-output-impedance': {
      parts: [['v1', ['s', '0'], 24], ['r1', ['s', 'n1'], 6], ['r2', ['n1', '0'], 3], ['r3', ['n1', 'a'], 2]],
      analyses: ['.tf'],
    },
    'f5-thevenin-cccs': {
      parts: [['itest', ['0', 'a'], 1], ['vx', ['a', 'x'], 0], ['r2', ['x', 'n1'], 2], ['r1', ['n1', '0'], 4], ['f1', ['0', 'n1'], 2]],
      analyses: ['.op'],
    },
    't1-tran-rc-charge': { parts: [['v1', ['in', '0'], undefined], ['r1', ['in', 'out'], 1000], ['c1', ['out', '0'], 1e-6]], analyses: ['.tran'] },
  };
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.cir')).sort();

  it('covers every fixture', () => {
    expect(files.map((f) => f.replace(/\.cir$/, ''))).toEqual(Object.keys(expected).sort());
  });

  it.each(files)('%s', (file) => {
    const n = parseNetlist(readFileSync(join(fixturesDir, file), 'utf8'));
    expectExactSpans(n);
    const want = expected[file.replace(/\.cir$/, '')]!;
    expect(n.lines[0]!.kind).toBe('title');
    expect(n.elements.map((i) => n.lines[i]!.element!).map((e) => [e.key, nodeNames(e), valueOf(e)])).toEqual(want.parts);
    expect(n.analyses.map((i) => n.lines[i]!.directive!.name)).toEqual(want.analyses);
    expect(n.end).toBe(n.lines.findIndex((l) => l.text === '.end'));
    expect(kinds(n).filter((k) => k === 'invalid' || k === 'after-end' || k === 'continuation')).toEqual([]);
  });

  it('reads F5 like the channel: F1 pushes 2 x the current in Vx from ground into n1', () => {
    const n = parseNetlist(readFileSync(join(fixturesDir, 'f5-thevenin-cccs.cir'), 'utf8'));
    const f1 = element(n, 'f1');
    expect(roles(f1)).toEqual(['name:F1', 'from:0', 'to:n1', 'control-source:Vx', 'gain:2']);
    expect(n.nodes.get('n1')!.connections.map((c) => c.element)).toEqual(['r2', 'r1', 'f1']);
  });
});

/** The Solved Circuits episode netlists, when that repository is checked out next to this one. */
const designDir = '/home/user/solved-circuits/design';
function cirFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...cirFiles(p));
    else if (name.endsWith('.cir')) out.push(p);
  }
  return out.sort();
}

describe.skipIf(!existsSync(designDir))('the channel’s episode netlists (solved-circuits/design)', () => {
  const files = existsSync(designDir) ? cirFiles(designDir) : [];

  it('finds them', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('%s', (file) => {
    const n = parseNetlist(readFileSync(file, 'utf8'));
    expectExactSpans(n);
    expect(kinds(n).filter((k) => k === 'invalid' || k === 'after-end')).toEqual([]);
    expect(n.end).toBeDefined();
    for (const i of n.elements) {
      const e = n.lines[i]!.element!;
      const nodes = { R: 2, C: 2, L: 2, V: 2, I: 2, F: 2, H: 2, E: 4, G: 4 }[e.letter as string];
      if (nodes === undefined) continue;
      expect(e.nodes, e.key).toHaveLength(nodes);
      expect(e.value?.number, e.key).toBeDefined();
    }
  });
});

describe('robustness', () => {
  const pieces = [
    'R', 'V', 'I', 'C', 'L', 'E', 'F', 'G', 'H', 'K', 'D', 'Q', 'M', 'X', 'B', 'A', 'N', 'P', 'O', 'S', 'T', 'U', 'W', 'Y', 'Z', 'J',
    '0', '1', 'gnd', 'GND', ' ', ' ', '\t', '\r', '\n', '\n', '+', '-', '*', '/', '^', ',', '=', '(', ')', '{', '}', "'", '"', ';',
    '$', '#', '@', '.', '.end', '.control', '.endc', '.model', '.subckt', '.ends', '.tf', 'v(', '\u00b5', '\u03bc', '\u00a0', '\ufeff', '\\\\',
    'é', '\u{1f642}', '\ud800', '\u0000', '\f', 'k', 'meg', 'e-3', 'd-3', 'pulse', 'dc', 'ac', 'params:', '//', 'ı', 'İ',
  ];

  // About 0.4 s alone (random netlists, every span checked); 1.8 s at load 20 on 4 cores: 30 s.
  it('never throws, and every span is exact, on random netlists', () => {
    let seed = 20261109;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let round = 0; round < 1500; round++) {
      let text = '';
      const length = Math.floor(rnd() * 160);
      for (let i = 0; i < length; i++) text += pieces[Math.floor(rnd() * pieces.length)];
      const n = parseNetlist(text);
      expect(n.lines).toHaveLength(text.split('\n').length);
      expectExactSpans(n);
    }
  }, 30_000);

  it('copes with empty input, a lone newline, unicode and very long lines', () => {
    expect(kinds(parseNetlist(''))).toEqual(['title']);
    expect(kinds(parseNetlist('\n'))).toEqual(['title', 'blank']);
    const long = parseNetlist(`t\nR1 a b ${'9'.repeat(100_000)}\n${'x'.repeat(100_000)}\n\u{1f642} \ud83d\n`);
    expect(kinds(long)).toEqual(['title', 'element', 'element', 'invalid', 'blank']);
    expect(valueOf(element(long, 'r1'))).toBe(Number.POSITIVE_INFINITY);
    expectExactSpans(long);
  });

  // About 30 ms of work here for 10 000 lines and twice that on GitHub's runners, so the time limit is
  // generous; the scaling check catches a parser that slows down with length: quadratic work makes 10 000
  // lines at once about ten times the work of ten netlists of 1 000 lines, and here it may be at most 2.5
  // times (as before: 25 times the work of one netlist of 1 000). Timed as the work it is (work-time.ts:
  // the processor time, not the clock, which on a busy machine counts the wait for a processor), the
  // least of five tries of each, taken in turns. Not by the clock: at load 25 the larger netlist,
  // waiting more often, came out 30 times slower than one tenth of it (190 ms against 158).
  // Five tries of 20 000 lines: 0.3 s alone, 3.2 s at load 20 on 4 cores: 30 s.
  it('parses 10 000 lines quickly, in time proportional to their number', () => {
    const netlist = (count: number): string => {
      const lines = ['* many lines'];
      for (let i = 0; i < count; i++) {
        lines.push(
          i % 4 === 0 ? `R${i} n${i} n${i + 1} 1k` : i % 4 === 1 ? `V${i} n${i} 0 PULSE(0 5 0 1u 1u 1 2)` : i % 4 === 2 ? `+ ; note ${i}` : `* comment ${i}`,
        );
      }
      return lines.join('\n');
    };
    const small = netlist(1000);
    const large = netlist(10_000);
    const parsed: Netlist[] = [];
    parseNetlist('* warm-up\nR1 a 0 1k\nV1 a 0 PULSE(0 5 0 1u 1u 1 2)\n.op\n.end');
    const [tenSmall, oneLarge] = leastWorkMs(
      [
        () => {
          for (let k = 0; k < 10; k++) parsed.push(parseNetlist(small));
        },
        () => {
          parsed.push(parseNetlist(large));
        },
      ],
      5,
    );
    // Each parse is whole: 500 parts in each small netlist, 5000 in the large one.
    expect(new Set(parsed.map((n) => n.elements.length))).toEqual(new Set([500, 5000]));
    expect(oneLarge).toBeLessThan(400);
    expect(oneLarge).toBeLessThan(2.5 * tenSmall);
  }, 30_000);
});

describe('lowerAscii', () => {
  it('lower-cases ASCII letters only', () => {
    expect(lowerAscii('R1 N1 GND')).toBe('r1 n1 gnd');
    expect(lowerAscii('ÜİK')).toBe('Üİk');
    expect(lowerAscii('abc')).toBe('abc');
  });
});

describe('element catalog', () => {
  it('has all 26 letters, and nothing for digits or punctuation', () => {
    expect(ELEMENTS.map((e) => e.letter).join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    for (const c of ['0', '1', '9', '*', '+', '.', '#', '$', ';', '@', '-', '_', '/', '{', 'é', '']) expect(elementInfo(c), c).toBeUndefined();
    expect(elementInfo('r')).toBe(elementInfo('R'));
  });

  it('explains R, C, L, V, I, E, F, G and H fully', () => {
    expect(EXPLAINED_LETTERS).toEqual(['C', 'E', 'F', 'G', 'H', 'I', 'L', 'R', 'V']);
  });

  it('names the parts and their units in plain words', () => {
    expect(elementInfo('F')).toMatchObject({ name: 'current-controlled current source', code: 'CCCS', unit: { ratio: 'A/A' } });
    expect(elementInfo('E')).toMatchObject({ code: 'VCVS', unit: { symbol: '', ratio: 'V/V' } });
    expect(elementInfo('G')).toMatchObject({ code: 'VCCS', unit: { symbol: 'S', name: 'siemens', ratio: 'A/V' } });
    expect(elementInfo('H')).toMatchObject({ code: 'CCVS', unit: { symbol: 'Ω', name: 'ohm', ratio: 'V/A' } });
    expect(['R', 'C', 'L', 'V', 'I'].map((l) => elementInfo(l)!.unit!.symbol)).toEqual(['Ω', 'F', 'H', 'V', 'A']);
  });

  it('uses the channel’s field words', () => {
    // Display text uses the true minus sign (U+2212).
    expect(elementInfo('V')!.fields).toEqual(['name', '+ node', '\u2212 node', 'value']);
    expect(elementInfo('I')!.fields).toEqual(['name', 'from node', 'to node', 'current']);
    expect(elementInfo('R')!.fields).toEqual(['name', 'node', 'node', 'value']);
  });

  it('says what ngspice needs, and what our engine leaves out (checked by running it)', () => {
    for (const l of ['D', 'Q', 'J', 'M', 'Z']) expect(elementInfo(l)!.needs, l).toMatch(/\.model/);
    expect(elementInfo('X')!.needs).toMatch(/\.subckt/);
    expect(ELEMENTS.filter((e) => !e.inEngine).map((e) => e.letter)).toEqual(['A', 'N', 'O']);
  });

  it('labels the parser’s fields, so a line reads as its field table', () => {
    const table = (line: string): string[] => {
      const e = parseNetlist(`t\n${line}`).lines[1]!.element!;
      let node = 0;
      return e.fields.map((f) => {
        const isNode = e.nodes.some((r) => r.token === f.token);
        return fieldLabel(e.letter, f.role as FieldRole, isNode ? node++ : 0);
      });
    };
    expect(table('V1 n1 0 6')).toEqual(['name', '+ node', '\u2212 node', 'value']);
    expect(table('I1 0 n1 3')).toEqual(['name', 'from node', 'to node', 'current']);
    expect(table('E1 out1 0 c 0 2')).toEqual(['name', '+ node', '\u2212 node', 'control + node', 'control \u2212 node', 'gain']);
    expect(table('G1 0 out2 c 0 0.5')).toEqual(['name', 'from node', 'to node', 'control + node', 'control \u2212 node', 'amps per volt']);
    expect(table('F1 0 out3 Vs 3')).toEqual(['name', 'from node', 'to node', 'control source', 'gain']);
    expect(table('H1 out4 0 Vs 4')).toEqual(['name', '+ node', '\u2212 node', 'control source', 'volts per amp']);
    expect(table('Q1 c b e qm')).toEqual(['name', 'collector', 'base', 'emitter', 'model']);
    expect(table('X1 a b sub')).toEqual(['name', 'node', 'node', 'subcircuit']);
  });
});
