/**
 * 10. Phones (decision 0015): a wide drawing is turned a quarter to fit a phone held upright, and
 * "As in the video" (a video's own drawing) or "As drawn" (any other) shows it unturned, with "more"
 * at its edges (the turn is decided on the circuit opened,
 * whatever was open before); one bar along the bottom (Select, Parts, Netlist, Checks, Explain, More)
 * opens sheets, which take the focus and give it back; a part's card is a sheet, and while its value
 * is typed it becomes a strip held above the keyboard, the part and its numbers kept in view.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripDrawing } from '../../src/schematic/index.ts';
import { encodeShare } from '../../src/share/link.ts';
import { chooseExample, closePanel, drawnText, expectSolved, hintLine, isPhone, openApp, openCard, partOnDrawing, setNetlist, sidewaysScroll, statusLine, t, TYPING } from './helpers.ts';

test.beforeEach(({ page }) => {
  test.skip(!isPhone(page), 'the phone’s layout');
});

/** Every part of the drawing is inside the screen, side to side. */
async function partsInView(page: Page, names: readonly string[]): Promise<boolean> {
  const width = page.viewportSize()!.width;
  for (const name of names) {
    const box = await partOnDrawing(page, name).boundingBox();
    if (!box || box.x < 0 || box.x + box.width > width) return false;
  }
  return true;
}

/**
 * SPICE for Beginners' example 1, drawn as in the video: wider than a phone held upright, it turns
 * clean and fits whole. (p02's example 3, which this test used before, opens turned but no longer
 * whole: its video's drawing is less long and low than the automatic layout's ladder, so turned it is
 * still wider than the phone at a readable size.)
 */
const WIDE = 'Example 1';
const WIDE_PARTS = ['V1', 'R1', 'R2', 'I1'];

test('a wide drawing is turned to fit; “As in the video” shows it unturned, with “more” at its edges', async ({ page }) => {
  await openApp(page);
  await chooseExample(page, WIDE);
  await expectSolved(page);
  await expect(hintLine(page)).toHaveText(t('hintTurned'));
  // An action named for what it does, not a toggle whose name changes as well.
  // The example is drawn as its video draws it (its own *@ lines): the way back to that is "As in the video".
  const turn = page.getByRole('button', { name: t('asInVideo'), exact: true });
  await expect(turn).not.toHaveAttribute('aria-pressed', /.*/);
  expect(await partsInView(page, WIDE_PARTS), 'the whole circuit fits the screen').toBe(true);
  expect(await drawnText(page)).toMatch(/=\s8\sV/);
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);

  // Ctrl+K offers the same, in the same words.
  await page.getByRole('banner').getByRole('button', { name: t('paletteLabel') }).click();
  await expect(page.getByRole('dialog', { name: t('paletteTitle') }).getByRole('option', { name: t('paletteAsInVideo') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: t('paletteTitle') })).toHaveCount(0);

  await turn.click();
  await expect(hintLine(page)).toHaveText(t('hintAsInVideo'));
  await expect(page.getByRole('button', { name: t('turnToFit'), exact: true })).toBeVisible();
  expect(await partsInView(page, WIDE_PARTS), 'as in the video, the drawing is wider than the screen').toBe(false);
  const more = page.getByRole('button', { name: t('moreRight') });
  await expect(more).toBeVisible();
  const before = (await partOnDrawing(page, 'I1').boundingBox())!;
  await more.click();
  await expect.poll(async () => (await partOnDrawing(page, 'I1').boundingBox())!.x).toBeLessThan(before.x - 20);
  await expect(page.getByRole('button', { name: t('moreLeft') })).toBeVisible();
  expect(await sidewaysScroll(page), 'the paper pans; the page does not scroll').toBeLessThanOrEqual(0);

  // Ctrl+K has the same choice.
  await page.getByRole('banner').getByRole('button', { name: t('paletteLabel') }).click();
  const palette = page.getByRole('dialog', { name: t('paletteTitle') });
  await palette.getByRole('option', { name: t('paletteTurnToFit') }).click();
  await expect(hintLine(page)).toHaveText(t('hintTurned'));
});

/** p02's example 3 laid out by PlainSpice (no *@ lines, as in a link made before step C): wide, so it turns, but it is not a video's drawing. */
const AUTOMATIC = stripDrawing(readFileSync(resolve(import.meta.dirname, '../../examples/p02/p02-4-open.cir'), 'utf8'));

