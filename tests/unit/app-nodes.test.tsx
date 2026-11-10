/**
 * Node colours (src/app/nodes.ts): from the colour-blind-safe palette (src/theme/nodes.ts), in the
 * order nodes first appear, ground left out, and the parser decides what ground is.
 */
import { describe, expect, it } from 'vitest';
import { nodeColours, sameColours } from '../../src/app/nodes.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { nodeColour } from '../../src/theme/nodes.ts';

describe('nodeColours', () => {
  it('gives colours in order of first appearance and leaves ground out (F5)', () => {
    const colours = nodeColours(parseNetlist('* F5\nItest 0 a 1\nVx a x 0\nR2 x n1 2\nR1 n1 0 4\nF1 0 n1 Vx 2\n.op\n.end\n'));
    expect([...colours.keys()]).toEqual(['a', 'x', 'n1']);
    expect(colours.get('a')).toBe(nodeColour(0));
    expect(colours.get('x')).toBe(nodeColour(1));
    expect(colours.get('n1')).toBe(nodeColour(2));
    expect(colours.has('0')).toBe(false);
  });

  it('gnd as ground is left out; gnd as the last word of a line is an ordinary node and gets a colour', () => {
    expect([...nodeColours(parseNetlist('* t\nV1 a gnd 6\nR1 a 0 2\n.op\n.end\n')).keys()]).toEqual(['a']);
    // ngspice keeps "Vx b gnd" as a node called gnd (docs/spice-facts W9): it needs telling apart.
    expect([...nodeColours(parseNetlist('* t\nV1 a 0 6\nR1 a b 2\nVx b gnd\n.op\n.end\n')).keys()]).toEqual(['a', 'b', 'gnd']);
  });

  it('names differing only in capital letters are one node (ngspice lower-cases them)', () => {
    expect([...nodeColours(parseNetlist('* t\nV1 N1 0 6\nR1 n1 0 2\n.op\n.end\n')).keys()]).toEqual(['n1']);
  });

  it('repeats the 8 colours after 8 nodes (the names are always written next to them)', () => {
    const parts = Array.from({ length: 10 }, (_, i) => `R${i + 1} n${i + 1} n${i + 2} 1k`).join('\n');
    const colours = nodeColours(parseNetlist(`* t\nV1 n1 0 1\n${parts}\nR0 n11 0 1k\n.op\n.end\n`));
    expect(colours.size).toBe(11);
    expect(colours.get('n9')).toBe(colours.get('n1'));
    expect(colours.get('n9')).toBe(nodeColour(8));
  });

  it('nodes only named in a dot command come last, in order', () => {
    const colours = nodeColours(parseNetlist('* t\nV1 s 0 24\nR1 s a 6\n.tf v(b) V1\n.end\n'));
    expect([...colours.keys()]).toEqual(['s', 'a', 'b']);
  });
});

describe('sameColours', () => {
  it('compares maps by content', () => {
    const a = new Map([['a', '1'], ['b', '2']]);
    expect(sameColours(a, new Map([['a', '1'], ['b', '2']]))).toBe(true);
    expect(sameColours(a, new Map([['a', '1']]))).toBe(false);
    expect(sameColours(a, new Map([['a', '1'], ['b', '3']]))).toBe(false);
  });
});
