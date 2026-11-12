/**
 * A check's one-click fix applied to the netlist, and what the Checks tab counts (and says aloud).
 *
 * A fix (src/spice/traps.ts) changes the part lines only, and the drawing lines follow:
 * - A fix that renames a node ("Make n3 the ground (rename it to 0)", "Rename n12 to n2") left the
 *   line that wrote the old name (`*@ label n3 …`) with no node to name, and the Checks panel warned
 *   about a line the student never wrote while the fix was announced with no traps found (final
 *   reviews, kept F1). That line now goes with the fix, as the editor's own rename takes a node's name
 *   off the drawing with the node.
 * - A fix that renames a part (a 0 V source in place of a 0 Ω resistor, "VR1"; a second part's name,
 *   "Rename it R3"; a W written for a wire) gives its position line (`*@ R1 9 0 270 …`) the new name,
 *   the rest as written, so the new part stands where the old one was drawn (the critic of kept F1:
 *   the line went, and VR1 was placed elsewhere with new wires and no word).
 * - Any other drawing line the fix leaves with nothing to name goes too. A line that already named
 *   nothing before the fix stays: it is the student's, and the Checks panel says what is wrong with it.
 */
import { NOTEBOOK_OPTIONS } from '../notebook/schematic.ts';
import { applyChanges, buildSchematic, parseDrawingLines, readDrawing, type DrawingProblem, type Schematic } from '../schematic/index.ts';
import { lowerAscii } from '../spice/parse.ts';
import type { Netlist, TextChange } from '../spice/types.ts';
import { tn } from '../i18n/index.ts';
import { controlWords } from './editing.ts';
import { parseNetlist, readNetlist } from './model.ts';

/** The drawing's warnings about drawing lines whose part or node is gone (lines kept as written but not used). */
const LEFT_WITHOUT: ReadonlySet<DrawingProblem['kind']> = new Set(['unknown-label', 'unknown-part']);

/** How many parts a netlist has (the app draws a netlist only up to a limit). */
export const partCount = (netlist: Netlist): number => netlist.lines.filter((l) => l.element).length;

/**
 * The drawing lines of a text that name a node or a part it does not have: their line numbers
 * (1-based), text as written, and for a position line the part it names (lower case).
 */
function linesLeftWithout(s: Schematic): { number: number; text: string; part?: string }[] {
  const positions = [...readDrawing(s.netlist).parts.values()];
  return s.problems.flatMap((p) => {
    const line = LEFT_WITHOUT.has(p.kind) && p.line !== undefined ? s.netlist.lines.find((l) => l.number === p.line) : undefined;
    if (!line) return [];
    const position = p.kind === 'unknown-part' ? positions.find((x) => x.line === line.number) : undefined;
    return [{ number: line.number, text: line.text.trim(), ...(position ? { part: lowerAscii(position.name) } : {}) }];
  });
}

/**
 * The parts a fix renames, old name (lower case) to new: each change that replaces exactly a part's
 * name on its line ("VR1" for R1, "R3" for a second R1, "VW1" for a W written for a wire).
 */
function renamedParts(before: string, changes: readonly TextChange[]): Map<string, string> {
  const out = new Map<string, string>();
  const lines = parseNetlist(before).lines;
  for (const c of changes) {
    const e = lines.find((l) => l.element?.name.from === c.from && l.element.name.to === c.to)?.element;
    if (e && /^\S+$/.test(c.insert)) out.set(e.key, c.insert);
  }
  return out;
}

/** A part's position line ("*@ R1 9 0 270 side=above", "*@ part Ground 8 3 0") with the part's name. */
const POSITION_NAME = /^(\s*\*@\s*)(part\s+)?(\S+)/i;

/**
 * A position line written for another name, everything else as written ("*@ R1 9 0 270 side=above"
 * for VR1: "*@ VR1 9 0 270 side=above"), or undefined when the drawing would not read it as that part's.
 */
function renamedLine(text: string, from: string, to: string): string | undefined {
  const m = POSITION_NAME.exec(text);
  if (!m || lowerAscii(m[3]!) !== from) return undefined;
  const rest = text.slice(m[0].length);
  // The format writes "part" before a name that is one of its own words (ground, wire, label, part).
  for (const lead of [m[2] ?? '', 'part ']) {
    const line = `${m[1]}${lead}${to}${rest}`;
    if (parseDrawingLines([{ text: line, line: 1 }]).parts.has(lowerAscii(to))) return line;
  }
  return undefined;
}

/** The text with some of its lines (1-based numbers) written anew, and some taken out, each with its line break. */
function withLines(text: string, rewrite: ReadonlyMap<number, string>, drop: ReadonlySet<number>): string {
  const lines = parseNetlist(text).lines;
  const changes: TextChange[] = [];
  lines.forEach((line, i) => {
    const anew = rewrite.get(line.number);
    if (anew !== undefined) {
      changes.push({ from: line.span.from, to: line.span.to, insert: anew });
      return;
    }
    if (!drop.has(line.number)) return;
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
 * The text after a fix's changes, with the drawing lines kept in step: a part the fix renamed keeps
 * its position under the new name, and a line the fix left with no node or part to name is taken
 * out. `maxParts`: the most parts the app draws (a netlist with more has no drawing to keep in step).
 */
export function fixedText(before: string, changes: readonly TextChange[], maxParts: number): string {
  const after = applyChanges(before, changes);
  const drawn = buildDrawn(after, maxParts);
  const left = drawn ? linesLeftWithout(drawn) : [];
  if (!drawn || !left.length) return after;
  // A renamed part's position line names it anew (unless the new name has a position line of its own).
  const renamed = renamedParts(before, changes);
  const placed = readDrawing(drawn.netlist).parts;
  const rewrite = new Map<number, string>();
  for (const l of left) {
    const to = l.part === undefined ? undefined : renamed.get(l.part);
    if (to === undefined || placed.has(lowerAscii(to))) continue;
    const line = renamedLine(drawn.netlist.lines.find((x) => x.number === l.number)?.text ?? '', l.part!, to);
    if (line !== undefined) rewrite.set(l.number, line);
  }
  const drawnBefore = buildDrawn(before, maxParts);
  const wrongBefore = new Set(drawnBefore ? linesLeftWithout(drawnBefore).map((l) => l.text) : []);
  const drop = new Set(left.filter((l) => !rewrite.has(l.number) && !wrongBefore.has(l.text)).map((l) => l.number));
  return rewrite.size || drop.size ? withLines(after, rewrite, drop) : after;
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
