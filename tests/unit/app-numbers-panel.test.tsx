// @vitest-environment jsdom
/**
 * The Numbers panel's ngspice columns (src/app/components/NumbersPanel.tsx) show what ngspice gave,
 * in its own spelling: v(giri__) for the node the netlist calls giriş (W16), i(@r__[i]) for Rş (W18),
 * and the exact value of a current or a voltage said as 0 because it is rounding noise of a 0 (C9,
 * C9d), next to the plain columns that say 0 A and 0 V (final reviews, student noise-as-answers and
 * kept F3; critic of their fixes).
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
  ngspice = await NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(root, 'engine/dist/ngspice.wasm')));
});

/** A cell as seen: its code, or the number shown (not the words read out), or its text; no-break spaces as spaces. */
const seen = (c: Element): string => (c.querySelector('code') ?? c.querySelector('span[aria-hidden="true"]:not(:empty)') ?? c).textContent!.replace(/\u00a0/g, ' ').trim();

/** The panel's rows for a text, each row's cells as seen. */
async function rows(text: string, caption: RegExp): Promise<string[][]> {
  const result = await solveText(text, ngspice);
  render(
    <NumbersPanel
      outcome={{ kind: 'done', text, result }}
      text={text}
      running={false}
      paused={false}
      colours={new Map()}
      plotAvailable={false}
      onGoToLine={() => {}}
      onShowChecks={() => {}}
      onShowPlot={() => {}}
    />,
  );
  const table = screen.getAllByRole('table').find((t) => caption.test(t.querySelector('caption')?.textContent ?? ''))!;
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((r) => [...r.querySelectorAll('th, td')].map(seen));
}

describe('the Numbers panel after the final reviews (12 November 2026)', () => {
  it('names a node the netlist calls giriş as the netlist does, and ngspice\'s column as ngspice does: v(giri__) (kept F3; W16)', async () => {
    const r = await rows('* t\nV1 giriş 0 12\nR1 giriş çıkış 1k\nR2 çıkış 0 2k\n.op\n.end\n', /node/i);
    expect(r.map((x) => [x[0], x[2]])).toEqual([
      ['giriş', 'v(giri__) = 1.200000e+01'],
      ['çıkış', 'v(____k____) = 8.000000e+00'],
    ]);
  });

  it('gives a part named Rş ngspice\'s vector, i(@r__[i]) (W18)', async () => {
    const r = await rows('* t\nV1 a 0 6\nRş a 0 2\n.op\n.end\n', /current/i);
    expect(r.find((x) => x[0] === 'Rş')!.at(-1)).toBe('i(@r__[i]) = 3.000000e+00');
  });

  it('says 0 A for rounding noise, and keeps what ngspice gave in its column: i(@r5[i]) = -8.881784e-19 (student review; C9)', async () => {
    const r = await rows('* bridge\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\n.op\n.end\n', /current/i);
    const r5 = r.find((x) => x[0] === 'R5')!;
    expect(r5[1]).toBe('0 A');
    expect(r5.at(-1)).toBe('i(@r5[i]) = -8.881784e-19');
  });

  it('says 0 V for a node voltage that is rounding noise, and keeps what ngspice gave: v(out) = -2.168404e-13 (critic of round 1; C9d)', async () => {
    const text = '* t\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a m 1k\nVm m b 0\nF1 0 out Vm 1000\nR6 out 0 1k\n.op\n.end\n';
    const out = (await rows(text, /node/i)).find((x) => x[0] === 'out')!;
    expect(out.slice(1)).toEqual(['0 V', 'v(out) = -2.168404e-13']);
  });
});
