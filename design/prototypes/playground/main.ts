/**
 * PlainSpice, milestone 2, design direction "Playground": a friendly whiteboard in the spirit of
 * Excalidraw, with Falstad's live feel. The circuit is drawn by hand (rough.ts), ngspice solves it as
 * you play, and the answers sit on the drawing as speech bubbles and sticky notes.
 *
 * Throwaway prototype code for choosing a direction (design/prototypes/). Every number and every
 * sentence about the circuit comes from the real model (../shared/sim.ts: ngspice 47 in a Web
 * Worker, the checks, the explanations) and from the app's number reader (src/spice/numbers.ts,
 * checked against ngspice). This file only draws, animates and wires up the interactions.
 *
 * The view only moves when the student asks it to (drag, zoom, Fit): selecting a part, opening a
 * card or a panel never slides the drawing, so the part you click stays under the pointer.
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
  speakSI,
  warmUp,
  type CurrentWords,
  type Divider,
  type LineExplanation,
  type Solution,
  type Trap,
} from '../shared/sim.ts';
import { formatSpiceNumber, readNumber } from '../../../src/spice/numbers.ts';
import { formatNumber } from '../../../src/format/si.ts';
import { icon, logo } from './icons.ts';
import { checksHTML, esc, explainHTML, netlistHTML, type LineLink } from './panels.ts';
import { curve, polyline, type Pt, type Strokes } from './rough.ts';
import { allPins, box, CONTROLLED, controlledGlyph, drawSymbol, GRID, inkBox, isControlled, KIND, KINDS, pins, toolGlyph, type Kind, type Rot } from './symbols.ts';

// ================================================================== environment

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T => root.querySelector(sel) as T;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(sel)];
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = (): boolean => motionQuery.matches;
/** Phones and tablets in portrait get the touch layout: a dock at the bottom, sheets for panels. */
const phoneQuery = matchMedia('(max-width: 900px)');
const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';
const shot = new URLSearchParams(location.hash.replace(/^#/, '')).get('shot') ?? '';

const app = $('#app');
const canvasEl = $('#canvas');
const board = $<SVGSVGElement>('#board');
const world = $<SVGGElement>('#world');
const labelsEl = $('#labels');
const SVGNS = 'http://www.w3.org/2000/svg';

// ================================================================== the circuit

type Tool = 'select' | 'wire' | Kind;
type PanelId = 'netlist' | 'checks' | 'explain';
type Layout = 'desktop' | 'phone';

interface Part {
  id: string;
  kind: Kind;
  name: string;
  value: string;
  at: Pt;
  rot: Rot;
  /** Wired into the divider (in the netlist and simulated), or only placed on the board. */
  wired: boolean;
}

interface Wire {
  id: string;
  pts: Pt[];
  /** The node the wire belongs to (divider wires); free wires have none yet. */
  node?: string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The first screen: V1, R1, R2 and ground, drawn where a teacher would draw them. */
const DIVIDER: readonly Omit<Part, 'value'>[] = [
  { id: 'v1', kind: 'V', name: 'V1', at: [0, 120], rot: 90, wired: true },
  { id: 'r1', kind: 'R', name: 'R1', at: [120, 0], rot: 0, wired: true },
  { id: 'r2', kind: 'R', name: 'R2', at: [240, 120], rot: 90, wired: true },
  { id: 'gnd', kind: 'GND', name: '0', at: [120, 240], rot: 0, wired: true },
];
/** Which node each pin of the divider's parts sits on (pin A, pin B). */
const DIVIDER_NODES: Record<string, [string, string]> = { v1: ['in', '0'], r1: ['in', 'out'], r2: ['out', '0'] };
/** Wires end exactly on pins and on the ground junction, so every join is a clean join. */
const DIVIDER_WIRES: readonly Wire[] = [
  { id: 'w-in', node: 'in', pts: [[0, 80], [0, 0], [80, 0]] },
  { id: 'w-out', node: 'out', pts: [[160, 0], [240, 0], [240, 80]] },
  { id: 'w-0a', node: '0', pts: [[240, 160], [240, 240], [120, 240]] },
  { id: 'w-0b', node: '0', pts: [[120, 240], [0, 240], [0, 160]] },
];
const JUNCTIONS: readonly Pt[] = [[120, 240]];
/** Where each node's voltage bubble points. */
const PROBES: readonly { node: string; at: Pt }[] = [
  { node: 'in', at: [0, 0] },
  { node: 'out', at: [240, 0] },
];
/**
 * The current arrows on the wires: a point on a wire, the part whose current it shows, and the way
 * it points when that current flows from the part's first node to its second (the netlist order).
 */
const CHEVRONS: readonly { at: Pt; part: string; forward: Pt }[] = [
  { at: [0, 40], part: 'v1', forward: [0, 1] },
  { at: [0, 200], part: 'v1', forward: [0, 1] },
  { at: [40, 0], part: 'r1', forward: [1, 0] },
  { at: [200, 0], part: 'r1', forward: [1, 0] },
  { at: [240, 40], part: 'r2', forward: [0, 1] },
  { at: [240, 200], part: 'r2', forward: [0, 1] },
  { at: [180, 240], part: 'r2', forward: [-1, 0] },
  { at: [60, 240], part: 'r2', forward: [-1, 0] },
];
/** The loop the current goes round (for the moving dots), in the direction of R1's current from in to out. */
const LOOP: readonly Pt[] = [[0, 160], [0, 80], [0, 0], [80, 0], [160, 0], [240, 0], [240, 80], [240, 160], [240, 240], [120, 240], [0, 240], [0, 160]];
/** Where the moving dots fade out: pins, the junction and the probe points (Falstad does the same). */
const QUIET_POINTS: readonly Pt[] = [[0, 80], [0, 160], [80, 0], [160, 0], [240, 80], [240, 160], [120, 240], [0, 0], [240, 0]];
/** The netlist line of each divider part (dividerNetlist writes V1, R1, R2 on lines 2, 3, 4). */
const LINE_OF: Record<string, number> = { v1: 2, r1: 3, r2: 4 };
const LINKS: LineLink[] = [
  { line: 2, partId: 'v1' },
  { line: 3, partId: 'r1' },
  { line: 4, partId: 'r2' },
];
/** The drawing's box in world units, symbols included. */
const DRAWING = { x: -22, y: -12, w: 284, h: 282 };

// ================================================================== state

interface Snapshot {
  values: Divider;
  placed: Part[];
  wires: Wire[];
}

const state = {
  values: { ...FIRST_CIRCUIT } as Divider,
  placed: [] as Part[],
  wires: [] as Wire[],
  tool: 'select' as Tool,
  ghostRot: 0 as Rot,
  ghostAt: undefined as Pt | undefined,
  wireStart: undefined as Pt | undefined,
  selected: undefined as string | undefined,
  hover: undefined as string | undefined,
  cardOpen: false,
  panels: new Set<PanelId>(),
  sheet: undefined as PanelId | undefined,
  /** The phone's panel sheet, made taller with its grip. */
  tall: false,
  live: true,
  invite: true,
  solution: undefined as Solution | undefined,
  pending: false,
  changedLine: undefined as number | undefined,
  layout: (phoneQuery.matches ? 'phone' : 'desktop') as Layout,
  /** The Controlled sources menu (desktop toolbar). */
  menu: false,
  /** The parts sheet (phone dock). */
  partsSheet: false,
  /** "The circuit in words" in the Explain panel, folded while a part is selected. */
  circuitOpen: false,
  /** Whether the student has played with the circuit yet. */
  played: false,
  /** Whether the student has touched the view or the drawing: after that, nothing refits by itself. */
  touched: false,
  /** The first screen keeps room for the invitation until the student asks for Fit, so hiding it moves nothing. */
  inviteBand: true,
};

const netlist = (): string => dividerNetlist(state.values);
let traps: Trap[] = [];
let explanations: LineExplanation[] = [];
let colours = new Map<string, string>();
let circuitWords = '';

function refreshModel(): void {
  const text = netlist();
  traps = check(text);
  explanations = explain(text);
  colours = nodeColours(text);
  circuitWords = describe(text);
  $('#board-desc').textContent = circuitWords;
}

function dividerValue(id: string): string {
  return id === 'v1' ? state.values.v1 : id === 'r1' ? state.values.r1 : id === 'r2' ? state.values.r2 : '';
}

function allParts(): Part[] {
  return [...DIVIDER.map((p) => ({ ...p, value: dividerValue(p.id) })), ...state.placed];
}

function partById(id: string | undefined): Part | undefined {
  return id ? allParts().find((p) => p.id === id) : undefined;
}

const isDivider = (id: string | undefined): boolean => !!id && id in LINE_OF;

/** The model's word for a node in a sentence: node 0 is "ground" (src/spice/describe.ts says so too). */
const nodeWord = (node: string): string => (node === '0' ? 'ground' : node);

/** How ngspice reads a value as written ("1M" → 0.001), from the app's number reader. */
function readValue(text: string): number | undefined {
  const reading = readNumber(text.trim());
  return reading && !reading.rest ? reading.value : undefined;
}

/** A value with its unit, as the drawing shows it ("1 kΩ", "1 mA/V", "× 2"). */
function withUnit(v: number, kind: Kind): string {
  const unit = KIND[kind].unit;
  return unit ? formatSI(v, unit) : `× ${formatNumber(v)}`;
}

/** The same for a screen reader ("1 kilohm", "1 milliamp per volt", "times 2"). */
function spokenValue(v: number, kind: Kind): string {
  const unit = KIND[kind].unit;
  if (unit === 'A/V') return `${speakSI(v, 'A')} per volt`;
  if (unit === 'V/A') return `${speakSI(v, 'V')} per amp`;
  return unit ? speakSI(v, unit) : `times ${formatNumber(v)}`;
}

/** The value as the drawing shows it: what ngspice reads, with its unit ("1 kΩ", "1 mΩ"). */
function displayValue(p: Part): string {
  const v = readValue(p.value);
  if (v === undefined) return p.value.trim() ? p.value.trim() : '?';
  return withUnit(v, p.kind);
}

/** The model's summary, without its last sentence, which points to the old app's Results tab. */
function summaryOf(text: string): string {
  return text.replace(/\s*Open the results for details\.?\s*$/, '');
}

function currentOf(id: string): CurrentWords | undefined {
  return state.solution?.status === 'ok' ? state.solution.currents.find((c) => c.element === id) : undefined;
}

function nodeVoltage(node: string): number | undefined {
  if (node === '0') return 0;
  return state.solution?.status === 'ok' ? state.solution.voltages.get(node) : undefined;
}

function trapsOnLine(line: number | undefined): Trap[] {
  return line === undefined ? [] : traps.filter((t) => t.line === line);
}

/** Whether the numbers on screen are older than the netlist (Live off and something changed). */
function stale(): boolean {
  const s = state.solution;
  return !state.live && !!s && s.netlist !== netlist();
}

// ================================================================== history

const past: Snapshot[] = [];
const future: Snapshot[] = [];
const snapshot = (): Snapshot => structuredClone({ values: state.values, placed: state.placed, wires: state.wires });
let committed = snapshot();
let commitTimer = 0;

function commit(): void {
  clearTimeout(commitTimer);
  const now = snapshot();
  if (JSON.stringify(now) === JSON.stringify(committed)) return;
  past.push(committed);
  if (past.length > 100) past.shift();
  future.length = 0;
  committed = now;
  renderView();
}

function commitSoon(): void {
  clearTimeout(commitTimer);
  commitTimer = window.setTimeout(commit, 700);
}

function restore(s: Snapshot): void {
  const valuesChanged = JSON.stringify(s.values) !== JSON.stringify(state.values);
  state.values = { ...s.values };
  state.placed = structuredClone(s.placed);
  state.wires = structuredClone(s.wires);
  committed = snapshot();
  if (state.selected && !partById(state.selected)) closeSelection();
  refreshModel();
  renderAll();
  fieldBase = partById(state.selected)?.value ?? fieldBase;
  if (valuesChanged) requestSolve(true);
}

function undo(): void {
  commit();
  const s = past.pop();
  if (!s) return toast('Nothing to undo');
  const before = snapshot();
  future.push(before);
  restore(s);
  toast(changeWords(before, s, 'Undone'));
}

function redo(): void {
  const s = future.pop();
  if (!s) return toast('Nothing to redo');
  const before = snapshot();
  past.push(before);
  restore(s);
  toast(changeWords(before, s, 'Redone'));
}

/** Say what came back ("R1 is 1k again"), not just "Undone". */
function changeWords(before: Snapshot, after: Snapshot, fallback: string): string {
  const names: Record<keyof Divider, string> = { v1: 'V1', r1: 'R1', r2: 'R2' };
  for (const key of ['v1', 'r1', 'r2'] as const) {
    if (before.values[key] !== after.values[key]) return `${fallback}: ${names[key]} is ${after.values[key] || 'empty'} again`;
  }
  if (after.placed.length > before.placed.length) return `${fallback}: the part is back`;
  if (after.placed.length < before.placed.length) return `${fallback}: the part is gone`;
  return fallback;
}

// ================================================================== the view

const cam = { x: 0, y: 0, z: 1.6 };
let camAnim = 0;

const toScreen = ([x, y]: Pt): Pt => [x * cam.z + cam.x, y * cam.z + cam.y];
const toWorld = ([x, y]: Pt): Pt => [(x - cam.x) / cam.z, (y - cam.y) / cam.z];
const snap = ([x, y]: Pt): Pt => [Math.round(x / GRID) * GRID, Math.round(y / GRID) * GRID];

/** Labels keep a readable size: they grow and shrink a little with the zoom, never as much as the drawing. */
function labelScale(z = cam.z): number {
  return state.layout === 'phone' ? clamp(z / 1.12, 0.8, 0.98) : clamp(z / 1.8, 0.84, 1.08);
}

/** The part of the screen the drawing may use: the window minus the islands, open panels and the dock. */
function freeRect(): Rect {
  const W = window.innerWidth;
  const H = window.innerHeight;
  if (state.layout === 'phone') {
    const top = ($('.topbar').getBoundingClientRect().bottom || 56) + 10;
    const dockTop = $('#dock').getBoundingClientRect().top || H - 76;
    return { x: 6, y: top, w: W - 12, h: dockTop - top - 12 };
  }
  const right = state.panels.size ? panelColumnWidth() + 32 : 16;
  const top = 92;
  const bottom = 76;
  return { x: 16, y: top, w: W - 16 - right, h: H - top - bottom };
}

function panelColumnWidth(): number {
  return Math.min(380, window.innerWidth * 0.32);
}

function boundsOfDrawing(): Rect {
  let { x, y, w, h } = DRAWING;
  let x2 = x + w;
  let y2 = y + h;
  for (const p of state.placed) {
    const b = box(p.kind, p.at, p.rot);
    x = Math.min(x, b.x - 10);
    y = Math.min(y, b.y - 10);
    x2 = Math.max(x2, b.x + b.w + 10);
    y2 = Math.max(y2, b.y + b.h + 10);
  }
  for (const wire of state.wires) for (const [px, py] of wire.pts) {
    x = Math.min(x, px - 10);
    y = Math.min(y, py - 10);
    x2 = Math.max(x2, px + 10);
    y2 = Math.max(y2, py + 10);
  }
  return { x, y, w: x2 - x, h: y2 - y };
}

/** Where a label's box sits around its anchor, in label pixels (before the label scale). */
function labelOffsets(def: LabelDef, node: HTMLElement): { x0: number; y0: number; x1: number; y1: number } | undefined {
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  if (!w) return undefined;
  return { x0: def.dx - def.ax * w, y0: def.dy - def.ay * h, x1: def.dx + (1 - def.ax) * w, y1: def.dy + (1 - def.ay) * h };
}

/**
 * The drawing and its labels at zoom z, relative to the camera's origin: what Fit must keep on
 * screen. On a desktop the invitation above R1 counts too, so it has its band from the start and
 * hiding it moves nothing.
 */
/** The invitation's last measured size (it keeps its band after it is hidden). */
let inviteSize = { w: 400, h: 150 };

function contentBounds(z: number, withInvite = true): { x0: number; y0: number; x1: number; y1: number } {
  const k = labelScale(z);
  const d = boundsOfDrawing();
  const b = { x0: d.x * z, y0: d.y * z, x1: (d.x + d.w) * z, y1: (d.y + d.h) * z };
  for (const { def, el: node } of labelEls.values()) {
    if (def.fit === false) continue;
    const o = labelOffsets(def, node);
    if (!o) continue;
    b.x0 = Math.min(b.x0, def.anchor[0] * z + o.x0 * k);
    b.x1 = Math.max(b.x1, def.anchor[0] * z + o.x1 * k);
    b.y0 = Math.min(b.y0, def.anchor[1] * z + o.y0 * k);
    b.y1 = Math.max(b.y1, def.anchor[1] * z + o.y1 * k);
  }
  const band = state.layout === 'desktop' ? state.inviteBand : inviteShown();
  if (withInvite && band) {
    const inv = $('#invite');
    if (inv.offsetHeight) inviteSize = { w: inv.offsetWidth, h: inv.offsetHeight };
    const { w, h } = inviteSize;
    if (state.layout === 'desktop') {
      const top = R1_ROW_ANCHOR[1] * z + inviteBottomOffset(k) - h;
      b.y0 = Math.min(b.y0, top);
      b.x0 = Math.min(b.x0, R1_ROW_ANCHOR[0] * z - w / 2);
      b.x1 = Math.max(b.x1, R1_ROW_ANCHOR[0] * z + w / 2);
    } else {
      b.y1 += INVITE_GAP_PHONE + h;
    }
  }
  return b;
}

function fitTarget(): { x: number; y: number; z: number } {
  const r = freeRect();
  // Phones are limited by their width; tablets in portrait may draw the circuit as big as a desktop does.
  const maxZ = state.layout === 'phone' ? (window.innerWidth < 520 ? 1.3 : 1.9) : 1.95;
  const fits = (z: number): boolean => {
    const b = contentBounds(z);
    return b.x1 - b.x0 <= r.w && b.y1 - b.y0 <= r.h;
  };
  let z = maxZ;
  if (!fits(z)) {
    let lo = 0.3;
    let hi = maxZ;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    z = lo;
  }
  const b = contentBounds(z);
  const x = r.x + (r.w - (b.x1 - b.x0)) / 2 - b.x0;
  // A phone keeps the drawing at the top, clear of the sheets that rise from the bottom.
  const y = state.layout === 'phone' ? r.y - b.y0 : r.y + Math.max(0, (r.h - (b.y1 - b.y0)) / 2) - b.y0;
  return { x, y, z };
}

/**
 * Fit the drawing in view. Only on load, on resize, and when the student asks (Fit, Shift+1); when
 * they ask, the invitation's band is given back if the invitation has gone.
 */
function fit(animate = true, asked = false): void {
  if (asked) state.inviteBand = inviteShown();
  moveCamera(fitTarget(), animate);
}

function moveCamera(to: { x: number; y: number; z: number }, animate: boolean): void {
  cancelAnimationFrame(camAnim);
  const from = { ...cam };
  const same = Math.abs(from.x - to.x) < 0.5 && Math.abs(from.y - to.y) < 0.5 && Math.abs(from.z - to.z) < 0.001;
  if (!animate || reduced() || same) {
    Object.assign(cam, to);
    applyCamera();
    return;
  }
  const t0 = performance.now();
  const dur = 320;
  const stepFrame = (t: number): void => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    cam.x = from.x + (to.x - from.x) * e;
    cam.y = from.y + (to.y - from.y) * e;
    cam.z = from.z + (to.z - from.z) * e;
    applyCamera();
    if (k < 1) camAnim = requestAnimationFrame(stepFrame);
  };
  camAnim = requestAnimationFrame(stepFrame);
}

function applyCamera(): void {
  world.setAttribute('transform', `translate(${cam.x.toFixed(2)} ${cam.y.toFixed(2)}) scale(${cam.z.toFixed(4)})`);
  const g = GRID * cam.z;
  canvasEl.style.setProperty('--grid', `${g.toFixed(2)}px`);
  canvasEl.style.setProperty('--grid-x', `${(cam.x % g).toFixed(2)}px`);
  canvasEl.style.setProperty('--grid-y', `${(cam.y % g).toFixed(2)}px`);
  canvasEl.style.setProperty('--zoom', cam.z.toFixed(3));
  positionLabels();
  positionInvite();
  positionCard();
  const zoomOut = document.getElementById('zoom-level');
  if (zoomOut) zoomOut.textContent = `${Math.round((cam.z / 1.6) * 100)}%`;
  hintFit();
}

/** Light up Fit when part of the drawing is under a panel or off screen (the view never moves by itself). */
function hintFit(): void {
  const btn = document.getElementById('btn-fit');
  if (!btn || state.layout === 'phone') return;
  const r = freeRect();
  const b = contentBounds(cam.z, false);
  const out = cam.x + b.x0 < r.x - 2 || cam.x + b.x1 > r.x + r.w + 2 || cam.y + b.y0 < r.y - 30 || cam.y + b.y1 > r.y + r.h + 30;
  btn.classList.toggle('is-hinting', out);
  btn.setAttribute('aria-label', out ? 'Fit the circuit in view: part of it is hidden' : 'Fit the circuit in view');
}

function zoomAt(factor: number, at: Pt, animate = false): void {
  const z = clamp(cam.z * factor, 0.35, 4);
  const [wx, wy] = toWorld(at);
  const to = { x: at[0] - wx * z, y: at[1] - wy * z, z };
  if (animate) return moveCamera(to, true);
  Object.assign(cam, to);
  applyCamera();
}

// ================================================================== drawing the board

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.append(node);
  return node;
}

function strokes(parent: Element, s: Strokes, cls: string, fill?: string): void {
  el('path', { d: s.main, class: `ink ${cls}`, ...(fill ? { fill } : {}) }, parent);
  el('path', { d: s.retrace, class: `ink ink--re ${cls}`, ...(fill ? { fill } : {}) }, parent);
}

function nodeColourOf(node: string | undefined): string | undefined {
  return node ? colours.get(node) : undefined;
}

/**
 * The area a part's selection mark covers: the highlighter swash from pin to pin (with its round
 * ends) and the symbol's ink. The keyboard focus frame is drawn round it, so frame and swash line up.
 */
function markRect(p: Part): Rect {
  const b = inkBox(p.kind, p.at, p.rot);
  const ends = swashEnds(p);
  const half = SWASH_WIDTH / 2;
  const x0 = Math.min(b.x, ends[0][0] - half, ends[1][0] - half);
  const y0 = Math.min(b.y, ends[0][1] - half, ends[1][1] - half);
  const x1 = Math.max(b.x + b.w, ends[0][0] + half, ends[1][0] + half);
  const y1 = Math.max(b.y + b.h, ends[0][1] + half, ends[1][1] + half);
  const pad = 3;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

const SWASH_WIDTH = 30;

function swashEnds(p: Part): [Pt, Pt] {
  const ps = pins(p.kind, p.at, p.rot);
  if (p.kind === 'GND') return [ps[0]!, [p.at[0], p.at[1] + 26]];
  return [ps[0]!, ps[1]!];
}

function renderBoard(): void {
  const wires = $<SVGGElement>('#layer-wires');
  const parts = $<SVGGElement>('#layer-parts');
  wires.replaceChildren();
  parts.replaceChildren();

  for (const w of [...DIVIDER_WIRES, ...state.wires]) {
    const g = el('g', { class: `wire${w.node === '0' ? ' wire--ground' : ''}${w.node ? '' : ' wire--free'}` }, wires);
    const c = nodeColourOf(w.node);
    if (c) g.setAttribute('style', `--node:${c}`);
    strokes(g, polyline(w.pts, { seed: w.id, rough: 0.7, anchored: true }), '');
  }
  for (const j of JUNCTIONS) el('circle', { cx: j[0], cy: j[1], r: 5.6, class: 'junction' }, wires);
  for (const p of PROBES) {
    const c = nodeColourOf(p.node);
    el('circle', { cx: p.at[0], cy: p.at[1], r: 5.2, class: 'probe', style: c ? `--node:${c}` : '' }, wires);
  }

  for (const p of allParts()) {
    const g = el('g', { class: `part part--${p.kind.toLowerCase()}${p.wired ? '' : ' part--loose'}`, 'data-id': p.id }, parts);
    const hit = box(p.kind, p.at, p.rot);
    el('rect', { class: 'part__hit', x: hit.x - 6, y: hit.y - 6, width: hit.w + 12, height: hit.h + 12, rx: 12 }, g);
    const m = markRect(p);
    el('rect', { class: 'part__frame', x: m.x, y: m.y, width: m.w, height: m.h, rx: 16 }, g);
    const ink = el('g', { class: 'part__ink' }, g);
    for (const mark of drawSymbol(p.kind, p.at, p.rot, p.id)) strokes(ink, mark, '', mark.fill);
    if (!p.wired) {
      // Not wired yet: its pins are open circles, like an unconnected pin in LTspice.
      for (const pin of allPins(p.kind, p.at, p.rot)) el('circle', { cx: pin[0], cy: pin[1], r: 3.3, class: 'open-pin' }, ink);
    }
    if (p.kind !== 'GND' || !p.wired) {
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', partAriaLabel(p));
      g.setAttribute('aria-haspopup', 'dialog');
      g.setAttribute('aria-expanded', String(state.cardOpen && state.selected === p.id));
    }
    if (trapsOnLine(LINE_OF[p.id]).length) g.classList.add('has-trap');
  }
  renderSelection();
  renderGhost();
  renderArrows();
  renderFlowPath();
}

function partAriaLabel(p: Part): string {
  const info = KIND[p.kind];
  if (p.kind === 'GND') return 'Ground, node 0. Not wired yet.';
  const v = readValue(p.value);
  const spoken = v === undefined ? `written ${p.value || 'with no value'}` : spokenValue(v, p.kind);
  const c = currentOf(p.id);
  const flow = c ? ` ${c.speech}.` : '';
  const loose = p.wired ? '' : ' Not wired yet.';
  return `${p.name}, ${info.word.toLowerCase()}, ${spoken}.${flow}${loose} Press Enter to change it.`;
}

/** The yellow highlighter swash behind the selected part (light yellow under the pointer). One mark, nothing else. */
function renderSelection(): void {
  const swash = $<SVGGElement>('#layer-swash');
  swash.replaceChildren();
  const p = partById(state.selected);
  // While the invitation asks for R1, R1 wears a light highlighter mark: the same R1 as in the words.
  const hoverId = state.hover ?? (inviteShown() && !state.selected ? 'r1' : undefined);
  const hover = hoverId && hoverId !== state.selected ? partById(hoverId) : undefined;
  for (const q of [hover, p]) {
    if (!q) continue;
    const [a, b] = swashEnds(q);
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const s = curve([a, mid, b], { seed: `${q.id}:swash`, rough: 1.2 });
    el('path', { d: s.main, class: q === p ? 'swash' : 'swash swash--hover', 'stroke-width': SWASH_WIDTH }, swash);
  }
  $$('.part', board).forEach((g) => g.classList.toggle('is-selected', g.getAttribute('data-id') === state.selected));
}

function renderGhost(): void {
  const ghost = $<SVGGElement>('#layer-ghost');
  ghost.replaceChildren();
  const at = state.ghostAt;
  if (!at) return;
  if (state.tool === 'wire') {
    const start = state.wireStart;
    if (start) {
      const pts: Pt[] = [start, [at[0], start[1]], at];
      strokes(el('g', { class: 'ghost ghost--wire' }, ghost), polyline(pts, { seed: 'ghost-wire', rough: 0.5, anchored: true }), '');
      el('circle', { cx: start[0], cy: start[1], r: 4, class: 'ghost-dot' }, ghost);
    }
    el('circle', { cx: at[0], cy: at[1], r: 4, class: 'ghost-dot' }, ghost);
    return;
  }
  if (state.tool === 'select') return;
  const g = el('g', { class: 'ghost' }, ghost);
  for (const m of drawSymbol(state.tool, at, state.ghostRot, 'ghost')) strokes(g, m, '', m.fill);
  for (const pin of allPins(state.tool, at, state.ghostRot)) el('circle', { cx: pin[0], cy: pin[1], r: 3.2, class: 'ghost-pin' }, ghost);
}

// ------------------------------------------------------------------ current arrows on the wires

/** Which way a part's current points on screen, or undefined when there is none to show. */
function currentDirection(part: string, forward: Pt): Pt | undefined {
  const c = currentOf(part);
  const nodes = DIVIDER_NODES[part];
  if (!c || !nodes || Math.abs(c.value) < 1e-15) return undefined;
  const sign = c.from === nodes[0] ? 1 : -1;
  return [forward[0] * sign, forward[1] * sign];
}

/** Hand-drawn chevrons on the wires, pointing the way the current flows (the brief's "current arrows"). */
function renderArrows(): void {
  const layer = $<SVGGElement>('#layer-arrows');
  layer.replaceChildren();
  for (const ch of CHEVRONS) {
    const dir = currentDirection(ch.part, ch.forward);
    if (!dir) continue;
    const [dx, dy] = dir;
    const [px, py] = [-dy, dx];
    const [x, y] = ch.at;
    const tip: Pt = [x + dx * 3.6, y + dy * 3.6];
    const w1: Pt = [x - dx * 3.6 + px * 4.6, y - dy * 3.6 + py * 4.6];
    const w2: Pt = [x - dx * 3.6 - px * 4.6, y - dy * 3.6 - py * 4.6];
    const g = el('g', { class: 'chev' }, layer);
    const s = polyline([w1, tip, w2], { seed: `chev:${x}:${y}:${dx}:${dy}`, rough: 0.3 });
    el('path', { d: s.main, class: 'chev__ink' }, g);
  }
}

// ------------------------------------------------------------------ current flow (Falstad's dots)

const flow = { dots: [] as SVGCircleElement[], offset: 0, speed: 0, dir: 1, length: 0, raf: 0, last: 0, cum: [] as number[] };

function renderFlowPath(): void {
  const layer = $<SVGGElement>('#layer-flow');
  layer.replaceChildren();
  flow.cum = [0];
  for (let i = 1; i < LOOP.length; i++) flow.cum.push(flow.cum[i - 1]! + Math.hypot(LOOP[i]![0] - LOOP[i - 1]![0], LOOP[i]![1] - LOOP[i - 1]![1]));
  flow.length = flow.cum[flow.cum.length - 1]!;
  const spacing = 26;
  flow.dots = [];
  for (let i = 0; i < Math.floor(flow.length / spacing); i++) flow.dots.push(el('circle', { r: 2.1, class: 'flow-dot' }, layer));
  updateFlow();
}

function pointOnLoop(s: number): Pt {
  const L = flow.length;
  s = ((s % L) + L) % L;
  let i = 1;
  while (i < flow.cum.length - 1 && flow.cum[i]! < s) i++;
  const a = LOOP[i - 1]!;
  const b = LOOP[i]!;
  const seg = flow.cum[i]! - flow.cum[i - 1]!;
  const k = seg ? (s - flow.cum[i - 1]!) / seg : 0;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/** Dots stay on the wires: inside a symbol they would scribble over it. */
function insideSymbol([x, y]: Pt): boolean {
  return (Math.abs(x) < 2 && Math.abs(y - 120) < 41) || (Math.abs(y) < 2 && Math.abs(x - 120) < 41) || (Math.abs(x - 240) < 2 && Math.abs(y - 120) < 41);
}

/** 0 at a pin or junction, 1 from 14 units away: dots fade in and out instead of piling up on joins. */
function quietness([x, y]: Pt): number {
  let d = Infinity;
  for (const [qx, qy] of QUIET_POINTS) d = Math.min(d, Math.hypot(x - qx, y - qy));
  const t = clamp((d - 3) / 14, 0, 1);
  return t * t * (3 - 2 * t);
}

function updateFlow(): void {
  const c = currentOf('r1');
  // With reduced motion there are no dots at all: the chevrons on the wires show the direction.
  const on = !!c && Math.abs(c.value) > 1e-12 && !reduced() && !stale();
  $('#layer-flow').classList.toggle('is-on', on);
  if (c) {
    // Speed grows with the square root of the current, so 1.2 mA visibly crawls next to 2 mA.
    flow.speed = clamp(38 * Math.sqrt(Math.abs(c.value) / 2e-3), 4, 150);
    flow.dir = c.from === 'in' ? 1 : -1;
  } else flow.speed = 0;
  cancelAnimationFrame(flow.raf);
  if (!on) return;
  placeDots();
  flow.last = performance.now();
  const tick = (t: number): void => {
    const dt = Math.min(0.05, (t - flow.last) / 1000);
    flow.last = t;
    flow.offset += flow.speed * flow.dir * dt;
    placeDots();
    flow.raf = requestAnimationFrame(tick);
  };
  flow.raf = requestAnimationFrame(tick);
}

function placeDots(): void {
  const spacing = flow.length / Math.max(1, flow.dots.length);
  flow.dots.forEach((d, i) => {
    const p = pointOnLoop(i * spacing + flow.offset);
    d.setAttribute('cx', p[0].toFixed(2));
    d.setAttribute('cy', p[1].toFixed(2));
    d.style.opacity = insideSymbol(p) ? '0' : (0.62 * quietness(p)).toFixed(3);
  });
}

// ================================================================== labels on the drawing

interface LabelDef {
  key: string;
  anchor: Pt;
  dx: number;
  dy: number;
  /** Alignment of the label against its anchor: 0 = its left/top edge, 1 = its right/bottom edge. */
  ax: number;
  ay: number;
  cls: string;
  html: () => string;
  /** Numbers in the label that animate when they change: [selector, value, unit, final text]. */
  nums?: () => [string, number, string, string][];
  part?: string;
  /** Kept inside the window (bubbles and notes whose width changes with the numbers). */
  clamp?: boolean;
  /** Left out when fitting the view (notes that come and go). */
  fit?: boolean;
}

/** R1's name, value and current sit in one row above R1, so its card can point straight at R1. */
const R1_ROW_ANCHOR: Pt = [120, -19];
/** The gap between the invitation and R1's row (the hand-drawn arrow lives there). */
const INVITE_GAP = 46;
const INVITE_GAP_PHONE = 22;

const tilt = (key: string): number => {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 5) - 2) * 0.6;
};

function arrowSvg(angle: number): string {
  return `<svg class="flow-arrow" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="transform:rotate(${angle}deg)"><path d="M4 12.5c4-.4 9.5-.6 15-.2M13.5 6.5c2.2 2 4 3.7 5.8 5.6-1.9 1.8-3.8 3.6-5.6 5.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Which way a part's current goes on screen, in degrees (0 = right, 90 = down). */
function currentAngle(p: Part, c: CurrentWords): number {
  const nodes = DIVIDER_NODES[p.id];
  const [a, b] = pins(p.kind, p.at, p.rot) as [Pt, Pt];
  const forward = nodes ? c.from === nodes[0] : c.value >= 0;
  const [from, to] = forward ? [a, b] : [b, a];
  return (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
}

function quantity(c: CurrentWords): string {
  return formatSI(Math.abs(c.value), 'A');
}

function currentSticky(id: string): string {
  const p = partById(id)!;
  const c = currentOf(id);
  if (!c) return `<span class="sticky sticky--current is-empty" style="--tilt:${tilt(id)}deg"><span class="sticky__num">—</span></span>`;
  if (Math.abs(c.value) < 1e-15) return `<span class="sticky sticky--current" style="--tilt:${tilt(id)}deg"><span class="sticky__num">no current</span></span>`;
  return `<span class="sticky sticky--current" style="--tilt:${tilt(id)}deg">${arrowSvg(currentAngle(p, c))}<span class="sticky__num" data-num="cur-${id}">${esc(quantity(c))}</span></span>`;
}

/** The model's words for a source's power ("V1 delivers 12 mW"), without the name the label already shows. */
function powerSticky(id: string, twoLines = false): string {
  const c = currentOf(id);
  const power = c?.power;
  if (!power) return '';
  const name = partById(id)?.name ?? '';
  const words = power.text.startsWith(`${name} `) ? power.text.slice(name.length + 1) : power.text;
  const verb = words.replace(/\s*\S+\s\S+$/, '');
  return `<span class="sticky sticky--power${twoLines ? ' sticky--stack' : ''}" style="--tilt:${-tilt(id)}deg">${icon('bolt', 15)}<span class="sticky__words"><span class="sticky__verb">${esc(verb)}</span> <b data-num="pow-${id}">${esc(formatSI(power.watts, 'W'))}</b></span></span>`;
}

function partName(id: string): string {
  const p = partById(id)!;
  const trap = trapsOnLine(LINE_OF[id]).length > 0;
  return `<span class="pl__name">${esc(p.name)}</span><span class="pl__value${trap ? ' is-trap' : ''}">${esc(displayValue(p))}${trap ? icon('warn', 15, 'pl__warn') : ''}</span>`;
}

function nodeBubble(node: string): string {
  const n = state.solution?.status === 'ok' ? state.solution.nodes.find((x) => x.node === node) : undefined;
  const c = nodeColourOf(node) ?? 'var(--ink)';
  const text = n ? n.text : state.solution && state.solution.status !== 'ok' ? 'no answer' : '…';
  return `<span class="bubble" style="--node:${c}"><span class="bubble__name"><i class="bubble__dot" aria-hidden="true"></i>${esc(node)}</span><span class="bubble__num${n ? '' : ' is-none'}" data-num="v-${node}">${esc(text)}</span></span>`;
}

function nodeNums(node: string): () => [string, number, string, string][] {
  return () => {
    const n = state.solution?.nodes.find((x) => x.node === node);
    return n && state.solution?.status === 'ok' ? [[`[data-num="v-${node}"]`, n.value, 'V', n.text]] : [];
  };
}

function curNums(...ids: string[]): () => [string, number, string, string][] {
  return () => {
    const out: [string, number, string, string][] = [];
    for (const id of ids) {
      const c = currentOf(id);
      if (c) out.push([`[data-num="cur-${id}"]`, Math.abs(c.value), 'A', quantity(c)]);
      if (c?.power) out.push([`[data-num="pow-${id}"]`, c.power.watts, 'W', formatSI(c.power.watts, 'W')]);
    }
    return out;
  };
}

function labelDefs(): LabelDef[] {
  const phone = state.layout === 'phone';
  const defs: LabelDef[] = [
    {
      key: 'node-in',
      anchor: [0, 0],
      dx: phone ? 0 : -8,
      dy: phone ? -12 : -10,
      ax: phone ? 0.5 : 1,
      ay: 1,
      cls: `lab lab--bubble ${phone ? 'tail-c' : 'tail-br'}`,
      html: () => nodeBubble('in'),
      nums: nodeNums('in'),
      clamp: true,
    },
    {
      key: 'node-out',
      anchor: [240, 0],
      dx: phone ? 0 : 8,
      dy: phone ? -12 : -10,
      ax: phone ? 0.5 : 0,
      ay: 1,
      cls: `lab lab--bubble ${phone ? 'tail-c' : 'tail-bl'}`,
      html: () => nodeBubble('out'),
      nums: nodeNums('out'),
      clamp: true,
    },
    { key: 'gnd', anchor: [136, 262], dx: 4, dy: 0, ax: 0, ay: 0.5, cls: 'lab lab--ground', html: () => `<span class="gnd-tag">0 <span>ground</span></span>` },
  ];
  if (phone) {
    // Names and values outside the loop, the notes just inside it beside their part (textbook style):
    // on a 390 px screen, note columns outside would cost the circuit a third of its size.
    defs.push(
      {
        key: 'group-r1',
        anchor: [120, 16],
        dx: 0,
        dy: 5,
        ax: 0.5,
        ay: 0,
        cls: 'lab lab--group lab--center',
        html: () => `<span class="lab--part lab--row">${partName('r1')}</span>${currentSticky('r1')}`,
        nums: curNums('r1'),
        part: 'r1',
      },
      { key: 'name-v1', anchor: [-21, 120], dx: -6, dy: 0, ax: 1, ay: 0.5, cls: 'lab lab--part lab--right', html: () => partName('v1'), part: 'v1' },
      { key: 'name-r2', anchor: [252, 120], dx: 6, dy: 0, ax: 0, ay: 0.5, cls: 'lab lab--part', html: () => partName('r2'), part: 'r2' },
      {
        key: 'notes-v1',
        anchor: [21, 112],
        dx: 8,
        dy: 0,
        ax: 0,
        ay: 0.5,
        cls: 'lab lab--group',
        html: () => `${currentSticky('v1')}${powerSticky('v1', true)}`,
        nums: curNums('v1'),
        part: 'v1',
      },
      // R2's note sits by R2's lower lead, next to its arrow: never on the same row as V1's two notes.
      { key: 'notes-r2', anchor: [231, 166], dx: -8, dy: 0, ax: 1, ay: 0.5, cls: 'lab lab--group lab--right', html: () => currentSticky('r2'), nums: curNums('r2'), part: 'r2' },
    );
  } else {
    defs.push(
      {
        key: 'row-r1',
        anchor: R1_ROW_ANCHOR,
        dx: 0,
        dy: -4,
        ax: 0.5,
        ay: 1,
        cls: 'lab lab--part lab--row lab--r1',
        html: () => `${partName('r1')}${currentSticky('r1')}`,
        nums: curNums('r1'),
        part: 'r1',
      },
      {
        key: 'group-v1',
        anchor: [-22, 120],
        dx: -14,
        dy: 0,
        ax: 1,
        ay: 0.5,
        cls: 'lab lab--group lab--right',
        html: () => `<span class="lab--part">${partName('v1')}</span>${currentSticky('v1')}${powerSticky('v1')}`,
        nums: curNums('v1'),
        part: 'v1',
      },
      {
        key: 'group-r2',
        anchor: [254, 120],
        dx: 14,
        dy: 0,
        ax: 0,
        ay: 0.5,
        cls: 'lab lab--group',
        html: () => `<span class="lab--part">${partName('r2')}</span>${currentSticky('r2')}`,
        nums: curNums('r2'),
        part: 'r2',
      },
    );
  }
  // Parts placed on the board: their name and value beside them ("not wired yet" is said in their card).
  for (const p of state.placed) {
    const b = box(p.kind, p.at, p.rot);
    const vertical = p.rot === 90 || p.rot === 270;
    const side = p.kind === 'GND' || vertical;
    const anchor: Pt = side ? [b.x + b.w + 8, p.kind === 'GND' ? b.y + b.h / 2 : p.at[1]] : [p.at[0], b.y - 8];
    defs.push({
      key: `name-${p.id}`,
      anchor,
      dx: side ? 6 : 0,
      dy: side ? 0 : -2,
      ax: side ? 0 : 0.5,
      ay: side ? 0.5 : 1,
      cls: `lab lab--part lab--loose${side ? '' : ' lab--row'}`,
      html: () => (p.kind === 'GND' ? `<span class="gnd-tag">0 <span>ground</span></span>` : `<span class="pl__name">${esc(p.name)}</span><span class="pl__value">${esc(displayValue(p))}</span>`),
      part: p.id,
      fit: false,
    });
  }
  // A beginner trap on a divider part: a note on the drawing that points to the fix.
  for (const t of traps) {
    const link = LINKS.find((l) => l.line === t.line);
    if (!link || (state.cardOpen && state.selected === link.partId) || panelOpen('checks')) continue;
    const p = partById(link.partId)!;
    const where: Record<string, { anchor: Pt; dx: number; dy: number; ax: number; ay: number }> = phone
      ? { r1: { anchor: [120, 12], dx: 0, dy: 64, ax: 0.5, ay: 0 }, v1: { anchor: [21, 170], dx: 8, dy: 0, ax: 0, ay: 0 }, r2: { anchor: [229, 170], dx: -8, dy: 0, ax: 1, ay: 0 } }
      : { r1: { anchor: [120, 12], dx: 0, dy: 12, ax: 0.5, ay: 0 }, v1: { anchor: [22, 120], dx: 14, dy: 0, ax: 0, ay: 0.5 }, r2: { anchor: [228, 120], dx: -14, dy: 0, ax: 1, ay: 0.5 } };
    const at = where[link.partId]!;
    defs.push({
      key: `trap-${t.id}-${t.line}${phone ? '-chip' : ''}`,
      ...at,
      cls: 'lab lab--trap',
      fit: false,
      html: () =>
        phone
          ? `<button type="button" class="trap-chip trap-chip--${t.severity}" data-open-checks="1">${icon(t.severity === 'error' ? 'error' : 'warn', 16)}<span>${esc(p.name)}: see the check</span></button>`
          : `<span class="trap-note trap-note--${t.severity}">${icon(t.severity === 'error' ? 'error' : 'warn', 16)}<span class="trap-note__text"><b>${esc(p.name)}:</b> ${esc(t.title)}</span><button type="button" class="trap-note__btn" data-open-checks="1">See the fix</button></span>`,
    });
  }
  return defs;
}

const labelEls = new Map<string, { def: LabelDef; el: HTMLElement; html: string }>();
const lastNums = new Map<string, number>();

function renderLabels(): void {
  const defs = labelDefs();
  const keep = new Set(defs.map((d) => d.key));
  for (const [key, entry] of labelEls) {
    if (!keep.has(key)) {
      entry.el.remove();
      labelEls.delete(key);
    }
  }
  for (const def of defs) {
    let entry = labelEls.get(def.key);
    if (!entry) {
      const node = document.createElement('div');
      node.dataset.key = def.key;
      if (def.part) node.dataset.part = def.part;
      labelsEl.append(node);
      entry = { def, el: node, html: '' };
      labelEls.set(def.key, entry);
    }
    entry.def = def;
    entry.el.className = `${def.cls}${def.part && def.part === state.selected ? ' is-selected' : ''}`;
    const html = def.html();
    const nums = def.nums?.() ?? [];
    if (html !== entry.html) {
      // Keep the previous numbers on screen for a moment and count to the new ones.
      const previous = nums.map(([sel]) => lastNums.get(`${def.key}${sel}`));
      entry.el.innerHTML = html;
      entry.html = html;
      nums.forEach(([sel, value, unit, text], i) => {
        const target = entry!.el.querySelector<HTMLElement>(sel);
        const before = previous[i];
        if (target && before !== undefined && before !== value) {
          tweenNumber(target, before, value, unit, text);
          pop(target.closest<HTMLElement>('.bubble, .sticky, .lab--part') ?? target);
        }
      });
    }
    for (const [sel, value] of nums) lastNums.set(`${def.key}${sel}`, value);
  }
  positionLabels();
  renderResultsText();
}

function positionLabels(): void {
  const k = labelScale();
  const W = window.innerWidth;
  for (const { def, el: node } of labelEls.values()) {
    const [sx, sy] = toScreen(def.anchor);
    let x = sx + def.dx * k;
    const y = sy + def.dy * k;
    if (def.clamp) {
      // A bubble whose number grew keeps inside the window; its tail still points at its node.
      const w = node.offsetWidth * k;
      const left = x - def.ax * w;
      const shift = Math.max(0, 8 - left) - Math.max(0, left + w - (W - 8));
      x += shift;
      node.style.setProperty('--tail-shift', `${(-shift / k).toFixed(1)}px`);
    }
    node.style.transformOrigin = `${def.ax * 100}% ${def.ay * 100}%`;
    node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(${-def.ax * 100}%, ${-def.ay * 100}%) scale(${k.toFixed(3)})`;
  }
}

