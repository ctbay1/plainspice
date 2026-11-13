/**
 * Typing a value on a part's card (src/app/card-edit.ts, decision 0016): every keystroke rebuilds
 * the text as it was when the card opened, with the value's words replaced, so nothing typed on the
 * way is left behind and Put back gives the line exactly as it was. Only a value SPICE reads as one
 * number is written; anything else stays in the field, with the checks' own reason and fix.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keepDrawing, spotValue, valueSpot, withValue, writeValue, type CardWrite, type ValueSpot } from '../../src/app/card-edit.ts';
import { NOTEBOOK_OPTIONS } from '../../src/notebook/index.ts';
import { MAX_DRAWING_LINES, buildSchematic, stripDrawing, type Schematic } from '../../src/schematic/index.ts';
import { latticeThrough, namedGrid, namedStubs, partsAtOnePoint, starAtOnePoint } from './schematic-hostile.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const START = readFileSync(resolve(ROOT, 'examples/start-here.cir'), 'utf8');
const FALLBACK = 'Not written to the netlist yet.';

/** The part's line in a text. */
const lineOf = (text: string, name: string): string => text.split('\n').find((l) => l.startsWith(`${name} `)) ?? '';

/** What the drawing shows: the parts, the wires, the junction dots and hops, the nodes' names and the ground symbols. */
const picture = (s: Schematic): unknown => ({
  parts: s.scene.parts.map((p) => [p.key, p.at, p.rot, p.mirror, p.box]),
  wires: s.scene.wires.map((w) => w.points),
  junctions: s.scene.junctions,
  crossings: s.scene.crossings,
  names: s.scene.nodeLabels.map((l) => [l.node, l.box]),
  grounds: s.scene.grounds.map((g) => [g.at, g.rot]),
});

/** How many drawing lines a text has. */
const drawingLines = (text: string): number => text.split('\n').filter((l) => l.startsWith('*@')).length;

/** Type `keys` one at a time into a card opened on `text`, as the app does: each from the text at opening. */
function typeInto(text: string, key: string, keys: string): { text: string; last: CardWrite } {
  const spot = valueSpot(text, key)!;
  let now = text;
  let last: CardWrite = { kind: 'empty' };
  for (let i = 1; i <= keys.length; i++) {
    last = writeValue(spot, keys.slice(0, i), FALLBACK);
    if (last.kind === 'write') now = last.text;
  }
  return { text: now, last };
}

describe('where a part’s value is', () => {
  it('finds the value as written, the whole run of words in its place', () => {
    const cases: [string, string, string][] = [
      ['R1 in out 1k', 'r1', '1k'],
      ['R1 in out 4,7k', 'r1', '4,7k'],
      ['R1 in out 1 k', 'r1', '1 k'],
      ['R1 in out 1k tc1=0.1', 'r1', '1k'],
      ['R1 in out abc', 'r1', 'abc'],
      ['V1 in 0 dc 6', 'v1', '6'],
      ['V1 in 0 6 ac 1', 'v1', '6'],
      ['E1 a 0 b 0 2', 'e1', '2'],
      ['F1 a 0 Vs 2', 'f1', '2'],
      ['H1 a 0 Vx 4,5', 'h1', '4,5'],
    ];
    for (const [line, key, value] of cases) {
      const spot = valueSpot(`* t\nVs x 0 1\nVx y 0 1\n${line}\n.op\n.end\n`, key);
      expect(spot && spotValue(spot), line).toBe(value);
    }
  });

  it('a part without a value: the value goes after its last node (or the source an F reads)', () => {
    const text = '* t\nV1 a 0 1\nR3 a 0\nF1 a 0 V1\n.op\n.end\n';
    const r3 = valueSpot(text, 'r3')!;
    expect(spotValue(r3)).toBe('');
    expect(lineOf(withValue(r3, '3k'), 'R3')).toBe('R3 a 0 3k');
    expect(lineOf(withValue(valueSpot(text, 'f1')!, '2'), 'F1')).toBe('F1 a 0 V1 2');
    expect(valueSpot(text, 'r9')).toBeUndefined();
  });
});

