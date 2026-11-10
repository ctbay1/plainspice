/**
 * The symbols a drawing can show: the two-terminal parts R, C, L, V, I, E, F, G, H and the ground
 * symbol, on the integer grid. Plain TypeScript: geometry only, no DOM, no colours, no styles.
 *
 * Every two-terminal symbol is drawn upright at rotation 0, 4 grid units from pin to pin: pin 0 (the
 * part's first node) at (0, -2) and pin 1 (its second node) at (0, 2). What the pins mean follows
 * the netlist, in the channel's words (src/spice/elements.ts):
 * - V, E and H: pin 0 is the + side, pin 1 the − side;
 * - I, F and G: current flows from pin 0 through the part into pin 1, so the arrow points from pin 0
 *   to pin 1 (down at rotation 0);
 * - R, C and L: either way round.
 * E, F, G and H are drawn as two-terminal diamonds, as in textbooks and the channel's videos: only
 * their output is wired; what controls them is written next to them (drawing.ts, valueLines), never wired.
 *
 * The ground symbol has one pin at (0, 0) and its three bars below it; it belongs to node 0, and a
 * drawing may have several.
 *
 * `shapes` are standard US/ANSI symbols as SVG path data in grid units (zigzag resistor, circle
 * sources, three-bar ground), for renderers that want them; a visual style may draw its own symbols
 * on the same pins and boxes. Polarity marks (+ and −) are given separately as points, because
 * they must stay upright when the symbol turns.
 */
import { pt, type Box, type Direction, type Point } from './geometry.ts';

/** The parts a drawing shows. */
export type PartLetter = 'R' | 'C' | 'L' | 'V' | 'I' | 'E' | 'F' | 'G' | 'H';

export const PART_LETTERS: readonly PartLetter[] = ['R', 'C', 'L', 'V', 'I', 'E', 'F', 'G', 'H'];

export type SymbolKind = PartLetter | 'ground';

/** What a pin is, in the channel's words: + side, − side, from node, to node, either way, ground. */
export type PinRole = 'plus' | 'minus' | 'from' | 'to' | 'node' | 'ground';

export interface SymbolShape {
  /** SVG path data in local grid units (rotation 0, not mirrored). */
  d: string;
  /** Filled (an arrowhead) rather than stroked. */
  fill?: true;
}

export interface SymbolDef {
  kind: SymbolKind;
  /** Pin positions, local (rotation 0). */
  pins: readonly Point[];
  /** The direction a wire leaves each pin, local. */
  outward: readonly Direction[];
  roles: readonly PinRole[];
  /** The body without its leads, local. */
  body: Box;
  /** Body and leads, pin to pin: nothing else may enter it (pins excepted). */
  box: Box;
  shapes: readonly SymbolShape[];
  /** + and − marks, local positions (drawn upright). */
  marks: readonly { text: '+' | '−'; at: Point }[];
  /** Where an arrow for the part's current goes: on pin 0's lead, pointing into the part. */
  arrow?: Point;
}

/** Distance from pin 0 to pin 1 of every two-terminal symbol. */
export const PIN_SPACING = 4;

const LEADS = (inner: number): string => `M0,-2 V${-inner} M0,${inner} V2`;
const CIRCLE = (r: number): string => `M${-r},0 A${r},${r} 0 1 0 ${r},0 A${r},${r} 0 1 0 ${-r},0 Z`;
const DIAMOND = 'M0,-1 L0.8,0 L0,1 L-0.8,0 Z';

function twoTerminal(
  kind: PartLetter,
  roles: readonly [PinRole, PinRole],
  body: Box,
  shapes: SymbolShape[],
  marks: { text: '+' | '−'; at: Point }[] = [],
): SymbolDef {
  return {
    kind,
    pins: [pt(0, -2), pt(0, 2)],
    outward: ['up', 'down'],
    roles,
    body,
    box: { x0: Math.min(body.x0, -0.1), y0: -2, x1: Math.max(body.x1, 0.1), y1: 2 },
    shapes,
    marks,
    arrow: pt(0, (-2 + body.y0) / 2),
  };
}

const PLUS_MINUS = (d: number): { text: '+' | '−'; at: Point }[] => [
  { text: '+', at: pt(0, -d) },
  { text: '−', at: pt(0, d) },
];

