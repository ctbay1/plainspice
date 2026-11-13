/**
 * Crafted drawings at the format's limits build with work that grows with the drawing, never with
 * its square (second re-check, P3). A time limit that allows for a busy machine cannot tell the work
 * apart (schematic-ground-search.test.ts), so this file counts it, the same on any machine: scenes
 * built (scene.ts, buildScene), checks of a box against a box or a piece of wire (geometry.ts,
 * boxesOverlap and segmentCrossesBox), symbol geometries made to try a place (drawing.ts,
 * symbolGeometry), sorts, and passes over the wires that cut dead ends (wires.ts, pruneDangling).
 *
 * - 60 parts at one point (a 542-character link): every part but one moves. Reconcile's first step
 *   built a scene for each part it moved (59), each with every name and ground symbol the lines pile
 *   there: with 1900 names, 37 to 47 s on a computer and 164 s on a phone slowed four times.
 * - Names and ground symbols piled at one point or spread over one 4 × 4 square.
 * - A pin on slanted copper, which a cut cannot free: the repair went round fifty times.
 * - Overlaps of 1,600 ground symbols: every pair was compared.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTEBOOK_OPTIONS } from '../../src/notebook/schematic.ts';
import { applyEdit, buildSchematic, buildScene, findOverlaps, schematicConnectivity, type Schematic } from '../../src/schematic/index.ts';
import { partsAtOnePoint, piled, slantedLattice } from './schematic-hostile.ts';

const work = vi.hoisted(() => ({ scenes: 0, checks: 0, geometries: 0, prunes: 0 }));

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

vi.mock('../../src/schematic/scene.ts', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/schematic/scene.ts')>();
  return {
    ...m,
    buildScene: (...args: Parameters<typeof m.buildScene>): ReturnType<typeof m.buildScene> => {
      work.scenes++;
      return m.buildScene(...args);
    },
  };
});

vi.mock('../../src/schematic/drawing.ts', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/schematic/drawing.ts')>();
  return {
    ...m,
    symbolGeometry: (...args: Parameters<typeof m.symbolGeometry>): ReturnType<typeof m.symbolGeometry> => {
      work.geometries++;
      return m.symbolGeometry(...args);
    },
  };
});

vi.mock('../../src/schematic/wires.ts', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/schematic/wires.ts')>();
  return {
    ...m,
    pruneDangling: (...args: Parameters<typeof m.pruneDangling>): ReturnType<typeof m.pruneDangling> => {
      work.prunes++;
      return m.pruneDangling(...args);
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** What a piece of work counts (see the top of the file), from zero. */
function counted<T>(f: () => T): { result: T; scenes: number; checks: number; geometries: number; prunes: number } {
  work.scenes = 0;
  work.checks = 0;
  work.geometries = 0;
  work.prunes = 0;
  const result = f();
  return { result, ...work };
}

const build = (text: string): Schematic => buildSchematic(text, NOTEBOOK_OPTIONS);
const moved = (s: Schematic): number => s.problems.filter((p) => p.kind === 'moved-part').length;

describe('parts piled on one point move from one scene (second re-check, P3)', () => {
  it('30 or 60 parts at one point: the same few scenes, whatever the number of parts moved', { timeout: 60_000 }, () => {
    const thirty = counted(() => build(partsAtOnePoint(30)));
    const sixty = counted(() => build(partsAtOnePoint(60)));
    expect(moved(thirty.result)).toBe(29);
    expect(moved(sixty.result)).toBe(59);
    // One scene to place the parts that move, then those the repairs and the page need: 63 scenes for
    // 60 parts before (one for each part moved), 33 for 30.
    expect(sixty.scenes).toBe(thirty.scenes);
    expect(sixty.scenes).toBeLessThanOrEqual(6);
    for (const s of [thirty.result, sixty.result]) {
      expect(schematicConnectivity(s)).toEqual([]);
      // No symbol on another, and drawn together: not in one long row (a first prototype drew the 60 in
      // a row of 358 × 11 squares; one scene each drew them in 56 × 61).
      expect(findOverlaps(s.scene).filter((o) => (o.a.kind === 'part' || o.a.kind === 'ground') && (o.b.kind === 'part' || o.b.kind === 'ground'))).toEqual([]);
      const b = s.scene.bounds;
      expect(Math.max(b.x1 - b.x0, b.y1 - b.y0)).toBeLessThan(90);
    }
  });

  it('a place for a part is tried without making a symbol for each place tried', { timeout: 60_000 }, () => {
    // 59 parts moved, each tried at up to 48 × 36 places in four turns: one symbol geometry for each
    // place tried was 198,000 for this drawing.
    const sixty = counted(() => build(partsAtOnePoint(60)));
    expect(sixty.geometries).toBeLessThan(20_000);
  });
});

