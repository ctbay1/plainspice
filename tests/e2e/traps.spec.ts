/**
 * 3. Beginner traps: found while typing, written in red pen on the drawing next to their part,
 * explained in the Checks panel (what, why, what ngspice does), fixed in one click; and a circuit
 * ngspice cannot solve is not shown with confident numbers.
 */
import { expect, test } from '@playwright/test';
import { tn } from '../../src/i18n/index.ts';
import {
  checksCount,
  drawnText,
  expectAnnounced,
  expectFinished,
  inlineNote,
  netlistText,
  nodeTable,
  openApp,
  openNetlist,
  openPanel,
  readPlain,
  rowNamed,
  RUN_TIMEOUT,
  setNetlist,
  shownText,
  statusLine,
  t,
  typeNetlist,
} from './helpers.ts';

const DIVIDER_1M = '* My divider\nV1 n1 0 6\nR1 n1 n2 1M\nR2 n2 0 1meg\n.op\n.end\n';

test('the 1M trap: found while typing, in red pen on the drawing, explained, fixed to 1meg in one click; then n2 = 3 V', async ({ page }) => {
  await openApp(page);
  await typeNetlist(page, DIVIDER_1M);

  // The checks run while typing: the tab counts the trap, and red pen names it next to R1.
  await expect.poll(() => checksCount(page)).toBe(1);
  await expect.poll(() => drawnText(page)).toMatch(/1M means 1 milliohm/);
  const panel = await openPanel(page, 'checks');
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(t('panelChecks'));
  await expect(panel).toContainText(tn('panelChecksFound', 1));
  const trap = panel.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 4, name: /\b1M\b/ }) });
  await expect(trap).toHaveCount(1);
  // Where, why (in words a beginner can follow) and what ngspice does with it.
  await expect(trap.getByRole('button', { name: /^Go to line 3/ })).toBeVisible();
  await expect(trap).toContainText(/milli/);
  await expect(trap).toContainText(/1meg/);
  await expect(trap).toContainText(t('whatNgspiceDoes'));
  const fixes = trap.getByRole('group', { name: t('fixesLabel', { line: 3 }) }).getByRole('button');
  await expect(fixes).toHaveCount(2);

  await fixes.filter({ hasText: /1meg/ }).click();
  await expect(panel).toContainText(t('checksNone'));
  await expect.poll(() => checksCount(page)).toBe(0);
  await expectAnnounced(page, /No traps found/);
  await openNetlist(page);
  await expect.poll(() => netlistText(page)).toBe(DIVIDER_1M.replace('n2 1M', 'n2 1meg'));

  await expectFinished(page);
  const n2 = rowNamed(nodeTable(page), 'n2').getByRole('cell').first();
  expect(readPlain(await shownText(n2), 'V')).toBe(3);
  expect(await drawnText(page)).not.toMatch(/1M means 1 milliohm/);
});

