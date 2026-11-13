/**
 * The app's model (src/app/model.ts): reading a text once for the drawing, the panels and the runs;
 * a run (solveText) with what the panels need; which texts run on their own (planRun: not without an
 * analysis, not when they ask for very many points); when the Plot panel has something to draw; how
 * traps are grouped. (These replace the reducer of the old src/app/state.ts: the text now lives in
 * the store, store.ts, and the runs in live.ts, decision 0016.)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import type { AnalysisResults } from '../../src/engine/results.ts';
import type { RunResult } from '../../src/engine/types.ts';
import { errorTrap, groupTraps, hasSweeps, planRun, pointsAskedFor, readNetlist, solveText, type RunRecord } from '../../src/app/model.ts';
import { RUN_COPY_WORDS } from '../../src/spice/run-netlist.ts';
import type { Trap } from '../../src/spice/types.ts';

const DIVIDER = '* Start here\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n';
const root = resolve(import.meta.dirname, '../..');
let ngspice: NgspiceEngine;
beforeAll(async () => {
  ngspice = await NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(root, 'engine/dist/ngspice.wasm')));
});

function run(over: Partial<RunResult> = {}): RunResult {
  return {
    ok: true,
    unreliable: false,
    exitCode: 0,
    stdout: '',
    stderr: '',
    plots: [],
    diagnostics: [],
    timings: { instantiateMs: 1, runMs: 2, parseMs: 0 },
    ...over,
  };
}

function trap(line: number, severity: Trap['severity'], id = 'x'): Trap {
  return { id, severity, line, span: { from: 0, to: 1 }, title: 't', why: 'w', ngspice: 'n', fixes: [] };
}

describe('readNetlist', () => {
  it('reads a text once: the same netlist and checks for the same text', () => {
    const a = readNetlist(DIVIDER);
    expect(readNetlist(DIVIDER)).toBe(a);
    expect(a.netlist.lines.filter((l) => l.element).map((l) => l.element!.name.text)).toEqual(['V1', 'R1', 'R2']);
    expect(a.traps).toEqual([]);
    expect(readNetlist(DIVIDER.replace('1k', '1M')).traps.map((t) => t.id)).toContain('mega-as-milli');
  });
});

describe('planRun', () => {
  it('a netlist with an analysis runs on its own', () => {
    expect(planRun(DIVIDER)).toEqual({ run: true });
  });

  it('one without an analysis line is not sent to ngspice (it would have nothing to do)', () => {
    expect(planRun('* none\nV1 a 0 6\nR1 a 0 2\n.end\n')).toEqual({ run: false, reason: 'nothing' });
  });

  it('one that asks for very many points waits for Run, and says how many', () => {
    const long = '* long\nV1 a 0 PULSE(0 1 0 1n 1n 1u 2u)\nR1 a b 1k\nC1 b 0 1n\n.tran 1n 1 0 1n\n.end\n';
    const points = pointsAskedFor(readNetlist(long).netlist);
    expect(points).toBeGreaterThan(900_000_000); // 1 s in steps of at most 1 ns
    expect(planRun(long)).toEqual({ run: false, reason: 'long', points });
    // A short .tran runs live.
    expect(planRun('* short\nV1 a 0 1\nR1 a b 1k\nC1 b 0 1u\n.tran 10u 5m\n.end\n')).toEqual({ run: true });
  });
});

describe('solveText', () => {
  it('runs the text with .options savecurrents added for an operating point, and keeps what the panels need', async () => {
    const ran: string[] = [];
    let clock = 100;
    const record = await solveText(
      DIVIDER,
      {
        run: async (text) => {
          ran.push(text);
          clock += 12;
          return ngspice.run(text);
        },
      },
      () => clock,
    );
    expect(ran).toEqual([DIVIDER.replace('.end\n', '.options savecurrents\n.end\n')]);
    expect(record.text).toBe(DIVIDER);
    expect(record.added).toEqual(['.options savecurrents']);
    expect(record.ms).toBe(12);
    expect(record.status).toBe('ok');
    expect(record.netlist).toBe(readNetlist(DIVIDER).netlist);
    // The first screen's numbers: out = 6 V × 2k / 3k = 4 V, 2 mA through both resistors.
    expect(record.results.op?.nodes.find((n) => n.node === 'out')?.value).toBeCloseTo(4, 12);
    expect(record.words.nodes.find((n) => n.node === 'out')?.text).toMatch(/^4\sV$/);
    expect(record.annotations.length).toBeGreaterThan(0);
  });

  it('an error found by a check means the numbers are not answers, however cleanly ngspice ran', async () => {
    const text = '* no ground\nV1 a b 6\nR1 a b 2\n.op\n.end\n';
    const record = await solveText(text, { run: async () => run() });
    expect(record.status).toBe('check');
    expect(errorTrap(record)?.severity).toBe('error');
    expect(record.annotations).toEqual([]);
  });

  it('ngspice’s failed DC solution: the numbers are not answers, and the node with no single answer is named', async () => {
    // Node b hangs on a capacitor alone: no DC path to ground, so ngspice's matrix is singular there.
    const record = await solveText('* float\nV1 a 0 6\nR1 a 0 2\nC1 a b 1u\n.op\n.end\n', ngspice);
    expect(record.run.unreliable).toBe(true);
    expect(record.words.status).toBe('unreliable');
    // The check that explains it (an error) decides: the drawing shows no numbers.
    expect(record.status).toBe('check');
    expect(errorTrap(record)?.id).toBe('floating-dc');
    expect(record.annotations).toEqual([]);
    expect(record.noSingleAnswer?.at).toBe('b');
  });

  it('a text ngspice cannot take is never given to it: the run fails with the reason', async () => {
    const ran: string[] = [];
    const text = '* typo\nV1 a 0 9\nR1 a b 1k\nB1 b 0 V=v(a\n.op\n.end\n';
    await expect(solveText(text, { run: async (t) => (ran.push(t), run()) })).rejects.toThrow(RUN_COPY_WORDS.noClose(4, 'v('));
    expect(ran).toEqual([]);
  });

  it('a long title runs, cut in the copy, with the numbers of a short one, and the record says so', async () => {
    const long = DIVIDER.replace('* Start here', `* ${'Ş'.repeat(300)}`);
    const ran: string[] = [];
    const record = await solveText(long, { run: async (t) => (ran.push(t), ngspice.run(t)) });
    expect(ran[0]?.split('\n')[0]).toBe(`* ${'Ş'.repeat(251)}`);
    expect(record.notes).toEqual([RUN_COPY_WORDS.titleCut(1, 602, 504)]);
    expect(record.status).toBe('ok');
    const short = await solveText(DIVIDER, ngspice);
    expect(record.results.op?.nodes).toEqual(short.results.op?.nodes);
  });
});

describe('hasSweeps', () => {
  const sweep: AnalysisResults = {
    tran: {
      scale: { name: 'time', values: new Float64Array([0, 1]), unit: 's' },
      series: [{ name: 'v(out)', values: new Float64Array([0, 1]), unit: 'V' }],
    },
    other: [],
  };
  const record = (unreliable: boolean, checks: Trap[] = [], results: AnalysisResults = sweep): RunRecord =>
    ({ run: run({ unreliable }), checks, results }) as unknown as RunRecord;

  it('only for a run with .dc or .tran results whose numbers are answers', () => {
    expect(hasSweeps(record(false))).toBe(true);
    expect(hasSweeps(record(true))).toBe(false);
    expect(hasSweeps(undefined)).toBe(false);
    expect(hasSweeps(record(false, [], { other: [] }))).toBe(false);
    // An error-level check on the netlist that ran: its sweep is not an answer either (words review B1).
    expect(hasSweeps(record(false, [trap(2, 'error')]))).toBe(false);
    expect(hasSweeps(record(false, [trap(2, 'warning')]))).toBe(true);
  });
});

describe('groupTraps', () => {
  it('errors first, then warnings, then notes; each group keeps line order; empty groups left out', () => {
    const groups = groupTraps([trap(2, 'warning', 'a'), trap(3, 'error', 'b'), trap(5, 'warning', 'c'), trap(7, 'error', 'd')]);
    expect(groups.map((g) => g.severity)).toEqual(['error', 'warning']);
    expect(groups[0]!.traps.map((t) => t.id)).toEqual(['b', 'd']);
    expect(groups[1]!.traps.map((t) => t.id)).toEqual(['a', 'c']);
  });
});
