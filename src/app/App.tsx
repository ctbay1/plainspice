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
 * The schematic editor (decision 0017): the tools place parts and draw wires, parts are dragged,
 * turned, mirrored, reversed and deleted, nodes renamed, and a part added between two nodes from a
 * form; src/app/editing.ts turns the pointer and the keys into the model's edits (applyEdit), and
 * each one goes into the store as one undo step made on the drawing.
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
  coverCost,
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
  type CanvasEditing,
  type CanvasHandle,
  type CanvasViewInfo,
  type EditMarks,
  type CardPlacement,
  type Insets,
  type PenMarks,
  type PenNote,
  type ResultFont,
  type ResultFontStore,
  type Side,
} from '../notebook/index.ts';
import {
  EDIT_STRINGS,
  GROUND,
  NAVIGATE_STRINGS,
  applyEdit,
  buildSchematic,
  describeNode,
  describeSchematic,
  inflate,
  nextRotation,
  readDrawing,
  readingOrder,
  samePoint,
  segmentsOf,
  symbolGeometry,
  unionBoxes,
  type Box,
  type DrawingProblem,
  type EditOp,
  type EditResult,
  type NavItem,
  type PartLetter,
  type Point,
  type Rotation,
  type Schematic,
} from '../schematic/index.ts';
import { decodeShare } from '../share/link.ts';
import { formatSI, speakSI } from '../format/si.ts';
import { DESCRIBE_STRINGS, sentenceNode } from '../spice/describe.ts';
import { elementInfo } from '../spice/elements.ts';
import type { Fix, Trap } from '../spice/types.ts';
import { AnnouncerProvider, useAnnounce } from './announcer.tsx';
import { cardContent, noNumbersReason, onValueField, relatedOf, typeHint, type CardRun, type CardState } from './card.ts';
import { keepDrawing, schematicOf, spotValue, valueSpot, withValue, writeValue, type ValueSpot } from './card-edit.ts';
import { ChecksPanel } from './components/ChecksPanel.tsx';
import { CommandPalette, type Command } from './components/CommandPalette.tsx';
import { ExplainPanel, type ExplainSelection } from './components/ExplainPanel.tsx';
import { BottomBar, MoreSheet, NoticeCard, PANELS, PanelHead, PanelTabs, ResultsCard, StatusLines, StickyNote, UpdateCard, checksSub, panelTitle, type PanelId } from './components/Frame.tsx';
import { LineIcon, ToolGlyph } from './components/Icons.tsx';
import { IndexCard } from './components/IndexCard.tsx';
import { NetlistPanel, preloadEditor, type CreateEditor } from './components/NetlistPanel.tsx';
import { NumbersPanel, tfRows } from './components/NumbersPanel.tsx';
import { OutputPanel } from './components/OutputPanel.tsx';
import { Overlays, preloadOverlays, type ExportKind, type MenuFocus, type OverlayKey } from './components/Overlays.tsx';
import { PartsSheetList, PartsToolbar } from './components/PartsToolbar.tsx';
import type { ControlEditing, PartEditing } from './components/CardEdit.tsx';
import { NodeCard, type NodeCardProps } from './components/NodeCard.tsx';
import {
  addPartEdit,
  connectEdit,
  controlWords,
  deleteOp,
  disconnectEdit,
  dragTarget,
  editKey,
  endsOf,
  formStart,
  grabAt,
  grabOf,
  handFor,
  hasDrawingLines,
  hitTest,
  joinsWords,
  mirrorHand,
  movePreview,
  moveOp,
  nodeChoices,
  nodeEnd,
  nodeNamesIn,
  nodeSaid,
  nodeWords,
  placeEdit,
  refusedAnywhere,
  placePreview,
  reverseHand,
  sourceChoices,
  starterWords,
  stepFrom,
  symbolEnd,
  turnHand,
  wireEdit,
  wirePreview,
  wireStartOf,
  wireTargets,
  withUsedNodeNames,
  type EditKey,
  type Grab,
  type Hand,
  type MovePreview,
  type PartForm,
  type PieceOfWire,
  type WireDraft,
  type WireStart,
} from './editing.ts';
import { isPartKind, kindName, toolAliases, toolPhrase, type Tool } from './tools.ts';
import { PlotPanel } from './components/PlotPanel.tsx';
import { TopBar } from './components/TopBar.tsx';
import { isCancelled, isTimeout, RUN_TIMEOUT_MS, type Engine } from './engine.ts';
import { EXAMPLE_GROUPS, EXAMPLES, START_HERE_ID, drawnAsInVideo, exampleById, exampleName } from './examples.ts';
import { checksSaid, checksSaidFor, drawingWarnings as drawingWarningsOf, fixedText, stillToChoose } from './fixes.ts';
import { hintShowsNote, noteAfterTool, REFUSAL_SHOWN_MS, useNoteTimer, type HintNote } from './hint-note.ts';
import { useKeyboardInset, useMedia, useOverflowing, useRect, useTextScale, useWindowSize } from './hooks.ts';
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
import { afterColon, analysisName, hintWords, nodeInSentence, offsetWords, pressRun, statusWords, type EngineStatus } from './words.ts';

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
/**
 * A phone's window short for its text, at the usual text size (scaled with it, as the limits above,
 * for a window wider than tall): below the first the hint line steps out of sight and the bars get
 * compact (a phone on its side, a laptop window short for its text); below the second a calm status
 * folds to its dot (decision 0018).
 */
const SHORT_HEIGHT = 420;
const SHORTER_HEIGHT = 300;
/**
 * The free paper a phone keeps under its top bar, whatever the text size: a share of the window
 * below that bar, never less than the pixels. The stack along the bottom (and the hand bar above it)
 * never covers more: its lines and its sheet give way, and scroll (decision 0018).
 */
const PAPER_KEPT_SHARE = 0.15;
const PAPER_KEPT_PX = 48;
/**
 * What a sheet on a phone (Parts, More, a panel) keeps below its head, in rem (it grows with the text):
 * about two of its rows, or all of them when it has less. The status line stays above the sheet while
 * that is left (decision 0018).
 */
const SHEET_ROWS_KEPT_REM = 6;
/** The card on a computer: as wide and as tall as its tallest state at the usual text size (it is measured, too). */
const CARD_W = 680;
const CARD_H = 218;
/** A node's card at the usual text size (it is measured, too). */
const NODE_CARD_H = 190;
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

/** Something being moved: what, how (dragged, or picked up with the card's Move or Ctrl+K), its offset from the pointer, and where it would go now. */
interface MoveState {
  grab: Grab;
  how: 'drag' | 'pick';
  /** The pointer's offset from the grab's own point, in grid units. */
  offset: Point;
  /** A part turned or mirrored while it moves (T and M): how it lands. */
  turn?: { rot: Rotation; mirror: boolean };
  /** Where it would go now, as the model says (the drawing with it there, or why not). */
  preview: MovePreview | undefined;
}

/** A move's preview still says where it goes now: for this point, this turn, and the text as it is (never a preview of an older text). */
const previewFits = (m: MoveState, to: Point, text: string): boolean =>
  !!m.preview && samePoint(m.preview.to, to) && m.preview.base === text && m.preview.turn?.rot === m.turn?.rot && m.preview.turn?.mirror === m.turn?.mirror;

/** A node's card: which node (ngspice's name), the ground symbol chosen (ground), the name being typed, and why a rename was refused. */
interface NodeCardState {
  node: string;
  /** Just renamed to this: the card moves to it once the drawing has the new name. */
  renamed?: string;
  ground: number | undefined;
  session: number;
  input: string;
  refused?: string;
  focus: boolean;
}

const cap = (words: string): string => words.charAt(0).toUpperCase() + words.slice(1);

/** How long a refusal stays in the hint line however the pointer moves (time to read it). */
const REFUSAL_READ_MS = 1500;

/** The first sentence of an edit's summary: what Undo and Redo say they undid or redid. */
const firstSentence = (summary: string): string => summary.split(/(?<=\.)\s/)[0] ?? summary;

/** The 1-based line of a part in a text (the part an edit's summary says still names something). */
function linePartIn(text: string, key: string): number | undefined {
  const line = readNetlist(text).netlist.lines.find((l) => l.element?.key === key);
  return line ? line.number : undefined;
}

/** A point in grid units to a quarter unit: the pointer's place for the previews (they change at most four times a unit). */
const quarter = (p: Point): Point => ({ x: Math.round(p.x * 4) / 4, y: Math.round(p.y * 4) / 4 });
const gridPoint = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** How near the pointer must be to a pin or a wire to be on it, in grid units: half a unit, or 14 screen pixels when that is more. */
const nearness = (unit: number): number => Math.max(0.45, 14 / Math.max(1, unit));

/** A card open on a part: where its value is written, and the text the card last wrote (to see changes made elsewhere). */
interface CardEdit {
  session: number;
  spot: ValueSpot;
  /** The drawing of the text the card opened on (positions kept while the value changes, card-edit.ts). */
  drawn: Schematic;
  written: string;
}

/** Lines that wait at less than this had no room of their own above the sheet (out of sight): they stay out of sight. */
const LINE_WAIT_MIN_PX = 12;

/**
 * An open phone sheet held where it is (AP-2): its height, its scroll and the rows in view at its top, which
 * together put its rows on the screen.
 */
interface SheetHold {
  room: string;
  sheet: HTMLElement;
  body: HTMLElement;
  /** Its own rows coming or going lay it out afresh (Checks: a check found or fixed shows at once where it belongs). */
  afresh: boolean;
  /** How tall its rows are as they are laid out, without the room kept below them (Checks' rows changing). */
  rows: number;
  /** The sheet's own greatest height (app.css), in pixels. */
  cap: number;
  height: number;
  /** How tall the lines above it were when last drawn, and the room it gave them while held: it takes back only that. */
  above: number;
  given: number;
  /** The greatest height it is held to, in pixels. */
  max: number;
  /** Where its body's box began, from the sheet's bottom on the bar (the sheet sliding in moves both), and how far the body was scrolled, when last held. */
  top: number;
  scroll: number;
  /** The rows in view at the top of its body (rowsInView: the innermost first), with where each begins in what scrolls. */
  rowsInView: { el: Element; at: number }[];
  /** Room kept below its rows (app.css: --sheet-kept), so the rows in view stay where they are when rows below them go. */
  kept: number;
  /** Laid out afresh and not yet drawn: the steps above it may still settle, so it follows them. */
  fresh: boolean;
  /**
   * The row of its body a finger or the mouse last pressed (the button, or what was pressed), until the
   * student presses anything else, uses the keys or scrolls the sheet: a second tap may be on its way to it.
   */
  pressed: Element | undefined;
  /** Told when that row is pressed no more (the lines waiting for it may take their room). */
  onFree: (() => void) | undefined;
  release: () => void;
}

/** How tall the sheet is, to the fraction of a pixel (offsetHeight rounds, and a rounded size moved it). */
const heightOf = (sheet: HTMLElement): number => sheet.getBoundingClientRect().height;
/** How tall what stands above the sheet in the stack is (the hint and status lines). */
const aboveOf = (sheet: HTMLElement): number => sheet.previousElementSibling?.getBoundingClientRect().height ?? 0;
const besideFlow = (el: Element): boolean => /^(absolute|fixed)$/.test(getComputedStyle(el).position);
/** How tall a sheet's rows are as they are laid out (what its body holds, each box by itself). */
const rowsOf = (body: HTMLElement): number => {
  let sum = 0;
  for (const el of body.children) sum += el.getBoundingClientRect().height;
  return sum;
};

/**
 * How tall what a held sheet's body holds is, its padding included and the room kept below its rows not:
 * what it scrolls, less that room (the body's last box, app.css), so a margin that ends a row inside its
 * box (Numbers' last table, 12 px) counts as the browser counts it (the boxes' own margins missed it, and
 * 12 px of empty room was kept below Numbers' rows after each run at its end: the critic of the second
 * re-check's second fixes).
 */
const naturalOf = (held: SheetHold): number => held.body.scrollHeight - held.kept;

/** The element in a sheet's body the keys put the focus on (its focus ring shows), if any. */
function keyFocusIn(body: HTMLElement): Element | undefined {
  const el = document.activeElement;
  if (!el || el === body || !body.contains(el)) return undefined;
  try {
    return el.matches(':focus-visible') ? el : undefined;
  } catch {
    return undefined;
  }
}

/** What a press at this target is on in a sheet's body: its button or field, else what was pressed (none: outside the body). */
function rowPressed(body: HTMLElement, target: EventTarget | null): Element | undefined {
  if (!(target instanceof Element) || !body.contains(target) || target === body) return undefined;
  const control = target.closest('button, a[href], input, select, textarea, summary, label, [role="button"], [tabindex]');
  return control && body.contains(control) && control !== body ? control : target;
}

/**
 * The rows in view at the top of a sheet's body, with where each begins in what scrolls: the boxes in view
 * in it, then those inside the first of them, and so on, the innermost first (the first of them that is
 * still there is kept where it is: keepRows; Numbers' note for a run goes with the run, the result's
 * banner below it stays). A box that is the only one where it is (a panel's box around all its rows) is
 * gone through, not kept, unless nothing is found inside it: it stays when all its rows are new, and the
 * sheet is then laid out for the new ones.
 */
function rowsInView(body: HTMLElement): { el: Element; at: number }[] {
  const box = body.getBoundingClientRect();
  const view = box.top + body.clientTop;
  const end = view + body.clientHeight;
  const levels: { el: Element; at: number }[][] = [];
  let parent: Element = body;
  for (let depth = 0; depth < 8; depth++) {
    const level: { el: Element; at: number }[] = [];
    for (const el of parent.children) {
      const r = el.getBoundingClientRect();
      if (r.top >= end || level.length >= 8) break;
      if (r.height > 0 && r.bottom > view + 0.5 && !besideFlow(el)) level.push({ el, at: r.top - box.top + body.scrollTop });
    }
    if (!level.length) break;
    if (parent.childElementCount > 1) levels.push(level);
    parent = level[0]!.el;
  }
  if (!levels.length && parent !== body) levels.push([{ el: parent, at: parent.getBoundingClientRect().top - box.top + body.scrollTop }]);
  return levels.reverse().flat();
}

/** Where a sheet's body begins, from the sheet's bottom, which stands on the bar: the same while the sheet slides in. */
const bodyTopOf = (held: SheetHold): number => held.body.getBoundingClientRect().top - held.sheet.getBoundingClientRect().bottom;

/** Notes where a held sheet's rows are now. */
function noteRows(held: SheetHold): void {
  held.top = bodyTopOf(held);
  held.scroll = held.body.scrollTop;
  held.rowsInView = rowsInView(held.body);
}

/** Room kept below a sheet's rows, in pixels (app.css: --sheet-kept). */
function keepRoom(held: SheetHold, px: number): void {
  held.kept = px > 0.5 ? px : 0;
  if (held.kept) held.body.style.setProperty('--sheet-kept', `${held.kept}px`);
  else held.body.style.removeProperty('--sheet-kept');
}

/**
 * Holds a sheet as it is laid out, from the frame it is first drawn in (until then the lines above it may
 * still take a step: it follows them); its scroll is followed as the student scrolls it, and its rows are
 * kept where they are as they change size, before they are drawn (a plot drawn, a run's note, the editor's
 * lines: keepRows), whatever draws them.
 */
function holdSheet(room: string, sheet: HTMLElement, body: HTMLElement, afresh: boolean): SheetHold {
  sheet.style.removeProperty('max-height');
  const cap = Number.parseFloat(getComputedStyle(sheet).maxHeight);
  const held: SheetHold = {
    room,
    sheet,
    body,
    afresh,
    rows: 0,
    cap: Number.isFinite(cap) ? cap : Number.POSITIVE_INFINITY,
    height: 0,
    above: 0,
    given: 0,
    max: Number.POSITIVE_INFINITY,
    top: 0,
    scroll: 0,
    rowsInView: [],
    kept: 0,
    fresh: true,
    pressed: undefined,
    onFree: undefined,
    release: () => undefined,
  };
  measureSheet(held);
  const press = (row: Element | undefined): void => {
    if (row === held.pressed) return;
    held.pressed = row;
    held.onFree?.();
  };
  // The student's own scroll moves its rows: the rows in view are noted again, and room kept below them that
  // the scroll no longer needs goes (never more is kept for a scroll). (Its scroll set here is noted as it is
  // set: a scroll elsewhere is the student's, and the row last pressed is not aimed at again.)
  const onScroll = (): void => {
    if (Math.abs(body.scrollTop - held.scroll) > 0.5) press(undefined);
    if (held.kept) keepRoom(held, Math.min(held.kept, body.scrollTop + body.clientHeight - naturalOf(held)));
    noteRows(held);
  };
  // Anywhere on the page: a press on another row (or anything else) and the keys mean the row last pressed
  // is not about to be tapped again.
  const onPress = (e: PointerEvent): void => press(rowPressed(body, e.target));
  const onKey = (): void => press(undefined);
  const ro =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => {
          if (held.fresh) return;
          if (held.afresh && Math.abs(rowsOf(body) - held.rows) > 0.5) measureSheet(held);
          else keepRows(held);
        });
  const watch = (): void => {
    ro?.observe(body);
    for (const el of body.children) ro?.observe(el);
  };
  const mo = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(watch);
  mo?.observe(body, { childList: true });
  watch();
  body.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('pointerdown', onPress, { capture: true, passive: true });
  document.addEventListener('keydown', onKey, { capture: true, passive: true });
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      held.fresh = false;
      measureSheet(held);
    });
  });
  held.release = () => {
    cancelAnimationFrame(frame);
    ro?.disconnect();
    mo?.disconnect();
    body.removeEventListener('scroll', onScroll);
    document.removeEventListener('pointerdown', onPress, { capture: true });
    document.removeEventListener('keydown', onKey, { capture: true });
    held.onFree = undefined;
    sheet.style.removeProperty('max-height');
    keepRoom(held, 0);
  };
  return held;
}

/**
 * Whether the head of a held sheet, coming down as the lines above it take more room (its body's box has
 * moved down since its rows were noted, and they with it until they are kept), would cover any of the row
 * a finger last pressed while some of it is in view: a second tap on it would meet the head, or its ×.
 */
function coversPressed(held: SheetHold): boolean {
  const { body, pressed } = held;
  if (!pressed?.isConnected || !body.contains(pressed)) return false;
  const down = bodyTopOf(held) - held.top;
  if (down <= 0.5) return false;
  const r = pressed.getBoundingClientRect();
  const view = body.getBoundingClientRect().top + body.clientTop;
  return r.bottom > view + 0.5 && r.top < view + body.clientHeight - 0.5 && r.top - view < down - 0.5;
}

/** The sheet laid out afresh, as it is now by itself, and held there. */
function measureSheet(held: SheetHold): void {
  const { sheet, body } = held;
  sheet.style.removeProperty('max-height');
  keepRoom(held, 0);
  held.height = heightOf(sheet);
  held.max = Math.min(held.cap, held.height);
  sheet.style.maxHeight = `${held.max}px`;
  held.above = aboveOf(sheet);
  held.given = 0;
  held.rows = rowsOf(body);
  noteRows(held);
}

/**
 * Keeps the rows in view of a held sheet where they are on the screen: its scroll moves on by as far as its
 * body's box moved (as the lines above it take or give back room) and as far as the row in view moved in
 * what scrolls (rows that came or went above it: Numbers' "ngspice is running the netlist…" for each run),
 * and room is kept below its rows as far as that scroll, and so the sheet's height, need it (rows below
 * them gone). When none of the rows that were in view is left, or there were none (all of them new: the
 * first numbers, a plot where there was none or "Loading the plot…"), there is nothing to keep, and the
 * sheet is laid out afresh for the new ones. The row the keys are on is never hidden more than it was
 * (the head coming down over it hid the focus after Enter on More's Undo: the critic of the second
 * re-check's second fixes): the rows go down with it as far as that needs, as no finger aims at them.
 */
