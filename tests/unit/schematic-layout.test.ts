/**
 * src/schematic/layout.ts and schematic.ts: the automatic layout on the channel's circuits
 * (examples/*\/*.cir) and the fixtures (tests/fixtures/*.cir). Each must lay out cleanly: nothing
 * overlaps, wires are orthogonal on the grid, the drawing connects exactly what the netlist does,
 * and it reads like a textbook drawing (ground rail at the bottom, the first source on the left,
 * upright, + at the top, series parts along the top, terminals on the right ...). The test corpus
 * and seeded random circuits must never break the connectivity.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSchematic,
  checkConnectivity,
  findOverlaps,
  isUpright,
  junctionPoints,
  placedPart,
  schematicConnectivity,
  type Point,
  type Schematic,
} from '../../src/schematic/index.ts';
import { segmentsOf } from '../../src/schematic/geometry.ts';

const segmentsOfWires = (wires: readonly Point[][]): [Point, Point][] => wires.flatMap((w) => segmentsOf(w));

const root = resolve(import.meta.dirname, '../..');
const cir = (dir: string): string[] =>
  readdirSync(join(root, dir))
    .filter((f) => f.endsWith('.cir'))
    .sort()
    .map((f) => join(dir, f));
const EXAMPLES = readdirSync(join(root, 'examples'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => cir(`examples/${d.name}`));
const FIXTURES = cir('tests/fixtures');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const build = (path: string): Schematic => buildSchematic(read(path));
const sp = (s: string): string => s.replace(/ /g, ' ');

describe.each([...EXAMPLES, ...FIXTURES])('%s', (path) => {
  const s = build(path);

  it('is laid out automatically, every part placed', () => {
    expect(s.origin).toBe('auto');
    expect(s.scene.parts.map((p) => p.key)).toEqual(s.circuit.parts.map((p) => p.key));
    expect(s.problems).toEqual([]);
  });

  it('connects exactly what the netlist connects', () => {
    expect(schematicConnectivity(s)).toEqual([]);
  });

  it('overlaps nothing: symbols, wires and words stay apart', () => {
    expect(findOverlaps(s.scene)).toEqual([]);
  });

  it('draws orthogonal wires on the grid, with junction dots exactly where three or more meet', () => {
    for (const [a, b] of segmentsOfWires(s.drawing.wires)) {
      expect(a.x === b.x || a.y === b.y).toBe(true);
      for (const v of [a.x, a.y, b.x, b.y]) expect(Number.isInteger(v)).toBe(true);
    }
    for (const p of s.drawing.parts.values()) {
      expect(Number.isInteger(p.at.x) && Number.isInteger(p.at.y)).toBe(true);
    }
    const pins = [...s.scene.parts.flatMap((p) => p.pins.map((q) => q.at)), ...s.scene.grounds.map((g) => g.at)];
    expect(s.scene.junctions).toEqual(junctionPoints(s.drawing.wires, pins));
  });

  it('names every node once (ground has its symbol)', () => {
    const named = s.drawing.labels.map((l) => l.node).sort();
    const nodes = [...s.circuit.nodes.keys()].filter((n) => n !== '0' || !s.circuit.hasGround).sort();
    expect(named).toEqual(nodes);
  });

  it('puts the ground rail at the bottom, under everything but its symbol', () => {
    if (!s.circuit.hasGround) {
      expect(s.drawing.grounds).toEqual([]);
      return;
    }
    expect(s.drawing.grounds).toHaveLength(1);
    const g = s.drawing.grounds[0]!;
    expect(g.rot).toBe(0);
    for (const p of s.scene.parts) expect(p.box.y1).toBeLessThanOrEqual(g.at.y);
  });

  it('stands the first independent source on the left, upright, + at the top unless + is ground', () => {
    const source = s.circuit.parts.find((p) => p.letter === 'V' || p.letter === 'I');
    if (!source) return;
    const placed = s.drawing.parts.get(source.key)!;
    expect(isUpright(placed.rot)).toBe(true);
    const left = Math.min(...s.scene.parts.map((p) => p.at.x));
    expect(placed.at.x).toBe(left);
    // Pin 0 (+ for V, "from" for I) is at the top exactly when it is not the bottom rail's node.
    const top = placed.rot === 0 ? 0 : 1;
    expect(source.nodes[top]).not.toBe(s.circuit.hasGround ? '0' : source.nodes[1 - top]);
  });

  it('lays out the same way every time', () => {
    const again = build(path);
    expect(JSON.stringify([...again.drawing.parts], null, 0)).toBe(JSON.stringify([...s.drawing.parts]));
    expect(again.drawing.wires).toEqual(s.drawing.wires);
    expect(again.drawing.labels).toEqual(s.drawing.labels);
  });
});

describe('textbook shapes', () => {
  it('p01-1: V1 left, R1 along the top, R2 and I1 down to the rail, I1 pointing up into n2', () => {
    const s = build('examples/p01/p01-1-source-to-ground.cir');
    const r1 = placedPart(s, 'R1')!;
    expect(r1.rot === 90 || r1.rot === 270).toBe(true);
    expect(r1.at.y).toBe(0);
    for (const name of ['V1', 'R2', 'I1']) expect(isUpright(placedPart(s, name)!.rot)).toBe(true);
    expect(placedPart(s, 'I1')!.arrow.direction).toBe('up');
    expect(placedPart(s, 'V1')!.at.x).toBeLessThan(r1.at.x);
    expect(r1.at.x).toBeLessThan(placedPart(s, 'R2')!.at.x);
  });

  it('e04-1: V2 0 s2 stands with + at the bottom (its + side is ground)', () => {
    const s = build('examples/e04/e04-1-two-sources.cir');
    const v2 = placedPart(s, 'V2')!;
    expect(v2.rot).toBe(180);
    expect(v2.marks.find((m) => m.text === '+')!.at.y).toBeGreaterThan(v2.at.y);
  });

  it('e04-3: parts in parallel stand side by side', () => {
    const s = build('examples/e04/e04-3-short.cir');
    const xs = ['I2', 'R4', 'Vshort'].map((n) => placedPart(s, n)!.at);
    expect(new Set(xs.map((p) => p.y)).size).toBe(1);
    expect(new Set(xs.map((p) => p.x)).size).toBe(3);
  });

  it('p02-1 and e04-4: the open terminal a ends the top rail on the right, with its name', () => {
    for (const path of ['examples/p02/p02-1-open.cir', 'examples/e04/e04-4-open.cir']) {
      const s = build(path);
      const t = s.scene.terminals.find((x) => x.node === 'a')!;
      expect(t.at.y).toBe(0);
      expect(t.at.x).toBe(Math.max(...s.drawing.wires.flatMap((w) => w.map((p) => p.x))));
      const label = s.scene.nodeLabels.find((l) => l.node === 'a')!;
      expect(label.terminal).toBe(true);
      expect(label.box.x0).toBeGreaterThan(t.at.x);
    }
  });

  it('e04-4 and e04-5: R2 and H1 stand in one column below n1; the short sits at a on the right', () => {
    for (const path of ['examples/e04/e04-4-open.cir', 'examples/e04/e04-5-short.cir']) {
      const s = build(path);
      const r2 = placedPart(s, 'R2')!;
      const h1 = placedPart(s, 'H1')!;
      expect(r2.at.x).toBe(h1.at.x);
      expect(r2.at.y).toBeLessThan(h1.at.y);
      // H1 0 m: its + side (pin 0) is ground, at the bottom.
      expect(h1.rot).toBe(180);
    }
    const s5 = build('examples/e04/e04-5-short.cir');
    const r3 = placedPart(s5, 'R3')!;
    expect(r3.at.y).toBe(0);
    expect(placedPart(s5, 'Vshort')!.at.x).toBeGreaterThan(r3.at.x);
  });

  it('p01-2: Rd, between n1 and n3, goes on a rail above the top rail', () => {
    const s = build('examples/p01/p01-2-supernode.cir');
    expect(placedPart(s, 'Rd')!.at.y).toBeLessThan(0);
    expect(placedPart(s, 'Ra')!.at.y).toBe(0);
    expect(placedPart(s, 'Vs')!.at.y).toBe(0);
  });

  it('p01-3: H1, in parallel with Rp, goes above it', () => {
    const s = build('examples/p01/p01-3-ccvs-supernode.cir');
    const rp = placedPart(s, 'Rp')!;
    const h1 = placedPart(s, 'H1')!;
    expect(rp.at.y).toBe(0);
    expect(h1.at.y).toBeLessThan(0);
  });

  it('sp01-3: the four dependent-source circuits stand side by side on one ground rail, controls written as labels', () => {
    const s = build('examples/sp01/sp01-3-dependent-sources.cir');
    expect(s.drawing.grounds).toHaveLength(1);
    const value = (n: string): string => sp(placedPart(s, n)!.labels.find((l) => l.role === 'value')!.text);
    expect(value('E1')).toBe('2 × V(c)');
    expect(value('G1')).toBe('0.5 A/V × V(c)');
    expect(value('F1')).toBe('3 × I(Vs)');
    expect(value('H1')).toBe('4 V/A × I(Vs)');
    // No wire carries a control: c's copper reaches only Vc and Vs.
    const c = s.scene.wires.filter((w) => w.node === 'c');
    expect(c.length).toBeGreaterThan(0);
    expect(s.scene.terminals.map((t) => t.node).sort()).toEqual(['out1', 'out4']);
  });

  it('sp01-4: without ground the rail is the − side of V1, named n3, with no ground symbol', () => {
    const s = build('examples/sp01/sp01-4-no-ground.cir');
    expect(s.drawing.grounds).toEqual([]);
    const n3 = s.drawing.labels.find((l) => l.node === 'n3')!;
    expect(n3.at.y).toBe(Math.max(...s.drawing.wires.flatMap((w) => w.map((p) => p.y))));
  });

  it('sp01-5: the typo shows: R2 stands on the rail with its top open, named n12', () => {
    const s = build('examples/sp01/sp01-5-typo.cir');
    expect(s.scene.terminals.map((t) => t.node)).toEqual(['n12']);
    // The open end is at the top rail's height, straight above R2's pin on n12.
    const r2 = placedPart(s, 'R2')!;
    const pin = r2.pins.find((p) => p.node === 'n12')!;
    expect(pin.outward).toBe('up');
    expect(s.scene.terminals[0]!.at).toEqual({ x: pin.at.x, y: 0 });
  });
});

describe('every netlist of the test corpus', () => {
  const corpus = ['tests/corpus/letters', 'tests/corpus/traps'].flatMap(cir);
  it.each(corpus)('%s lays out with exact connectivity and no overlap', (path) => {
    const s = build(path);
    // Lines the drawing does not show only add 'hidden' notes, one per node they touch.
    const problems = schematicConnectivity(s);
    expect(problems.filter((p) => p.kind !== 'hidden')).toEqual([]);
    expect(problems.map((p) => p.nodes[0]).sort()).toEqual([...s.circuit.nodes.values()].filter((n) => n.hidden.length).map((n) => n.name).sort());
    expect(findOverlaps(s.scene)).toEqual([]);
    expect(s.scene.parts.length).toBe(s.circuit.parts.length);
  });
});

/** A small seeded generator (mulberry32), so the random circuits are the same on every run. */
function random(seed: number): (n: number) => number {
  let a = seed >>> 0;
  return (n: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

function randomNetlist(rnd: (n: number) => number, maxParts = 14, maxNodes = 7): string {
  const letters = ['R', 'R', 'R', 'C', 'L', 'V', 'I', 'E', 'F', 'G', 'H'];
  const nodes = ['0', ...Array.from({ length: 1 + rnd(maxNodes) }, (_, i) => `n${i + 1}`)];
  const lines = ['* random'];
  const count = 1 + rnd(maxParts);
  for (let i = 0; i < count; i++) {
    const letter = letters[rnd(letters.length)]!;
    const a = nodes[rnd(nodes.length)]!;
    let b = nodes[rnd(nodes.length)]!;
    if (rnd(12) > 0) for (let k = 0; k < 4 && b === a; k++) b = nodes[rnd(nodes.length)]!;
    const name = `${letter}${i + 1}`;
    if (letter === 'E' || letter === 'G') lines.push(`${name} ${a} ${b} ${nodes[rnd(nodes.length)]} 0 2`);
    else if (letter === 'F' || letter === 'H') lines.push(`${name} ${a} ${b} V1 2`);
    else lines.push(`${name} ${a} ${b} ${1 + rnd(9)}`);
  }
  lines.push('.op', '.end', '');
  return lines.join('\n');
}

/**
 * An independent check of what a drawing connects, sharing no code with the model: every wire as the
 * set of grid points it covers; wires join where a corner or an end of one lies on the other; pins
 * join the wires through their point and the pins at the same point; ground symbols are all node 0;
 * labels join everything they touch by name. Returns the shorts and opens it finds.
 */
function oracle(s: Schematic): string[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const cover = (w: readonly Point[]): Set<string> => {
    const out = new Set<string>();
    for (let i = 1; i < w.length; i++) {
      const a = w[i - 1]!;
      const b = w[i]!;
      const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      for (let k = 0; k <= n; k++) out.add(`${a.x + Math.sign(b.x - a.x) * k},${a.y + Math.sign(b.y - a.y) * k}`);
    }
    return out;
  };
  const wires = s.drawing.wires.map((w) => ({ all: cover(w), verts: w.map((p) => `${p.x},${p.y}`) }));
  wires.forEach((w, i) => {
    find(`w${i}`);
    wires.forEach((v, j) => {
      if (i !== j && w.verts.some((p) => v.all.has(p))) union(`w${i}`, `w${j}`);
    });
  });
  const pins: { key: string; node: string; at: string }[] = [];
  for (const part of s.circuit.parts) {
    const pl = s.drawing.parts.get(part.key);
    if (!pl) continue;
    // Pins from first principles: 2 units either side of the centre, turned clockwise; mirroring leaves them.
    const d = pl.rot === 0 ? [0, -2] : pl.rot === 90 ? [2, 0] : pl.rot === 180 ? [0, 2] : [-2, 0];
    [
      [pl.at.x + d[0]!, pl.at.y + d[1]!],
      [pl.at.x - d[0]!, pl.at.y - d[1]!],
    ].forEach(([x, y], i) => pins.push({ key: `${part.key}.${i}`, node: part.nodes[i]!, at: `${x},${y}` }));
  }
  s.drawing.grounds.forEach((g, i) => {
    pins.push({ key: `g${i}`, node: '0', at: `${g.at.x},${g.at.y}` });
    union(`p:g${i}`, 'GROUND');
  });
  for (const p of pins) {
    find(`p:${p.key}`);
    wires.forEach((w, i) => {
      if (w.all.has(p.at)) union(`p:${p.key}`, `w${i}`);
    });
    for (const q of pins) if (q !== p && q.at === p.at) union(`p:${p.key}`, `p:${q.key}`);
  }
  for (const l of s.drawing.labels) {
    const at = `${l.at.x},${l.at.y}`;
    wires.forEach((w, i) => {
      if (w.all.has(at)) union(`w${i}`, `L:${l.node}`);
    });
    for (const p of pins) if (p.at === at) union(`p:${p.key}`, `L:${l.node}`);
  }
  union('L:0', 'GROUND');
  const errors: string[] = [];
  const byGroup = new Map<string, Set<string>>();
  const byNode = new Map<string, Set<string>>();
  for (const p of pins) {
    const g = find(`p:${p.key}`);
    (byGroup.get(g) ?? byGroup.set(g, new Set()).get(g)!).add(p.node);
    (byNode.get(p.node) ?? byNode.set(p.node, new Set()).get(p.node)!).add(g);
  }
  for (const [, ns] of byGroup) if (ns.size > 1) errors.push(`short ${[...ns].join(',')}`);
  for (const [n, gs] of byNode) if (gs.size > 1) errors.push(`open ${n}`);
  return errors;
}

/** No symbol on another symbol, no wire through a symbol (words may still touch in odd random circuits). */
const symbolClashes = (s: Schematic): string[] =>
  findOverlaps(s.scene)
    .filter((o) => (o.a.kind === 'part' || o.a.kind === 'ground') && (o.b.kind === 'part' || o.b.kind === 'ground' || o.b.kind === 'wire'))
    .map((o) => `${o.a.kind} ${o.a.id} / ${o.b.kind} ${o.b.id}`);

describe('an independent check of the connectivity', () => {
  const all = [...EXAMPLES, ...FIXTURES, ...['tests/corpus/letters', 'tests/corpus/traps'].flatMap(cir)];
  it.each(all)('%s', (path) => {
    expect(oracle(build(path))).toEqual([]);
  });
});

describe('random circuits', () => {
  it('always connect exactly what their netlist connects, by the model and by the independent check, with no symbol on a symbol or a wire', () => {
    const rnd = random(20261110);
    for (let i = 0; i < 160; i++) {
      const text = randomNetlist(rnd);
      const s = buildSchematic(text);
      expect(checkConnectivity(s.circuit, s.drawing), text).toEqual([]);
      expect(oracle(s), text).toEqual([]);
      expect(symbolClashes(s), text).toEqual([]);
      expect(s.scene.parts.length, text).toBe(s.circuit.parts.length);
    }
  });

  it('lay out a 20-part ladder quickly', () => {
    const lines = ['* ladder', 'V1 n0 0 10'];
    for (let i = 1; i <= 10; i++) {
      lines.push(`R${2 * i - 1} n${i - 1} n${i} 1k`, `R${2 * i} n${i} 0 2k`);
    }
    lines.push('.op', '.end');
    const t0 = performance.now();
    const s = buildSchematic(lines.join('\n'));
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(schematicConnectivity(s)).toEqual([]);
    expect(findOverlaps(s.scene)).toEqual([]);
    // One long ladder: every series resistor on the top rail.
    for (let i = 1; i <= 10; i++) expect(placedPart(s, `R${2 * i - 1}`)!.at.y).toBe(0);
  });
});

describe('the words a style measures itself', () => {
  // A wide monospace-like font: every character 0.6 em, 25 % more than the default for most words.
  const wide = (text: string): number => 0.6 * 0.7 * 1.25 * [...text].length;

  it.each([...EXAMPLES, ...FIXTURES])('%s still lays out with nothing overlapping', (path) => {
    const s = buildSchematic(read(path), { measure: wide });
    expect(findOverlaps(s.scene)).toEqual([]);
    expect(schematicConnectivity(s)).toEqual([]);
    const label = s.scene.parts[0]!.labels.find((l) => l.role === 'name')!;
    expect(label.box.x1 - label.box.x0).toBeCloseTo(wide(label.text) + 0.1, 5);
  });
});

describe('ammeters stand in the branch they measure', () => {
  it('sp01-2: Vm above R2 in one column, in the same order as sp01-1', () => {
    const s = build('examples/sp01/sp01-2-ammeter.cir');
    const vm = placedPart(s, 'Vm')!;
    const r2 = placedPart(s, 'R2')!;
    expect(vm.at.x).toBe(r2.at.x);
    expect(vm.at.y).toBeLessThan(r2.at.y);
    expect(r2.at.x).toBeLessThan(placedPart(s, 'I1')!.at.x);
    const one = build('examples/sp01/sp01-1-example-1.cir');
    expect(placedPart(one, 'R2')!.at.x).toBeLessThan(placedPart(one, 'I1')!.at.x);
  });

  it('e04-5: a 0 V short across terminal a stays at the right end of the top rail', () => {
    const s = build('examples/e04/e04-5-short.cir');
    expect(placedPart(s, 'R3')!.at.y).toBe(0);
  });
});
