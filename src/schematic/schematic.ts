/**
 * A netlist and its drawing, kept in step: `buildSchematic` reads the netlist and its drawing lines
 * (or a drawing kept elsewhere), places what has no place, and repairs the wires so the drawing
 * connects exactly what the netlist connects. The netlist always wins: drawing lines never change
 * the circuit. It never throws and never takes long, whatever the lines say. Plain TypeScript: no DOM.
 *
 * - No positions at all: the whole circuit is laid out (layout.ts).
 * - Some positions: those are kept. When the lines give only positions and the automatic layout
 *   agrees with all of them up to a shift, the whole layout is used, shifted onto them. Otherwise one
 *   or two missing parts are placed next to their nodes, and more are laid out together beside the
 *   given ones, then wired to them.
 * - Wires that join different nodes (after a node was renamed in the text, say) are cut where the
 *   odd pin touches them; wire ends that then lead nowhere are removed (a labelled end stays: it is
 *   a terminal); pins of one node left apart are joined by new wires (or, when no route exists, by
 *   writing the node's name at each piece); a circuit with ground gets a ground symbol if it has
 *   none; every node gets its name written once on each piece of copper.
 * - Positions of parts the netlist does not have, and labels of nodes it does not have, are kept as
 *   written (a part may be half typed) and reported, until the next change made in the drawing
 *   (edit.ts drops them). When exactly one part of a letter lost its position line and one new part
 *   of that letter has none, the position moves to it (a renamed part) if that place is still free.
 *   A label whose node is gone names the node now on its copper, when that node has no label (a
 *   node renamed in the text).
 * - Lines of another version's drawing are kept where they are and not used (format.ts).
 */
import { lowerAscii, parseNetlist } from '../spice/parse.ts';
import type { Netlist } from '../spice/types.ts';
import { circuitFromNetlist, GROUND, labelNode, subCircuit, type Circuit } from './circuit.ts';
import { SegmentIndex, checkConnectivity, drawnPins, findIslands, type ConnectivityProblem, type DrawnPin, type Islands } from './connectivity.ts';
import { NODE_SPOTS, cloneDrawing, cloneLabel, emptyDrawing, groundGeometry, partGeometry, symbolGeometry, type Drawing, type NodeLabel, type PartPlacement } from './drawing.ts';
import { parseDrawingLines, readDrawing, type DrawingLines, type DrawingProblem, type PositionLine } from './format.ts';
import { boxesOverlap, inflate, isOrthogonal, manhattan, pointKey, pt, samePoint, segmentCrossesBox, segmentsOf, unionBoxes, type Box, type Direction, type Point } from './geometry.ts';
import { autoLayout, layOut, placeParts, type LayoutOptions } from './layout.ts';
import { ROUTE_COSTS, findRoute, type RouteEnd } from './route.ts';
import { buildScene, nodeLabelLines, type Scene } from './scene.ts';
import { cutAt, normalizeWires, pruneDangling, toSegments, type Segment } from './wires.ts';

export interface SchematicOptions extends LayoutOptions {
  /**
   * Drawing lines kept outside the netlist (a share link, say), as `readDrawing` or
   * `parseDrawingLines` returns them. When given, drawing lines inside the netlist are ignored.
   */
  lines?: DrawingLines;
}

export interface Schematic {
  netlist: Netlist;
  circuit: Circuit;
  /** The drawing, complete and in step with the netlist: what the drawing lines should say. */
  drawing: Drawing;
  scene: Scene;
  /** auto: laid out; given: every position came from the drawing lines; partial: some did. */
  origin: 'auto' | 'given' | 'partial';
  /** What was wrong with the drawing lines, and what PlainSpice changed. */
  problems: DrawingProblem[];
  /** Drawing lines to keep as written when the lines are written again (lines PlainSpice cannot read or use). */
  kept: string[];
  /**
   * Position lines of parts, and label lines of nodes, that the netlist does not have (yet), as
   * written: kept while the text changes, dropped by the next change made in the drawing.
   */
  orphans: string[];
  /** Lines of another version's drawing, kept as written and not used: while there are any, edits that change the drawing are refused. */
  foreign: { line: number; text: string }[];
  /** What it was built with (edits use the same). */
  options: LayoutOptions;
}

const EMPTY_LINES = (): DrawingLines => parseDrawingLines([]);

const BUILD_STRINGS = {
  failed: 'PlainSpice could not use the drawing lines, so the circuit is laid out again; the next change made in the drawing replaces them.',
  layoutFailed: 'PlainSpice could not draw this circuit.',
  renamed: (from: string, to: string): string => `The position of ${from} now belongs to ${to}: no part is called ${from}, and ${to} had no position.`,
  unknownPart: (name: string, line: number): string => `No part is called ${name}, so its position on line ${line} is kept but not used.`,
  unknownLabel: (node: string, line: number): string => `No node is called ${node}, so the name written on line ${line} is kept but not used.`,
  labelRenamed: (from: string, to: string): string => `The name ${from} on the drawing now names node ${to}: no node is called ${from}, and ${to} had no name there.`,
  placed: (names: readonly string[]): string => `${names.join(', ')} had no position, so PlainSpice placed ${names.length === 1 ? 'it' : 'them'}.`,
} as const;

/** Builds the schematic for a netlist (text or parsed). Never throws. */
export function buildSchematic(input: string | Netlist, options: SchematicOptions = {}): Schematic {
  const netlist = typeof input === 'string' ? parseNetlist(input) : input;
  const circuit = circuitFromNetlist(netlist);
  const { lines: outside, ...layoutOptions } = options;
  const lines = outside ?? readDrawing(netlist);
  try {
    return build(netlist, circuit, lines, layoutOptions);
  } catch {
    // A last resort, should a drawing line still trip something: lay the circuit out again, and let
    // the next change made in the drawing replace the lines.
    const written = [...lines.parts.values()].map((p) => p.text);
    try {
      const s = build(netlist, circuit, EMPTY_LINES(), layoutOptions);
      s.orphans = [...written, ...lines.labels.map((l) => l.text)];
      s.kept = lines.unreadable.map((u) => u.text);
      s.foreign = lines.foreign.slice();
      s.problems.unshift({ kind: 'drawing-failed', severity: 'warning', message: BUILD_STRINGS.failed });
      return s;
    } catch {
      const drawing = emptyDrawing();
      const scene = buildScene(circuit, drawing, layoutOptions);
      return {
        netlist,
        circuit,
        drawing,
        scene,
        origin: 'auto',
        problems: [{ kind: 'drawing-failed', severity: 'warning', message: BUILD_STRINGS.layoutFailed }],
        kept: lines.unreadable.map((u) => u.text),
        orphans: written,
        foreign: lines.foreign.slice(),
        options: layoutOptions,
      };
    }
  }
}

