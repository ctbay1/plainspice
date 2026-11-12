/**
 * src/notebook/notes.ts (red pen on the drawing, critique 6 and 7) and src/notebook/words.ts (the
 * page's results in the model's words, critique 8 and 9). A note goes where the drawing is free and
 * never on a symbol, a word or a wire; a crossed-out old value only where there is room; the words
 * are the model's own (describe.ts), never typed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AnalysisResults } from '../../src/engine/results.ts';
import {
  NOTE_WIDTH,
  RESULTS_POINTER,
  acrossWords,
  currentText,
  nodeBox,
  noteWidth,
  notebookSchematic,
  partBox,
  placeNote,
  placeResults,
  sceneRoom,
  wasMarks,
  withoutResultsPointer,
  wrapWords,
} from '../../src/notebook/index.ts';
import { boxesOverlap, inflate, segmentCrossesBox } from '../../src/schematic/index.ts';
import { DESCRIBE_STRINGS, describeResults, type CurrentWords } from '../../src/spice/describe.ts';
import { parseNetlist } from '../../src/spice/parse.ts';

const root = resolve(import.meta.dirname, '../..');
const text = readFileSync(resolve(root, 'examples/p02/p02-4-open.cir'), 'utf8');
const s = notebookSchematic(text);
const run = { ok: true, unreliable: false, exitCode: 0, stdout: '', stderr: '', plots: [], diagnostics: [], timings: { instantiateMs: 0, runMs: 0, parseMs: 0 } };
function op(n1: number, a: number, g: number): AnalysisResults {
  const i1 = (n1 - 12) / 3;
  return {
    op: {
      nodes: [
        { node: 's', value: 12 },
        { node: 'n1', value: n1 },
        { node: 'a', value: a },
      ],
      currents: [
        { element: 'v1', value: i1, origin: 'branch', vector: 'i(v1)' },
        { element: 'r1', value: -i1, origin: 'device', vector: 'i(@r1[i])' },
        { element: 'r2', value: -g, origin: 'device', vector: 'i(@r2[i])' },
        { element: 'r3', value: n1 / 6, origin: 'device', vector: 'i(@r3[i])' },
        { element: 'g1', value: g, origin: 'device', vector: 'i(@g1[i])' },
      ],
    },
    other: [],
  };
}
const solved = (r: AnalysisResults) => placeResults(s.scene, describeResults(parseNetlist(text), r, run));

/** Nothing of the drawing under the box: no symbol, no word, no wire. */
function clear(box: { x0: number; y0: number; x1: number; y1: number }): boolean {
  const room = sceneRoom(s.scene, inflate(s.scene.bounds, 10));
  return !room.boxes.some((b) => boxesOverlap(box, b)) && !room.segments.some(([a, b]) => segmentCrossesBox(a, b, box));
}

describe('wrapWords', () => {
  it('breaks a check’s title into lines no wider than asked', () => {
    const title = '1M means 1 milliohm (1 mΩ), not 1 megaohm (1 MΩ)';
    for (const width of [NOTE_WIDTH, 7, 5.6]) {
      const lines = wrapWords(title, width);
      expect(lines.join(' ')).toBe(title);
      for (const l of lines) if (l.includes(' ')) expect(noteWidth(l)).toBeLessThanOrEqual(width + 1e-9);
    }
  });
});

describe('placeNote', () => {
  const title = '1M means 1 milliohm (1 mΩ), not 1 megaohm (1 MΩ)';

  it('writes a check’s title next to its part, on free paper only', () => {
    const about = partBox(s.scene, 'r1')!;
    const note = placeNote(s.scene, about, title)!;
    expect(note).toBeDefined();
    expect(clear(note.box)).toBe(true);
    expect(note.lines.map((l) => l.text).join(' ')).toBe(title);
    // Next to it: the nearest free paper, not across the drawing.
    const dx = Math.max(0, note.box.x0 - about.x1, about.x0 - note.box.x1);
    const dy = Math.max(0, note.box.y0 - about.y1, about.y0 - note.box.y1);
    expect(Math.hypot(dx, dy)).toBeLessThan(1.5);
  });

  it('keeps clear of the open card, and gives up rather than cover the drawing', () => {
    const about = partBox(s.scene, 'r1')!;
    const card = { x0: about.x0 - 8, y0: about.y0 - 8, x1: about.x1 + 8, y1: about.y0 - 0.05 };
    const note = placeNote(s.scene, about, title, { avoid: [card] });
    if (note) {
      expect(boxesOverlap(note.box, card)).toBe(false);
      expect(clear(note.box)).toBe(true);
    }
    // No room at all (the area is the part itself): no note.
    expect(placeNote(s.scene, about, title, { area: about })).toBeUndefined();
  });

  it('writes ngspice’s reason at the node it points at ("No single answer at node n1")', () => {
    const about = nodeBox(s.scene, 'n1')!;
    const note = placeNote(s.scene, about, DESCRIBE_STRINGS.singularTitle('n1'))!;
    expect(note).toBeDefined();
    expect(clear(note.box)).toBe(true);
  });
});

