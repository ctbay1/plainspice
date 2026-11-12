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

/** Grid points are keyed as one number: whole x and y within these bounds (far beyond any drawing's). */
const KEY_SPAN = 2 ** 21;
const keyable = (p: Point): boolean => Number.isInteger(p.x) && Number.isInteger(p.y) && Math.abs(p.x) < KEY_SPAN && Math.abs(p.y) < KEY_SPAN;
const gridKey = (x: number, y: number): number => x * 2 * KEY_SPAN + y;
/** A point as a map key: one number for a grid point (the usual case), its "x,y" text otherwise. */
export const pointId = (p: Point): number | string => (keyable(p) ? gridKey(p.x, p.y) : pointKey(p));
const gcd = (m: number, n: number): number => {
  while (n) [m, n] = [n, m % n];
  return m;
};

/**
 * The straight segments of one row (or one column), sorted by where they start, with how far the
 * segments up to each one reach: the segments through a point are found by a binary search and a
 * scan back over only those that can still reach it (one or two in a tidy drawing).
 */
class Line {
  readonly segs: Seg[] = [];
  readonly order: number[] = [];
  private lo: number[] = [];
  private hi: number[] = [];
  private reach: number[] = [];

  add(s: Seg, order: number): void {
    this.segs.push(s);
    this.order.push(order);
  }

  /** Sorts the segments once all are in; `along` reads a segment's ends along the line. */
  done(along: (p: Point) => number): void {
    const idx = this.segs.map((_, i) => i);
    const from = (i: number): number => Math.min(along(this.segs[i]!.a), along(this.segs[i]!.b));
    idx.sort((i, j) => from(i) - from(j) || this.order[i]! - this.order[j]!);
    const segs = idx.map((i) => this.segs[i]!);
    const order = idx.map((i) => this.order[i]!);
    this.segs.splice(0, segs.length, ...segs);
    this.order.splice(0, order.length, ...order);
    this.lo = segs.map((t) => Math.min(along(t.a), along(t.b)));
    this.hi = segs.map((t) => Math.max(along(t.a), along(t.b)));
    let far = -Infinity;
    this.reach = this.hi.map((h) => (far = Math.max(far, h)));
  }

  /** The segments through `v` (a position along the line), in the order they were given. */
  at(v: number): Seg[] {
    let a = 0;
    let b = this.lo.length - 1;
    let last = -1;
    while (a <= b) {
      const mid = (a + b) >> 1;
      if (this.lo[mid]! <= v) {
        last = mid;
        a = mid + 1;
      } else b = mid - 1;
    }
    const found: number[] = [];
    for (let j = last; j >= 0 && this.reach[j]! >= v; j--) if (this.hi[j]! >= v) found.push(j);
    if (found.length > 1) found.sort((i, j) => this.order[i]! - this.order[j]!);
    return found.map((j) => this.segs[j]!);
  }
}

/**
 * Wire segments, found by the point they pass through: straight ones by their row or column (see
 * Line), slanted ones filed under every grid point they pass exactly. Finding the segments at a point
 * never looks at every segment of the drawing, so the work grows with the number of segments and the
 * length of wire (both bounded by the drawing format), never with the square of either. At a point,
 * the horizontal segments come first, then the vertical ones, then the slanted ones, each in the order
 * they were given (where two islands cross, the first is the one a point is said to be on).
 */
export class SegmentIndex {
  private readonly rows = new Map<number, Line>();
  private readonly cols = new Map<number, Line>();
  private readonly slanted = new Map<number, Seg[]>();
  /** Slanted segments with an end off the grid (none that PlainSpice draws): checked one by one. */
  private readonly loose: Seg[] = [];
  readonly segments: Seg[] = [];

  constructor(wires: readonly (readonly Point[])[]) {
    const line = (m: Map<number, Line>, k: number): Line => {
      let l = m.get(k);
      if (!l) m.set(k, (l = new Line()));
      return l;
    };
    wires.forEach((w, i) => {
      for (const [a, b] of segmentsOf(w)) {
        const s = { wire: i, a, b };
        const order = this.segments.length;
        this.segments.push(s);
        if (a.y === b.y) line(this.rows, a.y).add(s, order);
        else if (a.x === b.x) line(this.cols, a.x).add(s, order);
        else if (!keyable(a) || !keyable(b)) this.loose.push(s);
        else {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const steps = gcd(Math.abs(dx), Math.abs(dy));
          for (let k = 0; k <= steps; k++) push(this.slanted, gridKey(a.x + (dx / steps) * k, a.y + (dy / steps) * k), s);
        }
      }
    });
    for (const l of this.rows.values()) l.done((p) => p.x);
    for (const l of this.cols.values()) l.done((p) => p.y);
  }