function tweenNumber(target: HTMLElement, from: number, to: number, unit: string, finalText: string): void {
  if (reduced() || !Number.isFinite(from) || !Number.isFinite(to)) {
    target.textContent = finalText;
    return;
  }
  const t0 = performance.now();
  const dur = 380;
  const logLerp = from > 0 && to > 0;
  const frame = (t: number): void => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    const v = logLerp ? from * Math.pow(to / from, e) : from + (to - from) * e;
    if (!target.isConnected) return;
    target.textContent = k < 1 ? formatSI(v, unit, 3) : finalText;
    if (k < 1) requestAnimationFrame(frame);
  };
  target.textContent = formatSI(from, unit, 3);
  requestAnimationFrame(frame);
}

function pop(target: HTMLElement): void {
  if (reduced()) return;
  target.classList.remove('is-bumped');
  void target.offsetWidth;
  target.classList.add('is-bumped');
}

/** The results in words for screen readers, next to the drawing (the bubbles themselves are decoration). */
function renderResultsText(): void {
  const s = state.solution;
  const out = $('#results-text');
  if (!s) {
    out.textContent = 'ngspice is solving the circuit.';
    return;
  }
  if (s.status !== 'ok') {
    out.textContent = summaryOf(s.words.summary);
    return;
  }
  out.innerHTML = `<p>${esc(summaryOf(s.words.summary))}</p><ul>${[
    ...s.nodes.map((n) => `<li>${esc(n.node)}: ${esc(n.speech)}</li>`),
    ...s.currents.map((c) => `<li>${esc(c.speech)}${c.power ? `; ${esc(c.power.speech)}` : ''}</li>`),
  ].join('')}</ul>`;
}

