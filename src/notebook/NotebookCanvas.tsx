/**
 * The Notebook canvas: the circuit on cream grid paper, solved results written on it, fitted to the
 * window, and usable without a mouse. It renders any schematic the model builds (src/schematic,
 * buildSchematic with NOTEBOOK_OPTIONS) with the results placed by results.ts; the page around it
 * owns the netlist, the runs and the panels.
 *
 * - Fit: the whole drawing in the free part of the window (`insets` say what the page covers),
 *   never so small that its words are too small to read (`minUnit`, fit.ts); then the reader can
 *   pan (drag the paper, or scroll) and zoom (Ctrl + wheel, pinch, zoomBy). `fitKey` fits again.
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
 */
import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from 'react';
import { describeItem, neighbour, readingOrder, GROUND, type Box, type NavItem, type PartLetter, type Schematic } from '../schematic/index.ts';
import { DESCRIBE_STRINGS } from '../spice/describe.ts';
import { elementInfo } from '../spice/elements.ts';
import { assignNodeColours } from '../theme/nodes.ts';
import { Drawing, UNIT_PX, itemKey, type PenMarks } from './Drawing.tsx';
import { fitView, zoomAt, type Insets, type Size, type View } from './fit.ts';
import { TYPE } from './measure.ts';
import type { DrawingResults } from './results.ts';
import { NOTEBOOK_STRINGS } from './strings.ts';
import { GROUND_INK, INK } from './symbols.ts';

export interface CanvasHandle {
  /** Move the keyboard focus to an item of the drawing (and bring it into view). */
  focusItem(item: NavItem): void;
  /** Fit the whole drawing to the window again. */
  fit(): void;
  /** Zoom about the middle of the free part of the window. */
  zoomBy(factor: number): void;
  /** Move the drawing by this many pixels (the reader's own pan: the view stops following the fit). */
  panBy(dx: number, dy: number): void;
}

