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
import { LOCALE, t, tn } from '../i18n/index.ts';
import { decodeShare } from '../share/link.ts';
import type { Fix, Netlist, Span, Trap } from '../spice/types.ts';
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
import { annotateLines, checkTraps, describeResults, loadDescribe, netlistToRun, parseNetlist, pointsAskedFor } from './model.ts';
import { nodeColours, sameColours } from './nodes.ts';
import type { ExportKind } from './overlays/ExportMenu.tsx';
import { checkForUpdate, registerServiceWorker } from './pwa.ts';
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

const loadExport = (): Promise<typeof import('../export/export.ts')> => import('../export/export.ts');

/** The point count of a run that timed out, when its size explains it. */
function withPoints(netlist: Netlist): { points?: number } {
  const points = pointsAskedFor(netlist);
  return points === undefined ? {} : { points };
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
  /** Said once: the browser would not keep the netlist (storage full or blocked). */
  const saveFailedShown = useRef(false);
  const saveSoon = useDebounced(
    () => {
      const editor = editorRef.current;
      if (editor) lastText.current = editor.getDoc();
      if (writeStored(STORAGE_KEYS.netlist, lastText.current) || saveFailedShown.current) return;
      saveFailedShown.current = true;
      dispatch({ type: 'notice', notice: { tone: 'problem', title: t('saveFailedTitle'), text: t('saveFailedText') } });
      announce(t('saveFailedTitle'));
    },
    SAVE_DELAY_MS,
    { flushOnUnmount: true },
  );
  /**
   * A circuit just opened from a link or the examples is only saved once the student changes it,
   * so opening one never replaces the student's own saved netlist. Until then a link stays in the
   * address bar, so a reload opens it again.
   */
  const linkInAddress = useRef(startup.source === 'share');
  /** The editor's text is being replaced by load(): that change is not the student's. */
  const loading = useRef(false);
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

  // ------------------------------------------------------------------ results on a narrow screen
  const resultsPane = useRef<HTMLElement>(null);
  /**
   * After a tap on Run on a phone (one column), the results are far below the netlist: bring the
   * results pane into view (perf review 4), at once when the student asked for reduced motion.
   */
  const showResultsOnNarrowScreen = useCallback(() => {
    const pane = resultsPane.current;
    if (!pane || !window.matchMedia?.('(max-width: 999px)').matches) return;
    requestAnimationFrame(() => {
      if (pane.getBoundingClientRect().top < window.innerHeight * 0.75) return; // already in view
      const reduce = document.documentElement.dataset.motion === 'reduce' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      pane.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    });
  }, []);

  const runningRef = useRef(false);
  /** The run in progress, so a circuit opened during it can wait for it to end before running. */
  const currentRun = useRef<Promise<void> | null>(null);
  /** Set when a new circuit replaces the one running: its cancelled run then reports nothing. */
  const replacedRun = useRef(false);
  /** Run was pressed with a pointer (a tap): on a narrow screen the results are then scrolled into view. */
  const tappedRun = useRef(false);
  const run = useCallback(async (): Promise<void> => {
    const editor = editorRef.current;
    if (!editor || runningRef.current) return;
    parseSoon.flush();
    const text = editor.getDoc();
    const netlist = parseNetlist(text);
    const traps = checkTraps(netlist);
    // Refuse only when ngspice would really run nothing: the no-analysis check knows about .control
    // blocks, a title that is an analysis, misspelt analyses and lines after .end (words review M1).
    if (traps.some((trap) => trap.id === 'no-analysis')) {
      dispatch({ type: 'notice', notice: { tone: 'info', title: t('noAnalysisTitle'), text: t('noAnalysis') } });
      dispatch({ type: 'tab', tab: 'checks' });
      announce(t('noAnalysis'));
      return;
    }
    const byTap = tappedRun.current;
    tappedRun.current = false;
    runningRef.current = true;
    dispatch({ type: 'run-start' });
    const slow = setTimeout(() => dispatch({ type: 'run-slow' }), SLOW_RUN_MS);
    // A sweep is plotted: fetch the plot's code while ngspice runs, not when the Plot tab opens.
    if (netlist.analyses.some((i) => /^\.(dc|tran)$/.test(netlist.lines[i]?.directive?.name ?? ''))) {
      import('../plot/plot.ts').catch(() => undefined); // offline before it was cached: it loads on first use
    }
    const job = (async () => {
      try {
        await warmUp();
        // For .op, the copy that runs also saves every part's current (src/spice/run-netlist.ts).
        const toRun = netlistToRun(netlist);
        const result = await engine.run(toRun.text, RUN_TIMEOUT_MS);
        const results = interpretPlots(result.plots);
        const description = await describeResults(netlist, results, result);
        dispatch({ type: 'run-done', result, results, description, netlist, added: toRun.added, traps, tab: tabAfterRun(result, traps) });
        // An error-level check means the numbers are not answers, even when ngspice ran cleanly
        // (words review B1): no results on the netlist lines then, and the announcement says why.
        const checkError = description.status === 'ok' ? traps.find((trap) => trap.severity === 'error') : undefined;
        // Results go on the netlist lines only while the text is still the one that ran (annotateLines
        // gives none when ngspice's numbers are not answers).
        if (!checkError) {
          const notes = await annotateLines(netlist, results, result);
          if (editor.getDoc() === text) editor.setInlineNotes(notes);
        }
        // describe.ts writes the summary for exactly this: one paragraph for a polite live region,
        // with the units in words for speech ("14 volts", not "14 V").
        if (checkError) announce(t('announceCheckError', { title: checkError.title }));
        else if (description.summarySpeech) announce(description.summarySpeech);
        else if (description.status === 'unreliable') announce(t('announceUnreliable'));
        else if (description.status === 'ok') announce(t('announceFinished', { summary: '' }));
        else announce(t('announceError', { detail: result.diagnostics.find((d) => d.severity === 'error')?.text ?? '' }));
        if (byTap) showResultsOnNarrowScreen();
      } catch (error) {
        if (isCancelled(error) && replacedRun.current) {
          dispatch({ type: 'run-abandoned' });
        } else if (isCancelled(error)) {
          dispatch({ type: 'run-stopped' });
          announce(t('announceStopped'));
        } else if (isTimeout(error)) {
          // Not "could not run": ngspice was running and had not finished (security review m5).
          const seconds = Math.round(RUN_TIMEOUT_MS / 1000);
          dispatch({ type: 'run-timeout', seconds, ...withPoints(netlist) });
          announce(t('announceTimeout', { seconds }));
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
    })();
    currentRun.current = job;
    await job;
    if (currentRun.current === job) currentRun.current = null;
  }, [announce, engine, parseSoon, restartEngine, warmUp]);

  const stop = useCallback(() => engine.cancel(), [engine]);
  const onRunPressed = useCallback(
    (byPointer: boolean) => {
      tappedRun.current = byPointer;
      void run();
    },
    [run],
  );

  // ------------------------------------------------------------------ loading a circuit
  const load = useCallback(
    (text: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      if (runningRef.current) {
        replacedRun.current = true; // the running circuit is being replaced
        engine.cancel();
      }
      // The student's last edits, if the autosave is still waiting, are saved before they go.
      saveSoon.flush();
      loading.current = true;
      try {
        editor.setDoc(text);
      } finally {
        loading.current = false;
      }
      dispatch({ type: 'loaded' });
      parseSoon.cancel();
      const traps = reparse();
      announcedChecks.current = traps.length;
      dispatch({ type: 'tab', tab: traps.length ? 'checks' : 'results' });
      // Not saved yet: the student's own netlist stays saved until they change this one (security
      // review M4: a link opened in another tab must not replace the homework saved on this device).
    },
    [engine, parseSoon, reparse, saveSoon],
  );

  const onExample = useCallback(
    (id: string) => {
      const example = exampleById(id);
      if (!example) return;
      load(example.netlist);
      // The link in the address is no longer what the editor shows.
      if (linkInAddress.current) {
        linkInAddress.current = false;
        clearShareFragment();
      }
      announce(t('exampleLoaded', { name: exampleName(example) }));
    },
    [announce, load],
  );

  const onExport = useCallback(
    async (kind: ExportKind) => {
      const text = editorRef.current?.getDoc() ?? '';
      // Loaded when the browser is idle after start-up (perf review 9); at once from then on.
      const { downloadFile, exportLtspice, exportNgspice } = await loadExport();
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
      // The notes appear above the netlist, away from the menu: say where (a11y review F16).
      announce(t('ltspiceSaved', { filename: file.filename }));
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
      // Neither saved nor removed from the address yet: both happen on the student's first edit.
      announce(t('shareOpened'));
    } else if (startup.problem) {
      dispatch({ type: 'notice', notice: { tone: 'problem', title: t('shareProblemTitle'), text: startup.problem } });
      announce(startup.problem);
      if (startup.problemCode === 'newer-version') checkForUpdate();
    }
    const offline = (): void => {
      if (!serviceWorker) return;
      void registerServiceWorker({
        onNeedRefresh: (reload) => {
          setUpdate(() => reload);
          announce(t('updateReady')); // the banner appears at the top; say so where the student is
        },
        // Shown quietly in the footer: worth knowing, not worth interrupting a screen reader.
        onOfflineReady: () => setOfflineReady(true),
      });
    };
    whenIdle(() => {
      const ready = warmUp().then(() => {
        if (startup.source === 'share' && startup.run) void run();
      });
      // The service worker's first download (about 1 MB) waits until ngspice is in, so it does not
      // compete with the engine on a slow phone connection (perf review 10).
      void ready.finally(() => whenIdle(offline));
      // Fetch the menus' and dialogs' code now, so they open at once later; the same for the
      // results in words and the export, which the first screen does not need.
      preloadOverlays().catch(() => undefined); // offline before they were cached: they load on first use
      loadDescribe().catch(() => undefined);
      loadExport().catch(() => undefined);
    });
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
          // A run still going is cancelled by load(); this link's run waits until it has ended, or
          // run() would find it still busy and do nothing (security review m2).
          const previous = currentRun.current;
          load(r.netlist);
          linkInAddress.current = true; // until the first edit, as at start-up
          announce(t('shareOpened'));
          if (r.run) void (previous ?? Promise.resolve()).then(() => warmUp()).then(() => run());
        } else if (r.code !== 'no-circuit') {
          dispatch({ type: 'notice', notice: { tone: 'problem', title: t('shareProblemTitle'), text: r.reason } });
          announce(r.reason);
          if (r.code === 'newer-version') checkForUpdate();
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
        if (loading.current) return; // load() reads the new circuit itself
        dispatch({ type: 'text-changed' });
        parseSoon();
        announceChecksSoon();
        // The first edit of a circuit just opened makes it the student's: from now on it is saved,
        // and a link leaves the address bar, so a reload keeps the edits.
        if (linkInAddress.current) {
          linkInAddress.current = false;
          clearShareFragment();
        }
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
  // Stable callbacks, so the memoised panels draw again only when their data changes.
  const onGoToTrap = useCallback((trap: Trap) => goToLine(trap.line, trap.span), [goToLine]);
  const onGoToLineNumber = useCallback((line: number) => goToLine(line), [goToLine]);
  const onShowChecks = useCallback(() => showTab('checks', checksTab), [showTab]);
  const onShowPlot = useCallback(() => showTab('plot', plotTab), [showTab]);
  // Once the Plot tab has been open, it stays mounted (hidden) while another tab is shown, so going
  // back does not draw 100 000 points again (perf review 7).
  const [keepPlot, setKeepPlot] = useState(false);
  if (tab === 'plot' && !keepPlot) setKeepPlot(true);

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
            onRun={onRunPressed}
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

        <section ref={resultsPane} className="pane pane--results" aria-label={t('tabsLabel')}>
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
              <ChecksPanel traps={state.traps} onGoToLine={onGoToTrap} onFix={applyFix} />
            </TabPanel>
            <TabPanel id="results" className="tab-panel">
              <ResultsPanel
                outcome={outcome}
                running={state.running !== null}
                colours={state.colours}
                plotAvailable={plotAvailable}
                onGoToLine={onGoToLineNumber}
                onShowChecks={onShowChecks}
                onShowPlot={onShowPlot}
              />
            </TabPanel>
            {plotAvailable && outcome.kind === 'done' && (
              <TabPanel id="plot" className="tab-panel" shouldForceMount={keepPlot}>
                <PlotPanel results={outcome.results} netlist={outcome.netlist} />
              </TabPanel>
            )}
            <TabPanel id="explained" className="tab-panel">
              <ExplainedPanel netlist={state.netlist} onGoToLine={onGoToLineNumber} />
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
