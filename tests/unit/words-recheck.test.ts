/**
 * The words re-check of the merged fixes of milestone 2's final reviews (12 November 2026, decisions
 * 0016 and 0017): the sentences that name a node, across the model, the editor and the cards, and
 * the .tf words. The numbers in the made-up results are native ngspice 47's (and 42's, the same).
 *
 * - words re-check 3 and 4: a node is said "node in" in a sentence, but a name that already says node
 *   goes alone ("node1", never "node node1"), and an ordinary node named like ground is quoted
 *   ('node "ground"') wherever the editor says it, as the model's sentences do.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { cardContent, type CardState } from '../../src/app/card.ts';
import { endsOf, nodeSaid } from '../../src/app/editing.ts';
import { hintWords, nodeInSentence, type HintInput } from '../../src/app/words.ts';
import type { AnalysisResults } from '../../src/engine/results.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import type { RunResult } from '../../src/engine/types.ts';
import { t } from '../../src/i18n/index.ts';
import { NOTEBOOK_OPTIONS, solve } from '../../src/notebook/index.ts';
import { EDIT_STRINGS, applyEdit, buildSchematic } from '../../src/schematic/index.ts';
import { DESCRIBE_STRINGS, describeCircuit, describeResults } from '../../src/spice/describe.ts';
import { EXPLAIN_STRINGS, explainNetlist } from '../../src/spice/explain.ts';
import { nameSaysNode } from '../../src/spice/node-words.ts';
import { parseNetlist } from '../../src/spice/parse.ts';

const root = resolve(import.meta.dirname, '../..');
/** formatSI writes a no-break space between number and unit; expectations here use a plain space. */
const sp = (s: string | undefined): string => (s ?? '').replace(/ /g, ' ');

let engine: Promise<NgspiceEngine>;
beforeAll(() => {
  engine = NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(root, 'engine/dist/ngspice.wasm')));
});

function run(): RunResult {
  return { ok: true, unreliable: false, exitCode: 0, stdout: '', stderr: '', plots: [], diagnostics: [], timings: { instantiateMs: 0, runMs: 0, parseMs: 0 } };
}

/** An operating point as ngspice gives it: node voltages, and branch (V) or device (@x[i]) currents. */
function op(nodes: Record<string, number>, currents: [element: string, value: number, origin: 'branch' | 'device'][] = []): AnalysisResults {
  return {
    op: {
      nodes: Object.entries(nodes).map(([node, value]) => ({ node, value })),
      currents: currents.map(([element, value, origin]) => ({ element, value, origin, vector: origin === 'branch' ? `i(${element})` : `i(@${element}[i])` })),
    },
    other: [],
  };
}

/** Every sentence a page could say about a netlist and its results. */
function everyWord(text: string, results: AnalysisResults): string[] {
  const n = parseNetlist(text);
  const w = describeResults(n, results, run());
  return [
    describeCircuit(n),
    w.summary,
    w.summarySpeech,
    ...w.currents.flatMap((c) => [c.text, c.speech]),
    ...explainNetlist(n).flatMap((e) => [e.summary, ...e.fields.map((f) => f.meaning), ...e.notes]),
  ];
}

/** "node node1", "Node node_A": the word before a name that says it already. */
const DOUBLED = /\bnode\s+node\S/i;

