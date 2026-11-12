/**
 * The videos' drawings as PlainSpice drawings: the recorded geometry (recorded.json, from record.py)
 * and each example's plan (plan.ts) become the example's drawing block, the *@ lines just before
 * .end (decision 0013, docs/schematic.md "The drawing format"), so the example opens drawn as in its
 * video, and so do its share links and exports (decision 0016).
 *
 *   node --experimental-strip-types scripts/video-drawings/convert.ts            check every example (exit 1 on a difference)
 *   node --experimental-strip-types scripts/video-drawings/convert.ts --write    write the blocks into examples/
 *   ... --only <example id>   one example;   --report   the report (Markdown) on stdout
 *
 * How (see README.md here):
 * 1. Compose the example's video drawing from the recorded pieces (plan.ts: parts left out, copies
 *    beside each other, a 0 V source put in a lead or a wire, the typo's moved lead), and join wire
 *    ends that the video starts at a terminal's ring (0.085 off its point) to that point.
 * 2. Match each part the video draws to the netlist's, by name, else by kind and nodes (a diamond
 *    with + and − is an E or H; with an arrow, an F or G; the video's node "gnd" is 0), and check its
 *    nodes and its polarity: the + side of V, E and H is the netlist's first node, and the arrow of
 *    I, F and G points to its second. A mismatch stops the conversion: it is never silently fixed.
 * 3. Map the video's points (Manim units, y up) to the grid (y down) times a scale k, rounded to whole
 *    grid points. Each symbol is 4 units pin to pin (PIN_SPACING): it is centred on the video's
 *    segment, turned so pin 0 is at the netlist's first node, wired to the segment's ends, its words
 *    on the video's side. Parts in series in a straight line, meeting at a point nothing else touches
 *    (a 0 V ammeter and its resistor), share their segments: each stays as near as it can to where
 *    the video draws it, with room between them for the name of the node there. Ground symbols go at
 *    the video's ground points; a terminal is a label of its node at the wire end (an open end).
 * 3b. Every node's name is placed by the converter (nameNodes), each at the cheapest spot that touches
 *    nothing and reads as its own node's (nearer its own copper than any other node's, NEAR_MARGIN):
 *    the names the video writes at its point and on its side when they fit, else a spot turned as
 *    little as it can be from that side, at a point as near as can be on the node's copper (never on
 *    the left of a name the video writes on the right: there it would float away from its point, as
 *    the Notebook writes a name on the left at the far end of the room kept for its value); the nodes
 *    the video does not name beside their own wire, near where the model would write them, on the
 *    right where there is room. Then, for a phone held upright, names whose turned view has no room or
 *    reads as another node's try their next clean spots (turnFriendly).
 * 4. k is the smallest, from K_MIN in steps of 0.05, at which the drawing is clean with the Notebook
 *    look's words and results room (NOTEBOOK_OPTIONS): the model finds no problem with the lines,
 *    nothing overlaps, it connects exactly what the netlist does, it keeps every part, wire, ground
 *    symbol and label exactly where the converter put them, and every name reads as its own node's;
 *    up to PHONE_REACH larger when that lets a phone show the whole drawing when it opens, and up to
 *    SYMMETRY_REACH larger when that keeps the video's equal spans equal (chooseScale). Examples that
 *    show one drawing of a video share a scale (plan.scaleGroup). The block written is the model's
 *    drawing (the names in the netlist's order of the nodes), so building it again changes nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MIN_TEXT_PX, minUnitFor } from '../../src/notebook/fit.ts';
import { NOTEBOOK_OPTIONS } from '../../src/notebook/schematic.ts';
import { isWide, turnedQuarter } from '../../src/notebook/turn.ts';
import {
  GROUND,
  NODE_SPOTS,
  PIN_SPACING,
  applyChanges,
  boxesOverlap,
  buildScene,
  buildSchematic,
  checkConnectivity,
  circuitFromNetlist,
  drawingBlockChanges,
  findOverlaps,
  inflate,
  normalizeWires,
  partByKey,
  partGeometry,
  parseDrawingLines,
  pruneDangling,
  pt,
  reconcile,
  segmentCrossesBox,
  serializeDrawing,
  stripDrawing,
  unionBoxes,
  type Box,
  type Circuit,
  type CircuitPart,
  type Drawing,
  type LabelSide,
  type NodeLabel,
  type NodeSpot,
  type PartPlacement,
  type Point,
  type Rotation,
  type Scene,
  type Schematic,
  type TextLine,
} from '../../src/schematic/index.ts';
import { nodeLabelLines } from '../../src/schematic/scene.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { PLANS, type ExamplePlan, type Item } from './plan.ts';

// ------------------------------------------------------------------ the recording (record.py)

type XY = readonly [number, number];
type Dir = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'UL' | 'UR' | 'DL' | 'DR';
type VideoKind = 'R' | 'V' | 'I' | 'E' | 'F';

interface RecPart {
  kind: VideoKind;
  name: string;
  p: XY;
  q: XY;
  na: string;
  nb: string;
  side: number;
  line: number;
  plus?: 'p' | 'q';
  to?: 'p' | 'q';
}
interface RecSch {
  kind: 'sch';
  parts: RecPart[];
  wires: { node: string; pts: XY[]; line: number }[];
  grounds: { node: string; at: XY; line: number }[];
  terms: { node: string; at: XY; text: string; dir: Dir; line: number }[];
}
interface RecTag {
  kind: 'tag';
  text: string;
  at: XY;
  dir: Dir;
}
type RecItem =
  | RecSch
  | RecTag
  | { kind: 'tags'; tags: RecTag[] }
  | { kind: 'line'; a: XY; b: XY }
  | { kind: 'point'; at: XY }
  | { kind: 'moved-lead'; part: string; end: 'p' | 'q'; by: XY; scale: number; word: { text: string; dir: Dir }; lines: number[] };

export interface Recording {
  about: string;
  files: Record<string, string>;
  drawings: Record<string, { file: string; what: string; note: string; items: Record<string, RecItem> }>;
}

const here = import.meta.dirname;
const root = resolve(here, '../..');

export function readRecording(path = join(here, 'recorded.json')): Recording {
  return JSON.parse(readFileSync(path, 'utf8')) as Recording;
}

// ------------------------------------------------------------------ 1. the video drawing of an example

interface VPart {
  kind: VideoKind;
  name: string;
  p: XY;
  q: XY;
  na: string;
  nb: string;
  side: 1 | -1;
  plus?: 'p' | 'q';
  to?: 'p' | 'q';
  /** Where the body is drawn, when not midway between p and q (a lead with a 0 V source on it). */
  centre?: XY;
  /** An inserted part with no drawn place: as near its p end as there is room. */
  hug?: boolean;
  /** The p end's lead moved off p to this point, an open end of na (the typo). */
  detached?: { at: XY; dir: Dir };
  /** Where it comes from: the recording, or the plan's reason. */
  source: string;
}

interface VWire {
  node: string;
  pts: XY[];
  source: string;
}

interface VLabel {
  node: string;
  at: XY;
  dir: Dir;
  /** As the video writes it. */
  text: string;
  source: string;
  terminal: boolean;
}

export interface Video {
  parts: VPart[];
  wires: VWire[];
  grounds: XY[];
  labels: VLabel[];
  /** What the drawing has that the video does not, or the other way round, and why. */
  notes: string[];
  /** What the drawing format cannot say. */
  gaps: string[];
  /** Parts and ground symbols of the video's drawing that this netlist does not have (drawn faded in the reference picture). */
  absent: { parts: VPart[]; grounds: XY[] };
}

const add = (a: XY, b: XY): XY => [a[0] + b[0], a[1] + b[1]];
const same = (a: XY, b: XY, tol = 1e-9): boolean => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
const fmt = (n: number): string => String(Math.round(n * 1000) / 1000);

function item(rec: Recording, ref: Item): RecItem {
  const d = rec.drawings[ref.drawing];
  const it = d?.items[ref.item];
  if (!it) throw new Error(`recorded.json has no ${ref.drawing} ${ref.item}`);
  return it;
}

function pointOf(rec: Recording, ref: Item): XY {
  const it = item(rec, ref);
  if (it.kind !== 'point') throw new Error(`${ref.drawing} ${ref.item} is not a point`);
  return it.at;
}

