/**
 * Shared steps for the end-to-end tests: open the app and wait for ngspice, open a panel (the
 * divider tabs on a computer, the bottom bar and its More sheet on a phone), put a netlist in the
 * Netlist panel, run it, read the drawing and the Numbers panel's tables, check a page with axe.
 *
 * Elements are found the way a person (or a screen reader) finds them: by role and accessible
 * name. The names come from the app's own string catalogs (src/i18n/en.ts, src/notebook), so
 * rewording a label does not break the tests, while a label that is missing, or on the wrong
 * element, does. The status line and the drawing's handwriting are read by their place on the page:
 * they are words on the paper, not controls.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { agrees } from '../../src/engine/compare.ts';
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

/** The first screen's circuit (examples/start-here.cir). */
export const START_HERE = readFileSync(resolve(ROOT, 'examples/start-here.cir'), 'utf8');

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

// ------------------------------------------------------------------ the page

/** The phone's layout (narrower than 900 px): the bottom bar, sheets, the drawing turned to fit. */
export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 900;
}

/**
 * The layout the page has now: the phone's on a phone, and also on a computer whose window is small
 * for its text (150 % text on a laptop, a short window).
 */
export async function phoneLayout(page: Page): Promise<boolean> {
  return (await page.locator('.app.is-phone').count()) > 0;
}

/** The status line: what ngspice is doing and how the last run went ("Finished in 12 ms"). */
export function statusLine(page: Page): Locator {
  return page.locator('.status');
}

/** The hint line: what to do next. */
export function hintLine(page: Page): Locator {
  return page.locator('#hint-line');
}

/**
 * Open the app and wait until ngspice has answered (a fresh page has nothing saved, so it opens the
 * first screen, Start here, already solved), or says why it does not run (a link that waits for Run).
 */
export async function openApp(page: Page, url = './'): Promise<void> {
  await page.goto(url);
  await expect(statusLine(page)).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(statusLine(page)).toHaveAttribute('data-tone', /^(ok|paused|bad)$/, { timeout: RUN_TIMEOUT });
}

/** Wait until ngspice has solved the netlist as it is now. */
export async function expectSolved(page: Page): Promise<void> {
  await expect(statusLine(page)).toContainText(/Finished in \d+ ms/, { timeout: RUN_TIMEOUT });
}

/** Run (Ctrl+Enter): in the top bar (on a phone, the button with the play icon). */
export function runButton(page: Page): Locator {
  return page.getByRole('banner').getByRole('button', { name: t('run'), exact: true });
}

/** Press Run and wait until ngspice has solved the netlist. */
export async function runAndExpectSolved(page: Page): Promise<void> {
  await runButton(page).click();
  await expectSolved(page);
}

export type PanelName = 'netlist' | 'checks' | 'explain' | 'numbers' | 'plot' | 'output';
const PANEL_TAB: Record<PanelName, string> = {
  netlist: t('panelNetlist'),
  checks: t('panelChecks'),
  explain: t('panelExplain'),
  numbers: t('panelNumbers'),
  plot: t('panelPlot'),
  output: t('panelOutputTab'),
};
const PANEL_TITLE: Record<PanelName, string> = {
  netlist: t('panelNetlist'),
  checks: t('panelChecks'),
  explain: t('panelExplain'),
  numbers: t('panelNumbers'),
  plot: t('panelPlot'),
  output: t('panelOutput'),
};

/** A panel's tab: on a computer, a divider tab down the right edge; on a phone, a button of the bottom bar. */
export function panelTab(page: Page, name: PanelName): Locator {
  // Whichever of the two the page has now (only one is there at a time).
  const nav = page.getByRole('navigation', { name: new RegExp(`^(${t('barLabel')}|${t('panelsLabel')})$`) });
  return nav.getByRole('button', { name: new RegExp(`^${PANEL_TAB[name]}`) });
}

/** The panel, while it is open. */
export function panel(page: Page, name: PanelName): Locator {
  return page.getByRole('region', { name: PANEL_TITLE[name], exact: true });
}

