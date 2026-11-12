/**
 * What a drawing connects: islands of copper (wires and pins that touch), junction dots, the ends of
 * wires that touch nothing, and the check that a drawing connects exactly what the netlist does.
 * Plain TypeScript: no DOM.
 *
 * The rules, as in common schematic editors:
 * - a wire's points are all connected; two wires connect where an end or corner of one lies on the
 *   other (a T), never where they only cross;
 * - a pin connects to a wire that passes through or ends at it, and to pins at the same point;
 * - every ground symbol is node 0, so islands with ground symbols are one node, and islands with
 *   labels of the same node are one node (connected by name);
 * - a junction dot goes where three or more wire ends, wire sides and pins meet.
 */
import { UnionFind } from '../spice/graph.ts';
import type { Circuit } from './circuit.ts';
import { GROUND } from './circuit.ts';
import { groundGeometry, partGeometry, type Drawing } from './drawing.ts';
import { pointKey, pointOnSegment, samePoint, segmentsOf, type Point } from './geometry.ts';

interface Seg {
  wire: number;
  a: Point;
  b: Point;
}

/** Wire segments, found by the point they pass through. */
export class SegmentIndex {
  private readonly horizontal = new Map<number, Seg[]>();
  private readonly vertical = new Map<number, Seg[]>();
  private readonly slanted: Seg[] = [];
  readonly segments: Seg[] = [];

  constructor(wires: readonly (readonly Point[])[]) {
    wires.forEach((w, i) => {
      for (const [a, b] of segmentsOf(w)) {
        const s = { wire: i, a, b };
        this.segments.push(s);
        if (a.y === b.y) push(this.horizontal, a.y, s);
        else if (a.x === b.x) push(this.vertical, a.x, s);
        else this.slanted.push(s);
      }
    });
  }