// ================================================================== the invitation

function inviteShown(): boolean {
  return state.invite && !state.cardOpen && !(state.layout === 'phone' && (state.sheet || state.partsSheet));
}

/** How far the invitation's bottom sits from R1's row anchor (desktop), in screen pixels. */
function inviteBottomOffset(k: number): number {
  const row = labelEls.get('row-r1');
  const rowH = row?.el.offsetHeight || 30;
  return (-4 - rowH) * k - INVITE_GAP;
}

function renderInvite(): void {
  const node = $('#invite');
  const wasHidden = node.hidden;
  node.hidden = !inviteShown();
  if (wasHidden !== node.hidden) renderSelection();
  node.classList.toggle('is-phone', state.layout === 'phone');
  if (node.hidden) {
    $('#layer-screen').replaceChildren();
    return;
  }
  if (!node.dataset.ready) {
    node.dataset.ready = '1';
    node.innerHTML = `
      <button class="invite__close" type="button" data-action="dismiss-invite" aria-label="Hide this tip">${icon('close', 16)}</button>
      <h2 class="invite__title" id="invite-title">Change <mark>R1</mark> and watch the numbers move!</h2>
      <div class="invite__row">
        <label class="invite__label" for="invite-range">R1</label>
        <input id="invite-range" class="range" type="range" min="0" max="1" step="1" />
        <output class="invite__value" id="invite-value" for="invite-range"></output>
      </div>
      <p class="invite__or"><span class="invite__or-desk">or click <b>R1</b> on the drawing to type a value</span><span class="invite__or-phone">or tap <b>R1</b> on the drawing to type a value</span></p>`;
    const range = $<HTMLInputElement>('#invite-range', node);
    bindRange(range, () => partById('r1')!, (text) => {
      state.played = true;
      setValue('r1', text, 'slider');
    });
    node.querySelector('[data-action="dismiss-invite"]')!.addEventListener('click', () => {
      state.invite = false;
      renderInvite();
      // The drawing stays where it is: the invitation's band was reserved from the start.
      $<SVGGElement>('[data-id="r1"]').focus({ preventScroll: true });
    });
  }
  syncRange($<HTMLInputElement>('#invite-range', node), partById('r1')!);
  $('#invite-value', node).textContent = displayValue(partById('r1')!);
  positionInvite();
}

