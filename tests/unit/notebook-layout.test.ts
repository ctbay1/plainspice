/**
 * The Notebook look on every circuit PlainSpice ships: all 20 examples and the 10 fixtures lay out
 * with the Notebook's fonts and result lines (NOTEBOOK_OPTIONS) with nothing overlapping and exactly
 * the netlist's connections; the drawing block written into the netlist reads back to the same
 * drawing; and a wide drawing turned for a phone (turn.ts) is just as clean. Also the schematic
 * model's addition for this look: SceneOptions.resultRoom.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTEBOOK_OPTIONS, drawingLineIndexes, isWide, notebookSchematic, notebookMeasure, turnedQuarter, wireBends, withDrawingBlock } from '../../src/notebook/index.ts';
import { INLINE_RESULT_GAP, TEXT, buildSchematic, checkConnectivity, findOverlaps, serializeDrawing, stripDrawing } from '../../src/schematic/index.ts';
import { nodeLabelLines } from '../../src/schematic/scene.ts';

const root = resolve(import.meta.dirname, '../..');
const manifest = JSON.parse(readFileSync(resolve(root, 'examples/examples.json'), 'utf8')) as { examples: { id: string; file: string }[] };
const CIRCUITS: { name: string; text: string }[] = [
  ...manifest.examples.map((e) => ({ name: e.id, text: readFileSync(resolve(root, 'examples', e.file), 'utf8') })),
  ...readdirSync(resolve(root, 'tests/fixtures'))
    .filter((f) => f.endsWith('.cir'))
    .map((f) => ({ name: f.slice(0, -4), text: readFileSync(resolve(root, 'tests/fixtures', f), 'utf8') })),
];

const clean = (s: ReturnType<typeof notebookSchematic>): string[] => [
  ...findOverlaps(s.scene).map((o) => `${o.a.kind} ${o.a.id} overlaps ${o.b.kind} ${o.b.id}`),
  ...checkConnectivity(s.circuit, s.drawing)
    .filter((c) => c.kind !== 'hidden')
    .map((c) => c.message),
];

describe('every example and fixture in the Notebook look', () => {
  it('has the 20 examples and 10 fixtures', () => {
    expect(manifest.examples).toHaveLength(20);
    expect(CIRCUITS).toHaveLength(30);
  });

  it.each(CIRCUITS)('$name lays out with nothing overlapping and exactly the netlist’s connections', ({ text }) => {
    expect(clean(notebookSchematic(text))).toEqual([]);
  });

  it.each(CIRCUITS)('$name keeps its drawing when the block is written into the netlist', ({ text }) => {
    const auto = notebookSchematic(text);
    const written = withDrawingBlock(text, auto);
    const read = notebookSchematic(written);
    expect(read.origin).toBe('given');
    expect(serializeDrawing(read.circuit, read.drawing, read.kept)).toEqual(serializeDrawing(auto.circuit, auto.drawing, auto.kept));
    expect(clean(read)).toEqual([]);
    // The block goes in as one piece before .end: every other line keeps its number.
    const lines = drawingLineIndexes(read.netlist);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[lines.length - 1]! - lines[0]! + 1).toBe(lines.length);
    const block = /^(\*@|\* plainspice-drawing).*\n/gm;
    expect(written.replace(block, '')).toBe(text.replace(block, ''));
    // Written again, nothing changes.
    expect(withDrawingBlock(written)).toBe(written);
  });
});

describe('a wide drawing turned for a phone held upright', () => {
  // The checkpoint's circuits laid out automatically, as the checkpoint page shows them (the examples
  // themselves open drawn as in the video, less long and low: tests/unit/video-drawings.test.ts).
  it.each(['p02-4-open', 'p02-5-short', 'p02-3-dependent-only'])('%s turns clean, taller than wide', (id) => {
    const s = notebookSchematic(stripDrawing(readFileSync(resolve(root, `examples/p02/${id}.cir`), 'utf8')));
    expect(isWide(s)).toBe(true);
    const t = turnedQuarter(s);
    expect(t, 'turned').toBeDefined();
    expect(clean(t!)).toEqual([]);
    const b = t!.scene.bounds;
    expect(b.y1 - b.y0).toBeGreaterThan(b.x1 - b.x0);
    // Only the view turns: the circuit, the netlist and its drawing are the same.
    expect(t!.netlist).toBe(s.netlist);
    expect(t!.circuit).toBe(s.circuit);
    expect(s.scene.parts.map((p) => p.rot)).not.toEqual(t!.scene.parts.map((p) => p.rot));
  });

  it('is offered for circuits that turn clean (most do)', () => {
    let turned = 0;
    for (const c of CIRCUITS) {
      // Laid out automatically...
      const auto = turnedQuarter(notebookSchematic(stripDrawing(c.text)));
      if (auto) {
        turned += 1;
        expect(clean(auto), c.name).toEqual([]);
      }
      // ...and as the examples open (drawn as in their video).
      const drawn = turnedQuarter(notebookSchematic(c.text));
      if (drawn) expect(clean(drawn), c.name).toEqual([]);
    }
    // 25 of the 30 laid out automatically; the rest are shown as drawn (and a phone pans them).
    expect(turned).toBeGreaterThanOrEqual(25);
  });
});

describe('SceneOptions.resultRoom (the schematic model’s addition for the Notebook)', () => {
  const text = readFileSync(resolve(root, 'examples/p02/p02-4-open.cir'), 'utf8');

  it('keeps one result line of TEXT.resultChars by default, as before', () => {
    const s = buildSchematic(text);
    for (const p of s.scene.parts) expect(p.labels.filter((l) => l.role === 'result')).toHaveLength(1);
    const plain = buildSchematic(text, { resultRoom: () => [TEXT.resultChars] });
    expect(serializeDrawing(plain.circuit, plain.drawing)).toEqual(serializeDrawing(s.circuit, s.drawing));
  });

  it('keeps the lines a style asks for, each as wide as its sample', () => {
    const s = buildSchematic(text, { measure: notebookMeasure, resultRoom: (p) => (p.letter === 'R' ? [] : ['a much longer sample', 'x']) });
    const r1 = s.scene.parts.find((p) => p.key === 'r1')!;
    const g1 = s.scene.parts.find((p) => p.key === 'g1')!;
    expect(r1.labels.filter((l) => l.role === 'result')).toHaveLength(0);
    const g = g1.labels.filter((l) => l.role === 'result');
    expect(g).toHaveLength(2);
    expect(g[0]!.box.x1 - g[0]!.box.x0).toBeCloseTo(notebookMeasure('a much longer sample', 'result') + 0.1, 6);
    expect(g[1]!.box.x1 - g[1]!.box.x0).toBeCloseTo(notebookMeasure('x', 'result') + 0.1, 6);
    expect(findOverlaps(s.scene)).toEqual([]);
  });

  it('is what the Notebook uses', () => {
    expect(NOTEBOOK_OPTIONS.resultRoom).toBeDefined();
    expect(NOTEBOOK_OPTIONS.measure).toBe(notebookMeasure);
  });
});

describe('SceneOptions.nodeResultInline (the model’s addition for "s = 12 V")', () => {
  const sample = '= −888.8 mV';
  const spots = ['above-right', 'above-left', 'below-right', 'below-left', 'right', 'left', 'far-right', 'far-left'] as const;

  it.each(spots)('at %s: the name and the room for its result on one row, the result just after the name', (spot) => {
    const at = { x: 10, y: 5 };
    const plain = nodeLabelLines('n1', at, spot, true, [], notebookMeasure);
    const lines = nodeLabelLines('n1', at, spot, true, [], notebookMeasure, sample);
    const name = lines.find((l) => l.role === 'node')!;
    const result = lines.find((l) => l.role === 'result')!;
    expect(lines).toHaveLength(2);
    expect(result.y).toBe(name.y);
    expect(name.align).toBe('start');
    expect(result.align).toBe('start');
    expect(result.x).toBeCloseTo(name.x + notebookMeasure('n1', 'node') + INLINE_RESULT_GAP, 9);
    expect(result.box.x1 - result.box.x0).toBeCloseTo(notebookMeasure(sample, 'result') + 0.1, 9);
    // The name's row is where the name was without the option: on the same side of the point, as near the wire.
    const before = plain.find((l) => l.role === 'node')!;
    expect(name.y).toBeCloseTo(spot.startsWith('above') ? before.y : before.y, 9);
    const right = !spot.endsWith('left');
    if (right) expect(name.box.x0).toBeCloseTo(before.box.x0, 9);
    else expect(result.box.x1).toBeLessThanOrEqual(before.box.x1 + 1e-9);
  });

  it('keeps a hidden line ("to D1") on a row of its own, away from the wire', () => {
    const above = nodeLabelLines('n1', { x: 0, y: 0 }, 'above-right', true, ['D1'], notebookMeasure, sample);
    const below = nodeLabelLines('n1', { x: 0, y: 0 }, 'below-right', true, ['D1'], notebookMeasure, sample);
    const y = (ls: typeof above, role: string): number => ls.find((l) => l.role === role)!.y;
    expect(y(above, 'hidden')).toBeLessThan(y(above, 'node'));
    expect(y(below, 'hidden')).toBeGreaterThan(y(below, 'node'));
    expect(y(above, 'result')).toBe(y(above, 'node'));
  });

  it('changes nothing without the option, and nothing when results are off', () => {
    const text = readFileSync(resolve(root, 'examples/p02/p02-4-open.cir'), 'utf8');
    const s = buildSchematic(text, { measure: notebookMeasure });
    for (const l of s.scene.nodeLabels) expect(new Set(l.lines.map((x) => x.y)).size).toBe(l.lines.length);
    expect(nodeLabelLines('n1', { x: 0, y: 0 }, 'right', false, [], notebookMeasure, sample)).toEqual(nodeLabelLines('n1', { x: 0, y: 0 }, 'right', false, [], notebookMeasure));
  });

  it('is what the Notebook uses, with room for any voltage in the model’s notation', () => {
    expect(NOTEBOOK_OPTIONS.nodeResultInline).toBe(sample);
  });
});

describe('a turned drawing has no more bends than the drawing as drawn (critique 4)', () => {
  it.each(CIRCUITS)('$name', ({ text }) => {
    const s = notebookSchematic(text);
    const t = turnedQuarter(s);
    if (t) expect(wireBends(t.drawing.wires)).toBeLessThanOrEqual(wireBends(s.drawing.wires));
  });

  it('p02-5’s ground runs down one straight wire, its parts’ leads lengthened to reach it', () => {
    // Laid out automatically, as the checkpoint page shows it.
    const s = notebookSchematic(stripDrawing(readFileSync(resolve(root, 'examples/p02/p02-5-short.cir'), 'utf8')));
    const t = turnedQuarter(s)!;
    const groundPins = t.scene.parts.flatMap((p) => p.pins.filter((q) => q.node === '0').map((q) => q.at));
    expect(groundPins.length).toBeGreaterThanOrEqual(4);
    // Every ground pin reaches the rail by a straight lead, and the rail is one vertical wire.
    const vertical = t.drawing.wires.flatMap((w) => w.slice(1).map((b, i) => [w[i]!, b] as const)).filter(([a, b]) => a.x === b.x);
    const rail = vertical.filter(([a]) => a.x === Math.min(...vertical.map(([p]) => p.x)));
    const xs = new Set(rail.map(([a]) => a.x));
    expect(xs.size).toBe(1);
    const ys = groundPins.map((p) => p.y);
    const top = Math.min(...rail.flatMap(([a, b]) => [a.y, b.y]));
    const bottom = Math.max(...rail.flatMap(([a, b]) => [a.y, b.y]));
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(top);
      expect(y).toBeLessThanOrEqual(bottom);
    }
  });

  it('counts bends, not wires: a corner is two pieces at a right angle, a junction is none', () => {
    expect(wireBends([[{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }]])).toBe(1);
    expect(wireBends([[{ x: 0, y: 0 }, { x: 2, y: 0 }], [{ x: 2, y: 0 }, { x: 2, y: 2 }]])).toBe(1);
    expect(wireBends([[{ x: 0, y: 0 }, { x: 4, y: 0 }], [{ x: 2, y: 0 }, { x: 2, y: 2 }]])).toBe(0);
    expect(wireBends([[{ x: 0, y: 0 }, { x: 4, y: 0 }]])).toBe(0);
  });
});
