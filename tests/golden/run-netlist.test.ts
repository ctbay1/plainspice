/**
 * What the app does to a netlist before running it (src/spice/run-netlist.ts), checked in the
 * engine. For every fixture with .op, the copy with `.options savecurrents` added gives the same
 * node voltages and voltage-source currents, bit for bit, as the netlist as written (what the
 * ngspice output tab tells the student), plus the current through every R, C, L, F, G and I
 * (claim A2 in docs/spice-facts/explanations.md). For F5 the results in words then say which way
 * every current flows.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { interpretPlots } from '../../src/engine/results.ts';
import { NgspiceEngine } from '../../src/engine/ngspice.ts';
import type { RunResult } from '../../src/engine/types.ts';
import { describeResults } from '../../src/spice/describe.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { netlistToRun } from '../../src/spice/run-netlist.ts';

const root = resolve(import.meta.dirname, '../..');
const fixtures = readdirSync(join(root, 'tests/fixtures'))
  .filter((f) => f.endsWith('.cir'))
  .map((f) => ({ id: basename(f, '.cir'), text: readFileSync(join(root, 'tests/fixtures', f), 'utf8') }))
  .filter((f) => netlistToRun(parseNetlist(f.text)).added.length > 0);

let engine: NgspiceEngine;
const asWritten = new Map<string, RunResult>();
const asRun = new Map<string, RunResult>();

beforeAll(async () => {
  engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
  for (const f of fixtures) {
    asWritten.set(f.id, await engine.run(f.text));
    asRun.set(f.id, await engine.run(netlistToRun(parseNetlist(f.text)).text));
  }
});

const vectors = (run: RunResult): Map<string, number[]> =>
  new Map(run.plots.flatMap((p) => p.variables.map((v, i) => [v.name.toLowerCase(), Array.from(p.real[i] ?? [])] as const)));

it('applies to the fixtures with an operating point', () => {
  expect(fixtures.map((f) => f.id)).toContain('f5-thevenin-cccs');
});

describe.each(fixtures.map((f) => f.id))('%s', (id) => {
  it('gives the same vectors as the netlist as written, plus the current of every other part', () => {
    const written = vectors(asWritten.get(id)!);
    const run = vectors(asRun.get(id)!);
    expect(asRun.get(id)!.ok).toBe(asWritten.get(id)!.ok);
    for (const [name, values] of written) expect(run.get(name), name).toEqual(values);
    const extra = [...run.keys()].filter((name) => !written.has(name));
    const parts = parseNetlist(fixtures.find((f) => f.id === id)!.text)
      .lines.flatMap((l) => (l.element && 'RCLFGI'.includes(l.element.letter ?? '') ? [l.element.key] : []));
    for (const part of parts) expect(extra.some((name) => name.startsWith(`i(@${part}[`)), `${part} has a current`).toBe(true);
  });
});

describe('F5 with every current saved', () => {
  it('says which way each current flows', () => {
    const f5 = fixtures.find((f) => f.id === 'f5-thevenin-cccs')!;
    const run = asRun.get(f5.id)!;
    const words = describeResults(parseNetlist(f5.text), interpretPlots(run.plots), run);
    const byName = new Map(words.currents.map((c) => [c.name, c]));
    expect(byName.get('R1')?.text).toBe('3\u00a0A from n1 to 0 through R1'); // a no-break space between number and unit
    expect(byName.get('R2')).toMatchObject({ from: 'x', to: 'n1' });
    expect(byName.get('R2')?.value).toBeCloseTo(1, 12);
    expect(byName.get('F1')).toMatchObject({ from: '0', to: 'n1' });
    expect(byName.get('F1')?.value).toBeCloseTo(2, 12);
  });
});
