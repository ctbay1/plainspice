/**
 * Automatic layout for small circuits (up to about 20 parts), drawn the way textbooks and the
 * channel's videos draw them. Plain TypeScript: no DOM. Same circuit, same drawing: every choice
 * follows netlist order.
 *
 * The drawing is a ladder:
 * - the bottom rail is ground (node 0), or, in a circuit without ground, the − side of its first
 *   source;
 * - the top rail is the spine: a chain of nodes joined by parts in series, left to right, starting
 *   at the first independent source (V or I), which stands on the left, upright, + at the top;
 * - a part from a spine node to the rail stands upright below it; parts in parallel stand side by
 *   side; a short chain of parts from a spine node down to the rail (R2 then H1) stands as one column;
 * - a part between spine nodes that are not neighbours, or a second part between neighbours, goes on
 *   a rail above (a bridge), higher levels for longer bridges;
 * - a node with one connection (an open terminal such as "a") ends the spine on the right, as a
 *   terminal with its name;
 * - circuits that only meet at the rail (the four dependent-source examples) stand side by side on
 *   one shared rail.
 * Several spines are tried (every path of series parts from the first source) and the one that
 * leaves the fewest parts outside this pattern, the lowest drawing and an open terminal at the right
 * end wins. Parts outside the pattern are placed one by one next to their nodes (`placeParts`) and
 * wired by the router when the schematic is built. Spacing grows until no symbol, wire or label
 * overlaps another.
 */
import type { Circuit, CircuitPart } from './circuit.ts';
import { GROUND } from './circuit.ts';
import { SegmentIndex } from './connectivity.ts';
import { emptyDrawing, symbolGeometry, type Drawing } from './drawing.ts';
import { DIRECTION_VECTORS, boxContains, boxesOverlap, inflate, pointKey, pt, segmentCrossesBox, segmentsOf, type Box, type Point, type Rotation } from './geometry.ts';
import { buildScene, defaultSide, findOverlaps, partLabelLines, partLabelSpecs, resultRoomOf, type Scene, type SceneItem, type SceneOptions } from './scene.ts';
import { isIndependentSource } from './symbols.ts';
import { TEXT, defaultMeasure, type Measure } from './text.ts';

export type LayoutOptions = SceneOptions;

/** The least distance from the top rail (y = 0) down to the bottom rail: one upright part and its wires. */
const MIN_RAIL_HEIGHT = 6;
const SPINE_CANDIDATES = 4000;
/** Node names textbooks give to a circuit's terminals. */
const TERMINAL_NAMES = new Set(['a', 'b', 'out', 'vout', 'vo', 'o']);
const SPACING_ROUNDS = 80;

interface Down {
  /** Parts from the top down; stack[j] goes from the node above it to joints[j]. */
  stack: CircuitPart[];
  joints: string[];
  /** Parts in parallel from the last joint to the rail, side by side (two or more). */
  fan: CircuitPart[];
  bottom: 'rail' | 'open' | 'fan';
}

interface Bridge {
  from: number;
  to: number;
  /** Left to right. */
  parts: CircuitPart[];
  /** The nodes between consecutive parts. */
  joints: string[];
  level: number;
}

interface BlockPlan {
  nodes: Set<string>;
  spine: string[];
  /** links[i]: the part between spine[i] and spine[i + 1]. */
  links: CircuitPart[];
  downs: Down[][];
  bridges: Bridge[];
  leftovers: CircuitPart[];
  score: number;
}

interface Graph {
  rail: string;
  parts: CircuitPart[];
  /** Pins per node. */
  degree: Map<string, number>;
}

/** The node the bottom rail stands for. */
export function chooseRail(circuit: Circuit): string | undefined {
  if (circuit.parts.length === 0) return undefined;
  if (circuit.hasGround) return GROUND;
  const source = circuit.parts.find((p) => isIndependentSource(p.letter));
  // The − side of a voltage source, the "from" side of a current source (so its arrow points up).
  if (source) return source.letter === 'V' ? source.nodes[1] : source.nodes[0];
  let best: string | undefined;
  let most = -1;
  for (const node of circuit.nodes.values()) {
    if (node.pins.length > most) {
      best = node.name;
      most = node.pins.length;
    }
  }
  return best;
}

/** Upright part from `upper` (top pin) down to the other node: rotation 0 when its first node is at the top. */
const uprightRot = (part: CircuitPart, upper: string): Rotation => (part.nodes[0] === upper ? 0 : 180);
/** Part lying from `left` to the other node: its first node on the left (270) or on the right (90). */
const lyingRot = (part: CircuitPart, left: string): Rotation => (part.nodes[0] === left ? 270 : 90);

const other = (part: CircuitPart, node: string): string => (part.nodes[0] === node ? part.nodes[1] : part.nodes[0]);

/** A 0 V source with nothing else on its line: a wire that measures its current (P9). */
const isAmmeter = (p: CircuitPart): boolean => p.letter === 'V' && !p.fn && !p.ac && (p.value === undefined ? p.valueText === '' : p.value === 0);

/**
 * A column of an ammeter and one part to the rail: an ammeter measuring that branch. An ammeter at
 * the bottom of a column whose joint is a terminal (a, out ...) is a short across the terminals
 * instead, which belongs at the right end of the top rail.
 */
const ammeterBranch = (d: { stack: readonly CircuitPart[]; joints: readonly string[]; bottom: string }): boolean =>
  d.bottom === 'rail' && d.stack.length === 2 && (isAmmeter(d.stack[0]!) || (isAmmeter(d.stack[1]!) && !TERMINAL_NAMES.has(d.joints[0]!)));

// ------------------------------------------------------------------ blocks and spines

