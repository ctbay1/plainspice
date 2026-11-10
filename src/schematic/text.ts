/**
 * Text on the drawing: how much room a label needs, without a DOM. The layout keeps labels clear of
 * symbols, wires and each other with these widths; a renderer that draws text at TEXT.size grid
 * units in an ordinary sans-serif font stays inside the default boxes (they have a small margin),
 * and a style with another font gives its own widths (`Measure`, SceneOptions.measure).
 */
import type { Box, Point } from './geometry.ts';

export const TEXT = {
  /** Font size the boxes assume, in grid units (14 px when a grid unit is 20 px). */
  size: 0.7,
  /** Height of one line. */
  lineHeight: 0.9,
  /** Space between a symbol or a wire and its text. */
  gap: 0.3,
  /** Characters kept free for a result (a node voltage, a part's current) next to a label. */
  resultChars: '−12.34 mA',
} as const;

/** Widths in ems of an ordinary sans-serif font, roughly. */
function charWidth(ch: string): number {
  if (ch === ' ' || ch === ' ') return 0.28;
  if ('iljI|!.,:;\''.includes(ch)) return 0.27;
  if ('ftr()[]/'.includes(ch)) return 0.36;
  if ('mwMW'.includes(ch)) return 0.86;
  if ('Ω'.includes(ch)) return 0.74;
  if ('…'.includes(ch)) return 0.8;
  if (ch >= '0' && ch <= '9') return 0.56;
  if (ch >= 'A' && ch <= 'Z') return 0.66;
  if (ch >= 'a' && ch <= 'z') return 0.53;
  return 0.6;
}

/** Estimated width of `text` in grid units at TEXT.size. */
export function textWidth(text: string, size: number = TEXT.size): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch);
  return w * size;
}

export type TextAlign = 'start' | 'middle' | 'end';

/** What a line of text says on the drawing: a 'hidden' line names parts on a node that the drawing does not show. */
export type TextRole = 'name' | 'value' | 'result' | 'node' | 'hidden';

/**
 * How wide a line of text is, in grid units, as a visual style draws it. The default, `textWidth`,
 * estimates an ordinary sans-serif font at TEXT.size; a style with another font passes its own (a
 * canvas's measureText scaled to grid units, say) in SceneOptions.measure.
 */
export type Measure = (text: string, role: TextRole) => number;

export const defaultMeasure: Measure = (text) => textWidth(text);

/**
 * One line of text: draw `text` with its anchor at (x, y), y being the middle of the line
 * (SVG: dominant-baseline="central"), aligned by `align` (SVG text-anchor). `box` is the room it
 * needs. A 'result' line is empty: it keeps room free for a value the app writes after a run.
 */
export interface TextLine {
  text: string;
  role: TextRole;
  x: number;
  y: number;
  align: TextAlign;
  box: Box;
}

/** The box of a line of the given width at an anchor. */
export function lineBox(x: number, y: number, width: number, align: TextAlign): Box {
  const x0 = align === 'start' ? x : align === 'end' ? x - width : x - width / 2;
  return { x0: x0 - 0.05, y0: y - TEXT.lineHeight / 2, x1: x0 + width + 0.05, y1: y + TEXT.lineHeight / 2 };
}

export interface LineSpec {
  text: string;
  role: TextRole;
}

/** The width a line needs: a result line keeps room for TEXT.resultChars. */
export function lineWidth(spec: LineSpec, measure: Measure = defaultMeasure): number {
  return measure(spec.role === 'result' ? TEXT.resultChars : spec.text, spec.role);
}

/**
 * Lines stacked in a column, one under the other. The column is anchored at `at` with `align`;
 * `vertical` says where `at.y` is: the middle of the column, its top, or its bottom.
 */
export function stackLines(specs: readonly LineSpec[], at: Point, align: TextAlign, vertical: 'middle' | 'top' | 'bottom', measure: Measure = defaultMeasure): TextLine[] {
  const h = specs.length * TEXT.lineHeight;
  const top = vertical === 'top' ? at.y : vertical === 'bottom' ? at.y - h : at.y - h / 2;
  return specs.map((s, i) => {
    const y = top + TEXT.lineHeight * (i + 0.5);
    return { text: s.text, role: s.role, x: at.x, y, align, box: lineBox(at.x, y, lineWidth(s, measure), align) };
  });
}
