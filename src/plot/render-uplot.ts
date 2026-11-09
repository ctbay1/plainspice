/**
 * The renderer: the only file that uses uPlot (decision 0004), so it can be swapped for another
 * library or our own SVG renderer without touching the accessible layer in plot.ts.
 *
 * It draws one uPlot chart per panel (series that share a unit; panels are stacked when units
 * differ, with one x scale and a synced cursor), and adds what uPlot does not draw: a marker
 * shape on each line and a direct label at the end of each line. Everything a person or a
 * screen reader uses (cursor keys, readout, table) lives in plot.ts.
 *
 * Sizes come from the root font size, so the canvas text follows the app's large-text modes and
 * the browser's text setting (plot.ts rebuilds the renderer when the root font size changes).
 * Notes on uPlot 1.6.32 behaviour this relies on (read from its source):
 * - setScale() and the first draw happen in a microtask; batch() applies them at once.
 * - Line width is given in CSS pixels, but dash patterns are in canvas pixels: scaled here.
 * - The font size in `font` must be a whole number of px (uPlot rewrites "(\d+)px").
 * - It hides its cursor when the mouse leaves; the plot's cursor stays where it was, so it is
 *   put back.
 */
import uPlot from 'uplot';
import type { PreparedPlot } from './data.ts';
import { tickLabels } from './format.ts';
import { markerPath, type MarkerShape } from './palette.ts';
import { PLOT_STRINGS } from './strings.ts';
import type { PlotTheme } from './theme.ts';

export interface RendererCallbacks {
  /** The mouse moved uPlot's cursor to point `index` (x increasing). */
  hover(index: number): void;
  /** The view changed (by any route: buttons, keys, mouse drag, double-click). */
  view(min: number, max: number): void;
}

export interface Renderer {
  /** Draw the cursor at point `index` in every panel. */
  setCursor(index: number): void;
  /** Show x from `min` to `max` in every panel, at once. */
  setView(min: number, max: number): void;
  /** The x range shown now. */
  view(): [number, number];
  /** The point under a pointer at `clientX` (clamped to the plot area), for touch scrubbing. */
  indexAt(clientX: number): number | undefined;
  resize(width: number): void;
  destroy(): void;
}

