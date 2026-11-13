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
 * text exactly as written; or when the lines put parts on other nodes' pins, which every build of
 * them moves again, and the drawing shown, written as lines, reads back as it is (decisions 0012 and
 * 0016). Plain TypeScript.
 */
import { NOTEBOOK_OPTIONS } from '../notebook/schematic.ts';
import { applyChanges, buildSchematic, drawingBlockChanges, linesFit, serializeDrawing, type PartLetter, type Schematic } from '../schematic/index.ts';
import { lowerAscii, parseNetlist } from '../spice/parse.ts';
import type { Element, Field, FieldRole, Netlist, Trap } from '../spice/types.ts';
import { formatNumber } from '../format/si.ts';
import { elementInfo } from '../spice/elements.ts';
import { explainLine, readNetlist } from './model.ts';

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
  const fix = valueFix(trap, spot, v, from, to);
  return { kind: 'refused', reason: trap.title, ...(fix ? { fix } : {}) };
}

/** A check's fix that writes a value in the field's place ("Write 4.7k", "Make it 1meg (1 MΩ)"), and that SPICE then reads as one number. */
function valueFix(trap: Trap, spot: ValueSpot, v: string, from: number, to: number): { label: string; value: string } | undefined {
  for (const f of trap.fixes) {
    const c = f.changes[0];
    if (f.changes.length !== 1 || !c || c.from < from || c.to > to || !c.insert || /\s/.test(c.insert)) continue;
    const fixed = `${v.slice(0, c.from - from)}${c.insert}${v.slice(c.to - from)}`;
    if (readsAsOneNumber(withValue(spot, fixed), spot, fixed)) return { label: f.label, value: fixed };
  }
  return undefined;
}

/**
 * What SPICE reads a part's value as (the card's "SPICE reads it as", and the Add a part form's): the
 * explanation's own words for R, V and I ("3 Ω", "1 mΩ (milli!)"); for a gain, the number SPICE reads,
 * as it reads it ("0.25", not "250 mA"). `trap` when the explanation marks it with "!".
 */
export function readsOf(netlist: Netlist, line: number, letter: PartLetter, value: number | undefined): { reads: string; trap: boolean } | undefined {
  const info = elementInfo(letter);
  const field = explainLine(netlist, line)?.fields.find((f) => f.label === info?.valueLabel);
  if (!field) return undefined;
  const gain = letter === 'E' || letter === 'F' || letter === 'G' || letter === 'H';
  return { reads: gain && value !== undefined ? formatNumber(value) : field.meaning, trap: /!/.test(field.meaning) };
}

/** What SPICE makes of a value typed for a part's line, in the card's words. */
export type ValueCheck =
  | { kind: 'empty' }
  /** One number SPICE reads ("SPICE reads it as 1 mΩ (milli!)"), with the check about the value, if any, and its fix. */
  | { kind: 'reads'; reads: string; readsTrap: boolean; trap?: { reason: string; fix?: { label: string; value: string } } }
  /** Not one number SPICE reads there: why, in the checks' words, and their fix ("Write 4.7k"). */
  | { kind: 'refused'; reason: string; fix?: { label: string; value: string } };

/**
 * A value for a part's line checked as the card checks it (the Add a part form): `text` holds the
 * part's line with `value` in its place. SPICE reads it as one number there, said in the card's words
 * ("1 mΩ (milli!)", with the check about it: "1M means 1 milliohm …", and its fix "Make it 1meg"), or
 * it does not, and the checks say why and how to write it ("4,7k: SPICE reads the comma as a space",
 * "Write 4.7k"; facts decimal-comma-1, space-before-suffix-1, mega-as-milli-1). `fallback` is the
 * sentence for a value no check explains.
 */
export function checkValue(text: string, key: string, value: string, fallback: string): ValueCheck {
  const v = value.trim();
  if (!v) return { kind: 'empty' };
  const spot = valueSpot(text, key);
  if (!spot) return { kind: 'refused', reason: fallback };
  const r = writeValue(spot, v, fallback);
  if (r.kind === 'empty') return r;
  if (r.kind === 'refused') return { kind: 'refused', reason: r.reason, ...(r.fix ? { fix: r.fix } : {}) };
  const { netlist, traps } = readNetlist(r.text);
  const el = netlist.lines[spot.line]?.element;
  const read = el ? readsOf(netlist, spot.line, el.letter as PartLetter, el.value?.number?.value) : undefined;
  if (!read) return { kind: 'refused', reason: fallback };
  // A check about the value itself (its span inside the value's word): 1M, 3A ...
  const from = spot.from + (spot.from === spot.to ? spot.pad.length : 0);
  const to = from + v.length;
  const trap = traps.find((t) => t.line === spot.line + 1 && t.severity !== 'info' && t.span.from >= from && t.span.to <= to);
  const fix = trap ? valueFix(trap, spot, v, from, to) : undefined;
  return { kind: 'reads', reads: read.reads, readsTrap: read.trap, ...(trap ? { trap: { reason: trap.title, ...(fix ? { fix } : {}) } } : {}) };
}

