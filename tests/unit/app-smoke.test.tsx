// @vitest-environment jsdom
/**
 * The whole app in jsdom: <App /> with the real editor (CodeMirror), the real parser, trap checks,
 * explanations and descriptions, the real drawing (src/schematic, src/notebook) and the real ngspice
 * (WebAssembly, run in Node instead of a Web Worker, behind the app's Engine interface). Layout,
 * focus order, phones and axe are checked in a real browser (tests/e2e); here the point is that the
 * pieces are wired together (decision 0016): the first screen solved at once, the one netlist text
 * changed from the drawing and from the Netlist panel with one undo history, live runs, checks with
 * a fix, the panels, Ctrl+K, the dialogs, and share links.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { App } from '../../src/app/App.tsx';
import type { Engine } from '../../src/app/engine.ts';
import { START_HERE_ID } from '../../src/app/examples.ts';
import { t } from '../../src/i18n/index.ts';
import type { StartupDecision } from '../../src/app/startup.ts';
import { EngineCancelledError } from '../../src/engine/client.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { encodeShare } from '../../src/share/link.ts';
import { withDrawingBlock } from '../../src/notebook/schematic.ts';
import { stripDrawing } from '../../src/schematic/index.ts';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const START = read('examples/start-here.cir');
const F5 = read('tests/fixtures/f5-thevenin-cccs.cir');
const F3A = read('tests/fixtures/f3a-1M-trap.cir');
/** What ngspice runs for a netlist with .op: the same text with .options savecurrents before .end. */
const asRun = (netlist: string): string => netlist.replace(/^\.end$/m, '.options savecurrents\n.end');

let ngspice: Promise<NgspiceEngine>;

beforeAll(() => {
  // jsdom has no layout: CodeMirror measures text with these (as in editor-api.test.ts), and the
  // drawing needs a size and a ResizeObserver that has nothing to report (as in notebook-canvas.test.tsx).
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
  // A compiled module, not bytes: Node's Buffer is from another realm under jsdom.
  ngspice = WebAssembly.compile(readFileSync(resolve(root, 'engine/dist/ngspice.wasm'))).then((m) =>
    NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, m),
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  history.replaceState(null, '', '/');
  document.documentElement.removeAttribute('data-text-size');
  vi.useRealTimers();
});

/** The real ngspice behind the app's Engine interface (no Worker in jsdom); `delay` makes every run slow. */
function realEngine(delay = 0): Engine & { runs: string[] } {
  const runs: string[] = [];
  return {
    runs,
    warmUp: async () => {
      await ngspice;
      return 1;
    },
    run: async (netlist) => {
      runs.push(netlist);
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return (await ngspice).run(netlist);
    },
    cancel: () => undefined,
  };
}

/** A first visit: Start here (startup.ts's choice when there is no link and nothing saved). */
const firstVisit = (): StartupDecision => ({ source: 'example', netlist: START, exampleId: START_HERE_ID });
function start(netlist: string, extra: { run?: boolean } = {}): StartupDecision {
  return extra.run !== undefined ? { source: 'share', netlist, run: extra.run } : { source: 'saved', netlist };
}

const polite = (): string => screen.getByTestId('live-polite').textContent ?? '';
/**
 * The paragraphs added to the polite region from now on whose words match: one paragraph is one
 * announcement. Counted as they come, not read from the region: a paragraph stays there for 10 s, so
 * the one from before would pass a check of the region's words (the second re-check, AP-3).
 */
function heard(re: RegExp): { said: string[]; stop: () => void } {
  const said: string[] = [];
  const mo = new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (re.test(n.textContent ?? '')) said.push(n.textContent ?? '');
  });
  mo.observe(screen.getByTestId('live-polite'), { childList: true });
  return { said, stop: () => mo.disconnect() };
}
const statusLine = (): string => document.querySelector('.status')?.textContent ?? '';
const drawingText = (): string => document.querySelector('.nb-canvas svg')?.textContent ?? '';
const editorText = (): string => document.querySelector('.cm-content')?.textContent ?? '';
const part = (name: string): HTMLElement => screen.getByRole('button', { name: new RegExp(`^${name}, `) });
const tab = (name: string): HTMLElement => within(screen.getByRole('navigation', { name: 'Panels' })).getByRole('button', { name: new RegExp(`^${name}`) });
/** The words a screen reader reads after a part's or a node's name (its results). */
const describedBy = (el: HTMLElement): string => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '';

async function solved(): Promise<void> {
  await waitFor(() => expect(statusLine()).toMatch(/Finished in \d+ ms/), { timeout: 15000 });
}

/** The CodeMirror view of the open Netlist panel. */
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

