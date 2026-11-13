// @vitest-environment jsdom
/**
 * The last pass's words lane, round-1 critic C1, in the whole app (as tests/unit/app-smoke.test.tsx renders it:
 * the real editor, model, drawing and ngspice). Since the checks name a node as the Numbers panel does (F6),
 * floating-dc's title is the no-single-answer note's very sentence, "Node in has no DC path to ground": the red pen
 * writes it once, beside the part the check marks, and a screen reader hears it once, not again at the node.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { App } from '../../src/app/App.tsx';
import type { Engine } from '../../src/app/engine.ts';
import type { StartupDecision } from '../../src/app/startup.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';

const root = resolve(import.meta.dirname, '../..');

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

const saved = (netlist: string): StartupDecision => ({ source: 'saved', netlist });
const statusLine = (): string => document.querySelector('.status')?.textContent ?? '';
const drawingText = (): string => document.querySelector('.nb-canvas svg')?.textContent ?? '';
/** The words a screen reader reads after an item's name on the drawing. */
const describedBy = (el: HTMLElement): string => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '';
/** A sentence as the red pen writes it: wrapped at any space, the lines' words run together in the text. */
const penned = (sentence: string): RegExp => new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll(' ', '\\s*'), 'g');
const count = (text: string, sentence: string): number => text.match(penned(sentence))?.length ?? 0;

describe('round-1 critic C1: a part’s check that says the node’s sentence is written and said once', () => {
  // Native ngspice 47 and 42 on the reviewer's circuit: "singular matrix: check node in", then a transient op (floating-dc-1).
  const CAPS = '* capacitors only\nV1 x 0 6\nC1 x in 1u\nC2 in 0 1u\n.op\n.end\n';
  const SENTENCE = 'Node in has no DC path to ground';

  it('capacitors only: one red-pen note, by C1, and the sentence in one item’s words', async () => {
    render(<App startup={saved(CAPS)} engine={realEngine()} serviceWorker={false} />);
    fireEvent.click(screen.getByRole('button', { name: /^Run/ }));
    await waitFor(() => expect(statusLine()).toMatch(/^Not reliable/), { timeout: 15000 });
    expect(statusLine()).toContain('A check found an error: Node in has no DC path to ground.');
    await waitFor(() => expect(count(drawingText(), SENTENCE)).toBeGreaterThan(0));
    expect(count(drawingText(), SENTENCE)).toBe(1);
    const c1 = screen.getByRole('button', { name: /^C1, / });
    const node = screen.getByRole('button', { name: 'Node in' });
    expect(describedBy(c1)).toContain('Check: Node in has no DC path to ground.');
    expect(count(describedBy(node), SENTENCE)).toBe(0);
  }, 30000);

  it('where the part’s check says something else, the node keeps its note and its words: I1 into a capacitor', async () => {
    // The check says "I1's current has nowhere to go"; ngspice points at node b (current-source-no-path-1).
    render(<App startup={saved('* t\nI1 0 b 1m\nC1 b 0 1u\nR1 a 0 1k\nV1 a 0 1\n.op\n.end\n')} engine={realEngine()} serviceWorker={false} />);
    fireEvent.click(screen.getByRole('button', { name: /^Run/ }));
    await waitFor(() => expect(statusLine()).toMatch(/^Not reliable/), { timeout: 15000 });
    await waitFor(() => expect(count(drawingText(), 'Node b has no DC path to ground')).toBe(1));
    expect(count(drawingText(), "I1's current has nowhere to go")).toBe(1);
    expect(describedBy(screen.getByRole('button', { name: 'Node b' }))).toContain('Check: Node b has no DC path to ground.');
  }, 30000);
});
