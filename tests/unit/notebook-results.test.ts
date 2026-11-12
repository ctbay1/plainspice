/**
 * src/notebook/results.ts: a run's results placed on the drawing, in the lines the schematic model
 * keeps for them. The results here are the model's own words (describeResults) for operating points
 * given by hand in SPICE's sign convention; tests/golden/notebook-drawings.test.ts does the same with
 * ngspice's own numbers for every example.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AnalysisResults } from '../../src/engine/results.ts';
import type { RunResult } from '../../src/engine/types.ts';
import { formatSI } from '../../src/format/si.ts';
import {
  CURRENT_ROOM,
  METER_ROOM,
  NOTEBOOK_OPTIONS,
  NO_RESULTS,
  POWER_ROOM,
  POWER_WORD_ROOM,
  isAmmeter,
  markLayout,
  markWidth,
  notebookSchematic,
  placeResults,
  resultRoom,
  roomOf,
  type ResultMark,
} from '../../src/notebook/index.ts';
import { buildSchematic } from '../../src/schematic/index.ts';
import { describeResults } from '../../src/spice/describe.ts';
import { parseNetlist } from '../../src/spice/parse.ts';

const root = resolve(import.meta.dirname, '../..');
const example = (file: string): string => readFileSync(resolve(root, 'examples', file), 'utf8');

function run(): RunResult {
  return { ok: true, unreliable: false, exitCode: 0, stdout: '', stderr: '', plots: [], diagnostics: [], timings: { instantiateMs: 0, runMs: 0, parseMs: 0 } };
}
type Origin = 'branch' | 'device';
function op(nodes: Record<string, number>, currents: [string, number, Origin][]): AnalysisResults {
  return {
    op: {
      nodes: Object.entries(nodes).map(([node, value]) => ({ node, value })),
      currents: currents.map(([element, value, origin]) => ({ element, value, origin, vector: origin === 'branch' ? `i(${element})` : `i(@${element}[i])` })),
    },
    other: [],
  };
}

/**
 * p02-4 (example 3, open circuit), solved by hand: n1 = 16 V, a = 24 V; G1 pushes 0.25 × 16 = 4 A
 * from ground into a, which flows back through R2 into n1; R3 takes 16/6 A, R1 the other 4/3 A,
 * from n1 to s and on into V1's + side (SPICE counts that current positive: V1 absorbs power).
 */
const P02_4 = op({ s: 12, n1: 16, a: 24 }, [
  ['v1', 4 / 3, 'branch'],
  ['r1', -4 / 3, 'device'],
  ['r2', -4, 'device'],
  ['r3', 16 / 6, 'device'],
  ['g1', 4, 'device'],
]);

function solved(file: string, results: AnalysisResults) {
  const text = example(file);
  const s = notebookSchematic(text);
  const words = describeResults(parseNetlist(text), results, run());
  return { s, words, drawn: placeResults(s.scene, words) };
}

/** The marks in words: [lead] [arrow's direction] text, with formatSI's no-break space read as a space. */
const texts = (m: readonly ResultMark[]): string[] => m.map((x) => `${x.lead ? `${x.lead} ` : ''}${x.arrow ? `${x.arrow} ` : ''}${x.text}`.replace(/\u00a0/g, ' '));

describe('the room kept for results', () => {
  it('keeps one line for a part, three for a source (current, power word, watts), one for a meter', () => {
    const s = notebookSchematic(example('p02/p02-5-short.cir'));
    const lines = (key: string): number => s.scene.parts.find((p) => p.key === key)!.labels.filter((l) => l.role === 'result').length;
    expect(lines('r1')).toBe(1);
    expect(lines('v1')).toBe(3);
    expect(lines('g1')).toBe(3);
    expect(lines('vshort')).toBe(1);
    const vshort = s.circuit.parts.find((p) => p.key === 'vshort')!;
    expect(isAmmeter(vshort)).toBe(true);
    expect(resultRoom(vshort)).toEqual([METER_ROOM]);
    expect(resultRoom(s.circuit.parts.find((p) => p.key === 'v1')!)).toEqual([CURRENT_ROOM, POWER_WORD_ROOM, POWER_ROOM]);
  });

  it('calls a 0 V source a meter exactly when describe.ts does', () => {
    const s = notebookSchematic('* meters\nV1 a 0 0\nV2 b 0\nV3 c 0 DC 0\nV4 d 0 1\nV5 e 0 SIN(0 1 1k)\nR1 a b 1\nR2 c d 1\nR3 d e 1\n.op\n.end\n');
    const meters = s.circuit.parts.filter(isAmmeter).map((p) => p.name);
    expect(meters).toEqual(['V1', 'V2', 'V3']);
  });
});