/** The example's drawing in the video's units, composed as its plan says. */
export function compose(plan: ExamplePlan, rec: Recording): Video {
  const v: Video = { parts: [], wires: [], grounds: [], labels: [], notes: [...(plan.notes ?? [])], gaps: [], absent: { parts: [], grounds: [] } };
  const groundIs = plan.groundIs?.node;
  for (const use of plan.uses) {
    const it = item(rec, use);
    if (it.kind !== 'sch') throw new Error(`${use.drawing} ${use.item} is not a drawing`);
    const shift: XY = use.shift ?? [0, 0];
    const node = (n: string): string => {
      const m = use.nodes?.[n] ?? n;
      return m === 'gnd' && groundIs ? groundIs : m;
    };
    const src = `${use.drawing} ${use.item}`;
    for (const name of [...(use.drop ?? []), ...(use.absent ?? [])]) if (!it.parts.some((p) => p.name === name)) throw new Error(`${src} has no part ${name} to leave out`);
    for (const p of it.parts) {
      if (use.drop?.includes(p.name)) continue;
      const part: VPart = { kind: p.kind, name: p.name, p: add(p.p, shift), q: add(p.q, shift), na: node(p.na), nb: node(p.nb), side: p.side < 0 ? -1 : 1, source: `${src}, line ${p.line}` };
      if (p.plus) part.plus = p.plus;
      if (p.to) part.to = p.to;
      if (use.absent?.includes(p.name)) {
        v.absent.parts.push(part);
        v.notes.push(`${p.name} is not in this netlist: it is left out, with the wires that only lead to it.`);
      } else v.parts.push(part);
    }
    for (const w of it.wires) v.wires.push({ node: node(w.node), pts: w.pts.map((q) => add(q, shift)), source: `${src}, line ${w.line}` });
    for (const g of it.grounds) (groundIs ? v.absent.grounds : v.grounds).push(add(g.at, shift));
    for (const t of it.terms) {
      const n = node(t.node);
      v.labels.push({ node: n, at: add(t.at, shift), dir: t.dir, text: t.text, source: `${src}, line ${t.line}`, terminal: true });
    }
  }
  if (plan.groundIs) v.notes.push(`No ground symbol: ${plan.groundIs.why}.`);
  for (const names of plan.names ?? []) {
    const it = item(rec, names);
    const tags = it.kind === 'tag' ? [it] : it.kind === 'tags' ? it.tags : [];
    if (!tags.length) throw new Error(`${names.drawing} ${names.item} has no words`);
    for (const t of tags) {
      if (names.only && !names.only.includes(t.text)) continue;
      const node = names.texts?.[t.text] ?? t.text;
      if (node === '0' || node === 'gnd') {
        // Ground is named by its symbol: a label 0 on a grounded wire is dropped by the model.
        v.notes.push(`The video also writes “${t.text}” beside the ground wire, at (${t.at[0]}, ${t.at[1]}); here the ground symbol names that wire, as PlainSpice names ground only by its symbol.`);
        continue;
      }
      v.labels.push({ node, at: add(t.at, names.shift ?? [0, 0]), dir: t.dir, text: t.text, source: `${names.drawing} ${names.item}`, terminal: false });
    }
  }
  for (const w of plan.wires ?? []) {
    v.wires.push({ node: w.node, pts: w.pts.map((q) => [q[0], q[1]] as XY), source: `added: ${w.why}` });
    v.notes.push(`A wire added: ${w.why}.`);
  }
  for (const ins of plan.inserts ?? []) {
    const target = v.parts.find((p) => p.name === ins.into);
    if (!target) throw new Error(`${plan.id}: no part ${ins.into} to put ${ins.part} on`);
    const outer = ins.end === 'p' ? target.p : target.q;
    const inner = ins.end === 'p' ? target.q : target.p;
    const outerNode = ins.end === 'p' ? target.na : target.nb;
    const split: XY = ins.split ? pointOf(rec, ins.split) : [outer[0] + (inner[0] - outer[0]) * 0.25, outer[1] + (inner[1] - outer[1]) * 0.25];
    target.centre = target.centre ?? [(target.p[0] + target.q[0]) / 2, (target.p[1] + target.q[1]) / 2];
    if (ins.end === 'p') {
      target.p = split;
      target.na = ins.node;
    } else {
      target.q = split;
      target.nb = ins.node;
    }
    const part: VPart = { kind: ins.letter, name: ins.part, p: outer, q: split, na: outerNode, nb: ins.node, side: videoSide(outer, split, ins.side), plus: ins.plus === 'outer' ? 'p' : 'q', source: `added: ${ins.why}` };
    if (ins.centre) part.centre = pointOf(rec, ins.centre);
    else part.hug = true;
    v.parts.push(part);
    v.notes.push(`${ins.part} added on ${ins.into}’s lead: ${ins.why}.`);
  }
  for (const w of plan.inWires ?? []) {
    const it = item(rec, w.line);
    if (it.kind !== 'line') throw new Error(`${w.line.drawing} ${w.line.item} is not a line`);
    const node = (n: string): string => (n === 'gnd' && groundIs ? groundIs : n);
    if (!w.shift) {
      v.parts.push({ kind: w.letter, name: w.part, p: it.a, q: it.b, na: node(w.na), nb: node(w.nb), side: videoSide(it.a, it.b, w.side), plus: w.plus, source: `added: ${w.why}` });
      v.notes.push(`${w.part} drawn in the video’s wire from a to b: ${w.why}.`);
      continue;
    }
    // Beside the video's wire: from the terminals at its ends, across to the part and back.
    const end = (p: XY): XY => v.labels.find((l) => l.terminal && Math.hypot(l.at[0] - p[0], l.at[1] - p[1]) <= 0.1)?.at ?? p;
    const A = end(it.a);
    const B = end(it.b);
    const p = add(A, w.shift);
    const q = add(B, w.shift);
    v.parts.push({ kind: w.letter, name: w.part, p, q, na: node(w.na), nb: node(w.nb), side: videoSide(p, q, w.side), plus: w.plus, source: `added: ${w.why}` });
    v.wires.push({ node: w.na, pts: [A, p], source: `added: ${w.why}` }, { node: w.nb, pts: [B, q], source: `added: ${w.why}` });
    v.notes.push(`${w.part} drawn in the video’s wire from a to b, moved ${fmt(w.shift[0])} to the right of it: ${w.why}.`);
  }
  if (plan.movedLead) {
    const it = item(rec, plan.movedLead);
    if (it.kind !== 'moved-lead') throw new Error(`${plan.movedLead.drawing} ${plan.movedLead.item} is not a moved lead`);
    const part = v.parts.find((p) => p.name === it.part);
    if (!part) throw new Error(`${plan.id}: no part ${it.part} for the moved lead`);
    const from = it.end === 'p' ? part.p : part.q;
    const to = add(from, it.by);
    part.detached = { at: to, dir: it.word.dir };
    if (it.end === 'p') part.na = plan.movedLead.node;
    else part.nb = plan.movedLead.node;
    v.labels.push({ node: plan.movedLead.node, at: to, dir: it.word.dir, text: it.word.text, source: `${plan.movedLead.drawing} ${plan.movedLead.item}, lines ${it.lines.join(', ')}`, terminal: true });
    v.notes.push(
      `${it.part}’s lead moved off ${it.end === 'p' ? 'its first point' : 'its second point'} by (${fmt(it.by[0])}, ${fmt(it.by[1])}) and named ${it.word.text}, as the video draws the typo: ${plan.movedLead.why}.`,
    );
  }
  return v;
}

/**
 * Joins points closer than `tol` (Manim units) to one point: the video starts a wire 0.085 to the
 * right of a terminal's point (the ring's edge, RING), which is the terminal's point on the grid.
 * Part ends, terminals and ground points win over wire points.
 */
function snap(v: Video, tol = 0.1): void {
  const anchors: XY[] = [];
  const keep = (p: XY): XY => {
    for (const a of anchors) if (Math.hypot(a[0] - p[0], a[1] - p[1]) <= tol) return a;
    anchors.push(p);
    return p;
  };
  // Terminals, ground points and the ends of the parts the video draws are exact; the ends of a
  // short-circuit line (drawn from ring to ring) and of wires joined to a ring are not.
  for (const l of v.labels) if (l.terminal) l.at = keep(l.at);
  v.grounds = v.grounds.map(keep);
  const fromLine = (p: VPart): boolean => p.source.startsWith('added:') && !p.hug && p.centre === undefined && p.kind === 'V' && p.name.toLowerCase().startsWith('vshort');
  for (const p of v.parts.filter((x) => !fromLine(x))) {
    p.p = keep(p.p);
    p.q = keep(p.q);
  }
  const moved: string[] = [];
  for (const w of v.wires) {
    w.pts = w.pts.map((q) => {
      const k = keep(q);
      if (!same(k, q)) moved.push(`(${fmt(q[0])}, ${fmt(q[1])}) → (${fmt(k[0])}, ${fmt(k[1])})`);
      return k;
    });
  }
  for (const p of v.parts.filter(fromLine)) {
    p.p = keep(p.p);
    p.q = keep(p.q);
  }
  for (const l of v.labels) if (!l.terminal) l.at = keep(l.at);
  if (moved.length) v.notes.push(`Wire ends the video starts at a terminal’s ring are joined to the terminal’s point: ${moved.join(', ')}.`);
}

/** The point nearest p on a segment a–b. */
function nearestOn(p: XY, a: XY, b: XY): XY {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return [a[0] + t * dx, a[1] + t * dy];
}

/**
 * A node name the video writes beside its node rather than at a point of it (the "0" of example 1,
 * written below and right of the ground wire's middle) goes to the nearest point of the node's
 * wires, on the same side of it. A model label is a point of the node's copper and a spot around it.
 */
function namesOnCopper(v: Video): void {
  for (const l of v.labels) {
    if (l.terminal) continue;
    const ends: XY[] = [];
    const segs: [XY, XY][] = [];
    for (const p of v.parts) {
      if (p.na === l.node && !p.detached) ends.push(p.p);
      if (p.nb === l.node) ends.push(p.q);
    }
    for (const w of v.wires) if (w.node === l.node) w.pts.forEach((q, i) => (i ? segs.push([w.pts[i - 1]!, q]) : ends.push(q)));
    const candidates = [...ends, ...segs.map(([a, b]) => nearestOn(l.at, a, b))];
    let best: XY | undefined;
    for (const c of candidates) if (!best || Math.hypot(c[0] - l.at[0], c[1] - l.at[1]) < Math.hypot(best[0] - l.at[0], best[1] - l.at[1])) best = c;
    if (!best || same(best, l.at, 1e-6)) continue;
    const dx = l.at[0] - best[0];
    const dy = l.at[1] - best[1];
    if (Math.hypot(dx, dy) > 0.5) throw new Error(`the name ${l.text} (${l.source}) is not next to node ${l.node}`);
    l.dir = dx >= 0 ? (dy >= 0 ? 'UR' : 'DR') : dy >= 0 ? 'UL' : 'DL';
    v.notes.push(`The video writes ${l.text} beside ${l.node}’s wire, at (${fmt(l.at[0])}, ${fmt(l.at[1])}); the label is at the nearest point of the wire, on that side.`);
    l.at = best;
  }
}

// ------------------------------------------------------------------ 2. the video's parts and the netlist's

const LETTERS: Readonly<Record<VideoKind, readonly string[]>> = { R: ['R'], V: ['V'], I: ['I'], E: ['E', 'H'], F: ['F', 'G'] };
const nodeName = (n: string): string => (n === 'gnd' ? '0' : n.toLowerCase());

export interface Match {
  video: VPart;
  part: CircuitPart;
  /** Which end of the video's segment the netlist's first node (pin 0) is at. */
  pin0: 'p' | 'q';
}

/** The video's label side (±1 along the normal of p → q, turned 90° anticlockwise, y up) that puts words on `side`. */
function videoSide(p: XY, q: XY, side: LabelSide): 1 | -1 {
  const nx = -(q[1] - p[1]);
  const ny = q[0] - p[0];
  const d = side === 'above' ? ny : side === 'below' ? -ny : side === 'right' ? nx : -nx;
  return d >= 0 ? 1 : -1;
}

