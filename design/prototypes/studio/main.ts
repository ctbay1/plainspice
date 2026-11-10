/**
 * PlainSpice, milestone 2, design direction "Studio": a dark pro tool in the Figma / Linear league
 * with Falstad's live feel. Throwaway prototype code for choosing a direction (design/prototypes/).
 *
 * Every number and every sentence about the circuit comes from the real model
 * (design/prototypes/shared/sim.ts: ngspice 47 in a Web Worker, the checks, the explanations). This
 * file only draws, animates and wires up the interactions.
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
  warmUp,
  type CurrentWords,
  type Divider,
  type LineExplanation,
  type Solution,
  type Trap,
} from '../shared/sim.ts';
import {
  axis,
  bodyEnds,
  EXAMPLE_LINKS,
  EXAMPLE_NODES,
  exampleParts,
  GRID,
  isVertical,
  KINDS,
  partBox,
  pathData,
  pointAt,
  polylineLength,
  round,
  route,
  snap,
  SYMBOLS,
  terminalDir,
  terminals,
  toWorld,
  type FreeWire,
  type Kind,
  type Link,
  type Part,
  type Pt,
  type Rot,
} from './geometry.ts';
import { icon, logo, partIcon } from './icons.ts';
import { createPalette, type Command } from './palette.ts';
import { checksHTML, esc, explainHTML, netlistHTML, PART_LINE } from './panels.ts';
import { readValue, sliderModel, spell, stepText } from './values.ts';

// ================================================================== environment

const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
/** Phones and portrait tablets get the touch layout: bottom bar, sheets, the value card. */
const phoneQuery = matchMedia('(max-width: 900px)');
const reducedMotion = (): boolean => motionQuery.matches;
const isPhone = (): boolean => phoneQuery.matches;
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T => root.querySelector<T>(sel)!;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

/** Per-viewer conveniences only (theme, dock): never needed for the page to work. */
function load(key: string): string | null {
  try {
    return localStorage.getItem(`ps-studio:${key}`);
  } catch {
    return null;
  }
}
function save(key: string, value: string): void {
  try {
    localStorage.setItem(`ps-studio:${key}`, value);
  } catch {
    // private window or blocked storage: the setting just isn't remembered
  }
}

// ================================================================== state

type PanelId = 'netlist' | 'checks' | 'explain';
type Tool = 'select' | 'wire' | Kind;
type ValueId = 'V1' | 'R1' | 'R2';

interface Doc {
  values: Divider;
  parts: Part[];
  wires: FreeWire[];
}

interface View {
  x: number;
  y: number;
  k: number;
}

const PANELS: PanelId[] = ['netlist', 'checks', 'explain'];
const PANEL_INFO: Record<PanelId, { title: string; key: string; icon: string; sub: string }> = {
  netlist: { title: 'Netlist', key: 'N', icon: 'netlist', sub: 'Written from the drawing' },
  checks: { title: 'Checks', key: 'K', icon: 'checks', sub: 'Beginner traps in the netlist' },
  explain: { title: 'Explain', key: 'X', icon: 'explain', sub: 'Every line in plain words' },
};
const VALUE_IDS: ValueId[] = ['V1', 'R1', 'R2'];

const state = {
  doc: { values: { ...FIRST_CIRCUIT }, parts: exampleParts(FIRST_CIRCUIT), wires: [] } as Doc,
  undo: [] as Doc[],
  redo: [] as Doc[],
  selected: null as string | null,
  /** The part whose value editor is open (the popover on a desktop, the card on a phone). */
  editing: null as string | null,
  tool: 'select' as Tool,
  /** The last part chosen on a phone's Parts button. */
  lastPart: 'R' as Kind,
  /** The controlled source the rail's group button shows (and places when clicked from its menu). */
  lastControlled: 'E' as 'E' | 'F' | 'G' | 'H',
  live: true,
  solution: undefined as Solution | undefined,
  solving: false,
  runError: '' as string,
  panels: new Set<PanelId>(),
  dock: (load('dock') === 'right' ? 'right' : 'bottom') as 'bottom' | 'right',
  dockSize: { bottom: 300, right: 420 },
  sheet: null as PanelId | null,
  sheetFull: false,
  theme: (load('theme') === 'light' ? 'light' : 'dark') as 'dark' | 'light',
  view: { x: 0, y: 0, k: 1.8 } as View,
  viewTouched: false,
  coach: true,
  ghost: null as { x: number; y: number; rot: Rot } | null,
  wireStart: null as Pt | null,
  pointerWorld: null as Pt | null,
  shot: '' as string,
};

const netlist = (): string => dividerNetlist(state.doc.values);
const partById = (id: string | null): Part | undefined => (id ? state.doc.parts.find((p) => p.id === id) : undefined);
const valueKey = (id: string): keyof Divider | undefined => (id === 'V1' ? 'v1' : id === 'R1' ? 'r1' : id === 'R2' ? 'r2' : undefined);
const isValueId = (id: string | null): id is ValueId => !!id && (VALUE_IDS as string[]).includes(id);
const partValue = (p: Part): string => {
  const key = valueKey(p.id);
  return key ? state.doc.values[key] : p.value;
};

// The model's words, computed once per netlist text.
const memo = <T>(fn: (text: string) => T): ((text: string) => T) => {
  let lastText: string | undefined;
  let last: T;
  return (text) => {
    if (text !== lastText) {
      last = fn(text);
      lastText = text;
    }
    return last;
  };
};
const checksOf = memo(check);
const explainOf = memo(explain);
const describeOf = memo(describe);
const coloursOf = memo(nodeColours);

/** The name of the document: the title line, up to its colon ("A voltage divider"). */
const docTitle = (): string => netlist().split('\n')[0]!.replace(/^\*\s*/, '').split(':')[0]!.trim();

// ================================================================== history

let txnOpen = false;
const snapshot = (): Doc => structuredClone(state.doc);
/** Call before a change. Changes until endChange() are one undo step (a drag, a typing burst). */
function beginChange(): void {
  if (txnOpen) return;
  state.undo.push(snapshot());
  if (state.undo.length > 200) state.undo.shift();
  state.redo = [];
  txnOpen = true;
  renderHistoryButtons();
}
function endChange(): void {
  txnOpen = false;
}
function oneChange(fn: () => void): void {
  endChange();
  beginChange();
  fn();
  endChange();
}
function undo(): void {
  endChange();
  const prev = state.undo.pop();
  if (!prev) return toast('Nothing to undo');
  state.redo.push(snapshot());
  state.doc = prev;
  afterDocChange();
  toast('Undone');
}
function redo(): void {
  endChange();
  const next = state.redo.pop();
  if (!next) return toast('Nothing to redo');
  state.undo.push(snapshot());
  state.doc = next;
  afterDocChange();
  toast('Redone');
}

// ================================================================== the model's words for one part

interface Reading {
  /** How SPICE reads the value, from explain()'s value field ("1 mΩ (milli!)"); '' when it can't read one. */
  text: string;
  /** The same for a label on the drawing ("1 mΩ"), or the value as written when there is no reading. */
  short: string;
  tone: 'ok' | 'warn' | 'error';
  /** The first check on the part's line (check()), with its index in the Checks list. */
  trap?: Trap;
  trapIndex?: number;
}
const VALUE_LABELS = ['value', 'current', 'gain', 'amps per volt', 'volts per amp'];

/** How SPICE reads a part's value, from explain(), with the check on its line from check(). */
function readingFor(part: Part): Reading {
  const text = partValue(part);
  let line: LineExplanation | undefined;
  let traps: Trap[] = [];
  let trapIndex = -1;
  if (isValueId(part.id)) {
    const n = netlist();
    line = explainOf(n).find((l) => l.line === PART_LINE[part.id]);
    const all = checksOf(n);
    traps = all.filter((t) => t.line === PART_LINE[part.id]);
    // The worst check first: an error explains more than a warning.
    traps.sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'));
    trapIndex = traps[0] ? all.indexOf(traps[0]) : -1;
  } else if (part.kind !== 'GND') {
    line = explain(looseLine(part)).find((l) => l.line === 2);
  }
  const field = line ? [...line.fields].reverse().find((f) => VALUE_LABELS.includes(f.label)) : undefined;
  const tone: Reading['tone'] = traps.some((t) => t.severity === 'error') ? 'error' : traps.length ? 'warn' : 'ok';
  const trap = traps[0] ? { trap: traps[0], trapIndex } : {};
  if (field) return { text: field.meaning, short: field.meaning.replace(/\s*\(.*\)\s*$/, '').replace(/:.*$/, ''), tone, ...trap };
  return { text: '', short: text || '—', tone, ...trap };
}

/**
 * The check's first fix when it only rewrites the part's value ("Write 1k", "Make it 1meg"): the value
 * it writes, or undefined when the fix changes more (a new part name, a comment), which only the
 * Checks panel offers.
 */
function valueFix(id: ValueId, trap: Trap | undefined): { label: string; value: string } | undefined {
  const fix = trap?.fixes[0];
  if (!fix) return undefined;
  const n = netlist();
  const fixed = applyChanges(n, fix.changes);
  const before = n.split('\n')[PART_LINE[id]! - 1]!.trim().split(/\s+/);
  const after = (fixed.split('\n')[PART_LINE[id]! - 1] ?? '').trim().split(/\s+/);
  if (after.slice(0, 3).join(' ') !== before.slice(0, 3).join(' ')) return undefined;
  const value = after.slice(3).join(' ');
  if (!value || /[;*$]/.test(value)) return undefined;
  return { label: fix.label, value };
}

/** A fix's text changes applied to a netlist (from the end, so earlier offsets stay right). */
function applyChanges(text: string, changes: Trap['fixes'][number]['changes']): string {
  let out = text;
  for (const c of [...changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
}

/** A one-line netlist that names a new part, so explain() can read it ("1u" -> "1 µF"). */
function looseLine(p: Part): string {
  const v = p.value || '0';
  const control = p.control ?? KINDS[p.kind].defaultControl ?? '';
  // Its pins are not on any node yet: n1 and n2 stand for them ("a" and "b" read as English words).
  const line = control ? `${p.name} n1 n2 ${control} ${v}` : `${p.name} n1 n2 ${v}`;
  return `* part\n${line}\n`;
}

/**
 * What a new controlled source reads, written short as in the schematic model (decision 0013):
 * "V(out)", "I(V1)". Taken from the part's own control words, never invented.
 */
function controlText(p: Part): string {
  const words = (p.control ?? KINDS[p.kind].defaultControl ?? '').split(/\s+/).filter(Boolean);
  if (p.kind === 'F' || p.kind === 'H') return `I(${words[0] ?? '?'})`;
  if (p.kind === 'E' || p.kind === 'G') return words[1] && words[1] !== '0' ? `V(${words[0]}, ${words[1]})` : `V(${words[0] ?? '?'})`;
  return '';
}

/**
 * The label on the drawing for a part's value: "1 kΩ" from explain(); for a controlled source its gain
 * and what it reads, as the schematic model writes them (decision 0013): "2 × V(out)", "1 mA/V × V(out)".
 */
function valueLabel(p: Part): string {
  const reading = readingFor(p);
  if (p.kind !== 'E' && p.kind !== 'F' && p.kind !== 'G' && p.kind !== 'H') return reading.short;
  const v = readValue(p.value);
  const unit = p.kind === 'G' ? 'A/V' : p.kind === 'H' ? 'V/A' : '';
  const gain = v === undefined ? p.value || '?' : unit ? formatSI(v, unit) : formatSI(v);
  return `${gain} × ${controlText(p)}`;
}

/** "2 mA" -> the number and its unit, joined by a narrow no-break space (U+202F), the unit set lighter. */
function numHTML(text: string): string {
  const m = /^([−\-+]?[\d.]+(?:e[−\-+]?\d+)?)[\s  ]+(\S.*)$/.exec(text);
  if (!m) return `<span class="nu">${esc(text)}</span>`;
  return `<span class="nu"><span class="n">${esc(m[1]!)}</span><span class="u">\u202F${esc(m[2]!)}</span></span>`;
}

const selectedLine = (): number | undefined => (state.selected && PART_LINE[state.selected] ? PART_LINE[state.selected] : undefined);

/** The solution, when it belongs to the netlist on screen. */
const freshSolution = (): Solution | undefined => (state.solution && state.solution.netlist === netlist() ? state.solution : undefined);
const resultsUsable = (s: Solution | undefined): s is Solution => !!s && (s.status === 'ok' || s.status === 'unreliable');

// ================================================================== DOM shell

const app = $('#app');
const canvas = $('#canvas');
const svg = $<SVGSVGElement>('#schematic');
const world = $<SVGGElement>('#world');
const overlay = $('#overlay');
const inspector = $('#inspector');
const dock = $('#dock');
const dockBottom = $('#dock-bottom-slot');
const dockRight = $('#dock-right-slot');
const announcer = $('#announcer');

function buildShell(): void {
  // top bar
  $('#brand').innerHTML = `${logo(24)}<span class="brand__word">PlainSpice</span>`;
  $('#doc-title').textContent = docTitle();
  $('#btn-undo').innerHTML = icon('undo', 16);
  $('#btn-redo').innerHTML = icon('redo', 16);
  $('#btn-undo').setAttribute('aria-keyshortcuts', isMac ? 'Meta+Z' : 'Control+Z');
  $('#btn-redo').setAttribute('aria-keyshortcuts', isMac ? 'Meta+Shift+Z' : 'Control+Shift+Z');
  $('#btn-undo').dataset.tip = `Undo  ${MOD}Z`;
  $('#btn-redo').dataset.tip = `Redo  ${MOD}⇧Z`;
  $('#cmdk').innerHTML = `${icon('search', 15)}<span class="cmdk__text">Search or run a command…</span><span class="cmdk__keys" aria-hidden="true"><kbd class="kbd">${MOD}</kbd><kbd class="kbd">K</kbd></span>`;
  $('#cmdk').removeAttribute('aria-label');
  $('#cmdk').setAttribute('aria-keyshortcuts', isMac ? 'Meta+K' : 'Control+K');
  $('#btn-run').innerHTML = `${icon('play', 13)}<span>Run</span><span class="run__keys" aria-hidden="true"><kbd class="kbd">${MOD}</kbd><kbd class="kbd">↵</kbd></span>`;
  $('#btn-run').setAttribute('aria-keyshortcuts', isMac ? 'Meta+Enter' : 'Control+Enter');
  $('#btn-run').removeAttribute('aria-label');
  $('#btn-share').innerHTML = `${icon('share', 15)}<span>Share</span>`;
  $('#btn-more').innerHTML = icon('more', 18);
  $('#live-toggle').innerHTML = `<span class="live__dot" aria-hidden="true"></span><span class="live__label">Live</span><span class="live__track" aria-hidden="true"><span class="live__thumb"></span></span>`;

  // tool rail: the four controlled sources share one button with a menu (Figma's shape-tool
  // pattern); their letters E, F, G and H still place them straight away
  const groups: (Tool | 'controlled')[][] = [['select', 'wire'], ['R', 'C', 'L', 'V', 'I'], ['controlled'], ['GND']];
  $('#tools').innerHTML = groups
    .map(
      (g, gi) =>
        `${gi ? '<span class="rail__sep" role="separator"></span>' : ''}${g
          .map((t) => {
            if (t === 'controlled') return controlledButtonHTML();
            const { label, key } = toolInfo(t);
            const glyph = t === 'select' ? icon('select', 18) : t === 'wire' ? icon('wire', 18) : partIcon(t, 22);
            return `<button type="button" class="tool" data-tool="${t}" aria-pressed="false" aria-label="${esc(label)}, ${esc(key)}" aria-keyshortcuts="${keyShortcutAttr(key)}" tabindex="-1">
              ${glyph}<span class="tool__key" aria-hidden="true">${esc(key)}</span>
              <span class="tip tip--right" aria-hidden="true">${esc(label)}<kbd class="kbd">${esc(key)}</kbd></span>
            </button>`;
          })
          .join('')}`,
    )
    .join('');
  $('#rail-help').innerHTML = `${icon('keyboard', 18)}<span class="tip tip--right" aria-hidden="true">Keyboard shortcuts<kbd class="kbd">?</kbd></span>`;
  $('#ctrl-menu').innerHTML = `<p class="pop__kicker flyout__title" aria-hidden="true">Controlled sources</p>${CONTROLLED.map(
    (k) =>
      `<button type="button" role="menuitemradio" aria-checked="${k === state.lastControlled}" class="menu__item flyout__item" data-tool="${k}" tabindex="-1">${partIcon(k, 22)}<span class="flyout__name">${KINDS[k].name}</span><span class="flyout__check" aria-hidden="true">${icon('check', 14)}</span><kbd class="kbd" aria-hidden="true">${k}</kbd></button>`,
  ).join('')}`;

  // dock bar (desktop): panel toggles, status, zoom, dock side
  $('#panel-toggles').innerHTML = PANELS.map((id) => {
    const info = PANEL_INFO[id];
    return `<button type="button" class="ptoggle" data-panel="${id}" aria-pressed="false" aria-controls="pane-${id}" aria-keyshortcuts="${info.key}">
      ${icon(info.icon, 15)}<span>${info.title}</span><span class="ptoggle__badge" data-badge="${id}" hidden></span><kbd class="kbd kbd--quiet">${info.key}</kbd>
    </button>`;
  }).join('');
  $('#zoom').innerHTML = `
    <button type="button" class="icon-btn icon-btn--sm" data-action="zoom-out" aria-label="Zoom out" aria-keyshortcuts="-">${icon('minus', 15)}</button>
    <button type="button" class="zoom__value" data-action="zoom-reset" title="Reset the zoom to 100%"><span class="sr-only">Zoom </span><span id="zoom-value">100%</span><span class="sr-only">, reset to 100%</span></button>
    <button type="button" class="icon-btn icon-btn--sm" data-action="zoom-in" aria-label="Zoom in" aria-keyshortcuts="+">${icon('plus', 15)}</button>
    <button type="button" class="icon-btn icon-btn--sm" data-action="fit" aria-label="Zoom to fit" aria-keyshortcuts="Shift+1">${icon('fit', 15)}</button>`;

  // panes (created once; their bodies are redrawn)
  dock.innerHTML = `<div id="dock-resize" class="dock__resize" role="separator" tabindex="0" aria-label="Resize the panels" aria-valuemin="160" aria-valuemax="900" aria-valuenow="300"></div>${PANELS.map((id) => {
    const info = PANEL_INFO[id];
    const actions =
      id === 'netlist'
        ? `<button type="button" class="icon-btn icon-btn--sm" data-action="copy-netlist" aria-label="Copy the netlist">${icon('copy', 15)}</button>`
        : '';
    return `<section class="pane" id="pane-${id}" data-pane="${id}" aria-labelledby="pane-${id}-h" hidden>
      <header class="pane__head">
        <h2 class="pane__title" id="pane-${id}-h" tabindex="-1">${icon(info.icon, 15)}<span>${info.title}</span></h2>
        <span class="pane__sub">${info.sub}</span>
        <span class="pane__actions">${actions}
          <button type="button" class="icon-btn icon-btn--sm" data-action="dock-side" aria-label="Move the panels to the ${state.dock === 'bottom' ? 'right' : 'bottom'}">${icon(state.dock === 'bottom' ? 'dockRight' : 'dockBottom', 15)}</button>
          <button type="button" class="icon-btn icon-btn--sm" data-close-panel="${id}" aria-label="Close ${info.title}">${icon('close', 15)}</button>
        </span>
      </header>
      <div class="pane__body" id="pane-${id}-body" tabindex="0" role="region" aria-labelledby="pane-${id}-h"></div>
    </section>`;
  }).join('')}`;

  // phone: bottom bar (its panel buttons are the only panel tabs), the parts menu
  $('#phonebar').innerHTML = `
    <div class="pb__group" role="toolbar" aria-label="Tools">
      <button type="button" class="pb__btn" data-tool="select" aria-pressed="true">${icon('select', 20)}<span>Select</span></button>
      <button type="button" class="pb__btn" data-tool="wire" aria-pressed="false">${icon('wire', 20)}<span>Wire</span></button>
      <button type="button" class="pb__btn" id="pb-parts" aria-haspopup="true" aria-expanded="false" aria-controls="parts-pop"><span class="pb__partglyph">${partIcon('R', 20)}</span><span>Parts</span></button>
    </div>
    <span class="pb__sep" aria-hidden="true"></span>
    <div class="pb__group" aria-label="Panels" role="group">
      ${PANELS.map((id) => `<button type="button" class="pb__btn" data-sheet="${id}" aria-pressed="false" aria-controls="sheet">${icon(PANEL_INFO[id].icon, 20)}<span>${PANEL_INFO[id].title}</span><span class="pb__badge" data-badge="${id}" hidden></span></button>`).join('')}
    </div>`;
  $('#sheet-close').innerHTML = icon('close', 20);
  const basic: Kind[] = ['R', 'C', 'L', 'V', 'I', 'GND'];
  const controlled: Kind[] = ['E', 'F', 'G', 'H'];
  $('#parts-pop').innerHTML = `<p class="pop__title">Place a part</p>
    <div class="parts-grid">${basic
      .map((k) => `<button type="button" class="parts-grid__btn" data-place-kind="${k}">${partIcon(k, 26)}<span>${k === 'GND' ? 'Ground' : KINDS[k].name}</span></button>`)
      .join('')}</div>
    <p class="pop__kicker">Controlled sources</p>
    <div class="parts-list">${controlled
      .map(
        (k) =>
          `<button type="button" class="parts-list__btn" data-place-kind="${k}">${partIcon(k, 24)}<span class="parts-list__name">${KINDS[k].name}</span><span class="parts-list__letter" aria-hidden="true">${k}</span></button>`,
      )
      .join('')}</div>`;
  $('#more-pop').innerHTML = `
    <button type="button" role="menuitem" class="menu__item" data-action="palette">${icon('search', 16)}<span>Search commands</span></button>
    <button type="button" role="menuitem" class="menu__item" data-action="share">${icon('share', 16)}<span>Share a link</span></button>
    <button type="button" role="menuitem" class="menu__item" data-action="undo">${icon('undo', 16)}<span>Undo</span></button>
    <button type="button" role="menuitem" class="menu__item" data-action="redo">${icon('redo', 16)}<span>Redo</span></button>
    <button type="button" role="menuitem" class="menu__item" data-action="fit">${icon('fit', 16)}<span>Zoom to fit</span></button>
    <button type="button" role="menuitem" class="menu__item" data-action="theme"><span data-theme-icon></span><span data-theme-label>Light theme</span></button>
    <button type="button" role="menuitem" class="menu__item" data-action="reset">${icon('reset', 16)}<span>Start again</span></button>`;
}

const CONTROLLED = ['E', 'F', 'G', 'H'] as const;
const isControlled = (t: Tool): t is (typeof CONTROLLED)[number] => (CONTROLLED as readonly string[]).includes(t);

/** The rail's controlled-source button: shows the last one used, opens a menu of all four. */
function controlledButtonHTML(): string {
  const k = state.lastControlled;
  return `<button type="button" class="tool tool--group" id="tool-controlled" data-group="controlled" aria-haspopup="menu" aria-expanded="false" aria-controls="ctrl-menu" aria-keyshortcuts="E F G H" tabindex="-1" aria-label="${esc(controlledLabel())}">
    ${partIcon(k, 22)}<span class="tool__key" aria-hidden="true">${k}</span><span class="tool__more" aria-hidden="true"></span>
    <span class="tip tip--right" aria-hidden="true">Controlled sources<kbd class="kbd">E</kbd><kbd class="kbd">F</kbd><kbd class="kbd">G</kbd><kbd class="kbd">H</kbd></span>
  </button>`;
}
const controlledLabel = (): string =>
  `Controlled sources, E F G H: ${KINDS[state.lastControlled].name.toLowerCase()}${isControlled(state.tool) ? ', placing' : ''}`;

function openCtrlMenu(focusItem: boolean): void {
  closePopovers();
  const menu = $('#ctrl-menu');
  const btn = $('#tool-controlled');
  menu.style.top = `${btn.offsetTop - 8}px`;
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  if (focusItem) menu.querySelector<HTMLElement>(`[data-tool="${state.lastControlled}"]`)?.focus();
}

function onCtrlMenuKeyDown(e: KeyboardEvent): void {
  const items = [...document.querySelectorAll<HTMLElement>('#ctrl-menu .flyout__item')];
  const i = items.indexOf(document.activeElement as HTMLElement);
  let next = -1;
  if (e.key === 'ArrowDown') next = (i + 1) % items.length;
  else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  else if (e.key === 'Escape' || e.key === 'ArrowLeft') {
    e.preventDefault();
    e.stopPropagation();
    closePopovers();
    $('#tool-controlled').focus();
    return;
  } else if (e.key === 'Tab') {
    closePopovers();
    return;
  }
  if (next < 0) return;
  e.preventDefault();
  e.stopPropagation();
  items[next]!.focus();
}

function toolInfo(t: Tool): { label: string; key: string } {
  if (t === 'select') return { label: 'Select and move', key: 'Esc' };
  if (t === 'wire') return { label: 'Wire', key: 'W' };
  return { label: KINDS[t].name, key: KINDS[t].shortcut };
}
const keyShortcutAttr = (key: string): string => (key === 'Esc' ? 'Escape' : key);

// ================================================================== view (pan and zoom)

const toScreen = (p: Pt): Pt => ({ x: p.x * state.view.k + state.view.x, y: p.y * state.view.k + state.view.y });
const toWorldPt = (sx: number, sy: number): Pt => ({ x: (sx - state.view.x) / state.view.k, y: (sy - state.view.y) / state.view.k });

let viewAnim = 0;
function setView(v: View, animate = false): void {
  cancelAnimationFrame(viewAnim);
  if (!animate || reducedMotion()) {
    state.view = v;
    applyView();
    return;
  }
  const from = { ...state.view };
  const t0 = performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - t0) / 260);
    const e = 1 - (1 - t) ** 3;
    state.view = { x: from.x + (v.x - from.x) * e, y: from.y + (v.y - from.y) * e, k: from.k + (v.k - from.k) * e };
    applyView();
    if (t < 1) viewAnim = requestAnimationFrame(step);
  };
  viewAnim = requestAnimationFrame(step);
}

