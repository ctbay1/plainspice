/**
 * Every crafted shape the second re-check's reviewers, its skeptics and the fix lane built inside the
 * drawing format's limits opens and takes every edit with work bounded by a fixed amount for each
 * thing it draws (second re-check, P2 and P3; decision 0012's budget). Counted, not timed, the same
 * on any machine: checks of a box against a box or a piece of wire (geometry.ts, boxesOverlap and
 * segmentCrossesBox) and lookups of the wires at a point (connectivity.ts, SegmentIndex.at), against
 * the size of the drawing (its drawing lines, pieces of wire, junctions, names and ground symbols).
 * Before the fixes, the 60 parts piled on one point with 1900 names took 386 million checks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTEBOOK_OPTIONS } from '../../src/notebook/schematic.ts';
import { SegmentIndex } from '../../src/schematic/connectivity.ts';
import { applyEdit, buildSchematic, schematicConnectivity, type EditOp, type Schematic } from '../../src/schematic/index.ts';
import { block, groundRowsAndWave, latticeAround, latticeAbove, longSlantedFar, namedGrid, namedStubs, ownNodesAtPoint, partsAtOnePoint, piled, slantedLattice, slantedOverParts, starAtOnePoint } from './schematic-hostile.ts';

const work = vi.hoisted(() => ({ checks: 0 }));

vi.mock('../../src/schematic/geometry.ts', async (importOriginal) => {
  const g = await importOriginal<typeof import('../../src/schematic/geometry.ts')>();
  return {
    ...g,
    boxesOverlap: (...args: Parameters<typeof g.boxesOverlap>): boolean => {
      work.checks++;
      return g.boxesOverlap(...args);
    },
    segmentCrossesBox: (...args: Parameters<typeof g.segmentCrossesBox>): boolean => {
      work.checks++;
      return g.segmentCrossesBox(...args);
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const DIVIDER = ['* divider', 'V1 in 0 6', 'R1 in out 1k', 'R2 out 0 2k', '.op', '* plainspice-drawing v1', '*@ V1 0 3 0 m', '*@ R1 4 0 270', '*@ R2 7 3 0'];
const wire = (points: readonly (readonly [number, number])[]): string => `*@ wire ${points.map(([x, y]) => `${x},${y}`).join(' ')}`;
const divider = (lines: readonly string[]): string => `${[...DIVIDER, ...lines, '.end'].join('\n')}\n`;

/** A k × k grid of points on ground's pin, every point joined (straight copper). */
function grid(k: number): string {
  const lines: string[] = [];
  for (let j = 0; j < k; j++) lines.push(wire(Array.from({ length: k }, (_, i) => [7 + i, 5 + j] as const)));
  for (let i = 0; i < k; i++) lines.push(wire(Array.from({ length: k }, (_, j) => [7 + i, 5 + j] as const)));
  return divider(lines);
}

/** A frame on out's pin with k lines across it each way: k² crossings. */
function crossing(k: number): string {
  const n = k + 1;
  const lines = [wire([[7, 1], [9, 1]]), wire([[9, 1], [9 + n, 1], [9 + n, 1 + n], [9, 1 + n], [9, 1]])];
  for (let j = 1; j <= k; j++) lines.push(wire([[9, 1 + j], [9 + n, 1 + j]]));
  for (let i = 1; i <= k; i++) lines.push(wire([[9 + i, 1], [9 + i, 1 + n]]));
  return divider(lines);
}

/** A slanted zigzag of `pieces` pieces in rows of 1979, hanging from out's pin, its far end named out. */
function chain(pieces: number): string {
  const pts: [number, number][] = [[7, 1]];
  let [x, y, dir] = [7, 1, 1];
  for (let i = 0; i < pieces; i++) {
    if (i && i % 1979 === 0) {
      y -= 4;
      dir = -dir;
      pts.push([x, y]);
    }
    x += dir;
    y += i % 2 ? -1 : 1;
    pts.push([x, y]);
  }
  return divider([wire(pts), `*@ label out ${x} ${y}`]);
}

