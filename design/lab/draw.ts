/**
 * The lab's neutral drawing style: a schematic's scene as an SVG with thin black lines, the US/ANSI
 * symbols of src/schematic/symbols.ts, node names in italics, junction dots, open terminals, stubs
 * where a node goes on to parts the drawing does not show, small hops where wires cross, and an
 * arrowhead on the lead of a source whose current an F or H reads. Also the card the lab shows for
 * each circuit (the drawing and the layout's own checks).
 *
 * Nothing from a netlist is put into the page as HTML: every word goes in as text.
 */
import { SYMBOLS, findOverlaps, schematicConnectivity, type Box, type Direction, type Schematic, type TextLine } from '../../src/schematic/index.ts';

const SVG = 'http://www.w3.org/2000/svg';
/** Pixels per grid unit. */
const UNIT = 20;
const STROKE = 0.075;

export function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
}

export function html<K extends keyof HTMLElementTagNameMap>(name: K, text?: string, parent?: Element, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(name);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  parent?.append(e);
  return e;
}

const r = (n: number): string => String(Math.round(n * 1000) / 1000);

function text(line: TextLine, parent: Element, italic: boolean): void {
  if (!line.text) return;
  const hidden = line.role === 'hidden';
  const t = el(
    'text',
    {
      x: r(line.x),
      y: r(line.y),
      'font-size': hidden ? 0.6 : 0.7,
      'text-anchor': line.align,
      'dominant-baseline': 'central',
      fill: italic || hidden ? '#333' : '#111',
      'font-style': italic || hidden ? 'italic' : 'normal',
    },
    parent,
  );
  t.textContent = line.text;
}

function box(b: Box, parent: Element, colour: string): void {
  el('rect', { x: r(b.x0), y: r(b.y0), width: r(b.x1 - b.x0), height: r(b.y1 - b.y0), fill: 'none', stroke: colour, 'stroke-width': 0.03, 'stroke-dasharray': '0.12 0.08' }, parent);
}

const ROT: Readonly<Record<Direction, number>> = { right: 0, down: 90, left: 180, up: 270 };

