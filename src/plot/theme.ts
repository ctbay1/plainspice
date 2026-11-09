/**
 * The plot's colours and sizes, read from the page's CSS so the canvas follows the app's theme,
 * high-contrast mode, forced colours (Windows High Contrast) and text size. A canvas cannot use
 * CSS variables or system colours itself, so each one is resolved through a hidden probe element
 * to a colour the canvas understands. Read again on every redraw of the theme.
 *
 * Variables (with fallbacks, so the plot also works on a page that defines none of them):
 *   --surface  plot background (the panel colour; see palette.ts for why not the paper)
 *   --ink      axes, tick labels, direct labels (the cursor line is plain CSS, in plot.css)
 *   --rule     grid lines
 *   --font-ui  canvas text font
 *   --plot-1 … --plot-4  series colours; when unset, the light, dark or high-contrast set from
 *              palette.ts is used, chosen by the background and the contrast mode
 * Forced colours: background Canvas, text and every series CanvasText (dashes, markers and
 * labels keep them apart), grid GrayText; plot.css makes the cursor line Highlight.
 */
import { contrastRatio, relativeLuminance, type Rgb } from '../theme/nodes.ts';
import { PLOT_PALETTE_DARK, PLOT_PALETTE_LIGHT, PLOT_PALETTE_MORE } from './palette.ts';

export interface PlotTheme {
  background: string;
  ink: string;
  grid: string;
  /** Four series colours, already resolved for the canvas. */
  series: string[];
  fontFamily: string;
  /** The root font size in CSS pixels (16 by default, 32 in a 200 % text setting). */
  remPx: number;
  forced: boolean;
  /** High-contrast mode: html[data-contrast="more"], or prefers-contrast: more when the app sets no data-contrast. */
  more: boolean;
  dark: boolean;
  /** Grid lines as strong as the text (high contrast, forced colours) are drawn dotted, so they never look like data. */
  gridDotted: boolean;
}

const FALLBACK = {
  surface: '#FFFDF6',
  ink: '#1E2A45',
  rule: '#C9C2AE',
  font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

function matches(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches;
}

/** "rgb(30, 42, 69)", "rgba(…)", "rgb(30 42 69 / 1)" or "color(srgb 0.1 0.2 0.3)" -> channels 0–1. */
export function parseCssColour(text: string): Rgb | undefined {
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(text.trim());
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  const srgb = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(text.trim());
  if (srgb) return [Number(srgb[1]), Number(srgb[2]), Number(srgb[3])];
  const hex = /^#([0-9a-f]{6})$/i.exec(text.trim());
  if (hex) {
    const v = Number.parseInt(hex[1]!, 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  return undefined;
}

export function readTheme(host: HTMLElement): PlotTheme {
  const root = document.documentElement;
  const remPx = Number.parseFloat(getComputedStyle(root).fontSize) || 16;
  const forced = matches('(forced-colors: active)');
  const contrastAttribute = root.getAttribute('data-contrast');
  const more = contrastAttribute === null ? matches('(prefers-contrast: more)') : contrastAttribute === 'more';

  // The probe sits inside the figure, so variables set on any ancestor apply. forced-color-adjust
  // keeps system colours (Canvas, CanvasText …) readable as what they are, not as forced text.
  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;forced-color-adjust:none';
  host.append(probe);
  const style = getComputedStyle(probe);
  const resolve = (css: string, fallback: string): string => {
    probe.style.color = '';
    probe.style.color = css;
    const value = style.color;
    // A page (or a test DOM) that cannot resolve the colour gets the fallback.
    return value && !value.includes('var(') ? value : fallback;
  };
  const variable = (name: string): string => style.getPropertyValue(name).trim();

  let theme: PlotTheme;
  if (forced) {
    const text = resolve('CanvasText', '#000000');
    theme = {
      background: resolve('Canvas', '#FFFFFF'),
      ink: text,
      grid: resolve('GrayText', '#808080'),
      series: [text, text, text, text],
      fontFamily: FALLBACK.font,
      remPx,
      forced,
      more,
      dark: false,
      gridDotted: true,
    };
  } else {
    const background = resolve(`var(--surface, ${FALLBACK.surface})`, FALLBACK.surface);
    const ink = resolve(`var(--ink, ${FALLBACK.ink})`, FALLBACK.ink);
    const grid = resolve(`var(--rule, ${FALLBACK.rule})`, FALLBACK.rule);
    const bg = parseCssColour(background);
    const dark = bg !== undefined && relativeLuminance(bg) < 0.2;
    const defaults = dark ? PLOT_PALETTE_DARK : more ? PLOT_PALETTE_MORE : PLOT_PALETTE_LIGHT;
    const series = defaults.map((fallback, i) => {
      const own = variable(`--plot-${i + 1}`);
      return own ? resolve(own, fallback) : resolve(fallback, fallback);
    });
    const g = parseCssColour(grid);
    theme = {
      background,
      ink,
      grid,
      series,
      fontFamily: '',
      remPx,
      forced,
      more,
      dark,
      gridDotted: more || (bg !== undefined && g !== undefined && contrastRatio(g, bg) >= 3),
    };
  }
  probe.style.fontFamily = `var(--font-ui, ${FALLBACK.font})`;
  const family = style.fontFamily;
  theme.fontFamily = family && !family.includes('var(') ? family : FALLBACK.font;
  probe.remove();
  return theme;
}