/** Every part inside one 4 × 4 square, turned every way (the parts' pins on others' pins). */
function partsInASquare(n: number): string {
  const out = ['*', 'V1 1 0 1'];
  for (let i = 2; i <= n; i++) out.push(`R${i} ${i - 1} ${i} 1`);
  out.push('.op', '*@ V1 0 0 0');
  for (let i = 2; i <= n; i++) out.push(`*@ R${i} ${(i % 4) - 2} ${(Math.floor(i / 4) % 4) - 2} ${[0, 90, 180, 270][Math.floor(i / 16) % 4]}`);
  return `${out.join('\n')}\n`;
}

/** 1600 ground symbols (or names) on a 40 × 40 joined mesh on ground's pin. */
function meshWith(kind: 'grounds' | 'names', count: number): string {
  const lines: string[] = [];
  for (let j = 0; j < 40; j++) lines.push(wire(Array.from({ length: 40 }, (_, i) => [7 + i, 5 + j] as const)));
  for (let i = 0; i < 40; i++) lines.push(wire(Array.from({ length: 40 }, (_, j) => [7 + i, 5 + j] as const)));
  for (let k = 0; k < count; k++) lines.push(kind === 'grounds' ? `*@ ground ${7 + (k % 40)} ${5 + (Math.floor(k / 40) % 40)} 0` : `*@ label ${k % 2 ? 'out' : 'in'} ${7 + (k % 40)} ${5 + (Math.floor(k / 40) % 40)}`);
  return divider(lines);
}

/** Frames at ±2000, the edge of the coordinates, on ground's pin. */
const bigFrame = (): string => divider([wire([[7, 5], [7, 2000], [2000, 2000], [2000, -2000], [-2000, -2000], [-2000, 2000], [7, 2000]])]);

/**
 * A wheel: a diamond ring of 4r points, each joined by a spoke (slanted but four) to a hub with a ground
 * symbol on it, away from the parts (4r wire ends at one point; a spoke through another node's pin
 * would join the two, as slanted copper cannot be cut).
 */
function wheel(r: number): string {
  const ring: (readonly [number, number])[] = [];
  for (let k = 0; k < 4 * r; k++) {
    const [s, t] = [Math.floor(k / r), k % r];
    const [x, y] = s === 0 ? [r - t, t] : s === 1 ? [-t, r - t] : s === 2 ? [-r + t, -t] : [t, -r + t];
    ring.push([300 + x, 300 + y]);
  }
  return divider(['*@ ground 300 300 0', wire([...ring, ring[0]!]), ...ring.map((p) => wire([[300, 300], p]))]);
}

/** Two serpentine lines on ground's pin, one across and one down a k × k square: k² crossings from two drawing lines. */
function serpentine(k: number): string {
  const across: [number, number][] = [[7, 5]];
  const down: [number, number][] = [[7, 5]];
  for (let j = 0; j <= k + 1; j++) across.push(...((j % 2 ? [[8 + k, 5 + j], [7, 5 + j]] : [[7, 5 + j], [8 + k, 5 + j]]) as [number, number][]));
  for (let i = 0; i <= k + 1; i++) down.push(...((i % 2 ? [[7 + i, 6 + k], [7 + i, 5]] : [[7 + i, 5], [7 + i, 6 + k]]) as [number, number][]));
  return divider([wire(across), wire(down)]);
}

/** The reviewer's 861-character link: 60 parts at one point, their nodes named with 500 characters each. */
function longNames(n: number): string {
  const name = (i: number): string => `n${i}${'x'.repeat(498 - String(i).length)}`;
  const out = ['*', `V1 ${name(1)} 0 1`];
  for (let i = 2; i <= n; i++) out.push(`R${i} ${name(i - 1)} ${name(i)} 1`);
  out.push('.op', '*@ V1 0 0 0');
  for (let i = 2; i <= n; i++) out.push(`*@ R${i} 0 0 0`);
  return `${out.join('\n')}\n`;
}

