/**
 * Schematic symbols for the notebook prototype, drawn as clean ink strokes (US/ANSI style, as in
 * LTspice): zigzag resistor, two-plate capacitor, four-loop inductor, circle sources, diamond
 * controlled sources, three-bar ground. The channel's rule holds: circuits stay clean, straight
 * lines, no hand-drawn wobble; the handwriting is for the notes around them.
 *
 * Every two-terminal symbol is drawn in a local frame with terminal A at (0, 0) and terminal B at
 * (LEN, 0); a part is then placed with translate(A) rotate(rot). The two leads are separate paths
 * from the body, so each lead can take the colour of its node, as every wire does (the channel's
 * pipeline/schematic.py: "every wire, lead and junction dot belongs to an electrical node").
 * Signs (+, −) are drawn upright in world space, so a source turned on its side still reads "+"
 * and "−".
 */

/** World pixels per grid cell (at zoom 1). */
export const G = 24;
/** Terminal-to-terminal length of a two-terminal part: 4 cells. */
export const LEN = 4 * G;

export type Kind = 'R' | 'C' | 'L' | 'V' | 'I' | 'E' | 'F' | 'G' | 'H' | 'GND';
export type Rot = 0 | 90 | 180 | 270;
export type Pt = readonly [number, number];

export const KIND_NAME: Record<Kind, string> = {
  R: 'resistor',
  C: 'capacitor',
  L: 'inductor',
  V: 'voltage source',
  I: 'current source',
  E: 'voltage-controlled voltage source',
  F: 'current-controlled current source',
  G: 'voltage-controlled current source',
  H: 'current-controlled voltage source',
  GND: 'ground (node 0)',
};

/** Short names for the toolbar. */
export const KIND_SHORT: Record<Kind, string> = {
  R: 'Resistor',
  C: 'Capacitor',
  L: 'Inductor',
  V: 'Voltage source',
  I: 'Current source',
  E: 'Voltage-controlled voltage source',
  F: 'Current-controlled current source',
  G: 'Voltage-controlled current source',
  H: 'Current-controlled voltage source',
  GND: 'Ground, node 0',
};

/** Sources stand upright when placed (+ on top), like V1 and as in LTspice; R, C and L lie flat. */
export const DEFAULT_ROT: Record<Kind, Rot> = { R: 0, C: 0, L: 0, V: 90, I: 90, E: 90, F: 90, G: 90, H: 90, GND: 0 };

/** Unit vector of a rotation (the direction from terminal A to terminal B). */
export function dir(rot: Rot): Pt {
  return rot === 0 ? [1, 0] : rot === 90 ? [0, 1] : rot === 180 ? [-1, 0] : [0, -1];
}

/** A local point (x along A→B, y to the side) in world pixels, for a part at `a` (world px). */
export function toWorld(a: Pt, rot: Rot, lx: number, ly: number): Pt {
  const [ux, uy] = dir(rot);
  // The side axis is the direction turned +90° (SVG y points down): (ux, uy) → (−uy, ux).
  return [a[0] + lx * ux - ly * uy, a[1] + lx * uy + ly * ux];
}

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

/** A "+" sign centred at (x, y), upright. */
function plus(x: number, y: number, s = 5): string {
  return `M${f(x - s)} ${f(y)}H${f(x + s)}M${f(x)} ${f(y - s)}V${f(y + s)}`;
}
/** A "−" sign centred at (x, y), upright. */
function minus(x: number, y: number, s = 5): string {
  return `M${f(x - s)} ${f(y)}H${f(x + s)}`;
}

export interface SymbolDrawing {
  /** Lead from terminal A to the body (local frame): takes the colour of A's node. */
  leadA: string;
  /** Lead from the body to terminal B (local frame): takes the colour of B's node. */
  leadB: string;
  /** The body: ink strokes in the local frame. */
  body: string;
  /** Filled shapes of the body in the local frame (arrow heads). */
  bodyFill?: string;
  /** Upright strokes in world space (the signs of sources and of a control pair). */
  world?: string;
  /** E and G: the control pair (the voltage they read), its leads in the local frame and its pins. */
  control?: { leads: string; pins: Pt[] };
}

