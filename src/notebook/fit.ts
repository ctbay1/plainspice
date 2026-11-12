/**
 * Fitting the drawing to the window: how many screen pixels a grid unit gets and where the
 * drawing's origin sits, so the whole circuit is in view and its words stay readable. Plain
 * TypeScript: the canvas measures the window, this decides.
 *
 * The words on the drawing have a smallest size on screen (minUnit). When the whole circuit does
 * not fit at that size (a wide circuit on a phone), readability wins: the drawing keeps the size,
 * the part that matters (`focus`: the selected part, say) is kept in view, and the reader pans to
 * the rest.
 */
import type { Box } from '../schematic/index.ts';
import { TYPE } from './measure.ts';

export interface Size {
  width: number;
  height: number;
}

/** Screen pixels covered on each side (a toolbar, a sheet, the panels). */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Where the drawing is: `unit` screen pixels per grid unit, and the screen point of the grid's origin. */
export interface View {
  unit: number;
  x: number;
  y: number;
}

export interface FitOptions {
  /** Space kept free around the drawing, in pixels. */
  padding: number;
  /** Fewest pixels per grid unit: below it the words are too small to read. */
  minUnit: number;
  /** Most pixels per grid unit: a small circuit does not grow huge. */
  maxUnit: number;
  /** What to keep in view when the whole drawing does not fit (grid units). Default: its top left. */
  focus?: Box;
  /**
   * 'whole' (default): the whole drawing in view when it fits at a readable size. 'height': as tall
   * as the window allows (within the limits), however wide that makes it: a wide drawing on a
   * phone, read from its left end and panned sideways.
   */
  fill?: 'whole' | 'height';
}

export interface Fit extends View {
  /** The whole drawing is in view. */
  whole: boolean;
}

/** The smallest size the drawing's names may have on screen, in pixels. */
export const MIN_TEXT_PX = 10.5;

/** The fewest pixels per grid unit that keep the drawing's names at least `px` pixels tall. */
export const minUnitFor = (px: number = MIN_TEXT_PX): number => px / Math.min(TYPE.name.size, TYPE.node.size, TYPE.plain.size);

const clamp = (v: number, lo: number, hi: number): number => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));

/** The view that shows `bounds` (grid units) in a window of `size` pixels, less `insets`. */
export function fitView(bounds: Box, size: Size, insets: Insets, options: FitOptions): Fit {
  const pad = options.padding;
  const fx0 = insets.left + pad;
  const fy0 = insets.top + pad;
  const fx1 = Math.max(fx0 + 1, size.width - insets.right - pad);
  const fy1 = Math.max(fy0 + 1, size.height - insets.bottom - pad);
  const fw = fx1 - fx0;
  const fh = fy1 - fy0;
  const bw = Math.max(1e-6, bounds.x1 - bounds.x0);
  const bh = Math.max(1e-6, bounds.y1 - bounds.y0);
  const fitUnit = options.fill === 'height' ? fh / bh : Math.min(fw / bw, fh / bh);
  const unit = Math.max(options.minUnit, Math.min(options.maxUnit, fitUnit));
  const focus = options.focus ?? { x0: bounds.x0, y0: bounds.y0, x1: Math.min(bounds.x1, bounds.x0 + fw / unit), y1: Math.min(bounds.y1, bounds.y0 + fh / unit) };
  const axis = (b0: number, b1: number, f0: number, f1: number, s0: number, s1: number): number => {
    const extent = (b1 - b0) * unit;
    const free = s1 - s0;
    if (extent <= free + 0.5) return s0 + (free - extent) / 2 - b0 * unit;
    // Too big: centre the focus, but never leave paper empty past the drawing's ends.
    const centred = s0 + (free - (f1 - f0) * unit) / 2 - f0 * unit;
    return clamp(centred, s1 - b1 * unit, s0 - b0 * unit);
  };
  const x = axis(bounds.x0, bounds.x1, focus.x0, focus.x1, fx0, fx1);
  const y = axis(bounds.y0, bounds.y1, focus.y0, focus.y1, fy0, fy1);
  return { unit, x, y, whole: bw * unit <= fw + 0.5 && bh * unit <= fh + 0.5 };
}

/**
 * All of the drawing (`ink`: what is drawn, in grid units, not the room kept around it for longer
 * numbers) is in the free part of the window, give or take `slack` pixels.
 */
export function inkInView(view: View, ink: Box, size: Size, insets: Insets, slack = 4): boolean {
  return (
    view.x + ink.x0 * view.unit >= insets.left - slack &&
    view.x + ink.x1 * view.unit <= size.width - insets.right + slack &&
    view.y + ink.y0 * view.unit >= insets.top - slack &&
    view.y + ink.y1 * view.unit <= size.height - insets.bottom + slack
  );
}

/** The view zoomed by `factor` about a screen point, within the unit limits. */
export function zoomAt(view: View, factor: number, at: { x: number; y: number }, limits: { minUnit: number; maxUnit: number }): View {
  const unit = Math.max(limits.minUnit, Math.min(limits.maxUnit, view.unit * factor));
  const k = unit / view.unit;
  return { unit, x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k };
}

/** A grid point on screen. */
export const toScreen = (view: View, p: { x: number; y: number }): { x: number; y: number } => ({ x: view.x + p.x * view.unit, y: view.y + p.y * view.unit });

/** A screen point on the grid. */
export const toGrid = (view: View, p: { x: number; y: number }): { x: number; y: number } => ({ x: (p.x - view.x) / view.unit, y: (p.y - view.y) / view.unit });
