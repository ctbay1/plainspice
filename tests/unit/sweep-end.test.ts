/**
 * A sweep's last point as the polite region says it after a run (src/spice/describe.ts, SweepWords.end;
 * src/app/App.tsx, resultsSaid; decision 0010): its first four values and then how many more, as the
 * operating point's summary says four nodes and then how many more. Its words in the Numbers panel and on
 * its results card (text, speech) keep every value. The critic of the second re-check's fixes heard all 8
 * values of a six-stage RC ladder after every change, where a five-node .op said four.
 */
import { describe, expect, it } from 'vitest';
import type { RunResult } from '../../src/engine/types.ts';
import { DESCRIBE_STRINGS, describeResults } from '../../src/spice/describe.ts';
import { parseNetlist } from '../../src/spice/parse.ts';

const run = (): RunResult => ({ ok: true, unreliable: false, exitCode: 0, stdout: '', stderr: '', plots: [], diagnostics: [], timings: { instantiateMs: 0, runMs: 0, parseMs: 0 } });
const sweep = (scaleName: string, unit: 'V' | 's', scale: number[], series: [string, 'V' | 'A', number[]][]) => ({
  scale: { name: scaleName, values: Float64Array.from(scale), unit },
  series: series.map(([name, u, v]) => ({ name, values: Float64Array.from(v), unit: u })),
});

describe('a sweep’s last point as the live region says it (decision 0010)', () => {
  it('four values, then how many more: the words for the panel keep them all', () => {
    const n = parseNetlist('* ladder\nV1 in 0 PULSE(0 5 0 1u 1u 1 2)\nR1 in n1 1k\nC1 n1 0 100n\nR2 n1 n2 1k\nC2 n2 0 100n\nR3 n2 n3 1k\nC3 n3 0 100n\nR4 n3 out 1k\nC4 out 0 100n\n.tran 10u 2m\n');
    const series: [string, 'V' | 'A', number[]][] = [
      ['v(in)', 'V', [0, 5]],
      ['v(n1)', 'V', [0, 4]],
      ['v(n2)', 'V', [0, 3]],
      ['v(n3)', 'V', [0, 2]],
      ['v(out)', 'V', [0, 1]],
      ['i(v1)', 'A', [0, -0.001]],
    ];
    const w = describeResults(n, { tran: sweep('time', 's', [0, 0.002], series), other: [] }, run());
    const s = w.sweeps[0]!;
    expect(s.end).toBe('At 2 milliseconds: the voltage at node in is 5 volts, the voltage at node n1 is 4 volts, the voltage at node n2 is 3 volts, the voltage at node n3 is 2 volts and 2 more values.');
    // The panel's and the card's words: every value.
    expect(s.speech).toContain('the voltage at node out is 1 volt, the current in V1 is minus 1 milliamp.');
    expect(s.final).toHaveLength(6);
  });

  it('one more value is said as one; four or fewer are all said', () => {
    expect(DESCRIBE_STRINGS.summaryValues(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c, d and 1 more value');
    expect(DESCRIBE_STRINGS.summaryValues(['a', 'b', 'c', 'd'])).toBe('a, b, c, d');
    const n = parseNetlist('* D1\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 0 12 1\n');
    const v = Array.from({ length: 13 }, (_, i) => i);
    const w = describeResults(n, { dc: sweep('v(v-sweep)', 'V', v, [['v(in)', 'V', v], ['v(out)', 'V', v.map((x) => (2 * x) / 3)], ['i(v1)', 'A', v.map((x) => -x / 3000)]]), other: [] }, run());
    expect(w.sweeps[0]!.end).toBe('When V1 is 12 volts: the voltage at node in is 12 volts, the voltage at node out is 8 volts, the current in V1 is minus 4 milliamps.');
  });
});
