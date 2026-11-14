/**
 * The integration check of the last pass's lanes (14 November 2026; decision 0017, "After the integration
 * check"): subcircuits the main circuit does not use (facts A3f and A3i in docs/spice-facts/explanations.md).
 *
 * - X2: the walk out of such a subcircuit, which names the X lines that use it, stops after three steps of
 *   at most three X lines each, so its work, its memory and its words grow with the netlist, not with its
 *   square: a chain of 4,000 subcircuits made 8 million steps and about 1 GB, and one note named a chain of
 *   500 in 37,257 characters.
 * - P1: ngspice turns the lines of such a subcircuit into comments before it checks them, so a line that
 *   stops it elsewhere says nothing there and the run gives the main circuit's answers (A3i); the checks
 *   said it stops ("ngspice does not know .foo"), the status line called the right numbers "not answers",
 *   and Explain said ngspice stops at the line. What ngspice still reads there keeps its words.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { solve } from '../../src/notebook/index.ts';
import { explainLine, skippedBecause, unusedSubcircuit } from '../../src/spice/explain.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { checkTraps } from '../../src/spice/traps.ts';

const root = resolve(import.meta.dirname, '../..');
let engine: Promise<NgspiceEngine>;
beforeAll(() => {
  engine = NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(root, 'engine/dist/ngspice.wasm')));
});

const BASE = '* t\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n';
/** s1 … sn, each holding X1 that uses the next, then s(n+1); the main circuit uses none. An .op in each, in the last only, or in none. */
const chain = (n: number, op: 'each' | 'inner' | 'none'): string => {
  const lines: string[] = [];
  for (let k = 1; k <= n; k++) lines.push(`.subckt s${k} a`, 'R1 a 0 1k', `X1 a s${k + 1}`, ...(op === 'each' || (op === 'inner' && k === n) ? ['.op'] : []), '.ends');
  lines.push(`.subckt s${n + 1} a`, 'R1 a 0 1k', '.ends');
  return `${BASE}${lines.join('\n')}\n.end\n`;
};
/** n subcircuits c1 … cn, each used once by an X line of a, which m X lines of b use; the main circuit uses none of them. */
const fanIn = (n: number, m: number): string =>
  `${BASE}.subckt b p\n${Array.from({ length: m }, (_, k) => `X${k + 1} p a`).join('\n')}\n.ends\n.subckt a p\n${Array.from({ length: n }, (_, k) => `X${k + 1} p c${k + 1}`).join('\n')}\n.ends\n${Array.from({ length: n }, (_, k) => `.subckt c${k + 1} q\nR1 q 0 1k\n.op\n.ends`).join('\n')}\n.end\n`;

