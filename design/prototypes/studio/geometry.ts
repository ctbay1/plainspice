/**
 * Studio prototype: the schematic's geometry. Standard US/ANSI symbols (the style LTspice uses),
 * drawn on a 20-unit grid with every part 4 grid steps long, terminals, orthogonal wires and the
 * divider's layout. Pure geometry: no DOM, no SPICE claims.
 */

export const GRID = 20;

export type Kind = 'R' | 'C' | 'L' | 'V' | 'I' | 'E' | 'F' | 'G' | 'H' | 'GND';
export type Rot = 0 | 90 | 180 | 270;

export interface Pt {
  x: number;
  y: number;
}

export interface Part {
  id: string;
  kind: Kind;
  /** "R1"; ground has the name "0". */
  name: string;
  /** The value as typed ("1k"); '' for ground. */
  value: string;
  /** What a new E/F/G/H reads, as its netlist line writes it: "out 0" (E, G) or "V1" (F, H). */
  control?: string;
  x: number;
  y: number;
  rot: Rot;
  /** One of the example's parts (V1, R1, R2 and its ground): simulated, wired, kept. */
  example?: boolean;
}

/** A wire between two terminals (part id + terminal index), routed orthogonally. */
export interface Link {
  id: string;
  a: { part: string; t: number };
  b: { part: string; t: number };
  /** The netlist node it belongs to ("in", "out", "0"). */
  node: string;
}

/** A free wire drawn with the wire tool (not simulated in the prototype). */
export interface FreeWire {
  id: string;
  points: Pt[];
}

export interface KindInfo {
  name: string;
  /** Plain-word type, as the inspector shows it. */
  type: string;
  shortcut: string;
  defaultValue: string;
  /** E and G read a voltage, F and H a current (in the divider: V(out) and I(V1)). */
  defaultControl?: string;
}

export const KINDS: Record<Kind, KindInfo> = {
  R: { name: 'Resistor', type: 'Resistor', shortcut: 'R', defaultValue: '1k' },
  C: { name: 'Capacitor', type: 'Capacitor', shortcut: 'C', defaultValue: '1u' },
  L: { name: 'Inductor', type: 'Inductor', shortcut: 'L', defaultValue: '1m' },
  V: { name: 'Voltage source', type: 'Voltage source', shortcut: 'V', defaultValue: '5' },
  I: { name: 'Current source', type: 'Current source', shortcut: 'I', defaultValue: '1m' },
  E: { name: 'Voltage-controlled voltage source', type: 'Voltage-controlled voltage source', shortcut: 'E', defaultValue: '2', defaultControl: 'out 0' },
  F: { name: 'Current-controlled current source', type: 'Current-controlled current source', shortcut: 'F', defaultValue: '2', defaultControl: 'V1' },
  G: { name: 'Voltage-controlled current source', type: 'Voltage-controlled current source', shortcut: 'G', defaultValue: '1m', defaultControl: 'out 0' },
  H: { name: 'Current-controlled voltage source', type: 'Current-controlled voltage source', shortcut: 'H', defaultValue: '1k', defaultControl: 'V1' },
  GND: { name: 'Ground', type: 'Ground (node 0)', shortcut: '0', defaultValue: '' },
};

// ------------------------------------------------------------------ symbols (rot 0: vertical, terminal a on top)

export interface SymbolDef {
  /** Lead segments from each terminal to the body, in local coordinates. */
  leads: [Pt, Pt][];
  /** The body: SVG path data (stroked). */
  body: string;
  /** Extra filled shapes (arrowheads), SVG path data. */
  fill?: string;
  /** A circle body (sources): drawn with a canvas-coloured fill so current dots pass "inside". */
  circle?: { r: number };
  /** A closed body (diamond) with a canvas fill. */
  closed?: string;
  /** Half the body's width across the part's axis (for labels and selection). */
  half: number;
  /** Local bounding box. */
  box: { x0: number; y0: number; x1: number; y1: number };
}

const lead = (y0: number, y1: number): [Pt, Pt] => [
  { x: 0, y: y0 },
  { x: 0, y: y1 },
];

