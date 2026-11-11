/**
 * 4. Share links: the whole circuit in the link (decision 0008), with the link format and decoder
 * unchanged. A link carries the netlist exactly as it is (its *@ drawing lines when it has them,
 * decision 0016), so a link made in the app is the link make-link.ts makes for the same netlist. It
 * opens the same netlist in a new browser and, with run=1, runs it without pressing Run (however
 * many points it asks for); links made before this version, at the old address, still open; a
 * damaged link says why in plain words and the app keeps working.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { encodeShare, SHARE_TEXT } from '../../src/share/link.ts';
import { withDrawingBlock } from '../../src/notebook/schematic.ts';
import {
  drawnText,
  expectAnnounced,
  expectFinished,
  expectSolved,
  fixtureText,
  fullNetlistText,
  isPhone,
  netlistText,
  nodeTable,
  openApp,
  openCard,
  openNetlist,
  openShare,
  readPlain,
  rowNamed,
  runButton,
  setNetlist,
  shownText,
  statusLine,
  t,
  TYPING,
} from './helpers.ts';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const SHARED = '* Shared from a video: a 1meg divider\nV1 n1 0 6\nR1 n1 n2 1meg\nR2 n2 0 1meg\n.op\n.end\n';

/** Open the Share dialog and read the link from its field (the dialog stays open). */
async function makeLink(page: Page): Promise<{ link: string; dialog: Locator }> {
  const dialog = await openShare(page);
  const field = dialog.getByRole('textbox', { name: t('shareLinkLabel') });
  await expect(field).toHaveValue(/#c=.+&run=1$/);
  return { link: await field.inputValue(), dialog };
}

test('a share link opens the same netlist, drawn the same, in a new browser and solves it without pressing Run', async ({ page, browser }) => {
  await openApp(page);
  await setNetlist(page, SHARED);
  await expectSolved(page);
  const { link, dialog } = await makeLink(page);
  await expect(dialog.getByRole('checkbox', { name: t('shareRunOption') })).toBeChecked();
  await expect(dialog).toContainText(t('shareNote'));
  // The netlist as it is, nothing added: the same link make-link.ts makes for it.
  expect(link.endsWith(`#${await encodeShare(SHARED, { run: true })}`)).toBe(true);

  await dialog.getByRole('button', { name: t('shareCopy') }).click();
  await expectAnnounced(page, t('shareCopied'));
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // A new context has nothing saved: whatever opens came from the link.
  const elsewhere = await browser.newContext();
  try {
    const opened = await elsewhere.newPage();
    await opened.goto(link);
    await expectFinished(opened); // nobody pressed Run
    const n2 = rowNamed(nodeTable(opened), 'n2').getByRole('cell').first();
    expect(readPlain(await shownText(n2), 'V')).toBe(3);
    expect(await drawnText(opened)).toMatch(/=\s3\sV/);
    // The netlist, exactly as it was shared.
    expect(await fullNetlistText(opened)).toBe(SHARED);
    // Nothing is saved yet, and the link stays in the address until the student edits the circuit
    // (security review M4): a reload opens the link again, and the student's own netlist is safe.
    expect(new URL(opened.url()).hash).not.toBe('');
    expect(await opened.evaluate(() => localStorage.getItem('plainspice:netlist'))).toBeNull();
    // The first edit makes it the student's own: then it is saved, and the link leaves the address.
    const card = await openCard(opened, 'R2');
    const field = card.getByRole('textbox');
    await field.click();
    await field.press('ControlOrMeta+a');
    await field.pressSequentially('2meg', TYPING);
    await expect.poll(() => opened.evaluate(() => localStorage.getItem('plainspice:netlist'))).toContain('R2 n2 0 2meg');
    expect(new URL(opened.url()).hash).toBe('');
  } finally {
    await elsewhere.close();
  }
});

test('a link without run=1 opens the netlist and waits for Run', async ({ page, browser }) => {
  await openApp(page);
  await setNetlist(page, SHARED);
  const { dialog } = await makeLink(page);
  // Clicked on its words, as a person does (the box itself is drawn over a hidden input).
  await dialog.getByText(t('shareRunOption'), { exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: t('shareRunOption') })).not.toBeChecked();
  const field = dialog.getByRole('textbox', { name: t('shareLinkLabel') });
  await expect(field).not.toHaveValue(/run=1/);
  const link = await field.inputValue();

  const elsewhere = await browser.newContext();
  try {
    const opened = await elsewhere.newPage();
    await openApp(opened, link);
    await expect(statusLine(opened)).toContainText(t('statusNotRun'));
    await expect(statusLine(opened)).toContainText(t('statusNotRunDetail', { run: isPhone(opened) ? t('pressRunPhone') : t('pressRunDesk') }));
    // Run stands out while the link waits for it.
    await expect(runButton(opened)).toHaveClass(/\bis-wanted\b/);
    expect(await fullNetlistText(opened)).toBe(SHARED);
    expect(await drawnText(opened)).not.toMatch(/=\s3\sV/);
    await runButton(opened).click();
    await expectSolved(opened);
    expect(await drawnText(opened)).toMatch(/=\s3\sV/);
  } finally {
    await elsewhere.close();
  }
});

