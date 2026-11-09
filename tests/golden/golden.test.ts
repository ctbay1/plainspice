/**
 * Golden tests: run every fixture through the WebAssembly ngspice (the same engine code the
 * page uses) and compare with what native ngspice computed and printed for the same file
 * (recorded by scripts/record-native.ts into tests/golden/native/).
 *
 * Pass criterion (Tarık's): agree with native ngspice to 6 significant figures.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { agrees, parsePrinted, rawfileName } from '../../src/engine/compare.ts';
import { NgspiceEngine } from '../../src/engine/ngspice.ts';
import { interpretPlots } from '../../src/engine/results.ts';
import type { RawPlot, RunResult } from '../../src/engine/types.ts';

interface NativeRecord {
  ngspice: { version: string };
  printed: { exitCode: number | null; stdout: string };
  plots: { plotname: string; points: number; vectors: { name: string; type: string; values: number[] }[] }[];
}
interface ExpectedCheck {
  quantity: string;
  expected: number | string;
  approx?: boolean;
}

const root = resolve(import.meta.dirname, '../..');
const fixturesDir = join(root, 'tests/fixtures');
const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.cir'))
  .sort()
  .map((f) => basename(f, '.cir'));
const expected = JSON.parse(readFileSync(join(fixturesDir, 'expected.json'), 'utf8')) as {
  fixtures: Record<string, { checks: ExpectedCheck[] }>;
};
const native = (major: string, id: string): NativeRecord =>
  JSON.parse(readFileSync(join(root, `tests/golden/native/ngspice-${major}/${id}.json`), 'utf8')) as NativeRecord;

const vector = (plots: RawPlot[], name: string): Float64Array | undefined => {
  for (const p of plots) {
    const i = p.variables.findIndex((v) => v.name.toLowerCase() === name.toLowerCase());
    if (i >= 0) return p.real[i];
  }
  return undefined;
};

let engine: NgspiceEngine;
const runs = new Map<string, RunResult>();

beforeAll(async () => {
  engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
  for (const id of fixtures) runs.set(id, await engine.run(readFileSync(join(fixturesDir, `${id}.cir`), 'utf8')));
});

describe.each(fixtures)('%s', (id) => {
  it('runs cleanly in WebAssembly', () => {
    const r = runs.get(id)!;
    expect(r.diagnostics.filter((d) => d.severity !== 'note')).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.unreliable).toBe(false);
  });

  it('agrees with native ngspice 47 (same version) on every vector, to 6 significant figures', () => {
    const r = runs.get(id)!;
    const rec = native('47', id);
    expect(r.plots.map((p) => p.plotname)).toEqual(rec.plots.map((p) => p.plotname));
    rec.plots.forEach((np, k) => {
      const wp = r.plots[k]!;
      expect(wp.points).toBe(np.points);
      for (const nv of np.vectors) {
        const wv = vector([wp], nv.name);
        expect(wv, `${nv.name} missing in the wasm run`).toBeDefined();
        nv.values.forEach((x, i) => {
          expect(agrees(wv![i]!, x), `${nv.name}[${i}]: wasm ${wv![i]} vs native ${x}`).toBe(true);
        });
      }
    });
  });

  it('agrees with native ngspice 42 (Ubuntu package) to 6 significant figures', () => {
    const r = runs.get(id)!;
    const rec = native('42', id);
    for (const np of rec.plots) {
      // ngspice 46 changed how .tran places the last steps before a breakpoint, so 42's time
      // grid differs from 47's; transient runs are checked against 47 and the exact formula.
      if (np.plotname.startsWith('Transient')) continue;
      for (const nv of np.vectors) {
        const wv = vector(r.plots, nv.name);
        expect(wv, `${nv.name} missing in the wasm run`).toBeDefined();
        nv.values.forEach((x, i) => expect(agrees(wv![i]!, x), `${nv.name}[${i}]`).toBe(true));
      }
    }
  });

  it("matches the numbers native ngspice prints with 'ngspice -b'", () => {
    const r = runs.get(id)!;
    for (const major of ['47', '42']) {
      const rec = native(major, id);
      if (rec.printed.exitCode !== 0) continue; // .dc/.tran: batch mode prints nothing without .print
      const printed = parsePrinted(rec.printed.stdout);
      expect(printed.size).toBeGreaterThan(0);
      for (const [name, { value }] of printed) {
        const wv = vector(r.plots, name);
        expect(wv, `${name} (printed by ngspice ${major}) missing in the wasm run`).toBeDefined();
        expect(agrees(wv![0]!, value), `${name}: wasm ${wv![0]} vs printed ${value}`).toBe(true);
      }
    }
  });

  it('gives the values expected by hand', () => {
    const r = runs.get(id)!;
    const checks = expected.fixtures[id]?.checks ?? [];
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) {
      const wv = vector(r.plots, rawfileName(c.quantity));
      expect(wv, `${c.quantity} missing`).toBeDefined();
      if (typeof c.expected === 'number') {
        expect(agrees(wv![0]!, c.expected), `${c.quantity}: ${wv![0]} vs ${c.expected}`).toBe(true);
      } else if (id === 'd1-dc-divider-sweep') {
        const sweep = vector(r.plots, rawfileName('v-sweep'))!;
        expect(wv!.length).toBe(13);
        wv!.forEach((v, i) => expect(agrees(v, (2 / 3) * sweep[i]!)).toBe(true));
      } else if (id === 't1-tran-rc-charge') {
        // V1 ramps 0 -> 5 V in tr = 1 us, then stays; RC = 1 ms. Exact response of the RC to that
        // ramp: k(t - tau(1 - e^(-t/tau))) while ramping, 5 - 5(tau/tr)(e^(tr/tau) - 1)e^(-t/tau) after.
        const time = vector(r.plots, 'time')!;
        const tau = 1e-3;
        const tr = 1e-6;
        const k = 5 / tr;
        time.forEach((t, i) => {
          const exact = t <= tr ? k * (t - tau * (1 - Math.exp(-t / tau))) : 5 - 5 * (tau / tr) * (Math.exp(tr / tau) - 1) * Math.exp(-t / tau);
          expect(Math.abs(wv![i]! - exact), `t=${t}`).toBeLessThan(5e-5);
        });
      }
    }
  });
});

describe('the results reader', () => {
  it('reads node voltages, branch currents and .tf results like a student would', () => {
    const op = interpretPlots(runs.get('f5-thevenin-cccs')!.plots).op!;
    expect(op.nodes.find((n) => n.node === 'a')?.value).toBe(14);
    expect(op.currents.find((c) => c.element === 'vx')).toMatchObject({ value: 1, origin: 'branch' });
    const tf = interpretPlots(runs.get('f4-tf-output-impedance')!.plots).tf!;
    expect(tf.outputImpedance).toEqual({ at: 'v(a)', value: 4 });
    expect(tf.inputImpedance).toEqual({ source: 'v1', value: 9 });
    expect(agrees(tf.transferFunction!, 1 / 3)).toBe(true);
    const dc = interpretPlots(runs.get('d1-dc-divider-sweep')!.plots).dc!;
    expect(dc.scale).toMatchObject({ name: 'v(v-sweep)', unit: 'V' });
    expect(dc.series.map((s) => s.name)).toEqual(['v(in)', 'v(out)', 'i(v1)']);
  });

  it('flags a circuit without ground as unreliable instead of returning confident numbers', async () => {
    const r = await engine.run('* no ground\nV1 a b 6\nR1 a b 2\n.op\n.end\n');
    expect(r.unreliable).toBe(true);
    expect(r.diagnostics.map((d) => d.code)).toContain('singular-matrix');
  });

  it('reports a duplicate name as an error on its line', async () => {
    const r = await engine.run('* dup\nV1 n1 0 6\nR1 n1 0 2\nR1 n1 0 4\n.op\n.end\n');
    expect(r.ok).toBe(false);
    expect(r.diagnostics).toContainEqual(expect.objectContaining({ code: 'duplicate-name', line: 4 }));
  });
});
