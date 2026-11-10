/**
 * Tidying wires without changing what they connect: merge straight runs, join pieces into
 * polylines, remove wire ends that lead nowhere, cut a wire around a point. Plain TypeScript.
 */
import { SegmentIndex } from './connectivity.ts';
import { isOrthogonal, pointKey, pointOnSegment, pt, samePoint, segmentsOf, type Point } from './geometry.ts';

export type Segment = [Point, Point];

export const toSegments = (wires: readonly (readonly Point[])[]): Segment[] => wires.flatMap((w) => segmentsOf(w));

/**
 * The same copper as a small set of polylines: overlapping and touching straight pieces merged,
 * pieces joined where exactly two ends meet and nothing else touches, in a fixed order (top to
 * bottom, left to right).
 */
export function normalizeWires(wires: readonly (readonly Point[])[]): Point[][] {
  const horizontal = new Map<number, [number, number][]>();
  const vertical = new Map<number, [number, number][]>();
  const slanted: Point[][] = [];
  for (const [a, b] of toSegments(wires)) {
    if (!isOrthogonal(a, b)) {
      slanted.push([a, b]);
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
  // Every point where a piece ended: a connection the merged wires must keep.
  const ends = new Set<string>();
  for (const [a, b] of toSegments(wires)) {
    ends.add(pointKey(a));
    ends.add(pointKey(b));
  }
  const merged: Segment[] = [];
  const verticalSpans = new Map<number, [number, number][]>();
  for (const x of [...vertical.keys()].sort((p, q) => p - q)) {
    const spans = mergeSpans(vertical.get(x)!);
    verticalSpans.set(x, spans);
    for (const [lo, hi] of spans) merged.push([pt(x, lo), pt(x, hi)]);
  }
  // A horizontal wire stops where a merged vertical passes through a point at which some piece
  // ended (a junction): otherwise two straight runs through a four-way junction would only cross.
  for (const y of [...horizontal.keys()].sort((p, q) => p - q)) {
    for (const [lo, hi] of mergeSpans(horizontal.get(y)!)) {
      const cuts: number[] = [];
      for (const [x, spans] of verticalSpans) {
        if (x <= lo || x >= hi || !ends.has(pointKey(pt(x, y)))) continue;
        if (spans.some(([a, b]) => a < y && y < b)) cuts.push(x);
      }
      cuts.sort((p, q) => p - q);
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
  const order = new Map(merged.map((s, i) => [s, i]));
  const endsAt = new Map<string, number[]>();
  merged.forEach((s, i) => {
    for (const p of s) (endsAt.get(pointKey(p)) ?? endsAt.set(pointKey(p), []).get(pointKey(p))!).push(i);
  });
  const used = new Set<number>();
  const out: Point[][] = [];
  const extend = (line: Point[], from: Point, via: number): void => {
    let p = from;
    let last = via;
    for (;;) {
      if (!joint(p)) return;
      const next = (endsAt.get(pointKey(p)) ?? []).find((i) => i !== last && !used.has(i));
      if (next === undefined) return;
      used.add(next);
      const s = merged[next]!;
      const q = samePoint(s[0], p) ? s[1] : s[0];
      line.push(q);
      p = q;
      last = next;
    }
  };
  for (const s of merged) {
    const i = order.get(s)!;
    if (used.has(i)) continue;
    used.add(i);
    const forward: Point[] = [s[0], s[1]];
    extend(forward, s[1], i);
    const backward: Point[] = [s[0]];
    extend(backward, s[0], i);
    const line = [...backward.slice(1).reverse(), ...forward];
    // A closed loop is written from its top-left point.
    out.push(line);
  }
  return [...out, ...slanted];
}

/**
 * Removes wire ends that lead nowhere: an end that touches no other wire, no pin and no point in
 * `keep` (labels) is cut back to the nearest point where something touches its wire. Each round cuts
 * every such end at once, with points found by row and column, so it stays fast with many wires.
 */
export function pruneDangling(segments: readonly Segment[], pins: readonly Point[], keep: readonly Point[]): Segment[] {
  let segs = segments.filter(([a, b]) => !samePoint(a, b));
  const anchored = new Set([...pins, ...keep].map(pointKey));
  const anchorPoints = [...pins, ...keep];
  for (let round = 0; round < 10_000; round++) {
    const index = new SegmentIndex(segs);
    // Where segments end (how many), and anchors, by row and by column.
    const ends = new Map<string, number>();
    for (const [a, b] of segs) for (const p of [a, b]) ends.set(pointKey(p), (ends.get(pointKey(p)) ?? 0) + 1);
    const rows = new Map<number, Point[]>();
    const cols = new Map<number, Point[]>();
    const seen = new Set<string>();
    for (const p of [...segs.flatMap(([a, b]) => [a, b]), ...anchorPoints]) {
      const k = pointKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      (rows.get(p.y) ?? rows.set(p.y, []).get(p.y)!).push(p);
      (cols.get(p.x) ?? cols.set(p.x, []).get(p.x)!).push(p);
    }
    let changed = false;
    const next: Segment[] = [];
    segs.forEach((s, i) => {
      let [a, b] = s;
      const dangles = (q: Point): boolean => !anchored.has(pointKey(q)) && index.at(q).every((t) => t.wire === i);
      // A point of this segment where something else touches it: another segment's end, or an anchor.
      const touches = (p: Point): boolean => {
        const k = pointKey(p);
        const own = (samePoint(p, s[0]) ? 1 : 0) + (samePoint(p, s[1]) ? 1 : 0);
        return anchored.has(k) || (ends.get(k) ?? 0) > own;
      };
      const candidates = (): Point[] => {
        if (a.y === b.y) return (rows.get(a.y) ?? []).filter((p) => pointOnSegment(p, a, b));
        if (a.x === b.x) return (cols.get(a.x) ?? []).filter((p) => pointOnSegment(p, a, b));
        return [...seen].map((k) => k.split(',').map(Number)).map(([x, y]) => pt(x!, y!)).filter((p) => pointOnSegment(p, a, b));
      };
      const cut = (q: Point, r: Point): Point | undefined => {
        let best: Point | undefined;
        let bestD = Infinity;
        for (const p of candidates()) {
          if (samePoint(p, q) || !touches(p)) continue;
          const d = Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        return best && !samePoint(best, r) ? best : undefined;
      };
      if (dangles(a)) {
        changed = true;
        const c = cut(a, b);
        if (!c) return;
        a = c;
      }
      if (dangles(b)) {
        changed = true;
        const c = cut(b, a);
        if (!c) return;
        [a, b] = [c, a];
      }
      next.push([a, b]);
    });
    segs = next;
    if (!changed) break;
  }
  return segs;
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
