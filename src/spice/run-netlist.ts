/**
 * The netlist text PlainSpice gives ngspice for a run: the student's text, with at most one line
 * added. When the netlist asks for an operating point (.op) and has no `.options savecurrents`,
 * the copy that runs gets `.options savecurrents` just before `.end`. ngspice then also saves the
 * current through every R, C, L, F, G and I part, not only through the voltage sources (claim A2
 * in docs/spice-facts/explanations.md), so the results can show which way every current flows.
 * The node voltages are the same with or without it (A1 and A2 give the same values).
 *
 * The line goes just before `.end`, so it moves none of the student's lines: "line N" in ngspice's
 * messages still points at line N of the editor. The student's text itself is never changed, and
 * the ngspice output tab says which line was added.
 */
import type { Netlist } from './types.ts';

export const SAVE_CURRENTS_LINE = '.options savecurrents';

export interface NetlistToRun {
  /** The text ngspice runs. */
  text: string;
  /** The lines PlainSpice added to that text (empty when it is the student's text unchanged). */
  added: string[];
}

const OPTIONS = new Set(['.options', '.option', '.opt']);

/** The netlist already has `.options savecurrents` (on the line or a continuation of it). */
export function hasSaveCurrents(netlist: Netlist): boolean {
  return netlist.directives.some((i) => {
    const d = netlist.lines[i]?.directive;
    return !!d && OPTIONS.has(d.name) && d.args.some((a) => a.text.toLowerCase() === 'savecurrents');
  });
}

export function netlistToRun(netlist: Netlist): NetlistToRun {
  const { text } = netlist;
  const hasOp = netlist.analyses.some((i) => netlist.lines[i]?.directive?.name === '.op');
  if (!hasOp || hasSaveCurrents(netlist)) return { text, added: [] };
  const end = netlist.end === undefined ? undefined : netlist.lines[netlist.end];
  if (end) {
    const at = end.span.from;
    return { text: `${text.slice(0, at)}${SAVE_CURRENTS_LINE}\n${text.slice(at)}`, added: [SAVE_CURRENTS_LINE] };
  }
  const gap = text === '' || text.endsWith('\n') ? '' : '\n';
  return { text: `${text}${gap}${SAVE_CURRENTS_LINE}\n`, added: [SAVE_CURRENTS_LINE] };
}
