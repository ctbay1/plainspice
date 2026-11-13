/**
 * Node names inside formulas, and E lines given by a formula (the last pass, 13 November 2026: code
 * review C3-1 and C3-5), in the page: an E written with VALUE= runs and shows its numbers, and the
 * rename fix for a node a formula reads keeps the circuit running, with the same numbers.
 */
import { expect, test } from '@playwright/test';
import { encodeShare } from '../../src/share/link.ts';
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
  await panel.getByRole('button', { name: 'Rename node çıkış to cikis' }).click();
  await expect(panel).toContainText(t('checksNone'));
  await openNetlist(page);
  await expect.poll(() => netlistText(page)).toBe(netlist.replaceAll('çıkış', 'cikis'));
  await expectFinished(page);
  const after = rowNamed(nodeTable(page), 'b').getByRole('cell').first();
  expect(readPlain(await shownText(after), 'V')).toBe(10);
  expect(readPlain(await shownText(rowNamed(nodeTable(page), 'cikis').getByRole('cell').first()), 'V')).toBe(5);
});

test('a formula that writes the node with a capital letter (v(Çıkış)) gets no false error: the numbers show, and the rename keeps them (non-ascii-node-20, round-1 critic CR1-1)', async ({ page }) => {
  const netlist = '* t\nV1 giris 0 10\nR1 giris çıkış 1k\nR2 çıkış 0 1k\nB1 b 0 V=v(Çıkış)*2\nRb b 0 1k\n.op\n.end\n';
  await openApp(page);
  await setNetlist(page, netlist);
  await expectFinished(page);
  expect(readPlain(await shownText(rowNamed(nodeTable(page), 'b').getByRole('cell').first()), 'V')).toBe(10);
  await expect.poll(() => checksCount(page)).toBe(1);
  const panel = await openPanel(page, 'checks');
  await panel.getByRole('button', { name: 'Rename node çıkış to cikis' }).click();
  await expect(panel).toContainText(t('checksNone'));
  await openNetlist(page);
  await expect.poll(() => netlistText(page)).toBe(netlist.replaceAll('çıkış', 'cikis').replace('Çıkış', 'cikis'));
  await expectFinished(page);
  expect(readPlain(await shownText(rowNamed(nodeTable(page), 'b').getByRole('cell').first()), 'V')).toBe(10);
  expect(readPlain(await shownText(rowNamed(nodeTable(page), 'cikis').getByRole('cell').first()), 'V')).toBe(5);
});

test('an emoji before a thin space in the title stops no check: the error for x shows, not "No traps found" (round-1 critic CR1-5)', async ({ page }) => {
  // Opened from a link: the netlist editor shows the thin space as a mark, which the text typed in would not match.
  await openApp(page, `./#${await encodeShare('* t\n.title \u{1F600}\u2009devre\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nC1 out x 1u\n.op\n.end\n', { run: true })}`);
  await expect.poll(() => checksCount(page)).toBe(2);
  const panel = await openPanel(page, 'checks');
  await expect(panel).toContainText('x has no DC path to ground');
});

test('E and G formulas that start with a sign or a bracket run with their numbers and no check: e1 = −5 V, e2 = 7 V (round-2 critic CR2-1, fatal-syntax-19)', async ({ page }) => {
  await openApp(page);
  await setNetlist(page, '* t\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e1 0 VALUE=-v(out)*2\nR1e e1 0 1k\nE2 e2 0 VALUE=(1+v(out))*2\nR2e e2 0 1k\n.op\n.end\n');
  await expectFinished(page);
  expect(await checksCount(page)).toBe(0);
  expect(readPlain(await shownText(rowNamed(nodeTable(page), 'e1').getByRole('cell').first()), 'V')).toBe(-5);
  expect(readPlain(await shownText(rowNamed(nodeTable(page), 'e2').getByRole('cell').first()), 'V')).toBe(7);
});

test('one node written Çıkış and çıkış on part lines: the numbers show, one warning, and its fix keeps them (round-2 critic CR2-3, non-ascii-node-27)', async ({ page }) => {
  await openApp(page);
  await setNetlist(page, '* t\nV1 giris 0 10\nR1 giris Çıkış 1k\nR2 çıkış 0 1k\n.op\n.end\n');
  await expectFinished(page);
  await expect.poll(() => checksCount(page)).toBe(1);
  const panel = await openPanel(page, 'checks');
  await expect(panel).toContainText('ngspice spells node Çıkış and node çıkış as ____k____: one node');
  await panel.getByRole('button', { name: 'Rename node Çıkış and node çıkış to Cikis' }).click();
  await expect(panel).toContainText(t('checksNone'));
  await openNetlist(page);
  await expect.poll(() => netlistText(page)).toBe('* t\nV1 giris 0 10\nR1 giris Cikis 1k\nR2 Cikis 0 1k\n.op\n.end\n');
  await expectFinished(page);
  expect(readPlain(await shownText(rowNamed(nodeTable(page), /^cikis$/i).getByRole('cell').first()), 'V')).toBe(5);
});