function applyView(): void {
  const { x, y, k } = state.view;
  world.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
  svg.style.setProperty('--z', String(k));
  overlay.style.setProperty('--ov-scale', String(overlayScale(k)));
  let step = GRID * k;
  while (step < 14) step *= 2;
  canvas.style.backgroundSize = `${step}px ${step}px`;
  // The dot sits in the middle of each tile: shift by half a tile so dots land on grid points.
  canvas.style.backgroundPosition = `${x - step / 2}px ${y - step / 2}px`;
  const zoomValue = document.getElementById('zoom-value');
  if (zoomValue) zoomValue.textContent = `${Math.round(k * 100)}%`;
  layoutOverlay();
}

/** Result labels shrink a little when the circuit is drawn small (a phone with a sheet open). */
const overlayScale = (k: number): number => clamp(k / 1.25, 0.85, 1);

/** Parts of the canvas covered by floating things (the phone's editor card and sheet). */
function coveredBottom(clampToCanvas = true): number {
  if (!isPhone()) return 0;
  const rect = canvas.getBoundingClientRect();
  let covered = 0;
  for (const el of [document.getElementById('sheet'), document.getElementById('pcard')]) {
    if (!el || el.hidden || el.classList.contains('is-closed')) continue;
    const r = el.getBoundingClientRect();
    covered = Math.max(covered, rect.bottom - r.top + 8);
  }
  return clampToCanvas ? clamp(covered, 0, rect.height * 0.75) : covered;
}

/** The inspector slides over the right of the canvas when something is selected (desktop). */
function coveredRight(): number {
  if (isPhone() || !inspectorOpen()) return 0;
  return inspector.offsetWidth;
}
const inspectorOpen = (): boolean => !isPhone() && !!state.selected && !!partById(state.selected);

