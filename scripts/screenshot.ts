/**
 * The README screenshots: the built app (vite preview) on its first screen, Start here, solved by
 * ngspice; R1's card open with a new value typed (2k), the numbers solved again and the old ones
 * crossed out.
 *
 *   npm run build
 *   npm run screenshot
 *
 * Writes docs/screenshot.png (a 1280 × 800 window at 2× pixels), docs/screenshot-phone.png (a
 * 390 × 844 phone at 3× pixels, the card as a sheet along the bottom) and docs/screenshot-editing.png
 * (the editor, decision 0017: a third resistor in hand on Start here, where its left end would connect
 * to ground, the hint line saying so before the click). Builds the app first if there is no build. Uses
 * Playwright's Chromium (preinstalled in Claude's cloud sessions; elsewhere
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
  await page.getByRole('application', { name: /^Drawing of the circuit/ }).getByRole('button', { name: /^R1, / }).click();
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

/** Where a point of the drawing's grid (its *@ coordinates) is on the screen now. */
async function gridPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const view = await page.evaluate(() => {
    const world = document.querySelector<HTMLElement>('.nb-world');
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(world?.style.transform ?? '');
    const r = document.querySelector('.nb-canvas')!.getBoundingClientRect();
    return m ? { x: Number(m[1]) + r.left, y: Number(m[2]) + r.top, unit: Number(m[3]) * 20 } : undefined;
  });
  if (!view) throw new Error('the drawing has no view yet');
  return { x: view.x + x * view.unit, y: view.y + y * view.unit };
}

/** Start here with a resistor in hand, held where its left end lands on ground's wire (at R2's foot). */
async function resistorInHand(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await solved(page);
  await page.getByRole('toolbar', { name: t('partsLabel') }).getByRole('button', { name: /^Resistor/ }).click();
  const at = await gridPoint(page, 10, 6);
  await page.mouse.move(at.x, at.y);
  await page.locator('#hint-line').filter({ hasText: t('hintPlaceHere', { part: 'a resistor', joins: t('joinsTwo', { a: 'ground', b: t('joinsNew') }) }).split(' · ')[0]! }).waitFor({ timeout: RUN_TIMEOUT });
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

  const editing = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const edit = await editing.newPage();
  await resistorInHand(edit, url);
  await edit.screenshot({ path: resolve(root, 'docs/screenshot-editing.png'), animations: 'disabled', caret: 'hide' });
  await editing.close();
}

if (!existsSync(resolve(root, 'dist/index.html'))) await build({ root, logLevel: 'warn' });
// Not 4173 or 4174 (vite preview's default and the e2e tests'); the next free port if taken.
const server = await preview({ root, logLevel: 'warn', preview: { port: 4176, strictPort: false, open: false } });
const url = server.resolvedUrls?.local[0];
const browser = await chromium.launch();
try {
  if (!url) throw new Error('vite preview gave no address');
  await shoot(browser, url);
  console.log('Wrote docs/screenshot.png, docs/screenshot-phone.png and docs/screenshot-editing.png');
} finally {
  await browser.close();
  await server.close();
}
