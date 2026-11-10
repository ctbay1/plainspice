/**
 * The Explained tab: the whole circuit in words (describeCircuit, also what a screen reader user
 * gets instead of a picture), then every line with its heading, summary and field table.
 */
import { useMemo, type ReactNode } from 'react';
import { t } from '../../i18n/index.ts';
import type { Netlist } from '../../spice/types.ts';
import { describeCircuit, explainNetlist } from '../model.ts';
import { LineExplanationView } from './FieldTable.tsx';

export function ExplainedPanel({ netlist }: { netlist: Netlist }): ReactNode {
  const lines = useMemo(() => explainNetlist(netlist), [netlist]);
  const circuit = useMemo(() => describeCircuit(netlist), [netlist]);
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
      {lines.map((e) => (
        <article key={e.line} className="explain" aria-label={t('explainedLine', { line: e.line, heading: e.heading })}>
          <LineExplanationView explanation={e} headingLevel={3} />
        </article>
      ))}
    </div>
  );
}
