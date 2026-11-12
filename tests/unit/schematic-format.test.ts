/**
 * src/schematic/format.ts and the reconciling in schematic.ts: the drawing lines inside a netlist
 * (read, written, kept in step when the text changes), and drawings that are only partly given.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COORD_LIMIT,
  DRAWING_HEADER,
  MAX_DRAWING_LINES,
  MAX_WIRE_LENGTH,
  MAX_WIRE_POINTS,
  NEW_TITLE,
  applyChanges,
  applyEdit,
  buildSchematic,
  drawingBlockChanges,
  findOverlaps,
  parseDrawingLines,
  readDrawing,
  schematicConnectivity,
  segmentCrossesBox,
  segmentsOf,
  serializeDrawing,
  stripDrawing,
  type Schematic,
} from '../../src/schematic/index.ts';
import { NOTEBOOK_OPTIONS } from '../../src/notebook/schematic.ts';
import { TURN_LIMITS, turnedQuarter } from '../../src/notebook/turn.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { groundRowsAndWave } from './schematic-hostile.ts';

const DIVIDER = '* divider\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n';

/** The netlist with its laid-out drawing written in. */
function withDrawing(text: string): string {
  const s = buildSchematic(text);
  return applyChanges(text, drawingBlockChanges(s.netlist, serializeDrawing(s.circuit, s.drawing)));
}

const lines = (...texts: string[]) => texts.map((text, i) => ({ text, line: i + 10 }));

describe('reading drawing lines', () => {
  it('reads parts, the part form, ground symbols, wires and labels', () => {
    const d = parseDrawingLines(
      lines(DRAWING_HEADER, '*@ V1 0 3 0 m', '*@ R1 4 0 270', '*@ part Ground 8 3 90', '*@ ground 0 6 0', '*@ ground 2 6', '*@ wire 0,1 0,0 -2,0', '*@ label OUT 7 0'),
    );
    expect([...d.parts.entries()].map(([k, p]) => [k, p.name, p.at, p.rot, p.mirror])).toEqual([
      ['v1', 'V1', { x: 0, y: 3 }, 0, true],
      ['r1', 'R1', { x: 4, y: 0 }, 270, false],
      ['ground', 'Ground', { x: 8, y: 3 }, 90, false],
    ]);
    expect(d.grounds).toEqual([
      { at: { x: 0, y: 6 }, rot: 0 },
      { at: { x: 2, y: 6 }, rot: 0 },
    ]);
    expect(d.wires).toEqual([[{ x: 0, y: 1 }, { x: 0, y: 0 }, { x: -2, y: 0 }]]);
    expect(d.labels).toEqual([{ node: 'out', at: { x: 7, y: 0 }, line: 17, text: '*@ label OUT 7 0' }]);
    expect(d.problems).toEqual([]);
    expect(d.unreadable).toEqual([]);
  });

  it('keeps lines it cannot read, as written, and says which', () => {
    const d = parseDrawingLines(lines(DRAWING_HEADER, '*@ R1 4 0 45', '*@ wire 0,0', '*@ foo', '*@', '*@ R2 1 2 0 x', '*@ R3 1.5 2 0'));
    expect(d.unreadable.map((u) => u.text)).toEqual(['*@ R1 4 0 45', '*@ wire 0,0', '*@ foo', '*@', '*@ R2 1 2 0 x', '*@ R3 1.5 2 0']);
    expect(d.problems.map((p) => [p.kind, p.line])).toEqual([
      ['unreadable-line', 11],
      ['unreadable-line', 12],
      ['unreadable-line', 13],
      ['unreadable-line', 14],
      ['unreadable-line', 15],
      ['unreadable-line', 16],
    ]);
    expect(d.parts.size).toBe(0);
  });

  it('reports a second position for one part, a missing header and another version', () => {
    const dup = parseDrawingLines(lines('*@ R1 0 0 0', '*@ r1 4 4 0'));
    expect(dup.parts.get('r1')!.at).toEqual({ x: 0, y: 0 });
    expect(dup.problems.map((p) => p.kind)).toEqual(['no-header', 'duplicate-position']);
    expect(dup.unreadable.map((u) => u.text)).toEqual(['*@ r1 4 4 0']);
    // Another version's lines belong to it, header included: kept where they are, not used.
    const v2 = parseDrawingLines(lines('* plainspice-drawing v2', '*@ R1 0 0 0'));
    expect(v2.parts.size).toBe(0);
    expect(v2.problems.map((p) => p.kind)).toEqual(['unknown-version']);
    expect(v2.unreadable).toEqual([]);
    expect(v2.foreign.map((u) => u.text)).toEqual(['* plainspice-drawing v2', '*@ R1 0 0 0']);
  });

  it('finds the lines in a netlist (never the title) and knows they are comments', () => {
    const text = '*@ R1 9 9 0\nV1 a 0 1\nR1 a 0 1\n* plainspice-drawing v1\n*@ R1 2 2 90\n.end\n';
    const n = parseNetlist(text);
    const d = readDrawing(n);
    expect(d.lineIndexes).toEqual([3, 4]);
    expect(d.parts.get('r1')!.at).toEqual({ x: 2, y: 2 });
    for (const i of d.lineIndexes) expect(n.lines[i]!.kind).toBe('comment');
  });
});