/** Where the body of each kind starts and ends along A→B (the leads fill the rest). */
const BODY: Record<Exclude<Kind, 'GND'>, [number, number]> = {
  R: [24, 72],
  C: [44, 52],
  L: [24, 72],
  V: [28, 68],
  I: [28, 68],
  E: [26, 70],
  F: [26, 70],
  G: [26, 70],
  H: [26, 70],
};

/** The local x where a kind's body begins and ends (for the current dots, which stop at the body). */
export function bodySpan(kind: Exclude<Kind, 'GND'>): [number, number] {
  return BODY[kind];
}

/**
 * The drawing of one part. `a` is terminal A in world pixels (needed for the upright signs).
 */
export function drawSymbol(kind: Exclude<Kind, 'GND'>, a: Pt, rot: Rot): SymbolDrawing {
  const W = (lx: number, ly: number): Pt => toWorld(a, rot, lx, ly);
  const [b0, b1] = BODY[kind];
  const leads = { leadA: `M0 0H${b0}`, leadB: `M${b1} 0H${LEN}` };
  switch (kind) {
    case 'R':
      return { ...leads, body: 'M24 0L28 -9L36 9L44 -9L52 9L60 -9L68 9L72 0' };
    case 'C':
      return { ...leads, body: 'M44 -15V15M52 -15V15' };
    case 'L':
      return { ...leads, body: 'M24 0a6 6 0 0 1 12 0a6 6 0 0 1 12 0a6 6 0 0 1 12 0a6 6 0 0 1 12 0' };
    case 'V': {
      const [px, py] = W(37, 0);
      const [mx, my] = W(59, 0);
      return { ...leads, body: 'M68 0A20 20 0 1 1 28 0A20 20 0 1 1 68 0', world: plus(px, py) + minus(mx, my) };
    }
    case 'I':
      return { ...leads, body: 'M68 0A20 20 0 1 1 28 0A20 20 0 1 1 68 0M37 0H54', bodyFill: 'M61 0L52 -5.5L52 5.5Z' };
    case 'E':
    case 'H':
    case 'F':
    case 'G': {
      const diamond = 'M26 0L48 -22L70 0L48 22Z';
      const voltageOut = kind === 'E' || kind === 'H';
      let out: SymbolDrawing;
      if (voltageOut) {
        const [px, py] = W(39, 0);
        const [mx, my] = W(57, 0);
        out = { ...leads, body: diamond, world: plus(px, py, 4.5) + minus(mx, my, 4.5) };
      } else {
        out = { ...leads, body: `${diamond}M38 0H53`, bodyFill: 'M60 0L51.5 -5L51.5 5Z' };
      }
      if (kind === 'H' || kind === 'F') return out;
      // E and G read a voltage: the standard four-terminal symbol, with the control pair on the
      // side (on the left when the source stands upright), each pin marked + or −.
      const [spx, spy] = W(13, 40);
      const [smx, smy] = W(83, 40);
      return {
        ...out,
        world: `${out.world ?? ''}${plus(spx, spy, 4.2)}${minus(smx, smy, 4.2)}`,
        control: {
          leads: 'M24 48V33M72 48V33',
          pins: [
            [24, 48],
            [72, 48],
          ],
        },
      };
    }
  }
}

/** Ground: a short lead down from its terminal and three bars, widest first. */
export function groundPath(x: number, y: number): string {
  return `M${f(x)} ${f(y)}V${f(y + 12)}M${f(x - 14)} ${f(y + 12)}H${f(x + 14)}M${f(x - 9)} ${f(y + 18.5)}H${f(x + 9)}M${f(x - 4)} ${f(y + 25)}H${f(x + 4)}`;
}

