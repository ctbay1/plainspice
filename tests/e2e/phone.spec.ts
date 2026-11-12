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
import { minUnitFor } from '../../src/notebook/fit.ts';
import { chooseExample, closePanel, drawing, drawnText, expectSolved, gridPoint, hintLine, isPhone, openApp, openCard, partOnDrawing, setNetlist, settle, sidewaysScroll, statusLine, t, TYPING } from './helpers.ts';

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

type Pt = { x: number; y: number };

/** Real fingers (CDP touch): from `from` to `to` in small steps, one finger or two. */
async function fingers(page: Page, from: readonly Pt[], to: readonly Pt[]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: readonly Pt[]): Promise<unknown> =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })) });
  await touch('touchStart', from);
  for (let i = 1; i <= 12; i++) await touch('touchMove', from.map((a, k) => ({ x: a.x + ((to[k]!.x - a.x) * i) / 12, y: a.y + ((to[k]!.y - a.y) * i) / 12 })));
  await touch('touchEnd', []);
  await cdp.detach();
}

/** The middle of a drawing item's button on the screen ("R3, resistor", "Node n1", "Ground, node 0"), once the drawing has slid to where it goes. */
async function middleOf(page: Page, name: RegExp): Promise<Pt> {
  await settle(page);
  const box = (await drawing(page).getByRole('button', { name }).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Screen pixels per grid unit now. */
async function unitNow(page: Page): Promise<number> {
  return (await gridPoint(page, 1, 0)).x - (await gridPoint(page, 0, 0)).x;
}

/** Where everything drawn is on the screen (the picture's strokes and words), once the drawing has slid to where it goes. */
async function inkOnScreen(page: Page): Promise<{ x0: number; y0: number; x1: number; y1: number }> {
  await settle(page);
  return page.evaluate(() => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const e of document.querySelectorAll('.nb-canvas svg[role="img"] :is(path, line, circle, polyline, text)')) {
      const r = e.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      x0 = Math.min(x0, r.left);
      y0 = Math.min(y0, r.top);
      x1 = Math.max(x1, r.right);
      y1 = Math.max(y1, r.bottom);
    }
    return { x0, y0, x1, y1 };
  });
}

/** The free paper between the top bar and the stack along the bottom. */
async function freePaper(page: Page): Promise<{ top: number; bottom: number; width: number }> {
  return page.evaluate(() => ({ top: document.querySelector('.top-area')!.getBoundingClientRect().bottom, bottom: document.querySelector('.phone-bottom')!.getBoundingClientRect().top, width: innerWidth }));
}

test('the turned drawing: a finger that starts on a part, a node’s name or the ground pans it, two fingers zoom, a tap opens the card, and “more” marks a cut edge', async ({ page }) => {
  await openApp(page);
  await chooseExample(page, 'Example 3: open circuit (V_Th)');
  await expectSolved(page);
  await expect(hintLine(page)).toHaveText(t('hintTurnedPan'));
  // R1 and R2 are cut off at the right: the edge says there is more, as the drawing as drawn does.
  await expect(page.getByRole('button', { name: t('moreRight') })).toBeVisible();
  for (const name of [/^R3, /, /^Node n1$/, /^Ground, /]) {
    const start = await middleOf(page, name);
    const before = await gridPoint(page, 0, 0);
    await fingers(page, [start], [{ x: start.x - 120, y: start.y }]);
    await expect.poll(async () => (await gridPoint(page, 0, 0)).x, `a swipe from ${String(name)} pans the paper`).toBeLessThan(before.x - 80);
    await expect(page.getByRole('dialog', { name: /^R3 / })).toHaveCount(0);
    // Back again, from empty paper.
    const paper = (await page.locator('.nb-canvas').boundingBox())!;
    await fingers(page, [{ x: paper.x + 30, y: paper.y + 130 }], [{ x: paper.x + 150, y: paper.y + 130 }]);
  }
  // Two fingers, the first on R3, spread apart: it zooms in.
  const unit = await unitNow(page);
  const r3 = await middleOf(page, /^R3, /);
  await fingers(page, [r3, { x: r3.x, y: r3.y + 60 }], [{ x: r3.x, y: r3.y - 40 }, { x: r3.x, y: r3.y + 160 }]);
  await expect.poll(() => unitNow(page)).toBeGreaterThan(unit * 1.5);
  // A finger that holds still on R3 is a tap: R3's card opens.
  const still = await middleOf(page, /^R3, /);
  await page.touchscreen.tap(still.x, still.y);
  await expect(page.getByRole('dialog', { name: /^R3 / })).toBeVisible();
});

