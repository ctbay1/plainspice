/**
 * docs/spice-facts/limits.md, checked in our WebAssembly engine: where ngspice copies a title or a
 * name into a space of fixed size (limit-1 to limit-19), what the engine does past the end of it, and
 * that the copy PlainSpice runs (src/spice/run-netlist.ts) stays inside: a title cut to 504 bytes gives
 * the numbers of a short title in every analysis, equal to native ngspice 47's (recorded 13 November
 * 2026, `ngspice -b -r`), and every netlist the engine would run past the end is not run at all.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { agrees } from '../../src/engine/compare.ts';
import { NgspiceEngine } from '../../src/engine/ngspice.ts';
import type { RunResult } from '../../src/engine/types.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { longestFullName, netlistToRun, SAVE_CURRENTS_LINE, utf8Bytes, VERSION_BYTES } from '../../src/spice/run-netlist.ts';

const root = resolve(import.meta.dirname, '../..');
let engine: NgspiceEngine;
beforeAll(async () => {
  engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
});

const w = (n: number, c = 'W'): string => c.repeat(n);
const DIVIDER = 'V1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n';
/** The five analyses of limit-1 and limit-2, on the same divider. */
const ANALYSES: Record<string, string> = {
  op: `${DIVIDER}.op\n`,
  dc: `${DIVIDER}.dc V1 0 9 3\n`,
  tran: `${DIVIDER}.tran 1u 10u\n`,
  ac: `${DIVIDER.replace('V1 a 0 9', 'V1 a 0 dc 9 ac 1')}.ac dec 2 1k 10k\n`,
  tf: `${DIVIDER}.tf v(b) V1\n`,
};
/** Native ngspice 47's vectors for these netlists with a title cut to 504 bytes, the same as with "* short" (limit-2). */
const NATIVE_47: Record<string, Record<string, number[]>> = {
  op: { 'v(a)': [9], 'v(b)': [6], 'i(v1)': [-0.003000000000000001] },
  dc: { 'v(v-sweep)': [0, 3, 6, 9], 'v(a)': [0, 3, 6, 9], 'v(b)': [0, 2, 4, 6], 'i(v1)': [0, -0.001, -0.002, -0.003000000000000001] },
  ac: { frequency: [1000, 3162.2776601683795, 10000.000000000002], 'v(a)': [1, 1, 1], 'v(b)': [2 / 3, 2 / 3, 2 / 3], 'i(v1)': [-0.0003333333333333334, -0.0003333333333333334, -0.0003333333333333334] },
  tf: { 'v(transfer_function)': [2 / 3], 'v(v1#input_impedance)': [2999.9999999999995], 'v(output_impedance_at_v(b))': [666.6666666666666] },
};

const vectors = (r: RunResult): Map<string, number[]> =>
  new Map(r.plots.flatMap((p) => p.variables.map((v, i) => [v.name.toLowerCase(), Array.from(p.real[i] ?? [])] as const)));
const crashed = (r: RunResult): boolean => r.diagnostics.some((d) => d.code === 'engine-crash' && /memory access out of bounds/.test(d.text));
/** What PlainSpice gives the engine for a text: the run copy, or nothing (undefined) when it does not run it. */
const runCopy = (text: string): string | undefined => {
  const run = netlistToRun(parseNetlist(text));
  return run.notRun ? undefined : run.text;
};

describe('limit-1: ngspice -b -r writes the title into a space of 513 bytes, so at most 504 bytes of it', () => {
  it('our engine has no check: past 504 bytes it runs on with its memory overwritten, and a longer title crashes it', async () => {
    const at505 = await engine.run(`* ${w(503)}\n${ANALYSES.op}.end\n`);
    expect(at505.ok).toBe(true); // native 47 and 42 stop here: "*** buffer overflow detected ***: terminated"
    expect((await engine.run(`* ${w(521)}\n${ANALYSES.op}.end\n`)).ok).toBe(true);
    // 524 to 527 bytes: a results file without its Binary: part or a crash, as what lies past the space
    // differs (524 gave either, depending on how the engine was started); from 528 bytes, a crash.
    const at524 = await engine.run(`* ${w(522)}\n${ANALYSES.op}.end\n`);
    expect(at524.ok).toBe(false);
    expect(crashed(at524) || at524.diagnostics.some((d) => /header without a Binary: or Values: section/.test(d.text))).toBe(true);
    expect(crashed(await engine.run(`* ${w(526)}\n${ANALYSES.op}.end\n`))).toBe(true);
    expect(crashed(await engine.run(`* ${w(598)}\n${ANALYSES.op}.end\n`))).toBe(true);
    expect(crashed(await engine.run(`* t\n${ANALYSES.op}.end\n.title ${w(800)}\n`))).toBe(true);
  });
});

describe('limit-2: the copy PlainSpice runs keeps 504 bytes of each title, and gives the numbers of a short title', () => {
  const titles: Record<string, (body: string) => string> = {
    'a title of 600 bytes': (body) => `* ${w(598)}\n${body}.end\n`,
    'a title of 251 ş and more (2 bytes each)': (body) => `* w${w(400, 'ş')}\n${body}.end\n`,
    '.title lines of 1000 bytes, in a subcircuit and after .end': (body) =>
      `* t\n.title ${w(1000)}\n${body}.subckt s p q\n  .TITLE ${w(1000)}\nRi p q 1k\n.ends\n.end\n.title ${w(1000)}\n`,
  };
  for (const [name, title] of Object.entries(titles)) {
    it.each(Object.keys(ANALYSES))(`${name}: %s`, async (analysis) => {
      const text = title(ANALYSES[analysis]!);
      const copy = runCopy(text);
      expect(copy).toBeDefined();
      const lines = copy!.split('\n');
      expect(utf8Bytes(lines[0]!)).toBeLessThanOrEqual(504);
      for (const line of lines.filter((l) => /^\s*\.title/i.test(l))) expect(utf8Bytes(line.replace(/^\s*\S*\s*/, ''))).toBeLessThanOrEqual(504);
      const cut = await engine.run(copy!);
      const short = await engine.run(netlistToRun(parseNetlist(`* short\n${ANALYSES[analysis]!}.end\n`)).text);
      expect(cut.ok).toBe(true);
      expect(cut.diagnostics).toEqual(short.diagnostics);
      const got = vectors(cut);
      expect(got).toEqual(vectors(short));
      for (const [vector, values] of Object.entries(NATIVE_47[analysis] ?? {})) {
        const mine = got.get(vector);
        expect(mine?.length, vector).toBe(values.length);
        values.forEach((v, i) => expect(agrees(mine![i]!, v), `${vector}[${i}]`).toBe(true));
      }
    });
  }
});

