/** The ngspice output tab: exactly what ngspice printed, and the command it was run with. */
import type { ReactNode } from 'react';
import type { RunResult } from '../../engine/types.ts';
import { t } from '../../i18n/index.ts';

function Printed({ id, title, text }: { id: string; title: string; text: string }): ReactNode {
  return (
    <>
      <h3 id={id}>{title}</h3>
      {/* A scrolling box: focusable so the keyboard can scroll it (WCAG 2.1.1), and named by its heading. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex, jsx-a11y/prefer-tag-over-role */}
      <pre className="printout" tabIndex={0} role="region" aria-labelledby={id}>
        {text.trim() ? text : t('outputEmpty')}
      </pre>
    </>
  );
}

export function OutputPanel({ result, added }: { result: RunResult | undefined; added: readonly string[] }): ReactNode {
  return (
    <div className="panel">
      <h2 className="panel__title">{t('outputHeading')}</h2>
      <p>{t('outputIntro')}</p>
      <pre className="command">
        <code>{t('outputCommand')}</code>
      </pre>
      {result ? (
        <>
          <p className="muted">{t('outputExit', { code: String(result.exitCode ?? '?'), ms: Math.round(result.timings.runMs) })}</p>
          {added.length > 0 && (
            <>
              <p>{t('outputAdded')}</p>
              <pre className="command">
                <code>{added.join('\n')}</code>
              </pre>
            </>
          )}
          <Printed id="ngspice-stdout" title={t('outputStdout')} text={result.stdout} />
          <Printed id="ngspice-stderr" title={t('outputStderr')} text={result.stderr} />
        </>
      ) : (
        <p className="muted">{t('outputNone')}</p>
      )}
    </div>
  );
}
