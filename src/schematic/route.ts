/**
 * Wire routing: an orthogonal wire on the grid from one piece of a node's copper to another, as
 * short as possible with as few bends and crossings as possible (A* search). Plain TypeScript.
 *
 * What a new wire may not do, so that it never changes what the drawing connects:
 * - enter a symbol (body and leads), except at the pin it starts or ends at;
 * - touch another node's pins, wire ends or corners, or run along another node's wire;
 * - turn, start or end on another node's wire (crossing it straight is allowed, with a cost);
 * - leave or reach a pin from the side: a wire meets a pin along the pin's lead.
 * Text boxes are avoided when possible (a cost, not a wall).
 */
import { DIRECTION_VECTORS, DIRECTIONS, OPPOSITE, isOrthogonal, segmentCrossesBox, segmentsOf, simplifyPolyline, type Box, type Direction, type Point } from './geometry.ts';

export interface RouteEnd {
  at: Point;
  /**
   * For a pin: the direction a wire leaves it in (outwards along its lead). A route starts from
   * such a source in that direction and arrives at such a target moving the opposite way.
   */
  outward?: Direction;
  /** The pin already has a wire: other directions are allowed, at a cost (a T right at a pin reads worse). */
  soft?: boolean;
  /**
   * The cost of leaving or reaching the pin in another direction than along its lead (an L at the
   * pin). Default: ROUTE_COSTS.pinSide for a soft pin, never for another pin.
   */
  sideCost?: number;
}

export interface RouteWorld {
  /** Boxes a wire must not enter: symbols (their pins are on the edge, so they stay reachable). */
  walls: readonly Box[];
  /** Boxes a wire should avoid: text. */
  avoid: readonly Box[];
  /** Other nodes' wires. */
  foreignWires: readonly (readonly Point[])[];
  /** Other nodes' pins (part pins and ground pins). */
  foreignPins: readonly Point[];
  /** The area to search, in grid units. */
  bounds: Box;
}

export const ROUTE_COSTS = { step: 1, bend: 2, cross: 4, avoid: 6, pinSide: 2, bareSide: 6 } as const;

/**
 * How much work one route may do, and (written back) how much it did. Work is the search steps
 * plus a sixteenth of the cells of the area searched (setting up a large area costs time too: about
 * that much, measured against a search step).
 */
export interface RouteBudget {
  /** Most work (default 100 000). */
  steps?: number;
  /** The work the route did. */
  used?: number;
}

const EXPANSION_LIMIT = 100_000;

/**
 * The largest area one route may search, in grid cells (500 × 500). A route between pieces farther
 * apart is not searched (undefined): the schematic then joins them by name. This keeps the memory and
 * the time of a route small whatever the drawing lines say.
 */
export const MAX_ROUTE_CELLS = 250_000;

/**
 * Search states by cost so far plus distance left (f), then nearest the target (h), then first found
 * (order): among equally good states, the one nearer the target first, so in open space the search
 * runs straight to it instead of filling the whole rectangle between the two pieces. No two states
 * share an order, so the state taken next is always the one least by these three, whatever the heap's
 * inner order. Kept in flat arrays: an object per state pushed, and one per swap, made a route of a
 * hundred thousand steps a third of a second of collecting garbage (the second re-check's critic).
 */
class Heap {
  private f = new Float64Array(256);
  private h = new Float64Array(256);
  private order = new Float64Array(256);
  private state = new Int32Array(256);
  size = 0;

  /** True when entry i comes before the state (f, h, order). */
  private before(i: number, f: number, h: number, order: number): boolean {
    const fi = this.f[i]!;
    if (fi !== f) return fi < f;
    const hi = this.h[i]!;
    return hi !== h ? hi < h : this.order[i]! < order;
  }

  private put(i: number, f: number, h: number, order: number, state: number): void {
    this.f[i] = f;
    this.h[i] = h;
    this.order[i] = order;
    this.state[i] = state;
  }

  private move(from: number, to: number): void {
    this.put(to, this.f[from]!, this.h[from]!, this.order[from]!, this.state[from]!);
  }

