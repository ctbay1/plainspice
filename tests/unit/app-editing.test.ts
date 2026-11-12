/**
 * src/app/editing.ts: the schematic editor's interaction layer (decision 0017). What the pointer and
 * the keys mean on the drawing (hit testing in grid units, the editing keys), what is shown while an
 * edit is chosen (where a part in hand lands and which nodes it joins, why a place is refused, the
 * way a wire goes, a part dragged), the first part on a blank page writing .op and .end, the card's
 * Connections, and the Add a part form. Every edit is the model's (applyEdit); these tests check
 * the intents turn into the right edits and the right words.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addPartEdit,
  connectEdit,
  controlWords,
  copperPoints,
  deleteOp,
  disconnectEdit,
  dragTarget,
  editKey,
  endRoles,
  endsOf,
  formLine,
  formStart,
  formValue,
  grabAt,
  grabOf,
  handFor,
  hitTest,
  joinsWords,
  mirrorHand,
  movePreview,
  moveOp,
  needsStarter,
  nodeAt,
  nodeChoices,
  nodeEnd,
  placeEdit,
  pieceAt,
  placePreview,
  refusedAnywhere,
  reverseHand,
  sourceChoices,
  stepFrom,
  symbolEnd,
  turnHand,
  wireEdit,
  wirePreview,
  wireStartOf,
  wireTargets,
  withStarter,
  type PartForm,
} from '../../src/app/editing.ts';
import { readNetlist } from '../../src/app/model.ts';
import { t } from '../../src/i18n/index.ts';
import { NOTEBOOK_OPTIONS } from '../../src/notebook/schematic.ts';
import { EDIT_STRINGS, applyEdit, buildSchematic, schematicConnectivity, stripDrawing, type Schematic } from '../../src/schematic/index.ts';
import { parseNetlist } from '../../src/spice/parse.ts';

const START = readFileSync(resolve(import.meta.dirname, '../../examples/start-here.cir'), 'utf8');
const build = (text: string): Schematic => buildSchematic(text, NOTEBOOK_OPTIONS);
/** A schematic whose text is the result of an edit (and checks the drawing still connects what the netlist does). */
function after(text: string): Schematic {
  const s = build(text);
  expect(schematicConnectivity(s).filter((p) => p.kind !== 'hidden')).toEqual([]);
  return s;
}
const traps = (text: string): string[] => readNetlist(text).traps.map((t) => t.id);

// Start here as laid out: V1 at (0,3) upright (pins (0,1) and (0,5)), R1 at (4,0) across (pins (2,0)
// and (6,0)), R2 at (8,3) upright (pins (8,1) and (8,5)), ground at (0,6); wires along the top and
// the bottom (y = 6).
const s0 = build(START);