const placementOf = (p: PositionLine): PartPlacement => (p.side ? { at: p.at, rot: p.rot, mirror: p.mirror, side: p.side } : { at: p.at, rot: p.rot, mirror: p.mirror });

function build(netlist: Netlist, circuit: Circuit, lines: DrawingLines, options: LayoutOptions): Schematic {
  const problems: DrawingProblem[] = [...lines.problems];
  const kept = lines.unreadable.map((u) => u.text);
  const orphans: string[] = [];
  const keys = new Set(circuit.parts.map((p) => p.key));

  const given = new Map<string, PartPlacement>();
  const unknown: { key: string; pos: PositionLine }[] = [];
  for (const [key, pos] of lines.parts) {
    if (keys.has(key)) given.set(key, placementOf(pos));
    else unknown.push({ key, pos });
  }
  const base = (): Drawing => {
    const d = emptyDrawing();
    for (const [k, p] of given) d.parts.set(k, p);
    d.grounds = lines.grounds.map((g) => ({ at: g.at, rot: g.rot }));
    // The copper merged once, before anything looks at it: wire drawn over wire (a share link may
    // repeat one piece two thousand times) becomes one piece, so no later step sees the repeats.
    d.wires = normalizeWires(lines.wires);
    d.labels = lines.labels.map((l) => {
      const node = labelNode(circuit, l.node);
      return l.side ? { node, at: l.at, side: l.side } : { node, at: l.at };
    });
    return d;
  };

  // A renamed part: one position line without its part, one part of the same letter without a
  // position, and the place still free.
  const unplaced = circuit.parts.filter((p) => !given.has(p.key));
  for (const o of unknown.slice()) {
    const letter = o.key[0];
    const candidates = unplaced.filter((p) => p.key[0] === letter);
    if (unknown.filter((x) => x.key[0] === letter).length !== 1 || candidates.length !== 1) continue;
    const part = candidates[0]!;
    const placement = placementOf(o.pos);
    if (!placeIsFree(circuit, base(), part.key, placement, options)) continue;
    given.set(part.key, placement);
    unknown.splice(unknown.indexOf(o), 1);
    unplaced.splice(unplaced.indexOf(part), 1);
    problems.push({ kind: 'renamed-part', severity: 'info', line: o.pos.line, message: BUILD_STRINGS.renamed(o.pos.name, part.name) });
  }
  for (const o of unknown) {
    orphans.push(o.pos.text);
    problems.push({ kind: 'unknown-part', severity: 'warning', line: o.pos.line, message: BUILD_STRINGS.unknownPart(o.pos.name, o.pos.line) });
  }

  let drawing: Drawing;
  let origin: Schematic['origin'];
  if (given.size === 0) {
    drawing = autoLayout(circuit, options);
    origin = 'auto';
  } else {
    drawing = base();
    drawing.labels = labelsInStep(circuit, drawing, lines, problems, orphans);
    origin = given.size === circuit.parts.length ? 'given' : 'partial';
    const missing = circuit.parts.filter((p) => !given.has(p.key));
    if (missing.length) {
      const onlyPositions = !lines.wires.length && !lines.grounds.length && !lines.labels.length;
      const shifted = onlyPositions ? shiftedLayout(circuit, given, options) : undefined;
      if (shifted) drawing = shifted;
      else if (missing.length <= 2) placeParts(circuit, drawing, missing.map((p) => p.key), options);
      else layOutBeside(circuit, drawing, new Set(missing.map((p) => p.key)), options);
      problems.push({ kind: 'placed-part', severity: 'info', message: BUILD_STRINGS.placed(missing.map((p) => p.name)) });
    }
  }
  drawing = reconcile(circuit, drawing, problems, options);
  const scene = buildScene(circuit, drawing, options, true);
  // A name the scene wrote at another point of its copper (it had no room at its own, scene.ts) is
  // kept there, so the lines written next say what the page shows (the scene stays the same).
  scene.nodeLabels.forEach((placed, i) => {
    const label = drawing.labels[i];
    if (label && !samePoint(label.at, placed.at)) drawing.labels[i] = { ...cloneLabel(label), at: placed.at };
  });
  return { netlist, circuit, drawing, scene, origin, problems, kept, orphans, foreign: lines.foreign.slice(), options };
}

/** True when a part could stand at a placement: its symbol and words clear of the other symbols, and no pin on another node's copper. */
function placeIsFree(circuit: Circuit, drawing: Drawing, key: string, placement: PartPlacement, options: LayoutOptions): boolean {
  const part = circuit.parts.find((p) => p.key === key);
  if (!part) return false;
  const scene = buildScene(circuit, drawing, options);
  const geom = partGeometry(part, placement);
  const own = new Set(geom.pins.map(pointKey));
  for (const p of scene.parts) if (boxesOverlap(inflate(geom.box, 0.2), p.box) || boxesOverlap(geom.box, p.labelBox)) return false;
  for (const g of scene.grounds) if (boxesOverlap(geom.box, g.box)) return false;
  for (const l of scene.nodeLabels) if (boxesOverlap(geom.box, l.box)) return false;
  for (const w of scene.wires) {
    for (const [a, b] of segmentsOf(w.points)) if (segmentCrossesBox(a, b, geom.box) && !(own.has(pointKey(a)) && own.has(pointKey(b)))) return false;
  }
  const pins = drawnPins(circuit, drawing);
  const islands = findIslands(drawing.wires, pins.map((p) => p.at));
  const nodeOf = new Map<number, string>();
  pins.forEach((p, i) => nodeOf.set(islands.anchors[i]!, p.node));
  return geom.pins.every((at, i) => {
    const island = islands.at(at);
    const there = island === undefined ? undefined : nodeOf.get(island);
    return there === undefined || there === part.nodes[i];
  });
}

