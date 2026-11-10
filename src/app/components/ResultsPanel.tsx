/**
 * The Results tab: what ngspice computed, in plain units, next to what ngspice printed.
 *
 * - A status banner: finished / ngspice's DC solution failed (the numbers are not answers) /
 *   ngspice stopped with an error / stopped / could not run.
 * - The plain-words summary (src/spice/describe.ts), then tables: node voltages (colour swatch and
 *   name, voltage, ngspice's printout), currents (part, size, which way it flows, power for
 *   sources, ngspice's vector), .tf results, and the sweeps in words. Every number is shown as
 *   "14 V" and read out as "14 volts".
 * - ngspice's messages in plain words, each with a "Line n" button when it is about a line.
 * - When the DC solution failed, the numbers stay folded under "What ngspice printed anyway".
 */
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';
import type { AnalysisResults } from '../../engine/results.ts';
import { formatLikeNgspice, formatNumber, formatSI, speakSI } from '../../format/si.ts';
import { t, tn, type MessageKey } from '../../i18n/index.ts';
import type { Trap } from '../../spice/types.ts';
import type { MessageWords, ResultsDescription, TransferFunctionWords } from '../model.ts';
import type { RunOutcome } from '../state.ts';
import { ErrorIcon, InfoIcon, OkIcon, StopIcon, WarningIcon } from './Icons.tsx';

/** A number shown with its unit symbol and read out with the unit in words. */
function Quantity({ text, speech }: { text: string; speech: string }): ReactNode {
  return (
    <>
      <span aria-hidden="true">{text}</span>
      <span className="visually-hidden">{speech}</span>
    </>
  );
}

type BannerKind = 'finished' | 'unreliable' | 'error' | 'stopped' | 'failed';

function StatusBanner({ kind, text }: { kind: BannerKind; text: string }): ReactNode {
  const word: Record<BannerKind, MessageKey> = {
    finished: 'statusFinished',
    unreliable: 'statusUnreliable',
    error: 'statusError',
    stopped: 'statusStopped',
    failed: 'statusFailed',
  };
  const Icon = kind === 'finished' ? OkIcon : kind === 'unreliable' ? WarningIcon : kind === 'stopped' ? StopIcon : ErrorIcon;
  return (
    <div className={`banner banner--${kind}`}>
      <span className="banner__word">
        <Icon />
        {t(word[kind])}
      </span>
      <span className="banner__text">{text}</span>
    </div>
  );
}

