/**
 * The schematic model after the final reviews of milestone 2 (12 November 2026), each finding pinned
 * down: a node's name is never written on a part (student:label-on-part); a ground symbol is never
 * put where a wire runs through it, so a ladder built with the mouse turns for a phone held upright
 * (student:phone-link-unturned).
 */
import { describe, expect, it } from 'vitest';
import { notebookSchematic } from '../../src/notebook/schematic.ts';
import { isWide, turnedQuarter, wireBends } from '../../src/notebook/turn.ts';
import { applyEdit, buildSchematic, checkConnectivity, findOverlaps, segmentCrossesBox, segmentsOf, serializeDrawing, stripDrawing, type EditOp, type Schematic } from '../../src/schematic/index.ts';

/** The reviewers' ladder built with the mouse (student:label-on-part), as its netlist was after a reload. */
const MOUSE_LADDER = `* circuit
V1 n1 0 12
R1 n1 n4 1k
R2 n4 0 2k
R3 n4 n8 3k
F1 0 n8 V1 2
.op
* plainspice-drawing v1
*@ V1 0 3 0
*@ R1 4 0 270
*@ R2 8 3 0
*@ R3 12 0 270
*@ F1 16 3 180
*@ ground 0 5 0
*@ wire 0,1 0,0 2,0
*@ wire 6,0 10,0
*@ wire 8,0 8,1
*@ wire 14,0 16,0 16,1
*@ wire 0,5 16,5
*@ label n1 0 1
*@ label n4 6 0
*@ label n8 14 0
.end
`;

/** The same ladder of resistors only (the skeptic's ladder4.cir). */
const LADDER4 = MOUSE_LADDER.replace('V1 n1 0 12', 'V1 n1 0 10')
  .replace('R1 n1 n4 1k\nR2 n4 0 2k\nR3 n4 n8 3k\nF1 0 n8 V1 2', 'R1 n1 n2 1k\nR2 n2 0 2k\nR3 n2 n3 3k\nR4 n3 0 4k')
  .replace('*@ F1 16 3 180', '*@ R4 16 3 0')
  .replace('*@ label n4 6 0', '*@ label n2 6 0')
  .replace('*@ label n8 14 0', '*@ label n3 14 0');

/** The overlaps of a node's name with a part or a part's words. */
const nameOnPart = (s: Schematic): string[] =>
  findOverlaps(s.scene)
    .filter((o) => (o.a.kind === 'node-label' || o.b.kind === 'node-label') && [o.a.kind, o.b.kind].some((k) => k === 'part' || k === 'part-label'))
    .map((o) => `${o.a.kind} ${o.a.id} / ${o.b.kind} ${o.b.id}`);

/** The netlist read back from the lines its schematic writes. */
const readBack = (text: string, s: Schematic): Schematic => notebookSchematic(stripDrawing(text).replace(/\.end\s*$/, `${serializeDrawing(s.circuit, s.drawing, s.kept).join('\n')}\n.end\n`));