/**
 * The labels of a given drawing, in step with the netlist: a label whose node is gone names the node
 * now on its copper when that node has no label (a node renamed in the text); other labels of nodes
 * the netlist does not have become orphans, kept as written.
 */
function labelsInStep(circuit: Circuit, drawing: Drawing, lines: DrawingLines, problems: DrawingProblem[], orphans: string[]): NodeLabel[] {
  // The copper's islands and their nodes, worked out only if some label's node is gone.
  let found: { islands: Islands; nodesOn: Map<number, Set<string>> } | undefined;
  const copper = (): { islands: Islands; nodesOn: Map<number, Set<string>> } => {
    if (found) return found;
    const pins = drawnPins(circuit, drawing);
    const islands = findIslands(drawing.wires, pins.map((p) => p.at));
    const nodesOn = new Map<number, Set<string>>();
    pins.forEach((p, i) => (nodesOn.get(islands.anchors[i]!) ?? nodesOn.set(islands.anchors[i]!, new Set()).get(islands.anchors[i]!)!).add(p.node));
    return (found = { islands, nodesOn });
  };
  const labelled = new Set(drawing.labels.filter((l) => circuit.nodes.has(l.node)).map((l) => l.node));
  const out: NodeLabel[] = [];
  drawing.labels.forEach((label, i) => {
    if (circuit.nodes.has(label.node) || (label.node === GROUND && circuit.hasGround)) {
      out.push(label);
      return;
    }
    const line = lines.labels[i];
    const { islands, nodesOn } = copper();
    const island = islands.at(label.at);
    const nodes = island === undefined ? undefined : nodesOn.get(island);
    const only = nodes && nodes.size === 1 ? [...nodes][0]! : undefined;
    if (only !== undefined && only !== GROUND && !labelled.has(only)) {
      labelled.add(only);
      out.push({ ...cloneLabel(label), node: only });
      problems.push({ kind: 'label-renamed', severity: 'info', line: line?.line ?? 0, message: BUILD_STRINGS.labelRenamed(label.node, circuit.nodes.get(only)?.text ?? only) });
      return;
    }
    if (line) {
      orphans.push(line.text);
      problems.push({ kind: 'unknown-label', severity: 'warning', line: line.line, message: BUILD_STRINGS.unknownLabel(label.node, line.line) });
    }
  });
  return out;
}

/**
 * The automatic layout shifted onto the given positions, when it puts every given part the same way
 * round and all at the same offset (a drawing that gives only some positions of a circuit PlainSpice
 * would draw that way anyway); otherwise undefined.
 */
function shiftedLayout(circuit: Circuit, given: ReadonlyMap<string, PartPlacement>, options: LayoutOptions): Drawing | undefined {
  const full = autoLayout(circuit, options);
  let offset: Point | undefined;
  for (const [key, p] of given) {
    const auto = full.parts.get(key);
    if (!auto || auto.rot !== p.rot || auto.mirror !== p.mirror) return undefined;
    const d = pt(p.at.x - auto.at.x, p.at.y - auto.at.y);
    if (offset && !samePoint(offset, d)) return undefined;
    offset = d;
  }
  if (!offset) return undefined;
  const o = offset;
  const move = (q: Point): Point => pt(q.x + o.x, q.y + o.y);
  const out = emptyDrawing();
  for (const [key, p] of full.parts) out.parts.set(key, given.get(key) ?? { at: move(p.at), rot: p.rot, mirror: p.mirror });
  out.grounds = full.grounds.map((g) => ({ at: move(g.at), rot: g.rot }));
  out.wires = full.wires.map((w) => w.map(move));
  out.labels = full.labels.map((l) => ({ ...cloneLabel(l), at: move(l.at) }));
  return out;
}

/**
 * Lays out the parts without a position together (as their own small circuit) and sets the result
 * beside the given drawing, to its right; wiring them to the given parts is left to `reconcile`. The
 * group's top rail starts at the first node it shares with the given parts, level with that node's
 * copper there, so the joining wire runs straight. Labels of nodes the given drawing already has
 * copper of are left out, so they are joined by wires rather than by name.
 */
function layOutBeside(circuit: Circuit, drawing: Drawing, keys: ReadonlySet<string>, options: LayoutOptions): void {
  const sub = subCircuit(circuit, keys);
  const pins = drawnPins(circuit, drawing);
  const shared = new Set(pins.map((p) => p.node));
  for (const l of drawing.labels) shared.add(l.node);
  const start = [...sub.nodes.keys()].find((n) => n !== GROUND && shared.has(n));
  const laid = layOut(sub, options, start);
  const here = buildScene(circuit, drawing, options).bounds;
  const there = buildScene(sub, laid, options).bounds;
  const dx = Math.ceil(here.x1 + 3 - there.x0);
  // The start node's highest copper in the given drawing: a pin pointing up meets a rail just above it.
  let railY: number | undefined;
  if (start !== undefined) {
    const copper = copperOf(circuit, drawing, toSegments(drawing.wires)).get(start) ?? [];
    const scene = buildScene(circuit, drawing, options);
    const up = new Set(scene.parts.flatMap((p) => p.pins.filter((q) => q.outward === 'up').map((q) => pointKey(q.at))));
    for (const q of copper) {
      const y = up.has(pointKey(q)) ? q.y - 1 : q.y;
      if (railY === undefined || y < railY) railY = y;
    }
  }
  const dy = railY !== undefined ? railY : Math.round(here.y0 - there.y0);
  const move = (q: Point): Point => pt(q.x + dx, q.y + dy);
  for (const [key, p] of laid.parts) drawing.parts.set(key, { at: move(p.at), rot: p.rot, mirror: p.mirror });
  drawing.grounds.push(...laid.grounds.map((g) => ({ at: move(g.at), rot: g.rot })));
  drawing.wires.push(...laid.wires.map((w) => w.map(move)));
  drawing.labels.push(...laid.labels.filter((l) => !shared.has(l.node)).map((l) => ({ ...cloneLabel(l), at: move(l.at) })));
}