function contentBox(): { x0: number; y0: number; x1: number; y1: number } {
  const boxes = state.doc.parts.map((p) => partBox(p));
  for (const w of state.doc.wires) for (const p of w.points) boxes.push({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/** Everything drawn for the circuit, on screen (canvas pixels): symbols, labels, chips, the tip and the editor. */
function drawnBox(withEditor = true): { x0: number; y0: number; x1: number; y1: number } {
  const c = canvas.getBoundingClientRect();
  const b = contentBox();
  const p0 = toScreen({ x: b.x0, y: b.y0 });
  const p1 = toScreen({ x: b.x1, y: b.y1 });
  const box = { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y };
  for (const [key, { el }] of overlayItems) {
    if (el.style.visibility === 'hidden' || (!withEditor && key === 'editor')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    box.x0 = Math.min(box.x0, r.left - c.left);
    box.y0 = Math.min(box.y0, r.top - c.top);
    box.x1 = Math.max(box.x1, r.right - c.left);
    box.y1 = Math.max(box.y1, r.bottom - c.top);
  }
  return box;
}

/**
 * Zoom and centre so the whole drawing fits, labels included. The labels keep their size while the
 * circuit scales, so the zoom is found by trying (a short binary search over real layouts).
 */
function fitView(animate = false): void {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const start = { ...state.view };
  const m = isPhone() ? 14 : 48;
  const area = { x0: m, y0: m + (isPhone() ? 0 : 8), x1: rect.width - coveredRight() - m, y1: rect.height - coveredBottom() - m };
  const areaW = Math.max(40, area.x1 - area.x0);
  const areaH = Math.max(40, area.y1 - area.y0);
  const b = contentBox();
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const at = (k: number): View => ({ k, x: rect.width / 2 - cx * k, y: rect.height / 2 - cy * k });
  const largest = (withEditor: boolean): number => {
    const fits = (k: number): boolean => {
      state.view = at(k);
      applyView();
      const d = drawnBox(withEditor);
      return d.x1 - d.x0 <= areaW && d.y1 - d.y0 <= areaH;
    };
    let lo = 0.4;
    let hi = isPhone() ? 1.4 : 2.4;
    if (fits(hi)) return hi;
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  // The value editor is fitted too, unless that would make the drawing small: then it floats over
  // the drawing on whichever side has room (ensureEditorVisible).
  let withEditor = overlayItems.has('editor');
  let k = largest(withEditor);
  if (withEditor && k < 0.8) {
    withEditor = false;
    k = largest(false);
  }
  // Centre the drawing (not just the circuit) in the free area.
  state.view = at(k);
  applyView();
  const d = drawnBox(withEditor);
  const target = { k, x: state.view.x + (area.x0 + area.x1) / 2 - (d.x0 + d.x1) / 2, y: state.view.y + (area.y0 + area.y1) / 2 - (d.y0 + d.y1) / 2 };
  state.view = start;
  setView(target, animate);
  if (state.editing && !isPhone()) window.setTimeout(() => ensureEditorVisible(false), animate && !reducedMotion() ? 280 : 0);
}

function zoomAt(factor: number, sx?: number, sy?: number): void {
  const rect = canvas.getBoundingClientRect();
  const px = sx ?? rect.width / 2;
  const py = sy ?? rect.height / 2;
  const k = clamp(state.view.k * factor, 0.35, 4);
  const w = toWorldPt(px, py);
  state.viewTouched = true;
  setView({ k, x: px - w.x * k, y: py - w.y * k });
}

// ================================================================== schematic (SVG)

function linkRoute(link: Link): Pt[] {
  const a = partById(link.a.part);
  const b = partById(link.b.part);
  if (!a || !b) return [];
  const pa = terminals(a)[link.a.t]!;
  const pb = terminals(b)[link.b.t]!;
  return route(pa, terminalDir(a, link.a.t), pb, terminalDir(b, link.b.t));
}

const nodeColour = (node: string | undefined): string =>
  !node ? 'var(--wire-loose)' : node === '0' ? 'var(--wire-ground)' : (coloursOf(netlist()).get(node) ?? 'var(--wire-loose)');

function partAria(p: Part): string {
  if (p.kind === 'GND') return 'Ground, node 0';
  const reading = readingFor(p);
  const nodes = p.example ? EXAMPLE_NODES[p.id] ?? [] : [];
  const where = nodes.length === 2 ? `, between ${nodes[0] === '0' ? 'ground' : nodes[0]} and ${nodes[1] === '0' ? 'ground' : nodes[1]}` : ', not wired yet';
  const sel = state.selected === p.id ? ', selected' : '';
  return `${p.name}, ${KINDS[p.kind].name.toLowerCase()}, ${reading.short}${where}${sel}`;
}

function partSVG(p: Part): string {
  const sym = SYMBOLS[p.kind];
  const nodes = p.example ? EXAMPLE_NODES[p.id] ?? [] : [];
  const leads = sym.leads
    .map(([a, b], i) => `<path class="lead"${nodes[i] ? ` data-node="${nodes[i]}"` : p.kind === 'GND' ? ' data-node="0"' : ''} d="M${a.x},${a.y} L${b.x},${b.y}" style="--wc:${p.kind === 'GND' ? 'var(--wire-ground)' : nodeColour(nodes[i])}"/>`)
    .join('');
  const circle = sym.circle ? `<circle class="body body--filled" r="${sym.circle.r}"/>` : '';
  const closed = sym.closed ? `<path class="body body--filled" d="${sym.closed}"/>` : '';
  const body = `<path class="body" d="${sym.body}"/>`;
  const fill = sym.fill ? `<path class="body-solid" d="${sym.fill}"/>` : '';
  const b = selectionBox(p.kind);
  // The hit area doubles as the keyboard focus ring: the same rounded box as the selection.
  const hit = `<rect class="hit" x="${b.x0}" y="${b.y0}" width="${b.x1 - b.x0}" height="${b.y1 - b.y0}" rx="6"/>`;
  const cls = ['part', state.selected === p.id ? 'is-selected' : '', p.example ? '' : 'is-loose', state.editing === p.id ? 'is-editing' : ''].filter(Boolean).join(' ');
  return `<g class="${cls}" data-part="${p.id}" tabindex="0" role="button" aria-label="${esc(partAria(p))}" transform="translate(${p.x} ${p.y}) rotate(${p.rot})">${hit}${leads}${circle}${closed}${body}${fill}</g>`;
}

/** The selection and focus box of a symbol, local (rotation 0): its body with a little room, not its leads. */
function selectionBox(kind: Kind): { x0: number; y0: number; x1: number; y1: number } {
  const sym = SYMBOLS[kind];
  if (kind === 'GND') return { x0: sym.box.x0 - 6, y0: sym.box.y0 - 4, x1: sym.box.x1 + 6, y1: sym.box.y1 + 5 };
  const [e0, e1] = bodyEnds(kind);
  const half = Math.max(sym.half, 7) + 6;
  return { x0: -half, y0: e0 - 7, x1: half, y1: e1 + 7 };
}

/** The selected part: one neutral outline with a soft glow, the same shape as the focus ring (no handles: parts don't resize). */
function selectionSVG(p: Part): string {
  const b = selectionBox(p.kind);
  return `<g transform="translate(${p.x} ${p.y}) rotate(${p.rot})"><rect class="sel-glow" x="${b.x0}" y="${b.y0}" width="${b.x1 - b.x0}" height="${b.y1 - b.y0}" rx="6"/><rect class="sel" x="${b.x0}" y="${b.y0}" width="${b.x1 - b.x0}" height="${b.y1 - b.y0}" rx="6"/></g>`;
}

function renderWorld(): void {
  const focused = document.activeElement?.closest?.('[data-part]')?.getAttribute('data-part');
  let wires = '';
  const ends = new Map<string, number>();
  for (const link of EXAMPLE_LINKS) {
    const pts = linkRoute(link);
    if (pts.length < 2) continue;
    wires += `<path class="wire" data-node="${link.node}" d="${pathData(pts)}" style="--wc:${nodeColour(link.node)}"/>`;
    for (const p of [pts[0]!, pts[pts.length - 1]!]) ends.set(`${p.x},${p.y}`, (ends.get(`${p.x},${p.y}`) ?? 0) + 1);
  }
  for (const w of state.doc.wires) wires += `<path class="wire wire--free" d="${pathData(w.points)}"/>`;
  // Junction dots: where two wires meet a terminal (the ground's T).
  let junctions = '';
  for (const [key, count] of ends) {
    if (count < 2) continue;
    const [x, y] = key.split(',').map(Number);
    junctions += `<path class="junction" data-node="${nodeAtPoint(x!, y!) ?? ''}" d="M${x},${y}h0" style="--wc:${nodeColour(nodeAtPoint(x!, y!))}"/>`;
  }
  // Open terminals of new parts: small hollow squares, so they never look like a junction.
  let open = '';
  for (const p of state.doc.parts) {
    if (p.example || p.kind === 'GND') continue;
    for (const t of terminals(p)) open += `<path class="pin" d="M${t.x},${t.y}h0"/><path class="pin pin--in" d="M${t.x},${t.y}h0"/>`;
  }
  const parts = state.doc.parts.map(partSVG).join('');
  const selected = partById(state.selected);
  const coachPart = state.coach ? partById('R1') : undefined;
  // The first screen's pointer at R1: a thin ring that pulses twice, then stays.
  let coachRing = '';
  if (coachPart) {
    const b = selectionBox(coachPart.kind);
    coachRing = `<g transform="translate(${coachPart.x} ${coachPart.y}) rotate(${coachPart.rot})"><rect class="coach-ring" x="${b.x0}" y="${b.y0}" width="${b.x1 - b.x0}" height="${b.y1 - b.y0}" rx="6"/></g>`;
  }
  $('#sch-title').textContent = `Schematic: ${docTitle()}`;
  $('#sch-desc').textContent = describeOf(netlist());
  world.innerHTML = `<g class="l-coach">${coachRing}</g><g class="l-wires">${wires}</g><g class="l-chevrons" id="chevrons"></g><g class="l-flow" id="flow"></g><g class="l-parts">${parts}</g><g class="l-junctions">${junctions}${open}</g><g class="l-sel">${selected ? selectionSVG(selected) : ''}</g><g class="l-ghost" id="ghost"></g>`;
  renderFlows();
  renderGhost();
  if (focused) world.querySelector<SVGGElement>(`[data-part="${focused}"]`)?.focus({ preventScroll: true });
}

function nodeAtPoint(x: number, y: number): string | undefined {
  for (const link of EXAMPLE_LINKS) {
    const pts = linkRoute(link);
    if (pts.some((p) => p.x === x && p.y === y)) return link.node;
  }
  return undefined;
}

function renderGhost(): void {
  const g = document.getElementById('ghost');
  if (!g) return;
  if (state.tool === 'wire' && state.wireStart && state.pointerWorld) {
    const end = { x: snap(state.pointerWorld.x), y: snap(state.pointerWorld.y) };
    const pts = route(state.wireStart, { x: 1, y: 0 }, end, { x: 0, y: 1 });
    g.innerHTML = `<path class="ghost-wire" d="${pathData(pts)}"/><path class="pin pin--ghost" d="M${state.wireStart.x},${state.wireStart.y}h0"/>`;
    return;
  }
  if (!state.ghost || state.tool === 'select' || state.tool === 'wire') {
    g.innerHTML = '';
    return;
  }
  const kind = state.tool;
  const sym = SYMBOLS[kind];
  const { x, y, rot } = state.ghost;
  const leads = sym.leads.map(([a, b]) => `<path d="M${a.x},${a.y} L${b.x},${b.y}"/>`).join('');
  const circle = sym.circle ? `<circle r="${sym.circle.r}"/>` : '';
  const closed = sym.closed ? `<path d="${sym.closed}"/>` : '';
  const fill = sym.fill ? `<path class="ghost-solid" d="${sym.fill}"/>` : '';
  g.innerHTML = `<g class="ghost" transform="translate(${x} ${y}) rotate(${rot})">${leads}${circle}${closed}<path d="${sym.body}"/>${fill}</g>`;
}

// ------------------------------------------------------------------ current flow (Falstad's dots)

interface Flow {
  points: Pt[];
  amps: number;
  /** Arc-length stretches (world units) behind a part's body: the dots fade out before them. */
  hide: [number, number][];
  length: number;
  /** The chain ends where it starts (a series loop): the dots run round without a seam. */
  closed: boolean;
  /** Screen pixels travelled so far (the speed follows the current). */
  travelled: number;
}
let flows: Flow[] = [];
/** One flow per wire, before chaining: where the static arrowheads go. */
let wireFlows: { points: Pt[] }[] = [];
let flowRaf = 0;
let flowLast = 0;
/** Screen pixels between two dots, and how far before a symbol they fade out. */
const DOT_SPACING = 40;
const DOT_FADE = 14;

/** Where a part's current enters (0 = terminal a, 1 = terminal b), from solve()'s from/to nodes. */
function entersAt(p: Part, c: CurrentWords): 0 | 1 | undefined {
  const nodes = EXAMPLE_NODES[p.id];
  if (!nodes || nodes.length < 2) return undefined;
  if (c.from === nodes[0] && c.to === nodes[1]) return 0;
  if (c.from === nodes[1] && c.to === nodes[0]) return 1;
  return undefined;
}

function computeFlows(s: Solution | undefined): Flow[] {
  if (!resultsUsable(s)) {
    wireFlows = [];
    return [];
  }
  const byName = new Map(s.currents.map((c) => [c.name, c]));
  type Seg = { points: Pt[]; amps: number; hide: [number, number][] };
  const segments: Seg[] = [];
  const links: { points: Pt[] }[] = [];
  wireFlows = links;
  for (const p of state.doc.parts) {
    const c = byName.get(p.name);
    if (!p.example || !c || p.kind === 'GND') continue;
    const at = entersAt(p, c);
    if (at === undefined || !Math.abs(c.value)) continue;
    const t = terminals(p);
    const [e0, e1] = bodyEnds(p.kind);
    // Terminals sit at local y = ∓40; the body runs from e0 to e1 between them.
    const hide: [number, number] = at === 0 ? [e0 + 40, e1 + 40] : [40 - e1, 40 - e0];
    segments.push({ points: at === 0 ? [t[0]!, t[1]!] : [t[1]!, t[0]!], amps: Math.abs(c.value), hide: [hide] });
  }
  for (const link of EXAMPLE_LINKS) {
    const ref = link.a.part !== 'GND' ? link.a : link.b;
    const p = partById(ref.part);
    const c = p ? byName.get(p.name) : undefined;
    if (!p || !c) continue;
    const at = entersAt(p, c);
    if (at === undefined || !Math.abs(c.value)) continue;
    const pts = linkRoute(link);
    // The current leaves the part at the terminal it does not enter at.
    const leavesHere = at !== ref.t;
    const fromRef = ref === link.a ? pts : [...pts].reverse();
    const points = leavesHere ? fromRef : [...fromRef].reverse();
    segments.push({ points, amps: Math.abs(c.value), hide: [] });
    links.push({ points });
  }
  // Chain segments into one loop when they meet end to start with the same current (a series loop),
  // so the dots run on without a jump.
  const key = (p: Pt): string => `${Math.round(p.x)},${Math.round(p.y)}`;
  const chained: Flow[] = [];
  const left = [...segments];
  while (left.length) {
    const first = left.shift()!;
    const chain = [...first.points];
    const hide = [...first.hide];
    let length = polylineLength(first.points);
    let grew = true;
    while (grew) {
      grew = false;
      const i = left.findIndex((s) => key(s.points[0]!) === key(chain[chain.length - 1]!) && Math.abs(s.amps - first.amps) <= first.amps * 0.01);
      if (i >= 0) {
        const next = left[i]!;
        for (const [a, b] of next.hide) hide.push([a + length, b + length]);
        chain.push(...next.points.slice(1));
        length += polylineLength(next.points);
        left.splice(i, 1);
        grew = true;
      }
    }
    const closed = key(chain[0]!) === key(chain[chain.length - 1]!);
    chained.push({ points: chain, amps: first.amps, hide, length, closed, travelled: 0 });
  }
  return chained;
}

const flowSpeed = (amps: number): number => clamp(55 * Math.sqrt(amps / 1e-3), 6, 190); // screen px per second

/** Results are on screen and fresh: the dots run (never with reduced motion, never on old results). */
const flowAnimates = (): boolean => !reducedMotion() && flows.length > 0 && !!freshSolution();

function renderFlows(): void {
  const before = new Map(flows.map((f) => [f.points.map((p) => `${p.x},${p.y}`).join(' '), f.travelled]));
  // Old results (Live off, values changed) keep their arrowheads, dimmed like the other results.
  flows = computeFlows(freshSolution() ?? state.solution);
  // Keep the dots where they were when the same loop is drawn again (a new value, the same wires).
  for (const f of flows) f.travelled = before.get(f.points.map((p) => `${p.x},${p.y}`).join(' ')) ?? 0;
  const flowLayer = document.getElementById('flow');
  const chevLayer = document.getElementById('chevrons');
  if (!flowLayer || !chevLayer) return;
  flowLayer.innerHTML = '';
  flowLayer.dataset.k = '';
  // One small arrowhead per wire, at all times, in the middle of its longest straight run: the
  // direction never depends on motion (a still frame or reduced motion shows it too).
  let chevrons = '';
  for (const f of wireFlows) {
    let best = 0;
    let at = 0;
    let run = 0;
    for (let i = 1; i < f.points.length; i++) {
      const len = Math.hypot(f.points[i]!.x - f.points[i - 1]!.x, f.points[i]!.y - f.points[i - 1]!.y);
      if (len > best) {
        best = len;
        at = run + len / 2;
      }
      run += len;
    }
    if (best < 24) continue;
    const { p, dir } = pointAt(f.points, at);
    const angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    chevrons += `<path class="chevron" d="M-3.6,-3.4 L3.2,0 L-3.6,3.4 Z" style="transform: translate(${p.x}px, ${p.y}px) rotate(${angle}deg) scale(calc(1 / var(--z)))"/>`;
  }
  chevLayer.innerHTML = chevrons;
  chevLayer.classList.toggle('is-stale', !freshSolution());
  if (flowAnimates()) drawDots(0);
  startFlowLoop();
}

/** Lay the dots out for this zoom (one element per dot) and move them along `dt` seconds. */
function drawDots(dt: number): void {
  const layer = document.getElementById('flow');
  if (!layer) return;
  const k = state.view.k;
  if (layer.dataset.k !== String(k)) {
    // The number of dots depends on the zoom: about one every DOT_SPACING screen pixels.
    layer.dataset.k = String(k);
    layer.innerHTML = flows
      .map((f, fi) => {
        const n = Math.max(2, Math.round((f.length * k) / DOT_SPACING));
        return Array.from({ length: n }, () => `<g class="dot" data-f="${fi}"><path class="dot__tail" d="M0,-1.7 L-14,-0.35 L-14,0.35 L0,1.7 Z"/><circle class="dot__head" r="2.1"/></g>`).join('');
      })
      .join('');
  }
  const groups = new Map<number, SVGGElement[]>();
  layer.querySelectorAll<SVGGElement>('.dot').forEach((el) => {
    const fi = Number(el.dataset.f);
    groups.set(fi, [...(groups.get(fi) ?? []), el]);
  });
  flows.forEach((f, fi) => {
    const dots = groups.get(fi) ?? [];
    if (!dots.length) return;
    f.travelled += flowSpeed(f.amps) * dt;
    const spacing = f.length / dots.length;
    const offset = ((f.travelled / k) % spacing + spacing) % spacing;
    const fadeWorld = DOT_FADE / k;
    dots.forEach((el, i) => {
      const s = offset + i * spacing;
      let gap = Infinity;
      for (const [a, b] of f.hide) gap = Math.min(gap, s >= a && s <= b ? 0 : Math.min(Math.abs(s - a), Math.abs(s - b)));
      if (!f.closed) gap = Math.min(gap, s, f.length - s);
      const t = clamp(gap / fadeWorld, 0, 1);
      const opacity = t * t * (3 - 2 * t);
      if (opacity <= 0.01) {
        el.style.opacity = '0';
        return;
      }
      const { p, dir } = pointAt(f.points, s);
      const angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
      el.setAttribute('transform', `translate(${round(p.x)} ${round(p.y)}) rotate(${angle}) scale(${1 / k})`);
      el.style.opacity = String(Math.round(opacity * 100) / 100);
    });
  });
}

function startFlowLoop(): void {
  cancelAnimationFrame(flowRaf);
  if (!flowAnimates()) return;
  flowLast = performance.now();
  const tick = (now: number): void => {
    const dt = Math.min(0.05, (now - flowLast) / 1000);
    flowLast = now;
    drawDots(dt);
    flowRaf = requestAnimationFrame(tick);
  };
  flowRaf = requestAnimationFrame(tick);
}

// ================================================================== overlay (chips, labels, pills)

type Place = 'top' | 'bottom' | 'left' | 'right' | 'center';
interface OverlaySpec {
  key: string;
  className: string;
  anchor: () => Pt | undefined;
  place: Place;
  /** Screen pixels between the anchor and the element. */
  gap: () => number;
  /** Extra screen offset after placing. */
  shift?: () => Pt;
}
const overlayItems = new Map<string, { el: HTMLElement; spec: OverlaySpec }>();

function overlayItem(spec: OverlaySpec, init: (el: HTMLElement) => void): HTMLElement {
  let item = overlayItems.get(spec.key);
  if (!item) {
    const el = document.createElement('div');
    el.className = `ov ${spec.className}`;
    el.dataset.key = spec.key;
    init(el);
    overlay.append(el);
    item = { el, spec };
    overlayItems.set(spec.key, item);
  } else item.spec = spec;
  return item.el;
}
function removeOverlay(key: string): void {
  const item = overlayItems.get(key);
  if (!item) return;
  item.el.remove();
  overlayItems.delete(key);
}

function layoutOverlay(): void {
  for (const { el, spec } of overlayItems.values()) {
    const a = spec.anchor();
    if (!a) {
      el.style.visibility = 'hidden';
      continue;
    }
    const s = toScreen(a);
    const gap = spec.gap();
    const shift = spec.shift?.() ?? { x: 0, y: 0 };
    el.style.visibility = '';
    el.dataset.place = spec.place;
    el.style.setProperty('--x', `${Math.round(s.x + shift.x)}px`);
    el.style.setProperty('--y', `${Math.round(s.y + shift.y)}px`);
    el.style.setProperty('--gap', `${gap}px`);
  }
}

/** The centre of the example circuit (labels go outside it, results inside). */
function centroid(): Pt {
  const ps = state.doc.parts.filter((p) => p.example && p.kind !== 'GND');
  const list = ps.length ? ps : state.doc.parts;
  return { x: list.reduce((s, p) => s + p.x, 0) / list.length, y: list.reduce((s, p) => s + p.y, 0) / list.length };
}

/** The side a new part's label was moved to, when its usual side is taken. */
const looseSides = new Map<string, Place>();

function labelSide(p: Part): Place {
  const c = centroid();
  if (!p.example) return looseSides.get(p.id) ?? (isVertical(p) ? 'right' : 'top');
  if (isVertical(p)) return p.x <= c.x ? 'left' : 'right';
  return p.y <= c.y ? 'top' : 'bottom';
}
const opposite: Record<Place, Place> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left', center: 'center' };

/**
 * A point just outside the part on one side (labels never sit on the symbol): beside the body across
 * the part's axis, past the pins along it.
 */
function sideAnchor(p: Part, side: Place): Pt {
  const n = side === 'left' ? { x: -1, y: 0 } : side === 'right' ? { x: 1, y: 0 } : side === 'top' ? { x: 0, y: -1 } : { x: 0, y: 1 };
  const alongAxis = Math.abs(n.x) === Math.abs(axis(p).x) && Math.abs(n.y) === Math.abs(axis(p).y);
  const reach = p.kind === 'GND' ? 24 : alongAxis ? 44 : Math.max(SYMBOLS[p.kind].half, 7) + 7;
  return { x: p.x + n.x * reach, y: p.y + n.y * reach };
}

function nodeAnchor(node: string): Pt | undefined {
  const link = EXAMPLE_LINKS.find((l) => l.node === node);
  if (!link) return undefined;
  const pts = linkRoute(link);
  if (pts.length === 3) return pts[1];
  if (pts.length === 2) return { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 };
  return undefined;
}

function nodePlace(node: string): Place {
  const a = nodeAnchor(node);
  const c = centroid();
  if (!a) return 'top';
  if (isPhone()) return a.y <= c.y ? 'top' : 'bottom';
  const dx = a.x - c.x;
  const dy = a.y - c.y;
  if (Math.abs(dy) >= Math.abs(dx) * 0.5) return dy <= 0 ? 'top' : 'bottom';
  return dx <= 0 ? 'left' : 'right';
}

/** Arrow rotation (degrees) for a part's current, on screen: the way solve() says it flows. */
function currentAngle(p: Part, c: CurrentWords): number | undefined {
  const at = entersAt(p, c);
  if (at === undefined) return undefined;
  const ax = axis(p);
  const dir = at === 0 ? ax : { x: -ax.x, y: -ax.y };
  return (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
}

/** The channel's current arrow: a short shaft with a filled head, drawn pointing right (rotated in CSS). */
const CURRENT_ARROW = `<svg class="cur__svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 12H16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M14.4 6.9 22 12l-7.6 5.1Z" fill="currentColor"/></svg>`;

function syncOverlay(): void {
  const keep = new Set<string>();
  const s = freshSolution() ?? state.solution;
  const usable = resultsUsable(s);
  const stale = !freshSolution();
  const n = netlist();
  const colours = coloursOf(n);
  const traps = checksOf(n);
  const currents = usable ? new Map(s.currents.map((c) => [c.name, c])) : new Map<string, CurrentWords>();

  // Part labels: name and value outside the circuit (and a source's power under them).
  for (const p of state.doc.parts) {
    const key = `label:${p.id}`;
    keep.add(key);
    if (p.kind === 'GND') {
      const el = overlayItem(
        { key, className: 'plabel plabel--ground', anchor: () => partById(p.id) && { x: partById(p.id)!.x, y: partById(p.id)!.y + 21 }, place: 'bottom', gap: () => 6 },
        (e) => (e.innerHTML = `<span class="plabel__value">0</span><span class="plabel__hint">ground</span>`),
      );
      el.setAttribute('aria-hidden', 'true');
      continue;
    }
    const side = labelSide(p);
    const el = overlayItem(
      { key, className: 'plabel', anchor: () => partById(p.id) && sideAnchor(partById(p.id)!, labelSide(partById(p.id)!)), place: side, gap: () => 6 },
      (e) => (e.innerHTML = `<span class="plabel__name"></span><span class="plabel__value"></span><span class="plabel__power" hidden><span class="plabel__bolt" aria-hidden="true">${icon('bolt', 12)}</span><span class="pow__word"></span><span class="pow__val"></span></span>`),
    );
    el.setAttribute('aria-hidden', 'true');
    const reading = readingFor(p);
    $('.plabel__name', el).textContent = p.name;
    const valueEl = $('.plabel__value', el);
    const label = valueLabel(p);
    if (p.example) setNum(valueEl, label, readValue(partValue(p)));
    else if (valueEl.dataset.t !== label) {
      valueEl.dataset.t = label;
      valueEl.innerHTML = numHTML(label);
    }
    el.classList.toggle('is-warn', reading.tone === 'warn');
    el.classList.toggle('is-error', reading.tone === 'error');
    el.classList.toggle('is-selected', state.selected === p.id);
    const power = currents.get(p.name)?.power;
    const powerEl = $('.plabel__power', el);
    powerEl.hidden = !power;
    if (power) {
      $('.pow__word', powerEl).textContent = power.delivers ? 'delivers' : 'absorbs';
      setNum($('.pow__val', powerEl), formatSI(power.watts, 'W'), power.watts);
    }
    powerEl.classList.toggle('is-stale', stale);
  }

  // Node chips with the node voltages: the only pills on the drawing.
  const nodeList = usable ? s.nodes : [...colours.keys()].map((node) => ({ node, text: '…', value: NaN, speech: '' }));
  for (const nv of nodeList) {
    const key = `chip:${nv.node}`;
    if (!nodeAnchor(nv.node)) continue;
    keep.add(key);
    const el = overlayItem(
      { key, className: 'chip', anchor: () => nodeAnchor(nv.node), place: nodePlace(nv.node), gap: () => (isPhone() ? 10 : 12) },
      (e) => {
        e.innerHTML = `<span class="chip__dot" aria-hidden="true"></span><span class="chip__name"></span><span class="chip__val"></span>`;
        e.dataset.node = nv.node;
      },
    );
    el.style.setProperty('--node', colours.get(nv.node) ?? 'var(--ink-3)');
    $('.chip__name', el).textContent = nv.node;
    const val = $('.chip__val', el);
    const before = val.dataset.t;
    setNum(val, usable ? nv.text : '—', nv.value);
    if (before !== undefined && before !== val.dataset.t) flash(el);
    el.classList.toggle('is-stale', stale);
    el.setAttribute('aria-hidden', 'true');
  }

  // Current arrows: a yellow arrow beside each part, inside the loop, with the value next to it.
  if (usable) {
    for (const c of s.currents) {
      const p = state.doc.parts.find((x) => x.name === c.name);
      if (!p) continue;
      const angle = currentAngle(p, c);
      const key = `cur:${p.id}`;
      keep.add(key);
      const el = overlayItem(
        {
          key,
          className: 'cur',
          anchor: () => partById(p.id) && sideAnchor(partById(p.id)!, opposite[labelSide(partById(p.id)!)]),
          place: opposite[labelSide(p)],
          gap: () => 3,
        },
        (e) => (e.innerHTML = `<span class="cur__arrow" aria-hidden="true">${CURRENT_ARROW}</span><span class="cur__val"></span>`),
      );
      el.setAttribute('aria-hidden', 'true');
      const arrow = $('.cur__arrow', el);
      arrow.style.setProperty('--angle', `${angle ?? 0}deg`);
      arrow.style.visibility = angle === undefined ? 'hidden' : '';
      const val = $('.cur__val', el);
      const before = val.dataset.t;
      setNum(val, Math.abs(c.value) ? formatSI(Math.abs(c.value), 'A') : '0 A', Math.abs(c.value));
      if (before !== undefined && before !== val.dataset.t) flash(el);
      el.classList.toggle('is-stale', stale);
    }
  }

  // A check's flag on its part (the trap is caught on the drawing as well as in Checks).
  for (const t of traps) {
    const id = Object.keys(PART_LINE).find((k) => PART_LINE[k] === t.line);
    if (!id || keep.has(`flag:${id}`)) continue;
    const key = `flag:${id}`;
    keep.add(key);
    const el = overlayItem(
      {
        key,
        className: 'flag',
        anchor: () => {
          const p = partById(id);
          if (!p) return undefined;
          const b = selectionBox(p.kind);
          // The box's corner that is top-right on screen, whatever the rotation.
          const corners = [
            toWorld(p, { x: b.x0, y: b.y0 }),
            toWorld(p, { x: b.x1, y: b.y0 }),
            toWorld(p, { x: b.x0, y: b.y1 }),
            toWorld(p, { x: b.x1, y: b.y1 }),
          ];
          return { x: Math.max(...corners.map((q) => q.x)), y: Math.min(...corners.map((q) => q.y)) };
        },
        place: 'center',
        gap: () => 0,
        shift: () => ({ x: 4, y: -4 }),
      },
      (e) => {
        e.innerHTML = `<button type="button" class="flag__btn" data-action="open-checks"></button>`;
      },
    );
    const btn = $('.flag__btn', el);
    btn.className = `flag__btn flag__btn--${t.severity}`;
    btn.innerHTML = icon(t.severity === 'error' ? 'error' : 'warning', 13);
    btn.setAttribute('aria-label', `${t.severity === 'error' ? 'Error' : 'Warning'} on ${id}: ${t.title}. Open Checks.`);
  }

  // The one invitation on the first screen (on a phone it steps aside while a sheet or card is open:
  // the drawing needs the little room there is; it comes back when they close).
  const coachShown = state.coach && !!partById('R1') && !(isPhone() && (state.sheet || state.selected));
  svg.classList.toggle('coach-off', !coachShown);
  if (coachShown) {
    keep.add('coach');
    overlayItem(
      { key: 'coach', className: 'coach', anchor: () => partById('R1') && sideAnchor(partById('R1')!, 'top'), place: 'top', gap: () => (isPhone() ? 50 : 62) },
      (e) => {
        // Keyboard order: the main action, then the other way in, then dismiss (a grid places them).
        e.innerHTML = `<div class="coach__card" role="note" aria-label="Tip">
          <span class="coach__icon" aria-hidden="true">${icon('cursorClick', 17)}</span>
          <span class="coach__text"><strong>Change R1 and watch the numbers move</strong><span class="coach__sub" data-coach-sub></span></span>
          <button type="button" class="btn btn--primary btn--sm coach__btn" data-action="edit-r1">Edit R1</button>
          <button type="button" class="coach__alt" data-action="trap">or try a beginner trap: R1 = 1M</button>
          <button type="button" class="icon-btn icon-btn--sm coach__close" data-action="dismiss-coach" aria-label="Dismiss the tip">${icon('close', 14)}</button>
        </div><span class="coach__stem" aria-hidden="true"></span>`;
      },
    );
    const sub = overlay.querySelector('[data-coach-sub]');
    if (sub) sub.textContent = isPhone() ? 'Tap R1, then slide: ngspice re-runs as you go.' : 'Click R1, then type or slide: ngspice re-runs as you go.';
    // Said once: while Checks is open, its own "Try a beginner trap" button is the way in.
    const alt = overlay.querySelector<HTMLElement>('.coach__alt');
    if (alt) alt.hidden = isPhone() ? state.sheet === 'checks' : state.panels.has('checks');
  }

  // The value editor: a popover on the drawing (desktop), the only place a value is edited.
  if (state.editing && !isPhone() && partById(state.editing)) {
    keep.add('editor');
    const id = state.editing;
    const existing = overlayItems.get('editor');
    if (existing && existing.el.dataset.for !== id) removeOverlay('editor');
    const el = overlayItem(
      {
        key: 'editor',
        className: 'pop-editor',
        anchor: () => {
          const p = partById(id);
          return p && sideAnchor(p, editorSide ?? labelSide(p));
        },
        place: editorSide ?? labelSide(partById(id)!),
        gap: () => editorGap(id, editorSide ?? labelSide(partById(id)!)),
      },
      (e) => {
        e.dataset.for = id;
        e.innerHTML = `<div class="ed ed--pop" role="dialog" aria-label="Value of ${id}">${editorHTML(partById(id)!, 'pop')}<span class="ed__caret" aria-hidden="true"></span></div>`;
      },
    );
    refreshEditor(el, id);
  }

  for (const key of [...overlayItems.keys()]) if (!keep.has(key)) removeOverlay(key);
  for (const id of [...looseSides.keys()]) if (!partById(id)) looseSides.delete(id);
  layoutOverlay();
  if (placeLooseLabels()) layoutOverlay();
}

/**
 * New parts' labels go on the free side: right of an upright part (above one lying down) unless that
 * covers another part or label, then the other sides in turn. Worked out on screen, in canvas pixels.
 */
function placeLooseLabels(): boolean {
  const loose = state.doc.parts.filter((p) => !p.example && p.kind !== 'GND');
  if (!loose.length) return false;
  let changed = false;
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const overlap = (a: Box, b: Box): number => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const screenBox = (b: Box): Box => {
    const p0 = toScreen({ x: b.x0, y: b.y0 });
    const p1 = toScreen({ x: b.x1, y: b.y1 });
    return { x0: Math.min(p0.x, p1.x), y0: Math.min(p0.y, p1.y), x1: Math.max(p0.x, p1.x), y1: Math.max(p0.y, p1.y) };
  };
  const obstacles: { id: string; box: Box }[] = state.doc.parts.map((q) => ({ id: q.id, box: screenBox(partBox(q, 3)) }));
  const c = canvas.getBoundingClientRect();
  for (const [key, { el }] of overlayItems) {
    if (key.startsWith('label:') && loose.some((p) => key === `label:${p.id}`)) continue;
    if (key === 'editor' || key === 'coach' || el.style.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width) obstacles.push({ id: key, box: { x0: r.left - c.left, y0: r.top - c.top, x1: r.right - c.left, y1: r.bottom - c.top } });
  }
  for (const p of loose) {
    const item = overlayItems.get(`label:${p.id}`);
    if (!item) continue;
    const w = item.el.offsetWidth * overlayScale(state.view.k);
    const h = item.el.offsetHeight * overlayScale(state.view.k);
    const sides: Place[] = isVertical(p) ? ['right', 'left', 'bottom', 'top'] : ['top', 'bottom', 'right', 'left'];
    let best: Place = sides[0]!;
    let bestCost = Infinity;
    let bestBox: Box | undefined;
    for (const side of sides) {
      const a = toScreen(sideAnchor(p, side));
      const g = 6;
      const box: Box =
        side === 'right' ? { x0: a.x + g, y0: a.y - h / 2, x1: a.x + g + w, y1: a.y + h / 2 }
        : side === 'left' ? { x0: a.x - g - w, y0: a.y - h / 2, x1: a.x - g, y1: a.y + h / 2 }
        : side === 'top' ? { x0: a.x - w / 2, y0: a.y - g - h, x1: a.x + w / 2, y1: a.y - g }
        : { x0: a.x - w / 2, y0: a.y + g, x1: a.x + w / 2, y1: a.y + g + h };
      let cost = 0;
      for (const o of obstacles) if (o.id !== p.id) cost += overlap(box, o.box);
      // Off the visible canvas counts as covered: a label nobody can see helps nobody.
      const visible = { x0: 0, y0: 0, x1: c.width - coveredRight(), y1: c.height - coveredBottom() };
      cost += box.x1 - box.x0 + (box.y1 - box.y0) > 0 ? (box.x1 - box.x0) * (box.y1 - box.y0) - overlap(box, visible) : 0;
      if (cost < bestCost - 0.5) {
        bestCost = cost;
        best = side;
        bestBox = box;
      }
      if (cost === 0) break;
    }
    if (looseSides.get(p.id) !== best || item.spec.place !== best) changed = true;
    looseSides.set(p.id, best);
    item.spec.place = best;
    if (bestBox) obstacles.push({ id: `label:${p.id}`, box: bestBox });
  }
  return changed;
}

/** The side the value editor opens on: the label's side, unless it has no room there. */
let editorSide: Place | null = null;

/** How far from the part the editor sits on a side: past the label, past the current arrow, or close. */
function editorGap(id: string, side: Place): number {
  const p = partById(id);
  if (!p) return 60;
  const clear = (key: string): number => {
    const el = overlayItems.get(key)?.el;
    if (!el) return 12;
    const r = el.getBoundingClientRect();
    return (side === 'left' || side === 'right' ? r.width : r.height) + 20;
  };
  if (side === labelSide(p)) return clear(`label:${id}`);
  if (side === opposite[labelSide(p)]) return clear(`cur:${id}`);
  return 16;
}

/** Briefly brighten a result that just changed (skipped when motion is reduced). */
function flash(el: HTMLElement): void {
  if (reducedMotion()) return;
  el.classList.remove('is-flash');
  void el.offsetWidth;
  el.classList.add('is-flash');
}

/**
 * Show a number in place ("2 mA": the number, a narrow space, the unit). When it changes, the old one
 * rolls away and the new one rolls in: up when the value grew, down when it shrank, a plain crossfade
 * otherwise (instant with reduced motion).
 */
function setNum(el: HTMLElement, text: string, value?: number): void {
  if (el.dataset.t === text) return;
  const prevText = el.dataset.t;
  const prevValue = Number(el.dataset.v);
  el.dataset.t = text;
  el.dataset.v = String(value ?? NaN);
  if (prevText === undefined || reducedMotion() || !el.isConnected) {
    el.innerHTML = numHTML(text);
    return;
  }
  const dir = value !== undefined && Number.isFinite(prevValue) && Number.isFinite(value) ? Math.sign(value - prevValue) : 0;
  el.textContent = '';
  const neu = document.createElement('span');
  neu.className = 'roll';
  neu.innerHTML = numHTML(text);
  const old = document.createElement('span');
  old.className = 'roll roll--old';
  old.innerHTML = numHTML(prevText);
  el.append(neu, old);
  const dy = dir > 0 ? 55 : dir < 0 ? -55 : 0;
  neu.animate([{ transform: `translateY(${dy}%)`, opacity: 0, filter: 'blur(2px)' }, { transform: 'none', opacity: 1, filter: 'blur(0)' }], {
    duration: 280,
    easing: 'cubic-bezier(.2,.8,.2,1)',
  });
  old.animate([{ transform: 'none', opacity: 1 }, { transform: `translateY(${-dy}%)`, opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' }).onfinish = () =>
    old.remove();
}

// ================================================================== value editor (popover on a desktop, card on a phone)

function editorHTML(p: Part, variant: 'pop' | 'card'): string {
  const kind = p.kind === 'V' ? 'V' : 'R';
  const model = sliderModel(kind);
  const value = partValue(p);
  const index = model.indexOf(readValue(value) ?? NaN);
  const id = `${variant}-${p.id}`;
  const head = `<div class="ed__head">
      <span class="ed__icon" aria-hidden="true">${partIcon(p.kind, 18)}</span>
      <span class="ed__titles"><span class="ed__name">${esc(p.name)}</span><span class="ed__type">${esc(KINDS[p.kind].type)}</span></span>
      ${variant === 'card' ? `<button type="button" class="btn btn--ghost btn--sm ed__explain" data-action="explain-selected">${icon('explain', 15)}<span>Explain</span></button>` : ''}
      <button type="button" class="icon-btn ${variant === 'card' ? 'ed__close' : 'icon-btn--sm'}" data-action="close-editor" aria-label="Close the value editor">${icon('close', 16)}</button>
    </div>`;
  const summary = variant === 'card' ? `<p class="ed__summary" data-bind="summary"></p>` : '';
  const ticks = model.ticks.map(([i, t]) => `<span style="--at:${i / (model.count - 1)}">${numHTML(t)}</span>`).join('');
  const results =
    variant === 'card'
      ? `<dl class="ed__results">
          <div><dt>Current through</dt><dd><span class="ed__num ed__num--cur" data-bind="through"></span> <span class="ed__dir" data-bind="through-dir"></span></dd></div>
          <div><dt>Voltage across</dt><dd><span class="ed__num" data-bind="across"></span> <span class="ed__dir" data-bind="across-dir"></span></dd></div>
        </dl>`
      : '';
  return `${head}${summary}
    <div class="ed__row">
      <label class="ed__field">
        <span class="sr-only">Value of ${esc(p.name)}, as written in the netlist</span>
        <input class="ed__input" id="${id}-input" data-value-input="${p.id}" value="${esc(value)}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" aria-describedby="${id}-reading ${id}-trap" />
      </label>
      <span class="ed__reading" id="${id}-reading" data-reading></span>
    </div>
    <div class="ed__trap" id="${id}-trap" data-trap hidden></div>
    <div class="ed__slide">
      ${variant === 'card' ? `<button type="button" class="ed__step" data-step="-1" data-step-part="${p.id}" aria-label="Smaller value">${icon('minus', 18)}</button>` : ''}
      <div class="ed__track">
        <input type="range" class="range" min="0" max="${model.count - 1}" step="1" value="${index}" data-value-slider="${p.id}" aria-label="${esc(p.name)} value" />
        <div class="ed__ticks" aria-hidden="true">${ticks}</div>
      </div>
      ${variant === 'card' ? `<button type="button" class="ed__step" data-step="1" data-step-part="${p.id}" aria-label="Bigger value">${icon('plus', 18)}</button>` : ''}
    </div>
    ${results}
    ${variant === 'pop' ? `<p class="ed__hint" aria-hidden="true"><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> next value <span class="dot-sep">·</span> <kbd class="kbd">⇧</kbd> ×10 <span class="dot-sep">·</span> <kbd class="kbd">↵</kbd> done</p>` : ''}`;
}

/** Update a mounted editor (popover or card) without touching the field being typed in. */
function refreshEditor(root: HTMLElement, id: string): void {
  const p = partById(id);
  if (!p || !isValueId(id)) return;
  const value = partValue(p);
  const input = root.querySelector<HTMLInputElement>(`[data-value-input="${id}"]`);
  if (input && document.activeElement !== input && input.value !== value) input.value = value;
  const slider = root.querySelector<HTMLInputElement>(`[data-value-slider="${id}"]`);
  const model = sliderModel(p.kind === 'V' ? 'V' : 'R');
  const reading = readingFor(p);
  // A value SPICE can't read, or one with an error, shows the check instead of "reads …".
  const invalid = !!reading.trap && (!reading.text || reading.trap.severity === 'error');
  if (slider) {
    const v = readValue(value);
    if (document.activeElement !== slider && v !== undefined) slider.value = String(model.indexOf(v));
    const at = Number(slider.value) / (model.count - 1);
    slider.style.setProperty('--fill', `${at * 100}%`);
    slider.setAttribute('aria-valuetext', invalid ? `${value}: ${reading.trap!.title}` : reading.short);
  }
  const readingEl = root.querySelector<HTMLElement>('[data-reading]');
  if (readingEl) {
    readingEl.textContent = !invalid && reading.text ? `reads ${reading.text}` : '';
    readingEl.dataset.tone = reading.tone;
  }
  const trapEl = root.querySelector<HTMLElement>('[data-trap]');
  if (trapEl) {
    const t = reading.trap;
    const was = trapEl.hidden;
    trapEl.hidden = !t;
    // The popover grew or shrank: keep all of it on the canvas (it opens upwards, above the part).
    if (was !== trapEl.hidden && root.classList.contains('pop-editor')) requestAnimationFrame(() => ensureEditorVisible());
    const hint = root.querySelector<HTMLElement>('.ed__hint');
    if (hint) hint.hidden = !!t;
    if (t) {
      const fix = valueFix(id, t);
      const html = `<p class="ed__trap-title ed__trap-title--${t.severity}">${icon(t.severity === 'error' ? 'error' : 'warning', 15)}<span>${esc(t.title)}</span></p>
        <div class="ed__trap-actions">${
          fix
            ? `<button type="button" class="btn btn--primary btn--sm btn--wrap" data-value-fix="${id}">${icon('check', 14)}<span>${esc(fix.label)}</span></button>`
            : ''
        }<button type="button" class="linkish" data-action="open-checks">${fix ? 'Why?' : 'See why in Checks'}</button></div>`;
      if (trapEl.dataset.html !== html) {
        trapEl.innerHTML = html;
        trapEl.dataset.html = html;
      }
    }
  }
  root.querySelector('.ed')?.classList.toggle('is-warn', reading.tone === 'warn');
  root.querySelector('.ed')?.classList.toggle('is-error', reading.tone === 'error');
  // The phone card also says what the part is and what flows through it.
  if (root.id === 'pcard') fillPartResults(root, p);
}

function refreshAllEditors(): void {
  const pop = overlayItems.get('editor');
  if (pop && state.editing) refreshEditor(pop.el, state.editing);
  const card = document.getElementById('pcard');
  if (card && !card.hidden && card.dataset.for) refreshEditor(card, card.dataset.for);
}

function setValue(id: ValueId, text: string): void {
  const key = valueKey(id)!;
  if (state.doc.values[key] === text) return;
  state.doc.values[key] = text;
  const p = partById(id);
  if (p) p.value = text;
  if (state.coach) dismissCoach(false);
  afterValueChange();
}

function afterValueChange(): void {
  $('#sch-desc').textContent = describeOf(netlist());
  syncOverlay();
  refreshAllEditors();
  refreshInspector();
  renderPanels();
  renderBadges();
  // aria-labels of the parts carry the value
  for (const p of state.doc.parts) world.querySelector(`[data-part="${p.id}"]`)?.setAttribute('aria-label', partAria(p));
  // With Live off the results are now out of date: the dots stop until Run.
  if (!state.live) renderFlows();
  requestSolve();
}

function afterDocChange(): void {
  if (state.selected && !partById(state.selected)) select(null);
  if (state.editing && !partById(state.editing)) closeEditor(false);
  renderWorld();
  syncOverlay();
  renderInspector();
  refreshAllEditors();
  renderPanels();
  renderBadges();
  renderHistoryButtons();
  requestSolve();
}

// ================================================================== live solving

const solver = liveSolver(onSolution, onSolveError);
let solveTimer = 0;
const waiters: { text: string; resolve: () => void }[] = [];

function requestSolve(now = false, force = false): void {
  const text = netlist();
  if (!state.live && !force) {
    renderStatus();
    syncOverlay();
    return;
  }
  window.clearTimeout(solveTimer);
  const go = (): void => {
    state.solving = true;
    renderStatus();
    solver.request(text);
  };
  if (now) go();
  else solveTimer = window.setTimeout(go, 150);
}

/** The first answer: its time includes loading ngspice. */
let firstSolution: Solution | undefined;

function onSolution(s: Solution): void {
  firstSolution ??= s;
  state.solution = s;
  state.runError = '';
  if (s.netlist === netlist()) state.solving = false;
  renderFlows();
  syncOverlay();
  refreshInspector();
  refreshAllEditors();
  renderPanels();
  renderBadges();
  renderStatus();
  pulseLive();
  announce(spokenSummary(s));
  for (let i = waiters.length - 1; i >= 0; i--) {
    if (waiters[i]!.text === s.netlist) {
      waiters[i]!.resolve();
      waiters.splice(i, 1);
    }
  }
}

function onSolveError(error: unknown): void {
  state.solving = false;
  state.runError = error instanceof Error ? error.message : String(error);
  renderStatus();
}

function waitForSolution(text: string): Promise<void> {
  if (state.solution?.netlist === text) return Promise.resolve();
  return new Promise((resolve) => waiters.push({ text, resolve }));
}

function run(): void {
  requestSolve(true, true);
  const btn = $('#btn-run');
  btn.classList.add('is-running');
  window.setTimeout(() => btn.classList.remove('is-running'), 450);
}

/**
 * The result for the live region: solve()'s summarySpeech, without its last sentence ("Open the
 * results for details."), which points to the app's results view: Studio shows the results on the
 * drawing and has no such view. (The model should take where the results are as a parameter.)
 */
function spokenSummary(s: Solution): string {
  return s.words.summarySpeech.replace(/\s*Open the results for details\.\s*$/, '');
}

let announceTimer = 0;
function announce(text: string): void {
  // Polite, and only the newest result while a slider is moving.
  window.clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => {
    announcer.textContent = text;
  }, 120);
}

function pulseLive(): void {
  const dot = document.querySelector('.live__dot');
  if (!dot || reducedMotion()) return;
  dot.classList.remove('is-pulse');
  void (dot as HTMLElement).offsetWidth;
  dot.classList.add('is-pulse');
}

/** Hovering a node (its chip, or its name in the netlist) lights up that whole net on the canvas. */
function highlightNode(node: string | null): void {
  svg.classList.toggle('has-hl', !!node);
  world.querySelectorAll<SVGElement>('[data-node]').forEach((el) => el.classList.toggle('is-hl', !!node && el.dataset.node === node));
  overlay.querySelectorAll<HTMLElement>('.ov.chip').forEach((el) => el.classList.toggle('is-hl', !!node && el.dataset.node === node));
}
/** Hovering a netlist line lights up its part. */
function highlightPart(id: string | null): void {
  world.querySelectorAll('.part').forEach((el) => el.classList.toggle('is-hover', !!id && el.getAttribute('data-part') === id));
}

function renderStatus(): void {
  const el = $('#status');
  const s = state.solution;
  const fresh = freshSolution();
  let tone = 'ok';
  let text: string;
  if (state.runError) {
    tone = 'error';
    text = `The engine stopped: ${state.runError}`;
  } else if (!s) {
    tone = 'busy';
    text = 'Starting ngspice…';
  } else if (!fresh && !state.live) {
    tone = 'stale';
    text = `Changed since the last run: press Run (${MOD}↵)`;
  } else if (state.solving) {
    tone = 'busy';
    text = 'Solving…';
  } else if (s.status === 'check' || s.status === 'failed') {
    tone = 'error';
    text = 'ngspice stopped with an error: see Checks';
  } else if (s.status === 'unreliable') {
    tone = 'warn';
    text = "These numbers can't be trusted: see Checks";
  } else if (s === firstSolution) {
    // The first run also waited for ngspice to load, so its time says nothing about solving.
    text = 'Solved';
  } else {
    text = `Solved in ${Math.max(1, Math.round(s.ms))} ms`;
  }
  el.dataset.tone = tone;
  // The analysis, said once on the screen: describe() calls .op "operating point".
  el.innerHTML = `<span class="status__dot" aria-hidden="true"></span><span class="status__text">${esc(text)}</span><span class="status__meta"><span>Operating point (.op)</span><span class="status__engine">ngspice 47</span></span>`;
  app.dataset.results = fresh ? fresh.status : 'stale';
  const pending = !state.live && !fresh && !!s;
  const runBtn = $('#btn-run');
  // Run is quiet while Live keeps the results fresh, and the main button when they are out of date.
  runBtn.classList.toggle('is-pending', pending);
  runBtn.classList.toggle('btn--primary', pending);
  runBtn.classList.toggle('btn--soft', !pending);
  runBtn.setAttribute('aria-description', pending ? 'The results are out of date' : '');
  const live = $('#live-toggle');
  live.setAttribute('aria-checked', String(state.live));
  live.classList.toggle('is-on', state.live);
  live.classList.toggle('is-busy', state.solving);
}

// ================================================================== inspector (desktop: slides in over the canvas for the selection)

let inspectorKey = '';
let inspectorHideTimer = 0;
function renderInspector(): void {
  const p = isPhone() ? undefined : partById(state.selected);
  window.clearTimeout(inspectorHideTimer);
  if (!p) {
    if (!inspector.hidden) {
      inspector.classList.remove('is-open');
      // Out of the tab order only after it has slid away.
      inspectorHideTimer = window.setTimeout(() => {
        if (!inspector.classList.contains('is-open')) {
          inspector.hidden = true;
          inspectorKey = '';
        }
      }, reducedMotion() ? 0 : 220);
    }
    return;
  }
  const key = `${p.id}:${p.kind}:${p.example}`;
  if (key !== inspectorKey) {
    inspectorKey = key;
    inspector.innerHTML = inspectorPartHTML(p);
  }
  if (inspector.hidden) {
    inspector.hidden = false;
    void inspector.offsetWidth;
  }
  inspector.classList.add('is-open');
  refreshInspector();
}

function inspectorPartHTML(p: Part): string {
  const actions = `<span class="insp__actions">
      <button type="button" class="icon-btn icon-btn--sm" data-action="rotate" aria-label="Rotate ${esc(p.name)}" aria-keyshortcuts="Shift+R">${icon('rotate', 16)}<span class="tip tip--below" aria-hidden="true">Rotate<kbd class="kbd">⇧R</kbd></span></button>
      ${p.example ? '' : `<button type="button" class="icon-btn icon-btn--sm" data-action="delete" aria-label="Delete ${esc(p.name)}" aria-keyshortcuts="Delete">${icon('trash', 16)}<span class="tip tip--below" aria-hidden="true">Delete<kbd class="kbd">Del</kbd></span></button>`}
      <button type="button" class="icon-btn icon-btn--sm" data-action="deselect" aria-label="Close the inspector" aria-keyshortcuts="Escape">${icon('close', 16)}</button>
    </span>`;
  const head = `<div class="insp__head">
      <span class="insp__glyph" aria-hidden="true">${partIcon(p.kind, 22)}</span>
      <div class="insp__titles"><p class="insp__eyebrow">${esc(KINDS[p.kind].type)}</p><h2 class="insp__title" id="insp-title">${p.kind === 'GND' ? 'Ground' : esc(p.name)}</h2></div>
      ${actions}
    </div>`;
  if (p.kind === 'GND') {
    return `${head}<div class="insp__scroll">
      <section class="insp__sec"><p class="insp__words">Node 0. Node voltages are measured from ground (node 0), which is 0 V.</p></section>
      <section class="insp__sec"><h3 class="insp__label">Connected to</h3><ul class="kv" data-bind="ground-parts"></ul></section>
    </div>`;
  }
  if (!p.example) {
    const control = p.kind === 'E' || p.kind === 'F' || p.kind === 'G' || p.kind === 'H';
    return `${head}<div class="insp__scroll">
      <section class="insp__sec"><h3 class="insp__label"><label for="insp-loose-input">Value</label></h3>
        <div class="ed ed--insp"><div class="ed__row"><span class="ed__field"><input class="ed__input" id="insp-loose-input" data-loose-input="${p.id}" value="${esc(p.value)}" autocomplete="off" spellcheck="false" aria-describedby="insp-loose-reading"/></span><span class="ed__reading" id="insp-loose-reading" data-reading></span></div></div>
      </section>
      ${control ? `<section class="insp__sec"><h3 class="insp__label">Reads</h3><p class="insp__control"><code class="insp__written" data-bind="control"></code><span class="insp__words" data-bind="control-words"></span></p></section>` : ''}
      <section class="insp__sec"><h3 class="insp__label">What SPICE reads</h3><p class="insp__words" data-bind="summary"></p></section>
      <section class="insp__sec"><div class="note">${icon('info', 16)}<p><strong>Not wired yet.</strong> Wiring new parts into the netlist comes with the schematic editor; in this prototype only the divider is simulated.</p></div></section>
    </div>`;
  }
  const line = PART_LINE[p.id]!;
  return `${head}<div class="insp__scroll">
    <section class="insp__sec" aria-labelledby="insp-val-h">
      <h3 class="insp__label" id="insp-val-h">Value</h3>
      <div class="insp__value">
        <code class="insp__written" data-bind="written"></code>
        <span class="insp__reads" data-bind="reads"></span>
        <button type="button" class="btn btn--ghost btn--sm insp__edit" data-action="edit-selected" aria-keyshortcuts="Enter">${icon('edit', 14)}<span>Edit</span></button>
      </div>
    </section>
    <section class="insp__sec" data-bind="trap-sec" hidden></section>
    <section class="insp__sec" aria-labelledby="insp-res-h">
      <h3 class="insp__label" id="insp-res-h">Results</h3>
      <dl class="stats">
        <div class="stat"><dt>Current through</dt><dd><span class="stat__num stat__num--cur" data-bind="through"></span><span class="stat__sub" data-bind="through-dir"></span></dd></div>
        <div class="stat"><dt>Voltage across</dt><dd><span class="stat__num" data-bind="across"></span><span class="stat__sub" data-bind="across-dir"></span></dd></div>
        <div class="stat" data-bind="power-row" hidden><dt>Power</dt><dd><span class="stat__num" data-bind="power"></span><span class="stat__sub" data-bind="power-dir"></span></dd></div>
      </dl>
    </section>
    <section class="insp__sec" data-bind="what-sec" aria-labelledby="insp-what-h">
      <h3 class="insp__label" id="insp-what-h">What SPICE reads <span class="insp__label-sub">line ${line}</span></h3>
      <p class="insp__words" data-bind="summary"></p>
      <div class="insp__links">
        <button type="button" class="linkish" data-action="explain-selected">${icon('explain', 14)}<span>Explain line ${line}</span></button>
        <button type="button" class="linkish" data-action="netlist-selected">${icon('netlist', 14)}<span>Show in the netlist</span></button>
      </div>
    </section>
    <section class="insp__sec" aria-labelledby="insp-nodes2-h"><h3 class="insp__label" id="insp-nodes2-h">Connected to</h3><div class="chips-row" data-bind="part-nodes"></div></section>
  </div>`;
}

function setBind(root: ParentNode, key: string, text: string, value?: number): void {
  const el = root.querySelector<HTMLElement>(`[data-bind="${key}"]`);
  if (el) setNum(el, text, value);
}

/**
 * A divider part's explanation and results, for the inspector and the phone card: explain()'s
 * summary, solve()'s current with its direction, and the voltage across it from solve()'s two node
 * voltages (the first node's minus the second's, as the netlist line orders them).
 */
function fillPartResults(root: HTMLElement, p: Part): void {
  const n = netlist();
  const s = freshSolution() ?? state.solution;
  const usable = resultsUsable(s);
  const line = explainOf(n).find((l) => l.line === PART_LINE[p.id]);
  const summary = root.querySelector<HTMLElement>('[data-bind="summary"]');
  if (summary && line) summary.textContent = line.summary;
  const nodes = EXAMPLE_NODES[p.id] ?? [];
  const c = usable ? s.currents.find((x) => x.name === p.name) : undefined;
  setBind(root, 'through', c ? formatSI(Math.abs(c.value), 'A') : '—', c ? Math.abs(c.value) : undefined);
  const throughDir = root.querySelector<HTMLElement>('[data-bind="through-dir"]');
  if (throughDir) throughDir.innerHTML = c ? `from <span class="nodeword">${esc(c.from === '0' ? 'ground' : c.from)}</span> to <span class="nodeword">${esc(c.to === '0' ? 'ground' : c.to)}</span>` : '';
  const va = nodes[0] === '0' ? 0 : usable ? s.voltages.get(nodes[0]!) : undefined;
  const vb = nodes[1] === '0' ? 0 : usable ? s.voltages.get(nodes[1]!) : undefined;
  const across = va !== undefined && vb !== undefined ? va - vb : undefined;
  setBind(root, 'across', across !== undefined ? formatSI(across, 'V') : '—', across);
  const acrossDir = root.querySelector<HTMLElement>('[data-bind="across-dir"]');
  if (acrossDir) acrossDir.innerHTML = `V(${esc(nodes[0] ?? '')}) − V(${esc(nodes[1] ?? '')})`;
}

function refreshInspector(): void {
  const p = partById(state.selected);
  if (!p || inspector.hidden) return;
  const n = netlist();
  const s = freshSolution() ?? state.solution;
  const usable = resultsUsable(s);
  inspector.classList.toggle('is-stale', !freshSolution());
  const colours = coloursOf(n);
  if (p.kind === 'GND') {
    const list = inspector.querySelector<HTMLElement>('[data-bind="ground-parts"]');
    if (list) {
      const parts = Object.entries(EXAMPLE_NODES)
        .filter(([id, nodes]) => id !== 'GND' && nodes.includes('0'))
        .map(([id]) => id);
      list.innerHTML = parts.map((id) => `<li><button type="button" class="kv__btn" data-select="${id}"><span class="kv__k">${id}</span><span class="kv__dir">${id === 'V1' ? '− side' : 'one end'}</span>${icon('chevronRight', 14)}</button></li>`).join('');
    }
    return;
  }
  if (!p.example) {
    const reading = readingFor(p);
    const el = inspector.querySelector<HTMLElement>('[data-reading]');
    if (el) {
      el.textContent = reading.text ? `reads ${reading.text}` : '';
      el.dataset.tone = reading.tone;
    }
    const line = explain(looseLine(p)).find((l) => l.line === 2);
    const summary = inspector.querySelector<HTMLElement>('[data-bind="summary"]');
    if (summary) summary.textContent = line?.summary ?? '';
    const control = inspector.querySelector<HTMLElement>('[data-bind="control"]');
    if (control) control.textContent = controlText(p);
    const controlWords = inspector.querySelector<HTMLElement>('[data-bind="control-words"]');
    if (controlWords && line) controlWords.textContent = line.fields.filter((f) => f.label.startsWith('control')).map((f) => f.meaning.replace(/, but there is no.*$/, '')).join('; ');
    return;
  }
  // A divider part: its value as written and as read, its results, its line in words, its nodes.
  const reading = readingFor(p);
  const written = inspector.querySelector<HTMLElement>('[data-bind="written"]');
  if (written) written.textContent = partValue(p) || '—';
  const reads = inspector.querySelector<HTMLElement>('[data-bind="reads"]');
  if (reads) {
    reads.textContent = reading.text ? `reads ${reading.text}` : reading.trap ? reading.trap.title : '';
    reads.dataset.tone = reading.tone;
  }
  fillPartResults(inspector, p);
  const c = usable ? s.currents.find((x) => x.name === p.name) : undefined;
  const powerRow = inspector.querySelector<HTMLElement>('[data-bind="power-row"]');
  if (powerRow) {
    powerRow.hidden = !c?.power;
    if (c?.power) {
      setBind(inspector, 'power', formatSI(c.power.watts, 'W'), c.power.watts);
      const dir = inspector.querySelector<HTMLElement>('[data-bind="power-dir"]');
      if (dir) dir.textContent = c.power.delivers ? 'delivers' : 'absorbs';
    }
  }
  // The inspector defers to an open panel instead of repeating it: Explain shows the line in words.
  const what = inspector.querySelector<HTMLElement>('[data-bind="what-sec"]');
  if (what) what.hidden = state.panels.has('explain');
  const chips = inspector.querySelector<HTMLElement>('[data-bind="part-nodes"]');
  if (chips) {
    const nodes = EXAMPLE_NODES[p.id] ?? [];
    chips.innerHTML = nodes
      .map((node) => {
        if (node === '0') return `<span class="mini-chip mini-chip--ground"><span class="mini-chip__name">0</span><span class="mini-chip__val">ground</span></span>`;
        const v = usable ? s.nodes.find((x) => x.node === node) : undefined;
        return `<span class="mini-chip" style="--node:${colours.get(node) ?? 'var(--ink-3)'}"><span class="mini-chip__dot" aria-hidden="true"></span><span class="mini-chip__name">${esc(node)}</span><span class="mini-chip__val">${numHTML(v?.text ?? '—')}</span></span>`;
      })
      .join('');
  }
  // The check on this line, once: here only while neither the value editor nor Checks shows it.
  const trapSec = inspector.querySelector<HTMLElement>('[data-bind="trap-sec"]');
  if (trapSec) {
    const t = reading.trap;
    const elsewhere = state.editing === p.id || state.panels.has('checks');
    trapSec.hidden = !t || elsewhere;
    if (t && !elsewhere && isValueId(p.id)) {
      const fix = valueFix(p.id, t);
      const html = `<div class="mini-trap mini-trap--${t.severity}">
          <p class="mini-trap__title">${icon(t.severity === 'error' ? 'error' : 'warning', 15)}<span>${esc(t.title)}</span></p>
          <p class="mini-trap__why">${esc(t.why)}</p>
          <div class="mini-trap__actions">${fix ? `<button type="button" class="btn btn--primary btn--sm btn--wrap" data-value-fix="${p.id}">${icon('check', 14)}<span>${esc(fix.label)}</span></button>` : ''}
          <button type="button" class="linkish" data-action="open-checks">Open Checks</button></div>
        </div>`;
      if (trapSec.dataset.html !== html) {
        trapSec.innerHTML = html;
        trapSec.dataset.html = html;
      }
    }
  }
}

// ================================================================== panels (dock on desktop, sheet on a phone)

function renderPanels(): void {
  const n = netlist();
  const fresh = freshSolution();
  const s = fresh ?? state.solution;
  const traps = checksOf(n);
  const flagged = new Map<number, Trap['severity']>();
  for (const t of traps) if (!flagged.has(t.line) || t.severity === 'error') flagged.set(t.line, t.severity);
  const loose = state.doc.parts.filter((p) => !p.example && p.kind !== 'GND').map((p) => p.name);
  const html: Record<PanelId, () => string> = {
    netlist: () =>
      netlistHTML({
        text: n,
        colours: coloursOf(n),
        annotations: s && s.status === 'ok' && s.netlist === n ? s.annotations : [],
        stale: !fresh,
        ...(selectedLine() ? { selectedLine: selectedLine()! } : {}),
        flagged,
        unconnected: loose,
      }),
    checks: () => checksHTML({ traps, messages: fresh ? fresh.words.warnings : [] }),
    explain: () => {
      const sel = partById(state.selected);
      return explainHTML({
        circuitWords: describeOf(n),
        lines: explainOf(n),
        ...(selectedLine() ? { selectedLine: selectedLine()! } : {}),
        ...(sel && !sel.example && sel.kind !== 'GND' ? { loose: sel.name } : {}),
      });
    },
  };
  for (const id of PANELS) {
    const pane = $(`#pane-${id}`);
    const open = state.panels.has(id) && !isPhone();
    pane.hidden = !open;
    if (open) setHTML($(`#pane-${id}-body`), html[id]());
    document.querySelectorAll(`.ptoggle[data-panel="${id}"]`).forEach((b) => b.setAttribute('aria-pressed', String(state.panels.has(id))));
  }
  const anyOpen = state.panels.size > 0 && !isPhone();
  app.dataset.dock = state.dock;
  app.classList.toggle('has-dock', anyOpen);
  dock.dataset.count = String(state.panels.size);
  // Phone sheet.
  const sheet = $('#sheet');
  if (state.sheet && isPhone()) {
    sheet.hidden = false;
    sheet.classList.toggle('is-full', state.sheetFull);
    requestAnimationFrame(() => sheet.classList.remove('is-closed'));
    // The bottom bar's panel buttons are the tabs; the sheet says which panel it shows.
    const info = PANEL_INFO[state.sheet];
    $('#sheet-title').innerHTML = `${icon(info.icon, 18)}<span>${info.title}</span>`;
    $('#sheet-sub').textContent = info.sub;
    setHTML($('#sheet-body'), html[state.sheet]());
  } else {
    sheet.classList.add('is-closed');
    if (!state.sheet || !isPhone()) sheet.hidden = !state.sheet || !isPhone();
  }
  document.querySelectorAll<HTMLElement>('[data-sheet]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sheet === state.sheet)));
}

/** Replace a panel's content, keeping keyboard focus on the same control when it is still there. */
function setHTML(el: HTMLElement, html: string): void {
  if (el.dataset.html === html) return;
  const active = document.activeElement as HTMLElement | null;
  const inside = active && el.contains(active);
  const marker = inside ? focusMarker(active) : '';
  el.innerHTML = html;
  el.dataset.html = html;
  if (inside && marker) el.querySelector<HTMLElement>(marker)?.focus({ preventScroll: true });
}
function focusMarker(el: HTMLElement): string {
  for (const attr of ['data-fix', 'data-select', 'data-action']) {
    const v = el.getAttribute(attr);
    if (v) return `[${attr}="${v}"]`;
  }
  return '';
}

function renderBadges(): void {
  const n = netlist();
  const traps = checksOf(n);
  const fresh = freshSolution();
  const count = traps.length + (fresh ? fresh.words.warnings.length : 0);
  const worst = traps.some((t) => t.severity === 'error') || fresh?.words.warnings.some((w) => w.severity === 'error') ? 'error' : count ? 'warning' : 'ok';
  document.querySelectorAll<HTMLElement>('[data-badge="checks"]').forEach((b) => {
    b.hidden = !count;
    b.innerHTML = `${count}<span class="sr-only"> ${count === 1 ? 'problem' : 'problems'}</span>`;
    b.dataset.tone = worst;
  });
}

function togglePanel(id: PanelId, open?: boolean): void {
  if (isPhone()) {
    openSheet(state.sheet === id && open !== true ? null : id);
    return;
  }
  const want = open ?? !state.panels.has(id);
  if (want) state.panels.add(id);
  else state.panels.delete(id);
  renderPanels();
  refreshInspector();
  syncOverlay();
  relayout();
  if (want) $(`#pane-${id}-h`).focus({ preventScroll: true });
}

function openSheet(id: PanelId | null): void {
  state.sheet = id;
  if (id) closeEditor(false);
  if (!id) state.sheetFull = false;
  renderPanels();
  renderCard();
  syncOverlay();
  relayout(true);
}

function setDockSide(side: 'bottom' | 'right'): void {
  state.dock = side;
  save('dock', side);
  (side === 'bottom' ? dockBottom : dockRight).append(dock);
  document.querySelectorAll<HTMLElement>('[data-action="dock-side"]').forEach((b) => {
    b.innerHTML = icon(side === 'bottom' ? 'dockRight' : 'dockBottom', 15);
    b.setAttribute('aria-label', `Move the panels to the ${side === 'bottom' ? 'right' : 'bottom'}`);
  });
  renderPanels();
  relayout();
}

function relayout(animate = false): void {
  requestAnimationFrame(() => {
    // a sheet, card or panel may now sit where a message was: move it above them (after the slide)
    window.setTimeout(placeToast, reducedMotion() ? 0 : 300);
    if (!state.viewTouched) fitView(animate);
    else {
      layoutOverlay();
      revealDrawing(animate);
    }
  });
}

/**
 * After the user has moved the view, a panel or the inspector opening may cover part of the drawing:
 * pan just enough to bring it back (never zooming), so nothing jumps that does not have to.
 */
function revealDrawing(animate: boolean): void {
  const rect = canvas.getBoundingClientRect();
  const d = drawnBox();
  const right = rect.width - coveredRight() - 16;
  const bottom = rect.height - coveredBottom() - 16;
  let dx = 0;
  let dy = 0;
  if (d.x1 > right && d.x0 - (d.x1 - right) >= 16) dx = right - d.x1;
  if (d.y1 > bottom && d.y0 - (d.y1 - bottom) >= 16) dy = bottom - d.y1;
  if (dx || dy) setView({ ...state.view, x: state.view.x + dx, y: state.view.y + dy }, animate);
}

// ================================================================== selection, tools, editing

/** How the last pointer press was made: on touch, a value editor never raises the keyboard by itself. */
let lastPointer: string = 'mouse';

function select(id: string | null, opts: { edit?: boolean; focus?: boolean; settle?: boolean } = {}): void {
  const wasOpen = inspectorOpen();
  const changed = state.selected !== id;
  state.selected = id;
  if (!id || (state.editing && state.editing !== id)) closeEditor(false);
  if (changed) {
    renderWorld();
    renderInspector();
    renderPanels();
  }
  if (opts.edit && id && isValueId(id)) openEditor(id);
  else if (isPhone()) renderCard();
  syncOverlay();
  if (opts.focus && id) world.querySelector<SVGGElement>(`[data-part="${id}"]`)?.focus({ preventScroll: true });
  // The inspector came or went: keep the drawing in view (a pointer press settles on release).
  if (opts.settle !== false && wasOpen !== inspectorOpen()) settleView();
}

/**
 * After the inspector opens or closes: reveal what it covers with the smallest pan, or centre the
 * drawing again. When the drawing no longer fits beside it (a narrow window, panels on the right),
 * fit it again, unless the user chose the zoom.
 */
function settleView(): void {
  requestAnimationFrame(() => {
    if (!state.viewTouched && (!inspectorOpen() || !drawingFits())) fitView(true);
    else if (inspectorOpen()) revealDrawing(true);
  });
}

/** Everything drawn (labels, results and an open editor included) fits in the uncovered canvas. */
function drawingFits(): boolean {
  const rect = canvas.getBoundingClientRect();
  const d = drawnBox(false);
  return d.x1 - d.x0 <= rect.width - coveredRight() - 32 && d.y1 - d.y0 <= rect.height - coveredBottom() - 32;
}

function openEditor(id: ValueId): void {
  if (state.coach) dismissCoach(false);
  const wasOpen = inspectorOpen();
  if (state.editing !== id) editorSide = null;
  state.selected = id;
  state.editing = id;
  renderWorld();
  renderInspector();
  renderPanels();
  if (isPhone()) {
    state.sheet = null;
    renderPanels();
    renderCard();
    relayout(true);
    // Touch: focus the slider, so no keyboard covers the card ("Tap R1, then slide"); the keyboard
    // opens when the field itself is tapped. Keyboard and mouse: the field, ready to type.
    requestAnimationFrame(() => {
      const target = lastPointer === 'touch' ? $('#pcard .range') : $('#pcard .ed__input');
      target?.focus({ preventScroll: true });
    });
  } else {
    syncOverlay();
    requestAnimationFrame(() => {
      if (!state.viewTouched && !drawingFits()) fitView(true);
      else ensureEditorVisible();
      const input = overlayItems.get('editor')?.el.querySelector<HTMLInputElement>('.ed__input');
      if (input) {
        input.focus({ preventScroll: true });
        input.select();
      }
    });
    if (!wasOpen && !drag) settleView();
  }
}

function closeEditor(returnFocus = true): void {
  if (!state.editing) return;
  const id = state.editing;
  state.editing = null;
  editorSide = null;
  endChange();
  removeOverlay('editor');
  renderCard();
  refreshInspector();
  world.querySelector(`[data-part="${id}"]`)?.classList.remove('is-editing');
  if (returnFocus) world.querySelector<SVGGElement>(`[data-part="${id}"]`)?.focus({ preventScroll: true });
  if (isPhone()) relayout(true);
}

/**
 * Keep the value editor fully in the visible part of the canvas: open it on the first side with room
 * (the label's side first), and only pan when no side has room.
 */
function ensureEditorVisible(allowFit = true): void {
  const item = overlayItems.get('editor');
  const p = state.editing ? partById(state.editing) : undefined;
  if (!item || !p) return;
  const c = canvas.getBoundingClientRect();
  const vis = { x0: 10, y0: 10, x1: c.width - coveredRight() - 10, y1: c.height - coveredBottom() - 10 };
  const w = item.el.offsetWidth;
  const h = item.el.offsetHeight;
  const sides = [...new Set<Place>([labelSide(p), 'top', 'bottom', opposite[labelSide(p)], 'left', 'right'])];
  const boxAt = (side: Place): { x0: number; y0: number; x1: number; y1: number } => {
    const a = toScreen(sideAnchor(p, side));
    const g = editorGap(p.id, side);
    if (side === 'top') return { x0: a.x - w / 2, y0: a.y - g - h, x1: a.x + w / 2, y1: a.y - g };
    if (side === 'bottom') return { x0: a.x - w / 2, y0: a.y + g, x1: a.x + w / 2, y1: a.y + g + h };
    if (side === 'left') return { x0: a.x - g - w, y0: a.y - h / 2, x1: a.x - g, y1: a.y + h / 2 };
    return { x0: a.x + g, y0: a.y - h / 2, x1: a.x + g + w, y1: a.y + h / 2 };
  };
  const inside = (b: { x0: number; y0: number; x1: number; y1: number }): boolean => b.x0 >= vis.x0 && b.y0 >= vis.y0 && b.x1 <= vis.x1 && b.y1 <= vis.y1;
  // No room on the label's side (the editor grew, say): zoom out a little first, so it stays put;
  // only when that would make the drawing small does it move to another side.
  if (allowFit && !state.viewTouched && !inside(boxAt(editorSide ?? labelSide(p)))) {
    fitView(true);
    return;
  }
  const side = [editorSide ?? labelSide(p), ...sides].find((s) => inside(boxAt(s))) ?? labelSide(p);
  if (side !== (editorSide ?? labelSide(p))) {
    editorSide = side;
    item.spec.place = side;
    layoutOverlay();
  }
  const b = boxAt(side);
  let dx = 0;
  let dy = 0;
  if (b.y0 < vis.y0) dy = vis.y0 - b.y0;
  else if (b.y1 > vis.y1) dy = vis.y1 - b.y1;
  if (b.x0 < vis.x0) dx = vis.x0 - b.x0;
  else if (b.x1 > vis.x1) dx = vis.x1 - b.x1;
  if (dx || dy) setView({ ...state.view, x: state.view.x + dx, y: state.view.y + dy }, true);
}

function renderCard(): void {
  const card = $('#pcard');
  const p = partById(state.selected);
  if (!isPhone() || !p || state.sheet) {
    card.hidden = true;
    card.dataset.for = '';
    return;
  }
  const key = `${p.id}:${state.editing === p.id}`;
  if (card.dataset.key !== key || card.hidden) {
    card.dataset.key = key;
    card.dataset.for = p.id;
    if (isValueId(p.id)) card.innerHTML = `<div class="ed ed--card" role="group" aria-label="${p.id}: value and results">${editorHTML(p, 'card')}</div>`;
    else
      card.innerHTML = `<div class="ed ed--card" role="group" aria-label="${esc(p.kind === 'GND' ? 'Ground' : p.name)}">
        <div class="ed__head"><span class="ed__icon" aria-hidden="true">${partIcon(p.kind, 18)}</span><span class="ed__titles"><span class="ed__name">${p.kind === 'GND' ? 'Ground' : esc(p.name)}</span><span class="ed__type">${esc(KINDS[p.kind].type)}</span></span>
        <button type="button" class="icon-btn ed__close" data-action="rotate" aria-label="Rotate">${icon('rotate', 17)}</button>
        ${p.example ? '' : `<button type="button" class="icon-btn ed__close" data-action="delete" aria-label="Delete ${esc(p.name)}">${icon('trash', 17)}</button>`}
        <button type="button" class="icon-btn ed__close" data-action="deselect" aria-label="Close">${icon('close', 17)}</button></div>
        <p class="ed__note">${p.kind === 'GND' ? 'Node 0. Node voltages are measured from ground (node 0), which is 0 V.' : `${esc(p.name)} ${esc(valueLabel(p))}. Not wired yet: in this prototype only the divider is simulated.`}</p>
      </div>`;
    card.hidden = false;
  }
  refreshEditor(card, p.id);
}

function setTool(tool: Tool): void {
  state.tool = tool;
  state.wireStart = null;
  if (tool !== 'select' && tool !== 'wire') {
    state.lastPart = tool;
    // Under the pointer when it is on the canvas; otherwise (keyboard) just right of the circuit.
    const b = contentBox();
    const at = state.pointerWorld ?? { x: b.x1 + 4 * GRID, y: (b.y0 + b.y1) / 2 };
    state.ghost = { x: snap(at.x), y: snap(at.y), rot: state.ghost?.rot ?? 0 };
    closeEditor(false);
  } else state.ghost = null;
  document.querySelectorAll<HTMLElement>('#tools button[data-tool], #phonebar button[data-tool]').forEach((b) => {
    const on = b.dataset.tool === tool;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('is-active', on);
  });
  // The controlled-source button shows the one in use (its menu marks it).
  if (isControlled(tool)) state.lastControlled = tool;
  const group = document.getElementById('tool-controlled');
  if (group) {
    group.classList.toggle('is-active', isControlled(tool));
    group.querySelector('.ico')!.outerHTML = partIcon(state.lastControlled, 22);
    group.querySelector('.tool__key')!.textContent = state.lastControlled;
    group.setAttribute('aria-label', controlledLabel());
  }
  document.querySelectorAll<HTMLElement>('#ctrl-menu .flyout__item').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tool === state.lastControlled)));
  const partsBtn = $('#pb-parts');
  partsBtn.classList.toggle('is-active', tool !== 'select' && tool !== 'wire');
  partsBtn.setAttribute('aria-pressed', String(tool !== 'select' && tool !== 'wire'));
  $('.pb__partglyph', partsBtn).innerHTML = partIcon(state.lastPart, 22);
  canvas.dataset.mode = tool;
  renderGhost();
  renderHint();
}

function renderHint(): void {
  const hint = $('#canvas-hint');
  let html = '';
  // A phone has no keys to show: the hint says what to tap and offers Cancel.
  const cancel = `<button type="button" class="canvas-hint__cancel" data-action="cancel-tool">Cancel</button>`;
  if (state.tool === 'wire') {
    if (isPhone()) html = `${state.wireStart ? 'Tap where the wire ends' : 'Tap where a wire starts'}${cancel}`;
    else html = state.wireStart ? `Click to end the wire <span class="dot-sep">·</span> <kbd class="kbd">Esc</kbd> cancel` : `Click a point to start a wire <span class="dot-sep">·</span> <kbd class="kbd">Esc</kbd> back to select`;
  } else if (state.tool !== 'select') {
    const name = nextName(state.tool);
    html = isPhone()
      ? `Tap where <strong>${esc(name)}</strong> goes${cancel}`
      : `Click to place <strong>${esc(name)}</strong> <span class="dot-sep">·</span> <kbd class="kbd">⇧R</kbd> rotate <span class="dot-sep">·</span> <kbd class="kbd">↵</kbd> place here <span class="dot-sep">·</span> <kbd class="kbd">Esc</kbd> cancel`;
  }
  hint.innerHTML = html;
  hint.hidden = !html;
}

function nextName(kind: Kind): string {
  if (kind === 'GND') return 'a ground';
  const used = new Set(state.doc.parts.map((p) => p.name.toUpperCase()));
  let i = 1;
  while (used.has(`${kind}${i}`)) i++;
  return `${kind}${i}`;
}

function placePart(at: Pt): void {
  if (state.tool === 'select' || state.tool === 'wire') return;
  const kind = state.tool;
  const name = kind === 'GND' ? '0' : nextName(kind);
  const id = kind === 'GND' ? `GND-${Date.now().toString(36)}` : name;
  const rot = state.ghost?.rot ?? 0;
  const control = KINDS[kind].defaultControl;
  oneChange(() => {
    state.doc.parts.push({ id, kind, name, value: KINDS[kind].defaultValue, ...(control ? { control } : {}), x: snap(at.x), y: snap(at.y), rot });
  });
  setTool('select');
  state.selected = id;
  afterDocChange();
  toast(`${kind === 'GND' ? 'Ground' : name} placed`);
}

function rotateSelected(): void {
  if (state.ghost && state.tool !== 'select' && state.tool !== 'wire') {
    state.ghost.rot = (((state.ghost.rot + 90) % 360) as Rot);
    renderGhost();
    return;
  }
  const p = partById(state.selected);
  if (!p) return;
  oneChange(() => {
    p.rot = ((p.rot + 90) % 360) as Rot;
  });
  afterDocChange();
}

function deleteSelected(): void {
  const p = partById(state.selected);
  if (!p) return;
  if (p.example) {
    toast('V1, R1, R2 and their ground stay in this prototype');
    return;
  }
  oneChange(() => {
    state.doc.parts = state.doc.parts.filter((x) => x.id !== p.id);
  });
  state.selected = null;
  afterDocChange();
  toast(`${p.kind === 'GND' ? 'Ground' : p.name} deleted`);
}

function nudge(dx: number, dy: number): void {
  if (state.ghost && state.tool !== 'select' && state.tool !== 'wire') {
    state.ghost.x += dx * GRID;
    state.ghost.y += dy * GRID;
    renderGhost();
    return;
  }
  const p = partById(state.selected);
  if (!p) return;
  beginChange();
  p.x += dx * GRID;
  p.y += dy * GRID;
  renderWorld();
  renderFlows();
  syncOverlay();
  window.clearTimeout(nudgeTimer);
  nudgeTimer = window.setTimeout(endChange, 600);
}
let nudgeTimer = 0;

function dismissCoach(render = true): void {
  if (!state.coach) return;
  state.coach = false;
  removeOverlay('coach');
  if (render) {
    renderWorld();
    syncOverlay();
  } else document.querySelector('.coach-ring')?.remove();
}

function tryTrap(): void {
  closeEditor(false);
  oneChange(() => setValue('R1', '1M'));
  if (isPhone()) openSheet('checks');
  else togglePanel('checks', true);
  toast('R1 is now 1M. See what the checks say.');
}

function applyFix(trapIndex: number, fixIndex: number): void {
  const n = netlist();
  const trap = checksOf(n)[trapIndex];
  const fix = trap?.fixes[fixIndex];
  if (!fix) return;
  // Apply the fix's text changes to the netlist, then read the three values back from it.
  const lines = applyChanges(n, fix.changes).split('\n');
  const values: Partial<Divider> = {};
  for (const id of VALUE_IDS) {
    const before = n.split('\n')[PART_LINE[id]! - 1]!.trim().split(/\s+/);
    const after = (lines[PART_LINE[id]! - 1] ?? '').trim().split(/\s+/);
    if (after.slice(0, 3).join(' ') !== before.slice(0, 3).join(' ')) {
      // e.g. "Use a 0 V source instead (VR1)": a new part, which the prototype's drawing can't follow.
      toast(`This fix rewrites ${id}'s line, and the prototype only changes values. The app will do it.`);
      return;
    }
    values[valueKey(id)!] = after.slice(3).join(' ');
  }
  const changed: ValueId[] = [];
  oneChange(() => {
    for (const id of VALUE_IDS) {
      const key = valueKey(id)!;
      const v = values[key];
      if (v !== undefined && v !== state.doc.values[key]) {
        setValue(id, v);
        changed.push(id);
      }
    }
  });
  announceFixed(changed[0]);
  // The fixed trap's buttons are gone: put focus somewhere sensible (the Checks heading).
  requestAnimationFrame(() => {
    if (!document.activeElement || document.activeElement === document.body) {
      (isPhone() ? $('#sheet-title') : $('#pane-checks-h')).focus({ preventScroll: true });
    }
  });
}

/** A check's fix that only rewrites a value, from the value editor or the inspector. */
function applyValueFix(id: ValueId): void {
  const p = partById(id);
  if (!p) return;
  const fix = valueFix(id, readingFor(p).trap);
  if (!fix) return;
  const input = document.activeElement?.closest?.('.pop-editor, #pcard') ? document.querySelector<HTMLInputElement>(`.pop-editor [data-value-input="${id}"], #pcard [data-value-input="${id}"]`) : null;
  oneChange(() => setValue(id, fix.value));
  document.querySelectorAll<HTMLInputElement>(`[data-value-input="${id}"]`).forEach((el) => (el.value = fix.value));
  announceFixed(id);
  input?.focus({ preventScroll: true });
}

/** "R1 is now 1meg (1 MΩ)": the new value as written and as SPICE reads it (explain()). */
function announceFixed(id: ValueId | undefined): void {
  if (!id) return;
  const p = partById(id)!;
  const r = readingFor(p);
  toast(`${id} is now ${partValue(p)}${r.short && !r.trap && r.short !== partValue(p) ? ` (${r.short})` : ''}`);
}

function resetAll(): void {
  oneChange(() => {
    state.doc = { values: { ...FIRST_CIRCUIT }, parts: exampleParts(FIRST_CIRCUIT), wires: [] };
  });
  state.selected = null;
  closeEditor(false);
  state.viewTouched = false;
  afterDocChange();
  fitView(true);
  toast('Back to the first circuit');
}

// ================================================================== theme, share, toasts, menus

function setTheme(theme: 'dark' | 'light'): void {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  save('theme', theme);
  $('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#13161D' : '#FFFFFF');
  const btn = $('#btn-theme');
  btn.innerHTML = `${icon(theme === 'dark' ? 'sun' : 'moon', 17)}<span class="tip tip--below tip--end" aria-hidden="true">${theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>`;
  btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme');
  document.querySelectorAll('[data-theme-icon]').forEach((el) => (el.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon', 16)));
  document.querySelectorAll('[data-theme-label]').forEach((el) => (el.textContent = theme === 'dark' ? 'Light theme' : 'Dark theme'));
}

function shareLink(): string {
  const v = state.doc.values;
  const params = new URLSearchParams({ v1: v.v1, r1: v.r1, r2: v.r2 });
  return `${location.origin}${location.pathname}#${params.toString()}`;
}

function openShare(): void {
  const pop = $('#share-pop');
  if (!pop.hidden) return closePopovers();
  closePopovers();
  pop.innerHTML = `<p class="pop__title">Share this circuit</p>
    <p class="pop__text">The link opens this divider with today’s values, already solved.</p>
    <div class="share__row"><input class="share__url" readonly value="${esc(shareLink())}" aria-label="Link to this circuit"/><button type="button" class="btn btn--primary btn--sm" data-action="copy-link">${icon('link', 14)}<span>Copy</span></button></div>`;
  pop.hidden = false;
  $('#btn-share').setAttribute('aria-expanded', 'true');
  pop.querySelector<HTMLInputElement>('.share__url')?.select();
  pop.querySelector<HTMLElement>('[data-action="copy-link"]')?.focus();
}

async function copy(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast('Copy did not work here: select the text and copy it');
  }
}

function closePopovers(): void {
  for (const [pop, btn] of [
    ['#share-pop', '#btn-share'],
    ['#more-pop', '#btn-more'],
    ['#parts-pop', '#pb-parts'],
    ['#ctrl-menu', '#tool-controlled'],
  ] as const) {
    const el = $(pop);
    if (!el.hidden) {
      el.hidden = true;
      $(btn).setAttribute('aria-expanded', 'false');
    }
  }
}

function togglePopover(popSel: string, btnSel: string): void {
  const pop = $(popSel);
  const open = pop.hidden;
  closePopovers();
  if (!open) return;
  $('#toast').classList.remove('is-on');
  pop.hidden = false;
  $(btnSel).setAttribute('aria-expanded', 'true');
  pop.querySelector<HTMLElement>('button')?.focus();
}

let toastTimer = 0;
/** A short message at the bottom of the visible canvas: above the dock, the sheet or the card, never on them. */
function toast(text: string): void {
  const el = $('#toast');
  el.textContent = text;
  placeToast();
  el.classList.add('is-on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('is-on'), 2200);
}

function placeToast(): void {
  const el = document.getElementById('toast');
  const c = canvas.getBoundingClientRect();
  if (!el || !c.width) return;
  const visible = c.height - coveredBottom(false);
  // Nothing of the canvas left to stand on (a sheet pulled to full height): just above the bottom bar.
  if (isPhone() && visible < 140) el.style.bottom = '';
  else el.style.bottom = `${Math.max(12, window.innerHeight - (c.bottom - coveredBottom()) + 14)}px`;
  el.style.left = `${c.left + (c.width - coveredRight()) / 2}px`;
}

function renderHistoryButtons(): void {
  ($('#btn-undo') as HTMLButtonElement).disabled = !state.undo.length;
  ($('#btn-redo') as HTMLButtonElement).disabled = !state.redo.length;
}

function showShortcuts(): void {
  palette.open('');
  toast('Every command, with its shortcut');
}

// ================================================================== command palette

const palette = createPalette($('#palette'), (query) => {
  const cmds: Command[] = [];
  const m = /^(v1|r1|r2)\s*(?:=|to)?\s*(\S+)$/i.exec(query.trim());
  if (m) {
    const id = m[1]!.toUpperCase() as ValueId;
    const v = m[2]!;
    cmds.push({ id: 'set', group: 'Circuit', title: `Set ${id} to ${v}`, icon: partIcon(id === 'V1' ? 'V' : 'R', 18), keywords: query, run: () => oneChange(() => setValue(id, v)) });
  }
  const placeKinds: Kind[] = ['R', 'C', 'L', 'V', 'I', 'E', 'F', 'G', 'H', 'GND'];
  cmds.push(
    { id: 'edit-r1', group: 'Circuit', title: 'Change R1', hint: state.doc.values.r1, icon: icon('cursorClick', 18), keywords: 'edit value resistor slider', run: () => openEditor('R1') },
    { id: 'run', group: 'Circuit', title: 'Run now', keys: [MOD, '↵'], icon: icon('play', 16), keywords: 'simulate solve ngspice', run },
    { id: 'live', group: 'Circuit', title: state.live ? 'Turn Live off' : 'Turn Live on', hint: state.live ? 'on' : 'off', icon: icon('live', 18), keywords: 'auto rerun', run: () => setLive(!state.live) },
    { id: 'trap', group: 'Circuit', title: 'Try a beginner trap: R1 = 1M', icon: icon('trap', 18), keywords: 'mega milli check', run: tryTrap },
    { id: 'undo', group: 'Circuit', title: 'Undo', keys: [MOD, 'Z'], icon: icon('undo', 16), run: undo },
    { id: 'redo', group: 'Circuit', title: 'Redo', keys: [MOD, '⇧', 'Z'], icon: icon('redo', 16), run: redo },
    { id: 'reset', group: 'Circuit', title: 'Start again with the first circuit', icon: icon('reset', 16), keywords: 'reset divider', run: resetAll },
    ...(['V1', 'R1', 'R2'] as const).map((id) => ({ id: `sel-${id}`, group: 'Circuit', title: `Select ${id}`, icon: partIcon(id === 'V1' ? 'V' : 'R', 18), run: () => select(id, { focus: true }) })),
    ...placeKinds.map((k) => ({
      id: `place-${k}`,
      group: 'Place a part',
      title: k === 'GND' ? 'Ground (node 0)' : KINDS[k].name,
      keys: [KINDS[k].shortcut],
      icon: partIcon(k, 20),
      keywords: `place add ${k} ${KINDS[k].type}`,
      run: () => setTool(k),
    })),
    { id: 'wire', group: 'Place a part', title: 'Wire', keys: ['W'], icon: icon('wire', 16), keywords: 'connect draw', run: () => setTool('wire') },
    ...PANELS.map((id) => ({
      id: `panel-${id}`,
      group: 'Panels',
      title: `${state.panels.has(id) || state.sheet === id ? 'Close' : 'Open'} ${PANEL_INFO[id].title}`,
      keys: [PANEL_INFO[id].key],
      icon: icon(PANEL_INFO[id].icon, 16),
      keywords: PANEL_INFO[id].sub,
      run: () => togglePanel(id),
    })),
    { id: 'dock', group: 'Panels', title: state.dock === 'bottom' ? 'Dock the panels on the right' : 'Dock the panels at the bottom', icon: icon(state.dock === 'bottom' ? 'dockRight' : 'dockBottom', 16), run: () => setDockSide(state.dock === 'bottom' ? 'right' : 'bottom') },
    { id: 'theme', group: 'View', title: state.theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme', icon: icon(state.theme === 'dark' ? 'sun' : 'moon', 16), keywords: 'theme colour mode', run: () => setTheme(state.theme === 'dark' ? 'light' : 'dark') },
    { id: 'fit', group: 'View', title: 'Zoom to fit', keys: ['⇧', '1'], icon: icon('fit', 16), run: () => ((state.viewTouched = false), fitView(true)) },
    { id: 'zin', group: 'View', title: 'Zoom in', keys: ['+'], icon: icon('plus', 16), run: () => zoomAt(1.25) },
    { id: 'zout', group: 'View', title: 'Zoom out', keys: ['−'], icon: icon('minus', 16), run: () => zoomAt(0.8) },
    { id: 'share', group: 'View', title: 'Share a link to this circuit', icon: icon('share', 16), run: () => copy(shareLink(), 'Link copied') },
    { id: 'copy-netlist', group: 'View', title: 'Copy the netlist', icon: icon('copy', 16), run: () => copy(netlist(), 'Netlist copied') },
  );
  return cmds;
});

function setLive(on: boolean): void {
  state.live = on;
  renderStatus();
  renderFlows();
  toast(on ? 'Live: ngspice re-runs as you edit' : 'Live is off: press Run to solve');
  if (on) requestSolve(true);
  else syncOverlay();
}

// ================================================================== events

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range') || el.isContentEditable;
}

function onKeyDown(e: KeyboardEvent): void {
  if (palette.isOpen()) return;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod && key === 'k') {
    e.preventDefault();
    palette.open();
    return;
  }
  if (mod && e.key === 'Enter') {
    e.preventDefault();
    run();
    return;
  }
  const typing = isTyping(e.target);
  if (mod && key === 'z' && !typing) {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && key === 'y' && !typing) {
    e.preventDefault();
    redo();
    return;
  }
  if (typing || mod || e.altKey) return;
  const target = e.target as HTMLElement;
  // Canvas keys (arrows, Delete, Enter) only when the focus is on the drawing itself, never on a
  // control floating over it (the slider in the value editor uses its own arrows).
  const onCanvas =
    target === document.body || target.id === 'canvas' || (!!target.closest?.('[data-part]') && !target.closest?.('input, button, select, textarea'));
  if (e.key === 'Escape') {
    if (escape()) e.preventDefault();
    return;
  }
  if (e.key === '?') {
    e.preventDefault();
    showShortcuts();
    return;
  }
  if (e.shiftKey && key === 'r') {
    e.preventDefault();
    rotateSelected();
    return;
  }
  if (e.shiftKey && e.code === 'Digit1') {
    e.preventDefault();
    state.viewTouched = false;
    fitView(true);
    return;
  }
  if (e.shiftKey) return;
  const toolKeys: Record<string, Tool> = { r: 'R', c: 'C', l: 'L', v: 'V', i: 'I', e: 'E', f: 'F', g: 'G', h: 'H', '0': 'GND', w: 'wire' };
  if (toolKeys[key]) {
    e.preventDefault();
    setTool(toolKeys[key]!);
    return;
  }
  const panelKeys: Record<string, PanelId> = { n: 'netlist', k: 'checks', x: 'explain' };
  if (panelKeys[key]) {
    e.preventDefault();
    togglePanel(panelKeys[key]!);
    return;
  }
  if (key === '+' || key === '=') {
    e.preventDefault();
    zoomAt(1.25);
    return;
  }
  if (key === '-' || key === '_') {
    e.preventDefault();
    zoomAt(0.8);
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && onCanvas) {
    e.preventDefault();
    deleteSelected();
    return;
  }
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key] && onCanvas && (state.selected || state.ghost)) {
    e.preventDefault();
    const [dx, dy] = arrows[e.key]!;
    nudge(dx, dy);
    return;
  }
  if (e.key === 'Enter' && onCanvas) {
    if (state.ghost && state.tool !== 'select' && state.tool !== 'wire') {
      e.preventDefault();
      placePart(state.ghost);
    }
  }
}

/** Esc: close the innermost thing. Returns true when something closed. */
function escape(): boolean {
  if (!$('#share-pop').hidden || !$('#more-pop').hidden || !$('#parts-pop').hidden || !$('#ctrl-menu').hidden) {
    closePopovers();
    return true;
  }
  if (state.wireStart) {
    state.wireStart = null;
    renderGhost();
    renderHint();
    return true;
  }
  if (state.tool !== 'select') {
    setTool('select');
    return true;
  }
  if (state.editing) {
    closeEditor(true);
    return true;
  }
  if (state.sheet) {
    openSheet(null);
    return true;
  }
  if (state.selected) {
    const id = state.selected;
    select(null);
    world.querySelector<SVGGElement>(`[data-part="${id}"]`)?.focus({ preventScroll: true });
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ pointer on the canvas

type Drag =
  | { kind: 'pan'; id: number; sx: number; sy: number; vx: number; vy: number; moved: boolean; settle?: boolean }
  | { kind: 'part'; id: number; part: string; sx: number; sy: number; px: number; py: number; moved: boolean; wasSelected: boolean; settle: boolean }
  | { kind: 'pinch'; d0: number; k0: number; cx: number; cy: number; vx: number; vy: number };
let drag: Drag | null = null;
const pointers = new Map<number, { x: number; y: number }>();
let spaceDown = false;

/** Keep receiving this pointer's moves outside the canvas (never fatal: a synthetic event has no pointer). */
function capture(id: number): void {
  try {
    canvas.setPointerCapture(id);
  } catch {
    // no active pointer with that id
  }
}

function localPoint(e: PointerEvent | WheelEvent): Pt {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onPointerDown(e: PointerEvent): void {
  const target = e.target as Element;
  if (target.closest('.ov') && !target.closest('.ov.plabel, .ov.chip, .ov.cur')) return; // overlay controls handle themselves
  if (target.closest('.canvas-hint')) return; // its Cancel button is not a place to put a part
  lastPointer = e.pointerType;
  closePopovers();
  const lp = localPoint(e);
  pointers.set(e.pointerId, lp);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    drag = { kind: 'pinch', d0: Math.hypot(a!.x - b!.x, a!.y - b!.y), k0: state.view.k, cx: (a!.x + b!.x) / 2, cy: (a!.y + b!.y) / 2, vx: state.view.x, vy: state.view.y };
    return;
  }
  const w = toWorldPt(lp.x, lp.y);
  if (e.button === 1 || spaceDown) {
    drag = { kind: 'pan', id: e.pointerId, sx: lp.x, sy: lp.y, vx: state.view.x, vy: state.view.y, moved: false };
    capture(e.pointerId);
    return;
  }
  if (e.button !== 0) return;
  if (state.tool !== 'select' && state.tool !== 'wire') {
    placePart({ x: w.x, y: w.y });
    e.preventDefault();
    return;
  }
  if (state.tool === 'wire') {
    const p = { x: snap(w.x), y: snap(w.y) };
    if (!state.wireStart) state.wireStart = p;
    else {
      const pts = route(state.wireStart, { x: 1, y: 0 }, p, { x: 0, y: 1 });
      if (pts.length >= 2 && (pts[0]!.x !== p.x || pts[0]!.y !== p.y)) {
        oneChange(() => state.doc.wires.push({ id: `w${Date.now().toString(36)}`, points: pts }));
        afterDocChange();
      }
      state.wireStart = null;
    }
    renderGhost();
    renderHint();
    return;
  }
  const partEl = target.closest('[data-part]');
  const partId = partEl?.getAttribute('data-part');
  if (partId) {
    const p = partById(partId)!;
    const wasSelected = state.selected === partId;
    const wasOpen = inspectorOpen();
    // The view settles on release, so a drag that starts here is never moved under the pointer.
    if (!wasSelected) select(partId, { settle: false });
    drag = { kind: 'part', id: e.pointerId, part: partId, sx: lp.x, sy: lp.y, px: p.x, py: p.y, moved: false, wasSelected, settle: wasOpen !== inspectorOpen() };
    capture(e.pointerId);
    e.preventDefault();
    return;
  }
  // Empty canvas: deselect and pan.
  const closing = !!state.selected && inspectorOpen();
  if (state.selected) select(null, { settle: false });
  drag = { kind: 'pan', id: e.pointerId, sx: lp.x, sy: lp.y, vx: state.view.x, vy: state.view.y, moved: false, settle: closing };
  capture(e.pointerId);
}

function onPointerMove(e: PointerEvent): void {
  const lp = localPoint(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, lp);
  const r = canvas.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (inside) state.pointerWorld = toWorldPt(lp.x, lp.y);
  if (drag?.kind === 'pinch' && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    const k = clamp((drag.k0 * d) / Math.max(1, drag.d0), 0.35, 4);
    const cx = (a!.x + b!.x) / 2;
    const cy = (a!.y + b!.y) / 2;
    const w = { x: (drag.cx - drag.vx) / drag.k0, y: (drag.cy - drag.vy) / drag.k0 };
    state.viewTouched = true;
    setView({ k, x: cx - w.x * k, y: cy - w.y * k });
    return;
  }
  if (drag?.kind === 'pan' && drag.id === e.pointerId) {
    const dx = lp.x - drag.sx;
    const dy = lp.y - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    state.viewTouched = true;
    canvas.classList.add('is-panning');
    setView({ ...state.view, x: drag.vx + dx, y: drag.vy + dy });
    return;
  }
  if (drag?.kind === 'part' && drag.id === e.pointerId) {
    const dx = (lp.x - drag.sx) / state.view.k;
    const dy = (lp.y - drag.sy) / state.view.k;
    if (!drag.moved && Math.hypot(lp.x - drag.sx, lp.y - drag.sy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      beginChange();
      if (state.editing) closeEditor(false);
      canvas.classList.add('is-dragging');
    }
    const p = partById(drag.part);
    if (!p) return;
    const nx = snap(drag.px + dx);
    const ny = snap(drag.py + dy);
    if (nx !== p.x || ny !== p.y) {
      p.x = nx;
      p.y = ny;
      renderWorld();
      syncOverlay();
    }
    return;
  }
  if (inside && state.tool !== 'select' && state.tool !== 'wire') {
    const w = toWorldPt(lp.x, lp.y);
    state.ghost = { x: snap(w.x), y: snap(w.y), rot: state.ghost?.rot ?? 0 };
    renderGhost();
  } else if (inside && state.tool === 'wire' && state.wireStart) renderGhost();
}

function onPointerUp(e: PointerEvent): void {
  pointers.delete(e.pointerId);
  if (drag?.kind === 'pinch') {
    if (pointers.size < 2) drag = null;
    return;
  }
  if (!drag || drag.id !== e.pointerId) return;
  canvas.classList.remove('is-panning', 'is-dragging');
  const settle = drag.settle && (drag.kind === 'part' || !drag.moved);
  if (drag.kind === 'part') {
    if (drag.moved) {
      endChange();
      renderFlows();
      renderPanels();
    } else if (isValueId(drag.part)) {
      if (state.editing === drag.part) closeEditor(false);
      else openEditor(drag.part);
    } else if (isPhone()) renderCard();
  }
  drag = null;
  if (settle) settleView();
}

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const lp = localPoint(e);
  if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), lp.x, lp.y);
  else {
    state.viewTouched = true;
    setView({ ...state.view, x: state.view.x - e.deltaX, y: state.view.y - e.deltaY });
  }
}

// ------------------------------------------------------------------ clicks (delegated)

function onClick(e: MouseEvent): void {
  const t = e.target as HTMLElement;
  const group = t.closest<HTMLElement>('[data-group="controlled"]');
  if (group) {
    if ($('#ctrl-menu').hidden) openCtrlMenu(e.detail === 0);
    else closePopovers();
    rovingFocus(group);
    return;
  }
  const toolBtn = t.closest<HTMLElement>('button[data-tool]');
  if (toolBtn) {
    const fromMenu = !!toolBtn.closest('#ctrl-menu');
    setTool(toolBtn.dataset.tool as Tool);
    if (fromMenu) {
      closePopovers();
      const btn = $('#tool-controlled');
      rovingFocus(btn);
      btn.focus();
    } else if (toolBtn.closest('.rail')) rovingFocus(toolBtn);
    return;
  }
  // (data-place-kind, not data-place: the overlay uses data-place for the side a label sits on)
  const place = t.closest<HTMLElement>('[data-place-kind]');
  if (place) {
    closePopovers();
    setTool(place.dataset.placeKind as Kind);
    if (!isPhone()) toast('Click the canvas to place it');
    return;
  }
  const panelBtn = t.closest<HTMLElement>('[data-panel]');
  if (panelBtn) return togglePanel(panelBtn.dataset.panel as PanelId);
  const closePanel = t.closest<HTMLElement>('[data-close-panel]');
  if (closePanel) return togglePanel(closePanel.dataset.closePanel as PanelId, false);
  const sheetBtn = t.closest<HTMLElement>('[data-sheet]');
  if (sheetBtn) return openSheet(state.sheet === sheetBtn.dataset.sheet ? null : (sheetBtn.dataset.sheet as PanelId));
  const valueFixBtn = t.closest<HTMLElement>('[data-value-fix]');
  if (valueFixBtn) return applyValueFix(valueFixBtn.dataset.valueFix as ValueId);
  const fix = t.closest<HTMLElement>('[data-fix]');
  if (fix) {
    const [i, k] = fix.dataset.fix!.split(':').map(Number);
    return applyFix(i!, k!);
  }
  const sel = t.closest<HTMLElement>('[data-select]');
  if (sel) {
    select(sel.dataset.select!, { focus: false });
    return;
  }
  const step = t.closest<HTMLElement>('[data-step]');
  if (step) {
    const id = step.dataset.stepPart as ValueId;
    const p = partById(id);
    if (p) oneChange(() => setValue(id, stepText(p.kind === 'V' ? 'V' : 'R', partValue(p), Number(step.dataset.step) as 1 | -1, false)));
    return;
  }
  const action = t.closest<HTMLElement>('[data-action]')?.dataset.action;
  if (!action) {
    if (!t.closest('.pop, #btn-share, #btn-more, #pb-parts')) closePopovers();
    return;
  }
  switch (action) {
    case 'palette':
      closePopovers();
      palette.open();
      break;
    case 'run':
      run();
      break;
    case 'share':
      closePopovers();
      if (isPhone()) void copy(shareLink(), 'Link copied');
      else openShare();
      break;
    case 'copy-link':
      void copy(shareLink(), 'Link copied');
      closePopovers();
      break;
    case 'copy-netlist':
      void copy(netlist(), 'Netlist copied');
      break;
    case 'theme':
      closePopovers();
      setTheme(state.theme === 'dark' ? 'light' : 'dark');
      break;
    case 'undo':
      closePopovers();
      undo();
      break;
    case 'redo':
      closePopovers();
      redo();
      break;
    case 'fit':
      closePopovers();
      state.viewTouched = false;
      fitView(true);
      break;
    case 'zoom-in':
      zoomAt(1.25);
      break;
    case 'zoom-out':
      zoomAt(0.8);
      break;
    case 'zoom-reset':
      zoomAt(1 / state.view.k);
      break;
    case 'reset':
      closePopovers();
      resetAll();
      break;
    case 'more':
      togglePopover('#more-pop', '#btn-more');
      break;
    case 'parts':
      togglePopover('#parts-pop', '#pb-parts');
      break;
    case 'edit-r1':
      select('R1', { settle: false });
      openEditor('R1');
      settleView();
      break;
    case 'edit-selected':
      if (isValueId(state.selected)) openEditor(state.selected);
      break;
    case 'dismiss-coach':
      dismissCoach();
      world.querySelector<SVGGElement>('[data-part="R1"]')?.focus({ preventScroll: true });
      break;
    case 'trap':
      tryTrap();
      break;
    case 'open-checks':
      if (isPhone()) openSheet('checks');
      else togglePanel('checks', true);
      break;
    case 'explain-selected':
      closeEditor(false);
      if (isPhone()) openSheet('explain');
      else togglePanel('explain', true);
      break;
    case 'netlist-selected':
      togglePanel('netlist', true);
      break;
    case 'close-editor':
      closeEditor(true);
      if (isPhone()) select(null);
      break;
    case 'rotate':
      rotateSelected();
      break;
    case 'delete':
      deleteSelected();
      break;
    case 'deselect':
      select(null);
      renderCard();
      break;
    case 'dock-side':
      setDockSide(state.dock === 'bottom' ? 'right' : 'bottom');
      break;
    case 'sheet-close':
      openSheet(null);
      break;
    case 'cancel-tool':
      setTool('select');
      break;
    case 'sheet-size':
      state.sheetFull = !state.sheetFull;
      renderPanels();
      relayout(true);
      break;
    case 'help':
      showShortcuts();
      break;
  }
}

// ------------------------------------------------------------------ value fields (delegated)

function onInput(e: Event): void {
  const t = e.target as HTMLInputElement;
  if (t.dataset.valueInput) {
    beginChange();
    setValue(t.dataset.valueInput as ValueId, t.value.trim());
    return;
  }
  if (t.dataset.valueSlider) {
    const id = t.dataset.valueSlider as ValueId;
    const p = partById(id)!;
    const model = sliderModel(p.kind === 'V' ? 'V' : 'R');
    beginChange();
    t.style.setProperty('--fill', `${(Number(t.value) / (model.count - 1)) * 100}%`);
    setValue(id, spell(model.valueAt(Number(t.value))));
    // The text fields follow the slider right away, even the one in the other place.
    document.querySelectorAll<HTMLInputElement>(`[data-value-input="${id}"]`).forEach((input) => (input.value = partValue(p)));
    return;
  }
  if (t.dataset.looseInput) {
    const p = partById(t.dataset.looseInput);
    if (!p) return;
    beginChange();
    p.value = t.value.trim();
    refreshInspector();
    syncOverlay();
  }
}

function onChange(e: Event): void {
  const t = e.target as HTMLInputElement;
  if (t.dataset.valueInput || t.dataset.valueSlider || t.dataset.looseInput) endChange();
}

function onFieldKeyDown(e: KeyboardEvent): void {
  const t = e.target as HTMLInputElement;
  const id = t.dataset?.valueInput as ValueId | undefined;
  if (!id) return;
  const p = partById(id);
  if (!p) return;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    beginChange();
    const next = stepText(p.kind === 'V' ? 'V' : 'R', t.value, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
    t.value = next;
    setValue(id, next);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    endChange();
    if (t.closest('.pop-editor, #pcard')) closeEditor(true);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    endChange();
    if (t.closest('.pop-editor, #pcard')) closeEditor(true);
    else t.blur();
  }
}

/** The tool rail is one Tab stop; ↑/↓ move between tools (the toolbar pattern). */
function rovingFocus(current: HTMLElement): void {
  document.querySelectorAll<HTMLElement>('#tools .tool').forEach((b) => (b.tabIndex = b === current ? 0 : -1));
}
function onToolsKeyDown(e: KeyboardEvent): void {
  const tools = [...document.querySelectorAll<HTMLElement>('#tools .tool')];
  const i = tools.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  // The controlled-source button opens its menu with → (the menu button pattern inside a toolbar).
  if (e.key === 'ArrowRight' && tools[i]!.id === 'tool-controlled') {
    e.preventDefault();
    e.stopPropagation();
    openCtrlMenu(true);
    return;
  }
  let next = -1;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % tools.length;
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i - 1 + tools.length) % tools.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = tools.length - 1;
  if (next < 0) return;
  e.preventDefault();
  e.stopPropagation();
  rovingFocus(tools[next]!);
  tools[next]!.focus();
}

function onPartKeyDown(e: KeyboardEvent): void {
  const el = (e.target as Element).closest?.('[data-part]');
  if (!el || (e.key !== 'Enter' && e.key !== ' ')) return;
  // While a part is being placed, Enter places it (the global handler), even with a part focused.
  if (state.tool !== 'select' && state.tool !== 'wire') return;
  e.preventDefault();
  e.stopPropagation();
  const id = el.getAttribute('data-part')!;
  if (isValueId(id)) {
    select(id);
    openEditor(id);
  } else select(id, { focus: true });
}

// ------------------------------------------------------------------ the dock's resize handle

function bindResize(): void {
  const handle = $('#dock-resize');
  let start: { x: number; y: number; size: number } | null = null;
  const apply = (size: number): void => {
    const side = state.dock;
    const max = side === 'bottom' ? window.innerHeight * 0.65 : window.innerWidth * 0.5;
    state.dockSize[side] = clamp(size, side === 'bottom' ? 160 : 300, max);
    app.style.setProperty('--dock-h', `${state.dockSize.bottom}px`);
    app.style.setProperty('--dock-w', `${state.dockSize.right}px`);
    handle.setAttribute('aria-valuenow', String(Math.round(state.dockSize[side])));
    relayout();
  };
  handle.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY, size: state.dockSize[state.dock] };
    handle.setPointerCapture(e.pointerId);
    app.classList.add('is-resizing');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!start) return;
    apply(state.dock === 'bottom' ? start.size - (e.clientY - start.y) : start.size - (e.clientX - start.x));
  });
  handle.addEventListener('pointerup', () => {
    start = null;
    app.classList.remove('is-resizing');
  });
  handle.addEventListener('keydown', (e) => {
    const delta = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? 24 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? -24 : 0;
    if (!delta) return;
    e.preventDefault();
    apply(state.dockSize[state.dock] + delta);
  });
  apply(state.dockSize[state.dock]);
}

