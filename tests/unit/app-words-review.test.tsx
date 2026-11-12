// @vitest-environment jsdom
/**
 * The words review of milestone 2's final reviews (12 November 2026, decision 0017): what the app
 * says while a circuit is built, checked against the model and against what ngspice does.
 *
 * - W1: the sentence for the .op and .end a blank page gets says what .end is without claiming it
 *   stops ngspice (fact S25: ngspice reads past it), as Explain's own note for .end says.
 * - W2: Connections say that Connect to makes two nodes one, with every part on them, and how to move
 *   only one end; they promise no wire, since a circuit without ground gets a ground symbol instead.
 * - W3: a card's red-pen line offers "the fix" only for a check the Checks panel has a fix for.
 * - W4: E, F, G and H as one tool are a "dependent source", the channel's word.
 * - W7: Reverse is "reversed", never "turned round" (a half turn is refused); a turn while moving does
 *   not promise that the part lands.
 * - W8: a node in a sentence is "node in" (ground is "ground"), on the card too.
 * - W11: whole lines ngspice does not read are lines it "skips".
 * - W12: Thévenin keeps its accent, as in the channel's titles.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { cardContent, type CardState } from '../../src/app/card.ts';
import { IndexCard } from '../../src/app/components/IndexCard.tsx';
import { connectEdit, endRoles, nodeChoices, starterWords } from '../../src/app/editing.ts';
import { hintWords, type HintInput } from '../../src/app/words.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { en } from '../../src/i18n/en.ts';
import { t } from '../../src/i18n/index.ts';
import { NOTEBOOK_OPTIONS, solve, type Solution } from '../../src/notebook/index.ts';
import { GROUND, buildSchematic, type Schematic } from '../../src/schematic/index.ts';
import { EXPLAIN_STRINGS } from '../../src/spice/explain.ts';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const START = read('examples/start-here.cir');

let ngspice: Promise<NgspiceEngine>;

beforeAll(() => {
  // A compiled module, not bytes: Node's Buffer is from another realm under jsdom (as in app-smoke).
  ngspice = WebAssembly.compile(readFileSync(resolve(root, 'engine/dist/ngspice.wasm'))).then((m) =>
    NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, m),
  );
});

afterEach(() => cleanup());

/** The netlist solved by the real ngspice, drawn, and a card opened on `name` with its value as written. */
async function opened(text: string, name: string): Promise<{ s: Schematic; sol: Solution; card: ReturnType<typeof cardContent> }> {
  const sol = await solve(text, await ngspice);
  const s = buildSchematic(text, NOTEBOOK_OPTIONS);
  const part = s.circuit.parts.find((p) => p.name === name);
  if (!part) throw new Error(`no ${name}`);
  const state: CardState = { key: part.key, start: part.valueText, input: part.valueText, before: undefined, session: 1, kept: part.valueText };
  return { s, sol, card: cardContent(part, state, s, sol, text) };
}

/** Every string of the shell's catalog, by key. */
const CATALOG = Object.entries(en) as [string, string][];

describe('W1: the .op and .end a blank page gets', () => {
  it('says .end is the last line and that ngspice still reads lines after it, never that it stops anything', () => {
    const said = starterWords();
    expect(said).toContain('.op, which asks ngspice for the DC voltages and currents (the operating point)');
    expect(said).toContain('.end, the netlist’s last line');
    expect(said).toContain('ngspice still reads lines after .end');
    expect(said).not.toMatch(/stops|where the netlist ends|marks where/);
    // The same as Explain says for the .end line (S25), so the two never disagree.
    expect(EXPLAIN_STRINGS.endKeepsReading).toContain('still reads the lines after it');
  });
});

