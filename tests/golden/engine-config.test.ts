/**
 * The WebAssembly engine against native ngspice 47 built with the SAME configuration
 * (no XSPICE, OSDI or KLU; engine/build.sh), recorded in tests/golden/native/ngspice-47-engine-config/.
 *
 * Why this exists: with very fast edges (1 ns), ngspice built WITH XSPICE (the usual native
 * build, and Ubuntu's) chooses different transient time steps than ngspice built without it, so
 * point-by-point comparisons with it fail even though the physics agrees. Built the same way as
 * the engine, native ngspice gives the engine's time grid exactly. This test shows both facts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { agrees } from '../../src/engine/compare.ts';
import { NgspiceEngine } from '../../src/engine/ngspice.ts';
import type { RunResult } from '../../src/engine/types.ts';

interface NativeRecord {
  plots: { plotname: string; points: number; vectors: { name: string; values: number[] }[] }[];
}

const root = resolve(import.meta.dirname, '../..');
const record = (label: string, id: string): NativeRecord =>
  JSON.parse(readFileSync(join(root, `tests/golden/native/${label}/${id}.json`), 'utf8')) as NativeRecord;
const netlists = [
  ...readdirSync(join(root, 'tests/fixtures')).filter((f) => f.endsWith('.cir')).map((f) => join(root, 'tests/fixtures', f)),
  ...readdirSync(join(root, 'tests/golden/engine-config')).filter((f) => f.endsWith('.cir')).map((f) => join(root, 'tests/golden/engine-config', f)),
];

let engine: NgspiceEngine;
const runs = new Map<string, RunResult>();

beforeAll(async () => {
  engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
  for (const file of netlists) runs.set(basename(file, '.cir'), await engine.run(readFileSync(file, 'utf8')));
});

const vectorOf = (run: RunResult, name: string): Float64Array | undefined => {
  for (const p of run.plots) {
    const i = p.variables.findIndex((v) => v.name.toLowerCase() === name.toLowerCase());
    if (i >= 0) return p.real[i];
  }
  return undefined;
};

describe.each(netlists.map((f) => basename(f, '.cir')))('%s', (id) => {
  it('has the same time grid and values as native ngspice 47 built like the engine', () => {
    const run = runs.get(id)!;
    expect(run.ok).toBe(true);
    for (const np of record('ngspice-47-engine-config', id).plots) {
      for (const nv of np.vectors) {
        const wv = vectorOf(run, nv.name);
        expect(wv?.length, `${nv.name} point count`).toBe(nv.values.length);
        nv.values.forEach((x, i) => expect(agrees(wv![i]!, x), `${nv.name}[${i}]: ${wv![i]} vs ${x}`).toBe(true));
      }
    }
  });
});

describe('a 1 ns edge, against native ngspice 47 built with XSPICE', () => {
  it('takes different time steps but ends at the same value to 6 significant figures', () => {
    const run = runs.get('rl-fast-edge')!;
    const xspice = record('ngspice-47', 'rl-fast-edge').plots[0]!;
    const engineConfig = record('ngspice-47-engine-config', 'rl-fast-edge').plots[0]!;
    expect(engineConfig.points).not.toBe(xspice.points); // 59 vs 83 points when recorded
    const last = (values: ArrayLike<number>): number => values[values.length - 1]!;
    const nativeOut = xspice.vectors.find((v) => v.name === 'v(out)')!.values;
    expect(agrees(last(vectorOf(run, 'v(out)')!), last(nativeOut))).toBe(true);
    // v(out) = e^(-t/5ms) after the step, so at 5 ms it is close to 1/e.
    expect(Math.abs(last(vectorOf(run, 'v(out)')!) - Math.exp(-1))).toBeLessThan(1e-4);
  });
});
