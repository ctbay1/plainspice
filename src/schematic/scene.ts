/**
 * The scene: what a renderer draws for a circuit and its drawing, in drawing coordinates. Symbols in
 * place with their pins, the words next to each part (name, value lines, and room for a result),
 * node names placed clear of everything else, junction dots, terminals, stubs and wire crossings.
 * Derived only from the circuit and the drawing, so the same drawing always gives the same scene.
 * Plain TypeScript: no DOM, no colours.
 *
 * Where words go:
 * - a part's words go on the side its placement stores (`PartPlacement.side`); otherwise on the
 *   right of an upright part and above a part lying on its side, on the other side for a mirrored
 *   part (left, below); when that side is taken, on the freest of the opposite side and the two
 *   sides across;
 * - a node's name goes at the spot its label stores (`NodeLabel.side`); otherwise at the first free
 *   spot next to its label point (above and right of a horizontal wire, left of a vertical one, on
 *   the far side of a terminal).
 *
 * Open ends: a node with one drawn pin ends in a terminal (an open circle), unless lines the drawing
 * does not show also name it (`CircuitNode.hidden`): its end is then a stub (the node goes on to
 * parts not drawn), and its name gets a line saying which ("to D1, X1").
 */
import type { Circuit, CircuitPart, HiddenRef } from './circuit.ts';
import { GROUND } from './circuit.ts';
import { SegmentIndex, findIslands, wireEnds } from './connectivity.ts';
import { groundGeometry, isUpright, partGeometry, valueLines, type Drawing, type GroundPlacement, type LabelSide, type NodeLabel, type NodeSpot, type SymbolGeometry } from './drawing.ts';
import {
  boxesOverlap,
  inflate,
  pointKey,
  samePoint,
  segmentCrossesBox,
  segmentsOf,
  transform,
  unionBoxes,
  type Box,
  type Direction,
  type Point,
  type Rotation,
} from './geometry.ts';
import { SYMBOLS, type PartLetter, type PinRole } from './symbols.ts';
import { TEXT, defaultMeasure, lineBox, stackLines, type LineSpec, type Measure, type TextLine } from './text.ts';

export type { LabelSide, NodeSpot } from './drawing.ts';

export interface SceneOptions {
  /** Keep room for a result next to each part and node name (a current, a node voltage). Default true. */
  results?: boolean;
  /** How wide a line of text is as the style draws it, in grid units (default: textWidth). */
  measure?: Measure;
  /**
   * The result lines kept under a part's values, each given as a sample of the widest text it will
   * hold (measured with the 'result' role). Default: one line, TEXT.resultChars. A style that writes
   * a source's power under its current asks for two lines there; [] keeps none.
   */
  resultRoom?: (part: CircuitPart) => readonly string[];
  /**
   * A node's result on its name's line, after the name ("s = 12 V"), instead of on a line of its
   * own: a sample of the widest text it will hold (measured with the 'result' role). The result
   * line then starts just after the name, aligned to its start, on the same row.
   */
  nodeResultInline?: string;
}

/** Words the scene writes, in one object so a Turkish UI can replace them later. */
export const SCENE_STRINGS = {
  /** Under a node's name: the parts on it that the drawing does not show. */
  hidden: (names: readonly string[]): string => `to ${names.join(', ')}`,
} as const;

export interface PlacedPin {
  at: Point;
  /** ngspice's node name. */
  node: string;
  /** The direction a wire leaves the pin in. */
  outward: Direction;
  role: PinRole;
}

export interface PlacedPart {
  key: string;
  name: string;
  letter: PartLetter;
  /** The part as the netlist says (its value, control, couplings, the parts that read its current ...). */
  part: CircuitPart;
  at: Point;
  rot: Rotation;
  mirror: boolean;
  pins: [PlacedPin, PlacedPin];
  /** The body without leads, and the whole symbol (pin to pin). */
  body: Box;
  box: Box;
  /** + and − marks to draw upright (V, E, H). */
  marks: { text: '+' | '−'; at: Point }[];
  /**
   * Where an arrow for the part's current goes, pointing the way a positive SPICE current flows (pin 0
   * into the part). For a source that an F or H reads (`part.sensedBy`), this is the direction of the
   * current they read.
   */
  arrow: { at: Point; direction: Direction };
  side: LabelSide;
  /** Name, value lines and (empty) result line. */
  labels: TextLine[];
  labelBox: Box;
}

export interface PlacedGround {
  index: number;
  at: Point;
  rot: Rotation;
  body: Box;
  box: Box;
}

export interface PlacedWire {
  points: Point[];
  /** The node it belongs to (undefined for a wire that touches no pin). */
  node?: string;
}

export interface PlacedNodeLabel {
  node: string;
  /** The name as written. */
  text: string;
  /** The point on the node's copper the name belongs to. */
  at: Point;
  spot: NodeSpot;
  /** The name line, a 'hidden' line when parts not drawn are on the node, and an empty result line. */
  lines: TextLine[];
  box: Box;
  /** Written at a terminal (an open end). */
  terminal: boolean;
  /** Parts on this node that the drawing does not show. */
  hidden: HiddenRef[];
}

