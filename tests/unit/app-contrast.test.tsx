/**
 * Colour contrast of the app's theme tokens (src/styles/app.css), computed, in the normal and the
 * high-contrast theme (WCAG 2.2: 1.4.3 text 4.5:1, 1.4.11 UI parts and focus rings 3:1). The Notebook
 * look's own tokens (--nb-*, src/notebook/notebook.css) are tested in notebook-look; here, the
 * high-contrast Notebook the app adds. The editor and the plots test their own colours
 * (editor-palette, plot-palette).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../src/theme/nodes.ts';

const css = readFileSync(resolve(import.meta.dirname, '../../src/styles/app.css'), 'utf8');

/** The custom properties of the first block whose selector is `selector`. */
function tokens(selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const normal = tokens(':root');
const more = { ...normal, ...tokens("html[data-contrast='more']") };

/** [foreground, background, minimum ratio, what it is] */
const PAIRS: [string, string, number, string][] = [
  ['ink', 'paper', 4.5, 'text on the page'],
  ['ink', 'surface', 4.5, 'text in panels and tables'],
  ['ink', 'hover', 4.5, 'text on a hovered button or tab'],
  ['pencil', 'paper', 4.5, 'hints and secondary text on the page'],
  ['pencil', 'surface', 4.5, 'secondary text in panels'],
  ['note', 'paper', 4.5, 'links on the page'],
  ['note', 'surface', 4.5, 'links and "Line n" buttons in panels'],
  ['ok', 'surface', 4.5, '"Finished", fix buttons'],
  ['ok', 'tint-ok', 4.5, '"Finished" on its banner'],
  ['bad', 'surface', 4.5, '"Error" words'],
  ['bad', 'tint-bad', 4.5, '"Error" on its banner'],
  ['warn', 'surface', 4.5, '"Warning" words'],
  ['warn', 'tint-warn', 4.5, '"Not reliable" on its banner'],
  ['ink', 'tint-ok', 4.5, 'banner text'],
  ['ink', 'tint-bad', 4.5, 'banner text'],
  ['ink', 'tint-warn', 4.5, 'banner text'],
  ['ink', 'tint-note', 4.5, 'update banner text'],
  ['on-strong', 'ink', 4.5, 'Run button text, a focused menu item'],
  ['on-strong', 'bad', 4.5, 'Stop button text'],
  ['focus', 'paper', 3, 'focus ring on the page'],
  ['focus', 'surface', 3, 'focus ring in panels'],
  ['pencil', 'paper', 3, 'panel and field borders'],
  ['ink', 'paper', 3, 'button borders'],
  ['note', 'surface', 3, 'notice border'],
];

describe.each([
  ['normal theme', normal],
  ['high-contrast theme', more],
])('%s', (_name, theme) => {
  it.each(PAIRS)('%s on %s: at least %s:1 (%s)', (fg, bg, min) => {
    const a = theme[fg];
    const b = theme[bg];
    expect(a, fg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(b, bg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrastRatio(a!, b!)).toBeGreaterThanOrEqual(min);
  });
});

/** The Notebook's tokens in the app's high-contrast theme (white paper, black ink, darker pens). */
const notebookMore = (() => {
  const at = css.indexOf("html[data-contrast='more'] :is(.nb-theme, .nb-canvas) {");
  if (at < 0) throw new Error('no high-contrast Notebook block');
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/--nb-([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
})();

describe('the Notebook in high contrast', () => {
  /** [foreground, background, minimum ratio, what it is] */
  const NB_PAIRS: [string, string, number, string][] = [
    ['ink', 'paper', 7, 'the drawing, the app’s words'],
    ['ink', 'card', 7, 'cards and panels'],
    ['ink', 'note', 7, 'the sticky note'],
    ['ink', 'paper-sunk', 4.5, 'a pressed tab'],
    ['pencil', 'paper', 4.5, 'hints, the status line'],
    ['pencil', 'card', 4.5, 'secondary words on cards'],
    ['red-text', 'paper', 4.5, 'red pen: a trap, no single answer'],
    ['red-text', 'card', 4.5, 'red words on a card'],
    ['green-text', 'paper', 4.5, 'power, “Solved”'],
    ['amber-text', 'paper', 4.5, 'currents'],
    ['amber-text', 'card', 4.5, 'currents on a card'],
    ['paper-edge', 'paper', 3, 'card and field borders'],
    ['note-edge', 'note', 3, 'the sticky note’s edge'],
  ];
  it.each(NB_PAIRS)('%s on %s: at least %s:1 (%s)', (fg, bg, min) => {
    const a = notebookMore[fg];
    const b = notebookMore[bg];
    expect(a, fg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(b, bg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrastRatio(a!, b!)).toBeGreaterThanOrEqual(min);
  });

  it('follows the device too, with the same values as data-contrast="more"', () => {
    const media = css.indexOf('html:not([data-contrast]) :is(.nb-theme, .nb-canvas) {');
    expect(media).toBeGreaterThan(0);
    const block = css.slice(css.indexOf('{', media) + 1, css.indexOf('}', media));
    const values = Object.fromEntries([...block.matchAll(/--nb-([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
    expect(values).toEqual(notebookMore);
  });
});

describe('themes', () => {
  it('the tokens the brief names keep their values (the focus ring is ink, as in the Notebook look Tarık approved)', () => {
    expect(normal).toMatchObject({
      paper: '#f6f1e4',
      surface: '#fffdf6',
      ink: '#1e2a45',
      pencil: '#545863',
      rule: '#c9c2ae',
      focus: '#1e2a45',
      ok: '#1e6b30',
      bad: '#b42318',
      warn: '#8a4b00',
      'accent-current': '#8a4b00',
    });
  });

  it('high contrast follows the device too, with the same values as data-contrast="more"', () => {
    const media = css.slice(css.indexOf('@media (prefers-contrast: more)'));
    const block = media.slice(media.indexOf('{', media.indexOf('html:not([data-contrast])')) + 1, media.indexOf('}'));
    const values = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
    expect(values).toEqual(tokens("html[data-contrast='more']"));
  });

  it('text sizes are 125 % and 150 %', () => {
    expect(css).toMatch(/html\[data-text-size='large'\] \{\s*font-size: 125%;/);
    expect(css).toMatch(/html\[data-text-size='x-large'\] \{\s*font-size: 150%;/);
  });
});