describe('X2: the walk out of a subcircuit the main circuit does not use grows with the netlist, not with its square (A3f)', () => {
  /** The steps the walk keeps, and the X lines they name, summed over every subcircuit: counts, never times, so the load cannot change them. */
  const kept = (text: string): { steps: number; xs: number } => {
    const n = parseNetlist(text);
    const seen = new Set<number>();
    let steps = 0;
    let xs = 0;
    for (const l of n.lines) {
      const u = unusedSubcircuit(n, l.index);
      if (!u || seen.has(u.line)) continue;
      seen.add(u.line);
      steps += u.through.length;
      for (const t of u.through) xs += t.xs.length;
    }
    return { steps, xs };
  };

  it('a chain of 4,000 subcircuits keeps at most three steps for each, with no analysis line in it too, and four times the chain keeps four times the steps (8,002,000 steps before, ×16)', () => {
    const small = kept(chain(1000, 'none'));
    const large = kept(chain(4000, 'none'));
    expect(large.steps).toBeLessThanOrEqual(3 * 4001);
    expect(large.steps / small.steps).toBeLessThan(4.1);
  });

  it('1,000 subcircuits, each used by one X line of a, which 1,000 X lines of b use: one step each, never b\'s 1,000 X lines (1,002,000 X lines named before)', () => {
    expect(kept(fanIn(1000, 1000))).toEqual({ steps: 1000, xs: 1000 });
  });

  it('the checks read four times the lines for a chain four times as long (the walk read them again for every step out: ×12.7)', () => {
    /** How many of the netlist's lines `f` reads, counted through a Proxy (as critic1-6's test counts them). */
    const reads = (text: string): number => {
      const parsed = parseNetlist(text);
      let count = 0;
      const lines = new Proxy(parsed.lines, { get: (t, k, r) => ((typeof k === 'string' && /^\d+$/.test(k) && count++), Reflect.get(t, k, r)) });
      checkTraps({ ...parsed, lines });
      return count;
    };
    expect(reads(chain(2000, 'each')) / reads(chain(500, 'each'))).toBeLessThan(5);
  });

  it('the words name up to three steps out; past them, or past three X lines in one step, "which the main circuit does not use, directly or through other subcircuits"', () => {
    const because = (text: string): string => {
      const n = parseNetlist(text);
      return skippedBecause(unusedSubcircuit(n, n.analyses[0]!)!, false);
    };
    // s4 → s3 → s2 → s1, which no X line uses: three steps, named in full.
    expect(because(chain(4, 'inner'))).toBe('which only X1 uses, and X1 is inside the subcircuit s3, which only X1 uses, and X1 is inside the subcircuit s2, which only X1 uses, and X1 is inside the subcircuit s1, which no X line uses');
    // One more: three steps, then what holds of s2.
    expect(because(chain(5, 'inner'))).toBe('which only X1 uses, and X1 is inside the subcircuit s4, which only X1 uses, and X1 is inside the subcircuit s3, which only X1 uses, and X1 is inside the subcircuit s2, which the main circuit does not use, directly or through other subcircuits');
    const xs = (k: number): string => `${BASE}.subckt outer p q\n${Array.from({ length: k }, (_, i) => `X${i + 1} p q inner`).join('\n')}\n.ends\n.subckt inner a b\nR9 a b 1k\n.op\n.ends\n.end\n`;
    expect(because(xs(3))).toBe('which only X1, X2 and X3 use, and they are inside the subcircuit outer, which no X line uses');
    expect(because(xs(4))).toBe('which the main circuit does not use, directly or through other subcircuits');
  });

  it('the innermost .op of a chain of 500: Explain\'s note, the run\'s message and its summary stay a sentence (Explain\'s note was 37,257 characters, the status line 28,939)', async () => {
    const all = parseNetlist(chain(500, 'each'));
    const note = explainLine(all, all.analyses.at(-1)!)!.notes[0]!;
    expect(note.length).toBeLessThan(600);
    expect(note).toMatch(/^ngspice skips this line: it is inside the subcircuit s500 \(from line \d+\), which only X1 uses, and X1 is inside the subcircuit s499 .*, which the main circuit does not use, directly or through other subcircuits\. Put analysis lines in the main circuit, outside \.subckt … \.ends\.$/);
    const s = await solve(chain(500, 'inner'), await engine);
    expect(s.status).toBe('failed');
    expect(s.words.warnings[0]!.title).toBe('.op is inside the subcircuit s500, which only X1 uses, and X1 is inside the subcircuit s499, which only X1 uses, and X1 is inside the subcircuit s498, which only X1 uses, and X1 is inside the subcircuit s497, which the main circuit does not use, directly or through other subcircuits');
    expect(s.words.summary.length).toBeLessThan(400);
  }, 60000);
});

