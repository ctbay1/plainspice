/**
 * A check's one-click fix applied to the netlist (src/app/fixes.ts): the fix's changes, and the
 * drawing lines it leaves with no node or part to name taken out with them, so the Checks tab never
 * warns about a line the student never wrote; and what the tab's count says aloud (final reviews,
 * kept F1: "Make n3 the ground" on the video's Mistake 1 left `*@ label n3` behind, and the tab said
 * 1 found while the fix was announced with no traps found). A fix that renames a part keeps it where
 * it was drawn (its position line takes the new name: the critic of kept F1).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checksSaid, checksSaidFor, drawingWarnings, fixedText, stillToChoose } from '../../src/app/fixes.ts';
import { readNetlist } from '../../src/app/model.ts';
import { NOTEBOOK_OPTIONS } from '../../src/notebook/schematic.ts';
import { applyChanges, buildSchematic } from '../../src/schematic/index.ts';

const root = resolve(import.meta.dirname, '../..');
const manifest = JSON.parse(readFileSync(resolve(root, 'examples/examples.json'), 'utf8')) as { examples: { id: string; video: string; name: string }[] };
const exampleText = (e: { id: string; video: string }): string => readFileSync(resolve(root, `examples/${e.video}/${e.id}.cir`), 'utf8');
/** The most parts the app draws (App.tsx MAX_DRAWN_PARTS). */
const MAX = 60;
const warnings = (text: string): string[] => drawingWarnings(buildSchematic(text, NOTEBOOK_OPTIONS)).map((p) => p.message);

describe('a fix applied to a video’s example', () => {
  const offered = manifest.examples.flatMap((e) => {
    const text = exampleText(e);
    return readNetlist(text).traps.flatMap((trap) => trap.fixes.map((fix) => ({ example: e.name, text, fix })));
  });

  it('is offered on the mistake examples (the test below has fixes to try)', () => {
    expect(offered.map((o) => o.fix.label)).toEqual(expect.arrayContaining(['Make node n3 the ground (rename it to 0)', 'Rename node n12 to n2', 'Rename node n12 to n1']));
  });

  it('every fix offered on every example leaves no trap and no drawing warning', () => {
    for (const { example, text, fix } of offered) {
      const next = fixedText(text, fix.changes, MAX);
      expect(readNetlist(next).traps.map((t) => t.title), `${example}: ${fix.label}`).toEqual([]);
      expect(warnings(next), `${example}: ${fix.label}`).toEqual([]);
      expect(checksSaidFor(next, new Set(), MAX), `${example}: ${fix.label}`).toBe('No traps found.');
    }
  });

  it('takes out only the name the fix left without a node: everything else is as the fix wrote it', () => {
    const e = manifest.examples.find((x) => x.id === 'sp01-4-no-ground')!;
    const text = exampleText(e);
    const fix = readNetlist(text).traps.flatMap((t) => t.fixes).find((f) => f.label === 'Make node n3 the ground (rename it to 0)')!;
    const plain = applyChanges(text, fix.changes);
    // Without the tidying, the drawing warns about the label line of n3, which the student never wrote.
    expect(warnings(plain)).toEqual([expect.stringMatching(/^No node is called n3, so the name written on line \d+ is kept but not used\.$/)]);
    const next = fixedText(text, fix.changes, MAX);
    expect(next).toBe(plain.replace(/^\*@ label n3 .*\n/m, ''));
    expect(next).toMatch(/^R2 n2 0 4$/m);
  });
});

