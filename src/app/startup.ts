/**
 * Which circuit the app opens with:
 *   1. a share link in the address (#c=...), and simulate at once when it says run=1;
 *   2. otherwise the netlist the student was working on last time (saved on this device);
 *   3. otherwise the first example (F5).
 * A link that cannot be opened says why (decodeShare's plain-words reason) and the app opens the
 * next choice; a fragment that is not a share link at all (e.g. "#main" from the skip link) is
 * ignored silently.
 */
import { decodeShare, type DecodedShare } from '../share/link.ts';
import { DEFAULT_EXAMPLE_ID, exampleById, EXAMPLES } from './examples.ts';
import { readStored, STORAGE_KEYS } from './storage.ts';

export type StartupDecision =
  | { source: 'share'; netlist: string; run: boolean }
  | { source: 'saved'; netlist: string; problem?: string }
  | { source: 'example'; netlist: string; exampleId: string; problem?: string };

export interface StartupInput {
  /** decodeShare(location.hash), or null when there is no fragment. */
  share: DecodedShare | null;
  /** The netlist saved on this device, if any. */
  saved: string | null;
  example: { id: string; netlist: string };
}

export function decideStartup({ share, saved, example }: StartupInput): StartupDecision {
  if (share?.ok) return { source: 'share', netlist: share.netlist, run: share.run };
  const problem = share && !share.ok && share.code !== 'no-circuit' ? share.reason : undefined;
  const withProblem = <T extends object>(d: T): T & { problem?: string } => (problem === undefined ? d : { ...d, problem });
  if (saved !== null && saved.trim() !== '') return withProblem({ source: 'saved' as const, netlist: saved });
  return withProblem({ source: 'example' as const, netlist: example.netlist, exampleId: example.id });
}

/** Read the address and the device, then decide (the only part that touches the browser). */
export async function readStartup(hash: string = globalThis.location?.hash ?? ''): Promise<StartupDecision> {
  const share = hash && hash !== '#' ? await decodeShare(hash) : null;
  const example = exampleById(DEFAULT_EXAMPLE_ID) ?? EXAMPLES[0] ?? { id: 'empty', netlist: '* A new circuit\n.op\n.end\n' };
  return decideStartup({ share, saved: readStored(STORAGE_KEYS.netlist), example: { id: example.id, netlist: example.netlist } });
}

/** Remove the share link from the address once its circuit is open, so a reload keeps the student's edits. */
export function clearShareFragment(): void {
  try {
    const url = new URL(globalThis.location.href);
    if (!url.hash) return;
    url.hash = '';
    globalThis.history.replaceState(globalThis.history.state, '', url.href.replace(/#$/, ''));
  } catch {
    // An unusual address (or no history API): keep it as it is.
  }
}