/** Each video part's netlist part; throws with every mismatch found (they are findings, never fixed). */
export function matchParts(v: Video, circuit: Circuit): { matches: Match[]; notDrawn: CircuitPart[]; renamed: string[] } {
  const findings: string[] = [];
  const used = new Set<string>();
  const matches: Match[] = [];
  const renamed: string[] = [];
  for (const vp of v.parts) {
    const kinds = LETTERS[vp.kind];
    const nodes = [nodeName(vp.na), nodeName(vp.nb)].sort().join(' ');
    const open = circuit.parts.filter((p) => !used.has(p.key) && kinds.includes(p.letter));
    let part: CircuitPart | undefined = open.find((p) => p.key === vp.name.toLowerCase());
    if (!part) {
      const byNodes = open.filter((p) => [...p.nodes].sort().join(' ') === nodes);
      part = byNodes.length === 1 ? byNodes[0] : undefined;
      if (!part) {
        findings.push(`${vp.name} (${vp.kind} between ${vp.na} and ${vp.nb}, ${vp.source}): ${byNodes.length ? `several netlist parts could be it: ${byNodes.map((p) => p.name).join(', ')}` : 'no netlist part of that kind between those nodes'}`);
        continue;
      }
      renamed.push(`${vp.name} → ${part.name}`);
    }
    used.add(part.key);
    const [n0, n1] = part.nodes;
    const a = nodeName(vp.na);
    const b = nodeName(vp.nb);
    let pin0: 'p' | 'q';
    if (a === n0 && b === n1) pin0 = 'p';
    else if (a === n1 && b === n0) pin0 = 'q';
    else {
      findings.push(`${vp.name} → ${part.name}: the video draws it between ${vp.na} and ${vp.nb}, the netlist between ${part.nodeText[0]} and ${part.nodeText[1]}`);
      continue;
    }
    if (n0 === n1) findings.push(`${part.name}: both its nodes are ${n0}`);
    if (vp.kind === 'V' || vp.kind === 'E') {
      if (vp.plus !== pin0) findings.push(`${part.name}: the video draws its + side at ${vp.plus === 'p' ? vp.na : vp.nb}, the netlist puts + at ${part.nodeText[0]} (its first node)`);
    } else if (vp.kind === 'I' || vp.kind === 'F') {
      if (vp.to === pin0) findings.push(`${part.name}: the video’s arrow points to ${vp.to === 'p' ? vp.na : vp.nb}, the netlist’s current flows from ${part.nodeText[0]} to ${part.nodeText[1]}`);
    }
    matches.push({ video: vp, part, pin0 });
  }
  if (findings.length) throw new Error(`the video’s drawing does not match the netlist:\n- ${findings.join('\n- ')}`);
  return { matches, notDrawn: circuit.parts.filter((p) => !used.has(p.key)), renamed };
}

// ------------------------------------------------------------------ 3. on the grid

/**
 * The model's spot for the side the video writes a name on. The format has no spot centred above or
 * below a point (a format gap): a name the video centres above goes above and right, or above and
 * left when that is taken.
 */
const DIR_SPOTS: Readonly<Record<Dir, readonly NodeSpot[]>> = {
  UL: ['above-left'],
  UR: ['above-right'],
  DL: ['below-left'],
  DR: ['below-right'],
  LEFT: ['left'],
  RIGHT: ['right'],
  UP: ['above-right', 'above-left'],
  DOWN: ['below-right', 'below-left'],
};

/** The model's side for the video's label side: ±1 along the normal of p → q turned 90° anticlockwise (y up). */
function sideOf(p: XY, q: XY, side: 1 | -1): LabelSide {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const len = Math.hypot(dx, dy);
  const nx = (-dy / len) * side;
  const ny = (dx / len) * side;
  if (Math.abs(nx) > Math.abs(ny)) return nx > 0 ? 'right' : 'left';
  return ny > 0 ? 'above' : 'below';
}

/** Rotation that puts pin 0 on the side of `dir` (grid, y down): up 0, right 90, down 180, left 270. */
function rotationTowards(dx: number, dy: number): Rotation {
  if (dx === 0) return dy < 0 ? 0 : 180;
  return dx > 0 ? 90 : 270;
}

interface Chain {
  /** Parts in order from `from` to `to`, each with the end it enters by. */
  parts: { m: Match; enter: 'p' | 'q' }[];
  from: XY;
  to: XY;
  /** The points where consecutive parts meet (Manim), in order. */
  joints: XY[];
}

/** Parts in series on one straight line, meeting at points nothing else touches (a 0 V ammeter and its resistor). */
function chainsOf(v: Video, matches: readonly Match[]): Chain[] {
  const key = (p: XY): string => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const ends = new Map<string, { m: Match; end: 'p' | 'q' }[]>();
  for (const m of matches) {
    for (const end of ['p', 'q'] as const) {
      if (end === 'p' && m.video.detached) continue;
      const at = m.video[end];
      const list = ends.get(key(at)) ?? [];
      list.push({ m, end });
      ends.set(key(at), list);
    }
  }
  const onWire = (p: XY): boolean =>
    v.wires.some((w) =>
      w.pts.some((a, i) => {
        const b = w.pts[i + 1];
        if (same(a, p)) return true;
        if (!b) return false;
        const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        return Math.abs(cross) < 1e-9 && Math.min(a[0], b[0]) - 1e-9 <= p[0] && p[0] <= Math.max(a[0], b[0]) + 1e-9 && Math.min(a[1], b[1]) - 1e-9 <= p[1] && p[1] <= Math.max(a[1], b[1]) + 1e-9;
      }),
    );
  const isFree = (p: XY): boolean => {
    const list = ends.get(key(p)) ?? [];
    if (list.length !== 2) return false;
    if (onWire(p) || v.grounds.some((g) => same(g, p)) || v.labels.some((l) => l.terminal && same(l.at, p))) return false;
    // Collinear, one on each side of the point.
    const [a, b] = list as [{ m: Match; end: 'p' | 'q' }, { m: Match; end: 'p' | 'q' }];
    const other = (x: { m: Match; end: 'p' | 'q' }): XY => (x.end === 'p' ? x.m.video.q : x.m.video.p);
    const oa = other(a);
    const ob = other(b);
    const cross = (oa[0] - p[0]) * (ob[1] - p[1]) - (oa[1] - p[1]) * (ob[0] - p[0]);
    const dot = (oa[0] - p[0]) * (ob[0] - p[0]) + (oa[1] - p[1]) * (ob[1] - p[1]);
    return Math.abs(cross) < 1e-9 && dot < 0;
  };
  const seen = new Set<Match>();
  const chains: Chain[] = [];
  for (const m of matches) {
    if (seen.has(m)) continue;
    // Walk back to the chain's first part, then forward.
    let first = m;
    let enter: 'p' | 'q' = 'p';
    for (let guard = 0; guard < matches.length; guard++) {
      const back: XY = enter === 'p' ? first.video.p : first.video.q;
      if (first.video.detached && enter === 'p') break;
      if (!isFree(back)) break;
      const prev: { m: Match; end: 'p' | 'q' } = ends.get(key(back))!.find((x) => x.m !== first)!;
      first = prev.m;
      enter = prev.end === 'p' ? 'q' : 'p';
    }
    const chain: Chain = { parts: [], from: enter === 'p' ? first.video.p : first.video.q, to: [0, 0], joints: [] };
    let cur = first;
    let curEnter = enter;
    for (let guard = 0; guard <= matches.length; guard++) {
      seen.add(cur);
      chain.parts.push({ m: cur, enter: curEnter });
      const exit = curEnter === 'p' ? cur.video.q : cur.video.p;
      chain.to = exit;
      if (!isFree(exit)) break;
      const next = ends.get(key(exit))!.find((x) => x.m !== cur)!;
      chain.joints.push(exit);
      cur = next.m;
      curEnter = next.end;
    }
    chains.push(chain);
  }
  return chains;
}

/** A node name to write: one the video writes (at its point, on its side), or one it does not write. */
export interface NameRequest {
  node: string;
  /**
   * Where the video writes it, on the grid: a terminal's open end (which stays), a name's point (on
   * the wire between two parts in series when it is there); for a node the video does not name, the
   * point the model would choose (src/schematic, labelPoint).
   */
  at: Point;
  /** The side the video writes it on; undefined for a node the video does not name. */
  dir?: Dir;
  terminal: boolean;
  /** Its own words, when they are not the node's name (the terminal b on ground, when the format can say it). */
  own?: string;
  /** As the video writes it (for the report). */
  text: string;
}

export interface Placed {
  /** Parts, wires and ground symbols; its labels are the requests' points until the names are placed (nameNodes). */
  drawing: Drawing;
  requests: NameRequest[];
  /** The labels placed (the model must keep them). */
  labels: NodeLabel[];
  /** The wire between two parts in series, by the node it is. */
  joints: Map<string, { a: Point; b: Point; horizontal: boolean }>;
  notes: string[];
}

const g = (k: number, p: XY): Point => pt(Math.round(k * p[0]), Math.round(-k * p[1]));

