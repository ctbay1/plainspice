/** "A new version of PlainSpice is ready" with a Reload button (see src/app/pwa.ts). */
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';
import { t } from '../../i18n/index.ts';

export function UpdateBanner({ onReload }: { onReload: () => void }): ReactNode {
  return (
    <div className="update-banner">
      <p>{t('updateReady')}</p>
      <Button className="button" onPress={onReload}>
        {t('updateReload')}
      </Button>
    </div>
  );
}
