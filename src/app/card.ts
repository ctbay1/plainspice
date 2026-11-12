/**
 * What a part's card says (the checkpoint's card, decision 0015), built from the model and the last
 * run: every sentence about the circuit from src/spice and src/schematic, every number formatSI's,
 * the results' words from the notebook's own (src/notebook/words.ts). Plain TypeScript.
 *
 * While ngspice has not yet run the text as it is now, the card keeps the last numbers, dimmed as the
 * drawing writes them in pencil, and screen readers hear that they are from before the last change;
 * when nothing will run without Run (live runs paused, a link not run yet), it says so in the status
 * line's words instead of waiting for ever.
 */
import { t, type MessageKey } from '../i18n/index.ts';
import { formatSI, speakSI } from '../format/si.ts';
import { acrossWords, answers, isAmmeter, nodeWord, withoutResultsPointer, type Solution } from '../notebook/index.ts';
import { GROUND, describePart, type CircuitPart, type NavItem, type PartLetter, type Schematic } from '../schematic/index.ts';
import { DESCRIBE_STRINGS, sentenceNode } from '../spice/describe.ts';
import { elementInfo } from '../spice/elements.ts';
import { lowerAscii } from '../spice/parse.ts';
import type { Netlist, Trap } from '../spice/types.ts';
import type { CardContent, CardNote, Readout } from './components/IndexCard.tsx';
import { readsOf } from './card-edit.ts';
import { explainLine } from './model.ts';

/** A card that is open: the part, the value as typed, and what it started from (for Put back and the crossed-out numbers). */
export interface CardState {
  key: string;
  /** The value as written when the card opened (all its words: "4,7k", "1 k"). */
  start: string;
  /** What the field shows (it may be empty while the student types). */
  input: string;
  /** The run the card opened on: its numbers are crossed out once they change. */
  before: Solution | undefined;
  /** Each opening of a card is its own undo step (src/app/store.ts groups by this). */
  session: number;
  /** The field's text is not in the netlist (SPICE does not read it as one number): why, and a fix that is a value. */
  refused?: { reason: string; fix?: { label: string; value: string } };
  /** The value the netlist has meanwhile (the last one written), shown while the field's text is refused. */
  kept: string;
  /** Move the focus into the card when it opens (not when it follows the drawing's arrow keys). */
  focus?: boolean;
  /** Select the value's text as the focus goes into it (a part just placed, a double click on its value). */
  select?: boolean;
}

/** Where the runs are, for the card: whether ngspice is about to answer, or why it will not without Run. */
export interface CardRun {
  /** A run of the text as it is now is waiting or going. */
  waiting: boolean;
  /** Nothing runs without Run (or at all): the status line's words for why. */
  stalled?: string;
}

const TYPE_HINT: Readonly<Record<PartLetter, MessageKey>> = {
  R: 'typeHintR',
  C: 'typeHintC',
  L: 'typeHintL',
  V: 'typeHintV',
  I: 'typeHintI',
  E: 'typeHintE',
  F: 'typeHintF',
  G: 'typeHintG',
  H: 'typeHintH',
};

/** The power words without their number ("delivers", "absorbs"), as the model writes them. */
const POWER = { delivers: DESCRIBE_STRINGS.noteDelivers('').trim(), absorbs: DESCRIBE_STRINGS.noteAbsorbs('').trim() };

/** What to type in a part's value field, with examples that fit it (a gain is not "4.7k"). */
export const typeHint = (letter: PartLetter): string => t(TYPE_HINT[letter]);

/** Parts whose value the card can change: a source with a waveform (PULSE, SIN ...) is changed in the netlist. */
export const isEditable = (part: CircuitPart): boolean => !part.sourceFunction;

/** The items a selected part is tied to: the source an F or H reads, the nodes an E or G reads. */
export function relatedOf(part: CircuitPart | undefined): NavItem[] {
  const c = part?.control;
  if (!c) return [];
  if (c.kind === 'current') return c.source ? [{ kind: 'part', key: c.source }] : [];
  return [c.plus, c.minus].filter((n) => n && n !== GROUND).map((name) => ({ kind: 'node' as const, name }));
}

/** A unit's symbol from the element catalog, or for a gain its ratio ("A/V"); '' for a plain number. */
function unitOf(letter: PartLetter): string {
  const unit = elementInfo(letter)?.unit;
  return unit?.ratio && unit.ratio !== 'V/V' && unit.ratio !== 'A/A' ? unit.ratio : (unit?.symbol ?? '');
}