describe('hit testing in grid units', () => {
  it('finds pins first with the Wire tool, then node names, then wires (the grid point on the wire)', () => {
    expect(hitTest(s0, { x: 2.2, y: 0.1 }, 0.45, 'wire')).toEqual({ kind: 'pin', part: 'r1', pin: 0, at: { x: 2, y: 0 }, node: 'in' });
    expect(hitTest(s0, { x: 8, y: 4.9 }, 0.45, 'wire')).toMatchObject({ kind: 'pin', part: 'r2', pin: 1, node: '0' });
    expect(hitTest(s0, { x: 0, y: 6 }, 0.45, 'wire')).toMatchObject({ kind: 'ground-pin', ground: 0 });
    const onWire = hitTest(s0, { x: 4.4, y: 6.2 }, 0.45, 'wire');
    expect(onWire).toMatchObject({ kind: 'wire', at: { x: 4, y: 6 }, node: '0' });
    // Empty paper.
    expect(hitTest(s0, { x: 4, y: 3 }, 0.45, 'wire')).toBeUndefined();
  });

  it('takes a click anywhere on a node’s name with the Wire tool, the value written after it too: the node’s button covers both', () => {
    const out = s0.scene.nodeLabels.find((l) => l.node === 'out')!;
    const value = out.lines.find((l) => l.role === 'result')!.box;
    const p = { x: (value.x0 + value.x1) / 2, y: (value.y0 + value.y1) / 2 };
    expect(hitTest(s0, p, 0.45, 'wire')).toEqual({ kind: 'label', node: 'out', at: out.at });
    // With Select, only the name's own words: a click elsewhere on the label is its button's.
    expect(hitTest(s0, p, 0.45, 'select')).toBeUndefined();
  });

  it('finds a part (its symbol or its words), a ground symbol, a node name or a wire with Select', () => {
    expect(hitTest(s0, { x: 4, y: 0.1 }, 0.45, 'select')).toEqual({ kind: 'part', key: 'r1' });
    const words = s0.scene.parts.find((p) => p.key === 'r2')!.labelBox;
    expect(hitTest(s0, { x: (words.x0 + words.x1) / 2, y: (words.y0 + words.y1) / 2 }, 0.45, 'select')).toEqual({ kind: 'part', key: 'r2' });
    expect(hitTest(s0, { x: 0, y: 6.7 }, 0.45, 'select')).toEqual({ kind: 'ground', ground: 0 });
    const out = s0.scene.nodeLabels.find((l) => l.node === 'out')!.lines.find((l) => l.role === 'node')!.box;
    expect(hitTest(s0, { x: (out.x0 + out.x1) / 2, y: (out.y0 + out.y1) / 2 }, 0.45, 'select')).toMatchObject({ kind: 'label', node: 'out' });
    expect(hitTest(s0, { x: 5, y: 6.1 }, 0.45, 'select')).toMatchObject({ kind: 'wire', node: '0' });
  });

  it('knows the node of the copper at a grid point, and every point of a node', () => {
    expect(nodeAt(s0, { x: 1, y: 0 })).toBe('in');
    expect(nodeAt(s0, { x: 3, y: 6 })).toBe('0');
    expect(nodeAt(s0, { x: 4, y: 3 })).toBeUndefined();
    expect(nodeAt(s0, { x: 1.5, y: 0 })).toBeUndefined();
    const out = copperPoints(s0, 'out').map((p) => `${p.x},${p.y}`);
    expect(out).toEqual(expect.arrayContaining(['6,0', '7,0', '8,0', '8,1']));
    expect(out).not.toContain('2,0');
  });
});

describe('a part in hand', () => {
  it('starts as first drawings have it, and turns, mirrors and reverses before it is placed', () => {
    expect(handFor('R')).toEqual({ kind: 'R', rot: 270, mirror: false });
    expect(handFor('V')).toEqual({ kind: 'V', rot: 0, mirror: false });
    // A current source's arrow points up, as the channel draws it: its from end at the bottom.
    expect(handFor('I')).toEqual({ kind: 'I', rot: 180, mirror: false });
    expect(handFor('G').rot).toBe(180);
    expect(turnHand(handFor('V')).rot).toBe(90);
    expect(mirrorHand(handFor('V')).mirror).toBe(true);
    expect(reverseHand(handFor('V')).rot).toBe(180);
    // A ground symbol looks the same mirrored, and has one pin.
    expect(mirrorHand(handFor('ground'))).toEqual(handFor('ground'));
    expect(reverseHand(handFor('ground'))).toEqual(handFor('ground'));
  });

  it('shows where its pins land and the node each joins; a place the model refuses says why', () => {
    // R across with its left pin on out's wire end at (8,0)... out's corner: it joins out.
    const free = placePreview(s0, handFor('R'), { x: 14, y: 3 });
    expect(free.ok).toBe(true);
    expect(free.pins.map((p) => p.node)).toEqual([undefined, undefined]);
    expect(joinsWords(s0, free)).toBe('its ends are on two new nodes');
    const joins = placePreview(s0, handFor('R'), { x: 10, y: 0 });
    expect(joins.ok).toBe(true);
    expect(joins.pins.map((p) => p.node)).toEqual(['out', undefined]);
    expect(joinsWords(s0, joins)).toBe('its ends connect to node out and a new node');
    const taken = placePreview(s0, handFor('R'), { x: 8, y: 3 });
    expect(taken).toMatchObject({ ok: false, reason: EDIT_STRINGS.taken('R2') });
    // F and H read the current in a V source: none yet, and the model says so.
    const noV = build('* t\nR1 a 0 1k\n.op\n.end\n');
    // Nowhere yet, not only here: the hint says it without "Not here" (new-8).
    expect(placePreview(noV, handFor('F'), { x: 10, y: 3 })).toMatchObject({ ok: false, reason: EDIT_STRINGS.noSource('F'), anywhere: true });
    expect(refusedAnywhere(noV, 'F')).toBe(EDIT_STRINGS.noSource('F'));
    expect(refusedAnywhere(s0, 'F')).toBeUndefined();
    expect(refusedAnywhere(build(''), 'ground')).toBe(t('placeGroundFirst'));
    // A ground symbol on a page with nothing to join yet.
    expect(placePreview(build(''), handFor('ground'), { x: 0, y: 0 })).toMatchObject({ ok: false, reason: 'Place a part first: a ground symbol connects to the node its pin touches, and there is no node yet.', anywhere: true });
    // A ground symbol on a node's pin makes it ground, and says so.
    const g = placePreview(s0, handFor('ground'), { x: 8, y: 1 });
    expect(joinsWords(s0, { ...g, ok: true })).toBe('node out becomes ground (node 0)');
  });
});

