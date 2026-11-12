/**
 * src/schematic/route.ts, wires.ts and connectivity.ts: new wires never change what the drawing
 * connects, tidying keeps every connection (four-way junctions included), and the connectivity
 * rules: ends and corners connect, crossings do not.
 */
import { describe, expect, it } from 'vitest';
import {
  cutAt,
  danglingEnds,
  findIslands,
  findRoute,
  junctionPoints,
  MAX_ROUTE_CELLS,
  normalizeWires,
  pruneDangling,
  ROUTE_COSTS,
  segmentCrossesBox,
  segmentsOf,
  type Box,
  type Point,
  type RouteWorld,
} from '../../src/schematic/index.ts';
import { SegmentIndex } from '../../src/schematic/connectivity.ts';

const p = (x: number, y: number): Point => ({ x, y });
const world = (extra: Partial<RouteWorld> = {}): RouteWorld => ({
  walls: [],
  avoid: [],
  foreignWires: [],
  foreignPins: [],
  bounds: { x0: -10, y0: -10, x1: 10, y1: 10 },
  ...extra,
});

describe('routing', () => {
  it('runs straight when it can', () => {
    expect(findRoute(world(), [{ at: p(0, 0) }], [{ at: p(5, 0) }])).toEqual([p(0, 0), p(5, 0)]);
    expect(findRoute(world(), [{ at: p(0, 0) }], [{ at: p(0, 0) }])).toEqual([]);
  });

  it('goes round a symbol, never through it', () => {
    const wall = { x0: 2 - 0.4, y0: -2, x1: 2 + 0.4, y1: 2 };
    const path = findRoute(world({ walls: [wall] }), [{ at: p(0, 0) }], [{ at: p(5, 0) }])!;
    expect(path[0]).toEqual(p(0, 0));
    expect(path[path.length - 1]).toEqual(p(5, 0));
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
      // No grid point of the route is inside the wall.
      for (let k = 0; k <= Math.abs(b.x - a.x) + Math.abs(b.y - a.y); k++) {
        const q = { x: a.x + Math.sign(b.x - a.x) * k, y: a.y + Math.sign(b.y - a.y) * k };
        expect(q.x > wall.x0 && q.x < wall.x1 && q.y > wall.y0 && q.y < wall.y1).toBe(false);
      }
    }
  });

  it('leaves and reaches a pin along its lead', () => {
    // A pin at (0, 0) whose lead goes up out of the part: the wire must start upwards.
    const path = findRoute(world(), [{ at: p(0, 0), outward: 'up' }], [{ at: p(4, 2), outward: 'down' }])!;
    expect(path[1]!.x).toBe(0);
    expect(path[1]!.y).toBeLessThan(0);
    const last = path[path.length - 2]!;
    expect(last.x).toBe(4);
    expect(last.y).toBeGreaterThan(2);
  });

  it('crosses another node\'s wire straight, but never turns, starts or ends on it, or runs along it', () => {
    const foreign = [[p(2, -5), p(2, 5)]];
    const path = findRoute(world({ foreignWires: foreign }), [{ at: p(0, 0) }], [{ at: p(4, 0) }])!;
    expect(path).toEqual([p(0, 0), p(4, 0)]);
    // A target on the other wire is out of reach.
    expect(findRoute(world({ foreignWires: foreign, bounds: { x0: 0, y0: -1, x1: 3, y1: 1 } }), [{ at: p(0, 0) }], [{ at: p(2, 1) }])).toBeUndefined();
    // Along it: blocked, so the route goes beside it.
    const along = findRoute(world({ foreignWires: [[p(0, 0), p(6, 0)]] }), [{ at: p(0, 1) }], [{ at: p(6, 1) }])!;
    for (const q of along) expect(q.y).not.toBe(0);
  });

  it('never touches another node\'s pin, and says when there is no way', () => {
    const path = findRoute(world({ foreignPins: [p(2, 0)] }), [{ at: p(0, 0) }], [{ at: p(4, 0) }])!;
    expect(path.some((q) => q.x === 2 && q.y === 0)).toBe(false);
    const boxed = world({ walls: [{ x0: -1.5, y0: -1.5, x1: 1.5, y1: -0.5 }, { x0: -1.5, y0: 0.5, x1: 1.5, y1: 1.5 }, { x0: -1.5, y0: -1.5, x1: -0.5, y1: 1.5 }, { x0: 0.5, y0: -1.5, x1: 1.5, y1: 1.5 }] });
    expect(findRoute(boxed, [{ at: p(0, 0) }], [{ at: p(5, 5) }])).toBeUndefined();
  });
});

