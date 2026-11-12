// @vitest-environment jsdom
/**
 * The words review of milestone 2's final reviews (12 November 2026, decision 0017): what the app
 * says while a circuit is built, checked against the model and against what ngspice does.
 *
 * - W1: the sentence for the .op and .end a blank page gets says what .end is without claiming it
 *   stops ngspice (fact S25: ngspice reads past it), as Explain's own note for .end says, and never
 *   that PlainSpice wrote a .end the netlist already had.
 * - W2: Connections say that Connect to makes two nodes one, with every part on them, and how to move
 *   only one end; they promise no wire, since a circuit without ground gets a ground symbol instead.
 * - W3: a card's red-pen line offers "the fix" only for a check the Checks panel has a fix for.
 * - W4: E, F, G and H as one tool are a "dependent source", the channel's word.
 * - W7: Reverse is "reversed", never "turned round" (a half turn is refused); a turn while moving does
 *   not promise that the part lands.
 * - W8: a node in a sentence is "node in" (ground is "ground"), on the card too; a button's name never
 *   ends on a bare node name.
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
import { addPartEdit, connectEdit, endRoles, endsOf, formStart, handFor, nodeChoices, nodeSaid, placeEdit, starterWords } from '../../src/app/editing.ts';
import { hintWords, type HintInput } from '../../src/app/words.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { en } from '../../src/i18n/en.ts';
import { t } from '../../src/i18n/index.ts';
import { NOTEBOOK_OPTIONS, solve, type Solution } from '../../src/notebook/index.ts';
import { EDIT_STRINGS, GROUND, buildSchematic, type Schematic } from '../../src/schematic/index.ts';
import { EXPLAIN_STRINGS, explainNetlist } from '../../src/spice/explain.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { checkTraps } from '../../src/spice/traps.ts';

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
    expect(said).toContain('Keep .end as the netlist’s last line');
    expect(said).toContain('ngspice still reads lines after .end');
    expect(said).not.toMatch(/stops|where the netlist ends|marks where/);
    // The same as Explain says for the .end line (S25), so the two never disagree.
    expect(EXPLAIN_STRINGS.endKeepsReading).toContain('still reads the lines after it');
    expect(EXPLAIN_STRINGS.endKeepsReading).toContain('Keep .end as the last line.');
  });

  it('says PlainSpice wrote only what it wrote: never a .end the netlist already had', () => {
    /** The lines an edit added (each line counted as often as it is there). */
    const added = (before: string, after: string): string[] => {
      const left = before.split(/\r?\n/).map((l) => l.trim());
      return after
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => {
          const i = left.indexOf(l);
          if (i < 0) return true;
          left.splice(i, 1);
          return false;
        });
    };
    /** The netlist lines the summary says PlainSpice wrote: the dot lines named in its sentence with "wrote". */
    const claimed = (summary: string): string[] => {
      const sentence = summary.split(/(?<=\.)\s+(?=[A-Z])/).find((x) => /\bwrote\b/.test(x)) ?? '';
      return [...sentence.matchAll(/(?<![\w.])\.[a-z]+\b/g)].map((m) => m[0]);
    };
    // A blank page gets .op and .end; a page whose student typed .end (and nothing else) gets .op only.
    for (const typed of ['', '* my circuit\n.end\n']) {
      const s = buildSchematic(typed, NOTEBOOK_OPTIONS);
      const placed = placeEdit(s, handFor('R'), { x: 4, y: 0 });
      const form = addPartEdit(s, { ...formStart(s, 'R'), value: '1k' });
      for (const r of [placed, form]) {
        expect(r.ok, typed).toBe(true);
        if (!r.ok) continue;
        expect(r.summary).toContain(starterWords());
        const wrote = added(typed, r.text);
        expect(claimed(r.summary), typed).toEqual(['.op']);
        for (const line of claimed(r.summary)) expect(wrote, `${line} after ${JSON.stringify(typed)}`).toContain(line);
        // One .end either way, the last line.
        expect(r.text.match(/^\.end$/gm)).toHaveLength(1);
        expect(r.text.trimEnd().split('\n').at(-1)).toBe('.end');
      }
    }
    expect(added('* my circuit\n.end\n', placeEdit(buildSchematic('* my circuit\n.end\n', NOTEBOOK_OPTIONS), handFor('R'), { x: 4, y: 0 }).text)).not.toContain('.end');
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
    // Disconnect: the card passes the node as a sentence says it, "node in" or "ground (node 0)", so
    // the name never ends on a bare node name heard as "from in…" (W8).
    const s = buildSchematic(START, NOTEBOOK_OPTIONS);
    expect(endsOf(s, 'r1').map((end) => t('connDisconnectLabel', { role: end.role, name: 'R1', node: end.said }))).toEqual(['Disconnect the end 1 of R1 from node in', 'Disconnect the end 2 of R1 from node out']);
    expect(endsOf(s, 'v1').map((end) => t('connDisconnectLabel', { role: end.role, name: 'V1', node: end.said }))).toEqual(['Disconnect the + end of V1 from node in', 'Disconnect the − end of V1 from ground (node 0)']);
    for (const { node } of nodeChoices(s)) expect(nodeSaid(s, node)).toMatch(/^(node \S+|ground \(node 0\))$/);
    expect(t('connDisconnectLabel', { role: end1, name: 'R1', node: 'node in' }).startsWith(t('connDisconnect'))).toBe(true);
    expect(t('connDisconnectLabel', { role: end2, name: 'R2', node: t('groundWords') })).toBe('Disconnect the end 2 of R2 from ground (node 0)');
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

  it('never asks to put down a part being moved without saying Esc puts it back: where a half turn is refused, it can only go back (merge of the lanes)', () => {
    expect(EDIT_STRINGS.noHalfTurn('R1')).toBe('A half turn of R1 where it stands would loop its wires round it. To swap its two ends, use Reverse once R1 is back in place.');
    expect(t('reverseWhileMoving', { name: 'R1' })).toBe('Put R1 down first (Esc puts it back), then Reverse swaps its two ends in the netlist.');
    expect(t('deleteWhileMoving', { name: 'R1' })).toBe('Put R1 down first (Esc puts it back), then Delete deletes it.');
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

  it('quotes an ordinary node named like ground, as the overview does: node "ground" is higher (W13, merge of the lanes)', async () => {
    const named = await opened('* a node named ground\nV1 ground 0 5\nR1 ground 0 1k\n.op\n.end\n', 'R1');
    const across = named.card.readouts.find((r) => r.tone === 'voltage')!;
    expect(across.sub?.[0]).toBe('node "ground" is higher');
    expect(across.speech).toContain('5 volts across R1, node "ground" is higher.');
    // The short line under the current stays a label: the name bare, quoted only because it reads as ground.
    expect(named.card.readouts.find((r) => r.tone === 'current')!.sub).toEqual(['from "ground" to ground']);
  }, 30000);
});

