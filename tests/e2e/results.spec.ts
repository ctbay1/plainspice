/**
 * 1. The engine and the results: ngspice runs in the browser's Web Worker and the Results tab shows
 * what it computed in plain units, with the direction of every current, on the netlist lines too,
 * and the run is announced.
 */
import { expect, test } from '@playwright/test';
import {
  chooseExample,
  currentsTable,
  expectAnnounced,
  inlineNote,
  nodeTable,
  openApp,
  rowNamed,
  runAndExpectFinished,
  shownText,
  t,
} from './helpers.ts';

const NBSP = '\u00a0';

test('the F5 example runs in the browser: a = 14 V, n1 = 12 V, 3 A from n1 to 0 through R1', async ({ page }) => {
  await openApp(page);
  await chooseExample(page, t('exampleF5'));
  await runAndExpectFinished(page);

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

  // R1 carries 3 A, and the table says which way: from n1 to 0 (not a sign to decode).
  const r1 = rowNamed(currentsTable(page), 'R1').getByRole('cell');
  expect(await shownText(r1.nth(0))).toBe(`3${NBSP}A`);
  await expect(r1.nth(0)).toHaveAccessibleName('3 amperes');
  await expect(r1.nth(1)).toHaveText(t('flowsFromTo', { from: 'n1', to: '0' }));
  await expect(r1.last()).toContainText('3.000000e+00');

  // The same result on R1's own line of the netlist (line 5: "R1 n1 0 4").
  expect(await inlineNote(page, 5)).toMatch(/^3\sA, n1 → 0$/);

  // And said in the polite live region, for screen-reader users who stayed in the editor.
  await expectAnnounced(page, /Simulation finished: a = 14\sV, x = 14\sV, n1 = 12\sV/);
});
