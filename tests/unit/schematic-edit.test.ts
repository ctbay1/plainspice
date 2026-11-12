/**
 * src/schematic/edit.ts: the schematic editor's operations, as text changes on the netlist. Every
 * edit must change only what it needs (the student's lines, comments and spacing stay), give text
 * whose drawing rebuilds exactly as the edit left it, and keep the drawing's connectivity equal to
 * the netlist's.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VALUES,
  EDIT_STRINGS,
  applyChanges,
  applyEdit,
  buildSchematic,
  drawnPins,
  findIslands,
  mergeChanges,
  parseDrawingLines,
  placedPart,
  schematicConnectivity,
  stripDrawing,
  type EditOp,
  type EditResult,
  type Schematic,
} from '../../src/schematic/index.ts';
import { applyFix } from '../../src/spice/traps.ts';

const DIVIDER = '* divider\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n';

/** Applies an edit and checks what every edit must do; returns the result and the rebuilt schematic. */
function edit(s: Schematic, op: EditOp, drawingInText = true): { r: EditResult; next: Schematic } {
  const r = applyEdit(s, op, { drawingInText });
  expect(r.ok, r.reason).toBe(true);
  // The changes apply like a check's fix, sorted and apart.
  expect(applyFix(s.netlist.text, { label: 'edit', changes: r.changes })).toBe(r.text);
  for (let i = 1; i < r.changes.length; i++) expect(r.changes[i]!.from).toBeGreaterThan(r.changes[i - 1]!.to);
  const next = drawingInText ? buildSchematic(r.text) : buildSchematic(r.text, { lines: linesOf(r.lines) });
  expect(schematicConnectivity(next).filter((p) => p.kind !== 'hidden')).toEqual([]);
  expect(next.problems).toEqual([]);
  expect(next.drawing).toEqual(r.drawing);
  namedOnce(next);
  return { r, next };
}

/** Every node is named once on each piece of its copper; ground by its symbols, never by a "0" label beside one. */
function namedOnce(s: Schematic): void {
  const pins = drawnPins(s.circuit, s.drawing);
  const islands = findIslands(s.drawing.wires, pins.map((p) => p.at));
  const grounded = new Set(pins.flatMap((p, i) => (p.ground !== undefined ? [islands.anchors[i]!] : [])));
  const seen = new Set<string>();
  for (const l of s.drawing.labels) {
    const island = islands.at(l.at);
    expect(island, `label ${l.node} off the copper`).toBeDefined();
    const key = `${l.node}@${island}`;
    expect(seen.has(key), `${l.node} named twice on one wire`).toBe(false);
    seen.add(key);
    if (l.node === '0') expect(grounded.has(island!), 'a 0 label beside a ground symbol').toBe(false);
  }
  for (const node of s.circuit.nodes.values()) if (!node.ground) expect(s.drawing.labels.some((l) => l.node === node.name), `${node.name} has no label`).toBe(true);
}

const linesOf = (block: readonly string[]) => parseDrawingLines(block.map((text, i) => ({ text, line: i + 1 })));

/** The netlist's part and dot lines (the drawing lines removed). */
const circuitText = (text: string): string => stripDrawing(text);

describe('values and controls', () => {
  it('changes only the value word, keeping tabs, spacing and comments', () => {
    const text = '* t\nV1   in 0\t6 ; the source\nR1\tin  out   1k $ top\nR2 out 0 2k\n.op\n.end\n';
    const s = buildSchematic(text);
    const { r } = edit(s, { kind: 'set-value', part: 'r1', value: '3.3k' });
    expect(circuitText(r.text)).toBe(text.replace('1k $', '3.3k $'));
    expect(r.summary).toBe('R1 is now 3.3k.');
    expect(r.select).toEqual({ part: 'r1' });
  });

  it('adds a value where the line has none, and refuses one on two lines', () => {
    const s = buildSchematic('* t\nV1 in 0\nR1 in 0 1k\n.op\n.end\n');
    expect(circuitText(edit(s, { kind: 'set-value', part: 'V1', value: '5' }).r.text)).toContain('V1 in 0 5\n');
    expect(applyEdit(s, { kind: 'set-value', part: 'V1', value: '5\n6' }).ok).toBe(false);
    expect(applyEdit(s, { kind: 'set-value', part: 'R9', value: '5' }).reason).toBe('There is no part R9 in the drawing.');
  });

  it('changes what a dependent source reads', () => {
    const s = buildSchematic('* t\nV1 c 0 1\nVs c d 0\nRd d 0 1\nE1 o 0 c 0 2\nRo o 0 1\nF1 0 p Vs 2\nRp p 0 1\n.op\n.end\n');
    expect(circuitText(edit(s, { kind: 'set-control', part: 'E1', plus: 'd' }).r.text)).toContain('E1 o 0 d 0 2\n');
    expect(circuitText(edit(s, { kind: 'set-control', part: 'F1', source: 'V1' }).r.text)).toContain('F1 0 p V1 2\n');
    expect(applyEdit(s, { kind: 'set-control', part: 'Rd', plus: 'x' }).ok).toBe(false);
  });
});

