// @vitest-environment jsdom
/**
 * The Numbers panel's .tf table after the re-check (S8; decision 0015, C9p): a ratio the circuit makes
 * exactly 0 reads "0 V/V", and the column of what ngspice printed keeps its rounding noise.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { NumbersPanel } from '../../src/app/components/NumbersPanel.tsx';
import { solveText } from '../../src/app/model.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';

afterEach(cleanup);

const root = resolve(import.meta.dirname, '../..');
let ngspice: NgspiceEngine;
beforeAll(async () => {
  // A compiled module, not bytes: Node's Buffer is from another realm under jsdom.
  ngspice = await NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, await WebAssembly.compile(readFileSync(resolve(root, 'engine/dist/ngspice.wasm'))));
});

const seen = (c: Element): string => (c.querySelector('code') ?? c.querySelector('span[aria-hidden="true"]:not(:empty)') ?? c).textContent!.replace(/[  ]/g, ' ').trim();

describe('the Numbers panel after the re-check (12 November 2026)', () => {
  it('a balanced bridge\'s .tf v(a,b) V1 reads 0 V/V, and ngspice\'s column keeps -5.551115e-17 (S8)', async () => {
    const text = '* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\n.tf v(a,b) V1\n.end\n';
    const result = await solveText(text, ngspice);
    render(<NumbersPanel outcome={{ kind: 'done', text, result }} text={text} running={false} paused={false} colours={new Map()} plotAvailable={false} onGoToLine={() => {}} onShowChecks={() => {}} onShowPlot={() => {}} />);
    const table = screen.getAllByRole('table').find((t) => /\.tf/.test(t.querySelector('caption')?.textContent ?? ''))!;
    const ratio = within(table).getAllByRole('row').slice(1).map((r) => [...r.querySelectorAll('th, td')].map(seen))[0]!;
    expect(ratio.slice(1)).toEqual(['0 V/V', '-5.551115e-17']);
  });

  it('a real current ngspice gives as exactly 0 reads as the exact 454.1 pA, and ngspice\'s column keeps its 0 (C9n)', async () => {
    const text = '* t\nV1 top1 0 1.5\nR1 top1 d2 270k\nR2 d2 0 820\nR3 d2 p3 1n\nR4 p3 0 10meg\n.op\n.end\n';
    const result = await solveText(text, ngspice);
    render(<NumbersPanel outcome={{ kind: 'done', text, result }} text={text} running={false} paused={false} colours={new Map()} plotAvailable={false} onGoToLine={() => {}} onShowChecks={() => {}} onShowPlot={() => {}} />);
    const table = screen.getAllByRole('table').find((t) => /current/i.test(t.querySelector('caption')?.textContent ?? ''))!;
    const rows = within(table).getAllByRole('row').slice(1).map((r) => [...r.querySelectorAll('th, td')].map(seen));
    const r3 = rows.find((r) => r[0] === 'R3')!;
    expect([r3[1], r3[r3.length - 1]]).toEqual(['454.1 pA', 'i(@r3[i]) = 0.000000e+00']);
  });
});

