/**
 * The Checks tab: beginner traps found before running (src/spice/traps.ts), grouped by severity.
 * Each says where (a "Line n" button that selects it in the editor), what, why, what ngspice does,
 * and offers its fixes as buttons. Severity is an icon AND a word, never colour alone.
 */
import type { ReactNode } from 'react';
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
  return (
    <div className="panel">
      <h2 className="panel__title">{t('checksHeading')}</h2>
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
                  <h4 className="trap__title">
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
                        <Button key={k} className="button button--fix" onPress={() => onFix(fix)}>
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
