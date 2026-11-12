/**
 * What the final reviews of milestone 2 found in the page (the ui lane), fixed, in a real browser:
 * Ctrl+K keeps the focus in its field (Tab stays there, a click on a group's name too, Escape closes
 * it from anywhere) and its list passes axe's best-practice rules (a11y A1, A3); a fix on the video's
 * mistake examples leaves no drawing warning, and the tab and the announcement agree (kept F1).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  checksCount,
  chooseExample,
  expectAnnounced,
  expectSolved,
  openApp,
  openPanel,
  panel,
  statusLine,
  RUN_TIMEOUT,
  t,
} from './helpers.ts';

const palette = (page: Page) => page.getByRole('dialog', { name: t('paletteTitle') });
const search = (page: Page) => palette(page).getByRole('combobox', { name: t('paletteLabel') });

test('Ctrl+K keeps the focus in its field: Tab stays there, Escape closes it, and a click on a group’s name keeps the focus (a11y A1)', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  // (a) Ctrl+K, then Tab and Shift+Tab: the focus stays in the dialog's field, never reaching the page behind.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(search(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(search(page)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(search(page)).toBeFocused();
  await expect(page.getByRole('link', { name: t('skipToDrawing') })).not.toBeFocused();
  // The arrows and Escape still work there.
  await page.keyboard.press('ArrowDown');
  await expect(palette(page).getByRole('option', { selected: true })).toContainText(t('paletteOpenPanel', { panel: t('panelNetlist') }));
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);
  // (b) A click on a group's name: the focus stays in the field, and Escape closes the dialog.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(search(page)).toBeFocused();
  await palette(page).locator('.palette__group', { hasText: t('paletteGroupPanels') }).click();
  await expect(search(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);
  // And should the focus ever be on the page itself, Escape still closes it, as its Esc badge says.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(search(page)).toBeFocused();
  await search(page).evaluate((el) => (el as HTMLElement).blur());
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);
});

test('axe: Ctrl+K’s list passes the best-practice rules too (its groups are allowed roles: a11y A3)', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  await page.keyboard.press('ControlOrMeta+k');
  await expect(search(page)).toBeFocused();
  const results = await new AxeBuilder({ page }).withTags(['best-practice']).include('.palette').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
  await expect(palette(page).getByRole('listbox').getByRole('group', { name: t('paletteGroupRun') })).toBeVisible();
});

test('a fix on the video’s mistake examples leaves no drawing warning; the tab and what is said agree (kept F1)', async ({ page }) => {
  await openApp(page);
  for (const [example, fix] of [
    ['Mistake 1: no ground (node 0)', 'Make n3 the ground (rename it to 0)'],
    ['Mistake 2: a typo in a node name', 'Rename n12 to n2'],
  ] as const) {
    await chooseExample(page, example);
    await expect.poll(() => checksCount(page)).toBe(1);
    const checks = await openPanel(page, 'checks');
    await checks.getByRole('button', { name: fix, exact: true }).click();
    await expectAnnounced(page, `${t('fixApplied', { label: fix })}. No traps found.`);
    await expect.poll(() => checksCount(page)).toBe(0);
    await expect(panel(page, 'checks').getByText(t('checksNone'))).toBeVisible();
    await expect(panel(page, 'checks')).not.toContainText(t('checksDrawingTitle'));
    await expect(statusLine(page)).toContainText(/Finished in \d+ ms/, { timeout: RUN_TIMEOUT });
  }
});
