/**
 * The words of the frame around the drawing, as plain functions of the app's state, so they can be
 * tested without a browser: the status line (Studio's, decision 0014: what ngspice is doing and how
 * the last run went) and the hint line (Playground's: what you can do next, in plain words). One
 * verb for one idea: ngspice "runs" a netlist (Run, live runs, "Running…", "Finished in 5 ms").
 */
import { t, tn } from '../i18n/index.ts';
import { withoutResultsPointer } from '../notebook/words.ts';
import type { LineExplanation, Netlist } from '../spice/types.ts';
import { toolPhrase, type Tool } from './tools.ts';
import type { LiveState } from './live.ts';
import type { RunRecord } from './model.ts';

export type EngineStatus = { status: 'loading' } | { status: 'ready'; loadMs: number } | { status: 'failed'; reason: string };

export interface StatusWords {
  main: string;
  detail?: string;
  /** ok: finished; busy: working on it; paused: waiting for Run; bad: no answers. */
  tone: 'ok' | 'busy' | 'paused' | 'bad';
}

const seconds = (ms: number): string => (ms / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });

/** How to run, in the device's words: "press Run (Ctrl+Enter)" on a computer, "tap Run" on a phone. */
export const pressRun = (phone: boolean): string => (phone ? t('pressRunPhone') : t('pressRunDesk'));

/** The word the Numbers panel's banner uses for a run whose numbers are not answers. */
function notAnswersWord(r: RunRecord): string {
  if (r.status === 'check' || r.status === 'unreliable') return t('statusUnreliable');
  return r.words.ngspiceError ? t('statusError') : t('statusEmpty');
}

/** The status line for the text as it is now. `parts`: the netlist has parts to run. */
export function statusWords(engine: EngineStatus, live: LiveState<RunRecord>, text: string, phone = false, parts = true): StatusWords {
  const run = pressRun(phone);
  if (engine.status === 'failed') return { main: t('statusEngineFailed'), detail: engine.reason, tone: 'bad' };
  if (live.running?.loading) return { main: t('statusLoading'), detail: t('statusLoadingDetail'), tone: 'busy' };
  if (live.running) return { main: t('statusSolving'), tone: 'busy' };
  const o = live.outcome;
  const p = live.paused;
  if (p) {
    const old = o.kind === 'done' && o.text !== text ? ` ${t('statusOldNumbers')}` : '';
    switch (p.reason) {
      case 'link':
        return { main: t('statusNotRun'), detail: t('statusNotRunDetail', { run }), tone: 'paused' };
      case 'slow':
        return { main: t('statusPaused'), detail: `${t('statusPausedSlow', { seconds: seconds(p.ms), run })}${old}`, tone: 'paused' };
      case 'long':
        return { main: t('statusPaused'), detail: `${t('statusPausedLong', { points: p.points.toLocaleString('en-US'), run })}${old}`, tone: 'paused' };
      case 'stopped':
        return { main: t('statusStopped'), detail: `${t('statusPausedStopped', { run })}${old}`, tone: 'paused' };
      case 'timeout':
        return { main: t('statusTimedOut', { seconds: p.seconds }), detail: `${t('statusPausedStopped', { run })}${old}`, tone: 'paused' };
    }
  }
  if (o.kind === 'nothing' && o.text === text) {
    return { main: t('noAnalysisTitle'), detail: parts ? t('statusNothingDetail') : t('statusNoParts'), tone: 'paused' };
  }
  if (live.waiting || (o.kind === 'done' && o.text !== text) || (o.kind === 'none' && engine.status === 'ready')) {
    return engine.status === 'loading' ? { main: t('statusLoading'), detail: t('statusLoadingDetail'), tone: 'busy' } : { main: t('statusSolving'), tone: 'busy' };
  }
  switch (o.kind) {
    case 'none':
      return { main: t('statusLoading'), detail: t('statusLoadingDetail'), tone: 'busy' };
    case 'nothing':
      return { main: t('noAnalysisTitle'), detail: parts ? t('statusNothingDetail') : t('statusNoParts'), tone: 'paused' };
    case 'stopped':
      return { main: t('statusStopped'), detail: t('statusPausedStopped', { run }), tone: 'paused' };
    case 'timeout':
      return { main: t('statusTimedOut', { seconds: o.seconds }), detail: t('statusPausedStopped', { run }), tone: 'paused' };
    case 'failed':
      return { main: t('statusRunFailed'), detail: o.reason, tone: 'bad' };
    case 'done': {
      const r = o.result;
      // ngspice's own time for the run, as the ngspice output panel says it (one number for one run).
      const ms = r.run?.timings?.runMs ?? r.ms;
      if (r.status === 'ok') return { main: t('statusSolved', { ms: Math.max(1, Math.round(ms)) }), tone: 'ok' };
      const error = r.checks.find((c) => c.severity === 'error');
      if (r.status === 'check' && error) return { main: notAnswersWord(r), detail: t('noNumbersCheck', { title: error.title.replace(/[.!?:]$/, '') }), tone: 'bad' };
      return { main: notAnswersWord(r), detail: withoutResultsPointer(r.words.summary), tone: 'bad' };
    }
  }
}