test('a sheet opened while something is selected leaves the drawing where it was once it closes', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  const bar = page.getByRole('navigation', { name: t('barLabel') });
  // A ground placed on the paper: it stays selected, the view is held still.
  await bar.getByRole('button', { name: t('barParts') }).click();
  await page.getByRole('dialog', { name: t('partsSheetTitle') }).getByRole('button', { name: /^Ground/ }).click();
  const paper = (await page.locator('.nb-canvas').boundingBox())!;
  await page.touchscreen.tap(paper.x + 60, paper.y + paper.height * 0.6);
  const hand = page.getByRole('toolbar', { name: t('handLabel', { part: t('toolGround') }) });
  await hand.getByRole('button', { name: t('place') }).click();
  await expect(drawing(page).getByRole('button', { name: /^Ground, / })).toHaveAttribute('aria-current', 'true');
  const transform = (): Promise<string> => page.locator('.nb-world').evaluate((w: HTMLElement) => w.style.transform);
  const before = await transform();
  // Parts again: the drawing moves up to keep the ground clear of the sheet...
  await bar.getByRole('button', { name: t('barParts') }).click();
  const sheet = page.getByRole('dialog', { name: t('partsSheetTitle') });
  await expect(sheet).toBeVisible();
  await expect.poll(transform).not.toBe(before);
  // ...and comes back when it closes, with ×,
  await sheet.getByRole('button', { name: t('partsClose') }).click();
  await expect.poll(transform).toBe(before);
  // or when a tool is chosen in it: nothing is left under the top bar.
  await bar.getByRole('button', { name: t('barParts') }).click();
  await expect.poll(transform).not.toBe(before);
  await sheet.getByRole('button', { name: /^Wire/ }).click();
  await expect(hintLine(page)).toHaveText(t('hintWirePhone'));
  await expect.poll(transform).toBe(before);
  const free = await freePaper(page);
  expect((await inkOnScreen(page)).y0, 'the drawing starts below the top bar').toBeGreaterThanOrEqual(free.top - 1);
});

test('the paper cannot be dragged off the screen, and “Show the whole drawing” brings all of it back', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  const paper = (await page.locator('.nb-canvas').boundingBox())!;
  const empty = { x: paper.x + 30, y: paper.y + paper.height - 260 };
  // Three long swipes up: the drawing stops at the top of the free paper, all of it still there.
  for (let i = 0; i < 3; i++) await fingers(page, [empty], [{ x: empty.x, y: empty.y - 250 }]);
  const free = await freePaper(page);
  let ink = await inkOnScreen(page);
  expect(ink.y0).toBeGreaterThanOrEqual(free.top - 6);
  expect(ink.y1).toBeLessThanOrEqual(free.bottom);
  // Fit's own name, as in More, Ctrl+K and Help.
  const whole = statusLine(page).getByRole('button', { name: t('zoomFit'), exact: true });
  await expect(whole).toHaveCount(0);
  // Far to the left: part of it goes off the screen (never all of it), and the way back is on the status line.
  for (let i = 0; i < 2; i++) await fingers(page, [{ x: paper.x + paper.width - 30, y: empty.y }], [{ x: paper.x + 30, y: empty.y }]);
  ink = await inkOnScreen(page);
  expect(ink.x0).toBeLessThan(0);
  expect(ink.x1).toBeGreaterThan(48);
  await expect(whole).toBeVisible();
  await whole.click();
  await expect(whole).toHaveCount(0);
  await expect.poll(async () => (await inkOnScreen(page)).x0).toBeGreaterThanOrEqual(0);
  ink = await inkOnScreen(page);
  expect(ink.x1).toBeLessThanOrEqual(free.width);
});

