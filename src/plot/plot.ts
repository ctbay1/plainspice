/**
 * createPlot(): an accessible plot of a .dc sweep or a .tran waveform (decision 0004). The app
 * loads this module with a dynamic import only when a result has vectors; summary.ts and
 * table.ts can be imported on their own (no uPlot, no CSS).
 *
 * What it puts inside the container, in this order:
 *   <figure> with a visible heading (the title) and a caption from summarisePlot();
 *   zoom buttons (Zoom in, Zoom out, Show all: the no-drag alternative, WCAG 2.5.7);
 *   the plot area, which is the keyboard cursor: an ARIA slider (APG pattern) whose value is
 *     spoken with units in words; the canvas inside it is hidden from screen readers;
 *   a readout that always shows the values at the cursor (instead of hover tooltips, 1.4.13);
 *   help text; a polite status region; a disclosure with the data table and a CSV download.
 *
 * Who announces what (so nothing is said twice): arrow keys change the slider's value, which a
 * screen reader reads because the slider has focus. Mouse and touch move the cursor at once on
 * screen; the slider value and, when the slider does not have focus, the status region follow
 * at most every 0.75 s. Zooming is announced in the status region.
 */
import './plot.css';
import { downloadFile } from '../export/export.ts';
import { formatSI, speakSI } from '../format/si.ts';
import { indexRange, nearestIndex, pointCount, preparePlot, type PreparedPlot } from './data.ts';
import { cursorDigits } from './format.ts';
import { markerPath, type SeriesStyle } from './palette.ts';
import { createRenderer, type Renderer, type RendererCallbacks } from './render-uplot.ts';
import { formatCount, PLOT_STRINGS } from './strings.ts';
import { summarisePlot } from './summary.ts';
import { csvFileName, csvText, tableRows } from './table.ts';
import { readTheme, type PlotTheme } from './theme.ts';
import type { PlotHandle, PlotOptions, PlotSpec } from './types.ts';

export type { PlotHandle, PlotOptions, PlotSeries, PlotSpec, PlotTable, PlotUnit } from './types.ts';
export { PLOT_STRINGS } from './strings.ts';
export { summarisePlot } from './summary.ts';
export { csvText, tableRows } from './table.ts';

/** Mouse and touch: the slider value and the status region follow the cursor at most this often. */
const SPEAK_EVERY_MS = 750;
/** A status message is removed after this long, so it does not linger for someone reading the page later. */
const CLEAR_STATUS_MS = 7000;
/** Zoom steps by this factor around the cursor. */
const ZOOM_FACTOR = 2;

