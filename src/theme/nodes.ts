/**
 * Node colours: a palette of 8 colours that marks node names (a coloured bar under "n1" in the
 * editor, and later the same node in plots and the schematic), plus the colour science used to
 * check it (tests/unit/editor-palette.test.ts).
 *
 * Rules the palette is checked against:
 * - Colour is never the only signal: the node name is always written next to its colour.
 * - The bars are graphics, not text, so each colour needs 3:1 against the page (WCAG 1.4.11);
 *   the high-contrast set needs 4.5:1 against white.
 * - Every pair stays distinguishable for normal vision and for simulated protanopia,
 *   deuteranopia and tritanopia (Machado, Oliveira & Fernandes 2009, severity 1.0): CIEDE2000
 *   difference of at least NODE_PALETTE_MIN_DELTA_E (the test says why that number).
 *
 * Plain TypeScript, no DOM: usable from the editor, the plots and Node scripts.
 */

// ------------------------------------------------------------------ the palette

/**
 * Light mode (on cream paper #F6F1E4 and panels #FFFDF6). Nodes get colours in this order, and
 * the first colours are the most distinct, because most circuits have only 2 to 5 nodes.
 *
 * Orange and blue are the channel's v1 and v2 colours. The channel's v3 violet (#7048E8) is not
 * used: next to blue it is only 5.4 (protanopia) and 4.3 (deuteranopia) apart in CIEDE2000.
 * The other six were found by a search (maximise the smallest difference over the four kinds of
 * vision, with 3:1 contrast, enough chroma to look coloured, and away from the ink colour), then
 * named. Results for this set: smallest difference 20.8 for normal vision, 12.1 protanopia,
 * 11.6 deuteranopia, 12.3 tritanopia; lowest contrast 3.17:1 (orange on paper).
 */
export const NODE_PALETTE_LIGHT: readonly string[] = [
  '#E8590C', // orange
  '#1971C2', // blue
  '#009A57', // green
  '#8F0779', // purple
  '#B20E3D', // red
  '#1A14DD', // indigo
  '#B06F8E', // pink
  '#573311', // brown
];

/**
 * High-contrast mode (on white, black ink): the same hues, darker, each 4.5:1 or more on white.
 * Smallest difference 20.1 normal, 11.7 protanopia, 11.6 deuteranopia, 11.7 tritanopia.
 */
export const NODE_PALETTE_MORE: readonly string[] = [
  '#BF4A00', // orange
  '#1971C2', // blue
  '#0A6A52', // green
  '#72056B', // purple
  '#942636', // red
  '#0502F1', // indigo
  '#A15A87', // pink
  '#473102', // brown
];

/**
 * The smallest CIEDE2000 difference allowed between any two node colours under each simulated
 * colour vision deficiency (see tests/unit/editor-palette.test.ts for why 10).
 */
export const NODE_PALETTE_MIN_DELTA_E = 10;
/** The same for normal vision. */
export const NODE_PALETTE_MIN_DELTA_E_NORMAL = 20;

/** Plain-word names of the node colours, in palette order (for legends; never the only signal). */
export const NODE_STRINGS = {
  colourNames: ['orange', 'blue', 'green', 'purple', 'red', 'indigo', 'pink', 'brown'],
} as const;

/**
 * The CSS colour for the i-th node colour (0-based, wraps after 8): a custom property that
 * follows the contrast mode, with the light colour as fallback. The editor defines
 * --ps-node-1 ... --ps-node-8 itself; other parts of the app can use nodePaletteCss().
 */
export function nodeColour(index: number): string {
  const i = ((Math.trunc(index) % NODE_PALETTE_LIGHT.length) + NODE_PALETTE_LIGHT.length) % NODE_PALETTE_LIGHT.length;
  return `var(--ps-node-${i + 1}, ${NODE_PALETTE_LIGHT[i]})`;
}

/**
 * Give each node a colour in palette order, skipping ground ("0" or "gnd"): ground is the
 * reference, so it keeps the plain underline. After 8 nodes the colours repeat (the names are
 * always written, so two nodes never depend on colour to be told apart).
 */
export function assignNodeColours(names: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  for (const raw of names) {
    const name = raw.toLowerCase();
    if (name === '0' || name === 'gnd' || out.has(name)) continue;
    out.set(name, nodeColour(i++));
  }
  return out;
}