describe('a blank page: the first part also writes .op and .end', () => {
  it('knows what an empty netlist lacks (no-analysis, missing-end) and writes it where the editor expects it', () => {
    expect(traps('')).toEqual([]);
    expect(needsStarter(parseNetlist(''))).toBe(true);
    expect(needsStarter(parseNetlist(START))).toBe(false);
    expect(withStarter(parseNetlist(''))).toBe('* circuit\n.op\n.end\n');
    expect(withStarter(parseNetlist('* my circuit\n'))).toBe('* my circuit\n.op\n.end\n');
    expect(withStarter(parseNetlist('* my circuit'))).toBe('* my circuit\n.op\n.end\n');
    expect(withStarter(parseNetlist('* mine\n.end\n'))).toBe('* mine\n.op\n.end\n');
    // A page whose drawing lines are already there (a ground symbol): .op goes before them.
    expect(withStarter(parseNetlist('* mine\n* plainspice-drawing v1\n*@ ground 0 0 0\n'))).toBe('* mine\n.op\n* plainspice-drawing v1\n*@ ground 0 0 0\n.end\n');
    // CRLF stays CRLF.
    expect(withStarter(parseNetlist('* mine\r\n'))).toBe('* mine\r\n.op\r\n.end\r\n');
    expect(withStarter(parseNetlist(START))).toBeUndefined();
  });

  it('places the first part with .op and .end, its line before .op and the drawing lines before .end', () => {
    const r = placeEdit(build(''), handFor('V'), { x: 0, y: 3 });
    expect(r.ok).toBe(true);
    expect(r.summary).toBe(
      'V1 added between node n1 and node n2. PlainSpice also wrote .op, which asks ngspice for the DC voltages and currents (the operating point), so the circuit runs as you build it, and .end, the netlist’s last line (keep new lines above it: ngspice still reads lines after .end).',
    );
    expect(r.text).toBe('* circuit\nV1 n1 n2 5\n.op\n* plainspice-drawing v1\n*@ V1 0 3 0\n*@ label n1 0 1\n*@ label n2 0 5\n.end\n');
    expect(traps(r.text)).not.toContain('no-analysis');
    expect(traps(r.text)).not.toContain('missing-end');
    // The next part goes before .op, above the drawing lines.
    const r2 = placeEdit(after(r.text), handFor('R'), { x: 4, y: 0 });
    expect(r2.text.split('\n').slice(0, 4)).toEqual(['* circuit', 'V1 n1 n2 5', 'R1 n3 n4 1k', '.op']);
    expect(r2.summary).toBe('R1 added between node n3 and node n4.');
    // A ground symbol first is refused (there is nothing to join), with the reason.
    expect(placeEdit(build(''), handFor('ground'), { x: 0, y: 0 })).toMatchObject({ ok: false });
  });
});

