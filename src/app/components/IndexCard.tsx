/**
 * The index card for the selected part (the Notebook's value editor, Tarık's checkpoint): its name,
 * its kind in plain words, its line, its value (R, C, L, sources and gains can be changed: ngspice
 * solves again as you type, the numbers move in place, and the value you started from stays crossed
 * out until you close the card), what SPICE reads the value as, the current through the part, the
 * voltage across it (its size and which end is higher, SPICE's signed difference underneath) and a
 * source's power. Every word and number comes from the model (src/app/card.ts).
 *
 * Three forms:
 * - 'pinned', on a computer: a wide, short card beside its part (src/notebook/place.ts finds where),
 *   always as tall as its tallest state, so nothing moves while you type;
 * - 'sheet', on a phone: a short bottom sheet over the drawing;
 * - 'strip', on a phone while the value is typed: one strip above the keyboard (the part, the field,
 *   Put back, Done), so the drawing above it shows the numbers moving.
 *
 * Escape (the page's keyboard handler) closes it.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { t } from '../../i18n/index.ts';
import type { Side, ToolKind } from '../../notebook/index.ts';
import { LineIcon, ToolGlyph, WarningIcon } from './Icons.tsx';

export interface Readout {
  /** The number, handwritten: "2 A", "24 V", "96 W". */
  value: string;
  /** What it is: "through it", "across it", "delivers". */
  what: string;
  /** Lines under it, smaller: "from ground to a"; "a is higher", "V(0) − V(a) = −24 V". */
  sub?: readonly string[];
  /** The number when the card was opened, if it has changed since. */
  was?: string;
  tone: 'current' | 'voltage' | 'power';
  /** The same in words, for screen readers. */
  speech: string;
}

/** A line the card shows besides (or instead of) numbers. */
export interface CardNote {
  text: string;
  /** busy: ngspice is about to answer (shown after a moment); paused: nothing runs without Run; bad: no answers; info: nothing to show here. */
  tone: 'busy' | 'paused' | 'bad' | 'info';
  /** Offer the Numbers panel. */
  numbers?: boolean;
}

export interface CardContent {
  name: string;
  kind: string;
  line: number;
  icon: ToolKind;
  /** The value field's label ("value", "gain", "amps per volt"); undefined when the value cannot be changed here. */
  label?: string;
  value: string;
  /** The value when the card was opened. */
  start: string;
  /** Written after the field: its unit ("Ω") or what it multiplies ("A/V × V(n1)"). */
  suffix?: string;
  /** What SPICE reads the value as, or why it cannot. */
  reads?: string;
  readsTrap?: boolean;
  /**
   * The field's text is not written to the netlist (SPICE does not read it as one number there):
   * why, in the checks' words; the value the netlist still has; a fix that is a value ("Write 4.7k").
   */
  refused?: { reason: string; kept: string; fix?: { label: string; value: string } };
  /** What to type, with examples that fit the field ("Type a gain, such as 0.5 or 2"). */
  typeHint: string;
  /** A check's title on this line (red pen). */
  trap?: string;
  readouts: readonly Readout[];
  /** The numbers are from before the last change (shown dimmed until ngspice answers). */
  readoutsPending?: boolean;
  /** Why there are no numbers, or no new ones yet. */
  note?: CardNote;
  /** The part in words (the model's sentence). */
  sentence: string;
}

export interface CardProps extends CardContent {
  variant: 'pinned' | 'sheet' | 'strip';
  /** Put the focus in the value field when the card opens (not on a phone, where it would open the keyboard over the card). */
  focusField?: boolean;
  /** Move the focus into the card at all when it opens (false: it follows the drawing's arrow keys, which keep the focus). */
  takeFocus?: boolean;
  /** Changes with each opening of a card (the focus goes in again, even for the same part). */
  session?: number;
  /** 'pinned': the side of its part the card is on, and where its notch is along that edge (px from the card's corner). */
  side?: Side;
  notch?: number;
  onValue: (text: string) => void;
  onPutBack: () => void;
  onClose: () => void;
  onExplain: () => void;
  /** A phone: the value field got or lost the focus (the strip shows while it has it). */
  onFieldFocus?: () => void;
  onFieldBlur?: (next: Element | null) => void;
  /** 'strip': done typing (the keyboard closes, the sheet comes back). */
  onDone?: () => void;
  onFix?: () => void;
  /** Put a fix's value in the field ("Write 4.7k"). */
  onUseFix?: (value: string) => void;
  /** Open the Numbers panel. */
  onNumbers?: () => void;
}

