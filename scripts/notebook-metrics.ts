/**
 * Writes src/notebook/metrics.ts: how wide each character is in the fonts the Notebook look draws
 * on the circuit (src/notebook/fonts/), so the schematic model can keep exactly the room the words
 * need (src/notebook/measure.ts) without a DOM, the same in the browser, in Node and in the tests.
 *
 *   node --experimental-strip-types scripts/notebook-metrics.ts
 *
 * Chromium (Playwright) loads the font files and measures every character on a canvas at 1000 px,
 * with the font stacks the CSS uses (src/notebook/notebook.css). A character that none of our fonts
 * has would come from a font of the reader's system, whose width nobody knows: it is written down
 * as missing and measure.ts keeps generous room for it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const fonts = resolve(root, 'src/notebook/fonts');

/** The faces, as the CSS declares them. */
const FACES = [
  { family: 'Inter', weight: 400, style: 'normal', file: 'inter-regular.woff2' },
  { family: 'Inter', weight: 500, style: 'normal', file: 'inter-medium.woff2' },
  { family: 'Inter', weight: 600, style: 'normal', file: 'inter-semibold.woff2' },
  { family: 'Caveat', weight: 700, style: 'normal', file: 'caveat-700.woff2' },
  { family: 'Notebook Serif', weight: 400, style: 'normal', file: 'notebook-serif-regular.woff2' },
] as const;

/**
 * What is measured: `stack` is the CSS font-family list the drawing uses for that kind of text
 * (Caveat has no Ω, so the handwriting falls back to Notebook Serif for it, as in the episodes).
 */
const STYLES = {
  inter400: { weight: 400, stack: "'Inter', 'Notebook Serif'" },
  inter500: { weight: 500, stack: "'Inter', 'Notebook Serif'" },
  inter600: { weight: 600, stack: "'Inter', 'Notebook Serif'" },
  caveat700: { weight: 700, stack: "'Caveat', 'Notebook Serif', 'Inter'" },
  serif400: { weight: 400, stack: "'Notebook Serif', 'Inter'" },
} as const;

/** Printable ASCII, the no-break space formatSI writes, and the symbols PlainSpice shows. */
const CHARSET = [
  ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)),
  ...' µΩ−×…·°±∞–—‘’“”éèêëáàâäíìîïóòôöúùûüçñşğıİÇŞĞÖÜÉ²³√Δθλπ'.split(''),
];

const fontFaces = FACES.map((f) => {
  const data = readFileSync(resolve(fonts, f.file)).toString('base64');
  return `@font-face { font-family: '${f.family}'; font-weight: ${f.weight}; font-style: ${f.style}; src: url(data:font/woff2;base64,${data}) format('woff2'); }`;
}).join('\n');

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head><style>${fontFaces}</style></head><body></body></html>`);
  const result = await page.evaluate(
    async ({ styles, charset }) => {
      const loads: Promise<unknown>[] = [];
      for (const s of Object.values(styles)) {
        for (const family of s.stack.split(',').map((x) => x.trim())) loads.push(document.fonts.load(`${s.weight} 100px ${family}`, charset.join('')));
      }
      await Promise.all(loads);
      const ctx = document.createElement('canvas').getContext('2d')!;
      const width = (font: string, ch: string): number => {
        ctx.font = font;
        return ctx.measureText(ch).width / 1000;
      };
      const out: Record<string, { widths: Record<string, number>; missing: string[] }> = {};
      for (const [key, s] of Object.entries(styles)) {
        const widths: Record<string, number> = {};
        const missing: string[] = [];
        for (const ch of charset) {
          // Two system fallbacks of different widths: a character our fonts have measures the same in both.
          const a = width(`${s.weight} 1000px ${s.stack}, monospace`, ch);
          const b = width(`${s.weight} 1000px ${s.stack}, serif`, ch);
          if (Math.abs(a - b) > 1e-6) missing.push(ch);
          else widths[ch] = Math.round(a * 10000) / 10000;
        }
        out[key] = { widths, missing };
      }
      return out;
    },
    { styles: STYLES, charset: CHARSET },
  );

  const lines: string[] = [
    '/**',
    ' * Character widths of the fonts the Notebook look draws on the circuit, in ems, measured in Chromium',
    ' * from src/notebook/fonts/ by scripts/notebook-metrics.ts (generated: do not edit by hand). Used by',
    ' * measure.ts so the schematic model keeps exactly the room the words need, without a DOM.',
    ' */',
    '',
    'export interface FontMetrics {',
    '  /** The characters measured, and their widths in ems (same order). */',
    '  chars: string;',
    '  widths: readonly number[];',
    '  /** The widest character measured: the room kept for a character the table does not have. */',
    '  widest: number;',
    '}',
    '',
    'export const METRICS = {',
  ];
  for (const [key, m] of Object.entries(result)) {
    const chars = Object.keys(m.widths);
    const widths = chars.map((c) => m.widths[c]!);
    const widest = Math.max(...widths);
    lines.push(`  ${key}: {`);
    lines.push(`    chars: ${JSON.stringify(chars.join(''))},`);
    lines.push(`    widths: [${widths.join(', ')}],`);
    lines.push(`    widest: ${widest},`);
    lines.push(`  },`);
    if (m.missing.length) console.log(`${key}: not in our fonts: ${m.missing.join(' ')}`);
  }
  lines.push('} as const satisfies Record<string, FontMetrics>;', '', 'export type MetricsKey = keyof typeof METRICS;', '');
  const file = resolve(root, 'src/notebook/metrics.ts');
  writeFileSync(file, lines.join('\n'));
  console.log(`wrote ${file}`);
} finally {
  await browser.close();
}