test('links made before this version open and run: the old address’s fragment, unchanged', async ({ page }) => {
  // Copied from tests/unit/share.test.ts ("published links open forever"): F1a, made by make-link
  // for https://ctbay1.github.io/plainspice/, which forwards to plainspice.com keeping the fragment.
  const OLD = 'https://ctbay1.github.io/plainspice/#c=z01JwM0y0UkhUMFMIUyjOLy1KTlVITC7KLy5WSFQwUsjPyFUoSi3OLC7JL-IKM1TIM1QwUDDjCoKyjLj08gu49FLzUrgA&run=1';
  await openApp(page, `./${new URL(OLD).hash}`);
  await expectFinished(page);
  const n1 = rowNamed(nodeTable(page), 'n1').getByRole('cell').first();
  expect(readPlain(await shownText(n1), 'V')).toBe(6);
  await openNetlist(page);
  expect(await netlistText(page)).toBe(fixtureText('f1a-voltage-source'));
});

test('a damaged link says why in plain words, and the app still works', async ({ page, browser }) => {
  await openApp(page);
  await setNetlist(page, SHARED);
  const { link } = await makeLink(page);
  // Cut short, as a link broken across two lines of a message would be.
  const damaged = link.replace(/&run=1$/, '').slice(0, -12);

  const elsewhere = await browser.newContext();
  try {
    const opened = await elsewhere.newPage();
    await openApp(opened, damaged);
    const notice = opened.getByRole('region', { name: t('shareProblemTitle') });
    await expect(notice).toBeVisible();
    const reason = (await notice.getByRole('paragraph').first().textContent()) ?? '';
    expect([SHARE_TEXT.cutShort, SHARE_TEXT.damaged]).toContain(reason);

    // Still usable: the first screen is open and solved.
    await expectSolved(opened);
    await expect(opened.getByRole('heading', { level: 1 })).toContainText('Start here');

    // Dismissed from the keyboard, the message goes and focus continues on the drawing.
    await notice.getByRole('button', { name: t('noticeClose') }).focus();
    await opened.keyboard.press('Enter');
    await expect(notice).toHaveCount(0);
    await expect.poll(() => opened.evaluate(() => document.activeElement?.closest('.nb-canvas') !== null)).toBe(true);
  } finally {
    await elsewhere.close();
  }
});

test('opening a link never replaces the netlist saved on this device (security review M4)', async ({ page, context }) => {
  // The student's own work, saved by the autosave.
  await openApp(page);
  await setNetlist(page, '* MY HOMEWORK\nV1 a 0 9\nR1 a 0 3\n.op\n.end\n');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('plainspice:netlist'))).toContain('MY HOMEWORK');
  // A video's link, opened in another tab of the same browser, looked at, closed.
  const video = await context.newPage();
  await video.goto(`./#${await encodeShare('* from a video\nV1 n1 0 6\nR1 n1 0 2\n.op\n.end\n', { run: true })}`);
  await expectSolved(video);
  await expect(video.getByRole('heading', { level: 1 })).toContainText('from a video');
  await video.close();
  // The next visit without a link opens the student's own netlist.
  const next = await context.newPage();
  await openApp(next);
  await expect(next.getByRole('heading', { level: 1 })).toContainText('MY HOMEWORK');
  if (!isPhone(next)) await expect(next.getByRole('complementary')).toHaveCount(0); // no first-screen note for the student's own work
});

test('a link with run=1 runs at once, even a netlist that asks for very many points; its *@ lines come with it', async ({ page }) => {
  // A million points: live runs would wait for Run, but the link asked to run.
  const LONG = '* A long run from a link\nV1 a 0 1\nR1 a b 1k\nC1 b 0 1u\n.tran 1u 1 0 1u\n.end\n';
  await page.goto(`./#${await encodeShare(LONG, { run: true })}`);
  const stop = page.getByRole('banner').getByRole('button', { name: t('stop'), exact: true });
  await expect(stop).toBeVisible({ timeout: 30_000 });
  await expect(statusLine(page)).not.toContainText(t('statusPaused'));
  await stop.click();
  await expect(statusLine(page)).toContainText(t('statusStopped'));

  // A netlist that has where its parts are drawn keeps it in the link.
  const drawn = withDrawingBlock(SHARED);
  await page.goto(`./#${await encodeShare(drawn, { run: true })}`);
  await expectSolved(page);
  expect(await fullNetlistText(page)).toBe(drawn);
});