/**
 * Makes a drawing connect exactly what the circuit connects (see the module comment), and returns
 * it. `problems` gets a note for each repair.
 */
export function reconcile(circuit: Circuit, input: Drawing, problems: DrawingProblem[] = [], options: LayoutOptions = {}): Drawing {
  const drawing = cloneDrawing(input);
  for (const key of drawing.parts.keys()) if (!circuit.parts.some((p) => p.key === key)) drawing.parts.delete(key);
  let segs: Segment[] = toSegments(drawing.wires).filter(([a, b]) => !samePoint(a, b));
  if (segs.some(([a, b]) => !isOrthogonal(a, b))) {
    problems.push({ kind: 'slanted-wire', severity: 'warning', message: 'Some wires are slanted; they are kept, but they connect only at their ends.' });
  }
  // The wires as given, to tell at the end whether repairs redrew them.
  const givenSegs = segs.slice();
  const pinsOf = (): DrawnPin[] => drawnPins(circuit, drawing);
  const nodeOrder = new Map([...circuit.nodes.keys()].map((n, i) => [n, i]));

  // 1. Pins of different nodes touching: a part whose pin sits on another node's pin moves.
  for (let round = 0; round < circuit.parts.length + 1; round++) {
    const pins = pinsOf();
    const byPoint = new Map<string, DrawnPin[]>();
    for (const p of pins) (byPoint.get(pointKey(p.at)) ?? byPoint.set(pointKey(p.at), []).get(pointKey(p.at))!).push(p);
    const clash = [...byPoint.values()].find((list) => new Set(list.map((p) => p.node)).size > 1);
    if (!clash) break;
    const mover = clash.slice().reverse().find((p) => p.part !== undefined);
    if (!mover?.part) {
      const g = clash.find((p) => p.ground !== undefined);
      if (g?.ground !== undefined) drawing.grounds.splice(g.ground, 1);
      continue;
    }
    const part = circuit.parts.find((p) => p.key === mover.part)!;
    drawing.parts.delete(part.key);
    placeParts(circuit, { ...drawing, wires: segs }, [part.key], options);
    problems.push({ kind: 'moved-part', severity: 'info', message: `${part.name} was moved: a pin of it touched a pin of another node.` });
  }

  // 2. Islands joining different nodes: cut the odd pins loose (the most common node keeps the wires).
  let cut = false;
  for (let round = 0; round < 50; round++) {
    const pins = pinsOf();
    const islands = findIslands(segs, pins.map((p) => p.at));
    const members = new Map<number, DrawnPin[]>();
    pins.forEach((p, i) => (members.get(islands.anchors[i]!) ?? members.set(islands.anchors[i]!, []).get(islands.anchors[i]!)!).push(p));
    let changed = false;
    for (const list of members.values()) {
      const counts = new Map<string, number>();
      for (const p of list) counts.set(p.node, (counts.get(p.node) ?? 0) + 1);
      if (counts.size < 2) continue;
      const major = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] === GROUND ? -1 : b[0] === GROUND ? 1 : 0) || (nodeOrder.get(a[0]) ?? 0) - (nodeOrder.get(b[0]) ?? 0))[0]![0];
      const removeGrounds: number[] = [];
      for (const p of list) {
        if (p.node === major) continue;
        if (p.ground !== undefined) removeGrounds.push(p.ground);
        else segs = cutAt(segs, p.at);
      }
      for (const gi of removeGrounds.sort((a, b) => b - a)) {
        drawing.grounds.splice(gi, 1);
        problems.push({ kind: 'ground-removed', severity: 'info', message: 'A ground symbol on wires of another node was removed.' });
      }
      changed = true;
      cut = true;
      break;
    }
    if (!changed) break;
    segs = pruneDangling(segs, pinsOf().map((p) => p.at), drawing.labels.map((l) => l.at));
  }

  // 3. Labels: on their node's copper, else moved onto it (when close) or dropped; then one name per
  //    piece of copper (ground's name is its symbol, so a "0" label where a ground symbol is goes).
  {
    const pins = pinsOf();
    const islands = findIslands(segs, pins.map((p) => p.at));
    const islandNodes = new Map<number, Set<string>>();
    const grounded = new Set<number>();
    pins.forEach((p, i) => {
      const island = islands.anchors[i]!;
      (islandNodes.get(island) ?? islandNodes.set(island, new Set()).get(island)!).add(p.node);
      if (p.ground !== undefined) grounded.add(island);
    });
    // Each node's copper, worked out only if a label must move onto it.
    let copper: Map<string, Point[]> | undefined;
    const onCopper: NodeLabel[] = [];
    for (const label of drawing.labels) {
      const known = circuit.nodes.has(label.node);
      const island = islands.at(label.at);
      const nodes = island === undefined ? undefined : islandNodes.get(island);
      const fine = known && island !== undefined && (!nodes || nodes.size === 0 || nodes.has(label.node));
      if (fine) {
        onCopper.push(label);
        continue;
      }
      copper ??= known ? copperOf(circuit, drawing, segs, islands) : undefined;
      const near = known ? nearest(copper?.get(label.node) ?? [], label.at, 2) : undefined;
      if (near) {
        onCopper.push({ ...cloneLabel(label), at: near });
        problems.push({ kind: 'label-moved', severity: 'info', message: `The name of node ${label.node} was moved onto its node's wire.` });
      } else {
        problems.push({ kind: 'label-dropped', severity: 'info', message: `The name of node ${label.node} at ${label.at.x},${label.at.y} was dropped: ${known ? 'it is not on that node' : 'the netlist has no such node'}.` });
      }
    }
    const named = new Set<string>();
    const keepLabels: NodeLabel[] = [];
    for (const label of onCopper) {
      const island = islands.at(label.at);
      const key = `${label.node}@${island ?? pointKey(label.at)}`;
      if (label.node === GROUND && island !== undefined && grounded.has(island)) {
        problems.push({ kind: 'label-dropped', severity: 'info', message: 'A label 0 was dropped: a ground symbol already names that wire.' });
        continue;
      }
      if (named.has(key)) {
        if (!keepLabels.some((l) => l.node === label.node && samePoint(l.at, label.at))) {
          problems.push({ kind: 'label-dropped', severity: 'info', message: `The name of node ${label.node} at ${label.at.x},${label.at.y} was dropped: ${label.node} is already named on that wire.` });
        }
        continue;
      }
      named.add(key);
      keepLabels.push(label);
    }
    drawing.labels = keepLabels;
  }

  // 4. Wires touching no pin, no ground and no label go; then ends leading nowhere.
  {
    const pins = pinsOf();
    const anchors = [...pins.map((p) => p.at), ...drawing.labels.map((l) => l.at)];
    const islands = findIslands(segs, anchors);
    const useful = new Set(islands.anchors);
    segs = segs.filter((_, i) => useful.has(islands.wires[i]!));
    segs = pruneDangling(segs, pins.map((p) => p.at), drawing.labels.map((l) => l.at));
  }

  // 5. Join the pieces of each node, within a fixed amount of searching (the same every time).
  let routed = false;
  let named = false;
  const budget = { left: ROUTING_STEPS };
  let obstacles: Obstacles | undefined;
  for (const node of circuit.nodes.keys()) {
    for (let guard = 0; guard < 64; guard++) {
      const { groups, islands } = groupsOf(circuit, drawing, segs, node);
      if (groups.length <= 1) break;
      obstacles ??= obstaclesOf(circuit, drawing, segs, options);
      const path = budget.left > 0 ? routeBetween(circuit, drawing, segs, node, groups, obstacles, budget, islands) : undefined;
      if (path && path.length < 2) break;
      if (path) {
        for (let i = 1; i < path.length; i++) segs.push([path[i - 1]!, path[i]!]);
        routed = true;
        continue;
      }
      // No route: mark each piece, which connects them by name: a ground symbol for ground, else the node's name.
      for (const g of groups) {
        if (g.labelled) continue;
        const pin = g.pins[0]!;
        if (node === GROUND) drawing.grounds.push({ at: pin.at, rot: groundRotAt(circuit, drawing, pin) });
        else drawing.labels.push({ node, at: pin.at });
      }
      named = true;
      break;
    }
  }
  if (named) problems.push({ kind: 'connected-by-name', severity: 'info', message: 'Some pieces of a node could not be connected by a wire, so the node name is written on each piece: pieces with the same name are connected.' });

  // 6. Ground: a circuit with ground gets a ground symbol when it has none (after the wiring, so it
  //    goes under the finished ground wire rather than in its way).
  if (circuit.hasGround && drawing.grounds.length === 0) {
    const spot = groundSpot(circuit, drawing, segs, options);
    if (spot) {
      if (spot.lead) segs.push(spot.lead);
      drawing.grounds.push({ at: spot.at, rot: 0 });
      problems.push({ kind: 'ground-added', severity: 'info', message: 'A ground symbol was added: the circuit has ground (node 0) and the drawing had none.' });
      // Its symbol names that copper now: a "0" label there goes.
      const pins = pinsOf();
      const islands = findIslands(segs, pins.map((p) => p.at));
      const grounded = new Set(pins.flatMap((p, i) => (p.ground !== undefined ? [islands.anchors[i]!] : [])));
      drawing.labels = drawing.labels.filter((l) => l.node !== GROUND || !grounded.has(islands.at(l.at) ?? -1));
    }
  }

  // 7. Every node's name once (ground has its symbol), where it fits.
  {
    const labelled = new Set(drawing.labels.map((l) => l.node));
    const pins = pinsOf();
    const missing = [...circuit.nodes.values()].filter((n) => !n.ground && !labelled.has(n.name));
    if (missing.length) {
      const scene = buildScene(circuit, { ...drawing, wires: normalizeWires(segs) }, options);
      const taken: Box[] = [];
      for (const node of missing) {
        const at = labelPoint(circuit, node.name, pins, segs, scene, taken, options);
        drawing.labels.push({ node: node.name, at });
        const lines = nodeLabelLines(node.text, at, 'above-right', options.results ?? true, [], options.measure, options.nodeResultInline);
        const box = unionBoxes(lines.map((l) => l.box));
        if (box) taken.push(box);
      }
    }
  }

  // The copper as it will be written, merged. Merging pieces that lie on each other (a cut can leave
  // a slanted piece on top of another) can leave an end that only the copy kept from leading
  // nowhere: it is cut too, so that reading the lines back gives this same drawing.
  drawing.wires = normalizeWires(segs);
  for (let round = 0; round < 8; round++) {
    const settled = normalizeWires(pruneDangling(toSegments(drawing.wires), pinsOf().map((p) => p.at), drawing.labels.map((l) => l.at)));
    if (sameWires(settled, drawing.wires)) break;
    drawing.wires = settled;
  }
  if ((cut || routed) && redrawn(givenSegs, drawing.wires)) {
    problems.push({ kind: 'wires-redrawn', severity: 'info', message: 'Some wires were redrawn so that the drawing connects what the netlist connects.' });
  }
  return drawing;
}

