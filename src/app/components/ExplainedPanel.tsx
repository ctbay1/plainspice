/**
 * The Explained tab: the whole circuit in words (describeCircuit, also what a screen reader user
 * gets instead of a picture), then every line with its heading, summary and field table, and a
 * "Line n" button that selects the line in the editor.
 *
 * Typing re-reads the netlist every few keystrokes, so this tab is kept cheap (perf review 1):
 * - it follows the netlist with useDeferredValue, so a keystroke is drawn before the explanations;
 * - each line's view is memoised by its content, so only the lines that changed are drawn again;
 * - the "Line n" buttons are the panel's Tab stops (React Aria's tab panel otherwise searched the
 *   whole panel for one after every change);
 * - a long netlist shows its first lines and a button for the rest.
 */
import { memo, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from 'react-aria-components';
import { t, tn } from '../../i18n/index.ts';
import type { LineExplanation, Netlist } from '../../spice/types.ts';
import { describeCircuit, explainLine, explainNetlist, loadDescribe, type DescribeModule } from '../model.ts';
import { LineExplanationView, sameExplanation } from './FieldTable.tsx';

/** Lines shown before "Show the other n lines". */
export const FIRST_LINES = 60;

const ExplainedLine = memo(
  function ExplainedLine({ explanation, onGoToLine }: { explanation: LineExplanation; onGoToLine: (line: number) => void }): ReactNode {
    const e = explanation;
    return (
      <article className="explain" aria-label={t('explainedLine', { line: e.line, heading: e.heading })}>
        <LineExplanationView explanation={e} headingLevel={3} />
        <Button className="link-button explain__go" onPress={() => onGoToLine(e.line)} aria-label={t('goToLine', { line: e.line })}>
          {t('explainedGoTo', { line: e.line })}
        </Button>
      </article>
    );
  },
  (a, b) => a.onGoToLine === b.onGoToLine && sameExplanation(a.explanation, b.explanation),
);

export function ExplainedPanel({ netlist, onGoToLine }: { netlist: Netlist; onGoToLine: (line: number) => void }): ReactNode {
  const shown = useDeferredValue(netlist);
  const [all, setAll] = useState(false);
  // Only the lines shown are explained: a pasted netlist can have thousands.
  const visible = useMemo(
    () =>
      all
        ? explainNetlist(shown)
        : shown.lines.slice(0, FIRST_LINES).flatMap((l) => {
            const e = explainLine(shown, l.index);
            return e ? [e] : [];
          }),
    [all, shown],
  );
  const hidden = all ? 0 : Math.max(0, shown.lines.length - FIRST_LINES);
  // describe.ts loads apart from the first screen; the circuit in words appears once it is in.
  const [describe, setDescribe] = useState<DescribeModule | null>(null);
  useEffect(() => {
    let alive = true;
    loadDescribe().then(
      (m) => alive && setDescribe(() => m),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  const circuit = useMemo(() => describeCircuit(describe, shown), [describe, shown]);
  return (
    <div className="panel">
      <h2 className="panel__title">{t('explainedHeading')}</h2>
      {circuit && (
        <section className="circuit-words" aria-labelledby="circuit-words">
          <h3 id="circuit-words">{t('circuitInWords')}</h3>
          <p>{circuit}</p>
        </section>
      )}
      <p className="muted">{t('explainedIntro')}</p>
      {visible.map((e) => (
        <ExplainedLine key={e.line} explanation={e} onGoToLine={onGoToLine} />
      ))}
      {hidden > 0 && (
        <Button className="button button--tool" onPress={() => setAll(true)}>
          {tn('explainedShowAll', hidden)}
        </Button>
      )}
    </div>
  );
}
