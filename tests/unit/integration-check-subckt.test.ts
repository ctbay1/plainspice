/**
 * The integration check of the last pass's lanes (14 November 2026; decision 0017, "After the integration
 * check"): subcircuits the main circuit does not use (facts A3f and A3i in docs/spice-facts/explanations.md).
 *
 * - X2: the walk out of such a subcircuit, which names the X lines that use it, stops after three steps of
 *   at most three X lines each, so its work, its memory and its words grow with the netlist, not with its
 *   square: a chain of 4,000 subcircuits made 8 million steps and about 1 GB, and one note named a chain of
 *   500 in 37,257 characters.
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
