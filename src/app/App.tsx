/**
 * PlainSpice: the app shell (decision 0016), in the Notebook look Tarık chose (decision 0014): the
 * circuit drawn from its netlist (src/schematic) on the Solved Circuits page (src/notebook), solved
 * by ngspice as you edit, with the results written on it; the parts toolbar with names, the hint
 * line, the status line and Ctrl+K; and the panels you open when you want them (Netlist, Checks,
 * Explain, Numbers, Plot, ngspice output). It wires the plain-TypeScript modules together and renders
 * them (decision 0002); it computes nothing about circuits itself.
 *
 *   the store (store.ts): the netlist text, the one source of truth, with undo and redo
 *     <- typing in the Netlist panel, a value typed on a part's card, a fix, an example or a link
 *     -> the drawing (buildSchematic), the checks (readNetlist), the editor, the autosave
 *     -> live runs (live.ts): ngspice runs the text a moment after each change, never two at once
 *        -> the results on the drawing, the card, the panels, an announcement for screen readers
 *
 * Layout on a computer: the top bar, the parts toolbar in the page's margin, the paper (the drawing,
 * the card beside its part, red pen, the sticky note), the divider tabs and their panel on the right,
 * the hint and status lines at the bottom. On a phone (narrower than 900 px): the top bar, the paper
 * (a wide drawing turned to fit, decision 0015), and one stack along the bottom: the hint and status,
 * a sheet (a panel, a part's card, the parts, More), and the bar.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { I18nProvider } from 'react-aria-components';
import type { PlainSpiceEditor } from '../editor/index.ts';
import { LOCALE, t, tn } from '../i18n/index.ts';
import {
  NOTEBOOK_OPTIONS,
  NOTEBOOK_STRINGS,
  NO_RESULTS,
  MIN_TEXT_PX,
  NotebookCanvas,
  answers,
  boxOnGrid,
  boxOnScreen,
  createResultFontStore,
  currentText,
  drawingRoom,
  inkBoxes,
  inviteArrow,
  isWide,
  itemKey,
  minUnitFor,
  nodeBox,
  partBox,
  placeBeside,
  placeCard,
  placeNote,
  placeResults,
  symbolBoxes,
  turnedQuarter,
  wasMarks,
  withoutResultsPointer,
  type CanvasHandle,
  type CanvasViewInfo,
  type CardPlacement,
  type Insets,
  type PenMarks,
  type PenNote,
  type ResultFont,
  type ResultFontStore,
  type Side,
} from '../notebook/index.ts';
import { GROUND, NAVIGATE_STRINGS, applyChanges, buildSchematic, describeNode, describeSchematic, inflate, readDrawing, unionBoxes, type Box, type NavItem, type PartLetter, type Schematic } from '../schematic/index.ts';
import { decodeShare } from '../share/link.ts';
import { elementInfo } from '../spice/elements.ts';
import type { Fix, Trap } from '../spice/types.ts';
import { AnnouncerProvider, useAnnounce } from './announcer.tsx';
import { cardContent, onValueField, relatedOf, typeHint, type CardRun, type CardState } from './card.ts';
import { keepDrawing, spotValue, valueSpot, withValue, writeValue, type ValueSpot } from './card-edit.ts';
import { ChecksPanel } from './components/ChecksPanel.tsx';
import { CommandPalette, type Command } from './components/CommandPalette.tsx';
import { ExplainPanel, type ExplainSelection } from './components/ExplainPanel.tsx';
import { BottomBar, MoreSheet, NoticeCard, PANELS, PanelHead, PanelTabs, ResultsCard, StatusLines, StickyNote, UpdateCard, checksSub, panelTitle, type PanelId } from './components/Frame.tsx';
import { LineIcon } from './components/Icons.tsx';
import { IndexCard } from './components/IndexCard.tsx';
import { NetlistPanel, preloadEditor, type CreateEditor } from './components/NetlistPanel.tsx';
import { NumbersPanel, tfRows } from './components/NumbersPanel.tsx';
import { OutputPanel } from './components/OutputPanel.tsx';
import { Overlays, preloadOverlays, type ExportKind, type MenuFocus, type OverlayKey } from './components/Overlays.tsx';
import { PartsSheetList, PartsToolbar, toolForKey, toolPhrase, type Tool } from './components/PartsToolbar.tsx';
import { PlotPanel } from './components/PlotPanel.tsx';
import { TopBar } from './components/TopBar.tsx';
import { isCancelled, isTimeout, RUN_TIMEOUT_MS, type Engine } from './engine.ts';
import { EXAMPLE_GROUPS, EXAMPLES, START_HERE_ID, exampleById, exampleName } from './examples.ts';
import { useKeyboardInset, useMedia, useRect, useTextScale, useWindowSize } from './hooks.ts';
import { createLiveRunner, type LiveState } from './live.ts';
import { explainLine, hasParts, hasSweeps, planRun, pointsAskedFor, readNetlist, solveText, type RunRecord } from './model.ts';
import { nodeColours, sameColours } from './nodes.ts';
import type { Notice } from './notices.ts';
import { checkForUpdate, registerServiceWorker } from './pwa.ts';
import { applySettings, DEFAULT_SETTINGS, saveSettings, type Settings } from './settings.ts';
import { clearShareFragment, type StartupDecision } from './startup.ts';
import { STORAGE_KEYS, writeStored } from './storage.ts';
import { createNetlistStore, type Change, type NetlistStore } from './store.ts';
import { useDebounced, whenIdle } from './timing.ts';
import { analysisName, hintWords, pressRun, statusWords, type EngineStatus } from './words.ts';

export interface AppProps {
  startup: StartupDecision;
  engine: Engine;
  /** The editor factory (tests may pass their own). */
  createEditor?: CreateEditor;
  initialSettings?: Settings;
  /** Register the service worker (off in tests). */
  serviceWorker?: boolean;
  /** The handwriting / plain font setting (tests may pass one that stores nothing). */
  fontStore?: ResultFontStore;
}

export function App(props: AppProps): ReactNode {
  return (
    <I18nProvider locale={LOCALE}>
      <AnnouncerProvider>
        <Shell {...props} />
      </AnnouncerProvider>
    </I18nProvider>
  );
}

/**
 * Below this width the page uses the phone's layout (an iPad held upright included), and below this
 * height too (a phone held sideways, a short window, 400 % zoom): the card is then a sheet, never
 * over the drawing.
 */
const PHONE_QUERY = '(max-width: 899px), (max-height: 520px)';
/** The same limits in pixels at the usual text size, scaled with the Text size setting. */
const PHONE_WIDTH = 900;
const PHONE_HEIGHT = 521;
/** The card on a computer: as wide and as tall as its tallest state at the usual text size (it is measured, too). */
const CARD_W = 680;
const CARD_H = 204;
/** Desktop and phone: the most pixels per grid unit at the usual text size (a small circuit does not grow huge). */
const DESK_MAX_UNIT = 40;
const PHONE_MAX_UNIT = 30;
/** More parts than this are not drawn: the layout is meant for the small circuits of a first course. */
export const MAX_DRAWN_PARTS = 60;
/** Waits before saving, before saying the number of checks, before reading out the new results. */
const SAVE_DELAY_MS = 500;
const ANNOUNCE_CHECKS_DELAY_MS = 1000;
const ANNOUNCE_RESULTS_DELAY_MS = 900;
/** While the netlist is typed, results are read out only after this pause. */
const ANNOUNCE_WHILE_TYPING_MS = 1500;

/** The netlist's title line, as a heading ("Start here: change R1 and watch the numbers move"). */
function titleOf(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const title = first.replace(/^\s*\*+\s*/, '').trim();
  return title || t('untitled');
}

/**
 * The file name on the Netlist panel's bar: the one Export gives the ngspice file (src/export: the
 * title line's words in plain letters), so the two never disagree, whatever the netlist was opened as.
 */
