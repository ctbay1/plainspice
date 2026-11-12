/**
 * The schematic model after the final reviews of milestone 2 (12 November 2026), each finding pinned
 * down: a node's name goes where it is read clear of the parts wherever its copper or its open end
 * leaves room, and a name the student moves stays where it was put (student:label-on-part); a ground
 * symbol is put where no wire runs through it wherever there is room, so a ladder built with the mouse
 * turns for a phone held upright (student:phone-link-unturned); and three sentences of the editor say
 * what happens and why (words:W6, W7, W10).
 */
import { describe, expect, it } from 'vitest';
import { nameShift } from '../../src/notebook/results.ts';
import { notebookSchematic } from '../../src/notebook/schematic.ts';
import { isWide, turnedQuarter, wireBends } from '../../src/notebook/turn.ts';
import { EDIT_STRINGS, applyEdit, boxesOverlap, buildSchematic, checkConnectivity, findOverlaps, segmentCrossesBox, segmentsOf, serializeDrawing, stripDrawing, type Box, type EditOp, type Schematic } from '../../src/schematic/index.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { checkTraps } from '../../src/spice/traps.ts';

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

/** The reviewer's ladder built with the editor, pin to pin, as far as its first `wires` wires (of six). */
function reviewerLadder(wires: number): Schematic {
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
  const all = [
    [0, 1, 2, 0],
    [6, 0, 8, 1],
    [8, 1, 10, 0],
    [14, 0, 16, 1],
    [16, 5, 8, 5],
    [8, 5, 0, 5],
  ] as const;
  for (const [a, b, c, d] of all.slice(0, wires)) step({ kind: 'add-wire', from: { at: { x: a, y: b } }, to: { at: { x: c, y: d } } });
  return s;
}

/**
 * What the drawing shows before a run that a name lies on: a symbol, a part's name or value, or
 * another name, each name taken where the Notebook writes it before it has a value (results.ts,
 * nameShift: a name with its value on its left is written up against its point).
 */
function namesOnWords(s: Schematic): string[] {
  const written: Box[] = s.scene.nodeLabels.map((l) => {
    const b = l.lines.find((x) => x.role === 'node')!.box;
    const dx = nameShift(l, undefined);
    return { x0: b.x0 + dx, y0: b.y0, x1: b.x1 + dx, y1: b.y1 };
  });
  const out: string[] = [];
  s.scene.nodeLabels.forEach((l, i) => {
    const b = written[i]!;
    for (const p of s.scene.parts) {
      if (boxesOverlap(b, p.box)) out.push(`${l.node} on ${p.name}`);
      for (const line of p.labels) if (line.role !== 'result' && boxesOverlap(b, line.box)) out.push(`${l.node} on ${p.name}'s ${line.role}`);
    }
    for (const g of s.scene.grounds) if (boxesOverlap(b, g.box)) out.push(`${l.node} on a ground symbol`);
    written.forEach((o, j) => j !== i && boxesOverlap(b, o) && out.push(`${l.node} on ${s.scene.nodeLabels[j]!.node}`));
  });
  return out;
}