describe('limit-3: saving every current, ngspice copies each part’s full name into a space of 512 bytes', () => {
  it('names a part inside subcircuits by its letter, the X lines and its name, as PlainSpice works it out', async () => {
    const text = '* t\nV1 a 0 9\nR1 a b 1k\n.subckt s3 p q\nRz p q 1k\n.ends\n.subckt s2 p q\nXyy p q s3\nRw p q 1k\n.ends\n.subckt s1 p q\nXxx p q s2\n.ends\nXzz b 0 s1\n.op\n.end\n';
    const run = await engine.run(netlistToRun(parseNetlist(text)).text);
    expect([...vectors(run).keys()]).toContain(`i(@${longestFullName(parseNetlist(text))!.name}[i])`);
    expect(longestFullName(parseNetlist(text))?.name).toBe('r.xzz.xxx.xyy.rz');
  });

  it('our engine crashes on a name of 600 bytes with every current saved, and runs it without', async () => {
    const text = `* t\n${DIVIDER}R${w(599)} b 0 2k\n.op\n.end\n`;
    expect(crashed(await engine.run(text.replace('.end', `${SAVE_CURRENTS_LINE}\n.end`)))).toBe(true);
    expect((await engine.run(text)).ok).toBe(true);
    expect(runCopy(text)).toBeUndefined(); // a word of 600 bytes
  });

  it('our engine runs on past the end at 512 bytes (native ngspice too); the sanitized build stops there', async () => {
    const text = `* t\n${DIVIDER}R${w(511)} b 0 2k\n.op\n.options savecurrents\n.end\n`;
    const run = await engine.run(text);
    expect(run.ok).toBe(true);
    expect(vectors(run).get('v(b)')?.[0]).toBeCloseTo(4.5, 12);
  });

  it('PlainSpice runs full names of up to 250 bytes with every current saved, with native 47’s numbers, and no longer one', async () => {
    const nested = (r: number): string =>
      `* t\nV1 a 0 9\nR1 a b 1k\n.subckt s2 p q\nR${w(r - 1, 'r')} p q 1k\n.ends\n.subckt s1 p q\nX${w(99, 'y')} p q s2\n.ends\nX${w(99, 'z')} b 0 s1\n.op\n.end\n`;
    const at250 = netlistToRun(parseNetlist(nested(46)));
    expect(at250.notRun).toBeUndefined();
    expect(at250.added).toEqual([SAVE_CURRENTS_LINE]);
    const got = vectors(await engine.run(at250.text));
    // Native 47 (-b -r): v(b) = 4.5, i(@r.x….x….r…[i]) = 0.0045, i(@r1[i]) = 0.0045.
    expect(agrees(got.get('v(b)')![0]!, 4.5)).toBe(true);
    expect(agrees(got.get(`i(@r.x${w(99, 'z')}.x${w(99, 'y')}.r${w(45, 'r')}[i])`)![0]!, 0.0045)).toBe(true);
    expect(agrees(got.get('i(@r1[i])')![0]!, 0.0045)).toBe(true);
    expect(runCopy(nested(47))).toBeUndefined();
  });
});

describe('limit-4 to limit-7: words ngspice copies whole into 512 bytes are not given to it', () => {
  it('a formula with a v( and no ) crashes our engine (native ngspice: "stack smashing detected"); PlainSpice does not run it', async () => {
    for (const line of ['B1 c 0 V=v(b', 'E1 c 0 VALUE=v(b']) {
      const text = `* t\n${DIVIDER}${line}\nR3 c 0 1k\n.op\n.end\n`;
      expect(crashed(await engine.run(text)), line).toBe(true);
      expect(runCopy(text), line).toBeUndefined();
    }
  });

  it('a line ngspice does not read as a formula gets its own message, and runs', async () => {
    const text = `* t\n${DIVIDER}R3 c 0 v(b\nV3 c 0 1\n.op\n.end\n`;
    const run = await engine.run(runCopy(text)!);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toMatch(/mal formed resistor instance/);
  });

  it('at PlainSpice’s limits (words of 250 bytes, a v( … ) and a .control line of 500) everything runs, with the right numbers', async () => {
    const node = w(250, 'n');
    const text = `* t\nV1 a 0 9\nR1 a ${node} 1k\nR2 ${node} 0 2k\nR${w(249)} ${node} 0 2k\nB1 c 0 V=v(${node})*2\nR3 c 0 1k\n.op\n.end\n`;
    const run = await engine.run(runCopy(text)!);
    expect(run.ok).toBe(true);
    const got = vectors(run);
    expect(got.get(`v(${node})`)?.[0]).toBeCloseTo(4.5, 12);
    expect(got.get('v(c)')?.[0]).toBeCloseTo(9, 12);
    expect(got.get(`i(@r${w(249, 'w')}[i])`)?.[0]).toBeCloseTo(0.00225, 15);
    // An analysis command of 500 bytes as ngspice writes it: ".op 1 1 … 11".
    const command = `op ${'1 '.repeat(247)}11`;
    const control = await engine.run(runCopy(`* t\n${DIVIDER}.control\n${command}\nprint v(b)\n.endc\n.op\n.end\n`)!);
    expect(control.exitCode).toBe(0);
    expect(control.stdout).toMatch(/v\(b\) = 6\.000000e\+00/);
    expect(runCopy(`* t\n${DIVIDER}.control\n${command}1\n.endc\n.op\n.end\n`)).toBeUndefined();
  });
});

