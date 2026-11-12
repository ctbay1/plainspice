/**
 * A part's card, the drawing side (decision 0017): Turn, Mirror and Reverse (each named once, the
 * model's words: Turn and Mirror change only the drawing, Reverse swaps the part's two ends in the
 * netlist, and the card says so), Move (picks the part up: a click puts it down, the single-pointer
 * way to drag it, WCAG 2.5.7), Delete, and Connections: each end with the node it is on, in the
 * catalog's words ("+ node: in"), with Connect to (the circuit's nodes, as a list) and Disconnect,
 * so a circuit can be built and rewired without a pointer. A dependent source also chooses what it
 * reads (set-control): two nodes for E and G, a voltage source for F and H. Rendering only: the page
 * makes every edit (src/app/editing.ts).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { t } from '../../i18n/index.ts';
import type { PartEnd } from '../editing.ts';
import { LineIcon, type LineIconName } from './Icons.tsx';

export type ControlEditing =
  | { kind: 'voltage'; plus: string; minus: string; nodes: readonly { node: string; words: string }[]; onChange: (plus: string, minus: string) => void }
  | { kind: 'current'; source: string; sources: readonly { key: string; name: string }[]; onChange: (source: string) => void; none?: string };

export interface PartEditing {
  /** The part's name, for the buttons' names ("Turn R1 a quarter turn"). */
  name: string;
  /** It is drawn: it can be turned, mirrored and moved on the drawing. */
  drawn: boolean;
  onTurn: () => void;
  onMirror: () => void;
  onReverse: () => void;
  onMove: () => void;
  onDelete: () => void;
  ends: readonly PartEnd[];
  /** The nodes an end can be connected to (ground first). */
  nodes: readonly { node: string; words: string }[];
  onConnect: (pin: 0 | 1, node: string) => void;
  onDisconnect: (pin: 0 | 1) => void;
  /** What a dependent source reads. */
  control?: ControlEditing;
  /** The Connections are shown. */
  open: boolean;
  onOpen: (open: boolean) => void;
}

function ActionButton({
  icon,
  word,
  keys,
  keyWord,
  label,
  what,
  onClick,
  disabled,
}: {
  icon: LineIconName;
  word: string;
  keys?: string;
  keyWord?: string;
  label: string;
  /** What it changes, under its word ("the drawing only", "the netlist"). */
  what?: string;
  onClick: () => void;
  disabled?: boolean;
}): ReactNode {
  return (
    // Named by its whole label, which starts with its word ("Turn R1 a quarter turn"): the key and what
    // it changes are shown for the eye; a screen reader has them from aria-keyshortcuts and the
    // toolbar's description (WCAG 2.5.3: the word shown is the start of the name).
    <button type="button" className={`card-action${what ? ' card-action--two' : ''}`} onClick={onClick} disabled={disabled} {...(keys ? { 'aria-keyshortcuts': keys } : {})}>
      <LineIcon name={icon} />
      <span className="card-action__words" aria-hidden="true">
        <span className="card-action__word">
          {word}
          {keys ? <kbd className="card-action__key">{keyWord ?? keys.replace('Shift+', '⇧')}</kbd> : null}
        </span>
        {what ? <span className="card-action__what">{what}</span> : null}
      </span>
      <span className="visually-hidden">{label}</span>
    </button>
  );
}

/** The id of the card's body, which shows the numbers or the Connections (the Connections button controls it). */
export const cardBodyId = (session: number | undefined): string => `card-body-${session ?? 0}`;

/** The action bar: Turn, Mirror, Reverse, Move, Connections, Delete, and what they change. */
export function PartActions({ e, bodyId }: { e: PartEditing; bodyId: string }): ReactNode {
  const id = useId();
  return (
    <div className="card-edit">
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a group of buttons, not a form */}
      <div className="card-actions" role="toolbar" aria-label={t('editActions', { name: e.name })} aria-describedby={`${id}-why`}>
        <ActionButton icon="turn" word={t('editTurn')} keys="T" what={t('editDrawingOnly')} label={t('editTurnLabel', { name: e.name })} onClick={e.onTurn} disabled={!e.drawn} />
        <ActionButton icon="mirror" word={t('editMirror')} keys="M" what={t('editDrawingOnly')} label={t('editMirrorLabel', { name: e.name })} onClick={e.onMirror} disabled={!e.drawn} />
        <ActionButton icon="reverse" word={t('editReverse')} keys="Shift+R" what={t('editInNetlist')} label={t('editReverseLabel', { name: e.name })} onClick={e.onReverse} />
        <span className="card-actions__sep" aria-hidden="true" />
        <ActionButton icon="move" word={t('editMove')} label={t('editMoveLabel', { name: e.name })} onClick={e.onMove} disabled={!e.drawn} />
        <button type="button" className="card-action" aria-expanded={e.open} aria-controls={bodyId} onClick={() => e.onOpen(!e.open)}>
          <LineIcon name="connect" />
          <span className="card-action__word">{t('connTitle')}</span>
          <LineIcon name="chevron-down" className={`card-action__caret${e.open ? ' is-open' : ''}`} />
        </button>
        <span className="card-actions__sep" aria-hidden="true" />
        <ActionButton icon="delete" word={t('editDelete')} keys="Delete" keyWord="Del" label={t('editDeleteLabel', { name: e.name })} onClick={e.onDelete} />
      </div>
      <p className="visually-hidden" id={`${id}-why`}>
        {t('editWhy')}
      </p>
      {e.control ? <ControlRow c={e.control} name={e.name} /> : null}
    </div>
  );
}

