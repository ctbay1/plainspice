/**
 * What PlainSpice hands ngspice (src/spice/run-netlist.ts) and the design pages' links, in the
 * built site (the second re-check's P1 and P4).
 */
import { expect, test } from '@playwright/test';
import { encodeShare } from '../../src/share/link.ts';
import { RUN_COPY_WORDS } from '../../src/spice/run-netlist.ts';
import { expectSolved, openApp, openPanel, setNetlist, statusLine, t } from './helpers.ts';

const DIVIDER = 'V1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\n.end\n';

// Playwright's browser for these projects (chrome-headless-shell) turns any WebAssembly trap into a
// crashed page, so on b060bc8 each of these ends in "Target crashed": the engine ran past the end of a
// space in ngspice. Here ngspice gets only what fits (src/spice/run-netlist.ts).
test.describe('what PlainSpice hands ngspice', () => {
  test('a run=1 link with a title of 600 bytes runs, and the ngspice output panel says the title was cut', async ({ page }) => {
    await openApp(page, `./#${await encodeShare(`* ${'W'.repeat(598)}\n${DIVIDER}`, { run: true })}`);
    await expectSolved(page);
    const output = await openPanel(page, 'output');
    await expect(output.getByText(RUN_COPY_WORDS.titleCut(1, 600))).toBeVisible();
  });

  test('saved work with a .title of 1000 bytes after .end opens and runs', async ({ page }) => {
    await page.addInitScript((text) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('plainspice:netlist', text);
        sessionStorage.setItem('seeded', '1');
      }
    }, `* t\n${DIVIDER}.title ${'W'.repeat(1000)}\n`);
    await openApp(page);
    await expectSolved(page);
    await page.reload();
    await openApp(page);
    await expectSolved(page);
  });

  test('a B source typed without its ) is not given to ngspice: the status line says why, until the ) is there', async ({ page }) => {
    await openApp(page);
    await setNetlist(page, '* t\nV1 a 0 9\nR1 a b 1k\nB1 b 0 V=v(a\n.op\n.end\n');
    await expect(statusLine(page)).toContainText(t('statusRunFailed'));
    await expect(statusLine(page)).toContainText(RUN_COPY_WORDS.noClose(4, 'v('));
    await setNetlist(page, '* t\nV1 a 0 9\nR1 a b 1k\nB1 b 0 V=v(a)/2\n.op\n.end\n');
    await expectSolved(page);
  });
});

test.describe('the design index', () => {
  test('shows both phone views on the page, and "both views side by side" goes to them', async ({ page }) => {
    await page.goto('./design/');
    const link = page.getByRole('link', { name: 'both views side by side' });
    // An in-page link: the picture is on the page, where Vite puts it under assets/ (P4: the old link
    // named ../docs/design/…, which is not deployed, so GitHub Pages answered 404).
    await expect(link).toHaveAttribute('href', '#phone-views');
    await link.click();
    await expect(page).toHaveURL(/#phone-views$/);
    const picture = page.locator('figure#phone-views img');
    await expect(picture).toBeInViewport();
    await expect(picture).toHaveAttribute('src', /(^|\/)assets\/p02-4-open-phone-views-[\w-]+\.png$/);
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0))).toBe(1720);
    await expect(picture).toHaveAccessibleName(/^Both phone views of the checkpoint side by side/);
  });
});
