/**
 * Tidying wires without changing what they connect: merge straight runs, join pieces into
 * polylines, remove wire ends that lead nowhere, cut a wire around a point. Plain TypeScript.
 */
import { SegmentIndex, pointId } from './connectivity.ts';
import { isOrthogonal, pointKey, pointOnSegment, pt, samePoint, segmentsOf, type Point } from './geometry.ts';

export type Segment = [Point, Point];

export const toSegments = (wires: readonly (readonly Point[])[]): Segment[] => wires.flatMap((w) => segmentsOf(w));

/**
 * The same copper as a small set of polylines: overlapping and touching straight pieces merged,
 * pieces joined where exactly two ends meet and nothing else touches, in a fixed order (top to
 * bottom, left to right). A slanted piece is kept once, however often it is drawn (either way round).
 */
export function normalizeWires(wires: readonly (readonly Point[])[]): Point[][] {
  const horizontal = new Map<number, [number, number][]>();
  const vertical = new Map<number, [number, number][]>();
  const slanted: Point[][] = [];
  const slantedSeen = new Set<string>();
  for (const [a, b] of toSegments(wires)) {
    if (!isOrthogonal(a, b)) {
      const key = [pointKey(a), pointKey(b)].sort().join(' ');
      if (!slantedSeen.has(key)) {
        slantedSeen.add(key);
        slanted.push([a, b]);
      }
      continue;
    }
    if (a.y === b.y) (horizontal.get(a.y) ?? horizontal.set(a.y, []).get(a.y)!).push([Math.min(a.x, b.x), Math.max(a.x, b.x)]);
    else (vertical.get(a.x) ?? vertical.set(a.x, []).get(a.x)!).push([Math.min(a.y, b.y), Math.max(a.y, b.y)]);
  }
  const mergeSpans = (spans: [number, number][]): [number, number][] => {
    const out: [number, number][] = [];
    for (const s of spans.sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
      const cur = out[out.length - 1];
      if (cur && s[0] <= cur[1]) cur[1] = Math.max(cur[1], s[1]);
      else out.push([s[0], s[1]]);
    }
    return out;
  };
  // Every point where a piece ended (a connection the merged wires must keep), by row, left to right.
  const endsByRow = new Map<number, number[]>();
  for (const [a, b] of toSegments(wires)) for (const p of [a, b]) (endsByRow.get(p.y) ?? endsByRow.set(p.y, []).get(p.y)!).push(p.x);
  for (const xs of endsByRow.values()) xs.sort((p, q) => p - q);
  const merged: Segment[] = [];
  const verticalSpans = new Map<number, [number, number][]>();
  for (const x of [...vertical.keys()].sort((p, q) => p - q)) {
    const spans = mergeSpans(vertical.get(x)!);
    verticalSpans.set(x, spans);
    for (const [lo, hi] of spans) merged.push([pt(x, lo), pt(x, hi)]);
  }
  /** True when a merged vertical at x runs through y (not just ending there): spans are sorted and apart. */
  const verticalThrough = (x: number, y: number): boolean => {
    const spans = verticalSpans.get(x);
    if (!spans) return false;
    let lo = 0;
    let hi = spans.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (spans[mid]![0] < y) lo = mid;
      else hi = mid - 1;
    }
    const s = spans[lo]!;
    return s[0] < y && y < s[1];
  };
  // A horizontal wire stops where a merged vertical passes through a point at which some piece
  // ended (a junction): otherwise two straight runs through a four-way junction would only cross.
  // Only the ends on its row, inside it, are looked at (never every column of the drawing).
  for (const y of [...horizontal.keys()].sort((p, q) => p - q)) {
    const xs = endsByRow.get(y) ?? [];
    for (const [lo, hi] of mergeSpans(horizontal.get(y)!)) {
      const cuts: number[] = [];
      let i = 0;
      let j = xs.length;
      while (i < j) {
        const mid = (i + j) >> 1;
        if (xs[mid]! <= lo) i = mid + 1;
        else j = mid;
      }
      for (; i < xs.length && xs[i]! < hi; i++) {
        const x = xs[i]!;
        if (x !== cuts[cuts.length - 1] && verticalThrough(x, y)) cuts.push(x);
      }
      let from = lo;
      for (const x of [...cuts, hi]) {
        merged.push([pt(from, y), pt(x, y)]);
        from = x;
      }
    }
  }

  // Join pieces at points where exactly two ends meet and no other piece passes through.
  const index = new SegmentIndex(merged);
  const joint = (p: Point): boolean => {
    const at = index.at(p);
    return at.length === 2 && at.every((s) => samePoint(s.a, p) || samePoint(s.b, p));
  };
  merged.sort((s, t) => s[0].y - t[0].y || s[0].x - t[0].x || s[1].y - t[1].y || s[1].x - t[1].x);
  const endsAt = new Map<number | string, number[]>();
  merged.forEach((s, i) => {
    for (const p of s) {
      const k = pointId(p);
      const list = endsAt.get(k);
      if (list) list.push(i);
      else endsAt.set(k, [i]);
    }
  });
  const used = new Uint8Array(merged.length);
  const out: Point[][] = [];
  const extend = (line: Point[], from: Point, via: number): void => {
    let p = from;
    let last = via;
    for (;;) {
      if (!joint(p)) return;
      const next = (endsAt.get(pointId(p)) ?? []).find((i) => i !== last && !used[i]);
      if (next === undefined) return;
      used[next] = 1;
      const s = merged[next]!;
      const q = samePoint(s[0], p) ? s[1] : s[0];
      line.push(q);
      p = q;
      last = next;
    }
  };
  merged.forEach((s, i) => {
    if (used[i]) return;
    used[i] = 1;
    const forward: Point[] = [s[0], s[1]];
    extend(forward, s[1], i);
    const backward: Point[] = [s[0]];
    extend(backward, s[0], i);
    const line = [...backward.slice(1).reverse(), ...forward];
    // A closed loop is written from its top-left point.
    out.push(line);
  });
  return [...out, ...slanted];
}