/**
 * The analysis for the status line, from its explanation: ".op: operating point" as "Operating
 * point · .op" (the explanation's words may have brackets of their own: "transient analysis (over time)").
 */
export function analysisName(explains: readonly LineExplanation[], netlist: Netlist): string | undefined {
  const i = netlist.analyses[0];
  if (i === undefined) return undefined;
  const ex = explains.find((e) => e.line === i + 1);
  const m = ex ? /^(\.\w+):\s*(.*)$/.exec(ex.heading) : null;
  return m ? `${m[2]!.charAt(0).toUpperCase()}${m[2]!.slice(1)} · ${m[1]}` : ex?.heading;
}

export interface HintInput {
  phone: boolean;
  tool: Tool;
  /** The selected part's name. */
  selectedName: string | undefined;
  /** A node selected (its name as written), ground selected, or a piece of wire selected (its node in words). */
  selectedNode?: string | undefined;
  selectedGround?: boolean;
  selectedWire?: string | undefined;
  /** The open card's "type a value" hint. */
  typeHint: string | undefined;
  /** A value has been typed on the open card (its keys T, M ... are letters of it until the card closes). */
  typed?: boolean;
  /** A node's card is open: its name as written, or ground. */
  nodeCard?: { name: string; ground: boolean } | undefined;
  /** Live runs will not run what is typed (paused, a link not run yet): say to press Run. */
  paused?: boolean;
  /** The whole drawing is in view. */
  whole: boolean;
  /** A phone shows the drawing turned to fit, or as drawn. */
  turned: boolean;
  asDrawn: boolean;
  /** The first screen (Start here) where the sticky note is not shown (a phone, or no free paper for it): the hint invites instead. */
  invite?: string | undefined;
  /** The drawing is not shown (too many parts). */
  undrawn?: boolean;
  /** Nothing to draw: the netlist has no parts. */
  empty?: boolean;
  /** The part in hand, where it would go now: which nodes it would join there, or why it cannot go there. */
  place?: { joins?: string; refused?: string } | undefined;
  /** A wire on its way (its first end chosen), or why the last click could not end it. */
  wire?: { started: boolean; refused?: string } | undefined;
  /** Something being moved: its name, by dragging or picked up (the card's Move), whether it is a part (it can turn), and why it cannot go where it is now. */
  moving?: { name: string; how: 'drag' | 'pick'; part?: boolean; refused?: string } | undefined;
  /** A phone shows the drawing as drawn while an editing tool is chosen (it was turned to fit). */
  editingAsDrawn?: boolean;
  /** The tool was chosen with the keys: say the keyboard's way to use it. */
  keys?: boolean;
}

const cap = (words: string): string => words.charAt(0).toUpperCase() + words.slice(1);

/** A model's sentence inside the hint line: its last full stop goes, the "·" separates. */
const clause = (sentence: string): string => sentence.trim().replace(/\.$/, '');

