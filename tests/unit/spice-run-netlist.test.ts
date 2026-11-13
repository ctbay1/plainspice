import { describe, expect, it } from 'vitest';
import { parseNetlist } from '../../src/spice/parse.ts';
import {
  hasSaveCurrents,
  longestPartName,
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

describe('every current, with names inside subcircuits (limit-3: ngspice saves each under its full name, in 512 bytes)', () => {
  const nested = (x: number, y: number, r: number): string =>
    `* t\nV1 a 0 9\nR1 a b 1k\n.subckt s2 p q\nR${w(r - 1, 'r')} p q 1k\n.ends\n.subckt s1 p q\nX${w(y - 1, 'y')} p q s2 ; comment s9\n.ends\nX${w(x - 1, 'z')} b 0 s1\n.op\n.end\n`;

  it('names a part inside subcircuits as ngspice does: its letter, the X lines, its name', () => {
    const text = '* t\nV1 a 0 9\nR1 a b 1k\n.subckt s3 p q\nRz p q 1k\n.ends\n.subckt s2 p q\nXyy p q s3\nRw p q 1k\n.ends\n.subckt s1 p q\nXxx p q s2\n.ends\nXzz b 0 s1\n.op\n.end\n';
    expect(longestPartName(parseNetlist(text))).toEqual({ name: 'r.xzz.xxx.xyy.rz', bytes: 16, line: 14 });
    expect(longestPartName(parseNetlist(nested(200, 200, 96)))).toMatchObject({ bytes: 500, line: 10 });
  });

  it('adds .options savecurrents up to a full name of 500 bytes, and leaves it out above, saying why', () => {
    expect(toRun(nested(200, 200, 96))).toMatchObject({ added: [SAVE_CURRENTS_LINE], notes: [] });
    const longer = toRun(nested(200, 200, 97));
    expect(longer.added).toEqual([]);
    expect(longer.notes).toEqual([RUN_COPY_WORDS.noSaveCurrents(`r.x${w(13, 'z')}…`, 501)]);
    expect(longer.notRun).toBeUndefined();
    expect(longer.text).toBe(nested(200, 200, 97));
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

  it("refuses the student's own savecurrents or .save alli with a full part name of more than 500 bytes", () => {
    const nested = (r: number, request: string): string =>
      `* t\nV1 a 0 9\nR1 a b 1k\n.subckt s2 p q\nR${w(r - 1, 'r')} p q 1k\n.ends\n.subckt s1 p q\nX${w(199, 'y')} p q s2\n.ends\nX${w(199, 'z')} b 0 s1\n${request}\n.op\n.end\n`;
    for (const request of ['.options savecurrents', '.save alli']) {
      expect(reasonAt(nested(96, request)), request).toBeUndefined();
      expect(reasonAt(nested(97, request))?.line, request).toBe(11);
    }
    expect(reasonAt(nested(97, '.options savecurrents'))?.reason).toBe(
      RUN_COPY_WORDS.longFullName(11, `save every part's current (${SAVE_CURRENTS_LINE})`, `r.x${w(13, 'z')}…`, 501),
    );
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