export interface Terminal {
  node: string;
  at: Point;
}

/** Where a node goes on to parts the drawing does not show: a wire end pointing `direction`. */
export interface Stub {
  node: string;
  at: Point;
  direction: Direction;
  hidden: HiddenRef[];
  /** The room kept for its mark (an arrowhead, say): STUB_LENGTH on from the end, half as wide each side. */
  box: Box;
}

/** How far a stub's mark may reach on from the wire end, in grid units. */
export const STUB_LENGTH = 0.6;

function stubBox(at: Point, direction: Direction): Box {
  const h = STUB_LENGTH / 2;
  switch (direction) {
    case 'right':
      return { x0: at.x, y0: at.y - h, x1: at.x + STUB_LENGTH, y1: at.y + h };
    case 'left':
      return { x0: at.x - STUB_LENGTH, y0: at.y - h, x1: at.x, y1: at.y + h };
    case 'down':
      return { x0: at.x - h, y0: at.y, x1: at.x + h, y1: at.y + STUB_LENGTH };
    case 'up':
      return { x0: at.x - h, y0: at.y - STUB_LENGTH, x1: at.x + h, y1: at.y };
  }
}

export interface Scene {
  parts: PlacedPart[];
  grounds: PlacedGround[];
  wires: PlacedWire[];
  junctions: Point[];
  terminals: Terminal[];
  stubs: Stub[];
  /** Points where two wires cross without connecting (a style may draw a hop). */
  crossings: Point[];
  nodeLabels: PlacedNodeLabel[];
  bounds: Box;
}

const EMPTY_BOX: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };

/** The side words go on when nothing is in the way. */
export function defaultSide(rot: Rotation, mirror: boolean): LabelSide {
  return isUpright(rot) ? (mirror ? 'left' : 'right') : mirror ? 'below' : 'above';
}

const OTHER_SIDE: Readonly<Record<LabelSide, LabelSide>> = { right: 'left', left: 'right', above: 'below', below: 'above' };
/** Where a part's words may slide when no side is free: along the side, then a little further out, nearest first (grid squares). */
const SLIDES: readonly (readonly [number, number])[] = [
  [0.5, 0], [-0.5, 0], [1, 0], [-1, 0], [0, 0.5], [0.5, 0.5], [-0.5, 0.5], [1.5, 0], [-1.5, 0], [1, 0.5], [-1, 0.5], [0, 1], [2, 0], [-2, 0], [1, 1], [-1, 1],
];
const ACROSS: Readonly<Record<LabelSide, readonly LabelSide[]>> = { right: ['above', 'below'], left: ['above', 'below'], above: ['right', 'left'], below: ['right', 'left'] };

/** A part's lines: its name, its value lines, and the result lines (`room`: SceneOptions.resultRoom's samples; default one line). */
export function partLabelSpecs(part: CircuitPart, results: boolean, room?: readonly string[]): LineSpec[] {
  const specs: LineSpec[] = [{ text: part.name, role: 'name' }, ...valueLines(part).map((text) => ({ text, role: 'value' as const }))];
  if (results) {
    if (room === undefined) specs.push({ text: '', role: 'result' });
    else for (const sample of room) specs.push({ text: '', role: 'result', room: sample });
  }
  return specs;
}

/** The result lines a part keeps with these options: SceneOptions.resultRoom's samples, or undefined for the default line. */
export const resultRoomOf = (part: CircuitPart, options: SceneOptions): readonly string[] | undefined => options.resultRoom?.(part);

/** The lines of a part's words on one side of its body. */
export function partLabelLines(geom: SymbolGeometry, specs: readonly LineSpec[], side: LabelSide, measure: Measure = defaultMeasure): TextLine[] {
  const b = geom.body;
  switch (side) {
    case 'right':
      return stackLines(specs, { x: b.x1 + TEXT.gap, y: geom.at.y }, 'start', 'middle', measure);
    case 'left':
      return stackLines(specs, { x: b.x0 - TEXT.gap, y: geom.at.y }, 'end', 'middle', measure);
    case 'above':
      return stackLines(specs, { x: geom.at.x, y: b.y0 - TEXT.gap }, 'middle', 'bottom', measure);
    case 'below':
      return stackLines(specs, { x: geom.at.x, y: b.y1 + TEXT.gap }, 'middle', 'top', measure);
  }
}

const boxOfLines = (lines: readonly TextLine[]): Box => unionBoxes(lines.map((l) => l.box)) ?? EMPTY_BOX;

/** The side of the squares obstacles are filed in, in grid units. */
const CELL = 4;
/** A box covering more squares than this (a very long word, say) is checked by every look instead. */
const MAX_CELLS = 256;