describe('writing drawing lines', () => {
  it('writes the header, parts in netlist order, then grounds, wires, labels and kept lines', () => {
    const s = buildSchematic(DIVIDER);
    const out = serializeDrawing(s.circuit, s.drawing, ['*@ R9 1 1 0']);
    expect(out[0]).toBe(DRAWING_HEADER);
    expect(out.slice(1, 4)).toEqual(['*@ V1 0 3 0 m', '*@ R1 4 0 270', '*@ R2 7 3 0']);
    expect(out[4]).toMatch(/^\*@ ground /);
    expect(out.filter((l) => l.startsWith('*@ wire')).length).toBe(s.drawing.wires.length);
    expect(out.slice(-3)).toEqual(['*@ label in 0 0', '*@ label out 7 0', '*@ R9 1 1 0']);
  });

  it('writes a part named like a keyword with the part form', () => {
    const s = buildSchematic('* t\nV1 a 0 1\nGround a 0 b 0 1\nLabel b 0 1m\n.op\n.end\n');
    const out = serializeDrawing(s.circuit, s.drawing);
    expect(out.some((l) => l.startsWith('*@ part Ground '))).toBe(true);
    expect(out.some((l) => l.startsWith('*@ part Label '))).toBe(true);
    const again = buildSchematic(applyChanges(s.netlist.text, drawingBlockChanges(s.netlist, out)));
    expect(again.origin).toBe('given');
    expect(again.drawing.parts).toEqual(s.drawing.parts);
  });

  it('puts a new block just before .end, replaces an old one in place, and changes nothing when it is the same', () => {
    const text = withDrawing(DIVIDER);
    expect(text.startsWith('* divider\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n* plainspice-drawing v1\n*@ V1 0 3 0 m\n')).toBe(true);
    expect(text.endsWith('\n.end\n')).toBe(true);
    const s = buildSchematic(text);
    expect(drawingBlockChanges(s.netlist, serializeDrawing(s.circuit, s.drawing))).toEqual([]);
    const moved = serializeDrawing(s.circuit, s.drawing).map((l) => (l === '*@ R2 7 3 0' ? '*@ R2 8 3 0' : l));
    const changes = drawingBlockChanges(s.netlist, moved);
    expect(changes).toHaveLength(1);
    expect(applyChanges(text, changes)).toBe(text.replace('*@ R2 7 3 0', '*@ R2 8 3 0'));
  });

  it('appends the block when there is no .end, keeps CRLF line ends, and gathers scattered lines into one block', () => {
    const noEnd = '* t\nV1 a 0 1\nR1 a 0 1\n.op';
    const s1 = buildSchematic(noEnd);
    const t1 = applyChanges(noEnd, drawingBlockChanges(s1.netlist, serializeDrawing(s1.circuit, s1.drawing)));
    expect(t1.startsWith(`${noEnd}\n${DRAWING_HEADER}\n`)).toBe(true);
    const crlf = DIVIDER.replace(/\n/g, '\r\n');
    const t2 = withDrawing(crlf);
    expect(t2.includes('\n') && t2.split('\n').slice(0, -1).every((l) => l.endsWith('\r'))).toBe(true);
    const scattered = '* t\n*@ V1 0 3 0\nV1 a 0 1\n*@ R1 4 3 0\nR1 a 0 1\n.op\n.end\n';
    const s3 = buildSchematic(scattered);
    const t3 = applyChanges(scattered, drawingBlockChanges(s3.netlist, serializeDrawing(s3.circuit, s3.drawing)));
    expect(t3.split('\n').slice(1, 3)).toEqual([DRAWING_HEADER, '*@ V1 0 3 0']);
    expect(t3).toContain('V1 a 0 1\nR1 a 0 1\n.op\n.end\n');
  });

  it('removes the lines for keeping the drawing somewhere else', () => {
    expect(stripDrawing(withDrawing(DIVIDER))).toBe(DIVIDER);
  });
});