/** CSS that defines --ps-node-1 ... --ps-node-8 on :root for light and high-contrast modes. */
export function nodePaletteCss(): string {
  const decl = (palette: readonly string[]): string => palette.map((c, i) => `--ps-node-${i + 1}: ${c};`).join(' ');
  return [
    `:root { ${decl(NODE_PALETTE_LIGHT)} }`,
    `html[data-contrast="more"] { ${decl(NODE_PALETTE_MORE)} }`,
    `@media (prefers-contrast: more) { :root { ${decl(NODE_PALETTE_MORE)} } }`,
  ].join('\n');
}

// ------------------------------------------------------------------ colour science

/** An sRGB colour with channels from 0 to 1 (gamma-encoded, as in CSS). */
export type Rgb = readonly [r: number, g: number, b: number];
/** CIELAB (D65 white). */
export type Lab = readonly [l: number, a: number, b: number];

/** "#1971C2" or "#17c" -> [0.098, 0.443, 0.761]. */
export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a hex colour: ${hex}`);
  let digits = m[1]!;
  if (digits.length === 3) digits = [...digits].map((d) => d + d).join('');
  const n = Number.parseInt(digits, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** sRGB transfer function (IEC 61966-2-1): encoded channel -> linear light. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/**
 * WCAG 2.x relative luminance. (WCAG's text says 0.03928 where sRGB says 0.04045; no 8-bit
 * value falls between the two, so both give the same answer for CSS hex colours.)
 */
export function relativeLuminance(colour: string | Rgb): number {
  const [r, g, b] = (typeof colour === 'string' ? parseHex(colour) : colour).map(srgbToLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, from 1 (same) to 21 (black on white). */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export type Deficiency = 'protanopia' | 'deuteranopia' | 'tritanopia';

/**
 * Machado, Oliveira & Fernandes (2009), "A Physiologically-based Model for Simulation of Color
 * Vision Deficiency", IEEE TVCG 15(6), severity 1.0 (dichromacy: the hardest case). Row-major
 * 3x3 matrices applied to linear sRGB. Each row sums to 1, so white and greys are unchanged.
 */
export const MACHADO_2009: Readonly<Record<Deficiency, readonly number[]>> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

/** How a colour looks with the given colour vision deficiency (sRGB in, sRGB out, clamped). */
export function simulateDeficiency(colour: string | Rgb, deficiency: Deficiency): Rgb {
  const m = MACHADO_2009[deficiency];
  const [r, g, b] = (typeof colour === 'string' ? parseHex(colour) : colour).map(srgbToLinear) as [number, number, number];
  const out = [0, 1, 2].map((row) => {
    const v = m[3 * row]! * r + m[3 * row + 1]! * g + m[3 * row + 2]! * b;
    return linearToSrgb(Math.min(1, Math.max(0, v)));
  });
  return out as unknown as Rgb;
}

/** sRGB -> CIELAB with the D65 white point. */
export function rgbToLab(colour: string | Rgb): Lab {
  const [r, g, b] = (typeof colour === 'string' ? parseHex(colour) : colour).map(srgbToLinear) as [number, number, number];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  const fy = f(y);
  return [116 * fy - 16, 500 * (f(x) - fy), 200 * (fy - f(z))];
}

/**
 * CIEDE2000 colour difference (Sharma, Wu & Dalal 2005, with kL = kC = kH = 1). About 1 is the
 * smallest difference people notice between two large patches side by side.
 */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const [l1, a1, b1] = lab1;
  const [l2, a2, b2] = lab2;
  const rad = Math.PI / 180;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar7 = ((c1 + c2) / 2) ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number): number => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);

  const dLp = l2 - l1;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp / 2) * rad);

  const lBarP = (l1 + l2) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBarP = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hBarP = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hBarP = (h1p + h2p + 360) / 2;
    else hBarP = (h1p + h2p - 360) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos((hBarP - 30) * rad) +
    0.24 * Math.cos(2 * hBarP * rad) +
    0.32 * Math.cos((3 * hBarP + 6) * rad) -
    0.2 * Math.cos((4 * hBarP - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2));
  const cBarP7 = cBarP ** 7;
  const rc = 2 * Math.sqrt(cBarP7 / (cBarP7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt = -Math.sin(2 * dTheta * rad) * rc;
  const tl = dLp / sl;
  const tc = dCp / sc;
  const th = dHp / sh;
  return Math.sqrt(tl * tl + tc * tc + th * th + rt * tc * th);
}

/** CIEDE2000 difference between two sRGB colours. */
export function colourDifference(a: string | Rgb, b: string | Rgb): number {
  return deltaE2000(rgbToLab(a), rgbToLab(b));
}
