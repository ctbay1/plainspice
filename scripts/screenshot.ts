/**
 * The README screenshots: the built app (vite preview) on its first screen, Start here, solved by
 * ngspice; R1's card open with a new value typed (2k), the numbers solved again and the old ones
 * crossed out.
 *
 *   npm run build
 *   npm run screenshot
 *
 * Writes docs/screenshot.png (a 1280 × 800 window at 2× pixels) and docs/screenshot-phone.png (a
 * 390 × 844 phone at 3× pixels, the card as a sheet along the bottom). Builds the app first if there
 * is no build. Uses Playwright's Chromium (preinstalled in Claude's cloud sessions; elsewhere
 * `npx playwright install chromium`).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { build, preview } from 'vite';
import { t } from '../src/i18n/index.ts';

const root = resolve(import.meta.dirname, '..');
const RUN_TIMEOUT = 30_000;

/** The status line says ngspice has run the netlist as it is now ("Finished in 12 ms"). */
async function solved(page: Page): Promise<void> {
  await page.locator('.status').filter({ hasText: new RegExp(t('statusSolved', { ms: '\\d+' })) }).waitFor({ timeout: RUN_TIMEOUT });
}

/** The first screen, then R1's card with 2k typed and solved again. */
async function changeR1(page: Page, url: string, phone: boolean): Promise<void> {
  await page.goto(url);
  await solved(page);
  await page.getByRole('group', { name: /^Drawing of the circuit/ }).getByRole('button', { name: /^R1, / }).click();
  const card = page.getByRole('dialog', { name: /^R1 / });
  const field = card.getByRole('textbox');
  await field.click();
  await field.press('ControlOrMeta+a');
  await field.pressSequentially('2k', { delay: 60 });
  // The drawing shows the new numbers: out = 3 V.
  await page.waitForFunction(() => /=\s3\sV/.test(document.querySelector('.nb-canvas svg[role="img"]')?.textContent ?? ''), undefined, { timeout: RUN_TIMEOUT });
  if (phone) await card.getByRole('button', { name: t('cardDone') }).click();
  // Nothing focused (no focus ring, no caret), the web fonts in, no animation half-way.
  await page.evaluate(async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    await document.fonts.ready;
  });
  await page.waitForTimeout(400);
}

async function shoot(browser: Browser, url: string): Promise<void> {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await desktop.newPage();
  await changeR1(page, url, false);
  await page.screenshot({ path: resolve(root, 'docs/screenshot.png'), animations: 'disabled', caret: 'hide' });
  await desktop.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const small = await phone.newPage();
  await changeR1(small, url, true);
  await small.screenshot({ path: resolve(root, 'docs/screenshot-phone.png'), animations: 'disabled', caret: 'hide' });
  await phone.close();
}

if (!existsSync(resolve(root, 'dist/index.html'))) await build({ root, logLevel: 'warn' });
// Not 4173 or 4174 (vite preview's default and the e2e tests'); the next free port if taken.
const server = await preview({ root, logLevel: 'warn', preview: { port: 4176, strictPort: false, open: false } });
const url = server.resolvedUrls?.local[0];
const browser = await chromium.launch();
try {
  if (!url) throw new Error('vite preview gave no address');
  await shoot(browser, url);
  console.log('Wrote docs/screenshot.png and docs/screenshot-phone.png');
} finally {
  await browser.close();
  await server.close();
}