/**
 * Removes wire ends that lead nowhere: an end that touches no other wire, no pin and no point in
 * `keep` (labels) is cut back to the nearest point where something touches its wire, and that is
 * repeated until no end leads nowhere. Each round cuts every such end at once (a segment cut at its
 * second end comes out starting at the cut). A segment drawn over another with the same two ends is
 * the same copper, so it never keeps the other's end from leading nowhere: only the first of them is
 * kept, from the start and whenever a cut makes one the same as another.
 *
 * The work is bounded by the length of wire, never by the square of the number of segments: every
 * point where a segment could stop (an end of any segment, a pin, a kept point) is found once with
 * the segments through it, and a round looks only at the ends whose surroundings the round before
 * changed, so a long chain of wire hanging from one pin goes in one sweep along it, not one segment
 * per pass over the whole drawing.
 */
export function pruneDangling(segments: readonly Segment[], pins: readonly Point[], keep: readonly Point[]): Segment[] {
  const segs = segments.filter(([a, b]) => !samePoint(a, b));
  // Every point a segment can end at, now or after a cut: segments' ends and anchors (pins, kept points).
  const ids = new Map<number | string, number>();
  const points: Point[] = [];
  const idOf = (p: Point): number => {
    const k = pointId(p);
    let id = ids.get(k);
    if (id === undefined) {
      id = points.length;
      ids.set(k, id);
      points.push(p);
    }
    return id;
  };
  for (const [a, b] of segs) {
    idOf(a);
    idOf(b);
  }
  const anchors = [...pins, ...keep];
  for (const p of anchors) idOf(p);
  const anchored = new Uint8Array(points.length);
  for (const p of anchors) anchored[ids.get(pointId(p))!] = 1;
  // Each segment's stops: those points on it, in order from its first end; and each point's segments.
  const index = new SegmentIndex(segs);
  const stops: number[][] = segs.map(() => []);
  const on: { seg: number; pos: number }[][] = points.map(() => []);
  points.forEach((p, id) => {
    for (const t of index.at(p)) stops[t.wire]!.push(id);
  });
  stops.forEach((list, i) => {
    const a = segs[i]![0];
    const far = (id: number): number => Math.abs(points[id]!.x - a.x) + Math.abs(points[id]!.y - a.y);
    list.sort((x, y) => far(x) - far(y));
    list.forEach((id, pos) => on[id]!.push({ seg: i, pos }));
  });
  // The state: each segment's two ends as positions in its stops (the first end may come after the
  // second), whether it is still there, and for each point how many segments cover it and end at it.
  const first = segs.map(() => 0);
  const second = stops.map((list) => list.length - 1);
  const alive = segs.map(() => true);
  const cover = new Int32Array(points.length);
  const ends = new Int32Array(points.length);
  const lowOf = (seg: number): number => Math.min(first[seg]!, second[seg]!);
  const highOf = (seg: number): number => Math.max(first[seg]!, second[seg]!);
  const covers = (seg: number, pos: number): boolean => alive[seg]! && pos >= lowOf(seg) && pos <= highOf(seg);
  /** Which segment holds each pair of ends (the same two points either way round). */
  const holder = new Map<number, number>();
  const shape = (seg: number): number => {
    const x = stops[seg]![first[seg]!]!;
    const y = stops[seg]![second[seg]!]!;
    return Math.min(x, y) * points.length + Math.max(x, y);
  };
  /** Takes a segment away, noting the points it leaves. */
  const remove = (seg: number, changed: Set<number>): void => {
    const list = stops[seg]!;
    for (let pos = lowOf(seg); pos <= highOf(seg); pos++) {
      cover[list[pos]!]! -= 1;
      changed.add(list[pos]!);
    }
    for (const pos of [first[seg]!, second[seg]!]) ends[list[pos]!]! -= 1;
    alive[seg] = false;
  };
  /** Keeps the first of two segments with the same ends: false when `seg` went. */
  const hold = (seg: number, changed: Set<number>): boolean => {
    const key = shape(seg);
    const other = holder.get(key);
    if (other === undefined || other === seg || !alive[other]) {
      holder.set(key, seg);
      return true;
    }
    if (other < seg) {
      remove(seg, changed);
      return false;
    }
    remove(other, changed);
    holder.set(key, seg);
    return true;
  };
  stops.forEach((list) => {
    for (const id of list) cover[id]! += 1;
    ends[list[0]!]! += 1;
    ends[list[list.length - 1]!]! += 1;
  });
  const start = new Set<number>();
  segs.forEach((_, i) => hold(i, start));
  let round = segs.map((_, i) => i).filter((i) => alive[i]);
  while (round.length) {
    // Decide every cut of this round from the drawing as it was when the round began.
    const cuts: { seg: number; first: number; second: number; gone: boolean }[] = [];
    for (const i of round) {
      if (!alive[i]) continue;
      const list = stops[i]!;
      const qa = list[first[i]!]!;
      const qb = list[second[i]!]!;
      const dangles = (id: number): boolean => !anchored[id] && cover[id] === 1;
      // A stop where something else touches the segment: another segment's end, or an anchor.
      const touches = (id: number): boolean => anchored[id] === 1 || ends[id]! > (id === qa ? 1 : 0) + (id === qb ? 1 : 0);
      // The nearest stop from `from` towards `to` (not `from` itself) where something touches; undefined when that is `to` or there is none.
      const cut = (from: number, to: number): number | undefined => {
        const step = to > from ? 1 : -1;
        for (let pos = from + step; pos !== to + step; pos += step) if (touches(list[pos]!)) return pos === to ? undefined : pos;
        return undefined;
      };
      const da = dangles(qa);
      const db = dangles(qb);
      if (!da && !db) continue;
      let a = first[i]!;
      let b = second[i]!;
      let gone = false;
      if (da) {
        const c = cut(a, b);
        if (c === undefined) gone = true;
        else a = c;
      }
      if (!gone && db) {
        const c = cut(b, a);
        if (c === undefined) gone = true;
        else [a, b] = [c, a];
      }
      cuts.push({ seg: i, first: a, second: b, gone });
    }
    // Then make them, and note the points whose surroundings changed.
    const changed = new Set<number>();
    for (const c of cuts) if (holder.get(shape(c.seg)) === c.seg) holder.delete(shape(c.seg));
    for (const c of cuts) {
      if (c.gone) {
        remove(c.seg, changed);
        continue;
      }
      const list = stops[c.seg]!;
      const keepLo = Math.min(c.first, c.second);
      const keepHi = Math.max(c.first, c.second);
      for (let pos = lowOf(c.seg); pos <= highOf(c.seg); pos++) {
        if (pos >= keepLo && pos <= keepHi) continue;
        cover[list[pos]!]! -= 1;
        changed.add(list[pos]!);
      }
      for (const pos of [first[c.seg]!, second[c.seg]!]) {
        ends[list[pos]!]! -= 1;
        changed.add(list[pos]!);
      }
      first[c.seg] = c.first;
      second[c.seg] = c.second;
      for (const pos of [c.first, c.second]) {
        ends[list[pos]!]! += 1;
        changed.add(list[pos]!);
      }
    }
    // A cut that made two segments the same leaves only the first of them.
    for (const c of cuts) if (alive[c.seg]) hold(c.seg, changed);
    // Next round: the segments that end where only they are now (their end may lead nowhere).
    const next = new Set<number>();
    for (const id of changed) {
      if (anchored[id] || cover[id] !== 1) continue;
      for (const { seg, pos } of on[id]!) {
        if (!covers(seg, pos)) continue;
        if (pos === first[seg] || pos === second[seg]) next.add(seg);
        break;
      }
    }
    round = [...next];
  }
  const out: Segment[] = [];
  segs.forEach((_, i) => {
    if (alive[i]) out.push([points[stops[i]![first[i]!]!]!, points[stops[i]![second[i]!]!]!]);
  });
  return out;
}

/**
 * Cuts the copper at a point: every piece ending at p loses its last grid unit, and every piece
 * passing through p loses one grid unit on each side of it. Pruning afterwards removes what then
 * leads nowhere.
 */
export function cutAt(segments: readonly Segment[], p: Point): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const [a, b] = s;
    if (!pointOnSegment(p, a, b) || !isOrthogonal(a, b)) {
      out.push(s);
      continue;
    }
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    const before = pt(p.x - dx, p.y - dy);
    const after = pt(p.x + dx, p.y + dy);
    if (!samePoint(p, a) && !samePoint(before, a) && pointOnSegment(before, a, b)) out.push([a, before]);
    if (!samePoint(p, b) && !samePoint(after, b) && pointOnSegment(after, a, b)) out.push([after, b]);
  }
  return out;
}
