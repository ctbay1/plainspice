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
// space in ngspice. Here ngspice gets only what fits (src/spice/run-netlist.ts), and the status line of a
// netlist it never got says "PlainSpice did not run it", not "ngspice could not run" (the last pass, C3-4).
test.describe('what PlainSpice hands ngspice', () => {
  test('a run=1 link with a title of 600 bytes runs, and the ngspice output panel says the title was cut', async ({ page }) => {
    await openApp(page, `./#${await encodeShare(`* ${'W'.repeat(598)}\n${DIVIDER}`, { run: true })}`);
    await expectSolved(page);
    const output = await openPanel(page, 'output');
    await expect(output.getByText(RUN_COPY_WORDS.titleCut(1, 600, 504))).toBeVisible();
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

  // The round-1 critic's R1: ngspice takes the blanks out of the brackets of a .save line, so three
  // words of 200 bytes are one name of 600, which crashed the page on b060bc8 and on the first fix.
  test('a run=1 link whose .save line joins three 200-byte words is not given to ngspice: the status line says why', async ({ page }) => {
    const words = `${'W'.repeat(200)} ${'W'.repeat(200)} ${'W'.repeat(200)}`;
    await openApp(page, `./#${await encodeShare(`* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.save i( ${words} ) v(b)\n.op\n.end\n`, { run: true })}`);
    await expect(statusLine(page)).toContainText(t('statusRefused'));
    await expect(statusLine(page)).not.toContainText(t('statusRunFailed'));
    await expect(statusLine(page)).toContainText(RUN_COPY_WORDS.joinedWord(5, `i( ${words} )`, 603));
  });

  // The round-2 critic's C2-2, C2-3 and C2-4: ngspice runs a *# line as a command outside a .control block
  // too, reads a .title line of a circuit built with circbyline as its title, and makes a word of each
  // choice in braces. No check saw these, and each of these links crashed the page on b060bc8 and on the
  // round-2 fix.
  test('a run=1 link that builds a circuit by *# circbyline lines with a 601-byte title is not given to ngspice: the status line says why', async ({ page }) => {
    const lines = [`* ${'ab '.repeat(200).trimEnd()}`, 'V1 a 0 9', 'R1 a 0 1k', '.op', '.end'].map((l) => `*# circbyline ${l}`).join('\n');
    await openApp(page, `./#${await encodeShare(`* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\n${lines}\n*# op\n.end\n`, { run: true })}`);
    await expect(statusLine(page)).toContainText(t('statusRefused'));
    await expect(statusLine(page)).not.toContainText(t('statusRunFailed'));
    await expect(statusLine(page)).toContainText(RUN_COPY_WORDS.circuitTitle(6, 601));
  });

  test('a run=1 link whose circbyline .title line is 599 bytes is not given to ngspice: the status line says why', async ({ page }) => {
    const lines = ['* short', `.title ${'ab '.repeat(200).trimEnd()}`, 'V1 a 0 9', 'R1 a 0 1k', '.op', '.end'].map((l) => `circbyline ${l}`).join('\n');
    await openApp(page, `./#${await encodeShare(`* t\nV9 z 0 1\nR9 z 0 1\n.op\n.control\n${lines}\nop\n.endc\n.end\n`, { run: true })}`);
    await expect(statusLine(page)).toContainText(t('statusRefused'));
    await expect(statusLine(page)).not.toContainText(t('statusRunFailed'));
    await expect(statusLine(page)).toContainText(RUN_COPY_WORDS.circuitDotTitle(7, 599));
  });

  test('a run=1 link whose print line has choices in braces is not given to ngspice: the status line says why', async ({ page }) => {
    await openApp(page, `./#${await encodeShare('* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.control\nop\nprint ({v(b),v(b)}{,}{,}{,}{,}{,}{,}{,})+ v(b)\n.endc\n.end\n', { run: true })}`);
    await expect(statusLine(page)).toContainText(t('statusRefused'));
    await expect(statusLine(page)).not.toContainText(t('statusRunFailed'));
    await expect(statusLine(page)).toContainText(RUN_COPY_WORDS.braceChoices(7, '({v(b),v(b)}{,}{,}{,}{,}{,}{,}{,})+'));
  });

  // The round-1 critic's R5: only analysis commands are written into 512 bytes; the first fix refused
  // every .control line over 500 bytes, though ngspice runs these.
  test('a .control block with a print line of 525 bytes runs', async ({ page }) => {
    await openApp(page, `./#${await encodeShare(`* t\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\n.control\nop\nprint${' v(b)'.repeat(104)}\n.endc\n.end\n`, { run: true })}`);
    await expectSolved(page);
  });

  // The last pass's regress-3: the copy adds no .options savecurrents when a + line after .end would continue it
  // (decision 0011), and the parts' currents were gone with no word of why.
  test('a + line after .end: the copy runs as written, and the ngspice output panel says why the parts’ currents are missing', async ({ page }) => {
    await openApp(page, `./#${await encodeShare('* a + line after .end\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n', { run: true })}`);
    await expectSolved(page);
    const output = await openPanel(page, 'output');
    await expect(output.getByText(RUN_COPY_WORDS.plusAfterEnd(6, 4))).toBeVisible();
    await expect(output.getByText(t('outputAdded'))).toHaveCount(0);
  });

  test('a B source typed without its ) is not given to ngspice: the status line says why, until the ) is there', async ({ page }) => {
    await openApp(page);
    await setNetlist(page, '* t\nV1 a 0 9\nR1 a b 1k\nB1 b 0 V=v(a\n.op\n.end\n');
    await expect(statusLine(page)).toContainText(t('statusRefused'));
    await expect(statusLine(page)).not.toContainText(t('statusRunFailed'));
    await expect(statusLine(page)).toContainText(RUN_COPY_WORDS.noClose(4, 'v('));
    await setNetlist(page, '* t\nV1 a 0 9\nR1 a b 1k\nB1 b 0 V=v(a)/2\n.op\n.end\n');
    await expectSolved(page);
  });
});

test.describe('the spike page', () => {
  test('its own netlist box gets the same checks and title cut: a title of 600 bytes runs, a B source without its ) does not', async ({ page }) => {
    await page.goto('./spike/');
    const run = page.locator('#run');
    await expect(run).toBeEnabled({ timeout: 30_000 });
    const box = page.locator('#netlist');
    const results = page.locator('#own-results');
    await box.fill(`* ${'W'.repeat(598)}\n${DIVIDER}`);
    await run.click();
    await expect(results).toContainText(/ngspice finished in \d+ ms/);
    await expect(results).toContainText(RUN_COPY_WORDS.titleCut(1, 600, 504));
    await box.fill('* t\nV1 a 0 9\nR1 a b 1k\nB1 b 0 V=v(a\n.op\n.end\n');
    await run.click();
    await expect(results).toContainText(RUN_COPY_WORDS.noClose(4, 'v('));
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