function blocksOf(g: Graph): { nodes: Set<string>; parts: CircuitPart[] }[] {
  const owner = new Map<string, number>();
  const groups: Set<string>[] = [];
  const find = (n: string): number => {
    let i = owner.get(n);
    if (i === undefined) {
      i = groups.length;
      groups.push(new Set([n]));
      owner.set(n, i);
    }
    return i;
  };
  for (const p of g.parts) {
    const [a, b] = p.nodes;
    if (a !== g.rail) find(a);
    if (b !== g.rail) find(b);
    if (a === g.rail || b === g.rail || a === b) continue;
    const ia = find(a);
    const ib = find(b);
    if (ia === ib) continue;
    const [keep, drop] = ia < ib ? [ia, ib] : [ib, ia];
    for (const n of groups[drop]!) {
      groups[keep]!.add(n);
      owner.set(n, keep);
    }
    groups[drop]!.clear();
  }
  const out: { nodes: Set<string>; parts: CircuitPart[] }[] = [];
  const index = new Map<number, number>();
  for (const p of g.parts) {
    const n = p.nodes[0] !== g.rail ? p.nodes[0] : p.nodes[1];
    if (n === g.rail) continue; // both pins on the rail
    const gi = owner.get(n)!;
    let bi = index.get(gi);
    if (bi === undefined) {
      bi = out.length;
      index.set(gi, bi);
      out.push({ nodes: groups[gi]!, parts: [] });
    }
    out[bi]!.parts.push(p);
  }
  return out;
}

function adjacency(parts: readonly CircuitPart[], rail: string): Map<string, { part: CircuitPart; to: string }[]> {
  const adj = new Map<string, { part: CircuitPart; to: string }[]>();
  for (const p of parts) {
    const [a, b] = p.nodes;
    if (a === rail || b === rail || a === b) continue;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push({ part: p, to: b });
    (adj.get(b) ?? adj.set(b, []).get(b)!).push({ part: p, to: a });
  }
  return adj;
}

/** Every simple path of series parts from `start` (as node lists), depth first in netlist order. */
function spinePaths(start: string, adj: Map<string, { part: CircuitPart; to: string }[]>): string[][] {
  const out: string[][] = [];
  const path = [start];
  const on = new Set([start]);
  const walk = (): void => {
    if (out.length >= SPINE_CANDIDATES) return;
    out.push(path.slice());
    const last = path[path.length - 1]!;
    for (const { to } of adj.get(last) ?? []) {
      if (on.has(to)) continue;
      path.push(to);
      on.add(to);
      walk();
      path.pop();
      on.delete(to);
      if (out.length >= SPINE_CANDIDATES) return;
    }
  };
  walk();
  return out;
}

/** Splits a block into spine links, columns down to the rail, bridges and leftovers, and scores it. */
function plan(block: { nodes: Set<string>; parts: CircuitPart[] }, spine: string[], g: Graph, main: CircuitPart | undefined): BlockPlan {
  const rail = g.rail;
  const at = new Map(spine.map((n, i) => [n, i]));
  const links: (CircuitPart | undefined)[] = spine.slice(1).map(() => undefined);
  const downs: Down[][] = spine.map(() => []);
  const bridges: Bridge[] = [];
  const leftovers: CircuitPart[] = [];
  const satelliteParts: CircuitPart[] = [];
  for (const p of block.parts) {
    const [a, b] = p.nodes;
    const ia = at.get(a);
    const ib = at.get(b);
    if (a === b) {
      leftovers.push(p);
    } else if (ia !== undefined && ib !== undefined) {
      const lo = Math.min(ia, ib);
      const hi = Math.max(ia, ib);
      if (hi === lo + 1 && !links[lo]) links[lo] = p;
      else bridges.push({ from: lo, to: hi, parts: [p], joints: [], level: 0 });
    } else if ((a === rail && ib !== undefined) || (b === rail && ia !== undefined)) {
      const i = (ia ?? ib)!;
      const d: Down = { stack: [p], joints: [rail], fan: [], bottom: 'rail' };
      if (p === main) downs[i]!.unshift(d);
      else downs[i]!.push(d);
    } else satelliteParts.push(p);
  }

  // The nodes off the spine, in groups joined by parts between them.
  const satellites = [...block.nodes].filter((n) => !at.has(n));
  const comp = new Map<string, number>();
  satellites.forEach((n, i) => comp.set(n, i));
  const join = (x: number, y: number): void => {
    const keep = Math.min(x, y);
    const drop = Math.max(x, y);
    for (const [n, c] of comp) if (c === drop) comp.set(n, keep);
  };
  for (const p of satelliteParts) {
    const ca = comp.get(p.nodes[0]);
    const cb = comp.get(p.nodes[1]);
    if (ca !== undefined && cb !== undefined && ca !== cb) join(ca, cb);
  }
  const groups = new Map<number, { nodes: string[]; parts: CircuitPart[] }>();
  for (const p of satelliteParts) {
    const c = comp.get(p.nodes[0]) ?? comp.get(p.nodes[1])!;
    let gr = groups.get(c);
    if (!gr) {
      gr = { nodes: satellites.filter((n) => comp.get(n) === c), parts: [] };
      groups.set(c, gr);
    }
    gr.parts.push(p);
  }
  for (const gr of groups.values()) {
    const inside = new Set(gr.nodes);
    const internal = gr.parts.filter((p) => inside.has(p.nodes[0]) && inside.has(p.nodes[1]));
    const attach = gr.parts.filter((p) => inside.has(p.nodes[0]) !== inside.has(p.nodes[1]) && (at.has(p.nodes[0]) || at.has(p.nodes[1])));
    const shunts = gr.parts.filter((p) => (inside.has(p.nodes[0]) && p.nodes[1] === rail) || (inside.has(p.nodes[1]) && p.nodes[0] === rail));
    const path = simplePath(gr.nodes, internal);
    const fits = path && internal.every((p) => p.nodes[0] !== p.nodes[1]);
    if (fits && attach.length === 1) {
      const a = attach[0]!;
      const top = at.has(a.nodes[0]) ? a.nodes[0] : a.nodes[1];
      const entry = other(a, top);
      const ordered = path!.nodes[0] === entry ? path! : path!.nodes[path!.nodes.length - 1] === entry ? reversePath(path!) : undefined;
      const end = ordered?.nodes[ordered.nodes.length - 1];
      if (ordered && shunts.every((s) => s.nodes.includes(end!))) {
        const stack = [a, ...ordered.parts];
        const joints = ordered.nodes.slice();
        const d: Down = { stack, joints, fan: [], bottom: 'open' };
        if (shunts.length === 1) {
          d.stack.push(shunts[0]!);
          d.joints.push(rail);
          d.bottom = 'rail';
        } else if (shunts.length > 1) {
          d.fan = shunts;
          d.bottom = 'fan';
        }
        downs[at.get(top)!]!.push(d);
        continue;
      }
    }
    if (fits && attach.length === 2 && shunts.length === 0) {
      const [a1, a2] = attach as [CircuitPart, CircuitPart];
      const s1 = at.has(a1.nodes[0]) ? a1.nodes[0] : a1.nodes[1];
      const s2 = at.has(a2.nodes[0]) ? a2.nodes[0] : a2.nodes[1];
      const i1 = at.get(s1)!;
      const i2 = at.get(s2)!;
      if (i1 !== i2) {
        const [left, right] = i1 < i2 ? [a1, a2] : [a2, a1];
        const leftNode = i1 < i2 ? s1 : s2;
        const entry = other(left, leftNode);
        const ordered = path!.nodes[0] === entry ? path! : reversePath(path!);
        const rightEntry = other(right, i1 < i2 ? s2 : s1);
        if (ordered.nodes[0] === entry && ordered.nodes[ordered.nodes.length - 1] === rightEntry) {
          bridges.push({ from: Math.min(i1, i2), to: Math.max(i1, i2), parts: [left, ...ordered.parts, right], joints: ordered.nodes.slice(), level: 0 });
          continue;
        }
      }
    }
    leftovers.push(...gr.parts);
  }

  // Columns under a node stand in netlist order (the main source first), like the parts in the text.
  const firstLine = (d: Down): number => Math.min(...[...d.stack, ...d.fan].map((p) => p.line));
  for (const ds of downs) {
    const mainFirst = ds[0]?.stack[0] === main && main !== undefined ? ds.shift() : undefined;
    ds.sort((a, b) => firstLine(a) - firstLine(b));
    if (mainFirst) ds.unshift(mainFirst);
  }

  const lastDowns = downs[spine.length - 1]!;
  const lastNode = spine[spine.length - 1]!;
  const openEnd = spine.length > 1 && lastDowns.length === 0 && !bridges.some((b) => b.to === spine.length - 1) && (g.degree.get(lastNode) ?? 0) === 1;
  let height = 0;
  let open = 0;
  let buried = 0;
  let ammeters = 0;
  for (const ds of downs) {
    for (const d of ds) {
      height += d.stack.length - 1 + (d.bottom === 'fan' ? 1 : 0);
      if (d.bottom === 'open') open += 1;
      // A 0 V source in series with one part to the rail measures that branch: textbooks draw it in
      // the branch, one column, rather than on the top rail.
      if (ammeterBranch(d)) ammeters += 1;
      // An independent source in series inside a column reads worse than one standing on the rail at a spine node.
      else if (d.stack.length > 1) buried += [...d.stack, ...d.fan].filter((p) => isIndependentSource(p.letter)).length;
    }
  }
  // Tie-break: the channel's terminals (a, b, out) belong at the right end of the spine.
  const terminalName = spine.length > 1 && TERMINAL_NAMES.has(lastNode);
  const score = 10 * spine.length - 100 * leftovers.length - 3 * bridges.length - 4 * height - 8 * open + (openEnd ? 6 : 0) - buried + 15 * ammeters + (terminalName ? 0.5 : 0);
  return { nodes: block.nodes, spine, links: links as CircuitPart[], downs, bridges, leftovers, score };
}

