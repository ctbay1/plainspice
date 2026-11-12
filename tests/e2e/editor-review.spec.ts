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
  hintLine,
  isPhone,
  netlistEditor,
  newCircuit,
  openApp,
  openCard,
  openNetlist,
  openPanel,
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
  await expect(again.getByRole('button', { name: t('connConnectLabel', { role: 'end 1', name: 'R2' }) })).toBeFocused();
});

test('one rule for a card’s keys, its badges and the hint: once the caret is placed in the value, T is a letter of it, and they say so', async ({ page }) => {
  await startHere(page);
  const card = await openCard(page, 'R2');
  const field = card.getByRole('textbox');
  await expect(field).toBeFocused();
  // As it opens, the value all selected: T turns R2, as its badge and the hint say.
  await expect(hintLine(page)).toContainText('T turns it, M mirrors it');
  await expect(card).not.toHaveClass(/is-typing/);
  // The caret placed in the value (End, or a click in it): T, M and Shift+R are letters of it now (2k
  // could become 2km), so the badges are struck through and the hint says to close the card first.
  await page.keyboard.press('End');
  await expect(card).toHaveClass(/is-typing/);
  await expect(hintLine(page)).toContainText('(then T turns it)');
  // All selected again: the card's keys again.
  await page.keyboard.press('Shift+Home');
  await expect(card).not.toHaveClass(/is-typing/);
  await expect(hintLine(page)).toContainText('T turns it, M mirrors it');
  // A click on the card's own paper keeps the focus on the card, and its keys act on its part.
  await card.locator('.readouts').click();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.index-card'))).toBe(true);
  await page.keyboard.press('t');
  await expectAnnounced(page, 'R2 turned.');
  await expect(card).toBeVisible();
  await expect(field).toHaveValue('2k');
  // In the field, Delete edits the text (its badge is struck there): the field empties, the netlist keeps 2k and says so.
  await field.focus();
  await field.selectText();
  await expect(card).toHaveClass(/is-in-field/);
  await page.keyboard.press('Delete');
  await expect(field).toHaveValue('');
  await expect(card).toContainText(t('cardEmpty', { value: '2k' }));
  await expect.poll(() => savedNetlist(page)).toContain('R2 out 0 2k');
});

test('renaming a node keeps its card in view and the focus in its name', async ({ page }) => {
  await startHere(page);
  await drawing(page).getByRole('button', { name: 'Node out' }).click();
  const card = page.getByRole('dialog', { name: /^Node out/ });
  const name = card.getByRole('textbox', { name: /^Name/ });
  await name.fill('vout');
  await name.press('Enter');
  await expectAnnounced(page, 'Node out renamed to vout.');
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
  await expectAnnounced(page, /Wire added\. Node out and node in are now one node, in\./);
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
  await expectAnnounced(page, /Wire added\. Node out and node in are now one node, in\./);
});

test('the Wire tool ends the wire where its preview showed, even at a symbol’s middle, and says which nodes become one', async ({ page }) => {
  await startHere(page);
  await partsToolbar(page).getByRole('button', { name: t('toolWire') }).click();
  // From R2's bottom pin (ground) ...
  const r2 = await gridPoint(page, 8, 5);
  await page.mouse.click(r2.x, r2.y);
  // ... to R1's middle: the pointer's place there (held to a quarter of a square) is as near one end as
  // the other; the preview chose one, and the hint says which two nodes the click makes one.
  const mid = await gridPoint(page, 4.1, 0);
  await page.mouse.move(mid.x, mid.y);
  await expect(hintLine(page)).toContainText(t('hintWireEndHere', { a: t('groundWords'), b: 'node in' }).split(' · ')[0]!);
  // The press lands a tenth of a square from the middle, nearer the other end: the wire still ends where the preview showed.
  await page.mouse.click(mid.x, mid.y);
  await expectAnnounced(page, /Wire added\. Node in and ground are now one node, ground\./);
});

