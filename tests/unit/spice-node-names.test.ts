/**
 * Node names written two ways, in the results (the integration check of 14 November 2026: P1, P7 and noise-4;
 * decision 0016, "After the integration check"; non-ascii-node-20, -27 and -29 in docs/spice-facts/traps.md).
 *
 * ngspice spells Çıkış and çıkış alike (____k____), so its results name the node so. A name only a formula, a
 * .func or a dot command reads is the node the parts are on (ownerOf in traps.ts), and spellings on part lines
 * that differ only in capital letters are their first one (caseAliases): the results name and key the node so,
 * for the words, the drawing and the rounding-noise rule alike. Native ngspice 47 and 42 (-b -r) give these values.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { solveText } from '../../src/app/model.ts';
import type { AnalysisResults } from '../../src/engine/results.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import type { RunResult } from '../../src/engine/types.ts';
import { placeResults } from '../../src/notebook/results.ts';
import { notebookSchematic, withDrawingBlock } from '../../src/notebook/schematic.ts';
import { describeResults } from '../../src/spice/describe.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { checkTraps } from '../../src/spice/traps.ts';

const T = 'çıkış'; // çıkış
const TC = 'Çıkış'; // Çıkış
const run: RunResult = { ok: true, unreliable: false, exitCode: 0, stdout: '', stderr: '', plots: [], diagnostics: [], timings: { instantiateMs: 0, runMs: 0, parseMs: 0 } };
const op = (nodes: Record<string, number>): AnalysisResults => ({ op: { nodes: Object.entries(nodes).map(([node, value]) => ({ node, value })), currents: [] }, other: [] });
const sp = (s: string | undefined): string => (s ?? '').replace(/[   ]/g, ' ');
const DIVIDER = `* t\nV1 giris 0 10\nR1 giris ${T} 1k\nR2 ${T} 0 1k\n`;

let ngspice: NgspiceEngine;
beforeAll(async () => {
  ngspice = await NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(import.meta.dirname, '../../engine/dist/ngspice.wasm')));
});

describe('a name only read, written with another capital letter, is the node the parts are on (P1, P7)', () => {
  it.each([
    ['a B formula', `${DIVIDER}B1 b 0 V=v(${TC})*2\nRb b 0 1k\n.op\n.end\n`],
    ['an E formula', `${DIVIDER}E1 b 0 VALUE={v(${TC})*2}\nRb b 0 1k\n.op\n.end\n`],
    ['a .func', `${DIVIDER}.func vo() {v(${TC})}\nB1 b 0 V=vo()*2\nRb b 0 1k\n.op\n.end\n`],
    ['a .pz beside an .op', `${DIVIDER}Rb b 0 1k\nVb b 0 10\n.op\n.pz giris 0 ${TC} 0 vol pz\n.end\n`],
    ['a .tf', `${DIVIDER}Rb b 0 1k\nVb b 0 10\n.op\n.tf v(${TC}) V1\n.end\n`],
  ])('%s: ngspice\'s v(____k____) is the node çıkış in the words', (_what, text) => {
    const w = describeResults(parseNetlist(text), op({ giris: 10, ____k____: 5, b: 10 }), run);
    expect(w.nodes.map((n) => [n.node, n.ngspice ?? n.node])).toEqual([
      ['giris', 'giris'],
      [T, '____k____'],
      ['b', 'b'],
    ]);
    expect(w.summarySpeech).toContain(`node ${T} is 5 volts`);
    expect(w.summary).not.toContain('____k____');
  });

  it('the drawing writes the node\'s voltage at çıkış, as c520a49 did (formulas.spec.ts\'s netlist)', async () => {
    const text = `${DIVIDER}B1 b 0 V=v(${TC})*2\nRb b 0 1k\n.op\n.end\n`;
    const r = await solveText(text, ngspice);
    expect(r.status).toBe('ok');
    const drawn = placeResults(notebookSchematic(withDrawingBlock(text)).scene, r.words);
    expect(drawn.nodes.map((n) => [n.node, sp(n.mark?.text)])).toEqual([
      ['giris', '= 10 V'],
      [T, '= 5 V'],
      ['b', '= 10 V'],
    ]);
  });
});

describe('spellings on part lines that differ only in capital letters are their first one (CR2-3, noise-4)', () => {
  it('a divider written Çıkış and çıkış: the node is Çıkış, as first written, in the words and on the drawing', async () => {
    const text = `* t\nV1 giris 0 10\nR1 giris ${TC} 1k\nR2 ${T} 0 1k\n.op\n.end\n`;
    const w = describeResults(parseNetlist(text), op({ giris: 10, ____k____: 5 }), run);
    expect(w.nodes.map((n) => [n.node, n.ngspice ?? n.node])).toEqual([
      ['giris', 'giris'],
      [TC, '____k____'],
    ]);
    const r = await solveText(text, ngspice);
    expect(r.status).toBe('ok');
    expect(sp(r.words.summary)).toContain(`node ${TC} = 5 V`);
    const drawn = placeResults(notebookSchematic(withDrawingBlock(text)).scene, r.words);
    expect(drawn.nodes.filter((n) => n.mark).map((n) => [n.node, sp(n.mark!.text)])).toEqual([
      ['giris', '= 10 V'],
      [TC, '= 5 V'],
    ]);
  });

  it('a part with an end on each spelling: the error, and the names stay as ngspice spells them (X1, W17)', () => {
    const text = `* t\nV1 in 0 10\nR1 in ${TC} 1k\nR2 ${TC} ${T} 1k\nR3 ${T} 0 1k\n.op\n.end\n`;
    const w = describeResults(parseNetlist(text), op({ in: 10, ____k____: 5 }), run);
    expect(w.nodes.map((n) => n.node)).toEqual(['in', '____k____']);
  });

  it.each([
    // C9's balanced bridge, its node written çıkış and Çıkış on part lines, with a transistor (the rule decides).
    ['tr2', `* t\nV1 top 0 9\nR1 top ${T} 10k\nR2 ${TC} 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 ${T} b 1k\nQ1 top x 0 qmod\nRx x 0 1meg\n.model qmod npn\n.options savecurrents\n.op\n.end\n`],
    // The same bridge with çıkış on every part line, read by a formula as Çıkış.
    ['tr3', `* t\nV1 top 0 9\nR1 top ${T} 10k\nR2 ${T} 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 ${T} b 1k\nB1 x 0 V=v(${TC})*2\nRx x 0 1k\n.options savecurrents\n.op\n.end\n`],
  ])('%s: R5\'s exact 0 (ngspice\'s −8.882e-19 A) is rounding noise, its two ends at node çıkış and node b, 4.5 V', async (_name, text) => {
    const r = await solveText(text, ngspice);
    expect(r.status).toBe('ok');
    const r5 = r.words.currents.find((c) => c.name === 'R5')!;
    expect(r5.value).toBe(0);
    expect(r5.noise).toBe(-8.881784197001253e-19);
    const note = r.words.warnings.find((m) => m.code === 'rounding-noise' && m.line === 7)!;
    expect(sp(note.why)).toContain(`the two ends of R5, node ${T} and node b, are at the same voltage, 4.5 V`);
    expect(r.words.nodes.map((n) => n.node)).toContain(T);
    expect(sp(r.words.summary)).toContain(`node ${T} = 4.5 V`);
    expect(r.words.summary).not.toContain('____k____');
  });

  it('a nearly balanced bridge with an ammeter on the other spelling: Vm\'s real 91.19 fA is never called noise for "every other current at node Çıkış" (the noise-4 skeptic\'s fz1)', async () => {
    // Native 47 and 42: i(vm) = -9.118536484729038e-14, which is R1's current less R2's: real, from R4's 1.4 nΩ more.
    const text = `* t\nV1 top 0 9\nR1 top ${T} 10k\nR2 ${T} 0 10k\nR3 top b 4.7k\nR4 b 0 4700.0000014\nVm ${TC} b 0\nQ1 top x 0 qmod\nRx x 0 1meg\n.model qmod npn\n.options savecurrents\n.op\n.end\n`;
    const r = await solveText(text, ngspice);
    const vm = r.words.currents.find((c) => c.name === 'Vm')!;
    expect(vm.value).toBe(-9.118536484729038e-14);
    expect(r.words.warnings.map((m) => [m.code, m.line])).toContainEqual(['maybe-noise', 7]);
    expect(r.words.warnings.map((m) => m.why).join(' ')).not.toContain('every other current at node');
  });
});

describe('ngspice\'s name for a node inside a subcircuit (x1.çıkış) gets no rename of that name alone (the integration check, regression P2; non-ascii-node-30)', () => {
  // A divider inside a subcircuit, its middle node written with odd characters, read through X1 by .tf or a formula.
  const sub = (node: string, reader: string): string => `* t\nV1 in 0 10\nX1 in 0 div\n.subckt div a b\nR1 a ${node} 1k\nR2 ${node} b 1k\n.ends\n${reader.replaceAll('NODE', `x1.${node}`)}\n.op\n.end\n`;
  const CASES: [string, string][] = [
    ['Turkish letters', T],
    ['a Cyrillic letter', '\u043eut'],
    ['a zero-width space', 'o\u200but'],
    ['a thin space', 'o\u2009ut'],
    ['a no-break space', 'o\u00a0ut'],
  ];
  it.each(CASES)('%s, on a .tf: the warning says where to rename, and offers no rename that would leave the subcircuit\'s node behind', (_what, node) => {
    const traps = checkTraps(parseNetlist(sub(node, 'R3 in 0 1k\n.tf v(NODE) V1')));
    const own = traps.filter((t) => t.line === 9);
    expect(own.map((t) => t.severity)).toEqual(['warning']);
    expect(own[0]!.why).toContain(`x1.${node} is ngspice's name for node ${node} of the subcircuit div (from line 4): a rename here alone would name a node nothing connects to, so rename it on that subcircuit's lines and here together.`);
    expect(own[0]!.fixes).toEqual([]);
    expect(traps.some((t) => t.id === 'tf-problems')).toBe(false);
  });
  it.each(CASES)('%s, read by a B formula: no false error that no part connects to it, as ngspice runs the circuit', (_what, node) => {
    const traps = checkTraps(parseNetlist(sub(node, 'B1 o 0 V={v(NODE)*2}\nR3 o 0 1k')));
    const own = traps.filter((t) => t.line === 8);
    expect(own.map((t) => t.severity)).toEqual(['warning']);
    expect(own[0]!.title).not.toContain('nothing connects to');
    expect(own[0]!.fixes).toEqual([]);
  });
  it('a name in the main circuit keeps its rename (non-ascii-node-1), and so does one no subcircuit has', () => {
    const main = checkTraps(parseNetlist(`* t\nV1 in 0 10\nR1 in ${T} 1k\nR2 ${T} 0 1k\n.op\n.end\n`))[0]!;
    expect(main.fixes.map((f) => f.label)).toEqual([`Rename node ${T} to cikis`]);
    const none = checkTraps(parseNetlist(sub('m', `R3 in 0 1k\n.tf v(x1.${T}) V1`).replace(`.tf v(x1.m.`, '.tf v(x1.')));
    expect(none.find((t) => t.id === 'non-ascii-node')?.why ?? '').not.toContain("is ngspice's name for");
  });
  it.each([
    [`x1.${TC} for the subcircuit's ${T}`, T, `x1.${TC}`, ''],
    [`x1.${T} for the subcircuit's ${TC}`, TC, `x1.${T}`, ''],
    [`x1.x2.${TC} for ${T} two subcircuits down`, T, `x1.x2.${TC}`, 'x2'],
  ])('%s, another capital letter: ngspice reads the same node (x1.____k____), so the same warning and no rename (the round-1 critic of these fixes; non-ascii-node-32)', (_what, node, name, nested) => {
    const subs = nested
      ? `X1 in 0 outer\n.subckt outer p q\nX2 p q div\n.ends\n.subckt div a b\nR1 a ${node} 1k\nR2 ${node} b 1k\n.ends\n`
      : `X1 in 0 div\n.subckt div a b\nR1 a ${node} 1k\nR2 ${node} b 1k\n.ends\n`;
    const at = nested ? 7 : 4;
    for (const reader of [`R3 in 0 1k\n.tf v(${name}) V1`, `.save v(${name}) v(in)\nR3 in 0 1k`, `B1 o 0 V={v(${name})*2}\nR3 o 0 1k`]) {
      const own = checkTraps(parseNetlist(`* t\nV1 in 0 10\n${subs}${reader}\n.op\n.end\n`)).filter((t) => t.id === 'non-ascii-node');
      expect(own.map((t) => t.severity), reader).toEqual(['warning']);
      expect(own[0]!.why, reader).toContain(`${name} is ngspice's name for node ${node} of the subcircuit div (from line ${at}): a rename here alone would name a node nothing connects to`);
      expect(own[0]!.fixes, reader).toEqual([]);
    }
  });
});
