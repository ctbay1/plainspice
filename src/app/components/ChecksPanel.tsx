/**
 * The Checks tab: beginner traps found before running (src/spice/traps.ts), grouped by severity.
 * Each says where (a "Line n" button that selects it in the editor), what, why, what ngspice does,
 * and offers its fixes as buttons. Severity is an icon AND a word, never colour alone.
 *
 * A fix usually removes its trap, and with it the button that was just pressed. Focus would then
 * fall to the page and a keyboard user would start again from the top (WCAG 2.4.3), so it moves to
 * the trap now in that place, or to the panel's heading when no trap is left.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from 'react-aria-components';
import { t, tn, type MessageKey, type PluralBase } from '../../i18n/index.ts';
import type { Fix, Trap } from '../../spice/types.ts';
import { groupTraps } from '../state.ts';
import { OkIcon, SEVERITY_ICON } from './Icons.tsx';

const SEVERITY_WORD: Record<Trap['severity'], MessageKey> = { error: 'severityError', warning: 'severityWarning', info: 'severityInfo' };
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
  onGoToLine,
  onFix,
}: {
  traps: readonly Trap[];
  onGoToLine: (trap: Trap) => void;
  onFix: (fix: Fix) => void;
}): ReactNode {
  const groups = groupTraps(traps);
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
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
    (titles[Math.min(at, titles.length - 1)] ?? heading.current)?.focus();
  }, [traps]);

  // Each trap's place in reading order, across the severity groups.
  const placeOf = new Map(groups.flatMap((g) => g.traps).map((trap, i) => [trap, i]));
  return (
    <div className="panel" ref={panel}>
      {/* tabIndex -1: focusable by the app (after the last fix), not a Tab stop. */}
      <h2 className="panel__title" ref={heading} tabIndex={-1}>
        {t('checksHeading')}
      </h2>
      <p className="muted">{t('checksIntro')}</p>
      {traps.length === 0 ? (
        <p className="status-line status-line--ok">
          <OkIcon />
          {t('checksNone')}
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.severity} className="trap-group" aria-labelledby={`traps-${g.severity}`}>
            <h3 id={`traps-${g.severity}`} className="trap-group__title">
              {tn(GROUP_TITLE[g.severity], g.traps.length)}
            </h3>
            <ul className="trap-list">
              {g.traps.map((trap, i) => (
                <li key={`${trap.id}-${trap.line}-${i}`} className={`trap trap--${trap.severity}`}>
                  <h4 className="trap__title" tabIndex={-1}>
                    <SeverityLabel severity={trap.severity} />
                    <span className="trap__text">{trap.title}</span>
                  </h4>
                  <Button className="link-button" onPress={() => onGoToLine(trap)} aria-label={t('goToLine', { line: trap.line })}>
                    {t('lineButton', { line: trap.line })}
                  </Button>
                  <p>{trap.why}</p>
                  <p>
                    <strong>{t('whatNgspiceDoes')}</strong> {trap.ngspice}
                  </p>
                  {trap.fixes.length > 0 && (
                    // A named group of buttons ("Fixes for line 3"); a fieldset is for form fields.
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                    <div className="trap__fixes" role="group" aria-label={t('fixesLabel', { line: trap.line })}>
                      {trap.fixes.map((fix, k) => (
                        <Button
                          key={k}
                          className="button button--fix"
                          onPress={() => {
                            fixedAt.current = placeOf.get(trap) ?? 0;
                            onFix(fix);
                          }}
                        >
                          {fix.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