describe('W2: Connections', () => {
  it('say that Connect to makes the end’s node and another one a single node, with every part on them, and how to move one end', () => {
    const intro = t('connIntro');
    expect(intro).toContain('Connect to… makes an end’s node and another node one node, with every part on them.');
    expect(intro).toContain('To move only one end, Disconnect it first, then Connect to.');
    // The hint line while a card shows its Connections, on a computer and on a phone (no Esc there).
    const card: HintInput = { phone: false, tool: 'select', selectedName: 'R1', typeHint: 'Type a value, such as 3, 4.7k or 1meg', whole: true, turned: false, asDrawn: false, connections: true };
    const desk = hintWords(card);
    expect(desk).toBe('Connect to… makes an end’s node and another node one node · Disconnect gives an end a node of its own · Connections again shows the value and the numbers · Esc closes the card');
    expect(hintWords({ ...card, phone: true })).toBe(desk.replace(' · Esc closes the card', ''));
  });

  it('promise only what always happens, the two nodes made one: a circuit without ground gets a ground symbol, not a wire', () => {
    // SPICE for Beginners' mistake 1: no ground. V1's + end connected to ground from its card.
    const s = buildSchematic(read('examples/sp01/sp01-4-no-ground.cir'), NOTEBOOK_OPTIONS);
    const v1 = s.circuit.parts.find((p) => p.name === 'V1')!;
    const on = (sch: Schematic, node: string): string[] => sch.circuit.parts.filter((p) => p.nodes.includes(node)).map((p) => p.name).sort();
    const was = v1.nodes[0];
    const parts = on(s, was);
    const r = connectEdit(s, v1.key, 0, GROUND);
    expect(r.ok).toBe(true);
    // No wire is drawn: the node becomes ground by name, and the drawing gets a ground symbol for it.
    expect(r.summary).toBe('Node n1 renamed to 0. Node n1 is now ground (node 0).');
    expect(r.drawing.wires).toEqual(s.drawing.wires);
    expect(r.drawing.grounds).toHaveLength(s.drawing.grounds.length + 1);
    // What the words promise holds: the end's node and ground are one node, every part on it included.
    const after = buildSchematic(r.text, NOTEBOOK_OPTIONS);
    expect(after.circuit.nodes.has(was)).toBe(false);
    expect(on(after, GROUND)).toEqual(parts);
    // On Start here the same button draws a wire: the words name neither, only what both do.
    const start = buildSchematic(START, NOTEBOOK_OPTIONS);
    const wired = connectEdit(start, 'r1', 1, GROUND);
    expect(wired.summary).toMatch(/^Wire added\./);
    for (const key of ['connIntro', 'hintConnections', 'hintConnectionsPhone'] as const) {
      expect(t(key), key).toContain('Connect to… makes an end’s node and another node one node');
      expect(t(key), key).not.toMatch(/\bwires?\b/);
    }
  });

  it('name each button for what it changes, starting with the words it shows (WCAG 2.5.3), the node as a node', () => {
    const [end1, end2] = endRoles('R');
    const connect = t('connConnectLabel', { role: end2, name: 'R1' });
    expect(connect).toBe('Connect to another node: the node at the end 2 of R1');
    expect(connect.startsWith(t('connConnect').replace('…', ''))).toBe(true);
    // The list of nodes finishes the sentence its group is named by.
    expect(`${t('connTo', { role: end2, name: 'R1' })} ${t('groundWords')}`).toBe('Connect the node at the end 2 of R1 to ground (node 0)');
    // Disconnect: the node it leaves, named as a node whether it is ground or not (W8).
    const s = buildSchematic(START, NOTEBOOK_OPTIONS);
    const words = Object.fromEntries(nodeChoices(s).map((n) => [n.node, n.words]));
    expect(t('connDisconnectLabel', { role: end1, name: 'R1', node: words.in! })).toBe('Disconnect the end 1 of R1 from its node, in');
    expect(t('connDisconnectLabel', { role: end2, name: 'R2', node: words['0']! })).toBe('Disconnect the end 2 of R2 from its node, ground (node 0)');
    expect(t('connDisconnectLabel', { role: end1, name: 'R1', node: words.in! }).startsWith(t('connDisconnect'))).toBe(true);
  });
});

describe('W3: the card’s link to Checks', () => {
  it('says "See the fix" for a check with a fix and "See why" for one without', async () => {
    // A transconductance source on empty paper: its current has nowhere to go, and no fix can know where it should.
    const g = await opened(`${START.replace(/\.op/, 'G1 n1 n2 in 0 1m\n.op')}`, 'G1');
    const noPath = g.sol.checks.find((c) => c.line === 5);
    expect(noPath?.fixes).toEqual([]);
    expect(g.card.trap).toBe(noPath?.title);
    expect(g.card.trapFix).toBe(false);
    // 1M is a milliohm: the Checks panel offers "1meg".
    const r = await opened(START.replace('R1 in out 1k', 'R1 in out 1M'), 'R1');
    expect(r.sol.checks.find((c) => c.line === 3)?.fixes.length).toBeGreaterThan(0);
    expect(r.card.trapFix).toBe(true);
  }, 30000);

  it('shows the link that fits on the card, and the Checks panel says it offers a fix where there is one', () => {
    const base = { name: 'G1', kind: 'voltage-controlled current source', line: 5, icon: 'G', value: '1m', start: '1m', readouts: [], sentence: 'G1', typeHint: '', trap: 'G1’s current has nowhere to go' } as const;
    const handlers = { onValue: () => undefined, onPutBack: () => undefined, onClose: () => undefined, onExplain: () => undefined, onFix: () => undefined };
    render(<IndexCard {...base} trapFix={false} variant="sheet" {...handlers} />);
    expect(screen.getByRole('button', { name: 'See why in Checks' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'See the fix in Checks' })).toBeNull();
    cleanup();
    render(<IndexCard {...base} trapFix variant="sheet" {...handlers} />);
    expect(screen.getByRole('button', { name: 'See the fix in Checks' })).toBeTruthy();
    expect(t('checksIntro')).toMatch(/offers a fix where there is one\.$/);
  });
});

