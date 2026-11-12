// @vitest-environment jsdom
/**
 * The words re-check of the merged fixes of milestone 2's final reviews (12 November 2026, decisions
 * 0016 and 0017), in the whole app (as tests/unit/app-smoke.test.tsx renders it: the real editor,
 * model, drawing and ngspice):
 *
 * - words re-check 2: a node's own sentences say "node in" (a name may be an ordinary word) and quote
 *   an ordinary node named like ground, as the sentences next to them do: its description on the
 *   drawing ("Node in connects V1 and R1. Node in is 6 volts."), its card ("node in is 6 volts") and
 *   the card's close button; ground (node 0) stays "ground".
 * - S7 and words re-check 8: the Numbers panel names a node outside ASCII as first written (GİRİŞ, aµ),
 *   never half lower-cased, and keeps ngspice's own spelling in its ngspice column.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { App } from '../../src/app/App.tsx';
import { NumbersPanel } from '../../src/app/components/NumbersPanel.tsx';
import type { Engine } from '../../src/app/engine.ts';
import { START_HERE_ID } from '../../src/app/examples.ts';
import { solveText } from '../../src/app/model.ts';
import type { StartupDecision } from '../../src/app/startup.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';

const root = resolve(import.meta.dirname, '../..');
const START = readFileSync(resolve(root, 'examples/start-here.cir'), 'utf8');

let ngspice: Promise<NgspiceEngine>;

beforeAll(() => {
  // As in app-smoke.test.tsx: jsdom has no layout, so CodeMirror and the drawing get these.
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
const statusLine = (): string => document.querySelector('.status')?.textContent ?? '';
const polite = (): string => screen.getByTestId('live-polite').textContent ?? '';
/** The words a screen reader reads after an item's name on the drawing (its results). */
const describedBy = (el: HTMLElement): string => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '';
/** The words a screen reader hears for a node card's voltage. */
const voltageSaid = (card: HTMLElement): string => card.querySelector('.node-card__voltage .visually-hidden')?.textContent ?? '';

async function solved(): Promise<void> {
  await waitFor(() => expect(statusLine()).toMatch(/Finished in \d+ ms/), { timeout: 15000 });
}

describe('words re-check 2: a node\'s own sentences say "node in"', () => {
  it('on Start here: its description on the drawing, its card and the card\'s close button', async () => {
    render(<App startup={firstVisit()} engine={realEngine()} serviceWorker={false} />);
    await solved();
    const node = screen.getByRole('button', { name: 'Node in' });
    await waitFor(() => expect(describedBy(node)).toBe('Node in connects V1 and R1. Node in is 6 volts.'));
    expect(describedBy(screen.getByRole('button', { name: 'Node out' }))).toBe('Node out connects R1 and R2. Node out is 4 volts.');
    fireEvent.click(node);
    const card = screen.getByRole('dialog', { name: /^Node in/ });
    expect(voltageSaid(card)).toBe('node in is 6 volts');
    expect(within(card).getByRole('button', { name: 'Close the card of node in' })).toBeTruthy();
    expect(within(card).getByRole('textbox', { name: 'Name of node in' })).toBeTruthy();
    // Ground (node 0) is ground: "ground is 0 volts", and its card is ground's.
    fireEvent.click(screen.getByRole('button', { name: 'Ground, node 0' }));
    const ground = screen.getByRole('dialog', { name: /^Ground/ });
    expect(voltageSaid(ground)).toBe('ground is 0 volts');
    expect(within(ground).getByRole('button', { name: 'Close the card of Ground (node 0)' })).toBeTruthy();
  }, 30000);

  it('an ordinary node named ground: node "ground" is 4 volts, beside ground (node 0), which is 0 volts', async () => {
    // Native ngspice 47 and 42: ground = 4 V, an ordinary node (W13).
    const NAMED = '* a node named ground\nV1 in 0 6\nR1 in ground 1k\nR2 ground 0 2k\n.op\n.end\n';
    render(<App startup={saved(NAMED)} engine={realEngine()} serviceWorker={false} />);
    fireEvent.click(screen.getByRole('button', { name: /^Run/ }));
    await solved();
    await waitFor(() => expect(polite()).toContain('node "ground" is 4 volts'));
    const node = screen.getByRole('button', { name: 'Node ground' });
    expect(describedBy(node)).toBe('Node "ground" connects R1 and R2. Node "ground" is 4 volts.');
    act(() => node.focus());
    fireEvent.click(node);
    const card = screen.getByRole('dialog', { name: /^Node ground/ });
    expect(voltageSaid(card)).toBe('node "ground" is 4 volts');
    expect(within(card).getByRole('button', { name: 'Close the card of node "ground"' })).toBeTruthy();
  }, 30000);

  it('a node named node1: "node1 is 6 volts", never "node node1" or "Node1"', async () => {
    const NODE1 = '* nodes named node1 and node2\nV1 node1 0 6\nR1 node1 node2 1k\nR2 node2 0 2k\n.op\n.end\n';
    render(<App startup={saved(NODE1)} engine={realEngine()} serviceWorker={false} />);
    fireEvent.click(screen.getByRole('button', { name: /^Run/ }));
    await solved();
    const node = screen.getByRole('button', { name: 'Node node1' });
    await waitFor(() => expect(describedBy(node)).toBe('node1 connects V1 and R1. node1 is 6 volts.'));
    fireEvent.click(node);
    const card = screen.getByRole('dialog', { name: /^Node node1/ });
    expect(voltageSaid(card)).toBe('node1 is 6 volts');
    expect(within(card).getByRole('button', { name: 'Close the card of node1' })).toBeTruthy();
  }, 30000);
});

