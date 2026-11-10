/**
 * docs/spice-facts/drawing.md, checked against our WebAssembly engine: ngspice ignores PlainSpice's
 * drawing lines (drawing-1). The same netlist with and without its drawing lines must give the same
 * results bit for bit, equal to what native ngspice 47 gave (recorded 10 Nov 2026), with no message;
 * and PlainSpice's parser must read every drawing line as a comment, while the drawing reader
 * (src/schematic/format.ts) reads the positions from them.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { NgspiceEngine } from '../../src/engine/ngspice.ts';
import type { RunResult } from '../../src/engine/types.ts';
import { buildSchematic, readDrawing } from '../../src/schematic/index.ts';
import { parseNetlist } from '../../src/spice/parse.ts';

const WITH = [
  '* drawing lines are comments',
  'V1 in 0 6',
  'R1 in out 1k',
  'R2 out 0 2k',
  '.op',
  '* plainspice-drawing v1',
  '*@ V1 0 3 0 m',
  '*@ R1 4 0 270 side=below',
  '*@ R2 7 3 0',
  '*@ part Ground 12 3 90',
  '*@ ground 0 6 0 style=bars',
  '*@ wire 0,1 0,0 2,0',
  '*@ wire 6,0 7,0 7,1',
  '*@ wire 0,5 0,6 7,6 7,5',
  '*@ label in 0 0',
  '*@ label out 7 0 side=above-right',
  '*@ R9 1 2 45 x',
  '*@',
  '* plainspice-drawing v2',
  '*@ R1 4 0 270 anything=1',
  '.end',
  '',
].join('\n');

const WITHOUT = ['* drawing lines are comments', 'V1 in 0 6', 'R1 in out 1k', 'R2 out 0 2k', '.op', '.end', ''].join('\n');

/** Rawfile values native ngspice 47 gave for both netlists (42 gave the same; recorded again 10 Nov 2026 with the side= fields and the v2 block). */
const NATIVE_47 = { 'v(in)': 6, 'v(out)': 4, 'i(v1)': -0.002 };

const root = resolve(import.meta.dirname, '../..');
let withRun: RunResult;
let withoutRun: RunResult;

beforeAll(async () => {
  const engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
  withRun = await engine.run(WITH);
  withoutRun = await engine.run(WITHOUT);
});

const vectors = (r: RunResult): Record<string, number> => {
  const plot = r.plots[0]!;
  return Object.fromEntries(plot.variables.map((v, i) => [v.name, plot.real[i]![0]!]));
};
/** stdout without the lines that report time and memory. */
const steady = (s: string): string =>
  s
    .split('\n')
    .filter((l) => !/time|DRAM|program size|pages|Stack/.test(l))
    .join('\n');

describe('drawing-1: ngspice ignores the drawing lines', () => {
  it('runs cleanly with the drawing lines: exit 0, no message', () => {
    expect(withRun.ok).toBe(true);
    expect(withRun.exitCode).toBe(0);
    expect(withRun.diagnostics).toEqual([]);
    expect(withRun.stderr.trim()).toBe('');
  });

  it('gives the same results bit for bit as without them, equal to native ngspice 47', () => {
    const a = vectors(withRun);
    const b = vectors(withoutRun);
    expect(Object.keys(a)).toEqual(Object.keys(b));
    for (const [name, value] of Object.entries(NATIVE_47)) {
      expect(Object.is(a[name], value), name).toBe(true);
      expect(Object.is(b[name], value), name).toBe(true);
    }
  });

  it('prints the same thing as without them', () => {
    expect(steady(withRun.stdout)).toBe(steady(withoutRun.stdout));
  });

  it('PlainSpice reads every drawing line as a comment, and the drawing reader reads them', () => {
    const netlist = parseNetlist(WITH);
    const lines = netlist.lines.filter((l) => /^\s*\*(@|\s*plainspice-drawing)/.test(l.text));
    expect(lines).toHaveLength(15);
    for (const l of lines) expect(l.kind, l.text).toBe('comment');
    expect(netlist.elements.map((i) => netlist.lines[i]!.element!.key)).toEqual(['v1', 'r1', 'r2']);
    const drawing = readDrawing(netlist);
    expect([...drawing.parts.keys()]).toEqual(['v1', 'r1', 'r2', 'ground']);
    expect(drawing.parts.get('r1')!.side).toBe('below');
    expect(drawing.labels.map((l) => l.side)).toEqual([undefined, 'above-right']);
    expect(drawing.unreadable.map((u) => u.text)).toEqual(['*@ R9 1 2 45 x', '*@']);
    expect(drawing.foreign.map((u) => u.text)).toEqual(['* plainspice-drawing v2', '*@ R1 4 0 270 anything=1']);
    expect(drawing.problems.filter((p) => p.kind === 'unknown-field').map((p) => p.line)).toEqual([11]);
    // PlainSpice draws from the v1 lines and keeps the v2 block as written, unused.
    const s = buildSchematic(netlist);
    expect(s.origin).toBe('given');
    expect(s.foreign).toHaveLength(2);
    expect(s.drawing.parts.get('v1')).toEqual({ at: { x: 0, y: 3 }, rot: 0, mirror: true });
  });
});