/** The example's drawing on the grid at scale k (with `gaps`: room left between two parts in series for the name of the node between them, by node), or the reason it does not fit there. */
export function place(v: Video, matches: readonly Match[], k: number, gaps: ReadonlyMap<string, number> = new Map()): Placed | string {
  const parts = new Map<string, PartPlacement>();
  const wires: Point[][] = [];
  const notes: string[] = [];
  /** The wire between two parts in series, by the node it is (a node name the video writes there goes on it). */
  const joints = new Map<string, { a: Point; b: Point; horizontal: boolean }>();
  for (const chain of chainsOf(v, matches)) {
    const A = g(k, chain.from);
    const B = g(k, chain.to);
    if (A.x !== B.x && A.y !== B.y) return `${chain.parts.map((c) => c.m.part.name).join(', ')} is not drawn level or upright`;
    const horizontal = A.y === B.y;
    const along = (p: Point): number => (horizontal ? p.x : p.y);
    const sign = Math.sign(along(B) - along(A)) || 1;
    const length = Math.abs(along(B) - along(A));
    const n = chain.parts.length;
    // The node between part i and part i + 1, and the room asked for its name there.
    const jointNode = (i: number): string => {
      const { m, enter } = chain.parts[i]!;
      return nodeName(enter === 'p' ? m.video.nb : m.video.na);
    };
    const gap = (i: number): number => gaps.get(jointNode(i)) ?? 0;
    const half = PIN_SPACING / 2;
    // Distance of each body centre from A, as the video draws it, then packed so the symbols do not overlap.
    const t = chain.parts.map(({ m, enter }) => {
      const vp = m.video;
      // A part with no drawn place sits right at its p end (the node its current comes in at).
      if (vp.hug) return enter === 'p' ? half : length - half;
      const c = vp.centre ?? ([(vp.p[0] + vp.q[0]) / 2, (vp.p[1] + vp.q[1]) / 2] as XY);
      return Math.abs(along(g(k, c)) - along(A));
    });
    for (let i = 0; i < n; i++) t[i] = Math.max(t[i]!, i === 0 ? half : t[i - 1]! + PIN_SPACING + gap(i - 1));
    for (let i = n - 1; i >= 0; i--) t[i] = Math.min(t[i]!, i === n - 1 ? length - half : t[i + 1]! - PIN_SPACING - gap(i));
    if (t[0]! < half) return `${chain.parts.map((c) => c.m.part.name).join(', ')}: no room at this scale`;
    const at = (d: number): Point => (horizontal ? pt(A.x + sign * d, A.y) : pt(A.x, A.y + sign * d));
    let prev = A;
    chain.parts.forEach(({ m, enter }, i) => {
      const c = at(t[i]!);
      const enterPin = at(t[i]! - half);
      const exitPin = at(t[i]! + half);
      // pin 0 is on the side of the video's end that has the netlist's first node.
      const pin0 = m.pin0 === enter ? enterPin : exitPin;
      const rot = rotationTowards(pin0.x - c.x, pin0.y - c.y);
      parts.set(m.part.key, { at: c, rot, mirror: false, side: sideOf(m.video.p, m.video.q, m.video.side) });
      if (prev.x !== enterPin.x || prev.y !== enterPin.y) {
        // The typo: the lead from the moved end goes to its open end instead of the node.
        if (!(i === 0 && m.video.detached && enter === 'p')) wires.push([prev, enterPin]);
      }
      if (i > 0) joints.set(jointNode(i - 1), { a: prev, b: enterPin, horizontal });
      prev = exitPin;
      if (m.video.detached && enter === 'p') {
        const D = g(k, m.video.detached.at);
        // Along the part's axis to the open end's level, then across to it (the video's lead is slanted).
        const corner = horizontal ? pt(D.x, enterPin.y) : pt(enterPin.x, D.y);
        const lead = [enterPin, corner, D].filter((q, j, all) => j === 0 || q.x !== all[j - 1]!.x || q.y !== all[j - 1]!.y);
        if (lead.length > 1) wires.push(lead);
      }
    });
    if (prev.x !== B.x || prev.y !== B.y) wires.push([prev, B]);
  }
  /** A name on the wire between two parts in series goes at the end of it that its words read away from. */
  const onJoint = (node: string, spot: NodeSpot): Point | undefined => {
    const j = joints.get(node);
    if (!j) return undefined;
    const lo = j.horizontal ? (j.a.x <= j.b.x ? j.a : j.b) : j.a.y <= j.b.y ? j.a : j.b;
    const hi = lo === j.a ? j.b : j.a;
    const mid = pt(Math.round((j.a.x + j.b.x) / 2), Math.round((j.a.y + j.b.y) / 2));
    if (j.horizontal) return spot.endsWith('right') ? lo : spot.endsWith('left') ? hi : mid;
    return spot.startsWith('above') ? hi : spot.startsWith('below') ? lo : mid;
  };
  for (const w of v.wires) {
    const pts = w.pts.map((q) => g(k, q)).filter((q, j, all) => j === 0 || q.x !== all[j - 1]!.x || q.y !== all[j - 1]!.y);
    if (pts.length > 1) wires.push(pts);
    for (let j = 1; j < pts.length; j++) if (pts[j]!.x !== pts[j - 1]!.x && pts[j]!.y !== pts[j - 1]!.y) return `a wire of ${w.node} is slanted`;
  }
  const grounds = v.grounds.map((q) => ({ at: g(k, q), rot: 0 as Rotation }));
  const requests: NameRequest[] = v.labels.map((l) => {
    const node = nodeName(l.node);
    const joint = !l.terminal && v.parts.some((p) => same(p.p, l.at) || same(p.q, l.at)) ? onJoint(node, DIR_SPOTS[l.dir][0]!) : undefined;
    const r: NameRequest = { node, at: joint ?? g(k, l.at), dir: l.dir, terminal: l.terminal, text: l.text };
    // A terminal on ground ("b"): its own name, when the model can write one (LABEL_NAMES).
    if (l.terminal && node === '0') r.own = l.text;
    return r;
  });
  const labels: NodeLabel[] = requests.map((r) => ({ node: r.node, at: r.at }));
  // Wire ends that lead nowhere go, as the model removes them (the video's terminal b on the ground wire, say).
  const anchors: Point[] = [];
  for (const m of matches) {
    const pl = parts.get(m.part.key);
    if (!pl) continue;
    const d = pl.rot === 0 ? [0, -2] : pl.rot === 90 ? [2, 0] : pl.rot === 180 ? [0, 2] : [-2, 0];
    anchors.push(pt(pl.at.x + d[0]!, pl.at.y + d[1]!), pt(pl.at.x - d[0]!, pl.at.y - d[1]!));
  }
  for (const gr of grounds) anchors.push(gr.at);
  const segs = wires.flatMap((w) => w.slice(1).map((q, j) => [w[j]!, q] as [Point, Point]));
  const pruned = pruneDangling(segs, anchors, labels.map((l) => l.at));
  const before = normalizeWires(segs);
  const after = normalizeWires(pruned);
  if (JSON.stringify(before) !== JSON.stringify(after)) notes.push('wire ends that lead nowhere');
  // Shift so the drawing starts at 0,0.
  const all = [...after.flat(), ...anchors, ...labels.map((l) => l.at)];
  const dx = -Math.min(...all.map((q) => q.x));
  const dy = -Math.min(...all.map((q) => q.y));
  const move = (q: Point): Point => pt(q.x + dx, q.y + dy);
  const drawing: Drawing = {
    parts: new Map([...parts].map(([key, p]) => [key, { ...p, at: move(p.at) }])),
    grounds: grounds.map((gr) => ({ at: move(gr.at), rot: gr.rot })),
    wires: after.map((w) => w.map(move)),
    labels: labels.map((l) => ({ ...l, at: move(l.at) })),
  };
  return {
    drawing,
    requests: requests.map((r) => ({ ...r, at: move(r.at) })),
    labels: [],
    joints: new Map([...joints].map(([node, j]) => [node, { a: move(j.a), b: move(j.b), horizontal: j.horizontal }])),
    notes,
  };
}

// ------------------------------------------------------------------ 3b. the node names

/**
 * Where a node's name may go and what it costs, by the side the video writes it on. A spot's cost
 * is how far it turns from the video's side (45° = 1; a spot well away from the wire, 0.5 more); a
 * spot on the left costs 0.25 more, as the Notebook writes a name there at the far end of the room
 * kept for its value, away from its point. A name the video writes on the right never goes on the
 * left: it would be on the other side of its wire, and far from it. A name the video does not write
 * is costed as one written above and to the right.
 */
const SPOT_ANGLE: Readonly<Record<NodeSpot, number>> = { right: 0, 'far-right': 0, 'above-right': 45, 'above-left': 135, left: 180, 'far-left': 180, 'below-left': 225, 'below-right': 315 };
const DIR_ANGLE: Readonly<Record<Dir, number>> = { RIGHT: 0, UR: 45, UP: 90, UL: 135, LEFT: 180, DL: 225, DOWN: 270, DR: 315 };
const RIGHT_HAND: ReadonlySet<Dir> = new Set<Dir>(['RIGHT', 'UR', 'DR']);

export function spotCost(dir: Dir | undefined, spot: NodeSpot): number | undefined {
  if (dir && RIGHT_HAND.has(dir) && spot.endsWith('left')) return undefined;
  const turn = Math.abs((((SPOT_ANGLE[spot] - DIR_ANGLE[dir ?? 'UR']) % 360) + 540) % 360 - 180) / 45;
  return turn + (spot.startsWith('far') ? 0.5 : 0) + (spot.endsWith('left') ? 0.25 : 0);
}

/** How far a video name may move along its node's copper (grid units); a name the video does not write, from the model's point. */
const NAME_REACH = 4;
const FREE_REACH = 6;
/**
 * A name must be nearer its own node's copper than any other node's, by this much (grid units):
 * else it reads as the other node's (a name under a resistor reads as either end's; beside another
 * node's wire, as that node's).
 */
export const NEAR_MARGIN = 0.5;

type Seg = readonly [Point, Point];

/** Each node's copper in a scene: its wires, its pins' leads up to the symbol's body, and (node 0) its ground symbols. */
export function copperOf(scene: Scene): Map<string, Seg[]> {
  const out = new Map<string, Seg[]>();
  const add = (node: string, s: Seg): void => void (out.get(node) ?? out.set(node, []).get(node)!).push(s);
  for (const w of scene.wires) if (w.node) for (let i = 1; i < w.points.length; i++) add(w.node, [w.points[i - 1]!, w.points[i]!]);
  for (const p of scene.parts) {
    for (const pin of p.pins) {
      const c = p.at;
      const end = pin.at.x === c.x ? pt(c.x, pin.at.y < c.y ? p.body.y0 : p.body.y1) : pt(pin.at.x < c.x ? p.body.x0 : p.body.x1, c.y);
      add(pin.node, [pin.at, end]);
    }
  }
  for (const gr of scene.grounds) {
    const b = gr.box;
    add(GROUND, [pt(b.x0, b.y0), pt(b.x1, b.y0)]);
    add(GROUND, [pt(b.x0, b.y1), pt(b.x1, b.y1)]);
  }
  return out;
}

