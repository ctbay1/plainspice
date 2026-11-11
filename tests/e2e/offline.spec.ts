/**
 * 9. Offline (the PWA): after the first visit the service worker has the page, the scripts, the
 * fonts, the engine's Worker and ngspice.wasm, so the app opens and solves with no connection at all.
 */
import { expect, test } from '@playwright/test';
import { drawnText, expectFinished, expectSolved, nodeTable, openApp, openHelp, openPanel, readPlain, rowNamed, shownText, t } from './helpers.ts';

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
