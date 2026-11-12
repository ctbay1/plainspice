/**
 * The schematic editor's interaction layer (decision 0017): what the pointer and the keys mean on
 * the drawing, as the schematic model's own edits (src/schematic, applyEdit), and what to show while
 * an edit is being chosen: where a part in hand would land and which node each of its pins would
 * connect to, why a place is refused (the model's reason), the way a new wire would go, a part following
 * the pointer with its wires re-routed. Plain TypeScript (decision 0002): React renders what this
 * decides. Every change goes through applyEdit and then the store (source 'drawing'), so undo and
 * redo, live runs, the Netlist panel, the autosave, share links and export follow by themselves.
 *
 * Besides the pointer, every edit has a way without one (WCAG 2.1.1, 2.5.7): keys for the selected
 * item (T turns, M mirrors, Shift+R reverses, Shift+arrows move, Delete deletes), the "Add a part"
 * form that writes a part line between two nodes chosen in words (how SPICE itself thinks: a part is
 * a line naming its nodes), and the card's Connections, which wire one end of a part to a node
 * chosen from a list or let it go.
 *
 * Coordinates are the drawing's grid units (src/schematic/geometry.ts): x to the right, y down.
 */
import { t } from '../i18n/index.ts';
import {
  DEFAULT_VALUES,
  DIRECTION_VECTORS,
  EDIT_STRINGS,
  GROUND,
  NEW_TITLE,
  applyChanges,
  applyEdit,
  buildSchematic,
  drawnPins,
  findIslands,
  freshNodeName,
  freshPartName,
  insertLine,
  newlineOf,
  nextRotation,
  pointOnSegment,
  readDrawing,
  samePoint,
  segmentsOf,
  symbolGeometry,
  pinDrawing,
  readsWords,
  wireRoute,
  type Box,
  type CircuitPart,
  type Direction,
  type EditOp,
  type EditResult,
  type NavItem,
  type PartLetter,
  type Point,
  type Rotation,
  type Schematic,
  type WireEnd,
} from '../schematic/index.ts';
import { elementInfo } from '../spice/elements.ts';
import { EXPLAIN_STRINGS } from '../spice/explain.ts';
import { parseNetlist } from '../spice/parse.ts';
import type { Netlist, TextChange } from '../spice/types.ts';
import { checkValue, type ValueCheck } from './card-edit.ts';
import { toolForKey, type PartKind, type Tool } from './tools.ts';

const S = EDIT_STRINGS;

/** A point on the grid (whole numbers). */
const pt = (x: number, y: number): Point => ({ x: x === 0 ? 0 : x, y: y === 0 ? 0 : y });
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const inside = (b: Box, p: Point, pad = 0): boolean => p.x >= b.x0 - pad && p.x <= b.x1 + pad && p.y >= b.y0 - pad && p.y <= b.y1 + pad;

/** An edit refused before it reached the model (the app's own reason), in the model's result shape. */
function refused(s: Schematic, reason: string): EditResult {
  return { ok: false, reason, changes: [], text: s.netlist.text, drawing: s.drawing, lines: [], summary: reason, notes: [] };
}

// ------------------------------------------------------------------ what is on the drawing where

/** Which node the copper at a grid point belongs to (a pin, a ground symbol's pin, a wire, a label), if any. */
export function nodeAt(s: Schematic, p: Point): string | undefined {
  return copperOf(s).at(p);
}

interface Copper {
  at(p: Point): string | undefined;
}
const copperCache = new WeakMap<Schematic, Copper>();

function copperOf(s: Schematic): Copper {
  const cached = copperCache.get(s);
  if (cached) return cached;
  const pins = drawnPins(s.circuit, s.drawing);
  const islands = findIslands(s.drawing.wires, pins.map((p) => p.at));
  const node = new Map<number, string>();
  pins.forEach((p, i) => node.set(islands.anchors[i]!, p.node));
  for (const l of s.drawing.labels) {
    const i = islands.at(l.at);
    if (i !== undefined && !node.has(i)) node.set(i, l.node);
  }
  const c: Copper = {
    at: (p) => {
      if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) return undefined;
      const i = islands.at(p);
      return i === undefined ? undefined : node.get(i);
    },
  };
  copperCache.set(s, c);
  return c;
}

/** True when two points are on one piece of copper (wires and pins that touch; pieces joined only by name are apart). */
export function sameCopper(s: Schematic, a: Point, b: Point): boolean {
  const pins = drawnPins(s.circuit, s.drawing);
  const islands = findIslands(s.drawing.wires, pins.map((p) => p.at));
  const ia = islands.at(a);
  return ia !== undefined && ia === islands.at(b);
}

