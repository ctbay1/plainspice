/**
 * PlainSpice: the app shell. It wires the plain-TypeScript modules together and renders them with
 * React Aria Components (decision 0002); it computes nothing about circuits itself.
 *
 *   editor (src/editor)  --typing-->  parse + trap checks + explanations (src/spice), debounced
 *   Run  -->  EngineClient (ngspice in a Web Worker)  -->  interpretPlots  -->  describe  -->  tables,
 *             inline notes on the netlist lines, plots (src/plot, lazy), a live announcement
 *   Share / Export / Examples / Settings / Help: lazy-loaded overlays
 *
 * Layout: a header (the mark, the name, the toolbar with Run first), then the netlist with the
 * "This line" card on the left and the tabs (Checks, Results, Plot, Explained, ngspice output) on
 * the right; one column on a phone.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode, type RefObject } from 'react';
import { I18nProvider, Tab, TabList, TabPanel, Tabs } from 'react-aria-components';
import type { PlainSpiceEditor } from '../editor/index.ts';
import { interpretPlots } from '../engine/results.ts';
import { downloadFile, exportLtspice, exportNgspice } from '../export/export.ts';
import { LOCALE, t, tn } from '../i18n/index.ts';
import { decodeShare } from '../share/link.ts';
import type { Fix, Span, Trap } from '../spice/types.ts';
import { AnnouncerProvider, useAnnounce } from './announcer.tsx';
import { AppToolbar, preloadOverlays } from './components/AppToolbar.tsx';
import { ChecksPanel } from './components/ChecksPanel.tsx';
import { ExplainedPanel } from './components/ExplainedPanel.tsx';
import { Mark } from './components/Icons.tsx';
import { NetlistEditor, type CreateEditor } from './components/NetlistEditor.tsx';
import { Notice } from './components/Notice.tsx';
import { OutputPanel } from './components/OutputPanel.tsx';
import { PlotPanel } from './components/PlotPanel.tsx';
import { ResultsPanel } from './components/ResultsPanel.tsx';
import { ThisLine } from './components/ThisLine.tsx';
import { UpdateBanner } from './components/UpdateBanner.tsx';
import { isCancelled, isTimeout, RUN_TIMEOUT_MS, type Engine } from './engine.ts';
import { exampleById, exampleName } from './examples.ts';
import { annotateLines, checkTraps, describeResults, netlistToRun, parseNetlist } from './model.ts';
import { nodeColours, sameColours } from './nodes.ts';
import type { ExportKind } from './overlays/ExportMenu.tsx';
import { registerServiceWorker } from './pwa.ts';
import { applySettings, DEFAULT_SETTINGS, saveSettings, type Settings } from './settings.ts';
import { clearShareFragment, type StartupDecision } from './startup.ts';
import { hasSweeps, initialState, reducer, tabAfterRun, type EngineStatus, type TabKey } from './state.ts';
import { STORAGE_KEYS, writeStored } from './storage.ts';
import { useDebounced, whenIdle } from './timing.ts';

export interface AppProps {
  startup: StartupDecision;
  engine: Engine;
  /** The editor factory (tests may pass their own). */
  createEditor?: CreateEditor;
  initialSettings?: Settings;
  /** Register the service worker (off in tests). */
  serviceWorker?: boolean;
}

/** Typing pauses before the netlist is read again, the checks count is announced, the text saved. */
const PARSE_DELAY_MS = 150;
const ANNOUNCE_CHECKS_DELAY_MS = 1000;
const SAVE_DELAY_MS = 500;
/** A run that takes longer than this turns Run into Stop. */
const SLOW_RUN_MS = 300;

export function App(props: AppProps): ReactNode {
  return (
    <I18nProvider locale={LOCALE}>
      <AnnouncerProvider>
        <Shell {...props} />
      </AnnouncerProvider>
    </I18nProvider>
  );
}

function engineText(engine: EngineStatus): string {
  switch (engine.status) {
    case 'waiting':
      return t('engineWaiting');
    case 'loading':
      return t('engineLoading');
    case 'ready':
      return t('engineReady');
    case 'failed':
      return t('engineFailed', { reason: engine.reason });
  }
}