function positionInvite(): void {
  const node = $('#invite');
  const layer = $('#layer-screen');
  if (node.hidden) {
    layer.replaceChildren();
    return;
  }
  const k = labelScale();
  if (state.layout === 'phone') {
    layer.replaceChildren();
    const b = contentBounds(cam.z, false);
    const dockTop = $('#dock').getBoundingClientRect().top || window.innerHeight - 76;
    const h = node.offsetHeight || 140;
    const below = cam.y + b.y1;
    // In the middle of the free board between the drawing and the dock, the slider within the thumb's reach.
    const top = clamp(below + (dockTop - below - h) / 2, below + INVITE_GAP_PHONE, dockTop - h - 12);
    node.style.transform = `translate3d(0, ${top.toFixed(1)}px, 0)`;
    return;
  }
  const [sx, sy] = toScreen(R1_ROW_ANCHOR);
  const bottom = sy + inviteBottomOffset(k);
  node.style.transform = `translate3d(${sx.toFixed(1)}px, ${bottom.toFixed(1)}px, 0) translate(-50%, -100%)`;
  // The hand-drawn arrow from the invitation down to R1's name (two passes of the marker).
  const row = labelEls.get('row-r1');
  if (!row) return;
  const rowW = row.el.offsetWidth * k;
  const rowH = row.el.offsetHeight * k;
  const tip: Pt = [sx - rowW / 2 - 9, sy - 4 * k - rowH / 2 + 2];
  const pts: Pt[] = [
    [tip[0] - 20, bottom + 7],
    [tip[0] - 31, (bottom + tip[1]) / 2 + 6],
    [tip[0] - 17, tip[1] + 1],
    tip,
  ];
  const body = curve(pts, { seed: 'invite-arrow', rough: 0.7 });
  const from = pts[2]!;
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const head = (da: number): Pt => [tip[0] - Math.cos(a + da) * 12, tip[1] - Math.sin(a + da) * 12];
  const heads = curve([head(0.55), tip, head(-0.55)], { seed: 'invite-arrow-head', rough: 0.35 });
  layer.innerHTML = `<g class="invite-arrow"><path d="${body.main}" stroke-width="2.5"/><path d="${body.retrace}" stroke-width="1.2" opacity=".45"/><path d="${heads.main}" stroke-width="2.5"/></g>`;
}

// ================================================================== value editing

const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
const E6 = [1.0, 1.5, 2.2, 3.3, 4.7, 6.8];

function decades(series: number[], from: number, to: number): number[] {
  const out: number[] = [];
  for (let d = from; d < to * 0.999; d *= 10) for (const m of series) out.push(Number((m * d).toPrecision(3)));
  out.push(to);
  return out;
}

/** The values a slider steps through, by kind: standard resistor values (log scale), half volts for sources. */
function seriesFor(p: Part): number[] {
  switch (p.kind) {
    case 'R':
    case 'H':
      return decades(E24, 10, 10e6);
    case 'V':
      return Array.from({ length: 25 }, (_, i) => i * 0.5);
    case 'C':
      return decades(E6, 1e-9, 1e-3);
    case 'L':
      return decades(E6, 1e-6, 1);
    case 'I':
    case 'G':
      return decades(E6, 1e-6, 0.1);
    default:
      return decades(E6, 0.1, 100);
  }
}

function nearestIndex(series: number[], v: number | undefined): number {
  if (v === undefined) return 0;
  let best = 0;
  let bestD = Infinity;
  const log = series[0]! > 0;
  series.forEach((s, i) => {
    const d = log && v > 0 ? Math.abs(Math.log(s) - Math.log(v)) : Math.abs(s - v);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function syncRange(range: HTMLInputElement, p: Part): void {
  const series = seriesFor(p);
  range.max = String(series.length - 1);
  const i = nearestIndex(series, readValue(p.value));
  if (document.activeElement !== range || range.value !== String(i)) range.value = String(i);
  const v = readValue(p.value);
  range.setAttribute('aria-valuetext', v === undefined ? `${p.value || 'no value'}` : spokenValue(v, p.kind));
  range.style.setProperty('--fill', `${(i / (series.length - 1)) * 100}%`);
}

function bindRange(range: HTMLInputElement, part: () => Part, onText: (text: string) => void): void {
  const p = part();
  range.setAttribute('aria-label', `${KIND[p.kind].quantity} of ${p.name}`);
  range.addEventListener('input', () => {
    const series = seriesFor(part());
    const v = series[Number(range.value)]!;
    onText(formatSpiceNumber(v));
  });
  range.addEventListener('change', () => {
    commit();
    fieldBase = part().value;
  });
}

function step(p: Part, dir: 1 | -1): string {
  const series = seriesFor(p);
  const v = readValue(p.value);
  if (v === undefined) return formatSpiceNumber(series[Math.floor(series.length / 2)]!);
  const next = dir > 0 ? series.find((s) => s > v * 1.0001) : [...series].reverse().find((s) => s < v * 0.9999);
  return formatSpiceNumber(next ?? v);
}

type Source = 'type' | 'slider' | 'step' | 'fix' | 'trap' | 'shot' | 'revert';

function setValue(id: string, text: string, source: Source): void {
  if (isDivider(id)) {
    const key = id as keyof Divider;
    if (state.values[key] === text) return;
    state.values = { ...state.values, [key]: text };
    state.changedLine = LINE_OF[id];
    refreshModel();
    if (state.live || source === 'fix' || source === 'trap') requestSolve();
    else {
      // Live is off: the numbers are now old, so the dots stop until Run.
      renderLive();
      updateFlow();
    }
  } else {
    const p = state.placed.find((q) => q.id === id);
    if (!p || p.value === text) return;
    p.value = text;
  }
  if (source === 'type') commitSoon();
  else if (source !== 'slider') commit();
  if (source === 'step' || source === 'fix' || source === 'trap') fieldBase = text;
  renderLabels();
  renderPartsA11y();
  renderPanels();
  updateCard(source);
  renderInvite();
  renderHint();
}

function renderPartsA11y(): void {
  for (const p of allParts()) {
    const node = board.querySelector(`[data-id="${p.id}"]`);
    if (!node) continue;
    if (node.hasAttribute('aria-label')) node.setAttribute('aria-label', partAriaLabel(p));
    node.classList.toggle('has-trap', trapsOnLine(LINE_OF[p.id]).length > 0);
  }
}

// ================================================================== the part card

/** The value in the field when it got focus (or when it was last kept): Esc puts it back. */
let fieldBase = '';

function cardStats(p: Part): string {
  if (!p.wired) {
    return `<p class="card__loose">${icon('info', 16)}<span>Not wired yet, so it is not in the netlist. Wiring placed parts into the circuit comes with the full editor.</span></p>`;
  }
  const c = currentOf(p.id);
  const nodes = DIVIDER_NODES[p.id];
  const stats: string[] = [];
  if (c) {
    const q = quantity(c);
    const sub = Math.abs(c.value) < 1e-15 ? 'no current' : `from ${nodeWord(c.from)} to ${nodeWord(c.to)}`;
    stats.push(`<div class="stat"><span class="stat__label">Current</span><span class="stat__num">${esc(q)}</span><span class="stat__sub">${esc(sub)}</span></div>`);
  }
  if (nodes) {
    const va = nodeVoltage(nodes[0]);
    const vb = nodeVoltage(nodes[1]);
    if (va !== undefined && vb !== undefined) {
      stats.push(
        `<div class="stat"><span class="stat__label">Across it</span><span class="stat__num">${esc(formatSI(va - vb, 'V'))}</span><span class="stat__sub">V(${esc(nodes[0])}) − V(${esc(nodes[1])})</span></div>`,
      );
    }
  }
  let power = '';
  if (c?.power) {
    const name = `${p.name} `;
    const words = c.power.text.startsWith(name) ? c.power.text.slice(name.length) : c.power.text;
    power = `<p class="stat-power">${icon('bolt', 16)}<span class="stat-power__label">Power</span><span>${esc(words)}</span></p>`;
  }
  if (!stats.length) {
    // A check on this line already says what is wrong: no need to repeat ngspice's summary.
    if (trapsOnLine(LINE_OF[p.id]).length && state.solution?.status !== 'ok') return '';
    const why = state.solution && state.solution.status !== 'ok' ? summaryOf(state.solution.words.summary) : 'ngspice is solving…';
    return `<p class="card__pending">${esc(why)}</p>`;
  }
  return `<div class="stats">${stats.join('')}</div>${power}`;
}

/** A trap on this part's line, right under the value it is about: the first thing to read. */
function cardTrap(p: Part): string {
  const trap = trapsOnLine(LINE_OF[p.id])[0];
  return trap
    ? `<div class="card__trap card__trap--${trap.severity}" role="note">${icon(trap.severity === 'error' ? 'error' : 'warn', 18)}<div><b>${esc(trap.title)}</b><button class="link-btn" type="button" data-open-checks="1">See the fix in Checks</button></div></div>`
    : '';
}

function cardExplain(p: Part): string {
  const line = LINE_OF[p.id];
  const ex = explanations.find((e) => e.line === line);
  if (!ex) return '';
  // With a trap on the line, the trap is what matters: the summary steps back to keep the card short.
  const trap = trapsOnLine(line).length > 0;
  return `<div class="card__explain">${trap ? '' : `<p>${esc(ex.summary)}</p>`}<button class="link-btn" type="button" data-action="explain">${icon('explain', 16)}Explain line ${line}, word by word</button></div>`;
}

let cardFor: string | undefined;
/** The side the card took when it opened: it keeps it while the numbers change, so it never jumps. */
let cardSide: Side | undefined;

function renderCard(): void {
  const node = $('#part-card');
  const p = partById(state.selected);
  if (!state.cardOpen || !p) {
    node.hidden = true;
    cardFor = undefined;
    cardSide = undefined;
    return;
  }
  node.hidden = false;
  node.classList.toggle('is-sheet', state.layout === 'phone');
  if (cardFor !== p.id) {
    cardFor = p.id;
    cardSide = undefined;
    const info = KIND[p.kind];
    const ground = p.kind === 'GND';
    const series = ground ? [] : seriesFor(p);
    const scale = (v: number): string => (info.unit ? withUnit(v, p.kind) : formatNumber(v));
    node.innerHTML = `
      ${state.layout === 'phone' ? '<div class="sheet__grip" aria-hidden="true"></div>' : '<span class="card__pointer" aria-hidden="true"></span>'}
      <div class="card__head">
        <span class="card__glyph" aria-hidden="true">${ground ? toolGlyph('GND', 26) : toolGlyph(p.kind, isControlled(p.kind) ? 34 : 30)}</span>
        <div class="card__titles">
          <h2 class="card__title" id="card-title">${esc(ground ? 'Ground' : p.name)}</h2>
          <span class="card__kind">${esc(ground ? 'node 0' : info.word)}</span>
        </div>
        <button class="icon-btn" type="button" data-action="close-card" aria-label="Close (Esc)">${icon('close', 18)}</button>
      </div>
      <div class="card__scroll">
      ${
        ground
          ? ''
          : `<div class="field">
        <label class="field__label" for="card-value">${esc(info.quantity)}</label>
        <div class="field__row">
          <button class="step-btn" type="button" data-step="-1" aria-label="Smaller">${icon('minus', 18)}</button>
          <div class="field__box">
            <input id="card-value" class="field__input" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="card-reads" />
            ${info.unit ? `<span class="field__unit" aria-hidden="true">${esc(info.unit)}</span>` : ''}
          </div>
          <button class="step-btn" type="button" data-step="1" aria-label="Bigger">${icon('plus', 18)}</button>
        </div>
        <p class="field__reads" id="card-reads"></p>
        <div class="card__trap-slot" id="card-trap"></div>
        <div class="field__slide">
          <span class="field__end" aria-hidden="true">${esc(scale(series[0]!))}</span>
          <input id="card-range" class="range range--card" type="range" min="0" max="1" step="1" />
          <span class="field__end" aria-hidden="true">${esc(scale(series[series.length - 1]!))}</span>
        </div>
      </div>`
      }
      <div class="card__live" id="card-live"></div>
      <div class="card__more" id="card-more"></div>
      ${
        p.wired
          ? ''
          : `<div class="card__actions"><button class="btn btn--sm btn--ghost" type="button" data-action="rotate" aria-keyshortcuts="Shift+R">${icon('rotate', 16)}<span>Turn</span></button><button class="btn btn--sm btn--ghost" type="button" data-action="delete" aria-keyshortcuts="Delete">${icon('trash', 16)}<span>Delete</span></button></div>`
      }
      </div>`;
    if (!ground) {
      const input = $<HTMLInputElement>('#card-value', node);
      input.value = p.value;
      fieldBase = p.value;
      bindField(input, p.id);
      const range = $<HTMLInputElement>('#card-range', node);
      bindRange(range, () => partById(p.id)!, (text) => {
        input.value = text;
        setValue(p.id, text, 'slider');
      });
      range.setAttribute('aria-label', `${info.quantity} of ${p.name}`);
      node.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) =>
        b.addEventListener('click', () => {
          const text = step(partById(p.id)!, Number(b.dataset.step) as 1 | -1);
          input.value = text;
          setValue(p.id, text, 'step');
        }),
      );
    }
    node.querySelector('[data-action="close-card"]')!.addEventListener('click', () => closeCard(true));
    node.querySelector('[data-action="rotate"]')?.addEventListener('click', () => rotateSelected());
    node.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteSelected());
    if (!reduced()) {
      node.classList.remove('is-entering');
      void node.offsetWidth;
      node.classList.add('is-entering');
    }
  }
  updateCard();
  positionCard();
}

