// @vitest-environment jsdom
/**
 * Node names written as the videos write them. A name on the left of its point, with its value on the
 * same line ("s = 40 V"), is drawn up to its point (nameShift, src/notebook/results.ts), not at the far
 * end of the room the scene keeps for any value. It moves only inside that room, so nothing new can
 * overlap, and what is drawn with it follows: the ink the card and the red pen keep clear of, the focus
 * ring, the highlighter. And a phone's turned view (src/notebook/turn.ts) places the names again when a
 * name kept at its point has no room once turned; the names at open ends stay where they are.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AnalysisResults } from '../../src/engine/results.ts';
import { Drawing, NO_RESULTS, UNIT_PX, inkBoxes, isInline, isWide, markBox, nameShift, nameShifts, notebookSchematic, placeResults, roomOf, turnedQuarter, type DrawingResults } from '../../src/notebook/index.ts';
import { INLINE_RESULT_GAP, checkConnectivity, findOverlaps, unionBoxes, type Box, type PlacedNodeLabel, type Schematic } from '../../src/schematic/index.ts';
import { describeResults } from '../../src/spice/describe.ts';
import { parseNetlist } from '../../src/spice/parse.ts';

afterEach(cleanup);

const root = resolve(import.meta.dirname, '../..');
const manifest = JSON.parse(readFileSync(resolve(root, 'examples/examples.json'), 'utf8')) as { examples: { id: string; file: string }[] };
const EXAMPLES = manifest.examples.map((e) => ({ id: e.id, text: readFileSync(resolve(root, 'examples', e.file), 'utf8') }));
const example = (id: string): string => EXAMPLES.find((e) => e.id === id)!.text;

const RUN = { ok: true, unreliable: false, exitCode: 0, stdout: '', stderr: '', plots: [], diagnostics: [], timings: { instantiateMs: 0, runMs: 0, parseMs: 0 } };

/** An example's drawing and its results with each named node at a voltage (no currents: only the names' values matter here). */
function solved(text: string, volts: (node: string) => number): { s: Schematic; drawn: DrawingResults } {
  const s = notebookSchematic(text);
  const nodes = s.scene.nodeLabels.map((l) => ({ node: l.node, value: volts(l.node) }));
  const results: AnalysisResults = { op: { nodes, currents: [] }, other: [] };
  return { s, drawn: placeResults(s.scene, describeResults(parseNetlist(text), results, RUN)) };
}

const label = (s: Schematic, node: string): { l: PlacedNodeLabel; i: number } => {
  const i = s.scene.nodeLabels.findIndex((l) => l.node === node);
  expect(i, `a name for ${node}`).toBeGreaterThanOrEqual(0);
  return { l: s.scene.nodeLabels[i]!, i };
};
const nameLine = (l: PlacedNodeLabel) => l.lines.find((x) => x.role === 'node')!;
const resultLine = (l: PlacedNodeLabel) => l.lines.find((x) => x.role === 'result')!;
const moved = (b: Box, dx: number): Box => ({ ...b, x0: b.x0 + dx, x1: b.x1 + dx });
const inside = (b: Box, room: Box): boolean => b.x0 >= room.x0 - 1e-9 && b.x1 <= room.x1 + 1e-9 && b.y0 >= room.y0 - 1e-9 && b.y1 <= room.y1 + 1e-9;

/** Every name the examples write on the left of its point with its value on its line. */
const LEFT_NAMES = EXAMPLES.flatMap(({ id, text }) =>
  notebookSchematic(text)
    .scene.nodeLabels.filter((l) => l.spot.endsWith('left') && isInline(l.lines, resultLine(l)))
    .map((l) => ({ id, node: l.node })),
);