test('a controlled source placed on the drawing stays marked until the student chooses what it reads (red pen, and the Checks panel)', async ({ page }) => {
  await startHere(page);
  // G in hand from its key (the paper has the focus after a click on it, below the first screen's note), placed right of R2.
  const paper = await gridPoint(page, 14, 7);
  await page.mouse.click(paper.x, paper.y);
  await page.keyboard.press('g');
  const at = await gridPoint(page, 15, 3);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  const card = page.getByRole('dialog', { name: /^G1 / });
  await expect(card).toBeVisible();
  // Closed and let go: G1 is no longer selected, and still marked in red pen.
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await page.keyboard.press('Escape');
  // In the words of its Connections ("the voltage between"), not a formula.
  await expect.poll(() => page.locator('.nb-pen__note').allTextContents().then((x) => x.join(' '))).toMatch(/G1 reads the\s*voltage\s*between\s*node in\s*and\s*ground/);
  // The Checks panel lists it, with the way to choose.
  const checks = await openPanel(page, 'checks');
  await expect(checks.getByRole('heading', { name: t('checksUnchosenTitle') })).toBeVisible();
  await expect(checks).toContainText(/G1 reads the voltage between node \w+ and ground/);
  await checks.getByRole('button', { name: t('checksUnchosenOpen', { name: 'G1' }) }).click();
  await expect(page.getByRole('dialog', { name: /^G1 / })).toBeVisible();
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
  await form.getByRole('combobox', { name: 'End 1' }).selectOption({ label: 'out' });
  await form.getByRole('combobox', { name: 'End 2' }).selectOption({ label: t('groundWords') });
  await form.getByRole('button', { name: 'Add R3' }).click();
  await expectAnnounced(page, 'R3 added between node out and ground.');
  await expect.poll(() => savedNetlist(page)).toMatch(/\*@ R3 -?\d+ -?\d+ \d+/);
  await openNetlist(page);
});

test('a piece of wire selected: Shift+arrow keys and Enter say why they do nothing to it, as its hint says (the words re-check, new-11)', async ({ page }) => {
  await startHere(page);
  const before = await savedNetlist(page);
  const clickAt = async (x: number, y: number): Promise<void> => {
    const p = await gridPoint(page, x, y);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
  };
  // The wire between V1 and R1: the piece is selected, and its node has the focus for the keys.
  await clickAt(1, 0);
  await expect(hintLine(page)).toHaveText(t('hintWireSelected', { node: 'node in' }));
  await expect(drawing(page).getByRole('button', { name: 'Node in' })).toBeFocused();
  // Shift+Right would have moved the name of node in, and Enter opened its card: neither, and why.
  await page.keyboard.press('Shift+ArrowRight');
  await expect(hintLine(page)).toHaveText(t('pieceNoMove', { what: t('labelName', { node: 'in' }) }));
  // (The drawing takes no click for 400 ms after a tap on the paper: the click a pointer sends after it.)
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await expect(hintLine(page)).toHaveText(t('pieceNoCard', { node: 'node in' }));
  await expect(page.getByRole('dialog', { name: /^Node in/ })).toHaveCount(0);
  expect(await savedNetlist(page)).toBe(before);
  // Ground's wire: Shift+Down would have moved the ground symbol.
  await page.keyboard.press('Escape');
  await clickAt(4, 6);
  await expect(hintLine(page)).toHaveText(t('hintWireSelected', { node: t('groundWords') }));
  await page.keyboard.press('Shift+ArrowDown');
  await expect(hintLine(page)).toHaveText(t('pieceNoMove', { what: t('theGround') }));
  expect(await savedNetlist(page)).toBe(before);
  // Esc lets go of the piece: ground is selected, and the hint says what its keys do now.
  await page.keyboard.press('Escape');
  await expect(hintLine(page)).toHaveText(t('hintGroundSelected'));
});

test('a piece of wire selected: a click on its node’s name opens the node’s card, since the pointer chose the node (the words critic, new-11)', async ({ page }) => {
  await startHere(page);
  const wire = await gridPoint(page, 1, 0);
  await page.mouse.move(wire.x, wire.y);
  await page.mouse.click(wire.x, wire.y);
  await expect(hintLine(page)).toHaveText(t('hintWireSelected', { node: 'node in' }));
  // The name of node in, clicked with the mouse (its button covers the name), after the 400 ms in which
  // the drawing takes no click after a tap on the paper.
  const name = (await drawing(page).getByRole('button', { name: 'Node in' }).boundingBox())!;
  await page.mouse.move(name.x + name.width / 2, name.y + name.height / 2);
  await page.waitForTimeout(500);
  await page.mouse.click(name.x + name.width / 2, name.y + name.height / 2);
  await expect(page.getByRole('dialog', { name: /^Node in/ })).toBeVisible();
  await expect(hintLine(page)).not.toHaveText(t('pieceNoCard', { node: 'node in' }));
});

test('Esc on the drawing clears an older refusal from the hint line at once, also with nothing left to let go of (the words critic)', async ({ page }) => {
  await startHere(page);
  await drawing(page).getByRole('button', { name: 'Ground, node 0' }).focus();
  await page.keyboard.press('t');
  await expect(hintLine(page)).toHaveText(t('turnOnlyParts'));
  // Within a second: the refusal alone would stay for six.
  await page.keyboard.press('Escape');
  await expect(hintLine(page)).not.toHaveText(t('turnOnlyParts'), { timeout: 1000 });
  // Nothing is selected now: Delete says why, and Esc clears that too.
  await page.keyboard.press('Delete');
  await expect(hintLine(page)).toHaveText(t('deleteNothing'));
  await page.keyboard.press('Escape');
  await expect(hintLine(page)).not.toHaveText(t('deleteNothing'), { timeout: 1000 });
});