describe('<App />', () => {
  it('the first screen: Start here, already solved, with the sticky note inviting a change to R1', async () => {
    const engine = realEngine();
    render(<App startup={firstVisit()} engine={engine} serviceWorker={false} />);
    // The page: one h1 (the circuit's title), the top bar, the parts, the drawing, the panels' tabs, the status.
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['PlainSpice: Start here: change R1 and watch the numbers move']);
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('main').id).toBe('drawing');
    expect(screen.getByRole('contentinfo')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Skip to the drawing' })).toBeTruthy();
    const actions = screen.getByRole('toolbar', { name: 'Actions' });
    expect(within(actions).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Share', 'Export', 'Help', 'Settings', 'Run']);
    const tools = within(screen.getByRole('navigation', { name: 'Parts and tools' })).getByRole('toolbar', { name: 'Parts and tools' });
    expect(within(tools).getAllByRole('button').map((b) => b.querySelector('.tool__word')?.textContent)).toEqual([
      'Select',
      'Wire',
      'Resistor',
      'Capacitor',
      'Inductor',
      'Voltage source',
      'Current source',
      'Dependent source',
      'Ground',
      'Add a part',
    ]);
    expect(within(screen.getByRole('navigation', { name: 'Panels' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Netlist', 'Checks', 'Explain', 'Numbers', 'Plot', 'ngspice output']);
    // The drawing: every part and node a button, named.
    expect(screen.getByRole('application', { name: 'Drawing of the circuit: Start here: change R1 and watch the numbers move' })).toBeTruthy();
    for (const name of ['V1', 'R1', 'R2']) expect(part(name)).toBeTruthy();
    // The sticky note.
    const note = screen.getByRole('complementary', { name: 'Change R1 and watch the numbers move' });
    expect(within(note).getByRole('button', { name: 'Change R1' })).toBeTruthy();
    // Solved at once, with no Run: out = 6 V × 2k / 3k = 4 V, on the drawing and for screen readers.
    await solved();
    expect(engine.runs).toEqual([asRun(START)]);
    expect(drawingText()).toMatch(/=\s*4\sV/);
    expect(describedBy(screen.getByRole('button', { name: 'Node out' }))).toMatch(/out is 4 volts/);
    expect(statusLine()).toContain('ngspice 47, in your browser');
    expect(statusLine()).toContain('Operating point · .op');
    await waitFor(() => expect(polite()).toMatch(/out = 4 volts|4 volts/));
    // Nothing is saved for a circuit just opened.
    await new Promise((r) => setTimeout(r, 600));
    expect(localStorage.getItem('plainspice:netlist')).toBeNull();
  }, 30000);

  it('change R1 on its card: ngspice solves again as you type, the old numbers are crossed out; Undo and Redo go back and forth', async () => {
    const engine = realEngine();
    render(<App startup={firstVisit()} engine={engine} serviceWorker={false} />);
    await solved();
    fireEvent.click(screen.getByRole('button', { name: 'Change R1' }));
    const card = screen.getByRole('dialog', { name: /^R1 resistor/ });
    expect(screen.queryByRole('complementary', { name: /Change R1/ })).toBeNull(); // the note has done its job
    const field = within(card).getByRole('textbox', { name: /R1/ });
    expect(document.activeElement).toBe(field);
    expect((field as HTMLInputElement).value).toBe('1k');
    fireEvent.change(field, { target: { value: '2k' } });
    await waitFor(() => expect(within(card).getByText(/SPICE reads it as/).textContent).toMatch(/2\skΩ/));
    // A moment later ngspice runs the new text: out = 6 V × 2k / 4k = 3 V (written "= 3 V" beside
    // out); the 4 V is crossed out.
    await waitFor(() => expect(drawingText()).toMatch(/=\s*3\sV/), { timeout: 15000 });
    expect(engine.runs.at(-1)).toContain('R1 in out 2k');
    expect(engine.runs).toHaveLength(2);
    expect([...card.querySelectorAll('s.readout__was')].map((s) => s.textContent).join(' ')).toMatch(/4\sV|2\smA/);
    expect(within(card).getByText('Was').closest('p')!.textContent).toContain('1k');
    // Enter closes the card; the change was saved for this device.
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.queryByRole('dialog', { name: /^R1 resistor/ })).toBeNull();
    await waitFor(() => expect(localStorage.getItem('plainspice:netlist')).toContain('R1 in out 2k'));
    // One undo puts the whole card's change back, and ngspice solves the old text again.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(drawingText()).toMatch(/=\s*4\sV/), { timeout: 15000 });
    expect(engine.runs.at(-1)).toContain('R1 in out 1k');
    expect(polite()).toMatch(/Undone|out/);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(drawingText()).toMatch(/=\s*3\sV/), { timeout: 15000 });
    // Run out, Redo keeps the focus it may have (aria-disabled) and says "Nothing to redo." when pressed.
    expect(screen.getByRole('button', { name: 'Redo' }).getAttribute('aria-disabled')).toBe('true');
  }, 30000);

  it('the Netlist panel: the same text, its drawing lines folded; typing redraws the drawing, the checks follow, and the count is announced', async () => {
    const engine = realEngine();
    // A netlist that carries where its parts are drawn (the *@ lines, as a link or a file may).
    const drawn = withDrawingBlock(START);
    expect(drawn).toMatch(/^\*@ R1 /m);
    render(<App startup={start(drawn)} engine={engine} serviceWorker={false} />);
    await solved();
    // A value changed on the drawing changes that value and nothing else.
    fireEvent.click(part('R1'));
    fireEvent.change(screen.getByRole('textbox', { name: /R1/ }), { target: { value: '2k' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: /R1/ }), { key: 'Escape' });
    fireEvent.click(tab('Netlist'));
    const panel = screen.getByRole('region', { name: 'Netlist' });
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: 'Netlist' }));
    const view = await editorView();
    expect(screen.getByRole('textbox', { name: 'Netlist' })).toBeTruthy();
    expect(view.state.doc.toString()).toBe(drawn.replace('R1 in out 1k', 'R1 in out 2k'));
    // The drawing lines are folded: one line says so, and a button shows them.
    expect(editorText()).not.toContain('*@ R1');
    const show = within(panel).getByRole('button', { name: /^Show the \d+ drawing lines$/ });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(show);
    await waitFor(() => expect(editorText()).toContain('*@ R1'));
    fireEvent.click(within(panel).getByRole('button', { name: 'Hide the drawing lines' }));
    await waitFor(() => expect(editorText()).not.toContain('*@ R1'));
    // Typing: a new part is drawn at once (laid out, as it has no *@ line yet), the checks follow.
    const doc = view.state.doc.toString();
    act(() => {
      view.dispatch({ changes: { from: doc.indexOf('.op'), insert: 'R9 out 0 1M\n' } });
    });
    await waitFor(() => expect(part('R9')).toBeTruthy());
    await waitFor(() => expect(tab('Checks').textContent).toBe('Checks1 found'));
    await waitFor(() => expect(polite()).toMatch(/1 trap found/), { timeout: 3000 });
    // Red pen on the drawing names the trap next to R9.
    expect(drawingText()).toMatch(/1M means 1 milliohm/);
    await waitFor(() => expect(localStorage.getItem('plainspice:netlist')).toContain('R9 out 0 1M'));
    // Ctrl+Z in the editor is the app's undo: the whole typing step goes.
    act(() => {
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(view.state.doc.toString()).not.toContain('R9'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^R9, / })).toBeNull());
  }, 30000);

  it('runs F5: the Numbers panel has v(a) = 14 V with words, the currents, the announcement, notes on the lines, and the ngspice output', async () => {
    const engine = realEngine();
    render(<App startup={start(F5)} engine={engine} serviceWorker={false} />);
    await solved();
    expect(engine.runs).toEqual([asRun(F5)]); // the student's text is unchanged
    fireEvent.click(tab('Numbers'));
    const table = await screen.findByRole('table', { name: /Node voltages/ });
    const rowA = within(table).getByRole('row', { name: /^a / });
    expect(rowA.textContent).toMatch(/14\sV/);
    expect(rowA.textContent).toContain('14 volts'); // the visually hidden words
    expect(rowA.textContent).toContain('v(a) = 1.400000e+01');
    expect(screen.getByText('Finished')).toBeTruthy();
    const currents = screen.getByRole('table', { name: 'Currents' });
    expect(within(currents).getByRole('row', { name: /Vx/ }).textContent).toContain('from a to x');
    // .options savecurrents in the copy that ran gives the resistors' currents too.
    // Ground is called "ground", as on the drawing and the card.
    expect(within(currents).getByRole('row', { name: /R1/ }).textContent).toContain('from n1 to ground');
    await waitFor(() => expect(polite()).toMatch(/a = 14 volts|14 volts/));
    // The results on the netlist's lines (inline notes from annotateLines), and the text unchanged.
    fireEvent.click(tab('Netlist'));
    await editorView();
    await waitFor(() => expect(editorText()).toContain('a → x'));
    expect(editorText()).not.toContain('savecurrents');
    // ngspice's own output: the command, and the line PlainSpice added.
    fireEvent.click(tab('ngspice output'));
    const output = screen.getByRole('region', { name: 'ngspice output' });
    expect(within(output).getByText('ngspice -b -r out.raw circuit.cir')).toBeTruthy();
    expect(within(output).getByText('.options savecurrents')).toBeTruthy();
    // Explain: the whole circuit in words, then every line.
    fireEvent.click(tab('Explain'));
    const explain = screen.getByRole('region', { name: 'Explain' });
    expect(within(explain).getByRole('heading', { name: 'The whole circuit in words' })).toBeTruthy();
    expect(within(explain).getByRole('heading', { name: 'Every line, explained' })).toBeTruthy();
  }, 30000);

  it('Ctrl+Enter runs from anywhere on the page (not only in the editor), but not inside a dialog', async () => {
    const engine = realEngine();
    render(<App startup={start(F5)} engine={engine} serviceWorker={false} />);
    await solved();
    expect(engine.runs).toHaveLength(1);
    fireEvent.keyDown(tab('Checks'), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(engine.runs).toHaveLength(2), { timeout: 15000 });
    await solved();
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    const dialog = await screen.findByRole('dialog', { name: 'Help' }, { timeout: 5000 });
    fireEvent.keyDown(within(dialog).getAllByRole('button', { name: 'Close' })[0]!, { key: 'Enter', metaKey: true });
    await new Promise((r) => setTimeout(r, 300));
    expect(engine.runs).toHaveLength(2);
    // The Help dialog: the keys, and the licences and the engine check.
    expect(within(dialog).getByRole('link', { name: 'Licences and source' }).getAttribute('href')).toBe('./licenses/');
    expect(within(dialog).getByRole('link', { name: /Engine check/ }).getAttribute('href')).toBe('./spike/');
    expect(within(dialog).getByRole('table', { name: 'Keyboard shortcuts' }).textContent).toContain('Ctrl+K');
  }, 30000);

  it('the 1M trap: red pen on the drawing, the Checks panel with its fix; the fix rewrites the line and the checks run again', async () => {
    render(<App startup={start(F3A)} engine={realEngine()} serviceWorker={false} />);
    expect(tab('Checks').textContent).toBe('Checks1 found');
    await solved();
    expect(drawingText()).toMatch(/1M means 1 milliohm/);
    fireEvent.click(tab('Checks'));
    const panel = screen.getByRole('region', { name: 'Checks' });
    expect(within(panel).getByRole('button', { name: /Go to line 3/ })).toBeTruthy();
    expect(within(panel).getByText(/What ngspice does:/)).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: /1meg/ }));
    await waitFor(() => expect(tab('Checks').textContent).toBe('Checks'));
    await waitFor(() => expect(polite()).toMatch(/No traps found/));
    fireEvent.click(tab('Netlist'));
    await editorView();
    await waitFor(() => expect(editorText()).toContain('R1 n1 n2 1meg'));
  }, 30000);

  // The whole app in jsdom, as above (0.1 s alone): 30 s.
  it('a netlist without an analysis line is not run; the app says why and the checks offer one', async () => {
    const engine = realEngine();
    render(<App startup={start('* no analysis\nV1 a 0 6\nR1 a 0 2\n.end\n')} engine={engine} serviceWorker={false} />);
    await waitFor(() => expect(statusLine()).toContain('Nothing to run yet'));
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByRole('region', { name: 'Nothing to run yet' })).toBeTruthy();
    expect(engine.runs).toEqual([]);
    fireEvent.click(tab('Checks'));
    expect(screen.getByRole('button', { name: /Add \.op/ })).toBeTruthy();
  }, 30000);

  it('when ngspice’s DC solution fails, the numbers are not shown as answers', async () => {
    // "ground" is an ordinary node name (docs/spice-facts W13): ngspice warns "singular matrix".
    render(<App startup={start('* ground word\nV1 a ground 6\nR1 a ground 2\n.op\n.end\n')} engine={realEngine()} serviceWorker={false} />);
    await waitFor(() => expect(statusLine()).toContain('Not reliable'), { timeout: 15000 });
    // No numbers on the drawing: red pen says why instead.
    expect(drawingText()).not.toMatch(/=\s*6\sV/);
    fireEvent.click(tab('Numbers'));
    expect(within(screen.getByRole('region', { name: 'Numbers' })).getByText('Not reliable')).toBeTruthy();
    const folded = screen.getByText('What ngspice printed anyway').closest('details');
    expect(folded).toBeTruthy();
    expect(folded!.open).toBe(false);
    // The only node table is the folded one.
    for (const table of screen.queryAllByRole('table', { hidden: true })) expect(folded!.contains(table)).toBe(true);
    expect(screen.getByText('What happened, in plain words')).toBeTruthy();
  }, 30000);

  it('a share link with run=1 opens the circuit and runs it at once; nothing is saved', async () => {
    const engine = realEngine();
    const netlist = '* from a link\nV1 n1 0 6\nR1 n1 0 2\n.op\n.end\n';
    render(<App startup={start(netlist, { run: true })} engine={engine} serviceWorker={false} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('from a link');
    await solved();
    expect(engine.runs).toEqual([asRun(netlist)]);
    await waitFor(() => expect(polite()).toMatch(/Opened the circuit from the link|n1/));
    // Opening a link saves nothing until the student edits the circuit (security review M4).
    await new Promise((r) => setTimeout(r, 600));
    expect(localStorage.getItem('plainspice:netlist')).toBeNull();
  }, 30000);

  it('a link that asks not to run waits for Run, and never replaces the saved netlist until the student edits it', async () => {
    localStorage.setItem('plainspice:netlist', '* MY HOMEWORK\nV1 a 0 1\nR1 a 0 1\n.op\n.end\n');
    history.replaceState(null, '', '#c=from-a-link'); // the address while the link's circuit is open (no hashchange)
    const engine = realEngine();
    render(<App startup={start('* from a link\nV1 n1 0 6\nR1 n1 0 2\n.op\n.end\n', { run: false })} engine={engine} serviceWorker={false} />);
    await waitFor(() => expect(statusLine()).toContain('Not run yet'));
    await new Promise((r) => setTimeout(r, 700)); // past the live run's and the autosave's waits
    expect(engine.runs).toEqual([]);
    expect(localStorage.getItem('plainspice:netlist')).toContain('MY HOMEWORK');
    expect(location.hash).toBe('#c=from-a-link'); // a reload opens the link again
    // The student's first change makes it theirs: saved, and the link leaves the address. Live runs
    // still wait for Run (the link asked), and Run turns them on.
    fireEvent.click(part('R1'));
    fireEvent.change(screen.getByRole('textbox', { name: /R1/ }), { target: { value: '3' } });
    await waitFor(() => expect(localStorage.getItem('plainspice:netlist')).toContain('R1 n1 0 3'));
    expect(location.hash).toBe('');
    expect(engine.runs).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await solved();
    expect(engine.runs).toHaveLength(1);
  }, 30000);

  it('a share link pasted into the address (hashchange) opens and runs; a broken one says why', async () => {
    const engine = realEngine();
    render(<App startup={start(F5)} engine={engine} serviceWorker={false} />);
    await solved();
    const fragment = await encodeShare('* pasted\nV1 n1 0 6\nR1 n1 0 2\n.op\n.end\n', { run: true });
    // Setting location.hash makes jsdom fire 'hashchange', as a browser does.
    act(() => {
      location.hash = fragment;
    });
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('pasted'));
    await waitFor(() => expect(engine.runs.at(-1)).toContain('* pasted'), { timeout: 15000 });
    // The link stays in the address until the first edit (a reload opens it again), and nothing is saved.
    expect(location.hash).toBe(`#${fragment}`);
    expect(localStorage.getItem('plainspice:netlist')).toBeNull();
    act(() => {
      location.hash = 'c=q999';
    });
    // In the notice itself (the live region repeats the reason for a moment, so not the whole page).
    const notice = await screen.findByRole('region', { name: 'The link could not be opened' });
    expect(within(notice).getByText(/made by a newer version of PlainSpice/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('pasted'); // the circuit stays
    // A skip-link fragment is no share link: nothing happens.
    act(() => {
      location.hash = 'main';
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.getAllByText('The link could not be opened')).toHaveLength(1);
  }, 30000);

  // About 1 s alone (a slow run waited for, stopped, and run again); 1.6 s at load 16 on 4 cores: 30 s, as
  // the other tests here have.
  it('Stop cancels a run that takes long: Run becomes Stop, and live runs wait for Run again', async () => {
    let reject: (e: Error) => void = () => undefined;
    const engine: Engine & { runs: number } = {
      runs: 0,
      warmUp: async () => 1,
      run: () => {
        engine.runs += 1;
        return new Promise((_resolve, rej) => (reject = rej));
      },
      cancel: vi.fn(() => reject(new EngineCancelledError('The simulation was stopped.'))),
    };
    render(<App startup={start(F5)} engine={engine} serviceWorker={false} />);
    await waitFor(() => expect(statusLine()).toContain('Running…'));
    const stop = await screen.findByRole('button', { name: 'Stop' }, { timeout: 2000 });
    fireEvent.click(stop);
    expect(engine.cancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(statusLine()).toContain('Stopped'));
    expect(statusLine()).toContain('To run it again, press Run (Ctrl+Enter).');
    await waitFor(() => expect(polite()).toContain('The simulation was stopped.'));
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy();
    // A change does not start a run while paused.
    fireEvent.click(part('R1'));
    fireEvent.change(screen.getByRole('textbox', { name: /R1/ }), { target: { value: '5' } });
    await new Promise((r) => setTimeout(r, 500));
    expect(engine.runs).toBe(1);
  }, 30000);

  it('a run slower than 1.5 s pauses live runs: the status line says to press Run, and Run solves the new text', async () => {
    const engine = realEngine(1600);
    render(<App startup={firstVisit()} engine={engine} serviceWorker={false} />);
    await waitFor(() => expect(statusLine()).toContain('Live runs paused'), { timeout: 15000 });
    expect(statusLine()).toMatch(/The last run took 1\.\d s, so ngspice does not run after every change: press Run \(Ctrl\+Enter\)\./);
    await waitFor(() => expect(polite()).toMatch(/so ngspice now runs only when you press Run/));
    // The numbers of that run are still shown.
    await waitFor(() => expect(drawingText()).toMatch(/=\s*4\sV/));
    fireEvent.click(part('R1'));
    fireEvent.change(screen.getByRole('textbox', { name: /R1/ }), { target: { value: '2k' } });
    await new Promise((r) => setTimeout(r, 500));
    expect(engine.runs).toHaveLength(1);
    expect(statusLine()).toContain('The numbers are from before your last change.');
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(engine.runs).toHaveLength(2));
    await waitFor(() => expect(drawingText()).toMatch(/=\s*3\sV/), { timeout: 15000 });
  }, 30000);

  // The whole app in jsdom, as above: 30 s.
  it('a netlist that asks for very many points is not run on its own: the status line says why', async () => {
    const engine = realEngine();
    render(<App startup={start('* long\nV1 a 0 1\nR1 a b 1k\nC1 b 0 1n\n.tran 1n 1 0 1n\n.end\n')} engine={engine} serviceWorker={false} />);
    await waitFor(() => expect(statusLine()).toContain('Live runs paused'));
    expect(statusLine()).toMatch(/This netlist asks for about [\d,]+ points, so ngspice does not run after every change/);
    await new Promise((r) => setTimeout(r, 400));
    expect(engine.runs).toEqual([]);
  }, 30000);

  // Every test here mounts the whole app in jsdom: 0.1 to 0.5 s alone, but at load 20 on 4 cores this one
  // took 5.7 s, past vitest's 5 s: 30 s, as the other tests here have.
  it('Settings: the text size applies to <html> and is remembered; the results’ font switches between handwriting and plain', async () => {
    render(<App startup={firstVisit()} engine={realEngine()} serviceWorker={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Settings' }, { timeout: 5000 });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Extra large (150 %)' }));
    expect(document.documentElement.getAttribute('data-text-size')).toBe('x-large');
    expect(JSON.parse(localStorage.getItem('plainspice:settings') ?? '{}')).toMatchObject({ textSize: 'x-large' });
    fireEvent.click(within(dialog).getAllByRole('radio', { name: 'Follow my device' })[0]!);
    expect(document.documentElement.hasAttribute('data-text-size')).toBe(false);
    // The results' font: handwriting (Caveat) by default, plain (Inter) on request, at once.
    expect(document.querySelector('.app')!.classList.contains('nb-plain')).toBe(false);
    fireEvent.click(within(dialog).getByRole('radio', { name: /Plain/ }));
    expect(document.querySelector('.app')!.classList.contains('nb-plain')).toBe(true);
    await waitFor(() => expect(polite()).toContain('Results are now written in the plain font.'));
  }, 30000);

  it('Examples: Start here comes first; choosing one opens it, solves it and announces it; the student’s last edits stay saved', async () => {
    const engine = realEngine();
    render(<App startup={start(F5)} engine={engine} serviceWorker={false} />);
    await solved();
    // An edit, then at once (before the autosave's wait is over) an example.
    fireEvent.click(part('R1'));
    fireEvent.change(screen.getByRole('textbox', { name: /R1/ }), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Examples' }));
    const menu = await screen.findByRole('menu', { name: 'Examples' }, { timeout: 5000 });
    const items = within(menu).getAllByRole('menuitem');
    expect(items[0]!.textContent).toContain('A 6 V source and two resistors: change R1');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'The 1M trap' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('F3a: the 1M trap'));
    expect(tab('Checks').textContent).toBe('Checks1 found');
    await waitFor(() => expect(polite()).toContain('Opened the example “The 1M trap”.'));
    await waitFor(() => expect(engine.runs.at(-1)).toContain('F3a'), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 700));
    expect(localStorage.getItem('plainspice:netlist')).toContain('R1 n1 0 5');
    // Back to Start here: the sticky note comes back with it.
    fireEvent.click(screen.getByRole('button', { name: 'Examples' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /A 6 V source and two resistors: change R1/ }, { timeout: 5000 }));
    await waitFor(() => expect(screen.getByRole('complementary', { name: 'Change R1 and watch the numbers move' })).toBeTruthy());
  }, 30000);

  it('Ctrl+K: every command in one search; it opens a panel, opens a part’s card, and switches the results’ font', async () => {
    render(<App startup={firstVisit()} engine={realEngine()} serviceWorker={false} />);
    await solved();
    const openPalette = (): HTMLElement => {
      fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
      return screen.getByRole('dialog', { name: 'Commands' });
    };
    let palette = openPalette();
    const input = within(palette).getByRole('combobox', { name: 'Search or run a command' });
    expect(document.activeElement).toBe(input);
    const names = within(palette).getAllByRole('option').map((o) => o.querySelector('.palette__label')?.textContent);
    for (const want of ['Run ngspice now', 'Open the Netlist panel', 'Open the Checks panel', 'Open the Explain panel', 'Open the Numbers panel', 'Open the Plot panel', 'Open the ngspice output panel', 'Share this circuit', 'Netlist for ngspice (.cir)', 'Netlist for LTspice (.net)', 'Change R1, resistor', 'Write results in the plain font', 'Open the settings', 'Open the help']) {
      expect(names.some((n) => n?.startsWith(want)), want).toBe(true);
    }
    fireEvent.change(input, { target: { value: 'numbers' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByRole('dialog', { name: 'Commands' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Numbers' })).toBeTruthy();
    palette = openPalette();
    fireEvent.change(within(palette).getByRole('combobox'), { target: { value: 'change r2' } });
    fireEvent.keyDown(within(palette).getByRole('combobox'), { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: /^R2 resistor/ })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('textbox', { name: /R2/ }), { key: 'Escape' });
    palette = openPalette();
    fireEvent.change(within(palette).getByRole('combobox'), { target: { value: 'plain font' } });
    fireEvent.keyDown(within(palette).getByRole('combobox'), { key: 'Enter' });
    expect(document.querySelector('.app')!.classList.contains('nb-plain')).toBe(true);
    // Escape closes it without running anything.
    palette = openPalette();
    fireEvent.keyDown(within(palette).getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Commands' })).toBeNull();
    // A video's examples are found by the video, accents or not, and named with it; groups are named.
    palette = openPalette();
    fireEvent.change(within(palette).getByRole('combobox'), { target: { value: 'thevenin example 3' } });
    const found = within(palette).getAllByRole('option').map((o) => o.textContent ?? '');
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((o) => o.includes('Thévenin with Dependent Sources'))).toBe(true);
    expect(within(palette).getByRole('group', { name: 'Examples' })).toBeTruthy();
    fireEvent.change(within(palette).getByRole('combobox'), { target: { value: 'norton' } });
    expect(within(palette).getAllByRole('option').some((o) => o.textContent?.includes('from Norton and Source Transformation'))).toBe(true);
    fireEvent.keyDown(within(palette).getByRole('combobox'), { key: 'Escape' });
  }, 30000);

  it('the part tools put a part in hand: the hint says what to do now and how to get out; Escape goes back to Select', async () => {
    render(<App startup={firstVisit()} engine={realEngine()} serviceWorker={false} />);
    await solved();
    const tools = screen.getByRole('toolbar', { name: 'Parts and tools' });
    fireEvent.click(within(tools).getByRole('button', { name: /^Resistor/ }));
    expect(document.querySelector('.hint')!.textContent).toBe('Click the paper to place a resistor · T turns it · M mirrors it · Shift+click places more than one · Esc goes back to Select');
    await waitFor(() => expect(polite()).toContain('A resistor in hand. Click the paper to place a resistor'));
    expect(within(tools).getByRole('button', { name: 'Resistor' }).getAttribute('aria-pressed')).toBe('true');
    // Its buttons, for a pointer without keys: Turn, Mirror, Cancel.
    const hand = screen.getByRole('toolbar', { name: 'Resistor in hand' });
    expect(within(hand).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Turn', 'Mirror', 'Cancel']);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(within(tools).getByRole('button', { name: 'Select' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.hint')!.textContent).toMatch(/^Click a part to see its numbers/);
    // The Wire tool: start on a pin, a wire or a node's name (chosen with a pointer: a pointer's words).
    fireEvent.pointerDown(within(tools).getByRole('button', { name: 'Wire' }));
    fireEvent.click(within(tools).getByRole('button', { name: 'Wire' }));
    expect(document.querySelector('.hint')!.textContent).toBe('Click a pin, a wire or a node’s name to start a wire · Esc goes back to Select');
    // Chosen with its key, the hint gives the keyboard's way: Enter on a node, then Enter on another.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.keyDown(within(tools).getByRole('button', { name: 'Select' }), { key: 'w' });
    expect(document.querySelector('.hint')!.textContent).toBe('Enter on a node starts a wire there, Enter on another node ends it · or click a pin · Esc goes back to Select');
  }, 30000);

  it('adds a resistor across the source from the Add a part form, and ngspice gives its current (no pointer)', async () => {
    const engine = realEngine();
    render(<App startup={firstVisit()} engine={engine} serviceWorker={false} />);
    await solved();
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Parts and tools' })).getByRole('button', { name: 'Add a part' }));
    const form = await screen.findByRole('dialog', { name: 'Add a part' }, { timeout: 5000 });
    // A part goes between two nodes, chosen in words: a 3 kΩ resistor from in to ground.
    fireEvent.change(within(form).getByRole('combobox', { name: 'Part' }), { target: { value: 'R' } });
    fireEvent.change(within(form).getByRole('textbox', { name: 'Value' }), { target: { value: '3k' } });
    fireEvent.change(within(form).getByRole('combobox', { name: 'End 1' }), { target: { value: 'in' } });
    fireEvent.change(within(form).getByRole('combobox', { name: 'End 2' }), { target: { value: '0' } });
    expect(within(form).getByText('R3 in 0 3k')).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'Add R3' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a part' })).toBeNull());
    await waitFor(() => expect(polite()).toContain('R3 added between node in and ground.'));
    // The drawing places it; ngspice solves it with the rest: 6 V across 3 kΩ is 2 mA.
    await waitFor(() => expect(part('R3')).toBeTruthy());
    await waitFor(() => expect(engine.runs.at(-1)).toContain('R3 in 0 3k'), { timeout: 15000 });
    await solved();
    await waitFor(() => expect(describedBy(part('R3'))).toMatch(/2 milliamps? flows? from in to ground through R3|2 milliamps/));
    // One undo takes it away again, and says what it undid.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^R3, / })).toBeNull());
    await waitFor(() => expect(polite()).toContain('Undone: R3 added between node in and ground.'));
  }, 30000);

  it('turns, reverses, moves and deletes the selected part with the keys, each one undo step with its words', async () => {
    const engine = realEngine();
    render(<App startup={firstVisit()} engine={engine} serviceWorker={false} />);
    await solved();
    const r2 = part('R2');
    act(() => r2.focus());
    fireEvent.keyDown(r2, { key: 't' });
    await waitFor(() => expect(polite()).toContain('R2 turned.'));
    // Positions now live in the netlist, the student's lines as they were.
    await waitFor(() => expect(localStorage.getItem('plainspice:netlist')).toMatch(/\*@ R2 \S+ \S+ (90|270)/));
    expect(localStorage.getItem('plainspice:netlist')).toContain('R2 out 0 2k');
    fireEvent.keyDown(part('R2'), { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(part('R2'), { key: 'ArrowRight', shiftKey: true });
    await waitFor(() => expect(polite()).toMatch(/R2 moved\.[\s\S]*R2 moved\./));
    // Reverse swaps its ends in the netlist (the focus on V1 selects it, as in a browser).
    act(() => part('V1').focus());
    fireEvent.keyDown(part('V1'), { key: 'R', shiftKey: true });
    await waitFor(() => expect(localStorage.getItem('plainspice:netlist')).toContain('V1 0 in 6'));
    // Delete: the part's line goes; the focus goes to a neighbour, never lost.
    act(() => part('R2').focus());
    fireEvent.keyDown(part('R2'), { key: 'Delete' });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^R2, / })).toBeNull());
    // Said a moment after the drawing changes (the announcer adds each message 50 ms later, so a
    // screen reader is watching): waited for, not looked for at once (CI on 14 Nov drew it sooner).
    await waitFor(() => expect(polite()).toContain('R2 deleted.'));
    await waitFor(() => expect(document.activeElement?.classList.contains('nb-hit')).toBe(true));
    // Undo goes back step by step: the delete, the reverse, the two moves as one, the turn.
    for (const what of ['R2 deleted.', 'V1 reversed.', 'R2 moved.', 'R2 turned.']) {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await waitFor(() => expect(polite()).toContain(`Undone: ${what}`));
    }
    await waitFor(() => expect(localStorage.getItem('plainspice:netlist')).toBe(START));
  }, 30000);

  it('a node\'s card renames it (and to a name that exists, joins them); ground keeps its name', async () => {
    render(<App startup={firstVisit()} engine={realEngine()} serviceWorker={false} />);
    await solved();
    fireEvent.click(screen.getByRole('button', { name: 'Node out' }));
    const card = screen.getByRole('dialog', { name: /^Node out/ });
    const name = within(card).getByRole('textbox', { name: 'Name of node out' });
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: 'my out' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(within(card).getByText(/PlainSpice keeps node names to the letters a to z \(or A to Z\), digits and _/)).toBeTruthy());
    fireEvent.change(name, { target: { value: 'vout' } });
    fireEvent.submit(name.closest('form')!);
    await waitFor(() => expect(polite()).toContain('Node out renamed to vout.'));
    await waitFor(() => expect(localStorage.getItem('plainspice:netlist')).toContain('R1 in vout 1k'));
    expect(screen.getByRole('button', { name: 'Node vout' })).toBeTruthy();
    // Ground's card says why it keeps its name.
    fireEvent.click(screen.getByRole('button', { name: 'Ground, node 0' }));
    expect(within(screen.getByRole('dialog', { name: /^Ground/ })).getByText('Ground (node 0) keeps its name: in SPICE, the name 0 is what makes a node ground, the node every voltage is measured from.')).toBeTruthy();
  }, 30000);

  it('Undo and Redo across circuits opened from the Examples never save an example over the student’s netlist', async () => {
    const HOMEWORK = '* MY HOMEWORK\nV1 a 0 9\nR1 a 0 3\n.op\n.end\n';
    localStorage.setItem('plainspice:netlist', HOMEWORK);
    render(<App startup={start(HOMEWORK)} engine={realEngine()} serviceWorker={false} />);
    await solved();
    const choose = async (name: string): Promise<void> => {
      fireEvent.click(screen.getByRole('button', { name: 'Examples' }));
      fireEvent.click(await screen.findByRole('menuitem', { name }, { timeout: 5000 }));
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).not.toContain('MY HOMEWORK'));
    };
    await choose('The 1M trap');
    await choose('The 1M trap, fixed: 1meg');
    // Back to the first example, forward again, back and forth: nothing opened is saved.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await new Promise((r) => setTimeout(r, 700));
    expect(localStorage.getItem('plainspice:netlist')).toBe(HOMEWORK);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('MY HOMEWORK'));
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await new Promise((r) => setTimeout(r, 700));
    expect(localStorage.getItem('plainspice:netlist')).toBe(HOMEWORK);
  }, 30000);

  it('while ngspice loads, Run stays Run and the status says so; a load stopped by a new circuit is no failure', async () => {
    let release: () => void = () => undefined;
    let reject: (e: Error) => void = () => undefined;
    const loading = new Promise<number>((resolve, rej) => {
      release = () => resolve(1);
      reject = rej;
    });
    const engine: Engine & { runs: string[] } = {
      runs: [],
      warmUp: () => loading,
      run: async (netlist) => {
        engine.runs.push(netlist);
        return (await ngspice).run(netlist);
      },
      cancel: vi.fn(),
    };
    render(<App startup={firstVisit()} engine={engine} serviceWorker={false} />);
    await waitFor(() => expect(statusLine()).toContain('Loading ngspice…'));
    expect(statusLine()).toContain('The first visit downloads it');
    // However long the download takes, Run is not Stop: there is nothing to stop yet.
    await new Promise((r) => setTimeout(r, 700));
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy();
    expect(engine.runs).toEqual([]);
    release();
    await solved();
    expect(engine.runs).toHaveLength(1);
    void reject;
  }, 30000);

  it('a value typed on a card that SPICE cannot read stays in the field, marked, with why; the netlist keeps its last value', async () => {
    const engine = realEngine();
    render(<App startup={firstVisit()} engine={engine} serviceWorker={false} />);
    await solved();
    fireEvent.click(part('R1'));
    const card = screen.getByRole('dialog', { name: /^R1 resistor/ });
    const field = within(card).getByRole('textbox', { name: /R1/ });
    // Key by key, as a student types a decimal comma.
    for (const value of ['4', '4,', '4,7', '4,7k']) fireEvent.change(field, { target: { value } });
    await waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'), { timeout: 3000 });
    expect(card.textContent).toContain('4,7k: SPICE reads the comma as a space');
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(localStorage.getItem('plainspice:netlist')).toContain('R1 in out 4\n'));
    // Undo: the whole card's change, back to 1k.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(localStorage.getItem('plainspice:netlist')).toContain('R1 in out 1k'));
  }, 30000);
});