test('a drawing that is not a video’s offers “As drawn”, not “As in the video”', async ({ page }) => {
  await page.goto(`./#${await encodeShare(AUTOMATIC, { run: true })}`);
  await expectSolved(page);
  await expect(hintLine(page)).toHaveText(t('hintTurned'));
  await expect(page.getByRole('button', { name: t('asInVideo'), exact: true })).toHaveCount(0);
  await page.getByRole('banner').getByRole('button', { name: t('paletteLabel') }).click();
  const palette = page.getByRole('dialog', { name: t('paletteTitle') });
  await expect(palette.getByRole('option', { name: t('paletteAsDrawn') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
  await page.getByRole('button', { name: t('asDrawn'), exact: true }).click();
  await expect(hintLine(page)).toHaveText(t('hintAsDrawn'));
});

test('the bottom bar: the Parts sheet puts a part in hand; a tap shows where it goes, Place places it', async ({ page }) => {
  await openApp(page);
  const bar = page.getByRole('navigation', { name: t('barLabel') });
  await expect(bar.getByRole('button')).toHaveText([t('toolSelect'), t('barParts'), t('panelNetlist'), t('panelChecks'), t('panelExplain'), t('barMore')]);
  await bar.getByRole('button', { name: t('barParts') }).click();
  const sheet = page.getByRole('dialog', { name: t('partsSheetTitle') });
  await expect(sheet).toContainText(t('partsSheetSub'));
  await sheet.getByRole('button', { name: /^Resistor/ }).click();
  await expect(sheet).toHaveCount(0);
  await expect(hintLine(page)).toHaveText(t('hintPlacePhone', { part: 'a resistor' }));
  // No hover on a phone: the first tap shows where it would go (and the nodes it would join), Place places it.
  const hand = page.getByRole('toolbar', { name: t('handLabel', { part: 'Resistor' }) });
  const place = hand.getByRole('button', { name: t('place') });
  await expect(place).toBeDisabled();
  const paper = (await page.locator('.nb-canvas').boundingBox())!;
  await page.touchscreen.tap(paper.x + paper.width * 0.5, paper.y + paper.height * 0.2);
  await expect(hintLine(page)).toContainText(/tap Place/);
  await expect(place).toBeEnabled();
  await place.click();
  await expect(page.getByRole('dialog', { name: /^R3 / })).toBeVisible();
  await expect(bar).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(bar.getByRole('button', { name: t('toolSelect') })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('plainspice:netlist'))).toMatch(/\nR3 n1 n2 1k\n/);
  // A change made on the drawing: Undo is at hand on the status line (not only under More), and takes it back.
  const undo = page.locator('.status').getByRole('button', { name: t('undo'), exact: true });
  await undo.click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('plainspice:netlist'))).not.toMatch(/\nR3 /);
});

test('a part’s card is a sheet; typing its value makes it a strip, with the part and its numbers in view', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  const card = await openCard(page, 'R1');
  // A sheet along the bottom, over the bar; the drawing stays above it.
  await expect(page.getByRole('navigation', { name: t('barLabel') })).toHaveCount(0);
  const sheetTop = (await card.boundingBox())!.y;
  expect((await partOnDrawing(page, 'R1').boundingBox())!.y + 10).toBeLessThan(sheetTop);

  const field = card.getByRole('textbox');
  await field.click();
  // The strip: the field and Done, the rest of the card folded away while the keyboard is up.
  const done = card.getByRole('button', { name: t('cardDone') });
  await expect(done).toBeVisible();
  await expect(page.locator('.app')).toHaveClass(/\bis-editing\b/);
  const stripTop = (await card.boundingBox())!.y;
  for (const name of ['R1', 'R2']) {
    const box = (await partOnDrawing(page, name).boundingBox())!;
    expect(box.y + box.height, `${name} is above the strip`).toBeLessThan(stripTop);
  }
  await field.press('ControlOrMeta+a');
  await field.pressSequentially('2k', TYPING);
  await expect.poll(() => drawnText(page), { timeout: 30_000 }).toMatch(/=\s3\sV/);
  await done.click();
  await expect(done).toHaveCount(0);
  // Back to the sheet, with the numbers: the new ones, and the old ones crossed out.
  await expect(card.getByRole('list', { name: t('cardResults') })).toBeVisible();
  await expect(card.locator('s').filter({ hasText: /4\sV|2\smA/ }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: t('barLabel') })).toBeVisible();
});

test('the turn is decided on the circuit opened, whatever circuit was open before', async ({ page }) => {
  await openApp(page);
  const opened = async (from: string): Promise<{ hint: string; turnable: boolean }> => {
    await chooseExample(page, from);
    await expectSolved(page);
    await chooseExample(page, t('exampleD1'));
    await expectSolved(page);
    await expect(hintLine(page)).not.toHaveText('');
    return { hint: (await hintLine(page).textContent()) ?? '', turnable: (await page.getByRole('button', { name: t('asDrawn'), exact: true }).count()) > 0 };
  };
  const afterWide = await opened(WIDE);
  const afterSmall = await opened(t('exampleStart'));
  expect(afterSmall).toEqual(afterWide);
});