describe('limit-8: names ngspice copies nowhere run at any length, but PlainSpice keeps to 250 bytes', () => {
  it('a node name of 20,000 bytes runs in our engine with the right numbers', async () => {
    const node = w(20000, 'n');
    const run = await engine.run(`* t\nV1 a 0 9\nR1 a ${node} 1k\nR2 ${node} 0 2k\n.op\n.end\n`);
    expect(run.ok).toBe(true);
    expect(vectors(run).get(`v(${node})`)?.[0]).toBeCloseTo(6, 12);
    expect(runCopy(`* t\nV1 a 0 9\nR1 a ${node} 1k\nR2 ${node} 0 2k\n.op\n.end\n`)).toBeUndefined();
  });
});

describe('limit-5: an end-of-line comment starts where ngspice says, and a $ glued to a word starts none', () => {
  const at = (line: string): string => `* t\n${DIVIDER}${line}\nR3 c 0 1k\n.op\n.end\n`;
  it('a ; inside quotes and a $ after *: ngspice reads on to the v( with no ), our engine crashes, PlainSpice does not run them', async () => {
    for (const line of ['B1 c 0 V=v(b)*1 ";" + v(b', 'B1 c 0 V=1 *$ v(b']) {
      expect(crashed(await engine.run(at(line))), line).toBe(true);
      expect(runCopy(at(line)), line).toBeUndefined();
    }
    expect(runCopy(at('B1 c 0 V=1$+v(b'))).toBeUndefined(); // native 47 and 42: "stack smashing detected"
  });

  it('a $ after a blank, a comma or a tab, a ; and // start a comment: the line runs, c = v(b) = 6 V as in native 47', async () => {
    for (const line of ['B1 c 0 V=v(b) $ v(b', 'B1 c 0 V=v(b),$ v(b', 'B1 c 0 V=v(b)\t$ v(b', 'B1 c 0 V=v(b); v(b', 'B1 c 0 V=v(b) // v(b']) {
      const run = await engine.run(runCopy(at(line))!);
      expect(run.ok, line).toBe(true);
      expect(agrees(vectors(run).get('v(c)')![0]!, 6), line).toBe(true);
    }
  });
});

describe('limit-9: a part’s .model line copies its version into a space of 100 bytes', () => {
  const model = (n: number, used = true): string =>
    `* t\nV1 a 0 9\nR1 a b 1k\n${used ? 'M1 b b 0 0 mm\n' : ''}R2 b 0 2k\n.model mm nmos level=8 version=4${w(n - 1)}\n.op\n.end\n`;
  it('99 bytes: ngspice’s own message (our engine has no BSIM3); 150 bytes crashes our engine; a model no part uses is never read', async () => {
    const at99 = await engine.run(model(99));
    expect(at99.exitCode).toBe(1);
    expect(at99.stderr).toMatch(/could not find a valid modelname/);
    expect(crashed(await engine.run(model(150)))).toBe(true);
    expect(crashed(await engine.run(model(150).replace('level=8', 'level=14')))).toBe(true);
    expect((await engine.run(model(150, false))).ok).toBe(true);
  });

  it('from 105 bytes, where native 47 and 42 stop ("stack smashing detected"), our engine runs on with ngspice’s message up to 111 bytes and crashes from 112, at levels 8, 14, 49, 54 and 73 (last pass F9)', async () => {
    for (const level of ['level=8', 'level=14', 'level=49', 'level=54', 'level=73']) {
      for (const n of [105, 111]) {
        const run = await engine.run(model(n).replace('level=8', level));
        expect(run.exitCode, `${n} ${level}`).toBe(1);
        expect(run.stderr, `${n} ${level}`).toMatch(/could not find a valid modelname/);
      }
      expect(crashed(await engine.run(model(112).replace('level=8', level))), level).toBe(true);
    }
    expect((await engine.run(model(105, false))).ok).toBe(true);
  });

  it('PlainSpice gives ngspice a version of at most 90 bytes, below 100, where native 47 and 42 start to write past the space, at every level', () => {
    expect(VERSION_BYTES).toBe(90);
    expect(runCopy(model(90))).toBeDefined();
    expect(runCopy(model(91))).toBeUndefined();
    for (const n of [100, 104, 105]) expect(runCopy(model(n)), String(n)).toBeUndefined();
    expect(runCopy(model(91).replace('level=8', 'level=73'))).toBeUndefined();
  });
});

describe('limit-10: a .control block prints a name made inside subcircuits through spaces of 512 bytes', () => {
  /** A node inside two subcircuits: its full name is x….x….n…, `bytes` long. */
  const nested = (bytes: number, command: string, x = 250): string =>
    `* t\nV1 a 0 9\nR1 a b 1k\n.subckt inner p q\nRi p ${w(bytes - 2 * x - 2, 'n')} 1k\nRj ${w(bytes - 2 * x - 2, 'n')} q 1k\n.ends\n.subckt outer p q\nX${w(x - 1, 'b')} p q inner\n.ends\nX${w(x - 1, 'a')} b 0 outer\n.op\n.control\nop\n${command}\n.endc\n.end\n`;
  it('print: 511 bytes runs, 520 crashes our engine (native 47 and 42 stop from 512: "buffer overflow detected")', async () => {
    expect((await engine.run(nested(511, 'print all'))).exitCode).toBe(0);
    expect(crashed(await engine.run(nested(520, 'print all')))).toBe(true);
  });

  it('display: our engine runs on at 490 bytes, where native 47 and 42 stop ("buffer overflow detected")', async () => {
    const run = await engine.run(nested(490, 'display', 150));
    expect(run.exitCode).toBe(0);
    expect(run.ok).toBe(true);
  });

  it('PlainSpice runs full names of 250 bytes, printed, displayed and saved, and none longer', async () => {
    const at250 = runCopy(nested(250, 'print all\ndisplay', 100));
    expect(at250).toBeDefined();
    const run = await engine.run(at250!);
    expect(run.ok).toBe(true);
    expect(run.stdout).toContain(`x${w(99, 'a')}.x${w(99, 'b')}.${w(48, 'n')}`);
    // Native 47 and 42 (-b -r): the node halfway between b (6 V) and ground is at 3 V.
    expect(agrees(vectors(run).get(`v(x${w(99, 'a')}.x${w(99, 'b')}.${w(48, 'n')})`)![0]!, 3)).toBe(true);
    expect(runCopy(nested(251, 'print all', 100))).toBeUndefined();
    expect(runCopy(nested(600, '', 250).replace(/\.control[\s\S]*\.endc\n/, ''))).toBeUndefined();
  });
});

