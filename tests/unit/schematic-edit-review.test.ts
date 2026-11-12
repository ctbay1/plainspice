/**
 * src/schematic/edit.ts after the reviews of step B (decision 0017): what the three critiques found,
 * each pinned down. A move never renames a node (the ground symbol included); Reverse swaps what the
 * ends mean, not their words (gnd at the end of a line is not ground, W9); a part may meet another
 * end to end at a right angle; a piece of wire is the stretch between the places something joins it;
 * a wire never doubles back at a corner, and the lines written are exactly what the drawing shows; a
 * drawing with nothing left takes its lines away; a part typed into a drawn circuit is pinned in the
 * same step; the student's own node names win over PlainSpice's; new wires do not snake round the
 * words of the nodes they join; and random edits on the examples keep the text and the drawing in step.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOTEBOOK_OPTIONS } from '../../src/notebook/schematic.ts';
import {
  EDIT_STRINGS,
  applyEdit,
  buildSchematic,
  checkConnectivity,
  drawnPins,
  findIslands,
  pinDrawing,
  pointOnSegment,
  placedPart,
  segmentsOf,
  serializeDrawing,
  stripDrawing,
  wireRoute,
  type EditOp,
  type EditResult,
  type Schematic,
} from '../../src/schematic/index.ts';

const DIVIDER = '* divider\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n';

/** An edit that must be done, and the schematic of the text it gives. */
function done(s: Schematic, op: EditOp): { r: EditResult; next: Schematic } {
  const r = applyEdit(s, op);
  expect(r.ok, r.reason).toBe(true);
  const next = buildSchematic(r.text, s.options);
  // What the lines say is what the drawing shows, and the drawing connects what the netlist does.
  expect(serializeDrawing(next.circuit, next.drawing, next.kept)).toEqual(r.lines);
  expect(checkConnectivity(next.circuit, next.drawing).filter((p) => p.kind !== 'hidden')).toEqual([]);
  // No node's name is written on another node's wire (where it could be read as either).
  const pins = drawnPins(next.circuit, next.drawing);
  const islands = findIslands(next.drawing.wires, pins.map((p) => p.at));
  for (const l of next.drawing.labels) {
    const own = islands.at(l.at);
    const across = next.drawing.wires.filter((w, i) => islands.wires[i] !== own && segmentsOf(w).some(([a, b]) => pointOnSegment(l.at, a, b)));
    expect(across, `${l.node}'s name on another node's wire`).toEqual([]);
  }
  return { r, next };
}

const wiresOf = (s: Schematic): string[] => s.drawing.wires.map((w) => w.map((p) => `${p.x},${p.y}`).join(' '));

describe('moving the ground symbol', () => {
  it('never renames a node: off its wire, a wire follows it, as wires follow a moved part', () => {
    const s = buildSchematic(DIVIDER);
    for (const to of [
      { x: 0, y: 7 },
      { x: 0, y: 8 },
      { x: -1, y: 6 },
    ]) {
      const { r, next } = done(s, { kind: 'move-ground', ground: 0, to });
      expect(stripDrawing(r.text)).toBe(DIVIDER);
      expect(r.summary).toBe(EDIT_STRINGS.groundMoved);
      expect(next.drawing.grounds[0]!.at).toEqual(to);
    }
  });
});

describe('reversing', () => {
  it('swaps what the ends mean: ground is written 0, since gnd at the end of a line is an ordinary node (W9)', () => {
    const s = buildSchematic('* ammeter\nV1 a 0 6\nR1 a b 1k\nVx gnd b\n.op\n.end\n');
    const { r } = done(s, { kind: 'reverse-part', part: 'Vx' });
    expect(stripDrawing(r.text)).toContain('Vx b 0\n');
  });

  it('refuses a part on a node called gnd that is not ground: swapped, gnd would become ground', () => {
    const s = buildSchematic('* gnd last\nV1 a 0 6\nR1 a b 1k\nVx b gnd\nR2 gnd 0 1k\n.op\n.end\n');
    expect(applyEdit(s, { kind: 'reverse-part', part: 'Vx' })).toMatchObject({ ok: false, reason: EDIT_STRINGS.gndNode('Vx') });
  });
});

describe('a part moved and turned on the way', () => {
  it('lands turned (or mirrored) in one edit, its line untouched', () => {
    const s = buildSchematic(DIVIDER);
    const at = placedPart(s, 'R2')!.at;
    const { r, next } = done(s, { kind: 'move-part', part: 'R2', to: { x: at.x + 3, y: at.y }, rot: 90 });
    expect(stripDrawing(r.text)).toBe(DIVIDER);
    expect(next.drawing.parts.get('r2')).toMatchObject({ at: { x: at.x + 3, y: at.y }, rot: 90 });
    // Turned where it stands, it is a turn.
    expect(done(s, { kind: 'move-part', part: 'R2', to: at, mirror: !s.drawing.parts.get('r2')!.mirror }).r.ok).toBe(true);
    expect(applyEdit(s, { kind: 'move-part', part: 'R2', to: at }).reason).toBe(EDIT_STRINGS.samePlace('R2'));
  });
});

