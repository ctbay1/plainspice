/**
 * The Notebook's ink symbols, drawn on exactly the pins and bodies of the schematic model
 * (src/schematic/symbols.ts: every two-terminal symbol upright at rotation 0, pin 0 at (0, −2), pin 1
 * at (0, 2), in grid units): clean straight strokes in the channel's style, no hand-drawn wobble
 * (the handwriting is for the results). Each lead is a path of its own, so it takes the colour of
 * its node like the wires do (the channel's rule: every wire, lead and junction dot belongs to a
 * node). The + and − marks are not here: the scene gives them upright (PlacedPart.marks).
 *
 * The toolbar's icons (toolIcon) are small versions of the same symbols.
 */
import { SYMBOLS, type PartLetter } from '../schematic/index.ts';

export interface InkSymbol {
  /** The leads: pin 0 to the body, and the body to pin 1 (local coordinates, rotation 0). */
  leads: readonly [string, string];
  /** The body's strokes. */
  body: string;
  /** Filled shapes (arrowheads). */
  fill?: string;
}

const leads = (letter: PartLetter): readonly [string, string] => {
  const b = SYMBOLS[letter].body;
  return [`M0,-2 V${b.y0}`, `M0,${b.y1} V2`];
};

const CIRCLE = 'M-0.9,0 A0.9,0.9 0 1 0 0.9,0 A0.9,0.9 0 1 0 -0.9,0 Z';
const DIAMOND = 'M0,-1 L0.8,0 L0,1 L-0.8,0 Z';

/** The symbols, local coordinates in grid units (bodies inside SYMBOLS[letter].body: the tests check it). */
export const INK: Readonly<Record<PartLetter, InkSymbol>> = {
  R: { leads: leads('R'), body: 'M0,-1.2 L0.4,-1 L-0.4,-0.6 L0.4,-0.2 L-0.4,0.2 L0.4,0.6 L-0.4,1 L0,1.2' },
  C: { leads: leads('C'), body: 'M-0.8,-0.25 H0.8 M-0.8,0.25 H0.8' },
  L: { leads: leads('L'), body: 'M0,-1.2 A0.3,0.3 0 0 1 0,-0.6 A0.3,0.3 0 0 1 0,0 A0.3,0.3 0 0 1 0,0.6 A0.3,0.3 0 0 1 0,1.2' },
  V: { leads: leads('V'), body: CIRCLE },
  I: { leads: leads('I'), body: `${CIRCLE} M0,-0.55 V0.2`, fill: 'M-0.24,0.12 L0.24,0.12 L0,0.58 Z' },
  E: { leads: leads('E'), body: DIAMOND },
  F: { leads: leads('F'), body: `${DIAMOND} M0,-0.5 V0.12`, fill: 'M-0.2,0.06 L0.2,0.06 L0,0.48 Z' },
  G: { leads: leads('G'), body: `${DIAMOND} M0,-0.5 V0.12`, fill: 'M-0.2,0.06 L0.2,0.06 L0,0.48 Z' },
  H: { leads: leads('H'), body: DIAMOND },
};

/** The ground symbol: its short lead from the pin, and its three bars, widest first. */
export const GROUND_INK = { lead: 'M0,0 V0.4', bars: 'M-0.6,0.4 H0.6 M-0.38,0.7 H0.38 M-0.16,1 H0.16' } as const;

/** A + or − mark of half-width `s`, centred on (x, y), upright. */
export function markPath(text: '+' | '−', x: number, y: number, s = 0.19): string {
  const r = (n: number): string => String(Math.round(n * 1000) / 1000);
  return text === '+' ? `M${r(x - s)},${r(y)} H${r(x + s)} M${r(x)},${r(y - s)} V${r(y + s)}` : `M${r(x - s)},${r(y)} H${r(x + s)}`;
}

/** A small arrowhead pointing right, centred on the origin (turn it with rotate()). */
export const ARROWHEAD = 'M-0.22,-0.2 L0.24,0 L-0.22,0.2 Z';

/** The current arrow drawn before a result: a short shaft and a head, pointing right, centred on the origin, `w` long. */
export function currentArrow(w: number): { shaft: string; head: string } {
  const h = w / 2;
  const r = (n: number): string => String(Math.round(n * 1000) / 1000);
  return { shaft: `M${r(-h)},0 H${r(h - 0.2)}`, head: `M${r(h - 0.26)},-0.17 L${r(h)},0 L${r(h - 0.26)},0.17 Z` };
}

// ------------------------------------------------------------------ toolbar icons

export type ToolKind = PartLetter | 'select' | 'wire' | 'ground' | 'controlled';