/** The value field: the whole value is selected when it gets focus, so typing "3k" replaces "1k". */
function bindField(input: HTMLInputElement, id: string): void {
  let selectOnUp = false;
  input.addEventListener('focus', () => {
    fieldBase = partById(id)?.value ?? input.value;
    input.select();
    selectOnUp = true;
  });
  // A click that focuses the field would put the caret where it landed: keep the selection instead.
  input.addEventListener('mouseup', (e) => {
    if (selectOnUp) e.preventDefault();
    selectOnUp = false;
  });
  input.addEventListener('input', () => setValue(id, input.value, 'type'));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      fieldBase = input.value;
      requestSolve(true);
      input.select();
    } else if (e.key === 'Escape' && input.value !== fieldBase) {
      // First Esc puts the value back; a second one closes the card.
      e.preventDefault();
      e.stopPropagation();
      const back = fieldBase;
      input.value = back;
      setValue(id, back, 'revert');
      commit();
      input.select();
      toast(`${partById(id)?.name ?? 'It'} is back to ${back || 'empty'}`);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const text = step(partById(id)!, e.key === 'ArrowUp' ? 1 : -1);
      input.value = text;
      setValue(id, text, 'step');
      input.select();
    }
  });
  input.addEventListener('blur', () => {
    commit();
    fieldBase = input.value;
  });
}

function updateCard(source?: Source): void {
  const node = $('#part-card');
  const p = partById(state.selected);
  if (node.hidden || !p) return;
  const input = node.querySelector<HTMLInputElement>('#card-value');
  if (input && source !== 'type' && input.value !== p.value) input.value = p.value;
  const range = node.querySelector<HTMLInputElement>('#card-range');
  if (range) syncRange(range, p);
  const reads = node.querySelector('#card-reads');
  if (reads) {
    const v = readValue(p.value);
    const text = p.value.trim();
    const shown = v === undefined ? '' : withUnit(v, p.kind);
    // Say how ngspice reads the value only when that adds something ("3k" is 3 kΩ; "2" is just 2).
    const adds = v !== undefined && shown.replace(/\s/g, '') !== text && shown !== `× ${text}`;
    reads.innerHTML =
      v === undefined
        ? text
          ? `${icon('warn', 14)}<span>Not a number: try 3k, 4.7k or 1meg</span>`
          : `<span>Type a value, like 3k</span>`
        : adds
          ? `<span>ngspice reads <b>${esc(text)}</b> as <b>${esc(shown)}</b></span>`
          : '';
    reads.classList.toggle('is-bad', v === undefined);
  }
  const trapSlot = node.querySelector<HTMLElement>('#card-trap');
  if (trapSlot) {
    const trapHtml = p.wired ? cardTrap(p) : '';
    if (trapSlot.dataset.html !== trapHtml) {
      trapSlot.innerHTML = trapHtml;
      trapSlot.dataset.html = trapHtml;
    }
  }
  const live = $('#card-live', node);
  const statsHtml = cardStats(p);
  if (live.dataset.html !== statsHtml) {
    live.innerHTML = statsHtml;
    live.dataset.html = statsHtml;
  }
  live.classList.toggle('is-stale', stale());
  const more = $('#card-more', node);
  const moreHtml = p.wired ? cardExplain(p) : '';
  if (more.dataset.html !== moreHtml) {
    more.innerHTML = moreHtml;
    more.dataset.html = moreHtml;
    more.querySelector('[data-action="explain"]')?.addEventListener('click', () => openPanel('explain'));
  }
  positionCard();
}

// ------------------------------------------------------------------ where the card goes

type Side = 'below' | 'above' | 'right' | 'left';

function screenRect(r: Rect): Rect {
  const [x0, y0] = toScreen([r.x, r.y]);
  return { x: x0, y: y0, w: r.w * cam.z, h: r.h * cam.z };
}

function domRect(node: Element | null): Rect | undefined {
  if (!node || (node as HTMLElement).hidden) return undefined;
  const b = node.getBoundingClientRect();
  return b.width && b.height ? { x: b.left, y: b.top, w: b.width, h: b.height } : undefined;
}

/** Everything the card must not cover: the numbers, the names, the wires, the symbols and the islands. */
function cardObstacles(): Rect[] {
  const out: Rect[] = [];
  for (const { el: node } of labelEls.values()) {
    const r = domRect(node);
    if (r) out.push(r);
  }
  const t = 3;
  for (const w of [...DIVIDER_WIRES, ...state.wires]) {
    for (let i = 0; i < w.pts.length - 1; i++) {
      const [a, b] = [w.pts[i]!, w.pts[i + 1]!];
      out.push(screenRect({ x: Math.min(a[0], b[0]) - t, y: Math.min(a[1], b[1]) - t, w: Math.abs(a[0] - b[0]) + 2 * t, h: Math.abs(a[1] - b[1]) + 2 * t }));
    }
  }
  for (const p of allParts()) out.push(screenRect(box(p.kind, p.at, p.rot)));
  for (const sel of ['.brand', '#toolbar', '#panel-switch', '#view-island', '#run-island', '#invite', '#hint']) {
    const r = domRect(document.querySelector(sel));
    if (r) out.push(r);
  }
  for (const panel of $$('#panel-stack .panel')) {
    const r = domRect(panel);
    if (r) out.push(r);
  }
  return out;
}

const overlaps = (a: Rect, b: Rect): number => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Put the card in free space beside its part, on the side with the most room, its tail pointing
 * at the part. It may get shorter (its body scrolls) but never covers a number, a wire or ground.
 */
function placeCard(p: Part, w: number, h0: number): { x: number; y: number; h: number; side: Side } {
  const B = screenRect(box(p.kind, p.at, p.rot));
  const C: Pt = [B.x + B.w / 2, B.y + B.h / 2];
  const W = window.innerWidth;
  const H = window.innerHeight;
  const m = 12;
  const gap = 14;
  const pad = 8;
  const obs = cardObstacles().filter((o) => overlaps(o, B) < B.w * B.h * 0.5);
  const minH = Math.min(h0, 230);
  const xOverlap = (o: Rect, x: number): boolean => o.x < x + w && o.x + o.w > x;
  const vertical = p.rot === 90 || p.rot === 270;
  const order: Side[] = vertical ? ['right', 'left', 'below', 'above'] : ['below', 'above', 'right', 'left'];
  let best: { x: number; y: number; h: number; side: Side; score: number } | undefined;
  for (const side of order) {
    let x: number;
    let y: number;
    let h: number;
    if (side === 'below' || side === 'above') {
      x = clamp(C[0] - w / 2, m, W - m - w);
      if (side === 'below') {
        y = B.y + B.h + gap;
        const limit = Math.min(H - m, ...obs.filter((o) => xOverlap(o, x) && o.y + o.h > y).map((o) => o.y - pad));
        h = Math.min(h0, limit - y);
      } else {
        const bottom = B.y - gap;
        const limit = Math.max(m, ...obs.filter((o) => xOverlap(o, x) && o.y < bottom).map((o) => o.y + o.h + pad));
        h = Math.min(h0, bottom - limit);
        y = bottom - h;
      }
    } else {
      x = side === 'right' ? B.x + B.w + gap : B.x - gap - w;
      // The free stretches of the column the card would sit in, and the one beside the part.
      const blocks = obs
        .filter((o) => xOverlap(o, x))
        .map((o) => [o.y - pad, o.y + o.h + pad] as const)
        .sort((a, b) => a[0] - b[0]);
      let lo = m;
      let found: [number, number] | undefined;
      for (const [b0, b1] of [...blocks, [H - m, H - m] as const]) {
        if (b0 > lo && C[1] >= lo - 1 && C[1] <= b0 + 1) {
          found = [lo, b0];
          break;
        }
        lo = Math.max(lo, b1);
      }
      const [f0, f1] = found ?? [m, H - m];
      h = Math.min(h0, f1 - f0);
      y = clamp(C[1] - h / 2, f0, f1 - h);
    }
    const r = { x, y, w, h: Math.max(h, 1) };
    const covered = obs.reduce((sum, o) => sum + overlaps(r, o), 0);
    const off = x < m - 1 || x + w > W - m + 1 || y < m - 1 || y + h > H - m + 1 ? 1e6 : 0;
    const short = h < minH ? 5e4 + (minH - h) * 100 : (h0 - h) * 4;
    const keep = side === cardSide ? -400 : 0;
    const score = covered * 50 + off + short + keep + order.indexOf(side) * 30;
    if (!best || score < best.score) best = { x, y, h: Math.max(h, minH), side, score };
  }
  return best!;
}

function positionCard(): void {
  const node = $('#part-card');
  if (node.hidden) return;
  const p = partById(state.selected);
  if (!p) return;
  if (state.layout === 'phone') {
    node.style.transform = '';
    node.style.left = '';
    node.style.top = '';
    // The sheet stops below the drawing, so the numbers stay in sight while the value changes.
    const b = contentBounds(cam.z, false);
    const H = window.innerHeight;
    const room = H - (cam.y + b.y1) - 10;
    node.style.maxHeight = `${Math.round(Math.max(H * 0.42, Math.min(room, H * 0.62)))}px`;
    return;
  }
  node.style.maxHeight = '';
  const w = node.offsetWidth || 320;
  const h0 = node.scrollHeight || 360;
  const place = placeCard(p, w, h0);
  cardSide = place.side;
  const B = screenRect(box(p.kind, p.at, p.rot));
  node.dataset.side = place.side;
  node.style.left = '0px';
  node.style.top = '0px';
  node.style.maxHeight = `${Math.round(place.h)}px`;
  node.style.transform = `translate3d(${place.x.toFixed(1)}px, ${place.y.toFixed(1)}px, 0)`;
  // The tail points at the middle of the part.
  const tx = clamp(B.x + B.w / 2 - place.x, 26, w - 26);
  const ty = clamp(B.y + B.h / 2 - place.y, 26, place.h - 26);
  node.style.setProperty('--tail-x', `${tx.toFixed(1)}px`);
  node.style.setProperty('--tail-y', `${ty.toFixed(1)}px`);
}

function openCard(id: string, focusField = true): void {
  const was = state.cardOpen && state.selected === id;
  state.selected = id;
  state.cardOpen = true;
  closeMenu();
  // Once R1's card has been opened the invitation has done its job (its band stays reserved).
  if (id === 'r1') {
    state.played = true;
    state.invite = false;
  }
  if (state.layout === 'phone') {
    state.sheet = undefined;
    state.partsSheet = false;
  }
  renderSelection();
  renderLabels();
  renderInvite();
  renderCard();
  renderPanels();
  renderPartsSheet();
  renderHint();
  board.querySelectorAll('.part[aria-expanded]').forEach((n) => n.setAttribute('aria-expanded', String(n.getAttribute('data-id') === id)));
  if (!was && focusField) {
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('#card-value');
      if (!input) return;
      input.focus({ preventScroll: true });
      input.select();
    });
  }
}

function closeCard(returnFocus: boolean): void {
  const id = state.selected;
  state.cardOpen = false;
  commit();
  renderCard();
  renderLabels();
  renderInvite();
  renderHint();
  board.querySelectorAll('.part[aria-expanded]').forEach((n) => n.setAttribute('aria-expanded', 'false'));
  if (returnFocus && id) board.querySelector<SVGGElement>(`[data-id="${id}"]`)?.focus({ preventScroll: true });
}

function select(id: string | undefined): void {
  state.selected = id;
  if (!id) state.cardOpen = false;
  renderSelection();
  renderLabels();
  renderCard();
  renderPanels();
  renderHint();
}

function closeSelection(): void {
  state.selected = undefined;
  state.cardOpen = false;
}

function rotateSelected(): void {
  const p = state.placed.find((q) => q.id === state.selected);
  if (!p) {
    if (state.selected) toast('The divider’s parts stay where they are in this prototype');
    return;
  }
  p.rot = ((p.rot + 90) % 360) as Rot;
  commit();
  renderBoard();
  renderLabels();
  positionCard();
}

function deleteSelected(): void {
  const i = state.placed.findIndex((q) => q.id === state.selected);
  if (i < 0) {
    if (state.selected) toast('The divider’s parts stay in this prototype: change their values instead');
    return;
  }
  const [gone] = state.placed.splice(i, 1);
  closeSelection();
  commit();
  renderAll();
  toast(`${gone!.kind === 'GND' ? 'Ground' : gone!.name} deleted. ${MOD}+Z brings it back.`);
}

// ================================================================== placing parts and wires

function nextName(kind: Kind): string {
  if (kind === 'GND') return '0';
  const used = allParts()
    .filter((p) => p.kind === kind)
    .map((p) => Number(p.name.slice(1)) || 0);
  return `${kind}${Math.max(0, ...used) + 1}`;
}

function placeAt(at: Pt): void {
  if (state.tool === 'select' || state.tool === 'wire') return;
  const kind = state.tool;
  const part: Part = { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, kind, name: nextName(kind), value: KIND[kind].start, at, rot: kind === 'GND' ? 0 : state.ghostRot, wired: false };
  state.placed.push(part);
  commit();
  setTool('select');
  state.selected = part.id;
  renderAll();
  const g = board.querySelector<SVGGElement>(`[data-id="${part.id}"]`);
  if (g && !reduced()) g.classList.add('is-new');
  const what = part.kind === 'GND' ? 'Ground' : part.name;
  toast(`${what} is on the board. ${state.layout === 'phone' ? 'Tap' : 'Click'} it to change it.`);
  announce(`${part.kind === 'GND' ? 'Ground' : `${part.name}, ${KIND[kind].word.toLowerCase()},`} placed on the board. It is not wired into the circuit.`);
}

function wireClick(at: Pt): void {
  if (!state.wireStart) {
    state.wireStart = at;
    renderGhost();
    renderHint();
    return;
  }
  const start = state.wireStart;
  if (start[0] === at[0] && start[1] === at[1]) return;
  const pts: Pt[] = start[0] === at[0] || start[1] === at[1] ? [start, at] : [start, [at[0], start[1]], at];
  state.wires.push({ id: `w${Date.now().toString(36)}`, pts });
  state.wireStart = at;
  commit();
  renderBoard();
  renderHint();
}

function setTool(tool: Tool): void {
  state.tool = tool;
  state.wireStart = undefined;
  if (tool === 'select') state.ghostAt = undefined;
  else if (state.layout === 'phone' && tool !== 'wire') {
    const r = freeRect();
    state.ghostAt = snap(toWorld([r.x + r.w / 2, r.y + r.h * 0.72]));
  }
  app.dataset.tool = tool;
  closeMenu();
  renderToolbar();
  renderDock();
  renderGhost();
  renderHint();
}

// ================================================================== pointer and wheel on the board

let drag: { kind: 'pan' | 'move'; id?: string | undefined; start: Pt; cam: Pt; at?: Pt; moved: boolean; pointer: number } | undefined;
const pointers = new Map<number, Pt>();
let pinch: { dist: number; z: number; mid: Pt } | undefined;

function partAtEvent(e: Event): string | undefined {
  const g = (e.target as Element).closest?.('.part');
  return g?.getAttribute('data-id') ?? undefined;
}

canvasEl.addEventListener('pointerdown', (e) => {
  if ((e.target as Element).closest('.lab button')) return;
  closeMenu();
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [Pt, Pt];
    pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), z: cam.z, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
    drag = undefined;
    return;
  }
  const at = snap(toWorld([e.clientX, e.clientY]));
  if (state.tool !== 'select') {
    canvasEl.setPointerCapture(e.pointerId);
    drag = { kind: 'pan', start: [e.clientX, e.clientY], cam: [cam.x, cam.y], moved: false, pointer: e.pointerId, at };
    return;
  }
  const id = partAtEvent(e);
  canvasEl.setPointerCapture(e.pointerId);
  const loose = state.placed.find((p) => p.id === id);
  drag = loose
    ? { kind: 'move', id, start: [e.clientX, e.clientY], cam: [loose.at[0], loose.at[1]], moved: false, pointer: e.pointerId }
    : { kind: 'pan', id, start: [e.clientX, e.clientY], cam: [cam.x, cam.y], moved: false, pointer: e.pointerId };
});