/** The hint line: what you can do now, in plain words. */
export function hintWords(p: HintInput): string {
  const lead = p.editingAsDrawn ? `${t('hintAsDrawnEditing')} · ` : '';
  if (p.moving) {
    const name = p.moving.name;
    if (p.moving.refused) return t(p.phone ? 'hintDragRefusedPhone' : 'hintDragRefused', { name: cap(name), reason: clause(p.moving.refused) });
    const turn = p.moving.part ? t('hintMovingTurn') : '';
    if (p.moving.how === 'pick') return `${lead}${p.phone ? t('hintPickPhone', { name }) : t('hintPick', { name, turn })}`;
    return p.phone ? t('hintDragPhone', { name }) : t('hintDrag', { name, turn });
  }
  if (p.tool === 'wire') {
    if (p.wire?.refused) return t('hintWireRefused', { reason: clause(p.wire.refused) });
    if (p.wire?.started) return `${lead}${p.phone ? t('hintWireOnPhone') : p.keys ? t('hintWireOnKeys') : t('hintWireOn')}`;
    return `${lead}${p.phone ? t('hintWirePhone') : p.keys ? t('hintWireKeys') : t('hintWire')}`;
  }
  if (p.tool !== 'select') {
    const part = toolPhrase(p.tool);
    if (p.place?.refused) return p.phone ? t('hintPlacePhoneRefused', { reason: clause(p.place.refused) }) : t('hintPlaceRefused', { reason: clause(p.place.refused) });
    // A ground symbol looks the same mirrored: no M for it.
    const mirror = p.tool === 'ground' ? '' : t('hintMirrorIt');
    if (p.place?.joins) return p.phone ? t('hintPlacePhoneHere', { joins: cap(p.place.joins) }) : t('hintPlaceHere', { part, joins: p.place.joins, mirror });
    return `${lead}${p.phone ? t('hintPlacePhone', { part }) : p.keys && p.tool !== 'ground' ? t('hintPlaceKeys', { part }) : t('hintPlace', { part, mirror })}`;
  }
  if (p.typeHint) {
    if (p.paused) return p.phone ? `${p.typeHint} · ${t('statusPaused')}: ${pressRun(true)}` : t('hintTypingPaused', { hint: p.typeHint, run: pressRun(false) });
    if (p.phone) return p.typeHint;
    return p.typed ? t('hintTyping', { hint: p.typeHint }) : t('hintCardOpen', { hint: p.typeHint });
  }
  if (p.nodeCard) return p.nodeCard.ground ? t('hintGroundCard') : t('hintNodeCard', { name: p.nodeCard.name });
  if (p.undrawn) return t('hintUndrawn');
  if (p.empty) return p.phone ? t('hintEmptyPhone') : t('hintEmpty');
  if (p.selectedWire !== undefined) return p.phone ? t('hintWireSelectedPhone', { node: p.selectedWire }) : t('hintWireSelected', { node: p.selectedWire });
  if (p.selectedGround) return p.phone ? t('hintSelectedPhone', { name: t('groundName') }) : t('hintGroundSelected');
  if (p.selectedNode !== undefined) return p.phone ? t('hintNodeSelectedPhone', { name: p.selectedNode }) : t('hintNodeSelected', { name: p.selectedNode });
  if (p.selectedName) return p.phone ? t('hintSelectedPhone', { name: p.selectedName }) : t('hintSelected', { name: p.selectedName });
  if (p.invite) return p.phone ? t('hintInvitePhone', { name: p.invite }) : t('hintInviteDesk', { name: p.invite });
  if (p.phone && p.turned) return p.whole ? t('hintTurned') : t('hintTurnedPan');
  if (p.phone && p.asDrawn && !p.whole) return t('hintAsDrawn');
  if (p.phone) return p.whole ? t('hintPhone') : t('hintPhonePan');
  return t('hintDesk');
}

/** How far something being moved is from where it was, in grid squares: "2 squares right and 1 square down from where it was". */
export function offsetWords(dx: number, dy: number): string {
  const parts: string[] = [];
  if (dx) parts.push(tn(dx > 0 ? 'squaresRight' : 'squaresLeft', Math.abs(dx)));
  if (dy) parts.push(tn(dy > 0 ? 'squaresDown' : 'squaresUp', Math.abs(dy)));
  return parts.length ? t('offsetFrom', { offset: parts.join(` ${t('and')} `) }) : t('offsetNone');
}