export const SYMBOLS: Readonly<Record<SymbolKind, SymbolDef>> = {
  R: twoTerminal('R', ['node', 'node'], { x0: -0.4, y0: -1.2, x1: 0.4, y1: 1.2 }, [
    { d: 'M0,-2 V-1.2 L0.4,-1 L-0.4,-0.6 L0.4,-0.2 L-0.4,0.2 L0.4,0.6 L-0.4,1 L0,1.2 V2' },
  ]),
  C: twoTerminal('C', ['node', 'node'], { x0: -0.8, y0: -0.25, x1: 0.8, y1: 0.25 }, [
    { d: `${LEADS(0.25)} M-0.8,-0.25 H0.8 M-0.8,0.25 H0.8` },
  ]),
  L: twoTerminal('L', ['node', 'node'], { x0: -0.05, y0: -1.2, x1: 0.35, y1: 1.2 }, [
    { d: 'M0,-2 V-1.2 A0.3,0.3 0 0 1 0,-0.6 A0.3,0.3 0 0 1 0,0 A0.3,0.3 0 0 1 0,0.6 A0.3,0.3 0 0 1 0,1.2 V2' },
  ]),
  V: twoTerminal('V', ['plus', 'minus'], { x0: -0.9, y0: -0.9, x1: 0.9, y1: 0.9 }, [{ d: `${LEADS(0.9)} ${CIRCLE(0.9)}` }], PLUS_MINUS(0.45)),
  I: twoTerminal('I', ['from', 'to'], { x0: -0.9, y0: -0.9, x1: 0.9, y1: 0.9 }, [
    { d: `${LEADS(0.9)} ${CIRCLE(0.9)} M0,-0.55 V0.25` },
    { d: 'M-0.25,0.15 L0.25,0.15 L0,0.6 Z', fill: true },
  ]),
  E: twoTerminal('E', ['plus', 'minus'], { x0: -0.8, y0: -1, x1: 0.8, y1: 1 }, [{ d: `${LEADS(1)} ${DIAMOND}` }], PLUS_MINUS(0.42)),
  F: twoTerminal('F', ['from', 'to'], { x0: -0.8, y0: -1, x1: 0.8, y1: 1 }, [
    { d: `${LEADS(1)} ${DIAMOND} M0,-0.55 V0.15` },
    { d: 'M-0.2,0.08 L0.2,0.08 L0,0.5 Z', fill: true },
  ]),
  G: twoTerminal('G', ['from', 'to'], { x0: -0.8, y0: -1, x1: 0.8, y1: 1 }, [
    { d: `${LEADS(1)} ${DIAMOND} M0,-0.55 V0.15` },
    { d: 'M-0.2,0.08 L0.2,0.08 L0,0.5 Z', fill: true },
  ]),
  H: twoTerminal('H', ['plus', 'minus'], { x0: -0.8, y0: -1, x1: 0.8, y1: 1 }, [{ d: `${LEADS(1)} ${DIAMOND}` }], PLUS_MINUS(0.42)),
  ground: {
    kind: 'ground',
    pins: [pt(0, 0)],
    outward: ['up'],
    roles: ['ground'],
    body: { x0: -0.6, y0: 0.4, x1: 0.6, y1: 1 },
    box: { x0: -0.6, y0: 0, x1: 0.6, y1: 1 },
    shapes: [{ d: 'M0,0 V0.4 M-0.6,0.4 H0.6 M-0.38,0.7 H0.38 M-0.16,1 H0.16' }],
    marks: [],
  },
};

export function isPartLetter(s: string | undefined): s is PartLetter {
  return s !== undefined && (PART_LETTERS as readonly string[]).includes(s);
}

/** Independent sources: drawn on the left of a laid-out circuit, + up. */
export const isIndependentSource = (letter: PartLetter): boolean => letter === 'V' || letter === 'I';

/** Sources with a + side (V, E, H) and with an arrow (I, F, G). */
export const hasPolarity = (letter: PartLetter): boolean => letter === 'V' || letter === 'E' || letter === 'H';
export const hasArrow = (letter: PartLetter): boolean => letter === 'I' || letter === 'F' || letter === 'G';