describe('adding parts and ground', () => {
  it('names a new part R3, gives it 1k, and puts its line before the analysis lines', () => {
    const s = buildSchematic(DIVIDER);
    const { r, next } = edit(s, { kind: 'add-part', letter: 'R', at: { x: 30, y: 3 } });
    expect(circuitText(r.text)).toBe('* divider\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\nR3 n1 n2 1k\n.op\n.end\n');
    expect(r.summary).toBe('R3 added between node n1 and node n2.');
    expect(placedPart(next, 'R3')!.at).toEqual({ x: 30, y: 3 });
    // Its pins touch nothing: two open terminals.
    expect(next.scene.terminals.map((t) => t.node).sort()).toEqual(['n1', 'n2']);
  });

  it('joins the nodes its pins touch: a pin on R1\'s pin and a pin on the ground wire', () => {
    const s = buildSchematic(DIVIDER);
    // R1's left pin is at (2, 0) and the ground wire runs along y = 6.
    expect(placedPart(s, 'R1')!.pins[0]!.at).toEqual({ x: 2, y: 0 });
    const { r } = edit(s, { kind: 'add-part', letter: 'C', at: { x: 2, y: 2 } });
    expect(circuitText(r.text)).toContain('C1 in n1 1u\n');
    const { r: r2 } = edit(s, { kind: 'add-part', letter: 'R', at: { x: 3, y: 8 } });
    expect(circuitText(r2.text)).toContain('R3 0 n1 1k\n');
  });

  it('gives a dependent source a control to start from, and every letter its default value', () => {
    const s = buildSchematic(DIVIDER);
    expect(circuitText(edit(s, { kind: 'add-part', letter: 'E', at: { x: 30, y: 3 } }).r.text)).toContain('E1 n1 n2 in 0 2\n');
    expect(circuitText(edit(s, { kind: 'add-part', letter: 'H', at: { x: 30, y: 3 } }).r.text)).toContain('H1 n1 n2 V1 1k\n');
    for (const [letter, value] of Object.entries(DEFAULT_VALUES)) {
      const r = applyEdit(s, { kind: 'add-part', letter: letter as 'R', at: { x: 40, y: 3 } });
      expect(r.ok).toBe(true);
      expect(circuitText(r.text).split('\n').find((l) => l.startsWith(`${letter}`) && l.includes(' n1 n2'))!.endsWith(` ${value}`)).toBe(true);
    }
  });

  it('refuses a place taken by another symbol or crossed by a wire', () => {
    const s = buildSchematic(DIVIDER);
    expect(applyEdit(s, { kind: 'add-part', letter: 'R', at: { x: 7, y: 3 } }).reason).toBe('That place is taken by R2.');
    expect(applyEdit(s, { kind: 'add-part', letter: 'R', at: { x: 4, y: 6 }, rot: 90 }).reason).toBe(
      "A wire runs there, and nothing can lie across a wire. To put a part in its place, select that piece of wire and delete it, then wire the part's ends.",
    );
  });

  it('puts a line before .end when there is no analysis, and at the end when there is no .end', () => {
    const s1 = buildSchematic('* t\nR1 a 0 1\n.end\n');
    expect(circuitText(edit(s1, { kind: 'add-part', letter: 'R', at: { x: 30, y: 3 } }).r.text)).toBe('* t\nR1 a 0 1\nR2 n1 n2 1k\n.end\n');
    const s2 = buildSchematic('* t\nR1 a 0 1');
    expect(circuitText(edit(s2, { kind: 'add-part', letter: 'R', at: { x: 30, y: 3 } }).r.text)).toBe('* t\nR1 a 0 1\nR2 n1 n2 1k\n');
  });

  it('makes the node a new ground symbol touches into ground', () => {
    const s = buildSchematic(DIVIDER);
    const { r } = edit(s, { kind: 'add-ground', at: { x: 7, y: 0 }, rot: 180 });
    expect(circuitText(r.text)).toBe('* divider\nV1 in 0 6\nR1 in 0 1k\nR2 0 0 2k\n.op\n.end\n');
    expect(r.summary).toBe('Ground symbol added. Node out is now ground (node 0).');
  });
});