/** What a gain multiplies, for E, F, G and H ("× I(Vsense)", "A/V × V(n1)"): the drawing's control label. */
export function controlSuffix(part: CircuitPart): string | undefined {
  const c = part.control;
  if (!c) return undefined;
  const ratio = unitOf(part.letter);
  const unit = ratio ? `${ratio} ` : '';
  if (c.kind === 'current') return `${unit}× I(${c.sourceText || '?'})`;
  return `${unit}× V(${c.plusText || '?'}${c.minus === GROUND ? '' : `, ${c.minusText || '?'}`})`;
}

/** True when a check is about a part's value (its span covers the value's word): the drawing circles the value. */
export function onValueField(trap: Trap, part: CircuitPart, netlist: Netlist): boolean {
  const info = elementInfo(part.letter);
  const field = explainLine(netlist, part.line)?.fields.find((f) => f.label === info?.valueLabel);
  const span = field?.span;
  return !!span && trap.span.from < span.to && span.from < trap.span.to;
}

/** Why a run has no numbers: an error-level check's title, or the model's summary. */
export function noNumbersReason(sol: Solution): string {
  const error = sol.checks.find((c) => c.severity === 'error');
  if (sol.status === 'check' && error) return t('noNumbersCheck', { title: error.title.replace(/[.!?:]$/, '') });
  return withoutResultsPointer(sol.words.summary);
}

/** A current's size and direction, in spoken units ("2 milliamps flow from in to out through R1"). */
function currentSpeech(c: { value: number; from: string; to: string; name: string; ammeter?: boolean }, text: (node: string) => string): string {
  const S = DESCRIBE_STRINGS;
  const from = nodeWord(c.from, text);
  const to = nodeWord(c.to, text);
  const a = speakSI(Math.abs(c.value), 'A');
  if (c.ammeter) return c.value === 0 ? S.measuresNothing(c.name) : S.measures(c.name, a, from, to);
  return c.value === 0 ? S.noCurrent(c.name) : S.amps(a, from, to, c.name);
}

/**
 * The card's words and numbers for a part. `sol` is the latest run; its numbers are current only
 * when it ran `text`; `run` says what ngspice is doing about the text as it is now.
 */
