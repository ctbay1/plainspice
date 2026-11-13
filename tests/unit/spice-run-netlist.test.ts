import { describe, expect, it } from 'vitest';
import { leastWorkMs } from './work-time.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import {
  hasSaveCurrents,
  longestFullName,
  netlistToRun,
  RUN_COPY_WORDS,
  SAVE_CURRENTS_LINE,
  textToRun,
  utf8Bytes,
  whyNotRun,
} from '../../src/spice/run-netlist.ts';

const toRun = (text: string) => netlistToRun(parseNetlist(text));

describe('netlistToRun', () => {
  it('adds .options savecurrents just before .end for an operating point', () => {
    const r = toRun('* divider\nV1 a 0 10\nR1 a b 1k\nR2 b 0 1k\n.op\n.end\n');
    expect(r.text).toBe('* divider\nV1 a 0 10\nR1 a b 1k\nR2 b 0 1k\n.op\n.options savecurrents\n.end\n');
    expect(r.added).toEqual([SAVE_CURRENTS_LINE]);
  });

  it('keeps every line of the circuit at its line number', () => {
    const text = '* t\nV1 a 0 1\nR1 a 0 1\n.op\n.end\n';
    const before = text.split('\n');
    const after = toRun(text).text.split('\n');
    const end = before.indexOf('.end');
    expect(after.slice(0, end)).toEqual(before.slice(0, end));
  });

  it('leaves the text alone when it already saves currents, in any spelling', () => {
    for (const options of ['.options savecurrents', '.OPTIONS SaveCurrents', '.option savecurrents', '.opt reltol=1e-4 savecurrents', '.options reltol=1e-4\n+ savecurrents']) {
      const text = `* t\nV1 a 0 1\nR1 a 0 1\n${options}\n.op\n.end\n`;
      expect(hasSaveCurrents(parseNetlist(text)), options).toBe(true);
      expect(toRun(text), options).toEqual({ text, added: [], notes: [] });
    }
  });

  it('leaves the text alone when there is no .op', () => {
    for (const analysis of ['.tf v(a) V1', '.dc V1 0 1 0.5', '.tran 1u 10u', '']) {
      const text = `* t\nV1 a 0 1\nR1 a 0 1\n${analysis}\n.end\n`;
      expect(toRun(text), analysis).toEqual({ text, added: [], notes: [] });
    }
  });

  it('adds it once even with .op next to other analyses', () => {
    const r = toRun('* t\nV1 a 0 1\nR1 a 0 1\n.op\n.dc V1 0 1 1\n.end\n');
    expect(r.text.match(/savecurrents/g)).toHaveLength(1);
  });

  it('appends it when the netlist has no .end', () => {
    expect(toRun('* t\nV1 a 0 1\nR1 a 0 1\n.op').text).toBe('* t\nV1 a 0 1\nR1 a 0 1\n.op\n.options savecurrents\n');
    expect(toRun('* t\nV1 a 0 1\nR1 a 0 1\n.op\n').text).toBe('* t\nV1 a 0 1\nR1 a 0 1\n.op\n.options savecurrents\n');
  });

  it('puts it before the first .end, not after it or before .ends', () => {
    const r = toRun('* t\n.subckt half in out\nR1 in out 1\n.ends\nX1 a 0 half\nV1 a 0 1\n.op\n.END\n* notes\n.end\n');
    expect(r.text).toBe('* t\n.subckt half in out\nR1 in out 1\n.ends\nX1 a 0 half\nV1 a 0 1\n.op\n.options savecurrents\n.END\n* notes\n.end\n');
  });

  it('does not treat the title line as a command', () => {
    expect(toRun('.op\nV1 a 0 1\nR1 a 0 1\n.end\n').added).toEqual([]);
  });

  it('adds no line when a + line after .end continues the line before .end: the added line would take that line’s place (limit-18)', () => {
    // ngspice reads past .end, a comment to it: the + line continues B1 (native 47: v(c) = 7). With the line
    // added before .end it would continue .options instead, and B1 end in "1+" (native 47: "YYparse error").
    const text = '* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\nR3 c 0 1k\nB1 c 0 V=1+\n.end\n+ v(b)\n';
    expect(toRun(text)).toEqual({ text, added: [], notes: [] });
    expect(toRun('* t\nV1 a 0 9\nR1 a 0 1k\n.op\n.end\n* note\n\n+ 2\n').added).toEqual([]);
    // A line between .end and the + line is the one it continues: the line is added as before.
    expect(toRun('* t\nV1 a 0 9\nR1 a 0 1k\n.op\n.end\nR2 a 0 1k\n+ 2\n').added).toEqual([SAVE_CURRENTS_LINE]);
  });
});

const w = (n: number, c = 'w'): string => c.repeat(n);
const BODY = 'V1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\n.end\n';
const lineOf = (text: string, n: number): string => text.split('\n')[n - 1]!;

describe('the title in the copy that runs (limit-1: ngspice -b -r writes at most 504 bytes of it)', () => {
  it('keeps a title of 504 bytes, and cuts a longer one to its first 504 bytes in the copy only', () => {
    const t504 = `* ${w(502)}`;
    expect(toRun(`${t504}\n${BODY}`)).toMatchObject({ notes: [], added: [SAVE_CURRENTS_LINE] });
    expect(lineOf(toRun(`${t504}\n${BODY}`).text, 1)).toBe(t504);
    const netlist = parseNetlist(`${t504}W\n${BODY}`);
    const run = netlistToRun(netlist);
    expect(lineOf(run.text, 1)).toBe(t504);
    expect(run.notes).toEqual([RUN_COPY_WORDS.titleCut(1, 505, 504)]);
    expect(run.notRun).toBeUndefined();
    expect(lineOf(netlist.text, 1)).toBe(`${t504}W`);
  });

  it('counts the bytes of UTF-8, and cuts between two characters', () => {
    expect(toRun(`* ${w(251, 'ş')}\n${BODY}`).notes).toEqual([]);
    const odd = toRun(`* w${w(251, 'ş')}\n${BODY}`);
    expect(lineOf(odd.text, 1)).toBe(`* w${w(250, 'ş')}`);
    expect(utf8Bytes(lineOf(odd.text, 1))).toBe(503);
    // The note says the bytes kept: 503, as a two-byte letter would not fit in the last one.
    expect(odd.notes).toEqual([RUN_COPY_WORDS.titleCut(1, 505, 503)]);
    expect(lineOf(toRun(`* ${w(126, '😀')}\n${BODY}`).text, 1)).toBe(`* ${w(125, '😀')}`);
  });

  it('cuts the text of every .title line, as ngspice reads it, wherever the line is', () => {
    const text = [
      '* t',
      `.title ${w(504)}`,
      `  .TITLE ${w(505)}`,
      `.titles\t${w(600)}`,
      `﻿.title ${w(504)}x`,
      ...BODY.replace('.op', '.tf v(b) V1').trimEnd().split('\n').slice(0, -1),
      '.subckt s p q',
      `.title ${w(700)}`,
      'Ri p q 1k',
      '.ends',
      'X1 b 0 s',
      '.end',
      `.title ${w(800)}`,
      ' .title short',
      '',
    ].join('\n');
    const run = toRun(text);
    const lines = run.text.split('\n');
    expect(lines).toHaveLength(text.split('\n').length);
    expect(lines[1]).toBe(`.title ${w(504)}`);
    expect(lines[2]).toBe(`  .TITLE ${w(504)}`);
    expect(lines[3]).toBe(`.titles\t${w(504)}`);
    expect(lines[4]).toBe(`﻿.title ${w(504)}`);
    expect(lines[10]).toBe(`.title ${w(504)}`);
    expect(lines[14]).toBe(`.end`);
    expect(lines[15]).toBe(`.title ${w(504)}`);
    expect(lines[16]).toBe(' .title short');
    expect(run.notes).toEqual([3, 4, 5, 11, 16].map((line, k) => RUN_COPY_WORDS.titleCut(line, [505, 600, 505, 700, 800][k]!, 504)));
    expect(run.notRun).toBeUndefined();
  });

  it('cuts line 1 whole, a .title on it too: native ngspice 47 and 42 read " .title …" there as written', () => {
    // " .title " and 497 letters is a title of 505 bytes to native ngspice 47 and 42 (they stop), of 497 to our engine.
    const spaced = toRun(` .title ${w(497)}\n${BODY}`);
    expect(lineOf(spaced.text, 1)).toBe(` .title ${w(496)}`);
    expect(spaced.notes).toEqual([RUN_COPY_WORDS.titleCut(1, 505, 504)]);
    expect(toRun(` .title ${w(496)}\n${BODY}`).notes).toEqual([]);
    const plain = toRun(`.title ${w(600)}\n${BODY}`);
    expect(utf8Bytes(lineOf(plain.text, 1))).toBe(504);
    expect(plain.notes).toEqual([RUN_COPY_WORDS.titleCut(1, 607, 504)]);
  });

  it('still adds .options savecurrents just before .end when it cuts a title before it', () => {
    const run = toRun(`* ${w(700)}\n.title ${w(900)}\n${BODY}`);
    expect(run.text).toBe(`* ${w(502)}\n.title ${w(504)}\n${BODY.replace('.end', `${SAVE_CURRENTS_LINE}\n.end`)}`);
  });
});

