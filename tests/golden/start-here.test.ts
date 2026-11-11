/**
 * The first screen (examples/start-here.cir, decision 0016): a 6 V source and two resistors, opened
 * already solved, inviting the student to change R1. Its numbers, and those after the changes the
 * end-to-end tests make (R1 = 2k and 500 Ω), as native ngspice 47 and 42 printed them for the same
 * netlist run with `.options savecurrents` (as PlainSpice runs an operating point, decision 0011),
 * recorded on 11 November 2026:
 *
 *   R1 = 1k:  in = 6.000000e+00, out = 4.000000e+00, v1#branch = -2.00000e-03, @r1[i] = @r2[i] = 2.000000e-03
 *   R1 = 2k:  in = 6.000000e+00, out = 3.000000e+00, v1#branch = -1.50000e-03, @r1[i] = @r2[i] = 1.500000e-03
 *   R1 = 500: in = 6.000000e+00, out = 4.800000e+00, v1#branch = -2.40000e-03, @r1[i] = @r2[i] = 2.400000e-03
 *
 * The engine must give the same to 6 significant figures, and the netlist must have no check at all.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { agrees } from '../../src/engine/compare.ts';
import { NgspiceEngine } from '../../src/engine/ngspice.ts';
import { interpretPlots } from '../../src/engine/results.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { netlistToRun } from '../../src/spice/run-netlist.ts';
import { checkTraps } from '../../src/spice/traps.ts';

const root = resolve(import.meta.dirname, '../..');
const text = readFileSync(join(root, 'examples/start-here.cir'), 'utf8');

const NATIVE: Record<string, { in: number; out: number; v1: number; r: number }> = {
  '1k': { in: 6, out: 4, v1: -2e-3, r: 2e-3 },
  '2k': { in: 6, out: 3, v1: -1.5e-3, r: 1.5e-3 },
  '500': { in: 6, out: 4.8, v1: -2.4e-3, r: 2.4e-3 },
};

let engine: NgspiceEngine;
beforeAll(async () => {
  engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
});

describe('the first screen: Start here', () => {
  it('is the divider the brief asks for, with a title that invites changing R1', () => {
    expect(text).toBe('* Start here: change R1 and watch the numbers move\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n');
  });

  it('has no check at all (a first screen with a trap would teach the wrong thing)', () => {
    expect(checkTraps(parseNetlist(text))).toEqual([]);
  });

  it.each(Object.keys(NATIVE))('R1 = %s: the engine gives what native ngspice 47 and 42 gave', async (r1) => {
    const netlist = parseNetlist(text.replace('R1 in out 1k', `R1 in out ${r1}`));
    const run = await engine.run(netlistToRun(netlist).text);
    expect(run.exitCode, run.stderr).toBe(0);
    const op = interpretPlots(run.plots).op!;
    const node = (n: string): number => op.nodes.find((x) => x.node === n)!.value;
    const current = (e: string): number => op.currents.find((x) => x.element === e)!.value;
    const want = NATIVE[r1]!;
    expect(agrees(node('in'), want.in)).toBe(true);
    expect(agrees(node('out'), want.out)).toBe(true);
    expect(agrees(current('v1'), want.v1)).toBe(true);
    expect(agrees(current('r1'), want.r)).toBe(true);
    expect(agrees(current('r2'), want.r)).toBe(true);
  });
});