const SHAPES: [string, () => string][] = [
  ['60 parts at one point', () => partsAtOnePoint(60)],
  ['60 parts at one point, 1900 names of every node there', () => partsAtOnePoint(60, piled('names', 1900))],
  ['60 parts at one point, 1900 names over a 4 × 4 square', () => partsAtOnePoint(60, piled('names', 1900, { spread: true }))],
  ['60 parts at one point, 1900 ground symbols there', () => partsAtOnePoint(60, piled('grounds', 1900))],
  ['60 parts at one point, 1900 ground symbols over a 4 × 4 square', () => partsAtOnePoint(60, piled('grounds', 1900, { spread: true }))],
  ['60 parts inside one 4 × 4 square, turned every way', () => partsInASquare(60)],
  ['a slanted lattice of 70 × 70 points (a 30 kB link)', () => slantedLattice(70)],
  ['a straight grid of 70 × 70 points', () => grid(70)],
  ['a straight grid of 100 × 100 points (saved work of 122 kB, the reviewer’s heaviest)', () => grid(100)],
  ['a wheel of 280 spokes from one point', () => wheel(70)],
  ['two serpentine lines crossing 9,604 times', () => serpentine(98)],
  ['60 parts at one point, their nodes named with 500 characters (the 861-character link)', () => longNames(60)],
  ['a frame crossed by 98 lines each way (9,604 crossings)', () => crossing(98)],
  ['a slanted chain of 9,900 pieces', () => chain(9900)],
  ['1600 ground symbols on a joined mesh', () => meshWith('grounds', 1600)],
  ['1900 names on a joined mesh', () => meshWith('names', 1900)],
  ['a frame at ±2000', bigFrame],
  ['ground rows and a 9,900-piece wave (the first critic’s 31 kB link)', () => groundRowsAndWave(25, 199, 9900)],
  // The second re-check's critic: long slanted pieces far from the parts were checked by every look
  // (28 million checks with the 60 parts at one point, 65 million with 1650 names in a block too).
  ['60 parts at one point, 159 long slanted pieces far away', () => partsAtOnePoint(60, longSlantedFar())],
  ['60 parts at one point, 1650 ground symbols in a block round them, 159 long slanted pieces', () => partsAtOnePoint(60, [...block('grounds', 1650), ...longSlantedFar()])],
  ['60 parts at one point, 1650 names in a block round them, 159 long slanted pieces', () => partsAtOnePoint(60, [...block('names', 1650), ...longSlantedFar()])],
  ['60 parts at one point, 170 long slanted pieces whose boxes cover where the parts go', () => partsAtOnePoint(60, slantedOverParts())],
  ['60 parts with their own nodes at one point, 1650 ground symbols in a block, 159 long slanted pieces', () => ownNodesAtPoint(60, [...block('grounds', 1650), ...longSlantedFar()])],
  // More of the same kind, built to find what the critic's did not: 115 routes beside a 99 × 99 grid
  // (each route found every island again), a slanted lattice round the parts that touches nothing (no
  // place near them is free), a lattice hanging from V1's pin (each route of node 1 started from the
  // whole lattice), and 900 names that stay, each on a piece of wire of its own.
  ['60 parts between node 1 and ground at one point, a 99 × 99 grid named 1 far away', () => starAtOnePoint(60, namedGrid(99, '1'))],
  ['60 parts at one point inside a slanted lattice that touches none of them', () => partsAtOnePoint(60, latticeAround(70))],
  ['60 parts between node 1 and ground at one point, a slanted lattice hanging from V1’s pin', () => starAtOnePoint(60, latticeAbove(70))],
  ['60 parts at one point, 900 names each on its own piece of wire far away', () => partsAtOnePoint(60, namedStubs(900))],
];

/**
 * What the drawing holds: its drawing lines and the pieces of wire they draw (the repairs may drop
 * some, a lattice touching nothing, say, but every build reads them and keeps clear of them until
 * then), and what the scene draws (pieces of wire, dots, hops, names, symbols).
 */