describe('names inside subcircuits (limit-3, limit-7, limit-10: ngspice saves and prints a part or node under its full name)', () => {
  /** Rr… inside Xy… inside Xz…, and a node n… beside it: full names "r.xz….xy….rr…" and "xz….xy….n…". */
  const nested = (x: number, y: number, r: number, node = 1, request = ''): string =>
    `* t\nV1 a 0 9\nR1 a b 1k\n.subckt s2 p q\nR${w(r - 1, 'r')} p ${w(node, 'n')} 1k\nRm ${w(node, 'n')} q 1\n.ends\n.subckt s1 p q\nX${w(y - 1, 'y')} p q s2 ; comment s9\n.ends\nX${w(x - 1, 'z')} b 0 s1\n${request}.op\n.end\n`;

  it('names a part as ngspice does (its letter, the X lines, its name) and a node (the X lines, its name)', () => {
    const text = '* t\nV1 a 0 9\nR1 a b 1k\n.subckt s3 p q\nRz p q 1k\n.ends\n.subckt s2 p q\nXyy p q s3\nRw p q 1k\n.ends\n.subckt s1 p q\nXxx p q s2\n.ends\nXzz b 0 s1\n.op\n.end\n';
    expect(longestFullName(parseNetlist(text))).toEqual({ name: 'r.xzz.xxx.xyy.rz', bytes: 16, line: 14 });
    expect(longestFullName(parseNetlist(nested(100, 100, 46)))).toEqual({ name: `r.x${w(99, 'z')}.x${w(99, 'y')}.r${w(45, 'r')}`, bytes: 250, line: 11 });
    expect(longestFullName(parseNetlist(nested(100, 100, 1, 48)))).toEqual({ name: `x${w(99, 'z')}.x${w(99, 'y')}.${w(48, 'n')}`, bytes: 250, line: 11 });
  });

  it('runs full names of 250 bytes with every current saved, and refuses 251, for a part and for a node, asked for or not', () => {
    for (const request of ['', '.options savecurrents\n', '.save alli\n']) {
      expect(toRun(nested(100, 100, 46, 1, request)), request).toMatchObject({ added: request.startsWith('.options') ? [] : [SAVE_CURRENTS_LINE], notes: [] });
      expect(toRun(nested(100, 100, 46, 1, request)).notRun, request).toBeUndefined();
      expect(toRun(nested(100, 100, 1, 48, request)).notRun, request).toBeUndefined();
      expect(toRun(nested(100, 100, 47, 1, request)).notRun, request).toEqual({
        line: 11,
        reason: RUN_COPY_WORDS.longFullName(11, `r.x${w(13, 'z')}…`, 251),
      });
      expect(toRun(nested(100, 100, 1, 49, request)).notRun, request).toEqual({
        line: 11,
        reason: RUN_COPY_WORDS.longFullName(11, `x${w(15, 'z')}…`, 251),
      });
    }
  });

  it('counts a long node inside a subcircuit printed by a .control block (limit-10), and nothing outside the subcircuits', () => {
    const text = (node: number) =>
      `* t\nV1 a 0 9\nR1 a b 1k\n.subckt s p q\nRi p ${w(node, 'n')} 1k\nRj ${w(node, 'n')} q 1k\n.ends\nX${w(149, 'a')} b 0 s\n.op\n.control\nop\nprint all\n.endc\n.end\n`;
    expect(whyNotRun(parseNetlist(text(99)))).toBeUndefined();
    expect(whyNotRun(parseNetlist(text(100)))?.line).toBe(8);
    expect(longestFullName(parseNetlist(`* t\nV1 ${w(250, 'n')} 0 9\nR${w(249)} ${w(250, 'n')} 0 1k\n.op\n.end\n`))).toBeUndefined();
  });
});

