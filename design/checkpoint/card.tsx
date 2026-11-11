/**
 * The index card for the selected part (the Notebook's value editor): its name, its kind in plain
 * words, its line, its value (R, sources and gains can be changed: ngspice solves again as you type,
 * the numbers move in place, and the value you started from stays crossed out until you close the
 * card), what SPICE reads the value as, the current through the part, the voltage across it (its
 * size and which end is higher, SPICE's signed difference underneath) and a source's power.
 *
 * Three forms:
 * - 'pinned', on a computer: a wide, short card beside its part (src/notebook/place.ts finds where),
 *   always as tall as its tallest state, so nothing moves while you type (critique 1);
 * - 'sheet', on a phone: a short bottom sheet over the drawing;
 * - 'strip', on a phone while the value is typed: one strip above the keyboard (the part, the field,
 *   Put back), so the drawing above it shows the numbers moving (critique 3).
 *
 * Escape (the page's keyboard handler) closes it.
 */
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import type { Side, ToolKind } from '../../src/notebook/index.ts';
import { Icon, ToolGlyph } from './icons.tsx';

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

export interface CardProps {
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
  /** What to type, with examples that fit the field ("Type a gain, such as 0.5 or 2"). */
  typeHint: string;
  /** A check's title on this line (red pen). */
  trap?: string;
  readouts: readonly Readout[];
  /** Why there are no numbers (a check, ngspice's own message), when there are none. */
  noNumbers?: string;
  sentence: string;
  variant: 'pinned' | 'sheet' | 'strip';
  /** Put the focus in the value field when the card opens (not on a phone, where it would open the keyboard over the card). */
  focusField?: boolean;
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
}

export function IndexCard(p: CardProps): ReactNode {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // Open on the field when there is one (typing is what the card is for), else on the title.
  const intoField = p.label !== undefined && p.focusField !== false;
  useEffect(() => {
    if (intoField) input.current?.focus({ preventScroll: true });
    else if (p.variant !== 'strip') titleRef.current?.focus({ preventScroll: true });
  }, [p.name, intoField, p.variant]);

  const changed = p.value.trim() !== p.start.trim();
  const field =
    p.label !== undefined ? (
      <div className={`ck-value${p.readsTrap ? ' is-trap' : ''}`}>
        <input
          ref={input}
          id={`${id}-value`}
          className="ck-value__input"
          type="text"
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={p.value}
          aria-describedby={`${id}-reads${changed ? ` ${id}-was` : ''}`}
          onChange={(e) => p.onValue(e.target.value)}
          onFocus={() => p.onFieldFocus?.()}
          onBlur={(e) => p.onFieldBlur?.(e.relatedTarget instanceof Element ? e.relatedTarget : null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (p.variant === 'strip' && p.onDone) p.onDone();
              else p.onClose();
            }
          }}
        />
        {p.suffix ? <span className="ck-value__suffix">{p.suffix}</span> : null}
      </div>
    ) : null;

  const strip = p.variant === 'strip';
  const putBack = (
    // In the strip the field keeps the focus (and the phone its keyboard) when this is tapped.
    <button type="button" className="ck-link" onMouseDown={strip ? (e) => e.preventDefault() : undefined} onClick={p.onPutBack}>
      Put back {p.start}
    </button>
  );

  // One structure for every form, so the value field stays the same element (its focus, and a
  // phone's keyboard, survive the sheet turning into the strip and back).
  const style: CSSProperties & Record<string, string> = p.notch !== undefined ? { '--notch': `${p.notch}px` } : {};
  return (
    // Not modal: the drawing stays usable beside the card (Escape, handled by the page, closes it).
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
    <section className={`ck-index ck-index--${p.variant}${p.side ? ` ck-index--${p.side}` : ''}`} style={style} role="dialog" aria-modal="false" aria-labelledby={`${id}-title`}>
      {p.variant === 'sheet' ? <span className="ck-grab" aria-hidden="true" /> : null}
      <div className="ck-index__head">
        <span className="ck-index__glyph">
          <ToolGlyph kind={p.icon} />
        </span>
        <h2 className="ck-index__title" id={`${id}-title`} tabIndex={-1} ref={titleRef}>
          <span className="ck-index__name">{p.name}</span> <span className="ck-index__kind">{p.kind}</span>
          <span className="ck-index__line"> · line {p.line}</span>
        </h2>
        {p.variant === 'pinned' ? (
          <button type="button" className="ck-link ck-index__explain" onClick={p.onExplain}>
            Explain line {p.line}
          </button>
        ) : null}
        {strip ? null : (
          <button className="ck-icon-btn" type="button" onClick={p.onClose} aria-label={`Close ${p.name}'s card`}>
            <Icon name="close" />
          </button>
        )}
      </div>
      <div className="ck-index__body">
        {p.label !== undefined ? (
          <div className="ck-index__field">
            <label className="ck-field-label" htmlFor={`${id}-value`}>
              <span className="ck-field-label__part">{p.name} · </span>
              {p.label}
            </label>
            {field}
            <p className={`ck-reads${p.readsTrap ? ' is-trap' : ''}`} id={`${id}-reads`} aria-live="polite">
              {p.reads ? (
                <>
                  SPICE reads it as <span className={`ck-reads__val${p.reads.length > 16 ? ' ck-reads__val--words' : ''}`}>{p.reads}</span>
                </>
              ) : (
                `${p.typeHint}.`
              )}
            </p>
            {/* Always there, so the card never grows as you type: hidden until the value changes. */}
            <p className={`ck-was${changed ? '' : ' is-idle'}`} id={`${id}-was`} aria-hidden={!changed}>
              <span className="ck-was__label">Was</span> <s className="ck-was__old nb-hand">{p.start}</s>
              {changed ? putBack : null}
            </p>
          </div>
        ) : null}
        {strip ? null : p.readouts.length ? (
          <ul className="ck-readouts" aria-label="Results">
            {p.readouts.map((r, i) => (
              <li key={i} className={`ck-readout ck-readout--${r.tone}`}>
                <span className="ck-sr">{r.speech}</span>
                <span className="ck-readout__v" aria-hidden="true">
                  {r.was ? <s className="ck-readout__was nb-hand">{r.was}</s> : null}
                  <span key={r.value} className="ck-readout__num nb-hand nb-settle-html">
                    {r.value}
                  </span>
                </span>
                <span className="ck-readout__words" aria-hidden="true">
                  <span className="ck-readout__what">{r.what}</span>
                  {(r.sub ?? []).map((line, k) => (
                    <span key={k} className="ck-readout__sub">
                      {line}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ck-index__none">{p.noNumbers ?? 'Solving…'}</p>
        )}
        {strip ? (
          <button type="button" className="ck-btn ck-btn--ink ck-strip__done" onMouseDown={(e) => e.preventDefault()} onClick={() => p.onDone?.()}>
            Done
          </button>
        ) : null}
      </div>
      {strip ? null : (
        <div className="ck-index__foot">
          {p.trap ? (
            <p className="ck-index__trap">
              <Icon name="warning" /> <span>{p.trap}</span>
            </p>
          ) : (
            <p className="ck-index__sentence">{p.sentence}</p>
          )}
          {p.trap && p.onFix ? (
            <p className="ck-index__more">
              <button type="button" className="ck-link ck-link--red" onClick={p.onFix}>
                See the fix in Checks
              </button>
            </p>
          ) : p.variant === 'pinned' ? null : (
            <p className="ck-index__more">
              <button type="button" className="ck-link" onClick={p.onExplain}>
                Explain line {p.line}, field by field
              </button>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
