/**
 * 2. Every fixture, put into the Netlist panel and solved in the real browser Worker as it changes
 * (live runs): the values worked out by hand (tests/fixtures/expected.json) appear in the Numbers
 * panel in plain units, and every number native ngspice 47 computed for the same file
 * (tests/golden/native/) is there to 6 significant figures; sweeps in the Plot panel and its CSV.
 * The golden tests check the same numbers in Node; this checks them through the UI.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PLOT_STRINGS } from '../../src/plot/strings.ts';
import {
  agrees,
  expectedChecks,
  expectShown,
  FIXTURE_IDS,
  fixtureText,
  nativeRecording,
  openApp,
  openPanel,
  rawfileName,
  readPlain,
  expectFinished,
  setNetlist,
  shownText,
  type ExpectedCheck,
} from './helpers.ts';

/** A CSV file from the plot's Download button: one column per vector, every point, full precision. */
async function downloadCsv(page: Page, figure: Locator): Promise<Map<string, number[]>> {
  const [download] = await Promise.all([page.waitForEvent('download'), figure.getByRole('button', { name: /^Download CSV/ }).click()]);
  const text = readFileSync(await download.path(), 'utf8').replace(/^\uFEFF/, '');
  const [header, ...rows] = text.trimEnd().split('\r\n');
  const names = header!.split(',').map((h) => h.replace(/ \([^)]*\)$/, ''));
  const columns = new Map<string, number[]>(names.map((n) => [n, []]));
  for (const row of rows) row.split(',').forEach((cell, i) => columns.get(names[i]!)!.push(Number(cell)));
  return columns;
}

/** The exact response of the RC (1 k, 1 µF) to the 1 µs ramp from 0 to 5 V (as in the golden test). */
function rcCharge(time: number): number {
  const tau = 1e-3;
  const tr = 1e-6;
  return time <= tr ? (5 / tr) * (time - tau * (1 - Math.exp(-time / tau))) : 5 - 5 * (tau / tr) * (Math.exp(tr / tau) - 1) * Math.exp(-time / tau);
}

async function checkSweep(page: Page, numbers: Locator, id: string, checks: ExpectedCheck[]): Promise<void> {
  const native = nativeRecording(id)[0]!;
  const [scale, ...vectors] = native.vectors;
  // The Numbers panel sums the sweep up in words, with the last point's values in plain units.
  const sweepWords = await shownText(numbers.getByRole('listitem').filter({ hasText: /points\./ }));
  const last = (name: string): number => native.vectors.find((v) => v.name === name)!.values.at(-1)!;
  for (const v of vectors) {
    const m = new RegExp(`${v.name.replace(/[()]/g, '\\$&')} = ([^,]+?)(?:,|\\.$)`).exec(sweepWords);
    expect(m, `the sweep summary gives the last value of ${v.name}: "${sweepWords}"`).not.toBeNull();
    const read = readPlain(m![1]!, v.name.startsWith('i(') ? 'A' : 'V');
    expect(read !== undefined && agrees(read, last(v.name), 4), `${v.name} last value "${m![1]}"`).toBe(true);
  }

  await openPanel(page, 'plot');
  const figure = page.getByRole('figure');
  await expect(figure).toHaveCount(1);

  // The CSV has every point at full precision: compare it with native ngspice 47, vector by vector.
  await figure.getByText(PLOT_STRINGS.tableToggle).click();
  const csv = await downloadCsv(page, figure);
  const csvColumns = [...csv.values()];
  expect(csvColumns.length).toBe(native.vectors.length);
  expect(csvColumns[0]!.length, 'every point is in the CSV').toBe(native.points);
  native.vectors.forEach((v, k) => {
    const column = k === 0 ? csvColumns[0]! : csv.get(v.name);
    expect(column, `${v.name} is a CSV column`).toBeDefined();
    v.values.forEach((x, i) => expect(agrees(column![i]!, x), `${v.name}[${i}]: shown ${column![i]} vs native ${x}`).toBe(true));
  });

  // The values worked out by hand, at every point.
  const x = csvColumns[0]!;
  for (const c of checks) {
    const column = csv.get(c.quantity)!;
    if (id === 'd1-dc-divider-sweep') {
      expect(column.length).toBe(c.points);
      column.forEach((v, i) => expect(agrees(v, (2 / 3) * x[i]!), `v(out) at V1 = ${x[i]}: ${v}`).toBe(true));
    } else if (id === 't1-tran-rc-charge') {
      column.forEach((v, i) => expect(Math.abs(v - rcCharge(x[i]!)), `v(out) at t = ${x[i]}: ${v}`).toBeLessThan(5e-5));
    } else {
      throw new Error(`no hand check written for ${id}: ${c.expected}`);
    }
  }

  // The data table shows the same in plain units (the first column names the swept source, not v(v-sweep)).
  const table = figure.getByRole('table');
  await expect(table.getByRole('columnheader').first()).toHaveText(scale!.name === 'time' ? 'time (s)' : /^V1 \(V\)$/);
  const rows = table.getByRole('row').filter({ has: page.getByRole('rowheader') });
  if (id === 'd1-dc-divider-sweep') {
    await expect(rows).toHaveCount(13);
    for (let i = 0; i < 13; i++) {
      const cells = rows.nth(i).getByRole('cell');
      const vout = readPlain((await cells.nth(1).textContent()) ?? '', 'V');
      expect(vout !== undefined && agrees(vout, (2 / 3) * i, 4), `row ${i}: v(out) ${vout}`).toBe(true);
    }
  } else {
    const end = rows.last();
    await expect(end.getByRole('rowheader')).toHaveText('5\u00a0ms');
    const vout = readPlain((await end.getByRole('cell').nth(1).textContent()) ?? '', 'V');
    expect(vout !== undefined && agrees(vout, rcCharge(5e-3), 4), `v(out) at 5 ms: ${vout}`).toBe(true);
  }
}

for (const id of FIXTURE_IDS) {
  test(`${id}: put into the Netlist panel and solved, the results match the hand values and native ngspice`, async ({ page }) => {
    const checks = expectedChecks(id);
    expect(checks.length, `tests/fixtures/expected.json has checks for ${id}`).toBeGreaterThan(0);
    await openApp(page);
    await setNetlist(page, fixtureText(id));
    const numbers = await expectFinished(page);

    const plots = nativeRecording(id);
    if (plots.some((p) => p.points > 1)) {
      await checkSweep(page, numbers, id, checks);
      return;
    }
    for (const c of checks) {
      expect(typeof c.expected, `${c.quantity} is a number`).toBe('number');
      // expected.json names quantities the way ngspice prints them (vx#branch); the tables, like the
      // recordings, use rawfile names (i(vx)).
      await expectShown(page, rawfileName(c.quantity), c.expected as number, `${c.quantity} (worked out by hand)`);
    }
    for (const v of plots.flatMap((p) => p.vectors)) {
      await expectShown(page, v.name, v.values[0]!, `${v.name} (native ngspice 47)`);
    }
  });
}
