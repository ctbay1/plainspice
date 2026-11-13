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
  statusLine,
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

/**
 * What the status line paints over the drawing: its pill, or (a calm status folded in a very short
 * window, its box transparent) just its dot; the buttons on it; and the words of the drawing under
 * what is painted.
 */
async function statusOverDrawing(page: Page): Promise<{ painted: string; buttons: string[]; under: string[] }> {
  return page.evaluate(() => {
    const status = document.querySelector<HTMLElement>('.status')!;
    const bg = getComputedStyle(status).backgroundColor;
    const clear = bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)';
    const r = (clear ? (status.querySelector('.status__dot') ?? status) : status).getBoundingClientRect();
    const under = [...document.querySelectorAll('.nb-canvas svg text')]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom;
      })
      .map((e) => (e.textContent ?? '').trim());
    return { painted: `${clear ? 'dot' : 'pill'} ${[r.left, r.top, r.right, r.bottom].map(Math.round).join(',')}`, buttons: [...status.querySelectorAll('button')].map((b) => b.textContent ?? ''), under };
  });
}

/** Where the drawing is drawn now (its world's place and size on the screen). */
const drawnAt = (page: Page): Promise<string> => page.evaluate(() => getComputedStyle(document.querySelector('.nb-world')!).transform);

test('a very short window (a laptop at 400 %): walking the drawing with the keys or dragging it keeps a calm status a dot over none of the drawing, and a scroll or a zoom unfolds nothing; More keeps “Show the whole drawing” (AP-1)', async ({ page }) => {
  // A touch screen drags the paper with a finger; a laptop with the mouse, from the margin left of the red
  // line, where the fit draws nothing (a press near a part, a wire or a node's name is the editor's).
  const finger = !!test.info().project.use.hasTouch;
  for (const [width, height] of [
    [320, 200],
    [320, 256],
  ] as const) {
    await page.setViewportSize({ width, height });
    await openApp(page);
    await expectSolved(page);
    // Tab reaches the skip link, Enter puts the focus on the drawing's first item; then the keys walk it.
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveText(t('skipToDrawing'));
    await page.keyboard.press('Enter');
    await expect(page.locator('.nb-hit:focus')).toHaveCount(1);
    for (const key of ['', 'End', 'Home', 'ArrowRight', 'ArrowRight', 'ArrowDown']) {
      if (key) await page.keyboard.press(key);
      await settle(page);
      const at = `${width} × ${height}, after ${key || 'the skip link'} (${await page.locator('.nb-hit:focus').getAttribute('aria-label')})`;
      const over = await statusOverDrawing(page);
      expect(over.buttons, `${at}: no button unfolds the calm status (${over.painted})`).toEqual([]);
      expect(over.under, `${at}: none of the drawing's words under the status (${over.painted})`).toEqual([]);
    }
    // Moved by the pointer, from the first screen: a drag of the paper (34 px, away from the margin), then
    // a scroll and a zoom (Ctrl + wheel). The same: the calm status stays a dot, with no button to unfold it
    // (on b060bc8 and 30f3eec, a 210 px pill with "Show the whole drawing" over V1, 6 V and R2). After a
    // scroll or a zoom of the reader's own the drawing may lie anywhere, under the 9 px dot too.
    await openApp(page);
    await expectSolved(page);
    await settle(page);
    const top = (await page.locator('.top').boundingBox())!;
    const status = (await statusLine(page).boundingBox())!;
    const from = { x: finger ? width * 0.45 : 8, y: (top.y + top.height + status.y) / 2 };
    for (const how of ['dragged', 'scrolled', 'zoomed'] as const) {
      const before = await drawnAt(page);
      if (how === 'dragged' && finger) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
        for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (34 * i) / 8, y: from.y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
      } else if (how === 'dragged') {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (34 * i) / 8, from.y);
        await page.mouse.up();
      } else {
        await page.mouse.move(width / 2, from.y);
        if (how === 'zoomed') await page.keyboard.down('Control');
        await page.mouse.wheel(how === 'scrolled' ? 50 : 0, how === 'scrolled' ? 60 : -120);
        if (how === 'zoomed') await page.keyboard.up('Control');
      }
      await settle(page);
      const at = `${width} × ${height}, ${how}`;
      expect(await drawnAt(page), `${at}: the drawing moved`).not.toBe(before);
      const over = await statusOverDrawing(page);
      expect(over.buttons, `${at}: no button unfolds the calm status (${over.painted})`).toEqual([]);
      expect(over.painted, `${at}: the calm status is painted as its dot alone`).toMatch(/^dot /);
      if (how === 'dragged') expect(over.under, `${at}: none of the drawing's words under the status (${over.painted})`).toEqual([]);
    }
    // The way back to all of it is still there, under More.
    await page.getByRole('navigation', { name: t('barLabel') }).getByRole('button', { name: t('barMore'), exact: true }).click();
    await expect(page.getByRole('dialog', { name: t('barMore') }).getByRole('button', { name: t('zoomFit'), exact: true })).toBeEnabled();
  }
});

