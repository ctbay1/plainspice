/**
 * The search for a ground symbol's place looks only at the wires near each place it tries
 * (security:F1, critic of the fix round). Timing it cannot tell: the first fix's search, which checked
 * every wire for every point of ground's wire, still built the critic's drawing inside a time limit
 * that allows for a busy machine (second critic of the fix round). So this file counts the work
 * instead: every check whether a piece of wire runs through a box (geometry.ts, segmentCrossesBox),
 * the same on any machine.
 */
import { describe, expect, it, vi } from 'vitest';
import { NOTEBOOK_OPTIONS } from '../../src/notebook/schematic.ts';
import { buildSchematic, schematicConnectivity } from '../../src/schematic/index.ts';
import { groundRowsAndWave } from './schematic-hostile.ts';

const checks = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../src/schematic/geometry.ts', async (importOriginal) => {
  const geometry = await importOriginal<typeof import('../../src/schematic/geometry.ts')>();
  return {
    ...geometry,
    segmentCrossesBox: (...args: Parameters<typeof geometry.segmentCrossesBox>): boolean => {
      checks.count++;
      return geometry.segmentCrossesBox(...args);
    },
  };
});

/** Builds a netlist with the Notebook's options, counting the checks of wire through a box. */
function counted(text: string): { s: ReturnType<typeof buildSchematic>; checks: number } {
  checks.count = 0;
  const s = buildSchematic(text, NOTEBOOK_OPTIONS);
  return { s, checks: checks.count };
}

describe('the ground symbol\'s place is found by looking at the wires near it (security:F1)', () => {
  // Two builds of a 31 kB drawing take about 2 s here; the count, not the time, is what is checked, so a
  // busy machine gets all the time it needs.
  it('a wire through every point of ground\'s wire, beside a 9,900-piece wave: the search checks fewer pieces of wire than the drawing has', { timeout: 60_000 }, () => {
    // The critic's 31 kB link: no ground symbol, so one is looked for, and no point of ground's wire is
    // clear. The control is the same drawing with the symbol and its lead where the search puts them,
    // so it builds the same drawing with no search: what the searched build checks beyond it is the
    // search's own work.
    const searched = counted(groundRowsAndWave(25, 199, 9900));
    const control = counted(groundRowsAndWave(25, 199, 9900, ['*@ ground 0 25 0', '*@ wire 0,24 0,25']));
    expect(searched.s.problems.map((p) => p.kind)).toContain('ground-added');
    expect(control.s.problems.map((p) => p.kind)).not.toContain('ground-added');
    expect(searched.s.drawing).toEqual(control.s.drawing);
    expect(schematicConnectivity(searched.s)).toEqual([]);
    const pieces = searched.s.drawing.wires.reduce((n, w) => n + w.length - 1, 0);
    expect(pieces).toBeGreaterThan(9900);
    // About 370 checks here, for up to 100 places and 100 leads tried. The first fix's search checked
    // every wire for each point of ground's wire: 48 million more than the control.
    expect(searched.checks - control.checks).toBeLessThan(pieces);
  });
});