describe('the drawing stays in step with the text', () => {
  const given = withDrawing(DIVIDER);
  const rebuild = (text: string): Schematic => buildSchematic(text);

  it('reads its own drawing back exactly, with nothing to repair', () => {
    const s = rebuild(given);
    const first = buildSchematic(DIVIDER);
    expect(s.origin).toBe('given');
    expect(s.problems).toEqual([]);
    expect(s.drawing).toEqual(first.drawing);
    expect(serializeDrawing(s.circuit, s.drawing)).toEqual(serializeDrawing(first.circuit, first.drawing));
  });

  it('keeps every position when a value or a node name changes in the text', () => {
    const s = rebuild(given.replace('R1 in out 1k', 'R1 in out 4.7k').replace(/\bout\b/g, 'vout'));
    expect(s.origin).toBe('given');
    expect(s.drawing.parts).toEqual(rebuild(given).drawing.parts);
    expect(s.drawing.labels.map((l) => l.node).sort()).toEqual(['in', 'vout']);
    expect(schematicConnectivity(s)).toEqual([]);
  });

  it('frees a pin whose node changed: R2 out 0 becomes R2 out n7', () => {
    const s = rebuild(given.replace('R2 out 0 2k', 'R2 out n7 2k'));
    expect(schematicConnectivity(s)).toEqual([]);
    expect(s.drawing.parts).toEqual(rebuild(given).drawing.parts);
    expect(s.scene.terminals.map((t) => t.node)).toEqual(['n7']);
    expect(s.problems.map((p) => p.kind)).toContain('wires-redrawn');
  });

  it('wires up a part added in the text next to its nodes, keeping the others', () => {
    const s = rebuild(given.replace('.op', 'R3 out 0 3k\n.op'));
    expect(s.origin).toBe('partial');
    expect(s.problems.map((p) => p.kind)).toEqual(['placed-part', 'wires-redrawn']);
    for (const k of ['v1', 'r1', 'r2']) expect(s.drawing.parts.get(k)).toEqual(rebuild(given).drawing.parts.get(k));
    expect(schematicConnectivity(s)).toEqual([]);
  });

  it('removes the wires of a part deleted in the text, and keeps its position line as written until the drawing changes', () => {
    const s = rebuild(given.replace('R2 out 0 2k\n', ''));
    expect(schematicConnectivity(s)).toEqual([]);
    expect(s.kept).toEqual([]);
    expect(s.orphans).toEqual(['*@ R2 7 3 0']);
    expect(s.problems.map((p) => p.kind)).toContain('unknown-part');
    // out now has one pin: an open terminal.
    expect(s.scene.terminals.map((t) => t.node)).toEqual(['out']);
  });

  it('moves the position to a renamed part', () => {
    const s = rebuild(given.replace('R2 out 0 2k', 'Rload out 0 2k'));
    expect(s.drawing.parts.get('rload')).toEqual(rebuild(given).drawing.parts.get('r2'));
    expect(s.problems.map((p) => p.kind)).toEqual(['renamed-part']);
    expect(s.kept).toEqual([]);
  });

  it('lays out only the parts a partial drawing leaves out', () => {
    const text = DIVIDER.replace('.end', '* plainspice-drawing v1\n*@ V1 -5 10 0\n.end');
    const s = rebuild(text);
    expect(s.origin).toBe('partial');
    expect(s.drawing.parts.get('v1')).toEqual({ at: { x: -5, y: 10 }, rot: 0, mirror: false });
    expect(s.drawing.parts.size).toBe(3);
    expect(schematicConnectivity(s)).toEqual([]);
  });

  it('cuts a wire that joins two nodes, and drops a label on the wrong node', () => {
    const text = DIVIDER.replace(
      '.end',
      ['* plainspice-drawing v1', '*@ V1 0 3 0', '*@ R1 4 0 270', '*@ R2 7 3 0', '*@ ground 0 6 0', '*@ wire 0,1 0,0 2,0', '*@ wire 6,0 7,0 7,1', '*@ wire 0,5 0,6 7,6 7,5', '*@ wire 2,0 6,0', '*@ label out 0 0', '.end'].join('\n'),
    );
    const s = rebuild(text);
    expect(schematicConnectivity(s)).toEqual([]);
    expect(s.problems.map((p) => p.kind).sort()).toEqual(['label-dropped', 'wires-redrawn']);
  });

  it('adds a ground symbol to a circuit with ground whose drawing has none', () => {
    const text = DIVIDER.replace('.end', ['* plainspice-drawing v1', '*@ V1 0 3 0', '*@ R1 4 0 270', '*@ R2 7 3 0', '.end'].join('\n'));
    const s = rebuild(text);
    expect(s.drawing.grounds).toHaveLength(1);
    expect(s.problems.map((p) => p.kind)).toContain('ground-added');
    expect(schematicConnectivity(s)).toEqual([]);
  });

  it('keeps a slanted wire, which connects only at its ends', () => {
    const text = DIVIDER.replace('.end', ['* plainspice-drawing v1', '*@ V1 0 3 0', '*@ R1 4 0 270', '*@ R2 7 3 0', '*@ ground 0 6 0', '*@ wire 0,1 2,0', '.end'].join('\n'));
    const s = rebuild(text);
    expect(s.problems.map((p) => p.kind)).toContain('slanted-wire');
    expect(s.drawing.wires.some((w) => w.length === 2 && w[0]!.x !== w[1]!.x && w[0]!.y !== w[1]!.y)).toBe(true);
    expect(schematicConnectivity(s)).toEqual([]);
  });

  it('reads drawing lines kept outside the netlist instead of its own', () => {
    const outside = parseDrawingLines(lines(DRAWING_HEADER, '*@ V1 1 1 0', '*@ R1 5 -2 270', '*@ R2 8 1 0'));
    const s = buildSchematic(withDrawing(DIVIDER), { lines: outside });
    expect(s.drawing.parts.get('v1')!.at).toEqual({ x: 1, y: 1 });
    expect(schematicConnectivity(s)).toEqual([]);
  });
});

