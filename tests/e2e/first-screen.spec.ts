/**
 * 0. The first screen (decision 0016): a first visit opens Start here, a 6 V source and two
 * resistors, already solved, with a sticky note (on a phone, the hint line) inviting the student to
 * change R1 and watch the numbers move. Changing R1 on its card runs ngspice again as the value is
 * typed; the old numbers are crossed out; one Undo puts the whole change back; a reload keeps the
 * student's change.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { drawing, drawnText, expectAnnounced, expectSolved, hintLine, isPhone, openApp, openCard, partOnDrawing, runButton, START_HERE, statusLine, t, TYPING } from './helpers.ts';

/** The boxes of the drawn parts (their buttons), on the screen. */
async function partBoxes(page: Page): Promise<{ x: number; y: number; width: number; height: number }[]> {
  const boxes = [];
  for (const name of ['V1', 'R1', 'R2']) boxes.push((await partOnDrawing(page, name).boundingBox())!);
  return boxes;
}
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('a first visit opens Start here already solved, inviting a change to R1', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Start here: change R1 and watch the numbers move');
  // out = 6 V × 2k / 3k = 4 V, 2 mA through R1 and R2, written on the drawing.
  const drawn = await drawnText(page);
  expect(drawn).toMatch(/=\s6\sV/);
  expect(drawn).toMatch(/=\s4\sV/);
  expect(drawn).toMatch(/2\smA/);
  await expect(drawing(page).getByRole('button', { name: 'Node out' })).toHaveAccessibleDescription(/out is 4 volts/);
  await expectAnnounced(page, /out is 4 volts/);
  // No Run was needed, and nothing is saved for a circuit just opened.
  expect(await page.evaluate(() => localStorage.getItem('plainspice:netlist'))).toBeNull();

  if (isPhone(page)) {
    await expect(hintLine(page)).toHaveText(t('hintInvitePhone', { name: 'R1' }));
    return;
  }
  const note = page.getByRole('complementary', { name: t('noteTitle', { name: 'R1' }) });
  await expect(note).toBeVisible();
  await expect(note).toContainText(t('noteText'));
  // The note is beside the drawing, never over a part.
  const box = (await note.boundingBox())!;
  for (const part of await partBoxes(page)) expect(overlaps(box, part), 'the note covers no part').toBe(false);
  // Hidden, it stays hidden for this circuit.
  await note.getByRole('button', { name: t('noteHide') }).click();
  await expect(note).toHaveCount(0);
});

test('change R1 on its card: the numbers move as you type, the old ones are crossed out; Undo, Redo and a reload', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  const card = isPhone(page) ? await openCard(page, 'R1') : await (async () => {
    await page.getByRole('button', { name: t('noteButton', { name: 'R1' }) }).click();
    const c = page.getByRole('dialog', { name: /^R1 / });
    await expect(c).toBeVisible();
    return c;
  })();
  await expect(card).toContainText('resistor');
  const field = card.getByRole('textbox');
  await expect(field).toHaveValue('1k');
  if (!isPhone(page)) await expect(field).toBeFocused();
  // On a computer the card is beside R1 and covers none of the parts.
  if (!isPhone(page)) {
    const box = (await card.boundingBox())!;
    for (const part of await partBoxes(page)) expect(overlaps(box, part), 'the card covers no part').toBe(false);
  }

  await field.click();
  await field.press('ControlOrMeta+a');
  await field.pressSequentially('2k', TYPING);
  // ngspice runs a moment later: out = 6 V × 2k / 4k = 3 V; R1 now carries 1.5 mA.
  await expect.poll(() => drawnText(page), { timeout: 30_000 }).toMatch(/=\s3\sV/);
  await expect(card.getByText(t('cardReads'))).toContainText(/2\skΩ/);
  // The old numbers, crossed out beside the new ones on the drawing (and on a computer's card too),
  // and the value it was, with a button to put it back.
  expect(await drawnText(page)).toMatch(/4\sV/);
  if (!isPhone(page)) await expect(card.locator('s').filter({ hasText: /4\sV|2\smA/ }).first()).toBeVisible();
  await expect(card.getByRole('button', { name: t('cardPutBack', { value: '1k' }) })).toBeVisible();

  // Enter closes the card (on a phone, Done first).
  if (isPhone(page)) await card.getByRole('button', { name: t('cardDone') }).click();
  else await field.press('Enter');
  if (isPhone(page)) await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /^R1 / })).toHaveCount(0);
  await expectSolved(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('plainspice:netlist'))).toContain('R1 in out 2k');

  // Undo puts the whole card's change back (one step), and ngspice solves it again at once.
  const undo = isPhone(page) ? undefined : page.getByRole('button', { name: t('undo') });
  if (undo) await undo.click();
  else await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => drawnText(page), { timeout: 30_000 }).toMatch(/=\s4\sV/);
  await expectAnnounced(page, t('undone'));
  if (!isPhone(page)) {
    await page.getByRole('button', { name: t('redo') }).click();
    await expect.poll(() => drawnText(page), { timeout: 30_000 }).toMatch(/=\s3\sV/);
  } else {
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(() => drawnText(page), { timeout: 30_000 }).toMatch(/=\s3\sV/);
  }

  // A reload opens the student's own circuit and runs it. Only the value changed: nothing was
  // added to the netlist (the drawing did not move, so no *@ lines were needed).
  await page.reload();
  await expectSolved(page);
  expect(await drawnText(page)).toMatch(/=\s3\sV/);
  const saved = (await page.evaluate(() => localStorage.getItem('plainspice:netlist'))) ?? '';
  expect(saved).toBe(START_HERE.replace('1k', '2k'));
  await expect(statusLine(page)).toContainText(/Finished in/);
  await expect(runButton(page)).toBeEnabled();
});