describe('netlists ngspice cannot take (limit-3 to limit-7)', () => {
  const reasonAt = (text: string): { line: number; reason: string } | undefined => whyNotRun(parseNetlist(text));

  it('runs words of 250 bytes and refuses 251, wherever ngspice reads them', () => {
    const places = (n: number): string[] => [
      `* t\nV1 a 0 9\nR1 a b 1k\nR${w(n - 1)} b 0 2k\n.op\n.end\n`,
      `* t\nV1 a 0 9\nR1 a ${w(n)} 1k\nR2 ${w(n)} 0 2k\n.op\n.end\n`,
      `* t\nV1 a 0 9\nR1 a b 1k\nD1 b 0 ${w(n)}\n.model ${w(n)} D\n.op\n.end\n`,
      `* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 {${w(n)}}\n.param ${w(n)}=2k\n.op\n.end\n`,
      `* t\nV1 a 0 9\nR1 a b 1k\nB1 c 0 V=v(b)*${w(n)}\nR3 c 0 1k\n.op\n.end\n`,
      `* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.control\nlet ${w(n)} = 1\n.endc\n.op\n.end\n`,
      `* t\nV1 a 0 9\nR1 a b 1k\n.op\n.end\nR2 b 0 2k${w(n - 2)}\n`,
    ];
    for (const text of places(250)) expect(reasonAt(text), text.slice(0, 40)).toBeUndefined();
    for (const text of places(251)) expect(reasonAt(text)?.reason, text.slice(0, 40)).toMatch(/has a word of 251 bytes/);
    expect(reasonAt(`* t\nV1 a 0 9\nR1 a ${w(125, 'ş')} 1k\nR2 ${w(125, 'ş')} 0 2k\n.op\n.end\n`)).toBeUndefined();
    expect(reasonAt(`* t\nV1 a 0 9\nR1 a ${w(126, 'ş')} 1k\nR2 ${w(126, 'ş')} 0 2k\n.op\n.end\n`)).toEqual({
      line: 3,
      reason: RUN_COPY_WORDS.longWord(3, w(126, 'ş'), 252),
    });
  });

  it('never reads the words of an end-of-line comment, which ngspice cuts before it reads a name (limit-5)', () => {
    for (const comment of [`; ${w(251)}`, `; ${w(20000)}`, `$ ${w(20000)}`, `// ${w(20000)}`])
      expect(reasonAt(`* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k ${comment}\n.op\n.end\n`), comment.slice(0, 8)).toBeUndefined();
    expect(reasonAt(`* t\n${BODY.replace('.op', `.control\nop $ ${w(20000)}\nprint v(b) ; ${w(20000)}\n.endc\n.op`)}`)).toBeUndefined();
    // A $ glued to a word starts no comment: that word is read.
    expect(reasonAt(`* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k$${w(251)}\n.op\n.end\n`)?.line).toBe(4);
  });

  it('reads a formula, a source and a list as many short words', () => {
    for (const text of [
      `* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\nB1 c 0 V=${w(400, 'v(b)+').slice(0, -1)}\nR3 c 0 1k\n.op\n.end\n`,
      `* t\nV1 a 0 PWL(${Array.from({ length: 300 }, (_, i) => `${i}u,${i % 7}`).join(',')})\nR1 a b 1k\nC2 b 0 1n\n.tran 1u 300u\n.end\n`,
      `* t\nV1 a 0 9\nR1 a b 1k\n.param p={${w(600, '1+').slice(0, -1)}}\nR2 b 0 {p}\n.op\n.end\n`,
    ])
      expect(reasonAt(text)).toBeUndefined();
  });

  it('leaves comments, drawing lines and titles alone', () => {
    expect(reasonAt(`* ${w(900)}\n.title ${w(900)}\n* ${w(900)}\n*@ wire ${w(900)}\n${BODY}`)).toBeUndefined();
  });

  it('refuses a part name or node that ngspice takes whole, brackets and all, as it saves currents and makes formulas', () => {
    const node = `a(${w(150, 'x')})(${w(150, 'y')})`;
    expect(reasonAt(`* t\nV1 a 0 9\nR1 a ${node} 1k\nR2 ${node} 0 {1k+v(a)*0}\n.op\n.end\n`)).toEqual({ line: 3, reason: RUN_COPY_WORDS.longWord(3, node, 305) });
    expect(reasonAt(`* t\nV1 a 0 9\nR1 a b 1k\nR2(${w(150)})(${w(150)}) b 0 2k\n.op\n.end\n`)?.line).toBe(4);
  });

  it('refuses a word on a .save line that ngspice keeps whole', () => {
    const word = `@r1[${w(150, 'p+')}]`;
    expect(reasonAt(`* t\n${BODY.replace('.op', `.save ${word}\n.op`)}`)).toEqual({ line: 5, reason: RUN_COPY_WORDS.longWord(5, word, utf8Bytes(word)) });
    expect(reasonAt(`* t\n${BODY.replace('.op', `.save @r1[i] i(V1) v(a) v(b)`)}`)).toBeUndefined();
  });

  it('refuses a formula whose v( or i( has no ) after it, but not a line ngspice does not read as a formula', () => {
    for (const [line, open] of [
      ['B1 c 0 V=v(b', 'v('],
      ['B1 c 0 I=I(V1)*2+i(V1', 'i('],
      ['E1 c 0 VALUE=v(b', 'v('],
      ['E1 c 0 VALUE={v(b}', 'v('],
      ['E1 c 0 TABLE {v(b} = (0,0) (1,1)', 'v('],
      ['G1 c 0 cur={v(b}', 'v('],
      ['G1 c 0 VALUE=v(b', 'v('],
      ['.model dm D is={1e-14+temper*0+v(b}', 'v('],
      ['B1 c 0 V=v(b ; (a)', 'v('],
    ] as const)
      expect(reasonAt(`* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n${line}\nR4 c 0 1k\n.op\n.end\n`), line).toEqual({ line: 5, reason: RUN_COPY_WORDS.noClose(5, open) });
    // ngspice stops these with its own message: no formula reads past the end.
    for (const line of [
      'B1 c 0 V=v(b)',
      'B1 c 0 V=v(b\n+ )*2',
      'R3 c 0 v(b',
      'R3 c 0 {1k+v(b}',
      'C3 c 0 {1n+v(b}',
      'F1 c 0 Vm {2+temper*0+v(b}',
      'E1 c 0 b v(a',
      'V3 c 0 PULSE(0 1 0',
      '.tf v(b V1',
      '.save v(b',
      'B1 c 0 V=dv(b)',
    ])
      expect(reasonAt(`* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n${line}\nR4 c 0 1k\n.op\n.end\n`), line).toBeUndefined();
  });

  it('refuses a v( … ) of more than 500 bytes in a formula', () => {
    const run = (n: number): string => `v(b ${'x '.repeat(300)}`.slice(0, n - 1);
    expect(reasonAt(`* t\n${BODY.replace('.op', `B1 c 0 V=${run(500)})\n.op`)}`)).toBeUndefined();
    expect(reasonAt(`* t\n${BODY.replace('.op', `B1 c 0 V=${run(501)})\n.op`)}`)).toEqual({ line: 5, reason: RUN_COPY_WORDS.longRun(5, run(501), 501) });
  });

  it('refuses an analysis command of a .control block (or an *ng_script file) over 500 bytes, as ngspice writes it: a dot, then its words with one blank between each (limit-6)', () => {
    /** "op 1 1 …", `n` bytes once written as ".op 1 1 …". */
    const op = (n: number): string => (n % 2 ? `op${' 1'.repeat((n - 3) / 2)}` : `op ${'1 '.repeat((n - 6) / 2)}11`);
    const control = (lines: string): string => `* t\n${BODY.replace('.op', `.control\n${lines}\n.endc\n.op`)}`;
    expect(reasonAt(control(op(500)))).toBeUndefined();
    expect(reasonAt(control(op(501)))).toEqual({ line: 6, reason: RUN_COPY_WORDS.longCommand(6, 'op', 501) });
    // Blanks between the words count once; the command's name in any case; + lines join it.
    expect(reasonAt(control(`op${'    1'.repeat(200)}`))).toBeUndefined();
    expect(reasonAt(control(`OP${' 1'.repeat(249)}`))).toEqual({ line: 6, reason: RUN_COPY_WORDS.longCommand(6, 'op', 501) });
    expect(reasonAt(control(`tran 1u 1u${' 1'.repeat(245)}`))).toEqual({ line: 6, reason: RUN_COPY_WORDS.longCommand(6, 'tran', 501) });
    expect(reasonAt(control(`op\n+${' 1'.repeat(249)}`))?.line).toBe(6);
    expect(reasonAt(`*ng_script\ncircbyline * t\ncircbyline V1 a 0 9\n${op(501)}\n`)).toEqual({ line: 4, reason: RUN_COPY_WORDS.longCommand(4, 'op', 501) });
    // Outside a .control block the line is a part (O, a lossy line), not a command.
    expect(reasonAt(`* t\nV1 a 0 9\nR1 a 0 1k\n${op(501)}\n.op\n.end\n`)).toBeUndefined();
  });

  it('runs the other commands of a .control block however long: ngspice copies them into no space of 512 bytes (limit-6)', () => {
    const control = (lines: string): string => `* t\n${BODY.replace('.op', `.control\nop\n${lines}\n.endc\n.op`)}`;
    for (const line of [`print${' v(b)'.repeat(104)}`, `print${' v(a) v(b)'.repeat(75)}`, `echo${` ${w(20, 'e')}`.repeat(71)}`, `let x = v(b)${'+v(b)'.repeat(199)}`])
      expect(reasonAt(control(line)), line.slice(0, 12)).toBeUndefined();
  });

  it('refuses a .model line whose version is over 90 bytes, the word ngspice reads after "version" (limit-9)', () => {
    const model = (version: string, more = ''): string => `* t\nV1 a 0 9\nR1 a b 1k\nM1 b b 0 0 mm\n.model mm nmos level=8 ${version}${more}\n.op\n.end\n`;
    expect(reasonAt(model(`version=4${w(89, 'W')}`))).toBeUndefined();
    expect(reasonAt(model(`version=4${w(90, 'W')}`))).toEqual({ line: 5, reason: RUN_COPY_WORDS.longVersion(5, `4${w(90, 'W')}`, 91) });
    // ngspice skips blanks, = , ( ) + after "version" and reads on to a blank: commas and brackets are inside the word.
    const glued = `4,${w(40)},${w(40)},${w(40)}`;
    expect(reasonAt(model(`VERSION = (${glued})`))).toEqual({ line: 5, reason: RUN_COPY_WORDS.longVersion(5, `${glued})`, 125) });
    expect(reasonAt(model('version=4.8', `\n+ tox=1n version=${glued}`))?.line).toBe(5);
    // A version in the line's comment is never read: ngspice cuts the comment first.
    expect(reasonAt(model('version=3.3.0 ', `; ${w(10)} version=${glued}`))).toBeUndefined();
    expect(reasonAt(model('version=3.3.0'))).toBeUndefined();
  });

  it('cuts an end-of-line comment exactly where ngspice does: a $ glued to a word starts none (limit-5)', () => {
    const at = (line: string) => reasonAt(`* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n${line}\nR4 c 0 1k\n.op\n.end\n`);
    for (const line of ['B1 c 0 V=1$+v(b', 'B1 c 0 V=v(b)*1 ";" + v(b', "B1 c 0 V=v(b)*1 ';' + v(b", 'B1 c 0 V=1 *$ v(b'])
      expect(at(line), line).toEqual({ line: 5, reason: RUN_COPY_WORDS.noClose(5, 'v(') });
    for (const line of ['B1 c 0 V=v(b) $ v(b', 'B1 c 0 V=v(b),$ v(b', 'B1 c 0 V=v(b)\t$ v(b', 'B1 c 0 V=v(b); v(b', 'B1 c 0 V=v(b) // v(b'])
      expect(at(line), line).toBeUndefined();
    expect(at(`B1 c 0 V=1$+v(b ${'b '.repeat(300)})`)?.reason).toMatch(/is 605 bytes long from v\( to \)/);
  });

  it('checks the circuit a .control block or an *ng_script file builds with circbyline as a netlist, at the commands’ lines (limit-12)', () => {
    const cb = (lines: string[]): string => lines.map((l) => `circbyline ${l}`).join('\n');
    const script = (lines: string[]): string => `*ng_script\n${cb(lines)}\nop\nprint all\n`;
    expect(reasonAt(script(['* t', 'V1 a 0 9', 'R1 a b 1k', 'B1 c 0 V=v(b', 'R3 c 0 1k', '.end']))).toEqual({ line: 5, reason: RUN_COPY_WORDS.noClose(5, 'v(') });
    expect(reasonAt(script(['* t', 'V1 a 0 9', 'R1 a b 1k', 'B1 c 0 V=v(b)', 'R3 c 0 1k', '.end']))).toBeUndefined();
    const nested = (node: number): string =>
      script(['* t', 'V1 a 0 9', 'R1 a b 1k', '.subckt inner p q', `Ri p ${w(node, 'n')} 1k`, `Rj ${w(node, 'n')} q 1k`, '.ends', '.subckt outer p q', `X${w(99, 'b')} p q inner`, '.ends', `X${w(99, 'a')} b 0 outer`, '.end']);
    expect(reasonAt(nested(48))).toBeUndefined();
    expect(reasonAt(nested(49))).toEqual({ line: 12, reason: RUN_COPY_WORDS.longFullName(12, `x${w(15, 'a')}…`, 251) });
    const control = `* t\nV9 z 0 1\nR9 z 0 1\n.control\n${cb(['* inner', 'V1 a 0 9', 'B1 c 0 V=v(a', 'R3 c 0 1k', '.end'])}\nop\n.endc\n.end\n`;
    expect(reasonAt(control)).toEqual({ line: 7, reason: RUN_COPY_WORDS.noClose(7, 'v(') });
    // A line that only mentions circbyline is no command.
    expect(reasonAt(`* t\nV1 a 0 9\nR1 a 0 1k\n.control\necho circbyline B1 c 0 V=v(b\n.endc\n.op\n.end\n`)).toBeUndefined();
  });

  it('says the first problem, by line', () => {
    expect(reasonAt(`* t\nV1 a 0 9\nB1 c 0 V=v(a\nR1 a ${w(300)} 1k\n.op\n.end\n`)?.line).toBe(3);
  });

  it('gives no text to run (textToRun throws the reason), and a run copy that says why', () => {
    const text = `* t\n${BODY.replace('.op', 'B1 c 0 V=v(b\n.op')}`;
    expect(() => textToRun(parseNetlist(text))).toThrow(RUN_COPY_WORDS.noClose(5, 'v('));
    expect(toRun(text).notRun).toEqual({ line: 5, reason: RUN_COPY_WORDS.noClose(5, 'v(') });
    expect(textToRun(parseNetlist(`* t\n${BODY}`))).toBe(`* t\n${BODY.replace('.end', `${SAVE_CURRENTS_LINE}\n.end`)}`);
  });
});

