/**
 * docs/spice-facts/traps.md after the last pass before the release (13 November 2026), the words lane: the runs
 * the facts record in prose beside their netlists, checked against our WebAssembly engine, and the trap texts
 * that say them. Native ngspice 47 and 42 were run for each (`ngspice -b` and `ngspice -b -r`); our engine is
 * ngspice 47, so it must print 47's words.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { NgspiceEngine } from '../../src/engine/ngspice.ts';
import { interpretPlots } from '../../src/engine/results.ts';
import type { RunResult } from '../../src/engine/types.ts';
import { describeResults } from '../../src/spice/describe.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { applyFix, checkTraps } from '../../src/spice/traps.ts';

const root = resolve(import.meta.dirname, '../..');
let engine: NgspiceEngine;
beforeAll(async () => {
  engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
});

const vector = (r: RunResult, name: string): number[] | undefined => {
  for (const p of r.plots) {
    const i = p.variables.findIndex((v) => v.name === name);
    if (i >= 0) return Array.from(p.real[i]!);
  }
  return undefined;
};

describe('a value the part can only report stops ngspice 47 with its longer message, and ngspice 42 with its shorter one (space-before-suffix-19, -20, unknown-word-56, -57; round-1 critic C7)', () => {
  // The netlists of those records (docs/spice-facts/traps.md), run in native 47 and 42 (`-b` and `-b -r`): 47 prints
  // "no such parameter on this device or parameter is missing", 42 "no such parameter on this device" (exit 1 in both).
  // V's v and I's i are no such value: "unknown parameter" in both, as the checks say.
  const NO_SUCH = "ngspice 47 stops: 'no such parameter on this device or parameter is missing' (ngspice 42: 'no such parameter on this device')";
  it.each([
    ['space-before-suffix-19', '* a space before p on a capacitor: p is its power, which it can only report\nV1 in 0 1\nR9 in out 1k\nC1 out 0 1 p\n.op\n.end\n', 'space-before-suffix', `${NO_SUCH}, as p is a value ngspice can report for the part, not one you can set. [space-before-suffix-19]`],
    ['space-before-suffix-19', '* a space before v on an inductor: v is its voltage, which it can only report\nV1 in 0 1\nR9 in out 1k\nL1 out 0 1 v\n.op\n.end\n', 'space-before-suffix', `${NO_SUCH}, as v is a value ngspice can report for the part, not one you can set. [space-before-suffix-19]`],
    ['space-before-suffix-19', '* a space before volt on an inductor: volt is its voltage too\nV1 in 0 1\nR9 in out 1k\nL1 out 0 1 volt\n.op\n.end\n', 'space-before-suffix', `${NO_SUCH}, as volt is a value ngspice can report for the part, not one you can set. [space-before-suffix-19]`],
    ['space-before-suffix-19', '* a space before p on an inductor: p is its power, which it can only report\nV1 in 0 1\nR9 in out 1k\nL1 out 0 1 p\n.op\n.end\n', 'space-before-suffix', `${NO_SUCH}, as p is a value ngspice can report for the part, not one you can set. [space-before-suffix-19]`],
    ['space-before-suffix-20', '* a space before p on a voltage source: p is its power, which it can only report\nV1 a 0 dc 5 p\nR1 a 0 1k\n.op\n.end\n', 'space-before-suffix', `${NO_SUCH}, as p is a value ngspice can report for the part, not one you can set. [space-before-suffix-20]`],
    ['space-before-suffix-20', '* a space before p on a current source: 1 p meant as 1 pA\nI1 0 a 1 p\nR1 a 0 1k\n.op\n.end\n', 'space-before-suffix', `${NO_SUCH}, as p is a value ngspice can report for the part, not one you can set. [space-before-suffix-20]`],
    ['space-before-suffix-20', '* a space before v on a current source: v is its voltage, which it can only report\nI1 0 a 1 v\nR1 a 0 1k\n.op\n.end\n', 'space-before-suffix', `${NO_SUCH}, as v is a value ngspice can report for the part, not one you can set. [space-before-suffix-20]`],
    ['space-before-suffix-20', '* a space before v on a voltage source, which reports no v\nV1 a 0 5 v\nR1 a 0 1k\n.op\n.end\n', 'space-before-suffix', "ngspice stops: 'unknown parameter (v)'. [space-before-suffix-2, space-before-suffix-3, space-before-suffix-4, space-before-suffix-5]"],
    ['unknown-word-56', '* the current of a capacitor, written after its value\nV1 in 0 1\nR9 in out 1k\nC1 out 0 1u i\n.op\n.end\n', 'unknown-word', `${NO_SUCH}. [unknown-word-56]`],
    ['unknown-word-56', '* the flux of an inductor, written after its value\nV1 in 0 1\nR9 in out 1k\nL1 out 0 1m flux\n.op\n.end\n', 'unknown-word', `${NO_SUCH}. [unknown-word-56]`],
    ['unknown-word-56', '* the dc sensitivity of a resistor, written after its value\nV1 in 0 1\nR9 in out 1k\nR1 out 0 1k sens_dc\n.op\n.end\n', 'unknown-word', `${NO_SUCH}. [unknown-word-56]`],
    ['unknown-word-57', '* the current of a voltage source, written after its value\nV1 a 0 5 i\nR1 a 0 1k\n.op\n.end\n', 'unknown-word', `${NO_SUCH}. [unknown-word-57]`],
    ['unknown-word-57', '* the voltage of a current source, written after its AC value\nI1 0 a 1 ac 1 v\nR1 a 0 1k\n.op\n.end\n', 'unknown-word', `${NO_SUCH}. [unknown-word-57]`],
    ['unknown-word-57', '* a current source reports no i\nI1 0 a 1 i\nR1 a 0 1k\n.op\n.end\n', 'unknown-word', "ngspice stops: 'unknown parameter (i)'. [unknown-word-1, unknown-word-2, unknown-word-3, unknown-word-7]"],
  ])('%s: %s', async (_, netlist, id, says) => {
    const run = await engine.run(netlist);
    expect(run.ok).toBe(false);
    const message = says.startsWith(NO_SUCH) ? 'no such parameter on this device or parameter is missing' : /'(unknown parameter \([a-z]+\))'/.exec(says)![1]!;
    expect(`${run.stdout}\n${run.stderr}`).toContain(message);
    const traps = checkTraps(parseNetlist(netlist));
    expect(traps.map((t) => t.id)).toEqual([id]);
    expect(traps[0]!.ngspice).toBe(says);
    for (const fix of traps[0]!.fixes) {
      const fixed = await engine.run(applyFix(netlist, fix));
      expect([fixed.ok, fixed.unreliable], fix.label).toEqual([true, false]);
    }
  });
});

describe('a results file with its header only: where native ngspice 47 and 42 exit 0 with a header and 0 points, our engine reports it (dc-sweep-problems-3, -4, -22, invisible-character-33)', () => {
  // The netlists of those facts (docs/spice-facts/traps.md); native 47 and 42 write a DC transfer characteristic header with 0 points.
  it.each([
    ['dc-sweep-problems-3', '* .dc with a negative step and a rising range\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 0 12 -1\n.end\n'],
    ['dc-sweep-problems-4', '* .dc from 12 down to 0 with a positive step\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 12 0 1\n.end\n'],
    ['dc-sweep-problems-22', '* both sweeps go the wrong way\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 2 1 1 V2 2 1 1\n.end\n'],
    ['invisible-character-33', '* a zero-width space inside a .dc stop: it reads 1, below the start\nV1 in 0 1\nR1 in 0 1k\n.dc V1 2 1\u200b0 1\n.end\n'],
  ])('%s', async (_, netlist) => {
    const run = await engine.run(netlist);
    expect(run.exitCode).toBe(0);
    expect(run.ok).toBe(false);
    expect(run.diagnostics.map((d) => [d.code, d.text])).toEqual([['rawfile', expect.stringContaining('header without a Binary: or Values: section')]]);
  });
});

describe('zero-ohm-9: below 1e-12 Ω but not 0, the currents next to the resistor can come out inaccurate, as the zero-ohm check’s why says (round-1 critic C3)', () => {
  // The vectors are native ngspice 47's, bit for bit (docs/spice-facts/traps.md, zero-ohm-9); native 42 keeps each value and gives V1 0 A.
  it.each([
    ['1 fΩ in series with 1 kΩ: V1 5.859 mA and R1 6.217 mA, for 6 mA', '* 1 femtoohm in series with 1k, as PlainSpice runs it (.options savecurrents)\nV1 a 0 6\nR1 a b 1f\nR2 b 0 1k\n.options savecurrents\n.op\n.end\n', { 'v(b)': 5.999999999999994, 'i(v1)': -0.005859375, 'i(@r1[i])': 0.006217248937900877, 'i(@r2[i])': 0.005999999999999994 }, '1.000000e-12', ['zero-ohm']],
    ['−3 aΩ in series with 1 kΩ: V1 4.883 mA and R1 5.329 mA', '* minus 3 attoohms in series with 1k, as PlainSpice runs it (.options savecurrents)\nV1 a 0 6\nR1 a b -3e-18\nR2 b 0 1k\n.options savecurrents\n.op\n.end\n', { 'v(b)': 6.000000000000005, 'i(v1)': -0.0048828125, 'i(@r1[i])': 0.005329070518200751, 'i(@r2[i])': 0.006000000000000005 }, '-1.000000e-12', ['zero-ohm']],
    ['3a where a current source sets the current: exactly 1 A, so "can", not always', '* 3a on a resistor, as PlainSpice runs it (.options savecurrents)\nI1 0 n1 1\nR1 n1 0 3a\n.options savecurrents\n.op\n.end\n', { 'v(n1)': 1e-12, 'i(@i1[current])': 1, 'i(@r1[i])': 1 }, '1.000000e-12', ['unit-letter']],
  ])('%s', async (_, netlist, vectors, set, ids) => {
    const run = await engine.run(netlist);
    expect([run.ok, run.unreliable]).toEqual([true, false]);
    for (const [name, want] of Object.entries(vectors)) expect(vector(run, name), name).toEqual([want]);
    expect(run.stderr).toContain(`Warning: Value of resistor r1 is too small, set to ${set}`);
    const traps = checkTraps(parseNetlist(netlist));
    expect(traps.map((t) => t.id)).toEqual(ids);
    if (ids[0] === 'zero-ohm') {
      expect(traps[0]!.why).toContain('it uses ' + (set.startsWith('-') ? '\u2212' : '') + '10⁻¹² Ω instead, and the currents next to it can come out inaccurate.');
      expect(traps[0]!.ngspice).toMatch(/\[zero-ohm-7, zero-ohm-9\]$/);
    }
    // The Numbers panel's words for ngspice's warning say the same on the same page: the value ngspice 47 used, and "can"
    // (integration check P4); for −3 aΩ, the check's own first sentence, word for word.
    const note = describeResults(parseNetlist(netlist), interpretPlots(run.plots), run).warnings.find((w) => w.code === 'resistor-too-small')!;
    expect(note.why).toContain(`it uses ${set.startsWith('-') ? '−' : ''}10⁻¹² Ω instead, and the currents next to it can come out inaccurate.`);
    if (set.startsWith('-')) expect(note.why.startsWith(traps[0]!.why.slice(0, traps[0]!.why.indexOf('. ') + 1))).toBe(true);
    for (const t of traps) {
      for (const fix of t.fixes) {
        const fixed = await engine.run(applyFix(netlist, fix));
        expect([fixed.ok, fixed.unreliable], fix.label).toEqual([true, false]);
      }
    }
  });
});