describe('words re-check 4: a name that says node is never "node node1"', () => {
  // Native ngspice 47 and 42: node1 = 6 V, node2 = 4 V, V1 −2 mA (the skeptic's run, and ours).
  const NODE1 = '* nodes named node1 and node2\nV1 node1 0 6\nR1 node1 node2 1k\nR2 node2 0 2k\n.op\n.end\n';
  const RESULTS = op({ node1: 6, node2: 4 }, [
    ['v1', -0.002, 'branch'],
    ['r1', 0.002, 'device'],
    ['r2', 0.002, 'device'],
  ]);

  it('the rule: a name that starts with node and goes on; "node" alone keeps the word', () => {
    expect(['node1', 'Node_A', 'nodeB', 'NODE2'].every(nameSaysNode)).toBe(true);
    expect(['node', 'n1', 'in', 'anode', '"ground"', 'node (written with a zero-width space in it)'].some(nameSaysNode)).toBe(false);
  });

  it('the overview, the results and Explain say "node1", and never "node node1"', () => {
    const words = everyWord(NODE1, RESULTS);
    expect(words.filter((w) => DOUBLED.test(w))).toEqual([]);
    const n = parseNetlist(NODE1);
    const w = describeResults(n, RESULTS, run());
    expect(sp(w.summary)).toBe('Simulation finished: node1 = 6 V, node2 = 4 V; 3 currents. Open the results for details.');
    expect(w.summarySpeech).toContain('Simulation finished: node1 is 6 volts, node2 is 4 volts');
    expect(sp(w.currents.find((c) => c.name === 'R1')?.text)).toBe('2 mA from node1 to node2 through R1');
    expect(sp(describeCircuit(n))).toContain('R1: a 1 kΩ resistor between node1 and node2.');
    expect(sp(explainNetlist(n)[2]!.summary)).toBe('R1 is a 1 kΩ resistor between node1 and node2.');
    expect(sp(explainNetlist(n)[1]!.summary)).toContain('Ground is 0 V, so node1 sits at 6 V.');
  });

  it('a label that already says node gives the name alone: "+ node1", "node1 and ground"', () => {
    const text = '* labels\nV1 node1 0 1\nR1 node1 0 1k\nD1 node1 0 dm\n.model dm D\nX1 node1 0 sub\n.subckt sub a b\nR9 a b 1k\n.ends\n.op\n.end\n';
    const n = parseNetlist(text);
    expect(describeCircuit(n)).toContain('D1: a diode (+ node1, − side at ground, model dm).');
    expect(describeCircuit(n)).toContain('X1: a subcircuit (node1 and ground, subcircuit sub).');
    const ex = explainNetlist(n);
    expect(ex.find((e) => e.summary.startsWith('D1'))!.summary).toContain('D1 is a diode: + node1 and − node ground (node 0).');
    expect(ex.find((e) => e.summary.startsWith('X1'))!.summary).toContain('X1 is a subcircuit: node1 and node ground (node 0).');
  });

  it('a node called just "node" keeps the word, so the sentence says what it is', () => {
    const text = '* a node called node\nV1 node 0 6\nR1 node 0 2k\n.op\n.end\n';
    const w = describeResults(parseNetlist(text), op({ node: 6 }, [['v1', -0.003, 'branch']]), run());
    expect(w.summarySpeech).toContain('node node is 6 volts');
    expect(DESCRIBE_STRINGS.node('node')).toBe('node node');
    expect(EXPLAIN_STRINGS.nodeWord('node')).toBe('node node');
    expect(EDIT_STRINGS.node('node')).toBe('node node');
  });

  it('the editor\'s sentences, the card and the hints say it once too', async () => {
    const s = buildSchematic(NODE1, NOTEBOOK_OPTIONS);
    expect(nodeSaid(s, 'node1')).toBe('node1');
    expect(nodeInSentence('node1')).toBe('node1');
    expect(nodeInSentence('in')).toBe('node in');
    expect(EDIT_STRINGS.node('node2')).toBe('node2');
    expect(EDIT_STRINGS.renamed('node2', 'out')).toBe('node2 renamed to out.');
    expect(EDIT_STRINGS.labelMoved('node2')).toBe('The name of node2 moved.');
    expect(EDIT_STRINGS.noNode('node9')).toBe('There is no node9 in the drawing.');
    expect(EDIT_STRINGS.nowGround(EDIT_STRINGS.node('node2'))).toBe('node2 is now ground (node 0).');
    const renamed = applyEdit(s, { kind: 'rename-node', node: 'node2', name: 'out' });
    expect(renamed.ok && renamed.summary).toBe('node2 renamed to out.');
    expect(endsOf(s, 'r1').map((e) => t('connDisconnectLabel', { role: e.role, name: 'R1', node: e.said }))).toEqual(['Disconnect the end 1 of R1 from node1', 'Disconnect the end 2 of R1 from node2']);
    const hint: HintInput = { phone: false, tool: 'select', selectedName: undefined, selectedNode: 'node1', typeHint: undefined, whole: true, turned: false, asDrawn: false };
    expect(hintWords(hint)).toMatch(/^node1 selected · Enter opens its card/);
    expect(hintWords({ ...hint, selectedNode: 'out' })).toMatch(/^Node out selected · /);
    expect(hintWords({ ...hint, selectedNode: undefined, nodeCard: { name: 'node1', ground: false } })).toMatch(/^Type a new name for node1, then Enter/);
    expect(t('paletteRename', { node: nodeSaid(s, 'node1') })).toBe('Rename node1');
    // The card: "node1 is higher", said and shown (the solution is our engine's run of NODE1).
    const sol = await solve(NODE1, await engine);
    const part = s.circuit.parts.find((p) => p.name === 'R1')!;
    const state: CardState = { key: part.key, start: part.valueText, input: part.valueText, before: undefined, session: 1, kept: part.valueText };
    const across = cardContent(part, state, s, sol, NODE1).readouts.find((r) => r.tone === 'voltage')!;
    expect(across.sub?.[0]).toBe('node1 is higher');
    expect(across.speech).toContain('2 volts across R1, node1 is higher.');
  }, 30000);
});