/** The squares a box covers, or undefined when it covers more than MAX_CELLS (or is not finite). */
function cellsOf(b: Box): number[] | undefined {
  const x0 = Math.floor(b.x0 / CELL);
  const x1 = Math.floor(b.x1 / CELL);
  const y0 = Math.floor(b.y0 / CELL);
  const y1 = Math.floor(b.y1 / CELL);
  if (!((x1 - x0 + 1) * (y1 - y0 + 1) <= MAX_CELLS)) return undefined;
  const out: number[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(x * 65536 + y);
  return out;
}

/**
 * Things words must stay clear of, filed by the squares of the grid they cover, so that the cost of a
 * place for words looks only at what is near it (a drawing with a thousand names and wires is not a
 * thousand times slower to label than one with one).
 */
class Obstacles {
  readonly boxes: Box[] = [];
  /** For each box: a symbol (a part's or a ground symbol's), words, or soft (a junction's dot, a terminal, a stub's mark). */
  private readonly kinds: ObstacleKind[] = [];
  readonly segments: [Point, Point][] = [];
  /** What each square holds: box i as i, segment i as −1 − i; `big`: what covers too many squares to file. */
  private readonly cells = new Map<number, number[]>();
  private readonly big: number[] = [];

  private file(b: Box, id: number): void {
    const keys = cellsOf(b);
    if (!keys) {
      this.big.push(id);
      return;
    }
    for (const k of keys) {
      const list = this.cells.get(k);
      if (list) list.push(id);
      else this.cells.set(k, [id]);
    }
  }

  addBox(b: Box, kind: ObstacleKind = 'words'): number {
    const i = this.boxes.push(b) - 1;
    this.kinds.push(kind);
    this.file(b, i);
    return i;
  }

  addWire(points: readonly Point[]): void {
    for (const [a, b] of segmentsOf(points)) {
      const i = this.segments.push([a, b]) - 1;
      this.file({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }, -1 - i);
    }
  }

  /**
   * How much the box collides with what is there (0: free), leaving out box `skip` (a part's own
   * symbol), and with `solid`, the soft boxes too (what is left is what findOverlaps would call an
   * overlap). Boxes count first, then segments, each in the order they came, as one sum over all of
   * them would.
   */
  /** What is filed in the squares a box covers (and what covers too many squares to file), each once. */
  private near(box: Box): { boxes: number[]; segments: number[] } {
    const near = new Set<number>(this.big);
    const keys = cellsOf(box);
    if (keys) for (const k of keys) for (const id of this.cells.get(k) ?? []) near.add(id);
    else {
      this.boxes.forEach((_, i) => near.add(i));
      this.segments.forEach((_, i) => near.add(-1 - i));
    }
    const boxes: number[] = [];
    const segments: number[] = [];
    for (const id of near) (id >= 0 ? boxes : segments).push(id);
    boxes.sort((i, j) => i - j);
    segments.sort((i, j) => j - i);
    return { boxes, segments };
  }

  cost(box: Box, skip = -1, solid = false): number {
    const { boxes, segments } = this.near(box);
    let c = 0;
    for (const i of boxes) {
      const b = this.boxes[i]!;
      if (i !== skip && !(solid && this.kinds[i] === 'soft') && boxesOverlap(box, b)) c += 1 + overlapArea(box, b);
    }
    for (const id of segments) {
      const [a, b] = this.segments[-1 - id]!;
      if (segmentCrossesBox(a, b, box)) c += 1;
    }
    return c;
  }

  /** How much of the box lies on symbols (parts' and ground symbols'), in square grid units. */
  onSymbols(box: Box): number {
    let area = 0;
    for (const i of this.near(box).boxes) if (this.kinds[i] === 'symbol') area += overlapArea(box, this.boxes[i]!);
    return area;
  }
}

type ObstacleKind = 'symbol' | 'words' | 'soft';

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Far enough from a wire to clear the widest symbol on it (a source's circle). */
const FAR = 1.15;

/** How many points of its own copper a name tries, nearest first, when it has no room at its own. */
const NAME_MOVES = 40;

/** How far out from an open end (in grid units, one at a time) its name may go when it has no room at the end. */
const END_STEPS = 2;

const DIRECTION_STEP: Readonly<Record<Direction, Point>> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

/**
 * Where a node's name is written before it has a value: its own line, except on the left of its point
 * with the value on the same line (SceneOptions.nodeResultInline), where the pair is written up against
 * the point (notebook/results.ts, nameShift), so the name ends where the room for its value ends.
 */
function nameAsWritten(lines: readonly TextLine[], spot: NodeSpot): Box {
  const name = lines.find((l) => l.role === 'node');
  const result = lines.find((l) => l.role === 'result');
  if (!name) return boxOfLines(lines);
  if (!result || Math.abs(result.y - name.y) > 1e-9 || !spot.endsWith('left')) return name.box;
  const dx = result.box.x1 - name.box.x1;
  return { x0: name.box.x0 + dx, y0: name.box.y0, x1: name.box.x1 + dx, y1: name.box.y1 };
}

/** The space between a node's name and its result on the same line ("s = 12 V"), in grid units. */
export const INLINE_RESULT_GAP = 0.2;

/**
 * The lines of a node's name at a spot: the name nearest the wire, then the hidden parts, then the
 * result. With `inline` (SceneOptions.nodeResultInline) the result shares the name's line instead,
 * after the name: both lines are aligned to their start, the pair placed where a line as wide as
 * both would go, so the name never moves when the result's width changes.
 */
export function nodeLabelLines(text: string, at: Point, spot: NodeSpot, results: boolean, hidden: readonly string[] = [], measure: Measure = defaultMeasure, inline?: string): TextLine[] {
  if (results && inline !== undefined) return inlineNodeLines(text, at, spot, hidden, measure, inline);
  const name: LineSpec = { text, role: 'node' };
  const below: LineSpec[] = [name];
  if (hidden.length) below.push({ text: SCENE_STRINGS.hidden(hidden), role: 'hidden' });
  if (results) below.push({ text: '', role: 'result' });
  const above = below.slice().reverse();
  const off = 0.3;
  const lift = 0.2;
  switch (spot) {
    case 'above-right':
      return stackLines(above, { x: at.x + off, y: at.y - lift }, 'start', 'bottom', measure);
    case 'above-left':
      return stackLines(above, { x: at.x - off, y: at.y - lift }, 'end', 'bottom', measure);
    case 'below-right':
      return stackLines(below, { x: at.x + off, y: at.y + lift }, 'start', 'top', measure);
    case 'below-left':
      return stackLines(below, { x: at.x - off, y: at.y + lift }, 'end', 'top', measure);
    case 'right':
      return stackLines(below, { x: at.x + off + 0.1, y: at.y - TEXT.lineHeight / 2 }, 'start', 'top', measure);
    case 'left':
      return stackLines(below, { x: at.x - off - 0.1, y: at.y - TEXT.lineHeight / 2 }, 'end', 'top', measure);
    case 'far-right':
      return stackLines(below, { x: at.x + FAR, y: at.y - TEXT.lineHeight / 2 }, 'start', 'top', measure);
    case 'far-left':
      return stackLines(below, { x: at.x - FAR, y: at.y - TEXT.lineHeight / 2 }, 'end', 'top', measure);
  }
}

/** A node's name with its result on the same line, at the spots nodeLabelLines uses (same anchors, rows and sides). */
function inlineNodeLines(text: string, at: Point, spot: NodeSpot, hidden: readonly string[], measure: Measure, room: string): TextLine[] {
  const nameWidth = measure(text, 'node');
  const roomWidth = measure(room, 'result');
  const width = nameWidth + INLINE_RESULT_GAP + roomWidth;
  const hiddenText = hidden.length ? SCENE_STRINGS.hidden(hidden) : undefined;
  const lh = TEXT.lineHeight;
  const off = 0.3;
  const lift = 0.2;
  type Place = { x: number; y: number; align: 'start' | 'end'; from: 'top' | 'bottom' };
  const place = ((): Place => {
    switch (spot) {
      case 'above-right':
        return { x: at.x + off, y: at.y - lift, align: 'start', from: 'bottom' };
      case 'above-left':
        return { x: at.x - off, y: at.y - lift, align: 'end', from: 'bottom' };
      case 'below-right':
        return { x: at.x + off, y: at.y + lift, align: 'start', from: 'top' };
      case 'below-left':
        return { x: at.x - off, y: at.y + lift, align: 'end', from: 'top' };
      case 'right':
        return { x: at.x + off + 0.1, y: at.y - lh / 2, align: 'start', from: 'top' };
      case 'left':
        return { x: at.x - off - 0.1, y: at.y - lh / 2, align: 'end', from: 'top' };
      case 'far-right':
        return { x: at.x + FAR, y: at.y - lh / 2, align: 'start', from: 'top' };
      case 'far-left':
        return { x: at.x - FAR, y: at.y - lh / 2, align: 'end', from: 'top' };
    }
  })();
  // The name's row is the one nearest the wire: the bottom row above it, the top row below or beside it.
  const rows = hiddenText ? 2 : 1;
  const top = place.from === 'top' ? place.y : place.y - rows * lh;
  const nameRow = place.from === 'bottom' ? rows - 1 : 0;
  const y = top + lh * (nameRow + 0.5);
  const x0 = place.align === 'start' ? place.x : place.x - width;
  const rx = x0 + nameWidth + INLINE_RESULT_GAP;
  const lines: TextLine[] = [
    { text, role: 'node', x: x0, y, align: 'start', box: lineBox(x0, y, nameWidth, 'start') },
    { text: '', role: 'result', x: rx, y, align: 'start', box: lineBox(rx, y, roomWidth, 'start') },
  ];
  if (hiddenText) {
    const hy = top + lh * (1 - nameRow + 0.5);
    lines.push({ text: hiddenText, role: 'hidden', x: place.x, y: hy, align: place.align, box: lineBox(place.x, hy, measure(hiddenText, 'hidden'), place.align) });
  }
  return lines;
}

const OPPOSITE_DIRECTION: Readonly<Record<Direction, Direction>> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** Which ways the copper runs from a point: wires leaving it (`wires`: the drawing's, indexed), and pins' leads. */
function directionsAt(p: Point, wires: SegmentIndex, pins: readonly PlacedPin[]): Direction[] {
  const out = new Set<Direction>();
  for (const { a, b } of wires.at(p)) {
    for (const q of [a, b]) {
      if (samePoint(q, p)) continue;
      if (q.x === p.x) out.add(q.y < p.y ? 'up' : 'down');
      else if (q.y === p.y) out.add(q.x < p.x ? 'left' : 'right');
    }
  }
  // The lead runs from the pin into the part: opposite to its outward direction.
  for (const pin of pins) if (samePoint(pin.at, p)) out.add(OPPOSITE_DIRECTION[pin.outward]);
  return [...out];
}

function spotsFor(dirs: readonly Direction[], terminal: boolean): NodeSpot[] {
  const all: NodeSpot[] = ['above-right', 'above-left', 'below-right', 'below-left', 'right', 'left', 'far-left', 'far-right'];
  const first = (spots: NodeSpot[]): NodeSpot[] => [...spots, ...all.filter((s) => !spots.includes(s))];
  if (terminal && dirs.length === 1) {
    switch (dirs[0]) {
      case 'left':
        return first(['right', 'above-right', 'below-right']);
      case 'right':
        return first(['left', 'above-left', 'below-left']);
      case 'up':
        return first(['below-right', 'right', 'below-left']);
      case 'down':
        return first(['above-right', 'right', 'above-left']);
    }
  }
  const vertical = dirs.length > 0 && dirs.every((d) => d === 'up' || d === 'down');
  if (vertical) return first(['left', 'right', 'far-left', 'far-right']);
  return all;
}

/**
 * Points where a horizontal and a vertical wire segment cross, inside both (no end or corner there).
 * Each vertical segment looks only at the rows that have horizontal segments between its ends
 * (`index`: these wires, indexed, when already done).
 */
export function wireCrossings(wires: readonly (readonly Point[])[], index: SegmentIndex = new SegmentIndex(wires)): Point[] {
  const horizontal: [Point, Point][] = [];
  const vertical: [Point, Point][] = [];
  for (const w of wires) {
    for (const [a, b] of segmentsOf(w)) {
      if (a.y === b.y) horizontal.push([a, b]);
      else if (a.x === b.x) vertical.push([a, b]);
    }
  }
  const rows = [...new Set(horizontal.map(([a]) => a.y))].sort((p, q) => p - q);
  const out = new Map<string, Point>();
  for (const [a, b] of vertical) {
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    // The first row below y0, by halving.
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid]! <= y0) lo = mid + 1;
      else hi = mid;
    }
    for (let r = lo; r < rows.length && rows[r]! < y1; r++) {
      const at = { x: a.x, y: rows[r]! };
      if (index.at(at).some((s) => s.a.y === s.b.y && Math.min(s.a.x, s.b.x) < a.x && a.x < Math.max(s.a.x, s.b.x))) out.set(pointKey(at), at);
    }
  }
  return [...out.values()].sort((p, q) => p.y - q.y || p.x - q.x);
}

