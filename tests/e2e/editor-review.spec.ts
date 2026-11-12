/**
 * 12. The schematic editor after its reviews (decision 0017): what the three critiques of step B
 * found, each checked in a real browser. A move never puts back a change made while it was in hand,
 * and a part turns while it is dragged; moving the ground symbol keeps the circuit on ground; the
 * folded drawing lines never swallow a line; a card's keys act on its part (and a letter on its
 * buttons never switches the tool); renaming a node keeps its card and the focus; the focus is never
 * left on the page itself; a card opens without moving the drawing; the drawing is an application
 * to screen readers; a part moved with the keys stays in view and is said; the Wire tool's click on a
 * part ends at its pin; a part added with the form to a drawn circuit is pinned in its lines.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  START_HERE,
  closePanel,
  drawing,
  expectAnnounced,
  expectSolved,
  gridPoint,
  isPhone,
  netlistEditor,
  newCircuit,
  openApp,
  openCard,
  openNetlist,
  partOnDrawing,
  partsToolbar,
  savedNetlist,
  setNetlist,
  setNetlistWithDrawing,
  settle,
  statusLine,
  t,
} from './helpers.ts';

/** What has the focus: never the page itself after an edit (WCAG 2.4.3). */
const focusLost = (page: Page): Promise<boolean> => page.evaluate(() => !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected);

/** Start here, its drawing written into the netlist by a first move (the *@ lines). */
async function startHere(page: Page): Promise<void> {
  await openApp(page);
  await expectSolved(page);
  await settle(page);
}

test.beforeEach(({ page }) => {
  test.skip(isPhone(page), 'the computer: a mouse and the keys (the phone has its own tests)');
});

test('a move never puts back a change made while the part was picked up, and a part turns while it is dragged', async ({ page }) => {
  await startHere(page);
  // R2 picked up with its card's Move, two steps to the right with the arrow keys.
  const card = await openCard(page, 'R2');
  await card.getByRole('button', { name: t('editMoveLabel', { name: 'R2' }) }).click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  // Meanwhile R1 becomes 5k in the Netlist panel; then R2 is put down.
  await setNetlist(page, START_HERE.replace('R1 in out 1k', 'R1 in out 5k'));
  await closePanel(page, 'netlist');
  await page.getByRole('toolbar', { name: t('editMove') }).getByRole('button', { name: t('place') }).click();
  await expectAnnounced(page, 'R2 moved.');
  await expect.poll(() => savedNetlist(page)).toContain('*@ R2 10 3 0');
  expect(await savedNetlist(page)).toContain('R1 in out 5k');
  // Dragged, and turned with T before it is dropped: it lands turned, in one step with the move.
  const from = await gridPoint(page, 10, 3);
  const to = await gridPoint(page, 12, 3);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y);
  await page.keyboard.press('t');
  await expectAnnounced(page, t('turnedMoving', { name: 'R2' }));
  await page.mouse.up();
  await expect.poll(() => savedNetlist(page)).toMatch(/\*@ R2 12 3 90\b/);
  expect(await savedNetlist(page)).toContain('R1 in out 5k');
});

test('moving the ground symbol keeps the circuit on ground: a wire follows it', async ({ page }) => {
  await startHere(page);
  const ground = drawing(page).getByRole('button', { name: 'Ground, node 0' });
  await ground.focus();
  await page.keyboard.press('Shift+ArrowDown');
  await expectAnnounced(page, 'Ground symbol moved.');
  await expect.poll(() => savedNetlist(page)).toContain('*@ ground 0 7 0');
  const saved = (await savedNetlist(page))!;
  for (const line of ['V1 in 0 6', 'R1 in out 1k', 'R2 out 0 2k']) expect(saved).toContain(line);
  await expectSolved(page);
  await expect(statusLine(page)).not.toContainText(/no ground/i);
});

