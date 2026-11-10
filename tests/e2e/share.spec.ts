/**
 * 4. Share links: the whole circuit in the link (decision 0008). A link opens the same netlist in
 * a new browser and, with run=1, simulates it without pressing Run; a damaged link says why in
 * plain words and the app keeps working.
 */
import { expect, test, type Page } from '@playwright/test';
import { encodeShare, SHARE_TEXT } from '../../src/share/link.ts';
import {
  expectAnnounced,
  expectFinished,
  netlistEditor,
  netlistText,
  nodeTable,
  openApp,
  readPlain,
  rowNamed,
  runAndExpectFinished,
  setNetlist,
  shownText,
  t,
  TYPING,
} from './helpers.ts';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const SHARED = '* Shared from a video: a 1meg divider\nV1 n1 0 6\nR1 n1 n2 1meg\nR2 n2 0 1meg\n.op\n.end\n';

/** Open the Share dialog and read the link from its field (the dialog stays open). */
async function makeLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: t('share') }).click();
  const dialog = page.getByRole('dialog', { name: t('shareTitle') });
  const field = dialog.getByRole('textbox', { name: t('shareLinkLabel') });
  await expect(field).toHaveValue(/#c=.+&run=1$/);
  return field.inputValue();
}

test('a share link opens the same netlist in a new browser and runs it without pressing Run', async ({ page, browser }) => {
  await openApp(page);
  await setNetlist(page, SHARED);
  const link = await makeLink(page);
  const dialog = page.getByRole('dialog', { name: t('shareTitle') });
  await expect(dialog.getByRole('checkbox', { name: t('shareRunOption') })).toBeChecked();
  await expect(dialog).toContainText(t('shareNote'));

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
    expect(await netlistText(opened)).toBe(SHARED);
    const n2 = rowNamed(nodeTable(opened), 'n2').getByRole('cell').first();
    expect(readPlain(await shownText(n2), 'V')).toBe(3);
    // Nothing is saved yet, and the link stays in the address until the student edits the circuit
    // (security review M4): a reload opens the link again, and the student's own netlist is safe.
    expect(new URL(opened.url()).hash).not.toBe('');
    expect(await opened.evaluate(() => localStorage.getItem('plainspice:netlist'))).toBeNull();
    // The first edit makes it the student's own: then it is saved, and the link leaves the address.
    await netlistEditor(opened).click();
    await opened.keyboard.press('ControlOrMeta+End');
    await opened.keyboard.type('* mine', TYPING);
    await expect.poll(() => opened.evaluate(() => localStorage.getItem('plainspice:netlist'))).toContain('* mine');
    expect(new URL(opened.url()).hash).toBe('');
  } finally {
    await elsewhere.close();
  }
});

test('a link without run=1 opens the netlist and waits for Run', async ({ page, browser }) => {
  await openApp(page);
  await setNetlist(page, SHARED);
  await makeLink(page);
  const dialog = page.getByRole('dialog', { name: t('shareTitle') });
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
    expect(await netlistText(opened)).toBe(SHARED);
    await expect(opened.getByText(t('resultsEmpty'))).toBeVisible();
  } finally {
    await elsewhere.close();
  }
});

test('a damaged link says why in plain words, and the app still works', async ({ page, browser }) => {
  await openApp(page);
  await setNetlist(page, SHARED);
  const link = await makeLink(page);
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

    // Still usable: the first example is open and runs.
    await expect.poll(() => netlistText(opened)).toContain('* F5');
    await runAndExpectFinished(opened);

    // Dismissed from the keyboard, the message goes and focus continues in the netlist below it.
    await notice.getByRole('button', { name: t('noticeClose') }).focus();
    await opened.keyboard.press('Enter');
    await expect(notice).toHaveCount(0);
    await expect(netlistEditor(opened)).toBeFocused();
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
  await expectFinished(video);
  expect(await netlistText(video)).toContain('from a video');
  await video.close();
  // The next visit without a link opens the student's own netlist.
  const next = await context.newPage();
  await openApp(next);
  expect(await netlistText(next)).toContain('MY HOMEWORK');
});
