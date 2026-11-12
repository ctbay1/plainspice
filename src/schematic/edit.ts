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
 *   node named in a dot command or a .control line (.tf v(out) ...), then a name the student chose
 *   over one PlainSpice gave (n1, n2 ...), then, of two of PlainSpice's names, the lower number, then
 *   the node that comes first in the netlist; every mention of the other name changes, in .control lines too;
 * - removing a wire or a ground symbol can leave a node in two pieces: the piece with the node's
 *   label (or ground symbol, or else its first pin) keeps the name, the other piece's pins get a new
 *   name;
 * - deleting a part deletes its lines; a node left with no pins is gone from the netlist. Lines that
 *   still name the part or such a node (an F reading its current, a .tf line, a .control line ...)
 *   are left as the student wrote them, and the summary says which, by their numbers in the text
 *   after the delete, so they can be changed;
 * - renaming a node to a name that exists joins them by name (the label is written on each piece);
 * - reversing a part swaps its two node names in the text and turns its symbol round, so the wires
 *   stay where they are (a source's + and − sides swap);
 * - disconnecting one end of a part gives that end a new node name in the text (n1, n2 ...) and lets
 *   go of the wires and the ground symbol that held only it, so the end stands alone; the rest of its
 *   old node keeps its name and its wires (a part whose end touched another part's pin directly is
 *   placed again beside its nodes).
 * Moving, turning and mirroring never change the netlist; a move that would put a pin on another
 * node's copper, or a symbol on another symbol, or leave wires that find no way (so pieces would be
 * joined only by name), is refused with the reason. While the netlist holds another version's
 * drawing lines, only edits that change part lines are done: changing the drawing would leave that
 * version's lines behind, out of step.
 */
import { elementInfo } from '../spice/elements.ts';
import { lowerAscii, parseNetlist } from '../spice/parse.ts';
import type { Netlist, TextChange, Token } from '../spice/types.ts';
import { GROUND, circuitFromNetlist, labelNode, type Circuit, type CircuitPart } from './circuit.ts';
import { checkConnectivity, drawnPins, findIslands } from './connectivity.ts';
import { cloneDrawing, cloneLabel, groundGeometry, partGeometry, symbolGeometry, type Drawing, type LabelSide, type NodeSpot } from './drawing.ts';
import { LABEL_SIDES, NODE_SPOTS } from './drawing.ts';
import {
  COORD_LIMIT,
  NEW_TITLE,
  applyChanges,
  drawingBlockChanges,
  newlineOf,
  parseDrawingLines,
  readDrawing,
  serializeDrawing,
  type DrawingLines,
  type DrawingProblem,
  type LabelLine,
  type PositionLine,
} from './format.ts';
import { ROTATIONS, boxContains, boxesOverlap, inflate, isOrthogonal, nextRotation, pointKey, pointOnSegment, samePoint, segmentCrossesBox, segmentsOf, unionBoxes, type Box, type Point, type Rotation } from './geometry.ts';
import type { LayoutOptions } from './layout.ts';
import { describePart } from './navigate.ts';
import { ROUTE_COSTS, findRoute, type RouteEnd } from './route.ts';
import { buildScene, findOverlaps } from './scene.ts';
import { buildSchematic, type Schematic } from './schematic.ts';
import { PART_LETTERS, type PartLetter } from './symbols.ts';
import { normalizeWires, pruneDangling, toSegments } from './wires.ts';

/** One end of a new wire: a part's pin, a ground symbol's pin, or a point on a wire. */
export type WireEnd = { part: string; pin: 0 | 1 } | { ground: number } | { at: Point };

export type EditOp =
  | { kind: 'add-part'; letter: PartLetter; at: Point; rot?: Rotation; mirror?: boolean }
  | { kind: 'add-ground'; at: Point; rot?: Rotation }
  | { kind: 'move-part'; part: string; to: Point; rot?: Rotation; mirror?: boolean }
  | { kind: 'move-ground'; ground: number; to: Point }
  | { kind: 'rotate-part'; part: string; rot?: Rotation }
  | { kind: 'mirror-part'; part: string }
  | { kind: 'reverse-part'; part: string }
  | { kind: 'delete-part'; part: string }
  | { kind: 'delete-ground'; ground: number }
  | { kind: 'add-wire'; from: WireEnd; to: WireEnd; via?: Point[] }
  | { kind: 'delete-wire'; wire: number; segment?: number; piece?: { from: Point; to: Point } }
  | { kind: 'rename-node'; node: string; name: string }
  | { kind: 'move-label'; node: string; to?: Point; side?: NodeSpot | 'auto' }
  | { kind: 'set-side'; part: string; side: LabelSide | 'auto' }
  | { kind: 'set-value'; part: string; value: string }
  | { kind: 'set-control'; part: string; plus?: string; minus?: string; source?: string }
  | { kind: 'disconnect-pin'; part: string; pin: 0 | 1 };

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

/** The first letter in capitals: a sentence that starts with a node said as "node out". */
const cap = (words: string): string => words.charAt(0).toUpperCase() + words.slice(1);
/** "R1", "R1 and R2", "R1, R2 and R3". */
const listOf = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
/** Parts whose ends left a node: "R2 no longer connects to ground: that end is now on a node of its own, n1". */
const leftNode = (parts: readonly string[], ends: number, node: string, piece: string): string =>
  `${listOf(parts)} no longer ${parts.length > 1 ? 'connect' : 'connects'} to ${node}: ${ends > 1 ? 'those ends are' : 'that end is'} now on a node of ${ends > 1 ? 'their' : 'its'} own, ${piece}`;

/**
 * Every sentence the editor says, in one object so a Turkish UI can replace it later. A node is said
 * with the word "node" before its name ("R3 added between node in and node n1."), since a name may be
 * an ordinary word (in, out, s); ground is "ground". A bare name only follows "one node," or "called".
 */