test('a phone 360 px wide: a turned drawing shown whole says so, not “drag the paper”', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openApp(page);
  for (const name of ['Mistake 2: a typo in a node name', 'Example 2: only a dependent source, 1 A test current']) {
    await chooseExample(page, name);
    await expect(statusLine(page)).toHaveAttribute('data-tone', /^(ok|bad)$/);
    await expect(hintLine(page), name).toHaveText(t('hintTurned'));
    const free = await freePaper(page);
    const ink = await inkOnScreen(page);
    expect(ink.x0, name).toBeGreaterThanOrEqual(0);
    expect(ink.x1, name).toBeLessThanOrEqual(free.width);
    expect(ink.y0, name).toBeGreaterThanOrEqual(free.top);
    expect(ink.y1, name).toBeLessThanOrEqual(free.bottom);
  }
});

test('the status line speaks of numbers from before the last change only when there are some', async ({ page }) => {
  await openApp(page);
  await chooseExample(page, 'Mistake 1: no ground (node 0)');
  await expect(statusLine(page)).toHaveAttribute('data-tone', 'bad');
  await setNetlist(page, '* RC charging\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran 1n 1m\n.end\n');
  await closePanel(page, 'netlist');
  await expect(statusLine(page)).toContainText(t('statusPaused'));
  await expect(statusLine(page)).not.toContainText(t('statusOldNumbers'));
});

