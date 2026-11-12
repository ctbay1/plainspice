/**
 * What the final reviews of milestone 2 found in the page (the ui lane), fixed, in a real browser:
 * Ctrl+K keeps the focus in its field (Tab stays there, a click on a group's name too, Escape closes
 * it from anywhere) and its list passes axe's best-practice rules (a11y A1, A3); "dependent" lists the
 * dependent sources' Place commands first (words W4); a fix on the video's mistake examples leaves no
 * drawing warning, the tab and the announcement agree, and a fix that renames a part keeps it where it
 * was drawn (kept F1); the starter's why is shown in the hint line until it has been read, on a phone
 * too (words W9); the Netlist panel a SPICE for Beginners example opened closes with the next video's
 * example (student netlist-panel-stays); a new node never takes a name just said to be ground
 * (student node-name-reused).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { starterWords } from '../../src/app/editing.ts';
import { toolPhrase } from '../../src/app/tools.ts';
import {
  checksCount,
  chooseExample,
  expectAnnounced,
  expectSolved,
  gridPoint,
  hintLine,
  isPhone,
  newCircuit,
  openApp,
  openPanel,
  panel,
  partOnDrawing,
  partsToolbar,
  savedNetlist,
  setNetlistWithDrawing,
  statusLine,
  RUN_TIMEOUT,
  TYPING,
  t,
} from './helpers.ts';

const palette = (page: Page) => page.getByRole('dialog', { name: t('paletteTitle') });
const search = (page: Page) => palette(page).getByRole('combobox', { name: t('paletteLabel') });

/** Click a grid point (a place on the paper) with the mouse. */
async function clickAt(page: Page, x: number, y: number): Promise<void> {
  const p = await gridPoint(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

test('Ctrl+K keeps the focus in its field: Tab stays there, Escape closes it, and a click on a group’s name keeps the focus (a11y A1)', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  // (a) Ctrl+K, then Tab and Shift+Tab: the focus stays in the dialog's field, never reaching the page behind.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(search(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(search(page)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(search(page)).toBeFocused();
  await expect(page.getByRole('link', { name: t('skipToDrawing') })).not.toBeFocused();
  // The arrows and Escape still work there.
  await page.keyboard.press('ArrowDown');
  await expect(palette(page).getByRole('option', { selected: true })).toContainText(t('paletteOpenPanel', { panel: t('panelNetlist') }));
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);
  // (b) A click on a group's name: the focus stays in the field, and Escape closes the dialog.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(search(page)).toBeFocused();
  await palette(page).locator('.palette__group', { hasText: t('paletteGroupPanels') }).click();
  await expect(search(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);
  // And should the focus ever be on the page itself, Escape still closes it, as its Esc badge says.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(search(page)).toBeFocused();
  await search(page).evaluate((el) => (el as HTMLElement).blur());
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);
});

test('axe: Ctrl+K’s list passes the best-practice rules too (its groups are allowed roles: a11y A3)', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  await page.keyboard.press('ControlOrMeta+k');
  await expect(search(page)).toBeFocused();
  const results = await new AxeBuilder({ page }).withTags(['best-practice']).include('.palette').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
  await expect(palette(page).getByRole('listbox').getByRole('group', { name: t('paletteGroupRun') })).toBeVisible();
});

test('Ctrl+K “dependent” lists the four Place commands first, in view on a phone too; “cccs” finds F (the critic of words W4)', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  await page.keyboard.press('ControlOrMeta+k');
  await search(page).fill('dependent');
  const tools = (['E', 'F', 'G', 'H'] as const).map((tl) => t('palettePlace', { part: toolPhrase(tl) }));
  const options = palette(page).getByRole('option');
  for (const [i, label] of tools.entries()) await expect(options.nth(i)).toContainText(label);
  // In the list's view without scrolling (on a Pixel 7 the examples used to fill it), and Enter would place E.
  const hidden = await palette(page).evaluate((dialog, count) => {
    const list = dialog.querySelector('[role=listbox]')!.getBoundingClientRect();
    return [...dialog.querySelectorAll('[role=option]')].slice(0, count).filter((o) => o.getBoundingClientRect().bottom > list.bottom + 1).map((o) => o.textContent);
  }, tools.length);
  expect(hidden).toEqual([]);
  await expect(palette(page).getByRole('option', { selected: true })).toContainText(tools[0]!);
  await search(page).fill('cccs');
  await expect(options.first()).toContainText(tools[1]!);
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);
});