const ZIGZAG = 'M0,-24 L7,-20 L-7,-12 L7,-4 L-7,4 L7,12 L-7,20 L0,24';
const COIL = 'M0,-24 a6,6 0 0 1 0,12 a6,6 0 0 1 0,12 a6,6 0 0 1 0,12 a6,6 0 0 1 0,12';
const DIAMOND = 'M0,-20 L15,0 L0,20 L-15,0 Z';
const PLUS = (y: number): string => `M-4,${y} H4 M0,${y - 4} V${y + 4}`;
const MINUS = (y: number): string => `M-4,${y} H4`;
const ARROW_LINE = (y0: number, y1: number): string => `M0,${y0} V${y1 - 4}`;
const ARROW_HEAD = (y: number, w = 4.5): string => `M-${w},${y - 7} L0,${y} L${w},${y - 7} Z`;

export const SYMBOLS: Record<Kind, SymbolDef> = {
  R: { leads: [lead(-40, -24), lead(24, 40)], body: ZIGZAG, half: 7, box: { x0: -9, y0: -40, x1: 9, y1: 40 } },
  C: { leads: [lead(-40, -5), lead(5, 40)], body: 'M-15,-5 H15 M-15,5 H15', half: 15, box: { x0: -15, y0: -40, x1: 15, y1: 40 } },
  L: { leads: [lead(-40, -24), lead(24, 40)], body: COIL, half: 6, box: { x0: -6, y0: -40, x1: 8, y1: 40 } },
  V: {
    leads: [lead(-40, -18), lead(18, 40)],
    circle: { r: 18 },
    body: `${PLUS(-8)} ${MINUS(9)}`,
    half: 18,
    box: { x0: -18, y0: -40, x1: 18, y1: 40 },
  },
  I: {
    leads: [lead(-40, -18), lead(18, 40)],
    circle: { r: 18 },
    body: ARROW_LINE(-10, 10),
    fill: ARROW_HEAD(11),
    half: 18,
    box: { x0: -18, y0: -40, x1: 18, y1: 40 },
  },
  E: { leads: [lead(-40, -20), lead(20, 40)], closed: DIAMOND, body: `${PLUS(-7)} ${MINUS(8)}`, half: 15, box: { x0: -15, y0: -40, x1: 15, y1: 40 } },
  H: { leads: [lead(-40, -20), lead(20, 40)], closed: DIAMOND, body: `${PLUS(-7)} ${MINUS(8)}`, half: 15, box: { x0: -15, y0: -40, x1: 15, y1: 40 } },
  F: { leads: [lead(-40, -20), lead(20, 40)], closed: DIAMOND, body: ARROW_LINE(-9, 9), fill: ARROW_HEAD(10, 4), half: 15, box: { x0: -15, y0: -40, x1: 15, y1: 40 } },
  G: { leads: [lead(-40, -20), lead(20, 40)], closed: DIAMOND, body: ARROW_LINE(-9, 9), fill: ARROW_HEAD(10, 4), half: 15, box: { x0: -15, y0: -40, x1: 15, y1: 40 } },
  GND: { leads: [lead(0, 10)], body: 'M-12,10 H12 M-7.5,15.5 H7.5 M-3,21 H3', half: 12, box: { x0: -12, y0: 0, x1: 12, y1: 21 } },
};

export function rotate(p: Pt, rot: Rot): Pt {
  switch (rot) {
    case 0:
      return { x: p.x, y: p.y };
    case 90:
      return { x: -p.y, y: p.x };
    case 180:
      return { x: -p.x, y: -p.y };
    case 270:
      return { x: p.y, y: -p.x };
  }
}

export const toWorld = (part: Part, p: Pt): Pt => {
  const r = rotate(p, part.rot);
  return { x: part.x + r.x, y: part.y + r.y };
};

/** Local terminal points: a at the top (and b at the bottom) of the vertical symbol. */
export function localTerminals(kind: Kind): Pt[] {
  return kind === 'GND' ? [{ x: 0, y: 0 }] : [{ x: 0, y: -40 }, { x: 0, y: 40 }];
}

export function terminals(part: Part): Pt[] {
  return localTerminals(part.kind).map((p) => toWorld(part, p));
}

/** The direction a wire leaves terminal t in (unit vector, outwards from the part). */
export function terminalDir(part: Part, t: number): Pt {
  const local = part.kind === 'GND' ? { x: 0, y: -1 } : t === 0 ? { x: 0, y: -1 } : { x: 0, y: 1 };
  return rotate(local, part.rot);
}

/** The part's axis in world space (from terminal a to b), as a unit vector. */
export function axis(part: Part): Pt {
  return rotate({ x: 0, y: 1 }, part.rot);
}

