/**
 * src/schematic: symbols on the grid, turning and mirroring, boxes, where words go, text sizes.
 */
import { describe, expect, it } from 'vitest';
import {
  buildSchematic,
  defaultSide,
  findOverlaps,
  nextRotation,
  PART_LETTERS,
  PIN_SPACING,
  placedPart,
  rotate,
  symbolGeometry,
  SYMBOLS,
  TEXT,
  textWidth,
  transform,
  transformBox,
  transformDirection,
  wireCrossings,
  type Rotation,
} from '../../src/schematic/index.ts';
import { boxesOverlap, pointOnSegment, segmentCrossesBox, simplifyPolyline } from '../../src/schematic/geometry.ts';
import { partLabelLines, partLabelSpecs } from '../../src/schematic/scene.ts';
import { lineBox, stackLines } from '../../src/schematic/text.ts';
import type { CircuitPart } from '../../src/schematic/index.ts';

describe('symbols', () => {
  it('gives every two-terminal part pin 0 at the top and pin 1 at the bottom, 4 grid units apart', () => {
    for (const letter of PART_LETTERS) {
      const def = SYMBOLS[letter];
      expect(def.pins).toEqual([{ x: 0, y: -2 }, { x: 0, y: 2 }]);
      expect(def.pins[1]!.y - def.pins[0]!.y).toBe(PIN_SPACING);
      expect(def.outward).toEqual(['up', 'down']);
      expect(def.box.y0).toBe(-2);
      expect(def.box.y1).toBe(2);
      // The body sits between the pins, inside the box.
      expect(def.body.y0).toBeGreaterThan(-2);
      expect(def.body.y1).toBeLessThan(2);
      expect(def.shapes.length).toBeGreaterThan(0);
    }
  });

  it('names the pins in the channel words: + and − for V, E, H; from and to for I, F, G', () => {
    for (const l of ['V', 'E', 'H'] as const) expect(SYMBOLS[l].roles).toEqual(['plus', 'minus']);
    for (const l of ['I', 'F', 'G'] as const) expect(SYMBOLS[l].roles).toEqual(['from', 'to']);
    for (const l of ['R', 'C', 'L'] as const) expect(SYMBOLS[l].roles).toEqual(['node', 'node']);
  });

  it('puts + next to pin 0 and − next to pin 1 for V, E and H, and no marks elsewhere', () => {
    for (const l of ['V', 'E', 'H'] as const) {
      const [plus, minus] = SYMBOLS[l].marks;
      expect(plus!.text).toBe('+');
      expect(plus!.at.y).toBeLessThan(0);
      expect(minus!.text).toBe('−');
      expect(minus!.at.y).toBeGreaterThan(0);
    }
    for (const l of ['R', 'C', 'L', 'I', 'F', 'G'] as const) expect(SYMBOLS[l].marks).toEqual([]);
  });

  it('draws the ground symbol with one pin and its bars below it', () => {
    const g = SYMBOLS.ground;
    expect(g.pins).toEqual([{ x: 0, y: 0 }]);
    expect(g.roles).toEqual(['ground']);
    expect(g.body.y0).toBeGreaterThan(0);
    const turned = symbolGeometry('ground', { x: 3, y: 4 }, 180, false);
    expect(turned.pins).toEqual([{ x: 3, y: 4 }]);
    expect(turned.body.y1).toBeLessThan(4);
  });
});

