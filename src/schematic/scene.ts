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
import { danglingEnds, findIslands, junctionPoints } from './connectivity.ts';
import { groundGeometry, isUpright, partGeometry, valueLines, type Drawing, type GroundPlacement, type LabelSide, type NodeSpot, type SymbolGeometry } from './drawing.ts';
import {
  boxesOverlap,
  inflate,
  pointKey,
  pointOnSegment,
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
import { TEXT, defaultMeasure, stackLines, type LineSpec, type Measure, type TextLine } from './text.ts';

export type { LabelSide, NodeSpot } from './drawing.ts';

export interface SceneOptions {
  /** Keep room for a result next to each part and node name (a current, a node voltage). Default true. */
  results?: boolean;
  /** How wide a line of text is as the style draws it, in grid units (default: textWidth). */
  measure?: Measure;
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
const ACROSS: Readonly<Record<LabelSide, readonly LabelSide[]>> = { right: ['above', 'below'], left: ['above', 'below'], above: ['right', 'left'], below: ['right', 'left'] };

export function partLabelSpecs(part: CircuitPart, results: boolean): LineSpec[] {
  const specs: LineSpec[] = [{ text: part.name, role: 'name' }, ...valueLines(part).map((text) => ({ text, role: 'value' as const }))];
  if (results) specs.push({ text: '', role: 'result' });
  return specs;
}

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

/** Things words must stay clear of. */
class Obstacles {
  readonly boxes: Box[] = [];
  readonly segments: [Point, Point][] = [];

  addBox(b: Box): void {
    this.boxes.push(b);
  }

  addWire(points: readonly Point[]): void {
    for (const s of segmentsOf(points)) this.segments.push(s);
  }

  /** How much the box collides with what is there (0: free). */
  cost(box: Box): number {
    let c = 0;
    for (const b of this.boxes) {
      if (boxesOverlap(box, b)) c += 1 + overlapArea(box, b);
    }
    for (const [a, b] of this.segments) if (segmentCrossesBox(a, b, box)) c += 1;
    return c;
  }
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Far enough from a wire to clear the widest symbol on it (a source's circle). */
const FAR = 1.15;

/** The lines of a node's name at a spot: the name nearest the wire, then the hidden parts, then the result. */
export function nodeLabelLines(text: string, at: Point, spot: NodeSpot, results: boolean, hidden: readonly string[] = [], measure: Measure = defaultMeasure): TextLine[] {
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

const OPPOSITE_DIRECTION: Readonly<Record<Direction, Direction>> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** Which ways the copper runs from a point: wires leaving it, and pins' leads. */
function directionsAt(p: Point, wires: readonly (readonly Point[])[], pins: readonly PlacedPin[]): Direction[] {
  const out = new Set<Direction>();
  for (const w of wires) {
    for (const [a, b] of segmentsOf(w)) {
      if (!pointOnSegment(p, a, b)) continue;
      for (const q of [a, b]) {
        if (samePoint(q, p)) continue;
        if (q.x === p.x) out.add(q.y < p.y ? 'up' : 'down');
        else if (q.y === p.y) out.add(q.x < p.x ? 'left' : 'right');
      }
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

/** Points where a horizontal and a vertical wire segment cross, inside both (no end or corner there). */
export function wireCrossings(wires: readonly (readonly Point[])[]): Point[] {
  const horizontal: [Point, Point][] = [];
  const vertical: [Point, Point][] = [];
  for (const w of wires) {
    for (const [a, b] of segmentsOf(w)) {
      if (a.y === b.y) horizontal.push([a, b]);
      else if (a.x === b.x) vertical.push([a, b]);
    }
  }
  const out = new Map<string, Point>();
  for (const [a, b] of vertical) {
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    for (const [c, d] of horizontal) {
      const x0 = Math.min(c.x, d.x);
      const x1 = Math.max(c.x, d.x);
      if (c.y > y0 && c.y < y1 && a.x > x0 && a.x < x1) out.set(pointKey({ x: a.x, y: c.y }), { x: a.x, y: c.y });
    }
  }
  return [...out.values()].sort((p, q) => p.y - q.y || p.x - q.x);
}

/** Builds the scene for a circuit and a drawing. Parts without a place in the drawing are left out. */
export function buildScene(circuit: Circuit, drawing: Drawing, options: SceneOptions = {}): Scene {
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
  for (const { geom } of geoms) obstacles.addBox(geom.box);
  for (const g of grounds) obstacles.addBox(g.box);
  for (const w of drawing.wires) obstacles.addWire(w);

  for (const { part, geom, side: stored } of geoms) {
    const specs = partLabelSpecs(part, results);
    const first = stored ?? defaultSide(geom.rot, geom.mirror);
    // The part's own symbol is not in the way of its words.
    const own = obstacles.boxes.indexOf(geom.box);
    const costOf = (side: LabelSide): { lines: TextLine[]; cost: number } => {
      const lines = partLabelLines(geom, specs, side, measure);
      const box = boxOfLines(lines);
      let cost = 0;
      obstacles.boxes.forEach((b, i) => {
        if (i !== own && boxesOverlap(box, b)) cost += 1 + overlapArea(box, b);
      });
      for (const [a, b] of obstacles.segments) if (segmentCrossesBox(a, b, box)) cost += 1;
      return { lines, cost };
    };
    let side = first;
    let chosen = costOf(first);
    // In the way: the opposite side, then the two sides across.
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
  const junctions = junctionPoints(drawing.wires, pinPoints);
  const dangling = danglingEnds(drawing.wires, pinPoints);

  // Which node each wire belongs to: the node of the pins on its island.
  const islands = findIslands(drawing.wires, allPins.map((p) => p.at));
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
    const dirs = directionsAt(at, drawing.wires, allPins);
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
  for (const j of junctions) obstacles.addBox(inflate({ x0: j.x, y0: j.y, x1: j.x, y1: j.y }, 0.2));
  for (const t of terminals) obstacles.addBox(inflate({ x0: t.at.x, y0: t.at.y, x1: t.at.x, y1: t.at.y }, 0.25));
  for (const t of stubs) obstacles.addBox(inflate(t.box, 0.05));

  const nodeLabels: PlacedNodeLabel[] = [];
  const terminalKeys = new Set(terminals.map((t) => pointKey(t.at)));
  const stubKeys = new Set(stubs.map((t) => pointKey(t.at)));
  for (const label of drawing.labels) {
    const node = circuit.nodes.get(label.node);
    const text = node?.text ?? label.node;
    const hidden = node?.hidden ?? [];
    const names = [...new Set(hidden.map((h) => h.name))];
    const terminal = terminalKeys.has(pointKey(label.at));
    const atEnd = terminal || stubKeys.has(pointKey(label.at));
    const spots = label.side ? [label.side] : spotsFor(directionsAt(label.at, drawing.wires, allPins), atEnd);
    let best: { lines: TextLine[]; cost: number; spot: NodeSpot } | undefined;
    for (const spot of spots) {
      const lines = nodeLabelLines(text, label.at, spot, results, names, measure);
      const cost = obstacles.cost(boxOfLines(lines));
      if (!best || cost < best.cost) best = { lines, cost, spot };
      if (cost === 0) break;
    }
    const lines = best!.lines;
    const box = boxOfLines(lines);
    obstacles.addBox(box);
    nodeLabels.push({ node: label.node, text, at: label.at, spot: best!.spot, lines, box, terminal, hidden });
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
  return { parts, grounds, wires, junctions, terminals, stubs, crossings: wireCrossings(drawing.wires), nodeLabels, bounds };
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
