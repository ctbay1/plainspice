/**
 * PlainSpice, design direction "Notebook": a clickable prototype of the whole app (milestone 2,
 * step 1). The circuit is drawn on the Solved Circuits page and solved by real ngspice through
 * design/prototypes/shared/sim.ts; every number and sentence about the circuit comes from there
 * (solve, check, explain, describe, nodeColours, formatSI) or from the model's number reader
 * (src/spice/numbers.ts) for the slider's values. This file only draws and wires up the UI.
 *
 * Screenshot states (scripts/design-shots.ts): #shot=solved | edit | panels | check, then
 * document.body.dataset.shotReady = '1' once ngspice has answered and the state is drawn.
 */
import {
  check,
  describe,
  dividerNetlist,
  explain,
  FIRST_CIRCUIT,
  formatSI,
  liveSolver,
  nodeColours,
  solve,
  speakSI,
  warmUp,
  type CurrentWords,
  type Divider,
  type LineExplanation,
  type Solution,
  type Trap,
} from '../shared/sim.ts';
import { formatSpiceNumber, readNumber } from '../../../src/spice/numbers.ts';
import { CLOSE, checksCard, esc, explainCard, netlistCard, type ExplainView } from './panels.ts';
import { DEFAULT_ROT, G, KIND_NAME, KIND_SHORT, LEN, bodySpan, drawSymbol, groundPath, polyPath, pxPath, toWorld, toolIcon, type Kind, type Pt, type Rot } from './symbols.ts';

// ------------------------------------------------------------------ DOM

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const app = $('app');
const canvas = $('canvas');
const world = $('world');
const labelsLayer = $('labels');
const overlay = document.getElementById('overlay') as unknown as SVGSVGElement;
const layer = {
  highlight: document.getElementById('layer-highlight') as unknown as SVGGElement,
  wires: document.getElementById('layer-wires') as unknown as SVGGElement,
  flow: document.getElementById('layer-flow') as unknown as SVGGElement,
  parts: document.getElementById('layer-parts') as unknown as SVGGElement,
  arrows: document.getElementById('layer-arrows') as unknown as SVGGElement,
  ghost: document.getElementById('layer-ghost') as unknown as SVGGElement,
};
const inkDesc = $('ink-desc');
const note = $('note');
const inspector = $('inspector');
const palette = $('palette');
const panelsBox = $('panels');
const partsSheet = $('parts-sheet');
const placer = $('placer');
const tip = $('tip');
const hint = $('hint');
const announcer = $('announcer');
const liveEl = $('live');
const liveWord = $('live-word');
const liveDetail = $('live-detail');
const zoomPct = $<HTMLButtonElement>('zoom-fit');
const undoBtn = $<HTMLButtonElement>('undo');
const redoBtn = $<HTMLButtonElement>('redo');
const checksBadge = $('checks-badge');
const toastEl = $('toast');
const toastText = $('toast-text');
const panelEl: Record<PanelId, HTMLElement> = { netlist: $('panel-netlist'), checks: $('panel-checks'), explain: $('panel-explain') };
const tabEl: Record<PanelId, HTMLButtonElement> = { netlist: $('tab-netlist'), checks: $('tab-checks'), explain: $('tab-explain') };

