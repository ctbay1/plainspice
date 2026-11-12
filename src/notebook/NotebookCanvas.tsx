/**
 * The Notebook canvas: the circuit on cream grid paper, solved results written on it, fitted to the
 * window, and usable without a mouse. It renders any schematic the model builds (src/schematic,
 * buildSchematic with NOTEBOOK_OPTIONS) with the results placed by results.ts; the page around it
 * owns the netlist, the runs and the panels.
 *
 * - Fit: the whole drawing in the free part of the window (`insets` say what the page covers),
 *   never so small that its words are too small to read (`minUnit`, fit.ts), unless the page asks
 *   for it whole (`fitWhole`: the reader's Fit); then the reader can pan (drag the paper, from a
 *   part or a name too, or scroll) and zoom (Ctrl + wheel, pinch, zoomBy), never so far that the
 *   drawing leaves the window (keepInView). `fitKey` fits again. A sheet that made the view move
 *   (to keep the selected item clear of it) moves it back when it goes.
 * - Keyboard and screen readers: every part and node is a real button over the drawing, with one
 *   tab stop for the drawing (roving focus). Arrow keys move along the wires (navigate.ts:
 *   neighbour), Home and End go to the first and last item in reading order, Enter opens the
 *   selected part, Escape lets go. Each button's description is the model's own sentence for it
 *   (describeItem) and its results in words (describe.ts). The SVG has a title and the circuit's
 *   description.
 * - The selected part gets a highlighter swipe, the parts it is tied to (the source an F or H reads,
 *   the nodes an E or G reads) a lighter one. The keyboard's focus ring is drawn round the symbol's
 *   body (or the node's name), never across its words.
 * - The page may pan the drawing for a while (`offset`: room for a part's card, critique 1) without
 *   changing its size, and fit a part of it instead of the whole (`frame`: a phone's editing view).
 * - The schematic editor (decision 0017, `editing`): a press on a part, a ground symbol or a node's
 *   name that moves becomes a drag the editor takes (the paper still pans from empty paper); a press
 *   the editor wants as a click (placing a part, a wire's end) comes to it as a tap, and the item's
 *   own click is then not acted on; a press on an item the editor does not take (the turned view's
 *   parts) is the item's click if it holds still and pans the paper if it moves; the pointer over
 *   the paper is reported for previews. What the editor shows (`marks`: the part in hand, a wire on
 *   its way ...) is drawn over the drawing.
 */
import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from 'react';
import { describeItem, neighbour, readingOrder, unionBoxes, GROUND, type Box, type NavItem, type PartLetter, type Point, type Scene, type Schematic } from '../schematic/index.ts';
import { DESCRIBE_STRINGS } from '../spice/describe.ts';
import { elementInfo } from '../spice/elements.ts';
import { assignNodeColours } from '../theme/nodes.ts';
import { Drawing, UNIT_PX, itemKey, type PenMarks } from './Drawing.tsx';
import { EditLayer, type EditMarks } from './EditLayer.tsx';
import { WHOLE_MIN_UNIT, fitView, inkInView, keepInView, zoomAt, type Insets, type Size, type View } from './fit.ts';
import { TYPE } from './measure.ts';
import { symbolBoxes } from './place.ts';
import { inkBoxes, type DrawingResults } from './results.ts';
import { NOTEBOOK_STRINGS } from './strings.ts';

export interface CanvasHandle {
  /** Move the keyboard focus to an item of the drawing (and bring it into view). */
  focusItem(item: NavItem): void;
  /** Fit the whole drawing to the window again. */
  fit(): void;
  /** Zoom about the middle of the free part of the window. */
  zoomBy(factor: number): void;
  /** Move the drawing by this many pixels (the reader's own pan: the view stops following the fit). */
  panBy(dx: number, dy: number): void;
  /**
   * Keep the view where it is from now on, as if the reader had moved it: the drawing was changed on
   * the drawing itself, and it must not jump or change size under the hand that changed it (only
   * Fit, another circuit or `fitKey` fit it again).
   */
  keep(): void;
  /** Where the drawing is now (to go back to after a docked card closes). */
  viewNow(): View | undefined;
  /** Show the drawing where it was (a view from viewNow), kept there. */
  showView(view: View): void;
  /**
   * Pan just enough to show a part of the drawing (grid units) in the free part of the window, with
   * `bottom` more pixels kept free along the bottom (a bar over the paper): something moved with the
   * keys, or just placed, never goes out of sight (WCAG 2.4.11). The view is the reader's from then on.
   */
  reveal(box: Box, bottom?: number): void;
}

export interface CanvasViewInfo {
  /** Screen pixels per grid unit. */
  unit: number;
  /** All of the drawing (what is drawn: not the room kept around it for longer numbers) is in the free part of the window. */
  whole: boolean;
  /**
   * The fit (not the reader's pans and zooms) shows all of the drawing, as `whole` judges it: a
   * drawing the reader moved partly off the screen is not whole, but still fits.
   */
  fits: boolean;
  /** Where the drawing is on the canvas now (with `offset` applied). */
  view: View;
  /** The same without `offset`: where the fit puts it. */
  base: View;
  /** The canvas's size, in pixels. */
  size: Size;
  /** The reader has moved the view (dragged, zoomed): it no longer follows the fit. */
  moved: boolean;
}

export type GhostKind = PartLetter | 'ground';

/** Where the pointer is, for the editor: grid units (not snapped), the drawing item it pressed (its button), Shift, the kind of pointer. */
export interface PointerInfo {
  at: Point;
  item?: NavItem | undefined;
  shift: boolean;
  /** 'mouse', 'pen' or 'touch'. */
  pointer: string;
  /** Screen pixels per grid unit now (for how near counts as on something). */
  unit: number;
}