  /** Segments that pass through or end at p. */
  at(p: Point): readonly Seg[] {
    const h = this.rows.get(p.y)?.at(p.x) ?? [];
    const v = this.cols.get(p.x)?.at(p.y) ?? [];
    let s: readonly Seg[] = keyable(p) ? (this.slanted.get(gridKey(p.x, p.y)) ?? []) : this.segments.filter((t) => t.a.x !== t.b.x && t.a.y !== t.b.y && pointOnSegment(p, t.a, t.b));
    if (this.loose.length && keyable(p)) {
      const extra = this.loose.filter((t) => pointOnSegment(p, t.a, t.b));
      if (extra.length) s = this.segments.filter((t) => s.includes(t) || extra.includes(t));
    }
    if (!v.length && !s.length) return h;
    if (!h.length && !s.length) return v;
    if (!h.length && !v.length) return s;
    return [...h, ...v, ...s];
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

/** Union-find over 0 … n−1 (path halving, union by size). */
class Groups {
  private readonly parent: Int32Array;
  private readonly size: Int32Array;

  constructor(n: number) {
    this.parent = Int32Array.from({ length: n }, (_, i) => i);
    this.size = new Int32Array(n).fill(1);
  }

  find(x: number): number {
    const parent = this.parent;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  }

  union(a: number, b: number): void {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    if (this.size[ra]! < this.size[rb]!) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    this.size[ra]! += this.size[rb]!;
  }
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
 *
 * Each point where a segment ends is visited once, and every segment through it joins the first one
 * there, so k segments meeting at one point (wires drawn over each other, say) cost k steps, not k².
 */
export function findIslands(wires: readonly (readonly Point[])[], anchors: readonly Point[], index: SegmentIndex = new SegmentIndex(wires)): Islands {
  // Wire i is i; anchor i is wires.length + i.
  const groups = new Groups(wires.length + anchors.length);
  const visited = new Set<number | string>();
  for (const s of index.segments) {
    for (const end of [s.a, s.b]) {
      const key = pointId(end);
      if (visited.has(key)) continue;
      visited.add(key);
      const here = index.at(end);
      for (const other of here) groups.union(here[0]!.wire, other.wire);
    }
  }
  const byPoint = new Map<number | string, number>();
  anchors.forEach((p, i) => {
    const key = pointId(p);
    const same = byPoint.get(key);
    // An anchor where another already is joins it, and with it the wires there.
    if (same !== undefined) groups.union(wires.length + i, wires.length + same);
    else {
      byPoint.set(key, i);
      for (const s of index.at(p)) groups.union(wires.length + i, s.wire);
    }
  });
  const numbers = new Map<number, number>();
  const number = (id: number): number => {
    const root = groups.find(id);
    let n = numbers.get(root);
    if (n === undefined) {
      n = numbers.size;
      numbers.set(root, n);
    }
    return n;
  };
  const wireIslands = wires.map((_, i) => number(i));
  const anchorIslands = anchors.map((_, i) => number(wires.length + i));
  return {
    wires: wireIslands,
    anchors: anchorIslands,
    count: numbers.size,
    at(p: Point): number | undefined {
      const s = index.at(p)[0];
      if (s) return wireIslands[s.wire];
      const a = byPoint.get(pointId(p));
      return a === undefined ? undefined : anchorIslands[a];
    },
    allAt(p: Point): number[] {
      const out = new Set(index.at(p).map((s) => wireIslands[s.wire]!));
      const a = byPoint.get(pointId(p));
      if (a !== undefined) out.add(anchorIslands[a]!);
      return [...out];
    },
  };
}

/** How many wire ends, wire sides and pins meet at each point that is a wire end, a corner or a pin. */
function arms(index: SegmentIndex, pins: readonly Point[]): Map<number | string, { at: Point; arms: number; pins: number }> {
  const out = new Map<number | string, { at: Point; arms: number; pins: number }>();
  const visit = (p: Point): void => {
    const key = pointId(p);
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
    const e = out.get(pointId(p))!;
    e.arms += 1;
    e.pins += 1;
  }
  return out;
}

/** Where junction dots go: three or more wire ends, wire sides or pins at one point. */
export function junctionPoints(wires: readonly (readonly Point[])[], pins: readonly Point[]): Point[] {
  return wireEnds(new SegmentIndex(wires), pins).junctions;
}

/** Wire ends that touch nothing: no pin, no other wire. */
export function danglingEnds(wires: readonly (readonly Point[])[], pins: readonly Point[]): Point[] {
  return wireEnds(new SegmentIndex(wires), pins).dangling;
}

/** Both of the above at once, from the wires already indexed (a scene needs both). */
export function wireEnds(index: SegmentIndex, pins: readonly Point[]): { junctions: Point[]; dangling: Point[] } {
  const all = [...arms(index, pins).values()];
  return { junctions: all.filter((e) => e.arms >= 3).map((e) => e.at), dangling: all.filter((e) => e.arms === 1 && e.pins === 0).map((e) => e.at) };
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
