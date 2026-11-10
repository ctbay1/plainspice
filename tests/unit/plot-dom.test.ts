// @vitest-environment jsdom
/**
 * createPlot (src/plot/plot.ts) in jsdom: the figure, heading and caption, the keyboard cursor
 * (an ARIA slider), the zoom buttons and keys, the readout, the data table and the CSV download,
 * update() and destroy(). jsdom has no canvas and no matchMedia, which uPlot needs, so both are
 * stubbed before the module is loaded (with a dynamic import, as the app loads it). Drawing,
 * axe, forced colours, text size and touch are checked in a real browser (see the module's
 * report); here the point is that the accessible structure is right and nothing throws.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PlotHandle, PlotSpec, PlotUnit } from '../../src/plot/types.ts';

type CreatePlot = typeof import('../../src/plot/plot.ts').createPlot;
let createPlot: CreatePlot;
let summarisePlot: typeof import('../../src/plot/plot.ts').summarisePlot;

/** A 2D context that accepts every call (uPlot draws; nothing is checked here). */
function fakeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { canvas };
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return (text: string) => ({ width: text.length * 7 });
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

beforeAll(async () => {
  window.matchMedia = ((media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement) {
    return fakeContext(this);
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  (globalThis as { Path2D?: unknown }).Path2D = class {
    moveTo(): void {}
    lineTo(): void {}
    rect(): void {}
    arc(): void {}
    closePath(): void {}
    bezierCurveTo(): void {}
    addPath(): void {}
  };
  ({ createPlot, summarisePlot } = await import('../../src/plot/plot.ts'));
});

interface NativeVector {
  name: string;
  type: string;
  values: number[];
}
const native = (id: string): NativeVector[] =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, `../golden/native/ngspice-47/${id}.json`), 'utf8')).plots[0].vectors;
const unitOf = (v: NativeVector): PlotUnit => (v.name === 'time' ? 's' : v.type === 'current' ? 'A' : v.type === 'voltage' ? 'V' : '');
const fromNative = (id: string, kind: 'dc' | 'tran', xLabel: string, title: string): PlotSpec => {
  const [x, ...rest] = native(id);
  return {
    title,
    kind,
    x: { label: xLabel, unit: unitOf(x!), values: Float64Array.from(x!.values) },
    series: rest.map((v) => ({ label: v.name, unit: unitOf(v), values: Float64Array.from(v.values) })),
  };
};
const T1 = (): PlotSpec => fromNative('t1-tran-rc-charge', 'tran', 'time', 'Transient analysis: v(in), v(out) and i(v1) against time');
const D1 = (): PlotSpec => fromNative('d1-dc-divider-sweep', 'dc', 'V1', 'DC sweep: v(in), v(out) and i(v1) against V1');
const voltagesOnly = (spec: PlotSpec): PlotSpec => ({ ...spec, series: spec.series.filter((s) => s.unit === 'V') });

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0)); // uPlot draws in a microtask
const plainText = (s: string | null | undefined): string => (s ?? '').replace(/[\u00A0\u200B]/g, (c) => (c === '\u200B' ? '' : ' '));

let handles: PlotHandle[] = [];
function mount(spec: PlotSpec, options?: Parameters<CreatePlot>[2]): { container: HTMLElement; handle: PlotHandle } {
  const container = document.createElement('div');
  document.body.append(container);
  const handle = createPlot(container, spec, options);
  handles.push(handle);
  return { container, handle };
}
afterEach(() => {
  for (const h of handles) h.destroy();
  handles = [];
  document.body.replaceChildren();
});

const key = (target: Element, k: string, extra: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });
  target.dispatchEvent(event);
  return event;
};

