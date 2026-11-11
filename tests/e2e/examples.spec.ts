/**
 * 2b. The Examples menu: Start here first, then every circuit of the channel's videos, opened from
 * the menu and solved at once in the browser. Each is drawn (every part a named button on the
 * drawing) and its numbers in the Numbers panel are the ones the channel recorded with native
 * ngspice when it made the video (examples/examples.json; tests/golden/examples.test.ts checks the
 * same in Node). The three "mistake" examples of SPICE for Beginners show the check they teach.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { checksCount, chooseExample, drawnText, examplesButton, expectFinished, expectShown, expectSolved, openApp, openPanel, partOnDrawing, rawfileName, statusLine, t } from './helpers.ts';

interface Manifest {
  examples: { id: string; video: string; file: string; name: string; expect: Record<string, number> }[];
}
const ROOT = resolve(import.meta.dirname, '../..');
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'examples/examples.json'), 'utf8')) as Manifest;
const partsOf = (file: string): string[] =>
  readFileSync(resolve(ROOT, 'examples', file), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Za-z]/.test(l))
    .map((l) => l.split(/\s+/)[0]!);

test('the Examples menu starts with Start here, then the videos in channel order', async ({ page }) => {
  await openApp(page);
  await examplesButton(page).click();
  const menu = page.getByRole('menu', { name: t('examplesMenu') });
  const items = menu.getByRole('menuitem');
  await expect(items.first()).toHaveAccessibleName(t('exampleStart'));
  await expect(items.nth(1)).toHaveAccessibleName(manifest.examples[0]!.name);
  await expect(items).toHaveCount(1 + manifest.examples.length + 10);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

for (const e of manifest.examples) {
  test(`${e.id}: opened from the menu, drawn, and solved as in the video`, async ({ page }) => {
    // The menu is long: the desktop project checks every example, the phone project a sample.
    test.skip(test.info().project.name === 'phone' && !/^(sp01-3|p02-4|e04-6|sp01-4)/.test(e.id), 'a sample on the phone');
    await openApp(page);
    await chooseExample(page, e.name);
    for (const name of partsOf(e.file)) await expect(partOnDrawing(page, name), `${name} is drawn`).toHaveCount(1);
    const expected = Object.entries(e.expect);
    if (expected.length === 0) {
      // A mistake example: the check it teaches is found before any run.
      await expect.poll(() => checksCount(page)).toBeGreaterThan(0);
      await expect(statusLine(page)).toHaveAttribute('data-tone', /^(ok|bad)$/, { timeout: 30_000 });
      return;
    }
    await expectFinished(page);
    for (const [vector, value] of expected) await expectShown(page, rawfileName(vector), value, `${vector} (the channel's native ngspice)`);
    if (expected.some(([vector]) => vector.startsWith('output_impedance'))) {
      // A .tf has no node voltages to write on the drawing: its ratios are on a card on the paper.
      await expect(page.getByRole('region', { name: t('resultsCardTf') })).toBeVisible();
    } else {
      // Its node voltages are written on the drawing, in plain units.
      expect(await drawnText(page)).toMatch(/=\s[−-]?\d/);
    }
  });
}

test('Start here, opened again from the menu, is solved and invites a change to R1 again', async ({ page }) => {
  await openApp(page);
  await chooseExample(page, t('exampleF3a'));
  await expectSolved(page);
  await chooseExample(page, t('exampleStart'));
  await expectSolved(page);
  expect(await drawnText(page)).toMatch(/=\s4\sV/);
  if (test.info().project.name === 'desktop') {
    await expect(page.getByRole('complementary', { name: t('noteTitle', { name: 'R1' }) })).toBeVisible();
  } else {
    await expect(page.locator('#hint-line')).toHaveText(t('hintInvitePhone', { name: 'R1' }));
  }
  await openPanel(page, 'checks');
  await expect(page.getByText(t('checksNone'))).toBeVisible();
});
