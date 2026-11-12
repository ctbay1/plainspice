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
import { endsOf, formLine, formStart, nodeSaid } from '../../src/app/editing.ts';
import { hintWords, nodeInSentence, type HintInput } from '../../src/app/words.ts';
import type { AnalysisResults } from '../../src/engine/results.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import type { RunResult } from '../../src/engine/types.ts';
import { t } from '../../src/i18n/index.ts';
import { NOTEBOOK_OPTIONS, solve } from '../../src/notebook/index.ts';
import { EDIT_STRINGS, applyEdit, buildSchematic } from '../../src/schematic/index.ts';
import { DESCRIBE_STRINGS, annotateLines, describeCircuit, describeResults, netlistVector } from '../../src/spice/describe.ts';
import { INVISIBLE } from '../../src/spice/characters.ts';
import { EXPLAIN_STRINGS, explainNetlist } from '../../src/spice/explain.ts';
import { nameSaysNode } from '../../src/spice/node-words.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { applyFix, checkTraps } from '../../src/spice/traps.ts';

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

/** A sweep's results: the scale, then each vector (name, unit, values). */
function sweep(scale: string, unit: 'V' | 'A', values: number[], series: [string, 'V' | 'A', number[]][]): NonNullable<AnalysisResults['dc']> {
  return { scale: { name: scale, unit, values: new Float64Array(values) }, series: series.map(([name, u, v]) => ({ name, unit: u, values: new Float64Array(v) })) };
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

  it('the .tf check says it once too: ".tf asks about node5, which is not in the circuit"', () => {
    const check = (out: string) => checkTraps(parseNetlist(`* tf to a missing node\nV1 node1 0 6\nR1 node1 node2 1k\nR2 node2 0 2k\n.tf v(${out}) V1\n.end\n`)).find((c) => c.id === 'tf-problems')!;
    expect(check('node5').title).toBe('.tf asks about node5, which is not in the circuit');
    expect(check('node5').why).toBe('There is no node called node5: no part connects to it. .tf v(node5) needs a node of the circuit.');
    expect(check('node').title).toBe('.tf asks about node node, which is not in the circuit');
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

describe('words re-check 5: a label that already says node gives a name like ground alone, quoted', () => {
  // Native ngspice 47 and 42: "ground", "00" and a gnd at the end of a line are ordinary nodes (W13, W14, W9).
  const MODELS = '.model dm D\n.model qm npn\n.model sw1 SW\n.subckt sub a b\nR9 a b 1k\n.ends\n';
  const summaries = (parts: string): string[] => explainNetlist(parseNetlist(`* labels\nV1 a 0 1\nR1 a 0 1k\n${parts}${MODELS}.op\n.end\n`)).map((e) => e.summary);

  it('"+ node "00"", never "+ node the node "00"", as the overview says it', () => {
    const lines = summaries('D1 00 0 dm\nX1 ground 0 sub\nD2 out ground dm\nD3 a gnd\n');
    expect(lines).toContain('D1 is a diode: + node "00" and − node ground (node 0). PlainSpice explains R, C, L, V, I, E, F, G, H and K lines field by field; for this part it shows the fields and what ngspice needs.');
    expect(lines.find((l) => l.startsWith('X1'))).toContain('X1 is a subcircuit: node "ground" and node ground (node 0).');
    expect(lines.find((l) => l.startsWith('D2'))).toContain('D2 is a diode: + node out and − node "ground".');
    expect(lines.find((l) => l.startsWith('D3'))).toContain('D3 is a diode: + node a and − node "gnd".');
    expect(describeCircuit(parseNetlist(`* o\nD1 00 0 dm\n${MODELS}.op\n.end\n`))).toContain('D1: a diode (+ node "00", − side at ground, model dm).');
  });

  it('never "node the node" on any part whose label ends in node; "at" labels keep "the node"', () => {
    const lines = summaries('S1 ground 0 00 0 sw1\nX2 00 ground sub\nD4 ground 00 dm\nQ1 c b ground qm\n');
    expect(lines.filter((l) => /node (the )?node\b/.test(l))).toEqual([]);
    expect(lines.find((l) => l.startsWith('Q1'))).toContain('emitter at the node "ground"');
  });
});

describe('S7 and words re-check 8: a node name outside ASCII is said as first written, never half lower-cased', () => {
  // Native ngspice 47 and 42 (-b -r): v(g__r____) = 12, v(__iki__) = 8, v1#branch = −4 mA (W16).
  const CAPS = '* Turkish capitals\nV1 GİRİŞ 0 12\nR1 GİRİŞ ÇIKIŞ 1k\nR2 ÇIKIŞ 0 2k\n.op\n.end\n';
  const CAPS_RESULTS = op({ g__r____: 12, __iki__: 8 }, [
    ['v1', -0.004, 'branch'],
    ['r1', 0.004, 'device'],
    ['r2', 0.004, 'device'],
  ]);

  it('the node rows, the summary, the currents and the line notes: GİRİŞ and ÇIKIŞ, with keys and ngspice\'s spelling kept', () => {
    const n = parseNetlist(CAPS);
    const w = describeResults(n, CAPS_RESULTS, run());
    expect(w.nodes.map((x) => [x.node, x.name, x.ngspice])).toEqual([
      ['gİrİŞ', 'GİRİŞ', 'g__r____'],
      ['ÇikiŞ', 'ÇIKIŞ', '__iki__'],
    ]);
    expect(sp(w.summary)).toBe('Simulation finished: node GİRİŞ = 12 V, node ÇIKIŞ = 8 V; 3 currents. Open the results for details.');
    expect(w.summarySpeech).toContain('node GİRİŞ is 12 volts, node ÇIKIŞ is 8 volts');
    expect(w.currents.map((c) => sp(c.text))).toEqual(['4 mA from ground to node GİRİŞ through V1', '4 mA from node GİRİŞ to node ÇIKIŞ through R1', '4 mA from node ÇIKIŞ to ground through R2']);
    expect(annotateLines(n, CAPS_RESULTS).map((a) => sp(a.text))).toEqual(['delivers 48 mW, 4 mA out of +', '4 mA, GİRİŞ → ÇIKIŞ', '4 mA, ÇIKIŞ → 0']);
    // The overview's list says them as its part sentences do.
    expect(sp(describeCircuit(n))).toContain('3 parts and 2 nodes besides ground (GİRİŞ, ÇIKIŞ). V1: a 12 V source with its + side at node GİRİŞ');
    // Words only, never the keys' half lower-cased forms, nor toLowerCase's ('GİRİŞ'.toLowerCase() has combining dots).
    const words = [w.summary, w.summarySpeech, ...w.nodes.map((x) => x.name), ...w.currents.flatMap((c) => [c.text, c.speech]), describeCircuit(n)];
    expect(words.filter((x) => /gİrİŞ|ÇikiŞ|\u0307/.test(x))).toEqual([]);
  });

  it('a sweep\'s words and the Plot\'s names: v(GİRİŞ), "the voltage at node GİRİŞ"', () => {
    const n = parseNetlist(CAPS.replace('.op', '.dc V1 0 12 6'));
    const results: AnalysisResults = { dc: sweep('v(v-sweep)', 'V', [0, 6, 12], [['v(g__r____)', 'V', [0, 6, 12]], ['v(__iki__)', 'V', [0, 4, 8]], ['i(v1)', 'A', [0, -0.002, -0.004]]]), other: [] };
    const s = describeResults(n, results, run()).sweeps[0]!;
    expect(sp(s.text)).toContain('At V1 = 12 V: v(GİRİŞ) = 12 V, v(ÇIKIŞ) = 8 V, i(v1) = −4 mA.');
    expect(s.speech).toContain('the voltage at node GİRİŞ is 12 volts, the voltage at node ÇIKIŞ is 8 volts');
    expect(netlistVector(n, 'v(g__r____)')).toBe('v(GİRİŞ)');
    expect(netlistVector(n, 'v(__iki__,0)')).toBe('v(ÇIKIŞ,0)');
  });

  it('a node written with the micro sign is aµ, as written, not ngspice\'s au; ngspice\'s column keeps au', () => {
    // Native ngspice 47 and 42: v(au) = 5, i(v1) = −5 mA (W16: ngspice reads µ as u).
    const n = parseNetlist('* micro\nV1 aµ 0 5\nR1 aµ 0 1k\n.op\n.end\n');
    const w = describeResults(n, op({ au: 5 }, [['v1', -0.005, 'branch']]), run());
    expect(w.nodes.map((x) => [x.node, x.name, x.ngspice])).toEqual([['au', 'aµ', undefined]]);
    expect(w.summarySpeech).toContain('node aµ is 5 volts');
    expect(describeCircuit(n)).toContain('besides ground (aµ)');
    expect(netlistVector(n, 'v(au)')).toBe('v(aµ)');
  });

  it('the .tf check offers a node by its name as written: "Use ÇIKIŞ", never the key\'s "Use ÇikiŞ"', () => {
    const text = '* tf typo\nV1 GİRİŞ 0 12\nR1 GİRİŞ ÇIKIŞ 1k\nR2 ÇIKIŞ 0 2k\n.tf v(ÇIKIŞS) V1\n.end\n';
    const check = checkTraps(parseNetlist(text)).find((c) => c.id === 'tf-problems')!;
    expect(check.fixes.map((f) => f.label)).toEqual(['Use ÇIKIŞ']);
    // It writes the name as written: the same node, __iki__ for ngspice (W16), and the .tf check is gone.
    const fixed = applyFix(text, check.fixes[0]!);
    expect(fixed).toContain('.tf v(ÇIKIŞ) V1');
    expect(checkTraps(parseNetlist(fixed)).filter((c) => c.id === 'tf-problems')).toEqual([]);
    // A name in plain ASCII keeps the key, as the words do (W6).
    const ascii = checkTraps(parseNetlist('* tf typo\nV1 in 0 6\nR1 in Vout 1k\nR2 Vout 0 2k\n.tf v(Voutt) V1\n.end\n')).find((c) => c.id === 'tf-problems')!;
    expect(ascii.fixes.map((f) => f.label)).toEqual(['Use vout']);
  });

  it('a name in plain ASCII keeps ngspice\'s own spelling, in lower case (W6): IN is "in"', () => {
    const n = parseNetlist('* capitals\nV1 IN 0 6\nR1 IN Out 1k\nR2 Out 0 2k\n.op\n.end\n');
    const w = describeResults(n, op({ in: 6, out: 4 }, [['v1', -0.002, 'branch']]), run());
    expect(w.nodes.map((x) => [x.node, x.name])).toEqual([['in', 'in'], ['out', 'out']]);
    expect(sp(w.summary)).toContain('node in = 6 V, node out = 4 V');
  });
});

describe('code review 1, 4 and 5, words re-check 3: the .tf words name each output node one way', () => {
  /** .tf results as ngspice gives them: v(Transfer_function), v(output_impedance_at_V(...)), v(<source>#Input_impedance). */
  const tf = (value: number, at: string, out: number, source: string, input: number): AnalysisResults => ({
    tf: { transferFunction: value, outputImpedance: { at, value: out }, inputImpedance: { source, value: input } },
    other: [],
  });
  /** Every .tf word: the text and the speech of the results, and Explain's .tf line. */
  function tfWords(text: string, results: AnalysisResults): { at: string; text: string; speech: string; explain: string; output: string } {
    const n = parseNetlist(text);
    const w = describeResults(n, results, run());
    const ex = explainNetlist(n).find((e) => e.heading.startsWith('.tf'));
    return {
      at: w.tf?.at ?? '',
      text: sp([w.summary, w.tf?.transferFunction?.text, w.tf?.outputResistance?.text].join(' | ')),
      speech: w.summarySpeech,
      explain: sp(ex?.summary),
      output: ex?.fields.find((f) => f.label === 'output')?.meaning ?? '',
    };
  }

  it('a gnd inside v( ) is ground, as ngspice reads it (A3b): "between node out and ground", never "node gnd"', () => {
    // Native ngspice 47 and 42: transfer_function = 0.5, output_impedance_at_v(out,0) = 500, v1#input_impedance = 2000.
    for (const gnd of ['gnd', 'GND']) {
      const w = tfWords(`* tf to gnd\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.tf v(out,${gnd}) V1\n.end\n`, tf(0.5, 'v(out,0)', 500, 'v1', 2000));
      expect(w.at).toBe('between node out and ground');
      expect(w.text).toContain('output resistance between node out and ground: 500 Ω');
      expect(w.speech).toContain('the transfer function from V1 to the voltage between node out and ground is 0.5 volts per volt');
      expect(w.speech).toContain('the output resistance between node out and ground is 500 ohms');
      expect(w.explain).toContain('the output resistance between node out and ground, which is the Thévenin resistance seen between node out and ground');
      expect(w.output).toBe('the output: the voltage at node out, measured from ground');
      expect([w.text, w.speech, w.explain, w.output].join(' ')).not.toMatch(/node "?gnd/i);
    }
    // v(gnd) alone: the voltage at ground, whose output resistance ngspice gives as 0 (A3b).
    const at = tfWords('* tf at gnd\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.tf v(gnd) V1\n.end\n', tf(0, 'v(0)', 0, 'v1', 2000));
    expect(at.at).toBe('at ground');
    expect(at.speech).toContain('the transfer function from V1 to the voltage at ground is 0 volts per volt');
  });

  it('the .tf check never offers an ordinary node called gnd: written in v( ), gnd is ground (A3b)', () => {
    // gnd as the last word of Vx's line is an ordinary node (W9), but "Use gnd" would write v(gnd), which
    // ngspice reads as v(0): the voltage at ground, 0, not the voltage at that node (A3b).
    const text = '* tf typo near gnd\nV1 in 0 5\nR1 in x 1k\nVx x gnd\nR4 gnd 0 1k\n.tf v(gdn) V1\n.end\n';
    const check = checkTraps(parseNetlist(text)).find((c) => c.id === 'tf-problems')!;
    expect(check.title).toBe('.tf asks about node gdn, which is not in the circuit');
    expect(check.fixes.map((f) => f.label)).toEqual([]);
    // A name like ground that is an ordinary node is offered quoted, as the words say it.
    const named = checkTraps(parseNetlist('* tf typo near ground\nV1 in 0 5\nR1 in ground 1k\nR2 ground 0 1k\n.tf v(groud) V1\n.end\n')).find((c) => c.id === 'tf-problems')!;
    expect(named.fixes.map((f) => f.label)).toEqual(['Use "ground"']);
  });

  it('ground in a .tf output is never "not a node of the circuit", even in a circuit with nothing on ground', () => {
    // No part on ground: ngspice's own singular-matrix message speaks for that (M1), not the A6 note.
    const text = '* nothing on ground\nV1 in out 5\nR1 in out 1k\n.tf v(out,gnd) V1\n.end\n';
    const n = parseNetlist(text);
    const tf = explainNetlist(n).find((e) => e.heading.startsWith('.tf'))!;
    expect(tf.notes.filter((x) => /not a node of the circuit/.test(x))).toEqual([]);
    const w = describeResults(n, { tf: { transferFunction: 0, outputImpedance: { at: 'v(out,0)', value: 1 }, inputImpedance: { source: 'v1', value: 1000 } }, other: [] }, run());
    expect(w.warnings.filter((m) => m.code === 'tf-node-missing')).toEqual([]);
    // An ordinary missing node still gets it (A6).
    const missing = describeResults(parseNetlist('* a6\nV1 n1 0 6\nR1 n1 0 2\n.tf v(n9) V1\n.end\n'), { tf: { transferFunction: 0, outputImpedance: { at: 'v(n9)', value: 1 }, inputImpedance: { source: 'v1', value: 2 } }, other: [] }, run());
    expect(missing.warnings.map((m) => m.title)).toContain('n9 is not a node of the circuit');
  });

  it('an ordinary node named ground or 00 is quoted in the text and the speech alike: at node "ground"', () => {
    // Native ngspice 47 and 42: transfer_function = 0.5, output_impedance_at_v(ground) = 500 (W13: ground is an ordinary node).
    const w = tfWords('* tf at ground\nV1 in 0 5\nR1 in ground 1k\nR2 ground 0 1k\n.tf v(ground) V1\n.end\n', tf(0.5, 'v(ground)', 500, 'v1', 2000));
    expect(w.at).toBe('at node "ground"');
    expect(w.text).toContain('output resistance at node "ground": 500 Ω');
    expect(w.speech).toContain('the voltage at node "ground" is 0.5 volts per volt');
    expect(w.speech).toContain('the output resistance at node "ground" is 500 ohms');
    expect(w.explain).toContain('the output resistance at the node "ground", which is the Thévenin resistance seen at the node "ground"');
    expect(w.output).toBe('the output: the voltage at the node "ground", measured from ground');
    const between = tfWords('* tf in to ground\nV1 in 0 5\nR1 in ground 1k\nR2 ground 0 1k\n.tf v(in,ground) V1\n.end\n', tf(0, 'v(in,ground)', 500, 'v1', 2000));
    expect(between.at).toBe('between node in and node "ground"');
    const zeros = tfWords('* tf at 00\nV1 in 0 5\nR1 in 00 1k\nR2 00 0 1k\n.tf v(00) V1\n.end\n', tf(0.5, 'v(00)', 500, 'v1', 2000));
    expect(zeros.at).toBe('at node "00"');
    expect(zeros.speech).toContain('the voltage at node "00"');
  });

  it('the .tf check on a missing node named like ground quotes it, as Explain does on the same line', () => {
    // No part connects to "ground" (W13: an ordinary node), so ngspice reports a transfer function of 0 (A6).
    for (const out of ['ground', 'GROUND', '00']) {
      const n = parseNetlist(`* tf at a missing ground\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.tf v(${out}) V1\n.end\n`);
      const check = checkTraps(n).find((c) => c.id === 'tf-problems')!;
      expect(check.title).toBe(`.tf asks about node "${out}", which is not in the circuit`);
      expect(check.why).toBe(`There is no node called "${out}": no part connects to it. .tf v(${out}) needs a node of the circuit.`);
      expect(explainNetlist(n).find((e) => e.heading.startsWith('.tf'))!.notes).toContain(`"${out}" is not a node of the circuit: ngspice says nothing and reports a transfer function of 0.`);
    }
  });

  it('a .tf written after .end, which ngspice runs (A3c), is named from ngspice\'s own name for it, never "node v(out)"', () => {
    // Native ngspice 47 and 42: transfer_function = 0.3333, output_impedance_at_v(out,mid) = 666.67, v1#input_impedance = 3000.
    const w = tfWords('* tf after end\nV1 in 0 5\nR1 in out 1k\nR2 out mid 1k\nR3 mid 0 1k\n.end\n.tf v(out,mid) V1\n', tf(1 / 3, 'v(out,mid)', 666.6666666666667, 'v1', 3000));
    expect(w.at).toBe('between node out and node mid');
    expect(w.text).toContain('transfer function v(out,mid)/V1 = 0.3333 (V/V)');
    expect(w.text).toContain('input resistance seen by V1: 3 kΩ');
    expect(w.speech).toContain('the transfer function from V1 to the voltage between node out and node mid is 0.3333 volts per volt');
    expect(w.text + w.speech).not.toMatch(/node v\(/);
    // A name outside ASCII, which ngspice spells with underscores (W16): as the netlist writes it.
    const tr = tfWords('* tf after end\nV1 in 0 5\nR1 in çıkış 1k\nR2 çıkış 0 1k\n.end\n.tf v(çıkış) V1\n', tf(0.5, 'v(____k____)', 500, 'v1', 2000));
    expect(tr.at).toBe('at node çıkış');
    expect(tr.text).toContain('transfer function v(çıkış)/V1 = 0.5 (V/V)');
  });
});

describe('S11: a character in a node name that is not what it looks like is named on every line, never shown hidden', () => {
  const ZW = '\u200b';
  /** Every word a page could show about a netlist: Explain, the overview, and the checks with their fixes. */
  function shownWords(text: string): string[] {
    const n = parseNetlist(text);
    return [
      describeCircuit(n),
      ...explainNetlist(n).flatMap((e) => [e.summary, ...e.fields.map((f) => f.meaning), ...e.notes]),
      ...checkTraps(n).flatMap((c) => [c.title, c.why, c.ngspice, ...c.fixes.map((f) => f.label)]),
    ];
  }
  // Native ngspice 47 and 42 (invisible-character-3, look-alike-letter-5): ou<ZWSP>t is the node ou___t
  // and оut (Cyrillic о) the node __ut, separate nodes, without a message.
  const ZW_BOTH = `* zw\nV1 in 0 6\nR1 in out 1k\nR2 ou${ZW}t 0 2k\n.tf v(ou${ZW}t) V1\n.end\n`;
  const ZW_TF_ONLY = `* zw tf only\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.tf v(ou${ZW}t) V1\n.end\n`;
  const CY_BOTH = '* cy\nV1 in 0 6\nR1 in out 1k\nR2 \u043eut 0 2k\n.tf v(\u043eut) V1\n.end\n';
  const CY_TF_ONLY = '* cy tf only\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.tf v(\u043eut) V1\n.end\n';
  const IC_SAVE = `* ic save print\nV1 in 0 PULSE(0 5 0 1u 1u 1 2)\nR1 in ou${ZW}t 1k\nC1 ou${ZW}t 0 1u\n.ic v(ou${ZW}t)=1\n.save v(ou${ZW}t) v(in)\n.print tran v(ou${ZW}t)\n.tran 10u 1m uic\n.end\n`;

  it('no word Explain, the overview or the checks write hides an invisible character', () => {
    for (const text of [ZW_BOTH, ZW_TF_ONLY, IC_SAVE]) expect(shownWords(text).filter((w) => INVISIBLE.test(w)), text).toEqual([]);
  });

  it('Explain\'s .tf line names it, in the at-words, the output field and the missing-node note; the formula leaves it out', () => {
    const tf = explainNetlist(parseNetlist(ZW_BOTH)).find((e) => e.heading.startsWith('.tf'))!;
    expect(tf.summary).toContain('the transfer function v(out)/V1 (output ÷ input)');
    expect(tf.summary).toContain('the output resistance at node out (written with a zero-width space in it)');
    expect(tf.fields.find((f) => f.label === 'output')?.meaning).toBe('the output: the voltage at node out (written with a zero-width space in it), measured from ground');
    const only = explainNetlist(parseNetlist(ZW_TF_ONLY)).find((e) => e.heading.startsWith('.tf'))!;
    expect(only.notes).toContain('out (written with a zero-width space in it) is not a node of the circuit: ngspice says nothing and reports a transfer function of 0.');
  });

  it('the .ic, .save and .print lines say the voltage in words, the character named', () => {
    const ex = explainNetlist(parseNetlist(IC_SAVE));
    expect(sp(ex.find((e) => e.heading.startsWith('.ic'))!.fields.find((f) => f.label === 'node voltage')?.meaning)).toBe('the voltage at node out (written with a zero-width space in it) starts at 1 V');
    const save = ex.find((e) => e.heading.startsWith('.save'))!;
    expect(save.summary).toContain('the results file holds only what .save names (the voltage at node out (written with a zero-width space in it), v(in))');
    expect(ex.find((e) => e.heading.startsWith('.print'))!.fields.find((f) => f.label === 'result')?.meaning).toBe('the voltage at node out (written with a zero-width space in it): a result to keep');
  });

  it('a look-alike letter in a node name is named, as in a value: "node оut (written with the Cyrillic letter о, which looks like o)"', () => {
    const n = parseNetlist(CY_BOTH);
    const r2 = explainNetlist(n).find((e) => e.summary.startsWith('R2'))!;
    expect(sp(r2.summary)).toBe('R2 is a 2 kΩ resistor between node \u043eut (written with the Cyrillic letter \u043e, which looks like o) and ground (node 0).');
    expect(explainNetlist(n).find((e) => e.heading.startsWith('.tf'))!.summary).toContain('the output resistance at node \u043eut (written with the Cyrillic letter \u043e, which looks like o)');
    expect(describeCircuit(n)).toContain('3 nodes besides ground (in, out, \u043eut (written with the Cyrillic letter \u043e, which looks like o))');
    // A name all in another alphabet is meant as written, and a Turkish name is not a slip: neither is named.
    expect(describeCircuit(parseNetlist('* names\nV1 \u03b1\u03b2 0 1\nR1 \u03b1\u03b2 \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 1k\n.op\n.end\n'))).not.toContain('written with');
  });

  it('the card names it once, as its own sentence does: "node оut (written with the Cyrillic letter о, which looks like o) is higher"', async () => {
    // Native ngspice 47 and 42: оut is the node __ut, 6 V (look-alike-letter-5).
    const text = '* cy\nV1 \u043eut 0 6\nR1 \u043eut 0 1k\n.op\n.end\n';
    const s = buildSchematic(text, NOTEBOOK_OPTIONS);
    const part = s.circuit.parts.find((p) => p.name === 'R1')!;
    const state: CardState = { key: part.key, start: part.valueText, input: part.valueText, before: undefined, session: 1, kept: part.valueText };
    const across = cardContent(part, state, s, await solve(text, await engine), text).readouts.find((r) => r.tone === 'voltage')!;
    expect(across.sub?.[0]).toBe('node \u043eut (written with the Cyrillic letter \u043e, which looks like o) is higher');
    expect(across.speech.match(/written with/g)).toHaveLength(1);
  }, 30000);

  it('the overview and the results\' words name it too: "node out (written with a zero-width space in it)"', () => {
    const n = parseNetlist(ZW_BOTH);
    expect(describeCircuit(n)).toContain('3 nodes besides ground (in, out, out (written with a zero-width space in it))');
    expect(describeCircuit(n)).toContain('Analysis: transfer function from V1 to the voltage at node out (written with a zero-width space in it).');
    // Native ngspice 47 and 42: v(in) = 6, v(out) = 6, v(ou___t) = 0 (R2's node, a node of its own).
    const w = describeResults(n, op({ in: 6, out: 6, ou___t: 0 }, [['v1', 0, 'branch']]), run());
    expect(w.summarySpeech).toContain('node out (written with a zero-width space in it) is 0 volts');
    expect(w.summarySpeech).not.toMatch(INVISIBLE);
  });

  it('the editor\'s sentences name it too: "Node out (written with a zero-width space in it) renamed to out."', () => {
    const s = buildSchematic(`* zw\nV1 in 0 6\nR1 in ou${ZW}t 1k\nR2 ou${ZW}t 0 2k\n.op\n.end\n`, NOTEBOOK_OPTIONS);
    const r = applyEdit(s, { kind: 'rename-node', node: `ou${ZW}t`, name: 'out' });
    expect(r.ok && r.summary).toBe('Node out (written with a zero-width space in it) renamed to out.');
    expect(EDIT_STRINGS.node(`ou${ZW}t`)).toBe('node out (written with a zero-width space in it)');
    expect(nodeSaid(s, `ou${ZW}t`)).toBe('node out (written with a zero-width space in it)');
  });

  it('the .tf check keeps an error on a name that is a node but for such a character, naming it: never "There is no node called out" with "Use out" (critic of the fix)', async () => {
    const THIN_TF_ONLY = '* thin tf only\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.tf v(o ut) V1\n.end\n';
    const cases: [text: string, what: string, why: string, label: string][] = [
      [ZW_TF_ONLY, 'a zero-width space (U+200B)', 'It is a character you cannot see, and SPICE keeps it in the name', 'Take it out: use out'],
      [CY_TF_ONLY, 'the Cyrillic letter о', 'It looks like o, but SPICE knows only the plain letter o', 'Write the plain letter o: out'],
      [THIN_TF_ONLY, 'a thin space (U+2009)', 'It looks like a space, but SPICE keeps it in the name', 'Take it out: use out'],
    ];
    for (const [text, what, why, label] of cases) {
      const checks = checkTraps(parseNetlist(text));
      // The character's own warning stays; the .tf error says what the .tf asks about.
      expect(checks.some((c) => c.id === 'invisible-character' || c.id === 'look-alike-letter' || c.id === 'space-character'), text).toBe(true);
      const tf = checks.filter((c) => c.id === 'tf-problems');
      expect(tf.map((c) => [c.severity, c.title, c.why]), text).toEqual([
        ['error', `.tf asks about a node with ${what} in its name, not the node out`, `${why}, so this is not the node out the other lines name but another node, one no part connects to.`],
      ]);
      expect(tf[0]!.ngspice, text).toContain('The transfer function comes out 0 and the output impedance 1 Ω. [tf-problems-1, tf-problems-8]');
      expect(tf[0]!.fixes.map((f) => f.label), text).toEqual([label]);
      expect([tf[0]!.title, tf[0]!.why, ...tf[0]!.fixes.map((f) => f.label)].filter((w) => INVISIBLE.test(w) || /There is no node called|^Use out/.test(w)), text).toEqual([]);
      // ngspice's numbers for such a node are those of a node with nothing on it (tf-problems-8: 0 and 1 Ω),
      // so the run is marked as a typo's is; the fix gives out's own numbers (2/3 and 666.7 Ω).
      expect((await solve(text, await engine)).status, text).toBe('check');
      const fixed = await solve(applyFix(text, tf[0]!.fixes[0]!), await engine);
      expect(fixed.status, text).toBe('ok');
      expect(sp(fixed.words.tf?.transferFunction?.text), text).toBe('v(out)/V1 = 0.6667 (V/V)');
    }
    // A name that is no node even without the character: the error stays, the character named.
    const none = checkTraps(parseNetlist(`* zw no node\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.tf v(xy${ZW}z) V1\n.end\n`)).find((c) => c.id === 'tf-problems')!;
    expect(none.title).toBe('.tf asks about node xyz (written with a zero-width space in it), which is not in the circuit');
    expect(none.why).toBe('There is no node called xyz (written with a zero-width space in it): no part connects to it. .tf v(xyz) needs a node of the circuit.');
  }, 30000);
});

describe('words re-check 9: a node name with a letter outside a to z is refused with why, and a plain spelling no node has', () => {
  const START = '* start\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n';
  const rename = (text: string, node: string, name: string): string => {
    const r = applyEdit(buildSchematic(text, NOTEBOOK_OPTIONS), { kind: 'rename-node', node, name });
    return r.ok ? `renamed: ${r.summary}` : (r.reason ?? '');
  };

  it('çıkış: ngspice would write ç, ı and ş as underscores (W16), so the refusal says so and offers cikis', () => {
    // Native ngspice 47 and 42: çıkış is the node ____k____ (W16), ÇIKIŞ the node __iki__.
    expect(rename(START, 'out', 'çıkış')).toBe('ngspice writes each letter other than a to z (or A to Z) in a node name as underscores (ç as __), so PlainSpice can\'t use "çıkış": ngspice would call it ____k____. Write cikis.');
    expect(rename(START, 'out', 'ÇIKIŞ')).toBe('ngspice writes each letter other than a to z (or A to Z) in a node name as underscores (Ç as __), so PlainSpice can\'t use "ÇIKIŞ": ngspice would call it __iki__. Write CIKIS.');
    // The plain spelling is what the card then takes.
    expect(rename(START, 'out', 'cikis')).toBe('renamed: Node out renamed to cikis.');
  });

  it('never offers a name another node, ground or a name like ground already has', () => {
    expect(rename('* taken\nV1 cikis 0 6\nR1 cikis out 1k\nR2 out 0 2k\n.op\n.end\n', 'out', 'çıkış')).toMatch(/Write cikis2\.$/);
    expect(rename('* taken twice\nV1 cikis 0 6\nR1 cikis CIKIS2 1k\nR2 CIKIS2 out 1k\nR3 out 0 2k\n.op\n.end\n', 'out', 'çıkış')).toMatch(/Write cikis3\.$/);
    // gñd in plain letters is gnd, which is ground (W8): never offered.
    expect(rename(START, 'out', 'gñd')).toMatch(/Write gnd2\.$/);
    expect(rename(START, 'out', 'gröund')).toMatch(/Write ground2\.$/);
    // The node's own name is free: renaming cikis to çıkış offers cikis back.
    expect(rename('* own\nV1 in 0 6\nR1 in cikis 1k\nR2 cikis 0 2k\n.op\n.end\n', 'cikis', 'çıkış')).toMatch(/Write cikis\.$/);
  });

  it('the micro sign: ngspice reads it as u (W16), so aµ is the node au', () => {
    expect(rename(START, 'out', 'aµ')).toBe('ngspice reads the micro sign µ in a node name as u, so PlainSpice can\'t use "aµ": ngspice would call it au. Write au.');
  });

  it('a look-alike letter is named as the checks name it; a hidden character is named, never shown in quotes', () => {
    expect(rename(START, 'out', '\u043eut')).toBe('ngspice writes each letter other than a to z (or A to Z) in a node name as underscores (the Cyrillic letter \u043e, which looks like o, as __), so PlainSpice can\'t use "\u043eut": ngspice would call it __ut. Write out.');
    expect(rename(START, 'out', 'ou\u200bt')).toBe('PlainSpice keeps node names to the letters a to z (or A to Z), digits and _ (32 at most), so it can\'t use out (written with a zero-width space in it).');
  });

  it('other names keep the general refusal, which names the letters a to z as the check does; so does the hint', () => {
    expect(rename(START, 'out', 'v out')).toBe('PlainSpice keeps node names to the letters a to z (or A to Z), digits and _ (32 at most), so it can\'t use "v out".');
    expect(rename(START, 'out', '\u03b1\u03b2')).toBe('PlainSpice keeps node names to the letters a to z (or A to Z), digits and _ (32 at most), so it can\'t use "\u03b1\u03b2".');
    expect(t('nodeCardRenameHint')).toBe('Letters a to z (or A to Z), digits and _. A name another node already has makes the two one node.');
  });

  it('the Add a part form\'s new node says the same', () => {
    const s = buildSchematic(START, NOTEBOOK_OPTIONS);
    const f = formStart(s, 'R');
    const line = formLine(s, { ...f, ends: [{ node: 'in' }, { fresh: 'çıkış' }] });
    expect(line.ok).toBe(false);
    expect(!line.ok && line.reason).toBe('ngspice writes each letter other than a to z (or A to Z) in a node name as underscores (ç as __), so PlainSpice can\'t use "çıkış": ngspice would call it ____k____. Write cikis.');
  });
});

describe('words re-check 12: a source with a negative value between two nodes is said by its size and the right word', () => {
  const summary = (text: string, line: number): string => sp(explainNetlist(parseNetlist(text))[line - 1]!.summary);

  it('"So node a sits 3 V below node b.", never "−3 V above", however the value is written', () => {
    // Native ngspice 47 and 42: V1 a 0 6 / V2 a b -3 gives a = 6 V and b = 9 V (P3).
    for (const value of ['-3', 'DC -3', '-3V']) {
      const s = summary(`* negative\nV1 a 0 6\nV2 a b ${value}\nR1 b 0 1k\n.op\n.end\n`, 3);
      expect(s, value).toContain('So node a sits 3 V below node b.');
      expect(s, value).not.toMatch(/above/);
    }
    expect(summary('* milli\nV1 a 0 6\nV2 a b -3m\nR1 b 0 1k\n.op\n.end\n', 3)).toContain('So node a sits 3 mV below node b.');
    expect(summary('* positive\nV1 a 0 6\nV2 a b 3\nR1 b 0 1k\n.op\n.end\n', 3)).toContain('So node a sits 3 V above node b.');
  });

  it('a current source with a negative value pushes its size the other way: "from node a, through the source, into ground"', () => {
    // Native ngspice 47 and 42: I1 0 a -3m with 1 kΩ to ground gives a = −3 V (P4).
    const s = summary('* negative I\nI1 0 a -3m\nR1 a 0 1k\n.op\n.end\n', 2);
    expect(s).toContain('Its value is negative, so the current flows the other way: I1 pushes 3 mA from node a, through the source, into ground (node 0).');
    expect(s).not.toMatch(/pushes −/);
    expect(summary('* positive I\nI1 0 a 3m\nR1 a 0 1k\n.op\n.end\n', 2)).toContain('So I1 pushes 3 mA from ground (node 0), through the source, into node a.');
  });
});