function fileNameOf(title: string): string {
  const stem = [...title.replace(/^[\s*#;$]+/, '')]
    .map((c) => (c === '\u03A9' || c === '\u2126' ? 'ohm' : c === '\u00B5' || c === '\u03BC' ? 'u' : c))
    .join('')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 60)
    .replace(/[-_]+$/, '');
  return `${stem || 'circuit'}.cir`;
}

/** No results for the netlist's lines (one array, so the editor is not told again on every render). */
const NO_NOTES: readonly never[] = [];

/**
 * Changes the student made (not an opened circuit): these are saved, and clear a link from the
 * address. An undo or a redo counts when it lands on a text that is the student's (store.ts).
 */
const STUDENT_CHANGES: ReadonlySet<Change['source']> = new Set(['editor', 'drawing', 'fix']);

/** A card open on a part: where its value is written, and the text the card last wrote (to see changes made elsewhere). */
interface CardEdit {
  session: number;
  spot: ValueSpot;
  /** The drawing of the text the card opened on (positions kept while the value changes, card-edit.ts). */
  drawn: Schematic;
  written: string;
}

function Shell({ startup, engine, createEditor, initialSettings, serviceWorker = true, fontStore: givenFontStore }: AppProps): ReactNode {
  const announce = useAnnounce();
  // The netlist saved on this device is the student's; a link or the first screen's example is not, until changed.
  const [store] = useState<NetlistStore>(() => createNetlistStore(startup.netlist, { mine: startup.source === 'saved' }));
  const snap = useSyncExternalStore(
    useCallback((cb: () => void) => store.subscribe(cb), [store]),
    store.snapshot,
  );
  const text = snap.text;
  const [fontStore] = useState<ResultFontStore>(() => givenFontStore ?? createResultFontStore());
  const font = useSyncExternalStore(fontStore.subscribe, fontStore.get);
  const plain = font === 'plain';
  const [settings, setSettings] = useState<Settings>(initialSettings ?? DEFAULT_SETTINGS);
  const narrow = useMedia(PHONE_QUERY);
  const portrait = useMedia('(orientation: portrait)');
  const keyboard = useKeyboardInset();
  const win = useWindowSize();
  // The drawing's words grow with the page's text (the Text size setting): its smallest and largest sizes scale.
  const textScale = useTextScale(settings.textSize, win.width);
  const minUnit = minUnitFor(MIN_TEXT_PX * textScale);
  // The layout follows the room in text sizes, as a browser's zoom does: a 1280 × 800 window with
  // text at 150 % holds what an 853 × 533 one holds at 100 %, and gets the phone's layout too.
  const phone = narrow || win.width < PHONE_WIDTH * textScale || win.height < PHONE_HEIGHT * textScale;

  // ------------------------------------------------------------------ ngspice and live runs
  const [engineStatus, setEngineStatus] = useState<EngineStatus>({ status: 'loading' });
  const warming = useRef<Promise<void> | null>(null);
  /** ngspice is in (loaded once; loaded again after a Stop, which ends its Worker). */
  const loaded = useRef(false);
  const warmUp = useCallback((): Promise<void> => {
    if (!warming.current) {
      warming.current = engine.warmUp().then(
        (loadMs) => {
          loaded.current = true;
          setEngineStatus({ status: 'ready', loadMs });
        },
        (error: unknown) => {
          warming.current = null;
          // Stopped while loading (a new circuit, a Stop): not a failure; the next run loads it again.
          if (isCancelled(error)) throw error;
          const reason = error instanceof Error ? error.message : String(error);
          setEngineStatus({ status: 'failed', reason });
          announce(t('engineFailed', { reason }), 'assertive');
          throw error;
        },
      );
    }
    return warming.current;
  }, [engine, announce]);
  const [live] = useState(() =>
    createLiveRunner<RunRecord>({
      solve: async (netlist) => {
        await warmUp();
        try {
          return await solveText(netlist, engine);
        } catch (error) {
          // Stopped or out of time: the Worker is gone, and the next run loads ngspice again.
          if (isCancelled(error) || isTimeout(error)) {
            warming.current = null;
            loaded.current = false;
          }
          throw error;
        }
      },
      msOf: (r) => r.ms,
      plan: planRun,
      cancel: () => engine.cancel(),
      isCancelled,
      isTimeout,
      timeoutSeconds: Math.round(RUN_TIMEOUT_MS / 1000),
      pointsOf: (netlist) => pointsAskedFor(readNetlist(netlist).netlist),
      // While ngspice downloads, a run waits without turning Run into Stop.
      ready: warmUp,
      loading: () => !loaded.current,
    }),
  );
  useEffect(() => () => live.dispose(), [live]);
  const liveState: LiveState<RunRecord> = useSyncExternalStore(live.subscribe, live.getState);
  const record = liveState.outcome.kind === 'done' ? liveState.outcome.result : undefined;
  const current = !!record && record.text === text;

  // ------------------------------------------------------------------ the circuit
  /** Counts the circuits opened: the phone's view and the fit are decided again for each. */
  const [circuitKey, setCircuitKey] = useState(0);
  const [exampleId, setExampleId] = useState<string | undefined>(startup.source === 'example' ? startup.exampleId : undefined);
  // Typing never waits for the drawing: it follows the text a moment later when React is busy.
  const [shownText, setShownText] = useState(text);
  useEffect(() => {
    // One frame later at most: the editor's keystroke is drawn first.
    const id = requestAnimationFrame(() => setShownText(text));
    return () => cancelAnimationFrame(id);
  }, [text]);
  const read = useMemo(() => readNetlist(shownText), [shownText]);
  const netlist = read.netlist;
  const traps = read.traps;
  const coloursRef = useRef<Map<string, string>>(new Map());
  const colours = useMemo(() => {
    const next = nodeColours(netlist);
    if (sameColours(coloursRef.current, next)) return coloursRef.current;
    coloursRef.current = next;
    return next;
  }, [netlist]);
  const partCount = useMemo(() => netlist.lines.filter((l) => l.element).length, [netlist]);
  const tooBig = partCount > MAX_DRAWN_PARTS;
  const schematic = useMemo((): Schematic | undefined => (tooBig ? undefined : buildSchematic(netlist, NOTEBOOK_OPTIONS)), [netlist, tooBig]);
  const title = titleOf(text);
  /** The netlist's first line as written (what Export names its file after). */
  const titleLine = text.split(/\r?\n/, 1)[0] ?? '';

  // A phone held upright shows a wide drawing turned a quarter, so it fits whole at a size its words
  // can be read (src/notebook/turn.ts); the drawing in the netlist stays as it is. Decided when a
  // circuit opens (or the phone turns), never as a value is typed: the drawing must not change under
  // the reader. Decided on the opened circuit's own drawing, which follows the text a frame later
  // (`viewFor` waits for it), never on the circuit that was open before.
  const [turnWanted, setTurnWanted] = useState(true);
  const [openedText, setOpenedText] = useState(startup.netlist);
  const [viewFor, setViewFor] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (schematic && schematic.netlist.text === openedText && viewFor !== circuitKey) setViewFor(circuitKey);
  }, [schematic, openedText, circuitKey, viewFor]);
  const phoneView = useMemo(() => {
    if (!phone || !schematic) return { pans: false, turn: false };
    const w = win.width - 30;
    const h = win.height - 190;
    const unitOf = (b: Box): number => Math.min(w / Math.max(1e-6, b.x1 - b.x0), h / Math.max(1e-6, b.y1 - b.y0));
    const asDrawn = unitOf(schematic.scene.bounds);
    const pans = asDrawn < minUnit;
    if (!(pans && portrait && isWide(schematic))) return { pans, turn: false };
    const turnedNow = turnedQuarter(schematic);
    return { pans, turn: !!turnedNow && unitOf(turnedNow.scene.bounds) > asDrawn * 1.15 };
    // The circuit (and how many parts it has), not its text as typed.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, portrait, viewFor, partCount, win.width > win.height, minUnit]);
  const turned = useMemo(() => (phoneView.turn && schematic ? turnedQuarter(schematic) : undefined), [phoneView.turn, schematic]);
  const shown = turned && turnWanted ? turned : schematic;
  const asDrawnOnPhone = phone && !!schematic && shown === schematic;
  const results = useMemo(() => (shown ? placeResults(shown.scene, answers(record)) : NO_RESULTS), [shown, record]);
  const description = useMemo(() => (schematic ? describeSchematic(schematic) : ''), [schematic]);
  const analysis = useMemo(() => analysisName(netlist.analyses.flatMap((i) => [explainLine(netlist, i)].filter((e) => e !== undefined)), netlist), [netlist]);
  const drawingLineCount = useMemo(() => readDrawing(netlist).lineIndexes.length, [netlist]);

  // ------------------------------------------------------------------ what is selected and open
  const [selected, setSelected] = useState<NavItem | undefined>(undefined);
  const [selectedLine, setSelectedLine] = useState<number | undefined>(undefined);
  const [card, setCard] = useState<CardState | undefined>(undefined);
  const cardSession = useRef(0);
  const [panel, setPanel] = useState<PanelId | undefined>(undefined);
  /** The next panel opens without taking the focus (one opened along with an example). */
  const quietPanel = useRef(false);
  const [tool, setTool] = useState<Tool>('select');
  const [overlay, setOverlay] = useState<OverlayKey | null>(null);
  const [menuFocus, setMenuFocus] = useState<MenuFocus>('first');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [partsSheet, setPartsSheet] = useState(false);
  const [moreSheet, setMoreSheet] = useState(false);
  const [folded, setFolded] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [update, setUpdate] = useState<(() => void) | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  /** The sticky note invites the student on the first screen (Start here), until a card opens or it is hidden. */
  const [noteWanted, setNoteWanted] = useState(startup.source === 'example' && startup.exampleId === START_HERE_ID);
  /** A phone: the card's value field has the focus (the editing strip shows above the keyboard). */
  const [editing, setEditing] = useState(false);
  /** The netlist is being typed: the drawing keeps its size (only a new part fits it again). */
  const [typingNetlist, setTypingNetlist] = useState(false);
  const [fitCount, setFitCount] = useState(0);
  const [viewInfo, setViewInfo] = useState<CanvasViewInfo | undefined>(undefined);
  const canvas = useRef<CanvasHandle>(null);
  const editorRef = useRef<PlainSpiceEditor | null>(null);
  const panelHeading = useRef<HTMLHeadingElement | null>(null);
  const examplesRef = useRef<HTMLButtonElement | null>(null);
  const exportRef = useRef<HTMLButtonElement | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const drawingNameId = useId();

  const selectedPart = selected?.kind === 'part' && shown ? shown.scene.parts.find((p) => p.key === selected.key) : undefined;
  const related = useMemo(() => relatedOf(selectedPart?.part), [selectedPart]);
  const checks = current ? record.checks : traps;
  /** Checks on part lines (not notes): each part's first, which its symbol shows in red pen. */
  const partTraps = useMemo(() => {
    const out = new Map<string, Trap>();
    if (!schematic) return out;
    for (const trap of traps) {
      if (trap.severity === 'info') continue;
      const p = schematic.circuit.parts.find((x) => x.line + 1 === trap.line);
      if (p && !out.has(p.key)) out.set(p.key, trap);
    }
    return out;
  }, [traps, schematic]);
  const trapKeys = useMemo(() => new Set(partTraps.keys()), [partTraps]);
  /** The red pen's words by item, for screen readers (the pen itself is a picture). */
  const penWords = useMemo(() => {
    const words = new Map<string, string>();
    for (const [key, trap] of partTraps) words.set(itemKey({ kind: 'part', key }), trap.title);
    const ns = current ? record.noSingleAnswer : undefined;
    if (ns) words.set(itemKey({ kind: 'node', name: ns.at }), ns.title);
    return words;
  }, [partTraps, current, record]);

  // ------------------------------------------------------------------ changing the text
  const linkInAddress = useRef(startup.source === 'share');
  /** Said once: the browser would not keep the netlist (storage full or blocked). */
  const saveFailedShown = useRef(false);
  /** The student's text to save: the last one they made (a redo onto an opened example afterwards does not change it). */
  const toSave = useRef<string | null>(null);
  const saveSoon = useDebounced(
    () => {
      if (toSave.current === null || writeStored(STORAGE_KEYS.netlist, toSave.current) || saveFailedShown.current) return;
      saveFailedShown.current = true;
      setNotice({ tone: 'problem', title: t('saveFailedTitle'), text: t('saveFailedText') });
      announce(t('saveFailedTitle'));
    },
    SAVE_DELAY_MS,
    { flushOnUnmount: true },
  );
  const announcedChecks = useRef(traps.length);
  const announceChecksSoon = useDebounced(() => {
    const count = readNetlist(store.get()).traps.length;
    if (count === announcedChecks.current) return;
    announcedChecks.current = count;
    announce(tn('checksCount', count));
  }, ANNOUNCE_CHECKS_DELAY_MS);
  // A circuit just opened: its traps are said once, after what opened it (the red pen on the drawing
  // is a picture; the parts' descriptions carry it too).
  const announceOpenedSoon = useDebounced(() => {
    const found = readNetlist(store.get()).traps.filter((x) => x.severity !== 'info');
    if (found.length) announce(tn('announceTraps', found.length, { title: found[0]!.title.replace(/[.!?:]$/, '') }));
  }, ANNOUNCE_CHECKS_DELAY_MS);

  // Every change: run it (live), and when the student made it, save it and let the link go.
  useEffect(
    () =>
      store.subscribe((next, change) => {
        if (change.source === 'load') return; // load() runs and announces it itself
        live.edited(next);
        const undone = change.source === 'undo' || change.source === 'redo';
        // An undo or a redo back to a circuit just opened is like opening it: not saved, the link left as it is.
        if (!STUDENT_CHANGES.has(change.source) && !(undone && store.snapshot().mine)) return;
        // The first edit of a circuit just opened makes it the student's: from now on it is saved,
        // and a link leaves the address bar, so a reload keeps the edits (security review M4).
        if (linkInAddress.current) {
          linkInAddress.current = false;
          clearShareFragment();
        }
        toSave.current = next;
        saveSoon();
        announceChecksSoon();
      }),
    [store, live, saveSoon, announceChecksSoon],
  );
  // Keep the last edits when the page is closed before the autosave fires.
  useEffect(() => {
    const flush = (): void => saveSoon.flush();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [saveSoon]);

  const closeCard = useCallback((focusPart = true) => {
    setCard((c) => {
      if (c && focusPart) requestAnimationFrame(() => canvas.current?.focusItem({ kind: 'part', key: c.key }));
      return undefined;
    });
    setEditing(false);
  }, []);

  /** Open another circuit (an example, a link): the old one's results, card and selection go. */
  const load = useCallback(
    (next: string, how: { run: boolean; manual?: boolean; example?: string | undefined }) => {
      saveSoon.flush(); // the student's last edits, if the autosave is still waiting
      setCard(undefined);
      setEditing(false);
      setSelected(undefined);
      setSelectedLine(undefined);
      setTool('select');
      setNotice(null);
      setExampleId(how.example);
      setNoteWanted(how.example === START_HERE_ID);
      setCircuitKey((k) => k + 1);
      setOpenedText(next);
      setFitCount((n) => n + 1);
      store.set(next, { source: 'load' });
      live.load(next, { run: how.run, manual: how.manual ?? false });
      announcedChecks.current = readNetlist(next).traps.length;
      announceOpenedSoon();
    },
    [store, live, saveSoon, announceOpenedSoon],
  );

  const onExample = useCallback(
    (id: string) => {
      const example = exampleById(id);
      if (!example) return;
      load(example.netlist, { run: true, example: example.id });
      // SPICE for Beginners is about the netlist: on a computer its examples open with the Netlist
      // panel beside the drawing (the focus stays where the student chose the example).
      if (example.group === 'sp01' && !phone) {
        quietPanel.current = true;
        setPanel('netlist');
      }
      // The link in the address is no longer what is open.
      if (linkInAddress.current) {
        linkInAddress.current = false;
        clearShareFragment();
      }
      announce(t('exampleLoaded', { name: exampleName(example) }));
    },
    [announce, load, phone],
  );

  const applyFix = useCallback(
    (fix: Fix, from: 'panel' | 'editor') => {
      const now = store.get();
      let changes = fix.changes;
      if (from === 'panel' && read.text !== now) {
        // The checks are a moment behind the text: use the same fix as found in the text as it is now.
        const fresh = readNetlist(now).traps.flatMap((x) => x.fixes).find((f) => f.label === fix.label);
        if (!fresh) return;
        changes = fresh.changes;
      }
      const next = applyChanges(now, changes);
      store.set(next, { source: 'fix' });
      const count = readNetlist(next).traps.length;
      announcedChecks.current = count;
      announce(`${t('fixApplied', { label: fix.label })}. ${tn('checksCount', count)}`);
    },
    [store, read.text, announce],
  );

  const undo = useCallback(() => {
    if (!store.undo()) return;
    setCard(undefined);
    setEditing(false);
    announce(t('undone'));
  }, [store, announce]);
  const redo = useCallback(() => {
    if (!store.redo()) return;
    setCard(undefined);
    setEditing(false);
    announce(t('redone'));
  }, [store, announce]);

  const runNow = useCallback(() => {
    const now = store.get();
    const read = readNetlist(now);
    const why = !hasParts(read.netlist) ? t('statusNoParts') : read.traps.some((trap) => trap.id === 'no-analysis') ? t('noAnalysis') : undefined;
    if (why) {
      setNotice({ tone: 'info', title: t('noAnalysisTitle'), text: why });
      announce(why);
    }
    live.run(now);
  }, [store, live, announce]);
  const stop = useCallback(() => live.stop(), [live]);

  // ------------------------------------------------------------------ start-up (once)
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (startup.source === 'share') {
      // Neither saved nor removed from the address yet: both happen on the student's first edit.
      announce(t('shareOpened'));
    } else if (startup.problem) {
      setNotice({ tone: 'problem', title: t('shareProblemTitle'), text: startup.problem });
      announce(startup.problem);
      if (startup.problemCode === 'newer-version') checkForUpdate();
    }
    // A first screen already solved: ngspice loads at once and solves the circuit, unless a link
    // asked to wait for Run.
    // A link with run=1 runs as Run would, however many points it asks for.
    live.load(startup.netlist, { run: startup.source !== 'share' || startup.run, manual: startup.source === 'share' });
    if (startup.source !== 'saved') announceOpenedSoon();
    warmUp().then(
      () =>
        whenIdle(() => {
          // The service worker's first download (about 1 MB) waits until ngspice is in, so it does not
          // compete with the engine on a slow phone connection (perf review 10).
          if (serviceWorker) {
            void registerServiceWorker({
              onNeedRefresh: (reload) => {
                setUpdate(() => reload);
                announce(t('updateReady'));
              },
              onOfflineReady: () => setOfflineReady(true),
            });
          }
          // Fetch the menus', dialogs' and editor's code now, so they open at once later.
          preloadOverlays().catch(() => undefined); // offline before they were cached: they load on first use
          preloadEditor().catch(() => undefined);
        }),
      () => undefined,
    );
    // Once, on purpose: the start-up decision never changes (the ref also guards React's double effects in development).
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
          load(r.netlist, { run: r.run, manual: true });
          linkInAddress.current = true; // until the first edit, as at start-up
          announce(t('shareOpened'));
        } else if (r.code !== 'no-circuit') {
          setNotice({ tone: 'problem', title: t('shareProblemTitle'), text: r.reason });
          announce(r.reason);
          if (r.code === 'newer-version') checkForUpdate();
        }
      });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [announce, load]);

  // ------------------------------------------------------------------ what a screen reader hears
  // After a run, once typing pauses: the model's summary (without its pointer to a results view).
  // The same words are not said twice in a row, and while the netlist is typed they wait for a pause
  // (a line half typed is not worth reading out).
  const announcedRecord = useRef<RunRecord | undefined>(undefined);
  const lastResultWords = useRef('');
  useEffect(() => {
    if (!record || !current || announcedRecord.current === record) return undefined;
    const timer = window.setTimeout(
      () => {
        announcedRecord.current = record;
        const error = record.checks.find((c) => c.severity === 'error');
        const words =
          record.status === 'check' && error
            ? t('announceCheckError', { title: error.title.replace(/[.!?:]$/, '') })
            : record.words.summarySpeech
              ? withoutResultsPointer(record.words.summarySpeech)
              : record.status === 'unreliable'
                ? t('announceUnreliable')
                : record.status === 'ok'
                  ? t('announceFinished', { summary: '' })
                  : t('announceError', { detail: record.run.diagnostics.find((d) => d.severity === 'error')?.text ?? '' });
        if (words === lastResultWords.current) return;
        lastResultWords.current = words;
        announce(words);
      },
      typingNetlist ? ANNOUNCE_WHILE_TYPING_MS : card ? ANNOUNCE_RESULTS_DELAY_MS : ANNOUNCE_RESULTS_DELAY_MS / 3,
    );
    return () => window.clearTimeout(timer);
  }, [record, current, card, typingNetlist, announce]);
  // Runs that end without results, and pauses, are said once.
  const outcome = liveState.outcome;
  const paused = liveState.paused;
  const lastSaid = useRef<unknown>(undefined);
  useEffect(() => {
    if (outcome === lastSaid.current) return;
    if (outcome.kind === 'stopped') announce(t('announceStopped'));
    else if (outcome.kind === 'timeout') announce(t('announceTimeout', { seconds: outcome.seconds }));
    else if (outcome.kind === 'failed') announce(t('announceFailed', { reason: outcome.reason }), 'assertive');
    lastSaid.current = outcome;
  }, [outcome, announce]);
  const lastPause = useRef(paused);
  useEffect(() => {
    if (paused === lastPause.current) return;
    lastPause.current = paused;
    if (paused?.reason === 'slow') announce(t('announcePausedSlow', { seconds: (paused.ms / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }), run: pressRun(phone) }));
    else if (paused?.reason === 'long') announce(t('announcePausedLong', { points: paused.points.toLocaleString('en-US'), run: pressRun(phone) }));
  }, [paused, announce, phone]);

  // ------------------------------------------------------------------ the card
  // Typing on a card rebuilds the text from where the card opened (card-edit.ts): nothing typed on
  // the way is left behind, and only a value SPICE reads as one number is written.
  const cardEdit = useRef<CardEdit | null>(null);
  const refusedOf = useCallback((spot: ValueSpot, value: string, letter: PartLetter): CardState['refused'] => {
    const r = writeValue(spot, value, t('cardNotWritten', { hint: typeHint(letter) }));
    return r.kind === 'refused' ? { reason: r.reason, ...(r.fix ? { fix: r.fix } : {}) } : undefined;
  }, []);
  /** The card's edit, found again in the text when something else changed it (the Netlist panel, a fix). */
  const editOf = useCallback(
    (c: CardState): CardEdit | null => {
      const edit = cardEdit.current;
      if (!edit || edit.session !== c.session) return null;
      const now = store.get();
      if (edit.written === now) return edit;
      const spot = valueSpot(now, c.key);
      cardEdit.current = spot ? { session: c.session, spot, drawn: buildSchematic(now, NOTEBOOK_OPTIONS), written: now } : null;
      return cardEdit.current;
    },
    [store],
  );

  const openCard = useCallback(
    (key: string, focus = true) => {
      const p = schematic?.circuit.parts.find((x) => x.key === key);
      if (!p) return;
      const now = store.get();
      const spot = valueSpot(now, key);
      cardSession.current += 1;
      const session = cardSession.current;
      cardEdit.current = spot ? { session, spot, drawn: schematic && schematic.netlist.text === now ? schematic : buildSchematic(now, NOTEBOOK_OPTIONS), written: now } : null;
      const start = spot ? spotValue(spot) : p.valueText;
      const refused = spot && start ? refusedOf(spot, start, p.letter) : undefined;
      setSelected({ kind: 'part', key });
      setSelectedLine(p.line + 1);
      setCard({ key, start, input: start, kept: start, before: current ? record : undefined, session, focus, ...(refused ? { refused } : {}) });
      setNoteWanted(false);
      setPartsSheet(false);
      setMoreSheet(false);
      setTool('select');
      if (phone) setPanel(undefined);
    },
    [schematic, store, current, record, phone, refusedOf],
  );

  const onSelect = useCallback(
    (item: NavItem | undefined) => {
      setSelected(item);
      if (item?.kind === 'part') {
        const p = schematic?.circuit.parts.find((x) => x.key === item.key);
        if (p) setSelectedLine(p.line + 1);
        // Moving along the drawing with a card open: the card follows, the focus stays on the drawing.
        if (card && card.key !== item.key) openCard(item.key, false);
      } else if (card) closeCard(false);
    },
    [schematic, card, openCard, closeCard],
  );

  // With a part tool chosen a click on a part still opens its card, as the hint says: placing parts
  // comes in the next update, so the tool goes back to Select rather than pretend.
  const onOpen = useCallback(
    (item: NavItem) => {
      if (tool !== 'select') setTool('select');
      if (item.kind === 'part') openCard(item.key);
      else {
        setSelected(item);
        setPanel('explain');
        setNoteWanted(false);
      }
    },
    [openCard, tool],
  );

  /** Write a value from the card (or keep it in the field, with why), as typed or put back. */
  const cardWrite = useCallback(
    (value: string, how: 'typed' | 'put-back'): void => {
      if (!card) return;
      const edit = editOf(card);
      const { refused: _was, ...rest } = card;
      if (!edit) {
        setCard({ ...rest, input: value });
        return;
      }
      const letter = schematic?.circuit.parts.find((x) => x.key === card.key)?.letter ?? 'R';
      // Put back gives the line exactly as it was, even a value SPICE misreads.
      const r = how === 'put-back' ? ({ kind: 'write', text: withValue(edit.spot, value) } as const) : writeValue(edit.spot, value, t('cardNotWritten', { hint: typeHint(letter) }));
      let kept = card.kept;
      if (r.kind === 'write') {
        const next = keepDrawing(edit.drawn, r.text);
        const now = store.get();
        edit.written = next;
        if (next !== now) store.set(next, { source: 'drawing', group: `card:${card.session}` });
        kept = value.trim();
      }
      const refused = r.kind === 'refused' ? { reason: r.reason, ...(r.fix ? { fix: r.fix } : {}) } : how === 'put-back' && value ? refusedOf(edit.spot, value, letter) : undefined;
      setCard({ ...rest, input: value, kept, ...(refused ? { refused } : {}) });
    },
    [card, editOf, schematic, store, refusedOf],
  );
  const onValue = useCallback((value: string): void => cardWrite(value, 'typed'), [cardWrite]);

  // The netlist changed elsewhere while a card is open (typed in the Netlist panel, a fix): the
  // card's field follows it.
  useEffect(() => {
    const edit = cardEdit.current;
    if (!card || !edit || edit.session !== card.session || edit.written === text) return;
    const spot = valueSpot(text, card.key);
    if (!spot) {
      cardEdit.current = null;
      return;
    }
    cardEdit.current = { session: card.session, spot, drawn: buildSchematic(text, NOTEBOOK_OPTIONS), written: text };
    const value = spotValue(spot);
    const letter = schematic?.circuit.parts.find((x) => x.key === card.key)?.letter ?? 'R';
    const refused = value ? refusedOf(spot, value, letter) : undefined;
    setCard((c) => {
      if (!c || c.session !== card.session) return c;
      const { refused: _was, ...rest } = c;
      return { ...rest, input: value, kept: value, ...(refused ? { refused } : {}) };
    });
  }, [text, card, schematic, refusedOf]);

  // A card opened before ngspice answered keeps the first answer as the one to compare with.
  useEffect(() => {
    if (card && !card.before && current && card.input === card.start) setCard((c) => (c && !c.before ? { ...c, before: record } : c));
  }, [card, current, record]);

  // ------------------------------------------------------------------ panels and tools
  const togglePanel = useCallback(
    (id: PanelId) => {
      setPanel((p) => (p === id ? undefined : id));
      setNoteWanted(false);
      setMoreSheet(false);
      if (phone) {
        setCard(undefined);
        setEditing(false);
        setPartsSheet(false);
      }
    },
    [phone],
  );
  const openPanel = useCallback(
    (id: PanelId) => {
      setPanel(id);
      setNoteWanted(false);
      setMoreSheet(false);
      if (phone) {
        setCard(undefined);
        setEditing(false);
        setPartsSheet(false);
      }
    },
    [phone],
  );
  // A panel that opens takes the focus to its heading; one that closes gives it back to its tab.
  const openedPanel = useRef<PanelId | undefined>(undefined);
  useEffect(() => {
    const was = openedPanel.current;
    openedPanel.current = panel;
    const quiet = quietPanel.current;
    quietPanel.current = false;
    if (panel && panel !== was) {
      if (!quiet) panelHeading.current?.focus({ preventScroll: true });
    }
    else if (!panel && was && (document.activeElement === document.body || !document.activeElement)) {
      // On a phone, Numbers, Plot and ngspice output open from More: back to More.
      const tab = document.querySelector<HTMLElement>(phone ? `.bar .tab--${was}` : `.tabs .tab--${was}`) ?? (phone ? barMore.current : null);
      tab?.focus({ preventScroll: true });
    }
  }, [panel, phone]);

  // The phone's Parts and More sheets: opened, the focus goes to the sheet's heading; closed (or left
  // by one of its buttons), back to the bar's button that opened it, never to the page itself.
  const barParts = useRef<HTMLButtonElement | null>(null);
  const barMore = useRef<HTMLButtonElement | null>(null);
  const sheetWas = useRef<'parts' | 'more' | undefined>(undefined);
  useEffect(() => {
    const now = partsSheet ? 'parts' : moreSheet ? 'more' : undefined;
    const was = sheetWas.current;
    sheetWas.current = now;
    if (now && now !== was) document.getElementById(`${now}-title`)?.focus({ preventScroll: true });
    else if (!now && was) {
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) (was === 'parts' ? barParts : barMore).current?.focus({ preventScroll: true });
    }
  }, [partsSheet, moreSheet]);
  /** A button of the More sheet that closes it: the focus waits on More first, so a dialog it opens gives it back there. */
  const fromMore = useCallback((action: () => void): void => {
    barMore.current?.focus({ preventScroll: true });
    action();
  }, []);

  const chooseTool = useCallback(
    (next: Tool) => {
      setTool(next);
      if (next !== 'select') {
        setCard(undefined);
        setEditing(false);
        setNoteWanted(false);
        announce(next === 'wire' ? t('hintWire', { back: phone ? t('hintBackPhone') : t('hintBackDesk') }) : t('hintPlacing', { part: toolPhrase(next), back: phone ? t('hintBackPhone') : t('hintBackDesk') }));
      }
      setPartsSheet(false);
    },
    [announce, phone],
  );

  const fit = useCallback(() => {
    setFitCount((n) => n + 1);
    canvas.current?.fit();
  }, []);

  const setFont = useCallback(
    (f: ResultFont) => {
      fontStore.set(f);
      announce(f === 'plain' ? t('fontNowPlain') : t('fontNowHand'));
    },
    [fontStore, announce],
  );

  const onSettings = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
    applySettings(next);
  }, []);

  /**
   * The text a link or an ngspice file carries: the netlist exactly as it is. Where the parts are
   * drawn goes with it when the netlist has it (its *@ lines: a value that moved the drawing, a
   * link that had them, and in step B every part moved by hand); a netlist without them is drawn
   * by the same automatic layout wherever it opens, so nothing is added that the student did not
   * write (decision 0016).
   */
  const sharedText = useCallback((): string => store.get(), [store]);

  const onExport = useCallback(
    async (kind: ExportKind) => {
      const { downloadFile, exportLtspice, exportNgspice } = await import('../export/export.ts');
      if (kind === 'ngspice') {
        const file = exportNgspice(sharedText());
        downloadFile(file);
        announce(t('saved', { filename: file.filename }));
        return;
      }
      const file = exportLtspice(store.get());
      downloadFile(file);
      setNotice({ tone: 'info', title: t('ltspiceNotesTitle', { filename: file.filename }), text: t('ltspiceNotesIntro'), items: file.notes });
      // The notes appear at the top of the page, away from the menu: say where.
      announce(t('ltspiceSaved', { filename: file.filename }));
    },
    [announce, store, sharedText],
  );

  const openOverlay = useCallback((key: OverlayKey, how: MenuFocus = 'first') => {
    setMenuFocus(how);
    setOverlay((o) => (o === key ? null : key));
    setMoreSheet(false);
  }, []);
  const closeOverlay = useCallback((key: OverlayKey) => setOverlay((o) => (o === key ? null : o)), []);

  const openPalette = useCallback(() => {
    lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    // Back where it was, unless the command took the focus somewhere (a panel's heading, a card's field, a dialog).
    requestAnimationFrame(() => {
      const active = document.activeElement;
      const lost = !active || active === document.body || !active.isConnected;
      if (lost && lastFocus.current?.isConnected && !document.querySelector('.modal-overlay, .popover')) lastFocus.current.focus({ preventScroll: true });
    });
  }, []);

  // ------------------------------------------------------------------ the keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const inEditor = !!target?.closest('.cm-editor');
      const typing = !!target?.closest('input, textarea, select') || inEditor;
      const mod = e.ctrlKey || e.metaKey;
      const inOverlay = !!target?.closest('.modal-overlay, .popover, [role=menu]');
      if (mod && !e.altKey && e.key.toLowerCase() === 'k') {
        if (inOverlay) return;
        e.preventDefault();
        if (paletteOpen) closePalette();
        else openPalette();
        return;
      }
      if (paletteOpen || inOverlay) return;
      if (e.key === 'Escape') {
        // A part tool in hand goes back to Select first, as the hint line says.
        if (partsSheet) setPartsSheet(false);
        else if (moreSheet) setMoreSheet(false);
        else if (card) closeCard();
        else if (tool !== 'select') setTool('select');
        else if (panel && !inEditor) setPanel(undefined);
        else if (selected && !inEditor) setSelected(undefined);
        else return;
        e.preventDefault();
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod || e.altKey) return;
      // Single keys work while the drawing or the toolbar has the focus (WCAG 2.1.4).
      if (!target?.closest('.nb-canvas, .tools')) return;
      if (e.key === '+' || e.key === '=') canvas.current?.zoomBy(1.2);
      else if (e.key === '-') canvas.current?.zoomBy(1 / 1.2);
      else if (e.key === '!') fit();
      else {
        const next = e.key.length === 1 ? toolForKey(e.key) : undefined;
        if (!next) return;
        chooseTool(next);
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, partsSheet, moreSheet, card, panel, tool, selected, closeCard, closePalette, openPalette, undo, redo, chooseTool, fit]);

  // Ctrl+Enter (Cmd+Enter) runs from anywhere on the page, as the Run button says (aria-keyshortcuts).
  // Caught before anything else sees it (capture phase); menus and dialogs keep their keys. The
  // editor is included on purpose: CodeMirror's own Ctrl+Enter is lost in Chrome for Android with a
  // keyboard attached (it holds every Enter back and sends it again later without Ctrl).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.isComposing) return;
      if (e.target instanceof Element && e.target.closest('.modal-overlay, .popover, .scrim, [role=menu]')) return;
      e.preventDefault();
      e.stopPropagation();
      runNow();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [runNow]);

  // ------------------------------------------------------------------ Ctrl+K's commands
  const commands = useMemo((): Command[] => {
    const list: Command[] = [];
    const gRun = t('paletteGroupRun');
    if (liveState.running?.slow) list.push({ id: 'stop', group: gRun, label: t('paletteStop'), keywords: 'stop cancel' });
    list.push({ id: 'run', group: gRun, label: t('paletteRun'), keywords: 'simulate solve ngspice', shortcut: 'Ctrl ↵' });
    if (snap.canUndo) list.push({ id: 'undo', group: gRun, label: t('undo'), shortcut: 'Ctrl Z' });
    if (snap.canRedo) list.push({ id: 'redo', group: gRun, label: t('redo'), shortcut: 'Ctrl Shift Z' });
    for (const id of PANELS) {
      const name = panelTitle(id);
      list.push({ id: `panel:${id}`, group: t('paletteGroupPanels'), label: panel === id ? t('paletteClosePanel', { panel: name }) : t('paletteOpenPanel', { panel: name }), keywords: id });
    }
    const gCircuit = t('paletteGroupCircuit');
    list.push({ id: 'share', group: gCircuit, label: t('paletteShare'), keywords: 'link copy' });
    list.push({ id: 'export:ngspice', group: gCircuit, label: t('exportNgspice'), keywords: 'export save download file cir' });
    list.push({ id: 'export:ltspice', group: gCircuit, label: t('exportLtspice'), keywords: 'export save download file net' });
    const gDrawing = t('paletteGroupDrawing');
    list.push({ id: 'fit', group: gDrawing, label: t('zoomFit'), keywords: 'zoom screen whole', shortcut: 'Shift 1' });
    list.push({ id: 'zoom-in', group: gDrawing, label: t('zoomIn'), keywords: 'bigger', shortcut: '+' });
    list.push({ id: 'zoom-out', group: gDrawing, label: t('zoomOut'), keywords: 'smaller', shortcut: '−' });
    if (phone && turned) list.push({ id: 'turn', group: gDrawing, label: turnWanted ? t('paletteAsDrawn') : t('paletteTurnToFit'), keywords: 'turn rotate upright phone' });
    for (const p of shown?.scene.parts ?? []) {
      list.push({ id: `part:${p.key}`, group: t('paletteGroupParts'), label: t('paletteChangePart', { name: p.name, kind: elementInfo(p.letter)?.name ?? p.letter }), keywords: `select open card ${p.letter} value` });
    }
    const gSettings = t('paletteGroupSettings');
    list.push({ id: 'font', group: gSettings, label: plain ? t('paletteHandwriting') : t('palettePlainFont'), keywords: 'handwriting plain font dyslexia caveat readable' });
    list.push({ id: 'settings', group: gSettings, label: t('paletteSettings'), keywords: 'preferences text size contrast motion font' });
    list.push({ id: 'help', group: gSettings, label: t('paletteHelp'), keywords: 'keys keyboard shortcuts licences' });
    // The open circuit's example comes last in its group. A video's examples are named with the
    // video ("Example 3: a and b open" is in three videos), and found by its words, accents or not.
    const plainWords = (words: string): string => words.normalize('NFD').replace(/\p{M}/gu, '');
    for (const e of [...EXAMPLES].sort((a, b) => Number(a.id === exampleId) - Number(b.id === exampleId))) {
      const video = EXAMPLE_GROUPS.find((g) => g.group === e.group && g.video)?.label;
      const label = video ? t('paletteOpenVideoExample', { name: e.name, video }) : t('paletteOpenExample', { name: e.name });
      list.push({ id: `example:${e.id}`, group: t('paletteGroupExamples'), label, keywords: `${e.id} example circuit video ${plainWords(`${video ?? ''} ${e.name}`)}` });
    }
    return list;
  }, [liveState.running?.slow, snap.canUndo, snap.canRedo, panel, phone, turned, turnWanted, shown, plain, exampleId]);

  const runCommand = (id: string): void => {
    const [kind, arg] = id.split(/:(.*)/s) as [string, string | undefined];
    if (kind === 'run') runNow();
    else if (kind === 'stop') stop();
    else if (kind === 'undo') undo();
    else if (kind === 'redo') redo();
    else if (kind === 'panel' && arg && (PANELS as readonly string[]).includes(arg)) togglePanel(arg as PanelId);
    else if (kind === 'share') setOverlay('share');
    else if (kind === 'export' && (arg === 'ngspice' || arg === 'ltspice')) void onExport(arg);
    else if (kind === 'fit') fit();
    else if (kind === 'zoom-in') canvas.current?.zoomBy(1.2);
    else if (kind === 'zoom-out') canvas.current?.zoomBy(1 / 1.2);
    else if (kind === 'turn') setTurnWanted((w) => !w);
    else if (kind === 'part' && arg) openCard(arg);
    else if (kind === 'font') setFont(plain ? 'handwriting' : 'plain');
    else if (kind === 'settings') setOverlay('settings');
    else if (kind === 'help') setOverlay('help');
    else if (kind === 'example' && arg) onExample(arg);
  };

  // ------------------------------------------------------------------ what covers the paper
  // The drawing fits in the rest (the card is not in it: it goes beside its part, decision 0015).
  const [topRef, topRect] = useRect<HTMLElement>();
  const [toolsRef, toolsRect] = useRect<HTMLElement>();
  const [bottomRef, bottomRect] = useRect<HTMLElement>();
  const [tabsRef, tabsRect] = useRect<HTMLElement>();
  const [sheetRef, sheetRect] = useRect<HTMLElement>();
  const [stackRef, stackRect] = useRect<HTMLElement>();
  const [noteRef, noteRect] = useRect<HTMLElement>();
  const [cardRef, cardRect] = useRect<HTMLDivElement>();
  const firstScreenInvite = shown?.scene.parts.find((p) => p.key === 'r1') ?? shown?.scene.parts.find((p) => p.letter === 'R');
  const noteShown = !phone && noteWanted && tool === 'select' && !card && !panel && !paletteOpen && !!firstScreenInvite && !!schematic;
  const phoneSheet: 'card' | 'parts' | 'more' | 'panel' | undefined = phone ? (card ? 'card' : partsSheet ? 'parts' : moreSheet ? 'more' : panel ? 'panel' : undefined) : undefined;
  const strip = phone && !!card && editing;
  const vw = win.width;
  const vh = win.height;
  const rightEdge = !phone ? Math.min(tabsRect.width ? tabsRect.left : vw, panel && sheetRect.width ? sheetRect.left : vw) : vw;
  const stackBottom = stackRect.height ? stackRect.bottom : 0;
  /** The free paper on a computer, where the card and the note may go (screen pixels). */
  const area: Box = { x0: toolsRect.right + 12, y0: Math.max(topRect.bottom, stackBottom) + 8, x1: rightEdge - 12, y1: (bottomRect.height ? bottomRect.top : vh) - 6 };
  // A card on a computer: its height when it opened, and whether it is docked along the bottom (below).
  const [cardMeasure, setCardMeasure] = useState<{ session: number; height: number } | undefined>(undefined);
  const [dockedSession, setDockedSession] = useState<number | undefined>(undefined);
  const measured = !!card && cardMeasure?.session === card.session;
  const cardH = Math.ceil(Math.max(CARD_H * textScale, measured ? cardMeasure.height : 0));
  const docked = !phone && !!card && dockedSession === card.session;
  // As wide as the text needs (larger text, a wider card: it wraps less and stays short).
  const cardWidth = Math.min(CARD_W * textScale, Math.max(320, area.x1 - area.x0));
  const insets: Insets = phone
    ? // The stack along the bottom, lifted above the keyboard while a value is typed.
      { top: Math.max(topRect.bottom, stackBottom) + 4, right: 4, left: 16, bottom: bottomRect.height ? vh - bottomRect.top + 4 : 0 }
    : {
        top: Math.max(topRect.bottom, stackBottom) + 10,
        left: toolsRect.right + 18,
        right: vw - rightEdge + 14,
        // A docked card: the drawing fits above it.
        bottom: (bottomRect.height ? vh - bottomRect.top + 4 : 0) + (docked ? cardH + 16 : 0),
      };

  // On a phone, what to keep in view: with a card open, the part and the nodes it changes; while its
  // value is typed, the view fits just those.
  const cardFocus = useMemo((): Box | undefined => {
    if (!phone || !card || !shown) return undefined;
    const sc = shown.scene;
    const part = sc.parts.find((p) => p.key === card.key);
    if (!part) return undefined;
    const boxes: Box[] = [part.box, part.labelBox];
    for (const pin of part.pins) if (pin.node !== GROUND) boxes.push(...[nodeBox(sc, pin.node)].filter((b): b is Box => !!b));
    for (const r of relatedOf(part.part)) {
      const b = r.kind === 'node' ? nodeBox(sc, r.name) : partBox(sc, r.key);
      if (b) boxes.push(b);
    }
    return unionBoxes(boxes);
  }, [phone, card, shown]);
  const frame = strip && cardFocus ? inflate(cardFocus, 0.6) : undefined;

  // The card on a computer: beside its part, the drawing panned once if that makes room. Placed once
  // when it opens (or the window or the panels change), never again as its value is typed: it keeps
  // its place while it grows, away from its part. Its height is measured when it opens (larger text
  // makes it taller); where no side of the part has room, it is docked along the bottom of the paper
  // and the drawing fits above it, so it never covers the part or the numbers it changes.
  const base = viewInfo?.base;
  const [placement, setPlacement] = useState<CardPlacement | undefined>(undefined);
  useLayoutEffect(() => {
    if (!card || phone || !cardRect.height) return;
    setCardMeasure((m) => (m?.session === card.session ? m : { session: card.session, height: cardRect.height }));
  }, [card, phone, cardRect.height]);
  useLayoutEffect(() => {
    if (phone || !card || !base || !topRect.height || !bottomRect.height || !shown || !measured) {
      setPlacement(undefined);
      return;
    }
    if (dockedSession === card.session) return;
    const p = placeCard({ scene: shown.scene, part: card.key, view: base, area, width: cardWidth, height: cardH });
    if (!p || p.cost > 0) {
      setPlacement(undefined);
      setDockedSession(card.session);
    } else setPlacement(p);
    // Not on every keystroke (shown changes as the value is typed), nor for the hint or the status line
    // changing height: only a new card, a new window size, or a panel opening or closing beside it.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, card?.key, card?.session, measured, base?.unit, base?.x, base?.y, circuitKey, turnWanted, area.x0, area.x1, win.width, win.height]);
  const offset = placement && (placement.pan.x || placement.pan.y) ? placement.pan : undefined;

  // On a computer a small drawing is drawn at most so large that a part's card fits above or below
  // it, so the card never has to cover it (decision 0015); the size is kept while a card is open.
  // Not smaller than comfortable for that: a tall drawing (or one under a .tf card) keeps a size its
  // words read well at, and the card goes beside it or is docked.
  const sceneHeight = shown ? Math.max(1, shown.scene.bounds.y1 - shown.scene.bounds.y0) : 1;
  const comfortable = minUnitFor(MIN_TEXT_PX * textScale * 1.5);
  const deskCap = DESK_MAX_UNIT * textScale;
  const wantedMaxUnit = Math.min(deskCap, Math.max(comfortable, (area.y1 - area.y0 - CARD_H * textScale - 48) / sceneHeight));
  const [deskMaxUnit, setDeskMaxUnit] = useState(DESK_MAX_UNIT);
  useLayoutEffect(() => {
    if (!card && Math.abs(wantedMaxUnit - deskMaxUnit) > 0.01) setDeskMaxUnit(wantedMaxUnit);
  }, [card, wantedMaxUnit, deskMaxUnit]);
  const maxUnit = phone ? PHONE_MAX_UNIT * textScale : Math.max(minUnit, deskMaxUnit);

  /** Where the card is now: where it was placed, moved with its part if the reader has moved the drawing since. */
  const cardNow = useMemo(() => {
    if (!placement || !viewInfo || !card || !shown) return undefined;
    const planned = { unit: viewInfo.base.unit, x: viewInfo.base.x + placement.pan.x, y: viewInfo.base.y + placement.pan.y };
    const part = shown.scene.parts.find((p) => p.key === card.key);
    if (!part) return undefined;
    const a = boxOnScreen(planned, part.box);
    const b = boxOnScreen(viewInfo.view, part.box);
    const dx = (b.x0 + b.x1) / 2 - (a.x0 + a.x1) / 2;
    const dy = (b.y0 + b.y1) / 2 - (a.y0 + a.y1) / 2;
    const move = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: p.x + dx, y: p.y + dy });
    const box = { x0: placement.box.x0 + dx, y0: placement.box.y0 + dy, x1: placement.box.x1 + dx, y1: placement.box.y1 + dy };
    return { box, side: placement.side, notch: move(placement.notch), ...(placement.leader ? { leader: { from: move(placement.leader.from), to: move(placement.leader.to) } } : {}) };
  }, [placement, viewInfo, card, shown]);

  // Red pen on the drawing: traps next to their part (the misread value circled), "No single answer
  // at node n1" next to the node, and while a card is open, the old node voltages crossed out.
  const beforeResults = useMemo(() => (card?.before && shown ? placeResults(shown.scene, answers(card.before)) : undefined), [card?.before, shown]);
  const pen = useMemo((): PenMarks | undefined => {
    if (!viewInfo || !shown || !schematic) return undefined;
    const sc = shown.scene;
    const visible = boxOnGrid(viewInfo.base, phone ? { x0: insets.left, y0: insets.top, x1: viewInfo.size.width - insets.right, y1: viewInfo.size.height - insets.bottom } : area);
    const within: Box = { x0: Math.max(visible.x0, sc.bounds.x0 - 4), y0: Math.max(visible.y0, sc.bounds.y0 - 4), x1: Math.min(visible.x1, sc.bounds.x1 + 4), y1: Math.min(visible.y1, sc.bounds.y1 + 4) };
    const avoid: Box[] = cardNow ? [inflate(boxOnGrid(viewInfo.view, cardNow.box), 0.3)] : [];
    const notes: PenNote[] = [];
    const circled = new Set<string>();
    for (const [key, trap] of [...partTraps].slice(0, 2)) {
      const about = partBox(sc, key);
      const part = schematic.circuit.parts.find((p) => p.key === key);
      if (!about || !part) continue;
      if (onValueField(trap, part, schematic.netlist)) circled.add(key);
      const note = placeNote(sc, about, trap.title, { area: within, avoid: [...avoid, ...notes.map((n) => n.box)] });
      if (note) notes.push(note);
    }
    const ns = current ? record.noSingleAnswer : undefined;
    const about = ns ? nodeBox(sc, ns.at) : undefined;
    if (ns && about) {
      const note = placeNote(sc, about, ns.title, { area: within, avoid: [...avoid, ...notes.map((n) => n.box)] });
      if (note) notes.push(note);
    }
    const was = card && current ? wasMarks(sc, results, beforeResults, [...avoid, ...notes.map((n) => n.box)]) : [];
    return notes.length || was.length || circled.size ? { notes, was, circled } : undefined;
    // insets and area by their numbers
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [viewInfo?.base, viewInfo?.view, viewInfo?.size, shown, schematic, current, partTraps, record, card, results, beforeResults, cardNow?.box.x0, cardNow?.box.y0, phone]);

  // The sticky note on a computer: beside the part it invites you to change, with a pen arrow to it.
  const notePlace = useMemo(() => {
    if (!noteShown || !viewInfo || !noteRect.width || !firstScreenInvite || !shown) return undefined;
    const part = firstScreenInvite;
    const room = drawingRoom(shown.scene, viewInfo.view, area);
    const target = boxOnScreen(viewInfo.view, unionBoxes([part.box, part.labelBox])!);
    const p = placeBeside(target, noteRect.width + 8, noteRect.height + 8, room, { gap: 30, sides: ['above', 'right', 'left', 'below'], step: 8 });
    if (!p || p.cost > 0) return undefined;
    const box = { x0: p.box.x0 + 4, y0: p.box.y0 + 4, x1: p.box.x1 - 4, y1: p.box.y1 - 4 };
    const name = part.labels.find((l) => l.role === 'name');
    // The arrow keeps off the words as written (not the room kept for longer numbers), off every
    // symbol and its leads (a part's box runs pin to pin) and off the wires; it ends beside the part
    // as a whole, never on a lead, where it would read as a wire or a current's arrow.
    const arrow = inviteArrow(
      box,
      boxOnScreen(viewInfo.view, part.box),
      [...inkBoxes(shown.scene, results), ...symbolBoxes(shown.scene)].map((b) => boxOnScreen(viewInfo.view, b)),
      room.segments,
      name ? boxOnScreen(viewInfo.view, name.box) : undefined,
    );
    return { box, ...(arrow ? { arrow } : {}) };
    // area by its numbers
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [noteShown, viewInfo?.view, noteRect.width, noteRect.height, firstScreenInvite?.key, shown, results, area.x0, area.y0, area.x1, area.y1]);

  /** The note was measured and the page is drawn, but no free paper fits it: the hint line invites instead. */
  const noteNoRoom = noteShown && noteRect.width > 0 && !!viewInfo && !notePlace;

  // ------------------------------------------------------------------ words for the frame
  const status = statusWords(engineStatus, liveState, text, phone, hasParts(netlist));
  // The card says what the status line says about runs: about to answer, or waiting for Run (and why).
  const cardRun: CardRun = { waiting: status.tone === 'busy', ...(status.tone === 'paused' || status.tone === 'bad' ? { stalled: status.detail ?? status.main } : {}) };
  const cardPart = card ? schematic?.circuit.parts.find((p) => p.key === card.key) : undefined;
  const cardProps = cardPart && card && schematic ? cardContent(cardPart, card, schematic, record, text, cardRun) : undefined;
  const empty = !tooBig && !!schematic && schematic.scene.parts.length === 0;
  const hint = hintWords({
    phone,
    tool,
    selectedName: selectedPart?.name,
    typeHint: cardProps?.label ? cardProps.typeHint : undefined,
    paused: status.tone === 'paused',
    whole: viewInfo?.whole ?? true,
    turned: !!turned && shown === turned,
    asDrawn: asDrawnOnPhone,
    invite: ((phone && noteWanted) || noteNoRoom) && firstScreenInvite ? firstScreenInvite.name : undefined,
    undrawn: tooBig,
    empty,
  });
  const plotAvailable = hasSweeps(record);
  /** The netlist's sweep lines (.dc, .tran), by name. */
  const sweepNames = useMemo(() => [...new Set(netlist.analyses.map((i) => netlist.lines[i]?.directive?.name).filter((n): n is string => n === '.dc' || n === '.tran'))], [netlist]);
  const tf = current && record.status === 'ok' && record.words.tf ? tfRows(record.words.tf) : [];
  const sweeps = current && record.status === 'ok' ? record.words.sweeps : [];
  const notDrawn = schematic?.circuit.notDrawn ?? [];

  const cardHandlers = {
    onValue,
    onPutBack: () => card && cardWrite(card.start, 'put-back'),
    onUseFix: (value: string) => cardWrite(value, 'typed'),
    onNumbers: () => openPanel('numbers'),
    onClose: () => closeCard(),
    onExplain: () => {
      openPanel('explain');
      if (phone) {
        setCard(undefined);
        setEditing(false);
      }
    },
    onFix: () => {
      openPanel('checks');
      if (phone) {
        setCard(undefined);
        setEditing(false);
      }
    },
  };

  /**
   * The card on a computer, beside its part (place.ts), with its notch, and a leader only when it
   * crosses nothing; docked along the bottom of the paper when no side has room.
   */
  const overlayOnPaper = (info: CanvasViewInfo): ReactNode => {
    if (!cardProps || phone || !card) return null;
    const own = { ...cardProps, ...cardHandlers, takeFocus: card.focus !== false, session: card.session };
    let style: CSSProperties;
    let where: { side?: Side; notch?: number } = {};
    let leader: { from: { x: number; y: number }; to: { x: number; y: number } } | undefined;
    if (docked) {
      style = { left: area.x0 + Math.max(0, (area.x1 - area.x0 - cardWidth) / 2), bottom: info.size.height - area.y1, width: cardWidth };
    } else if (cardNow) {
      const { box, side, notch } = cardNow;
      leader = cardNow.leader;
      style = side === 'above' ? { left: box.x0, bottom: info.size.height - box.y1, width: cardWidth } : { left: box.x0, top: box.y0, width: cardWidth };
      where = { side, notch: side === 'above' || side === 'below' ? notch.x - box.x0 : notch.y - box.y0 };
    } else {
      // Measured before it is placed: unseen for that moment (the focus is already in it).
      style = { left: Math.max(12, area.x0), top: Math.max(12, area.y0), width: cardWidth };
    }
    // The same two children every time, so the card (and the focus in its field) is never made again.
    return (
      <>
        {leader ? (
          <svg className="leader" aria-hidden="true" focusable="false">
            <path d={`M${leader.from.x} ${leader.from.y} L${leader.to.x} ${leader.to.y}`} />
          </svg>
        ) : null}
        <div ref={cardRef} className={`pinned${docked ? ' is-docked' : cardNow ? '' : ' is-placing'}`} style={style}>
          <IndexCard {...own} variant="pinned" {...where} />
        </div>
      </>
    );
  };

  // A drawing wider than the window (as drawn on a phone, a long circuit on a laptop): the edges say
  // there is more, judged by the ink on the paper (not the room kept around it for longer numbers).
  const inkParts = useMemo((): Box[] => {
    if (!shown) return [];
    const wires = shown.scene.wires.map((w) => unionBoxes(w.points.map((p) => ({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })))).filter((b): b is Box => !!b);
    return [...symbolBoxes(shown.scene), ...inkBoxes(shown.scene, results), ...wires];
  }, [shown, results]);
  const ink = useMemo(() => unionBoxes(inkParts), [inkParts]);
  const edges = useMemo(() => {
    const none = { left: false, right: false, top: 0 };
    if (!viewInfo || strip || !ink || !shown || (phone && !asDrawnOnPhone)) return none;
    const c = boxOnScreen(viewInfo.view, ink);
    const left = c.x0 < insets.left - 4;
    const right = c.x1 > viewInfo.size.width - insets.right + 4;
    if (!left && !right) return none;
    // Half way down the free paper, or higher or lower where that keeps the button off the drawing's words.
    const y0 = insets.top + 8;
    const y1 = viewInfo.size.height - insets.bottom - 52;
    const onScreen = inkParts.map((b) => boxOnScreen(viewInfo.view, b));
    const clear = (top: number): boolean =>
      !onScreen.some((b) => b.y0 < top + 44 && b.y1 > top && ((left && b.x0 < insets.left + 90) || (right && b.x1 > viewInfo.size.width - insets.right - 90)));
    const middle = Math.round((y0 + y1) / 2);
    const tries = [middle, ...Array.from({ length: 24 }, (_, i) => middle + (i % 2 ? 1 : -1) * Math.ceil((i + 1) / 2) * 24)].filter((y) => y >= y0 && y <= y1);
    return { left, right, top: tries.find(clear) ?? middle };
    // insets by their numbers
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, asDrawnOnPhone, viewInfo, ink, inkParts, shown, strip, insets.left, insets.right, insets.top, insets.bottom]);
  /** The edge buttons: small, and where they cover none of the drawing's words if they can. */
  const edgeTop = edges.top;
  const panSideways = (dir: 1 | -1): void => {
    if (!viewInfo || !ink) return;
    const c = boxOnScreen(viewInfo.view, ink);
    const visible = viewInfo.size.width - insets.left - insets.right;
    const step = visible * 0.7;
    // Never past the drawing's ends.
    const dx = dir > 0 ? -Math.min(step, c.x1 - (viewInfo.size.width - insets.right) + 10) : Math.min(step, insets.left - c.x0 + 10);
    canvas.current?.panBy(dx, 0);
  };

  // The selected line goes to the Netlist panel's cursor; the cursor's line selects its part.
  const onCursorLine = useCallback(
    (line: number) => {
      setSelectedLine(line);
      const p = schematic?.circuit.parts.find((x) => x.line + 1 === line);
      if (p && shown?.scene.parts.some((x) => x.key === p.key)) setSelected((s) => (s?.kind === 'part' && s.key === p.key ? s : { kind: 'part', key: p.key }));
    },
    [schematic, shown],
  );
  const goToLine = useCallback(
    (line: number) => {
      setSelectedLine(line);
      openPanel('netlist');
      // The editor may still be on its way (its code loads with the panel's first opening).
      let tries = 0;
      const go = (): void => {
        const editor = editorRef.current;
        if (editor) editor.goToLine(line);
        else if (tries++ < 40) window.setTimeout(go, 50);
      };
      requestAnimationFrame(go);
    },
    [openPanel],
  );

  /** The Netlist panel's "This line": the cursor's line, field by field. */
  const thisLine = useMemo(() => (panel === 'netlist' && selectedLine !== undefined ? explainLine(netlist, selectedLine - 1) : undefined), [panel, netlist, selectedLine]);

  const explainSelection = useMemo((): ExplainSelection | undefined => {
    if (!schematic) return selectedLine === undefined ? undefined : { kind: 'line', line: selectedLine };
    const words = current ? answers(record) : undefined;
    const nodeText = (n: string): string => schematic.circuit.nodes.get(n)?.text ?? n;
    if (selected?.kind === 'node') {
      const n = results.nodes.find((x) => x.node === selected.name);
      const name = selected.name === GROUND ? t('groundName') : nodeText(selected.name);
      return { kind: 'node', name, parts: describeNode(schematic, selected.name), ...(n ? { voltage: n.mark ? n.mark.text : n.words.text } : {}) };
    }
    if (selectedLine === undefined) return undefined;
    const part = schematic.circuit.parts.find((p) => p.line + 1 === selectedLine);
    const c = part ? words?.currents.find((x) => x.element === part.key) : undefined;
    return { kind: 'line', line: selectedLine, ...(c ? { current: currentText(c, nodeText) } : {}), ...(c?.power ? { power: c.power.text } : {}) };
  }, [schematic, selected, selectedLine, current, record, results]);

  const panelBody = (id: PanelId): ReactNode => {
    switch (id) {
      case 'netlist':
        return (
          <NetlistPanel
            store={store}
            fileName={fileNameOf(titleLine)}
            traps={traps}
            checkedText={read.text}
            colours={colours}
            notes={current ? record.annotations : NO_NOTES}
            notesText={current ? record.text : undefined}
            drawingLines={drawingLineCount}
            folded={folded}
            onFolded={setFolded}
            showLine={selectedLine}
            onCursorLine={onCursorLine}
            onFix={(fix) => applyFix(fix, 'editor')}
            onRun={runNow}
            onUndo={undo}
            onRedo={redo}
            onFocusChange={setTypingNetlist}
            editorRef={editorRef}
            thisLine={thisLine}
            phone={phone}
            {...(createEditor ? { create: createEditor } : {})}
          />
        );
      case 'checks':
        return (
          <ChecksPanel
            traps={traps}
            partOfLine={(line) => schematic?.circuit.parts.find((p) => p.line + 1 === line)?.name}
            onGoToLine={(trap) => goToLine(trap.line)}
            onFix={(fix) => applyFix(fix, 'panel')}
            headingRef={panelHeading}
          />
        );
      case 'explain':
        return (
          <ExplainPanel
            netlist={netlist}
            selection={explainSelection}
            parts={(schematic?.scene.parts ?? []).map((p) => ({ key: p.key, name: p.name, kind: elementInfo(p.letter)?.name ?? p.letter }))}
            colours={colours}
            onGoToLine={goToLine}
            onPick={(key) => {
              setSelected({ kind: 'part', key });
              const p = schematic?.circuit.parts.find((x) => x.key === key);
              if (p) setSelectedLine(p.line + 1);
            }}
          />
        );
      case 'numbers':
        return (
          <NumbersPanel
            outcome={liveState.outcome}
            text={text}
            running={!!liveState.running}
            paused={!!paused}
            colours={colours}
            plotAvailable={plotAvailable}
            phone={phone}
            onGoToLine={goToLine}
            onShowChecks={() => openPanel('checks')}
            onShowPlot={() => openPanel('plot')}
          />
        );
      case 'plot': {
        if (plotAvailable && record) return <PlotPanel results={record.results} netlist={record.netlist} />;
        // Why there is no plot, for the state it is in: no sweep line; numbers that are not answers; not run yet.
        if (!sweepNames.length) return <p className="muted">{t('plotNone')}</p>;
        if (current && record && record.status !== 'ok') return <p className="muted">{t('plotNotAnswers')}</p>;
        return <p className="muted">{[t('plotWaiting'), status.tone === 'paused' ? status.detail : undefined].filter(Boolean).join(' ')}</p>;
      }
      case 'output':
        return <OutputPanel result={record?.run} added={record?.added ?? []} />;
    }
  };

  const panelSection = panel ? (
    <section id="panel" className={`sheet sheet--${panel}`} ref={sheetRef} aria-labelledby={`panel-${panel}-title`}>
      {phone ? <span className="grab" aria-hidden="true" /> : null}
      <PanelHead id={panel} {...(panel === 'checks' && checks.length ? { sub: checksSub(checks.length)! } : {})} onClose={() => setPanel(undefined)} headingRef={panelHeading} />
      {panel === 'netlist' ? (
        <div className="card-body">{panelBody(panel)}</div>
      ) : (
        // A panel's words may be longer than the panel (large text): its box scrolls, so the keyboard
        // can reach it and scroll it with the arrow keys (WCAG 2.1.1).
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex, jsx-a11y/prefer-tag-over-role
        <div className="card-body" tabIndex={0} role="group" aria-labelledby={`panel-${panel}-title`}>
          {panelBody(panel)}
        </div>
      )}
    </section>
  ) : null;

  const partsSection = (
    // A sheet over the page, not a modal <dialog>: the drawing stays usable beside it.
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
    <section className="sheet sheet--parts" ref={sheetRef} role="dialog" aria-modal="false" aria-labelledby="parts-title">
      <span className="grab" aria-hidden="true" />
      <div className="card-head">
        <div className="card-head__titles">
          <h2 className="card-head__title" id="parts-title" tabIndex={-1}>
            {t('partsSheetTitle')}
          </h2>
          <p className="card-head__sub">{t('partsSheetSub')}</p>
        </div>
        <button className="icon-button" type="button" aria-label={t('partsClose')} onClick={() => setPartsSheet(false)}>
          <LineIcon name="close" />
        </button>
      </div>
      <div className="card-body parts-sheet">
        <PartsSheetList tool={tool} onPick={chooseTool} />
      </div>
    </section>
  );

  const zoomPercent = viewInfo ? Math.round((viewInfo.unit / 20) * 100) : undefined;
  const lines = (
    <StatusLines
      hint={hint}
      status={status}
      analysis={analysis}
      phone={phone}
      {...(!phone ? { zoom: { percent: zoomPercent, onIn: () => canvas.current?.zoomBy(1.2), onOut: () => canvas.current?.zoomBy(1 / 1.2), onFit: fit } } : {})}
      {...(phone && turned ? { turn: { turned: turnWanted, onToggle: () => setTurnWanted((w) => !w) } } : {})}
      // The first screen on a phone: the sticky note's button, on the hint line.
      {...(phone && noteWanted && firstScreenInvite && !card ? { invite: { label: t('noteButton', { name: firstScreenInvite.name }), onClick: () => openCard(firstScreenInvite.key) } } : {})}
    />
  );

  const inert = paletteOpen;
  const topStack =
    notice || update || tf.length || sweeps.length || notDrawn.length ? (
      <div className="paper-stack" ref={stackRef} inert={inert}>
        {update ? <UpdateCard onReload={update} /> : null}
        {notice ? (
          <NoticeCard
            notice={notice}
            onDismiss={() => {
              setNotice(null);
              // The message (and its button) goes away: continue on the drawing.
              requestAnimationFrame(() => document.querySelector<HTMLElement>('.nb-hit[tabindex="0"]')?.focus({ preventScroll: true }));
            }}
          />
        ) : null}
        {tf.length || sweeps.length ? (
          <ResultsCard tf={tf} sweeps={sweeps} analysis={NAVIGATE_STRINGS.and(sweepNames)} pending={!current} onNumbers={() => openPanel('numbers')} onPlot={plotAvailable ? () => openPanel('plot') : undefined} />
        ) : null}
        {notDrawn.length ? (
          <p className="not-drawn">{NAVIGATE_STRINGS.notDrawn(NAVIGATE_STRINGS.and(notDrawn.map((n) => NAVIGATE_STRINGS.notDrawnItem(n.name, n.lineNumber))))}</p>
        ) : null}
      </div>
    ) : null;

  return (
    <div className={`app nb-theme${phone ? ' is-phone' : ' is-desktop'}${plain ? ' nb-plain' : ''}${strip ? ' is-editing' : ''}${phone && typingNetlist ? ' is-typing-netlist' : ''}`} data-tool={tool}>
      <a
        className="skip-link"
        href="#drawing"
        onClick={(e) => {
          e.preventDefault();
          if (selected) canvas.current?.focusItem(selected);
          else document.querySelector<HTMLElement>('.nb-hit[tabindex="0"]')?.focus();
        }}
      >
        {t('skipToDrawing')}
      </a>

      <div className="top-area">
        <TopBar
          phone={phone}
          title={title}
          open={overlay}
          onOpen={openOverlay}
          examplesRef={examplesRef}
          exportRef={exportRef}
          canUndo={snap.canUndo}
          canRedo={snap.canRedo}
          onUndo={undo}
          onRedo={redo}
          onPalette={openPalette}
          stoppable={!!liveState.running?.slow}
          wanted={!!paused}
          onRun={runNow}
          onStop={stop}
          headerRef={topRef}
          inert={inert}
        />

        {topStack}
      </div>

      {!phone ? (
        <nav className="margin" ref={toolsRef} inert={inert} aria-label={t('partsLabel')}>
          <PartsToolbar tool={tool} onTool={chooseTool} />
        </nav>
      ) : null}

      <main id="drawing" className="paper" inert={inert} aria-labelledby={drawingNameId}>
        <h2 className="visually-hidden" id={drawingNameId}>
          {t('drawingHeading')}
        </h2>
        {empty ? (
          // Nothing to draw yet: where to start, on the paper itself.
          <section className="empty-card" aria-labelledby="empty-title" style={{ left: area.x0, top: area.y0, right: vw - area.x1, bottom: vh - area.y1 }}>
            <div className="empty-card__body">
              <h2 className="empty-card__title" id="empty-title">
                {t('emptyTitle')}
              </h2>
              <p>{t('emptyText')}</p>
              <p className="empty-card__actions">
                <button type="button" className="button button--primary" onClick={() => openPanel('netlist')}>
                  {t('emptyNetlist')}
                </button>
                <button type="button" className="button" onClick={() => openOverlay('examples')}>
                  {t('emptyExamples')}
                </button>
              </p>
            </div>
          </section>
        ) : null}
        {shown ? (
          <NotebookCanvas
            ref={canvas}
            schematic={shown}
            results={results}
            pending={!!record && !current}
            plain={plain}
            colours={colours}
            label={NOTEBOOK_STRINGS.drawingLabel(title)}
            pictureLabel={NOTEBOOK_STRINGS.pictureLabel(title)}
            description={description}
            selected={selected}
            related={related}
            traps={trapKeys}
            penWords={penWords}
            open={card?.key}
            pen={pen}
            onSelect={onSelect}
            onOpen={onOpen}
            onEscape={() => {
              if (card) closeCard();
              else setSelected(undefined);
            }}
            insets={insets}
            // A computer keeps its fit when a card opens; a phone fits again above the card's sheet,
            // and again above the strip while a value is typed.
            fitKey={`${circuitKey}:${fitCount}:${phone ? 'phone' : 'desk'}:${shown === turned ? 'turned' : 'as-drawn'}:${phone && card ? `card:${card.key}` : ''}:${strip ? 'edit' : ''}:${shown.scene.parts.length}`}
            minUnit={minUnit}
            maxUnit={maxUnit}
            padding={phone ? 10 : 24}
            fill={asDrawnOnPhone && phoneView.pans ? 'height' : 'whole'}
            focus={cardFocus}
            frame={frame}
            offset={offset}
            hold={!!card || typingNetlist}
            onView={setViewInfo}
            overlay={overlayOnPaper}
          />
        ) : (
          <div className="too-big">
            <p>{tn('tooBig', partCount)}</p>
          </div>
        )}
        <div className="margin-line" aria-hidden="true" />
        {edges.left ? (
          <button type="button" className="more-edge more-edge--left" style={{ top: edgeTop, left: phone ? 4 : insets.left - 14 }} onClick={() => panSideways(-1)}>
            <LineIcon name="chevron-left" />
            <span className="visually-hidden">{t('moreLeft')}</span>
          </button>
        ) : null}
        {edges.right ? (
          <button type="button" className="more-edge more-edge--right" style={{ top: edgeTop, right: phone ? 4 : insets.right - 10 }} onClick={() => panSideways(1)}>
            <span className="more-edge__word" aria-hidden="true">
              {t('moreWord')}
            </span>
            <LineIcon name="chevron-right" />
            <span className="visually-hidden">{t('moreRight')}</span>
          </button>
        ) : null}
        {notePlace?.arrow ? (
          <svg className="note-arrow" aria-hidden="true" focusable="false">
            <path d={`M${notePlace.arrow.from.x} ${notePlace.arrow.from.y} Q${notePlace.arrow.control.x} ${notePlace.arrow.control.y} ${notePlace.arrow.to.x} ${notePlace.arrow.to.y}`} />
            <ArrowHead from={notePlace.arrow.control} to={notePlace.arrow.to} />
          </svg>
        ) : null}
      </main>

      {noteShown ? (
        <StickyNote
          partName={firstScreenInvite?.name}
          onChange={() => firstScreenInvite && openCard(firstScreenInvite.key)}
          onHide={() => setNoteWanted(false)}
          noteRef={noteRef}
          // Shown only where it covers none of the drawing; until then (or where there is no such room,
          // as with large text on a small window) it stays hidden and the hint line invites instead.
          style={notePlace ? { left: notePlace.box.x0, top: notePlace.box.y0, right: 'auto' } : noteRect.width > 0 ? { visibility: 'hidden' } : undefined}
        />
      ) : null}

      {phone ? (
        // One stack along the bottom: the hint and status, a sheet, the bar. While a value is typed it
        // is only the card's strip, held above the keyboard.
        <div className={`phone-bottom${strip ? ' is-strip' : ''}`} ref={bottomRef} inert={inert} style={keyboard ? { bottom: keyboard } : undefined}>
          {phoneSheet === 'card' ? null : <footer className="phone-lines">{lines}</footer>}
          {phoneSheet === 'panel' ? panelSection : null}
          {phoneSheet === 'parts' ? partsSection : null}
          {phoneSheet === 'more' ? (
            <MoreSheet
              onPanel={(id) => openPanel(id)}
              onShare={() => fromMore(() => openOverlay('share'))}
              onExport={(kind) =>
                fromMore(() => {
                  setMoreSheet(false);
                  void onExport(kind);
                })
              }
              onHelp={() => fromMore(() => openOverlay('help'))}
              onUndo={undo}
              onRedo={redo}
              canUndo={snap.canUndo}
              canRedo={snap.canRedo}
              onZoom={(how) => {
                if (how === 'fit') fit();
                else canvas.current?.zoomBy(how === 'in' ? 1.2 : 1 / 1.2);
              }}
              onClose={() => setMoreSheet(false)}
              sheetRef={sheetRef}
            />
          ) : null}
          {phoneSheet === 'card' && cardProps ? (
            <div className="sheet sheet--card" ref={sheetRef as (el: HTMLDivElement | null) => void}>
              <IndexCard
                {...cardProps}
                {...cardHandlers}
                variant={strip ? 'strip' : 'sheet'}
                focusField={false}
                onFieldFocus={() => setEditing(true)}
                onFieldBlur={(next) => {
                  if (!next?.closest('.index-card')) setEditing(false);
                }}
                onDone={() => {
                  (document.activeElement as HTMLElement | null)?.blur();
                  setEditing(false);
                }}
              />
            </div>
          ) : null}
          {phoneSheet === 'card' ? null : (
            <BottomBar
              partsRef={barParts}
              moreRef={barMore}
              tool={tool}
              partsOpen={partsSheet}
              panel={panel}
              moreOpen={moreSheet}
              checks={checks.length}
              onSelectTool={() => chooseTool('select')}
              onParts={() => {
                setPartsSheet((o) => !o);
                setPanel(undefined);
                setMoreSheet(false);
              }}
              onPanel={togglePanel}
              onMore={() => {
                setMoreSheet((o) => !o);
                setPartsSheet(false);
                setPanel(undefined);
              }}
            />
          )}
        </div>
      ) : (
        <>
          <div className="right" inert={inert}>
            <PanelTabs open={panel} checks={checks.length} onToggle={togglePanel} tabsRef={tabsRef} />
            {panelSection}
          </div>
          <footer className="bottom" ref={bottomRef} inert={inert} style={{ right: Math.max(14, insets.right - 4) }}>
            {lines}
          </footer>
        </>
      )}

      <Overlays
        open={overlay}
        focus={menuFocus}
        onClose={closeOverlay}
        examplesTrigger={examplesRef}
        exportTrigger={exportRef}
        onExample={onExample}
        onExport={(kind) => void onExport(kind)}
        getShareText={sharedText}
        settings={settings}
        onSettings={onSettings}
        font={font}
        onFont={setFont}
        offlineReady={offlineReady}
      />
      {paletteOpen ? <CommandPalette commands={commands} onRun={runCommand} onClose={closePalette} /> : null}
    </div>
  );
}

/** A pen arrowhead at the end of a curve, pointing along it. */
function ArrowHead({ from, to }: { from: { x: number; y: number }; to: { x: number; y: number } }): ReactNode {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const l = 11;
  const w = 0.5;
  const p1 = { x: to.x - l * Math.cos(a - w), y: to.y - l * Math.sin(a - w) };
  const p2 = { x: to.x - l * Math.cos(a + w), y: to.y - l * Math.sin(a + w) };
  return <path className="note-arrow__head" d={`M${p1.x} ${p1.y} L${to.x} ${to.y} L${p2.x} ${p2.y}`} />;
}
