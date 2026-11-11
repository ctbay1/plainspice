/**
 * Live runs and the one netlist (decision 0016): the Netlist panel and the drawing change the same
 * text. Typing in the panel redraws the drawing at once (positions kept from the *@ lines, new parts
 * laid out) and ngspice solves it a moment later; the drawing lines are folded in the panel until
 * unfolded; a netlist that asks for very many points waits for Run, and the status line says why;
 * Stop stops a long run.
 */
import { expect, test } from '@playwright/test';
import { TYPING_PAUSE_MS } from '../../src/app/store.ts';
import { withDrawingBlock } from '../../src/notebook/schematic.ts';
import {
  drawnText,
  expectSolved,
  isPhone,
  netlistEditor,
  netlistText,
  openApp,
  openCard,
  openNetlist,
  partOnDrawing,
  runButton,
  RUN_TIMEOUT,
  setNetlist,
  setNetlistWithDrawing,
  START_HERE,
  statusLine,
  t,
  TYPING,
} from './helpers.ts';

test('typing in the Netlist panel redraws the drawing at once, and ngspice solves it a moment later', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  const editor = await openNetlist(page);
  expect(await netlistText(page)).toContain('R2 out 0 2k');
  // A new part, typed on a new line before .op.
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Home');
  await page.keyboard.type('R3 out 0 2k', TYPING);
  await page.keyboard.press('Enter');
  await expect(partOnDrawing(page, 'R3')).toHaveCount(1);
  // R2 ∥ R3 = 1 kΩ: out = 6 V × 1k / 2k = 3 V.
  await expect.poll(() => drawnText(page), { timeout: RUN_TIMEOUT }).toMatch(/=\s3\sV/);
  await expectSolved(page);
  // A value typed in the panel is the value on the drawing (the same text). After a pause in the
  // typing it is an undo step of its own.
  await page.waitForTimeout(TYPING_PAUSE_MS + 100);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  for (let i = 0; i < 2; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('6k', TYPING);
  await expect.poll(() => drawnText(page), { timeout: RUN_TIMEOUT }).toMatch(/6\skΩ/);
  // Ctrl+Z in the panel is the app's undo: the value goes back on the drawing too.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => netlistText(page)).toContain('R3 out 0 2k');
  await expect.poll(() => drawnText(page), { timeout: RUN_TIMEOUT }).not.toMatch(/6\skΩ/);
});

test('a value changed on the drawing changes its line in the Netlist panel, and nothing else; drawing lines are folded until shown', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  const card = await openCard(page, 'R2');
  const field = card.getByRole('textbox');
  await field.click();
  await field.press('ControlOrMeta+a');
  await field.pressSequentially('1k', TYPING);
  await expect.poll(() => drawnText(page), { timeout: RUN_TIMEOUT }).toMatch(/=\s3\sV/);
  await page.keyboard.press('Escape');
  if (isPhone(page)) await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /^R2 / })).toHaveCount(0);

  const region = page.getByRole('region', { name: t('panelNetlist'), exact: true });
  await openNetlist(page);
  // The value is on its line, and the netlist is otherwise as it was (nothing added).
  await expect.poll(() => netlistText(page)).toBe(START_HERE.replace('R2 out 0 2k', 'R2 out 0 1k'));
  // "This line": the cursor's line (the part chosen on the drawing), field by field.
  await expect(region.getByRole('heading', { name: /^Line 4: / })).toBeVisible();
  await expect(region.getByRole('table', { name: t('fieldTableCaption', { line: 4 }) })).toBeVisible();

  // A netlist with where its parts are drawn (*@ lines, as a link or a file brings them): folded.
  await setNetlistWithDrawing(page, withDrawingBlock(START_HERE));
  expect(await netlistText(page)).not.toContain('*@');
  await expect(region.getByText(/Drawing: \d+ lines, positions of the parts/)).toBeVisible();
  const show = region.getByRole('button', { name: /^Show the \d+ drawing lines$/ });
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await show.click();
  await expect.poll(() => netlistText(page)).toMatch(/^\*@ R2 /m);
  await region.getByRole('button', { name: t('drawingHide') }).click();
  await expect.poll(() => netlistText(page)).not.toContain('*@');
  await expect(netlistEditor(page)).toBeVisible();
});

test('a netlist that asks for very many points waits for Run; fewer points and it runs live again; Stop stops a long run', async ({ page }) => {
  await openApp(page);
  // 1 s in steps of at most 1 µs: a million points.
  await setNetlist(page, '* A long .tran\nV1 a 0 1\nR1 a b 1k\nC1 b 0 1u\n.tran 1u 1 0 1u\n.end\n');
  await expect(statusLine(page)).toContainText(t('statusPaused'));
  await expect(statusLine(page)).toContainText(
    t('statusPausedLong', { points: '1,000,000', run: isPhone(page) ? t('pressRunPhone') : t('pressRunDesk') }),
  );
  // Run stands out while live runs wait for it.
  await expect(runButton(page)).toHaveClass(/\bis-wanted\b/);

  // Run runs it anyway; it takes long, so Run becomes Stop, and Stop stops it.
  await runButton(page).click();
  const stop = page.getByRole('banner').getByRole('button', { name: t('stop'), exact: true });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(statusLine(page)).toContainText(t('statusStopped'));
  await expect(statusLine(page)).toContainText(t('statusPausedStopped', { run: isPhone(page) ? t('pressRunPhone') : t('pressRunDesk') }));
  await expect(runButton(page)).toBeVisible();

  // Fewer points: Run solves it, and live runs are on again (ngspice loads again after a Stop).
  await setNetlist(page, '* A short .tran\nV1 a 0 1\nR1 a b 1k\nC1 b 0 1u\n.tran 10u 5m\n.end\n');
  await runButton(page).click();
  await expectSolved(page);
  await setNetlist(page, '* A short .tran, changed\nV1 a 0 2\nR1 a b 1k\nC1 b 0 1u\n.tran 10u 5m\n.end\n');
  await expectSolved(page);
  // A netlist changed from many points to fewer runs live again by itself.
  await setNetlist(page, '* Long again\nV1 a 0 1\nR1 a b 1k\nC1 b 0 1u\n.tran 1u 1 0 1u\n.end\n');
  await expect(statusLine(page)).toContainText(t('statusPaused'));
  await setNetlist(page, '* Short again\nV1 a 0 1\nR1 a b 1k\nC1 b 0 1u\n.tran 10u 5m\n.end\n');
  await expectSolved(page);
});