/** What a dependent source reads: two nodes (E, G) or a voltage source (F, H), chosen from lists. */
function ControlRow({ c, name }: { c: ControlEditing; name: string }): ReactNode {
  const id = useId();
  if (c.kind === 'voltage') {
    return (
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a sentence with two choices in it
      <p className="card-control" role="group" aria-labelledby={`${id}-lead`}>
        <span id={`${id}-lead`}>{t('connReadsVoltage')}</span>{' '}
        <select className="card-select" aria-label={`${name}: ${t('connControlPlus')}`} value={c.plus} onChange={(ev) => c.onChange(ev.target.value, c.minus)}>
          {c.nodes.map((n) => (
            <option key={n.node} value={n.node}>
              {n.words}
            </option>
          ))}
        </select>{' '}
        <span>{t('and')}</span>{' '}
        <select className="card-select" aria-label={`${name}: ${t('connControlMinus')}`} value={c.minus} onChange={(ev) => c.onChange(c.plus, ev.target.value)}>
          {c.nodes.map((n) => (
            <option key={n.node} value={n.node}>
              {n.words}
            </option>
          ))}
        </select>
      </p>
    );
  }
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a sentence with a choice in it
    <p className="card-control" role="group" aria-labelledby={`${id}-lead`}>
      <span id={`${id}-lead`}>{t('connReadsCurrent')}</span>{' '}
      {c.sources.length ? (
        <select className="card-select" aria-label={`${name}: ${t('connControlSource')}`} value={c.source} onChange={(ev) => c.onChange(ev.target.value)}>
          {c.sources.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="card-control__none">{c.none}</span>
      )}
    </p>
  );
}

/** Each end: the node it is on, Connect to (a list of nodes), Disconnect. Shown in the card's body, in place of its numbers. */
export function Connections({ e }: { e: PartEditing }): ReactNode {
  const [choosing, setChoosing] = useState<0 | 1 | undefined>(undefined);
  const toggles = useRef<(HTMLButtonElement | null)[]>([]);
  const back = useRef<0 | 1 | undefined>(undefined);
  // Opened (the card's Connections button, or Ctrl+K), the list takes the focus: it is drawn above
  // the button that opened it, so the next Tab would otherwise leave the card (WCAG 2.4.3).
  useEffect(() => {
    toggles.current[0]?.focus({ preventScroll: true });
  }, []);
  // After a connection is made (or the list closed), the focus goes back to that end's Connect to.
  useEffect(() => {
    if (back.current === undefined) return;
    const pin = back.current;
    back.current = undefined;
    toggles.current[pin]?.focus({ preventScroll: true });
  });
  return (
    <section className="card-conn" aria-label={t('connTitle')}>
      <p className="card-conn__intro">{t('connIntro')}</p>
      <ul className="card-conn__ends">
        {e.ends.map((end) => {
          const others = e.nodes.filter((n) => n.node !== end.node);
          return (
            <li key={end.pin} className="card-conn__end">
              <span className="card-conn__role">{end.role}</span>
              <span className="card-conn__node">{end.words}</span>
              <span className="card-conn__buttons">
                <button
                  type="button"
                  className="link-button"
                  ref={(el) => {
                    toggles.current[end.pin] = el;
                  }}
                  aria-expanded={choosing === end.pin}
                  aria-label={t('connConnectLabel', { role: end.role, name: e.name })}
                  onClick={() => setChoosing((c) => (c === end.pin ? undefined : end.pin))}
                >
                  {t('connConnect')}
                </button>
                <button type="button" className="link-button" aria-label={t('connDisconnectLabel', { role: end.role, name: e.name, node: end.words })} onClick={() => e.onDisconnect(end.pin)}>
                  {t('connDisconnect')}
                </button>
              </span>
              {choosing === end.pin ? (
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a set of buttons named by the sentence they finish
                <div className="card-conn__choices" role="group" aria-label={t('connTo', { role: end.role, name: e.name })}>
                  {others.length ? (
                    others.map((n) => (
                      <button
                        key={n.node}
                        type="button"
                        className="chip-button"
                        onClick={() => {
                          back.current = end.pin;
                          setChoosing(undefined);
                          e.onConnect(end.pin, n.node);
                        }}
                        onKeyDown={(ev) => {
                          if (ev.key !== 'Escape') return;
                          ev.preventDefault();
                          ev.stopPropagation();
                          back.current = end.pin;
                          setChoosing(undefined);
                        }}
                      >
                        {n.words}
                      </button>
                    ))
                  ) : (
                    <span className="card-control__none">{t('connNone')}</span>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