describe('<App /> after the words re-check of step B', () => {
  const hint = (): string => document.querySelector('.hint')?.textContent ?? '';
  const node = (name: string): HTMLElement => screen.getByRole('button', { name: `Node ${name}` });

  it('keys that do nothing say why in the hint line; Undo with nothing left replaces an older refusal there (new-6, new-10, new-30)', async () => {
    render(<App startup={firstVisit()} engine={realEngine()} serviceWorker={false} />);
    await solved();
    act(() => node('in').focus());
    // Shift+Up: the name of node in goes only on its own copper (the model's reason, in "name" words).
    fireEvent.keyDown(node('in'), { key: 'ArrowUp', shiftKey: true });
    await waitFor(() => expect(hint()).toBe('The name of node in goes only on its own wires and pins: move it along them.'));
    // Undo and Redo with nothing left: said, and in the hint line in place of the old refusal.
    fireEvent.keyDown(node('in'), { key: 'z', ctrlKey: true });
    await waitFor(() => expect(hint()).toBe('Nothing to undo.'));
    await waitFor(() => expect(polite()).toContain('Nothing to undo.'));
    fireEvent.keyDown(node('in'), { key: 'z', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(hint()).toBe('Nothing to redo.'));
    // Delete on a node: why a node is not deleted by itself, and what to do instead (new-9).
    fireEvent.keyDown(node('in'), { key: 'Delete' });
    await waitFor(() =>
      expect(hint()).toBe(
        'A node can’t be deleted by itself: it is there as long as a part is connected to it. Delete those parts, or disconnect their ends with Connections on their cards (deleting a piece of wire can cut the node in two, but does not remove it).',
      ),
    );
    // T on a node, and on the ground symbol: only a part turns (one answer, which says why).
    fireEvent.keyDown(node('in'), { key: 't' });
    await waitFor(() => expect(hint()).toBe(t('turnOnlyParts')));
    const ground = screen.getByRole('button', { name: 'Ground, node 0' });
    act(() => ground.focus());
    fireEvent.keyDown(ground, { key: 't' });
    await waitFor(() => expect(polite()).toContain(t('turnOnlyParts')));
    expect(t('turnOnlyParts')).toBe('Only a part turns, mirrors or reverses (and a ground symbol turns while it is in hand): a placed ground symbol, a node’s name and a piece of wire stay as they are.');
    // Esc lets go: T and Delete then say how to choose something.
    fireEvent.keyDown(ground, { key: 'Escape' });
    fireEvent.keyDown(ground, { key: 't' });
    await waitFor(() => expect(hint()).toBe('T, M and Shift+R act on the selected part, and none is selected now: click a part, or move to one with the arrow keys.'));
    fireEvent.keyDown(ground, { key: 'Delete' });
    await waitFor(() => expect(hint()).toBe('Nothing is selected to delete: click a part, a ground symbol or a piece of wire, or move to one with the arrow keys.'));
  }, 30000);

  it('Esc clears an older refusal or an edit’s note from the hint line at once, even with nothing left to let go of (the words critic)', async () => {
    render(<App startup={firstVisit()} engine={realEngine()} serviceWorker={false} />);
    await solved();
    // An edit's note (the drawing lines written), then Esc: the hint says what can be done now.
    act(() => part('R2').focus());
    fireEvent.keyDown(part('R2'), { key: 't' });
    await waitFor(() => expect(hint()).toBe(t('drawingWritten')));
    fireEvent.keyDown(part('R2'), { key: 'Escape' });
    await waitFor(() => expect(hint()).not.toBe(t('drawingWritten')));
    const now = hint();
    // Nothing is selected now: Delete says why; Esc has nothing to stop or let go of, and still clears it
    // (well before the refusal's own few seconds).
    fireEvent.keyDown(part('R2'), { key: 'Delete' });
    await waitFor(() => expect(hint()).toBe(t('deleteNothing')));
    fireEvent.keyDown(part('R2'), { key: 'Escape' });
    await waitFor(() => expect(hint()).toBe(now), { timeout: 1000 });
  }, 30000);

  it('T, M and Shift+R on the part in hand are said; an F with no source to read says why at once, without "Not here" (new-35, new-8)', async () => {
    render(<App startup={start('* no V\nI1 0 a 1m\nR1 a 0 1k\n.op\n.end\n')} engine={realEngine()} serviceWorker={false} />);
    await solved();
    const tools = screen.getByRole('toolbar', { name: 'Parts and tools' });
    const resistor = within(tools).getByRole('button', { name: /^Resistor/ });
    fireEvent.click(resistor);
    act(() => resistor.focus());
    fireEvent.keyDown(resistor, { key: 't' });
    await waitFor(() => expect(polite()).toContain('A resistor in hand, turned a quarter turn.'));
    fireEvent.keyDown(resistor, { key: 'm' });
    await waitFor(() => expect(polite()).toContain('A resistor in hand, mirrored.'));
    fireEvent.keyDown(resistor, { key: 'R', shiftKey: true });
    await waitFor(() => expect(polite()).toContain('A resistor in hand, reversed: its two ends swapped.'));
    // The ground symbol has one end and looks the same mirrored: said, not silent.
    fireEvent.keyDown(resistor, { key: '0' });
    fireEvent.keyDown(resistor, { key: 'm' });
    await waitFor(() => expect(polite()).toContain('A ground symbol has one end and looks the same mirrored: T turns it.'));
    // F with no voltage source to read: the reason and the way out, before the pointer is on the paper.
    fireEvent.keyDown(resistor, { key: 'f' });
    const why = 'A current-controlled current source (F) reads the current through a voltage source, and this circuit has none yet: add a voltage source first';
    await waitFor(() => expect(hint()).toBe(`${why} · Esc goes back to Select`));
    await waitFor(() => expect(polite()).toContain(`A current-controlled current source in hand. ${why} · Esc goes back to Select`));
  }, 30000);

  it('the first edit made on the drawing says it wrote the drawing lines; sentences say "node"; Ctrl+K moves a node’s name and the ground symbol (new-15, new-33, new-22, new-29)', async () => {
    render(<App startup={firstVisit()} engine={realEngine()} serviceWorker={false} />);
    await solved();
    act(() => part('R2').focus());
    fireEvent.keyDown(part('R2'), { key: 't' });
    await waitFor(() => expect(polite()).toContain(`R2 turned. ${t('drawingWritten')}`));
    expect(t('drawingWritten')).toBe('The netlist now also says where each part is drawn, in lines starting with *@ that ngspice skips, so the drawing stays as it is.');
    // Seen too, in the hint line for a moment.
    expect(hint()).toBe(t('drawingWritten'));
    await waitFor(() => expect(localStorage.getItem('plainspice:netlist')).toContain('*@ R2'));
    // Once only: the lines are there now.
    fireEvent.keyDown(part('R2'), { key: 'm' });
    await waitFor(() => expect(polite()).toContain('R2 mirrored.'));
    expect(polite()).not.toContain(`R2 mirrored. ${t('drawingWritten')}`);
    // The Wire tool from the keys, Enter on a node: "node out", since a name may be an ordinary word.
    act(() => node('out').focus());
    fireEvent.keyDown(node('out'), { key: 'w' });
    fireEvent.click(node('out'));
    await waitFor(() => expect(polite()).toContain('Wire started at node out.'));
    fireEvent.keyDown(node('out'), { key: 'Escape' });
    fireEvent.keyDown(node('out'), { key: 'Escape' });
    // Ctrl+K has the node card's Move by name: the name of node out, picked up.
    act(() => node('out').focus());
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    let palette = screen.getByRole('dialog', { name: 'Commands' });
    // Its Rename too, said as a sentence says the node (words re-check 4: "Rename node out").
    fireEvent.change(within(palette).getByRole('combobox'), { target: { value: 'rename' } });
    expect(within(palette).getAllByRole('option').map((o) => o.querySelector('.palette__label')?.textContent)).toContain('Rename node out');
    fireEvent.change(within(palette).getByRole('combobox'), { target: { value: 'move the name' } });
    expect(within(palette).getAllByRole('option').map((o) => o.querySelector('.palette__label')?.textContent)).toContain('Move the name of node out');
    fireEvent.keyDown(within(palette).getByRole('combobox'), { key: 'Enter' });
    await waitFor(() => expect(polite()).toContain('The name of node out picked up: click where the name of node out goes · arrow keys move it · Enter puts it down · Esc puts it back'));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(polite()).toContain('The name of node out put back.'));
    // And the ground symbol's.
    const ground = screen.getByRole('button', { name: 'Ground, node 0' });
    act(() => ground.focus());
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    palette = screen.getByRole('dialog', { name: 'Commands' });
    fireEvent.change(within(palette).getByRole('combobox'), { target: { value: 'move the ground' } });
    expect(within(palette).getAllByRole('option').map((o) => o.querySelector('.palette__label')?.textContent)).toContain('Move the ground symbol');
    // Its keys are spelled as Help spells them.
    expect(within(palette).getAllByRole('option').map((o) => o.querySelector('.palette__key')?.textContent)).toContain('Shift+arrow keys');
    // Delete too, as Help and the hints spell it (not "Del").
    fireEvent.change(within(palette).getByRole('combobox'), { target: { value: 'delete the ground' } });
    const deleteGround = within(palette)
      .getAllByRole('option')
      .find((o) => o.querySelector('.palette__label')?.textContent === 'Delete the ground symbol');
    expect(deleteGround?.querySelector('.palette__key')?.textContent).toBe('Delete');
    fireEvent.keyDown(within(palette).getByRole('combobox'), { key: 'Escape' });
  }, 30000);

  it('a value typed on a card that would move a part writes the drawing lines, and says so the first time (new-15)', async () => {
    // A 0 V ammeter given a voltage is drawn as a source: the drawing is kept where it was, in *@ lines.
    const text = stripDrawing(read('examples/sp01/sp01-2-ammeter.cir'));
    render(<App startup={start(text)} engine={realEngine()} serviceWorker={false} />);
    await solved();
    fireEvent.click(part('Vm'));
    const field = within(screen.getByRole('dialog', { name: /^Vm / })).getByRole('textbox');
    fireEvent.change(field, { target: { value: '5' } });
    await waitFor(() => expect(localStorage.getItem('plainspice:netlist') ?? '').toMatch(/^\*@ /m));
    await waitFor(() => expect(polite()).toContain(t('drawingWritten')));
  }, 30000);

  it('a card’s Connections name a part’s ends as ends, and the hint says what can be done there (new-13, new-31)', async () => {
    render(<App startup={firstVisit()} engine={realEngine()} serviceWorker={false} />);
    await solved();
    fireEvent.click(part('R2'));
    const card = screen.getByRole('dialog', { name: /^R2 resistor/ });
    fireEvent.click(within(card).getByRole('button', { name: 'Connections' }));
    await waitFor(() => expect(hint()).toBe('Connect to… makes an end’s node and another node one node · Disconnect gives an end a node of its own · Connections again shows the value and the numbers · Esc closes the card'));
    expect(within(card).getByRole('button', { name: 'Connect to another node: the node at the end 1 of R2' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Disconnect the end 2 of R2 from ground (node 0)' })).toBeTruthy();
    expect(card.textContent).not.toMatch(/node 1|node 2/);
  }, 30000);

  it('the Add a part form says what SPICE reads its value as, or why SPICE cannot use it and the fix, as a card does (new-14)', async () => {
    render(<App startup={firstVisit()} engine={realEngine()} serviceWorker={false} />);
    await solved();
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Parts and tools' })).getByRole('button', { name: 'Add a part' }));
    const form = await screen.findByRole('dialog', { name: 'Add a part' }, { timeout: 5000 });
    const value = within(form).getByRole('textbox', { name: 'Value' }) as HTMLInputElement;
    fireEvent.change(value, { target: { value: '4,7k' } });
    expect(form.textContent).toContain('4,7k: SPICE reads the comma as a space');
    expect(value.getAttribute('aria-invalid')).toBe('true');
    // Add pressed: the reason is seen once (under Value, with its fix), not again above the buttons;
    // the Add button's description and the words said on Add still have it.
    fireEvent.click(within(form).getByRole('button', { name: 'Add a part' }));
    const why = '4,7k: SPICE reads the comma as a space';
    const seen = [...form.querySelectorAll('p')].filter((p) => !p.closest('.visually-hidden') && (p.textContent ?? '').includes(why));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toMatch(/-value-reads$/);
    const addButton = within(form).getByRole('button', { name: 'Add a part' });
    expect(document.getElementById(addButton.getAttribute('aria-describedby') ?? '')?.textContent).toContain(why);
    expect(form.querySelector('.form-line__said')?.textContent).toContain(why);
    fireEvent.click(within(form).getByRole('button', { name: 'Write 4.7k' }));
    expect(value.value).toBe('4.7k');
    expect(form.textContent).toMatch(/SPICE reads it as 4\.7\skΩ/);
    fireEvent.change(value, { target: { value: '1 k' } });
    expect(form.textContent).toContain('1 k: the space splits the value in two');
    // 1M is read, as a milliohm: said, with the check and its fix.
    fireEvent.change(value, { target: { value: '1M' } });
    expect(form.textContent).toMatch(/SPICE reads it as 1\smΩ\s\(milli!\)/);
    expect(form.textContent).toContain('1M means 1 milliohm');
    expect(within(form).getByRole('button', { name: /^Make it 1meg/ })).toBeTruthy();
    // The ends are "End 1" and "End 2" (a part's ends are on nodes).
    expect(within(form).getByRole('combobox', { name: 'End 1' })).toBeTruthy();
  }, 30000);

  it('a run the student asks for is always said, the same words or not; a run after a change only when its numbers change, never for a comment (AP-3, WCAG 4.1.3)', async () => {
    const engine = realEngine();
    render(<App startup={firstVisit()} engine={engine} serviceWorker={false} />);
    await solved();
    await waitFor(() => expect(polite()).toMatch(/Simulation finished/), { timeout: 5000 });
    const finished = heard(/^Simulation finished/);
    // Run in the top bar, on a circuit that has not changed: the same words, said again.
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Actions' })).getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(engine.runs).toHaveLength(2), { timeout: 15000 });
    await waitFor(() => expect(finished.said).toHaveLength(1), { timeout: 5000 });
    expect(finished.said[0]).toBe('Simulation finished: node in is 6 volts, node out is 4 volts; 3 currents.');
    // Ctrl+Enter, from anywhere on the page: said once more.
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(engine.runs).toHaveLength(3), { timeout: 15000 });
    await waitFor(() => expect(finished.said).toHaveLength(2), { timeout: 5000 });
    // A comment typed in the Netlist panel runs again with the same numbers: nothing is said.
    fireEvent.click(tab('Netlist'));
    const view = await editorView();
    act(() => {
      view.dispatch({ changes: { from: view.state.doc.toString().indexOf('.op'), insert: '* a note\n' } });
    });
    await waitFor(() => expect(engine.runs).toHaveLength(4), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 2500));
    expect(finished.said).toHaveLength(2);
    finished.stop();
  }, 30000);

  it('a value changed in a DC sweep is said, with the sweep’s last point as its results card says it, and Run says it again (AP-3)', async () => {
    const engine = realEngine();
    render(<App startup={start(read('tests/fixtures/d1-dc-divider-sweep.cir'))} engine={engine} serviceWorker={false} />);
    await solved();
    await waitFor(() => expect(polite()).toMatch(/Simulation finished/), { timeout: 5000 });
    const finished = heard(/^Simulation finished/);
    // R2 from 2k to 1k on its card: the summary keeps its words ("a DC sweep of 13 points"), the numbers do not.
    fireEvent.click(part('R2'));
    fireEvent.change(screen.getByRole('textbox', { name: /R2/ }), { target: { value: '1k' } });
    await waitFor(() => expect(engine.runs.at(-1)).toContain('R2 out 0 1k'), { timeout: 15000 });
    await waitFor(() => expect(finished.said).toHaveLength(1), { timeout: 5000 });
    // Said with the last point, as the results card says it (native ngspice 47: v(out) = 6 V at V1 = 12 V; 8 V before, at load).
    expect(finished.said[0]).toBe('Simulation finished: a DC sweep of 13 points. When V1 is 12 volts: the voltage at node in is 12 volts, the voltage at node out is 6 volts, the current in V1 is minus 6 milliamps.');
    expect(polite()).toContain('Simulation finished: a DC sweep of 13 points. When V1 is 12 volts: the voltage at node in is 12 volts, the voltage at node out is 8 volts, the current in V1 is minus 4 milliamps.');
    fireEvent.keyDown(screen.getByRole('textbox', { name: /R2/ }), { key: 'Escape' });
    // Run, asked for on the circuit as it is: said again, in the same words.
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Actions' })).getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(finished.said).toHaveLength(2), { timeout: 15000 });
    expect(finished.said[1]).toBe(finished.said[0]);
    finished.stop();
  }, 30000);

  // The summary says four nodes and counts the currents: a change that moves only numbers it does not say
  // keeps its words, and is said all the same (resultsHeard: every number), once. Native ngspice 47 and 42
  // (-b): v(in) = 6 V and v(out) = 4 V with R3 1k or 2k, i(v1) = −8 mA then −5 mA; v(a..d) = 10, 7.5, 5,
  // 2.5 V with R6 1k or 3k, v(e) = 5 V then 7.5 V.
  it('a value change that moves only a current is said, though the summary’s words stay the same (AP-3)', async () => {
    const engine = realEngine();
    const netlist = '* Only the currents change\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\nR3 in 0 1k\n.op\n.end\n';
    const words = 'Simulation finished: node in is 6 volts, node out is 4 volts; 4 currents.';
    render(<App startup={start(netlist)} engine={engine} serviceWorker={false} />);
    await solved();
    await waitFor(() => expect(polite()).toContain(words), { timeout: 5000 });
    const finished = heard(/^Simulation finished/);
    fireEvent.click(part('R3'));
    fireEvent.change(screen.getByRole('textbox', { name: /R3/ }), { target: { value: '2k' } });
    await waitFor(() => expect(engine.runs.at(-1)).toContain('R3 in 0 2k'), { timeout: 15000 });
    await waitFor(() => expect(finished.said).toHaveLength(1), { timeout: 5000 });
    expect(finished.said[0]).toBe(words);
    await new Promise((r) => setTimeout(r, 1500));
    expect(finished.said).toHaveLength(1);
    finished.stop();
  }, 30000);

  it('a value change that moves only a fifth node is said, though the summary names four (AP-3)', async () => {
    const engine = realEngine();
    const netlist = '* Five nodes: only the fifth changes\nV1 a 0 10\nR1 a b 1k\nR2 b c 1k\nR3 c d 1k\nR4 d 0 1k\nR5 a e 1k\nR6 e 0 1k\n.op\n.end\n';
    const words = 'Simulation finished: node a is 10 volts, node b is 7.5 volts, node c is 5 volts, node d is 2.5 volts and 1 more node; 7 currents.';
    render(<App startup={start(netlist)} engine={engine} serviceWorker={false} />);
    await solved();
    await waitFor(() => expect(polite()).toContain(words), { timeout: 5000 });
    const finished = heard(/^Simulation finished/);
    fireEvent.click(part('R6'));
    fireEvent.change(screen.getByRole('textbox', { name: /R6/ }), { target: { value: '3k' } });
    await waitFor(() => expect(engine.runs.at(-1)).toContain('R6 e 0 3k'), { timeout: 15000 });
    await waitFor(() => expect(finished.said).toHaveLength(1), { timeout: 5000 });
    expect(finished.said[0]).toBe(words);
    finished.stop();
  }, 30000);

  it('a circuit opened again from the menu is said again, its words and numbers the same (AP-3)', async () => {
    const engine = realEngine();
    render(<App startup={firstVisit()} engine={engine} serviceWorker={false} />);
    await solved();
    await waitFor(() => expect(polite()).toMatch(/Simulation finished/), { timeout: 5000 });
    const finished = heard(/^Simulation finished/);
    fireEvent.click(screen.getByRole('button', { name: 'Examples' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /A 6 V source and two resistors: change R1/ }, { timeout: 5000 }));
    await waitFor(() => expect(engine.runs).toHaveLength(2), { timeout: 15000 });
    await waitFor(() => expect(finished.said).toHaveLength(1), { timeout: 5000 });
    expect(finished.said[0]).toBe('Simulation finished: node in is 6 volts, node out is 4 volts; 3 currents.');
    finished.stop();
  }, 30000);

  it('Help lists every editing key in the margin’s words, spells Esc one way, and says the screen-reader behaviour is not yet tried (new-21, new-22, new-23, new-24, new-34)', async () => {
    render(<App startup={firstVisit()} engine={realEngine()} serviceWorker={false} />);
    await solved();
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    const dialog = await screen.findByRole('dialog', { name: 'Help' }, { timeout: 5000 });
    const keys = within(dialog).getByRole('table', { name: 'Keyboard shortcuts' });
    const editing = within(dialog).getByRole('table', { name: 'Editing the drawing (on the drawing or in the margin)' });
    const rows = within(editing).getAllByRole('row').map((r) => r.querySelector('th')?.textContent ?? '');
    for (const want of ['T, M, Shift+R (on a card); Delete (on its buttons)', '0–9, ., +, − (on a card’s buttons or title)', 'Arrow keys, Enter, Esc (with something picked up by Move)', 'Shift+arrow keys']) expect(rows).toContain(want);
    expect(editing.textContent).toContain('in the value field it erases the value');
    expect(keys.textContent).toContain('R, C, L, V, I, E–H, W, 0 (on the drawing or in the margin)');
    expect(keys.textContent).toContain('W chooses the Wire tool');
    expect(`${keys.textContent}${editing.textContent}`).not.toMatch(/Escape|the parts\)/);
    expect(dialog.textContent).toContain('This is not yet tried with a real screen reader.');
  }, 30000);
});