describe('connections between wires', () => {
  it('connects ends and corners that touch, not crossings', () => {
    const wires = [
      [p(0, 0), p(10, 0)],
      [p(5, -5), p(5, 5)], // crosses the first: not connected
      [p(10, 0), p(10, 5)], // corner at (10, 0): connected
      [p(3, 0), p(3, 4)], // T at (3, 0): connected
    ];
    const isl = findIslands(wires, []);
    expect(isl.wires[0]).toBe(isl.wires[2]);
    expect(isl.wires[0]).toBe(isl.wires[3]);
    expect(isl.wires[0]).not.toBe(isl.wires[1]);
    expect(junctionPoints(wires, [])).toEqual([p(3, 0)]);
  });

  it('connects pins on wires and pins at the same point', () => {
    const isl = findIslands([[p(0, 0), p(4, 0)]], [p(2, 0), p(9, 9), p(9, 9), p(4, 1)]);
    expect(isl.anchors[0]).toBe(isl.wires[0]);
    expect(isl.anchors[1]).toBe(isl.anchors[2]);
    expect(isl.anchors[3]).not.toBe(isl.wires[0]);
    expect(isl.at(p(1, 0))).toBe(isl.wires[0]);
    expect(isl.at(p(1, 1))).toBeUndefined();
  });

  it('finds wire ends that touch nothing', () => {
    expect(danglingEnds([[p(0, 0), p(4, 0)]], [p(0, 0)])).toEqual([p(4, 0)]);
  });
});

describe('tidying wires', () => {
  it('merges straight runs and joins pieces into polylines', () => {
    expect(normalizeWires([[p(0, 0), p(2, 0)], [p(2, 0), p(5, 0)], [p(5, 0), p(5, 3)]])).toEqual([[p(0, 0), p(5, 0), p(5, 3)]]);
    expect(normalizeWires([[p(0, 0), p(4, 0)], [p(1, 0), p(6, 0)]])).toEqual([[p(0, 0), p(6, 0)]]);
  });

  it('keeps a four-way junction connected instead of turning it into a crossing', () => {
    const wires = [
      [p(0, 0), p(2, 0)],
      [p(2, 0), p(4, 0)],
      [p(2, -2), p(2, 0)],
      [p(2, 0), p(2, 2)],
    ];
    const tidy = normalizeWires(wires);
    const isl = findIslands(tidy, []);
    expect(new Set(isl.wires).size).toBe(1);
    expect(junctionPoints(tidy, [])).toEqual([p(2, 0)]);
  });

  it('cuts back wire ends that lead nowhere, but keeps a labelled terminal', () => {
    const segs: [Point, Point][] = [
      [p(0, 0), p(6, 0)],
      [p(3, 0), p(3, 4)],
    ];
    // Pins at (0, 0) and (3, 4): the end at (6, 0) leads nowhere.
    expect(pruneDangling(segs, [p(0, 0), p(3, 4)], [])).toEqual([
      [p(3, 0), p(0, 0)],
      [p(3, 0), p(3, 4)],
    ]);
    expect(pruneDangling(segs, [p(0, 0), p(3, 4)], [p(6, 0)])).toEqual(segs);
  });

  it('cuts a wire around a point', () => {
    expect(cutAt([[p(0, 0), p(6, 0)]], p(3, 0))).toEqual([
      [p(0, 0), p(2, 0)],
      [p(4, 0), p(6, 0)],
    ]);
    expect(cutAt([[p(0, 0), p(6, 0)]], p(6, 0))).toEqual([[p(0, 0), p(5, 0)]]);
  });
});

