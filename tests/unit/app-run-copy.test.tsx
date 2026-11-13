// @vitest-environment jsdom
/**
 * What PlainSpice hands ngspice, in the whole app (src/spice/run-netlist.ts): a netlist ngspice cannot
 * take is not run, and the alert says why once, not again at every pause while the student types on
 * (the second re-check's P1: a B source without its ) crashed the engine at every pause).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { App } from '../../src/app/App.tsx';
import type { Engine } from '../../src/app/engine.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { RUN_COPY_WORDS } from '../../src/spice/run-netlist.ts';

const root = resolve(import.meta.dirname, '../..');
let ngspice: Promise<NgspiceEngine>;

beforeAll(() => {
  // As in app-smoke.test.tsx: jsdom has no layout.
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
  ngspice = WebAssembly.compile(readFileSync(resolve(root, 'engine/dist/ngspice.wasm'))).then((m) =>
    NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, m),
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const statusLine = (): string => document.querySelector('.status')?.textContent ?? '';
const alerts = (): string[] => [...screen.getByTestId('live-alert').children].map((p) => p.textContent ?? '');
/**
 * The paragraphs added to the alert region from now on: one paragraph is one announcement. Counted as
 * they come, not read from the region: a paragraph stays there for 10 s, so the one from before would
 * pass a check of the region's words (as app-smoke.test.tsx counts the polite region's).
 */
