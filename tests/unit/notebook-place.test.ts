/**
 * src/notebook/place.ts: where the card goes (critique 1 and 2: it never changes the zoom, never
 * covers its part or the part's words, is panned into room once when the drawing leaves room for it,
 * and its leader is drawn only when it crosses no word and no wire), and the sticky note's arrow.
 * Every part of p02's three circuits, on a computer's window and a laptop's.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AnalysisResults } from '../../src/engine/results.ts';
import {
  boxOnScreen,
  crossesAnything,
  drawingRoom,
  fitView,
  inkBoxes,
  inviteArrow,
  leaderFor,
  minUnitFor,
  notebookSchematic,
  placeBeside,
  placeCard,
  placeResults,
  segmentsIntersect,
  wireSegments,
  type Room,
} from '../../src/notebook/index.ts';
import { boxesOverlap, unionBoxes, type Box, type Point } from '../../src/schematic/index.ts';
import { describeResults } from '../../src/spice/describe.ts';
import { parseNetlist } from '../../src/spice/parse.ts';

const root = resolve(import.meta.dirname, '../..');
const p02 = (id: string): ReturnType<typeof notebookSchematic> => notebookSchematic(readFileSync(resolve(root, `examples/p02/${id}.cir`), 'utf8'));
const CIRCUITS = ['p02-4-open', 'p02-5-short', 'p02-3-dependent-only'] as const;

/** The checkpoint page on a computer: the free paper and the fit, as the page computes them (the card is not in the insets). */
function desk(width: number, height: number) {
  const insets = { top: 76, left: 136, right: 70, bottom: 90 };
  const area: Box = { x0: 120, y0: 74, x1: width - 54, y1: height - 90 };
  return { size: { width, height }, insets, area };
}

const CARD = { width: 680, height: 211 };

describe('placeBeside', () => {
  const area: Box = { x0: 0, y0: 0, x1: 100, y1: 100 };
  const target: Box = { x0: 40, y0: 40, x1: 60, y1: 60 };

  it('takes the first side with room, as near the target’s middle as it can', () => {
    const room: Room = { area, boxes: [], segments: [] };
    const p = placeBeside(target, 20, 10, room, { gap: 2, step: 1 })!;
    expect(p.side).toBe('above');
    expect(p.cost).toBe(0);
    expect(p.box).toEqual({ x0: 40, y0: 28, x1: 60, y1: 38 });
  });

  it('slides along the side, then tries the next side, to keep clear of what is there', () => {
    const above = { x0: 0, y0: 20, x1: 55, y1: 39 };
    const p = placeBeside(target, 20, 10, { area, boxes: [above], segments: [] }, { gap: 2, step: 1 })!;
    expect(p.side).toBe('above');
    expect(boxesOverlap(p.box, above)).toBe(false);
    const wall = { x0: 0, y0: 0, x1: 100, y1: 39 };
    const q = placeBeside(target, 20, 10, { area, boxes: [wall], segments: [] }, { gap: 2, step: 1 })!;
    expect(q.side).toBe('below');
  });

  it('with a side penalty, prefers the nearest free paper on any side', () => {
    const blocker = { x0: 30, y0: 20, x1: 70, y1: 39 };
    const far = placeBeside(target, 20, 10, { area, boxes: [blocker], segments: [] }, { gap: 2, step: 1 })!;
    const near = placeBeside(target, 20, 10, { area, boxes: [blocker], segments: [] }, { gap: 2, step: 1, sidePenalty: 2 })!;
    expect(far.side).toBe('above');
    expect(near.side).toBe('below');
  });

  it('never covers a box it may never cover; covers least when nothing is free', () => {
    const full: Room = { area, boxes: [{ x0: 0, y0: 0, x1: 100, y1: 100 }], segments: [], never: [target] };
    const p = placeBeside(target, 20, 10, full, { gap: 2, step: 2 })!;
    expect(p.cost).toBeGreaterThan(0);
    expect(boxesOverlap(p.box, target)).toBe(false);
  });
});

