/**
 * The Notebook's drawings with ngspice's own numbers: every example and fixture runs in the engine
 * (as the page runs it: src/notebook/solve.ts), and its results, placed on the drawing
 * (src/notebook/results.ts), each fit the room the schematic model kept for them, as drawn and turned
 * for a phone. On the checkpoint's circuits (p02, from "Thévenin Equivalent with Dependent Sources"),
 * the numbers written on the drawing are the ones the channel recorded with native ngspice
 * (examples/examples.json).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { NgspiceEngine } from '../../src/engine/ngspice.ts';
import { formatSI } from '../../src/format/si.ts';
import { answers, inlineValue, notebookSchematic, placeResults, solve, turnedQuarter, withDrawingBlock, type Solution } from '../../src/notebook/index.ts';

const root = resolve(import.meta.dirname, '../..');
const manifest = JSON.parse(readFileSync(join(root, 'examples/examples.json'), 'utf8')) as { examples: { id: string; file: string; expect: Record<string, number> }[] };
const CIRCUITS: { name: string; text: string }[] = [
  ...manifest.examples.map((e) => ({ name: e.id, text: readFileSync(join(root, 'examples', e.file), 'utf8') })),
  ...readdirSync(join(root, 'tests/fixtures'))
    .filter((f) => f.endsWith('.cir'))
    .map((f) => ({ name: f.slice(0, -4), text: readFileSync(join(root, 'tests/fixtures', f), 'utf8') })),
];

let engine: NgspiceEngine;
const solutions = new Map<string, Solution>();

beforeAll(async () => {
  engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
  for (const c of CIRCUITS) solutions.set(c.name, await solve(withDrawingBlock(c.text), engine));
});

const nb = (s: string): string => s.replace(/ /g, ' ');

describe.each(CIRCUITS)('$name', ({ name, text }) => {
  it('writes every result in the room kept for it, as drawn and turned', () => {
    const sol = solutions.get(name)!;
    const s = notebookSchematic(withDrawingBlock(text));
    const drawn = placeResults(s.scene, answers(sol));
    expect(drawn.squeezed.map((m) => m.text)).toEqual([]);
    const t = turnedQuarter(s);
    if (t) expect(placeResults(t.scene, answers(sol)).squeezed.map((m) => m.text)).toEqual([]);
  });

  it('writes ngspice’s numbers as the rest of PlainSpice does (formatSI), and only when they are answers', () => {
    const sol = solutions.get(name)!;
    const s = notebookSchematic(withDrawingBlock(text));
    const drawn = placeResults(s.scene, answers(sol));
    if (sol.status !== 'ok') {
      expect(drawn.parts.size + drawn.nodes.length).toBe(0);
      return;
    }
    // A node's voltage reads on from its name, in the model's notation: "a = 24 V".
    for (const n of drawn.nodes) expect(n.mark?.text).toBe(inlineValue(formatSI(n.words.value, 'V')));
    for (const p of drawn.parts.values()) {
      expect(p.marks[0]?.text).toBe(formatSI(Math.abs(p.current.value), 'A'));
      if (p.current.power) expect(p.marks[2]?.text).toBe(formatSI(p.current.power.watts, 'W'));
    }
  });
});

describe('the checkpoint’s circuits show the channel’s values', () => {
  /** The voltage written after a node's name ("a = 24 V"), without the "= ". */
  const voltage = (id: string, node: string): string | undefined => {
    const c = CIRCUITS.find((x) => x.name === id)!;
    const s = notebookSchematic(withDrawingBlock(c.text));
    const text = placeResults(s.scene, answers(solutions.get(id))).nodes.find((n) => n.node === node)?.mark?.text;
    return text?.startsWith(inlineValue('')) ? text.slice(inlineValue('').length).trimStart() : text;
  };
  const expected = (id: string, vector: string): number => manifest.examples.find((e) => e.id === id)!.expect[vector]!;

  it('example 3, open circuit: V_Th at a, and n1', () => {
    expect(voltage('p02-4-open', 'a')).toBe(formatSI(expected('p02-4-open', 'v(a)'), 'V'));
    expect(nb(voltage('p02-4-open', 'a')!)).toBe('24 V');
    expect(voltage('p02-4-open', 'n1')).toBe(formatSI(expected('p02-4-open', 'v(n1)'), 'V'));
  });

  it('example 3, short circuit: the 0 V source measures I_sc', () => {
    const c = CIRCUITS.find((x) => x.name === 'p02-5-short')!;
    const s = notebookSchematic(withDrawingBlock(c.text));
    const vshort = placeResults(s.scene, answers(solutions.get('p02-5-short'))).parts.get('vshort')!;
    expect(vshort.marks).toHaveLength(1);
    expect(vshort.marks[0]!.lead).toBe('measures');
    expect(vshort.marks[0]!.text).toBe(formatSI(expected('p02-5-short', 'i(vshort)'), 'A'));
    expect(voltage('p02-5-short', 'n1')).toBe(formatSI(expected('p02-5-short', 'v(n1)'), 'V'));
  });

  it('example 2, only a dependent source: a and n1 with the 1 A test current', () => {
    expect(voltage('p02-3-dependent-only', 'a')).toBe(formatSI(expected('p02-3-dependent-only', 'v(a)'), 'V'));
    expect(voltage('p02-3-dependent-only', 'n1')).toBe(formatSI(expected('p02-3-dependent-only', 'v(n1)'), 'V'));
  });
});

