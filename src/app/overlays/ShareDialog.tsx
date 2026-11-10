/**
 * Share (lazy-loaded): the whole circuit in a link (src/share/link.ts, decision 0008). The link is
 * shown in a read-only field (selected when it gets focus), with a Copy button, the choice to run
 * the simulation when the link opens, and its length.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, Checkbox, Input, Label, TextField } from 'react-aria-components';
import { t, tn } from '../../i18n/index.ts';
import { encodeShare, ShareError, shareUrl } from '../../share/link.ts';
import { useAnnounce } from '../announcer.tsx';
import { DialogFrame } from './DialogFrame.tsx';

type LinkState = { kind: 'making' } | { kind: 'ready'; url: string } | { kind: 'error'; message: string };

/** Copy text: the Clipboard API where allowed, else the selected field and the old copy command. */
async function copyText(text: string, field: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Not allowed here (an iframe, an old browser): try the fallback.
  }
  if (!field) return false;
  field.focus();
  field.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

export default function ShareDialog({ getNetlist, onOpenChange }: { getNetlist: () => string; onOpenChange: (isOpen: boolean) => void }): ReactNode {
  const announce = useAnnounce();
  const [run, setRun] = useState(true);
  const [link, setLink] = useState<LinkState>({ kind: 'making' });
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const field = useRef<HTMLInputElement>(null);
  const noteId = useId();

  useEffect(() => {
    let alive = true;
    encodeShare(getNetlist(), { run })
      .then((fragment) => alive && setLink({ kind: 'ready', url: shareUrl(location.href, fragment) }))
      .catch((error: unknown) => alive && setLink({ kind: 'error', message: error instanceof ShareError ? error.message : String(error) }));
    return () => {
      alive = false;
    };
  }, [run, getNetlist]);

  const onCopy = async (): Promise<void> => {
    if (link.kind !== 'ready') return;
    const ok = await copyText(link.url, field.current);
    setCopy(ok ? 'copied' : 'failed');
    if (ok) announce(t('shareCopied'));
    else {
      field.current?.focus();
      field.current?.select();
      announce(t('shareCopyFailed'));
    }
  };

  return (
    <DialogFrame title={t('shareTitle')} onOpenChange={onOpenChange}>
      {link.kind === 'error' ? (
        <p className="message message--problem" role="alert">
          {link.message}
        </p>
      ) : (
        <>
          <TextField className="field" isReadOnly value={link.kind === 'ready' ? link.url : t('shareMaking')} aria-describedby={noteId}>
            <Label className="field__label">{t('shareLinkLabel')}</Label>
            <Input ref={field} className="field__input field__input--mono" onFocus={(e) => e.currentTarget.select()} />
          </TextField>
          <div className="row">
            <Button className="button button--primary" onPress={() => void onCopy()} isDisabled={link.kind !== 'ready'}>
              {t('shareCopy')}
            </Button>
            <p className="row__status" aria-hidden="true">
              {copy === 'copied' ? t('shareCopied') : ''}
            </p>
          </div>
          {copy === 'failed' && <p className="message message--problem">{t('shareCopyFailed')}</p>}
          <Checkbox
            className="checkbox"
            isSelected={run}
            onChange={(value) => {
              setRun(value);
              setCopy('idle'); // a new link: "Link copied" was about the old one
            }}
          >
            <span className="checkbox__box" aria-hidden="true">
              <svg viewBox="0 0 18 18" focusable="false">
                <polyline points="3.5 9.5 7.5 13 14.5 5" />
              </svg>
            </span>
            {t('shareRunOption')}
          </Checkbox>
          {link.kind === 'ready' && <p>{tn('shareLength', link.url.length)}</p>}
        </>
      )}
      <p id={noteId} className="hint">
        {t('shareNote')}
      </p>
    </DialogFrame>
  );
}
