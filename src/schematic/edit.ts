/**
 * The schematic editor's operations: pure functions from a schematic (its netlist text and drawing)
 * and an operation to text changes, in the shape of src/spice/types.ts TextChange, so the app
 * applies them like the checks' fixes and undoes and redoes them as text. Plain TypeScript.
 *
 * The netlist is written for the student: their lines, comments, spacing and order stay; an edit
 * changes only the words it must (a node name, a value), removes only the lines of a deleted part,
 * and puts a new part's line before the analysis lines (an empty text gets a title line first, since
 * SPICE skips line 1). The drawing lines (format.ts) are rewritten as one block, unless
 * `drawingInText` is false (positions kept elsewhere, such as a share link): then only part lines
 * change and `lines` holds the drawing lines to keep. Rewriting the block drops the lines of parts and
 * nodes the netlist no longer has (`Schematic.orphans`), with a note.
 *
 * What edits do to nodes:
 * - a new part's pins join the nodes they touch; a pin touching nothing gets a new node (n1, n2 ...);
 * - a wire between two nodes, or a ground symbol on a node, makes them one node: ground wins, then a
 *   node named in a dot command or a .control line (.tf v(out) ...), then the node that comes first
 *   in the netlist; every mention of the other name changes, in .control lines too;
 * - removing a wire or a ground symbol can leave a node in two pieces: the piece with the node's
 *   label (or ground symbol, or else its first pin) keeps the name, the other piece's pins get a new
 *   name;
 * - deleting a part deletes its lines; a node left with no pins is gone from the netlist. Lines that
 *   still name the part or such a node (an F reading its current, a .tf line, a .control line ...)
 *   are left as the student wrote them, and the summary says which, so they can be changed;
 * - renaming a node to a name that exists joins them by name (the label is written on each piece);
 * - reversing a part swaps its two node names in the text and turns its symbol round, so the wires
 *   stay where they are (a source's + and − sides swap).
 * Moving, turning and mirroring never change the netlist; a move that would put a pin on another
 * node's copper, or a symbol on another symbol, or leave wires that find no way (so pieces would be
 * joined only by name), is refused with the reason. While the netlist holds another version's
 * drawing lines, only edits that change part lines are done: changing the drawing would leave that
 * version's lines behind, out of step.
 */
import { lowerAscii, parseNetlist } from '../spice/parse.ts';
import type { Netlist, TextChange, Token } from '../spice/types.ts';
import { GROUND, circuitFromNetlist, type Circuit, type CircuitPart } from './circuit.ts';
import { drawnPins, findIslands } from './connectivity.ts';
import { cloneDrawing, cloneLabel, groundGeometry, partGeometry, symbolGeometry, type Drawing, type LabelSide, type NodeSpot } from './drawing.ts';
import { LABEL_SIDES, NODE_SPOTS } from './drawing.ts';
import {
  COORD_LIMIT,
  NEW_TITLE,
  applyChanges,
  drawingBlockChanges,
  newlineOf,
  parseDrawingLines,
  serializeDrawing,
  type DrawingLines,
  type DrawingProblem,
  type LabelLine,
  type PositionLine,
} from './format.ts';
import { ROTATIONS, boxesOverlap, inflate, isOrthogonal, nextRotation, pointKey, pointOnSegment, samePoint, segmentCrossesBox, segmentsOf, type Point, type Rotation } from './geometry.ts';
import type { LayoutOptions } from './layout.ts';
import { describePart } from './navigate.ts';
import { ROUTE_COSTS, findRoute, type RouteEnd } from './route.ts';
import { buildScene } from './scene.ts';
import { buildSchematic, type Schematic } from './schematic.ts';
import { PART_LETTERS, type PartLetter } from './symbols.ts';
import { normalizeWires, pruneDangling, toSegments } from './wires.ts';

/** One end of a new wire: a part's pin, a ground symbol's pin, or a point on a wire. */
export type WireEnd = { part: string; pin: 0 | 1 } | { ground: number } | { at: Point };

export type EditOp =
  | { kind: 'add-part'; letter: PartLetter; at: Point; rot?: Rotation; mirror?: boolean }
  | { kind: 'add-ground'; at: Point; rot?: Rotation }
  | { kind: 'move-part'; part: string; to: Point }
  | { kind: 'move-ground'; ground: number; to: Point }
  | { kind: 'rotate-part'; part: string; rot?: Rotation }
  | { kind: 'mirror-part'; part: string }
  | { kind: 'reverse-part'; part: string }
  | { kind: 'delete-part'; part: string }
  | { kind: 'delete-ground'; ground: number }
  | { kind: 'add-wire'; from: WireEnd; to: WireEnd; via?: Point[] }
  | { kind: 'delete-wire'; wire: number; segment?: number }
  | { kind: 'rename-node'; node: string; name: string }
  | { kind: 'move-label'; node: string; to?: Point; side?: NodeSpot | 'auto' }
  | { kind: 'set-side'; part: string; side: LabelSide | 'auto' }
  | { kind: 'set-value'; part: string; value: string }
  | { kind: 'set-control'; part: string; plus?: string; minus?: string; source?: string };

export interface EditOptions extends LayoutOptions {
  /** Write the drawing lines into the netlist (default true). */
  drawingInText?: boolean;
}

export interface EditResult {
  ok: boolean;
  /** Why nothing changed, in plain words (when ok is false). */
  reason?: string;
  /** Changes to the netlist text the schematic was built from; sorted, never overlapping. */
  changes: TextChange[];
  /** The netlist after the changes. */
  text: string;
  /** The drawing after the edit. */
  drawing: Drawing;
  /** The drawing lines after the edit, header first (to keep them elsewhere when drawingInText is false). */
  lines: string[];
  /** What happened, for a live region: "R3 added between n1 and n4." */
  summary: string;
  /** What PlainSpice also did to the drawing to keep it in step (wires redrawn, lines of parts no longer there removed ...). */
  notes: DrawingProblem[];
  /** What to select afterwards: a part, a node, or a netlist line (1-based) that needs the student's eye. */
  select?: { part: string } | { node: string } | { line: number };
}

