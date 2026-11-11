/**
 * The words of the frame around the drawing (src/app/words.ts): the status line (what ngspice is
 * doing, how the last run went, and why live runs wait for Run) and the hint line (what you can do
 * next). Placing parts comes in the next update, and the hint says so plainly rather than pretending.
 * One verb for running ngspice ("Running…", "Finished in 42 ms"); on a phone, no key names.
 */
import { describe, expect, it } from 'vitest';
import type { LiveState } from '../../src/app/live.ts';
import type { RunRecord } from '../../src/app/model.ts';
import { analysisName, hintWords, statusWords, type EngineStatus, type HintInput } from '../../src/app/words.ts';
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
      detail: 'The netlist has no parts yet: type one in the Netlist panel, such as R1 in out 1k.',
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
    expect(hintWords(base)).toBe('Click a part to see its numbers and change its value · drag the paper to move around · Ctrl K for every command');
    expect(hintWords({ ...base, phone: true })).toBe('Tap a part to see its numbers and change it');
    expect(hintWords({ ...base, phone: true, whole: false })).toBe('Drag the paper to see the rest of the circuit');
    expect(hintWords({ ...base, phone: true, invite: 'R1' })).toBe('Tap R1 and type a new value: the numbers move as you type');
    // A computer whose sticky note has no free paper (large text on a small window) invites on the hint line.
    expect(hintWords({ ...base, invite: 'R1' })).toBe('Click R1 and type a new value: the numbers move as you type · Ctrl K for every command');
    expect(hintWords({ ...base, phone: true, turned: true })).toBe('Turned to fit the screen · tap a part to change it');
    // Turned, but still not whole (a long circuit on a small phone): it does not claim to fit.
    expect(hintWords({ ...base, phone: true, turned: true, whole: false })).toBe('Turned to fit as well as it can · drag the paper to see the rest');
    expect(hintWords({ ...base, phone: true, asDrawn: true, whole: false })).toBe('As drawn, not turned · drag the paper to see the rest');
    // Nothing to draw yet.
    expect(hintWords({ ...base, empty: true })).toBe('Type a part in the Netlist panel, or open an example · Ctrl K for every command');
  });

  it('follows the selection and the card', () => {
    expect(hintWords({ ...base, selectedName: 'R1' })).toBe('R1 selected · Enter opens its card · arrow keys move along the wires · Esc lets go');
    expect(hintWords({ ...base, phone: true, selectedName: 'R1' })).toBe('R1 selected · tap it again to change it');
    expect(hintWords({ ...base, selectedName: 'R1', typeHint: 'Type a value, such as 3, 4.7k or 1meg' })).toBe(
      'Type a value, such as 3, 4.7k or 1meg: ngspice runs again as you type · Enter or Esc closes the card',
    );
    // Live runs paused: it does not promise numbers that will not come.
    expect(hintWords({ ...base, typeHint: 'Type a value, such as 3, 4.7k or 1meg', paused: true })).toBe(
      'Type a value, such as 3, 4.7k or 1meg · live runs are paused, so press Run (Ctrl+Enter) to see the new numbers · Enter or Esc closes the card',
    );
  });

  it('says plainly that placing parts and drawing wires come in the next update', () => {
    expect(hintWords({ ...base, tool: 'R' })).toBe('Placing a resistor comes in the next update of PlainSpice. For now, click a part on the drawing to change its value. Esc goes back to Select.');
    expect(hintWords({ ...base, tool: 'wire', phone: true })).toBe('Drawing wires comes in the next update of PlainSpice. Tap Select to go back.');
    expect(hintWords({ ...base, undrawn: true })).toBe('Open the Netlist panel to change the circuit · Ctrl K for every command');
  });
});
