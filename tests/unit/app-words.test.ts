/**
 * The words of the frame around the drawing (src/app/words.ts): the status line (what ngspice is
 * doing, how the last run went, and why live runs wait for Run) and the hint line (what you can do
 * next). Placing parts comes in the next update, and the hint says so plainly rather than pretending.
 * One verb for running ngspice ("Running…", "Finished in 42 ms"); on a phone, no key names.
 */
import { describe, expect, it } from 'vitest';
import type { LiveState } from '../../src/app/live.ts';
import type { RunRecord } from '../../src/app/model.ts';
import { analysisName, hintWords, offsetWords, statusWords, type EngineStatus, type HintInput } from '../../src/app/words.ts';
import { explainLine } from '../../src/app/model.ts';
import { parseNetlist } from '../../src/spice/parse.ts';

const TEXT = '* t\nV1 a 0 6\nR1 a 0 2\n.op\n.end\n';
const READY: EngineStatus = { status: 'ready', loadMs: 300 };

function live(over: Partial<LiveState<RunRecord>> = {}): LiveState<RunRecord> {
  return { outcome: { kind: 'none' }, running: null, waiting: false, ...over };
}
function done(status: RunRecord['status'], over: Partial<RunRecord> = {}, text = TEXT): LiveState<RunRecord> {
  const result = { text, status, ms: 41.6, checks: [], words: { summary: 'Simulation finished, but no results. Open the results for details.' }, ...over } as unknown as RunRecord;
  return live({ outcome: { kind: 'done', text, result } });
}

describe('the status line', () => {
  it('while ngspice loads, while it runs, and when it has finished', () => {
    const loading = { main: 'Loading ngspice…', detail: 'The first visit downloads it; after that it loads from this device.', tone: 'busy' };
    expect(statusWords({ status: 'loading' }, live({ running: { text: TEXT, slow: false, manual: false, loading: true } }), TEXT)).toEqual(loading);
    expect(statusWords({ status: 'loading' }, live(), TEXT)).toEqual(loading);
    expect(statusWords(READY, live({ running: { text: TEXT, slow: false, manual: false } }), TEXT)).toEqual({ main: 'Running…', tone: 'busy' });
    expect(statusWords(READY, done('ok'), TEXT)).toEqual({ main: 'Finished in 42 ms', tone: 'ok' });
    // A change not run yet: running again in a moment.
    expect(statusWords(READY, done('ok'), `${TEXT}* changed\n`)).toEqual({ main: 'Running…', tone: 'busy' });
    expect(statusWords(READY, { ...done('ok'), waiting: true }, TEXT).tone).toBe('busy');
  });

  it('numbers that are not answers, in the Numbers panel’s words: a check found an error, ngspice’s answer is not one, no results', () => {
    const check = statusWords(READY, done('check', { checks: [{ id: 'no-ground', severity: 'error', line: 2, span: { from: 0, to: 1 }, title: 'No ground (node 0).', why: '', ngspice: '', fixes: [] }] }), TEXT);
    expect(check).toEqual({ main: 'Not reliable', detail: 'A check found an error: No ground (node 0).', tone: 'bad' });
    // Without the summary's pointer to a results view the shell no longer has.
    expect(statusWords(READY, done('unreliable'), TEXT)).toEqual({ main: 'Not reliable', detail: 'Simulation finished, but no results.', tone: 'bad' });
    const failed = (ngspiceError: boolean): LiveState<RunRecord> => done('failed', { words: { summary: 'x.', ngspiceError } as unknown as RunRecord['words'] });
    expect(statusWords(READY, failed(true), TEXT).main).toBe('Error');
    expect(statusWords(READY, failed(false), TEXT).main).toBe('No results');
  });

  it('why live runs wait for Run, each in plain words, with the numbers marked old after a change', () => {
    const paused = (p: LiveState<RunRecord>['paused'], base = live()): LiveState<RunRecord> => ({ ...base, paused: p! });
    expect(statusWords(READY, paused({ reason: 'link' }), TEXT)).toEqual({
      main: 'Not run yet',
      detail: 'This link opens without running: press Run (Ctrl+Enter) to run it.',
      tone: 'paused',
    });
    expect(statusWords(READY, paused({ reason: 'slow', ms: 2400 }, done('ok')), `${TEXT}* x\n`)).toEqual({
      main: 'Live runs paused',
      detail: 'The last run took 2.4 s, so ngspice does not run after every change: press Run (Ctrl+Enter). The numbers are from before your last change.',
      tone: 'paused',
    });
    expect(statusWords(READY, paused({ reason: 'long', points: 250_000 }), TEXT).detail).toBe(
      'This netlist asks for about 250,000 points, so ngspice does not run after every change: press Run (Ctrl+Enter).',
    );
    expect(statusWords(READY, paused({ reason: 'stopped' }), TEXT)).toEqual({ main: 'Stopped', detail: 'To run it again, press Run (Ctrl+Enter).', tone: 'paused' });
    expect(statusWords(READY, paused({ reason: 'timeout', seconds: 20 }), TEXT).main).toBe('Stopped after 20 s');
    // A phone has no keys to press: its Run button is tapped.
    expect(statusWords(READY, paused({ reason: 'link' }), TEXT, true).detail).toBe('This link opens without running: tap Run to run it.');
    expect(statusWords(READY, paused({ reason: 'long', points: 250_000 }), TEXT, true).detail).not.toContain('Ctrl');
  });

  it('nothing to run, a run that failed, and ngspice that could not start', () => {
    expect(statusWords(READY, live({ outcome: { kind: 'nothing', text: TEXT } }), TEXT)).toEqual({
      main: 'Nothing to run yet',
      detail: 'Add an analysis line, such as .op: the Checks panel offers one.',
      tone: 'paused',
    });
    expect(statusWords(READY, live({ outcome: { kind: 'failed', text: TEXT, reason: 'out of memory' } }), TEXT)).toEqual({ main: 'ngspice could not run', detail: 'out of memory', tone: 'bad' });
    expect(statusWords({ status: 'failed', reason: 'no WebAssembly' }, live(), TEXT)).toEqual({ main: 'ngspice could not start', detail: 'no WebAssembly', tone: 'bad' });
    // An empty netlist is never sent to ngspice: the status says to type a part.
    expect(statusWords(READY, live({ outcome: { kind: 'nothing', text: '' } }), '', false, false)).toEqual({
      main: 'Nothing to run yet',
      detail: 'The netlist has no parts yet: add one on the drawing, or type its line in the Netlist panel (such as R1 in out 1k).',
      tone: 'paused',
    });
  });
});

