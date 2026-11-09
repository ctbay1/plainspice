/**
 * The circuit as a graph, for the trap checks (traps.ts): which nodes are joined at DC, which
 * groups of nodes have no DC path to ground, and which parts form loops of voltage sources.
 * Plain TypeScript: no UI framework, no DOM.
 *
 * What conducts at DC was checked by running native ngspice 47, native ngspice 42 and our
 * WebAssembly engine (docs/spice-facts/traps.md, asserted by tests/golden/facts-traps.test.ts):
 * - resistors, inductors and voltage sources conduct; so do the outputs of E and H (they are
 *   voltage sources), diodes, BJTs, JFETs and MESFETs (their junctions conduct), and switches;
 * - capacitors, current sources, the outputs of F and G (current sources) and the control nodes of
 *   E and G draw no DC current: a node reached only through them has no DC path, and ngspice's
 *   matrix is singular (floating-dc, current-source-no-path);
 * - a MOSFET's gate draws no DC current either: a gate with nothing else on it is singular too;
 * - an inductor is a wire at DC, so it closes a loop of voltage sources like a 0 V source would
 *   (voltage-loop). ngspice then prints numbers it can't trust instead of stopping.
 * Parts PlainSpice does not model in detail (transmission lines, subcircuit calls, XSPICE, ...)
 * count as joining all their nodes, so a check never claims a node is cut off when it may not be.
 */
import type { Element, Netlist } from './types.ts';

/** Union-find over node names (path halving, union by size). */
export class UnionFind {
  private readonly parent = new Map<string, string>();
  private readonly size = new Map<string, number>();

  find(x: string): string {
    let p = this.parent.get(x);
    if (p === undefined) {
      this.parent.set(x, x);
      this.size.set(x, 1);
      return x;
    }
    let node = x;
    while (p !== node) {
      const grand = this.parent.get(p) ?? p;
      this.parent.set(node, grand);
      node = grand;
      p = this.parent.get(node) ?? node;
    }
    return node;
  }

  /** Joins the groups of a and b; false when they were already one group. */
  union(a: string, b: string): boolean {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return false;
    if ((this.size.get(ra) ?? 1) < (this.size.get(rb) ?? 1)) [ra, rb] = [rb, ra];
    this.parent.set(rb, ra);
    this.size.set(ra, (this.size.get(ra) ?? 1) + (this.size.get(rb) ?? 1));
    return true;
  }

  same(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }
}

/** How a terminal touches a node without conducting at DC. */
export type Attachment =
  | 'capacitor' // C: open at DC
  | 'current' // I, and the outputs of F and G (and B with I=): a current source
  | 'control' // the control nodes of E, G and S: they only sense a voltage
  | 'gate'; // a MOSFET's gate

/** A group of nodes joined at DC that has no DC path to ground. */
export interface DcGroup {
  /** The nodes, in order of first appearance. */
  nodes: string[];
  /** Terminals that touch the group without conducting, in netlist order. */
  attachments: { line: number; node: string; kind: Attachment }[];
  /** Parts that conduct between nodes of the group (a resistor whose both ends float, ...). */
  conductors: number[];
}

/** Parts that join two nodes as a fixed voltage at DC: V, the outputs of E and H, and L (a wire). */
export interface VoltageLoop {
  /** The part that closes the loop (the later one in the netlist). */
  line: number;
  /** The other parts of the loop, along the path between the closing part's two nodes. */
  others: number[];
  /** The loop contains an inductor. */
  inductor: boolean;
  /** The closing part has both ends on one node. */
  self: boolean;
}

export interface CircuitGraph {
  /** Element lines outside .subckt ... .ends that ngspice builds (it drops an R, C or L without a value). */
  elements: number[];
  /** Element lines inside .subckt ... .ends (their nodes are local to the subcircuit). */
  inSubcircuit: ReadonlySet<number>;
  /** Some part connects to ground (node 0, or gnd). */
  hasGround: boolean;
  /** Groups with no DC path to ground (empty when nothing connects to ground at all). */
  floating: DcGroup[];
  /** Loops of voltage-defining parts, each reported at the part that closes it. */
  loops: VoltageLoop[];
  /** Nodes joined by voltage-defining parts (V, E and H outputs, L) only. */
  voltagePaths: UnionFind;
}

const GROUND = '0';

/** Element lines inside .subckt ... .ends (nested definitions included), as the parser counts them. */
export function subcircuitLines(netlist: Netlist): Set<number> {
  const inside = new Set<number>();
  let depth = 0;
  for (const line of netlist.lines) {
    const name = line.directive?.name;
    if (name === '.subckt' || name === '.macro') depth += 1;
    else if (name === '.ends' || name === '.eom') depth = Math.max(0, depth - 1);
    else if (line.element && depth > 0) inside.add(line.index);
  }
  return inside;
}

/** True when ngspice builds the part: R, C and L need two nodes and a value, or a model. */
export function isBuilt(e: Element): boolean {
  if (e.letter === 'R' || e.letter === 'C' || e.letter === 'L') {
    return e.nodes.length >= 2 && (e.value !== undefined || e.fields.some((f) => f.role === 'model'));
  }
  return e.letter !== undefined;
}

interface DcRole {
  /** Pairs of nodes the part joins at DC. */
  conduct: [string, string][];
  /** Terminals that touch a node without conducting. */
  attach: [string, Attachment][];
  /** The two ends of a voltage-defining branch. */
  voltage?: [string, string];
  inductor?: boolean;
}

