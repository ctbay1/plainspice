/**
 * How the Notebook look writes words on the drawing, and how wide they are, without a DOM: the
 * schematic model (src/schematic) keeps exactly this much room for each line, so names, values and
 * results never touch a symbol, a wire or each other (findOverlaps), in the browser and in the tests
 * alike. Widths come from the font files themselves (metrics.ts, measured by
 * scripts/notebook-metrics.ts).
 *
 * Four voices, one job each (decision 0014): names in the plain sans (Inter), values typeset in
 * Notebook Serif like the LaTeX of the episodes, results handwritten in Caveat ("this is what
 * ngspice found"), or in the plain sans when the reader chooses the plain font. The room kept for a
 * result is the wider of the two, so switching the font never moves anything.
 */
import { TEXT, type Measure, type TextRole } from '../schematic/index.ts';
import { DESCRIBE_STRINGS } from '../spice/describe.ts';
import { METRICS, type MetricsKey } from './metrics.ts';

export interface TypeStyle {
  face: MetricsKey;
  /** Font size in grid units (the model's TEXT.size is 0.7). */
  size: number;
}

/** The look of each kind of word on the drawing (notebook.css uses the same faces and sizes). */
export const TYPE = {
  name: { face: 'inter600', size: 0.7 },
  value: { face: 'serif400', size: 0.76 },
  node: { face: 'inter600', size: 0.7 },
  hidden: { face: 'inter400', size: 0.6 },
  /** Results, handwritten. */
  hand: { face: 'caveat700', size: 0.98 },
  /** Results in the plain font (the "Plain font" setting). */
  plain: { face: 'inter600', size: 0.68 },
} as const satisfies Record<string, TypeStyle>;

/** The small arrow drawn before a current (an icon, not a character: our fonts have no arrows). */
export const ARROW_ICON = { width: 0.6, gap: 0.16 } as const;

/** The characters that stand for the arrow icon in a result's text. */
const ARROWS = new Set(['→', '←', '↑', '↓']);

/**
 * Room for kerning and rounding, so a measured line is never narrower than it is drawn: Caveat's
 * contextual alternates (its letters change shape with their neighbours, like handwriting) make
 * a word up to about 4 % wider than its letters' widths added up.
 */
const SLACK: Readonly<Partial<Record<MetricsKey, number>>> = { caveat700: 1.07 };
const DEFAULT_SLACK = 1.02;

const tables = new Map<MetricsKey, Map<string, number>>();
function table(face: MetricsKey): Map<string, number> {
  let t = tables.get(face);
  if (!t) {
    const m = METRICS[face];
    t = new Map([...m.chars].map((c, i) => [c, m.widths[i]!]));
    tables.set(face, t);
  }
  return t;
}

const DIGITS = '0123456789';
const widestDigits = new Map<MetricsKey, number>();
function widestDigit(face: MetricsKey): number {
  let w = widestDigits.get(face);
  if (w === undefined) {
    const t = table(face);
    w = Math.max(...[...DIGITS].map((d) => t.get(d) ?? METRICS[face].widest));
    widestDigits.set(face, w);
  }
  return w;
}

/**
 * The width of `text` in grid units as drawn in `style`, with a little room for kerning (`slack`;
 * false gives the plain sum, for placing things side by side): an arrow character counts as the
 * arrow icon and its gap. `anyDigit`: every digit counts as the face's widest digit (room for any
 * number with as many digits).
 */
export function widthIn(text: string, style: TypeStyle, anyDigit = false, slack = true): number {
  const t = table(style.face);
  let ems = 0;
  let icons = 0;
  for (const ch of text) {
    if (ARROWS.has(ch)) icons += 1;
    else if (anyDigit && DIGITS.includes(ch)) ems += widestDigit(style.face);
    else ems += t.get(ch) ?? METRICS[style.face].widest;
  }
  return ems * style.size * (slack ? (SLACK[style.face] ?? DEFAULT_SLACK) : 1) + icons * (ARROW_ICON.width + ARROW_ICON.gap);
}

/** A result's width: the wider of the handwriting and the plain font. */
export function resultWidth(text: string, anyDigit = false): number {
  return Math.max(widthIn(text, TYPE.hand, anyDigit), widthIn(text, TYPE.plain, anyDigit));
}

/**
 * The room a node voltage needs: the model keeps TEXT.resultChars under each node name, an ordinary
 * font's room for a result; the Notebook keeps room for any voltage of four digits, sign and prefix.
 */
export const NODE_VOLTAGE_ROOM = '−888.8 mV';

/**
 * The room a node voltage needs on its name's line ("s = 12 V", SceneOptions.nodeResultInline): the
 * model's own notation for a value (describe.ts, valueIs), with room for any voltage as above.
 */
export const NODE_INLINE_ROOM = DESCRIBE_STRINGS.valueIs('', NODE_VOLTAGE_ROOM).trim();

/** The Measure the schematic model uses for the Notebook look (SceneOptions.measure). */
export const notebookMeasure: Measure = (text: string, role: TextRole): number => {
  switch (role) {
    case 'result':
      // A sample of the widest text the line will hold: any digits in it may be any digit.
      return resultWidth(text === TEXT.resultChars ? NODE_VOLTAGE_ROOM : text, true);
    case 'name':
      return widthIn(text, TYPE.name);
    case 'value':
      return widthIn(text, TYPE.value);
    case 'node':
      return widthIn(text, TYPE.node);
    case 'hidden':
      return widthIn(text, TYPE.hidden);
  }
};