describe('limit-11: a .control block can make a name while it runs, which PlainSpice cannot see', () => {
  it('a 600-byte name made by joining short variables: native 47 and 42 stop, our engine runs on; the copy is the student’s', async () => {
    const text = `* t\n${DIVIDER}.op\n.control\nop\nset s = ${w(100, 'a')}\nset t = $s$s$s$s$s$s\nlet $t = 1\ndisplay\n.endc\n.end\n`;
    expect(runCopy(text)).toBeDefined();
    const run = await engine.run(text);
    expect(run.exitCode).toBe(0);
    expect(run.ok).toBe(true);
  });
});

describe('limit-12: ngspice reads the lines of circbyline commands as a netlist, with the same spaces', () => {
  const script = (lines: string[]): string => `*ng_script\n${lines.map((l) => `circbyline ${l}`).join('\n')}\nop\nprint all\n`;
  const nested = (node: number, x: number): string =>
    script(['* t', 'V1 a 0 9', 'R1 a b 1k', '.subckt inner p q', `Ri p ${w(node, 'n')} 1k`, `Rj ${w(node, 'n')} q 1k`, '.ends', '.subckt outer p q', `X${w(x - 1, 'b')} p q inner`, '.ends', `X${w(x - 1, 'a')} b 0 outer`, '.end']);
  it('a B source without its ) and a 520-byte node, built by an *ng_script file, crash our engine; PlainSpice does not run them', async () => {
    const noClose = script(['* t', 'V1 a 0 9', 'R1 a b 1k', 'R2 b 0 2k', 'B1 c 0 V=v(b', 'R3 c 0 1k', '.end']);
    expect(crashed(await engine.run(noClose))).toBe(true);
    expect(runCopy(noClose)).toBeUndefined();
    expect(crashed(await engine.run(nested(18, 250)))).toBe(true);
    expect(runCopy(nested(18, 250))).toBeUndefined();
  });

  it('set ngbehavior=ps before it: ngspice reads a $ in the built circuit as no comment, our engine crashes (native 47 and 42 too); PlainSpice does not run it', async () => {
    const lines = ['* inner', 'V1 a 0 9', 'R1 a b 1k', 'R2 b 0 2k', 'B1 c 0 V=1 $ + v(b', 'R3 c 0 1k', '.end'].map((l) => `*# circbyline ${l}`).join('\n');
    const text = (mode: string): string => `* t\nV9 z 0 1\nR9 z 0 1\n.op\n${mode}\n${lines}\n*# op\n.end\n`;
    expect(crashed(await engine.run(text('*# set ngbehavior=ps')))).toBe(true);
    expect(runCopy(text('*# set ngbehavior=ps'))).toBeUndefined();
    // Without it, the $ starts a comment there: B1 is V=1, and the circuit runs.
    const run = await engine.run(text('*# echo no mode'));
    expect(crashed(run)).toBe(false);
    expect(run.exitCode).toBe(0);
  });

  it('at PlainSpice’s limit, a node of 250 bytes, the circuit runs and prints what native 47 and 42 print', async () => {
    const copy = runCopy(nested(48, 100));
    expect(copy).toBeDefined();
    const run = await engine.run(copy!);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`x${w(99, 'a')}.x${w(99, 'b')}.${w(48, 'n')} = 3.000000e+00`);
  });
});

describe('limit-6: only analysis commands are written into 512 bytes; other .control lines run however long', () => {
  it('a print line of 525 bytes runs in our engine and prints what native 47 and 42 print; an op line of 508 bytes is not run', async () => {
    const text = `* t\n${DIVIDER}.op\n.control\nop\nprint${' v(b)'.repeat(104)}\n.endc\n.end\n`;
    const copy = runCopy(text);
    expect(copy).toBeDefined();
    const run = await engine.run(copy!);
    expect(run.exitCode).toBe(0);
    // Native 47 and 42 (-b -r and -b, exit 0): "v(b) = 6.000000e+00", once for each v(b).
    expect(run.stdout.match(/v\(b\) = 6\.000000e\+00/g)).toHaveLength(104);
    expect(runCopy(`* t\n${DIVIDER}.op\n.control\nop ${w(250)} ${w(250)} ${w(3)}\n.endc\n.end\n`)).toBeUndefined();
  });
});

describe('limit-5: ngspice cuts an end-of-line comment before it reads a name, so its words never reach a space', () => {
  it('a comment of 20,000 bytes runs in our engine with native 47’s numbers, and PlainSpice runs it', async () => {
    for (const comment of ['; ', '$ ', '// ']) {
      const copy = runCopy(`* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k ${comment}${w(20000)}\n.op\n.end\n`);
      expect(copy, comment).toBeDefined();
      const got = vectors(await engine.run(copy!));
      // Native 47 (-b -r): v(b) = 6, i(@r1[i]) = 0.003.
      expect(agrees(got.get('v(b)')![0]!, 6), comment).toBe(true);
      expect(agrees(got.get('i(@r1[i])')![0]!, 0.003), comment).toBe(true);
    }
  });
});