function keepRows(held: SheetHold): void {
  const { body } = held;
  const rows = held.rowsInView;
  const row = rows.find((r) => r.el.isConnected && body.contains(r.el));
  if (!row) {
    measureSheet(held);
    return;
  }
  // What scrolls was cut back under its scroll (the browser took the scroll in with it): from where it was.
  const scroll = body.scrollTop;
  const from = scroll < held.scroll - 0.5 && scroll >= body.scrollHeight - body.clientHeight - 0.5 ? held.scroll : scroll;
  // Where the row the keys are on begins in what scrolls (when all of it fits in the view).
  const focus = keyFocusIn(body)?.getBoundingClientRect();
  const focusAt = focus && focus.height <= body.clientHeight ? focus.top - body.getBoundingClientRect().top - body.clientTop + scroll : undefined;
  let want = from;
  for (let tries = 0; tries < 3; tries++) {
    const top = bodyTopOf(held);
    const moved = row.el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - row.at;
    want = Math.max(0, from + top - held.top + moved);
    // The row the keys are on, if some of it was in view (it moved with the rows, and the view began at
    // `from`, as tall as it is now and as far as the body's box moved), is hidden no more than it was.
    if (focus && focusAt !== undefined && focusAt - moved + focus.height > from + 0.5 && focusAt - moved < from + body.clientHeight + top - held.top - 0.5) want = Math.min(want, Math.max(focusAt, from + moved));
    const kept = Math.max(0, want + body.clientHeight - naturalOf(held));
    if (Math.abs(kept - held.kept) <= 0.5) break;
    keepRoom(held, kept);
  }
  if (Math.abs(body.scrollTop - want) > 0.01) body.scrollTop = want;
  noteRows(held);
}

/** What the polite region says after a run (decision 0010): the summary, and each sweep's last point. */
function resultsSaid(record: RunRecord): string {
  const error = record.checks.find((c) => c.severity === 'error');
  if (record.status === 'check' && error) return t('announceCheckError', { title: error.title.replace(/[.!?:]$/, '') });
  if (record.words.summarySpeech) {
    const ends = record.status === 'ok' ? record.words.sweeps.map((s) => s.end ?? '').filter(Boolean) : [];
    return [withoutResultsPointer(record.words.summarySpeech), ...ends].join(' ');
  }
  if (record.status === 'unreliable') return t('announceUnreliable');
  if (record.status === 'ok') return t('announceFinished', { summary: '' });
  return t('announceError', { detail: record.run.diagnostics.find((d) => d.severity === 'error')?.text ?? '' });
}