/**
 * What a press means to the editor: 'drag' (if the pointer moves, the editor moves something; if not,
 * it is the item's own click), 'tap' (a click for the editor; moving pans), 'drag-tap' (both: a
 * thing without a button of its own, such as a part's words), or undefined (the paper pans as it
 * moves; a click on empty paper lets go of the selection).
 */
export type PressClaim = 'drag' | 'tap' | 'drag-tap' | undefined;

/** The schematic editor's side of the pointer (src/app/editing.ts decides what each means). */
export interface CanvasEditing {
  /** The pointer moved over the paper with no button pressed (a mouse or a pen); undefined: it left. */
  hover?(info: PointerInfo | undefined): void;
  press(info: PointerInfo): PressClaim;
  /** A drag the editor took has started (the pointer moved), moved on, and ended: dropped, or cancelled (a second finger, the pointer lost). */
  dragStart?(info: PointerInfo): void;
  dragMove?(info: PointerInfo): void;
  dragEnd?(info: PointerInfo | undefined, cancelled: boolean): void;
  /** A press the editor took as a click came up without moving. */
  tap?(info: PointerInfo): void;
  /** A double click on the paper. */
  doubleClick?(info: PointerInfo): void;
}

export interface NotebookCanvasProps {
  ref?: Ref<CanvasHandle>;
  schematic: Schematic;
  results: DrawingResults;
  /** The numbers are from an earlier text: written in pencil until ngspice answers. */
  pending?: boolean;
  /** What screen readers hear before such numbers (default "Before your last change:"; several changes while building say so). */
  pendingWords?: string;
  /** Results in the plain font instead of handwriting (settings.ts). */
  plain: boolean;
  /**
   * Each node's colour (ground is drawn in ink). Default: assignNodeColours over the netlist's nodes;
   * a page passes its own so the drawing, the netlist and the tables agree.
   */
  colours?: ReadonlyMap<string, string> | undefined;
  /** The drawing's accessible name (the group of its parts and nodes). */
  label: string;
  /** The picture's own name (default: the same as `label`). */
  pictureLabel?: string;
  /** The circuit in words (navigate.ts: describeSchematic). */
  description: string;
  selected: NavItem | undefined;
  /** Items tied to the selected one, highlighted lightly. */
  related?: readonly NavItem[] | undefined;
  /** Parts a check found a trap on. */
  traps?: ReadonlySet<string> | undefined;
  /**
   * What the red pen says beside a part or a node (a check's title, "No single answer at node n1"),
   * by item key ('part:r1', 'node:n1'): read after its description, since the pen is a picture.
   */
  penWords?: ReadonlyMap<string, string> | undefined;
  /** The part whose card is open (its button says the card is expanded). */
  open?: string | undefined;
  onSelect: (item: NavItem | undefined) => void;
  /** Enter, or a click on a part: open it (the page shows its card). */
  onOpen: (item: NavItem) => void;
  /** Escape on the drawing. */
  onEscape?: () => void;
  /** Screen pixels the page covers on each side. */
  insets: Insets;
  /** Fit again whenever this changes (another circuit, "Fit to screen"). */
  fitKey: string;
  minUnit: number;
  maxUnit: number;
  /** Paper kept free around the drawing when it is fitted, in pixels (default 24). */
  padding?: number;
  /** What to keep in view when the whole drawing does not fit and nothing is selected (grid units). */
  focus?: Box | undefined;
  /** A part tool in hand with no editor (the checkpoint page): its ghost follows the pointer over the paper. */
  ghost?: GhostKind | undefined;
  /** The schematic editor: what presses, drags and the pointer over the paper mean (decision 0017). */
  editing?: CanvasEditing | undefined;
  /** What the editor shows over the drawing: the part in hand, a wire on its way, where wires can end, a piece of wire selected. */
  marks?: EditMarks | undefined;
  /** What the pointer does now, for its look: choosing and moving ('select'), placing a part, drawing a wire, putting a picked-up part down. */
  mode?: 'select' | 'place' | 'wire' | 'move';
  /** The arrow keys belong to the editor (a part picked up with the keyboard): the drawing's moves along the wires wait. */
  arrowsTaken?: boolean;
  /** The selected item keeps the focus but not its highlight (a piece of its wire is selected and marked instead). */
  quietSelection?: boolean;
  /** How to use the drawing from the keyboard (the description of its group of buttons). */
  keysHelp?: string;
  /** What screen readers call the drawing's buttons together ("circuit drawing"). */
  roleDescription?: string;
  /** 'height': a wide drawing as tall as the window allows, read from its left end (fit.ts). */
  fill?: 'whole' | 'height';
  /**
   * Fit the whole drawing, smaller than its words' readable size (`minUnit`) if it must be, down to
   * WHOLE_MIN_UNIT: the reader asked to see it whole (Fit), or a phone shows it whole while it is
   * edited. Zooming out never goes past the size the view has then.
   */
  fitWhole?: boolean;
  /** Fit this part of the drawing (grid units) instead of all of it: a phone's view while a value is typed. */
  frame?: Box | undefined;
  /** A pan the page asks for while the view follows the fit (room for a card), in pixels. */
  offset?: { x: number; y: number } | undefined;
  /** Red pen on the drawing: notes, crossed-out values, circled values (notes.ts). */
  pen?: PenMarks | undefined;
  /**
   * Keep the view while the drawing's words change (a value being typed): no fit again for a
   * drawing a little wider or narrower than before, nor for the page's bars changing size; only for
   * a new window size, frame or fitKey.
   */
  hold?: boolean;
  onView?: (info: CanvasViewInfo) => void;
  /** Screen-space content drawn over the paper (the page's index card), given where the drawing is. */
  overlay?: (info: CanvasViewInfo) => ReactNode;
  className?: string;
}

