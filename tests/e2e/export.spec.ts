/**
 * 5. Export: both menu items download a file. The ngspice file is the netlist exactly as written;
 * the LTspice file has the documented changes (src/export/export.ts, docs/share-links.md) and the
 * app lists them, ending with "not checked in LTspice yet".
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { EXPORT_TEXT } from '../../src/export/export.ts';
import { expectAnnounced, openApp, setNetlist, t } from './helpers.ts';

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
  await page.getByRole('button', { name: t('export') }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menu', { name: t('exportMenu') }).getByRole('menuitem', { name: item }).click(),
  ]);
  return { name: download.suggestedFilename(), text: readFileSync(await download.path(), 'utf8') };
}

test('Export for ngspice saves the netlist exactly as written', async ({ page }) => {
  await openApp(page);
  await setNetlist(page, NETLIST);
  const file = await exportAs(page, t('exportNgspice'));
  expect(file.name).toBe(`${FILE_NAME}.cir`);
  expect(file.text).toBe(NETLIST);
  await expectAnnounced(page, t('saved', { filename: file.name }));
});

test('Export for LTspice applies the documented changes and lists them', async ({ page }) => {
  await openApp(page);
  await setNetlist(page, NETLIST);
  const file = await exportAs(page, t('exportLtspice'));
  expect(file.name).toBe(`${FILE_NAME}.net`);
  expect(file.text).toBe(LTSPICE);
  await expectAnnounced(page, t('saved', { filename: file.name }));

  // The changes, line by line as the student wrote them, in the message area next to the editor.
  const notes = page.getByRole('region', { name: t('ltspiceNotesTitle', { filename: file.name }) });
  await expect(notes).toContainText(t('ltspiceNotesIntro'));
  await expect(notes.getByRole('listitem')).toHaveText([
    EXPORT_TEXT.gndWrittenAs0(EXPORT_TEXT.lineList([2, 4])),
    EXPORT_TEXT.gndKept(EXPORT_TEXT.lineList([5])),
    EXPORT_TEXT.optionsLineRemoved(EXPORT_TEXT.lineList([6])),
    EXPORT_TEXT.controlRemoved(EXPORT_TEXT.lineRange(8, 11)),
    EXPORT_TEXT.notChecked,
  ]);
});
