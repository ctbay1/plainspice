/**
 * 5. Export: both items download a file (from the Export menu on a computer, from the bar's More
 * sheet on a phone). The ngspice file is the netlist exactly as written: nothing is added, and
 * where the parts are drawn (the *@ lines, comments to ngspice) goes with it when the netlist has
 * them; the LTspice file has the documented changes (src/export/export.ts, docs/share-links.md) and
 * the app lists them, ending with "not checked in LTspice yet".
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { EXPORT_TEXT } from '../../src/export/export.ts';
import { withDrawingBlock } from '../../src/notebook/schematic.ts';
import { expectAnnounced, isPhone, openApp, openPanel, setNetlist, setNetlistWithDrawing, t } from './helpers.ts';

/** A netlist with all three things the LTspice export changes: gnd, savecurrents and a .control block. */
const NETLIST = `* Export check: gnd, savecurrents and a control block
V1 in gnd 5
R1 in out 1k
R2 out gnd 2k
Vm out gnd
.options savecurrents
.op
.control
run
print all
.endc
.end
`;

/**
 * Worked out by hand from the documented rules: gnd becomes 0 where ngspice reads it as ground
 * (lines 2 and 4, where another word follows it) and stays where it is the last word (line 5, a
 * separate node called gnd); the savecurrents line and the .control block go.
 */
const LTSPICE = `* Export check: gnd, savecurrents and a control block
V1 in 0 5
R1 in out 1k
R2 out 0 2k
Vm out gnd
.op
.end
`;

const FILE_NAME = 'Export-check-gnd-savecurrents-and-a-control-block';

async function exportAs(page: Page, item: string): Promise<{ name: string; text: string }> {
  let choose: () => Promise<void>;
  if (isPhone(page)) {
    await page.getByRole('navigation', { name: t('barLabel') }).getByRole('button', { name: t('barMore') }).click();
    choose = () => page.getByRole('dialog', { name: t('barMore') }).getByRole('button', { name: item }).click();
  } else {
    await page.getByRole('toolbar', { name: t('actionsLabel') }).getByRole('button', { name: t('export') }).click();
    choose = () => page.getByRole('menu', { name: t('exportMenu') }).getByRole('menuitem', { name: item }).click();
  }
  const [download] = await Promise.all([page.waitForEvent('download'), choose()]);
  return { name: download.suggestedFilename(), text: readFileSync(await download.path(), 'utf8') };
}

test('Export for ngspice saves the netlist exactly as written, its drawing lines with it when it has them', async ({ page }) => {
  await openApp(page);
  await setNetlist(page, NETLIST);
  const file = await exportAs(page, t('exportNgspice'));
  expect(file.name).toBe(`${FILE_NAME}.cir`);
  // Nothing the student did not write.
  expect(file.text).toBe(NETLIST);
  await expectAnnounced(page, t('saved', { filename: file.name }));
  // The Netlist panel's bar names the file as Export does.
  await expect(await openPanel(page, 'netlist')).toContainText(`${FILE_NAME}.cir`);

  // A netlist with where its parts are drawn (as a link or a file brings it): the lines go with it.
  const drawn = withDrawingBlock(NETLIST);
  expect(drawn).toMatch(/^\*@ R1 /m);
  await setNetlistWithDrawing(page, drawn);
  const again = await exportAs(page, t('exportNgspice'));
  expect(again.text).toBe(drawn);
});

test('Export for LTspice applies the documented changes and lists them', async ({ page }) => {
  await openApp(page);
  await setNetlist(page, NETLIST);
  const file = await exportAs(page, t('exportLtspice'));
  expect(file.name).toBe(`${FILE_NAME}.net`);
  expect(file.text).toBe(LTSPICE);
  // The notes appear at the top of the page, away from the menu: the announcement says where.
  await expectAnnounced(page, t('ltspiceSaved', { filename: file.name }));

  // The changes, line by line as the student wrote them, in a message at the top of the page.
  const notes = page.getByRole('region', { name: t('ltspiceNotesTitle', { filename: file.name }) });
  await expect(notes).toContainText(t('ltspiceNotesIntro'));
  await expect(notes.getByRole('listitem')).toHaveText([
    EXPORT_TEXT.gndWrittenAs0(EXPORT_TEXT.lineList([2, 4])),
    EXPORT_TEXT.gndKept(EXPORT_TEXT.lineList([5])),
    EXPORT_TEXT.optionsLineRemoved(EXPORT_TEXT.lineList([6])),
    EXPORT_TEXT.controlRemoved(EXPORT_TEXT.lineRange(8, 11)),
    EXPORT_TEXT.notChecked,
  ]);
  await notes.getByRole('button', { name: t('noticeClose') }).click();
  await expect(notes).toHaveCount(0);
});