describe('limit-13: ngspice takes the blanks out of brackets on some lines, joining the words in them', () => {
  const save = (words: string): string => `* t\n${DIVIDER}.save i( ${words} ) v(b)\n.op\n.end\n`;
  it('a .save line’s i( … ) and a B source with an i( … ) of three 200-byte words crash our engine; PlainSpice does not run them', async () => {
    const meas = `* t\n${DIVIDER}B1 c 0 V=i(R1)*1+( ${w(200)} ${w(200)} ${w(200)} )\nR3 c 0 1k\n.op\n.end\n`;
    for (const text of [save(`${w(200)} ${w(200)} ${w(200)}`), save(`${w(200)}\t${w(200)}\t${w(200)}`), meas]) {
      expect(crashed(await engine.run(text))).toBe(true); // native 47 and 42: "buffer overflow detected" or "stack smashing detected"
      expect(runCopy(text)).toBeUndefined();
    }
  });

  it('with 511 letters in a B source’s brackets, our engine stops with native 47’s own message, not 42’s; PlainSpice does not run it', async () => {
    const text = `* t\n${DIVIDER}B1 c 0 V=i(R1)*1+( ${w(200)} ${w(200)} ${w(111)} )\nR3 c 0 1k\n.op\n.end\n`;
    const run = await engine.run(text);
    // Native 47, -b -r and -b: exit 1 with these lines. Native 42: exit 1, with "Netlist line no. 5:" in
    // place of 47's first line, before each of its messages.
    expect(run.exitCode).toBe(1);
    expect(crashed(run)).toBe(false);
    expect(run.stderr).toContain('Error in netlist line no. 8, new internal line no. 5:');
    expect(run.stderr).toContain(`Undefined parameter [${w(200, 'w')}`);
    expect(run.stderr).toContain('Cannot compute substitute');
    expect(run.stderr).not.toContain('Netlist line no. 5:');
    expect(runCopy(text)).toBeUndefined();
  });

  it('print v( … .x ): ngspice copies the joined name up to the dot into 512 bytes; PlainSpice does not run a joined name over 250 bytes', async () => {
    const text = (last: number): string => `* t\n${DIVIDER}.op\n.control\nop\nprint v( ${w(200)} ${w(200)} ${w(last)} .x )\n.endc\n.end\n`;
    // 512 bytes before the dot: native 47 and 42 run on, the sanitized build stops in vec_get; our engine runs on.
    expect((await engine.run(text(112))).exitCode).toBe(0);
    expect(runCopy(text(112))).toBeUndefined();
    expect(runCopy(`* t\n${DIVIDER}.op\n.control\nop\nprint v( ${w(123)} ${w(123)} )\n.endc\n.end\n`)).toBeDefined();
  });

  it('at PlainSpice’s limit, a joined word of 250 bytes, the copy runs with native 47’s numbers', async () => {
    const copy = runCopy(save(`${w(100)} ${w(100)} ${w(47)}`));
    expect(copy).toBeDefined();
    const got = vectors(await engine.run(copy!));
    // Native 47 (-b -r) on the same copy: v(b) = 6, i(@r1[i]) = i(@r2[i]) = 0.003.
    expect(agrees(got.get('v(b)')![0]!, 6)).toBe(true);
    expect(agrees(got.get('i(@r2[i])')![0]!, 0.003)).toBe(true);
  });
});

describe('limit-14: numparam joins quoted texts and string parameters, and puts the text in place of {…}', () => {
  const t600 = `"${w(200)}""${w(200)}""${w(200)}"`;
  const printed = (lines: string): string => `* t\nV1 a 0 9\nR1 a b 1k\n${lines}\n.op\n.control\nop\nprint all\n.endc\n.end\n`;
  it('a 600-byte text in .save i({t}), in a version, or as a node printed (from .param, a .subckt default, an X line) crashes our engine; PlainSpice does not run it', async () => {
    const texts = [
      `* t\n${DIVIDER}.param t=${t600}\n.save i({t}) v(b)\n.op\n.end\n`,
      `* t\nV1 a 0 9\nR1 a b 1k\nM1 b b 0 0 mm\nR2 b 0 2k\n.param t="4${w(74)}""${w(75)}"\n.model mm nmos level=8 version={t}\n.op\n.end\n`,
      printed(`.param t=${t600}\nR2 b {t} 2k\nR3 {t} 0 1k`),
      printed(`.subckt s p q params: t=${t600}\nRx p {t} 1k\nRy {t} q 1k\n.ends\nX1 b 0 s`),
      printed(`.subckt s p q params: t="a"\nRx p {t} 1k\nRy {t} q 1k\n.ends\nX1 b 0 s t=${t600}`),
    ];
    for (const text of texts) {
      expect(crashed(await engine.run(text)), text.slice(0, 60)).toBe(true); // native 47: "buffer overflow detected" or "stack smashing detected"
      expect(runCopy(text), text.slice(0, 60)).toBeUndefined();
    }
  });

  it('at PlainSpice’s limit, a text of 250 bytes as a node, printed, runs with native 47’s numbers', async () => {
    const copy = runCopy(printed(`.param t="${w(125)}""${w(125)}"\nR2 b {t} 2k\nR3 {t} 0 1k`));
    expect(copy).toBeDefined();
    const run = await engine.run(copy!);
    expect(run.exitCode).toBe(0);
    const got = vectors(run);
    // Native 47 (-b -r) on the same copy: v(b) = 6.75, the 250-byte node 2.25 (ngspice writes it in lower case).
    expect(agrees(got.get('v(b)')![0]!, 6.75)).toBe(true);
    expect(agrees(got.get(`v(${w(250, 'w')})`)![0]!, 2.25)).toBe(true);
  });
});