describe('placing end to end', () => {
  it('lets a part meet another at a right angle at a shared pin, which joins that node', () => {
    const s0 = buildSchematic('* t\nV1 a 0 6\n.op\n.end\n', NOTEBOOK_OPTIONS);
    const v1 = placedPart(s0, 'V1')!;
    const top = v1.pins[0]!.at;
    // A resistor lying across, its left end on V1's +, and one with its right end there.
    for (const at of [
      { x: top.x + 2, y: top.y },
      { x: top.x - 2, y: top.y },
    ]) {
      const { r } = done(s0, { kind: 'add-part', letter: 'R', at, rot: 270 });
      expect(r.summary).toMatch(/^R1 added between (a and n\d|n\d and a)\.$/);
    }
    // Overlapping the source is refused, and says what is in the way.
    expect([EDIT_STRINGS.taken('V1'), EDIT_STRINGS.onWire]).toContain(applyEdit(s0, { kind: 'add-part', letter: 'R', at: { x: top.x + 1, y: top.y }, rot: 270 }).reason);
    expect(applyEdit(s0, { kind: 'add-part', letter: 'R', at: { x: top.x + 1, y: top.y + 2 }, rot: 0 }).reason).toBe(EDIT_STRINGS.taken('V1'));
    // A pin on V1's lead (not its pin) is refused: it would look joined and not be.
    expect(applyEdit(s0, { kind: 'add-part', letter: 'R', at: { x: top.x + 2, y: top.y + 1 }, rot: 270 }).ok).toBe(false);
  });
});

describe('a piece of wire', () => {
  it('deletes only the stretch between the places something joins it, so only what hangs on it splits off', () => {
    const s = buildSchematic(readFileSync(new URL('../../examples/p02/p02-4-open.cir', import.meta.url), 'utf8'), NOTEBOOK_OPTIONS);
    // The ground wire along the bottom: from the ground symbol, past R3's junction, to G1.
    const wire = s.drawing.wires.findIndex((w) => w.length > 3 && w.every((p) => p.y >= 5));
    const segment = 1;
    const [a, b] = [s.drawing.wires[wire]![segment]!, s.drawing.wires[wire]![segment + 1]!];
    const r3 = placedPart(s, 'R3')!.pins[1]!.at;
    const junction = { x: r3.x, y: a.y };
    // Between R3's junction and G1: G1 alone splits off; R3 keeps its ground.
    const { r } = done(s, { kind: 'delete-wire', wire, segment, piece: { from: junction, to: b } });
    expect(r.summary).toBe(`${EDIT_STRINGS.pieceDeleted} ${EDIT_STRINGS.split('ground', 'n2')}`);
    expect(stripDrawing(r.text)).toContain('R3 n1 0 6');
    expect(stripDrawing(r.text)).toContain('G1 n2 a n1 0 0.25');
    // A piece that is not on that segment is no piece of it.
    expect(applyEdit(s, { kind: 'delete-wire', wire, segment, piece: { from: { x: -9, y: -9 }, to: b } }).reason).toBe(EDIT_STRINGS.noWire);
  });
});

