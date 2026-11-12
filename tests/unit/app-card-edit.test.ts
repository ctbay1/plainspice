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
import { buildSchematic, stripDrawing } from '../../src/schematic/index.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const START = readFileSync(resolve(ROOT, 'examples/start-here.cir'), 'utf8');
const FALLBACK = 'Not written to the netlist yet.';

/** The part's line in a text. */
const lineOf = (text: string, name: string): string => text.split('\n').find((l) => l.startsWith(`${name} `)) ?? '';

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
      // A word where the value goes is said as that (re-check S6), not as a setting after a value.
      ['abc', 'R1’s value is not a number', undefined],
      ['-', 'R1’s value is not a number', undefined],
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
});
