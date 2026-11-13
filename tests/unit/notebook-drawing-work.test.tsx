// @vitest-environment jsdom
/**
 * The drawing's render does work that grows with what it draws, never with its square (second
 * re-check, P2). Each junction dot took its colour from the first wire with a straight piece through
 * it, found by looking at every wire for every dot: on a slanted lattice at the format's limits (4,898
 * dots, 9,666 pieces) that was 47 million looks for every hover, click and key, a second or two each,
 * and no dot on slanted copper got its node's colour. The scene now gives each dot and each hop its
 * node (scene.ts, junctionNodes and crossingNodes), and a hover, a selection or the focus ring draws
 * only the highlights and the ring again. Counted here, not timed: the wires, dots and hops the render
 * reads (the scene's lists, watched).
 */
import { act, cleanup, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Drawing, NO_RESULTS, coverCost, drawingRoom, notebookSchematic, partBox, placeCard, placeNote, placeResults, wasMarks } from '../../src/notebook/index.ts';
import type { ResultsInWords } from '../../src/spice/describe.ts';
import type { NavItem, Schematic } from '../../src/schematic/index.ts';
import { slantedLattice } from './schematic-hostile.ts';

afterEach(cleanup);

const checks = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../src/schematic/geometry.ts', async (importOriginal) => {
  const g = await importOriginal<typeof import('../../src/schematic/geometry.ts')>();
  return {
    ...g,
    boxesOverlap: (...args: Parameters<typeof g.boxesOverlap>): boolean => {
      checks.count++;
      return g.boxesOverlap(...args);
    },
    segmentCrossesBox: (...args: Parameters<typeof g.segmentCrossesBox>): boolean => {
      checks.count++;
      return g.segmentCrossesBox(...args);
    },
  };
});