describe('the analysis on the status line', () => {
  it('names the first analysis in words, with its dot command', () => {
    const netlist = parseNetlist(TEXT);
    const explains = netlist.analyses.flatMap((i) => [explainLine(netlist, i)].filter((e) => e !== undefined));
    expect(analysisName(explains, netlist)).toBe('Operating point · .op');
    // Words with brackets of their own get no second pair.
    const tran = parseNetlist('* t\nV1 a 0 1\nR1 a 0 1\n.tran 1u 1m\n.end\n');
    const tranName = analysisName(tran.analyses.flatMap((i) => [explainLine(tran, i)].filter((e) => e !== undefined)), tran);
    expect(tranName).toMatch(/ · \.tran$/);
    expect(tranName).not.toMatch(/\)\s*\(/);
    expect(analysisName([], parseNetlist('* t\nR1 a 0 1\n.end\n'))).toBeUndefined();
  });
});

describe('the hint line', () => {
  const base: HintInput = { phone: false, tool: 'select', selectedName: undefined, typeHint: undefined, whole: true, turned: false, asDrawn: false };

  it('says what to do next on a computer and on a phone', () => {
    expect(hintWords(base)).toBe('Click a part to see its numbers and change it · drag a part to move it · choose a part in the margin to add one · Ctrl K for every command');
    expect(hintWords({ ...base, phone: true })).toBe('Tap a part to see its numbers and change it');
    expect(hintWords({ ...base, phone: true, whole: false })).toBe('Drag the paper to see the rest of the circuit');
    expect(hintWords({ ...base, phone: true, invite: 'R1' })).toBe('Tap R1 and type a new value: the numbers move as you type');
    // A computer whose sticky note has no free paper (large text on a small window) invites on the hint line.
    expect(hintWords({ ...base, invite: 'R1' })).toBe('Click R1 and type a new value: the numbers move as you type · Ctrl K for every command');
    expect(hintWords({ ...base, phone: true, turned: true })).toBe('Turned to fit the screen · tap a part to change it');
    // Turned, but still not whole (a long circuit on a small phone): it does not claim to fit.
    expect(hintWords({ ...base, phone: true, turned: true, whole: false })).toBe('Turned to fit as well as it can · drag the paper to see the rest');
    expect(hintWords({ ...base, phone: true, asDrawn: true, whole: false })).toBe('As drawn, not turned · drag the paper to see the rest');
    // A video's own drawing (its *@ lines, unchanged): the way the video draws it (decision 0015).
    expect(hintWords({ ...base, phone: true, asDrawn: true, whole: false, video: true })).toBe('As in the video, not turned · drag the paper to see the rest');
    // Nothing to draw yet.
    expect(hintWords({ ...base, empty: true })).toBe('Choose a part in the margin and click the paper to place it, or press A to add one between two nodes · Ctrl K for every command');
    expect(hintWords({ ...base, empty: true, phone: true })).toBe('Tap Parts, choose one, then tap the paper where it goes');
  });

  it('follows the selection and the card', () => {
    expect(hintWords({ ...base, selectedName: 'R1' })).toBe('R1 selected · Enter opens its card · T turns it · Shift+arrows move it · Delete deletes it · Esc lets go');
    expect(hintWords({ ...base, phone: true, selectedName: 'R1' })).toBe('R1 selected · tap it again to change it · hold it, then drag, to move it');
    // A node, ground, a piece of wire: what each can do from the keyboard.
    expect(hintWords({ ...base, selectedNode: 'out' })).toBe('Node out selected · Enter opens its card, to rename it · Shift+arrows move its name · Esc lets go');
    expect(hintWords({ ...base, selectedGround: true })).toBe('Ground selected · Enter opens its card · Shift+arrows move the symbol · Delete deletes it · Esc lets go');
    expect(hintWords({ ...base, selectedWire: 'out', selectedNode: 'out' })).toBe('A piece of the wire of out selected · Delete deletes it · Esc lets go');
    expect(hintWords({ ...base, nodeCard: { name: 'out', ground: false } })).toBe('Type a new name for out, then Enter (or Rename) · Esc closes the card');
    // A card just opened: its value is selected, so T and M still turn and mirror the part; once a value
    // is typed, they are letters of it until the card closes.
    expect(hintWords({ ...base, selectedName: 'R1', typeHint: 'Type a value, such as 3, 4.7k or 1meg' })).toBe('Type a value, such as 3, 4.7k or 1meg · T turns it, M mirrors it · Enter or Esc closes the card');
    expect(hintWords({ ...base, selectedName: 'R1', typeHint: 'Type a value, such as 3, 4.7k or 1meg', typed: true })).toBe(
      'Type a value, such as 3, 4.7k or 1meg: ngspice runs again as you type · Enter or Esc closes the card (then T turns it)',
    );
    // Live runs paused: it does not promise numbers that will not come.
    expect(hintWords({ ...base, typeHint: 'Type a value, such as 3, 4.7k or 1meg', paused: true })).toBe(
      'Type a value, such as 3, 4.7k or 1meg · live runs are paused, so press Run (Ctrl+Enter) to see the new numbers · Enter or Esc closes the card',
    );
  });

  it('says, for each tool, what to do now and how to get out (decision 0017)', () => {
    expect(hintWords({ ...base, tool: 'R' })).toBe('Click the paper to place a resistor · T turns it · M mirrors it · Shift+click places more than one · Esc goes back to Select');
    expect(hintWords({ ...base, tool: 'I', phone: true })).toBe('Tap the paper where a current source goes · Select goes back');
    // Where the part would land: the nodes it would join, or the model's reason it cannot go there.
    expect(hintWords({ ...base, tool: 'R', place: { joins: 'its ends connect to in and a new node' } })).toBe('Click to place a resistor here: its ends connect to in and a new node · T turns it · M mirrors it · Esc goes back to Select');
    // A ground symbol has no M (it looks the same mirrored).
    expect(hintWords({ ...base, tool: 'ground' })).toBe('Click the paper to place a ground symbol · T turns it · Shift+click places more than one · Esc goes back to Select');
    expect(hintWords({ ...base, tool: 'R', place: { refused: 'That place is taken by R2.' } })).toBe('Not here: That place is taken by R2 · T turns it · Esc goes back to Select');
    expect(hintWords({ ...base, tool: 'R', phone: true, place: { joins: 'its ends connect to in and a new node' } })).toBe('Its ends connect to in and a new node · tap Place (or the part again) to place it here');
    expect(hintWords({ ...base, tool: 'wire' })).toBe('Click a pin, a wire or a node’s name to start a wire · Esc goes back to Select');
    expect(hintWords({ ...base, tool: 'wire', wire: { started: true } })).toBe('Click another pin, wire or node’s name to end the wire · click the paper to make a corner · Esc cancels this wire');
    expect(hintWords({ ...base, tool: 'wire', phone: true, wire: { started: true } })).toBe('Tap another pin, wire or name to end the wire · tap the paper to make a corner');
    expect(hintWords({ ...base, tool: 'wire', wire: { started: true, refused: 'There is no way for a wire between those two points.' } })).toBe(
      'There is no way for a wire between those two points · Esc cancels this wire',
    );
    // Moving: dragged, picked up with the card's Move, or refused where it is.
    expect(hintWords({ ...base, moving: { name: 'R2', how: 'drag' } })).toBe('Drop R2 where it goes · Esc puts it back');
    // A part turns and mirrors while it moves; a ground symbol or a name does not, and is said in lower case mid-sentence.
    expect(hintWords({ ...base, moving: { name: 'R2', how: 'drag', part: true } })).toBe('Drop R2 where it goes · T turns it · M mirrors it · Esc puts it back');
    expect(hintWords({ ...base, moving: { name: 'the ground symbol', how: 'drag' } })).toBe('Drop the ground symbol where it goes · Esc puts it back');
    expect(hintWords({ ...base, moving: { name: 'the ground symbol', how: 'drag', refused: 'A wire runs there.' } })).toBe('The ground symbol can’t go here: A wire runs there · Esc puts it back');
    // Chosen with the keys, a tool's hint gives the keyboard's way to use it.
    expect(hintWords({ ...base, tool: 'R', keys: true })).toBe('Enter on a node adds a resistor from that node, in a form (A from anywhere) · or click the paper to place it · Esc goes back to Select');
    expect(hintWords({ ...base, tool: 'wire', keys: true })).toBe('Enter on a node starts a wire there, Enter on another node ends it · or click a pin · Esc goes back to Select');
    expect(hintWords({ ...base, tool: 'wire', keys: true, wire: { started: true } })).toBe('Enter on another node ends the wire there · Esc cancels this wire');
    expect(hintWords({ ...base, moving: { name: 'R2', how: 'pick' } })).toBe('Click where R2 goes · arrow keys move it · Enter puts it down · Esc puts it back');
    expect(hintWords({ ...base, moving: { name: 'R2', how: 'drag', refused: 'A pin would touch out, another node.' } })).toBe('R2 can’t go here: A pin would touch out, another node · Esc puts it back');
    // A phone has no Esc key: a finger is lifted, and a refused place sends the part back.
    expect(hintWords({ ...base, phone: true, moving: { name: 'R2', how: 'drag' } })).toBe('Lift your finger where R2 goes');
    expect(hintWords({ ...base, phone: true, moving: { name: 'R2', how: 'drag', refused: 'That place is taken by R1.' } })).toBe('R2 can’t go here: That place is taken by R1 · let go here and it goes back');
    // A phone shows the drawing as drawn while editing, and says so.
    expect(hintWords({ ...base, tool: 'C', phone: true, editingAsDrawn: true })).toBe('Shown as drawn while you edit · Tap the paper where a capacitor goes · Select goes back');
    expect(hintWords({ ...base, undrawn: true })).toBe('Open the Netlist panel to change the circuit · Ctrl K for every command');
  });
});

describe('where a part moved with the keys is', () => {
  it('says how far it is from where it was, in squares, or that it is back', () => {
    expect(offsetWords(2, 1)).toBe('2 squares right and 1 square down from where it was');
    expect(offsetWords(-1, 0)).toBe('1 square left from where it was');
    expect(offsetWords(0, -3)).toBe('3 squares up from where it was');
    expect(offsetWords(0, 0)).toBe('back where it was');
  });
});
