/**
 * The one statement about SPICE that the app shell writes itself (the Help dialog's "sign of a
 * source's current", src/i18n/en.ts helpSign1-2), checked by running the example it names through
 * our ngspice (WebAssembly, the same engine the page uses). Native ngspice 47 prints the same:
 * "v1#branch -3.00000e+00" (tests/golden/native/ngspice-47/f1a-voltage-source.json; docs/spice-facts S2).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { EXAMPLES } from '../../src/app/examples.ts';
import { interpretPlots } from '../../src/engine/results.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { en } from '../../src/i18n/en.ts';

const root = resolve(import.meta.dirname, '../..');

describe('Help: the sign of a source’s current', () => {
  it('names its example by the name in the Examples menu, a 6 V source across 2 Ω', () => {
    expect(EXAMPLES[0]!.id).toBe('f1a-voltage-source');
    expect(EXAMPLES[0]!.netlist).toMatch(/^V1 n1 0 6$/m);
    expect(EXAMPLES[0]!.netlist).toMatch(/^R1 n1 0 2$/m);
    // By name, not "the first example": a first visit opens another one (words review m6).
    expect(en.helpSign2).toContain(`the example “${en.exampleF1a}”, a 6 V source across 2 Ω`);
  });

  it('says the sign turns around for a negative value (words review M2; C1b in docs/spice-facts/explanations.md)', async () => {
    const engine = await NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(root, 'engine/dist/ngspice.wasm')));
    const run = await engine.run('* a source with a negative value that delivers power\nV1 0 n1 -6\nR1 n1 0 2\n.op\n.end\n');
    const op = interpretPlots(run.plots).op!;
    expect(op.nodes.find((n) => n.node === 'n1')?.value).toBe(6);
    expect(op.currents.find((c) => c.element === 'v1')?.value).toBe(3); // delivers 18 W with a positive current
    expect(en.helpSign2).toContain('With a negative value the + side is the lower one, and the sign turns around.');
    expect(en.helpSign2).not.toMatch(/^So a source that delivers power shows a negative current/);
  });

  it('ngspice gives i(v1) = −3 A there: the current enters at the + node, so a source that delivers power reads negative', async () => {
    const engine = await NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(root, 'engine/dist/ngspice.wasm')));
    const run = await engine.run(EXAMPLES[0]!.netlist);
    const op = interpretPlots(run.plots).op!;
    expect(op.nodes.find((n) => n.node === 'n1')?.value).toBe(6);
    expect(op.currents.find((c) => c.element === 'v1')?.value).toBe(-3);
    expect(en.helpSign2).toContain('i(v1) = −3 A');
    expect(en.helpSign1).toContain('flows into its + node');
  });
});
