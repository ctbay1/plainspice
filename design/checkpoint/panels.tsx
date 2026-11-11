/**
 * The panels, paper cards on divider tabs (a bottom sheet on a phone): the Netlist on the dark
 * "simulator screen" of the episodes, with the drawing's *@ block folded away (decision 0013:
 * positions live in the netlist, folded by default); the Checks (src/spice/traps.ts) with their
 * fixes; and Explain: the circuit in words (navigate.ts, describeSchematic) and the selected part's
 * line, field by field (src/spice/explain.ts). Every sentence about the circuit comes from the
 * model; nothing from a netlist is put into the page as HTML.
 */
import { useState, type ReactNode } from 'react';
import type { LineAnnotation } from '../../src/spice/describe.ts';
import { lowerAscii } from '../../src/spice/parse.ts';
import type { Fix, LineExplanation, Netlist, Trap } from '../../src/spice/types.ts';
import { Icon } from './icons.tsx';

export type PanelId = 'netlist' | 'checks' | 'explain';

export const PANEL_TITLES: Readonly<Record<PanelId, { title: string; sub: string }>> = {
  netlist: { title: 'Netlist', sub: 'the circuit as SPICE reads it' },
  checks: { title: 'Checks', sub: 'before every run' },
  explain: { title: 'Explain', sub: 'in plain words' },
};

/**
 * The trap's "what ngspice does" without the claim IDs at its end ("[mega-as-milli-1, …]"): they
 * name the evidence in docs/spice-facts/ and mean nothing to a student (the app's rule,
 * src/app/components/ChecksPanel.tsx).
 */
export function withoutClaimIds(text: string): string {
  return text.replace(/\s*\[[a-z][\w-]*\d[a-z]?(?:(?:,\s*|\s*\.\.\.\s*)[a-z][\w-]*\d[a-z]?)*\]\s*$/, '');
}

export function PanelHead({ id, sub, onClose, headingRef }: { id: PanelId; sub?: string; onClose: () => void; headingRef?: (el: HTMLHeadingElement | null) => void }): ReactNode {
  const t = PANEL_TITLES[id];
  return (
    <header className="ck-card__head">
      <div className="ck-card__titles">
        <h2 className="ck-card__title" id={`panel-${id}-title`} tabIndex={-1} ref={headingRef}>
          {t.title}
        </h2>
        <p className="ck-card__sub">{sub ?? t.sub}</p>
      </div>
      <button className="ck-icon-btn" type="button" onClick={onClose} aria-label={`Close the ${t.title.toLowerCase()}`}>
        <Icon name="close" />
      </button>
    </header>
  );
}

// ------------------------------------------------------------------ the netlist

interface Tok {
  text: string;
  from: number;
}