describe('limit-15: a .probe line’s names, and the formula it writes for p(…)', () => {
  const probed = (name: number): string => {
    const part = `R${w(name - 1, 'r')}`;
    return `* t\nV1 ${w(250, 'a')} 0 9\n${part} ${w(250, 'a')} ${w(250, 'b')} 1k\nR2 ${w(250, 'b')} 0 2k\n.probe p(${part})\n.op\n.end\n`;
  };
  it('p(…) of a 245-byte part writes a formula word of 520 bytes: our engine crashes (the sanitized build stops in inp_modify_exp); PlainSpice does not run it', async () => {
    expect(crashed(await engine.run(probed(245)))).toBe(true);
    expect(runCopy(probed(245))).toBeUndefined();
    expect(runCopy(probed(226))).toBeUndefined();
  });

  it('at PlainSpice’s limit, a formula word of 500 bytes, the copy runs with native 47’s numbers: 9 mW in the part', async () => {
    const copy = runCopy(probed(225));
    expect(copy).toBeDefined();
    const got = vectors(await engine.run(copy!));
    // Native 47 (-b -r) on the same copy: r…:power = 0.009, v(b…) = 6.
    expect(agrees(got.get(`r${w(224, 'r')}:power`)![0]!, 0.009)).toBe(true);
    expect(agrees(got.get(`v(${w(250, 'b')})`)![0]!, 6)).toBe(true);
  });
});