const root = resolve(import.meta.dirname, '../..');
const allNetlists = (): string[] => {
  const out: string[] = [];
  for (const d of readdirSync(join(root, 'examples'), { withFileTypes: true })) {
    if (d.isDirectory()) for (const f of readdirSync(join(root, 'examples', d.name)).sort()) if (f.endsWith('.cir')) out.push(join('examples', d.name, f));
  }
  for (const dir of ['tests/fixtures', 'tests/corpus/letters', 'tests/corpus/traps']) for (const f of readdirSync(join(root, dir)).sort()) if (f.endsWith('.cir')) out.push(join(dir, f));
  return out;
};

describe('limits: a drawing line can never make the drawing slow or fail', () => {
  const base = '* divider\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n* plainspice-drawing v1\n*@ V1 0 3 0 m\n*@ R1 4 0 270\n';

  it(`keeps a coordinate beyond ±${COORD_LIMIT} as written, unused`, () => {
    for (const far of ['*@ R2 100000 100000 0', '*@ R2 3000 3000 0', '*@ R2 7 30000 0', '*@ R2 1000000000 0 0', '*@ wire 0,0 100000000,0', '*@ ground 5000 0', '*@ label out 0 -2001']) {
      const t0 = performance.now();
      const s = buildSchematic(`${base}${far}\n.end\n`);
      expect(performance.now() - t0).toBeLessThan(500);
      expect(s.kept).toContain(far);
      expect(s.problems.some((p) => p.kind === 'out-of-range' || p.kind === 'unreadable-line')).toBe(true);
      expect(schematicConnectivity(s)).toEqual([]);
      expect(Math.max(Math.abs(s.scene.bounds.x1), Math.abs(s.scene.bounds.y1))).toBeLessThan(100);
    }
  });

  it(`reads at most ${MAX_DRAWING_LINES} lines and a bounded length of wire, quickly`, () => {
    const wires = Array.from({ length: 5000 }, (_, i) => `*@ wire ${10 + (i % 1500)},6 ${10 + (i % 1500)},${8 + (i % 7)}`);
    const t0 = performance.now();
    const s = buildSchematic(`${base}*@ R2 7 3 0\n*@ ground 0 6 0\n*@ wire 0,6 1600,6\n${wires.join('\n')}\n.end\n`);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(s.problems.map((p) => p.kind)).toContain('too-many-lines');
    expect(schematicConnectivity(s)).toEqual([]);
    const long = parseDrawingLines(lines(DRAWING_HEADER, ...Array.from({ length: 12 }, () => '*@ wire -2000,0 2000,0')));
    expect(long.wires.length).toBe(MAX_WIRE_LENGTH / 4000);
  });

  it('never throws and never takes long on garbage drawing lines (fuzz)', () => {
    let seed = 7;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const words = ['R1', 'R2', 'V1', 'part', 'ground', 'wire', 'label', 'out', 'in', '0', 'm', 'x', '-0', '+3', '99999999999', '1e5', '2,3', '-5,7', 'side=left', 'side=', '=', 'k=v', '90', '45', '', '*@', '\t'];
    for (let i = 0; i < 300; i++) {
      const lines = Array.from({ length: 1 + rnd(12) }, () => `*@ ${Array.from({ length: rnd(7) }, () => words[rnd(words.length)]).join(' ')}`);
      const text = `* fuzz\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n${rnd(3) ? DRAWING_HEADER : '* plainspice-drawing v9'}\n${lines.join('\n')}\n.end\n`;
      const t0 = performance.now();
      let s: Schematic | undefined;
      expect(() => (s = buildSchematic(text)), text).not.toThrow();
      expect(performance.now() - t0, text).toBeLessThan(1000);
      expect(schematicConnectivity(s!), text).toEqual([]);
    }
  });
});