describe('placeResults', () => {
  it('draws nothing without numbers worth showing', () => {
    const s = notebookSchematic(example('p02/p02-4-open.cir'));
    expect(placeResults(s.scene, undefined)).toBe(NO_RESULTS);
  });

  it('writes each node voltage on its name’s line, "s = 12 V", in the room the scene kept', () => {
    const { s, drawn } = solved('p02/p02-4-open.cir', P02_4);
    const byNode = Object.fromEntries(drawn.nodes.map((n) => [n.node, n.mark?.text.replace(/\u00a0/g, ' ')]));
    expect(byNode).toEqual({ s: '= 12 V', n1: '= 16 V', a: '= 24 V' });
    for (const n of drawn.nodes) {
      const label = s.scene.nodeLabels[n.label]!;
      expect(label.node).toBe(n.node);
      const result = label.lines.find((l) => l.role === 'result')!;
      const name = label.lines.find((l) => l.role === 'node')!;
      expect(n.mark!.line).toBe(result);
      // The same row, the result just after the name, both read from their start.
      expect(result.y).toBe(name.y);
      expect(result.align).toBe('start');
      expect(name.align).toBe('start');
      expect(result.box.x0).toBeGreaterThan(name.box.x1 - 1e-9);
      expect(markWidth(n.mark!)).toBeLessThanOrEqual(roomOf(result) + 1e-9);
    }
  });

  it('keeps a node voltage on a line of its own without the inline option (the model’s default)', () => {
    const text = example('p02/p02-4-open.cir');
    const { nodeResultInline: _inline, ...options } = NOTEBOOK_OPTIONS;
    const plain = buildSchematic(text, options);
    const words = describeResults(parseNetlist(text), P02_4, run());
    const drawn = placeResults(plain.scene, words);
    expect(drawn.nodes.map((n) => n.mark?.text.replace(/\u00a0/g, ' '))).toEqual(['12 V', '16 V', '24 V']);
    for (const l of plain.scene.nodeLabels) {
      const result = l.lines.find((x) => x.role === 'result')!;
      expect(result.y).not.toBe(l.lines.find((x) => x.role === 'node')!.y);
    }
  });

  it('writes each current with an arrow the way it flows on the drawing, and each source’s power', () => {
    const { drawn } = solved('p02/p02-4-open.cir', P02_4);
    const marks = (key: string): string[] => texts(drawn.parts.get(key)!.marks);
    // V1 stands upright, + at the top: 4/3 A flows into its + side, down through it, and it absorbs 16 W.
    expect(marks('v1')).toEqual(['down 1.333 A', 'absorbs', '16 W']);
    // R1 lies between s (left) and n1 (right): the current flows from n1 to s, to the left.
    expect(marks('r1')).toEqual(['left 1.333 A']);
    expect(marks('r2')).toEqual(['left 4 A']);
    expect(marks('r3')).toEqual(['down 2.667 A']);
    // G1 stands upright with pin 0 (ground) at the bottom: it pushes 4 A up into a and delivers 96 W.
    expect(marks('g1')).toEqual(['up 4 A', 'delivers', '96 W']);
  });

  it('keeps the model’s words for screen readers', () => {
    const { drawn, words } = solved('p02/p02-4-open.cir', P02_4);
    const g1 = drawn.parts.get('g1')!;
    const c = words.currents.find((x) => x.element === 'g1')!;
    expect(g1.speech).toBe(`${c.speech}. ${c.power!.speech}`);
    expect(g1.direction).toBe('up');
  });

  it('turns the arrow round for a negative current', () => {
    const { s, words } = solved('p02/p02-4-open.cir', P02_4);
    const flipped = { ...words, currents: words.currents.map((c) => (c.element === 'r3' ? { ...c, value: -c.value } : c)) };
    expect(placeResults(s.scene, flipped).parts.get('r3')!.direction).toBe('up');
  });

  it('writes a 0 V source as a meter: "measures", then the current it measures, and no power', () => {
    const p025 = op({ s: 12, n1: 4, a: 0 }, [
      ['v1', -8 / 3, 'branch'],
      ['vshort', 3, 'branch'],
      ['r1', 8 / 3, 'device'],
      ['r2', 2, 'device'],
      ['r3', 4 / 6, 'device'],
      ['g1', 1, 'device'],
    ]);
    const { drawn } = solved('p02/p02-5-short.cir', p025);
    const vshort = drawn.parts.get('vshort')!;
    expect(texts(vshort.marks)).toEqual(['measures down 3 A']);
    expect(vshort.current.ammeter).toBe(true);
    expect(vshort.current.power).toBeUndefined();
  });

  it('fits every number of four digits in the room kept, and writes a longer one smaller', () => {
    const { s, words } = solved('p02/p02-4-open.cir', P02_4);
    for (const v of [1e-3 * 888.8, 1e-6 * 123.4, 0.9999, 1234, -7.777]) {
      const changed = { ...words, currents: words.currents.map((c) => ({ ...c, value: v })), nodes: words.nodes.map((n) => ({ ...n, text: formatSI(v, 'V') })) };
      expect(placeResults(s.scene, changed).squeezed, String(v)).toEqual([]);
    }
    // Beyond tera, formatSI writes an exponent, as ngspice does: wider than any four-digit number.
    const huge = { ...words, currents: words.currents.map((c) => (c.element === 'r1' ? { ...c, value: -1.234e20 } : c)) };
    const r = placeResults(s.scene, huge);
    const m = r.parts.get('r1')!.marks[0]!;
    expect(m.text).toBe(formatSI(1.234e20, 'A'));
    expect(m.scale).toBeLessThan(1);
    expect(markWidth(m) * m.scale).toBeLessThanOrEqual(roomOf(m.line) + 1e-9);
    expect(r.squeezed).toContain(m);
  });
});

