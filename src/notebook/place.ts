/**
 * Finding room on the paper: where a box goes next to what it belongs to (a part's index card, a
 * note in red pen, a crossed-out value), clear of the drawing's symbols, words and wires and of the
 * page's own panels. The same search works in screen pixels (the card) and in grid units (marks on
 * the drawing). Plain TypeScript: the canvas and the page measure, this decides.
 *
 * The card (Tarık's checkpoint, critique 1 and 2): it never changes the zoom. It goes beside its
 * part where the paper is free; if no side is free but the drawing leaves room above and below it
 * (or left and right) together, the drawing is panned once so that it is; only then does it cover
 * some of the drawing, and never the part itself. A line joins it to the part only when the line
 * would touch no word and no wire; otherwise the card's notch and the part's highlight say which.
 */
import { boxesOverlap, segmentCrossesBox, segmentsOf, unionBoxes, type Box, type Point, type Scene } from '../schematic/index.ts';
import type { View } from './fit.ts';

export type Side = 'above' | 'below' | 'left' | 'right';

/** What a box must stay clear of, and where it may go. */
export interface Room {
  /** Where the box may go: it must lie inside. */
  area: Box;
  /** Boxes it must not cover (symbols, words). */
  boxes: readonly Box[];
  /** Pieces of wire it must not cover. */
  segments: readonly (readonly [Point, Point])[];
  /** Boxes it may never cover, at any cost (the part a card belongs to). */
  never?: readonly Box[];
}

export interface Placement {
  box: Box;
  side: Side;
  /** How much of what it should stay clear of it covers: 0 when it covers nothing. */
  cost: number;
}

export interface BesideOptions {
  /** The space between the target and the box. */
  gap: number;
  /** The sides to try, best first (default: above, below, right, left). */
  sides?: readonly Side[];
  /** How far apart the positions tried are (default: a twentieth of the box's smaller side). */
  step?: number;
  /** How far from the target the box may go (default: anywhere in the area). */
  reach?: number;
  /**
   * How much further a place on the next side may be and still win (default: no amount: the first
   * side with room wins, however far along it). A note prefers the nearest free paper on any side.
   */
  sidePenalty?: number;
  /** Only a place that covers nothing: none when every place covers something (the least is then not looked for). */
  freeOnly?: boolean;
}

const width = (b: Box): number => b.x1 - b.x0;
const height = (b: Box): number => b.y1 - b.y0;
const overlapArea = (a: Box, b: Box): number => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const inside = (b: Box, area: Box): boolean => b.x0 >= area.x0 - 1e-9 && b.y0 >= area.y0 - 1e-9 && b.x1 <= area.x1 + 1e-9 && b.y1 <= area.y1 + 1e-9;
export const moveBy = (b: Box, dx: number, dy: number): Box => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });

/**
 * A room's boxes and wires filed by the squares of a grid (made once for a room, which is never
 * changed once made): `covers` looks only at what is near a box.
 */
class Near {
  private readonly size: number;
  private readonly cells = new Map<number, number[]>();
  /** What covers too many squares to file: looked at every time. */
  private readonly big: number[] = [];

  constructor(room: Room) {
    this.size = Math.max(1e-6, Math.max(width(room.area), height(room.area)) / 64);
    room.boxes.forEach((b, i) => this.file(b, i));
    room.segments.forEach(([a, b], i) => this.file({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }, -1 - i));
  }

  /** The squares a box covers (undefined: too many, or not finite). */
  private squares(b: Box): { x0: number; x1: number; y0: number; y1: number } | undefined {
    const q = { x0: Math.floor(b.x0 / this.size), x1: Math.floor(b.x1 / this.size), y0: Math.floor(b.y0 / this.size), y1: Math.floor(b.y1 / this.size) };
    return (q.x1 - q.x0 + 1) * (q.y1 - q.y0 + 1) <= 4096 ? q : undefined;
  }

  private file(b: Box, id: number): void {
    const q = this.squares(b);
    if (!q) {
      this.big.push(id);
      return;
    }
    for (let x = q.x0; x <= q.x1; x++) for (let y = q.y0; y <= q.y1; y++) (this.cells.get(x * 65536 + y) ?? this.cells.set(x * 65536 + y, []).get(x * 65536 + y)!).push(id);
  }

