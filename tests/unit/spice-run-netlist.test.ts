import { describe, expect, it } from 'vitest';
import { parseNetlist } from '../../src/spice/parse.ts';
import { hasSaveCurrents, netlistToRun, SAVE_CURRENTS_LINE } from '../../src/spice/run-netlist.ts';

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
      expect(toRun(text), options).toEqual({ text, added: [] });
    }
  });

  it('leaves the text alone when there is no .op', () => {
    for (const analysis of ['.tf v(a) V1', '.dc V1 0 1 0.5', '.tran 1u 10u', '']) {
      const text = `* t\nV1 a 0 1\nR1 a 0 1\n${analysis}\n.end\n`;
      expect(toRun(text), analysis).toEqual({ text, added: [] });
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
