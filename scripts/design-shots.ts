/**
 * Screenshots of the milestone-2 design prototypes (design/prototypes/<key>/), all taken the same
 * way so the directions can be compared fairly: a desktop window (1440 × 900 at 2× pixels) and a
 * phone (390 × 844 at 3×, touch), in the states each prototype draws for `#shot=<state>`:
 *
 *   solved  the first screen: the 6 V divider, already solved
 *   edit    R1 selected, its value editor open, R1 changed to 3k (the numbers have moved)
 *   panels  the Netlist and Explain panels open with R1 selected (on a phone: one sheet)
 *   check   R1 = 1M: the Checks panel shows the "1M is a milliohm" trap and its fix
 *
 * A prototype sets document.body.dataset.shotReady = '1' when the state is drawn (after ngspice).
 *
 *   node --experimental-strip-types scripts/design-shots.ts --keys notebook,studio [--port 5301] [--states solved,edit]
 *
 * Writes docs/design/m2/<key>-<state>-<desktop|phone>.png. Starts its own Vite dev server.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from '@playwright/test';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const keys = option('keys', '').split(',').filter(Boolean);
const states = option('states', 'solved,edit,panels,check').split(',').filter(Boolean);
const port = Number(option('port', '5301'));
if (!keys.length) {
  console.error('usage: design-shots.ts --keys notebook,studio [--port 5301] [--states solved,edit,panels,check]');
  process.exit(2);
}

const outDir = resolve(root, 'docs/design/m2');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ root, server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const devicesToShoot = [
  { name: 'desktop', context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
  { name: 'phone', context: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 } },
] as const;
let failures = 0;
try {
  for (const key of keys) {
    for (const device of devicesToShoot) {
      for (const state of states) {
        const context = await browser.newContext({ ...device.context, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(m.text());
        });
        const file = resolve(outDir, `${key}-${state}-${device.name}.png`);
        try {
          await page.goto(`http://localhost:${port}/design/prototypes/${key}/#shot=${state}`, { waitUntil: 'load' });
          await page.waitForFunction(() => document.body.dataset.shotReady === '1', undefined, { timeout: 45_000 });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(300);
          await page.screenshot({ path: file });
          console.log(`wrote ${file}${errors.length ? ` (page errors: ${errors.join(' | ')})` : ''}`);
        } catch (error) {
          failures += 1;
          console.error(`FAILED ${key} ${state} ${device.name}: ${(error as Error).message.split('\n')[0]}${errors.length ? ` (page errors: ${errors.join(' | ')})` : ''}`);
        } finally {
          await context.close();
        }
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);