test('the folded drawing lines never swallow a line: Backspace or Delete at their edges unfolds them instead', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  const drawn = `${START_HERE.replace('.end\n', '')}* plainspice-drawing v1\n*@ V1 0 3 0\n*@ R1 4 0 270\n*@ R2 8 3 0\n*@ ground 0 6 0\n.end\n`;
  await setNetlistWithDrawing(page, drawn);
  const editor = netlistEditor(page);
  await expect(editor).not.toContainText('*@ R1');
  // The cursor at the start of .end, the line after the folded block: Backspace.
  await editor.locator('.cm-line').filter({ hasText: /^\.end$/ }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await expect(editor).toContainText('*@ R1 4 0 270');
  expect(await savedNetlist(page)).toBe(drawn);
  // Folded again, Delete at the end of .op (the line before the block): the same.
  await openNetlist(page);
  const hide = page.getByRole('button', { name: t('drawingHide') });
  if (await hide.isVisible()) await hide.click();
  await expect(editor).not.toContainText('*@ R1');
  await editor.locator('.cm-line').filter({ hasText: /^\.op/ }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await expect(editor).toContainText('*@ R1 4 0 270');
  await settle(page);
  expect(await savedNetlist(page)).toBe(drawn);
});

test('a card’s keys act on its part: T turns it while its value is as it opened; a letter on its buttons never switches the tool', async ({ page }) => {
  await startHere(page);
  const card = await openCard(page, 'R2');
  const field = card.getByRole('textbox');
  await expect(field).toBeFocused();
  await page.keyboard.press('t');
  await expectAnnounced(page, 'R2 turned.');
  await expect(field).toHaveValue('2k');
  // On its Turn button: W is not the Wire tool here, and M mirrors the card's part.
  const turn = card.getByRole('button', { name: t('editTurnLabel', { name: 'R2' }) });
  await turn.focus();
  await page.keyboard.press('w');
  await expect(partsToolbar(page).getByRole('button', { name: t('toolSelect') })).toHaveAttribute('aria-pressed', 'true');
  await expect(card).toBeVisible();
  await expect(turn).toBeFocused();
  await page.keyboard.press('m');
  await expectAnnounced(page, 'R2 mirrored.');
  // Undo from the card's button: the focus stays somewhere on the page's controls.
  await page.keyboard.press('ControlOrMeta+z');
  await expectAnnounced(page, 'Undone: R2 mirrored.');
  await expect.poll(() => focusLost(page)).toBe(false);
  // Connections open with the focus on their first Connect to… (they are drawn above their button).
  const again = await openCard(page, 'R2');
  await again.getByRole('button', { name: t('connTitle') }).click();
  await expect(again.getByRole('button', { name: t('connConnectLabel', { role: 'node 1', name: 'R2' }) })).toBeFocused();
});

test('renaming a node keeps its card in view and the focus in its name', async ({ page }) => {
  await startHere(page);
  await drawing(page).getByRole('button', { name: 'Node out' }).click();
  const card = page.getByRole('dialog', { name: /^Node out/ });
  const name = card.getByRole('textbox', { name: /^Name/ });
  await name.fill('vout');
  await name.press('Enter');
  await expectAnnounced(page, 'out renamed to vout.');
  const renamed = page.getByRole('dialog', { name: /^Node vout/ });
  await expect(renamed).toBeVisible();
  await expect.poll(() => renamed.evaluate((el) => Number(getComputedStyle(el.closest('.pinned') ?? el).opacity))).toBeGreaterThan(0.9);
  await expect(renamed.getByRole('textbox', { name: /^Name/ })).toBeFocused();
});

test('the focus is never left on the page itself: a wire from the keys, a new circuit (its Add a part takes it)', async ({ page }) => {
  await startHere(page);
  // With the Wire tool, Enter on a node and Enter on another: the wire joins them, the focus stays on the drawing.
  await drawing(page).getByRole('button', { name: 'Node in' }).focus();
  await page.keyboard.press('w');
  await expect(page.locator('.hint')).toHaveText(t('hintWireKeys'));
  await page.keyboard.press('Enter');
  await drawing(page).getByRole('button', { name: 'Node out' }).focus();
  await page.keyboard.press('Enter');
  await expectAnnounced(page, /Wire added\. out and in are now one node, in\./);
  await expect.poll(() => focusLost(page)).toBe(false);
  // The Add a part form opened from Ctrl+K and closed with Esc: the palette that opened it is gone,
  // and the focus goes back to the drawing.
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('add a part');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: t('formTitle') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: t('formTitle') })).toHaveCount(0);
  await expect.poll(() => focusLost(page)).toBe(false);
  // A new circuit: the blank page's Add a part has the focus, and A opens the form from there.
  await newCircuit(page);
  await expect(page.locator('.empty-card').getByRole('button', { name: t('emptyAdd') })).toBeFocused();
  await page.keyboard.press('a');
  await expect(page.getByRole('dialog', { name: t('formTitle') })).toBeVisible();
});