  /** True when one of the room's boxes or wires is in the box's way (what coverCost counts). */
  covers(box: Box, room: Room): boolean {
    const hit = (id: number): boolean => {
      if (id >= 0) return boxesOverlap(box, room.boxes[id]!);
      const [a, b] = room.segments[-1 - id]!;
      return segmentCrossesBox(a, b, box);
    };
    if (this.big.some(hit)) return true;
    const q = this.squares(box);
    if (!q) return room.boxes.some((_, i) => hit(i)) || room.segments.some((_, i) => hit(-1 - i));
    for (let x = q.x0; x <= q.x1; x++) for (let y = q.y0; y <= q.y1; y++) if (this.cells.get(x * 65536 + y)?.some(hit)) return true;
    return false;
  }
}

const near = new WeakMap<Room, Near>();

/** True when `box` covers something of the room (coverCost is not 0), looking only near it. */
function covers(box: Box, room: Room): boolean {
  for (const n of room.never ?? []) if (boxesOverlap(box, n)) return true;
  let grid = near.get(room);
  if (!grid) near.set(room, (grid = new Near(room)));
  return grid.covers(box, room);
}

/**
 * coverCost, summed in the same order, but stopping once the sum reaches `bound`: below `bound` it is
 * coverCost; otherwise it is no less than `bound` (the parts summed, which never decrease the sum).
 */
function coverCostBelow(box: Box, room: Room, bound: number): number {
  for (const n of room.never ?? []) if (boxesOverlap(box, n)) return Infinity;
  let cost = 0;
  for (const b of room.boxes) {
    if (!boxesOverlap(box, b)) continue;
    cost += 1 + overlapArea(box, b);
    if (cost >= bound) return cost;
  }
  for (const [a, b] of room.segments) {
    if (!segmentCrossesBox(a, b, box)) continue;
    cost += 1;
    if (cost >= bound) return cost;
  }
  return cost;
}

/** How much of the room's boxes and wires `box` covers (0: none; Infinity: a box it may never cover). */
export function coverCost(box: Box, room: Room): number {
  for (const n of room.never ?? []) if (boxesOverlap(box, n)) return Infinity;
  let cost = 0;
  for (const b of room.boxes) if (boxesOverlap(box, b)) cost += 1 + overlapArea(box, b);
  for (const [a, b] of room.segments) if (segmentCrossesBox(a, b, box)) cost += 1;
  return cost;
}

/**
 * The best place for a box `w` × `h` beside `target`, `gap` away: on the first side that has room,
 * as near the target's middle as it can be; when no side has room, where it covers least.
 */