/** A B line's kind: 'v' (V=expression), 'i' (I=expression), or undefined when malformed. */
export function behaviouralKind(e: Element): 'v' | 'i' | undefined {
  const words = e.fields.filter((f) => f.role === 'parameter').map((f) => f.token.text.toLowerCase());
  const first = words[0];
  return first === 'v' || first === 'i' ? first : undefined;
}

function dcRole(e: Element): DcRole {
  const n = e.nodes.map((r) => r.name);
  const role: DcRole = { conduct: [], attach: [] };
  const all = (): void => {
    for (let k = 1; k < n.length; k++) role.conduct.push([n[0]!, n[k]!]);
  };
  const pair = (a: number, b: number): [string, string] | undefined =>
    n[a] !== undefined && n[b] !== undefined ? [n[a]!, n[b]!] : undefined;
  const attach = (from: number, to: number, kind: Attachment): void => {
    for (let k = from; k < Math.min(to, n.length); k++) role.attach.push([n[k]!, kind]);
  };
  switch (e.letter) {
    case 'R':
    case 'W': {
      const p = pair(0, 1);
      if (p) role.conduct.push(p);
      break;
    }
    case 'L':
    case 'V':
    case 'E':
    case 'H': {
      const p = pair(0, 1);
      if (p) {
        role.conduct.push(p);
        role.voltage = p;
        if (e.letter === 'L') role.inductor = true;
      }
      if (e.letter === 'E') attach(2, 4, 'control');
      break;
    }
    case 'C':
      attach(0, 2, 'capacitor');
      break;
    case 'I':
    case 'F':
      attach(0, 2, 'current');
      break;
    case 'G':
      attach(0, 2, 'current');
      attach(2, 4, 'control');
      break;
    case 'S': {
      const p = pair(0, 1);
      if (p) role.conduct.push(p);
      attach(2, 4, 'control');
      break;
    }
    case 'B': {
      const kind = behaviouralKind(e);
      const p = pair(0, 1);
      if (kind === 'v' && p) role.conduct.push(p);
      else if (kind === 'i') attach(0, 2, 'current');
      break;
    }
    case 'M': {
      // Drain, source and bulk are joined through the channel and the bulk junctions; the gate
      // is insulated (a gate with nothing else on it makes the matrix singular).
      const others = n.filter((_, k) => k !== 1);
      for (let k = 1; k < others.length; k++) role.conduct.push([others[0]!, others[k]!]);
      if (n[1] !== undefined) role.attach.push([n[1], 'gate']);
      break;
    }
    case 'K':
      break;
    default:
      all();
  }
  return role;
}

/** The path of voltage-defining parts between two nodes, through the branches added so far. */
function pathBetween(adjacent: Map<string, [string, number][]>, from: string, to: string): number[] {
  const back = new Map<string, [string, number]>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node === to) break;
    for (const [next, line] of adjacent.get(node) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      back.set(next, [node, line]);
      queue.push(next);
    }
  }
  const path: number[] = [];
  for (let node = to; node !== from; ) {
    const step = back.get(node);
    if (!step) break;
    path.push(step[1]);
    node = step[0];
  }
  return path.reverse();
}

/** Builds the graph of the parts outside subcircuits. */
export function buildGraph(netlist: Netlist): CircuitGraph {
  const inSubcircuit = subcircuitLines(netlist);
  const elements = netlist.elements.filter((i) => !inSubcircuit.has(i) && isBuilt(netlist.lines[i]!.element!));
  const dc = new UnionFind();
  const voltagePaths = new UnionFind();
  const adjacent = new Map<string, [string, number][]>();
  const roles = new Map<number, DcRole>();
  const loops: VoltageLoop[] = [];
  const inductors = new Set<number>();

  for (const i of elements) {
    const e = netlist.lines[i]!.element!;
    const role = dcRole(e);
    roles.set(i, role);
    for (const r of e.nodes) dc.find(r.name);
    for (const [a, b] of role.conduct) dc.union(a, b);
    if (!role.voltage) continue;
    if (role.inductor) inductors.add(i);
    const [a, b] = role.voltage;
    if (a === b) {
      loops.push({ line: i, others: [], inductor: role.inductor === true, self: true });
      continue;
    }
    if (voltagePaths.same(a, b)) {
      const others = pathBetween(adjacent, a, b);
      const inductor = role.inductor === true || others.some((k) => inductors.has(k));
      loops.push({ line: i, others, inductor, self: false });
      continue;
    }
    voltagePaths.union(a, b);
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const list = adjacent.get(x);
      if (list) list.push([y, i]);
      else adjacent.set(x, [[y, i]]);
    }
  }

  const hasGround = elements.some((i) => netlist.lines[i]!.element!.nodes.some((r) => r.name === GROUND));
  const floating: DcGroup[] = [];
  if (hasGround) {
    const groups = new Map<string, DcGroup>();
    const groupOf = (node: string): DcGroup | undefined => {
      const root = dc.find(node);
      if (root === dc.find(GROUND)) return undefined;
      let g = groups.get(root);
      if (!g) {
        g = { nodes: [], attachments: [], conductors: [] };
        groups.set(root, g);
        floating.push(g);
      }
      return g;
    };
    for (const i of elements) {
      const e = netlist.lines[i]!.element!;
      for (const r of e.nodes) {
        const g = groupOf(r.name);
        if (g && !g.nodes.includes(r.name)) g.nodes.push(r.name);
      }
      const role = roles.get(i)!;
      for (const [node, kind] of role.attach) groupOf(node)?.attachments.push({ line: i, node, kind });
      const first = role.conduct[0];
      if (first) {
        const g = groupOf(first[0]);
        if (g && !g.conductors.includes(i)) g.conductors.push(i);
      }
    }
  }
  return { elements, inSubcircuit, hasGround, floating, loops, voltagePaths };
}