describe('typing a value', () => {
  it('writes a value SPICE reads as one number, from the text at opening', () => {
    const spot = valueSpot(START, 'r1')!;
    const r = writeValue(spot, '2k', FALLBACK);
    expect(r).toEqual({ kind: 'write', text: START.replace('R1 in out 1k', 'R1 in out 2k') });
    // A value with a trap is still one number: written, and the card points the trap out.
    expect(writeValue(spot, '1M', FALLBACK).kind).toBe('write');
    expect(writeValue(spot, '  ', FALLBACK)).toEqual({ kind: 'empty' });
  });

  it('nothing typed on the way is left behind: -12 on V1, 4.7k on R1', () => {
    const v1 = typeInto(START, 'v1', '-12');
    expect(lineOf(v1.text, 'V1')).toBe('V1 in 0 -12');
    const r1 = typeInto(START, 'r1', '4.7k');
    expect(lineOf(r1.text, 'R1')).toBe('R1 in out 4.7k');
    // Everything else is as it was.
    expect(r1.text.replace('4.7k', '1k')).toBe(START);
  });

  it('keeps a value SPICE does not read as one number in the field, with the checks’ reason and fix', () => {
    const cases: [string, string, string | undefined][] = [
      ['4,7k', '4,7k: SPICE reads the comma as a space', '4.7k'],
      ['1 k', '1 k: the space splits the value in two', '1k'],
      ['2 kohm', '2 kohm: the space splits the value in two', '2k'],
      ['1d-3', '1d-3: SPICE reads two numbers, 1d and −3', '1e-3'],
      ['abc', 'SPICE can’t use abc on this line', undefined],
      ['-', 'SPICE can’t use - on this line', undefined],
    ];
    for (const [typed, reason, fixed] of cases) {
      const r = typeInto(START, 'r1', typed);
      // The netlist keeps the last value SPICE could read (none of the junk on the way).
      expect(r.text, typed).not.toContain(typed);
      expect(r.last.kind, typed).toBe('refused');
      if (r.last.kind !== 'refused') continue;
      expect(r.last.reason.replace("'", '’'), typed).toBe(reason);
      expect(r.last.fix?.value, typed).toBe(fixed);
    }
    // abc, then 2k: the line is R1 in out 2k, nothing of abc left.
    const spot = valueSpot(START, 'r1')!;
    for (const v of ['a', 'ab', 'abc', '2', '2k']) writeValue(spot, v, FALLBACK);
    expect(writeValue(spot, '2k', FALLBACK)).toEqual({ kind: 'write', text: START.replace('1k', '2k') });
  });

  it('a value no check explains gets the card’s own sentence', () => {
    const r = writeValue(valueSpot(START, 'r1')!, '(2)', FALLBACK);
    expect(r).toEqual({ kind: 'refused', reason: FALLBACK });
  });

  it('Put back gives the line exactly as it was, even a value SPICE misreads', () => {
    const odd = START.replace('R1 in out 1k', 'R1 in out 4,7k');
    const spot = valueSpot(odd, 'r1')!;
    expect(withValue(spot, spotValue(spot))).toBe(odd);
    // Typing the fix writes it over the whole run.
    expect(writeValue(spot, '4.7k', FALLBACK)).toEqual({ kind: 'write', text: START.replace('1k', '4.7k') });
    // And a part that had no value: put back, the line has none again.
    const none = '* t\nV1 a 0 1\nR3 a 0\n.op\n.end\n';
    const r3 = valueSpot(none, 'r3')!;
    expect(withValue(r3, '')).toBe(none);
  });
});