describe('limit-16: a circuit built with circbyline has a title, and builds no circuit itself', () => {
  const script = (title: string): string => `*ng_script\ncircbyline ${title}\ncircbyline V1 a 0 9\ncircbyline R1 a b 1k\ncircbyline R2 b 0 2k\ncircbyline .op\ncircbyline .end\nop\nprint all\n`;
  const title = (last: string): string => `* ${'ab '.repeat(166)}${last}`;
  it('a title of 505 bytes made of short words: native 47 and 42 stop (-b -r), our engine runs on; PlainSpice does not run it', async () => {
    expect((await engine.run(script(title('abcde')))).exitCode).toBe(0);
    expect(runCopy(script(title('abcde')))).toBeUndefined();
  });

  it('a title of 504 bytes runs, and prints what native 47 and 42 print', async () => {
    const copy = runCopy(script(title('abcd')));
    expect(copy).toBeDefined();
    const run = await engine.run(copy!);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('a = 9.000000e+00');
    expect(run.stdout).toContain('b = 6.000000e+00');
  });

  it('a circbyline command inside a built circuit: native 47 and 42 crash (exit 139), our engine reads no circuit; PlainSpice does not run it', async () => {
    const nested = `*ng_script\ncircbyline *ng_script\ncircbyline circbyline * inner\ncircbyline circbyline V1 a 0 1\ncircbyline circbyline R1 a 0 2\ncircbyline circbyline .end\ncircbyline op\ncircbyline print all\ncircbyline .end\necho outer-done\n`;
    const run = await engine.run(nested);
    expect(run.stderr).toMatch(/there aren't any circuits loaded/);
    expect(runCopy(nested)).toBeUndefined();
  });
});

describe('limit-17: print and write name a formula with its text, and meas writes a wrong word into 100 bytes', () => {
  const control = (lines: string): string => `* t\n${DIVIDER}.op\n.control\nop\n${lines}\n.endc\n.end\n`;
  const sum = (terms: number): string => `v(b)${'+v(b)'.repeat(terms - 1)}`;
  it('write of a 999-byte formula crashes our engine, print runs on (native 47 and 42: "buffer overflow detected" from 514 bytes); PlainSpice does not run them', async () => {
    expect(crashed(await engine.run(control(`write out.raw ${sum(200)}`)))).toBe(true);
    expect((await engine.run(control(`print ${sum(200)}`))).exitCode).toBe(0);
    expect(runCopy(control(`write out.raw ${sum(200)}`))).toBeUndefined();
    expect(runCopy(control(`print ${sum(103)}`))).toBeUndefined();
  });

  it('at PlainSpice’s limit, a formula of 249 bytes, print gives what native 47 and 42 give', async () => {
    const copy = runCopy(control(`print ${sum(50)}`));
    expect(copy).toBeDefined();
    const run = await engine.run(copy!);
    expect(run.exitCode).toBe(0);
    // Native 47 and 42 (-b -r): "v(b)+v(b)+… = 3.000000e+02" (50 times 6 V).
    expect(run.stdout).toContain(`${sum(50)} = 3.000000e+02`);
  });

  it('meas with a vector of 79 bytes that does not exist: the sanitized build stops in measure_parse_trigtarg (100 bytes), our engine runs on; PlainSpice gives meas words of at most 50 bytes', async () => {
    const meas = (word: string): string => `* t\nV1 a 0 sin(0 1 1k)\nR1 a b 1k\nR2 b 0 2k\n.tran 10u 2m\n.control\ntran 10u 2m\nmeas tran x max ${word}\n.endc\n.end\n`;
    const run = await engine.run(meas(w(79)));
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toMatch(/no such vector as/);
    expect(runCopy(meas(w(79)))).toBeUndefined();
    expect(runCopy(meas(w(51)))).toBeUndefined();
    expect(runCopy(meas('v(b)'))).toBeDefined();
  });
});

describe('limit-18: the lines ngspice runs as commands', () => {
  const op512 = `op ${w(250)} ${w(250)} ${w(6)}`;
  it('*#, ## and ;# lines, the commands a ; separates on them, and a .control block and a *# line after .end are commands to our engine too', async () => {
    const text = `* t\n${DIVIDER}.op\n*# echo star-hash\n## echo hash-hash\n;# echo semi-hash\n=# echo eq-hash\n   *# echo blank-star-hash\n*# echo first ; echo second\n.end\n*# echo after-end-star\n.control\necho after-end-control\n.endc\n`;
    const run = await engine.run(text);
    // Native 47 prints the same nine lines (42 refuses ##).
    for (const said of ['star-hash', 'hash-hash', 'semi-hash', 'eq-hash', 'blank-star-hash', 'first', 'second', 'after-end-star', 'after-end-control']) expect(run.stdout.split('\n'), said).toContain(said);
    expect(runCopy(text)).toBeDefined();
  });

  it('an analysis command written into 512 bytes from such a line: native 47 and 42 stop ("buffer overflow detected"), our engine runs on; PlainSpice does not run it', async () => {
    const script = `*ng_script\n${['* t', ...DIVIDER.trimEnd().split('\n'), '.end'].map((l) => `circbyline ${l}`).join('\n')}\n`;
    for (const text of [
      `* t\n${DIVIDER}.op\n*# ${op512}\n.end\n`,
      `* t\n${DIVIDER}.op\n;# ${op512}\n.end\n`,
      `* t\n${DIVIDER}.op\n*# echo first ; ${op512}\n.end\n`,
      `* t\n${DIVIDER}.op\n.end\n.control\n${op512}\n.endc\n`,
      `* t\n${DIVIDER}.op\n;# op\n+ ${w(250)} ${w(250)} ${w(6)}\n.end\n`,
      `* t\n${DIVIDER}.op\n.control\npre_circbyline * u\npre_circbyline V1 a 0 9\npre_circbyline R1 a 0 1k\npre_circbyline .end\npre_${op512}\n.endc\n.end\n`,
      `${script};${op512}\n`,
    ]) {
      const run = await engine.run(text);
      expect(crashed(run), text.slice(-80)).toBe(false);
      expect(run.exitCode, text.slice(-80)).toBe(0);
      expect(runCopy(text), text.slice(-80)).toBeUndefined();
    }
  });

  it('a + line after .end continues the line before .end: a B source without its ) is read past the line; PlainSpice does not run it, and runs it with the ), with native 47’s numbers', async () => {
    const text = (plus: string): string => `* t\n${DIVIDER}.op\nR3 c 0 1k\nB1 c 0 V=1+\n.end\n+ ${plus}\n`;
    // Native 47 and 42: "stack smashing detected"; our engine stops on the bytes it read past the line.
    const broken = await engine.run(text('v(b'));
    expect(broken.ok).toBe(false);
    expect(runCopy(text('v(b'))).toBeUndefined();
    const run = await engine.run(runCopy(text('v(b)'))!);
    // Native 47 (-b -r): v(c) = 1 + v(b) = 7.
    expect(agrees(vectors(run).get('v(c)')![0]!, 7)).toBe(true);
  });

  it('the lines after .end are circuit lines to our engine as to native 47: R3 and R4 there take v(b) to 4.5 V, and a B source there without its ) crashes it; PlainSpice does not run that', async () => {
    const after = (lines: string): string => `* t\n${DIVIDER}.op\n.end\n${lines}`;
    const run = await engine.run(runCopy(after('R3 c 0 1k\nR4 c b 1k\n'))!);
    // Native 47 (-b -r): v(b) = 4.5, v(c) = 2.25.
    expect(agrees(vectors(run).get('v(b)')![0]!, 4.5)).toBe(true);
    expect(agrees(vectors(run).get('v(c)')![0]!, 2.25)).toBe(true);
    const broken = after('B1 c 0 V=v(b\nR3 c 0 1k\n');
    expect(crashed(await engine.run(broken))).toBe(true); // native 47 and 42: "stack smashing detected"
    expect(runCopy(broken)).toBeUndefined();
  });

  it('a circuit built by *# circbyline lines with a title of 601 bytes crashes our engine (native 47 and 42 -b -r: "buffer overflow detected"); PlainSpice does not run it', async () => {
    const text = `* t\n${DIVIDER}.op\n*# circbyline * ${'ab '.repeat(200).trimEnd()}\n*# circbyline V1 a 0 9\n*# circbyline R1 a 0 1k\n*# circbyline .op\n*# circbyline .end\n*# op\n.end\n`;
    expect(crashed(await engine.run(text))).toBe(true);
    expect(runCopy(text)).toBeUndefined();
  });

  it('at PlainSpice’s limit, a *# analysis command of 500 bytes runs and prints what native 47 and 42 print', async () => {
    const copy = runCopy(`* t\n${DIVIDER}.op\n*# op ${'1 '.repeat(247)}11\n*# print v(b)\n.end\n`);
    expect(copy).toBeDefined();
    expect((await engine.run(copy!)).stdout).toContain('v(b) = 6.000000e+00');
  });
});

describe('limit-19: a command’s words as ngspice’s control reader makes them', () => {
  it('our engine reads them as native 47 does: \\" starts a quote, blanks in quotes stay, a comma ends a word, {a,b} in brackets makes two, ~ is its home folder', async () => {
    const run = await engine.run(`* t\n${DIVIDER}.op\n.control\necho a\\"b   c"\necho 'x    y'\necho p,q\necho (p,q)\necho ({a,b})\necho {a,b}\necho ~\necho ~/x\necho "~"\n.endc\n.end\n`);
    const lines = run.stdout.split('\n');
    // Native 47 prints the same, with /root for /home/web_user; {a,b} outside brackets is two words, "{a" and "b}": "Error: missing }."
    for (const said of ['a"b   c"', 'x    y', 'p q', '(p,q)', '(a) (b)', '/home/web_user', '/home/web_user/x', '~']) expect(lines, said).toContain(said);
    expect(run.stderr).toMatch(/Error: missing }\./);
  });

  it('choices in braces and blanks in quotes make a command longer than it looks: our engine crashes or runs on (native 47 and 42 stop); PlainSpice does not run them', async () => {
    const braced = `* t\n${DIVIDER}.control\nop\nprint ({v(b),v(b)}{,}{,}{,}{,}{,}{,}{,})+ v(b)\n.endc\n.end\n`;
    expect(crashed(await engine.run(braced))).toBe(true);
    expect(runCopy(braced)).toBeUndefined();
    for (const text of [
      `* t\n${DIVIDER}.control\nop x({aaaaaaaaaa,bbbbbbbbbb}{1,2}{1,2}{1,2}{1,2}{1,2})\nprint v(b)\n.endc\n.end\n`,
      `* t\n${DIVIDER}.op\n*# op '${' '.repeat(600)}'\n.end\n`,
      `* t\n${DIVIDER}.op\n*# op \\"${' '.repeat(600)}"\n.end\n`,
    ]) {
      const run = await engine.run(text);
      expect(crashed(run), text.slice(-60)).toBe(false);
      expect(run.exitCode, text.slice(-60)).toBe(0);
      expect(runCopy(text), text.slice(-60)).toBeUndefined();
    }
    // In a .control block ngspice makes the blanks one first: it runs, and so does PlainSpice.
    const collapsed = `* t\n${DIVIDER}.op\n.control\nop '${' '.repeat(600)}'\nprint v(b)\n.endc\n.end\n`;
    expect((await engine.run(runCopy(collapsed)!)).stdout).toContain('v(b) = 6.000000e+00');
  });

  it('a ~ is 14 bytes in our engine: op and 40 of them is 603 bytes there, which it runs on (natively, /root, 243); with 33, 498 bytes, PlainSpice runs it', async () => {
    const tildes = (n: number): string => `* t\n${DIVIDER}.op\n.control\nop${' ~'.repeat(n)}\nprint v(b)\n.endc\n.end\n`;
    expect((await engine.run(tildes(40))).exitCode).toBe(0);
    expect(runCopy(tildes(40))).toBeUndefined();
    const copy = runCopy(tildes(33));
    expect(copy).toBeDefined();
    expect((await engine.run(copy!)).stdout).toContain('v(b) = 6.000000e+00');
  });
});