/** Every grid point of a node's copper: its pins (ground: the ground symbols' pins too) and each point along its wires. */
export function copperPoints(s: Schematic, node: string): Point[] {
  const out: Point[] = [];
  const seen = new Set<string>();
  const add = (p: Point): void => {
    const k = `${p.x},${p.y}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  };
  for (const part of s.scene.parts) for (const pin of part.pins) if (pin.node === node) add(pin.at);
  if (node === GROUND) for (const g of s.scene.grounds) add(g.at);
  for (const w of s.scene.wires) {
    if (w.node !== node) continue;
    for (const [a, b] of segmentsOf(w.points)) {
      const dx = Math.sign(b.x - a.x);
      const dy = Math.sign(b.y - a.y);
      if (dx && dy) {
        add(a);
        add(b);
        continue;
      }
      for (let p = a; ; p = pt(p.x + dx, p.y + dy)) {
        add(p);
        if (samePoint(p, b)) break;
      }
    }
  }
  return out;
}

/** What the pointer is over: a pin, a ground symbol's pin, a node's name, a wire, a part, a ground symbol. */
export type Hit =
  | { kind: 'pin'; part: string; pin: 0 | 1; at: Point; node: string }
  | { kind: 'ground-pin'; ground: number; at: Point }
  | { kind: 'label'; node: string; at: Point }
  | { kind: 'wire'; wire: number; segment: number; at: Point; node: string | undefined; piece: Piece }
  | { kind: 'part'; key: string }
  | { kind: 'ground'; ground: number };

/** A node's name on the drawing under a point (the name's own line, a little wider). */
function labelAt(s: Schematic, p: Point): Hit | undefined {
  for (const l of s.scene.nodeLabels) {
    const box = l.lines.find((x) => x.role === 'node')?.box ?? l.box;
    if (inside(box, p, 0.15)) return { kind: 'label', node: l.node, at: l.at };
  }
  return undefined;
}

/** A stretch of one straight segment of a wire, from one point on it to another. */
export interface Piece {
  from: Point;
  to: Point;
}

/**
 * The piece of a wire's segment a point is on: the stretch between the nearest places either side
 * where the wire stops or something joins it (its corners and ends, another wire's end or corner, a
 * pin). What a click on a wire selects, and what Delete then takes away (a stub left leading
 * nowhere goes with it when the drawing is rebuilt).
 */
export function pieceAt(s: Schematic, wire: number, segment: number, p: Point): Piece | undefined {
  const w = s.drawing.wires[wire];
  const seg = w ? segmentsOf(w)[segment] : undefined;
  if (!seg) return undefined;
  const [a, b] = seg;
  if (a.x !== b.x && a.y !== b.y) return { from: a, to: b };
  const along = (q: Point): number => (a.x === b.x ? q.y : q.x);
  const inside = (q: Point): boolean => pointOnSegment(q, a, b) && !samePoint(q, a) && !samePoint(q, b);
  const stops = new Map<number, Point>([
    [along(a), a],
    [along(b), b],
  ]);
  for (const other of s.drawing.wires) for (const q of other) if (inside(q)) stops.set(along(q), q);
  for (const pin of drawnPins(s.circuit, s.drawing)) if (inside(pin.at)) stops.set(along(pin.at), pin.at);
  const sorted = [...stops.entries()].sort((x, y) => x[0] - y[0]);
  const t = along(p);
  for (let i = 1; i < sorted.length; i++) if (t <= sorted[i]![0] || i === sorted.length - 1) return { from: sorted[i - 1]![1], to: sorted[i]![1] };
  return { from: a, to: b };
}

/** The piece of wire nearest a point, within `tol`, with the grid point on it nearest the pointer. */
function wireAt(s: Schematic, p: Point, tol: number): Hit | undefined {
  let best: { d: number; wire: number; segment: number; at: Point; node: string | undefined } | undefined;
  s.scene.wires.forEach((w, i) =>
    segmentsOf(w.points).forEach(([a, b], j) => {
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      const y0 = Math.min(a.y, b.y);
      const y1 = Math.max(a.y, b.y);
      const d = Math.hypot(p.x - clamp(p.x, x0, x1), p.y - clamp(p.y, y0, y1));
      if (d > tol || (best && d >= best.d)) return;
      const at = a.y === b.y ? pt(clamp(Math.round(p.x), x0, x1), a.y) : a.x === b.x ? pt(a.x, clamp(Math.round(p.y), y0, y1)) : Math.hypot(p.x - a.x, p.y - a.y) < Math.hypot(p.x - b.x, p.y - b.y) ? a : b;
      best = { d, wire: i, segment: j, at, node: w.node };
    }),
  );
  if (!best) return undefined;
  const { wire, segment, at, node } = best;
  const piece = pieceAt(s, wire, segment, p);
  return piece ? { kind: 'wire', wire, segment, at, node, piece } : undefined;
}

/**
 * What is under a point. With the Wire tool: the nearest pin or ground symbol's pin within `tol`,
 * else a node's name, else a wire. Otherwise (Select): a part (its symbol, then its words), a
 * ground symbol, a node's name, else a wire within `tol`.
 */
export function hitTest(s: Schematic, p: Point, tol: number, mode: 'select' | 'wire'): Hit | undefined {
  const sc = s.scene;
  if (mode === 'wire') {
    let best: { d: number; hit: Hit } | undefined;
    const consider = (hit: Hit, at: Point): void => {
      const d = Math.hypot(at.x - p.x, at.y - p.y);
      if (d <= tol && (!best || d < best.d)) best = { d, hit };
    };
    for (const part of sc.parts) part.pins.forEach((pin, i) => consider({ kind: 'pin', part: part.key, pin: i === 0 ? 0 : 1, at: pin.at, node: pin.node }, pin.at));
    for (const g of sc.grounds) consider({ kind: 'ground-pin', ground: g.index, at: g.at }, g.at);
    if (best) return best.hit;
    return labelAt(s, p) ?? wireAt(s, p, tol);
  }
  for (const part of sc.parts) if (inside(part.body, p, 0.35)) return { kind: 'part', key: part.key };
  for (const g of sc.grounds) if (inside(g.box, p, 0.25)) return { kind: 'ground', ground: g.index };
  const label = labelAt(s, p);
  if (label) return label;
  for (const part of sc.parts) if (inside(part.box, p, 0.15) || inside(part.labelBox, p, 0.05)) return { kind: 'part', key: part.key };
  return wireAt(s, p, tol);
}

// ------------------------------------------------------------------ a part in hand

/** A part (or a ground symbol) in hand: what it is, its turn and whether it is mirrored. */
export interface Hand {
  kind: PartKind;
  rot: Rotation;
  mirror: boolean;
}

/**
 * A part in hand starts as most first drawings have it: R, C and L lying across; sources upright, a
 * voltage source with its + at the top and a current source with its arrow pointing up (its "from"
 * end at the bottom, on the ground rail), as the channel draws them.
 */
export function handFor(kind: PartKind): Hand {
  const rot: Rotation = kind === 'R' || kind === 'C' || kind === 'L' ? 270 : kind === 'I' || kind === 'F' || kind === 'G' ? 180 : 0;
  return { kind, rot, mirror: false };
}

/** A quarter turn clockwise. */
export const turnHand = (h: Hand): Hand => ({ ...h, rot: nextRotation(h.rot) });
/** Mirrored (a ground symbol looks the same either way). */
export const mirrorHand = (h: Hand): Hand => (h.kind === 'ground' ? h : { ...h, mirror: !h.mirror });
/** Its two ends swapped: a part in hand has no wires yet, so this is a half turn. */
export const reverseHand = (h: Hand): Hand => (h.kind === 'ground' ? h : { ...h, rot: nextRotation(nextRotation(h.rot)) });

/** A pin of the part in hand, and the node it would join there (undefined: a new node). */
export interface PinMark {
  at: Point;
  node: string | undefined;
}

export interface PlacePreview {
  hand: Hand;
  at: Point;
  ok: boolean;
  /** Why it cannot go here, in the model's words. */
  reason?: string;
  /** The reason holds wherever it goes (refusedAnywhere): the hint says it without "Not here". */
  anywhere?: boolean;
  pins: PinMark[];
}

/**
 * Why the part in hand cannot be placed anywhere on this drawing yet, if so: a ground symbol on a page
 * with no parts (it connects to the node its pin touches), an F or H in a circuit with no voltage
 * source to read the current through (P7, P8; an E or H works too, P10b: sourceChoices).
 */
export function refusedAnywhere(s: Schematic, kind: PartKind): string | undefined {
  if (kind === 'ground' && s.scene.parts.length === 0) return t('placeGroundFirst');
  if ((kind === 'F' || kind === 'H') && !sourceChoices(s).length) return S.noSource(kind);
  return undefined;
}

/** The model's edit for placing a hand at a point. */
export function placeOp(hand: Hand, at: Point): EditOp {
  return hand.kind === 'ground' ? { kind: 'add-ground', at, rot: hand.rot } : { kind: 'add-part', letter: hand.kind, at, rot: hand.rot, mirror: hand.mirror };
}

/** Where its pins land and which nodes they would join; refused (and why) when the model would refuse it here. */
export function placePreview(s: Schematic, hand: Hand, at: Point): PlacePreview {
  const pins = symbolGeometry(hand.kind, at, hand.rot, hand.mirror).pins.map((p) => ({ at: p, node: nodeAt(s, p) }));
  const anywhere = refusedAnywhere(s, hand.kind);
  if (anywhere) return { hand, at, ok: false, reason: anywhere, anywhere: true, pins };
  const r = applyEdit(s, placeOp(hand, at));
  return r.ok ? { hand, at, ok: true, pins } : { hand, at, ok: false, reason: r.reason ?? S.failed, pins };
}

/** Which nodes the part in hand would connect to where it is now, in words: "its ends connect to node in and a new node", "node out becomes ground (node 0)". */
export function joinsWords(s: Schematic, p: PlacePreview): string {
  if (p.hand.kind === 'ground') {
    const node = p.pins[0]?.node;
    if (node === undefined) return t('groundAlone');
    return node === GROUND ? t('groundJoinsGround') : t('groundJoins', { node: nodeSaid(s, node) });
  }
  const [a, b] = p.pins.map((pin) => (pin.node === undefined ? undefined : pin.node === GROUND ? S.ground : nodeSaid(s, pin.node)));
  // A current source: which way its arrow pushes the current, in the words of explain.ts (iPushes).
  if (p.hand.kind === 'I' || p.hand.kind === 'F' || p.hand.kind === 'G') return t('joinsCurrent', { a: a ?? t('joinsNew'), b: b ?? t('joinsNew') });
  if (a === undefined && b === undefined) return t('joinsTwoNew');
  return t('joinsTwo', { a: a ?? t('joinsNew'), b: b ?? t('joinsNew') });
}

/**
 * A page with no parts and nothing to run: what it lacks (decision 0017, from the checks
 * no-analysis and missing-end). Without an analysis line ngspice runs nothing (no-analysis-1), so
 * the first part placed also writes .op, which finds the DC voltages and currents, and .end, which
 * ngspice does not need from a file (missing-end-1) but which marks where the circuit stops. Both go
 * where the editor's own lines expect them: new part lines before .op, the drawing lines before .end.
 */
export function needsStarter(netlist: Netlist): boolean {
  return !netlist.lines.some((l) => l.kind === 'element') && netlist.analyses.length === 0 && !netlist.lines.some((l) => l.kind === 'control');
}

/** What the first part's summary adds about .op and .end: what each is for, .op named in the words of explain.ts ("operating point"). */
export const starterWords = (): string => t('starterAdded', { op: EXPLAIN_STRINGS.opWhat });

/** The text with .op (and .end, when it has none) added for a first part, or undefined when it needs neither. */
export function withStarter(netlist: Netlist): string | undefined {
  if (!needsStarter(netlist)) return undefined;
  const text = netlist.text;
  const nl = newlineOf(text);
  if (!text.length) return `${NEW_TITLE}${nl}.op${nl}.end${nl}`;
  const lead = text.endsWith('\n') ? '' : nl;
  // .op before the drawing lines (or .end), so new part lines, which go before the analysis, stay above both.
  const before = [readDrawing(netlist).lineIndexes[0], netlist.end].filter((i): i is number => i !== undefined && i > 0).sort((a, b) => a - b)[0];
  const changes: TextChange[] = [];
  if (before !== undefined) changes.push({ from: netlist.lines[before]!.span.from, to: netlist.lines[before]!.span.from, insert: `.op${nl}` });
  else changes.push({ from: text.length, to: text.length, insert: `${lead}.op${nl}` });
  if (netlist.end === undefined) {
    if (before !== undefined) changes.push({ from: text.length, to: text.length, insert: `${lead}.end${nl}` });
    else changes[0] = { from: text.length, to: text.length, insert: `${lead}.op${nl}.end${nl}` };
  }
  return applyChanges(text, changes);
}

/**
 * Places the hand at a point (the model's add-part or add-ground). On a page with no parts the first
 * part also writes .op and .end (needsStarter), and the summary says so; the result's text is then
 * the whole new text (its changes are against the text with .op and .end).
 */
export function placeEdit(s: Schematic, hand: Hand, at: Point): EditResult {
  if (hand.kind === 'ground' && s.scene.parts.length === 0) return refused(s, t('placeGroundFirst'));
  const starter = hand.kind === 'ground' ? undefined : withStarter(s.netlist);
  const base = starter === undefined ? s : buildSchematic(starter, s.options);
  const r = applyEdit(base, placeOp(hand, at));
  return r.ok && starter !== undefined ? { ...r, summary: `${r.summary} ${starterWords()}` } : r;
}

/** True when a netlist has drawing lines (decision 0013: its `*@` block, or another version's). */
export function hasDrawingLines(text: string): boolean {
  const lines = readDrawing(parseNetlist(text));
  return lines.lineIndexes.length > 0 || lines.foreign.length > 0;
}

// ------------------------------------------------------------------ moving

/** What can be picked up and moved: a part, a ground symbol, a node's name. */
export type Grab = { kind: 'part'; key: string } | { kind: 'ground'; ground: number } | { kind: 'label'; node: string };

/** The grab for a hit or a drawing item (ground: its first symbol), if it can be moved. */
export function grabOf(s: Schematic, x: Hit | NavItem, ground?: number): Grab | undefined {
  if (x.kind === 'part') return { kind: 'part', key: x.key };
  if (x.kind === 'ground') return { kind: 'ground', ground: x.ground };
  if (x.kind === 'label') return x.node === GROUND ? undefined : { kind: 'label', node: x.node };
  if (x.kind === 'node') {
    if (x.name === GROUND) return s.drawing.grounds.length ? { kind: 'ground', ground: Math.min(ground ?? 0, s.drawing.grounds.length - 1) } : undefined;
    return s.drawing.labels.some((l) => l.node === x.name) ? { kind: 'label', node: x.name } : undefined;
  }
  return undefined;
}

/** Where a grab is now: a part's centre, a ground symbol's pin, a name's point on its copper. */
export function grabAt(s: Schematic, g: Grab): Point | undefined {
  if (g.kind === 'part') return s.drawing.parts.get(g.key)?.at;
  if (g.kind === 'ground') return s.drawing.grounds[g.ground]?.at;
  return s.drawing.labels.find((l) => l.node === g.node)?.at;
}

/** The model's edit that moves a grab to a point. */
export function moveOp(g: Grab, to: Point): EditOp {
  if (g.kind === 'part') return { kind: 'move-part', part: g.key, to };
  if (g.kind === 'ground') return { kind: 'move-ground', ground: g.ground, to };
  return { kind: 'move-label', node: g.node, to };
}

/**
 * Where a grab would go for the pointer at `p`, held `offset` from its point: a part or a ground
 * symbol snapped to the grid; a node's name onto the nearest point of its own copper.
 */
export function dragTarget(s: Schematic, g: Grab, p: Point, offset: Point): Point {
  const want = { x: p.x - offset.x, y: p.y - offset.y };
  if (g.kind !== 'label') return pt(Math.round(want.x), Math.round(want.y));
  let best: { at: Point; d: number } | undefined;
  for (const q of copperPoints(s, g.node)) {
    const d = Math.hypot(q.x - want.x, q.y - want.y);
    if (!best || d < best.d) best = { at: q, d };
  }
  return best?.at ?? pt(Math.round(want.x), Math.round(want.y));
}

export interface MovePreview {
  grab: Grab;
  to: Point;
  /** The part's turn and whether it is mirrored where it would land (turned or mirrored on the way: T and M while it moves). */
  turn?: { rot: Rotation; mirror: boolean };
  /** The text the preview was made from: a preview of an older text is never put down (the text has changed under it). */
  base: string;
  ok: boolean;
  reason?: string;
  /** The model's result (ok), and the drawing it gives, to show while the pointer is still down. */
  result?: EditResult;
  schematic?: Schematic;
}

/**
 * The drawing with the grab moved to `to` (its wires re-routed), turned or mirrored on the way when
 * `turn` says so, or why it cannot go there.
 */
export function movePreview(s: Schematic, g: Grab, to: Point, turn?: { rot: Rotation; mirror: boolean }): MovePreview {
  const base = s.netlist.text;
  const at = grabAt(s, g);
  const placed = g.kind === 'part' ? s.drawing.parts.get(g.key) : undefined;
  const turned = !!turn && !!placed && (turn.rot !== placed.rot || turn.mirror !== placed.mirror);
  const own = turned && turn ? { turn } : {};
  if (at && samePoint(at, to) && !turned) return { grab: g, to, base, ok: true, schematic: s };
  const op: EditOp = g.kind === 'part' && turned && turn ? { kind: 'move-part', part: g.key, to, rot: turn.rot, mirror: turn.mirror } : moveOp(g, to);
  const r = applyEdit(s, op);
  if (!r.ok) return { grab: g, to, base, ...own, ok: false, reason: r.reason ?? S.failed };
  return { grab: g, to, base, ...own, ok: true, result: r, schematic: buildSchematic(r.text, s.options) };
}

/** The point one grid step from a grab in a direction (Shift+arrow keys). */
export function stepFrom(s: Schematic, g: Grab, dir: Direction): Point | undefined {
  const at = grabAt(s, g);
  if (!at) return undefined;
  const v = DIRECTION_VECTORS[dir];
  return pt(at.x + v.x, at.y + v.y);
}

// ------------------------------------------------------------------ wires

/** One end of a wire being drawn: the model's end, its point, and the node there. */
export interface WireStart {
  end: WireEnd;
  at: Point;
  node: string | undefined;
}

/** The wire end for a hit: a pin, a ground symbol's pin, a point on a wire, or a node's name (its point). */
export function wireStartOf(hit: Hit | undefined): WireStart | undefined {
  if (!hit) return undefined;
  switch (hit.kind) {
    case 'pin':
      return { end: { part: hit.part, pin: hit.pin }, at: hit.at, node: hit.node };
    case 'ground-pin':
      return { end: { ground: hit.ground }, at: hit.at, node: GROUND };
    case 'wire':
      return { end: { at: hit.at }, at: hit.at, node: hit.node };
    case 'label':
      return { end: { at: hit.at }, at: hit.at, node: hit.node };
    default:
      return undefined;
  }
}

/** With the Wire tool, a point on a part's symbol or a ground symbol: the pin nearest it (a click there means that part, never a corner inside it). */
export function symbolEnd(s: Schematic, at: Point, tol: number): WireStart | undefined {
  // The symbol itself (not its words, where a corner may well be wanted).
  const part = s.scene.parts.find((p) => inside(p.body, at, Math.min(tol, 0.35)) || inside(p.box, at, 0.15));
  if (!part) {
    const g = s.scene.grounds.find((x) => inside(x.box, at, 0.25));
    return g ? { end: { ground: g.index }, at: g.at, node: GROUND } : undefined;
  }
  const d = (p: Point): number => Math.hypot(p.x - at.x, p.y - at.y);
  const pin = d(part.pins[0].at) <= d(part.pins[1].at) ? 0 : 1;
  return { end: { part: part.key, pin }, at: part.pins[pin].at, node: part.pins[pin].node };
}

/** Where a wire can start or end, shown while the Wire tool is chosen: every pin, ground pin, wire end and corner. */
export function wireTargets(s: Schematic): { at: Point; node: string | undefined }[] {
  const out = new Map<string, { at: Point; node: string | undefined }>();
  const add = (at: Point, node: string | undefined): void => {
    const k = `${at.x},${at.y}`;
    if (!out.has(k)) out.set(k, { at, node });
  };
  for (const part of s.scene.parts) for (const pin of part.pins) add(pin.at, pin.node);
  for (const g of s.scene.grounds) add(g.at, GROUND);
  for (const w of s.scene.wires) for (const p of w.points) add(p, w.node);
  return [...out.values()];
}

/** A wire on its way: where it started, and the corners chosen on empty paper since. */
export interface WireDraft {
  start: WireStart;
  corners: Point[];
}

/** The way the wire would go from its start, through its corners, to a wire end or a free point (the pointer). */
export function wirePreview(s: Schematic, d: WireDraft, to: WireStart | Point): Point[] | undefined {
  return wireRoute(s, d.start.end, 'end' in to ? to.end : { free: to }, d.corners);
}

/** Ends the wire at a wire end: the model's add-wire, along the route shown when corners were chosen. */
export function wireEdit(s: Schematic, d: WireDraft, end: WireStart): EditResult {
  if (samePoint(d.start.at, end.at) && !d.corners.length) return refused(s, t('wireSamePoint'));
  if (!d.corners.length) {
    // Already on one piece of copper: there is no wire to draw (it would say "Wire added." and add nothing).
    if (sameCopper(s, d.start.at, end.at)) return refused(s, t('wireSameNode', { node: end.node === undefined ? t('joinsNew') : nodeSaid(s, end.node) }));
    return applyEdit(s, { kind: 'add-wire', from: d.start.end, to: end.end });
  }
  const path = wireRoute(s, d.start.end, end.end, d.corners);
  if (!path) return refused(s, S.noRoute);
  return applyEdit(s, { kind: 'add-wire', from: d.start.end, to: end.end, via: path.slice(1, -1) });
}

/** The wire end on a node's copper nearest a point (its pins first): for wiring node to node from the keyboard. */
export function nodeEnd(s: Schematic, node: string, near: Point | undefined): WireStart | undefined {
  const pins: WireStart[] = [];
  for (const part of s.scene.parts) part.pins.forEach((pin, i) => pin.node === node && pins.push({ end: { part: part.key, pin: i === 0 ? 0 : 1 }, at: pin.at, node }));
  if (node === GROUND) for (const g of s.scene.grounds) pins.push({ end: { ground: g.index }, at: g.at, node });
  const label = s.drawing.labels.find((l) => l.node === node);
  const options = pins.length ? pins : label ? [{ end: { at: label.at }, at: label.at, node }] : [];
  if (!near) return options[0];
  return options.slice().sort((a, b) => Math.abs(a.at.x - near.x) + Math.abs(a.at.y - near.y) - (Math.abs(b.at.x - near.x) + Math.abs(b.at.y - near.y)))[0];
}

// ------------------------------------------------------------------ deleting

/** What can be selected on the drawing besides the parts and nodes (NavItem): a piece of wire (one ground symbol is chosen apart). */
export type PieceOfWire = { wire: number; segment: number; piece?: Piece };

/** The model's edit that deletes the selection. */
export function deleteOp(s: Schematic, item: NavItem | undefined, wire: PieceOfWire | undefined, ground: number | undefined): EditOp | undefined {
  if (wire) return { kind: 'delete-wire', wire: wire.wire, segment: wire.segment, ...(wire.piece ? { piece: wire.piece } : {}) };
  if (item?.kind === 'part') return { kind: 'delete-part', part: item.key };
  if (item?.kind === 'node' && item.name === GROUND && s.drawing.grounds.length) return { kind: 'delete-ground', ground: Math.min(ground ?? 0, s.drawing.grounds.length - 1) };
  return undefined;
}

// ------------------------------------------------------------------ connections (the card, without a pointer)

/** A node in words, as the lists and cards say it: "ground (node 0)", or its name as written. */
export function nodeWords(s: Schematic, node: string): string {
  return node === GROUND ? t('groundWords') : (s.circuit.nodes.get(node)?.text ?? node);
}

/** A node in a sentence: "node out" (a name may be an ordinary word: "Wire started at node s."), "ground (node 0)". */
export function nodeSaid(s: Schematic, node: string): string {
  return node === GROUND ? t('groundWords') : t('nodeNamed', { name: s.circuit.nodes.get(node)?.text ?? node });
}

/**
 * The circuit's nodes to choose from: ground first, then the others in the netlist's order. With
 * `parts`, each says which parts it joins ("n4: R1, R2, R3"), so a node can be told from another
 * while a circuit is being built (most names are PlainSpice's then).
 */
export function nodeChoices(s: Schematic, parts = false): { node: string; words: string }[] {
  const others = [...s.circuit.nodes.keys()].filter((n) => n !== GROUND);
  const on = (n: string): string => {
    const names = s.circuit.parts.filter((p) => p.nodes.includes(n)).map((p) => p.name);
    return parts && names.length ? t('nodeWithParts', { node: nodeWords(s, n), parts: names.join(', ') }) : nodeWords(s, n);
  };
  return [{ node: GROUND, words: t('groundWords') }, ...others.map((n) => ({ node: n, words: on(n) }))];
}

/** What a controlled source reads, in the words of its card's Connections and the model's summary: "the voltage between node in and ground", "the current through V1". */
export function controlWords(part: CircuitPart): string | undefined {
  return readsWords(part);
}

/** The sources an F or H can read the current of: V sources first, then E and H (P10b), as the model picks. */
export function sourceChoices(s: Schematic, except?: string): { key: string; name: string }[] {
  const of = (letters: string): { key: string; name: string }[] => s.circuit.parts.filter((p) => letters.includes(p.letter) && p.key !== except).map((p) => ({ key: p.key, name: p.name }));
  return [...of('V'), ...of('EH')];
}

/** One end of a part: which pin, its name ("+ end", "from end", "end 1"), and its node. */
export interface PartEnd {
  pin: 0 | 1;
  role: string;
  node: string;
  words: string;
}

/**
 * What a part's two ends are called in the editor, from the element catalog's words (src/spice/elements.ts)
 * with "end" for "node", since an end is on a node and is not one: "+ end" and "− end", "from end" and
 * "to end", "end 1" and "end 2". The field table keeps the catalog's own words ("+ node").
 */
export function endRoles(letter: PartLetter): [string, string] {
  const labels = (elementInfo(letter)?.nodeLabels ?? []).map((l) => l.replace(/\bnode\b/, t('endWord')));
  const a = labels[0] ?? t('endWord');
  const b = labels[1] ?? a;
  return a === b ? [t('endNumbered', { label: a, n: 1 }), t('endNumbered', { label: b, n: 2 })] : [a, b];
}

/** A part's two ends, named as endRoles says, with the node each is on. */
export function endsOf(s: Schematic, key: string): PartEnd[] {
  const part = s.circuit.parts.find((p) => p.key === key);
  if (!part) return [];
  const roles = endRoles(part.letter);
  return ([0, 1] as const).map((pin) => ({ pin, role: roles[pin], node: part.nodes[pin], words: nodeWords(s, part.nodes[pin]) }));
}

/** A ground symbol at a pin points away from its part. */
function groundRot(out: Direction): Rotation {
  return out === 'down' ? 0 : out === 'left' ? 90 : out === 'up' ? 180 : 270;
}

/**
 * One end of a part connected to a node: a wire from its pin to the nearest point of that node's
 * copper the router finds a way to (the model's add-wire, which makes the two nodes one and says
 * which name stays); for ground, a ground symbol at the pin when no wire finds a way; failing both,
 * the two are joined by name (rename-node), which the summary says.
 */
export function connectEdit(s: Schematic, key: string, pin: 0 | 1, node: string): EditResult {
  const part = s.scene.parts.find((p) => p.key === key);
  const end = part?.pins[pin];
  if (!part || !end) return refused(s, S.noPart(key));
  if (end.node === node) return refused(s, t('connAlready', { node: nodeSaid(s, node) }));
  const from: WireEnd = { part: key, pin };
  const targets: { end: WireEnd; at: Point }[] = [];
  for (const p of s.scene.parts) {
    if (p.key === key) continue;
    p.pins.forEach((q, i) => q.node === node && targets.push({ end: { part: p.key, pin: i === 0 ? 0 : 1 }, at: q.at }));
  }
  if (node === GROUND) for (const g of s.scene.grounds) targets.push({ end: { ground: g.index }, at: g.at });
  const taken = new Set(targets.map((x) => `${x.at.x},${x.at.y}`));
  for (const q of copperPoints(s, node)) if (!taken.has(`${q.x},${q.y}`)) targets.push({ end: { at: q }, at: q });
  const d = (q: Point): number => Math.abs(q.x - end.at.x) + Math.abs(q.y - end.at.y);
  targets.sort((x, y) => d(x.at) - d(y.at));
  let last: EditResult | undefined;
  for (const target of targets.slice(0, 8)) {
    const r = applyEdit(s, { kind: 'add-wire', from, to: target.end });
    if (r.ok) return r;
    last = r;
  }
  if (node === GROUND) {
    const r = applyEdit(s, { kind: 'add-ground', at: end.at, rot: groundRot(end.outward) });
    if (r.ok) return r;
    last ??= r;
  }
  const byName = end.node === GROUND ? applyEdit(s, { kind: 'rename-node', node, name: '0' }) : applyEdit(s, { kind: 'rename-node', node: end.node, name: node === GROUND ? '0' : nodeWords(s, node) });
  return byName.ok ? byName : (last ?? byName);
}

/** One end of a part let go: it stands alone on a new node (the model's disconnect-pin). */
export function disconnectEdit(s: Schematic, key: string, pin: 0 | 1): EditResult {
  return applyEdit(s, { kind: 'disconnect-pin', part: key, pin });
}

// ------------------------------------------------------------------ the Add a part form

/** One end's node in the form: a node of the circuit, or a new one with the name typed. */
export type NodePick = { node: string } | { fresh: string };

export interface PartForm {
  letter: PartLetter;
  value: string;
  ends: [NodePick, NodePick];
  /** E and G: the two nodes they read the voltage between; F and H: the source whose current they read. */
  plus?: string;
  minus?: string;
  source?: string;
}

const NODE_NAME = /^[A-Za-z0-9_]{1,32}$/;

/** The form as it opens: the kind chosen, its default value, and nodes to start from (`near`: a node the student was on). */
export function formStart(s: Schematic, letter: PartLetter, near?: string): PartForm {
  const taken = new Set<string>();
  const fresh = (): NodePick => ({ fresh: freshNodeName(s, taken) });
  const first = [...s.circuit.nodes.keys()].find((n) => n !== GROUND);
  const here: NodePick | undefined = near !== undefined && (near === GROUND || s.circuit.nodes.has(near)) ? { node: near } : undefined;
  let ends: [NodePick, NodePick];
  if (letter === 'V' || letter === 'E' || letter === 'H') ends = [here && near !== GROUND ? here : fresh(), { node: GROUND }];
  else if (letter === 'I' || letter === 'F' || letter === 'G') ends = [{ node: GROUND }, here && near !== GROUND ? here : fresh()];
  else ends = [here ?? (first !== undefined ? { node: first } : fresh()), fresh()];
  const form: PartForm = { letter, value: defaultValue(letter), ends };
  if (letter === 'E' || letter === 'G') {
    form.plus = first ?? GROUND;
    form.minus = GROUND;
  }
  if (letter === 'F' || letter === 'H') {
    const source = sourceChoices(s)[0];
    if (source) form.source = source.key;
  }
  return form;
}

/** A new part's value: the model's default, small and never a trap (src/schematic DEFAULT_VALUES). */
export const defaultValue = (letter: PartLetter): string => DEFAULT_VALUES[letter];

/** A field of the form a refusal is about. */
export type FormField = 'value' | 'end0' | 'end1' | 'control';

export type FormLine =
  | { ok: true; line: string; name: string; summary: string; value: ValueCheck }
  | { ok: false; reason: string; field: FormField; value: ValueCheck; fix?: { label: string; value: string } };

/**
 * The value as the form would write it, checked as a part's card checks it (card-edit.ts): the line
 * with this value goes into the netlist as it is now, and SPICE reads it as one number there or not.
 * The other words of the line only need to be there (new nodes, a control the circuit has).
 */
export function formValue(s: Schematic, f: PartForm): ValueCheck {
  const name = freshPartName(s, f.letter);
  const taken = new Set<string>();
  const control = f.letter === 'E' || f.letter === 'G' ? ' 0 0' : f.letter === 'F' || f.letter === 'H' ? ` ${s.circuit.parts.find((p) => p.key === f.source)?.name ?? sourceChoices(s)[0]?.name ?? 'V1'}` : '';
  const line = `${name} ${freshNodeName(s, taken)} ${freshNodeName(s, taken)}${control} ${f.value.trim()}`;
  const text = applyChanges(s.netlist.text, [insertLine(s.netlist, line)]);
  return checkValue(text, name.toLowerCase(), f.value, t('formBadValue'));
}

/** The line the form would add, as the Netlist panel would hold it ("R3 in out 1k"), or which field is wrong and why. */
export function formLine(s: Schematic, f: PartForm): FormLine {
  const name = freshPartName(s, f.letter);
  const value = formValue(s, f);
  const written: string[] = [];
  const words: string[] = [];
  for (const [i, pick] of f.ends.entries()) {
    const field = i === 0 ? 'end0' : 'end1';
    if ('node' in pick) {
      if (pick.node !== GROUND && !s.circuit.nodes.has(pick.node)) return { ok: false, reason: S.noNode(pick.node), field, value };
      written.push(pick.node === GROUND ? '0' : (s.circuit.nodes.get(pick.node)?.text ?? pick.node));
      words.push(pick.node === GROUND ? S.ground : S.node(nodeWords(s, pick.node)));
      continue;
    }
    const n = pick.fresh.trim();
    if (!NODE_NAME.test(n)) return { ok: false, reason: S.badName(n), field, value };
    const ground = n === '0' || n.toLowerCase() === 'gnd';
    written.push(ground ? '0' : n);
    words.push(ground ? S.ground : S.node(n));
  }
  let control = '';
  if (f.letter === 'E' || f.letter === 'G') {
    const nodeText = (n: string | undefined): string | undefined => (n === undefined ? undefined : n === GROUND ? '0' : s.circuit.nodes.get(n)?.text);
    const plus = nodeText(f.plus);
    const minus = nodeText(f.minus);
    if (plus === undefined || minus === undefined) return { ok: false, reason: t('formNoControl'), field: 'control', value };
    control = ` ${plus} ${minus}`;
  } else if (f.letter === 'F' || f.letter === 'H') {
    const source = s.circuit.parts.find((p) => p.key === f.source);
    if (!source) return { ok: false, reason: sourceChoices(s).length ? t('formNoSource') : S.noSource(f.letter), field: 'control', value };
    control = ` ${source.name}`;
  }
  // The value goes in only when SPICE reads it as one number there, as on a part's card; else the
  // checks' reason, and their fix when it is a value ("Write 4.7k").
  if (value.kind === 'empty') return { ok: false, reason: t('formBadValue'), field: 'value', value };
  if (value.kind === 'refused') return { ok: false, reason: value.reason, field: 'value', value, ...(value.fix ? { fix: value.fix } : {}) };
  const line = `${name} ${written[0]} ${written[1]}${control} ${f.value.trim()}`;
  return { ok: true, line, name, summary: S.added(name, words[0]!, words[1]!), value };
}

/**
 * The text with the form's part line added, as the Netlist panel would hold it: before the analysis
 * lines (on a page with no parts, after writing .op and .end: needsStarter). The drawing places the
 * new part where it fits and wires it (src/schematic: a part line without a position is placed
 * beside the drawing, or the whole circuit laid out when no part has one).
 */
export function addPartEdit(s: Schematic, f: PartForm): { ok: true; text: string; summary: string; key: string } | { ok: false; reason: string; field: FormField } {
  const line = formLine(s, f);
  if (!line.ok) return line;
  const starter = withStarter(s.netlist);
  const netlist = starter === undefined ? s.netlist : parseNetlist(starter);
  let text = applyChanges(netlist.text, [insertLine(netlist, line.line)]);
  // A circuit already drawn by hand (its *@ lines): the new part's place and wires go into those lines
  // in the same step, so the text says what is shown and the part never moves when other lines are typed.
  if (readDrawing(netlist).lineIndexes.length && !s.foreign.length) text = pinDrawing(text, s.options);
  return { ok: true, text, summary: starter === undefined ? line.summary : `${line.summary} ${starterWords()}`, key: line.name.toLowerCase() };
}

// ------------------------------------------------------------------ keys

/** What a key does on the drawing (or the parts toolbar), besides moving along the wires. */
export type EditKey =
  | { kind: 'turn' }
  | { kind: 'mirror' }
  | { kind: 'reverse' }
  | { kind: 'delete' }
  | { kind: 'add' }
  | { kind: 'move'; dir: Direction }
  | { kind: 'tool'; tool: Tool };

const ARROWS: Readonly<Record<string, Direction>> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/**
 * The editing keys (decision 0017): T turns, M mirrors, Shift+R reverses, Shift+arrows move one grid
 * step, Delete or Backspace deletes, A opens the Add a part form, and the tools' letters choose a
 * tool (R C L V I E F G H, W, 0). None of them uses Ctrl, Alt or Cmd: those belong to the browser
 * (Ctrl+R reloads, Alt+arrows go back and forward) and to screen readers. The page uses them only
 * while the drawing or the parts toolbar has the focus (WCAG 2.1.4).
 */
export function editKey(e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): EditKey | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey) return undefined;
  const k = e.key;
  const dir = ARROWS[k];
  if (dir) return e.shiftKey ? { kind: 'move', dir } : undefined;
  if (k === 'Delete' || k === 'Backspace') return { kind: 'delete' };
  const lower = k.length === 1 ? k.toLowerCase() : '';
  if (lower === 'r' && e.shiftKey) return { kind: 'reverse' };
  if (e.shiftKey && (lower === 't' || lower === 'm' || lower === 'a')) return undefined;
  if (lower === 't') return { kind: 'turn' };
  if (lower === 'm') return { kind: 'mirror' };
  if (lower === 'a') return { kind: 'add' };
  const tool = k.length === 1 ? toolForKey(k) : undefined;
  return tool ? { kind: 'tool', tool } : undefined;
}