describe('moving, turning, mirroring', () => {
  it('never changes the netlist, and rewires the moved part', () => {
    const s = buildSchematic(DIVIDER);
    for (const op of [
      { kind: 'move-part', part: 'R2', to: { x: 12, y: 3 } },
      { kind: 'rotate-part', part: 'R2' },
      { kind: 'mirror-part', part: 'V1' },
      { kind: 'rotate-part', part: 'V1', rot: 90 },
    ] as EditOp[]) {
      const { r } = edit(s, op);
      expect(circuitText(r.text)).toBe(DIVIDER);
    }
    const { next } = edit(s, { kind: 'move-part', part: 'R2', to: { x: 12, y: 3 } });
    expect(placedPart(next, 'R2')!.at).toEqual({ x: 12, y: 3 });
    const { next: turned } = edit(s, { kind: 'rotate-part', part: 'R2' });
    expect(placedPart(turned, 'R2')!.rot).toBe(90);
    const { next: mirrored } = edit(s, { kind: 'mirror-part', part: 'V1' });
    expect(placedPart(mirrored, 'V1')!.mirror).toBe(false);
    expect(placedPart(mirrored, 'V1')!.side).toBe('right');
  });

  it('refuses to put a pin on another node or the symbol on another symbol', () => {
    const s = buildSchematic(DIVIDER);
    expect(applyEdit(s, { kind: 'move-part', part: 'R2', to: { x: 0, y: 3 } }).reason).toBe('That place is taken by V1.');
    // R2's top pin (out) on the in wire.
    expect(applyEdit(s, { kind: 'move-part', part: 'R2', to: { x: 1, y: 2 } }).ok).toBe(false);
  });

  it('moves a ground symbol along its wire, and refuses one onto another node', () => {
    const s = buildSchematic(DIVIDER);
    const { next } = edit(s, { kind: 'move-ground', ground: 0, to: { x: 4, y: 6 } });
    expect(next.drawing.grounds).toEqual([{ at: { x: 4, y: 6 }, rot: 0 }]);
    // On the wire of out: the symbol would sit on that wire (a ground symbol's own words: only its pin may touch one).
    expect(applyEdit(s, { kind: 'move-ground', ground: 0, to: { x: 7, y: 0 } }).reason).toBe(EDIT_STRINGS.onWireGround);
    // R2's ground pin landing on the in wire.
    expect(applyEdit(s, { kind: 'move-part', part: 'R2', to: { x: 1, y: -2 } }).reason).toBe('A pin would touch another node, in.');
    // I1's pin on n2 landing on the ground wire between V1 and R2 (which stays when I1 leaves).
    const p = buildSchematic('* t\nV1 n1 0 6\nR1 n1 n2 2\nR2 n2 0 4\nI1 0 n2 3\n.op\n.end\n');
    const railY = p.drawing.grounds[0]!.at.y;
    const x = Math.round((placedPart(p, 'V1')!.at.x + placedPart(p, 'R2')!.at.x) / 2);
    expect(applyEdit(p, { kind: 'move-part', part: 'I1', to: { x, y: railY + 2 } }).reason).toBe('A pin would touch another node, ground.');
  });
});

describe('deleting', () => {
  it('removes a part line with its continuation lines, leaving comments, and says which nodes went', () => {
    const text = '* t\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\nR3 out x\n* the value:\n+ 3k\n.op\n.end\n';
    const s = buildSchematic(text);
    const { r } = edit(s, { kind: 'delete-part', part: 'R3' });
    expect(circuitText(r.text)).toBe('* t\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n* the value:\n.op\n.end\n');
    expect(r.summary).toBe('R3 deleted. No part connects to node x any more.');
  });

  it('deletes a wire and splits its node: the piece without the label gets a new name', () => {
    const s = buildSchematic(DIVIDER);
    const index = s.drawing.wires.findIndex((w) => w.some((p) => p.x === 7 && p.y === 1));
    const { r } = edit(s, { kind: 'delete-wire', wire: index });
    expect(circuitText(r.text)).toBe('* divider\nV1 in 0 6\nR1 in out 1k\nR2 n1 0 2k\n.op\n.end\n');
    expect(r.summary).toBe('Wire deleted. R2 no longer connects to node out: that end is now on a node of its own, n1.');
  });

  it('deletes the ground symbol: its piece is no longer ground', () => {
    const s = buildSchematic(DIVIDER);
    const { r } = edit(s, { kind: 'delete-ground', ground: 0 });
    expect(circuitText(r.text)).toBe('* divider\nV1 in n1 6\nR1 in out 1k\nR2 out n1 2k\n.op\n.end\n');
  });
});