interface PathOf {
  nodes: string[];
  /** parts[i] joins nodes[i] and nodes[i + 1]. */
  parts: CircuitPart[];
}

/** The nodes in order when the parts join them in one simple path (one part per step), else undefined. */
function simplePath(nodes: readonly string[], parts: readonly CircuitPart[]): PathOf | undefined {
  if (parts.length !== nodes.length - 1) return undefined;
  if (nodes.length === 1) return { nodes: nodes.slice(), parts: [] };
  const adj = new Map<string, { part: CircuitPart; to: string }[]>();
  for (const p of parts) {
    (adj.get(p.nodes[0]) ?? adj.set(p.nodes[0], []).get(p.nodes[0])!).push({ part: p, to: p.nodes[1] });
    (adj.get(p.nodes[1]) ?? adj.set(p.nodes[1], []).get(p.nodes[1])!).push({ part: p, to: p.nodes[0] });
  }
  if ([...adj.values()].some((l) => l.length > 2)) return undefined;
  const start = nodes.find((n) => (adj.get(n)?.length ?? 0) === 1);
  if (!start) return undefined;
  const out: PathOf = { nodes: [start], parts: [] };
  let prev: CircuitPart | undefined;
  let cur = start;
  for (;;) {
    const step = (adj.get(cur) ?? []).find((s) => s.part !== prev);
    if (!step) break;
    out.parts.push(step.part);
    out.nodes.push(step.to);
    prev = step.part;
    cur = step.to;
  }
  return out.nodes.length === nodes.length ? out : undefined;
}

const reversePath = (p: PathOf): PathOf => ({ nodes: p.nodes.slice().reverse(), parts: p.parts.slice().reverse() });

// ------------------------------------------------------------------ geometry

type Slot =
  | { kind: 'station'; block: number; node: number; down?: Down; ups: { bridge: Bridge; end: 'from' | 'to' }[] }
  | { kind: 'fan'; block: number; node: number; down: Down; index: number }
  | { kind: 'series'; block: number; link: number };

interface Ladder {
  g: Graph;
  plans: BlockPlan[];
  slots: Slot[];
  /** First slot of each block. */
  blockStart: number[];
  mainSource?: CircuitPart;
}

/** Rows a column of parts needs between the top rail (y = 0) and the bottom rail. */
function columnNeed(d: Down): number {
  const n = d.stack.length + (d.bottom === 'fan' ? 1 : 0);
  return 2 + 4 * n + (n - 1) + (d.bottom === 'fan' ? 1 : 0) + (d.bottom === 'open' ? 2 : 0);
}