const phoneMq = matchMedia('(max-width: 720px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
const isPhone = (): boolean => phoneMq.matches;

// ------------------------------------------------------------------ the drawing

type Tool = 'select' | 'wire' | Kind;
type PanelId = 'netlist' | 'checks' | 'explain';
type Side = 'top' | 'bottom' | 'left' | 'right';
type Align = Side | 'center' | 'top-start' | 'top-end';
type ValueKey = keyof Divider;
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Part {
  id: string;
  kind: Kind;
  /** Terminal A, in grid cells. */
  a: Pt;
  rot: Rot;
  /** The value as typed (placed parts; the divider's values live in state.values). */
  value: string;
  key?: ValueKey;
  line?: number;
  labelSide: Side;
  flowSide: Side;
  placed: boolean;
  /** The nodes at terminals A and B (the divider's parts): their leads take the node's colour. */
  nodes?: [string, string];
}

/** The first screen: V1 6 V, R1 1k, R2 2k, as in dividerNetlist(). */
const DIVIDER: Part[] = [
  { id: 'V1', kind: 'V', a: [0, 2], rot: 90, value: '', key: 'v1', line: 2, labelSide: 'left', flowSide: 'right', placed: false, nodes: ['in', '0'] },
  { id: 'R1', kind: 'R', a: [2, 0], rot: 0, value: '', key: 'r1', line: 3, labelSide: 'top', flowSide: 'bottom', placed: false, nodes: ['in', 'out'] },
  { id: 'R2', kind: 'R', a: [8, 2], rot: 90, value: '', key: 'r2', line: 4, labelSide: 'right', flowSide: 'left', placed: false, nodes: ['out', '0'] },
];
const [V1P, R1P, R2P] = DIVIDER as [Part, Part, Part];
/** Wires by node, in grid cells. */
const WIRES: { node: string; pts: Pt[] }[] = [
  { node: 'in', pts: [[0, 2], [0, 0], [2, 0]] },
  { node: 'out', pts: [[6, 0], [8, 0], [8, 2]] },
  { node: '0', pts: [[8, 6], [8, 8], [0, 8], [0, 6]] },
];
const GROUND_AT: Pt = [4, 8];
/** Real T-junctions only: a dot on a plain corner reads as a junction to LTspice users. */
const JUNCTIONS: Pt[] = [[4, 8]];
const NODE_AT: Record<string, Pt> = { in: [0, 0], out: [8, 0] };
/** A node's voltage label stands this far above its corner (world px), and reaches this far past it towards R1. */
const CHIP_LIFT = 21;
const CHIP_INSET = 18;
/** The part whose current flows along each node's wire (for the moving current dots). */
const WIRE_CURRENT: Record<string, string> = { in: 'r1', out: 'r2', '0': 'r2' };

const DEFAULT_VALUE: Record<Exclude<Kind, 'GND'>, string> = { R: '1k', C: '1u', L: '1m', V: '5', I: '1m', E: '2', F: '2', G: '1m', H: '1k' };
const UNIT: Record<ValueKey, string> = { v1: 'V', r1: 'Ω', r2: 'Ω' };

/** E24: the standard resistor values, for the slider (100 Ω to 100 kΩ). */
const E24 = [1, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2, 2.2, 2.4, 2.7, 3, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
const R_STEPS: number[] = [];
for (const decade of [100, 1000, 10000]) for (const m of E24) R_STEPS.push(Math.round(m * decade * 1000) / 1000);
R_STEPS.push(100000);
const V_STEPS: number[] = Array.from({ length: 49 }, (_, i) => i / 2);

// ------------------------------------------------------------------ state

interface Snapshot {
  values: Divider;
  placed: Part[];
  wires: { id: string; pts: Pt[] }[];
}

const state = {
  values: { ...FIRST_CIRCUIT } as Divider,
  sol: undefined as Solution | undefined,
  /** The numbers when the value editor opened, so the page can show what moved. */
  before: undefined as Solution | undefined,
  /** The value when the editor opened (a phone gets an "Undo" toast if it changed). */
  editStart: '' as string,
  selected: null as string | null,
  hover: null as string | null,
  tool: 'select' as Tool,
  rot: 0 as Rot,
  panels: new Set<PanelId>(),
  editing: false,
  placed: [] as Part[],
  wires: [] as { id: string; pts: Pt[] }[],
  /** The sticky note goes for good once the editor has been opened, placing has begun, or it was closed. */
  noteHidden: false,
  ghost: null as Pt | null,
  wireDraft: null as Pt[] | null,
  wireCursor: null as Pt | null,
  shot: '' as string,
  copied: false,
  /** Phone sheets: their own height ('auto', up to about 60 % of the screen) or pulled up to 'full'. */
  detent: 'auto' as 'auto' | 'full',
  partsOpen: false,
  /** Where the value editor is pinned, in world px (fixed while it is open). */
  popAnchor: null as Pt | null,
};

const history: Snapshot[] = [];
let historyAt = -1;

const netlist = (): string => dividerNetlist(state.values);

/** The model's sentences for the current netlist (parsing only; ngspice is not needed). */
let modelCache: { text: string; explains: LineExplanation[]; checks: Trap[]; colours: Map<string, string>; words: string } | undefined;
function model(): NonNullable<typeof modelCache> {
  const text = netlist();
  if (modelCache?.text !== text) modelCache = { text, explains: explain(text), checks: check(text), colours: nodeColours(text), words: describe(text) };
  return modelCache;
}

/** A placed part's line as the model would read it: pins a and b (c for the voltage E and G read), F and H read V1. */
function placedLine(p: Part): string {
  const control = p.kind === 'F' || p.kind === 'H' ? ' V1' : p.kind === 'E' || p.kind === 'G' ? ' c 0' : '';
  return `${p.id} a b${control} ${p.value}`;
}
const placedExplainCache = new Map<string, LineExplanation | undefined>();
/**
 * A placed part's line explained by the model. It is not wired into the divider yet, so it is read
 * as one more line of the divider's netlist (so F and H find V1, the source whose current they read).
 */
function placedExplain(p: Part): LineExplanation | undefined {
  const line = placedLine(p);
  if (!placedExplainCache.has(line)) {
    const base = dividerNetlist(FIRST_CIRCUIT).split('\n');
    const text = [...base.slice(0, 4), line, ...base.slice(4)].join('\n');
    placedExplainCache.set(line, explain(text).find((e) => e.line === 5));
  }
  return placedExplainCache.get(line);
}

/** The value field of an explained line (value, gain, current, amps per volt, volts per amp). */
function valueField(ex: LineExplanation | undefined): LineExplanation['fields'][number] | undefined {
  return ex?.fields.find((f) => !/name|node|source/.test(f.label) && f.label !== 'name');
}

/** What a part's value means, in the model's words ("1 kΩ", "6 V", "1 mΩ (milli!)"). */
function valueMeaning(p: Part): string {
  const ex = p.placed ? placedExplain(p) : model().explains.find((e) => e.line === p.line);
  const field = valueField(ex);
  return field?.meaning || field?.text || (p.key ? state.values[p.key] : p.value);
}

/** The short value written on the drawing: the model's meaning, or for E–H its field and number ("gain 2", "1 mA/V"). */
function shortValue(p: Part): string {
  if (!p.placed) return valueMeaning(p);
  const field = valueField(placedExplain(p));
  const n = readNumber(p.value);
  switch (p.kind) {
    case 'E':
    case 'F':
      return field ? `${field.label} ${field.text}` : p.value;
    case 'G':
      return n ? formatSI(n.value, 'A/V') : p.value;
    case 'H':
      return n ? formatSI(n.value, 'V/A') : p.value;
    default:
      return field?.meaning || p.value;
  }
}

/** One line about a controlled source for its tooltip and the phone's parts sheet, in the model's words. */
function toolLine(kind: Kind): string {
  if (!'EFGH'.includes(kind) || kind === 'GND') return '';
  const p: Part = { id: `${kind}1`, kind, a: [0, 0], rot: 0, value: DEFAULT_VALUE[kind as Exclude<Kind, 'GND'>], labelSide: 'top', flowSide: 'bottom', placed: true };
  const field = valueField(placedExplain(p));
  if (!field) return '';
  const meaning = field.meaning.replace(/^[^:]*:\s*/, '');
  return `Starts at ${field.label === 'gain' ? `gain ${field.text}` : field.text}: ${meaning}.`;
}

const allParts = (): Part[] => [...DIVIDER, ...state.placed];
const partById = (id: string | null | undefined): Part | undefined => (id ? allParts().find((p) => p.id === id) : undefined);
const trapOn = (p: Part): Trap | undefined => (p.line ? model().checks.find((t) => t.line === p.line) : undefined);

/** The divider's values in a netlist that was solved (lines 2 to 4, fourth word). */
function valuesIn(text: string): string[] {
  return text
    .split('\n')
    .slice(1, 4)
    .map((l) => l.trim().split(/\s+/)[3] ?? '');
}

/**
 * Whether a solution's numbers belong to the circuit as written. ngspice still answers when a value
 * is missing (it leaves the part out), but those numbers are not the student's circuit.
 */
function numbersOk(s: Solution | undefined = state.sol): s is Solution {
  return !!s && s.status === 'ok' && valuesIn(s.netlist).every((v) => readNumber(v) !== undefined);
}

// ------------------------------------------------------------------ view: pan, zoom, fit

const view = { tx: 0, ty: 0, z: 1, user: false };
/** On a phone, how far the note and the drawing move down together to sit in the middle. */
let phoneShift = 0;
/** The phone keeps the drawing at a size where the handwriting can be read and parts can be tapped. */
const PHONE_MIN_Z = 0.95;

function applyView(glide = false): void {
  world.classList.toggle('is-gliding', glide && !reducedMotion.matches);
  const tx = Math.round(view.tx * 2) / 2;
  const ty = Math.round(view.ty * 2) / 2;
  world.style.transform = `translate(${tx}px, ${ty}px) scale(${view.z})`;
  app.style.setProperty('--z', String(view.z));
  // Handwriting never gets smaller on screen than at 100 % (up to 1.4× in world units).
  app.style.setProperty('--ls', String(Math.min(1.4, Math.max(1, 1 / view.z))));
  const cell = G * view.z;
  const major = cell * 5;
  canvas.style.backgroundSize = `${major}px ${major}px, ${major}px ${major}px, ${cell}px ${cell}px, ${cell}px ${cell}px`;
  canvas.style.backgroundPosition = `${tx}px ${ty}px`;
  zoomPct.textContent = `${Math.round(view.z * 100)}%`;
  zoomPct.setAttribute('aria-label', `${Math.round(view.z * 100)}%: fit the circuit to the window`);
  placeHits();
  if (glide && !reducedMotion.matches) window.setTimeout(placeScreenThings, 380);
  placeScreenThings();
}

const toScreen = (x: number, y: number): Pt => [view.tx + x * view.z, view.ty + y * view.z];
const toWorldPt = (sx: number, sy: number): Pt => [(sx - view.tx) / view.z, (sy - view.ty) / view.z];

const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const grow = (a: Box, d: number): Box => ({ x0: a.x0 - d, y0: a.y0 - d, x1: a.x1 + d, y1: a.y1 + d });
const meets = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** A part's symbol (with its control pins), in world px. */
function partBox(p: Part): Box {
  if (p.kind === 'GND') {
    const [x, y] = cellPx(p.a);
    return { x0: x - 16, y0: y - 4, x1: x + 16, y1: y + 28 };
  }
  const a = cellPx(p.a);
  const half = HALF[p.kind];
  const pts = [toWorld(a, p.rot, 0, -half), toWorld(a, p.rot, LEN, half)];
  if (p.kind === 'E' || p.kind === 'G') pts.push(toWorld(a, p.rot, 0, 50), toWorld(a, p.rot, LEN, 50));
  return { x0: Math.min(...pts.map((q) => q[0])), y0: Math.min(...pts.map((q) => q[1])), x1: Math.max(...pts.map((q) => q[0])), y1: Math.max(...pts.map((q) => q[1])) };
}

/** The drawing and its labels, in world pixels (measured, so it follows the fonts). */
function contentBox(): Box {
  let box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of allParts()) box = union(box, grow(partBox(p), 20));
  box = union(box, partBox({ id: 'GND', kind: 'GND', a: GROUND_AT, rot: 0, value: '', labelSide: 'right', flowSide: 'left', placed: false }));
  for (const el of labelsLayer.querySelectorAll<HTMLElement>('.lbl')) {
    const b = labelBox(el);
    if (b) box = union(box, b);
  }
  return box;
}

/** On a phone, what to keep in view when the whole drawing does not fit: the selected part and its numbers. */
function focusBox(): Box | undefined {
  const sel = state.selected;
  let p = sel && !sel.startsWith('node:') && sel !== 'GND' ? partById(sel) : undefined;
  if (!p && state.panels.has('checks')) p = DIVIDER.find((x) => trapOn(x));
  if (!p) p = state.editing || state.panels.size ? R1P : undefined;
  if (!p) return undefined;
  let b = partBox(p);
  const keys = [`part:${p.id}`, `flow:${p.id}`, ...(p.nodes ?? []).map((n) => `chip:${n}`), ...(trapOn(p) ? ['trap-note'] : [])];
  for (const k of keys) {
    const e = els.get(k);
    const lb = e ? labelBox(e) : undefined;
    if (lb) b = union(b, lb);
  }
  return grow(b, 10);
}

/** The part of the window the drawing may use: everything not covered by the chrome. */
function freeRect(): Box {
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (isPhone()) {
    const top = 56 + 14 + (noteShown() ? note.offsetHeight + 58 : 0);
    const tabs = tabsShown() ? 46 : 0;
    const bottom = H - (dockHeight() + tabs + sheetHeight() + 12);
    return { x0: 18, y0: top, x1: W - 12, y1: Math.max(top + 140, bottom) };
  }
  let l = 88 + 36;
  let t = 56 + 28;
  let r = W - 40 - 24;
  let b = H - 66;
  if (state.panels.size) r -= panelsBox.offsetWidth || 480;
  if (noteShown()) r -= note.offsetWidth + 64;
  if (state.editing && !inspector.hidden) {
    const w = inspector.offsetWidth;
    // Room for the card as it is, plus its one-line trap message should one appear while typing,
    // so the card never has to move or cover the drawing.
    const h = inspector.offsetHeight + (inspector.querySelector('#insp-trap:empty') ? TRAP_ROOM : 0);
    const side = popSide(partById(state.selected));
    // Above its part the card may rise past the top bar's level where it is clear of its two boxes.
    if (side === 'top') t = Math.max(t, cardSlot((l + r) / 2, w).topLimit + h + 24);
    else if (side === 'left') l += w + 24;
    else if (side === 'right') r -= w + 24;
    else b -= h + 24;
  }
  return { x0: l, y0: t, x1: Math.max(l + 260, r), y1: Math.max(t + 200, b) };
}

function fit(glide = false): void {
  const box = contentBox();
  const free = freeRect();
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const fw = free.x1 - free.x0;
  const fh = free.y1 - free.y0;
  const zFit = Math.min(fw / bw, fh / bh);
  const phone = isPhone();
  const z = phone ? Math.max(PHONE_MIN_Z, Math.min(1.3, zFit)) : Math.max(0.35, Math.min(1.7, zFit));
  view.z = z;
  let tx = free.x0 + (fw - bw * z) / 2 - box.x0 * z;
  let ty = free.y0 + (fh - bh * z) / 2 - box.y0 * z;
  phoneShift = 0;
  if (phone && zFit < z) {
    // Too big to show whole at a readable size: never shrink it; along the axis that does not fit,
    // keep the part that matters in view (the selected part and its numbers) and fill the window.
    const focus = focusBox() ?? { ...box, y1: box.y0 + fh / z };
    const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
    if (bw * z > fw) tx = clamp(free.x0 + (fw - (focus.x1 - focus.x0) * z) / 2 - focus.x0 * z, free.x1 - box.x1 * z, free.x0 - box.x0 * z);
    if (bh * z > fh) ty = clamp(free.y0 + (fh - (focus.y1 - focus.y0) * z) / 2 - focus.y0 * z, free.y1 - box.y1 * z, free.y0 - box.y0 * z);
  } else if (phone) {
    // The drawing sits a little above the middle of the free paper, or right under the note, with
    // the note and the drawing then centred together.
    ty = noteShown() ? free.y0 - box.y0 * z : free.y0 + (fh - bh * z) * 0.4 - box.y0 * z;
    if (noteShown()) {
      const bottom = ty + box.y1 * z;
      phoneShift = Math.max(0, (free.y1 - bottom) / 2);
      ty += phoneShift;
    }
  }
  view.tx = tx;
  view.ty = ty;
  applyView(glide);
}

/** Fit, then fit again once the labels have their new size at the new zoom. */
function refit(glide = false): void {
  if (view.user) {
    placeScreenThings();
    return;
  }
  fit(false);
  fit(glide);
}

/**
 * Labels grow as numbers change (a longer current, a trap note): if anything would now leave the
 * free part of the window, glide out just enough. Never while the value editor is open or a pointer
 * is down, so nothing moves under the hand that is changing a value.
 */
function keepInView(): void {
  // A phone keeps its readable zoom and pans to what matters; it never glides out on its own.
  if (view.user || !booted || state.editing || pointerBusy() || isPhone()) return;
  const box = contentBox();
  const free = freeRect();
  const [l, t] = toScreen(box.x0, box.y0);
  const [r, b] = toScreen(box.x1, box.y1);
  if (l < free.x0 - 2 || t < free.y0 - 2 || r > free.x1 + 2 || b > free.y1 + 2) fit(true);
}

function zoomAt(sx: number, sy: number, factor: number): void {
  const z = Math.max(0.35, Math.min(4, view.z * factor));
  const [wx, wy] = toWorldPt(sx, sy);
  view.z = z;
  view.tx = sx - wx * z;
  view.ty = sy - wy * z;
  view.user = true;
  applyView();
}

const dockHeight = (): number => (isPhone() ? palette.offsetHeight : 0);
const tabsShown = (): boolean => isPhone() && !state.partsOpen && !(state.editing && !inspector.hidden);

// ------------------------------------------------------------------ phone sheets

/** The bottom sheet that is open on a phone (one at a time), if any. */
function sheetEl(): HTMLElement | undefined {
  if (!isPhone()) return undefined;
  if (state.partsOpen) return partsSheet;
  if (state.editing && !inspector.hidden) return inspector;
  const open = PANEL_ORDER.find((id) => state.panels.has(id));
  return open ? panelEl[open] : undefined;
}
function sheetHeight(): number {
  const el = sheetEl();
  return el ? Math.round(el.getBoundingClientRect().height) : 0;
}
/**
 * How tall a phone sheet may be at its own height: whatever leaves room above it for the selected
 * part and its numbers at a readable zoom, between 42 % and 62 % of the screen. Pulled up, it fills
 * the screen.
 */
function sheetCap(): number {
  const H = window.innerHeight;
  const f = focusBox();
  const need = f ? (f.y1 - f.y0) * PHONE_MIN_Z + 20 : 0;
  const cap = H - (56 + 14) - need - (tabsShown() ? 46 : 0) - dockHeight() - 12;
  return Math.round(Math.max(H * 0.42, Math.min(H * 0.62, cap)));
}

/** One place keeps the tabs on the sheet's edge (or back on the dock when no sheet is open). */
function syncSheet(): void {
  if (isPhone()) app.style.setProperty('--sheet-auto', `${sheetCap()}px`);
  const el = sheetEl();
  app.dataset.sheet = !el ? '' : el === inspector ? 'inspector' : el === partsSheet ? 'parts' : 'panel';
  app.dataset.detent = state.detent;
  app.style.setProperty('--sheet-h', `${el ? sheetHeight() : 0}px`);
  requestAnimationFrame(markCovered);
  for (const g of document.querySelectorAll<HTMLButtonElement>('[data-grab]')) {
    g.setAttribute('aria-expanded', String(state.detent === 'full'));
    const what = g.getAttribute('aria-label')?.split(':')[0] ?? 'Sheet';
    g.setAttribute('aria-label', `${what}: ${state.detent === 'full' ? 'make the sheet shorter' : 'make the sheet taller'}`);
  }
}

// ------------------------------------------------------------------ drawing the ink

const cellPx = (c: Pt): Pt => [c[0] * G, c[1] * G];
const partCentre = (p: Part): Pt => toWorld(cellPx(p.a), p.rot, LEN / 2, 0);
const SIDE: Record<Side, Pt> = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
/** How far each symbol reaches to its side of the wire, in world px. */
const HALF: Record<Kind, number> = { R: 9, C: 15, L: 8, V: 20, I: 20, E: 22, F: 22, G: 22, H: 22, GND: 0 };
const HL_BOX: Record<Exclude<Kind, 'GND'>, [number, number, number, number]> = {
  R: [17, -17, 79, 17],
  C: [31, -22, 65, 22],
  L: [17, -15, 79, 11],
  V: [22, -27, 74, 27],
  I: [22, -27, 74, 27],
  E: [6, -29, 90, 54],
  F: [21, -29, 75, 29],
  G: [6, -29, 90, 54],
  H: [21, -29, 75, 29],
};

const f2 = (n: number): string => (Math.round(n * 100) / 100).toString();

/** The colour of a node's ink (ground stays ink, as in the episodes). */
function nodeInk(node: string | undefined): string | undefined {
  return node && node !== '0' ? model().colours.get(node) : undefined;
}

function partSvg(p: Part, extraClass = ''): string {
  if (p.kind === 'GND') {
    const [x, y] = cellPx(p.a);
    return `<g class="part ${extraClass}" data-id="${p.id}"><path class="gnd" d="${groundPath(x, y)}"/>${p.placed ? `<circle class="pin" cx="${x}" cy="${y}" r="3.2"/>` : ''}</g>`;
  }
  const a = cellPx(p.a);
  const d = drawSymbol(p.kind, a, p.rot);
  const tr = `translate(${f2(a[0])} ${f2(a[1])}) rotate(${p.rot})`;
  const trap = trapOn(p) ? ' is-trap' : '';
  const lead = (path: string, node: string | undefined): string => {
    const c = nodeInk(node);
    return `<path class="lead" d="${path}"${c ? ` style="stroke:${c}"` : ''}/>`;
  };
  let pins = '';
  if (p.placed) {
    for (const [lx, ly] of [[0, 0], [LEN, 0], ...(d.control?.pins ?? [])] as Pt[]) {
      const [x, y] = toWorld(a, p.rot, lx, ly);
      pins += `<circle class="pin" cx="${f2(x)}" cy="${f2(y)}" r="3.2"/>`;
    }
  }
  return `<g class="part${p.placed ? ' is-placed' : ''}${trap} ${extraClass}" data-id="${p.id}"><g transform="${tr}">${lead(d.leadA, p.nodes?.[0])}${lead(d.leadB, p.nodes?.[1])}${d.control ? lead(d.control.leads, undefined) : ''}<path class="sym" d="${d.body}"/>${d.bodyFill ? `<path class="sym-fill" d="${d.bodyFill}"/>` : ''}</g>${d.world ? `<path class="sym-signs" d="${d.world}"/>` : ''}${pins}</g>`;
}

function highlightSvg(p: Part): string {
  if (p.kind === 'GND') {
    const [x, y] = cellPx(p.a);
    return `<rect class="hl" data-hl="${p.id}" x="${x - 20}" y="${y - 4}" width="40" height="34" rx="8" transform="rotate(-2 ${x} ${y + 13})"/>`;
  }
  const a = cellPx(p.a);
  const [x0, y0, x1, y1] = HL_BOX[p.kind];
  return `<rect class="hl" data-hl="${p.id}" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="8" transform="translate(${f2(a[0])} ${f2(a[1])}) rotate(${p.rot}) rotate(-1.8 48 0)"/>`;
}

/** Everything that only changes when the drawing changes (not on every run). */
function buildInk(): void {
  const colours = model().colours;
  let hl = '';
  for (const p of allParts()) hl += highlightSvg(p);
  hl += `<rect class="hl" data-hl="GND" x="${GROUND_AT[0] * G - 20}" y="${GROUND_AT[1] * G - 4}" width="40" height="34" rx="8"/>`;
  for (const w of WIRES) hl += `<path class="hl hl-wire" data-hl="node:${w.node}" d="${polyPath(w.pts)}"/>`;
  layer.highlight.innerHTML = hl;

  let wires = '';
  for (const w of WIRES) {
    const colour = colours.get(w.node);
    wires += `<path class="wire" data-node="${w.node}" d="${polyPath(w.pts)}"${colour ? ` style="stroke:${colour}"` : ''}/>`;
  }
  for (const w of state.wires) wires += `<path class="wire is-drawn" d="${polyPath(w.pts)}"/>`;
  for (const j of [...JUNCTIONS, ...placedJunctions()]) wires += `<circle class="junction" cx="${j[0] * G}" cy="${j[1] * G}" r="4.2"/>`;
  // A short leader ties each node's voltage label to its wire.
  for (const [node, at] of Object.entries(NODE_AT)) {
    const [x, y] = cellPx(at);
    wires += `<path class="leader" d="M${x} ${y - CHIP_LIFT}V${y - 5}" style="stroke:${colours.get(node) ?? 'var(--ink)'}"/>`;
  }
  layer.wires.innerHTML = wires;

  let parts = '';
  for (const p of allParts()) parts += partSvg(p);
  parts += partSvg({ id: 'GND', kind: 'GND', a: GROUND_AT, rot: 0, value: '', labelSide: 'right', flowSide: 'left', placed: false });
  layer.parts.innerHTML = parts;
  updateInkState();
}

/** Junction dots where a drawn wire ends on another wire. */
function placedJunctions(): Pt[] {
  const out: Pt[] = [];
  const segs: [Pt, Pt][] = [];
  for (const w of [...WIRES.map((x) => x.pts), ...state.wires.map((x) => x.pts)]) for (let i = 1; i < w.length; i++) segs.push([w[i - 1]!, w[i]!]);
  for (const w of state.wires) {
    for (const end of [w.pts[0]!, w.pts.at(-1)!]) {
      const onInterior = segs.some(([a, b]) => {
        const inX = Math.min(a[0], b[0]) <= end[0] && end[0] <= Math.max(a[0], b[0]);
        const inY = Math.min(a[1], b[1]) <= end[1] && end[1] <= Math.max(a[1], b[1]);
        const isEnd = (a[0] === end[0] && a[1] === end[1]) || (b[0] === end[0] && b[1] === end[1]);
        return inX && inY && !isEnd && (a[0] === b[0] ? end[0] === a[0] : end[1] === a[1]);
      });
      if (onInterior) out.push(end);
    }
  }
  return out;
}

/** Selection and hover: classes only, so the highlighter fades in and out. */
function updateInkState(): void {
  for (const el of layer.highlight.querySelectorAll<SVGElement>('[data-hl]')) {
    const id = el.dataset.hl!;
    el.classList.toggle('is-selected', id === state.selected);
    el.classList.toggle('is-hover', id === state.hover && id !== state.selected);
    el.classList.toggle('is-invite', id === 'R1' && !note.hidden && state.selected !== 'R1');
  }
}

// ------------------------------------------------------------------ currents: amber arrows and moving dots

let flowAnimations: Animation[] = [];
let flowDirection = 0;

function currentOf(p: Part, s: Solution | undefined = state.sol): CurrentWords | undefined {
  return numbersOk(s) ? s.currents.find((c) => c.element === p.id.toLowerCase()) : undefined;
}

/** Where a part's body begins (A) or ends (B), in world px: the current dots run up to it. */
function bodyEdge(p: Part, end: 'A' | 'B'): Pt {
  const [b0, b1] = bodySpan(p.kind as Exclude<Kind, 'GND'>);
  return toWorld(cellPx(p.a), p.rot, end === 'A' ? b0 : b1, 0);
}
/** Each node's wire with its leads, from the part that feeds it to the part it feeds (for V1 positive). */
function flowPaths(): Record<string, Pt[]> {
  return {
    in: [bodyEdge(V1P, 'A'), cellPx([0, 0]), bodyEdge(R1P, 'A')],
    out: [bodyEdge(R1P, 'B'), cellPx([8, 0]), bodyEdge(R2P, 'A')],
    '0': [bodyEdge(R2P, 'B'), cellPx([8, 8]), cellPx([0, 8]), bodyEdge(V1P, 'B')],
  };
}

function renderFlows(): void {
  let arrows = '';
  for (const p of DIVIDER) {
    const c = currentOf(p);
    if (!c || c.value === 0) continue;
    const forward = c.from === p.nodes![0]; // A → B
    const off = HALF[p.kind] + 8;
    const sv = SIDE[p.flowSide];
    const a = cellPx(p.a);
    // In the local frame the side is ±y; find which sign points to the flow side.
    const probe = toWorld(a, p.rot, LEN / 2, 1);
    const centre = partCentre(p);
    const sign = (probe[0] - centre[0]) * sv[0] + (probe[1] - centre[1]) * sv[1] > 0 ? 1 : -1;
    const half = 15;
    const [x1, y1] = toWorld(a, p.rot, LEN / 2 - (forward ? half : -half), sign * off);
    const [x2, y2] = toWorld(a, p.rot, LEN / 2 + (forward ? half : -half), sign * off);
    const ux = Math.sign(x2 - x1);
    const uy = Math.sign(y2 - y1);
    const hx = x2 + ux * 3;
    const hy = y2 + uy * 3;
    const head = `M${f2(hx)} ${f2(hy)}L${f2(hx - ux * 8.5 - uy * 4.6)} ${f2(hy - uy * 8.5 - ux * 4.6)}L${f2(hx - ux * 8.5 + uy * 4.6)} ${f2(hy - uy * 8.5 + ux * 4.6)}Z`;
    arrows += `<path class="flow-arrow" d="M${f2(x1)} ${f2(y1)}L${f2(x2)} ${f2(y2)}"/><path class="flow-head" d="${head}"/>`;
  }
  layer.arrows.innerHTML = arrows;

  // Falstad's live feel: amber beads run along the wires and leads, faster for more current.
  const r1 = currentOf(R1P);
  const direction = !r1 || r1.value === 0 ? 0 : r1.from === 'in' ? 1 : -1;
  if (reducedMotion.matches || direction === 0) {
    flowAnimations.forEach((a) => a.cancel());
    flowAnimations = [];
    layer.flow.innerHTML = '';
    flowDirection = 0;
    return;
  }
  if (direction !== flowDirection || !flowAnimations.length) {
    flowAnimations.forEach((a) => a.cancel());
    const paths = flowPaths();
    layer.flow.innerHTML = Object.entries(paths)
      .map(([node, pts]) => {
        const d = pxPath(direction > 0 ? pts : [...pts].reverse());
        return `<g data-node="${node}"><path class="flow-halo" d="${d}"/><path class="flow-dots" d="${d}"/></g>`;
      })
      .join('');
    flowAnimations = [...layer.flow.querySelectorAll<SVGPathElement>('path')].map((el) =>
      el.animate([{ strokeDashoffset: '0px' }, { strokeDashoffset: '-18px' }], { duration: 1000, iterations: Infinity }),
    );
    flowDirection = direction;
  }
  for (const anim of flowAnimations) {
    const node = ((anim.effect as KeyframeEffect).target as SVGElement).closest<SVGGElement>('g[data-node]')!.dataset.node!;
    const c = state.sol?.currents.find((x) => x.element === WIRE_CURRENT[node]);
    const amps = Math.abs(c?.value ?? 0);
    // 2 mA runs at 40 px/s; the speed follows the square root of the current.
    const speed = Math.max(5, Math.min(140, 40 * Math.sqrt(amps / 0.002)));
    anim.updatePlaybackRate(speed / 18);
  }
}

// ------------------------------------------------------------------ labels on the page

const els = new Map<string, HTMLElement>();
function el<T extends HTMLElement>(key: string, make: () => T): T {
  let e = els.get(key) as T | undefined;
  if (!e) {
    e = make();
    e.dataset.key = key;
    labelsLayer.append(e);
    els.set(key, e);
  }
  return e;
}
/** A label drawn on the page. Hidden from screen readers: the part buttons and node chips say it in words. */
function div(cls: string, html = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  d.setAttribute('aria-hidden', 'true');
  return d;
}
function placeAt(e: HTMLElement, x: number, y: number, side: Align): void {
  e.style.left = `${f2(x)}px`;
  e.style.top = `${f2(y)}px`;
  e.dataset.x = String(x);
  e.dataset.y = String(y);
  e.dataset.side = side;
  for (const s of ['top', 'bottom', 'left', 'right', 'center', 'top-start', 'top-end']) e.classList.toggle(`lbl--${s}`, s === side);
}

/**
 * A label's box in world pixels, from its layout size (not getBoundingClientRect, which would
 * follow the page while it glides to a new zoom).
 */
function labelBox(e: HTMLElement): Box | undefined {
  if (e.hidden || e.dataset.x === undefined) return undefined;
  const x = Number(e.dataset.x);
  const y = Number(e.dataset.y);
  const w = e.offsetWidth;
  const h = e.offsetHeight;
  if (!w && !h) return undefined;
  switch (e.dataset.side) {
    case 'top':
      return { x0: x - w / 2, y0: y - h, x1: x + w / 2, y1: y };
    case 'bottom':
      return { x0: x - w / 2, y0: y, x1: x + w / 2, y1: y + h };
    case 'left':
      return { x0: x - w, y0: y - h / 2, x1: x, y1: y + h / 2 };
    case 'right':
      return { x0: x, y0: y - h / 2, x1: x + w, y1: y + h / 2 };
    case 'top-start':
      return { x0: x, y0: y - h, x1: x + w, y1: y };
    case 'top-end':
      return { x0: x - w, y0: y - h, x1: x, y1: y };
    default:
      return { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
  }
}

let booted = false;
/** While a value is being dragged the numbers simply follow; a settle animation would only flicker. */
const dragging = (): boolean => !!scrub || sliderBusy;

/** Write a number in place: the new value settles in (it never blanks out; no motion while dragging). */
function setNum(e: HTMLElement, text: string): void {
  if (e.textContent === text) return;
  e.textContent = text;
  if (reducedMotion.matches || !booted || dragging()) return;
  for (const a of e.getAnimations()) a.cancel();
  e.animate([{ opacity: 0.4, transform: 'translateY(0.14em)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
}

function wasText(now: string, before: string | undefined): string {
  return before && before !== now ? `<s class="was" aria-hidden="true">${esc(before)}</s> ` : '';
}

const GND_PART: Part = { id: 'GND', kind: 'GND', a: GROUND_AT, rot: 0, value: '', labelSide: 'right', flowSide: 'left', placed: false };

/** One real button per part over the symbol (keyboard, screen readers), at least 44 px on screen whatever the zoom. */
function placeHits(): void {
  const min = 44 / view.z;
  for (const p of [...allParts(), GND_PART]) {
    const hit = els.get(`hit:${p.id}`);
    if (!hit) continue;
    let b: Box;
    if (p.kind === 'GND') {
      const [x, y] = cellPx(p.a);
      b = { x0: x - 22, y0: y - 6, x1: x + 22, y1: y + 32 };
    } else {
      const [bx0, by0, bx1, by1] = HL_BOX[p.kind];
      const a = cellPx(p.a);
      const q1 = toWorld(a, p.rot, bx0, by0);
      const q2 = toWorld(a, p.rot, bx1, by1);
      b = { x0: Math.min(q1[0], q2[0]), y0: Math.min(q1[1], q2[1]), x1: Math.max(q1[0], q2[0]), y1: Math.max(q1[1], q2[1]) };
    }
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const w = Math.max(min, b.x1 - b.x0);
    const h = Math.max(min, b.y1 - b.y0);
    hit.style.left = `${f2(cx - w / 2)}px`;
    hit.style.top = `${f2(cy - h / 2)}px`;
    hit.style.width = `${f2(w)}px`;
    hit.style.height = `${f2(h)}px`;
  }
}

function renderLabels(): void {
  const sol = state.sol;
  const ok = numbersOk(sol);
  // While a value is being changed (editor open, or its label dragged), the old numbers stay struck through.
  const before = (state.editing || scrub) && numbersOk(state.before) ? state.before : undefined;
  const seen = new Set<string>();
  const touch = (k: string): string => (seen.add(k), k);

  for (const p of [...allParts(), GND_PART]) {
    const hit = el(touch(`hit:${p.id}`), () => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hit';
      b.dataset.part = p.id;
      return b;
    });
    hit.setAttribute('aria-label', hitLabel(p));
    hit.setAttribute('aria-pressed', String(state.selected === p.id));
  }
  placeHits();

  // Ground: node 0
  const g0 = el(touch('gnd:GND'), () => div('lbl gnd-lbl', '0'));
  placeAt(g0, GROUND_AT[0] * G + 18, GROUND_AT[1] * G + 19, 'right');

  // Part names and values
  for (const p of allParts()) {
    if (p.kind === 'GND') {
      const g = el(touch(`gnd:${p.id}`), () => div('lbl gnd-lbl', '0'));
      const [x, y] = cellPx(p.a);
      placeAt(g, x + 18, y + 17, 'right');
      continue;
    }
    const lbl = el(touch(`part:${p.id}`), () => div('lbl part-lbl', '<span class="part-lbl__name"></span><span class="part-lbl__value"><span class="num"></span></span><span class="power-slot"></span>'));
    lbl.querySelector('.part-lbl__name')!.textContent = p.id;
    setNum(lbl.querySelector<HTMLElement>('.part-lbl__value .num')!, shortValue(p));
    lbl.classList.toggle('is-placed', p.placed);
    lbl.classList.toggle('is-trap', !!trapOn(p));
    const valueEl = lbl.querySelector<HTMLElement>('.part-lbl__value')!;
    if (p.key) {
      valueEl.classList.add('scrub');
      valueEl.dataset.part = p.id;
      valueEl.dataset.tip = 'Drag sideways to change it';
    }
    const c = partCentre(p);
    const sv = SIDE[p.labelSide];
    const d = HALF[p.kind] + (p.labelSide === 'top' || p.labelSide === 'bottom' ? 9 : 12);
    placeAt(lbl, c[0] + sv[0] * d, c[1] + sv[1] * d, p.labelSide);
    // A source's power, written under its name ("V1 delivers 12 mW", the model's words, without the name).
    const slot = lbl.querySelector<HTMLElement>('.power-slot')!;
    const power = ok ? currentOf(p)?.power : undefined;
    if (power) {
      const short = (t: string): string => t.replace(new RegExp(`^${p.id}\\s+`), '');
      slot.className = 'power-slot power-lbl';
      if (!slot.querySelector('.num')) slot.innerHTML = '<span class="num"></span>';
      setNum(slot.querySelector<HTMLElement>('.num')!, short(power.text));
    } else {
      slot.className = 'power-slot';
      slot.textContent = '';
    }
  }

  // Node voltages: a label in the node's colour at each node, tied to it by a short leader
  const colours = model().colours;
  for (const [node, at] of Object.entries(NODE_AT)) {
    const chip = el(touch(`chip:${node}`), () => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lbl chip chip-btn';
      b.innerHTML = `<span class="chip__node"></span><span class="chip__eq">=</span><span class="chip__was"></span><span class="chip__val num"></span>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.editing) closeInspector(false);
        select(`node:${node}`);
        if (isPhone()) return;
        if (!state.panels.has('explain')) openPanel('explain');
        requestAnimationFrame(() => panelEl.explain.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' }));
      });
      b.addEventListener('pointerenter', () => {
        state.hover = `node:${node}`;
        updateInkState();
      });
      b.addEventListener('pointerleave', () => {
        state.hover = null;
        updateInkState();
      });
      return b;
    });
    chip.style.setProperty('--node', colours.get(node) ?? 'var(--ink)');
    chip.querySelector('.chip__node')!.textContent = node;
    const words = ok ? sol.nodes.find((n) => n.node === node) : undefined;
    const prev = before?.nodes.find((n) => n.node === node);
    chip.querySelector('.chip__was')!.innerHTML = words ? wasText(words.text, prev?.text) : '';
    setNum(chip.querySelector<HTMLElement>('.chip__val')!, words?.text ?? '?');
    chip.classList.toggle('is-unsolved', !words);
    // The name starts with what the chip shows (WCAG 2.5.3), then says it in words.
    const moved = prev && words && prev.text !== words.text ? prev : undefined;
    const shown = `${node} = ${moved ? `${moved.text} ` : ''}${words?.text ?? '?'}`;
    const spoken = words ? ` (${moved ? `was ${moved.speech}, now ` : ''}${words.speech})` : ' (no numbers yet)';
    chip.setAttribute('aria-label', `${shown}${spoken}. Show what connects to node ${node}.`);
    // The chip stands over its corner on a short leader and grows outwards, so a longer value never runs into R1.
    const [x, y] = cellPx(at);
    const outward = x <= 0 ? 'top-end' : 'top-start';
    placeAt(chip, x + (x <= 0 ? CHIP_INSET : -CHIP_INSET), y - CHIP_LIFT, outward);
  }

  // Currents: the value next to each amber arrow
  for (const p of DIVIDER) {
    const c = currentOf(p);
    const fl = el(touch(`flow:${p.id}`), () => div('lbl flow-lbl', '<span class="num"></span>'));
    fl.hidden = !c || c.value === 0;
    if (!c) continue;
    setNum(fl.querySelector<HTMLElement>('.num')!, formatSI(Math.abs(c.value), 'A'));
    const centre = partCentre(p);
    const sv = SIDE[p.flowSide];
    const d = HALF[p.kind] + 15;
    // Beside a vertical part the value sits level with the arrow's tip, so the two values inside
    // the loop (current up through V1, down through R2) never meet.
    let along = 0;
    if (p.flowSide === 'left' || p.flowSide === 'right') {
      const towardB = c.from === p.nodes![0];
      const [, by] = toWorld(cellPx(p.a), p.rot, LEN, 0);
      const down = by > centre[1] === towardB;
      along = down ? 11 : -11;
    }
    placeAt(fl, centre[0] + sv[0] * d, centre[1] + sv[1] * d + along, p.flowSide);
  }

  // A trap on the page: the model's own title, in red pen, above the part (the editor says it when open).
  const trapPart = DIVIDER.find((p) => trapOn(p));
  const tn = el(touch('trap-note'), () => div('lbl trap-note'));
  tn.hidden = !trapPart || (state.editing && state.selected === trapPart.id && !isPhone()) || (isPhone() && (state.panels.size > 0 || state.editing));
  if (trapPart) {
    tn.textContent = trapOn(trapPart)!.title;
    const c = partCentre(trapPart);
    placeAt(tn, c[0], c[1] - 66, 'top');
  }

  // When there are no numbers for the circuit as written, say so on the page, with the model's reason.
  const stale = el(touch('stale-note'), () => div('lbl stale-note'));
  const problem = sol && !ok ? `No numbers yet: ${staleReason(sol)}` : '';
  stale.hidden = !problem;
  stale.textContent = problem;
  placeAt(stale, 4 * G, 4 * G + 6, 'center');
  app.dataset.stale = sol && !ok ? '1' : '0';

  for (const [k, e] of els) {
    if (!seen.has(k)) {
      e.remove();
      els.delete(k);
    }
  }
}

/** Why there are no numbers, in the model's words. */
function staleReason(sol: Solution): string {
  const traps = check(sol.netlist);
  const error = traps.find((c) => c.severity === 'error');
  if (sol.status === 'check' && error) return error.title;
  const bad = valuesIn(sol.netlist).findIndex((v) => readNumber(v) === undefined);
  if (bad >= 0) {
    const t = traps.find((c) => c.line === bad + 2);
    if (t) return t.title;
  }
  return sol.words.warnings[0]?.title ?? sol.words.summary;
}

function hitLabel(p: Part): string {
  if (p.kind === 'GND') return 'Ground, node 0';
  const kind = KIND_NAME[p.kind];
  if (p.placed) return `${p.id}, ${kind}, ${shortValue(p)}, not connected yet`;
  const value = valueMeaning(p);
  const c = currentOf(p);
  const trap = trapOn(p);
  return `${p.id}, ${kind}, ${value}${c ? `. ${c.speech}` : ''}${c?.power ? `. ${c.power.speech}` : ''}${trap ? `. Check: ${trap.title}` : ''}. Press Enter to change its value.`;
}

// ------------------------------------------------------------------ screen space: note, editor, arrows, placer

const noteShown = (): boolean => !note.hidden;

function updateNoteVisibility(): void {
  const show =
    !state.noteHidden && !state.editing && state.tool === 'select' && !state.partsOpen && state.panels.size === 0 && (state.shot === '' || state.shot === 'solved');
  note.hidden = !show;
  updateInkState();
}

/** A part's label in canvas pixels, where the page is going to be. */
function partLabelRect(id: string): { left: number; top: number; right: number; bottom: number; height: number } | undefined {
  const e = els.get(`part:${id}`);
  const b = e ? labelBox(e) : undefined;
  if (!b) return undefined;
  const [l, t] = toScreen(b.x0, b.y0);
  const [r, bo] = toScreen(b.x1, b.y1);
  return { left: l, top: t, right: r, bottom: bo, height: bo - t };
}

function placeScreenThings(): void {
  const c = canvas.getBoundingClientRect();
  let arrows = '';
  const r1 = partLabelRect('R1');

  if (!note.hidden && r1) {
    if (isPhone()) {
      note.style.left = '18px';
      note.style.top = `${56 + 14 + phoneShift}px`;
      const n = note.getBoundingClientRect();
      const sx = n.right - c.left - 52;
      const sy = n.bottom - c.top + 8;
      const ex = r1.right + 7;
      const ey = r1.top + r1.height * 0.3;
      if (ey > sy + 16) arrows += pointer(sx, sy, ex, ey, sx + 26, sy + (ey - sy) * 0.55, ex + 44, ey - 6);
    } else {
      const box = contentBox();
      const [, ry] = toScreen(0, box.y0);
      const [rx] = toScreen(box.x1, 0);
      const left = Math.min(rx + 48, canvas.clientWidth - 40 - 24 - note.offsetWidth);
      const top = Math.max(56 + 22, ry - 8);
      note.style.left = `${f2(left)}px`;
      note.style.top = `${f2(top)}px`;
      const sx = left - 10;
      const sy = top + 36;
      const ex = r1.right + 10;
      const ey = r1.top + r1.height * 0.3;
      arrows += pointer(sx, sy, ex, ey, sx - 60, sy - 46, ex + 70, ey - 52);
    }
  }
  placeInspector();
  placePlacer();
  overlay.innerHTML = arrows;
  markCovered();
}

/**
 * Parts and node labels hidden under a sheet, the tabs or the header are taken out of the tab
 * order and the accessibility tree until the page shows them again, so keyboard focus is never
 * hidden behind a panel (WCAG 2.4.11).
 */
function markCovered(): void {
  const covers: DOMRect[] = [];
  const add = (e: Element | null): void => {
    if (e && !(e as HTMLElement).hidden && getComputedStyle(e).display !== 'none') covers.push(e.getBoundingClientRect());
  };
  if (isPhone()) {
    add(document.getElementById('topbar'));
    add(palette);
    add(sheetEl() ?? null);
    if (tabsShown()) add(document.getElementById('tabs'));
  } else {
    if (state.panels.size) add(panelsBox);
    if (state.editing) add(inspector);
  }
  for (const e of labelsLayer.querySelectorAll<HTMLElement>('.hit, .chip-btn')) {
    const r = e.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const under = covers.some((c) => cx >= c.left && cx <= c.right && cy >= c.top && cy <= c.bottom);
    if (e.inert !== under) e.inert = under;
  }
}

/** A pencil arrow drawn by hand (a cubic curve and an open head), in screen space. */
function pointer(sx: number, sy: number, ex: number, ey: number, c1x: number, c1y: number, c2x: number, c2y: number): string {
  const ang = Math.atan2(ey - c2y, ex - c2x);
  const h = 11;
  const a1 = ang + Math.PI * 0.82;
  const a2 = ang - Math.PI * 0.82;
  const head = `M${f2(ex + Math.cos(a1) * h)} ${f2(ey + Math.sin(a1) * h)}L${f2(ex)} ${f2(ey)}L${f2(ex + Math.cos(a2) * h)} ${f2(ey + Math.sin(a2) * h)}`;
  const draw = booted ? '' : ' draw-on';
  return `<path class="pointer${draw}" d="M${f2(sx)} ${f2(sy)}C${f2(c1x)} ${f2(c1y)} ${f2(c2x)} ${f2(c2y)} ${f2(ex)} ${f2(ey)}"/><path class="pointer-head" d="${head}"/>`;
}

// ------------------------------------------------------------------ the value editor: an index card pinned to the part

/** Which side of its part the editor card sits on: the side of the part's label (R1: above it). */
function popSide(p: Part | undefined): Side {
  if (!p) return 'top';
  if (p.placed) return p.rot === 90 || p.rot === 270 ? 'right' : 'top';
  return p.labelSide;
}

/** The point the card points at, in world px: the outer edge of the part's label, fixed while the card is open. */
function computePopAnchor(p: Part): Pt {
  const side = popSide(p);
  const c = partCentre(p);
  const e = els.get(`part:${p.id}`);
  const lb = (e && labelBox(e)) ?? grow(partBox(p), 8);
  const pb = partBox(p);
  // A little slack, so a longer value (2 kΩ → 100 kΩ) never runs under the card.
  if (side === 'top') return [c[0], Math.min(lb.y0, pb.y0) - 2];
  if (side === 'bottom') return [c[0], Math.max(lb.y1, pb.y1) + 2];
  if (side === 'left') return [Math.min(lb.x0, pb.x0) - 16, c[1]];
  return [Math.max(lb.x1, pb.x1) + 16, c[1]];
}

/** The height a trap message adds to the editor card (two short lines). */
const TRAP_ROOM = 62;
let sliderBusy = false;
const pointerBusy = (): boolean => sliderBusy || !!scrub || !!dragPart || !!panStart;

/**
 * Pin the editor card to its part. It is placed when it opens and only follows the page when the
 * page itself moves (zoom, pan, window size), never while a pointer is down.
 */
function placeInspector(force = false): void {
  if (!state.editing || inspector.hidden || isPhone()) return;
  if (!force && pointerBusy()) return;
  const p = partById(state.selected);
  if (!p) return;
  state.popAnchor ??= computePopAnchor(p);
  const side = popSide(p);
  const [ax, ay] = toScreen(state.popAnchor[0], state.popAnchor[1]);
  const w = inspector.offsetWidth;
  const h = inspector.offsetHeight;
  const gap = 14;
  let left: number;
  let top: number;
  let topLimit = 56 + 20;
  if (side === 'top') {
    ({ left, topLimit } = cardSlot(ax, w));
    top = ay - gap - h;
  } else if (side === 'bottom') {
    left = ax - w / 2;
    top = ay + gap;
  } else if (side === 'left') {
    left = ax - gap - w;
    top = ay - 64;
  } else {
    left = ax + gap;
    top = ay - 64;
  }
  const maxRight = canvas.clientWidth - 40 - 16 - (state.panels.size ? panelsBox.offsetWidth : 0);
  left = Math.max(88 + 12, Math.min(maxRight - w, left));
  top = Math.max(topLimit, Math.min(canvas.clientHeight - h - 12, top));
  inspector.style.left = `${f2(left)}px`;
  inspector.style.top = `${f2(top)}px`;
  inspector.dataset.side = side;
  const notch = side === 'top' || side === 'bottom' ? Math.max(22, Math.min(w - 22, ax - left)) : Math.max(22, Math.min(h - 22, ay - top));
  inspector.style.setProperty('--notch', `${f2(notch)}px`);
}

/**
 * Where a card above its part goes: centred over the part, or slid sideways just enough to clear
 * the top bar's boxes (the notch still points at the part), so it may rise to the top of the page.
 */
function cardSlot(centre: number, w: number): { left: number; topLimit: number } {
  const c = canvas.getBoundingClientRect();
  const boxes = [...document.querySelectorAll<HTMLElement>('.topbar .island')].map((b) => {
    const r = b.getBoundingClientRect();
    return { l: r.left - c.left - 10, r: r.right - c.left + 10 };
  });
  const clear = (left: number): boolean => boxes.every((b) => left + w <= b.l || left >= b.r);
  const slack = w / 2 - 30;
  const candidates = [centre - w / 2, ...boxes.flatMap((b) => [b.r, b.l - w])].filter((left) => Math.abs(left + w / 2 - centre) <= slack);
  const left = candidates.find(clear);
  return left === undefined ? { left: centre - w / 2, topLimit: 56 + 20 } : { left, topLimit: 14 };
}

function stepsFor(key: ValueKey): number[] {
  return key === 'v1' ? V_STEPS : R_STEPS;
}
function nearestStep(steps: number[], value: number): number {
  let best = 0;
  if (steps === V_STEPS) {
    for (let i = 1; i < steps.length; i++) if (Math.abs(steps[i]! - value) < Math.abs(steps[best]! - value)) best = i;
    return best;
  }
  const lv = Math.log(Math.max(value, 1e-9));
  for (let i = 1; i < steps.length; i++) if (Math.abs(Math.log(steps[i]!) - lv) < Math.abs(Math.log(steps[best]!) - lv)) best = i;
  return best;
}

function openInspector(id: string): void {
  const p = partById(id);
  if (!p || p.kind === 'GND') return;
  if (!state.editing || state.selected !== id) {
    state.before = state.sol;
    state.editStart = p.key ? state.values[p.key] : p.value;
  }
  state.editing = true;
  state.noteHidden = true;
  state.popAnchor = null;
  if (isPhone()) {
    state.panels.clear();
    state.partsOpen = false;
    partsSheet.hidden = true;
    renderPanels();
  }
  select(id);
  buildInspector();
  inspector.hidden = false;
  updateNoteVisibility();
  renderLabels();
  syncSheet();
  requestAnimationFrame(() => {
    if (!view.user) fit(false);
    state.popAnchor = computePopAnchor(p);
    refit(true);
    placeInspector(true);
    syncSheet();
    if (!coarse.matches && state.shot === '') {
      const input = inspector.querySelector<HTMLInputElement>('#val-input');
      input?.focus({ preventScroll: true });
      input?.select();
    }
  });
}

function closeInspector(returnFocus = true): void {
  if (!state.editing) return;
  const p = partById(state.selected);
  const now = p ? (p.key ? state.values[p.key] : p.value) : '';
  state.editing = false;
  state.before = undefined;
  state.popAnchor = null;
  inspector.hidden = true;
  updateNoteVisibility();
  renderLabels();
  commit();
  syncSheet();
  requestAnimationFrame(() => {
    syncSheet();
    refit(true);
  });
  if (p && isPhone() && now !== state.editStart) toast(`${p.id} changed from ${state.editStart || 'nothing'} to ${now || 'nothing'}`);
  if (returnFocus && state.selected) els.get(`hit:${state.selected}`)?.focus({ preventScroll: true });
}

function buildInspector(): void {
  const p = partById(state.selected);
  if (!p || p.kind === 'GND') return;
  const kind = KIND_NAME[p.kind];
  const head = `
    <span class="insp__notch" aria-hidden="true"></span>
    <button class="sheet-grab" type="button" data-grab aria-label="${esc(p.id)}: make the sheet taller" aria-expanded="false"><span aria-hidden="true"></span></button>
    <header class="insp__head">
      <span class="insp__glyph" aria-hidden="true">${toolIcon(p.kind)}</span>
      <h2 class="insp__title" id="insp-title"><span class="hand">${esc(p.id)}</span> <span class="insp__kind">${esc(kind)}${p.line ? ` · line ${p.line}` : ''}</span></h2>
      <button class="icon-btn" type="button" data-insp-close aria-label="Close the editor">${CLOSE}</button>
    </header>`;
  if (p.placed) {
    inspector.innerHTML = `${head}
      <div class="insp__body">
        <div>
          <label class="field-label" for="val-input">${esc(valueField(placedExplain(p))?.label ?? 'value')}</label>
          <div class="value-input"><input id="val-input" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(p.value)}" aria-describedby="reads"/></div>
          <p class="reads" id="reads"><span>SPICE reads it as</span> <span class="reads__val"></span></p>
        </div>
        <p class="summary" id="insp-summary"></p>
        <p class="insp__msg">Not connected yet: ${p.kind === 'E' || p.kind === 'G' ? 'a, b and c' : 'a and b'} in the sentence above stand for its open pins. In this prototype new parts are drawn but not wired into the netlist; the divider is what ngspice solves.</p>
        <div class="insp__actions">
          <button class="btn btn--paper" type="button" data-rotate><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 9.5a5.5 5.5 0 1 1-1.8-4.1M15.5 4v3.6h-3.6"/></svg>Rotate</button>
          <button class="btn btn--paper" type="button" data-delete><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6.5h10M8.5 6.5V5h3v1.5M6.5 6.5l.7 9h5.6l.7-9"/></svg>Delete</button>
        </div>
      </div>`;
  } else {
    const key = p.key!;
    const steps = stepsFor(key);
    const ticks = key === 'v1' ? [0, 6, 12, 18, 24].map((v) => formatSI(v, 'V')) : [100, 1000, 10000, 100000].map((v) => formatSI(v, 'Ω'));
    inspector.innerHTML = `${head}
      <div class="insp__body">
        <div class="insp__field">
          <label class="field-label" for="val-input">${key === 'v1' ? 'Voltage' : 'Resistance'}</label>
          <div class="value-input" id="value-box"><input id="val-input" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(state.values[key])}" aria-describedby="reads"/><span class="value-input__unit" aria-hidden="true">${UNIT[key]}</span></div>
          <p class="reads" id="reads"><span>SPICE reads it as</span> <span class="reads__val"></span></p>
        </div>
        <div class="slider">
          <input type="range" id="val-range" min="0" max="${steps.length - 1}" step="1" aria-label="${esc(p.id)} ${key === 'v1' ? 'voltage' : 'resistance'}, standard values"/>
          <div class="ticks" aria-hidden="true">${ticks.map((t, i) => `<span style="left:${(i / (ticks.length - 1)) * 100}%">${esc(t)}</span>`).join('')}</div>
        </div>
        <div class="readouts" id="readouts"></div>
        <p class="summary" id="insp-summary"></p>
        <div id="insp-trap"></div>
      </div>`;
  }
  updateInspector(true);
}

function updateInspector(syncInputs = false): void {
  if (!state.editing) return;
  const p = partById(state.selected);
  if (!p || p.kind === 'GND') return;
  const reads = inspector.querySelector<HTMLElement>('#reads');
  const readsVal = inspector.querySelector<HTMLElement>('.reads__val');
  const input = inspector.querySelector<HTMLInputElement>('#val-input');
  const summary = inspector.querySelector<HTMLElement>('#insp-summary');
  if (p.placed) {
    const ex = placedExplain(p);
    // "2: the output voltage is 2 × the voltage it reads": the reading is before the colon; the summary says the rest.
    const meaning = valueField(ex)?.meaning ?? '';
    const reading = meaning.includes(': ') ? meaning.split(': ')[0] : meaning ? shortValue(p) : '';
    if (readsVal) readsVal.textContent = reading || (p.value ? '—' : 'nothing yet');
    if (summary) summary.textContent = ex?.summary ?? '';
    return;
  }
  const key = p.key!;
  const text = state.values[key];
  const ex = model().explains.find((e) => e.line === p.line);
  const valueF = valueField(ex);
  const trap = trapOn(p);
  const reading = readNumber(text);
  if (readsVal) readsVal.textContent = valueF?.meaning || (text ? '—' : 'nothing yet');
  reads?.classList.toggle('is-trap', !!trap);
  reads?.classList.toggle('is-bad', !reading);
  inspector.querySelector('#value-box')?.classList.toggle('is-trap', !!trap);
  if (syncInputs && input && input.value !== text) input.value = text;
  const range = inspector.querySelector<HTMLInputElement>('#val-range');
  if (range) {
    const steps = stepsFor(key);
    if (reading && !sliderBusy && document.activeElement !== range) range.value = String(nearestStep(steps, reading.value));
    const i = Number(range.value);
    range.style.setProperty('--fill', `${(i / (steps.length - 1)) * 100}%`);
    range.setAttribute('aria-valuetext', speakSI(steps[i] ?? 0, UNIT[key] === 'Ω' ? 'Ω' : 'V'));
  }
  if (summary) summary.textContent = ex?.summary ?? '';

  const readouts = inspector.querySelector<HTMLElement>('#readouts');
  if (readouts) {
    const ok = numbersOk();
    const c = currentOf(p);
    const nodes = p.nodes!;
    const v = (n: string): number | undefined => (n === '0' ? 0 : state.sol?.voltages.get(n));
    const va = v(nodes[0]);
    const vb = v(nodes[1]);
    const current = c ? formatSI(Math.abs(c.value), 'A') : '—';
    const direction = c ? c.text.slice(c.text.indexOf(' from ') + 1).replace(/ through \S+$/, '') : '';
    const second =
      p.id === 'V1'
        ? { k: c?.power?.delivers === false ? 'takes in' : 'delivers', v: c?.power ? formatSI(c.power.watts, 'W') : '—', sub: 'its power' }
        : { k: 'across it', v: ok && va !== undefined && vb !== undefined ? formatSI(va - vb, 'V') : '—', sub: `V(${nodes[0]}) − V(${nodes[1]})` };
    setReadout(readouts, [
      { k: 'through it', v: current, sub: direction, cls: 'is-current' },
      { k: second.k, v: second.v, sub: second.sub, cls: p.id === 'V1' ? 'is-power' : '' },
    ]);
  }
  const trapBox = inspector.querySelector<HTMLElement>('#insp-trap');
  if (trapBox) {
    // The trap's title and the way to its fix; why it matters is in the Checks panel, one click away.
    const html = trap
      ? `<p class="insp__msg insp__msg--trap"><strong>${esc(trap.title)}.</strong> <button class="link" type="button" data-open-checks>See why, and the fix</button></p>`
      : '';
    if (trapBox.innerHTML !== html) trapBox.innerHTML = html;
  }
}

function setReadout(box: HTMLElement, items: { k: string; v: string; sub: string; cls: string }[]): void {
  if (box.children.length !== items.length) {
    box.innerHTML = items.map(() => `<div class="readout"><p class="readout__v"><span class="num"></span> <span class="readout__k"></span></p><p class="readout__sub"></p></div>`).join('');
  }
  items.forEach((it, i) => {
    const r = box.children[i] as HTMLElement;
    r.querySelector('.readout__k')!.textContent = it.k;
    r.querySelector('.readout__v')!.className = `readout__v ${it.cls}`;
    setNum(r.querySelector<HTMLElement>('.num')!, it.v);
    r.querySelector('.readout__sub')!.textContent = it.sub;
  });
}

inspector.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  const p = partById(state.selected);
  if (!p) return;
  if (t.id === 'val-input') {
    if (p.placed) {
      p.value = t.value;
      afterDrawingChange();
      updateInspector();
      pendingCommit();
      return;
    }
    setValue(p.key!, t.value, 'type');
  } else if (t.id === 'val-range' && p.key) {
    const v = stepsFor(p.key)[Number(t.value)] ?? 0;
    setValue(p.key, formatSpiceNumber(v), 'drag');
  }
});
inspector.addEventListener('change', (e) => {
  if ((e.target as HTMLElement).id === 'val-range') commit();
});
inspector.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).id === 'val-range') sliderBusy = true;
});
window.addEventListener('pointerup', () => endSlider());
window.addEventListener('pointercancel', () => endSlider());
function endSlider(): void {
  if (!sliderBusy) return;
  sliderBusy = false;
  updateInspector();
  placeScreenThings();
}
inspector.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeInspector();
  } else if (e.key === 'Enter' && t.id === 'val-input') {
    e.preventDefault();
    commit();
    void runNow();
  }
});
inspector.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest('button');
  if (!t) return;
  if (t.hasAttribute('data-insp-close')) closeInspector();
  else if (t.hasAttribute('data-open-checks')) openPanel('checks', true);
  else if (t.hasAttribute('data-rotate')) rotateSelected();
  else if (t.hasAttribute('data-delete')) deleteSelected();
});

// ------------------------------------------------------------------ values and live solving

/**
 * A value changed. Typing waits for a pause (150 ms), so "3k" is not first solved as 3 Ω; dragging
 * solves at once and then at most every 60 ms, so the numbers follow the hand.
 */
function setValue(key: ValueKey, text: string, how: 'type' | 'drag'): void {
  state.values[key] = text;
  if (how === 'drag') {
    const input = inspector.querySelector<HTMLInputElement>('#val-input');
    if (input) input.value = text;
  }
  state.noteHidden = true;
  updateNoteVisibility();
  afterValuesChange();
  requestSolve(how);
  pendingCommit();
}

/** The values changed: everything that only needs the parser updates now; ngspice follows. */
function afterValuesChange(): void {
  buildInk();
  renderLabels();
  renderPanels();
  updateInspector();
  updateChecksTab();
  inkDesc.textContent = model().words;
  keepInView();
}

function afterDrawingChange(): void {
  buildInk();
  renderLabels();
  renderPanels();
  updateGhost();
}

const SOLVE_GAP_MS = 60;
const TYPE_PAUSE_MS = 150;
/** Numbers that fall this far behind the value turn pencil grey, so a mismatched pair never looks final. */
const PENCIL_AFTER_MS = 120;
/** "Solving…" only shows when ngspice is slow; a 5 ms answer needs no word. */
const SLOW_SOLVE_MS = 300;

let lastSend = -Infinity;
let sendTimer = 0;
let slowTimer = 0;
let seq = 0;
let appliedSeq = -1;
const seqOf = new Map<string, number>();

const live = liveSolver(
  (s) => onSolved(s),
  (e) => {
    setLive('error');
    announce(`The simulation could not run: ${e instanceof Error ? e.message : String(e)}`);
  },
);

function requestSolve(how: 'type' | 'drag' | 'now'): void {
  markChanged();
  window.clearTimeout(sendTimer);
  if (how === 'now') return send();
  if (how === 'type') {
    sendTimer = window.setTimeout(send, TYPE_PAUSE_MS);
    return;
  }
  const wait = lastSend + SOLVE_GAP_MS - performance.now();
  if (wait <= 0) send();
  else sendTimer = window.setTimeout(send, wait);
}

function send(): void {
  lastSend = performance.now();
  const text = netlist();
  seqOf.set(text, ++seq);
  live.request(text);
  armSlow();
}

async function runNow(): Promise<Solution> {
  window.clearTimeout(sendTimer);
  const text = netlist();
  seqOf.set(text, ++seq);
  armSlow();
  const s = await solve(text);
  onSolved(s);
  return s;
}

/** Starts once per wait (a drag sends many requests): "Solving…" shows if no answer for the current values comes within 300 ms. */
function armSlow(): void {
  if (slowTimer) return;
  slowTimer = window.setTimeout(() => {
    slowTimer = 0;
    if (state.sol?.netlist !== netlist()) setLive('solving');
  }, SLOW_SOLVE_MS);
}

// How far the numbers on the page lag behind the values (for the pencil-grey state).
const changeLog: { t: number; text: string }[] = [];
let pendingSince: number | undefined;
let pendingTimer = 0;

function markChanged(): void {
  const text = netlist();
  if (changeLog.at(-1)?.text !== text) changeLog.push({ t: performance.now(), text });
  if (changeLog.length > 300) changeLog.splice(0, changeLog.length - 300);
  if (pendingSince === undefined && state.sol && state.sol.netlist !== text) pendingSince = performance.now();
  checkPending();
}
function onShown(s: Solution): void {
  const text = netlist();
  if (s.netlist === text) pendingSince = undefined;
  else {
    // The page now shows the answer for s.netlist: it fell behind when the value moved on from it.
    let i = changeLog.length - 1;
    while (i >= 0 && changeLog[i]!.text !== s.netlist) i--;
    pendingSince = i >= 0 && changeLog[i + 1] ? changeLog[i + 1]!.t : performance.now();
  }
  checkPending();
}
function checkPending(): void {
  window.clearTimeout(pendingTimer);
  const now = performance.now();
  const late = pendingSince !== undefined && now - pendingSince >= PENCIL_AFTER_MS;
  app.dataset.pending = late ? '1' : '0';
  if (pendingSince !== undefined && !late) pendingTimer = window.setTimeout(checkPending, PENCIL_AFTER_MS - (now - pendingSince) + 5);
}

function onSolved(s: Solution): void {
  const n = seqOf.get(s.netlist) ?? seq;
  // A run that finishes late (a Run press during a drag) never replaces a newer answer.
  if (n < appliedSeq && s.netlist !== netlist()) return;
  appliedSeq = n;
  state.sol = s;
  renderFlows();
  renderLabels();
  renderPanels();
  updateInspector();
  updateChecksTab();
  onShown(s);
  if (s.netlist === netlist()) {
    window.clearTimeout(slowTimer);
    slowTimer = 0;
    setLive(numbersOk(s) ? 'idle' : 'none', s.ms);
    announceResult(s);
  }
  if (!booted) refit(false);
  else {
    keepInView();
    placeScreenThings();
  }
}

function setLive(st: 'idle' | 'solving' | 'none' | 'error', ms?: number): void {
  liveEl.dataset.state = st;
  liveWord.textContent = st === 'solving' ? 'Solving…' : st === 'error' ? 'Engine error' : 'Live';
  liveDetail.textContent = st === 'idle' ? 'up to date' : st === 'none' ? 'no numbers yet' : '';
  if (ms !== undefined) liveEl.dataset.tip = `ngspice took ${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms. Every change runs it again.`;
}

/**
 * What the live region says after a run: the model's summary for speech, with the currents read
 * out (the model's own sentences) instead of "3 currents", and without "Open the results for
 * details" (this design has no Results panel: the results are on the drawing).
 */
function spokenResult(s: Solution): string {
  if (!numbersOk(s)) return `No numbers yet: ${staleReason(s)}.`;
  let text = s.words.summarySpeech.replace(/\s*Open the results for details\.\s*$/, '');
  const said = s.currents.map((c) => `${c.speech}${c.power ? `; ${c.power.speech}` : ''}`);
  if (said.length) text = `${text.replace(/;\s*\d+ currents?\.?$/, '.')} ${said.map((x) => `${x[0]!.toUpperCase()}${x.slice(1)}.`).join(' ')}`;
  return text;
}

let announceTimer = 0;
function announceResult(s: Solution): void {
  window.clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => announce(spokenResult(s)), 600);
}
function announce(text: string): void {
  announcer.textContent = '';
  window.setTimeout(() => (announcer.textContent = text), 30);
}

function updateChecksTab(): void {
  const traps = model().checks;
  tabEl.checks.dataset.problems = traps.length ? '1' : '0';
  checksBadge.textContent = traps.length ? String(traps.length) : '';
  tabEl.checks.setAttribute('aria-label', traps.length ? `Checks: ${traps.length} found` : 'Checks: no problems found');
}

// ------------------------------------------------------------------ undo and redo

function snapshot(): Snapshot {
  return { values: { ...state.values }, placed: state.placed.map((p) => ({ ...p })), wires: state.wires.map((w) => ({ id: w.id, pts: [...w.pts] })) };
}
function same(a: Snapshot, b: Snapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function commit(): void {
  window.clearTimeout(commitTimer);
  const s = snapshot();
  const top = history[historyAt];
  if (top && same(top, s)) return;
  history.splice(historyAt + 1);
  history.push(s);
  historyAt = history.length - 1;
  updateHistoryButtons();
}
let commitTimer = 0;
function pendingCommit(): void {
  window.clearTimeout(commitTimer);
  commitTimer = window.setTimeout(commit, 700);
}
function restore(s: Snapshot): void {
  state.values = { ...s.values };
  state.placed = s.placed.map((p) => ({ ...p }));
  state.wires = s.wires.map((w) => ({ id: w.id, pts: [...w.pts] }));
  if (state.selected && !partById(state.selected) && !state.selected.startsWith('node:') && state.selected !== 'GND') {
    state.selected = null;
    if (state.editing) closeInspector(false);
  }
  afterValuesChange();
  if (state.editing) buildInspector();
  requestSolve('now');
  updateHistoryButtons();
}
function undo(): void {
  window.clearTimeout(commitTimer);
  commit();
  if (historyAt <= 0) return;
  historyAt--;
  restore(history[historyAt]!);
  hideToast();
  announce('Undone');
}
function redo(): void {
  if (historyAt >= history.length - 1) return;
  historyAt++;
  restore(history[historyAt]!);
  announce('Redone');
}
function updateHistoryButtons(): void {
  undoBtn.disabled = historyAt <= 0;
  redoBtn.disabled = historyAt >= history.length - 1;
}
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

/** "R1 is now 1M · Undo": a way back after a big change, also on a phone, where there is no Ctrl+Z. */
let toastTimer = 0;
function toast(text: string): void {
  if (state.shot) return;
  toastText.textContent = text;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 6000);
  announce(`${text}. ${isPhone() ? 'Undo is in the toolbar at the top.' : 'Control Z undoes it.'}`);
}
function hideToast(): void {
  window.clearTimeout(toastTimer);
  toastEl.hidden = true;
}
$('toast-undo').addEventListener('click', () => {
  hideToast();
  undo();
});

// ------------------------------------------------------------------ selection

function select(id: string | null): void {
  state.selected = id;
  updateInkState();
  renderLabels();
  renderPanels();
}

function activatePart(id: string): void {
  const p = partById(id);
  if (id === 'GND' || !p) {
    if (state.editing) closeInspector(false);
    select(id);
    if (!isPhone() && !state.panels.has('explain')) openPanel('explain');
    return;
  }
  openInspector(id);
}

labelsLayer.addEventListener('click', (e) => {
  const hit = (e.target as HTMLElement).closest<HTMLElement>('.hit');
  if (!hit || state.tool !== 'select') return;
  e.stopPropagation();
  if (dragMoved) return;
  activatePart(hit.dataset.part!);
});
labelsLayer.addEventListener('pointerover', (e) => {
  const hit = (e.target as HTMLElement).closest<HTMLElement>('.hit');
  if (hit) {
    state.hover = hit.dataset.part ?? null;
    updateInkState();
  }
});
labelsLayer.addEventListener('pointerout', (e) => {
  if ((e.target as HTMLElement).closest('.hit')) {
    state.hover = null;
    updateInkState();
  }
});
labelsLayer.addEventListener('keydown', (e) => {
  const hit = (e.target as HTMLElement).closest<HTMLElement>('.hit');
  if (!hit) return;
  const p = partById(hit.dataset.part!);
  if (p?.placed && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && state.tool === 'select') {
    e.preventDefault();
    const d: Pt = e.key === 'ArrowLeft' ? [-1, 0] : e.key === 'ArrowRight' ? [1, 0] : e.key === 'ArrowUp' ? [0, -1] : [0, 1];
    p.a = [p.a[0] + d[0], p.a[1] + d[1]];
    afterDrawingChange();
    pendingCommit();
    els.get(`hit:${p.id}`)?.focus();
  }
});

// ------------------------------------------------------------------ panels: one paper sheet out of the divider tabs

const PANEL_ORDER: PanelId[] = ['netlist', 'checks', 'explain'];

function openPanel(id: PanelId, focus = false): void {
  if (isPhone()) {
    state.panels.clear();
    if (state.editing) closeInspector(false);
    closePartsSheet(false);
    state.detent = 'auto';
  }
  state.panels.add(id);
  renderPanels();
  updateNoteVisibility();
  syncSheet();
  requestAnimationFrame(() => {
    syncSheet();
    refit(true);
    if (id === 'checks' && model().checks.length) showFixes();
    if (focus) panelEl[id].querySelector<HTMLElement>('.trap__title, h2')?.focus({ preventScroll: true });
  });
}
function closePanel(id: PanelId): void {
  state.panels.delete(id);
  renderPanels();
  updateNoteVisibility();
  syncSheet();
  requestAnimationFrame(() => {
    syncSheet();
    refit(true);
  });
  tabEl[id].focus({ preventScroll: true });
}
function togglePanel(id: PanelId): void {
  if (state.panels.has(id)) closePanel(id);
  else openPanel(id);
}
for (const id of PANEL_ORDER) tabEl[id].addEventListener('click', () => togglePanel(id));

/** A trap's fixes are what matter most: bring them into view in the sheet. */
function showFixes(): void {
  const fixes = panelEl.checks.querySelector<HTMLElement>('.trap__fixes');
  if (!fixes) return;
  const scroller = isPhone() ? panelEl.checks.querySelector<HTMLElement>('.card__body') : panelsBox;
  if (!scroller) return;
  const sr = scroller.getBoundingClientRect();
  const fr = fixes.getBoundingClientRect();
  if (fr.bottom > sr.bottom - 8) scroller.scrollTo({ top: scroller.scrollTop + fr.bottom - sr.bottom + 24, behavior: reducedMotion.matches || !booted ? 'auto' : 'smooth' });
}

function selectedLine(): number | undefined {
  return partById(state.selected)?.line;
}

function renderPanels(): void {
  const m = model();
  for (const id of PANEL_ORDER) {
    const open = state.panels.has(id);
    tabEl[id].setAttribute('aria-expanded', String(open));
    const p = panelEl[id];
    if (!open) {
      if (!p.hidden) p.hidden = true;
      continue;
    }
    const focusKey = focusSignature(p);
    const scroll = p.querySelector('.card__body')?.scrollTop ?? 0;
    if (id === 'netlist') {
      const extra = state.placed.length
        ? `${state.placed.length === 1 ? 'The part you placed is' : 'The parts you placed are'} not in it yet: ${state.placed.map((x) => x.id).join(', ')}.`
        : '';
      p.innerHTML = netlistCard({ netlist: m.text, sol: state.sol, explains: m.explains, checks: m.checks, colours: m.colours, selectedLine: selectedLine() }, esc(extra));
      if (state.copied) p.querySelector('[data-copy-label]')!.textContent = 'Copied';
    } else if (id === 'checks') {
      p.innerHTML = checksCard(m.checks, (line) => DIVIDER.find((x) => x.line === line)?.id);
    } else {
      p.innerHTML = explainCard(explainView());
    }
    p.hidden = false;
    const body = p.querySelector('.card__body');
    if (body) body.scrollTop = scroll;
    restoreFocus(p, focusKey);
  }
  // A trap comes first: the Checks section moves to the top of the sheet.
  app.dataset.trap = m.checks.length ? '1' : '0';
  app.dataset.panels = state.panels.size ? 'open' : 'closed';
  for (const id of PANEL_ORDER) panelEl[id].classList.toggle('is-last', id === lastOpenPanel());
}

function lastOpenPanel(): PanelId | undefined {
  const order: PanelId[] = model().checks.length ? ['checks', 'netlist', 'explain'] : PANEL_ORDER;
  return [...order].reverse().find((id) => state.panels.has(id));
}

function explainView(): ExplainView {
  const m = model();
  const sel = state.selected;
  let selected: ExplainView['selected'] = null;
  if (sel?.startsWith('node:')) selected = { kind: 'node', node: sel.slice(5) };
  else if (sel === 'GND') selected = { kind: 'node', node: '0' };
  else if (sel) {
    const p = partById(sel);
    if (p?.placed) {
      const ex = placedExplain(p);
      selected = { kind: 'part', id: p.id, ...(ex ? { placed: ex } : {}) };
    } else if (p) selected = { kind: 'part', id: p.id, ...(p.line ? { line: p.line } : {}) };
  }
  return {
    describeText: m.words,
    netlist: m.text,
    explains: m.explains,
    sol: numbersOk() ? state.sol : undefined,
    colours: m.colours,
    selected,
    parts: DIVIDER.map((p) => ({ id: p.id, label: KIND_NAME[p.kind] })),
  };
}

function focusSignature(container: HTMLElement): string | undefined {
  const a = document.activeElement as HTMLElement | null;
  if (!a || !container.contains(a)) return undefined;
  for (const attr of ['data-close', 'data-copy', 'data-try-trap', 'data-fix', 'data-show-line', 'data-select', 'data-grab']) {
    if (a.hasAttribute(attr)) return `[${attr}${a.getAttribute(attr) ? `="${a.getAttribute(attr)}"` : ''}]`;
  }
  if (a.classList.contains('card__body')) return '.card__body';
  if (a.matches('h2, h3')) return `#${a.id}`;
  return undefined;
}
function restoreFocus(container: HTMLElement, sig: string | undefined): void {
  if (!sig) return;
  const t = container.querySelector<HTMLElement>(sig);
  if (t) t.focus({ preventScroll: true });
  else container.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

panelsBox.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const btn = t.closest<HTMLElement>('button');
  const line = t.closest<HTMLElement>('.code__line');
  if (btn?.hasAttribute('data-grab')) return toggleDetent();
  if (btn?.dataset.close) return closePanel(btn.dataset.close as PanelId);
  if (btn?.dataset.copy) {
    void navigator.clipboard?.writeText(netlist()).then(
      () => {
        state.copied = true;
        btn.querySelector('[data-copy-label]')!.textContent = 'Copied';
        announce('The netlist is copied');
        window.setTimeout(() => {
          state.copied = false;
          const l = panelEl.netlist.querySelector('[data-copy-label]');
          if (l) l.textContent = 'Copy';
        }, 1600);
      },
      () => announce('Copying is not allowed here'),
    );
    return;
  }
  if (btn?.dataset.tryTrap) return tryTrap();
  if (btn?.dataset.fix) {
    const [i, k] = btn.dataset.fix.split(':').map(Number);
    const trap = model().checks[i!];
    const fix = trap?.fixes[k!];
    if (trap && fix) applyFix(fix.changes, fix.label);
    return;
  }
  if (btn?.dataset.showLine) {
    const n = Number(btn.dataset.showLine);
    const p = DIVIDER.find((x) => x.line === n);
    if (p) select(p.id);
    openPanel('netlist');
    requestAnimationFrame(() => panelEl.netlist.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' }));
    return;
  }
  if (btn?.dataset.select) return activatePart(btn.dataset.select);
  if (line?.dataset.part) {
    const n = Number(line.dataset.line);
    const p = DIVIDER.find((x) => x.line === n);
    if (p) select(p.id);
  }
});
panelsBox.addEventListener('pointerover', (e) => {
  const line = (e.target as HTMLElement).closest<HTMLElement>('.code__line');
  const p = line ? DIVIDER.find((x) => x.line === Number(line.dataset.line)) : undefined;
  if ((p?.id ?? null) !== state.hover) {
    state.hover = p?.id ?? null;
    updateInkState();
  }
});

function tryTrap(): void {
  commit();
  state.values.r1 = '1M';
  state.noteHidden = true;
  updateNoteVisibility();
  afterValuesChange();
  commit();
  requestSolve('now');
  toast('R1 is now 1M');
  requestAnimationFrame(() => {
    showFixes();
    panelEl.checks.querySelector<HTMLElement>('.trap__title')?.focus({ preventScroll: true });
  });
}

/** A one-click fix from check(): apply its text changes to the netlist, then read the values back. */
function applyFix(changes: { from: number; to: number; insert: string }[], label: string): void {
  let text = netlist();
  for (const c of [...changes].sort((a, b) => b.from - a.from)) text = text.slice(0, c.from) + c.insert + text.slice(c.to);
  const [v1 = '', r1 = '', r2 = ''] = valuesIn(text);
  commit();
  state.values = { v1, r1, r2 };
  afterValuesChange();
  commit();
  requestSolve('now');
  toast(`Fixed: ${label}`);
  requestAnimationFrame(() => panelEl.checks.querySelector<HTMLElement>('#h-checks')?.focus({ preventScroll: true }));
}

// ------------------------------------------------------------------ phone sheets: grab handle and detents

function toggleDetent(): void {
  state.detent = state.detent === 'full' ? 'auto' : 'full';
  syncSheet();
  requestAnimationFrame(() => {
    syncSheet();
    refit(true);
  });
}

let sheetDrag: { el: HTMLElement; y: number; h: number; moved: boolean } | null = null;
function startSheetDrag(e: PointerEvent): void {
  if (!isPhone()) return;
  const t = e.target as HTMLElement;
  const el = t.closest<HTMLElement>('.card, .inspector, .parts-sheet');
  if (!el || el !== sheetEl()) return;
  const onGrab = !!t.closest('[data-grab]');
  const onHead = !!t.closest('.card__head, .insp__head') && !t.closest('button, input, a');
  if (!onGrab && !onHead) return;
  sheetDrag = { el, y: e.clientY, h: el.getBoundingClientRect().height, moved: false };
  el.setPointerCapture(e.pointerId);
}
function moveSheetDrag(e: PointerEvent): void {
  if (!sheetDrag) return;
  const dy = e.clientY - sheetDrag.y;
  if (Math.abs(dy) > 4) sheetDrag.moved = true;
  if (!sheetDrag.moved) return;
  const max = window.innerHeight - 56 - dockHeight() - 46 - 8;
  sheetDrag.el.style.height = `${Math.max(120, Math.min(max, sheetDrag.h - dy))}px`;
  sheetDrag.el.style.maxHeight = 'none';
  app.style.setProperty('--sheet-h', `${Math.round(sheetDrag.el.getBoundingClientRect().height)}px`);
}
function endSheetDrag(e: PointerEvent): void {
  if (!sheetDrag) return;
  const { el, y, h, moved } = sheetDrag;
  sheetDrag = null;
  el.style.height = '';
  el.style.maxHeight = '';
  if (!moved) return;
  e.preventDefault();
  const dy = e.clientY - y;
  if (dy > 90 && state.detent === 'auto') {
    // Pulled down: close the sheet.
    if (el === inspector) closeInspector(false);
    else if (el === partsSheet) closePartsSheet();
    else {
      const id = PANEL_ORDER.find((p) => panelEl[p] === el);
      if (id) closePanel(id);
    }
    return;
  }
  state.detent = h - dy > h + 60 || (state.detent === 'full' && dy < 90) ? 'full' : 'auto';
  syncSheet();
  requestAnimationFrame(() => {
    syncSheet();
    refit(true);
  });
}
for (const host of [panelsBox, inspector, partsSheet]) {
  host.addEventListener('pointerdown', startSheetDrag);
  host.addEventListener('pointermove', moveSheetDrag);
  host.addEventListener('pointerup', endSheetDrag);
  host.addEventListener('pointercancel', endSheetDrag);
}
inspector.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-grab]')) toggleDetent();
});

// ------------------------------------------------------------------ toolbar, tools, placing parts

const DESK_TOOLS: (Tool | '|')[] = ['select', 'wire', '|', 'R', 'C', 'L', '|', 'V', 'I', '|', 'E', 'F', 'G', 'H', '|', 'GND'];
/** The phone dock has room for the common parts; the controlled sources are one tap away, with their names. */
const PHONE_TOOLS: (Tool | 'more')[] = ['select', 'wire', 'R', 'C', 'L', 'V', 'I', 'GND', 'more'];
const TOOL_KEY: Record<Tool, string> = { select: 'Esc', wire: 'W', R: 'R', C: 'C', L: 'L', V: 'V', I: 'I', E: 'E', F: 'F', G: 'G', H: 'H', GND: '0' };
const TOOL_NAME = (t: Tool): string => (t === 'select' ? 'Select and change' : t === 'wire' ? 'Wire' : KIND_SHORT[t]);
const PHONE_WORD: Record<Tool | 'more', string> = { select: 'Select', wire: 'Wire', R: 'R', C: 'C', L: 'L', V: 'V', I: 'I', E: 'E', F: 'F', G: 'G', H: 'H', GND: 'Ground', more: 'E–H' };
const isControlled = (t: Tool): boolean => t === 'E' || t === 'F' || t === 'G' || t === 'H';

function buildPalette(): void {
  const phone = isPhone();
  const items = phone ? PHONE_TOOLS : DESK_TOOLS;
  palette.innerHTML = items
    .map((t) => {
      if (t === '|') return '<span class="palette__sep" role="separator"></span>';
      if (t === 'more') {
        const on = isControlled(state.tool);
        const icon = on ? toolIcon(state.tool as Kind) : toolIcon('more');
        return `<button class="tool tool--more" type="button" data-more="1" aria-haspopup="dialog" aria-expanded="${state.partsOpen}" aria-pressed="${on}" aria-label="${on ? `${state.tool}: ${TOOL_NAME(state.tool)}, one of the controlled sources E to H` : 'E–H: controlled sources E, F, G and H'}" tabindex="-1">${icon}<span class="tool__key" aria-hidden="true">${on ? state.tool : PHONE_WORD.more}</span></button>`;
      }
      const sub = toolLine(t as Kind);
      const word = phone ? PHONE_WORD[t] : t === 'select' ? '' : TOOL_KEY[t];
      return `<button class="tool${phone && (t === 'select' || t === 'wire' || t === 'GND') ? ' tool--word' : ''}" type="button" data-tool="${t}" aria-pressed="${t === state.tool}" aria-label="${esc(TOOL_NAME(t))}" aria-keyshortcuts="${t === 'select' ? 'Escape' : TOOL_KEY[t]}" data-tip="${esc(TOOL_NAME(t))}"${sub ? ` data-sub="${esc(sub)}"` : ''} data-key="${TOOL_KEY[t]}" tabindex="${t === state.tool ? 0 : -1}">${toolIcon(t)}<span class="tool__key" aria-hidden="true">${esc(word)}</span></button>`;
    })
    .join('');
  if (!palette.querySelector('[tabindex="0"]')) palette.querySelector<HTMLButtonElement>('.tool')?.setAttribute('tabindex', '0');
}

function setTool(t: Tool, fromKeyboard = false): void {
  const was = state.tool;
  state.tool = t;
  app.dataset.tool = t;
  state.wireDraft = null;
  if (t !== 'select') {
    // Placing has begun: the invitation has done its job.
    state.noteHidden = true;
    if (state.editing) closeInspector(false);
  }
  if (t !== 'select' && t !== 'wire' && t !== was) state.rot = DEFAULT_ROT[t];
  if (isPhone() && (isControlled(t) || isControlled(was))) buildPalette();
  for (const b of palette.querySelectorAll<HTMLButtonElement>('.tool[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
  if (t === 'select') {
    state.ghost = null;
    state.wireCursor = null;
    placer.hidden = true;
  } else if (fromKeyboard) startKeyboardPlacing();
  updateNoteVisibility();
  updateGhost();
  updateHint();
  refit(true);
}

palette.addEventListener('click', (e) => {
  const more = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-more]');
  if (more) return openPartsSheet();
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.tool');
  if (!b?.dataset.tool) return;
  const t = b.dataset.tool as Tool;
  setTool(t, e.detail === 0 && t !== 'select');
  if (isPhone() && state.tool !== 'select') announce(`${TOOL_NAME(state.tool)}: tap the page to place it`);
});
palette.addEventListener('keydown', (e) => {
  const buttons = [...palette.querySelectorAll<HTMLButtonElement>('.tool')];
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  const vertical = !isPhone();
  const next = e.key === (vertical ? 'ArrowDown' : 'ArrowRight') ? i + 1 : e.key === (vertical ? 'ArrowUp' : 'ArrowLeft') ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : -2;
  if (next === -2) return;
  e.preventDefault();
  const j = (next + buttons.length) % buttons.length;
  buttons.forEach((b, k) => (b.tabIndex = k === j ? 0 : -1));
  buttons[j]!.focus();
});

function nextName(kind: Exclude<Kind, 'GND'>): string {
  const used = new Set(allParts().map((p) => p.id.toUpperCase()));
  for (let i = 1; ; i++) if (!used.has(`${kind}${i}`)) return `${kind}${i}`;
}

function ghostPart(centre: Pt): Part | undefined {
  if (state.tool === 'select' || state.tool === 'wire') return undefined;
  const kind = state.tool;
  if (kind === 'GND') return { id: 'ghost', kind, a: centre, rot: 0, value: '', labelSide: 'right', flowSide: 'left', placed: true };
  const [ux, uy] = state.rot === 0 ? [1, 0] : state.rot === 90 ? [0, 1] : state.rot === 180 ? [-1, 0] : [0, -1];
  const a: Pt = [centre[0] - 2 * ux, centre[1] - 2 * uy];
  const vertical = state.rot === 90 || state.rot === 270;
  return { id: nextName(kind), kind, a, rot: state.rot, value: DEFAULT_VALUE[kind], labelSide: vertical ? 'right' : 'top', flowSide: vertical ? 'left' : 'bottom', placed: true };
}

/** What a part covers on the page with room for its labels, in world px. */
function footprint(p: Part): Box {
  const b = partBox(p);
  const vertical = p.rot === 90 || p.rot === 270;
  return { x0: b.x0 - 20, y0: b.y0 - (vertical ? 16 : 46), x1: b.x1 + (vertical ? 70 : 20), y1: b.y1 + 18 };
}

/** The nearest free spot for a new part, beside the drawing and inside the window (grid cells, the part's centre). */
function freeSpot(): Pt {
  const taken: Box[] = [];
  for (const p of allParts()) taken.push(footprint(p));
  taken.push(partBox(GND_PART));
  for (const e of labelsLayer.querySelectorAll<HTMLElement>('.lbl')) {
    const b = labelBox(e);
    if (b) taken.push(grow(b, 6));
  }
  const free = freeRect();
  const [fx0, fy0] = toWorldPt(free.x0, free.y0);
  const [fx1, fy1] = toWorldPt(free.x1, free.y1);
  const content = contentBox();
  const start: Pt = [Math.ceil(content.x1 / G) + 3, Math.round(content.y0 / G) + 3];
  let fallback: Pt | undefined;
  for (let r = 0; r < 24; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const c: Pt = [start[0] + dx, start[1] + dy];
        const g = ghostPart(c);
        if (!g) return c;
        const fp = footprint(g);
        if (taken.some((t) => meets(t, fp))) continue;
        if (fp.x0 >= fx0 && fp.y0 >= fy0 && fp.x1 <= fx1 && fp.y1 <= fy1) return c;
        fallback ??= c;
      }
    }
  }
  return fallback ?? start;
}

function updateGhost(): void {
  let svg = '';
  if (state.ghost && state.tool !== 'select' && state.tool !== 'wire') {
    const g = ghostPart(state.ghost);
    if (g) svg = partSvg(g, 'ghost');
  }
  if (state.tool === 'wire') {
    const draft = state.wireDraft;
    const cur = state.wireCursor;
    if (draft?.length && cur) svg += `<path class="wire-draft" d="${polyPath([...draft, ...elbow(draft.at(-1)!, cur)])}"/>`;
    if (cur) svg += `<circle class="wire-dot" cx="${cur[0] * G}" cy="${cur[1] * G}" r="4"/>`;
  }
  layer.ghost.innerHTML = svg;
  placePlacer();
}

/** The orthogonal path from a to b: across first, then down (an L). */
function elbow(a: Pt, b: Pt): Pt[] {
  if (a[0] === b[0] || a[1] === b[1]) return [b];
  return [[b[0], a[1]], b];
}

function place(centre: Pt): void {
  const g = ghostPart(centre);
  if (!g) return;
  const part: Part = g.kind === 'GND' ? { ...g, id: `GND${state.placed.filter((p) => p.kind === 'GND').length + 2}` } : g;
  state.placed.push(part);
  afterDrawingChange();
  updateHint();
  commit();
  announce(`${part.kind === 'GND' ? 'Ground' : part.id} placed. It is not connected yet.`);
}

function rotateSelected(): void {
  const p = partById(state.selected);
  if (!p?.placed || p.kind === 'GND') return;
  const c = partCentre(p);
  p.rot = ((p.rot + 90) % 360) as Rot;
  const vertical = p.rot === 90 || p.rot === 270;
  p.labelSide = vertical ? 'right' : 'top';
  p.flowSide = vertical ? 'left' : 'bottom';
  // Keep the centre where it was.
  const [ux, uy] = p.rot === 0 ? [1, 0] : p.rot === 90 ? [0, 1] : p.rot === 180 ? [-1, 0] : [0, -1];
  p.a = [Math.round(c[0] / G - 2 * ux), Math.round(c[1] / G - 2 * uy)];
  state.popAnchor = null;
  afterDrawingChange();
  commit();
  requestAnimationFrame(() => {
    if (state.editing) {
      state.popAnchor = computePopAnchor(p);
      placeInspector(true);
    }
  });
}

function deleteSelected(): void {
  const p = partById(state.selected);
  if (!p?.placed) return;
  state.placed = state.placed.filter((x) => x !== p);
  if (state.editing) closeInspector(false);
  state.selected = null;
  afterDrawingChange();
  commit();
  toast(`${p.kind === 'GND' ? 'Ground' : p.id} deleted`);
  canvas.focus({ preventScroll: true });
}

function updateHint(): void {
  let html = '';
  const touch = coarse.matches;
  const tap = touch ? 'Tap' : 'Click';
  const stop = touch ? 'tap <b>Select</b> to stop' : '<kbd>Esc</kbd> stops';
  if (state.tool === 'wire') {
    html = state.wireDraft
      ? `${tap} to bend the wire · ${touch ? 'tap the last point again' : 'double-click or <kbd>Enter</kbd>'} to finish · ${stop}`
      : `${tap} where the wire starts · ${stop}`;
  } else if (state.tool !== 'select') {
    const g = ghostPart(state.ghost ?? [0, 0]);
    const what = g && g.kind !== 'GND' ? `<b>${g.id}</b>` : 'ground';
    html = `${tap} the page to place ${what}${touch ? '' : ' · arrows move it · <kbd>Enter</kbd> places · <kbd>Ctrl R</kbd> turns it'} · ${stop}`;
  }
  hint.innerHTML = html;
  hint.classList.toggle('is-on', !!html);
}

// ------------------------------------------------------------------ placing from the keyboard

function placerWhat(): string {
  if (state.tool === 'wire') return 'a wire';
  const g = ghostPart(state.ghost ?? [0, 0]);
  return g && g.kind !== 'GND' ? `${g.id}, a ${KIND_NAME[g.kind]}` : 'ground';
}

/** A part tool chosen from the keyboard: the ghost waits in free space and focus moves onto the page. */
function startKeyboardPlacing(): void {
  if (state.tool === 'wire') state.wireCursor ??= freeSpot();
  else state.ghost = freeSpot();
  updateGhost();
  placer.hidden = false;
  placer.setAttribute(
    'aria-label',
    state.tool === 'wire'
      ? 'Drawing a wire. Arrow keys move the pen, Enter starts the wire or adds a bend, Enter twice finishes, Escape stops.'
      : `Placing ${placerWhat()}. Arrow keys move it, Enter places it, Control R turns it, Escape stops.`,
  );
  placePlacer();
  requestAnimationFrame(() => placer.focus({ preventScroll: true }));
}

function placePlacer(): void {
  if (placer.hidden) return;
  let b: Box | undefined;
  if (state.tool === 'wire' && state.wireCursor) {
    const [x, y] = cellPx(state.wireCursor);
    b = { x0: x - 14, y0: y - 14, x1: x + 14, y1: y + 14 };
  } else if (state.ghost) {
    const g = ghostPart(state.ghost);
    if (g) b = grow(partBox(g), 10);
  }
  if (!b) return;
  const [l, t] = toScreen(b.x0, b.y0);
  const [r, bo] = toScreen(b.x1, b.y1);
  placer.style.left = `${f2(l)}px`;
  placer.style.top = `${f2(t)}px`;
  placer.style.width = `${f2(r - l)}px`;
  placer.style.height = `${f2(bo - t)}px`;
}

let moveSay = 0;
placer.addEventListener('keydown', (e) => {
  const d: Pt | undefined = e.key === 'ArrowLeft' ? [-1, 0] : e.key === 'ArrowRight' ? [1, 0] : e.key === 'ArrowUp' ? [0, -1] : e.key === 'ArrowDown' ? [0, 1] : undefined;
  if (d) {
    e.preventDefault();
    e.stopPropagation();
    if (state.tool === 'wire') {
      const c = state.wireCursor ?? freeSpot();
      state.wireCursor = [c[0] + d[0], c[1] + d[1]];
    } else {
      const g = state.ghost ?? freeSpot();
      state.ghost = [g[0] + d[0], g[1] + d[1]];
    }
    updateGhost();
    window.clearTimeout(moveSay);
    const at = state.tool === 'wire' ? state.wireCursor : state.ghost;
    moveSay = window.setTimeout(() => at && announce(`Column ${at[0]}, row ${at[1]}`), 450);
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    e.stopPropagation();
    if (state.tool === 'wire') {
      const c = state.wireCursor ?? freeSpot();
      if (!state.wireDraft) {
        state.wireDraft = [c];
        announce('Wire started. Move, then Enter to bend; Enter twice finishes.');
      } else if (state.wireDraft.at(-1)![0] === c[0] && state.wireDraft.at(-1)![1] === c[1]) finishWire();
      else state.wireDraft.push(...elbow(state.wireDraft.at(-1)!, c));
      updateGhost();
      updateHint();
    } else {
      place(state.ghost ?? freeSpot());
      // Ready for the next one, in the next free spot.
      state.ghost = freeSpot();
      updateGhost();
      placer.setAttribute('aria-label', `Placing ${placerWhat()}. Arrow keys move it, Enter places it, Control R turns it, Escape stops.`);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    if (state.tool === 'wire' && state.wireDraft) finishWire();
    const t = state.tool;
    setTool('select');
    announce('Placing stopped');
    const btn = palette.querySelector<HTMLButtonElement>(`.tool[data-tool="${t}"]`) ?? palette.querySelector<HTMLButtonElement>('[data-more]');
    if (btn) {
      palette.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => (b.tabIndex = b === btn ? 0 : -1));
      btn.focus();
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r' && state.tool !== 'wire') {
    e.preventDefault();
    e.stopPropagation();
    state.rot = ((state.rot + 90) % 360) as Rot;
    updateGhost();
  }
});
placer.addEventListener('blur', () => {
  placer.hidden = true;
});

// ------------------------------------------------------------------ phone: the controlled sources sheet

function openPartsSheet(): void {
  if (state.editing) closeInspector(false);
  state.panels.clear();
  renderPanels();
  const rows = (['E', 'F', 'G', 'H'] as const)
    .map(
      (k) =>
        `<button class="part-row" type="button" data-pick="${k}" aria-pressed="${state.tool === k}"><span class="part-row__icon" aria-hidden="true">${toolIcon(k)}</span><span class="part-row__text"><span class="part-row__name"><b>${k}</b> ${esc(KIND_SHORT[k])}</span><span class="part-row__line">${esc(toolLine(k))}</span></span></button>`,
    )
    .join('');
  partsSheet.innerHTML = `
    <span class="sheet-grab" data-grab aria-hidden="true"><span></span></span>
    <header class="card__head">
      <div class="card__titles"><h2 class="card__title" id="parts-title" tabindex="-1">Controlled sources</h2><p class="card__sub">choose one, then tap the page to place it</p></div>
      <button class="icon-btn" type="button" data-parts-close aria-label="Close">${CLOSE}</button>
    </header>
    <div class="card__body"><div class="part-rows">${rows}</div></div>`;
  state.partsOpen = true;
  partsSheet.hidden = false;
  palette.querySelector('[data-more]')?.setAttribute('aria-expanded', 'true');
  updateNoteVisibility();
  syncSheet();
  requestAnimationFrame(() => {
    syncSheet();
    refit(true);
    partsSheet.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  });
}
function closePartsSheet(focusMore = true): void {
  if (!state.partsOpen) return;
  state.partsOpen = false;
  partsSheet.hidden = true;
  palette.querySelector('[data-more]')?.setAttribute('aria-expanded', 'false');
  updateNoteVisibility();
  syncSheet();
  requestAnimationFrame(() => {
    syncSheet();
    refit(true);
  });
  if (focusMore) palette.querySelector<HTMLElement>('[data-more]')?.focus({ preventScroll: true });
}
partsSheet.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!t) return;
  if (t.hasAttribute('data-parts-close')) return closePartsSheet();
  const k = t.dataset.pick as Tool | undefined;
  if (k) {
    closePartsSheet(false);
    setTool(k, e.detail === 0);
    if (e.detail !== 0) announce(`${TOOL_NAME(k)}: tap the page to place it`);
  }
});
partsSheet.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closePartsSheet();
  }
});