/** True when the part's value in `text` is exactly `v`, one word that SPICE reads as a number. */
function readsAsOneNumber(text: string, spot: ValueSpot, v: string): boolean {
  const el = readNetlist(text).netlist.lines[spot.line]?.element;
  if (!el || el.key !== spot.key) return false;
  const { run } = valueRun(el);
  const only = run.length === 1 ? run[0]! : undefined;
  return !!only && VALUE_ROLES.has(only.role) && only.token.text === v && el.value?.token.from === only.token.from && el.value.number !== undefined;
}

/** The schematics built last (by keepDrawing and the page), newest last. A schematic never changes once built. */
const recent: Schematic[] = [];
/** How many: an undo and a redo or two of a card's values, or of edits made in the drawing. */
const RECENT = 4;

function remember(s: Schematic): Schematic {
  const i = recent.indexOf(s);
  if (i >= 0) recent.splice(i, 1);
  recent.push(s);
  if (recent.length > RECENT) recent.shift();
  return s;
}

/**
 * The Notebook's schematic of a netlist: one of the last built when it is of the same text, else
 * built now. A value typed on a card is then drawn from one build, not two (second re-check, P3:
 * keepDrawing built the new text, and the page built it again a frame later), and a text visited
 * again (an undo, a redo, Put back) is drawn without building it again (its critic).
 */
export function schematicOf(netlist: Netlist): Schematic {
  const known = recent.find((s) => s.netlist.text === netlist.text);
  return remember(known ?? buildSchematic(netlist, NOTEBOOK_OPTIONS));
}

/** A schematic of `text` among the last built, else built now. */
const builtOf = (text: string): Schematic => remember(recent.find((s) => s.netlist.text === text) ?? buildSchematic(text, NOTEBOOK_OPTIONS));

const sameLines = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((l, i) => l === b[i]);

/**
 * For each schematic a card opened on whose build moves parts: the drawing lines that read back as
 * its drawing, or null when none do (more than the format reads, names the repairs left where they
 * took the wire away, slanted wire the repairs change again when they read it).
 */
const shownLines = new WeakMap<Schematic, string[] | null>();

/**
 * `next` as it should be written: unchanged when its parts are drawn where they were in `drawn`
 * (the drawing of the text the card opened on), or with `drawn`'s drawing written in (the *@ lines)
 * when the new value would move them, or when the build moves parts (lines that put a part's pin on
 * another node's pin). Every build of such lines moves the parts again, whatever the value (where a
 * part's pins are does not depend on it): a crafted link with 60 parts at one point took a fifth of a
 * second for each key on a computer, and a second on a phone. So each value typed then writes the
 * drawing shown (the parts where they are drawn, and the wires, names and ground symbols the repairs
 * drew) without building the piled lines again (second re-check's critic), but only when those lines
 * read back as that drawing: checked once for each text a card opens on, by building the first value's
 * text, which the page then draws. Otherwise (D5 of its critic: the first value made most of a joined
 * grid vanish, and wrote 4,900 lines) each value changes only the value and is built as the general
 * case is. Lines of parts and nodes the netlist does not have yet are kept as written (decision 0013:
 * only a change made in the drawing drops them).
 */
export function keepDrawing(drawn: Schematic, next: string): string {
  // The text the card opened on stays among the last built while the card types: an undo goes back to it.
  remember(drawn);
  if (drawn.foreign.length) return next;
  const lines = (): string[] => serializeDrawing(drawn.circuit, drawn.drawing, [...drawn.kept, ...drawn.orphans]);
  if (drawn.problems.some((p) => p.kind === 'moved-part')) {
    const known = shownLines.get(drawn);
    if (known) return applyChanges(next, drawingBlockChanges(parseNetlist(next), known));
    if (known === undefined) {
      const all = lines();
      shownLines.set(drawn, null);
      if (linesFit(all)) {
        const text = applyChanges(next, drawingBlockChanges(parseNetlist(next), all));
        const back = buildSchematic(text, NOTEBOOK_OPTIONS);
        if (sameLines(serializeDrawing(back.circuit, back.drawing, [...back.kept, ...back.orphans]), all)) {
          shownLines.set(drawn, all);
          remember(back);
          return text;
        }
      }
    }
  }
  const was = serializeDrawing(drawn.circuit, drawn.drawing, drawn.kept);
  const after = builtOf(next);
  const now = serializeDrawing(after.circuit, after.drawing, after.kept);
  if (was.length === now.length && was.every((l, i) => l === now[i])) return next;
  return applyChanges(next, drawingBlockChanges(after.netlist, lines()));
}