/** The saved netlist's line for a part (the autosave follows a moment after each change). */
async function savedLine(page: Page, name: string): Promise<string> {
  await page.waitForTimeout(700);
  const saved = (await page.evaluate(() => localStorage.getItem('plainspice:netlist'))) ?? START_HERE;
  return saved.split('\n').find((l) => l.startsWith(`${name} `)) ?? '';
}

test('typing on a card never leaves stray words in the netlist; a value SPICE cannot read stays in the field, with why and a fix; Put back restores the line', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  const type = async (name: string, keys: string): Promise<Locator> => {
    const card = await openCard(page, name);
    const field = card.getByRole('textbox');
    await field.click();
    await field.press('ControlOrMeta+a');
    await field.pressSequentially(keys, TYPING);
    return card;
  };
  const close = async (): Promise<void> => {
    await page.keyboard.press('Escape');
    if (isPhone(page)) await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };

  // A negative source, typed key by key: the "-" on the way leaves nothing behind.
  let card = await type('V1', '-12');
  await expect(card.getByText(t('cardReads'))).toContainText(/−12\sV/);
  expect(await savedLine(page, 'V1')).toBe('V1 in 0 -12');
  await card.getByRole('button', { name: t('cardPutBack', { value: '6' }) }).click();
  expect(await savedLine(page, 'V1')).toBe('V1 in 0 6');
  await close();

  // A decimal comma (a Turkish phone's decimal key): SPICE reads the comma as a space. It stays in
  // the field, marked invalid, with the checks' own words and their fix; the netlist keeps a value
  // SPICE reads.
  card = await type('R1', '4,7k');
  const field = card.getByRole('textbox');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(card).toContainText('4,7k: SPICE reads the comma as a space');
  expect(await savedLine(page, 'R1')).not.toContain(',');
  await card.getByRole('button', { name: 'Write 4.7k' }).click();
  await expect(field).toHaveValue('4.7k');
  await expect(field).not.toHaveAttribute('aria-invalid', /.*/);
  expect(await savedLine(page, 'R1')).toBe('R1 in out 4.7k');
  // Put back gives the line exactly as it was.
  await card.getByRole('button', { name: t('cardPutBack', { value: '1k' }) }).click();
  expect(await savedLine(page, 'R1')).toBe('R1 in out 1k');
  await close();

  // A word SPICE cannot use, then a value: only the value is in the netlist, and the numbers are back.
  card = await type('R1', 'abc');
  await expect(card).toContainText("SPICE can't use abc on this line");
  await card.getByRole('textbox').press('ControlOrMeta+a');
  await card.getByRole('textbox').pressSequentially('2k', TYPING);
  await expect.poll(() => drawnText(page), { timeout: 30_000 }).toMatch(/=\s3\sV/);
  expect(await savedLine(page, 'R1')).toBe('R1 in out 2k');
  // (A phone's card sheet stands where the status line was: it comes back with the card closed.)
  await close();
  await expectSolved(page);
});