describe('moving', () => {
  it('picks up parts, ground symbols and node names, and finds where each is', () => {
    expect(grabOf(s0, { kind: 'part', key: 'r1' })).toEqual({ kind: 'part', key: 'r1' });
    expect(grabOf(s0, { kind: 'node', name: '0' })).toEqual({ kind: 'ground', ground: 0 });
    expect(grabOf(s0, { kind: 'node', name: 'out' })).toEqual({ kind: 'label', node: 'out' });
    expect(grabAt(s0, { kind: 'part', key: 'r2' })).toEqual({ x: 8, y: 3 });
    expect(grabAt(s0, { kind: 'ground', ground: 0 })).toEqual({ x: 0, y: 6 });
    expect(stepFrom(s0, { kind: 'part', key: 'r2' }, 'right')).toEqual({ x: 9, y: 3 });
  });

  it('snaps a dragged part to the grid, and a dragged name onto its own copper', () => {
    expect(dragTarget(s0, { kind: 'part', key: 'r2' }, { x: 10.4, y: 3.2 }, { x: 0.3, y: 0.1 })).toEqual({ x: 10, y: 3 });
    // The name out held at its point and dragged up and left: the nearest point of out's copper.
    expect(dragTarget(s0, { kind: 'label', node: 'out' }, { x: 6.8, y: -1.5 }, { x: 0, y: 0 })).toEqual({ x: 7, y: 0 });
  });

  it('previews a move with the drawing it gives, or the model\'s reason', () => {
    const ok = movePreview(s0, { kind: 'part', key: 'r2' }, { x: 10, y: 3 });
    expect(ok.ok).toBe(true);
    expect(ok.schematic?.drawing.parts.get('r2')?.at).toEqual({ x: 10, y: 3 });
    expect(ok.result?.text).toContain('*@ R2 10 3 0');
    // Where it stands: nothing to do, and no edit.
    expect(movePreview(s0, { kind: 'part', key: 'r2' }, { x: 8, y: 3 })).toMatchObject({ ok: true, schematic: s0 });
    expect(movePreview(s0, { kind: 'part', key: 'r2' }, { x: 4, y: 0 })).toMatchObject({ ok: false, reason: EDIT_STRINGS.taken('R1') });
    expect(moveOp({ kind: 'label', node: 'out' }, { x: 7, y: 0 })).toEqual({ kind: 'move-label', node: 'out', to: { x: 7, y: 0 } });
  });
});

describe('wires', () => {
  it('starts and ends on pins, ground pins, wires and node names, and shows where they can be', () => {
    expect(wireStartOf({ kind: 'pin', part: 'r1', pin: 1, at: { x: 6, y: 0 }, node: 'out' })).toEqual({ end: { part: 'r1', pin: 1 }, at: { x: 6, y: 0 }, node: 'out' });
    expect(wireStartOf({ kind: 'ground-pin', ground: 0, at: { x: 0, y: 6 } })).toEqual({ end: { ground: 0 }, at: { x: 0, y: 6 }, node: '0' });
    expect(wireStartOf({ kind: 'label', node: 'out', at: { x: 8, y: 0 } })).toEqual({ end: { at: { x: 8, y: 0 } }, at: { x: 8, y: 0 }, node: 'out' });
    expect(wireStartOf({ kind: 'part', key: 'r1' })).toBeUndefined();
    const targets = wireTargets(s0).map((p) => `${p.at.x},${p.at.y}:${p.node}`);
    expect(targets).toEqual(expect.arrayContaining(['2,0:in', '6,0:out', '0,6:0', '8,5:0']));
  });

  it('previews the way to the pointer and wires two nodes into one, the model saying which name stays', () => {
    const s = after(placeEdit(s0, handFor('R'), { x: 14, y: 3 }).text);
    const r3 = s.scene.parts.find((p) => p.key === 'r3')!;
    const start = wireStartOf(hitTest(s, r3.pins[0].at, 0.45, 'wire'))!;
    const path = wirePreview(s, { start, corners: [] }, { x: 11, y: 6 });
    expect(path?.[0]).toEqual(r3.pins[0].at);
    expect(path?.[path.length - 1]).toEqual({ x: 11, y: 6 });
    const end = wireStartOf(hitTest(s, { x: 8, y: 0 }, 0.45, 'wire'))!;
    const r = wireEdit(s, { start, corners: [] }, end);
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/^Wire added\. Node n\d and node out are now one node, out\.$/);
    expect(r.text).toContain('R3 out ');
    after(r.text);
    // With a corner chosen on the paper, the wire goes round by it (here along y = −2, above R1's words).
    const corner = { x: 10, y: -2 };
    const r2 = wireEdit(s, { start, corners: [corner] }, end);
    expect(r2.ok).toBe(true);
    expect(after(r2.text).drawing.wires.some((w) => w.some((p) => p.x === corner.x && p.y === corner.y))).toBe(true);
    // The same point twice is no wire.
    expect(wireEdit(s, { start, corners: [] }, start)).toMatchObject({ ok: false, reason: 'The wire would start and end at the same point.' });
  });

  it('finds a node\'s nearest pin for wiring node to node from the keyboard', () => {
    expect(nodeEnd(s0, 'out', { x: 9, y: 2 })).toEqual({ end: { part: 'r2', pin: 0 }, at: { x: 8, y: 1 }, node: 'out' });
    expect(nodeEnd(s0, 'out', { x: 5, y: 0 })).toEqual({ end: { part: 'r1', pin: 1 }, at: { x: 6, y: 0 }, node: 'out' });
  });
});

