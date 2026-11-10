/**
 * The schematic lab: every example and fixture drawn by src/schematic's automatic layout, in a
 * neutral SVG style (draw.ts: thin black lines, US/ANSI symbols, node names in italics), with the
 * layout's own checks under each drawing, so people can judge the layouts. Screenshots:
 * scripts/lab-shots.ts.
 */
import examples from '../../examples/examples.json';
import { buildSchematic } from '../../src/schematic/index.ts';
import { card, type Entry } from './draw.ts';

const files = import.meta.glob(['/examples/*/*.cir', '/tests/fixtures/*.cir'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const showBoxes = new URLSearchParams(location.search).has('boxes');

/**
 * More shapes, beyond the channel's circuits, to judge the general cases: a bridge, an amplifier
 * built on E, a node joined to three others, a drawing whose netlist got one more part typed in
 * (the drawing keeps its positions and places only the new part), a drawing that gives only one
 * position, parts the drawing cannot show, an ammeter in a branch, and sources with AC values and
 * transient functions.
 */
const MORE: Entry[] = [
  { name: 'more-wheatstone', path: 'more: a Wheatstone bridge', text: '* A Wheatstone bridge\nV1 a 0 10\nR1 a b 1k\nR2 a c 2k\nR3 b 0 3k\nR4 c 0 4k\nR5 b c 5k\n.op\n.end\n' },
  { name: 'more-amplifier', path: 'more: a non-inverting amplifier', text: '* A non-inverting amplifier: an ideal op-amp as E\nVin p 0 1\nE1 out 0 p m 100k\nR1 out m 9k\nR2 m 0 1k\n.op\n.end\n' },
  { name: 'more-star', path: 'more: a node joined to three others', text: '* A star: s joins a, b and c\nV1 a 0 10\nR1 a b 1k\nR2 b c 1k\nR3 a s 1k\nR4 b s 1k\nR5 c s 1k\nR6 c 0 1k\n.op\n.end\n' },
  {
    name: 'more-typed-in',
    path: 'more: R3 typed into a drawn divider',
    text: [
      '* The first screen, with R3 typed in afterwards',
      'V1 in 0 6',
      'R1 in out 1k',
      'R2 out 0 2k',
      'R3 out 0 3k',
      '.op',
      '* plainspice-drawing v1',
      '*@ V1 0 3 0 m',
      '*@ R1 4 0 270',
      '*@ R2 7 3 0',
      '*@ ground 0 6 0',
      '*@ wire 0,1 0,0 2,0',
      '*@ wire 6,0 7,0 7,1',
      '*@ wire 0,5 0,6 7,6 7,5',
      '*@ label in 0 0',
      '*@ label out 7 0',
      '.end',
      '',
    ].join('\n'),
  },
  {
    name: 'more-one-position',
    path: 'more: p01-2 with only the position of Vs given',
    text: '* p01-2, drawn from one position line\nI1 0 n1 5\nRa n1 n2 2\nRb n2 0 4\nRc n3 0 6\nRd n1 n3 8\nVs n2 n3 10\n.op\n* plainspice-drawing v1\n*@ Vs 30 -4 270\n.end\n',
  },
  {
    name: 'more-not-drawn',
    path: 'more: parts the drawing cannot show',
    text: '* A diode and a subcircuit on node b\nV1 a 0 5\nR1 a b 1k\nD1 b 0 dmod\nX1 a b sub\n.model dmod D\n.subckt sub p q\nR9 p q 1k\n.ends\n.op\n.end\n',
  },
  { name: 'more-ammeter-branch', path: 'more: a 0 V ammeter below R2, in its branch', text: '* Example 1 with an ammeter below R2\nV1 n1 0 6\nR1 n1 n2 2\nR2 n2 n2b 4\nVm n2b 0 0\nI1 0 n2 3\n.op\n.end\n' },
  {
    name: 'more-sources',
    path: 'more: AC values and transient functions',
    text: '* Sources with AC values and functions\nV1 in 0 AC 1\nR1 in a 10\nL1 a b 1m\nC1 b 0 1u\nV2 c 0 DC 2 SIN(0 1 1k)\nR2 c 0 1k\nI1 0 d PULSE(0 1m 0 1u 1u 1m 2m)\nR3 d 0 1k\n.ac dec 10 1 1meg\n.end\n',
  },
];

function entries(): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  for (const ex of examples.examples) {
    const path = `/examples/${ex.file}`;
    const text = files[path];
    if (text === undefined) continue;
    out.push({ name: ex.id, path, text });
    seen.add(path);
  }
  for (const path of Object.keys(files).sort()) {
    if (seen.has(path)) continue;
    out.push({ name: path.split('/').pop()!.replace(/\.cir$/, ''), path, text: files[path]! });
  }
  return [...out, ...MORE].map((e) => (showBoxes ? { ...e, boxes: true } : e));
}

const main = document.getElementById('cards')!;
for (const e of entries()) card(e, main, (text) => buildSchematic(text));
document.body.dataset.ready = '1';
