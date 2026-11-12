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
import { buildSchematic, buildScene, type Schematic } from '../../src/schematic/index.ts';
import { partsAtOnePoint } from './schematic-hostile.ts';

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