// ------------------------------------------------------------------ pointer on the page: select, pan, place, wire

let panStart: { x: number; y: number; tx: number; ty: number } | null = null;
/** Dragging a value on the drawing: left and right step through the standard values. */
let scrub: { part: Part; key: ValueKey; x: number; index: number; moved: boolean } | null = null;
let dragPart: { part: Part; start: Pt; a0: Pt } | null = null;
let dragMoved = false;
const pointers = new Map<number, Pt>();
let pinch: { d: number; z: number; cx: number; cy: number } | null = null;

function eventCell(e: PointerEvent | MouseEvent): Pt {
  const c = canvas.getBoundingClientRect();
  const [x, y] = toWorldPt(e.clientX - c.left, e.clientY - c.top);
  return [Math.round(x / G), Math.round(y / G)];
}

function wireAt(e: PointerEvent): string | undefined {
  const c = canvas.getBoundingClientRect();
  const [x, y] = toWorldPt(e.clientX - c.left, e.clientY - c.top);
  const tol = 10 / view.z;
  for (const w of WIRES) {
    for (let i = 1; i < w.pts.length; i++) {
      const [ax, ay] = [w.pts[i - 1]![0] * G, w.pts[i - 1]![1] * G];
      const [bx, by] = [w.pts[i]![0] * G, w.pts[i]![1] * G];
      const inX = x >= Math.min(ax, bx) - tol && x <= Math.max(ax, bx) + tol;
      const inY = y >= Math.min(ay, by) - tol && y <= Math.max(ay, by) + tol;
      if (inX && inY) return w.node;
    }
  }
  return undefined;
}

