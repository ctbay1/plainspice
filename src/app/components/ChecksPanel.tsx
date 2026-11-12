/**
 * The Checks panel: beginner traps found before every run (src/spice/traps.ts), grouped by
 * severity. Each says where (a "Line n" button that shows it in the Netlist panel), what, why, what
 * ngspice does, and offers its fixes as buttons. Severity is an icon AND a word, never colour alone.
 *
 * A fix usually removes its trap, and with it the button that was just pressed. Focus would then
 * fall to the page and a keyboard user would start again from the top (WCAG 2.4.3), so it moves to
 * the trap now in that place, or to the panel's heading when no trap is left.
 *
 * At most SHOWN_PER_GROUP traps of each severity are drawn: a pasted or linked netlist with
 * thousands of identical mistakes froze the page for many seconds while every one of them and its
 * buttons were drawn (security review M2). The rest are counted, and appear as the first are fixed.
 */
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { t, tn, type MessageKey, type PluralBase } from '../../i18n/index.ts';
import type { Fix, Trap } from '../../spice/types.ts';
import { groupTraps } from '../model.ts';
import { SEVERITY_ICON } from './Icons.tsx';

const SEVERITY_WORD: Record<Trap['severity'], MessageKey> = { error: 'severityError', warning: 'severityWarning', info: 'severityInfo' };
/** How many traps of one severity are drawn at most. */
export const SHOWN_PER_GROUP = 50;

/**
 * The trap's "what ngspice does" without the claim IDs at its end ("[mega-as-milli-1, …]"): they
 * name the evidence in docs/spice-facts/ for the tests and the docs, and mean nothing to a student
 * (words review m13).
 */
export function withoutClaimIds(text: string): string {
  return text.replace(/\s*\[[a-z][\w-]*\d[a-z]?(?:(?:,\s*|\s*\.\.\.\s*)[a-z][\w-]*\d[a-z]?)*\]\s*$/, '');
}
const GROUP_TITLE: Record<Trap['severity'], PluralBase> = { error: 'checksGroupError', warning: 'checksGroupWarning', info: 'checksGroupInfo' };

export function SeverityLabel({ severity }: { severity: Trap['severity'] }): ReactNode {
  const Icon = SEVERITY_ICON[severity];
  return (
    <span className={`severity severity--${severity}`}>
      <Icon />
      {t(SEVERITY_WORD[severity])}
    </span>
  );
}