/** Markers are drawn about this many CSS px apart along each line... */
const MARKER_SPACING = 96;
/** ...offset per series, so markers of different series do not stack up. */
const MARKER_STAGGER = 24;
/** When points are at least this many CSS px apart (a short dc sweep), every point gets a marker. */
const EVERY_POINT_GAP = 12;

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Width of `text` in CSS px for a canvas font (an estimate where canvas is not available, as in jsdom). */
function textWidth(text: string, font: string, fontPx: number): number {
  if (measureContext === undefined) measureContext = document.createElement('canvas').getContext('2d');
  if (!measureContext) return text.length * fontPx * 0.62;
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

const raf: (callback: () => void) => number =
  typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(cb) : (cb) => setTimeout(cb, 16) as unknown as number;
const cancelRaf: (handle: number) => void =
  typeof cancelAnimationFrame === 'function' ? (h) => cancelAnimationFrame(h) : (h) => clearTimeout(h);

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
const overlaps = (a: Box, b: Box): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

function drawMarker(ctx: CanvasRenderingContext2D, shape: MarkerShape, x: number, y: number, r: number, fill: string, halo: string, pr: number): void {
  const path = new Path2D(markerPath(shape, x, y, r));
  // A thin outline in the background colour keeps a marker visible where lines cross.
  ctx.lineWidth = 2 * pr;
  ctx.strokeStyle = halo;
  ctx.stroke(path);
  ctx.fillStyle = fill;
  ctx.fill(path);
}

let syncCount = 0;

export function createRenderer(
  host: HTMLElement,
  plot: PreparedPlot,
  theme: PlotTheme,
  width: number,
  callbacks: RendererCallbacks,
  initial: { index: number; view?: [number, number] | undefined },
): Renderer {
  const rem = theme.remPx;
  const fontPx = Math.max(12, Math.round(rem * 0.875));
  const font = `${fontPx}px ${theme.fontFamily}`;
  const boldFont = `600 ${fontPx}px ${theme.fontFamily}`;
  const lineWidth = Math.max(2, Math.round(rem / 8));
  const tick = Math.round(rem * 0.35);
  const gap = Math.round(rem * 0.25);
  const markerRadius = rem * 0.28;
  const labelSize = Math.round(fontPx * 1.7);
  const xAxisSize = Math.round(fontPx * 1.4) + tick + gap;
  const stacked = plot.panels.length > 1;
  const plotHeight = stacked ? Math.max(150, Math.round(rem * 10.5)) : Math.max(220, Math.round(rem * 16));
  const syncKey = `ps-plot-sync-${++syncCount}`;
  const x = plot.x;
  let currentIndex = initial.index;

  // Stacked panels must start their plot areas at the same x, so every panel's y axis is as wide
  // as the widest one. Each axis measures its own tick labels; when the widest changes, the
  // other panels lay out again once (y labels do not depend on the axis width, so this settles).
  const measured = plot.panels.map(() => 0);
  const returned = plot.panels.map(() => 0);
  let shared = 0;
  let alignFrame = 0;
  const ySize =
    (p: number) =>
    (_u: uPlot, values: string[] | null): number => {
      if (values) {
        let widest = 0;
        for (const v of values) widest = Math.max(widest, textWidth(v, font, fontPx));
        measured[p] = Math.ceil(widest) + tick + gap + 2;
      }
      const size = Math.max(...measured, tick + gap + 2 * fontPx);
      returned[p] = size;
      if (size !== shared) {
        shared = size;
        if (stacked && !alignFrame) alignFrame = raf(align);
      }
      return size;
    };
  function align(): void {
    alignFrame = 0;
    panels.forEach((panel, p) => {
      if (returned[p] !== shared && panel.u.status === 1) panel.u.redraw(false, true);
    });
  }

  const gridDash = theme.gridDotted ? { dash: [1 * uPlot.pxRatio, 3 * uPlot.pxRatio] } : {};
  const grid = { show: true, stroke: theme.grid, width: 1, ...gridDash };
  const ticks = { show: true, stroke: theme.ink, width: 1, size: tick };
  const border = { show: true, stroke: theme.ink, width: 1 };
  // True while this renderer itself changes the x scale, so the setScale hook does not echo it.
  let syncingView = false;
  const xSpace = (_u: uPlot, _i: number, min: number, max: number): number => {
    const widest = Math.max(...tickLabels([min, max, (min + max) / 2], plot.xUnit).map((t) => textWidth(t, font, fontPx)));
    return Math.ceil(widest + fontPx * 2);
  };

  const panels = plot.panels.map((panel, p) => {
    const bottom = p === plot.panels.length - 1;
    const element = document.createElement('div');
    element.className = 'ps-plot__panel';
    element.setAttribute('aria-hidden', 'true');
    // The canvas text size, for tests and for anyone checking the large-text modes.
    element.dataset.fontSize = String(fontPx);
    host.append(element);

    const xAxis: uPlot.Axis = bottom
      ? {
          scale: 'x',
          side: 2,
          label: plot.xLabel,
          labelFont: boldFont,
          labelSize,
          font,
          stroke: theme.ink,
          gap,
          size: xAxisSize,
          space: xSpace,
          ticks,
          grid,
          border,
          values: (_u, splits) => tickLabels(splits, plot.xUnit),
        }
      : // Upper panels share the bottom panel's x axis: grid and ticks only, no numbers.
        { scale: 'x', side: 2, font, stroke: theme.ink, gap: 0, size: tick + 1, space: xSpace, ticks, grid, border, values: (_u, splits) => splits.map(() => '') };
    const yAxis: uPlot.Axis = {
      scale: 'y',
      side: 3,
      label: PLOT_STRINGS.quantity[panel.unit],
      labelFont: boldFont,
      labelSize,
      font,
      stroke: theme.ink,
      gap,
      size: ySize(p),
      space: Math.round(fontPx * 2.4),
      ticks,
      grid,
      border,
      values: (_u, splits) => tickLabels(splits, panel.unit),
    };
    const colours = panel.series.map((i) => theme.series[plot.series[i]!.style.colour] ?? theme.ink);
    const options: uPlot.Options = {
      width,
      height: plotHeight + (bottom ? xAxisSize + labelSize : tick + 1),
      legend: { show: false },
      padding: [Math.round(fontPx * 0.8), Math.round(fontPx * 2), null, null],
      scales: { x: { time: false }, y: { auto: true } },
      series: [
        { label: plot.xLabel },
        ...panel.series.map((i, j) => {
          const s = plot.series[i]!;
          return {
            label: s.label,
            scale: 'y',
            stroke: colours[j] ?? theme.ink,
            width: lineWidth,
            dash: s.style.dash.map((d) => (d * lineWidth * uPlot.pxRatio) / 2),
            points: { show: false },
          };
        }),
      ],
      axes: [xAxis, yAxis],
      cursor: {
        x: true,
        y: false,
        drag: { x: true, y: false, setScale: true, dist: 5 },
        points: { size: Math.round(rem * 0.6), width: 2, fill: theme.background, stroke: (_u, i) => colours[i - 1] ?? theme.ink },
        sync: { key: syncKey, setSeries: false, scales: ['x', null] },
      },
      hooks: {
        ready: [(u) => place(u)],
        setSize: [(u) => place(u)],
        setCursor: [
          (u) => {
            // Programmatic moves pass fireHook = false, so this is the mouse (or a panel synced
            // to it). Remember the point, so the cursor goes back there when the mouse leaves.
            // While this renderer changes the view, uPlot re-reads its cursor at the old pixel
            // position, which is now a different point: that is not the mouse, so it is ignored
            // (setView puts the cursor back on the plot's point).
            const k = u.cursor.idx;
            if (!syncingView && k !== null && k !== undefined && k !== currentIndex) {
              currentIndex = k;
              callbacks.hover(k);
            }
          },
        ],
        setScale: [
          (u, key) => {
            if (key !== 'x' || syncingView) return;
            const min = u.scales.x?.min;
            const max = u.scales.x?.max;
            if (min === undefined || max === undefined || min === null || max === null) return;
            syncingView = true;
            for (const other of panels) {
              if (other.u !== u && other.u.status === 1 && (other.u.scales.x?.min !== min || other.u.scales.x?.max !== max)) {
                other.u.batch(() => other.u.setScale('x', { min, max }));
              }
            }
            syncingView = false;
            callbacks.view(min, max);
          },
        ],
        draw: [(u) => decorate(u, panel.series)],
      },
    };
    const data = [x, ...panel.series.map((i) => plot.series[i]!.values)] as uPlot.AlignedData;
    const u = new uPlot(options, data, element);
    if (initial.view) u.setScale('x', { min: initial.view[0], max: initial.view[1] });
    // uPlot hides its cursor when the mouse leaves; the plot's cursor stays put, so put it back
    // (not while a button is held: that is a drag to zoom, and moving the cursor would change it).
    u.over.addEventListener('mouseleave', (e) => {
      if (e.buttons === 0) for (const other of panels) place(other.u);
    });
    return { u, element };
  });

  /** Draw the cursor at the current point (CSS px within the plot area; uPlot computes the rest). */
  function place(u: uPlot): void {
    if (u.status !== 1) return; // the 'ready' hook places it once the scales exist
    const left = u.valToPos(x[currentIndex] ?? Number.NaN, 'x');
    if (!Number.isFinite(left)) return;
    const first = u.data[1]?.[currentIndex];
    const top = typeof first === 'number' && Number.isFinite(first) ? u.valToPos(first, 'y') : 0;
    u.setCursor({ left, top }, false);
  }

  function decorate(u: uPlot, seriesIndices: readonly number[]): void {
    const idxs = u.series[0]?.idxs;
    if (!idxs) return;
    const [i0, i1] = idxs;
    const ctx = u.ctx;
    const pr = uPlot.pxRatio;
    const { left, top, width: w, height: h } = u.bbox;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, w, h);
    ctx.clip();
    ctx.setLineDash([]);

    // Marker shapes along each line: at every point of a short sweep, otherwise every ~96 px.
    const cssWidth = w / pr;
    const everyPoint = (i1 - i0 + 1) * EVERY_POINT_GAP <= cssWidth;
    for (const si of seriesIndices) {
      const s = plot.series[si]!;
      const fill = theme.series[s.style.colour] ?? theme.ink;
      const at = (k: number): void => {
        const px = u.valToPos(x[k] ?? Number.NaN, 'x', true);
        const py = u.valToPos(s.values[k] ?? Number.NaN, 'y', true);
        if (Number.isFinite(px) && Number.isFinite(py)) drawMarker(ctx, s.style.marker, px, py, markerRadius * pr, fill, theme.background, pr);
      };
      if (everyPoint) {
        for (let k = i0; k <= i1; k++) at(k);
      } else {
        let last = -1;
        for (let cx = MARKER_STAGGER / 2 + MARKER_STAGGER * (si % 4); cx < cssWidth; cx += MARKER_SPACING) {
          const k = u.posToIdx(cx);
          if (k !== last) at(k);
          last = k;
        }
      }
    }

    // Direct labels near the right end of each line, in the text colour with a background halo,
    // above the line, or below it, or moved clear of labels already placed.
    const labelPx = Math.round(fontPx * pr);
    ctx.font = `600 ${labelPx}px ${theme.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const placed: Box[] = [];
    const k = Math.max(i0, i1 - Math.round((i1 - i0) * 0.04));
    for (const si of seriesIndices) {
      const s = plot.series[si]!;
      const px = u.valToPos(x[k] ?? Number.NaN, 'x', true);
      const py = u.valToPos(s.values[k] ?? Number.NaN, 'y', true);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      const tw = ctx.measureText(s.label).width;
      const th = labelPx * 1.25;
      const pad = 6 * pr;
      const lx = Math.max(left + 2 * pr, Math.min(px - pad - tw, left + w - tw - 2 * pr));
      const candidates = [py - pad - th, py + pad];
      for (let m = 1; m <= 3; m++) candidates.push(py - pad - th - m * (th + 2 * pr), py + pad + m * (th + 2 * pr));
      const fits = (ty: number): boolean => ty >= top && ty + th <= top + h;
      const box = (ty: number): Box => ({ left: lx, top: ty, right: lx + tw, bottom: ty + th });
      const ty =
        candidates.find((c) => fits(c) && !placed.some((b) => overlaps(b, box(c)))) ??
        candidates.find(fits) ??
        Math.max(top, Math.min(py - pad - th, top + h - th));
      placed.push(box(ty));
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4 * pr;
      ctx.strokeStyle = theme.background;
      ctx.strokeText(s.label, lx, ty);
      ctx.fillStyle = theme.ink;
      ctx.fillText(s.label, lx, ty);
    }
    ctx.restore();
  }

  return {
    setCursor(index: number): void {
      currentIndex = index;
      for (const panel of panels) place(panel.u);
    },
    setView(min: number, max: number): void {
      syncingView = true;
      for (const { u } of panels) {
        if (u.status === 1) u.batch(() => u.setScale('x', { min, max }));
        else u.setScale('x', { min, max });
      }
      for (const { u } of panels) place(u);
      syncingView = false;
      callbacks.view(min, max);
    },
    view(): [number, number] {
      const scale = panels[0]?.u.scales.x;
      const min = scale?.min ?? initial.view?.[0] ?? x[0] ?? 0;
      const max = scale?.max ?? initial.view?.[1] ?? x[x.length - 1] ?? 0;
      return [min, max];
    },
    indexAt(clientX: number): number | undefined {
      const u = panels[0]?.u;
      if (!u || u.status !== 1) return undefined;
      const rect = u.over.getBoundingClientRect();
      if (rect.width <= 0) return undefined;
      return u.posToIdx(Math.min(Math.max(clientX - rect.left, 0), rect.width));
    },
    resize(newWidth: number): void {
      for (const { u } of panels) if (Math.abs(u.width - newWidth) >= 1) u.setSize({ width: newWidth, height: u.height });
    },
    destroy(): void {
      if (alignFrame) cancelRaf(alignFrame);
      for (const { u, element } of panels) {
        u.destroy();
        element.remove();
      }
    },
  };
}