test('when a card makes room by panning the drawing (decision 0015), a double click on a value still opens that part’s card', async ({ page }) => {
  await openApp(page);
  await page.getByRole('banner').getByRole('button', { name: /^Examples/ }).click();
  await page.getByRole('menu', { name: t('examplesMenu') }).getByRole('menuitem', { name: 'Example 3: open circuit (V_Th)', exact: true }).click();
  await expectSolved(page);
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  // R3's value, "6 Ω": a double click there opens R3's card on its value, even if the first click's
  // card slid the drawing before the second click came.
  const value = page.locator('.nb-ink text').filter({ hasText: /^6\sΩ$/ }).first();
  const box = (await value.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const card = page.getByRole('dialog', { name: /^R3 / });
  await expect(card).toBeVisible();
  await expect(card.getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});

test('to screen readers the drawing is an application (its keys pass to it); a part moved with the keys stays in view and is said', async ({ page }) => {
  await startHere(page);
  const app = drawing(page);
  await expect(app).toHaveAttribute('aria-roledescription', t('drawingRole'));
  const card = await openCard(page, 'R2');
  await card.getByRole('button', { name: t('editMoveLabel', { name: 'R2' }) }).click();
  for (let i = 0; i < 14; i++) await page.keyboard.press('ArrowDown');
  await expectAnnounced(page, /R2, 14 squares down from where it was: (it can go here|not here)/);
  // The part (or its ghost) is on the paper, above the bar of what is in hand.
  const bar = (await page.getByRole('toolbar', { name: t('editMove') }).boundingBox())!;
  const mark = page.locator('.nb-hand, .nb-hl.is-selected').first();
  const box = (await mark.boundingBox()) ?? (await partOnDrawing(page, 'R2').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y + 2);
  expect(box.y).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expectAnnounced(page, t('putBack', { name: 'R2' }));
});

test('the Wire tool: a click on a part’s symbol ends the wire at its nearer pin', async ({ page }) => {
  await startHere(page);
  await partsToolbar(page).getByRole('button', { name: t('toolWire') }).click();
  const v1 = await gridPoint(page, 0, 1);
  await page.mouse.click(v1.x, v1.y);
  // R2's body, nearer its top pin (on out).
  const r2 = await gridPoint(page, 8, 2.6);
  await page.mouse.move(r2.x, r2.y);
  await page.mouse.click(r2.x, r2.y);
  await expectAnnounced(page, /Wire added\. out and in are now one node, in\./);
});

test('a part added with the form to a circuit drawn by hand is pinned in its lines at once', async ({ page }) => {
  await startHere(page);
  // A turn writes the drawing into the netlist.
  await partOnDrawing(page, 'R2').focus();
  await page.keyboard.press('t');
  await expectAnnounced(page, 'R2 turned.');
  await page.keyboard.press('a');
  const form = page.getByRole('dialog', { name: t('formTitle') });
  await form.getByRole('textbox', { name: 'Value' }).fill('3k');
  await form.getByRole('combobox', { name: 'Node 1' }).selectOption({ label: 'out' });
  await form.getByRole('combobox', { name: 'Node 2' }).selectOption({ label: t('groundWords') });
  await form.getByRole('button', { name: 'Add R3' }).click();
  await expectAnnounced(page, 'R3 added between out and ground.');
  await expect.poll(() => savedNetlist(page)).toMatch(/\*@ R3 -?\d+ -?\d+ \d+/);
  await openNetlist(page);
});
