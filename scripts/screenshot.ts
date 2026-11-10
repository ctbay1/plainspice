/**
 * The README screenshots: the built app (vite preview), the first example (F5) run, its Results tab.
 *
 *   npm run build
 *   node --experimental-strip-types scripts/screenshot.ts
 *
 * Writes docs/screenshot.png (a 1280 × 800 window at 2× pixels) and docs/screenshot-phone.png (a
 * 390 × 844 phone at 3× pixels, scrolled to the results). Builds the app first if there is no build.
 * Uses Playwright's Chromium (preinstalled in Claude's cloud sessions; elsewhere
 * `npx playwright install chromium`).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { build, preview } from 'vite';
import { t } from '../src/i18n/index.ts';

const root = resolve(import.meta.dirname, '..');
const RUN_TIMEOUT = 30_000;

async function runF5(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.getByText(t('engineReady')).waitFor({ timeout: RUN_TIMEOUT });
  await page.getByRole('button', { name: t('examples') }).click();
  await page.getByRole('menuitem', { name: t('exampleF5'), exact: true }).click();
  await page.getByRole('toolbar', { name: t('toolbarLabel') }).getByRole('button', { name: t('run'), exact: true }).click();
  await page.getByRole('tab', { name: t('tabResults') }).click();
  await page.getByText(t('statusFinishedText')).waitFor({ timeout: RUN_TIMEOUT });
  // Nothing focused (no focus ring), the web fonts in, no animation half-way.
  await page.evaluate(async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    await document.fonts.ready;
  });
}

async function shoot(browser: Browser, url: string): Promise<void> {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await desktop.newPage();
  await runF5(page, url);
  await page.screenshot({ path: resolve(root, 'docs/screenshot.png'), animations: 'disabled', caret: 'hide' });
  await desktop.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const small = await phone.newPage();
  await runF5(small, url);
  // One column on a phone: the results come after the netlist, so start the picture at the tabs.
  await small.getByRole('tablist').evaluate((tabs) => window.scrollTo(0, tabs.getBoundingClientRect().top + window.scrollY - 12));
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
