/**
 * Node colours for the editor and the results tables: one colour per node from the colour-blind-
 * safe palette in src/theme/nodes.ts, in order of first appearance in the netlist. Ground is left
 * out because it is the reference (it keeps the plain underline). The parser decides what ground
 * is, so a node written "gnd" as the last word of its line (an ordinary node for ngspice) gets a
 * colour like any other node.
 */
import { nodeColour } from '../theme/nodes.ts';
import type { Netlist } from '../spice/types.ts';

export function nodeColours(netlist: Netlist): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  for (const info of netlist.nodes.values()) {
    if (info.ground || out.has(info.name)) continue;
    out.set(info.name, nodeColour(i++));
  }
  return out;
}

/** True when two colour maps give every node the same colour (so the editor need not redraw). */
export function sameColours(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}