describe('wires and node names', () => {
  it('joins two nodes with a wire: ground wins', () => {
    const s0 = buildSchematic(DIVIDER);
    const { next: s } = edit(s0, { kind: 'add-part', letter: 'R', at: { x: 30, y: 3 } });
    const { r } = edit(s, { kind: 'add-wire', from: { part: 'R3', pin: 1 }, to: { ground: 0 } });
    expect(circuitText(r.text)).toContain('R3 n1 0 1k\n');
    expect(r.summary).toBe('Wire added. Node n2 and ground are now one node, ground.');
  });

  it('keeps the name a dot command uses, else the first one', () => {
    const text = '* t\nV1 a 0 1\nR1 a b 1\nR2 c 0 1\nR3 c 0 1\n.tf v(c) V1\n.end\n';
    const s = buildSchematic(text);
    const { r } = edit(s, { kind: 'add-wire', from: { part: 'R1', pin: 1 }, to: { part: 'R2', pin: 0 } });
    expect(circuitText(r.text)).toBe('* t\nV1 a 0 1\nR1 a c 1\nR2 c 0 1\nR3 c 0 1\n.tf v(c) V1\n.end\n');
    const plain = buildSchematic('* t\nV1 a 0 1\nR1 a b 1\nR2 c 0 1\n.op\n.end\n');
    const { r: r2 } = edit(plain, { kind: 'add-wire', from: { part: 'R1', pin: 1 }, to: { part: 'R2', pin: 0 } });
    expect(circuitText(r2.text)).toContain('R2 b 0 1\n');
  });

  it('draws a wire along given points, and refuses a slanted one or one with a free end', () => {
    const s = buildSchematic('* t\nV1 a 0 1\nR1 a b 1\nR2 c 0 1\n.op\n.end\n');
    const b = placedPart(s, 'R1')!.pins[1]!.at;
    const c = placedPart(s, 'R2')!.pins[0]!.at;
    expect(applyEdit(s, { kind: 'add-wire', from: { part: 'R1', pin: 1 }, to: { part: 'R2', pin: 0 }, via: [{ x: b.x + 1, y: c.y + 3 }] }).reason).toBe(
      'A wire runs only across and up or down.',
    );
    expect(applyEdit(s, { kind: 'add-wire', from: { part: 'R1', pin: 1 }, to: { at: { x: 90, y: 90 } } }).reason).toBe('A wire needs a pin or a wire at each end.');
  });

  it('renames a node everywhere, dot commands included', () => {
    const s = buildSchematic('* t\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.tf v(out) V1\n.end\n');
    const { r } = edit(s, { kind: 'rename-node', node: 'out', name: 'vout' });
    expect(circuitText(r.text)).toBe('* t\nV1 in 0 6\nR1 in vout 1k\nR2 vout 0 2k\n.tf v(vout) V1\n.end\n');
    expect(r.summary).toBe('Node out renamed to vout.');
  });

  it('joins two nodes by name when the new name exists, writing it on each piece', () => {
    const s = buildSchematic('* t\nV1 a 0 1\nR1 a 0 1\nV2 b 0 2\nR2 b 0 1\n.op\n.end\n');
    const { r, next } = edit(s, { kind: 'rename-node', node: 'b', name: 'a' });
    expect(circuitText(r.text)).toBe('* t\nV1 a 0 1\nR1 a 0 1\nV2 a 0 2\nR2 a 0 1\n.op\n.end\n');
    expect(next.drawing.labels.filter((l) => l.node === 'a').length).toBe(2);
    expect(r.summary).toBe('Node b renamed to a. A node called a was already there, so the two are now one node, a.');
  });

  it('refuses a name PlainSpice does not write, and renaming ground', () => {
    const s = buildSchematic(DIVIDER);
    expect(applyEdit(s, { kind: 'rename-node', node: 'out', name: 'v out' }).reason).toBe('PlainSpice keeps node names to letters, digits and _ (32 at most), so it can\'t use "v out".');
    expect(applyEdit(s, { kind: 'rename-node', node: '0', name: 'gnd2' }).reason).toBe('Ground (node 0) keeps its name: in SPICE, the name 0 is what makes a node ground, the node every voltage is measured from.');
  });

  it('moves a label along its node, and refuses one onto another node', () => {
    const s = buildSchematic(DIVIDER);
    const { next } = edit(s, { kind: 'move-label', node: 'out', to: { x: 7, y: 1 } });
    expect(next.drawing.labels.find((l) => l.node === 'out')!.at).toEqual({ x: 7, y: 1 });
    expect(applyEdit(s, { kind: 'move-label', node: 'out', to: { x: 1, y: 0 } }).ok).toBe(false);
  });
});

describe('positions kept outside the netlist', () => {
  it('changes only part lines and hands back the drawing lines', () => {
    const s = buildSchematic(DIVIDER);
    const { r } = edit(s, { kind: 'add-part', letter: 'R', at: { x: 30, y: 3 } }, false);
    expect(r.text).toBe('* divider\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\nR3 n1 n2 1k\n.op\n.end\n');
    expect(r.lines[0]).toBe('* plainspice-drawing v1');
    expect(r.lines).toContain('*@ R3 30 3 0');
  });
});

describe('text changes', () => {
  it('merges touching changes so an editor can apply them at once', () => {
    const text = 'abcdef';
    const merged = mergeChanges(text, [
      { from: 3, to: 3, insert: 'X' },
      { from: 1, to: 2, insert: 'B' },
      { from: 3, to: 4, insert: 'D' },
      { from: 5, to: 5, insert: '' },
    ]);
    expect(merged).toEqual([
      { from: 1, to: 2, insert: 'B' },
      { from: 3, to: 4, insert: 'XD' },
    ]);
    expect(applyChanges(text, merged)).toBe('aBcXDef');
  });
});

describe('many edits in a row', () => {
  it('keep the drawing and the netlist in step', () => {
    let s = buildSchematic('* t\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\nC1 out 0 1u\n.tran 1u 1m\n.end\n');
    const ops: EditOp[] = [
      { kind: 'add-part', letter: 'R', at: { x: 30, y: 2 } },
      { kind: 'add-wire', from: { part: 'R3', pin: 0 }, to: { part: 'R2', pin: 0 } },
      { kind: 'add-wire', from: { part: 'R3', pin: 1 }, to: { ground: 0 } },
      { kind: 'move-part', part: 'R3', to: { x: 30, y: 8 } },
      { kind: 'rotate-part', part: 'C1' },
      { kind: 'rename-node', node: 'out', name: 'vout' },
      { kind: 'set-value', part: 'R3', value: '470' },
      { kind: 'add-part', letter: 'L', at: { x: -12, y: 3 } },
      { kind: 'delete-part', part: 'C1' },
    ];
    for (const op of ops) s = edit(s, op).next;
    expect(circuitText(s.netlist.text)).toBe('* t\nV1 in 0 6\nR1 in vout 1k\nR2 vout 0 2k\nR3 vout 0 470\nL1 n1 n2 1m\n.tran 1u 1m\n.end\n');
  });
});