describe('deleting', () => {
  it('deletes a piece of wire, a part, or the ground symbol chosen', () => {
    expect(deleteOp(s0, { kind: 'node', name: 'out' }, { wire: 1, segment: 0 }, undefined)).toEqual({ kind: 'delete-wire', wire: 1, segment: 0 });
    expect(deleteOp(s0, { kind: 'part', key: 'r1' }, undefined, undefined)).toEqual({ kind: 'delete-part', part: 'r1' });
    expect(deleteOp(s0, { kind: 'node', name: '0' }, undefined, 3)).toEqual({ kind: 'delete-ground', ground: 0 });
    expect(deleteOp(s0, { kind: 'node', name: 'out' }, undefined, undefined)).toBeUndefined();
  });
});

describe('Connections: an end connected to a node, or let go', () => {
  it('names each end in the catalog\'s words, with its node', () => {
    // A part's ends are "ends" in the editor (an end is on a node, it is not one); the field table keeps "+ node" (new-13).
    expect(endsOf(s0, 'v1').map((e) => `${e.role}: ${e.words}`)).toEqual(['+ end: in', '− end: ground (node 0)']);
    expect(endsOf(s0, 'r1').map((e) => `${e.role}: ${e.words}`)).toEqual(['end 1: in', 'end 2: out']);
    const i = build('* t\nI1 0 a 1m\nR1 a 0 1k\n.op\n.end\n');
    expect(endsOf(i, 'i1').map((e) => e.role)).toEqual(['from end', 'to end']);
    expect(t('connConnectLabel', { role: endRoles('V')[0], name: 'V1' })).toBe('Connect to another node: the node at the + end of V1');
    expect(t('connDisconnectLabel', { role: endRoles('V')[0], name: 'V1', node: 'in' })).toBe('Disconnect the + end of V1 from its node');
    expect(`${t('formNewName')} ${t('formNewNameAt', { role: endRoles('R')[0] })}`).toBe('Name of the new node (end 1)');
    expect(nodeChoices(s0).map((n) => n.words)).toEqual(['ground (node 0)', 'in', 'out']);
  });

  it('lets an end go onto a node of its own, then wires it to a node chosen from the list', () => {
    const off = disconnectEdit(s0, 'r2', 1);
    expect(off.ok).toBe(true);
    expect(off.summary).toBe('R2 no longer connects to ground: that end is now on a node of its own, n1.');
    expect(off.text).toContain('R2 out n1 2k');
    const s1 = after(off.text);
    const on = connectEdit(s1, 'r2', 1, '0');
    expect(on.ok).toBe(true);
    expect(on.summary).toBe('Wire added. Node n1 and ground are now one node, ground.');
    expect(on.text).toContain('R2 out 0 2k');
    after(on.text);
    expect(connectEdit(s0, 'r2', 0, 'out')).toMatchObject({ ok: false, reason: 'That end is already on node out.' });
    // An end alone already: the model says so.
    expect(disconnectEdit(s1, 'r2', 1)).toMatchObject({ ok: false, reason: 'That end of R2 is already on a node of its own, n1.' });
  });

  it('joins by name when no wire finds a way (the summary says so)', () => {
    // Two circuits far apart, boxed in: connecting still works, by writing the name on each piece.
    const s = build('* t\nV1 a 0 1\nR1 a 0 1k\nV2 b 0 2\nR2 b 0 1k\n.op\n.end\n');
    const r = connectEdit(s, 'r2', 0, 'a');
    expect(r.ok).toBe(true);
    after(r.text);
    expect(readNetlist(r.text).netlist.text).toMatch(/R2 a 0 1k/);
  });

  it('lists the sources an F or H can read: V sources, then E and H', () => {
    const s = build('* t\nV1 a 0 1\nE1 b 0 a 0 2\nR1 b 0 1k\nVx a c 0\nR2 c 0 1k\n.op\n.end\n');
    expect(sourceChoices(s).map((x) => x.name)).toEqual(['V1', 'Vx', 'E1']);
  });
});

