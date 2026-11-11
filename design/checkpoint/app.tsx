/**
 * Tarık's checkpoint (decision 0014): the Notebook look on p02's dependent-source circuits, on a
 * computer and on a phone, before the rest of milestone 2 is built. The drawing is the real
 * NotebookCanvas (src/notebook) on the real schematic model (src/schematic), solved live by ngspice
 * in its Web Worker (src/engine); every number comes from those runs and every sentence about the
 * circuit from src/spice. Around it, Tarık's additions: the parts toolbar with names and its hint
 * line (from Playground), Ctrl+K and the status line (from Studio), the Handwriting / Plain font
 * setting, and the netlist with its *@ drawing block folded away.
 *
 * After the design review (critique 1 to 12): the card sits beside its part and never changes the
 * zoom; a phone has one bottom bar (Select · Parts · Netlist · Checks · Explain) and, while a value is
 * typed, one strip above the keyboard; node voltages read "s = 12 V"; traps and runs without an
 * answer are written on the paper in red pen; landmarks and the Tab order follow the screen.
 *
 * Screenshot states (scripts/checkpoint-shots.ts) come from the address, e.g.
 *   #shot&circuit=p02-3-dependent-only&select=F1&card=1   (also panel=netlist, font=plain, palette=1,
 *   value=0.3 to type into the card, edit=1 to put the focus in its field, parts=1, turn=0)
 * and the page sets document.body.dataset.shotReady = '1' once ngspice has answered for the circuit
 * as shown and the state is drawn.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { EngineClient } from '../../src/engine/client.ts';
import { formatNumber, formatSI } from '../../src/format/si.ts';
import {
  NotebookCanvas,
  acrossWords,
  answers,
  boxOnGrid,
  boxOnScreen,
  createResultFontStore,
  currentText,
  drawingLineIndexes,
  drawingRoom,
  inkBoxes,
  inviteArrow,
  isAmmeter,
  isWide,
  liveSolver,
  minUnitFor,
  nodeBox,
  nodeWord,
  notebookSchematic,
  partBox,
  placeBeside,
  placeCard,
  placeNote,
  placeResults,
  solve,
  turnedQuarter,
  wasMarks,
  withDrawingBlock,
  withoutResultsPointer,
  type CanvasHandle,
  type CanvasViewInfo,
  type CardPlacement,
  type DrawingResults,
  type Insets,
  type LiveSolver,
  type PenMarks,
  type PenNote,
  type ResultFont,
  type Solution,
} from '../../src/notebook/index.ts';
import { GROUND, applyChanges, applyEdit, describeNode, describePart, describeSchematic, inflate, unionBoxes, type Box, type CircuitPart, type NavItem, type PartLetter, type Schematic } from '../../src/schematic/index.ts';
import { elementInfo } from '../../src/spice/elements.ts';
import { explainLine, explainNetlist } from '../../src/spice/explain.ts';
import { lowerAscii } from '../../src/spice/parse.ts';
import type { Fix, LineExplanation, Netlist, Trap } from '../../src/spice/types.ts';
import { assignNodeColours } from '../../src/theme/nodes.ts';
import { IndexCard, type CardProps, type Readout } from './card.tsx';
import { CIRCUITS, CIRCUIT_IDS, circuitById, isCircuitId, type CheckpointCircuit, type CircuitId } from './circuits.ts';
import { Icon, Mark, ToolGlyph } from './icons.tsx';
import { CommandPalette, type Command } from './palette.tsx';
import { ChecksPanel, ExplainPanel, NetlistPanel, PANEL_TITLES, type ExplainPanelProps, type PanelId } from './panels.tsx';
import { SettingsDialog } from './settings.tsx';
import { PartsSheetList, PartsToolbar, isControlled, toolForKey, toolPhrase, type Tool } from './toolbar.tsx';

// ------------------------------------------------------------------ one engine and one setting per page

const engine = new EngineClient({ timeoutMs: 20_000 });
const runner = { run: (text: string) => engine.run(text) };
const fontStore = createResultFontStore();

const PANELS: readonly PanelId[] = ['netlist', 'checks', 'explain'];

/** Below this width the page uses the phone's layout (an iPad held upright included: critique 10). */
const PHONE_QUERY = '(max-width: 899px)';

/** The card on a computer: as wide and as tall as its tallest state, so it never moves as it grows. */
const CARD_W = 680;
const CARD_H = 204;

interface HashState {
  circuit?: CircuitId;
  select?: string;
  card?: boolean;
  panel?: PanelId;
  font?: ResultFont;
  palette?: boolean;
  /** A phone shows the drawing as drawn (not turned to fit). */
  asDrawn?: boolean;
  /** Type this into the open card once ngspice has answered (a screenshot of the numbers moving). */
  value?: string;
  /** Put the focus in the card's field (a phone's editing strip). */
  edit?: boolean;
  /** Open the phone's Parts sheet. */
  parts?: boolean;
  shot?: boolean;
}

