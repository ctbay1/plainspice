// @vitest-environment jsdom
/**
 * The page after the final reviews of milestone 2 (the ui lane), in jsdom with the real ngspice as
 * in app-smoke.test.tsx: Ctrl+K's real list found by the words it shows (words W4, W5, W12) and its
 * field keeping the focus (a11y A1, A3); a fix on a video's mistake example leaving no drawing
 * warning, and said with the tab's count (kept F1). Focus order and axe in a real browser:
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
import { toolPhrase } from '../../src/app/tools.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { t } from '../../src/i18n/index.ts';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const START = read('examples/start-here.cir');
const MISTAKE_1 = read('examples/sp01/sp01-4-no-ground.cir');

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
const saved = (netlist: string): StartupDecision => ({ source: 'saved', netlist });
const polite = (): string => screen.getByTestId('live-polite').textContent ?? '';
const statusLine = (): string => document.querySelector('.status')?.textContent ?? '';
const tab = (name: string): HTMLElement => within(screen.getByRole('navigation', { name: 'Panels' })).getByRole('button', { name: new RegExp(`^${name}`) });
const openPalette = (): HTMLElement => {
  fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
  return screen.getByRole('dialog', { name: t('paletteTitle') });
};
const labels = (palette: HTMLElement): string[] => [...palette.querySelectorAll('.palette__label')].map((l) => l.textContent ?? '');

async function solved(): Promise<void> {
  await waitFor(() => expect(statusLine()).toMatch(/Finished in \d+ ms/), { timeout: 15000 });
}

describe('Ctrl+K after the final reviews', () => {
  it('finds every command of the real list by its own name, as shown; “dependent” finds the dependent sources; accents or not', async () => {
    render(<App startup={firstVisit()} engine={realEngine()} serviceWorker={false} />);
    await solved();
    // A part selected, so the list has the selection's commands too.
    act(() => screen.getByRole('button', { name: /^R2, / }).focus());
    const palette = openPalette();
    const input = within(palette).getByRole('combobox');
    const all = labels(palette);
    expect(all.length).toBeGreaterThan(60);
    for (const label of all) {
      fireEvent.change(input, { target: { value: label } });
      expect(labels(palette), label).toContain(label);
    }
    // Hyphens typed as shown (words W5).
    fireEvent.change(input, { target: { value: 'current-controlled current' } });
    expect(labels(palette)[0]).toBe(t('palettePlace', { part: toolPhrase('F') }));
    // The channel's word finds the four tools (words W4), and "controlled" still does.
    const dependentTools = (['E', 'F', 'G', 'H'] as const).map((tl) => t('palettePlace', { part: toolPhrase(tl) }));
    fireEvent.change(input, { target: { value: 'dependent' } });
    expect(labels(palette)).toEqual(expect.arrayContaining(dependentTools));
    fireEvent.change(input, { target: { value: 'controlled' } });
    expect(labels(palette)).toEqual(expect.arrayContaining(dependentTools));
    // Accents or not: the same examples (words W12).
    fireEvent.change(input, { target: { value: 'Thévenin' } });
    const accented = labels(palette);
    fireEvent.change(input, { target: { value: 'Thevenin' } });
    expect(labels(palette)).toEqual(accented);
    expect(accented.length).toBeGreaterThanOrEqual(6);
    fireEvent.keyDown(input, { key: 'Escape' });
  }, 60000);

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

describe('a fix on a video’s mistake example (kept F1)', () => {
  it('leaves no drawing warning behind, and is said with the count the Checks tab shows', async () => {
    render(<App startup={saved(MISTAKE_1)} engine={realEngine()} serviceWorker={false} />);
    // ngspice answered (with no ground, its numbers are not answers: the status says so).
    await waitFor(() => expect(statusLine()).toMatch(/Not reliable/), { timeout: 15000 });
    expect(tab('Checks').textContent).toBe('Checks1 found');
    fireEvent.click(tab('Checks'));
    const region = screen.getByRole('region', { name: 'Checks' });
    fireEvent.click(within(region).getByRole('button', { name: 'Make n3 the ground (rename it to 0)' }));
    await waitFor(() => expect(polite()).toContain('Done: Make n3 the ground (rename it to 0). No traps found.'));
    await waitFor(() => expect(tab('Checks').textContent).toBe('Checks'));
    expect(within(screen.getByRole('region', { name: 'Checks' })).getByText(t('checksNone'))).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem('plainspice:netlist')).toContain('R2 n2 0 4'));
    expect(localStorage.getItem('plainspice:netlist')).not.toContain('*@ label n3');
    expect(localStorage.getItem('plainspice:netlist')).toContain('*@ label n2');
  }, 30000);
});