function slotsOf(plans: readonly BlockPlan[]): { slots: Slot[]; blockStart: number[] } {
  const slots: Slot[] = [];
  const blockStart: number[] = [];
  plans.forEach((p, b) => {
    blockStart.push(slots.length);
    const last = p.spine.length - 1;
    p.spine.forEach((_, i) => {
      const ds = p.downs[i]!;
      const starts = p.bridges.filter((br) => br.from === i).map((bridge) => ({ bridge, end: 'from' as const }));
      const ends = p.bridges.filter((br) => br.to === i).map((bridge) => ({ bridge, end: 'to' as const }));
      if (ds.length === 0) {
        slots.push({ kind: 'station', block: b, node: i, ups: [...ends, ...starts] });
      } else {
        const own: Slot[] = [];
        // Bridges meet the first and last spine nodes at their corner columns, other nodes at a column of their own.
        if (i > 0 && i < last && ends.length) own.push({ kind: 'station', block: b, node: i, ups: ends });
        for (const d of ds) {
          own.push({ kind: 'station', block: b, node: i, down: d, ups: [] });
          d.fan.slice(1).forEach((_, k) => own.push({ kind: 'fan', block: b, node: i, down: d, index: k + 1 }));
        }
        if (i > 0 && i < last && starts.length) own.push({ kind: 'station', block: b, node: i, ups: starts });
        const stations = own.filter((s): s is Extract<Slot, { kind: 'station' }> => s.kind === 'station');
        if (i === 0) stations[0]!.ups.push(...starts);
        if (i === last) stations[stations.length - 1]!.ups.push(...ends);
        slots.push(...own);
      }
      if (i < last) slots.push({ kind: 'series', block: b, link: i });
    });
  });
  return { slots, blockStart };
}

/** Bridge levels: shorter bridges lower; bridges whose spans overlap get different levels. */
function assignLevels(bridges: Bridge[]): void {
  const order = bridges.slice().sort((a, b) => a.to - a.from - (b.to - b.from) || a.from - b.from);
  const placed: Bridge[] = [];
  for (const br of order) {
    let level = 1;
    for (const other of placed) if (other.from < br.to && br.from < other.to) level = Math.max(level, other.level + 1);
    br.level = level;
    placed.push(br);
  }
}

interface Realized {
  drawing: Drawing;
  /** The slot each part, ground and node label belongs to, for spreading things apart. */
  slotOf: Map<string, number>;
  /** Bridges whose parts found no room clear of the wires crossing them: they need a wider span. */
  cramped: Bridge[];
}

/**
 * Where the parts of a bridge go between its stations xf and xt: evenly spaced, unless a wire up to
 * a higher bridge (at one of `verticals`) would run through a part or its words (`halves`: half the
 * width each part's words need); then as near as possible to even, clear of those wires. `ok` is
 * false when there is no such room.
 */
export function bridgeCentres(xf: number, xt: number, halves: readonly number[], verticals: readonly number[]): { centres: number[]; ok: boolean } {
  const r = halves.length;
  const ideal = halves.map((_, j) => xf + Math.round(((xt - xf) * (2 * j + 1)) / (2 * r)));
  if (!verticals.length) return { centres: ideal, ok: true };
  const clear = (c: number, half: number): boolean => verticals.every((v) => Math.abs(c - v) >= Math.max(3, Math.ceil(half + 0.5)));
  const out: number[] = [];
  let ok = true;
  for (let j = 0; j < r; j++) {
    const lo = j === 0 ? xf + 3 : out[j - 1]! + 6;
    const hi = xt - 3 - 6 * (r - 1 - j);
    let best: number | undefined;
    for (let c = lo; c <= hi; c++) {
      if (!clear(c, halves[j]!)) continue;
      if (best === undefined || Math.abs(c - ideal[j]!) < Math.abs(best - ideal[j]!)) best = c;
    }
    if (best === undefined) {
      ok = false;
      best = Math.max(lo, Math.min(hi, ideal[j]!));
    }
    out.push(best);
  }
  return { centres: out, ok };
}