/** True when two lists of polylines are the same, point for point. */
function sameWires(a: readonly (readonly Point[])[], b: readonly (readonly Point[])[]): boolean {
  return a.length === b.length && a.every((w, i) => w.length === b[i]!.length && w.every((p, j) => samePoint(p, b[i]![j]!)));
}

/**
 * True when the wires now (merged) differ from the wires as given. A different amount of copper
 * (grid steps covered, on the grid) settles it at once; otherwise the given wires are merged and
 * compared.
 */
function redrawn(given: readonly Segment[], now: readonly (readonly Point[])[]): boolean {
  const steps = (segs: readonly (readonly [Point, Point])[]): number => {
    const seen = new Set<string>();
    for (const [a, b] of segs) {
      const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      const g = isOrthogonal(a, b) ? n : gcdOf(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      const dx = (b.x - a.x) / g;
      const dy = (b.y - a.y) / g;
      for (let k = 0; k < g; k++) {
        const p = pt(a.x + dx * k, a.y + dy * k);
        const q = pt(p.x + dx, p.y + dy);
        seen.add(p.x < q.x || (p.x === q.x && p.y < q.y) ? `${pointKey(p)} ${pointKey(q)}` : `${pointKey(q)} ${pointKey(p)}`);
      }
    }
    return seen.size;
  };
  const nowSegs = now.flatMap((w) => segmentsOf(w));
  const whole = [...given, ...nowSegs].every(([a, b]) => [a.x, a.y, b.x, b.y].every(Number.isInteger));
  if (whole && steps(given) !== steps(nowSegs)) return true;
  return !sameWires(now, normalizeWires(given));
}

const gcdOf = (m: number, n: number): number => {
  while (n) [m, n] = [n, m % n];
  return m;
};

/** Copper points of each node: pins, ground pins and every grid point of its wires (`islands`: of these segments and pins, when already found). */
function copperOf(circuit: Circuit, drawing: Drawing, segs: readonly Segment[], known?: Islands): Map<string, Point[]> {
  const pins = drawnPins(circuit, drawing);
  const islands = known ?? findIslands(segs, pins.map((p) => p.at));
  const nodeOfIsland = new Map<number, string>();
  pins.forEach((p, i) => nodeOfIsland.set(islands.anchors[i]!, p.node));
  const out = new Map<string, Point[]>();
  const add = (n: string, p: Point): void => {
    (out.get(n) ?? out.set(n, []).get(n)!).push(p);
  };
  for (const p of pins) add(p.node, p.at);
  segs.forEach((s, i) => {
    const node = nodeOfIsland.get(islands.wires[i]!);
    if (node !== undefined) for (const p of gridPoints(s)) add(node, p);
  });
  return out;
}

function gridPoints([a, b]: Segment): Point[] {
  const out: Point[] = [];
  if (a.x === b.x) for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) out.push(pt(a.x, y));
  else if (a.y === b.y) for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) out.push(pt(x, a.y));
  else out.push(a, b);
  return out;
}