test('a fix on the video’s mistake examples leaves no drawing warning; the tab and what is said agree (kept F1)', async ({ page }) => {
  await openApp(page);
  for (const [example, fix] of [
    ['Mistake 1: no ground (node 0)', 'Make n3 the ground (rename it to 0)'],
    ['Mistake 2: a typo in a node name', 'Rename n12 to n2'],
  ] as const) {
    await chooseExample(page, example);
    await expect.poll(() => checksCount(page)).toBe(1);
    const checks = await openPanel(page, 'checks');
    await checks.getByRole('button', { name: fix, exact: true }).click();
    await expectAnnounced(page, `${t('fixApplied', { label: fix })}. No traps found.`);
    await expect.poll(() => checksCount(page)).toBe(0);
    await expect(panel(page, 'checks').getByText(t('checksNone'))).toBeVisible();
    await expect(panel(page, 'checks')).not.toContainText(t('checksDrawingTitle'));
    await expect(statusLine(page)).toContainText(/Finished in \d+ ms/, { timeout: RUN_TIMEOUT });
  }
});

test('a fix that renames a part keeps it where it was drawn: the 0 V source stands in R1’s place (the critic of kept F1)', async ({ page }) => {
  await openApp(page);
  // A drawn circuit whose R1 is written as 0 Ω (a wire): the check offers a 0 V source in its place.
  const drawn = [
    '* My circuit: R1 as a wire',
    'V1 n1 0 6',
    'R1 n1 n2 0',
    'R2 n2 0 4',
    'I1 0 n2 3',
    '.op',
    '* plainspice-drawing v1',
    '*@ V1 0 8 0 side=left',
    '*@ R1 9 0 270 side=above',
    '*@ R2 17 8 0 side=right',
    '*@ I1 27 8 180 side=right',
    '*@ ground 17 15 0',
    '*@ wire 0,6 0,0 7,0',
    '*@ wire 11,0 27,0 27,6',
    '*@ wire 17,6 17,0',
    '*@ wire 0,10 0,15 27,15 27,10',
    '*@ wire 17,10 17,15',
    '*@ label n1 0 0 side=above-left',
    '*@ label n2 18 0 side=above-left',
    '.end',
    '',
  ].join('\n');
  await setNetlistWithDrawing(page, drawn);
  await expect(statusLine(page)).toContainText(/Finished in \d+ ms/, { timeout: RUN_TIMEOUT });
  const checks = await openPanel(page, 'checks');
  const fix = 'Use a 0 V source instead (VR1)';
  await expect(checks.getByRole('button', { name: fix, exact: true })).toBeVisible();
  // Whether a part is drawn at grid point (9, 0), R1's place, wherever the view is now (a computer: a
  // phone may show this wide drawing turned a quarter, another drawing than the netlist's).
  const phone = isPhone(page);
  const standsAt = async (name: string): Promise<boolean> => {
    const b = (await partOnDrawing(page, name).boundingBox())!;
    const p = await gridPoint(page, 9, 0);
    return p.x > b.x && p.x < b.x + b.width && p.y > b.y && p.y < b.y + b.height;
  };
  if (!phone) expect(await standsAt('R1')).toBe(true);
  await checks.getByRole('button', { name: fix, exact: true }).click();
  await expectAnnounced(page, `${t('fixApplied', { label: fix })}. No traps found.`);
  // Its position line took the new name (nothing else changed in it), and the tab warns about nothing.
  await expect.poll(() => savedNetlist(page)).toContain('*@ VR1 9 0 270 side=above\n');
  expect(await savedNetlist(page)).not.toContain('*@ R1 ');
  await expect.poll(() => checksCount(page)).toBe(0);
  await expect(panel(page, 'checks')).not.toContainText(t('checksDrawingTitle'));
  // VR1 is drawn where R1 was (between n1 and n2), not placed elsewhere with new wires.
  if (!phone) await expect.poll(() => standsAt('VR1')).toBe(true);
});

