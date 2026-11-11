/**
 * 7. Plots (decision 0004): a .dc or .tran example, solved as it opens, says what the sweep found on
 * a card on the paper; "Show the plot" opens the Plot panel: a figure with a heading and a summary
 * in words, a keyboard cursor (an ARIA slider whose value is spoken with units in words) and a data
 * table behind a disclosure.
 */
import { expect, test } from '@playwright/test';
import { PLOT_STRINGS } from '../../src/plot/strings.ts';
import { chooseExample, expectSolved, openApp, openPanel, panel, setNetlist, statusLine, t } from './helpers.ts';

const CASES = [
  {
    example: t('exampleD1'),
    analysis: '.dc',
    title: 'DC sweep: v(in), v(out), i(v1) as V1 changes',
    // v(out) = 2/3 of V1: 0 V to 8 V as V1 goes from 0 V to 12 V.
    summary: /v\(out\) rises[^.]* from 0\sV to 8\sV as V1 goes from 0\sV to 12\sV/,
    cursor: PLOT_STRINGS.cursorName('V1'),
    atEnd: /^V1 12 volts: .*v\(out\) 8 volts/,
    oneBack: /^V1 11 volts: .*v\(out\) 7\.333 volts/,
    atStart: /^V1 0 volts: .*v\(out\) 0 volts/,
    caption: PLOT_STRINGS.tableCaption('13', '13', true),
    rows: 13,
  },
  {
    example: t('exampleT1'),
    analysis: '.tran',
    title: 'Transient analysis: v(in), v(out), i(v1) against time',
    // tau = 1 ms: after 5 ms the capacitor is at 5 (1 - e^-5) = 4.966 V.
    summary: /v\(out\) rises from 0\sV to 4\.966\sV over 5\sms/,
    cursor: PLOT_STRINGS.cursorName(t('plotTime')),
    atEnd: /^time 5 milliseconds: .*v\(out\) 4\.966 volts/,
    oneBack: /^time 4\.99\d* milliseconds: .*v\(out\) [\d.]+ volts/,
    atStart: /^time 0 seconds: .*v\(out\) 0 volts/,
    caption: PLOT_STRINGS.tableCaption('200', '520', false),
    rows: 200,
  },
];

for (const c of CASES) {
  test(`the plot of “${c.example}”: heading, summary, keyboard cursor, data table`, async ({ page }) => {
    await openApp(page);
    await chooseExample(page, c.example);
    await expectSolved(page);

    // The sweep's summary is on a card on the paper; "Show the plot" opens the Plot panel, and focus
    // moves to its heading.
    // Named for its analysis ("What .tran found"): a .tran is not a sweep.
    const card = page.getByRole('region', { name: t('resultsCardSweep', { analysis: c.analysis }) });
    await expect(card).toContainText(/points|rises/);
    await card.getByRole('button', { name: t('showPlot') }).click();
    const plot = panel(page, 'plot');
    await expect(plot).toBeVisible();
    await expect(plot.getByRole('heading', { level: 2, name: t('panelPlot') })).toBeFocused();

    const figure = page.getByRole('figure', { name: c.title });
    await expect(figure.getByRole('heading', { name: c.title })).toBeVisible();
    await expect(figure).toHaveAccessibleDescription(c.summary);

    // The cursor starts at the last point (the final values) and follows the arrow keys.
    const slider = figure.getByRole('slider', { name: c.cursor });
    await expect(slider).toHaveAttribute('aria-valuetext', c.atEnd);
    await slider.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(slider).toHaveAttribute('aria-valuetext', c.oneBack);
    await page.keyboard.press('Home');
    await expect(slider).toHaveAttribute('aria-valuetext', c.atStart);
    await page.keyboard.press('End');
    await expect(slider).toHaveAttribute('aria-valuetext', c.atEnd);

    // The numbers behind the curve, in a table with a caption (at most 200 rows; the CSV has all).
    await figure.getByText(PLOT_STRINGS.tableToggle).click();
    const table = figure.getByRole('table', { name: c.caption });
    await expect(table).toBeVisible();
    await expect(table.getByRole('row').filter({ has: page.getByRole('rowheader') })).toHaveCount(c.rows);
    await expect(figure.getByRole('button', { name: /^Download CSV/ })).toBeVisible();
  });
}

test('the Plot panel says why there is no plot: no sweep line, or a run that has not happened yet', async ({ page }) => {
  await openApp(page);
  // Start here has an .op only: a .dc or .tran line makes a plot.
  const plot = await openPanel(page, 'plot');
  await expect(plot).toContainText(t('plotNone'));
  // A .tran that waits for Run (very many points): the plot comes once ngspice has run it.
  await setNetlist(page, '* A long .tran\nV1 a 0 1\nR1 a b 1k\nC1 b 0 1u\n.tran 1u 1 0 1u\n.end\n');
  await expect(statusLine(page)).toContainText(t('statusPaused'));
  const again = await openPanel(page, 'plot');
  await expect(again).toContainText(t('plotWaiting'));
  await expect(again).not.toContainText(t('plotNone'));
});
