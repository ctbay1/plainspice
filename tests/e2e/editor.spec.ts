/**
 * 11. The schematic editor (decision 0017), in a real browser: Start here built on a blank page with
 * the mouse and again with the keyboard only (no pointer event at all), both solved by ngspice to
 * out = 4 V; dragging, a refused move with its reason, Turn, Mirror, Reverse, a piece of wire deleted
 * (a node splits), a node renamed and joined by name, a part deleted while a line still names it,
 * undo back to the exact starting text and redo to the end, the *@ block in the netlist, and a share
 * link that opens the same drawing; axe in each editing state.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  drawing,
  drawnText,
  expectAnnounced,
  expectNoAxeViolations,
  expectSolved,
  fullNetlistText,
  gridPoint,
  hintLine,
  isPhone,
  newCircuit,
  openApp,
  openShare,
  panel,
  partOnDrawing,
  partsToolbar,
  RUN_TIMEOUT,
  savedNetlist,
  setNetlist,
  setNetlistWithDrawing,
  settle,
  closePanel,
  t,
  TYPING,
} from './helpers.ts';

/** Start here with a .tf line that names V1 (so deleting V1 leaves a line that still names it). */
const TEXT = '* edit me\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.tf v(out) V1\n.end\n';

/** The drawing's symbols where the drawing puts them (their transforms, in its own coordinates). */
async function symbols(page: Page): Promise<string[]> {
  return (await page.locator('.nb-ink .nb-part > g').evaluateAll((gs) => gs.map((g) => g.getAttribute('transform') ?? ''))).sort();
}

/**
 * Give a part on the drawing the focus, and wait until it has it and is the drawing's current item: a
 * card or a panel that just closed gives the focus back a frame later, which must not take it from here.
 */
async function focusPart(page: Page, name: string): Promise<void> {
  const button = partOnDrawing(page, name);
  await expect(async () => {
    await button.focus();
    await page.waitForTimeout(100);
    await expect(button).toBeFocused({ timeout: 200 });
    await expect(button).toHaveAttribute('aria-current', 'true', { timeout: 200 });
  }).toPass({ timeout: 10_000 });
}