test('no ground: the check says why; the run shows no numbers, and the Numbers panel folds what ngspice printed away', async ({ page }) => {
  await openApp(page);
  await setNetlist(page, '* No ground\nV1 a b 6\nR1 a b 2\n.op\n.end\n');

  await expect.poll(() => checksCount(page)).toBe(1);
  const panel = await openPanel(page, 'checks');
  const trap = panel.getByRole('listitem');
  await expect(trap).toHaveCount(1);
  await expect(trap.getByRole('heading', { level: 4 })).toContainText(/ground/i);
  await expect(trap).toContainText(/\b0\b/); // ground is the node called 0
  await expect(trap).toContainText(t('whatNgspiceDoes'));

  // ngspice runs (live) and prints numbers from a fallback; PlainSpice does not present them as answers.
  await expect(statusLine(page)).toContainText(t('statusUnreliable'), { timeout: RUN_TIMEOUT });
  await expect(statusLine(page)).toContainText(/A check found an error/);
  await expectAnnounced(page, /a check found an error/);
  expect(await drawnText(page), 'no voltages on the drawing').not.toMatch(/=\s6\sV/);
  const numbers = await openPanel(page, 'numbers');
  await expect(numbers.getByText(t('statusUnreliable'), { exact: true })).toBeVisible();
  await expect(nodeTable(page), 'no node voltages shown as results').toHaveCount(0);
  await expect(numbers.getByText(/^Simulation finished:/)).toHaveCount(0);
  const folded = numbers.locator('details').filter({ hasText: t('printedAnyway') });
  await expect(folded).toBeVisible();
  expect(await folded.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
  // Only on request, and under that heading, does the table of what ngspice printed appear.
  await folded.getByText(t('printedAnyway')).click();
  await expect(folded.getByRole('table', { name: t('nodesCaption') })).toBeVisible();
  await openNetlist(page);
  expect(await inlineNote(page, 2), 'no results on the netlist lines').toBe('');
});

/**
 * A check that found an error means ngspice's numbers are not answers, even when ngspice ran without
 * complaint (words review B1): the run is "Not reliable", the numbers are folded away, the netlist
 * lines get no results, and the announcement names the error.
 */
const CHECK_ERRORS: { name: string; netlist: string; title: RegExp }[] = [
  {
    // ngspice's 1 Ω stand-in gives n1 = −1 mV: an artefact, not the voltage of the circuit.
    name: 'T05c: two current sources in series',
    netlist: '* T05c: two different current sources in series\nI1 0 n1 1m\nI2 n1 0 2m\nR1 n2 0 1k\nV1 n2 0 1\n.op\n.end\n',
    title: /nowhere to go/,
  },
  {
    name: 'T12b: .tf of a node that is not in the circuit',
    netlist: '* T12b: .tf naming an output node that does not exist\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\n.tf v(n9) V1\n.end\n',
    title: /n9/,
  },
  {
    // PlainSpice's engine reads the missing gain as 0; native ngspice 47 stops.
    name: 'z03: an E line without its gain',
    netlist: '* E without a gain\nV1 c 0 3\nR1 c 0 1\nE1 a 0 c 0\nR2 a 0 1\n.op\n.end\n',
    title: /E1 has no gain/,
  },
];

for (const c of CHECK_ERRORS) {
  test(`a check error folds the numbers away even when ngspice runs cleanly: ${c.name}`, async ({ page }) => {
    await openApp(page);
    await setNetlist(page, c.netlist);
    await expect(statusLine(page)).toContainText(t('statusUnreliable'), { timeout: RUN_TIMEOUT });
    await expect(statusLine(page)).toContainText(c.title);
    await expectAnnounced(page, /a check found an error: .*The numbers are not answers\./);
    const numbers = await openPanel(page, 'numbers');
    await expect(numbers.getByText(t('statusUnreliable'), { exact: true })).toBeVisible();
    await expect(numbers.getByText(/A check found an error in this netlist, so the numbers ngspice printed are not answers/)).toBeVisible();
    await expect(numbers.getByText(t('statusFinishedText'))).toHaveCount(0);
    await expect(nodeTable(page), 'no node voltages shown as results').toHaveCount(0);
    const folded = numbers.locator('details').filter({ hasText: t('printedAnyway') });
    await expect(folded).toBeVisible();
    expect(await folded.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    // The trap's own title is in the banner, so the student knows which check it is.
    await expect(numbers.locator('.banner__text')).toContainText(c.title);
    await openNetlist(page);
    for (let line = 2; line <= 5; line++) expect(await inlineNote(page, line), `no result on line ${line}`).toBe('');
  });
}

test('a netlist whose analysis is in a .control block runs; PlainSpice says what ngspice did (words review M1)', async ({ page }) => {
  await openApp(page);
  await setNetlist(page, '* an operating point run from a .control block\nV1 a 0 1\nR1 a 0 1k\n.control\nop\nprint v(a)\n.endc\n.end\n');
  await expect.poll(() => checksCount(page)).toBe(0);
  const numbers = await openPanel(page, 'numbers');
  await expect(numbers.getByText(t('statusEmptyText'))).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(numbers).toContainText('ngspice ran the .control block');
  await expect(page.getByRole('region', { name: t('noAnalysisTitle') })).toHaveCount(0); // no "nothing to run" notice
  const output = await openPanel(page, 'output');
  await expect(output.getByRole('region', { name: t('outputStdout') })).toContainText('v(a) = 1.000000e+00');
});

test('a netlist without an analysis is not run: the status line says so, and Checks offers .op', async ({ page }) => {
  await openApp(page);
  await setNetlist(page, '* nothing to do\nV1 a 0 1\nR1 a 0 1k\n.end\n');
  await expect(statusLine(page)).toContainText(t('noAnalysisTitle'));
  await expect(statusLine(page)).toContainText(t('statusNothingDetail'));
  const panel = await openPanel(page, 'checks');
  await panel.getByRole('button', { name: /Add \.op/ }).click();
  await expect.poll(() => checksCount(page)).toBe(0);
  await expectFinished(page);
});
