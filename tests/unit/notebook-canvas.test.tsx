// @vitest-environment jsdom
/**
 * NotebookCanvas (src/notebook): the drawing as a picture with a title and the circuit's description,
 * every part and node a real button with its name and the model's own sentence, one tab stop, arrow
 * keys along the wires (navigate.ts), Enter to open, Escape to let go; the results written on it;
 * the plain-font setting switching the results' font at once.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AnalysisResults } from '../../src/engine/results.ts';
import { NO_INSETS, NO_RESULTS, NotebookCanvas, notebookSchematic, placeResults, type CanvasViewInfo, type DrawingResults } from '../../src/notebook/index.ts';
import { describeItem, describeSchematic, neighbour, type NavItem } from '../../src/schematic/index.ts';
import { describeResults } from '../../src/spice/describe.ts';
import { parseNetlist } from '../../src/spice/parse.ts';

beforeAll(() => {
  // jsdom has no layout: give the canvas a window's size, and a ResizeObserver that has nothing to report.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});
afterEach(cleanup);

const text = readFileSync(resolve(import.meta.dirname, '../../examples/p02/p02-4-open.cir'), 'utf8');
const s = notebookSchematic(text);

function solved(): DrawingResults {
  const results: AnalysisResults = {
    op: {
      nodes: [
        { node: 's', value: 12 },
        { node: 'n1', value: 16 },
        { node: 'a', value: 24 },
      ],
      currents: [
        { element: 'v1', value: 4 / 3, origin: 'branch', vector: 'i(v1)' },
        { element: 'r1', value: -4 / 3, origin: 'device', vector: 'i(@r1[i])' },
        { element: 'r2', value: -4, origin: 'device', vector: 'i(@r2[i])' },
        { element: 'r3', value: 16 / 6, origin: 'device', vector: 'i(@r3[i])' },
        { element: 'g1', value: 4, origin: 'device', vector: 'i(@g1[i])' },
      ],
    },
    other: [],
  };
  const run = { ok: true, unreliable: false, exitCode: 0, stdout: '', stderr: '', plots: [], diagnostics: [], timings: { instantiateMs: 0, runMs: 0, parseMs: 0 } };
  return placeResults(s.scene, describeResults(parseNetlist(text), results, run));
}

function Harness({ results = NO_RESULTS, plain = false, onOpen = () => undefined }: { results?: DrawingResults; plain?: boolean; onOpen?: (i: NavItem) => void }): ReactNode {
  const [selected, setSelected] = useState<NavItem | undefined>(undefined);
  return (
    <div style={{ width: 1000, height: 600 }}>
      <NotebookCanvas
        schematic={s}
        results={results}
        plain={plain}
        label="p02-4, drawn and solved"
        description={describeSchematic(s)}
        selected={selected}
        onSelect={setSelected}
        onOpen={onOpen}
        onEscape={() => setSelected(undefined)}
        insets={NO_INSETS}
        fitKey="test"
        minUnit={10}
        maxUnit={40}
      />
      <p data-testid="selected">{selected ? (selected.kind === 'part' ? selected.key : selected.name) : 'none'}</p>
    </div>
  );
}

const part = (name: RegExp): HTMLElement => screen.getByRole('button', { name });

describe('NotebookCanvas', () => {
  it('is a picture with a title and the circuit in words', () => {
    render(<Harness />);
    const img = screen.getByRole('img', { name: 'p02-4, drawn and solved' });
    expect(img.tagName.toLowerCase()).toBe('svg');
    expect(img.querySelector('desc')?.textContent).toBe(describeSchematic(s));
    expect(document.getElementById(img.getAttribute('aria-describedby')!)?.textContent).toBe(describeSchematic(s));
  });

  it('has a button for every part and node, named in plain words, described by the model', () => {
    render(<Harness />);
    for (const [name, kind] of [
      ['V1', 'voltage source'],
      ['R1', 'resistor'],
      ['G1', 'voltage-controlled current source'],
    ] as const) {
      const b = part(new RegExp(`^${name}, ${kind}$`));
      const desc = document.getElementById(b.getAttribute('aria-describedby')!)!.textContent!;
      expect(desc).toContain(describeItem(s, { kind: 'part', key: name.toLowerCase() }));
    }
    expect(part(/^Node n1$/)).toBeDefined();
    expect(part(/^Ground, node 0$/)).toBeDefined();
  });

  it('is one tab stop; arrow keys move along the wires, Enter opens, Escape lets go', () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    const stops = screen.getAllByRole('button').filter((b) => b.tabIndex === 0);
    expect(stops).toHaveLength(1);
    const g1 = part(/^G1,/);
    g1.focus();
    fireEvent.focusIn(g1);
    expect(document.activeElement).toBe(g1);
    expect(screen.getByTestId('selected').textContent).toBe('g1');
    // From G1 up its lead: the node at its pin that way (navigate.ts decides).
    const up = neighbour(s, { kind: 'part', key: 'g1' }, 'up')!;
    fireEvent.keyDown(g1, { key: 'ArrowUp' });
    expect(screen.getByTestId('selected').textContent).toBe(up.kind === 'part' ? up.key : up.name);
    expect(document.activeElement?.getAttribute('data-item')).toBe(up.kind === 'part' ? `p:${up.key}` : `n:${up.name}`);
    fireEvent.click(part(/^R2,/));
    expect(onOpen).toHaveBeenCalledWith({ kind: 'part', key: 'r2' });
    fireEvent.keyDown(part(/^R2,/), { key: 'Escape' });
    expect(screen.getByTestId('selected').textContent).toBe('none');
  });

  it('writes the results on the drawing, and reads them out with each part', () => {
    render(<Harness results={solved()} />);
    const svg = screen.getByRole('img');
    const words = [...svg.querySelectorAll('.nb-result__text')].map((t) => t.textContent!.replace(/ /g, ' '));
    for (const w of ['= 12 V', '= 16 V', '= 24 V', '1.333 A', '4 A', '2.667 A', 'absorbs', '16 W', 'delivers', '96 W']) expect(words).toContain(w);
    const g1 = part(/^G1,/);
    expect(document.getElementById(g1.getAttribute('aria-describedby')!)!.textContent).toMatch(/4 amps .* delivers 96 watts/);
  });

  it('switches the results to the plain font at once, and nothing else moves', () => {
    const { rerender } = render(<Harness results={solved()} />);
    const svg = screen.getByRole('img');
    const before = [...svg.querySelectorAll('text')].filter((t) => !t.classList.contains('nb-result__text')).map((t) => `${t.getAttribute('x')},${t.getAttribute('y')}`);
    expect(svg.querySelector('.nb-drawing')!.classList.contains('is-plain')).toBe(false);
    rerender(<Harness results={solved()} plain />);
    expect(svg.querySelector('.nb-drawing')!.classList.contains('is-plain')).toBe(true);
    const after = [...svg.querySelectorAll('text')].filter((t) => !t.classList.contains('nb-result__text')).map((t) => `${t.getAttribute('x')},${t.getAttribute('y')}`);
    expect(after).toEqual(before);
  });

  it('marks every line of words with the room the model kept for it', () => {
    render(<Harness results={solved()} />);
    const lines = screen.getByRole('img').querySelectorAll('[data-room]');
    expect(lines.length).toBeGreaterThan(20);
    for (const l of lines) expect(Number(l.getAttribute('data-room'))).toBeGreaterThan(0);
  });

  it('holds the view while the drawing’s words change (a value typed), and fits again when let go', () => {
    const views: CanvasViewInfo[] = [];
    const narrower = notebookSchematic(text.replace(/^G1 0 a n1 0 0\.25$/m, 'G1 0 a n1 0 0.3'));
    expect(narrower.scene.bounds.x1).not.toBe(s.scene.bounds.x1);
    const props = { results: NO_RESULTS, plain: false, label: 'p02-4', description: '', selected: undefined, onSelect: () => undefined, onOpen: () => undefined, insets: NO_INSETS, fitKey: 'k', minUnit: 10, maxUnit: 400, onView: (v: CanvasViewInfo) => views.push(v) };
    const { rerender } = render(<NotebookCanvas {...props} schematic={s} />);
    const first = views.at(-1)!;
    rerender(<NotebookCanvas {...props} schematic={narrower} hold />);
    expect(views.at(-1)!.unit).toBe(first.unit);
    // Nor when the page's own bars change size a little while it holds (a status line that wraps)...
    rerender(<NotebookCanvas {...props} schematic={narrower} hold insets={{ top: 0, right: 0, bottom: 30, left: 0 }} />);
    expect(views.at(-1)!.unit).toBe(first.unit);
    // ...but a sheet arriving (a phone's card) is room taken: it fits again.
    rerender(<NotebookCanvas {...props} schematic={narrower} hold insets={{ top: 0, right: 0, bottom: 300, left: 0 }} />);
    expect(views.at(-1)!.unit).not.toBe(first.unit);
    rerender(<NotebookCanvas {...props} schematic={narrower} hold insets={NO_INSETS} />);
    rerender(<NotebookCanvas {...props} schematic={narrower} />);
    expect(views.at(-1)!.unit).not.toBe(first.unit);
  });

  it('pans by the page’s offset without changing the size (room for a card), and back', () => {
    const views: CanvasViewInfo[] = [];
    const props = { schematic: s, results: NO_RESULTS, plain: false, label: 'p02-4', description: '', selected: undefined, onSelect: () => undefined, onOpen: () => undefined, insets: NO_INSETS, fitKey: 'k', minUnit: 10, maxUnit: 40, onView: (v: CanvasViewInfo) => views.push(v) };
    const { rerender } = render(<NotebookCanvas {...props} />);
    const rest = views.at(-1)!;
    rerender(<NotebookCanvas {...props} offset={{ x: 0, y: 80 }} />);
    const panned = views.at(-1)!;
    expect(panned.unit).toBe(rest.unit);
    expect(panned.view.y).toBeCloseTo(rest.view.y + 80, 6);
    expect(panned.base).toEqual(rest.view);
    rerender(<NotebookCanvas {...props} />);
    expect(views.at(-1)!.view).toEqual(rest.view);
  });

  it('writes red pen on the drawing: a note, a crossed-out old value, a circled value', () => {
    const about = s.scene.parts.find((p) => p.key === 'r1')!.box;
    const pen = {
      notes: [{ text: 'A note', lines: [{ text: 'A note', x: 2, y: 4 }], box: { x0: 1.9, y0: 3.5, x1: 5, y1: 4.5 }, about, arrow: { from: { x: 3, y: 3.5 }, to: { x: 4, y: 1 } } }],
      was: [{ node: 'n1', text: '16 V', x: 9, y: -1.5, box: { x0: 8.9, y0: -1.9, x1: 11, y1: -1.1 } }],
      circled: new Set(['r1']),
    };
    render(<NotebookCanvas schematic={s} results={solved()} plain={false} label="p02-4" description="" selected={undefined} onSelect={() => undefined} onOpen={() => undefined} insets={NO_INSETS} fitKey="k" minUnit={10} maxUnit={40} pen={pen} />);
    const svg = screen.getByRole('img');
    expect([...svg.querySelectorAll('.nb-pen__text')].map((t) => t.textContent)).toEqual(['A note']);
    expect(svg.querySelector('.nb-pen__stroke')).not.toBeNull();
    expect([...svg.querySelectorAll('.nb-was__text')].map((t) => t.textContent)).toEqual(['16 V']);
    expect(svg.querySelector('.nb-was__strike')).not.toBeNull();
    expect(svg.querySelectorAll('ellipse.nb-pen__circle')).toHaveLength(1);
    // Red pen is for the eye: the page says the same in words.
    expect(svg.querySelector('.nb-pen')!.getAttribute('aria-hidden')).toBe('true');
  });
});