describe.each(CIRCUITS)('the card on %s', (id) => {
  const s = p02(id);
  describe.each([
    [1440, 900],
    [1280, 720],
  ])('in a %d × %d window', (width, height) => {
    const { size, insets, area } = desk(width, height);
    const f = fitView(s.scene.bounds, size, insets, { padding: 24, minUnit: minUnitFor(), maxUnit: 40 });
    const view = { unit: f.unit, x: f.x, y: f.y };

    it.each(s.scene.parts.map((p) => p.key))('%s: beside its part, in the free paper, covering nothing, the zoom kept', (key) => {
      const p = placeCard({ scene: s.scene, part: key, view, area, ...CARD })!;
      expect(p).toBeDefined();
      const panned = { unit: view.unit, x: view.x + p.pan.x, y: view.y + p.pan.y };
      const part = s.scene.parts.find((x) => x.key === key)!;
      // Never over its part or the part's words.
      expect(boxesOverlap(p.box, boxOnScreen(panned, unionBoxes([part.box, part.labelBox])!))).toBe(false);
      // Inside the free paper (not under the bars, the toolbar or the tabs).
      expect(p.box.x0).toBeGreaterThanOrEqual(area.x0 - 1e-6);
      expect(p.box.y0).toBeGreaterThanOrEqual(area.y0 - 1e-6);
      expect(p.box.x1).toBeLessThanOrEqual(area.x1 + 1e-6);
      expect(p.box.y1).toBeLessThanOrEqual(area.y1 + 1e-6);
      // p02's drawings leave room for it, after one pan at most: it covers nothing of the drawing.
      expect(p.cost).toBe(0);
      // The whole drawing is still on the paper after the pan.
      const content = boxOnScreen(panned, s.scene.bounds);
      expect(content.y0).toBeGreaterThanOrEqual(area.y0 - 1);
      expect(content.y1).toBeLessThanOrEqual(area.y1 + 1);
    });

    it.each(s.scene.parts.map((p) => p.key))('%s: its leader, when there is one, crosses no word and no wire', (key) => {
      const p = placeCard({ scene: s.scene, part: key, view, area, ...CARD })!;
      if (!p.leader) return;
      const panned = { unit: view.unit, x: view.x + p.pan.x, y: view.y + p.pan.y };
      const room = drawingRoom(s.scene, panned, area);
      expect(crossesAnything(p.leader.from, p.leader.to, room)).toBe(false);
      // It ends on the edge of the part's body.
      const body = boxOnScreen(panned, s.scene.parts.find((x) => x.key === key)!.body);
      const onEdge = Math.abs(p.leader.to.y - body.y0) < 1e-6 || Math.abs(p.leader.to.y - body.y1) < 1e-6 || Math.abs(p.leader.to.x - body.x0) < 1e-6 || Math.abs(p.leader.to.x - body.x1) < 1e-6;
      expect(onEdge).toBe(true);
    });
  });
});

describe('leaderFor', () => {
  const s = p02('p02-4-open');
  const view = { unit: 30, x: 300, y: 300 };
  const room = drawingRoom(s.scene, view, { x0: 0, y0: 0, x1: 2000, y1: 2000 });
  const r1 = s.scene.parts.find((p) => p.key === 'r1')!;
  const body = boxOnScreen(view, r1.body);
  const mx = (body.x0 + body.x1) / 2;

  it('refuses a line through the part’s own words (R1’s name and value are above it)', () => {
    expect(leaderFor({ x: mx, y: body.y0 - 120 }, 'above', body, room)).toBeUndefined();
  });

  it('draws a line from below, where nothing is in the way', () => {
    const l = leaderFor({ x: mx, y: body.y1 + 60 }, 'below', body, room);
    expect(l).toBeDefined();
    expect(l!.to.y).toBeCloseTo(body.y1, 6);
  });

  it('refuses a line running along a lead into its part (G1 from above)', () => {
    const g1 = s.scene.parts.find((p) => p.key === 'g1')!;
    const gb = boxOnScreen(view, g1.body);
    expect(leaderFor({ x: (gb.x0 + gb.x1) / 2, y: gb.y0 - 90 }, 'above', gb, room)).toBeUndefined();
  });
});

