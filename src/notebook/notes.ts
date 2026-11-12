/**
 * Red pen on the drawing, as in the prototype: a check's title written next to the part it is about
 * (its misread value circled by the drawing), the reason there are no numbers ("No single answer at
 * node n1") next to the node ngspice points at, and, while a card is open, each node's voltage from
 * before the change, crossed out next to the new one. The words are the model's (traps.ts,
 * describe.ts) and formatSI's; this file only finds where they go: free paper next to what they are
 * about (place.ts), never over a symbol, a word or a wire, and nowhere when there is no room (the
 * card and the Checks panel still say it). Grid units. Plain TypeScript.
 */
import { GROUND, boxesOverlap, inflate, segmentCrossesBox, unionBoxes, type Box, type Point, type Scene } from '../schematic/index.ts';
import { TYPE, resultWidth, widthIn } from './measure.ts';
import { placeBeside, segmentsIntersect, symbolBoxes, wireSegments, wordBoxes, type Room, type Side } from './place.ts';
import { markBox as drawnBox, nameShift, type DrawingResults, type ResultMark } from './results.ts';

/** Size of a note's words and its line height, in grid units (a little smaller than the results). */
export const NOTE_SIZE = 0.8;
export const NOTE_LINE = 0.95;
/** How wide a note may be before it wraps, in grid units. */
export const NOTE_WIDTH = 9;
/** A crossed-out old value is written this much smaller than the results. */
export const WAS_SCALE = 0.78;

/** The width of words in a note: the wider of the handwriting and the plain font at NOTE_SIZE. */
export const noteWidth = (text: string): number =>
  Math.max(widthIn(text, { ...TYPE.hand, size: NOTE_SIZE }), widthIn(text, { ...TYPE.plain, size: (TYPE.plain.size * NOTE_SIZE) / TYPE.hand.size }));

/**
 * The words broken into lines no wider than `max` (a word longer than that gets a line of its own).
 * A number stays with the word after it ("1 megaohm", "(1 mΩ)"), as a reader takes them in.
 */
export function wrapWords(text: string, max: number, width: (s: string) => number = noteWidth): string[] {
  const out: string[] = [];
  let line = '';
  const words: string[] = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const last = words[words.length - 1];
    if (last !== undefined && /\d$/.test(last)) words[words.length - 1] = `${last} ${w}`;
    else words.push(w);
  }
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && width(next) > max) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

export interface PenNote {
  /** What it says, for a key and for screen readers (the drawing hides it: the page says it too). */
  text: string;
  /** Its lines, left-aligned: x of the start, y of the middle (grid units). */
  lines: { text: string; x: number; y: number }[];
  box: Box;
  /** What it is about: a part's symbol or a node's name. */
  about: Box;
  /** A short stroke from the note to what it is about, when they are not side by side. */
  arrow?: { from: Point; to: Point };
}

/** The drawing's symbols, words and wires: what a mark on it must stay clear of. */
export function sceneRoom(scene: Scene, area: Box, avoid: readonly Box[] = []): Room {
  return { area, boxes: [...wordBoxes(scene), ...symbolBoxes(scene), ...avoid], segments: wireSegments(scene) };
}

export interface NoteOptions {
  /** Where it may go (default: the drawing's box, with a little paper around it). */
  area?: Box;
  /** More things to keep clear of (the open card, other notes), grid units. */
  avoid?: readonly Box[];
  sides?: readonly Side[];
}

/** Widths a note may wrap to, widest first: a narrower, taller note fits between the parts. */
const WRAPS = [NOTE_WIDTH, 7, 5.6];

/**
 * A note in red pen next to `about`, or undefined when the drawing has no room for it: the nearest
 * free paper on any side, wrapped narrower if that brings it nearer. A note away from what it is
 * about gets a short stroke to it, only when the stroke crosses no word and no wire.
 */