function nearest(points: readonly Point[], p: Point, within: number): Point | undefined {
  let best: Point | undefined;
  let d = Infinity;
  for (const q of points) {
    const e = manhattan(p, q);
    if (e < d) {
      d = e;
      best = q;
    }
  }
  return best && d <= within ? best : undefined;
}

interface Group {
  pins: DrawnPin[];
  islands: Set<number>;
  labelled: boolean;
}

/** The pieces of a node: islands of its pins, joined where ground symbols or labels join them by name (and the islands they were found from). */
function groupsOf(circuit: Circuit, drawing: Drawing, segs: readonly Segment[], node: string): { groups: Group[]; islands: Islands } {
  const pins = drawnPins(circuit, drawing);
  const islands = findIslands(segs, pins.map((p) => p.at));
  const named = new Set<number>();
  for (const l of drawing.labels) {
    if (l.node !== node) continue;
    const i = islands.at(l.at);
    if (i !== undefined) named.add(i);
  }
  if (node === GROUND) pins.forEach((p, i) => p.ground !== undefined && named.add(islands.anchors[i]!));
  const groups: Group[] = [];
  const byName: Group = { pins: [], islands: new Set(), labelled: true };
  const byIsland = new Map<number, Group>();
  pins.forEach((p, i) => {
    if (p.node !== node) return;
    const island = islands.anchors[i]!;
    if (named.has(island)) {
      if (!groups.includes(byName)) groups.push(byName);
      byName.pins.push(p);
      byName.islands.add(island);
      return;
    }
    let g = byIsland.get(island);
    if (!g) {
      g = { pins: [], islands: new Set([island]), labelled: false };
      byIsland.set(island, g);
      groups.push(g);
    }
    g.pins.push(p);
  });
  return { groups, islands };
}

/**
 * Work all the routes of one schematic may do together (route.ts, RouteBudget); then pieces are
 * joined by name. The examples need none, a dense 150-part mesh about 170 000; this keeps a
 * hostile drawing line's cost to a few hundred milliseconds.
 */
const ROUTING_STEPS = 250_000;

/** What new wires go around: symbols (walls) and words (avoided, with whose words they are), and where pins point. */
interface Obstacles {
  walls: Box[];
  avoid: Box[];
  /** For each box of `avoid`: the nodes its words belong to (a node's name; a part's words: the nodes of its pins). */
  avoidNodes: ReadonlySet<string>[];
  bounds: Box;
  outward: Map<string, { at: Point; outward: Direction; node: string }[]>;
}

function obstaclesOf(circuit: Circuit, drawing: Drawing, segs: readonly Segment[], options: LayoutOptions): Obstacles {
  const scene = buildScene(circuit, { ...drawing, wires: normalizeWires(segs) }, options);
  const outward = new Map<string, { at: Point; outward: Direction; node: string }[]>();
  const add = (at: Point, dir: Direction, node: string): void => {
    (outward.get(pointKey(at)) ?? outward.set(pointKey(at), []).get(pointKey(at))!).push({ at, outward: dir, node });
  };
  for (const part of scene.parts) for (const pin of part.pins) add(pin.at, pin.outward, pin.node);
  for (const g of scene.grounds) add(g.at, groundGeometry(g).outward[0]!, GROUND);
  return {
    walls: [...scene.parts.map((p) => p.box), ...scene.grounds.map((g) => g.box)],
    avoid: [...scene.parts.map((p) => p.labelBox), ...scene.nodeLabels.map((l) => l.box)],
    avoidNodes: [...scene.parts.map((p) => new Set(p.pins.map((q) => q.node))), ...scene.nodeLabels.map((l) => new Set([l.node]))],
    bounds: inflate(scene.bounds, 6),
    outward,
  };
}