describe('limit-16: a .title line of a circuit built with circbyline is its title', () => {
  const built = (n: number): string =>
    `* t\nV9 z 0 1\nR9 z 0 1\n.op\n.control\ncircbyline * short\ncircbyline .title ${Array.from({ length: Math.floor((n + 1) / 3) }, () => 'ab').join(' ').padEnd(n, 'x')}\ncircbyline V1 a 0 9\ncircbyline R1 a b 1k\ncircbyline R2 b 0 2k\ncircbyline .op\ncircbyline .end\nop\nprint v(b)\n.endc\n.end\n`;
  it('599 bytes crash our engine, 505 run on (native 47 and 42 -b -r stop from 505: "buffer overflow detected"); PlainSpice does not run them', async () => {
    expect(crashed(await engine.run(built(599)))).toBe(true);
    expect((await engine.run(built(505))).exitCode).toBe(0);
    expect(runCopy(built(599))).toBeUndefined();
    expect(runCopy(built(505))).toBeUndefined();
  });

  it('504 bytes run, and print what native 47 and 42 print', async () => {
    const copy = runCopy(built(504));
    expect(copy).toBeDefined();
    expect((await engine.run(copy!)).stdout).toContain('v(b) = 6.000000e+00');
  });
});

describe('limit-17: a formula’s name keeps one blank between its words, and fft, psd, spec and asciiplot copy it too', () => {
  const control = (lines: string): string => `* t\n${DIVIDER}.op\n.control\nop\n${lines}\n.endc\n.end\n`;
  const spaced = (n: number): string => Array.from({ length: n }, () => 'v(b)').join(' + ');
  const sum = (terms: number): string => `v(b)${'+v(b)'.repeat(terms - 1)}`;
  const tran = (line: string): string => `* t\nV1 a 0 sin(0 1 1k)\nR1 a b 1k\nR2 b 0 2k\n.tran 10u 2m\n.control\ntran 10u 2m\n${line}\n.endc\n.end\n`;

  it('a print formula of 74 terms joined by " + " (515 bytes) and fft, psd, spec and asciiplot of a long formula: our engine runs on (native 47 and 42 stop); PlainSpice does not run them', async () => {
    for (const text of [control(`print ${spaced(74)}`), control(`asciiplot ${sum(103)}`), tran(`fft ${sum(200)}`), tran(`psd 10 ${sum(200)}`), tran(`spec 500 10000 500 ${sum(200)}`)]) {
      const run = await engine.run(text);
      expect(run.exitCode, text.slice(-60)).toBe(0);
      expect(runCopy(text), text.slice(-60)).toBeUndefined();
    }
  });

  it('at PlainSpice’s limit, 36 terms joined by " + " (249 bytes), print gives what native 47 and 42 give', async () => {
    const copy = runCopy(control(`print ${spaced(36)}`));
    expect(copy).toBeDefined();
    expect((await engine.run(copy!)).stdout).toContain(`${spaced(36)} = 2.160000e+02`);
  });

  it('ngspice adds quotes to an argument that starts with a digit, and writes a name with v(" again in 99 bytes: our engine prints what native 47 and 42 print', async () => {
    const one = (formula: string): string => `* t\nV1 a 0 9\nR1 a 1p 1k\nR2 1p 0 2k\n.op\n.control\nop\nprint ${formula}\n.endc\n.end\n`;
    const pairs = (n: number): string => Array.from({ length: n }, () => 'v(a,1p)').join('+');
    const copy = runCopy(one(pairs(25)));
    expect(copy).toBeDefined();
    // v(a,1p) = 9 - 6 = 3 V, 25 times; the name keeps the quotes: 249 bytes.
    expect((await engine.run(copy!)).stdout).toContain(`${pairs(25).replaceAll('1p', '"1p"')} = 7.500000e+01`);
    expect(runCopy(one(pairs(26)))).toBeUndefined();
    const singles = Array.from({ length: 120 }, () => 'v(1p)').join('+');
    const run = await engine.run(runCopy(one(singles))!);
    expect(run.stdout).toContain(`${singles.slice(0, 99)} = 7.200000e+02`);
  });
});
