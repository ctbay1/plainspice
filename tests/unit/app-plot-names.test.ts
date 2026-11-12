/**
 * The Plot panel's lines are named with the netlist's names (src/app/components/PlotPanel.tsx,
 * plotSpecs): v(giriş) where ngspice writes v(giri__), as the Numbers panel and the results' words
 * name them (kept review F3, facts W16 and W18; done when the lanes were merged).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { plotSpecs } from '../../src/app/components/PlotPanel.tsx';
import { solveText } from '../../src/app/model.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';

const root = resolve(import.meta.dirname, '../..');
let ngspice: NgspiceEngine;
beforeAll(async () => {
  ngspice = await NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(root, 'engine/dist/ngspice.wasm')));
});

describe('the Plot panel names its lines as the netlist does', () => {
  it('a .dc sweep of a divider whose nodes are giriş and çıkış: v(giriş) and v(çıkış), not ngspice\'s v(giri__)', async () => {
    const text = '* t\nV1 giriş 0 12\nR1 giriş çıkış 1k\nR2 çıkış 0 2k\n.dc V1 0 12 6\n.end\n';
    const r = await solveText(text, ngspice);
    // ngspice's own names, as its rawfile gives them (W16).
    expect(r.results.dc!.series.map((s) => s.name)).toEqual(['v(giri__)', 'v(____k____)', 'i(v1)']);
    const [spec] = plotSpecs(r.results, r.netlist);
    expect(spec!.series.map((s) => s.label)).toEqual(['v(giriş)', 'v(çıkış)', 'i(v1)']);
    expect(spec!.title).toContain('v(giriş), v(çıkış), i(v1)');
    expect(spec!.title).not.toContain('giri__');
  });

  it('a .tran with savecurrents names a part Rş as the netlist does: i(@rş[i]) (W18)', async () => {
    const text = '* t\nV1 a 0 PULSE(0 1 0 1u 1u 1m 2m)\nRş a b 1k\nC1 b 0 1u\n.options savecurrents\n.tran 0.1m 1m\n.end\n';
    const r = await solveText(text, ngspice);
    const names = r.results.tran!.series.map((s) => s.name);
    expect(names).toContain('i(@r__[i])');
    const [spec] = plotSpecs(r.results, r.netlist);
    const labels = spec!.series.map((s) => s.label);
    expect(labels).toContain('i(@rş[i])');
    expect(labels.some((l) => l.includes('__'))).toBe(false);
  });

  it('keeps ordinary names as ngspice gives them: v(in), v(out), i(v1)', async () => {
    const r = await solveText('* t\nV1 in 0 10\nR1 in out 1k\nR2 out 0 1k\n.dc V1 0 10 5\n.end\n', ngspice);
    const [spec] = plotSpecs(r.results, r.netlist);
    expect(spec!.series.map((s) => s.label)).toEqual(['v(in)', 'v(out)', 'i(v1)']);
  });
});