/** Click a grid point (a pin, a place on the paper) with the mouse. */
async function clickAt(page: Page, x: number, y: number): Promise<void> {
  const p = await gridPoint(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

/** Drag from one grid point to another in small steps, as a hand does. */
async function dragFromTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, drop = true): Promise<void> {
  const a = await gridPoint(page, from.x, from.y);
  const b = await gridPoint(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
  if (drop) await page.mouse.up();
}

test('builds Start here on a blank page with the mouse: place, values, turn, ground, wires, a name; out = 4 V', async ({ page }) => {
  test.skip(isPhone(page), 'a phone places by tapping (the phone tests)');
  await openApp(page);
  await newCircuit(page);
  const tools = partsToolbar(page);
  const place = async (tool: RegExp, x: number, y: number, turns = 0): Promise<void> => {
    await tools.getByRole('button', { name: tool }).click();
    for (let i = 0; i < turns; i++) await page.keyboard.press('t');
    await clickAt(page, x, y);
  };
  // V1 upright at (0, 3), its pins at (0, 1) and (0, 5). Back on Select, its card opens on its value.
  await place(/^Voltage source/, 0, 3);
  const v1 = page.getByRole('dialog', { name: /^V1 / });
  await expect(v1.getByRole('textbox')).toBeFocused();
  await page.keyboard.type('6', TYPING);
  await page.keyboard.press('Enter');
  // The first part on a blank page also wrote .op and .end, so ngspice has something to run.
  await expect.poll(() => savedNetlist(page)).toMatch(/^\* circuit\nV1 n1 n2 6\n\.op\n[\s\S]*\.end\n$/);
  await expectAnnounced(page, /V1 added between node n1 and node n2\. PlainSpice also wrote \.op, which asks ngspice for the DC voltages and currents \(the operating point\)/);
  // R1 across at (4, 0): pins (2, 0) and (6, 0); it keeps 1k.
  await place(/^Resistor/, 4, 0);
  await expect(page.getByRole('dialog', { name: /^R1 / })).toBeVisible();
  await page.keyboard.press('Enter');
  // R2 turned upright (T, while it is in hand) at (8, 3): pins (8, 1) and (8, 5); 2k.
  await place(/^Resistor/, 8, 3, 1);
  await expect(page.getByRole('dialog', { name: /^R2 / }).getByRole('textbox')).toBeFocused();
  await page.keyboard.type('2k', TYPING);
  await page.keyboard.press('Enter');
  // Ground on V1's − pin: that node becomes ground.
  await place(/^Ground/, 0, 5);
  await expectAnnounced(page, /Node n2 is now ground \(node 0\)/);
  // Three wires, pin to pin.
  await tools.getByRole('button', { name: t('toolWire') }).click();
  await expect(hintLine(page)).toHaveText(t('hintWire'));
  for (const [a, b] of [
    [[0, 1], [2, 0]],
    [[6, 0], [8, 1]],
    [[8, 5], [0, 5]],
  ] as const) {
    await clickAt(page, a[0], a[1]);
    await expect(hintLine(page)).toHaveText(t('hintWireOn'));
    await clickAt(page, b[0], b[1]);
    await expectAnnounced(page, /Wire added\./);
  }
  await page.keyboard.press('Escape');
  await expect.poll(() => savedNetlist(page)).toContain('R2 n4 0 2k');
  // The node between R1 and R2 is named out on its card.
  await drawing(page).getByRole('button', { name: 'Node n4' }).click();
  const card = page.getByRole('dialog', { name: /^Node n4/ });
  await card.getByRole('textbox', { name: t('nodeCardName') }).fill('out');
  await card.getByRole('textbox', { name: t('nodeCardName') }).press('Enter');
  await expectAnnounced(page, 'Node n4 renamed to out.');
  await expectSolved(page);
  await expect(drawing(page).getByRole('button', { name: 'Node out' })).toHaveAccessibleDescription(/out is 4 volts/, { timeout: RUN_TIMEOUT });
  expect(await drawnText(page)).toMatch(/=\s4\sV/);
  await expect.poll(() => savedNetlist(page)).toMatch(/^\* circuit\nV1 n1 0 6\nR1 n1 out 1k\nR2 out 0 2k\n\.op\n\* plainspice-drawing v1\n/);
});

test('builds Start here again with the keyboard only (no pointer at all), through Ctrl+K and the Add a part form', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    (window as unknown as { pointers: number }).pointers = 0;
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'click'] as const) {
      window.addEventListener(type, (e) => {
        if ((e as PointerEvent).pointerType || (e as MouseEvent).detail) (window as unknown as { pointers: number }).pointers++;
      }, true);
    }
  });
  const press = (k: string): Promise<void> => page.keyboard.press(k);
  const focusedText = (): Promise<string> => page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.textContent ?? ''}`);
  await newCircuit(page);
  const add = async (kind: string, value: string, ends: readonly { pick: string; name?: string }[]): Promise<void> => {
    await press('ControlOrMeta+k');
    await page.keyboard.type('add a part', TYPING);
    await press('Enter');
    const form = page.getByRole('dialog', { name: t('formTitle') });
    await expect(form).toBeVisible();
    await expect.poll(() => form.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    // The fields in order: the part, its value, then each end's node (and a new node's name).
    while (!(await form.getByRole('combobox', { name: t('formKind') }).evaluate((e) => e === document.activeElement))) await press('Tab');
    await page.keyboard.type(kind, TYPING);
    await press('Tab');
    await press('ControlOrMeta+a');
    await page.keyboard.type(value, TYPING);
    for (const end of ends) {
      await press('Tab');
      await page.keyboard.type(end.pick, TYPING);
      if (end.name !== undefined) {
        await press('Tab');
        await press('ControlOrMeta+a');
        await page.keyboard.type(end.name, TYPING);
      }
    }
    for (let i = 0; i < 6 && !/^BUTTON Add [VR]\d$/.test(await focusedText()); i++) await press('Tab');
    await press('Enter');
    await expect(form).toHaveCount(0);
  };
  await add('Voltage', '6', [{ pick: 'a new', name: 'in' }, { pick: 'ground' }]);
  await expectAnnounced(page, 'V1 added between node in and ground. PlainSpice also wrote .op, which asks ngspice for the DC voltages and currents (the operating point), so the circuit runs as you build it. Keep .end as the netlist’s last line, with new lines above it: ngspice still reads lines after .end.');
  await add('Resistor', '1k', [{ pick: 'in' }, { pick: 'a new', name: 'out' }]);
  await add('Resistor', '2k', [{ pick: 'out' }, { pick: 'ground' }]);
  await expect.poll(() => savedNetlist(page)).toBe('* circuit\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n');
  await expectSolved(page);
  // The new part has the focus on the drawing; ngspice's numbers are in its description.
  await expect(partOnDrawing(page, 'R2')).toBeFocused();
  await expect(drawing(page).getByRole('button', { name: 'Node out' })).toHaveAccessibleDescription(/out is 4 volts/, { timeout: RUN_TIMEOUT });
  expect(await page.evaluate(() => (window as unknown as { pointers: number }).pointers), 'no pointer event at all').toBe(0);
});

test('drag, a refused move, turn, mirror, reverse, a wire deleted, rename and join, delete; undo to the start and redo to the end; a link opens the same drawing', async ({ page, context }) => {
  test.skip(isPhone(page), 'the computer: a mouse and the keys (the phone has its own tests)');
  await openApp(page);
  await setNetlist(page, TEXT);
  await closePanel(page, 'netlist');
  await expectSolved(page);
  // The panel gives the focus back to its tab a frame after it closes: let that happen first.
  await settle(page);
  const steps: string[] = [];
  // A piece of wire: Select, click it, Delete. Ground's bottom wire splits off R2's end.
  await clickAt(page, 4, 6);
  await expect(hintLine(page)).toHaveText(t('hintWireSelected', { node: t('groundWords') }));
  await page.keyboard.press('Delete');
  // The piece cut off ground is R2's end; the first edit made on the drawing also says it wrote the drawing lines.
  await expectAnnounced(page, `Piece of wire deleted. R2 no longer connects to ground: that end is now on a node of its own, n1. ${t('drawingWritten')}`);
  steps.push('wire');
  // Drag R2 two grid steps to the right: its wires follow; one undo step.
  await dragFromTo(page, { x: 8, y: 3 }, { x: 10, y: 3 });
  await expectAnnounced(page, 'R2 moved.');
  await expect.poll(() => savedNetlist(page)).toContain('*@ R2 10 3 0');
  steps.push('drag');
  // A refused move: R2 onto R1. While dragging the hint says why; dropped, it goes back.
  await dragFromTo(page, { x: 10, y: 3 }, { x: 4, y: 0 }, false);
  await expect(hintLine(page)).toContainText('R2 can’t go here: that place is taken by R1');
  await page.mouse.up();
  await expectAnnounced(page, 'R2 went back: that place is taken by R1.');
  await expect.poll(() => savedNetlist(page)).toContain('*@ R2 10 3 0');
  // Turn and Mirror (the drawing only), Reverse (the netlist), with the keys on the selected part.
  await focusPart(page, 'R2');
  await page.keyboard.press('t');
  await expectAnnounced(page, 'R2 turned.');
  await page.keyboard.press('m');
  await expectAnnounced(page, 'R2 mirrored.');
  steps.push('turn', 'mirror');
  await focusPart(page, 'V1');
  await page.keyboard.press('Shift+R');
  await expectAnnounced(page, 'V1 reversed.');
  await expect.poll(() => savedNetlist(page)).toContain('V1 0 in 6');
  steps.push('reverse');
  // A node renamed on its card, then renamed to a name another node has: they are joined.
  await drawing(page).getByRole('button', { name: 'Node out' }).click();
  let card = page.getByRole('dialog', { name: /^Node out/ });
  await card.getByRole('textbox', { name: t('nodeCardName') }).fill('vout');
  await card.getByRole('button', { name: t('nodeCardRename') }).click();
  await expectAnnounced(page, 'Node out renamed to vout.');
  card = page.getByRole('dialog', { name: /^Node vout/ });
  await card.getByRole('textbox', { name: t('nodeCardName') }).fill('in');
  await card.getByRole('button', { name: t('nodeCardRename') }).click();
  await expectAnnounced(page, 'Node vout renamed to in. A node called in was already there, so the two are now one node, in.');
  steps.push('rename', 'join');
  await page.keyboard.press('Escape');
  // Delete V1: the .tf line still names it; the page offers that line in the Netlist panel.
  await focusPart(page, 'V1');
  await page.keyboard.press('Delete');
  // V1's line is gone: .tf is line 4 now, and the button takes the cursor there (not to the drawing lines' header).
  await expectAnnounced(page, 'V1 deleted. .tf (line 4) still names V1.');
  steps.push('delete');
  const show = page.getByRole('button', { name: t('goToLine', { line: 4 }) });
  await expect(show).toBeVisible();
  await show.click();
  await expect(panel(page, 'netlist')).toBeVisible();
  await expect(panel(page, 'netlist')).toContainText(/Line 4: \.tf\b/);
  // The cursor's line (the editor's active line, without the results shown at its end) is the .tf line,
  // once the editor (loaded when the panel first opens) has taken it there.
  const activeLine = (): Promise<string> =>
    panel(page, 'netlist')
      .locator('.cm-activeLine')
      .evaluate((line) => {
        const copy = line.cloneNode(true) as HTMLElement;
        for (const extra of copy.querySelectorAll('[aria-hidden="true"], [contenteditable="false"], img')) extra.remove();
        return copy.textContent ?? '';
      });
  await expect.poll(activeLine).toBe('.tf v(in) V1');
  await closePanel(page, 'netlist');
  // The autosave writes a moment after each change: the deletion is in the saved netlist once it has.
  await expect.poll(() => savedNetlist(page)).not.toMatch(/^V1 /m);
  const final = (await savedNetlist(page))!;
  expect(final).toContain('* plainspice-drawing v1');
  // Undo, one step at a time, back to the exact starting text; Redo to the end.
  const undo = page.getByRole('button', { name: t('undo') });
  for (let i = 0; i < steps.length; i++) await undo.click();
  await expect.poll(() => savedNetlist(page)).toBe(TEXT);
  await expectAnnounced(page, 'Undone: piece of wire deleted.');
  const redo = page.getByRole('button', { name: t('redo') });
  for (let i = 0; i < steps.length; i++) await redo.click();
  await expect.poll(() => savedNetlist(page)).toBe(final);
  // Run out, it stays a button with the focus (aria-disabled), and says so when pressed.
  await expect(redo).toHaveAttribute('aria-disabled', 'true');
  // The netlist carries the drawing (the *@ lines), and a link opens the same drawing.
  expect((await fullNetlistText(page)).trim()).toBe(final.trim());
  const share = await openShare(page);
  const link = await share.getByRole('textbox', { name: t('shareLinkLabel') }).inputValue();
  await page.keyboard.press('Escape');
  const drawn = await symbols(page);
  const other = await context.newPage();
  await openApp(other, link);
  expect(await symbols(other)).toEqual(drawn);
  expect((await fullNetlistText(other)).trim()).toBe(final.trim());
});

test('a double click on a part’s value opens its card with the value selected; another version’s drawing is not changed, and says why', async ({ page }) => {
  test.skip(isPhone(page), 'a double click (a phone taps the part)');
  await openApp(page);
  await expectSolved(page);
  // R2's value as the drawing writes it ("2 kΩ"): a double click there opens its card on the value.
  // Measured once the page is still (the fonts in, the drawing fitted), so the click lands on it.
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  const value = page.locator('.nb-ink text').filter({ hasText: /^2\skΩ$/ }).first();
  const box = (await value.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const field = page.getByRole('dialog', { name: /^R2 / }).getByRole('textbox');
  await expect(field).toBeFocused();
  expect(await field.evaluate((f: HTMLInputElement) => [f.selectionStart, f.selectionEnd, f.value.length])).toEqual([0, 2, 2]);
  await page.keyboard.press('Escape');
  // A drawing saved by another version: the model refuses to change it, and the page says why.
  const other = TEXT.replace('.end\n', '* plainspice-drawing v9\n*@ V1 0 3 0\n.end\n');
  await setNetlistWithDrawing(page, other);
  await closePanel(page, 'netlist');
  await focusPart(page, 'R2');
  await page.keyboard.press('t');
  await expectAnnounced(page, /saved by another version of PlainSpice/);
  expect(await savedNetlist(page)).toBe(other);
});

test('a phone: a wide drawing turned to fit is shown as drawn while editing, and turned again after', async ({ page }) => {
  test.skip(!isPhone(page), 'the phone’s turned view');
  await openApp(page);
  await page.getByRole('banner').getByRole('button', { name: /^Examples/ }).click();
  await page.getByRole('menu', { name: t('examplesMenu') }).getByRole('menuitem', { name: 'Example 3: open circuit (V_Th)', exact: true }).click();
  await expectSolved(page);
  // Turned to fit (drawn as in its video, p02-4 turned still needs a drag to see it all).
  await expect(hintLine(page)).toHaveText(/^Turned to fit/);
  const bar = page.getByRole('navigation', { name: t('barLabel') });
  await bar.getByRole('button', { name: t('barParts') }).click();
  await page.getByRole('dialog', { name: t('partsSheetTitle') }).getByRole('button', { name: /^Capacitor/ }).click();
  // After the lead, the hint goes on in lower case.
  await expect(hintLine(page)).toHaveText(`${t('hintAsDrawnEditing')} · tap the paper where a capacitor goes · Select goes back`);
  await expect(page.getByRole('button', { name: t('turnToFit'), exact: true })).toBeVisible();
  await bar.getByRole('button', { name: t('toolSelect') }).click();
  // Back to the view the student was reading: turned to fit, the video's drawing one tap away.
  await expectAnnounced(page, t('turnBack'));
  await expect(hintLine(page)).toHaveText(/^Turned to fit/);
  await expect(page.getByRole('button', { name: t('asInVideo'), exact: true })).toBeVisible();
});

test('a phone: a finger drags a part to move it and the paper to pan, two fingers zoom; a piece of wire deleted and drawn again by taps', async ({ page }) => {
  test.skip(!isPhone(page), 'a phone’s fingers');
  await openApp(page);
  await expectSolved(page);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: readonly { x: number; y: number }[]): Promise<unknown> =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })) });
  /** One finger (or two) from here to there, in small steps; `hold`: held still first, so a part lifts. */
  const swipe = async (from: readonly { x: number; y: number }[], to: readonly { x: number; y: number }[], hold = 0): Promise<void> => {
    await touch('touchStart', from);
    if (hold) await page.waitForTimeout(hold);
    for (let i = 1; i <= 12; i++) await touch('touchMove', from.map((a, k) => ({ x: a.x + ((to[k]!.x - a.x) * i) / 12, y: a.y + ((to[k]!.y - a.y) * i) / 12 })));
    await touch('touchEnd', []);
  };
  // A finger that moves at once on R2 pans the paper: a finger meant to pan never picks a part up.
  const r2 = await gridPoint(page, 8, 3);
  const text = await savedNetlist(page);
  await swipe([r2], [{ x: r2.x - 40, y: r2.y }]);
  await expect.poll(async () => (await gridPoint(page, 8, 3)).x).toBeLessThan(r2.x - 20);
  expect(await savedNetlist(page)).toBe(text);
  // Held still for a moment, R2 lifts, and the finger drags it two grid steps to the right; its wires follow.
  await swipe([await gridPoint(page, 8, 3)], [await gridPoint(page, 10, 3)], 500);
  await expectAnnounced(page, 'R2 moved.');
  await expect.poll(() => savedNetlist(page)).toContain('*@ R2 10 3 0');
  // A piece of wire: a tap selects it, its Delete button (named in the hint, which is below it) deletes it, and the node splits.
  const piece = await gridPoint(page, 4, 6);
  await page.touchscreen.tap(piece.x, piece.y);
  await expect(hintLine(page)).toHaveText('A piece of the wire of ground (node 0) selected · tap “Delete the selected piece of wire” to delete it');
  await page.getByRole('toolbar', { name: t('pieceLabel') }).getByRole('button', { name: t('paletteDeleteWire') }).click();
  await expectAnnounced(page, 'Piece of wire deleted. R2 no longer connects to ground: that end is now on a node of its own, n1.');
  await expect.poll(() => savedNetlist(page)).toContain('R2 out n1 2k');
  // Drawn again by taps: Wire (the Parts sheet), a pin, then the other pin.
  await page.getByRole('navigation', { name: t('barLabel') }).getByRole('button', { name: t('barParts') }).click();
  await page.getByRole('dialog', { name: t('partsSheetTitle') }).getByRole('button', { name: /^Wire/ }).click();
  await expect(hintLine(page)).toHaveText(t('hintWirePhone'));
  // The sheet had moved the drawing to keep the selected piece clear of it: it goes back where it was
  // once the page has measured the sheet gone, a frame or more after the hint changes (decision 0018).
  await settle(page);
  const first = await gridPoint(page, 10, 5);
  await page.touchscreen.tap(first.x, first.y);
  await expect(hintLine(page)).toHaveText(t('hintWireOnPhone'));
  // The same pin again: refused, and the way out is the phone's own (it has no Esc key; the words critic, new-20).
  await page.waitForTimeout(400);
  await page.touchscreen.tap(first.x, first.y);
  await expect(hintLine(page)).toHaveText(t('hintWireRefusedPhone', { reason: t('wireSamePoint').replace(/\.$/, '') }));
  await expect(hintLine(page)).not.toContainText('Esc');
  const other = await gridPoint(page, 0, 5);
  await page.touchscreen.tap(other.x, other.y);
  await expectAnnounced(page, 'Wire added.');
  await expect.poll(() => savedNetlist(page)).toContain('R2 out 0 2k');
  // A finger on the paper pans it; two fingers apart zoom in.
  const before = await gridPoint(page, 0, 0);
  const paper = (await page.locator('.nb-canvas').boundingBox())!;
  const empty = { x: paper.x + paper.width * 0.5, y: paper.y + paper.height * 0.75 };
  await swipe([empty], [{ x: empty.x - 60, y: empty.y - 30 }]);
  await expect.poll(async () => (await gridPoint(page, 0, 0)).x).toBeLessThan(before.x - 40);
  const unit = async (): Promise<number> => (await gridPoint(page, 1, 0)).x - (await gridPoint(page, 0, 0)).x;
  const wide = await unit();
  await swipe([{ x: empty.x - 30, y: empty.y }, { x: empty.x + 30, y: empty.y }], [{ x: empty.x - 90, y: empty.y }, { x: empty.x + 90, y: empty.y }]);
  await expect.poll(unit).toBeGreaterThan(wide * 1.5);
});

test('axe: a part in hand, a wire on its way, a part card with its connections, a node card, the Add a part form, a part picked up, a piece of wire', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  const phone = isPhone(page);
  // A part in hand, where it would go.
  if (phone) {
    await page.getByRole('navigation', { name: t('barLabel') }).getByRole('button', { name: t('barParts') }).click();
    await page.getByRole('dialog', { name: t('partsSheetTitle') }).getByRole('button', { name: /^Resistor/ }).click();
    const paper = (await page.locator('.nb-canvas').boundingBox())!;
    await page.touchscreen.tap(paper.x + paper.width * 0.5, paper.y + paper.height * 0.2);
  } else {
    await partsToolbar(page).getByRole('button', { name: /^Resistor/ }).click();
    const p = await gridPoint(page, 13, 3);
    await page.mouse.move(p.x, p.y);
  }
  await expect(page.locator('.nb-hand')).toHaveCount(1);
  await expectNoAxeViolations(page, 'a resistor in hand');
  await page.keyboard.press('Escape');
  if (!phone) {
    // A wire on its way.
    await partsToolbar(page).getByRole('button', { name: t('toolWire') }).click();
    await clickAt(page, 6, 0);
    const p = await gridPoint(page, 12, 2);
    await page.mouse.move(p.x, p.y);
    await expect(page.locator('.nb-draft')).toHaveCount(1);
    await expectNoAxeViolations(page, 'a wire on its way');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }
  // A part's card with its connections shown.
  await partOnDrawing(page, 'R2').click();
  const card = page.getByRole('dialog', { name: /^R2 / });
  await card.getByRole('button', { name: t('connTitle') }).click();
  await expect(card.getByRole('region', { name: t('connTitle') })).toBeVisible();
  await expectNoAxeViolations(page, 'R2’s card, its connections shown');
  // Picked up with Move.
  await card.getByRole('button', { name: t('editMoveLabel', { name: 'R2' }) }).click();
  await expect(page.getByRole('toolbar', { name: t('editMove') })).toBeVisible();
  await expectNoAxeViolations(page, 'R2 picked up');
  await page.keyboard.press('Escape');
  // A node's card.
  await drawing(page).getByRole('button', { name: 'Node out' }).click();
  await expect(page.getByRole('dialog', { name: /^Node out/ })).toBeVisible();
  await expectNoAxeViolations(page, 'the card of node out');
  await page.keyboard.press('Escape');
  // The Add a part form.
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('add a part', TYPING);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: t('formTitle') })).toBeVisible();
  await expectNoAxeViolations(page, 'the Add a part form');
  await page.keyboard.press('Escape');
  if (!phone) {
    // A piece of wire selected.
    await clickAt(page, 4, 6);
    await expect(page.locator('.nb-piece')).toHaveCount(1);
    await expectNoAxeViolations(page, 'a piece of wire selected');
  }
});

test('Ctrl+K has every editing command by name, and the Help lists the editing keys', async ({ page }) => {
  await openApp(page);
  await expectSolved(page);
  await focusPart(page, 'R2');
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: t('paletteTitle') });
  for (const name of [t('paletteAddPart'), t('palettePlace', { part: 'a resistor' }), t('paletteWire'), t('paletteTurn', { name: 'R2' }), t('paletteMirror', { name: 'R2' }), t('paletteReverse', { name: 'R2' }), t('paletteMove', { name: 'R2' }), t('paletteDelete', { name: 'R2' }), t('newCircuit')]) {
    await expect(palette.getByRole('option', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })).toHaveCount(1);
  }
  await palette.getByRole('combobox').fill('turn r2');
  await page.keyboard.press('Enter');
  await expectAnnounced(page, 'R2 turned.');
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('dialog', { name: t('paletteTitle') }).getByRole('option', { name: t('paletteHelp') }).click();
  const help = page.getByRole('dialog', { name: t('helpTitle') });
  await expect(help.getByRole('table', { name: t('helpKeysEditing') })).toContainText(t('helpKeyReverseAction'));
});