/**
 * security:F1: wire drawn over wire (a share link may repeat one piece two thousand times), slanted
 * wire, and long chains of wire hanging from one pin, each at the format's limits, with the Notebook
 * look's options (what the app builds). Each is built first at 100 lines, then at the limit: the work
 * grows with the lines, never with their square (it took minutes before).
 */
describe('limits: wire over wire, slanted wire and long chains build quickly (security:F1)', () => {
  const head = '* divider\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n* plainspice-drawing v1\n*@ V1 0 3 0 m\n*@ R1 4 0 270\n*@ R2 7 3 0\n';
  /** At most MAX_DRAWING_LINES with the three position lines. */
  const MOST = MAX_DRAWING_LINES - 3;
  const build = (wireLines: readonly string[]): { s: Schematic; ms: number } => {
    const t0 = performance.now();
    const s = buildSchematic(`${head}${wireLines.join('\n')}\n.end\n`, NOTEBOOK_OPTIONS);
    return { s, ms: performance.now() - t0 };
  };
  /** Builds 100 lines, then `count`: both quick, and the drawing still connects what the netlist does. */
  const quick = (make: (count: number) => string[], count: number): Schematic => {
    const small = build(make(100));
    // Limits ten times what this takes here, for slow or busy machines: before, 100 lines took 2 to
    // 8 seconds and the limit 15 seconds to minutes.
    expect(small.ms, 'at 100 lines').toBeLessThan(1000);
    const { s, ms } = build(make(count));
    expect(ms, `at ${count} lines`).toBeLessThan(5000);
    expect(s.problems.map((p) => p.kind)).not.toContain('too-many-lines');
    expect(schematicConnectivity(s)).toEqual([]);
    return s;
  };
  /** The wires the circuit needs (V1 to R1, R1 to R2, ground), and none of the hostile ones. */
  const onlyTheCircuit = (s: Schematic): void => {
    const length = s.drawing.wires.flatMap((w) => w.slice(1).map((p, i) => Math.abs(p.x - w[i]!.x) + Math.abs(p.y - w[i]!.y))).reduce((a, b) => a + b, 0);
    expect(length).toBeLessThan(20);
  };
  /** A chain from R2's ground pin (7,5): along x and back in bands three rows apart, a square wave (or a zigzag of slanted pieces), lines of ten points each continuing the last. */
  const chain = (slanted: boolean) => (count: number): string[] => {
    const pts: [number, number][] = [[7, 5]];
    let used = 0;
    let [x, y, dir, band, up] = [7, 5, 1, 0, false];
    while (pts.length < MAX_WIRE_POINTS && pts.length < count * 9 + 1) {
      let [nx, ny] = [x, y];
      if (slanted || pts.length % 2 === 1) nx = x + dir;
      if (slanted || pts.length % 2 === 0) [ny, up] = [up ? y - 1 : y + 1, !up];
      if (nx > COORD_LIMIT - 10 || nx < 7) [nx, ny, dir, band, up] = [x, 5 + 3 * (band + 1), -dir, band + 1, false];
      const step = Math.abs(nx - x) + Math.abs(ny - y);
      if (used + step > MAX_WIRE_LENGTH) break;
      [used, x, y] = [used + step, nx, ny];
      pts.push([x, y]);
    }
    const out: string[] = [];
    for (let i = 0; i + 1 < pts.length && out.length < count; i += 9) out.push(`*@ wire ${pts.slice(i, i + 10).map(([a, b]) => `${a},${b}`).join(' ')}`);
    return out;
  };

  it(`draws ${MOST} lines of one piece of wire drawn back and forth over itself, as one piece that leads nowhere`, () => {
    const s = quick((n) => Array.from({ length: n }, () => '*@ wire 7,5 8,5 7,5 8,5 7,5 8,5 7,5 8,5 7,5 8,5'), MOST);
    // The piece hangs from R2's ground pin and leads nowhere, so it goes (no stub right of R2).
    onlyTheCircuit(s);
  });

  it(`draws ${MOST} lines of slanted wire drawn back and forth over itself (as many as the wire's length allows)`, () => {
    const s = quick((n) => Array.from({ length: n }, () => '*@ wire 7,5 8,6 7,5 8,6 7,5 8,6 7,5 8,6 7,5 8,6'), MOST);
    expect(s.problems.map((p) => p.kind)).toContain('slanted-wire');
    onlyTheCircuit(s);
  });

  it(`draws ${MOST} straight pieces lying over each other, from one pin`, () => {
    const s = quick((n) => Array.from({ length: n }, (_, i) => `*@ wire 7,5 ${8 + (i % 9)},5`), MOST);
    onlyTheCircuit(s);
  });

  it('draws 1111 slanted zigzags all over the page (the most the wire length allows)', () => {
    const zigzags = (n: number): string[] =>
      Array.from({ length: n }, (_, i) => {
        const [x0, y] = [-1900 + (i % 190) * 20, -1900 + Math.floor(i / 190) * 4];
        return `*@ wire ${Array.from({ length: 10 }, (_, k) => `${x0 + k},${y + (k % 2)}`).join(' ')}`;
      });
    expect(zigzags(1111).join('').length).toBeGreaterThan(0);
    const s = quick(zigzags, 1111);
    onlyTheCircuit(s);
  });

  it('cuts away a staircase of wire hanging from one pin, at the limit of wire points', () => {
    const lines = chain(false)(MOST);
    expect(lines.length).toBe(MOST);
    const s = quick(chain(false), MOST);
    onlyTheCircuit(s);
  });

  it('cuts away a chain of slanted wire hanging from one pin, at the limit of wire length', () => {
    const lines = chain(true)(MOST);
    const length = lines.flatMap((l) => l.split(' ').slice(2)).length;
    expect(length).toBeGreaterThan(MAX_WIRE_LENGTH / 2 - 10);
    const s = quick(chain(true), MOST);
    onlyTheCircuit(s);
  });

  it('builds a drawing with a wire through every point of ground\'s wire, beside a 9,900-piece wave, its ground symbol clear of wire; the phone does not try to turn it (critic of the fix round)', () => {
    const text = groundRowsAndWave(25, 199, 9900);
    expect(text.length).toBeGreaterThan(100_000);
    const { s, ms } = (() => {
      const t0 = performance.now();
      const built = buildSchematic(text, NOTEBOOK_OPTIONS);
      return { s: built, ms: performance.now() - t0 };
    })();
    // Inside the format's limits: every line is read and used.
    expect(s.problems.map((p) => p.kind)).not.toContain('too-many-lines');
    expect(s.kept).toEqual([]);
    expect(s.drawing.wires.reduce((n, w) => n + w.length - 1, 0)).toBeGreaterThan(9900);
    // About half a second here, cold (4 to 6 s before, the ground search 2.4 s of it); the limit allows
    // for a busy machine, so it is no guard on the search itself: schematic-ground-search.test.ts counts
    // the search's work, which does not depend on the machine.
    expect(ms).toBeLessThan(5000);
    // No point of ground's wire is clear, so the symbol hangs on a one-unit lead below its lowest end,
    // with no wire through it, and the drawing connects what the netlist connects.
    expect(s.problems.map((p) => p.kind)).toContain('ground-added');
    expect(s.drawing.grounds).toEqual([{ at: { x: 0, y: 25 }, rot: 0 }]);
    const [ground] = s.scene.grounds;
    for (const w of s.drawing.wires) for (const [a, b] of segmentsOf(w)) expect(segmentCrossesBox(a, b, ground!.box)).toBe(false);
    expect(schematicConnectivity(s)).toEqual([]);
    // Far beyond what a phone can show turned: it is shown as drawn, at once (before: 5 s here, to find
    // no clean turn).
    const t1 = performance.now();
    expect(turnedQuarter(s)).toBeUndefined();
    expect(performance.now() - t1).toBeLessThan(1000);
  });

  it('turns a drawing just inside the phone\'s limits quickly, and none beyond them', () => {
    // 900 pieces of wire, a ground line drawn through every place for its symbol: four tries at most.
    const near = buildSchematic(groundRowsAndWave(3, 30, 900), NOTEBOOK_OPTIONS);
    const pieces = near.drawing.wires.reduce((n, w) => n + w.length - 1, 0);
    expect(pieces).toBeLessThanOrEqual(TURN_LIMITS.wirePieces);
    const t0 = performance.now();
    turnedQuarter(near);
    // About 0.1 s here.
    expect(performance.now() - t0).toBeLessThan(2000);
    // One part or one piece of wire beyond: not tried.
    const parts = Array.from({ length: TURN_LIMITS.parts + 1 }, (_, i) => `R${i + 1} a${i} a${i + 1} 1k`);
    const many = buildSchematic(`* many parts\n${parts.join('\n')}\n.op\n.end\n`, NOTEBOOK_OPTIONS);
    expect(many.scene.parts.length).toBe(TURN_LIMITS.parts + 1);
    expect(turnedQuarter(many)).toBeUndefined();
    const wavy = buildSchematic(groundRowsAndWave(3, 30, TURN_LIMITS.wirePieces + 200), NOTEBOOK_OPTIONS);
    expect(wavy.drawing.wires.reduce((n, w) => n + w.length - 1, 0)).toBeGreaterThan(TURN_LIMITS.wirePieces);
    expect(turnedQuarter(wavy)).toBeUndefined();
  });

  it('writes a drawing that reads back the same, even where a cut left one slanted wire on another', () => {
    // The longer wire leads nowhere and is cut back onto the shorter one; the shorter then leads nowhere too.
    const s = buildSchematic(`${head}*@ wire 7,5 18,6\n*@ wire 7,5 29,7\n.end\n`, NOTEBOOK_OPTIONS);
    const written = serializeDrawing(s.circuit, s.drawing);
    const again = buildSchematic(`${head.slice(0, head.indexOf('* plainspice-drawing'))}${written.join('\n')}\n.end\n`, NOTEBOOK_OPTIONS);
    expect(serializeDrawing(again.circuit, again.drawing)).toEqual(written);
    expect(written.some((l) => l.includes('18,6') || l.includes('29,7'))).toBe(false);
  });
});