describe('turning and mirroring', () => {
  it('turns clockwise on screen, like SVG rotate()', () => {
    expect(rotate({ x: 0, y: -2 }, 90)).toEqual({ x: 2, y: 0 });
    expect(rotate({ x: 0, y: -2 }, 180)).toEqual({ x: 0, y: 2 });
    expect(rotate({ x: 0, y: -2 }, 270)).toEqual({ x: -2, y: 0 });
    expect(rotate({ x: 0, y: 0 }, 90)).toEqual({ x: 0, y: 0 });
    expect(Object.is(rotate({ x: 0, y: 3 }, 180).x, 0)).toBe(true); // never -0
  });

  it('places pins: 270 puts pin 0 on the left, 90 on the right, 180 at the bottom', () => {
    const at = { x: 10, y: 5 };
    expect(symbolGeometry('R', at, 270, false).pins).toEqual([{ x: 8, y: 5 }, { x: 12, y: 5 }]);
    expect(symbolGeometry('R', at, 90, false).pins).toEqual([{ x: 12, y: 5 }, { x: 8, y: 5 }]);
    expect(symbolGeometry('R', at, 180, false).pins).toEqual([{ x: 10, y: 7 }, { x: 10, y: 3 }]);
    expect(symbolGeometry('V', at, 270, false).outward).toEqual(['left', 'right']);
  });

  it('mirrors across the axis: pins stay, an inductor bulges the other way', () => {
    const plain = symbolGeometry('L', { x: 0, y: 0 }, 0, false);
    const mirrored = symbolGeometry('L', { x: 0, y: 0 }, 0, true);
    expect(mirrored.pins).toEqual(plain.pins);
    expect(mirrored.body.x0).toBeCloseTo(-plain.body.x1);
    expect(mirrored.body.x1).toBeCloseTo(-plain.body.x0);
    expect(transform({ x: 1, y: 0 }, { x: 0, y: 0 }, 90, true)).toEqual({ x: 0, y: -1 });
  });

  it('turns directions and boxes the same way as points', () => {
    expect(transformDirection('up', 90, false)).toBe('right');
    expect(transformDirection('right', 0, true)).toBe('left');
    expect(transformBox({ x0: -1, y0: -2, x1: 1, y1: 2 }, { x: 5, y: 5 }, 90, false)).toEqual({ x0: 3, y0: 4, x1: 7, y1: 6 });
    const order: Rotation[] = [];
    let r: Rotation = 0;
    for (let i = 0; i < 4; i++) order.push((r = nextRotation(r)));
    expect(order).toEqual([90, 180, 270, 0]);
  });

  it('points a current source arrow from pin 0 to pin 1', () => {
    // I1 from n1 (top, pin 0) to n2 (bottom): the arrow points down, like pin 1's outward direction.
    expect(symbolGeometry('I', { x: 0, y: 0 }, 0, false).outward[1]).toBe('down');
    // Turned over (rotation 180): pin 0 at the bottom, the arrow points up.
    expect(symbolGeometry('I', { x: 0, y: 0 }, 180, false).outward[1]).toBe('up');
  });
});

describe('boxes and segments', () => {
  it('counts only a shared area as overlap, not a touching edge', () => {
    expect(boxesOverlap({ x0: 0, y0: 0, x1: 2, y1: 2 }, { x0: 2, y0: 0, x1: 4, y1: 2 })).toBe(false);
    expect(boxesOverlap({ x0: 0, y0: 0, x1: 2, y1: 2 }, { x0: 1.9, y0: 1.9, x1: 4, y1: 4 })).toBe(true);
  });

  it('knows when a segment passes through a box and when it only runs along its edge', () => {
    const box = { x0: -0.4, y0: -2, x1: 0.4, y1: 2 };
    expect(segmentCrossesBox({ x: -3, y: 0 }, { x: 3, y: 0 }, box)).toBe(true);
    expect(segmentCrossesBox({ x: 0, y: -5 }, { x: 0, y: -2 }, box)).toBe(false); // ends at the pin
    expect(segmentCrossesBox({ x: -3, y: -2 }, { x: 3, y: -2 }, box)).toBe(false); // along the edge
    expect(pointOnSegment({ x: 2, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true);
    expect(pointOnSegment({ x: 6, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 })).toBe(false);
  });

  it('simplifies polylines: repeated and straight-through points go', () => {
    expect(simplifyPolyline([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }])).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
    ]);
  });
});

