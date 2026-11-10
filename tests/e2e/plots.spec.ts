/**
 * 7. Plots (decision 0004): the .dc and .tran examples draw a figure with a heading and a summary in
 * words, a keyboard cursor (an ARIA slider whose value is spoken with units in words) and a data
 * table behind a disclosure.
 */
import { expect, test } from '@playwright/test';
import { PLOT_STRINGS } from '../../src/plot/strings.ts';
import { chooseExample, openApp, resultsPanel, runAndExpectFinished, t, tab } from './helpers.ts';

const CASES = [
  {
    example: t('exampleD1'),
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
    await runAndExpectFinished(page);

    // "Show the plot" opens the Plot tab, and focus moves to that tab (the button went with its panel).
    await resultsPanel(page).getByRole('button', { name: t('showPlot') }).click();
    await expect(tab(page, t('tabPlot'))).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, t('tabPlot'))).toBeFocused();

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
