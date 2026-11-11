/**
 * 12. Larger text and other window sizes (WCAG 1.4.4, 1.4.10): with the Text size setting at 125 %
 * and 150 %, on ordinary laptop windows and a phone held sideways, the circuit's title keeps room,
 * every part tool is on the screen, every panel tab can be reached (the column says when it has
 * more), the drawing's words keep their size, and a part's card never covers the drawing's words.
 * A window that is small for its text (150 % on a laptop) gets the phone's layout, as a browser's
 * zoom gives it: then the card is a sheet below the drawing.
 */
import { expect, test, type Page } from '@playwright/test';
import { drawing, expectSolved, isPhone, openApp, partOnDrawing, phoneLayout, sidewaysScroll, t, TYPING } from './helpers.ts';

type TextSize = 'normal' | 'large' | 'x-large';

async function openAt(page: Page, width: number, height: number, textSize: TextSize): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.addInitScript((size) => localStorage.setItem('plainspice:settings', JSON.stringify({ textSize: size, contrast: 'device', motion: 'device' })), textSize);
  await openApp(page);
  await expectSolved(page);
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

/** The boxes of the drawing's words (names, values, results, node names) that are on the screen. */
async function drawnWords(page: Page): Promise<Rect[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.nb-canvas svg text')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth)
      .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
  );
}

/** The size of a part's name on the drawing, in pixels. */
async function nameSize(page: Page): Promise<number> {
  return page.locator('.nb-canvas svg .nb-name').first().evaluate((el) => el.getBoundingClientRect().height);
}

const DESKTOP: [number, number, TextSize][] = [
  [1280, 800, 'large'],
  [1280, 800, 'x-large'],
  [1366, 657, 'normal'],
  [1366, 768, 'x-large'],
];

test.describe('a computer, with larger text', () => {
  test.beforeEach(({ page }) => {
    test.skip(isPhone(page), 'computer window sizes');
  });

  for (const [width, height, size] of DESKTOP) {
    test(`${width}×${height}, text ${size}: the title, the tools, the tabs, and a card that covers no words`, async ({ page }) => {
      await openAt(page, width, height, size);
      // The circuit's title (the page's heading) keeps room for its words.
      const title = page.getByRole('heading', { level: 1 });
      expect((await title.boundingBox())!.width, 'the title').toBeGreaterThan(90);
      expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
      if (await phoneLayout(page)) {
        // Small for its text: the phone's layout, its bar, and the card as a sheet below the drawing.
        await expect(page.getByRole('navigation', { name: t('barLabel') })).toBeVisible();
        expect(width / (size === 'x-large' ? 1.5 : size === 'large' ? 1.25 : 1) < 900 || height / (size === 'x-large' ? 1.5 : size === 'large' ? 1.25 : 1) < 521, 'only when small for its text').toBe(true);
        await partOnDrawing(page, 'R1').click();
        const sheet = page.getByRole('dialog', { name: /^R1 / });
        await expect(sheet).toBeVisible();
        await page.waitForTimeout(500);
        const r1 = (await partOnDrawing(page, 'R1').boundingBox())!;
        expect(r1.y + r1.height, 'R1 is above the card').toBeLessThanOrEqual((await sheet.boundingBox())!.y + 2);
        return;
      }
      // Every part tool is on the screen.
      const tools = page.getByRole('toolbar', { name: t('partsLabel') }).getByRole('button');
      for (const tool of await tools.all()) {
        const box = (await tool.boundingBox())!;
        expect(box.y + box.height, `${await tool.getAttribute('data-tool')} is on the screen`).toBeLessThanOrEqual(height);
      }
      // Every panel tab is on the screen, or the column shows it has more (and scrolls to it).
      const nav = page.getByRole('navigation', { name: t('panelsLabel') });
      for (const tab of await nav.getByRole('button').all()) {
        const box = (await tab.boundingBox())!;
        if (box.y + box.height > height - 60) await expect(nav).toHaveClass(/\bhas-more-below\b/);
        await tab.scrollIntoViewIfNeeded();
        await expect(tab).toBeInViewport();
      }
      // A part's card covers none of the drawing's words (beside its part, or docked below the drawing).
      await partOnDrawing(page, 'R1').click();
      const card = page.getByRole('dialog', { name: /^R1 / });
      await expect(card).toBeVisible();
      await page.waitForTimeout(400);
      const box = (await card.boundingBox())!;
      for (const word of await drawnWords(page)) expect(overlap(box, word), `the card covers a word at ${Math.round(word.x)}, ${Math.round(word.y)}`).toBe(false);
      // And it stays put while a value is typed, a refused one included.
      const field = card.getByRole('textbox');
      await field.press('ControlOrMeta+a');
      await field.pressSequentially('4,7k', TYPING);
      await page.waitForTimeout(900);
      // It may grow (new numbers), away from its part: one of its edges stays where it was.
      const after = (await card.boundingBox())!;
      expect(Math.abs(after.x - box.x), 'the card did not move sideways').toBeLessThan(2);
      const topStays = Math.abs(after.y - box.y) < 2;
      const bottomStays = Math.abs(after.y + after.height - (box.y + box.height)) < 2;
      expect(topStays || bottomStays, 'the card did not move').toBe(true);
    });
  }

  test('the drawing’s words keep their size with the Text size setting (never below its larger minimum)', async ({ page }) => {
    await openAt(page, 1280, 800, 'normal');
    const normal = await nameSize(page);
    await openAt(page, 1280, 800, 'x-large');
    const larger = await nameSize(page);
    // The page's bars take more room, so the drawing fits a smaller space: its words may not grow,
    // but they do not shrink as before (31 px to 26 px), and never below 150 % of the smallest size.
    expect(larger, 'names at 150 % are about as large as at 100 %').toBeGreaterThanOrEqual(normal * 0.9);
    expect(larger, 'names at 150 % are at least 150 % of the smallest size').toBeGreaterThanOrEqual(10.5 * 1.5);
  });
});

test('a phone held sideways (915×412) uses the phone’s layout: the card is a sheet below the drawing', async ({ page }) => {
  await openAt(page, 915, 412, 'normal');
  await expect(page.getByRole('navigation', { name: t('barLabel') })).toBeVisible();
  await drawing(page).getByRole('button', { name: /^R1, / }).click();
  const card = page.getByRole('dialog', { name: /^R1 / });
  await expect(card).toBeVisible();
  await page.waitForTimeout(500);
  const box = (await card.boundingBox())!;
  const r1 = (await partOnDrawing(page, 'R1').boundingBox())!;
  expect(r1.y + r1.height, 'R1 is above the card').toBeLessThanOrEqual(box.y + 2);
});