/** Every sentence the editor says, in one object so a Turkish UI can replace it later. */
export const EDIT_STRINGS = {
  ground: 'ground',
  added: (name: string, a: string, b: string): string => `${name} added between ${a} and ${b}.`,
  groundAdded: 'Ground symbol added.',
  nowGround: (node: string): string => `${node} is now ground (node 0).`,
  moved: (name: string): string => `${name} moved.`,
  groundMoved: 'Ground symbol moved.',
  turned: (name: string): string => `${name} turned.`,
  mirrored: (name: string): string => `${name} mirrored.`,
  reversed: (name: string): string => `${name} reversed.`,
  deleted: (name: string): string => `${name} deleted.`,
  groundDeleted: 'Ground symbol deleted.',
  unused: (nodes: string): string => `No part connects to ${nodes} any more.`,
  stillNamed: (list: string, many: boolean, name: string): string => `${list} still ${many ? 'name' : 'names'} ${name}.`,
  onLine: (what: string, line: number): string => `${what} (line ${line})`,
  wired: 'Wire added.',
  merged: (gone: string, kept: string): string => `${gone} and ${kept} are now one node, ${kept}.`,
  wireDeleted: 'Wire deleted.',
  split: (node: string, piece: string): string => `Part of ${node} is now a separate node, ${piece}.`,
  renamed: (old: string, name: string): string => `${old} renamed to ${name}.`,
  joinedByName: (name: string): string => `The pieces named ${name} are one node.`,
  labelMoved: (node: string): string => `Label ${node} moved.`,
  wordsMoved: (name: string): string => `${name}'s words moved.`,
  valueSet: (name: string, value: string): string => `${name} is now ${value}.`,
  controlSet: (name: string, control: string): string => `${name} now reads ${control}.`,
  orphansDropped: (names: string): string => `The drawing lines of ${names}, which the netlist no longer has, were removed.`,
  failedDropped: 'The drawing lines PlainSpice could not use were replaced.',
  and: (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`),
  // Why an edit cannot be done.
  noPart: (name: string): string => `There is no part ${name} in the drawing.`,
  noGround: 'There is no such ground symbol.',
  noWire: 'There is no such wire.',
  noNode: (name: string): string => `There is no node ${name} in the drawing.`,
  taken: (what: string): string => `That place is taken by ${what}.`,
  onWire: 'A wire runs there.',
  foreign: (node: string): string => `A pin would touch ${node}, another node.`,
  wireEnds: 'A wire needs a pin or a wire at each end.',
  noRoute: 'There is no way for a wire between those two points.',
  noWay: (name: string): string => `${name}'s wires would find no way there. Try a place with more room.`,
  noTurn: (name: string): string => `${name} can't turn there: its wires would find no way. Move it to a place with more room first, or use Reverse to swap its ends.`,
  noHalfTurn: (name: string): string => `Turning ${name} round where it stands would loop its wires round it. To swap its two ends instead, use Reverse.`,
  slanted: 'A wire runs only across and up or down.',
  offGrid: `That place is off the grid: x and y must be whole numbers from −${COORD_LIMIT} to ${COORD_LIMIT}.`,
  badTurn: 'A part turns in quarter turns: 0, 90, 180 or 270.',
  sameTurn: (name: string): string => `${name} is already turned that way.`,
  samePlace: (name: string): string => `${name} is already there.`,
  groundThere: 'The ground symbol is already there.',
  badName: (name: string): string => (name ? `PlainSpice keeps node names to letters, digits and _ (32 at most), so it can't use "${name}".` : 'A node needs a name.'),
  badSource: (name: string): string => `PlainSpice keeps part names to a letter followed by letters, digits and _, so it can't use "${name}".`,
  groundName: 'Ground (node 0) keeps its name.',
  badValue: 'A value must be one line of text.',
  badSide: 'Words go right, left, above or below a part; a node name goes at one of its spots.',
  notControlled: (name: string): string => `${name} is not a dependent source.`,
  noSource: (letter: string): string => `${letter} reads the current in a voltage source, and this circuit has none yet: add a V source first.`,
  notDrawable: (letter: string): string => `The drawing has no symbol for ${letter}: it draws R, C, L, V, I, E, F, G and H.`,
  labelOff: (node: string): string => `A label for ${node} must be on ${node}'s wires or pins.`,
  otherVersion: (header: string): string =>
    `This drawing was saved by another version of PlainSpice (${header}), so this one can't change it; reloading the page gets the newest PlainSpice. Values, names and parts can still be changed.`,
  failed: 'PlainSpice could not make that change.',
} as const;

const S = EDIT_STRINGS;

/** The value a new part starts with: small, common, and never a trap such as 1M. */
export const DEFAULT_VALUES: Readonly<Record<PartLetter, string>> = { R: '1k', C: '1u', L: '1m', V: '5', I: '1m', E: '2', F: '2', G: '1m', H: '1k' };

const NODE_NAME = /^[A-Za-z0-9_]{1,32}$/;
const PART_NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

// ------------------------------------------------------------------ helpers

const replaceToken = (t: Token, insert: string): TextChange => ({ from: t.from, to: t.to, insert });

/** Sorts changes and merges touching or overlapping ones, so an editor can apply them at once. */
export function mergeChanges(text: string, changes: readonly TextChange[]): TextChange[] {
  const sorted = changes.map((c, i) => ({ c, i })).sort((a, b) => a.c.from - b.c.from || a.c.to - b.c.to || a.i - b.i).map((x) => x.c);
  const out: TextChange[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.from <= last.to) {
      const to = Math.max(last.to, c.to);
      const gap = c.from > last.to ? text.slice(last.to, c.from) : '';
      out[out.length - 1] = { from: last.from, to, insert: last.insert + gap + c.insert };
    } else out.push({ ...c });
  }
  return out.filter((c) => c.from !== c.to || c.insert !== '');
}

/** How a node is said in a summary: its name as written, "ground" for node 0. */
function said(circuit: Circuit, node: string): string {
  return node === GROUND ? S.ground : (circuit.nodes.get(node)?.text ?? node);
}

/** A point an edit may use: whole numbers within the drawing's limits. */
const onGrid = (p: Point | undefined): boolean =>
  p !== undefined && Number.isInteger(p.x) && Number.isInteger(p.y) && Math.abs(p.x) <= COORD_LIMIT && Math.abs(p.y) <= COORD_LIMIT;

/** Names taken by parts anywhere in the netlist (lines not drawn included). */
function takenPartNames(s: Schematic): Set<string> {
  const out = new Set<string>();
  for (const line of s.netlist.lines) if (line.element) out.add(line.element.key);
  for (const n of s.circuit.notDrawn) out.add(lowerAscii(n.name));
  return out;
}

export function freshPartName(s: Schematic, letter: PartLetter): string {
  const taken = takenPartNames(s);
  for (let i = 1; ; i++) {
    const name = `${letter}${i}`;
    if (!taken.has(lowerAscii(name))) return name;
  }
}

