/**
 * Tarık's checkpoint of the Notebook look (design/checkpoint/, deployed at /design/checkpoint/), on
 * the desktop and the phone: the p02 circuit solved by ngspice and drawn with its results on it ("a =
 * 24 V"), a part's card changing a value live (the old value crossed out, the numbers moving, the
 * drawing's size never changing), a trap written on the paper in red pen, the plain-font setting
 * (switched from Ctrl+K and remembered), the netlist with its drawing block folded away, the phone's
 * one bar and its editing strip, the keyboard, and axe with the WCAG 2.2 AA rules in each state.
 */
import { expect, test, type Page } from '@playwright/test';
import { RUN_TIMEOUT, expectNoAxeViolations } from './helpers.ts';

const URL = './design/checkpoint/';

async function openCheckpoint(page: Page, hash = ''): Promise<void> {
  await page.goto(`${URL}${hash ? `#${hash}` : ''}`);
  // ngspice has answered when its numbers are on the drawing (a phone's card hides the status line).
  await expect(page.locator('.nb-result__text').first()).toBeVisible({ timeout: RUN_TIMEOUT });
}

/** The words written on the drawing, with formatSI's no-break spaces read as spaces. */
async function drawnWords(page: Page): Promise<string[]> {
  return page.locator('.nb-ink text').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\u00a0/g, ' ')));
}

test('the drawing, solved by ngspice: node voltages, currents and power written on it', async ({ page }) => {
  await openCheckpoint(page);
  await expect(page.getByText(/Solved in \d+ ms/)).toBeVisible();
  const words = await drawnWords(page);
  for (const w of ['= 24 V', '= 16 V', '= 12 V', '4 A', 'delivers', '96 W', 'absorbs', '16 W', 'G1']) expect(words).toContain(w);
  await expect(page.getByRole('img', { name: /Example 3: open circuit/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('open circuit');
  await expect(page.getByRole('main')).toBeVisible();
  // Nothing on the page scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expectNoAxeViolations(page, 'the checkpoint, solved');
});

test('a part’s card: typing a value solves again, the old value stays crossed out, the drawing keeps its size', async ({ page, isMobile }) => {
  await openCheckpoint(page);
  const zoom = isMobile ? undefined : await page.locator('.ck-zoom__pct').textContent();
  await page.getByRole('button', { name: /^G1, voltage-controlled current source$/ }).click();
  const card = page.getByRole('dialog', { name: /G1/ });
  await expect(card).toBeVisible();
  const field = card.getByRole('textbox', { name: 'amps per volt' });
  await expect(field).toHaveValue('0.25');
  await expectNoAxeViolations(page, 'G1’s card open');
  await field.fill('0.125');
  // Was 0.25, crossed out, with a way back; the voltage at a is no longer 24 V.
  await expect(card.getByRole('button', { name: 'Put back 0.25' })).toBeVisible();
  await expect.poll(async () => (await drawnWords(page)).includes('= 24 V'), { timeout: RUN_TIMEOUT }).toBe(false);
  await expect(page.locator('.nb-was__text').first()).toBeVisible();
  // On a computer the drawing never changes size for the card (critique 1).
  if (zoom) await expect(page.locator('.ck-zoom__pct')).toHaveText(zoom);
  await card.getByRole('button', { name: 'Put back 0.25' }).click();
  await expect.poll(async () => (await drawnWords(page)).includes('= 24 V'), { timeout: RUN_TIMEOUT }).toBe(true);
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});

test('a trap is written on the paper in red pen, its misread value circled', async ({ page }) => {
  await openCheckpoint(page, 'circuit=p02-4-open&select=R1&card=1&value=1M');
  await expect(page.locator('.nb-pen__text').first()).toBeVisible({ timeout: RUN_TIMEOUT });
  const note = (await page.locator('.nb-pen__text').allTextContents()).join(' ');
  expect(note).toMatch(/^1M means 1 milliohm/);
  await expect(page.locator('ellipse.nb-pen__circle')).toHaveCount(1);
  await expectNoAxeViolations(page, 'a trap on R1');
});

test('Ctrl+K: every command in one list; the plain font switches at once and is remembered', async ({ page }) => {
  await openCheckpoint(page);
  await page.getByRole('button', { name: 'Search or run a command' }).click();
  const palette = page.getByRole('dialog', { name: 'Commands' });
  await expect(palette).toBeVisible();
  await expectNoAxeViolations(page, 'the command palette open');
  for (const label of ['Open Example 3: short circuit (I_sc)', 'Open Example 2: only a dependent source, 1 A test current', 'Open the netlist panel', 'Fit the drawing to the window', 'Run ngspice again']) {
    await expect(palette.getByRole('option', { name: label })).toHaveCount(1);
  }
  await page.getByRole('combobox', { name: 'Search or run a command' }).fill('plain font');
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(page.locator('.nb-drawing')).toHaveClass(/is-plain/);
  await page.reload();
  await expect(page.getByText(/Solved in \d+ ms/)).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(page.locator('.nb-drawing')).toHaveClass(/is-plain/);
});

test('the netlist panel: the drawing block folded away, unfolded on request', async ({ page }) => {
  await openCheckpoint(page);
  await page.getByRole('button', { name: 'Netlist' }).click();
  const fold = page.getByRole('button', { name: /Drawing: \d+ lines, positions of the parts/ });
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.ck-code').getByText('*@ G1', { exact: false })).toHaveCount(0);
  await expectNoAxeViolations(page, 'the netlist panel open');
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.ck-code').getByText(/^\*@ G1 /)).toHaveCount(1);
});

test('a phone: one bar along the bottom, the parts in a sheet, a strip above the keyboard while typing', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'a phone');
  await openCheckpoint(page);
  const bar = page.getByRole('navigation', { name: 'Tools and panels' });
  for (const name of ['Select', 'Parts', 'Netlist', 'Checks', 'Explain']) await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
  await bar.getByRole('button', { name: 'Parts', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Parts' });
  await expect(sheet.getByRole('button').nth(1)).toContainText('Voltage-controlled voltage source');
  await expectNoAxeViolations(page, 'the Parts sheet');
  await sheet.getByRole('button', { name: 'Close the parts' }).click();
  await page.getByRole('button', { name: /^G1,/ }).click();
  const field = page.getByRole('textbox', { name: 'amps per volt' });
  await field.focus();
  await expect(page.locator('.ck-index--strip')).toBeVisible();
  await expect(bar).toHaveCount(0);
  await field.fill('0.3');
  await expect.poll(async () => (await drawnWords(page)).includes('= 32 V'), { timeout: RUN_TIMEOUT }).toBe(true);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.ck-index--sheet')).toBeVisible();
});

test('the keyboard: skip to the drawing, arrows along the wires, a ring round the symbol, Enter opens, Escape goes back', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a keyboard on a computer');
  await openCheckpoint(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to the drawing' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator(':focus')).toHaveAttribute('data-item', /^(n|p):/);
  const g1 = page.getByRole('button', { name: /^G1,/ });
  await g1.focus();
  await page.keyboard.press('ArrowUp');
  const focused = page.locator(':focus');
  await expect(focused).toHaveAttribute('data-item', /^(n|p):/);
  await expect(focused).not.toHaveAttribute('data-item', 'p:g1');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.nb-focus')).toHaveCount(1);
  await g1.focus();
  await page.keyboard.press('Enter');
  const card = page.getByRole('dialog', { name: /G1/ });
  await expect(card).toBeVisible();
  await expect(card.getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(g1).toBeFocused();
});