function realize(L: Ladder, gaps: readonly number[], H: number, B: number, halfWidth: (p: CircuitPart) => number): Realized {
  const drawing = emptyDrawing();
  const cramped: Bridge[] = [];
  const slotOf = new Map<string, number>();
  const xs: number[] = [];
  let x = 0;
  L.slots.forEach((_, s) => {
    if (s > 0) x += gaps[s - 1]!;
    xs.push(x);
  });
  const place = (part: CircuitPart, at: Point, rot: Rotation, mirror: boolean, slot: number): void => {
    drawing.parts.set(part.key, { at, rot, mirror });
    slotOf.set(`part:${part.key}`, slot);
  };
  const wire = (...points: Point[]): void => {
    if (points.length >= 2 && points.some((p) => p.x !== points[0]!.x || p.y !== points[0]!.y)) drawing.wires.push(points);
  };
  const labelled = new Set<string>();
  const label = (node: string, at: Point, slot: number): void => {
    if (node === L.g.rail && node === GROUND) return;
    if (labelled.has(node)) return;
    labelled.add(node);
    drawing.labels.push({ node, at });
    slotOf.set(`node:${node}`, slot);
  };
  const railColumns: { x: number; slot: number }[] = [];
  const mirrorOf = (part: CircuitPart): boolean => part === L.mainSource;

  const stationX = (b: number, node: number, which: 'first' | 'last'): number => {
    let found: number | undefined;
    L.slots.forEach((s, i) => {
      if (s.kind !== 'station' || s.block !== b || s.node !== node) return;
      if (found === undefined || which === 'last') found = i;
    });
    return xs[found!]!;
  };
  const seriesSlot = (b: number, link: number): number => L.slots.findIndex((s) => s.kind === 'series' && s.block === b && s.link === link);

  L.plans.forEach((p, b) => {
    const last = p.spine.length - 1;
    // The top rail of each spine node, and the parts between them.
    p.spine.forEach((node, i) => {
      const left = i > 0 ? xs[seriesSlot(b, i - 1)]! + 2 : stationX(b, i, 'first');
      const right = i < last ? xs[seriesSlot(b, i)]! - 2 : stationX(b, i, 'last');
      wire(pt(left, 0), pt(right, 0));
      const firstStation = L.slots.findIndex((s) => s.kind === 'station' && s.block === b && s.node === i);
      label(node, pt(stationX(b, i, 'first'), 0), firstStation);
      if (i < last) {
        const s = seriesSlot(b, i);
        const part = p.links[i]!;
        place(part, pt(xs[s]!, 0), lyingRot(part, node), false, s);
      }
    });
    // Columns down to the rail.
    L.slots.forEach((slot, s) => {
      if (slot.kind !== 'station' || slot.block !== b || !slot.down) return;
      const d = slot.down;
      const cx = xs[s]!;
      const off = Math.floor((H - columnNeed(d)) / 2);
      let y = 1 + off;
      wire(pt(cx, 0), pt(cx, y));
      let upper = p.spine[slot.node]!;
      d.stack.forEach((part, j) => {
        place(part, pt(cx, y + 2), uprightRot(part, upper), mirrorOf(part), s);
        const bottom = y + 4;
        const joint = d.joints[j]!;
        if (j < d.stack.length - 1) {
          wire(pt(cx, bottom), pt(cx, bottom + 1));
          label(joint, pt(cx, bottom), s);
          y = bottom + 1;
        } else if (d.bottom === 'rail') {
          wire(pt(cx, bottom), pt(cx, H));
          railColumns.push({ x: cx, slot: s });
        } else if (d.bottom === 'open') {
          wire(pt(cx, bottom), pt(cx, bottom + 1));
          label(joint, pt(cx, bottom + 1), s);
        } else {
          const yj = bottom + 1;
          wire(pt(cx, bottom), pt(cx, yj));
          label(joint, pt(cx, yj), s);
          const fanXs = [cx, ...d.fan.slice(1).map((_, k) => xs[L.slots.findIndex((f) => f.kind === 'fan' && f.down === d && f.index === k + 1)]!)];
          wire(pt(cx, yj), pt(fanXs[fanXs.length - 1]!, yj));
          d.fan.forEach((f, k) => {
            const fx = fanXs[k]!;
            const fs = k === 0 ? s : L.slots.findIndex((sl) => sl.kind === 'fan' && sl.down === d && sl.index === k);
            wire(pt(fx, yj), pt(fx, yj + 1));
            place(f, pt(fx, yj + 3), uprightRot(f, joint), false, fs);
            wire(pt(fx, yj + 5), pt(fx, H));
            railColumns.push({ x: fx, slot: fs });
          });
        }
        upper = joint;
      });
    });
    // Bridges, lowest first; a higher bridge at the same station starts where the lower one turns.
    const reach = new Map<number, number>();
    const byLevel = p.bridges.slice().sort((a, c) => a.level - c.level || a.from - c.from);
    const stationOf = (br: Bridge, end: 'from' | 'to'): number =>
      L.slots.findIndex((s) => s.kind === 'station' && s.block === b && s.ups.some((u) => u.bridge === br && u.end === end));
    for (const br of byLevel) {
      const fromSlot = stationOf(br, 'from');
      const toSlot = stationOf(br, 'to');
      const xf = xs[fromSlot]!;
      const xt = xs[toSlot]!;
      const y = -B * br.level;
      const r = br.parts.length;
      // The wires up to higher bridges cross this one: its parts and their words keep clear of them.
      const verticals = p.bridges
        .filter((o) => o.level > br.level)
        .flatMap((o) => [xs[stationOf(o, 'from')]!, xs[stationOf(o, 'to')]!])
        .filter((x) => x > xf && x < xt);
      const placed = bridgeCentres(xf, xt, br.parts.map(halfWidth), verticals);
      if (!placed.ok) cramped.push(br);
      const centres = placed.centres;
      wire(pt(xf, reach.get(fromSlot) ?? 0), pt(xf, y), pt(centres[0]! - 2, y));
      reach.set(fromSlot, y);
      let left = p.spine[br.from]!;
      br.parts.forEach((part, j) => {
        const mid = Math.min(L.slots.length - 1, fromSlot + 1);
        place(part, pt(centres[j]!, y), lyingRot(part, left), false, mid);
        if (j < r - 1) {
          const joint = br.joints[j]!;
          const a = centres[j]! + 2;
          const c = centres[j + 1]! - 2;
          wire(pt(a, y), pt(c, y));
          label(joint, pt(Math.round((a + c) / 2), y), mid);
          left = joint;
        }
      });
      wire(pt(centres[r - 1]! + 2, y), pt(xt, y), pt(xt, reach.get(toSlot) ?? 0));
      reach.set(toSlot, y);
    }
  });

  if (railColumns.length) {
    const xsRail = railColumns.map((c) => c.x);
    const x0 = Math.min(...xsRail);
    const x1 = Math.max(...xsRail);
    wire(pt(x0, H), pt(x1, H));
    const first = railColumns.find((c) => c.x === x0)!;
    if (L.g.rail === GROUND) {
      drawing.grounds.push({ at: pt(x0, H), rot: 0 });
      slotOf.set('ground:0', first.slot);
    } else label(L.g.rail, pt(x0, H), first.slot);
  }
  return { drawing, slotOf, cramped };
}

function sceneSlot(item: SceneItem, r: Realized): number | undefined {
  switch (item.kind) {
    case 'part':
    case 'part-label':
      return r.slotOf.get(`part:${item.id}`);
    case 'ground':
      return r.slotOf.get(`ground:${item.id}`);
    case 'node-label': {
      const node = item.id.slice(0, item.id.lastIndexOf('#'));
      return r.slotOf.get(`node:${node}`);
    }
    case 'wire':
      return undefined;
  }
}

/** How far a slot's contents reach left and right of its x (symbols and words), estimated. */
function reach(slot: Slot, L: Ladder, results: boolean, measure: Measure, options: LayoutOptions): { left: number; right: number } {
  const parts: { part: CircuitPart; rot: Rotation; mirror: boolean }[] = [];
  if (slot.kind === 'station' && slot.down) {
    for (const p of slot.down.stack) parts.push({ part: p, rot: 0, mirror: p === L.mainSource });
    if (slot.down.fan[0]) parts.push({ part: slot.down.fan[0], rot: 0, mirror: false });
  } else if (slot.kind === 'fan') {
    const f = slot.down.fan[slot.index];
    if (f) parts.push({ part: f, rot: 0, mirror: false });
  } else if (slot.kind === 'series') {
    const p = L.plans[slot.block]!.links[slot.link];
    if (p) parts.push({ part: p, rot: 270, mirror: false });
  }
  let left = 0.5;
  let right = 0.5;
  for (const { part, rot, mirror } of parts) {
    const geom = symbolGeometry(part.letter, pt(0, 0), rot, mirror);
    const lines = partLabelLines(geom, partLabelSpecs(part, results, resultRoomOf(part, options)), defaultSide(rot, mirror), measure);
    for (const b of [geom.box, ...lines.map((l) => l.box)]) {
      left = Math.max(left, -b.x0);
      right = Math.max(right, b.x1);
    }
  }
  return { left, right };
}