/**
 * Builds the scene for a circuit and a drawing. Parts without a place in the drawing are left out.
 * With `moveNames` (the scene a schematic keeps, schematic.ts), a node's name with no spot of its
 * own that touches a symbol, words or a wire at every spot around its point is written at the
 * nearest point of its own copper where it touches none; the scenes made along the way leave every
 * name at its point.
 */
export function buildScene(circuit: Circuit, drawing: Drawing, options: SceneOptions = {}, moveNames = false): Scene {
  const results = options.results ?? true;
  const measure = options.measure ?? defaultMeasure;
  const parts: PlacedPart[] = [];
  const geoms: { part: CircuitPart; geom: SymbolGeometry; side?: LabelSide }[] = [];
  for (const part of circuit.parts) {
    const p = drawing.parts.get(part.key);
    if (p) geoms.push(p.side ? { part, geom: partGeometry(part, p), side: p.side } : { part, geom: partGeometry(part, p) });
  }
  const grounds: PlacedGround[] = drawing.grounds.map((g: GroundPlacement, index) => {
    const geom = groundGeometry(g);
    return { index, at: g.at, rot: g.rot, body: geom.body, box: geom.box };
  });

  const obstacles = new Obstacles();
  for (const { geom } of geoms) obstacles.addBox(geom.box, 'symbol');
  for (const g of grounds) obstacles.addBox(g.box, 'symbol');
  for (const w of drawing.wires) obstacles.addWire(w);

  for (const { part, geom, side: stored } of geoms) {
    const specs = partLabelSpecs(part, results, resultRoomOf(part, options));
    const first = stored ?? defaultSide(geom.rot, geom.mirror);
    // The part's own symbol is not in the way of its words.
    const own = obstacles.boxes.indexOf(geom.box);
    const costLines = (lines: TextLine[]): number => obstacles.cost(boxOfLines(lines), own);
    const costOf = (side: LabelSide): { lines: TextLine[]; cost: number } => {
      const lines = partLabelLines(geom, specs, side, measure);
      return { lines, cost: costLines(lines) };
    };
    let side = first;
    let chosen = costOf(first);
    // In the way: the opposite side, then the two sides across. A side the drawing stores (side=) is
    // kept: the lines say what the page shows (an edit that puts something on it lets it go, edit.ts).
    if (chosen.cost > 0 && !stored) {
      for (const next of [OTHER_SIDE[first], ...ACROSS[first]]) {
        const other = costOf(next);
        if (other.cost < chosen.cost) {
          side = next;
          chosen = other;
        }
        if (chosen.cost === 0) break;
      }
    }
    // No side free (a crowded drawing, a part just turned or moved): the words slide along a side, or
    // step out from it a little, to the nearest place where they touch nothing (never more than two
    // squares), rather than sit on a wire or on other words; else the least-bad place found.
    if (chosen.cost > 0 && !stored) {
      for (const next of [side, ...[first, OTHER_SIDE[first], ...ACROSS[first]].filter((x) => x !== side)]) {
        const lines = partLabelLines(geom, specs, next, measure);
        const across = next === 'above' || next === 'below';
        const out = next === 'right' || next === 'below' ? 1 : -1;
        for (const [along, away] of SLIDES) {
          const dx = across ? along : out * away;
          const dy = across ? out * away : along;
          const moved = lines.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy, box: { x0: l.box.x0 + dx, y0: l.box.y0 + dy, x1: l.box.x1 + dx, y1: l.box.y1 + dy } }));
          // Never onto its own symbol (which the cost leaves out, as the words start beside it).
          if (boxesOverlap(boxOfLines(moved), geom.box)) continue;
          const cost = costLines(moved);
          if (cost < chosen.cost) {
            side = next;
            chosen = { lines: moved, cost };
          }
          if (chosen.cost === 0) break;
        }
        if (chosen.cost === 0) break;
      }
    }
    const labelBox = boxOfLines(chosen.lines);
    obstacles.addBox(labelBox);
    const def = SYMBOLS[part.letter];
    const arrowLocal = def.arrow ?? { x: 0, y: -1.5 };
    parts.push({
      key: part.key,
      name: part.name,
      letter: part.letter,
      part,
      at: geom.at,
      rot: geom.rot,
      mirror: geom.mirror,
      pins: [0, 1].map((i) => ({ at: geom.pins[i]!, node: part.nodes[i]!, outward: geom.outward[i]!, role: geom.roles[i]! })) as [PlacedPin, PlacedPin],
      body: geom.body,
      box: geom.box,
      marks: def.marks.map((m) => ({ text: m.text, at: transform(m.at, geom.at, geom.rot, geom.mirror) })),
      arrow: { at: transform(arrowLocal, geom.at, geom.rot, geom.mirror), direction: geom.outward[1]! },
      side,
      labels: chosen.lines,
      labelBox,
    });
  }

  const pinPoints: Point[] = [...parts.flatMap((p) => p.pins.map((q) => q.at)), ...grounds.map((g) => g.at)];
  const allPins: PlacedPin[] = [
    ...parts.flatMap((p) => p.pins),
    ...grounds.map((g) => ({ at: g.at, node: GROUND, outward: groundGeometry(g).outward[0]!, role: 'ground' as PinRole })),
  ];
  // The wires indexed once, for everything below that looks up what is at a point.
  const wireIndex = new SegmentIndex(drawing.wires);
  const { junctions, dangling } = wireEnds(wireIndex, pinPoints);

  // Which node each wire belongs to: the node of the pins on its island.
  const islands = findIslands(drawing.wires, allPins.map((p) => p.at), wireIndex);
  const islandNode = new Map<number, string | null>();
  allPins.forEach((p, i) => {
    const island = islands.anchors[i]!;
    const known = islandNode.get(island);
    if (known === undefined) islandNode.set(island, p.node);
    else if (known !== p.node) islandNode.set(island, null);
  });
  const wires: PlacedWire[] = drawing.wires.map((points, i) => {
    const node = islandNode.get(islands.wires[i]!);
    return node ? { points, node } : { points };
  });

  // Open ends: a labelled wire end that touches nothing, and the end of a node with one pin. A node
  // that lines not drawn also name ends in a stub instead of a terminal.
  const hiddenOf = (node: string): HiddenRef[] => circuit.nodes.get(node)?.hidden ?? [];
  const terminals: Terminal[] = [];
  const stubs: Stub[] = [];
  const endKeys = new Set<string>();
  const addEnd = (node: string, at: Point): void => {
    if (endKeys.has(pointKey(at))) return;
    endKeys.add(pointKey(at));
    const hidden = hiddenOf(node);
    if (!hidden.length) {
      terminals.push({ node, at });
      return;
    }
    const dirs = directionsAt(at, wireIndex, allPins);
    const direction = dirs.length === 1 ? OPPOSITE_DIRECTION[dirs[0]!] : 'right';
    stubs.push({ node, at, direction, hidden, box: stubBox(at, direction) });
  };
  const danglingKeys = new Set(dangling.map(pointKey));
  for (const label of drawing.labels) if (danglingKeys.has(pointKey(label.at))) addEnd(label.node, label.at);
  for (const node of circuit.nodes.values()) {
    if (node.ground || node.pins.length !== 1) continue;
    const ref = node.pins[0]!;
    const placed = parts.find((p) => p.key === ref.part);
    if (!placed) continue;
    const pin = placed.pins[ref.pin]!;
    if (terminals.some((t) => t.node === node.name) || stubs.some((t) => t.node === node.name)) continue;
    const island = islands.at(pin.at);
    const end = dangling.find((d) => islands.at(d) === island);
    addEnd(node.name, end ?? pin.at);
  }
  for (const j of junctions) obstacles.addBox(inflate({ x0: j.x, y0: j.y, x1: j.x, y1: j.y }, 0.2), 'soft');
  for (const t of terminals) obstacles.addBox(inflate({ x0: t.at.x, y0: t.at.y, x1: t.at.x, y1: t.at.y }, 0.25), 'soft');
  for (const t of stubs) obstacles.addBox(inflate(t.box, 0.05), 'soft');

  const nodeLabels: PlacedNodeLabel[] = [];
  const terminalKeys = new Set(terminals.map((t) => pointKey(t.at)));
  const stubKeys = new Set(stubs.map((t) => pointKey(t.at)));
  type Placing = { lines: TextLine[]; cost: number; spot: NodeSpot };
  /**
   * A name's lines at the spots around a point, tried in order: the first that touches nothing, else
   * the least in the way (`best`); and, with `withClear`, the least in the way of those that touch no
   * symbol, words or wire, only a junction's dot or a terminal (`clear`), if any.
   */
  const placeName = (text: string, at: Point, spots: readonly NodeSpot[], names: readonly string[], withClear: boolean): { best: Placing; clear?: Placing } => {
    let best: Placing | undefined;
    let clear: Placing | undefined;
    for (const spot of spots) {
      const lines = nodeLabelLines(text, at, spot, results, names, measure, options.nodeResultInline);
      const box = boxOfLines(lines);
      const cost = obstacles.cost(box);
      if (!best || cost < best.cost) best = { lines, cost, spot };
      if (cost === 0) return { best, clear: best };
      if (withClear && obstacles.cost(box, -1, true) === 0 && (!clear || cost < clear.cost)) clear = { lines, cost, spot };
    }
    return clear ? { best: best!, clear } : { best: best! };
  };
  /**
   * The points a name may move to on its own piece of copper, nearest first (at most NAME_MOVES):
   * the grid points of the piece's wires and its pins, but not where another piece's wire crosses
   * (the name would read as that node's) and not at an open end (a terminal or a stub has its own name).
   */
  const pointsOfPiece = (label: NodeLabel): Point[] => {
    const own = islands.allAt(label.at).filter((i) => {
      const n = islandNode.get(i);
      return n === undefined || n === label.node;
    });
    if (own.length !== 1) return [];
    const piece = own[0]!;
    const seen = new Set<string>([pointKey(label.at)]);
    const out: Point[] = [];
    const add = (q: Point): void => {
      const k = pointKey(q);
      if (seen.has(k) || terminalKeys.has(k) || stubKeys.has(k)) return;
      seen.add(k);
      if (islands.allAt(q).some((i) => i !== piece)) return;
      out.push(q);
    };
    drawing.wires.forEach((w, i) => {
      if (islands.wires[i] !== piece) return;
      for (const [a, b] of segmentsOf(w)) {
        if (a.x !== b.x && a.y !== b.y) {
          add(a);
          add(b);
          continue;
        }
        const n = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
        for (let k = 0; k <= n; k++) add({ x: a.x + (Math.sign(b.x - a.x) * k), y: a.y + (Math.sign(b.y - a.y) * k) });
      }
    });
    allPins.forEach((p, i) => {
      if (islands.anchors[i] === piece) add(p.at);
    });
    const far = (q: Point): number => Math.abs(q.x - label.at.x) + Math.abs(q.y - label.at.y);
    return out.sort((p, q) => far(p) - far(q) || p.y - q.y || p.x - q.x).slice(0, NAME_MOVES);
  };
  const stubAt = new Map(stubs.map((t) => [pointKey(t.at), t]));
  /**
   * A name at an open end with no clear spot there (student:label-on-part, critic of the fix round):
   * it marks that end, so its point stays; the same spots are tried one and then two grid units
   * further out, the way a wire would leave the end, and the first clear one is taken. When none is,
   * the least bad of all those places: where the name as it is written before it has a value lies
   * least on a symbol, then where the room kept for its value does, then the least in the way, the
   * nearest first.
   */
  const placeAtEnd = (text: string, at: Point, spots: readonly NodeSpot[], names: readonly string[]): Placing => {
    const stub = stubAt.get(pointKey(at));
    const dirs = stub ? [] : directionsAt(at, wireIndex, allPins);
    const out = stub ? stub.direction : dirs.length === 1 ? OPPOSITE_DIRECTION[dirs[0]!] : undefined;
    const step = out ? DIRECTION_STEP[out] : { x: 0, y: 0 };
    const away = (k: number): Point => ({ x: at.x + step.x * k, y: at.y + step.y * k });
    const far = out ? END_STEPS : 0;
    for (let k = 1; k <= far; k++) {
      const there = placeName(text, away(k), spots, names, true);
      if (there.clear) return there.clear;
    }
    let best: { placing: Placing; written: number; room: number } | undefined;
    for (let k = 0; k <= far; k++) {
      for (const spot of spots) {
        const lines = nodeLabelLines(text, away(k), spot, results, names, measure, options.nodeResultInline);
        const box = boxOfLines(lines);
        const c = { placing: { lines, cost: obstacles.cost(box), spot }, written: obstacles.onSymbols(nameAsWritten(lines, spot)), room: obstacles.onSymbols(box) };
        if (!best || c.written < best.written || (c.written === best.written && (c.room < best.room || (c.room === best.room && c.placing.cost < best.placing.cost)))) best = c;
      }
    }
    return best!.placing;
  };
  for (const label of drawing.labels) {
    const node = circuit.nodes.get(label.node);
    const text = node?.text ?? label.node;
    const hidden = node?.hidden ?? [];
    const names = [...new Set(hidden.map((h) => h.name))];
    const terminal = terminalKeys.has(pointKey(label.at));
    const atEnd = terminal || stubKeys.has(pointKey(label.at));
    const spots = label.side ? [label.side] : spotsFor(directionsAt(label.at, wireIndex, allPins), atEnd);
    const moving = moveNames && !label.side;
    const here = placeName(text, label.at, spots, names, moving);
    let at = label.at;
    let chosen = moving ? (here.clear ?? here.best) : here.best;
    // A name with no spot of its own (side=) that touches a symbol, words or a wire at every spot
    // around its point (after a wire joined two nodes, it may sit on a part) moves along its own
    // piece of copper to the nearest point where it touches none (student:label-on-part); build()
    // then writes it there. A name at an open end marks that end, so it stays (placeAtEnd).
    if (moving && !here.clear && atEnd) chosen = placeAtEnd(text, label.at, spots, names);
    if (moving && !here.clear && !atEnd) {
      for (const q of pointsOfPiece(label)) {
        const there = placeName(text, q, spotsFor(directionsAt(q, wireIndex, allPins), false), names, true);
        if (!there.clear) continue;
        at = q;
        chosen = there.clear;
        break;
      }
    }
    const box = boxOfLines(chosen.lines);
    obstacles.addBox(box);
    nodeLabels.push({ node: label.node, text, at, spot: chosen.spot, lines: chosen.lines, box, terminal, hidden });
  }

  const bounds =
    unionBoxes([
      ...parts.map((p) => p.box),
      ...parts.map((p) => p.labelBox),
      ...grounds.map((g) => g.box),
      ...nodeLabels.map((l) => l.box),
      ...stubs.map((t) => t.box),
      ...drawing.wires.flatMap((w) => w.map((p) => ({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }))),
    ]) ?? EMPTY_BOX;
  return { parts, grounds, wires, junctions, terminals, stubs, crossings: wireCrossings(drawing.wires, wireIndex), nodeLabels, bounds };
}