export const EDIT_STRINGS = {
  ground: 'ground',
  theGround: 'the ground symbol',
  /** A node in a sentence (not ground): "node out". */
  node: (name: string): string => `node ${name}`,
  added: (name: string, a: string, b: string): string => `${name} added between ${a} and ${b}.`,
  groundAdded: 'Ground symbol added.',
  nowGround: (node: string): string => `${cap(node)} is now ground (node 0).`,
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
  /** `gone` and `kept` as said ("node n1", "ground"), `name` as the kept node is called ("out", "ground"). */
  merged: (gone: string, kept: string, name: string): string => `${cap(gone)} and ${kept} are now one node, ${name}.`,
  wireDeleted: 'Wire deleted.',
  pieceDeleted: 'Piece of wire deleted.',
  /** A piece of a node cut off (a wire or a ground symbol gone): the parts whose ends were on it, how many ends, the node as said, the piece's new name. */
  split: (parts: readonly string[], ends: number, node: string, piece: string): string => `${leftNode(parts, ends, node, piece)}.`,
  /** The last ground symbol on ground's copper gone: what was on ground is a new node, and nothing is on node 0 any more (no-ground-1). */
  groundCut: (parts: readonly string[], ends: number, piece: string): string =>
    `No ground symbol is left on ground's wires, so ${leftNode(parts, ends, 'ground', piece)}, and the circuit has no ground (node 0) until a ground symbol goes back on it.`,
  /** The same when a ground symbol is still drawn, cut off from every part (no-ground-1). */
  groundCutOff: (parts: readonly string[], ends: number, piece: string): string =>
    `No part connects to a ground symbol any more, so ${leftNode(parts, ends, 'ground', piece)}, and the circuit has no ground (node 0) until a part connects to a ground symbol again.`,
  renamed: (old: string, name: string): string => `Node ${old} renamed to ${name}.`,
  joinedByName: (name: string): string => `A node called ${name} was already there, so the two are now one node, ${name}.`,
  /** W6: a name typed with other capital letters than an existing node's is that node; `name` as the node is written. */
  joinedByCase: (typed: string, name: string): string => `SPICE ignores capital letters in node names, so ${typed} is node ${name}, which was already there: the two are now one node, ${name}.`,
  labelMoved: (node: string): string => `The name of node ${node} moved.`,
  wordsMoved: (name: string): string => `${name}'s words moved.`,
  valueSet: (name: string, value: string): string => `${name} is now ${value}.`,
  controlSet: (name: string, control: string): string => `${name} now reads ${control}.`,
  /** What a controlled source reads, in the words of its card's Connections (facts P6, P7, P8). */
  readsVoltage: (plus: string, minus: string): string => `the voltage between ${plus} and ${minus}`,
  readsCurrent: (source: string): string => `the current through ${source}`,
  disconnected: (name: string, node: string, fresh: string): string => `${name} no longer connects to ${node}: that end is now on a node of its own, ${fresh}.`,
  orphansDropped: (names: string): string => `The drawing lines of ${names}, which the netlist no longer has, were removed.`,
  failedDropped: 'The drawing lines PlainSpice could not use were replaced.',
  and: listOf,
  // Why an edit cannot be done.
  noPart: (name: string): string => `There is no part ${name} in the drawing.`,
  noGround: 'There is no such ground symbol.',
  noWire: 'There is no such wire.',
  noNode: (name: string): string => `There is no node ${name} in the drawing.`,
  taken: (what: string): string => `That place is taken by ${what}.`,
  onWire: "A wire runs there, and nothing can lie across a wire. To put a part in its place, select that piece of wire and delete it, then wire the part's ends.",
  /** The same for a ground symbol, placed or moved: it connects by its pin, so only its pin may meet a wire. */
  onWireGround: 'A wire runs there, and nothing can lie across a wire. A ground symbol may touch a wire only with its pin: move it until just its pin is on the wire, or until it misses the wire.',
  /** `node` as it is called ("out", "ground"): a pin there would join a node it is not on. */
  foreign: (node: string): string => `A pin would touch another node, ${node}.`,
  wireEnds: 'A wire needs a pin or a wire at each end.',
  noRoute: 'There is no way for a wire between those two points.',
  noWay: (name: string): string => `${cap(name)}'s wires would find no way there. Try a place with more room.`,
  noTurn: (name: string): string => `${name} can't turn there: its wires would find no way. Move it to a place with more room first, or use Reverse to swap its ends.`,
  // Said while the part is in hand ("can't go here"), when it goes back, and for a half turn of a
  // placed part: so it never asks to put the part down where it cannot go (words:W7).
  noHalfTurn: (name: string): string => `A half turn of ${name} where it stands would loop its wires round it. To swap its two ends, use Reverse once ${name} is back in place.`,
  slanted: 'A wire runs only across and up or down.',
  offGrid: `That place is off the grid: x and y must be whole numbers from −${COORD_LIMIT} to ${COORD_LIMIT}.`,
  badTurn: 'A part turns in quarter turns: 0, 90, 180 or 270.',
  sameTurn: (name: string): string => `${name} is already turned that way.`,
  samePlace: (name: string): string => `${name} is already there.`,
  groundThere: 'The ground symbol is already there.',
  badName: (name: string): string => (name ? `PlainSpice keeps node names to letters, digits and _ (32 at most), so it can't use "${name}".` : 'A node needs a name.'),
  badSource: (name: string): string => `PlainSpice keeps part names to a letter followed by letters, digits and _, so it can't use "${name}".`,
  // W8: 0 (and gnd) is what makes a node ground; every voltage is measured from it (the Help's results).
  groundName: 'Ground (node 0) keeps its name: in SPICE, the name 0 is what makes a node ground, the node every voltage is measured from.',
  badValue: 'A value must be one line of text.',
  badSide: 'Words go right, left, above or below a part; a node name goes at one of its spots.',
  notControlled: (name: string): string => `${name} is not a dependent source.`,
  // P7, P8: F and H read the current through a voltage source; P10b: an E or H works too (both are voltage sources).
  noSource: (letter: string): string => `A ${elementInfo(letter)?.name ?? letter} (${letter}) reads the current through a voltage source, and this circuit has none yet: add a voltage source first.`,
  notDrawable: (letter: string): string => `The drawing has no symbol for ${letter}: it draws R, C, L, V, I, E, F, G and H.`,
  labelOff: (node: string): string => `The name of node ${node} goes only on its own wires and pins: move it along them.`,
  /** `node` and `other` as said ("node out", "ground"). */
  labelCrossing: (node: string, other: string): string => `Here a wire of ${other} crosses a wire of ${node}: the name could be read as either node's.`,
  noPin: 'A part has two ends: 0 and 1.',
  alone: (name: string, node: string): string => `That end of ${name} is already on a node of its own, ${node}.`,
  otherVersion: (header: string): string =>
    `This drawing was saved by another version of PlainSpice (${header}), so this one can't change it; reloading the page gets the newest PlainSpice. Values and node names can still be changed, and parts reversed or deleted; the Netlist panel changes anything.`,
  failed: 'PlainSpice could not make that change.',
  outOfStep: 'PlainSpice could not draw that change with wires that connect exactly what the netlist connects, so it left the circuit as it was. You can make it in the Netlist panel.',
  // W9: gnd as the last word of a line is an ordinary node; W8: anywhere else it is ground (0).
  // `word`: the node as the Checks panel's fix names it ("Rename gnd to 0", traps.ts).
  gndNode: (name: string, word = 'gnd'): string =>
    `${name}'s line ends with the word gnd, and as the last word of a line gnd is an ordinary node to ngspice, not ground. Reversed, gnd would no longer be last and would become ground, which changes the circuit. Rename ${word} first: the Checks panel says why and offers “Rename ${word} to 0”.`,
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

/** A node's name as written, "ground" for node 0 (after "one node," or "another node,"). */
function said(circuit: Circuit, node: string): string {
  return node === GROUND ? S.ground : (circuit.nodes.get(node)?.text ?? node);
}

/** How a node is said in a sentence: "node out", "ground" for node 0. */
function nodeIn(circuit: Circuit, node: string): string {
  return node === GROUND ? S.ground : S.node(circuit.nodes.get(node)?.text ?? node);
}

/** What a controlled source reads, in words: "the voltage between node in and ground", "the current through V1" (undefined for other parts). */
export function readsWords(part: CircuitPart): string | undefined {
  const c = part.control;
  if (!c) return undefined;
  if (c.kind === 'current') return S.readsCurrent(c.sourceText || '?');
  const end = (node: string, text: string): string => (node === GROUND ? S.ground : S.node(text || '?'));
  return S.readsVoltage(end(c.plus, c.plusText), end(c.minus, c.minusText));
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

/** A node name nothing uses yet (n1, n2 ...), counting the lines the drawing does not show and the names already handed out in `taken` (which gets the new one). */
export function freshNodeName(s: Schematic, taken: Set<string> = new Set()): string {
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
  // A node called gnd that is not ground (gnd at the end of a line, W9) cannot be written elsewhere
  // without becoming ground: the other name stays.
  const gndOnly = (n: string): boolean => n === 'gnd';
  if (gndOnly(a) !== gndOnly(b)) return gndOnly(a) ? b : a;
  const commands = new Set(netlist.lines.filter((l) => l.kind === 'directive' || l.kind === 'control').map((l) => l.index));
  const inCommand = (n: string): boolean => refsOf(netlist, n).some((t) => commands.has(lineOfOffset(netlist, t.from)));
  const da = inCommand(a);
  const db = inCommand(b);
  if (da !== db) return da ? a : b;
  // A name the student chose (out, vin) over one PlainSpice gave (n1, n2 ...); of two given names,
  // the lower number, so a circuit built on the drawing keeps n1, n2 ... with few gaps.
  const given = (n: string): number | undefined => {
    const m = /^n(\d+)$/.exec(n);
    return m ? Number(m[1]) : undefined;
  };
  const ga = given(a);
  const gb = given(b);
  if ((ga === undefined) !== (gb === undefined)) return ga === undefined ? a : b;
  if (ga !== undefined && gb !== undefined && ga !== gb) return ga < gb ? a : b;
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

/** "F1 (line 6) and .tf (line 9) still name Vsense.", each line numbered as `number` says. */
function stillNamed(mentions: readonly Mention[], name: string, number: (m: Mention) => number = (m) => m.lineNumber): string {
  return S.stillNamed(S.and(mentions.map((m) => S.onLine(m.what, number(m)))), mentions.length > 1, name);
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
export function insertLine(netlist: Netlist, line: string): TextChange {
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
  /** A side this edit set on purpose (the student chose it): kept even where it overlaps. */
  chosen?: { part?: string; node?: string };
}

/**
 * A side the drawing stores for a part's words, or a spot for a node's name (side=: the video's, or the
 * student's), stays while it is free. Where an edit put a wire, a part or other words on it, it goes
 * back to automatic when that is freer, so the lines then store what the page shows (the scene always
 * keeps a stored side). Only what the edit made overlap is let go, a few at most.
 */
function relaxStored(before: Schematic, after: Schematic, rebuild: (d: Drawing) => Schematic, chosen: Finish['chosen'] = {}): Schematic {
  const id = (o: ReturnType<typeof findOverlaps>[number]): string => `${o.a.kind} ${o.a.id}|${o.b.kind} ${o.b.id}`;
  const old = new Set(findOverlaps(before.scene).map(id));
  let cur = after;
  let count = findOverlaps(cur.scene).length;
  for (let round = 0; round < 4; round++) {
    const fresh = findOverlaps(cur.scene).filter((o) => !old.has(id(o)));
    let better: Schematic | undefined;
    for (const o of fresh) {
      for (const it of [o.a, o.b]) {
        const d = cloneDrawing(cur.drawing);
        if (it.kind === 'part-label') {
          const p = d.parts.get(it.id);
          if (!p?.side || it.id === chosen.part) continue;
          d.parts.set(it.id, { at: p.at, rot: p.rot, mirror: p.mirror });
        } else if (it.kind === 'node-label') {
          const i = Number(it.id.slice(it.id.lastIndexOf('#') + 1));
          const l = d.labels[i];
          if (!l?.side || l.node === chosen.node) continue;
          d.labels[i] = { node: l.node, at: l.at };
        } else continue;
        const tried = rebuild(d);
        const n = findOverlaps(tried.scene).length;
        if (n < count) {
          better = tried;
          count = n;
          break;
        }
      }
      if (better) break;
    }
    if (!better) return cur;
    cur = better;
  }
  return cur;
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
  const rebuilt = relaxStored(s, buildSchematic(netlist2, { ...layout, lines: linesOf(circuit2, next) }), (d) => buildSchematic(netlist2, { ...layout, lines: linesOf(circuit2, d) }), f.chosen);
  if (f.noNaming && rebuilt.problems.some((p) => p.kind === 'connected-by-name')) return refuse(s, f.noNaming);
  // What the lines say is what the page shows: the drawing is read back from the lines written, and
  // when that reading repairs it again (a wire's dead end where a wire doubled back on itself, which
  // the rebuild prunes), the repaired drawing is written instead, so the text never holds wire the
  // drawing does not show.
  let drawing = rebuilt.drawing;
  let lines = serializeDrawing(rebuilt.circuit, drawing, s.kept);
  let shown = buildSchematic(netlist2, { ...layout, lines: parseDrawingLines(lines.map((l, i) => ({ text: l, line: i + 1 }))) });
  for (let round = 0; round < 3; round++) {
    const again = serializeDrawing(shown.circuit, shown.drawing, s.kept);
    if (again.join('\n') === lines.join('\n')) {
      drawing = shown.drawing;
      break;
    }
    drawing = shown.drawing;
    lines = again;
    shown = buildSchematic(netlist2, { ...layout, lines: parseDrawingLines(lines.map((l, i) => ({ text: l, line: i + 1 }))) });
  }
  // Never a drawing that connects other than the netlist: an edit the rebuild could not draw in step
  // with the netlist (pieces of a node left apart) is not made.
  const wrong = (c: Circuit, d: Drawing): string[] => checkConnectivity(c, d).filter((p) => p.kind !== 'hidden').map((p) => p.message);
  const wrongBefore = new Set(wrong(s.circuit, s.drawing));
  if (wrong(shown.circuit, shown.drawing).some((m) => !wrongBefore.has(m))) return refuse(s, S.outOfStep);
  // A drawing left with nothing on it (its last part deleted) takes its lines away, header and all.
  const empty = drawing.parts.size === 0 && drawing.grounds.length === 0 && drawing.wires.length === 0 && drawing.labels.length === 0 && s.kept.length === 0;
  if (empty && readDrawing(s.netlist).lineIndexes.length) lines = [];
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
  const result: EditResult = { ok: true, changes, text: applyChanges(text, changes), drawing, lines, summary: f.after?.(rebuilt) ?? f.summary, notes };
  if (f.select) result.select = f.select;
  return result;
}

interface Copper {
  /** The island at a point, if any. */
  island(p: Point): number | undefined;
  /** Every island at a point (two where two nodes' wires cross there without joining). */
  islandsAt(p: Point): number[];
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
    islandsAt: (p) => islands.allAt(p),
    nodeOf: (i) => node.get(i),
    foreign(except) {
      return {
        wires: drawing.wires.filter((_, i) => !except.has(islands.wires[i]!)),
        // Other nodes' pins, and the points their names are written at: a new wire through a name's
        // point would leave the name on a crossing of two nodes' wires.
        pins: [
          ...pins.filter((_, i) => !except.has(islands.anchors[i]!)).map((p) => p.at),
          ...drawing.labels.filter((l) => {
            const i = islands.at(l.at);
            return i === undefined || !except.has(i);
          }).map((l) => l.at),
        ],
      };
    },
  };
}

/** How far a lead's box starts from its pin, and half its thickness: leads meet only at their pins. */
const PIN_ROOM = 0.15;
const LEAD_HALF = 0.05;
/** Room kept between a body and a lead that are not its own. */
const BODY_ROOM = 0.15;

/** A symbol as what it draws: its body, and a thin box along each lead from just off its pin to the body. */
function shapeOf(pins: readonly Point[], body: Box): { body: Box; leads: Box[] } {
  const leads: Box[] = [];
  for (const p of pins) {
    const q = { x: Math.min(body.x1, Math.max(body.x0, p.x)), y: Math.min(body.y1, Math.max(body.y0, p.y)) };
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const length = Math.hypot(dx, dy);
    if (length <= PIN_ROOM) continue;
    const from = { x: p.x + (dx / length) * PIN_ROOM, y: p.y + (dy / length) * PIN_ROOM };
    leads.push({ x0: Math.min(from.x, q.x) - LEAD_HALF, y0: Math.min(from.y, q.y) - LEAD_HALF, x1: Math.max(from.x, q.x) + LEAD_HALF, y1: Math.max(from.y, q.y) + LEAD_HALF });
  }
  return { body, leads };
}

/**
 * A symbol at a place: refused when it lands on another symbol, a wire, or (for its pins) another
 * node. Symbols are what they draw, a body and its leads: bodies keep apart from bodies and leads, a
 * lead may not run along or across another, and pins meet only pins, so two parts may meet end to
 * end at a shared pin, in line or at a right angle, as on paper.
 */
function placeProblem(s: Schematic, geom: ReturnType<typeof symbolGeometry>, pinNodes: readonly (string | undefined)[], ignore: { part?: string; ground?: number }, drawing: Drawing = s.drawing): string | undefined {
  const scene = buildScene(s.circuit, drawing, s.options);
  const mine = shapeOf(geom.pins, geom.body);
  const on = (p: Point, shape: { body: Box; leads: Box[] }): boolean => boxContains(shape.body, p) || shape.leads.some((l) => boxContains(l, p));
  const clash = (pins: readonly Point[], body: Box): boolean => {
    const theirs = shapeOf(pins, body);
    if (boxesOverlap(mine.body, body, BODY_ROOM) || theirs.leads.some((l) => boxesOverlap(mine.body, l, BODY_ROOM))) return true;
    if (mine.leads.some((l) => boxesOverlap(l, body, BODY_ROOM) || theirs.leads.some((m) => boxesOverlap(l, m)))) return true;
    return geom.pins.some((p) => on(p, theirs)) || pins.some((p) => on(p, mine));
  };
  // Wires: none through the body, along or across a lead; one may end at a pin.
  const ownPins = new Set(geom.pins.map(pointKey));
  for (const w of drawing.wires) {
    for (const [a, b] of segmentsOf(w)) {
      if (ownPins.has(pointKey(a)) && ownPins.has(pointKey(b))) continue;
      if (segmentCrossesBox(a, b, inflate(geom.body, 0.05)) || mine.leads.some((l) => segmentCrossesBox(a, b, l))) return geom.kind === 'ground' ? S.onWireGround : S.onWire;
    }
  }
  for (const p of scene.parts) {
    if (p.key === ignore.part) continue;
    if (clash(p.pins.map((q) => q.at), p.body)) return S.taken(p.name);
  }
  for (const g of scene.grounds) {
    if (g.index === ignore.ground) continue;
    if (clash(groundGeometry(drawing.grounds[g.index]!).pins, g.body)) return S.taken(S.theGround);
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
const TEXT_ONLY = new Set<EditOp['kind']>(['set-value', 'set-control', 'rename-node', 'reverse-part', 'delete-part', 'disconnect-pin']);

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
    case 'disconnect-pin':
      return disconnectPin(s, op, options);
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
  const summary = S.added(name, nodes[0] === GROUND ? S.ground : S.node(text(nodes[0])), nodes[1] === GROUND ? S.ground : S.node(text(nodes[1])));
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
  return finish(s, changes, next, { summary: `${S.groundAdded} ${S.nowGround(nodeIn(s.circuit, node))}`, select: { node: GROUND } }, options);
}

function movePart(s: Schematic, op: Extract<EditOp, { kind: 'move-part' | 'rotate-part' | 'mirror-part' }>, options: EditOptions): EditResult {
  const part = s.circuit.parts.find((p) => p.key === lowerAscii(op.part));
  const placed = part ? s.drawing.parts.get(part.key) : undefined;
  if (!part || !placed) return refuse(s, S.noPart(op.part));
  const moved = { ...placed };
  let summary: string;
  let noNaming: string;
  if (op.kind === 'move-part') {
    // Moved, and turned or mirrored on the way (a part turned while it is dragged).
    if (!onGrid(op.to)) return refuse(s, S.offGrid);
    if (!validRotation(op.rot)) return refuse(s, S.badTurn);
    const turned = (op.rot !== undefined && op.rot !== placed.rot) || (op.mirror !== undefined && op.mirror !== placed.mirror);
    if (samePoint(op.to, placed.at) && !turned) return refuse(s, S.samePlace(part.name));
    moved.at = op.to;
    if (op.rot !== undefined) moved.rot = op.rot;
    if (op.mirror !== undefined) moved.mirror = op.mirror;
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
  // Turned, its words' stored side (side=, above or left of the part as it lay) no longer means the
  // same place: the scene chooses again for the part as it lies now.
  if (moved.rot !== placed.rot && moved.side !== undefined) delete moved.side;
  const geom = partGeometry(part, moved);
  const old = partGeometry(part, placed);
  // A half turn where it stands swaps its pins' places: its wires could only loop round it. Reverse
  // is what swaps its ends.
  const swapped = samePoint(geom.pins[0]!, old.pins[1]!) && samePoint(geom.pins[1]!, old.pins[0]!);
  if (op.kind !== 'mirror-part' && swapped && old.pins.every((p) => wiredAt(s, p, part.key))) return refuse(s, S.noHalfTurn(part.name));
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
  // The meanings swap, not the words: ground is written 0, since "gnd" at the end of a line is an
  // ordinary node to ngspice (W9). A node called gnd that is not ground cannot move away from the
  // end of the line without becoming ground.
  const gnd = [a, b].find((n) => !n.ground && lowerAscii(n.token.text) === 'gnd');
  if (gnd) return refuse(s, S.gndNode(part.name, s.netlist.nodes.get(gnd.name)?.refs[0]?.text ?? gnd.token.text));
  const written = (n: typeof a): string => (n.ground ? '0' : n.token.text);
  const changes = [replaceToken(a.token, written(b)), replaceToken(b.token, written(a))];
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
  // A move never changes the netlist: the rebuild wires the symbol to ground's copper, as it re-routes
  // a moved part's wires, and a place no wire reaches is refused (pieces of ground joined only by a
  // second symbol would be a change the student did not ask for).
  return finish(s, [], next, { summary: S.groundMoved, select: { node: GROUND }, noNaming: S.noWay(S.theGround) }, options);
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
  // Lines that still name the part, or a node it leaves behind.
  const own = new Set([part.line]);
  const mentions = partMentions(s, part);
  const nodeLines = gone.map((n) => ({ node: n, lines: nodeMentions(s, n, own) }));
  const first = [...mentions, ...nodeLines.flatMap((x) => x.lines)].sort((a, b) => a.line - b.line)[0];
  /** The summary, each line numbered as `number` says. */
  const say = (number: (m: Mention) => number): string => {
    const notes: string[] = [];
    if (gone.length) notes.push(S.unused(S.and(gone.map((n) => nodeIn(s.circuit, n)))));
    if (mentions.length) notes.push(stillNamed(mentions, part.name, number));
    for (const x of nodeLines) if (x.lines.length) notes.push(stillNamed(x.lines, nodeIn(s.circuit, x.node), number));
    return [S.deleted(part.name), ...notes].join(' ');
  };
  const r = finish(s, changes, next, { summary: say((m) => m.lineNumber) }, options);
  if (!r.ok) return r;
  // The part's own lines are gone (and drawing lines may have been written): each line that still
  // names it is said, and offered, by its number in the text as it is now.
  const now = (m: Mention): number => lineAfter(r.changes, r.text, s.netlist.lines[m.line]!.span.from);
  r.summary = say(now);
  if (first) r.select = first.part ? { part: first.part } : { line: now(first) };
  return r;
}

/** The 1-based number, in `text` (the text after `changes`), of the line that started at `offset` before them (a line the changes left in place). */
function lineAfter(changes: readonly TextChange[], text: string, offset: number): number {
  let at = offset;
  for (const c of changes) if (c.to <= offset) at += c.insert.length - (c.to - c.from);
  let line = 1;
  for (let i = 0; i < at && i < text.length; i++) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function deleteGround(s: Schematic, index: number, options: EditOptions): EditResult {
  if (!s.drawing.grounds[index]) return refuse(s, S.noGround);
  const next = cloneDrawing(s.drawing);
  next.grounds.splice(index, 1);
  const split = splitNodes(s, next);
  return finish(s, split.changes, next, { summary: [S.groundDeleted, ...split.notes].join(' ') }, options);
}

/**
 * The words a new wire keeps clear of: every part's words and node's name, except those of the nodes
 * it joins (their names, and the words of the parts on them), which the scene places again around
 * the new wire; a detour round them is what made hand-drawn wires snake.
 */
function wordsToAvoid(s: Schematic, nodes: readonly (string | undefined)[]): Box[] {
  const own = new Set(nodes.filter((n): n is string => n !== undefined));
  return [...s.scene.parts.filter((p) => !p.pins.some((q) => own.has(q.node))).map((p) => p.labelBox), ...s.scene.nodeLabels.filter((l) => !own.has(l.node)).map((l) => l.box)];
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

/**
 * Two pins on one line, both facing across it (two parts standing on a rail): the straight wire between
 * them is the rail, so meeting them from the side costs a bend, not a detour (else every such wire is a U).
 */
function railEnds(a: RouteEnd, b: RouteEnd): void {
  const across = (e: RouteEnd, horizontal: boolean): boolean => e.outward !== undefined && (horizontal ? e.outward === 'up' || e.outward === 'down' : e.outward === 'left' || e.outward === 'right');
  const horizontal = a.at.y === b.at.y && across(a, true) && across(b, true);
  const vertical = a.at.x === b.at.x && across(a, false) && across(b, false);
  if (!horizontal && !vertical) return;
  a.sideCost = Math.min(a.sideCost ?? ROUTE_COSTS.pinSide, ROUTE_COSTS.pinSide);
  b.sideCost = Math.min(b.sideCost ?? ROUTE_COSTS.pinSide, ROUTE_COSTS.pinSide);
}

function addWire(s: Schematic, op: Extract<EditOp, { kind: 'add-wire' }>, options: EditOptions): EditResult {
  const a = endPoint(s, op.from);
  const b = endPoint(s, op.to);
  if (!a || !b) return refuse(s, S.wireEnds);
  if (!op.via?.length) railEnds(a, b);
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
        avoid: wordsToAvoid(s, [na, nb]),
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
  return finish(s, changes, next, { summary: `${S.wired} ${S.merged(nodeIn(s.circuit, gone), nodeIn(s.circuit, keep), said(s.circuit, keep))}`, select: { node: keep } }, options);
}

/**
 * Deletes a whole wire, one segment of it (between two of its corners), or a piece of a segment (the
 * stretch between two points on it, such as the junctions either side of the place clicked).
 */
function deleteWire(s: Schematic, op: Extract<EditOp, { kind: 'delete-wire' }>, options: EditOptions): EditResult {
  const wire = s.drawing.wires[op.wire];
  if (!wire) return refuse(s, S.noWire);
  const next = cloneDrawing(s.drawing);
  if (op.segment === undefined) next.wires.splice(op.wire, 1);
  else {
    const segs = segmentsOf(wire);
    const seg = segs[op.segment];
    if (!seg) return refuse(s, S.noWire);
    const [a, b] = seg;
    const rest: Point[][] = [];
    if (op.piece) {
      const { from, to } = op.piece;
      if (!onGrid(from) || !onGrid(to) || samePoint(from, to) || !pointOnSegment(from, a, b) || !pointOnSegment(to, a, b)) return refuse(s, S.noWire);
      const d = (p: Point): number => Math.abs(p.x - a.x) + Math.abs(p.y - a.y);
      const [near, far] = d(from) <= d(to) ? [from, to] : [to, from];
      if (!samePoint(a, near)) rest.push([a, near]);
      if (!samePoint(far, b)) rest.push([far, b]);
    }
    next.wires.splice(op.wire, 1, ...segs.filter((_, i) => i !== op.segment).map(([p, q]) => [p, q]), ...rest);
  }
  const split = splitNodes(s, next);
  const whole = op.segment === undefined || (op.piece === undefined && segmentsOf(wire).length === 1);
  return finish(s, split.changes, next, { summary: [whole ? S.wireDeleted : S.pieceDeleted, ...split.notes].join(' ') }, options);
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
    // No piece of ground keeps a ground symbol, and no line the drawing does not show is on ground:
    // nothing is on node 0 any more, which the first piece's sentence says (no-ground-1). A symbol may
    // still be drawn, with no part on its wires: then the sentence says that, not that none is left.
    let groundGone = node.ground && keepKey === undefined && node.hidden.length === 0;
    const symbolLeft = drawing.grounds.length > 0;
    for (const [key, list] of pieces) {
      if (key === keepKey) continue;
      const fresh = freshNodeName(s, taken);
      const names: string[] = [];
      for (const p of list) {
        const part = s.circuit.parts.find((q) => q.key === p.part)!;
        const token = s.netlist.lines[part.line]!.element!.nodes[p.pin]!.token;
        changes.push(replaceToken(token, fresh));
        if (!names.includes(part.name)) names.push(part.name);
      }
      notes.push(groundGone ? (symbolLeft ? S.groundCutOff : S.groundCut)(names, list.length, fresh) : S.split(names, list.length, nodeIn(s.circuit, node.name), fresh));
      groundGone = false;
    }
  }
  return { changes, notes };
}

function renameNode(s: Schematic, nodeName: string, wanted: string, options: EditOptions): EditResult {
  const node = labelNode(s.circuit, nodeName);
  const info = s.circuit.nodes.get(node);
  if (!info) return refuse(s, S.noNode(nodeName));
  if (node === GROUND) return refuse(s, S.groundName);
  const name = wanted.trim();
  if (!NODE_NAME.test(name)) return refuse(s, S.badName(name));
  const target = lowerAscii(name) === 'gnd' ? GROUND : lowerAscii(name);
  // A name that differs from another node's only in capital letters is that node (W6): it is written
  // as that node is, so the netlist (and what describes it) never has the two spellings.
  const existing = target !== GROUND && target !== node ? s.circuit.nodes.get(target) : undefined;
  const written = target === GROUND ? '0' : (existing?.text ?? name);
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
    const joined = existing && existing.text !== name ? S.joinedByCase(name, existing.text) : S.joinedByName(name);
    const summary = target === GROUND ? `${S.renamed(info.text, name)} ${S.nowGround(S.node(info.text))}` : `${S.renamed(info.text, name)} ${joined}`;
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
  const node = labelNode(s.circuit, op.node);
  const index = s.drawing.labels.findIndex((l) => l.node === node);
  if (index < 0) return refuse(s, S.noNode(op.node));
  const label = s.drawing.labels[index]!;
  const to = op.to ?? label.at;
  if (!onGrid(to)) return refuse(s, S.offGrid);
  if (op.side !== undefined && op.side !== 'auto' && !NODE_SPOTS.includes(op.side)) return refuse(s, S.badSide);
  const cu = copper(s);
  const here = cu.islandsAt(to);
  if (!here.some((i) => cu.nodeOf(i) === node)) return refuse(s, S.labelOff(said(s.circuit, node)));
  // Where another node's wire crosses this node's, the name would read as either node's.
  const other = here.map((i) => cu.nodeOf(i)).find((n) => n !== undefined && n !== node);
  if (other !== undefined) return refuse(s, S.labelCrossing(nodeIn(s.circuit, node), nodeIn(s.circuit, other)));
  const next = cloneDrawing(s.drawing);
  // A spot the drawing stores (side=: the video's, or the one the scene picked at the name's last
  // point) belongs to that point: moved to another point, the name gets the spot that fits there,
  // as a part turned lets its words' side go (second critic of the fix round: a name stepped on with
  // Shift+arrows kept the spot of its first stop). Only a spot the edit names is kept.
  const side = op.side === undefined ? (samePoint(to, label.at) ? label.side : undefined) : op.side === 'auto' ? undefined : op.side;
  next.labels[index] = side ? { node, at: to, side } : { node, at: to };
  const summary = S.labelMoved(said(s.circuit, node));
  const moved = finish(s, [], next, { summary, select: { node }, ...(op.side !== undefined && op.side !== 'auto' ? { chosen: { node } } : {}) }, options);
  // A name with no spot of its own (side=) that has no room at a point is written at the nearest
  // point of its copper where it has (scene.ts); a stored spot an edit puts something on may be let
  // go (relaxStored), and then the same. But the student put this name at `to`: it stays there, at
  // the spot the scene picks there (the least in the way) unless the edit names one, kept as chosen,
  // as a part's side the student chose is kept. So the name is where the preview showed it and the
  // summary says, never somewhere else (student:label-on-part, critic of the fix round). Only 'auto'
  // lets the scene choose.
  if (!moved.ok || op.side === 'auto' || landed(moved.drawing, node, to)) return moved;
  const free = cloneDrawing(next);
  free.labels[index] = { node, at: to };
  const spot = side ?? buildScene(s.circuit, free, options).nodeLabels[index]?.spot;
  if (!spot) return refuse(s, S.failed);
  next.labels[index] = { node, at: to, side: spot };
  const kept = finish(s, [], next, { summary, select: { node }, chosen: { node } }, options);
  return !kept.ok || landed(kept.drawing, node, to) ? kept : refuse(s, S.failed);
}

/** True when a drawing writes a node's name at a point. */
const landed = (d: Drawing, node: string, at: Point): boolean => d.labels.some((l) => l.node === node && samePoint(l.at, at));

function setSide(s: Schematic, op: Extract<EditOp, { kind: 'set-side' }>, options: EditOptions): EditResult {
  const part = s.circuit.parts.find((p) => p.key === lowerAscii(op.part));
  const placed = part ? s.drawing.parts.get(part.key) : undefined;
  if (!part || !placed) return refuse(s, S.noPart(op.part));
  if (op.side !== 'auto' && !LABEL_SIDES.includes(op.side)) return refuse(s, S.badSide);
  const next = cloneDrawing(s.drawing);
  next.parts.set(part.key, op.side === 'auto' ? { at: placed.at, rot: placed.rot, mirror: placed.mirror } : { at: placed.at, rot: placed.rot, mirror: placed.mirror, side: op.side });
  return finish(s, [], next, { summary: S.wordsMoved(part.name), select: { part: part.key }, ...(op.side !== 'auto' ? { chosen: { part: part.key } } : {}) }, options);
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
  const control = after ? (readsWords(after) ?? '') : '';
  return finish(s, changes, cloneDrawing(s.drawing), { summary: S.controlSet(part.name, control), select: { part: part.key } }, options);
}

/**
 * One end of a part on a node of its own: its node name in the text becomes a new one (n1, n2 ...),
 * and the drawing lets go of what held only that end (the wire ending there is cut back to where
 * something else touches it; a ground symbol on that pin alone goes). The rest of the old node keeps
 * its name and its wires. A part whose end touched another part's pin directly is placed again
 * beside its nodes, since the two pins cannot share a point any more.
 */
function disconnectPin(s: Schematic, op: Extract<EditOp, { kind: 'disconnect-pin' }>, options: EditOptions): EditResult {
  const part = s.circuit.parts.find((p) => p.key === lowerAscii(op.part));
  if (!part) return refuse(s, S.noPart(op.part));
  if (op.pin !== 0 && op.pin !== 1) return refuse(s, S.noPin);
  const node = part.nodes[op.pin];
  const info = s.circuit.nodes.get(node);
  const token = s.netlist.lines[part.line]?.element?.nodes[op.pin]?.token;
  if (!info || !token) return refuse(s, S.noPart(op.part));
  const others = info.pins.filter((p) => !(p.part === part.key && p.pin === op.pin));
  if (node !== GROUND && others.length === 0 && info.hidden.length === 0) return refuse(s, S.alone(part.name, said(s.circuit, node)));
  const fresh = freshNodeName(s, new Set());
  const next = cloneDrawing(s.drawing);
  const placed = next.parts.get(part.key);
  if (placed) {
    const at = partGeometry(part, placed).pins[op.pin]!;
    const otherPins = drawnPins(s.circuit, next).filter((p) => samePoint(p.at, at) && !(p.part === part.key && p.pin === op.pin));
    const wired = next.wires.some((w) => segmentsOf(w).some(([a, b]) => pointOnSegment(at, a, b)));
    if (otherPins.some((p) => p.part !== undefined)) next.parts.delete(part.key);
    else if (!wired) next.grounds = next.grounds.filter((g) => !samePoint(g.at, at));
  }
  return finish(s, [replaceToken(token, fresh)], next, { summary: S.disconnected(part.name, nodeIn(s.circuit, node), fresh), select: { part: part.key } }, options);
}

/**
 * The text with its drawing lines written for the drawing it shows (parts it placed or laid out
 * written down), read back until the lines say exactly what is shown. For a part line added to a
 * circuit drawn by hand: its place and wires go into the lines in the same step, so the part never
 * moves when other lines are typed later. A text with another version's drawing lines is returned
 * as it is.
 */
export function pinDrawing(text: string, options: LayoutOptions = {}): string {
  let out = text;
  for (let round = 0; round < 3; round++) {
    const s = buildSchematic(out, options);
    if (s.foreign.length) return out;
    const next = applyChanges(out, drawingBlockChanges(s.netlist, serializeDrawing(s.circuit, s.drawing, s.kept)));
    if (next === out) return out;
    out = next;
  }
  return out;
}

/**
 * The way the router would draw a new wire from `from`, through `corners` (each leg routed on its
 * own, as add-wire routes one), to `to`: a wire end, or a free point (the pointer over empty paper,
 * while the second end is being chosen). Like a new wire it keeps off symbols and other nodes'
 * copper and avoids words. For showing a wire before it is added: the path goes to add-wire as
 * `via` (without its two ends) when corners were chosen. Undefined when a leg finds no way.
 */
export function wireRoute(s: Schematic, from: WireEnd, to: WireEnd | { free: Point }, corners: readonly Point[] = []): Point[] | undefined {
  const a = endPoint(s, from);
  const b = 'free' in to ? (onGrid(to.free) ? { at: to.free } : undefined) : endPoint(s, to);
  if (!a || !b || !corners.every(onGrid)) return undefined;
  // The same rail rule as the wire it previews (addWire).
  if (!('free' in to) && !corners.length) railEnds(a, b);
  const cu = copper(s);
  const scene = s.scene;
  const walls = [...scene.parts.map((p) => p.box), ...scene.grounds.map((g) => g.box)];
  const nodeAt = (p: Point): string | undefined => {
    const island = cu.island(p);
    return island === undefined ? undefined : cu.nodeOf(island);
  };
  const avoid = wordsToAvoid(s, [nodeAt(a.at), nodeAt(b.at)]);
  const bounds = inflate(unionBoxes([scene.bounds, ...[a.at, b.at, ...corners].map((p) => ({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }))])!, 4);
  const stops: RouteEnd[] = [a, ...corners.map((at) => ({ at })), b];
  const path: Point[] = [a.at];
  /** The legs routed so far: a later leg keeps off them, as off another node's wire, so the wire never doubles back on itself at a corner. */
  const legs: Point[][] = [];
  for (let i = 1; i < stops.length; i++) {
    const p = stops[i - 1]!;
    const q = stops[i]!;
    if (samePoint(p.at, q.at)) continue;
    // Each leg may touch only the copper at its own two ends: a leg to a corner keeps off the far end's node.
    const ends = new Set([cu.island(p.at), cu.island(q.at)].filter((x): x is number => x !== undefined));
    const foreign = cu.foreign(ends);
    const world = { walls, avoid, foreignWires: [...foreign.wires, ...legs], foreignPins: foreign.pins, bounds };
    const leg = findRoute(world, [p], [q]);
    if (!leg) return undefined;
    if (leg.length >= 2) legs.push(leg);
    path.push(...leg.slice(1));
  }
  if (!samePoint(path[path.length - 1]!, b.at)) path.push(b.at);
  return path;
}