describe('P1: a line in a subcircuit the main circuit does not use is skipped, so no check speaks for it and Explain says so (A3i)', () => {
  const SUB = `${BASE}.subckt s a b\nR9 a b 1k\n`;
  /** A line alone in the subcircuit s, which no X line uses, or which X1 uses (`used`). */
  const inS = (line: string, used = false): string => `${SUB}${line}\n.ends\n${used ? 'X1 out 0 s\n' : ''}.op\n.end\n`;
  const ids = (text: string): string[] => checkTraps(parseNetlist(text)).map((t) => t.id);
  const SKIPS = 'ngspice skips this line: it is inside the subcircuit s (from line 5), and no X line uses that subcircuit.';

  it('the reviewer\'s netlist: no error that ngspice stops at .foo, the status is "ok", and Explain says ngspice skips the .foo (native 47 and 42: exit 0, out = 2.5 V)', async () => {
    const text = `${SUB}.tran 0 -1\n.foo bar\n.ends\n.op\n.end\n`;
    expect(ids(text)).toEqual([]);
    const s = await solve(text, await engine);
    expect([s.status, s.words.warnings]).toEqual(['ok', []]);
    const foo = explainLine(parseNetlist(text), 7)!;
    expect([foo.heading, foo.summary, foo.notes]).toEqual(['.foo: unknown dot command', '', [SKIPS]]);
  }, 30000);

  it('each line the reviewer listed: no check while no X line uses the subcircuit, and its check once X1 does', () => {
    const cases: [string, string][] = [
      ['.foo bar', 'unknown-dot-command'],
      ['R8 a b', 'missing-value'],
      ['E1 a 0 b', 'missing-fields'],
      ['X5 a b nosuch', 'missing-subcircuit'],
      ['Q1 a b 0 nomodel', 'missing-model'],
      ['V3 a b 1 p', 'space-before-suffix'],
      ['R7 a b 1M', 'mega-as-milli'],
      ['E2 a 0 POLY(1) b 0 0 2', 'model-not-in-engine'],
      ['R8 a b {xx}', 'fatal-syntax'],
      // A + line and a line that is no part are skipped too (the round-1 critic of these fixes, C1-5; native 47 and 42: exit 0).
      ['R8 a b\n+ 1 k', 'space-before-suffix'],
      ['Q7 a b 0\n+ nomodel', 'missing-model'],
      ['1k a b', 'unknown-letter'],
    ];
    for (const [line, id] of cases) {
      expect(ids(inS(line)), line).toEqual([]);
      expect(ids(inS(line, true)), line).toContain(id);
    }
  });

  it('Explain: every line ngspice skips there says so, a meaning that says ngspice stops at a word is gone, and an analysis line keeps its own words', () => {
    const n = parseNetlist(`${SUB}V3 a b 1 p\n.tran 0 -1\n.ends\n.op\n.end\n`);
    expect(explainLine(n, 5)!.notes).toEqual([SKIPS]);
    const v3 = explainLine(n, 6)!;
    expect([v3.notes, v3.fields.find((f) => f.text === 'p')?.meaning]).toEqual([[SKIPS], 'a word PlainSpice cannot place on this line']);
    expect(explainLine(n, 7)!.notes).toEqual([`${SKIPS.slice(0, -1)}. Put analysis lines in the main circuit, outside .subckt … .ends.`]);
    expect(explainLine(n, 8)!.notes).toEqual([SKIPS]);
    // A summary that says what ngspice does when it reads the line goes: .foo (it stops), .save (the results keep only v(in)), .print (left out with a message), .control (it runs the block).
    for (const line of ['.foo bar', '.save v(in)', '.print op v(out)', '.lib models.lib']) expect(explainLine(parseNetlist(inS(line)), 6)!.summary, line).toBe('');
    expect(explainLine(parseNetlist(inS('.control\necho hi\n.endc')), 6)!.summary).toBe('');
    expect(explainLine(parseNetlist(inS('.param p=2')), 6)!.summary).toBe('Gives a name to a number: write the name in braces, {name}, where you need the number.');
    // Used, the same lines keep what they said.
    const used = parseNetlist(inS('V3 a b 1 p', true));
    expect(explainLine(used, 6)!.notes.join(' ')).not.toContain('skips');
    expect(explainLine(used, 6)!.fields.find((f) => f.text === 'p')?.meaning).toContain('ngspice stops');
  });

  it('a subcircuit only X2 uses, X2 being a line of one no X line uses: its lines are skipped too, and Explain names the X line', () => {
    const text = `${BASE}.subckt outer p q\nX2 p q inner\n.ends\n.subckt inner a b\nR9 a b 1k\n.foo bar\n.ends\n.op\n.end\n`;
    expect(ids(text)).toEqual([]);
    expect(explainLine(parseNetlist(text), 9)!.notes).toEqual(['ngspice skips this line: it is inside the subcircuit inner (from line 8), which only X2 uses, and X2 is inside the subcircuit outer (from line 5), which no X line uses.']);
  });

  it('what ngspice reads there keeps its check and its words: an .include, a .lib with a file and a section, a *# line, a V line with one node', () => {
    expect(ids(inS('.include models.lib'))).toEqual(['include-not-available']);
    expect(ids(inS('.lib models.lib tt'))).toEqual(['include-not-available']);
    expect(ids(inS('.lib models.lib'))).toEqual([]);
    expect(explainLine(parseNetlist(inS('*# echo hello')), 6)!.notes.join(' ')).not.toContain('skips');
    expect(ids(inS('V3 a'))).toEqual(['missing-fields']);
    expect(explainLine(parseNetlist(inS('V3 a')), 6)!.notes.join(' ')).not.toContain('skips');
  });

  it('where ngspice does not turn the lines into comments first, every check stays: a .if line in the netlist, a subcircuit inside a used one, .subckt and .ends lines that do not pair up', () => {
    const withIf = `${SUB}E1 a 0 VALUE=3\n.ends\n.param flag=1\n.if (flag == 1)\nR3 out 0 1g\n.endif\n.op\n.end\n`;
    expect(ids(withIf)).toEqual(['fatal-syntax']);
    const nested = `${BASE}X1 out 0 outer\n.subckt outer p q\nR8 p q 1g\n.subckt s a b\nR9 a b 1k\nE1 a 0 VALUE=3\n.ends\n.ends\n.op\n.end\n`;
    expect(ids(nested)).toEqual(['fatal-syntax']);
    expect(ids(`${SUB}.foo bar\n.op\n.end\n`)).toContain('unknown-dot-command');
  });

  it('the checks of the main circuit, and of the lines after a .end written inside the subcircuit, stay', () => {
    expect(ids(`${BASE}R7 out 0 1M\n.subckt s a b\nR8 a b 1M\n.ends\n.op\n.end\n`)).toEqual(['mega-as-milli']);
    // ngspice reads past that .end and builds R7 (native 47 and 42: out = 1.667 V), so the line after it keeps its check.
    expect(ids(`${SUB}.end\n.ends\nR7 out 0 1k\n.op\n.end\n`)).toEqual(['after-end']);
  });

  it('a misspelt .tarn there is skipped, so the netlist has no analysis line: the check that says so speaks (it kept quiet for "Did you mean .tran?")', () => {
    expect(ids(`${SUB}.tarn 1u 1m\n.ends\n.end\n`)).toEqual(['no-analysis']);
  });

  it('with the only .op and a .foo there, the run\'s reason is the skipped .op, never an error that ngspice stops at the .foo', async () => {
    const s = await solve(`${SUB}.foo bar\n.op\n.ends\n.end\n`, await engine);
    expect([s.status, s.words.warnings.map((m) => m.title)]).toEqual(['failed', ['.op is inside the subcircuit s, which no X line uses']]);
  }, 30000);
});

