/**
 * A line's field table, in the channel's words: one row per word of the line, with what it means
 * here. The words that carry the meaning (+, −, from, to ...) are emphasised with bold and an
 * underline, never by colour alone.
 */
import { Fragment, type ReactNode } from 'react';
import type { FieldExplanation, LineExplanation } from '../../spice/types.ts';
import { t, tn } from '../../i18n/index.ts';
import { TableWrap } from './TableWrap.tsx';

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `text` with every occurrence of the emphasis words wrapped in <strong>. */
export function emphasise(text: string, words: readonly string[] | undefined): ReactNode {
  const list = (words ?? []).filter((w) => w.trim() !== '').sort((a, b) => b.length - a.length);
  if (!list.length) return text;
  const parts = text.split(new RegExp(`(${list.map(escape).join('|')})`, 'g'));
  return parts.map((part, i) =>
    list.includes(part) ? (
      <strong key={i} className="emph">
        {part}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** Rows drawn at most: a part with thousands of words (a PWL source pasted from a file) stays quick. */
export const MAX_FIELD_ROWS = 200;

export function FieldTable({ explanation }: { explanation: LineExplanation }): ReactNode {
  if (!explanation.fields.length) return null;
  const more = explanation.fields.length - MAX_FIELD_ROWS;
  return (
    <>
      <TableWrap label={t('fieldTableCaption', { line: explanation.line })}>
        <table className="table table--fields">
          <caption>{t('fieldTableCaption', { line: explanation.line })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('fieldColumnField')}</th>
              <th scope="col">{t('fieldColumnWritten')}</th>
              <th scope="col">{t('fieldColumnMeaning')}</th>
            </tr>
          </thead>
          <tbody>
            {explanation.fields.slice(0, MAX_FIELD_ROWS).map((f: FieldExplanation, i) => (
              <tr key={`${i}-${f.label}`}>
                <th scope="row">{f.label}</th>
                <td>{f.text ? <code className="code">{f.text}</code> : <span className="muted">{t('fieldMissing')}</span>}</td>
                <td>{emphasise(f.meaning, f.emphasis)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {more > 0 && <p className="muted">{tn('fieldRowsMore', more)}</p>}
    </>
  );
}

/** Two explanations that read the same (the parser makes new objects on every reparse). */
export function sameExplanation(a: LineExplanation, b: LineExplanation): boolean {
  if (a === b) return true;
  if (a.line !== b.line || a.heading !== b.heading || a.summary !== b.summary) return false;
  if (a.notes.length !== b.notes.length || a.notes.some((n, i) => n !== b.notes[i])) return false;
  if (a.fields.length !== b.fields.length) return false;
  return a.fields.every((f, i) => {
    const g = b.fields[i]!;
    return f.label === g.label && f.text === g.text && f.meaning === g.meaning && (f.emphasis ?? []).join('\n') === (g.emphasis ?? []).join('\n');
  });
}

/** Heading, summary, field table and notes of one line (`hideHeading`: the table and notes only, under a heading of the page's own). */
export function LineExplanationView({ explanation, headingLevel, hideHeading = false }: { explanation: LineExplanation; headingLevel: 3 | 4; hideHeading?: boolean }): ReactNode {
  const H = headingLevel === 3 ? 'h3' : 'h4';
  return (
    <>
      {hideHeading ? null : <H className="explain__heading">{t('explainedLine', { line: explanation.line, heading: explanation.heading })}</H>}
      {!hideHeading && explanation.summary && <p className="explain__summary">{explanation.summary}</p>}
      <FieldTable explanation={explanation} />
      {explanation.notes.length > 0 && (
        <ul className="explain__notes">
          {explanation.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </>
  );
}