describe('names ngspice joins (limit-13: blanks out of brackets; limit-14: string parameters)', () => {
  const reasonAt = (text: string): { line: number; reason: string } | undefined => whyNotRun(parseNetlist(text));
  const save = (line: string): string => `* t\n${BODY.replace('.op', `${line}\n.op`)}`;

  it('measures the words of a .save line as gettoks reads them, without the blanks inside brackets', () => {
    expect(reasonAt(save(`.save i( ${w(100)} ${w(100)} ${w(47)} ) v(b)`))).toBeUndefined();
    const at251 = `i( ${w(100)} ${w(100)} ${w(48)} )`;
    expect(reasonAt(save(`.save ${at251} v(b)`))).toEqual({ line: 5, reason: RUN_COPY_WORDS.joinedWord(5, at251, 251) });
    // Tabs too, and the other lines gettoks reads: .print, .plot, .four, .meas.
    expect(reasonAt(save(`.save i(\t${w(200)}\t${w(200)}\t)`))?.line).toBe(5);
    for (const line of [`.print dc i( ${w(200)} ${w(200)} )`, `.plot dc i( ${w(200)} ${w(200)} )`, `.four 1k i( ${w(200)} ${w(200)} )`, `.meas tran x max i( ${w(200)} ${w(200)} )`])
      expect(reasonAt(save(line))?.reason, line.slice(0, 6)).toMatch(/takes the blanks out of the brackets/);
    // Outside brackets the words stay apart.
    expect(reasonAt(save(`.save ${w(200)} ${w(200)} ${w(200)}`))).toBeUndefined();
  });

  it('measures a part’s line with an i( … ) of a part without the blanks inside its brackets, as inp_meas_current rewrites it', () => {
    const b = (formula: string): string => `* t\n${BODY.replace('.op', `B1 c 0 V=${formula}\nR3 c 0 1k\n.op`)}`;
    expect(reasonAt(b(`i(R1)*1+( ${w(125)} ${w(125)} )`))).toBeUndefined();
    expect(reasonAt(b(`i(R1)*1+( ${w(125)} ${w(126)} )`))).toEqual({ line: 5, reason: RUN_COPY_WORDS.joinedWord(5, `${w(125)} ${w(126)}`, 251) });
    // Without an i( of a part (i(V1) is the source's own current), ngspice leaves the blanks alone.
    expect(reasonAt(b(`1+( ${w(200)} ${w(200)} )`))).toBeUndefined();
    expect(reasonAt(b(`i(V1)*1+( ${w(200)} ${w(200)} )`))).toBeUndefined();
  });

  it('measures the names a .control command reads without the blanks inside brackets: print, plot, meas …, not echo or let', () => {
    const control = (line: string): string => `* t\n${BODY.replace('.op', `.control\nop\n${line}\n.endc\n.op`)}`;
    expect(reasonAt(control(`print v( ${w(123)} ${w(123)} )`))).toBeUndefined();
    const dotted = `${w(200)} ${w(200)} ${w(111)} .x`;
    expect(reasonAt(control(`print v( ${dotted} )`))).toEqual({ line: 7, reason: RUN_COPY_WORDS.joinedWord(7, dotted, 513) });
    for (const line of [`write out.raw v( ${w(200)} ${w(200)} )`, `if v( ${w(200)} ${w(200)} ) > 0`, `meas tran x max i( ${w(200)} ${w(200)} )`])
      expect(reasonAt(control(line))?.line, line.slice(0, 6)).toBe(7);
    for (const line of [`echo v( ${dotted} )`, `let q = v( ${dotted} )`, `print ${w(200)} ${w(200)} ${w(200)}.x`]) expect(reasonAt(control(line)), line.slice(0, 6)).toBeUndefined();
  });

  it('counts the text a string parameter stands for, joined from quoted pieces and other string parameters, where {…} puts it', () => {
    const node = (param: string, n = 'R2 b {t} 2k\nR3 {t} 0 1k'): string => `* t\nV1 a 0 9\nR1 a b 1k\n${param}\n${n}\n.op\n.end\n`;
    expect(reasonAt(node(`.param t="${w(125)}""${w(125)}"`))).toBeUndefined();
    expect(reasonAt(node(`.param t="${w(125)}""${w(126)}"`))).toEqual({ line: 5, reason: RUN_COPY_WORDS.longText(5, '{t}', 251) });
    // Other string parameters, as {s} or bare, and the text of each definition, in a subcircuit too.
    expect(reasonAt(node(`.param s="${w(100)}"\n.param t={s}{s}"x"`, 'R2 b {t} 2k'))).toBeUndefined();
    expect(reasonAt(node(`.param s="${w(100)}"\n.param t={s}s"x"s`, 'R2 b {t} 2k'))?.reason).toBe(RUN_COPY_WORDS.longText(6, '{t}', 301));
    const sub = (head: string, body: string, x = 'X1 b 0 s'): string => `* t\nV1 a 0 9\nR1 a b 1k\n${head}\n${body}Rx p {t} 1k\nRy {t} q 1k\n.ends\n${x}\n.op\n.end\n`;
    expect(reasonAt(sub(`.subckt s p q params: t="${w(200)}""${w(200)}"`, ''))).toEqual({ line: 5, reason: RUN_COPY_WORDS.longText(5, '{t}', 400) });
    expect(reasonAt(sub('.subckt s p q params: t="a"', '', `X1 b 0 s t="${w(200)}""${w(200)}"`))?.line).toBe(5);
    expect(reasonAt(sub('.subckt s p q', `.param t="${w(200)}""${w(200)}"\n`))?.line).toBe(6);
    // A numeric parameter puts a number in place, never a long word.
    expect(reasonAt(node('.param t=2k', 'R2 b 0 {t}'))).toBeUndefined();
  });

  it('counts that text in a .model line’s version and, without the blanks, in the brackets of a .save line', () => {
    const model = (version: string): string => `* t\nV1 a 0 9\nR1 a b 1k\nM1 b b 0 0 mm\n.param t="${version}"\n.model mm nmos level=8 version={t}\n.op\n.end\n`;
    expect(reasonAt(model(`4${w(89)}`))).toBeUndefined();
    expect(reasonAt(model(`4${w(90)}`))).toEqual({ line: 6, reason: RUN_COPY_WORDS.longTextVersion(6, '{t}', 91) });
    const saved = (n: number, line = '.save i({t}) v(b)'): string => `* t\n${BODY.replace('.op', `.param t="${w(n)}"\n${line}\n.op`)}`;
    expect(reasonAt(saved(247))).toBeUndefined();
    expect(reasonAt(saved(248))).toEqual({ line: 6, reason: RUN_COPY_WORDS.joinedWord(6, 'i({t})', 251) });
    expect(reasonAt(saved(124, '.save i({t}{t})'))?.line).toBe(6);
    // A number in {…} is counted at its longest, 23 bytes: "-1.000000000000000e+100".
    expect(reasonAt(save(`.save i(${'{1}'.repeat(10)}) v(b)`))).toBeUndefined();
    expect(reasonAt(save(`.save i(${'{1}'.repeat(11)}) v(b)`))).toEqual({ line: 5, reason: RUN_COPY_WORDS.joinedWord(5, `i(${'{1}'.repeat(11)})`, 256, true) });
  });
});