function heard(): { said: string[]; stop: () => void } {
  const said: string[] = [];
  const mo = new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) said.push(n.textContent ?? '');
  });
  mo.observe(screen.getByTestId('live-alert'), { childList: true });
  return { said, stop: () => mo.disconnect() };
}
const runButton = (): HTMLElement => within(screen.getByRole('toolbar', { name: 'Actions' })).getByRole('button', { name: 'Run' });
/** Ctrl+K, then its "Run ngspice now". */
function runFromPalette(): void {
  fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
  const input = within(screen.getByRole('dialog', { name: 'Commands' })).getByRole('combobox');
  fireEvent.change(input, { target: { value: 'run ngspice now' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

async function editorView(): Promise<import('@codemirror/view').EditorView> {
  const { EditorView } = await import('@codemirror/view');
  const content = await waitFor(
    () => {
      const el = document.querySelector<HTMLElement>('.cm-content');
      if (!el) throw new Error('no editor yet');
      return el;
    },
    { timeout: 5000 },
  );
  return EditorView.findFromDOM(content)!;
}

describe('a netlist ngspice cannot take, in the app', () => {
  // About 2 s alone (three live runs and their pauses); 30 s, as the app's other slow tests have.
  it('is never run, and the alert says why once while it is typed, and again when the reason changes', async () => {
    const runs: string[] = [];
    const engine: Engine = {
      warmUp: async () => (await ngspice, 1),
      run: async (netlist) => (runs.push(netlist), (await ngspice).run(netlist)),
      cancel: () => undefined,
    };
    const typed = '* t\nV1 a 0 9\nR1 a b 1k\nB1 b 0 V=v(a\n.op\n.end\n';
    render(<App startup={{ source: 'saved', netlist: typed }} engine={engine} serviceWorker={false} />);
    const why = RUN_COPY_WORDS.noClose(4, 'v(');
    await waitFor(() => expect(statusLine()).toContain(why), { timeout: 15000 });
    // ngspice was never asked: the status line does not say it could not run (the last pass, C3-4).
    expect(document.querySelector('.status__main')?.textContent).toBe('PlainSpice did not run it');
    expect(statusLine()).not.toContain('ngspice could not run');
    await waitFor(() => expect(alerts()).toEqual([`The simulation could not run: ${why}`]));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Panels' })).getByRole('button', { name: /^Netlist/ }));
    const view = await editorView();
    // Typing on in the same formula: each pause runs it again, with the same reason.
    for (const more of ['+', '1', '*', '2']) {
      const at = view.state.doc.toString().indexOf('\n.op');
      view.dispatch({ changes: { from: at, insert: more } });
      await new Promise((r) => setTimeout(r, 400));
    }
    expect(view.state.doc.toString()).toContain('B1 b 0 V=v(a+1*2\n');
    expect(alerts()).toEqual([`The simulation could not run: ${why}`]);
    // Another reason is said: the same mistake on another line.
    const doc = view.state.doc.toString();
    view.dispatch({ changes: { from: doc.indexOf('B1'), insert: '* a note\n' } });
    const moved = RUN_COPY_WORDS.noClose(5, 'v(');
    await waitFor(() => expect(alerts()).toEqual([`The simulation could not run: ${why}`, `The simulation could not run: ${moved}`]), { timeout: 5000 });
    // Mended, it runs: b = v(a) + 2 = 11 V.
    view.dispatch({ changes: { from: view.state.doc.toString().indexOf('v(a') + 3, insert: ')' } });
    await waitFor(() => expect(statusLine()).toMatch(/Finished in \d+ ms/), { timeout: 15000 });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toContain('B1 b 0 V=v(a)+1*2\n');
  }, 30_000);
});

describe('a run Run asks for that fails is said each time, as one that finishes is (the last pass: C3-2, a11y-phone-1; decision 0010)', () => {
  // The alert said a refused netlist's reason once, and Run, Ctrl+Enter and Ctrl+K's "Run ngspice now"
  // then said nothing (c520a49: 0 of 3), while the status line only went "Running…" and back for 1–2 ms.
  it('a netlist PlainSpice does not run: Run, Ctrl+Enter and Ctrl+K each say the reason again; ngspice is never asked', async () => {
    const runs: string[] = [];
    const engine: Engine = {
      warmUp: async () => (await ngspice, 1),
      run: async (netlist) => (runs.push(netlist), (await ngspice).run(netlist)),
      cancel: () => undefined,
    };
    render(<App startup={{ source: 'saved', netlist: '* t\nV1 a 0 9\nR1 a b 1k\nB1 b 0 V=v(a\n.op\n.end\n' }} engine={engine} serviceWorker={false} />);
    const why = `The simulation could not run: ${RUN_COPY_WORDS.noClose(4, 'v(')}`;
    await waitFor(() => expect(alerts()).toEqual([why]), { timeout: 15000 });
    const said = heard();
    fireEvent.click(runButton());
    await waitFor(() => expect(said.said).toEqual([why]), { timeout: 5000 });
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(said.said).toEqual([why, why]), { timeout: 5000 });
    runFromPalette();
    await waitFor(() => expect(said.said).toEqual([why, why, why]), { timeout: 5000 });
    // Said once each, not more.
    await new Promise((r) => setTimeout(r, 500));
    expect(said.said).toHaveLength(3);
    said.stop();
    expect(runs).toEqual([]);
  }, 30_000);

  // fix-base said every failed run; c520a49 said only the first (1 alert for 3 runs).
  it('an engine whose run stops: Run and Ctrl+Enter each say why again', async () => {
    let runs = 0;
    const engine: Engine = {
      warmUp: async () => 1,
      run: async () => {
        runs += 1;
        throw new Error('The engine stopped unexpectedly.');
      },
      cancel: () => undefined,
    };
    render(<App startup={{ source: 'saved', netlist: '* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\n.end\n' }} engine={engine} serviceWorker={false} />);
    const why = 'The simulation could not run: The engine stopped unexpectedly.';
    await waitFor(() => expect(alerts()).toEqual([why]), { timeout: 15000 });
    // ngspice was asked and stopped: the status line says so.
    expect(document.querySelector('.status__main')?.textContent).toBe('ngspice could not run');
    const said = heard();
    fireEvent.click(runButton());
    await waitFor(() => expect(said.said).toEqual([why]), { timeout: 5000 });
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(said.said).toEqual([why, why]), { timeout: 5000 });
    expect(runs).toBe(3);
    said.stop();
  }, 30_000);
});

describe('a node card and the ngspice output panel say why there are no numbers, as a part card does (the last pass: a11y-phone-2)', () => {
  const noVoltage = (): string => document.querySelector('.node-card__none')?.textContent ?? '';
  const realEngine = (): Engine => ({ warmUp: async () => (await ngspice, 1), run: async (netlist) => (await ngspice).run(netlist), cancel: () => undefined });
  const panels = (): HTMLElement => screen.getByRole('navigation', { name: 'Panels' });

  // c520a49: "No voltage yet: ngspice runs the circuit in a moment." and "Nothing yet: ngspice has not run
  // this circuit.", while nothing would run until the ) was added.
  it('a netlist PlainSpice does not run: the node card gives the reason, as R1’s card does, and the output panel says the simulation could not run and why', async () => {
    render(<App startup={{ source: 'saved', netlist: '* t\nV1 a 0 9\nR1 a b 1k\nB1 b 0 V=v(a\n.op\n.end\n' }} engine={realEngine()} serviceWorker={false} />);
    const why = RUN_COPY_WORDS.noClose(4, 'v(');
    await waitFor(() => expect(statusLine()).toContain(why), { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: 'Node a' }));
    await waitFor(() => expect(noVoltage()).toBe(why));
    expect(noVoltage()).not.toContain('in a moment');
    fireEvent.click(within(panels()).getByRole('button', { name: /^ngspice output/ }));
    const output = await screen.findByRole('region', { name: 'ngspice output' });
    expect(output.textContent).toContain(`The simulation could not run: ${why}`);
    expect(output.textContent).not.toContain('Nothing yet');
  }, 30_000);

  // The first fix and c520a49: after Run on a link opened without running, the status line, the node card and R1's
  // card kept "This link opens without running: press Run (Ctrl+Enter) to run it.", while the alert said why it did
  // not run. A change runs nothing while live runs are paused, so the failure of the text as it is now came from Run.
  it('Run on a link opened without running, of a netlist PlainSpice does not run: the status line, the node card and R1’s card give the reason (the last pass’s critic, CR1-1)', async () => {
    const runs: string[] = [];
    const engine: Engine = { warmUp: async () => (await ngspice, 1), run: async (netlist) => (runs.push(netlist), (await ngspice).run(netlist)), cancel: () => undefined };
    render(<App startup={{ source: 'share', netlist: '* t\nV1 a 0 9\nR1 a b 1k\nB1 b 0 V=v(a\n.op\n.end\n', run: false }} engine={engine} serviceWorker={false} />);
    await waitFor(() => expect(statusLine()).toContain('Not run yet'), { timeout: 15000 });
    const why = RUN_COPY_WORDS.noClose(4, 'v(');
    fireEvent.click(runButton());
    await waitFor(() => expect(document.querySelector('.status__main')?.textContent).toBe('PlainSpice did not run it'), { timeout: 5000 });
    expect(statusLine()).toContain(why);
    expect(statusLine()).not.toContain('press Run');
    fireEvent.click(screen.getByRole('button', { name: 'Node a' }));
    await waitFor(() => expect(noVoltage()).toBe(why));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /^R1, / }));
    await waitFor(() => expect(document.querySelector('.index-card__note')?.textContent).toBe(why));
    expect(runs).toEqual([]);
  }, 30_000);

  // The same sentence came for every netlist that does not run without Run (fix-base too): the node card
  // now says what the status line and a part's card say.
  it('no analysis line, and a link opened without running: the node card says what to do, not "in a moment"', async () => {
    render(<App startup={{ source: 'saved', netlist: '* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.end\n' }} engine={realEngine()} serviceWorker={false} />);
    await waitFor(() => expect(statusLine()).toContain('Nothing to run yet'), { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: 'Node b' }));
    await waitFor(() => expect(noVoltage()).toBe('Add an analysis line, such as .op: the Checks panel offers one.'));
    cleanup();
    render(<App startup={{ source: 'share', netlist: '* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\n.end\n', run: false }} engine={realEngine()} serviceWorker={false} />);
    await waitFor(() => expect(statusLine()).toContain('Not run yet'), { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: 'Node b' }));
    await waitFor(() => expect(noVoltage()).toBe('This link opens without running: press Run (Ctrl+Enter) to run it.'));
  }, 30_000);
});