/** The drawing as an SVG, in grid units scaled to UNIT pixels. `boxes` outlines the room kept for words. */
export function draw(s: Schematic, label: string, boxes = false): SVGSVGElement {
  const sc = s.scene;
  const pad = 1;
  const b = { x0: sc.bounds.x0 - pad, y0: sc.bounds.y0 - pad, x1: sc.bounds.x1 + pad, y1: sc.bounds.y1 + pad };
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const svg = el('svg', {
    viewBox: `${r(b.x0)} ${r(b.y0)} ${r(w)} ${r(h)}`,
    width: r(w * UNIT),
    height: r(h * UNIT),
    role: 'img',
    'font-family': 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
  });
  el('title', {}, svg).textContent = label;
  const ink = { stroke: '#111', 'stroke-width': STROKE, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  for (const wire of sc.wires) el('polyline', { ...ink, points: wire.points.map((p) => `${p.x},${p.y}`).join(' ') }, svg);
  // A hop where two wires cross without connecting: the horizontal wire jumps over the vertical one.
  for (const c of sc.crossings) {
    el('path', { d: `M${c.x - 0.28},${c.y} H${c.x + 0.28}`, stroke: '#fff', 'stroke-width': STROKE * 3, fill: 'none' }, svg);
    el('path', { ...ink, d: `M${c.x - 0.28},${c.y} A0.28,0.28 0 0 1 ${c.x + 0.28},${c.y}` }, svg);
  }
  for (const p of sc.parts) {
    const g = el('g', { transform: `translate(${p.at.x} ${p.at.y}) rotate(${p.rot})${p.mirror ? ' scale(-1 1)' : ''}` }, svg);
    for (const shape of SYMBOLS[p.letter].shapes) {
      if (shape.fill) el('path', { d: shape.d, fill: '#111', stroke: 'none' }, g);
      else el('path', { ...ink, d: shape.d }, g);
    }
    for (const m of p.marks) {
      const d = m.text === '+' ? `M${m.at.x - 0.17},${m.at.y} H${m.at.x + 0.17} M${m.at.x},${m.at.y - 0.17} V${m.at.y + 0.17}` : `M${m.at.x - 0.17},${m.at.y} H${m.at.x + 0.17}`;
      el('path', { ...ink, 'stroke-width': 0.06, d }, svg);
    }
    // A source whose current an F or H reads: an arrowhead on its lead, the way that current flows.
    if (p.part.sensedBy.length) {
      const a = el('g', { transform: `translate(${p.arrow.at.x} ${p.arrow.at.y}) rotate(${ROT[p.arrow.direction]})` }, svg);
      el('path', { d: 'M-0.2,-0.17 L0.2,0 L-0.2,0.17 Z', fill: '#111', stroke: 'none' }, a);
    }
    for (const line of p.labels) text(line, svg, false);
    if (boxes) box(p.labelBox, svg, '#c22');
  }
  for (const g of sc.grounds) {
    const grp = el('g', { transform: `translate(${g.at.x} ${g.at.y}) rotate(${g.rot})` }, svg);
    for (const shape of SYMBOLS.ground.shapes) el('path', { ...ink, d: shape.d }, grp);
  }
  for (const j of sc.junctions) el('circle', { cx: j.x, cy: j.y, r: 0.16, fill: '#111' }, svg);
  for (const t of sc.terminals) el('circle', { cx: t.at.x, cy: t.at.y, r: 0.2, fill: '#fff', stroke: '#111', 'stroke-width': STROKE }, svg);
  // A stub: the node goes on to parts not drawn, shown as an open arrowhead pointing on.
  for (const t of sc.stubs) {
    const g = el('g', { transform: `translate(${t.at.x} ${t.at.y}) rotate(${ROT[t.direction]})` }, svg);
    el('path', { ...ink, d: 'M0.05,-0.26 L0.55,0 L0.05,0.26 Z', fill: '#fff' }, g);
  }
  for (const l of sc.nodeLabels) {
    for (const line of l.lines) text(line, svg, true);
    if (boxes) box(l.box, svg, '#27c');
  }
  return svg;
}

export interface Entry {
  name: string;
  /** Where it comes from (a path, or "more: ..."). */
  path: string;
  text: string;
  boxes?: boolean;
}

/** One card: the drawing, what the layout's checks say, the dot lines, the lines not drawn and the notes. */
export function card(entry: Entry, parent: Element, build: (text: string) => Schematic): void {
  const s = build(entry.text);
  const section = html('section', undefined, parent, 'card');
  section.id = `card-${entry.name}`;
  section.dataset.name = entry.name;
  html('h2', entry.path.replace(/^\//, ''), section);
  html('p', entry.text.split(/\r?\n/)[0]?.replace(/^\*\s*/, '') ?? '', section, 'title');
  section.append(draw(s, `Drawing of ${entry.name}`, entry.boxes === true));
  const dl = html('dl', undefined, section);
  const row = (term: string, value: string, className?: string): void => {
    html('dt', term, dl);
    html('dd', value, dl, className);
  };
  const overlaps = findOverlaps(s.scene);
  const conn = schematicConnectivity(s);
  const hidden = conn.filter((c) => c.kind === 'hidden');
  const issues = [...overlaps.map((o) => `${o.a.kind} ${o.a.id} overlaps ${o.b.kind} ${o.b.id}`), ...conn.filter((c) => c.kind !== 'hidden').map((c) => c.message)];
  const clean = hidden.length
    ? 'clean: nothing overlaps, and the drawing connects what the netlist does, but for the parts it does not show'
    : 'clean: nothing overlaps, and the drawing connects exactly what the netlist does';
  row('Check', issues.length ? issues.join('; ') : clean, issues.length ? 'bad' : 'ok');
  const dots = s.circuit.dotLines.filter((d) => d.name !== '.end').map((d) => d.text);
  row('Dot lines', dots.length ? dots.join('   ') : 'none');
  if (s.circuit.notDrawn.length) row('Not drawn', s.circuit.notDrawn.map((n) => `${n.name} (line ${n.lineNumber}: ${n.reason})`).join(', '));
  if (hidden.length) row('Hidden', hidden.map((c) => c.message).join(' '));
  if (s.problems.length) row('Drawing notes', s.problems.map((p) => p.message).join(' '));
  const sc = s.scene;
  row('Size', `${s.circuit.parts.length} parts, ${s.circuit.nodes.size} nodes, ${Math.round(sc.bounds.x1 - sc.bounds.x0)} × ${Math.round(sc.bounds.y1 - sc.bounds.y0)} grid units`);
}
