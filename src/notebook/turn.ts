/**
 * A drawing turned a quarter clockwise, for a phone held upright. Textbook circuits are wide and
 * short (a ladder: the source on the left, ground along the bottom), and a phone is narrow and tall:
 * at a size where its words can be read, p02's circuits are half again as wide as the screen. Turned,
 * the ladder stands up (the source at the top, ground down the left side) and fits whole, its words
 * still upright and as large as on a computer.
 *
 * This only changes what the phone shows: the drawing kept in the netlist (decision 0013) is not
 * touched, and a phone held sideways shows it as it is. The parts' places and the wires are turned;
 * the parts' words, the node names and the ground symbol are placed again by the schematic model
 * (reconcile, buildScene). A turned drawing is used only when nothing in it overlaps, it connects
 * exactly what the netlist does, and it has no more bends in its wires than the drawing as drawn:
 * a turn that steps the ground wire is worse than no turn. Plain TypeScript.
 */
import {
  buildScene,
  checkConnectivity,
  findOverlaps,
  partByKey,
  partGeometry,
  pt,
  reconcile,
  type Drawing,
  type PartPlacement,
  type Point,
  type Rotation,
  type Schematic,
} from '../schematic/index.ts';

/** A point turned a quarter clockwise, after its distance from the top rail is stretched by `k`. */
const turner =
  (k: number) =>
  (p: Point): Point =>
    pt(-p.y * k, p.x);

const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/**
 * The bends in a drawing's wires: points where exactly two pieces of wire meet at a right angle
 * (a junction or a wire's end is not a bend), however the wires are split into polylines.
 */
export function wireBends(wires: readonly (readonly Point[])[]): number {
  const ways = new Map<string, Set<string>>();
  const add = (p: Point, dir: string): void => {
    const key = `${p.x},${p.y}`;
    let set = ways.get(key);
    if (!set) ways.set(key, (set = new Set()));
    set.add(dir);
  };
  for (const w of wires) {
    for (let i = 1; i < w.length; i++) {
      const a = w[i - 1]!;
      const b = w[i]!;
      if (same(a, b)) continue;
      // Every grid point along the piece, so a corner in the middle of another wire's piece counts too.
      const dx = Math.sign(b.x - a.x);
      const dy = Math.sign(b.y - a.y);
      const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      for (let s = 0; s < steps; s++) {
        const p = pt(a.x + dx * s, a.y + dy * s);
        const q = pt(p.x + dx, p.y + dy);
        add(p, dx ? (dx > 0 ? 'r' : 'l') : dy > 0 ? 'd' : 'u');
        add(q, dx ? (dx > 0 ? 'l' : 'r') : dy > 0 ? 'u' : 'd');
      }
    }
  }
  let bends = 0;
  for (const set of ways.values()) {
    if (set.size !== 2) continue;
    const [a, b] = [...set] as [string, string];
    const horizontal = (d: string): boolean => d === 'l' || d === 'r';
    if (horizontal(a) !== horizontal(b)) bends += 1;
  }
  return bends;
}

function turnedBy(s: Schematic, k: number): Schematic | undefined {
  const turn = turner(k);
  const parts = new Map<string, PartPlacement>();
  // Stretching moves a part's pins apart, but not the part's own pins: a part lying along the stretch
  // gets its leads lengthened by straight pieces of wire, so every wire still meets its pin and the
  // router has nothing to redraw (it would step the ground wire round each part).
  const leads: Point[][] = [];
  for (const [key, p] of s.drawing.parts) {
    const placed: PartPlacement = { at: turn(p.at), rot: ((p.rot + 90) % 360) as Rotation, mirror: false };
    parts.set(key, placed);
    const part = partByKey(s.circuit, key);
    if (!part) continue;
    const before = partGeometry(part, p).pins;
    const after = partGeometry(part, placed).pins;
    before.forEach((pin, i) => {
      const want = turn(pin);
      const got = after[i]!;
      if (!same(want, got)) leads.push([got, want]);
    });
  }
  const turned: Drawing = {
    parts,
    // The ground symbol and the node names are placed again: turned, they would point sideways.
    grounds: [],
    wires: [...s.drawing.wires.map((w) => w.map(turn)), ...leads],
    labels: s.drawing.labels.map((l) => ({ node: l.node, at: turn(l.at) })),
  };
  try {
    const drawing = reconcile(s.circuit, turned, [], s.options);
    const scene = buildScene(s.circuit, drawing, s.options);
    if (findOverlaps(scene).length) return undefined;
    if (checkConnectivity(s.circuit, drawing).some((c) => c.kind !== 'hidden')) return undefined;
    if (wireBends(drawing.wires) > wireBends(s.drawing.wires)) return undefined;
    return { ...s, drawing, scene, problems: [] };
  } catch {
    return undefined;
  }
}

/**
 * The schematic with its drawing turned a quarter clockwise, or undefined when no turned drawing is
 * clean. When the parts' words do not fit between the rails once turned (a source's long control
 * label, say), the rails are first set twice as far apart, the parts' leads lengthened to reach them.
 */
export function turnedQuarter(s: Schematic): Schematic | undefined {
  if (!s.scene.parts.length) return undefined;
  return turnedBy(s, 1) ?? turnedBy(s, 2);
}

/** True when a drawing's box is more than `factor` times wider than tall (a phone held upright would rather see it turned). */
export const isWide = (s: Schematic, factor = 1.4): boolean => {
  const b = s.scene.bounds;
  return b.x1 - b.x0 > factor * (b.y1 - b.y0);
};