export function cardContent(part: CircuitPart, card: CardState, s: Schematic, sol: Solution | undefined, text: string, run: CardRun = { waiting: false }): CardContent {
  const info = elementInfo(part.letter);
  const ex = explainLine(s.netlist, part.line);
  const valueField = ex?.fields.find((f) => f.label === info?.valueLabel);
  const current = !!sol && sol.text === text;
  // The last answers, even for an older text: shown dimmed until ngspice answers again.
  const words = answers(sol);
  const pending = !!words && !current;
  const beforeWords = current ? answers(card.before) : undefined;
  const c = words?.currents.find((x) => x.element === part.key);
  const was = beforeWords?.currents.find((x) => x.element === part.key);
  const volts = new Map<string, number>([[GROUND, 0], ...(words?.nodes ?? []).map((n): [string, number] => [lowerAscii(n.node), n.value])]);
  const voltsBefore = new Map<string, number>([[GROUND, 0], ...(beforeWords?.nodes ?? []).map((n): [string, number] => [lowerAscii(n.node), n.value])]);
  // Two ends at one level are at the same voltage (exactly, or by the rule for other circuits; decision
  // 0015), whatever ngspice's last bits say: 0 V across, as the part's 0 A through it (words re-check 1).
  const levelsOf = (w: typeof words): Map<string, number> =>
    new Map<string, number>([[GROUND, 0], ...(w?.nodes ?? []).filter((n) => n.level !== undefined).map((n): [string, number] => [lowerAscii(n.node), n.level!])]);
  const level = (levels: Map<string, number>): boolean => levels.has(part.nodes[0]) && levels.get(part.nodes[0]) === levels.get(part.nodes[1]);
  const sameNow = level(levelsOf(words));
  const sameBefore = level(levelsOf(beforeWords));
  const written = (i: 0 | 1): string => (part.nodes[i] === GROUND ? '0' : part.nodeText[i]);
  const nodeText = (n: string): string => s.circuit.nodes.get(n)?.text ?? n;
  // A node in a sentence is named as a node ("node in is higher"), as the editor says it (decision
  // 0017); nodeWord keeps ground "ground". The short lines under a number stay bare ("from in to out").
  // An ordinary node named like ground is quoted, as the overview says it: 'node "ground" is higher'.
  const nodeSaid = (n: string): string => t('nodeNamed', { name: sentenceNode(nodeText(n)) });
  const readouts: Readout[] = [];
  // Numbers from before the last change say so to screen readers.
  const said = (speech: string): string => (pending ? `${t('cardBefore')} ${speech}` : speech);
  if (c) {
    const amps = formatSI(Math.abs(c.value), 'A');
    const prev = was ? formatSI(Math.abs(was.value), 'A') : undefined;
    const r: Readout = {
      value: amps,
      what: c.ammeter ? t('readoutMeasured') : t('readoutThrough'),
      sub: c.value === 0 ? [] : [t('readoutFromTo', { from: nodeWord(c.from, nodeText), to: nodeWord(c.to, nodeText) })],
      tone: 'current',
      speech: said(currentSpeech(c, nodeText)),
    };
    if (prev && prev !== amps) r.was = prev;
    readouts.push(r);
  }
  const va = volts.get(part.nodes[0]);
  const vb = volts.get(part.nodes[1]);
  if (words && va !== undefined && vb !== undefined && !isAmmeter(part)) {
    // Its size and which end is higher, SPICE's signed difference underneath.
    // A resistor whose real current ngspice rounded to 0 has the exact voltage across it (`across`, C9n): its two ends' numbers are the same.
    const across = acrossWords({ name: part.name, v: c?.across !== undefined ? [c.across, 0] : sameNow ? [va, va] : [va, vb], nodes: part.nodes, written: [written(0), written(1)], text: nodeSaid });
    const pa = voltsBefore.get(part.nodes[0]);
    const pb = voltsBefore.get(part.nodes[1]);
    const prev = beforeWords && pa !== undefined && pb !== undefined ? formatSI(was?.across !== undefined ? Math.abs(was.across) : sameBefore ? 0 : Math.abs(pa - pb), 'V') : undefined;
    const r: Readout = { value: across.text, what: t('readoutAcross'), sub: [across.higher ? t('readoutHigher', { node: across.higher }) : '', across.signed].filter(Boolean), tone: 'voltage', speech: said(across.speech) };
    if (prev && prev !== across.text) r.was = prev;
    readouts.push(r);
  }
  if (c?.power) {
    const w = formatSI(c.power.watts, 'W');
    const prev = was?.power ? formatSI(was.power.watts, 'W') : undefined;
    const r: Readout = { value: w, what: c.power.delivers ? POWER.delivers : POWER.absorbs, tone: 'power', speech: said(c.power.speech) };
    if (prev && prev !== w) r.was = prev;
    readouts.push(r);
  }
  // What the card says besides (or instead of) numbers.
  let note: CardNote | undefined;
  const trap = current ? sol.checks.find((x) => x.line === part.line + 1 && x.severity !== 'info') : undefined;
  if (current && !words) {
    // The check that stops the numbers: this part's own is in its own row below (said once, not twice);
    // another part's is said as another line's, never as if it were this part's.
    const error = sol.status === 'check' ? sol.checks.find((c) => c.severity === 'error') : undefined;
    const text = error && error === trap ? t('cardNoNumbersOwn') : error && error.line !== part.line + 1 ? t('cardNoNumbersElsewhere', { line: error.line, title: error.title.replace(/[.!?:]$/, '') }) : noNumbersReason(sol);
    note = { text, tone: 'bad' };
  } else if (current && !readouts.length) note = { text: t('cardNoValues'), tone: 'info', numbers: true };
  else if (!current && run.stalled) note = { text: run.stalled, tone: 'paused' };
  else if (!current && (run.waiting || !sol)) note = { text: t('cardSolving'), tone: 'busy' };
  const suffix = controlSuffix(part) ?? (unitOf(part.letter) || undefined);
  const read = readsOf(s.netlist, part.line, part.letter, part.value);
  return {
    name: part.name,
    kind: info?.name ?? part.letter,
    line: part.line + 1,
    icon: part.letter,
    value: card.input,
    start: card.start,
    readouts,
    readoutsPending: pending,
    sentence: describePart(s, part.key),
    typeHint: typeHint(part.letter),
    ...(isEditable(part) && info?.valueLabel ? { label: info.valueLabel } : {}),
    ...(suffix ? { suffix } : {}),
    ...(card.refused
      ? { refused: { reason: card.refused.reason, kept: card.kept, ...(card.refused.fix ? { fix: card.refused.fix } : {}) } }
      : valueField && card.input.trim() === ''
        ? { empty: { kept: card.kept } }
      : read
        ? { reads: read.reads, readsTrap: read.trap }
        : {}),
    // The card's link says "fix" only when the Checks panel offers one for this check (it lists a fix button for each).
    ...(trap ? { trap: trap.title, trapFix: trap.fixes.length > 0 } : {}),
    ...(note ? { note } : {}),
  };
}
