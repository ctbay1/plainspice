/**
 * What PlainSpice hands ngspice (src/spice/run-netlist.ts) and the design pages' links, in the
 * built site (the second re-check's P1 and P4).
 */
import { expect, test } from '@playwright/test';

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