describe('an empty netlist', () => {
  it('gets a title line before the first part, since SPICE skips line 1', () => {
    const { r, next } = edit(buildSchematic(''), { kind: 'add-part', letter: 'R', at: { x: 0, y: 0 } });
    expect(r.text.split('\n')[0]).toBe('* circuit');
    expect(circuitText(r.text)).toBe('* circuit\nR1 n1 n2 1k\n');
    expect(next.circuit.parts.map((p) => p.name)).toEqual(['R1']);
    expect(next.netlist.lines[0]!.kind).toBe('title');
  });

  it('never writes the drawing block on line 1', () => {
    const { r } = edit(buildSchematic(''), { kind: 'add-ground', at: { x: 0, y: 0 } });
    expect(r.text.startsWith('* circuit\n* plainspice-drawing v1\n')).toBe(true);
  });
});

describe('lines that still name what an edit removed', () => {
  const P3 = '* p01-3\nV1 n1 0 20\nR2 n2 0 12\nR3 n3 0 2\nRp n2 n3 5\nVsense n1 nx 0\nR1 nx n2 4\nH1 n2 n3 Vsense 5\n.op\n.tf v(n3) Vsense\n.control\nrun\nprint i(vsense) v(n3)\n.endc\n.end\n';

  it('says which lines still name a deleted part, and selects the first', () => {
    const { r } = edit(buildSchematic(P3), { kind: 'delete-part', part: 'Vsense' });
    // Numbered in the text after the delete: Vsense's line 6 is gone, so each line below it is one up.
    expect(r.summary).toBe('Vsense deleted. H1 (line 7), .tf (line 9) and .control (line 12) still name Vsense.');
    expect(r.text.split('\n')[7 - 1]).toBe('H1 n2 n3 Vsense 5');
    expect(r.text.split('\n')[9 - 1]).toBe('.tf v(n3) Vsense');
    expect(r.text.split('\n')[12 - 1]).toBe('print i(vsense) v(n3)');
    expect(r.select).toEqual({ part: 'h1' });
    // The student's lines stay as written: they decide what to change.
    expect(circuitText(r.text)).toContain('H1 n2 n3 Vsense 5\n');
    expect(circuitText(r.text)).toContain('.tf v(n3) Vsense\n');
  });

  it('says which lines still name a node that no part connects to any more', () => {
    const s = buildSchematic('* E controls\nV1 a 0 1\nR1 a c 1\nE1 o 0 c 0 2\nRo o 0 1\n.op\n.tf v(c) V1\n.end\n');
    const { r } = edit(s, { kind: 'delete-part', part: 'R1' });
    expect(r.summary).toBe('R1 deleted. No part connects to node c any more. E1 (line 3) and .tf (line 6) still name node c.');
    expect(r.select).toEqual({ part: 'e1' });
    const t = edit(buildSchematic('* t\nV1 a 0 1\nR1 a b 1\n.op\n.print dc v(b)\n.end\n'), { kind: 'delete-part', part: 'R1' }).r;
    expect(t.select).toEqual({ line: 4 });
    expect(t.text.split('\n')[4 - 1]).toBe('.print dc v(b)');
    // A source named on a dot command's continuation line counts too.
    const c = edit(buildSchematic('* t\nV1 a 0 1\nR1 a 0 1\n.tf v(a)\n+ V1\n.end\n'), { kind: 'delete-part', part: 'V1' }).r;
    expect(c.summary).toBe('V1 deleted. .tf (line 3) still names V1.');
  });

  it('renames a node in .control lines too', () => {
    const text = '* t\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n.control\nrun\nprint v(out)\nplot v(in, out) v( out )\n.endc\n.end\n';
    const { r } = edit(buildSchematic(text), { kind: 'rename-node', node: 'out', name: 'vout' });
    expect(circuitText(r.text)).toBe(text.replace(/\bout\b/g, 'vout'));
  });

  it('keeps the name a .control line uses when two nodes become one', () => {
    const s = buildSchematic('* t\nV1 a 0 1\nR1 a b 1\nR2 c 0 1\n.op\n.control\nprint v(c)\n.endc\n.end\n');
    const { r } = edit(s, { kind: 'add-wire', from: { part: 'R1', pin: 1 }, to: { part: 'R2', pin: 0 } });
    expect(circuitText(r.text)).toContain('R1 a c 1\n');
  });
});

describe('wiring writes each name once', () => {
  it('drops the old name where the joined copper is already named, and never writes 0 beside ground', () => {
    const s0 = buildSchematic(DIVIDER);
    const { next: s1 } = edit(s0, { kind: 'add-part', letter: 'R', at: { x: 11, y: 3 } });
    const { next: s2 } = edit(s1, { kind: 'add-wire', from: { part: 'R3', pin: 0 }, to: { part: 'R2', pin: 0 } });
    expect(s2.drawing.labels.filter((l) => l.node === 'out')).toHaveLength(1);
    const { next: s3 } = edit(s2, { kind: 'add-wire', from: { part: 'R3', pin: 1 }, to: { part: 'R2', pin: 1 } });
    expect(s3.drawing.labels.map((l) => l.node).sort()).toEqual(['in', 'out']);
  });
});