export function placeBeside(target: Box, w: number, h: number, room: Room, options: BesideOptions): Placement | undefined {
  const sides = options.sides ?? ['above', 'below', 'right', 'left'];
  const step = options.step ?? Math.max(1e-3, Math.min(w, h) / 20);
  const { area } = room;
  const { gap } = options;
  const reach = options.reach ?? Math.max(width(area), height(area));
  const cx = (target.x0 + target.x1) / 2;
  const cy = (target.y0 + target.y1) / 2;
  type Candidate = { box: Box; side: Side; rank: number; distance: number };
  // The first side with room wins, on it the nearest place; or, with a side penalty, the nearest place on any side.
  const pen = options.sidePenalty;
  const order = pen === undefined ? (p: Candidate, q: Candidate): number => p.rank - q.rank || p.distance - q.distance : (p: Candidate, q: Candidate): number => p.distance + p.rank * pen - (q.distance + q.rank * pen);
  const keyOf = (distance: number, rank: number): number => (pen === undefined ? distance : distance + rank * pen);
  // Away from the target (as near as the gap first), and along its side (its middle first).
  const awaySteps = Math.max(0, Math.floor(reach / step));
  const alongStepsOf = (side: Side): number => Math.ceil((side === 'above' || side === 'below' ? width(area) : height(area)) / step);
  /**
   * The places of the sides `ranks` whose order key is in (lo, hi], in the order they are made: side,
   * then away, then along (from one end to the other). The key grows with the distance along, so the
   * steps along that fall in the band are found by halving, not by making every place.
   */
  const band = (ranks: readonly number[], lo: number, hi: number): Candidate[] => {
    const out: Candidate[] = [];
    for (const rank of ranks) {
      const side = sides[rank]!;
      const alongSteps = alongStepsOf(side);
      for (let a = 0; a <= awaySteps; a++) {
        const away = gap + a * step;
        const key = (s: number): number => keyOf(a * step + Math.abs(s * step), rank);
        /** The first step along, from 0, whose key is above `k` (alongSteps + 1 when none is). */
        const above = (k: number): number => {
          let l = 0;
          let r = alongSteps + 1;
          while (l < r) {
            const m = Math.floor((l + r) / 2);
            if (key(m) > k) r = m;
            else l = m + 1;
          }
          return l;
        };
        const first = above(lo);
        const last = above(hi) - 1;
        if (first > last) continue;
        const add = (s: number): void => {
          const shift = s * step;
          let box: Box;
          if (side === 'above') box = { x0: cx - w / 2 + shift, y0: target.y0 - away - h, x1: cx + w / 2 + shift, y1: target.y0 - away };
          else if (side === 'below') box = { x0: cx - w / 2 + shift, y0: target.y1 + away, x1: cx + w / 2 + shift, y1: target.y1 + away + h };
          else if (side === 'right') box = { x0: target.x1 + away, y0: cy - h / 2 + shift, x1: target.x1 + away + w, y1: cy + h / 2 + shift };
          else box = { x0: target.x0 - away - w, y0: cy - h / 2 + shift, x1: target.x0 - away, y1: cy + h / 2 + shift };
          if (inside(box, area)) out.push({ box, side, rank, distance: a * step + Math.abs(shift) });
        };
        for (let s = -last; s <= -Math.max(first, 1); s++) add(s);
        for (let s = first; s <= last; s++) add(s);
      }
    }
    return out;
  };
  // The places in order of their key, a band of keys at a time (each twice as wide as the one before),
  // each band put in order as all the places were: the same order, but only the places up to the first
  // free one are made and sorted. Making every place first grew with the paper, not with what is
  // drawn: a note on a drawing that reaches ±2000 made and sorted three million places (second
  // re-check). With no side penalty, each side's places come before the next side's.
  const longest = awaySteps * step + Math.max(...sides.map(alongStepsOf)) * step;
  const top = keyOf(longest, sides.length - 1) * (1 + 1e-9) + step;
  const lazy = step > 0 && Number.isFinite(top);
  const groups = pen === undefined ? sides.map((_, r) => [r]) : [sides.map((_, r) => r)];
  const made: Candidate[][] = [];
  for (const ranks of groups) {
    let lo = -Infinity;
    for (let hi = 8 * step; ; hi *= 2) {
      const upTo = !lazy || hi >= top ? Infinity : hi;
      const list = band(ranks, lo, upTo);
      list.sort(order);
      // The first place that covers nothing, found by looking near each place and stopping at the first
      // thing it covers (on a drawing at the format's limits, summing each place's whole cover took two
      // seconds a click; second re-check, P2).
      for (const c of list) if (!covers(c.box, room)) return { box: c.box, side: c.side, cost: 0 };
      if (!options.freeOnly) made.push(list);
      if (upTo === Infinity) break;
      lo = upTo;
    }
  }
  if (options.freeOnly) return undefined;
  // Only when every place covers something is each one's cover summed, for the least, each sum
  // stopping once it is no less than the least so far.
  let best: Placement | undefined;
  for (const list of made) {
    for (const c of list) {
      const cost = coverCostBelow(c.box, room, best ? best.cost : Infinity);
      if (!best || cost < best.cost) best = { box: c.box, side: c.side, cost };
    }
  }
  return best && Number.isFinite(best.cost) ? best : undefined;
}

// ------------------------------------------------------------------ the drawing in screen pixels

/** A grid box on the screen. */
export const boxOnScreen = (view: View, b: Box): Box => ({ x0: view.x + b.x0 * view.unit, y0: view.y + b.y0 * view.unit, x1: view.x + b.x1 * view.unit, y1: view.y + b.y1 * view.unit });
/** A screen box on the grid. */
export const boxOnGrid = (view: View, b: Box): Box => ({ x0: (b.x0 - view.x) / view.unit, y0: (b.y0 - view.y) / view.unit, x1: (b.x1 - view.x) / view.unit, y1: (b.y1 - view.y) / view.unit });
const pointOnScreen = (view: View, p: Point): Point => ({ x: view.x + p.x * view.unit, y: view.y + p.y * view.unit });