  push(f: number, h: number, order: number, state: number): void {
    if (this.size === this.state.length) {
      const grow = <T extends Float64Array<ArrayBuffer> | Int32Array<ArrayBuffer>>(a: T, make: (n: number) => T): T => {
        const b = make(2 * a.length);
        b.set(a);
        return b;
      };
      this.f = grow(this.f, (n) => new Float64Array(n));
      this.h = grow(this.h, (n) => new Float64Array(n));
      this.order = grow(this.order, (n) => new Float64Array(n));
      this.state = grow(this.state, (n) => new Int32Array(n));
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.before(parent, f, h, order)) break;
      this.move(parent, i);
      i = parent;
    }
    this.put(i, f, h, order, state);
  }

  /** The state of the entry that comes first, taken off the heap (the heap must not be empty). */
  pop(): number {
    const top = this.state[0]!;
    const n = --this.size;
    if (n > 0) {
      const f = this.f[n]!;
      const h = this.h[n]!;
      const order = this.order[n]!;
      const state = this.state[n]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && this.before(r, this.f[l]!, this.h[l]!, this.order[l]!) ? r : l;
        if (!this.before(m, f, h, order)) break;
        this.move(m, i);
        i = m;
      }
      this.put(i, f, h, order, state);
    }
    return top;
  }
}

const DIR_INDEX: Readonly<Record<Direction, number>> = { up: 0, right: 1, down: 2, left: 3 };
const START = 4;

/**
 * The best orthogonal route from any source to any target, as a polyline from a source to a target;
 * [] when a source already is a target; undefined when there is no route inside the bounds, or the
 * bounds cover more than MAX_ROUTE_CELLS.
 */
