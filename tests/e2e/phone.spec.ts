/**
 * 10. Phones (decision 0015): a wide drawing is turned a quarter to fit a phone held upright, and
 * "As drawn" shows it unturned, with "more" at its edges (the turn is decided on the circuit opened,
 * whatever was open before); one bar along the bottom (Select, Parts, Netlist, Checks, Explain, More)
 * opens sheets, which take the focus and give it back; a part's card is a sheet, and while its value
 * is typed it becomes a strip held above the keyboard, the part and its numbers kept in view.
 */
import { expect, test, type Page } from '@playwright/test';
import { chooseExample, drawnText, expectSolved, hintLine, isPhone, openApp, openCard, partOnDrawing, sidewaysScroll, t, TYPING } from './helpers.ts';

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

const P02_4 = ['V1', 'R1', 'R2', 'R3', 'G1'];

test('a wide drawing is turned to fit; “As drawn” shows it unturned, with “more” at its edges', async ({ page }) => {
  await openApp(page);
  await chooseExample(page, 'Example 3: open circuit (V_Th)');
  await expectSolved(page);
  await expect(hintLine(page)).toHaveText(t('hintTurned'));
  // An action named for what it does, not a toggle whose name changes as well.
  const turn = page.getByRole('button', { name: t('asDrawn'), exact: true });
  await expect(turn).not.toHaveAttribute('aria-pressed', /.*/);
  expect(await partsInView(page, P02_4), 'the whole circuit fits the screen').toBe(true);
  expect(await drawnText(page)).toMatch(/=\s24\sV/);
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);

  await turn.click();
  await expect(hintLine(page)).toHaveText(t('hintAsDrawn'));
  await expect(page.getByRole('button', { name: t('turnToFit'), exact: true })).toBeVisible();
  expect(await partsInView(page, P02_4), 'as in the video, the drawing is wider than the screen').toBe(false);
  const more = page.getByRole('button', { name: t('moreRight') });
  await expect(more).toBeVisible();
  const before = (await partOnDrawing(page, 'G1').boundingBox())!;
  await more.click();
  await expect.poll(async () => (await partOnDrawing(page, 'G1').boundingBox())!.x).toBeLessThan(before.x - 20);
  await expect(page.getByRole('button', { name: t('moreLeft') })).toBeVisible();
  expect(await sidewaysScroll(page), 'the paper pans; the page does not scroll').toBeLessThanOrEqual(0);

  // Ctrl+K has the same choice.
  await page.getByRole('banner').getByRole('button', { name: t('paletteLabel') }).click();
  const palette = page.getByRole('dialog', { name: t('paletteTitle') });
  await palette.getByRole('option', { name: t('paletteTurnToFit') }).click();
  await expect(hintLine(page)).toHaveText(t('hintTurned'));
});

test('the bottom bar: the Parts sheet says plainly that placing parts comes in the next update', async ({ page }) => {
  await openApp(page);
  const bar = page.getByRole('navigation', { name: t('barLabel') });
  await expect(bar.getByRole('button')).toHaveText([t('toolSelect'), t('barParts'), t('panelNetlist'), t('panelChecks'), t('panelExplain'), t('barMore')]);
  await bar.getByRole('button', { name: t('barParts') }).click();
  const sheet = page.getByRole('dialog', { name: t('partsSheetTitle') });
  await expect(sheet).toContainText(t('partsSheetSub'));
  await sheet.getByRole('button', { name: /^Resistor/ }).click();
  await expect(sheet).toHaveCount(0);
  await expect(hintLine(page)).toContainText('Placing a resistor comes in the next update of PlainSpice.');
  await expect(hintLine(page)).toContainText(t('hintBackPhone'));
  // Tapping a part does what the hint says: its card opens, and the tool goes back to Select.
  await partOnDrawing(page, 'R2').click();
  await expect(page.getByRole('dialog', { name: /^R2 / })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar.getByRole('button', { name: t('toolSelect') })).toHaveAttribute('aria-pressed', 'true');
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
  const afterWide = await opened('Example 3: open circuit (V_Th)');
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