const boxToSeg = (b: Box, [p, q]: Seg): number => {
  const dx = Math.max(0, Math.min(p.x, q.x) - b.x1, b.x0 - Math.max(p.x, q.x));
  const dy = Math.max(0, Math.min(p.y, q.y) - b.y1, b.y0 - Math.max(p.y, q.y));
  return Math.hypot(dx, dy);
};

/** How near a name's words are to its own node's copper and to the nearest other node's (grid units). */
export function nearness(copper: ReadonlyMap<string, readonly Seg[]>, node: string, box: Box): { own: number; other: number; by?: string } {
  let own = Infinity;
  let other = Infinity;
  let by: string | undefined;
  for (const [n, segs] of copper) {
    for (const s of segs) {
      const d = boxToSeg(box, s);
      if (n === node) own = Math.min(own, d);
      else if (d < other) {
        other = d;
        by = n;
      }
    }
  }
  return by === undefined ? { own, other } : { own, other, by };
}

/** Names that read as another node's: the words of a node's name are not nearer its own copper than any other node's, by NEAR_MARGIN. */
export function nameProblems(scene: Scene): string[] {
  const copper = copperOf(scene);
  const out: string[] = [];
  for (const l of scene.nodeLabels) {
    const words = l.lines.find((x) => x.role === 'node')?.box ?? l.box;
    const n = nearness(copper, l.node, words);
    if (!(n.own + NEAR_MARGIN <= n.other)) out.push(`${l.text} at ${l.at.x},${l.at.y} ${l.spot}: ${n.own.toFixed(2)} from its own copper, ${n.other.toFixed(2)} from ${n.by ?? '?'}’s`);
  }
  return out;
}

/** A name placed: where, on which spot, at what cost, and (for the report) what kept it off the video's own spot. */
export interface Chosen {
  request: NameRequest;
  at: Point;
  spot: NodeSpot;
  cost: number;
  /** Why the video's own spot at its point was not used, when it was not. */
  why?: string;
}

const NODE_GAP = 1;

/** What places names on a drawing: its scene without names, what words must keep clear of, and the names placed so far. */
interface Namer {
  base: Scene;
  /** Every spot a request's name could take, cheapest first (not yet checked). */
  candidates(r: NameRequest): { at: Point; spot: NodeSpot; cost: number }[];
  /** What the name's words at a point and spot touch, or how they read as another node's; undefined when clean. */
  fault(r: NameRequest, at: Point, spot: NodeSpot): string | undefined;
  /** The cheapest clean spot for a request, given the names placed so far. */
  first(r: NameRequest): Chosen | undefined;
  take(c: Chosen): void;
  labels: NodeLabel[];
  chosen: Chosen[];
  linesAt(r: NameRequest, at: Point, spot: NodeSpot): TextLine[];
}

const labelOf = (c: Chosen): NodeLabel => {
  const label: NodeLabel = { node: c.request.node, at: c.at, side: c.spot };
  return c.request.own ? ({ ...label, name: c.request.own } as NodeLabel) : label;
};

function makeNamer(pr: Prepared, placed: Placed): Namer | string {
  const { circuit } = pr;
  const options = NOTEBOOK_OPTIONS;
  const base = buildScene(circuit, { ...placed.drawing, labels: [] }, options);
  const clash = findOverlaps(base);
  if (clash.length) return clash.slice(0, 3).map((o) => `${o.a.kind} ${o.a.id} / ${o.b.kind} ${o.b.id}`).join('; ');
  const symbols: Box[] = [...base.parts.map((p) => p.box), ...base.grounds.map((gr) => gr.box)];
  const words: Box[] = base.parts.map((p) => p.labelBox);
  const wireSegs = base.wires.flatMap((w) => w.points.slice(1).map((q, i) => [w.points[i]!, q] as const));
  const marks: Box[] = [
    ...base.junctions.map((j) => inflate({ x0: j.x, y0: j.y, x1: j.x, y1: j.y }, 0.2)),
    ...[...base.terminals.map((t) => t.at), ...placed.requests.filter((r) => r.terminal).map((r) => r.at)].map((p) => inflate({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }, 0.25)),
    ...base.stubs.map((t) => inflate(t.box, 0.05)),
  ];
  const copper = copperOf(base);
  // The grid points a node's name can be at: its wires' and its pins' (a label names the copper it is on).
  const onWireOrPin = (node: string): Point[] => {
    const pins = base.parts.flatMap((p) => p.pins.filter((x) => x.node === node).map((x) => x.at));
    const wirePts = base.wires.filter((w) => w.node === node).flatMap((w) => {
      const out: Point[] = [];
      for (let i = 1; i < w.points.length; i++) {
        const a = w.points[i - 1]!;
        const b = w.points[i]!;
        const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        for (let j = 0; j <= n; j++) out.push(pt(a.x + Math.sign(b.x - a.x) * j, a.y + Math.sign(b.y - a.y) * j));
      }
      return out;
    });
    const all = new Map<string, Point>();
    for (const p of [...pins, ...wirePts]) all.set(`${p.x},${p.y}`, p);
    return [...all.values()];
  };
  const placedBoxes: Box[] = [];
  const labels: NodeLabel[] = [];
  const chosen: Chosen[] = [];
  const textOf = (r: NameRequest): string => r.own ?? circuit.nodes.get(r.node)?.text ?? r.node;
  const linesAt = (r: NameRequest, at: Point, spot: NodeSpot): TextLine[] => {
    const hidden = [...new Set((circuit.nodes.get(r.node)?.hidden ?? []).map((h) => h.name))];
    return nodeLabelLines(textOf(r), at, spot, true, hidden, options.measure, options.nodeResultInline);
  };
  const fault = (r: NameRequest, at: Point, spot: NodeSpot): string | undefined => {
    const lines = linesAt(r, at, spot);
    const box = unionBoxes(lines.map((l) => l.box))!;
    const partOf = (i: number): string => base.parts[i]?.name ?? 'a ground symbol';
    const s = symbols.findIndex((b) => boxesOverlap(box, b));
    if (s >= 0) return `on ${partOf(s)}`;
    const w = words.findIndex((b) => boxesOverlap(box, b));
    if (w >= 0) return `on ${base.parts[w]!.name}’s words`;
    if (placedBoxes.some((b) => boxesOverlap(box, b))) return 'on another name';
    if (wireSegs.some(([a, b]) => segmentCrossesBox(a, b, box))) return 'across a wire';
    if (marks.some((b) => boxesOverlap(box, b))) return 'on a junction dot or a terminal';
    const name = lines.find((l) => l.role === 'node')?.box ?? box;
    const n = nearness(copper, r.node, name);
    if (!(n.own + NEAR_MARGIN <= n.other)) return `nearer ${n.by === GROUND ? 'ground' : n.by}’s wire than its own`;
    return undefined;
  };
  const candidates = (r: NameRequest): { at: Point; spot: NodeSpot; cost: number }[] => {
    const reach = r.terminal ? 0 : r.dir ? NAME_REACH : FREE_REACH;
    const cands: { at: Point; spot: NodeSpot; cost: number; d: number; i: number }[] = [];
    const pts = r.terminal ? [r.at] : onWireOrPin(r.node).filter((p) => Math.hypot(p.x - r.at.x, p.y - r.at.y) <= reach + 1e-9);
    for (const at of pts) {
      const d = Math.hypot(at.x - r.at.x, at.y - r.at.y);
      NODE_SPOTS.forEach((spot, i) => {
        const c = spotCost(r.dir, spot);
        if (c !== undefined) cands.push({ at, spot, cost: c + d, d, i });
      });
    }
    return cands.sort((a, b) => a.cost - b.cost || a.d - b.d || a.i - b.i).map(({ at, spot, cost }) => ({ at, spot, cost }));
  };
  const first = (r: NameRequest): Chosen | undefined => {
    const own = r.dir ? DIR_SPOTS[r.dir][0]! : undefined;
    const why = own ? fault(r, r.at, own) : undefined;
    for (const c of candidates(r)) {
      if (fault(r, c.at, c.spot)) continue;
      const out: Chosen = { request: r, at: c.at, spot: c.spot, cost: c.cost };
      if (why) out.why = why;
      return out;
    }
    return undefined;
  };
  const take = (c: Chosen): void => {
    chosen.push(c);
    labels.push(labelOf(c));
    placedBoxes.push(unionBoxes(linesAt(c.request, c.at, c.spot).map((l) => l.box))!);
  };
  return { base, candidates, fault, first, take, labels, chosen, linesAt };
}

/**
 * Every node's name (ground has its symbol), each at the cheapest spot near where the video writes
 * it (spotCost, plus the distance moved along its copper) that touches nothing (no symbol, words,
 * wire, junction dot, terminal ring) and reads as its own node's (nearness). Terminals first (their
 * point stays: the open end), then the names the video writes, in its order, then the nodes it does
 * not name, from where the model would write them. When a name between two parts in series has no
 * room, the room it needs is asked for (`need`: the parts slide apart).
 */
export function nameNodes(pr: Prepared, placed: Placed, gaps: ReadonlyMap<string, number>): { labels: NodeLabel[]; chosen: Chosen[] } | { node: string; need?: number; why: string } {
  const { circuit } = pr;
  const namer = makeNamer(pr, placed);
  if (typeof namer === 'string') return { node: '', why: namer };
  /** No spot for a name: between two parts in series, the room it needs there; else why. */
  const failed = (r: NameRequest): { node: string; need?: number; why: string } => {
    const first = r.dir ? DIR_SPOTS[r.dir][0]! : 'above-right';
    const joint = pr.jointNodes.has(r.node) ? placed.joints.get(r.node) : undefined;
    if (joint) {
      const box = unionBoxes(namer.linesAt(r, r.at, first).map((l) => l.box))!;
      const need = Math.ceil(joint.horizontal ? box.x1 - box.x0 : box.y1 - box.y0) + NODE_GAP;
      if (need > (gaps.get(r.node) ?? 0)) return { node: r.node, need, why: `${r.text}: no room between the parts in series` };
    }
    return { node: r.node, why: `${r.text}: no room for its name near ${r.at.x},${r.at.y} (${namer.fault(r, r.at, first) ?? 'taken'})` };
  };
  const order = [...placed.requests.filter((r) => r.terminal), ...placed.requests.filter((r) => !r.terminal)];
  for (const r of order) {
    const c = namer.first(r);
    if (!c) return failed(r);
    namer.take(c);
  }
  // The nodes the video does not name, from where the model would write them.
  const named = new Set(namer.labels.map((l) => l.node));
  const missing = [...circuit.nodes.values()].filter((n) => !n.ground && !named.has(n.name));
  if (missing.length) {
    const model = reconcile(circuit, { ...placed.drawing, labels: namer.labels.map((l) => ({ ...l })) }, [], NOTEBOOK_OPTIONS);
    for (const n of missing) {
      const at = model.labels.find((l) => l.node === n.name)?.at;
      if (!at) return { node: n.name, why: `${n.text}: the model writes no name for it` };
      const r: NameRequest = { node: n.name, at, terminal: false, text: n.text };
      const c = namer.first(r);
      if (!c) return failed(r);
      namer.take(c);
    }
  }
  return { labels: namer.labels, chosen: namer.chosen };
}

