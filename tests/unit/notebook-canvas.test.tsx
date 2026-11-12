// @vitest-environment jsdom
/**
 * NotebookCanvas (src/notebook): the drawing as a picture with a title and the circuit's description,
 * every part and node a real button with its name and the model's own sentence, one tab stop, arrow
 * keys along the wires (navigate.ts), Enter to open, Escape to let go; the results written on it;
 * the plain-font setting switching the results' font at once.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRef, useState, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AnalysisResults } from '../../src/engine/results.ts';
import { NO_INSETS, NO_RESULTS, NotebookCanvas, notebookSchematic, placeResults, type CanvasHandle, type CanvasViewInfo, type DrawingResults } from '../../src/notebook/index.ts';
import { KEEP_IN_VIEW_PX } from '../../src/notebook/fit.ts';
import { inkBox } from '../../src/notebook/NotebookCanvas.tsx';
import { describeItem, describeSchematic, neighbour, stripDrawing, type NavItem } from '../../src/schematic/index.ts';
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

function Harness({
  results = NO_RESULTS,
  plain = false,
  onOpen = () => undefined,
  pending = false,
  penWords,
  open,
}: {
  results?: DrawingResults;
  plain?: boolean;
  onOpen?: (i: NavItem) => void;
  pending?: boolean;
  penWords?: ReadonlyMap<string, string>;
  open?: string;
}): ReactNode {
  const [selected, setSelected] = useState<NavItem | undefined>(undefined);
  return (
    <div style={{ width: 1000, height: 600 }}>
      <NotebookCanvas
        schematic={s}
        results={results}
        pending={pending}
        penWords={penWords}
        open={open}
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

  it('says where you are and what a part opens, not a toggle: aria-current, aria-haspopup, aria-expanded', () => {
    render(<Harness open="r2" />);
    const g1 = part(/^G1,/);
    expect(g1.hasAttribute('aria-pressed')).toBe(false);
    expect(g1.getAttribute('aria-haspopup')).toBe('dialog');
    expect(g1.getAttribute('aria-expanded')).toBe('false');
    expect(part(/^R2,/).getAttribute('aria-expanded')).toBe('true');
    expect(part(/^Node n1$/).hasAttribute('aria-haspopup')).toBe(false);
    g1.focus();
    fireEvent.focusIn(g1);
    expect(g1.getAttribute('aria-current')).toBe('true');
    // The picture and the group of its buttons have names of their own.
    expect(screen.getByRole('application', { name: 'p02-4, drawn and solved' })).toBeDefined();
  });

  it('reads the red pen with its part, and numbers from before the last change as such', () => {
    render(<Harness results={solved()} pending penWords={new Map([['p:r1', 'R1 has a resistance of 0 Ω']])} />);
    const r1 = document.getElementById(part(/^R1,/).getAttribute('aria-describedby')!)!.textContent!;
    expect(r1).toContain('Check: R1 has a resistance of 0 Ω.');
    const g1 = document.getElementById(part(/^G1,/).getAttribute('aria-describedby')!)!.textContent!;
    expect(g1).toMatch(/Before your last change: 4 amps/);
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
    // Laid out automatically, so the drawing's bounds move as the words change (the example itself opens drawn as in the video).
    const typed = stripDrawing(text);
    const s = notebookSchematic(typed);
    const narrower = notebookSchematic(typed.replace(/^G1 0 a n1 0 0\.25$/m, 'G1 0 a n1 0 0.3'));
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

  it('leaves the reader’s pan and zoom alone while an item is selected, even zoomed in past the item’s size', () => {
    const views: CanvasViewInfo[] = [];
    const ref = createRef<CanvasHandle>();
    // Little free room (a phone's sheet): the selected R1, zoomed in, is taller than the room left.
    const props = { schematic: s, results: NO_RESULTS, plain: false, label: 'p02-4', description: '', selected: { kind: 'part', key: 'r1' } as NavItem, onSelect: () => undefined, onOpen: () => undefined, insets: { top: 0, right: 0, bottom: 480, left: 0 }, fitKey: 'k', minUnit: 10, maxUnit: 40, onView: (v: CanvasViewInfo) => views.push(v) };
    render(<NotebookCanvas ref={ref} {...props} />);
    const first = views.at(-1)!;
    // A pan that takes R1 out of the free part stays: the page does not pull it back. (Not so far that
    // the drawing leaves the window: some of it always stays, as the next test says.)
    act(() => ref.current!.panBy(0, -100));
    expect(views.at(-1)!.view.y).toBeCloseTo(first.view.y - 100, 6);
    const r1 = s.scene.parts.find((p) => p.key === 'r1')!.box;
    expect(views.at(-1)!.view.y + r1.y1 * views.at(-1)!.unit, 'R1 is above the free part').toBeLessThan(0);
    // Zoomed in far past R1's size: no tug of war between its two edges (no endless updates).
    for (let i = 0; i < 6; i++) act(() => ref.current!.zoomBy(1.5));
    expect(views.at(-1)!.unit).toBeGreaterThan(first.unit * 4);
  });

  it('a finger pans unless it holds still on a part: held for a moment, the part lifts and the drag is the editor’s', () => {
    vi.useFakeTimers();
    try {
      const views: CanvasViewInfo[] = [];
      const dragStart = vi.fn();
      const editing = { press: () => 'drag' as const, dragStart, dragMove: vi.fn(), dragEnd: vi.fn() };
      const props = { schematic: s, results: NO_RESULTS, plain: false, label: 'p02-4', description: '', selected: undefined, onSelect: () => undefined, onOpen: () => undefined, insets: NO_INSETS, fitKey: 'k', minUnit: 10, maxUnit: 40, onView: (v: CanvasViewInfo) => views.push(v), editing };
      const { container } = render(<NotebookCanvas {...props} />);
      const canvas = container.querySelector<HTMLElement>('.nb-canvas')!;
      canvas.setPointerCapture = () => undefined;
      const r1 = screen.getByRole('button', { name: /^R1, / });
      // Moved at once: the paper pans, nothing is picked up.
      const before = views.at(-1)!.view;
      fireEvent.pointerDown(r1, { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 200, buttons: 1 });
      fireEvent.pointerMove(r1, { pointerId: 1, pointerType: 'touch', clientX: 340, clientY: 200, buttons: 1 });
      fireEvent.pointerMove(r1, { pointerId: 1, pointerType: 'touch', clientX: 360, clientY: 200, buttons: 1 });
      fireEvent.pointerUp(r1, { pointerId: 1, pointerType: 'touch', clientX: 360, clientY: 200 });
      act(() => vi.advanceTimersByTime(500));
      expect(dragStart).not.toHaveBeenCalled();
      expect(views.at(-1)!.view.x).toBeGreaterThan(before.x + 10);
      // Held still: it lifts (the editor's drag starts), then follows the finger.
      fireEvent.pointerDown(r1, { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 200, buttons: 1 });
      act(() => vi.advanceTimersByTime(400));
      expect(dragStart).toHaveBeenCalledTimes(1);
      fireEvent.pointerMove(r1, { pointerId: 2, pointerType: 'touch', clientX: 340, clientY: 200, buttons: 1 });
      expect(editing.dragMove).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reveals a part of the drawing just enough, clear of a bar along the bottom, however many moves come before the page draws again', () => {
    const views: CanvasViewInfo[] = [];
    const ref = createRef<CanvasHandle>();
    const props = { schematic: s, results: NO_RESULTS, plain: false, label: 'p02-4', description: '', selected: undefined, onSelect: () => undefined, onOpen: () => undefined, insets: NO_INSETS, fitKey: 'k', minUnit: 10, maxUnit: 40, onView: (v: CanvasViewInfo) => views.push(v) };
    render(<NotebookCanvas ref={ref} {...props} />);
    const v0 = views.at(-1)!.view;
    // A box below the window: three calls in a row pan once, to put its bottom 8 px above a 60 px bar.
    const box = { x0: 2, y0: 30, x1: 4, y1: 32 };
    act(() => {
      ref.current!.reveal(box, 60);
      ref.current!.reveal(box, 60);
      ref.current!.reveal(box, 60);
    });
    const v = views.at(-1)!.view;
    expect(v.unit).toBe(v0.unit);
    expect(v.y + (box.y1 + 0.5) * v.unit).toBeCloseTo(600 - 60 - 8, 3);
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

  it('draws each node’s wires in the colour the page gives it (the same as in the Netlist panel), else its own', () => {
    const given = new Map([['n1', '#123456']]);
    const { rerender } = render(
      <div style={{ width: 1000, height: 600 }}>
        <NotebookCanvas schematic={s} results={NO_RESULTS} plain={false} colours={given} label="p02-4" description="" selected={undefined} onSelect={() => undefined} onOpen={() => undefined} insets={NO_INSETS} fitKey="c" minUnit={10} maxUnit={40} />
      </div>,
    );
    const strokes = (): string[] => [...document.querySelectorAll<SVGElement>('.nb-wire')].map((w) => w.style.stroke).filter(Boolean);
    expect(strokes()).toContain('rgb(18, 52, 86)');
    // Nodes the page gives no colour to are drawn in ink.
    expect(strokes().every((c) => c === 'rgb(18, 52, 86)')).toBe(true);
    rerender(
      <div style={{ width: 1000, height: 600 }}>
        <NotebookCanvas schematic={s} results={NO_RESULTS} plain={false} label="p02-4" description="" selected={undefined} onSelect={() => undefined} onOpen={() => undefined} insets={NO_INSETS} fitKey="c" minUnit={10} maxUnit={40} />
      </div>,
    );
    // Without colours from the page, the canvas picks its own for every node.
    expect(new Set(strokes()).size).toBeGreaterThan(1);
  });
});


describe('NotebookCanvas after the final reviews (the phone lane)', () => {
  const base = (views: CanvasViewInfo[]) => ({ schematic: s, results: NO_RESULTS, plain: false, label: 'p02-4', description: '', selected: undefined as NavItem | undefined, onSelect: () => undefined, onOpen: () => undefined as void, insets: NO_INSETS, fitKey: 'k', minUnit: 10, maxUnit: 40, onView: (v: CanvasViewInfo) => views.push(v) });

  it('a press on a part the editor does not take (the turned view): held still it is the part’s click, moving it pans, two fingers pinch (F1)', () => {
    const views: CanvasViewInfo[] = [];
    const onOpen = vi.fn();
    // The turned view is another drawing: the editor takes nothing on it.
    const editing = { press: () => undefined };
    const { container } = render(<NotebookCanvas {...base(views)} onOpen={onOpen} editing={editing} />);
    const canvas = container.querySelector<HTMLElement>('.nb-canvas')!;
    canvas.setPointerCapture = () => undefined;
    const r3 = screen.getByRole('button', { name: /^R3, / });
    // A finger that moves from R3: the paper pans, and the click the browser may still send is not acted on.
    const before = views.at(-1)!.view;
    fireEvent.pointerDown(r3, { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 200, buttons: 1 });
    fireEvent.pointerMove(r3, { pointerId: 1, pointerType: 'touch', clientX: 280, clientY: 200, buttons: 1 });
    fireEvent.pointerMove(r3, { pointerId: 1, pointerType: 'touch', clientX: 150, clientY: 200, buttons: 1 });
    fireEvent.pointerUp(r3, { pointerId: 1, pointerType: 'touch', clientX: 150, clientY: 200 });
    fireEvent.click(r3, { detail: 1 });
    expect(views.at(-1)!.view.x).toBeLessThan(before.x - 100);
    expect(onOpen).not.toHaveBeenCalled();
    // Held still, it is R3's own click: its card opens.
    fireEvent.pointerDown(r3, { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 200, buttons: 1 });
    fireEvent.pointerUp(r3, { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 200 });
    fireEvent.click(r3, { detail: 1 });
    expect(onOpen).toHaveBeenCalledTimes(1);
    // Two fingers, the first on R3, spread apart: the drawing grows.
    const unit = views.at(-1)!.unit;
    fireEvent.pointerDown(r3, { pointerId: 3, pointerType: 'touch', clientX: 300, clientY: 200, buttons: 1 });
    fireEvent.pointerDown(canvas, { pointerId: 4, pointerType: 'touch', clientX: 300, clientY: 260, buttons: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 4, pointerType: 'touch', clientX: 300, clientY: 380, buttons: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 4, pointerType: 'touch', clientX: 300, clientY: 380 });
    fireEvent.pointerUp(r3, { pointerId: 3, pointerType: 'touch', clientX: 300, clientY: 200 });
    fireEvent.click(r3, { detail: 1 });
    expect(views.at(-1)!.unit).toBeGreaterThan(unit * 1.5);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('a sheet that moved the drawing to keep the selected item clear of it moves it back when it goes, unless the reader moved it since (F2)', () => {
    const views: CanvasViewInfo[] = [];
    const ref = createRef<CanvasHandle>();
    const props = { ...base(views), selected: { kind: 'part', key: 'r3' } as NavItem };
    const sheet = { top: 0, right: 0, bottom: 300, left: 0 };
    const { rerender } = render(<NotebookCanvas ref={ref} {...props} />);
    // The view held still, as after a part placed on the drawing.
    act(() => ref.current!.keep());
    const home = views.at(-1)!.view;
    // A sheet over the bottom half: R3 is moved up, clear of it...
    rerender(<NotebookCanvas ref={ref} {...props} insets={sheet} />);
    expect(views.at(-1)!.view.y).toBeLessThan(home.y - 50);
    // ...and the drawing is back where it was when the sheet goes.
    rerender(<NotebookCanvas ref={ref} {...props} />);
    expect(views.at(-1)!.view).toEqual(home);
    // Moved by the reader while the sheet was open: it stays where they put it.
    rerender(<NotebookCanvas ref={ref} {...props} insets={sheet} />);
    act(() => ref.current!.panBy(30, 0));
    const panned = views.at(-1)!.view;
    rerender(<NotebookCanvas ref={ref} {...props} />);
    expect(views.at(-1)!.view).toEqual(panned);
  });

  it('a drag never takes the drawing off the window: some of what is drawn always stays in the free part (F3)', () => {
    const views: CanvasViewInfo[] = [];
    const ref = createRef<CanvasHandle>();
    render(<NotebookCanvas ref={ref} {...base(views)} />);
    const ink = inkBox(s.scene, NO_RESULTS)!;
    act(() => ref.current!.panBy(0, -5000));
    let v = views.at(-1)!.view;
    expect(v.y + ink.y1 * v.unit).toBeGreaterThanOrEqual(KEEP_IN_VIEW_PX - 1e-6);
    act(() => ref.current!.panBy(-5000, 5000));
    v = views.at(-1)!.view;
    expect(v.x + ink.x1 * v.unit).toBeGreaterThanOrEqual(KEEP_IN_VIEW_PX - 1e-6);
    expect(v.y + ink.y0 * v.unit).toBeLessThanOrEqual(600 - KEEP_IN_VIEW_PX + 1e-6);
    // Part of it is out of view now: not whole.
    expect(views.at(-1)!.whole).toBe(false);
  });

  it('is whole when everything drawn is in the free part of the window, wherever the reader put it (F4)', () => {
    const views: CanvasViewInfo[] = [];
    const ref = createRef<CanvasHandle>();
    render(<NotebookCanvas ref={ref} {...base(views)} />);
    expect(views.at(-1)!.whole).toBe(true);
    // Moved a little, all of it still in view: still whole (it said not whole after any move).
    act(() => ref.current!.panBy(2, 2));
    expect(views.at(-1)!.moved).toBe(true);
    expect(views.at(-1)!.whole).toBe(true);
    // Moved so that some of it is out of view: not whole.
    act(() => ref.current!.panBy(-400, 0));
    expect(views.at(-1)!.whole).toBe(false);
  });
});
