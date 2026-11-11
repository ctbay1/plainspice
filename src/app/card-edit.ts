/**
 * Typing a value on a part's card (decision 0016). The card is a window onto one netlist line's
 * value. When it opens it finds where the value is written (`valueSpot`: the whole run of words in
 * the value's place, so "4,7k" and "1 k" count as one value), and every keystroke rebuilds the text
 * as it was then with that run replaced by the field's text (`writeValue`). Nothing typed on the way
 * (a lone "-", "4,", "1 ") is ever left behind, and Put back gives the line exactly as it was.
 *
 * The field's text goes into the netlist only when SPICE reads it as one number in that place (the
 * parser's own reading, src/spice/parse.ts, which the facts tests check against ngspice): "2k",
 * "-12", "1M" (a value with a trap, which the card then points out). Anything else ("abc", "4,7k",
 * "1 k", a lone "-") stays in the field: the netlist keeps the last value written, so the numbers
 * stay, and the card says why in the checks' own words (src/spice/traps.ts), with their fix when the
 * fix is a value ("Write 4.7k").
 *
 * Where each part is drawn goes into the netlist (the *@ lines, decision 0013) only when the new
 * value would move it (`keepDrawing`: a 0 V ammeter that becomes a source, a longer gain), so the
 * drawing never changes under the student's eyes, and a netlist whose drawing did not move keeps its
 * text exactly as written. Plain TypeScript.
 */
import { NOTEBOOK_OPTIONS } from '../notebook/schematic.ts';
import { applyChanges, buildSchematic, drawingBlockChanges, serializeDrawing, type Schematic } from '../schematic/index.ts';
import { lowerAscii } from '../spice/parse.ts';
import type { Element, Field, FieldRole } from '../spice/types.ts';
import { readNetlist } from './model.ts';

/** Where a part's value is written in a text. */
export interface ValueSpot {
  /** The text the spot was found in. */
  text: string;
  /** The part, lower-case. */
  key: string;
  /** Its line (0-based). */
  line: number;
  /** The value's words, from the first character of the first to the last of the last; from === to where the line has none. */
  from: number;
  to: number;
  /** What goes before a value written where there was none (a space after the last node). */
  pad: string;
}

/** What typing a value does: nothing yet (an empty field), a new text, or why it stays in the field. */
export type CardWrite =
  | { kind: 'empty' }
  | { kind: 'write'; text: string }
  | { kind: 'refused'; reason: string; fix?: { label: string; value: string } };

/** The fields that say where a part is connected (and, for F and H, which source it reads). */
const WIRING: ReadonlySet<FieldRole> = new Set(['node', 'plus', 'minus', 'from', 'to', 'control-plus', 'control-minus', 'control-source']);
/** The fields that may be (part of) the value as written: the value's roles and words SPICE cannot use there. */
const VALUE_WORDS: ReadonlySet<FieldRole> = new Set(['value', 'gain', 'transconductance', 'transresistance', 'other']);
const VALUE_ROLES: ReadonlySet<FieldRole> = new Set(['value', 'gain', 'transconductance', 'transresistance']);

/** The fields after a part's nodes that are its value as written ("dc" before a source's value stays as it is). */
function valueRun(el: Element): { run: Field[]; after: Field | undefined } {
  let i = 1;
  while (i < el.fields.length && WIRING.has(el.fields[i]!.role)) i++;
  let after = el.fields[i - 1];
  const run: Field[] = [];
  for (let j = i; j < el.fields.length && VALUE_WORDS.has(el.fields[j]!.role); j++) run.push(el.fields[j]!);
  if (run[0] && lowerAscii(run[0].token.text) === 'dc') after = run.shift();
  return { run, after };
}

const isSpace = (c: string | undefined): boolean => c === undefined || /\s/.test(c);