describe('W11: whole lines ngspice does not read', () => {
  it('are lines it "skips" (the drawing lines too); "ignores" is kept for characters inside a line', () => {
    expect(t('netlistFoot')).toContain('Lines that start with *@ say where parts are drawn: ngspice skips them.');
    expect(CATALOG.filter(([, v]) => /\*@/.test(v) && /ignor/.test(v)).map(([k]) => k)).toEqual([]);
  });

  // The Checks panel said the lines after ".end;done" "are ignored" and a + line after the title is
  // "ignored silently", where Explain says "skips" for the same lines (words re-check 10).
  it('are lines it "skips" in the Checks panel too, as Explain says for the same line, and lines ngspice reads are never said to be skipped', () => {
    const glued = '* t\nV1 in 0 6\nR1 in out 1k\n.op\n.end;done\nR2 out 0 2k\n';
    const plain = glued.replace('.end;done', '.end');
    const lost = '* t\n+ R1 n1 0 2\nI1 0 n1 1\nR2 n1 0 4\n.op\n.end\n';
    const title = '.op\nV1 a 0 1\nR1 a 0 1\n.end\n';
    const checks = (text: string, id: string): string[] => checkTraps(parseNetlist(text)).filter((c) => c.id === id).flatMap((c) => [c.title, c.why, c.ngspice]);
    const explained = (text: string, line: number): string => explainNetlist(parseNetlist(text)).find((e) => e.line === line)?.summary ?? '';
    for (const [text, id] of [[glued, 'after-end'], [plain, 'after-end'], [lost, 'lost-continuation'], [title, 'missing-title']] as const) {
      expect(checks(text, id).length, id).toBeGreaterThan(0);
      expect(checks(text, id).filter((x) => /ignor/i.test(x)), `${id}: ${text}`).toEqual([]);
    }
    // The same line, the same word: line 6 after ".end;done", and the + line right after the title.
    expect(explained(glued, 6)).toContain('skips this line');
    expect(checks(glued, 'after-end')).toEqual([
      'Lines after .end',
      'ngspice stops reading at this .end, so it skips the lines after it. Keep .end as the last line.',
      'ngspice stops reading at a .end with a comment glued to it (.end;...) and skips every line after it, without a message. [after-end-2]',
    ]);
    expect(explained(lost, 2)).toContain('ngspice skips it silently');
    expect(checks(lost, 'lost-continuation')[2]).toBe('ngspice has no line to join it to and skips it silently. [lost-continuation-3]');
    // After a plain .end ngspice reads the lines: never "skipped", nor "looks ignored"; Explain's own words for .end.
    expect(checks(plain, 'after-end')[1]).toBe(
      'ngspice does not stop reading at .end: it still reads these lines when it runs a file, so they are part of the circuit. Keep .end as the last line.',
    );
    expect(checks(plain, 'after-end').filter((x) => /skip|looks/.test(x))).toEqual([]);
    // A command on line 1 is the title: it never runs, as the check's own why says.
    expect(checks(title, 'missing-title')[0]).toBe('Line 1 is the title, so .op never runs');
    // ngspice reads a .print or .plot line and answers ".print line ignored since rawfile was produced": Explain
    // and the Checks panel both say it leaves the line out, never that it skips it (names lane critic 2, 6).
    for (const kind of ['.print', '.plot']) {
      const printed = `* t\nV1 in 0 12\nR1 in \u00e7 1k\nR2 \u00e7 0 2k\n.dc V1 0 12 6\n${kind} dc v(\u00e7)\n.end\n`;
      expect(explained(printed, 6), kind).toContain(`and then ngspice leaves the ${kind} line out ("${kind} line ignored since rawfile was produced")`);
      expect(checks(printed, 'non-ascii-node').join(' '), kind).toContain(`PlainSpice's run leaves .print and .plot lines out (ngspice: "${kind} line ignored since rawfile was produced.")`);
      expect([explained(printed, 6), ...checks(printed, 'non-ascii-node')].filter((x) => /skip/.test(x)), kind).toEqual([]);
    }
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