function tokensOf(line: string, offset: number): Tok[] {
  const out: Tok[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push({ text: m[0], from: offset + m.index });
  return out;
}

export interface NetlistViewProps {
  netlist: Netlist;
  fileName: string;
  explains: readonly LineExplanation[];
  checks: readonly Trap[];
  /** Notes for the ends of part lines (describe.ts, annotateLines), when the numbers are answers. */
  annotations: readonly LineAnnotation[];
  colours: ReadonlyMap<string, string>;
  /** The drawing's lines (0-based indexes): folded into one line until unfolded. */
  drawingLines: readonly number[];
  selectedLine: number | undefined;
  unfolded: boolean;
  onToggleFold: () => void;
}

/** One line of the netlist on the screen: tokens coloured the way the parser reads them, the result noted at the end. */
function CodeLine({ text, number, offset, ex, trapSpans, annotation, colours, selected, drawing }: {
  text: string;
  number: number;
  offset: number;
  ex: LineExplanation | undefined;
  trapSpans: readonly { from: number; to: number }[];
  annotation: LineAnnotation | undefined;
  colours: ReadonlyMap<string, string>;
  selected: boolean;
  drawing: boolean;
}): ReactNode {
  const comment = number === 1 || text.trimStart().startsWith('*');
  const pieces: ReactNode[] = [];
  if (comment) pieces.push(<span key="c" className={`ck-tok ${drawing ? 'ck-tok--drawing' : 'ck-tok--comment'}`}>{text}</span>);
  else {
    let cursor = 0;
    tokensOf(text, offset).forEach((t, k) => {
      const col = t.from - offset;
      if (col > cursor) pieces.push(text.slice(cursor, col));
      cursor = col + t.text.length;
      const field = ex?.fields.find((f) => f.span?.from === t.from);
      const trap = trapSpans.some((s) => s.from <= t.from && t.from < s.to);
      let cls = 'ck-tok';
      let colour: string | undefined;
      if (text.trimStart().startsWith('.')) cls += ' ck-tok--dot';
      else if (k === 0) cls += ' ck-tok--name';
      else if (field && /node/.test(field.label)) {
        const name = lowerAscii(t.text);
        if (name === '0' || name === 'gnd') cls += ' ck-tok--gnd';
        else {
          cls += ' ck-tok--node';
          colour = colours.get(name);
        }
      } else cls += ' ck-tok--value';
      if (trap) cls += ' ck-tok--trap';
      pieces.push(
        <span key={k} className={cls} style={colour ? { ['--node' as string]: colour } : undefined}>
          {t.text}
        </span>,
      );
    });
    if (cursor < text.length) pieces.push(text.slice(cursor));
  }
  return (
    <div className={`ck-code__line${selected ? ' is-sel' : ''}${comment ? ' is-comment' : ''}`} data-line={number}>
      <span className="ck-code__no" aria-hidden="true">
        {number}
      </span>
      <span className="ck-code__text">{pieces}</span>
      {annotation ? (
        <span className="ck-code__note nb-hand">
          <span className="ck-sr">: </span>
          {annotation.text}
        </span>
      ) : null}
    </div>
  );
}

export function NetlistView(p: NetlistViewProps): ReactNode {
  const lines = p.netlist.lines;
  const trapSpans = p.checks.map((t) => t.span);
  const block = new Set(p.drawingLines);
  const first = p.drawingLines[0];
  const rows: ReactNode[] = [];
  for (const line of lines) {
    if (line.index === lines.length - 1 && line.text === '') break;
    if (block.has(line.index)) {
      if (line.index === first) {
        rows.push(
          <div key="fold" className={`ck-code__fold${p.unfolded ? ' is-open' : ''}`}>
            {/* Folded, the row stands for the block's first line; open, that line has its own number. */}
            {p.unfolded ? null : (
              <span className="ck-code__no" aria-hidden="true">
                {line.number}
              </span>
            )}
            <button type="button" className="ck-fold" aria-expanded={p.unfolded} onClick={p.onToggleFold}>
              <Icon name={p.unfolded ? 'chevron-down' : 'chevron-right'} />
              Drawing: {p.drawingLines.length} lines, positions of the parts
            </button>
          </div>,
        );
      }
      if (!p.unfolded) continue;
    }
    rows.push(
      <CodeLine
        key={line.index}
        text={line.text}
        number={line.number}
        offset={line.span.from}
        ex={p.explains.find((e) => e.line === line.number)}
        trapSpans={trapSpans}
        annotation={p.annotations.find((a) => a.line === line.number)}
        colours={p.colours}
        selected={p.selectedLine === line.number}
        drawing={block.has(line.index)}
      />,
    );
  }
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the lines of the netlist, not form fields
    <div className="ck-code" role="group" aria-label="Netlist lines">
      {rows}
    </div>
  );
}

