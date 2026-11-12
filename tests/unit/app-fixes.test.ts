/**
 * A check's one-click fix applied to the netlist (src/app/fixes.ts): the fix's changes, and the
 * drawing lines it leaves with no node or part to name taken out with them, so the Checks tab never
 * warns about a line the student never wrote; and what the tab's count says aloud (final reviews,
 * kept F1: "Make n3 the ground" on the video's Mistake 1 left `*@ label n3` behind, and the tab said
 * 1 found while the fix was announced with no traps found).
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
    expect(offered.map((o) => o.fix.label)).toEqual(expect.arrayContaining(['Make n3 the ground (rename it to 0)', 'Rename n12 to n2', 'Rename n12 to n1']));
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
    const fix = readNetlist(text).traps.flatMap((t) => t.fixes).find((f) => f.label === 'Make n3 the ground (rename it to 0)')!;
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
    const fix = readNetlist(text).traps.flatMap((t) => t.fixes).find((f) => f.label === 'Rename n12 to n2')!;
    const next = fixedText(text, fix.changes, MAX);
    expect(next).toMatch(/^R2 n2 0 4$/m);
    expect(next).not.toContain('*@ label n12');
    expect(next).toContain('*@ label zz 30 30');
    expect(warnings(next)).toEqual([expect.stringMatching(/^No node is called zz/)]);
    // And the tab, and what is said, count it.
    expect(checksSaidFor(next, new Set(), MAX)).toBe('1 found in Checks.');
  });

  it('a netlist with more parts than the app draws is changed only as the fix says (it has no drawing to keep in step)', () => {
    const fix = readNetlist(typo).traps.flatMap((t) => t.fixes).find((f) => f.label === 'Rename n12 to n2')!;
    expect(fixedText(typo, fix.changes, 1)).toBe(applyChanges(typo, fix.changes));
    expect(fixedText(typo, fix.changes, MAX)).not.toBe(applyChanges(typo, fix.changes));
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
