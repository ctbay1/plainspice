/**
 * Results in words for a page that writes them on the drawing, built from the model's own sentences
 * (src/spice/describe.ts, DESCRIBE_STRINGS) and formatSI, never typed here:
 *
 * - the summary without its last sentence ("Open the results for details."), which points at a
 *   results view this page does not have (critique 8);
 * - a current with ground called "ground", as the card does, wherever the page shows one;
 * - the voltage across a part as a size and which end is higher ("24 V across it, a is higher"),
 *   with SPICE's signed difference kept underneath (critique 9).
 *
 * Plain TypeScript.
 */
import { formatSI, speakSI } from '../format/si.ts';
import { DESCRIBE_STRINGS as S, type CurrentWords } from '../spice/describe.ts';

const MARK = '\u0000';

/**
 * The sentence every summary ends with, read from the model's own summary template: whatever
 * follows the reason in "ngspice stopped with an error: <reason>. Open the results for details."
 */
export const RESULTS_POINTER: string = (() => {
  const t = S.summaryFailed(MARK);
  const after = t.slice(t.indexOf(MARK) + MARK.length);
  return after.startsWith('.') ? after.slice(1) : '';
})();

/** The model's summary without the sentence pointing at a results view (unchanged when it has none). */
export function withoutResultsPointer(summary: string): string {
  const p = RESULTS_POINTER;
  return p.trim() && summary.endsWith(p) ? summary.slice(0, -p.length).trimEnd() : summary;
}

/** A node's name in sentences: ground (node 0) is "ground", as everywhere in the model's words. */
export const nodeWord = (node: string, text: (node: string) => string = (n) => n): string => (node === '0' ? S.ground : text(node));

/** A current in the model's words, ground called "ground": "4 A from ground to a through G1". */
export function currentText(c: CurrentWords, text?: (node: string) => string): string {
  const from = nodeWord(c.from, text);
  const to = nodeWord(c.to, text);
  const a = formatSI(Math.abs(c.value), 'A');
  if (c.ammeter) return c.value === 0 ? S.measuresNothing(c.name) : S.measures(c.name, a, from, to);
  return c.value === 0 ? S.noCurrent(c.name) : S.amps(a, from, to, c.name);
}

export interface AcrossWords {
  /** The size: "24 V". */
  text: string;
  /** The end that is higher, by name ("a"; "ground"), or undefined when the two ends are level. */
  higher?: string;
  /** SPICE's signed difference, as the netlist writes the nodes: "V(0) − V(a) = −24 V". */
  signed: string;
  /** All of it for screen readers. */
  speech: string;
}

/** The two ends' names as the netlist writes them (ground "0") for SPICE's V( ) notation. */
export interface AcrossInput {
  name: string;
  /** Each end's voltage. */
  v: readonly [number, number];
  /** Each end's ngspice name ("0" for ground) and as written. */
  nodes: readonly [string, string];
  written: readonly [string, string];
  /** A node's name in sentences (default: as written). */
  text?: (node: string) => string;
}

const MINUS = '−';

/** The page's own words around a voltage across a part, in one object so a Turkish UI can replace them. */
export const ACROSS_STRINGS = {
  across: 'across it',
  higher: (node: string): string => `${node} is higher`,
} as const;

/** The voltage across a part: its size, which end is higher, and SPICE's signed V(a) − V(b). */
export function acrossWords(p: AcrossInput): AcrossWords {
  const d = p.v[0] - p.v[1];
  const text = formatSI(Math.abs(d), 'V');
  const signed = `V(${p.written[0]}) ${MINUS} V(${p.written[1]}) = ${formatSI(d, 'V')}`;
  const level = text === formatSI(0, 'V');
  const higherNode = d > 0 ? p.nodes[0] : p.nodes[1];
  const higher = level ? undefined : nodeWord(higherNode, p.text);
  const speech = `${speakSI(Math.abs(d), 'V')} across ${p.name}${higher ? `, ${ACROSS_STRINGS.higher(higher)}` : ''}. V(${p.written[0]}) minus V(${p.written[1]}) is ${speakSI(d, 'V')}`;
  return higher === undefined ? { text, signed, speech } : { text, higher, signed, speech };
}
