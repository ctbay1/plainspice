/**
 * src/schematic/edit.ts, the additions for the editor's keyboard way (decision 0017): disconnect-pin
 * (one end of a part onto a node of its own, the rest of its old node untouched) and wireRoute (the
 * way the router would draw a wire, to a free point or through corners, for previews). Like every
 * edit, they must keep the drawing connecting exactly what the netlist says.
 */
import { describe, expect, it } from 'vitest';
import { EDIT_STRINGS, applyEdit, buildSchematic, freshNodeName, insertLine, schematicConnectivity, wireRoute, type Schematic } from '../../src/schematic/index.ts';
import { parseNetlist } from '../../src/spice/parse.ts';

const DIVIDER = '* divider\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n';

function clean(text: string): Schematic {
  const s = buildSchematic(text);
  expect(schematicConnectivity(s).filter((p) => p.kind !== 'hidden')).toEqual([]);
  expect(s.problems.filter((p) => p.severity !== 'info')).toEqual([]);
  return s;
}

describe('disconnect-pin', () => {
  it('puts one end on a node of its own; the rest of the old node keeps its name and its wires', () => {
    const s = buildSchematic(DIVIDER);
    const r = applyEdit(s, { kind: 'disconnect-pin', part: 'R2', pin: 0 });
    expect(r.ok).toBe(true);
    expect(r.summary).toBe(EDIT_STRINGS.disconnected('R2', 'out', 'n1'));
    expect(r.text).toContain('R2 n1 0 2k');
    expect(r.text).toContain('R1 in out 1k');
    const next = clean(r.text);
    // R2's top pin stands alone: nothing else of the drawing touches it.
    const pin = next.scene.parts.find((p) => p.key === 'r2')!.pins[0];
    expect(next.scene.wires.some((w) => w.points.some((p) => p.x === pin.at.x && p.y === pin.at.y))).toBe(false);
    expect(next.drawing.parts.get('r2')).toEqual(s.drawing.parts.get('r2'));
  });

  it('lets go of ground too, and keeps ground on the rest of its copper', () => {
    const s = buildSchematic(DIVIDER);
    const r = applyEdit(s, { kind: 'disconnect-pin', part: 'R2', pin: 1 });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('R2 out n1 2k');
    expect(r.text).toContain('V1 in 0 6');
    expect(clean(r.text).drawing.grounds.length).toBeGreaterThan(0);
  });

  it('refuses an end already alone, an end that does not exist, and a part that is not there', () => {
    const s = buildSchematic('* t\nV1 a 0 1\nR1 a b 1k\nR2 a 0 1k\n.op\n.end\n');
    expect(applyEdit(s, { kind: 'disconnect-pin', part: 'R1', pin: 1 })).toMatchObject({ ok: false, reason: EDIT_STRINGS.alone('R1', 'b') });
    expect(applyEdit(s, { kind: 'disconnect-pin', part: 'R1', pin: 2 as 0 })).toMatchObject({ ok: false, reason: EDIT_STRINGS.noPin });
    expect(applyEdit(s, { kind: 'disconnect-pin', part: 'R9', pin: 0 })).toMatchObject({ ok: false, reason: EDIT_STRINGS.noPart('R9') });
  });

  it('places a part again when its end touched another part\'s pin directly', () => {
    // R1 and R2 meet pin to pin at out (no wire between them).
    const text = '* t\nV1 in 0 1\nR1 in out 1k\nR2 out 0 1k\n.op\n* plainspice-drawing v1\n*@ V1 0 3 0\n*@ R1 2 1 0\n*@ R2 2 5 0\n*@ ground 0 7 0\n*@ wire 0,1 0,-1 2,-1\n*@ wire 0,5 0,7 2,7\n.end\n';
    const s = clean(text);
    const r = applyEdit(s, { kind: 'disconnect-pin', part: 'R2', pin: 0 });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('R2 n1 0 1k');
    clean(r.text);
  });

  it('works on a drawing saved by another version: only the part line changes', () => {
    const text = '* t\nV1 a 0 1\nR1 a 0 1k\nR2 a 0 1k\n.op\n* plainspice-drawing v9\n*@ V1 0 0 0\n.end\n';
    const r = applyEdit(buildSchematic(text), { kind: 'disconnect-pin', part: 'R2', pin: 0 });
    expect(r.ok).toBe(true);
    expect(r.text).toBe(text.replace('R2 a 0', 'R2 n1 0'));
  });
});

describe('wireRoute', () => {
  const s = buildSchematic(DIVIDER);

  it('goes from a pin to a free point, keeping off symbols and other nodes', () => {
    const r2 = s.scene.parts.find((p) => p.key === 'r2')!;
    const to = { x: r2.at.x + 6, y: r2.at.y + 4 };
    const path = wireRoute(s, { part: 'r2', pin: 1 }, { free: to })!;
    expect(path[0]).toEqual(r2.pins[1].at);
    expect(path[path.length - 1]).toEqual(to);
    for (let i = 1; i < path.length; i++) expect(path[i]!.x === path[i - 1]!.x || path[i]!.y === path[i - 1]!.y).toBe(true);
  });

  it('is the way add-wire then draws, through the corners given', () => {
    const r1 = s.scene.parts.find((p) => p.key === 'r1')!;
    const corner = { x: r1.at.x, y: r1.at.y - 4 };
    const path = wireRoute(s, { part: 'r1', pin: 0 }, { part: 'r1', pin: 1 }, [corner])!;
    expect(path.some((p) => p.x === corner.x && p.y === corner.y)).toBe(true);
    const r = applyEdit(s, { kind: 'add-wire', from: { part: 'r1', pin: 0 }, to: { part: 'r1', pin: 1 }, via: path.slice(1, -1) });
    expect(r.ok).toBe(true);
    expect(r.summary).toBe(`${EDIT_STRINGS.wired} ${EDIT_STRINGS.merged('out', 'in')}`);
    clean(r.text);
  });

  it('finds no way off the grid or from no end', () => {
    expect(wireRoute(s, { part: 'r9', pin: 0 }, { free: { x: 0, y: 0 } })).toBeUndefined();
    expect(wireRoute(s, { part: 'r1', pin: 0 }, { free: { x: 0.5, y: 0 } })).toBeUndefined();
  });
});

describe('the helpers the editor shares with the model', () => {
  it('names a new node as the model would, and puts a new line where the model would', () => {
    const s = buildSchematic(DIVIDER);
    const taken = new Set<string>();
    expect(freshNodeName(s, taken)).toBe('n1');
    expect(freshNodeName(s, taken)).toBe('n2');
    const n = parseNetlist(DIVIDER);
    expect(insertLine(n, 'R3 out 0 1k')).toEqual({ from: DIVIDER.indexOf('.op'), to: DIVIDER.indexOf('.op'), insert: 'R3 out 0 1k\n' });
  });
});