// ------------------------------------------------------------------ overlaps

export interface SceneItem {
  kind: 'part' | 'part-label' | 'ground' | 'node-label' | 'wire';
  /** Part key, ground or wire index, or node name. */
  id: string;
}

export interface Overlap {
  a: SceneItem;
  b: SceneItem;
}

/**
 * Everything that collides: symbols with symbols, wires crossing symbols, words on symbols, on
 * wires or on other words. A clean drawing has none.
 */
export function findOverlaps(scene: Scene): Overlap[] {
  const out: Overlap[] = [];
  const symbols: { item: SceneItem; box: Box }[] = [
    ...scene.parts.map((p) => ({ item: { kind: 'part' as const, id: p.key }, box: p.box })),
    ...scene.grounds.map((g) => ({ item: { kind: 'ground' as const, id: String(g.index) }, box: g.box })),
  ];
  const words: { item: SceneItem; box: Box }[] = [
    ...scene.parts.map((p) => ({ item: { kind: 'part-label' as const, id: p.key }, box: p.labelBox })),
    ...scene.nodeLabels.map((l, i) => ({ item: { kind: 'node-label' as const, id: `${l.node}#${i}` }, box: l.box })),
  ];
  const segments = scene.wires.flatMap((w, i) => segmentsOf(w.points).map((s) => ({ item: { kind: 'wire' as const, id: String(i) }, s })));
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      if (boxesOverlap(symbols[i]!.box, symbols[j]!.box)) out.push({ a: symbols[i]!.item, b: symbols[j]!.item });
    }
    for (const w of segments) if (segmentCrossesBox(w.s[0], w.s[1], symbols[i]!.box)) out.push({ a: symbols[i]!.item, b: w.item });
    for (const t of words) if (boxesOverlap(symbols[i]!.box, t.box)) out.push({ a: symbols[i]!.item, b: t.item });
  }
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      if (boxesOverlap(words[i]!.box, words[j]!.box)) out.push({ a: words[i]!.item, b: words[j]!.item });
    }
    for (const w of segments) if (segmentCrossesBox(w.s[0], w.s[1], words[i]!.box)) out.push({ a: words[i]!.item, b: w.item });
  }
  return out;
}
