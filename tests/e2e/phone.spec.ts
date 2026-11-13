/**
 * 10. Phones (decision 0015): a wide drawing is turned a quarter to fit a phone held upright, and
 * "As in the video" (a video's own drawing) or "As drawn" (any other) shows it unturned, with "more"
 * at its edges (the turn is decided on the circuit opened,
 * whatever was open before); one bar along the bottom (Select, Parts, Netlist, Checks, Explain, More)
 * opens sheets, which take the focus and give it back; a part's card is a sheet, and while its value
 * is typed it becomes a strip held above the keyboard, the part and its numbers kept in view.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripDrawing } from '../../src/schematic/index.ts';
import { encodeShare } from '../../src/share/link.ts';
import { minUnitFor } from '../../src/notebook/fit.ts';
import { chooseExample, closePanel, drawing, drawnText, expectSolved, gridPoint, hintLine, isPhone, newCircuit, openApp, openCard, openPanel, partOnDrawing, setNetlist, settle, sidewaysScroll, statusLine, t, TYPING } from './helpers.ts';

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

test('“Show the whole drawing” pressed on the status line with the keys gives the focus to the drawing, not to the page', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  const paper = (await page.locator('.nb-canvas').boundingBox())!;
  const from = { x: paper.x + paper.width * 0.55, y: paper.y + paper.height * 0.3 };
  await fingers(page, [from], [{ x: from.x - 160, y: from.y }]);
  const whole = statusLine(page).getByRole('button', { name: t('zoomFit'), exact: true });
  await expect(whole).toBeVisible();
  await whole.focus();
  await page.keyboard.press('Enter');
  await expect(whole).toHaveCount(0);
  // The drawing's one Tab stop has it (on b060bc8 it fell to the page: the next Tab went to Select).
  await expect(page.locator('.nb-hit[tabindex="0"]')).toBeFocused();
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

// ------------------------------------------------------------------ a small phone with the largest text (12 November 2026)

/**
 * A control a finger can use: on the screen, below the top bar, and nothing over its middle (a tap
 * there reaches it). Brought into view first inside whatever scrolls around it (a sheet, the lines).
 */
async function expectUsable(target: Locator, what: string): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const seen = await target.evaluate((el) => {
    const top = document.querySelector('.top-area header')!.getBoundingClientRect().bottom;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const over = hit && !el.contains(hit) ? `${hit.tagName.toLowerCase()}.${String((hit as HTMLElement).className).split(' ')[0]}` : '';
    return { inside: r.top >= top - 1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1, over, where: `${Math.round(r.top)} to ${Math.round(r.bottom)}, the top bar ending at ${Math.round(top)}, the screen at ${innerHeight}` };
  });
  expect(seen.inside, `${what} is on the screen, below the top bar (${seen.where})`).toBe(true);
  expect(seen.over, `${what}: nothing over its middle`).toBe('');
}

/**
 * How much of some words shows: nothing around them may put them out of sight (clipped to nothing for
 * screen readers only, not shown: `why` says so), and the part of them that shows, inside whatever
 * scrolls around them, on the screen below the top bar (`shown`, in pixels), not under the hand bar.
 */
async function sight(target: Locator): Promise<{ shown: number; why: string }> {
  return target.evaluate((el) => {
    for (let p: Element | null = el; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.clipPath === 'inset(50%)' || s.display === 'none' || s.visibility === 'hidden') return { shown: 0, why: `out of sight (${String((p as HTMLElement).className).split(' ')[0]})` };
    }
    const r = el.getBoundingClientRect();
    let top = Math.max(r.top, document.querySelector('.top-area header')!.getBoundingClientRect().bottom);
    let bottom = Math.min(r.bottom, innerHeight);
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowY)) {
        const c = p.getBoundingClientRect();
        top = Math.max(top, c.top);
        bottom = Math.min(bottom, c.bottom);
      }
    }
    const hand = document.querySelector('.hand-bar')?.getBoundingClientRect();
    return { shown: Math.round(bottom - top), why: hand && hand.height > 0 && hand.bottom > top && hand.top < bottom ? 'under the hand bar' : '' };
  });
}

/** Words in sight: at least a line of them shows (sight). */
async function expectInSight(target: Locator, what: string): Promise<void> {
  const seen = await sight(target);
  expect(seen.why, `${what} is in sight`).toBe('');
  expect(seen.shown, `${what}: at least a line of it shows`).toBeGreaterThanOrEqual(10);
}

/** The free paper: below the top bar, above the stack along the bottom and the hand bar. */
async function paperLeft(page: Page): Promise<{ top: number; bottom: number }> {
  return page.evaluate(() => ({
    top: document.querySelector('.top-area header')!.getBoundingClientRect().bottom,
    bottom: Math.min(...[...document.querySelectorAll('.phone-bottom, .hand-bar')].map((e) => e.getBoundingClientRect().top)),
  }));
}