describe('turning round and reversing', () => {
  it('refuses to turn a wired part round where it stands, pointing to Reverse', () => {
    const s = buildSchematic(DIVIDER);
    expect(applyEdit(s, { kind: 'rotate-part', part: 'V1', rot: 180 }).reason).toBe(
      'A half turn of V1 where it stands would loop its wires round it. To swap its two ends, use Reverse once V1 is back in place.',
    );
    expect(applyEdit(s, { kind: 'rotate-part', part: 'V1', rot: 0 }).reason).toBe('V1 is already turned that way.');
  });

  it('reverses a part: its two node names swap in the text, its symbol turns round, its wires stay', () => {
    const s = buildSchematic(DIVIDER);
    const { r, next } = edit(s, { kind: 'reverse-part', part: 'V1' });
    expect(circuitText(r.text)).toBe(DIVIDER.replace('V1 in 0 6', 'V1 0 in 6'));
    expect(r.summary.replace(/[\u00a0\u202f]/g, ' ')).toBe('V1 reversed. V1: a 6 V source with its + side at ground and its − side at node in.');
    expect(next.drawing.wires).toEqual(s.drawing.wires);
    expect(next.drawing.parts.get('v1')!.rot).toBe(180);
    const plus = placedPart(next, 'V1')!.marks.find((m) => m.text === '+')!;
    expect(plus.at.y).toBeGreaterThan(placedPart(next, 'V1')!.at.y);
  });

  it('refuses a move whose wires would find no way (pieces joined only by name), and hands back the notes otherwise', () => {
    const s = buildSchematic(DIVIDER);
    expect(applyEdit(s, { kind: 'move-part', part: 'R2', to: { x: 1900, y: 1900 } }).reason).toBe("R2's wires would find no way there. Try a place with more room.");
    const r = applyEdit(s, { kind: 'move-part', part: 'R2', to: { x: 14, y: 8 } });
    expect(r.ok).toBe(true);
    expect(r.notes.map((n) => n.kind)).toEqual(['wires-redrawn']);
  });

  it('refuses places off the grid and turns that are not quarter turns', () => {
    const s = buildSchematic(DIVIDER);
    expect(applyEdit(s, { kind: 'add-part', letter: 'R', at: { x: 0.5, y: 3 } }).reason).toContain('off the grid');
    expect(applyEdit(s, { kind: 'move-part', part: 'R2', to: { x: 3000, y: 3 } }).reason).toContain('off the grid');
    expect(applyEdit(s, { kind: 'rotate-part', part: 'R2', rot: 45 as 90 }).reason).toBe('A part turns in quarter turns: 0, 90, 180 or 270.');
  });

  it('refuses an F or H when there is no source for it to read', () => {
    const s = buildSchematic('* t\nI1 0 a 1\nR1 a 0 1\n.op\n.end\n');
    expect(applyEdit(s, { kind: 'add-part', letter: 'H', at: { x: 30, y: 3 } }).reason).toBe(
      'A current-controlled voltage source (H) reads the current through a voltage source, and this circuit has none yet: add a voltage source first.',
    );
  });
});

describe('a drawing saved by another version', () => {
  const text = DIVIDER.replace('.end', '* plainspice-drawing v2\n*@ V1 0 3 0 m\n*@ R2 20 3 0 style=new\n.end');

  it('refuses changes to the drawing, and keeps its lines exactly as written', () => {
    const s = buildSchematic(text);
    expect(s.foreign.map((f) => f.text)).toEqual(['* plainspice-drawing v2', '*@ V1 0 3 0 m', '*@ R2 20 3 0 style=new']);
    const r = applyEdit(s, { kind: 'move-part', part: 'R2', to: { x: 12, y: 3 } });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('another version of PlainSpice (plainspice-drawing v2)');
    expect(r.lines).toEqual(s.foreign.map((f) => f.text));
  });

  it('still changes values, names and parts, leaving the other version\'s lines alone', () => {
    const s = buildSchematic(text);
    const r = applyEdit(s, { kind: 'set-value', part: 'R2', value: '3k' });
    expect(r.ok).toBe(true);
    expect(r.text).toBe(text.replace('R2 out 0 2k', 'R2 out 0 3k'));
    const d = applyEdit(s, { kind: 'delete-part', part: 'R2' });
    expect(d.text).toBe(text.replace('R2 out 0 2k\n', ''));
  });
});

describe('lines of parts the netlist no longer has', () => {
  it('are dropped by the next change made in the drawing, with a note', () => {
    const drawn = applyEdit(buildSchematic(DIVIDER), { kind: 'move-part', part: 'R2', to: { x: 8, y: 3 } }).text;
    const typed = drawn.replace('R2 out 0 2k\n', '');
    const s = buildSchematic(typed);
    expect(s.orphans).toEqual(['*@ R2 8 3 0']);
    const { r } = edit(s, { kind: 'move-part', part: 'R1', to: { x: 4, y: -1 } });
    expect(r.text).not.toContain('*@ R2 ');
    expect(r.notes.map((n) => n.message)).toContain('The drawing lines of R2, which the netlist no longer has, were removed.');
  });
});

describe('where the words go', () => {
  it('stores a side for a part\'s words and a spot for a node\'s name, and can go back to automatic', () => {
    const s = buildSchematic(DIVIDER);
    const { r, next } = edit(s, { kind: 'set-side', part: 'R1', side: 'below' });
    expect(r.lines).toContain('*@ R1 4 0 270 side=below');
    expect(placedPart(next, 'R1')!.side).toBe('below');
    const { r: back } = edit(next, { kind: 'set-side', part: 'R1', side: 'auto' });
    expect(back.lines).toContain('*@ R1 4 0 270');
    const { r: l, next: n2 } = edit(s, { kind: 'move-label', node: 'out', side: 'above-left' });
    expect(l.lines).toContain('*@ label out 7 0 side=above-left');
    expect(n2.scene.nodeLabels.find((x) => x.node === 'out')!.spot).toBe('above-left');
    expect(applyEdit(s, { kind: 'set-side', part: 'R1', side: 'middle' as 'left' }).reason).toBe(EDIT_STRINGS.badSide);
  });
});

