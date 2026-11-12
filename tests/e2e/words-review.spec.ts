/**
 * 13. The final reviews of milestone 2, in a real browser: the words review (decision 0017, "After the
 * final reviews"), the results' handwriting on a first visit (phone review F6, decision 0015) and the
 * security policy on every page of the site (security review F3, decision 0012).
 *
 * - A card links to "the fix" in Checks only for a check that has one, else to "why" (W3).
 * - Connections say that Connect to makes two nodes one, with every part on them, and that Disconnect
 *   first, then Connect to, moves one end alone, which is true (W2); they promise no wire, which a
 *   circuit without ground does not get.
 * - The card says "node in is higher", on the card and to screen readers (W8).
 * - The first numbers of a first visit are drawn in Caveat, not in a fallback face; on a run=1 link
 *   the font waits until ngspice.wasm has come, so the first numbers come no later (F6).
 * - The engine check, the licences and the design pages carry the app's policy and work under it (F3).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { encodeShare } from '../../src/share/link.ts';
import {
  RUN_TIMEOUT,
  START_HERE,
  chooseExample,
  drawing,
  expectAnnounced,
  expectSolved,
  gridPoint,
  hintLine,
  isPhone,
  openApp,
  openCard,
  panel,
  savedNetlist,
  settle,
  t,
} from './helpers.ts';

/** Click a point of the drawing's grid (its own coordinates, as the *@ lines write them). */
async function clickAt(page: Page, x: number, y: number): Promise<void> {
  const p = await gridPoint(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

test.describe('the words review', () => {
  test.beforeEach(({ page }) => {
    test.skip(isPhone(page), 'the computer: placing with the keys and the mouse (the card’s words are the same on a phone)');
  });

  test('a card offers the fix in Checks only for a check that has one, else why (W3)', async ({ page }) => {
    await openApp(page);
    await expectSolved(page);
    await settle(page);
    // A transconductance source on empty paper: its current has nowhere to go, and no fix can know where it should.
    await clickAt(page, 4, 9);
    await page.keyboard.press('g');
    await clickAt(page, 14, 3);
    const g = page.getByRole('dialog', { name: /^G1 / });
    await expect(g.getByText(/G1’s current has nowhere to go|G1's current has nowhere to go/)).toBeVisible({ timeout: RUN_TIMEOUT });
    await expect(g.getByRole('button', { name: t('cardSeeFix') })).toHaveCount(0);
    await g.getByRole('button', { name: t('cardSeeWhy') }).click();
    const checks = panel(page, 'checks');
    await expect(checks.getByText(t('checksIntro'))).toBeVisible();
    await expect(checks.getByRole('heading', { name: /G1.s current has nowhere to go/ })).toBeVisible();
    await expect(checks.getByRole('group', { name: t('fixesLabel', { line: 5 }) })).toHaveCount(0);
    // 1M is a milliohm: here Checks has a fix, and the card says so.
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => savedNetlist(page)).not.toContain('G1 ');
    const r1 = await openCard(page, 'R1');
    await r1.getByRole('textbox').fill('1M');
    await expect(r1.getByRole('button', { name: t('cardSeeFix') })).toBeVisible({ timeout: RUN_TIMEOUT });
    await r1.getByRole('button', { name: t('cardSeeFix') }).click();
    await expect(checks.getByRole('group', { name: t('fixesLabel', { line: 3 }) }).getByRole('button').first()).toBeVisible();
  });

  test('Connections say Connect to makes two nodes one; Disconnect, then Connect to, moves one end alone (W2)', async ({ page }) => {
    await openApp(page);
    await expectSolved(page);
    await settle(page);
    const card = await openCard(page, 'R1');
    await card.getByRole('button', { name: new RegExp(`^${t('connTitle')}`) }).click();
    await expect(card.getByText(t('connIntro'))).toBeVisible();
    await expect(hintLine(page)).toHaveText(t('hintConnections'));
    await expect(card.getByRole('button', { name: 'Connect to another node: the node at the end 2 of R1', exact: true })).toBeVisible();
    // No button's name ends on a bare node name ("…from its node, out" was heard as "from its node out…", W8).
    const disconnect = card.getByRole('button', { name: /^Disconnect / });
    await expect(disconnect).toHaveCount(2);
    await expect(disconnect.nth(0)).toHaveAccessibleName('Disconnect the end 1 of R1 from its node');
    await expect(disconnect.nth(1)).toHaveAccessibleName('Disconnect the end 2 of R1 from its node');
    // The advice works: end 2 of R1 alone goes to ground, and R2 stays between out and ground (not shorted).
    await card.getByRole('button', { name: 'Disconnect the end 2 of R1 from its node', exact: true }).click();
    await expect.poll(() => savedNetlist(page)).toMatch(/^R1 in (?!out\b)\w+ 1k$/m);
    await card.getByRole('button', { name: 'Connect to another node: the node at the end 2 of R1' }).click();
    await card.getByRole('group', { name: t('connTo', { role: 'end 2', name: 'R1' }) }).getByRole('button', { name: t('groundWords') }).click();
    await expect.poll(() => savedNetlist(page)).toMatch(/^R1 in 0 1k$/m);
    expect(await savedNetlist(page)).toMatch(/^R2 out 0 2k$/m);
  });

  test('Connections promise no wire: on a circuit without ground, Connect to ground gives the node a ground symbol (W2)', async ({ page }) => {
    await openApp(page);
    await expectSolved(page);
    await chooseExample(page, 'Mistake 1: no ground (node 0)');
    const card = await openCard(page, 'V1');
    await card.getByRole('button', { name: new RegExp(`^${t('connTitle')}`) }).click();
    // What the card and the hint line say holds whatever is drawn for it: the two nodes become one.
    await expect(card.getByText(t('connIntro'))).toBeVisible();
    await expect(hintLine(page)).toHaveText(t('hintConnections'));
    expect(t('connIntro')).not.toMatch(/\bwires?\b/);
    expect(t('hintConnections')).not.toMatch(/\bwires?\b/);
    const before = readFileSync(resolve(import.meta.dirname, '../../examples/sp01/sp01-4-no-ground.cir'), 'utf8');
    await card.getByRole('button', { name: 'Connect to another node: the node at the + end of V1', exact: true }).click();
    await card.getByRole('group', { name: t('connTo', { role: '+ end', name: 'V1' }) }).getByRole('button', { name: t('groundWords') }).click();
    // Here no wire finds a way to ground (there is none yet): the node is made ground by name, and the
    // drawing gets a ground symbol for it. V1, R1 and every other part on n1 are on ground now.
    await expectAnnounced(page, 'Node n1 renamed to 0. Node n1 is now ground (node 0).');
    await expect.poll(() => savedNetlist(page)).toMatch(/^V1 0 n3 6$/m);
    const after = (await savedNetlist(page)) ?? '';
    expect(after).toMatch(/^R1 0 n2 2$/m);
    const lines = (text: string, kind: string): string[] => text.split(/\r?\n/).filter((l) => l.startsWith(`*@ ${kind} `));
    expect(lines(before, 'wire')).toHaveLength(5);
    expect(lines(after, 'wire')).toEqual(lines(before, 'wire'));
    expect(lines(after, 'ground')).toHaveLength(lines(before, 'ground').length + 1);
  });
});

test('the card names the higher end as a node: “node in is higher”, also to screen readers (W8)', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  const card = await openCard(page, 'R1');
  const results = card.getByRole('list', { name: t('cardResults') });
  const across = results.getByRole('listitem').filter({ hasText: t('readoutAcross') });
  await expect(across.locator('.readout__sub').first()).toHaveText('node in is higher');
  await expect(across.locator('.visually-hidden')).toHaveText('2 volts across R1, node in is higher. V(in) minus V(out) is 2 volts');
  // Not the drawing's short labels: the current's line stays "from in to out".
  await expect(results.getByRole('listitem').filter({ hasText: t('readoutThrough') }).locator('.readout__sub')).toHaveText('from in to out');
});

test('a first visit has the results’ handwriting loaded before ngspice’s first numbers (F6)', async ({ page }) => {
  // The moment the status line first says Finished (before the browser lays the numbers out): is Caveat 700 there?
  await page.addInitScript(() => {
    const w = window as unknown as { caveatAtFirstNumbers?: string };
    const caveat = (): string => {
      for (const f of document.fonts) if (f.family.replace(/['"]/g, '') === 'Caveat' && f.weight === '700') return f.status;
      return 'not declared';
    };
    new MutationObserver((_, observer) => {
      if (!/Finished in \d+ ms/.test(document.querySelector('.status')?.textContent ?? '')) return;
      w.caveatAtFirstNumbers = caveat();
      observer.disconnect();
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await openApp(page);
  await expectSolved(page);
  expect(await page.evaluate(() => (window as unknown as { caveatAtFirstNumbers?: string }).caveatAtFirstNumbers)).toBe('loaded');
  // Downloaded once: the early load is the same request the drawing's text uses.
  expect(await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\/caveat-700-[\w-]+\.woff2$/.test(e.name)).length)).toBe(1);
});

test('on a run=1 link the handwriting waits for ngspice.wasm, then loads before the first numbers (F6)', async ({ page }) => {
  // A run=1 link preloads ngspice.wasm from the page's head. The font must not share the connection
  // with it (on a slow phone that brought the first numbers about 0.24 s later): ngspice.wasm is held
  // back here, and until it has come nothing may ask for Caveat 700.
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let asked = 0;
  await page.route(/\/engine\/ngspice-[\w-]+\.wasm$/, async (route) => {
    asked += 1;
    await held;
    await route.continue();
  });
  await page.addInitScript(() => {
    const w = window as unknown as { contentLoaded?: boolean; caveatAtFirstNumbers?: string };
    document.addEventListener('DOMContentLoaded', () => {
      w.contentLoaded = true;
    });
    const caveat = (): string => {
      for (const f of document.fonts) if (f.family.replace(/['"]/g, '') === 'Caveat' && f.weight === '700') return f.status;
      return 'not declared';
    };
    new MutationObserver((_, observer) => {
      if (!/Finished in \d+ ms/.test(document.querySelector('.status')?.textContent ?? '')) return;
      w.caveatAtFirstNumbers = caveat();
      observer.disconnect();
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const caveat = (): Promise<string> =>
    page.evaluate(() => {
      for (const f of document.fonts) if (f.family.replace(/['"]/g, '') === 'Caveat' && f.weight === '700') return f.status;
      return 'not declared';
    });
  await page.goto(`./#${await encodeShare(START_HERE, { run: true })}`);
  // The page is up and drawn, DOMContentLoaded has come, and the engine is still on its way.
  await expect.poll(() => asked).toBeGreaterThan(0);
  await page.waitForFunction(() => (window as unknown as { contentLoaded?: boolean }).contentLoaded === true);
  await expect(drawing(page)).toBeAttached();
  expect(await caveat()).toBe('unloaded');
  release();
  await expectSolved(page);
  // Asked for once ngspice.wasm had come, before the first numbers: by then it was on its way, or there.
  expect(await page.evaluate(() => (window as unknown as { caveatAtFirstNumbers?: string }).caveatAtFirstNumbers)).toMatch(/^(loading|loaded)$/);
  await expect.poll(caveat).toBe('loaded');
  expect(await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\/caveat-700-[\w-]+\.woff2$/.test(e.name)).length)).toBe(1);
});

test.describe('the security policy on every page of the site (F3)', () => {
  test.beforeEach(({ page }) => {
    test.skip(isPhone(page), 'one policy for every device: checked once, on the computer');
  });

  /** Each page, and how to tell it works: what it shows once it has done its job. */
  const PAGES: { path: string; works: (page: Page) => Promise<void> }[] = [
    { path: './spike/', works: async (page) => expect(page.locator('#fixtures-summary')).toHaveText(/^(\d+) of \1 checks agree/, { timeout: 60_000 }) },
    { path: './licenses/', works: async (page) => expect(page.getByRole('heading', { level: 1 })).toHaveText('Licences and source') },
    { path: './design/', works: async (page) => expect(page.getByRole('heading', { level: 1 })).toHaveText('Three directions for PlainSpice') },
    { path: './design/lab/', works: async (page) => expect(page.locator('#cards svg').first()).toBeVisible() },
    { path: './design/checkpoint/', works: async (page) => expect(page.getByText(/Solved in \d+ ms/)).toBeVisible({ timeout: RUN_TIMEOUT }) },
    // The three prototypes solve the divider with real ngspice: out = 4 V.
    ...['notebook', 'playground', 'studio'].map((name) => ({
      path: `./design/prototypes/${name}/`,
      // (A no-break or a thin space before the unit: \s takes them all.)
      works: async (page: Page) => expect.poll(() => page.locator('body').innerText(), { timeout: RUN_TIMEOUT }).toMatch(/\b4\sV\b/),
    })),
  ];

  test('each page carries the app’s policy, without the app’s inline script, and works under it with no violation', async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => {
      const w = window as unknown as { violations: string[] };
      w.violations = [];
      document.addEventListener('securitypolicyviolation', (e) => w.violations.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    // Read at once (null when the page has none), not waited for.
    const policyOf = (): Promise<string | null> => page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? null);
    await page.goto('./');
    const app = await policyOf();
    expect(app).toMatch(/'sha256-[\w+/=]+'/);
    for (const { path, works } of PAGES) {
      await page.goto(path);
      await works(page);
      // The app's policy, less the hash of the one inline script only the app page has.
      expect(await policyOf(), path).toBe(app!.replace(/ 'sha256-[\w+/=]+'/, ''));
      await expect(page.locator('link[rel="manifest"]'), path).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { violations: string[] }).violations), path).toEqual([]);
    }
  });
});

test('Connect to does what the card says: the two nodes become one, with every part on them (W2)', async ({ page }) => {
  test.skip(isPhone(page), 'the computer (the phone’s card has the same Connections)');
  await openApp(page);
  await expectSolved(page);
  const card = await openCard(page, 'R1');
  await card.getByRole('button', { name: new RegExp(`^${t('connTitle')}`) }).click();
  await expect(card.getByRole('button', { name: 'Connect to another node: the node at the end 2 of R1' })).toBeVisible();
  await card.getByRole('button', { name: 'Connect to another node: the node at the end 2 of R1' }).click();
  await card.getByRole('group', { name: t('connTo', { role: 'end 2', name: 'R1' }) }).getByRole('button', { name: t('groundWords') }).click();
  // What the card said would happen: the two nodes are one now, and R2 is on it at both ends.
  await expectAnnounced(page, /Node out and ground are now one node, ground\./);
  await expect.poll(() => savedNetlist(page)).toMatch(/^R2 0 0 2k$/m);
});
