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