test('a small phone with the largest text keeps the hand bar, the sheets, the strip and the status line usable, and some paper (320 × 568, upright and on its side)', async ({ page }) => {
  // The Settings' largest text (150 %): the critic found the hand bar under the top bar on an iPhone SE,
  // Place out of reach, as soon as a resistor was in hand.
  await page.addInitScript(() => localStorage.setItem('plainspice:settings', JSON.stringify({ textSize: 'x-large', contrast: 'device', motion: 'device' })));
  for (const size of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
    const at = `${size.width} × ${size.height}`;
    // Upright, the hint line stays on the screen (a phone on its side, short for its text, keeps it
    // for screen readers only, as every phone on its side does): what to do next is what a beginner
    // reads first. The first screen's button with it.
    const upright = size.height > size.width;
    await page.setViewportSize(size);
    await openApp(page);
    if (upright) {
      await expectSolved(page);
      await settle(page);
      await expectInSight(hintLine(page), `${at}: the first screen's hint line`);
      await expectUsable(page.getByRole('button', { name: t('noteButton', { name: 'R1' }), exact: true }), `${at}: the first screen's button`);
    }
    await newCircuit(page);
    if (upright) await expectInSight(hintLine(page), `${at}: the blank page's hint line`);
    const bar = page.getByRole('navigation', { name: t('barLabel') });
    await expectUsable(bar.getByRole('button', { name: t('barParts') }), `${at}: Parts`);
    await bar.getByRole('button', { name: t('barParts') }).tap();
    const sheet = page.getByRole('dialog', { name: t('partsSheetTitle') });
    await settle(page);
    // On its side the lines step aside for the sheet as it opens, before it is drawn, and the sheet takes
    // the room they leave (it is held where it is only from then on): the paper above it is the least the
    // stack leaves, 48 px (held at once, it kept 55 px, and its tall last rows could not clear the bar).
    if (!upright) {
      const above = await paperLeft(page);
      expect(above.bottom - above.top, `${at}: the paper above the Parts sheet`).toBeLessThanOrEqual(49);
    }
    await expectUsable(sheet.getByRole('button', { name: t('partsClose') }), `${at}: the Parts sheet's ×`);
    const resistor = sheet.getByRole('button', { name: /^Resistor/ });
    await expectUsable(resistor, `${at}: Resistor in the Parts sheet`);
    await resistor.tap();
    await expect(sheet).toHaveCount(0);
    // The hand bar, before and after a tap on the paper left free shows where the resistor goes (the
    // hint then says more, and the lines under the hand bar grow).
    const hand = page.getByRole('toolbar', { name: t('handLabel', { part: 'Resistor' }) });
    await expect(hand).toBeVisible();
    const place = hand.getByRole('button', { name: t('place') });
    const handButtons = [[place, 'Place'], [hand.getByRole('button', { name: t('handTurn') }), 'Turn'], [hand.getByRole('button', { name: t('handMirror') }), 'Mirror'], [hand.getByRole('button', { name: t('cancel') }), 'Cancel']] as const;
    await settle(page);
    for (const [button, name] of handButtons) await expectUsable(button, `${at}: the hand bar's ${name}`);
    // What to do with the resistor in hand (Place waits for a tap on the paper): its first line at least.
    if (upright) {
      await expect(hintLine(page)).toHaveText(t('hintPlacePhone', { part: 'a resistor' }));
      await expectInSight(hintLine(page), `${at}: the hint line, a resistor in hand`);
    }
    let free = await paperLeft(page);
    expect(free.bottom - free.top, `${at}: some paper shows above the hand bar`).toBeGreaterThanOrEqual(48);
    await page.touchscreen.tap(size.width / 2, free.top + (free.bottom - free.top) * 0.4);
    await expect(place).toBeEnabled();
    await settle(page);
    for (const [button, name] of handButtons) await expectUsable(button, `${at}: the hand bar's ${name}, a place chosen`);
    if (upright) {
      await expect(hintLine(page)).toContainText(/tap Place/);
      await expectInSight(hintLine(page), `${at}: the hint line, a place chosen`);
    }
    await place.tap();
    // The card's sheet, its value tapped: the strip, and Done.
    const card = page.getByRole('dialog', { name: /^R1 / });
    await expect(card).toBeVisible();
    await settle(page);
    await expectUsable(card.getByRole('button', { name: t('cardClose', { name: 'R1' }) }), `${at}: the card's ×`);
    const field = card.getByRole('textbox');
    await expectUsable(field, `${at}: the card's value`);
    await field.tap();
    await expect(page.locator('.app')).toHaveClass(/\bis-editing\b/);
    const done = card.getByRole('button', { name: t('cardDone') });
    await settle(page);
    await expectUsable(field, `${at}: the strip's value`);
    await expectUsable(done, `${at}: the strip's Done`);
    await done.tap();
    await expect(done).toHaveCount(0);
    await card.getByRole('button', { name: t('cardClose', { name: 'R1' }) }).tap();
    await expect(card).toHaveCount(0);
    // The status line's Undo (a change made on the drawing), the part on the paper, and the paper itself;
    // upright, the hint line too (its note on what PlainSpice wrote for the student).
    await settle(page);
    if (upright) await expectInSight(hintLine(page), `${at}: the hint line, the part placed`);
    await expectUsable(statusLine(page).getByRole('button', { name: t('undo'), exact: true }), `${at}: the status line's Undo`);
    await expectUsable(partOnDrawing(page, 'R1'), `${at}: R1 on the drawing`);
    free = await paperLeft(page);
    expect(free.bottom - free.top, `${at}: some paper shows`).toBeGreaterThanOrEqual(48);
    await partOnDrawing(page, 'R1').tap();
    await expect(card).toBeVisible();
  }
});