export function NetlistPanel(props: NetlistViewProps & { text: string; onClose: () => void; headingRef?: (el: HTMLHeadingElement | null) => void }): ReactNode {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <>
      <PanelHead id="netlist" onClose={props.onClose} {...(props.headingRef ? { headingRef: props.headingRef } : {})} />
      <div className="ck-card__body">
        <div className="ck-screen">
          <div className="ck-screen__bar">
            <span className="ck-screen__dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="ck-screen__file">{props.fileName}</span>
            <button className="ck-screen__copy" type="button" onClick={() => void copy()} aria-label="Copy the netlist">
              <Icon name="copy" />
              <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <div className="ck-screen__code">
            <NetlistView {...props} />
          </div>
        </div>
        <p className="ck-panel-foot">
          Change a value on the drawing and its line changes here. The drawing’s place for each part is kept in the netlist, in lines that start with *@: ngspice
          ignores them.
        </p>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ the checks

const SEVERITY: Readonly<Record<Trap['severity'], { word: string; icon: 'error' | 'warning' | 'note' }>> = {
  error: { word: 'Error', icon: 'error' },
  warning: { word: 'Warning', icon: 'warning' },
  info: { word: 'Note', icon: 'note' },
};

export function ChecksPanel({ checks, partOfLine, onFix, onShowLine, onClose, headingRef }: {
  checks: readonly Trap[];
  partOfLine: (line: number) => string | undefined;
  onFix: (fix: Fix) => void;
  onShowLine: (line: number) => void;
  onClose: () => void;
  headingRef?: (el: HTMLHeadingElement | null) => void;
}): ReactNode {
  return (
    <>
      <PanelHead id="checks" sub={checks.length ? `${checks.length} found` : 'before every run'} onClose={onClose} {...(headingRef ? { headingRef } : {})} />
      <div className="ck-card__body">
        {checks.length === 0 ? (
          <div className="ck-checks-ok">
            <svg className="ck-checks-ok__tick" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
              <path d="M7 24.5c3.2 2.4 6.4 5.6 9.4 10.2C21.8 23 28.6 14.4 38 7.5" />
            </svg>
            <div>
              <p className="ck-checks-ok__title">No problems found</p>
              <p className="ck-checks-ok__text">PlainSpice looks for beginner traps before every run, says why each one matters, and offers a fix.</p>
            </div>
          </div>
        ) : (
          checks.map((t, i) => {
            const sev = SEVERITY[t.severity];
            const part = partOfLine(t.line);
            return (
              <article key={`${t.id}-${t.line}-${i}`} className={`ck-trap ck-trap--${t.severity}`} aria-labelledby={`trap-${i}`}>
                <span className="ck-sev">
                  <Icon name={sev.icon} />
                  {sev.word}
                </span>
                <h3 className="ck-trap__title" id={`trap-${i}`}>
                  {t.title}
                </h3>
                <p className="ck-trap__why">{t.why}</p>
                <p className="ck-trap__ng">
                  <b>What ngspice does:</b> {withoutClaimIds(t.ngspice)}
                </p>
                {t.fixes.length ? (
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a set of buttons, as in the app's Checks panel
                  <div className="ck-trap__fixes" role="group" aria-label={`Fixes for line ${t.line}`}>
                    {t.fixes.map((f, k) => (
                      <button key={k} type="button" className={`ck-btn ${k === 0 ? 'ck-btn--green' : 'ck-btn--paper'}`} onClick={() => onFix(f)}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <p className="ck-trap__line">
                  <button className="ck-link" type="button" onClick={() => onShowLine(t.line)}>
                    Show {part ? `${part} on line ${t.line}` : `line ${t.line}`} in the netlist
                  </button>
                </p>
              </article>
            );
          })
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ explain

/** The netlist line with each field's name written above its word, then the field table (the channel's field tables). */
export function FieldTable({ ex, colours }: { ex: LineExplanation; colours: ReadonlyMap<string, string> }): ReactNode {
  return (
    <>
      <div className="ck-fieldstrip" aria-hidden="true">
        {ex.fields.map((f, i) => {
          const node = /node/.test(f.label) ? colours.get(lowerAscii(f.text)) : undefined;
          return (
            <span key={i} className={`ck-fs${node ? ' ck-fs--node' : ''}`} style={node ? { ['--node' as string]: node } : undefined}>
              <span className="ck-fs__label">{f.label}</span>
              <span className="ck-fs__text">{f.text || '·'}</span>
            </span>
          );
        })}
      </div>
      <table className="ck-ftable">
        <caption className="ck-sr">The fields of line {ex.line}</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Written</th>
            <th scope="col">What it means</th>
          </tr>
        </thead>
        <tbody>
          {ex.fields.map((f, i) => (
            <tr key={i}>
              <td>{f.label}</td>
              <td className="ck-ftable__code">{f.text || '—'}</td>
              <td>{f.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export interface ExplainPanelProps {
  describe: string;
  selected: { kind: 'part'; name: string; ex: LineExplanation | undefined; current?: string; power?: string } | { kind: 'node'; name: string; voltage?: string; parts: string } | undefined;
  parts: readonly { key: string; name: string; kind: string }[];
  colours: ReadonlyMap<string, string>;
  onPick: (key: string) => void;
  onClose: () => void;
  headingRef?: (el: HTMLHeadingElement | null) => void;
}

export function ExplainPanel(p: ExplainPanelProps): ReactNode {
  const sel = p.selected;
  return (
    <>
      <PanelHead id="explain" onClose={p.onClose} {...(p.headingRef ? { headingRef: p.headingRef } : {})} />
      <div className="ck-card__body">
        <section className="ck-ex" aria-label={sel ? 'The selected part' : 'Choose a part'}>
          {sel?.kind === 'part' && sel.ex ? (
            <>
              <p className="ck-kicker">Line {sel.ex.line} of the netlist</p>
              <h3 className="ck-ex__head">{sel.ex.heading}</h3>
              <p className="ck-ex__summary">{sel.ex.summary}</p>
              <FieldTable ex={sel.ex} colours={p.colours} />
              {sel.current ? (
                <p className="ck-ex__current">
                  <span className="nb-hand ck-ex__amps">{sel.current}</span>
                  {sel.power ? <span className="nb-hand ck-ex__power">{sel.power}</span> : null}
                </p>
              ) : null}
              {sel.ex.notes.length ? (
                <ul className="ck-ex__notes">
                  {sel.ex.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : sel?.kind === 'node' ? (
            <>
              <p className="ck-kicker">Node</p>
              <h3 className="ck-ex__head">
                {sel.name}
                {sel.voltage ? <span className="nb-hand ck-ex__volts"> = {sel.voltage}</span> : null}
              </h3>
              <p className="ck-ex__summary">{sel.parts}</p>
            </>
          ) : (
            <>
              <p className="ck-kicker">One part at a time</p>
              <p className="ck-ex__empty">Select a part on the drawing to see its netlist line explained, field by field.</p>
              <div className="ck-part-list">
                {p.parts.map((x) => (
                  <button key={x.key} type="button" className="ck-chip" onClick={() => p.onPick(x.key)}>
                    <b>{x.name}</b> {x.kind}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
        <section className="ck-ex" aria-labelledby="ck-ex-words">
          <p className="ck-kicker" id="ck-ex-words">
            The whole circuit in words
          </p>
          <p className="ck-ex__words">{p.describe}</p>
        </section>
      </div>
    </>
  );
}