describe('fields and versions', () => {
  it('reads side= on parts and labels, ignores fields it does not know, and refuses a plain word after a field', () => {
    const d = parseDrawingLines(lines(DRAWING_HEADER, '*@ R1 4 0 270 side=below', '*@ V1 0 3 0 m colour=red', '*@ label out 7 0 side=below-left', '*@ R2 7 3 0 side=left m', '*@ R3 1 1 0 side=sideways'));
    expect(d.parts.get('r1')!.side).toBe('below');
    expect(d.parts.get('v1')).toMatchObject({ mirror: true });
    expect(d.parts.get('v1')!.side).toBeUndefined();
    expect(d.labels[0]!.side).toBe('below-left');
    expect(d.parts.has('r2')).toBe(false);
    expect(d.parts.get('r3')!.side).toBeUndefined();
    expect(d.problems.map((p) => [p.kind, p.line])).toEqual([
      ['unknown-field', 12],
      ['unreadable-line', 14],
      ['unknown-field', 15],
    ]);
  });

  it('reads a header without a version as version 1', () => {
    const d = parseDrawingLines(lines('* plainspice-drawing', '*@ R1 4 0 270'));
    expect(d.parts.get('r1')!.at).toEqual({ x: 4, y: 0 });
    expect(d.problems.map((p) => p.kind)).toEqual(['no-header']);
  });

  it("keeps another version's block where it is when the drawing is written or removed", () => {
    const text = withDrawing(DIVIDER).replace('.end', '* plainspice-drawing v2\n*@ R1 9 9 0\n.end');
    const s = buildSchematic(text);
    expect(s.drawing.parts.get('r1')!.at).toEqual({ x: 4, y: 0 });
    const moved = serializeDrawing(s.circuit, s.drawing).map((l) => (l === '*@ R2 7 3 0' ? '*@ R2 8 3 0' : l));
    expect(applyChanges(text, drawingBlockChanges(s.netlist, moved))).toBe(text.replace('*@ R2 7 3 0', '*@ R2 8 3 0'));
    expect(stripDrawing(text)).toBe(DIVIDER);
  });

  it('writes a new block after a title line when the text is empty', () => {
    expect(applyChanges('', drawingBlockChanges(parseNetlist(''), [DRAWING_HEADER]))).toBe(`${NEW_TITLE}\n${DRAWING_HEADER}\n`);
  });
});

