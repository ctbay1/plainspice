import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import {
  EDITOR_BACKGROUNDS,
  GUTTER_TEXT,
  INLINE_NOTE_FALLBACK,
  SYNTAX_COLOURS,
  editorColourTheme,
  spiceHighlightStyle,
  type ContrastMode,
  type SyntaxRole,
} from '../../src/editor/highlight.ts';
import {
  MACHADO_2009,
  NODE_PALETTE_LIGHT,
  NODE_PALETTE_MIN_DELTA_E,
  NODE_PALETTE_MIN_DELTA_E_NORMAL,
  NODE_PALETTE_MORE,
  NODE_STRINGS,
  assignNodeColours,
  colourDifference,
  contrastRatio,
  deltaE2000,
  nodeColour,
  nodePaletteCss,
  parseHex,
  relativeLuminance,
  rgbToLab,
  simulateDeficiency,
  toHex,
  type Deficiency,
} from '../../src/theme/nodes.ts';

const MODES: ContrastMode[] = ['normal', 'more'];
const DEFICIENCIES: Deficiency[] = ['protanopia', 'deuteranopia', 'tritanopia'];

/** The app's theme tokens (the editor's text sits on --surface; the page is --paper). */
const PAPER = '#F6F1E4';

describe('colour science', () => {
  it('WCAG contrast: known values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    // The app's pencil grey on paper, as noted in the spike's CSS ("5.6:1" there is on #F6F1E4 rounded down).
    expect(contrastRatio('#545863', PAPER)).toBeGreaterThan(6.3);
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 4);
  });

  it('hex round trip', () => {
    expect(toHex(parseHex('#1971c2'))).toBe('#1971C2');
    expect(toHex(parseHex('#17c'))).toBe('#1177CC');
    expect(() => parseHex('blue')).toThrow();
  });

  /*
   * CIEDE2000 reference pairs from Sharma, Wu & Dalal (2005), "The CIEDE2000 color-difference
   * formula: implementation notes, supplementary test data, and mathematical observations",
   * Color Research & Application 30(1), Table 1.
   */
  it.each([
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
    [[50, -0.001, 2.49], [50, 0.0011, -2.49], 4.7461],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [56, -27, -3], 31.903],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ] as const)('CIEDE2000 %j vs %j = %f (Sharma et al.)', (a, b, expected) => {
    expect(deltaE2000(a, b)).toBeCloseTo(expected, 4);
    expect(deltaE2000(b, a)).toBeCloseTo(expected, 4);
  });

  it('CIELAB of white and black (D65)', () => {
    const white = rgbToLab('#FFFFFF');
    expect(white[0]).toBeCloseTo(100, 2);
    expect(Math.abs(white[1])).toBeLessThan(0.01);
    expect(Math.abs(white[2])).toBeLessThan(0.01);
    expect(rgbToLab('#000000')[0]).toBeCloseTo(0, 5);
  });

  it('Machado 2009 matrices keep white, black and greys unchanged (rows sum to 1)', () => {
    for (const d of DEFICIENCIES) {
      const m = MACHADO_2009[d];
      for (let row = 0; row < 3; row++) expect(m[3 * row]! + m[3 * row + 1]! + m[3 * row + 2]!).toBeCloseTo(1, 5);
      for (const grey of ['#FFFFFF', '#000000', '#808080']) expect(toHex(simulateDeficiency(grey, d))).toBe(grey);
    }
  });

  it('simulations behave as the deficiencies do: red and green merge for protan/deutan, blue and green for tritan', () => {
    // Pure red vs pure green differ hugely for normal vision...
    expect(colourDifference('#FF0000', '#00FF00')).toBeGreaterThan(80);
    // ...and much less with protanopia/deuteranopia; tritanopia keeps red and green apart.
    const red = '#D62728';
    const green = '#2CA02C';
    expect(colourDifference(simulateDeficiency(red, 'deuteranopia'), simulateDeficiency(green, 'deuteranopia'))).toBeLessThan(
      colourDifference(simulateDeficiency(red, 'tritanopia'), simulateDeficiency(green, 'tritanopia')),
    );
  });
});