/** Open a panel (a phone keeps Numbers, Plot and ngspice output in the bar's More sheet). */
export async function openPanel(page: Page, name: PanelName): Promise<Locator> {
  const region = panel(page, name);
  if (await region.isVisible()) return region;
  if ((await phoneLayout(page)) && (name === 'numbers' || name === 'plot' || name === 'output')) {
    await page.getByRole('navigation', { name: t('barLabel') }).getByRole('button', { name: t('barMore') }).click();
    await page.getByRole('dialog', { name: t('barMore') }).getByRole('button', { name: PANEL_TITLE[name], exact: true }).click();
  } else {
    await panelTab(page, name).click();
  }
  await expect(region).toBeVisible();
  return region;
}

export async function closePanel(page: Page, name: PanelName): Promise<void> {
  await panel(page, name).getByRole('button', { name: t('panelClose', { panel: PANEL_TITLE[name] }) }).click();
  await expect(panel(page, name)).toHaveCount(0);
}

/** The Checks tab's count, as its badge shows it (0 when there is no badge). */
export async function checksCount(page: Page): Promise<number> {
  const text = (await panelTab(page, 'checks').textContent()) ?? '';
  const m = /(\d+)\s*found/.exec(text);
  return m ? Number(m[1]) : 0;
}

// ------------------------------------------------------------------ the Netlist panel

export function netlistEditor(page: Page): Locator {
  return page.getByRole('textbox', { name: t('editorLabel') });
}

/** Open the Netlist panel and wait for its editor. */
export async function openNetlist(page: Page): Promise<Locator> {
  await openPanel(page, 'netlist');
  await expect(netlistEditor(page)).toBeVisible();
  return netlistEditor(page);
}

/** Replace the whole netlist, the way a student pastes one: select everything, then insert. */
export async function setNetlist(page: Page, text: string): Promise<void> {
  const editor = await openNetlist(page);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
  await expect.poll(() => netlistText(page)).toBe(text);
}

/**
 * Replace the whole netlist with one that carries drawing lines (*@): the editor folds those lines
 * away, so this waits for the netlist itself (the store, as the autosave keeps it) to be the text.
 */
export async function setNetlistWithDrawing(page: Page, text: string): Promise<void> {
  const editor = await openNetlist(page);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('plainspice:netlist'))).toBe(text);
}

/**
 * Typing speed for keyboard.type: one key every 40 ms, still faster than people type. CodeMirror on
 * Android (the phone project's user agent) holds Enter back for a moment to see what the on-screen
 * keyboard does with it, and keys sent with no pause at all can overtake it.
 */
export const TYPING = { delay: 40 };

/** Replace the whole netlist by typing it key by key (Enter for each line break). */
export async function typeNetlist(page: Page, text: string): Promise<void> {
  const editor = await openNetlist(page);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text, TYPING);
  await expect.poll(() => netlistText(page)).toBe(text);
}