/** Orthogonal polyline through grid points (cells), in world pixels. */
export function polyPath(points: readonly Pt[]): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x * G)} ${f(y * G)}`).join('');
}

/** Orthogonal polyline through world points (px). */
export function pxPath(points: readonly Pt[]): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('');
}

// ------------------------------------------------------------------ toolbar icons

/**
 * Small versions of the same symbols for the toolbar (viewBox 0 0 32 32), so the parts look the
 * same in the toolbar and on the page. The four controlled sources share the diamond, so each also
 * shows what it reads, on its left: a pair of + − terminals (a voltage: E, G) or a current arrow
 * (a current: F, H). Inside, +/− means it makes a voltage (E, H), an arrow a current (F, G).
 */
export function toolIcon(kind: Kind | 'select' | 'wire' | 'more'): string {
  const s = (d: string, extra = ''): string => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  const fill = (d: string): string => `<path d="${d}" fill="currentColor"/>`;
  const svg = (inner: string): string => `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">${inner}</svg>`;
  const diamond = s('M19 2.5V8.5M19 23.5V29.5M19 8.5L26.5 16L19 23.5L11.5 16Z');
  const makesVoltage = s('M16.8 12.6H21.2M19 10.4V14.8M16.8 19.6H21.2', 'stroke-width="1.4"');
  const makesCurrent = s('M19 11.2V17.6', 'stroke-width="1.4"') + fill('M19 20.6L16.6 17.1H21.4Z');
  const readsVoltage = s('M2.5 10.5H8.5M2.5 21.5H8.5', 'stroke-width="1.6"') + s('M3.4 6.4H6.8M5.1 4.7V8.1M3.4 25.6H6.8', 'stroke-width="1.25"');
  const readsCurrent = s('M2 16H7.2', 'stroke-width="1.6"') + fill('M10.4 16L6.6 13.6V18.4Z');
  switch (kind) {
    case 'select':
      return svg(`<path d="M9 6.5l14.5 9.2-6.4 1.3-3.2 6.2z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`);
    case 'wire':
      return svg(s('M7 22.5H16V9.5H25') + `<circle cx="7" cy="22.5" r="2.2" fill="currentColor"/><circle cx="25" cy="9.5" r="2.2" fill="currentColor"/>`);
    case 'more':
      return svg(s('M16 4.5L22 10.5L16 16.5L10 10.5Z', 'stroke-width="1.5"') + s('M8 17L13 22L8 27L3 22Z', 'stroke-width="1.5"') + s('M24 17L29 22L24 27L19 22Z', 'stroke-width="1.5"'));
    case 'R':
      return svg(s('M2 16H7.5L9 11.2L12 20.8L15 11.2L18 20.8L21 11.2L22.5 16H30', 'stroke-width="1.9"'));
    case 'C':
      return svg(s('M2 16H13.6M18.4 16H30') + s('M13.6 8.5V23.5M18.4 8.5V23.5', 'stroke-width="2.2"'));
    case 'L':
      return svg(s('M2 16H5a2.75 2.75 0 0 1 5.5 0a2.75 2.75 0 0 1 5.5 0a2.75 2.75 0 0 1 5.5 0a2.75 2.75 0 0 1 5.5 0H30', 'stroke-width="1.9"'));
    case 'V':
      return svg(s('M16 2.5V8.5M16 23.5V29.5') + s('M23.5 16A7.5 7.5 0 1 1 8.5 16A7.5 7.5 0 1 1 23.5 16') + s('M13.6 12.2H18.4M16 9.8V14.6M13.6 20H18.4', 'stroke-width="1.5"'));
    case 'I':
      return svg(s('M16 2.5V8.5M16 23.5V29.5') + s('M23.5 16A7.5 7.5 0 1 1 8.5 16A7.5 7.5 0 1 1 23.5 16') + s('M16 11.2V18.4', 'stroke-width="1.5"') + fill('M16 21.4L13.2 17.6H18.8Z'));
    case 'E':
      return svg(diamond + makesVoltage + readsVoltage);
    case 'H':
      return svg(diamond + makesVoltage + readsCurrent);
    case 'F':
      return svg(diamond + makesCurrent + readsCurrent);
    case 'G':
      return svg(diamond + makesCurrent + readsVoltage);
    case 'GND':
      return svg(s('M16 5V15M8 15H24M11 19.5H21M14 24H18'));
  }
}