const PADDING = 24;
/** How long a finger holds still on a part before it lifts and can be dragged (shorter, it is a tap; moved sooner, a pan). */
export const LONG_PRESS_MS = 350;
/** After the page moves the drawing (a card makes room), presses are not taken for this long: about a double click's time. */
export const PAGE_MOVE_QUIET_MS = 450;
/** A move of the page this soon after a press is that press's doing (its card opened); a later one (an undo, Esc) is not. */
const CAUSED_BY_PRESS_MS = 250;
/** Insets that move less than this while the view is held are the page's bars resizing, not a new sheet. */
const HOLD_SLACK = 48;
const MIN_TARGET_PX = 28;

/** Where an item is on the drawing (grid units): a part's symbol, a node's name, ground's first symbol. */
export function itemBox(s: Schematic, item: NavItem): Box | undefined {
  if (item.kind === 'part') return s.scene.parts.find((p) => p.key === item.key)?.box;
  if (item.name === GROUND) return s.scene.grounds[0]?.box;
  return s.scene.nodeLabels.find((l) => l.node === item.name)?.box;
}

/** What is drawn (grid units): the symbols, the words and results as written (not the room kept for longer ones), the wires. */
export function inkBox(scene: Scene, results: DrawingResults): Box | undefined {
  const wires = scene.wires.flatMap((w) => w.points.map((p) => ({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })));
  return unionBoxes([...symbolBoxes(scene), ...inkBoxes(scene, results), ...wires]);
}

const grow = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });

/** Two sets of insets are the same page around the paper, give or take its bars resizing (HOLD_SLACK). */
const nearInsets = (a: Insets, b: Insets): boolean => Math.max(Math.abs(a.top - b.top), Math.abs(a.right - b.right), Math.abs(a.bottom - b.bottom), Math.abs(a.left - b.left)) <= HOLD_SLACK;

const ARROW_KEYS: Readonly<Record<string, 'up' | 'down' | 'left' | 'right'>> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

const sameView = (a: View | undefined, b: View): boolean => !!a && Math.abs(a.unit - b.unit) < 1e-6 && Math.abs(a.x - b.x) < 0.25 && Math.abs(a.y - b.y) < 0.25;