describe('a node\'s name is never written on a part (student:label-on-part)', () => {
  it.each([
    ['the ladder built with the mouse', MOUSE_LADDER, 'n4'],
    ['the ladder of resistors', LADDER4, 'n2'],
  ])('%s: the name kept at a pin with no room moves along its copper to where it fits', (_, text, middle) => {
    const s = notebookSchematic(text);
    expect(findOverlaps(s.scene)).toEqual([]);
    // The middle node's name was kept at R1's right pin, where every spot is on R1 or its words; it
    // is written at R2's top pin, on the same copper, and the lines say so.
    expect(s.scene.nodeLabels.find((l) => l.node === middle)!.at).toEqual({ x: 8, y: 1 });
    expect(serializeDrawing(s.circuit, s.drawing)).toContain(`*@ label ${middle} 8 1`);
    // Read back from its own lines, the drawing is the same.
    expect(readBack(text, s).scene).toEqual(s.scene);
  });

  it('never moves a name whose spot the drawing stores, nor one that marks an open end', () => {
    const stored = notebookSchematic(MOUSE_LADDER.replace('*@ label n4 6 0', '*@ label n4 6 0 side=above-left'));
    expect(stored.scene.nodeLabels.find((l) => l.node === 'n4')!.at).toEqual({ x: 6, y: 0 });
    expect(stored.drawing.labels.find((l) => l.node === 'n4')!.at).toEqual({ x: 6, y: 0 });
    // A terminal: the name at the open end of a wire is that end, so it stays there.
    const open = notebookSchematic('* open end\nV1 a 0 5\nR1 a b 1k\n.op\n* plainspice-drawing v1\n*@ V1 0 3 0\n*@ R1 4 0 270\n*@ ground 0 5 0\n*@ wire 0,1 0,0 2,0\n*@ wire 6,0 7,0\n*@ label b 7 0\n.end\n');
    expect(open.scene.terminals.map((t) => t.at)).toEqual([{ x: 7, y: 0 }]);
    expect(open.scene.nodeLabels.find((l) => l.node === 'b')!.at).toEqual({ x: 7, y: 0 });
  });

  it('built with the editor, pin to pin as the reviewer did, ends with no name on a part or its words', () => {
    let s = notebookSchematic('');
    const step = (op: EditOp): void => {
      const r = applyEdit(s, op);
      expect(r.ok, r.reason).toBe(true);
      s = notebookSchematic(r.text);
    };
    step({ kind: 'add-part', letter: 'V', at: { x: 0, y: 3 } });
    step({ kind: 'set-value', part: 'V1', value: '12' });
    step({ kind: 'add-part', letter: 'R', at: { x: 4, y: 0 }, rot: 270 });
    step({ kind: 'add-part', letter: 'R', at: { x: 8, y: 3 } });
    step({ kind: 'set-value', part: 'R2', value: '2k' });
    step({ kind: 'add-part', letter: 'R', at: { x: 12, y: 0 }, rot: 270 });
    step({ kind: 'set-value', part: 'R3', value: '3k' });
    step({ kind: 'add-ground', at: { x: 0, y: 5 } });
    step({ kind: 'add-part', letter: 'F', at: { x: 16, y: 3 }, rot: 180 });
    for (const [a, b, c, d] of [
      [0, 1, 2, 0],
      [6, 0, 8, 1],
      [8, 1, 10, 0],
      [14, 0, 16, 1],
      [16, 5, 8, 5],
      [8, 5, 0, 5],
    ] as const) {
      step({ kind: 'add-wire', from: { at: { x: a, y: b } }, to: { at: { x: c, y: d } } });
    }
    expect(s.circuit.parts.map((p) => p.name)).toEqual(['V1', 'R1', 'R2', 'R3', 'F1']);
    expect(nameOnPart(s)).toEqual([]);
  });
});

describe('a ladder built with the mouse turns for a phone held upright (student:phone-link-unturned)', () => {
  it.each([
    ['the ladder built with the mouse', MOUSE_LADDER],
    ['the ladder of resistors', LADDER4],
    ['the ladder built with the mouse, its names not written', MOUSE_LADDER.replace(/\*@ label .*\n/g, '')],
  ])('%s: turned, whole and clean, its ground symbol hung below the end of the ground wire', (_, text) => {
    const s = notebookSchematic(text);
    expect(isWide(s)).toBe(true);
    const t = turnedQuarter(s)!;
    expect(t).toBeDefined();
    expect(findOverlaps(t.scene)).toEqual([]);
    expect(checkConnectivity(t.circuit, t.drawing).filter((c) => c.kind !== 'hidden')).toEqual([]);
    expect(wireBends(t.drawing.wires)).toBeLessThanOrEqual(wireBends(s.drawing.wires));
    expect(t.scene.parts.length).toBe(5);
    // The ground wire stands upright through the pins; the symbol hangs one unit below its lowest end,
    // with no wire through it.
    const [ground] = t.scene.grounds;
    expect(ground!.at).toEqual({ x: -5, y: 17 });
    for (const w of t.drawing.wires) for (const [a, b] of segmentsOf(w)) expect(segmentCrossesBox(a, b, ground!.box)).toBe(false);
  });

  it('never puts a ground symbol where a wire runs through it, as drawn either', () => {
    // A ground wire drawn upright through the pins, and no ground symbol: one is added.
    const text = '* upright rail\nV1 a 0 5\nR1 a 0 1k\nR2 a 0 2k\n.op\n* plainspice-drawing v1\n*@ V1 -3 0 90\n*@ R1 -3 4 90\n*@ R2 -3 8 90\n*@ wire -1,0 -1,8\n*@ wire -5,0 -5,8\n.end\n';
    const s = buildSchematic(text);
    expect(s.problems.map((p) => p.kind)).toContain('ground-added');
    const [ground] = s.scene.grounds;
    expect(ground).toBeDefined();
    for (const w of s.drawing.wires) for (const [a, b] of segmentsOf(w)) expect(segmentCrossesBox(a, b, ground!.box), JSON.stringify(w)).toBe(false);
    expect(findOverlaps(s.scene)).toEqual([]);
    expect(checkConnectivity(s.circuit, s.drawing)).toEqual([]);
  });
});
