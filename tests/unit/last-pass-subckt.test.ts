/**
 * The last pass before milestone 2's release (13 November 2026, decision 0017, "After the last pass"):
 * .tf and other analysis lines inside subcircuits, and the words for lines ngspice skips. Every
 * netlist here runs through our engine; native ngspice 47 and 42 give the same numbers (facts A3f
 * in docs/spice-facts/explanations.md).
 *
 * - facts F2: ngspice "skips" those lines, the word for a whole line it does not read (W11).
 */
import { describe, expect, it } from 'vitest';
import type { RunResult } from '../../src/engine/types.ts';
import { describeCircuit, describeResults } from '../../src/spice/describe.ts';
import { explainNetlist } from '../../src/spice/explain.ts';
import { parseNetlist } from '../../src/spice/parse.ts';

/** A run of ngspice that gave nothing and said nothing (exit 0), as PlainSpice runs it. */
const nothing = (): RunResult => ({ ok: false, unreliable: false, exitCode: 0, stdout: '', stderr: '', plots: [], diagnostics: [], timings: { instantiateMs: 0, runMs: 0, parseMs: 0 } });

describe('facts F2: ngspice "skips" an analysis line in a subcircuit no X line uses (W11)', () => {
  it('Explain\'s note and the overview say "skips", never "ignores", for those lines', () => {
    const text = '* t\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.tf v(a,gnd) V1\n.ends\n.end\n';
    const n = parseNetlist(text);
    const note = explainNetlist(n)[6]!.notes;
    expect(note).toEqual(['ngspice skips this line: it is inside the subcircuit s (from line 5), and no X line uses that subcircuit. Put analysis lines in the main circuit, outside .subckt … .ends.']);
    expect(describeCircuit(n)).toContain('Its analysis lines are inside a subcircuit that no X line uses, where ngspice skips them, so ngspice will run nothing.');
    expect([...note, describeCircuit(n), describeResults(n, { other: [] }, nothing()).warnings[0]!.why].filter((x) => /ignor/.test(x))).toEqual([]);
  });
});