function Shell({ startup, engine, createEditor, initialSettings, serviceWorker = true }: AppProps): ReactNode {
  const announce = useAnnounce();
  const editorRef = useRef<PlainSpiceEditor | null>(null);
  const [state, dispatch] = useReducer(reducer, startup.netlist, (text: string) => {
    const netlist = parseNetlist(text);
    return initialState(netlist, checkTraps(netlist), nodeColours(netlist));
  });
  // The newest state for callbacks that outlive a render (the editor's, the engine's).
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });
  const [settings, setSettings] = useState<Settings>(initialSettings ?? DEFAULT_SETTINGS);
  const [update, setUpdate] = useState<(() => void) | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);

  // ------------------------------------------------------------------ reading the netlist
  const shownColours = useRef<Map<string, string>>(new Map());
  const announcedChecks = useRef(state.traps.length);
  const latestTraps = useRef<Trap[]>(state.traps);

  const fixRef = useRef<(fix: Fix) => void>(() => undefined);
  const syncEditor = useCallback((traps: Trap[], colours: Map<string, string>) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setTraps(traps, (fix) => fixRef.current(fix));
    if (!sameColours(shownColours.current, colours)) {
      editor.setNodeColours(colours);
      shownColours.current = colours;
    }
  }, []);

  /** Read the editor's text now: parse, check for traps, colour the nodes. */
  const reparse = useCallback((): Trap[] => {
    const editor = editorRef.current;
    if (!editor) return latestTraps.current;
    const netlist = parseNetlist(editor.getDoc());
    const traps = checkTraps(netlist);
    const colours = nodeColours(netlist);
    latestTraps.current = traps;
    dispatch({ type: 'parsed', netlist, traps, colours });
    syncEditor(traps, colours);
    return traps;
  }, [syncEditor]);

  const parseSoon = useDebounced(reparse, PARSE_DELAY_MS);
  // The editor may be gone when a waiting save is flushed on unmount: keep the text it last had.
  const lastText = useRef(startup.netlist);
  const saveSoon = useDebounced(
    () => {
      const editor = editorRef.current;
      if (editor) lastText.current = editor.getDoc();
      writeStored(STORAGE_KEYS.netlist, lastText.current);
    },
    SAVE_DELAY_MS,
    { flushOnUnmount: true },
  );
  // Said only after a pause in typing, and only when the number of checks changed.
  const announceChecksSoon = useDebounced(() => {
    const count = latestTraps.current.length;
    if (count === announcedChecks.current) return;
    announcedChecks.current = count;
    announce(tn('checksCount', count));
  }, ANNOUNCE_CHECKS_DELAY_MS);


  const applyFix = useCallback(
    (fix: Fix) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.applyChanges(fix.changes);
      parseSoon.cancel();
      const traps = reparse(); // check again at once, so the list shows the result of the fix
      announcedChecks.current = traps.length;
      announce(`${t('fixApplied', { label: fix.label })}. ${tn('checksCount', traps.length)}`);
    },
    [announce, parseSoon, reparse],
  );
  useLayoutEffect(() => {
    fixRef.current = applyFix;
  });

  const goToLine = useCallback((line: number, span?: Span) => editorRef.current?.goToLine(line, span), []);

  // "Show the checks" and "Show the plot" sit inside the Results panel, which goes away when the
  // other tab opens: focus moves to that tab instead of falling to the page (WCAG 2.4.3). Discrete
  // events (a press) are rendered before the timer fires, so the tab is selected by then.
  const checksTab = useRef<HTMLDivElement>(null);
  const plotTab = useRef<HTMLDivElement>(null);
  const showTab = useCallback((tab: TabKey, element: RefObject<HTMLDivElement | null>) => {
    dispatch({ type: 'tab', tab });
    setTimeout(() => element.current?.focus(), 0);
  }, []);

  // ------------------------------------------------------------------ the engine
  const warming = useRef<Promise<void> | null>(null);
  const warmUp = useCallback((): Promise<void> => {
    if (!warming.current) {
      dispatch({ type: 'engine', engine: { status: 'loading' } });
      warming.current = engine.warmUp().then(
        (loadMs) => dispatch({ type: 'engine', engine: { status: 'ready', loadMs } }),
        (error: unknown) => {
          warming.current = null;
          const reason = error instanceof Error ? error.message : String(error);
          dispatch({ type: 'engine', engine: { status: 'failed', reason } });
          announce(t('engineFailed', { reason }), 'assertive');
        },
      );
    }
    return warming.current;
  }, [engine, announce]);

  /** After Stop or a time-out the Worker is gone: load ngspice again, when the browser is idle. */
  const restartEngine = useCallback(() => {
    warming.current = null;
    dispatch({ type: 'engine', engine: { status: 'waiting' } });
    whenIdle(() => void warmUp());
  }, [warmUp]);

  const runningRef = useRef(false);
  /** Set when a new circuit replaces the one running: its cancelled run then reports nothing. */
  const replacedRun = useRef(false);
  const run = useCallback(async (): Promise<void> => {
    const editor = editorRef.current;
    if (!editor || runningRef.current) return;
    parseSoon.flush();
    const text = editor.getDoc();
    const netlist = parseNetlist(text);
    if (netlist.analyses.length === 0) {
      dispatch({ type: 'notice', notice: { tone: 'info', title: t('noAnalysisTitle'), text: t('noAnalysis') } });
      dispatch({ type: 'tab', tab: 'checks' });
      announce(t('noAnalysis'));
      return;
    }
    const traps = checkTraps(netlist);
    runningRef.current = true;
    dispatch({ type: 'run-start' });
    const slow = setTimeout(() => dispatch({ type: 'run-slow' }), SLOW_RUN_MS);
    try {
      await warmUp();
      // For .op, the copy that runs also saves every part's current (src/spice/run-netlist.ts).
      const toRun = netlistToRun(netlist);
      const result = await engine.run(toRun.text, RUN_TIMEOUT_MS);
      const results = interpretPlots(result.plots);
      const description = describeResults(netlist, results, result);
      dispatch({ type: 'run-done', result, results, description, netlist, added: toRun.added, tab: tabAfterRun(result, traps) });
      // Results go on the netlist lines only while the text is still the one that ran (annotateLines
      // gives none when the numbers are not answers).
      if (editor.getDoc() === text) editor.setInlineNotes(annotateLines(netlist, results, result));
      // describe.ts writes the summary for exactly this: one paragraph for a polite live region.
      if (description.summary) announce(description.summary);
      else if (description.status === 'unreliable') announce(t('announceUnreliable'));
      else if (description.status === 'ok') announce(t('announceFinished', { summary: '' }));
      else announce(t('announceError', { detail: result.diagnostics.find((d) => d.severity === 'error')?.text ?? '' }));
    } catch (error) {
      if (isCancelled(error) && replacedRun.current) {
        dispatch({ type: 'run-abandoned' });
      } else if (isCancelled(error)) {
        dispatch({ type: 'run-stopped' });
        announce(t('announceStopped'));
      } else {
        const reason = error instanceof Error ? error.message : String(error);
        dispatch({ type: 'run-failed', reason });
        announce(t('announceFailed', { reason }), 'assertive');
      }
      if (isCancelled(error) || isTimeout(error)) restartEngine();
    } finally {
      clearTimeout(slow);
      runningRef.current = false;
      replacedRun.current = false;
    }
  }, [announce, engine, parseSoon, restartEngine, warmUp]);

  const stop = useCallback(() => engine.cancel(), [engine]);

  // ------------------------------------------------------------------ loading a circuit
  const load = useCallback(
    (text: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      if (runningRef.current) {
        replacedRun.current = true; // the running circuit is being replaced
        engine.cancel();
      }
      editor.setDoc(text);
      dispatch({ type: 'loaded' });
      parseSoon.cancel();
      const traps = reparse();
      announcedChecks.current = traps.length;
      dispatch({ type: 'tab', tab: traps.length ? 'checks' : 'results' });
      saveSoon.cancel();
      writeStored(STORAGE_KEYS.netlist, text);
    },
    [engine, parseSoon, reparse, saveSoon],
  );

  const onExample = useCallback(
    (id: string) => {
      const example = exampleById(id);
      if (!example) return;
      load(example.netlist);
      announce(t('exampleLoaded', { name: exampleName(example) }));
    },
    [announce, load],
  );

  const onExport = useCallback(
    (kind: ExportKind) => {
      const text = editorRef.current?.getDoc() ?? '';
      if (kind === 'ngspice') {
        const file = exportNgspice(text);
        downloadFile(file);
        announce(t('saved', { filename: file.filename }));
        return;
      }
      const file = exportLtspice(text);
      downloadFile(file);
      dispatch({
        type: 'notice',
        notice: { tone: 'info', title: t('ltspiceNotesTitle', { filename: file.filename }), text: t('ltspiceNotesIntro'), items: file.notes },
      });
      announce(t('saved', { filename: file.filename }));
    },
    [announce],
  );

  const getNetlist = useCallback(() => editorRef.current?.getDoc() ?? '', []);

  const onSettings = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
    applySettings(next);
  }, []);

  // ------------------------------------------------------------------ start-up (once)
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (startup.source === 'share') {
      clearShareFragment();
      writeStored(STORAGE_KEYS.netlist, startup.netlist);
      announce(t('shareOpened'));
    } else if (startup.problem) {
      dispatch({ type: 'notice', notice: { tone: 'problem', title: t('shareProblemTitle'), text: startup.problem } });
      announce(startup.problem);
    }
    whenIdle(() => {
      void warmUp().then(() => {
        if (startup.source === 'share' && startup.run) void run();
      });
      // Fetch the menus' and dialogs' code now, so they open at once later.
      preloadOverlays().catch(() => undefined); // offline before they were cached: they load on first use
    });
    if (serviceWorker) {
      void registerServiceWorker({
        onNeedRefresh: (reload) => {
          setUpdate(() => reload);
          announce(t('updateReady')); // the banner appears at the top; say so where the student is
        },
        // Shown quietly in the footer: worth knowing, not worth interrupting a screen reader.
        onOfflineReady: () => setOfflineReady(true),
      });
    }
    // Once, on purpose: the start-up decision never changes (the ref also guards React's double
    // effects in development).
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A share link pasted into the address bar changes only the fragment. Decoding is asynchronous,
  // so only the newest change counts (an older, slower decode must not replace a newer link).
  const hashChanges = useRef(0);
  useEffect(() => {
    const onHashChange = (): void => {
      const change = ++hashChanges.current;
      void decodeShare(location.hash).then((r) => {
        if (change !== hashChanges.current) return;
        if (r.ok) {
          load(r.netlist);
          clearShareFragment();
          announce(t('shareOpened'));
          if (r.run) void warmUp().then(() => run());
        } else if (r.code !== 'no-circuit') {
          dispatch({ type: 'notice', notice: { tone: 'problem', title: t('shareProblemTitle'), text: r.reason } });
          announce(r.reason);
        }
      });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [announce, load, run, warmUp]);

  // Keep the last edits when the page is closed before the autosave fires.
  useEffect(() => {
    const flush = (): void => saveSoon.flush();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [saveSoon]);

  // ------------------------------------------------------------------ editor callbacks
  const editorHandlers = useMemo(
    () => ({
      onChange: (doc: string) => {
        lastText.current = doc;
        dispatch({ type: 'text-changed' });
        parseSoon();
        announceChecksSoon();
        saveSoon();
      },
      onRun: () => void run(),
      onCursorLine: (line: number) => dispatch({ type: 'cursor', line }),
      // A new editor has no traps or colours yet: show the current ones.
      onReady: () => {
        shownColours.current = new Map();
        syncEditor(stateRef.current.traps, stateRef.current.colours);
      },
    }),
    [announceChecksSoon, parseSoon, run, saveSoon, syncEditor],
  );

  // Ctrl+Enter (Cmd+Enter) runs from anywhere on the page, as the Run button says (aria-keyshortcuts).
  // Caught before React Aria sees it (capture phase): a focused tab or button would otherwise take
  // the Enter as a press. Menus and dialogs keep their keys. The editor is included on purpose:
  // CodeMirror's own Ctrl+Enter is lost in Chrome for Android with a keyboard attached (it holds
  // every Enter back and sends it again later without Ctrl, so a line break is typed instead).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.isComposing) return;
      if (e.target instanceof Element && e.target.closest('[role=dialog], [role=menu]')) return;
      e.preventDefault();
      e.stopPropagation();
      void run();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [run]);

  // ------------------------------------------------------------------ render
  const plotAvailable = hasSweeps(state.outcome);
  const tab: TabKey = state.tab === 'plot' && !plotAvailable ? 'results' : state.tab;
  const outcome = state.outcome;

  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          editorRef.current?.focus();
        }}
      >
        {t('skipToNetlist')}
      </a>
      {update && <UpdateBanner onReload={update} />}
      <header className="app-header">
        <div className="brand">
          <Mark />
          <div>
            <h1 className="brand__name">{t('appName')}</h1>
            <p className="brand__tagline">{t('tagline')}</p>
          </div>
        </div>
        <div className="header-actions">
          <AppToolbar
            running={state.running}
            onRun={() => void run()}
            onStop={stop}
            onExample={onExample}
            onExport={onExport}
            getNetlist={getNetlist}
            settings={settings}
            onSettings={onSettings}
          />
          <p className={`engine engine--${state.engine.status}`}>
            <span className="engine__dot" aria-hidden="true" />
            {engineText(state.engine)}
          </p>
        </div>
      </header>

      <main id="main" className="layout" tabIndex={-1}>
        <section className="pane pane--netlist" aria-labelledby="netlist-heading">
          <h2 id="netlist-heading" className="pane__title">
            {t('netlistHeading')}
          </h2>
          {state.notice && (
            <Notice
              notice={state.notice}
              onDismiss={() => {
                // The message (and its button) goes away: continue in the netlist right below it,
                // not at the top of the page.
                editorRef.current?.focus();
                dispatch({ type: 'notice', notice: null });
              }}
            />
          )}
          <NetlistEditor initialDoc={startup.netlist} editorRef={editorRef} handlers={editorHandlers} {...(createEditor ? { create: createEditor } : {})} />
          <ThisLine netlist={state.netlist} line={state.cursorLine} />
        </section>

        <section className="pane pane--results" aria-label={t('tabsLabel')}>
          <Tabs className="tabs" selectedKey={tab} onSelectionChange={(key) => dispatch({ type: 'tab', tab: key as TabKey })}>
            <TabList className="tab-list" aria-label={t('tabsLabel')}>
              <Tab id="checks" className="tab" ref={checksTab}>
                {t('tabChecks', { count: state.traps.length })}
              </Tab>
              <Tab id="results" className="tab">
                {t('tabResults')}
              </Tab>
              {plotAvailable && (
                <Tab id="plot" className="tab" ref={plotTab}>
                  {t('tabPlot')}
                </Tab>
              )}
              <Tab id="explained" className="tab">
                {t('tabExplained')}
              </Tab>
              <Tab id="output" className="tab">
                {t('tabOutput')}
              </Tab>
            </TabList>
            <TabPanel id="checks" className="tab-panel">
              <ChecksPanel traps={state.traps} onGoToLine={(trap) => goToLine(trap.line, trap.span)} onFix={applyFix} />
            </TabPanel>
            <TabPanel id="results" className="tab-panel">
              <ResultsPanel
                outcome={outcome}
                running={state.running !== null}
                traps={state.traps}
                colours={state.colours}
                plotAvailable={plotAvailable}
                onGoToLine={(line) => goToLine(line)}
                onShowChecks={() => showTab('checks', checksTab)}
                onShowPlot={() => showTab('plot', plotTab)}
              />
            </TabPanel>
            {plotAvailable && outcome.kind === 'done' && (
              <TabPanel id="plot" className="tab-panel">
                <PlotPanel results={outcome.results} netlist={outcome.netlist} />
              </TabPanel>
            )}
            <TabPanel id="explained" className="tab-panel">
              <ExplainedPanel netlist={state.netlist} />
            </TabPanel>
            <TabPanel id="output" className="tab-panel">
              <OutputPanel result={outcome.kind === 'done' ? outcome.result : undefined} added={outcome.kind === 'done' ? outcome.added : []} />
            </TabPanel>
          </Tabs>
        </section>
      </main>

      <footer className="app-footer">
        <ul className="footer-links">
          <li>{t('footerEngine')}</li>
          <li>
            <a href="./spike/">{t('footerEngineCheck')}</a>
          </li>
          <li>
            <a href="./licenses/">{t('footerLicences')}</a>
          </li>
          <li>
            <a href="https://github.com/ctbay1/plainspice">{t('footerSource')}</a>
          </li>
          {offlineReady && <li>{t('offlineReady')}</li>}
        </ul>
      </footer>
    </>
  );
}