/**
 * The nodes whose names have no free spot in the turned view a phone held upright shows (a copy of
 * src/notebook/turn.ts, turnedBy: the parts' places and the wires turned a quarter, the rails `k`
 * times as far apart, the names' points turned and their spots chosen again), at each stretch; null
 * where something other than names collides there.
 */
function turnBlockers(s: Schematic): (Set<string> | null)[] {
  return [1, 2].map((k) => {
    const turn = (p: Point): Point => pt(-p.y * k, p.x);
    const parts = new Map<string, PartPlacement>();
    const leads: Point[][] = [];
    for (const [key, p] of s.drawing.parts) {
      const placedTurned: PartPlacement = { at: turn(p.at), rot: ((p.rot + 90) % 360) as Rotation, mirror: false };
      parts.set(key, placedTurned);
      const part = partByKey(s.circuit, key);
      if (!part) continue;
      const after = partGeometry(part, placedTurned).pins;
      partGeometry(part, p).pins.forEach((pin, i) => {
        const want = turn(pin);
        const got = after[i]!;
        if (want.x !== got.x || want.y !== got.y) leads.push([got, want]);
      });
    }
    const turned: Drawing = { parts, grounds: [], wires: [...s.drawing.wires.map((w) => w.map(turn)), ...leads], labels: s.drawing.labels.map((l) => ({ node: l.node, at: turn(l.at) })) };
    try {
      const scene = buildScene(s.circuit, reconcile(s.circuit, turned, [], s.options), s.options);
      const nodes = new Set<string>();
      for (const o of findOverlaps(scene)) {
        const label = [o.a, o.b].find((x) => x.kind === 'node-label');
        if (!label) return null;
        nodes.add(label.id.slice(0, label.id.lastIndexOf('#')));
      }
      return nodes;
    } catch {
      return null;
    }
  });
}

const PHONE_RANK: Readonly<Record<PhoneView, number>> = { 'as drawn, drag': 0, 'turned, drag': 1, 'turned, whole': 2, 'fits as drawn': 2 };
/** How much more a name may cost (spotCost and distance) to let a phone turn the drawing: a name the video writes, and one it does not. */
const TURN_REACH = { named: 1, free: 2 } as const;

// ------------------------------------------------------------------ 4. clean, and the smallest k

export interface Checks {
  problems: string[];
  overlaps: string[];
  connectivity: string[];
  /** Parts, wires, ground symbols or labels the model did not keep where the converter put them. */
  moved: string[];
  /** Node names that read as another node's (nameProblems). */
  names: string[];
}

export const isClean = (c: Checks): boolean => !c.problems.length && !c.overlaps.length && !c.connectivity.length && !c.moved.length && !c.names.length;

const placementText = (p: PartPlacement | undefined): string => (p ? `${p.at.x},${p.at.y} ${p.rot}${p.mirror ? ' m' : ''} ${p.side ?? ''}` : 'none');

/** What the model says about a netlist with a drawing block, against the drawing the converter made. */
export function checkDrawn(s: Schematic, wanted?: Pick<Placed, 'drawing' | 'labels'>): Checks {
  const checks: Checks = {
    problems: s.problems.map((p) => p.message),
    overlaps: findOverlaps(s.scene).map((o) => `${o.a.kind} ${o.a.id} / ${o.b.kind} ${o.b.id}`),
    connectivity: checkConnectivity(s.circuit, s.drawing)
      .filter((c) => c.kind !== 'hidden')
      .map((c) => c.message),
    moved: [],
    names: nameProblems(s.scene),
  };
  if (wanted) {
    for (const [key, p] of wanted.drawing.parts) {
      const got = s.drawing.parts.get(key);
      if (placementText(got) !== placementText(p)) checks.moved.push(`${key}: ${placementText(p)} → ${placementText(got)}`);
    }
    if (JSON.stringify(s.drawing.wires) !== JSON.stringify(wanted.drawing.wires)) checks.moved.push('wires redrawn');
    if (JSON.stringify(s.drawing.grounds) !== JSON.stringify(wanted.drawing.grounds)) checks.moved.push('ground symbols moved');
    for (const l of wanted.labels) {
      if (!s.drawing.labels.some((x) => x.node === l.node && x.at.x === l.at.x && x.at.y === l.at.y && x.side === l.side)) checks.moved.push(`label ${l.node} at ${l.at.x},${l.at.y} not kept`);
    }
  }
  return checks;
}

/** The netlist with this drawing's block written in (any earlier block replaced; nothing else changes). */
export function withBlock(text: string, circuit: Circuit, drawing: Drawing): string {
  const base = stripDrawing(text);
  return applyChanges(base, drawingBlockChanges(parseNetlist(base), serializeDrawing(circuit, drawing)));
}

/**
 * Whether the drawing format reads a label's own words (`*@ label 0 14 6 name=b`: a terminal named
 * otherwise than its node, the "b" of the videos on the ground wire). Not in v1 yet (the report's
 * proposal for src/schematic): until it is, the terminal b is left out and reported as a format gap.
 */
export const LABEL_NAMES = !parseDrawingLines([{ text: '*@ label 0 0 0 name=b', line: 1 }]).problems.some((p) => p.kind === 'unknown-field');

export const K_STEP = 0.05;
export const K_MAX = 8;
/**
 * The scale at which PlainSpice's symbols are the size the videos draw theirs, next to the wires
 * (pipeline/schematic.py: a resistor's body 1.0 long, a source's circle 0.72 across, a diamond 0.88;
 * here 2.4, 1.8 and 2.0 grid units): below it a drawing's symbols would crowd its wires more than
 * the video's do, so the search starts here.
 */
export const K_MIN = 2.5;

export interface Conversion {
  id: string;
  plan: ExamplePlan;
  video: Video;
  matches: Match[];
  renamed: string[];
  notDrawn: string[];
  k: number;
  /** The netlist with its block, as the example file should be. */
  text: string;
  block: string[];
  checks: Checks;
  /** A turned drawing for a phone held upright is clean (src/notebook/turn.ts); else the phone shows it as drawn. */
  turned: boolean;
  /** What a Pixel 7 held upright shows when the example opens (phoneView, as src/app/App.tsx decides it). */
  phone: PhoneView;
  /** Room left between two parts in series for the name of the node between them (grid units), by node. */
  gaps: Map<string, number>;
  /** Where each node's name went (nameNodes). */
  chosen: Chosen[];
  notes: string[];
}

/** What a phone held upright shows when a drawing opens: whole as drawn, turned to fit (whole, or still too large), or as drawn and dragged. */
export type PhoneView = 'fits as drawn' | 'turned, whole' | 'turned, drag' | 'as drawn, drag';

/**
 * What a Pixel 7 held upright (412 × 839 CSS pixels, text at 100 %) shows when the drawing opens, as
 * src/app/App.tsx decides it (phoneView): turned when the drawing does not fit at a readable size
 * (minUnitFor), is wide (isWide), has a clean turned view (turnedQuarter), and that view is more than
 * 15 % larger. For the report and the pictures' captions; the app decides for itself.
 */
export function phoneView(s: Schematic, width = 412, height = 839): PhoneView {
  const w = width - 30;
  const h = height - 190;
  const unitOf = (b: Box): number => Math.min(w / Math.max(1e-6, b.x1 - b.x0), h / Math.max(1e-6, b.y1 - b.y0));
  const min = minUnitFor(MIN_TEXT_PX);
  const asDrawn = unitOf(s.scene.bounds);
  if (asDrawn >= min) return 'fits as drawn';
  const t = isWide(s) ? turnedQuarter(s) : undefined;
  if (!t || !(unitOf(t.scene.bounds) > asDrawn * 1.15)) return 'as drawn, drag';
  return unitOf(t.scene.bounds) >= min ? 'turned, whole' : 'turned, drag';
}

const exampleFile = (id: string): string => {
  const manifest = JSON.parse(readFileSync(join(root, 'examples/examples.json'), 'utf8')) as { examples: { id: string; file: string }[] };
  const e = manifest.examples.find((x) => x.id === id);
  if (!e) throw new Error(`examples.json has no ${id}`);
  return join(root, 'examples', e.file);
};

export const readExample = (id: string): string => readFileSync(exampleFile(id), 'utf8');

/** An example ready to be put on the grid at any scale: its video drawing, matched to its netlist. */
export interface Prepared {
  plan: ExamplePlan;
  base: string;
  circuit: Circuit;
  video: Video;
  matches: Match[];
  notDrawn: CircuitPart[];
  renamed: string[];
  /** Where the search for k starts: K_MIN, or more when parts in series need it. */
  kStart: number;
  /** Nodes between two parts in series. */
  jointNodes: Set<string>;
}

