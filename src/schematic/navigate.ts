/**
 * The circuit for keyboard and screen-reader users: an order to move through its parts and nodes
 * (reading order: top to bottom, left to right), moves along the wires with the arrow keys (from a
 * part to the node at its pin on that side, from a node to the part on that side), and short
 * descriptions. Plain TypeScript: no DOM.
 *
 * A part's description is the sentence the circuit overview already says for it
 * (src/spice/describe.ts, describeCircuit: "R1: a 1 kΩ resistor between in and out."), built from
 * the same words (DESCRIBE_STRINGS), so the drawing makes no claim about SPICE the overview does
 * not. A node's description only says what the drawing shows: which parts it connects.
 */
import { formatNumber, formatSI } from '../format/si.ts';
import { DESCRIBE_STRINGS, describeCircuit } from '../spice/describe.ts';
import { sweptBy } from '../spice/explain.ts';
import { lowerAscii } from '../spice/parse.ts';
import { GROUND, labelNode, type CircuitPart } from './circuit.ts';
import { DIRECTION_VECTORS, OPPOSITE, type Direction, type Point } from './geometry.ts';
import type { Schematic } from './schematic.ts';

export type NavItem = { kind: 'part'; key: string } | { kind: 'node'; name: string };

/** Words for moving around the drawing, in one object so a Turkish UI can replace them later. */
export const NAVIGATE_STRINGS = {
  ground: 'ground',
  node: (name: string, parts: string): string => `Node ${name} connects ${parts}.`,
  nodeAlone: (name: string): string => `Node ${name} connects no part in the drawing.`,
  groundNode: (parts: string): string => `Ground (node 0) connects ${parts}.`,
  hidden: (list: string): string => `It also connects ${list}, which the drawing does not show.`,
  hiddenItem: (name: string, line: number): string => `${name} (line ${line})`,
  and: (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`),
  notDrawn: (list: string): string => `Not in the drawing: ${list}.`,
  notDrawnItem: (name: string, line: number): string => `${name} (line ${line})`,
} as const;

const S = DESCRIBE_STRINGS;
const N = NAVIGATE_STRINGS;

const itemKey = (i: NavItem): string => (i.kind === 'part' ? `p:${i.key}` : `n:${i.name}`);

/** Where an item is on the drawing: a part's centre; a node's label point (ground: its first ground symbol). */
export function itemPosition(s: Schematic, item: NavItem): Point | undefined {
  if (item.kind === 'part') return s.drawing.parts.get(item.key)?.at;
  if (item.name === GROUND) return s.drawing.grounds[0]?.at ?? firstPin(s, GROUND);
  return s.drawing.labels.find((l) => l.node === item.name)?.at ?? firstPin(s, item.name);
}

function firstPin(s: Schematic, node: string): Point | undefined {
  for (const p of s.scene.parts) for (const pin of p.pins) if (pin.node === node) return pin.at;
  return undefined;
}

/** Every drawn part and node, in reading order: top to bottom, then left to right. */
export function readingOrder(s: Schematic): NavItem[] {
  const items: NavItem[] = [
    ...s.scene.parts.map((p) => ({ kind: 'part' as const, key: p.key })),
    ...[...s.circuit.nodes.keys()].map((name) => ({ kind: 'node' as const, name })),
  ];
  const at = new Map(items.map((i) => [itemKey(i), itemPosition(s, i) ?? { x: 0, y: 0 }]));
  return items
    .map((item, index) => ({ item, index, p: at.get(itemKey(item))! }))
    .sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x || a.index - b.index)
    .map((x) => x.item);
}

/** The parts on a node, or the nodes of a part (pin 0 first). */
export function connections(s: Schematic, item: NavItem): NavItem[] {
  if (item.kind === 'part') {
    const part = s.scene.parts.find((p) => p.key === item.key);
    if (!part) return [];
    const nodes = [...new Set(part.pins.map((p) => p.node))];
    return nodes.map((name) => ({ kind: 'node' as const, name }));
  }
  return s.scene.parts.filter((p) => p.pins.some((pin) => pin.node === item.name)).map((p) => ({ kind: 'part' as const, key: p.key }));
}

/**
 * The item an arrow key moves to. From a part: the node at its pin on that side; with no pin on
 * that side, the nearest part or node that way. From a node: the part whose pin on this node leads
 * that way (the nearest first), else the nearest of its parts that way. Undefined at an edge.
 */
export function neighbour(s: Schematic, from: NavItem, direction: Direction): NavItem | undefined {
  const origin = itemPosition(s, from);
  if (!origin) return undefined;
  const v = DIRECTION_VECTORS[direction];
  if (from.kind === 'part') {
    const part = s.scene.parts.find((p) => p.key === from.key);
    const pin = part?.pins.find((p) => p.outward === direction);
    if (pin) return { kind: 'node', name: pin.node };
    return nearestThatWay(s, origin, v, (i) => itemKey(i) !== itemKey(from));
  }
  // Leaving a node into a part means moving against the outward direction of the part's pin.
  const leading = s.scene.parts
    .flatMap((p) => p.pins.filter((pin) => pin.node === from.name && OPPOSITE[pin.outward] === direction).map((pin) => ({ p, pin })))
    .sort((a, b) => dist(a.pin.at, origin) - dist(b.pin.at, origin) || a.pin.at.x - b.pin.at.x || a.pin.at.y - b.pin.at.y);
  if (leading[0]) return { kind: 'part', key: leading[0].p.key };
  const own = new Set(connections(s, from).map(itemKey));
  return nearestThatWay(s, origin, v, (i) => own.has(itemKey(i))) ?? nearestThatWay(s, origin, v, (i) => itemKey(i) !== itemKey(from));
}

const dist = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function nearestThatWay(s: Schematic, origin: Point, v: Point, accept: (i: NavItem) => boolean): NavItem | undefined {
  let best: { item: NavItem; score: number } | undefined;
  for (const item of readingOrder(s)) {
    if (!accept(item)) continue;
    const p = itemPosition(s, item);
    if (!p) continue;
    const along = (p.x - origin.x) * v.x + (p.y - origin.y) * v.y;
    if (along <= 0) continue;
    const across = Math.abs((p.x - origin.x) * v.y - (p.y - origin.y) * v.x);
    const score = along + 2 * across;
    if (!best || score < best.score) best = { item, score };
  }
  return best?.item;
}

/** How describe.ts writes a node in a part's sentence: as written on the line; ground is "ground". */
const written = (part: CircuitPart, i: 0 | 1): string => (part.nodes[i] === GROUND ? S.ground : part.nodeText[i]);

/** A dependent source's control node as written, "ground" for node 0, "?" when missing. */
function controlNode(text: string, name: string): string {
  if (!text) return '?';
  return name === GROUND ? S.ground : text;
}

/**
 * The sentence describeCircuit (src/spice/describe.ts) says for this part, e.g.
 * "R1: a 1 kΩ resistor between in and out." or "V1: a 6 V source with its + side at n1 and its − side at ground."
 */
export function describePart(s: Schematic, name: string): string {
  const part = s.circuit.parts.find((p) => p.key === lowerAscii(name));
  if (!part) return '';
  const a = written(part, 0);
  const b = written(part, 1);
  const v = part.value;
  const fmt = (unit: string): string => (v === undefined ? '' : formatSI(v, unit));
  const fn = part.sourceFunction ? part.sourceFunction.split(/[\s(]/)[0]!.toUpperCase() : undefined;
  switch (part.letter) {
    case 'R':
      return S.resistor(part.name, fmt('Ω'), a, b);
    case 'C':
      return S.capacitor(part.name, fmt('F'), a, b);
    case 'L':
      return S.inductor(part.name, fmt('H'), a, b);
    case 'V':
      if (sweptBy(s.netlist, part.key) !== undefined) return S.swept(part.name, a, b);
      if (fn && v === undefined) return S.vFunction(part.name, fn, a, b);
      if (!fn && (v === undefined ? part.valueText === '' : v === 0)) return S.ammeter(part.name, a, b);
      return S.vSource(part.name, fmt('V'), a, b);
    case 'I':
      if (fn && v === undefined) return S.iFunction(part.name, fn, a, b);
      return S.iSource(part.name, fmt('A'), a, b);
    case 'E': {
      const c = part.control?.kind === 'voltage' ? part.control : undefined;
      return S.vcvs(part.name, S.voltageAt(a, b), v === undefined ? '?' : formatNumber(v), S.voltageAt(controlNode(c?.plusText ?? '', c?.plus ?? ''), controlNode(c?.minusText ?? '', c?.minus ?? '')));
    }
    case 'G': {
      const c = part.control?.kind === 'voltage' ? part.control : undefined;
      const plus = controlNode(c?.plusText ?? '', c?.plus ?? '');
      const control = c?.minus === GROUND ? S.at(plus) : S.between(plus, controlNode(c?.minusText ?? '', c?.minus ?? ''));
      return S.vccs(part.name, v === undefined ? '?' : formatSI(v, 'A'), control, a, b);
    }
    case 'F':
      return S.cccs(part.name, v === undefined ? '?' : formatNumber(v), part.control?.kind === 'current' && part.control.sourceText ? part.control.sourceText : '?', a, b);
    case 'H':
      return S.ccvs(part.name, S.voltageAt(a, b), v === undefined ? '?' : formatSI(v, 'V'), part.control?.kind === 'current' && part.control.sourceText ? part.control.sourceText : '?');
  }
}

/**
 * "Node n2 connects R1, R2 and I1." (ground: "Ground (node 0) connects ..."), and the parts on it
 * that the drawing does not show: "It also connects D1 (line 4), which the drawing does not show."
 */
export function describeNode(s: Schematic, name: string): string {
  const node = labelNode(s.circuit, name);
  const parts = s.scene.parts.filter((p) => p.pins.some((pin) => pin.node === node)).map((p) => p.name);
  const hidden = s.circuit.nodes.get(node)?.hidden ?? [];
  const also = hidden.length ? ` ${N.hidden(N.and(hidden.map((h) => N.hiddenItem(h.name, h.lineNumber))))}` : '';
  if (node === GROUND) return `${N.groundNode(N.and(parts))}${also}`;
  const text = s.circuit.nodes.get(node)?.text ?? name;
  return `${parts.length ? N.node(text, N.and(parts)) : N.nodeAlone(text)}${also}`;
}

/** The description of whatever an item is. */
export function describeItem(s: Schematic, item: NavItem): string {
  return item.kind === 'part' ? describePart(s, item.key) : describeNode(s, item.name);
}

/** The whole circuit in words (describe.ts's overview), and what the drawing leaves out. */
export function describeSchematic(s: Schematic): string {
  const overview = describeCircuit(s.netlist);
  if (!s.circuit.notDrawn.length) return overview;
  return `${overview} ${N.notDrawn(N.and(s.circuit.notDrawn.map((n) => N.notDrawnItem(n.name, n.lineNumber))))}`;
}
