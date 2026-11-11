/**
 * The Explain panel: the selected part's netlist line first, field by field (the channel's field
 * tables: the line with each field's name written over its word, then the table), with its current
 * and power from the last run; or the selected node and what it connects; then the whole circuit in
 * words (describeCircuit, also what a screen reader user gets instead of the picture); then every
 * line of the netlist explained, each with a "Go to line n" button. Every sentence comes from the
 * model (src/spice/explain.ts, describe.ts, src/schematic/navigate.ts).
 *
 * Typing re-reads the netlist on every change, so the list is kept cheap (perf review 1): it
 * follows the netlist with useDeferredValue, each line's view is memoised by its content, and a long
 * netlist shows its first lines and a button for the rest.
 */
import { memo, useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { t, tn } from '../../i18n/index.ts';
import { lowerAscii } from '../../spice/parse.ts';
import type { LineExplanation, Netlist } from '../../spice/types.ts';
import { describeCircuit, explainLine, explainNetlist } from '../model.ts';
import { LineExplanationView, sameExplanation } from './FieldTable.tsx';

/** Lines shown before "Show the other n lines". */
export const FIRST_LINES = 60;

export type ExplainSelection =
  | { kind: 'line'; line: number; current?: string; power?: string }
  | { kind: 'node'; name: string; voltage?: string; parts: string };

const ExplainedLine = memo(
  function ExplainedLine({ explanation, onGoToLine }: { explanation: LineExplanation; onGoToLine: (line: number) => void }): ReactNode {
    const e = explanation;
    return (
      <article className="explain" aria-label={t('explainedLine', { line: e.line, heading: e.heading })}>
        <LineExplanationView explanation={e} headingLevel={4} />
        <button type="button" className="link-button explain__go" onClick={() => onGoToLine(e.line)}>
          {t('goToLine', { line: e.line })}
        </button>
      </article>
    );
  },
  (a, b) => a.onGoToLine === b.onGoToLine && sameExplanation(a.explanation, b.explanation),
);

/** The netlist line with each field's name written over its word (decorative: the table below says the same). */
function FieldStrip({ ex, colours }: { ex: LineExplanation; colours: ReadonlyMap<string, string> }): ReactNode {
  return (
    <div className="field-strip" aria-hidden="true">
      {ex.fields.map((f, i) => {
        const node = /node/.test(f.label) ? colours.get(lowerAscii(f.text)) : undefined;
        return (
          <span key={i} className={`field-strip__field${node ? ' field-strip__field--node' : ''}`} style={node ? { ['--node' as string]: node } : undefined}>
            <span className="field-strip__label">{f.label}</span>
            <span className="field-strip__text">{f.text || '·'}</span>
          </span>
        );
      })}
    </div>
  );
}

export function ExplainPanel({
  netlist,
  selection,
  parts,
  colours,
  onGoToLine,
  onPick,
}: {
  netlist: Netlist;
  selection: ExplainSelection | undefined;
  /** The drawn parts, to choose one from when nothing is selected. */
  parts: readonly { key: string; name: string; kind: string }[];
  colours: ReadonlyMap<string, string>;
  onGoToLine: (line: number) => void;
  onPick: (key: string) => void;
}): ReactNode {
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
  const circuit = useMemo(() => describeCircuit(shown), [shown]);
  const selected = selection?.kind === 'line' ? explainLine(shown, selection.line - 1) : undefined;

  return (
    <div className="explain-panel">
      <section className="explain-block" aria-labelledby="explain-selected">
        {selection?.kind === 'line' && selected ? (
          <>
            <p className="kicker" id="explain-selected">
              {t('explainSelectedLine', { line: selected.line })}
            </p>
            <h3 className="explain-block__head">{selected.heading}</h3>
            {selected.summary ? <p className="explain-block__summary">{selected.summary}</p> : null}
            {selected.fields.length ? <FieldStrip ex={selected} colours={colours} /> : null}
            <LineExplanationView explanation={selected} headingLevel={4} hideHeading />
            {selection.current ? (
              <p className="explain-block__results">
                <span className="hand explain-block__amps">{selection.current}</span>
                {selection.power ? <span className="hand explain-block__power">{selection.power}</span> : null}
              </p>
            ) : null}
            <button type="button" className="link-button" onClick={() => onGoToLine(selected.line)}>
              {t('goToLine', { line: selected.line })}
            </button>
          </>
        ) : selection?.kind === 'node' ? (
          <>
            <p className="kicker" id="explain-selected">
              {t('explainNode')}
            </p>
            <h3 className="explain-block__head">
              {selection.name}
              {selection.voltage ? <span className="hand explain-block__volts"> {selection.voltage}</span> : null}
            </h3>
            <p className="explain-block__summary">{selection.parts}</p>
          </>
        ) : (
          <>
            <p className="kicker" id="explain-selected">
              {t('explainChoose')}
            </p>
            <p className="explain-block__summary">{t('explainChooseText')}</p>
            {parts.length ? (
              <div className="chips">
                {parts.map((x) => (
                  <button key={x.key} type="button" className="chip" onClick={() => onPick(x.key)}>
                    <b>{x.name}</b> {x.kind}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}
      </section>
      {circuit ? (
        <section className="explain-block" aria-labelledby="circuit-words">
          <h3 className="kicker" id="circuit-words">
            {t('circuitInWords')}
          </h3>
          <p className="explain-block__words">{circuit}</p>
        </section>
      ) : null}
      <section className="explain-block" aria-labelledby="every-line">
        <h3 className="kicker" id="every-line">
          {t('explainedHeading')}
        </h3>
        <p className="muted">{t('explainedIntro')}</p>
        {visible.map((e) => (
          <ExplainedLine key={e.line} explanation={e} onGoToLine={onGoToLine} />
        ))}
        {hidden > 0 && (
          <button type="button" className="button button--paper" onClick={() => setAll(true)}>
            {tn('explainedShowAll', hidden)}
          </button>
        )}
      </section>
    </div>
  );
}