canvasEl.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [Pt, Pt];
    const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const z = clamp((pinch.z * dist) / pinch.dist, 0.35, 4);
    zoomAt(z / cam.z, pinch.mid);
    return;
  }
  if (state.tool !== 'select' && e.pointerType !== 'touch') {
    state.ghostAt = snap(toWorld([e.clientX, e.clientY]));
    renderGhost();
  }
  if (!drag || drag.pointer !== e.pointerId) {
    const id = state.tool === 'select' && e.pointerType !== 'touch' ? partAtEvent(e) : undefined;
    if (id !== state.hover) {
      state.hover = id;
      renderSelection();
    }
    return;
  }
  const dx = e.clientX - drag.start[0];
  const dy = e.clientY - drag.start[1];
  if (!drag.moved && Math.hypot(dx, dy) < 5) return;
  drag.moved = true;
  if (drag.kind === 'pan') {
    cam.x = drag.cam[0] + dx;
    cam.y = drag.cam[1] + dy;
    canvasEl.classList.add('is-panning');
    applyCamera();
  } else {
    const p = state.placed.find((q) => q.id === drag!.id);
    if (!p) return;
    p.at = snap([drag.cam[0] + dx / cam.z, drag.cam[1] + dy / cam.z]);
    renderBoard();
    renderLabels();
    positionCard();
  }
});

function endPointer(e: PointerEvent): void {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = undefined;
  if (!drag || drag.pointer !== e.pointerId) return;
  const d = drag;
  drag = undefined;
  canvasEl.classList.remove('is-panning');
  if (e.type === 'pointercancel') return;
  if (d.moved) {
    if (d.kind === 'move') commit();
    return;
  }
  // A click (no drag).
  if (state.tool === 'wire') return wireClick(snap(toWorld([e.clientX, e.clientY])));
  if (state.tool !== 'select') return placeAt(snap(toWorld([e.clientX, e.clientY])));
  if (d.id) {
    if (d.id === 'gnd') return select('gnd');
    openCard(d.id, e.pointerType !== 'touch');
  } else if (state.selected) {
    state.cardOpen ? closeCard(false) : select(undefined);
  }
}
canvasEl.addEventListener('pointerup', endPointer);
canvasEl.addEventListener('pointercancel', endPointer);
canvasEl.addEventListener('pointerleave', () => {
  if (state.hover) {
    state.hover = undefined;
    renderSelection();
  }
  if (state.tool !== 'select' && state.layout === 'desktop') {
    state.ghostAt = undefined;
    renderGhost();
  }
});

canvasEl.addEventListener(
  'wheel',
  (e) => {
    if ((e.target as Element).closest('.lab--trap')) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0022), [e.clientX, e.clientY]);
    else {
      cam.x -= e.deltaX;
      cam.y -= e.deltaY;
      applyCamera();
    }
  },
  { passive: false },
);

// Keyboard on the board: Enter or Space opens a part, like a click.
board.addEventListener('keydown', (e) => {
  const id = (e.target as Element).closest?.('.part')?.getAttribute('data-id');
  if (!id) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openCard(id);
  }
});

labelsEl.addEventListener('click', (e) => {
  const t = e.target as Element;
  if (t.closest('[data-open-checks]')) openPanel('checks');
});
$('#part-card').addEventListener('click', (e) => {
  if ((e.target as Element).closest('[data-open-checks]')) openPanel('checks');
});

// ================================================================== toolbar (desktop) and dock (phone)

interface ToolDef {
  id: Tool | 'controlled';
  /** The word under the button. */
  word: string;
  /** The full name, for the tooltip and the accessible name. */
  full: string;
  key: string;
  keyLabel: string;
  glyph: string;
  group: number;
}

const TOOLS: ToolDef[] = [
  { id: 'select', word: 'Select', full: 'Select and move', key: 'Escape', keyLabel: 'esc', glyph: icon('select', 24), group: 0 },
  { id: 'wire', word: 'Wire', full: 'Wire', key: 'W', keyLabel: 'W', glyph: icon('wire', 24), group: 0 },
  ...(['R', 'C', 'L', 'V', 'I'] as const).map((k) => ({
    id: k,
    word: KIND[k].tool,
    full: KIND[k].word,
    key: k,
    keyLabel: k,
    glyph: toolGlyph(k, 30),
    group: k === 'V' || k === 'I' ? 2 : 1,
  })),
  { id: 'controlled', word: 'Controlled', full: 'Controlled sources', key: 'E F G H', keyLabel: '', glyph: controlledGlyph(26), group: 2 },
  { id: 'GND', word: 'Ground', full: 'Ground, node 0', key: '0', keyLabel: '0', glyph: toolGlyph('GND', 24), group: 3 },
];

function buildToolbar(): void {
  const bar = $('#toolbar');
  let group = 0;
  let html = '<span class="toolbar__glow" aria-hidden="true"></span>';
  TOOLS.forEach((t, i) => {
    if (t.group !== group) {
      html += '<span class="toolbar__sep" aria-hidden="true"></span>';
      group = t.group;
    }
    const ctrl = t.id === 'controlled';
    const keys = ctrl ? 'E F G H' : t.key;
    // The accessible name is the visible word (the keycap is hidden from screen readers; the key is in aria-keyshortcuts).
    html += `<button class="tool${ctrl ? ' tool--menu' : ''}" type="button" data-tool="${t.id}"${ctrl ? ' aria-label="Controlled sources"' : ''} aria-keyshortcuts="${keys}" ${ctrl ? 'aria-haspopup="menu" aria-expanded="false" aria-controls="ctrl-menu"' : 'aria-pressed="false"'} tabindex="${i === 0 ? 0 : -1}" data-tip="${esc(ctrl ? 'Controlled sources' : t.full)}" data-key="${esc(ctrl ? 'E F G H' : t.keyLabel === 'esc' ? 'Esc' : t.keyLabel)}">
      <span class="tool__glyph">${t.glyph}${t.keyLabel ? `<kbd class="tool__key" aria-hidden="true">${esc(t.keyLabel)}</kbd>` : ''}</span><span class="tool__word">${esc(t.word)}${ctrl ? icon('caret', 14, 'tool__caret') : ''}</span></button>`;
  });
  bar.innerHTML = html;
  bar.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('.tool');
    if (!b) return;
    const tool = b.dataset.tool as Tool | 'controlled';
    if (tool === 'controlled') return state.menu ? closeMenu(true) : openMenu(false);
    setTool(state.tool === tool && tool !== 'select' ? 'select' : tool);
  });
  bar.addEventListener('keydown', (e) => {
    const buttons = $$<HTMLButtonElement>('.tool', bar);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    if (buttons[i]!.dataset.tool === 'controlled' && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openMenu(true);
      return;
    }
    let j = i;
    if (e.key === 'ArrowRight') j = (i + 1) % buttons.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = buttons.length - 1;
    else return;
    e.preventDefault();
    buttons.forEach((b, k) => (b.tabIndex = k === j ? 0 : -1));
    buttons[j]!.focus();
  });
  bar.addEventListener('pointerover', (e) => showTip((e.target as Element).closest<HTMLElement>('.tool')));
  bar.addEventListener('pointerleave', () => showTip(null));
  bar.addEventListener('focusin', (e) => showTip((e.target as Element).closest<HTMLElement>('.tool')));
  bar.addEventListener('focusout', () => showTip(null));
}

/** The four controlled sources, each with its full name, the ratio its value stands for, its letter and its own glyph. */
function buildMenu(): void {
  const menu = $('#ctrl-menu');
  menu.innerHTML = `<p class="menu__title" aria-hidden="true">Controlled sources</p>${CONTROLLED.map((k) => {
    const info = KIND[k];
    return `<button class="menu__item" type="button" role="menuitemradio" aria-checked="false" data-tool="${k}" aria-keyshortcuts="${k}" tabindex="-1">
      <span class="menu__glyph">${toolGlyph(k, 46)}</span>
      <span class="menu__text"><span class="menu__name">${esc(info.word)}</span><span class="menu__sub">${esc(info.quantity)} · ${esc(info.ratio ?? '')}</span></span>
      <kbd class="menu__key" aria-hidden="true">${k}</kbd></button>`;
  }).join('')}`;
  menu.addEventListener('click', (e) => {
    const item = (e.target as Element).closest<HTMLButtonElement>('.menu__item');
    if (!item) return;
    setTool(item.dataset.tool as Kind);
    $<HTMLButtonElement>('[data-tool="controlled"]').focus({ preventScroll: true });
  });
  menu.addEventListener('keydown', (e) => {
    const items = $$<HTMLButtonElement>('.menu__item', menu);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    let j = i;
    if (e.key === 'ArrowDown') j = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') j = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = items.length - 1;
    else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
      return;
    } else return;
    e.preventDefault();
    items[j]?.focus();
  });
}

function openMenu(focusFirst: boolean): void {
  if (state.layout === 'phone') return openPartsSheet();
  state.menu = true;
  const menu = $('#ctrl-menu');
  const button = $<HTMLButtonElement>('[data-tool="controlled"]');
  menu.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  showTip(null);
  const r = button.getBoundingClientRect();
  const w = menu.offsetWidth;
  menu.style.left = `${clamp(r.left + r.width / 2 - w / 2, 12, window.innerWidth - w - 12)}px`;
  menu.style.top = `${r.bottom + 12}px`;
  $$<HTMLButtonElement>('.menu__item', menu).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tool === state.tool)));
  if (focusFirst) ($<HTMLButtonElement>(`.menu__item[aria-checked="true"]`, menu) ?? $<HTMLButtonElement>('.menu__item', menu)).focus();
}

function closeMenu(returnFocus = false): void {
  if (!state.menu) return;
  state.menu = false;
  $('#ctrl-menu').hidden = true;
  const button = document.querySelector<HTMLButtonElement>('[data-tool="controlled"]');
  button?.setAttribute('aria-expanded', 'false');
  if (returnFocus) button?.focus({ preventScroll: true });
}

document.addEventListener('pointerdown', (e) => {
  if (state.menu && !(e.target as Element).closest('#ctrl-menu, [data-tool="controlled"]')) closeMenu();
});

/** Centre the toolbar when there is room; otherwise slide it between the brand and the panel buttons. */
function layoutTopBar(): void {
  const bar = $('#toolbar');
  if (state.layout !== 'desktop') {
    bar.style.left = '';
    bar.style.transform = '';
    return;
  }
  const brand = $('.brand').getBoundingClientRect();
  const panels = $('#panel-switch').getBoundingClientRect();
  const w = bar.offsetWidth;
  const x = clamp(window.innerWidth / 2 - w / 2, brand.right + 12, Math.max(brand.right + 12, panels.left - 12 - w));
  bar.style.left = `${Math.round(x)}px`;
  bar.style.transform = 'none';
}

function renderToolbar(): void {
  const bar = $('#toolbar');
  layoutTopBar();
  let active: HTMLElement | null = null;
  bar.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => {
    const ctrl = b.dataset.tool === 'controlled';
    const on = ctrl ? isControlled(state.tool) : b.dataset.tool === state.tool;
    if (!ctrl) b.setAttribute('aria-pressed', String(on));
    else {
      // The folded button shows which controlled source is in hand.
      b.querySelector('.tool__glyph')!.innerHTML = on ? toolGlyph(state.tool as Kind, 32) : controlledGlyph(26);
      b.setAttribute('aria-label', on ? `Controlled sources: ${KIND[state.tool as Kind].word} in hand` : 'Controlled sources');
    }
    b.classList.toggle('is-active', on);
    if (on) active = b;
  });
  const glow = $('.toolbar__glow', bar);
  const a = active as HTMLElement | null;
  glow.style.opacity = a ? '1' : '0';
  if (a) {
    glow.style.width = `${a.offsetWidth}px`;
    glow.style.height = `${a.offsetHeight}px`;
    glow.style.transform = `translate(${a.offsetLeft}px, ${a.offsetTop}px)`;
  }
}

let tipTimer = 0;
function showTip(button: HTMLElement | null): void {
  clearTimeout(tipTimer);
  let tip = document.getElementById('tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'tip';
    tip.className = 'tip';
    tip.setAttribute('aria-hidden', 'true');
    app.append(tip);
  }
  const t = tip;
  if (!button || state.layout === 'phone' || state.menu) {
    t.classList.remove('is-shown');
    return;
  }
  tipTimer = window.setTimeout(() => {
    const keys = (button.dataset.key ?? '').split(' ').filter(Boolean);
    t.innerHTML = `${esc(button.dataset.tip ?? '')}${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('')}`;
    const r = button.getBoundingClientRect();
    const half = t.offsetWidth / 2;
    t.style.left = `${clamp(r.left + r.width / 2, half + 8, window.innerWidth - half - 8)}px`;
    t.style.top = `${r.bottom + 10}px`;
    t.classList.add('is-shown');
  }, 350);
}

// ------------------------------------------------------------------ the phone's dock and parts sheet

function buildDock(): void {
  $('#phone-tools').innerHTML = `
    <button class="dock-btn" type="button" data-dock="select" aria-pressed="true">${icon('select', 22)}<span>Select</span></button>
    <button class="dock-btn" type="button" data-dock="parts" aria-haspopup="dialog" aria-expanded="false" aria-controls="parts-sheet"><span class="dock-btn__glyph">${icon('parts', 22)}</span><span class="dock-btn__word">Parts</span></button>`;
  $('#phone-tools').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-dock]');
    if (!b) return;
    if (b.dataset.dock === 'select') {
      setTool('select');
      if (state.partsSheet) closePartsSheet(false);
    } else state.partsSheet ? closePartsSheet(true) : openPartsSheet();
  });
}

function renderDock(): void {
  const parts = document.querySelector<HTMLButtonElement>('[data-dock="parts"]');
  if (!parts) return;
  const placing = state.tool !== 'select';
  $('[data-dock="select"]').setAttribute('aria-pressed', String(!placing));
  $('[data-dock="select"]').classList.toggle('is-on', !placing);
  parts.classList.toggle('is-on', placing || state.partsSheet);
  parts.setAttribute('aria-expanded', String(state.partsSheet));
  $('.dock-btn__glyph', parts).innerHTML = placing && state.tool !== 'wire' ? toolGlyph(state.tool as Kind, 26) : state.tool === 'wire' ? icon('wire', 22) : icon('parts', 22);
  $('.dock-btn__word', parts).textContent = placing ? (state.tool === 'wire' ? 'Wire' : isControlled(state.tool) ? `${state.tool} source` : KIND[state.tool as Kind].tool.replace(' source', '')) : 'Parts';
}

function openPartsSheet(): void {
  state.partsSheet = true;
  state.sheet = undefined;
  if (state.cardOpen) state.cardOpen = false;
  renderAll();
  requestAnimationFrame(() => $<HTMLButtonElement>('#parts-sheet .parts-tile')?.focus({ preventScroll: true }));
}

function closePartsSheet(returnFocus: boolean): void {
  state.partsSheet = false;
  renderPartsSheet();
  renderDock();
  renderInvite();
  if (returnFocus) $<HTMLButtonElement>('[data-dock="parts"]').focus({ preventScroll: true });
}