/**
 * One round of Tab stops on the page: none of them may be out of sight (clipped to nothing for screen
 * readers only, or not shown), nor hidden behind something else on the page, such as a sheet over the
 * drawing's part that has the drawing's Tab stop (WCAG 2.4.11): some of what shows of it, inside the
 * window and whatever scrolls around it, is not under anything else.
 */
async function expectNoTabStopOutOfSight(page: Page, what: string): Promise<number> {
  /** The Tab stop now: itself (a list may have several of one name, scrolled to one place), its name and place, and why it cannot be seen. */
  const look = (): Promise<{ key: string; name: string; why: string }> =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { key: 'the page', name: 'the page', why: '' };
      let why = '';
      for (let p: Element | null = el; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.clipPath === 'inset(50%)') why = 'clipped to nothing';
        else if (s.display === 'none' || s.visibility === 'hidden') why = 'not shown';
      }
      const r = el.getBoundingClientRect();
      if (!why && (r.width < 1 || r.height < 1)) why = 'no size';
      if (!why) {
        // What shows of it: inside the window and every box around it that cuts what it holds.
        let [x0, y0, x1, y1] = [Math.max(r.left, 0), Math.max(r.top, 0), Math.min(r.right, innerWidth), Math.min(r.bottom, innerHeight)];
        for (let p = el.parentElement; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
          const c = p.getBoundingClientRect();
          [x0, y0, x1, y1] = [Math.max(x0, c.left), Math.max(y0, c.top), Math.min(x1, c.right), Math.min(y1, c.bottom)];
        }
        if (x1 - x0 < 1 || y1 - y0 < 1) why = 'out of view';
        else {
          const points = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]].map(([fx, fy]) => [x0 + (x1 - x0) * fx!, y0 + (y1 - y0) * fy!] as const);
          const shows = points.some(([x, y]) => {
            const hit = document.elementFromPoint(x, y);
            return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
          });
          if (!shows) {
            const over = document.elementFromPoint(points[0]![0], points[0]![1]);
            why = `under ${over ? `${over.tagName.toLowerCase()}.${(over.getAttribute('class') ?? '').split(' ')[0]}` : 'nothing'}`;
          }
        }
      }
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
      // Each element by itself (a list may have several of one name, scrolled to one place).
      const w = window as unknown as { tabStops?: WeakMap<Element, number>; tabStopCount?: number };
      w.tabStops ??= new WeakMap();
      if (!w.tabStops.has(el)) w.tabStops.set(el, (w.tabStopCount = (w.tabStopCount ?? 0) + 1));
      return { key: `${w.tabStops.get(el)}`, name: `${name} at ${Math.round(r.left)}, ${Math.round(r.top)}`, why };
    });
  const seen = new Set<string>();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const stop = await look();
    if (seen.has(stop.key)) break;
    seen.add(stop.key);
    // The page may first bring it into view: the drawing slides there over a third of a second.
    if (stop.why) await expect.poll(async () => (await look()).why, { message: `${what}: the Tab stop ${stop.name} can be seen`, timeout: 2000 }).toBe('');
  }
  return seen.size;
}

test('a sheet on a phone on its side keeps the status line and its Undo above it while the sheet keeps its rows; with less room they step out of sight, and nothing out of sight takes a Tab stop', async ({ page }) => {
  // A Pixel 7 on its side, the usual text (863 × 360): the critic of these fixes found the status line
  // out of sight above every sheet there, its Undo still a Tab stop that nobody could see (Enter undid
  // a change with nothing on the screen to say so). It stays now, above the sheet, which scrolls.
  await page.setViewportSize({ width: 863, height: 360 });
  await openApp(page);
  await expectSolved(page);
  // A change made on the drawing: the status line offers Undo.
  await partOnDrawing(page, 'R2').focus();
  await page.keyboard.press('t');
  const undo = statusLine(page).getByRole('button', { name: t('undo'), exact: true });
  await expect(undo).toBeVisible();
  const bar = page.getByRole('navigation', { name: t('barLabel') });
  const sheets = [
    { name: 'Checks', open: () => openPanel(page, 'checks'), close: () => closePanel(page, 'checks') },
    { name: 'Numbers', open: () => openPanel(page, 'numbers'), close: () => closePanel(page, 'numbers') },
    {
      name: 'Parts',
      open: async () => {
        await bar.getByRole('button', { name: t('barParts') }).tap();
        return page.getByRole('dialog', { name: t('partsSheetTitle') });
      },
      close: async () => {
        await page.getByRole('dialog', { name: t('partsSheetTitle') }).getByRole('button', { name: t('partsClose') }).tap();
        await expect(page.getByRole('dialog', { name: t('partsSheetTitle') })).toHaveCount(0);
      },
    },
  ];
  for (const sheet of sheets) {
    const box = await sheet.open();
    await settle(page);
    await expectInSight(statusLine(page), `${sheet.name} open: the status line`);
    await expectUsable(undo, `${sheet.name} open: the status line's Undo`);
    const status = (await statusLine(page).boundingBox())!;
    expect(status.y + status.height, `${sheet.name} open: the status line is above the sheet`).toBeLessThanOrEqual((await box.boundingBox())!.y + 1);
    expect(await expectNoTabStopOutOfSight(page, `${sheet.name} open`)).toBeGreaterThan(10);
    await sheet.close();
  }
  // A change that brings an error with Parts open (its rows stay as they are): the error's long reason
  // leaves the status line no room above the sheet. Undone, the short status comes back, and with it the
  // status line: a new status is measured again from the first step (the step taken for the error was
  // kept until the sheet closed, though the room was the same as before it). So is a status line that
  // offers Undo again, after the next change made on the drawing (just after an undo, Undo is under More).
  await bar.getByRole('button', { name: t('barParts') }).tap();
  await settle(page);
  await expectInSight(statusLine(page), 'Parts open, before the error: the status line');
  await partOnDrawing(page, 'Ground').focus();
  await page.keyboard.press('Delete');
  await expect(statusLine(page)).toHaveAttribute('data-tone', 'bad');
  await page.keyboard.press('Control+z');
  await expect(partOnDrawing(page, 'Ground')).toHaveCount(1);
  await expectSolved(page);
  await settle(page);
  await expectInSight(statusLine(page), 'Parts open, the error undone: the status line');
  await partOnDrawing(page, 'R2').focus();
  await page.keyboard.press('t');
  await expectSolved(page);
  await settle(page);
  await expectInSight(statusLine(page), 'Parts open, a change after the undo: the status line');
  await expectUsable(undo, 'Parts open, a change after the undo: the status line’s Undo');
  // The Parts sheet scrolls below the status line and keeps its rows: Resistor can be reached.
  await expectUsable(page.getByRole('dialog', { name: t('partsSheetTitle') }).getByRole('button', { name: /^Resistor/ }), 'the Parts sheet below the status line: Resistor');
});

