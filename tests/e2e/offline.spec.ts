/**
 * 9. Offline (the PWA): after the first visit the service worker has the page, the scripts, the
 * engine's Worker and ngspice.wasm, so the app opens and simulates with no connection at all.
 */
import { expect, test } from '@playwright/test';
import { currentsTable, nodeTable, openApp, readPlain, rowNamed, RUN_TIMEOUT, runAndExpectFinished, shownText, t } from './helpers.ts';

test('offline after the first visit: the app opens, ngspice loads from the cache and a run works', async ({ page, context }) => {
  await openApp(page);
  // The footer says so once the service worker has stored everything it needs.
  await expect(page.getByText(t('offlineReady'))).toBeVisible({ timeout: 30_000 });
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
    await expect(page.getByText(t('engineReady'))).toBeVisible({ timeout: RUN_TIMEOUT });
    await runAndExpectFinished(page);
    expect(fromNetwork, 'nothing came from the network').toEqual([]);
    expect(fromCache).toContain('/');
    expect(fromCache.some((path) => path.endsWith('.wasm')), 'ngspice.wasm came from the cache').toBe(true);
    const a = rowNamed(nodeTable(page), 'a').getByRole('cell').first();
    expect(readPlain(await shownText(a), 'V')).toBe(14);
    await expect(currentsTable(page)).toBeVisible();

    // A part of the app that loads on first use (the Help dialog) comes from the cache too.
    await page.getByRole('button', { name: t('help'), exact: true }).click();
    await expect(page.getByRole('dialog', { name: t('helpTitle') })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