describe('W4: one word for E, F, G and H as a group', () => {
  it('is "dependent source", the channel’s word; only the four catalog names say "controlled"', () => {
    expect(t('toolControlled')).toBe('Dependent source');
    expect(t('toolControlledWith', { letter: 'E–H' })).toBe('Dependent source (E–H)');
    expect(t('controlledMenu')).toBe('Dependent sources');
    expect(t('partsGroupControlled')).toBe('Dependent sources');
    expect(t('checksUnchosenIntro')).toMatch(/^A dependent source reads a voltage or a current elsewhere in the circuit\./);
    // "controlled source" survives only inside the catalog names ("voltage-controlled current source").
    const loose = CATALOG.filter(([, v]) => /(?<!(voltage|current)-)controlled sources?\b/i.test(v)).map(([k]) => k);
    expect(loose).toEqual([]);
  });
});

describe('W7: Reverse, the ground symbol in hand, and turning while moving', () => {
  it('says "reversed" for Reverse and never "turned round"; a turn while moving promises no landing', () => {
    expect(t('handReversed', { part: 'A resistor' })).toBe('A resistor in hand, reversed: its two ends swapped.');
    expect(t('handGroundSame')).toBe('A ground symbol has one end and looks the same mirrored: T turns it.');
    expect(t('turnedMoving', { name: 'R1' })).toBe('R1 turned.');
    expect(t('mirroredMoving', { name: 'R1' })).toBe('R1 mirrored.');
    expect(CATALOG.filter(([, v]) => /turned round|lands that way\./.test(v)).map(([k]) => k)).toEqual([]);
  });

  it('gives the ground symbol over empty paper a hint with one colon in its part', () => {
    const hint = t('hintPlaceHere', { part: 'a ground symbol', joins: t('groundAlone'), mirror: '' });
    expect(hint).toBe('Click to place a ground symbol here: it touches nothing yet (draw a wire to it) · T turns it · Esc goes back to Select');
    expect(hint.split(' · ')[0]!.split(':').length - 1).toBe(1);
  });
});

describe('W8: a node in the card’s sentences', () => {
  it('is "node in" for the higher end, on the card and in what it says; ground stays "ground"', async () => {
    const r1 = await opened(START, 'R1');
    const across = r1.card.readouts.find((r) => r.tone === 'voltage')!;
    // formatSI writes a no-break space before the unit.
    expect(across.sub?.map((l) => l.replace(/\u00a0/g, ' '))).toEqual(['node in is higher', 'V(in) − V(out) = 2 V']);
    expect(across.speech).toBe('2 volts across R1, node in is higher. V(in) minus V(out) is 2 volts');
    // The short line under a current stays a label, its names bare, as on the drawing.
    expect(r1.card.readouts.find((r) => r.tone === 'current')!.sub).toEqual(['from in to out']);
    const below = await opened('* ground is the higher end\nV1 0 a 6\nR1 a 0 1k\n.op\n.end\n', 'R1');
    const v = below.card.readouts.find((r) => r.tone === 'voltage')!;
    expect(v.sub?.[0]).toBe('ground is higher');
    expect(v.speech).toContain('6 volts across R1, ground is higher.');
  }, 30000);
});

describe('W11: whole lines ngspice does not read', () => {
  it('are lines it "skips" (the drawing lines too); "ignores" is kept for characters inside a line', () => {
    expect(t('netlistFoot')).toContain('Lines that start with *@ say where parts are drawn: ngspice skips them.');
    expect(CATALOG.filter(([, v]) => /\*@/.test(v) && /ignor/.test(v)).map(([k]) => k)).toEqual([]);
  });
});

describe('W12: Thévenin', () => {
  it('keeps its accent in the example names, as in the channel’s titles', () => {
    expect(t('exampleF5')).toBe('Thévenin resistance with a dependent source');
    const manifest = JSON.parse(read('examples/examples.json')) as { videos?: { title: string; short: string }[]; examples: { name: string }[] };
    const shown = [...CATALOG.map(([, v]) => v), ...manifest.examples.map((e) => e.name), ...(manifest.videos ?? []).flatMap((v) => [v.title, v.short])];
    expect(shown.filter((s) => /Thevenin/.test(s))).toEqual([]);
  });
});