describe('the Add a part form', () => {
  it('starts from the kind, its default value and nodes to start from', () => {
    expect(formStart(s0, 'R')).toEqual({ letter: 'R', value: '1k', ends: [{ node: 'in' }, { fresh: 'n1' }] });
    expect(formStart(s0, 'R', 'out')).toEqual({ letter: 'R', value: '1k', ends: [{ node: 'out' }, { fresh: 'n1' }] });
    expect(formStart(s0, 'V')).toEqual({ letter: 'V', value: '5', ends: [{ fresh: 'n1' }, { node: '0' }] });
    expect(formStart(s0, 'I')).toEqual({ letter: 'I', value: '1m', ends: [{ node: '0' }, { fresh: 'n1' }] });
    expect(formStart(s0, 'G')).toMatchObject({ plus: 'in', minus: '0' });
    expect(formStart(s0, 'H')).toMatchObject({ source: 'v1' });
  });

  it('writes the line as the Netlist panel would, or says which field is wrong and why', () => {
    expect(formLine(s0, { letter: 'R', value: '4.7k', ends: [{ node: 'out' }, { node: '0' }] })).toMatchObject({ ok: true, line: 'R3 out 0 4.7k', name: 'R3', summary: 'R3 added between node out and ground.' });
    expect(formLine(s0, { letter: 'G', value: '0.25', ends: [{ node: '0' }, { node: 'out' }], plus: 'in', minus: '0' })).toMatchObject({ line: 'G1 0 out in 0 0.25' });
    expect(formLine(s0, { letter: 'F', value: '2', ends: [{ node: '0' }, { node: 'out' }], source: 'v1' })).toMatchObject({ line: 'F1 0 out V1 2' });
    expect(formLine(s0, { letter: 'R', value: '4,7k', ends: [{ node: 'out' }, { node: '0' }] })).toMatchObject({ ok: false, field: 'value' });
    expect(formLine(s0, { letter: 'R', value: '', ends: [{ node: 'out' }, { node: '0' }] })).toMatchObject({ ok: false, field: 'value' });
    expect(formLine(s0, { letter: 'R', value: '1k', ends: [{ fresh: 'my node' }, { node: '0' }] })).toMatchObject({ ok: false, field: 'end0', reason: EDIT_STRINGS.badName('my node') });
    const noV = build('* t\nR1 a 0 1k\n.op\n.end\n');
    expect(formLine(noV, { letter: 'H', value: '1k', ends: [{ node: 'a' }, { node: '0' }] })).toMatchObject({ ok: false, field: 'control', reason: EDIT_STRINGS.noSource('H') });
  });

  it('checks the value as a part’s card does: what SPICE reads it as, or why not and how to write it (new-14; facts decimal-comma-1, space-before-suffix-1, mega-as-milli-1)', () => {
    const form = (value: string): PartForm => ({ letter: 'R', value, ends: [{ node: 'out' }, { fresh: 'n1' }] });
    expect(formLine(s0, form('2k'))).toMatchObject({ ok: true, value: { kind: 'reads', reads: expect.stringMatching(/^2\skΩ$/), readsTrap: false } });
    // 1M is one number to SPICE, a milliohm: added as written, with the check and its fix said under the value.
    expect(formLine(s0, form('1M'))).toMatchObject({
      ok: true,
      line: 'R3 out n1 1M',
      value: { kind: 'reads', reads: expect.stringMatching(/^1\smΩ\s\(milli!\)$/), readsTrap: true, trap: { reason: expect.stringMatching(/^1M means 1 milliohm \(1\smΩ\), not 1 megaohm \(1\sMΩ\)$/), fix: { label: expect.stringMatching(/^Make it 1meg \(1\sMΩ\)$/), value: '1meg' } } },
    });
    // A comma and a space: not one number; the checks' reason and their fix, not "Type one number".
    expect(formLine(s0, form('4,7k'))).toMatchObject({ ok: false, field: 'value', reason: '4,7k: SPICE reads the comma as a space', fix: { label: 'Write 4.7k', value: '4.7k' } });
    expect(formLine(s0, form('1 k'))).toMatchObject({ ok: false, field: 'value', reason: '1 k: the space splits the value in two', fix: { label: 'Write 1k', value: '1k' } });
    expect(formLine(s0, form(''))).toMatchObject({ ok: false, field: 'value', reason: t('formBadValue'), value: { kind: 'empty' } });
    // The same words as the card's (one rule): writeValue on R2's own value.
    expect(formValue(s0, form('4,7k'))).toEqual({ kind: 'refused', reason: '4,7k: SPICE reads the comma as a space', fix: { label: 'Write 4.7k', value: '4.7k' } });
    // A gain reads as the number SPICE reads.
    expect(formValue(s0, { letter: 'G', value: '250m', ends: [{ node: '0' }, { node: 'out' }], plus: 'in', minus: '0' })).toMatchObject({ kind: 'reads', reads: '0.25' });
  });

  it('builds Start here on a blank page, part by part, as the netlist names them', () => {
    let s = build('');
    const add = (f: PartForm): void => {
      const r = addPartEdit(s, f);
      expect(r.ok, r.ok ? '' : r.reason).toBe(true);
      if (r.ok) s = after(r.text);
    };
    add({ letter: 'V', value: '6', ends: [{ fresh: 'in' }, { node: '0' }] });
    expect(s.netlist.text).toBe('* circuit\nV1 in 0 6\n.op\n.end\n');
    add({ letter: 'R', value: '1k', ends: [{ node: 'in' }, { fresh: 'out' }] });
    add({ letter: 'R', value: '2k', ends: [{ node: 'out' }, { node: '0' }] });
    expect(s.netlist.text).toBe('* circuit\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n');
    expect(traps(s.netlist.text)).toEqual([]);
  });
});

