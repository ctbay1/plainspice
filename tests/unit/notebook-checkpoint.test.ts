/**
 * design/checkpoint/ (Tarık's checkpoint of the Notebook look) sits outside the root tsconfig and
 * the lint script's folders, so, like the schematic lab, it is typechecked (with
 * design/checkpoint/tsconfig.json, which extends the root one) and linted here.
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

describe('the checkpoint page', () => {
  it('typechecks', () => {
    const r = run(bin('tsc'), ['--noEmit', '-p', 'design/checkpoint/tsconfig.json']);
    expect(r.out).toBe('');
    expect(r.ok).toBe(true);
  }, 120_000);

  it('passes the lint with no warning', () => {
    const r = run(bin('oxlint'), ['--jsx-a11y-plugin', '--react-plugin', '--deny-warnings', 'design/checkpoint', 'src/notebook', 'scripts/checkpoint-shots.ts', 'scripts/notebook-metrics.ts']);
    expect(r.ok, r.out).toBe(true);
  }, 60_000);
});