/** The drawing's words: every part's label lines and every node's name lines (grid units). */
export function wordBoxes(scene: Scene): Box[] {
  return [...scene.parts.flatMap((p) => p.labels.map((l) => l.box)), ...scene.nodeLabels.flatMap((l) => l.lines.map((x) => x.box))];
}

/** The drawing's symbols: parts (pin to pin) and grounds (grid units). */
export function symbolBoxes(scene: Scene): Box[] {
  return [...scene.parts.map((p) => p.box), ...scene.grounds.map((g) => g.box)];
}

/** Every piece of wire (grid units). */
export function wireSegments(scene: Scene): [Point, Point][] {
  return scene.wires.flatMap((w) => segmentsOf(w.points));
}

/** What the drawing occupies, as a Room in screen pixels (or grid units with the identity view). */
export function drawingRoom(scene: Scene, view: View, area: Box, extra: readonly Box[] = []): Room {
  return {
    area,
    boxes: [...wordBoxes(scene), ...symbolBoxes(scene)].map((b) => boxOnScreen(view, b)).concat(extra),
    segments: wireSegments(scene).map(([a, b]) => [pointOnScreen(view, a), pointOnScreen(view, b)] as const),
  };
}

// ------------------------------------------------------------------ the index card

export interface CardRequest {
  scene: Scene;
  /** The part the card is for. */
  part: string;
  /** Instead of a part, what the card is for (a node's name): the box it keeps clear of, and the box its notch points at. */
  target?: { box: Box; body: Box };
  /** Where the drawing is now. */
  view: View;
  /** The free paper: the screen less the page's bars, toolbar and panels (screen pixels). */
  area: Box;
  /** The card's size: its tallest state, so it never has to move as it grows. */
  width: number;
  height: number;
  /** Space between the card and what it points at (default 14). */
  gap?: number;
  /** Other things on the paper the card must not cover (the sticky note, say). */
  avoid?: readonly Box[];
  /** The drawing may be panned once to make room (default true); not when the reader (or an edit) holds the view. */
  pan?: boolean;
  /**
   * Only a place that covers nothing (the page docks the card otherwise): none when no place is free,
   * instead of the one that covers least, which takes summing what every place tried covers.
   */
  freeOnly?: boolean;
}

export interface CardPlacement {
  /** Where the card goes once the drawing is panned by `pan` (screen pixels). */
  box: Box;
  side: Side;
  /** The pan that makes room for it (0, 0 when none is needed). */
  pan: { x: number; y: number };
  /** Where the card's notch is on its edge facing the part (screen pixels). */
  notch: Point;
  /** A short line from the notch to the part's symbol, when it touches no word and no wire. */
  leader?: { from: Point; to: Point };
  /** How much of the drawing the card still covers (0: none). */
  cost: number;
}

const SIDES_BY_ROOM: readonly Side[] = ['above', 'below', 'right', 'left'];
/**
 * Where a part's card goes (critique 1 and 2): beside the part on whichever side has room, never
 * over the part or its words; the drawing panned once when that makes room; a leader only when it
 * crosses nothing.
 */
