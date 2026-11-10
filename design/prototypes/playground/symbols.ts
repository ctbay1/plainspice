/**
 * The schematic symbols of the Playground, in the US/ANSI style LTspice uses, drawn by hand
 * (rough.ts): zigzag resistor, two-plate capacitor, four-loop inductor, circled sources, diamond
 * controlled sources, three-bar ground.
 *
 * Every two-pin symbol is drawn lying down, pin A (the netlist's first node) at (−40, 0) and pin B
 * at (40, 0), then turned in steps of 90°. Signs (+ and −) stay upright whichever way the part
 * turns, so they always read as signs. Pin ends never wobble: a wire that ends on a pin meets the
 * lead exactly.
 *
 * The names of the part types come from the app's element catalog (src/spice/elements.ts), so the
 * toolbar, the cards and the Explain panel use the same words.
 */
import { elementInfo } from '../../../src/spice/elements.ts';
import { arc, ellipse, line, polyline, type Pt, type Strokes } from './rough.ts';

export type Kind = 'R' | 'C' | 'L' | 'V' | 'I' | 'E' | 'F' | 'G' | 'H' | 'GND';
export type Rot = 0 | 90 | 180 | 270;

/** The grid every pin sits on. */
export const GRID = 20;
/** Half the length of a two-pin part, pin to pin. */
export const HALF = 40;
const HALF_PIN = HALF;