function renderPartsSheet(): void {
  const sheet = $('#parts-sheet');
  const show = state.partsSheet && state.layout === 'phone';
  sheet.hidden = !show;
  if (!show) return;
  if (!sheet.dataset.ready) {
    sheet.dataset.ready = '1';
    const tile = (id: Tool, word: string, glyph: string, key: string): string =>
      `<button class="parts-tile" type="button" data-pick="${id}"><span class="parts-tile__glyph">${glyph}</span><span class="parts-tile__word">${esc(word)}</span><kbd class="parts-tile__key" aria-hidden="true">${esc(key)}</kbd></button>`;
    sheet.innerHTML = `<div class="sheet__grip" aria-hidden="true"></div>
      <div class="parts-sheet__head"><h2 id="parts-title">Add a part</h2><button class="icon-btn" type="button" data-action="close-parts" aria-label="Close">${icon('close', 18)}</button></div>
      <div class="parts-grid">
        ${tile('R', 'Resistor', toolGlyph('R', 34), 'R')}${tile('C', 'Capacitor', toolGlyph('C', 34), 'C')}${tile('L', 'Inductor', toolGlyph('L', 34), 'L')}${tile('wire', 'Wire', icon('wire', 26), 'W')}
        ${tile('V', 'Voltage source', toolGlyph('V', 34), 'V')}${tile('I', 'Current source', toolGlyph('I', 34), 'I')}${tile('GND', 'Ground', toolGlyph('GND', 28), '0')}
      </div>
      <h3 class="parts-sheet__sub">Controlled sources</h3>
      <div class="parts-grid parts-grid--wide">
        ${CONTROLLED.map((k) => `<button class="parts-tile parts-tile--wide" type="button" data-pick="${k}"><span class="parts-tile__glyph">${toolGlyph(k, 38)}</span><span class="parts-tile__text"><span class="parts-tile__word">${esc(KIND[k].word)}</span><span class="parts-tile__sub">${esc(k)} · ${esc(KIND[k].ratio ?? '')}</span></span></button>`).join('')}
      </div>
      <p class="parts-sheet__note">Tap a part, then tap the board to put it there.</p>`;
    sheet.addEventListener('click', (e) => {
      const t = e.target as Element;
      if (t.closest('[data-action="close-parts"]')) return closePartsSheet(true);
      const pick = t.closest<HTMLElement>('[data-pick]');
      if (!pick) return;
      state.partsSheet = false;
      setTool(pick.dataset.pick as Tool);
      renderAll();
    });
    sheet.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePartsSheet(true);
      }
    });
  }
  $$('.parts-tile', sheet).forEach((b) => b.classList.toggle('is-on', b.dataset.pick === state.tool));
}

// ================================================================== panels

const PANELS: { id: PanelId; title: string; icon: string; key: string }[] = [
  { id: 'netlist', title: 'Netlist', icon: 'netlist', key: 'N' },
  { id: 'checks', title: 'Checks', icon: 'checks', key: 'K' },
  { id: 'explain', title: 'Explain', icon: 'explain', key: 'X' },
];

function panelOpen(id: PanelId): boolean {
  return state.layout === 'phone' ? state.sheet === id : state.panels.has(id);
}

function focusPanel(id: PanelId): void {
  requestAnimationFrame(() => {
    // The heading takes the focus (not the whole card), so a keyboard user lands at the top of the panel.
    const target = state.layout === 'phone' ? document.getElementById(`tab-${id}`) : document.getElementById(`panel-${id}-title`);
    target?.focus({ preventScroll: true });
  });
}

function togglePanel(id: PanelId): void {
  if (state.layout === 'phone') {
    state.sheet = state.sheet === id ? undefined : id;
    if (state.sheet) {
      state.cardOpen = false;
      state.partsSheet = false;
    }
  } else if (state.panels.has(id)) state.panels.delete(id);
  else state.panels.add(id);
  // The drawing stays where it is: panels float over the board (Fit, Shift+1, makes room on request).
  renderAll();
  hintFit();
  if (panelOpen(id)) focusPanel(id);
}

function openPanel(id: PanelId): void {
  if (!panelOpen(id)) togglePanel(id);
  else focusPanel(id);
}

function closePanel(id: PanelId): void {
  if (state.layout === 'phone') state.sheet = undefined;
  else state.panels.delete(id);
  renderAll();
  hintFit();
  $<HTMLButtonElement>(`#panel-switch [data-panel="${id}"]`)?.focus({ preventScroll: true });
}

function checksBadge(): string {
  const n = traps.length;
  if (!n) return `<span class="badge badge--ok" aria-hidden="true">${icon('tick', 14)}</span>`;
  const worst = traps.some((t) => t.severity === 'error') ? 'error' : traps.some((t) => t.severity === 'warning') ? 'warning' : 'info';
  return `<span class="badge badge--${worst}" aria-hidden="true">${n}</span>`;
}

function checksStatus(): string {
  return traps.length ? `${traps.length} ${traps.length === 1 ? 'trap' : 'traps'} found` : 'no problems found';
}

function renderPanelSwitch(): void {
  const nav = $('#panel-switch');
  const phone = state.layout === 'phone';
  nav.innerHTML = PANELS.map((p) => {
    const open = panelOpen(p.id);
    const tip = `${open ? 'Close' : 'Open'} ${p.title.toLowerCase()}`;
    // Checks is named by its visible word; what it found ("1 trap found") is its description.
    const label = p.id === 'checks' ? ' aria-describedby="checks-status"' : '';
    return `<button class="switch${phone ? ' dock-btn' : ''}${open ? ' is-on' : ''}" type="button" data-panel="${p.id}"${label} aria-pressed="${open}"${open ? ` aria-controls="panel-${p.id}"` : ''} aria-keyshortcuts="${p.key}" data-tip="${tip}" data-key="${p.key}"><span class="switch__icon">${icon(p.icon, phone ? 22 : 18)}</span><span class="switch__label">${p.title}</span>${p.id === 'checks' ? checksBadge() : ''}</button>`;
  }).join('') + `<span class="sr-only" id="checks-status">${checksStatus()}</span>`;
}

function panelBody(id: PanelId): string {
  const text = netlist();
  if (id === 'netlist') {
    return netlistHTML({
      text,
      explanations,
      annotations: state.solution?.netlist === text ? state.solution.annotations : [],
      colours,
      links: LINKS,
      ...(state.selected && LINE_OF[state.selected] ? { selectedLine: LINE_OF[state.selected] } : {}),
      ...(state.changedLine ? { changedLine: state.changedLine } : {}),
    });
  }
  if (id === 'checks') return checksHTML({ traps, offerTrap: !traps.length, compact: state.layout === 'desktop' && state.panels.size > 1 });
  const p = partById(state.selected);
  const line = p ? LINE_OF[p.id] : undefined;
  const ex = line ? explanations.find((e) => e.line === line) : undefined;
  return explainHTML({
    circuit: circuitWords,
    ...(p && ex ? { part: { name: p.name, explanation: ex, lineText: text.split('\n')[line! - 1] ?? '' } } : {}),
    choices: DIVIDER.filter((d) => d.kind !== 'GND').map((d) => ({ id: d.id, name: d.name, word: KIND[d.kind].word.toLowerCase() })),
    circuitOpen: state.circuitOpen,
  });
}

function panelFoot(id: PanelId): string {
  if (id !== 'netlist') return '';
  return `<div class="panel__foot"><span>${icon('sparkle', 16)}Written for you from the drawing</span><button class="btn btn--ghost btn--sm" type="button" data-action="copy">${icon('copy', 16)}<span>Copy</span></button></div>`;
}

function panelSubtitle(id: PanelId): string {
  if (id === 'netlist') return 'The drawing, as SPICE text';
  if (id === 'checks') return traps.length ? checksStatus().replace(/^./, (c) => c.toUpperCase()) : 'No problems found';
  const p = partById(state.selected);
  return p && p.wired && p.kind !== 'GND' ? `${p.name}, line ${LINE_OF[p.id]}` : 'The whole circuit';
}

const panelHtmlCache = new Map<PanelId, string>();

function renderPanels(): void {
  renderPanelSwitch();
  const stack = $('#panel-stack');
  const phone = state.layout === 'phone';
  stack.classList.toggle('is-sheet', phone);
  stack.classList.toggle('is-tall', phone && state.tall);
  const ids = phone ? (state.sheet ? [state.sheet] : []) : PANELS.map((p) => p.id).filter((id) => state.panels.has(id));
  stack.hidden = ids.length === 0;
  stack.dataset.count = String(ids.length);
  stack.dataset.open = ids.join(' ');
  // Keep panels that stay open (so scroll positions and focus survive), add and remove the rest.
  const existing = new Map($$('.panel', stack).map((p) => [p.dataset.panel as PanelId, p]));
  for (const [id, node] of existing) {
    if (!ids.includes(id) || node.dataset.mode !== (phone ? 'sheet' : 'card')) {
      node.remove();
      existing.delete(id);
      panelHtmlCache.delete(id);
    }
  }
  let head = stack.querySelector('.sheet__head');
  if (phone && ids.length) {
    if (!head) {
      head = document.createElement('div');
      head.className = 'sheet__head';
      stack.prepend(head);
    }
    head.innerHTML = `<button class="sheet__grip-btn" type="button" data-action="grow-sheet" aria-label="${state.tall ? 'Make the panel smaller' : 'Make the panel taller'}"><span class="sheet__grip" aria-hidden="true"></span></button><div class="sheet__tabs" role="tablist" aria-label="Panels">${PANELS.map(
      (p) =>
        `<button class="sheet__tab${state.sheet === p.id ? ' is-on' : ''}" type="button" role="tab" id="tab-${p.id}" aria-selected="${state.sheet === p.id}" aria-controls="panel-${p.id}" tabindex="${state.sheet === p.id ? 0 : -1}" data-sheet-tab="${p.id}">${icon(p.icon, 16)}<span>${p.title}</span>${p.id === 'checks' ? checksBadge() : ''}</button>`,
    ).join('')}</div><button class="icon-btn" type="button" data-action="close-sheet" aria-label="Close the panel">${icon('close', 18)}</button>`;
  } else head?.remove();
  for (const id of ids) {
    let node = existing.get(id);
    const meta = PANELS.find((p) => p.id === id)!;
    if (!node) {
      node = document.createElement('section');
      node.className = `panel panel--${id}`;
      node.dataset.panel = id;
      node.dataset.mode = phone ? 'sheet' : 'card';
      node.id = `panel-${id}`;
      if (phone) {
        node.setAttribute('role', 'tabpanel');
        node.setAttribute('aria-labelledby', `tab-${id}`);
      } else {
        node.setAttribute('role', 'region');
        node.setAttribute('aria-labelledby', `panel-${id}-title`);
      }
      node.innerHTML = `<div class="panel__head"><span class="panel__icon" aria-hidden="true">${icon(meta.icon, 18)}</span><div class="panel__titles"><h2 class="panel__title" id="panel-${id}-title" tabindex="-1">${meta.title}</h2><span class="panel__sub"></span></div><button class="icon-btn" type="button" data-close-panel="${id}" aria-label="Close ${meta.title}">${icon('close', 18)}</button></div><div class="panel__body" tabindex="0" aria-label="${meta.title}"></div>${panelFoot(id)}`;
      if (!reduced()) node.classList.add('is-entering');
      stack.append(node);
    }
    $('.panel__sub', node).textContent = panelSubtitle(id);
    const body = panelBody(id);
    if (panelHtmlCache.get(id) !== body) {
      $('.panel__body', node).innerHTML = body;
      panelHtmlCache.set(id, body);
    }
  }
  // Order follows PANELS.
  for (const id of ids) {
    const node = stack.querySelector<HTMLElement>(`#panel-${id}`);
    if (node) stack.append(node);
  }
  if (phone && ids.length) {
    // The sheet stops below the drawing (unless it was made taller), so the numbers stay in sight.
    const b = contentBounds(cam.z, false);
    const H = window.innerHeight;
    const room = H - (cam.y + b.y1) - 8;
    stack.style.maxHeight = state.tall ? `${Math.round(H * 0.86)}px` : `${Math.round(clamp(room, H * 0.4, H * 0.6))}px`;
  } else stack.style.maxHeight = '';
}

$('#panel-switch').addEventListener('pointerover', (e) => showTip((e.target as Element).closest<HTMLElement>('.switch')));
$('#panel-switch').addEventListener('pointerleave', () => showTip(null));
$('#panel-switch').addEventListener('focusin', (e) => showTip((e.target as Element).closest<HTMLElement>('.switch')));
$('#panel-switch').addEventListener('focusout', () => showTip(null));

$('#panel-switch').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('[data-panel]');
  if (b) togglePanel(b.dataset.panel as PanelId);
});

$('#panel-stack').addEventListener('toggle', (e) => {
  if ((e.target as Element).classList?.contains('ex-more')) state.circuitOpen = (e.target as HTMLDetailsElement).open;
}, true);

$('#panel-stack').addEventListener('keydown', (e) => {
  // Arrow keys move between the sheet's tabs (the tab pattern).
  const tab = (e.target as Element).closest<HTMLElement>('[role="tab"]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const i = PANELS.findIndex((p) => p.id === tab.dataset.sheetTab);
  const j = e.key === 'Home' ? 0 : e.key === 'End' ? PANELS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + PANELS.length) % PANELS.length;
  state.sheet = PANELS[j]!.id;
  renderPanels();
  focusPanel(state.sheet);
});

$('#panel-stack').addEventListener('click', (e) => {
  const t = e.target as Element;
  const close = t.closest<HTMLElement>('[data-close-panel]');
  if (close) return closePanel(close.dataset.closePanel as PanelId);
  if (t.closest('[data-action="close-sheet"]')) return closePanel(state.sheet ?? 'netlist');
  if (t.closest('[data-action="grow-sheet"]')) {
    state.tall = !state.tall;
    renderPanels();
    return;
  }
  const tab = t.closest<HTMLElement>('[data-sheet-tab]');
  if (tab) {
    state.sheet = tab.dataset.sheetTab as PanelId;
    renderPanels();
    return;
  }
  const selectPart = t.closest<HTMLElement>('[data-select-part]');
  if (selectPart) {
    state.cardOpen = false;
    select(selectPart.dataset.selectPart!);
    return;
  }
  const selectLine = t.closest<HTMLElement>('[data-select-line]');
  if (selectLine) {
    const link = LINKS.find((l) => l.line === Number(selectLine.dataset.selectLine));
    if (link) {
      if (state.layout === 'phone') state.sheet = undefined;
      openCard(link.partId);
    }
    return;
  }
  if (t.closest('[data-action="try-trap"]')) {
    state.played = true;
    state.invite = false;
    setValue('r1', '1M', 'trap');
    toast('R1 is now 1M. See what the check says about it.');
    renderInvite();
    return;
  }
  const fixButton = t.closest<HTMLElement>('[data-fix]');
  if (fixButton) {
    const [trapId, index] = fixButton.dataset.fix!.split(':');
    const trap = traps.find((x) => x.id === trapId);
    const fix = trap?.fixes[Number(index)];
    if (trap && fix) applyFix(fix.changes);
    return;
  }
  if (t.closest('[data-action="copy"]')) {
    void navigator.clipboard?.writeText(netlist()).then(
      () => toast('Netlist copied'),
      () => toast('Copying is blocked here: select the text instead'),
    );
  }
});

/** Apply a one-click fix to the netlist text, then read the divider's values back from it. */
function applyFix(changes: { from: number; to: number; insert: string }[]): void {
  let text = netlist();
  for (const c of [...changes].sort((a, b) => b.from - a.from)) text = text.slice(0, c.from) + c.insert + text.slice(c.to);
  const lines = text.split('\n');
  const read = (prefix: string): string | undefined => {
    const l = lines.find((x) => x.startsWith(prefix));
    return l === undefined ? undefined : l.slice(prefix.length);
  };
  const v1 = read('V1 in 0 ');
  const r1 = read('R1 in out ');
  const r2 = read('R2 out 0 ');
  if (v1 === undefined || r1 === undefined || r2 === undefined) return toast('This fix changes more than the drawing can show');
  const before = { ...state.values };
  state.values = { v1, r1, r2 };
  state.changedLine = changes.length ? text.slice(0, changes[0]!.from).split('\n').length : undefined;
  refreshModel();
  commit();
  requestSolve(true);
  renderAll();
  // Say the result, not the button's label: "R1 is now 1meg (1 MΩ)".
  const names: Record<keyof Divider, string> = { v1: 'V1', r1: 'R1', r2: 'R2' };
  const changed = (['v1', 'r1', 'r2'] as const).find((k) => before[k] !== state.values[k]);
  if (changed) {
    const p = partById(changed)!;
    const v = readValue(state.values[changed]);
    toast(`${names[changed]} is now ${state.values[changed]}${v === undefined ? '' : ` (${withUnit(v, p.kind)})`}`);
  } else toast('Fixed');
}

// ================================================================== live solving