describe('syntax colours: 4.5:1 on every background of their mode', () => {
  for (const mode of MODES) {
    const backgrounds = { ...EDITOR_BACKGROUNDS[mode], ...(mode === 'more' ? { creamSurface: '#FFFDF6' } : { paper: PAPER }) };
    for (const [role, colour] of Object.entries(SYNTAX_COLOURS[mode])) {
      for (const [bgName, bg] of Object.entries(backgrounds)) {
        it(`${mode}: ${role} ${colour} on ${bgName} ${bg}`, () => {
          expect(contrastRatio(colour, bg)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }

  it('high contrast mode really is higher: 7:1 or more on white for every text colour', () => {
    for (const colour of Object.values(SYNTAX_COLOURS.more)) expect(contrastRatio(colour, '#FFFFFF')).toBeGreaterThanOrEqual(7);
  });

  it('line numbers and inline results pass 4.5:1 too', () => {
    for (const mode of MODES) {
      const bg = EDITOR_BACKGROUNDS[mode];
      expect(contrastRatio(GUTTER_TEXT[mode], bg.gutter)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(GUTTER_TEXT[mode], bg.activeGutter)).toBeGreaterThanOrEqual(4.5);
      // The active line number uses the element (ink) colour.
      expect(contrastRatio(SYNTAX_COLOURS[mode].element, bg.activeGutter)).toBeGreaterThanOrEqual(4.5);
      for (const b of [bg.surface, bg.activeLine, bg.selection]) expect(contrastRatio(INLINE_NOTE_FALLBACK, b)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the highlight style uses exactly these colours (as custom properties with the normal colour as fallback)', () => {
    const used = new Set<string>();
    for (const spec of spiceHighlightStyle.specs) {
      for (const value of [spec['color'], spec['textDecorationColor']]) {
        if (typeof value !== 'string') continue;
        const m = /^var\(--ps-syn-([a-z]+), (#[0-9A-F]{6})\)$/.exec(value);
        expect(m, `colour ${value} must be var(--ps-syn-<role>, <normal colour>)`).not.toBeNull();
        const role = m![1] as SyntaxRole;
        expect(SYNTAX_COLOURS.normal[role]).toBe(m![2]);
        used.add(role);
      }
    }
    expect([...used].sort()).toEqual(Object.keys(SYNTAX_COLOURS.normal).sort());
  });

  it('the editor theme defines the high-contrast colours for html[data-contrast="more"] and prefers-contrast: more', () => {
    const state = EditorState.create({ extensions: [editorColourTheme] });
    const css = state.facet(EditorView.styleModule).map((m) => m.getRules()).join('\n');
    const attrRule = /html\[data-contrast="more"\] [^{]+ \.cm-scroller \{([^}]*)\}/.exec(css)?.[1] ?? '';
    const mediaRule = /@media \(prefers-contrast: more\) \{[^{]+\{([^}]*)\}/.exec(css)?.[1] ?? '';
    for (const [role, colour] of Object.entries(SYNTAX_COLOURS.more)) {
      expect(attrRule).toContain(`--ps-syn-${role}: ${colour};`);
      expect(mediaRule).toContain(`--ps-syn-${role}: ${colour};`);
    }
    NODE_PALETTE_MORE.forEach((c, i) => expect(attrRule).toContain(`--ps-node-${i + 1}: ${c};`));
    expect(attrRule).toContain(`--ps-active-line: ${EDITOR_BACKGROUNDS.more.activeLine};`);
  });
});

describe('colour is never the only signal in the highlighting', () => {
  /** Weight, slant and line of each token style; node names also get an underline from the node marks. */
  const signature = (tagName: string): string => {
    const spec = spiceHighlightStyle.specs.find((s) => [s.tag].flat().some((t) => String(t).includes(tagName)))!;
    expect(spec, tagName).toBeDefined();
    return [spec['fontWeight'] ?? '400', spec['fontStyle'] ?? 'normal', spec['textDecorationLine'] ?? (tagName === 'spiceNode' ? 'underline' : 'none')].join(' ');
  };

  it.each([
    // Neighbours on the same line must differ in something other than colour.
    ['spiceElement', 'spiceNode'], // R1 n1
    ['spiceNode', 'number'], // n2 1k
    ['number', 'spiceScale'], // 1 k
    ['spiceScale', 'spiceScaleCapitalM'], // k vs M
    ['spiceScale', 'spiceIgnored'], // k Ohm
    ['spiceFunction', 'number'], // PULSE( 0
    ['spiceFunction', 'keyword'], // SIN vs DC
    ['attributeName', 'number'], // ic=0
    ['spiceTitle', 'lineComment'], // title vs comment
    ['number', 'lineComment'], // 2 ; note
    ['spiceDirective', 'number'], // .tran 10u
  ])('%s and %s differ in weight, slant or underline', (a, b) => {
    expect(signature(a)).not.toBe(signature(b));
  });
});

describe('node colours: colour-blind safe, 8 colours, light and high contrast', () => {
  /*
   * The threshold. CIEDE2000 is scaled so that about 1 is the smallest difference people see
   * between two large patches side by side. Node colours are thin bars, far apart, and must be
   * told apart at a glance, so they need many times that (small marks need bigger differences:
   * Stone, Szafir & Setlur 2014, "An engineering model for color difference as a function of
   * size"). We require 10 under each simulated dichromacy and 20 for normal vision. As a check
   * that 10 means something: the Okabe–Ito palette, the usual reference for colour-blind-safe
   * colours, keeps every pair at least 10.9 apart under these simulations, while Tableau 10,
   * which is known not to be colour-blind safe, falls to 0.7 (see the benchmark test below).
   * Simulating full dichromacy is the worst case; most colour-blind people (anomalous
   * trichromats) see larger differences than the simulation.
   */
  const minDifference = (palette: readonly string[], deficiency?: Deficiency): { d: number; pair: string } => {
    const sim = palette.map((c) => (deficiency ? simulateDeficiency(c, deficiency) : parseHex(c)));
    let best = { d: Infinity, pair: '' };
    for (let i = 0; i < sim.length; i++)
      for (let j = i + 1; j < sim.length; j++) {
        const d = colourDifference(sim[i]!, sim[j]!);
        if (d < best.d) best = { d, pair: `${palette[i]} / ${palette[j]}` };
      }
    return best;
  };

  it('the threshold separates a known safe palette from a known unsafe one', () => {
    const okabeIto = ['#000000', '#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7'];
    const tableau10 = ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC'];
    for (const d of DEFICIENCIES) expect(minDifference(okabeIto, d).d).toBeGreaterThanOrEqual(NODE_PALETTE_MIN_DELTA_E);
    expect(Math.min(...DEFICIENCIES.map((d) => minDifference(tableau10, d).d))).toBeLessThan(2);
  });

  it("the channel's v2 blue and v3 violet are too close for protan and deutan viewers (why v3 is not used)", () => {
    expect(minDifference(['#1971C2', '#7048E8'], 'protanopia').d).toBeLessThan(NODE_PALETTE_MIN_DELTA_E);
    expect(minDifference(['#1971C2', '#7048E8'], 'deuteranopia').d).toBeLessThan(NODE_PALETTE_MIN_DELTA_E);
  });

  for (const [name, palette, backgrounds, minContrast] of [
    ['light', NODE_PALETTE_LIGHT, [PAPER, EDITOR_BACKGROUNDS.normal.surface, EDITOR_BACKGROUNDS.normal.activeLine], 3],
    ['high contrast', NODE_PALETTE_MORE, ['#FFFFFF', EDITOR_BACKGROUNDS.more.activeLine], 4.5],
  ] as const) {
    describe(name, () => {
      it('has 8 different colours, each with a plain-word name', () => {
        expect(palette).toHaveLength(8);
        expect(new Set(palette).size).toBe(8);
        expect(NODE_STRINGS.colourNames).toHaveLength(8);
      });

      it(`every colour has ${minContrast}:1 or more against the backgrounds it is drawn on (WCAG 1.4.11)`, () => {
        for (const c of palette) for (const bg of backgrounds) expect(contrastRatio(c, bg), `${c} on ${bg}`).toBeGreaterThanOrEqual(minContrast);
      });

      it(`every pair differs by ${NODE_PALETTE_MIN_DELTA_E_NORMAL} or more (CIEDE2000) for normal vision`, () => {
        const { d, pair } = minDifference(palette);
        expect(d, pair).toBeGreaterThanOrEqual(NODE_PALETTE_MIN_DELTA_E_NORMAL);
      });

      it.each(DEFICIENCIES)(`every pair differs by ${NODE_PALETTE_MIN_DELTA_E} or more with simulated %s`, (deficiency) => {
        const { d, pair } = minDifference(palette, deficiency);
        expect(d, pair).toBeGreaterThanOrEqual(NODE_PALETTE_MIN_DELTA_E);
      });

      it('stays apart from the ink colour, so a bar never looks like plain underlined text', () => {
        const ink = name === 'light' ? '#1E2A45' : '#000000';
        for (const c of palette) {
          expect(colourDifference(c, ink)).toBeGreaterThanOrEqual(NODE_PALETTE_MIN_DELTA_E);
          for (const d of DEFICIENCIES) {
            expect(colourDifference(simulateDeficiency(c, d), simulateDeficiency(ink, d)), `${c} vs ink, ${d}`).toBeGreaterThanOrEqual(NODE_PALETTE_MIN_DELTA_E);
          }
        }
      });
    });
  }

  it('the first three colours (most circuits) are far apart in every kind of vision', () => {
    for (const palette of [NODE_PALETTE_LIGHT, NODE_PALETTE_MORE]) {
      for (const d of DEFICIENCIES) expect(minDifference(palette.slice(0, 3), d).d).toBeGreaterThanOrEqual(12);
    }
  });

  it('high contrast keeps each colour recognisable: same hue family as the light colour', () => {
    const hue = (c: string): number => {
      const [, a, b] = rgbToLab(c);
      return (Math.atan2(b, a) * 180) / Math.PI;
    };
    NODE_PALETTE_LIGHT.forEach((c, i) => {
      let dh = Math.abs(hue(c) - hue(NODE_PALETTE_MORE[i]!));
      if (dh > 180) dh = 360 - dh;
      expect(dh, `${c} vs ${NODE_PALETTE_MORE[i]}`).toBeLessThanOrEqual(25);
    });
  });
});

describe('node colour helpers', () => {
  it('nodeColour gives a custom property with the light colour as fallback, wrapping after 8', () => {
    expect(nodeColour(0)).toBe('var(--ps-node-1, #E8590C)');
    expect(nodeColour(8)).toBe(nodeColour(0));
    expect(nodeColour(-1)).toBe(nodeColour(7));
  });

  it('assignNodeColours skips ground and repeated names, in order of first appearance', () => {
    const map = assignNodeColours(['n1', '0', 'N1', 'gnd', 'out']);
    expect([...map.entries()]).toEqual([
      ['n1', nodeColour(0)],
      ['out', nodeColour(1)],
    ]);
  });

  it('nodePaletteCss defines both palettes', () => {
    const css = nodePaletteCss();
    for (const c of [...NODE_PALETTE_LIGHT, ...NODE_PALETTE_MORE]) expect(css).toContain(c);
    expect(css).toContain('html[data-contrast="more"]');
    expect(css).toContain('@media (prefers-contrast: more)');
  });
});