function NodeTable({ description, colours }: { description: ResultsDescription; colours: ReadonlyMap<string, string> }): ReactNode {
  if (!description.nodes.length) return null;
  return (
    <div className="table-wrap">
      <table className="table table--results">
        <caption>{t('nodesCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('columnNode')}</th>
            <th scope="col">{t('columnVoltage')}</th>
            <th scope="col">{t('columnPrinted')}</th>
          </tr>
        </thead>
        <tbody>
          {description.nodes.map((n) => {
            const colour = colours.get(n.node);
            return (
              <tr key={n.node}>
                <th scope="row" className="node-name">
                  <span className={`swatch${colour ? '' : ' swatch--none'}`} style={colour ? { background: colour } : undefined} aria-hidden="true" />
                  <code className="code">{n.node}</code>
                </th>
                <td className="num">
                  <Quantity text={n.text} speech={n.speech} />
                </td>
                <td className="num">
                  <code className="code">
                    v({n.node}) = {formatLikeNgspice(n.value)}
                  </code>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CurrentTable({ description, results }: { description: ResultsDescription; results: AnalysisResults }): ReactNode {
  if (!description.currents.length) return null;
  const showPower = description.currents.some((c) => c.power !== undefined);
  const vectorOf = (element: string): string => results.op?.currents.find((c) => c.element === element)?.vector ?? `i(${element})`;
  return (
    <div className="table-wrap">
      <table className="table table--results">
        <caption>{t('currentsCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('columnPart')}</th>
            <th scope="col">{t('columnCurrent')}</th>
            <th scope="col">{t('columnDirection')}</th>
            {showPower && <th scope="col">{t('columnPower')}</th>}
            <th scope="col">{t('columnVector')}</th>
          </tr>
        </thead>
        <tbody>
          {description.currents.map((c) => (
            <tr key={c.element}>
              <th scope="row">
                <code className="code">{c.name}</code>
              </th>
              <td className="num">
                <Quantity text={formatSI(Math.abs(c.value), 'A')} speech={speakSI(Math.abs(c.value), 'A')} />
              </td>
              <td>{c.value === 0 ? t('flowsNone') : t('flowsFromTo', { from: c.from, to: c.to })}</td>
              {showPower && (
                <td>
                  {c.power && (
                    <Quantity
                      text={t(c.power.delivers ? 'powerDelivers' : 'powerAbsorbs', { power: formatSI(c.power.watts, 'W') })}
                      speech={t(c.power.delivers ? 'powerDelivers' : 'powerAbsorbs', { power: speakSI(c.power.watts, 'W') })}
                    />
                  )}
                </td>
              )}
              <td className="num">
                <code className="code">
                  {vectorOf(c.element)} = {formatLikeNgspice(c.value)}
                </code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * describe.ts writes the summary for the live region, ending "Open the results for details.";
 * here the details are right below it, so that last sentence is left out.
 */
function panelSummary(summary: string): string {
  return summary.replace(/\s*Open the results for details\.\s*$/, '');
}

/** A .tf ratio's unit in words, for screen readers ("0.3333 volts per volt"). */
const RATIO_WORDS: Record<string, MessageKey> = { 'V/V': 'ratioVV', 'A/A': 'ratioAA', 'A/V': 'ratioAV', 'V/A': 'ratioVA' };

function TfTable({ tf }: { tf: TransferFunctionWords }): ReactNode {
  const rows: { label: string; text: string; speech: string; value: number }[] = [];
  if (tf.transferFunction) {
    const v = tf.transferFunction.value;
    rows.push({
      label: t('tfRatio', { output: tf.output, source: tf.input }),
      text: `${formatNumber(v)} ${tf.ratio}`,
      speech: `${formatNumber(v).replace('−', `${t('minusWord')} `)} ${RATIO_WORDS[tf.ratio] ? t(RATIO_WORDS[tf.ratio]!) : tf.ratio}`,
      value: v,
    });
  }
  if (tf.outputResistance) {
    const v = tf.outputResistance.value;
    rows.push({ label: t('tfOutput', { output: tf.output }), text: formatSI(v, 'Ω'), speech: speakSI(v, 'Ω'), value: v });
  }
  if (tf.inputResistance) {
    const v = tf.inputResistance.value;
    rows.push({ label: t('tfInput', { source: tf.input }), text: formatSI(v, 'Ω'), speech: speakSI(v, 'Ω'), value: v });
  }
  if (!rows.length) return null;
  return (
    <div className="table-wrap">
      <table className="table table--results">
        <caption>{t('tfCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('columnQuantity')}</th>
            <th scope="col">{t('columnValue')}</th>
            <th scope="col">{t('columnPrinted')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td className="num">
                <Quantity text={r.text} speech={r.speech} />
              </td>
              <td className="num">
                <code className="code">{formatLikeNgspice(r.value)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MESSAGE_ICON = { error: ErrorIcon, warning: WarningIcon, note: InfoIcon } as const;
const MESSAGE_WORD: Record<MessageWords['severity'], MessageKey> = { error: 'severityError', warning: 'severityWarning', note: 'severityInfo' };

function Messages({ warnings, onGoToLine }: { warnings: readonly MessageWords[]; onGoToLine: (line: number) => void }): ReactNode {
  if (!warnings.length) return null;
  return (
    <section className="messages" aria-labelledby="ngspice-messages">
      <h3 id="ngspice-messages">{t('messagesHeading')}</h3>
      <ul className="message-list">
        {warnings.map((m, i) => {
          const Icon = MESSAGE_ICON[m.severity];
          return (
            <li key={`${m.code}-${i}`} className={`message message--${m.severity}`}>
              <p className="message__title">
                <span className={`severity severity--${m.severity === 'note' ? 'info' : m.severity}`}>
                  <Icon />
                  {t(MESSAGE_WORD[m.severity])}
                </span>{' '}
                <strong>{m.title}</strong>
                {m.line !== undefined && (
                  <>
                    {' '}
                    <Button className="link-button" onPress={() => onGoToLine(m.line!)} aria-label={t('goToLine', { line: m.line })}>
                      {t('lineButton', { line: m.line })}
                    </Button>
                  </>
                )}
              </p>
              {m.why && <p>{m.why}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ResultsPanel({
  outcome,
  running,
  traps,
  colours,
  plotAvailable,
  onGoToLine,
  onShowChecks,
  onShowPlot,
}: {
  outcome: RunOutcome;
  running: boolean;
  traps: readonly Trap[];
  colours: ReadonlyMap<string, string>;
  plotAvailable: boolean;
  onGoToLine: (line: number) => void;
  onShowChecks: () => void;
  onShowPlot: () => void;
}): ReactNode {
  return (
    <div className="panel">
      <h2 className="panel__title">{t('resultsHeading')}</h2>
      {running && <p className="status-line">{t('resultsRunning')}</p>}
      {outcome.kind === 'none' && !running && <p className="muted">{t('resultsEmpty')}</p>}
      {outcome.kind === 'stopped' && <StatusBanner kind="stopped" text={t('statusStoppedText')} />}
      {outcome.kind === 'failed' && <StatusBanner kind="failed" text={t('statusFailedText', { reason: outcome.reason })} />}
      {outcome.kind === 'done' && (
        <DoneResults
          outcome={outcome}
          traps={traps}
          colours={colours}
          plotAvailable={plotAvailable}
          onGoToLine={onGoToLine}
          onShowChecks={onShowChecks}
          onShowPlot={onShowPlot}
        />
      )}
    </div>
  );
}

function DoneResults({
  outcome,
  traps,
  colours,
  plotAvailable,
  onGoToLine,
  onShowChecks,
  onShowPlot,
}: {
  outcome: Extract<RunOutcome, { kind: 'done' }>;
  traps: readonly Trap[];
  colours: ReadonlyMap<string, string>;
  plotAvailable: boolean;
  onGoToLine: (line: number) => void;
  onShowChecks: () => void;
  onShowPlot: () => void;
}): ReactNode {
  const { results, description } = outcome;
  const kind: BannerKind = description.status === 'ok' ? 'finished' : description.status === 'unreliable' ? 'unreliable' : 'error';
  const text = kind === 'finished' ? t('statusFinishedText') : kind === 'unreliable' ? t('statusUnreliableText') : t('statusErrorText');
  const tables = (
    <>
      <NodeTable description={description} colours={colours} />
      <CurrentTable description={description} results={results} />
      {description.tf && <TfTable tf={description.tf} />}
    </>
  );
  const hasNumbers = description.nodes.length > 0 || description.currents.length > 0 || description.tf !== undefined;
  return (
    <>
      {outcome.stale && <p className="message message--note">{t('staleResults')}</p>}
      <StatusBanner kind={kind} text={text} />
      {traps.length > 0 && (
        <p className="message message--note">
          {tn('trapsNote', traps.length)}{' '}
          <Button className="link-button" onPress={onShowChecks}>
            {t('showChecks')}
          </Button>
        </p>
      )}
      {kind === 'finished' && description.summary && <p className="summary">{panelSummary(description.summary)}</p>}
      {kind === 'finished' && tables}
      {kind === 'finished' && description.sweeps.length > 0 && (
        <ul className="sweeps">
          {description.sweeps.map((s, i) => (
            <li key={i}>
              <span aria-hidden="true">{s.text}</span>
              <span className="visually-hidden">{s.speech}</span>
            </li>
          ))}
        </ul>
      )}
      {kind === 'finished' && plotAvailable && (
        <p>
          {t('sweepsNote')}{' '}
          <Button className="link-button" onPress={onShowPlot}>
            {t('showPlot')}
          </Button>
        </p>
      )}
      <Messages warnings={description.warnings} onGoToLine={onGoToLine} />
      {kind === 'unreliable' && hasNumbers && (
        <details className="disclosure">
          <summary>{t('printedAnyway')}</summary>
          {tables}
        </details>
      )}
    </>
  );
}