function size(text: string, s: Schematic): number {
  const sc = s.scene;
  const lines = text.split('\n').filter((l) => l.startsWith('*@'));
  const drawn = lines.reduce((n, l) => n + (/^\*@ wire /.test(l) ? l.trim().split(/\s+/).length - 3 : 0), 0);
  return lines.length + drawn + sc.wires.reduce((n, w) => n + w.points.length - 1, 0) + sc.junctions.length + sc.crossings.length + sc.nodeLabels.length + sc.parts.length + sc.grounds.length;
}

/** Checks and point lookups a piece of work makes. */
function counted<T>(f: () => T): { result: T; work: number } {
  const at = vi.spyOn(SegmentIndex.prototype, 'at');
  work.checks = 0;
  const result = f();
  const lookups = at.mock.calls.length;
  at.mockRestore();
  return { result, work: work.checks + lookups };
}

/** One of each edit the editor makes, on R1 and R2 (or the first parts drawn) and the first node. */
function edits(s: Schematic): [string, EditOp][] {
  const parts = s.scene.parts;
  const p1 = parts.find((p) => p.key === 'r1') ?? parts[1] ?? parts[0]!;
  const p2 = parts.find((p) => p.key === 'r2') ?? parts[2] ?? parts[0]!;
  const node = [...s.circuit.nodes.keys()].find((n) => n !== '0') ?? '0';
  const label = s.drawing.labels[0];
  return [
    ['move', { kind: 'move-part', part: p1.key, to: { x: p1.at.x, y: p1.at.y - 3 } }],
    ['turn', { kind: 'rotate-part', part: p1.key }],
    ['mirror', { kind: 'mirror-part', part: p1.key }],
    ['wire', { kind: 'add-wire', from: { part: p1.key, pin: 0 }, to: { part: p2.key, pin: 1 } }],
    ['delete a wire', { kind: 'delete-wire', wire: 0 }],
    ['delete', { kind: 'delete-part', part: p2.key }],
    ['rename', { kind: 'rename-node', node, name: 'zz' }],
    ['disconnect', { kind: 'disconnect-pin', part: p2.key, pin: 1 }],
    ['move a name', label ? { kind: 'move-label', node: label.node, to: { x: label.at.x + 1, y: label.at.y } } : { kind: 'move-label', node, side: 'below-left' }],
  ];
}

describe('crafted shapes at the format’s limits: work bounded for each thing drawn (second re-check)', () => {
  it.each(SHAPES)('%s: opens, and takes every edit (and an undo: an opening), with at most a fixed amount of work for each thing it draws', { timeout: 240_000 }, (_, make) => {
    const text = make();
    const opened = counted(() => buildSchematic(text, NOTEBOOK_OPTIONS));
    const s = opened.result;
    expect(schematicConnectivity(s)).toEqual([]);
    const n = size(text, s);
    // Opening: at most 4,000 checks and lookups for each thing drawn. The parts piled on one point
    // make about 2,700 each (each part moved tries up to 48 × 36 places); wire, about 10 to 30 for
    // each piece; 1900 names piled at one point were 175,000 each before the fixes.
    expect(opened.work).toBeLessThan(4000 * n);
    for (const [name, op] of edits(s)) {
      const edited = counted(() => {
        const r = applyEdit(s, op, NOTEBOOK_OPTIONS);
        // What the page does next: the drawing of the new text. (An undo builds the old text again:
        // the opening's work.)
        if (r.ok) buildSchematic(r.text, NOTEBOOK_OPTIONS);
        return r;
      });
      // An edit builds the drawing two to four times, and the page once more, and compares what
      // overlaps a few times: at most ten openings' work, and a little for each thing drawn (about 9
      // openings and 70 for each thing on 1,600 ground symbols, where each comparison of every pair
      // was 3.75 million before).
      expect(edited.work, name).toBeLessThan(10 * opened.work + 100 * n + 50_000);
    }
  });
});