export interface CanvasViewInfo {
  /** Screen pixels per grid unit. */
  unit: number;
  /** The whole drawing is in view. */
  whole: boolean;
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

export interface NotebookCanvasProps {
  ref?: Ref<CanvasHandle>;
  schematic: Schematic;
  results: DrawingResults;
  /** The numbers are from an earlier text: written in pencil until ngspice answers. */
  pending?: boolean;
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
  /** A part tool in hand: its ghost follows the pointer over the paper. */
  ghost?: GhostKind | undefined;
  /** 'height': a wide drawing as tall as the window allows, read from its left end (fit.ts). */
  fill?: 'whole' | 'height';
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
/** Insets that move less than this while the view is held are the page's bars resizing, not a new sheet. */
const HOLD_SLACK = 48;
const MIN_TARGET_PX = 28;

/** Where an item is on the drawing (grid units): a part's symbol, a node's name, ground's first symbol. */
export function itemBox(s: Schematic, item: NavItem): Box | undefined {
  if (item.kind === 'part') return s.scene.parts.find((p) => p.key === item.key)?.box;
  if (item.name === GROUND) return s.scene.grounds[0]?.box;
  return s.scene.nodeLabels.find((l) => l.node === item.name)?.box;
}

const grow = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });

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
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const descId = useId();
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<View | undefined>(undefined);
  const [whole, setWhole] = useState(true);
  const [hovered, setHovered] = useState<NavItem | undefined>(undefined);
  const [focused, setFocused] = useState<NavItem | undefined>(undefined);
  const [ghostAt, setGhostAt] = useState<{ x: number; y: number } | undefined>(undefined);
  /** Follow the fit until the reader pans or zooms. */
  const auto = useRef(true);
  const [moved, setMoved] = useState(false);
  const lastFitKey = useRef<string | undefined>(undefined);
  const ox = props.offset?.x ?? 0;
  const oy = props.offset?.y ?? 0;
  const offsetRef = useRef({ x: ox, y: oy });
  useLayoutEffect(() => {
    offsetRef.current = { x: ox, y: oy };
  }, [ox, oy]);
  const fr = props.frame;
  const [rx0, ry0, rx1, ry1] = fr ? [fr.x0, fr.y0, fr.x1, fr.y1] : [NaN, NaN, NaN, NaN];
  const frame = useMemo((): Box | undefined => (Number.isNaN(rx0) ? undefined : { x0: rx0, y0: ry0, x1: rx1, y1: ry1 }), [rx0, ry0, rx1, ry1]);
  const fill = props.fill ?? 'whole';

  const given = props.colours;
  const colours = useMemo(() => given ?? assignNodeColours(s.netlist.nodes.keys()), [given, s.netlist]);
  const order = useMemo(() => readingOrder(s), [s]);
  const items = useMemo(() => order.map((item) => ({ item, box: itemBox(s, item) })).filter((x): x is { item: NavItem; box: Box } => x.box !== undefined), [order, s]);
  const bounds = s.scene.bounds;

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
  const fitNow = useCallback((): { view: View; whole: boolean } => {
    const focus = frame ? undefined : selectedBox ? grow(selectedBox, 2.5) : focusBox;
    const f = fitView(frame ?? bounds, size, insets, { padding: padding ?? PADDING, minUnit, maxUnit, fill: frame ? 'whole' : fill, ...(focus ? { focus } : {}) });
    const all = frame ? fitView(bounds, size, insets, { padding: padding ?? PADDING, minUnit: f.unit, maxUnit: f.unit }) : f;
    return { view: { unit: f.unit, x: f.x, y: f.y }, whole: all.whole };
  }, [bounds, size, insets, minUnit, maxUnit, padding, selectedBox, focusBox, frame, fill]);
  const applyFit = useCallback((): void => {
    const f = fitNow();
    setView((v) => (sameView(v, f.view) ? v : f.view));
    setWhole(f.whole);
  }, [fitNow]);

  // Fit when the window, the insets, the drawing or fitKey change, unless the reader moved the view
  // (or the page holds it: a value is being typed); otherwise only bring the selected item into the
  // free part of the window.
  const lastInputs = useRef('');
  const heldInsets = useRef<Insets | undefined>(undefined);
  const hold = !!props.hold;
  useLayoutEffect(() => {
    if (!size.width || !size.height) return;
    if (lastFitKey.current !== fitKey) {
      lastFitKey.current = fitKey;
      auto.current = true;
      setMoved(false);
    }
    // While held, only a new window size, frame or fitKey fits again, or a sheet or panel arriving: not
    // the drawing's words, nor the page's own bars growing or shrinking a little (a status line that wraps).
    const inputs = JSON.stringify([size, fitKey, frame, fill, minUnit, maxUnit, padding]);
    const same = inputs === lastInputs.current;
    lastInputs.current = inputs;
    const was = heldInsets.current;
    const insetsMoved = !was || Math.max(Math.abs(was.top - insets.top), Math.abs(was.right - insets.right), Math.abs(was.bottom - insets.bottom), Math.abs(was.left - insets.left)) > HOLD_SLACK;
    if (auto.current) {
      if (hold && same && view && !insetsMoved) return;
      heldInsets.current = insets;
      applyFit();
      return;
    }
    heldInsets.current = insets;
    setView((v) => {
      if (!v || !selectedBox) return v;
      const b = grow(selectedBox, 1);
      const sx0 = v.x + b.x0 * v.unit;
      const sx1 = v.x + b.x1 * v.unit;
      const sy0 = v.y + b.y0 * v.unit;
      const sy1 = v.y + b.y1 * v.unit;
      const fx0 = insets.left + 8;
      const fx1 = size.width - insets.right - 8;
      const fy0 = insets.top + 8;
      const fy1 = size.height - insets.bottom - 8;
      const dx = sx0 < fx0 ? fx0 - sx0 : sx1 > fx1 ? fx1 - sx1 : 0;
      const dy = sy0 < fy0 ? fy0 - sy0 : sy1 > fy1 ? fy1 - sy1 : 0;
      return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
    });
  }, [size, insets, fitKey, applyFit, selectedBox, hold, frame, fill, minUnit, maxUnit, padding, view]);

  // What is drawn: the fitted view, panned by the page's offset while it follows the fit.
  const shown = useMemo((): View | undefined => (view && !moved && (ox || oy) ? { unit: view.unit, x: view.x + ox, y: view.y + oy } : view), [view, moved, ox, oy]);
  const info = useMemo((): CanvasViewInfo | undefined => (shown && view ? { unit: shown.unit, whole, view: shown, base: view, size, moved } : undefined), [shown, view, whole, size, moved]);
  const { onView } = props;
  useEffect(() => {
    if (info) onView?.(info);
  }, [info, onView]);

  const moveView = useCallback((next: (v: View) => View): void => {
    if (auto.current) {
      // The reader takes over: the page's pan becomes part of the view.
      const o = offsetRef.current;
      auto.current = false;
      setMoved(true);
      setView((v) => (v ? next({ ...v, x: v.x + o.x, y: v.y + o.y }) : v));
    } else setView((v) => (v ? next(v) : v));
    setWhole(false);
  }, []);

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
        moveView((v) => zoomAt(v, factor, { x: cx, y: cy }, { minUnit: Math.min(minUnit, v.unit), maxUnit: Math.max(maxUnit * 2, v.unit) }));
      },
      panBy(dx: number, dy: number) {
        moveView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      },
    }),
    [focusItem, applyFit, insets, size, moveView, minUnit, maxUnit],
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
        moveView((v) => zoomAt(v, factor, { x: e.clientX - r.left, y: e.clientY - r.top }, { minUnit: minUnit * 0.5, maxUnit: maxUnit * 2.5 }));
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
  }, [moveView, minUnit, maxUnit]);

  // Dragging the paper pans; two fingers pinch to zoom; a tap on empty paper lets go of the selection.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; moved: boolean } | undefined>(undefined);
  const pinch = useRef<{ d: number } | undefined>(undefined);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if ((e.target as Element).closest('button, a, input, [data-nb-own-pointer]')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) };
    } else drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = rootRef.current;
    if (props.ghost && shown && el) {
      const r = el.getBoundingClientRect();
      setGhostAt({ x: Math.round((e.clientX - r.left - shown.x) / shown.unit), y: Math.round((e.clientY - r.top - shown.y) / shown.unit) });
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
      moveView((v) => zoomAt(v, factor, { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }, { minUnit: minUnit * 0.5, maxUnit: maxUnit * 2.5 }));
      return;
    }
    const dr = drag.current;
    if (!dr) return;
    if (!dr.moved && Math.hypot(e.clientX - dr.x, e.clientY - dr.y) < 4) return;
    dr.moved = true;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    moveView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = undefined;
    const dr = drag.current;
    if (pointers.current.size === 0) {
      drag.current = undefined;
      if (dr && !dr.moved && !props.ghost) onSelect(undefined);
    }
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
    const before = props.pending ? `${NOTEBOOK_STRINGS.beforeChange} ` : '';
    if (item.kind === 'part') {
      const pm = results.parts.get(item.key);
      return pm ? `${before}${pm.speech}.` : '';
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
    if (dir) {
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

  const ghost = props.ghost && ghostAt ? props.ghost : undefined;

  return (
    <div
      ref={rootRef}
      className={`nb-canvas${props.pending ? ' is-pending' : ''}${props.ghost ? ' is-placing' : ''}${props.className ? ` ${props.className}` : ''}`}
      style={paperStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setGhostAt(undefined)}
    >
      <div className="nb-world" style={worldStyle}>
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
          <Drawing schematic={s} results={results} colours={colours} plain={props.plain} selected={selected} related={props.related ?? []} hovered={hovered} focused={focused} traps={props.traps ?? EMPTY} pen={props.pen} />
          {ghost && ghostAt ? <Ghost kind={ghost} at={ghostAt} /> : null}
        </svg>
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the drawing's parts and nodes, not form fields */}
        <div className="nb-hits" role="group" aria-label={props.label} aria-describedby={`${descId}-keys`}>
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
                onClick={() => {
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
        <p id={`${descId}-keys`}>{NOTEBOOK_STRINGS.keys}</p>
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

/** The part in hand while a part tool is chosen: a pale symbol under the pointer (placing comes next). */
function Ghost({ kind, at }: { kind: GhostKind; at: { x: number; y: number } }): ReactNode {
  const style: CSSProperties & Record<string, string> = { '--nb-s': String(UNIT_PX) };
  if (kind === 'ground') {
    return (
      <g className="nb-ghost" transform={`translate(${at.x * UNIT_PX} ${at.y * UNIT_PX}) scale(${UNIT_PX})`} style={style}>
        <path className="nb-sym" d={`${GROUND_INK.lead} ${GROUND_INK.bars}`} />
      </g>
    );
  }
  const ink = INK[kind];
  const rot = kind === 'R' || kind === 'C' || kind === 'L' ? 270 : 0;
  return (
    <g className="nb-ghost" transform={`translate(${at.x * UNIT_PX} ${at.y * UNIT_PX}) rotate(${rot}) scale(${UNIT_PX})`} style={style}>
      <path className="nb-sym" d={`${ink.leads[0]} ${ink.leads[1]} ${ink.body}`} />
      {ink.fill ? <path className="nb-sym-fill" d={ink.fill} /> : null}
    </g>
  );
}