/**
 * From now on, on every frame: where each row of the open sheet is on the screen (More's rows, and each
 * box and list item of a panel), each element by itself, and the status line's tone.
 */
async function logSheetRows(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { sheetRows: { mark: string; tone: string; top: number; rows: [number, string, number][] }[]; sheetMark: string; sheetIds: WeakMap<Element, number>; sheetStop?: boolean };
    w.sheetRows = [];
    w.sheetMark = 'start';
    w.sheetIds = new WeakMap();
    w.sheetStop = false;
    let next = 0;
    const tick = (): void => {
      const sheet = document.querySelector('.phone-bottom > .sheet');
      const rows: [number, string, number][] = [];
      for (const e of sheet?.querySelectorAll('.more-row, .card-body > *, .card-body li') ?? []) {
        const r = e.getBoundingClientRect();
        if (!r.height) continue;
        if (!w.sheetIds.has(e)) w.sheetIds.set(e, next++);
        rows.push([w.sheetIds.get(e)!, (e.textContent ?? '').trim().slice(0, 30), r.top]);
      }
      w.sheetRows.push({ mark: w.sheetMark, tone: document.querySelector('.status')?.getAttribute('data-tone') ?? '', top: sheet?.getBoundingClientRect().top ?? Number.NaN, rows });
      if (!w.sheetStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // The rows as they are before the first step: logged before it starts, or a row the sheet already had
  // counts as new in it (rowsThatMoved's onlyNew), and Checks' first box, whose words change as the error is
  // found and the sheet laid out afresh, failed the test at 640 × 400 when the first frame came late.
  await page.waitForFunction(() => (window as unknown as { sheetRows: unknown[] }).sheetRows.length > 0);
}

/** A step, then once its run has come and gone, the page settled. */
async function stepAndRun(page: Page, what: string, act: () => Promise<void>): Promise<void> {
  await page.evaluate((m) => ((window as unknown as { sheetMark: string }).sheetMark = m), what);
  await act();
  await page.waitForFunction((m) => {
    const frames = (window as unknown as { sheetRows: { mark: string; tone: string }[] }).sheetRows.filter((f) => f.mark === m);
    return frames.some((f) => f.tone === 'busy') && /^(ok|bad)$/.test(frames.at(-1)?.tone ?? '');
  }, what);
  await settle(page);
}

/** Where the sheet's top was, at least and at most, in the frames of one step. */
async function sheetTopsIn(page: Page, step: string): Promise<[number, number]> {
  return page.evaluate((m) => {
    const tops = (window as unknown as { sheetRows: { mark: string; top: number }[] }).sheetRows.filter((f) => f.mark === m).map((f) => f.top);
    return [Math.min(...tops), Math.max(...tops)];
  }, step);
}

/** Each row that moved on the screen while the log ran, with where it went (none: the rows stayed within a pixel). */
async function rowsThatMoved(page: Page, from?: { step: string; onlyNew?: boolean }): Promise<string[]> {
  return page.evaluate((from) => {
    const w = window as unknown as { sheetRows: { mark: string; rows: [number, string, number][] }[]; sheetStop?: boolean };
    // From a step on (a row the sheet already had then may have moved with its own rows changing in that step).
    const start = from ? w.sheetRows.findIndex((f) => f.mark === from.step) : 0;
    const before = new Set(from?.onlyNew ? w.sheetRows.slice(0, start).flatMap((f) => f.rows.map((r) => r[0])) : []);
    const seen = new Map<number, { name: string; tops: string[]; min: number; max: number }>();
    for (const f of w.sheetRows.slice(Math.max(0, start)))
      for (const [id, name, top] of f.rows) {
        if (before.has(id)) continue;
        const r = seen.get(id) ?? { name, tops: [], min: top, max: top };
        if (r.tops.at(-1)?.startsWith(`${Math.round(top)} `) !== true) r.tops.push(`${Math.round(top)} (${f.mark})`);
        r.min = Math.min(r.min, top);
        r.max = Math.max(r.max, top);
        seen.set(id, r);
      }
    return [...seen.values()].filter((r) => r.max - r.min > 1).map((r) => `${r.name}: ${r.tops.join(' → ')}`);
  }, from);
}

test('an open sheet keeps its rows where they are through each run, a new status and an undo (AP-2)', async ({ page }) => {
  // The second re-check: while an error stood, each edit's "Running…" brought the status line back above the
  // sheet for a fifth of a second and the sheet's top dropped (863 × 360: 105 → 143 → 105; 640 × 400:
  // 199 → 148 → 199), and a new settled status moved the rows too (More's Undo, 320 × 568, from 463–509 to
  // 404–450 when the error was undone): a quick second tap pressed the row below.
  const bar = page.getByRole('navigation', { name: t('barLabel') });
  for (const view of [
    { width: 863, height: 360, sheet: 'Checks', text: 'device' },
    { width: 640, height: 400, sheet: 'Checks', text: 'device' },
    { width: 320, height: 568, sheet: 'More', text: 'device' },
    // The largest text: the lines change most as the error comes (an iPhone SE).
    { width: 320, height: 568, sheet: 'Checks', text: 'x-large' },
  ] as const) {
    const at = `${view.width} × ${view.height}${view.text === 'device' ? '' : ' (largest text)'}, ${view.sheet} open`;
    if (view.text !== 'device') await page.evaluate((size) => localStorage.setItem('plainspice:settings', JSON.stringify({ textSize: size, contrast: 'device', motion: 'device' })), view.text);
    await page.setViewportSize({ width: view.width, height: view.height });
    await openApp(page);
    await expectSolved(page);
    if (view.sheet === 'Checks') await openPanel(page, 'checks');
    else {
      await bar.getByRole('button', { name: t('barMore'), exact: true }).tap();
      await page.getByRole('dialog', { name: t('barMore') }).getByRole('button', { name: t('undo'), exact: true }).scrollIntoViewIfNeeded();
    }
    await settle(page);
    await logSheetRows(page);
    // The error: the ground deleted on the drawing with the keys. More keeps its rows where they are;
    // Checks gets the error's row with the change (its own rows change: it is laid out afresh, before it is
    // drawn), and from then on, through the run and the lines stepping aside for the error, its rows stay.
    await stepAndRun(page, 'the ground deleted', async () => {
      await partOnDrawing(page, 'Ground').focus();
      await page.keyboard.press('Delete');
    });
    await expect(statusLine(page)).toHaveAttribute('data-tone', 'bad');
    await stepAndRun(page, 'T on R2', async () => {
      await partOnDrawing(page, 'R2').focus();
      await page.keyboard.press('t');
    });
    await stepAndRun(page, 'T again', () => page.keyboard.press('t'));
    await stepAndRun(page, 'Ctrl+Z', () => page.keyboard.press('Control+z'));
    await stepAndRun(page, 'Ctrl+Z again', () => page.keyboard.press('Control+z'));
    await expect(statusLine(page)).toHaveAttribute('data-tone', 'bad');
    // A run whose status is the one before it moves nothing at all, the sheet's head included: its
    // "Running…" is no new status (it brought the lines back above the sheet, or took them another height).
    for (const step of ['T again', 'Ctrl+Z again']) {
      const [lo, hi] = await sheetTopsIn(page, step);
      expect(hi - lo, `${at}, ${step}: the sheet's top moves (${lo} to ${hi})`).toBeLessThanOrEqual(1);
    }
    // The error undone: a new, shorter status (More's rows are the same rows; Checks' change).
    if (view.sheet === 'More') {
      await stepAndRun(page, 'the error undone', () => page.keyboard.press('Control+z'));
      await expect(statusLine(page)).toHaveAttribute('data-tone', 'ok');
    }
    const moved = view.sheet === 'More' ? await rowsThatMoved(page) : [...(await rowsThatMoved(page, { step: 'the ground deleted', onlyNew: true })), ...(await rowsThatMoved(page, { step: 'T on R2' }))];
    await page.evaluate(() => ((window as unknown as { sheetStop: boolean }).sheetStop = true));
    expect(moved, `${at}: the sheet's rows that moved`).toEqual([]);
    // Start here as it was for the next view (the netlist is saved on this device).
    if (view.sheet === 'Checks') await page.keyboard.press('Control+z');
    await expectSolved(page);
  }
});

test('two quick taps on More’s Undo, 150 ms apart, undo twice while an error stands (320 × 568, AP-2)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page);
  await expectSolved(page);
  // Three changes: the ground deleted (an error), R2 turned twice.
  await partOnDrawing(page, 'Ground').focus();
  await page.keyboard.press('Delete');
  await expect(statusLine(page)).toHaveAttribute('data-tone', 'bad');
  for (let i = 0; i < 2; i++) {
    await partOnDrawing(page, 'R2').focus();
    await page.keyboard.press('t');
    await expect(statusLine(page).getByRole('button', { name: t('undo'), exact: true })).toBeAttached();
    await expect(statusLine(page)).toHaveAttribute('data-tone', 'bad');
    await settle(page);
  }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.getByRole('navigation', { name: t('barLabel') }).getByRole('button', { name: t('barMore'), exact: true }).tap();
  const undo = page.getByRole('dialog', { name: t('barMore') }).getByRole('button', { name: t('undo'), exact: true });
  await undo.scrollIntoViewIfNeeded();
  await settle(page);
  const box = (await undo.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(() => {
    const w = window as unknown as { pressed: string[] };
    w.pressed = [];
    document.addEventListener('click', (e) => w.pressed.push((e.target as Element).closest('button')?.textContent?.trim() ?? (e.target as Element).tagName), true);
  });
  // Two real taps, the second 150 ms after the first (while the first one's run is under way).
  const cdp = await page.context().newCDPSession(page);
  const tap = async (): Promise<void> => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await tap();
  await page.waitForTimeout(110);
  await tap();
  await cdp.detach();
  await expect.poll(() => page.evaluate(() => (window as unknown as { pressed: string[] }).pressed)).toEqual([t('undo'), t('undo')]);
  // Both turns undone, the error still there: Redo has two steps to give back.
  await expect(statusLine(page)).toHaveAttribute('data-tone', 'bad');
  await expect(page.getByRole('dialog', { name: t('barMore') }).getByRole('button', { name: t('redo'), exact: true })).toBeEnabled();
});

test('an open sheet the student scrolled keeps its head where it is: a later run lifts neither its head nor its × (AP-2)', async ({ page }) => {
  // The error undone gives the room the error's words took back to the paper; then the student scrolls More.
  // Held to grow back as far as its scroll gave back at the next change above it, the sheet's head and its ×
  // went up by the 40 px scrolled with the next run (640 × 400: from 199 to 159), its rows staying put.
  const bar = page.getByRole('navigation', { name: t('barLabel') });
  for (const view of [
    { width: 640, height: 400 },
    { width: 320, height: 568 },
  ] as const) {
    const at = `${view.width} × ${view.height}`;
    await page.setViewportSize(view);
    await openApp(page);
    await expectSolved(page);
    await partOnDrawing(page, 'Ground').focus();
    await page.keyboard.press('Delete');
    await expect(statusLine(page)).toHaveAttribute('data-tone', 'bad');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await bar.getByRole('button', { name: t('barMore'), exact: true }).tap();
    const more = page.getByRole('dialog', { name: t('barMore') });
    await expect(more).toBeVisible();
    await settle(page);
    await page.keyboard.press('Control+z');
    await expect(statusLine(page)).toHaveAttribute('data-tone', 'ok');
    await settle(page);
    // The student's own scroll: its rows go up with it, its head stays.
    await page.evaluate(() => {
      document.querySelector('.phone-bottom > .sheet > .card-body')!.scrollTop += 40;
    });
    await settle(page);
    const close = more.getByRole('button', { name: t('moreClose') });
    const before = (await close.boundingBox())!.y;
    await logSheetRows(page);
    await stepAndRun(page, 'T on R2', async () => {
      await partOnDrawing(page, 'R2').focus();
      await page.keyboard.press('t');
    });
    await stepAndRun(page, 'T again', () => page.keyboard.press('t'));
    for (const step of ['T on R2', 'T again']) {
      const [lo, hi] = await sheetTopsIn(page, step);
      expect(hi - lo, `${at}, ${step}: the sheet's top moves (${lo} to ${hi})`).toBeLessThanOrEqual(1);
    }
    expect(Math.abs((await close.boundingBox())!.y - before), `${at}: the × moved`).toBeLessThanOrEqual(1);
    expect(await rowsThatMoved(page), `${at}: the sheet's rows that moved`).toEqual([]);
    // Start here again for the next view (the netlist is saved on this device).
    await page.evaluate(() => {
      (window as unknown as { sheetStop: boolean }).sheetStop = true;
      localStorage.removeItem('plainspice:netlist');
    });
  }
});

test('a value typed on a part’s card while an error stands moves none of the card’s rows (AP-2)', async ({ page }) => {
  // While an error stood, the card's note ("No numbers yet: a check found an error on line 2 …") went for
  // each run of a value typed and came back with its answer: the card's actions below it (Explain, Turn,
  // Mirror, Reverse, Move, Connections, Delete) went up and down by 47 px on an iPhone SE with each key.
  for (const view of [
    { width: 320, height: 568 },
    { width: 863, height: 360 },
  ] as const) {
    const at = `${view.width} × ${view.height}`;
    await page.setViewportSize(view);
    await openApp(page);
    await expectSolved(page);
    await partOnDrawing(page, 'Ground').focus();
    await page.keyboard.press('Delete');
    await expect(statusLine(page)).toHaveAttribute('data-tone', 'bad');
    await partOnDrawing(page, 'R2').focus();
    await page.keyboard.press('Enter');
    const card = page.getByRole('dialog', { name: /^R2 / });
    await expect(card).toBeVisible();
    // The field reached with the keys: the card stays a sheet (a tap makes it the strip above the keyboard).
    const field = card.getByRole('textbox');
    await field.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await settle(page);
    await expect(card.locator('.index-card__note')).toContainText(/error on line 2/);
    // Every control of the card and its field, where each is on every frame.
    await page.evaluate(() => {
      const w = window as unknown as { cardRows: Map<Element, { name: string; min: number; max: number }>; cardStop?: boolean };
      w.cardRows = new Map();
      w.cardStop = false;
      const tick = (): void => {
        for (const e of document.querySelectorAll('.phone-bottom > .sheet :is(button, input)')) {
          const r = e.getBoundingClientRect();
          if (!r.height) continue;
          const seen = w.cardRows.get(e) ?? { name: (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 30), min: r.top, max: r.top };
          seen.min = Math.min(seen.min, r.top);
          seen.max = Math.max(seen.max, r.top);
          w.cardRows.set(e, seen);
        }
        if (!w.cardStop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    for (const key of ['3', 'k']) {
      await page.keyboard.type(key);
      // The value is written at once (the status line, out of sight under the card, says "Running…"); its
      // run comes and goes within a moment.
      await expect.poll(() => page.evaluate(() => localStorage.getItem('plainspice:netlist') ?? '')).toMatch(key === '3' ? /\nR2 \S+ \S+ 3\n/ : /\nR2 \S+ \S+ 3k\n/);
      await page.waitForTimeout(1500);
      await settle(page);
    }
    const moved = await page.evaluate(() => {
      const w = window as unknown as { cardRows: Map<Element, { name: string; min: number; max: number }>; cardStop: boolean };
      w.cardStop = true;
      return [...w.cardRows.values()].filter((r) => r.max - r.min > 1).map((r) => `${r.name}: ${Math.round(r.min)}..${Math.round(r.max)}`);
    });
    expect(moved, `${at}: the card's controls that moved`).toEqual([]);
    // Still no numbers, and the card still says why.
    await expect(card.locator('.index-card__note')).toContainText(/error on line 2/);
    // Start here again for the next view (the netlist is saved on this device).
    await page.evaluate(() => localStorage.removeItem('plainspice:netlist'));
  }
});

test('an upright phone keeps the status line and its Undo above More and Parts, and a short sheet keeps them above it on its side (320 × 568, the usual text)', async ({ page }) => {
  // Upright, an iPhone SE at the usual text size: above More and Parts the hint steps aside and the status
  // line stays (the first step). On its side, Plot before a sweep has one line of words below its head:
  // the sheet keeps what it has, not two rows' room, and the status line stays above it too.
  const bar = page.getByRole('navigation', { name: t('barLabel') });
  const sheets = {
    more: {
      open: async (): Promise<Locator> => {
        await bar.getByRole('button', { name: t('barMore') }).tap();
        return page.getByRole('dialog', { name: t('barMore') });
      },
      close: async (): Promise<void> => {
        await page.getByRole('dialog', { name: t('barMore') }).getByRole('button', { name: t('moreClose') }).tap();
        await expect(page.getByRole('dialog', { name: t('barMore') })).toHaveCount(0);
      },
    },
    parts: {
      open: async (): Promise<Locator> => {
        await bar.getByRole('button', { name: t('barParts') }).tap();
        return page.getByRole('dialog', { name: t('partsSheetTitle') });
      },
      close: async (): Promise<void> => {
        await page.getByRole('dialog', { name: t('partsSheetTitle') }).getByRole('button', { name: t('partsClose') }).tap();
        await expect(page.getByRole('dialog', { name: t('partsSheetTitle') })).toHaveCount(0);
      },
    },
    plot: { open: (): Promise<Locator> => openPanel(page, 'plot'), close: (): Promise<void> => closePanel(page, 'plot') },
  };
  for (const c of [
    { size: { width: 320, height: 568 }, open: ['more', 'parts'] as const },
    { size: { width: 568, height: 320 }, open: ['plot'] as const },
  ]) {
    const at = `${c.size.width} × ${c.size.height}`;
    await page.setViewportSize(c.size);
    await openApp(page);
    await expectSolved(page);
    // A change made on the drawing: the status line offers Undo.
    await partOnDrawing(page, 'R2').focus();
    await page.keyboard.press('t');
    const undo = statusLine(page).getByRole('button', { name: t('undo'), exact: true });
    await expect(undo).toBeVisible();
    for (const name of c.open) {
      const sheet = await sheets[name].open();
      await expect(sheet).toBeVisible();
      await settle(page);
      await expectInSight(statusLine(page), `${at}, ${name} open: the status line`);
      await expectUsable(undo, `${at}, ${name} open: the status line’s Undo`);
      const status = (await statusLine(page).boundingBox())!;
      expect(status.y + status.height, `${at}, ${name} open: the status line is above the sheet`).toBeLessThanOrEqual((await sheet.boundingBox())!.y + 1);
      const free = await paperLeft(page);
      expect(free.bottom - free.top, `${at}, ${name} open: some paper shows`).toBeGreaterThanOrEqual(48);
      // The drawing's Tab stop (R2, the part just turned) too: brought out from under the sheet when the
      // keys reach it, its focus ring in the paper left above the sheet.
      expect(await expectNoTabStopOutOfSight(page, `${at}, ${name} open`)).toBeGreaterThan(10);
      await sheets[name].close();
    }
  }
});

test('a sheet that leaves the status line no room puts it out of sight, its words for screen readers and no Tab stop (568 × 320, the largest text)', async ({ page }) => {
  // An iPhone SE on its side with the Settings' largest text: a sheet keeps its head and about two rows,
  // and the status line would leave it less.
  await page.addInitScript(() => localStorage.setItem('plainspice:settings', JSON.stringify({ textSize: 'x-large', contrast: 'device', motion: 'device' })));
  await page.setViewportSize({ width: 568, height: 320 });
  await openApp(page);
  await expectSolved(page);
  await partOnDrawing(page, 'R2').focus();
  await page.keyboard.press('t');
  await expect(statusLine(page).getByRole('button', { name: t('undo'), exact: true })).toBeVisible();
  for (const name of ['checks', 'explain'] as const) {
    await openPanel(page, name);
    await settle(page);
    // Out of sight, the run's words still there for screen readers.
    expect((await sight(statusLine(page))).why, `${name} open: the status line is out of sight`).toMatch(/^out of sight/);
    await expect(statusLine(page)).toContainText(/Finished in \d+ ms/);
    expect(await expectNoTabStopOutOfSight(page, `${name} open`)).toBeGreaterThan(10);
    await closePanel(page, name);
    // The sheet closed, the status line and its Undo are back.
    await expectUsable(statusLine(page).getByRole('button', { name: t('undo'), exact: true }), `${name} closed: the status line's Undo`);
  }
});

test('the hint line’s box cuts nothing at the usual text size, and squeezed it fades where it hides words', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  // The first screen's Change R1 from the keys: its focus ring is drawn whole, no box around it cutting
  // it (the hint's box scrolled always, and cut the ring's bottom on a Pixel 7 at the usual text size).
  const invite = page.getByRole('button', { name: t('noteButton', { name: 'R1' }), exact: true });
  await invite.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(invite).toBeFocused();
  const cut = await invite.evaluate((el) => {
    const s = getComputedStyle(el);
    const ring = Number.parseFloat(s.outlineOffset) + Number.parseFloat(s.outlineWidth);
    const r = el.getBoundingClientRect();
    const cuts: string[] = [];
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (getComputedStyle(p).overflowY === 'visible' && getComputedStyle(p).overflowX === 'visible') continue;
      const c = p.getBoundingClientRect();
      if (r.top - ring < c.top - 0.5 || r.bottom + ring > c.bottom + 0.5 || r.left - ring < c.left - 0.5 || r.right + ring > c.right + 0.5) cuts.push(String(p.className).split(' ')[0] ?? p.tagName);
    }
    return cuts;
  });
  expect(cut, 'boxes that cut the focus ring of Change R1').toEqual([]);
  // Small phones with the largest text and a resistor in hand: the hint's box is squeezed and scrolls. A
  // box cut exactly between two lines gave no sign of more words: it fades at that end now. On the
  // smallest (320 × 568, an iPhone SE) the box is squeezed to its least, a line and a half, so the fade
  // falls on the top of the second line, where it can be seen: on its first line alone it fell on the
  // bottoms of the letters, and "Tap the paper where a" read as all there was.
  await page.addInitScript(() => localStorage.setItem('plainspice:settings', JSON.stringify({ textSize: 'x-large', contrast: 'device', motion: 'device' })));
  for (const size of [{ width: 360, height: 640 }, { width: 320, height: 568 }]) {
    const at = `${size.width} × ${size.height}`;
    await page.setViewportSize(size);
    await openApp(page);
    await newCircuit(page);
    await page.getByRole('navigation', { name: t('barLabel') }).getByRole('button', { name: t('barParts') }).tap();
    await page.getByRole('dialog', { name: t('partsSheetTitle') }).getByRole('button', { name: /^Resistor/ }).tap();
    const box = page.getByRole('region', { name: t('hintScrollLabel') });
    await expect(box).toBeVisible();
    const fade = (): Promise<{ more: string; mask: string }> => box.evaluate((el) => ({ more: (el as HTMLElement).dataset.more ?? '', mask: getComputedStyle(el).maskImage }));
    await expect.poll(fade).toMatchObject({ more: 'below', mask: expect.stringMatching(/gradient/) });
    // How much of the hint's second line the box shows (in lines), where the fade is.
    const secondLine = (): Promise<number> =>
      box.evaluate((el) => {
        const hint = el.querySelector('#hint-line')!;
        const range = document.createRange();
        range.selectNodeContents(hint);
        const tops = [...range.getClientRects()].map((r) => r.top).sort((a, b) => a - b);
        const second = tops.find((top) => top > tops[0]! + 2);
        return second === undefined ? 0 : (el.getBoundingClientRect().bottom - second) / Number.parseFloat(getComputedStyle(hint).lineHeight);
      });
    await expect.poll(secondLine, { message: `${at}: the box shows half of the hint's second line at least` }).toBeGreaterThanOrEqual(0.5);
    // Scrolled to its end, the fade moves to the top, where the words it has passed are.
    await box.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect.poll(fade).toMatchObject({ more: 'above', mask: expect.stringMatching(/gradient/) });
  }
});
