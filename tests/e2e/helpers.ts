/**
 * Shared steps for the end-to-end tests: open the app and wait for ngspice, put a netlist in the
 * editor, run it, read the results tables, check a page with axe.
 *
 * Elements are found the way a person (or a screen reader) finds them: by role and accessible
 * name. The names come from the app's own string catalog (src/i18n/en.ts), so rewording a label
 * does not break the tests, while a label that is missing, or on the wrong element, does.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { t } from '../../src/i18n/index.ts';

export { t } from '../../src/i18n/index.ts';
/** The golden tests' criterion (agreement to 6 significant figures) and their names for vectors. */
export { agrees, rawfileName } from '../../src/engine/compare.ts';

const ROOT = resolve(import.meta.dirname, '../..');

/** The longest a run may take here, ngspice loading included: generous for a slow CI machine. */
export const RUN_TIMEOUT = 30_000;

// ------------------------------------------------------------------ fixtures and recordings

export interface ExpectedCheck {
  quantity: string;
  expected: number | string;
  unit: string;
  approx?: boolean;
  points?: number;
}

/** Every fixture (tests/fixtures/*.cir), the files the golden tests check against native ngspice. */
export const FIXTURE_IDS: readonly string[] = readdirSync(resolve(ROOT, 'tests/fixtures'))
  .filter((f) => f.endsWith('.cir'))
  .map((f) => f.slice(0, -'.cir'.length))
  .sort();

const EXPECTED = JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/expected.json'), 'utf8')) as {
  fixtures: Record<string, { checks: ExpectedCheck[] }>;
};

export function fixtureText(id: string): string {
  return readFileSync(resolve(ROOT, `tests/fixtures/${id}.cir`), 'utf8');
}

/** The values worked out by hand for a fixture (tests/fixtures/expected.json). */
export function expectedChecks(id: string): ExpectedCheck[] {
  return EXPECTED.fixtures[id]?.checks ?? [];
}

export interface NativePlot {
  plotname: string;
  points: number;
  vectors: { name: string; values: number[] }[];
}

/** What native ngspice 47 computed for a fixture (recorded by scripts/record-native.ts). */
export function nativeRecording(id: string): NativePlot[] {
  const rec = JSON.parse(readFileSync(resolve(ROOT, `tests/golden/native/ngspice-47/${id}.json`), 'utf8')) as { plots: NativePlot[] };
  return rec.plots;
}

// ------------------------------------------------------------------ the app

/** Open the app (a fresh page has no saved netlist, so it opens the first example) and wait for ngspice. */
export async function openApp(page: Page, url = './'): Promise<void> {
  await page.goto(url);
  await expect(page.getByText(t('engineReady'))).toBeVisible({ timeout: RUN_TIMEOUT });
}

export function netlistEditor(page: Page): Locator {
  return page.getByRole('textbox', { name: t('editorLabel') });
}

export function runButton(page: Page): Locator {
  return page.getByRole('toolbar', { name: t('toolbarLabel') }).getByRole('button', { name: t('run'), exact: true });
}

/** Replace the whole netlist, the way a student pastes one: select everything, then insert. */
export async function setNetlist(page: Page, text: string): Promise<void> {
  await netlistEditor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
  await expect.poll(() => netlistText(page)).toBe(text);
}

/**
 * Typing speed for keyboard.type: one key every 40 ms, still faster than people type. CodeMirror on
 * Android (the phone project's user agent) holds Enter back for a moment to see what the on-screen
 * keyboard does with it, and keys sent with no pause at all can overtake it.
 */
export const TYPING = { delay: 40 };

/** Replace the whole netlist by typing it key by key (Enter for each line break). */
export async function typeNetlist(page: Page, text: string): Promise<void> {
  await netlistEditor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text, TYPING);
  await expect.poll(() => netlistText(page)).toBe(text);
}

/**
 * The editor's text, line by line, as the student wrote it: the results shown at the ends of the
 * lines after a run (hidden from screen readers) are not part of it.
 */
export async function netlistText(page: Page): Promise<string> {
  return netlistEditor(page).evaluate((content) =>
    [...content.querySelectorAll(':scope > .cm-line')]
      .map((line) => {
        const copy = line.cloneNode(true) as HTMLElement;
        for (const extra of copy.querySelectorAll('[aria-hidden="true"], [contenteditable="false"], img')) extra.remove();
        return copy.textContent ?? '';
      })
      .join('\n'),
  );
}

/** The result shown at the end of a netlist line after a run (1-based line), or '' when it has none. */
export async function inlineNote(page: Page, line: number): Promise<string> {
  return netlistEditor(page).evaluate((content, n) => {
    const row = content.querySelectorAll(':scope > .cm-line')[n - 1];
    if (!row) return '';
    const texts = [...row.querySelectorAll('[aria-hidden="true"]')].map((e) => e.textContent?.trim() ?? '');
    return texts.filter(Boolean).join(' ');
  }, line);
}