canvas.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('.note, .inspector, .hud, .chip-btn, .placer')) return;
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) {
    const [p1, p2] = [...pointers.values()] as [Pt, Pt];
    pinch = { d: Math.hypot(p1[0] - p2[0], p1[1] - p2[1]), z: view.z, cx: (p1[0] + p2[0]) / 2, cy: (p1[1] + p2[1]) / 2 };
    panStart = null;
    return;
  }
  const hit = (e.target as HTMLElement).closest<HTMLElement>('.hit');
  dragMoved = false;
  const scrubEl = (e.target as HTMLElement).closest<HTMLElement>('.scrub');
  if (scrubEl && state.tool === 'select') {
    const part = partById(scrubEl.dataset.part!);
    if (part?.key) {
      const steps = stepsFor(part.key);
      const reading = readNumber(state.values[part.key]);
      scrub = { part, key: part.key, x: e.clientX, index: reading ? nearestStep(steps, reading.value) : 0, moved: false };
      canvas.setPointerCapture(e.pointerId);
      app.classList.add('is-scrubbing');
      scrubEl.classList.add('is-active');
      e.preventDefault();
      return;
    }
  }
  if (state.tool === 'select') {
    if (hit) {
      const p = partById(hit.dataset.part!);
      if (p?.placed) {
        dragPart = { part: p, start: eventCell(e), a0: p.a };
        canvas.setPointerCapture(e.pointerId);
      }
      return;
    }
    panStart = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (state.tool === 'wire') {
    const cell = eventCell(e);
    state.wireCursor = cell;
    if (!state.wireDraft) state.wireDraft = [cell];
    else {
      const last = state.wireDraft.at(-1)!;
      if (last[0] === cell[0] && last[1] === cell[1]) finishWire();
      else state.wireDraft.push(...elbow(last, cell));
    }
    updateGhost();
    updateHint();
    return;
  }
  state.ghost = eventCell(e);
  place(state.ghost);
  updateGhost();
});

canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinch && pointers.size === 2) {
    const [p1, p2] = [...pointers.values()] as [Pt, Pt];
    const d = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
    const c = canvas.getBoundingClientRect();
    zoomAt(pinch.cx - c.left, pinch.cy - c.top, (pinch.z * (d / pinch.d)) / view.z);
    return;
  }
  if (scrub) {
    const steps = stepsFor(scrub.key);
    const index = Math.max(0, Math.min(steps.length - 1, scrub.index + Math.round((e.clientX - scrub.x) / 7)));
    const text = formatSpiceNumber(steps[index] ?? 0);
    if (Math.abs(e.clientX - scrub.x) > 3) scrub.moved = true;
    if (scrub.moved && text !== state.values[scrub.key]) {
      if (state.selected !== scrub.part.id) select(scrub.part.id);
      state.before ??= state.sol;
      setValue(scrub.key, text, 'drag');
      updateInspector(true);
    }
    return;
  }
  if (dragPart) {
    const cell = eventCell(e);
    const dx = cell[0] - dragPart.start[0];
    const dy = cell[1] - dragPart.start[1];
    if (dx || dy) dragMoved = true;
    dragPart.part.a = [dragPart.a0[0] + dx, dragPart.a0[1] + dy];
    afterDrawingChange();
    return;
  }
  if (panStart) {
    const dx = e.clientX - panStart.x;
    const dy = e.clientY - panStart.y;
    if (!dragMoved && Math.hypot(dx, dy) < 4) return;
    dragMoved = true;
    canvas.classList.add('is-panning');
    view.tx = panStart.tx + dx;
    view.ty = panStart.ty + dy;
    view.user = true;
    applyView();
    return;
  }
  if (state.tool === 'wire') {
    state.wireCursor = eventCell(e);
    updateGhost();
  } else if (state.tool !== 'select' && e.pointerType !== 'touch') {
    state.ghost = eventCell(e);
    updateGhost();
    updateHint();
  }
});