// ------------------------------------------------------------------ the phone sheet's drag handle

function bindSheetDrag(): void {
  const grip = $('#sheet-grip');
  const sheet = $('#sheet');
  let start: { y: number; h: number } | null = null;
  grip.addEventListener('pointerdown', (e) => {
    start = { y: e.clientY, h: sheet.getBoundingClientRect().height };
    grip.setPointerCapture(e.pointerId);
    sheet.classList.add('is-dragging');
  });
  grip.addEventListener('pointermove', (e) => {
    if (!start) return;
    const h = clamp(start.h - (e.clientY - start.y), 80, window.innerHeight * 0.9);
    sheet.style.height = `${h}px`;
  });
  grip.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dy = e.clientY - start.y;
    sheet.classList.remove('is-dragging');
    sheet.style.height = '';
    start = null;
    if (Math.abs(dy) < 6) state.sheetFull = !state.sheetFull;
    else if (dy > 80 && !state.sheetFull) return openSheet(null);
    else state.sheetFull = dy < 0;
    renderPanels();
    relayout(true);
  });
}

// ================================================================== boot

function readHash(): { shot: string; values: Partial<Divider> } {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const values: Partial<Divider> = {};
  for (const key of ['v1', 'r1', 'r2'] as const) {
    const v = params.get(key);
    if (v !== null && v.length <= 40) values[key] = v;
  }
  return { shot: params.get('shot') ?? '', values };
}