describe('every netlist round-trips through its drawing lines', () => {
  it.each(allNetlists())('%s', (path) => {
    // The netlist as typed, without the drawing lines an example carries to open drawn as in its video.
    const text = stripDrawing(readFileSync(join(root, path), 'utf8'));
    const first = buildSchematic(text);
    const written = applyChanges(text, drawingBlockChanges(first.netlist, serializeDrawing(first.circuit, first.drawing)));
    const again = buildSchematic(written);
    expect(again.origin).toBe(first.circuit.parts.length ? 'given' : 'auto');
    expect(again.problems).toEqual([]);
    expect(again.drawing).toEqual(first.drawing);
    expect(stripDrawing(written)).toBe(text);
  });
});

describe('labels and positions after the text changes', () => {
  it('a label of a node renamed in the text names the new node, where it was', () => {
    const moved = applyEdit(buildSchematic(withDrawing(DIVIDER)), { kind: 'move-label', node: 'out', to: { x: 7, y: 1 } }).text;
    const s = buildSchematic(moved.replace('R1 in out 1k', 'R1 in vout 1k').replace('R2 out 0 2k', 'R2 vout 0 2k'));
    expect(s.drawing.labels.find((l) => l.node === 'vout')!.at).toEqual({ x: 7, y: 1 });
    expect(s.problems.map((p) => p.kind)).toEqual(['label-renamed']);
  });

  it('a label of a node the netlist does not have is kept as written until the drawing changes', () => {
    const s = buildSchematic(withDrawing(DIVIDER).replace('*@ label out 7 0', '*@ label out 7 0\n*@ label nowhere 30 30'));
    expect(s.orphans).toEqual(['*@ label nowhere 30 30']);
    expect(s.problems.map((p) => p.kind)).toEqual(['unknown-label']);
  });

  it("does not hand a deleted part's position to a new part when something else stands there now", () => {
    const text = [
      '* divider', 'V1 in 0 6', 'R1 in out 1k', 'R2 out 0 2k', 'R7 in 0 5k', '.op',
      '* plainspice-drawing v1', '*@ V1 0 3 0 m', '*@ R1 4 0 270', '*@ R2 13 3 0', '*@ ground 0 6 0',
      '*@ wire 0,1 0,0 2,0', '*@ wire 6,0 13,0 13,1', '*@ wire 0,5 0,6 13,6 13,5', '*@ label in 0 0', '*@ label out 13 0',
      '*@ R3 13 3 90', '.end', '',
    ].join('\n');
    const s = buildSchematic(text);
    expect(s.drawing.parts.get('r7')).not.toEqual({ at: { x: 13, y: 3 }, rot: 90, mirror: false });
    expect(findOverlaps(s.scene)).toEqual([]);
    expect(s.orphans).toEqual(['*@ R3 13 3 90']);
  });
});

