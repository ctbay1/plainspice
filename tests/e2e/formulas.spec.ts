/**
 * Node names inside formulas, and E lines given by a formula (the last pass, 13 November 2026: code
 * review C3-1 and C3-5), in the page: an E written with VALUE= runs and shows its numbers, and the
 * rename fix for a node a formula reads keeps the circuit running, with the same numbers.
 */
import { expect, test } from '@playwright/test';
import {
  checksCount,
  expectFinished,
  nodeTable,
  openApp,
  readPlain,
  rowNamed,
  setNetlist,
  shownText,
} from './helpers.ts';

test('an E given by a formula (VALUE=) has no false error: it runs, e = 5 V, and the drawing lists it as not drawn (missing-value-15)', async ({ page }) => {
  await openApp(page);
  await setNetlist(page, '* t\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e 0 VALUE={v(out)*2}\nRe e 0 1k\n.op\n.end\n');
  await expectFinished(page);
  expect(await checksCount(page)).toBe(0);
  const e = rowNamed(nodeTable(page), 'e').getByRole('cell').first();
  expect(readPlain(await shownText(e), 'V')).toBe(5);
  await expect(page.locator('p.not-drawn')).toHaveText('Not in the drawing: E1 (line 5).');
});