/** Lays out a whole circuit. Parts that do not fit the ladder are placed next to their nodes. */
export function autoLayout(circuit: Circuit, options: LayoutOptions = {}): Drawing {
  return layOut(circuit, options);
}

/**
 * The automatic layout, optionally starting the top rail at a given node (`start`): for a group of
 * parts laid out beside parts already drawn, the node they share comes first, on the left, where
 * the drawn parts' wires meet it. Without an independent source standing on the rail, `start`
 * takes the main source's place.
 */
export function layOut(circuit: Circuit, options: LayoutOptions = {}, start?: string): Drawing {
  const results = options.results ?? true;
  const measure = options.measure ?? defaultMeasure;
  const rail = chooseRail(circuit);
  if (rail === undefined) return emptyDrawing();
  const degree = new Map<string, number>();
  for (const n of circuit.nodes.values()) degree.set(n.name, n.pins.length);
  const g: Graph = { rail, parts: circuit.parts, degree };
  const shunt = (p: CircuitPart): boolean => (p.nodes[0] === rail) !== (p.nodes[1] === rail);
  const independent = circuit.parts.find((p) => isIndependentSource(p.letter) && shunt(p));
  const first = start !== undefined && start !== rail && circuit.nodes.has(start) && !independent ? start : undefined;
  const mainSource = first !== undefined ? undefined : (independent ?? circuit.parts.find(shunt));

  const blocks = blocksOf(g);
  const leading = first ?? (mainSource ? other(mainSource, rail) : undefined);
  if (leading !== undefined) {
    const i = blocks.findIndex((bl) => bl.nodes.has(leading));
    if (i > 0) blocks.unshift(...blocks.splice(i, 1));
  }
  const plans: BlockPlan[] = blocks.map((block, bi) => {
    let start: string;
    if (bi === 0 && first !== undefined && block.nodes.has(first)) start = first;
    else if (bi === 0 && mainSource && block.nodes.has(other(mainSource, rail))) start = other(mainSource, rail);
    else {
      const first = block.parts.find(shunt);
      start = first ? other(first, rail) : block.parts[0]!.nodes[0];
    }
    const adj = adjacency(block.parts, rail);
    let best: BlockPlan | undefined;
    for (const spine of spinePaths(start, adj)) {
      const candidate = plan(block, spine, g, bi === 0 ? mainSource : undefined);
      if (!best || candidate.score > best.score) best = candidate;
    }
    assignLevels(best!.bridges);
    return best!;
  });
  const railLoops = circuit.parts.filter((p) => p.nodes[0] === rail && p.nodes[1] === rail);

  const { slots, blockStart } = slotsOf(plans);
  const L: Ladder = { g, plans, slots, blockStart };
  if (mainSource) L.mainSource = mainSource;

  // Heights: the tallest column sets the bottom rail; words above lying parts set the bridge spacing.
  let H = MIN_RAIL_HEIGHT;
  for (const p of plans) for (const ds of p.downs) for (const d of ds) H = Math.max(H, columnNeed(d));
  // A name, a value and the result lines (one each unless the style keeps more: SceneOptions.resultRoom).
  const resultLines = results ? Math.max(0, ...circuit.parts.map((p) => resultRoomOf(p, options)?.length ?? 1)) : 0;
  const lines = 2 + resultLines;
  const B = Math.max(5, Math.ceil(0.9 + TEXT.gap + lines * TEXT.lineHeight + 0.9 + 0.4));

  const gaps: number[] = [];
  for (let s = 0; s + 1 < slots.length; s++) {
    const a = slots[s]!;
    const b = slots[s + 1]!;
    const ra = reach(a, L, results, measure, options);
    const rb = reach(b, L, results, measure, options);
    let gap = Math.ceil(ra.right + rb.left + 1);
    if (a.kind === 'series' || b.kind === 'series') gap = Math.max(3, Math.ceil(ra.right + rb.left + 0.5));
    if (blockStart.includes(s + 1)) gap = Math.max(gap, Math.ceil(ra.right + rb.left + 2));
    gaps.push(Math.max(2, gap));
  }

  // Half the width of a lying part's words (a bridge part's), so wires crossing the bridge miss them.
  const halfWidth = (part: CircuitPart): number => {
    const geom = symbolGeometry(part.letter, pt(0, 0), 270, false);
    const lines = partLabelLines(geom, partLabelSpecs(part, results, resultRoomOf(part, options)), 'above', measure);
    return Math.max(2, ...lines.map((l) => Math.max(-l.box.x0, l.box.x1)));
  };
  let realized = realize(L, gaps, H, B, halfWidth);
  for (let round = 0; round < SPACING_ROUNDS; round++) {
    // Bridges need room for their parts between the stations they join.
    let widened = false;
    for (const br of realized.cramped) {
      const b = plans.findIndex((p) => p.bridges.includes(br));
      const toSlot = slots.findIndex((s) => s.kind === 'station' && s.block === b && s.ups.some((u) => u.bridge === br && u.end === 'to'));
      gaps[toSlot - 1]! += 2;
      widened = true;
    }
    for (const p of plans) {
      for (const br of p.bridges) {
        const b = plans.indexOf(p);
        const fromSlot = slots.findIndex((s) => s.kind === 'station' && s.block === b && s.ups.some((u) => u.bridge === br && u.end === 'from'));
        const toSlot = slots.findIndex((s) => s.kind === 'station' && s.block === b && s.ups.some((u) => u.bridge === br && u.end === 'to'));
        let span = 0;
        for (let s = fromSlot; s < toSlot; s++) span += gaps[s]!;
        const need = 6 * br.parts.length;
        if (span < need) {
          gaps[toSlot - 1]! += need - span;
          widened = true;
        }
      }
    }
    if (widened) realized = realize(L, gaps, H, B, halfWidth);
    const scene = buildScene(circuit, realized.drawing, options);
    const overlaps = findOverlaps(scene);
    let changed = false;
    const bumped = new Set<number>();
    for (const o of overlaps) {
      const sa = sceneSlot(o.a, realized);
      const sb = sceneSlot(o.b, realized);
      // Words on a wire: the wire belongs to no slot, so widen the gap before the words' slot (a
      // block's first terminal running into the block before it, say).
      const words = o.a.kind === 'part-label' || o.a.kind === 'node-label' ? sa : o.b.kind === 'part-label' || o.b.kind === 'node-label' ? sb : undefined;
      const hi = sa !== undefined && sb !== undefined && sa !== sb ? Math.max(sa, sb) : (o.a.kind === 'wire' || o.b.kind === 'wire') && words !== undefined && words > 0 ? words : undefined;
      if (hi === undefined || bumped.has(hi)) continue;
      bumped.add(hi);
      gaps[hi - 1]! += 1;
      changed = true;
    }
    if (!changed && !realized.cramped.length) break;
    realized = realize(L, gaps, H, B, halfWidth);
  }

  const drawing = realized.drawing;
  const leftovers = [...plans.flatMap((p) => p.leftovers), ...railLoops];
  const order = new Map(circuit.parts.map((p, i) => [p.key, i]));
  leftovers.sort((a, b) => order.get(a.key)! - order.get(b.key)!);
  if (leftovers.length) placeParts(circuit, drawing, leftovers.map((p) => p.key), options);
  return drawing;
}