describe('markLayout', () => {
  const { drawn } = solved('p02/p02-4-open.cir', P02_4);
  it('anchors a mark on its line the way the line is aligned', () => {
    for (const plain of [false, true]) {
      for (const pm of drawn.parts.values()) {
        for (const m of pm.marks) {
          const l = markLayout(m, plain);
          if (m.line.align === 'end') {
            expect(l.textX).toBe(m.line.x);
            expect(l.anchor).toBe('end');
          }
          if (m.arrow) expect(l.arrowX).toBeDefined();
          // Everything stays inside the line's box.
          expect(Math.min(l.arrowX ?? Infinity, l.textX)).toBeGreaterThanOrEqual(m.line.box.x0 - 1e-6);
        }
      }
    }
  });
});

describe('after the final reviews (12 November 2026)', () => {
  it('draws ngspice\'s rounding noise as 0 A: no arrow, no delivers or absorbs (student review; C9b)', () => {
    // The homework circuit with "Vm x gnd": every true current is 0, and ngspice gives 1e-18 A (C9b).
    const text = '* circuit\nV1 in 0 12\nR1 in a 1k\nR2 a x 2k\nVm x gnd\nR3 a b 3k\nF1 0 b V1 2\n.op\n.end\n';
    const results = op({ in: 12, a: 11.999999999999998, x: 11.999999999999998, gnd: 11.999999999999998, b: 11.999999999999995 }, [
      ['v1', -1.734723475976807e-18, 'branch'],
      ['vm', 0, 'branch'],
      ['r1', 1.7763568394002505e-18, 'device'],
      ['r2', 0, 'device'],
      ['r3', 1.1842378929335003e-18, 'device'],
      ['f1', -3.469446951953614e-18, 'device'],
    ]);
    const s = notebookSchematic(text);
    const drawn = placeResults(s.scene, describeResults(parseNetlist(text), results, run()));
    for (const key of ['v1', 'r1', 'r3', 'f1']) {
      const pm = drawn.parts.get(key)!;
      expect(pm.direction, key).toBeUndefined();
      expect(texts(pm.marks), key).toEqual(['0 A']);
    }
    expect(texts(drawn.parts.get('vm')!.marks)).toEqual(['measures 0 A']);
  });
});