describe('after the final reviews (12 November 2026)', () => {
  // The Turkish link of tests/unit/share.test.ts: ngspice spells giriş "giri__" and çıkış "____k____" (W16).
  const TURKISH = '* Gerilim bölücü: 12 V, 1 kΩ ve 2 kΩ (çıkış İ ğ ş ö ü) µ 😀\nV1 giriş 0 12\nR1 giriş çıkış 1k\nR2 çıkış 0 2k\n.op\n.end\n';

  it('writes the voltages of nodes named with Turkish letters on the drawing, under the netlist\'s names (kept F3, W16)', async () => {
    const sol = await solve(withDrawingBlock(TURKISH), engine);
    expect(sol.status).toBe('ok');
    expect(sol.checks.map((c) => [c.id, c.severity])).toEqual([
      ['non-ascii-node', 'warning'],
      ['non-ascii-node', 'warning'],
    ]);
    const words = answers(sol)!;
    expect(words.nodes.map((n) => [n.node, n.ngspice, nb(n.text)])).toEqual([
      ['giriş', 'giri__', '12 V'],
      ['çıkış', '____k____', '8 V'],
    ]);
    expect(words.summarySpeech).toContain('node giriş is 12 volts, node çıkış is 8 volts');
    expect(nb(words.currents.find((c) => c.name === 'V1')!.power!.text)).toBe('V1 delivers 48 mW');
    const drawn = placeResults(notebookSchematic(withDrawingBlock(TURKISH)).scene, words);
    expect(drawn.nodes.map((n) => [n.node, n.mark ? nb(n.mark.text) : undefined])).toEqual([
      ['giriş', inlineValue(nb('12 V'))],
      ['çıkış', inlineValue(nb('8 V'))],
    ]);
  });

  it('shows no answers when two names become one node for ngspice: a check says so (kept F3, W17)', async () => {
    const sol = await solve(withDrawingBlock('* t\nV1 ş 0 12\nR1 ş ç 1k\nR2 ç 0 2k\n.op\n.end\n'), engine);
    expect(sol.status).toBe('check');
    expect(answers(sol)).toBeUndefined();
    expect(sol.checks.map((c) => [c.id, c.severity, c.title])).toEqual([['non-ascii-node', 'error', 'ş and ç are one node for ngspice']]);
  });
});