describe('the names print and write give a formula, and the words of meas (limit-17)', () => {
  const reasonAt = (text: string): { line: number; reason: string } | undefined => whyNotRun(parseNetlist(text));
  const control = (line: string): string => `* t\n${BODY.replace('.op', `.control\nop\n${line}\n.endc\n.op`)}`;

  it('print, write, asciiplot, fft, psd and spec name a formula’s result with its words, one blank between each: at most 250 bytes; each formula on its own', () => {
    expect(reasonAt(control(`print v(b)${'+v(b)'.repeat(49)}`))).toBeUndefined();
    const sum = `v(b)${'+v(b)'.repeat(50)}`;
    expect(reasonAt(control(`print ${sum}`))).toEqual({ line: 7, reason: RUN_COPY_WORDS.longExpression(7, 'print', sum, 254) });
    expect(reasonAt(control(`write out.raw ${sum}`))).toEqual({ line: 7, reason: RUN_COPY_WORDS.longExpression(7, 'write', sum, 254) });
    // asciiplot (through vec_eq), fft, psd and spec copy that name too; their numbers are formulas of their own.
    for (const [command, line] of [['asciiplot', `asciiplot ${sum}`], ['fft', `fft ${sum}`], ['psd', `psd 10 ${sum}`], ['spec', `spec 500 10000 500 ${sum}`]])
      expect(reasonAt(control(line!)), command).toEqual({ line: 7, reason: RUN_COPY_WORDS.longExpression(7, command!, sum, 254) });
    // The blanks between words count, one each (native 47 and 42: 73 terms joined by " + ", 508 bytes, print; 74 stop).
    const spaced = (n: number): string => Array.from({ length: n }, () => 'v(b)').join(' + ');
    expect(reasonAt(control(`print ${spaced(36)}`))).toBeUndefined();
    expect(reasonAt(control(`print ${spaced(37)}`))).toEqual({ line: 7, reason: RUN_COPY_WORDS.longExpression(7, 'print', spaced(37), 256) });
    // Formulas side by side are names of their own, and so are words a comma separates.
    expect(reasonAt(control(`print${' v(b)'.repeat(150)}`))).toBeUndefined();
    expect(reasonAt(control(`print ${w(200)}, ${w(200)}, ${w(200)}`))).toBeUndefined();
    expect(reasonAt(control(`print v(b) gt 1${' v(a)'.repeat(100)}`))).toBeUndefined();
    // ? and : join a formula, as ngspice's parser reads them.
    const ternary = `v(b) ? ${spaced(18)} : ${spaced(18)}`;
    expect(reasonAt(control(`print ${ternary}`))).toEqual({ line: 7, reason: RUN_COPY_WORDS.longExpression(7, 'print', ternary, 256) });
    // let names the result itself; wrdata and plot copy no such name.
    for (const line of [`let q = ${sum}`, `wrdata out.txt ${sum}`, `plot ${sum}`]) expect(reasonAt(control(line)), line.slice(0, 6)).toBeUndefined();
  });

  it('measures a formula as ngspice names it: without the blanks inside brackets, with the quotes it adds, and cut to 99 bytes where it writes the name again', () => {
    // A line with a v( or an i(: the blanks inside brackets are taken out, so v( w… w… ) is 249 bytes.
    expect(reasonAt(control(`print v( ${w(123)} ${w(123)} )`))).toBeUndefined();
    // …unless the netlist sets noquotesinoutput: then the blanks stay.
    expect(reasonAt(control(`set noquotesinoutput\nprint v( ${w(123)} ${w(123)} )`))?.line).toBe(8);
    // v(a,1p): ngspice writes v(a,"1p") (native 47 and 42: 51 such terms, 509 bytes, print; 52 stop), so 26 make 259.
    const pairs = (n: number): string => Array.from({ length: n }, () => 'v(a,1p)').join('+');
    expect(reasonAt(control(`print ${pairs(25)}`))).toBeUndefined();
    expect(reasonAt(control(`print ${pairs(26)}`))).toEqual({ line: 7, reason: RUN_COPY_WORDS.longExpression(7, 'print', pairs(26).replaceAll('1p', '"1p"'), 259) });
    // v(1p): ngspice writes v("1p"), and a name with v(" in it again without its quotes, in 99 bytes: 120 terms print.
    expect(reasonAt(control(`print ${Array.from({ length: 120 }, () => 'v(1p)').join('+')}`))).toBeUndefined();
  });

  it('meas: a word (a name=value as one) of at most 50 bytes, as ngspice writes it with its message into 100', () => {
    expect(reasonAt(control(`meas tran x max v(${w(47)})`))).toBeUndefined();
    expect(reasonAt(control(`meas tran x max v(${w(48)})`))).toEqual({ line: 7, reason: RUN_COPY_WORDS.longMeasWord(7, `v(${w(48)})`, 51) });
    expect(reasonAt(control(`meas tran x avg v(b) from = ${w(46)}`))).toEqual({ line: 7, reason: RUN_COPY_WORDS.longMeasWord(7, `from=${w(46)}`, 51) });
    expect(reasonAt(control('meas tran res find v(b) at=5u'))).toBeUndefined();
  });
});

describe('the names a .probe line makes (limit-15)', () => {
  const reasonAt = (text: string): { line: number; reason: string } | undefined => whyNotRun(parseNetlist(text));
  /** A resistor named R…, `name` bytes, between nodes a… and b… of 250 bytes. */
  const probed = (name: number, probe: (part: string) => string): string => {
    const part = `R${w(name - 1, 'r')}`;
    return `* t\nV1 ${w(250, 'a')} 0 9\n${part} ${w(250, 'a')} ${w(250, 'b')} 1k\nR2 ${w(250, 'b')} 0 2k\n.probe ${probe(part)}\n.op\n.end\n`;
  };

  it('p(…): the formula ngspice writes holds i(vcurr_<part>:probe_int_<terminal>:<n>_<node>), at most 500 bytes', () => {
    expect(reasonAt(probed(225, (p) => `p(${p})`))).toBeUndefined();
    const part = `r${w(225, 'r')}`;
    expect(reasonAt(probed(226, (p) => `p(${p})`))).toEqual({
      line: 5,
      reason: RUN_COPY_WORDS.probeFormula(5, part, `i(vcurr_${part}:probe_int_n1:1_${w(250, 'a')})`, 501),
    });
    // An X line: the terminal is the subcircuit's own pin name.
    const x = (pin: number): string =>
      `* t\nV1 ${w(250, 'a')} 0 9\n.subckt s ${w(pin, 'p')} q\nR1 ${w(pin, 'p')} q 1k\n.ends\nX${w(100, 'x')} ${w(250, 'a')} ${w(100, 'b')} s\nR2 ${w(100, 'b')} 0 2k\n.probe p(X${w(100, 'x')})\n.op\n.end\n`;
    expect(reasonAt(x(126))).toBeUndefined();
    expect(reasonAt(x(127))?.line).toBe(8);
  });

  it('i(…), alli and vd(…): the names of the results, at most 250 bytes like every name', () => {
    expect(reasonAt(probed(243, () => 'alli'))).toBeUndefined();
    expect(reasonAt(probed(244, () => 'alli'))).toEqual({ line: 5, reason: RUN_COPY_WORDS.probeName(5, `r${w(243, 'r')}#branch`, 251) });
    expect(reasonAt(probed(244, (p) => `i(${p})`))?.line).toBe(5);
    expect(reasonAt(probed(10, () => `vd(${w(123, 'a')}, ${w(123, 'b')})`))).toBeUndefined();
    expect(reasonAt(probed(10, () => `vd(${w(124, 'a')}, ${w(123, 'b')})`))).toEqual({ line: 5, reason: RUN_COPY_WORDS.probeName(5, `vd_${w(124, 'a')}:${w(123, 'b')}`, 251) });
    // An X line's terminal: the subcircuit's pin, in i(X…, 1) and vd(X…:1, X…:2).
    const x = (name: number, probe: (part: string) => string): string => {
      const part = `X${w(name - 1, 'x')}`;
      return `* t\nV1 a 0 9\n.subckt s ${w(200, 'p')} ${w(10, 'q')}\nR1 ${w(200, 'p')} ${w(10, 'q')} 1k\n.ends\n${part} a b s\nR2 b 0 2k\n.probe ${probe(part)}\n.op\n.end\n`;
    };
    expect(reasonAt(x(42, (p) => `i(${p}, 1)`))).toBeUndefined();
    expect(reasonAt(x(43, (p) => `i(${p}, 1)`))).toEqual({ line: 8, reason: RUN_COPY_WORDS.probeName(8, `x${w(42, 'x')}:${w(200, 'p')}#branch`, 251) });
    expect(reasonAt(x(20, (p) => `vd(${p}:1, ${p}:2)`))).toEqual({ line: 8, reason: RUN_COPY_WORDS.probeName(8, `vd_x${w(19, 'x')}:${w(200, 'p')}_x${w(19, 'x')}:${w(10, 'q')}`, 256) });
  });
});

