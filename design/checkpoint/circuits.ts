/**
 * The checkpoint's circuits: example 3 of the Solved Circuits video "Thévenin Equivalent with
 * Dependent Sources" (open circuit, then short circuit) and example 2 (only a dependent source,
 * tested with 1 A), exactly as in examples/p02/ (each credits the video on line 2). Their values
 * are checked against the channel's native ngspice runs in tests/golden/examples.test.ts.
 */
import examples from '../../examples/examples.json';
import open from '../../examples/p02/p02-4-open.cir?raw';
import short from '../../examples/p02/p02-5-short.cir?raw';
import dependentOnly from '../../examples/p02/p02-3-dependent-only.cir?raw';

export type CircuitId = 'p02-4-open' | 'p02-5-short' | 'p02-3-dependent-only';

export interface CheckpointCircuit {
  id: CircuitId;
  /** The netlist as in examples/p02/. */
  text: string;
  /** The example's name in the library ("Example 3: open circuit (V_Th)"). */
  name: string;
  /**
   * A short title for the top bar, which fits a phone: the example's number, what the circuit is,
   * and what it finds, its subscript apart ("Ex. 3 · open circuit · V_Th").
   */
  short: { example: string; what: string; finds: { symbol: string; sub: string } };
  file: string;
  /** What the video is called, for the credit. */
  video: string;
  youtube: string;
}

const TEXTS: Readonly<Record<CircuitId, string>> = { 'p02-4-open': open, 'p02-5-short': short, 'p02-3-dependent-only': dependentOnly };

/** The short titles: what each circuit is, and the Thévenin quantity it finds (the video's names). */
const SHORT: Readonly<Record<CircuitId, CheckpointCircuit['short']>> = {
  'p02-4-open': { example: 'Ex. 3', what: 'open circuit', finds: { symbol: 'V', sub: 'Th' } },
  'p02-5-short': { example: 'Ex. 3', what: 'short circuit', finds: { symbol: 'I', sub: 'sc' } },
  'p02-3-dependent-only': { example: 'Ex. 2', what: 'test current', finds: { symbol: 'R', sub: 'Th' } },
};

export const CIRCUIT_IDS: readonly CircuitId[] = ['p02-4-open', 'p02-5-short', 'p02-3-dependent-only'];

export function isCircuitId(s: string | undefined | null): s is CircuitId {
  return s === 'p02-4-open' || s === 'p02-5-short' || s === 'p02-3-dependent-only';
}

export const CIRCUITS: readonly CheckpointCircuit[] = CIRCUIT_IDS.map((id) => {
  const e = examples.examples.find((x) => x.id === id);
  const v = examples.videos.find((x) => x.id === e?.video);
  return { id, text: TEXTS[id], name: e?.name ?? id, short: SHORT[id], file: e?.file.split('/').pop() ?? `${id}.cir`, video: v?.title ?? '', youtube: v?.youtube ?? '' };
});

export const circuitById = (id: CircuitId): CheckpointCircuit => CIRCUITS.find((c) => c.id === id)!;

/** The short title as plain text, its subscript written with an underscore as in the library ("V_Th"). */
export const shortText = (c: CheckpointCircuit): string => `${c.short.example} · ${c.short.what} · ${c.short.finds.symbol}_${c.short.finds.sub}`;
