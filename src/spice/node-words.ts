/**
 * How a sentence names a node, one rule for every page that does (words review W8 and its re-check):
 * the word "node" goes before a name, since a name may be an ordinary word ("node in is 6 volts",
 * not "in is 6 volts"), but not before a name that already says it is a node ("node1 is 6 volts",
 * never "node node1"). A node called just "node" keeps the word ("node node"), or nothing would say
 * what "node" is. Each page's own strings add the word (`DESCRIBE_STRINGS.node`, `EXPLAIN_STRINGS.nodeWord`,
 * `EDIT_STRINGS.node`, the app's `nodeNamed`), so a translation can change it; ground, and the quotes
 * around a name like ground, are theirs too. Plain TypeScript.
 */

/** True when a node's name starts with the word node and goes on ("node1", "Node_A", "nodeB"). */
export function nameSaysNode(name: string): boolean {
  return /^node\S/i.test(name);
}

/**
 * A node in a sentence at the start of the sentence: "node in" becomes "Node in", "ground" becomes
 * "Ground", and a name that says node keeps its own letters ("node1 is 6 volts.", never "Node1").
 */
export function atSentenceStart(words: string): string {
  return nameSaysNode(words) ? words : words.charAt(0).toUpperCase() + words.slice(1);
}
