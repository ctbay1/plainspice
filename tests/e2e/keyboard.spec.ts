/**
 * 6. Keyboard only (WCAG 2.1.1, decision 0010): no mouse from start to end. The skip link reaches
 * the drawing; arrow keys move along its wires from part to node to part (src/schematic
 * navigate.ts); Enter opens a part's card and Escape closes it, giving focus back to the part;
 * Ctrl+K reaches every command; the top bar, the actions and the parts are one Tab stop each with
 * arrow keys inside; panels take the focus to their heading and give it back to their tab; a fix
 * works with Enter; menus and dialogs close with Escape and give focus back to their button.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  checksCount,
  drawing,
  drawnText,
  expectAnnounced,
  expectSolved,
  hintLine,
  isPhone,
  netlistEditor,
  netlistText,
  openApp,
  panel,
  panelTab,
  partOnDrawing,
  runButton,
  RUN_TIMEOUT,
  t,
  TYPING,
} from './helpers.ts';

/** Start the Tab order again from the top of the page: the skip link (as after a reload). */
async function fromTheTop(page: Page): Promise<void> {
  await page.getByRole('link', { name: t('skipToDrawing') }).focus();
}

test('keyboard only on a computer: the drawing, a card, Ctrl+K, panels, a fix, the parts, menus and dialogs', async ({ page }) => {
  test.skip(isPhone(page), 'the phone has its own layout (next test)');
  await openApp(page);
  await expectSolved(page);
  const press = (key: string): Promise<void> => page.keyboard.press(key);

  // The skip link, then the drawing: arrow keys along the wires.
  await press('Tab');
  await expect(page.getByRole('link', { name: t('skipToDrawing') })).toBeFocused();
  await press('Enter');
  await expect(drawing(page).getByRole('button', { name: 'Node in' })).toBeFocused();
  await press('ArrowRight');
  const r1 = partOnDrawing(page, 'R1');
  await expect(r1).toBeFocused();
  // Selected is where you are (aria-current), not a toggle; a part opens its card (a dialog).
  await expect(r1).toHaveAttribute('aria-current', 'true');
  await expect(r1).not.toHaveAttribute('aria-pressed', /.*/);
  await expect(r1).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(r1).toHaveAttribute('aria-expanded', 'false');
  await expect(hintLine(page)).toHaveText(t('hintSelected', { name: 'R1' }));
  await press('ArrowRight');
  await expect(drawing(page).getByRole('button', { name: 'Node out' })).toBeFocused();
  await press('ArrowLeft');
  await expect(r1).toBeFocused();

  // Enter opens R1's card on its value; typing solves again; Escape closes it, back on R1.
  await press('Enter');
  const card = page.getByRole('dialog', { name: /^R1 / });
  await expect(card.getByRole('textbox')).toBeFocused();
  await expect(r1).toHaveAttribute('aria-expanded', 'true');
  await press('ControlOrMeta+a');
  await page.keyboard.type('2k', TYPING);
  await expect.poll(() => drawnText(page), { timeout: RUN_TIMEOUT }).toMatch(/=\s3\sV/);
  // With the card open, the arrow keys on the drawing still move along the wires: a part's card
  // follows the selection, and the focus stays on the drawing (never pulled into the card's field).
  await r1.focus();
  await press('ArrowDown');
  const moved = page.locator(':focus');
  await expect(moved).toHaveClass(/\bnb-hit\b/);
  if ((await moved.getAttribute('aria-haspopup')) === 'dialog') await expect(moved).toHaveAttribute('aria-expanded', 'true');
  await r1.focus();
  await press('Enter');
  await expect(card.getByRole('textbox')).toBeFocused();
  await press('Escape');
  await expect(card).toHaveCount(0);
  await expect(r1).toBeFocused();
  // Ctrl+Z undoes it from the drawing, and says what it undid.
  await press('ControlOrMeta+z');
  await expectAnnounced(page, t('undoneWhat', { what: t('valueLabel', { name: 'R1', value: '2k' }) }));
  await expect.poll(() => drawnText(page), { timeout: RUN_TIMEOUT }).toMatch(/=\s4\sV/);
  // Escape lets go of the selection.
  await press('Escape');
  await expect(r1).not.toHaveAttribute('aria-current', /.*/);

  // Ctrl+K: every command; Enter runs the one chosen. A panel takes the focus to its heading; Escape
  // closes it and gives the focus back to its tab.
  await press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: t('paletteTitle') });
  const search = palette.getByRole('combobox', { name: t('paletteLabel') });
  await expect(search).toBeFocused();
  await page.keyboard.type('numbers', TYPING);
  await expect(palette.getByRole('option', { selected: true })).toContainText(t('paletteOpenPanel', { panel: t('panelNumbers') }));
  await press('Enter');
  await expect(palette).toHaveCount(0);
  const numbers = panel(page, 'numbers');
  await expect(numbers.getByRole('heading', { level: 2, name: t('panelNumbers') })).toBeFocused();
  await press('Escape');
  await expect(numbers).toHaveCount(0);
  await expect(panelTab(page, 'numbers')).toBeFocused();

  // The Netlist panel: Enter on its tab, Tab to the editor; typing (here a trap: 1M is a milliohm);
  // Ctrl+Enter runs and the cursor stays; Tab leaves the editor (it never types a tab).
  await press('Shift+Tab');
  await press('Shift+Tab');
  await press('Shift+Tab');
  await expect(panelTab(page, 'netlist')).toBeFocused();
  await press('Enter');
  const netlist = panel(page, 'netlist');
  await expect(netlist.getByRole('heading', { level: 2, name: t('panelNetlist') })).toBeFocused();
  const editor = netlistEditor(page);
  for (let i = 0; i < 4 && !(await editor.evaluate((e) => e === document.activeElement)); i++) await press('Tab');
  await expect(editor).toBeFocused();
  await press('ControlOrMeta+End');
  await press('ArrowUp');
  await press('Home');
  await page.keyboard.type('R9 out 0 1M', TYPING);
  await press('Enter');
  await expect.poll(() => netlistText(page)).toMatch(/\nR9 out 0 1M\n\.end\n?$/);
  await expect.poll(() => checksCount(page)).toBe(1);
  await press('Control+Enter');
  await expectSolved(page);
  await expect(editor).toBeFocused();
  await press('Tab');
  await expect(editor).not.toBeFocused();

  // A fix with the keyboard: Ctrl+K to the Checks panel, Tab to the trap's fix, Enter.
  await press('ControlOrMeta+k');
  await page.keyboard.type('checks', TYPING);
  await press('Enter');
  const checks = panel(page, 'checks');
  await expect(checks.getByRole('heading', { level: 2, name: t('panelChecks') })).toBeFocused();
  // Past the close button and the panel's scrolling box, its trap: "Go to line 7", then the fixes.
  for (let i = 0; i < 8 && !(await page.evaluate(() => document.activeElement?.tagName === 'BUTTON' && /1meg/.test(document.activeElement.textContent ?? ''))); i++) await press('Tab');
  await expect(checks.getByRole('button', { name: /1meg/ })).toBeFocused();
  await press('Enter');
  await expect.poll(() => checksCount(page)).toBe(0);
  // The button went away with its trap: focus stays in the panel, on its heading, not at the top of the page.
  await expect(checks.getByRole('heading', { level: 2, name: t('panelChecks') })).toBeFocused();
  await press('Escape');
  await expect(checks).toHaveCount(0);

  // The top of the page: the Examples menu opens with the arrow keys, Escape gives the focus back.
  await fromTheTop(page);
  await press('Tab');
  const examples = page.getByRole('button', { name: t('examples') });
  await expect(examples).toBeFocused();
  await press('ArrowDown');
  const menu = page.getByRole('menu', { name: t('examplesMenu') });
  await expect(menu.getByRole('menuitem', { name: t('exampleStart'), exact: true })).toBeFocused();
  await press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Example 1', exact: true })).toBeFocused();
  await press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(examples).toBeFocused();

  // Undo and Redo are in the Tab order now that there is something to undo; then Ctrl+K's button,
  // then the actions: one Tab stop, arrow keys between Share, Export, Help, Settings and Run.
  await press('Tab');
  await expect(page.getByRole('button', { name: t('undo') })).toBeFocused();
  // Redo is not: the fix was the last change, so there is nothing to redo (a disabled button is no Tab stop).
  await expect(page.getByRole('button', { name: t('redo') })).toBeDisabled();
  await press('Tab');
  // (Its words hide on a narrower screen; its name stays.)
  await expect(page.getByRole('banner').getByRole('button', { name: t('paletteButton') })).toBeFocused();
  await press('Tab');
  const actions = page.getByRole('toolbar', { name: t('actionsLabel') });
  await expect(actions.getByRole('button', { name: t('share') })).toBeFocused();
  for (const [button, title, moves] of [
    [t('share'), t('shareTitle'), 0],
    [t('help'), t('helpTitle'), 2],
    [t('settings'), t('settingsTitle'), 1],
  ] as const) {
    for (let i = 0; i < moves; i++) await press('ArrowRight');
    const opener = actions.getByRole('button', { name: button, exact: true });
    await expect(opener).toBeFocused();
    await press('Enter');
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement)), `focus is inside the ${title} dialog`).toBe(true);
    await press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
  await press('ArrowRight');
  await expect(runButton(page)).toBeFocused();
  await press('Enter');
  await expectSolved(page);

  // The parts: one Tab stop; a letter puts a part in hand, and the hint says what to do and how to
  // get out (decision 0017); Escape goes back to Select.
  await press('Tab');
  const tools = page.getByRole('toolbar', { name: t('partsLabel') });
  await expect(tools.getByRole('button', { name: t('toolSelect') })).toBeFocused();
  await press('ArrowDown');
  await expect(tools.getByRole('button', { name: t('toolWire') })).toBeFocused();
  await press('r');
  await expect(tools.getByRole('button', { name: 'Resistor' })).toHaveAttribute('aria-pressed', 'true');
  // The toolbar's tab stop follows the tool chosen by its key (Enter next is not Select), and the hint
  // gives the keyboard's way to place it.
  await expect(tools.getByRole('button', { name: 'Resistor' })).toBeFocused();
  await expect(hintLine(page)).toHaveText(t('hintPlaceKeys', { part: 'a resistor' }));
  await press('Escape');
  await expect(tools.getByRole('button', { name: t('toolSelect') })).toHaveAttribute('aria-pressed', 'true');
});

