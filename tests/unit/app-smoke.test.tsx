// @vitest-environment jsdom
/**
 * The whole app in jsdom: <App /> with the real editor (CodeMirror), the real parser, trap checks,
 * explanations and descriptions, and the real ngspice (WebAssembly, run in Node instead of a Web
 * Worker, behind the app's Engine interface). Layout, focus and axe are checked in a real browser;
 * here the point is that the pieces are wired together: start-up, typing, checks with a fix, a run
 * with its results table and announcement, the dialogs, and share links.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { App } from '../../src/app/App.tsx';
import type { Engine } from '../../src/app/engine.ts';
import type { StartupDecision } from '../../src/app/startup.ts';
import { EngineCancelledError } from '../../src/engine/client.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { encodeShare } from '../../src/share/link.ts';

const root = resolve(import.meta.dirname, '../..');
const fixture = (name: string): string => readFileSync(resolve(root, 'tests/fixtures', name), 'utf8');
const F5 = fixture('f5-thevenin-cccs.cir');
const F3A = fixture('f3a-1M-trap.cir');

let ngspice: Promise<NgspiceEngine>;

beforeAll(() => {
  // jsdom has no layout; CodeMirror measures text with these (as in editor-api.test.ts).
  const empty = (): DOMRectList => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  const rect = (): DOMRect => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = empty;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = rect;
  // A compiled module, not bytes: Node's Buffer is from another realm under jsdom.
  ngspice = WebAssembly.compile(readFileSync(resolve(root, 'engine/dist/ngspice.wasm'))).then((m) =>
    NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, m),
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

/** The real ngspice behind the app's Engine interface (no Worker in jsdom). */
function realEngine(): Engine & { runs: string[] } {
  const runs: string[] = [];
  return {
    runs,
    warmUp: async () => {
      await ngspice;
      return 1;
    },
    run: async (netlist) => {
      runs.push(netlist);
      return (await ngspice).run(netlist);
    },
    cancel: () => undefined,
  };
}

function start(netlist: string, extra: Partial<Extract<StartupDecision, { source: 'share' }>> = {}): StartupDecision {
  return extra.run !== undefined ? { source: 'share', netlist, run: extra.run } : { source: 'example', netlist, exampleId: 'test' };
}

function editorText(): string {
  return document.querySelector('.cm-content')?.textContent ?? '';
}