export function prepare(plan: ExamplePlan, rec: Recording, text: string = readExample(plan.id)): Prepared {
  const base = stripDrawing(text);
  const circuit = circuitFromNetlist(parseNetlist(base));
  const video = compose(plan, rec);
  snap(video);
  namesOnCopper(video);
  const { matches, notDrawn, renamed } = matchParts(video, circuit);
  const onGround = (t: VLabel): boolean => t.terminal && (t.node === '0' || t.node === 'gnd');
  for (const t of video.labels) {
    if (onGround(t) && !LABEL_NAMES) {
      video.gaps.push(`terminal ${t.text} (on ground, ${t.source}): a label must name its node, and ground is named by its symbol, so the format cannot write “${t.text}” there; the wire to it ends at the last part on it`);
      continue;
    }
    if (!t.terminal && !circuit.nodes.has(nodeName(t.node))) throw new Error(`${plan.id}: the video names a node ${t.text} (${t.source}) that the netlist does not have`);
    if (t.dir === 'UP' || t.dir === 'DOWN') video.gaps.push(`“${t.text}” is written centred ${t.dir === 'UP' ? 'above' : 'below'} its point in the video; the format has no such spot, so it goes ${t.dir === 'UP' ? 'above' : 'below'} and to one side`);
  }
  if (!LABEL_NAMES) video.labels = video.labels.filter((t) => !onGround(t));
  // The smallest k at which every run of parts in series has room, and not below K_MIN: where the search starts.
  let lo = K_MIN;
  const chains = chainsOf(video, matches);
  for (const ch of chains) lo = Math.max(lo, (PIN_SPACING * ch.parts.length - 1) / Math.hypot(ch.to[0] - ch.from[0], ch.to[1] - ch.from[1]));
  const jointNodes = new Set<string>();
  for (const ch of chains) ch.parts.slice(0, -1).forEach(({ m, enter }) => jointNodes.add(nodeName(enter === 'p' ? m.video.nb : m.video.na)));
  return {
    plan,
    base,
    circuit,
    video,
    matches,
    notDrawn,
    renamed,
    kStart: Math.floor(lo / K_STEP) * K_STEP,
    jointNodes,
  };
}

const DIR_WORDS: Readonly<Record<Dir, string>> = {
  UL: 'above and to the left of',
  UR: 'above and to the right of',
  DL: 'below and to the left of',
  DR: 'below and to the right of',
  LEFT: 'to the left of',
  RIGHT: 'to the right of',
  UP: 'centred above',
  DOWN: 'centred below',
};
const SPOT_WORDS: Readonly<Record<NodeSpot, string>> = {
  'above-right': 'above and to the right',
  'above-left': 'above and to the left',
  'below-right': 'below and to the right',
  'below-left': 'below and to the left',
  right: 'on the right',
  left: 'on the left',
  'far-right': 'well to the right',
  'far-left': 'well to the left',
};

/**
 * How well a phone held upright shows the drawing when it opens: its view (phoneView: whole is best),
 * then, when it is turned, how few names there read as another node's (the turned view places the
 * names again, src/notebook/turn.ts).
 */
function phoneScore(s: Schematic): [number, number] {
  const view = phoneView(s);
  const turned = view.startsWith('turned') ? turnedQuarter(s) : undefined;
  return [PHONE_RANK[view], turned ? -nameProblems(turned.scene).length : 0];
}
const betterScore = (a: readonly [number, number], b: readonly [number, number]): boolean => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

/**
 * Names moved for the phone. When the turned view a phone held upright shows (src/notebook/turn.ts)
 * has no room for some names at their points, or writes a name where it reads as another node's,
 * those names try their next clean spots, a little dearer (TURN_REACH), keeping the drawing as drawn
 * clean; a change is kept only when the phone then shows the drawing better (phoneScore). Undefined
 * when nothing better is found.
 */
function turnFriendly(pr: Prepared, placed: Placed, chosen: readonly Chosen[], s: Schematic): { s: Schematic; chosen: Chosen[] } | undefined {
  const { base, circuit } = pr;
  const build = (cs: readonly Chosen[]): Schematic | undefined => {
    const drawing: Drawing = { ...placed.drawing, labels: cs.map(labelOf) };
    const t = buildSchematic(withBlock(base, circuit, drawing), NOTEBOOK_OPTIONS);
    return isClean(checkDrawn(t, { drawing, labels: drawing.labels })) ? t : undefined;
  };
  /** A name's next clean spots within its reach, each with the drawing it gives. */
  const alternatives = function* (cs: readonly Chosen[], node: string): Generator<{ cs: Chosen[]; t: Schematic }> {
    const i = cs.findIndex((c) => c.request.node === node);
    const current = cs[i];
    if (!current) return;
    const namer = makeNamer(pr, placed);
    if (typeof namer === 'string') return;
    for (const c of cs) if (c !== current) namer.take(c);
    const reach = current.request.dir ? TURN_REACH.named : TURN_REACH.free;
    for (const alt of namer.candidates(current.request)) {
      if (alt.cost > current.cost + reach + 1e-9) break;
      if ((alt.at.x === current.at.x && alt.at.y === current.at.y && alt.spot === current.spot) || namer.fault(current.request, alt.at, alt.spot)) continue;
      const next = cs.slice();
      next[i] = { ...current, at: alt.at, spot: alt.spot, cost: alt.cost };
      const t = build(next);
      if (t) yield { cs: next, t };
    }
  };
  let best = { s, chosen: chosen.slice(), score: phoneScore(s) };
  let changed = false;
  // 1. No turned view: free the names that have no room once turned, one after the other, at either stretch.
  if (!turnedQuarter(s) && best.score[0] < 2) {
    for (const stretch of turnBlockers(s)) {
      if (!stretch?.size) continue;
      let cs = chosen.slice();
      let t: Schematic | undefined = s;
      for (const node of stretch) {
        let fixed: { cs: Chosen[]; t: Schematic } | undefined;
        for (const alt of alternatives(cs, node)) {
          if (turnBlockers(alt.t).some((b) => b !== null && !b.has(node))) {
            fixed = alt;
            break;
          }
        }
        if (!fixed) {
          t = undefined;
          break;
        }
        ({ cs, t } = fixed);
      }
      if (t && turnedQuarter(t)) {
        const score = phoneScore(t);
        if (betterScore(score, best.score)) {
          best = { s: t, chosen: cs, score };
          changed = true;
          break;
        }
      }
    }
  }
  // 2. Turned: the names there that read as another node's, each moved while that helps.
  for (let round = 0; round < 4; round++) {
    const turned = phoneView(best.s).startsWith('turned') ? turnedQuarter(best.s) : undefined;
    const bad = turned ? [...new Set(nameProblems(turned.scene).map((m) => turned.scene.nodeLabels.find((l) => m.startsWith(`${l.text} at ${l.at.x},${l.at.y} `))?.node).filter((n): n is string => !!n))] : [];
    let improved = false;
    for (const node of bad) {
      for (const alt of alternatives(best.chosen, node)) {
        const score = phoneScore(alt.t);
        if (betterScore(score, best.score)) {
          best = { s: alt.t, chosen: alt.cs, score };
          improved = changed = true;
          break;
        }
      }
      if (improved) break;
    }
    if (!improved) break;
  }
  return changed ? { s: best.s, chosen: best.chosen } : undefined;
}

/** The example drawn at scale k, or why it is not clean there. */
export function attempt(pr: Prepared, k: number): Conversion | string {
  const { plan, base, circuit, video, matches } = pr;
  const gaps = new Map<string, number>();
  let found: { placed: Placed; s: Schematic; chosen: Chosen[] } | undefined;
  for (let round = 0; round < 24 && !found; round++) {
    const placed = place(video, matches, k, gaps);
    if (typeof placed === 'string') return placed;
    const named = nameNodes(pr, placed, gaps);
    if (!('labels' in named)) {
      // A name between two parts in series: the parts slide apart to make room for it.
      if (named.need !== undefined) {
        gaps.set(named.node, named.need);
        continue;
      }
      return named.why;
    }
    placed.drawing.labels = named.labels;
    placed.labels = named.labels;
    const s = buildSchematic(withBlock(base, circuit, placed.drawing), NOTEBOOK_OPTIONS);
    const checks = checkDrawn(s, placed);
    if (!isClean(checks)) return [...checks.problems, ...checks.overlaps, ...checks.connectivity, ...checks.moved, ...checks.names].slice(0, 3).join('; ');
    found = { placed, s, chosen: named.chosen };
  }
  if (!found) return 'no room between the parts in series';
  const { placed } = found;
  let { s, chosen } = found;
  // The phone: when its turned view has no room for a name, another clean spot near it, if one lets
  // a phone held upright show more of the drawing when it opens.
  const better = turnFriendly(pr, placed, chosen, s);
  if (better) ({ s, chosen } = better);
  // The model's drawing, the names in the netlist's order of the nodes (as the automatic layout
  // writes them): a fixed point.
  const order = [...circuit.nodes.keys()];
  s.drawing.labels.sort((a, b) => order.indexOf(a.node) - order.indexOf(b.node));
  const block = serializeDrawing(s.circuit, s.drawing, s.kept);
  const final = applyChanges(base, drawingBlockChanges(parseNetlist(base), block));
  const again = buildSchematic(final, NOTEBOOK_OPTIONS);
  const finalChecks = checkDrawn(again, { drawing: s.drawing, labels: s.drawing.labels });
  if (!isClean(finalChecks) || serializeDrawing(again.circuit, again.drawing, again.kept).join('\n') !== block.join('\n')) {
    throw new Error(`${plan.id}: the drawing at k = ${k} is not a fixed point`);
  }
  const notes = [...video.notes];
  if (placed.notes.includes('wire ends that lead nowhere')) notes.push('Wire ends that lead nowhere once the drawing is on the grid are cut back, as the model does.');
  for (const [node, gap] of gaps) notes.push(`Room left between the two parts in series on ${node} for its name: ${gap} grid units (the parts slide apart along their wire, each as near as it can be to where the video draws it).`);
  // Where the names went, when not where the video writes them.
  const unnamed: string[] = [];
  for (const c of chosen) {
    const r = c.request;
    const label = r.text === r.node || r.own ? r.text : `${r.text} (${r.node} here)`;
    const d = Math.hypot(c.at.x - r.at.x, c.at.y - r.at.y);
    const along = d ? `, at a point ${Math.round(d * 10) / 10} grid unit${d === 1 ? '' : 's'} along its wire,` : '';
    if (!r.dir) {
      unnamed.push(`${label} ${SPOT_WORDS[c.spot]} of ${c.at.x},${c.at.y}`);
      continue;
    }
    const first = DIR_SPOTS[r.dir][0]!;
    if (!d && c.spot === first) continue;
    const because = c.why ? ` (the video’s spot here is ${c.why})` : '';
    notes.push(`${label}: the video writes it ${DIR_WORDS[r.dir]} its point; here it goes ${SPOT_WORDS[c.spot]}${along ? along.slice(0, -1) : ''}${because}.`);
  }
  if (unnamed.length) notes.push(`Names the video does not write, each beside its own wire on a free spot near where the model would write it (on the right when there is room): ${unnamed.join('; ')}.`);
  for (const t of video.labels.filter((l) => l.terminal)) {
    const at = placed.labels.find((l) => l.node === nodeName(t.node))?.at;
    if (at && !again.scene.terminals.some((x) => x.at.x === at.x && x.at.y === at.y)) {
      video.gaps.push(`terminal ${t.text}: the video draws its ring with ${plan.inWires?.length ? 'the short' : 'the test source'} attached; the model draws a ring only at an open end, so ${t.text} is written as a name on the wire there`);
    }
  }
  return {
    id: plan.id,
    plan,
    video,
    matches,
    renamed: pr.renamed,
    notDrawn: pr.notDrawn.map((p) => p.name),
    k,
    text: final,
    block,
    checks: finalChecks,
    turned: turnedQuarter(again) !== undefined,
    phone: phoneView(again),
    gaps,
    chosen,
    notes,
  };
}

