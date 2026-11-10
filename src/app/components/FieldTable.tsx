/**
 * A line's field table, in the channel's words: one row per word of the line, with what it means
 * here. The words that carry the meaning (+, −, from, to ...) are emphasised with bold and an
 * underline, never by colour alone.
 */
import { Fragment, type ReactNode } from 'react';
import type { FieldExplanation, LineExplanation } from '../../spice/types.ts';
import { t } from '../../i18n/index.ts';

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

export function FieldTable({ explanation }: { explanation: LineExplanation }): ReactNode {
  if (!explanation.fields.length) return null;
  return (
    <div className="table-wrap">
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
          {explanation.fields.map((f: FieldExplanation, i) => (
            <tr key={`${i}-${f.label}`}>
              <th scope="row">{f.label}</th>
              <td>{f.text ? <code className="code">{f.text}</code> : <span className="muted">{t('fieldMissing')}</span>}</td>
              <td>{emphasise(f.meaning, f.emphasis)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Heading, summary, field table and notes of one line. */
export function LineExplanationView({ explanation, headingLevel }: { explanation: LineExplanation; headingLevel: 3 | 4 }): ReactNode {
  const H = headingLevel === 3 ? 'h3' : 'h4';
  return (
    <>
      <H className="explain__heading">{t('explainedLine', { line: explanation.line, heading: explanation.heading })}</H>
      {explanation.summary && <p className="explain__summary">{explanation.summary}</p>}
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