/** A list whose items are counted as they are read. */
function watched<T>(list: T[], reads: { count: number }): T[] {
  return new Proxy(list, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads.count++;
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
}

const NO_TRAPS: ReadonlySet<string> = new Set();
const OUT = '#0072b2';
const IN = '#d55e00';
const colours: ReadonlyMap<string, string> = new Map([
  ['out', OUT],
  ['in', IN],
]);

/** The schematic with its wires, dots and hops counted as they are read. */
function counting(s: Schematic): { s: Schematic; wires: { count: number }; dots: { count: number }; hops: { count: number }; parts: { count: number } } {
  const wires = { count: 0 };
  const dots = { count: 0 };
  const hops = { count: 0 };
  const parts = { count: 0 };
  const scene = { ...s.scene, wires: watched(s.scene.wires, wires), junctions: watched(s.scene.junctions, dots), crossings: watched(s.scene.crossings, hops), parts: watched(s.scene.parts, parts) };
  return { s: { ...s, scene }, wires, dots, hops, parts };
}

const props = (s: Schematic, hovered?: NavItem, selected?: NavItem): Parameters<typeof Drawing>[0] => ({
  schematic: s,
  results: NO_RESULTS,
  colours,
  plain: false,
  selected,
  related: [],
  hovered,
  focused: undefined,
  traps: NO_TRAPS,
});

// Built once: the slanted lattice of 70 × 70 points on node out (a 30 kB link, inside the format's
// limits). A render of its 4,898 dots takes seconds in jsdom on a busy machine: the counts are checked,
// with time to spare.
const lattice = notebookSchematic(slantedLattice(70));

describe('the drawing finds each dot’s and hop’s colour at its point (second re-check, P2)', () => {
  it('a slanted lattice at the format’s limits: every dot in out’s colour, from one look at the wires', { timeout: 60_000 }, () => {
    const sc = lattice.scene;
    expect(sc.junctions.length).toBeGreaterThan(4800);
    expect(sc.wires.reduce((n, w) => n + w.points.length - 1, 0)).toBeGreaterThan(9600);
    const c = counting(lattice);
    const html = renderToStaticMarkup(
      <svg>
        <Drawing {...props(c.s)} />
      </svg>,
    );
    const dots = html.match(/<circle class="nb-junction"[^>]*>/g) ?? [];
    expect(dots.length).toBe(sc.junctions.length);
    // The lattice's 4,897 dots in out's colour (the divider's own dot is ground's, in ink): before, they
    // were drawn in ink, as the wire looked for was the first straight one through the dot, and slanted
    // copper has none.
    expect(dots.filter((d) => d.includes(`fill:${OUT}`)).length).toBe(4897);
    // Each wire read a few times (its highlight, its line): before, every wire was read for each dot.
    expect(c.wires.count).toBeLessThan(5 * sc.wires.length);
    expect(sc.junctionNodes.filter((n) => n !== 'out')).toEqual(['0']);
  });

  it('where node in’s wires cross node out’s, each hop takes the colour of the wire that hops (the horizontal one), and each dot its own node’s', { timeout: 60_000 }, () => {
    // A frame of node in with lines across it, and a ladder of node out with lines down it, through
    // the frame: 72 crossings of in's horizontal wires over out's vertical ones (the second re-check's
    // critic: on a frame of one node the hops could take either wire's colour and look right).
    const lines = ['*@ wire 2,0 2,-17 10,-17', '*@ wire 10,-3 30,-3 30,-17 10,-17 10,-3'];
    for (let y = -5; y >= -15; y -= 2) lines.push(`*@ wire 10,${y} 30,${y}`);
    lines.push('*@ wire 7,1 7,-1 28,-1', '*@ wire 12,-19 28,-19');
    for (let x = 12; x <= 28; x += 2) lines.push(`*@ wire ${x},-1 ${x},-19`);
    const s = notebookSchematic(`* divider\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n* plainspice-drawing v1\n*@ V1 0 3 0 m\n*@ R1 4 0 270\n*@ R2 7 3 0\n${lines.join('\n')}\n.end\n`);
    const sc = s.scene;
    // Found here from the wires themselves: the node of the horizontal piece running through a point
    // (a hop's wire), and the node of any piece through or ending at a point (a dot's copper).
    const pieces = sc.wires.flatMap((w) => w.points.slice(1).map((b, i) => ({ a: w.points[i]!, b, node: w.node })));
    const between = (v: number, p: number, q: number, open: boolean): boolean => (open ? Math.min(p, q) < v && v < Math.max(p, q) : Math.min(p, q) <= v && v <= Math.max(p, q));
    const across = (x: number, y: number): string | undefined => pieces.find(({ a, b }) => a.y === y && b.y === y && between(x, a.x, b.x, true))?.node;
    const through = (x: number, y: number): string | undefined =>
      pieces.find(({ a, b }) => (a.y === y && b.y === y && between(x, a.x, b.x, false)) || (a.x === x && b.x === x && between(y, a.y, b.y, false)))?.node;
    const colourOf = (node: string | undefined): string | undefined => (node === 'in' ? IN : node === 'out' ? OUT : undefined);
    const html = renderToStaticMarkup(
      <svg>
        <Drawing {...props(s)} />
      </svg>,
    );
    // The hops and the dots are drawn in the scene's order.
    const hops = [...html.matchAll(/<path class="nb-wire" d="M[^"]* A[^"]*" style="stroke:([^;"]+)/g)].map((m) => m[1]);
    expect(hops.length).toBe(sc.crossings.length);
    expect(sc.crossings.length).toBe(72);
    expect(hops).toEqual(sc.crossings.map((p) => colourOf(across(p.x, p.y)) ?? 'var(--nb-ink)'));
    expect(hops.filter((c) => c === IN).length).toBe(72);
    const dots = [...html.matchAll(/<circle class="nb-junction"[^>]*?(?:style="fill:([^;"]+)[^>]*)?>/g)].map((m) => m[1]);
    expect(dots.length).toBe(sc.junctions.length);
    expect(dots).toEqual(sc.junctions.map((p) => colourOf(through(p.x, p.y))));
    expect(dots.filter((c) => c === IN).length).toBeGreaterThan(10);
    expect(dots.filter((c) => c === OUT).length).toBeGreaterThan(10);
  });

  it('hops take the hopping wire’s colour, and the dots on straight copper keep theirs', { timeout: 60_000 }, () => {
    // A frame on out's pin with lines across it inside: 9,604 crossings, every hop on out's copper.
    const lines = ['*@ wire 7,1 9,1', '*@ wire 9,1 108,1 108,100 9,100 9,1'];
    for (let j = 1; j <= 98; j++) lines.push(`*@ wire 9,${1 + j} 108,${1 + j}`);
    for (let i = 1; i <= 98; i++) lines.push(`*@ wire ${9 + i},1 ${9 + i},100`);
    const s = notebookSchematic(`* divider\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n* plainspice-drawing v1\n*@ V1 0 3 0 m\n*@ R1 4 0 270\n*@ R2 7 3 0\n${lines.join('\n')}\n.end\n`);
    expect(s.scene.crossings.length).toBeGreaterThan(9000);
    const c = counting(s);
    const html = renderToStaticMarkup(
      <svg>
        <Drawing {...props(c.s)} />
      </svg>,
    );
    const hops = html.match(/<path class="nb-wire" d="M[^"]* A[^>]*>/g) ?? [];
    expect(hops.length).toBe(s.scene.crossings.length);
    expect(hops.every((h) => h.includes(`stroke:${OUT}`))).toBe(true);
    // The frame's 394 dots are out's (as before: straight copper), the divider's own one ground's.
    const dots = html.match(/<circle class="nb-junction"[^>]*>/g) ?? [];
    expect(dots.length).toBe(395);
    expect(dots.filter((d) => d.includes(`fill:${OUT}`)).length).toBe(394);
    // Before, each hop looked at every piece of every wire for the one it hops over.
    expect(c.wires.count).toBeLessThan(5 * s.scene.wires.length);
    expect(s.scene.crossingNodes.every((n) => n === 'out')).toBe(true);
  });
});

