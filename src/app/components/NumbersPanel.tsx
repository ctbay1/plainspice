/**
 * The Numbers panel: every result of the last run in tables, in plain units next to the same values
 * in ngspice's format, for precise values and for screen readers (the drawing shows the same numbers
 * handwritten, decision 0016).
 *
 * - A status banner: finished / not reliable (ngspice's DC solution failed, or a check found an
 *   error, so the numbers are not answers) / ngspice stopped with an error / no results (ngspice
 *   finished quietly without any) / stopped / could not run.
 * - The plain-words summary (src/spice/describe.ts), then tables: node voltages (colour swatch and
 *   name, voltage, ngspice's format), currents (part, size, which way it flows, power for sources,
 *   ngspice's vector), .tf results, and the sweeps in words. Every number is shown as "14 V" and
 *   read out as "14 volts".
 * - What happened, in plain words: ngspice's messages and PlainSpice's own findings, each with a
 *   "Line n" button when it is about a line.
 * - When the numbers are not answers, they stay folded under "What ngspice printed anyway".
 *
 * The panel and its tables are memoised: live runs come every few keystrokes, and drawing hundreds
 * of result rows again each time made typing slow (perf review 5).
 */
import { memo, type ReactNode } from 'react';
import type { AnalysisResults } from '../../engine/results.ts';
import { formatLikeNgspice, formatNumber, formatSI, speakSI } from '../../format/si.ts';
import { t, tn, type MessageKey } from '../../i18n/index.ts';
import type { Trap } from '../../spice/types.ts';
import type { LiveOutcome } from '../live.ts';
import { errorTrap, type MessageWords, type ResultsDescription, type RunRecord, type TransferFunctionWords } from '../model.ts';
import { sameColours } from '../nodes.ts';
import { pressRun } from '../words.ts';
import { nodeWord } from '../../notebook/words.ts';
import { ErrorIcon, InfoIcon, OkIcon, StopIcon, WarningIcon } from './Icons.tsx';
import { TableWrap } from './TableWrap.tsx';

/** A number shown with its unit symbol and read out with the unit in words. */
function Quantity({ text, speech }: { text: string; speech: string }): ReactNode {
  return (
    <>
      <span aria-hidden="true">{text}</span>
      <span className="visually-hidden">{speech}</span>
    </>
  );
}

type BannerKind = 'finished' | 'unreliable' | 'error' | 'empty' | 'stopped' | 'failed';

