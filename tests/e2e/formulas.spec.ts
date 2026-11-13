/**
 * Node names inside formulas, and E lines given by a formula (the last pass, 13 November 2026: code
 * review C3-1 and C3-5), in the page: an E written with VALUE= runs and shows its numbers, and the
 * rename fix for a node a formula reads keeps the circuit running, with the same numbers.
 */
import { expect, test } from '@playwright/test';
import {
  checksCount,
  expectFinished,
  netlistText,
  nodeTable,
  openApp,
  openNetlist,
  openPanel,
  readPlain,
  rowNamed,
  setNetlist,
  shownText,
  t,
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

test('the rename fix for a node a formula reads renames it in the formula too: the circuit still runs, b = 10 V (non-ascii-node-15)', async ({ page }) => {
  const netlist = '* t\nV1 giris 0 10\nR1 giris çıkış 1k\nR2 çıkış 0 1k\nB1 b 0 V=v(çıkış)*2\nRb b 0 1k\n.op\n.end\n';
  await openApp(page);
  await setNetlist(page, netlist);
  await expectFinished(page);
  const before = rowNamed(nodeTable(page), 'b').getByRole('cell').first();
  expect(readPlain(await shownText(before), 'V')).toBe(10);
  await expect.poll(() => checksCount(page)).toBe(1);
  const panel = await openPanel(page, 'checks');
  await panel.getByRole('button', { name: 'Rename çıkış to cikis' }).click();
  await expect(panel).toContainText(t('checksNone'));
  await openNetlist(page);
  await expect.poll(() => netlistText(page)).toBe(netlist.replaceAll('çıkış', 'cikis'));
  await expectFinished(page);
  const after = rowNamed(nodeTable(page), 'b').getByRole('cell').first();
  expect(readPlain(await shownText(after), 'V')).toBe(10);
  expect(readPlain(await shownText(rowNamed(nodeTable(page), 'cikis').getByRole('cell').first()), 'V')).toBe(5);
});