describe('never throws', () => {
  it('answers every operation on every example with a result', () => {
    const ops = (s: Schematic): EditOp[] => [
      { kind: 'add-part', letter: 'C', at: { x: 3, y: 3 } },
      { kind: 'move-part', part: s.circuit.parts[0]?.name ?? 'X', to: { x: -7, y: 2 } },
      { kind: 'rotate-part', part: s.circuit.parts[1]?.name ?? 'X' },
      { kind: 'reverse-part', part: s.circuit.parts[2]?.name ?? 'X' },
      { kind: 'delete-part', part: s.circuit.parts[0]?.name ?? 'X' },
      { kind: 'add-wire', from: { part: s.circuit.parts[0]?.name ?? 'X', pin: 1 }, to: { ground: 0 } },
      { kind: 'delete-wire', wire: 0 },
      { kind: 'rename-node', node: [...s.circuit.nodes.keys()].find((n) => n !== '0') ?? 'x', name: 'renamed' },
      { kind: 'delete-ground', ground: 0 },
      { kind: 'set-value', part: s.circuit.parts[0]?.name ?? 'X', value: '7' },
    ];
    for (const text of [DIVIDER, '', '* t\nE1\n', '* p\nV1 a 0 PULSE(0 1)\nR1 a a 1\nR2 0 0 1\n.end\n', '* t\nV1 a 0 1\nR1 a 0 1\n*@ R1 999999 0 0\n*@ wire 0,0\n']) {
      const s = buildSchematic(text);
      for (const op of ops(s)) expect(() => applyEdit(s, op)).not.toThrow();
    }
  });
});

