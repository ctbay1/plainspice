/**
 * The examples open drawn as in their videos (scripts/video-drawings/): every example has its
 * drawing block, the block is exactly what the converter makes from the committed recording of the
 * videos' drawings (recorded.json, so CI needs no copy of the channel's repository), and the drawing
 * is clean in the Notebook look, as drawn and (when it turns) turned for a phone: the model finds no problem with the
 * lines, nothing overlaps, it connects exactly what the netlist does (by the model and by an
 * independent check), and it keeps every part where the block puts it. Every node's name reads as
 * its own (nearer its own copper than any other node's), and the names the video writes stay near
 * where it writes them, never turned to the left of their point when the video writes them on the
 * right. Its parts stand in the video's order, left to right and top to bottom; examples that show
 * one drawing of a video (a netlist and its version with a 0 V source added) draw it at one scale,
 * every part they share in the same place. The values are checked by
 * tests/golden/examples.test.ts and the results' room by tests/golden/notebook-drawings.test.ts.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLES, drawnAsInVideo } from '../../src/app/examples.ts';
import { NOTEBOOK_OPTIONS } from '../../src/notebook/schematic.ts';
import { turnedQuarter } from '../../src/notebook/turn.ts';
import { applyEdit, buildSchematic, checkConnectivity, findOverlaps, readDrawing, serializeDrawing, stripDrawing, type Schematic } from '../../src/schematic/index.ts';
import { compose, convert, nameProblems, readRecording, spotCost, type Conversion } from '../../scripts/video-drawings/convert.ts';
import { PLANS } from '../../scripts/video-drawings/plan.ts';

const root = resolve(import.meta.dirname, '../..');
const manifest = JSON.parse(readFileSync(join(root, 'examples/examples.json'), 'utf8')) as { examples: { id: string; file: string }[] };
const fileOf = (id: string): string => readFileSync(join(root, 'examples', manifest.examples.find((e) => e.id === id)!.file), 'utf8');
const recording = readRecording();
const conversions = new Map<string, Conversion>();
const converted = (id: string): Conversion => {
  let c = conversions.get(id);
  if (!c) conversions.set(id, (c = convert(PLANS.find((p) => p.id === id)!, recording)));
  return c;
};

/**
 * What a drawing connects, found without the model's code: every wire as the grid points it covers,
 * wires joined where an end or a corner of one lies on the other, pins joined to the wires through
 * their point and to pins at the same point, ground symbols all node 0, labels joining what they
 * touch by name. Returns the shorts and opens.
 */
function independentCheck(s: Schematic): string[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.has(x) && parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const covers = s.drawing.wires.map((w) => {
    const all = new Set<string>();
    for (let i = 1; i < w.length; i++) {
      const a = w[i - 1]!;
      const b = w[i]!;
      const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      for (let k = 0; k <= n; k++) all.add(`${a.x + Math.sign(b.x - a.x) * k},${a.y + Math.sign(b.y - a.y) * k}`);
    }
    return { all, ends: w.map((p) => `${p.x},${p.y}`) };
  });
  covers.forEach((w, i) => covers.forEach((v, j) => i !== j && w.ends.some((p) => v.all.has(p)) && union(`w${i}`, `w${j}`)));
  const pins: { key: string; node: string; at: string }[] = [];
  for (const part of s.circuit.parts) {
    const pl = s.drawing.parts.get(part.key)!;
    const d = pl.rot === 0 ? [0, -2] : pl.rot === 90 ? [2, 0] : pl.rot === 180 ? [0, 2] : [-2, 0];
    pins.push({ key: `${part.key}.0`, node: part.nodes[0], at: `${pl.at.x + d[0]!},${pl.at.y + d[1]!}` });
    pins.push({ key: `${part.key}.1`, node: part.nodes[1], at: `${pl.at.x - d[0]!},${pl.at.y - d[1]!}` });
  }
  s.drawing.grounds.forEach((g, i) => {
    pins.push({ key: `g${i}`, node: '0', at: `${g.at.x},${g.at.y}` });
    union(`p:g${i}`, 'L:0');
  });
  for (const p of pins) {
    find(`p:${p.key}`);
    covers.forEach((w, i) => w.all.has(p.at) && union(`p:${p.key}`, `w${i}`));
    for (const q of pins) if (q !== p && q.at === p.at) union(`p:${p.key}`, `p:${q.key}`);
  }
  for (const l of s.drawing.labels) {
    const at = `${l.at.x},${l.at.y}`;
    covers.forEach((w, i) => w.all.has(at) && union(`w${i}`, `L:${l.node}`));
    for (const p of pins) if (p.at === at) union(`p:${p.key}`, `L:${l.node}`);
  }
  const groups = new Map<string, Set<string>>();
  const nodes = new Map<string, Set<string>>();
  for (const p of pins) {
    const g = find(`p:${p.key}`);
    (groups.get(g) ?? groups.set(g, new Set()).get(g)!).add(p.node);
    (nodes.get(p.node) ?? nodes.set(p.node, new Set()).get(p.node)!).add(g);
  }
  return [...[...groups.values()].filter((n) => n.size > 1).map((n) => `short ${[...n].join(',')}`), ...[...nodes].filter(([, g]) => g.size > 1).map(([n]) => `open ${n}`)];
}