describe('words next to parts', () => {
  const part = (letter: 'R' | 'V' | 'E', extra: Partial<CircuitPart> = {}): CircuitPart => ({
    key: `${letter.toLowerCase()}1`,
    name: `${letter}1`,
    letter,
    line: 1,
    nodes: ['a', '0'],
    nodeText: ['a', '0'],
    valueText: '2',
    value: 2,
    built: true,
    coupled: [],
    sensedBy: [],
    ...extra,
  }) as CircuitPart;

  it('writes them right of an upright part, above a lying one, and on the other side when mirrored', () => {
    expect(defaultSide(0, false)).toBe('right');
    expect(defaultSide(180, false)).toBe('right');
    expect(defaultSide(0, true)).toBe('left');
    expect(defaultSide(90, false)).toBe('above');
    expect(defaultSide(270, true)).toBe('below');
    const geom = symbolGeometry('R', { x: 0, y: 0 }, 0, false);
    const right = partLabelLines(geom, partLabelSpecs(part('R'), true), 'right');
    expect(right.map((l) => [l.role, l.text])).toEqual([
      ['name', 'R1'],
      ['value', '2\u00a0Ω'],
      ['result', ''],
    ]);
    for (const l of right) {
      expect(l.align).toBe('start');
      expect(l.box.x0).toBeGreaterThan(geom.body.x1);
    }
    const above = partLabelLines(symbolGeometry('R', { x: 0, y: 0 }, 90, false), partLabelSpecs(part('R'), false), 'above');
    expect(above).toHaveLength(2);
    for (const l of above) expect(l.box.y1).toBeLessThan(-0.4);
  });

  it('measures text roughly like a sans-serif font, wide letters wider', () => {
    expect(textWidth('')).toBe(0);
    expect(textWidth('mmmm')).toBeGreaterThan(textWidth('iiii'));
    expect(textWidth('R1')).toBeGreaterThan(0.6);
    expect(textWidth('R1')).toBeLessThan(1.4);
    const box = lineBox(1, 2, 3, 'end');
    expect(box.x1).toBeCloseTo(1.05);
    expect(box.y1 - box.y0).toBeCloseTo(TEXT.lineHeight);
    const lines = stackLines([{ text: 'a', role: 'name' }, { text: 'b', role: 'value' }], { x: 0, y: 0 }, 'middle', 'top');
    expect(lines[0]!.y).toBeCloseTo(TEXT.lineHeight / 2);
    expect(lines[1]!.y).toBeCloseTo(TEXT.lineHeight * 1.5);
  });
});

describe('the scene: ends, stubs, crossings and stored sides', () => {
  it('ends a node that parts not drawn continue in a stub, with their names under the node name', () => {
    const s = buildSchematic('* t\nV1 a 0 5\nR1 a b 1k\nD1 b 0 dmod\n.model dmod D\n.op\n.end\n');
    expect(s.scene.terminals).toEqual([]);
    expect(s.scene.stubs.map((t) => [t.node, t.direction, t.hidden.map((h) => h.name)])).toEqual([['b', 'right', ['D1']]]);
    const b = s.scene.nodeLabels.find((l) => l.node === 'b')!;
    expect(b.lines.map((l) => [l.role, l.text])).toEqual([
      ['node', 'b'],
      ['hidden', 'to D1'],
      ['result', ''],
    ]);
    expect(findOverlaps(s.scene)).toEqual([]);
  });

  it('lists the points where wires cross without joining', () => {
    expect(wireCrossings([[{ x: 0, y: 0 }, { x: 4, y: 0 }], [{ x: 2, y: -2 }, { x: 2, y: 2 }], [{ x: 4, y: 0 }, { x: 4, y: 3 }]])).toEqual([{ x: 2, y: 0 }]);
    // A T (an end on the other wire) is a junction, not a crossing.
    expect(wireCrossings([[{ x: 0, y: 0 }, { x: 4, y: 0 }], [{ x: 2, y: 0 }, { x: 2, y: 2 }]])).toEqual([]);
  });

  it('puts the words on a stored side even when they would fit better elsewhere', () => {
    const text = '* t\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n* plainspice-drawing v1\n*@ V1 0 3 0 m\n*@ R1 4 0 270 side=below\n*@ R2 7 3 0 side=left\n.end\n';
    const s = buildSchematic(text);
    expect(placedPart(s, 'R1')!.side).toBe('below');
    expect(placedPart(s, 'R2')!.side).toBe('left');
  });
});
