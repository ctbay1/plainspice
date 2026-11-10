/**
 * 8. Accessibility (decision 0010): axe-core with the WCAG 2.0, 2.1 and 2.2 A and AA rules finds no
 * violation in the main states, on the desktop and on the phone (both projects run every test here);
 * the page reflows at 320 px; forced colours keep the controls and tables visible; reduced motion
 * turns animation off. axe cannot judge everything (screen-reader wording, focus order, real
 * Windows High Contrast): see the keyboard test and the manual checks in decision 0010.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PLOT_STRINGS } from '../../src/plot/strings.ts';
import {
  chooseExample,
  currentsTable,
  expectFinished,
  expectNoAxeViolations,
  nodeTable,
  openApp,
  runAndExpectFinished,
  runButton,
  setNetlist,
  settle,
  t,
  tab,
} from './helpers.ts';

/** Three traps of two kinds: 1M (a milliohm), 3A (attoamps) and a node only one part touches. */
const TRAPS = '* Several traps at once\nV1 n1 0 6\nR1 n1 n2 1M\nR2 n2 0 1meg\nR3 n2 n9 1k\nI1 0 n1 3A\nC1 n2 0 1u\n.op\n.end\n';

/** A display setting as the app applies it: an attribute on <html> (null: follow the device). */
const setting = (page: Page, name: string): Promise<string | null> => page.evaluate((n) => document.documentElement.getAttribute(n), name);