export function findRoute(world: RouteWorld, sources: readonly RouteEnd[], targets: readonly RouteEnd[], budget: RouteBudget = {}): Point[] | undefined {
  budget.used = 0;
  if (sources.length === 0 || targets.length === 0) return undefined;
  const bx0 = Math.floor(world.bounds.x0);
  const by0 = Math.floor(world.bounds.y0);
  const bx1 = Math.ceil(world.bounds.x1);
  const by1 = Math.ceil(world.bounds.y1);
  const width = bx1 - bx0 + 1;
  const height = by1 - by0 + 1;
  if (!(width > 0 && height > 0 && width * height <= MAX_ROUTE_CELLS)) {
    const targetKeys = new Set(targets.map((t) => `${t.at.x},${t.at.y}`));
    return sources.some((s) => targetKeys.has(`${s.at.x},${s.at.y}`)) ? [] : undefined;
  }
  const inBounds = (x: number, y: number): boolean => x >= bx0 && x <= bx1 && y >= by0 && y <= by1;
  const cell = (x: number, y: number): number => (x - bx0) * height + (y - by0);

  // A pin entry wins over a plain wire point at the same place; a stricter pin over a looser one.
  // `side` is the cost of leaving or reaching it across its lead (Infinity: never).
  const sideOf = (e: RouteEnd): number => e.sideCost ?? (e.soft ? ROUTE_COSTS.pinSide : Infinity);
  const merge = (m: Map<number, { dir: Direction | 'any'; side: number }>, c: number, dir: Direction | 'any', side: number): void => {
    const had = m.get(c);
    if (!had || (had.dir === 'any' && dir !== 'any') || (dir !== 'any' && side > had.side)) m.set(c, { dir, side });
  };
  const targetAt = new Map<number, { dir: Direction | 'any'; side: number }>();
  for (const t of targets) {
    if (!inBounds(t.at.x, t.at.y) || !Number.isInteger(t.at.x) || !Number.isInteger(t.at.y)) continue;
    // Arriving at a pin means moving towards it along its lead: against its outward direction.
    merge(targetAt, cell(t.at.x, t.at.y), t.outward ? OPPOSITE[t.outward] : 'any', sideOf(t));
  }
  const sourceAt = new Map<number, { dir: Direction | 'any'; side: number }>();
  for (const s of sources) {
    if (!inBounds(s.at.x, s.at.y) || !Number.isInteger(s.at.x) || !Number.isInteger(s.at.y)) continue;
    const c = cell(s.at.x, s.at.y);
    if (targetAt.has(c)) return [];
    merge(sourceAt, c, s.outward ?? 'any', sideOf(s));
  }
  if (sourceAt.size === 0 || targetAt.size === 0) return undefined;

  // Walls: grid points strictly inside a symbol, other nodes' pins and wire corners and ends.
  const cells = width * height;
  // Setting up the area is work too: a route over a large area may not start at all.
  const setup = Math.ceil(cells / 16);
  const limit = budget.steps ?? EXPANSION_LIMIT;
  budget.used = setup;
  if (setup > limit) return undefined;
  const blocked = new Uint8Array(cells);
  // Unit edges that may not be used (through a symbol, along another node's wire): index 2·cell
  // for the edge to the right of a cell, 2·cell + 1 for the edge below it.
  const blockedEdge = new Uint8Array(cells * 2);
  // Points inside another node's wire: crossing straight through only.
  const crossing = new Uint8Array(cells);
  const extra = new Float64Array(cells);
  const extraEdge = new Float64Array(cells * 2);
  const edgeIndex = (x: number, y: number, horizontal: boolean): number => cell(x, y) * 2 + (horizontal ? 0 : 1);

  const markBox = (box: Box, cost: number | undefined): void => {
    const x0 = Math.max(bx0, Math.floor(box.x0));
    const x1 = Math.min(bx1, Math.ceil(box.x1));
    const y0 = Math.max(by0, Math.floor(box.y0));
    const y1 = Math.min(by1, Math.ceil(box.y1));
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1) {
          if (cost === undefined) blocked[cell(x, y)] = 1;
          else extra[cell(x, y)] = extra[cell(x, y)]! + cost;
        }
        if (x < bx1 && segmentCrossesBox({ x, y }, { x: x + 1, y }, box)) {
          if (cost === undefined) blockedEdge[edgeIndex(x, y, true)] = 1;
          else extraEdge[edgeIndex(x, y, true)] = extraEdge[edgeIndex(x, y, true)]! + cost;
        }
        if (y < by1 && segmentCrossesBox({ x, y }, { x, y: y + 1 }, box)) {
          if (cost === undefined) blockedEdge[edgeIndex(x, y, false)] = 1;
          else extraEdge[edgeIndex(x, y, false)] = extraEdge[edgeIndex(x, y, false)]! + cost;
        }
      }
    }
  };
  const outside = (b: Box): boolean => b.x1 < bx0 || b.x0 > bx1 || b.y1 < by0 || b.y0 > by1;
  for (const box of world.walls) if (!outside(box)) markBox(box, undefined);
  for (const box of world.avoid) if (!outside(box)) markBox(box, ROUTE_COSTS.avoid);
  for (const p of world.foreignPins) if (inBounds(p.x, p.y)) blocked[cell(p.x, p.y)] = 1;
  for (const w of world.foreignWires) {
    for (const p of w) if (inBounds(p.x, p.y)) blocked[cell(p.x, p.y)] = 1;
    for (const [a, b] of segmentsOf(w)) {
      if (!isOrthogonal(a, b)) continue;
      const horizontal = a.y === b.y;
      const fixed = horizontal ? a.y : a.x;
      if (horizontal ? fixed < by0 || fixed > by1 : fixed < bx0 || fixed > bx1) continue;
      const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
      const hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
      const from = Math.max(lo, horizontal ? bx0 : by0);
      const to = Math.min(hi, horizontal ? bx1 : by1);
      for (let k = from; k <= to; k++) {
        const x = horizontal ? k : fixed;
        const y = horizontal ? fixed : k;
        if (k < hi) blockedEdge[edgeIndex(x, y, horizontal)] = 1;
        if (k > lo && k < hi) crossing[cell(x, y)] = 1;
      }
    }
  }

  // Heuristic: distance to the nearest target (or to their bounding box when there are many).
  const tList = [...targetAt.keys()].map((c) => ({ x: Math.floor(c / height) + bx0, y: (c % height) + by0 }));
  const tx0 = Math.min(...tList.map((t) => t.x));
  const tx1 = Math.max(...tList.map((t) => t.x));
  const ty0 = Math.min(...tList.map((t) => t.y));
  const ty1 = Math.max(...tList.map((t) => t.y));
  const h = (x: number, y: number): number => {
    if (tList.length > 48) return Math.max(0, tx0 - x, x - tx1) + Math.max(0, ty0 - y, y - ty1);
    let best = Infinity;
    for (const t of tList) best = Math.min(best, Math.abs(t.x - x) + Math.abs(t.y - y));
    return best;
  };

  const states = width * height * 5;
  const g = new Float64Array(states).fill(Infinity);
  const parent = new Int32Array(states).fill(-1);
  const closed = new Uint8Array(states);
  const heap = new Heap();
  let order = 0;
  for (const [c] of sourceAt) {
    const s = c * 5 + START;
    g[s] = 0;
    const x = Math.floor(c / height) + bx0;
    const y = (c % height) + by0;
    heap.push(h(x, y), h(x, y), order++, s);
  }

  let found = -1;
  let expansions = 0;
  while (heap.size > 0) {
    const s = heap.pop();
    if (closed[s]) continue;
    closed[s] = 1;
    budget.used = setup + ++expansions;
    if (budget.used > limit) break;
    const c = Math.floor(s / 5);
    const d = s % 5;
    const x = Math.floor(c / height) + bx0;
    const y = (c % height) + by0;
    if (d !== START) {
      const want = targetAt.get(c);
      if (want !== undefined && (want.dir === 'any' || want.side < Infinity || DIR_INDEX[want.dir] === d)) {
        found = s;
        break;
      }
    }
    const first = d === START ? sourceAt.get(c) : undefined;
    for (const nd of DIRECTIONS) {
      const ni = DIR_INDEX[nd];
      if (first && first.dir !== 'any' && first.dir !== nd && first.side === Infinity) continue;
      if (d !== START && crossing[c] && ni !== d) continue; // only straight through another node's wire
      if (d !== START && ni === (d + 2) % 4) continue; // no turning back
      const v = DIRECTION_VECTORS[nd];
      const nx = x + v.x;
      const ny = y + v.y;
      if (!inBounds(nx, ny)) continue;
      const nc = cell(nx, ny);
      const want = targetAt.get(nc);
      if (want !== undefined && want.dir !== 'any' && want.dir !== nd && want.side === Infinity) continue; // a pin is reached along its lead
      if (want === undefined && (blocked[nc] || sourceAt.has(nc))) continue;
      const horizontal = v.y === 0;
      const ek = edgeIndex(Math.min(x, nx), Math.min(y, ny), horizontal);
      if (blockedEdge[ek]) continue;
      if (want !== undefined && crossing[nc]) continue;
      let cost = ROUTE_COSTS.step + extra[nc]! + extraEdge[ek]!;
      if (first && first.dir !== 'any' && first.dir !== nd) cost += first.side;
      if (want && want.dir !== 'any' && want.dir !== nd) cost += want.side;
      if (d !== START && ni !== d) cost += ROUTE_COSTS.bend;
      if (crossing[nc]) cost += ROUTE_COSTS.cross;
      const ns = nc * 5 + ni;
      const ng = g[s]! + cost;
      if (ng < g[ns]!) {
        g[ns] = ng;
        parent[ns] = s;
        const hn = h(nx, ny);
        heap.push(ng + hn, hn, order++, ns);
      }
    }
  }
  if (found < 0) return undefined;
  const points: Point[] = [];
  for (let s = found; s >= 0; s = parent[s]!) {
    const c = Math.floor(s / 5);
    points.push({ x: Math.floor(c / height) + bx0, y: (c % height) + by0 });
    if (s % 5 === START) break;
  }
  points.reverse();
  return simplifyPolyline(points);
}