/** A cell as seen: its code, or the number shown (not the words read out), or its text; no-break spaces as spaces. */
const seen = (c: Element): string => (c.querySelector('code') ?? c.querySelector('span[aria-hidden="true"]:not(:empty)') ?? c).textContent!.replace(/\u00a0/g, ' ').trim();

/** The Numbers panel's rows of the table whose caption matches, each row's cells as seen. */
async function panelRows(text: string, caption: RegExp): Promise<string[][]> {
  const result = await solveText(text, await ngspice);
  render(
    <NumbersPanel
      outcome={{ kind: 'done', text, result }}
      text={text}
      running={false}
      paused={false}
      colours={new Map()}
      plotAvailable={false}
      onGoToLine={() => {}}
      onShowChecks={() => {}}
      onShowPlot={() => {}}
    />,
  );
  const table = screen.getAllByRole('table').find((t) => caption.test(t.querySelector('caption')?.textContent ?? ''))!;
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((r) => [...r.querySelectorAll('th, td')].map(seen));
}

describe('S7: the Numbers panel names a node outside ASCII as first written', () => {
  it('GİRİŞ and ÇIKIŞ in the node and current tables, g__r____ and __iki__ in ngspice\'s column', async () => {
    // Native ngspice 47 and 42: v(g__r____) = 12, v(__iki__) = 8 (W16).
    const CAPS = '* Turkish capitals\nV1 GİRİŞ 0 12\nR1 GİRİŞ ÇIKIŞ 1k\nR2 ÇIKIŞ 0 2k\n.op\n.end\n';
    expect((await panelRows(CAPS, /node/i)).map((r) => [r[0], r[2]])).toEqual([
      ['GİRİŞ', 'v(g__r____) = 1.200000e+01'],
      ['ÇIKIŞ', 'v(__iki__) = 8.000000e+00'],
    ]);
    cleanup();
    expect((await panelRows(CAPS, /current/i)).map((r) => [r[0], r[2]])).toEqual([
      ['V1', 'from ground to GİRİŞ'],
      ['R1', 'from GİRİŞ to ÇIKIŞ'],
      ['R2', 'from ÇIKIŞ to ground'],
    ]);
  }, 30000);

  it('aµ as written, au in ngspice\'s column (W16: ngspice reads µ as u)', async () => {
    expect((await panelRows('* micro\nV1 aµ 0 5\nR1 aµ 0 1k\n.op\n.end\n', /node/i)).map((r) => [r[0], r[2]])).toEqual([['aµ', 'v(au) = 5.000000e+00']]);
  }, 30000);
});