test('the first screen on a phone: the hint invites, and its button opens R1’s card', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  await expect(hintLine(page)).toHaveText(t('hintInvitePhone', { name: 'R1' }));
  await page.getByRole('button', { name: t('noteButton', { name: 'R1' }), exact: true }).click();
  await expect(page.getByRole('dialog', { name: /^R1 / })).toBeVisible();
});

test('the Parts and More sheets take the focus to their heading and give it back to their button', async ({ page }) => {
  await openApp(page);
  const bar = page.getByRole('navigation', { name: t('barLabel') });
  // The parts a first course starts with come first.
  await bar.getByRole('button', { name: t('barParts') }).click();
  const parts = page.getByRole('dialog', { name: t('partsSheetTitle') });
  await expect(parts.getByRole('heading', { name: t('partsSheetTitle'), exact: true })).toBeFocused();
  await expect(parts.getByRole('button').nth(1)).toContainText('Wire');
  await page.keyboard.press('Escape');
  await expect(parts).toHaveCount(0);
  await expect(bar.getByRole('button', { name: t('barParts') })).toBeFocused();

  const more = bar.getByRole('button', { name: t('barMore') });
  await more.click();
  const sheet = page.getByRole('dialog', { name: t('barMore') });
  await expect(sheet.getByRole('heading', { name: t('barMore'), exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(more).toBeFocused();
  // A dialog opened from More gives the focus back to More when it closes.
  await more.click();
  await sheet.getByRole('button', { name: t('help'), exact: true }).click();
  const help = page.getByRole('dialog', { name: t('helpTitle') });
  await expect(help).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await expect(more).toBeFocused();
});

// ------------------------------------------------------------------ after the final reviews (12 November 2026)

test('the status line speaks of numbers from before the last change only when there are some', async ({ page }) => {
  await openApp(page);
  await chooseExample(page, 'Mistake 1: no ground (node 0)');
  await expect(statusLine(page)).toHaveAttribute('data-tone', 'bad');
  await setNetlist(page, '* RC charging\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran 1n 1m\n.end\n');
  await closePanel(page, 'netlist');
  await expect(statusLine(page)).toContainText(t('statusPaused'));
  await expect(statusLine(page)).not.toContainText(t('statusOldNumbers'));
});

test('a touch screen with a keyboard: Tab from a card’s value goes on to the card’s actions', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  // The keyboard alone: the skip link, the drawing, R1, its card.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  const r1 = partOnDrawing(page, 'R1');
  for (let i = 0; i < 6 && !(await r1.evaluate((b) => b === document.activeElement)); i++) await page.keyboard.press('ArrowRight');
  await expect(r1).toBeFocused();
  await page.keyboard.press('Enter');
  const card = page.getByRole('dialog', { name: /^R1 / });
  await expect(card.getByRole('heading', { level: 2 })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(card.getByRole('textbox')).toBeFocused();
  // Reached with Tab, the value keeps the sheet (no strip: no on-screen keyboard is up), actions and all.
  await expect(page.locator('.app')).not.toHaveClass(/\bis-editing\b/);
  await page.keyboard.press('Tab');
  await expect(card.getByRole('button', { name: /^Explain line 3/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(card.getByRole('button', { name: /Turn R1 a quarter turn/ })).toBeFocused();
});

test('a very short window (a laptop at 400 %): a calm status folds to its dot in the margin, a status to read keeps its words', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 200 });
  await openApp(page);
  await expectSolved(page);
  const status = statusLine(page);
  // Its words are still there for screen readers, but nothing of it covers the drawing.
  await expect(status).toContainText(/Finished in \d+ ms/);
  const main = (await status.locator('.status__main').boundingBox())!;
  expect(main.width).toBeLessThanOrEqual(1);
  const dot = (await status.boundingBox())!;
  const margin = (await page.locator('.margin-line').boundingBox())!;
  expect(dot.x + dot.width).toBeLessThanOrEqual(margin.x + 4);
  const covered = await page.evaluate((b) => [...document.querySelectorAll('.nb-canvas svg text')].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.right > b.x && r.left < b.x + b.width && r.bottom > b.y && r.top < b.y + b.height;
  }).length, dot);
  expect(covered).toBe(0);
  // A status to read (a check found an error) keeps its words.
  await chooseExample(page, 'Mistake 1: no ground (node 0)');
  await expect(status).toHaveAttribute('data-tone', 'bad');
  expect((await status.locator('.status__main').boundingBox())!.width).toBeGreaterThan(20);
});