// ------------------------------------------------------------------ one part at a time

/** Copper points of each node in a scene: pins, ground pins and every grid point along wires. */
function copperPoints(scene: Scene): Map<string, Point[]> {
  const out = new Map<string, Point[]>();
  const add = (node: string, p: Point): void => {
    (out.get(node) ?? out.set(node, []).get(node)!).push(p);
  };
  for (const part of scene.parts) for (const pin of part.pins) add(pin.node, pin.at);
  for (const g of scene.grounds) add(GROUND, g.at);
  for (const w of scene.wires) {
    if (!w.node) continue;
    for (const [a, b] of segmentsOf(w.points)) {
      if (a.x === b.x) for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) add(w.node, pt(a.x, y));
      else if (a.y === b.y) for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) add(w.node, pt(x, a.y));
    }
  }
  return out;
}

/** Boxes and segments found by the grid cells they cover, so a check looks only near the candidate. */
class Buckets {
  private readonly cells = new Map<string, number[]>();
  readonly boxes: Box[] = [];
  readonly segments: [Point, Point][] = [];
  private static readonly SIZE = 4;

  private keys(b: Box): string[] {
    const k: string[] = [];
    const s = Buckets.SIZE;
    for (let x = Math.floor(b.x0 / s); x <= Math.floor(b.x1 / s); x++) for (let y = Math.floor(b.y0 / s); y <= Math.floor(b.y1 / s); y++) k.push(`${x},${y}`);
    return k;
  }

  addBox(b: Box): void {
    const i = this.boxes.push(b) - 1;
    for (const k of this.keys(b)) (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(i);
  }

  addSegment(a: Point, c: Point): void {
    const i = this.segments.push([a, c]) - 1;
    const box = { x0: Math.min(a.x, c.x), y0: Math.min(a.y, c.y), x1: Math.max(a.x, c.x), y1: Math.max(a.y, c.y) };
    for (const k of this.keys(box)) (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(-1 - i);
  }

  /** True when the box overlaps a stored box or a stored segment crosses it. */
  hits(b: Box, withSegments = true): boolean {
    const seen = new Set<number>();
    for (const k of this.keys(b)) {
      for (const i of this.cells.get(k) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        if (i >= 0) {
          if (boxesOverlap(b, this.boxes[i]!)) return true;
        } else if (withSegments) {
          const [p, q] = this.segments[-1 - i]!;
          if (segmentCrossesBox(p, q, b)) return true;
        }
      }
    }
    return false;
  }

  /** True when a stored box contains the point. */
  contains(p: Point): boolean {
    for (const i of this.cells.get(`${Math.floor(p.x / Buckets.SIZE)},${Math.floor(p.y / Buckets.SIZE)}`) ?? []) {
      if (i >= 0 && boxContains(this.boxes[i]!, p)) return true;
    }
    return false;
  }
}

/** A ground pin farther than this from ground's wires gets a ground symbol of its own. */
const LOCAL_GROUND = 8;

/** The largest area searched for one part, in grid units (beyond it, the part's copper decides the centre). */
const MAX_AREA = { w: 48, h: 36 };

/** The area to search for a part: around its nodes' copper, or right of the drawing when they have none. */
function searchArea(part: CircuitPart, copper: Map<string, Point[]>, bounds: Box, empty: boolean): Box {
  if (empty) return { x0: -8, y0: -6, x1: 8, y1: 6 };
  const own = part.nodes.filter((n) => n !== GROUND).flatMap((n) => copper.get(n) ?? []);
  const near = own.length ? own : part.nodes.includes(GROUND) ? (copper.get(GROUND) ?? []) : [];
  if (!near.length) return { x0: bounds.x1 + 3, y0: bounds.y0, x1: bounds.x1 + 15, y1: Math.min(bounds.y1, bounds.y0 + MAX_AREA.h) };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let sx = 0;
  let sy = 0;
  for (const p of near) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
    sx += p.x;
    sy += p.y;
  }
  const box = { x0: x0 - 8, y0: y0 - 7, x1: x1 + 8, y1: y1 + 7 };
  if (box.x1 - box.x0 <= MAX_AREA.w && box.y1 - box.y0 <= MAX_AREA.h) return box;
  const cx = Math.round(sx / near.length);
  const cy = Math.round(sy / near.length);
  return { x0: cx - MAX_AREA.w / 2, y0: cy - MAX_AREA.h / 2, x1: cx + MAX_AREA.w / 2, y1: cy + MAX_AREA.h / 2 };
}

/** Distance (along the grid) from every point of an area to the nearest of some points, in two passes. */
function distanceMap(area: Box, seeds: readonly Point[]): (p: Point) => number | undefined {
  const x0 = Math.floor(area.x0) - 3;
  const y0 = Math.floor(area.y0) - 3;
  const w = Math.ceil(area.x1) + 3 - x0 + 1;
  const h = Math.ceil(area.y1) + 3 - y0 + 1;
  const d = new Float64Array(w * h).fill(Infinity);
  let any = false;
  for (const p of seeds) {
    const x = p.x - x0;
    const y = p.y - y0;
    if (x >= 0 && y >= 0 && x < w && y < h) {
      d[y * w + x] = 0;
      any = true;
    }
  }
  if (!any) return () => undefined;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) d[i] = Math.min(d[i]!, d[i - 1]! + 1);
      if (y > 0) d[i] = Math.min(d[i]!, d[i - w]! + 1);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) d[i] = Math.min(d[i]!, d[i + 1]! + 1);
      if (y < h - 1) d[i] = Math.min(d[i]!, d[i + w]! + 1);
    }
  }
  return (p: Point) => {
    const x = p.x - x0;
    const y = p.y - y0;
    return x >= 0 && y >= 0 && x < w && y < h ? d[y * w + x] : undefined;
  };
}

