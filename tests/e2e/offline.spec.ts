/**
 * 9. Offline (the PWA): after the first visit the service worker has the page, the scripts, the
 * fonts, the engine's Worker and ngspice.wasm, so the app opens and solves with no connection at all.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { drawnText, expectFinished, expectSolved, isPhone, nodeTable, openApp, openHelp, openPanel, readPlain, rowNamed, shownText, t } from './helpers.ts';

test('offline after the first visit: the app opens, ngspice loads from the cache and solves the first screen', async ({ page, context }) => {
  await openApp(page);
  // The Help dialog says so once the service worker has stored everything it needs.
  await expect
    .poll(
      async () => {
        const help = await openHelp(page);
        const ready = await help.getByText(t('offlineReady')).isVisible();
        await page.keyboard.press('Escape');
        await expect(help).toHaveCount(0);
        return ready;
      },
      { timeout: 30_000, intervals: [1000] },
    )
    .toBe(true);
  // Pages opened before the service worker was installed are not under it; the next load is.
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  // Everything from here on must come from the service worker's cache.
  const fromNetwork: string[] = [];
  const fromCache: string[] = [];
  page.on('response', (r) => (r.fromServiceWorker() ? fromCache : fromNetwork).push(new URL(r.url()).pathname));
  try {
    await page.reload();
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expectSolved(page);
    expect(await drawnText(page)).toMatch(/=\s4\sV/);
    await expectFinished(page);
    expect(fromNetwork, 'nothing came from the network').toEqual([]);
    expect(fromCache).toContain('/');
    expect(fromCache.some((path) => path.endsWith('.wasm')), 'ngspice.wasm came from the cache').toBe(true);
    expect(fromCache.some((path) => path.endsWith('.woff2')), 'the fonts came from the cache').toBe(true);
    const out = rowNamed(nodeTable(page), 'out').getByRole('cell').first();
    expect(readPlain(await shownText(out), 'V')).toBe(4);

    // Parts of the app that load on first use (the Netlist panel's editor, the Help dialog) come from the cache too.
    await openPanel(page, 'netlist');
    await expect(page.getByRole('textbox', { name: t('editorLabel') })).toBeVisible();
    await openHelp(page);
  } finally {
    await context.setOffline(false);
  }
});

test('the service worker leaves the site’s other pages alone: once it is installed, the design pages, the engine check and the licences open as themselves', async ({ page }) => {
  test.skip(isPhone(page), 'one service worker for every device: checked once, on the computer');
  await openApp(page);
  // Installed and active: from now on it answers every page in its scope it takes on.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  const root = resolve(import.meta.dirname, '../..');
  const titleOf = (file: string): string => /<title>([^<]*)<\/title>/.exec(readFileSync(resolve(root, file), 'utf8'))![1]!;
  // Each page, and whether the service worker keeps it for offline use (the licences do; the design pages
  // and the engine check do not, so they come from the site).
  const pages: [string, string, boolean][] = [
    ['./design/', 'design/index.html', false],
    ['./design/lab/', 'design/lab/index.html', false],
    ['./design/checkpoint/', 'design/checkpoint/index.html', false],
    ...['notebook', 'playground', 'studio'].map((name): [string, string, boolean] => [`./design/prototypes/${name}/`, `design/prototypes/${name}/index.html`, false]),
    ['./spike/', 'spike/index.html', false],
    ['./licenses/', 'licenses/index.html', true],
  ];
  for (const [path, file, offline] of pages) {
    const response = await page.goto(path);
    // The page itself, not the app's page from the service worker's cache (which the design pages were: a
    // broken copy of the app, its scripts looked for under design/).
    await expect(page, path).toHaveTitle(titleOf(file));
    if (!offline) expect(response?.fromServiceWorker(), `${path} comes from the site`).toBe(false);
  }
});