function endPointer(e: PointerEvent): void {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (scrub) {
    const { part, moved } = scrub;
    scrub = null;
    app.classList.remove('is-scrubbing');
    labelsLayer.querySelectorAll('.scrub.is-active').forEach((x) => x.classList.remove('is-active'));
    if (moved) {
      if (!state.editing) state.before = undefined;
      commit();
      renderLabels();
      announce(`${part.id} is now ${valueMeaning(part)}`);
    } else activatePart(part.id);
    placeScreenThings();
    return;
  }
  if (dragPart) {
    const p = dragPart.part;
    dragPart = null;
    if (dragMoved) commit();
    else activatePart(p.id);
    return;
  }
  if (panStart) {
    if (!dragMoved && state.tool === 'select') {
      const node = wireAt(e);
      if (node) {
        if (state.editing) closeInspector(false);
        select(node === '0' ? 'GND' : `node:${node}`);
      } else {
        if (state.editing) closeInspector(false);
        select(null);
      }
    }
    panStart = null;
    canvas.classList.remove('is-panning');
    placeScreenThings();
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('dblclick', () => {
  if (state.tool === 'wire') finishWire();
});

function finishWire(): void {
  const d = state.wireDraft;
  state.wireDraft = null;
  if (d && d.length >= 2) {
    const pts = d.filter((p, i) => i === 0 || p[0] !== d[i - 1]![0] || p[1] !== d[i - 1]![1]);
    if (pts.length >= 2) {
      state.wires.push({ id: `w${state.wires.length + 1}`, pts });
      afterDrawingChange();
      commit();
      announce('Wire drawn. It is not connected to the netlist in this prototype.');
    }
  }
  updateGhost();
  updateHint();
}

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const c = canvas.getBoundingClientRect();
    // Trackpad pinches send small steps, mouse wheels about 100 per notch: about 1.4× per notch.
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - c.left, e.clientY - c.top, Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * 0.0032));
    else {
      view.tx -= e.deltaX;
      view.ty -= e.deltaY;
      view.user = true;
      applyView();
    }
  },
  { passive: false },
);