function StatusBanner({ kind, text }: { kind: BannerKind; text: string }): ReactNode {
  const word: Record<BannerKind, MessageKey> = {
    finished: 'statusFinished',
    unreliable: 'statusUnreliable',
    error: 'statusError',
    empty: 'statusEmpty',
    stopped: 'statusStopped',
    failed: 'statusFailed',
  };
  const Icon = kind === 'finished' ? OkIcon : kind === 'unreliable' ? WarningIcon : kind === 'stopped' ? StopIcon : kind === 'empty' ? InfoIcon : ErrorIcon;
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

const NodeTable = memo(
  function NodeTable({ description, colours }: { description: ResultsDescription; colours: ReadonlyMap<string, string> }): ReactNode {
    if (!description.nodes.length) return null;
    return (
      <TableWrap label={t('nodesCaption')}>
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
                      {/* ngspice's own spelling ("giri__" for "giriş", W16) and value, also when the voltage is said as 0 V (rounding noise, C9d). */}
                      v({n.ngspice ?? n.node}) = {formatLikeNgspice(n.noise ?? n.value)}
                    </code>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    );
  },
  (a, b) => a.description === b.description && sameColours(a.colours, b.colours),
);

const CurrentTable = memo(function CurrentTable({ description, results }: { description: ResultsDescription; results: AnalysisResults }): ReactNode {
  if (!description.currents.length) return null;
  const showPower = description.currents.some((c) => c.power !== undefined);
  const vectorOf = (element: string): string => results.op?.currents.find((c) => c.element === element)?.vector ?? `i(${element})`;
  return (
    <TableWrap label={t('currentsCaption')}>
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
              {/* Ground called "ground", as on the drawing and the card. */}
              <td>{c.value === 0 ? t('flowsNone') : t('flowsFromTo', { from: nodeWord(c.from), to: nodeWord(c.to) })}</td>
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
                  {/* ngspice's own vector and value, also when the current is said as 0 A (rounding noise, C9). */}
                  {c.vector ?? vectorOf(c.element)} = {formatLikeNgspice(c.noise ?? c.value)}
                </code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
});

/**
 * describe.ts writes the summary for the live region, ending "Open the results for details.";
 * here the details are right below it, so that last sentence is left out.
 */
function panelSummary(summary: string): string {
  return summary.replace(/\s*Open the results for details\.\s*$/, '');
}

/** A .tf ratio's unit in words, for screen readers ("0.3333 volts per volt"). */
const RATIO_WORDS: Record<string, MessageKey> = { 'V/V': 'ratioVV', 'A/A': 'ratioAA', 'A/V': 'ratioAV', 'V/A': 'ratioVA' };

export interface TfRow {
  label: string;
  text: string;
  speech: string;
  value: number;
  /** ngspice's own value, when PlainSpice shows its rounding noise of a 0 as 0 (decision 0015, C9p). */
  given?: number;
}

/** The .tf results as rows: the transfer function, the output resistance and the input resistance, in words (the drawing's card shows them too). */
export function tfRows(tf: TransferFunctionWords): TfRow[] {
  const rows: TfRow[] = [];
  if (tf.transferFunction) {
    const v = tf.transferFunction.value;
    rows.push({
      label: t('tfRatio', { output: tf.output, source: tf.input }),
      text: `${formatNumber(v)} ${tf.ratio}`,
      speech: `${formatNumber(v).replace('−', `${t('minusWord')} `)} ${RATIO_WORDS[tf.ratio] ? t(RATIO_WORDS[tf.ratio]!) : tf.ratio}`,
      value: v,
      ...(tf.transferFunction.noise !== undefined ? { given: tf.transferFunction.noise } : {}),
    });
  }
  if (tf.outputResistance) {
    const v = tf.outputResistance.value;
    // For a current output ngspice's "output impedance" is a stand-in (1e20 Ω, A5), not a resistance.
    const label = tf.ratio.startsWith('A/') ? t('tfOutputCurrent', { output: tf.output }) : t('tfOutput', { at: tf.at ?? tf.output });
    rows.push({ label, text: formatSI(v, 'Ω'), speech: speakSI(v, 'Ω'), value: v });
  }
  if (tf.inputResistance) {
    const v = tf.inputResistance.value;
    rows.push({ label: t('tfInput', { source: tf.input }), text: formatSI(v, 'Ω'), speech: speakSI(v, 'Ω'), value: v });
  }
  return rows;
}

const TfTable = memo(function TfTable({ tf }: { tf: TransferFunctionWords }): ReactNode {
  const rows = tfRows(tf);
  if (!rows.length) return null;
  return (
    <TableWrap label={t('tfCaption')}>
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
                <code className="code">{formatLikeNgspice(r.given ?? r.value)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
});

const MESSAGE_ICON = { error: ErrorIcon, warning: WarningIcon, note: InfoIcon } as const;
const MESSAGE_WORD: Record<MessageWords['severity'], MessageKey> = { error: 'severityError', warning: 'severityWarning', note: 'severityInfo' };
const RANK: Record<MessageWords['severity'], number> = { note: 0, warning: 1, error: 2 };
const AS_MESSAGE: Record<Trap['severity'], MessageWords['severity']> = { info: 'note', warning: 'warning', error: 'error' };

/**
 * One problem, one severity word (words review m7): a message about a line where a check found
 * something more serious takes the check's severity ("n9 is not a node" is an error in the Checks
 * tab, so it is one here too). An ngspice error is never made milder.
 */
function severityOf(m: MessageWords, traps: readonly Trap[]): MessageWords['severity'] {
  let severity = m.severity;
  if (m.line === undefined) return severity;
  for (const trap of traps) {
    if (trap.line !== m.line) continue;
    const s = AS_MESSAGE[trap.severity];
    if (RANK[s] > RANK[severity]) severity = s;
  }
  return severity;
}

function Messages({ warnings, traps, onGoToLine }: { warnings: readonly MessageWords[]; traps: readonly Trap[]; onGoToLine: (line: number) => void }): ReactNode {
  if (!warnings.length) return null;
  return (
    <section className="messages" aria-labelledby="ngspice-messages">
      <h3 id="ngspice-messages">{t('messagesHeading')}</h3>
      <ul className="message-list">
        {warnings.map((m, i) => {
          const severity = severityOf(m, traps);
          const Icon = MESSAGE_ICON[severity];
          return (
            <li key={`${m.code}-${i}`} className={`message message--${severity}`}>
              <p className="message__title">
                <span className={`severity severity--${severity === 'note' ? 'info' : severity}`}>
                  <Icon />
                  {t(MESSAGE_WORD[severity])}
                </span>{' '}
                <strong>{m.title}</strong>
                {m.line !== undefined && (
                  <>
                    {' '}
                    <button type="button" className="link-button" onClick={() => onGoToLine(m.line!)}>
                      {t('goToLine', { line: m.line })}
                    </button>
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

type Outcome = LiveOutcome<RunRecord>;

function timeoutText(outcome: Extract<Outcome, { kind: 'timeout' }>): string {
  const text = t('statusTimeoutText', { seconds: outcome.seconds });
  return outcome.points === undefined ? text : `${text} ${t('statusTimeoutPoints', { points: outcome.points.toLocaleString('en-US') })}`;
}

export const NumbersPanel = memo(function NumbersPanel({
  outcome,
  text,
  running,
  paused,
  colours,
  plotAvailable,
  phone = false,
  onGoToLine,
  onShowChecks,
  onShowPlot,
}: {
  outcome: Outcome;
  /** The netlist as it is now (results of an older text are marked as such). */
  text: string;
  running: boolean;
  /** Live runs wait for Run. */
  paused: boolean;
  colours: ReadonlyMap<string, string>;
  plotAvailable: boolean;
  /** A phone: Run is tapped, not pressed with keys. */
  phone?: boolean;
  onGoToLine: (line: number) => void;
  onShowChecks: () => void;
  onShowPlot: () => void;
}): ReactNode {
  return (
    <div className="numbers">
      {running && <p className="status-note">{t('resultsRunning')}</p>}
      {outcome.kind === 'none' && !running && <p className="muted">{paused ? t('resultsEmptyPaused', { run: pressRun(phone) }) : t('resultsEmpty')}</p>}
      {outcome.kind === 'nothing' && <p className="muted">{t('noAnalysis')}</p>}
      {outcome.kind === 'stopped' && <StatusBanner kind="stopped" text={t('statusStoppedText')} />}
      {outcome.kind === 'timeout' && <StatusBanner kind="stopped" text={timeoutText(outcome)} />}
      {outcome.kind === 'failed' && <StatusBanner kind="failed" text={t('statusFailedText', { reason: outcome.reason })} />}
      {outcome.kind === 'done' && (
        <DoneResults
          record={outcome.result}
          stale={paused && outcome.text !== text}
          phone={phone}
          colours={colours}
          plotAvailable={plotAvailable}
          onGoToLine={onGoToLine}
          onShowChecks={onShowChecks}
          onShowPlot={onShowPlot}
        />
      )}
    </div>
  );
});

/** The note that points to the Checks panel, worded for what the checks found (words review m8). */
function TrapsNote({ traps, onShowChecks }: { traps: readonly Trap[]; onShowChecks: () => void }): ReactNode {
  if (!traps.length) return null;
  const errors = traps.filter((x) => x.severity === 'error').length;
  const warnings = traps.filter((x) => x.severity === 'warning').length;
  const text = errors ? t('trapsNoteError') : warnings ? tn('trapsNoteWarning', warnings) : tn('trapsNoteInfo', traps.length);
  return (
    <p className="message message--note">
      {text}{' '}
      <button type="button" className="link-button" onClick={onShowChecks}>
        {t('showChecks')}
      </button>
    </p>
  );
}

function DoneResults({
  record,
  stale,
  phone,
  colours,
  plotAvailable,
  onGoToLine,
  onShowChecks,
  onShowPlot,
}: {
  record: RunRecord;
  stale: boolean;
  phone: boolean;
  colours: ReadonlyMap<string, string>;
  plotAvailable: boolean;
  onGoToLine: (line: number) => void;
  onShowChecks: () => void;
  onShowPlot: () => void;
}): ReactNode {
  const { results, words: description } = record;
  // A check that found an error means the numbers are not answers, however cleanly ngspice ran
  // (words review B1): they are folded away like those of a failed DC solution.
  const checkError = description.status === 'ok' ? errorTrap(record) : undefined;
  const kind: BannerKind =
    description.status === 'ok'
      ? checkError
        ? 'unreliable'
        : 'finished'
      : description.status === 'unreliable'
        ? 'unreliable'
        : description.ngspiceError
          ? 'error'
          : 'empty';
  const text =
    kind === 'finished'
      ? t('statusFinishedText')
      : kind === 'unreliable'
        ? checkError
          ? t('statusCheckedText', { title: checkError.title.replace(/[.!?:]$/, '') })
          : t('statusUnreliableText')
        : kind === 'error'
          ? t('statusErrorText')
          : t('statusEmptyText');
  const sweeps = description.sweeps.length > 0 && (
    <ul className="sweeps">
      {description.sweeps.map((s, i) => (
        <li key={i}>
          <span aria-hidden="true">{s.text}</span>
          <span className="visually-hidden">{s.speech}</span>
        </li>
      ))}
    </ul>
  );
  const tables = (
    <>
      <NodeTable description={description} colours={colours} />
      <CurrentTable description={description} results={results} />
      {description.tf && <TfTable tf={description.tf} />}
    </>
  );
  const hasNumbers = description.nodes.length > 0 || description.currents.length > 0 || description.tf !== undefined || description.sweeps.length > 0;
  return (
    <>
      {stale && <p className="message message--note">{t('staleResults', { run: pressRun(phone) })}</p>}
      <StatusBanner kind={kind} text={text} />
      <TrapsNote traps={record.checks} onShowChecks={onShowChecks} />
      {kind === 'finished' && description.summary && <p className="summary">{panelSummary(description.summary)}</p>}
      {kind === 'finished' && tables}
      {kind === 'finished' && sweeps}
      {kind === 'finished' && plotAvailable && (
        <p>
          {t('sweepsNote')}{' '}
          <button type="button" className="link-button" onClick={onShowPlot}>
            {t('showPlot')}
          </button>
        </p>
      )}
      <Messages warnings={description.warnings} traps={record.checks} onGoToLine={onGoToLine} />
      {kind === 'unreliable' && hasNumbers && (
        <details className="disclosure">
          <summary>{t('printedAnyway')}</summary>
          {tables}
          {sweeps}
        </details>
      )}
    </>
  );
}