describe('the words of the re-check of step B (each says what the netlist now has)', () => {
  it('numbers a line that still names a deleted part in the text after the delete, drawing lines written included (new-1)', () => {
    // The drawing block above .tf grows (wires and names written): .tf was line 9, and is line 13 after.
    const text = '* t\nV1 a 0 1\nR1 a b 1k\nR2 b 0 1k\n* plainspice-drawing v1\n*@ V1 0 3 0\n*@ R1 4 0 270\n*@ R2 8 3 0\n.tf v(b) V1\n.end\n';
    const { r } = edit(buildSchematic(text), { kind: 'delete-part', part: 'V1' });
    const line = r.text.split('\n').indexOf('.tf v(b) V1') + 1;
    expect(line).toBe(13);
    expect(r.summary).toBe('V1 deleted. .tf (line 13) still names V1.');
    expect(r.select).toEqual({ line: 13 });
    // Start here with a .tf line: V1's line 2 goes, so .tf is line 4, not 5.
    const start = edit(buildSchematic('* edit me\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.tf v(out) V1\n.end\n'), { kind: 'delete-part', part: 'V1' }).r;
    expect(start.summary).toBe('V1 deleted. .tf (line 4) still names V1.');
    expect(start.select).toEqual({ line: 4 });
    expect(start.text.split('\n')[4 - 1]).toBe('.tf v(out) V1');
  });

  it('a piece cut off a node names the parts whose ends moved; the last ground symbol gone says the circuit has no ground (new-2)', () => {
    const START = '* Start here\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n';
    const s = buildSchematic(START);
    const { r } = edit(s, { kind: 'delete-ground', ground: 0 });
    expect(circuitText(r.text)).toBe('* Start here\nV1 in n1 6\nR1 in out 1k\nR2 out n1 2k\n.op\n.end\n');
    expect(r.summary).toBe(
      'Ground symbol deleted. No ground symbol is left on ground\'s wires, so V1 and R2 no longer connect to ground: those ends are now on a node of their own, n1, and the circuit has no ground (node 0) until a ground symbol goes back on it.',
    );
    expect(r.summary).not.toMatch(/\bPart of\b/);
    // A piece of ground's wire between the junction and R2's foot: only R2 leaves ground, and ground stays.
    const bottom = s.drawing.wires.findIndex((w) => w.every((p) => p.y >= 5));
    const segment = segmentIndex(s, bottom, (a, b) => a.y === b.y);
    const end = s.drawing.wires[bottom]![segment + 1]!;
    const { r: piece } = edit(s, { kind: 'delete-wire', wire: bottom, segment, piece: { from: { x: end.x - 3, y: end.y }, to: end } });
    expect(piece.summary).toBe('Piece of wire deleted. R2 no longer connects to ground: that end is now on a node of its own, n1.');
    expect(circuitText(piece.text)).toContain('V1 in 0 6\n');
  });

  it('the ground symbol still drawn but cut off from every part: the sentence says no part connects to it, not that none is left (the words critic, new-2)', () => {
    const START = '* Start here\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n';
    const s = buildSchematic(START);
    const symbol = s.drawing.grounds[0]!.at;
    // 1. V1's foot cut off ground: the piece from V1's pin down to the ground symbol.
    const rail = s.drawing.wires.findIndex((w) => w.some((p) => p.x === symbol.x && p.y === symbol.y));
    const foot = segmentIndex(s, rail, (a, b) => a.x === b.x && (samePoint(a, symbol) || samePoint(b, symbol)));
    const { r: first, next: s1 } = edit(s, { kind: 'delete-wire', wire: rail, segment: foot });
    expect(first.summary).toBe('Piece of wire deleted. V1 no longer connects to ground: that end is now on a node of its own, n1.');
    // 2. The rail between the symbol and R2: the symbol stays on the drawing with no part on its wires.
    const rail1 = s1.drawing.wires.findIndex((w) => w.some((p) => samePoint(p, symbol)));
    const along = segmentIndex(s1, rail1, (a, b) => a.y === b.y && a.y === symbol.y);
    const { r: second, next: s2 } = edit(s1, { kind: 'delete-wire', wire: rail1, segment: along });
    expect(s2.drawing.grounds).toEqual([{ at: symbol, rot: 0 }]);
    expect(circuitText(second.text)).toBe('* Start here\nV1 in n1 6\nR1 in out 1k\nR2 out n2 2k\n.op\n.end\n');
    expect(second.summary).toBe(
      'Piece of wire deleted. No part connects to a ground symbol any more, so R2 no longer connects to ground: that end is now on a node of its own, n2, and the circuit has no ground (node 0) until a part connects to a ground symbol again.',
    );
    expect(second.summary).not.toContain('No ground symbol is left');
  });

  it('a ground symbol on a wire says it may touch a wire only with its pin, placed or moved; a part keeps its own words (the words critic, new-7)', () => {
    const s = buildSchematic(DIVIDER);
    const rail = s.drawing.grounds[0]!.at.y;
    expect(EDIT_STRINGS.onWireGround).toBe(
      'A wire runs there, and nothing can lie across a wire. A ground symbol may touch a wire only with its pin: move it until just its pin is on the wire, or until it misses the wire.',
    );
    // One square above ground's wire, the symbol's lines lie across it.
    expect(applyEdit(s, { kind: 'add-ground', at: { x: 4, y: rail - 1 } }).reason).toBe(EDIT_STRINGS.onWireGround);
    expect(applyEdit(s, { kind: 'move-ground', ground: 0, to: { x: 4, y: rail - 1 } }).reason).toBe(EDIT_STRINGS.onWireGround);
    // The two ways it offers: just its pin on the wire, or clear of it.
    expect(applyEdit(s, { kind: 'add-ground', at: { x: 4, y: rail } }).ok).toBe(true);
    expect(applyEdit(s, { kind: 'add-ground', at: { x: 4, y: rail - 2 } }).ok).toBe(true);
    // A part across a wire still says how to put a part in its place.
    expect(applyEdit(s, { kind: 'add-part', letter: 'R', at: { x: 4, y: rail }, rot: 270 }).reason).toBe(EDIT_STRINGS.onWire);
  });

  it('a place refused: a wire there says how to put a part in its place; the ground symbol is named; F and H say what they read (new-7, new-8, new-36)', () => {
    const s = buildSchematic(DIVIDER);
    expect(EDIT_STRINGS.onWire).toMatch(/^A wire runs there, and nothing can lie across a wire\. To put a part in its place, select that piece of wire and delete it, then wire the part's ends\.$/);
    expect(applyEdit(s, { kind: 'add-ground', at: s.drawing.grounds[0]!.at }).reason).toBe('That place is taken by the ground symbol.');
    expect(EDIT_STRINGS.noSource('F')).toBe('A current-controlled current source (F) reads the current through a voltage source, and this circuit has none yet: add a voltage source first.');
  });

  it('a controlled source chosen on its card says what it reads in words, as its Connections do (new-32, fact P6)', () => {
    const s = buildSchematic('* t\nV1 in 0 1\nR1 in out 1k\nR2 out 0 1k\nG1 0 out in 0 1m\nF1 0 out V1 2\n.op\n.end\n');
    expect(edit(s, { kind: 'set-control', part: 'G1', plus: 'out' }).r.summary).toBe('G1 now reads the voltage between node out and ground.');
    expect(edit(s, { kind: 'set-control', part: 'F1', source: 'V1' }).r.summary).toBe('F1 now reads the current through V1.');
  });

  it('Reverse on a part whose line ends with gnd says it in one sense of "end" (new-38, facts W8, W9)', () => {
    const s = buildSchematic('* t\nV1 in 0 6\nR1 in mid 1k\nVam mid gnd\n.op\n.end\n');
    expect(applyEdit(s, { kind: 'reverse-part', part: 'Vam' }).reason).toBe(
      "Vam's line ends with the word gnd, and as the last word of a line gnd is an ordinary node to ngspice, not ground. Reversed, gnd would no longer be last and would become ground, which changes the circuit. Rename gnd first: the Checks panel says why and offers “Rename gnd to 0”.",
    );
  });
});

/** True when two grid points are the same. */
function samePoint(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

/** The index of the first segment of a wire that `test` accepts. */
function segmentIndex(s: Schematic, wire: number, test: (a: { x: number; y: number }, b: { x: number; y: number }) => boolean): number {
  const w = s.drawing.wires[wire]!;
  for (let i = 0; i + 1 < w.length; i++) if (test(w[i]!, w[i + 1]!)) return i;
  return -1;
}
