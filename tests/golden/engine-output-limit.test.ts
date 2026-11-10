/**
 * A netlist can make ngspice print without end (a .control loop): the engine keeps at most
 * MAX_OUTPUT_CHARS of each stream and only counts the lines after that, so a share link with such a
 * loop cannot run the page out of memory before the 20 s time-out ends it (security review M1).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { MAX_OUTPUT_CHARS, NgspiceEngine } from '../../src/engine/ngspice.ts';

const root = resolve(import.meta.dirname, '../..');
let engine: NgspiceEngine;

beforeAll(async () => {
  engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
});

/** A .control loop that echoes a 70-character line `count` times. */
const loop = (count: number): string =>
  `* echo in a loop\n.control\nlet i = 0\nwhile i < ${count}\necho ${'x'.repeat(70)}\nlet i = i + 1\nend\n.endc\n.end\n`;

describe('the output ngspice prints is kept up to a limit', () => {
  it('keeps the first MAX_OUTPUT_CHARS of a long printout and says how many lines it left out', async () => {
    const r = await engine.run(loop(30_000)); // about 2.1 million characters
    expect(r.stdout.length).toBeLessThan(MAX_OUTPUT_CHARS + 100);
    expect(r.stdout).toMatch(/\n… \d+ more lines were not kept$/);
    expect(r.stdout.startsWith('x'.repeat(70)) || r.stdout.includes(`\n${'x'.repeat(70)}\n`)).toBe(true);
  }, 60_000);

  it('leaves ordinary runs as they were', async () => {
    const r = await engine.run('* t\nV1 a 0 6\nR1 a 0 2\n.op\n.end\n');
    expect(r.ok).toBe(true);
    expect(r.stdout).not.toContain('were not kept');
  });
});
