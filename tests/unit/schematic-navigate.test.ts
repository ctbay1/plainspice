/**
 * src/schematic/navigate.ts: moving through the drawing from the keyboard (reading order, arrow keys
 * along the wires) and what a screen reader says for each part and node. A part's words must be the
 * very sentence the circuit overview says for it (src/spice/describe.ts), so the drawing makes no
 * claim about SPICE of its own.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSchematic,
  connections,
  describeItem,
  describeNode,
  describePart,
  describeSchematic,
  itemPosition,
  neighbour,
  readingOrder,
  type NavItem,
} from '../../src/schematic/index.ts';
import { describeCircuit } from '../../src/spice/describe.ts';

const root = resolve(import.meta.dirname, '../..');
const files = [
  ...readdirSync(join(root, 'examples'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(join(root, 'examples', d.name)).filter((f) => f.endsWith('.cir')).map((f) => join('examples', d.name, f))),
  ...readdirSync(join(root, 'tests/fixtures')).filter((f) => f.endsWith('.cir')).map((f) => join('tests/fixtures', f)),
  ...readdirSync(join(root, 'tests/corpus/traps')).filter((f) => f.endsWith('.cir')).map((f) => join('tests/corpus/traps', f)),
];

const P1 = '* p01-1\nV1 n1 0 6\nR1 n1 n2 2\nR2 n2 0 4\nI1 0 n2 3\n.op\n.end\n';
const part = (key: string): NavItem => ({ kind: 'part', key });
const node = (name: string): NavItem => ({ kind: 'node', name });

describe('descriptions', () => {
  it.each(files)('%s: each part says exactly what the circuit overview says for it', (path) => {
    const s = buildSchematic(readFileSync(join(root, path), 'utf8'));
    const overview = describeCircuit(s.netlist);
    for (const p of s.circuit.parts) {
      const sentence = describePart(s, p.key);
      expect(sentence.length).toBeGreaterThan(0);
      expect(overview).toContain(sentence);
    }
  });

  it('describes parts and nodes in plain words', () => {
    const s = buildSchematic(P1);
    const sp = (t: string): string => t.replace(/ /g, ' ');
    expect(sp(describePart(s, 'R1'))).toBe('R1: a 2 Ω resistor between n1 and n2.');
    expect(sp(describePart(s, 'v1'))).toBe('V1: a 6 V source with its + side at n1 and its − side at ground.');
    expect(sp(describePart(s, 'I1'))).toBe('I1: a 3 A current source pushing current from ground into n2.');
    expect(describeNode(s, 'n2')).toBe('Node n2 connects R1, R2 and I1.');
    expect(describeNode(s, '0')).toBe('Ground (node 0) connects V1, R2 and I1.');
    expect(describeItem(s, node('n1'))).toBe('Node n1 connects V1 and R1.');
    expect(describePart(s, 'R9')).toBe('');
  });

  it('says which lines the drawing leaves out', () => {
    const s = buildSchematic('* t\nV1 a 0 5\nR1 a b 1k\nD1 b 0 dmod\n.model dmod D\n.op\n.end\n');
    expect(describeSchematic(s)).toContain('Not in the drawing: D1 (line 4).');
    expect(describeSchematic(buildSchematic(P1))).toBe(describeCircuit(buildSchematic(P1).netlist));
  });
});

describe('moving around', () => {
  const s = buildSchematic(P1);

  it('lists every part and node once, top to bottom, then left to right', () => {
    const order = readingOrder(s);
    expect(order).toHaveLength(s.circuit.parts.length + s.circuit.nodes.size);
    const keys = order.map((i) => (i.kind === 'part' ? i.key : `[${i.name}]`));
    expect(new Set(keys).size).toBe(keys.length);
    const at = order.map((i) => itemPosition(s, i)!);
    for (let i = 1; i < at.length; i++) {
      expect(at[i]!.y > at[i - 1]!.y || (at[i]!.y === at[i - 1]!.y && at[i]!.x >= at[i - 1]!.x)).toBe(true);
    }
    // The top rail first: n1, R1, n2; ground last.
    expect(keys.slice(0, 3)).toEqual(['[n1]', 'r1', '[n2]']);
    expect(keys[keys.length - 1]).toBe('[0]');
  });

  it('moves along the wires: from a part to the node at its pin, from a node to the part that way', () => {
    expect(neighbour(s, part('r1'), 'right')).toEqual(node('n2'));
    expect(neighbour(s, part('r1'), 'left')).toEqual(node('n1'));
    expect(neighbour(s, part('v1'), 'up')).toEqual(node('n1'));
    expect(neighbour(s, part('v1'), 'down')).toEqual(node('0'));
    expect(neighbour(s, node('n2'), 'left')).toEqual(part('r1'));
    expect(neighbour(s, node('n2'), 'down')).toEqual(part('r2'));
    expect(neighbour(s, node('n1'), 'down')).toEqual(part('v1'));
    expect(neighbour(s, node('0'), 'up')).toEqual(part('v1'));
    // Sideways from an upright part: the next thing that way.
    expect(neighbour(s, part('r2'), 'right')).toEqual(part('i1'));
    expect(neighbour(s, part('i1'), 'right')).toBeUndefined();
  });

  it('lists what an item connects', () => {
    expect(connections(s, part('r1'))).toEqual([node('n1'), node('n2')]);
    expect(connections(s, node('n2'))).toEqual([part('r1'), part('r2'), part('i1')]);
  });
});

describe('nodes that go on to parts the drawing does not show', () => {
  it('says so, with the lines', () => {
    const s = buildSchematic('* t\nV1 a 0 5\nR1 a b 1k\nD1 b 0 dmod\nX1 a b sub\n.model dmod D\n.op\n.end\n');
    expect(describeNode(s, 'b')).toBe('Node b connects R1. It also connects D1 (line 4) and X1 (line 5), which the drawing does not show.');
    expect(describeNode(s, '0')).toBe('Ground (node 0) connects V1. It also connects D1 (line 4), which the drawing does not show.');
  });
});