describe('the sticky note’s arrow', () => {
  it('reaches G1 on p02-4 without touching a word or a wire', () => {
    const text = readFileSync(resolve(root, 'examples/p02/p02-4-open.cir'), 'utf8');
    const s = notebookSchematic(text);
    // ngspice's operating point for p02-4 (examples.json: a = 24 V, n1 = 16 V), in SPICE's signs.
    const results: AnalysisResults = {
      op: {
        nodes: [
          { node: 's', value: 12 },
          { node: 'n1', value: 16 },
          { node: 'a', value: 24 },
        ],
        currents: [
          { element: 'v1', value: 4 / 3, origin: 'branch', vector: 'i(v1)' },
          { element: 'r1', value: -4 / 3, origin: 'device', vector: 'i(@r1[i])' },
          { element: 'r2', value: -4, origin: 'device', vector: 'i(@r2[i])' },
          { element: 'r3', value: 16 / 6, origin: 'device', vector: 'i(@r3[i])' },
          { element: 'g1', value: 4, origin: 'device', vector: 'i(@g1[i])' },
        ],
      },
      other: [],
    };
    const run = { ok: true, unreliable: false, exitCode: 0, stdout: '', stderr: '', plots: [], diagnostics: [], timings: { instantiateMs: 0, runMs: 0, parseMs: 0 } };
    const drawn = placeResults(s.scene, describeResults(parseNetlist(text), results, run));
    const view = { unit: 35.2, x: 360, y: 381 };
    const g1 = s.scene.parts.find((p) => p.key === 'g1')!;
    const name = g1.labels.find((l) => l.role === 'name')!;
    const ink = inkBoxes(s.scene, drawn).map((b) => boxOnScreen(view, b));
    const wires = wireSegments(s.scene).map(([a, b]) => [{ x: view.x + a.x * view.unit, y: view.y + a.y * view.unit }, { x: view.x + b.x * view.unit, y: view.y + b.y * view.unit }] as const);
    // The note above the drawing's right end, as the page places it.
    const note = { x0: 1063, y0: 60, x1: 1365, y1: 255 };
    const arrow = inviteArrow(note, boxOnScreen(view, g1.body), ink, wires, boxOnScreen(view, name.box));
    expect(arrow).toBeDefined();
    // Sampled along its curve, it keeps clear of every word as written and of every wire.
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const p = { x: (1 - t) ** 2 * arrow!.from.x + 2 * (1 - t) * t * arrow!.control.x + t * t * arrow!.to.x, y: (1 - t) ** 2 * arrow!.from.y + 2 * (1 - t) * t * arrow!.control.y + t * t * arrow!.to.y };
      for (const w of ink) expect(p.x > w.x0 && p.x < w.x1 && p.y > w.y0 && p.y < w.y1).toBe(false);
    }
    for (const [a, b] of wires) expect(segmentsIntersectCurve(arrow!, a, b)).toBe(false);
  });
});

/** True when a quadratic curve crosses a segment (sampled). */
function segmentsIntersectCurve(c: { from: Point; control: Point; to: Point }, a: Point, b: Point): boolean {
  let prev = c.from;
  for (let i = 1; i <= 40; i++) {
    const t = i / 40;
    const p = { x: (1 - t) ** 2 * c.from.x + 2 * (1 - t) * t * c.control.x + t * t * c.to.x, y: (1 - t) ** 2 * c.from.y + 2 * (1 - t) * t * c.control.y + t * t * c.to.y };
    if (segmentsIntersect(prev, p, a, b)) return true;
    prev = p;
  }
  return false;
}