/**
 * Places parts that have no place yet, one by one in the order given, next to their nodes' copper,
 * where neither the symbol nor its words touch anything. Ground pins that end far from ground get a
 * ground symbol of their own. Wires are not drawn here: building the schematic routes them.
 */
export function placeParts(circuit: Circuit, drawing: Drawing, keys: readonly string[], options: LayoutOptions = {}): void {
  const results = options.results ?? true;
  const measure = options.measure ?? defaultMeasure;
  for (const key of keys) {
    const part = circuit.parts.find((p) => p.key === key);
    if (!part || drawing.parts.has(key)) continue;
    const scene = buildScene(circuit, drawing, options);
    const copper = copperPoints(scene);
    const foreignIndex = new Map<string, SegmentIndex>();
    const foreignWires = (node: string): SegmentIndex => {
      let idx = foreignIndex.get(node);
      if (!idx) {
        idx = new SegmentIndex(scene.wires.filter((w) => w.node !== node).map((w) => w.points));
        foreignIndex.set(node, idx);
      }
      return idx;
    };
    const pinAt = new Map<string, string>();
    for (const p of scene.parts) for (const pin of p.pins) pinAt.set(pointKey(pin.at), pin.node);
    for (const gr of scene.grounds) pinAt.set(pointKey(gr.at), GROUND);
    const taken = new Buckets();
    for (const p of scene.parts) {
      taken.addBox(inflate(p.box, 0.6));
      taken.addBox(p.labelBox);
    }
    for (const gr of scene.grounds) taken.addBox(inflate(gr.box, 0.4));
    for (const l of scene.nodeLabels) taken.addBox(l.box);
    for (const w of scene.wires) for (const [p, q] of segmentsOf(w.points)) taken.addSegment(p, q);

    const [a, b] = part.nodes;
    const groundPin = a === GROUND && b !== GROUND ? 0 : b === GROUND && a !== GROUND ? 1 : -1;
    const rots: Rotation[] =
      groundPin >= 0 ? [groundPin === 1 ? 0 : 180, 270, 90] : isIndependentSource(part.letter) ? [0, 180, 270, 90] : [270, 90, 0, 180];
    const empty = scene.parts.length === 0 && scene.grounds.length === 0;
    const area = searchArea(part, copper, scene.bounds, empty);
    const cx = Math.round((area.x0 + area.x1) / 2);
    const cy = Math.round((area.y0 + area.y1) / 2);
    const maps = new Map<string, (p: Point) => number | undefined>();
    const distance = (node: string, pin: Point): number | undefined => {
      const own = copper.get(node);
      if (!own || !own.length) return undefined;
      let map = maps.get(node);
      if (!map) {
        map = distanceMap(area, own);
        maps.set(node, map);
      }
      const d = map(pin);
      if (d !== undefined && Number.isFinite(d)) return d;
      let far = Infinity;
      for (const q of own) far = Math.min(far, Math.abs(q.x - pin.x) + Math.abs(q.y - pin.y));
      return far;
    };
    let best: { at: Point; rot: Rotation; cost: number } | undefined;
    rots.forEach((rot, ri) => {
      for (let y = Math.ceil(area.y0); y <= Math.floor(area.y1); y++) {
        for (let x = Math.ceil(area.x0); x <= Math.floor(area.x1); x++) {
          const at = pt(x, y);
          const geom = symbolGeometry(part.letter, at, rot, false);
          if (taken.hits(inflate(geom.box, 0.3))) continue;
          let cost = 3 * ri;
          let bad = false;
          geom.pins.forEach((pin, i) => {
            if (bad) return;
            const node = part.nodes[i]!;
            const there = pinAt.get(pointKey(pin));
            if ((there !== undefined && there !== node) || foreignWires(node).at(pin).length > 0) bad = true;
            // Room to wire the pin: the grid point just outside it is free.
            const v = DIRECTION_VECTORS[geom.outward[i]!];
            const exit = pt(pin.x + v.x, pin.y + v.y);
            const exitThere = pinAt.get(pointKey(exit));
            if ((exitThere !== undefined && exitThere !== node) || foreignWires(node).at(exit).length > 0 || taken.contains(exit)) bad = true;
            // A wire starts just outside the pin, along its lead: measure from there.
            const d = distance(node, exit);
            if (d !== undefined) cost += 1 + (node === GROUND && geom.outward[i] === 'down' ? Math.min(d, LOCAL_GROUND) : d);
            else if (node === GROUND) cost += LOCAL_GROUND;
            else cost += (0.2 * (Math.abs(pin.x - cx) + Math.abs(pin.y - cy))) / 4;
          });
          if (bad || (best && cost >= best.cost + 4)) continue;
          const lines = partLabelLines(geom, partLabelSpecs(part, results, resultRoomOf(part, options)), defaultSide(rot, false), measure);
          const lbox = lines.reduce<Box | undefined>((u, l) => (u ? { x0: Math.min(u.x0, l.box.x0), y0: Math.min(u.y0, l.box.y0), x1: Math.max(u.x1, l.box.x1), y1: Math.max(u.y1, l.box.y1) } : l.box), undefined)!;
          if (taken.hits(lbox)) cost += 4;
          if (!best || cost < best.cost - 1e-9) best = { at, rot, cost };
        }
      }
    });
    const chosen = best ?? { at: pt(Math.ceil(scene.bounds.x1) + 4, cy), rot: rots[0]!, cost: 0 };
    drawing.parts.set(key, { at: chosen.at, rot: chosen.rot, mirror: false });
    // A ground pin far from ground copper gets its own ground symbol.
    const geom = symbolGeometry(part.letter, chosen.at, chosen.rot, false);
    geom.pins.forEach((pin, i) => {
      if (part.nodes[i] !== GROUND || geom.outward[i] !== 'down') return;
      const d = distance(GROUND, pt(pin.x, pin.y + 1));
      if (d === undefined || d > LOCAL_GROUND) drawing.grounds.push({ at: pin, rot: 0 });
    });
  }
}
