// @vitest-environment jsdom
/**
 * A value typed on a card is drawn from one build of the new text (second re-check, P3): keepDrawing
 * builds it to tell whether the new value would move a part (src/app/card-edit.ts), and the page used
 * to build the same text again a frame later, which doubled every key typed: 1.5 to 3.5 s a key on the
 * crafted 60 parts at one point, on a computer. The page now takes the schematic keepDrawing built
 * (schematicOf). Counted here, not timed: the schematic builds (src/schematic/schematic.ts) a key makes.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App.tsx';
import { valueSpot, withValue } from '../../src/app/card-edit.ts';
import type { Engine } from '../../src/app/engine.ts';
import { partsAtOnePoint } from './schematic-hostile.ts';

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

/**
 * Opens `name`'s card on `netlist`, types `value`, waits until the drawing shows it (`shown`), and
 * counts the builds of the text the card wrote (the value in place: neither netlist here has a part
 * that the new value would move, so no drawing line is written).
 */
async function typed(netlist: string, name: string, value: string, shown: RegExp): Promise<number> {
  const next = withValue(valueSpot(netlist, name.toLowerCase())!, value);
  render(<App startup={{ source: 'saved', netlist }} engine={quiet} serviceWorker={false} />);
  await waitFor(() => expect(document.querySelector('.nb-canvas svg .nb-part')).not.toBeNull(), { timeout: 15000 });
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}, `) }));
  const field = within(screen.getByRole('dialog', { name: new RegExp(`^${name} `) })).getByRole('textbox');
  builds.texts = [];
  fireEvent.change(field, { target: { value } });
  // The drawing follows the text a frame later: wait until it shows the new value, and a moment more.
  await waitFor(() => expect(document.querySelector('.nb-canvas svg')?.textContent).toMatch(shown), { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 100));
  return builds.texts.filter((t) => t === next).length;
}

describe('a value typed on a card is drawn from one build (second re-check, P3)', () => {
  it('Start here: R1 = 2k is built once, not twice', async () => {
    expect(await typed(readFileSync(resolve(root, 'examples/start-here.cir'), 'utf8'), 'R1', '2k', /2\skΩ/)).toBe(1);
  }, 30000);

  it('60 parts at one point (the 542-character link): R2 = 3 is built once', async () => {
    expect(await typed(partsAtOnePoint(60), 'R2', '3', /3\sΩ/)).toBe(1);
  }, 60000);
});