describe('where the parts are drawn', () => {
  const drawnOf = (text: string): ReturnType<typeof buildSchematic> => buildSchematic(text, NOTEBOOK_OPTIONS);

  it('a value that moves nothing leaves the netlist as written (no *@ lines)', () => {
    const next = START.replace('1k', '100meg');
    expect(keepDrawing(drawnOf(START), next)).toBe(next);
  });

  it('a value that would move the drawing writes where the parts were (the *@ lines)', () => {
    // A 0 V ammeter given a voltage is a source: the automatic layout would draw it elsewhere (the
    // example's netlist without the drawing lines it opens with).
    const text = stripDrawing(readFileSync(resolve(ROOT, 'examples/sp01/sp01-2-ammeter.cir'), 'utf8'));
    const spot: ValueSpot = valueSpot(text, 'vm')!;
    expect(spotValue(spot)).toBe('0');
    const r = writeValue(spot, '5', FALLBACK);
    expect(r.kind).toBe('write');
    if (r.kind !== 'write') return;
    expect(buildSchematic(r.text, NOTEBOOK_OPTIONS).scene.parts.map((p) => [p.key, p.box.x0, p.box.y0])).not.toEqual(drawnOf(text).scene.parts.map((p) => [p.key, p.box.x0, p.box.y0]));
    const kept = keepDrawing(drawnOf(text), r.text);
    expect(kept).toMatch(/^\*@ /m);
    // Drawn where it was, and the value is the one typed.
    const at = (s: ReturnType<typeof buildSchematic>): unknown => s.scene.parts.map((p) => [p.key, p.box.x0, p.box.y0]);
    expect(at(drawnOf(kept))).toEqual(at(drawnOf(text)));
    expect(lineOf(kept, 'Vm')).toBe(lineOf(r.text, 'Vm'));
  });

  it('a value that would move the drawing keeps the line of a part the netlist does not have yet', () => {
    // Only a change made in the drawing drops it (decision 0013); writing the drawing for a value
    // dropped it with the rest of the old lines.
    const text = stripDrawing(readFileSync(resolve(ROOT, 'examples/sp01/sp01-2-ammeter.cir'), 'utf8')).replace(/^\.end/m, '*@ R99 5 5 0\n.end');
    expect(drawnOf(text).orphans).toEqual(['*@ R99 5 5 0']);
    const r = writeValue(valueSpot(text, 'vm')!, '5', FALLBACK);
    if (r.kind !== 'write') throw new Error('not written');
    const kept = keepDrawing(drawnOf(text), r.text);
    expect(kept).toMatch(/^\*@ Vm /m);
    expect(kept).toMatch(/^\*@ R99 5 5 0$/m);
  });

  it('a value typed where the lines put parts on other nodes’ pins writes where they are drawn, once (second re-check’s critic)', () => {
    // Every build of such lines moves the parts again (60 parts at one point: a fifth of a second on a
    // computer, a second on a phone, for every key and every visit). The first value typed writes the
    // drawing shown, so the next builds read it as written.
    const text = partsAtOnePoint(10, ['*@ R99 5 5 0', '*@ label nope 3 3']);
    const drawn = drawnOf(text);
    expect(drawn.problems.filter((p) => p.kind === 'moved-part').length).toBe(9);
    expect(drawn.orphans).toEqual(['*@ R99 5 5 0', '*@ label nope 3 3']);
    const next = withValue(valueSpot(text, 'r2')!, '3');
    const kept = keepDrawing(drawn, next);
    expect(kept).not.toBe(next);
    const again = drawnOf(kept);
    expect(again.problems.filter((p) => p.kind === 'moved-part')).toEqual([]);
    // Drawn as it was, the wires, dots, names and ground symbols too (its critic, D5: not only the
    // parts), with the value typed, and the line of the part the netlist does not have yet kept.
    expect(picture(again)).toEqual(picture(drawn));
    expect(lineOf(kept, 'R2')).toBe('R2 1 2 3');
    expect(again.orphans).toEqual(['*@ R99 5 5 0', '*@ label nope 3 3']);
    // A later key on the same card: the lines say where the parts are now, so only the value changes.
    const later = withValue(valueSpot(kept, 'r2')!, '4');
    expect(keepDrawing(drawn, later)).toBe(later);
  });

  it.each([
    // Written as lines, the drawing shown was 4,921 lines: reading stopped at 2000 and most of the grid
    // vanished. Its pieces are now written chained (format.ts), in 293 lines that read back as drawn.
    ['60 parts between node 1 and ground at one point, a 70 × 70 grid named 1 far away (a 29,113-character link)', () => starAtOnePoint(60, namedGrid(70, '1')), true],
    // The repairs took the pieces of wire away and left the names where they were: read again, 840
    // of the 900 were dropped. So the value is written alone, as before the piled lines' shortcut.
    ['60 parts at one point, 900 names each on its own piece of wire far away', () => partsAtOnePoint(60, namedStubs(900)), false],
    // A slanted lattice through the parts' pins: reading the drawing the repairs drew repairs it again, differently.
    ['6 parts at one point, a slanted lattice through their pins', () => partsAtOnePoint(6, latticeThrough(20)), false],
  ])('a value typed where the lines pile parts keeps the picture, and never writes more lines than are read: %s (its critic, D5)', (_, make, written) => {
    const text = make();
    const drawn = drawnOf(text);
    expect(drawn.problems.some((p) => p.kind === 'moved-part')).toBe(true);
    const spot = valueSpot(text, 'r2')!;
    for (const value of ['3', '47']) {
      const next = withValue(spot, value);
      const kept = keepDrawing(drawn, next);
      // The drawing shown is written only when its lines read back as it.
      expect(kept !== next).toBe(written);
      expect(drawingLines(kept)).toBeLessThanOrEqual(MAX_DRAWING_LINES);
      const again = drawnOf(kept);
      expect(again.problems.filter((p) => p.kind === 'too-many-lines' || p.kind === 'label-dropped')).toEqual([]);
      expect(picture(again)).toEqual(picture(drawn));
      expect(lineOf(kept, 'R2')).toMatch(new RegExp(` ${value}$`));
    }
  }, 120_000);

  it('Put back where the lines pile parts gives the text the card opened on, exactly (its critic, D6)', () => {
    const text = partsAtOnePoint(10);
    const drawn = drawnOf(text);
    const spot = valueSpot(text, 'r2')!;
    const typed = withValue(spot, '47');
    expect(keepDrawing(drawn, typed)).not.toBe(typed);
    expect(keepDrawing(drawn, withValue(spot, spotValue(spot)))).toBe(text);
  });
});