/** Every number a run's words give, as they are said: two runs with the same ones need not be said twice. */
function resultsHeard(record: RunRecord): string {
  const w = record.words;
  const tf = w.tf ? [w.tf.transferFunction, w.tf.inputResistance, w.tf.outputResistance].map((q) => q?.speech ?? '') : [];
  return [...w.nodes.map((n) => `${n.node} ${n.speech}`), ...w.currents.map((c) => c.speech), ...tf, ...w.sweeps.map((s) => s.speech)].join('\n');
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
  /** The drawing is a video's own (its *@ lines): a phone offers "As in the video" (decision 0015). */
  const video = useMemo(() => drawnAsInVideo(text), [text]);
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
  // The same for a short window, wider than tall (a phone on its side, a laptop): 360 px of height with
  // text at 150 % hold what 240 px hold at 100 %. Not an upright phone, whatever its text size: an
  // iPhone SE upright with the largest text keeps its hint line on the screen (in a box of its own that
  // keeps its first line and scrolls when the stack is short of room), which it needs more than the room.
  const tallFor = win.width > win.height ? Math.max(1, textScale) : 1;
  const short = phone && win.height < SHORT_HEIGHT * tallFor;
  const shorter = phone && win.height < SHORTER_HEIGHT * tallFor;

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
  // A part added or removed in the Netlist panel (or by a fix) fits the drawing again; edits made on
  // the drawing keep the view where it is (canvas.keep), and so do undo and redo.
  const fittedParts = useRef(partCount);
  useEffect(() => {
    if (partCount === fittedParts.current) return;
    fittedParts.current = partCount;
    const source = store.snapshot().last.source;
    if (source === 'editor' || source === 'fix') setFitCount((n) => n + 1);
  }, [partCount, store]);
  // A value typed on a card was built already, to keep its drawing (card-edit.ts, schematicOf).
  const schematic = useMemo((): Schematic | undefined => (tooBig ? undefined : schematicOf(netlist)), [netlist, tooBig]);
  const title = titleOf(text);
  /** The netlist's first line as written (what Export names its file after). */
  const titleLine = text.split(/\r?\n/, 1)[0] ?? '';

  // A phone held upright shows a wide drawing turned a quarter, so it fits whole at a size its words
  // can be read (src/notebook/turn.ts); the drawing in the netlist stays as it is. Decided when a
  // circuit opens (or the phone turns), never as a value is typed: the drawing must not change under
  // the reader. Decided on the opened circuit's own drawing, which follows the text a frame later
  // (`viewFor` waits for it), never on the circuit that was open before.
  const [turnWanted, setTurnWanted] = useState(true);
  /** The phone's turned view was put aside for editing: offered back when the student returns to Select. */
  const [turnedForEditing, setTurnedForEditing] = useState(false);
  /** Something being moved (dragged, or picked up): the drawing shows it where it would go. */
  const [move, setMove] = useState<MoveState | undefined>(undefined);
  /** Counts what fits the drawing again: a circuit opened, Fit, a part typed in the Netlist panel. */
  const [fitCount, setFitCount] = useState(0);
  const [openedText, setOpenedText] = useState(startup.netlist);
  const [viewFor, setViewFor] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (schematic && schematic.netlist.text === openedText && viewFor !== circuitKey) setViewFor(circuitKey);
  }, [schematic, openedText, circuitKey, viewFor]);
  const phoneView = useMemo(() => {
    if (!phone || !schematic) return { turn: false };
    const w = win.width - 30;
    const h = win.height - 190;
    const unitOf = (b: Box): number => Math.min(w / Math.max(1e-6, b.x1 - b.x0), h / Math.max(1e-6, b.y1 - b.y0));
    const asDrawn = unitOf(schematic.scene.bounds);
    const pans = asDrawn < minUnit;
    if (!(pans && portrait && isWide(schematic))) return { turn: false };
    const turnedNow = turnedQuarter(schematic);
    return { turn: !!turnedNow && unitOf(turnedNow.scene.bounds) > asDrawn * 1.15 };
    // The circuit (and how many parts it has when typed in the Netlist panel: fitCount), not its text
    // as typed, nor an edit made on the drawing (the view never turns under the hand that edits it).
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, portrait, viewFor, fitCount, win.width > win.height, minUnit]);
  const turned = useMemo(() => (phoneView.turn && schematic ? turnedQuarter(schematic) : undefined), [phoneView.turn, schematic]);
  /** The drawing as the student reads it: turned to fit (a phone), or as drawn. */
  const seen = turned && turnWanted ? turned : schematic;
  /** The drawing shown: with the part being moved where it would go, while it moves. */
  const shown = move?.preview?.ok && move.preview.schematic && seen === schematic ? move.preview.schematic : seen;
  /** Edits are made on the drawing as drawn: the turned view is another drawing (decision 0015). */
  const asDrawn = !!schematic && seen === schematic;
  const asDrawnOnPhone = phone && asDrawn;
  /** A phone that turned the drawing to fit shows it as drawn while editing: whole, so nothing goes off the screen. */
  const editingWhole = asDrawnOnPhone && turnedForEditing;
  // While a circuit is built on the drawing, a run that gives no answers (a part not connected yet,
  // no path to ground) keeps the last answers of this circuit in pencil, "before your last change",
  // as while ngspice runs: the numbers do not vanish at every step (critique of step B). The status
  // line and the red pen say why there are no new ones.
  const [lastGood, setLastGood] = useState<{ key: number; record: RunRecord } | undefined>(undefined);
  useEffect(() => {
    if (record && answers(record)) setLastGood((g) => (g?.record === record && g.key === circuitKey ? g : { key: circuitKey, record }));
  }, [record, circuitKey]);
  // Only this circuit's answers, kept through a run of changes made on the drawing: any other change
  // (an undo or redo past an opened example, typing, a fix, a circuit opened) lets them go, so pencil
  // numbers are never another circuit's.
  useEffect(() => {
    if (snap.last.source !== 'drawing') setLastGood(undefined);
  }, [snap.version, snap.last.source]);
  const building = snap.last.source === 'drawing';
  const stale = !answers(record) && building && lastGood?.key === circuitKey ? lastGood.record : undefined;
  const results = useMemo(() => (shown ? placeResults(shown.scene, answers(record) ?? answers(stale)) : NO_RESULTS), [shown, record, stale]);
  const description = useMemo(() => (schematic ? describeSchematic(schematic) : ''), [schematic]);
  const analysis = useMemo(() => analysisName(netlist.analyses.flatMap((i) => [explainLine(netlist, i)].filter((e) => e !== undefined)), netlist), [netlist]);
  const drawingLineCount = useMemo(() => readDrawing(netlist).lineIndexes.length, [netlist]);

  // ------------------------------------------------------------------ what is selected and open
  const [selected, setSelected] = useState<NavItem | undefined>(undefined);
  const [selectedLine, setSelectedLine] = useState<number | undefined>(undefined);
  const [card, setCard] = useState<CardState | undefined>(undefined);
  /** The card's field makes T, M and Shift+R letters of the value now (IndexCard's onTyping): the hint says to close the card first. */
  const [cardTyping, setCardTyping] = useState(false);
  const cardSession = useRef(0);
  const [panel, setPanel] = useState<PanelId | undefined>(undefined);
  /** The next panel opens (or closes) without moving the focus (one opened or closed along with an example). */
  const quietPanel = useRef(false);
  /**
   * The Netlist panel was opened by a SPICE for Beginners example, not by the student: an example from
   * another video closes it again (else its drawing runs under the panel). Forgotten as soon as the
   * student opens or closes a panel.
   */
  const panelByExample = useRef(false);
  const [tool, setTool] = useState<Tool>('select');
  /** The tool was chosen with the keys: the hint line gives the keyboard's way to use it. */
  const [toolByKey, setToolByKey] = useState(false);
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
  /**
   * A phone: the card's value field has the focus, and how it got it: a tap ('touch': on a touch
   * screen the editing strip shows above its keyboard) or the keys ('keys': Tab, a digit typed on the
   * card; the sheet stays, with its actions next in the Tab order, as on a computer).
   */
  const [editing, setEditing] = useState<false | 'touch' | 'keys'>(false);
  /** A touch screen (a coarse pointer): a phone's card becomes the strip above its keyboard while a value is typed. */
  const coarse = useMedia('(pointer: coarse)');
  /** The netlist is being typed: the drawing keeps its size (only a new part fits it again). */
  const [typingNetlist, setTypingNetlist] = useState(false);
  const [viewInfo, setViewInfo] = useState<CanvasViewInfo | undefined>(undefined);
  const canvas = useRef<CanvasHandle>(null);
  const editorRef = useRef<PlainSpiceEditor | null>(null);
  const panelHeading = useRef<HTMLHeadingElement | null>(null);
  const examplesRef = useRef<HTMLButtonElement | null>(null);
  const exportRef = useRef<HTMLButtonElement | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const drawingNameId = useId();

  // ------------------------------------------------------------------ the editor's state (decision 0017)
  /** The part (or ground symbol) in hand while a part tool is chosen: its turn and whether it is mirrored. */
  const [hand, setHand] = useState<Hand | undefined>(undefined);
  /** Where the pointer is over the paper (grid units, to a quarter unit), for the previews; undefined when it is not. */
  const [hover, setHover] = useState<Point | undefined>(undefined);
  /**
   * The same, kept as the pointer moves rather than as the page last drew (a render can come after the
   * next press: a busy machine, or a quick move and click). A click acts on where the pointer is, not on
   * a preview drawn for where it was.
   */
  const hoverNow = useRef<Point | undefined>(undefined);
  /** A touch screen: where the part in hand was put for a look, before Place (or a second tap there) places it. */
  const [lookAt, setLookAt] = useState<Point | undefined>(undefined);
  /** A wire on its way: its first end and the corners chosen since. */
  const [wireDraft, setWireDraft] = useState<WireDraft | undefined>(undefined);
  /** A piece of wire selected (a click on a wire with Select), and which ground symbol was chosen (one item stands for all of ground). */
  const [selectedWire, setSelectedWire] = useState<PieceOfWire | undefined>(undefined);
  const [selectedGround, setSelectedGround] = useState<number | undefined>(undefined);
  /** A node's card. */
  const [nodeCard, setNodeCard] = useState<NodeCardState | undefined>(undefined);
  /** Why the last edit was refused (the model's words): in the hint line until the next thing happens. */
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  /**
   * What PlainSpice also did to the drawing with the last edit (an edit's notes), in the hint line for
   * a moment; or, held there until it has been read, why the first part also wrote .op and .end.
   */
  const [noteLine, setNoteLine] = useState<HintNote | undefined>(undefined);
  /** The note's time is up (hint-note.ts): it goes, unless a newer note has taken its place. */
  const clearNote = useCallback((note: HintNote) => setNoteLine((now) => (now === note ? undefined : now)), []);
  /** When the last refusal was said: a pointer moving on the paper a moment later brings the hint back. */
  const refusedAt = useRef(0);
  /** The node names of the open circuit's undo history, for the store's version they were read at (usedNodeNames, below). */
  const usedNames = useRef<{ version: number; names: ReadonlySet<string>; memo: Map<string, readonly string[]> }>({ version: -1, names: new Set(), memo: new Map() });
  /** The drawing last given to an edit, with those names (currentDrawing, below). */
  const editable = useRef<{ s: Schematic; names: ReadonlySet<string>; out: Schematic } | undefined>(undefined);
  /** The part's card shows its connections. */
  const [connOpen, setConnOpen] = useState(false);
  /** The Add a part form, as it opens. */
  const [addForm, setAddForm] = useState<PartForm | undefined>(undefined);
  /** Controlled sources placed on the drawing that still read what PlainSpice chose for them: red pen until the student chooses. */
  const [unchosen, setUnchosen] = useState<ReadonlySet<string>>(new Set());
  const controlChosen = (key: string): void => setUnchosen((u) => (u.has(key) ? new Set([...u].filter((k) => k !== key)) : u));
  /** An item to focus (and a card to open) once the drawing has caught up with an edit. */
  const pendingFocus = useRef<{ item: NavItem; open?: 'card' | 'value' } | undefined>(undefined);
  /** After an edit, undo or redo: once the drawing has caught up, the focus must be somewhere (never the page itself, WCAG 2.4.3). */
  const focusCheck = useRef(false);
  /** An item an edit made or moved: brought into view once the drawing has it (never left under a bar, WCAG 2.4.11). */
  const pendingReveal = useRef<NavItem | undefined>(undefined);
  /** Moves of one item in a row with the keyboard are one undo step; a new run starts with each selection. */
  const moveRun = useRef(0);
  /** Counts what makes the open card find its place again (its part turned, its connections shown). */
  const [cardLayout, setCardLayout] = useState(0);
  /** The move as it is now (events come faster than renders), and where the pointer wants it, previewed once a frame. */
  const moveRef = useRef<MoveState | undefined>(undefined);
  moveRef.current = move;
  const moveWanted = useRef<Point | undefined>(undefined);
  const moveFrame = useRef<number | undefined>(undefined);
  /** The next preview of a move comes from the arrow keys: the view follows it (WCAG 2.4.11). */
  const moveReveal = useRef(false);
  /** A part picked up and moved with the keys or the pointer: where it would go now, said once the moving pauses (WCAG 4.1.3). */
  const sayWhereSoon = useDebounced(() => {
    const m = moveRef.current;
    const s = currentDrawing();
    if (!m || m.how !== 'pick' || !m.preview || !s) return;
    const from = grabAt(s, m.grab);
    const where = from ? offsetWords(m.preview.to.x - from.x, m.preview.to.y - from.y) : '';
    const name = cap(grabName(s, m.grab));
    announce(m.preview.ok ? t('moveSayHere', { name, where }) : t('moveSayNot', { name, where, reason: m.preview.reason ?? '' }));
  }, 500);
  /** The canvas's side of the editor, as it is in this render (set below); the canvas gets one object that calls the newest. */
  const editingRef = useRef<CanvasEditing | undefined>(undefined);
  const canvasEditing = useMemo(
    (): CanvasEditing => ({
      hover: (i) => editingRef.current?.hover?.(i),
      press: (i) => editingRef.current?.press(i),
      dragStart: (i) => editingRef.current?.dragStart?.(i),
      dragMove: (i) => editingRef.current?.dragMove?.(i),
      dragEnd: (i, cancelled) => editingRef.current?.dragEnd?.(i, cancelled),
      tap: (i) => editingRef.current?.tap?.(i),
      doubleClick: (i) => editingRef.current?.doubleClick?.(i),
    }),
    [],
  );

  /** Where the part in hand would land: under the pointer, or where a touch put it for a look. */
  const placeAt = hover ? gridPoint(hover) : lookAt;
  const placeView = useMemo(() => (hand && schematic && asDrawn && placeAt && !move ? placePreview(schematic, hand, placeAt) : undefined), [hand, schematic, asDrawn, placeAt, move]);
  /** With the Wire tool: the wire end under the pointer (a pin, a wire, a node's name), or the free point there. */
  const wireHover = useMemo((): WireStart | Point | undefined => {
    if (tool !== 'wire' || !schematic || !asDrawn || !hover) return undefined;
    const tol = nearness(viewInfo?.unit ?? 20);
    return wireStartOf(hitTest(schematic, hover, tol, 'wire')) ?? symbolEnd(schematic, hover, tol) ?? gridPoint(hover);
  }, [tool, schematic, asDrawn, hover, viewInfo?.unit]);
  const wirePath = useMemo(() => (wireDraft && schematic && wireHover ? wirePreview(schematic, wireDraft, wireHover) : undefined), [wireDraft, schematic, wireHover]);
  /** The two nodes a click on the end under the pointer would make one (said in the hint line before the click). */
  const wireMerge = ((): { a: string; b: string } | undefined => {
    if (!wireDraft || !schematic || !wireHover || !wirePath || !('end' in wireHover)) return undefined;
    const a = wireDraft.start.node;
    const b = wireHover.node;
    return a !== undefined && b !== undefined && a !== b ? { a: nodeSaid(schematic, a), b: nodeSaid(schematic, b) } : undefined;
  })();
  const targets = useMemo(() => (tool === 'wire' && schematic && asDrawn ? wireTargets(schematic) : undefined), [tool, schematic, asDrawn]);

  const selectedPart = selected?.kind === 'part' && shown ? shown.scene.parts.find((p) => p.key === selected.key) : undefined;
  const related = useMemo(() => relatedOf(selectedPart?.part), [selectedPart]);
  const checks = current ? record.checks : traps;
  /** What is wrong with the drawing lines (a *@ line PlainSpice cannot read or use): in the Checks panel, counted with the checks. */
  const drawingWarnings = useMemo(() => drawingWarningsOf(schematic), [schematic]);
  /** The controlled sources placed on the drawing that still read what PlainSpice chose for them (in the Checks panel too). */
  const unchosenNow = useMemo(() => stillToChoose(schematic, unchosen), [schematic, unchosen]);
  const checkCount = checks.length + drawingWarnings.length + unchosenNow.length;
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
  /** The Checks tab's count as last said: said again only when it changes (what is heard is the number the tab shows). */
  const announcedChecks = useRef(tn('checksCount', traps.length));
  const announceChecksSoon = useDebounced(() => {
    const now = store.get();
    // The tab's own count, for the text as it is now (counted afresh when the drawing is still a frame behind).
    const said = shownText === now ? checksSaid(checks.length, drawingWarnings.length + unchosenNow.length) : checksSaidFor(now, unchosen, MAX_DRAWN_PARTS);
    if (said === announcedChecks.current) return;
    announcedChecks.current = said;
    announce(said);
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
      setNodeCard(undefined);
      setEditing(false);
      setSelected(undefined);
      setSelectedLine(undefined);
      setSelectedWire(undefined);
      setTool('select');
      setHand(undefined);
      setWireDraft(undefined);
      setMove(undefined);
      setLookAt(undefined);
      setRefusal(undefined);
      setNoteLine(undefined);
      setTurnedForEditing(false);
      setUnchosen(new Set());
      setNotice(null);
      setExampleId(how.example);
      setNoteWanted(how.example === START_HERE_ID);
      setCircuitKey((k) => k + 1);
      setOpenedText(next);
      setFitCount((n) => n + 1);
      store.set(next, { source: 'load' });
      live.load(next, { run: how.run, manual: how.manual ?? false });
      announcedChecks.current = tn('checksCount', readNetlist(next).traps.length);
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
      // panel beside the drawing (the focus stays where the student chose the example). An example of
      // another video closes the panel such an example opened (final reviews, student
      // netlist-panel-stays); a panel the student opened stays.
      const open = openedPanel.current;
      if (example.group === 'sp01') {
        if (!phone && open !== 'netlist') {
          quietPanel.current = true;
          panelByExample.current = true;
          setPanel('netlist');
        }
      } else if (panelByExample.current) {
        panelByExample.current = false;
        if (open === 'netlist') {
          quietPanel.current = true;
          setPanel(undefined);
        }
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
      // The fix's changes, and the drawing lines it leaves with no node or part to name taken out with
      // them (final reviews, kept F1); said with the count the Checks tab then shows.
      const next = fixedText(now, changes, MAX_DRAWN_PARTS);
      store.set(next, { source: 'fix' });
      const said = checksSaidFor(next, unchosen, MAX_DRAWN_PARTS);
      announcedChecks.current = said;
      announce(`${t('fixApplied', { label: fix.label })}. ${said}`);
    },
    [store, read.text, announce, unchosen],
  );

  /** After an undo or a redo: what was being done on the drawing stops (the text it was for is gone). */
  const settleAfterHistory = useCallback(() => {
    setCard(undefined);
    setNodeCard(undefined);
    setEditing(false);
    setMove(undefined);
    setWireDraft(undefined);
    setSelectedWire(undefined);
    setLookAt(undefined);
    setRefusal(undefined);
    setNoteLine(undefined);
  }, []);
  /** Undo or Redo with nothing left: said, and shown in the hint line in place of an older refusal (as a refusal is). */
  const nothingLeft = useCallback(
    (words: string) => {
      refusedAt.current = performance.now();
      setRefusal(words);
      announce(words);
    },
    [announce],
  );
  const undo = useCallback(() => {
    const what = store.snapshot().undoLabel;
    if (!store.undo()) {
      nothingLeft(t('nothingToUndo'));
      return;
    }
    settleAfterHistory();
    canvas.current?.keep();
    focusCheck.current = true;
    announce(what ? t('undoneWhat', { what: afterColon(what) }) : t('undone'));
  }, [store, announce, settleAfterHistory, nothingLeft]);
  const redo = useCallback(() => {
    const what = store.snapshot().redoLabel;
    if (!store.redo()) {
      nothingLeft(t('nothingToRedo'));
      return;
    }
    settleAfterHistory();
    canvas.current?.keep();
    focusCheck.current = true;
    announce(what ? t('redoneWhat', { what: afterColon(what) }) : t('redone'));
  }, [store, announce, settleAfterHistory, nothingLeft]);

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
  // After a run, once typing pauses: the model's summary (without its pointer to a results view), and a
  // sweep's last point as its results card says it (a sweep's summary gives only its points: decision
  // 0010). A run Run asked for (the Run button, Ctrl+Enter, Ctrl+K, a link that runs) is always said
  // (WCAG 4.1.3: the status line's "Finished" is not read); a run after a change only when its results
  // differ from the last ones said, numbers and all (a current the summary only counts), so a comment
  // typed says nothing; the first run of a circuit opened is always said. While the netlist is typed
  // they wait for a pause (a line half typed is not worth reading out).
  const announcedRecord = useRef<RunRecord | undefined>(undefined);
  const lastResults = useRef('');
  const asked = liveState.outcome.kind === 'done' && !!liveState.outcome.manual;
  useEffect(() => {
    if (!record || !current || announcedRecord.current === record) return undefined;
    const timer = window.setTimeout(
      () => {
        announcedRecord.current = record;
        const words = resultsSaid(record);
        const key = `${circuitKey}|${words}|${resultsHeard(record)}`;
        if (key === lastResults.current && !asked) return;
        lastResults.current = key;
        announce(words);
      },
      typingNetlist ? ANNOUNCE_WHILE_TYPING_MS : card ? ANNOUNCE_RESULTS_DELAY_MS : ANNOUNCE_RESULTS_DELAY_MS / 3,
    );
    return () => window.clearTimeout(timer);
  }, [record, current, card, typingNetlist, announce, asked, circuitKey]);
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
    (key: string, focus = true, selectValue = false) => {
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
      setSelectedWire(undefined);
      setNodeCard(undefined);
      setConnOpen(false);
      setCard({ key, start, input: start, kept: start, before: current ? record : undefined, session, focus, ...(refused ? { refused } : {}), ...(selectValue ? { select: true } : {}) });
      setNoteWanted(false);
      setPartsSheet(false);
      setMoreSheet(false);
      setTool('select');
      if (phone) setPanel(undefined);
    },
    [schematic, store, current, record, phone, refusedOf],
  );

  /** A node's card: its name to change, its voltage, the parts on it (ground: its symbols). */
  const openNodeCard = useCallback(
    (name: string, focus = true, ground?: number) => {
      cardSession.current += 1;
      const text = name === GROUND ? '0' : (schematic?.circuit.nodes.get(name)?.text ?? name);
      setSelected({ kind: 'node', name });
      setSelectedWire(undefined);
      setCard(undefined);
      setNodeCard({ node: name, ground: name === GROUND ? (ground ?? 0) : undefined, session: cardSession.current, input: text, focus });
      setNoteWanted(false);
      setPartsSheet(false);
      setMoreSheet(false);
      if (phone) setPanel(undefined);
    },
    [schematic, phone],
  );
  const closeNodeCard = useCallback((focusNode = true) => {
    setNodeCard((c) => {
      if (c && focusNode) requestAnimationFrame(() => canvas.current?.focusItem({ kind: 'node', name: c.node }));
      return undefined;
    });
  }, []);

  const onSelect = useCallback(
    (item: NavItem | undefined) => {
      setSelected(item);
      // The node of a piece of wire chosen again from the keys (Enter on it): the piece stays selected, as
      // the hint says. A click on the node's name is the pointer choosing the node: the piece is let go.
      if (!(item && selected && itemKey(item) === itemKey(selected) && lastInput.current === 'key')) setSelectedWire(undefined);
      setRefusal(undefined);
      moveRun.current += 1;
      if (item?.kind === 'node' && item.name !== GROUND) setSelectedGround(undefined);
      if (item?.kind === 'part') {
        const p = schematic?.circuit.parts.find((x) => x.key === item.key);
        if (p) setSelectedLine(p.line + 1);
        // Moving along the drawing with a card open: the card follows, the focus stays on the drawing.
        if (card && card.key !== item.key) openCard(item.key, false);
        else if (nodeCard) setNodeCard(undefined);
      } else if (item?.kind === 'node') {
        if (card) closeCard(false);
        if (nodeCard && nodeCard.node !== item.name) openNodeCard(item.name, false);
      } else {
        if (card) closeCard(false);
        if (nodeCard) setNodeCard(undefined);
      }
    },
    [schematic, selected, card, nodeCard, openCard, closeCard, openNodeCard],
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
        const name = schematic?.circuit.parts.find((x) => x.key === card.key)?.name ?? card.key;
        if (next !== now) {
          store.set(next, { source: 'drawing', group: `card:${card.session}`, label: t('valueLabel', { name, value: value.trim() }) });
          // A value that would move a part pins the drawing in *@ lines (keepDrawing): said the first time, never unseen.
          if (!hasDrawingLines(now) && hasDrawingLines(next)) announce(t('drawingWritten'));
        }
        kept = value.trim();
      }
      const refused = r.kind === 'refused' ? { reason: r.reason, ...(r.fix ? { fix: r.fix } : {}) } : how === 'put-back' && value ? refusedOf(edit.spot, value, letter) : undefined;
      setCard({ ...rest, input: value, kept, ...(refused ? { refused } : {}) });
    },
    [card, editOf, schematic, store, refusedOf, announce],
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
  // A panel that opens takes the focus to its heading; one that closes gives it back to its tab
  // (not one opened or closed along with an example: the focus stays where the example was chosen).
  const openedPanel = useRef<PanelId | undefined>(undefined);
  useEffect(() => {
    const was = openedPanel.current;
    openedPanel.current = panel;
    const quiet = quietPanel.current;
    quietPanel.current = false;
    // The student opened or closed a panel: an example no longer closes it.
    if (panel !== was && !quiet) panelByExample.current = false;
    if (panel && panel !== was) {
      if (!quiet) panelHeading.current?.focus({ preventScroll: true });
    }
    else if (!panel && was && !quiet && (document.activeElement === document.body || !document.activeElement)) {
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
      const byKey = lastInput.current === 'key';
      setToolByKey(byKey);
      setTool(next);
      setHand(isPartKind(next) ? handFor(next) : undefined);
      setWireDraft(undefined);
      setLookAt(undefined);
      setRefusal(undefined);
      // Back to Select only puts the part in hand down: a note that must be read stays (hint-note.ts; the
      // second critic of words W9: after a Shift+click, Escape took the starter's why away unseen).
      setNoteLine((now) => noteAfterTool(now, next));
      setMove(undefined);
      setPartsSheet(false);
      if (next === 'select') {
        // The phone's turned view was put aside for editing: offered back (the status line's Turn to fit).
        if (turnedForEditing) {
          // Back to the view the student was reading before editing: turned to fit again (else the as-drawn
          // view at reading size would show one part, the rest off the screen).
          setTurnedForEditing(false);
          setTurnWanted(true);
          announce(t('turnBack'));
        }
        return;
      }
      setCard(undefined);
      setNodeCard(undefined);
      setEditing(false);
      setNoteWanted(false);
      setSelectedWire(undefined);
      // A phone's turned view is another drawing than the netlist's: the tools work on it as drawn.
      if (phone && turned && turnWanted) {
        setTurnWanted(false);
        setTurnedForEditing(true);
      }
      const anywhere = schematic && isPartKind(next) ? refusedAnywhere(schematic, next) : undefined;
      const hint = hintWords({ phone, tool: next, selectedName: undefined, typeHint: undefined, whole: true, turned: false, asDrawn: true, keys: byKey, ...(anywhere ? { place: { refused: anywhere, anywhere: true } } : {}) });
      announce(next === 'wire' ? hint : t('toolInHand', { part: cap(toolPhrase(next)), hint }));
    },
    [announce, phone, turned, turnWanted, turnedForEditing, schematic],
  );

  /**
   * The reader asked to see the whole drawing ("Show the whole drawing": More, Ctrl+K, Shift+1, the
   * status line, the computer's zoom bar): the fit it makes (its fitCount) shows all of it, smaller
   * than its words' readable size if it must be, in the view it was asked in (on a phone, turned to
   * fit or as drawn), until something else fits the drawing again (a circuit opened, a part added in
   * the Netlist panel) or the reader turns it or shows it as drawn (toggleTurn). Any other view (the
   * turned drawing shown as drawn for a tool, turned back by Select, the phone turned on its side)
   * opens at its own fit: the whole drawing asked for while editing as drawn is not the turned view's.
   */
  const [wholeAt, setWholeAt] = useState<{ count: number; turned: boolean } | undefined>(undefined);
  const viewTurned = !!turned && seen === turned;
  const fitCountNow = useRef(fitCount);
  const viewTurnedNow = useRef(viewTurned);
  useLayoutEffect(() => {
    fitCountNow.current = fitCount;
    viewTurnedNow.current = viewTurned;
  }, [fitCount, viewTurned]);
  const fit = useCallback(() => {
    setFitCount((n) => n + 1);
    setWholeAt({ count: fitCountNow.current + 1, turned: viewTurnedNow.current });
    canvas.current?.fit();
  }, []);
  /** A phone's "Turn to fit", "As drawn" or "As in the video": the other view at its own fit, not the whole one asked for in this one. */
  const toggleTurn = useCallback(() => {
    setTurnWanted((w) => !w);
    setWholeAt(undefined);
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
  const closeOverlay = useCallback((key: OverlayKey) => {
    // A dialog gives the focus back to what opened it; where that is gone (the Add a part form opened
    // from Ctrl+K), the focus rule finds it a place.
    focusCheck.current = true;
    setOverlay((o) => (o === key ? null : o));
  }, []);

  const openPalette = useCallback(() => {
    lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    // Back where it was, unless the command took the focus somewhere (a panel's heading, a card's field,
    // a dialog); where that is gone too (a new circuit), the focus rule below finds it a place.
    requestAnimationFrame(() => {
      const active = document.activeElement;
      const lost = !active || active === document.body || !active.isConnected;
      if (lost && lastFocus.current?.isConnected && !document.querySelector('.modal-overlay, .popover')) lastFocus.current.focus({ preventScroll: true });
      else if (lost) focusCheck.current = true;
    });
  }, []);

  // ------------------------------------------------------------------ the keyboard
  /** The page's keys as they are in this render (set with the editor, below); one listener calls the newest. */
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => onKeyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  /** How the student last used the page: the keys, or a pointer (the hint line then says the keyboard's way to place and wire). */
  const lastInput = useRef<'key' | 'pointer'>('pointer');
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Meta' && e.key !== 'Alt') lastInput.current = 'key';
    };
    const pointer = (): void => {
      lastInput.current = 'pointer';
    };
    window.addEventListener('keydown', key, { capture: true });
    window.addEventListener('pointerdown', pointer, { capture: true });
    return () => {
      window.removeEventListener('keydown', key, { capture: true });
      window.removeEventListener('pointerdown', pointer, { capture: true });
    };
  }, []);

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
    list.push({ id: 'run', group: gRun, label: t('paletteRun'), keywords: 'simulate solve ngspice', shortcut: 'Ctrl+Enter' });
    if (snap.canUndo) list.push({ id: 'undo', group: gRun, label: t('undo'), shortcut: 'Ctrl+Z' });
    if (snap.canRedo) list.push({ id: 'redo', group: gRun, label: t('redo'), shortcut: 'Ctrl+Shift+Z' });
    for (const id of PANELS) {
      const name = panelTitle(id);
      list.push({ id: `panel:${id}`, group: t('paletteGroupPanels'), label: panel === id ? t('paletteClosePanel', { panel: name }) : t('paletteOpenPanel', { panel: name }), keywords: id });
    }
    const gCircuit = t('paletteGroupCircuit');
    list.push({ id: 'share', group: gCircuit, label: t('paletteShare'), keywords: 'link copy' });
    list.push({ id: 'export:ngspice', group: gCircuit, label: t('exportNgspice'), keywords: 'export save download file cir' });
    list.push({ id: 'export:ltspice', group: gCircuit, label: t('exportLtspice'), keywords: 'export save download file net' });
    list.push({ id: 'new', group: gCircuit, label: t('newCircuit'), keywords: 'new blank empty clear start fresh circuit' });
    const gDrawing = t('paletteGroupDrawing');
    list.push({ id: 'fit', group: gDrawing, label: t('zoomFit'), keywords: 'fit window zoom screen whole', shortcut: 'Shift+1' });
    list.push({ id: 'zoom-in', group: gDrawing, label: t('zoomIn'), keywords: 'bigger', shortcut: '+' });
    list.push({ id: 'zoom-out', group: gDrawing, label: t('zoomOut'), keywords: 'smaller', shortcut: '−' });
    if (phone && turned) list.push({ id: 'turn', group: gDrawing, label: turnWanted ? t(video ? 'paletteAsInVideo' : 'paletteAsDrawn') : t('paletteTurnToFit'), keywords: 'turn rotate upright phone video' });
    // Editing the drawing (decision 0017): every tool by name, the form, and what the selection can do.
    const gEdit = t('paletteGroupEdit');
    if (schematic && !tooBig) {
      list.push({ id: 'add-part', group: gEdit, label: t('paletteAddPart'), keywords: 'add new part form nodes keyboard netlist line', shortcut: 'A' });
      for (const tl of ['R', 'C', 'L', 'V', 'I', 'E', 'F', 'G', 'H', 'ground'] as const) {
        // E to H also by their other names, ranked as words of their names: "dependent source" (the channel's
        // word, the examples') and their initials, "vcvs" ... ("controlled" is in their names): final reviews,
        // words W4. This group comes before the examples, so "dependent" lists the four first.
        const aliases = toolAliases(tl);
        list.push({ id: `tool:${tl}`, group: gEdit, label: t('palettePlace', { part: toolPhrase(tl) }), keywords: `place add tool ${tl === 'ground' ? 'ground gnd 0' : `${tl} ${elementInfo(tl)?.name ?? ''}`}`, ...(aliases.length ? { aliases } : {}), shortcut: tl === 'ground' ? '0' : tl });
      }
      list.push({ id: 'tool:wire', group: gEdit, label: t('paletteWire'), keywords: 'wire draw line', shortcut: 'W' });
      const sel = selected?.kind === 'part' ? schematic.circuit.parts.find((p) => p.key === selected.key) : undefined;
      if (sel) {
        const name = sel.name;
        list.push({ id: `turn:${sel.key}`, group: gEdit, label: t('paletteTurn', { name }), keywords: 'turn rotate quarter', shortcut: 'T' });
        list.push({ id: `mirror:${sel.key}`, group: gEdit, label: t('paletteMirror', { name }), keywords: 'mirror flip', shortcut: 'M' });
        list.push({ id: `reverse:${sel.key}`, group: gEdit, label: t('paletteReverse', { name }), keywords: 'reverse swap ends nodes polarity', shortcut: 'Shift+R' });
        list.push({ id: `move:${sel.key}`, group: gEdit, label: t('paletteMove', { name }), keywords: 'move drag pick place', shortcut: 'Shift+arrow keys' });
        list.push({ id: `conn:${sel.key}`, group: gEdit, label: t('paletteConnections', { name }), keywords: 'connect disconnect wire node ends connections' });
        list.push({ id: `delete:${sel.key}`, group: gEdit, label: t('paletteDelete', { name }), keywords: 'delete remove erase', shortcut: 'Delete' });
      }
      if (selectedWire) list.push({ id: 'delete-wire', group: gEdit, label: t('paletteDeleteWire'), keywords: 'delete remove wire', shortcut: 'Delete' });
      if (selected?.kind === 'node' && selected.name !== GROUND) list.push({ id: `rename:${selected.name}`, group: gEdit, label: t('paletteRename', { node: nodeSaid(schematic, selected.name) }), keywords: 'rename node name label' });
      // The node cards' Move, by name too (decision 0017: Ctrl+K has every editing command): the ground symbol, a node's name on the drawing.
      if (selected?.kind === 'node' && !selectedWire && grabOf(schematic, selected)) {
        const g = grabOf(schematic, selected, selectedGround)!;
        if (g.kind === 'ground') list.push({ id: `move-ground:${g.ground}`, group: gEdit, label: t('nodeCardMoveGround'), keywords: 'move drag pick place ground symbol', shortcut: 'Shift+arrow keys' });
        else if (g.kind === 'label') list.push({ id: `move-name:${g.node}`, group: gEdit, label: t('paletteMoveName', { node: nodeSaid(schematic, g.node) }), keywords: 'move drag pick place name label node', shortcut: 'Shift+arrow keys' });
      }
      if (selected?.kind === 'node' && selected.name === GROUND && schematic.drawing.grounds.length) list.push({ id: 'delete-ground', group: gEdit, label: t('paletteDeleteGround'), keywords: 'delete remove ground', shortcut: 'Delete' });
    }
    for (const p of shown?.scene.parts ?? []) {
      list.push({ id: `part:${p.key}`, group: t('paletteGroupParts'), label: t('paletteChangePart', { name: p.name, kind: elementInfo(p.letter)?.name ?? p.letter }), keywords: `select open card ${p.letter} value` });
    }
    const gSettings = t('paletteGroupSettings');
    list.push({ id: 'font', group: gSettings, label: plain ? t('paletteHandwriting') : t('palettePlainFont'), keywords: 'handwriting plain font dyslexia caveat readable' });
    list.push({ id: 'settings', group: gSettings, label: t('paletteSettings'), keywords: 'preferences text size contrast motion font' });
    list.push({ id: 'help', group: gSettings, label: t('paletteHelp'), keywords: 'keys keyboard shortcuts licences' });
    // The open circuit's example comes last in its group. A video's examples are named with the
    // video ("Example 3: a and b open" is in three videos), and found by its words, accents or not
    // (filterCommands folds accents in every command's words and in what is typed).
    for (const e of [...EXAMPLES].sort((a, b) => Number(a.id === exampleId) - Number(b.id === exampleId))) {
      const video = EXAMPLE_GROUPS.find((g) => g.group === e.group && g.video)?.label;
      const label = video ? t('paletteOpenVideoExample', { name: e.name, video }) : t('paletteOpenExample', { name: e.name });
      list.push({ id: `example:${e.id}`, group: t('paletteGroupExamples'), label, keywords: `${e.id} example circuit video` });
    }
    return list;
  }, [liveState.running?.slow, snap.canUndo, snap.canRedo, panel, phone, turned, turnWanted, video, shown, plain, exampleId, schematic, tooBig, selected, selectedWire, selectedGround]);

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
    else if (kind === 'turn' && !arg) toggleTurn();
    else if (kind === 'part' && arg) openCard(arg);
    else if (kind === 'add-part') openAddForm();
    else if (kind === 'tool' && arg) chooseTool(arg as Tool);
    else if ((kind === 'turn' || kind === 'mirror' || kind === 'reverse') && arg) turnPart(kind, arg);
    else if (kind === 'move' && arg) startMove({ kind: 'part', key: arg }, 'pick');
    else if (kind === 'move-ground' && arg) startMove({ kind: 'ground', ground: Number(arg) }, 'pick');
    else if (kind === 'move-name' && arg) startMove({ kind: 'label', node: arg }, 'pick');
    else if (kind === 'delete' && arg) deleteNow({ part: arg });
    else if (kind === 'delete-wire' || kind === 'delete-ground') deleteNow();
    else if (kind === 'rename' && arg) openNodeCard(arg);
    else if (kind === 'conn' && arg) {
      openCard(arg);
      setConnOpen(true);
    } else if (kind === 'new') {
      load('', { run: true });
      focusCheck.current = true;
      announce(t('newCircuitDone'));
    } else if (kind === 'font') setFont(plain ? 'handwriting' : 'plain');
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
  /** The bar of what is in hand (Turn, Mirror, Place, Cancel): red pen keeps clear of it. */
  const [handRef, handRect] = useRect<HTMLDivElement>();
  const firstScreenInvite = shown?.scene.parts.find((p) => p.key === 'r1') ?? shown?.scene.parts.find((p) => p.letter === 'R');
  const noteShown = !phone && noteWanted && tool === 'select' && !card && !nodeCard && !panel && !paletteOpen && !!firstScreenInvite && !!schematic;
  const phoneSheet: 'card' | 'parts' | 'more' | 'panel' | undefined = phone ? (card || nodeCard ? 'card' : partsSheet ? 'parts' : moreSheet ? 'more' : panel ? 'panel' : undefined) : undefined;
  // The strip (the field held above the on-screen keyboard) is for a field tapped on a touch screen, or
  // whenever an on-screen keyboard is up. A field reached with the keys (a touch screen with a keyboard,
  // the phone's layout on a laptop at large text) keeps the sheet: Tab goes on to the card's actions
  // (WCAG 2.4.3), as on a computer. (Android may report no keyboard inset at all: a tap is enough.)
  const strip = phone && !!card && !!editing && (keyboard > 0 || (coarse && editing === 'touch'));
  const vw = win.width;
  const vh = win.height;
  const rightEdge = !phone ? Math.min(tabsRect.width ? tabsRect.left : vw, panel && sheetRect.width ? sheetRect.left : vw) : vw;
  const stackBottom = stackRect.height ? stackRect.bottom : 0;
  /** The free paper on a computer, where the card and the note may go (screen pixels). */
  const area: Box = { x0: toolsRect.right + 12, y0: Math.max(topRect.bottom, stackBottom) + 8, x1: rightEdge - 12, y1: (bottomRect.height ? bottomRect.top : vh) - 6 };
  // A card on a computer (a part's, or a node's): its height when it opened (the tallest since: its
  // Connections may open), and whether it is docked along the bottom (below).
  const openSession = card?.session ?? nodeCard?.session;
  const [cardMeasure, setCardMeasure] = useState<{ session: number; height: number } | undefined>(undefined);
  const [dockedSession, setDockedSession] = useState<number | undefined>(undefined);
  const measured = openSession !== undefined && cardMeasure?.session === openSession;
  const cardH = Math.ceil(Math.max((nodeCard && !card ? NODE_CARD_H : CARD_H) * textScale, measured ? cardMeasure.height : 0));
  const docked = !phone && openSession !== undefined && dockedSession === openSession;
  /** What the open card points at on the drawing: its part (symbol and words), or a node's name (ground: the symbol chosen). */
  const cardTarget = useMemo((): { box: Box; body: Box } | undefined => {
    if (!shown) return undefined;
    if (card) {
      const p = shown.scene.parts.find((x) => x.key === card.key);
      return p ? { box: unionBoxes([p.box, p.labelBox])!, body: p.box } : undefined;
    }
    if (!nodeCard) return undefined;
    if (nodeCard.node === GROUND) {
      const g = shown.scene.grounds[nodeCard.ground ?? 0] ?? shown.scene.grounds[0];
      return g ? { box: g.box, body: g.body } : undefined;
    }
    const l = shown.scene.nodeLabels.find((x) => x.node === nodeCard.node) ?? shown.scene.nodeLabels.find((x) => x.node === nodeCard.renamed);
    const name = l?.lines.find((x) => x.role === 'node')?.box ?? l?.box;
    if (l && name) return { box: l.box, body: name };
    // A node whose name is not drawn: the card points at its copper (a pin), else it is docked.
    const pin = shown.scene.parts.flatMap((p) => p.pins).find((q) => q.node === nodeCard.node || q.node === nodeCard.renamed);
    return pin ? { box: inflate({ x0: pin.at.x, y0: pin.at.y, x1: pin.at.x, y1: pin.at.y }, 0.5), body: inflate({ x0: pin.at.x, y0: pin.at.y, x1: pin.at.x, y1: pin.at.y }, 0.3) } : undefined;
  }, [shown, card, nodeCard]);
  // As wide as the text needs (larger text, a wider card: it wraps less and stays short).
  const cardWidth = Math.min(CARD_W * textScale, Math.max(320, area.x1 - area.x0));
  // On a phone the stack along the bottom (the hint and status lines, a sheet, the bar; the card's sheet
  // or strip) never reaches higher than leaves the free paper it keeps under the top bar, and room for
  // the hand bar above it while one is shown: with large text on a small phone it took the whole
  // screen, and the hand bar went under the top bar (Place could not be tapped). The bar and the hand
  // bar keep their size; the lines and a sheet give way, and scroll.
  const paperKept = phone && topRect.height ? Math.max(PAPER_KEPT_PX, PAPER_KEPT_SHARE * (vh - keyboard - topRect.bottom)) : 0;
  const stackMax = phone && topRect.height ? Math.max(0, Math.floor(vh - keyboard - topRect.bottom - paperKept - (handRect.height ? handRect.height + 12 : 0))) : undefined;
  const [linesRef, linesSqueezed] = useOverflowing<HTMLElement>();
  const [hintBoxRef, hintSqueezed] = useOverflowing<HTMLDivElement>();
  const [barRef, barRect] = useRect<HTMLElement>();
  // A sheet open on a phone (Parts, More, a panel), the hint and status lines above it. They give way to
  // the sheet in two steps, each kept for this sheet and the room around it (not measured again, or the
  // lines would come back and go again), never a sliver of half a line over the sheet:
  // 1. When the hint and the status do not both fit above the sheet at its full height, the hint steps
  //    out of sight (screen readers keep it), as it does in a short window (whatever the sheet is about,
  //    the hint is about the drawing); the status line stays whole above the sheet, which gives way below
  //    it and scrolls, down to its head and about two rows (SHEET_ROWS_KEPT_REM), or all its rows when
  //    it has fewer.
  // 2. When even the status would leave the sheet less, the lines step out of sight too, until the sheet
  //    closes, the room changes or the status line says something else (sheetKey): their words for
  //    screen readers, none of their buttons (Undo, As drawn), which would be Tab stops nobody can see
  //    (WCAG 2.4.7); More keeps Undo at hand.
  const sheetOpen = phone && phoneSheet && phoneSheet !== 'card' ? (phoneSheet === 'panel' ? panel : phoneSheet) : undefined;
  // How far down the open sheet its head ends (its grab and head: a long title wraps with large text),
  // and how tall all it has below its head is (its rows, those it scrolls to included): the sheet keeps
  // its head and about two rows (SHEET_ROWS_KEPT_REM), or all its rows when it has less (Plot before
  // a sweep, a line of words).
  const [sheetHead, setSheetHead] = useState(0);
  const [sheetRows, setSheetRows] = useState(0);
  useLayoutEffect(() => {
    if (!sheetOpen) return undefined;
    const sheet = document.querySelector<HTMLElement>('.phone-bottom > .sheet');
    const head = sheet?.querySelector<HTMLElement>(':scope > .card-head');
    if (!sheet || !head) return undefined;
    const below = (): Element[] => {
      const all: Element[] = [];
      for (let el = head.nextElementSibling; el; el = el.nextElementSibling) all.push(el);
      return all;
    };
    const measure = (): void => {
      const h = Math.ceil(head.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top);
      setSheetHead((old) => (old === h ? old : h));
      // A box that scrolls counts all it holds (scrollHeight), whatever room it has now.
      const rows = Math.ceil(below().reduce((sum, el) => sum + Math.max(el.scrollHeight, el.getBoundingClientRect().height), 0));
      setSheetRows((old) => (old === rows ? old : rows));
    };
    const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    // Rows that come or go (a sweep's plot arriving, a check found) change what the sheet holds; each
    // box below the head and what it holds is watched (watching one already watched does nothing).
    const update = (): void => {
      measure();
      for (const el of below()) {
        ro?.observe(el);
        for (const child of el.children) ro?.observe(child);
      }
    };
    ro?.observe(head);
    update();
    const mo = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(update);
    mo?.observe(sheet, { childList: true, subtree: true });
    return () => {
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [sheetOpen, vw, vh, textScale]);
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
  /** What the card was last placed for (all but its height): when only its height changed, it grew. */
  const placedFor = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (openSession === undefined || phone || !cardRect.height) return;
    // The tallest it has been (a refusal's words, its Connections shown).
    setCardMeasure((m) => (m?.session === openSession && m.height >= cardRect.height - 1 ? m : { session: openSession, height: cardRect.height }));
  }, [openSession, phone, cardRect.height]);
  useLayoutEffect(() => {
    if (phone || openSession === undefined || !base || !topRect.height || !bottomRect.height || !shown || !measured) {
      setPlacement(undefined);
      placedFor.current = undefined;
      return;
    }
    if (dockedSession === openSession) return;
    if (!cardTarget) {
      // Nothing on the drawing to put it beside (yet): docked, never left unseen (WCAG 2.4.7).
      setPlacement(undefined);
      setDockedSession(openSession);
      return;
    }
    // The drawing is panned for the card only while it follows the fit: a view the reader (or an edit)
    // holds stays (decision 0015: the card never covers the numbers it changes). The pan slides (where
    // motion is not reduced) and a click just after it is not taken for an aimed one (NotebookCanvas).
    const pan = !viewInfo?.moved;
    const what = [openSession, card?.key, nodeCard?.node, cardLayout, base.unit, base.x, base.y, circuitKey, turnWanted, area.x0, area.x1, win.width, win.height].join('|');
    // Grown (a value refused, its Connections shown): it keeps its place, its edge away from its part
    // where it was, while it still fits there covering nothing; else it finds a new place.
    if (placedFor.current === what && placement) {
      const b = placement.box;
      const grown = placement.side === 'above' ? { ...b, y0: b.y1 - cardH } : { ...b, y1: b.y0 + cardH };
      const view = { unit: base.unit, x: base.x + placement.pan.x, y: base.y + placement.pan.y };
      if (grown.y0 >= area.y0 && grown.y1 <= area.y1 && coverCost(grown, drawingRoom(shown.scene, view, area)) === 0) {
        if (grown.y0 !== b.y0 || grown.y1 !== b.y1) setPlacement({ ...placement, box: grown });
        return;
      }
    }
    placedFor.current = what;
    const p = card
      ? placeCard({ scene: shown.scene, part: card.key, view: base, area, width: cardWidth, height: cardH, pan, freeOnly: true })
      : placeCard({ scene: shown.scene, part: '', target: cardTarget, view: base, area, width: cardWidth, height: cardH, pan, freeOnly: true });
    if (!p || p.cost > 0) {
      setPlacement(undefined);
      setDockedSession(openSession);
    } else setPlacement(p);
    // Not on every keystroke (shown changes as the value is typed), nor for the hint or the status line
    // changing height: only a new card, its part edited (turned, connected) or its card grown, a new
    // window size, or a panel opening or closing beside it.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, card?.key, nodeCard?.node, openSession, measured, cardH, cardLayout, base?.unit, base?.x, base?.y, circuitKey, turnWanted, area.x0, area.x1, win.width, win.height, !!cardTarget]);
  const offset = placement && (placement.pan.x || placement.pan.y) ? placement.pan : undefined;
  // A card docked while the view is held (after an edit): the drawing makes room above it, and goes
  // back where it was when the card closes, so placing part after part never walks it off the screen.
  const freeView = useRef<{ x: number; y: number; unit: number } | undefined>(undefined);
  const wasDocked = useRef(false);
  useLayoutEffect(() => {
    if (docked) {
      wasDocked.current = true;
      return;
    }
    if (wasDocked.current) {
      wasDocked.current = false;
      const v = freeView.current;
      if (v && viewInfo?.moved) canvas.current?.showView(v);
      return;
    }
    if (viewInfo?.moved) freeView.current = viewInfo.view;
  }, [docked, viewInfo]);

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
    if (!placement || !viewInfo || openSession === undefined || !cardTarget) return undefined;
    const planned = { unit: viewInfo.base.unit, x: viewInfo.base.x + placement.pan.x, y: viewInfo.base.y + placement.pan.y };
    const a = boxOnScreen(planned, cardTarget.body);
    const b = boxOnScreen(viewInfo.view, cardTarget.body);
    const dx = (b.x0 + b.x1) / 2 - (a.x0 + a.x1) / 2;
    const dy = (b.y0 + b.y1) / 2 - (a.y0 + a.y1) / 2;
    const move = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: p.x + dx, y: p.y + dy });
    const box = { x0: placement.box.x0 + dx, y0: placement.box.y0 + dy, x1: placement.box.x1 + dx, y1: placement.box.y1 + dy };
    return { box, side: placement.side, notch: move(placement.notch), ...(placement.leader ? { leader: { from: move(placement.leader.from), to: move(placement.leader.to) } } : {}) };
  }, [placement, viewInfo, openSession, cardTarget]);

  // Red pen on the drawing: traps next to their part (the misread value circled), "No single answer
  // at node n1" next to the node, and while a card is open, the old node voltages crossed out.
  const beforeResults = useMemo(() => (card?.before && shown ? placeResults(shown.scene, answers(card.before)) : undefined), [card?.before, shown]);
  const pen = useMemo((): PenMarks | undefined => {
    if (!viewInfo || !shown || !schematic) return undefined;
    const sc = shown.scene;
    const visible = boxOnGrid(viewInfo.base, phone ? { x0: insets.left, y0: insets.top, x1: viewInfo.size.width - insets.right, y1: viewInfo.size.height - insets.bottom } : area);
    const within: Box = { x0: Math.max(visible.x0, sc.bounds.x0 - 4), y0: Math.max(visible.y0, sc.bounds.y0 - 4), x1: Math.min(visible.x1, sc.bounds.x1 + 4), y1: Math.min(visible.y1, sc.bounds.y1 + 4) };
    const avoid: Box[] = cardNow ? [inflate(boxOnGrid(viewInfo.view, cardNow.box), 0.3)] : [];
    if (handRect.height) avoid.push(inflate(boxOnGrid(viewInfo.view, { x0: handRect.left, y0: handRect.top, x1: handRect.right, y1: handRect.bottom }), 0.3));
    const notes: PenNote[] = [];
    const circled = new Set<string>();
    // While a circuit is built on the drawing: one note in all, about the part being worked on if it
    // has one (every step of a half-built circuit has some check: the status line says the first, the
    // Checks panel lists them all). Else up to two checks and the node with no single answer.
    const sel = selected?.kind === 'part' ? selected.key : undefined;
    const most = building ? 1 : 3;
    const add = (about: Box | undefined, text: string, lasting = false): void => {
      if (!about || (!lasting && notes.length >= most)) return;
      const note = placeNote(sc, about, text, { area: within, avoid: [...avoid, ...notes.map((n) => n.box)] });
      if (note) notes.push(note);
    };
    // A controlled source placed on the drawing reads what PlainSpice chose for it until the student
    // chooses on its card: its note stays, selected or not, while building too (the circuit solved is
    // otherwise not the one the student means), the selected one first, two at most.
    let lasting = 0;
    for (const key of [...unchosen].sort((a, b) => Number(b === sel) - Number(a === sel))) {
      const part = schematic.circuit.parts.find((p) => p.key === key);
      const control = part ? controlWords(part) : undefined;
      if (part && control && lasting < 2) {
        lasting += 1;
        add(partBox(sc, key), t('controlNote', { name: part.name, control }), true);
      }
    }
    const ordered = [...partTraps].sort((a, b) => Number(b[0] === sel) - Number(a[0] === sel));
    for (const [key, trap] of ordered.slice(0, 2)) {
      const part = schematic.circuit.parts.find((p) => p.key === key);
      if (!part) continue;
      if (onValueField(trap, part, schematic.netlist)) circled.add(key);
      add(partBox(sc, key), trap.title);
    }
    const ns = current && !building ? record.noSingleAnswer : undefined;
    if (ns) add(nodeBox(sc, ns.at), ns.title);
    const was = card && current ? wasMarks(sc, results, beforeResults, [...avoid, ...notes.map((n) => n.box)]) : [];
    return notes.length || was.length || circled.size ? { notes, was, circled } : undefined;
    // insets and area by their numbers
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [viewInfo?.base, viewInfo?.view, viewInfo?.size, shown, schematic, current, partTraps, record, card, results, beforeResults, cardNow?.box.x0, cardNow?.box.y0, phone, handRect, unchosen, building, selected]);

  // The sticky note on a computer: beside the part it invites you to change, with a pen arrow to it.
  const notePlace = useMemo(() => {
    if (!noteShown || !viewInfo || !noteRect.width || !firstScreenInvite || !shown) return undefined;
    const part = firstScreenInvite;
    const room = drawingRoom(shown.scene, viewInfo.view, area);
    const target = boxOnScreen(viewInfo.view, unionBoxes([part.box, part.labelBox])!);
    const p = placeBeside(target, noteRect.width + 8, noteRect.height + 8, room, { gap: 30, sides: ['above', 'right', 'left', 'below'], step: 8, freeOnly: true });
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
  // Whether the drawing shows any of a run's numbers. It writes them only where a part or a node kept
  // its name: a circuit replaced in the Netlist panel by one with other names shows none, nor does a
  // drawing whose parts have all been deleted (phone review, F5).
  const marksShown = results.nodes.some((n) => !!n.mark) || [...results.parts.values()].some((p) => p.marks.length > 0);
  // The drawing shows numbers of a run of another text (in pencil): only then does a paused status say
  // they are from before the last change.
  const oldShown = !current && !!answers(record) && marksShown;
  const statusNow = statusWords(engineStatus, liveState, text, phone, hasParts(netlist), oldShown);
  // The last answers kept in pencil while building, if the drawing still shows some: said in words on
  // the status line, not only by their grey (WCAG 1.4.1).
  const status = stale && marksShown ? { ...statusNow, detail: `${statusNow.detail ? `${statusNow.detail} ` : ''}${t('statusOldPencil')}` } : statusNow;

  // A step above a sheet (see sheetOpen) is kept for this sheet and the room around it: the window, the
  // text size, the stack's greatest height, the bar, the sheet's head and the rows it keeps. (Measured
  // while one of them was still out of date, as just after a phone is turned, a step would be kept that
  // the room does not call for.) And for what the status line says and offers: its tone, its reason and
  // its buttons (Undo, the turn; not the run's time, which changes with every run), so a new status is
  // measured again from the first step: a status line that stepped aside for an error's long reason
  // comes back with the short one its undo brings.
  const rowsKept = Math.min(SHEET_ROWS_KEPT_REM * 16 * textScale, sheetRows || Number.POSITIVE_INFINITY);
  const undoAtHand = phone && snap.canUndo && snap.last.source === 'drawing';
  const statusKeyNow = `${status.tone}|${status.main.replace(/\d+/g, '#')}|${status.detail ?? ''}|${undoAtHand ? 'undo' : ''}|${phone && turned ? 'turn' : ''}`;
  // A run's own "Running…" (a change's or Run's, not ngspice loading) is no new status above a sheet: the
  // step and the key of the last settled status are kept through it, and the lines keep its height
  // (linesHeld), so each run neither brings the lines back above the sheet for a fifth of a second nor
  // moves the sheet's rows (the second re-check, AP-2). Its result is measured again only if it differs.
  const running = status.tone === 'busy' && status.main === t('statusSolving');
  // So are the rows the sheet keeps below its head (rowsKept): a run's own rows (Numbers' "ngspice is running
  // the netlist…" above a short sheet's) are no new room for the lines either. And so is its head: Checks'
  // head, "before every run", says "1 found" while the run of the change that found it is under way; taken
  // as a new room then, it lost the step the lines had (the hint came back, the lines out of sight came
  // back too, 61 px, on an iPhone SE at 150 %, until the run ended: the critic of the second re-check's
  // second fixes, whose window error "ResizeObserver loop" it was).
  const [settled, setSettled] = useState({ key: statusKeyNow, rows: rowsKept, head: sheetHead });
  useLayoutEffect(() => {
    if (!running && (settled.key !== statusKeyNow || Math.round(settled.rows) !== Math.round(rowsKept) || settled.head !== sheetHead)) setSettled({ key: statusKeyNow, rows: rowsKept, head: sheetHead });
  }, [running, statusKeyNow, rowsKept, sheetHead, settled]);
  const statusKey = running ? settled.key : statusKeyNow;
  const rowsKeptNow = running ? settled.rows : rowsKept;
  const sheetHeadNow = running ? settled.head : sheetHead;
  const sheetKey = sheetOpen ? `${sheetOpen}|${vw}|${vh}|${textScale}|${stackMax}|${Math.round(barRect.height)}|${sheetHeadNow}|${Math.round(rowsKeptNow)}|${statusKey}` : undefined;
  const sheetRoom = sheetOpen ? `${sheetOpen}|${vw}|${vh}|${textScale}|${stackMax}|${Math.round(barRect.height)}` : undefined;
  // Lines that need more room while the open sheet's head would come down over the row a finger last
  // pressed wait at the height they had (SheetHold below), until that row is pressed no more; out of sight
  // before, they stay so.
  const [linesWait, setLinesWait] = useState<{ room: string; height: number; row: Element } | undefined>(undefined);
  /** The wait just ended: whether the lines are still squeezed is measured before they are drawn (linesCut). */
  const [waitEnded, setWaitEnded] = useState(false);
  const waiting = linesWait && linesWait.room === sheetRoom ? linesWait : undefined;
  const [gaveWay, setGaveWay] = useState<{ key: string; step: 1 | 2 } | undefined>(undefined);
  const linesStep: 0 | 1 | 2 = !sheetKey ? 0 : gaveWay?.key === sheetKey ? gaveWay.step : short ? 1 : 0;
  const hintAside = linesStep >= 1;
  const linesAside = linesStep === 2 || (!!waiting && waiting.height < LINE_WAIT_MIN_PX);
  /** Step 1: the most the lines may take above the sheet, which keeps its head and about two rows (all its rows, when it has less). */
  const linesStepMax = linesStep === 1 && stackMax !== undefined && barRect.height ? Math.max(0, Math.floor(stackMax - barRect.height - sheetHeadNow - rowsKeptNow)) : undefined;
  const linesMax = waiting ? Math.min(linesStepMax ?? Number.POSITIVE_INFINITY, waiting.height) : linesStepMax;
  const linesBox = useRef<HTMLElement | null>(null);
  const linesBoxRef = useCallback(
    (el: HTMLElement | null) => {
      linesBox.current = el;
      linesRef(el);
    },
    [linesRef],
  );
  useLayoutEffect(() => {
    if (!sheetKey) {
      setGaveWay(undefined);
      return;
    }
    // Not for a run's "Running…": a step taken for it would be kept for the settled status after it. Nor
    // while the lines wait at the height they had (they are squeezed then, not too tall for this step).
    if (running || waiting) return;
    // Measured here, at this step and with the room it has now (linesMax): what the lines' watchers said
    // last may be from the step before, when the lines still gave way first.
    const over = (box: Element | null | undefined): boolean => !!box && box.scrollHeight > box.clientHeight + 1;
    const box = linesBox.current;
    if (linesStep === 0 && (over(box) || over(box?.querySelector('.hint-scroll')))) setGaveWay({ key: sheetKey, step: 1 });
    else if (linesStep === 1 && over(box)) setGaveWay({ key: sheetKey, step: 2 });
    // Measured again when the watchers see a change (words, sizes) or the room changes.
  }, [sheetKey, linesStep, linesSqueezed, hintSqueezed, linesMax, running, waiting]);

  // An open sheet keeps its rows where they are on the screen, whatever changes above it or in it (a run, a
  // new status, an undo, the hint, a run's own rows): a finger about to tap a row again (More's Undo, twice)
  // finds it there. When the lines need more room the sheet gives it from its top and its scroll moves on
  // by as much, its head coming down over its top rows: never over the row a finger last pressed, while
  // some of it is in view (the lines wait, squeezed, until the student presses anything else, uses the keys
  // or scrolls the sheet), and never over the row the keys are on (keepRows: the rows go down with it).
  // When they need less it takes back what it gave them, no more than its scroll can give back, and the
  // paper takes the rest. Its own rows coming or going keep the rows in view where they are (keepRows):
  // its scroll follows them, and room is kept below them while rows below have gone. Opening it, scrolling
  // it, rows that are all new, Checks' rows (a check found or fixed shows where it belongs, at once) or a
  // new window, text size or stack (a part in hand, the keyboard) lay it out afresh (AP-2).
  const sheetHold = useRef<SheetHold | undefined>(undefined);
  // After every render (whatever changed may have moved the sheet); it sets the lines waiting only once, and
  // not again while they wait.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const sheet = sheetRoom ? document.querySelector<HTMLElement>('.phone-bottom > .sheet') : null;
    const body = sheet?.querySelector<HTMLElement>(':scope > .card-body') ?? null;
    let held = sheetHold.current;
    if (held && (held.room !== sheetRoom || held.sheet !== sheet || held.body !== body)) {
      held.release();
      held = sheetHold.current = undefined;
    }
    // Lines that waited for another sheet (or this one, closed since) wait no more.
    if (linesWait && (linesWait.room !== sheetRoom || !held)) setLinesWait(undefined);
    if (!sheetRoom || !sheet || !body) return;
    if (!held) {
      sheetHold.current = holdSheet(sheetRoom, sheet, body, sheetOpen === 'checks');
      return;
    }
    // Not drawn yet (the steps above it may still settle), or Checks' own rows changed: laid out afresh, in
    // the same frame, and held from there.
    if (held.fresh || (held.afresh && Math.abs(rowsOf(body) - held.rows) > 0.5)) {
      measureSheet(held);
      return;
    }
    const above = aboveOf(sheet);
    // The head would come down over the row a finger last pressed (an undo or a redo tapped in More, a second
    // tap perhaps on its way): the lines that need more room wait at the height they had, before this is
    // drawn, and the sheet keeps its room and its head where they are. (The critic of the second re-check's
    // fixes: a second tap 300 ms after the first met the head, or its ×, which had come down over the row
    // tapped; waiting 600 ms after the last press, a second tap 0.65 to 0.95 s after the first still did.)
    if (!waiting && above > held.above + 0.5 && held.pressed && coversPressed(held)) {
      setLinesWait({ room: sheetRoom, height: held.above, row: held.pressed });
      return;
    }
    // It takes back only the room it gave the lines above it while held, as they give it back, and no
    // further than its scroll gives back (its rows staying where they are): the paper takes the rest.
    // Never because its scroll changed: the student's own scroll moves its rows, not its head (grown by
    // its scroll at the next change above it, a run lifted the head and its × by the 40 px scrolled).
    const gave = held.above - above;
    if (gave > 0.01) held.max = Math.min(held.cap, held.height + Math.min(gave, held.given, body.scrollTop));
    held.above = above;
    const max = `${held.max}px`;
    if (sheet.style.maxHeight !== max) sheet.style.maxHeight = max;
    const height = heightOf(sheet);
    held.given = Math.max(0, held.given + held.height - height);
    held.height = height;
    keepRows(held);
  });
  useEffect(
    () => () => {
      sheetHold.current?.release();
      sheetHold.current = undefined;
    },
    [],
  );
  // The lines wait until the row they wait for is pressed no more (another press, the keys, the sheet
  // scrolled), however long that is: a student who taps Undo, looks at the drawing and taps it again finds it
  // there (decision 0018).
  useEffect(() => {
    if (!waiting) return undefined;
    const held = sheetHold.current;
    const end = (): void => {
      setLinesWait(undefined);
      setWaitEnded(true);
    };
    if (!held || held.pressed !== waiting.row) {
      end();
      return undefined;
    }
    held.onFree = end;
    return () => {
      if (held.onFree === end) held.onFree = undefined;
    };
  }, [waiting]);
  // The card says what the status line says about runs: about to answer, or waiting for Run (and why).
  const cardRun: CardRun = { waiting: status.tone === 'busy', ...(status.tone === 'paused' || status.tone === 'bad' ? { stalled: status.detail ?? status.main } : {}) };
  const cardPart = card ? schematic?.circuit.parts.find((p) => p.key === card.key) : undefined;
  const cardProps = cardPart && card && schematic ? cardContent(cardPart, card, schematic, record, text, cardRun) : undefined;
  const empty = !tooBig && !!schematic && schematic.scene.parts.length === 0;
  /** The part in hand cannot go anywhere yet (an F with no source to read, ground on a page with no parts): said at once, not only over the paper. */
  const placeAnywhere = hand && schematic ? refusedAnywhere(schematic, hand.kind) : undefined;
  const movingName = move && schematic ? (move.grab.kind === 'part' ? (schematic.circuit.parts.find((p) => p.key === (move.grab as { key: string }).key)?.name ?? '') : move.grab.kind === 'ground' ? t('theGround') : t('labelName', { node: nodeSaid(schematic, move.grab.node) })) : '';
  const hintNow = hintWords({
    phone,
    tool,
    selectedName: selectedPart?.name,
    selectedNode: selected?.kind === 'node' && selected.name !== GROUND && schematic ? nodeWords(schematic, selected.name) : undefined,
    selectedGround: selected?.kind === 'node' && selected.name === GROUND && !selectedWire,
    selectedWire: selectedWire && schematic ? nodeSaid(schematic, schematic.scene.wires[selectedWire.wire]?.node ?? GROUND) : undefined,
    typeHint: cardProps?.label ? cardProps.typeHint : undefined,
    // The same rule as the card's keys and badges (IndexCard): T types, or T turns.
    typed: !!card && cardTyping,
    nodeCard: nodeCard && schematic ? { name: nodeCard.node === GROUND ? t('groundName') : nodeWords(schematic, nodeCard.node), ground: nodeCard.node === GROUND } : undefined,
    paused: status.tone === 'paused',
    whole: viewInfo?.whole ?? true,
    fits: viewInfo?.fits ?? true,
    turned: !!turned && shown === turned,
    asDrawn: asDrawnOnPhone,
    video,
    invite: ((phone && noteWanted) || noteNoRoom) && firstScreenInvite ? firstScreenInvite.name : undefined,
    undrawn: tooBig,
    empty,
    place: placeAnywhere
      ? { refused: placeAnywhere, anywhere: true }
      : placeView && schematic
        ? placeView.ok
          ? { joins: joinsWords(schematic, placeView) }
          : { refused: placeView.reason ?? '' }
        : refusal && hand
          ? { refused: refusal }
          : undefined,
    wire: tool === 'wire' ? { started: !!wireDraft, ...(refusal ? { refused: refusal } : {}), ...(wireMerge ? { merge: wireMerge } : {}) } : undefined,
    keys: toolByKey,
    moving: move ? { name: movingName, how: move.how, part: move.grab.kind === 'part', ...(move.preview && !move.preview.ok ? { refused: move.preview.reason ?? '' } : {}) } : undefined,
    editingAsDrawn: phone && turnedForEditing && (tool !== 'select' || !!move),
    connections: !!card && connOpen && !strip,
  });
  // A refused edit's reason is in the hint line until the next thing happens, or for a few seconds
  // (it was said aloud too): then the hint says again what can be done now.
  const refusalShown = !!refusal && !hand && tool !== 'wire' && !move;
  // (A note that must be read shows with a part still in hand too: Shift+click keeps the tool.)
  const noteInHint = hintShowsNote(noteLine, { refused: refusalShown, inHand: !!hand, moving: !!move });
  const hint = refusal && refusalShown ? refusal : noteLine && noteInHint ? noteLine.words : hintNow;
  // The lines' height for the settled status, kept through a run's "Running…" (shorter or not, it takes
  // no less room: a taller one, a button that came with the change, takes more).
  const [linesSettled, setLinesSettled] = useState(0);
  useLayoutEffect(() => {
    if (!sheetKey || running || waiting || linesAside) return;
    const h = linesBox.current?.getBoundingClientRect().height ?? 0;
    setLinesSettled((old) => (Math.abs(old - h) < 0.01 ? old : h));
  }, [sheetKey, running, waiting, linesAside, statusKeyNow, hint, linesSqueezed, hintSqueezed, linesMax]);
  const linesHeld = running && !!sheetKey && !linesAside && linesSettled > 0 ? Math.min(linesSettled, linesMax ?? Number.POSITIVE_INFINITY) : undefined;
  // Squeezed, the lines scroll (a named region the keys reach): too tall for their room, or waiting at the height they had.
  // Just after a wait the lines' watcher still says squeezed (it saw them capped) for a frame: how they are
  // is measured before they are drawn, or the strip's edge took 5 px for that frame and the head came down
  // 5 px too far and went back.
  const linesCut = ((linesSqueezed && !waitEnded) || !!waiting) && !linesAside;
  useLayoutEffect(() => {
    if (!waitEnded) return;
    const box = linesBox.current;
    if (!linesSqueezed || (!!box && box.scrollHeight > box.clientHeight + 1)) setWaitEnded(false);
  }, [waitEnded, linesSqueezed]);
  // The hint line shows the note now: on a phone a card's sheet takes the hint line's place, and the
  // netlist being typed puts it aside, as does a sheet that needs its room (hintAside).
  const noteInView = noteInHint && (!phone || (phoneSheet !== 'card' && !typingNetlist && !hintAside));
  useEffect(() => {
    if (!refusal) return undefined;
    const timer = window.setTimeout(() => setRefusal(undefined), REFUSAL_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [refusal]);
  // An edit's note goes after a few seconds; the starter's why once it has been in view long enough
  // to read (after the first part's card sheet closes, on a phone: the critic of words W9).
  useNoteTimer(noteLine, noteInView, clearNote);
  const plotAvailable = hasSweeps(record);
  /** The netlist's sweep lines (.dc, .tran), by name. */
  const sweepNames = useMemo(() => [...new Set(netlist.analyses.map((i) => netlist.lines[i]?.directive?.name).filter((n): n is string => n === '.dc' || n === '.tran'))], [netlist]);
  const tf = current && record.status === 'ok' && record.words.tf ? tfRows(record.words.tf) : [];
  const sweeps = current && record.status === 'ok' ? record.words.sweeps : [];
  const notDrawn = schematic?.circuit.notDrawn ?? [];

  const cardHandlers = {
    onValue,
    onTyping: setCardTyping,
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
  /** A node's card, from the model's words and the last run. */
  const nodeCardProps = ((): Omit<NodeCardProps, 'variant'> | undefined => {
    if (!nodeCard || !schematic) return undefined;
    const ground = nodeCard.node === GROUND;
    const info = schematic.circuit.nodes.get(nodeCard.node) ?? (nodeCard.renamed !== undefined ? schematic.circuit.nodes.get(nodeCard.renamed) : undefined);
    if (!ground && !info) return undefined;
    const name = ground ? t('groundName') : (info?.text ?? nodeCard.node);
    // "node in is 6 volts", 'node "ground" is 4 volts': a name may be an ordinary word (words re-check 2).
    const sentence = sentenceNode(name);
    const n = results.nodes.find((x) => x.node === nodeCard.node);
    const label = schematic.drawing.labels.some((l) => l.node === nodeCard.node);
    const voltage = ground
      ? { text: formatSI(0, 'V'), speech: DESCRIBE_STRINGS.valueIsSpeech(EDIT_STRINGS.ground, speakSI(0, 'V')), pending: false }
      : n
        ? { text: n.mark ? n.mark.text.replace(/^=\s*/, '') : n.words.text, speech: DESCRIBE_STRINGS.valueIsSpeech(DESCRIBE_STRINGS.node(sentence), n.words.speech), pending: !current }
        : undefined;
    return {
      name,
      said: ground ? name : nodeInSentence(sentence),
      ground,
      input: nodeCard.input,
      ...(nodeCard.refused ? { refused: nodeCard.refused } : {}),
      groundName: EDIT_STRINGS.groundName,
      voltage,
      // No voltage from a run that found an error: why (the check), not "in a moment".
      ...(!voltage && current && record ? { noVoltage: noNumbersReason(record) } : {}),
      sentence: describeNode(schematic, nodeCard.node),
      session: nodeCard.session,
      takeFocus: nodeCard.focus,
      onInput: (value: string) => setNodeCard((c) => (c ? { node: c.node, ...(c.renamed !== undefined ? { renamed: c.renamed } : {}), ground: c.ground, session: c.session, input: value, focus: c.focus } : c)),
      onRename: () => renameNow(),
      onMove: asDrawn && (ground ? schematic.drawing.grounds.length > 0 : label) ? () => startMove(ground ? { kind: 'ground', ground: Math.min(nodeCard.ground ?? 0, schematic.drawing.grounds.length - 1) } : { kind: 'label', node: nodeCard.node }, 'pick') : undefined,
      onDeleteGround: ground && schematic.drawing.grounds.length ? () => deleteNow({ ground: Math.min(nodeCard.ground ?? 0, schematic.drawing.grounds.length - 1) }) : undefined,
      onClose: () => closeNodeCard(),
    };
  })();

  const overlayOnPaper = (info: CanvasViewInfo): ReactNode => {
    if (phone || (!card && !nodeCard)) return null;
    if (!card && nodeCardProps) return pinnedCard(info, <NodeCard {...nodeCardProps} variant="pinned" {...cardWhere()} />);
    if (!cardProps || !card) return null;
    // The value opens selected: typing replaces it, and T, M and Shift+R act on the part until a value is typed.
    const own = { ...cardProps, ...cardHandlers, takeFocus: card.focus !== false, session: card.session, selectValue: true, edit: cardEditing };
    return pinnedCard(info, <IndexCard {...own} variant="pinned" {...cardWhere()} />);
  };
  /** Which side of its part (or node) the pinned card is on, and where its notch points. */
  const cardWhere = (): { side?: Side; notch?: number } => {
    if (docked || !cardNow) return {};
    const { box, side, notch } = cardNow;
    return { side, notch: side === 'above' || side === 'below' ? notch.x - box.x0 : notch.y - box.y0 };
  };
  /** A card pinned on the paper: beside what it is for, or docked along the bottom. */
  const pinnedCard = (info: CanvasViewInfo, body: ReactNode): ReactNode => {
    let style: CSSProperties;
    let leader: { from: { x: number; y: number }; to: { x: number; y: number } } | undefined;
    if (docked) {
      style = { left: area.x0 + Math.max(0, (area.x1 - area.x0 - cardWidth) / 2), bottom: info.size.height - area.y1, width: cardWidth };
    } else if (cardNow) {
      const { box, side } = cardNow;
      leader = cardNow.leader;
      style = side === 'above' ? { left: box.x0, bottom: info.size.height - box.y1, width: cardWidth } : { left: box.x0, top: box.y0, width: cardWidth };
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
          {body}
        </div>
      </>
    );
  };

  // A drawing wider than the window (on a phone, as drawn or turned as well as it can be; a long circuit
  // on a laptop): the edges say there is more, judged by the ink on the paper (not the room kept around
  // it for longer numbers).
  const inkParts = useMemo((): Box[] => {
    if (!shown) return [];
    const wires = shown.scene.wires.map((w) => unionBoxes(w.points.map((p) => ({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })))).filter((b): b is Box => !!b);
    return [...symbolBoxes(shown.scene), ...inkBoxes(shown.scene, results), ...wires];
  }, [shown, results]);
  const ink = useMemo(() => unionBoxes(inkParts), [inkParts]);
  const edges = useMemo(() => {
    const none = { left: false, right: false, top: 0 };
    if (!viewInfo || strip || !ink || !shown) return none;
    const c = boxOnScreen(viewInfo.view, ink);
    const left = c.x0 < insets.left - 4;
    const right = c.x1 > viewInfo.size.width - insets.right + 4;
    if (!left && !right) return none;
    // Half way down the free paper, or higher or lower where that keeps the button off the drawing's words;
    // never above the free paper (under the top bar) when it is short for the button (2.75rem: it grows with the text).
    const y0 = insets.top + 8;
    const y1 = Math.max(y0, viewInfo.size.height - insets.bottom - 8 - 44 * textScale);
    const onScreen = inkParts.map((b) => boxOnScreen(viewInfo.view, b));
    const clear = (top: number): boolean =>
      !onScreen.some((b) => b.y0 < top + 44 && b.y1 > top && ((left && b.x0 < insets.left + 90) || (right && b.x1 > viewInfo.size.width - insets.right - 90)));
    const middle = Math.round((y0 + y1) / 2);
    const tries = [middle, ...Array.from({ length: 24 }, (_, i) => middle + (i % 2 ? 1 : -1) * Math.ceil((i + 1) / 2) * 24)].filter((y) => y >= y0 && y <= y1);
    return { left, right, top: tries.find(clear) ?? middle };
    // insets by their numbers
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [viewInfo, ink, inkParts, shown, strip, insets.left, insets.right, insets.top, insets.bottom, textScale]);
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


  // ------------------------------------------------------------------ the editor (decision 0017)
  // Plain functions, made again each render: every edit reads the state as it is now. The model
  // decides (src/app/editing.ts and src/schematic applyEdit); this only wires it to the page.

  /** The drawing of the text as it is now: the one shown, unless the store has moved on this very frame. */
  const currentDrawing = (): Schematic | undefined => {
    if (tooBig) return undefined;
    const now = store.get();
    const s = schematic && schematic.netlist.text === now ? schematic : buildSchematic(now, NOTEBOOK_OPTIONS);
    const names = usedNodeNames();
    // The same drawing with the same names is the same object, render after render (as the drawing itself is).
    const last = editable.current;
    if (last && last.s === s && last.names === names) return last.out;
    const out = withUsedNodeNames(s, names);
    editable.current = { s, names, out };
    return out;
  };
  /**
   * The node names the open circuit had in its undo history (as the store has it now): a new node
   * never takes one, so a name just said ("Node n2 is now ground") never comes back for a new,
   * separate node. Each text's names are read once; only this circuit's texts are kept.
   */
  const usedNodeNames = (): ReadonlySet<string> => {
    const version = store.snapshot().version;
    const known = usedNames.current;
    if (known.version === version) return known.names;
    const texts = store.circuitTexts();
    const memo = new Map<string, readonly string[]>();
    for (const t of texts) {
      const names = known.memo.get(t);
      if (names) memo.set(t, names);
    }
    const names = nodeNamesIn(texts, memo);
    usedNames.current = { version, names, memo };
    return names;
  };
  /** The phone's turned view is another drawing than the netlist's: editing shows it as drawn (and the hint says so). */
  const asDrawnForEditing = (): void => {
    if (phone && turned && turnWanted) {
      setTurnWanted(false);
      setTurnedForEditing(true);
    }
  };
  /**
   * One edit made on the drawing: its text into the store as one undo step (source 'drawing', the
   * summary's first sentence as what Undo says), the summary announced, and the view kept still
   * (`fit`: fitted again instead, for a part the form adds where the drawing finds room).
   */
  const commit = (text: string, summary: string, how: { group?: string; select?: NavItem; focus?: boolean; open?: 'card' | 'value'; fit?: boolean; notes?: readonly DrawingProblem[] } = {}): void => {
    setRefusal(undefined);
    focusCheck.current = true;
    const before = store.get();
    if (text !== before) {
      if (how.fit) setFitCount((n) => n + 1);
      else canvas.current?.keep();
      store.set(text, { source: 'drawing', label: firstSentence(summary), ...(how.group ? { group: how.group } : {}) });
    }
    // The first edit made on the drawing of a netlist without drawing lines writes them (where each
    // part is, decision 0013): said, never behind the student's back (drawing-1: ngspice skips them).
    const wrote = text !== before && !hasDrawingLines(before) && hasDrawingLines(text) ? ` ${t('drawingWritten')}` : '';
    // What PlainSpice also did to the drawing that the student should know (lines of parts the netlist
    // no longer has removed, a line it could not use): said after the summary.
    const said = (how.notes ?? []).filter((n) => n.severity === 'warning' || n.kind === 'orphans-dropped').map((n) => n.message);
    announce([`${summary}${wrote}`, ...said].join(' '));
    // The first part on a blank page also wrote .op and .end (needsStarter): why, first in the hint
    // line, so the new lines in the netlist are explained to the eye too (final reviews, words W9),
    // and held there until it has been read (hint-note.ts: the critic of W9).
    const starter = summary.includes(starterWords()) ? starterWords() : '';
    // Seen too, not only heard: in the hint line for a moment, as a refusal's reason is (setRefusal below clears it otherwise).
    if (said.length || wrote || starter) {
      refusedAt.current = performance.now();
      setNoteLine({ words: [...(starter ? [starter] : []), ...(wrote ? [wrote.trim()] : []), ...said].join(' '), ...(starter ? { read: true } : {}) });
    } else if (!noteLine?.read) setNoteLine(undefined);
    // (A change with nothing to say leaves a note that must be read, as a value typed on the new part's
    // card does: it stays for its reading time, on a phone from when the card's sheet closes.)
    setNoteWanted(false);
    if (how.select) {
      setSelected(how.select);
      setSelectedWire(undefined);
      pendingReveal.current = how.select;
      if (how.focus || how.open) pendingFocus.current = { item: how.select, ...(how.open ? { open: how.open } : {}) };
    }
  };
  /** An edit refused: the model's reason in the hint line and for screen readers (in place of an edit's note). */
  const refuse = (reason: string): void => {
    refusedAt.current = performance.now();
    setRefusal(reason);
    setNoteLine(undefined);
    announce(reason);
  };
  /** A model edit on the drawing as it is now: done (one undo step), or refused with the model's reason. */
  const edit = (op: EditOp | ((s: Schematic) => EditResult), how: Parameters<typeof commit>[2] = {}): EditResult | undefined => {
    const s = currentDrawing();
    if (!s) return undefined;
    const r = typeof op === 'function' ? op(s) : applyEdit(s, op);
    if (!r.ok) {
      refuse(r.reason ?? EDIT_STRINGS.failed);
      return r;
    }
    commit(r.text, r.summary, { ...how, notes: r.notes });
    return r;
  };
  /** The item an edit's result says to select: a part or a node. */
  const selectOf = (r: EditResult): NavItem | undefined => (r.select && 'part' in r.select ? { kind: 'part', key: r.select.part } : r.select && 'node' in r.select ? { kind: 'node', name: r.select.node } : undefined);
  /** What a grab is called in the hint line ("R1", "the ground symbol", "the name out"). */
  const grabName = (s: Schematic, g: Grab): string => (g.kind === 'part' ? (s.circuit.parts.find((p) => p.key === g.key)?.name ?? g.key) : g.kind === 'ground' ? t('theGround') : t('labelName', { node: nodeSaid(s, g.node) }));
  const grabItem = (g: Grab): NavItem => (g.kind === 'part' ? { kind: 'part', key: g.key } : g.kind === 'ground' ? { kind: 'node', name: GROUND } : { kind: 'node', name: g.node });

  /**
   * Whether the thing being moved can go where it is wanted now, by the model's preview: made again when
   * the one drawn is of an older place, turn or text (a key pressed before the next frame), as dropMove does.
   */
  const canGoNow = (m: MoveState, s: Schematic): boolean => {
    const want = moveWanted.current ?? m.preview?.to;
    const preview = want && !previewFits(m, want, s.netlist.text) ? movePreview(s, m.grab, want, m.turn) : m.preview;
    return !preview || preview.ok;
  };
  /** Turn, Mirror or Reverse: the part in hand, the part being moved, else the selected part (or the one named). */
  const turnPart = (kind: 'turn' | 'mirror' | 'reverse', key?: string): void => {
    if (key === undefined && hand) {
      // Drawn turned at once, and said (a screen reader has no picture of the part in hand).
      if (hand.kind === 'ground' && kind !== 'turn') return announce(t('handGroundSame'));
      setHand(kind === 'turn' ? turnHand(hand) : kind === 'mirror' ? mirrorHand(hand) : reverseHand(hand));
      announce(t(kind === 'turn' ? 'handTurned' : kind === 'mirror' ? 'handMirrored' : 'handReversed', { part: cap(toolPhrase(hand.kind)) }));
      return;
    }
    const m = moveRef.current;
    if (m) {
      // Something being moved: a part turns or mirrors where it will land (one step with the move);
      // Reverse changes the netlist, so it waits until the part is put down.
      const s = currentDrawing();
      if (!s) return;
      const name = cap(grabName(s, m.grab));
      const placed = m.grab.kind === 'part' ? s.drawing.parts.get(m.grab.key) : undefined;
      if (!placed) return refuse(t('turnOnlyParts'));
      // Where it cannot go (a half turn where it stands, a place taken ...) it can only go back first:
      // the sentence follows the move's preview, as the hint line does (words re-check 11). The name
      // starts only the second sentence ("Put R1 down first", "R1 can’t go here").
      if (kind === 'reverse') return refuse(canGoNow(m, s) ? t('reverseWhileMoving', { name: grabName(s, m.grab) }) : t('reverseWhileRefused', { name }));
      const was = m.turn ?? { rot: placed.rot, mirror: placed.mirror };
      const next: MoveState = { ...m, turn: kind === 'turn' ? { ...was, rot: nextRotation(was.rot) } : { ...was, mirror: !was.mirror } };
      moveRef.current = next;
      setMove(next);
      moveTo(moveWanted.current ?? m.preview?.to ?? placed.at);
      announce(t(kind === 'turn' ? 'turnedMoving' : 'mirroredMoving', { name }));
      return;
    }
    const part = key ?? (selected?.kind === 'part' ? selected.key : undefined);
    if (!part) return;
    const op: EditOp = kind === 'turn' ? { kind: 'rotate-part', part } : kind === 'mirror' ? { kind: 'mirror-part', part } : { kind: 'reverse-part', part };
    const r = edit(op, { select: { kind: 'part', key: part } });
    if (r?.ok && card?.key === part) setCardLayout((n) => n + 1);
  };

  /** Shift+arrow: the selected part, ground symbol or node name one grid step that way (moves in a row: one undo step). */
  const stepSelected = (dir: 'up' | 'down' | 'left' | 'right'): void => {
    const s = currentDrawing();
    if (!s || !selected) return;
    const g = grabOf(s, selected, selectedGround);
    const to = g ? stepFrom(s, g, dir) : undefined;
    if (!g || !to) return refuse(t('moveNoName'));
    asDrawnForEditing();
    edit(moveOp(g, to), { group: `move:${moveRun.current}`, select: selected });
  };

  /** Delete: the selection (or the part or ground symbol named); the focus goes to a neighbour, never lost. */
  const deleteNow = (what?: { part?: string; ground?: number }): void => {
    const s = currentDrawing();
    if (!s) return;
    const op: EditOp | undefined =
      what?.part !== undefined ? { kind: 'delete-part', part: what.part } : what?.ground !== undefined ? { kind: 'delete-ground', ground: what.ground } : deleteOp(s, selected, selectedWire, selectedGround);
    if (!op) return;
    const r = applyEdit(s, op);
    if (!r.ok) return refuse(r.reason ?? EDIT_STRINGS.failed);
    // The neighbour: the node the part was on, ground for a ground symbol, a wire's own node.
    let next: NavItem | undefined;
    if (op.kind === 'delete-part') {
      const p = s.circuit.parts.find((x) => x.key === op.part);
      if (p) next = { kind: 'node', name: p.nodes[0] };
    } else if (op.kind === 'delete-ground') next = { kind: 'node', name: GROUND };
    else if (op.kind === 'delete-wire') {
      const node = s.scene.wires[op.wire]?.node;
      if (node !== undefined) next = { kind: 'node', name: node };
    }
    setCard(undefined);
    setNodeCard(undefined);
    setEditing(false);
    setSelectedWire(undefined);
    setSelectedGround(undefined);
    commit(r.text, r.summary, next ? { select: next, focus: true, notes: r.notes } : { notes: r.notes });
    if (!next) setSelected(undefined);
    // A line still names what went (an F reading a deleted V2, a .tf line): the summary says which; offer it.
    const line = r.select && 'line' in r.select ? r.select.line : r.select && 'part' in r.select ? linePartIn(r.text, r.select.part) : undefined;
    if (line !== undefined) {
      const head = firstSentence(r.summary);
      setNotice({ tone: 'info', title: head, text: r.summary.slice(head.length).trim(), action: { label: t('goToLine', { line }), run: () => goToLine(line) } });
    }
  };

  /** The Wire tool: the first click (or Enter on a node) starts a wire; a click on empty paper makes a corner; the next end finishes it. */
  const wireAt = (end: WireStart | undefined, at: Point | undefined): void => {
    const s = currentDrawing();
    if (!s) return;
    asDrawnForEditing();
    if (!wireDraft) {
      if (!end) return refuse(t('wireStartHere'));
      setWireDraft({ start: end, corners: [] });
      setRefusal(undefined);
      announce(t('wireStarted', { node: end.node === undefined ? t('joinsNew') : nodeSaid(s, end.node) }));
      return;
    }
    if (end) {
      const r = wireEdit(s, wireDraft, end);
      if (!r.ok) return refuse(r.reason ?? EDIT_STRINGS.failed);
      setWireDraft(undefined);
      const item = selectOf(r);
      // Ended from the keyboard (Enter on a node): the focus goes to the node the wire joined (the
      // button it was on may be gone with its old name).
      commit(r.text, r.summary, item ? { select: item, focus: lastInput.current === 'key', notes: r.notes } : { notes: r.notes });
      return;
    }
    if (at) {
      // A corner only where the wire can get to: else it could never be finished from there.
      const corner = gridPoint(at);
      if (!wirePreview(s, wireDraft, corner)) return refuse(t('wireNoCorner'));
      setWireDraft({ ...wireDraft, corners: [...wireDraft.corners, corner] });
      setRefusal(undefined);
      announce(t('wireCorner'));
    }
  };

  /** Places the part in hand at a grid point: back to Select with it selected and its card open on its value (Shift: the tool stays). */
  const placeHere = (at: Point, keep: boolean): void => {
    const s = currentDrawing();
    if (!s || !hand) return;
    const r = placeEdit(s, hand, at);
    if (!r.ok) return refuse(r.reason ?? EDIT_STRINGS.failed);
    const item = selectOf(r) ?? (hand.kind === 'ground' ? { kind: 'node' as const, name: GROUND } : undefined);
    setLookAt(undefined);
    // A controlled source reads what the model chose for it to start from: said, and marked in red pen
    // until the student chooses on its card.
    let summary = r.summary;
    if (item?.kind === 'part' && (hand.kind === 'E' || hand.kind === 'F' || hand.kind === 'G' || hand.kind === 'H')) {
      const placed = buildSchematic(r.text, NOTEBOOK_OPTIONS).circuit.parts.find((p) => p.key === item.key);
      const control = placed ? controlWords(placed) : undefined;
      if (placed && control) {
        summary = `${summary} ${t('controlPlaced', { name: placed.name, control })}`;
        setUnchosen((u) => new Set([...u, item.key]));
      }
    }
    if (keep) {
      commit(r.text, summary);
      return;
    }
    chooseTool('select');
    commit(r.text, summary, item ? { select: item, focus: true, ...(item.kind === 'part' ? { open: 'value' as const } : {}) } : {});
  };

  /** Picks something up to move it: dragged (the pointer holds it) or picked (the card's Move: a click or Enter puts it down). */
  const startMove = (g: Grab, how: 'drag' | 'pick', pointer?: Point): void => {
    const s = currentDrawing();
    const at = s ? grabAt(s, g) : undefined;
    if (!s || !at) return;
    asDrawnForEditing();
    setCard(undefined);
    setNodeCard(undefined);
    setEditing(false);
    setRefusal(undefined);
    setSelectedWire(undefined);
    const m: MoveState = { grab: g, how, offset: pointer ? { x: pointer.x - at.x, y: pointer.y - at.y } : { x: 0, y: 0 }, preview: { grab: g, to: at, base: s.netlist.text, ok: true, schematic: s } };
    // The view holds still while something is moved: fitting to the preview as it grows would move the
    // grid under the pointer (a drag outwards zoomed out and dropped the part far away).
    canvas.current?.keep();
    moveRef.current = m;
    moveWanted.current = at;
    setMove(m);
    const item = grabItem(g);
    setSelected(item);
    if (how === 'pick') {
      // On the drawing at once (the arrow keys move it from the very next key), and again once the card has gone.
      canvas.current?.focusItem(item);
      requestAnimationFrame(() => canvas.current?.focusItem(item));
      // "R2 picked up: click where R2 goes · …": the hint goes on after the colon in lower case.
      const hint = hintWords({ phone, tool: 'select', selectedName: undefined, typeHint: undefined, whole: true, turned: false, asDrawn: true, moving: { name: grabName(s, g), how: 'pick', part: g.kind === 'part' } });
      announce(t('pickedUp', { name: cap(grabName(s, g)), hint: afterColon(hint) }));
    }
  };
  /** The moving thing wanted at a point: previewed once a frame (the model's move, the drawing it gives). */
  const moveTo = (to: Point): void => {
    moveWanted.current = to;
    if (moveFrame.current !== undefined) return;
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = undefined;
      const m = moveRef.current;
      const want = moveWanted.current;
      const s = currentDrawing();
      if (!m || !want || !s || previewFits(m, want, s.netlist.text)) return;
      const next = { ...m, preview: movePreview(s, m.grab, want, m.turn) };
      moveRef.current = next;
      setMove(next);
      if (m.how === 'pick') sayWhereSoon();
      if (moveReveal.current) {
        moveReveal.current = false;
        const box = moveBox(s, next);
        if (box) canvas.current?.reveal(box, handRect.height ? handRect.height + 12 : 0);
      }
    });
  };
  /** Where a thing being moved is drawn now (grid units): its symbol and words where it would land, or its ghost where it cannot. */
  const moveBox = (s: Schematic, m: MoveState): Box | undefined => {
    const p = m.preview;
    if (!p) return undefined;
    const sc = p.ok ? p.schematic?.scene : undefined;
    const g = m.grab;
    if (g.kind === 'part') {
      const part = sc?.parts.find((x) => x.key === g.key);
      if (part) return unionBoxes([part.box, part.labelBox]);
      const placed = s.drawing.parts.get(g.key);
      const letter = s.circuit.parts.find((x) => x.key === g.key)?.letter;
      return placed && letter ? symbolGeometry(letter, p.to, m.turn?.rot ?? placed.rot, m.turn?.mirror ?? placed.mirror).box : undefined;
    }
    if (g.kind === 'ground') return symbolGeometry('ground', p.to, s.drawing.grounds[g.ground]?.rot ?? 0, false).box;
    return sc?.nodeLabels.find((l) => l.node === g.node)?.box ?? { x0: p.to.x - 1, y0: p.to.y - 1, x1: p.to.x + 1, y1: p.to.y + 1 };
  };
  /** Puts it down where it is wanted: one undo step, or back where it was with the model's reason. */
  const dropMove = (): void => {
    const m = moveRef.current;
    moveRef.current = undefined;
    if (moveFrame.current !== undefined) {
      cancelAnimationFrame(moveFrame.current);
      moveFrame.current = undefined;
    }
    setMove(undefined);
    const s = currentDrawing();
    if (!m || !s) return;
    // Made again when the text has changed since (typed in the Netlist panel, a fix, a key): a preview
    // of an older text would put that text back.
    const want = moveWanted.current ?? m.preview?.to;
    const preview = want && !previewFits(m, want, s.netlist.text) ? movePreview(s, m.grab, want, m.turn) : m.preview;
    const item = grabItem(m.grab);
    if (!preview || !preview.ok) {
      setSelected(item);
      // It went back: said with why, once; the hint goes back to what can be done on the next move.
      return refuse(t('dropRefused', { name: cap(grabName(s, m.grab)), reason: afterColon(preview?.reason ?? EDIT_STRINGS.failed) }));
    }
    if (m.grab.kind === 'ground') setSelectedGround(m.grab.ground);
    if (!preview.result) {
      setSelected(item);
      if (m.how === 'pick') requestAnimationFrame(() => canvas.current?.focusItem(item));
      return;
    }
    commit(preview.result.text, preview.result.summary, { select: item, focus: m.how === 'pick', notes: preview.result.notes });
  };
  const cancelMove = (): void => {
    const m = moveRef.current;
    moveRef.current = undefined;
    setMove(undefined);
    const s = currentDrawing();
    if (m && s) {
      announce(t('putBack', { name: cap(grabName(s, m.grab)) }));
      if (m.how === 'pick') requestAnimationFrame(() => canvas.current?.focusItem(grabItem(m.grab)));
    }
  };

  /** The Add a part form: the part in hand's kind (else a resistor), between the node selected and a new one. */
  const openAddForm = (letter?: PartLetter, near?: string): void => {
    const s = currentDrawing();
    if (!s) return;
    const kind = letter ?? (hand && hand.kind !== 'ground' ? hand.kind : 'R');
    setAddForm(formStart(s, kind, near ?? (selected?.kind === 'node' ? selected.name : undefined)));
    openOverlay('add-part');
  };
  const addFromForm = (form: PartForm): string | undefined => {
    const s = currentDrawing();
    if (!s) return EDIT_STRINGS.failed;
    const r = addPartEdit(s, form);
    if (!r.ok) return r.reason;
    if (tool !== 'select') chooseTool('select');
    commit(r.text, r.summary, { select: { kind: 'part', key: r.key }, focus: true, fit: true });
    return undefined;
  };

  /** A node's card: renamed with the model's rename-node (a name another node has joins the two). */
  const renameNow = (): void => {
    const c = nodeCard;
    const s = currentDrawing();
    if (!c || !s) return;
    // The name it already has (as written): nothing to do, and it says so, not "renamed".
    const written = s.circuit.nodes.get(c.node)?.text ?? c.node;
    if (c.input.trim() === written) {
      announce(t('renameSame', { name: written }));
      return;
    }
    const r = applyEdit(s, { kind: 'rename-node', node: c.node, name: c.input });
    if (!r.ok) {
      setNodeCard({ ...c, refused: r.reason ?? EDIT_STRINGS.failed });
      announce(r.reason ?? EDIT_STRINGS.failed);
      return;
    }
    const name = r.select && 'node' in r.select ? r.select.node : c.node;
    commit(r.text, r.summary, { select: { kind: 'node', name }, notes: r.notes });
    // The card stays open, on the node as it is now named (the drawing follows the text a frame
    // later: until then it shows the old name's card, never none), and the focus stays in its field.
    setNodeCard({ node: c.node, renamed: name, ground: c.ground, session: c.session, input: c.input.trim(), focus: false });
  };

  /** The open card's drawing side: Turn, Mirror, Reverse, Move, Delete, Connections, and what a dependent source reads. */
  const cardEditing = ((): PartEditing | undefined => {
    if (!card || !schematic) return undefined;
    const part = schematic.circuit.parts.find((p) => p.key === card.key);
    if (!part) return undefined;
    const key = part.key;
    const written = (n: string): string => (n === GROUND ? '0' : (schematic.circuit.nodes.get(n)?.text ?? n));
    const keep = { group: `card:${card.session}`, select: { kind: 'part' as const, key } };
    let control: ControlEditing | undefined;
    if (part.control?.kind === 'voltage') {
      control = {
        kind: 'voltage',
        plus: part.control.plus,
        minus: part.control.minus,
        nodes: nodeChoices(schematic, true),
        onChange: (plus, minus) => {
          if (edit({ kind: 'set-control', part: key, plus: written(plus), minus: written(minus) }, keep)?.ok) controlChosen(key);
        },
      };
    } else if (part.control?.kind === 'current') {
      const sources = sourceChoices(schematic, key);
      const onChange = (source: string): void => {
        const name = schematic.circuit.parts.find((p) => p.key === source)?.name;
        if (name && edit({ kind: 'set-control', part: key, source: name }, keep)?.ok) controlChosen(key);
      };
      control = sources.length ? { kind: 'current', source: part.control.source, sources, onChange } : { kind: 'current', source: '', sources, onChange, none: EDIT_STRINGS.noSource(part.letter) };
    }
    return {
      name: part.name,
      drawn: asDrawn && schematic.drawing.parts.has(key),
      onTurn: () => turnPart('turn', key),
      onMirror: () => turnPart('mirror', key),
      onReverse: () => turnPart('reverse', key),
      onMove: () => startMove({ kind: 'part', key }, 'pick'),
      onDelete: () => deleteNow({ part: key }),
      ends: endsOf(schematic, key),
      nodes: nodeChoices(schematic, true),
      onConnect: (pin, node) => {
        if (edit((s) => connectEdit(s, key, pin, node), { select: { kind: 'part', key } })?.ok) setCardLayout((n) => n + 1);
      },
      onDisconnect: (pin) => {
        if (edit((s) => disconnectEdit(s, key, pin), { select: { kind: 'part', key } })?.ok) setCardLayout((n) => n + 1);
      },
      ...(control ? { control } : {}),
      open: connOpen,
      onOpen: (open) => setConnOpen(open),
    };
  })();

  /** What the editor shows on the paper now: the part in hand, one that cannot go where it is dragged, a wire on its way and where wires can end, a piece of wire selected. */
  const marks = ((): EditMarks | undefined => {
    if (!schematic || !asDrawn) return undefined;
    const out: EditMarks = {};
    if (placeView) out.ghost = { kind: placeView.hand.kind, at: placeView.at, rot: placeView.hand.rot, mirror: placeView.hand.mirror, refused: !placeView.ok, pins: placeView.pins };
    const m = move;
    if (m?.preview && !m.preview.ok) {
      if (m.grab.kind === 'part') {
        const key = m.grab.key;
        const placed = schematic.drawing.parts.get(key);
        const part = schematic.circuit.parts.find((x) => x.key === key);
        if (placed && part) out.ghost = { kind: part.letter, at: m.preview.to, rot: placed.rot, mirror: placed.mirror, refused: true, pins: [] };
      } else if (m.grab.kind === 'ground') {
        const g = schematic.drawing.grounds[m.grab.ground];
        if (g) out.ghost = { kind: 'ground', at: m.preview.to, rot: g.rot, mirror: false, refused: true, pins: [] };
      }
    }
    if (targets) out.targets = targets;
    if (wireHover && 'end' in wireHover) out.target = wireHover.at;
    if (wireDraft) {
      // No way there: the straight legs to the pointer in red pen, so the student sees where it fails (not nothing).
      const last = wireDraft.corners[wireDraft.corners.length - 1] ?? wireDraft.start.at;
      const to = wireHover ? ('end' in wireHover ? wireHover.at : wireHover) : undefined;
      const tried = to ? [wireDraft.start.at, ...wireDraft.corners, { x: to.x, y: last.y }, to] : [wireDraft.start.at];
      out.wire = { points: wirePath ?? tried, node: wireDraft.start.node, start: wireDraft.start.at, corners: wireDraft.corners, refused: !!wireHover && !wirePath };
    }
    if (selectedWire) {
      const w = schematic.scene.wires[selectedWire.wire];
      const seg = w ? segmentsOf(w.points)[selectedWire.segment] : undefined;
      if (w && seg) out.piece = { from: selectedWire.piece?.from ?? seg[0], to: selectedWire.piece?.to ?? seg[1], node: w.node };
    }
    return out.ghost || out.targets || out.wire || out.piece || out.target ? out : undefined;
  })();

  /** The part in hand, a wire on its way, a part picked up: their buttons (Turn, Mirror, Place, Cancel), for a pointer without keys. */
  // A piece of wire selected: its Delete button (a phone has no Delete key; a mouse needs no key).
  const pieceSelected = !!selectedWire && tool === 'select' && !move && !card && !nodeCard;
  const handBar =
    !tooBig && (hand || wireDraft || move?.how === 'pick' || pieceSelected) ? (
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a few buttons, not a form
      <div
        ref={handRef}
        className={`hand-bar${phone ? ' hand-bar--phone' : ''}`}
        role="toolbar"
        aria-label={hand ? t('handLabel', { part: hand.kind === 'ground' ? t('toolGround') : kindName(hand.kind) }) : move ? t('editMove') : wireDraft ? t('wireLabel') : t('pieceLabel')}
        // On a phone just above the stack along the bottom, which leaves it room (stackMax), and never under the top bar.
        style={phone ? { bottom: Math.max(0, Math.min(insets.bottom + 6, vh - topRect.bottom - handRect.height - 6)) } : { bottom: (bottomRect.height ? vh - bottomRect.top : 0) + 10, left: area.x0, right: vw - area.x1 }}
      >
        {hand ? (
          <>
            <span className="hand-bar__what">
              <ToolGlyph kind={hand.kind} />
              <span className={phone ? 'visually-hidden' : undefined}>{hand.kind === 'ground' ? t('toolGround') : kindName(hand.kind)}</span>
            </span>
            <button type="button" className="card-action" aria-keyshortcuts="T" onClick={() => turnPart('turn')}>
              <LineIcon name="turn" />
              <span className="card-action__word">{t('handTurn')}</span>
            </button>
            {hand.kind !== 'ground' ? (
              <button type="button" className="card-action" aria-keyshortcuts="M" onClick={() => turnPart('mirror')}>
                <LineIcon name="mirror" />
                <span className="card-action__word">{t('handMirror')}</span>
              </button>
            ) : null}
            {phone ? (
              <button type="button" className="button button--primary hand-bar__place" disabled={!placeView?.ok || !lookAt} onClick={() => lookAt && placeHere(lookAt, false)}>
                <LineIcon name="place" />
                {t('place')}
              </button>
            ) : null}
            <button type="button" className="card-action" onClick={() => chooseTool('select')} aria-label={t('cancel')}>
              <LineIcon name="close" />
              {phone ? null : <span className="card-action__word">{t('cancel')}</span>}
            </button>
          </>
        ) : null}
        {wireDraft ? (
          <button
            type="button"
            className="card-action"
            onClick={() => {
              setWireDraft(undefined);
              setRefusal(undefined);
              announce(t('wireCancelled'));
            }}
          >
            <LineIcon name="close" />
            <span className="card-action__word">{t('cancelWire')}</span>
          </button>
        ) : null}
        {pieceSelected && !hand && !wireDraft && !move ? (
          <button type="button" className="card-action" aria-keyshortcuts="Delete" onClick={() => deleteNow()}>
            <LineIcon name="delete" />
            <span className="card-action__word">{t('paletteDeleteWire')}</span>
          </button>
        ) : null}
        {move?.how === 'pick' ? (
          <>
            <button type="button" className="button button--primary hand-bar__place" onClick={() => dropMove()}>
              <LineIcon name="place" />
              {t('place')}
            </button>
            <button type="button" className="card-action" onClick={() => cancelMove()}>
              <LineIcon name="close" />
              <span className="card-action__word">{t('cancel')}</span>
            </button>
          </>
        ) : null}
      </div>
    ) : null;

  /** Why Shift+arrow keys or Enter do nothing to the piece of wire selected (they would act on its node), and what they do once it is let go. */
  const pieceWhy = (what: 'move' | 'card'): string => {
    const s = currentDrawing();
    const node = (selectedWire && s?.scene.wires[selectedWire.wire]?.node) ?? GROUND;
    if (!s) return t('pieceNoMoveAlone');
    if (what === 'card') return t('pieceNoCard', { node: nodeSaid(s, node) });
    const g = grabOf(s, { kind: 'node', name: node });
    return g ? t('pieceNoMove', { what: g.kind === 'ground' ? t('theGround') : t('labelName', { node: nodeSaid(s, node) }) }) : t('pieceNoMoveAlone');
  };

  /** Enter (or a click without a pointer) on an item: its card; with a part in hand, the Add a part form; with the Wire tool, a wire's end at a node. */
  const onOpen = (item: NavItem): void => {
    if (tool === 'wire') {
      const s = currentDrawing();
      if (!s) return;
      if (item.kind !== 'node') return refuse(t('wireOnNode'));
      wireAt(nodeEnd(s, item.name, wireDraft?.start.at), undefined);
      return;
    }
    if (hand) {
      if (hand.kind === 'ground') return refuse(t('groundByKeys'));
      openAddForm(hand.kind, item.kind === 'node' ? item.name : undefined);
      return;
    }
    if (move?.how === 'pick') return dropMove();
    // A piece of wire selected (its node has the focus for the keys): Enter finds no card for it, and says
    // so. A click on its node's name chose the node (onSelect let go of the piece): the node's card opens.
    if (selectedWire && lastInput.current === 'key' && item.kind === 'node' && selected?.kind === 'node' && selected.name === item.name) return refuse(pieceWhy('card'));
    if (item.kind === 'part') openCard(item.key);
    else openNodeCard(item.name);
  };

  // The canvas's side: what a press, a drag, a tap, the pointer over the paper and a double click mean now.
  editingRef.current = {
    hover: (info) => {
      // The pointer is in use: the hint gives the pointer's way again (a tool chosen by its key gave the keys' way).
      if (info && toolByKey) setToolByKey(false);
      // A refusal (or an edit's note) has been read (it was said aloud too): the pointer moving on brings back what can be done now.
      // (A note that must be read stays for its reading time, whatever the pointer does: hint-note.ts.)
      if ((refusal || (noteLine && !noteLine.read)) && info && performance.now() - refusedAt.current > REFUSAL_READ_MS && !hand && tool !== 'wire') {
        setRefusal(undefined);
        if (!noteLine?.read) setNoteLine(undefined);
      }
      const q = info ? quarter(info.at) : undefined;
      hoverNow.current = q;
      setHover((h) => ((h && q && h.x === q.x && h.y === q.y) || (!h && !q) ? h : q));
      const m = moveRef.current;
      const s = m?.how === 'pick' && info ? currentDrawing() : undefined;
      if (m && s && info) moveTo(dragTarget(s, m.grab, info.at, m.offset));
    },
    press: (info) => {
      if (tooBig || !schematic) return undefined;
      if (moveRef.current?.how === 'pick' || tool !== 'select') return 'tap';
      // The turned view is another drawing: it pans; its parts open their cards.
      if (!asDrawn) return undefined;
      if (info.item) return grabOf(schematic, info.item) ? 'drag' : undefined;
      const hit = hitTest(schematic, info.at, nearness(info.unit), 'select');
      if (!hit) return undefined;
      return hit.kind === 'wire' ? 'tap' : 'drag-tap';
    },
    dragStart: (info) => {
      const s = currentDrawing();
      if (!s) return;
      const hit = info.item ?? hitTest(s, info.at, nearness(info.unit), 'select');
      const ground = hit?.kind === 'node' && hit.name === GROUND ? (hitTest(s, info.at, nearness(info.unit), 'select') as { kind: string; ground?: number } | undefined) : undefined;
      const g = hit ? grabOf(s, hit, ground?.kind === 'ground' ? ground.ground : undefined) : undefined;
      if (g) startMove(g, 'drag', info.at);
    },
    dragMove: (info) => {
      const m = moveRef.current;
      const s = currentDrawing();
      if (m && s) moveTo(dragTarget(s, m.grab, info.at, m.offset));
    },
    dragEnd: (info, cancelled) => {
      const m = moveRef.current;
      if (!m) return;
      if (cancelled) return cancelMove();
      const s = currentDrawing();
      if (info && s) moveWanted.current = dragTarget(s, m.grab, info.at, m.offset);
      dropMove();
    },
    tap: (info) => {
      const s = currentDrawing();
      if (!s) return;
      const m = moveRef.current;
      if (m?.how === 'pick') {
        moveWanted.current = dragTarget(s, m.grab, info.at, m.offset);
        dropMove();
        return;
      }
      if (hand) {
        const at = gridPoint(info.at);
        // A touch has no pointer to follow: the first tap shows where it would go, Place (or a second tap there) places it.
        if (info.pointer === 'touch' && !(lookAt && samePoint(lookAt, at))) {
          setLookAt(at);
          setRefusal(undefined);
          return;
        }
        placeHere(at, info.shift);
        return;
      }
      if (tool === 'wire') {
        const tol = nearness(info.unit) * (info.pointer === 'touch' ? 1.6 : 1);
        // A click on a part's symbol (or a ground symbol) means that part: its nearer pin, never a corner inside it.
        const clicked = wireStartOf(hitTest(s, info.at, tol, 'wire')) ?? symbolEnd(s, info.at, tol);
        // The end the preview showed, when the click is on the same part's symbol: at its middle the two pins
        // are equally near, and the pointer's last move (not the press, a fraction of a square away) chose.
        // Found from where the pointer last moved, not from the preview the page last drew: a render that
        // had not come yet (a busy machine, a quick move from one end of a part to its other end and a
        // click) started the wire at the end the pointer had left, the hint offering to join two nodes.
        const last = hoverNow.current;
        const near = !!last && Math.hypot(last.x - info.at.x, last.y - info.at.y) <= 1;
        const shown = near ? (wireStartOf(hitTest(s, last, nearness(info.unit), 'wire')) ?? symbolEnd(s, last, nearness(info.unit))) : undefined;
        const same = !!clicked && !!shown && 'part' in clicked.end && 'part' in shown.end && clicked.end.part === shown.end.part;
        wireAt(same ? shown : clicked, info.at);
        return;
      }
      // Select: what has no button of its own (a part's words, a second ground symbol, a piece of wire).
      const hit = hitTest(s, info.at, nearness(info.unit), 'select');
      if (hit?.kind === 'wire') {
        setCard(undefined);
        setNodeCard(undefined);
        setRefusal(undefined);
        const node: NavItem | undefined = hit.node !== undefined ? { kind: 'node', name: hit.node } : undefined;
        setSelected(node);
        setSelectedWire({ wire: hit.wire, segment: hit.segment, piece: hit.piece });
        // The keys (Delete) work from the drawing: the focus goes to the wire's node.
        if (node) requestAnimationFrame(() => canvas.current?.focusItem(node));
      } else if (hit?.kind === 'part') openCard(hit.key);
      else if (hit?.kind === 'ground') {
        setSelectedGround(hit.ground);
        openNodeCard(GROUND, true, hit.ground);
      } else if (hit?.kind === 'label') openNodeCard(hit.node);
    },
    doubleClick: (info) => {
      if (tool !== 'select' || !schematic || moveRef.current) return;
      const hit = info.item?.kind === 'part' ? info.item : hitTest(schematic, info.at, nearness(info.unit), 'select');
      if (hit?.kind === 'part') openCard(hit.key, true, true);
    },
  };

  /** What an editing key does here: true when it did something. Single keys work only while the drawing (or, for the part in hand, the toolbar) has the focus (WCAG 2.1.4). */
  const runEditKey = (k: EditKey, onDrawing: boolean): boolean => {
    switch (k.kind) {
      case 'tool':
        chooseTool(k.tool);
        return true;
      case 'turn':
      case 'mirror':
      case 'reverse':
        if (hand || move || (onDrawing && selected?.kind === 'part' && !selectedWire)) {
          turnPart(k.kind);
          return true;
        }
        // On a node, the ground symbol or a piece of wire, or nothing selected: say why nothing happens.
        if (onDrawing) {
          refuse(t(selected ? 'turnOnlyParts' : 'turnPartFirst'));
          return true;
        }
        return false;
      case 'move':
        if (!onDrawing || !selected || move) return false;
        // A piece of wire selected: Shift+arrow keys would move its node's name (or the ground symbol), which the hint does not say.
        if (selectedWire) {
          refuse(pieceWhy('move'));
          return true;
        }
        stepSelected(k.dir);
        return true;
      case 'delete':
        if (!onDrawing) return false;
        if (!selected && !selectedWire) {
          refuse(t('deleteNothing'));
          return true;
        }
        if (selected?.kind === 'node' && selected.name !== GROUND && !selectedWire) {
          refuse(t('deleteNodeWhy'));
          return true;
        }
        if (move) {
          const s = currentDrawing();
          // "Put the ground symbol down first", "The ground symbol can’t go here": a capital only where the name starts the sentence.
          const name = s ? grabName(s, move.grab) : '';
          if (s) refuse(canGoNow(moveRef.current ?? move, s) ? t('deleteWhileMoving', { name }) : t('deleteWhileRefused', { name: cap(name) }));
          return true;
        }
        deleteNow();
        return true;
      case 'add':
        openAddForm();
        return true;
    }
  };

  // The page's keys (the one listener above calls this).
  onKeyRef.current = (e: KeyboardEvent): void => {
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
    if (paletteOpen) {
      // Escape closes Ctrl+K wherever the focus is, as its Esc badge says (its field handles its own
      // keys first; the focus may have left the field for the page itself: final reviews, a11y A1).
      if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
      }
      return;
    }
    if (inOverlay) return;
    if (e.key === 'Escape') {
      // What is in progress stops first, then the tool goes back to Select, as the hint line says.
      let acted = true;
      /** This Escape let go of the selection, or had nothing left to stop (in the netlist editor, Escape is the editor's). */
      let letGo = false;
      if (move) cancelMove();
      else if (wireDraft) {
        setWireDraft(undefined);
        announce(t('wireCancelled'));
      } else if (partsSheet) setPartsSheet(false);
      else if (moreSheet) setMoreSheet(false);
      else if (card) closeCard();
      else if (nodeCard) closeNodeCard();
      else if (tool !== 'select') chooseTool('select');
      else if (panel && !inEditor) setPanel(undefined);
      else {
        letGo = !inEditor;
        if (selectedWire && !inEditor) setSelectedWire(undefined);
        else if (selected && !inEditor) setSelected(undefined);
        // Nothing left to stop or let go of: on the drawing, its own Esc may have let go of the selection
        // already (in a browser, React draws that before this listener runs).
        else acted = false;
      }
      // The next thing has happened: the hint line says again what can be done now, not an older refusal
      // or an edit's note (they were said aloud when they came). A note that must be read goes only with
      // the Escape that lets go (the student is done): one that closes or stops something leaves it, as
      // that thing's own button does (closing the new part's card brings a phone's hint line, and the
      // note, back into view; going back to Select is what the hint line offers after a Shift+click).
      setRefusal(undefined);
      if (letGo || !noteLine?.read) setNoteLine(undefined);
      if (acted) e.preventDefault();
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
    // A card's buttons: T, M, Shift+R and Delete act on its part, as its buttons say (and Delete on a
    // ground symbol's card deletes the symbol); no other single key does anything there, so a letter
    // never switches the tool under the card (WCAG 2.1.4).
    const onCard = target?.closest('.index-card');
    if (onCard) {
      const k = editKey(e);
      if (!k || (k.kind !== 'turn' && k.kind !== 'mirror' && k.kind !== 'reverse' && k.kind !== 'delete')) return;
      // Only the Delete key deletes from a card (its button says Del): Backspace there is too easily pressed, and says so.
      if (k.kind === 'delete' && e.key !== 'Delete') {
        if (card) {
          e.preventDefault();
          refuse(t('deleteWithDeleteKey', { name: schematic?.circuit.parts.find((x) => x.key === card.key)?.name ?? card.key }));
        }
        return;
      }
      e.preventDefault();
      if (card && k.kind === 'delete') deleteNow({ part: card.key });
      else if (card && k.kind !== 'delete') turnPart(k.kind, card.key);
      else if (nodeCard?.node === GROUND && k.kind === 'delete' && schematic?.drawing.grounds.length) deleteNow({ ground: Math.min(nodeCard.ground ?? 0, schematic.drawing.grounds.length - 1) });
      // A node's card (or ground's): a node is not deleted by itself, and only a part turns.
      else refuse(k.kind === 'delete' ? t('deleteNodeWhy') : t('turnOnlyParts'));
      return;
    }
    // The drawing: its parts' and nodes' buttons, or the paper itself (a click on a piece of wire or on
    // empty paper gives the paper the focus).
    const onDrawing = !!target?.closest('.nb-hits') || !!target?.classList.contains('nb-canvas');
    // A part picked up (the card's Move): the arrow keys move it, Enter puts it down (from the drawing,
    // or from nowhere while the focus is on its way there).
    const lost = !target || target === document.body || !target.isConnected;
    const picked = moveRef.current;
    if (picked?.how === 'pick' && (onDrawing || lost)) {
      const dir = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[e.key as 'ArrowUp'];
      if (dir) {
        e.preventDefault();
        const from = moveWanted.current ?? picked.preview?.to;
        const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
        moveReveal.current = true;
        if (from) moveTo({ x: from.x + v[0]!, y: from.y + v[1]! });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        dropMove();
        return;
      }
    }
    // Single keys work while the drawing or the toolbar has the focus (WCAG 2.1.4), not in what is
    // shown over the paper (a card, a notice).
    if (!target?.closest('.nb-canvas, .tools, .empty-card') || target.closest('.nb-anchored')) return;
    if (e.key === '+' || e.key === '=') canvas.current?.zoomBy(1.2);
    else if (e.key === '-') canvas.current?.zoomBy(1 / 1.2);
    else if (e.key === '!') fit();
    else {
      const k = editKey(e);
      if (!k || !runEditKey(k, onDrawing)) return;
    }
    e.preventDefault();
  };

  // A node just renamed: its card goes over to the new name once the drawing has it.
  useEffect(() => {
    if (!nodeCard?.renamed || !schematic || !schematic.circuit.nodes.has(nodeCard.renamed)) return;
    const { renamed, ...rest } = nodeCard;
    setNodeCard({ ...rest, node: renamed });
  }, [nodeCard, schematic]);

  // The text changed while something is being moved (typed in the Netlist panel, a fix): the preview
  // is made again from the text as it is, or the move ends when what it moves is gone.
  useEffect(() => {
    const m = moveRef.current;
    if (!m || !schematic || schematic.netlist.text !== store.get() || m.preview?.base === schematic.netlist.text) return;
    if (!grabAt(schematic, m.grab)) {
      moveRef.current = undefined;
      setMove(undefined);
      return;
    }
    moveTo(moveWanted.current ?? m.preview?.to ?? grabAt(schematic, m.grab)!);
    // Only when the drawing changes under a move.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [schematic]);

  // The focus rule: after an edit, an undo or a redo, a closed palette or a new circuit, once the
  // drawing has caught up, the focus is somewhere: where it was if that is still there, else the
  // selected item, else the drawing's first item, else (a blank page) the blank page's Add a part.
  useEffect(() => {
    if (!focusCheck.current || (schematic && schematic.netlist.text !== store.get())) return;
    focusCheck.current = false;
    const s = schematic;
    const item = s && selected && (selected.kind === 'part' ? s.scene.parts.some((p) => p.key === selected.key) : selected.name === GROUND ? s.scene.grounds.length > 0 : s.circuit.nodes.has(selected.name)) ? selected : s ? readingOrder(s)[0] : undefined;
    // A dialog closing may still be on the page for a few frames (and gives the focus back as it goes).
    let tries = 0;
    const look = (): void => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      if (document.querySelector('.modal-overlay, .popover, .palette')) {
        if (tries++ < 30) requestAnimationFrame(look);
        return;
      }
      if (item) canvas.current?.focusItem(item);
      else document.querySelector<HTMLElement>('.empty-card .button--primary')?.focus({ preventScroll: true });
    };
    requestAnimationFrame(look);
  });

  // After an edit, once the drawing has caught up: the item it made or moved, with its words, is in
  // view (panned just enough, clear of the bars over the paper).
  useEffect(() => {
    const item = pendingReveal.current;
    if (!item || !schematic || schematic.netlist.text !== store.get()) return;
    pendingReveal.current = undefined;
    const sc = schematic.scene;
    const box =
      item.kind === 'part'
        ? (() => {
            const p = sc.parts.find((x) => x.key === item.key);
            // The part, its words, and the names of the nodes on its pins (what the student reads with it).
            const names = p ? sc.nodeLabels.filter((l) => p.pins.some((q) => q.node === l.node)).map((l) => l.box) : [];
            return p ? unionBoxes([p.box, p.labelBox, ...names]) : undefined;
          })()
        : item.name === GROUND
          ? sc.grounds[0]?.box
          : sc.nodeLabels.find((l) => l.node === item.name)?.box;
    if (box) requestAnimationFrame(() => canvas.current?.reveal(box, handRect.height ? handRect.height + 12 : 0));
    // Only when the drawing changes after an edit.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [schematic]);

  // After an edit, once the drawing has caught up: the focus goes to the item it named (a card opens on a part just placed).
  useEffect(() => {
    const want = pendingFocus.current;
    if (!want || !schematic || schematic.netlist.text !== store.get()) return;
    pendingFocus.current = undefined;
    const item = want.item;
    const there = item.kind === 'part' ? schematic.scene.parts.some((p) => p.key === item.key) : item.name === GROUND ? schematic.scene.grounds.length > 0 : schematic.circuit.nodes.has(item.name);
    if (!there) {
      const first = readingOrder(schematic)[0];
      setSelected(first);
      if (first) requestAnimationFrame(() => canvas.current?.focusItem(first));
      return;
    }
    if (want.open && item.kind === 'part') openCard(item.key, true, want.open === 'value');
    else requestAnimationFrame(() => canvas.current?.focusItem(item));
  }, [schematic, store, openCard]);

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
            drawing={drawingWarnings}
            unchosen={unchosenNow}
            onOpenCard={(key) => {
              // On a phone the panel is a sheet over the drawing: the card's sheet takes its place.
              if (phone) setPanel(undefined);
              setSelected({ kind: 'part', key });
              openCard(key, true, true);
            }}
            partOfLine={(line) => schematic?.circuit.parts.find((p) => p.line + 1 === line)?.name}
            onGoToLine={(trap) => goToLine(trap.line)}
            onGoToDrawingLine={(line) => {
              // A drawing line is folded away in the Netlist panel: shown, at that line.
              setFolded(false);
              goToLine(line);
            }}
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
      <PanelHead id={panel} {...(panel === 'checks' && checkCount ? { sub: checksSub(checkCount)! } : {})} onClose={() => setPanel(undefined)} headingRef={panelHeading} />
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
        <PartsSheetList
          tool={tool}
          onPick={chooseTool}
          onAdd={() => {
            setPartsSheet(false);
            openAddForm();
          }}
        />
      </div>
    </section>
  );

  const zoomPercent = viewInfo ? Math.round((viewInfo.unit / 20) * 100) : undefined;
  // A phone whose drawing was moved partly off the screen (not by a sheet, which covers it for a while):
  // the way back to all of it (Fit, under More) at hand on the status line. Not in a very short window (a
  // laptop at 400 %), where a calm status is a dot in the margin and a pill with this button sat over the
  // strip of drawing there is, whatever moved it (a key, a drag, a zoom): More keeps it there (AP-1).
  const wholeOnLine = phone && !shorter && !phoneSheet && !!viewInfo?.moved && !viewInfo.whole;
  // Pressed with the keys, the button goes with the move it undoes: the focus goes on to the drawing's
  // Tab stop, not to the page (WCAG 2.4.3), once the button has gone.
  const focusAfterWhole = useRef(false);
  const wholeFromLine = useCallback(
    (byKeys: boolean) => {
      focusAfterWhole.current = byKeys;
      fit();
    },
    [fit],
  );
  useLayoutEffect(() => {
    if (wholeOnLine || !focusAfterWhole.current) return;
    focusAfterWhole.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) document.querySelector<HTMLElement>('.nb-hit[tabindex="0"]')?.focus({ preventScroll: true });
  }, [wholeOnLine]);
  const lines = (
    <StatusLines
      hint={hint}
      status={status}
      analysis={analysis}
      phone={phone}
      {...(!phone ? { zoom: { percent: zoomPercent, onIn: () => canvas.current?.zoomBy(1.2), onOut: () => canvas.current?.zoomBy(1 / 1.2), onFit: fit } } : {})}
      // (On a phone the lines' buttons only while the lines are in sight: behind a sheet that needs their
      // room they keep their words for screen readers, and no Tab stop nobody can see.)
      {...(phone && turned && !linesAside ? { turn: { turned: turnWanted, video, onToggle: toggleTurn } } : {})}
      // A finger edit on a phone: Undo at hand (a part is one long press from moving), not two taps away under More.
      {...(phone && !linesAside && snap.canUndo && snap.last.source === 'drawing' ? { undo } : {})}
      // A phone whose drawing was moved partly off the screen: the way back to all of it at hand (wholeOnLine).
      {...(wholeOnLine ? { whole: wholeFromLine } : {})}
      // The first screen on a phone: the sticky note's button, on the hint line (not while the hint is out of sight).
      {...(phone && !hintAside && noteWanted && firstScreenInvite && !card ? { invite: { label: t('noteButton', { name: firstScreenInvite.name }), onClick: () => openCard(firstScreenInvite.key) } } : {})}
      // On a phone the hint gives way first when the stack is short of room, and scrolls: the status stays whole.
      {...(phone ? { hintRef: hintBoxRef, hintScrolls: hintSqueezed && !hintAside } : {})}
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
    <div
      className={`app nb-theme${phone ? ' is-phone' : ' is-desktop'}${short ? ' is-short' : ''}${shorter ? ' is-shorter' : ''}${plain ? ' nb-plain' : ''}${strip ? ' is-editing' : ''}${phone && typingNetlist ? ' is-typing-netlist' : ''}`}
      data-tool={tool}
    >
      <a
        className="skip-link"
        href="#drawing"
        // Behind Ctrl+K like the rest of the page: never reached from the dialog (WCAG 2.4.3).
        inert={inert}
        onClick={(e) => {
          e.preventDefault();
          const link = e.currentTarget;
          if (selected) canvas.current?.focusItem(selected);
          // The selection may be of a drawing that is gone (a new circuit): then the drawing's first item, or the blank page's Add a part.
          if (document.activeElement === link || !selected) (document.querySelector<HTMLElement>('.nb-hit[tabindex="0"]') ?? document.querySelector<HTMLElement>('.empty-card .button--primary'))?.focus();
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
          <PartsToolbar tool={tool} onTool={chooseTool} onAdd={() => openAddForm()} />
        </nav>
      ) : null}

      <main id="drawing" className="paper" inert={inert} aria-labelledby={drawingNameId}>
        <h2 className="visually-hidden" id={drawingNameId}>
          {t('drawingHeading')}
        </h2>
        {empty && tool === 'select' && !move ? (
          // Nothing drawn yet: where to start, on the paper itself (out of the way once a tool is chosen).
          <section className="empty-card" aria-labelledby="empty-title" style={{ left: area.x0, top: area.y0, right: vw - area.x1, bottom: vh - area.y1 }}>
            <div className="empty-card__body">
              <h2 className="empty-card__title" id="empty-title">
                {t('emptyTitle')}
              </h2>
              <p>{phone ? t('emptyTextPhone') : t('emptyText')}</p>
              <p className="empty-card__actions">
                <button type="button" className="button button--primary" onClick={() => openAddForm()}>
                  <LineIcon name="add" />
                  {t('emptyAdd')}
                </button>
                <button type="button" className="button" onClick={() => openPanel('netlist')}>
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
            // In pencil, and "Before your last change:" for screen readers, only over numbers the drawing shows (as the status line).
            pending={((!!record && !current) || !!stale) && marksShown}
            {...(stale ? { pendingWords: t('staleBefore') } : {})}
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
            onOpen={(item) => onOpen(item)}
            onEscape={() => {
              // The page's own Escape (in the keys above) handles a move, a wire, a tool, a card, and a
              // piece of wire (let go of first: its node stays selected, as the piece's words say); it also
              // clears an older refusal from the hint line, after this has let go of the selection.
              if (move || wireDraft || tool !== 'select' || card || nodeCard || selectedWire) return;
              setSelected(undefined);
            }}
            editing={schematic && !tooBig ? canvasEditing : undefined}
            marks={marks}
            mode={move ? 'move' : tool === 'select' ? 'select' : tool === 'wire' ? 'wire' : 'place'}
            arrowsTaken={move?.how === 'pick'}
            quietSelection={!!selectedWire}
            keysHelp={t('drawingKeys')}
            roleDescription={t('drawingRole')}
            insets={insets}
            // A computer keeps its fit when a card opens; a phone fits again above the card's sheet,
            // and again above the strip while a value is typed.
            fitKey={`${circuitKey}:${fitCount}:${phone ? 'phone' : 'desk'}:${seen === turned ? 'turned' : 'as-drawn'}:${phone && card ? `card:${card.key}` : ''}:${phone && nodeCard ? `node:${nodeCard.node}` : ''}:${strip ? 'edit' : ''}`}
            minUnit={minUnit}
            maxUnit={maxUnit}
            padding={phone ? 10 : 24}
            // Whole, smaller than readable if it must be: a phone shown as drawn while editing (it was
            // turned to fit), so no part is off the screen where the student was looking (two fingers
            // zoom in); or the reader asked for it ("Show the whole drawing") in the view shown now. On
            // a phone not while a sheet is open: the paper left above it would make the drawing a stamp
            // (a card fits its part; More closes to show it); the whole fit comes when the sheet goes.
            // Otherwise a drawing that does not fit (as drawn on a phone) opens at the smallest readable
            // size, from its left end: as much of it as can be read at once.
            fitWhole={editingWhole || (wholeAt?.count === fitCount && wholeAt.turned === viewTurned && !(phone && phoneSheet))}
            focus={cardFocus}
            frame={frame}
            offset={offset}
            hold={!!card || !!nodeCard || typingNetlist || !!move || tool !== 'select'}
            onView={setViewInfo}
            overlay={overlayOnPaper}
          />
        ) : (
          <div className="too-big">
            <p>{tn('tooBig', partCount)}</p>
          </div>
        )}
        <div className="margin-line" aria-hidden="true" />
        {handBar}
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
        <div
          className={`phone-bottom${strip ? ' is-strip' : ''}`}
          ref={bottomRef}
          inert={inert}
          style={{ ...(keyboard ? { bottom: keyboard } : {}), ...(stackMax !== undefined ? { maxHeight: stackMax } : {}) }}
        >
          {phoneSheet === 'card' ? null : (
            // The hint gives way first and scrolls (StatusLines); should even the status be taller than
            // the room left, the lines scroll as a whole: then they are a named region a finger can scroll
            // and the keys can reach (WCAG 2.1.1), as a table too wide for the screen is. Above a sheet that
            // needs their room, the hint out of sight and the status kept whole (hintAside, linesMax), or
            // all of them out of sight (linesAside).
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            <footer
              className={`phone-lines${hintAside ? ' is-hint-aside' : ''}${linesCut ? ' is-squeezed' : ''}${linesAside ? ' is-aside' : ''}${linesHeld !== undefined ? ' is-held' : ''}`}
              ref={linesBoxRef}
              style={linesMax !== undefined || linesHeld !== undefined ? { ...(linesMax !== undefined ? { maxHeight: linesMax } : {}), ...(linesHeld !== undefined ? { minHeight: linesHeld } : {}) } : undefined}
              {...(linesCut ? { tabIndex: 0, 'aria-label': t('linesLabel') } : {})}
            >
              {lines}
            </footer>
          )}
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
                // "Show the whole drawing" closes the sheet, as Export does, so all of the drawing shows at
                // once (in the strip of paper above the sheet it could only be a stamp). Zoom in and Zoom
                // out keep it open: their change shows above it.
                if (how === 'fit')
                  fromMore(() => {
                    setMoreSheet(false);
                    fit();
                  });
                else canvas.current?.zoomBy(how === 'in' ? 1.2 : 1 / 1.2);
              }}
              onClose={() => setMoreSheet(false)}
              sheetRef={sheetRef}
            />
          ) : null}
          {phoneSheet === 'card' && !card && nodeCardProps ? (
            <div className="sheet sheet--card" ref={sheetRef as (el: HTMLDivElement | null) => void}>
              <NodeCard {...nodeCardProps} variant="sheet" />
            </div>
          ) : null}
          {phoneSheet === 'card' && cardProps ? (
            <div className="sheet sheet--card" ref={sheetRef as (el: HTMLDivElement | null) => void}>
              <IndexCard
                {...cardProps}
                {...cardHandlers}
                edit={cardEditing}
                variant={strip ? 'strip' : 'sheet'}
                focusField={false}
                // The arrow keys on the drawing move the card along without taking the focus into it.
                takeFocus={card?.focus !== false}
                {...(card ? { session: card.session } : {})}
                onFieldFocus={() => setEditing(lastInput.current === 'pointer' ? 'touch' : 'keys')}
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
              barRef={barRef}
              partsRef={barParts}
              moreRef={barMore}
              tool={tool}
              partsOpen={partsSheet}
              panel={panel}
              moreOpen={moreSheet}
              checks={checkCount}
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
            <PanelTabs open={panel} checks={checkCount} onToggle={togglePanel} tabsRef={tabsRef} />
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
        addPart={addForm && schematic ? { schematic: currentDrawing() ?? schematic, start: addForm, onAdd: addFromForm } : undefined}
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