describe('a hover, a selection or the focus draws only what changes (P2)', () => {
  it('on the lattice, hovering R1 and then selecting it reads no dot, no hop and no part’s words again', { timeout: 60_000 }, () => {
    const c = counting(lattice);
    const { container, rerender } = render(
      <svg>
        <Drawing {...props(c.s)} />
      </svg>,
    );
    expect(container.querySelectorAll('circle.nb-junction').length).toBe(lattice.scene.junctions.length);
    for (const next of [props(c.s, { kind: 'part', key: 'r1' }), props(c.s, undefined, { kind: 'part', key: 'r1' }), props(c.s, undefined, { kind: 'node', name: 'out' })]) {
      c.dots.count = 0;
      c.hops.count = 0;
      c.wires.count = 0;
      act(() =>
        rerender(
          <svg>
            <Drawing {...next} />
          </svg>,
        ),
      );
      expect(container.querySelector('.nb-hl')).not.toBeNull();
      // Before, every layer was drawn again: each of the 4,898 dots (and the wires looked at for each).
      expect(c.dots.count).toBe(0);
      expect(c.hops.count).toBe(0);
      // The highlights look at each wire once, for the one hovered or selected.
      expect(c.wires.count).toBeLessThanOrEqual(lattice.scene.wires.length);
    }
  });
});

