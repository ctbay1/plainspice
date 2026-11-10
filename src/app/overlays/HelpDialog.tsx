/**
 * Help (lazy-loaded): keyboard shortcuts (the editor's own list, EDITOR_STRINGS.keys, plus the
 * app's), how to read the results, the sign of a source's current, and the licences.
 * The sign convention is the one src/engine/results.ts documents and docs/spice-facts checks
 * (S2: "V1 n1 0 6" across 2 Ω gives i(v1) = −3 A).
 */
import type { ReactNode } from 'react';
import { EDITOR_STRINGS } from '../../editor/index.ts';
import { t } from '../../i18n/index.ts';
import { DialogFrame } from './DialogFrame.tsx';

export default function HelpDialog({ onOpenChange }: { onOpenChange: (isOpen: boolean) => void }): ReactNode {
  const keys: { keys: string; action: string }[] = [
    ...EDITOR_STRINGS.keys,
    { keys: t('helpKeyToolbar'), action: t('helpKeyToolbarAction') },
    { keys: t('helpKeyTabs'), action: t('helpKeyTabsAction') },
    { keys: t('helpKeyEscape'), action: t('helpKeyEscapeAction') },
  ];
  return (
    <DialogFrame title={t('helpTitle')} onOpenChange={onOpenChange} wide>
      <h3>{t('helpKeysHeading')}</h3>
      <div className="table-wrap">
        <table className="table">
          <caption className="visually-hidden">{t('helpKeysCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('helpKeysColumnKeys')}</th>
              <th scope="col">{t('helpKeysColumnAction')}</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.keys}>
                <th scope="row">
                  <kbd>{k.keys}</kbd>
                </th>
                <td>{k.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>{t('helpResultsHeading')}</h3>
      <p>{t('helpResults1')}</p>
      <p>{t('helpResults2')}</p>
      <p>{t('helpResults3')}</p>
      <h3>{t('helpSignHeading')}</h3>
      <p>{t('helpSign1')}</p>
      <p>{t('helpSign2')}</p>
      <p>{t('helpSign3')}</p>
      <h3>{t('helpMoreHeading')}</h3>
      <ul>
        <li>
          <a href="./licenses/">{t('helpLicences')}</a>
        </li>
        <li>
          <a href="./spike/">{t('helpEngineCheck')}</a>
        </li>
      </ul>
    </DialogFrame>
  );
}