describe('the editing keys', () => {
  const key = (k: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}): ReturnType<typeof editKey> =>
    editKey({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });

  it('T turns, M mirrors, Shift+R reverses, Shift+arrows move, Delete and Backspace delete, A adds', () => {
    expect(key('t')).toEqual({ kind: 'turn' });
    expect(key('T')).toEqual({ kind: 'turn' }); // Caps Lock
    expect(key('m')).toEqual({ kind: 'mirror' });
    expect(key('R', { shiftKey: true })).toEqual({ kind: 'reverse' });
    expect(key('ArrowLeft', { shiftKey: true })).toEqual({ kind: 'move', dir: 'left' });
    expect(key('Delete')).toEqual({ kind: 'delete' });
    expect(key('Backspace')).toEqual({ kind: 'delete' });
    expect(key('a')).toEqual({ kind: 'add' });
  });

  it('keeps the tools\' letters, and leaves the browser\'s and the screen readers\' keys alone', () => {
    expect(key('r')).toEqual({ kind: 'tool', tool: 'R' });
    expect(key('w')).toEqual({ kind: 'tool', tool: 'wire' });
    expect(key('0')).toEqual({ kind: 'tool', tool: 'ground' });
    // Ctrl+R reloads, Ctrl+E is the browser's, Alt+arrows go back and forward: not ours.
    expect(key('r', { ctrlKey: true })).toBeUndefined();
    expect(key('e', { metaKey: true })).toBeUndefined();
    expect(key('ArrowLeft', { altKey: true })).toBeUndefined();
    // Plain arrows move along the wires (the drawing's own keys), Space activates a button.
    expect(key('ArrowLeft')).toBeUndefined();
    expect(key(' ')).toBeUndefined();
    expect(key('T', { shiftKey: true })).toBeUndefined();
  });
});

describe('every edit through the model', () => {
  it('turns, mirrors and reverses the selected part with the model\'s words', () => {
    expect(applyEdit(s0, { kind: 'rotate-part', part: 'r2' }).summary).toBe('R2 turned.');
    expect(applyEdit(s0, { kind: 'mirror-part', part: 'r2' }).summary).toBe('R2 mirrored.');
    const rev = applyEdit(s0, { kind: 'reverse-part', part: 'v1' });
    expect(rev.text).toContain('V1 0 in 6');
    expect(rev.summary).toMatch(/^V1 reversed\./);
  });
});

