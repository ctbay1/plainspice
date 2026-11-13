// @vitest-environment jsdom
/**
 * A value typed on a card is drawn from one build of the new text (second re-check, P3): keepDrawing
 * builds it to tell whether the new value would move a part (src/app/card-edit.ts), and the page used
 * to build the same text again a frame later, which doubled every key typed: 1.5 to 3.5 s a key on the
 * crafted 60 parts at one point, on a computer. The page now takes the schematic keepDrawing built
 * (schematicOf). Where the lines pile parts on other nodes' pins, each value typed writes where the
 * parts are drawn without building the piled lines again, and an undo draws the text it goes back to
 * without building it again (the second re-check's critic). Counted here, not timed: the schematic
 * builds (src/schematic/schematic.ts) a key or an undo makes.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App.tsx';
import { valueSpot, withValue } from '../../src/app/card-edit.ts';
import type { Engine } from '../../src/app/engine.ts';
import { namedStubs, partsAtOnePoint } from './schematic-hostile.ts';

const builds = vi.hoisted(() => ({ texts: [] as string[] }));

vi.mock('../../src/schematic/schematic.ts', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/schematic/schematic.ts')>();
  return {
    ...m,
    buildSchematic: (...args: Parameters<typeof m.buildSchematic>): ReturnType<typeof m.buildSchematic> => {
      const [input] = args;
      builds.texts.push(typeof input === 'string' ? input : input.text);
      return m.buildSchematic(...args);
    },
  };
});

const root = resolve(import.meta.dirname, '../..');

beforeAll(() => {
  // jsdom has no layout (as in app-smoke.test.tsx): CodeMirror measures with these, and the drawing
  // needs a size and a ResizeObserver that has nothing to report.
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
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** An engine that never answers: the drawing and the card are what is looked at here. */
const quiet: Engine = { warmUp: async () => 1, run: () => new Promise(() => undefined), cancel: () => undefined };

/** The drawing shows a text: wait until it does, and a moment more. */
async function shows(text: RegExp, not = false): Promise<void> {
  // The drawing follows the text a frame later.
  await waitFor(() => (not ? expect(document.querySelector('.nb-canvas svg')?.textContent).not.toMatch(text) : expect(document.querySelector('.nb-canvas svg')?.textContent).toMatch(text)), { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 100));
}

/** Opens `name`'s card on `netlist` and gives its field. */
async function cardOf(netlist: string, name: string): Promise<HTMLElement> {
  render(<App startup={{ source: 'saved', netlist }} engine={quiet} serviceWorker={false} />);
  await waitFor(() => expect(document.querySelector('.nb-canvas svg .nb-part')).not.toBeNull(), { timeout: 15000 });
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}, `) }));
  return within(screen.getByRole('dialog', { name: new RegExp(`^${name} `) })).getByRole('textbox');
}

/** Types `value` in the field, waits until the drawing shows it (`shown`), and gives the texts built meanwhile. */
async function typed(field: HTMLElement, value: string, shown: RegExp): Promise<string[]> {
  builds.texts = [];
  fireEvent.change(field, { target: { value } });
  await shows(shown);
  return builds.texts;
}

describe('a value typed on a card is drawn from one build (second re-check, P3)', () => {
  it('Start here: R1 = 2k is built once, not twice', async () => {
    const netlist = readFileSync(resolve(root, 'examples/start-here.cir'), 'utf8');
    // The value in place: no part of this netlist moves with the new value, so no drawing line is written.
    const next = withValue(valueSpot(netlist, 'r1')!, '2k');
    const built = await typed(await cardOf(netlist, 'R1'), '2k', /2\skΩ/);
    expect(built.filter((t) => t === next).length).toBe(1);
    expect(built.length).toBe(1);
  }, 30000);

  it('60 parts at one point (the 542-character link): each value is drawn from one build, the piled lines are built only when the link opens, and an undo builds nothing', async () => {
    const netlist = partsAtOnePoint(60);
    /** Texts whose lines still put R3 where the others are (on their pins). */
    const piled = (texts: readonly string[]): number => texts.filter((t) => /^\*@ R3 0 0 0$/m.test(t)).length;
    const field = await cardOf(netlist, 'R2');
    // The first value writes where the parts are drawn, and only that text is built.
    const first = await typed(field, '3', /3\sΩ/);
    expect(piled(first)).toBe(0);
    expect(first.length).toBe(1);
    const second = await typed(field, '47', /47\sΩ/);
    expect(piled(second)).toBe(0);
    expect(second.length).toBe(1);
    // One undo takes the card's change back: the text it opened on, built when it opened.
    builds.texts = [];
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await shows(/47\sΩ/, true);
    expect(builds.texts).toEqual([]);
  }, 60000);

  it('10 parts at one point and names left where the repairs took their wire away: the first value checks once the lines it would write, then each value is built once', async () => {
    // Read again, the drawing shown would drop the names (its critic, D5): so the lines are not
    // written, and each value is drawn from one build of the piled lines, as before the shortcut.
    const netlist = partsAtOnePoint(10, namedStubs(9));
    const piled = (texts: readonly string[]): number => texts.filter((t) => /^\*@ R3 0 0 0$/m.test(t)).length;
    const field = await cardOf(netlist, 'R2');
    const first = await typed(field, '3', /3\sΩ/);
    expect(first.length).toBe(2);
    expect(piled(first)).toBe(1);
    const second = await typed(field, '47', /47\sΩ/);
    expect(second.length).toBe(1);
    expect(piled(second)).toBe(1);
  }, 60000);
});