describe('wires', () => {
  it('never double back at a corner: each leg keeps off the legs before it', () => {
    const s0 = buildSchematic(DIVIDER, NOTEBOOK_OPTIONS);
    const { next: s } = done(s0, { kind: 'add-part', letter: 'R', at: { x: 14, y: 3 }, rot: 270 });
    const corner = { x: 10, y: -2 };
    // The way to that corner and on from it, as the Wire tool asks for it: no leg back over another.
    const path = wireRoute(s, { part: 'r3', pin: 0 }, { at: { x: 8, y: 0 } }, [corner])!;
    expect(path).toBeDefined();
    const keys = path.map((p) => `${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(keys.length);
    const { next } = done(s, { kind: 'add-wire', from: { part: 'r3', pin: 0 }, to: { at: { x: 8, y: 0 } }, via: path.slice(1, -1) });
    // The corner chosen is on the wire the text keeps.
    expect(wiresOf(next).some((w) => w.includes(`${corner.x},${corner.y}`))).toBe(true);
  });

  it('do not snake round the words of the nodes they join (a circuit drawn by hand stays square)', () => {
    let s = buildSchematic('* t\n.op\n.end\n', NOTEBOOK_OPTIONS);
    const step = (op: EditOp): void => {
      s = done(s, op).next;
    };
    step({ kind: 'add-part', letter: 'I', at: { x: 0, y: 3 }, rot: 180 });
    step({ kind: 'add-part', letter: 'R', at: { x: 4, y: 3 }, rot: 0 });
    step({ kind: 'add-part', letter: 'R', at: { x: 8, y: 3 }, rot: 0 });
    step({ kind: 'add-ground', at: placedPart(s, 'I1')!.pins[0]!.at });
    step({ kind: 'add-wire', from: { part: 'i1', pin: 1 }, to: { part: 'r1', pin: 0 } });
    step({ kind: 'add-wire', from: { part: 'r1', pin: 0 }, to: { part: 'r2', pin: 0 } });
    // The top rail: straight along y = 0 from I1 to R2, never below it between the parts.
    const top = s.drawing.wires.filter((w) => w.some((p) => p.y === 0));
    for (const w of top) for (const p of w) expect(p.y, wiresOf(s).join(' | ')).toBeLessThanOrEqual(1);
  });
});

describe('the drawing lines', () => {
  it('go away, header and all, when the last part is deleted', () => {
    const s0 = buildSchematic('* one part\nR1 a 0 1k\n.op\n.end\n');
    const { next } = done(s0, { kind: 'rotate-part', part: 'R1' });
    expect(next.netlist.text).toContain('* plainspice-drawing v1');
    const r = applyEdit(next, { kind: 'delete-part', part: 'R1' });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('* one part\n.op\n.end\n');
  });

  it('pin a part typed into a drawn circuit in the same step (pinDrawing), so it never moves later', () => {
    const drawn = done(buildSchematic(DIVIDER), { kind: 'rotate-part', part: 'R2' }).r.text;
    const typed = drawn.replace('.op\n', 'R3 out 0 3k\n.op\n');
    const pinned = pinDrawing(typed);
    expect(pinned).toMatch(/\*@ R3 -?\d+ -?\d+ \d+/);
    // The student's lines stay as they were; the drawing does not change when more is typed.
    expect(stripDrawing(pinned)).toBe(stripDrawing(typed));
    const where = buildSchematic(pinned).drawing.parts.get('r3');
    expect(buildSchematic(pinned.replace('.op\n', 'C1 in 0 1u\nL1 out 0 1m\n.op\n')).drawing.parts.get('r3')).toEqual(where);
    expect(pinDrawing(pinned)).toBe(pinned);
  });
});

describe('which name stays when two nodes become one', () => {
  it('keeps the name the student chose over one PlainSpice gave, and the lower of two given names', () => {
    const s = buildSchematic('* t\nV1 n3 0 1\nR1 n3 n5 1\nR2 n5 out 1\nR3 out 0 1\n.op\n.end\n');
    const r1 = applyEdit(s, { kind: 'add-wire', from: { part: 'R1', pin: 0 }, to: { part: 'R2', pin: 0 } });
    expect(r1.summary).toBe(`${EDIT_STRINGS.wired} ${EDIT_STRINGS.merged('n5', 'n3')}`);
    const r2 = applyEdit(s, { kind: 'add-wire', from: { part: 'R2', pin: 0 }, to: { part: 'R3', pin: 0 } });
    expect(r2.summary).toBe(`${EDIT_STRINGS.wired} ${EDIT_STRINGS.merged('n5', 'out')}`);
  });
});

describe('random edits on every example', () => {
  it('keep the lines written exactly what the drawing shows, and the drawing connecting what the netlist connects', () => {
    let seed = 7;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
    const dir = new URL('../../examples/', import.meta.url);
    const files = ['e04', 'p02', 'p01'].flatMap((d) => readdirSync(new URL(`${d}/`, dir)).map((f) => new URL(`${d}/${f}`, dir)));
    let made = 0;
    for (const f of files) {
      let s = buildSchematic(readFileSync(f, 'utf8'), NOTEBOOK_OPTIONS);
      for (let step = 0; step < 12; step++) {
        const p = pick(s.scene.parts);
        const at = s.drawing.parts.get(p.key)!.at;
        const q = pick(s.scene.parts);
        const ops: EditOp[] = [
          { kind: 'move-part', part: p.key, to: { x: at.x + Math.round(rnd() * 6 - 3), y: at.y + Math.round(rnd() * 6 - 3) } },
          { kind: 'rotate-part', part: p.key },
          { kind: 'mirror-part', part: p.key },
          { kind: 'reverse-part', part: p.key },
          { kind: 'add-wire', from: { part: p.key, pin: rnd() < 0.5 ? 0 : 1 }, to: { part: q.key, pin: rnd() < 0.5 ? 0 : 1 } },
          { kind: 'add-part', letter: pick(['R', 'C', 'V', 'I'] as const), at: { x: Math.round(rnd() * 20 - 5), y: Math.round(rnd() * 12 - 4) } },
          { kind: 'disconnect-pin', part: p.key, pin: rnd() < 0.5 ? 0 : 1 },
          { kind: 'rename-node', node: pick([...s.circuit.nodes.keys()]), name: rnd() < 0.3 ? '0' : `q${step}` },
        ];
        if (s.drawing.grounds.length) ops.push({ kind: 'move-ground', ground: 0, to: { x: s.drawing.grounds[0]!.at.x + Math.round(rnd() * 4 - 2), y: s.drawing.grounds[0]!.at.y + Math.round(rnd() * 4 - 2) } });
        const op = pick(ops);
        const r = applyEdit(s, op);
        if (!r.ok) continue;
        made += 1;
        s = done(s, op).next;
      }
    }
    expect(made).toBeGreaterThan(80);
  });
});