describe('circuits built with circbyline (limit-12, limit-16)', () => {
  const reasonAt = (text: string): { line: number; reason: string } | undefined => whyNotRun(parseNetlist(text));
  const cb = (lines: string[]): string => lines.map((l) => `circbyline ${l}`).join('\n');

  it('checks a circuit’s title, its first line, as ngspice joins its words: at most 504 bytes, in each circuit', () => {
    const title = (last: string): string => `* ${'ab '.repeat(166)}${last}`;
    const script = (first: string): string => `*ng_script\n${cb([first, 'V1 a 0 9', 'R1 a b 1k', 'R2 b 0 2k', '.op', '.end'])}\nop\nprint all\n`;
    expect(reasonAt(script(title('abcd')))).toBeUndefined();
    expect(reasonAt(script(title('abcde')))).toEqual({ line: 2, reason: RUN_COPY_WORDS.circuitTitle(2, 505) });
    // Blanks between its words count once (ngspice joins the words with one blank).
    expect(reasonAt(script(`* ${'ab   '.repeat(166)}abcd`))).toBeUndefined();
    const two = `*ng_script\n${cb(['* one', 'V1 a 0 9', 'R1 a 0 1k', '.end', title('abcde'), 'V1 a 0 9', 'R1 a 0 1k', '.end'])}\nop\n`;
    expect(reasonAt(two)).toEqual({ line: 6, reason: RUN_COPY_WORDS.circuitTitle(6, 505) });
    // Each circuit is checked as its own netlist: the second one's B source without its ).
    expect(reasonAt(`*ng_script\n${cb(['* one', 'V1 a 0 9', '.end', '* two', 'V1 a 0 9', 'B1 c 0 V=v(a', 'R3 c 0 1k', '.end'])}\nop\n`)).toEqual({ line: 7, reason: RUN_COPY_WORDS.noClose(7, 'v(') });
  });

  it('refuses a netlist that sets ngbehavior and builds a circuit: ngspice reads that circuit in another mode', () => {
    const built = (mode: string): string =>
      `* t\nV9 z 0 1\nR9 z 0 1\n.op\n${mode}\n${cb(['* inner', 'V1 a 0 9', 'R1 a b 1k', 'B1 c 0 V=1 $ + v(b', 'R3 c 0 1k', '.end']).replaceAll('circbyline', '*# circbyline')}\n*# op\n.end\n`;
    expect(reasonAt(built('*# set ngbehavior=ps'))).toEqual({ line: 5, reason: RUN_COPY_WORDS.circuitMode(5) });
    expect(reasonAt(built('.options ngbehavior=ps'))).toEqual({ line: 5, reason: RUN_COPY_WORDS.circuitMode(5) });
    // Without it the $ starts a comment, as ngspice reads the built circuit; nor does a comment set it.
    expect(reasonAt(built('*# echo no mode'))).toBeUndefined();
    expect(reasonAt(built('* ngbehavior=ps'))).toBeUndefined();
    // Without a built circuit, ngspice reads nothing in that mode.
    expect(reasonAt('* t\nV1 a 0 9\nR1 a 0 1k\n.op\n.control\nset ngbehavior=ps\nop\n.endc\n.end\n')).toBeUndefined();
  });

  it('refuses a circbyline command inside a circuit built with circbyline: ngspice crashes on it', () => {
    const scriptInside = `*ng_script\n${cb(['*ng_script', 'circbyline * inner', 'circbyline V1 a 0 1', 'circbyline R1 a 0 2', 'circbyline .end', 'op', '.end'])}\necho done\n`;
    expect(reasonAt(scriptInside)).toEqual({ line: 3, reason: RUN_COPY_WORDS.nestedCircuit(3) });
    const controlInside = `* outer\nV9 z 0 1\nR9 z 0 1\n.control\n${cb(['* mid', 'V8 y 0 1', 'R8 y 0 1', '.control', 'circbyline * inner', 'circbyline V1 a 0 1', 'circbyline .end', '.endc', '.end'])}\n.endc\n.end\n`;
    expect(reasonAt(controlInside)).toEqual({ line: 9, reason: RUN_COPY_WORDS.nestedCircuit(9) });
  });
});

describe('the checks of the run copy, on netlists made to be slow or deep', () => {
  // A link can hold one formula of 250 kB. Measuring each v( … ) by looking back for its { and on
  // for its ) made the work grow with the square of the line: 8,000 terms took 8 times the work of
  // 2,000 (105 ms of processor time), so 50,000 would take seconds. Ten lines of 5,000 terms against
  // one of 50,000: equal work, so at most 2.5 times as long (as the parser's own test). Timed as the
  // work it is (work-time.ts), the least of five tries of each, taken in turns.
  it('reads a formula in time proportional to its length', () => {
    const formula = (terms: number) => parseNetlist(`* t\nV1 a 0 1\nB1 b 0 V=${'v(a)+'.repeat(terms)}0\nR1 b 0 1\n.op\n.end\n`);
    const small = formula(5000);
    const large = formula(50_000);
    netlistToRun(formula(10));
    const [tenSmall, oneLarge] = leastWorkMs(
      [
        () => {
          for (let k = 0; k < 10; k++) netlistToRun(small);
        },
        () => netlistToRun(large),
      ],
      5,
    );
    expect(oneLarge).toBeLessThan(2.5 * tenSmall + 8);
    expect(netlistToRun(large).notRun).toBeUndefined();
  }, 30_000);

  // A link of 2 kB can unpack to 250 kB of circbyline commands nested 100 deep. Checking each circuit
  // built with circbyline again inside the one before made the work grow with the depth times the size:
  // a second of processor time for 100 levels, at every pause while the student typed. Each circuit is
  // checked once now. Ten netlists of 10 levels against one of 100 (12 times the text of one of them):
  // at most 2.5 times as long.
  it('checks a circuit built with circbyline once, however deep: in time proportional to the text', () => {
    const nested = (levels: number, lines: number): string => {
      const out = ['* t', 'V1 a 0 1', 'R1 a 0 1', '.op', '.control'];
      for (let j = 1; j <= levels; j++) out.push(`${'circbyline '.repeat(j)}*ng_script`);
      for (let i = 0; i < lines; i++) out.push(`${'circbyline '.repeat(levels)}R${i} a 0 1`);
      out.push('.endc', '.end', '');
      return out.join('\n');
    };
    const small = parseNetlist(nested(10, 177));
    const large = parseNetlist(nested(100, 177));
    netlistToRun(parseNetlist(nested(3, 3)));
    const [tenSmall, oneLarge] = leastWorkMs(
      [
        () => {
          for (let k = 0; k < 10; k++) netlistToRun(small);
        },
        () => netlistToRun(large),
      ],
      5,
    );
    expect(oneLarge).toBeLessThan(2.5 * tenSmall + 8);
    expect(netlistToRun(large).notRun).toEqual({ line: 7, reason: RUN_COPY_WORDS.nestedCircuit(7) });
  }, 30_000);

  // Every check of the run copy runs on the main thread at every pause: none may grow with the square of the
  // text. Each case: ten netlists of one size against one ten times as large, at most 2.5 times as long (as
  // above). The round-2 critic's links froze the page: 1,500 parts and 30,000 empty .probe lines for 4 s on a
  // computer and 16 s on a phone (each .probe line walked every part); a .model line of 20,000 version={x}
  // (each version looked through every {…}); a chain p0=p1, p1=p2 … (one name a pass). Three more grew the
  // same way: a .probe line's a( a( a( … without a ) and a long run of blanks in a .probe request or a meas line
  // (regular expressions that tried every start), and a print line's i(i(i(… without a ).
  const linear = (make: (n: number) => string, n: number): void => {
    const small = parseNetlist(make(n));
    const large = parseNetlist(make(10 * n));
    netlistToRun(parseNetlist(make(Math.max(1, n / 10))));
    const [tenSmall, oneLarge] = leastWorkMs(
      [
        () => {
          for (let k = 0; k < 10; k++) netlistToRun(small);
        },
        () => netlistToRun(large),
      ],
      5,
    );
    expect(oneLarge).toBeLessThan(2.5 * tenSmall + 8);
  };

  it('checks many .probe lines against many parts in time proportional to the text: what alli keeps is worked out once', () => {
    linear((n) => `* t\nV1 a 0 9\nR1 a b 1k\n${Array.from({ length: n }, (_, i) => `R${i + 2} b 0 1`).join('\n')}\n${'.probe\n'.repeat(20 * n)}.op\n.end\n`, 150);
  }, 60_000);

  it('reads the versions of a .model line in time proportional to the line', () => {
    linear((n) => `* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.model mm nmos${' version={x}'.repeat(n)}\n.op\n.end\n`, 2000);
  }, 60_000);

  it('works out a chain of string parameters in time proportional to its length, and a chain of 12,000 runs', () => {
    linear((n) => `* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n${Array.from({ length: n }, (_, i) => `.param p${i}=p${i + 1}`).join('\n')}\n.param p${n}="x"\n.op\n.end\n`, 400);
    // 12,000 deep, defined from the end: no "a bug in PlainSpice" (the stack ran out on b060bc8's successor).
    const lines = ['* t', 'V1 a 0 9', 'R1 a b 1k', 'R2 b 0 2k', '.param p12000="x"'];
    for (let i = 11999; i >= 0; i--) lines.push(`.param p${i}=p${i + 1}`);
    lines.push('R3 b {p0} 1k', '.op', '.end', '');
    expect(() => netlistToRun(parseNetlist(lines.join('\n')))).not.toThrow();
    expect(netlistToRun(parseNetlist(lines.join('\n'))).notRun).toBeUndefined();
  }, 60_000);

  it('reads a .probe line of a( a( a( … without a ) in time proportional to the line', () => {
    linear((n) => `* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.probe${' a('.repeat(n)}\n.op\n.end\n`, 4000);
  }, 60_000);

  it('reads a run of blanks in a .probe request and in a meas line in time proportional to the line', () => {
    linear((n) => `* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.probe i(${' '.repeat(n)})\n.op\n.end\n`, 20_000);
    linear((n) => `* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\n.control\nmeas tran x max${' '.repeat(n)}x\n.endc\n.end\n`, 20_000);
    linear((n) => `* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\n*# meas tran x max '${' '.repeat(n)}x'\n.end\n`, 20_000);
  }, 60_000);

  it('reads a print line of i(i(i(… without a ) in time proportional to the line', () => {
    linear((n) => `* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\n*# print${' i('.repeat(n)}\n.end\n`, 4000);
  }, 60_000);

  it('checks a + line after a title on its own: the title is cut, the + line is not part of it', () => {
    expect(whyNotRun(parseNetlist(`* t\n+ ${w(251)}\n${BODY}`))?.line).toBe(2);
    expect(whyNotRun(parseNetlist(`* t\n.title x\n+ ${w(251)}\n${BODY}`))?.line).toBe(3);
    expect(whyNotRun(parseNetlist(`* t\n+ ${w(250)}\n${BODY}`))).toBeUndefined();
  });

  it('finds the subcircuit of an X line written with blanks around its parameters’ =', () => {
    const text = `* t\nV1 a 0 9\nR1 a b 1k\n.subckt s2 p q\nR${w(79, 'r')} p q 1k\n.ends\n.subckt s1 p q w=1\nX${w(79, 'y')} p q s2\n.ends\nX${w(79, 'z')} b 0 s1 w = 2\n.op\n.end\n`;
    expect(longestFullName(parseNetlist(text))?.bytes).toBe(2 + 80 + 1 + 80 + 1 + 80);
    expect(toRun(text).notRun).toBeUndefined();
    expect(longestFullName(parseNetlist(text.replace(`R${w(79, 'r')}`, `R${w(87, 'r')}`)))?.bytes).toBe(252);
    expect(toRun(text.replace(`R${w(79, 'r')}`, `R${w(87, 'r')}`)).notRun?.line).toBe(10);
  });

  it('works out the names of 5,000 nested subcircuits without running out of stack: past 125 levels every name is too long', () => {
    const lines = ['* t', 'V1 a 0 1', 'R1 a 0 1'];
    for (let i = 0; i < 5000; i++) lines.push(`.subckt s${i} p q`, `X${i} p q s${i + 1}`, '.ends');
    lines.push('.subckt s5000 p q', 'R9 p q 1', '.ends', 'X0 a 0 s0', '.op', '.end', '');
    const netlist = parseNetlist(lines.join('\n'));
    expect(longestFullName(netlist)!.bytes).toBeGreaterThan(250);
    expect(netlistToRun(netlist).notRun?.line).toBe(15007);
    // 60 levels of x1.x2.…: 2 bytes a level, and room for r.….r9.
    const sixty = ['* t', 'V1 a 0 1', 'R1 a 0 1'];
    for (let i = 0; i < 60; i++) sixty.push(`.subckt s${i} p q`, `X p q s${i + 1}`, '.ends');
    sixty.push('.subckt s60 p q', 'R9 p q 1', '.ends', 'X a 0 s0', '.op', '.end', '');
    expect(longestFullName(parseNetlist(sixty.join('\n')))).toMatchObject({ name: `r.${'x.'.repeat(61)}r9`, bytes: 126 });
  });
});