describe('createPlot builds an accessible figure', () => {
  it('a figure named by its visible heading and described by the generated summary', async () => {
    const spec = T1();
    const { container } = mount(spec);
    await flush();
    const figure = container.querySelector('figure.ps-plot')!;
    expect(figure).not.toBeNull();
    const heading = figure.querySelector('figcaption h3')!;
    expect(heading.textContent).toBe(spec.title);
    expect(figure.getAttribute('aria-labelledby')).toBe(heading.id);
    const summary = document.getElementById(figure.getAttribute('aria-describedby')!)!;
    expect(summary.textContent).toBe(summarisePlot(spec));
    expect(plainText(summary.textContent)).toContain('v(out) rises from 0 V to 4.966 V over 5 ms; final value 4.966 V.');
  });

  it('the heading level can be chosen', () => {
    const { container } = mount(D1(), { headingLevel: 2 });
    expect(container.querySelector('figcaption h2')?.textContent).toBe(D1().title);
  });

  it('volts and amps: two stacked panels, each canvas hidden from screen readers', async () => {
    const { container } = mount(T1());
    await flush();
    const panels = container.querySelectorAll('.ps-plot__area > .ps-plot__panel');
    expect(panels).toHaveLength(2);
    for (const p of panels) {
      expect(p.getAttribute('aria-hidden')).toBe('true');
      expect(p.querySelector('canvas')).not.toBeNull();
    }
  });

  it('one unit: one panel', async () => {
    const { container } = mount(voltagesOnly(D1()));
    await flush();
    expect(container.querySelectorAll('.ps-plot__panel')).toHaveLength(1);
  });

  it('the cursor is an ARIA slider that starts at the last point and speaks units in words', async () => {
    const { container } = mount(T1());
    await flush();
    const slider = container.querySelector('[role="slider"]')!;
    expect(slider.getAttribute('tabindex')).toBe('0');
    expect(slider.getAttribute('aria-label')).toBe('Cursor, time');
    expect(slider.getAttribute('aria-valuemin')).toBe('0');
    expect(slider.getAttribute('aria-valuemax')).toBe('519');
    expect(slider.getAttribute('aria-valuenow')).toBe('519');
    expect(slider.getAttribute('aria-valuetext')).toBe('time 5 milliseconds: v(in) 5 volts, v(out) 4.966 volts, i(v1) minus 33.71 microamps');
    const help = document.getElementById(slider.getAttribute('aria-describedby')!)!;
    expect(help.textContent).toMatch(/arrow keys/);
  });

  it('zoom buttons in a labelled group; zooming out is unavailable while everything shows', () => {
    const { container } = mount(T1());
    const group = container.querySelector('[role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe('Zoom');
    const names = [...group.querySelectorAll('button')].map((b) => b.textContent);
    expect(names).toEqual(['Zoom in', 'Zoom out', 'Show all']);
    const [zoomIn, zoomOut, showAll] = group.querySelectorAll('button');
    expect(zoomIn!.getAttribute('aria-disabled')).toBeNull();
    expect(zoomOut!.getAttribute('aria-disabled')).toBe('true');
    expect(showAll!.getAttribute('aria-disabled')).toBe('true');
    for (const b of group.querySelectorAll('button')) expect(b.getAttribute('type')).toBe('button');
  });

  it('a readout that always shows the values at the cursor, with a legend swatch per series', async () => {
    const { container } = mount(T1());
    await flush();
    const readout = container.querySelector('.ps-plot__readout')!;
    expect(readout.getAttribute('aria-live')).toBeNull(); // not live itself: the status region speaks for it
    const shown = [...readout.querySelectorAll('[aria-hidden="true"]:not(svg)')].map((e) => plainText(e.textContent));
    expect(shown).toEqual(['5 ms', '5 V', '4.966 V', '−33.71 µA']);
    expect(readout.textContent).toContain('At the cursor:');
    expect(readout.textContent).toContain('4.966 volts'); // the spoken twin, for reading the page
    const swatches = readout.querySelectorAll('svg.ps-plot__swatch');
    expect(swatches).toHaveLength(3);
    for (const s of swatches) expect(s.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });
});

describe('keyboard', () => {
  it('arrow keys move one point, Page Up/Down 10 % of the view, Home/End to the ends', async () => {
    const { container } = mount(T1());
    await flush();
    const slider = container.querySelector('[role="slider"]')!;
    const now = (): number => Number(slider.getAttribute('aria-valuenow'));
    expect(key(slider, 'Home').defaultPrevented).toBe(true);
    expect(now()).toBe(0);
    expect(slider.getAttribute('aria-valuetext')).toBe('time 0 seconds: v(in) 0 volts, v(out) 0 volts, i(v1) 0 amps');
    key(slider, 'ArrowRight');
    expect(now()).toBe(1);
    expect(slider.getAttribute('aria-valuetext')).toMatch(/^time 10 nanoseconds: v\(in\) 50 millivolts/);
    key(slider, 'ArrowUp');
    expect(now()).toBe(2);
    key(slider, 'ArrowLeft');
    key(slider, 'ArrowDown');
    key(slider, 'ArrowDown'); // stays at the first point
    expect(now()).toBe(0);
    key(slider, 'PageUp');
    expect(now()).toBe(52); // 10 % of 520 points
    key(slider, 'PageDown');
    expect(now()).toBe(0);
    key(slider, 'ArrowRight', { shiftKey: true });
    expect(now()).toBe(5); // 1 % of the view
    key(slider, 'End');
    expect(now()).toBe(519);
    key(slider, 'ArrowRight');
    expect(now()).toBe(519);
  });

  it('the readout follows the cursor', async () => {
    const { container } = mount(D1());
    await flush();
    const slider = container.querySelector('[role="slider"]')!;
    key(slider, 'Home');
    key(slider, 'ArrowRight');
    const shown = [...container.querySelectorAll('.ps-plot__readout [aria-hidden="true"]:not(svg)')].map((e) => plainText(e.textContent));
    expect(shown).toEqual(['1 V', '1 V', '666.7 mV', '−333.3 µA']);
  });

  it('leaves browser shortcuts alone (Ctrl/Cmd with + − 0 zooms the page) and ignores other keys', () => {
    const { container } = mount(T1());
    const slider = container.querySelector('[role="slider"]')!;
    expect(key(slider, '+', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key(slider, '0', { metaKey: true }).defaultPrevented).toBe(false);
    expect(key(slider, 'ArrowLeft', { altKey: true }).defaultPrevented).toBe(false);
    expect(key(slider, 'a').defaultPrevented).toBe(false);
    expect(key(slider, 'Tab').defaultPrevented).toBe(false);
  });

  it('+ and − zoom around the cursor, 0 shows all, and each zoom is announced in words', async () => {
    const { container } = mount(T1());
    await flush();
    const slider = container.querySelector('[role="slider"]')!;
    const status = container.querySelector('[role="status"]')!;
    const [zoomIn, zoomOut, showAll] = container.querySelectorAll<HTMLButtonElement>('.ps-plot__zoom button');
    key(slider, '+');
    expect(plainText(status.textContent)).toBe('Showing time from 2.5 milliseconds to 5 milliseconds.');
    expect(zoomOut!.getAttribute('aria-disabled')).toBeNull();
    expect(showAll!.getAttribute('aria-disabled')).toBeNull();
    key(slider, '=');
    expect(plainText(status.textContent)).toBe('Showing time from 3.75 milliseconds to 5 milliseconds.');
    key(slider, '-');
    expect(plainText(status.textContent)).toBe('Showing time from 2.5 milliseconds to 5 milliseconds.');
    key(slider, '0');
    expect(plainText(status.textContent)).toBe('Showing all of time, from 0 seconds to 5 milliseconds.');
    expect(zoomOut!.getAttribute('aria-disabled')).toBe('true');
    zoomIn!.click();
    expect(plainText(status.textContent)).toBe('Showing time from 2.5 milliseconds to 5 milliseconds.');
    showAll!.click();
    expect(plainText(status.textContent)).toBe('Showing all of time, from 0 seconds to 5 milliseconds.');
  });

  it('zoom in stops when about five points are left, and the button says so', async () => {
    const { container } = mount(D1());
    await flush();
    const slider = container.querySelector('[role="slider"]')!;
    const zoomIn = container.querySelector<HTMLButtonElement>('.ps-plot__zoom button')!;
    key(slider, 'Home');
    for (let i = 0; i < 10; i++) key(slider, '+');
    expect(zoomIn.getAttribute('aria-disabled')).toBe('true');
    const before = container.querySelector('[role="status"]')!.textContent;
    zoomIn.click(); // unavailable: nothing happens
    expect(container.querySelector('[role="status"]')!.textContent).toBe(before);
  });

  it('when the keyboard leaves a zoomed view, the view follows the cursor', async () => {
    const { container } = mount(T1());
    await flush();
    const slider = container.querySelector('[role="slider"]')!;
    const status = container.querySelector('[role="status"]')!;
    key(slider, '+'); // 2.5 ms to 5 ms, cursor at the end
    key(slider, '+'); // 3.75 ms to 5 ms
    key(slider, 'Home'); // to 0 s: the view moves to start at 0 s ...
    expect(slider.getAttribute('aria-valuenow')).toBe('0'); // ... and the cursor stays where the key put it
    key(slider, 'ArrowRight');
    expect(slider.getAttribute('aria-valuenow')).toBe('1');
    key(slider, 'End');
    expect(slider.getAttribute('aria-valuenow')).toBe('519');
    key(slider, 'Home');
    key(slider, '-'); // zooming out again shows where the view is now
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
    expect(plainText(status.textContent)).toBe('Showing time from 0 seconds to 2.5 milliseconds.');
  });
});

describe('data table and CSV', () => {
  it('a disclosure with a captioned table (row and column headers) in a scrollable, labelled region', () => {
    const { container } = mount(D1());
    const details = container.querySelector('details')!;
    expect(details.querySelector('summary')!.textContent).toBe('Data table and CSV file');
    const region = details.querySelector('[role="region"]')!;
    expect(region.getAttribute('tabindex')).toBe('0');
    // Named after the plot, so two plots never have two regions with the same name.
    expect(region.getAttribute('aria-label')).toBe(`Data table: ${D1().title}`);
    expect(region.querySelector('table > caption')!.textContent).toBe('All 13 points.');
    expect([...details.querySelectorAll('thead th')].map((th) => [th.getAttribute('scope'), th.textContent])).toEqual([
      ['col', 'V1 (V)'],
      ['col', 'v(in) (V)'],
      ['col', 'v(out) (V)'],
      ['col', 'i(v1) (A)'],
    ]);
    const rows = details.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(13);
    expect(rows[1]!.querySelector('th')!.getAttribute('scope')).toBe('row');
    expect(plainText(rows[1]!.textContent)).toBe('1 V1 V666.7 mV−333.3 µA');
  });

  it('a long transient shows 200 evenly spaced rows and says the CSV file has every point', () => {
    const { container } = mount(T1());
    expect(container.querySelectorAll('tbody tr')).toHaveLength(200);
    expect(container.querySelector('caption')!.textContent).toBe('200 of the 520 points, evenly spaced. The CSV file has every point.');
  });

  it('Download CSV saves every point', async () => {
    const created: Blob[] = [];
    const urlApi = URL as unknown as { createObjectURL: (b: Blob) => string; revokeObjectURL: (u: string) => void };
    const restore = { create: urlApi.createObjectURL, revoke: urlApi.revokeObjectURL };
    urlApi.createObjectURL = (b: Blob) => {
      created.push(b);
      return 'blob:plot';
    };
    urlApi.revokeObjectURL = () => undefined;
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      const { container } = mount(T1());
      const button = container.querySelector<HTMLButtonElement>('.ps-plot__csv')!;
      expect(button.textContent).toBe('Download CSV (all 520 points)');
      button.click();
      expect(clicks).toHaveBeenCalledTimes(1);
      expect(created).toHaveLength(1);
      const text = await created[0]!.text();
      const lines = text.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
      expect(lines[0]).toBe('time (s),v(in) (V),v(out) (V),i(v1) (A)');
      expect(lines).toHaveLength(521);
      expect(created[0]!.type).toBe('text/csv;charset=utf-8');
    } finally {
      clicks.mockRestore();
      urlApi.createObjectURL = restore.create;
      urlApi.revokeObjectURL = restore.revoke;
    }
  });
});

describe('update, refreshTheme, destroy', () => {
  it('update() shows a new result in the same figure', async () => {
    const { container, handle } = mount(T1());
    await flush();
    const figure = container.querySelector('figure')!;
    handle.update(voltagesOnly(D1()));
    await flush();
    expect(container.querySelector('figure')).toBe(figure);
    expect(container.querySelector('figcaption h3')!.textContent).toBe(D1().title);
    expect(container.querySelectorAll('.ps-plot__panel')).toHaveLength(1);
    const slider = container.querySelector('[role="slider"]')!;
    expect(slider.getAttribute('aria-label')).toBe('Cursor, V1');
    expect(slider.getAttribute('aria-valuemax')).toBe('12');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(13);
    expect(container.querySelector('.ps-plot__csv')!.textContent).toBe('Download CSV (all 13 points)');
  });

  it('a sweep inside a sweep cannot be drawn yet: it says why and still shows the table', async () => {
    const nested: PlotSpec = {
      title: 'Two sources swept',
      kind: 'dc',
      x: { label: 'V1', unit: 'V', values: [0, 1, 2, 0, 1, 2] },
      series: [{ label: 'v(out)', unit: 'V', values: [0, 0.667, 1.333, 0.333, 1, 1.667] }],
    };
    const { container } = mount(nested);
    await flush();
    const note = container.querySelector('.ps-plot__note')!;
    expect(note.hasAttribute('hidden')).toBe(false);
    expect(note.textContent).toMatch(/^This result cannot be drawn yet: V1 goes back to its start/);
    expect((container.querySelector('[role="slider"]') as HTMLElement).hidden).toBe(true);
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(6);
  });

  it('refreshTheme() redraws without losing the cursor', async () => {
    const { container, handle } = mount(T1());
    await flush();
    const slider = container.querySelector('[role="slider"]')!;
    key(slider, 'Home');
    handle.refreshTheme();
    await flush();
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
    expect(container.querySelectorAll('.ps-plot__panel')).toHaveLength(2);
  });

  it('destroy() removes the figure; calling it twice or updating afterwards is harmless', () => {
    const { container, handle } = mount(T1());
    handle.destroy();
    expect(container.children).toHaveLength(0);
    expect(() => handle.destroy()).not.toThrow();
    expect(() => handle.update(D1())).not.toThrow();
    expect(container.children).toHaveLength(0);
  });

  it('a sweep run downwards is drawn left to right: the cursor starts at the highest V1', async () => {
    const down: PlotSpec = {
      title: 'Down',
      kind: 'dc',
      x: { label: 'V1', unit: 'V', values: [12, 9, 6, 3, 0] },
      series: [{ label: 'v(out)', unit: 'V', values: [8, 6, 4, 2, 0] }],
    };
    const { container } = mount(down);
    await flush();
    const slider = container.querySelector('[role="slider"]')!;
    expect(slider.getAttribute('aria-valuetext')).toBe('V1 12 volts: v(out) 8 volts');
    key(slider, 'Home');
    expect(slider.getAttribute('aria-valuetext')).toBe('V1 0 volts: v(out) 0 volts');
    // The table keeps ngspice's order.
    expect(plainText(container.querySelector('tbody tr')!.textContent)).toBe('12 V8 V');
  });
});