/** How long a value SPICE cannot read may sit in the field before the card says why (a "-" on the way to "-12" is not a mistake). */
export const REFUSED_AFTER_MS = 700;
/** How long ngspice may take before the card says it is running. */
export const BUSY_AFTER_MS = 400;

export function IndexCard(p: CardProps): ReactNode {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // Open on the field when there is one (typing is what the card is for), else on the title.
  const intoField = p.label !== undefined && p.focusField !== false;
  const takeFocus = p.takeFocus !== false;
  useEffect(() => {
    if (!takeFocus) return;
    if (intoField) input.current?.focus({ preventScroll: true });
    else if (p.variant !== 'strip') titleRef.current?.focus({ preventScroll: true });
  }, [p.name, intoField, p.variant, takeFocus, p.session]);

  const changed = p.value.trim() !== p.start.trim();
  const strip = p.variant === 'strip';
  // A value SPICE cannot read: said once typing pauses (the field's text as it was when typing last
  // paused), so the way to "-12" is not a row of errors.
  const [settled, setSettled] = useState(p.value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(p.value), REFUSED_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [p.value]);
  const refused = p.refused && settled === p.value ? p.refused : undefined;
  // "Running…" only when ngspice takes a moment (for the value as typed): a quick answer replaces
  // the numbers without a flash.
  const busy = p.note?.tone === 'busy';
  const [lateFor, setLateFor] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!busy) return undefined;
    const timer = window.setTimeout(() => setLateFor(p.value), BUSY_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [busy, p.value]);
  const note = p.note && (!busy || lateFor === p.value) ? p.note : undefined;
  const field =
    p.label !== undefined ? (
      <div className={`value-field${p.readsTrap || refused ? ' is-trap' : ''}`}>
        <input
          ref={input}
          id={`${id}-value`}
          className="value-field__input"
          type="text"
          // Text, not decimal: a value needs letters (k, meg, u), and a phone's decimal key may be a comma.
          inputMode="text"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={p.value}
          aria-invalid={refused ? true : undefined}
          aria-describedby={`${id}-reads${changed ? ` ${id}-was` : ''}`}
          onChange={(e) => p.onValue(e.target.value)}
          onFocus={() => p.onFieldFocus?.()}
          onBlur={(e) => p.onFieldBlur?.(e.relatedTarget instanceof Element ? e.relatedTarget : null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (strip && p.onDone) p.onDone();
              else p.onClose();
            }
          }}
        />
        {p.suffix ? <span className="value-field__suffix">{p.suffix}</span> : null}
      </div>
    ) : null;

  const putBack = (
    // In the strip the field keeps the focus (and the phone its keyboard) when this is tapped.
    <button type="button" className="link-button" onMouseDown={strip ? (e) => e.preventDefault() : undefined} onClick={p.onPutBack}>
      {t('cardPutBack', { value: p.start })}
    </button>
  );

  // One structure for every form, so the value field stays the same element (its focus, and a
  // phone's keyboard, survive the sheet turning into the strip and back).
  const style: CSSProperties & Record<string, string> = p.notch !== undefined ? { '--notch': `${p.notch}px` } : {};
  return (
    // Not modal: the drawing stays usable beside the card (Escape, handled by the page, closes it).
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
    <section className={`index-card index-card--${p.variant}${p.side ? ` index-card--${p.side}` : ''}`} style={style} role="dialog" aria-modal="false" aria-labelledby={`${id}-title`}>
      {p.variant === 'sheet' ? <span className="grab" aria-hidden="true" /> : null}
      <div className="index-card__head">
        <span className="index-card__glyph">
          <ToolGlyph kind={p.icon} />
        </span>
        <h2 className="index-card__title" id={`${id}-title`} tabIndex={-1} ref={titleRef}>
          <span className="index-card__name">{p.name}</span> <span className="index-card__kind">{p.kind}</span>
          <span className="index-card__line">{t('cardLine', { line: p.line })}</span>
        </h2>
        {p.variant === 'pinned' ? (
          <button type="button" className="link-button index-card__explain" onClick={p.onExplain}>
            {t('cardExplain', { line: p.line })}
          </button>
        ) : null}
        {strip ? null : (
          <button className="icon-button" type="button" onClick={p.onClose} aria-label={t('cardClose', { name: p.name })}>
            <LineIcon name="close" />
          </button>
        )}
      </div>
      <div className="index-card__body">
        {p.label !== undefined ? (
          <div className="index-card__field">
            <label className="field-label" htmlFor={`${id}-value`}>
              <span className="field-label__part">{t('cardFieldPart', { name: p.name })}</span>
              {p.label}
            </label>
            {field}
            <p className={`reads${p.readsTrap || refused ? ' is-trap' : ''}`} id={`${id}-reads`} aria-live="polite">
              {refused ? (
                <>
                  <WarningIcon /> <span className="reads__why">{refused.reason}</span>
                  {/* The drawing and the numbers show the value the netlist still has: said for screen readers. */}
                  <span className="visually-hidden"> {t('cardKeeps', { value: refused.kept })}</span>
                  {refused.fix && p.onUseFix ? (
                    <>
                      {' '}
                      <button type="button" className="link-button reads__fix" onMouseDown={strip ? (e) => e.preventDefault() : undefined} onClick={() => p.onUseFix?.(refused.fix!.value)}>
                        {refused.fix.label}
                      </button>
                    </>
                  ) : null}
                </>
              ) : p.reads && !p.refused ? (
                <>
                  {t('cardReads')} <span className={`reads__value${p.reads.length > 16 ? ' reads__value--words' : ''}`}>{p.reads}</span>
                </>
              ) : (
                `${p.typeHint}.`
              )}
            </p>

            {/* Always there, so the card never grows as you type: hidden until the value changes. */}
            <p className={`was${changed ? '' : ' is-idle'}`} id={`${id}-was`} aria-hidden={!changed}>
              <span className="was__label">{t('cardWas')}</span> <s className="was__old hand">{p.start}</s>
              {changed ? putBack : null}
            </p>
          </div>
        ) : null}
        {strip ? null : p.readouts.length ? (
          <ul className={`readouts${p.readoutsPending ? ' is-pending' : ''}`} aria-label={t('cardResults')}>
            {p.readouts.map((r, i) => (
              <li key={i} className={`readout readout--${r.tone}`}>
                <span className="visually-hidden">{r.speech}</span>
                <span className="readout__value" aria-hidden="true">
                  {r.was ? <s className="readout__was hand">{r.was}</s> : null}
                  <span key={r.value} className="readout__number hand settle">
                    {r.value}
                  </span>
                </span>
                <span className="readout__words" aria-hidden="true">
                  <span className="readout__what">{r.what}</span>
                  {(r.sub ?? []).map((line, k) => (
                    <span key={k} className="readout__sub">
                      {line}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {strip || !note ? null : (
          <p className={`index-card__note index-card__note--${note.tone}`}>
            {note.tone === 'bad' ? <WarningIcon /> : null}
            {note.text}
            {note.numbers && p.onNumbers ? (
              <>
                {' '}
                <button type="button" className="link-button" onClick={p.onNumbers}>
                  {t('showNumbers')}
                </button>
              </>
            ) : null}
          </p>
        )}
        {strip ? (
          <button type="button" className="button button--primary strip-done" onMouseDown={(e) => e.preventDefault()} onClick={() => p.onDone?.()}>
            {t('cardDone')}
          </button>
        ) : null}
      </div>
      {strip ? null : (
        <div className="index-card__foot">
          {p.trap ? (
            <p className="index-card__trap">
              <WarningIcon /> <span>{p.trap}</span>
            </p>
          ) : (
            <p className="index-card__sentence">{p.sentence}</p>
          )}
          {p.trap && p.onFix ? (
            <p className="index-card__more">
              <button type="button" className="link-button link-button--red" onClick={p.onFix}>
                {t('cardSeeFix')}
              </button>
            </p>
          ) : p.variant === 'pinned' ? null : (
            <p className="index-card__more">
              <button type="button" className="link-button" onClick={p.onExplain}>
                {t('cardExplainLong', { line: p.line })}
              </button>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