function readHash(): HashState {
  const q = new URLSearchParams(location.hash.replace(/^#/, ''));
  const out: HashState = {};
  const c = q.get('circuit');
  if (isCircuitId(c)) out.circuit = c;
  const sel = q.get('select');
  if (sel) out.select = sel;
  if (q.get('card') === '1') out.card = true;
  const panel = q.get('panel');
  if (panel === 'netlist' || panel === 'checks' || panel === 'explain') out.panel = panel;
  const font = q.get('font');
  if (font === 'plain' || font === 'handwriting') out.font = font;
  if (q.get('palette') === '1') out.palette = true;
  if (q.get('turn') === '0') out.asDrawn = true;
  const value = q.get('value');
  if (value) out.value = value;
  if (q.get('edit') === '1') out.edit = true;
  if (q.get('parts') === '1') out.parts = true;
  if (q.has('shot')) out.shot = true;
  return out;
}

function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mq = matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}

/**
 * How much of the window an on-screen keyboard covers, in pixels (visualViewport: the part of the
 * page the reader can see). 0 with no keyboard, or where the browser shrinks the page for it.
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const update = (): void => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}

interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}
const NO_RECT: Rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
const sameRect = (a: Rect, b: Rect): boolean => Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

/** Where an element is on the screen, kept up to date (size changes and window resizes). */
function useRect<T extends HTMLElement>(): [(el: T | null) => void, Rect] {
  const [rect, setRect] = useState<Rect>(NO_RECT);
  const stop = useRef<(() => void) | undefined>(undefined);
  const ref = useCallback((el: T | null) => {
    stop.current?.();
    stop.current = undefined;
    if (!el) {
      setRect(NO_RECT);
      return;
    }
    const update = (): void => {
      const r = el.getBoundingClientRect();
      const next = { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      setRect((old) => (sameRect(old, next) ? old : next));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    stop.current = () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
  return [ref, rect];
}

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const isEditable = (part: CircuitPart): boolean => part.letter === 'R' || part.letter === 'V' || part.letter === 'I' || isControlled(part.letter);

/** The items a selected part is tied to: the source an F or H reads, the nodes an E or G reads. */
function relatedOf(part: CircuitPart | undefined): NavItem[] {
  const c = part?.control;
  if (!c) return [];
  if (c.kind === 'current') return c.source ? [{ kind: 'part', key: c.source }] : [];
  return [c.plus, c.minus].filter((n) => n && n !== GROUND).map((name) => ({ kind: 'node' as const, name }));
}

/** What a gain multiplies, for E, F, G and H ("× I(Vsense)", "A/V × V(n1)"): the drawing's control label. */
function controlSuffix(part: CircuitPart): string | undefined {
  const c = part.control;
  if (!c) return undefined;
  const unit = part.letter === 'G' ? 'A/V ' : part.letter === 'H' ? 'V/A ' : '';
  if (c.kind === 'current') return `${unit}× I(${c.sourceText || '?'})`;
  return `${unit}× V(${c.plusText || '?'}${c.minus === GROUND ? '' : `, ${c.minusText || '?'}`})`;
}

const UNIT_OF: Partial<Record<string, string>> = { R: 'Ω', C: 'F', L: 'H', V: 'V', I: 'A' };

/** What to type in a part's value field, with examples that fit it (critique 8: a gain is not "4.7k"). */
const TYPE_HINT: Readonly<Record<PartLetter, string>> = {
  R: 'Type a value, such as 3, 4.7k or 1meg',
  C: 'Type a value, such as 10u or 100n',
  L: 'Type a value, such as 1m or 10u',
  V: 'Type a voltage, such as 12 or 1.5',
  I: 'Type a current, such as 1 or 20m',
  E: 'Type a gain, such as 0.5 or 2',
  F: 'Type a gain, such as 0.5 or 2',
  G: 'Type amps per volt, such as 0.25 or 0.5',
  H: 'Type volts per amp, such as 2 or 1k',
};

type EngineState = { kind: 'loading' } | { kind: 'ready'; ms: number } | { kind: 'error'; message: string };

interface CardState {
  key: string;
  /** The value as written when the card opened (crossed out once it changes). */
  start: string;
  /** What the field shows (it may be empty while the student types). */
  input: string;
  /** The run the card opened on (its numbers are crossed out once they change). */
  before: Solution | undefined;
  /** The netlist when the card opened (for undo). */
  startText: string;
}

// ------------------------------------------------------------------ the page

export function Checkpoint(): ReactNode {
  const [initial] = useState(readHash);
  const phone = useMedia(PHONE_QUERY);
  const storedFont = useSyncExternalStore(fontStore.subscribe, fontStore.get);
  const [fontOverride, setFontOverride] = useState<ResultFont | undefined>(initial.font);
  const plain = (fontOverride ?? storedFont) === 'plain';

  const [circuitId, setCircuitId] = useState<CircuitId>(initial.circuit ?? 'p02-4-open');
  const [texts, setTexts] = useState(() => Object.fromEntries(CIRCUITS.map((c) => [c.id, withDrawingBlock(c.text)])) as Record<CircuitId, string>);
  // The address's selection (for the screenshots): the part it names, and its card.
  const [start] = useState(() => {
    const t = texts[initial.circuit ?? 'p02-4-open'];
    const wanted = initial.select ? lowerAscii(initial.select) : undefined;
    const part = wanted ? notebookSchematic(t).circuit.parts.find((x) => x.key === wanted) : undefined;
    return part ? { part, text: t } : undefined;
  });
  const [past, setPast] = useState<Record<CircuitId, string[]>>({ 'p02-4-open': [], 'p02-5-short': [], 'p02-3-dependent-only': [] });
  const [future, setFuture] = useState<Record<CircuitId, string[]>>({ 'p02-4-open': [], 'p02-5-short': [], 'p02-3-dependent-only': [] });
  const [solutions, setSolutions] = useState<Partial<Record<CircuitId, Solution>>>({});
  const [engineState, setEngineState] = useState<EngineState>({ kind: 'loading' });
  const [runError, setRunError] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<NavItem | undefined>(start ? { kind: 'part', key: start.part.key } : undefined);
  const [card, setCard] = useState<CardState | undefined>(
    start && initial.card ? { key: start.part.key, start: start.part.valueText, input: start.part.valueText, before: undefined, startText: start.text } : undefined,
  );
  const [panel, setPanel] = useState<PanelId | undefined>(initial.panel);
  const [selectedLine, setSelectedLine] = useState<number | undefined>(start ? start.part.line + 1 : undefined);
  const [unfolded, setUnfolded] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [paletteOpen, setPaletteOpen] = useState(!!initial.palette);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [partsSheet, setPartsSheet] = useState(!!initial.parts);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [noteHidden, setNoteHidden] = useState(!!initial.select || !!initial.panel || !!initial.palette || !!initial.parts);
  const [fitCount, setFitCount] = useState(0);
  const [viewInfo, setViewInfo] = useState<CanvasViewInfo | undefined>(undefined);
  const [announcement, setAnnouncement] = useState('');
  /** A phone: the card's value field has the focus (the editing strip shows above the keyboard). */
  const [editing, setEditing] = useState(false);
  const [valueTyped, setValueTyped] = useState(!initial.value);
  const keyboard = useKeyboardInset();
  const canvas = useRef<CanvasHandle>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const panelHeading = useRef<HTMLHeadingElement | null>(null);

  const circuit = circuitById(circuitId);
  const text = texts[circuitId];
  const schematic = useMemo(() => notebookSchematic(text), [text]);
  const netlist = schematic.netlist;
  // A phone held upright shows a wide drawing turned a quarter, so it fits whole at a size its words
  // can be read (src/notebook/turn.ts); the drawing in the netlist stays as it is.
  const portrait = useMedia('(orientation: portrait)');
  const [turnWanted, setTurnWanted] = useState(!initial.asDrawn);
  // How a narrow screen shows the drawing, decided when a circuit opens (or the phone turns), never as a
  // value is typed or a keyboard shrinks the window: the drawing must not change under the reader.
  // As drawn, whole, when its words are readable that way (a tablet); else turned a quarter when that
  // makes it larger (a phone held upright); else as drawn at a readable size, read from its left end.
  const phoneView = useMemo(() => {
    if (!phone) return { pans: false, turn: false };
    const w = window.innerWidth - 30;
    const h = window.innerHeight - 190;
    const unitOf = (b: Box): number => Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0));
    const asDrawn = unitOf(schematic.scene.bounds);
    const pans = asDrawn < minUnitFor();
    if (!(pans && portrait && isWide(schematic))) return { pans, turn: false };
    const t = turnedQuarter(schematic);
    return { pans, turn: !!t && unitOf(t.scene.bounds) > asDrawn * 1.15 };
    // The circuit, not its text as typed.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, portrait, circuitId]);
  const turned = useMemo(() => (phoneView.turn ? turnedQuarter(schematic) : undefined), [phoneView.turn, schematic]);
  const shown = turned && turnWanted ? turned : schematic;
  const asDrawnOnPhone = phone && shown === schematic;
  const sol = solutions[circuitId];
  /** ngspice has answered for the text as it is now. */
  const current = !!sol && sol.text === text;
  const results = useMemo(() => placeResults(shown.scene, answers(sol)), [shown, sol]);
  const explains = useMemo(() => explainNetlist(netlist), [netlist]);
  const colours = useMemo(() => assignNodeColours(netlist.nodes.keys()), [netlist]);
  const checks = current ? sol.checks : undefined;
  const describe = useMemo(() => describeSchematic(schematic), [schematic]);
  const drawingLines = useMemo(() => drawingLineIndexes(netlist), [netlist]);
  const selectedPart = selected?.kind === 'part' ? shown.scene.parts.find((p) => p.key === selected.key) : undefined;
  const related = useMemo(() => relatedOf(selectedPart?.part), [selectedPart]);
  /** Checks on part lines (not notes): each part's first, which its symbol shows in red pen. */
  const partTraps = useMemo(() => {
    const out = new Map<string, Trap>();
    for (const t of checks ?? []) {
      if (t.severity === 'info') continue;
      const p = schematic.circuit.parts.find((x) => x.line + 1 === t.line);
      if (p && !out.has(p.key)) out.set(p.key, t);
    }
    return out;
  }, [checks, schematic]);
  const traps = useMemo(() => new Set(partTraps.keys()), [partTraps]);

  // ---- ngspice: load it at once, then solve every text as it comes (a live solver per circuit:
  // runs never overlap, and only the newest waiting text is solved)
  useEffect(() => {
    engine.warmUp().then(
      (ms) => setEngineState({ kind: 'ready', ms }),
      (e: unknown) => setEngineState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
  }, []);
  const solvers = useRef(new Map<CircuitId, LiveSolver>());
  const solverFor = useCallback((id: CircuitId): LiveSolver => {
    let s = solvers.current.get(id);
    if (!s) {
      s = liveSolver(
        (t) => solve(t, runner),
        (result) => {
          setSolutions((old) => ({ ...old, [id]: result }));
          setRunError(undefined);
        },
        (error) => setRunError(error instanceof Error ? error.message : String(error)),
      );
      solvers.current.set(id, s);
    }
    return s;
  }, []);
  useEffect(() => {
    solverFor(circuitId).request(text);
  }, [circuitId, text, solverFor]);
  const runAgain = useCallback(() => {
    setSolutions((old) => {
      const { [circuitId]: _gone, ...rest } = old;
      return rest;
    });
    solverFor(circuitId).request(texts[circuitId]);
  }, [circuitId, texts, solverFor]);

  // ---- what a screen reader hears after a run (once typing pauses): the model's summary, without
  // its pointer to a results view this page does not have
  const sayTimer = useRef(0);
  const cardOpen = !!card;
  useEffect(() => {
    if (!sol || sol.text !== text) return undefined;
    window.clearTimeout(sayTimer.current);
    const said = sol.status === 'ok' ? withoutResultsPointer(sol.words.summarySpeech) : noNumbersReason(sol);
    sayTimer.current = window.setTimeout(() => setAnnouncement(said), cardOpen ? 900 : 150);
    return () => window.clearTimeout(sayTimer.current);
  }, [sol, text, cardOpen]);

  // ---- changing things
  const commit = useCallback((id: CircuitId, before: string, after: string) => {
    if (before === after) return;
    setPast((p) => ({ ...p, [id]: [...p[id], before].slice(-50) }));
    setFuture((f) => ({ ...f, [id]: [] }));
  }, []);
  const setText = useCallback((next: string) => setTexts((t) => ({ ...t, [circuitId]: next })), [circuitId]);

  const closeCard = useCallback(
    (focusPart = true) => {
      if (!card) return;
      commit(circuitId, card.startText, texts[circuitId]);
      const key = card.key;
      setCard(undefined);
      setEditing(false);
      if (focusPart) requestAnimationFrame(() => canvas.current?.focusItem({ kind: 'part', key }));
    },
    [card, circuitId, texts, commit],
  );

  const openCard = useCallback(
    (key: string) => {
      const p = schematic.circuit.parts.find((x) => x.key === key);
      if (!p) return;
      if (card && card.key !== key) commit(circuitId, card.startText, text);
      setSelected({ kind: 'part', key });
      setSelectedLine(p.line + 1);
      setCard({ key, start: p.valueText, input: p.valueText, before: current ? sol : undefined, startText: text });
      setNoteHidden(true);
      setPartsSheet(false);
      setSettingsOpen(false);
      setTool('select');
      if (phone) setPanel(undefined);
    },
    [schematic, card, circuitId, text, sol, current, commit, phone],
  );

  const onSelect = useCallback(
    (item: NavItem | undefined) => {
      setSelected(item);
      if (item?.kind === 'part') {
        const p = schematic.circuit.parts.find((x) => x.key === item.key);
        if (p) setSelectedLine(p.line + 1);
        if (card && card.key !== item.key) openCard(item.key);
      } else if (card) closeCard(false);
    },
    [schematic, card, openCard, closeCard],
  );

  const onOpen = useCallback(
    (item: NavItem) => {
      if (tool !== 'select') return;
      if (item.kind === 'part') openCard(item.key);
      else {
        setSelected(item);
        setPanel('explain');
        setNoteHidden(true);
      }
    },
    [openCard, tool],
  );

  const onValue = useCallback(
    (value: string): void => {
      if (!card) return;
      setCard({ ...card, input: value });
      if (!value.trim()) return;
      const r = applyEdit(schematic, { kind: 'set-value', part: card.key, value });
      if (r.ok) setText(r.text);
    },
    [card, schematic, setText],
  );

  const switchCircuit = useCallback(
    (id: CircuitId) => {
      if (card) commit(circuitId, card.startText, texts[circuitId]);
      setCard(undefined);
      setEditing(false);
      setSelected(undefined);
      setSelectedLine(undefined);
      setCircuitId(id);
      setFitCount((n) => n + 1);
      setSwitcherOpen(false);
      setAnnouncement(`${circuitById(id).name}.`);
    },
    [card, circuitId, texts, commit],
  );

  const applyFix = (fix: Fix): void => {
    const next = applyChanges(text, fix.changes);
    commit(circuitId, text, next);
    setText(next);
    if (card) setCard(undefined);
    setAnnouncement(`${fix.label}.`);
  };

  const undo = useCallback(() => {
    const prev = past[circuitId].at(-1);
    if (prev === undefined) return;
    setPast((p) => ({ ...p, [circuitId]: p[circuitId].slice(0, -1) }));
    setFuture((f) => ({ ...f, [circuitId]: [texts[circuitId], ...f[circuitId]] }));
    setText(prev);
    setCard(undefined);
    setAnnouncement('Undone.');
  }, [past, circuitId, texts, setText]);
  const redo = useCallback(() => {
    const next = future[circuitId][0];
    if (next === undefined) return;
    setFuture((f) => ({ ...f, [circuitId]: f[circuitId].slice(1) }));
    setPast((p) => ({ ...p, [circuitId]: [...p[circuitId], texts[circuitId]] }));
    setText(next);
    setCard(undefined);
    setAnnouncement('Redone.');
  }, [future, circuitId, texts, setText]);

  const togglePanel = useCallback(
    (id: PanelId) => {
      setPanel((p) => (p === id ? undefined : id));
      setNoteHidden(true);
      setSettingsOpen(false);
      if (phone) {
        setCard(undefined);
        setEditing(false);
        setPartsSheet(false);
      }
    },
    [phone],
  );
  // A panel that opens takes the focus to its heading.
  useEffect(() => {
    if (panel && !initial.shot) panelHeading.current?.focus({ preventScroll: true });
  }, [panel, initial.shot]);

  const chooseTool = useCallback((t: Tool) => {
    setTool(t);
    if (t !== 'select') {
      setCard(undefined);
      setEditing(false);
      setNoteHidden(true);
    }
    setPartsSheet(false);
  }, []);

  const fit = useCallback(() => {
    setFitCount((n) => n + 1);
    canvas.current?.fit();
  }, []);

  const setFont = useCallback((f: ResultFont) => {
    setFontOverride(undefined);
    fontStore.set(f);
    setAnnouncement(f === 'plain' ? 'Results are now written in the plain font.' : 'Results are now handwritten.');
  }, []);

  const openPalette = (): void => {
    lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPaletteOpen(true);
  };
  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    requestAnimationFrame(() => {
      if (lastFocus.current?.isConnected) lastFocus.current.focus({ preventScroll: true });
    });
  }, []);

  // ---- the keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!target?.closest('input, textarea, [contenteditable="true"]');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (paletteOpen) closePalette();
        else {
          lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setPaletteOpen(true);
        }
        return;
      }
      if (paletteOpen) return;
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        runAgain();
        return;
      }
      if (e.key === 'Escape') {
        if (settingsOpen) setSettingsOpen(false);
        else if (switcherOpen) setSwitcherOpen(false);
        else if (partsSheet) setPartsSheet(false);
        else if (card) closeCard();
        else if (panel) setPanel(undefined);
        else if (tool !== 'select') setTool('select');
        else if (selected) setSelected(undefined);
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
      if (mod || e.altKey) return;
      // Single keys work while the drawing or the toolbar has the focus (WCAG 2.1.4).
      if (!target?.closest('.nb-canvas, .ck-tools')) return;
      if (e.key === '+' || e.key === '=') canvas.current?.zoomBy(1.2);
      else if (e.key === '-') canvas.current?.zoomBy(1 / 1.2);
      else if (e.key === '!') fit();
      else {
        const t = e.key.length === 1 ? toolForKey(e.key) : undefined;
        if (!t) return;
        chooseTool(t);
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, settingsOpen, switcherOpen, partsSheet, card, panel, tool, selected, closeCard, closePalette, runAgain, undo, redo, chooseTool, fit]);

  // ---- Ctrl+K's commands (data while drawing; what each does is decided when it is chosen)
  const commands = useMemo((): Command[] => {
    const list: Command[] = [];
    // The circuit already open comes last in its group.
    for (const c of [...CIRCUITS].sort((a, b) => Number(a.id === circuitId) - Number(b.id === circuitId))) {
      list.push({ id: `open:${c.id}`, group: 'Circuits', label: `Open ${c.name}${c.id === circuitId ? ' (open now)' : ''}`, keywords: `${c.file} thevenin p02 circuit` });
    }
    for (const id of PANELS) {
      const t = PANEL_TITLES[id].title.toLowerCase();
      list.push({ id: `panel:${id}`, group: 'Panels', label: panel === id ? `Close the ${t} panel` : `Open the ${t} panel`, keywords: id });
    }
    list.push({ id: 'font', group: 'Settings', label: plain ? 'Write results by hand' : 'Write results in the plain font', keywords: 'handwriting plain font dyslexia caveat readable' });
    list.push({ id: 'settings', group: 'Settings', label: 'Open the settings', keywords: 'preferences font' });
    list.push({ id: 'fit', group: 'Drawing', label: 'Fit the drawing to the window', keywords: 'zoom screen whole', shortcut: 'Shift 1' });
    list.push({ id: 'run', group: 'Drawing', label: 'Run ngspice again', keywords: 'simulate solve', shortcut: 'Ctrl ↵' });
    if (past[circuitId].length) list.push({ id: 'undo', group: 'Drawing', label: 'Undo', shortcut: 'Ctrl Z' });
    if (future[circuitId].length) list.push({ id: 'redo', group: 'Drawing', label: 'Redo', shortcut: 'Ctrl Shift Z' });
    for (const p of schematic.scene.parts) {
      list.push({ id: `part:${p.key}`, group: 'Parts', label: `Change ${p.name}, ${elementInfo(p.letter)?.name ?? p.letter}`, keywords: `select open card ${p.letter}` });
    }
    return list;
  }, [circuitId, panel, plain, past, future, schematic]);

  const runCommand = (id: string): void => {
    const [kind, arg] = id.split(':') as [string, string | undefined];
    if (kind === 'open' && isCircuitId(arg)) switchCircuit(arg);
    else if (kind === 'panel' && (arg === 'netlist' || arg === 'checks' || arg === 'explain')) togglePanel(arg);
    else if (kind === 'part' && arg) openCard(arg);
    else if (kind === 'font') setFont(plain ? 'handwriting' : 'plain');
    else if (kind === 'settings') setSettingsOpen(true);
    else if (kind === 'fit') fit();
    else if (kind === 'run') runAgain();
    else if (kind === 'undo') undo();
    else if (kind === 'redo') redo();
  };

  // ---- what covers the paper, so the drawing fits in the rest (the card is not in it: critique 1)
  const [topRef, topRect] = useRect<HTMLElement>();
  const [toolsRef, toolsRect] = useRect<HTMLElement>();
  const [bottomRef, bottomRect] = useRect<HTMLElement>();
  const [tabsRef, tabsRect] = useRect<HTMLElement>();
  const [sheetRef, sheetRect] = useRect<HTMLElement>();
  const [noteRef, noteRect] = useRect<HTMLElement>();
  const [cardRef, cardRect] = useRect<HTMLDivElement>();
  // The sticky note invites on a computer; a phone's hint line says the same in the room it has.
  const noteShown = !phone && !noteHidden && tool === 'select' && !card && !panel && !settingsOpen;
  const phoneSheet: 'card' | 'parts' | 'settings' | 'panel' | undefined = phone ? (card ? 'card' : partsSheet ? 'parts' : settingsOpen ? 'settings' : panel ? 'panel' : undefined) : undefined;
  const strip = phone && !!card && editing;
  const vw = typeof window === 'undefined' ? 0 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 0 : window.innerHeight;
  const rightEdge = !phone ? Math.min(tabsRect.width ? tabsRect.left : vw, panel && sheetRect.width ? sheetRect.left : vw) : vw;
  const insets: Insets = phone
    ? // The stack along the bottom, lifted above the keyboard while a value is typed (its height is
      // measured; where it sits is the keyboard's inset, which moves it without resizing it).
      { top: topRect.bottom + 4, right: 4, left: 16, bottom: bottomRect.height ? (strip ? keyboard : 0) + bottomRect.height + 4 : 0 }
    : { top: topRect.bottom + 10, left: toolsRect.right + 18, right: vw - rightEdge + 14, bottom: bottomRect.height ? vh - bottomRect.top + 4 : 0 };
  /** The free paper on a computer, where the card and the note may go (screen pixels). */
  const area: Box = { x0: toolsRect.right + 12, y0: topRect.bottom + 8, x1: rightEdge - 12, y1: (bottomRect.height ? bottomRect.top : vh) - 6 };

  // On a phone, what to keep in view: with a card open, the part and the nodes it changes (its own
  // and those it reads); while its value is typed, the view fits just those (critique 3).
  const cardFocus = useMemo((): Box | undefined => {
    if (!phone || !card) return undefined;
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

  // ---- the card on a computer: beside its part, the drawing panned once if that makes room (critique 1, 2).
  // Placed when it opens (or the window changes), not again as its value is typed: the drawing as it
  // was then decides, so a value label a little wider or narrower never moves the card.
  const base = viewInfo?.base;
  const [placement, setPlacement] = useState<CardPlacement | undefined>(undefined);
  const grown = cardRect.height > CARD_H + 1 ? Math.ceil(cardRect.height) : 0;
  useLayoutEffect(() => {
    if (phone || !card || !base || !topRect.height || !bottomRect.height) {
      setPlacement(undefined);
      return;
    }
    setPlacement(placeCard({ scene: shown.scene, part: card.key, view: base, area, width: CARD_W, height: Math.max(CARD_H, grown) }));
    // Not on every keystroke (shown changes as the value is typed): area by its numbers.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, card?.key, base?.unit, base?.x, base?.y, circuitId, turnWanted, area.x0, area.y0, area.x1, area.y1, topRect.height, bottomRect.height, grown]);
  const offset = placement && (placement.pan.x || placement.pan.y) ? placement.pan : undefined;

  /** Where the card is now: where it was placed, moved with its part if the reader has moved the drawing since. */
  const cardNow = useMemo(() => {
    if (!placement || !viewInfo || !card) return undefined;
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

  // ---- red pen on the drawing (critique 6, 7): traps next to their part (the misread value circled),
  // "No single answer at node n1" next to the node, and while a card is open, the old node voltages crossed out
  const beforeResults = useMemo(() => (card?.before ? placeResults(shown.scene, answers(card.before)) : undefined), [card?.before, shown]);
  const pen = useMemo((): PenMarks | undefined => {
    if (!viewInfo) return undefined;
    const sc = shown.scene;
    const visible = boxOnGrid(viewInfo.base, phone ? { x0: insets.left, y0: insets.top, x1: viewInfo.size.width - insets.right, y1: viewInfo.size.height - insets.bottom } : area);
    const within: Box = { x0: Math.max(visible.x0, sc.bounds.x0 - 4), y0: Math.max(visible.y0, sc.bounds.y0 - 4), x1: Math.min(visible.x1, sc.bounds.x1 + 4), y1: Math.min(visible.y1, sc.bounds.y1 + 4) };
    const avoid: Box[] = cardNow ? [inflate(boxOnGrid(viewInfo.view, cardNow.box), 0.3)] : [];
    const notes: PenNote[] = [];
    const circled = new Set<string>();
    if (current) {
      for (const [key, t] of [...partTraps].slice(0, 2)) {
        const about = partBox(sc, key);
        const part = schematic.circuit.parts.find((p) => p.key === key);
        if (!about || !part) continue;
        if (onValueField(t, part, netlist)) circled.add(key);
        const note = placeNote(sc, about, t.title, { area: within, avoid: [...avoid, ...notes.map((n) => n.box)] });
        if (note) notes.push(note);
      }
      const ns = sol.noSingleAnswer;
      const about = ns ? nodeBox(sc, ns.at) : undefined;
      if (ns && about) {
        const note = placeNote(sc, about, ns.title, { area: within, avoid: [...avoid, ...notes.map((n) => n.box)] });
        if (note) notes.push(note);
      }
    }
    const was = card && current ? wasMarks(sc, results, beforeResults, [...avoid, ...notes.map((n) => n.box)]) : [];
    return notes.length || was.length || circled.size ? { notes, was, circled } : undefined;
    // insets and area by their numbers
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [viewInfo?.base, viewInfo?.view, viewInfo?.size, shown, current, partTraps, sol, card, results, beforeResults, cardNow?.box.x0, cardNow?.box.y0, schematic, netlist, phone]);

  // ---- the sticky note on a computer: beside the part it invites you to change, with a pen arrow to it (critique 6)
  const invite = schematic.scene.parts.find((p) => 'EFGH'.includes(p.letter)) ?? schematic.scene.parts.find((p) => p.letter === 'R');
  const notePlace = useMemo(() => {
    if (!noteShown || !viewInfo || !noteRect.width || !invite) return undefined;
    const part = shown.scene.parts.find((p) => p.key === invite.key);
    if (!part) return undefined;
    const room = drawingRoom(shown.scene, viewInfo.view, area);
    const target = boxOnScreen(viewInfo.view, unionBoxes([part.box, part.labelBox])!);
    const p = placeBeside(target, noteRect.width + 8, noteRect.height + 8, room, { gap: 30, sides: ['above', 'right', 'left', 'below'], step: 8 });
    if (!p || p.cost > 0) return undefined;
    const box = { x0: p.box.x0 + 4, y0: p.box.y0 + 4, x1: p.box.x1 - 4, y1: p.box.y1 - 4 };
    const name = part.labels.find((l) => l.role === 'name');
    // The arrow keeps off the words as written (not the room kept for longer numbers) and off the wires.
    const arrow = inviteArrow(
      box,
      boxOnScreen(viewInfo.view, part.body),
      inkBoxes(shown.scene, results).map((b) => boxOnScreen(viewInfo.view, b)),
      room.segments,
      name ? boxOnScreen(viewInfo.view, name.box) : undefined,
    );
    return { box, ...(arrow ? { arrow } : {}) };
    // area by its numbers
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [noteShown, viewInfo?.view, noteRect.width, noteRect.height, invite?.key, shown, results, area.x0, area.y0, area.x1, area.y1]);

  // ---- a card opened before ngspice answered keeps the first answer as the one to compare with
  useEffect(() => {
    if (card && !card.before && current && text === card.startText) setCard((c) => (c && !c.before ? { ...c, before: sol } : c));
  }, [card, current, text, sol]);

  // ---- the address's typed value (a screenshot of the numbers moving), once ngspice has answered
  useEffect(() => {
    if (valueTyped || !initial.value || !card?.before || !current) return;
    setValueTyped(true);
    onValue(initial.value);
  }, [valueTyped, initial.value, card, current, onValue]);
  useEffect(() => {
    if (!initial.edit || !card || !phone) return;
    const t = window.setTimeout(() => document.querySelector<HTMLInputElement>('.ck-value__input')?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [initial.edit, card, phone]);

  // ---- ready for a screenshot: ngspice answered for the text shown, the state is drawn, the fonts are in
  const layoutReady =
    !!topRect.height && !!bottomRect.height && (!card || phone || !!cardNow) && (!panel || !!sheetRect.height) && (!noteShown || !!noteRect.height) && valueTyped && (!initial.edit || strip);
  useEffect(() => {
    if (!initial.shot || !current || !viewInfo || !layoutReady) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void document.fonts.ready.then(() =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (!cancelled) document.body.dataset.shotReady = '1';
          }),
        ),
      );
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [initial.shot, current, viewInfo, layoutReady]);

  // ---- words for the frame
  const status = statusWords(engineState, sol, text, runError);
  const analysis = analysisName(explains, netlist);
  const cardPart = card ? schematic.circuit.parts.find((p) => p.key === card.key) : undefined;
  const typeHint = cardPart ? TYPE_HINT[cardPart.letter] : undefined;
  const hint = hintWords({ phone, tool, selectedName: selectedPart?.name, typeHint, whole: viewInfo?.whole ?? true, turned: shown === turned, asDrawn: asDrawnOnPhone });
  const cardProps = cardPart && card && typeHint ? cardContent(cardPart, card, schematic, sol, text, typeHint) : undefined;
  const cardHandlers = {
    onValue,
    onPutBack: () => card && onValue(card.start),
    onClose: () => closeCard(),
    onExplain: () => {
      setPanel('explain');
      if (phone) {
        setCard(undefined);
        setEditing(false);
      }
    },
    onFix: () => {
      setPanel('checks');
      if (phone) {
        setCard(undefined);
        setEditing(false);
      }
    },
  };

  /** The card on a computer, beside its part (place.ts), with its notch, and a leader only when it crosses nothing. */
  const overlay = (info: CanvasViewInfo): ReactNode => {
    if (!cardProps || phone || !cardNow) return null;
    const { box, side, notch, leader } = cardNow;
    const style: CSSProperties = side === 'above' ? { left: box.x0, bottom: info.size.height - box.y1, width: CARD_W } : { left: box.x0, top: box.y0, width: CARD_W };
    const along = side === 'above' || side === 'below' ? notch.x - box.x0 : notch.y - box.y0;
    return (
      <>
        {leader ? (
          <svg className="ck-leader" aria-hidden="true" focusable="false">
            <path d={`M${leader.from.x} ${leader.from.y} L${leader.to.x} ${leader.to.y}`} />
          </svg>
        ) : null}
        <div ref={cardRef} className="ck-pinned" style={style}>
          <IndexCard {...cardProps} {...cardHandlers} variant="pinned" side={side} notch={along} />
        </div>
      </>
    );
  };

  const inert = paletteOpen;

  // ---- the pieces of the frame
  const tabs = (
    <nav className="ck-tabs" aria-label="Panels" ref={tabsRef}>
      {PANELS.map((id) => (
        <button key={id} type="button" className={`ck-tab ck-tab--${id}`} aria-expanded={panel === id} aria-controls={panel === id ? 'ck-panel' : undefined} onClick={() => togglePanel(id)}>
          <Icon name={id} className="ck-tab__icon" />
          <span className="ck-tab__label">{PANEL_TITLES[id].title}</span>
          {id === 'checks' && checks?.length ? (
            <span className="ck-tab__badge">
              {checks.length}
              <span className="ck-sr"> found</span>
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );

  const panelBody = panel ? (
    <section id="ck-panel" className={`ck-sheet ck-sheet--${panel}`} ref={sheetRef} aria-labelledby={`panel-${panel}-title`}>
      {phone ? <span className="ck-grab" aria-hidden="true" /> : null}
      {panel === 'netlist' ? (
        <NetlistPanel
          netlist={netlist}
          text={text}
          fileName={circuit.file}
          explains={explains}
          checks={checks ?? []}
          annotations={current ? sol.annotations : []}
          colours={colours}
          drawingLines={drawingLines}
          selectedLine={selectedLine}
          unfolded={unfolded}
          onToggleFold={() => setUnfolded((u) => !u)}
          onClose={() => setPanel(undefined)}
          headingRef={(el) => {
            panelHeading.current = el;
          }}
        />
      ) : panel === 'checks' ? (
        <ChecksPanel
          checks={checks ?? []}
          partOfLine={(line) => schematic.circuit.parts.find((p) => p.line + 1 === line)?.name}
          onFix={applyFix}
          onShowLine={(line) => {
            setSelectedLine(line);
            setPanel('netlist');
          }}
          onClose={() => setPanel(undefined)}
          headingRef={(el) => {
            panelHeading.current = el;
          }}
        />
      ) : (
        <ExplainPanel
          describe={describe}
          selected={explainSelection(selected, schematic, sol, text, results)}
          parts={schematic.scene.parts.map((p) => ({ key: p.key, name: p.name, kind: elementInfo(p.letter)?.name ?? p.letter }))}
          colours={colours}
          onPick={(key) => {
            setSelected({ kind: 'part', key });
            const p = schematic.circuit.parts.find((x) => x.key === key);
            if (p) setSelectedLine(p.line + 1);
          }}
          onClose={() => setPanel(undefined)}
          headingRef={(el) => {
            panelHeading.current = el;
          }}
        />
      )}
    </section>
  ) : null;

  const partsBody = (
    // A sheet over the page, not a modal <dialog>: the drawing stays usable beside it.
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
    <section className="ck-sheet ck-sheet--parts" ref={sheetRef} role="dialog" aria-modal="false" aria-labelledby="ck-parts-title">
      <span className="ck-grab" aria-hidden="true" />
      <div className="ck-card__head">
        <div className="ck-card__titles">
          <h2 className="ck-card__title" id="ck-parts-title">
            Parts
          </h2>
          <p className="ck-card__sub">placing parts comes next in the build</p>
        </div>
        <button className="ck-icon-btn" type="button" aria-label="Close the parts" onClick={() => setPartsSheet(false)}>
          <Icon name="close" />
        </button>
      </div>
      <div className="ck-card__body ck-parts-sheet">
        <PartsSheetList tool={tool} onPick={chooseTool} />
      </div>
    </section>
  );

  const settingsBody = settingsOpen ? (
    <SettingsDialog
      phone={phone}
      font={plain ? 'plain' : 'handwriting'}
      onFont={setFont}
      onClose={() => setSettingsOpen(false)}
      sheetRef={phone ? sheetRef : undefined}
      sample={results.nodes.find((n) => n.mark)?.words.text}
    />
  ) : null;

  const hintAndStatus = (
    <div className={`ck-lines${status.tone === 'bad' ? ' is-bad' : ''}`}>
      <p className="ck-hint">{hint}</p>
      <div className="ck-status">
        <span className={`ck-status__dot ck-status__dot--${status.tone}`} aria-hidden="true" />
        <span className="ck-status__main">{status.main}</span>
        {status.detail ? <span className="ck-status__detail ck-status__reason">{status.detail}</span> : null}
        {/* A reason to read comes first: the rest makes room for it (critique 7). */}
        {analysis && !phone && status.tone !== 'bad' ? <span className="ck-status__detail ck-status__analysis">{analysis}</span> : null}
        {!phone && status.tone !== 'bad' ? <span className="ck-status__detail ck-status__engine">ngspice 47, in your browser</span> : null}
        {phone && turned ? (
          <button type="button" className="ck-turn" aria-pressed={!turnWanted} onClick={() => setTurnWanted((t) => !t)}>
            {turnWanted ? 'As in the video' : 'Turn to fit'}
          </button>
        ) : null}
        {!phone ? (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a set of buttons, not form fields
          <span className="ck-zoom" role="group" aria-label="Zoom">
            <button className="ck-icon-btn" type="button" aria-label="Zoom out" aria-keyshortcuts="-" onClick={() => canvas.current?.zoomBy(1 / 1.2)}>
              <Icon name="zoom-out" />
            </button>
            <button className="ck-zoom__pct" type="button" onClick={fit} aria-label={`${viewInfo ? `${Math.round((viewInfo.unit / 20) * 100)}%` : 'Zoom'}: fit the drawing to the window`} aria-keyshortcuts="Shift+1">
              {viewInfo ? `${Math.round((viewInfo.unit / 20) * 100)}%` : '…'}
            </button>
            <button className="ck-icon-btn" type="button" aria-label="Zoom in" aria-keyshortcuts="+" onClick={() => canvas.current?.zoomBy(1.2)}>
              <Icon name="zoom-in" />
            </button>
            <button className="ck-icon-btn" type="button" aria-label="Fit the drawing to the window" onClick={fit}>
              <Icon name="fit" />
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );

  // A drawing wider than the phone, as in the video: it opens at its left end; the edges say there is more.
  const edges = useMemo(() => {
    if (!asDrawnOnPhone || !viewInfo || strip) return { left: false, right: false };
    const c = boxOnScreen(viewInfo.view, shown.scene.bounds);
    return { left: c.x0 < insets.left - 4, right: c.x1 > viewInfo.size.width - insets.right + 4 };
    // insets by their numbers
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [asDrawnOnPhone, viewInfo, shown, strip, insets.left, insets.right]);
  const panSideways = (dir: 1 | -1): void => {
    if (!viewInfo) return;
    const c = boxOnScreen(viewInfo.view, shown.scene.bounds);
    const visible = viewInfo.size.width - insets.left - insets.right;
    const step = visible * 0.7;
    // Never past the drawing's ends.
    const dx = dir > 0 ? -Math.min(step, c.x1 - (viewInfo.size.width - insets.right) + 10) : Math.min(step, insets.left - c.x0 + 10);
    canvas.current?.panBy(dx, 0);
  };

  const bottomBar = (
    <nav className="ck-bar" aria-label="Tools and panels">
      <button type="button" className={`ck-bar__btn${tool === 'select' && !partsSheet ? ' is-on' : ''}`} aria-pressed={tool === 'select' && !partsSheet} onClick={() => chooseTool('select')}>
        <ToolGlyph kind="select" />
        <span className="ck-bar__word">Select</span>
      </button>
      <button
        type="button"
        className={`ck-bar__btn${partsSheet || tool !== 'select' ? ' is-on' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={partsSheet}
        onClick={() => {
          setPartsSheet((o) => !o);
          setPanel(undefined);
          setSettingsOpen(false);
        }}
      >
        {tool !== 'select' && tool !== 'wire' ? <ToolGlyph kind={tool} /> : <Icon name="parts" className="ck-bar__icon" />}
        <span className="ck-bar__word">{tool !== 'select' ? cap(toolPhrase(tool).replace(/^(a|an) /, '')).split(' ')[0] : 'Parts'}</span>
      </button>
      <span className="ck-bar__sep" aria-hidden="true" />
      {PANELS.map((id) => (
        <button
          key={id}
          type="button"
          className={`ck-bar__btn ck-bar__btn--panel ck-tab--${id}${panel === id ? ' is-open' : ''}`}
          aria-expanded={panel === id}
          aria-controls={panel === id ? 'ck-panel' : undefined}
          onClick={() => togglePanel(id)}
        >
          <Icon name={id} className="ck-bar__icon" />
          <span className="ck-bar__word">{PANEL_TITLES[id].title}</span>
          {id === 'checks' && checks?.length ? (
            <span className="ck-tab__badge ck-bar__badge">
              {checks.length}
              <span className="ck-sr"> found</span>
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );

  const title = (
    <h1 className="ck-title">
      <button
        type="button"
        className="ck-switch__btn"
        aria-haspopup="menu"
        aria-expanded={switcherOpen}
        title={circuit.name}
        onClick={() => setSwitcherOpen((o) => !o)}
      >
        {!phone ? (
          <span className="ck-title__kicker">
            PlainSpice <span className="ck-doc__tag">checkpoint</span>
            <span className="ck-sr">: </span>
          </span>
        ) : null}
        <span className="ck-title__name">
          <ShortTitle c={circuit} />
          <Icon name="chevron-down" />
        </span>
      </button>
    </h1>
  );

  return (
    <div className={`ck-app nb-theme${phone ? ' is-phone' : ' is-desktop'}${plain ? ' nb-plain' : ''}${strip ? ' is-editing' : ''}`} data-tool={tool}>
      <a className="ck-skip" href="#ck-drawing" onClick={(e) => {
        e.preventDefault();
        if (selected) canvas.current?.focusItem(selected);
        else document.querySelector<HTMLElement>('.nb-hit[tabindex="0"]')?.focus();
      }}>
        Skip to the drawing
      </a>

      <header className="ck-topbar" ref={topRef} inert={inert}>
        <div className="ck-doc ck-island">
          <span className="ck-doc__mark">
            <Mark />
          </span>
          <div className="ck-switch">
            {title}
            {switcherOpen ? <Switcher current={circuitId} onPick={switchCircuit} onClose={() => setSwitcherOpen(false)} /> : null}
          </div>
          {!phone ? (
            <>
              <span className="ck-doc__file">{circuit.file}</span>
              <span className="ck-doc__sep" aria-hidden="true" />
              <button className="ck-icon-btn" type="button" onClick={undo} disabled={!past[circuitId].length} aria-label="Undo" aria-keyshortcuts="Control+Z">
                <Icon name="undo" />
              </button>
              <button className="ck-icon-btn" type="button" onClick={redo} disabled={!future[circuitId].length} aria-label="Redo" aria-keyshortcuts="Control+Shift+Z">
                <Icon name="redo" />
              </button>
            </>
          ) : null}
        </div>
        {phone ? (
          <button type="button" className="ck-icon-btn ck-cmd-icon" aria-label="Search or run a command" aria-keyshortcuts="Control+K" onClick={openPalette}>
            <Icon name="search" />
          </button>
        ) : (
          <button type="button" className="ck-cmd ck-island" aria-keyshortcuts="Control+K" onClick={openPalette}>
            <Icon name="search" />
            <span className="ck-cmd__text">Search or run a command…</span>
            <kbd className="ck-kbd" aria-hidden="true">
              Ctrl K
            </kbd>
          </button>
        )}
        <div className="ck-run ck-island">
          <button className="ck-icon-btn" type="button" aria-label="Settings" aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((o) => !o)}>
            <Icon name="settings" />
          </button>
          <button className="ck-btn ck-btn--outline ck-run__btn" type="button" onClick={runAgain} aria-keyshortcuts="Control+Enter" aria-label="Run ngspice again">
            <Icon name="run" />
            {!phone ? <span aria-hidden="true">Run</span> : null}
          </button>
        </div>
      </header>

      {!phone ? (
        <section className="ck-margin" ref={toolsRef} inert={inert} aria-label="Parts and tools">
          <PartsToolbar tool={tool} onTool={chooseTool} />
        </section>
      ) : null}

      <main id="ck-drawing" className="ck-paper" inert={inert} aria-labelledby="ck-drawing-name">
        <h2 className="ck-sr" id="ck-drawing-name">
          {circuit.name}
        </h2>
        <NotebookCanvas
          ref={canvas}
          schematic={shown}
          results={results}
          pending={!current && !!sol}
          plain={plain}
          label={`${circuit.name}, drawn and solved`}
          description={describe}
          selected={selected}
          related={related}
          traps={traps}
          pen={pen}
          onSelect={onSelect}
          onOpen={onOpen}
          onEscape={() => {
            if (card) closeCard();
            else setSelected(undefined);
          }}
          insets={insets}
          // A computer keeps its fit when a card opens (critique 1); a phone fits again above the card's
          // sheet, and again above the strip while a value is typed (critique 3).
          fitKey={`${circuitId}:${fitCount}:${phone ? 'phone' : 'desk'}:${shown === turned ? 'turned' : 'as-drawn'}:${phone && card ? `card:${card.key}` : ''}:${strip ? 'edit' : ''}`}
          minUnit={minUnitFor()}
          maxUnit={phone ? 30 : 40}
          padding={phone ? 10 : 24}
          fill={asDrawnOnPhone && phoneView.pans ? 'height' : 'whole'}
          focus={cardFocus}
          frame={frame}
          offset={offset}
          hold={!!card}
          ghost={tool === 'select' || tool === 'wire' ? undefined : tool}
          onView={setViewInfo}
          overlay={overlay}
        />
        <div className="ck-margin-line" aria-hidden="true" />
        {asDrawnOnPhone && edges.left ? (
          <button type="button" className="ck-more ck-more--left" style={{ top: insets.top, bottom: insets.bottom }} onClick={() => panSideways(-1)}>
            <Icon name="chevron-left" />
            <span className="ck-sr">Show more of the drawing, to the left</span>
          </button>
        ) : null}
        {asDrawnOnPhone && edges.right ? (
          <button type="button" className="ck-more ck-more--right" style={{ top: insets.top, bottom: insets.bottom }} onClick={() => panSideways(1)}>
            <span className="ck-more__word" aria-hidden="true">
              more
            </span>
            <Icon name="chevron-right" />
            <span className="ck-sr">Show more of the drawing, to the right</span>
          </button>
        ) : null}
        {notePlace?.arrow ? (
          <svg className="ck-note-arrow" aria-hidden="true" focusable="false">
            <path d={`M${notePlace.arrow.from.x} ${notePlace.arrow.from.y} Q${notePlace.arrow.control.x} ${notePlace.arrow.control.y} ${notePlace.arrow.to.x} ${notePlace.arrow.to.y}`} />
            <ArrowHead from={notePlace.arrow.control} to={notePlace.arrow.to} />
          </svg>
        ) : null}
        <p className="ck-sr" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </main>

      {noteShown ? (
        <aside
          className={`ck-note${notePlace ? ' is-placed' : ''}`}
          ref={noteRef}
          aria-labelledby="ck-note-title"
          inert={inert}
          style={notePlace ? { left: notePlace.box.x0, top: notePlace.box.y0, right: 'auto' } : undefined}
        >
          <span className="ck-note__tape" aria-hidden="true" />
          <p className="ck-note__title" id="ck-note-title">
            Change a value and watch the numbers move
          </p>
          <p className="ck-note__text">Click a part, then type a new value: ngspice solves the circuit again as you type.</p>
          <div className="ck-note__actions">
            {invite ? (
              <button className="ck-btn ck-btn--note" type="button" onClick={() => openCard(invite.key)}>
                Change {invite.name}
              </button>
            ) : null}
            <button className="ck-icon-btn ck-icon-btn--note" type="button" aria-label="Hide this note" onClick={() => setNoteHidden(true)}>
              <Icon name="close" />
            </button>
          </div>
        </aside>
      ) : null}

      {phone ? (
        // One stack along the bottom: the hint and status, a sheet, the bar. While a value is typed it
        // is only the card's strip, held above the keyboard (critique 3).
        <div className={`ck-phone-bottom${strip ? ' is-strip' : ''}`} ref={bottomRef} inert={inert} style={strip ? { bottom: keyboard } : undefined}>
          {phoneSheet === 'card' ? null : <footer className="ck-phone-lines">{hintAndStatus}</footer>}
          {phoneSheet === 'panel' ? panelBody : null}
          {phoneSheet === 'parts' ? partsBody : null}
          {phoneSheet === 'settings' ? settingsBody : null}
          {phoneSheet === 'card' && cardProps ? (
            <div className="ck-sheet ck-sheet--card" ref={sheetRef as (el: HTMLDivElement | null) => void}>
              <IndexCard
                {...cardProps}
                {...cardHandlers}
                variant={strip ? 'strip' : 'sheet'}
                focusField={false}
                onFieldFocus={() => setEditing(true)}
                onFieldBlur={(next) => {
                  if (!next?.closest('.ck-index')) setEditing(false);
                }}
                onDone={() => {
                  (document.activeElement as HTMLElement | null)?.blur();
                  setEditing(false);
                }}
              />
            </div>
          ) : null}
          {phoneSheet === 'card' ? null : bottomBar}
        </div>
      ) : (
        <>
          <div className="ck-right" inert={inert}>
            {tabs}
            {panelBody}
          </div>
          {settingsBody ? <div inert={inert}>{settingsBody}</div> : null}
          <footer className="ck-bottom" ref={bottomRef} inert={inert} style={{ right: insets.right - 4 }}>
            {hintAndStatus}
          </footer>
        </>
      )}

      {paletteOpen ? <CommandPalette commands={commands} onRun={runCommand} onClose={closePalette} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ small parts of the page

/** "Ex. 3 · open circuit · V_Th", the subscript set as one. */
function ShortTitle({ c }: { c: CheckpointCircuit }): ReactNode {
  return (
    <span className="ck-title__text">
      {c.short.example} · {c.short.what} ·{' '}
      <span className="ck-title__finds">
        {c.short.finds.symbol}
        <span className="ck-sr"> </span>
        <sub>{c.short.finds.sub}</sub>
      </span>
    </span>
  );
}

/** A pen arrowhead at the end of a curve, pointing along it. */
function ArrowHead({ from, to }: { from: { x: number; y: number }; to: { x: number; y: number } }): ReactNode {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const l = 11;
  const w = 0.5;
  const p1 = { x: to.x - l * Math.cos(a - w), y: to.y - l * Math.sin(a - w) };
  const p2 = { x: to.x - l * Math.cos(a + w), y: to.y - l * Math.sin(a + w) };
  return <path className="ck-note-arrow__head" d={`M${p1.x} ${p1.y} L${to.x} ${to.y} L${p2.x} ${p2.y}`} />;
}

function Switcher({ current, onPick, onClose }: { current: CircuitId; onPick: (id: CircuitId) => void; onClose: () => void }): ReactNode {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    refs.current[Math.max(0, CIRCUIT_IDS.indexOf(current))]?.focus();
    const onDown = (e: PointerEvent): void => {
      if (!(e.target instanceof Element && e.target.closest('.ck-switch'))) onClose();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [current, onClose]);
  return (
    <div className="ck-menu ck-menu--switch" role="menu" aria-label="Circuits">
      {CIRCUITS.map((c, i) => (
        <button
          key={c.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="menuitemradio"
          aria-checked={c.id === current}
          className="ck-switch__item"
          tabIndex={-1}
          onClick={() => onPick(c.id)}
          onKeyDown={(e) => {
            const n = CIRCUITS.length;
            if (e.key === 'ArrowDown') refs.current[(i + 1) % n]?.focus();
            else if (e.key === 'ArrowUp') refs.current[(i + n - 1) % n]?.focus();
            else if (e.key === 'Escape' || e.key === 'Tab') onClose();
            else return;
            e.preventDefault();
          }}
        >
          <span className="ck-switch__item-name">{c.name}</span>
          <span className="ck-switch__item-file">{c.file}</span>
        </button>
      ))}
      <p className="ck-switch__credit">
        From the Solved Circuits video “{CIRCUITS[0]?.video}” (CC BY 4.0)
      </p>
    </div>
  );
}

/** True when a check is about a part's value (its span covers the value's word): the drawing circles the value. */
function onValueField(t: Trap, part: CircuitPart, netlist: Netlist): boolean {
  const info = elementInfo(part.letter);
  const field = explainLine(netlist, part.line)?.fields.find((f) => f.label === info?.valueLabel);
  const span = field?.span;
  return !!span && t.span.from < span.to && span.from < t.span.to;
}

function noNumbersReason(sol: Solution): string {
  const error = sol.checks.find((c) => c.severity === 'error');
  if (sol.status === 'check' && error) return `No numbers: ${error.title}.`;
  return withoutResultsPointer(sol.words.summary);
}

/** The status line (Studio's): what ngspice is doing and how the last run went. */
function statusWords(engineState: EngineState, sol: Solution | undefined, text: string, runError: string | undefined): { main: string; detail?: string; tone: 'ok' | 'busy' | 'bad' } {
  if (engineState.kind === 'error') return { main: 'ngspice could not start', detail: engineState.message, tone: 'bad' };
  if (runError) return { main: 'ngspice stopped', detail: runError, tone: 'bad' };
  if (!sol || sol.text !== text) return { main: engineState.kind === 'loading' && !sol ? 'Loading ngspice…' : 'Solving…', tone: 'busy' };
  if (sol.status !== 'ok') return { main: 'No numbers', detail: noNumbersReason(sol), tone: 'bad' };
  return { main: `Solved in ${Math.max(1, Math.round(sol.ms))} ms`, tone: 'ok' };
}

/** The analysis for the status line, from its explanation (".op: operating point" as "Operating point (.op)"). */
function analysisName(explains: readonly LineExplanation[], netlist: Netlist): string | undefined {
  const i = netlist.analyses[0];
  if (i === undefined) return undefined;
  const ex = explains.find((e) => e.line === i + 1);
  const m = ex ? /^(\.\w+):\s*(.*)$/.exec(ex.heading) : null;
  return m ? `${cap(m[2]!)} (${m[1]})` : ex?.heading;
}

/** The hint line (Playground's): what you can do now, in plain words. */
function hintWords(p: { phone: boolean; tool: Tool; selectedName: string | undefined; typeHint: string | undefined; whole: boolean; turned: boolean; asDrawn: boolean }): string {
  const back = p.phone ? 'Tap Select to go back.' : 'Esc goes back to Select.';
  if (p.tool === 'wire') return `Drawing wires comes next in the build. ${back}`;
  if (p.tool !== 'select') return `Placing parts comes next in the build: this is the ghost of ${toolPhrase(p.tool)}. ${back}`;
  if (p.typeHint) return p.phone ? `${p.typeHint}` : `${p.typeHint}: ngspice solves again as you type · Enter or Esc closes the card`;
  if (p.selectedName) return p.phone ? `${p.selectedName} selected · tap it again to change it` : `${p.selectedName} selected · Enter opens its card · arrow keys move along the wires · Esc lets go`;
  if (p.phone && p.turned) return 'Turned to fit the screen · tap a part to change it';
  if (p.phone && p.asDrawn && !p.whole) return 'As in the video · drag the paper for the rest';
  if (p.phone) return p.whole ? 'Tap a part to see its numbers and change it' : 'Drag the paper to see the rest of the circuit';
  return 'Click a part to see its numbers and change its value · drag the paper to move around · Ctrl K for every command';
}

/** The card's contents for a part: every word and number from the model and the last run. */
function cardContent(part: CircuitPart, card: CardState, s: Schematic, sol: Solution | undefined, text: string, typeHint: string): Omit<CardProps, 'variant' | 'onValue' | 'onPutBack' | 'onClose' | 'onExplain'> {
  const info = elementInfo(part.letter);
  const ex = explainLine(s.netlist, part.line);
  const valueField = ex?.fields.find((f) => f.label === info?.valueLabel);
  const current = !!sol && sol.text === text;
  const words = current ? answers(sol) : undefined;
  const beforeWords = answers(card.before);
  const c = words?.currents.find((x) => x.element === part.key);
  const was = beforeWords?.currents.find((x) => x.element === part.key);
  const volts = new Map<string, number>([[GROUND, 0], ...(words?.nodes ?? []).map((n): [string, number] => [lowerAscii(n.node), n.value])]);
  const voltsBefore = new Map<string, number>([[GROUND, 0], ...(beforeWords?.nodes ?? []).map((n): [string, number] => [lowerAscii(n.node), n.value])]);
  const written = (i: 0 | 1): string => (part.nodes[i] === GROUND ? '0' : part.nodeText[i]);
  const nodeText = (n: string): string => s.circuit.nodes.get(n)?.text ?? n;
  const readouts: Readout[] = [];
  if (c) {
    const amps = formatSI(Math.abs(c.value), 'A');
    const prev = was ? formatSI(Math.abs(was.value), 'A') : undefined;
    const r: Readout = {
      value: amps,
      what: c.ammeter ? 'measured' : 'through it',
      sub: [c.value === 0 ? '' : `from ${nodeWord(c.from, nodeText)} to ${nodeWord(c.to, nodeText)}`].filter(Boolean),
      tone: 'current',
      speech: currentText(c, nodeText),
    };
    if (prev && prev !== amps) r.was = prev;
    readouts.push(r);
  }
  const va = volts.get(part.nodes[0]);
  const vb = volts.get(part.nodes[1]);
  if (words && va !== undefined && vb !== undefined && !isAmmeter(part)) {
    // Its size and which end is higher, SPICE's signed difference underneath (critique 9).
    const across = acrossWords({ name: part.name, v: [va, vb], nodes: part.nodes, written: [written(0), written(1)], text: nodeText });
    const pa = voltsBefore.get(part.nodes[0]);
    const pb = voltsBefore.get(part.nodes[1]);
    const prev = beforeWords && pa !== undefined && pb !== undefined ? formatSI(Math.abs(pa - pb), 'V') : undefined;
    const r: Readout = { value: across.text, what: 'across it', sub: [across.higher ? `${across.higher} is higher` : '', across.signed].filter(Boolean), tone: 'voltage', speech: across.speech };
    if (prev && prev !== across.text) r.was = prev;
    readouts.push(r);
  }
  if (c?.power) {
    const w = formatSI(c.power.watts, 'W');
    const prev = was?.power ? formatSI(was.power.watts, 'W') : undefined;
    const r: Readout = { value: w, what: c.power.delivers ? 'delivers' : 'absorbs', tone: 'power', speech: c.power.speech };
    if (prev && prev !== w) r.was = prev;
    readouts.push(r);
  }
  const trap = current ? sol.checks.find((t) => t.line === part.line + 1 && t.severity !== 'info') : undefined;
  const suffix = controlSuffix(part) ?? UNIT_OF[part.letter];
  // What SPICE reads the value as: the explanation's own words for R, V and I ("3 Ω"); for a gain,
  // the number SPICE reads, as it reads it (critique 8: "0.25", not "250 mA").
  const gain = isControlled(part.letter);
  const reads = valueField ? (gain && part.value !== undefined ? formatNumber(part.value) : valueField.meaning) : undefined;
  return {
    name: part.name,
    kind: info?.name ?? part.letter,
    line: part.line + 1,
    icon: part.letter,
    value: card.input,
    start: card.start,
    readouts,
    sentence: describePart(s, part.key),
    typeHint,
    ...(isEditable(part) && info?.valueLabel ? { label: info.valueLabel } : {}),
    ...(suffix ? { suffix } : {}),
    ...(reads ? { reads, readsTrap: !!valueField && /!/.test(valueField.meaning) } : {}),
    ...(trap ? { trap: trap.title } : {}),
    ...(!words && current ? { noNumbers: noNumbersReason(sol) } : {}),
  };
}

/** What the Explain panel shows for the selection. */
function explainSelection(selected: NavItem | undefined, s: Schematic, sol: Solution | undefined, text: string, results: DrawingResults): ExplainPanelProps['selected'] {
  if (!selected) return undefined;
  const words = sol && sol.text === text ? answers(sol) : undefined;
  const nodeText = (n: string): string => s.circuit.nodes.get(n)?.text ?? n;
  if (selected.kind === 'part') {
    const part = s.circuit.parts.find((p) => p.key === selected.key);
    if (!part) return undefined;
    const c = words?.currents.find((x) => x.element === part.key);
    return { kind: 'part', name: part.name, ex: explainLine(s.netlist, part.line), ...(c ? { current: currentText(c, nodeText) } : {}), ...(c?.power ? { power: c.power.text } : {}) };
  }
  const n = results.nodes.find((x) => x.node === selected.name);
  const name = selected.name === GROUND ? 'Ground (node 0)' : nodeText(selected.name);
  return { kind: 'node', name, parts: describeNode(s, selected.name), ...(n ? { voltage: n.words.text } : {}) };
}