describe('wasMarks', () => {
  it('crosses out each node voltage that changed, next to the new one, where there is room', () => {
    const before = solved(op(16, 24, 4));
    const after = solved(op(20, 32, 6));
    const marks = wasMarks(s.scene, after, before);
    expect(marks.map((m) => [m.node, m.text.replace(/ /g, ' ')])).toEqual([
      ['n1', '16 V'],
      ['a', '24 V'],
    ]);
    for (const m of marks) {
      expect(clear(m.box)).toBe(true);
      const result = s.scene.nodeLabels.find((l) => l.node === m.node)!.lines.find((l) => l.role === 'result')!;
      // Right by the new value (above or below it, or after it).
      expect(Math.abs(m.y - result.y)).toBeLessThan(1.5);
    }
    // Never two on one spot.
    for (let i = 0; i < marks.length; i++) for (let j = i + 1; j < marks.length; j++) expect(boxesOverlap(marks[i]!.box, marks[j]!.box)).toBe(false);
  });

  it('writes none when nothing changed, or with nothing to compare with', () => {
    const r = solved(op(16, 24, 4));
    expect(wasMarks(s.scene, r, r)).toEqual([]);
    expect(wasMarks(s.scene, r, undefined)).toEqual([]);
  });
});

describe('the page’s words, from the model’s', () => {
  it('reads the pointer to a results view off the model’s own summary', () => {
    expect(RESULTS_POINTER).toBe(' Open the results for details.');
    for (const summary of [DESCRIBE_STRINGS.summaryOk('a = 24 V', 0, ''), DESCRIBE_STRINGS.summaryUnreliable('no single answer at node n1'), DESCRIBE_STRINGS.summaryFailed('x')]) {
      const short = withoutResultsPointer(summary);
      expect(short.endsWith('Open the results for details.')).toBe(false);
      expect(summary.startsWith(short)).toBe(true);
    }
    expect(withoutResultsPointer('Nothing else.')).toBe('Nothing else.');
  });

  it('says "ground" in a current’s words, as the card does', () => {
    const c: CurrentWords = { element: 'g1', name: 'G1', value: 4, from: '0', to: 'a', fromName: '0', toName: 'a', ammeter: false, text: '', speech: '' };
    expect(currentText(c).replace(/ /g, ' ')).toBe('4 A from ground to node a through G1');
    expect(currentText({ ...c, value: -4, from: 'a', to: '0' }).replace(/ /g, ' ')).toBe('4 A from node a to ground through G1');
    expect(currentText({ ...c, name: 'Vshort', ammeter: true, value: 3, from: 'a', to: '0' }).replace(/ /g, ' ')).toBe('Vshort measures 3 A flowing from node a to ground');
  });

  it('gives a voltage across a part as a size and the higher end, SPICE’s signed difference kept', () => {
    const g1 = acrossWords({ name: 'G1', v: [0, 24], nodes: ['0', 'a'], written: ['0', 'a'] });
    expect(g1.text.replace(/ /g, ' ')).toBe('24 V');
    expect(g1.higher).toBe('a');
    expect(g1.signed.replace(/ /g, ' ')).toBe('V(0) − V(a) = −24 V');
    expect(g1.speech).toContain('a is higher');
    const r1 = acrossWords({ name: 'R1', v: [12, 16], nodes: ['s', 'n1'], written: ['s', 'n1'] });
    expect(r1.higher).toBe('n1');
    const v1 = acrossWords({ name: 'V1', v: [12, 0], nodes: ['s', '0'], written: ['s', '0'] });
    expect(v1.higher).toBe('s');
    expect(acrossWords({ name: 'R9', v: [5, 5], nodes: ['x', 'y'], written: ['x', 'y'] }).higher).toBeUndefined();
    expect(acrossWords({ name: 'R9', v: [0, 1], nodes: ['0', 'y'], written: ['0', 'y'] }).higher).toBe('y');
    expect(acrossWords({ name: 'R9', v: [1, 0], nodes: ['y', '0'], written: ['y', '0'] }).higher).toBe('y');
    expect(acrossWords({ name: 'R9', v: [-1, 0], nodes: ['y', '0'], written: ['y', 'gnd'] }).higher).toBe(DESCRIBE_STRINGS.ground);
  });
});

describe('wrapWords keeps a number with its word', () => {
  it('never ends a line on a bare number', () => {
    const lines = wrapWords('1M means 1 milliohm (1 mΩ), not 1 megaohm (1 MΩ)', 5.6);
    for (const l of lines) expect(l).not.toMatch(/(^|\s)\(?\d+$/);
  });
});