function freshNodeName(s: Schematic, taken: Set<string>): string {
  // Nodes of lines the drawing does not show count too: ngspice reads a part after .end, for one.
  const elsewhere = new Set(s.circuit.notDrawn.filter((n) => n.reason !== 'in-subcircuit').flatMap((n) => n.nodes));
  for (const r of controlNodeRefs(s.netlist)) elsewhere.add(r.name);
  for (let i = 1; ; i++) {
    const name = `n${i}`;
    if (!s.netlist.nodes.has(name) && !elsewhere.has(name) && !taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
}

/**
 * Nodes named in .control lines, as v(...), vm(...), vp(...), vr(...), vi(...) or vdb(...), the way
 * the parser finds them in dot commands (parse.ts, nodeRefsInDirective).
 */
function controlNodeRefs(netlist: Netlist): { token: Token; name: string; line: number }[] {
  const out: { token: Token; name: string; line: number }[] = [];
  const text = netlist.text;
  for (const line of netlist.lines) {
    if (line.kind !== 'control') continue;
    const tokens = line.tokens;
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k]!;
      if (!/^v(m|p|r|i|db)?$/i.test(t.text)) continue;
      const open = /^\s*\(/.exec(text.slice(t.to, line.span.to));
      if (!open) continue;
      const close = text.indexOf(')', t.to + open[0].length);
      const stop = close < 0 || close > line.span.to ? line.span.to : close;
      for (let j = k + 1; j < tokens.length && tokens[j]!.from < stop; j++) {
        const name = lowerAscii(tokens[j]!.text);
        out.push({ token: tokens[j]!, name, line: line.index });
      }
    }
  }
  return out;
}

/** Every mention of a node: part lines, dot commands and .control lines. */
function refsOf(netlist: Netlist, node: string): Token[] {
  return [...(netlist.nodes.get(node)?.refs ?? []), ...controlNodeRefs(netlist).filter((r) => r.name === node).map((r) => r.token)];
}

/** The changes that rename every mention of a node (part lines, dot commands and .control lines). */
function renameRefs(netlist: Netlist, node: string, text: string): TextChange[] {
  return refsOf(netlist, node).map((t) => replaceToken(t, text));
}

/** Which of two nodes keeps its name when they become one: ground, then one named in a dot command or .control line, then the first. */
function survivor(netlist: Netlist, a: string, b: string): string {
  if (a === GROUND || b === GROUND) return GROUND;
  const commands = new Set(netlist.lines.filter((l) => l.kind === 'directive' || l.kind === 'control').map((l) => l.index));
  const inCommand = (n: string): boolean => refsOf(netlist, n).some((t) => commands.has(lineOfOffset(netlist, t.from)));
  const da = inCommand(a);
  const db = inCommand(b);
  if (da !== db) return da ? a : b;
  const first = (n: string): number => netlist.nodes.get(n)?.refs[0]?.from ?? Infinity;
  return first(a) <= first(b) ? a : b;
}

function lineOfOffset(netlist: Netlist, offset: number): number {
  let lo = 0;
  let hi = netlist.lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (netlist.lines[mid]!.span.from <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** A line that names a part or a node, for saying what still does after an edit. */
interface Mention {
  /** 0-based line index. */
  line: number;
  /** 1-based line number. */
  lineNumber: number;
  /** What the line is: a part's name as written, a dot command (".tf"), or ".control". */
  what: string;
  /** The key of a drawn part on that line. */
  part?: string;
}

/** The line a continuation line belongs to (itself otherwise). */
const ownerOf = (netlist: Netlist, index: number): number => netlist.lines[index]?.continues ?? index;

function mentionOf(s: Schematic, index: number): Mention {
  const line = s.netlist.lines[index]!;
  const m: Mention = { line: index, lineNumber: line.number, what: line.element?.name.text ?? line.directive?.name ?? '.control' };
  const key = line.element?.key;
  if (key && s.circuit.parts.some((p) => p.key === key && p.line === index)) m.part = key;
  return m;
}

/**
 * The lines other than the part's own that name a part: F, H and W lines reading its current, K lines
 * coupling it, B lines using it, and dot commands and .control lines (i(V1), V1#branch, @R1[i], a
 * .tf or .dc source).
 */
function partMentions(s: Schematic, part: CircuitPart): Mention[] {
  const key = part.key;
  const names = (text: string): boolean => {
    const t = lowerAscii(text);
    return t === key || t.startsWith(`${key}#`) || t.startsWith(`@${key}[`);
  };
  const nodeTokens = new Set<number>();
  for (const info of s.netlist.nodes.values()) for (const t of info.refs) nodeTokens.add(t.from);
  for (const r of controlNodeRefs(s.netlist)) nodeTokens.add(r.token.from);
  const lines = new Set<number>();
  for (const line of s.netlist.lines) {
    const owner = ownerOf(s.netlist, line.index);
    if (owner === part.line) continue;
    const el = s.netlist.lines[owner]?.element;
    if (line.element) {
      const hit = line.element.fields.some(
        (f) => (f.role === 'control-source' || (line.element!.letter === 'K' && f.role === 'other') || (line.element!.letter === 'B' && f.role === 'parameter')) && names(f.token.text),
      );
      if (hit) lines.add(line.index);
      continue;
    }
    if (el) continue; // a continuation of a part line: read with its part above
    const kind = s.netlist.lines[owner]?.kind;
    if (kind !== 'directive' && kind !== 'control') continue;
    // A dot command's first word is its name; a continuation line's words are all arguments.
    const first = kind === 'directive' && line.index === owner ? 1 : 0;
    if (line.tokens.some((t, i) => i >= first && !nodeTokens.has(t.from) && names(t.text))) lines.add(owner);
  }
  return [...lines].sort((a, b) => a - b).map((i) => mentionOf(s, i));
}

/** The lines that still name a node, other than the given part lines: E and G controls, dot commands, .control lines. */
function nodeMentions(s: Schematic, node: string, except: ReadonlySet<number>): Mention[] {
  const lines = new Set<number>();
  for (const t of refsOf(s.netlist, node)) {
    const owner = ownerOf(s.netlist, lineOfOffset(s.netlist, t.from));
    if (!except.has(owner)) lines.add(owner);
  }
  return [...lines].sort((a, b) => a - b).map((i) => mentionOf(s, i));
}

/** "F1 (line 6) and .tf (line 9) still name Vsense." */
function stillNamed(mentions: readonly Mention[], name: string): string {
  return S.stillNamed(S.and(mentions.map((m) => S.onLine(m.what, m.lineNumber))), mentions.length > 1, name);
}

/** The changes that remove a part's line and its continuation lines (comments between them stay). */
function removeLines(netlist: Netlist, lineIndex: number): TextChange[] {
  const indexes = [lineIndex, ...netlist.lines.filter((l) => l.continues === lineIndex).map((l) => l.index)];
  return indexes.map((i) => ({ from: netlist.lines[i]!.span.from, to: netlist.lines[i + 1]?.span.from ?? netlist.text.length, insert: '' }));
}

/**
 * Where a new part line goes: before the first analysis line, else before .end, else before the
 * drawing lines, else at the end. An empty text gets a title line first: SPICE skips line 1.
 */
function insertLine(netlist: Netlist, line: string): TextChange {
  const nl = newlineOf(netlist.text);
  const text = netlist.text;
  if (!text.length) return { from: 0, to: 0, insert: `${NEW_TITLE}${nl}${line}${nl}` };
  const before = netlist.analyses[0] ?? netlist.end ?? netlist.lines.find((l) => l.index > 0 && l.kind === 'comment' && /^\s*\*(@|\s*plainspice-drawing)/i.test(l.text))?.index;
  if (before !== undefined && before > 0) {
    const at = netlist.lines[before]!.span.from;
    return { from: at, to: at, insert: `${line}${nl}` };
  }
  const lead = text.endsWith('\n') ? '' : nl;
  return { from: text.length, to: text.length, insert: `${lead}${line}${nl}` };
}

/** Drawing lines that say exactly what a drawing says (no line numbers). */
function linesOf(circuit: Circuit, drawing: Drawing): DrawingLines {
  const parts = new Map<string, PositionLine>();
  for (const [key, p] of drawing.parts) {
    const name = circuit.parts.find((q) => q.key === key)?.name ?? key;
    const line: PositionLine = { name, at: p.at, rot: p.rot, mirror: p.mirror, line: 0, text: '' };
    if (p.side) line.side = p.side;
    parts.set(key, line);
  }
  return {
    parts,
    grounds: drawing.grounds.map((g) => ({ at: g.at, rot: g.rot })),
    wires: drawing.wires.map((w) => w.slice()),
    labels: drawing.labels.map((l): LabelLine => (l.side ? { node: l.node, at: l.at, side: l.side, line: 0, text: '' } : { node: l.node, at: l.at, line: 0, text: '' })),
    unreadable: [],
    foreign: [],
    problems: [],
    lineIndexes: [],
    present: true,
  };
}

function refuse(s: Schematic, reason: string): EditResult {
  return {
    ok: false,
    reason,
    changes: [],
    text: s.netlist.text,
    drawing: s.drawing,
    lines: s.foreign.length ? s.foreign.map((f) => f.text) : serializeDrawing(s.circuit, s.drawing, [...s.kept, ...s.orphans]),
    summary: reason,
    notes: [],
  };
}

interface Finish {
  summary: string;
  select?: EditResult['select'];
  /** The part an add-part made: refused if the text does not have it afterwards. */
  added?: string;
  /** Refuse when the drawing would need pieces joined by name (a move or a turn whose wires find no way). */
  noNaming?: string;
  /** The summary after the rebuild (for words that need the new circuit). */
  after?: (rebuilt: Schematic) => string;
}

/** Rebuilds the schematic from the changed part lines and the intended drawing, and writes the result. */
function finish(s: Schematic, lineChanges: TextChange[], next: Drawing, f: Finish, options: EditOptions): EditResult {
  const text = s.netlist.text;
  const partText = applyChanges(text, mergeChanges(text, lineChanges));
  const netlist2 = parseNetlist(partText);
  const circuit2 = circuitFromNetlist(netlist2);
  const { drawingInText, ...layout } = options;
  if (f.added && !circuit2.parts.some((p) => p.key === f.added)) return refuse(s, S.failed);
  if (s.foreign.length) {
    // Another version's drawing: only part lines change; the drawing lines stay as they are.
    const rebuilt = buildSchematic(netlist2, { ...layout, lines: parseDrawingLines(s.foreign) });
    const changes = mergeChanges(text, lineChanges);
    const result: EditResult = { ok: true, changes, text: applyChanges(text, changes), drawing: rebuilt.drawing, lines: s.foreign.map((x) => x.text), summary: f.after?.(rebuilt) ?? f.summary, notes: [] };
    if (f.select) result.select = f.select;
    return result;
  }
  for (const key of next.parts.keys()) if (!circuit2.parts.some((p) => p.key === key)) next.parts.delete(key);
  next.labels = next.labels.filter((l) => circuit2.nodes.has(l.node));
  const rebuilt = buildSchematic(netlist2, { ...layout, lines: linesOf(circuit2, next) });
  if (f.noNaming && rebuilt.problems.some((p) => p.kind === 'connected-by-name')) return refuse(s, f.noNaming);
  const lines = serializeDrawing(rebuilt.circuit, rebuilt.drawing, s.kept);
  let block = drawingInText === false ? [] : drawingBlockChanges(s.netlist, lines);
  const end = text.length;
  if (!end) {
    // An empty text: the part line brought the title line, so the block does not need one.
    const nl = newlineOf(partText);
    if (lineChanges.some((c) => c.insert.startsWith(`${NEW_TITLE}${nl}`))) block = block.map((c) => ({ ...c, insert: c.insert.replace(`${NEW_TITLE}${nl}`, '') }));
  } else if (lineChanges.some((c) => c.from === end && c.insert.endsWith('\n'))) {
    // A part line and a new block both going at the end of a text without a final line break: one break is enough.
    block = block.map((c) => (c.from === end ? { ...c, insert: c.insert.replace(/^\r?\n/, '') } : c));
  }
  const changes = mergeChanges(text, [...lineChanges, ...block]);
  const notes = rebuilt.problems.slice();
  if (s.orphans.length && s.problems.some((p) => p.kind === 'drawing-failed')) {
    notes.push({ kind: 'orphans-dropped', severity: 'info', message: S.failedDropped });
  } else if (s.orphans.length) {
    const names = s.orphans.map((o) => {
      const words = o.replace(/^\s*\*@\s*/, '').split(/\s+/);
      const first = lowerAscii(words[0] ?? '');
      return first === 'label' ? (words[1] ?? '?') : first === 'part' ? (words[1] ?? '?') : (words[0] ?? '?');
    });
    notes.push({ kind: 'orphans-dropped', severity: 'info', message: S.orphansDropped(S.and(names)) });
  }
  const result: EditResult = { ok: true, changes, text: applyChanges(text, changes), drawing: rebuilt.drawing, lines, summary: f.after?.(rebuilt) ?? f.summary, notes };
  if (f.select) result.select = f.select;
  return result;
}

interface Copper {
  /** The island at a point, if any. */
  island(p: Point): number | undefined;
  /** The node of an island (from its pins, ground symbols or labels). */
  nodeOf(island: number): string | undefined;
  /** Copper points of other islands than these, for routing. */
  foreign(except: ReadonlySet<number>): { wires: Point[][]; pins: Point[] };
}

function copper(s: Schematic, drawing: Drawing = s.drawing): Copper {
  const pins = drawnPins(s.circuit, drawing);
  const islands = findIslands(drawing.wires, pins.map((p) => p.at));
  const node = new Map<number, string>();
  pins.forEach((p, i) => node.set(islands.anchors[i]!, p.node));
  for (const l of drawing.labels) {
    const i = islands.at(l.at);
    if (i !== undefined && !node.has(i)) node.set(i, l.node);
  }
  return {
    island: (p) => islands.at(p),
    nodeOf: (i) => node.get(i),
    foreign(except) {
      return {
        wires: drawing.wires.filter((_, i) => !except.has(islands.wires[i]!)),
        pins: pins.filter((_, i) => !except.has(islands.anchors[i]!)).map((p) => p.at),
      };
    },
  };
}

/** A symbol at a place: refused when it lands on another symbol, a wire, or (for its pins) another node. */
function placeProblem(s: Schematic, geom: ReturnType<typeof symbolGeometry>, pinNodes: readonly (string | undefined)[], ignore: { part?: string; ground?: number }, drawing: Drawing = s.drawing): string | undefined {
  const scene = buildScene(s.circuit, drawing, s.options);
  // Bodies may not touch other symbols; leads may meet at a shared pin.
  const clash = (box: { x0: number; y0: number; x1: number; y1: number }, body: typeof box): boolean =>
    boxesOverlap(geom.body, box) || boxesOverlap(inflate(geom.box, -0.05), body);
  for (const p of scene.parts) {
    if (p.key === ignore.part) continue;
    if (clash(p.box, p.body)) return S.taken(p.name);
  }
  for (const g of scene.grounds) {
    if (g.index === ignore.ground) continue;
    if (clash(g.box, g.body)) return S.taken(S.ground);
  }
  const ownPins = new Set(geom.pins.map(pointKey));
  for (const w of drawing.wires) {
    for (const [a, b] of segmentsOf(w)) {
      if (segmentCrossesBox(a, b, geom.box) && !(ownPins.has(pointKey(a)) && ownPins.has(pointKey(b)))) return S.onWire;
    }
  }
  const pins = drawnPins(s.circuit, drawing).filter(
    (p) => (ignore.part === undefined || p.part !== ignore.part) && (ignore.ground === undefined || p.ground !== ignore.ground),
  );
  const islands = findIslands(drawing.wires, pins.map((p) => p.at));
  const nodeOfIsland = new Map<number, string>();
  pins.forEach((p, i) => nodeOfIsland.set(islands.anchors[i]!, p.node));
  for (const l of drawing.labels) {
    const i = islands.at(l.at);
    if (i !== undefined && !nodeOfIsland.has(i)) nodeOfIsland.set(i, l.node);
  }
  for (let i = 0; i < geom.pins.length; i++) {
    const want = pinNodes[i];
    if (want === undefined) continue;
    const island = islands.at(geom.pins[i]!);
    const there = island === undefined ? undefined : nodeOfIsland.get(island);
    if (there !== undefined && there !== want) return S.foreign(said(s.circuit, there));
  }
  return undefined;
}

// ------------------------------------------------------------------ the operations

/** Operations that change only part lines: they work even on another version's drawing. */
const TEXT_ONLY = new Set<EditOp['kind']>(['set-value', 'set-control', 'rename-node', 'reverse-part', 'delete-part']);

/** Applies one editor operation to a schematic. Never throws; a refused edit has ok: false and a reason. */
export function applyEdit(s: Schematic, op: EditOp, options: EditOptions = {}): EditResult {
  const o: EditOptions = { ...s.options, ...options };
  if (s.foreign.length && !TEXT_ONLY.has(op.kind)) {
    const header = s.foreign[0]!.text.trim().replace(/^\*\s*/, '');
    return refuse(s, S.otherVersion(header));
  }
  try {
    return dispatch(s, op, o);
  } catch {
    return refuse(s, S.failed);
  }
}

function dispatch(s: Schematic, op: EditOp, options: EditOptions): EditResult {
  switch (op.kind) {
    case 'add-part':
      return addPart(s, op, options);
    case 'add-ground':
      return addGround(s, op, options);
    case 'move-part':
    case 'rotate-part':
    case 'mirror-part':
      return movePart(s, op, options);
    case 'reverse-part':
      return reversePart(s, op.part, options);
    case 'move-ground':
      return moveGround(s, op, options);
    case 'delete-part':
      return deletePart(s, op.part, options);
    case 'delete-ground':
      return deleteGround(s, op.ground, options);
    case 'add-wire':
      return addWire(s, op, options);
    case 'delete-wire':
      return deleteWire(s, op, options);
    case 'rename-node':
      return renameNode(s, op.node, op.name, options);
    case 'move-label':
      return moveLabel(s, op, options);
    case 'set-side':
      return setSide(s, op, options);
    case 'set-value':
      return setValue(s, op.part, op.value, options);
    case 'set-control':
      return setControl(s, op, options);
  }
}

const validRotation = (rot: Rotation | undefined): boolean => rot === undefined || ROTATIONS.includes(rot);

function addPart(s: Schematic, op: Extract<EditOp, { kind: 'add-part' }>, options: EditOptions): EditResult {
  if (!PART_LETTERS.includes(op.letter)) return refuse(s, S.notDrawable(String(op.letter)));
  if (!onGrid(op.at)) return refuse(s, S.offGrid);
  if (!validRotation(op.rot)) return refuse(s, S.badTurn);
  const rot = op.rot ?? 0;
  let control = '';
  if (op.letter === 'F' || op.letter === 'H') {
    // F and H read the current in a V source; an E or H works too (P10b).
    const source = s.circuit.parts.find((p) => p.letter === 'V') ?? s.circuit.parts.find((p) => p.letter === 'E' || p.letter === 'H');
    if (!source) return refuse(s, S.noSource(op.letter));
    control = ` ${source.name}`;
  }
  const geom = symbolGeometry(op.letter, op.at, rot, op.mirror ?? false);
  const problem = placeProblem(s, geom, [undefined, undefined], {});
  if (problem) return refuse(s, problem);
  const cu = copper(s);
  const taken = new Set<string>();
  const nodes = geom.pins.map((p) => {
    const island = cu.island(p);
    const node = island === undefined ? undefined : cu.nodeOf(island);
    return node ?? freshNodeName(s, taken);
  }) as [string, string];
  const text = (n: string): string => (n === GROUND ? '0' : (s.circuit.nodes.get(n)?.text ?? n));
  const name = freshPartName(s, op.letter);
  const value = DEFAULT_VALUES[op.letter];
  if (op.letter === 'E' || op.letter === 'G') {
    const first = [...s.circuit.nodes.values()].find((n) => !n.ground)?.text ?? nodes.find((n) => n !== GROUND) ?? '0';
    control = ` ${first} 0`;
  }
  const line = `${name} ${text(nodes[0])} ${text(nodes[1])}${control} ${value}`;
  const next = cloneDrawing(s.drawing);
  next.parts.set(lowerAscii(name), { at: op.at, rot, mirror: op.mirror ?? false });
  const summary = S.added(name, nodes[0] === GROUND ? S.ground : text(nodes[0]), nodes[1] === GROUND ? S.ground : text(nodes[1]));
  return finish(s, [insertLine(s.netlist, line)], next, { summary, select: { part: lowerAscii(name) }, added: lowerAscii(name) }, options);
}

function addGround(s: Schematic, op: Extract<EditOp, { kind: 'add-ground' }>, options: EditOptions): EditResult {
  if (!onGrid(op.at)) return refuse(s, S.offGrid);
  if (!validRotation(op.rot)) return refuse(s, S.badTurn);
  const rot = op.rot ?? 0;
  const geom = symbolGeometry('ground', op.at, rot, false);
  const problem = placeProblem(s, geom, [undefined], {});
  if (problem) return refuse(s, problem);
  const cu = copper(s);
  const island = cu.island(geom.pins[0]!);
  const node = island === undefined ? undefined : cu.nodeOf(island);
  const next = cloneDrawing(s.drawing);
  next.grounds.push({ at: op.at, rot });
  if (node === undefined || node === GROUND) return finish(s, [], next, { summary: S.groundAdded }, options);
  // The node it touches becomes ground.
  const changes = renameRefs(s.netlist, node, '0');
  next.labels = next.labels.filter((l) => l.node !== node);
  return finish(s, changes, next, { summary: `${S.groundAdded} ${S.nowGround(said(s.circuit, node))}`, select: { node: GROUND } }, options);
}

function movePart(s: Schematic, op: Extract<EditOp, { kind: 'move-part' | 'rotate-part' | 'mirror-part' }>, options: EditOptions): EditResult {
  const part = s.circuit.parts.find((p) => p.key === lowerAscii(op.part));
  const placed = part ? s.drawing.parts.get(part.key) : undefined;
  if (!part || !placed) return refuse(s, S.noPart(op.part));
  const moved = { ...placed };
  let summary: string;
  let noNaming: string;
  if (op.kind === 'move-part') {
    if (!onGrid(op.to)) return refuse(s, S.offGrid);
    if (samePoint(op.to, placed.at)) return refuse(s, S.samePlace(part.name));
    moved.at = op.to;
    summary = S.moved(part.name);
    noNaming = S.noWay(part.name);
  } else if (op.kind === 'rotate-part') {
    if (!validRotation(op.rot)) return refuse(s, S.badTurn);
    moved.rot = op.rot ?? nextRotation(placed.rot);
    if (moved.rot === placed.rot) return refuse(s, S.sameTurn(part.name));
    summary = S.turned(part.name);
    noNaming = S.noTurn(part.name);
  } else {
    moved.mirror = !placed.mirror;
    summary = S.mirrored(part.name);
    noNaming = S.noTurn(part.name);
  }
  const geom = partGeometry(part, moved);
  const old = partGeometry(part, placed);
  // A half turn where it stands swaps its pins' places: its wires could only loop round it. Reverse
  // is what swaps its ends.
  const swapped = samePoint(geom.pins[0]!, old.pins[1]!) && samePoint(geom.pins[1]!, old.pins[0]!);
  if (op.kind === 'rotate-part' && swapped && old.pins.every((p) => wiredAt(s, p, part.key))) return refuse(s, S.noHalfTurn(part.name));
  // The wires that led only to the part's old pins go; what is left is checked for room. A part that
  // turns where it stands lets go of its wires back to the nearest junction, labels included, so the
  // new wires have room to reach its pins from their new sides (labels left off the copper are
  // written again where they fit).
  const next = cloneDrawing(s.drawing);
  next.parts.delete(part.key);
  if (!old.pins.every((p, i) => samePoint(p, geom.pins[i]!))) {
    next.wires = detachWires(s.circuit, next, old.pins, op.kind === 'move-part');
    if (op.kind !== 'move-part') {
      const cu = copper(s, next);
      next.labels = next.labels.filter((l) => cu.island(l.at) !== undefined);
    }
  }
  const problem = placeProblem(s, geom, part.nodes, { part: part.key }, next);
  if (problem) return refuse(s, problem);
  next.parts.set(part.key, moved);
  return finish(s, [], next, { summary, select: { part: part.key }, noNaming }, options);
}

/** True when something else than the part touches a point: a wire, another pin or a ground symbol. */
function wiredAt(s: Schematic, p: Point, key: string): boolean {
  if (drawnPins(s.circuit, s.drawing).some((q) => q.part !== key && samePoint(q.at, p))) return true;
  return s.drawing.wires.some((w) => segmentsOf(w).some(([a, b]) => pointOnSegment(p, a, b)));
}

/**
 * The wires of a drawing once a symbol's pins have left these points: wire ends that led only to
 * them are cut back to where something else touches the wire (a label too, when `labels`). A wire
 * passing through such a point stays whole.
 */
function detachWires(circuit: Circuit, drawing: Drawing, points: readonly Point[], labels = true): Point[][] {
  const gone = new Set(points.map(pointKey));
  const pins = drawnPins(circuit, drawing).map((p) => p.at).filter((p) => !gone.has(pointKey(p)));
  return normalizeWires(pruneDangling(toSegments(drawing.wires), pins, labels ? drawing.labels.map((l) => l.at) : []));
}

/** Swaps a part's two node names in the text and turns its symbol round, so its wires stay where they are. */
function reversePart(s: Schematic, name: string, options: EditOptions): EditResult {
  const part = s.circuit.parts.find((p) => p.key === lowerAscii(name));
  if (!part) return refuse(s, S.noPart(name));
  const el = s.netlist.lines[part.line]!.element!;
  const [a, b] = el.nodes;
  if (!a || !b) return refuse(s, S.noPart(name));
  const changes = [replaceToken(a.token, b.token.text), replaceToken(b.token, a.token.text)];
  const next = cloneDrawing(s.drawing);
  const placed = next.parts.get(part.key);
  if (placed) next.parts.set(part.key, { ...placed, rot: nextRotation(nextRotation(placed.rot)) });
  const summary = S.reversed(part.name);
  return finish(s, changes, next, { summary, select: { part: part.key }, after: (r) => `${summary} ${describePart(r, part.key)}` }, options);
}

function moveGround(s: Schematic, op: Extract<EditOp, { kind: 'move-ground' }>, options: EditOptions): EditResult {
  const g = s.drawing.grounds[op.ground];
  if (!g) return refuse(s, S.noGround);
  if (!onGrid(op.to)) return refuse(s, S.offGrid);
  if (samePoint(op.to, g.at)) return refuse(s, S.groundThere);
  const geom = symbolGeometry('ground', op.to, g.rot, false);
  const next = cloneDrawing(s.drawing);
  next.grounds.splice(op.ground, 1);
  next.wires = detachWires(s.circuit, next, [g.at]);
  const problem = placeProblem(s, geom, [GROUND], {}, next);
  if (problem) return refuse(s, problem);
  next.grounds.splice(op.ground, 0, { at: op.to, rot: g.rot });
  // A ground symbol moved off its node's wires must not leave a piece of ground without ground.
  const split = splitNodes(s, next);
  return finish(s, split.changes, next, { summary: [S.groundMoved, ...split.notes].join(' '), noNaming: S.noWay(S.ground) }, options);
}

function deletePart(s: Schematic, name: string, options: EditOptions): EditResult {
  const part = s.circuit.parts.find((p) => p.key === lowerAscii(name));
  if (!part) return refuse(s, S.noPart(name));
  const changes = removeLines(s.netlist, part.line);
  const next = cloneDrawing(s.drawing);
  const placed = next.parts.get(part.key);
  next.parts.delete(part.key);
  if (placed) next.wires = detachWires(s.circuit, next, partGeometry(part, placed).pins);
  // Nodes left with no pins at all: no drawn part and no line the drawing does not show.
  const gone = part.nodes.filter((n, i) => {
    const node = s.circuit.nodes.get(n);
    return n !== GROUND && part.nodes.indexOf(n) === i && node !== undefined && node.pins.every((p) => p.part === part.key) && node.hidden.length === 0;
  });
  const notes: string[] = [];
  if (gone.length) notes.push(S.unused(S.and(gone.map((n) => said(s.circuit, n)))));
  // Lines that still name the part, or a node it leaves behind.
  const own = new Set([part.line]);
  const mentions = partMentions(s, part);
  if (mentions.length) notes.push(stillNamed(mentions, part.name));
  const nodeLines: Mention[] = [];
  for (const n of gone) {
    const m = nodeMentions(s, n, own);
    if (m.length) notes.push(stillNamed(m, said(s.circuit, n)));
    nodeLines.push(...m);
  }
  const first = [...mentions, ...nodeLines].sort((a, b) => a.line - b.line)[0];
  const f: Finish = { summary: [S.deleted(part.name), ...notes].join(' ') };
  if (first) f.select = first.part ? { part: first.part } : { line: first.lineNumber };
  return finish(s, changes, next, f, options);
}

function deleteGround(s: Schematic, index: number, options: EditOptions): EditResult {
  if (!s.drawing.grounds[index]) return refuse(s, S.noGround);
  const next = cloneDrawing(s.drawing);
  next.grounds.splice(index, 1);
  const split = splitNodes(s, next);
  return finish(s, split.changes, next, { summary: [S.groundDeleted, ...split.notes].join(' ') }, options);
}

/** A wire end as a point (and the pin's outward direction). */
function endPoint(s: Schematic, end: WireEnd): RouteEnd | undefined {
  if ('at' in end) return onGrid(end.at) ? { at: end.at } : undefined;
  if ('ground' in end) {
    const g = s.drawing.grounds[end.ground];
    return g ? { at: g.at, outward: groundGeometry(g).outward[0]!, sideCost: ROUTE_COSTS.bareSide } : undefined;
  }
  const part = s.scene.parts.find((p) => p.key === lowerAscii(end.part));
  const pin = part?.pins[end.pin];
  return pin ? { at: pin.at, outward: pin.outward, sideCost: ROUTE_COSTS.bareSide } : undefined;
}

function addWire(s: Schematic, op: Extract<EditOp, { kind: 'add-wire' }>, options: EditOptions): EditResult {
  const a = endPoint(s, op.from);
  const b = endPoint(s, op.to);
  if (!a || !b) return refuse(s, S.wireEnds);
  const cu = copper(s);
  const ia = cu.island(a.at);
  const ib = cu.island(b.at);
  if (ia === undefined || ib === undefined) return refuse(s, S.wireEnds);
  const na = cu.nodeOf(ia);
  const nb = cu.nodeOf(ib);
  let path: Point[] | undefined;
  if (op.via) {
    if (!op.via.every(onGrid)) return refuse(s, S.offGrid);
    path = [a.at, ...op.via, b.at];
    if (!segmentsOf(path).every(([p, q]) => isOrthogonal(p, q))) return refuse(s, S.slanted);
  } else {
    const scene = s.scene;
    const foreign = cu.foreign(new Set([ia, ib]));
    path = findRoute(
      {
        walls: [...scene.parts.map((p) => p.box), ...scene.grounds.map((g) => g.box)],
        avoid: [...scene.parts.map((p) => p.labelBox), ...scene.nodeLabels.map((l) => l.box)],
        foreignWires: foreign.wires,
        foreignPins: foreign.pins,
        bounds: inflate(scene.bounds, 4),
      },
      [a],
      [b],
    );
    if (!path) return refuse(s, S.noRoute);
  }
  const next = cloneDrawing(s.drawing);
  if (path.length >= 2) next.wires.push(path);
  if (na === undefined || nb === undefined || na === nb) return finish(s, [], next, { summary: S.wired }, options);
  const keep = survivor(s.netlist, na, nb);
  const gone = keep === na ? nb : na;
  const keepText = keep === GROUND ? '0' : (s.circuit.nodes.get(keep)?.text ?? keep);
  const changes = renameRefs(s.netlist, gone, keepText);
  // The joined copper keeps one name: the kept node's label (ground: its symbol). Labels of the other
  // node elsewhere (pieces it joined by name) now name the kept node.
  const joined = new Set([ia, ib]);
  const keepNamed = keep === GROUND || next.labels.some((l) => l.node === keep && joined.has(cu.island(l.at) ?? -1));
  next.labels = next.labels.flatMap((l) => {
    if (l.node !== gone) return [l];
    if (keepNamed && joined.has(cu.island(l.at) ?? -1)) return [];
    if (keep === GROUND) return [];
    return [{ ...cloneLabel(l), node: keep }];
  });
  return finish(s, changes, next, { summary: `${S.wired} ${S.merged(said(s.circuit, gone), said(s.circuit, keep))}`, select: { node: keep } }, options);
}

function deleteWire(s: Schematic, op: Extract<EditOp, { kind: 'delete-wire' }>, options: EditOptions): EditResult {
  const wire = s.drawing.wires[op.wire];
  if (!wire) return refuse(s, S.noWire);
  const next = cloneDrawing(s.drawing);
  if (op.segment === undefined) next.wires.splice(op.wire, 1);
  else {
    const segs = segmentsOf(wire);
    if (!segs[op.segment]) return refuse(s, S.noWire);
    next.wires.splice(op.wire, 1, ...segs.filter((_, i) => i !== op.segment).map(([p, q]) => [p, q]));
  }
  const split = splitNodes(s, next);
  return finish(s, split.changes, next, { summary: [S.wireDeleted, ...split.notes].join(' ') }, options);
}

/**
 * Nodes the drawing now leaves in pieces (after a wire or a ground symbol went): the piece with the
 * node's label (ground: a ground symbol; else the first pin) keeps the name, the others get new names.
 */
function splitNodes(s: Schematic, drawing: Drawing): { changes: TextChange[]; notes: string[] } {
  const pins = drawnPins(s.circuit, drawing);
  const islands = findIslands(drawing.wires, pins.map((p) => p.at));
  const changes: TextChange[] = [];
  const notes: string[] = [];
  const taken = new Set<string>();
  for (const node of s.circuit.nodes.values()) {
    const named = new Set<number>();
    for (const l of drawing.labels) {
      if (l.node !== node.name) continue;
      const i = islands.at(l.at);
      if (i !== undefined) named.add(i);
    }
    if (node.ground) pins.forEach((p, i) => p.ground !== undefined && named.add(islands.anchors[i]!));
    const pieces = new Map<string, typeof pins>();
    pins.forEach((p, i) => {
      if (p.node !== node.name || p.part === undefined) return;
      const island = islands.anchors[i]!;
      const key = named.has(island) ? 'named' : `i${island}`;
      (pieces.get(key) ?? pieces.set(key, []).get(key)!).push(p);
    });
    // Ground stays ground only where a ground symbol is; another node splits only when in pieces.
    if (!node.ground && pieces.size <= 1) continue;
    const keepKey = pieces.has('named') ? 'named' : node.ground ? undefined : [...pieces.keys()][0];
    for (const [key, list] of pieces) {
      if (key === keepKey) continue;
      const fresh = freshNodeName(s, taken);
      for (const p of list) {
        const part = s.circuit.parts.find((q) => q.key === p.part)!;
        const token = s.netlist.lines[part.line]!.element!.nodes[p.pin]!.token;
        changes.push(replaceToken(token, fresh));
      }
      notes.push(S.split(said(s.circuit, node.name), fresh));
    }
  }
  return { changes, notes };
}

function renameNode(s: Schematic, nodeName: string, wanted: string, options: EditOptions): EditResult {
  const node = lowerAscii(nodeName) === 'gnd' ? GROUND : lowerAscii(nodeName);
  const info = s.circuit.nodes.get(node);
  if (!info) return refuse(s, S.noNode(nodeName));
  if (node === GROUND) return refuse(s, S.groundName);
  const name = wanted.trim();
  if (!NODE_NAME.test(name)) return refuse(s, S.badName(name));
  const target = lowerAscii(name) === 'gnd' ? GROUND : lowerAscii(name);
  const written = target === GROUND ? '0' : name;
  const changes = renameRefs(s.netlist, node, written);
  const next = cloneDrawing(s.drawing);
  next.labels = next.labels.map((l) => (l.node === node ? { ...cloneLabel(l), node: target } : l));
  if (target === node) return finish(s, changes, next, { summary: S.renamed(info.text, name), select: { node: target } }, options);
  const exists = s.circuit.nodes.has(target);
  if (exists || target === GROUND) {
    // Joined by name: every piece of both nodes carries the name (ground: a ground symbol).
    const pins = drawnPins(s.circuit, next);
    const islands = findIslands(next.wires, pins.map((p) => p.at));
    const labelled = new Set<number>();
    for (const l of next.labels) {
      if (l.node !== target) continue;
      const i = islands.at(l.at);
      if (i !== undefined) labelled.add(i);
    }
    pins.forEach((p, i) => {
      if (p.ground !== undefined) labelled.add(islands.anchors[i]!);
    });
    pins.forEach((p, i) => {
      if (p.node !== node && p.node !== target) return;
      const island = islands.anchors[i]!;
      if (labelled.has(island)) return;
      labelled.add(island);
      if (target === GROUND) next.grounds.push({ at: p.at, rot: groundRotFor(s, p.part, p.pin) });
      else next.labels.push({ node: target, at: p.at });
    });
    if (target === GROUND) next.labels = next.labels.filter((l) => l.node !== GROUND);
    const summary = target === GROUND ? `${S.renamed(info.text, name)} ${S.nowGround(info.text)}` : `${S.renamed(info.text, name)} ${S.joinedByName(name)}`;
    return finish(s, changes, next, { summary, select: { node: target } }, options);
  }
  return finish(s, changes, next, { summary: S.renamed(info.text, name), select: { node: target } }, options);
}

/** A ground symbol at a pin points away from the part (its bars outward). */
function groundRotFor(s: Schematic, part: string | undefined, pin: number): Rotation {
  const placed = s.scene.parts.find((p) => p.key === part);
  const out = placed?.pins[pin]?.outward ?? 'down';
  return out === 'down' ? 0 : out === 'left' ? 90 : out === 'up' ? 180 : 270;
}

function moveLabel(s: Schematic, op: Extract<EditOp, { kind: 'move-label' }>, options: EditOptions): EditResult {
  const node = lowerAscii(op.node) === 'gnd' ? GROUND : lowerAscii(op.node);
  const index = s.drawing.labels.findIndex((l) => l.node === node);
  if (index < 0) return refuse(s, S.noNode(op.node));
  const label = s.drawing.labels[index]!;
  const to = op.to ?? label.at;
  if (!onGrid(to)) return refuse(s, S.offGrid);
  if (op.side !== undefined && op.side !== 'auto' && !NODE_SPOTS.includes(op.side)) return refuse(s, S.badSide);
  const cu = copper(s);
  const island = cu.island(to);
  if (island === undefined || cu.nodeOf(island) !== node) return refuse(s, S.labelOff(said(s.circuit, node)));
  const next = cloneDrawing(s.drawing);
  const side = op.side === undefined ? label.side : op.side === 'auto' ? undefined : op.side;
  next.labels[index] = side ? { node, at: to, side } : { node, at: to };
  return finish(s, [], next, { summary: S.labelMoved(said(s.circuit, node)), select: { node } }, options);
}

function setSide(s: Schematic, op: Extract<EditOp, { kind: 'set-side' }>, options: EditOptions): EditResult {
  const part = s.circuit.parts.find((p) => p.key === lowerAscii(op.part));
  const placed = part ? s.drawing.parts.get(part.key) : undefined;
  if (!part || !placed) return refuse(s, S.noPart(op.part));
  if (op.side !== 'auto' && !LABEL_SIDES.includes(op.side)) return refuse(s, S.badSide);
  const next = cloneDrawing(s.drawing);
  next.parts.set(part.key, op.side === 'auto' ? { at: placed.at, rot: placed.rot, mirror: placed.mirror } : { at: placed.at, rot: placed.rot, mirror: placed.mirror, side: op.side });
  return finish(s, [], next, { summary: S.wordsMoved(part.name), select: { part: part.key } }, options);
}

function setValue(s: Schematic, name: string, value: string, options: EditOptions): EditResult {
  const part = s.circuit.parts.find((p) => p.key === lowerAscii(name));
  if (!part) return refuse(s, S.noPart(name));
  const v = value.trim();
  if (!v || /[\r\n]/.test(v)) return refuse(s, S.badValue);
  const el = s.netlist.lines[part.line]!.element!;
  let change: TextChange;
  if (el.value) change = replaceToken(el.value.token, v);
  else {
    const after = el.controlSource ?? el.nodes[el.nodes.length - 1]!.token;
    change = { from: after.to, to: after.to, insert: ` ${v}` };
  }
  return finish(s, [change], cloneDrawing(s.drawing), { summary: S.valueSet(part.name, v), select: { part: part.key } }, options);
}

function setControl(s: Schematic, op: Extract<EditOp, { kind: 'set-control' }>, options: EditOptions): EditResult {
  const part = s.circuit.parts.find((p) => p.key === lowerAscii(op.part));
  if (!part) return refuse(s, S.noPart(op.part));
  const el = s.netlist.lines[part.line]!.element!;
  const changes: TextChange[] = [];
  if (part.letter === 'E' || part.letter === 'G') {
    for (const [i, wanted] of [
      [2, op.plus],
      [3, op.minus],
    ] as const) {
      if (wanted === undefined) continue;
      const n = wanted.trim();
      if (!NODE_NAME.test(n)) return refuse(s, S.badName(n));
      const token = el.nodes[i]?.token;
      if (token) changes.push(replaceToken(token, n));
      else {
        const last = el.nodes[el.nodes.length - 1]!.token;
        changes.push({ from: last.to, to: last.to, insert: ` ${n}` });
      }
    }
  } else if (part.letter === 'F' || part.letter === 'H') {
    if (op.source !== undefined) {
      const n = op.source.trim();
      if (!PART_NAME.test(n)) return refuse(s, S.badSource(n));
      if (el.controlSource) changes.push(replaceToken(el.controlSource, n));
      else {
        const last = el.nodes[el.nodes.length - 1]!.token;
        changes.push({ from: last.to, to: last.to, insert: ` ${n}` });
      }
    }
  } else return refuse(s, S.notControlled(part.name));
  const text = applyChanges(s.netlist.text, mergeChanges(s.netlist.text, changes));
  const after = circuitFromNetlist(parseNetlist(text)).parts.find((p) => p.key === part.key);
  const control = after?.control?.kind === 'current' ? `I(${after.control.sourceText})` : after?.control ? `V(${after.control.plusText}, ${after.control.minusText})` : '';
  return finish(s, changes, cloneDrawing(s.drawing), { summary: S.controlSet(part.name, control), select: { part: part.key } }, options);
}