describe('drawings that give only some positions', () => {
  it('uses the whole layout, shifted, when the given positions agree with it', () => {
    const p = stripDrawing(readFileSync(join(root, 'examples/p01/p01-2-supernode.cir'), 'utf8'));
    const auto = buildSchematic(p);
    const vs = auto.drawing.parts.get('vs')!;
    const s = buildSchematic(p.replace('.end', `* plainspice-drawing v1\n*@ Vs ${vs.at.x + 16} ${vs.at.y - 4} ${vs.rot}\n.end`));
    expect(s.origin).toBe('partial');
    expect(s.drawing.parts.get('vs')!.at).toEqual({ x: vs.at.x + 16, y: vs.at.y - 4 });
    for (const [key, q] of auto.drawing.parts) expect(s.drawing.parts.get(key)!.at).toEqual({ x: q.at.x + 16, y: q.at.y - 4 });
    expect(findOverlaps(s.scene)).toEqual([]);
  });

  it('lays out three or more missing parts together beside the given ones, cleanly', () => {
    const p = stripDrawing(readFileSync(join(root, 'examples/e04/e04-4-open.cir'), 'utf8'));
    const s = buildSchematic(p.replace('.op', '.op\n* plainspice-drawing v1\n*@ Vin 0 3 0'));
    expect(s.drawing.parts.get('vin')).toEqual({ at: { x: 0, y: 3 }, rot: 0, mirror: false });
    expect(schematicConnectivity(s)).toEqual([]);
    expect(findOverlaps(s.scene)).toEqual([]);
    expect(s.problems.map((p) => p.kind)).not.toContain('connected-by-name');
    // The group's top rail starts at s, the node it shares with Vin, level with the wire from Vin.
    expect(s.drawing.parts.get('vx')!.at.y).toBe(0);
    const typed = buildSchematic(withDrawing(DIVIDER).replace('.op', 'R3 out x 1k\nR4 x 0 1k\nC1 x 0 1u\n.op'));
    expect(schematicConnectivity(typed)).toEqual([]);
    expect(findOverlaps(typed.scene)).toEqual([]);
    expect(typed.drawing.parts.get('r3')!.at.y).toBe(0);
  });
});