describe('where a node\'s name is written (student:label-on-part)', () => {
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

  it('a name the student moves lands where it was put, even where it has no room, and is said to have moved only then', () => {
    // n4 is written at R2's top pin (8,1); on R1's side of the junction every spot touches R1, R3 or
    // their words. Before, each of these moves was "ok" and said "The name of node n4 moved." while
    // the rebuild put the name back at (8,1) (critic of the fix round): the student's point now stays,
    // with the spot the name has there kept (side=), as a part's side the student chose is kept.
    const s = notebookSchematic(MOUSE_LADDER);
    for (const to of [
      { x: 8, y: 0 },
      { x: 7, y: 0 },
      { x: 6, y: 0 },
      { x: 9, y: 0 },
      { x: 10, y: 0 },
    ]) {
      const r = applyEdit(s, { kind: 'move-label', node: 'n4', to });
      expect(r.ok, r.reason).toBe(true);
      expect(r.summary).toBe('The name of node n4 moved.');
      const after = notebookSchematic(r.text);
      expect(after.drawing.labels.find((l) => l.node === 'n4')!.at).toEqual(to);
      expect(after.scene.nodeLabels.find((l) => l.node === 'n4')!.at).toEqual(to);
      expect(r.text).toMatch(new RegExp(`^\\*@ label n4 ${to.x} ${to.y} side=`, 'm'));
    }
    // Moved on to a point with room, it is written there with a spot chosen afresh, clear of everything.
    const crowded = notebookSchematic(applyEdit(s, { kind: 'move-label', node: 'n4', to: { x: 8, y: 0 } }).text);
    const back = applyEdit(crowded, { kind: 'move-label', node: 'n4', to: { x: 8, y: 1 } });
    const roomy = notebookSchematic(back.text);
    expect(roomy.scene.nodeLabels.find((l) => l.node === 'n4')!.at).toEqual({ x: 8, y: 1 });
    expect(findOverlaps(roomy.scene)).toEqual([]);
  });

  it('built with the editor, pin to pin as the reviewer did, ends with no name on a part or its words', () => {
    const s = reviewerLadder(6);
    expect(s.circuit.parts.map((p) => p.name)).toEqual(['V1', 'R1', 'R2', 'R3', 'F1']);
    expect(nameOnPart(s)).toEqual([]);
  });

  it('a name at an open end (a pin not wired yet) stays at its end and is written clear of the parts near it: the reviewer\'s ladder after its first wire', () => {
    const s = reviewerLadder(1);
    const name = (node: string) => s.scene.nodeLabels.find((l) => l.node === node)!;
    const part = (key: string) => s.scene.parts.find((p) => p.key === key)!;
    // Before, n7 (R3's left end) was written across R3's zigzag, and n9 (F1's top end) over F1's
    // name, just as the red note asks the student to choose what F1 reads (critic of the fix round).
    expect(boxesOverlap(name('n7').box, part('r3').box)).toBe(false);
    expect(boxesOverlap(name('n9').box, part('f1').labelBox)).toBe(false);
    // Each still names its end: no spot at F1's top pin is clear, so n9 is written two units further
    // out, the way a wire would leave the pin; R1 and R3 leave no room between them, so n7 and n4
    // take the spots where, as written, they lie on no part.
    expect(s.scene.terminals.map((t) => `${t.node} ${t.at.x},${t.at.y}`)).toEqual(expect.arrayContaining(['n7 10,0', 'n9 16,1', 'n4 6,0']));
    expect([name('n7').at, name('n9').at, name('n4').at]).toEqual([
      { x: 10, y: 0 },
      { x: 16, y: 1 },
      { x: 6, y: 0 },
    ]);
    expect(name('n9').box.y1).toBeLessThanOrEqual(-1);
    expect(namesOnWords(s)).toEqual([]);
    // Wired on, every step reads clean too.
    for (let wires = 2; wires <= 6; wires++) expect(namesOnWords(reviewerLadder(wires)), `after wire ${wires}`).toEqual([]);
  });

  it('60 mouse-like builds (parts dropped on a grid, then pin-to-pin wires): no name, as written before it has a value, lies on a symbol, a part\'s words or another name', () => {
    // The critic's seeded random builds (randbuild.ts, seed 7). Before, 7 names lay on a symbol and 12
    // on a part's name or value, all at open ends; the rooms kept for the values may still touch.
    let seed = 7;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const found: string[] = [];
    for (let c = 0; c < 60; c++) {
      let s = notebookSchematic('');
      const step = (op: EditOp): void => {
        const r = applyEdit(s, op);
        if (r.ok) s = notebookSchematic(r.text);
      };
      const letters = ['R', 'R', 'R', 'V', 'C', 'I'] as const;
      const k = 3 + rnd(4);
      for (let i = 0; i < k; i++) step({ kind: 'add-part', letter: letters[rnd(letters.length)]!, at: { x: 4 * rnd(6), y: 4 * rnd(3) + (rnd(2) ? 0 : 3) }, rot: rnd(2) ? 0 : 270 });
      if (rnd(2)) step({ kind: 'add-ground', at: s.scene.parts[0]?.pins[1]?.at ?? { x: 0, y: 5 } });
      for (let w = 0; w < k + 1; w++) {
        const pins = s.scene.parts.flatMap((p) => p.pins);
        if (pins.length < 2) break;
        const a = pins[rnd(pins.length)]!.at;
        const b = pins[rnd(pins.length)]!.at;
        if (a.x === b.x && a.y === b.y) continue;
        step({ kind: 'add-wire', from: { at: a }, to: { at: b } });
      }
      found.push(...namesOnWords(s).map((x) => `build ${c}: ${x}`));
    }
    expect(found).toEqual([]);
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

describe('the editor says what happens and why (words:W6, W7, W10)', () => {
  const DIVIDER = '* divider\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n';

  it('W6: a name that differs from a node\'s only in capital letters joins that node, written as it is, and says why (fact W6)', () => {
    const s = buildSchematic(DIVIDER);
    const r = applyEdit(s, { kind: 'rename-node', node: 'out', name: 'IN' });
    expect(r.ok).toBe(true);
    expect(r.summary).toBe('Node out renamed to IN. SPICE ignores capital letters in node names, so IN is node in, which was already there: the two are now one node, in.');
    // The netlist keeps one spelling, the node's own, so nothing describes in and IN as two nodes.
    expect(stripDrawing(r.text)).toBe('* divider\nV1 in 0 6\nR1 in in 1k\nR2 in 0 2k\n.op\n.end\n');
    // The same spelling: the sentence it always was.
    expect(applyEdit(s, { kind: 'rename-node', node: 'out', name: 'in' }).summary).toBe('Node out renamed to in. A node called in was already there, so the two are now one node, in.');
    // A node's own name with other capital letters is a new spelling of that node, not a join.
    const own = applyEdit(s, { kind: 'rename-node', node: 'out', name: 'OUT' });
    expect(own.summary).toBe('Node out renamed to OUT.');
    expect(stripDrawing(own.text)).toContain('R1 in OUT 1k\nR2 OUT 0 2k');
  });

  it('W7: a half turn where a part stands is refused in words that never call Reverse a turn, nor ask to put the part down where it cannot go', () => {
    const s = buildSchematic(DIVIDER);
    const r1 = s.drawing.parts.get('r1')!;
    const r = applyEdit(s, { kind: 'move-part', part: 'R1', to: r1.at, rot: ((r1.rot + 180) % 360) as 0 | 90 | 180 | 270 });
    expect(r).toMatchObject({ ok: false, reason: 'A half turn of R1 where it stands would loop its wires round it. To swap its two ends, use Reverse once R1 is back in place.' });
    expect(EDIT_STRINGS.noHalfTurn('R1')).not.toMatch(/turning|round where/i);
    // The same words are the hint while R1 is in hand ("R1 can't go here: ..."), and what is said when
    // it goes back ("R1 went back: ..."): never "put it down" (words:W7, critic).
    expect(EDIT_STRINGS.noHalfTurn('R1')).not.toMatch(/put it down/i);
  });

  it.each(['gnd', 'GND'])('W10: Reverse refused on a line ending with %s names the Checks panel\'s own fix', (word) => {
    const text = `* gnd test\nV1 a 0 6\nR1 a b 2\nVx b ${word}\n.op\n.end\n`;
    const reason = applyEdit(buildSchematic(text), { kind: 'reverse-part', part: 'Vx' }).reason!;
    const fixes = checkTraps(parseNetlist(text)).flatMap((t) => t.fixes.map((f) => f.label));
    const rename = fixes.find((f) => f.startsWith('Rename') && f.endsWith('to 0'))!;
    expect(rename).toBe(`Rename ${word} to 0`);
    expect(reason).toContain(`Rename ${word} first: the Checks panel says why and offers “${rename}”.`);
    expect(reason).not.toContain('write 0');
  });
});