/**
 * The editor's text, line by line, as the student wrote it: the results shown at the ends of the
 * lines after a run (hidden from screen readers) are not part of it, nor are folded drawing lines.
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

/** The whole netlist, its drawing lines (*@) unfolded first. */
export async function fullNetlistText(page: Page): Promise<string> {
  const region = await openPanel(page, 'netlist');
  await expect(netlistEditor(page)).toBeVisible();
  const show = region.getByRole('button', { name: /^Show the \d+ drawing lines?$/ });
  if (await show.isVisible()) await show.click();
  return netlistText(page);
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

// ------------------------------------------------------------------ examples, dialogs, the palette

/** The Examples menu's button: in the top bar on a computer, the circuit's title on a phone. */
export function examplesButton(page: Page): Locator {
  return page.getByRole('banner').getByRole('button', { name: new RegExp(`^${t('examples')}`) });
}

export async function chooseExample(page: Page, name: string): Promise<void> {
  await examplesButton(page).click();
  await page.getByRole('menu', { name: t('examplesMenu') }).getByRole('menuitem', { name, exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

/** Open Share (in the top bar on a computer, in the bar's More sheet on a phone). */
export async function openShare(page: Page): Promise<Locator> {
  if (await phoneLayout(page)) {
    await page.getByRole('navigation', { name: t('barLabel') }).getByRole('button', { name: t('barMore') }).click();
    await page.getByRole('dialog', { name: t('barMore') }).getByRole('button', { name: t('share'), exact: true }).click();
  } else {
    await page.getByRole('toolbar', { name: t('actionsLabel') }).getByRole('button', { name: t('share'), exact: true }).click();
  }
  const dialog = page.getByRole('dialog', { name: t('shareTitle') });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Open Help (in the top bar on a computer, in the bar's More sheet on a phone). */
export async function openHelp(page: Page): Promise<Locator> {
  if (await phoneLayout(page)) {
    await page.getByRole('navigation', { name: t('barLabel') }).getByRole('button', { name: t('barMore') }).click();
    await page.getByRole('dialog', { name: t('barMore') }).getByRole('button', { name: t('help'), exact: true }).click();
  } else {
    await page.getByRole('toolbar', { name: t('actionsLabel') }).getByRole('button', { name: t('help'), exact: true }).click();
  }
  const dialog = page.getByRole('dialog', { name: t('helpTitle') });
  await expect(dialog).toBeVisible();
  return dialog;
}

export function settingsButton(page: Page): Locator {
  return page.getByRole('banner').getByRole('button', { name: t('settings'), exact: true });
}

/**
 * Expect the polite live region (role status) to have announced `text`. Each message stays there
 * for 10 s, so this is checked right after the action that announces it.
 */
export async function expectAnnounced(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: text }).first()).toBeAttached();
}

// ------------------------------------------------------------------ the drawing

/** The drawing: every part and node a button, named ("R1, resistor", "Node out"). */
export function drawing(page: Page): Locator {
  return page.getByRole('application', { name: /^Drawing of the circuit: / });
}

export function partOnDrawing(page: Page, name: string): Locator {
  return drawing(page).getByRole('button', { name: new RegExp(`^${name}, `) });
}

/** Everything written on the drawing (the picture's words, results and red pen included). */
export async function drawnText(page: Page): Promise<string> {
  return (await page.locator('.nb-canvas svg[role="img"]').textContent()) ?? '';
}

/** Open a part's card (click it on the drawing); its value field has the focus. */
export async function openCard(page: Page, name: string): Promise<Locator> {
  await partOnDrawing(page, name).click();
  const card = page.getByRole('dialog', { name: new RegExp(`^${name} `) });
  await expect(card).toBeVisible();
  return card;
}

// ------------------------------------------------------------------ the Numbers panel's tables

export function nodeTable(page: Page): Locator {
  return page.getByRole('table', { name: t('nodesCaption') });
}

export function currentsTable(page: Page): Locator {
  return page.getByRole('table', { name: t('currentsCaption') });
}

export function tfTable(page: Page): Locator {
  return page.getByRole('table', { name: t('tfCaption') });
}

/** Open the Numbers panel once ngspice has solved the netlist: "ngspice finished the simulation." */
export async function expectFinished(page: Page): Promise<Locator> {
  await expectSolved(page);
  const numbers = await openPanel(page, 'numbers');
  await expect(numbers.getByText(t('statusFinishedText'))).toBeVisible({ timeout: RUN_TIMEOUT });
  return numbers;
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

/** Where the UI shows one ngspice vector: the plain-units cell and the "ngspice printed" cell. */
export interface Shown {
  shown: Locator;
  printed: Locator;
  /** Currents are shown as a size and a direction in words, so the shown number has no sign. */
  sizeOnly: boolean;
  units: readonly string[];
}

const RATIOS = ['V/V', 'A/A', 'A/V', 'V/A'] as const;

/** Find a vector by its ngspice name (as in the native recordings): v(a), i(vx), v(transfer_function) … */
export function shownVector(page: Page, vector: string): Shown {
  const name = vector.toLowerCase();
  const tf = tfTable(page);
  const tfRow = (label: RegExp, units: readonly string[]): Shown => {
    const cells = rowNamed(tf, label).getByRole('cell');
    return { shown: cells.nth(0), printed: cells.nth(1), sizeOnly: false, units };
  };
  if (name === 'v(transfer_function)') return tfRow(/^Transfer function /, RATIOS);
  if (/^v\(.+#input_impedance\)$/.test(name)) return tfRow(/^Input resistance seen by /, ['Ω']);
  if (/^v\(output_impedance_at_.+\)$/.test(name)) return tfRow(/^Output resistance at /, ['Ω']);
  const node = /^v\((.+)\)$/.exec(name);
  if (node) {
    const cells = rowNamed(nodeTable(page), node[1]!).getByRole('cell');
    return { shown: cells.nth(0), printed: cells.nth(1), sizeOnly: false, units: ['V'] };
  }
  const current = /^i\((.+)\)$/.exec(name);
  if (current) {
    const cells = currentsTable(page).getByRole('row').filter({ hasText: `i(${current[1]}) =` }).getByRole('cell');
    return { shown: cells.nth(0), printed: cells.last(), sizeOnly: true, units: ['A'] };
  }
  throw new Error(`no place in the results for ${vector}`);
}

/** Expect a vector shown in plain units (4 figures) and as ngspice printed it (6 figures). */
export async function expectShown(page: Page, vector: string, value: number, why: string): Promise<void> {
  const where = shownVector(page, vector);
  const text = await shownText(where.shown);
  const read = where.units.map((u) => readPlain(text, u)).find((v) => v !== undefined);
  expect(read, `${why}: "${text}" is a number in plain units (${where.units.join(' or ')})`).toBeDefined();
  // Shown with 4 significant figures, printed with 7: each must round to the expected value.
  const target = where.sizeOnly ? Math.abs(value) : value;
  expect(agrees(read!, target, 4), `${why}: shows "${text}", expected ${target}`).toBe(true);
  const printed = readPrinted((await where.printed.textContent()) ?? '');
  expect(agrees(printed, value, 6), `${why}: ngspice printed ${printed}, expected ${value}`).toBe(true);
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
 * Run axe on the page as it is now and expect no violations; the message lists what failed and
 * where. axe can fail outright when the page changes under it (a live-region message is removed
 * after 10 s): then it looks again, up to three times.
 */
export async function expectNoAxeViolations(page: Page, state: string): Promise<number> {
  let results: Awaited<ReturnType<AxeBuilder['analyze']>> | undefined;
  for (let attempt = 1; !results; attempt++) {
    await settle(page);
    try {
      results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
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

/** How far the page can scroll sideways (0 when everything fits the width). */
export function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

// ------------------------------------------------------------------ the editor (decision 0017)

/**
 * Where a point of the drawing's grid is on the screen now (the drawing's own coordinates, as the
 * *@ lines write them): read from the drawing's transform, so a test can click a pin or a place.
 */
export async function gridPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const view = await page.evaluate(() => {
    const world = document.querySelector<HTMLElement>('.nb-world');
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(world?.style.transform ?? '');
    const r = document.querySelector('.nb-canvas')!.getBoundingClientRect();
    return m ? { x: Number(m[1]) + r.left, y: Number(m[2]) + r.top, unit: Number(m[3]) * 20 } : undefined;
  });
  if (!view) throw new Error('the drawing has no view yet');
  return { x: view.x + x * view.unit, y: view.y + y * view.unit };
}

/** Start a new circuit on a blank page (Ctrl+K, as the keyboard does it). */
export async function newCircuit(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: t('paletteTitle') });
  await palette.getByRole('combobox').fill('new circuit');
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole('heading', { name: t('emptyTitle') })).toBeVisible();
}

/** The netlist as the store has it (the autosave writes it a moment after each change made by the student). */
export async function savedNetlist(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('plainspice:netlist'));
}

/** The parts toolbar in the page's margin (a computer). */
export function partsToolbar(page: Page): Locator {
  return page.getByRole('toolbar', { name: t('partsLabel') });
}