/** The scales the search tries, from `from` up to K_MAX. */
export function* scales(from: number): Generator<number> {
  for (let k = from; k <= K_MAX + 1e-9; k = Math.round((k + K_STEP) * 100) / 100) yield k;
}

/**
 * Spans that are equal in the video and unequal on the grid at scale k (rounding: a load the video
 * draws midway between two sources comes out 6 and 7 units from them): how many pairs.
 */
export function asymmetry(pr: Prepared, k: number): number {
  const v = pr.video;
  const xs = new Set<number>();
  const ys = new Set<number>();
  const at = (p: XY): void => {
    xs.add(Math.round(p[0] * 1e6) / 1e6);
    ys.add(Math.round(p[1] * 1e6) / 1e6);
  };
  for (const p of v.parts) {
    at(p.p);
    at(p.q);
  }
  for (const w of v.wires) w.pts.forEach(at);
  let n = 0;
  for (const [set, sign] of [
    [xs, 1],
    [ys, -1],
  ] as const) {
    const vals = [...set].sort((a, b) => a - b);
    const spans = vals.slice(1).map((b, i) => ({ d: b - vals[i]!, grid: Math.abs(Math.round(sign * k * b) - Math.round(sign * k * vals[i]!)) }));
    for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) if (Math.abs(spans[i]!.d - spans[j]!.d) < 1e-6 && spans[i]!.grid !== spans[j]!.grid) n += 1;
  }
  return n;
}

/** How much larger than the smallest clean scale k may be to keep the video's equal spans equal. */
export const SYMMETRY_REACH = 0.1;
/**
 * How much larger than the smallest clean scale k may be so that a phone held upright shows the whole
 * drawing when it opens (turned to fit, or as drawn) instead of a part of it to drag.
 */
export const PHONE_REACH = 0.4;

const whole = (c: Conversion): boolean => c.phone === 'turned, whole' || c.phone === 'fits as drawn';

/** How many of the names the video writes go on another side than the video's (DIR_SPOTS), in a conversion. */
export const offSide = (c: Conversion): number => c.chosen.filter((x) => x.request.dir && !DIR_SPOTS[x.request.dir].includes(x.spot)).length;

/**
 * The scale for examples drawn at one scale: the smallest at which every one is clean; or, up to
 * PHONE_REACH more, the smallest at which more of them open whole on a phone held upright and, of
 * those, more of the names the video writes stay on the video's side (offSide); then up to
 * SYMMETRY_REACH more when that keeps more of the video's equal spans equal on the grid (and opens as
 * many whole, with as many names on the video's side).
 */
function chooseScale(prs: readonly Prepared[]): { k: number; conversions: Conversion[] } | string {
  const tryAt = (k: number): Conversion[] | string => {
    const out: Conversion[] = [];
    for (const pr of prs) {
      const c = attempt(pr, k);
      if (typeof c === 'string') return `${pr.plan.id}: ${c}`;
      out.push(c);
    }
    return out;
  };
  let reasons = '';
  let k0: number | undefined;
  for (const k of scales(Math.max(...prs.map((m) => m.kStart)))) {
    const first = tryAt(k);
    if (typeof first !== 'string') {
      k0 = k;
      break;
    }
    reasons = first;
  }
  if (k0 === undefined) return reasons;
  const clean: { k: number; conversions: Conversion[]; whole: number; off: number; asym: number }[] = [];
  for (const k of scales(k0)) {
    if (k > k0 + PHONE_REACH + SYMMETRY_REACH + 1e-9) break;
    const cs = tryAt(k);
    if (typeof cs !== 'string') clean.push({ k, conversions: cs, whole: cs.filter(whole).length, off: cs.reduce((n, c) => n + offSide(c), 0), asym: prs.reduce((n, pr) => n + asymmetry(pr, k), 0) });
  }
  const reach = clean.filter((c) => c.k <= k0 + PHONE_REACH + 1e-9);
  const most = Math.max(...reach.map((c) => c.whole));
  const fewest = Math.min(...reach.filter((c) => c.whole === most).map((c) => c.off));
  const same = (c: (typeof clean)[number]): boolean => c.whole === most && c.off === fewest;
  const kp = clean.find(same)!;
  const best = clean.filter((c) => c.k >= kp.k && c.k <= kp.k + SYMMETRY_REACH + 1e-9 && same(c)).reduce((a, b) => (b.asym < a.asym ? b : a), kp);
  return { k: best.k, conversions: best.conversions };
}

/**
 * One example: its video drawing at the smallest clean k (chooseScale; with the other examples of its
 * scaleGroup, the smallest at which all are clean), as the netlist with its block. Whether its turned
 * view for a phone held upright is clean too is reported (`turned`, `phone`), not required: the
 * video's drawings are less long and low than the automatic layout's ladders, so turning them gains
 * little (the app turns a drawing only when that makes it at least 15 % larger on the phone), and the
 * larger k it would take shrinks the drawing everywhere else.
 */
export function convert(plan: ExamplePlan, rec: Recording, text: string = readExample(plan.id)): Conversion {
  if (plan.scaleGroup) {
    const k = groupScale(plan.scaleGroup, rec);
    const c = attempt(prepare(plan, rec, text), k);
    if (typeof c === 'string') throw new Error(`${plan.id}: not clean at its group’s scale ${k} (${c})`);
    return c;
  }
  const chosen = chooseScale([prepare(plan, rec, text)]);
  if (typeof chosen === 'string') throw new Error(`${plan.id}: no clean drawing up to k = ${K_MAX} (last: ${chosen})`);
  return chosen.conversions[0]!;
}

const groupScales = new WeakMap<Recording, Map<string, number>>();

/**
 * The scale of examples that show one drawing of a video (plan.scaleGroup: a netlist and its version
 * with a 0 V source or a test source added, say): the smallest at which every one of them is clean
 * (chooseScale), so the circuit keeps its size and place from one example to the next.
 */
export function groupScale(group: string, rec: Recording): number {
  let byGroup = groupScales.get(rec);
  if (!byGroup) groupScales.set(rec, (byGroup = new Map()));
  const known = byGroup.get(group);
  if (known !== undefined) return known;
  const chosen = chooseScale(PLANS.filter((p) => p.scaleGroup === group).map((p) => prepare(p, rec)));
  if (typeof chosen === 'string') throw new Error(`the examples of ${group} have no scale up to ${K_MAX} at which they are all clean (last: ${chosen})`);
  byGroup.set(group, chosen.k);
  return chosen.k;
}

/** Every example with a plan. */
export function convertAll(rec: Recording = readRecording(), only?: string): Conversion[] {
  return PLANS.filter((p) => !only || p.id === only).map((p) => convert(p, rec));
}

// ------------------------------------------------------------------ the report and the command line

export function report(cs: readonly Conversion[]): string {
  const out: string[] = ['| Example | Video drawing | k | Parts named otherwise in the video | Checks | A phone held upright (Pixel 7) shows it |', '|---|---|---|---|---|---|'];
  for (const c of cs) {
    const checks = isClean(c.checks) ? 'clean' : 'NOT clean';
    out.push(`| ${c.id} | ${c.plan.drawing} | ${c.k.toFixed(2)}${c.plan.scaleGroup ? ` (${c.plan.scaleGroup})` : ''} | ${c.renamed.join(', ') || '—'} | ${checks} | ${c.phone} |`);
  }
  out.push('');
  for (const c of cs) {
    out.push(`### ${c.id} (k = ${c.k.toFixed(2)})`, '', c.plan.drawing + '.', '');
    for (const n of c.notes) out.push(`- ${n}`);
    for (const gap of new Set(c.video.gaps)) out.push(`- Format gap: ${gap}.`);
    if (c.notDrawn.length) out.push(`- Not in the video’s drawing, placed by the model: ${c.notDrawn.join(', ')}.`);
    out.push('');
  }
  return out.join('\n');
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename;
if (isMain) {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
  const write = args.includes('--write');
  const cs = convertAll(readRecording(), only);
  let differ = 0;
  for (const c of cs) {
    const file = exampleFile(c.id);
    const now = readFileSync(file, 'utf8');
    if (now === c.text) continue;
    if (write) {
      writeFileSync(file, c.text);
      console.log(`wrote ${c.id} (k = ${c.k})`);
    } else {
      differ += 1;
      console.log(`${c.id}: the block differs from what the converter makes (k = ${c.k}); run with --write`);
    }
  }
  if (args.includes('--report')) console.log(report(cs));
  else for (const c of cs) console.log(`${c.id}: k = ${c.k.toFixed(2)}, ${isClean(c.checks) ? 'clean' : 'NOT clean'}; a phone held upright shows it ${c.phone}`);
  process.exit(differ ? 1 : 0);
}