describe('limits and pins', () => {
  const open = { walls: [], avoid: [], foreignWires: [], foreignPins: [] };

  it(`does not search an area larger than ${MAX_ROUTE_CELLS} cells`, () => {
    const t0 = performance.now();
    expect(findRoute({ ...open, bounds: { x0: 0, y0: 0, x1: 1000, y1: 1000 } }, [{ at: p(0, 0) }], [{ at: p(1000, 1000) }])).toBeUndefined();
    expect(performance.now() - t0).toBeLessThan(50);
    expect(findRoute({ ...open, bounds: { x0: 0, y0: 0, x1: 1000, y1: 1000 } }, [{ at: p(3, 3) }], [{ at: p(3, 3) }])).toEqual([]);
  });

  it('leaves a bare pin across its lead only when it has a cost to pay, and never otherwise', () => {
    // The pin at (0, 0) points up, and (0, -1) is another node's pin: along the lead is blocked.
    const world = { ...open, foreignPins: [p(0, -1)], bounds: { x0: -5, y0: -5, x1: 5, y1: 5 } };
    expect(findRoute(world, [{ at: p(0, 0), outward: 'up' }], [{ at: p(3, 0) }])).toBeUndefined();
    expect(findRoute(world, [{ at: p(0, 0), outward: 'up', sideCost: ROUTE_COSTS.bareSide }], [{ at: p(3, 0) }])).toEqual([p(0, 0), p(3, 0)]);
  });
});

/**
 * security:F1: wire drawn over wire, slanted wire and long chains of wire. The connections stay the
 * same, the work grows with the wire, never with its square, and a piece drawn twice is one piece.
 */
