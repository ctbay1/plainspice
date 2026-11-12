/**
 * 1. The engine and the results: ngspice runs in the browser's Web Worker as soon as a circuit
 * opens; the drawing shows what it computed in plain units, the Numbers panel lists every result
 * with the direction of every current, the netlist lines carry them too, and the run is announced.
 */
import { expect, test } from '@playwright/test';
import {
  chooseExample,
  currentsTable,
  drawnText,
  expectAnnounced,
  expectFinished,
  inlineNote,
  nodeTable,
  openApp,
  openNetlist,
  rowNamed,
  shownText,
  t,
} from './helpers.ts';

const NBSP = ' ';

test('the F5 example runs in the browser: a = 14 V, n1 = 12 V, 3 A from n1 to ground through R1', async ({ page }) => {
  await openApp(page);
  await chooseExample(page, t('exampleF5'));
  // No Run pressed: a circuit is solved when it opens.
  await expectFinished(page);

  // On the drawing: each node's voltage beside its name, and R1's current.
  const drawn = await drawnText(page);
  expect(drawn).toMatch(/=\s14\sV/);
  expect(drawn).toMatch(/=\s12\sV/);
  expect(drawn).toMatch(/3\sA/);

  // Node voltages: "14 V" on screen, "14 volts" for a screen reader, ngspice's own printout beside them.
  for (const [node, volts] of [
    ['a', 14],
    ['n1', 12],
  ] as const) {
    const cells = rowNamed(nodeTable(page), node).getByRole('cell');
    expect(await shownText(cells.nth(0))).toBe(`${volts}${NBSP}V`);
    await expect(cells.nth(0)).toHaveAccessibleName(`${volts} volts`);
    await expect(cells.nth(1)).toHaveText(`v(${node}) = ${volts.toExponential(6).replace(/e\+(\d)$/, 'e+0$1')}`);
  }

  // R1 carries 3 A, and the table says which way: from n1 to ground (not a sign to decode), ground
  // called "ground" as on the drawing and the card.
  const r1 = rowNamed(currentsTable(page), 'R1').getByRole('cell');
  expect(await shownText(r1.nth(0))).toBe(`3${NBSP}A`);
  await expect(r1.nth(0)).toHaveAccessibleName('3 amps');
  await expect(r1.nth(1)).toHaveText(t('flowsFromTo', { from: 'n1', to: 'ground' }));
  await expect(r1.last()).toContainText('3.000000e+00');

  // And said in the polite live region, with the units in words (a screen reader would spell out
  // "V" or "mV").
  await expectAnnounced(page, /node a is 14 volts, node x is 14 volts, node n1 is 12 volts/);

  // The same result on R1's own line of the netlist (line 5: "R1 n1 0 4").
  await openNetlist(page);
  await expect.poll(() => inlineNote(page, 5)).toMatch(/^3\sA, n1 → 0$/);
});
