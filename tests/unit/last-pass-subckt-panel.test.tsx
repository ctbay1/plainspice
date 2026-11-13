// @vitest-environment jsdom
/**
 * The Numbers panel when ngspice gave no results (last pass, the round-1 critic of the subckt lane's
 * fixes, critic1-2; decision 0017): "No results" once, as the banner's title, and no promise of a reason
 * ("The message below says why.") above a message that says ngspice gave none. Where PlainSpice knows
 * the reason (every analysis line in a subcircuit no X line uses, A3f), the promise stays: the message
 * below gives it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { NumbersPanel } from '../../src/app/components/NumbersPanel.tsx';
import { solveText } from '../../src/app/model.ts';
import { NgspiceEngine, type NgspiceFactory } from '../../src/engine/ngspice.ts';
import { t } from '../../src/i18n/index.ts';

afterEach(cleanup);

const root = resolve(import.meta.dirname, '../..');
let ngspice: NgspiceEngine;
beforeAll(async () => {
  ngspice = await NgspiceEngine.create(createNgspice as unknown as NgspiceFactory, readFileSync(resolve(root, 'engine/dist/ngspice.wasm')));
});

/** The panel's text after a run of `text`. */
async function panelText(text: string): Promise<string> {
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
  return document.body.textContent ?? '';
}

describe('the Numbers panel when ngspice gave no results (critic1-2)', () => {
  it('ngspice said nothing: "No results" once, and nothing promises a reason above "no message that says why"', async () => {
    // .four alone: no transient data to read, and with a results file ngspice writes none (native 47 and 42, -b -r: exit 0).
    const text = await panelText('* four alone\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.four 1k v(out)\n.end\n');
    expect(text.match(/No results/g)).toHaveLength(1);
    expect(text).toContain(t('statusEmptyNoWhyText'));
    expect(text).not.toContain('The message below says why');
    expect(text).toContain('ngspice gave no reason');
    expect(text).toContain('it printed no message that says why');
  }, 30000);

  it('PlainSpice knows the reason (A3f): the lead still points to the message below, which gives it', async () => {
    const text = await panelText('* t\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.op\n.ends\n.end\n');
    expect(screen.getByText(t('statusEmptyText'))).toBeTruthy();
    expect(text).toContain('.op is inside the subcircuit s, which no X line uses');
    expect(text.match(/No results/g)).toHaveLength(1);
  }, 30000);
});