export interface KindInfo {
  kind: Kind;
  /** The part type's name, from the element catalog: "Resistor", "Voltage-controlled voltage source". */
  word: string;
  /** The word under the toolbar button (one or two short lines). */
  tool: string;
  /** What the value means, for the value field's label. */
  quantity: string;
  /** The display unit of the value ("Ω"), or '' for a ratio without a unit. */
  unit: string;
  /** For a controlled source, the ratio its value stands for (from the catalog): "V/V", "A/A", "A/V", "V/A". */
  ratio?: string;
  /** A starting value for a newly placed part, as a student would type it. */
  start: string;
  /** Keyboard shortcut. */
  key: string;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const catalog = (letter: string): { name: string; ratio?: string; valueLabel?: string } => {
  const info = elementInfo(letter);
  return { name: info?.name ?? letter, ...(info?.unit?.ratio ? { ratio: info.unit.ratio } : {}), ...(info?.valueLabel ? { valueLabel: info.valueLabel } : {}) };
};

function kind(k: Exclude<Kind, 'GND'>, tool: string, quantity: string, unit: string, start: string): KindInfo {
  const c = catalog(k);
  return { kind: k, word: cap(c.name), tool, quantity, unit, ...(c.ratio ? { ratio: c.ratio } : {}), start, key: k };
}

export const KINDS: readonly KindInfo[] = [
  kind('R', 'Resistor', 'Resistance', 'Ω', '1k'),
  kind('C', 'Capacitor', 'Capacitance', 'F', '1u'),
  kind('L', 'Inductor', 'Inductance', 'H', '1m'),
  kind('V', 'Voltage source', 'Voltage', 'V', '5'),
  kind('I', 'Current source', 'Current', 'A', '1m'),
  kind('E', 'E', cap(catalog('E').valueLabel ?? 'gain'), '', '2'),
  kind('F', 'F', cap(catalog('F').valueLabel ?? 'gain'), '', '2'),
  // Their values are written with the ratio the catalog gives (A/V, V/A), the same words as their field label.
  kind('G', 'G', cap(catalog('G').valueLabel ?? 'amps per volt'), 'A/V', '1m'),
  kind('H', 'H', cap(catalog('H').valueLabel ?? 'volts per amp'), 'V/A', '1k'),
  { kind: 'GND', word: 'Ground', tool: 'Ground', quantity: '', unit: '', start: '', key: '0' },
];

export const KIND: Record<Kind, KindInfo> = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<Kind, KindInfo>;

/** The four controlled sources, folded into one toolbar button. */
export const CONTROLLED: readonly Kind[] = ['E', 'F', 'G', 'H'];
export const isControlled = (k: Kind | string): boolean => CONTROLLED.includes(k as Kind);

/** Turn a local point by `rot` (clockwise on screen, y pointing down) and move it to `at`. */
export function place(p: Pt, at: Pt, rot: Rot): Pt {
  const [x, y] = p;
  switch (rot) {
    case 0:
      return [at[0] + x, at[1] + y];
    case 90:
      return [at[0] - y, at[1] + x];
    case 180:
      return [at[0] - x, at[1] - y];
    case 270:
      return [at[0] + y, at[1] - x];
  }
}

/** The control pins of E and G (the voltage that steers them), in local coordinates. */
const CONTROL_PINS: readonly Pt[] = [
  [-10, 40],
  [10, 40],
];

/** The pins of a part in world coordinates: [A, B] for two-pin parts, [pin] for ground. */
export function pins(kind: Kind, at: Pt, rot: Rot): Pt[] {
  if (kind === 'GND') return [at];
  return [place([-HALF, 0], at, rot), place([HALF, 0], at, rot)];
}

/** Every pin, control pins included (E and G have four). */
export function allPins(kind: Kind, at: Pt, rot: Rot): Pt[] {
  const main = pins(kind, at, rot);
  return kind === 'E' || kind === 'G' ? [...main, ...CONTROL_PINS.map((p) => place(p, at, rot))] : main;
}

/** The box a part covers (for clicks, the selection frame and fitting the view). */
export function box(kind: Kind, at: Pt, rot: Rot): { x: number; y: number; w: number; h: number } {
  const corners: Pt[] =
    kind === 'GND'
      ? [place([-17, -2], at, rot), place([17, 30], at, rot)]
      : kind === 'E' || kind === 'G'
        ? [place([-HALF, -22], at, rot), place([HALF, 44], at, rot)]
        : [place([-HALF, -22], at, rot), place([HALF, 22], at, rot)];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** How far a part's ink reaches across its axis (local units), for a focus frame that hugs the drawing. */
const INK_HALF: Record<Kind, number> = { R: 10, C: 15, L: 6, V: 20, I: 20, E: 20, F: 20, G: 20, H: 20, GND: 15 };

/** The box the symbol's ink covers (tighter than `box`, which is the generous click target). */
export function inkBox(kind: Kind, at: Pt, rot: Rot): { x: number; y: number; w: number; h: number } {
  const h = INK_HALF[kind];
  const corners: Pt[] =
    kind === 'GND'
      ? [place([-15, 0], at, rot), place([15, 28], at, rot)]
      : kind === 'E' || kind === 'G'
        ? [place([-HALF, -h], at, rot), place([HALF, 42], at, rot)]
        : [place([-HALF, -h], at, rot), place([HALF, h], at, rot)];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** One drawn mark: both strokes of a hand-drawn line, and whether it is filled (arrow heads). */
export interface Mark extends Strokes {
  fill?: string;
}

/**
 * Draw a part. `id` seeds the wobble so each part has its own hand. `glyph` draws the small
 * toolbar version: shorter leads, and for E, F, G and H the mark of what controls them (two
 * sensing terminals for a voltage, a sensing arrow for a current), so the four never look alike.
 */
export function drawSymbol(kind: Kind, at: Pt, rot: Rot, id: string, glyph = false): Mark[] {
  const P = (p: Pt): Pt => place(p, at, rot);
  /** Toolbar glyphs keep short leads, so the body fills the button. */
  const HALF = glyph ? 31 : HALF_PIN;
  const marks: Mark[] = [];
  const seg = (a: Pt, b: Pt, key: string, rough = 0.9, anchored = false): void => {
    marks.push(line(P(a), P(b), { seed: `${id}:${key}`, rough, anchored }));
  };
  /** A lead: from a pin to the body, both ends exact. */
  const lead = (a: Pt, b: Pt, key: string): void => seg(a, b, key, 0.8, true);
  const poly = (pts: Pt[], key: string, rough = 0.9, anchored = false): void => {
    marks.push(polyline(pts.map(P), { seed: `${id}:${key}`, rough, anchored }));
  };
  /** An upright + or − at a local point (signs never turn). */
  const sign = (p: Pt, plus: boolean, key: string, size = 5): void => {
    const [x, y] = P(p);
    marks.push(line([x - size, y], [x + size, y], { seed: `${id}:${key}h`, rough: 0.5 }));
    if (plus) marks.push(line([x, y - size], [x, y + size], { seed: `${id}:${key}v`, rough: 0.5 }));
  };
  /** An arrow along the local x axis from x0 to x1 (it turns with the part). */
  const arrow = (x0: number, x1: number, key: string, y = 0, head = 7): void => {
    seg([x0, y], [x1, y], `${key}s`, 0.6);
    const dir = Math.sign(x1 - x0);
    const tip = P([x1 + dir * 2, y]);
    const l = P([x1 - dir * head, y - head * 0.7]);
    const r = P([x1 - dir * head, y + head * 0.7]);
    marks.push({ ...polyline([l, tip, r], { seed: `${id}:${key}h`, rough: 0.4 }), fill: 'currentColor' });
  };

  switch (kind) {
    case 'R': {
      lead([-HALF, 0], [-24, 0], 'la');
      lead([24, 0], [HALF, 0], 'lb');
      const a = 10;
      poly(
        [
          [-24, 0],
          [-20, -a],
          [-12, a],
          [-4, -a],
          [4, a],
          [12, -a],
          [20, a],
          [24, 0],
        ],
        'zig',
        0.8,
        true,
      );
      break;
    }
    case 'C': {
      lead([-HALF, 0], [-5, 0], 'la');
      lead([5, 0], [HALF, 0], 'lb');
      seg([-5, -15], [-5, 15], 'pa', 0.6);
      seg([5, -15], [5, 15], 'pb', 0.6);
      break;
    }
    case 'L': {
      lead([-HALF, 0], [-24, 0], 'la');
      lead([24, 0], [HALF, 0], 'lb');
      for (let i = 0; i < 4; i++) {
        const cx = -18 + i * 12;
        // Loops bulge to the part's "up" side: in local coordinates that is negative y.
        const c = P([cx, 0]);
        const start = Math.PI + (rot * Math.PI) / 180;
        marks.push(arc(c, 6, start, start + Math.PI, { seed: `${id}:loop${i}`, rough: 0.7 }));
      }
      break;
    }
    case 'V':
    case 'I': {
      lead([-HALF, 0], [-20, 0], 'la');
      lead([20, 0], [HALF, 0], 'lb');
      marks.push(ellipse(P([0, 0]), 20, 20, { seed: `${id}:ring`, rough: 0.9 }));
      if (kind === 'V') {
        sign([-10, 0], true, 'plus');
        sign([10, 0], false, 'minus');
      } else {
        // SPICE: the current of I1 a b value flows from a through the source to b.
        arrow(-11, 11, 'arrow');
      }
      break;
    }
    case 'E':
    case 'F':
    case 'G':
    case 'H': {
      lead([-HALF, 0], [-20, 0], 'la');
      lead([20, 0], [HALF, 0], 'lb');
      poly(
        [
          [-20, 0],
          [0, -20],
          [20, 0],
          [0, 20],
          [-20, 0],
        ],
        'diamond',
        0.8,
      );
      if (kind === 'E' || kind === 'H') {
        sign([-10, 0], true, 'plus', 4.5);
        sign([10, 0], false, 'minus', 4.5);
      } else {
        arrow(-10, 10, 'arrow');
      }
      if (kind === 'E' || kind === 'G') {
        // Voltage-controlled: two control pins (the voltage that steers it) on legs from the
        // diamond's lower edges, marked + and −.
        lead([-10, 10], CONTROL_PINS[0]!, 'cp');
        lead([10, 10], CONTROL_PINS[1]!, 'cm');
        sign([-19, 33], true, 'cps', glyph ? 4.5 : 3.6);
        sign([19, 33], false, 'cms', glyph ? 4.5 : 3.6);
      } else if (glyph) {
        // Current-controlled (F, H): the controlling current is read in another source, so the
        // symbol has no extra pins; the toolbar marks it with a small sensing arrow below.
        arrow(-12, 10, 'sense', 34, 5.5);
      }
      break;
    }
    case 'GND': {
      lead([0, 0], [0, 14], 'lead');
      seg([-15, 14], [15, 14], 'b1', 0.6);
      seg([-9.5, 20.5], [9.5, 20.5], 'b2', 0.6);
      seg([-4, 27], [4, 27], 'b3', 0.6);
      break;
    }
  }
  return marks;
}

/**
 * A small symbol for a button, stroked with currentColor. `size` is the drawn size in pixels;
 * controlled sources get a taller box so their control marks fit.
 */
export function toolGlyph(kind: Kind, size = 26): string {
  const ground = kind === 'GND';
  const controlled = isControlled(kind);
  const marks = drawSymbol(kind, [0, 0], 0, `tool-${kind}`, true);
  const paths = marks.map((m) => `<path d="${m.main}" fill="${m.fill ? 'currentColor' : 'none'}"/>`).join('');
  // viewBox in symbol units: two-pin parts span x −31…31; controlled ones also y −22…42.
  const vb = ground ? '-18 -4 36 36' : controlled ? '-34 -24 68 68' : '-34 -24 68 48';
  const h = controlled ? size : ground ? size : Math.round((size * 48) / 68);
  const w = ground ? size : size;
  const stroke = controlled ? 4.6 : ground ? 3.4 : 4.4;
  return `<svg viewBox="${vb}" width="${w}" height="${h}" aria-hidden="true" focusable="false" class="glyph glyph--${kind.toLowerCase()}"><g stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
}

/** The glyph for the folded "Controlled sources" button: a plain diamond with a little caret. */
export function controlledGlyph(size = 26): string {
  return `<svg viewBox="0 0 26 26" width="${size}" height="${size}" aria-hidden="true" focusable="false" class="glyph"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 11.5h4.5M20 11.5h4.5M13 4.5l7 7-7 7-7-7z"/><path d="M10.6 11.5h4.8M13 9.1v4.8" stroke-width="1.5"/></g></svg>`;
}
