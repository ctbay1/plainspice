/**
 * A node's card (decision 0017), opened like a part's: its name, which can be changed (the model's
 * rename-node: a name SPICE or PlainSpice cannot use is refused in plain words, and a name another
 * node has joins the two, which the summary says), its voltage as ngspice found it, the parts on
 * it (the model's sentence, navigate.ts describeNode), and Move its name. Ground keeps its name (the
 * model says why); its card offers to move or delete the ground symbol that was chosen. Rendering
 * only: the page renames, moves and deletes.
 */
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { t } from '../../i18n/index.ts';
import type { Side } from '../../notebook/index.ts';
import { LineIcon, WarningIcon } from './Icons.tsx';

export interface NodeCardProps {
  variant: 'pinned' | 'sheet';
  /** 'pinned': the side of its name the card is on, and where its notch is along that edge. */
  side?: Side;
  notch?: number;
  /** The node's name as written ("out"); ground's name in words for ground. */
  name: string;
  /** The node as a sentence says it ("node out", 'node "ground"', "node1"), for the names of its close button and field; ground's name for ground. */
  said: string;
  ground: boolean;
  /** The name field's text, and why the last rename was refused (the model's words). */
  input: string;
  refused?: string | undefined;
  /** Why ground keeps its name (the model's words). */
  groundName?: string;
  /** Its voltage as the drawing writes it, and in words; pending: from before the last change. */
  voltage?: { text: string; speech: string; pending: boolean } | undefined;
  /**
   * Why there is no voltage: the last run of this netlist gave none (a check found an error), or nothing
   * runs without Run (the status line's words). Without it, a run is on its way ("in a moment").
   */
  noVoltage?: string;
  /** What the parts on it are (the model's sentence). */
  sentence: string;
  /** Opens again for each new card (the focus goes in again). */
  session: number;
  takeFocus: boolean;
  onInput: (value: string) => void;
  onRename: () => void;
  onMove?: (() => void) | undefined;
  onDeleteGround?: (() => void) | undefined;
  onClose: () => void;
}

/** A node: a wire with a dot on it, in the card's head. */
function NodeGlyph(): ReactNode {
  return (
    <svg className="glyph" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M3 18H29M16 18V8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="16" cy="18" r="2.6" fill="currentColor" />
    </svg>
  );
}

export function NodeCard(p: NodeCardProps): ReactNode {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!p.takeFocus) return;
    if (!p.ground && field.current) {
      field.current.focus({ preventScroll: true });
      field.current.select();
    } else title.current?.focus({ preventScroll: true });
  }, [p.session, p.ground, p.takeFocus]);
  const style: CSSProperties & Record<string, string> = p.notch !== undefined ? { '--notch': `${p.notch}px` } : {};
  return (
    // Not modal: the drawing stays usable beside the card (Escape, handled by the page, closes it).
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
    <section className={`index-card node-card index-card--${p.variant}${p.side ? ` index-card--${p.side}` : ''}`} style={style} role="dialog" aria-modal="false" aria-labelledby={`${id}-title`}>
      {p.variant === 'sheet' ? <span className="grab" aria-hidden="true" /> : null}
      <div className="index-card__head">
        <span className="index-card__glyph">
          <NodeGlyph />
        </span>
        <h2 className="index-card__title" id={`${id}-title`} tabIndex={-1} ref={title}>
          {p.ground ? (
            <span className="index-card__name">{p.name}</span>
          ) : (
            <>
              <span className="index-card__kind">{t('nodeCardKind')}</span> <span className="index-card__name">{p.name}</span>
            </>
          )}
        </h2>
        <button className="icon-button" type="button" onClick={p.onClose} aria-label={t('nodeCardClose', { node: p.said })}>
          <LineIcon name="close" />
        </button>
      </div>
      <div className="index-card__body node-card__body">
        <div className="index-card__field">
          {p.ground ? (
            <p className="node-card__ground">{p.groundName}</p>
          ) : (
            <form
              className="node-card__rename"
              onSubmit={(e) => {
                e.preventDefault();
                p.onRename();
              }}
            >
              <label className="field-label" htmlFor={`${id}-name`}>
                {t('nodeCardName')}
              </label>
              <div className="node-card__row">
                <div className={`value-field${p.refused ? ' is-trap' : ''}`}>
                  <input
                    ref={field}
                    id={`${id}-name`}
                    className="value-field__input"
                    type="text"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    enterKeyHint="done"
                    value={p.input}
                    aria-invalid={p.refused ? true : undefined}
                    // Its label is set in capitals by the style; said in sentence case.
                    aria-label={t('nodeCardNameOf', { node: p.said })}
                    aria-describedby={`${id}-why`}
                    onChange={(e) => p.onInput(e.target.value)}
                  />
                </div>
                <button type="submit" className="button">
                  <LineIcon name="rename" />
                  {t('nodeCardRename')}
                </button>
              </div>
              <p className={`reads${p.refused ? ' is-trap' : ''}`} id={`${id}-why`} aria-live="polite">
                {p.refused ? (
                  <>
                    <WarningIcon /> <span className="reads__why">{p.refused}</span>
                  </>
                ) : (
                  t('nodeCardRenameHint')
                )}
              </p>
            </form>
          )}
        </div>
        <div className="node-card__facts">
          <p className="node-card__voltage">
            <span className="field-label">{t('nodeCardVoltage')}</span>
            {p.voltage ? (
              <>
                <span className={`readout__number hand${p.voltage.pending ? ' is-pending' : ''}`} aria-hidden="true">
                  {p.voltage.text}
                </span>
                <span className="visually-hidden">{p.voltage.speech}</span>
              </>
            ) : (
              <span className="node-card__none">{p.noVoltage ?? t('nodeCardNoVoltage')}</span>
            )}
          </p>
          <p className="index-card__sentence node-card__sentence">{p.sentence}</p>
        </div>
      </div>
      {p.onMove || p.onDeleteGround ? (
        <div className="index-card__foot node-card__foot">
          {p.onMove ? (
            <button type="button" className="card-action" onClick={p.onMove}>
              <LineIcon name="move" />
              <span className="card-action__word">{p.ground ? t('nodeCardMoveGround') : t('nodeCardMoveName')}</span>
            </button>
          ) : null}
          {p.onDeleteGround ? (
            <button type="button" className="card-action" onClick={p.onDeleteGround} aria-keyshortcuts="Delete">
              <LineIcon name="delete" />
              <span className="card-action__word">{t('nodeCardDeleteGround')}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
