/**
 * What the final reviews of milestone 2 found in the page (the ui lane), fixed, in a real browser:
 * Ctrl+K keeps the focus in its field (Tab stays there, a click on a group's name too, Escape closes
 * it from anywhere) and its list passes axe's best-practice rules (a11y A1, A3); a fix on the video's
 * mistake examples leaves no drawing warning, and the tab and the announcement agree (kept F1); the
 * starter's why is shown in the hint line (words W9); the Netlist panel a SPICE for Beginners example
 * opened closes with the next video's example (student netlist-panel-stays); a new node never takes a
 * name just said to be ground (student node-name-reused).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { starterWords } from '../../src/app/editing.ts';
import {
  checksCount,
  chooseExample,
  expectAnnounced,
  expectSolved,
  gridPoint,
  hintLine,
  isPhone,
  newCircuit,
  openApp,
  openPanel,
  panel,
  partsToolbar,
  statusLine,
  RUN_TIMEOUT,
  t,
} from './helpers.ts';

const palette = (page: Page) => page.getByRole('dialog', { name: t('paletteTitle') });
const search = (page: Page) => palette(page).getByRole('combobox', { name: t('paletteLabel') });

/** Click a grid point (a place on the paper) with the mouse. */
async function clickAt(page: Page, x: number, y: number): Promise<void> {
  const p = await gridPoint(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

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

test('the first part on a blank page: why .op and .end were written is shown first in the hint line (words W9)', async ({ page }) => {
  test.skip(isPhone(page), 'a phone places by tapping (the phone tests)');
  await openApp(page);
  await newCircuit(page);
  await partsToolbar(page).getByRole('button', { name: /^Resistor/ }).click();
  await clickAt(page, 2, 2);
  await expect(hintLine(page)).toHaveText(`${starterWords()} ${t('drawingWritten')}`);
});

test('the Netlist panel a SPICE for Beginners example opened closes with the next video’s example (student netlist-panel-stays)', async ({ page }) => {
  test.skip(isPhone(page), 'on a phone the examples open without the panel');
  await openApp(page);
  await chooseExample(page, 'Example 1');
  await expect(panel(page, 'netlist')).toBeVisible();
  await chooseExample(page, 'Example 3: a supernode with a dependent source');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/supernode/i);
  await expect(panel(page, 'netlist')).toHaveCount(0);
  // The drawing has the paper to itself again: every part is in view.
  await expect(page.getByRole('main').getByRole('button', { name: /^R3, / })).toBeInViewport();
  await chooseExample(page, 'Dependent sources E, G, F and H');
  await expect(panel(page, 'netlist')).toBeVisible();
});

test('a new node never takes a name just said to be ground (student node-name-reused)', async ({ page }) => {
  test.skip(isPhone(page), 'a phone places by tapping (the phone tests)');
  await openApp(page);
  await newCircuit(page);
  const tools = partsToolbar(page);
  // V1 upright at (0, 3): its ends n1 and n2; its card opens on its value.
  await tools.getByRole('button', { name: /^Voltage source/ }).click();
  await clickAt(page, 0, 3);
  await expectAnnounced(page, /V1 added between node n1 and node n2\./);
  await page.keyboard.press('Escape');
  // Ground on V1's − pin.
  await tools.getByRole('button', { name: /^Ground/ }).click();
  await clickAt(page, 0, 5);
  await expectAnnounced(page, /Node n2 is now ground \(node 0\)/);
  // A resistor on empty paper: two new nodes, neither of them n2.
  await tools.getByRole('button', { name: /^Resistor/ }).click();
  await clickAt(page, 8, 2);
  await expectAnnounced(page, 'R1 added between node n3 and node n4.');
});