/**
 * The toolbar's icons (viewBox 0 0 32 32), the same symbols small, so a part looks the same in the
 * toolbar and on the page. The four controlled sources share the diamond, so each also shows what
 * it reads, on its left: a pair of + − terminals (a voltage: E, G) or a current arrow (a current:
 * F, H); inside, + and − mean it makes a voltage (E, H), an arrow a current (F, G).
 * Returns stroked and filled path data.
 */
export function toolIcon(kind: ToolKind): { strokes: { d: string; width?: number }[]; fills: string[] } {
  const diamond = { d: 'M19 2.5V8.5M19 23.5V29.5M19 8.5L26.5 16L19 23.5L11.5 16Z' };
  const makesVoltage = { d: 'M16.8 12.6H21.2M19 10.4V14.8M16.8 19.6H21.2', width: 1.4 };
  const makesCurrent = { strokes: [{ d: 'M19 11.2V17.6', width: 1.4 }], fills: ['M19 20.6L16.6 17.1H21.4Z'] };
  const readsVoltage = [
    { d: 'M2.5 10.5H8.5M2.5 21.5H8.5', width: 1.6 },
    { d: 'M3.4 6.4H6.8M5.1 4.7V8.1M3.4 25.6H6.8', width: 1.25 },
  ];
  const readsCurrent = { strokes: [{ d: 'M2 16H7.2', width: 1.6 }], fills: ['M10.4 16L6.6 13.6V18.4Z'] };
  switch (kind) {
    case 'select':
      return { strokes: [{ d: 'M9 6.5l14.5 9.2-6.4 1.3-3.2 6.2z', width: 1.4 }], fills: ['M9 6.5l14.5 9.2-6.4 1.3-3.2 6.2z'] };
    case 'wire':
      return { strokes: [{ d: 'M7 22.5H16V9.5H25' }], fills: ['M9.2 22.5a2.2 2.2 0 1 1-4.4 0a2.2 2.2 0 1 1 4.4 0Z', 'M27.2 9.5a2.2 2.2 0 1 1-4.4 0a2.2 2.2 0 1 1 4.4 0Z'] };
    case 'controlled':
      return {
        strokes: [
          { d: 'M16 4.5L22 10.5L16 16.5L10 10.5Z', width: 1.5 },
          { d: 'M8 17L13 22L8 27L3 22Z', width: 1.5 },
          { d: 'M24 17L29 22L24 27L19 22Z', width: 1.5 },
        ],
        fills: [],
      };
    case 'R':
      return { strokes: [{ d: 'M2 16H7.5L9 11.2L12 20.8L15 11.2L18 20.8L21 11.2L22.5 16H30', width: 1.9 }], fills: [] };
    case 'C':
      return { strokes: [{ d: 'M2 16H13.6M18.4 16H30' }, { d: 'M13.6 8.5V23.5M18.4 8.5V23.5', width: 2.2 }], fills: [] };
    case 'L':
      return { strokes: [{ d: 'M2 16H5a2.75 2.75 0 0 1 5.5 0a2.75 2.75 0 0 1 5.5 0a2.75 2.75 0 0 1 5.5 0a2.75 2.75 0 0 1 5.5 0H30', width: 1.9 }], fills: [] };
    case 'V':
      return { strokes: [{ d: 'M16 2.5V8.5M16 23.5V29.5' }, { d: 'M23.5 16A7.5 7.5 0 1 1 8.5 16A7.5 7.5 0 1 1 23.5 16' }, { d: 'M13.6 12.2H18.4M16 9.8V14.6M13.6 20H18.4', width: 1.5 }], fills: [] };
    case 'I':
      return { strokes: [{ d: 'M16 2.5V8.5M16 23.5V29.5' }, { d: 'M23.5 16A7.5 7.5 0 1 1 8.5 16A7.5 7.5 0 1 1 23.5 16' }, { d: 'M16 11.2V18.4', width: 1.5 }], fills: ['M16 21.4L13.2 17.6H18.8Z'] };
    case 'E':
      return { strokes: [diamond, makesVoltage, ...readsVoltage], fills: [] };
    case 'H':
      return { strokes: [diamond, makesVoltage, ...readsCurrent.strokes], fills: readsCurrent.fills };
    case 'F':
      return { strokes: [diamond, ...makesCurrent.strokes, ...readsCurrent.strokes], fills: [...makesCurrent.fills, ...readsCurrent.fills] };
    case 'G':
      return { strokes: [diamond, ...makesCurrent.strokes, ...readsVoltage], fills: makesCurrent.fills };
    case 'ground':
      return { strokes: [{ d: 'M16 5V15M8 15H24M11 19.5H21M14 24H18' }], fills: [] };
  }
}
