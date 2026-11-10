/**
 * 6. Keyboard only (WCAG 2.1.1, decision 0010): no mouse from start to end. Tab order follows the
 * page (skip link, the toolbar with Run first, the editor); the editor takes typing and Ctrl+Enter
 * and lets Tab out; arrow keys move between tabs and toolbar buttons; a fix works with Enter; menus
 * and dialogs close with Escape and give focus back to the button that opened them.
 */
import { expect, test } from '@playwright/test';
import { chooseExample, expectFinished, netlistEditor, netlistText, openApp, runButton, t, tab, TYPING } from './helpers.ts';

test('keyboard only: skip link, Run, the editor, Ctrl+Enter, the tabs, a fix, menus and dialogs', async ({ page }) => {
  await openApp(page);
  const press = (key: string): Promise<void> => page.keyboard.press(key);

  // From the top: the skip link, then the toolbar (one Tab stop, Run first), then the editor.
  await press('Tab');
  await expect(page.getByRole('link', { name: t('skipToNetlist') })).toBeFocused();
  await press('Tab');
  await expect(runButton(page)).toBeFocused();
  await press('Tab');
  const editor = netlistEditor(page);
  await expect(editor).toBeFocused();

  // Typing works: a new line before .end, here with a trap in it (1M is a milliohm).
  await press('ControlOrMeta+End');
  await press('ArrowUp');
  await press('Home');
  await page.keyboard.type('R9 a 0 1M', TYPING);
  await press('Enter');
  await expect.poll(() => netlistText(page)).toMatch(/\nR9 a 0 1M\n\.end\n$/);
  const checks = tab(page, /^Checks/);
  await expect(checks).toHaveText(t('tabChecks', { count: 1 }));

  // Ctrl+Enter runs, and the cursor stays in the editor.
  await press('Control+Enter');
  await expectFinished(page);
  await expect(editor).toBeFocused();

  // Tab leaves the editor (it never types a tab) and reaches the selected tab; arrows switch tabs.
  await press('Tab');
  await expect(tab(page, t('tabResults'))).toBeFocused();
  await press('ArrowLeft');
  await expect(checks).toBeFocused();
  await expect(checks).toHaveAttribute('aria-selected', 'true');
  await press('ArrowRight');
  await expect(tab(page, t('tabResults'))).toHaveAttribute('aria-selected', 'true');
  await press('ArrowLeft');

  // Into the Checks panel: the trap's "Line 8" button, then its first fix; Enter applies the fix.
  await press('Tab');
  await expect(page.getByRole('button', { name: t('goToLine', { line: 8 }) })).toBeFocused();
  await press('Tab');
  await expect(page.getByRole('button', { name: /1meg/ })).toBeFocused();
  await press('Enter');
  await expect.poll(() => netlistText(page)).toMatch(/\nR9 a 0 1meg\n\.end\n$/);
  await expect(checks).toHaveText(t('tabChecks', { count: 0 }));
  // The button went away with its trap; focus stays in the panel, on its heading, not at the top of the page.
  await expect(page.getByRole('heading', { name: t('checksHeading') })).toBeFocused();

  // Back to the toolbar: Shift+Tab goes back through the panel (focusable now that it has no
  // buttons, so its text can be scrolled and read), the tab and the editor.
  await press('Shift+Tab');
  await expect(page.getByRole('tabpanel')).toBeFocused();
  await press('Shift+Tab');
  await expect(checks).toBeFocused();
  await press('Shift+Tab');
  await expect(editor).toBeFocused();
  await press('Shift+Tab');
  await expect(runButton(page)).toBeFocused();

  // The Examples menu: arrow keys open it and move through it, Enter chooses, focus comes back.
  // Its first items are the first video's (SPICE for Beginners): examples/examples.json.
  const [FIRST, SECOND] = ['Example 1', 'Example 1 with a 0 V ammeter'];
  const examples = page.getByRole('button', { name: t('examples') });
  await press('ArrowRight');
  await expect(examples).toBeFocused();
  await press('ArrowDown');
  const menu = page.getByRole('menu', { name: t('examplesMenu') });
  await expect(menu.getByRole('menuitem', { name: FIRST, exact: true })).toBeFocused();
  await press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(examples).toBeFocused();
  await press('Enter');
  await expect(menu.getByRole('menuitem', { name: FIRST, exact: true })).toBeFocused();
  await press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: SECOND, exact: true })).toBeFocused();
  await press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(examples).toBeFocused();
  await expect.poll(() => netlistText(page)).toMatch(/^\* SPICE for Beginners, example 1 with a 0 V ammeter/);

  // Dialogs: Enter opens, focus goes inside, Escape closes and focus returns to the button.
  for (const [button, title, steps] of [
    [t('share'), t('shareTitle'), 1],
    [t('settings'), t('settingsTitle'), 2],
    [t('help'), t('helpTitle'), 1],
  ] as const) {
    for (let i = 0; i < steps; i++) await press('ArrowRight');
    const opener = page.getByRole('button', { name: button, exact: true });
    await expect(opener).toBeFocused();
    await press('Enter');
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement)), `focus is inside the ${title} dialog`).toBe(true);
    await press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
});

test('a fix chosen in the editor\'s own pop-up (F8, Tab, Enter) leaves focus in the netlist (a11y review F3)', async ({ page }) => {
  await openApp(page);
  await chooseExample(page, t('exampleF3a'));
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
