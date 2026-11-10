/**
 * A netlist is data: the engine never runs a command on the machine it runs on. ngspice's shell,
 * gnuplot and edit commands call system(); in a browser Emscripten refuses, and engine/no-system.js
 * makes it refuse under Node too (it used to run the command in a shell: found by the security
 * review of 10 November 2026). The rest of the .control block still runs.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { NgspiceEngine } from '../../src/engine/ngspice.ts';

const root = resolve(import.meta.dirname, '../..');

it('refuses the shell command of a .control block and runs the rest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'plainspice-no-shell-'));
  const marker = join(dir, 'ran');
  try {
    const engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
    const run = await engine.run(`* a shell command in .control\nV1 a 0 1\nR1 a 0 1\n.control\nshell touch ${marker}\nop\nprint v(a)\n.endc\n.end\n`);
    expect(existsSync(marker), 'the command ran on this machine').toBe(false);
    expect(run.stderr).toContain(`Unable to execute "touch ${marker}"`);
    expect(run.stdout).toMatch(/v\(a\) = 1\.000000e\+00/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