describe('after the reviews of step B', () => {
  it('a click on a wire selects the piece between the places something joins it, and Delete takes only that', () => {
    // p02-4 as laid out automatically (its own *@ lines draw it as in the video), with the ground wire along the bottom.
    const s = build(stripDrawing(readFileSync(resolve(import.meta.dirname, '../../examples/p02/p02-4-open.cir'), 'utf8')));
    const r3 = s.scene.parts.find((p) => p.key === 'r3')!;
    const g1 = s.scene.parts.find((p) => p.key === 'g1')!;
    const y = r3.pins[1].at.y + 1;
    // Between R3's junction and G1, on the ground wire along the bottom.
    const hit = hitTest(s, { x: (r3.pins[1].at.x + g1.pins[0].at.x) / 2, y }, 0.45, 'select');
    expect(hit?.kind).toBe('wire');
    if (hit?.kind !== 'wire') return;
    expect(hit.piece.from).toEqual({ x: r3.pins[1].at.x, y });
    expect(pieceAt(s, hit.wire, hit.segment, { x: r3.pins[1].at.x - 1, y })!.to).toEqual({ x: r3.pins[1].at.x, y });
    const op = deleteOp(s, undefined, { wire: hit.wire, segment: hit.segment, piece: hit.piece }, undefined)!;
    const r = applyEdit(s, op);
    expect(r.summary).toBe('Piece of wire deleted. G1 no longer connects to ground: that end is now on a node of its own, n2.');
    after(r.text);
  });

  it('with the Wire tool, a click on a part means its nearer pin, never a corner inside it', () => {
    const r2 = s0.scene.parts.find((p) => p.key === 'r2')!;
    const nearTop = { x: r2.at.x, y: r2.at.y - 0.6 };
    expect(symbolEnd(s0, nearTop, 0.45)).toMatchObject({ end: { part: 'r2', pin: 0 }, at: r2.pins[0].at, node: 'out' });
    expect(symbolEnd(s0, { x: 30, y: 30 }, 0.45)).toBeUndefined();
  });

  it('a move preview remembers the text it was made from, and turns the part on the way', () => {
    const r2 = s0.drawing.parts.get('r2')!;
    const to = { x: r2.at.x + 3, y: r2.at.y };
    const p = movePreview(s0, { kind: 'part', key: 'r2' }, to, { rot: 90, mirror: false });
    expect(p).toMatchObject({ ok: true, base: s0.netlist.text, turn: { rot: 90, mirror: false } });
    expect(p.schematic!.drawing.parts.get('r2')).toMatchObject({ at: to, rot: 90 });
    // Where it is, turned only: a turn.
    expect(movePreview(s0, { kind: 'part', key: 'r2' }, r2.at, { rot: 90, mirror: false }).result?.summary).toBe('R2 moved.');
  });

  it('the Add a part form pins its part when the circuit is drawn by hand, in the same step', () => {
    const drawn = applyEdit(s0, { kind: 'rotate-part', part: 'r2' }).text;
    const s = build(drawn);
    const f = { ...formStart(s, 'R'), value: '3k', ends: [{ node: 'out' }, { node: '0' }] } as PartForm;
    const r = addPartEdit(s, f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toMatch(/\*@ R3 -?\d+ -?\d+ \d+/);
    after(r.text);
    // Not drawn by hand yet: no *@ lines are written for it (it is laid out with the rest).
    const plain = addPartEdit(s0, { ...formStart(s0, 'R'), value: '3k', ends: [{ node: 'out' }, { node: '0' }] });
    expect(plain.ok && plain.text.includes('*@')).toBe(false);
  });

  it('a list of nodes can say which parts each joins; a controlled source says what it reads', () => {
    expect(nodeChoices(s0, true).map((n) => n.words)).toEqual(['ground (node 0)', 'in: V1, R1', 'out: R1, R2']);
    const g = build('* t\nV1 a 0 6\nG1 0 b a 0 0.25\nH1 c 0 V1 2\n.op\n.end\n');
    // In the words of the card's Connections, not the V(a, 0) of a formula (new-32, facts P6, P8).
    expect(controlWords(g.circuit.parts.find((p) => p.key === 'g1')!)).toBe('the voltage between node a and ground');
    expect(controlWords(g.circuit.parts.find((p) => p.key === 'h1')!)).toBe('the current through V1');
    expect(t('controlPlaced', { name: 'G1', control: controlWords(g.circuit.parts.find((p) => p.key === 'g1')!)! })).toBe('G1 reads the voltage between node a and ground for now: choose what it reads on its card.');
    expect(controlWords(g.circuit.parts.find((p) => p.key === 'v1')!)).toBeUndefined();
  });

  it('a wire between two points already joined is refused, not "added" with nothing to add', () => {
    const start = wireStartOf(hitTest(s0, { x: 0, y: 1 }, 0.45, 'wire'))!;
    const end = wireStartOf(hitTest(s0, { x: 2, y: 0 }, 0.45, 'wire'))!;
    expect(wireEdit(s0, { start, corners: [] }, end)).toMatchObject({ ok: false, reason: 'Those two points are already connected by wire, on node in: there is no wire to add.' });
  });

  it('a current source in hand says which way its arrow pushes', () => {
    const p = placePreview(s0, handFor('I'), { x: 14, y: 3 });
    expect(joinsWords(s0, p)).toBe('its arrow pushes current from a new node, through it, into a new node');
  });
});