/** A new wire from the first piece of a node to the nearest other piece, or undefined (`islands`: of these segments and the drawing's pins, as groupsOf found them). */
function routeBetween(circuit: Circuit, drawing: Drawing, segs: readonly Segment[], node: string, groups: readonly Group[], obstacles: Obstacles, budget: { left: number }, islands: Islands): Point[] | undefined {
  const pins = drawnPins(circuit, drawing);
  const pinOutward = new Map<string, RouteEnd>();
  for (const [k, list] of obstacles.outward) {
    const own = list.find((x) => x.node === node);
    if (own) pinOutward.set(k, { at: own.at, outward: own.outward });
  }
  // Points where a wire ends or another pin sits: a route may leave a pin there sideways, at a cost.
  const wired = new Set(segs.flatMap((s) => [pointKey(s[0]), pointKey(s[1])]));
  const pinCount = new Map<string, number>();
  for (const p of pins) pinCount.set(pointKey(p.at), (pinCount.get(pointKey(p.at)) ?? 0) + 1);
  for (const [k, n] of pinCount) if (n > 1) wired.add(k);
  const ends = (group: Group): RouteEnd[] => {
    const out: RouteEnd[] = [];
    segs.forEach((s, i) => {
      if (group.islands.has(islands.wires[i]!)) for (const p of gridPoints(s)) out.push({ at: p });
    });
    for (const p of group.pins) {
      const pin = pinOutward.get(pointKey(p.at));
      // A pin that already has a wire may be left sideways, at a cost; a bare pin only along its lead.
      // A pin with no wire yet is best left along its lead; across it (an L at the pin) costs more.
      out.push(pin ? (wired.has(pointKey(p.at)) ? { ...pin, soft: true } : { ...pin, sideCost: ROUTE_COSTS.bareSide }) : { at: p.at });
    }
    return out;
  };
  const sources = ends(groups[0]!);
  const targets = groups.slice(1).flatMap(ends);
  const ownIslands = new Set(groups.flatMap((g) => [...g.islands]));
  const foreignWires = segs.filter((_, i) => !ownIslands.has(islands.wires[i]!)).map((s) => [s[0], s[1]]);
  // Other nodes' pins, and the points their names are written at (a wire through one would leave the
  // name on a crossing of two nodes' wires).
  const foreignPins = [...pins.filter((p) => p.node !== node).map((p) => p.at), ...drawing.labels.filter((l) => l.node !== node).map((l) => l.at)];
  const span = (points: readonly Point[], margin: number): Box => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return { x0: x0 - margin, y0: y0 - margin, x1: x1 + margin, y1: y1 + margin };
  };
  // The words of the node itself (its name, the words of the parts on it) are not avoided: the scene
  // places them again around the new wire, where a detour round them would snake (critique of step B).
  const avoid = obstacles.avoid.filter((_, i) => !obstacles.avoidNodes[i]!.has(node));
  // First near the two pieces, then over the whole drawing.
  const near = span([...sources, ...targets].map((e) => e.at), 8);
  const all = segs.flatMap(([a, b]) => [a, b]);
  const whole = span([...all, { x: obstacles.bounds.x0, y: obstacles.bounds.y0 }, { x: obstacles.bounds.x1, y: obstacles.bounds.y1 }], 4);
  for (const bounds of [near, whole]) {
    if (budget.left <= 0) return undefined;
    const limits = { steps: budget.left, used: 0 };
    const path = findRoute({ walls: obstacles.walls, avoid, foreignWires, foreignPins, bounds }, sources, targets, limits);
    budget.left -= limits.used;
    if (path) return path;
  }
  return undefined;
}

/** A ground symbol drawn at a pin points away from its part. */
function groundRotAt(circuit: Circuit, drawing: Drawing, pin: DrawnPin): 0 | 90 | 180 | 270 {
  const part = pin.part === undefined ? undefined : circuit.parts.find((p) => p.key === pin.part);
  const placed = part ? drawing.parts.get(part.key) : undefined;
  const out = part && placed ? partGeometry(part, placed).outward[pin.pin] : 'down';
  return out === 'down' ? 0 : out === 'left' ? 90 : out === 'up' ? 180 : 270;
}

/**
 * A place for a ground symbol (bars down) on node 0's copper: below its lowest free pin or wire
 * point, clear of symbols and words, and with no wire through it. When no point is clear (a ground
 * rail drawn straight through the pins and then turned for a phone stands upright, so it runs through
 * any symbol hung on it), the symbol hangs on a one-unit lead below the lowest end of ground's copper
 * that has room, best where the lead goes straight on from a wire coming down (no new bend), as the
 * automatic layout's ground rail ends; the lead is returned to be drawn. Else the least bad point.
 */