$('zoom-in').addEventListener('click', () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.2));
$('zoom-out').addEventListener('click', () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.2));
zoomPct.addEventListener('click', () => {
  view.user = false;
  refit(true);
});

// ------------------------------------------------------------------ the sticky note

$('note-close').addEventListener('click', () => {
  state.noteHidden = true;
  updateNoteVisibility();
  refit(true);
  els.get('hit:R1')?.focus({ preventScroll: true });
});
$('note-try').addEventListener('click', () => {
  openInspector('R1');
  // On a touch screen the slider is the way in; focusing the field would cover it with the keyboard.
  const target = coarse.matches ? '#val-range' : '#val-input';
  requestAnimationFrame(() => requestAnimationFrame(() => inspector.querySelector<HTMLInputElement>(target)?.focus({ preventScroll: true })));
});

// ------------------------------------------------------------------ keyboard

const PART_KEYS: Record<string, Tool> = { r: 'R', c: 'C', l: 'L', v: 'V', i: 'I', e: 'E', f: 'F', g: 'G', h: 'H', '0': 'GND', w: 'wire' };

document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  const typing = !!target.closest('input, textarea, [contenteditable="true"]');
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'Enter') {
    e.preventDefault();
    void runNow().then((s) => announce(`ngspice ran the netlist again. ${spokenResult(s)}`));
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
  if (mod && e.key.toLowerCase() === 'r') {
    if (state.tool !== 'select' && state.tool !== 'wire') {
      e.preventDefault();
      state.rot = ((state.rot + 90) % 360) as Rot;
      updateGhost();
    } else if (partById(state.selected)?.placed) {
      e.preventDefault();
      rotateSelected();
    }
    return;
  }
  if (mod || e.altKey) return;
  if (e.key === 'Escape') {
    if (state.partsOpen) closePartsSheet();
    else if (state.tool === 'wire' && state.wireDraft) finishWire();
    else if (state.tool !== 'select') {
      setTool('select');
      announce('Select tool');
    } else if (state.editing) closeInspector();
    else if (state.selected) select(null);
    return;
  }
  if (e.shiftKey && e.key === '!') {
    view.user = false;
    refit(true);
    return;
  }
  const tool = PART_KEYS[e.key.toLowerCase()];
  if (tool && !target.closest('.code')) {
    e.preventDefault();
    setTool(tool, true);
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && partById(state.selected)?.placed) {
    e.preventDefault();
    deleteSelected();
    return;
  }
  if (e.key === '+' || e.key === '=') zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.2);
  if (e.key === '-') zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.2);
});