describe('a drawing line that already named nothing before the fix', () => {
  const typo = exampleText(manifest.examples.find((x) => x.id === 'sp01-5-typo')!);

  it('stays, for the student to see in the Checks panel', () => {
    const text = typo.replace(/^\.end$/m, '*@ label zz 30 30\n.end');
    expect(warnings(text)).toEqual([expect.stringMatching(/^No node is called zz/)]);
    const fix = readNetlist(text).traps.flatMap((t) => t.fixes).find((f) => f.label === 'Rename node n12 to n2')!;
    const next = fixedText(text, fix.changes, MAX);
    expect(next).toMatch(/^R2 n2 0 4$/m);
    expect(next).not.toContain('*@ label n12');
    expect(next).toContain('*@ label zz 30 30');
    expect(warnings(next)).toEqual([expect.stringMatching(/^No node is called zz/)]);
    // And the tab, and what is said, count it.
    expect(checksSaidFor(next, new Set(), MAX)).toBe('1 found in Checks.');
  });

  it('a netlist with more parts than the app draws is changed only as the fix says (it has no drawing to keep in step)', () => {
    const fix = readNetlist(typo).traps.flatMap((t) => t.fixes).find((f) => f.label === 'Rename node n12 to n2')!;
    expect(fixedText(typo, fix.changes, 1)).toBe(applyChanges(typo, fix.changes));
    expect(fixedText(typo, fix.changes, MAX)).not.toBe(applyChanges(typo, fix.changes));
  });
});

