/**
 * Add a part (decision 0017; lazy-loaded): the way to build a circuit without a pointer, and how
 * SPICE itself thinks of one. A part goes between two nodes, as its netlist line names them: the
 * student chooses the kind, its value, and each end's node from the circuit's nodes in words
 * ("ground (0)", "in", "out") or a new node with a name; a dependent source also what it reads. The
 * line it will add is shown as it is chosen ("R3 in out 1k"), the page adds it (src/app/editing.ts,
 * addPartEdit: before the analysis lines, .op and .end too on a blank page) and the drawing places
 * the part where it fits and wires it. Native fields throughout, labelled by the catalog's words.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { t } from '../../i18n/index.ts';
import { GROUND, PART_LETTERS, type PartLetter, type Schematic } from '../../schematic/index.ts';
import { elementInfo } from '../../spice/elements.ts';
import { typeHint } from '../card.ts';
import { defaultValue, endRoles, formLine, formStart, nodeChoices, sourceChoices, type NodePick, type PartForm } from '../editing.ts';
import { CloseIcon } from '../components/Icons.tsx';
import { kindName } from '../tools.ts';

/** The choice of a new node (no node name has a space in it). */
const NEW = ' new';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export default function AddPartDialog({
  schematic,
  start,
  onAdd,
  onOpenChange,
}: {
  schematic: Schematic;
  start: PartForm;
  /** Adds the part; returns why not (the form stays open), or undefined when it was added. */
  onAdd: (form: PartForm) => string | undefined;
  onOpenChange: (isOpen: boolean) => void;
}): ReactNode {
  const id = useId();
  const [form, setForm] = useState<PartForm>(start);
  const [tried, setTried] = useState(false);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const nodes = useMemo(() => nodeChoices(schematic), [schematic]);
  const sources = useMemo(() => sourceChoices(schematic), [schematic]);
  const line = formLine(schematic, form);
  const roles = endRoles(form.letter);
  const info = elementInfo(form.letter);

  const setKind = (letter: PartLetter): void => {
    const next = formStart(schematic, letter);
    // The ends chosen so far stay; the value follows the kind unless the student typed one.
    setForm({ ...next, ends: form.ends, value: form.value === defaultValue(form.letter) ? next.value : form.value });
    setRefused(undefined);
  };
  const setEnd = (i: 0 | 1, pick: NodePick): void => {
    const ends: [NodePick, NodePick] = [form.ends[0], form.ends[1]];
    ends[i] = pick;
    setForm({ ...form, ends });
    setRefused(undefined);
  };
  const fresh = (i: 0 | 1): string => {
    const other = form.ends[i === 0 ? 1 : 0];
    const base = formStart(schematic, 'R').ends[1];
    const name = 'fresh' in base ? base.fresh : 'n1';
    return 'fresh' in other && other.fresh === name ? name.replace(/\d+$/, (d) => String(Number(d) + 1)) : name;
  };

  const submit = (close: () => void): void => {
    setTried(true);
    if (!line.ok) return;
    const why = onAdd(form);
    if (why) setRefused(why);
    else close();
  };

  const endField = (i: 0 | 1): ReactNode => {
    const pick = form.ends[i];
    const value = 'node' in pick ? pick.node : NEW;
    return (
      <div className="field form-end">
        <label className="field__label" htmlFor={`${id}-end${i}`}>
          {cap(roles[i])}
        </label>
        <select
          id={`${id}-end${i}`}
          className="field__input"
          value={value}
          aria-invalid={tried && !line.ok && line.field === (i === 0 ? 'end0' : 'end1') ? true : undefined}
          onChange={(e) => setEnd(i, e.target.value === NEW ? { fresh: fresh(i) } : { node: e.target.value })}
        >
          {nodes.map((n) => (
            <option key={n.node} value={n.node}>
              {n.words}
            </option>
          ))}
          <option value={NEW}>{t('formNewNode')}</option>
        </select>
        {'fresh' in pick ? (
          <>
            <label className="field__label form-end__new" htmlFor={`${id}-new${i}`}>
              {t('formNewName')}
              {/* Two new nodes: each field says which end it names. */}
              <span className="visually-hidden"> {t('formNewNameAt', { role: roles[i] })}</span>
            </label>
            <input id={`${id}-new${i}`} className="field__input field__input--mono" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} value={pick.fresh} onChange={(e) => setEnd(i, { fresh: e.target.value })} />
          </>
        ) : null}
      </div>
    );
  };

  return (
    <ModalOverlay className="modal-overlay" isDismissable isOpen onOpenChange={onOpenChange}>
      <Modal className="modal">
        <Dialog className="dialog add-part">
          {({ close }) => (
            <form
              className="add-part__form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                submit(close);
              }}
            >
              <div className="dialog__head">
                <Heading slot="title" className="dialog__title">
                  {t('formTitle')}
                </Heading>
                <Button className="icon-button" onPress={close} aria-label={t('close')}>
                  <CloseIcon />
                </Button>
              </div>
              <div className="dialog__body">
                <p>{t('formIntro')}</p>
                <div className="field">
                  <label className="field__label" htmlFor={`${id}-kind`}>
                    {t('formKind')}
                  </label>
                  <select id={`${id}-kind`} className="field__input" value={form.letter} onChange={(e) => setKind(e.target.value as PartLetter)}>
                    {PART_LETTERS.map((l) => (
                      <option key={l} value={l}>
                        {kindName(l)} ({l})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor={`${id}-value`}>
                    {cap(info?.valueLabel ?? 'value')}
                  </label>
                  <input
                    id={`${id}-value`}
                    className="field__input field__input--mono"
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    value={form.value}
                    aria-describedby={`${id}-value-hint`}
                    aria-invalid={tried && !line.ok && line.field === 'value' ? true : undefined}
                    onChange={(e) => {
                      setForm({ ...form, value: e.target.value });
                      setRefused(undefined);
                    }}
                  />
                  <p className="hint" id={`${id}-value-hint`}>
                    {typeHint(form.letter)}
                  </p>
                </div>
                <div className="form-ends">
                  {endField(0)}
                  {endField(1)}
                </div>
                {form.letter === 'E' || form.letter === 'G' ? (
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- two choices that make one sentence
                  <div className="field form-control" role="group" aria-labelledby={`${id}-reads`}>
                    <p className="field__label" id={`${id}-reads`}>
                      {t('connReadsVoltage')}
                    </p>
                    <div className="form-control__row">
                      <select className="field__input" aria-label={t('connControlPlus')} value={form.plus ?? GROUND} onChange={(e) => setForm({ ...form, plus: e.target.value })}>
                        {nodes.map((n) => (
                          <option key={n.node} value={n.node}>
                            {n.words}
                          </option>
                        ))}
                      </select>
                      <span>{t('and')}</span>
                      <select className="field__input" aria-label={t('connControlMinus')} value={form.minus ?? GROUND} onChange={(e) => setForm({ ...form, minus: e.target.value })}>
                        {nodes.map((n) => (
                          <option key={n.node} value={n.node}>
                            {n.words}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : null}
                {form.letter === 'F' || form.letter === 'H' ? (
                  <div className="field">
                    <label className="field__label" htmlFor={`${id}-source`}>
                      {t('connReadsCurrent')}
                    </label>
                    {sources.length ? (
                      <select id={`${id}-source`} className="field__input" value={form.source ?? ''} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                        {sources.map((x) => (
                          <option key={x.key} value={x.key}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                ) : null}
                {/* Not a live region: it changes with every key typed. The Add button is described by it, and a refusal is said once. */}
                <div className="form-line" id={`${id}-line`}>
                  {line.ok ? (
                    <>
                      <p className="field__label">{t('formLinePreview')}</p>
                      <code className="form-line__code">{line.line}</code>
                    </>
                  ) : tried || line.field === 'control' ? (
                    <p className="form-line__why">{line.reason}</p>
                  ) : null}
                </div>
                <div className="form-line__said" aria-live="polite">
                  {refused ? <p className="form-line__why">{refused}</p> : null}
                  {tried && !line.ok ? <p className="visually-hidden">{line.reason}</p> : null}
                </div>
              </div>
              <div className="dialog__foot">
                <Button className="button" onPress={close}>
                  {t('cancel')}
                </Button>
                <button type="submit" className="button button--primary" aria-describedby={`${id}-line`}>
                  {line.ok ? t('formAdd', { name: line.name }) : t('formTitle')}
                </button>
              </div>
            </form>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