  /** Segments that pass through or end at p. */
  at(p: Point): Seg[] {
    const out: Seg[] = [];
    for (const s of this.horizontal.get(p.y) ?? []) if (pointOnSegment(p, s.a, s.b)) out.push(s);
    for (const s of this.vertical.get(p.x) ?? []) if (pointOnSegment(p, s.a, s.b)) out.push(s);
    for (const s of this.slanted) if (pointOnSegment(p, s.a, s.b)) out.push(s);
    return out;
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

export interface Islands {
  /** The island of each wire. */
  wires: number[];
  /** The island of each anchor (pin). */
  anchors: number[];
  count: number;
  /** The island at a point (on a wire or a pin), if any. */
  at(p: Point): number | undefined;
  /** Every island at a point: two where wires of two islands cross there without joining. */
  allAt(p: Point): number[];
}

/**
 * Splits wires and anchors (pins) into islands of copper that touch. Islands are numbered in order
 * of first appearance: wires first, then anchors.
 */
export function findIslands(wires: readonly (readonly Point[])[], anchors: readonly Point[]): Islands {
  const index = new SegmentIndex(wires);
  const uf = new UnionFind();
  wires.forEach((_, i) => uf.find(`w${i}`));
  for (const s of index.segments) {
    for (const end of [s.a, s.b]) for (const other of index.at(end)) uf.union(`w${s.wire}`, `w${other.wire}`);
  }
  const byPoint = new Map<string, number>();
  anchors.forEach((p, i) => {
    const key = pointKey(p);
    const same = byPoint.get(key);
    if (same !== undefined) uf.union(`a${i}`, `a${same}`);
    else {
      byPoint.set(key, i);
      uf.find(`a${i}`);
    }
    for (const s of index.at(p)) uf.union(`a${i}`, `w${s.wire}`);
  });
  const numbers = new Map<string, number>();
  const number = (id: string): number => {
    const root = uf.find(id);
    let n = numbers.get(root);
    if (n === undefined) {
      n = numbers.size;
      numbers.set(root, n);
    }
    return n;
  };
  const wireIslands = wires.map((_, i) => number(`w${i}`));
  const anchorIslands = anchors.map((_, i) => number(`a${i}`));
  return {
    wires: wireIslands,
    anchors: anchorIslands,
    count: numbers.size,
    at(p: Point): number | undefined {
      const s = index.at(p)[0];
      if (s) return wireIslands[s.wire];
      const a = byPoint.get(pointKey(p));
      return a === undefined ? undefined : anchorIslands[a];
    },
    allAt(p: Point): number[] {
      const out = new Set(index.at(p).map((s) => wireIslands[s.wire]!));
      const a = byPoint.get(pointKey(p));
      if (a !== undefined) out.add(anchorIslands[a]!);
      return [...out];
    },
  };
}

/** How many wire ends, wire sides and pins meet at each point that is a wire end, a corner or a pin. */
function arms(wires: readonly (readonly Point[])[], pins: readonly Point[]): Map<string, { at: Point; arms: number; pins: number }> {
  const index = new SegmentIndex(wires);
  const out = new Map<string, { at: Point; arms: number; pins: number }>();
  const visit = (p: Point): void => {
    const key = pointKey(p);
    if (out.has(key)) return;
    let n = 0;
    for (const s of index.at(p)) n += samePoint(p, s.a) || samePoint(p, s.b) ? 1 : 2;
    out.set(key, { at: p, arms: n, pins: 0 });
  };
  for (const s of index.segments) {
    visit(s.a);
    visit(s.b);
  }
  for (const p of pins) {
    visit(p);
    const e = out.get(pointKey(p))!;
    e.arms += 1;
    e.pins += 1;
  }
  return out;
}

/** Where junction dots go: three or more wire ends, wire sides or pins at one point. */
export function junctionPoints(wires: readonly (readonly Point[])[], pins: readonly Point[]): Point[] {
  return [...arms(wires, pins).values()].filter((e) => e.arms >= 3).map((e) => e.at);
}

/** Wire ends that touch nothing: no pin, no other wire. */
export function danglingEnds(wires: readonly (readonly Point[])[], pins: readonly Point[]): Point[] {
  return [...arms(wires, pins).values()].filter((e) => e.arms === 1 && e.pins === 0).map((e) => e.at);
}

/** Every pin of the drawing with its node: the parts' pins, then the ground symbols' pins (node 0). */
export interface DrawnPin {
  at: Point;
  node: string;
  /** The part's key, or undefined for a ground symbol. */
  part?: string;
  pin: number;
  /** For a ground symbol: its index in Drawing.grounds. */
  ground?: number;
}

export function drawnPins(circuit: Circuit, drawing: Pick<Drawing, 'parts' | 'grounds'>): DrawnPin[] {
  const out: DrawnPin[] = [];
  for (const part of circuit.parts) {
    const p = drawing.parts.get(part.key);
    if (!p) continue;
    partGeometry(part, p).pins.forEach((at, i) => out.push({ at, node: part.nodes[i]!, part: part.key, pin: i }));
  }
  drawing.grounds.forEach((g, i) => out.push({ at: groundGeometry(g).pins[0]!, node: GROUND, pin: 0, ground: i }));
  return out;
}

export interface ConnectivityProblem {
  /**
   * open: a node's pins are not all connected; short: an island joins different nodes; label: a
   * label names another node than its pins; unplaced: a part has no place; hidden: the node also
   * connects to parts the drawing does not show (the drawing is right, but not the whole circuit).
   */
  kind: 'open' | 'short' | 'label' | 'unplaced' | 'hidden';
  nodes: string[];
  message: string;
}

const listed = (names: readonly string[]): string => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/**
 * Compares what the drawing connects with what the netlist connects. Empty when they agree: every
 * node's pins are connected (by wires, or by name through ground symbols and labels), nothing
 * connects pins of different nodes, every part has a place, and no node goes on to parts the drawing
 * does not show ('hidden': the only kind that is not a mistake in the drawing).
 */
export function checkConnectivity(circuit: Circuit, drawing: Drawing): ConnectivityProblem[] {
  const problems: ConnectivityProblem[] = [];
  for (const node of circuit.nodes.values()) {
    if (!node.hidden.length) continue;
    const names = node.hidden.map((h) => `${h.name} (line ${h.lineNumber})`);
    problems.push({ kind: 'hidden', nodes: [node.name], message: `${node.ground ? 'Ground' : node.text} also connects to ${listed(names)}, which the drawing does not show.` });
  }
  for (const part of circuit.parts) {
    if (!drawing.parts.has(part.key)) problems.push({ kind: 'unplaced', nodes: [...part.nodes], message: `${part.name} has no place in the drawing.` });
  }
  const pins = drawnPins(circuit, drawing);
  const islands = findIslands(drawing.wires, pins.map((p) => p.at));
  const groups = new UnionFind();
  let firstGround: number | undefined;
  pins.forEach((p, i) => {
    if (p.ground === undefined) return;
    const island = islands.anchors[i]!;
    if (firstGround === undefined) firstGround = island;
    else groups.union(`i${island}`, `i${firstGround}`);
  });
  const labelled = new Map<string, number>();
  // A label "0" names ground, so it joins the ground symbols' islands too.
  if (firstGround !== undefined) labelled.set(GROUND, firstGround);
  for (const label of drawing.labels) {
    const island = islands.at(label.at);
    if (island === undefined) continue;
    const first = labelled.get(label.node);
    if (first === undefined) labelled.set(label.node, island);
    else groups.union(`i${island}`, `i${first}`);
  }
  const nodesOfGroup = new Map<string, Set<string>>();
  const groupsOfNode = new Map<string, Set<string>>();
  pins.forEach((p, i) => {
    const g = groups.find(`i${islands.anchors[i]!}`);
    (nodesOfGroup.get(g) ?? nodesOfGroup.set(g, new Set()).get(g)!).add(p.node);
    (groupsOfNode.get(p.node) ?? groupsOfNode.set(p.node, new Set()).get(p.node)!).add(g);
  });
  for (const [, nodes] of nodesOfGroup) {
    if (nodes.size > 1) problems.push({ kind: 'short', nodes: [...nodes], message: `The drawing connects ${[...nodes].join(', ')}, which the netlist keeps apart.` });
  }
  for (const [node, gs] of groupsOfNode) {
    if (gs.size > 1) problems.push({ kind: 'open', nodes: [node], message: `The drawing leaves the pins of ${node} in ${gs.size} separate pieces.` });
  }
  for (const label of drawing.labels) {
    const island = islands.at(label.at);
    if (island === undefined) continue;
    const nodes = nodesOfGroup.get(groups.find(`i${island}`));
    if (nodes && nodes.size > 0 && !nodes.has(label.node)) {
      problems.push({ kind: 'label', nodes: [label.node, ...nodes], message: `A label says ${label.node} on wires of ${[...nodes].join(', ')}.` });
    }
  }
  return problems;
}