describe('the round-1 critic of these fixes: what ngspice reads first there, nested definitions, and the words of an analysis line or a .meas there (A3f, A3i)', () => {
  const SUB = `${BASE}.subckt s a b\nR9 a b 1k\n`;
  /** A line alone in the subcircuit s, which no X line uses. */
  const inS = (line: string): string => `${SUB}${line}\n.ends\n.op\n.end\n`;
  const ids = (text: string): string[] => checkTraps(parseNetlist(text)).map((t) => t.id);
  const SKIPS = 'ngspice skips this line: it is inside the subcircuit s (from line 5), and no X line uses that subcircuit.';

  it('C1-1: a .dc there with no step, a step of 0 or a word for the step: no summary that ngspice stops at it, no "see Checks", as no check speaks for it (native 47 and 42 skip it: exit 0, out = 2.5 V)', () => {
    for (const line of ['.dc V1 0 10', '.dc V1 0 1 0', '.dc V1 0 1 x']) {
      const e = explainLine(parseNetlist(inS(line)), 6)!;
      expect([e.summary, ...e.fields.map((f) => f.meaning)].join(' | '), line).not.toMatch(/stops|Checks/);
      expect([ids(inS(line)), e.notes], line).toEqual([[], [`${SKIPS.slice(0, -1)}. Put analysis lines in the main circuit, outside .subckt … .ends.`]]);
    }
    expect(explainLine(parseNetlist(inS('.dc V1 0 1 x')), 6)!.fields.find((f) => f.text === 'x')?.meaning).toBe('not a number for SPICE');
    // In the main circuit the same lines keep their words: there ngspice 47 stops ("Bad syntax!"), and a check says so.
    expect(ids(`${BASE}.dc V1 0 1 x\n.end\n`)).toEqual(['dc-sweep-problems']);
    const main = parseNetlist(`${BASE}.dc V1 0 1 x\n.end\n`);
    expect([explainLine(main, 4)!.summary, explainLine(main, 4)!.fields.find((f) => f.text === 'x')?.meaning]).toEqual(['ngspice 47 stops at this line ("Bad syntax!") and sweeps nothing: see Checks.', 'not a number for SPICE (see Checks)']);
  });

  it('C1-2: with a definition inside another, every check stays as before, as ngspice\'s list of the subcircuits used differs there: E1 c 0 VALUE=3 in a subcircuit it keeps (native 47 and 42 stop: "mal formed E source instance")', () => {
    // An X line after an inner .ends counts as the main circuit's: ngspice keeps other, which only X2 uses.
    const after = `${BASE}.subckt outer p q\n.subckt inner a b\nR9 a b 1k\n.ends\nX2 p q other\n.ends\n.subckt other c d\nR5 c d 1k\nE1 c 0 VALUE=3\n.ends\n.op\n.end\n`;
    // ngspice reads X1's subcircuit up to its first .ends, inner's: it keeps deep, which only X9 in inner uses.
    const deep = `${BASE}X1 out 0 outer\n.subckt outer p q\nR8 p q 1g\n.subckt inner a b\nX9 a b deep\n.ends\n.ends\n.subckt deep c d\nR5 c d 1k\nE1 c 0 VALUE=3\n.ends\n.op\n.end\n`;
    for (const [text, e1] of [[after, 12], [deep, 13]] as const) {
      expect(ids(text)).toEqual(['fatal-syntax']);
      expect(explainLine(parseNetlist(text), e1)!.notes.join(' ')).not.toContain('skips');
    }
  });

  it('C1-3: .probe and .title there are read before ngspice skips anything, so they keep their words, never "skips" (native 47 and 42: .probe i(R1) adds i(r1) to the results, .title names the run)', () => {
    for (const line of ['.probe i(R1)', '.probe alli', '.title a title from the subcircuit']) {
      expect(explainLine(parseNetlist(inS(line)), 6)!.notes.join(' '), line).not.toContain('skips');
    }
  });

  it('C1-4: a .meas there says nothing of "No .measure possible …", which ngspice prints only for one it reads (native 47 and 42, -b -r)', () => {
    for (const line of ['.meas tran vmax max v(a)', '.measure tran vmax max v(a)', '.MEAS tran vmin min v(a)']) {
      const e = explainLine(parseNetlist(inS(line)), 6)!;
      expect([e.summary, e.notes], line).toEqual(['', [SKIPS]]);
    }
    expect(explainLine(parseNetlist(`${BASE}.meas tran vmax max v(out)\n.op\n.end\n`), 4)!.summary).toContain('No .measure possible');
  });
});