describe('the plans', () => {
  it('draw every example from its video, in the library’s order', () => {
    expect(PLANS.map((p) => p.id)).toEqual(manifest.examples.map((e) => e.id));
  });

  it('use only drawings the recording has, recorded from the channel’s files', () => {
    for (const plan of PLANS) for (const use of [...plan.uses, ...(plan.names ?? [])]) expect(recording.drawings[use.drawing]?.items[use.item], `${plan.id}: ${use.drawing} ${use.item}`).toBeDefined();
    for (const [file, hash] of Object.entries(recording.files)) {
      expect(file).toMatch(/^episodes\/(sp01|p01|p02|e04)\/(scenes|circuits)\.py$/);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe.each(manifest.examples.map((e) => e.id))('%s', (id) => {
  const text = fileOf(id);
  const s = buildSchematic(text, NOTEBOOK_OPTIONS);

  it('has its drawing block, just before .end', () => {
    const lines = text.trimEnd().split('\n');
    const indexes = readDrawing(s.netlist).lineIndexes;
    expect(indexes.length).toBeGreaterThan(5);
    expect(lines[indexes[0]!]).toBe('* plainspice-drawing v1');
    expect(indexes[indexes.length - 1]).toBe(lines.length - 2);
    expect(lines[lines.length - 1]).toBe('.end');
  });

  // The first test of each example runs the converter (the tests after it reuse its result): 0.3 to 1.3 s
  // alone (sp01-3, e04-4); 8.4 s at load 13 on 4 cores, past vitest's 5 s: 30 s, as the app's slow tests have.
  it('is exactly what the converter makes from the committed recording', () => {
    const c = converted(id);
    expect(c.text).toBe(text);
    // Nothing else in the file: without the block, the netlist is the one the channel's design file gives.
    expect(stripDrawing(text)).toBe(stripDrawing(c.text));
  }, 30_000);

  it('is clean in the Notebook look: no problem, no overlap, exactly the netlist’s connections, every part where the block puts it', () => {
    expect(s.origin).toBe('given');
    expect(s.problems).toEqual([]);
    expect(findOverlaps(s.scene)).toEqual([]);
    expect(checkConnectivity(s.circuit, s.drawing)).toEqual([]);
    expect(independentCheck(s)).toEqual([]);
    // The block is what the model draws: built again from it, nothing moves.
    const block = serializeDrawing(s.circuit, s.drawing, s.kept);
    expect(text).toContain(block.join('\n'));
    expect(converted(id).checks).toEqual({ problems: [], overlaps: [], connectivity: [], moved: [], names: [] });
  });

  it('writes every node’s name where it reads as that node’s: nearer its own wire than any other node’s', () => {
    expect(nameProblems(s.scene)).toEqual([]);
    // Every node but ground (named by its symbol; a terminal's own name on it, b, would be extra) is named once.
    expect(s.scene.nodeLabels.filter((l) => l.node !== '0').map((l) => l.node).sort()).toEqual([...s.circuit.nodes.values()].filter((n) => !n.ground).map((n) => n.name).sort());
  });

  it('writes the names the video writes near where it writes them, on its side or across, never turned left of a name it writes on the right', () => {
    for (const c of converted(id).chosen) {
      const r = c.request;
      if (!r.dir) continue;
      expect(Math.hypot(c.at.x - r.at.x, c.at.y - r.at.y), `${r.text} moved along its wire`).toBeLessThanOrEqual(4);
      expect(spotCost(r.dir, c.spot), `${r.text}: ${c.spot} for the video's ${r.dir}`).toBeDefined();
      if (['RIGHT', 'UR', 'DR'].includes(r.dir)) expect(c.spot.endsWith('left')).toBe(false);
      // The block says so: the label is where the converter put it, on that spot.
      expect(s.drawing.labels).toContainEqual(expect.objectContaining({ node: r.node, at: c.at, side: c.spot }));
    }
  });

  it('turned for a phone held upright, is clean when it turns (else the phone shows it as drawn)', () => {
    const t = turnedQuarter(s);
    expect(t !== undefined).toBe(converted(id).turned);
    if (!t) return;
    expect(findOverlaps(t.scene)).toEqual([]);
    expect(checkConnectivity(t.circuit, t.drawing)).toEqual([]);
  });

  it('stands its parts in the video’s order, left to right and top to bottom', () => {
    const c = converted(id);
    // Where the video draws each part's body (sp01-3's two loads are both "RL" there: by the part, not the name).
    const drawn = c.matches.map(({ part, video: v }) => ({ name: part.name, video: v.centre ?? [(v.p[0] + v.q[0]) / 2, (v.p[1] + v.q[1]) / 2], at: s.drawing.parts.get(part.key)!.at }));
    expect(drawn).toHaveLength(compose(c.plan, recording).parts.length);
    for (const a of drawn) {
      for (const b of drawn) {
        // Wherever the video puts one part clearly right of (or above) another, so does the drawing.
        if (a.video[0] - b.video[0] > 0.3) expect(a.at.x, `${a.name} right of ${b.name}`).toBeGreaterThan(b.at.x);
        if (a.video[1] - b.video[1] > 0.3) expect(a.at.y, `${a.name} above ${b.name}`).toBeLessThan(b.at.y);
      }
    }
  });
});

describe('examples that show one drawing of a video', () => {
  const groups = new Map<string, string[]>();
  for (const p of PLANS) if (p.scaleGroup) groups.set(p.scaleGroup, [...(groups.get(p.scaleGroup) ?? []), p.id]);

  it.each([...groups])('%s: one scale, and every part they share in the same place, turned the same way', (_group, ids) => {
    expect(ids.length).toBeGreaterThan(1);
    const cs = ids.map((id) => converted(id));
    expect(new Set(cs.map((c) => c.k)).size).toBe(1);
    const drawings = ids.map((id) => buildSchematic(fileOf(id), NOTEBOOK_OPTIONS).drawing);
    // Placed from the same top left corner: the extra part (Vshort, say) is to the right or below.
    for (const d of drawings.slice(1)) {
      for (const [key, p] of drawings[0]!.parts) {
        const q = d.parts.get(key);
        if (q) expect({ key, at: q.at, rot: q.rot }).toEqual({ key, at: p.at, rot: p.rot });
      }
    }
  });
});

describe('the drawings say what their netlists say', () => {
  it('sp01-4, no node 0: no ground symbol, the bottom wire named n3', () => {
    const s = buildSchematic(fileOf('sp01-4-no-ground'), NOTEBOOK_OPTIONS);
    expect(s.drawing.grounds).toEqual([]);
    expect(s.drawing.labels.map((l) => l.node)).toContain('n3');
  });

  it('sp01-5, the typo: R2’s top lead is moved off n2 to an open end named n12, as the video draws it', () => {
    const s = buildSchematic(fileOf('sp01-5-typo'), NOTEBOOK_OPTIONS);
    expect(s.scene.terminals.map((t) => t.node)).toEqual(['n12']);
    const r2 = s.scene.parts.find((p) => p.key === 'r2')!;
    const top = r2.pins.find((p) => p.node === 'n12')!;
    expect(top.outward).toBe('up');
    // The open end is up and to the right of R2, as in the video (S9).
    const end = s.scene.terminals[0]!.at;
    expect(end.x).toBeGreaterThan(top.at.x);
    expect(end.y).toBeLessThan(top.at.y);
    // n12 is written on the right of its open end, as the video writes it: on the left it would sit by n2's wire.
    const name = s.scene.nodeLabels.find((l) => l.node === 'n12')!;
    expect(name.at).toEqual(end);
    expect(name.spot.endsWith('right')).toBe(true);
  });

  it('sp01-6, 1M: example 1 without I1, and without the wires that led to it', () => {
    const one = buildSchematic(fileOf('sp01-1-example-1'), NOTEBOOK_OPTIONS);
    const s = buildSchematic(fileOf('sp01-6-mega'), NOTEBOOK_OPTIONS);
    expect(s.circuit.parts.map((p) => p.key)).toEqual(['v1', 'r1', 'r2']);
    const right = (x: Schematic): number => Math.max(...x.drawing.wires.flat().map((p) => p.x));
    expect(right(s)).toBe(Math.max(...[...s.drawing.parts.values()].map((p) => p.at.x)));
    expect(right(one)).toBeGreaterThan(Math.max(...['v1', 'r1', 'r2'].map((k) => one.drawing.parts.get(k)!.at.x)));
  });

  it.each(['p02-5-short', 'e04-3-short', 'e04-5-short'])('%s: Vshort stands in the wire from a to b, + at a', (id) => {
    const s = buildSchematic(fileOf(id), NOTEBOOK_OPTIONS);
    const v = s.scene.parts.find((p) => p.key === 'vshort')!;
    expect(v.rot).toBe(0);
    const plus = v.marks.find((m) => m.text === '+')!;
    expect(plus.at.y).toBeLessThan(v.at.y);
    // It is the rightmost part, at the terminals.
    expect(v.at.x).toBe(Math.max(...s.scene.parts.map((p) => p.at.x)));
  });

  it('p01-3 and p02-3: Vsense in series on the lead, + on the side the current comes in at', () => {
    const p01 = buildSchematic(fileOf('p01-3-ccvs-supernode'), NOTEBOOK_OPTIONS);
    const v = p01.scene.parts.find((p) => p.key === 'vsense')!;
    const r1 = p01.scene.parts.find((p) => p.key === 'r1')!;
    expect(v.at.y).toBe(r1.at.y);
    expect(v.at.x).toBeLessThan(r1.at.x);
    expect(v.marks.find((m) => m.text === '+')!.at.x).toBeLessThan(v.at.x);
    const p02 = buildSchematic(fileOf('p02-3-dependent-only'), NOTEBOOK_OPTIONS);
    const w = p02.scene.parts.find((p) => p.key === 'vsense')!;
    expect(w.marks.find((m) => m.text === '+')!.at.x).toBeGreaterThan(w.at.x);
    expect(p02.drawing.labels.find((l) => l.node === 'a')!.at).toEqual(w.pins.find((p) => p.node === 'a')!.at);
  });
});

describe('a phone offers “As in the video” only for a video’s own drawing (decision 0015)', () => {
  it.each(manifest.examples.map((e) => e.id))('%s, as it opens, is drawn as in its video', (id) => {
    expect(drawnAsInVideo(fileOf(id))).toBe(true);
  });

  it('a value changed keeps it the video’s drawing; a part turned or moved, a node renamed, or no *@ lines make it another', () => {
    const text = fileOf('p02-4-open');
    const s = buildSchematic(text, NOTEBOOK_OPTIONS);
    const edited = (op: Parameters<typeof applyEdit>[1]): string => {
      const r = applyEdit(s, op);
      expect(r.ok, r.ok ? '' : r.reason).toBe(true);
      return r.text;
    };
    expect(drawnAsInVideo(edited({ kind: 'set-value', part: 'r1', value: '5' }))).toBe(true);
    expect(drawnAsInVideo(edited({ kind: 'rotate-part', part: 'r3' }))).toBe(false);
    const r3 = s.drawing.parts.get('r3')!;
    expect(drawnAsInVideo(edited({ kind: 'move-part', part: 'r3', to: { x: r3.at.x - 2, y: r3.at.y } }))).toBe(false);
    expect(drawnAsInVideo(edited({ kind: 'rename-node', node: 'n1', name: 'm' }))).toBe(false);
    expect(drawnAsInVideo(stripDrawing(text))).toBe(false);
    // Line endings and spacing around the lines do not matter: the lines say the same drawing.
    expect(drawnAsInVideo(text.replace(/\n/g, '\r\n'))).toBe(true);
  });

  it('Start here and the basics are PlainSpice’s own drawings, never “as in the video”', () => {
    const videos = new Set(manifest.examples.map((e) => e.id));
    const others = EXAMPLES.filter((e) => !videos.has(e.id));
    expect(others.length).toBeGreaterThan(5);
    for (const e of others) expect(drawnAsInVideo(e.netlist), e.id).toBe(false);
  });
});

describe('the recorder', () => {
  // record.py runs only the drawing statements of the channel's files, with an interpreter of its own:
  // its self-test feeds it code that tries to reach outside and checks that it refuses.
  const python = ((): string | undefined => {
    try {
      execFileSync('python3', ['--version'], { stdio: 'pipe' });
      return 'python3';
    } catch {
      return undefined;
    }
  })();

  it.skipIf(!python)('refuses anything but drawing code (python3 -I record.py --self-test)', () => {
    const out = execFileSync(python!, ['-I', join(root, 'scripts/video-drawings/record.py'), '--self-test'], { encoding: 'utf8' });
    expect(out).toMatch(/^self-test passed/m);
  });
});
