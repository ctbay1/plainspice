/**
 * Settings: for now one, "Results on the drawing: Handwriting / Plain font" (decision 0014), which
 * switches every handwritten result to the plain sans at once and is remembered on this device
 * (src/notebook/settings.ts). A small dialog under the gear on a computer, a bottom sheet on a
 * phone; Escape closes it (the page's keyboard handler) and the focus goes back to the gear.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { RESULT_FONT_STRINGS as S, type ResultFont } from '../../src/notebook/index.ts';
import { Icon } from './icons.tsx';

/** `sample`: a result of the circuit on the page (a node voltage from ngspice), written in each font. */
export function SettingsDialog({ font, onFont, onClose, phone, sheetRef, sample }: {
  font: ResultFont;
  onFont: (f: ResultFont) => void;
  onClose: () => void;
  phone: boolean;
  sheetRef?: ((el: HTMLElement | null) => void) | undefined;
  sample: string | undefined;
}): ReactNode {
  const id = useId();
  const first = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    opener.current = document.activeElement;
    first.current?.focus();
    return () => {
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
    };
  }, []);
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Element;
      if (!t.closest('.ck-settings') && !t.closest('[aria-label="Settings"]')) onClose();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [onClose]);
  return (
    // Not modal: Escape (the page's keyboard handler) or a click elsewhere closes it.
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
    <section ref={sheetRef} className={`ck-settings${phone ? ' ck-sheet ck-sheet--settings' : ''}`} role="dialog" aria-modal="false" aria-labelledby={`${id}-title`}>
      {phone ? <span className="ck-grab" aria-hidden="true" /> : null}
      <header className="ck-card__head">
        <div className="ck-card__titles">
          <h2 className="ck-card__title" id={`${id}-title`}>
            Settings
          </h2>
        </div>
        <button className="ck-icon-btn" type="button" onClick={onClose} aria-label="Close the settings">
          <Icon name="close" />
        </button>
      </header>
      <div className="ck-card__body">
        <fieldset className="ck-choice">
          <legend className="ck-field-label">{S.label}</legend>
          {(['handwriting', 'plain'] as const).map((f, i) => (
            <label key={f} className={`ck-choice__opt ck-choice__opt--${f}${font === f ? ' is-on' : ''}`}>
              <input ref={i === 0 ? first : undefined} type="radio" name={`${id}-font`} value={f} checked={font === f} onChange={() => onFont(f)} />
              <span className="ck-choice__name">{S[f]}</span>
              {sample ? (
                <span className={`ck-choice__sample${f === 'handwriting' ? ' ck-choice__sample--hand' : ''}`} aria-hidden="true">
                  {sample}
                </span>
              ) : null}
            </label>
          ))}
          <p className="ck-choice__hint">{S.hint}</p>
        </fieldset>
      </div>
    </section>
  );
}
