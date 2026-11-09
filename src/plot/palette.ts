/**
 * How the plotted lines tell series apart: a colour, a dash pattern, a marker shape and a direct
 * label, always all four (WCAG 1.4.1: colour is never the only signal). Plain data, no DOM.
 *
 * Colours (decision 0004; checked in tests/unit/plot-palette.test.ts with the colour science in
 * src/theme/nodes.ts):
 * - Light: the Okabe–Ito subset #0072B2 #D55E00 #009E73 #CC79A7. Each is at least 3:1 against the
 *   panel colour #FFFDF6 (WCAG 1.4.11; pink is the lowest at 3.01:1), but pink is only 2.7:1 on
 *   the cream paper #F6F1E4, so the plot area is always drawn on the panel colour (--surface).
 * - Dark (for a dark --surface): the decision's dark set #56B4E9 #E69F00 #009E73 #CC79A7, in the
 *   light set's hue order so a series keeps its hue when the theme changes.
 * - High contrast (on white): darker versions of the same four hues, each at least 4.75:1 on
 *   white and on the panel colour. The first try (darkening each colour until 4.5:1) left blue
 *   and green only 7.7 apart for tritanopia, so these four were searched for: at least 14.9
 *   apart (CIEDE2000) for protanopia, deuteranopia and tritanopia, and 29.9 for normal vision.
 * - The channel's node colours v1 #E8590C, v2 #1971C2, v3 #7048E8 are not used: v2 and v3 are only
 *   4.3 apart for deuteranopia.
 * The app can override any colour with the CSS variables --plot-1 … --plot-4 (src/plot/theme.ts).
 */

export const PLOT_PALETTE_LIGHT: readonly string[] = ['#0072B2', '#D55E00', '#009E73', '#CC79A7'];
export const PLOT_PALETTE_DARK: readonly string[] = ['#56B4E9', '#E69F00', '#009E73', '#CC79A7'];
export const PLOT_PALETTE_MORE: readonly string[] = ['#004EA6', '#B33908', '#068257', '#9B5A7E'];

/** Dash patterns in CSS pixels for a 2 px line (scaled with the line width): solid, dashed, dotted, dash-dot. */
export const PLOT_DASHES: readonly (readonly number[])[] = [[], [8, 4], [2, 3], [8, 3, 2, 3]];

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond';
export const PLOT_MARKERS: readonly MarkerShape[] = ['circle', 'square', 'triangle', 'diamond'];

export interface SeriesStyle {
  /** Index into the palette (0–3). */
  colour: number;
  dash: readonly number[];
  marker: MarkerShape;
}

/**
 * The style of the i-th series. Colour and dash repeat every 4 series; from the fifth series on
 * the marker shifts, so no two of the first 16 series look the same even before reading labels.
 */
export function seriesStyle(index: number): SeriesStyle {
  const i = Math.max(0, Math.trunc(index));
  return {
    colour: i % 4,
    dash: PLOT_DASHES[i % 4] ?? [],
    marker: PLOT_MARKERS[(i + Math.floor(i / 4)) % 4] ?? 'circle',
  };
}

/** The marker outline as SVG path data in a box of half-size `r` around (cx, cy). */
export function markerPath(shape: MarkerShape, cx: number, cy: number, r: number): string {
  switch (shape) {
    case 'circle':
      return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
    case 'square':
      return `M${cx - r} ${cy - r}h${2 * r}v${2 * r}h${-2 * r}Z`;
    case 'triangle':
      return `M${cx} ${cy - 1.2 * r}L${cx + 1.15 * r} ${cy + 0.85 * r}L${cx - 1.15 * r} ${cy + 0.85 * r}Z`;
    case 'diamond':
      return `M${cx} ${cy - 1.3 * r}L${cx + 1.3 * r} ${cy}L${cx} ${cy + 1.3 * r}L${cx - 1.3 * r} ${cy}Z`;
  }
}
