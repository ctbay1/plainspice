/**
 * docs/spice-facts/traps.md after the last pass before the release (13 November 2026), the words lane: the runs
 * the facts record in prose beside their netlists, checked against our WebAssembly engine, and the trap texts
 * that say them. Native ngspice 47 and 42 were run for each (`ngspice -b` and `ngspice -b -r`); our engine is
 * ngspice 47, so it must print 47's words.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { NgspiceEngine } from '../../src/engine/ngspice.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { checkTraps } from '../../src/spice/traps.ts';

const root = resolve(import.meta.dirname, '../..');
let engine: NgspiceEngine;
beforeAll(async () => {
  engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
});

describe('space-before-suffix-12 and unknown-word-6: a value a capacitor or an inductor can only report stops ngspice 47 with its longer message', () => {
  // Native 47: "no such parameter on this device or parameter is missing"; native 42: "no such parameter on this device" (exit 1 in both).
  it.each([
    ['C1 out 0 1 p', 'space-before-suffix'],
    ['L1 out 0 1 v', 'space-before-suffix'],
    ['C1 out 0 1u i', 'unknown-word'],
    ['L1 out 0 1m flux', 'unknown-word'],
    ['R1 out 0 1k sens_dc', 'unknown-word'],
  ])('%s', async (line, id) => {
    const netlist = `* t\nV1 in 0 1\nR9 in out 1k\n${line}\n.op\n.end\n`;
    const run = await engine.run(netlist);
    expect(run.ok).toBe(false);
    expect(`${run.stdout}\n${run.stderr}`).toContain('no such parameter on this device or parameter is missing');
    const traps = checkTraps(parseNetlist(netlist));
    expect(traps.map((t) => t.id)).toEqual([id]);
    expect(traps[0]!.ngspice).toContain("ngspice 47 stops: 'no such parameter on this device or parameter is missing' (ngspice 42: 'no such parameter on this device')");
  });
});

describe('a results file with its header only: where native ngspice 47 and 42 exit 0 with a header and 0 points, our engine reports it (dc-sweep-problems-3, -4, -22, invisible-character-33)', () => {
  // The netlists of those facts (docs/spice-facts/traps.md); native 47 and 42 write a DC transfer characteristic header with 0 points.
  it.each([
    ['dc-sweep-problems-3', '* .dc with a negative step and a rising range\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 0 12 -1\n.end\n'],
    ['dc-sweep-problems-4', '* .dc from 12 down to 0 with a positive step\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 12 0 1\n.end\n'],
    ['dc-sweep-problems-22', '* both sweeps go the wrong way\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 2 1 1 V2 2 1 1\n.end\n'],
    ['invisible-character-33', '* a zero-width space inside a .dc stop: it reads 1, below the start\nV1 in 0 1\nR1 in 0 1k\n.dc V1 2 1\u200b0 1\n.end\n'],
  ])('%s', async (_, netlist) => {
    const run = await engine.run(netlist);
    expect(run.exitCode).toBe(0);
    expect(run.ok).toBe(false);
    expect(run.diagnostics.map((d) => [d.code, d.text])).toEqual([['rawfile', expect.stringContaining('header without a Binary: or Values: section')]]);
  });
});
