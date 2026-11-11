/**
 * The words of the frame around the drawing, as plain functions of the app's state, so they can be
 * tested without a browser: the status line (Studio's, decision 0014: what ngspice is doing and how
 * the last run went) and the hint line (Playground's: what you can do next, in plain words). One
 * verb for one idea: ngspice "runs" a netlist (Run, live runs, "Running…", "Finished in 5 ms").
 */
import { t } from '../i18n/index.ts';
import { withoutResultsPointer } from '../notebook/words.ts';
import type { LineExplanation, Netlist } from '../spice/types.ts';
import type { Tool } from './components/PartsToolbar.tsx';
import { toolPhrase } from './components/PartsToolbar.tsx';
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
  /** The open card's "type a value" hint. */
  typeHint: string | undefined;
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
}

/** The hint line: what you can do now, in plain words. */
export function hintWords(p: HintInput): string {
  const back = p.phone ? t('hintBackPhone') : t('hintBackDesk');
  if (p.tool === 'wire') return t('hintWire', { back });
  if (p.tool !== 'select') return t('hintPlacing', { part: toolPhrase(p.tool), back });
  if (p.typeHint) {
    if (p.paused) return p.phone ? `${p.typeHint} · ${t('statusPaused')}: ${pressRun(true)}` : t('hintTypingPaused', { hint: p.typeHint, run: pressRun(false) });
    return p.phone ? p.typeHint : t('hintTyping', { hint: p.typeHint });
  }
  if (p.undrawn) return t('hintUndrawn');
  if (p.empty) return p.phone ? t('hintEmptyPhone') : t('hintEmpty');
  if (p.selectedName) return p.phone ? t('hintSelectedPhone', { name: p.selectedName }) : t('hintSelected', { name: p.selectedName });
  if (p.invite) return p.phone ? t('hintInvitePhone', { name: p.invite }) : t('hintInviteDesk', { name: p.invite });
  if (p.phone && p.turned) return p.whole ? t('hintTurned') : t('hintTurnedPan');
  if (p.phone && p.asDrawn && !p.whole) return t('hintAsDrawn');
  if (p.phone) return p.whole ? t('hintPhone') : t('hintPhonePan');
  return t('hintDesk');
}
