/** The "This line" card: the field table of the line the editor's cursor is on. */
import { useMemo, type ReactNode } from 'react';
import { t } from '../../i18n/index.ts';
import type { Netlist } from '../../spice/types.ts';
import { explainLine } from '../model.ts';
import { LineExplanationView } from './FieldTable.tsx';

export function ThisLine({ netlist, line }: { netlist: Netlist; line: number }): ReactNode {
  const explanation = useMemo(() => explainLine(netlist, line - 1), [netlist, line]);
  return (
    <section className="card this-line" aria-labelledby="this-line-heading">
      <h2 id="this-line-heading" className="card__title">
        {t('thisLineHeading')}
      </h2>
      {explanation ? <LineExplanationView explanation={explanation} headingLevel={3} /> : <p className="muted">{t('thisLineEmpty')}</p>}
    </section>
  );
}