export function ChecksPanel({
  traps,
  drawing = [],
  unchosen = [],
  onOpenCard,
  partOfLine,
  onGoToLine,
  onGoToDrawingLine,
  onFix,
  headingRef,
}: {
  traps: readonly Trap[];
  /** What is wrong with the drawing lines (*@): a line PlainSpice cannot read or use, said with its line. */
  drawing?: readonly { message: string; line?: number | undefined }[];
  onGoToDrawingLine?: (line: number) => void;
  /** Controlled sources placed on the drawing that read what PlainSpice chose for them until the student chooses. */
  unchosen?: readonly { key: string; name: string; control: string }[];
  onOpenCard?: (key: string) => void;
  /** The name of the part on a line ("R1"), for the "Line 3" buttons' words. */
  partOfLine?: (line: number) => string | undefined;
  onGoToLine: (trap: Trap) => void;
  onFix: (fix: Fix) => void;
  /** The panel's heading: focus goes there when the last trap is fixed. */
  headingRef?: RefObject<HTMLElement | null>;
}): ReactNode {
  const groups = groupTraps(traps);
  const panel = useRef<HTMLDivElement>(null);
  /** The place (in reading order) of the trap whose fix was just pressed. */
  const fixedAt = useRef<number | null>(null);

  // The fix has been applied and the checks have run again (new traps): if the pressed button went
  // away with its trap, focus the trap now at its place (the next one), the last one, or the heading.
  useEffect(() => {
    const at = fixedAt.current;
    if (at === null) return;
    fixedAt.current = null;
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused.isConnected) return; // focus was not lost
    const titles = panel.current?.querySelectorAll<HTMLElement>('.trap__title') ?? [];
    (titles[Math.min(at, titles.length - 1)] ?? headingRef?.current)?.focus();
  }, [traps, headingRef]);

  // Each trap's place in reading order, across the severity groups.
  const placeOf = new Map(groups.flatMap((g) => g.traps).map((trap, i) => [trap, i]));
  const drawingSection = drawing.length ? (
    <section className="trap-group" aria-labelledby="traps-drawing">
      <h3 id="traps-drawing" className="trap-group__title">
        {t('checksDrawingTitle')}
      </h3>
      <p className="muted">{t('checksDrawingIntro')}</p>
      <ul className="trap-list">
        {drawing.slice(0, SHOWN_PER_GROUP).map((d, i) => (
          <li key={`${d.line ?? 0}-${i}`} className="trap trap--warning">
            <h4 className="trap__title" tabIndex={-1}>
              <SeverityLabel severity="warning" />
              <span className="visually-hidden">:</span> <span className="trap__text">{d.message}</span>
            </h4>
            {d.line !== undefined && onGoToDrawingLine ? (
              <p className="trap__line">
                <button type="button" className="link-button" onClick={() => onGoToDrawingLine(d.line!)}>
                  {t('goToLine', { line: d.line })}
                </button>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  ) : null;
  const unchosenSection = unchosen.length ? (
    <section className="trap-group" aria-labelledby="traps-unchosen">
      <h3 id="traps-unchosen" className="trap-group__title">
        {t('checksUnchosenTitle')}
      </h3>
      <p className="muted">{t('checksUnchosenIntro')}</p>
      <ul className="trap-list">
        {unchosen.map((u) => (
          <li key={u.key} className="trap trap--warning">
            <h4 className="trap__title" tabIndex={-1}>
              <SeverityLabel severity="warning" />
              <span className="visually-hidden">:</span> <span className="trap__text">{t('checksUnchosen', { name: u.name, control: u.control })}</span>
            </h4>
            {onOpenCard ? (
              <p className="trap__line">
                <button type="button" className="link-button" onClick={() => onOpenCard(u.key)}>
                  {t('checksUnchosenOpen', { name: u.name })}
                </button>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  ) : null;
  return (
    <div className="checks" ref={panel}>
      {traps.length === 0 && !drawing.length && !unchosen.length ? (
        <div className="checks-ok">
          <svg className="checks-ok__tick" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
            <path d="M7 24.5c3.2 2.4 6.4 5.6 9.4 10.2C21.8 23 28.6 14.4 38 7.5" />
          </svg>
          <div>
            <p className="checks-ok__title">{t('checksNone')}</p>
            <p className="checks-ok__text">{t('checksIntro')}</p>
          </div>
        </div>
      ) : (
        <>
          <p className="muted">{t('checksIntro')}</p>
          {groups.map((g) => (
            <section key={g.severity} className="trap-group" aria-labelledby={`traps-${g.severity}`}>
              <h3 id={`traps-${g.severity}`} className="trap-group__title">
                {tn(GROUP_TITLE[g.severity], g.traps.length)}
              </h3>
              <ul className="trap-list">
                {g.traps.slice(0, SHOWN_PER_GROUP).map((trap, i) => {
                  const part = partOfLine?.(trap.line);
                  return (
                    <li key={`${trap.id}-${trap.line}-${i}`} className={`trap trap--${trap.severity}`}>
                      <h4 className="trap__title" tabIndex={-1}>
                        <SeverityLabel severity={trap.severity} />
                        {/* "Warning: 1M means …", with a pause after the severity word for screen readers. */}
                        <span className="visually-hidden">:</span> <span className="trap__text">{trap.title}</span>
                      </h4>
                      <p>{trap.why}</p>
                      <p>
                        <strong>{t('whatNgspiceDoes')}</strong> {withoutClaimIds(trap.ngspice)}
                      </p>
                      {trap.fixes.length > 0 && (
                        // A named group of buttons ("Fixes for line 3"); a fieldset is for form fields.
                        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                        <div className="trap__fixes" role="group" aria-label={t('fixesLabel', { line: trap.line })}>
                          {trap.fixes.map((fix, k) => (
                            <button
                              key={k}
                              type="button"
                              className={`button ${k === 0 ? 'button--fix' : 'button--paper'}`}
                              onClick={() => {
                                fixedAt.current = placeOf.get(trap) ?? 0;
                                onFix(fix);
                              }}
                            >
                              {fix.label}
                            </button>
                          ))}
                        </div>
                      )}
                      <p className="trap__line">
                        <button type="button" className="link-button" onClick={() => onGoToLine(trap)}>
                          {part ? t('goToLinePart', { part, line: trap.line }) : t('goToLine', { line: trap.line })}
                        </button>
                      </p>
                    </li>
                  );
                })}
              </ul>
              {g.traps.length > SHOWN_PER_GROUP && <p className="muted">{tn('checksMore', g.traps.length - SHOWN_PER_GROUP)}</p>}
            </section>
          ))}
          {unchosenSection}
          {drawingSection}
        </>
      )}
    </div>
  );
}
