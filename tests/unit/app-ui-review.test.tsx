// @vitest-environment jsdom
/**
 * The page after the final reviews of milestone 2 (the ui lane), in jsdom with the real ngspice as
 * in app-smoke.test.tsx: Ctrl+K's field keeping the focus (a11y A1, A3). Focus order and axe in a real browser:
 * tests/e2e/ui-review.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { App } from '../../src/app/App.tsx';
import type { Engine } from '../../src/app/engine.ts';
import { START_HERE_ID } from '../../src/app/examples.ts';
import type { StartupDecision } from '../../src/app/startup.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { t } from '../../src/i18n/index.ts';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const START = read('examples/start-here.cir');

let ngspice: Promise<NgspiceEngine>;

beforeAll(() => {
  // As in app-smoke.test.tsx: jsdom has no layout, so the editor and the drawing get a size and a ResizeObserver with nothing to say.
  const empty = (): DOMRectList => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  const rect = (): DOMRect => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = empty;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = rect;
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  ngspice = WebAssembly.compile(readFileSync(resolve(root, 'engine/dist/ngspice.wasm'))).then((m) => NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, m));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  history.replaceState(null, '', '/');
});

function realEngine(): Engine {
  return {
    warmUp: async () => {
      await ngspice;
      return 1;
    },
    run: async (netlist) => (await ngspice).run(netlist),
    cancel: () => undefined,
  };
}

const firstVisit = (): StartupDecision => ({ source: 'example', netlist: START, exampleId: START_HERE_ID });
const statusLine = (): string => document.querySelector('.status')?.textContent ?? '';
const openPalette = (): HTMLElement => {
  fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
  return screen.getByRole('dialog', { name: t('paletteTitle') });
};

async function solved(): Promise<void> {
  await waitFor(() => expect(statusLine()).toMatch(/Finished in \d+ ms/), { timeout: 15000 });
}

describe('Ctrl+K after the final reviews', () => {
  it('keeps the focus in its field: Tab stays there, a click on the list does not take it, and Escape closes it from anywhere', async () => {
    render(<App startup={firstVisit()} engine={realEngine()} serviceWorker={false} />);
    await solved();
    let palette = openPalette();
    const input = within(palette).getByRole('combobox');
    expect(document.activeElement).toBe(input);
    // The list is never a Tab stop, and the page behind (the skip link too) is inert.
    expect(within(palette).getByRole('listbox').getAttribute('tabindex')).toBe('-1');
    expect(screen.getByText(t('skipToDrawing')).closest('[inert]')).not.toBeNull();
    // Tab and Shift+Tab: the field is the dialog's one stop (fireEvent returns false when the default is prevented).
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false);
    expect(fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(input);
    // A press on a group's name keeps the focus in the field; the arrows still choose.
    expect(fireEvent.mouseDown(within(palette).getAllByRole('group')[1]!.querySelector('.palette__group')!)).toBe(false);
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(within(palette).getByRole('option', { selected: true }).textContent).toContain(t('paletteOpenPanel', { panel: t('panelNetlist') }));
    // The focus on the page itself (as a click outside the field once left it): Escape still closes.
    act(() => input.blur());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: t('paletteTitle') })).toBeNull();
    expect(screen.getByText(t('skipToDrawing')).closest('[inert]')).toBeNull();
    // Groups are <div role=group> in a <div role=listbox>, their options in a list of their own (a11y A3).
    palette = openPalette();
    const group = within(palette).getAllByRole('group')[0]!;
    expect(group.tagName).toBe('DIV');
    expect(group.parentElement?.getAttribute('role')).toBe('listbox');
    expect(group.parentElement?.tagName).toBe('DIV');
    expect(within(group).getAllByRole('option')[0]!.tagName).toBe('LI');
    fireEvent.keyDown(within(palette).getByRole('combobox'), { key: 'Escape' });
  }, 30000);
});
