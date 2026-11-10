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
  type Point,
  type RouteWorld,
} from '../../src/schematic/index.ts';

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