test('a netlist replaced by a circuit with other names: no old numbers on the paper, so none spoken of; with the same names, they are', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  const results = page.locator('.nb-results text');
  await expect(results.first()).toBeVisible();
  // Every part and node has another name: the drawing writes none of Start here's numbers.
  await setNetlist(page, '* RC charging\nVa a 0 1\nRx a b 1k\nCy b 0 1u\n.tran 1n 1m\n.end\n');
  await closePanel(page, 'netlist');
  await expect(statusLine(page)).toContainText(t('statusPaused'));
  await expect(results).toHaveCount(0);
  await expect(statusLine(page)).not.toContainText(t('statusOldNumbers'));
  // V1, R1, in and out keep their names: Start here's numbers for them, in pencil, and the status says they are old.
  await setNetlist(page, '* RC charging\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran 1n 1m\n.end\n');
  await closePanel(page, 'netlist');
  await expect(results.first()).toBeVisible();
  await expect(page.locator('.nb-canvas')).toHaveClass(/\bis-pending\b/);
  await expect(statusLine(page)).toContainText(t('statusPaused'));
  await expect(statusLine(page)).toContainText(t('statusOldNumbers'));
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

test('a drawing shown as drawn opens at the smallest readable size, and Fit shows all of it', async ({ page }) => {
  await openApp(page);
  await chooseExample(page, 'Example 3: open circuit (V_Th)');
  await expectSolved(page);
  await page.getByRole('button', { name: t('asInVideo'), exact: true }).click();
  await expect(hintLine(page)).toHaveText(t('hintAsInVideo'));
  // As much of it as can be read at once (it opened at 30 px a unit, twice that, with only V1 and R1 in view).
  await expect.poll(() => unitNow(page)).toBeCloseTo(minUnitFor(), 3);
  // More, then "Show the whole drawing": the sheet goes at once (in the strip of paper above it, the
  // whole drawing would be a stamp), the focus back on More, and all of it shows, smaller than
  // readable if it must be.
  const bar = page.getByRole('navigation', { name: t('barLabel') });
  await bar.getByRole('button', { name: t('barMore') }).click();
  const more = page.getByRole('dialog', { name: t('barMore') });
  await more.getByRole('button', { name: t('zoomFit'), exact: true }).click();
  await expect(more).toHaveCount(0);
  await expect(bar.getByRole('button', { name: t('barMore') })).toBeFocused();
  await expect.poll(() => unitNow(page)).toBeLessThan(minUnitFor());
  const free = await freePaper(page);
  await expect.poll(async () => (await inkOnScreen(page)).x1).toBeLessThanOrEqual(free.width);
  const ink = await inkOnScreen(page);
  expect(ink.x0).toBeGreaterThanOrEqual(0);
  expect(ink.y0).toBeGreaterThanOrEqual(free.top);
  expect(ink.y1).toBeLessThanOrEqual(free.bottom);
  expect(await partsInView(page, ['V1', 'R1', 'R2', 'R3', 'G1'])).toBe(true);
  await expect(hintLine(page)).toHaveText(t('hintPhone'));
});

test('after “Show the whole drawing”, “Turn to fit” and “As in the video” give their own view at its own size, not the whole one', async ({ page }) => {
  await openApp(page);
  await chooseExample(page, 'Example 3: open circuit (V_Th)');
  await expectSolved(page);
  await page.getByRole('button', { name: t('asInVideo'), exact: true }).click();
  await expect.poll(() => unitNow(page)).toBeCloseTo(minUnitFor(), 3);
  // Moved by the reader (from the middle of the paper, clear of the "more" at its edges), then shown
  // whole from the status line: smaller than readable.
  const paper = (await page.locator('.nb-canvas').boundingBox())!;
  const from = { x: paper.x + paper.width * 0.55, y: paper.y + paper.height * 0.45 };
  await fingers(page, [from], [{ x: from.x - 160, y: from.y }]);
  await statusLine(page).getByRole('button', { name: t('zoomFit'), exact: true }).click();
  await expect.poll(() => unitNow(page)).toBeLessThan(minUnitFor() - 0.5);
  // Turn to fit: the turned drawing at its own fit, the smallest readable size, as when it opened.
  await page.getByRole('button', { name: t('turnToFit'), exact: true }).click();
  await expect(hintLine(page)).toHaveText(t('hintTurnedPan'));
  await expect.poll(() => unitNow(page)).toBeCloseTo(minUnitFor(), 3);
  // And back as in the video: its own size again, not whole.
  await page.getByRole('button', { name: t('asInVideo'), exact: true }).click();
  await expect(hintLine(page)).toHaveText(t('hintAsInVideo'));
  await expect.poll(() => unitNow(page)).toBeCloseTo(minUnitFor(), 3);
});

test('“Show the whole drawing” and the turn share one row of the status line; the calm status stays for screen readers', async ({ page }) => {
  for (const size of [undefined, { width: 360, height: 780 }]) {
    if (size) await page.setViewportSize(size);
    await openApp(page);
    await chooseExample(page, 'Example 3: open circuit (V_Th)');
    await expectSolved(page);
    const status = statusLine(page);
    const opened = (await status.boundingBox())!;
    // Dragged to the left (from the middle of the paper, clear of the "more" at its edges): the way
    // back joins the turn on the status line, on the same row.
    const paper = (await page.locator('.nb-canvas').boundingBox())!;
    const from = { x: paper.x + paper.width * 0.55, y: paper.y + paper.height * 0.45 };
    await fingers(page, [from], [{ x: from.x - 160, y: from.y }]);
    const whole = status.getByRole('button', { name: t('zoomFit'), exact: true });
    const turn = status.getByRole('button', { name: t('asInVideo'), exact: true });
    await expect(whole).toBeVisible();
    await expect(turn).toBeVisible();
    const [a, b, pill] = [(await whole.boundingBox())!, (await turn.boundingBox())!, (await status.boundingBox())!];
    expect(Math.abs(a.y - b.y), `one row at ${page.viewportSize()!.width} px`).toBeLessThan(2);
    expect(pill.height).toBeLessThanOrEqual(opened.height + 1);
    expect(pill.x).toBeGreaterThanOrEqual(0);
    expect(pill.x + pill.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await expect(status).toContainText(/Finished in \d+ ms/);
    // Once the drawing is whole again, the status shows its words.
    await whole.click();
    await expect(whole).toHaveCount(0);
    expect((await status.locator('.status__main').boundingBox())!.width).toBeGreaterThan(20);
  }
});

test('a turned drawing that fits, moved partly off the screen: the hint still says it fits, and only a fit that cuts some of it off says to drag', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openApp(page);
  // From the middle of the paper, clear of the "more" at its edges.
  const paper = (await page.locator('.nb-canvas').boundingBox())!;
  const from = { x: paper.x + paper.width * 0.55, y: paper.y + paper.height * 0.45 };
  const swipe = (): Promise<void> => fingers(page, [from], [{ x: from.x - 160, y: from.y }]);
  await chooseExample(page, 'Mistake 2: a typo in a node name');
  await expect(statusLine(page)).toHaveAttribute('data-tone', /^(ok|bad)$/);
  await expect(hintLine(page)).toHaveText(t('hintTurned'));
  await swipe();
  await expect(statusLine(page).getByRole('button', { name: t('zoomFit'), exact: true })).toBeVisible();
  await expect(hintLine(page)).toHaveText(t('hintTurned'));
  // Turned as well as it can be (some of it is cut off at any readable size): it says so, moved or not.
  await chooseExample(page, 'Example 3: open circuit (V_Th)');
  await expectSolved(page);
  await expect(hintLine(page)).toHaveText(t('hintTurnedPan'));
  await swipe();
  await expect(statusLine(page).getByRole('button', { name: t('zoomFit'), exact: true })).toBeVisible();
  await expect(hintLine(page)).toHaveText(t('hintTurnedPan'));
});

test('“Show the whole drawing” belongs to the view it was asked in: Select turns the drawing back at that view’s own fit', async ({ page }) => {
  await openApp(page);
  await chooseExample(page, 'Example 3: open circuit (V_Th)');
  await expectSolved(page);
  await expect.poll(() => unitNow(page)).toBeCloseTo(minUnitFor(), 3);
  const bar = page.getByRole('navigation', { name: t('barLabel') });
  const wire = async (): Promise<void> => {
    await bar.getByRole('button', { name: t('barParts') }).click();
    await page.getByRole('dialog', { name: t('partsSheetTitle') }).getByRole('button', { name: /^Wire/ }).click();
    await expect(page.getByRole('dialog', { name: t('partsSheetTitle') })).toHaveCount(0);
    // Shown as drawn, it slides to its new place: a finger is put on the paper once it is there.
    await settle(page);
  };
  const whole = statusLine(page).getByRole('button', { name: t('zoomFit'), exact: true });
  // Wire: the drawing as drawn, whole, while editing. Moved by the reader (from the empty paper above
  // it: a press on a wire would start one), then shown whole from the status line.
  await wire();
  const free = await freePaper(page);
  const above = { x: free.width * 0.6, y: free.top + 60 };
  await fingers(page, [above], [{ x: above.x - 160, y: above.y }]);
  await whole.click();
  await expect(whole).toHaveCount(0);
  // Select turns it back to fit at the turned view's own size, the smallest readable one, as when it
  // opened: the whole drawing asked for as drawn is not the turned view's.
  await bar.getByRole('button', { name: t('toolSelect') }).click();
  await expect(hintLine(page)).toHaveText(t('hintTurnedPan'));
  await expect.poll(() => unitNow(page)).toBeCloseTo(minUnitFor(), 3);
  // Shown whole in the turned view itself: after a tool, Select gives it back as it was, whole.
  const paper = (await page.locator('.nb-canvas').boundingBox())!;
  const from = { x: paper.x + paper.width * 0.55, y: paper.y + paper.height * 0.45 };
  await fingers(page, [from], [{ x: from.x - 160, y: from.y }]);
  await whole.click();
  await expect(hintLine(page)).toHaveText(t('hintTurned'));
  await expect.poll(() => unitNow(page)).toBeLessThan(minUnitFor() - 0.5);
  const turnedWhole = await unitNow(page);
  await wire();
  await bar.getByRole('button', { name: t('toolSelect') }).click();
  await expect(hintLine(page)).toHaveText(t('hintTurned'));
  await expect.poll(() => unitNow(page)).toBeCloseTo(turnedWhole, 3);
});

test('a run started by an edit leaves the status line, its buttons, the hint and the “more” at the edge where they were', async ({ page }) => {
  type Frame = { running: boolean; status: string; hint: string; edges: string };
  for (const size of [undefined, { width: 360, height: 780 }]) {
    if (size) await page.setViewportSize(size);
    await openApp(page);
    await expectSolved(page);
    // Moved partly off to the left, from empty paper: "Show the whole drawing" joins the status line.
    const paper = (await page.locator('.nb-canvas').boundingBox())!;
    const from = { x: paper.x + paper.width * 0.55, y: paper.y + paper.height * 0.3 };
    await fingers(page, [from], [{ x: from.x - 160, y: from.y }]);
    const status = statusLine(page);
    await expect(status.getByRole('button', { name: t('zoomFit'), exact: true })).toBeVisible();
    // R2 turned with the keys, twice: Undo joins them, and the hint is R2's again once the first
    // edit's note has gone.
    await partOnDrawing(page, 'R2').focus();
    await page.keyboard.press('t');
    await expect(status.getByRole('button', { name: t('undo'), exact: true })).toBeVisible();
    await page.keyboard.press('t');
    await expect(hintLine(page)).toHaveText(t('hintSelectedPhone', { name: 'R2' }), { timeout: 15_000 });
    await expectSolved(page);
    await settle(page);
    // Turned once more on a phone four times slower: every frame from "Running…" to "Finished".
    await page.evaluate(() => {
      const box = (e: Element | null): string => {
        const r = e?.getBoundingClientRect();
        return r ? [r.left, r.top, r.right, r.bottom].map(Math.round).join(',') : '';
      };
      const w = window as unknown as { __frames: Frame[]; __stop?: boolean };
      w.__frames = [];
      w.__stop = false;
      const tick = (): void => {
        const s = document.querySelector('.status');
        w.__frames.push({
          running: /Running/.test(s?.textContent ?? ''),
          // The pill and each of its buttons.
          status: [box(s), ...[...(s?.querySelectorAll('button') ?? [])].map((b) => `${b.textContent}@${box(b)}`)].join(' '),
          hint: box(document.querySelector('#hint-line')),
          edges: [...document.querySelectorAll('.more-edge')].map(box).join(' '),
        });
        if (!w.__stop) requestAnimationFrame(tick);
      };
      tick();
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.keyboard.press('t');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames.some((f) => f.running))).toBe(true);
    await expectSolved(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await cdp.detach();
    await settle(page);
    const frames = await page.evaluate(() => {
      const w = window as unknown as { __frames: Frame[]; __stop?: boolean };
      w.__stop = true;
      return w.__frames;
    });
    const end = frames.at(-1)!;
    const running = frames.filter((f) => f.running);
    expect(running.length).toBeGreaterThan(0);
    for (const f of running) {
      expect(f.status, `the status line and its buttons while “Running…” shows, at ${page.viewportSize()!.width} px`).toBe(end.status);
      expect(f.hint, 'the hint while “Running…” shows').toBe(end.hint);
    }
    // The "more" at the edge goes where the free paper lets it: the same place once the run is over.
    expect(running.at(-1)!.edges, 'the “more” at the edge').toBe(end.edges);
  }
});

test('the status line speaks of numbers in pencil only while the drawing shows some', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  const status = statusLine(page);
  const canvas = page.locator('.nb-canvas');
  // The ground deleted on the drawing: no answers (no node 0), so the last ones stay, in pencil, and the status line says so.
  await drawing(page).getByRole('button', { name: /^Ground, / }).focus();
  await page.keyboard.press('Delete');
  await expect(status).toHaveAttribute('data-tone', 'bad');
  await expect(status).toContainText(t('statusOldPencil'));
  await expect(canvas).toHaveClass(/\bis-pending\b/);
  // Every part deleted: no numbers are left on the paper, so none are spoken of, in words or in pencil.
  for (const name of ['R2', 'R1', 'V1']) {
    await partOnDrawing(page, name).focus();
    await page.keyboard.press('Delete');
    await expect(partOnDrawing(page, name)).toHaveCount(0);
  }
  await expect(status).toContainText(t('noAnalysisTitle'));
  await expect(page.locator('.nb-results text')).toHaveCount(0);
  await expect(status).not.toContainText(t('statusOldPencil'));
  await expect(canvas).not.toHaveClass(/\bis-pending\b/);
});