export function placeCard(req: CardRequest): CardPlacement | undefined {
  const part = req.scene.parts.find((p) => p.key === req.part);
  const placed = req.target ?? (part ? { box: unionBoxes([part.box, part.labelBox])!, body: part.body, symbol: part.box } : undefined);
  if (!placed) return undefined;
  const gap = req.gap ?? 14;
  const own = placed.box;
  const attempt = (pan: { x: number; y: number }): (CardPlacement & { distance: number }) | undefined => {
    const view: View = { unit: req.view.unit, x: req.view.x + pan.x, y: req.view.y + pan.y };
    const room: Room = { ...drawingRoom(req.scene, view, req.area, req.avoid ?? []), never: [boxOnScreen(view, own)] };
    const target = boxOnScreen(view, own);
    // The nearest free place on any side; above or below is worth a little more than beside.
    const p = placeBeside(target, req.width, req.height, room, { gap, sides: SIDES_BY_ROOM, step: 8, sidePenalty: SIDE_PENALTY, ...(req.freeOnly ? { freeOnly: true } : {}) });
    if (!p) return undefined;
    const body = boxOnScreen(view, 'symbol' in placed ? placed.symbol : placed.body);
    const notch = notchFor(p.box, p.side, body);
    const leader = leaderFor(notch, p.side, boxOnScreen(view, placed.body), room);
    return { box: p.box, side: p.side, pan, notch, ...(leader ? { leader } : {}), cost: p.cost, distance: gapBetween(p.box, target) };
  };
  const strip = (p: (CardPlacement & { distance: number }) | undefined): CardPlacement | undefined => {
    if (!p) return undefined;
    const { distance: _distance, ...rest } = p;
    return rest;
  };
  const here = attempt({ x: 0, y: 0 });
  // Pan once, when the free bands above and below (or left and right) the drawing add up to the card.
  const content = boxOnScreen(req.view, req.scene.bounds);
  // The band the card needs on its side of the drawing, and a little paper kept on the other side.
  const margin = 4;
  const pans: { x: number; y: number }[] = [];
  if (req.pan === false) return strip(here);
  const above = content.y0 - req.area.y0;
  const below = req.area.y1 - content.y1;
  const left = content.x0 - req.area.x0;
  const right = req.area.x1 - content.x1;
  const needV = req.height + gap + margin;
  const needH = req.width + gap + margin;
  if (above + below >= needV + margin) {
    pans.push({ x: 0, y: Math.max(0, needV - above) });
    pans.push({ x: 0, y: -Math.max(0, needV - below) });
  }
  if (left + right >= needH + margin) {
    pans.push({ x: Math.max(0, needH - left), y: 0 });
    pans.push({ x: -Math.max(0, needH - right), y: 0 });
  }
  // Of the places that cover nothing, the one nearest its part, a pan counting for a little distance
  // (it moves the drawing); if none covers nothing, the one that covers least.
  const tried = [here, ...pans.map(attempt)].filter((p): p is CardPlacement & { distance: number } => !!p);
  const score = (p: CardPlacement & { distance: number }): number => p.distance + (p.pan.x || p.pan.y ? PAN_PENALTY : 0);
  const clear = tried.filter((p) => p.cost === 0).sort((a, b) => score(a) - score(b));
  if (clear[0]) return strip(clear[0]);
  return strip(tried.sort((a, b) => a.cost - b.cost)[0]);
}

/** How much nearer a place beside the part must be to beat one above or below it, in pixels. */
const SIDE_PENALTY = 80;
/** How much nearer a place must be to beat one that needs the drawing panned, in pixels. */
const PAN_PENALTY = 60;

/** The distance between two boxes (0 when they touch or overlap). */
function gapBetween(a: Box, b: Box): number {
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
  const dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
  return Math.hypot(dx, dy);
}

/** The notch: on the card's edge facing the part, in line with the part's middle (kept off the card's corners). */
function notchFor(card: Box, side: Side, body: Box): Point {
  const inset = 22;
  const clampX = (x: number): number => Math.max(card.x0 + inset, Math.min(card.x1 - inset, x));
  const clampY = (y: number): number => Math.max(card.y0 + inset, Math.min(card.y1 - inset, y));
  const mx = (body.x0 + body.x1) / 2;
  const my = (body.y0 + body.y1) / 2;
  switch (side) {
    case 'above':
      return { x: clampX(mx), y: card.y1 };
    case 'below':
      return { x: clampX(mx), y: card.y0 };
    case 'right':
      return { x: card.x0, y: clampY(my) };
    case 'left':
      return { x: card.x1, y: clampY(my) };
  }
}

/** The longest leader drawn, in pixels: further than this, the notch and the highlight say enough. */
export const MAX_LEADER = 160;

/**
 * A straight line from the card's notch to the edge of the part's body, or undefined when it would
 * cross a word, a wire or a symbol on the way (or is too long or too short to help).
 */
export function leaderFor(notch: Point, side: Side, body: Box, room: Room): { from: Point; to: Point } | undefined {
  const vertical = side === 'above' || side === 'below';
  if (vertical && (notch.x <= body.x0 || notch.x >= body.x1)) return undefined;
  if (!vertical && (notch.y <= body.y0 || notch.y >= body.y1)) return undefined;
  const to: Point = side === 'above' ? { x: notch.x, y: body.y0 } : side === 'below' ? { x: notch.x, y: body.y1 } : side === 'right' ? { x: body.x1, y: notch.y } : { x: body.x0, y: notch.y };
  const from: Point = side === 'above' ? { x: notch.x, y: notch.y + 9 } : side === 'below' ? { x: notch.x, y: notch.y - 9 } : side === 'right' ? { x: notch.x - 9, y: notch.y } : { x: notch.x + 9, y: notch.y };
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length < 18 || length > MAX_LEADER) return undefined;
  if (crossesAnything(from, to, room)) return undefined;
  return { from, to };
}