describe('the lines ngspice runs as commands (limit-18)', () => {
  const reasonAt = (text: string): { line: number; reason: string } | undefined => whyNotRun(parseNetlist(text));
  /** "op 1 1 …", `n` bytes once written as ".op 1 1 …". */
  const op = (n: number): string => (n % 2 ? `op${' 1'.repeat((n - 3) / 2)}` : `op ${'1 '.repeat((n - 6) / 2)}11`);
  const at = (line: string, after = ''): string => `* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\n${line}\n.end\n${after}`;
  const long = (line: number): { line: number; reason: string } => ({ line, reason: RUN_COPY_WORDS.longCommand(line, 'op', 501) });

  it('runs a line that starts with *# as a command, outside a .control block too, from after the mark and its blanks', () => {
    expect(reasonAt(at(`*# ${op(500)}`))).toBeUndefined();
    expect(reasonAt(at(`*# ${op(501)}`))).toEqual(long(6));
    expect(reasonAt(at(`*#${op(501)}`))).toEqual(long(6));
    expect(reasonAt(at(`   *#   ${op(501)}`))).toEqual(long(6));
    // In a .control block, and in an *ng_script file (from the line's third character), the same.
    expect(reasonAt(`* t\nV1 a 0 9\nR1 a 0 1k\n.op\n.control\n*# ${op(501)}\n.endc\n.end\n`)).toEqual(long(6));
    expect(reasonAt(`*ng_script\n*# ${op(501)}\n`)).toEqual(long(2));
  });

  it('runs ## and a # after any first character ngspice makes a *, as *# lines; without the # they are comments', () => {
    for (const first of ['#', ';', '=', '[', ']', '?', '(', ')', '&', '%', '$', '"', '!', ':', ',', '\f']) {
      expect(reasonAt(at(`${first}# ${op(501)}`)), JSON.stringify(first)).toEqual(long(6));
      expect(reasonAt(at(`${first}${op(501)}`)), JSON.stringify(first)).toBeUndefined();
    }
    // In a .control block too: ;# is a command there, a line starting with ; a comment.
    expect(reasonAt(`* t\nV1 a 0 9\nR1 a 0 1k\n.op\n.control\n;# ${op(501)}\n;${op(501)}\n.endc\n.end\n`)).toEqual(long(6));
    expect(reasonAt(`* t\nV1 a 0 9\nR1 a 0 1k\n.op\n.control\n;${op(501)}\n.endc\n.end\n`)).toBeUndefined();
  });

  it('runs the commands a ; separates on a *# line (no comment is cut from a line that starts with *)', () => {
    expect(reasonAt(at(`*# echo first ; ${op(501)}`))).toEqual(long(6));
    expect(reasonAt(at(`*# echo first ; ${op(500)}`))).toBeUndefined();
    // A ; inside brackets is part of a word.
    expect(reasonAt(at(`*# echo (a;b) ${'1 '.repeat(250)}`))).toBeUndefined();
  });

  it('takes pre_ off a command, which ngspice runs before it reads the circuit', () => {
    expect(reasonAt(at(`*# pre_${op(501)}`))).toEqual(long(6));
    expect(reasonAt(`* t\nV1 a 0 9\nR1 a 0 1k\n.op\n.control\npre_circbyline * u\npre_circbyline V1 a 0 9\npre_circbyline .end\npre_${op(501)}\n.endc\n.end\n`)).toEqual(long(9));
    // In an *ng_script file ngspice takes no pre_ off.
    expect(reasonAt(`*ng_script\npre_${op(501)}\n`)).toBeUndefined();
  });

  it('runs a .control block and a *# line after .end, as ngspice reads on past it', () => {
    expect(reasonAt(at('', `.control\n${op(501)}\n.endc\n`))).toEqual(long(9));
    expect(reasonAt(at('', `*# ${op(501)}\n`))).toEqual(long(8));
    expect(reasonAt(at('', `.control\n${op(500)}\n.endc\n`))).toBeUndefined();
  });

  it('joins a + line after .end, after a ;# line and in a .control block after .end to the line ngspice joins it to', () => {
    // .end is a comment to ngspice: the + line after it continues the B source before it.
    const formula = (plus: string): string => `* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\nR3 c 0 1k\nB1 c 0 V=1+\n.end\n+ ${plus}\n`;
    expect(reasonAt(formula('v(b'))).toEqual({ line: 7, reason: RUN_COPY_WORDS.noClose(7, 'v(') });
    expect(reasonAt(formula('v(b)'))).toBeUndefined();
    expect(reasonAt(at(';# op', `+${op(501).slice(2)}\n`).replace('.end\n+', '+'))).toEqual(long(6));
    expect(reasonAt(at('', `.control\nop\n+${op(501).slice(2)}\n.endc\n`))).toEqual(long(9));
    // ngspice joins no + line to a *# line (it is a comment while it joins them).
    expect(reasonAt(at('*# op', `+${op(501).slice(2)}\n`).replace('.end\n+', '+'))).toBeUndefined();
  });

  it('reads the lines after .end as circuit lines, as ngspice does (native 47: R3 and R4 there take v(b) to 4.5 V)', () => {
    expect(reasonAt('* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\n.end\nB1 c 0 V=v(b\nR3 c 0 1k\n')).toEqual({ line: 7, reason: RUN_COPY_WORDS.noClose(7, 'v(') });
    expect(reasonAt('* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\n.end\nB1 c 0 V=v(b)\nR3 c 0 1k\n')).toBeUndefined();
    // Line 1 is the title whatever it says: a .control there opens no block.
    expect(reasonAt('.control\nB1 c 0 V=v(b\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\nR3 c 0 1k\n.op\n.end\n')).toEqual({ line: 2, reason: RUN_COPY_WORDS.noClose(2, 'v(') });
  });

  it('runs a line that starts with ; in an *ng_script file, as the ; is a word that ends no command', () => {
    expect(reasonAt(`*ng_script\n;${op(501)}\n`)).toEqual(long(2));
    expect(reasonAt(`*ng_script\n; ${op(501)}\n`)).toEqual(long(2));
    // A second ; starts a comment.
    expect(reasonAt(`*ng_script\n;;${op(501)}\n`)).toBeUndefined();
    // .control, .endc and option lines are no commands there.
    expect(reasonAt(`*ng_script\noption${op(501).slice(2)}\n`)).toBeUndefined();
  });

  it('checks a circuit built by circbyline commands on *# lines, and refuses one built inside a built circuit that way', () => {
    const title = `* ${'ab '.repeat(200).trimEnd()}`;
    const star = (lines: string[]): string => `* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\n${lines.map((l) => `*# circbyline ${l}`).join('\n')}\n*# op\n.end\n`;
    expect(reasonAt(star([title, 'V1 a 0 9', 'R1 a 0 1k', '.op', '.end']))).toEqual({ line: 6, reason: RUN_COPY_WORDS.circuitTitle(6, utf8Bytes(title)) });
    expect(reasonAt(star(['* inner', 'V1 a 0 9', 'R1 a b 1k', 'B1 c 0 V=v(b', 'R3 c 0 1k', '.end']))).toEqual({ line: 9, reason: RUN_COPY_WORDS.noClose(9, 'v(') });
    const nested = `* t\nV9 z 0 1\nR9 z 0 1\n.op\n.control\ncircbyline * mid\ncircbyline V8 y 0 1\ncircbyline *# circbyline * inner\ncircbyline *# circbyline .end\ncircbyline .end\nop\n.endc\n.end\n`;
    expect(reasonAt(nested)).toEqual({ line: 8, reason: RUN_COPY_WORDS.nestedCircuit(8) });
  });
});

