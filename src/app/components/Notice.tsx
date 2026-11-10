/**
 * The message area next to the editor: a link that could not be opened, the notes of an LTspice
 * export, a netlist with nothing to run. It stays until dismissed or replaced (messages that
 * vanish on their own are hard to read, WCAG 2.2.1); the live region announces it briefly.
 */
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';
import { t } from '../../i18n/index.ts';
import type { Notice as NoticeData } from '../state.ts';
import { CloseIcon, ErrorIcon, InfoIcon } from './Icons.tsx';

export function Notice({ notice, onDismiss }: { notice: NoticeData; onDismiss: () => void }): ReactNode {
  const Icon = notice.tone === 'problem' ? ErrorIcon : InfoIcon;
  return (
    <section className={`notice notice--${notice.tone}`} aria-labelledby="notice-title">
      <div className="notice__head">
        <h3 id="notice-title" className="notice__title">
          <Icon />
          {notice.title}
        </h3>
        <Button className="icon-button" onPress={onDismiss} aria-label={t('noticeClose')}>
          <CloseIcon />
        </Button>
      </div>
      {notice.text && <p>{notice.text}</p>}
      {notice.items && notice.items.length > 0 && (
        <ul>
          {notice.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