export function NotebookCanvas(props: NotebookCanvasProps): ReactNode {
  const { ref, schematic: s, results, selected, onSelect, onOpen, fitKey, minUnit, maxUnit, padding } = props;
  // Insets and boxes come as fresh objects on every render of the page: keep one while it stays equal.
  const { top, right, bottom, left } = props.insets;
  const insets = useMemo((): Insets => ({ top, right, bottom, left }), [top, right, bottom, left]);
  const f = props.focus;
  const [fx0, fy0, fx1, fy1] = f ? [f.x0, f.y0, f.x1, f.y1] : [NaN, NaN, NaN, NaN];
  const focusBox = useMemo((): Box | undefined => (Number.isNaN(fx0) ? undefined : { x0: fx0, y0: fy0, x1: fx1, y1: fy1 }), [fx0, fy0, fx1, fy1]);
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const descId = useId();
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<View | undefined>(undefined);
  const [hovered, setHovered] = useState<NavItem | undefined>(undefined);
  const [focused, setFocused] = useState<NavItem | undefined>(undefined);
  /** Where a ghost (`ghost`, no editor) follows the pointer, in grid units. */
  const [ghostAt, setGhostAt] = useState<Point | undefined>(undefined);
  /** Follow the fit until the reader pans or zooms. */
  const auto = useRef(true);
  const [moved, setMoved] = useState(false);
  const lastFitKey = useRef<string | undefined>(undefined);
  const ox = props.offset?.x ?? 0;
  const oy = props.offset?.y ?? 0;
  const offsetRef = useRef({ x: ox, y: oy });
  /** When the page last moved the drawing itself (a pan to make room for a card): a click just after it was aimed at where things were. */
  const pageMovedAt = useRef(0);
  // A key pressed since: the student is doing something else, and their next click is aimed anew.
  useEffect(() => {
    const onKey = (): void => {
      pageMovedAt.current = 0;
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);
  useLayoutEffect(() => {
    const was = offsetRef.current;
    offsetRef.current = { x: ox, y: oy };
    // Only while the view follows the fit is the offset drawn (a view the reader or an edit holds stays).
    if ((was.x === ox && was.y === oy) || !auto.current) return undefined;
    // The page's pan slides, so the eye follows it (no slide where motion is reduced: app.css), and
    // the pointer's next press within a moment is not taken (WCAG 3.2.1: nothing moves under a click).
    pageMovedAt.current = performance.now();
    const el = rootRef.current;
    el?.classList.add('is-sliding');
    const timer = window.setTimeout(() => el?.classList.remove('is-sliding'), 240);
    return () => window.clearTimeout(timer);
  }, [ox, oy]);
  const fr = props.frame;
  const [rx0, ry0, rx1, ry1] = fr ? [fr.x0, fr.y0, fr.x1, fr.y1] : [NaN, NaN, NaN, NaN];
  const frame = useMemo((): Box | undefined => (Number.isNaN(rx0) ? undefined : { x0: rx0, y0: ry0, x1: rx1, y1: ry1 }), [rx0, ry0, rx1, ry1]);
  const fill = props.fill ?? 'whole';
  const fitWhole = !!props.fitWhole;

  const given = props.colours;
  const colours = useMemo(() => given ?? assignNodeColours(s.netlist.nodes.keys()), [given, s.netlist]);
  const order = useMemo(() => readingOrder(s), [s]);
  const items = useMemo(() => order.map((item) => ({ item, box: itemBox(s, item) })).filter((x): x is { item: NavItem; box: Box } => x.box !== undefined), [order, s]);
  const bounds = s.scene.bounds;
  const ink = useMemo(() => inkBox(s.scene, results), [s, results]);

  // The window's size.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const measure = (): void => setSize((old) => (old.width === el.clientWidth && old.height === el.clientHeight ? old : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selectedBox = selected ? itemBox(s, selected) : undefined;
  const fitNow = useCallback((): View => {
    const focus = frame ? undefined : selectedBox ? grow(selectedBox, 2.5) : focusBox;
    // Asked for whole: as small as that takes (down to WHOLE_MIN_UNIT), words readable or not.
    const lo = fitWhole && !frame ? Math.min(minUnit, WHOLE_MIN_UNIT) : minUnit;
    const f = fitView(frame ?? bounds, size, insets, { padding: padding ?? PADDING, minUnit: lo, maxUnit, fill: frame || fitWhole ? 'whole' : fill, ...(focus ? { focus } : {}) });
    return { unit: f.unit, x: f.x, y: f.y };
  }, [bounds, size, insets, minUnit, maxUnit, padding, selectedBox, focusBox, frame, fill, fitWhole]);
  const applyFit = useCallback((): void => {
    const f = fitNow();
    setView((v) => (sameView(v, f) ? v : f));
  }, [fitNow]);

  // Fit when the window, the insets, the drawing or fitKey change, unless the reader moved the view
  // (or the page holds it: a value is being typed); otherwise only bring the selected item into the
  // free part of the window.
  const lastInputs = useRef('');
  const heldInsets = useRef<Insets | undefined>(undefined);
  /** The view as it is drawn now (for the effect below, which must not run again on every pan). */
  const viewRef = useRef<View | undefined>(undefined);
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);
  /**
   * The view was moved to keep the selected item clear of a sheet or panel that arrived: the insets
   * before it came (`home`), the view then (`from`) and the view this left (`to`). When the insets
   * are back (the sheet has gone) and nothing else has moved the view since, it goes back.
   */
  const sheetShift = useRef<{ home: Insets; from: View; to: View } | undefined>(undefined);
  const hold = !!props.hold;
  const hasView = view !== undefined;
  useLayoutEffect(() => {
    if (!size.width || !size.height) return;
    if (lastFitKey.current !== fitKey) {
      lastFitKey.current = fitKey;
      auto.current = true;
      setMoved(false);
    }
    // While held, only a new window size, frame or fitKey fits again, or a sheet or panel arriving: not
    // the drawing's words, nor the page's own bars growing or shrinking a little (a status line that wraps).
    const inputs = JSON.stringify([size, fitKey, frame, fill, fitWhole, minUnit, maxUnit, padding]);
    const same = inputs === lastInputs.current;
    lastInputs.current = inputs;
    const was = heldInsets.current;
    const insetsMoved = !was || !nearInsets(was, insets);
    if (auto.current) {
      sheetShift.current = undefined;
      if (hold && same && hasView && !insetsMoved) return;
      heldInsets.current = insets;
      applyFit();
      return;
    }
    heldInsets.current = insets;
    /** The view moved just enough to bring the selected item into the free part of the window (the view itself when it is there). */
    const intoView = (v: View): View => {
      if (!selectedBox) return v;
      const b = grow(selectedBox, 1);
      const sx0 = v.x + b.x0 * v.unit;
      const sx1 = v.x + b.x1 * v.unit;
      const sy0 = v.y + b.y0 * v.unit;
      const sy1 = v.y + b.y1 * v.unit;
      const fx0 = insets.left + 8;
      const fx1 = size.width - insets.right - 8;
      const fy0 = insets.top + 8;
      const fy1 = size.height - insets.bottom - 8;
      // An item larger than the free part (zoomed in on it) stays where the reader put it: moving it
      // to show one edge would hide the other, and the next look would move it back.
      const dx = sx1 - sx0 > fx1 - fx0 ? 0 : sx0 < fx0 ? fx0 - sx0 : sx1 > fx1 ? fx1 - sx1 : 0;
      const dy = sy1 - sy0 > fy1 - fy0 ? 0 : sy0 < fy0 ? fy0 - sy0 : sy1 > fy1 ? fy1 - sy1 : 0;
      return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
    };
    const now = viewRef.current;
    if (!now) return;
    // A move made since by anything else (the reader's pan or zoom, a part revealed) stays: no going back.
    let shift = sheetShift.current && sameView(now, sheetShift.current.to) ? sheetShift.current : undefined;
    let next: View;
    if (shift && nearInsets(insets, shift.home)) {
      // The sheet has gone: back to where the drawing was before it came (the selected item still in
      // view), at once rather than sliding, so a tap made just after (a pin, once Wire is chosen in the
      // sheet) lands on what is under it.
      next = intoView(shift.from);
      shift = undefined;
      const world = worldRef.current;
      if (world) {
        world.style.transition = 'none';
        requestAnimationFrame(() => requestAnimationFrame(() => world.style.removeProperty('transition')));
      }
    } else {
      next = intoView(now);
      // A sheet or a panel arrived and the item was moved clear of it (or moved again while it is there): remembered.
      if (next !== now && (shift || (insetsMoved && was))) shift = { home: shift?.home ?? was!, from: shift?.from ?? now, to: next };
    }
    sheetShift.current = shift;
    if (next !== now) setView((v) => (v && sameView(v, now) ? next : v ? intoView(v) : v));
    // Not on every change of the view: the reader's own pan and zoom are not undone while an item is selected.
  }, [size, insets, fitKey, applyFit, selectedBox, hold, frame, fill, fitWhole, minUnit, maxUnit, padding, hasView]);

  // What is drawn: the fitted view, panned by the page's offset while it follows the fit.
  const shown = useMemo((): View | undefined => (view && !moved && (ox || oy) ? { unit: view.unit, x: view.x + ox, y: view.y + oy } : view), [view, moved, ox, oy]);
  const shownRef = useRef<View | undefined>(undefined);
  useLayoutEffect(() => {
    shownRef.current = shown;
  }, [shown]);
  // Whole when everything drawn is in the free part of the window (fit.ts: inkInView), wherever the fit or the reader put it.
  // The page hears of it when that changes, not each time its bars change size (each run): its render must not lag the pointer.
  const whole = !ink || !shown || inkInView(shown, ink, size, insets);
  // And whether the fit itself shows all of it (the page's words for the view: "turned to fit the screen", or "drag").
  const fits = useMemo(() => !ink || !size.width || !size.height || inkInView(fitNow(), ink, size, insets), [ink, size, insets, fitNow]);
  const info = useMemo((): CanvasViewInfo | undefined => (shown && view ? { unit: shown.unit, whole, fits, view: shown, base: view, size, moved } : undefined), [shown, view, whole, fits, size, moved]);
  const { onView } = props;
  useEffect(() => {
    if (info) onView?.(info);
  }, [info, onView]);

  /** What a pan or a zoom must keep in view: the drawing's ink, in the free part of the window as it is now. */
  const keepRef = useRef<{ ink: Box | undefined; size: Size; insets: Insets }>({ ink: undefined, size, insets });
  useLayoutEffect(() => {
    keepRef.current = { ink, size, insets };
  }, [ink, size, insets]);
  /**
   * The reader moves the view (a drag, a scroll, a zoom), or the page does for them (`keep` false: a
   * part revealed, which may be in hand away from the drawing, is shown wherever it is).
   */
  const moveView = useCallback((next: (v: View) => View, keep = true): void => {
    // However far the reader drags or zooms, some of the drawing stays on the screen (fit.ts: keepInView).
    const kept = (v: View): View => {
      const k = keepRef.current;
      return keep && k.ink && k.size.width && k.size.height ? keepInView(v, k.ink, k.size, k.insets) : v;
    };
    if (auto.current) {
      // The reader takes over: the page's pan becomes part of the view.
      const o = offsetRef.current;
      auto.current = false;
      setMoved(true);
      setView((v) => (v ? kept(next({ ...v, x: v.x + o.x, y: v.y + o.y })) : v));
    } else setView((v) => (v ? kept(next(v)) : v));
  }, []);

  /**
   * How far the reader may zoom, however they zoom (the buttons, Ctrl + wheel, two fingers): out to half
   * the words' readable size, in to two and a half times the largest fit; never a jump from a view
   * already outside those (a drawing fitted whole, smaller than that).
   */
  const zoomLimits = useCallback((v: View): { minUnit: number; maxUnit: number } => ({ minUnit: Math.min(minUnit * 0.5, v.unit), maxUnit: Math.max(maxUnit * 2.5, v.unit) }), [minUnit, maxUnit]);

  const focusItem = useCallback(
    (item: NavItem): void => {
      const b = buttons.current.get(itemKey(item));
      b?.focus({ preventScroll: true });
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      focusItem,
      fit() {
        auto.current = true;
        setMoved(false);
        applyFit();
      },
      zoomBy(factor: number) {
        const cx = (insets.left + size.width - insets.right) / 2;
        const cy = (insets.top + size.height - insets.bottom) / 2;
        moveView((v) => zoomAt(v, factor, { x: cx, y: cy }, zoomLimits(v)));
      },
      panBy(dx: number, dy: number) {
        moveView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      },
      viewNow() {
        return shownRef.current;
      },
      showView(v: View) {
        auto.current = false;
        setMoved(true);
        setView((old) => (sameView(old, v) ? old : v));
      },
      reveal(box: Box, extraBottom = 0) {
        if (!size.width || !shownRef.current) return;
        // Measured against the view as it is when the change is made (several moves can come before
        // the page draws again: each must not pan for the same distance again).
        moveView((v) => {
          const b = grow(box, 0.5);
          const sx0 = v.x + b.x0 * v.unit;
          const sx1 = v.x + b.x1 * v.unit;
          const sy0 = v.y + b.y0 * v.unit;
          const sy1 = v.y + b.y1 * v.unit;
          const fx0 = insets.left + 8;
          const fx1 = size.width - insets.right - 8;
          const fy0 = insets.top + 8;
          const fy1 = size.height - insets.bottom - extraBottom - 8;
          const dx = sx1 - sx0 > fx1 - fx0 ? 0 : sx0 < fx0 ? fx0 - sx0 : sx1 > fx1 ? fx1 - sx1 : 0;
          const dy = sy1 - sy0 > fy1 - fy0 ? 0 : sy0 < fy0 ? fy0 - sy0 : sy1 > fy1 ? fy1 - sy1 : 0;
          return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
        }, false);
      },
      keep() {
        if (!auto.current) return;
        // The page's pan becomes part of the view, so nothing moves now.
        const o = offsetRef.current;
        auto.current = false;
        setMoved(true);
        setView((v) => (v ? { ...v, x: v.x + o.x, y: v.y + o.y } : v));
      },
    }),
    [focusItem, applyFit, insets, size, moveView, zoomLimits],
  );

  // Wheel: Ctrl (or a trackpad pinch) zooms about the pointer; otherwise the paper scrolls. A native
  // listener, since React's wheel listener cannot stop the page from scrolling.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0045);
        moveView((v) => zoomAt(v, factor, { x: e.clientX - r.left, y: e.clientY - r.top }, zoomLimits(v)));
      } else moveView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    // The paper never scrolls: a part's button that gets the focus near an edge would otherwise
    // scroll it sideways under the drawing's own view (browsers without overflow: clip).
    const onScroll = (): void => {
      if (el.scrollLeft || el.scrollTop) {
        el.scrollLeft = 0;
        el.scrollTop = 0;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', onScroll);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', onScroll);
    };
  }, [moveView, zoomLimits]);

  // Dragging the paper pans; two fingers pinch to zoom; a tap on empty paper lets go of the selection.
  // The editor may take a press (a part to drag, a click to place a part or end a wire).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ id: number; x: number; y: number; moved: boolean; claim: PressClaim; info: PointerInfo; dragging: boolean; button: boolean; timer?: number | undefined } | undefined>(undefined);
  const pinch = useRef<{ d: number } | undefined>(undefined);
  /**
   * The pointer gesture that just ended was the editor's (a tap, a drag), or a press set aside (a pan, a
   * press just after the page moved the drawing): the click the browser sends after it, on a drawing
   * item's button, belongs to that gesture and is not acted on again, however long the edit took. (A
   * time limit of 400 ms let a slow phone's click through: a wire's end was taken twice, as a refusal or
   * as a new wire.) The next press clears it; a click from the keys (Enter, Space) is always the button's.
   */
  const gestureClick = useRef(false);
  /** The last press, and when: a double click whose second press came after the page moved the drawing belongs to the first one's place. */
  const lastPress = useRef<{ info: PointerInfo; at: number } | undefined>(undefined);
  /**
   * Just after the page moved the drawing because of a click (a card made room), the next press is
   * not taken: it is the second click of a double click, or a click aimed at where things were.
   */
  const pageJustMoved = (): boolean => {
    const now = performance.now();
    const press = lastPress.current;
    // Caused by the press: the page moved the drawing within a moment of it (a card opening on a click).
    return now - pageMovedAt.current < PAGE_MOVE_QUIET_MS && !!press && pageMovedAt.current >= press.at && pageMovedAt.current - press.at < CAUSED_BY_PRESS_MS;
  };
  const editing = props.editing;
  const infoOf = (e: { clientX: number; clientY: number; shiftKey: boolean; pointerType?: string }, item?: NavItem): PointerInfo | undefined => {
    const el = rootRef.current;
    if (!el || !shown) return undefined;
    const r = el.getBoundingClientRect();
    return { at: { x: (e.clientX - r.left - shown.x) / shown.unit, y: (e.clientY - r.top - shown.y) / shown.unit }, item, shift: e.shiftKey, pointer: e.pointerType || 'mouse', unit: shown.unit };
  };
  const itemOf = (target: Element): NavItem | undefined => {
    const key = target.closest<HTMLElement>('.nb-hit')?.dataset['item'];
    return key ? items.find((x) => itemKey(x.item) === key)?.item : undefined;
  };
  const endGesture = (cancelled: boolean, info?: PointerInfo): void => {
    const g = gesture.current;
    gesture.current = undefined;
    if (g?.timer !== undefined) window.clearTimeout(g.timer);
    if (g?.dragging) {
      gestureClick.current = true;
      editing?.dragEnd?.(info, cancelled);
    }
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    // A new gesture: the click of the last one has come (or never will).
    gestureClick.current = false;
    const target = e.target as Element;
    // The card over the paper, and the page's own controls, keep their pointer.
    if (target.closest('a, input, select, textarea, [data-nb-own-pointer], .nb-anchored')) return;
    const onButton = target.closest('.nb-hit');
    if (target.closest('button') && !onButton) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // A second finger: a pinch, never a drag, and no click for the button the first finger is on.
      endGesture(true);
      gestureClick.current = true;
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const info = infoOf(e, onButton ? itemOf(onButton) : undefined);
    if (pageJustMoved()) {
      pointers.current.delete(e.pointerId);
      gestureClick.current = true;
      return;
    }
    if (info) lastPress.current = { info, at: performance.now() };
    let claim = info && editing ? editing.press(info) : undefined;
    // A finger: a part's words are no handle (a finger meant to pan picked parts up, critique of step
    // B); they are still a tap.
    const touch = e.pointerType === 'touch';
    if (touch && claim === 'drag-tap') claim = 'tap';
    // A press on an item's button that the editor does not take (a part of the turned view, which is
    // another drawing) is that button's own click while it holds still. Once it moves it pans the
    // paper, as from empty paper, and a second finger makes it a pinch (decision 0017: a finger that
    // moves pans): it is followed, not captured yet (onPointerMove).
    if (!info) return;
    const g: NonNullable<typeof gesture.current> = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, claim, info, dragging: false, button: !!onButton };
    gesture.current = g;
    // A finger picks a part up only by holding still on its symbol for a moment (the part lifts: the
    // drag starts, and a phone that can buzzes); moved sooner, it pans the paper.
    if (touch && claim === 'drag') {
      const el = e.currentTarget;
      const id = e.pointerId;
      g.timer = window.setTimeout(() => {
        g.timer = undefined;
        if (gesture.current !== g || g.moved || g.dragging) return;
        g.dragging = true;
        try {
          el.setPointerCapture(id);
        } catch {
          // The pointer may be gone already.
        }
        editing?.dragStart?.(g.info);
        navigator.vibrate?.(12);
      }, LONG_PRESS_MS);
    }
    // Captured now unless the press may still be its button's click (the click would land on the paper instead).
    if (!onButton) e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = rootRef.current;
    if (e.buttons === 0 && e.pointerType !== 'touch' && !(e.target as Element).closest('.nb-anchored')) {
      const info = infoOf(e);
      if (info && editing?.hover) editing.hover(info);
      if (info && props.ghost) setGhostAt({ x: Math.round(info.at.x), y: Math.round(info.at.y) });
    }
    if (!pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2 && el) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = el.getBoundingClientRect();
      const factor = d / Math.max(1, pinch.current.d);
      pinch.current = { d };
      moveView((v) => zoomAt(v, factor, { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }, zoomLimits(v)));
      return;
    }
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < (e.pointerType === 'touch' ? 8 : 4)) return;
    // A press on a button that nobody took, moving: a pan of the paper from now on, and the button gets no click.
    if (!g.moved && g.button && g.claim === undefined) {
      gestureClick.current = true;
      try {
        el?.setPointerCapture(e.pointerId);
      } catch {
        // The pointer may be gone already.
      }
    }
    g.moved = true;
    // A finger that moves before the part lifts pans the paper (and the part's button gets no click).
    if (e.pointerType === 'touch' && g.claim === 'drag' && !g.dragging) {
      if (g.timer !== undefined) window.clearTimeout(g.timer);
      g.timer = undefined;
      g.claim = undefined;
      gestureClick.current = true;
      try {
        el?.setPointerCapture(e.pointerId);
      } catch {
        // The pointer may be gone already.
      }
    }
    if (g.claim === 'drag' || g.claim === 'drag-tap') {
      const info = infoOf(e, g.info.item);
      if (!info) return;
      if (!g.dragging) {
        g.dragging = true;
        el?.setPointerCapture(e.pointerId);
        editing?.dragStart?.(g.info);
      }
      editing?.dragMove?.(info);
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    moveView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = undefined;
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (g.timer !== undefined) {
      window.clearTimeout(g.timer);
      g.timer = undefined;
    }
    if (g.dragging) {
      endGesture(false, infoOf(e, g.info.item));
      return;
    }
    gesture.current = undefined;
    if (g.moved) return;
    if (g.claim === 'tap' || g.claim === 'drag-tap') {
      gestureClick.current = true;
      editing?.tap?.({ ...g.info, shift: e.shiftKey || g.info.shift });
    } else if (!g.button) onSelect(undefined);
  };
  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = undefined;
    if (gesture.current?.id === e.pointerId) endGesture(true);
  };

  // Words for screen readers.
  const kindOf = (letter: PartLetter): string => elementInfo(letter)?.name ?? letter;
  const nameOf = (item: NavItem): string => {
    if (item.kind === 'part') {
      const p = s.scene.parts.find((x) => x.key === item.key);
      return p ? NOTEBOOK_STRINGS.partButton(p.name, kindOf(p.letter)) : item.key;
    }
    if (item.name === GROUND) return NOTEBOOK_STRINGS.groundButton;
    return NOTEBOOK_STRINGS.nodeButton(s.circuit.nodes.get(item.name)?.text ?? item.name);
  };
  const resultsOf = (item: NavItem): string => {
    // Numbers from before the last change say so: a screen reader must not take them for answers.
    const before = props.pending ? `${props.pendingWords ?? NOTEBOOK_STRINGS.beforeChange} ` : '';
    if (item.kind === 'part') {
      const pm = results.parts.get(item.key);
      // Its own sentence, so it starts with a capital ("No current flows through R2."); after "Before your last change:" it goes on as it is.
      const speech = pm && !before ? pm.speech.charAt(0).toUpperCase() + pm.speech.slice(1) : pm?.speech;
      return pm ? `${before}${speech}.` : '';
    }
    const n = results.nodes.find((x) => x.node === item.name);
    if (!n) return '';
    const name = s.circuit.nodes.get(item.name)?.text ?? item.name;
    return `${before}${DESCRIBE_STRINGS.valueIsSpeech(name, n.words.speech)}.`;
  };
  const penOf = (item: NavItem): string => {
    const words = props.penWords?.get(itemKey(item));
    return words ? ` ${NOTEBOOK_STRINGS.check(words.replace(/[.!?:]$/, ''))}.` : '';
  };
  const hasResults = results.parts.size > 0 || results.nodes.length > 0;

  const keyOfFocus = selected ? itemKey(selected) : items[0] ? itemKey(items[0].item) : undefined;

  const moveTo = (item: NavItem | undefined): void => {
    if (!item) return;
    onSelect(item);
    focusItem(item);
  };

  const onItemKey = (e: KeyboardEvent<HTMLButtonElement>, item: NavItem): void => {
    const dir = ARROW_KEYS[e.key];
    // Shift+arrows move the selected item (the editor's), and a part picked up takes the arrows too.
    if (dir && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !props.arrowsTaken) {
      e.preventDefault();
      moveTo(neighbour(s, item, dir));
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      moveTo(e.key === 'Home' ? items[0]?.item : items[items.length - 1]?.item);
      return;
    }
    if (e.key === 'Escape') {
      if (props.onEscape) {
        e.preventDefault();
        props.onEscape();
      }
    }
  };

  const k = shown ? shown.unit / UNIT_PX : 1;
  const worldStyle: CSSProperties & Record<string, string> = shown ? { transform: `translate(${shown.x}px, ${shown.y}px) scale(${k})`, '--nb-k': String(k) } : { visibility: 'hidden' };
  const paperStyle: CSSProperties = shown
    ? {
        ...TYPE_VARS,
        backgroundSize: `${shown.unit * 5}px ${shown.unit * 5}px, ${shown.unit * 5}px ${shown.unit * 5}px, ${shown.unit}px ${shown.unit}px, ${shown.unit}px ${shown.unit}px`,
        backgroundPosition: `${shown.x}px ${shown.y}px`,
      }
    : TYPE_VARS;
  const margin = 4;
  const vb = { x: (bounds.x0 - margin) * UNIT_PX, y: (bounds.y0 - margin) * UNIT_PX, w: (bounds.x1 - bounds.x0 + 2 * margin) * UNIT_PX, h: (bounds.y1 - bounds.y0 + 2 * margin) * UNIT_PX };
  const minTarget = MIN_TARGET_PX / k;

  const mode = props.mode ?? (props.ghost ? 'place' : 'select');
  // The checkpoint's ghost (no editor): the part in hand where the pointer is, upright or lying across.
  const marks: EditMarks | undefined =
    props.marks ?? (props.ghost && ghostAt ? { ghost: { kind: props.ghost, at: ghostAt, rot: props.ghost === 'R' || props.ghost === 'C' || props.ghost === 'L' ? 270 : 0, mirror: false, refused: false, pins: [] } } : undefined);

  return (
    <div
      ref={rootRef}
      className={`nb-canvas${props.pending ? ' is-pending' : ''} is-${mode}${mode === 'place' || mode === 'wire' ? ' is-placing' : ''}${props.className ? ` ${props.className}` : ''}`}
      style={paperStyle}
      // A click on the paper (a piece of wire, empty paper) gives it the focus, so the drawing's keys
      // (Delete, T, the arrows) work on what was clicked; Tab goes on to the drawing's buttons. Not in
      // the Tab order itself (-1): the keyboard has the parts' and nodes' buttons.
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'touch' && !gesture.current) editing?.hover?.(undefined);
        setGhostAt(undefined);
      }}
      onDoubleClick={(e) => {
        if ((e.target as Element).closest('.nb-anchored')) return;
        // The first click opened a card and the page moved the drawing to make room: the double click is
        // about where the first click was, not what has slid under the pointer since.
        const first = lastPress.current;
        const moved = first && pageMovedAt.current > first.at && pageMovedAt.current - first.at < CAUSED_BY_PRESS_MS && performance.now() - pageMovedAt.current < PAGE_MOVE_QUIET_MS * 2;
        const info = moved ? first.info : infoOf({ clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey }, itemOf(e.target as Element));
        if (info) editing?.doubleClick?.(info);
      }}
    >
      <div ref={worldRef} className="nb-world" style={worldStyle}>
        {/* An SVG picture is read by its title and description only with role="img". */}
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
        <svg role="img"
          className="nb-ink"
          aria-labelledby={`${descId}-title`}
          aria-describedby={`${descId}-desc`}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          width={vb.w}
          height={vb.h}
          style={{ left: vb.x, top: vb.y }}
        >
          <title id={`${descId}-title`}>{props.pictureLabel ?? props.label}</title>
          <desc id={`${descId}-desc`}>{props.description}</desc>
          <Drawing schematic={s} results={results} colours={colours} plain={props.plain} selected={props.quietSelection ? undefined : selected} related={props.related ?? []} hovered={mode === 'select' ? hovered : undefined} focused={focused} traps={props.traps ?? EMPTY} pen={props.pen} />
          {marks ? <EditLayer marks={marks} colours={colours} /> : null}
        </svg>
        {/*
          The drawing's parts and nodes, and its own keys (arrows along the wires, T, M, Shift+arrows ...):
          an application to screen readers, so NVDA and JAWS pass those keys to it in focus mode
          instead of taking them as their own reading commands (critique of step B). Each button keeps
          its name and description.
        */}
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an application of buttons, not form fields */}
        <div className="nb-hits" role="application" aria-roledescription={props.roleDescription ?? NOTEBOOK_STRINGS.drawingRole} aria-label={props.label} aria-describedby={`${descId}-keys`}>
          {items.map(({ item, box }) => {
            const key = itemKey(item);
            const pad = item.kind === 'part' ? 0.3 : 0.1;
            const w = Math.max(minTarget, (box.x1 - box.x0 + 2 * pad) * UNIT_PX);
            const h = Math.max(minTarget, (box.y1 - box.y0 + 2 * pad) * UNIT_PX);
            const cx = ((box.x0 + box.x1) / 2) * UNIT_PX;
            const cy = ((box.y0 + box.y1) / 2) * UNIT_PX;
            const isSel = !!selected && itemKey(selected) === key;
            const isPart = item.kind === 'part';
            return (
              <button
                key={key}
                ref={(el) => {
                  if (el) buttons.current.set(key, el);
                  else buttons.current.delete(key);
                }}
                type="button"
                className={`nb-hit nb-hit--${item.kind}`}
                style={{ left: cx - w / 2, top: cy - h / 2, width: w, height: h }}
                tabIndex={key === keyOfFocus ? 0 : -1}
                aria-label={nameOf(item)}
                aria-describedby={`${descId}-${key}`}
                // Selected is where you are, not a state to toggle; a part opens its card (a dialog).
                aria-current={isSel ? 'true' : undefined}
                {...(isPart ? { 'aria-haspopup': 'dialog' as const, 'aria-expanded': props.open === item.key } : {})}
                data-item={key}
                onClick={(e) => {
                  // The pointer gesture before this click was the editor's (a drag, a tap) or was set aside:
                  // done already. A click from the keys (detail 0) is the button's own.
                  if (e.detail !== 0 && gestureClick.current) {
                    gestureClick.current = false;
                    return;
                  }
                  onSelect(item);
                  onOpen(item);
                }}
                onFocus={(e) => {
                  setFocused(focusVisible(e.currentTarget) ? item : undefined);
                  if (!selected || itemKey(selected) !== key) onSelect(item);
                }}
                onBlur={() => setFocused((f) => (f && itemKey(f) === key ? undefined : f))}
                onKeyDown={(e) => onItemKey(e, item)}
                onPointerEnter={() => setHovered(item)}
                onPointerLeave={() => setHovered((h2) => (h2 && itemKey(h2) === key ? undefined : h2))}
              />
            );
          })}
        </div>
      </div>
      {/* Read only through aria-describedby (hidden, so browsing the page does not read them twice). */}
      <div className="nb-sr" hidden>
        <p id={`${descId}-keys`}>{props.keysHelp ?? NOTEBOOK_STRINGS.keys}</p>
        {items.map(({ item }) => (
          <p key={itemKey(item)} id={`${descId}-${itemKey(item)}`}>
            {describeItem(s, item)} {hasResults ? resultsOf(item) : ''}
            {penOf(item)}
          </p>
        ))}
      </div>
      {info && props.overlay ? <div className="nb-anchored">{props.overlay(info)}</div> : null}
    </div>
  );
}

const EMPTY: ReadonlySet<string> = new Set();

/** True when the browser shows a focus ring on the element (the keyboard moved the focus there). */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/** The drawing's font sizes for notebook.css, from measure.ts's TYPE (in the drawing's user units). */
const TYPE_VARS: CSSProperties & Record<string, string> = Object.fromEntries(
  Object.entries(TYPE).map(([role, style]) => [`--nb-size-${role}`, `${Math.round(style.size * UNIT_PX * 100) / 100}px`]),
);
