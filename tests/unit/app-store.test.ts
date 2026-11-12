/**
 * The netlist store (src/app/store.ts, decision 0016): the one source of truth for the netlist text,
 * with one undo history for every change wherever it was made (typing, a value set on the drawing,
 * a fix, an opened circuit). Keystrokes typed without a pause are one step; every value typed into
 * one card while it is open is one step. Each text remembers whether it is the student's: an undo or a
 * redo that lands on a circuit just opened is not the student's (the app does not save it).
 */
import { describe, expect, it, vi } from 'vitest';
import { createNetlistStore, MAX_UNDO_STEPS, TYPING_PAUSE_MS, type Change } from '../../src/app/store.ts';

const A = '* A\nV1 a 0 6\nR1 a 0 2\n.op\n.end\n';

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe('the netlist store', () => {
  it('starts with the text, nothing to undo or redo', () => {
    const store = createNetlistStore(A);
    expect(store.get()).toBe(A);
    expect(store.snapshot()).toMatchObject({ text: A, canUndo: false, canRedo: false, last: { source: 'start' } });
  });

  it('tells its listeners every change and who made it; the same text is no change', () => {
    const store = createNetlistStore(A);
    const seen: [string, Change][] = [];
    const stop = store.subscribe((text, change) => seen.push([text, change]));
    store.set(A, { source: 'editor' });
    expect(seen).toEqual([]);
    store.set(`${A}* x\n`, { source: 'fix' });
    expect(seen).toEqual([[`${A}* x\n`, { source: 'fix' }]]);
    stop();
    store.set(A, { source: 'fix' });
    expect(seen).toHaveLength(1);
  });

  it('undoes and redoes whole texts, whatever made the change', () => {
    const store = createNetlistStore(A);
    store.set('one', { source: 'fix' });
    store.set('two', { source: 'drawing', group: 'card:1' });
    store.set('three', { source: 'load' });
    expect(store.undo()).toBe(true);
    expect(store.get()).toBe('two');
    expect(store.undo()).toBe(true);
    expect(store.get()).toBe('one');
    expect(store.snapshot()).toMatchObject({ canUndo: true, canRedo: true, last: { source: 'undo' } });
    expect(store.redo()).toBe(true);
    expect(store.get()).toBe('two');
    expect(store.undo() && store.undo() && store.get()).toBe(A);
    expect(store.undo()).toBe(false);
    expect(store.get()).toBe(A);
  });

  it('a new change after an undo forgets what could be redone', () => {
    const store = createNetlistStore(A);
    store.set('one', { source: 'fix' });
    store.undo();
    store.set('other', { source: 'fix' });
    expect(store.snapshot().canRedo).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it('keystrokes typed without a pause are one step; a pause starts the next', () => {
    const c = clock();
    const store = createNetlistStore('R1 a 0 1', { now: c.now });
    for (const text of ['R1 a 0 1k', 'R1 a 0 1k5', 'R1 a 0 1.5k']) {
      c.advance(100);
      store.set(text, { source: 'editor', group: 'typing' });
    }
    c.advance(TYPING_PAUSE_MS + 1);
    store.set('R1 a 0 2k', { source: 'editor', group: 'typing' });
    store.undo();
    expect(store.get()).toBe('R1 a 0 1.5k');
    store.undo();
    expect(store.get()).toBe('R1 a 0 1');
  });

  it('every value typed into one card while it is open is one step, however long it stays open', () => {
    const c = clock();
    const store = createNetlistStore('R1 a 0 1k', { now: c.now });
    store.set('R1 a 0 2', { source: 'drawing', group: 'card:7' });
    c.advance(60_000);
    store.set('R1 a 0 2k', { source: 'drawing', group: 'card:7' });
    // The next card is a step of its own, and so is typing after it.
    store.set('R1 a 0 3k', { source: 'drawing', group: 'card:8' });
    store.set('R1 a 0 3k\n', { source: 'editor', group: 'typing' });
    store.undo();
    expect(store.get()).toBe('R1 a 0 3k');
    store.undo();
    expect(store.get()).toBe('R1 a 0 2k');
    store.undo();
    expect(store.get()).toBe('R1 a 0 1k');
  });

  it('typing and a card never join each other, nor do changes of different sources', () => {
    const store = createNetlistStore('x');
    store.set('xy', { source: 'editor', group: 'typing' });
    store.set('xyz', { source: 'drawing', group: 'typing' });
    store.undo();
    expect(store.get()).toBe('xy');
  });

  it(`keeps the last ${MAX_UNDO_STEPS} steps`, () => {
    const store = createNetlistStore('0');
    for (let i = 1; i <= MAX_UNDO_STEPS + 20; i++) store.set(String(i), { source: 'fix' });
    let steps = 0;
    while (store.undo()) steps += 1;
    expect(steps).toBe(MAX_UNDO_STEPS);
    expect(store.get()).toBe('20');
  });

  it('gives React the same snapshot until something changes', () => {
    const store = createNetlistStore(A);
    const first = store.snapshot();
    expect(store.snapshot()).toBe(first);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set('b', { source: 'fix' });
    expect(store.snapshot()).not.toBe(first);
    expect(store.snapshot().version).toBe(first.version + 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a card whose value ends where it started leaves no undo step; the next value starts a new one', () => {
    const store = createNetlistStore('R1 a 0 1k');
    store.set('R1 a 0 2k', { source: 'drawing', group: 'card:3' });
    store.set('R1 a 0 1k', { source: 'drawing', group: 'card:3' });
    expect(store.snapshot().canUndo).toBe(false);
    store.set('R1 a 0 5k', { source: 'drawing', group: 'card:3' });
    expect(store.undo()).toBe(true);
    expect(store.get()).toBe('R1 a 0 1k');
    expect(store.undo()).toBe(false);
  });

  it('remembers whose each text is: the student’s, or a circuit opened and not changed', () => {
    const saved = createNetlistStore('* homework');
    expect(saved.snapshot().mine).toBe(true);
    const opened = createNetlistStore('* the first screen', { mine: false });
    expect(opened.snapshot().mine).toBe(false);
    opened.set('* the first screen, changed', { source: 'drawing', group: 'card:1' });
    expect(opened.snapshot().mine).toBe(true);

    // Homework, then two examples opened: undo and redo carry each text's owner with it.
    const store = createNetlistStore('* homework');
    store.set('* example 1', { source: 'load' });
    expect(store.snapshot().mine).toBe(false);
    store.set('* example 2', { source: 'load' });
    store.undo();
    expect(store.snapshot()).toMatchObject({ text: '* example 1', mine: false, last: { source: 'undo' } });
    store.undo();
    expect(store.snapshot()).toMatchObject({ text: '* homework', mine: true });
    store.redo();
    expect(store.snapshot()).toMatchObject({ text: '* example 1', mine: false, last: { source: 'redo' } });
    // An opened circuit, once changed, is the student's, as it was opened too: undoing the change
    // gives back the text it opened with, now theirs (saved, as an undo of their own work is).
    store.set('* example 1, changed', { source: 'editor', group: 'typing' });
    expect(store.snapshot().mine).toBe(true);
    store.undo();
    expect(store.snapshot()).toMatchObject({ text: '* example 1', mine: true });
    // The examples opened before it were never changed: still not the student's.
    store.redo();
    store.set('* example 2', { source: 'load' });
    store.set('* example 3', { source: 'load' });
    store.undo();
    expect(store.snapshot()).toMatchObject({ text: '* example 2', mine: false });
  });
  it('keeps moves of one item made in a row with the keyboard as one step (decision 0017)', () => {
    let clock = 0;
    const store = createNetlistStore('* t\nR1 a 0 1k', { now: () => clock });
    store.set('* t\nR1 a 0 1k\n*@ R1 1 0 0', { source: 'drawing', group: 'move:1', label: 'R1 moved.' });
    clock += 5_000; // a long pause between two key presses: still one step, held like a card
    store.set('* t\nR1 a 0 1k\n*@ R1 2 0 0', { source: 'drawing', group: 'move:1', label: 'R1 moved.' });
    expect(store.undo()).toBe(true);
    expect(store.get()).toBe('* t\nR1 a 0 1k');
    // A new run of moves (another selection) is a step of its own.
    store.redo();
    store.set('* t\nR1 a 0 1k\n*@ R1 3 0 0', { source: 'drawing', group: 'move:2', label: 'R1 moved.' });
    store.undo();
    expect(store.get()).toBe('* t\nR1 a 0 1k\n*@ R1 2 0 0');
  });

  it('says what Undo would undo and Redo would redo, when the change said what it did', () => {
    const store = createNetlistStore('* t');
    expect(store.snapshot().undoLabel).toBeUndefined();
    store.set('* t\nR1 a 0 1k', { source: 'drawing', label: 'R1 added between a and ground.' });
    expect(store.snapshot().undoLabel).toBe('R1 added between a and ground.');
    store.set('* t\nR1 a 0 2k', { source: 'editor', group: 'typing' });
    expect(store.snapshot().undoLabel).toBeUndefined(); // typing says nothing of itself
    store.undo();
    expect(store.snapshot()).toMatchObject({ undoLabel: 'R1 added between a and ground.' });
    expect(store.snapshot().redoLabel).toBeUndefined();
    store.undo();
    expect(store.snapshot()).toMatchObject({ redoLabel: 'R1 added between a and ground.', canUndo: false });
  });
});

describe('the texts of the circuit open now (a new node never takes a name they had)', () => {
  it('are the texts Undo can go back to since the circuit was opened, then the text now, not the steps Redo would bring back', () => {
    const store = createNetlistStore('', { mine: false });
    expect(store.circuitTexts()).toEqual(['']);
    store.set('V1 n1 n2 5', { source: 'drawing' });
    store.set('V1 n1 0 5', { source: 'drawing' });
    expect(store.circuitTexts()).toEqual(['', 'V1 n1 n2 5', 'V1 n1 0 5']);
    store.undo();
    expect(store.circuitTexts()).toEqual(['', 'V1 n1 n2 5']);
    store.undo();
    expect(store.circuitTexts()).toEqual(['']);
    // A new change drops what Redo would have brought back.
    store.set('R1 n1 n2 1k', { source: 'drawing' });
    expect(store.circuitTexts()).toEqual(['', 'R1 n1 n2 1k']);
  });

  it('start where the circuit was opened (an example, a new circuit), and follow Undo back into the circuit before', () => {
    const store = createNetlistStore('* mine\nR1 n1 n2 1k', { mine: true });
    store.set('* mine\nR1 n1 n5 1k', { source: 'editor' });
    store.set('* example\nV1 a 0 6', { source: 'load' });
    expect(store.circuitTexts()).toEqual(['* example\nV1 a 0 6']);
    // The first change makes the opened example the student's: it still starts the circuit's history.
    store.set('* example\nV1 a 0 6\nR1 a b 1k', { source: 'drawing' });
    expect(store.circuitTexts()).toEqual(['* example\nV1 a 0 6', '* example\nV1 a 0 6\nR1 a b 1k']);
    store.set('', { source: 'load' });
    expect(store.circuitTexts()).toEqual(['']);
    store.undo();
    store.undo();
    store.undo();
    // Back in the student's own circuit: its own history.
    expect(store.circuitTexts()).toEqual(['* mine\nR1 n1 n2 1k', '* mine\nR1 n1 n5 1k']);
  });

  it('go back to the oldest step kept when the circuit was opened longer ago than that', () => {
    const store = createNetlistStore('* t', { mine: true });
    for (let i = 0; i <= MAX_UNDO_STEPS + 5; i++) store.set(`* t\nR1 n1 n${i + 2} 1k`, { source: 'drawing' });
    expect(store.circuitTexts()).toHaveLength(MAX_UNDO_STEPS + 1);
  });
});