const SVG_NS = 'http://www.w3.org/2000/svg';
let plotCount = 0;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The legend swatch in the readout: the line's colour, dash and marker, as on the canvas. */
function swatch(style: SeriesStyle, colour: string, background: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'ps-plot__swatch');
  svg.setAttribute('viewBox', '0 0 32 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const line = document.createElementNS(SVG_NS, 'line');
  for (const [k, v] of Object.entries({ x1: '0', y1: '8', x2: '32', y2: '8', stroke: colour, 'stroke-width': '2' })) line.setAttribute(k, v);
  if (style.dash.length) line.setAttribute('stroke-dasharray', style.dash.join(' '));
  const marker = document.createElementNS(SVG_NS, 'path');
  marker.setAttribute('d', markerPath(style.marker, 16, 8, 4));
  marker.setAttribute('fill', colour);
  marker.setAttribute('stroke', background);
  marker.setAttribute('stroke-width', '1.5');
  svg.append(line, marker);
  return svg;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

export function createPlot(container: HTMLElement, spec: PlotSpec, options: PlotOptions = {}): PlotHandle {
  const S = PLOT_STRINGS;
  const id = `ps-plot-${++plotCount}`;

  // ------------------------------------------------------------------ the figure
  const figure = element('figure', { class: 'ps-plot', 'aria-labelledby': `${id}-title`, 'aria-describedby': `${id}-summary` });
  const caption = element('figcaption', { class: 'ps-plot__caption' });
  const title = element(`h${options.headingLevel ?? 3}` as 'h3', { class: 'ps-plot__title', id: `${id}-title` });
  const summary = element('p', { class: 'ps-plot__summary', id: `${id}-summary` });
  caption.append(title, summary);

  const note = element('p', { class: 'ps-plot__note', hidden: '' });

  const zoomGroup = element('div', { class: 'ps-plot__zoom', role: 'group', 'aria-label': S.zoomGroup });
  const zoomInButton = element('button', { type: 'button', class: 'ps-plot__button' }, S.zoomIn);
  const zoomOutButton = element('button', { type: 'button', class: 'ps-plot__button' }, S.zoomOut);
  const showAllButton = element('button', { type: 'button', class: 'ps-plot__button' }, S.showAll);
  zoomGroup.append(zoomInButton, zoomOutButton, showAllButton);

  const area = element('div', {
    class: 'ps-plot__area',
    role: 'slider',
    tabindex: '0',
    'aria-orientation': 'horizontal',
    'aria-describedby': `${id}-help`,
  });

  const readout = element('div', { class: 'ps-plot__readout' });
  const help = element('p', { class: 'ps-plot__help', id: `${id}-help` }, S.help);
  const status = element('div', { class: 'ps-plot__vh', role: 'status' });

  const details = element('details', { class: 'ps-plot__data' });
  const toggle = element('summary', { class: 'ps-plot__toggle' }, S.tableToggle);
  // Named after the plot: two plots of the same size would otherwise have two regions with the same name.
  const tableWrap = element('div', { class: 'ps-plot__table-wrap', role: 'region', tabindex: '0' });
  const csvButton = element('button', { type: 'button', class: 'ps-plot__button ps-plot__csv' });
  details.append(toggle, tableWrap, csvButton);

  // A 1rem box: when its size changes, the text size changed, and the canvas text must follow.
  const remProbe = element('span', { class: 'ps-plot__rem', 'aria-hidden': 'true' });

  figure.append(caption, note, zoomGroup, area, readout, help, status, details, remProbe);
  container.append(figure);

  // ------------------------------------------------------------------ state
  let currentSpec = spec;
  let plot: PreparedPlot = preparePlot(spec);
  let index = Math.max(0, plot.n - 1); // start at the last point: the final values
  let view: [number, number] = fullRange();
  let theme: PlotTheme | undefined;
  let renderer: Renderer | undefined;
  let generation = 0;
  let destroyed = false;
  let speakTimer: ReturnType<typeof setTimeout> | undefined;
  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRem = 0;
  let readoutX: { shown: Text; spoken: Text } | undefined;
  let readoutValues: { shown: Text; spoken: Text }[] = [];

  function fullRange(): [number, number] {
    return [plot.x[0] ?? 0, plot.x[plot.n - 1] ?? 0];
  }
  function isFullView(): boolean {
    const [a, b] = fullRange();
    const eps = (b - a) * 1e-9;
    return view[0] <= a + eps && view[1] >= b - eps;
  }
  /** Zoom in stops when about five points are left in view around the cursor. */
  function minimumSpan(): number {
    const [a, b] = fullRange();
    const lo = plot.x[Math.max(0, index - 2)] ?? a;
    const hi = plot.x[Math.min(plot.n - 1, index + 2)] ?? b;
    return Math.max(hi - lo, (b - a) * 1e-9, 1e-15);
  }

  // ------------------------------------------------------------------ text at the cursor
  function xText(k: number): { shown: string; spoken: string } {
    const v = plot.x[k] ?? Number.NaN;
    const digits = cursorDigits(plot.x, k, plot.xUnit);
    return { shown: formatSI(v, plot.xUnit, digits), spoken: speakSI(v, plot.xUnit, digits) };
  }
  function spokenValue(k: number): string {
    return S.cursorValue(
      S.labelled(plot.xLabel, xText(k).spoken),
      plot.series.map((s) => S.labelled(s.label, speakSI(s.values[k] ?? Number.NaN, s.unit))),
    );
  }

  function buildReadout(): void {
    readout.replaceChildren();
    readoutValues = [];
    readout.append(element('span', { class: 'ps-plot__readout-lead' }, S.readoutLead));
    const item = (label: string, mark?: SVGSVGElement): { shown: Text; spoken: Text } => {
      const span = element('span', { class: 'ps-plot__readout-item' });
      const name = element('span', { class: 'ps-plot__readout-label' }, label);
      const shown = document.createTextNode('');
      const spoken = document.createTextNode('');
      const shownBox = element('span', { 'aria-hidden': 'true' });
      const spokenBox = element('span', { class: 'ps-plot__vh' });
      shownBox.append(shown);
      spokenBox.append(spoken);
      if (mark) span.append(mark);
      span.append(name, ' ', shownBox, spokenBox);
      readout.append(span);
      return { shown, spoken };
    };
    readoutX = item(plot.xLabel);
    readoutValues = plot.series.map((s) =>
      item(s.label, swatch(s.style, theme?.series[s.style.colour] ?? 'currentColor', theme?.background ?? 'transparent')),
    );
  }

  function renderReadout(): void {
    if (!readoutX) return;
    const xt = xText(index);
    readoutX.shown.data = xt.shown;
    readoutX.spoken.data = xt.spoken;
    plot.series.forEach((s, i) => {
      const v = s.values[index] ?? Number.NaN;
      const r = readoutValues[i];
      if (!r) return;
      r.shown.data = formatSI(v, s.unit);
      r.spoken.data = speakSI(v, s.unit);
    });
  }

  function updateSlider(): void {
    area.setAttribute('aria-valuenow', String(index));
    area.setAttribute('aria-valuetext', spokenValue(index));
  }

  function announce(text: string): void {
    // The same text twice would not be read again: make the second one differ invisibly.
    status.textContent = status.textContent === text ? `${text}\u200B` : text;
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      status.textContent = '';
    }, CLEAR_STATUS_MS);
  }

  function viewMessage(): string {
    const [a, b] = view;
    return isFullView()
      ? S.viewAll(plot.xLabel, speakSI(a, plot.xUnit), speakSI(b, plot.xUnit))
      : S.viewPart(plot.xLabel, speakSI(a, plot.xUnit), speakSI(b, plot.xUnit));
  }

  function setDisabled(button: HTMLButtonElement, disabled: boolean): void {
    // aria-disabled rather than disabled: the button keeps focus and stays findable by Tab.
    if (disabled) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
  }
  function updateZoomButtons(): void {
    const [a, b] = fullRange();
    const canZoom = plot.plottable && b > a;
    setDisabled(zoomInButton, !canZoom || view[1] - view[0] <= minimumSpan() * 1.000001);
    setDisabled(zoomOutButton, !canZoom || isFullView());
    setDisabled(showAllButton, !canZoom || isFullView());
  }

  // ------------------------------------------------------------------ moving the cursor
  type Source = 'key' | 'hover' | 'touch' | 'quiet';

  function moveCursor(target: number, source: Source): void {
    if (!plot.plottable) return;
    index = clamp(Math.round(target), 0, plot.n - 1);
    if (source === 'key') keepInView(index);
    if (source !== 'hover') renderer?.setCursor(index); // uPlot already drew the mouse's cursor
    renderReadout();
    if (source === 'key' || source === 'quiet') {
      updateSlider();
    } else if (!speakTimer) {
      speakTimer = setTimeout(() => {
        speakTimer = undefined;
        updateSlider();
        if (document.activeElement !== area) announce(spokenValue(index));
      }, SPEAK_EVERY_MS);
    }
  }

  /** When the keyboard takes the cursor out of a zoomed view, the view follows it. */
  function keepInView(k: number): void {
    const xk = plot.x[k] ?? Number.NaN;
    const [a, b] = view;
    if (!(xk < a || xk > b)) return;
    const span = b - a;
    const [lo, hi] = fullRange();
    const start = clamp(xk < a ? xk - span * 0.1 : xk - span * 0.9, lo, hi - span);
    setView(start, start + span, false);
  }

  function setView(min: number, max: number, speak: boolean): void {
    view = [min, max];
    renderer?.setView(min, max);
    updateZoomButtons();
    if (speak) announce(viewMessage());
  }

  function zoom(factor: number): void {
    const [lo, hi] = fullRange();
    if (!plot.plottable || !(hi > lo)) return;
    const [a, b] = view;
    const centre = clamp(plot.x[index] ?? (a + b) / 2, a, b);
    const span = clamp((b - a) / factor, minimumSpan(), hi - lo);
    const where = b > a ? (centre - a) / (b - a) : 0.5; // keep the cursor where it is on screen
    const start = clamp(centre - where * span, lo, hi - span);
    setView(start, start + span, true);
  }

  function showAll(): void {
    const [lo, hi] = fullRange();
    if (!plot.plottable || !(hi > lo)) return;
    setView(lo, hi, true);
  }

  // ------------------------------------------------------------------ building
  function callbacks(forGeneration: number): RendererCallbacks {
    return {
      hover(k) {
        if (forGeneration === generation) moveCursor(k, 'hover');
      },
      view(min, max) {
        // Every view change ends here, including the mouse's drag-to-zoom and double-click.
        if (forGeneration !== generation) return;
        view = [min, max];
        const [i0, i1] = indexRange(plot.x, min, max);
        if (index < i0 || index > i1) moveCursor(clamp(index, i0, i1), 'quiet');
        updateZoomButtons();
      },
    };
  }

  function renderTable(): void {
    const table = tableRows(currentSpec);
    const n = table.rows.length;
    const total = pointCount(currentSpec);
    const tableEl = element('table');
    const cap = element('caption', {}, S.tableCaption(formatCount(n), formatCount(total), n === total));
    const head = element('thead');
    const headRow = element('tr');
    for (const h of table.header) headRow.append(element('th', { scope: 'col' }, h));
    head.append(headRow);
    const body = element('tbody');
    for (const row of table.rows) {
      const tr = element('tr');
      row.forEach((cell, c) => tr.append(c === 0 ? element('th', { scope: 'row' }, cell) : element('td', {}, cell)));
      body.append(tr);
    }
    tableEl.append(cap, head, body);
    tableWrap.replaceChildren(tableEl);
    tableWrap.setAttribute('aria-label', S.tableRegion(currentSpec.title));
    csvButton.textContent = S.downloadCsv(formatCount(total));
  }

  function showPlottable(plottable: boolean): void {
    for (const part of [zoomGroup, area, readout, help]) part.hidden = !plottable;
    note.hidden = plottable;
    note.textContent = plottable ? '' : plot.n === 0 ? S.noPoints : S.notMonotonic(plot.xLabel);
  }

  function build(): void {
    generation += 1;
    if (speakTimer) clearTimeout(speakTimer);
    speakTimer = undefined;
    renderer?.destroy();
    renderer = undefined;
    showPlottable(plot.plottable);
    area.setAttribute('aria-label', S.cursorName(plot.xLabel));
    area.setAttribute('aria-valuemin', '0');
    area.setAttribute('aria-valuemax', String(Math.max(0, plot.n - 1)));
    if (!plot.plottable) {
      for (const a of ['aria-valuenow', 'aria-valuetext']) area.removeAttribute(a);
      readout.replaceChildren();
      readoutX = undefined;
      updateZoomButtons();
      return;
    }
    theme = readTheme(figure);
    lastRem = remProbe.offsetHeight || lastRem;
    const width = area.clientWidth || container.clientWidth || 600;
    const saved: [number, number] | undefined = isFullView() ? undefined : view;
    renderer = createRenderer(area, plot, theme, width, callbacks(generation), { index, view: saved });
    buildReadout();
    renderReadout();
    updateSlider();
    updateZoomButtons();
  }

  function scheduleRebuild(): void {
    if (destroyed || rebuildTimer) return;
    rebuildTimer = setTimeout(() => {
      rebuildTimer = undefined;
      if (!destroyed) build();
    }, 50);
  }

  // ------------------------------------------------------------------ events
  area.addEventListener('keydown', (e) => {
    // Ctrl/Cmd with + − 0 zooms the browser page, and Alt combinations belong to the browser.
    if (e.ctrlKey || e.metaKey || e.altKey || !plot.plottable) return;
    const [i0, i1] = indexRange(plot.x, view[0], view[1]);
    const inView = i1 - i0 + 1;
    let target: number | undefined;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        target = index + (e.shiftKey ? Math.max(1, Math.round(inView / 100)) : 1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        target = index - (e.shiftKey ? Math.max(1, Math.round(inView / 100)) : 1);
        break;
      case 'PageUp':
        target = index + Math.max(1, Math.round(inView / 10));
        break;
      case 'PageDown':
        target = index - Math.max(1, Math.round(inView / 10));
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = plot.n - 1;
        break;
      case '+':
      case '=':
        zoom(ZOOM_FACTOR);
        break;
      case '-':
      case '_':
      case '−':
        zoom(1 / ZOOM_FACTOR);
        break;
      case '0':
        showAll();
        break;
      default:
        return;
    }
    e.preventDefault();
    if (target !== undefined) moveCursor(target, 'key');
  });

  // Touch: one finger sliding along the plot moves the cursor. touch-action: pan-y pinch-zoom
  // (plot.css) leaves vertical scrolling and pinch-zoom of the page to the browser.
  const onTouch = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || !renderer) return;
    const k = renderer.indexAt(e.clientX);
    if (k !== undefined && k !== index) moveCursor(k, 'touch');
  };
  area.addEventListener('pointerdown', onTouch);
  area.addEventListener('pointermove', onTouch);

  const onButton = (button: HTMLButtonElement, action: () => void) =>
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') !== 'true') action();
    });
  onButton(zoomInButton, () => zoom(ZOOM_FACTOR));
  onButton(zoomOutButton, () => zoom(1 / ZOOM_FACTOR));
  onButton(showAllButton, showAll);
  csvButton.addEventListener('click', () => {
    downloadFile({ filename: csvFileName(currentSpec.title), text: csvText(currentSpec), mime: 'text/csv;charset=utf-8' });
  });

  const observers: { disconnect(): void }[] = [];
  if (typeof ResizeObserver === 'function') {
    const widthObserver = new ResizeObserver(() => {
      if (renderer && area.clientWidth > 0) renderer.resize(area.clientWidth);
    });
    widthObserver.observe(area);
    const remObserver = new ResizeObserver(() => {
      const rem = remProbe.offsetHeight;
      if (rem > 0 && rem !== lastRem) {
        lastRem = rem;
        scheduleRebuild();
      }
    });
    remObserver.observe(remProbe);
    observers.push(widthObserver, remObserver);
  }
  if (typeof MutationObserver === 'function') {
    const attributes = new MutationObserver(scheduleRebuild);
    attributes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-contrast', 'data-theme', 'data-text-size'] });
    observers.push(attributes);
  }
  const queries =
    typeof matchMedia === 'function'
      ? ['(forced-colors: active)', '(prefers-contrast: more)', '(prefers-color-scheme: dark)'].map((q) => matchMedia(q))
      : [];
  for (const q of queries) q.addEventListener?.('change', scheduleRebuild);
  // uPlot announces a change of device pixel ratio (browser zoom); dash patterns follow it.
  window.addEventListener('dppxchange', scheduleRebuild);

  // ------------------------------------------------------------------ start
  title.textContent = spec.title;
  summary.textContent = summarisePlot(spec);
  renderTable();
  build();

  return {
    update(next: PlotSpec): void {
      if (destroyed) return;
      const cursorX = plot.x[index];
      const oldView: [number, number] | undefined = isFullView() ? undefined : view;
      currentSpec = next;
      plot = preparePlot(next);
      title.textContent = next.title;
      summary.textContent = summarisePlot(next);
      renderTable();
      const [lo, hi] = fullRange();
      index = cursorX !== undefined && plot.n > 0 ? nearestIndex(plot.x, cursorX) : Math.max(0, plot.n - 1);
      view = oldView && oldView[0] >= lo && oldView[1] <= hi ? oldView : [lo, hi];
      build();
    },
    refreshTheme(): void {
      if (!destroyed) build();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      for (const o of observers) o.disconnect();
      for (const q of queries) q.removeEventListener?.('change', scheduleRebuild);
      window.removeEventListener('dppxchange', scheduleRebuild);
      for (const t of [speakTimer, clearTimer, rebuildTimer]) if (t) clearTimeout(t);
      renderer?.destroy();
      renderer = undefined;
      figure.remove();
    },
  };
}