describe('words re-check 3: an ordinary node named like ground is quoted where the editor says it', () => {
  // Native ngspice 47 and 42: ground = 4 V, an ordinary node (W13).
  const NAMED = '* a node named ground\nV1 in 0 6\nR1 in ground 1k\nR2 ground 0 2k\n.op\n.end\n';

  it('in Connections: "Disconnect the end 2 of R1 from node "ground"", as the card\'s sentence says it', () => {
    const s = buildSchematic(NAMED, NOTEBOOK_OPTIONS);
    expect(nodeSaid(s, 'ground')).toBe('node "ground"');
    expect(endsOf(s, 'r1').map((e) => t('connDisconnectLabel', { role: e.role, name: 'R1', node: e.said }))).toEqual(['Disconnect the end 1 of R1 from node in', 'Disconnect the end 2 of R1 from node "ground"']);
    expect(endsOf(s, 'r2').map((e) => e.said)).toEqual(['node "ground"', 'ground (node 0)']);
  });

  it('in the rename summary: a rename to such a name says it is an ordinary node, as the check after it does', () => {
    const s = buildSchematic('* start\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n', NOTEBOOK_OPTIONS);
    for (const name of ['ground', 'GROUND', '00']) {
      const r = applyEdit(s, { kind: 'rename-node', node: 'out', name });
      expect(r.ok && r.summary, name).toBe(`Node out renamed to "${name}", an ordinary node name: only 0 and gnd are ground (node 0).`);
    }
    // gnd is ground (W8): said so, as before.
    const gnd = applyEdit(s, { kind: 'rename-node', node: 'out', name: 'gnd' });
    expect(gnd.ok && gnd.summary).toBe('Node out renamed to gnd. Node out is now ground (node 0).');
    // A node already named ground: renamed away, and joined by its name, it is quoted too.
    const away = applyEdit(buildSchematic(NAMED, NOTEBOOK_OPTIONS), { kind: 'rename-node', node: 'ground', name: 'out' });
    expect(away.ok && away.summary).toBe('Node "ground" renamed to out.');
    const joined = applyEdit(buildSchematic('* two\nV1 in 0 6\nR1 in ground 1k\nR2 out 0 2k\nR3 ground out 1k\n.op\n.end\n', NOTEBOOK_OPTIONS), { kind: 'rename-node', node: 'out', name: 'ground' });
    expect(joined.ok && joined.summary).toBe('Node out renamed to "ground", an ordinary node name: only 0 and gnd are ground (node 0). A node called "ground" was already there, so the two are now one node, "ground".');
  });

  it('in the editor\'s other sentences: "R3 added between node in and node "ground""', () => {
    expect(EDIT_STRINGS.node('ground')).toBe('node "ground"');
    expect(EDIT_STRINGS.node('00')).toBe('node "00"');
    expect(EDIT_STRINGS.added('R3', EDIT_STRINGS.node('in'), EDIT_STRINGS.node('ground'))).toBe('R3 added between node in and node "ground".');
  });
});