const solver = liveSolver(onSolution, (error) => {
  state.pending = false;
  renderLive();
  toast(`ngspice could not run: ${(error as Error).message ?? error}`);
});
let solveTimer = 0;
let announceTimer = 0;

function requestSolve(immediate = false): void {
  state.pending = true;
  renderLive();
  clearTimeout(solveTimer);
  const go = (): void => solver.request(netlist());
  if (immediate) go();
  else solveTimer = window.setTimeout(go, 150);
}

/** The first run also starts ngspice: run once more so "Live · n ms" shows the time a re-run really takes. */
let warmed = false;
/** The first answer settles the first screen's layout (the labels get their real numbers). */
let settled = false;

function onSolution(s: Solution): void {
  state.solution = s;
  let current = s.netlist === netlist();
  if (!warmed && current) {
    warmed = true;
    if (s.ms > 30) {
      solver.request(netlist());
      current = false;
    }
  }
  state.pending = !current;
  if (current) state.changedLine = undefined;
  renderLabels();
  renderPartsA11y();
  renderArrows();
  updateFlow();
  updateCard();
  renderPanels();
  renderLive();
  if (!settled && s.status === 'ok') {
    settled = true;
    if (!state.touched) fit(false);
  }
  positionCard();
  if (current) {
    clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => announce(summaryOf(s.words.summarySpeech)), 600);
    shotCheck();
  }
}

function renderLive(): void {
  const live = $('#live');
  const meta = $('#live-meta');
  const s = state.solution;
  live.classList.toggle('is-on', state.live);
  live.classList.toggle('is-busy', state.pending);
  live.setAttribute('aria-checked', String(state.live));
  const old = stale();
  live.setAttribute('aria-label', `Live: ${state.live ? 'on, ngspice re-runs as you edit' : 'off, press Run to update the numbers'}`);
  live.title = state.live ? (s ? `ngspice re-ran in ${Math.max(1, Math.round(s.ms))} ms` : 'ngspice is starting') : 'Live is off: press Run to update the numbers';
  meta.textContent = !state.live ? (old ? 'press Run' : 'off') : state.pending ? '' : s ? `${Math.max(1, Math.round(s.ms))} ms` : '';
  $('.live__tick', live).innerHTML = state.live && !state.pending && s ? icon('tick', 14) : '';
  labelsEl.classList.toggle('is-stale', old);
  $('#layer-arrows').classList.toggle('is-stale', old);
  $('#card-live')?.classList.toggle('is-stale', old);
  $('#run').classList.toggle('is-wanted', old);
}

$('#live').addEventListener('click', () => {
  state.live = !state.live;
  renderLive();
  updateFlow();
  toast(state.live ? 'Live is on: ngspice re-runs as you edit' : 'Live is off: press Run to update the numbers');
  if (state.live && state.solution?.netlist !== netlist()) requestSolve(true);
});

$('#run').addEventListener('click', run);

function run(): void {
  requestSolve(true);
  const btn = $('#run');
  if (!reduced()) {
    btn.classList.remove('is-ran');
    void btn.offsetWidth;
    btn.classList.add('is-ran');
  }
}

// ================================================================== small things: toast, announcer, hint, keys

let toastTimer = 0;
/** A short note that says what happened. It stays clear of the numbers: by the Live island, or above the dock or sheet. */
function toast(text: string): void {
  const t = $('#toast');
  t.textContent = text;
  if (state.layout === 'phone') {
    const sheets = [state.cardOpen ? $('#part-card') : null, state.sheet ? $('#panel-stack') : null, state.partsSheet ? $('#parts-sheet') : null].filter(Boolean) as HTMLElement[];
    const sheetH = Math.max(0, ...sheets.map((s) => s.getBoundingClientRect().height));
    const dockH = window.innerHeight - ($('#dock').getBoundingClientRect().top || window.innerHeight);
    t.style.bottom = `${Math.round(Math.max(sheetH, dockH) + 10)}px`;
  } else {
    t.style.bottom = '';
    const run = $('#run-island').getBoundingClientRect();
    t.style.setProperty('--toast-right', `${Math.round(window.innerWidth - run.left + 12)}px`);
  }
  t.classList.add('is-shown');
  app.classList.add('has-toast');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    t.classList.remove('is-shown');
    app.classList.remove('has-toast');
  }, 2200);
}

function announce(text: string): void {
  const a = $('#announcer');
  a.textContent = '';
  window.setTimeout(() => (a.textContent = text), 40);
}

function renderHint(): void {
  const h = $('#hint');
  let text = '';
  const tap = state.layout === 'phone' ? 'Tap' : 'Click';
  if (state.tool === 'wire') text = state.wireStart ? `${tap} to end the wire here · Esc to stop` : `${tap} where the wire starts · wires are drawing only in this prototype`;
  else if (state.tool !== 'select') text = `${tap} to place ${state.tool === 'GND' ? 'a ground' : `a ${KIND[state.tool].word.toLowerCase()}`} · Shift+R turns it · Esc to stop`;
  else if (state.cardOpen) text = 'Type a value like 3k, 4.7k or 1meg · ↑ ↓ step through standard values · Enter keeps it · Esc puts it back';
  else if (state.selected) text = 'Enter opens the part · Esc lets go';
  else text = 'Click a part to change it · drag the board to move around · Ctrl + wheel zooms · ? lists the keys';
  h.textContent = text;
  app.classList.toggle('is-placing', state.tool !== 'select');
}

const KEYS: [string, string][] = [
  ['R C L', 'Resistor, capacitor, inductor'],
  ['V I', 'Voltage source, current source'],
  ['E F G H', 'Controlled sources'],
  ['0', 'Ground (node 0)'],
  ['W', 'Wire'],
  ['Esc', 'Back to Select; put a value back; close a card'],
  ['Shift R', 'Turn the part you are placing or have selected'],
  ['Delete', 'Delete a placed part'],
  ['Tab, Enter', 'Move between parts; open one'],
  [`${MOD} Z, ${MOD} Shift Z`, 'Undo, redo'],
  [`${MOD} Enter`, 'Run ngspice now'],
  ['N K X', 'Netlist, Checks, Explain'],
  ['+ − Shift 1', 'Zoom in, out, fit'],
];

function openKeys(): void {
  const k = $('#keys');
  k.innerHTML = `<div class="keys__card"><div class="keys__head"><h2 id="keys-title">Keyboard</h2><button class="icon-btn" type="button" data-action="close-keys" aria-label="Close">${icon('close', 18)}</button></div><dl class="keys__list">${KEYS.map(
    ([key, what]) => `<div><dt>${key
      .split(', ')
      .map((part) => part.split(' ').map((x) => `<kbd>${esc(x)}</kbd>`).join(''))
      .join('<span class="keys__or">or</span>')}</dt><dd>${esc(what)}</dd></div>`,
  ).join('')}</dl></div>`;
  k.hidden = false;
  k.querySelector<HTMLButtonElement>('[data-action="close-keys"]')!.focus();
  k.onclick = (e) => {
    if (e.target === k || (e.target as Element).closest('[data-action="close-keys"]')) closeKeys();
  };
}

function closeKeys(): void {
  $('#keys').hidden = true;
  $<HTMLButtonElement>('#btn-keys')?.focus();
}

// ================================================================== view island (zoom, undo)

function buildView(): void {
  $('#view-island').innerHTML = `
    <div class="seg">
      <button class="icon-btn" type="button" id="btn-zoom-out" aria-label="Zoom out" aria-keyshortcuts="-">${icon('minus', 18)}</button>
      <button class="zoom-level" type="button" aria-keyshortcuts="Shift+1" title="Fit the circuit in view (Shift+1)"><span id="zoom-level">100%</span><span class="sr-only"> zoom: fit the circuit in view</span></button>
      <button class="icon-btn" type="button" id="btn-zoom-in" aria-label="Zoom in" aria-keyshortcuts="+">${icon('plus', 18)}</button>
      <button class="icon-btn" type="button" id="btn-fit" aria-label="Fit the circuit in view" aria-keyshortcuts="Shift+1" title="Fit (Shift+1)">${icon('fit', 18)}</button>
    </div>
    <div class="seg">
      <button class="icon-btn" type="button" id="btn-undo" aria-label="Undo" aria-keyshortcuts="Control+Z">${icon('undo', 18)}</button>
      <button class="icon-btn" type="button" id="btn-redo" aria-label="Redo" aria-keyshortcuts="Control+Shift+Z">${icon('redo', 18)}</button>
    </div>
    <button class="icon-btn view__keys" type="button" id="btn-keys" aria-label="Keyboard shortcuts" aria-keyshortcuts="?">${icon('keyboard', 18)}</button>`;
  const centre = (): Pt => {
    const r = freeRect();
    return [r.x + r.w / 2, r.y + r.h / 2];
  };
  $('#btn-zoom-in').addEventListener('click', () => zoomAt(1.2, centre(), true));
  $('#btn-zoom-out').addEventListener('click', () => zoomAt(1 / 1.2, centre(), true));
  $('.zoom-level').addEventListener('click', () => fit(true, true));
  $('#btn-fit').addEventListener('click', () => fit(true, true));
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#btn-keys').addEventListener('click', openKeys);
}

function renderView(): void {
  const u = document.getElementById('btn-undo') as HTMLButtonElement | null;
  const r = document.getElementById('btn-redo') as HTMLButtonElement | null;
  if (u) u.disabled = past.length === 0 && JSON.stringify(snapshot()) === JSON.stringify(committed);
  if (r) r.disabled = future.length === 0;
}

// ================================================================== keyboard

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  const typing = t.closest('input[type="text"], textarea, [contenteditable="true"]') !== null;
  const mod = e.ctrlKey || e.metaKey;
  if (!$('#keys').hidden) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeKeys();
    }
    return;
  }
  if (mod && e.key === 'Enter') {
    e.preventDefault();
    commit();
    run();
    return;
  }
  if (mod && (e.key === 'z' || e.key === 'Z')) {
    if (typing) return;
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (mod && (e.key === 'y' || e.key === 'Y') && !typing) {
    e.preventDefault();
    redo();
    return;
  }
  if (e.key === 'Escape') {
    if (state.menu) return closeMenu(true);
    if (state.partsSheet) return closePartsSheet(true);
    if (state.tool === 'wire' && state.wireStart) {
      state.wireStart = undefined;
      renderGhost();
      renderHint();
      return;
    }
    if (state.tool !== 'select') return setTool('select');
    if (state.cardOpen) return closeCard(true);
    if (state.layout === 'phone' && state.sheet) return closePanel(state.sheet);
    if (state.selected) {
      const id = state.selected;
      select(undefined);
      board.querySelector<SVGGElement>(`[data-id="${id}"]`)?.focus({ preventScroll: true });
    }
    return;
  }
  if (typing || mod || e.altKey) return;
  if (t.closest('input[type="range"]') && /^Arrow|Home|End|Page/.test(e.key)) return;
  if (t.closest('[role="menu"], [role="toolbar"], [role="tablist"]') && /^Arrow|Home|End/.test(e.key)) return;
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (e.shiftKey && key === 'R') {
    e.preventDefault();
    if (state.tool !== 'select' && state.tool !== 'wire') {
      state.ghostRot = ((state.ghostRot + 90) % 360) as Rot;
      renderGhost();
    } else rotateSelected();
    return;
  }
  if (key === '?' || (e.shiftKey && key === '/')) {
    e.preventDefault();
    openKeys();
    return;
  }
  if (e.shiftKey && (key === '!' || e.code === 'Digit1')) {
    e.preventDefault();
    fit(true, true);
    return;
  }
  if (e.shiftKey) return;
  if (key === 'Delete' || key === 'Backspace') {
    if (state.selected) {
      e.preventDefault();
      deleteSelected();
    }
    return;
  }
  if (key === '+' || key === '=') return zoomAt(1.2, [window.innerWidth / 2, window.innerHeight / 2], true);
  if (key === '-' || key === '_') return zoomAt(1 / 1.2, [window.innerWidth / 2, window.innerHeight / 2], true);
  const panel = PANELS.find((p) => p.key === key);
  if (panel) {
    e.preventDefault();
    togglePanel(panel.id);
    return;
  }
  const kind = KINDS.find((k) => k.key === key);
  if (kind) {
    e.preventDefault();
    setTool(kind.kind);
    return;
  }
  if (key === 'W') {
    e.preventDefault();
    setTool('wire');
  }
});

// ================================================================== layout and first paint

function renderAll(): void {
  app.dataset.layout = state.layout;
  renderBoard();
  renderLabels();
  renderToolbar();
  renderDock();
  renderPanels();
  renderPartsSheet();
  renderCard();
  renderInvite();
  renderLive();
  renderHint();
  renderView();
}

function applyLayout(): void {
  const next: Layout = phoneQuery.matches ? 'phone' : 'desktop';
  if (next !== state.layout) {
    state.layout = next;
    if (next === 'phone') {
      state.sheet = state.panels.values().next().value;
      state.panels.clear();
      closeMenu();
    } else {
      if (state.sheet) state.panels.add(state.sheet);
      state.sheet = undefined;
      state.partsSheet = false;
    }
    cardFor = undefined;
  }
  renderAll();
  fit(false);
}

phoneQuery.addEventListener('change', applyLayout);
motionQuery.addEventListener('change', () => updateFlow());
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    renderToolbar();
    fit(false);
    renderPanels();
  }, 60);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelAnimationFrame(flow.raf);
  else updateFlow();
});

// ================================================================== screenshots (#shot=...)

let shotGoal: (() => boolean) | undefined;

function shotCheck(): void {
  if (!shotGoal || document.body.dataset.shotReady === '1') return;
  if (!shotGoal()) return;
  void document.fonts.ready.then(() =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        renderToolbar();
        positionLabels();
        positionInvite();
        positionCard();
        renderPanels();
        document.body.dataset.shotReady = '1';
      }),
    ),
  );
}

function solvedFor(r1: string): () => boolean {
  return () => state.solution?.netlist === dividerNetlist({ ...state.values, r1 }) && state.values.r1 === r1 && !state.pending;
}

/** The screenshot states set things up before the first fit, the way a student would find them. */
function prepareShot(): void {
  switch (shot) {
    case 'edit':
      // The first screen, then a click on R1: the view stays where the first screen put it.
      break;
    case 'panels':
      state.played = true;
      state.invite = false;
      state.inviteBand = false;
      state.selected = 'r1';
      if (state.layout === 'phone') state.sheet = 'explain';
      else {
        state.panels.add('netlist');
        state.panels.add('explain');
      }
      break;
    case 'check':
      state.played = true;
      state.invite = false;
      state.inviteBand = false;
      if (state.layout === 'phone') state.sheet = 'checks';
      else state.panels.add('checks');
      state.values = { ...state.values, r1: '1M' };
      break;
  }
}

function startShot(): void {
  switch (shot) {
    case 'edit': {
      openCard('r1');
      const input = $<HTMLInputElement>('#card-value');
      input.value = '3k';
      setValue('r1', '3k', 'type');
      shotGoal = solvedFor('3k');
      break;
    }
    case 'panels':
      shotGoal = solvedFor(FIRST_CIRCUIT.r1);
      break;
    case 'check':
      shotGoal = solvedFor('1M');
      break;
    case 'solved':
      shotGoal = solvedFor(FIRST_CIRCUIT.r1);
      break;
    default:
      shotGoal = undefined;
  }
  shotCheck();
}

// ================================================================== start

function start(): void {
  $('.brand__mark').innerHTML = logo(36);
  $('#run').innerHTML = `${icon('play', 16)}<span class="run__word">Run</span><kbd class="run__kbd" aria-hidden="true">${MOD} ↵</kbd>`;
  $('#run').title = `Run ngspice now (${MOD}+Enter)`;
  buildToolbar();
  buildMenu();
  buildDock();
  buildView();
  prepareShot();
  refreshModel();
  applyLayout();
  void warmUp().catch(() => undefined);
  requestSolve(true);
  startShot();
  // Fonts change the size of the labels and islands: settle the layout once they are in.
  void document.fonts.ready.then(() => {
    renderToolbar();
    renderLabels();
    if (!state.touched) fit(false);
    renderPanels();
  });
  for (const type of ['pointerdown', 'keydown', 'wheel'] as const) window.addEventListener(type, () => (state.touched = true), { capture: true, once: true });
}

start();
