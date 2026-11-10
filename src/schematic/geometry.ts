/**
 * Plane geometry on the drawing's grid: points, boxes, the four rotations and mirroring, and the
 * tests the layout, the router and the connectivity check need. Plain TypeScript, no DOM.
 *
 * Coordinates are grid units: x grows to the right and y grows downwards, as in SVG, so a renderer
 * can draw a symbol with `translate(x y) rotate(rot) scale(-1 1)` (the scale only when mirrored).
 * Pins, wires and part positions are always whole grid units; text boxes can be fractional.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned box: x0 <= x1, y0 <= y1. */
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A quarter turn clockwise on screen (y down), as SVG's rotate(): 90 turns "up" into "right". */
export type Rotation = 0 | 90 | 180 | 270;

export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

export type Direction = 'up' | 'right' | 'down' | 'left';

export const DIRECTIONS: readonly Direction[] = ['up', 'right', 'down', 'left'];

export const DIRECTION_VECTORS: Readonly<Record<Direction, Point>> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export const OPPOSITE: Readonly<Record<Direction, Direction>> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** A point; -0 becomes 0, so keys and serialised numbers never show "-0". */
export function pt(x: number, y: number): Point {
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

export const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

export const pointKey = (p: Point): string => `${p.x},${p.y}`;

export const manhattan = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export const addPoints = (a: Point, b: Point): Point => pt(a.x + b.x, a.y + b.y);

/** Turns a point about the origin by `rot` (clockwise on screen). */
export function rotate(p: Point, rot: Rotation): Point {
  switch (rot) {
    case 0:
      return pt(p.x, p.y);
    case 90:
      return pt(-p.y, p.x);
    case 180:
      return pt(-p.x, -p.y);
    case 270:
      return pt(p.y, -p.x);
  }
}

/** A symbol's local point in the drawing: mirrored (x to -x) first, then turned, then moved. */
export function transform(local: Point, at: Point, rot: Rotation, mirror: boolean): Point {
  const m = mirror ? pt(-local.x, local.y) : local;
  const r = rotate(m, rot);
  return pt(at.x + r.x, at.y + r.y);
}

export function transformBox(box: Box, at: Point, rot: Rotation, mirror: boolean): Box {
  const a = transform({ x: box.x0, y: box.y0 }, at, rot, mirror);
  const b = transform({ x: box.x1, y: box.y1 }, at, rot, mirror);
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

export function directionOf(v: Point): Direction | undefined {
  if (v.x === 0 && v.y < 0) return 'up';
  if (v.x === 0 && v.y > 0) return 'down';
  if (v.y === 0 && v.x > 0) return 'right';
  if (v.y === 0 && v.x < 0) return 'left';
  return undefined;
}

/** A local direction after mirroring and turning, like `transform` does to points. */
export function transformDirection(d: Direction, rot: Rotation, mirror: boolean): Direction {
  const v = DIRECTION_VECTORS[d];
  return directionOf(transform(v, pt(0, 0), rot, mirror)) ?? d;
}

export const isHorizontal = (d: Direction): boolean => d === 'left' || d === 'right';

/** The rotation a quarter turn further clockwise. */
export const nextRotation = (rot: Rotation): Rotation => ((rot + 90) % 360) as Rotation;

export function boxOfPoints(points: readonly Point[]): Box | undefined {
  if (points.length === 0) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

export function unionBoxes(boxes: Iterable<Box>): Box | undefined {
  let out: Box | undefined;
  for (const b of boxes) {
    out = out ? { x0: Math.min(out.x0, b.x0), y0: Math.min(out.y0, b.y0), x1: Math.max(out.x1, b.x1), y1: Math.max(out.y1, b.y1) } : b;
  }
  return out;
}

export const inflate = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });

export const moveBox = (b: Box, dx: number, dy: number): Box => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });

/** True when the boxes share an area larger than nothing (touching edges do not count). */
export function boxesOverlap(a: Box, b: Box, margin = 0): boolean {
  return a.x0 - margin < b.x1 && b.x0 - margin < a.x1 && a.y0 - margin < b.y1 && b.y0 - margin < a.y1;
}

/** True when the point is inside the box (on the edge counts when `edges` is true). */
export function boxContains(b: Box, p: Point, edges = false): boolean {
  return edges ? p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1 : p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1;
}

/** True when the closed segment a–b lies on a point (endpoints included). Works for any segment. */
export function pointOnSegment(p: Point, a: Point, b: Point): boolean {
  if (a.x === b.x) return p.x === a.x && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
  if (a.y === b.y) return p.y === a.y && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x);
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > 1e-9) return false;
  return p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
}

/** True when the point is on the segment but not at either end. */
export function pointInsideSegment(p: Point, a: Point, b: Point): boolean {
  return pointOnSegment(p, a, b) && !samePoint(p, a) && !samePoint(p, b);
}

/** True when the segment a–b passes through the inside of the box (touching its edge does not count). */
export function segmentCrossesBox(a: Point, b: Point, box: Box): boolean {
  // Liang–Barsky clipping against the open box.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q > 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, a.x - box.x0) || !clip(dx, box.x1 - a.x) || !clip(-dy, a.y - box.y0) || !clip(dy, box.y1 - a.y)) return false;
  if (t1 - t0 <= 1e-9) return false;
  const mid = { x: a.x + dx * ((t0 + t1) / 2), y: a.y + dy * ((t0 + t1) / 2) };
  return boxContains(box, mid);
}

/** Splits a polyline into its segments (zero-length ones dropped). */
export function segmentsOf(points: readonly Point[]): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (!samePoint(a, b)) out.push([a, b]);
  }
  return out;
}

export const isOrthogonal = (a: Point, b: Point): boolean => a.x === b.x || a.y === b.y;

/** Drops repeated points and the middle points of straight runs. */
export function simplifyPolyline(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && samePoint(last, p)) continue;
    const before = out[out.length - 2];
    if (before && last && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) {
      // Straight on (or straight back): the middle point goes, unless the line turns back on itself.
      const back = (last.x - before.x) * (p.x - last.x) + (last.y - before.y) * (p.y - last.y) < 0;
      if (!back) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}