describe('names and ground symbols piled on one point or one square cost what the lines do, not their square (P3)', () => {
  // The extra work of each pile over the 60 parts alone, at 950 and at 1900 lines: piled lines cost a
  // few checks each (they are read, and those that say the same as another go), never one check for
  // each line already there. Before, 1900 names at the point made 63 scenes place each name against
  // all the others: 46.6 s of work here; 1900 ground symbols, 11 s.
  const piles: [string, (n: number) => string[]][] = [
    ['names of every node at the point', (n) => piled('names', n)],
    ['the name of one node at the point', (n) => piled('names', n, { oneNode: true })],
    ['names of every node over a 4 × 4 square', (n) => piled('names', n, { spread: true })],
    ['ground symbols at the point', (n) => piled('grounds', n)],
    ['ground symbols over a 4 × 4 square, turned every way', (n) => piled('grounds', n, { spread: true })],
  ];
  const alone = (): ReturnType<typeof counted> => counted(() => build(partsAtOnePoint(60)));

  it.each(piles)('%s', { timeout: 120_000 }, (_, lines) => {
    const base = alone();
    const half = counted(() => build(partsAtOnePoint(60, lines(950))));
    const full = counted(() => build(partsAtOnePoint(60, lines(1900))));
    expect(schematicConnectivity(full.result)).toEqual([]);
    expect(full.scenes).toBeLessThanOrEqual(base.scenes + 1);
    // At most 300 checks for each line piled (a name of a node over a square that the repairs move
    // next to its copper, say), and no more for the second 950 lines than for the first.
    expect(full.checks - base.checks).toBeLessThan(300 * 1900);
    expect(full.checks - half.checks).toBeLessThanOrEqual(Math.max(1000, 1.2 * (half.checks - base.checks)));
  });
});

describe('the repairs stop when a round changes nothing (P3)', () => {
  it('a pin on a slanted lattice at the format’s limits, which a cut cannot free: a few rounds, not fifty', { timeout: 60_000 }, () => {
    const s = build(slantedLattice(70, true));
    expect(s.drawing.wires.reduce((n, w) => n + w.length - 1, 0)).toBeGreaterThan(9000);
    // Disconnecting R2 from ground leaves ground's lattice on R2's pin, on slanted copper that a cut
    // cannot take off it: the edit is refused (the drawing would not connect what the netlist does).
    // Each rebuild the edit makes cut dead ends after each round of the repair, 50 rounds each: 150
    // passes over the 9,666 pieces, a second and a half here.
    const r = counted(() => applyEdit(s, { kind: 'disconnect-pin', part: 'r2', pin: 1 }, NOTEBOOK_OPTIONS));
    expect(r.result.ok).toBe(false);
    expect(r.prunes).toBeLessThan(30);
  });
});

describe('overlaps are found by looking near each symbol and name (P3)', () => {
  it('1,600 ground symbols on a joined mesh: the same overlaps as comparing every pair, with a few checks each', { timeout: 60_000 }, () => {
    const lines: string[] = [];
    const row = (j: number): string => `*@ wire ${Array.from({ length: 40 }, (_, i) => `${7 + i},${5 + j}`).join(' ')}`;
    const column = (i: number): string => `*@ wire ${Array.from({ length: 40 }, (_, j) => `${7 + i},${5 + j}`).join(' ')}`;
    for (let k = 0; k < 40; k++) lines.push(row(k), column(k));
    for (let k = 0; k < 1600; k++) lines.push(`*@ ground ${7 + (k % 40)} ${5 + Math.floor(k / 40)} 0`);
    const s = build(`* divider\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n* plainspice-drawing v1\n*@ V1 0 3 0 m\n*@ R1 4 0 270\n*@ R2 7 3 0\n${lines.join('\n')}\n.end\n`);
    const sc = s.scene;
    expect(sc.grounds.length).toBe(1600);
    const found = counted(() => findOverlaps(sc));
    // Every pair, the way findOverlaps compared them before (and in that order).
    const symbols = [...sc.parts.map((p) => p.box), ...sc.grounds.map((g) => g.box)];
    const pieces = sc.wires.reduce((n, w) => n + w.points.length - 1, 0);
    const words = sc.parts.length + sc.nodeLabels.length;
    const pairs = (symbols.length * (symbols.length - 1)) / 2 + symbols.length * (pieces + words) + (words * (words - 1)) / 2 + words * pieces;
    expect(found.result.length).toBeGreaterThan(0);
    // 75,164 checks here, about 47 for each symbol; comparing every pair was 3.75 million.
    expect(found.checks).toBeLessThan(50 * (symbols.length + words + pieces));
    expect(found.checks).toBeLessThan(pairs / 20);
  });
});

describe('a look at what words must avoid does not sort what it looks at (P3)', () => {
  it('2,000 names written at one point: each look sorts a few ids, not every id in its squares, twice', { timeout: 60_000 }, () => {
    // buildScene places each name against the others there (that work is the names': the scenes that
    // place parts see one name at a point, schematic.ts, oneNamePerPoint, and the drawing keeps one
    // per node and piece of copper). Each look at the obstacles gathered every id of its squares into
    // a Set and sorted them, twice: 6.6 million ids sorted for this scene, one for each check it made.
    const parsed = build(partsAtOnePoint(60));
    const drawing = { ...parsed.drawing, labels: Array.from({ length: 2000 }, (_, i) => ({ node: String(1 + (i % 59)), at: { x: 0, y: 0 } })) };
    const sort = vi.spyOn(Array.prototype, 'sort');
    const looked = counted(() => buildScene(parsed.circuit, drawing, NOTEBOOK_OPTIONS));
    const sorted = sort.mock.contexts.reduce((n: number, a) => n + (a as unknown[]).length, 0);
    sort.mockRestore();
    expect(looked.result.nodeLabels.length).toBe(2000);
    // About 150,000 ids sorted for 8.8 million checks.
    expect(sorted).toBeLessThan(looked.checks / 10);
  });
});
