/**
 * 8. Accessibility (decision 0010): axe-core with the WCAG 2.0, 2.1 and 2.2 A and AA rules finds no
 * violation in the main states of the app (the first screen, a part's card, every panel, the
 * menus, Ctrl+K, the sheets, the dialogs, traps in red pen, a notice), on a computer and on a phone
 * (both projects run every test here); the page reflows at 320 px; forced colours keep the controls,
 * the drawing and the tables visible; reduced motion turns animation off. axe cannot judge
 * everything (screen-reader wording, focus order, real Windows High Contrast): see the keyboard test
 * and the manual checks in decision 0010.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { RESULT_FONT_STRINGS } from '../../src/notebook/settings.ts';
import { PLOT_STRINGS } from '../../src/plot/strings.ts';
import {
  chooseExample,
  currentsTable,
  drawing,
  drawnText,
  examplesButton,
  expectFinished,
  expectNoAxeViolations,
  expectSolved,
  isPhone,
  nodeTable,
  openApp,
  openCard,
  openHelp,
  openPanel,
  openShare,
  runButton,
  setNetlist,
  settingsButton,
  settle,
  sidewaysScroll,
  t,
} from './helpers.ts';

/** Three traps of two kinds: 1M (a milliohm), 3A (attoamps) and a node only one part touches. */
const TRAPS = '* Several traps at once\nV1 n1 0 6\nR1 n1 n2 1M\nR2 n2 0 1meg\nR3 n2 n9 1k\nI1 0 n1 3A\nC1 n2 0 1u\n.op\n.end\n';

/** A display setting as the app applies it: an attribute on <html> (null: follow the device). */
const setting = (page: Page, name: string): Promise<string | null> => page.evaluate((n) => document.documentElement.getAttribute(n), name);

/** Choose a display setting the way a person does: open Settings, click the option's words, close. */
async function chooseSetting(page: Page, group: string, option: string): Promise<void> {
  await settingsButton(page).click();
  const dialog = page.getByRole('dialog', { name: t('settingsTitle') });
  const radios = dialog.getByRole('radiogroup', { name: group });
  await radios.getByText(option, { exact: true }).click();
  await expect(radios.getByRole('radio', { name: option })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

test('axe: the first screen, a part’s card, every panel, the menus and Ctrl+K', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  await expectNoAxeViolations(page, 'the first screen (Start here, solved)');
  const card = await openCard(page, 'R1');
  await expectNoAxeViolations(page, 'R1’s card');
  const field = card.getByRole('textbox');
  await field.fill('2k');
  await expect(field).toHaveValue('2k');
  await expect.poll(() => drawnText(page), { timeout: 30_000 }).toMatch(/=\s3\sV/);
  await expectNoAxeViolations(page, 'R1’s card after a change (old numbers crossed out)');
  await page.keyboard.press('Escape');
  if (isPhone(page)) await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);

  for (const name of ['netlist', 'checks', 'explain', 'numbers', 'output'] as const) {
    await openPanel(page, name);
    if (name === 'netlist') await expect(page.getByRole('textbox', { name: t('editorLabel') })).toBeVisible();
    await expectNoAxeViolations(page, `the ${name} panel`);
  }
  await examplesButton(page).click();
  await expect(page.getByRole('menu', { name: t('examplesMenu') })).toBeVisible();
  await expectNoAxeViolations(page, 'the Examples menu open');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog', { name: t('paletteTitle') })).toBeVisible();
  await expectNoAxeViolations(page, 'Ctrl+K open');
  await page.keyboard.press('Escape');

  // A sweep: the results card on the paper, and the Plot panel with its figure, slider and data table.
  await chooseExample(page, t('exampleD1'));
  await expectSolved(page);
  await expectNoAxeViolations(page, 'a sweep solved (its results card)');
  await openPanel(page, 'plot');
  const figure = page.getByRole('figure');
  await expect(figure.getByRole('slider')).toBeVisible();
  await figure.getByText(PLOT_STRINGS.tableToggle).click();
  await expect(figure.getByRole('table')).toBeVisible();
  await expectNoAxeViolations(page, 'the Plot panel');
});

test('axe: traps in red pen and in the Checks panel, a run that has them, and a circuit with no single answer', async ({ page }) => {
  await openApp(page);
  await setNetlist(page, TRAPS);
  const checks = await openPanel(page, 'checks');
  await expect(checks.getByRole('listitem')).toHaveCount(3);
  await expectNoAxeViolations(page, 'the Checks panel with three traps');
  await expectSolved(page);
  await openPanel(page, 'numbers');
  await expectNoAxeViolations(page, 'the Numbers panel of a run with traps');
  await setNetlist(page, '* No ground\nV1 a b 6\nR1 a b 2\n.op\n.end\n');
  await expect(page.locator('.status')).toContainText(t('statusUnreliable'), { timeout: 30_000 });
  await expectNoAxeViolations(page, 'no ground: no numbers, red pen');
});

