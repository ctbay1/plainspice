/**
 * Help (lazy-loaded): keyboard shortcuts (the app's, the drawing's editing keys (decision 0017), then the netlist editor's own list,
 * EDITOR_STRINGS.keys), how to read the results, the sign of a source's current, and the links that
 * were in the old page's footer (the licences and source, the engine check, the source code).
 * The sign convention is the one src/engine/results.ts documents and docs/spice-facts checks
 * (S2: "V1 n1 0 6" across 2 Ω gives i(v1) = −3 A).
 */
import type { ReactNode } from 'react';
import { EDITOR_STRINGS } from '../../editor/index.ts';
import { t } from '../../i18n/index.ts';
import { TableWrap } from '../components/TableWrap.tsx';
import { DialogFrame } from './DialogFrame.tsx';

export default function HelpDialog({ onOpenChange, offlineReady }: { onOpenChange: (isOpen: boolean) => void; offlineReady: boolean }): ReactNode {
  const keys: { keys: string; action: string }[] = [
    { keys: t('helpKeyPalette'), action: t('helpKeyPaletteAction') },
    { keys: t('helpKeyRun'), action: t('helpKeyRunAction') },
    { keys: t('helpKeyUndo'), action: t('helpKeyUndoAction') },
    { keys: t('helpKeyDrawing'), action: t('helpKeyDrawingAction') },
    { keys: t('helpKeyOpen'), action: t('helpKeyOpenAction') },
    { keys: t('helpKeyNode'), action: t('helpKeyNodeAction') },
    { keys: t('helpKeyEscape'), action: t('helpKeyEscapeAction') },
    { keys: t('helpKeyParts'), action: t('helpKeyPartsAction') },
    { keys: t('helpKeyZoom'), action: t('helpKeyZoomAction') },
    { keys: t('helpKeyToolbar'), action: t('helpKeyToolbarAction') },
  ];
  // Editing the drawing (decision 0017): single keys, on the drawing or the parts (WCAG 2.1.4).
  const editing: { keys: string; action: string }[] = [
    { keys: t('helpKeyTurn'), action: t('helpKeyTurnAction') },
    { keys: t('helpKeyMirror'), action: t('helpKeyMirrorAction') },
    { keys: t('helpKeyReverse'), action: t('helpKeyReverseAction') },
    { keys: t('helpKeyMove'), action: t('helpKeyMoveAction') },
    { keys: t('helpKeyDelete'), action: t('helpKeyDeleteAction') },
    { keys: t('helpKeyCard'), action: t('helpKeyCardAction') },
    { keys: t('helpKeyMoving'), action: t('helpKeyMovingAction') },
    { keys: t('helpKeyAdd'), action: t('helpKeyAddAction') },
    { keys: t('helpKeyWireNodes'), action: t('helpKeyWireNodesAction') },
  ];
  // The editor's own keys, less those the whole page has (Run, undo and redo are listed once, above).
  const netlistKeys = EDITOR_STRINGS.keys.filter((k) => !/^Ctrl\+(Enter|Z)\b/.test(k.keys));
  const table = (caption: string, rows: readonly { keys: string; action: string }[]): ReactNode => (
    <TableWrap label={caption}>
      <table className="table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t('helpKeysColumnKeys')}</th>
            <th scope="col">{t('helpKeysColumnAction')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((k) => (
            <tr key={k.keys}>
              <th scope="row">
                <kbd>{k.keys}</kbd>
              </th>
              <td>{k.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
  return (
    <DialogFrame title={t('helpTitle')} onOpenChange={onOpenChange} wide>
      <h3>{t('helpKeysHeading')}</h3>
      {table(t('helpKeysCaption'), keys)}
      <h4>{t('helpKeysEditing')}</h4>
      {table(t('helpKeysEditing'), editing)}
      <p>{t('helpScreenReaders')}</p>
      <h4>{t('helpKeysNetlist')}</h4>
      {table(t('helpKeysNetlist'), netlistKeys)}
      <h3>{t('helpResultsHeading')}</h3>
      <p>{t('helpResults1')}</p>
      <p>{t('helpResults2')}</p>
      <p>{t('helpResults3')}</p>
      <h3>{t('helpSignHeading')}</h3>
      <p>{t('helpSign1')}</p>
      <p>{t('helpSign2')}</p>
      <p>{t('helpSign3')}</p>
      <h3>{t('helpMoreHeading')}</h3>
      <p>{t('footerEngine')}</p>
      {offlineReady ? <p>{t('offlineReady')}</p> : null}
      <ul>
        <li>
          <a href="./licenses/">{t('helpLicences')}</a>
        </li>
        <li>
          <a href="./spike/">{t('helpEngineCheck')}</a>
        </li>
        <li>
          <a href="https://github.com/ctbay1/plainspice">{t('footerSource')}</a>
        </li>
      </ul>
    </DialogFrame>
  );
}
