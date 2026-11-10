/**
 * The example library (examples/, the circuits of the channel's public videos, in channel order):
 * every example runs in the engine and gives the values the channel recorded with native ngspice
 * when it made the video (solved-circuits: design/verify.py, design/e04/verify_e04.py and
 * design/v2_netlists.txt), to 6 significant figures; the three "mistake" examples of SPICE for
 * Beginners trigger the check they teach, and no other example triggers an error-level check.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { agrees, rawfileName } from '../../src/engine/compare.ts';
import { NgspiceEngine } from '../../src/engine/ngspice.ts';
import type { RunResult } from '../../src/engine/types.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { checkTraps } from '../../src/spice/traps.ts';

interface Manifest {
  videos: { id: string; title: string; short: string; youtube: string }[];
  examples: { id: string; video: string; file: string; name: string; source: string; expect: Record<string, number> }[];
}

const root = resolve(import.meta.dirname, '../..');
const manifest = JSON.parse(readFileSync(join(root, 'examples/examples.json'), 'utf8')) as Manifest;
const text = (file: string): string => readFileSync(join(root, 'examples', file), 'utf8');

/** The check each "mistake" example exists to show. */
const TEACHES: Record<string, string> = {
  'sp01-4-no-ground': 'no-ground',
  'sp01-5-typo': 'dangling-node',
  'sp01-6-mega': 'mega-as-milli',
};

let engine: NgspiceEngine;
const runs = new Map<string, RunResult>();

beforeAll(async () => {
  engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
  for (const e of manifest.examples) runs.set(e.id, await engine.run(text(e.file)));
});

/** A vector by the name the channel's scripts use (v(n1), i(v1), output_impedance_at_v(a)), as the rawfile names it. */
function value(run: RunResult, name: string): number | undefined {
  const wanted = rawfileName(name);
  for (const plot of run.plots) {
    const i = plot.variables.findIndex((v) => v.name.toLowerCase() === wanted);
    if (i >= 0) return plot.real[i]?.[0];
  }
  return undefined;
}

describe('the library', () => {
  it('follows the channel: SPICE for Beginners, then p01, p02 and e04', () => {
    expect(manifest.videos.map((v) => v.id)).toEqual(['sp01', 'p01', 'p02', 'e04']);
    const order = manifest.videos.map((v) => v.id);
    const videoOf = manifest.examples.map((e) => order.indexOf(e.video));
    expect(videoOf).toEqual([...videoOf].sort((a, b) => a - b));
  });

  it.each(manifest.examples)('$id credits its video on line 2', (e) => {
    const lines = text(e.file).split('\n');
    const video = manifest.videos.find((v) => v.id === e.video)!;
    expect(lines[0]!.startsWith('* ')).toBe(true);
    expect(lines[1]).toBe(`* From the Solved Circuits video "${video.title}", https://youtu.be/${video.youtube} (CC BY 4.0)`);
  });
});

describe.each(manifest.examples)('$id', (e) => {
  it('runs in the engine', () => {
    const run = runs.get(e.id)!;
    expect(run.exitCode, run.stderr).toBe(0);
  });

  if (Object.keys(e.expect).length) {
    it('gives the values the channel recorded with native ngspice', () => {
      const run = runs.get(e.id)!;
      for (const [name, expected] of Object.entries(e.expect)) {
        const got = value(run, name);
        expect(got !== undefined && agrees(got, expected), `${name}: ${got} vs ${expected}`).toBe(true);
      }
    });
  }

  it(TEACHES[e.id] ? `shows the check it teaches (${TEACHES[e.id]})` : 'has no error-level check', () => {
    const traps = checkTraps(parseNetlist(text(e.file)));
    if (TEACHES[e.id]) expect(traps.map((t) => t.id)).toContain(TEACHES[e.id]);
    else expect(traps.filter((t) => t.severity === 'error').map((t) => t.id)).toEqual([]);
  });
});