test('axe: the Share, Settings and Help dialogs; on a phone the Parts and More sheets', async ({ page }) => {
  await openApp(page);
  const share = await openShare(page);
  await expect(share.getByRole('textbox', { name: t('shareLinkLabel') })).toHaveValue(/#c=/);
  await expectNoAxeViolations(page, 'the Share dialog');
  await page.keyboard.press('Escape');
  await expect(share).toHaveCount(0);
  await settingsButton(page).click();
  await expect(page.getByRole('dialog', { name: t('settingsTitle') })).toBeVisible();
  await expectNoAxeViolations(page, 'the Settings dialog');
  await page.keyboard.press('Escape');
  const help = await openHelp(page);
  await expectNoAxeViolations(page, 'the Help dialog');
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  if (!isPhone(page)) {
    await page.getByRole('toolbar', { name: t('actionsLabel') }).getByRole('button', { name: t('export') }).click();
    await expect(page.getByRole('menu', { name: t('exportMenu') })).toBeVisible();
    await expectNoAxeViolations(page, 'the Export menu open');
    await page.keyboard.press('Escape');
    // The controlled sources' menu of the parts toolbar.
    await page.getByRole('toolbar', { name: t('partsLabel') }).getByRole('button', { name: new RegExp(`^${t('toolControlled')}`) }).click();
    await expect(page.getByRole('menu', { name: t('controlledMenu') })).toBeVisible();
    await expectNoAxeViolations(page, 'the controlled sources menu open');
    await page.keyboard.press('Escape');
    return;
  }
  const bar = page.getByRole('navigation', { name: t('barLabel') });
  await bar.getByRole('button', { name: t('barParts') }).click();
  await expect(page.getByRole('dialog', { name: t('partsSheetTitle') })).toBeVisible();
  await expectNoAxeViolations(page, 'the Parts sheet');
  await page.keyboard.press('Escape');
  await bar.getByRole('button', { name: t('barMore') }).click();
  await expect(page.getByRole('dialog', { name: t('barMore') })).toBeVisible();
  await expectNoAxeViolations(page, 'the More sheet');
});

test('axe: high contrast, chosen in Settings and asked for by the device', async ({ page }) => {
  await openApp(page);
  await chooseSetting(page, t('contrast'), t('contrastMore'));
  expect(await setting(page, 'data-contrast')).toBe('more');
  await expectSolved(page);
  await expectNoAxeViolations(page, 'high contrast (setting), the first screen');
  await openCard(page, 'R1');
  await expectNoAxeViolations(page, 'high contrast (setting), a card');
  await page.keyboard.press('Escape');
  if (isPhone(page)) await page.keyboard.press('Escape');
  await setNetlist(page, TRAPS);
  await openPanel(page, 'checks');
  await expectNoAxeViolations(page, 'high contrast (setting), Checks with traps');
  await openPanel(page, 'netlist');
  await expectNoAxeViolations(page, 'high contrast (setting), the Netlist panel');

  // "Follow my device" with a device that asks for more contrast.
  await chooseSetting(page, t('contrast'), t('followDevice'));
  await page.emulateMedia({ contrast: 'more' });
  expect(await setting(page, 'data-contrast')).toBeNull();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.paper .nb-canvas') ?? document.body).backgroundColor)).toBe('rgb(255, 255, 255)');
  await openPanel(page, 'checks');
  await expectNoAxeViolations(page, 'high contrast (device), Checks with traps');
});

test('axe: extra-large text (150 %) and the plain font for results', async ({ page }) => {
  await openApp(page);
  await chooseSetting(page, t('textSize'), t('textSizeXLarge'));
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('24px');
  await expectSolved(page);
  await expectNoAxeViolations(page, 'extra-large text, the first screen');
  await openCard(page, 'R1');
  await expectNoAxeViolations(page, 'extra-large text, a card');
  await page.keyboard.press('Escape');
  if (isPhone(page)) await page.keyboard.press('Escape');
  await openPanel(page, 'numbers');
  await expectNoAxeViolations(page, 'extra-large text, Numbers');
  // The plain font: results written in Inter instead of handwriting.
  await chooseSetting(page, RESULT_FONT_STRINGS.label, RESULT_FONT_STRINGS.plain);
  await expect(page.locator('.app')).toHaveClass(/\bnb-plain\b/);
  await expectNoAxeViolations(page, 'extra-large text, plain font');
});

test('reflow: no sideways scrolling at 320 px wide, with normal and extra-large text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const fits = async (what: string): Promise<void> => {
    await settle(page);
    expect(await sidewaysScroll(page), `${what}: the page does not scroll sideways`).toBeLessThanOrEqual(0);
  };
  await openApp(page);
  await expectSolved(page);
  await fits('the first screen');
  const card = await openCard(page, 'R1');
  await fits('a card');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expectFinished(page);
  await fits('the Numbers panel');

  // The Currents table is wider than 320 px: it scrolls inside its own box (allowed for data tables,
  // WCAG 1.4.10), and that box is a named region the keyboard can reach and scroll.
  const box = page.getByRole('region', { name: t('currentsCaption') });
  await expect(box).toBeVisible();
  await box.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => box.evaluate((b) => b.scrollLeft)).toBeGreaterThan(0);

  for (const name of ['explain', 'output', 'netlist'] as const) {
    await openPanel(page, name);
    await fits(name);
  }
  await setNetlist(page, TRAPS);
  await openPanel(page, 'checks');
  await fits('checks');

  await chooseSetting(page, t('textSize'), t('textSizeXLarge'));
  await fits('checks, 150 % text');
  await expectSolved(page);
  await openPanel(page, 'numbers');
  await fits('numbers, 150 % text');
  for (const name of ['explain', 'output', 'netlist'] as const) {
    await openPanel(page, name);
    await fits(`${name}, 150 % text`);
  }
  await openHelp(page);
  await fits('the Help dialog, 150 % text');
  await page.keyboard.press('Escape');
  await examplesButton(page).click();
  await expect(page.getByRole('menu', { name: t('examplesMenu') })).toBeVisible();
  await fits('the Examples menu, 150 % text');
});