test('keyboard only on a phone with a keyboard: the top bar, the drawing, the bottom bar and its sheets', async ({ page }) => {
  test.skip(!isPhone(page), 'the computer layout is the test above');
  await openApp(page);
  await expectSolved(page);
  const press = (key: string): Promise<void> => page.keyboard.press(key);
  await press('Tab');
  await expect(page.getByRole('link', { name: t('skipToDrawing') })).toBeFocused();
  await press('Tab');
  await expect(page.getByRole('button', { name: /^Examples: Start here/ })).toBeFocused();
  await press('Tab');
  await expect(page.getByRole('button', { name: t('paletteLabel') })).toBeFocused();
  await press('Tab');
  await expect(page.getByRole('banner').getByRole('button', { name: t('settings') })).toBeFocused();
  await press('Tab');
  await expect(runButton(page)).toBeFocused();
  await press('Tab');
  await expect(drawing(page).getByRole('button', { name: 'Node in' })).toBeFocused();
  await press('ArrowRight');
  await expect(partOnDrawing(page, 'R1')).toBeFocused();
  await press('Enter');
  const card = page.getByRole('dialog', { name: /^R1 / });
  await expect(card).toBeVisible();
  await press('Escape');
  await expect(card).toHaveCount(0);
  await expect(partOnDrawing(page, 'R1')).toBeFocused();
  // The bottom bar: Select, Parts, Netlist, Checks, Explain, More.
  const bar = page.getByRole('navigation', { name: t('barLabel') });
  for (let i = 0; i < 12 && !(await bar.getByRole('button', { name: t('barMore') }).evaluate((b) => b === document.activeElement)); i++) await press('Tab');
  await expect(bar.getByRole('button', { name: t('barMore') })).toBeFocused();
  await press('Enter');
  const more = page.getByRole('dialog', { name: t('barMore') });
  await expect(more).toBeVisible();
  await press('Escape');
  await expect(more).toHaveCount(0);
});

test('a fix chosen in the editor’s own pop-up (F8, Tab, Enter) leaves focus in the netlist (a11y review F3)', async ({ page }) => {
  await openApp(page);
  await page.getByRole('banner').getByRole('button', { name: new RegExp(`^${t('examples')}`) }).click();
  await page.getByRole('menu', { name: t('examplesMenu') }).getByRole('menuitem', { name: t('exampleF3a'), exact: true }).click();
  await panelTab(page, 'netlist').click();
  await netlistEditor(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('F8');
  const popUp = page.locator('.cm-tooltip-lint');
  await expect(popUp).toBeVisible();
  // F8 also says the trap in words, for screen readers.
  await expect(page.locator('.cm-announced')).toContainText(/Warning, line 3:/);
  await page.keyboard.press('Tab');
  await expect(popUp.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => netlistText(page)).toContain('R1 n1 n2 1meg');
  await expect(netlistEditor(page)).toBeFocused();
});