describe('wire over wire, slanted wire and long chains (security:F1)', () => {
  type Seg = [Point, Point];
  const key = (q: Point): string => `${q.x},${q.y}`;
  const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;
  const on = (q: Point, [a, b]: Seg): boolean =>
    (b.x - a.x) * (q.y - a.y) === (b.y - a.y) * (q.x - a.x) && q.x >= Math.min(a.x, b.x) && q.x <= Math.max(a.x, b.x) && q.y >= Math.min(a.y, b.y) && q.y <= Math.max(a.y, b.y);

  /**
   * The rule pruneDangling follows, the slow way, rebuilt from nothing every round: pieces with the
   * same two ends (either way round) are one piece, the first kept; an end that touches no other
   * piece, no pin and no kept point is cut back to the nearest point of its piece where another
   * piece ends or a pin or kept point is (gone when that is its other end, or there is none); every
   * such end at once, round after round, until none is left. A piece cut at its second end comes out
   * starting at the cut.
   */
  function reference(segments: readonly Seg[], pins: readonly Point[], keep: readonly Point[]): Seg[] {
    let segs = segments.filter(([a, b]) => !same(a, b));
    const anchored = new Set([...pins, ...keep].map(key));
    for (;;) {
      const shapes = new Set<string>();
      segs = segs.filter(([a, b]) => {
        const k = [key(a), key(b)].sort().join(' ');
        if (shapes.has(k)) return false;
        shapes.add(k);
        return true;
      });
      const ends = new Map<string, number>();
      for (const s of segs) for (const q of s) ends.set(key(q), (ends.get(key(q)) ?? 0) + 1);
      const stops = [...segs.flatMap((s) => s), ...pins, ...keep];
      let changed = false;
      const next: Seg[] = [];
      segs.forEach((s, i) => {
        let [a, b] = s;
        const dangles = (q: Point): boolean => !anchored.has(key(q)) && segs.every((t, j) => j === i || !on(q, t));
        const touches = (q: Point): boolean => anchored.has(key(q)) || (ends.get(key(q)) ?? 0) > (same(q, s[0]) ? 1 : 0) + (same(q, s[1]) ? 1 : 0);
        const cut = (q: Point, r: Point): Point | undefined => {
          let best: Point | undefined;
          for (const c of stops) {
            if (!on(c, [a, b]) || same(c, q) || !touches(c)) continue;
            if (!best || Math.abs(c.x - q.x) + Math.abs(c.y - q.y) < Math.abs(best.x - q.x) + Math.abs(best.y - q.y)) best = c;
          }
          return best && !same(best, r) ? best : undefined;
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
      if (!changed) return segs;
    }
  }

  const random = (seed: number) => (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };

  it('cuts dead ends exactly as the rule says, round by round, on random wires (straight, slanted, nested and drawn twice)', () => {
    const rnd = random(20261112);
    for (let c = 0; c < 1500; c++) {
      const size = 3 + rnd(6);
      const segs: Seg[] = [];
      for (let i = 1 + rnd(12); i > 0; i--) {
        const a = p(rnd(size), rnd(size));
        const k = rnd(6);
        // Straight, slanted anywhere, or slanted along one line from one point (nested pieces).
        const b = k < 2 ? p(rnd(size), a.y) : k < 4 ? p(a.x, rnd(size)) : k < 5 ? p(rnd(size), rnd(size)) : p(a.x + 2 * (1 + rnd(3)), a.y + 1 + rnd(3));
        segs.push(rnd(2) ? [a, b] : [b, a]);
        if (rnd(5) === 0) segs.push(rnd(2) ? [a, b] : [b, a]);
      }
      const pins = Array.from({ length: rnd(4) }, () => p(rnd(size), rnd(size)));
      const keep = Array.from({ length: rnd(3) }, () => p(rnd(size), rnd(size)));
      expect(pruneDangling(segs, pins, keep), JSON.stringify({ segs, pins, keep })).toEqual(reference(segs, pins, keep));
    }
  });

  it('treats a piece drawn twice as one piece: neither keeps the other\'s end from leading nowhere', () => {
    expect(pruneDangling([[p(0, 0), p(5, 0)], [p(5, 0), p(0, 0)]], [p(0, 0)], [])).toEqual([]);
    expect(pruneDangling([[p(0, 0), p(5, 2)], [p(0, 0), p(5, 2)]], [p(0, 0), p(5, 2)], [])).toEqual([[p(0, 0), p(5, 2)]]);
  });

  it('cuts a chain of 5000 pieces hanging from one pin in one sweep, quickly', () => {
    // A square wave from the pin at (0, 0): every end touches the next piece, the last leads nowhere.
    const pts = [p(0, 0)];
    for (let i = 0; i < 5000; i++) {
      const last = pts[pts.length - 1]!;
      pts.push(i % 2 === 0 ? p(last.x + 1, last.y) : p(last.x, last.y === 0 ? 1 : 0));
    }
    const segs = pts.slice(1).map((q, i): Seg => [pts[i]!, q]);
    const t0 = performance.now();
    expect(pruneDangling(segs, [p(0, 0)], [])).toEqual([]);
    expect(pruneDangling(segs, [p(0, 0), pts[pts.length - 1]!], [])).toEqual(segs);
    // About 10 ms here (it took over nine minutes before); the limit allows for a busy machine.
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('keeps a slanted piece once, however often and whichever way round it is drawn', () => {
    const slanted = [p(0, 0), p(3, 1)];
    expect(normalizeWires([slanted, [p(3, 1), p(0, 0)], slanted, [p(0, 0), p(3, 0)]])).toEqual([[p(0, 0), p(3, 0)], slanted]);
  });

  it('joins a slanted wire only where it passes a grid point exactly', () => {
    const wires = [
      [p(0, 0), p(4, 2)], // passes (2, 1) exactly, and (1, 0.5) between grid points
      [p(2, 1), p(2, 5)], // ends on it at (2, 1): joined
      [p(1, -3), p(1, 3)], // crosses it at (1, 0.5): not joined
    ];
    const isl = findIslands(wires, [p(2, 1), p(3, 1)]);
    expect(isl.wires[1]).toBe(isl.wires[0]);
    expect(isl.wires[2]).not.toBe(isl.wires[0]);
    expect(isl.anchors[0]).toBe(isl.wires[0]);
    expect(isl.anchors[1]).not.toBe(isl.wires[0]);
    expect(isl.at(p(4, 2))).toBe(isl.wires[0]);
    expect(isl.at(p(3, 0))).toBeUndefined();
    // Between grid points the slanted wire is still there: the crossing has both islands.
    expect(isl.allAt({ x: 1, y: 0.5 }).sort()).toEqual([isl.wires[0], isl.wires[2]].sort());
    expect(isl.at({ x: 1, y: 0.5 })).toBe(isl.wires[2]);
  });

  it('finds the islands of 5000 pieces drawn over each other at one point quickly, and they are one island', () => {
    const wires = Array.from({ length: 5000 }, (_, i) => (i % 2 ? [p(0, 0), p(1, 0)] : [p(1, 0), p(0, 0)]));
    const t0 = performance.now();
    const isl = findIslands(wires, [p(0, 0)]);
    // About 10 ms here (12 s before); the limit allows for a busy machine.
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(isl.count).toBe(1);
    expect(junctionPoints(wires, [])).toEqual([p(1, 0), p(0, 0)]);
  });

  it('finds a wire through a box exactly as checking every wire would, looking only near the box (security:F1, the ground symbol\'s place)', () => {
    let seed = 11;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const any = (): Point => p(rnd(21) - 10, rnd(21) - 10);
    for (let round = 0; round < 300; round++) {
      const wires: Point[][] = Array.from({ length: 1 + rnd(30) }, () => {
        const a = any();
        switch (rnd(6)) {
          case 0:
            return [a, p(a.x + rnd(11) - 5, a.y), p(a.x + rnd(11) - 5, a.y + rnd(11) - 5)];
          case 1:
            return [a, p(a.x, a.y + rnd(11) - 5)];
          case 2:
            return [a, any()];
          case 3:
            // Long and slanted: filed under no square, checked by every look.
            return [p(-1000 + rnd(9), -1000), p(1000, 999 - rnd(9))];
          case 4:
            // Off the grid (never drawn by PlainSpice, but readable): checked one by one.
            return [a, p(a.x + (rnd(9) - 4) / 2, a.y + (rnd(9) - 4) / 4)];
          default:
            return [a, a, p(a.x + rnd(3), a.y)];
        }
      });
      const index = new SegmentIndex(wires);
      for (let q = 0; q < 40; q++) {
        const x0 = (rnd(48) - 24) / 2;
        const y0 = (rnd(48) - 24) / 2;
        // Small boxes (a symbol, a name), boxes on grid lines, and boxes too wide to file.
        const box: Box = { x0, y0, x1: x0 + rnd(30) / 4 + (rnd(5) ? 0 : 3000), y1: y0 + rnd(30) / 4 };
        const every = wires.some((w) => segmentsOf(w).some(([a, b]) => segmentCrossesBox(a, b, box)));
        expect(index.crosses(box), JSON.stringify({ wires, box })).toBe(every);
      }
    }
  });

  it('says where two islands cross which one a point is on: the horizontal wire first, then the vertical, then the slanted', () => {
    const wires = [
      [p(-2, 2), p(2, -2)],
      [p(0, -2), p(0, 2)],
      [p(-2, 0), p(2, 0)],
    ];
    const isl = findIslands(wires, []);
    expect(isl.count).toBe(3);
    expect(isl.at(p(0, 0))).toBe(isl.wires[2]);
    expect(isl.allAt(p(0, 0)).sort()).toEqual([0, 1, 2]);
  });
});
