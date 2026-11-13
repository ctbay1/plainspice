/**
 * docs/spice-facts/limits.md, checked in our WebAssembly engine: where ngspice copies a title or a
 * name into a space of fixed size (limit-1 to limit-12), what the engine does past the end of it, and
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
import { longestFullName, netlistToRun, SAVE_CURRENTS_LINE, utf8Bytes } from '../../src/spice/run-netlist.ts';

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
    const command = `op ${'1 '.repeat(300)}`.slice(0, 500);
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

  it('PlainSpice gives ngspice a version of at most 90 bytes', () => {
    expect(runCopy(model(90))).toBeDefined();
    expect(runCopy(model(91))).toBeUndefined();
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

  it('at PlainSpice’s limit, a node of 250 bytes, the circuit runs and prints what native 47 and 42 print', async () => {
    const copy = runCopy(nested(48, 100));
    expect(copy).toBeDefined();
    const run = await engine.run(copy!);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`x${w(99, 'a')}.x${w(99, 'b')}.${w(48, 'n')} = 3.000000e+00`);
  });
});