function groundSpot(circuit: Circuit, drawing: Drawing, segs: readonly Segment[], options: LayoutOptions): { at: Point; lead?: Segment } | undefined {
  const wires = normalizeWires(segs);
  const scene = buildScene(circuit, { ...drawing, wires }, options);
  const boxes: Box[] = [...scene.parts.map((p) => p.box), ...scene.parts.map((p) => p.labelBox), ...scene.grounds.map((g) => g.box), ...scene.nodeLabels.map((l) => l.box)];
  const lines = wires.flatMap((w) => segmentsOf(w));
  const symbols: Box[] = [...scene.parts.map((p) => p.box), ...scene.grounds.map((g) => g.box)];
  /** Clear of the symbols, of words too unless `wordsMove` (words are placed afresh around a new symbol), and of the wires. */
  const symbolClear = (at: Point, wordsMove = false): boolean => {
    const box = symbolGeometry('ground', at, 0, false).box;
    return !(wordsMove ? symbols : boxes).some((b) => boxesOverlap(inflate(box, 0.1), b)) && !lines.some(([a, b]) => segmentCrossesBox(a, b, box));
  };
  const candidates: Point[] = [];
  for (const part of scene.parts) for (const pin of part.pins) if (pin.node === GROUND && pin.outward === 'down') candidates.push(pin.at);
  const copper = copperOf(circuit, drawing, segs).get(GROUND) ?? [];
  candidates.push(...copper);
  candidates.sort((a, b) => b.y - a.y || a.x - b.x);
  for (const c of candidates) if (symbolClear(c)) return { at: c };
  // A lead from an end of ground's copper: its wire ends and its pins, where nothing runs on below.
  const index = new SegmentIndex(wires);
  const pinAt = new Set(scene.parts.flatMap((p) => p.pins.map((q) => pointKey(q.at))));
  const pinDown = new Set(scene.parts.flatMap((p) => p.pins.filter((q) => q.outward === 'down').map((q) => pointKey(q.at))));
  const ends: { at: Point; straight: boolean }[] = [];
  const seen = new Set<string>();
  for (const e of copper) {
    const k = pointKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    const here = index.at(e);
    // Not the middle of a wire, and nothing below already.
    if (here.some((t) => !samePoint(t.a, e) && !samePoint(t.b, e))) continue;
    const below = pt(e.x, e.y + 1);
    if (index.at(below).length || pinAt.has(pointKey(below))) continue;
    const others = here.map((t) => (samePoint(t.a, e) ? t.b : t.a));
    if (!others.length && !pinAt.has(k)) continue;
    // Straight on: the wires there all come down to it, or a bare pin points down.
    ends.push({ at: e, straight: others.length ? others.every((q) => q.x === e.x && q.y < e.y) : pinDown.has(k) });
  }
  ends.sort((a, b) => Number(b.straight) - Number(a.straight) || b.at.y - a.at.y || a.at.x - b.at.x);
  // The words around are placed again once the symbol is there, so only symbols and wires are in its way.
  for (const { at: e } of ends) {
    const at = pt(e.x, e.y + 1);
    const lead: Segment = [e, at];
    if (symbols.some((b) => segmentCrossesBox(e, at, b)) || !symbolClear(at, true)) continue;
    return { at, lead };
  }
  return candidates[0] ? { at: candidates[0] } : undefined;
}

/**
 * Where to write a node's name: the first of its open wire ends (a terminal), wire corners and ends
 * (top left first), the middles of its wires and its pins where the name fits clear of everything
 * (scene.ts places it at the freest spot around the point); else the first of them.
 */
function labelPoint(circuit: Circuit, node: string, pins: readonly DrawnPin[], segs: readonly Segment[], scene: Scene, taken: readonly Box[], options: LayoutOptions): Point {
  const own = pins.filter((p) => p.node === node);
  const islands = findIslands(segs, pins.map((p) => p.at));
  const mine = new Set(pins.map((p, i) => (p.node === node ? islands.anchors[i]! : -1)).filter((i) => i >= 0));
  const points: Point[] = [];
  const middles: Point[] = [];
  segs.forEach((s, i) => {
    if (!mine.has(islands.wires[i]!)) return;
    points.push(s[0], s[1]);
    const mid = pt(Math.round((s[0].x + s[1].x) / 2), Math.round((s[0].y + s[1].y) / 2));
    if (!samePoint(mid, s[0]) && !samePoint(mid, s[1]) && isOrthogonal(s[0], s[1])) middles.push(mid);
  });
  const counts = new Map<string, number>();
  for (const p of points) counts.set(pointKey(p), (counts.get(pointKey(p)) ?? 0) + 1);
  const pinKeys = new Set(pins.map((p) => pointKey(p.at)));
  const open = points.filter((p) => counts.get(pointKey(p)) === 1 && !pinKeys.has(pointKey(p)));
  const sorted = (list: Point[]): Point[] => list.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const seen = new Set<string>();
  const candidates = [...sorted(open), ...sorted(points.filter((p) => !pinKeys.has(pointKey(p)))), ...sorted(middles), ...sorted(points), ...own.map((p) => p.at)].filter((p) => {
    const k = pointKey(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const text = circuit.nodes.get(node)?.text ?? node;
  for (const at of candidates.slice(0, 40)) if (labelFits(scene, text, at, taken, options)) return at;
  return candidates[0] ?? pt(0, 0);
}

/** True when a node's name fits at one of its spots around a point, clear of the scene and of `taken`. */
function labelFits(scene: Scene, text: string, at: Point, taken: readonly Box[], options: LayoutOptions): boolean {
  const boxes: Box[] = [...scene.parts.map((p) => p.box), ...scene.parts.map((p) => p.labelBox), ...scene.grounds.map((g) => g.box), ...scene.nodeLabels.map((l) => l.box), ...taken];
  const segments = scene.wires.flatMap((w) => segmentsOf(w.points));
  return NODE_SPOTS.some((spot) => {
    const lines = nodeLabelLines(text, at, spot, options.results ?? true, [], options.measure, options.nodeResultInline);
    const box = unionBoxes(lines.map((l) => l.box));
    return box !== undefined && !boxes.some((b) => boxesOverlap(box, b)) && !segments.some(([a, b]) => segmentCrossesBox(a, b, box));
  });
}

/** What the drawing connects, compared with the netlist (empty when they agree). */
export function schematicConnectivity(s: Schematic): ConnectivityProblem[] {
  return checkConnectivity(s.circuit, s.drawing);
}

/** The placed part with a name (any case), if drawn. */
export function placedPart(s: Schematic, name: string): Scene['parts'][number] | undefined {
  const key = lowerAscii(name);
  return s.scene.parts.find((p) => p.key === key);
}

/** The symbols in place of a drawing, for a quick look: part key to its pins. */
export function pinsByPart(circuit: Circuit, drawing: Drawing): Map<string, Point[]> {
  const out = new Map<string, Point[]>();
  for (const part of circuit.parts) {
    const p = drawing.parts.get(part.key);
    if (p) out.set(part.key, partGeometry(part, p).pins);
  }
  return out;
}