/** The colours of a screenshot's pixels at these points (CSS pixels from its top left), read in a blank page of their own. */
async function pixelsOf(page: Page, png: Buffer, points: readonly { x: number; y: number }[]): Promise<string[]> {
  const blank = await page.context().newPage();
  try {
    return await blank.evaluate(
      async ({ data, at, scale }) => {
        const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
        const canvas = new OffscreenCanvas(image.width, image.height);
        const g = canvas.getContext('2d')!;
        g.drawImage(image, 0, 0);
        return at.map(({ x, y }) => {
          const [r, gr, b] = g.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data;
          return `rgb(${r}, ${gr}, ${b})`;
        });
      },
      { data: png.toString('base64'), at: points, scale: await page.evaluate(() => devicePixelRatio) },
    );
  } finally {
    await blank.close();
  }
}

// The last pass's a11y-phone-3: in forced colours the dot was painted in the page's own colour (Canvas) and the
// folded status kept a CanvasText outline, so a laptop at 400 % showed an empty ring in the margin.
test('a very short window in forced colours, light and dark: the calm status folds to a dot painted unlike the page, with no outline round it', async ({ page }) => {
  for (const [width, height, colorScheme] of [
    [320, 200, 'light'],
    [320, 200, 'dark'],
    [427, 267, 'light'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ forcedColors: 'active', colorScheme });
    await openApp(page);
    await expectSolved(page);
    await settle(page);
    const at = `${width} × ${height}, forced colours, ${colorScheme}`;
    // Folded: the dot and the margin round it, with nothing to press (its words are for screen readers only).
    const status = (await statusLine(page).boundingBox())!;
    const dot = (await statusLine(page).locator('.status__dot').boundingBox())!;
    expect(status.width, `${at}: the calm status is folded to its dot`).toBeLessThan(30);
    await expect(statusLine(page).getByRole('button')).toHaveCount(0);
    // The page's colour here, as the system gives it (forced colours paint the paper in Canvas).
    const canvas = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:-20px;top:-20px;width:4px;height:4px;background:Canvas';
      document.body.append(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    });
    const clip = { x: status.x, y: status.y, width: status.width, height: status.height };
    const [middle, edge] = await pixelsOf(page, await page.screenshot({ clip }), [
      { x: dot.x + dot.width / 2 - clip.x, y: dot.y + dot.height / 2 - clip.y },
      // The status box's left edge, half-way down, where its outline was.
      { x: 0.5, y: clip.height / 2 },
    ]);
    expect(middle, `${at}: the dot's middle (the page is ${canvas})`).not.toBe(canvas);
    expect(edge, `${at}: no outline round the folded status (the page is ${canvas})`).toBe(canvas);
  }
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
