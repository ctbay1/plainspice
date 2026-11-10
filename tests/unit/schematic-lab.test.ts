/**
 * design/lab/: the schematic lab sits outside the root tsconfig and the lint script's folders, so its
 * code is typechecked (with design/lab/tsconfig.json, which extends the root one) and linted here,
 * like the code it draws.
 */
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const bin = (name: string): string => join(root, 'node_modules', '.bin', name);
const run = (cmd: string, args: string[]): { ok: boolean; out: string } => {
  try {
    return { ok: true, out: execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

describe('the schematic lab', () => {
  it('typechecks', () => {
    const r = run(bin('tsc'), ['--noEmit', '-p', 'design/lab/tsconfig.json']);
    expect(r.out).toBe('');
    expect(r.ok).toBe(true);
  }, 60_000);

  it('passes the lint with no warning', () => {
    const r = run(bin('oxlint'), ['--jsx-a11y-plugin', '--react-plugin', '--deny-warnings', 'design/lab', 'scripts/lab-shots.ts']);
    expect(r.ok, r.out).toBe(true);
  }, 60_000);
});