describe('a name on the left of its point is drawn up to it', () => {
  it('the examples have such names (the videos write s, m, n1 and c on the left)', () => {
    expect(LEFT_NAMES.length).toBeGreaterThanOrEqual(6);
    expect(LEFT_NAMES).toContainEqual({ id: 'e04-4-open', node: 's' });
    expect(LEFT_NAMES).toContainEqual({ id: 'e04-4-open', node: 'm' });
  });

  it('e04-4: "s = 40 V" and "m = −10 V" end at their points, not 2.5 grid units away', () => {
    const { s, drawn } = solved(example('e04-4-open'), (n) => ({ s: 40, s2: 40, n1: 10, m: -10, a: 10 })[n] ?? 0);
    for (const node of ['s', 'm']) {
      const { l, i } = label(s, node);
      const mark = drawn.nodes.find((n) => n.label === i)?.mark;
      expect(mark, `${node} has a value`).toBeDefined();
      const dx = nameShift(l, mark);
      expect(dx).toBeGreaterThan(1);
      // The value ends where the room kept for any value ends: at the point, less the name's usual gap.
      const end = markBox(mark!).x1 + dx;
      expect(end).toBeCloseTo(resultLine(l).x + roomOf(resultLine(l)), 6);
      expect(l.at.x - end).toBeGreaterThan(0);
      expect(l.at.x - end).toBeLessThan(0.6);
      // Without the shift it ended more than 2 grid units from its point (the checkers' finding).
      expect(l.at.x - markBox(mark!).x1).toBeGreaterThan(2);
    }
  });

  it('with no value yet (no results, or the run failed), the name itself ends at its point', () => {
    const s = notebookSchematic(example('e04-6-tf'));
    const { l } = label(s, 's');
    const dx = nameShift(l, undefined);
    expect(dx).toBeCloseTo(roomOf(resultLine(l)) + INLINE_RESULT_GAP, 9);
    const end = nameLine(l).box.x1 + dx;
    expect(l.at.x - end).toBeGreaterThan(0);
    expect(l.at.x - end).toBeLessThan(0.6);
  });

  it('a name on the right of its point, or above its value, is not moved', () => {
    const { s, drawn } = solved(example('e04-4-open'), () => 1);
    const shifts = nameShifts(s.scene, drawn);
    s.scene.nodeLabels.forEach((l, i) => {
      if (!l.spot.endsWith('left')) expect(shifts[i], l.node).toBe(0);
    });
    // A stacked name (its value on the line below, NOTEBOOK_OPTIONS off): nothing to close up.
    const stacked = { ...label(s, 's').l, lines: label(s, 's').l.lines.map((x) => (x.role === 'result' ? { ...x, y: x.y + 1 } : x)) };
    expect(nameShift(stacked, undefined)).toBe(0);
  });

  it.each(LEFT_NAMES)('$id, $node: stays inside the room the scene keeps, with any value or none', ({ id, node }) => {
    for (const volts of [undefined, 1, 12, -888.8e-3, 1.23456e6]) {
      const { s, drawn } = volts === undefined ? { s: notebookSchematic(example(id)), drawn: NO_RESULTS } : solved(example(id), () => volts);
      const { l, i } = label(s, node);
      const room = unionBoxes(l.lines.filter((x) => x.role !== 'hidden').map((x) => x.box))!;
      const mark = drawn.nodes.find((n) => n.label === i)?.mark;
      const dx = nameShift(l, mark);
      expect(dx).toBeGreaterThanOrEqual(0);
      expect(inside(moved(nameLine(l).box, dx), room), `${node}'s name, value ${volts}`).toBe(true);
      if (mark) expect(inside(moved(markBox(mark), dx), room), `${node}'s value ${volts}`).toBe(true);
    }
  });

  it('the ink the card and the red pen keep clear of is where the name is drawn', () => {
    const { s, drawn } = solved(example('e04-4-open'), (n) => ({ s: 40, m: -10 })[n] ?? 0);
    const { l, i } = label(s, 'm');
    const dx = nameShifts(s.scene, drawn)[i]!;
    const ink = inkBoxes(s.scene, drawn);
    const name = moved(nameLine(l).box, dx);
    expect(ink).toContainEqual(name);
    expect(ink).not.toContainEqual(nameLine(l).box);
  });

  it('the drawing writes the name and its value moved, and the focus ring goes round the name where it is', () => {
    const { s, drawn } = solved(example('e04-4-open'), (n) => ({ s: 40, m: -10 })[n] ?? 0);
    const { l, i } = label(s, 'm');
    const dx = nameShifts(s.scene, drawn)[i]!;
    const props = { schematic: s, results: drawn, colours: new Map<string, string>(), plain: false, selected: undefined, related: [], hovered: undefined, traps: new Set<string>() };
    const { container } = render(
      <svg>
        <Drawing {...props} focused={{ kind: 'node', name: 'm' }} />
      </svg>,
    );
    const translate = `translate(${Math.round(dx * UNIT_PX * 100) / 100} 0)`;
    const groups = [...container.querySelectorAll('g[transform]')].filter((g) => g.getAttribute('transform') === translate);
    // The name, and its value.
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(groups.map((g) => g.textContent).join(' ')).toContain('m');
    const ring = container.querySelector('rect.nb-focus')!;
    expect(Number(ring.getAttribute('x'))).toBeCloseTo((nameLine(l).box.x0 + dx - 0.16) * UNIT_PX, 1);
  });
});

/** The examples a phone held upright would rather see turned (wide), and how many turn clean. */
const WIDE = EXAMPLES.filter(({ text }) => isWide(notebookSchematic(text)));

describe('a phone’s turned view places the names again when one has no room once turned', () => {
  it('turns more of the examples clean than keeping every name at its point would', () => {
    const turned = WIDE.filter(({ text }) => turnedQuarter(notebookSchematic(text)));
    // Without placing the names again, e04-2, e04-3 and p02-2 had no clean turn (12 of 20 open whole on a Pixel 7 with it, 8 without).
    for (const id of ['e04-2-open', 'e04-3-short', 'p02-2-test-current']) expect(turned.map((e) => e.id)).toContain(id);
  });

  it.each(WIDE.map((e) => e.id))('%s: a turned view, when there is one, is clean and keeps the names at open ends', (id) => {
    const s = notebookSchematic(example(id));
    const t = turnedQuarter(s);
    if (!t) return;
    expect(findOverlaps(t.scene).map((o) => `${o.a.kind} ${o.a.id} overlaps ${o.b.kind} ${o.b.id}`)).toEqual([]);
    expect(checkConnectivity(t.circuit, t.drawing).filter((c) => c.kind !== 'hidden').map((c) => c.message)).toEqual([]);
    // Each open end keeps its name, at its turned point.
    for (const term of s.scene.terminals) {
      const name = s.scene.nodeLabels.find((l) => l.terminal && l.at.x === term.at.x && l.at.y === term.at.y);
      if (!name) continue;
      expect(t.scene.nodeLabels.some((l) => l.node === name.node && l.terminal), `${name.node} at its open end`).toBe(true);
    }
    // Only the view turns: the netlist and its drawing are the same.
    expect(t.netlist).toBe(s.netlist);
  });
});