export function placeNote(scene: Scene, about: Box, text: string, options: NoteOptions = {}): PenNote | undefined {
  const area = options.area ?? inflate(scene.bounds, 2);
  const room = sceneRoom(scene, area, options.avoid);
  let best: { lines: string[]; box: Box; d: number } | undefined;
  for (const width of WRAPS) {
    const lines = wrapWords(text, width);
    const w = Math.max(...lines.map(noteWidth)) + 0.2;
    const h = lines.length * NOTE_LINE + 0.1;
    // The nearest free paper on any side (above first when it is as near), never far along one side.
    const p = placeBeside(about, w, h, room, { gap: 0.35, sides: options.sides ?? ['above', 'below', 'right', 'left'], step: 0.25, reach: 6, sidePenalty: 0.75 });
    if (!p || p.cost > 0) continue;
    const d = distance(p.box, about);
    // A line more costs a little: prefer the wider note when it is about as near.
    if (!best || d + 0.3 * lines.length < best.d + 0.3 * best.lines.length) best = { lines, box: p.box, d };
    if (d <= 0.6) break;
  }
  if (!best) return undefined;
  const box = best.box;
  const note: PenNote = {
    text,
    lines: best.lines.map((t, i) => ({ text: t, x: box.x0 + 0.1, y: box.y0 + 0.05 + NOTE_LINE * (i + 0.5) })),
    box,
    about,
  };
  // Away from what it is about: a short stroke to it, from the note's nearest edge, if it crosses nothing.
  if (best.d > 1.2) {
    const from = nearestEdgePoint(box, centre(about));
    const to = nearestEdgePoint(inflate(about, 0.2), centre(box));
    const crosses = room.boxes.some((b) => b !== about && segmentCrossesBox(from, to, b) && !boxesOverlap(b, inflate(about, 0.25))) || room.segments.some(([a, b]) => segmentsIntersect(from, to, a, b));
    if (!crosses) note.arrow = { from, to };
  }
  return note;
}

const centre = (b: Box): Point => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
const nearestEdgePoint = (b: Box, p: Point): Point => ({ x: Math.max(b.x0, Math.min(b.x1, p.x)), y: Math.max(b.y0, Math.min(b.y1, p.y)) });
function distance(a: Box, b: Box): number {
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
  const dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
  return Math.hypot(dx, dy);
}

/** What a part's note is about: its symbol and its words. */
export function partBox(scene: Scene, key: string): Box | undefined {
  const p = scene.parts.find((x) => x.key === key);
  return p ? unionBoxes([p.box, p.labelBox]) : undefined;
}

/** What a node's note is about: its name (ground: its first symbol). */
export function nodeBox(scene: Scene, node: string): Box | undefined {
  if (node === GROUND) return scene.grounds[0]?.box;
  return scene.nodeLabels.find((l) => l.node === node)?.box;
}

// ------------------------------------------------------------------ crossed-out values

export interface WasMark {
  node: string;
  /** The voltage before the change, as it was written. */
  text: string;
  /** Where it is written: x of its start, y of its middle (grid units), and its box. */
  x: number;
  y: number;
  box: Box;
}

/**
 * Each node voltage that changed since `before`, written crossed out next to the new one: above it,
 * else below, else beside it, wherever the drawing is free; nodes with no room get none.
 */
export function wasMarks(scene: Scene, now: DrawingResults, before: DrawingResults | undefined, avoid: readonly Box[] = []): WasMark[] {
  if (!before) return [];
  const out: WasMark[] = [];
  const oldText = new Map(before.nodes.map((n) => [n.node, n.words.text]));
  for (const n of now.nodes) {
    const text = oldText.get(n.node);
    if (!n.mark || !text || text === n.words.text) continue;
    const w = resultWidth(text) * WAS_SCALE + 0.1;
    const h = 0.8;
    const room = sceneRoom(scene, inflate(scene.bounds, 2), [...avoid, ...out.map((m) => m.box)]);
    // Next to the new value where it is drawn (a name on the left of its point is drawn up to it, nameShift).
    const label = scene.nodeLabels[n.label];
    const dx = label ? nameShift(label, n.mark) : 0;
    const drawn = drawnBox(n.mark);
    const target = dx ? { ...drawn, x0: drawn.x0 + dx, x1: drawn.x1 + dx } : markBox(n.mark);
    const p = placeBeside(target, w, h, room, { gap: 0.02, sides: ['above', 'below', 'right'], step: 0.1, reach: 0.6 });
    if (!p || p.cost > 0) continue;
    out.push({ node: n.node, text, x: p.box.x0 + 0.05, y: (p.box.y0 + p.box.y1) / 2, box: p.box });
  }
  return out;
}

/** The box a result mark's words take (its line's room, which holds any value). */
function markBox(m: ResultMark): Box {
  return m.line.box;
}
