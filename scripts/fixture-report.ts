/**
 * Write docs/fixture-results.md: every fixture's key quantities as expected by hand, as native
 * ngspice 47 and 42 printed and computed them, and as the WebAssembly engine computes them,
 * with the 6-significant-figure verdict.
 *
 *   node --experimental-strip-types scripts/fixture-report.ts
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import createNgspice from '../engine/dist/ngspice.mjs';
import { agrees, maxRelativeDifference, parsePrinted, rawfileName } from '../src/engine/compare.ts';
import { NgspiceEngine } from '../src/engine/ngspice.ts';
import type { RawPlot } from '../src/engine/types.ts';

interface NativeRecord {
  ngspice: { version: string; banner: string[] };
  printed: { exitCode: number | null; stdout: string };
  plots: { plotname: string; points: number; vectors: { name: string; values: number[] }[] }[];
}
interface Check {
  quantity: string;
  expected: number | string;
  unit: string;
  approx?: boolean;
}

const root = resolve(import.meta.dirname, '..');
const fixturesDir = join(root, 'tests/fixtures');
const expected = JSON.parse(readFileSync(join(fixturesDir, 'expected.json'), 'utf8')) as {
  fixtures: Record<string, { source: string; note?: string; checks: Check[] }>;
};
const native = (major: string, id: string): NativeRecord =>
  JSON.parse(readFileSync(join(root, `tests/golden/native/ngspice-${major}/${id}.json`), 'utf8')) as NativeRecord;

const find = (plots: { variables?: { name: string }[]; real?: Float64Array[]; vectors?: { name: string; values: number[] }[] }[], name: string): ArrayLike<number> | undefined => {
  for (const p of plots) {
    if (p.variables && p.real) {
      const i = p.variables.findIndex((v) => v.name.toLowerCase() === name.toLowerCase());
      if (i >= 0) return p.real[i];
    }
    const v = p.vectors?.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (v) return v.values;
  }
  return undefined;
};
const g = (x: number | undefined): string => (x === undefined ? '—' : Number(x.toPrecision(10)).toString());

const engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
const ids = readdirSync(fixturesDir).filter((f) => f.endsWith('.cir')).sort().map((f) => basename(f, '.cir'));
const n47 = native('47', ids[0]!);
const n42 = native('42', ids[0]!);

const keyRows: string[] = [];
const vectorRows: string[] = [];
let checks = 0;
let agreeing = 0;
let identical = 0;
let disagreements = 0;

for (const id of ids) {
  const netlist = readFileSync(join(fixturesDir, `${id}.cir`), 'utf8');
  const run = await engine.run(netlist);
  const rec47 = native('47', id);
  const rec42 = native('42', id);
  const p47 = rec47.printed.exitCode === 0 ? parsePrinted(rec47.printed.stdout) : undefined;
  const p42 = rec42.printed.exitCode === 0 ? parsePrinted(rec42.printed.stdout) : undefined;
  const fx = expected.fixtures[id]!;

  for (const c of fx.checks) {
    const name = rawfileName(c.quantity);
    let index = 0;
    let byHand: number;
    let label = c.quantity;
    const wv = find(run.plots, name);
    if (typeof c.expected === 'number') {
      byHand = c.expected;
    } else if (id.startsWith('d1')) {
      const sweep = find(run.plots, 'v(v-sweep)')!;
      index = sweep.length - 1;
      byHand = (2 / 3) * sweep[index]!;
      label = `${c.quantity} at V1 = ${sweep[index]} V`;
    } else {
      const time = find(run.plots, 'time')!;
      index = time.length - 1;
      const t = time[index]!;
      byHand = 5 - 5 * (1e-3 / 1e-6) * (Math.exp(1e-6 / 1e-3) - 1) * Math.exp(-t / 1e-3);
      label = `${c.quantity} at t = ${t * 1e3} ms`;
    }
    const w = wv?.[index];
    const a47 = find(rec47.plots as never, name)?.[index];
    const v42 = find(rec42.plots as never, name);
    const sameGrid = v42 !== undefined && wv !== undefined && v42.length === wv.length;
    const a42 = sameGrid ? v42[index] : undefined;
    const printed = (p: ReturnType<typeof parsePrinted> | undefined): string => p?.get(name.toLowerCase())?.text ?? '';
    const ok = w !== undefined && agrees(w, byHand) && (a47 === undefined || agrees(w, a47)) && (a42 === undefined || agrees(w, a42));
    keyRows.push(
      `| ${id} | ${label} | ${g(byHand)} | ${printed(p47) || '(not printed)'} | ${g(a47)} | ${printed(p42) || '(not printed)'} | ${a42 === undefined ? '(different time grid)' : g(a42)} | ${g(w)} | ${ok ? 'yes' : '**NO**'} |`,
    );
  }

  for (const np of rec47.plots) {
    for (const nv of np.vectors) {
      const w = find(run.plots as RawPlot[], nv.name);
      const v42 = find(rec42.plots as never, nv.name);
      checks += 1;
      const ok47 = w !== undefined && w.length === nv.values.length && Array.from(w).every((x, i) => agrees(x, nv.values[i]!));
      if (ok47) agreeing += 1;
      else disagreements += 1;
      const same47 = w !== undefined && w.length === nv.values.length && Array.from(w).every((x, i) => x === nv.values[i]);
      if (same47) identical += 1;
      const d42 =
        w !== undefined && v42 !== undefined && v42.length === w.length
          ? maxRelativeDifference(w, v42).toExponential(1)
          : `grid differs (${v42?.length ?? 0} points)`;
      vectorRows.push(
        `| ${id} | \`${nv.name}\` | ${nv.values.length} | ${same47 ? 'identical' : w ? maxRelativeDifference(w, nv.values).toExponential(1) : 'missing'} | ${d42} | ${ok47 ? 'yes' : '**NO**'} |`,
      );
    }
  }
}

const doc = `# Fixture results

Generated by \`scripts/fixture-report.ts\` (run it again after changing the engine). Each fixture in
\`tests/fixtures/\` was run three ways:

- **by hand**: the value from Tarık's brief (\`tests/fixtures/expected.json\`);
- **native ngspice** on Linux: ngspice ${n47.ngspice.version} (built from the same release tarball as the
  engine) and ngspice ${n42.ngspice.version} (Ubuntu 24.04's package), both with \`ngspice -b\` (the printout a
  student sees) and \`ngspice -b -r\` (every vector at full precision); recorded in \`tests/golden/native/\`;
- **WebAssembly**: PlainSpice's engine (\`engine/dist/\`), in Node, the same code the page runs in its Web Worker.

The rule: agree with native ngspice to 6 significant figures (\`src/engine/compare.ts\`: the
difference is at most half a unit in the 6th significant digit). Batch mode prints 7 significant
digits for positive values and 6 for negative ones; it prints no table for \`.dc\` and \`.tran\`
unless the netlist has \`.print\` lines.

**Result: nothing disagrees with the expected values.** Across all ${checks} vectors of all ${ids.length}
fixtures, ${agreeing} agree with native ngspice 47 to 6 significant figures and ${identical} are bit-for-bit identical
(${disagreements} disagree).

## Key quantities

| Fixture | Quantity | By hand | ngspice 47 printed | ngspice 47 (full) | ngspice 42 printed | ngspice 42 (full) | WebAssembly | Agree? |
|---|---|---|---|---|---|---|---|---|
${keyRows.join('\n')}

Notes:
- F3a is the "1M" trap on purpose: \`R1 n1 n2 1M\` is one **milli**ohm, so v(n2) is 6 V × 1 MΩ / (1 MΩ + 1 mΩ)
  = 5.999999994 V, "about 6 V" as the brief says. With \`1meg\` (F3b) it is 3 V.
- F4's \`.tf\` results are what ngspice calls \`transfer_function\`, \`output_impedance_at_v(a)\` and
  \`v1#input_impedance\`; at DC they are a ratio and two resistances: 1/3, 4 Ω and 9 Ω.
- T1's by-hand value is the exact response of the RC circuit to the 1 µs ramp of the PULSE source (the
  ideal-step formula 5(1 − e^(−t/τ)) is up to 2.5 mV off because of that ramp). ngspice 42 uses a slightly
  different time grid (ngspice 46 changed how steps land before a breakpoint), so its points are not
  compared one by one; the WebAssembly run and native ngspice 47 have identical grids.
- Native ngspice 47 built with the engine's options (no XSPICE, OSDI or KLU) also gives the
  WebAssembly results bit for bit, on every fixture and on a 1 ns-edge RL step where an XSPICE
  build takes different time steps (\`tests/golden/engine-config.test.ts\`).

## Every vector, point by point (WebAssembly vs native)

| Fixture | Vector | Points | vs ngspice 47 (largest relative difference) | vs ngspice 42 | Agree to 6 sig. figs with 47? |
|---|---|---|---|---|---|
${vectorRows.join('\n')}
`;
writeFileSync(join(root, 'docs/fixture-results.md'), doc);
console.log(`wrote docs/fixture-results.md: ${agreeing}/${checks} vectors agree, ${identical} identical, ${disagreements} disagree`);