/** Choose a display setting the way a person does: open Settings, click the option's words, close. */
async function chooseSetting(page: Page, group: string, option: string): Promise<void> {
  await page.getByRole('button', { name: t('settings'), exact: true }).click();
  const dialog = page.getByRole('dialog', { name: t('settingsTitle') });
  const radios = dialog.getByRole('radiogroup', { name: group });
  await radios.getByText(option, { exact: true }).click();
  await expect(radios.getByRole('radio', { name: option })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

test('axe: the first page, after a run, every tab and the Examples menu', async ({ page }) => {
  await openApp(page);
  await expectNoAxeViolations(page, 'the first page');
  await runAndExpectFinished(page);
  await expectNoAxeViolations(page, 'after a run (Results tab)');
  for (const name of [t('tabExplained'), t('tabOutput'), t('tabChecks', { count: 0 })]) {
    await tab(page, name).click();
    await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
    await expectNoAxeViolations(page, `the ${name} tab`);
  }
  await page.getByRole('button', { name: t('examples') }).click();
  await expect(page.getByRole('menu', { name: t('examplesMenu') })).toBeVisible();
  await expectNoAxeViolations(page, 'the Examples menu open');
  await page.keyboard.press('Escape');

  // A sweep: the Plot tab with its figure, slider and (opened) data table.
  await chooseExample(page, t('exampleD1'));
  await runAndExpectFinished(page);
  await tab(page, t('tabPlot')).click();
  const figure = page.getByRole('figure');
  await expect(figure.getByRole('slider')).toBeVisible();
  await figure.getByText(PLOT_STRINGS.tableToggle).click();
  await expect(figure.getByRole('table')).toBeVisible();
  await expectNoAxeViolations(page, 'the Plot tab');
});

test('axe: the Checks tab with traps, and a run that has them', async ({ page }) => {
  await openApp(page);
  await setNetlist(page, TRAPS);
  await expect(tab(page, /^Checks/)).toHaveText(t('tabChecks', { count: 3 }));
  await tab(page, /^Checks/).click();
  await expect(page.getByRole('tabpanel').getByRole('listitem')).toHaveCount(3);
  await expectNoAxeViolations(page, 'the Checks tab with three traps');
  await runButton(page).click();
  await expectFinished(page);
  await expectNoAxeViolations(page, 'the results of a run with traps');
});

test('axe: the Share, Settings and Help dialogs', async ({ page }) => {
  await openApp(page);
  for (const [button, title] of [
    [t('share'), t('shareTitle')],
    [t('settings'), t('settingsTitle')],
    [t('help'), t('helpTitle')],
  ] as const) {
    await page.getByRole('button', { name: button, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    if (button === t('share')) await expect(dialog.getByRole('textbox', { name: t('shareLinkLabel') })).toHaveValue(/#c=/);
    await expectNoAxeViolations(page, `the ${title} dialog`);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
});

test('axe: high contrast, chosen in Settings and asked for by the device', async ({ page }) => {
  await openApp(page);
  await chooseSetting(page, t('contrast'), t('contrastMore'));
  expect(await setting(page, 'data-contrast')).toBe('more');
  await runAndExpectFinished(page);
  await expectNoAxeViolations(page, 'high contrast (setting), Results');
  await setNetlist(page, TRAPS);
  await tab(page, /^Checks/).click();
  await expectNoAxeViolations(page, 'high contrast (setting), Checks with traps');

  // "Follow my device" with a device that asks for more contrast.
  await chooseSetting(page, t('contrast'), t('followDevice'));
  await page.emulateMedia({ contrast: 'more' });
  expect(await setting(page, 'data-contrast')).toBeNull();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(255, 255, 255)');
  await expectNoAxeViolations(page, 'high contrast (device), Checks with traps');
});

test('axe: extra-large text (150 %)', async ({ page }) => {
  await openApp(page);
  await chooseSetting(page, t('textSize'), t('textSizeXLarge'));
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('24px');
  await runAndExpectFinished(page);
  await expectNoAxeViolations(page, 'extra-large text, Results');
  await setNetlist(page, TRAPS);
  await tab(page, /^Checks/).click();
  await expectNoAxeViolations(page, 'extra-large text, Checks with traps');
});

/** How far the page can scroll sideways (0 when everything fits the width). */
const sidewaysScroll = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('reflow: no horizontal scrolling at 320 px wide, with normal and extra-large text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const fits = async (what: string): Promise<void> => {
    await settle(page);
    expect(await sidewaysScroll(page), `${what}: the page does not scroll sideways`).toBeLessThanOrEqual(0);
  };
  await openApp(page);
  await fits('the first page');
  await runAndExpectFinished(page);
  await fits('results');

  // The Currents table is wider than 320 px: it scrolls inside its own box (allowed for data tables,
  // WCAG 1.4.10), and that box is a named region the keyboard can reach and scroll.
  const box = page.getByRole('region', { name: t('currentsCaption') });
  await expect(box).toBeVisible();
  await box.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => box.evaluate((b) => b.scrollLeft)).toBeGreaterThan(0);

  for (const name of [t('tabExplained'), t('tabOutput')]) {
    await tab(page, name).click();
    await fits(name);
  }
  await setNetlist(page, TRAPS);
  await tab(page, /^Checks/).click();
  await fits('checks');

  await chooseSetting(page, t('textSize'), t('textSizeXLarge'));
  await fits('checks, 150 % text');
  await runAndExpectFinished(page);
  await fits('results, 150 % text');
  for (const name of [t('tabExplained'), t('tabOutput')]) {
    await tab(page, name).click();
    await fits(`${name}, 150 % text`);
  }
  await page.getByRole('button', { name: t('help'), exact: true }).click();
  await expect(page.getByRole('dialog', { name: t('helpTitle') })).toBeVisible();
  await fits('the Help dialog, 150 % text');
});

test('reflow: the Plot tab with its data table open fits 320 px; the table scrolls in its own box (a11y review F2)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openApp(page);
  for (const example of [t('exampleT1'), t('exampleD1')]) {
    await chooseExample(page, example);
    await runAndExpectFinished(page);
    await tab(page, t('tabPlot')).click();
    const figure = page.getByRole('figure').first();
    await figure.getByText(PLOT_STRINGS.tableToggle).click();
    await expect(figure.getByRole('table')).toBeVisible();
    await settle(page);
    expect(await sidewaysScroll(page), `${example}: the page does not scroll sideways`).toBeLessThanOrEqual(0);
  }
  await chooseSetting(page, t('textSize'), t('textSizeXLarge'));
  await settle(page);
  expect(await sidewaysScroll(page), 'the plot and its table, 150 % text').toBeLessThanOrEqual(0);
});

test('the Examples menu fits a 320 px screen with extra-large text (a11y review F7)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openApp(page);
  await chooseSetting(page, t('textSize'), t('textSizeXLarge'));
  await page.getByRole('button', { name: t('examples') }).click();
  await expect(page.getByRole('menu', { name: t('examplesMenu') })).toBeVisible();
  await settle(page);
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
});

test('"Link copied." reaches screen readers while the Share dialog is open (a11y review F1)', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: t('share'), exact: true }).click();
  const dialog = page.getByRole('dialog', { name: t('shareTitle') });
  await expect(dialog.getByRole('textbox', { name: t('shareLinkLabel') })).toHaveValue(/#c=/);
  await dialog.getByRole('button', { name: t('shareCopy') }).click();
  const polite = page.getByTestId('live-polite');
  await expect(polite).toContainText(t('shareCopied'));
  // React Aria makes the page outside a dialog inert; the live regions must stay out of that.
  expect(await polite.evaluate((el) => el.closest('[inert], [aria-hidden="true"]') === null)).toBe(true);
  await expect(polite).toHaveAttribute('aria-atomic', 'false');
});