$('run').addEventListener('click', () => {
  void runNow().then((s) => announce(`ngspice ran the netlist again. ${spokenResult(s)}`));
});

// ------------------------------------------------------------------ tooltips

let tipTimer = 0;
function showTip(target: HTMLElement, delay: number): void {
  if (coarse.matches) return;
  window.clearTimeout(tipTimer);
  tipTimer = window.setTimeout(() => {
    const text = target.dataset.tip;
    if (!text) return;
    const key = target.dataset.key;
    const sub = target.dataset.sub;
    const keys = key ? `<span class="tip__keys">${key.split(' ').map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span>` : '';
    tip.innerHTML = `<span class="tip__row"><span class="tip__title">${esc(text)}</span>${keys}</span>${sub ? `<span class="tip__sub">${esc(sub)}</span>` : ''}`;
    tip.classList.toggle('has-sub', !!sub);
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const inPalette = !!target.closest('.palette') && !isPhone();
    // Controls near the bottom of the window get their tip above them, never over the control.
    const above = r.bottom > window.innerHeight - 120;
    let x = inPalette ? r.right + 10 : r.left + r.width / 2 - t.width / 2;
    let y = inPalette ? r.top + r.height / 2 - t.height / 2 : above ? r.top - t.height - 8 : r.bottom + 8;
    x = Math.max(8, Math.min(window.innerWidth - t.width - 8, x));
    y = Math.max(8, Math.min(window.innerHeight - t.height - 8, y));
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }, delay);
}
function hideTip(): void {
  window.clearTimeout(tipTimer);
  tip.hidden = true;
}
document.addEventListener('pointerover', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
  if (t && !app.classList.contains('is-scrubbing')) showTip(t, 420);
  else hideTip();
});
document.addEventListener('focusin', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
  if (t && t.matches(':focus-visible')) showTip(t, 150);
  else hideTip();
});
document.addEventListener('pointerdown', hideTip);

// ------------------------------------------------------------------ layout changes

new ResizeObserver(() => {
  syncSheet();
  refit(false);
}).observe(canvas);
const sheetObserver = new ResizeObserver(() => {
  if (sheetDrag) return;
  const before = app.style.getPropertyValue('--sheet-h');
  syncSheet();
  if (booted && app.style.getPropertyValue('--sheet-h') !== before) refit(true);
});
sheetObserver.observe(panelsBox);
sheetObserver.observe(inspector);
sheetObserver.observe(partsSheet);
for (const id of PANEL_ORDER) sheetObserver.observe(panelEl[id]);
phoneMq.addEventListener('change', () => {
  palette.setAttribute('aria-orientation', isPhone() ? 'horizontal' : 'vertical');
  if (isPhone() && state.panels.size > 1) state.panels = new Set([[...state.panels][0]!]);
  if (!isPhone()) closePartsSheet(false);
  buildPalette();
  renderPanels();
  updateNoteVisibility();
  syncSheet();
  view.user = false;
  refit(false);
});

// ------------------------------------------------------------------ start

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

async function start(): Promise<void> {
  state.shot = /(?:^#|&)shot=(\w+)/.exec(location.hash)?.[1] ?? '';
  palette.setAttribute('aria-orientation', isPhone() ? 'horizontal' : 'vertical');
  if (coarse.matches) $('note-hint').innerHTML = 'Tap R1, then slide or type a value such as <kbd>3k</kbd>.';
  buildPalette();
  // Load ngspice first, so the first answer is quick.
  const engineReady = warmUp().catch(() => undefined);
  inkDesc.textContent = model().words;
  buildInk();
  renderLabels();
  updateChecksTab();
  updateNoteVisibility();
  await document.fonts.ready;
  commit();
  await engineReady;

  const shot = state.shot;
  if (shot === 'edit') {
    await runNow();
    openInspector('R1');
    setValue('r1', '3k', 'type');
    window.clearTimeout(sendTimer);
    await runNow();
    updateInspector(true);
  } else if (shot === 'panels') {
    select('R1');
    openPanel('netlist');
    if (!isPhone()) openPanel('explain');
    await runNow();
  } else if (shot === 'check') {
    state.values.r1 = '1M';
    state.noteHidden = true;
    afterValuesChange();
    openPanel('checks');
    await runNow();
  } else {
    await runNow();
  }
  renderPanels();
  await document.fonts.ready;
  await nextFrame();
  syncSheet();
  refit(false);
  await nextFrame();
  syncSheet();
  refit(false);
  if (state.editing) {
    const p = partById(state.selected);
    if (p) state.popAnchor = computePopAnchor(p);
    placeInspector(true);
  }
  if (shot === 'check') showFixes();
  placeScreenThings();
  booted = true;
  await nextFrame();
  if (shot) document.body.dataset.shotReady = '1';
}

void start();
