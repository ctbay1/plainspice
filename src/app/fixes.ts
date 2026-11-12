/**
 * A check's one-click fix applied to the netlist, and what the Checks tab counts (and says aloud).
 *
 * A fix (src/spice/traps.ts) changes the part lines only. When it renames a node ("Make n3 the
 * ground (rename it to 0)", "Rename n12 to n2") or takes a part away, the drawing line that wrote
 * that node's name or placed that part (`*@ label n3 …`, `*@ part …`) is left with nothing to name,
 * and the Checks panel warned about a line the student never wrote, while the fix was announced with
 * no traps found (final reviews, kept F1). Those lines now go with the fix, as the editor's own edits
 * take a node's name off the drawing with the node. A drawing line that already named nothing before
 * the fix stays: it is the student's, and the Checks panel says what is wrong with it.
 */
import { NOTEBOOK_OPTIONS } from '../notebook/schematic.ts';
import { applyChanges, buildSchematic, type DrawingProblem, type Schematic } from '../schematic/index.ts';
import type { Netlist, TextChange } from '../spice/types.ts';
import { tn } from '../i18n/index.ts';
import { controlWords } from './editing.ts';
import { parseNetlist, readNetlist } from './model.ts';

/** The drawing's warnings about drawing lines whose part or node is gone (lines kept as written but not used). */
const LEFT_WITHOUT: ReadonlySet<DrawingProblem['kind']> = new Set(['unknown-label', 'unknown-part']);

/** How many parts a netlist has (the app draws a netlist only up to a limit). */
export const partCount = (netlist: Netlist): number => netlist.lines.filter((l) => l.element).length;

/** The drawing lines of a text that name a node or a part it does not have: their line numbers (1-based) and text as written. */
function linesLeftWithout(s: Schematic): { number: number; text: string }[] {
  return s.problems.flatMap((p) => {
    const line = LEFT_WITHOUT.has(p.kind) && p.line !== undefined ? s.netlist.lines.find((l) => l.number === p.line) : undefined;
    return line ? [{ number: line.number, text: line.text.trim() }] : [];
  });
}

/** The text without some of its lines (1-based numbers), each with its line break. */
function withoutLines(text: string, numbers: ReadonlySet<number>): string {
  const lines = parseNetlist(text).lines;
  const changes: TextChange[] = [];
  lines.forEach((line, i) => {
    if (!numbers.has(line.number)) return;
    const next = lines[i + 1];
    const previous = lines[i - 1];
    // The line and the break after it; the last line (no break after it): the break before it.
    if (next) changes.push({ from: line.span.from, to: next.span.from, insert: '' });
    else if (previous) changes.push({ from: previous.span.to, to: line.span.to, insert: '' });
    else changes.push({ from: line.span.from, to: line.span.to, insert: '' });
  });
  return applyChanges(text, changes);
}

/**
 * The text after a fix's changes, without the drawing lines the fix left with no node or part to
 * name. `maxParts`: the most parts the app draws (a netlist with more has no drawing to keep in step).
 */
export function fixedText(before: string, changes: readonly TextChange[], maxParts: number): string {
  const after = applyChanges(before, changes);
  const drawn = buildDrawn(after, maxParts);
  const left = drawn ? linesLeftWithout(drawn) : [];
  if (!left.length) return after;
  const drawnBefore = buildDrawn(before, maxParts);
  const wrongBefore = new Set(drawnBefore ? linesLeftWithout(drawnBefore).map((l) => l.text) : []);
  const drop = new Set(left.filter((l) => !wrongBefore.has(l.text)).map((l) => l.number));
  return drop.size ? withoutLines(after, drop) : after;
}

/** The drawing of a text, as the app draws it, or undefined when it has more parts than the app draws. */
function buildDrawn(text: string, maxParts: number): Schematic | undefined {
  const netlist = parseNetlist(text);
  return partCount(netlist) > maxParts ? undefined : buildSchematic(netlist, NOTEBOOK_OPTIONS);
}

/** What is wrong with the drawing lines (a *@ line PlainSpice cannot read or use): listed in the Checks panel and counted with the checks. */
export const drawingWarnings = (s: Schematic | undefined): DrawingProblem[] => (s?.problems ?? []).filter((p) => p.severity === 'warning');

/** The dependent sources placed on the drawing that still read what PlainSpice chose for them (in the Checks panel too, until the student chooses). */
export function stillToChoose(s: Schematic | undefined, unchosen: ReadonlySet<string>): { key: string; name: string; control: string }[] {
  if (!s) return [];
  return [...unchosen].flatMap((key) => {
    const part = s.circuit.parts.find((p) => p.key === key);
    const control = part ? controlWords(part) : undefined;
    return part && control ? [{ key, name: part.name, control }] : [];
  });
}

/**
 * The Checks tab's count, said aloud: "1 trap found." while everything it counts is a trap (the
 * checks find traps), else the tab's own words, "2 found in Checks.", so what is heard after a fix
 * or an edit is the number the tab shows (final reviews, kept F1).
 */
export function checksSaid(traps: number, others: number): string {
  return others ? tn('checksFound', traps + others) : tn('checksCount', traps);
}

/** What the Checks tab would say for a text (its traps, its drawing's warnings, the sources still to choose). */
export function checksSaidFor(text: string, unchosen: ReadonlySet<string>, maxParts: number): string {
  const traps = readNetlist(text).traps.length;
  const drawn = buildDrawn(text, maxParts);
  return checksSaid(traps, drawingWarnings(drawn).length + stillToChoose(drawn, unchosen).length);
}