/** Text colour, the colour behind it (the nearest ancestor that paints one) and a border, as computed. */
async function colours(element: Locator, side: 'top' | 'bottom' = 'top'): Promise<{ text: string; background: string; border: string }> {
  return element.evaluate((el, edge) => {
    const style = getComputedStyle(el);
    let background = 'rgba(0, 0, 0, 0)';
    for (let e: Element | null = el; e; e = e.parentElement) {
      const bg = getComputedStyle(e).backgroundColor;
      if (!/^rgba\(.*, 0\)$/.test(bg) && bg !== 'transparent') {
        background = bg;
        break;
      }
    }
    const width = parseFloat(edge === 'top' ? style.borderTopWidth : style.borderBottomWidth);
    const lineStyle = edge === 'top' ? style.borderTopStyle : style.borderBottomStyle;
    const colour = edge === 'top' ? style.borderTopColor : style.borderBottomColor;
    return { text: style.color, background, border: width > 0 && lineStyle !== 'none' ? colour : 'none' };
  }, side);
}

test('forced colours (Windows High Contrast) keep the Run button and the tables visible', async ({ page }) => {
  await openApp(page);
  await runAndExpectFinished(page);
  await page.emulateMedia({ forcedColors: 'active' });
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);

  const run = runButton(page);
  await expect(run).toBeVisible();
  const button = await colours(run);
  expect(button.text, 'Run: its words differ from the colour behind them').not.toBe(button.background);
  expect(button.border, 'Run: a border marks the button').not.toBe('none');
  expect(button.border).not.toBe(button.background);

  for (const table of [nodeTable(page), currentsTable(page)]) {
    await expect(table).toBeVisible();
    const header = await colours(table.getByRole('columnheader').first(), 'bottom');
    expect(header.text).not.toBe(header.background);
    expect(header.border, 'a line under the column headers').not.toBe('none');
    const cell = await colours(table.getByRole('cell').first());
    expect(cell.text).not.toBe(cell.background);
  }
});

test('reduced motion: the setting and the device preference turn transitions off', async ({ page }) => {
  await openApp(page);
  const duration = (): Promise<number> =>
    runButton(page).evaluate((b) => {
      const d = getComputedStyle(b).transitionDuration.split(',')[0]!.trim();
      return d.endsWith('ms') ? parseFloat(d) / 1000 : parseFloat(d);
    });
  expect(await duration(), 'the Run button fades its colour normally').toBeGreaterThan(0.05);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await duration(), 'the device asks for reduced motion').toBeLessThan(0.001);

  // "Normal" in Settings wins over the device; "Reduce motion" wins over a device that does not ask.
  await chooseSetting(page, t('motion'), t('motionNormal'));
  expect(await duration()).toBeGreaterThan(0.05);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await chooseSetting(page, t('motion'), t('motionReduce'));
  expect(await setting(page, 'data-motion')).toBe('reduce');
  expect(await duration(), 'Reduce motion chosen in Settings').toBeLessThan(0.001);
});