describe('<App />', () => {
  it('renders the page: landmarks, one h1, the toolbar with Run first, the editor, the tabs, the footer', async () => {
    render(<App startup={start(F5)} engine={realEngine()} serviceWorker={false} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('contentinfo')).toBeTruthy();
    const toolbar = screen.getByRole('toolbar', { name: 'Netlist actions' });
    expect(within(toolbar).getAllByRole('button').map((b) => b.textContent)).toEqual(['Run', 'Examples', 'Share', 'Export', 'Settings', 'Help']);
    const editor = screen.getByRole('textbox', { name: 'Netlist' });
    expect(editor.getAttribute('aria-describedby')).toBe('netlist-hint');
    expect(editorText()).toContain('F5: Thevenin');
    // Run comes before the editor in the page (and so in the tab order).
    expect(screen.getByRole('button', { name: 'Run' }).compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Checks (0)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Results', selected: true })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Plot' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Engine check' }).getAttribute('href')).toBe('./spike/');
    expect(screen.getByRole('link', { name: 'Licences and source' }).getAttribute('href')).toBe('./licenses/');
    // "This line" explains line 1 (the title) before the cursor moves.
    expect(screen.getByRole('heading', { name: 'This line' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/ngspice is ready/)).toBeTruthy());
  });

  it('runs F5 through ngspice: v(a) = 14 V in the table, spoken with units, announced, notes on the lines', async () => {
    const engine = realEngine();
    render(<App startup={start(F5)} engine={engine} serviceWorker={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const table = await screen.findByRole('table', { name: /Node voltages/ }, { timeout: 15000 });
    const rowA = within(table).getByRole('row', { name: /^a / });
    expect(rowA.textContent).toContain('14 V');
    expect(rowA.textContent).toContain('14 volts'); // the visually hidden words
    expect(rowA.textContent).toContain('v(a) = 1.400000e+01');
    expect(engine.runs).toEqual([F5]);
    expect(screen.getByText('Finished')).toBeTruthy();
    const currents = screen.getByRole('table', { name: 'Currents' });
    expect(within(currents).getByRole('row', { name: /Vx/ }).textContent).toContain('from a to x');
    await waitFor(() => expect(screen.getByTestId('live-polite').textContent).toMatch(/Simulation finished/));
    // The results on the netlist lines (inline notes from annotateLines).
    await waitFor(() => expect(editorText()).toContain('a → x'));
    // The raw output and the command.
    fireEvent.click(screen.getByRole('tab', { name: 'ngspice output' }));
    expect(screen.getByText('ngspice -b -r out.raw circuit.cir')).toBeTruthy();
  }, 30000);

  it('Ctrl+Enter runs from anywhere on the page (not only in the editor), but not inside a dialog', async () => {
    const engine = realEngine();
    render(<App startup={start(F5)} engine={engine} serviceWorker={false} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Results' }), { key: 'Enter', ctrlKey: true });
    await screen.findByRole('table', { name: /Node voltages/ }, { timeout: 15000 });
    expect(engine.runs).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    const dialog = await screen.findByRole('dialog', { name: 'Help' }, { timeout: 5000 });
    fireEvent.keyDown(within(dialog).getAllByRole('button', { name: 'Close' })[0]!, { key: 'Enter', metaKey: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(engine.runs).toHaveLength(1);
  }, 30000);

  it('the 1M trap: the Checks tab shows it with its fix; the fix rewrites the line and the checks run again', async () => {
    render(<App startup={start(F3A)} engine={realEngine()} serviceWorker={false} />);
    expect(screen.getByRole('tab', { name: 'Checks (1)', selected: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to line 3 in the netlist' })).toBeTruthy();
    expect(screen.getByText(/What ngspice does:/)).toBeTruthy();
    const fix = screen.getByRole('button', { name: /1meg/ });
    fireEvent.click(fix);
    expect(editorText()).toContain('R1 n1 n2 1meg');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Checks (0)' })).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('live-polite').textContent).toMatch(/No traps found/));
  });

  it('a netlist without an analysis line is not run; the app says why and shows the checks', async () => {
    const engine = realEngine();
    render(<App startup={start('* no analysis\nV1 a 0 6\nR1 a 0 2\n.end\n')} engine={engine} serviceWorker={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByText('Nothing to run yet')).toBeTruthy();
    expect(engine.runs).toEqual([]);
    expect(screen.getByRole('tab', { name: /^Checks/, selected: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add \.op/ })).toBeTruthy();
  });

  it('when ngspice’s DC solution fails, the numbers are not shown as answers', async () => {
    // "ground" is an ordinary node name (docs/spice-facts W13): ngspice warns "singular matrix".
    render(<App startup={start('* ground word\nV1 a ground 6\nR1 a ground 2\n.op\n.end\n')} engine={realEngine()} serviceWorker={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByText('Not reliable', {}, { timeout: 15000 })).toBeTruthy();
    const folded = screen.getByText('What ngspice printed anyway').closest('details');
    expect(folded).toBeTruthy();
    expect(folded!.open).toBe(false);
    // The only node table is the folded one.
    for (const table of screen.queryAllByRole('table', { hidden: true })) expect(folded!.contains(table)).toBe(true);
    expect(screen.getByText('Messages from ngspice')).toBeTruthy();
  }, 30000);

  it('a share link with run=1 opens the circuit and runs it once the engine is warm', async () => {
    const engine = realEngine();
    const netlist = '* from a link\nV1 n1 0 6\nR1 n1 0 2\n.op\n.end\n';
    render(<App startup={start(netlist, { run: true })} engine={engine} serviceWorker={false} />);
    expect(editorText()).toContain('from a link');
    await screen.findByRole('table', { name: /Node voltages/ }, { timeout: 15000 });
    expect(engine.runs).toEqual([netlist]);
    expect(localStorage.getItem('plainspice:netlist')).toBe(netlist);
  }, 30000);

  it('a share link pasted into the address (hashchange) opens; a broken one says why', async () => {
    render(<App startup={start(F5)} engine={realEngine()} serviceWorker={false} />);
    const fragment = await encodeShare('* pasted\nV1 n1 0 6\nR1 n1 0 2\n.op\n.end\n');
    // Setting location.hash makes jsdom fire 'hashchange', as a browser does.
    act(() => {
      location.hash = fragment;
    });
    await waitFor(() => expect(editorText()).toContain('pasted'));
    await waitFor(() => expect(location.hash).toBe('')); // removed once open, so a reload keeps edits
    act(() => {
      location.hash = 'c=q999';
    });
    expect(await screen.findByText('The link could not be opened')).toBeTruthy();
    expect(screen.getByText(/made by a newer version of PlainSpice/)).toBeTruthy();
    expect(editorText()).toContain('pasted'); // the circuit stays
    // A skip-link fragment is no share link: nothing happens.
    act(() => {
      location.hash = 'main';
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.getAllByText('The link could not be opened')).toHaveLength(1);
    expect(editorText()).toContain('pasted');
  });

  it('Stop cancels a slow run; Run says "Running…" first, then becomes Stop', async () => {
    let reject: (e: Error) => void = () => undefined;
    const engine: Engine = {
      warmUp: async () => 1,
      run: () => new Promise((_resolve, rej) => (reject = rej)),
      cancel: vi.fn(() => reject(new EngineCancelledError('The simulation was stopped.'))),
    };
    render(<App startup={start(F5)} engine={engine} serviceWorker={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByRole('button', { name: 'Running…' })).toBeTruthy();
    const stop = await screen.findByRole('button', { name: 'Stop' }, { timeout: 2000 });
    fireEvent.click(stop);
    expect(engine.cancel).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('The simulation was stopped.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy();
  });

  it('Settings: choosing a text size applies it to <html> and remembers it', async () => {
    render(<App startup={start(F5)} engine={realEngine()} serviceWorker={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Settings' }, { timeout: 5000 });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Extra large (150 %)' }));
    expect(document.documentElement.getAttribute('data-text-size')).toBe('x-large');
    expect(JSON.parse(localStorage.getItem('plainspice:settings') ?? '{}')).toMatchObject({ textSize: 'x-large' });
    fireEvent.click(within(dialog).getAllByRole('radio', { name: 'Follow my device' })[0]!);
    expect(document.documentElement.hasAttribute('data-text-size')).toBe(false);
  });

  it('Examples: choosing one opens it in the editor and announces it', async () => {
    render(<App startup={start(F5)} engine={realEngine()} serviceWorker={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Examples' }));
    const item = await screen.findByRole('menuitem', { name: 'The 1M trap' }, { timeout: 5000 });
    fireEvent.click(item);
    await waitFor(() => expect(editorText()).toContain('F3a: the 1M trap'));
    expect(screen.getByRole('tab', { name: 'Checks (1)', selected: true })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('live-polite').textContent).toContain('Opened the example “The 1M trap”.'));
  });

  it('typing: the checks follow the text, and the new count is announced after a pause', async () => {
    render(<App startup={start(F5)} engine={realEngine()} serviceWorker={false} />);
    const editor = document.querySelector('.cm-content') as HTMLElement;
    // Type a beginner trap through CodeMirror's own input path.
    const { EditorView } = await import('@codemirror/view');
    const view = EditorView.findFromDOM(editor)!;
    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: 'R9 a 0 1M\n' } });
    });
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Checks \([1-9]/ })).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('live-polite').textContent).toMatch(/checks? found/), { timeout: 3000 });
    expect(localStorage.getItem('plainspice:netlist')).toContain('R9 a 0 1M');
  });
});