test('the first part on a blank page: why .op and .end were written is shown first in the hint line, and stays until it has been read (words W9)', async ({ page }) => {
  test.skip(isPhone(page), 'a phone places by tapping (the next test)');
  await openApp(page);
  await newCircuit(page);
  await partsToolbar(page).getByRole('button', { name: /^Resistor/ }).click();
  await clickAt(page, 2, 2);
  const why = `${starterWords()} ${t('drawingWritten')}`;
  await expect(hintLine(page)).toHaveText(why);
  const placed = Date.now();
  // The pointer moves on over empty paper 2 s later: the why stays (it went at the first move after 1.5 s).
  await page.waitForTimeout(2000);
  const empty = await gridPoint(page, 12, 9);
  await page.mouse.move(empty.x, empty.y, { steps: 4 });
  await page.mouse.move(empty.x + 40, empty.y + 25, { steps: 4 });
  await expect(hintLine(page)).toHaveText(why);
  // Escape closes the card that opened on R1: the why stays.
  const card = page.getByRole('dialog', { name: /^R1 / });
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(hintLine(page)).toHaveText(why);
  // Past the 6 s it used to have at most, and the pointer moving again: still there (60 ms a character).
  await page.waitForTimeout(Math.max(0, 7000 - (Date.now() - placed)));
  await page.mouse.move(empty.x, empty.y, { steps: 4 });
  await expect(hintLine(page)).toHaveText(why);
  // The next thing, a tool chosen: the hint line says what the tool does.
  await partsToolbar(page).getByRole('button', { name: /^Resistor/ }).click();
  await expect(hintLine(page)).not.toHaveText(why);
});

test('on a phone the why for .op and .end shows once the first part’s card sheet closes, however long it was open (words W9)', async ({ page }) => {
  test.skip(!isPhone(page), 'the phone’s card sheet takes the hint line’s place');
  await openApp(page);
  await newCircuit(page);
  await page.getByRole('navigation', { name: t('barLabel') }).getByRole('button', { name: t('barParts') }).click();
  await page.getByRole('dialog', { name: t('partsSheetTitle') }).getByRole('button', { name: /^Resistor/ }).click();
  const paper = (await page.locator('.nb-canvas').boundingBox())!;
  await page.touchscreen.tap(paper.x + paper.width * 0.5, paper.y + paper.height * 0.3);
  await page.getByRole('toolbar', { name: t('handLabel', { part: 'Resistor' }) }).getByRole('button', { name: t('place') }).click();
  const placed = Date.now();
  // R1's card opens as a sheet, in the hint line's place.
  const card = page.getByRole('dialog', { name: /^R1 / });
  await expect(card).toBeVisible();
  await expect(hintLine(page)).toHaveCount(0);
  // A value typed there (a change with nothing to say) does not take the why away unseen.
  const field = card.getByRole('textbox');
  await field.click();
  await field.press('ControlOrMeta+a');
  await field.pressSequentially('2k', TYPING);
  await expect.poll(() => savedNetlist(page)).toMatch(/^R1 n1 n2 2k$/m);
  await card.getByRole('button', { name: t('cardDone') }).click();
  // The sheet closes 7 s after Place (more than the 6 s the why used to have): the hint line shows it.
  await page.waitForTimeout(Math.max(0, 7000 - (Date.now() - placed)));
  await card.getByRole('button', { name: t('cardClose', { name: 'R1' }) }).click();
  await expect(card).toHaveCount(0);
  await expect(hintLine(page)).toHaveText(`${starterWords()} ${t('drawingWritten')}`);
});

test('the Netlist panel a SPICE for Beginners example opened closes with the next video’s example (student netlist-panel-stays)', async ({ page }) => {
  test.skip(isPhone(page), 'on a phone the examples open without the panel');
  await openApp(page);
  await chooseExample(page, 'Example 1');
  await expect(panel(page, 'netlist')).toBeVisible();
  await chooseExample(page, 'Example 3: a supernode with a dependent source');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/supernode/i);
  await expect(panel(page, 'netlist')).toHaveCount(0);
  // The drawing has the paper to itself again: every part is in view.
  await expect(page.getByRole('main').getByRole('button', { name: /^R3, / })).toBeInViewport();
  await chooseExample(page, 'Dependent sources E, G, F and H');
  await expect(panel(page, 'netlist')).toBeVisible();
});

test('a new node never takes a name just said to be ground (student node-name-reused)', async ({ page }) => {
  test.skip(isPhone(page), 'a phone places by tapping (the phone tests)');
  await openApp(page);
  await newCircuit(page);
  const tools = partsToolbar(page);
  // V1 upright at (0, 3): its ends n1 and n2; its card opens on its value.
  await tools.getByRole('button', { name: /^Voltage source/ }).click();
  await clickAt(page, 0, 3);
  await expectAnnounced(page, /V1 added between node n1 and node n2\./);
  await page.keyboard.press('Escape');
  // Ground on V1's − pin.
  await tools.getByRole('button', { name: /^Ground/ }).click();
  await clickAt(page, 0, 5);
  await expectAnnounced(page, /Node n2 is now ground \(node 0\)/);
  // A resistor on empty paper: two new nodes, neither of them n2.
  await tools.getByRole('button', { name: /^Resistor/ }).click();
  await clickAt(page, 8, 2);
  await expectAnnounced(page, 'R1 added between node n3 and node n4.');
});