describe('a command’s words as ngspice’s control reader makes them (limit-19)', () => {
  const reasonAt = (text: string): { line: number; reason: string } | undefined => whyNotRun(parseNetlist(text));
  const star = (line: string): string => `* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\n*# ${line}\n.end\n`;
  const control = (line: string): string => `* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\n.control\n${line}\n.endc\n.end\n`;

  it('keeps the blanks inside quotes on a *# line and in an *ng_script file, but makes them one in a .control block', () => {
    const quoted = `op '${' '.repeat(600)}'`;
    expect(reasonAt(star(quoted))).toEqual({ line: 6, reason: RUN_COPY_WORDS.longCommand(6, 'op', 604) });
    expect(reasonAt(`*ng_script\n${quoted}\n`)).toEqual({ line: 2, reason: RUN_COPY_WORDS.longCommand(2, 'op', 604) });
    expect(reasonAt(star(`op "${' '.repeat(600)}"`))).toEqual({ line: 6, reason: RUN_COPY_WORDS.longCommand(6, 'op', 606) });
    expect(reasonAt(control(quoted))).toBeUndefined();
    expect(reasonAt(control(`op\nprint 'v(b)${' '.repeat(600)}+v(b)'`))).toBeUndefined();
    expect(reasonAt(star(`print 'v(b)${' '.repeat(600)}+v(b)'`))?.reason).toMatch(/^Line 6: print names .* 609 bytes\./);
  });

  it('drops a backslash and reads the next character as any other: \\" starts a quote', () => {
    expect(reasonAt(star(`op \\"${' '.repeat(600)}"`))).toEqual({ line: 6, reason: RUN_COPY_WORDS.longCommand(6, 'op', 606) });
  });

  it('refuses choices in braces, which ngspice makes into a word each, but not one choice, nor a circbyline line', () => {
    const op = 'op x({aaaaaaaaaa,bbbbbbbbbb}{1,2}{1,2}{1,2}{1,2}{1,2})';
    expect(reasonAt(control(op))).toEqual({ line: 7, reason: RUN_COPY_WORDS.braceChoices(7, 'x({aaaaaaaaaa,bbbbbbbbbb}{1,2}{1,2}{1,2}{1,2}{1,2})') });
    expect(reasonAt(control('op\nprint ({v(b),v(b)}{,}{,}{,}{,}{,}{,}{,})+ v(b)'))?.reason).toBe(RUN_COPY_WORDS.braceChoices(8, '({v(b),v(b)}{,}{,}{,}{,}{,}{,}{,})+'));
    expect(reasonAt(star('echo "{a,b}"'))?.line).toBe(6);
    // A comma outside brackets ends a word, so {a,b} there is two words with a { and a } each: no choices.
    expect(reasonAt(control('echo {a,b}'))).toBeUndefined();
    expect(reasonAt(control('op\nprint {v(b)}'))).toBeUndefined();
    expect(reasonAt(control('circbyline * u\ncircbyline V1 a 0 {9}\ncircbyline R1 a 0 ({1k,2k})\ncircbyline .end'))).toBeUndefined();
    // ngspice keeps the braces only when the line's first word is circbyline: after a ; it expands them (native
    // 47: the title is "* t(a) t(b)").
    expect(reasonAt('*ng_script\n;circbyline * t({a,b})\ncircbyline .end\n')).toEqual({ line: 2, reason: RUN_COPY_WORDS.braceChoices(2, 't({a,b})') });
    expect(reasonAt('*ng_script\ncircbyline * t({a,b})\ncircbyline .end\n')).toBeUndefined();
  });

  it('counts a ~ that starts a word as the engine’s home folder, /home/web_user (14 bytes)', () => {
    // 1 + 2 + 33 × 15 = 498 bytes; 34 make 513.
    expect(reasonAt(control(`op${' ~'.repeat(33)}`))).toBeUndefined();
    expect(reasonAt(control(`op${' ~'.repeat(34)}`))).toEqual({ line: 7, reason: RUN_COPY_WORDS.longCommand(7, 'op', 513) });
    expect(reasonAt(control(`op${' ~/x'.repeat(30)}`))).toEqual({ line: 7, reason: RUN_COPY_WORDS.longCommand(7, 'op', 513) });
    // Not inside a word, nor quoted.
    expect(reasonAt(control(`op${' x~'.repeat(100)}`))).toBeUndefined();
  });
});

describe('a .title line of a circuit built with circbyline (limit-16)', () => {
  const reasonAt = (text: string): { line: number; reason: string } | undefined => whyNotRun(parseNetlist(text));
  /** A title of `n` bytes made of short words. */
  const words = (n: number): string => Array.from({ length: Math.floor((n + 1) / 3) }, () => 'ab').join(' ').padEnd(n, 'x');
  const built = (title: string, keyword = '.title'): string =>
    `* t\nV9 z 0 1\nR9 z 0 1\n.op\n.control\ncircbyline * short\ncircbyline ${keyword} ${title}\ncircbyline V1 a 0 9\ncircbyline R1 a 0 1k\ncircbyline .op\ncircbyline .end\nop\n.endc\n.end\n`;

  it('measures it as the circuit’s title, its words after .title as ngspice joins them: at most 504 bytes', () => {
    expect([utf8Bytes(words(504)), utf8Bytes(words(505))]).toEqual([504, 505]);
    expect(reasonAt(built(words(504)))).toBeUndefined();
    expect(reasonAt(built(words(505)))).toEqual({ line: 7, reason: RUN_COPY_WORDS.circuitDotTitle(7, 505) });
    // ngspice joins the words with one blank: more blanks between them do not count.
    expect(reasonAt(built(words(504).replaceAll(' ', '    ')))).toBeUndefined();
    expect(reasonAt(built(words(505), '.TITLE'))?.line).toBe(7);
  });
});