/** Where a part's value is in `text` (undefined when the part is not there). */
export function valueSpot(text: string, key: string): ValueSpot | undefined {
  const { netlist } = readNetlist(text);
  const line = netlist.lines.find((l) => l.kind === 'element' && l.element?.key === key);
  const el = line?.element;
  if (!line || !el) return undefined;
  const { run, after } = valueRun(el);
  if (run.length) {
    // The words as written, with what splits them ("4,7k", "(1)"), up to the spaces around them.
    const prevEnd = after?.token.to ?? el.name.to;
    const nextStart = el.fields[el.fields.indexOf(run[run.length - 1]!) + 1]?.token.from ?? Infinity;
    let from = run[0]!.token.from;
    let to = run[run.length - 1]!.token.to;
    while (from > prevEnd && !isSpace(text[from - 1])) from--;
    while (to < nextStart && to < text.length && !isSpace(text[to])) to++;
    return { text, key, line: line.index, from, to, pad: '' };
  }
  const at = (after ?? el.fields[0]!).token.to;
  return { text, key, line: line.index, from: at, to: at, pad: ' ' };
}

/** The value as written at the spot ("" where the line has none). */
export const spotValue = (spot: ValueSpot): string => spot.text.slice(spot.from, spot.to);

/** The text with the spot's value replaced by `value`, as typed (no checks: Put back uses it). */
export function withValue(spot: ValueSpot, value: string): string {
  const insert = spot.from === spot.to && value ? `${spot.pad}${value}` : value;
  return `${spot.text.slice(0, spot.from)}${insert}${spot.text.slice(spot.to)}`;
}

/**
 * The text with `value` in the spot, when SPICE reads it as one number there; otherwise why not, in
 * the checks' words for that line (and their fix, when it is a value that SPICE reads). `fallback`
 * is the card's own sentence for a value no check explains.
 */
export function writeValue(spot: ValueSpot, value: string, fallback: string): CardWrite {
  const v = value.trim();
  if (!v) return { kind: 'empty' };
  const text = withValue(spot, v);
  if (readsAsOneNumber(text, spot, v)) return { kind: 'write', text };
  const { traps } = readNetlist(text);
  const from = spot.from + (spot.from === spot.to ? spot.pad.length : 0);
  const to = from + v.length;
  const onLine = traps.filter((t) => t.line === spot.line + 1 && t.severity !== 'info');
  const trap = onLine.find((t) => t.span.from < to && from < t.span.to) ?? onLine[0];
  if (!trap) return { kind: 'refused', reason: fallback };
  // A fix that writes a value in the field's place ("Write 4.7k"), and that SPICE then reads as one number.
  for (const f of trap.fixes) {
    const c = f.changes[0];
    if (f.changes.length !== 1 || !c || c.from < from || c.to > to || !c.insert || /\s/.test(c.insert)) continue;
    const fixed = `${v.slice(0, c.from - from)}${c.insert}${v.slice(c.to - from)}`;
    if (readsAsOneNumber(withValue(spot, fixed), spot, fixed)) return { kind: 'refused', reason: trap.title, fix: { label: f.label, value: fixed } };
  }
  return { kind: 'refused', reason: trap.title };
}

/** True when the part's value in `text` is exactly `v`, one word that SPICE reads as a number. */
function readsAsOneNumber(text: string, spot: ValueSpot, v: string): boolean {
  const el = readNetlist(text).netlist.lines[spot.line]?.element;
  if (!el || el.key !== spot.key) return false;
  const { run } = valueRun(el);
  const only = run.length === 1 ? run[0]! : undefined;
  return !!only && VALUE_ROLES.has(only.role) && only.token.text === v && el.value?.token.from === only.token.from && el.value.number !== undefined;
}

/**
 * `next` as it should be written: unchanged when its parts are drawn where they were in `drawn`
 * (the drawing of the text the card opened on), or with `drawn`'s positions written in (the *@
 * lines) when the new value would move them.
 */
export function keepDrawing(drawn: Schematic, next: string): string {
  if (drawn.foreign.length) return next;
  const was = serializeDrawing(drawn.circuit, drawn.drawing, drawn.kept);
  const after = buildSchematic(next, NOTEBOOK_OPTIONS);
  const now = serializeDrawing(after.circuit, after.drawing, after.kept);
  if (was.length === now.length && was.every((l, i) => l === now[i])) return next;
  return applyChanges(next, drawingBlockChanges(after.netlist, was));
}
