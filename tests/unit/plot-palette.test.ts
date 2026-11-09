/**
 * The plot's series colours (src/plot/palette.ts), checked with the project's colour science
 * (src/theme/nodes.ts): WCAG contrast for graphics (1.4.11, 3:1), and differences between every
 * pair under simulated protanopia, deuteranopia and tritanopia (Machado et al. 2009, severity 1).
 * The same thresholds as the node palette: 10 (CIEDE2000) for colour vision deficiency and 20
 * for normal vision.
 */
import { describe, expect, it } from 'vitest';
import { PLOT_PALETTE_DARK, PLOT_PALETTE_LIGHT, PLOT_PALETTE_MORE } from '../../src/plot/palette.ts';
import {
  colourDifference,
  contrastRatio,
  NODE_PALETTE_MIN_DELTA_E,
  NODE_PALETTE_MIN_DELTA_E_NORMAL,
  simulateDeficiency,
  type Deficiency,
} from '../../src/theme/nodes.ts';

const SURFACE = '#FFFDF6'; // --surface: the plot area's background
const PAPER = '#F6F1E4'; // --paper: the page
const DEFICIENCIES: Deficiency[] = ['protanopia', 'deuteranopia', 'tritanopia'];

function smallestDifferences(colours: readonly string[]): { normal: number; deficient: number } {
  let normal = Infinity;
  let deficient = Infinity;
  for (let i = 0; i < colours.length; i++) {
    for (let j = i + 1; j < colours.length; j++) {
      normal = Math.min(normal, colourDifference(colours[i]!, colours[j]!));
      for (const d of DEFICIENCIES) {
        deficient = Math.min(deficient, colourDifference(simulateDeficiency(colours[i]!, d), simulateDeficiency(colours[j]!, d)));
      }
    }
  }
  return { normal, deficient };
}

describe('plot palettes', () => {
  it('light: the Okabe–Ito subset of decision 0004, at least 3:1 on the plot area (--surface)', () => {
    expect(PLOT_PALETTE_LIGHT).toEqual(['#0072B2', '#D55E00', '#009E73', '#CC79A7']);
    for (const c of PLOT_PALETTE_LIGHT) expect(contrastRatio(c, SURFACE)).toBeGreaterThanOrEqual(3);
  });

  it('why the plot area is --surface and not the paper: pink is under 3:1 on the paper', () => {
    expect(contrastRatio('#CC79A7', PAPER)).toBeLessThan(3);
  });

  it('dark: the decision\'s dark colours, at least 3:1 on a dark surface', () => {
    expect([...PLOT_PALETTE_DARK].sort()).toEqual(['#009E73', '#56B4E9', '#CC79A7', '#E69F00']);
    for (const bg of ['#161616', '#1E2A45']) for (const c of PLOT_PALETTE_DARK) expect(contrastRatio(c, bg)).toBeGreaterThanOrEqual(3);
  });

  it('high contrast: at least 4.75:1 on white and on --surface', () => {
    for (const bg of ['#FFFFFF', SURFACE]) for (const c of PLOT_PALETTE_MORE) expect(contrastRatio(c, bg)).toBeGreaterThanOrEqual(4.75);
  });

  it.each([
    ['light', PLOT_PALETTE_LIGHT],
    ['dark', PLOT_PALETTE_DARK],
    ['high contrast', PLOT_PALETTE_MORE],
  ])('%s: every pair stays apart for normal and deficient colour vision', (_name, palette) => {
    const { normal, deficient } = smallestDifferences(palette);
    expect(normal).toBeGreaterThanOrEqual(NODE_PALETTE_MIN_DELTA_E_NORMAL);
    expect(deficient).toBeGreaterThanOrEqual(NODE_PALETTE_MIN_DELTA_E);
  });

  it('the high-contrast set keeps its pairs further apart than darkening the light set would (7.7)', () => {
    expect(smallestDifferences(PLOT_PALETTE_MORE).deficient).toBeGreaterThanOrEqual(14.9);
    expect(smallestDifferences(PLOT_PALETTE_MORE).normal).toBeGreaterThanOrEqual(29.9);
  });

  it('the channel\'s node colours v2 and v3 would not do (too close for deuteranopia)', () => {
    const d = colourDifference(simulateDeficiency('#1971C2', 'deuteranopia'), simulateDeficiency('#7048E8', 'deuteranopia'));
    expect(d).toBeLessThan(NODE_PALETTE_MIN_DELTA_E);
  });
});
