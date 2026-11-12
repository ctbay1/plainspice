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
import { afterEach, describe, expect, it } from 'vitest';
import { Drawing, NO_RESULTS, notebookSchematic } from '../../src/notebook/index.ts';
import type { NavItem, Schematic } from '../../src/schematic/index.ts';
import { slantedLattice } from './schematic-hostile.ts';

afterEach(cleanup);

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

// Built once: the slanted lattice of 70 × 70 points on node out (a 30 kB link, inside the format's limits).
const lattice = notebookSchematic(slantedLattice(70));

describe('the drawing finds each dot’s and hop’s colour at its point (second re-check, P2)', () => {
  it('a slanted lattice at the format’s limits: every dot in out’s colour, from one look at the wires', () => {
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

  it('hops take the hopping wire’s colour, and the dots on straight copper keep theirs', () => {
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
  it('on the lattice, hovering R1 and then selecting it reads no dot, no hop and no part’s words again', () => {
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
