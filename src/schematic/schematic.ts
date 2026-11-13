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
import { SegmentIndex, checkConnectivity, drawnPins, findIslands, pointId, type ConnectivityProblem, type DrawnPin, type Islands } from './connectivity.ts';
import { NODE_SPOTS, cloneDrawing, cloneLabel, emptyDrawing, groundGeometry, partGeometry, symbolGeometry, type Drawing, type GroundPlacement, type NodeLabel, type PartPlacement } from './drawing.ts';
import { parseDrawingLines, readDrawing, type DrawingLines, type DrawingProblem, type PositionLine } from './format.ts';
import { boxesOverlap, inflate, isOrthogonal, manhattan, pointKey, pt, samePoint, segmentCrossesBox, segmentsOf, squaresAlong, unionBoxes, type Box, type Direction, type Point } from './geometry.ts';
import { autoLayout, layOut, placeMoved, placeParts, type LayoutOptions } from './layout.ts';
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
  // The copper merged once, before anything looks at it: wire drawn over wire (a share link may
  // repeat one piece two thousand times) becomes one piece, so no later step sees the repeats. A
  // ground symbol drawn twice at one place, turned the same way, is one symbol, for the same reason
  // (1900 of them at one point made every step that looks at the pins look at each; second re-check, P3).
  const wires = normalizeWires(lines.wires);
  const grounds = uniqueGrounds(lines.grounds.map((g) => ({ at: g.at, rot: g.rot })));
  const base = (): Drawing => {
    const d = emptyDrawing();
    for (const [k, p] of given) d.parts.set(k, p);
    d.grounds = grounds.map((g) => ({ at: g.at, rot: g.rot }));
    d.wires = wires.slice();
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
    // A name written twice at one point (the same node) is written once: the repairs would keep only
    // the first anyway (reconcile, step 3), and until then every scene made on the way places each
    // (1900 at one point took most of a minute to build; second re-check, P3).
    drawing.labels = uniqueLabels(labelsInStep(circuit, drawing, lines, problems, orphans));
    origin = given.size === circuit.parts.length ? 'given' : 'partial';
    const missing = circuit.parts.filter((p) => !given.has(p.key));
    if (missing.length) {
      const onlyPositions = !lines.wires.length && !lines.grounds.length && !lines.labels.length;
      const shifted = onlyPositions ? shiftedLayout(circuit, given, options) : undefined;
      if (shifted) drawing = shifted;
      else if (missing.length <= 2) placeParts(circuit, oneNamePerPoint(drawing), missing.map((p) => p.key), options);
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

/** The ground symbols, each place and turn once (the first of those drawn there). */
function uniqueGrounds(grounds: GroundPlacement[]): GroundPlacement[] {
  const seen = new Set<string>();
  return grounds.filter((g) => {
    const k = `${pointKey(g.at)} ${g.rot}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The names of nodes, each node once at each point (the first written there). */
function uniqueLabels(labels: NodeLabel[]): NodeLabel[] {
  const seen = new Set<string>();
  return labels.filter((l) => {
    const k = `${l.node} ${pointKey(l.at)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The drawing as the scenes made on the way to place parts see it (sharing its parts, ground symbols
 * and wires, which placing a part changes): one name at each point, the first written there. A
 * drawing PlainSpice writes has one at most; lines can pile a name of every node on each point of a
 * square (61 × 25), and each scene placed each against all the others (second re-check, P3). All the
 * names are put in order afterwards (reconcile, step 3).
 */
function oneNamePerPoint(drawing: Drawing): Drawing {
  const seen = new Set<string>();
  const labels = drawing.labels.filter((l) => {
    const k = pointKey(l.at);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return labels.length === drawing.labels.length ? drawing : { ...drawing, labels };
}

/** True when a part could stand at a placement: its symbol and words clear of the other symbols, and no pin on another node's copper. */
function placeIsFree(circuit: Circuit, drawing: Drawing, key: string, placement: PartPlacement, options: LayoutOptions): boolean {
  const part = circuit.parts.find((p) => p.key === key);
  if (!part) return false;
  const scene = buildScene(circuit, oneNamePerPoint(drawing), options);
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
  const here = buildScene(circuit, oneNamePerPoint(drawing), options).bounds;
  const there = buildScene(sub, laid, options).bounds;
  const dx = Math.ceil(here.x1 + 3 - there.x0);
  // The start node's highest copper in the given drawing: a pin pointing up meets a rail just above it.
  let railY: number | undefined;
  if (start !== undefined) {
    const copper = copperOf(circuit, drawing, toSegments(drawing.wires)).get(start) ?? [];
    const scene = buildScene(circuit, oneNamePerPoint(drawing), options);
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
  // The copper indexed, and merged, once for each version of it: `segs` is only ever replaced or
  // added to, so the array and its length tell the versions apart (a drawing at the format's limits
  // has twenty thousand pieces; security:F1).
  let indexed: { segs: readonly Segment[]; length: number; index: SegmentIndex } | undefined;
  const indexOf = (list: readonly Segment[]): SegmentIndex => {
    if (indexed?.segs !== list || indexed.length !== list.length) indexed = { segs: list, length: list.length, index: new SegmentIndex(list) };
    return indexed.index;
  };
  const islandsOf = (anchors: readonly Point[]): Islands => findIslands(segs, anchors, indexOf(segs));
  let merged: { segs: readonly Segment[]; length: number; wires: Point[][] } | undefined;
  const mergedOf = (list: readonly Segment[]): Point[][] => {
    if (merged?.segs !== list || merged.length !== list.length) merged = { segs: list, length: list.length, wires: normalizeWires(list) };
    return merged.wires;
  };
  const pinsOf = (): DrawnPin[] => drawnPins(circuit, drawing);
  const nodeOrder = new Map([...circuit.nodes.keys()].map((n, i) => [n, i]));

  // 1. Pins of different nodes touching: a part whose pin sits on another node's pin moves. The parts
  //    to move are found from the pins alone (the last part at such a point, until no point has pins
  //    of two nodes), then placed from one scene of the drawing (placeMoved), not one scene each
  //    (second re-check, P3). The loop after it moves any part still on another node's pin.
  const movers: string[] = [];
  {
    let pins = pinsOf();
    for (let round = 0; round < circuit.parts.length + 1; round++) {
      const clash = clashOf(pins);
      if (!clash) break;
      const mover = clash.slice().reverse().find((p) => p.part !== undefined);
      if (!mover?.part) {
        const g = clash.find((p) => p.ground !== undefined);
        if (g?.ground !== undefined) drawing.grounds.splice(g.ground, 1);
        pins = pinsOf().filter((p) => p.part === undefined || !movers.includes(p.part));
        continue;
      }
      movers.push(mover.part);
      pins = pins.filter((p) => p.part !== mover.part);
    }
  }
  if (movers.length) {
    placeMoved(circuit, { ...oneNamePerPoint(drawing), wires: segs }, movers, options);
    for (const key of movers) problems.push({ kind: 'moved-part', severity: 'info', message: `${circuit.parts.find((p) => p.key === key)!.name} was moved: a pin of it touched a pin of another node.` });
  }
  for (let round = 0; round < circuit.parts.length + 1; round++) {
    const clash = clashOf(pinsOf());
    if (!clash) break;
    const mover = clash.slice().reverse().find((p) => p.part !== undefined);
    if (!mover?.part) {
      const g = clash.find((p) => p.ground !== undefined);
      if (g?.ground !== undefined) drawing.grounds.splice(g.ground, 1);
      continue;
    }
    const part = circuit.parts.find((p) => p.key === mover.part)!;
    drawing.parts.delete(part.key);
    placeParts(circuit, { ...oneNamePerPoint(drawing), wires: segs }, [part.key], options);
    problems.push({ kind: 'moved-part', severity: 'info', message: `${part.name} was moved: a pin of it touched a pin of another node.` });
  }

  // 2. Islands joining different nodes: cut the odd pins loose (the most common node keeps the wires).
  //    A round that changes nothing (a pin on slanted copper, which a cut cannot free) ends the step:
  //    each round after it would start from the same drawing and change nothing either (second
  //    re-check, P3: on a slanted lattice at the format's limits, 50 such rounds took a second).
  let cut = false;
  for (let round = 0; round < 50; round++) {
    const before = { segs, grounds: drawing.grounds.length };
    const pins = pinsOf();
    const islands = islandsOf(pins.map((p) => p.at));
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
    if (drawing.grounds.length === before.grounds && sameSegments(segs, before.segs)) break;
  }

  // 3. Labels: on their node's copper, else moved onto it (when close) or dropped; then one name per
  //    piece of copper (ground's name is its symbol, so a "0" label where a ground symbol is goes).
  {
    const pins = pinsOf();
    const islands = islandsOf(pins.map((p) => p.at));
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
    const islands = islandsOf(anchors);
    const useful = new Set(islands.anchors);
    segs = segs.filter((_, i) => useful.has(islands.wires[i]!));
    segs = pruneDangling(segs, pins.map((p) => p.at), drawing.labels.map((l) => l.at));
  }

  // 5. Join the pieces of each node, within a fixed amount of searching (the same every time).
  let routed = false;
  let named = false;
  const budget = { left: ROUTING_STEPS };
  let obstacles: Obstacles | undefined;
  // The islands, found once and kept up to date as each route adds wire (RouteCopper), and found again
  // only when a ground symbol is added (segs only grows here).
  let copper: RouteCopper | undefined;
  const copperNow = (): RouteCopper => {
    if (copper?.grounds !== drawing.grounds.length) copper = new RouteCopper(segs, drawnPins(circuit, drawing), indexOf(segs), drawing.grounds.length);
    return copper;
  };
  for (const node of circuit.nodes.keys()) {
    for (let guard = 0; guard < 64; guard++) {
      const now = copperNow();
      const { groups } = groupsOf(drawing, node, { pins: now.pins, islands: now });
      if (groups.length <= 1) break;
      obstacles ??= obstaclesOf(circuit, drawing, mergedOf(segs), options);
      const path = budget.left > 0 ? routeBetween(drawing, node, groups, obstacles, budget, now) : undefined;
      if (path && path.length < 2) break;
      if (path) {
        const from = segs.length;
        for (let i = 1; i < path.length; i++) segs.push([path[i - 1]!, path[i]!]);
        if (!now.added(from)) copper = undefined;
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
    const spot = groundSpot(circuit, drawing, segs, mergedOf(segs), indexOf(segs), options);
    if (spot) {
      if (spot.lead) segs.push(spot.lead);
      drawing.grounds.push({ at: spot.at, rot: 0 });
      problems.push({ kind: 'ground-added', severity: 'info', message: 'A ground symbol was added: the circuit has ground (node 0) and the drawing had none.' });
      // Its symbol names that copper now: a "0" label there goes.
      const pins = pinsOf();
      const islands = islandsOf(pins.map((p) => p.at));
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
      const wires = mergedOf(segs);
      const scene = buildScene(circuit, { ...drawing, wires }, options);
      const islands = islandsOf(pins.map((p) => p.at));
      const index = new SegmentIndex(wires);
      const taken: Box[] = [];
      for (const node of missing) {
        const at = labelPoint(circuit, node.name, pins, segs, islands, scene, index, taken, options);
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
  drawing.wires = mergedOf(segs);
  for (let round = 0; round < 8; round++) {
    const merged = toSegments(drawing.wires);
    const pruned = pruneDangling(merged, pinsOf().map((p) => p.at), drawing.labels.map((l) => l.at));
    // Nothing cut: merging the merged copper again gives it back (normalizeWires is idempotent).
    if (pruned.length === merged.length && pruned.every(([a, b], i) => samePoint(a, merged[i]![0]) && samePoint(b, merged[i]![1]))) break;
    const settled = normalizeWires(pruned);
    if (sameWires(settled, drawing.wires)) break;
    drawing.wires = settled;
  }
  if ((cut || routed) && redrawn(givenSegs, drawing.wires)) {
    problems.push({ kind: 'wires-redrawn', severity: 'info', message: 'Some wires were redrawn so that the drawing connects what the netlist connects.' });
  }
  return drawing;
}

/** The pins at the first point where pins of two nodes touch (in the order of the pins), if any. */
function clashOf(pins: readonly DrawnPin[]): DrawnPin[] | undefined {
  const byPoint = new Map<string, DrawnPin[]>();
  for (const p of pins) (byPoint.get(pointKey(p.at)) ?? byPoint.set(pointKey(p.at), []).get(pointKey(p.at))!).push(p);
  return [...byPoint.values()].find((list) => new Set(list.map((p) => p.node)).size > 1);
}

/** True when two lists of segments are the same, point for point, in the same order. */
function sameSegments(a: readonly Segment[], b: readonly Segment[]): boolean {
  return a === b || (a.length === b.length && a.every(([p, q], i) => samePoint(p, b[i]![0]) && samePoint(q, b[i]![1])));
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

/** The pieces of a node: islands of its pins, joined where ground symbols or labels join them by name (`islands`: of the segments and the drawing's pins). */
function groupsOf(drawing: Drawing, node: string, { pins, islands }: { pins: readonly DrawnPin[]; islands: Pick<Islands, 'at' | 'anchors'> }): { groups: Group[] } {
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
  return { groups };
}

/** The side of the squares RouteCopper files pieces of wire in, for the pieces near a route. */
const ROUTE_SQUARE = 16;
/** A box covering more of those squares than this is asked about every piece instead. */
const ROUTE_SQUARES_MAX = 4096;

/**
 * The copper while the repairs route new wire (reconcile, step 5): its islands, found once and then
 * kept up to date as each route adds wire, joining exactly the islands finding them again would join
 * (findIslands joins the pieces at each end of a piece, passing or ending there, and each pin to the
 * pieces at its point): those with a piece or a pin at a corner or an end of the route, and those with
 * a piece ending, or a pin, on it. And what a route looks up, each where it is needed: the pieces of
 * each island, whether a wire ends at a point, and the pieces near a box. Finding the islands again
 * after each route, and going through every piece of wire for each, made the work grow with the
 * routes times the wire: 60 parts piled at one point, every resistor between node 1 and ground, and a
 * large grid named far away took 2 s to route (the second re-check's critic asked for every shape at
 * the format's limits to be bounded). Every point must be a grid point (the drawing format's are);
 * `added` says when one is not, and the islands are then found again.
 */
class RouteCopper {
  readonly segs: readonly Segment[];
  readonly pins: readonly DrawnPin[];
  /** How many ground symbols the drawing had: a new one is a new pin (the islands are found again). */
  readonly grounds: number;
  /** The island of each pin and of each piece of wire (segs[i]), kept up to date. */
  readonly anchors: number[];
  readonly wires: number[];
  /** The pieces of wire there were, indexed (routes add the rest, filed in `addedAt`). */
  private readonly index: SegmentIndex;
  /** Each island's pieces of wire (`sorted`: in order) and pins. */
  private readonly members = new Map<number, { wires: number[]; pins: number[]; sorted: boolean }>();
  private next: number;
  /** The pieces routes added, by each grid point they pass, and the points where one ends. */
  private readonly addedAt = new Map<number | string, number[]>();
  private readonly addedEnds = new Set<number | string>();
  /** The first pin at each point, and the points where more than one sits. */
  private readonly pinAt = new Map<number | string, number>();
  private readonly crowded = new Set<number | string>();
  /** Every piece by the squares it runs through, and the span of their ends. */
  private readonly squares = new Map<number, number[]>();
  private readonly big: number[] = [];
  private seen: Uint32Array<ArrayBuffer> = new Uint32Array(64);
  private looks = 0;
  private readonly span = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  /** Every end and pin on the grid: what keeping the islands up to date relies on. */
  private readonly grid: boolean;

  constructor(segs: readonly Segment[], pins: readonly DrawnPin[], index: SegmentIndex, grounds: number) {
    this.segs = segs;
    this.pins = pins;
    this.index = index;
    this.grounds = grounds;
    const islands = findIslands(segs, pins.map((p) => p.at), index);
    this.wires = islands.wires.slice();
    this.anchors = islands.anchors.slice();
    this.next = islands.count;
    this.wires.forEach((id, i) => this.member(id).wires.push(i));
    this.anchors.forEach((id, j) => this.member(id).pins.push(j));
    pins.forEach((p, j) => {
      const k = pointId(p.at);
      if (this.pinAt.has(k)) this.crowded.add(k);
      else this.pinAt.set(k, j);
    });
    const whole = (n: number): boolean => Number.isInteger(n);
    this.grid = segs.every(([a, b]) => whole(a.x) && whole(a.y) && whole(b.x) && whole(b.y)) && pins.every((p) => whole(p.at.x) && whole(p.at.y));
    for (let i = 0; i < segs.length; i++) this.file(i);
  }

  private member(id: number): { wires: number[]; pins: number[]; sorted: boolean } {
    let m = this.members.get(id);
    if (!m) this.members.set(id, (m = { wires: [], pins: [], sorted: true }));
    return m;
  }

  private file(i: number): void {
    const [a, b] = this.segs[i]!;
    this.span.x0 = Math.min(this.span.x0, a.x, b.x);
    this.span.y0 = Math.min(this.span.y0, a.y, b.y);
    this.span.x1 = Math.max(this.span.x1, a.x, b.x);
    this.span.y1 = Math.max(this.span.y1, a.y, b.y);
    const keys = squaresAlong(a, b, ROUTE_SQUARE);
    if (!keys) {
      this.big.push(i);
      return;
    }
    for (const k of keys) (this.squares.get(k) ?? this.squares.set(k, []).get(k)!).push(i);
  }

  /** The island at a point: of its first piece of wire (horizontal ones first, then vertical, then slanted, each in order), else of its pin. */
  at(p: Point): number | undefined {
    const kind = (s: Segment): number => (s[0].y === s[1].y ? 0 : s[0].x === s[1].x ? 1 : 2);
    const there = this.index.at(p)[0];
    let best = there ? there.wire : -1;
    let bestKind = there ? kind([there.a, there.b]) : 3;
    for (const i of this.addedAt.get(pointId(p)) ?? NO_PIECES) {
      const k = kind(this.segs[i]!);
      if (k < bestKind) {
        best = i;
        bestKind = k;
      }
    }
    if (best >= 0) return this.wires[best];
    const pin = this.pinAt.get(pointId(p));
    return pin === undefined ? undefined : this.anchors[pin];
  }

  /** True when a piece of wire ends at the point, or more than one pin sits there. */
  wiredAt(p: Point): boolean {
    const k = pointId(p);
    return this.crowded.has(k) || this.addedEnds.has(k) || this.index.at(p).some((s) => samePoint(s.a, p) || samePoint(s.b, p));
  }

  /** The pieces of wire of some islands, in order. */
  piecesOf(islands: ReadonlySet<number>): number[] {
    const out: number[] = [];
    let lists = 0;
    let sorted = true;
    for (const id of islands) {
      const m = this.members.get(id);
      if (!m?.wires.length) continue;
      lists++;
      sorted &&= m.sorted;
      for (const i of m.wires) out.push(i);
    }
    if (lists > 1 || !sorted) out.sort((i, j) => i - j);
    return out;
  }

  /** The pieces of wire of other islands than `own` that can touch a box: every one with a point in it. */
  othersNear(box: Box, own: ReadonlySet<number>): Segment[] {
    const x0 = Math.floor(Math.floor(box.x0) / ROUTE_SQUARE);
    const x1 = Math.floor(Math.ceil(box.x1) / ROUTE_SQUARE);
    const y0 = Math.floor(Math.floor(box.y0) / ROUTE_SQUARE);
    const y1 = Math.floor(Math.ceil(box.y1) / ROUTE_SQUARE);
    const out: Segment[] = [];
    if (!((x1 - x0 + 1) * (y1 - y0 + 1) <= ROUTE_SQUARES_MAX)) {
      this.segs.forEach((s, i) => {
        if (!own.has(this.wires[i]!)) out.push(s);
      });
      return out;
    }
    if (this.seen.length < this.segs.length) {
      const grown = new Uint32Array(2 * this.segs.length);
      grown.set(this.seen);
      this.seen = grown;
    }
    const look = ++this.looks;
    const take = (i: number): void => {
      if (this.seen[i] === look) return;
      this.seen[i] = look;
      if (!own.has(this.wires[i]!)) out.push(this.segs[i]!);
    };
    for (const i of this.big) take(i);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (const i of this.squares.get(x * 65536 + y) ?? NO_PIECES) take(i);
    return out;
  }

  /** The box round every piece's ends and `extra` (a route's whole area). */
  spanWith(extra: Box): Box {
    return { x0: Math.min(this.span.x0, extra.x0), y0: Math.min(this.span.y0, extra.y0), x1: Math.max(this.span.x1, extra.x1), y1: Math.max(this.span.y1, extra.y1) };
  }

  /**
   * Joins the pieces segs[from …] (one route, end to end) to the islands they touch, as finding the
   * islands again would. False when a point is off the grid: the islands must then be found again.
   */
  added(from: number): boolean {
    const added: number[] = [];
    for (let i = from; i < this.segs.length; i++) added.push(i);
    const whole = (q: Point): boolean => Number.isInteger(q.x) && Number.isInteger(q.y);
    if (!this.grid || added.some((i) => !whole(this.segs[i]![0]) || !whole(this.segs[i]![1]) || !isOrthogonal(this.segs[i]![0], this.segs[i]![1]))) return false;
    const touched = new Set<number>();
    const pinThere = (q: Point): void => {
      const pin = this.pinAt.get(pointId(q));
      if (pin !== undefined) touched.add(this.anchors[pin]!);
    };
    // At the route's corners and ends: every piece there, passing or ending, and the pin there.
    const corners = [this.segs[from]![0], ...added.map((i) => this.segs[i]![1])];
    for (const q of corners) {
      for (const t of this.index.at(q)) touched.add(this.wires[t.wire]!);
      for (const i of this.addedAt.get(pointId(q)) ?? NO_PIECES) touched.add(this.wires[i]!);
      pinThere(q);
    }
    // Along it: every piece ending there, and the pin there.
    for (const i of added) {
      for (const q of gridPoints(this.segs[i]!)) {
        for (const t of this.index.at(q)) if (samePoint(t.a, q) || samePoint(t.b, q)) touched.add(this.wires[t.wire]!);
        for (const j of this.addedAt.get(pointId(q)) ?? NO_PIECES) if (samePoint(this.segs[j]![0], q) || samePoint(this.segs[j]![1], q)) touched.add(this.wires[j]!);
        pinThere(q);
      }
    }
    // One island: the largest keeps its number, the others' pieces and pins take it.
    let keep = -1;
    let most = -1;
    for (const id of touched) {
      const m = this.members.get(id)!;
      if (m.wires.length + m.pins.length > most) {
        most = m.wires.length + m.pins.length;
        keep = id;
      }
    }
    if (keep < 0) keep = this.next++;
    const target = this.member(keep);
    for (const id of touched) {
      if (id === keep) continue;
      const m = this.members.get(id)!;
      for (const i of m.wires) this.wires[i] = keep;
      for (const j of m.pins) this.anchors[j] = keep;
      if (m.wires.length) target.sorted = target.sorted && m.sorted && (!target.wires.length || m.wires[0]! > target.wires[target.wires.length - 1]!);
      for (const i of m.wires) target.wires.push(i);
      for (const j of m.pins) target.pins.push(j);
      this.members.delete(id);
    }
    for (const i of added) {
      this.wires[i] = keep;
      target.wires.push(i);
      for (const q of gridPoints(this.segs[i]!)) (this.addedAt.get(pointId(q)) ?? this.addedAt.set(pointId(q), []).get(pointId(q))!).push(i);
      this.addedEnds.add(pointId(this.segs[i]![0]));
      this.addedEnds.add(pointId(this.segs[i]![1]));
      this.file(i);
    }
    return true;
  }
}

const NO_PIECES: readonly number[] = [];

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

/** `wires`: the copper as it stands, merged (normalizeWires). */
function obstaclesOf(circuit: Circuit, drawing: Drawing, wires: Point[][], options: LayoutOptions): Obstacles {
  const scene = buildScene(circuit, { ...drawing, wires }, options);
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

/**
 * A new wire from the first piece of a node to the nearest other piece, or undefined (`copper`: the
 * drawing's pins and the islands of the segments and those pins, as groupsOf found them: not found
 * again for each route).
 */
function routeBetween(drawing: Drawing, node: string, groups: readonly Group[], obstacles: Obstacles, budget: { left: number }, copper: RouteCopper): Point[] | undefined {
  const pinOutward = new Map<string, RouteEnd>();
  for (const [k, list] of obstacles.outward) {
    const own = list.find((x) => x.node === node);
    if (own) pinOutward.set(k, { at: own.at, outward: own.outward });
  }
  const ends = (group: Group): RouteEnd[] => {
    const out: RouteEnd[] = [];
    for (const i of copper.piecesOf(group.islands)) for (const p of gridPoints(copper.segs[i]!)) out.push({ at: p });
    for (const p of group.pins) {
      const pin = pinOutward.get(pointKey(p.at));
      // A pin that already has a wire (where a wire ends or another pin sits) may be left sideways, at
      // a cost; a bare pin only along its lead. A pin with no wire yet is best left along its lead;
      // across it (an L at the pin) costs more.
      out.push(pin ? (copper.wiredAt(p.at) ? { ...pin, soft: true } : { ...pin, sideCost: ROUTE_COSTS.bareSide }) : { at: p.at });
    }
    return out;
  };
  const sources = ends(groups[0]!);
  const targets = groups.slice(1).flatMap(ends);
  // Each end is work for the search before it takes a step (a state to file, a distance to measure):
  // it counts as a step, so a node whose copper is a lattice at the format's limits does not make each
  // of its routes go through the whole lattice again without end (60 parts piled at one point with one
  // pin on such a lattice: 622,000 ends in 32 routes).
  budget.left -= sources.length + targets.length;
  const ownIslands = new Set(groups.flatMap((g) => [...g.islands]));
  // Other nodes' pins, and the points their names are written at (a wire through one would leave the
  // name on a crossing of two nodes' wires).
  const foreignPins = [...copper.pins.filter((p) => p.node !== node).map((p) => p.at), ...drawing.labels.filter((l) => l.node !== node).map((l) => l.at)];
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
  // First near the two pieces, then over the whole drawing. The other nodes' wires a route must keep
  // to are those near its area (a wire with no point in it changes nothing there), not every one.
  const near = span([...sources, ...targets].map((e) => e.at), 8);
  const whole = (): Box => inflate(copper.spanWith(obstacles.bounds), 4);
  for (const area of [() => near, whole]) {
    if (budget.left <= 0) return undefined;
    const bounds = area();
    const limits = { steps: budget.left, used: 0 };
    const path = findRoute({ walls: obstacles.walls, avoid, foreignWires: copper.othersNear(bounds, ownIslands), foreignPins, bounds }, sources, targets, limits);
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
 * How many places groundSpot tries at most, lowest first (and as many ends for a lead): a drawing has
 * a few dozen points of ground's copper; a drawing line can give twenty thousand, each with a wire
 * through it, and trying them all made a 31 kB link take half a minute on a phone (security:F1).
 */
const GROUND_TRIES = 100;

/**
 * A place for a ground symbol (bars down) on node 0's copper: below its lowest free pin or wire
 * point, clear of symbols and words, and with no wire through it. When no point is clear (a ground
 * rail drawn straight through the pins and then turned for a phone stands upright, so it runs through
 * any symbol hung on it), the symbol hangs on a one-unit lead below the lowest end of ground's copper
 * that has room, best where the lead goes straight on from a wire coming down (no new bend), as the
 * automatic layout's ground rail ends; the lead is returned to be drawn. Else the least bad point.
 * `wires`: the copper merged (normalizeWires of `segs`); `segIndex`: `segs` indexed.
 */
function groundSpot(circuit: Circuit, drawing: Drawing, segs: readonly Segment[], wires: Point[][], segIndex: SegmentIndex, options: LayoutOptions): { at: Point; lead?: Segment } | undefined {
  const scene = buildScene(circuit, { ...drawing, wires }, options);
  const boxes: Box[] = [...scene.parts.map((p) => p.box), ...scene.parts.map((p) => p.labelBox), ...scene.grounds.map((g) => g.box), ...scene.nodeLabels.map((l) => l.box)];
  // The wires indexed once: a place is checked against the wires near it only (security:F1, critic).
  const index = new SegmentIndex(wires);
  const symbols: Box[] = [...scene.parts.map((p) => p.box), ...scene.grounds.map((g) => g.box)];
  /** Clear of the symbols, of words too unless `wordsMove` (words are placed afresh around a new symbol), and of the wires. */
  const symbolClear = (at: Point, wordsMove = false): boolean => {
    const box = symbolGeometry('ground', at, 0, false).box;
    return !(wordsMove ? symbols : boxes).some((b) => boxesOverlap(inflate(box, 0.1), b)) && !index.crosses(box);
  };
  const pins = drawnPins(circuit, drawing);
  const copper = copperOf(circuit, drawing, segs, findIslands(segs, pins.map((p) => p.at), segIndex)).get(GROUND) ?? [];
  // Each point once, lowest first; at most GROUND_TRIES of them are tried.
  const seen = new Set<string>();
  const candidates: Point[] = [];
  const consider = (p: Point): void => {
    const k = pointKey(p);
    if (seen.has(k)) return;
    seen.add(k);
    candidates.push(p);
  };
  for (const part of scene.parts) for (const pin of part.pins) if (pin.node === GROUND && pin.outward === 'down') consider(pin.at);
  for (const p of copper) consider(p);
  candidates.sort((a, b) => b.y - a.y || a.x - b.x);
  for (const c of candidates.slice(0, GROUND_TRIES)) if (symbolClear(c)) return { at: c };
  // A lead from an end of ground's copper: its wire ends and its pins, where nothing runs on below.
  const pinAt = new Set(scene.parts.flatMap((p) => p.pins.map((q) => pointKey(q.at))));
  const pinDown = new Set(scene.parts.flatMap((p) => p.pins.filter((q) => q.outward === 'down').map((q) => pointKey(q.at))));
  const ends: { at: Point; straight: boolean }[] = [];
  for (const e of candidates) {
    const k = pointKey(e);
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
  for (const { at: e } of ends.slice(0, GROUND_TRIES)) {
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
 * (scene.ts places it at the freest spot around the point); else the first of them. Never a point
 * another node's wire runs through (`wires`: the scene's wires, indexed): a name there sits on a
 * crossing of two nodes' wires, where it reads as the other node's (the middle of a wire a route of
 * another node crosses, say; second re-check's critic: in 4 piles of V1 and R2 … Rn at one point).
 */
function labelPoint(circuit: Circuit, node: string, pins: readonly DrawnPin[], segs: readonly Segment[], islands: Islands, scene: Scene, wires: SegmentIndex, taken: readonly Box[], options: LayoutOptions): Point {
  const own = pins.filter((p) => p.node === node);
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
  const all = [...sorted(open), ...sorted(points.filter((p) => !pinKeys.has(pointKey(p)))), ...sorted(middles), ...sorted(points), ...own.map((p) => p.at)].filter((p) => {
    const k = pointKey(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const crossed = (p: Point): boolean => wires.at(p).some((t) => scene.wires[t.wire]?.node !== node);
  const candidates = all.filter((p) => !crossed(p));
  const text = circuit.nodes.get(node)?.text ?? node;
  const boxes: Box[] = [...scene.parts.map((p) => p.box), ...scene.parts.map((p) => p.labelBox), ...scene.grounds.map((g) => g.box), ...scene.nodeLabels.map((l) => l.box), ...taken];
  for (const at of candidates.slice(0, 40)) if (labelFits(boxes, wires, text, at, options)) return at;
  return candidates[0] ?? all[0] ?? pt(0, 0);
}

/** True when a node's name fits at one of its spots around a point, clear of the boxes and the wires (indexed: the scene's). */
function labelFits(boxes: readonly Box[], wires: SegmentIndex, text: string, at: Point, options: LayoutOptions): boolean {
  return NODE_SPOTS.some((spot) => {
    const lines = nodeLabelLines(text, at, spot, options.results ?? true, [], options.measure, options.nodeResultInline);
    const box = unionBoxes(lines.map((l) => l.box));
    return box !== undefined && !boxes.some((b) => boxesOverlap(box, b)) && !wires.crosses(box);
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
