/**
 * 3. Beginner traps: found while typing, explained (what, why, what ngspice does), fixed in one
 * click; and a circuit ngspice cannot solve is not shown with confident numbers.
 */
import { expect, test } from '@playwright/test';
import {
  expectAnnounced,
  inlineNote,
  netlistText,
  nodeTable,
  openApp,
  readPlain,
  resultsPanel,
  rowNamed,
  runAndExpectFinished,
  runButton,
  RUN_TIMEOUT,
  setNetlist,
  shownText,
  t,
  tab,
  typeNetlist,
} from './helpers.ts';

const DIVIDER_1M = '* My divider\nV1 n1 0 6\nR1 n1 n2 1M\nR2 n2 0 1meg\n.op\n.end\n';

test('the 1M trap: found while typing, explained, fixed to 1meg in one click; then n2 = 3 V', async ({ page }) => {
  await openApp(page);
  await typeNetlist(page, DIVIDER_1M);

  // The checks run while typing: the tab counts the trap before anything runs.
  const checksTab = tab(page, /^Checks/);
  await expect(checksTab).toHaveText(t('tabChecks', { count: 1 }));
  await checksTab.click();
  const panel = page.getByRole('tabpanel');
  const trap = panel.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 4, name: /\b1M\b/ }) });
  await expect(trap).toHaveCount(1);
  // Where, why (in words a beginner can follow) and what ngspice does with it.
  await expect(trap.getByRole('button', { name: t('goToLine', { line: 3 }) })).toBeVisible();
  await expect(trap).toContainText(/milli/);
  await expect(trap).toContainText(/1meg/);
  await expect(trap).toContainText(t('whatNgspiceDoes'));
  const fixes = trap.getByRole('group', { name: t('fixesLabel', { line: 3 }) }).getByRole('button');
  await expect(fixes).toHaveCount(2);

  await fixes.filter({ hasText: /1meg/ }).click();
  await expect.poll(() => netlistText(page)).toBe(DIVIDER_1M.replace('n2 1M', 'n2 1meg'));
  await expect(checksTab).toHaveText(t('tabChecks', { count: 0 }));
  await expect(panel).toContainText(t('checksNone'));

  await runAndExpectFinished(page);
  const n2 = rowNamed(nodeTable(page), 'n2').getByRole('cell').first();
  expect(readPlain(await shownText(n2), 'V')).toBe(3);
});

test('no ground: the check says why; run anyway, the results say the DC solution failed and fold the numbers away', async ({ page }) => {
  await openApp(page);
  await setNetlist(page, '* No ground\nV1 a b 6\nR1 a b 2\n.op\n.end\n');

  const checksTab = tab(page, /^Checks/);
  await expect(checksTab).toHaveText(t('tabChecks', { count: 1 }));
  await checksTab.click();
  const trap = page.getByRole('tabpanel').getByRole('listitem');
  await expect(trap).toHaveCount(1);
  await expect(trap.getByRole('heading', { level: 4 })).toContainText(/ground/i);
  await expect(trap).toContainText(/\b0\b/); // ground is the node called 0
  await expect(trap).toContainText(t('whatNgspiceDoes'));

  // Run anyway: ngspice prints numbers from a fallback, and PlainSpice does not present them as answers.
  await runButton(page).click();
  const results = resultsPanel(page);
  await expect(results.getByText(t('statusUnreliableText'))).toBeVisible({ timeout: RUN_TIMEOUT });
  await expectAnnounced(page, /can.t be trusted/);
  await expect(nodeTable(page), 'no node voltages shown as results').toHaveCount(0);
  await expect(results.getByText(/^Simulation finished:/)).toHaveCount(0);
  expect(await inlineNote(page, 2), 'no results on the netlist lines').toBe('');
  const folded = results.getByRole('group').filter({ hasText: t('printedAnyway') });
  await expect(folded).toBeVisible();
  expect(await folded.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);

  // Only on request, and under that heading, does the table of what ngspice printed appear.
  await folded.getByText(t('printedAnyway')).click();
  await expect(folded.getByRole('table', { name: t('nodesCaption') })).toBeVisible();
});
