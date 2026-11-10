/**
 * Screenshots of the schematic lab (design/lab/): one PNG per example and fixture, drawn by the
 * automatic layout of src/schematic/, so people can judge the layouts without running anything.
 *
 *   node --experimental-strip-types scripts/lab-shots.ts [--port 5310] [--only e04-4-open,f5-thevenin-cccs]
 *
 * Starts its own Vite dev server, opens /design/lab/ in Chromium (Playwright), and writes
 * docs/design/lab/<name>.png. Fails when the page reports an error or a drawing is not clean.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const port = Number(option('port', '5310'));
const only = option('only', '').split(',').filter(Boolean);
const outDir = resolve(root, 'docs/design/lab');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ root, server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
let failures = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1.5, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`http://localhost:${port}/design/lab/`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.ready === '1', undefined, { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  if (errors.length) {
    failures += 1;
    console.error(`page errors: ${errors.join(' | ')}`);
  }
  const cards = await page.locator('section.card').all();
  for (const card of cards) {
    const name = (await card.getAttribute('data-name')) ?? 'unknown';
    if (only.length && !only.includes(name)) continue;
    const file = resolve(outDir, `${name}.png`);
    await card.screenshot({ path: file });
    const bad = await card.locator('.bad').count();
    if (bad) {
      failures += 1;
      console.error(`NOT CLEAN ${name}: ${await card.locator('.bad').innerText()}`);
    }
    console.log(`wrote ${file}`);
  }
  await context.close();
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);