export function isVertical(part: Part): boolean {
  return part.rot === 0 || part.rot === 180;
}

/** World bounding box of a part (with its leads). */
export function partBox(part: Part, pad = 0): { x0: number; y0: number; x1: number; y1: number } {
  const b = SYMBOLS[part.kind].box;
  const corners = [
    { x: b.x0, y: b.y0 },
    { x: b.x1, y: b.y0 },
    { x: b.x0, y: b.y1 },
    { x: b.x1, y: b.y1 },
  ].map((p) => toWorld(part, p));
  return {
    x0: Math.min(...corners.map((c) => c.x)) - pad,
    y0: Math.min(...corners.map((c) => c.y)) - pad,
    x1: Math.max(...corners.map((c) => c.x)) + pad,
    y1: Math.max(...corners.map((c) => c.y)) + pad,
  };
}

/** Body extent along the axis: where the leads end (local y of lead a's inner end, lead b's inner end). */
export function bodyEnds(kind: Kind): [number, number] {
  const leads = SYMBOLS[kind].leads;
  if (leads.length < 2) return [0, 0];
  return [leads[0]![1].y, leads[1]![0].y];
}

/**
 * An orthogonal route between two terminals: straight when they line up, otherwise one bend,
 * placed so the wire leaves each terminal along its own direction when it can.
 */
export function route(p: Pt, pd: Pt, q: Pt, qd: Pt): Pt[] {
  if (p.x === q.x || p.y === q.y) return [p, q];
  const pVertical = pd.x === 0;
  const qVertical = qd.x === 0;
  let corner: Pt;
  if (pVertical && !qVertical) corner = { x: p.x, y: q.y };
  else if (!pVertical && qVertical) corner = { x: q.x, y: p.y };
  else if (pVertical) corner = { x: p.x, y: q.y };
  else corner = { x: q.x, y: p.y };
  return [p, corner, q];
}

export const snap = (v: number, step = GRID): number => Math.round(v / step) * step;

export function polylineLength(points: Pt[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return length;
}

/** The point at distance `d` along a polyline, with the segment's direction. */
export function pointAt(points: Pt[], d: number): { p: Pt; dir: Pt } {
  let left = d;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= len || i === points.length - 1) {
      const t = len ? Math.min(1, left / len) : 0;
      return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dir: len ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 1, y: 0 } };
    }
    left -= len;
  }
  return { p: points[0]!, dir: { x: 1, y: 0 } };
}

export const pathData = (points: Pt[]): string => points.map((p, i) => `${i ? 'L' : 'M'}${round(p.x)},${round(p.y)}`).join(' ');
export const round = (v: number): number => Math.round(v * 100) / 100;

// ------------------------------------------------------------------ the first circuit

/** The divider on the grid: V1 on the left, R1 across the top, R2 on the right, ground below. */
export function exampleParts(values: { v1: string; r1: string; r2: string }): Part[] {
  return [
    { id: 'V1', kind: 'V', name: 'V1', value: values.v1, x: 0, y: 80, rot: 0, example: true },
    { id: 'R1', kind: 'R', name: 'R1', value: values.r1, x: 120, y: 0, rot: 270, example: true },
    { id: 'R2', kind: 'R', name: 'R2', value: values.r2, x: 240, y: 80, rot: 0, example: true },
    { id: 'GND', kind: 'GND', name: '0', value: '', x: 120, y: 160, rot: 0, example: true },
  ];
}

export const EXAMPLE_LINKS: Link[] = [
  { id: 'w-in', a: { part: 'V1', t: 0 }, b: { part: 'R1', t: 0 }, node: 'in' },
  { id: 'w-out', a: { part: 'R1', t: 1 }, b: { part: 'R2', t: 0 }, node: 'out' },
  { id: 'w-g1', a: { part: 'V1', t: 1 }, b: { part: 'GND', t: 0 }, node: '0' },
  { id: 'w-g2', a: { part: 'R2', t: 1 }, b: { part: 'GND', t: 0 }, node: '0' },
];

/** Which netlist node each example terminal sits on (V1: + in, − 0; R1: in, out; R2: out, 0). */
export const EXAMPLE_NODES: Record<string, string[]> = {
  V1: ['in', '0'],
  R1: ['in', 'out'],
  R2: ['out', '0'],
  GND: ['0'],
};