test('reflow: the Plot panel with its data table open fits 320 px; the table scrolls in its own box (a11y review F2)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openApp(page);
  for (const example of [t('exampleT1'), t('exampleD1')]) {
    await chooseExample(page, example);
    await expectSolved(page);
    await openPanel(page, 'plot');
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

test('"Link copied." reaches screen readers while the Share dialog is open (a11y review F1)', async ({ page }) => {
  await openApp(page);
  const dialog = await openShare(page);
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

/** The contrast ratio of two CSS colours (rgb() or rgba(), as getComputedStyle gives them). */
function contrast(a: string, b: string): number {
  const lum = (c: string): number => {
    const [r, g, bl] = (c.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map((x) => Number(x) / 255);
    const lin = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(bl!);
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

test('forced colours in a dark theme keep the drawing, its words and the focus ring readable', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' });
  const ink = await drawing(page).evaluate(() => {
    const css = (sel: string, prop: 'stroke' | 'fill'): string => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el)[prop] : '';
    };
    return {
      paper: getComputedStyle(document.querySelector('.nb-canvas')!).backgroundColor,
      symbol: css('.nb-canvas .nb-sym', 'stroke'),
      wire: css('.nb-canvas .nb-wire', 'stroke'),
      name: css('.nb-canvas .nb-name', 'fill'),
      value: css('.nb-canvas .nb-value', 'fill'),
      result: css('.nb-canvas .nb-result__text', 'fill'),
    };
  });
  for (const [what, colour] of Object.entries(ink)) {
    if (what === 'paper') continue;
    expect(contrast(colour, ink.paper), `${what} (${colour}) on the paper (${ink.paper})`).toBeGreaterThanOrEqual(what === 'symbol' || what === 'wire' ? 3 : 4.5);
  }
  // The keyboard's ring round a part.
  await drawing(page).getByRole('button', { name: /^R1, / }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  const ring = await page.locator('.nb-focus').first().evaluate((el) => getComputedStyle(el).stroke);
  expect(contrast(ring, ink.paper), `the focus ring (${ring})`).toBeGreaterThanOrEqual(3);
});

test('forced colours (Windows High Contrast) keep the Run button, the drawing and the tables visible', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  await page.emulateMedia({ forcedColors: 'active' });
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);

  const run = runButton(page);
  await expect(run).toBeVisible();
  const button = await colours(run);
  expect(button.text, 'Run: its icon and words differ from the colour behind them').not.toBe(button.background);
  expect(button.border, 'Run: a border marks the button').not.toBe('none');
  expect(button.border).not.toBe(button.background);

  // The drawing's ink and its results are drawn in the system's text colour, not the paper's.
  const ink = await drawing(page).evaluate(() => {
    const wire = document.querySelector('.nb-canvas svg path, .nb-canvas svg line');
    const words = document.querySelector('.nb-canvas svg text');
    const paper = getComputedStyle(document.querySelector('.nb-canvas')!).backgroundColor;
    return { wire: wire ? getComputedStyle(wire).stroke : '', words: words ? getComputedStyle(words).fill : '', paper };
  });
  expect(ink.wire).not.toBe(ink.paper);
  expect(ink.words).not.toBe(ink.paper);

  await expectFinished(page);
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