describe('a fix that renames a part (the critic of kept F1)', () => {
  // A drawn circuit whose R1 is written as 0 Ω: the zero-ohm check offers a 0 V source in its place.
  const ZERO = [
    '* My circuit: R1 as a wire',
    'V1 n1 0 6',
    'R1 n1 n2 0',
    'R2 n2 0 4',
    'I1 0 n2 3',
    '.op',
    '* plainspice-drawing v1',
    '*@ V1 0 8 0 side=left',
    '*@ R1 9 0 270 side=above',
    '*@ R2 17 8 0 side=right',
    '*@ I1 27 8 180 side=right',
    '*@ ground 17 15 0',
    '*@ wire 0,6 0,0 7,0',
    '*@ wire 11,0 27,0 27,6',
    '*@ wire 17,6 17,0',
    '*@ wire 0,10 0,15 27,15 27,10',
    '*@ wire 17,10 17,15',
    '*@ label n1 0 0 side=above-left',
    '*@ label n2 18 0 side=above-left',
    '.end',
    '',
  ].join('\n');
  const fixOf = (text: string, label: RegExp) => readNetlist(text).traps.flatMap((t) => t.fixes).find((f) => label.test(f.label))!;
  const notes = (text: string): string[] => buildSchematic(text, NOTEBOOK_OPTIONS).problems.map((p) => `${p.kind}: ${p.message}`);
  const placementOf = (text: string, key: string) => buildSchematic(text, NOTEBOOK_OPTIONS).drawing.parts.get(key);

  it('keeps the new part where the old one was drawn: its position line takes the new name, the rest as written', () => {
    const fix = fixOf(ZERO, /^Use a 0 V source instead \(VR1\)$/);
    // Without it, R1's line names nothing, and VR1 is placed elsewhere with wires drawn anew.
    const plain = applyChanges(ZERO, fix.changes);
    expect(notes(plain)).toEqual(expect.arrayContaining([expect.stringMatching(/^unknown-part: No part is called R1/), expect.stringMatching(/^placed-part: VR1 had no position/)]));
    const next = fixedText(ZERO, fix.changes, MAX);
    expect(next).toBe(plain.replace('*@ R1 9 0 270 side=above', '*@ VR1 9 0 270 side=above'));
    // No note at all: not placed, no wire redrawn, nothing to warn about; and no trap.
    expect(notes(next)).toEqual([]);
    expect(readNetlist(next).traps).toEqual([]);
    expect(placementOf(next, 'vr1')).toEqual(placementOf(ZERO, 'r1'));
    expect(checksSaidFor(next, new Set(), MAX)).toBe('No traps found.');
  });

  it('does so in a netlist with Windows line ends, and for a W written for a wire, whose line named nothing before', () => {
    const crlf = ZERO.replace(/\n/g, '\r\n');
    const fix = fixOf(crlf, /^Use a 0 V source instead \(VR1\)$/);
    expect(fixedText(crlf, fix.changes, MAX)).toBe(applyChanges(crlf, fix.changes).replace('*@ R1 9 0 270 side=above\r\n', '*@ VR1 9 0 270 side=above\r\n'));
    // W1 is not a part PlainSpice draws, so its line was kept but not used; as VW1 it is drawn there.
    const wire = ZERO.replace('R1 n1 n2 0', 'W1 n1 n2').replace('*@ R1 ', '*@ W1 ');
    expect(notes(wire)).toEqual(expect.arrayContaining([expect.stringMatching(/^unknown-part: No part is called W1/)]));
    const w = fixOf(wire, /^Use a 0 V source as the wire \(VW1\)$/);
    const next = fixedText(wire, w.changes, MAX);
    expect(next).toMatch(/^VW1 n1 n2 0$/m);
    expect(next).toContain('*@ VW1 9 0 270 side=above');
    expect(notes(next)).toEqual([]);
  });

  it('writes the name as the drawing reads it, and leaves the line to a part that keeps the old name', () => {
    // A G source named G1, renamed "ground" by a change on its name (a word of the drawing's own: written "part ground").
    const g = '* g\nV1 n1 0 6\nG1 n1 0 n1 0 0.1\nR1 n1 0 2\n.op\n* plainspice-drawing v1\n*@ V1 0 4 0\n*@ G1 6 4 0\n*@ R1 12 4 0\n.end\n';
    const from = g.indexOf('G1 n1');
    const next = fixedText(g, [{ from, to: from + 2, insert: 'ground' }], MAX);
    expect(next).toContain('*@ part ground 6 4 0');
    expect(placementOf(next, 'ground')).toEqual(placementOf(g, 'g1'));
    expect(notes(next).filter((n) => /^(unknown-part|placed-part|unreadable-line)/.test(n))).toEqual([]);
    // A second R1 renamed R2 ("Rename it R2"): R1 still stands where its line says; the new R2 is placed.
    const dup = ZERO.replace('R2 n2 0 4', 'R1 n2 0 4').replace('*@ R2 17 8 0 side=right\n', '');
    const fix = fixOf(dup, /^Rename it R2$/);
    const renamed = fixedText(dup, fix.changes, MAX);
    expect(renamed).toContain('*@ R1 9 0 270 side=above');
    expect(renamed).not.toContain('*@ R2');
    expect(drawingWarnings(buildSchematic(renamed, NOTEBOOK_OPTIONS))).toEqual([]);
  });

  it('takes out the position line of a part a change takes away (no part is left to stand there)', () => {
    const at = ZERO.indexOf('I1 0 n2 3');
    const next = fixedText(ZERO, [{ from: at, to: at, insert: '* ' }], MAX);
    expect(next).not.toContain('*@ I1');
    expect(next).toContain('* I1 0 n2 3');
    expect(warnings(next)).toEqual([]);
  });
});

describe('what the Checks tab’s count says aloud', () => {
  it('says traps while everything counted is a trap, else the tab’s own words', () => {
    expect(checksSaid(0, 0)).toBe('No traps found.');
    expect(checksSaid(1, 0)).toBe('1 trap found.');
    expect(checksSaid(2, 0)).toBe('2 traps found.');
    expect(checksSaid(0, 1)).toBe('1 found in Checks.');
    expect(checksSaid(1, 2)).toBe('3 found in Checks.');
  });

  it('counts a text as the tab does: its traps, its drawing’s warnings and the dependent sources still to choose', () => {
    const placed = '* t\nV1 a 0 6\nR1 a 0 2\nG1 a 0 a 0 0.1\n.op\n.end\n';
    const s = buildSchematic(placed, NOTEBOOK_OPTIONS);
    expect(stillToChoose(s, new Set(['g1', 'gone'])).map((u) => u.name)).toEqual(['G1']);
    expect(checksSaidFor(placed, new Set(['g1']), MAX)).toBe('1 found in Checks.');
    expect(checksSaidFor(placed, new Set(), MAX)).toBe('No traps found.');
  });
});