async function boot(): Promise<void> {
  buildShell();
  setTheme(state.theme);
  const { shot, values } = readHash();
  state.shot = shot;
  if (shot) document.body.dataset.shot = shot;
  if (Object.keys(values).length) {
    state.doc.values = { ...state.doc.values, ...values };
    state.doc.parts = exampleParts(state.doc.values);
    state.coach = false;
  }
  if (shot && shot !== 'solved') state.coach = false;
  (state.dock === 'bottom' ? dockBottom : dockRight).append(dock);
  setDockSide(state.dock);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onFieldKeyDown, true);
  $('#tools').addEventListener('keydown', onToolsKeyDown);
  $('#ctrl-menu').addEventListener('keydown', onCtrlMenuKeyDown);
  // On the canvas div, not the SVG: Chromium makes an SVG element with focus listeners a Tab stop.
  canvas.addEventListener('keydown', onPartKeyDown);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isTyping(e.target) && !(e.target as HTMLElement).closest?.('button, [role="button"]')) {
      spaceDown = true;
      canvas.classList.add('is-space');
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceDown = false;
      canvas.classList.remove('is-space');
    }
  });
  $('#live-toggle').addEventListener('click', () => setLive(!state.live));
  document.addEventListener('pointerover', (e) => {
    const t = e.target as Element;
    const node = t.closest?.('.ov.chip, .t-node')?.getAttribute('data-node') ?? (t.closest?.('.t-node')?.textContent ?? null);
    highlightNode(node && node !== '0' ? node.toLowerCase() : node);
    highlightPart(t.closest?.('.nl__line[data-select], .xrow[data-select]')?.getAttribute('data-select') ?? null);
  });
  $('#btn-run').addEventListener('click', run);
  $('#btn-share').addEventListener('click', (e) => {
    e.stopPropagation();
    openShare();
  });
  $('#btn-more').addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover('#more-pop', '#btn-more');
  });
  $('#pb-parts').addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover('#parts-pop', '#pb-parts');
  });
  $('#btn-theme').addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#cmdk').addEventListener('click', () => palette.open());
  $('#rail-help').addEventListener('click', showShortcuts);
  bindResize();
  bindSheetDrag();
  motionQuery.addEventListener('change', () => {
    renderFlows();
    syncOverlay();
  });
  phoneQuery.addEventListener('change', () => {
    closeEditor(false);
    renderPanels();
    renderCard();
    syncOverlay();
    relayout();
  });
  new ResizeObserver(() => relayout()).observe(canvas);

  rovingFocus($('#tools .tool[data-tool="select"]'));
  setTool('select');
  renderHistoryButtons();
  renderWorld();
  renderInspector();
  renderPanels();
  renderBadges();
  renderStatus();
  syncOverlay();
  fitView();

  void warmUp().catch(() => undefined);
  requestSolve(true);

  // Screenshot states for scripts/design-shots.ts.
  if (shot === 'edit') {
    select('R1', { settle: false });
    openEditor('R1');
    beginChange();
    setValue('R1', '3k');
    endChange();
    const input = overlayItems.get('editor')?.el.querySelector<HTMLInputElement>('.ed__input');
    if (input) input.value = '3k';
    document.querySelectorAll<HTMLInputElement>('#pcard .ed__input').forEach((i) => (i.value = '3k'));
    requestSolve(true);
  } else if (shot === 'panels') {
    select('R1', { settle: false });
    if (isPhone()) openSheet('explain');
    else {
      state.panels.add('netlist');
      state.panels.add('explain');
      renderPanels();
    }
  } else if (shot === 'check') {
    // The trap, caught twice: in Checks with its fix, and on the drawing ("1 mΩ" and a flag on R1).
    oneChange(() => setValue('R1', '1M'));
    if (isPhone()) openSheet('checks');
    else {
      state.panels.add('checks');
      renderPanels();
    }
    requestSolve(true);
  }
  await waitForSolution(netlist());
  await document.fonts.ready;
  syncOverlay();
  await nextFrame();
  fitView();
  if (shot === 'edit' && !isPhone()) ensureEditorVisible();
  await nextFrame();
  layoutOverlay();
  await nextFrame();
  document.body.dataset.shotReady = '1';
}

void boot();