export async function chooseExample(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: t('examples') }).click();
  await page.getByRole('menu', { name: t('examplesMenu') }).getByRole('menuitem', { name, exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

/** Press Run and wait until ngspice has finished and the Results tab says so. */
export async function runAndExpectFinished(page: Page): Promise<void> {
  await runButton(page).click();
  await expectFinished(page);
}

export async function expectFinished(page: Page): Promise<void> {
  await expect(resultsPanel(page).getByText(t('statusFinishedText'))).toBeVisible({ timeout: RUN_TIMEOUT });
}

export function tab(page: Page, name: string | RegExp): Locator {
  return page.getByRole('tablist', { name: t('tabsLabel') }).getByRole('tab', { name });
}

/** The Results tab panel (only the selected tab's panel is in the page). */
export function resultsPanel(page: Page): Locator {
  return page.getByRole('tabpanel', { name: t('tabResults') });
}

/**
 * Expect the polite live region (role status) to have announced `text`. Each message stays there
 * for 10 s, so this is checked right after the action that announces it.
 */
export async function expectAnnounced(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: text }).first()).toBeAttached();
}

// ------------------------------------------------------------------ the results tables

export function nodeTable(page: Page): Locator {
  return page.getByRole('table', { name: t('nodesCaption') });
}

export function currentsTable(page: Page): Locator {
  return page.getByRole('table', { name: t('currentsCaption') });
}

export function tfTable(page: Page): Locator {
  return page.getByRole('table', { name: t('tfCaption') });
}

/** The row of a table whose row header is exactly `name` (a node, a part, a .tf quantity). */
export function rowNamed(table: Locator, name: string | RegExp): Locator {
  return table.getByRole('row').filter({ has: table.page().getByRole('rowheader', { name, exact: typeof name === 'string' }) });
}

/**
 * What a results cell shows on screen. Each number is written twice: "14 V" for the eyes
 * (aria-hidden) and "14 volts" for screen readers (visually hidden); this is the first.
 */
export async function shownText(cell: Locator): Promise<string> {
  return cell.evaluate((el) => [...el.querySelectorAll('[aria-hidden="true"]')].map((n) => n.textContent ?? '').join(''));
}

const PREFIXES: Record<string, number> = { T: 1e12, G: 1e9, M: 1e6, k: 1e3, '': 1, m: 1e-3, 'µ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18 };

/**
 * Read a number written in plain units ("14 V", "−6 V", "666.7 mV", "0.3333 V/V") back, and check
 * it is plain: digits, an SI prefix and the unit, no exponent like 1.4e+01. Undefined if not.
 */
export function readPlain(text: string, unit: string): number | undefined {
  const s = text.trim();
  if (!s.endsWith(unit)) return undefined;
  const m = /^([−-]?)(\d+(?:\.\d+)?)\s([TGMkmµnpfa]?)$/u.exec(s.slice(0, s.length - unit.length));
  if (!m) return undefined;
  return (m[1] ? -1 : 1) * Number(m[2]) * PREFIXES[m[3]!]!;
}

/** The number in ngspice's own spelling, as the "ngspice printed" column shows it: "v(a) = 1.400000e+01". */
export function readPrinted(text: string): number {
  const m = /(-?\d\.\d{6}e[+-]\d{2,3})\s*$/.exec(text.trim());
  if (!m) throw new Error(`no ngspice number in "${text}"`);
  return Number(m[1]);
}

// ------------------------------------------------------------------ accessibility

/** The rules decision 0010 gates on: WCAG 2.0, 2.1 and 2.2, levels A and AA. */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Wait until the page is still: no CSS animation or transition running (a dialog fading in, a menu
 * sliding) and no change to the DOM for `quietMs` (React finishing a render, a message added to a
 * live region). Gives up waiting for quiet after `maxMs`.
 */
export async function settle(page: Page, quietMs = 250, maxMs = 3000): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity),
  );
  await page.evaluate(
    ([quiet, max]) =>
      new Promise<void>((resolve) => {
        const start = performance.now();
        const done = (): void => {
          observer.disconnect();
          resolve();
        };
        let timer = setTimeout(done, quiet);
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(done, performance.now() - start > max ? 0 : quiet);
        });
        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      }),
    [quietMs, maxMs] as const,
  );
}

/**
 * @axe-core/playwright brings its own copy of playwright-core (a peer dependency that npm resolved
 * to a newer version), so its Page type differs from @playwright/test's; axe only calls
 * page.evaluate and frame methods that both have.
 */
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];

/**
 * Run axe on the page as it is now and expect no violations; the message lists what failed and
 * where. axe can fail outright when the page changes under it (a live-region message is removed
 * after 10 s): then it looks again, up to three times.
 */
export async function expectNoAxeViolations(page: Page, state: string): Promise<number> {
  let results: Awaited<ReturnType<AxeBuilder['analyze']>> | undefined;
  for (let attempt = 1; !results; attempt++) {
    await settle(page);
    try {
      results = await new AxeBuilder({ page: page as unknown as AxePage }).withTags(AXE_TAGS).analyze();
    } catch (error) {
      if (attempt >= 3) throw error;
      // Kept in the report, so a page that keeps changing under axe gets noticed.
      test.info().annotations.push({ type: 'axe looked again', description: `${state}: ${String(error).split('\n')[0]}` });
    }
  }
  const found = results.violations.map(
    (v) => `${v.id} (${v.impact ?? 'n/a'}): ${v.help} at ${v.nodes.map((n) => n.target.join(' ')).slice(0, 5).join(' | ')}`,
  );
  expect(found, `axe violations, ${state}`).toEqual([]);
  return results.passes.length;
}