/**
 * True when the segment from `a` to just short of `b` crosses a box of the room (a symbol, a word:
 * the part's own lead included, so a leader never runs along a wire into its part) or a wire.
 */
export function crossesAnything(a: Point, b: Point, room: Room): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const k = Math.max(0, (len - 2) / len);
  const end = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  for (const box of room.boxes) if (segmentCrossesBox(a, end, box)) return true;
  for (const [p, q] of room.segments) if (segmentsIntersect(a, end, p, q)) return true;
  return false;
}

/** True when two segments touch or cross (end points included). */
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point): number => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const on = (p: Point, q: Point, r: Point): boolean => Math.min(p.x, r.x) - 1e-9 <= q.x && q.x <= Math.max(p.x, r.x) + 1e-9 && Math.min(p.y, r.y) - 1e-9 <= q.y && q.y <= Math.max(p.y, r.y) + 1e-9;
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && on(a, c, b)) return true;
  if (o2 === 0 && on(a, d, b)) return true;
  if (o3 === 0 && on(c, a, d)) return true;
  if (o4 === 0 && on(c, b, d)) return true;
  return false;
}

// ------------------------------------------------------------------ the sticky note's arrow

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The sticky note's pen arrow to the part it invites you to change (the prototype's): a gentle curve
 * from the note's edge to just short of the part's symbol, or undefined when every curve tried would
 * cross a word or the end would land on one. Screen pixels; returns the curve's three points.
 */
export function inviteArrow(
  note: Box,
  body: Box,
  words: readonly Box[],
  wires: readonly (readonly [Point, Point])[] = [],
  name?: Box,
): { from: Point; control: Point; to: Point } | undefined {
  const mx = (body.x0 + body.x1) / 2;
  const my = (body.y0 + body.y1) / 2;
  const off = 10;
  const ends: Point[] = [
    // Just above or beside the part's name (the prototype pointed at the name), else beside its body.
    ...(name ? [{ x: (name.x0 + name.x1) / 2, y: name.y0 - 7 }, { x: name.x1 + 8, y: (name.y0 + name.y1) / 2 }] : []),
    { x: body.x0 - off, y: my },
    { x: mx, y: body.y0 - off },
    { x: body.x1 + off, y: my },
    { x: mx, y: body.y1 + off },
  ];
  const nearWire = (p: Point): boolean => wires.some(([a, b]) => distanceToSegment(p, a, b) < 5);
  // From the note's bottom edge (any of several places) or its sides.
  const starts: Point[] = [
    ...[0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((f) => ({ x: note.x0 + width(note) * f, y: note.y1 + 6 })),
    ...[0.35, 0.65, 0.9].map((f) => ({ x: note.x0 - 6, y: note.y0 + height(note) * f })),
    ...[0.35, 0.65, 0.9].map((f) => ({ x: note.x1 + 6, y: note.y0 + height(note) * f })),
  ];
  let best: { from: Point; control: Point; to: Point; length: number } | undefined;
  for (const from of starts) {
    for (const to of ends) for (const bow of [1, -1]) {
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      if (length < 40 || length > 520) continue;
      // A gentle pen curve: the middle pushed sideways a little, one way or the other.
      const control = { x: (from.x + to.x) / 2 + bow * (to.y - from.y) * 0.22, y: (from.y + to.y) / 2 - bow * (to.x - from.x) * 0.22 };
      const pts = Array.from({ length: 41 }, (_, i) => {
        const t = i / 40;
        return { x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t * t * to.x, y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t * t * to.y };
      });
      const hits =
        pts.some((p) => words.some((w) => p.x > w.x0 - 3 && p.x < w.x1 + 3 && p.y > w.y0 - 3 && p.y < w.y1 + 3)) ||
        pts.some((p) => p.x > note.x0 && p.x < note.x1 && p.y > note.y0 && p.y < note.y1) ||
        pts.some(nearWire);
      if (hits) continue;
      if (!best || length < best.length) best = { from, control, to, length };
    }
  }
  return best ? { from: best.from, control: best.control, to: best.to } : undefined;
}
