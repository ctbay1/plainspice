// @vitest-environment jsdom
/**
 * The page after the final reviews of milestone 2 (the ui lane), in jsdom with the real ngspice as
 * in app-smoke.test.tsx: Ctrl+K's real list found by the words it shows (words W4, W5, W12) and its
 * field keeping the focus (a11y A1, A3); a fix on a video's mistake example leaving no drawing
 * warning, and said with the tab's count (kept F1); the starter's why in the hint line (words W9);
 * the Netlist panel a SPICE for Beginners example opened, closed by the next video's example
 * (student netlist-panel-stays). Focus order and axe in a real browser: tests/e2e/ui-review.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { App } from '../../src/app/App.tsx';
import { starterWords } from '../../src/app/editing.ts';
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
    // The channel's word finds the four tools (words W4), first, before the examples named with it (the
    // critic of W4: Enter opened an example over the open circuit), and "controlled" still does.
    const dependentTools = (['E', 'F', 'G', 'H'] as const).map((tl) => t('palettePlace', { part: toolPhrase(tl) }));
    for (const query of ['dependent', 'dependent source']) {
      fireEvent.change(input, { target: { value: query } });
      expect(labels(palette).slice(0, 4), query).toEqual(dependentTools);
      expect(labels(palette).length, query).toBeGreaterThan(4);
      expect(within(palette).getByRole('option', { selected: true }).textContent).toContain(dependentTools[0]);
    }
    fireEvent.change(input, { target: { value: 'controlled' } });
    expect(labels(palette)).toEqual(expect.arrayContaining(dependentTools));
    // And a textbook's initials: each its own source, first.
    for (const [query, i] of [['vcvs', 0], ['cccs', 1], ['vccs', 2], ['ccvs', 3]] as const) {
      fireEvent.change(input, { target: { value: query } });
      expect(labels(palette)[0], query).toBe(dependentTools[i]);
    }
    // A short query keeps the command whose name it starts, for Enter (the second critic of W4: the other
    // names put E first for "v", "d" and "de").
    for (const [query, label] of [['v', t('palettePlace', { part: toolPhrase('V') })], ['d', t('paletteWire')], ['de', t('paletteDelete', { name: 'R2' })]] as const) {
      fireEvent.change(input, { target: { value: query } });
      expect(labels(palette)[0], query).toBe(label);
      expect(within(palette).getByRole('option', { selected: true }).textContent, query).toContain(label);
    }
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

describe('the first part on a blank page (words W9)', () => {
  it('shows why .op and .end were written, first in the hint line, not only says it', async () => {
    render(<App startup={saved('')} engine={realEngine()} serviceWorker={false} />);
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Parts and tools' })).getByRole('button', { name: 'Add a part' }));
    const form = await screen.findByRole('dialog', { name: 'Add a part' }, { timeout: 5000 });
    fireEvent.click(within(form).getByRole('button', { name: /^Add R1/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a part' })).toBeNull());
    // (The form's part is placed by the drawing, so no drawing lines are written yet: only the starter's why.)
    await waitFor(() => expect(document.querySelector('.hint')!.textContent).toBe(starterWords()));
    await waitFor(() => expect(polite()).toContain(starterWords()));
  }, 30000);

  it('keeps the why through an Escape that only closes something, as its own button does; the Escape that lets go takes it away', async () => {
    render(<App startup={saved('')} engine={realEngine()} serviceWorker={false} />);
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Parts and tools' })).getByRole('button', { name: 'Add a part' }));
    const form = await screen.findByRole('dialog', { name: 'Add a part' }, { timeout: 5000 });
    fireEvent.click(within(form).getByRole('button', { name: /^Add R1/ }));
    await waitFor(() => expect(document.querySelector('.hint')!.textContent).toBe(starterWords()));
    // The Netlist panel opened to look at the new .op and .end, then closed with Escape (the second critic
    // of W9: that Escape took the why away unread): it stays, as when the panel's tab closes it.
    fireEvent.click(tab('Netlist'));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Netlist' })).toBeTruthy());
    // An Escape typed in the netlist editor is the editor's: the why stays, and so does the panel.
    const editor = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.cm-content');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.getByRole('region', { name: 'Netlist' })).toBeTruthy();
    expect(document.querySelector('.hint')!.textContent).toBe(starterWords());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Netlist' })).toBeNull());
    expect(document.querySelector('.hint')!.textContent).toBe(starterWords());
    // The next Escape lets go of R1, selected by the form: the student is done with the why.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.hint')!.textContent).not.toBe(starterWords()));
  }, 30000);
});

describe('the Netlist panel a SPICE for Beginners example opens (student netlist-panel-stays)', () => {
  const choose = async (name: string | RegExp): Promise<void> => {
    fireEvent.click(screen.getByRole('button', { name: 'Examples' }));
    fireEvent.click(await screen.findByRole('menuitem', { name }, { timeout: 5000 }));
  };
  const netlistOpen = (): boolean => screen.queryByRole('region', { name: t('panelNetlist') }) !== null;

  it('closes when an example of another video opens, and opens again with the next SPICE for Beginners example', async () => {
    render(<App startup={firstVisit()} engine={realEngine()} serviceWorker={false} />);
    await solved();
    await choose('Example 1');
    await waitFor(() => expect(netlistOpen()).toBe(true));
    await choose(/^Example 3: a supernode with a dependent source/);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/supernode/i));
    expect(netlistOpen()).toBe(false);
    await choose(/^Dependent sources E, G, F and H/);
    await waitFor(() => expect(netlistOpen()).toBe(true));
  }, 30000);

  it('stays open when the student opened it, whatever example opens next', async () => {
    render(<App startup={firstVisit()} engine={realEngine()} serviceWorker={false} />);
    await solved();
    await choose('Example 1');
    await waitFor(() => expect(netlistOpen()).toBe(true));
    // The student closes it and opens it again: now it is the student's.
    fireEvent.click(tab('Netlist'));
    expect(netlistOpen()).toBe(false);
    fireEvent.click(tab('Netlist'));
    expect(netlistOpen()).toBe(true);
    await choose(/^Example 3: a supernode with a dependent source/);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/supernode/i));
    expect(netlistOpen()).toBe(true);
  }, 30000);
});
