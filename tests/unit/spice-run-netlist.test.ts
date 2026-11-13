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
    expect(run.notes).toEqual([RUN_COPY_WORDS.titleCut(1, 505)]);
    expect(run.notRun).toBeUndefined();
    expect(lineOf(netlist.text, 1)).toBe(`${t504}W`);
  });

  it('counts the bytes of UTF-8, and cuts between two characters', () => {
    expect(toRun(`* ${w(251, 'ş')}\n${BODY}`).notes).toEqual([]);
    const odd = toRun(`* w${w(251, 'ş')}\n${BODY}`);
    expect(lineOf(odd.text, 1)).toBe(`* w${w(250, 'ş')}`);
    expect(utf8Bytes(lineOf(odd.text, 1))).toBe(503);
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
    expect(run.notes).toEqual([3, 4, 5, 11, 16].map((line, k) => RUN_COPY_WORDS.titleCut(line, [505, 600, 505, 700, 800][k]!)));
    expect(run.notRun).toBeUndefined();
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
      `* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k ; ${w(n)}\n.op\n.end\n`,
    ];
    for (const text of places(250)) expect(reasonAt(text), text.slice(0, 40)).toBeUndefined();
    for (const text of places(251)) expect(reasonAt(text)?.reason, text.slice(0, 40)).toMatch(/has a word of 251 bytes/);
    expect(reasonAt(`* t\nV1 a 0 9\nR1 a ${w(125, 'ş')} 1k\nR2 ${w(125, 'ş')} 0 2k\n.op\n.end\n`)).toBeUndefined();
    expect(reasonAt(`* t\nV1 a 0 9\nR1 a ${w(126, 'ş')} 1k\nR2 ${w(126, 'ş')} 0 2k\n.op\n.end\n`)).toEqual({
      line: 3,
      reason: RUN_COPY_WORDS.longWord(3, w(126, 'ş'), 252),
    });
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

  it('refuses a .control command of more than 500 bytes, and any line of an *ng_script file', () => {
    const cmd = (n: number): string => `op ${'1 '.repeat(300)}`.slice(0, n);
    expect(reasonAt(`* t\n${BODY.replace('.op', `.control\n${cmd(500)}\n.endc\n.op`)}`)).toBeUndefined();
    expect(reasonAt(`* t\n${BODY.replace('.op', `.control\n${cmd(501)}\n.endc\n.op`)}`)).toEqual({ line: 6, reason: RUN_COPY_WORDS.longCommand(6, 501) });
    expect(reasonAt(`* t\n${BODY.replace('.op', `.control\nop\n+ ${cmd(499)}\n.endc\n.op`)}`)?.line).toBe(6);
    expect(reasonAt(`*ng_script\ncircbyline * t\ncircbyline V1 a 0 9\n${cmd(501)}\n`)).toEqual({ line: 4, reason: RUN_COPY_WORDS.longCommand(4, 501) });
    expect(reasonAt(`* t\nV1 a 0 9\nR1 a 0 1k\n${cmd(501)}\n.op\n.end\n`)).toBeUndefined();
  });

  it('refuses a .model line whose version is over 90 bytes, the word ngspice reads after "version" (limit-9)', () => {
    const model = (version: string, more = ''): string => `* t\nV1 a 0 9\nR1 a b 1k\nM1 b b 0 0 mm\n.model mm nmos level=8 ${version}${more}\n.op\n.end\n`;
    expect(reasonAt(model(`version=4${w(89, 'W')}`))).toBeUndefined();
    expect(reasonAt(model(`version=4${w(90, 'W')}`))).toEqual({ line: 5, reason: RUN_COPY_WORDS.longVersion(5, `4${w(90, 'W')}`, 91) });
    // ngspice skips blanks, = , ( ) + after "version" and reads on to a blank: commas and brackets are inside the word.
    const glued = `4,${w(40)},${w(40)},${w(40)}`;
    expect(reasonAt(model(`VERSION = (${glued})`))).toEqual({ line: 5, reason: RUN_COPY_WORDS.longVersion(5, `${glued})`, 125) });
    expect(reasonAt(model('version=4.8', `\n+ tox=1n version=${glued}`))?.line).toBe(5);
    expect(reasonAt(model('version=3.3.0 ', `; ${w(10)} version=${glued}`))?.line).toBe(5);
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