describe('a click’s card finds its place by looking near each place it tries (P2)', () => {
  it('R1’s card on the whole lattice: a free place beside it, found with a few checks for each place tried', { timeout: 60_000 }, () => {
    // The lattice shown whole on a 1280 × 800 page, as Show the whole drawing does: the card goes
    // beside R1 where the paper is free, the drawing panned once to make room. Each place tried was
    // checked against every word, symbol and piece of wire (9,666): two seconds of work a click.
    const sc = lattice.scene;
    const b = sc.bounds;
    const unit = Math.min(1200 / (b.x1 - b.x0), 700 / (b.y1 - b.y0));
    const view = { unit, x: 40 - b.x0 * unit, y: 60 - b.y0 * unit };
    const area = { x0: 0, y0: 48, x1: 1280, y1: 800 };
    checks.count = 0;
    const p = placeCard({ scene: sc, part: 'r1', view, area, width: 340, height: 230, pan: true });
    const looked = checks.count;
    expect(p?.cost).toBe(0);
    // Free indeed, where the drawing is once panned: nothing under it.
    const panned = { ...view, x: view.x + p!.pan.x, y: view.y + p!.pan.y };
    expect(coverCost(p!.box, drawingRoom(sc, panned, area))).toBe(0);
    // About 114,000 checks here; summing each place's cover was 140 million.
    expect(looked).toBeLessThan(1_000_000);
  });

  it('where no place beside R1 is free, the page’s card (docked then) is not given the least-covering place, found by summing every place', { timeout: 60_000 }, () => {
    // The card's paper inside the lattice: every place covers wire. The page docks the card then
    // (App.tsx), so it asks only for a free place (freeOnly): about 5,000 checks here, where summing what
    // each place tried covers, to find the least, takes 10 million (each sum stopping once it is no less
    // than the least so far).
    const sc = lattice.scene;
    const b = sc.bounds;
    const unit = Math.min(1100 / (b.x1 - b.x0), 660 / (b.y1 - b.y0));
    const view = { unit, x: 130 - b.x0 * unit, y: 90 - b.y0 * unit };
    const area = { x0: 400, y0: 200, x1: 1000, y1: 700 };
    expect(placeCard({ scene: sc, part: 'r1', view, area, width: 340, height: 230, pan: true })?.cost).toBeGreaterThan(0);
    checks.count = 0;
    expect(placeCard({ scene: sc, part: 'r1', view, area, width: 340, height: 230, pan: true, freeOnly: true })).toBeUndefined();
    expect(checks.count).toBeLessThan(1_000_000);
  });
});

describe('a place beside something is looked for nearest first, without making every place on the paper (second re-check)', () => {
  it('a red-pen note next to R1 and the old voltages crossed out, on a drawing that reaches ±2000: a few places made and sorted, not millions', () => {
    // A frame at the edge of the coordinates: the paper the note may go on is 4,000 grid units wide,
    // and every place a quarter of a unit apart along each side was made and sorted before the nearest
    // free one was looked for: 1.6 million places sorted for the note (about a second of work, each
    // time the page drew the notes again), 720,000 for each crossed-out voltage.
    const frame = '*@ wire 7,5 7,2000 2000,2000 2000,-2000 -2000,-2000 -2000,2000 7,2000';
    const s = notebookSchematic(`* divider\nV1 in 0 6\nR1 in out 1M\nR2 out 0 2k\n.op\n* plainspice-drawing v1\n*@ V1 0 3 0 m\n*@ R1 4 0 270\n*@ R2 7 3 0\n${frame}\n.end\n`);
    const sc = s.scene;
    expect(sc.bounds.x1 - sc.bounds.x0).toBe(4000);
    const words = (k: number): ResultsInWords => ({ status: 'ok', ngspiceError: false, nodes: [{ node: 'in', text: `${6 * k} V` }, { node: 'out', text: `${4 * k} V` }], currents: [], sweeps: [], warnings: [], summary: '', summarySpeech: '' }) as unknown as ResultsInWords;
    const now = placeResults(sc, words(1));
    const before = placeResults(sc, words(0.5));
    const sort = vi.spyOn(Array.prototype, 'sort');
    const note = placeNote(sc, partBox(sc, 'r1')!, 'R1 = 1M is 1 milliohm, not 1 megaohm: SPICE reads M as milli.');
    const was = wasMarks(sc, now, before);
    const sorted = sort.mock.contexts.reduce((n: number, list) => n + (list as unknown[]).length, 0);
    sort.mockRestore();
    expect(note).toBeDefined();
    expect(was.length).toBe(2);
    // 270 places sorted in all here, where 3 million were.
    expect(sorted).toBeLessThan(20_000);
  });
});
