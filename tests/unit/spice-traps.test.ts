/**
 * The beginner trap checks (src/spice/traps.ts) and the circuit graph they use (src/spice/graph.ts).
 *
 * Every behaviour a trap claims was checked by running native ngspice 47, native ngspice 42 and our
 * WebAssembly engine (docs/spice-facts/traps.md; the engine runs are tests/golden/facts-traps.test.ts).
 * Here, without the engine: each trap fires on a minimal netlist with the right line, span, severity
 * and fixes; every fix removes its trap and adds no new error or warning; correct netlists (the
 * fixtures and the channel's episode netlists) stay quiet; and the checks never throw.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeCircuit } from '../../src/spice/describe.ts';
import { explainNetlist } from '../../src/spice/explain.ts';
import { buildGraph, subcircuitLines, UnionFind } from '../../src/spice/graph.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { applyFix, checkTraps, looksLikeTypo, TRAP_IDS, type TrapId } from '../../src/spice/traps.ts';
import type { Trap, TrapSeverity } from '../../src/spice/types.ts';
import { leastWorkMs } from './work-time.ts';

const root = resolve(import.meta.dirname, '../..');
const traps = (text: string): Trap[] => checkTraps(parseNetlist(text));
const ids = (text: string): string[] => traps(text).map((t) => t.id);
const count = (list: Trap[], id: string, severity?: TrapSeverity): number =>
  list.filter((t) => t.id === id && (!severity || t.severity === severity)).length;

interface Case {
  name: string;
  id: TrapId;
  severity: TrapSeverity;
  /** 1-based line of the trap. */
  line: number;
  /** The text the trap underlines. */
  at: string;
  /** Every trap the netlist has, in order. */
  all: string[];
  /** The labels of the trap's fixes, in order. */
  fixes: string[];
  netlist: string;
}

/** One minimal netlist per situation each trap covers (the expectations were reviewed by hand). */
const CASES: Case[] = [
  { name: "1M on a resistor", id: 'mega-as-milli', severity: 'warning', line: 3, at: "1M", all: ["mega-as-milli"], fixes: ["Make it 1meg (1\u00a0M\u03a9)","Keep milli: write 1m"], netlist: "* t\nV1 n1 0 6\nR1 n1 n2 1M\nR2 n2 0 1meg\n.op\n.end\n" },
  { name: "4.7MOhm on a resistor", id: 'mega-as-milli', severity: 'warning', line: 3, at: "4.7MOhm", all: ["mega-as-milli"], fixes: ["Make it 4.7meg (4.7\u00a0M\u03a9)","Keep milli: write 4.7m"], netlist: "* t\nV1 n1 0 6\nR1 n1 n2 4.7MOhm\nR2 n2 0 1meg\n.op\n.end\n" },
  { name: "5M on a voltage source", id: 'mega-as-milli', severity: 'warning', line: 2, at: "5M", all: ["mega-as-milli"], fixes: ["Keep milli: write 5m","Make it 5meg (5\u00a0MV)"], netlist: "* t\nV1 n1 0 5M\nR1 n1 0 1\n.op\n.end\n" },
  { name: "1M as a gain", id: 'mega-as-milli', severity: 'warning', line: 4, at: "1M", all: ["mega-as-milli"], fixes: ["Make it 1meg (a gain of 1000000)","Keep milli: write 1m"], netlist: "* t\nV1 c 0 1\nR1 c 0 1\nE1 out 0 c 0 1M\nR2 out 0 1\n.op\n.end\n" },
  { name: "3A on a current source", id: 'unit-letter', severity: 'warning', line: 2, at: "3A", all: ["unit-letter"], fixes: ["Write 3 (3 amps)"], netlist: "* t\nI1 0 n1 3A\nR1 n1 0 4\n.op\n.end\n" },
  { name: "1F on a capacitor", id: 'unit-letter', severity: 'warning', line: 4, at: "1F", all: ["unit-letter"], fixes: ["Write 1 (1 farad)"], netlist: "* t\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1F\n.tran 1u 5u\n.end\n" },
  { name: "10f on a capacitor (info)", id: 'unit-letter', severity: 'info', line: 4, at: "10f", all: ["unit-letter"], fixes: ["Write 10 (10 farads)"], netlist: "* t\nV1 in 0 1\nR1 in out 1k\nC1 out 0 10f\n.tran 1u 5u\n.end\n" },
  { name: "Greek mu on a resistor", id: 'greek-mu', severity: 'warning', line: 3, at: "4.7\u03bc", all: ["greek-mu"], fixes: ["Write u for micro: 4.7u"], netlist: "* t\nI1 0 n1 1\nR1 n1 0 4.7\u03bc\n.op\n.end\n" },
  { name: "Greek mu in .tran", id: 'greek-mu', severity: 'warning', line: 5, at: "1\u03bcs", all: ["greek-mu","tran-problems"], fixes: ["Write u for micro: 1us"], netlist: "* t\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran 1\u03bcs 5m\n.end\n" },
  { name: "2k2", id: 'rkm-notation', severity: 'warning', line: 3, at: "2k2", all: ["rkm-notation"], fixes: ["Write 2.2k (2.2\u00a0k\u03a9)"], netlist: "* t\nI1 0 n1 1\nR1 n1 0 2k2\n.op\n.end\n" },
  { name: "1M5", id: 'rkm-notation', severity: 'warning', line: 3, at: "1M5", all: ["rkm-notation"], fixes: ["Write 1.5meg (1.5\u00a0M\u03a9)"], netlist: "* t\nI1 0 n1 1\nR1 n1 0 1M5\n.op\n.end\n" },
  { name: "4R7", id: 'rkm-notation', severity: 'warning', line: 3, at: "4R7", all: ["rkm-notation"], fixes: ["Write 4.7 (4.7\u00a0\u03a9)"], netlist: "* t\nI1 0 n1 1\nR1 n1 0 4R7\n.op\n.end\n" },
  { name: "4n7 on a capacitor", id: 'rkm-notation', severity: 'warning', line: 4, at: "4n7", all: ["rkm-notation"], fixes: ["Write 4.7n (4.7\u00a0nF)"], netlist: "* t\nV1 in 0 1\nR1 in out 1k\nC1 out 0 4n7\n.op\n.end\n" },
  { name: "1,5k on a resistor", id: 'decimal-comma', severity: 'warning', line: 3, at: "1,5k", all: ["decimal-comma"], fixes: ["Write 1.5k"], netlist: "* t\nI1 0 n1 1\nR1 n1 0 1,5k\n.op\n.end\n" },
  { name: "1,5 on a voltage source", id: 'decimal-comma', severity: 'error', line: 2, at: "1,5", all: ["decimal-comma"], fixes: ["Write 1.5"], netlist: "* t\nV1 a 0 1,5\nR1 a 0 1\n.op\n.end\n" },
  { name: "DC 2,5 on a current source", id: 'decimal-comma', severity: 'error', line: 2, at: "2,5", all: ["decimal-comma"], fixes: ["Write 2.5"], netlist: "* t\nI1 0 a DC 2,5\nR1 a 0 1\n.op\n.end\n" },
  { name: "1k-2 on a resistor", id: 'sign-in-value', severity: 'warning', line: 3, at: "1k-2", all: ["sign-in-value"], fixes: ["Keep 1k (1\u00a0k\u03a9)"], netlist: "* t\nI1 0 n1 1\nR1 n1 0 1k-2\n.op\n.end\n" },
  { name: "1d-3 on a resistor: an exponent was meant", id: 'sign-in-value', severity: 'warning', line: 3, at: "1d-3", all: ["sign-in-value"], fixes: ["Write 1e-3 (1\u00a0m\u03a9)"], netlist: "* t\nI1 0 n1 1\nR1 n1 0 1d-3\n.op\n.end\n" },
  { name: "1,5 on a gain", id: 'decimal-comma', severity: 'error', line: 4, at: "1,5", all: ["decimal-comma"], fixes: ["Write 1.5"], netlist: "* t\nV1 a 0 1\nR0 a 0 1\nE1 b 0 a 0 1,5\nR1 b 0 1\n.op\n.end\n" },
  { name: "1 k on a resistor", id: 'space-before-suffix', severity: 'error', line: 3, at: "1 k", all: ["space-before-suffix"], fixes: ["Write 1k"], netlist: "* t\nI1 0 n1 1\nR1 n1 0 1 k\n.op\n.end\n" },
  { name: "5 V on a voltage source", id: 'space-before-suffix', severity: 'error', line: 2, at: "5 V", all: ["space-before-suffix"], fixes: ["Write 5"], netlist: "* t\nV1 n1 0 5 V\nR1 n1 0 1\n.op\n.end\n" },
  { name: "3 A on a current source", id: 'space-before-suffix', severity: 'error', line: 2, at: "3 A", all: ["space-before-suffix"], fixes: ["Write 3"], netlist: "* t\nI1 0 n1 3 A\nR1 n1 0 2\n.op\n.end\n" },
  { name: "1 M on a resistor", id: 'space-before-suffix', severity: 'error', line: 3, at: "1 M", all: ["space-before-suffix"], fixes: ["Make it 1meg (1\u00a0M\u03a9)","Make it 1m (1\u00a0m\u03a9)"], netlist: "* t\nI1 0 n1 1\nR1 n1 0 1 M\n.op\n.end\n" },
  { name: "10 kOhm on a resistor", id: 'space-before-suffix', severity: 'error', line: 3, at: "10 kOhm", all: ["space-before-suffix"], fixes: ["Write 10k"], netlist: "* t\nI1 0 n1 1\nR1 n1 0 10 kOhm\n.op\n.end\n" },
  { name: "1 m on a resistor", id: 'space-before-suffix', severity: 'error', line: 3, at: "1 m", all: ["space-before-suffix"], fixes: ["Write 1m"], netlist: "* t\nI1 0 n1 1\nR1 n1 0 1 m\nR2 n1 0 1\n.op\n.end\n" },
  { name: "* after a value", id: 'midline-comment', severity: 'error', line: 3, at: "*", all: ["midline-comment"], fixes: ["Use ; for the comment"], netlist: "* t\nI1 0 n1 1\nR1 n1 0 2 * load\n.op\n.end\n" },
  { name: "# after a value", id: 'midline-comment', severity: 'error', line: 2, at: "#", all: ["midline-comment"], fixes: ["Use ; for the comment"], netlist: "* t\nV1 a 0 5 # supply\nR1 a 0 1\n.op\n.end\n" },
  { name: "no-break space", id: 'nbsp', severity: 'warning', line: 3, at: "0\u00a02", all: ["missing-value","nbsp"], fixes: ["Replace it with a normal space"], netlist: "* t\nI1 0 n1 1\nR1 n1 0\u00a02\nR2 n1 0 1\n.op\n.end\n" },
  { name: "resistor without a value", id: 'missing-value', severity: 'warning', line: 4, at: "R1", all: ["missing-value"], fixes: [], netlist: "* t\nV1 a 0 6\nR2 a 0 3\nR1 a 0\n.op\n.end\n" },
  { name: "voltage source without a value", id: 'missing-value', severity: 'warning', line: 2, at: "V1", all: ["missing-value"], fixes: ["Write 0 (a 0 V source: an ammeter)"], netlist: "* t\nV1 a 0\nR1 a 0 2\n.op\n.end\n" },
  { name: "current source without a value", id: 'missing-value', severity: 'warning', line: 2, at: "I1", all: ["missing-value"], fixes: [], netlist: "* t\nI1 0 a\nR1 a 0 2\n.op\n.end\n" },
  { name: "E without a gain", id: 'missing-value', severity: 'error', line: 4, at: "E1", all: ["missing-value"], fixes: [], netlist: "* t\nV1 c 0 3\nR1 c 0 1\nE1 a 0 c 0\nR2 a 0 1\n.op\n.end\n" },
  { name: "H without a value", id: 'missing-value', severity: 'error', line: 5, at: "H1", all: ["missing-value"], fixes: [], netlist: "* t\nV1 c 0 3\nVx c d 0\nR1 d 0 1\nH1 a 0 Vx\nR2 a 0 1\n.op\n.end\n" },
  { name: "resistor with one node", id: 'missing-fields', severity: 'warning', line: 4, at: "R1", all: ["missing-fields"], fixes: [], netlist: "* t\nV1 a 0 6\nR2 a 0 3\nR1 a\n.op\n.end\n" },
  { name: "voltage source with one node", id: 'missing-fields', severity: 'error', line: 2, at: "V1", all: ["missing-fields"], fixes: [], netlist: "* t\nV1 a\nR1 a 0 2\n.op\n.end\n" },
  { name: "E with three nodes", id: 'missing-fields', severity: 'error', line: 4, at: "E1", all: ["missing-fields"], fixes: [], netlist: "* t\nV1 c 0 3\nR1 c 0 1\nE1 a 0 2\nR2 a 0 1\n.op\n.end\n" },
  { name: "F with a number for its control source", id: 'missing-fields', severity: 'error', line: 4, at: "F1", all: ["missing-fields"], fixes: [], netlist: "* t\nV1 c 0 3\nR1 c 0 1\nF1 0 a 5\nR2 a 0 1\n.op\n.end\n" },
  { name: "F naming a missing source", id: 'control-source', severity: 'error', line: 4, at: "V9", all: ["control-source"], fixes: [], netlist: "* t\nV1 c 0 3\nR1 c 0 1\nF1 0 a V9 2\nR2 a 0 1\n.op\n.end\n" },
  { name: "F naming a resistor", id: 'control-source', severity: 'error', line: 4, at: "R1", all: ["control-source"], fixes: [], netlist: "* t\nV1 c 0 3\nR1 c 0 1\nF1 0 a R1 2\nR2 a 0 1\n.op\n.end\n" },
  { name: "H with a typo in its control source", id: 'control-source', severity: 'error', line: 5, at: "Vsens", all: ["control-source"], fixes: ["Use Vsense"], netlist: "* t\nV1 c 0 3\nVsense c d 0\nR1 d 0 1\nH1 a 0 Vsens 2\nR2 a 0 1\n.op\n.end\n" },
  { name: "a part on line 1", id: 'missing-title', severity: 'warning', line: 1, at: "V1", all: ["missing-title","dangling-node"], fixes: ["Add a title line above it"], netlist: "V1 n1 0 6\nR1 n1 0 2\n.op\n.end\n" },
  { name: ".op on line 1", id: 'missing-title', severity: 'warning', line: 1, at: ".op", all: ["missing-title"], fixes: ["Add a title line above it"], netlist: ".op\nV1 n1 0 6\nR1 n1 0 2\n.end\n" },
  { name: "no ground", id: 'no-ground', severity: 'error', line: 2, at: "b", all: ["no-ground"], fixes: ["Make b the ground (rename it to 0)"], netlist: "* t\nV1 a b 6\nR1 a b 2\n.op\n.end\n" },
  { name: "ground written ground", id: 'no-ground', severity: 'error', line: 2, at: "ground", all: ["no-ground"], fixes: ["Make ground the ground (rename it to 0)"], netlist: "* t\nV1 n1 ground 6\nR1 n1 ground 2\n.tf v(n1) V1\n.end\n" },
  { name: "ground next to 0", id: 'ground-misnamed', severity: 'warning', line: 2, at: "ground", all: ["ground-misnamed"], fixes: ["Rename ground to 0"], netlist: "* t\nV1 n1 ground 6\nR1 n1 0 2\n.op\n.end\n" },
  { name: "gnd as the last word", id: 'ground-misnamed', severity: 'warning', line: 4, at: "gnd", all: ["missing-value","ground-misnamed"], fixes: ["Rename gnd to 0"], netlist: "* t\nV1 a 0 6\nR1 a b 2\nVx b gnd\n.op\n.end\n" },
  { name: "00 next to 0", id: 'ground-misnamed', severity: 'warning', line: 2, at: "00", all: ["ground-misnamed"], fixes: ["Rename 00 to 0"], netlist: "* t\nV1 n1 00 6\nR1 n1 0 2\n.op\n.end\n" },
  { name: "a typo in a node name", id: 'dangling-node', severity: 'warning', line: 4, at: "n12", all: ["dangling-node"], fixes: ["Rename n12 to n2","Rename n12 to n1"], netlist: "* t\nV1 n1 0 6\nR1 n1 n2 2\nR2 n12 0 4\nI1 0 n2 3\n.op\n.end\n" },
  { name: "an open terminal (info)", id: 'dangling-node', severity: 'info', line: 5, at: "a", all: ["dangling-node"], fixes: [], netlist: "* t\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\nR3 n1 a 2\n.op\n.end\n" },
  { name: "a node between two capacitors", id: 'floating-dc', severity: 'error', line: 3, at: "b", all: ["floating-dc"], fixes: ["Add a 1 G\u03a9 resistor from b to ground"], netlist: "* t\nV1 a 0 6\nC1 a b 1u\nC2 b 0 1u\n.op\n.end\n" },
  { name: "a resistor with both ends floating", id: 'floating-dc', severity: 'error', line: 4, at: "n3", all: ["floating-dc"], fixes: [], netlist: "* t\nV1 n1 0 6\nR1 n1 0 2\nR2 n3 n4 3\n.op\n.end\n" },
  { name: "a floating control node", id: 'floating-dc', severity: 'error', line: 4, at: "c", all: ["floating-dc"], fixes: [], netlist: "* t\nV1 a 0 6\nR1 a 0 2\nE1 out 0 c 0 2\nR2 out 0 1\n.op\n.end\n" },
  { name: "a floating MOSFET gate", id: 'floating-dc', severity: 'error', line: 4, at: "g", all: ["floating-dc"], fixes: ["Add a 1 G\u03a9 resistor from g to ground"], netlist: "* t\nV1 d 0 5\nR1 d dd 1k\nM1 dd g 0 0 nm\n.model nm nmos level=1\n.op\n.end\n" },
  { name: "a current source and a capacitor", id: 'current-source-no-path', severity: 'error', line: 4, at: "I1", all: ["current-source-no-path"], fixes: [], netlist: "* t\nV1 a 0 5\nR1 a c 1k\nI1 c b 1m\nC1 b 0 1u\n.op\n.end\n" },
  { name: "two current sources in series", id: 'current-source-no-path', severity: 'error', line: 2, at: "I1", all: ["current-source-no-path"], fixes: [], netlist: "* t\nI1 0 n1 1m\nI2 n1 0 2m\nR1 n2 0 1k\nV1 n2 0 1\n.op\n.end\n" },
  { name: "a G output alone", id: 'current-source-no-path', severity: 'error', line: 4, at: "G1", all: ["current-source-no-path"], fixes: [], netlist: "* t\nV1 c 0 3\nR1 c 0 1\nG1 0 g c 0 0.5\n.op\n.end\n" },
  { name: "two voltage sources in parallel", id: 'voltage-loop', severity: 'error', line: 3, at: "V2", all: ["voltage-loop"], fixes: [], netlist: "* t\nV1 n1 0 5\nV2 n1 0 3\nR1 n1 0 1k\n.op\n.end\n" },
  { name: "a loop of three sources", id: 'voltage-loop', severity: 'error', line: 4, at: "V3", all: ["voltage-loop"], fixes: [], netlist: "* t\nV1 a 0 5\nV2 a b 2\nV3 b 0 3\nR1 a 0 1k\n.op\n.end\n" },
  { name: "an inductor across a source", id: 'voltage-loop', severity: 'error', line: 4, at: "L1", all: ["voltage-loop"], fixes: [], netlist: "* t\nV1 a 0 6\nR1 a 0 2\nL1 a 0 1m\n.op\n.end\n" },
  { name: "a source with both ends on one node", id: 'voltage-loop', severity: 'error', line: 4, at: "V2", all: ["voltage-loop"], fixes: [], netlist: "* t\nV1 a 0 6\nR1 a 0 2\nV2 a a 5\n.op\n.end\n" },
  { name: "two R1", id: 'duplicate-name', severity: 'error', line: 4, at: "R1", all: ["duplicate-name"], fixes: ["Rename it R2"], netlist: "* t\nV1 n1 0 6\nR1 n1 0 2\nR1 n1 0 4\n.op\n.end\n" },
  { name: "R1 and r1 with R2 taken", id: 'duplicate-name', severity: 'error', line: 5, at: "r1", all: ["duplicate-name"], fixes: ["Rename it r3"], netlist: "* t\nV1 n1 0 6\nR1 n1 0 2\nR2 n1 0 4\nr1 n1 0 4\n.op\n.end\n" },
  { name: "a line starting with a digit", id: 'unknown-letter', severity: 'error', line: 4, at: "2", all: ["unknown-letter"], fixes: ["Make the line a comment"], netlist: "* t\nV1 a 0 6\nR1 a 0 2\n2 resistors in parallel\nR2 a 0 2\n.op\n.end\n" },
  { name: "a line starting with @", id: 'unknown-letter', severity: 'error', line: 4, at: "@", all: ["unknown-letter"], fixes: ["Make the line a comment"], netlist: "* t\nV1 n1 0 6\nR2 n1 0 3\n@ note\nR1 n1 0 2\n.op\n.end\n" },
  { name: "an A line", id: 'unknown-letter', severity: 'error', line: 4, at: "A1", all: ["unknown-letter"], fixes: [], netlist: "* t\nV1 a 0 6\nR1 b 0 1k\nA1 a b gainmod\n.model gainmod gain(gain=2)\n.op\n.end\n" },
  { name: "W as a wire", id: 'unknown-letter', severity: 'error', line: 4, at: "W1", all: ["unknown-letter"], fixes: ["Use a 0 V source as the wire (VW1)"], netlist: "* t\nV1 a 0 6\nR1 b 0 2\nW1 a b\n.op\n.end\n" },
  { name: "T as a transformer", id: 'unknown-letter', severity: 'error', line: 4, at: "T1", all: ["unknown-letter"], fixes: [], netlist: "* t\nV1 a 0 6\nR1 b 0 2\nT1 a 0 b 0\n.op\n.end\n" },
  { name: "K as a constant", id: 'unknown-letter', severity: 'error', line: 4, at: "K1", all: ["unknown-letter"], fixes: [], netlist: "* t\nV1 a 0 6\nR1 a 0 2\nK1 a 0 5\n.op\n.end\n" },
  { name: "a diode without a model", id: 'missing-model', severity: 'error', line: 4, at: "D1", all: ["missing-model"], fixes: ["Add .model dmod D (a standard diode)"], netlist: "* t\nV1 a 0 6\nR1 a b 1k\nD1 b 0\n.op\n.end\n" },
  { name: "a diode naming a missing model", id: 'missing-model', severity: 'error', line: 4, at: "dmod", all: ["missing-model"], fixes: ["Add .model dmod D (a standard diode)"], netlist: "* t\nV1 a 0 6\nR1 a b 1k\nD1 b 0 dmod\n.op\n.end\n" },
  { name: "a BJT naming a missing model", id: 'missing-model', severity: 'error', line: 5, at: "qmod", all: ["missing-model"], fixes: [], netlist: "* t\nV1 a 0 6\nR1 a c 1k\nR2 a b 100k\nQ1 c b 0 qmod\n.op\n.end\n" },
  { name: "an X line with no .subckt", id: 'missing-subcircuit', severity: 'error', line: 4, at: "amp", all: ["missing-subcircuit"], fixes: [], netlist: "* t\nV1 a 0 6\nR1 a b 1k\nX1 b 0 amp\n.op\n.end\n" },
  { name: "a BSIM3 MOSFET", id: 'model-not-in-engine', severity: 'error', line: 4, at: "nm", all: ["model-not-in-engine"], fixes: [], netlist: "* t\nV1 d 0 1\nV2 g 0 1\nM1 d g 0 0 nm l=1u w=1u\n.model nm nmos level=49\n.op\n.end\n" },
  { name: "an O line", id: 'model-not-in-engine', severity: 'error', line: 4, at: "O1", all: ["model-not-in-engine"], fixes: [], netlist: "* t\nV1 a 0 1\nRs a b 1\nO1 b 0 c 0 lmod\nRl c 0 1\n.model lmod ltra r=1 l=1n g=0 c=1p len=1\n.op\n.end\n" },
  { name: ".dc with a zero step", id: 'dc-sweep-problems', severity: 'error', line: 5, at: "0", all: ["dc-sweep-problems"], fixes: ["Use a step of 1.2 (10 steps)"], netlist: "* t\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 0 12 0\n.end\n" },
  { name: ".dc without a step", id: 'dc-sweep-problems', severity: 'error', line: 5, at: "V1 0 12", all: ["dc-sweep-problems"], fixes: ["Add a step of 1.2 (10 steps)"], netlist: "* t\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 0 12\n.end\n" },
  { name: ".dc with start above stop", id: 'dc-sweep-problems', severity: 'error', line: 5, at: "12 0 1", all: ["dc-sweep-problems"], fixes: ["Swap them: from 0 to 12","Go down: make the step -1"], netlist: "* t\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 12 0 1\n.end\n" },
  { name: ".dc with a negative step", id: 'dc-sweep-problems', severity: 'error', line: 5, at: "-1", all: ["dc-sweep-problems"], fixes: ["Make the step 1"], netlist: "* t\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 0 12 -1\n.end\n" },
  { name: ".dc with a step bigger than the range", id: 'dc-sweep-problems', severity: 'warning', line: 5, at: "20", all: ["dc-sweep-problems"], fixes: ["Use a step of 1.2 (10 steps)"], netlist: "* t\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 0 12 20\n.end\n" },
  { name: ".dc of a missing source", id: 'dc-sweep-problems', severity: 'error', line: 5, at: "V9", all: ["dc-sweep-problems"], fixes: ["Sweep V1 instead"], netlist: "* t\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V9 0 12 1\n.end\n" },
  { name: ".tran with one number", id: 'tran-problems', severity: 'error', line: 5, at: "5m", all: ["tran-problems"], fixes: ["Use 5m as the stop time: .tran 50u 5m"], netlist: "* t\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran 5m\n.end\n" },
  { name: ".tran with a zero step", id: 'tran-problems', severity: 'error', line: 5, at: "0", all: ["tran-problems"], fixes: ["Use a step of 50u"], netlist: "* t\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran 0 5m\n.end\n" },
  { name: ".tran with the start after the stop", id: 'tran-problems', severity: 'error', line: 5, at: "6m", all: ["tran-problems"], fixes: ["Remove the start time 6m"], netlist: "* t\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m 6m\n.end\n" },
  { name: ".tran with a step longer than the run (info)", id: 'tran-problems', severity: 'info', line: 5, at: "1", all: ["tran-problems"], fixes: ["Use a step of 50u (a hundredth of 5m)"], netlist: "* t\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran 1 5m\n.end\n" },
  { name: ".tf of a missing node", id: 'tf-problems', severity: 'error', line: 5, at: "n9", all: ["tf-problems"], fixes: [], netlist: "* t\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\n.tf v(n9) V1\n.end\n" },
  { name: ".tf of a node typo", id: 'tf-problems', severity: 'error', line: 5, at: "outt", all: ["tf-problems"], fixes: ["Use out"], netlist: "* t\nV1 s 0 24\nR1 s out 6\nR2 out 0 3\n.tf v(outt) V1\n.end\n" },
  { name: ".tf of a missing source", id: 'tf-problems', severity: 'error', line: 5, at: "V9", all: ["tf-problems"], fixes: ["Use V1"], netlist: "* t\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\n.tf v(n1) V9\n.end\n" },
  { name: ".tf with a resistor as input", id: 'tf-problems', severity: 'error', line: 5, at: "R1", all: ["tf-problems"], fixes: ["Use V1"], netlist: "* t\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\n.tf v(n1) R1\n.end\n" },
  { name: ".tf of i(R1)", id: 'tf-problems', severity: 'error', line: 5, at: "R1", all: ["tf-problems"], fixes: [], netlist: "* t\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\n.tf i(R1) V1\n.end\n" },
  { name: ".tf without a source", id: 'tf-problems', severity: 'error', line: 5, at: ".tf v(n1)", all: ["tf-problems"], fixes: ["Use V1 as the input"], netlist: "* t\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\n.tf v(n1)\n.end\n" },
  { name: "no analysis", id: 'no-analysis', severity: 'error', line: 4, at: ".end", all: ["no-analysis"], fixes: ["Add .op before .end"], netlist: "* t\nV1 a 0 6\nR1 a 0 2\n.end\n" },
  { name: "no analysis and no .end", id: 'no-analysis', severity: 'error', line: 3, at: "R1", all: ["no-analysis","missing-end"], fixes: ["Add .op at the end"], netlist: "* t\nV1 a 0 6\nR1 a 0 2\n" },
  { name: "no .end", id: 'missing-end', severity: 'info', line: 4, at: ".op", all: ["missing-end"], fixes: ["Add .end at the bottom"], netlist: "* t\nV1 n1 0 6\nR1 n1 0 2\n.op\n" },
  { name: "a part after .end", id: 'after-end', severity: 'warning', line: 6, at: "R1 n1 0 2", all: ["after-end"], fixes: ["Move .end to the bottom"], netlist: "* t\nV1 n1 0 6\nR2 n1 0 3\n.op\n.end\nR1 n1 0 2\n" },
  { name: "a part after .end;comment", id: 'after-end', severity: 'warning', line: 6, at: "R1 n1 0 2", all: ["after-end"], fixes: ["Move .end to the bottom"], netlist: "* t\nV1 n1 0 6\nR2 n1 0 3\n.op\n.end;the end\nR1 n1 0 2\n" },
  { name: "a 0 ohm resistor", id: 'zero-ohm', severity: 'warning', line: 3, at: "0", all: ["zero-ohm"], fixes: ["Use a 0 V source instead (VR1)"], netlist: "* t\nV1 a 0 6\nR1 a b 0\nR2 b 0 2\n.op\n.end\n" },
  // zero-ohm-2: straight across a 6 V source the current has no finite answer, so an error, and no fix.
  { name: "a 0 ohm resistor across a source (no fix)", id: 'zero-ohm', severity: 'error', line: 3, at: "0", all: ["zero-ohm"], fixes: [], netlist: "* t\nV1 a 0 6\nR1 a 0 0\n.op\n.end\n" },
  // Across a 0 V source (or an inductor) the voltage is 0, so the current is 0: only the warning.
  { name: "a 0 ohm resistor across a 0 V source", id: 'zero-ohm', severity: 'warning', line: 4, at: "0", all: ["zero-ohm"], fixes: [], netlist: "* t\nV1 a 0 6\nVx a b 0\nR1 a b 0\nR2 b 0 2\n.op\n.end\n" },
  { name: "an unclosed brace", id: 'fatal-syntax', severity: 'error', line: 3, at: "{1k", all: ["fatal-syntax"], fixes: ["Close it: {1k}"], netlist: "* t\nV1 a 0 1\nR1 a 0 {1k\n.op\n.end\n" },
  { name: "an unclosed quote", id: 'fatal-syntax', severity: 'error', line: 3, at: "'2*3", all: ["fatal-syntax"], fixes: ["Close it: '2*3'"], netlist: "* t\nV1 a 0 1\nR1 a 0 '2*3\n.op\n.end\n" },
  { name: "an undefined parameter", id: 'fatal-syntax', severity: 'error', line: 3, at: "{rx}", all: ["fatal-syntax"], fixes: [], netlist: "* t\nV1 a 0 1\nR1 a 0 {rx}\n.op\n.end\n" },
  { name: "pi in braces", id: 'fatal-syntax', severity: 'error', line: 3, at: "{2*pi}", all: ["fatal-syntax"], fixes: ["Add .param pi=3.141592653589793"], netlist: "* t\nI1 0 a 1\nR1 a 0 {2*pi}\n.op\n.end\n" },
  { name: "a B line without V=", id: 'fatal-syntax', severity: 'error', line: 4, at: "B1", all: ["fatal-syntax"], fixes: [], netlist: "* t\nV1 a 0 1\nR1 a 0 1\nB1 b 0 5\nR2 b 0 1\n.op\n.end\n" },
  { name: ".include", id: 'include-not-available', severity: 'error', line: 4, at: ".include", all: ["include-not-available"], fixes: [], netlist: "* t\nV1 a 0 1\nR1 a 0 1\n.include models.lib\n.op\n.end\n" },
  { name: ".lib with a file", id: 'include-not-available', severity: 'error', line: 4, at: ".lib", all: ["include-not-available"], fixes: [], netlist: "* t\nV1 a 0 1\nR1 a 0 1\n.lib models.lib tt\n.op\n.end\n" },
  { name: "a + line lost in a ; comment", id: 'lost-continuation', severity: 'warning', line: 6, at: "+", all: ["missing-value","lost-continuation"], fixes: ["Make the comment start with *"], netlist: "* t\nI1 0 n1 1\nR0 n1 0 1k\nR1 n1 0\n; a comment\n+ 2\n.op\n.end\n" },
  { name: "a + line after the title", id: 'lost-continuation', severity: 'warning', line: 2, at: "+", all: ["lost-continuation"], fixes: ["Remove the +"], netlist: "* t\n+ R1 n1 0 2\nI1 0 n1 1\nR2 n1 0 4\n.op\n.end\n" },
  // Added by the core review of 10 Nov 2026 (docs/spice-facts/review.md).
  { name: "F naming a B source with I=", id: 'control-source', severity: 'error', line: 5, at: "B1", all: ["control-source"], fixes: [], netlist: "* t\nV1 a 0 6\nB1 0 b I=v(a)/6\nRb b 0 6\nF1 0 p B1 1\nRp p 0 1\n.op\n.end\n" },
  { name: "a word after a resistor value", id: 'unknown-word', severity: 'error', line: 3, at: "load", all: ["unknown-word"], fixes: ["Make load and the rest of the line a comment"], netlist: "* t\nV1 a 0 5\nR1 a 0 1k load\n.op\n.end\n" },
  { name: "a word after a voltage source value", id: 'unknown-word', severity: 'error', line: 2, at: "battery", all: ["unknown-word"], fixes: ["Make battery and the rest of the line a comment"], netlist: "* t\nV1 a 0 5 battery\nR1 a 0 1k\n.op\n.end\n" },
  { name: "1d-3 on a voltage source", id: 'unknown-word', severity: 'error', line: 2, at: "-3", all: ["unknown-word"], fixes: ["Write 1e-3"], netlist: "* t\nV1 n1 0 1d-3\nR1 n1 0 1\n.op\n.end\n" },
  { name: "a third number on a resistor", id: 'unknown-word', severity: 'error', line: 3, at: "3k", all: ["unknown-word"], fixes: [], netlist: "* t\nV1 a 0 5\nR1 a 0 1k 2k 3k\n.op\n.end\n" },
  { name: "a value a resistor can only report", id: 'unknown-word', severity: 'error', line: 3, at: "i", all: ["unknown-word"], fixes: ["Make i and the rest of the line a comment"], netlist: "* t\nI1 0 n1 1\nR1 n1 0 1k i\n.op\n.end\n" },
  { name: "a number after a gain", id: 'unknown-word', severity: 'error', line: 4, at: "3", all: ["unknown-word"], fixes: [], netlist: "* t\nV1 a 0 1\nR0 a 0 1\nE1 b 0 a 0 2 3\nR1 b 0 1\n.op\n.end\n" },
  { name: "a misspelt .tran", id: 'unknown-dot-command', severity: 'error', line: 4, at: ".tarn", all: ["unknown-dot-command"], fixes: ["Use .tran", "Make the line a comment"], netlist: "* t\nV1 a 0 1\nR1 a 0 1k\n.tarn 1u 1m\n.op\n.end\n" },
  { name: ".pss, unknown to ngspice 47 as built", id: 'unknown-dot-command', severity: 'error', line: 4, at: ".pss", all: ["unknown-dot-command"], fixes: ["Make the line a comment"], netlist: "* t\nV1 a 0 1\nR1 a 0 1k\n.pss 1k 1m a 1\n.op\n.end\n" },
  // After the final reviews (12 November 2026): names ngspice spells with underscores (kept review F3).
  { name: "a node name with a Turkish letter", id: 'non-ascii-node', severity: 'warning', line: 2, at: "giri\u015f", all: ["non-ascii-node", "non-ascii-node"], fixes: ["Rename giri\u015f to giris"], netlist: "* t\nV1 giri\u015f 0 12\nR1 giri\u015f \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 2k\n.op\n.end\n" },
  { name: "two node names ngspice spells the same", id: 'non-ascii-node', severity: 'error', line: 3, at: "\u00e7", all: ["non-ascii-node"], fixes: ["Write s for \u015f and c for \u00e7"], netlist: "* t\nV1 \u015f 0 12\nR1 \u015f \u00e7 1k\nR2 \u00e7 0 2k\n.op\n.end\n" },
  // Characters that are not what they look like (security review F2).
  { name: "a zero-width space inside a value", id: 'invisible-character', severity: 'warning', line: 3, at: "1​k", all: ["invisible-character"], fixes: ["Write 1k (1 kΩ)"], netlist: "* t\nV1 in 0 6\nR1 in out 1​k\nR2 out 0 2k\n.op\n.end\n" },
  { name: "a zero-width space inside a node name", id: 'invisible-character', severity: 'warning', line: 4, at: "ou​t", all: ["invisible-character"], fixes: ["Take it out: connect to out"], netlist: "* t\nV1 in 0 6\nR1 in out 1k\nR2 ou​t 0 2k\n.op\n.end\n" },
  { name: "a zero-width space before a value", id: 'invisible-character', severity: 'error', line: 3, at: "​2k", all: ["invisible-character"], fixes: ["Write 2k (2 kΩ)"], netlist: "* t\nI1 0 a 1\nR1 a 0 ​2k\n.op\n.end\n" },
  { name: "a Cyrillic k in a value", id: 'look-alike-letter', severity: 'warning', line: 3, at: "1к", all: ["look-alike-letter"], fixes: ["Write 1k (1 kΩ)"], netlist: "* t\nI1 0 n1 1\nR1 n1 0 1к\n.op\n.end\n" },
  { name: "a minus sign from a document", id: 'look-alike-letter', severity: 'error', line: 2, at: "−5", all: ["look-alike-letter"], fixes: ["Write -5 (−5 V)"], netlist: "* t\nV1 a 0 −5\nR1 a 0 1k\n.op\n.end\n" },
  { name: "a Greek capital Mu typed for mega", id: 'look-alike-letter', severity: 'warning', line: 3, at: "10\u039c", all: ["look-alike-letter"], fixes: ["Make it 10meg (10\u00a0M\u03a9)", "Make it 10m (10\u00a0m\u03a9)"], netlist: "* t\nI1 0 a 1u\nR1 a 0 10\u039c\n.op\n.end\n" },
  { name: "a Cyrillic o in a node name", id: 'look-alike-letter', severity: 'warning', line: 4, at: "\u043eut", all: ["look-alike-letter"], fixes: ["Connect to out"], netlist: "* t\nV1 in 0 6\nR1 in out 1k\nR2 \u043eut 0 2k\n.op\n.end\n" },
  { name: "a zero-width space right after a minus sign", id: 'invisible-character', severity: 'error', line: 2, at: "-\u200b5", all: ["invisible-character"], fixes: ["Write -5 (\u22125\u00a0V)"], netlist: "* t\nV1 a 0 -\u200b5\nR1 a 0 1k\n.op\n.end\n" },
  { name: "a thin space between a value and its unit", id: 'space-character', severity: 'warning', line: 3, at: "4.7\u2009k\u03a9", all: ["space-character"], fixes: ["Write 4.7k (4.7\u00a0k\u03a9)"], netlist: "* t\nV1 in 0 10\nR1 in out 4.7\u2009k\u03a9\nR2 out 0 4.7k\n.op\n.end\n" },
  { name: "a thin space between two words", id: 'space-character', severity: 'warning', line: 3, at: "0\u20092", all: ["missing-value", "space-character"], fixes: ["Replace it with a normal space"], netlist: "* t\nI1 0 n1 1\nR1 n1 0\u20092\nR2 n1 0 1\n.op\n.end\n" },
  { name: "a thin space before a value", id: 'space-character', severity: 'error', line: 4, at: "\u20092k", all: ["space-character"], fixes: ["Write 2k (2\u00a0k\u03a9)"], netlist: "* t\nI1 0 a 1\nR0 a 0 1k\nR1 a 0 \u20092k\n.op\n.end\n" },
  { name: "a no-break space between a value and its unit", id: 'nbsp', severity: 'warning', line: 3, at: "4.7\u00a0k\u03a9", all: ["nbsp"], fixes: ["Write 4.7k (4.7\u00a0k\u03a9)"], netlist: "* t\nV1 in 0 10\nR1 in out 4.7\u00a0k\u03a9\nR2 out 0 4.7k\n.op\n.end\n" },
  { name: "two part names ngspice spells the same", id: 'duplicate-name', severity: 'error', line: 4, at: "R\u00e7", all: ["duplicate-name"], fixes: ["Rename it Rc"], netlist: "* t\nV1 a 0 6\nR\u015f a 0 2\nR\u00e7 a 0 3\n.op\n.end\n" },
];

describe('each trap fires on a minimal netlist', () => {
  it.each(CASES)('$id: $name', (c) => {
    const found = traps(c.netlist);
    expect(found.map((t) => t.id)).toEqual(c.all);
    const t = found.find((x) => x.id === c.id);
    expect(t, `no ${c.id}`).toBeDefined();
    expect(t!.severity).toBe(c.severity);
    expect(t!.line).toBe(c.line);
    expect(c.netlist.slice(t!.span.from, t!.span.to)).toBe(c.at);
    expect(t!.fixes.map((f) => f.label)).toEqual(c.fixes);
  });

  it('covers every trap id', () => {
    expect(new Set(CASES.map((c) => c.id))).toEqual(new Set(TRAP_IDS));
  });

  it.each(CASES)('$id: $name: a short title, a why of 1-3 sentences, and the evidence cited', (c) => {
    const t = traps(c.netlist).find((x) => x.id === c.id)!;
    expect(t.title.length).toBeLessThanOrEqual(72);
    expect(t.title).not.toMatch(/\.$/);
    const sentences = t.why.match(/[.?!](?=\s|$)/g) ?? [];
    expect(sentences.length, t.why).toBeGreaterThanOrEqual(1);
    expect(sentences.length, t.why).toBeLessThanOrEqual(3);
    expect(t.ngspice).toMatch(/\[[a-z-]+-\d+/);
  });
});

describe('every fix removes its trap and adds no new error or warning', () => {
  const all = CASES.flatMap((c) => c.fixes.map((label, k) => ({ ...c, label, k })));

  it.each(all)('$id: $name: $label', (c) => {
    const before = traps(c.netlist);
    const trap = before.find((t) => t.id === c.id)!;
    const after = traps(applyFix(c.netlist, trap.fixes[c.k]!));
    expect(count(after, c.id)).toBeLessThan(count(before, c.id));
    for (const severity of ['error', 'warning'] as const) {
      for (const id of new Set(after.map((t) => t.id))) {
        expect(count(after, id, severity), `${severity}: ${id}`).toBeLessThanOrEqual(count(before, id, severity));
      }
    }
  });

  it('fixes are sorted, do not overlap and stay inside the text', () => {
    for (const c of CASES) {
      for (const t of traps(c.netlist)) {
        for (const f of t.fixes) {
          f.changes.forEach((x, k) => {
            expect(x.from).toBeGreaterThanOrEqual(0);
            expect(x.to).toBeLessThanOrEqual(c.netlist.length);
            expect(x.from).toBeLessThanOrEqual(x.to);
            if (k > 0) expect(x.from).toBeGreaterThanOrEqual(f.changes[k - 1]!.to);
          });
        }
      }
    }
  });
});

/** [case, fix index, the whole netlist after the fix]. */
const FIXED: [string, number, string][] = [
  ["1M on a resistor", 0, "* t\nV1 n1 0 6\nR1 n1 n2 1meg\nR2 n2 0 1meg\n.op\n.end\n"],
  ["1M on a resistor", 1, "* t\nV1 n1 0 6\nR1 n1 n2 1m\nR2 n2 0 1meg\n.op\n.end\n"],
  ["3A on a current source", 0, "* t\nI1 0 n1 3\nR1 n1 0 4\n.op\n.end\n"],
  ["Greek mu on a resistor", 0, "* t\nI1 0 n1 1\nR1 n1 0 4.7u\n.op\n.end\n"],
  ["2k2", 0, "* t\nI1 0 n1 1\nR1 n1 0 2.2k\n.op\n.end\n"],
  ["1,5k on a resistor", 0, "* t\nI1 0 n1 1\nR1 n1 0 1.5k\n.op\n.end\n"],
  ["1 M on a resistor", 0, "* t\nI1 0 n1 1\nR1 n1 0 1meg\n.op\n.end\n"],
  ["10 kOhm on a resistor", 0, "* t\nI1 0 n1 1\nR1 n1 0 10k\n.op\n.end\n"],
  ["* after a value", 0, "* t\nI1 0 n1 1\nR1 n1 0 2 ; load\n.op\n.end\n"],
  ["no-break space", 0, "* t\nI1 0 n1 1\nR1 n1 0 2\nR2 n1 0 1\n.op\n.end\n"],
  ["voltage source without a value", 0, "* t\nV1 a 0 0\nR1 a 0 2\n.op\n.end\n"],
  ["H with a typo in its control source", 0, "* t\nV1 c 0 3\nVsense c d 0\nR1 d 0 1\nH1 a 0 Vsense 2\nR2 a 0 1\n.op\n.end\n"],
  ["a part on line 1", 0, "* my circuit\nV1 n1 0 6\nR1 n1 0 2\n.op\n.end\n"],
  ["no ground", 0, "* t\nV1 a 0 6\nR1 a 0 2\n.op\n.end\n"],
  ["gnd as the last word", 0, "* t\nV1 a 0 6\nR1 a b 2\nVx b 0\n.op\n.end\n"],
  ["a typo in a node name", 0, "* t\nV1 n1 0 6\nR1 n1 n2 2\nR2 n2 0 4\nI1 0 n2 3\n.op\n.end\n"],
  ["a node between two capacitors", 0, "* t\nV1 a 0 6\nC1 a b 1u\nC2 b 0 1u\nRdc1 b 0 1g\n.op\n.end\n"],
  ["R1 and r1 with R2 taken", 0, "* t\nV1 n1 0 6\nR1 n1 0 2\nR2 n1 0 4\nr3 n1 0 4\n.op\n.end\n"],
  ["a line starting with a digit", 0, "* t\nV1 a 0 6\nR1 a 0 2\n* 2 resistors in parallel\nR2 a 0 2\n.op\n.end\n"],
  ["W as a wire", 0, "* t\nV1 a 0 6\nR1 b 0 2\nVW1 a b 0\n.op\n.end\n"],
  ["a diode without a model", 0, "* t\nV1 a 0 6\nR1 a b 1k\nD1 b 0 dmod\n.model dmod D\n.op\n.end\n"],
  [".dc with start above stop", 0, "* t\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 0 12 1\n.end\n"],
  [".dc with start above stop", 1, "* t\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 12 0 -1\n.end\n"],
  [".dc without a step", 0, "* t\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 0 12 1.2\n.end\n"],
  [".tran with one number", 0, "* t\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran 50u 5m\n.end\n"],
  [".tran with the start after the stop", 0, "* t\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m\n.end\n"],
  ["no analysis", 0, "* t\nV1 a 0 6\nR1 a 0 2\n.op\n.end\n"],
  ["no analysis and no .end", 0, "* t\nV1 a 0 6\nR1 a 0 2\n.op\n"],
  ["no .end", 0, "* t\nV1 n1 0 6\nR1 n1 0 2\n.op\n.end\n"],
  ["a part after .end", 0, "* t\nV1 n1 0 6\nR2 n1 0 3\n.op\nR1 n1 0 2\n.end\n"],
  ["a 0 ohm resistor", 0, "* t\nV1 a 0 6\nVR1 a b 0\nR2 b 0 2\n.op\n.end\n"],
  ["an unclosed brace", 0, "* t\nV1 a 0 1\nR1 a 0 {1k}\n.op\n.end\n"],
  ["pi in braces", 0, "* t\n.param pi=3.141592653589793\nI1 0 a 1\nR1 a 0 {2*pi}\n.op\n.end\n"],
  ["a + line lost in a ; comment", 0, "* t\nI1 0 n1 1\nR0 n1 0 1k\nR1 n1 0\n* a comment\n+ 2\n.op\n.end\n"],
  ["a + line after the title", 0, "* t\n R1 n1 0 2\nI1 0 n1 1\nR2 n1 0 4\n.op\n.end\n"],
  [".tf without a source", 0, "* t\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\n.tf v(n1) V1\n.end\n"],
];

describe('what the fixes write', () => {
  it.each(FIXED)('%s, fix %i', (name, k, expected) => {
    const c = CASES.find((x) => x.name === name)!;
    const t = traps(c.netlist).find((x) => x.id === c.id)!;
    expect(applyFix(c.netlist, t.fixes[k]!)).toBe(expected);
  });

  it('applies changes given in any order against the original text', () => {
    const text = 'abc def ghi';
    const fix = { label: 'x', changes: [{ from: 8, to: 11, insert: 'G' }, { from: 0, to: 3, insert: 'ABCD' }, { from: 4, to: 4, insert: '+' }] };
    expect(applyFix(text, fix)).toBe('ABCD +def G');
  });
});

describe('choices that keep correct circuits quiet', () => {
  it('a lower-case m on a resistor is milli on purpose: no trap', () => {
    expect(ids('* t\nI1 0 n1 1\nR1 n1 0 10m\n.op\n.end\n')).toEqual([]);
  });

  it('100mA and 10uF are fine: the letters after the scale letter are ignored', () => {
    expect(ids('* t\nI1 0 n1 100mA\nR1 n1 0 1\nC1 n1 0 10uF\n.op\n.end\n')).toEqual([]);
  });

  it('the micro sign works: no trap', () => {
    expect(ids('* t\nI1 0 n1 1\nR1 n1 0 4.7\u00b5\n.op\n.end\n')).toEqual([]);
  });

  it('1k0 is the same in resistor code and in SPICE: no trap', () => {
    expect(ids('* t\nI1 0 n1 1\nR1 n1 0 1k0\n.op\n.end\n')).toEqual([]);
  });

  it('commas between source-function arguments are fine', () => {
    expect(ids('* t\nV1 in 0 PULSE(0,5,0,1u,1u,1,2)\nR1 in 0 1k\n.tran 10u 1m\n.end\n')).toEqual([]);
  });

  it('a voltage-source output left open is a measurement, not a dangling node', () => {
    expect(ids('* t\nVc c 0 3\nE1 out1 0 c 0 2\nRc c 0 1k\n.op\n.end\n')).toEqual([]);
  });

  it('an open terminal named in a directive is deliberate: no note', () => {
    expect(ids('* t\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\nR3 n1 a 2\n.tf v(a) V1\n.end\n')).toEqual([]);
  });

  it('numbered nodes one digit apart are not typos', () => {
    const t = traps('* t\nV1 n1 0 6\nR1 n1 n2 2\nR2 n2 0 4\nR3 n2 n3 1\n.op\n.end\n');
    expect(t.map((x) => [x.id, x.severity])).toEqual([['dangling-node', 'info']]);
  });

  it('with .tran ... uic a capacitor-only node and an inductor across a source are fine', () => {
    expect(ids('* t\nV1 a 0 6\nC1 a b 1u\nC2 b 0 1u\n.tran 1u 10u uic\n.end\n')).toEqual([]);
    expect(ids('* t\nV1 a 0 6\nR1 a 0 2\nL1 a 0 1m\n.tran 1u 10u uic\n.end\n')).toEqual([]);
  });

  it('but two voltage sources in parallel fail with uic too', () => {
    expect(ids('* t\nV1 a 0 5\nV2 a 0 3\nR1 a 0 1k\n.tran 1u 10u uic\n.end\n')).toEqual(['voltage-loop']);
  });

  it('an inductor in series is fine; two inductors in parallel are a loop at DC', () => {
    expect(ids('* t\nV1 a 0 6\nL1 a b 1m\nR1 b 0 2\n.op\n.end\n')).toEqual([]);
    expect(ids('* t\nV1 a 0 6\nR1 a b 2\nL1 b 0 1m\nL2 b 0 2m\n.op\n.end\n')).toEqual(['voltage-loop']);
  });

  it('a .model the netlist does not use is harmless, even when PlainSpice lacks it', () => {
    expect(ids('* t\nV1 a 0 1\nR1 a 0 1\n.model nm nmos level=49\n.op\n.end\n')).toEqual([]);
  });

  it('parts with their models, subcircuits and parameters raise nothing', () => {
    const netlist = [
      '* t', '.param rload=2k', '.subckt div in out', 'R1 in out 1k', 'R2 out 0 1k', '.ends',
      'V1 a 0 5', 'X1 a b div', 'R3 b 0 {rload}', 'D1 b c dmod', 'R4 c 0 1k', 'Q1 c b 0 qmod', 'M1 c b 0 0 nm',
      '.model dmod D', '.model qmod NPN', '.model nm NMOS level=1', '.op', '.end',
    ].join('\n');
    expect(ids(`${netlist}\n`)).toEqual([]);
  });

  it('temper, hertz and time are known inside braces', () => {
    expect(ids('* t\nI1 0 a 1\nR1 a 0 {1+temper}\n.op\n.end\n')).toEqual([]);
  });

  it('names inside a subcircuit are local: the same name outside is no duplicate', () => {
    const netlist = '* t\n.subckt div in out\nR1 in out 1k\nR2 out 0 1k\n.ends\nV1 a 0 5\nR1 a b 1k\nX1 b c div\nR5 c 0 1k\n.op\n.end\n';
    expect(ids(netlist)).toEqual([]);
    expect(ids(netlist.replace('R2 out 0 1k', 'r1 out 0 1k'))).toEqual(['duplicate-name']);
  });

  it('a dc sweep of temp or a resistor is fine, and so is a downward sweep', () => {
    expect(ids('* t\nV1 in 0 1\nR1 in 0 1k\n.dc temp 0 50 25\n.end\n')).toEqual([]);
    expect(ids('* t\nV1 in 0 1\nR1 in 0 1k\n.dc R1 1k 3k 1k\n.end\n')).toEqual([]);
    expect(ids('* t\nV1 in 0 0\nR1 in 0 1k\n.dc V1 12 0 -1\n.end\n')).toEqual([]);
  });
});

describe('correct netlists stay quiet', () => {
  const fixturesDir = join(root, 'tests/fixtures');
  const fixtures = readdirSync(fixturesDir).filter((f) => f.endsWith('.cir')).sort();

  it.each(fixtures)('tests/fixtures/%s: only f3a-1M-trap has a trap (mega-as-milli)', (file) => {
    const text = readFileSync(join(fixturesDir, file), 'utf8');
    expect(ids(text)).toEqual(file === 'f3a-1M-trap.cir' ? ['mega-as-milli'] : []);
  });
});

/** The research netlists of every trap (tests/corpus/traps; native ngspice output in docs/research/native-traps.md). */
const CORPUS: Record<string, string[]> = {
  T01a_1M_megaohm: ['mega-as-milli'],
  T01b_1MOhm: ['mega-as-milli'],
  T02_3A_current_source: ['unit-letter'],
  T03a_no_ground: ['no-ground'],
  T03b_gnd_lower: [],
  T03c_GND_upper: [],
  T03d_ground_word: ['no-ground'],
  T03e_Gnd_mixed: [],
  T03f_double_zero: ['no-ground'],
  T03g_ground_and_zero: ['ground-misnamed'],
  T04a_dangling_resistor: ['dangling-node'],
  T04b_floating_resistor: ['floating-dc'],
  T05a_isrc_series_cap: ['current-source-no-path'],
  T05b_isrc_into_cap_node: ['current-source-no-path'],
  T05c_two_isrc_series: ['current-source-no-path'],
  T05d_two_equal_isrc_series: ['current-source-no-path'],
  T05e_isrc_only_node: ['current-source-no-path'],
  T06a_vsrc_parallel_different: ['voltage-loop'],
  T06b_vsrc_shorted_by_0V: ['voltage-loop'],
  T06c_vsrc_parallel_equal: ['voltage-loop'],
  T07a_duplicate_R1: ['duplicate-name'],
  T07b_R1_and_r1: ['duplicate-name'],
  T07c_duplicate_V1: ['duplicate-name'],
  T07d_duplicate_R1_different_nodes: ['duplicate-name'],
  T09a_missing_value_R: ['missing-value'],
  T09b_missing_value_V: ['missing-value'],
  T09c_missing_value_I: ['missing-value'],
  T09d_missing_value_C: ['missing-value'],
  T10a_decimal_comma_R: ['decimal-comma'],
  T10b_decimal_comma_V: ['decimal-comma'],
  T10c_decimal_comma_I: ['decimal-comma'],
  T11a_missing_end: ['missing-end'],
  T11b_missing_title: ['missing-title', 'dangling-node'],
  T11c_missing_title_resistor_first: ['missing-title'],
  T11d_blank_first_line: [],
  T11e_lines_after_end: ['after-end'],
  T12a_tf_missing_source: ['tf-problems'],
  T12b_tf_missing_node: ['tf-problems'],
  T12c_tf_resistor_as_input: ['tf-problems'],
  T13_node_case: [],
  T14a_zero_ohm: ['zero-ohm'],
  T14b_zero_ohm_alone: ['zero-ohm'],
  T15a_cap_only_node: ['floating-dc'],
  T15b_cap_only_node_with_r: ['floating-dc'],
  T16_unknown_node_in_print: [],
  T19_at_sign_line: ['unknown-letter'],
  T20a_dc_step_zero: ['dc-sweep-problems'],
  T20b_dc_step_negative: ['dc-sweep-problems'],
  T20c_dc_start_gt_stop: ['dc-sweep-problems'],
  T20d_dc_missing_step: ['dc-sweep-problems'],
  T20e_dc_unknown_source: ['dc-sweep-problems'],
  T20f_dc_step_too_big: ['dc-sweep-problems'],
  T21a_tran_one_arg: ['tran-problems'],
  T21b_tran_zero_step: ['tran-problems'],
  T21c_tran_step_gt_stop: ['tran-problems'],
  T21d_tran_tstart_gt_tstop: ['tran-problems'],
  T21e_no_analysis: ['no-analysis'],
};

describe('the research netlists (tests/corpus/traps)', () => {
  const dir = join(root, 'tests/corpus/traps');
  const files = readdirSync(dir).filter((f) => f.endsWith('.cir')).sort();

  it('has an expectation for every file', () => {
    expect(files.map((f) => basename(f, '.cir')).sort()).toEqual(Object.keys(CORPUS).sort());
  });

  it.each(files)('%s', (file) => {
    expect(ids(readFileSync(join(dir, file), 'utf8'))).toEqual(CORPUS[basename(file, '.cir')]);
  });
});

/** The first-letter netlists (tests/corpus/letters): a two-node line starting with each character. */
const LETTERS: Record<string, string[]> = {
  L00: ['unknown-letter'], L01: ['fatal-syntax'], L02: [], L03: ['missing-model'], L04: ['missing-fields'], L05: ['missing-fields'],
  L06: ['missing-fields'], L07: ['missing-fields'], L08: [], L09: ['missing-model'], L10: ['dangling-node', 'unknown-letter'], L11: [],
  L12: ['missing-model'], L13: ['unknown-letter'], L14: ['model-not-in-engine'], L15: ['unknown-letter'], L16: ['missing-model'], L17: [],
  L18: ['unknown-letter'], L19: ['unknown-letter'], L20: ['unknown-letter'], L21: [], L22: ['unknown-letter'], L23: ['missing-subcircuit'],
  L24: ['unknown-letter'], L25: ['unknown-letter'], L26: ['dangling-node', 'unknown-letter'], L27: ['dangling-node', 'unknown-letter'],
  L28: ['dangling-node', 'unknown-letter'], L29: ['dangling-node'],
  // "+1 a 0 5" joins Rref's line and stops ngspice at a (unknown-word-10); ".1" is no dot command (unknown-dot-command).
  L30: ['dangling-node', 'unknown-word'], L31: ['dangling-node', 'unknown-dot-command'],
  L32: ['dangling-node'], L33: ['dangling-node'], L34: ['dangling-node'], L35: ['dangling-node', 'unknown-letter'],
  L36: ['dangling-node', 'unknown-letter'], L37: ['dangling-node'], L38: ['dangling-node'], L39: ['dangling-node', 'unknown-letter'],
  L40: ['dangling-node'], L41: ['dangling-node'], L42: ['dangling-node'], L43: ['dangling-node', 'unknown-letter'],
  L44: ['dangling-node', 'unknown-letter'], L45: ['dangling-node', 'unknown-letter'], L46: ['dangling-node'], L47: ['dangling-node', 'unknown-letter'],
  L48: ['dangling-node'], L49: ['dangling-node', 'unknown-letter'], L50: ['dangling-node'], L51: ['dangling-node'], L52: ['dangling-node'],
  L53: ['dangling-node', 'unknown-letter'], L54: ['dangling-node', 'unknown-letter'], L55: ['dangling-node', 'unknown-letter'],
  L56: ['dangling-node', 'unknown-letter'],
};

describe('the first-letter netlists (tests/corpus/letters)', () => {
  const dir = join(root, 'tests/corpus/letters');
  const files = readdirSync(dir).filter((f) => f.endsWith('.cir')).sort();

  it('has an expectation for every file', () => {
    expect(files.map((f) => basename(f, '.cir')).sort()).toEqual(Object.keys(LETTERS).sort());
  });

  it.each(files)('%s', (file) => {
    expect(ids(readFileSync(join(dir, file), 'utf8'))).toEqual(LETTERS[basename(file, '.cir')]);
  });
});

describe('the core review of 10 Nov 2026 (docs/spice-facts/review.md)', () => {
  const first = (netlist: string, id: string): Trap => traps(netlist).find((t) => t.id === id)!;

  it('lets F and H read the current of E, H and a B line with V= (control-source-4)', () => {
    const net = '* t\nV1 a 0 6\nE1 e 0 a 0 1\nRe e 0 3\nF1 0 p E1 1\nRp p 0 1\nVs a b 0\nRb b 0 6\nH1 h 0 Vs 2\nRh h 0 1\nH2 k 0 H1 3\nRk k 0 1\nB1 c 0 V=2*v(a)\nRc c 0 6\nF2 0 q B1 1\nRq q 0 1\n.op\n.end\n';
    expect(ids(net)).toEqual([]);
    // A typo of an E source is offered as the fix, like a V source.
    expect(first('* t\nV1 c 0 3\nR1 c 0 1\nEamp e 0 c 0 2\nRe e 0 1\nF1 0 a Eapm 2\nR2 a 0 1\n.op\n.end\n', 'control-source').fixes.map((f) => f.label)).toEqual(['Use Eamp']);
  });

  it('knows the arguments of a .func and the nodes inside v( ) and i( ) (fatal-syntax-10, -11)', () => {
    expect(ids('* t\nV1 a 0 1\nR1 a 0 1k\n.func dbl(x) {2*x}\nR2 a 0 {dbl(1k)}\n.op\n.end\n')).toEqual([]);
    expect(ids('* t\nV1 in 0 1\nR1 in 0 1k\nB1 out 0 V={2*v(in)}\nR2 out 0 1k\nB2 o2 0 V={2*i(V1)}\nR3 o2 0 1k\nR4 in 0 {2*v(in)}\n.op\n.end\n')).toEqual([]);
    expect(first('* t\nV1 in 0 1\nR1 in 0 1k\nB1 out 0 V={k*v(in)}\nR2 out 0 1k\n.op\n.end\n', 'fatal-syntax').title).toBe('k is not defined: add a .param line');
  });

  it('says that ngspice warns about a model on an inductor with a decimal comma (decimal-comma-3)', () => {
    const t = first('* t\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1\nL1 out 0 1,5m\n.tran 0.1m 5m\n.end\n', 'decimal-comma');
    expect(t.ngspice).toContain("except a warning that it can't find a model called '1,5m'");
  });

  it('gives the uic message for a loop of voltage sources when every analysis is .tran uic (voltage-loop-7)', () => {
    const uic = first('* t\nV1 a 0 5\nV2 a 0 3\nR1 a 0 1k\n.tran 1u 10u uic\n.end\n', 'voltage-loop');
    expect(uic.ngspice).toContain("'Timestep too small'");
    expect(uic.ngspice).not.toContain('operating point could not');
    expect(first('* t\nV1 a 0 5\nV2 a 0 3\nR1 a 0 1k\n.op\n.end\n', 'voltage-loop').ngspice).toContain('operating point could not');
  });

  it('names the word a P line takes for its model (unknown-letter-16, -17)', () => {
    expect(first('* t\nRref a 0 1\nP1 a 0 5\n.op\n.end\n', 'unknown-letter').ngspice).toBe("ngspice stops: 'Unable to find definition of model 5'. [unknown-letter-17]");
    expect(first('* t\nV1 a 0 6\nR1 a 0 2\nP1 a 0 b 0\nR2 b 0 1\n.op\n.end\n', 'unknown-letter').ngspice).toBe("ngspice stops: 'model name is not found'. [unknown-letter-16]");
  });

  it('gives E, F, G and H the message our engine prints for p, v and i (space-before-suffix-15, unknown-word-11)', () => {
    expect(first('* t\nV1 a 0 1\nR0 a 0 1\nE1 b 0 a 0 2 p\nR1 b 0 1\n.op\n.end\n', 'space-before-suffix').ngspice).toContain("'no such parameter on this device or parameter is missing'");
    expect(first('* t\nV1 a 0 1\nR0 a 0 1\nE1 b 0 a 0 2 i\nR1 b 0 1\n.op\n.end\n', 'unknown-word').ngspice).toContain("'no such parameter on this device or parameter is missing'");
  });

  it('does not offer .model 5 D for a number in the diode model place (missing-model-7)', () => {
    const net = '* t\nRref a 0 1\nD1 a 0 5\n.op\n.end\n';
    const t = first(net, 'missing-model');
    expect(t.fixes.map((f) => f.label)).toEqual(['Use a standard diode model: dmod']);
    expect(applyFix(net, t.fixes[0]!)).toBe('* t\nRref a 0 1\nD1 a 0 dmod\n.model dmod D\n.op\n.end\n');
  });

  it('keeps no-analysis quiet for a misspelt analysis, which has its own fix', () => {
    expect(ids('* t\nV1 a 0 1\nR1 a 0 1k\n.tarn 1u 1m\n.end\n')).toEqual(['unknown-dot-command']);
    expect(ids('* t\nV1 a 0 1\nR1 a 0 1k\n.foo 1\n.end\n')).toEqual(['unknown-dot-command', 'no-analysis']);
  });

  it('leaves words a more specific trap explains to that trap', () => {
    expect(ids('* t\nV1 a 0 1,5\nR1 a 0 1\n.op\n.end\n')).toEqual(['decimal-comma']);
    expect(ids('* t\nI1 0 n1 1\nR1 n1 0 1 k\n.op\n.end\n')).toEqual(['space-before-suffix']);
    expect(ids('* t\nI1 0 n1 1\nR1 n1 0 2 * load\n.op\n.end\n')).toEqual(['midline-comment']);
    expect(ids('* t\nV1 a 0 5\nR1 a 0 1k tc1=1m m=2\nC1 a 0 1u ic=0\n.op\n.end\n')).toEqual([]);
  });

  it('writes display text with the true minus sign', () => {
    const texts = CASES.flatMap((c) => traps(c.netlist).flatMap((t) => [t.title, t.why, t.ngspice]));
    for (const t of texts) expect(t, t).not.toMatch(/(^|\s)- node|10\^-/);
    expect(first('* t\nV1 n1 0 1\nR1 n1 0 1\nE1 a 0 n1 0 -2M\nR2 a 0 1\n.op\n.end\n', 'mega-as-milli').title).toContain('\u2212');
  });

  it('keeps every span exact on odd input: tabs, CRLF, Ω, Turkish letters, continuations, inline comments', () => {
    const body = [
      '* Türkçe başlık Ω', 'V1\tgiriş\t0\tDC 5 ; kaynak', 'R1 giriş çıkış 10kΩ $ direnç', '+ m=1', 'R2 çıkış 0 4,7k // yük', 'C1 çıkış 0 1µ',
      'Vx çıkış ölçü 0', 'R3 ölçü İ 1k load', 'R4 İ 0 2k2', 'E1 ş 0 giriş 0 2 m', 'Rş ş 0 1k', '.op', '.tarn 1u 1m', '.end',
    ];
    for (const eol of ['\n', '\r\n']) {
      const text = body.join(eol) + eol;
      const n = parseNetlist(text);
      const lineOf = (offset: number): number => n.lines.filter((l) => l.span.from <= offset).length;
      for (const l of n.lines) for (const t of l.tokens) expect(text.slice(t.from, t.to)).toBe(t.text);
      const found = checkTraps(n);
      expect(found.map((t) => t.id)).toEqual(['non-ascii-node', 'non-ascii-node', 'decimal-comma', 'non-ascii-node', 'unknown-word', 'rkm-notation', 'non-ascii-node', 'space-before-suffix', 'unknown-dot-command']);
      for (const t of found) {
        expect(lineOf(t.span.from), t.id).toBe(t.line);
        for (const f of t.fixes) {
          for (const c of f.changes) expect(c.from >= 0 && c.from <= c.to && c.to <= text.length, `${t.id}: ${f.label}`).toBe(true);
          expect(() => checkTraps(parseNetlist(applyFix(text, f)))).not.toThrow();
        }
      }
      for (const x of explainNetlist(n)) for (const f of x.fields) if (f.span) expect(text.slice(f.span.from, f.span.to)).toBe(f.text);
      expect(describeCircuit(n)).toContain('giriş');
    }
  });

  // Three tries of 4000 lines parsed, checked and explained: 0.25 s alone, 1.8 s at load 20 on 4 cores: 30 s.
  it('parses, checks and explains a 2000-line netlist quickly, in time proportional to its length', () => {
    const ladder = (n: number): string => {
      const out = ['* ladder', 'V1 n0 0 DC 12'];
      for (let i = 0; i < n; i++) out.push(`R${i}a n${i} n${i + 1} 1k`, `R${i}b n${i + 1} 0 ${i % 7 ? '2k' : '2k2'}`);
      return [...out, '.op', '.tran 1u 1m', '.end'].join('\n');
    };
    const all = (text: string): void => {
      const n = parseNetlist(text);
      checkTraps(n);
      explainNetlist(n);
    };
    all(ladder(50));
    // 2004 lines at once against ten netlists of 204 (about 35 ms of work each): linear work takes about
    // as long either way, quadratic about ten times as long at once; here at most 3 times (as before: 30
    // times one netlist of 204). Timed as the work it is, the least of three tries of each in turns
    // (work-time.ts: on a busy machine the clock counts the wait for a processor, the larger one's most).
    const [tenSmall, large] = leastWorkMs(
      [
        () => {
          for (let k = 0; k < 10; k++) all(ladder(100));
        },
        () => all(ladder(1000)),
      ],
      3,
    );
    expect(large).toBeLessThan(300);
    expect(large).toBeLessThan(3 * tenSmall);
  }, 30_000);

  it('stays fast on netlists with thousands of problems (each was quadratic: seconds)', () => {
    const build = (n: number, line: (i: number) => string, head: string[]): string => [...head, ...Array.from({ length: n }, (_, i) => line(i)), '.op', '.end'].join('\n');
    const cases = [
      build(2000, (i) => `R${i} a n${i} 1k`, ['* dangling', 'V1 a 0 5']),
      build(2000, () => 'R1 a 0 1k', ['* duplicates', 'V1 a 0 5']),
      build(2000, (i) => `C${i} n${i} m${i} 1u`, ['* floating', 'V1 a 0 5', 'R0 a 0 1k']),
    ];
    for (const text of cases) {
      const n = parseNetlist(text);
      checkTraps(n);
      const t0 = performance.now();
      checkTraps(n);
      expect(performance.now() - t0, text.slice(0, 12)).toBeLessThan(1000);
    }
  });
});

/** The Solved Circuits episode netlists, when that repository is checked out next to this one. */
const designDir = '/home/user/solved-circuits/design';
function cirFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...cirFiles(p));
    else if (name.endsWith('.cir')) out.push(p);
  }
  return out.sort();
}

/**
 * The episode netlists that are wrong on purpose (they show a trap on screen), and the two open
 * terminals that get an info note. Every other netlist must have no trap at all.
 */
const DELIBERATE: Record<string, [id: string, severity: TrapSeverity][]> = {
  'sp01/mega.cir': [['mega-as-milli', 'warning']],
  'sp01/noground.cir': [['no-ground', 'error']],
  'sp01/noground_v2.cir': [['no-ground', 'error']],
  'sp01/typo.cir': [['dangling-node', 'warning']],
  'sp01/shorts/a_1M.cir': [['mega-as-milli', 'warning']],
  'sp01/shorts/a_M_is_milli.cir': [['mega-as-milli', 'warning']],
  'sp01/shorts/a_both_1M.cir': [['mega-as-milli', 'warning'], ['mega-as-milli', 'warning']],
  'sp01/shorts/i_3a.cir': [['unit-letter', 'warning']],
  'e04/spice/ex3_open.cir': [['dangling-node', 'info']],
  'spice/p2e1_oc.cir': [['dangling-node', 'info']],
};

describe.skipIf(!existsSync(designDir))('the channel’s episode netlists (solved-circuits/design)', () => {
  const files = existsSync(designDir) ? cirFiles(designDir) : [];

  it('finds them, and every deliberate one', () => {
    expect(files.length).toBeGreaterThan(10);
    for (const f of Object.keys(DELIBERATE)) expect(files).toContain(join(designDir, f));
  });

  it.each(files)('%s', (file) => {
    const found = traps(readFileSync(file, 'utf8')).map((t) => [t.id, t.severity]);
    expect(found).toEqual(DELIBERATE[relative(designDir, file)] ?? []);
  });

  it('the typo netlist offers the channel’s fix, n12 to n2, first', () => {
    const text = readFileSync(join(designDir, 'sp01/typo.cir'), 'utf8');
    expect(traps(text)[0]!.fixes[0]!.label).toBe('Rename n12 to n2');
  });
});

describe('the circuit graph', () => {
  it('union-find joins and compares groups', () => {
    const u = new UnionFind();
    expect(u.same('a', 'b')).toBe(false);
    expect(u.union('a', 'b')).toBe(true);
    expect(u.union('b', 'a')).toBe(false);
    u.union('c', 'd');
    u.union('b', 'c');
    expect(u.same('a', 'd')).toBe(true);
    expect(u.same('a', 'e')).toBe(false);
  });

  it('finds a node reached only through capacitors', () => {
    const g = buildGraph(parseNetlist('* t\nV1 a 0 6\nC1 a b 1u\nC2 b 0 1u\n.op\n.end\n'));
    expect(g.hasGround).toBe(true);
    expect(g.floating.map((x) => [x.nodes, x.attachments.map((a) => a.kind)])).toEqual([[['b'], ['capacitor', 'capacitor']]]);
  });

  it("joins a MOSFET's drain, source and bulk, but not its gate", () => {
    const g = buildGraph(parseNetlist('* t\nV1 d 0 5\nM1 d g s b nm\nR1 s 0 1\n.model nm nmos\n.op\n.end\n'));
    expect(g.floating.map((x) => x.nodes)).toEqual([['g']]);
    expect(g.floating[0]!.attachments.map((a) => a.kind)).toEqual(['gate']);
  });

  it('reports a loop of voltage sources at the part that closes it, with the path between its ends', () => {
    const n = parseNetlist('* t\nV1 a 0 5\nV2 a b 2\nV3 b 0 3\nR1 a 0 1k\n.op\n.end\n');
    const g = buildGraph(n);
    expect(g.loops).toHaveLength(1);
    const key = (i: number): string => n.lines[i]!.element!.key;
    expect([key(g.loops[0]!.line), ...g.loops[0]!.others.map(key)].sort()).toEqual(['v1', 'v2', 'v3']);
    expect(g.loops[0]!.inductor).toBe(false);
    expect(g.voltagePaths.same('a', '0')).toBe(true);
  });

  it('counts an inductor as a wire in loops, and a part on one node as a loop of its own', () => {
    const g = buildGraph(parseNetlist('* t\nV1 a 0 6\nL1 a 0 1m\nL2 b b 1m\nR1 b 0 1\n.op\n.end\n'));
    expect(g.loops.map((l) => [l.inductor, l.self])).toEqual([[true, false], [true, true]]);
  });

  it('leaves parts inside .subckt out, and the parts ngspice drops', () => {
    const n = parseNetlist('* t\n.subckt s a b\nR1 a b 1\n.ends\nV1 x 0 1\nR2 x 0\nR3 x 0 1\n.op\n.end\n');
    expect([...subcircuitLines(n)]).toEqual([2]);
    expect(buildGraph(n).elements.map((i) => n.lines[i]!.element!.key)).toEqual(['v1', 'r3']);
  });

  it('has no floating groups when nothing is grounded (no-ground covers that)', () => {
    const g = buildGraph(parseNetlist('* t\nV1 a b 6\nR1 a b 2\n.op\n.end\n'));
    expect(g.hasGround).toBe(false);
    expect(g.floating).toEqual([]);
  });
});

describe('node names that look like typos', () => {
  it.each([
    ['n12', 'n2', true],
    ['n12', 'n1', true],
    ['out', 'otu', true],
    ['vout', 'vou', true],
    ['n1', 'n2', false],
    ['a', 's', false],
    ['a', 'ab', false],
    ['n12', 'n21', false],
    ['in', 'in', false],
    ['out1', 'out2', false],
  ] as const)('%s and %s: %s', (a, b, want) => {
    expect(looksLikeTypo(a, b)).toBe(want);
    expect(looksLikeTypo(b, a)).toBe(want);
  });
});

describe('robustness', () => {
  const pieces = [
    'R', 'V', 'I', 'C', 'L', 'E', 'F', 'G', 'H', 'K', 'D', 'Q', 'M', 'X', 'B', 'A', 'W', 'S', 'T', 'O', 'U', '1', '0', 'gnd',
    'ground', '00', 'a', 'b', 'n1', ' ', ' ', '\t', '\r', '\n', '\n', '\n', '+', '-', '*', '/', ',', '=', '(', ')', '{', '}', "'",
    ';', '#', '@', '.', '.end', '.end;', '.op', '.dc', '.tran', '.tf', 'v(', 'i(', '.model', '.subckt', '.ends', '.param', 'uic',
    '.include', '.control', '.endc', '1M', '3A', '1F', '2k2', '1,5k', 'k', 'm', 'meg', '\u00b5', '\u03bc', '\u00a0', '\ufeff',
    'pulse', 'dc', 'level=49', 'nmos', 'd', '{x}', 'é', '\ud800', '\u0000',
  ];

  // About 0.4 s alone (1500 random netlists, every fix applied and checked again); 2.4 s at load 16 on
  // 4 cores, half of vitest's 5 s: 30 s, as the app's slow tests have.
  it('never throws, keeps spans and fixes inside the text, and sorts by line then column', () => {
    let seed = 20261109;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let run = 0; run < 1500; run++) {
      let text = '';
      const length = Math.floor(random() * 60);
      for (let k = 0; k < length; k++) text += pieces[Math.floor(random() * pieces.length)];
      const n = parseNetlist(text);
      const found = checkTraps(n);
      for (let k = 0; k < found.length; k++) {
        const t = found[k]!;
        expect(TRAP_IDS).toContain(t.id);
        expect(t.span.from).toBeGreaterThanOrEqual(0);
        expect(t.span.to).toBeLessThanOrEqual(text.length);
        expect(t.span.from).toBeLessThanOrEqual(t.span.to);
        const line = n.lines.findLast((l) => l.span.from <= t.span.from)!;
        expect(t.line).toBe(line.number);
        if (k > 0) {
          const p = found[k - 1]!;
          expect(t.line > p.line || (t.line === p.line && t.span.from >= p.span.from)).toBe(true);
        }
        for (const f of t.fixes) {
          for (const c of f.changes) {
            expect(c.from).toBeGreaterThanOrEqual(0);
            expect(c.to).toBeLessThanOrEqual(text.length);
          }
          expect(() => checkTraps(parseNetlist(applyFix(text, f)))).not.toThrow();
        }
      }
    }
  }, 30_000);

  // About 45 ms of work here. Timed as the work it is (work-time.ts: the processor time, not the clock,
  // which on a busy machine counts the wait for a processor: 740 ms by the clock at load 16), the least
  // of three tries.
  it('checks 10,000 lines in well under a second', () => {
    const lines = ['* ladder', 'V1 n0 0 10'];
    for (let k = 0; k < 5000; k++) lines.push(`R${2 * k + 1} n${k} n${k + 1} 1k`, `R${2 * k + 2} n${k + 1} 0 2k`);
    lines.push('.op', '.end');
    const n = parseNetlist(`${lines.join('\n')}\n`);
    expect(checkTraps(n)).toEqual([]);
    const [ms] = leastWorkMs([() => checkTraps(n)], 3);
    expect(ms).toBeLessThan(500);
  });
});

describe('the evidence', () => {
  const doc = readFileSync(join(root, 'docs/spice-facts/traps.md'), 'utf8');
  const source = readFileSync(join(root, 'src/spice/traps.ts'), 'utf8');

  it('every claim the trap texts cite has its section in docs/spice-facts/traps.md', () => {
    const cited = new Set<string>();
    for (const m of source.matchAll(/\[([a-z-]+-\d+(?:,? [a-z-]+-\d+| \.\.\. [a-z-]+-\d+)*)\]/g)) {
      for (const code of m[1]!.split(/,? |\.\.\./).filter((x) => /^[a-z-]+-\d+$/.test(x))) cited.add(code);
    }
    expect(cited.size).toBeGreaterThan(50);
    for (const code of cited) expect(doc, code).toContain(`### ${code}.`);
  });

  it('documents every trap id', () => {
    for (const id of TRAP_IDS) expect(doc).toContain(`## ${id}`);
  });
});

describe('after the final reviews (12 November 2026)', () => {
  const first = (netlist: string, id: string): Trap => traps(netlist).find((t) => t.id === id)!;

  it('flags an invisible character or a look-alike only when the reading changes, and never shows it (security review F2)', () => {
    // The reviewer's link: "R1 in out 1<zero-width space>k" with R2 1k. Native 47: v(out) = 5.994006 (R1 = 1 Ω).
    const zwsp = first('* t\nV1 in 0 6\nR1 in out 1​k\nR2 out 0 1k\n.op\n.end\n', 'invisible-character');
    expect(zwsp.title).toBe('R1\'s value is read as 1 Ω, not 1 kΩ');
    for (const text of [zwsp.title, zwsp.why, zwsp.ngspice, ...zwsp.fixes.map((f) => f.label)]) expect(text).not.toMatch(/[​-‏⁠-⁤﻿­]/);
    expect(zwsp.why).toContain('A zero-width space (U+200B) sits between 1 and k');
    // Harmless: after the scale letter, or a unit written after it; Turkish node names are another check's.
    expect(ids('* t\nV1 in 0 6\nR1 in out 1k​\nR2 out 0 2k\n.op\n.end\n')).toEqual([]);
    expect(ids('* t\nV1 in 0 6\nR1 in out 1kΩ\nR2 out 0 2k\n.op\n.end\n')).toEqual([]);
    expect(ids('* t\nV1 in 0 6\nR1 in out 1k \nR2 out 0 2k\n.op\n.end\n')).not.toContain('invisible-character');
    // The Greek mu keeps its own check.
    expect(ids('* t\nI1 0 n1 1\nR1 n1 0 4.7μ\n.op\n.end\n')).toEqual(['greek-mu']);
    // The numbers of an analysis line too: 5<zero-width space>m is 5 s.
    expect(first('* t\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran 1u 5​m\n.end\n', 'invisible-character').title).toBe('This value is read as 5, not 0.005');
  });

  it('says a look-alike in whole sentences, whatever it looks like, and cites the run that shows it (security review F2; look-alike-letter-1, -3)', () => {
    const cases: [netlist: string, why: string, ngspice: string][] = [
      ['* t\nI1 0 n1 1\nR1 n1 0 1\u043a\n.op\n.end\n',
        'The value has the Cyrillic letter \u043a, which looks like k. SPICE knows only the plain letter k, so it ignores this one like a unit. Write 1k.',
        'ngspice stops reading the number at the Cyrillic letter \u043a, without a message: it reads 1\u00a0Ω. [look-alike-letter-1]'],
      ['* t\nI1 0 n1 1\nR1 n1 0 1e\u22123\n.op\n.end\n',
        'The value has a minus sign (U+2212), which looks like -. SPICE knows only the plain - sign, so it ignores this one like a unit, and the 3 after it. Write 1e-3.',
        'ngspice stops reading the number at the minus sign (U+2212), without a message: it reads 1\u00a0Ω. [look-alike-letter-3]'],
      ['* t\nI1 0 n1 1\nR1 n1 0 1e\u20133\n.op\n.end\n',
        'The value has a dash (U+2013), which looks like -. SPICE knows only the plain - sign, so it ignores this one like a unit, and the 3 after it. Write 1e-3.',
        'ngspice stops reading the number at the dash (U+2013), without a message: it reads 1\u00a0Ω. [look-alike-letter-3]'],
      ['* t\nI1 0 n1 1\nR1 n1 0 1\uff10k\n.op\n.end\n',
        'The value has the fullwidth digit \uff10, which looks like 0. SPICE knows only the plain digit 0, so it ignores this one like a unit, and the k after it. Write 10k.',
        'ngspice stops reading the number at the fullwidth digit \uff10, without a message: it reads 1\u00a0Ω. [look-alike-letter-3]'],
      ['* t\nI1 0 n1 1\nR1 n1 0 1\uff0e5k\n.op\n.end\n',
        'The value has the fullwidth sign \uff0e, which looks like a decimal point. SPICE knows only the plain decimal point, so it ignores this one like a unit, and the 5k after it. Write 1.5k.',
        'ngspice stops reading the number at the fullwidth sign \uff0e, without a message: it reads 1\u00a0Ω. [look-alike-letter-3]'],
      ['* t\nI1 0 n1 1\nR1 n1 0 1\u212a\n.op\n.end\n',
        'The value has the Kelvin sign \u212a (U+212A), which looks like K. SPICE knows only the plain letter K, so it ignores this one like a unit. Write 1K.',
        'ngspice stops reading the number at the Kelvin sign \u212a (U+212A), without a message: it reads 1\u00a0Ω. [look-alike-letter-3]'],
    ];
    for (const [netlist, why, ngspice] of cases) {
      const t = first(netlist, 'look-alike-letter');
      expect(t.why).toBe(why);
      expect(t.ngspice).toBe(ngspice);
    }
  });

  it('reads a value with a character that looks like a space the way documents write it, names the character, and says what ngspice reads (critic of round 1; space-character-1 to -5, nbsp-2)', () => {
    // The critic's divider, copied from a PDF: R1 4.7<thin space>kΩ. Native 47 and 42: R1 = 4.7 Ω, out = 9.99 V.
    const thin = first('* t\nV1 in 0 10\nR1 in out 4.7\u2009k\u03a9\nR2 out 0 4.7k\n.op\n.end\n', 'space-character');
    expect([thin.title, thin.why, thin.ngspice]).toEqual([
      'R1\'s value is read as 4.7\u00a0\u03a9, not 4.7\u00a0k\u03a9',
      'A thin space (U+2009) sits between 4.7 and k\u03a9, as documents write a number and its unit. It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the k\u03a9 after it does not count. SPICE needs no space and no units: write 4.7k.',
      'ngspice stops reading the number at the thin space and ignores the rest of the word, without a message: it reads 4.7\u00a0\u03a9. [space-character-1]',
    ]);
    // The words never show the character: they name it.
    for (const text of [thin.title, thin.why, thin.ngspice, ...thin.fixes.map((f) => f.label)]) expect(text).not.toMatch(/[\u1680\u2000-\u200a\u202f\u205f\u3000]/);
    // The narrow no-break space and the ideographic space (critic's 1<U+202F>k, 1<U+3000>k), and groups of digits.
    expect(first('* t\nI1 0 n1 1\nR1 n1 0 1\u202fk\n.op\n.end\n', 'space-character').why).toContain('A narrow no-break space (U+202F) sits between 1 and k');
    expect(first('* t\nI1 0 n1 1\nR1 n1 0 1\u3000k\n.op\n.end\n', 'space-character').fixes.map((f) => f.label)).toEqual(['Write 1k (1\u00a0k\u03a9)']);
    const groups = first('* t\nI1 0 n1 1\nR1 n1 0 10\u2009000\n.op\n.end\n', 'space-character');
    expect([groups.title, groups.fixes.map((f) => f.label)]).toEqual(['R1\'s value is read as 10\u00a0\u03a9, not 10\u00a0k\u03a9', ['Write 10000 (10\u00a0k\u03a9)']]);
    expect(groups.why).toContain('as documents group digits');
    // A capital M after the space is mega in a document: never "Write 1M", which is milli (mega-as-milli).
    const mega = first('* t\nV1 in 0 10\nR1 in out 1\u2009M\u03a9\nR2 out 0 1meg\n.op\n.end\n', 'space-character');
    expect(mega.fixes.map((f) => f.label)).toEqual(['Make it 1meg (1\u00a0M\u03a9)', 'Make it 1m (1\u00a0m\u03a9)']);
    expect(mega.why).toContain('a capital M is milli in SPICE: for mega, write meg: 1meg.');
    expect(first('* t\nV1 a 0 5\u2009MV\nR1 a 0 1\n.op\n.end\n', 'space-character').fixes.map((f) => f.label)).toEqual(['Make it 5m (5\u00a0mV)', 'Make it 5meg (5\u00a0MV)']);
    // A no-break space in a value: the same reading, under the no-break space's own check.
    expect(first('* t\nV1 in 0 10\nR1 in out 4.7\u00a0k\u03a9\nR2 out 0 4.7k\n.op\n.end\n', 'nbsp').ngspice).toContain('[nbsp-2]');
    // Harmless, no trap: after the scale letter; a unit alone (2 A means 2 amps, and SPICE reads 2); at the end of the word.
    expect(ids('* t\nV1 in 0 10\nR1 in out 4.7k\u2009\u03a9\nR2 out 0 4.7k\n.op\n.end\n')).toEqual([]);
    expect(ids('* t\nI1 0 a 2\u2009A\nR1 a 0 1\n.op\n.end\n')).toEqual([]);
    expect(ids('* t\nV1 in 0 10\u2009\nR1 in 0 1\n.op\n.end\n')).toEqual([]);
    // The fix gives what was meant: 4.7k, and 10000.
    expect(applyFix('* t\nV1 in 0 10\nR1 in out 4.7\u2009k\u03a9\nR2 out 0 4.7k\n.op\n.end\n', thin.fixes[0]!)).toBe('* t\nV1 in 0 10\nR1 in out 4.7k\nR2 out 0 4.7k\n.op\n.end\n');
    // The numbers of an analysis line too: .tran 1u 5<thin space>ms is 5 s.
    expect(first('* t\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran 1u 5\u2009ms\n.end\n', 'space-character').title).toBe('This value is read as 5, not 0.005');
    // Between two words it glues them, named; in a node name the node check names it once, and the non-ascii-node check stays quiet.
    const glue = first('* t\nI1 0 n1 1\nR1 n1 0\u20092\nR2 n1 0 1\n.op\n.end\n', 'space-character');
    expect(glue.title).toBe('A thin space (U+2009) glues "0 2" into one word');
    expect(ids('* t\nV1 in 0 6\nR1 in ou\u2009t 1k\nR2 ou\u2009t 0 2k\n.op\n.end\n')).toEqual(['space-character']);
  });

  it('reads groups of digits with a unit after them the way documents write them: 10 000 Ω is 10000, never "Replace it with a normal space" (critic of round 2; space-character-7, -8)', () => {
    // The critic's netlist: R1 10<thin space>000<thin space>Ω, read as 10 Ω (native 47 and 42: out = 9.99 V).
    const text = '* t\nV1 in 0 10\nR1 in out 10\u2009000\u2009\u03a9\nR2 out 0 10k\n.op\n.end\n';
    const found = traps(text);
    expect(found.map((t) => t.id)).toEqual(['space-character']);
    expect([found[0]!.title, found[0]!.why, found[0]!.ngspice, found[0]!.fixes.map((f) => f.label)]).toEqual([
      'R1\'s value is read as 10\u00a0\u03a9, not 10\u00a0k\u03a9',
      'A thin space (U+2009) sits between 10 and 000, as documents group digits. It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the 000 \u03a9 after it does not count. SPICE needs no space and no units: write 10000.',
      'ngspice stops reading the number at the thin space and ignores the rest of the word, without a message: it reads 10\u00a0\u03a9. [space-character-7]',
      ['Write 10000 (10\u00a0k\u03a9)'],
    ]);
    // One click, and nothing is left to fix: the critic's chain ended at a 0 Ω resistor.
    expect(ids(applyFix(text, found[0]!.fixes[0]!))).toEqual([]);
    const fixes = (value: string, letter = 'R'): string[] => first(`* t\nI1 0 n1 1\n${letter}1 n1 0 ${value}\nR2 n1 0 1\n.op\n.end\n`, 'space-character').fixes.map((f) => f.label);
    expect(fixes('4\u2009700\u2009\u03a9')).toEqual(['Write 4700 (4.7\u00a0k\u03a9)']);
    expect(fixes('1\u2009000k')).toEqual(['Write 1000k (1\u00a0M\u03a9)']);
    expect(fixes('1\u2009000\u2009k\u03a9')).toEqual(['Write 1000k (1\u00a0M\u03a9)']);
    expect(fixes('2\u202f200\u202f000')).toEqual(['Write 2200000 (2.2\u00a0M\u03a9)']);
    expect(fixes('1\u2009000\u2009M\u03a9')).toEqual(['Make it 1000meg (1\u00a0G\u03a9)', 'Make it 1000m (1\u00a0\u03a9)']);
    // On a capacitor ngspice also looks the word up as a model, and says so (space-character-8).
    const cap = first('* t\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1\nC1 out 0 1\u2009000\u2009\u00b5F\n.tran 0.1m 1m\n.end\n', 'space-character');
    expect([cap.title, cap.ngspice, cap.fixes.map((f) => f.label)]).toEqual([
      'C1\'s value is read as 1\u00a0F, not 1\u00a0mF',
      "ngspice stops reading the number at the thin space and ignores the rest of the word: it reads 1\u00a0F, and only warns that it can't find a model with the word's name. [space-character-7, space-character-8]",
      ['Write 1000u (1\u00a0mF)'],
    ]);
    // Never shown, only named.
    for (const t of [...found, cap]) for (const x of [t.title, t.why, t.ngspice, ...t.fixes.map((f) => f.label)]) expect(x).not.toMatch(/[\u1680\u2000-\u200a\u202f\u205f\u3000]/);
  });

  it('a number written another way says what ngspice reads and takes the character out: 1 2 is 1, 0.000 001 is 0 (critic of round 2; space-character-9, -11)', () => {
    const one = first('* t\nI1 0 n1 1\nR1 n1 0 1\u20092\n.op\n.end\n', 'space-character');
    expect([one.title, one.why, one.ngspice, one.fixes.map((f) => f.label)]).toEqual([
      'R1\'s value is read as 1\u00a0\u03a9',
      'A thin space (U+2009) sits between 1 and 2 (it often comes with text copied from a document or a web page). It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the 2 after it does not count. Without it, the value reads 12.',
      'ngspice stops reading the number at the thin space and ignores the rest of the word, without a message: it reads 1\u00a0\u03a9. [space-character-11]',
      ['Take it out: write 12 (12\u00a0\u03a9)'],
    ]);
    expect(first('* t\nI1 0 n1 1\nR1 n1 0 0.000\u2009001\nR2 n1 0 1\n.op\n.end\n', 'space-character').fixes.map((f) => f.label)).toEqual(['Take it out: write 0.000001 (1\u00a0\u00b5\u03a9)']);
    // No value word ever gets "Replace it with a normal space": 10 000 Ω with normal spaces stops ngspice (space-character-9).
    for (const value of ['10\u2009000\u2009\u03a9', '1\u20092', '0.000\u2009001', '4.7\u2009k\u03a9', '1\u20092\u20093']) {
      const labels = traps(`* t\nI1 0 n1 1\nR1 n1 0 ${value}\nR2 n1 0 1\n.op\n.end\n`).flatMap((t) => t.fixes.map((f) => f.label));
      expect(labels, value).not.toContain('Replace it with a normal space');
    }
    // Where taking it out changes nothing, nothing is said: 4.7<thin space>xyz is 4.7 either way.
    expect(ids('* t\nI1 0 n1 1\nR1 n1 0 4.7\u2009xyz\n.op\n.end\n')).toEqual([]);
    // A word that is no number keeps the glue check: PULSE(0<thin space>1 ... is two words meant.
    expect(first('* t\nV1 in 0 PULSE(0\u20091 0 1n 1n 1 2)\nR1 in 0 1\n.tran 1m 2m\n.end\n', 'space-character').fixes.map((f) => f.label)).toEqual(['Replace it with a normal space']);
  });

  it('a character that looks like a space in a node name: "Take it out: connect to out", and no dangling-node notes for the pair (critic of round 2; space-character-10)', () => {
    // The critic's netlist: R1 in o<thin space>ut 2k next to R2 out 0 2k. It got "Replace it with a normal space" and "Rename out to o ut".
    const text = '* t\nV1 in 0 10\nR1 in o\u2009ut 2k\nR2 out 0 2k\n.op\n.end\n';
    const found = traps(text);
    expect(found.map((t) => t.id)).toEqual(['space-character']);
    expect([found[0]!.title, found[0]!.why, found[0]!.fixes.map((f) => f.label)]).toEqual([
      'The node o ut has a thin space (U+2009) in it',
      'It looks like a space, but SPICE does not treat it as one: it keeps it in the name, so this is not the node out the other lines name but another node, and the parts on it are not connected to out.',
      ['Take it out: connect to out'],
    ]);
    expect(applyFix(text, found[0]!.fixes[0]!)).toBe('* t\nV1 in 0 10\nR1 in out 2k\nR2 out 0 2k\n.op\n.end\n');
    // The no-break space under its own check's name; a name no other line writes is renamed everywhere.
    expect(first('* t\nV1 in 0 10\nR1 in o\u00a0ut 2k\nR2 out 0 2k\n.op\n.end\n', 'nbsp').fixes.map((f) => f.label)).toEqual(['Take it out: connect to out']);
    const alone = '* t\nV1 o\u2009ut 0 10\nR1 o\u2009ut 0 2k\n.op\n.end\n';
    const renamed = first(alone, 'space-character');
    expect(renamed.fixes.map((f) => f.label)).toEqual(['Take it out: name the node out']);
    expect(applyFix(alone, renamed.fixes[0]!)).toBe('* t\nV1 out 0 10\nR1 out 0 2k\n.op\n.end\n');
    // A part line a word short: the character stands where a space was meant, so the glue check's fix stays.
    expect(traps('* t\nV1 in 0 10\nR1 in\u2009out 2k\nR2 out 0 2k\n.op\n.end\n').map((t) => [t.id, t.fixes.map((f) => f.label)])).toEqual([
      ['missing-value', []],
      ['space-character', ['Replace it with a normal space']],
      ['dangling-node', []],
    ]);
  });

  it('a look-alike in a node name is named, and its fix connects it to the node it looks like (critic of round 1; look-alike-letter-5)', () => {
    // The critic's netlist: R2 on оut (Cyrillic о). It said "ngspice calls the node оut __ut ... (о as __)" and "Rename оut to ut".
    const text = '* t\nV1 in 0 6\nR1 in out 1k\nR2 \u043eut 0 2k\n.op\n.end\n';
    const found = traps(text);
    expect(found.map((t) => t.id)).toEqual(['look-alike-letter']);
    expect([found[0]!.title, found[0]!.why]).toEqual([
      'The node \u043eut has the Cyrillic letter \u043e',
      'It looks like o, but SPICE knows only the plain letter o, so this is not the node out the other lines name: it is another node, and the parts on it are not connected to out.',
    ]);
    expect(applyFix(text, found[0]!.fixes[0]!)).toBe('* t\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n');
    // Alone, it renames the node to its plain letters, and the drawing's label with it.
    expect(first('* t\nV1 a 0 6\nR1 a \u043eut 1k\nR2 \u043eut 0 2k\n.op\n.end\n', 'look-alike-letter').fixes.map((f) => f.label)).toEqual(['Rename \u043eut to out']);
    // A name with a Turkish letter too stays the non-ascii-node check's, and its fix writes the look-alike plain (çоk is cok, not ck).
    expect(first('* t\nV1 in 0 6\nR1 in \u00e7\u043ek 1k\nR2 \u00e7\u043ek 0 2k\n.op\n.end\n', 'non-ascii-node').fixes.map((f) => f.label)).toEqual(['Rename \u00e7\u043ek to cok']);
  });

  it('a capital M from another alphabet is meant as mega: the fixes are mega-as-milli\'s, never "Write 10M" (critic of round 1; look-alike-letter-4)', () => {
    const t = first('* t\nI1 0 a 1u\nR1 a 0 10\u039c\n.op\n.end\n', 'look-alike-letter');
    expect(t.title).toBe('R1\'s value is read as 10\u00a0\u03a9, not 10\u00a0M\u03a9');
    expect(t.why).toBe('The value has the Greek letter \u039c, which looks like M. SPICE knows only the plain letter M, so it ignores this one like a unit. For mega, write meg (a capital M is milli in SPICE): 10meg.');
    // Neither fix leads into the mega-as-milli check.
    for (const f of t.fixes) expect(ids(applyFix('* t\nI1 0 a 1u\nR1 a 0 10\u039c\n.op\n.end\n', f))).toEqual([]);
    // On a source, milli first, as mega-as-milli orders them; a small Cyrillic м stays milli.
    expect(first('* t\nV1 a 0 5\u041c\nR1 a 0 1\n.op\n.end\n', 'look-alike-letter').fixes.map((f) => f.label)).toEqual(['Make it 5m (5\u00a0mV)', 'Make it 5meg (5\u00a0MV)']);
    expect(first('* t\nI1 0 n4 1\nR4 n4 0 2\u043c\n.op\n.end\n', 'look-alike-letter').fixes.map((f) => f.label)).toEqual(['Write 2m (2\u00a0m\u03a9)']);
  });

  it('says where an invisible character sits when the word is no number: right after the -, not "starts with" (critic of round 1; invisible-character-6)', () => {
    const t = first('* t\nV1 a 0 -\u200b5\nR1 a 0 1k\n.op\n.end\n', 'invisible-character');
    expect(t.why).toBe('Right after the -, it has a zero-width space (U+200B), a character you cannot see (it often comes with text copied from a web page or a PDF), so SPICE does not read the word as a number. Write -5.');
    expect(t.ngspice).toBe("ngspice stops: 'unknown parameter (-___5)'. [invisible-character-6]");
    expect(first('* t\nI1 0 a 1\nR1 a 0 \u200b2k\n.op\n.end\n', 'invisible-character').why).toMatch(/^It starts with a zero-width space \(U\+200B\)/);
  });

  it('says the place first for a look-alike right after a sign too: "Right after the -, it has the fullwidth digit ５, which looks like 5" (critic of round 2; look-alike-letter-6)', () => {
    const t = first('* t\nV1 a 0 -\uff15\nR1 a 0 1k\n.op\n.end\n', 'look-alike-letter');
    expect([t.title, t.why, t.ngspice, t.fixes.map((f) => f.label)]).toEqual([
      'V1\'s value is not a number for SPICE',
      'Right after the -, it has the fullwidth digit \uff15, which looks like 5, so SPICE does not read the word as a number. Write -5.',
      "ngspice stops: 'unknown parameter (-___)'. [look-alike-letter-6]",
      ['Write -5 (\u22125\u00a0V)'],
    ]);
    // At the start, a minus sign from a document keeps "It starts with" and its own run (look-alike-letter-2).
    expect(first('* t\nV1 a 0 \u22125\nR1 a 0 1k\n.op\n.end\n', 'look-alike-letter').ngspice).toBe("ngspice stops: 'unknown parameter (___5)'. [look-alike-letter-2]");
  });

  it('a node name with an invisible character: no "Rename out to out", and no dangling-node notes for the two names (security review F2)', () => {
    const text = '* t\nV1 in 0 6\nR1 in out 1k\nR2 ou​t 0 2k\n.op\n.end\n';
    const found = traps(text);
    expect(found.map((t) => t.id)).toEqual(['invisible-character']);
    expect(found[0]!.fixes.map((f) => f.label)).toEqual(['Take it out: connect to out']);
    expect(applyFix(text, found[0]!.fixes[0]!)).toBe('* t\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n');
    // On its own, the fix just takes the character out of the name.
    const alone = first('* t\nV1 a 0 6\nR1 a ou​t 1k\nR2 ou​t 0 2k\n.op\n.end\n', 'invisible-character');
    expect(alone.fixes.map((f) => f.label)).toEqual(['Take it out: name the node out']);
  });

  it('quotes ngspice\'s message with ngspice\'s own spelling of the word (W16; unknown-word-12, space-before-suffix-16, -17)', () => {
    expect(first('* t\nV1 a 0 5\nR1 a 0 1k yük\n.op\n.end\n', 'unknown-word').ngspice).toContain("'unknown parameter (y__k)'");
    expect(first('* t\nI1 0 n1 1\nR1 n1 0 1 Ω\n.op\n.end\n', 'space-before-suffix').ngspice).toContain("'unknown parameter (__)'");
    expect(first('* t\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1 µ\n.op\n.end\n', 'space-before-suffix').ngspice).toContain("'unknown parameter (u)'");
  });

  it('renames a node with a Turkish letter everywhere, on the drawing\'s label line too, and never onto a name ngspice already has (kept F3)', () => {
    const text = '* t\nV1 giri\u015f 0 12\nR1 giri\u015f giris 1k\nR2 giris 0 2k\n.tf v(giri\u015f) V1\n.end\n* plainspice-drawing v1\n*@ label giri\u015f 0 0\n*@ label giris 4 0\n';
    const t = first(text, 'non-ascii-node');
    // "giris" is another node: the fix must not join the two.
    expect(t.fixes.map((f) => f.label)).toEqual(['Rename giri\u015f to giris2']);
    const fixed = applyFix(text, t.fixes[0]!);
    expect(fixed).toBe('* t\nV1 giris2 0 12\nR1 giris2 giris 1k\nR2 giris 0 2k\n.tf v(giris2) V1\n.end\n* plainspice-drawing v1\n*@ label giris2 0 0\n*@ label giris 4 0\n');
    expect(ids(fixed)).toEqual([]);
  });

  it('gives every name ngspice makes one its own plain letters, and a lone name with no plain letters a plain one', () => {
    const merged = first('* t\nV1 \u0130 0 6\nR1 \u0130 \u015f 1k\nR2 \u015f 0 1k\n.op\n.end\n', 'non-ascii-node');
    expect(merged).toMatchObject({ severity: 'error', title: '\u0130 and \u015f are one node for ngspice' });
    expect(merged.fixes.map((f) => f.label)).toEqual(['Write I for \u0130 and s for \u015f']);
    expect(first('* t\nV1 \u03b1 0 6\nR1 \u03b1 0 1k\n.op\n.end\n', 'non-ascii-node').fixes.map((f) => f.label)).toEqual(['Rename \u03b1 to n1']);
    // The micro sign is fine: ngspice reads it as u (W16).
    expect(ids('* t\nV1 \u00b5in 0 6\nR1 \u00b5in 0 2\n.op\n.end\n')).toEqual([]);
  });

  it('finds two part names that ngspice spells the same (duplicate-name-3)', () => {
    const t = first('* t\nV1 a 0 6\nR\u015f a 0 2\nR\u00e7 a 0 3\n.op\n.end\n', 'duplicate-name');
    expect(t.title).toBe('R\u015f and R\u00e7 are the same name for ngspice');
    expect(t.why).toContain('are both r__');
  });

  it('the missing-end note says where new lines go, not that .end stops ngspice (words review W1; missing-end-1, after-end-1, S25)', () => {
    const t = first('* t\nV1 n1 0 6\nR1 n1 0 2\n.op\n', 'missing-end');
    expect(t.why).toContain('keep new lines above it, because ngspice still reads lines written after .end');
    // ngspice reads past .end (after-end-1), and no fact here says what other SPICE programs need.
    expect(`${t.title} ${t.why} ${t.ngspice}`).not.toMatch(/stops|other SPICE programs|marks/);
    expect(t.ngspice).toContain('[missing-end-1, after-end-1]');
  });
});

describe('after the re-check of the fixes (12 November 2026)', () => {
  const first = (netlist: string, id: string): Trap => traps(netlist).find((t) => t.id === id)!;
  const texts = (t: Trap): string[] => [t.title, t.why, t.ngspice, ...t.fixes.map((f) => f.label)];

  it('says what ngspice does with a word it cannot read on an analysis line, by its place, never "unknown parameter" (S2; invisible-character-8 to -21)', () => {
    const rc = '* t\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n';
    const ac = '* t\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n';
    const dc = '* t\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n';
    // Each place, with a zero-width space, a minus sign from a document, a thin space and a fullwidth digit at its start.
    const places: [netlist: (w: string) => string, says: string][] = [
      [(w) => `${rc}.tran ${w} 2m\n.end\n`, "ngspice stops: 'TSTEP is invalid, must be greater than zero.' [invisible-character-8]"],
      [(w) => `${rc}.tran 0.1m ${w}\n.end\n`, "ngspice stops: 'TSTOP is invalid, must be greater than zero.' [invisible-character-9]"],
      [(w) => `${rc}.tran 0.1m 2m ${w}\n.end\n`, "ngspice stops: 'Error: unknown parameter on .tran - ignored'. It says ignored, but it runs nothing. [invisible-character-10]"],
      [(w) => `${rc}.tran 0.1m 2m 0 ${w}\n.end\n`, "ngspice stops: 'Error: unknown parameter on .tran - ignored'. It says ignored, but it runs nothing. [invisible-character-11]"],
      [(w) => `${dc}.dc V1 ${w} 5 1\n.end\n`, "ngspice 47 stops: 'Bad syntax!'. ngspice 42 takes the word for the name of a second source to sweep"],
      [(w) => `${dc}.dc V1 0 ${w} 1\n.end\n`, '[invisible-character-13]'],
      [(w) => `${dc}.dc V1 0 5 ${w}\n.end\n`, '[invisible-character-14]'],
      [(w) => `${dc}.dc V1 0 5 1 V2 ${w} 1 0.5\n.end\n`, "ngspice 47 stops: 'Bad syntax!'. [invisible-character-15]"],
      [(w) => `${ac}.ac dec ${w} 1 1k\n.end\n`, "ngspice warns: 'Warning, ngspice assumes default parameter(s) for ac simulation', then stops: 'AC startfreq <= 0'. [invisible-character-16]"],
      [(w) => `${ac}.ac dec 10 ${w} 1k\n.end\n`, '[invisible-character-17]'],
      [(w) => `${ac}.ac dec 10 1 ${w}\n.end\n`, "ngspice warns: 'Warning, ngspice assumes default parameter(s) for ac simulation', and runs anyway, up to 1000 times the start frequency (1\u00a0kHz) instead of the stop written here. [invisible-character-18]"],
      [(w) => `${ac}.noise v(out) V1 dec ${w} 1 1k\n.end\n`, "ngspice stops: 'Frequency of 0 is invalid'. [invisible-character-19]"],
      [(w) => `${ac}.noise v(out) V1 dec 10 ${w} 1k\n.end\n`, '[invisible-character-20]'],
      [(w) => `${ac}.noise v(out) V1 dec 10 1 ${w}\n.end\n`, '[invisible-character-21]'],
    ];
    for (const [netlist, says] of places) {
      for (const w of ['\u200b5', '−5', '\u20095', '５']) {
        const text = netlist(w);
        const n = parseNetlist(text);
        const found = traps(text).filter((t) => n.lines[t.line - 1]!.directive);
        expect(found.map((t) => t.id), text).toHaveLength(1);
        expect(found[0]!.severity, text).toBe('error');
        expect(found[0]!.ngspice, text).toContain(says);
        expect(found[0]!.fixes.map((f) => f.label), text).toEqual([`Write ${w === '−5' ? '-5' : '5'}`]);
      }
    }
  });

  it('no trap on an analysis line quotes "unknown parameter", and places no run shows are left alone (S2 guard)', () => {
    const rc = '* t\nV1 in 0 DC 0 AC 1 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n';
    const lines = ['.tran {w} 2m', '.tran 0.1m {w}', '.tran 0.1m 2m {w}', '.tran 0.1m 2m 0 {w}', '.dc V1 {w} 5 1', '.dc V1 0 {w} 1', '.dc V1 0 5 {w}',
      '.dc temp 0 {w} 10', '.ac dec {w} 1 1k', '.ac lin 10 {w} 1k', '.ac oct 10 1 {w}', '.noise v(out) V1 dec 10 1 {w}', '.noise v(out,0) V1 dec {w} 1 1k',
      '.four {w} v(out)', '.disto dec 10 1 {w}', '.sp dec 10 1 {w}', '.sens v(out) ac dec 10 1 {w}', '.noise v(out) V1 dec 10 1 1k {w}'];
    const words = ['\u200b5', '−5', '\u20095', '\u00a05', '５', '-\u200b5', '-\u20095', '\u2028' + '5', '·5', '5\u200b0', '5к', '5\u2009m'];
    let checked = 0;
    for (const line of lines) {
      for (const w of words) {
        const text = `${rc}${line.replace('{w}', w)}\n.tran 1m 2m\n.end\n`;
        const n = parseNetlist(text);
        for (const t of traps(text)) {
          if (!n.lines[t.line - 1]!.directive) continue;
          expect(t.ngspice, text).not.toContain('unknown parameter (');
          checked += 1;
        }
        // .four (ignored by a run with a results file), .disto, .sp, .sens and a .noise's points per summary have no recorded run.
        if (/^\.(four|disto|sp|sens)|1k \{w\}$/.test(line)) expect(traps(text).filter((t) => t.line === 5 && /not a number|is read as/.test(t.title)).map((t) => t.id), text).toEqual([]);
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('a .dc line with a word that is a number once its character is fixed gets that check alone, and its fix leaves no trap (S5)', () => {
    for (const text of ['* t\nV1 in 0 1\nR1 in 0 1k\n.dc V1 −5 5 1\n.end\n', '* t\nV1 in 0 1\nR1 in 0 1k\n.dc V1 0 \u200b5 1\n.end\n',
      '* t\nV1 in 0 1\nR1 in 0 1k\n.dc V1 5 -5 −1\n.end\n', '* t\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 0 5 1 V2 −1 1 0.5\n.end\n',
      '* t\nV1 in 0 1\nR1 in 0 1k\n.dc V1 0<\u2009>5 1\n.end\n'.replace('<\u2009>', '\u2009')]) {
      const found = traps(text);
      expect(found.map((t) => t.id), text).not.toContain('dc-sweep-problems');
      expect(found, text).toHaveLength(1);
      for (const x of texts(found[0]!)) expect(x).not.toMatch(/[\u200b\u2009]/);
      expect(ids(applyFix(text, found[0]!.fixes[0]!)), text).toEqual([]);
    }
  });

  it('reads a .dc sweep by place, as ngspice 47 does: a word that is no number where one goes is said there (S5; dc-sweep-problems-9, -10)', () => {
    const net = (line: string): string => `* t\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n${line}\n.end\n`;
    const letterO = first(net('.dc V1 O 5 1'), 'dc-sweep-problems');
    expect([letterO.title, letterO.ngspice, letterO.fixes.map((f) => f.label)]).toEqual(['The start of this sweep is not a number', "ngspice 47 stops: 'Bad syntax!'. [dc-sweep-problems-9, dc-sweep-problems-10]", ['Write 0']]);
    expect(letterO.why).toContain('with a letter O where the digit 0 belongs');
    expect(ids(applyFix(net('.dc V1 O 5 1'), letterO.fixes[0]!))).toEqual([]);
    // The skeptic's dead ends: no "Sweep V1 instead" that writes V1 twice, no step added to a line ngspice cannot read.
    for (const line of ['.dc V1 V1 5 1 -400m', '.dc V1 0 V1 1', '.dc V1 V1 5 1']) {
      const found = traps(net(line));
      expect(found.map((t) => [t.id, t.title]), line).toEqual([['dc-sweep-problems', `The ${line === '.dc V1 0 V1 1' ? 'stop' : 'start'} of this sweep is not a number`]]);
      expect(found[0]!.fixes, line).toEqual([]);
    }
    // A sweep with no step before the next one still gets "needs a step", and its fix (as before).
    const step = first(net('.dc V1 0 5 V2 0 1 0.5'), 'dc-sweep-problems');
    expect([step.title, step.fixes.map((f) => f.label)]).toEqual(['.dc needs a step', ['Add a step of 500m (10 steps)']]);
    expect(ids(net('.dc V1 0 5 1 V2 0 1 0.5'))).toEqual([]);
  });

  it('on a capacitor or an inductor says ngspice warns about a model, never "without a message"; on the other parts, no message (S4; invisible-character-7, look-alike-letter-7)', () => {
    const value = (letter: string, word: string, id: string): Trap => first(`* t\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR0 in a 1\n${letter}1 a 0 ${word}\n.tran 0.1m 1m\n.end\n`, id);
    for (const [word, id] of [['2\u200bu', 'invisible-character'], ['2кk', 'look-alike-letter'], ['10Μ', 'look-alike-letter'], ['4·7u', 'look-alike-letter'], ['1On', 'look-alike-letter']] as const) {
      for (const letter of ['C', 'L']) {
        const t = value(letter, word, id);
        expect(t.ngspice, `${letter} ${word}`).toContain("and only warns that it can't find a model with the word's name.");
        expect(t.ngspice, `${letter} ${word}`).not.toContain('without a message');
      }
      for (const letter of ['R', 'V', 'I']) expect(value(letter, word, id).ngspice, `${letter} ${word}`).toContain('without a message');
    }
    expect(value('C', '2\u200bu', 'invisible-character').ngspice).toContain('[invisible-character-1, invisible-character-2, invisible-character-7]');
  });

  it('a capital M from another alphabet or after a space-like character: the milli fix says what it writes, and only mega-as-milli keeps milli (words-recheck-6)', () => {
    const cases = ['* t\nI1 0 a 1u\nR1 a 0 10Μ\n.op\n.end\n', '* t\nV1 in 0 5\nR1 in 0 10\u2009MΩ\n.op\n.end\n', '* t\nV1 a 0 5\u2009MV\nR1 a 0 1\n.op\n.end\n',
      '* t\nV1 a 0 5М\nR1 a 0 1\n.op\n.end\n', '* t\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in a 1\nC1 a 0 10Ｍ\n.tran 1m 2m\n.end\n', '* t\nI1 0 n1 1\nR1 n1 0 10 M\n.op\n.end\n'];
    for (const text of cases) {
      const labels = traps(text).flatMap((t) => t.fixes.map((f) => f.label));
      expect(labels.some((l) => l.startsWith('Keep')), text).toBe(false);
      expect(labels.some((l) => /^Make it \d+m \(/.test(l)), text).toBe(true);
    }
    expect(first('* t\nI1 0 a 1u\nR1 a 0 10Μ\n.op\n.end\n', 'look-alike-letter').fixes.map((f) => f.label)).toEqual(['Make it 10meg (10\u00a0MΩ)', 'Make it 10m (10\u00a0mΩ)']);
    // ngspice reads 10M as milli, so there milli is kept.
    expect(first('* t\nI1 0 a 1u\nR1 a 0 10M\n.op\n.end\n', 'mega-as-milli').fixes.map((f) => f.label)).toEqual(['Make it 10meg (10\u00a0MΩ)', 'Keep milli: write 10m']);
  });

  it('an E, F, G or H value ngspice cannot read is no missing gain: the character check alone (S6; invisible-character-26, look-alike-letter-14)', () => {
    const lines = ['E1 b 0 a 0 {w}', 'G1 0 b a 0 {w}', 'F1 0 b V1 {w}', 'H1 b 0 V1 {w}'];
    for (const line of lines) {
      for (const [w, id] of [['\u200b2', 'invisible-character'], ['−2', 'look-alike-letter'], ['２', 'look-alike-letter'], ['\u00a02', 'nbsp'], ['\u20092', 'space-character'], ['-\u20092', 'space-character']] as const) {
        const text = `* t\nV1 a 0 1\nR0 a 0 1k\n${line.replace('{w}', w)}\nR1 b 0 1k\n.op\n.end\n`;
        const found = traps(text);
        expect(found.map((t) => t.id), text).toEqual([id]);
        expect(found[0]!.ngspice, text).not.toContain('not enough parameters');
        expect(ids(applyFix(text, found[0]!.fixes[0]!)), text).toEqual([]);
      }
    }
  });

  it('a textbook symbol where a value goes: one error, ngspice\'s own message, no comment fix; a .param name is that value (S6; unknown-word-13 to -23)', () => {
    const net = (line: string, param = ''): string => `* t\n${param}V1 a 0 1\nR0 a 0 1k\n${line}\nR1 b 0 1k\n.op\n.end\n`;
    for (const [line, word, said] of [['E1 b 0 a 0 Av', 'Av', 'av'], ['F1 0 b V1 beta', 'beta', 'beta'], ['G1 0 b a 0 gm', 'gm', 'gm'], ['H1 b 0 V1 rm', 'rm', 'rm']] as const) {
      const found = traps(net(line));
      expect(found.map((t) => t.id), line).toEqual(['unknown-word']);
      const t = found[0]!;
      expect(t.ngspice, line).toMatch(new RegExp(`^ngspice stops: 'unknown parameter \\(${said}\\)'\\. \\[unknown-word-(18|19|20|21), unknown-word-23\\]$`));
      expect(t.ngspice, line).not.toMatch(/MIF-ERROR|polynomial|PlainSpice's engine/);
      expect(t.why, line).toContain(`${word} stands where`);
      expect(t.fixes, line).toEqual([]);
      // Given on a .param line, it is the value: no trap at all (unknown-word-22).
      expect(ids(net(line, `.param ${word}=2\n`)), line).toEqual([]);
    }
    const r = first('* t\nV1 a 0 1\nR1 a 0 Rload\n.op\n.end\n', 'unknown-word');
    expect([r.title, r.ngspice]).toEqual(["R1's value is not a number", "ngspice looks for a model called rload, warns 'can't find model', and stops: 'unknown parameter (rload)'. [unknown-word-13, unknown-word-23]"]);
    expect(ids('* t\n.param Vs=5\nV1 a 0 Vs\nR1 a 0 1k\n.op\n.end\n')).toEqual([]);
    // After a value, a word is still a setting that is not one (unknown-word-1), with its comment fix.
    expect(first('* t\nV1 a 0 5\nR1 a 0 1k load\n.op\n.end\n', 'unknown-word').fixes.map((f) => f.label)).toEqual(['Make load and the rest of the line a comment']);
  });

  it('settings but no gain run with 0, silently, in native 47 too: missing-value says so (S6; missing-value-11 to -14)', () => {
    for (const line of ['E1 b 0 a 0 gain', 'G1 0 b a 0 m=2', 'F1 0 b V1 m=2', 'H1 b 0 V1 gain']) {
      const t = first(`* t\nV1 a 0 1\nR0 a 0 1k\n${line}\nR1 b 0 1k\n.op\n.end\n`, 'missing-value');
      expect(t.ngspice, line).toMatch(/^ngspice uses 0 and says nothing: in one test [EFGH]1's output stayed at 0\. \[missing-value-11, missing-value-12\]$/);
      expect(t.why, line).toContain('has settings but no');
    }
    // Nothing after the nodes keeps native 47's "not enough parameters" (missing-value-4).
    expect(first('* t\nV1 a 0 1\nR0 a 0 1k\nE1 b 0 a 0\nR1 b 0 1k\n.op\n.end\n', 'missing-value').ngspice).toContain("Native ngspice 47 stops: 'not enough parameters in line'.");
  });

  it('a 0 that another check explains is that check\'s: no "Use a 0 V source" for 0<zero-width space>.47, 0R47, 0k47 (C1)', () => {
    for (const value of ['0\u200b.47', '0．47', '0\u2009.47', '0\u00a0.47', '0R47', '0k47', '0\u200b.1meg']) {
      const text = `* t\nV1 a 0 1\nR1 a b ${value}\nR2 b 0 1\n.op\n.end\n`;
      const found = traps(text);
      expect(found, value).toHaveLength(1);
      expect(found[0]!.id, value).not.toBe('zero-ohm');
      expect(found.flatMap((t) => t.fixes.map((f) => f.label)).join(' '), value).not.toContain('0 V source');
    }
    // Straight across a source the error stays: it is the only thing that keeps 6e12 A from reading as an answer (zero-ohm-2).
    expect(traps('* t\nV1 a 0 6\nR1 a 0 0\u200b.47\n.op\n.end\n').map((t) => [t.id, t.severity])).toEqual([['invisible-character', 'warning'], ['zero-ohm', 'error']]);
    // A plain 0 keeps its warning and its fix.
    for (const value of ['0', '0R0', '-0']) {
      expect(first(`* t\nV1 a 0 1\nR1 a b ${value}\nR2 b 0 1\n.op\n.end\n`, 'zero-ohm').fixes.map((f) => f.label), value).toEqual(['Use a 0 V source instead (VR1)']);
    }
  });

  it('a sign then a character that looks like a space: one error whose fix writes the value, no glue warning, no comment fix (C2; space-character-12 to -14, nbsp-3)', () => {
    const spaces = ['\u00a0', '\u1680', '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006', '\u2007', '\u2008', '\u2009', '\u200a', '\u202f', '\u205f', '\u3000'];
    for (const ch of spaces) {
      for (const [line, written] of [['V1 a 0 {s}5', '-5'], ['I1 0 a {s}1m', '-1m'], ['R1 a 0 {s}2k', '-2k']] as const) {
        for (const sign of ['-', '+']) {
          const text = `* t\n${line.replace('{s}', `${sign}${ch}`)}\nR0 a 0 1k\n.op\n.end\n`;
          const found = traps(text);
          expect(found.map((t) => t.id), text).toEqual([ch === '\u00a0' ? 'nbsp' : 'space-character']);
          const t = found[0]!;
          expect(t.severity).toBe('error');
          expect(t.why, text).toMatch(new RegExp(`^Right after the \\${sign}, it has `));
          const want = sign === '-' ? written : written.replace('-', '+');
          expect(t.fixes.map((f) => f.label.replace(/ \(.*\)$/, '')), text).toEqual([`Write ${want}`]);
          expect(applyFix(text, t.fixes[0]!)).toContain(` ${want}\n`);
          for (const x of texts(t)) expect(x).not.toMatch(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000](?!(k|m|M|V|A|Ω|µ)?[A-Za-zΩ]*\)$)/);
        }
      }
    }
    // A minus sign from a document, then a thin space; and -<thin space>5<thin space>V read as a document writes it.
    const minus = first('* t\nV1 a 0 −\u20095\nR1 a 0 1k\n.op\n.end\n', 'space-character');
    expect([minus.why.startsWith('It starts with a minus sign (U+2212), which looks like -, then a thin space (U+2009)'), minus.fixes.map((f) => f.label)]).toEqual([true, ['Write -5 (−5\u00a0V)']]);
    expect(first('* t\nV1 a 0 -\u20095\u2009V\nR1 a 0 1k\n.op\n.end\n', 'space-character').fixes.map((f) => f.label)).toEqual(['Write -5 (−5\u00a0V)']);
  });

  it('a sign with a normal space after it is a word of its own: Write -5, not a comment that leaves 0 V (C2; space-character-13)', () => {
    const plain = first('* t\nV1 a 0 - 5\nR1 a 0 1k\n.op\n.end\n', 'unknown-word');
    expect([plain.ngspice, plain.fixes.map((f) => f.label)]).toEqual(["ngspice stops: 'unknown parameter (-)'. [space-character-13]", ['Write -5 (−5\u00a0V)']]);
    expect(applyFix('* t\nV1 a 0 - 5\nR1 a 0 1k\n.op\n.end\n', plain.fixes[0]!)).toBe('* t\nV1 a 0 -5\nR1 a 0 1k\n.op\n.end\n');
  });

  it('the letter O where a zero belongs is flagged narrowly, and a unit after a number never is (C4; look-alike-letter-10, -11)', () => {
    const r1 = (value: string): Trap[] => traps(`* t\nV1 in 0 10\nR1 in out ${value}\nR2 out 0 10k\n.op\n.end\n`);
    for (const [value, written] of [['1Ok', '10k'], ['1оk', '10k'], ['1Оk', '10k'], ['1οk', '10k'], ['1Οk', '10k'], ['1ｏk', '10k'], ['1Ｏk', '10k'], ['1о000', '10000'], ['1O00', '1000'], ['10Ok', '100k'], ['1o0k', '100k']] as const) {
      const found = r1(value);
      expect(found.map((t) => [t.id, t.severity]), value).toEqual([['look-alike-letter', 'warning']]);
      expect(found[0]!.why, value).toContain('not the digit 0');
      expect(found[0]!.fixes.map((f) => f.label.replace(/ \(.*\)$/, '')), value).toEqual([`Write ${written}`]);
    }
    for (const value of ['O.47k', 'О.47k', 'o.5']) {
      const found = r1(value);
      expect(found.map((t) => [t.id, t.title]), value).toEqual([['look-alike-letter', "R1's value starts with the letter O, not the digit 0"]]);
      expect(found[0]!.fixes.map((f) => f.label.replace(/ \(.*\)$/, '')), value).toEqual([`Write ${value.replace(/^./, '0')}`]);
    }
    // Units and words are left alone: 100Ом and 1kОм are read as meant; 10кОм keeps its к warning only.
    for (const value of ['100Ом', '1kОм', '1Ohm', '10ohm', '2Ohms', '1Ом']) expect(r1(value).map((t) => t.id), value).toEqual([]);
    expect(r1('10кОм').map((t) => [t.id, t.title])).toEqual([['look-alike-letter', "R1's value is read as 10\u00a0Ω, not 10\u00a0kΩ"]]);
    expect(r1('10кОм')[0]!.why).toContain('the Cyrillic letter к');
  });

  it('every invisible character is named, never shown, and nothing throws (C5; invisible-character-23 to -25)', () => {
    const codes: number[] = [0x85, 0x2028, 0x2029, 0x1bca0, 0x1d173, 0xe0001, 0xe0020, 0xe0041, 0xe0100, 0xe0fff];
    for (let c = 0; c <= 0xffff; c++) if (/\p{Default_Ignorable_Code_Point}/u.test(String.fromCharCode(c))) codes.push(c);
    expect(codes.length).toBeGreaterThan(70);
    for (const code of codes) {
      const ch = String.fromCodePoint(code);
      for (const text of [`* t\nV1 in 0 10\nR1 in out 4${ch}.7k\nR2 out 0 10k\n.op\n.end\n`, `* t\nV1 in 0 10\nR1 in out ${ch}4.7k\nR2 out 0 10k\n.op\n.end\n`,
        `* t\nV1 in 0 10\nR1 in out 2k\nR2 o${ch}ut 0 2k\n.op\n.end\n`]) {
        const found = traps(text);
        expect(found.length, `U+${code.toString(16)}`).toBeGreaterThan(0);
        for (const t of found) for (const x of texts(t)) expect(x.includes(ch), `U+${code.toString(16)}: ${x}`).toBe(false);
        expect(() => explainNetlist(parseNetlist(text))).not.toThrow();
        for (const e of explainNetlist(parseNetlist(text))) for (const x of [e.summary, ...e.notes, ...e.fields.map((f) => f.meaning)]) expect(x.includes(ch), `U+${code.toString(16)}: ${x}`).toBe(false);
      }
      // Inside the value: read as 4 Ω, fixed to 4.7k; at the start: an error; in a node name: joined to out.
      const inside = first(`* t\nV1 in 0 10\nR1 in out 4${ch}.7k\nR2 out 0 10k\n.op\n.end\n`, 'invisible-character');
      expect([inside.title, inside.fixes.map((f) => f.label)], `U+${code.toString(16)}`).toEqual(["R1's value is read as 4\u00a0Ω, not 4.7\u00a0kΩ", ['Write 4.7k (4.7\u00a0kΩ)']]);
      expect(first(`* t\nV1 in 0 10\nR1 in out 2k\nR2 o${ch}ut 0 2k\n.op\n.end\n`, 'invisible-character').fixes.map((f) => f.label), `U+${code.toString(16)}`).toEqual(['Take it out: connect to out']);
    }
    expect(first('* t\nI1 0 n1 1\nR1 n1 0 4\u2028.7k\n.op\n.end\n', 'invisible-character').why).toMatch(/^A line separator \(U\+2028\) sits between 4 and \.7k/);
    expect(first('* t\nI1 0 n1 1\nR1 n1 0 4\u{e0001}.7k\n.op\n.end\n', 'invisible-character').why).toMatch(/^A language tag \(U\+E0001\) sits/);
  });

  it('a document\'s decimal point is named truly and written as a point; another character outside ASCII inside a number is said without a fix (C5; look-alike-letter-9, -12, -13, space-before-suffix-18)', () => {
    const r1 = (value: string): Trap[] => traps(`* t\nV1 in 0 10\nR1 in out ${value}\nR2 out 0 10k\n.op\n.end\n`);
    for (const [ch, name] of [['·', 'a middle dot (U+00B7), which some documents use as a decimal point'], ['․', 'a one-dot leader (U+2024), which looks like a decimal point'],
      ['﹒', 'a small full stop (U+FE52), which looks like a decimal point'], ['٫', 'an Arabic decimal separator (U+066B), which is the decimal point of Arabic numbers']] as const) {
      const t = r1(`4${ch}7k`)[0]!;
      expect([t.id, t.title, t.fixes.map((f) => f.label)], ch).toEqual(['look-alike-letter', "R1's value is read as 4\u00a0Ω, not 4.7\u00a0kΩ", ['Write 4.7k (4.7\u00a0kΩ)']]);
      expect(t.why, ch).toContain(`The value has ${name}.`);
      expect(t.why, ch).not.toContain('a dash');
      expect(t.ngspice, ch).toContain('[look-alike-letter-9]');
    }
    expect(r1('·47k')[0]!.ngspice).toContain('[look-alike-letter-13]');
    // In a node name a middle dot stays the non-ascii-node check's: never "Rename a·b to a.b".
    expect(traps('* t\nV1 a·b 0 1\nR1 a·b 0 1k\n.op\n.end\n').flatMap((t) => t.fixes.map((f) => f.label)).join(' ')).not.toContain('a.b');
    // 4·7 kΩ as a British document writes it: one error, the space before the unit, and its fix writes 4.7k.
    const british = r1('4·7 kΩ');
    expect(british.map((t) => [t.id, t.fixes.map((f) => f.label)])).toEqual([['space-before-suffix', ['Write 4.7k']]]);
    expect(british[0]!.ngspice).toContain('space-before-suffix-18]');
    expect(r1('4·7\u2009kΩ').map((t) => [t.id, t.fixes.map((f) => f.label)])).toEqual([['look-alike-letter', ['Write 4.7k (4.7\u00a0kΩ)']]]);
    // An ideographic full stop, a bullet, the Greek ano teleia: what ngspice reads, and no fix.
    for (const ch of ['。', '•', '·']) {
      const t = r1(`4${ch}7k`)[0]!;
      expect([t.id, t.title, t.fixes], ch).toEqual(['look-alike-letter', "R1's value is read as 4\u00a0Ω", []]);
      expect(t.ngspice, ch).toContain('[look-alike-letter-12]');
    }
    // A unit with a letter outside ASCII after a number is no stray character: 100Ω, 1µF.
    expect(r1('100Ω').map((t) => t.id)).toEqual([]);
  });
});

describe('after the critic of the re-check fixes (12 November 2026)', () => {
  const first = (netlist: string, id: string): Trap => traps(netlist).find((t) => t.id === id)!;
  const texts = (t: Trap): string[] => [t.title, t.why, t.ngspice, ...t.fixes.map((f) => f.label)];
  const silent = /without a message|says nothing/;

  it('a resistor read as 0 is told what ngspice 47 does with 0 \u03a9, never "without a message" or "says nothing" (CR1-1; zero-ohm-4)', () => {
    const cases: [value: string, id: string, written: string][] = [
      ['0\u200b.47', 'invisible-character', '0.47'], ['0R47', 'rkm-notation', '0.47'], ['0k47', 'rkm-notation', '0.47k'],
      ['0\uff0e47', 'look-alike-letter', '0.47'], ['0\u00b747', 'look-alike-letter', '0.47'], ['0\u2009.47', 'space-character', '0.47'],
      ['0\u00a0.47', 'nbsp', '0.47'], ['0\u300247', 'look-alike-letter', ''], ['1,0', 'decimal-comma', '1.0'],
    ];
    for (const [value, id, written] of cases) {
      const text = `* t\nV1 a 0 1\nR1 a b ${value}\nR2 b 0 1\n.op\n.end\n`;
      const found = traps(text);
      expect(found.map((t) => t.id), value).toEqual([id]);
      const t = found[0]!;
      expect(t.ngspice, value).toContain("warns 'Value of resistor r1 is too small, set to 1.000000e-12'");
      expect(t.ngspice, value).toContain('zero-ohm-4');
      expect(t.ngspice, value).not.toMatch(silent);
      expect(t.severity, value).toBe('warning');
      // The fix writes what was meant (no fix for the ideographic full stop, whose meaning is a guess).
      if (written) expect(t.fixes.map((f) => applyFix(text, f)).some((x) => x.includes(`R1 a b ${written}\n`)), value).toBe(true);
    }
    // Read as 0 on a capacitor, an inductor or a source: what was recorded there, no zero-ohm words.
    expect(first('* t\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in a 1k\nC1 a 0 0\u200b.1u\n.tran 0.1m 1m\n.end\n', 'invisible-character').ngspice).toContain("only warns that it can't find a model");
    expect(first('* t\nV1 a 0 0\u200b.5\nR1 a 0 1k\n.op\n.end\n', 'invisible-character').ngspice).toContain(', without a message: it reads 0\u00a0V.');
    // A plain 0 keeps zero-ohm, and straight across a source its error stays beside the character's words.
    expect(ids('* t\nV1 a 0 1\nR1 a b 0\nR2 b 0 1\n.op\n.end\n')).toEqual(['zero-ohm']);
    expect(traps('* t\nV1 a 0 6\nR1 a 0 0\u200b.47\n.op\n.end\n').map((t) => [t.id, t.severity])).toEqual([['invisible-character', 'warning'], ['zero-ohm', 'error']]);
  });

  it('a number read short on an analysis line says what ngspice does with it there: never "without a message" where it stops or warns (CR1-2; invisible-character-28 to -44)', () => {
    const rc = '* t\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n';
    const dc = '* t\nV1 in 0 1\nR1 in 0 1k\n';
    const ac = '* t\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n';
    const no = '* t\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nR2 out 0 1k\n';
    // [netlist with {c} for the character, what the trap says, severity]
    const places: [string, string, TrapSeverity][] = [
      [`${rc}.tran 0{c}.1m 2m\n.end\n`, "it reads 0, and ngspice stops: 'TSTEP is invalid, must be greater than zero.' [", 'error'],
      [`${rc}.tran 0.1m 0{c}.5\n.end\n`, "it reads 0, and ngspice stops: 'TSTOP is invalid, must be greater than zero.' [", 'error'],
      [`${rc}.tran 0.1m 2m 1{c}m\n.end\n`, "it reads 1, which is not before the stop time, so ngspice stops: 'TSTART is invalid, must be less than TSTOP.'", 'error'],
      [`${rc}.tran 0.1 1{c}0 2\n.end\n`, "it reads 1, which is not after the start time, so ngspice stops: 'TSTART is invalid, must be less than TSTOP.'", 'error'],
      [`${dc}.dc V1 0 5 0{c}.5\n.end\n`, "it reads 0, and a step of 0 stops ngspice 47: 'Bad syntax!'. ngspice 42 never finishes.", 'error'],
      [`${dc}.dc V1 2 1{c}0 1\n.end\n`, 'it reads 1, so the sweep has no points: ngspice runs none and says nothing.', 'warning'],
      [`${ac}.ac dec 0{c}.5 1 1k\n.end\n`, "it reads 0, so ngspice warns: 'Warning, ngspice assumes default parameter(s) for ac simulation', and runs anyway with a number of points of its own.", 'warning'],
      [`${ac}.ac dec 10 0{c}.5 1k\n.end\n`, "it reads 0, and ngspice stops: 'AC startfreq <= 0'.", 'error'],
      [`${ac}.ac dec 10 100 2{c}0k\n.end\n`, 'it reads 2, which is below the start frequency, so ngspice warns: \'Warning, ngspice assumes default parameter(s) for ac simulation\', and runs anyway, up to 1000 times the start frequency (100\u00a0kHz) instead.', 'warning'],
      [`${ac}.ac dec 10 5{c}k 1\n.end\n`, 'it reads 5, which is above the stop frequency, so ngspice warns', 'warning'],
      [`${no}.noise v(out) V1 dec 0{c}.5 1 1k\n.end\n`, "it reads 0, and ngspice warns: 'Number of steps for noise measurement has to be larger than 0', then stops: 'run simulation(s) aborted'.", 'error'],
      [`${no}.noise v(out) V1 dec 10 0{c}.5 1k\n.end\n`, "it reads 0, and ngspice stops: 'Frequency of 0 is invalid'.", 'error'],
      [`${no}.noise v(out) V1 dec 10 1 0{c}.5\n.end\n`, "it reads 0, and ngspice stops: 'Frequency of 0 is invalid'.", 'error'],
      [`${no}.noise v(out) V1 dec 10 1 1{c}k\n.end\n`, "the same as the start frequency, so ngspice warns: 'Noise measurement at a single frequency ... only!'", 'warning'],
      [`${no}.noise v(out) V1 dec 10 100 2{c}0k\n.end\n`, 'which is below the start frequency, so ngspice computes no frequencies', 'warning'],
      [`${no}.noise v(out) V1 dec 10 5{c}k 1\n.end\n`, 'which is above the stop frequency, so ngspice computes no frequencies', 'warning'],
    ];
    for (const [netlist, says, severity] of places) {
      // The character does not matter: a zero-width space, or a fullwidth full stop for the point.
      for (const [ch, id] of [['\u200b', 'invisible-character'], ['\uff0e', 'look-alike-letter']] as const) {
        const text = netlist.replace('{c}', ch).replace(`${ch}.`, ch === '\uff0e' ? '\uff0e' : `${ch}.`);
        if (ch === '\uff0e' && !netlist.includes('{c}.')) continue;
        const found = traps(text);
        // One trap: the analysis checks leave the word to the character check (CR1-13), which says the consequence.
        expect(found.map((t) => t.id), text).toEqual([id]);
        expect(found[0]!.ngspice, text).toContain(says);
        expect(found[0]!.severity, text).toBe(severity);
        if (severity === 'error' || /warns/.test(says)) expect(found[0]!.ngspice, text).not.toMatch(/without a message/);
        for (const x of texts(found[0]!)) expect(x, text).not.toMatch(/[\u200b]/);
      }
    }
    // Where ngspice runs on with the number read, the words say so, with the runs that show it.
    for (const [line, claim] of [['.tran 1\u200b0u 2m', 'invisible-character-44'], ['.tran 0.1m 2m 0 1\u200b0u', 'invisible-character-44'], ['.tran 1m 2\u200bm', 'invisible-character-22']] as const) {
      expect(first(`${rc}${line}\n.end\n`, 'invisible-character').ngspice, line).toMatch(new RegExp(`without a message: it reads \\d+\\. \\[.*${claim}\\]$`));
    }
    expect(first(`${dc}.dc V1 1\u200b0 20 1\n.end\n`, 'invisible-character').ngspice).toContain('without a message: it reads 1. [invisible-character-1, invisible-character-2, invisible-character-44]');
    expect(first(`${ac}.ac dec 1\u200b0 1 1k\n.end\n`, 'invisible-character').ngspice).toContain('without a message');
    expect(first(`${no}.noise v(out) V1 dec 10 1 2\u200b0k\n.end\n`, 'invisible-character').ngspice).toContain('without a message: it reads 2.');
  });

  it('a word in a source\'s function, its AC value or a setting is said as what it is, with what ngspice says there (CR1-5; invisible-character-45 to -53)', () => {
    const src = (line: string): string => `* t\n${line}\n${line.startsWith('I') ? 'R1 out 0 1k\n' : 'R1 in out 1k\nC1 out 0 1u\n'}.tran 0.1m 2m\n.end\n`;
    const cases: [line: string, title: string, says: string, fix: string][] = [
      ['V1 in 0 PULSE(\u200b0 1 0 1n 1n 1 2)', "A word in V1's PULSE is not a number for SPICE", "ngspice stops: 'parameter value out of range or the wrong type'. [invisible-character-45]", 'Write 0'],
      ['V1 in 0 PULSE(\u22121 1 0 1n 1n 1 2)', "A word in V1's PULSE is not a number for SPICE", "'parameter value out of range or the wrong type'", 'Write -1'],
      ['V1 in 0 PULSE(-\u20091 1 0 1n 1n 1 2)', "A word in V1's PULSE is not a number for SPICE", "'parameter value out of range or the wrong type'", 'Write -1'],
      ['V1 in 0 PULSE(0 \u200b1 0 1n 1n 1 2)', "A word in V1's PULSE is not a number for SPICE", "ngspice 47 stops: 'no such parameter on this device or parameter is missing' (ngspice 42: 'no such parameter on this device'). [invisible-character-46]", 'Write 1'],
      ['I1 0 out EXP(0 \u200b1m 0 1m 1m 1m)', "A word in I1's EXP is not a number for SPICE", "'no such parameter on this device or parameter is missing'", 'Write 1m'],
      ['V1 in 0 PWL(0 0 \u200b1m 1)', "A word in V1's PWL is not a number for SPICE", "ngspice stops: 'unknown parameter (___1m)'. [invisible-character-47]", 'Write 1m'],
      ['V1 in 0 SIN(0 1 \u200b1k)', "A word in V1's SIN is not a number for SPICE", "ngspice stops: 'unknown parameter (___1k)'. [invisible-character-47]", 'Write 1k'],
      ['V1 in 0 1 AC \u200b1', "V1's AC value is not a number for SPICE", "ngspice stops: 'unknown parameter (___1)'. [invisible-character-48]", 'Write 1'],
      ['V1 in 0 AC 1 \u200b90', "V1's AC phase is not a number for SPICE", "ngspice stops: 'unknown parameter (___90)'. [invisible-character-49]", 'Write 90'],
      ['V1 in 0 dc=\u200b5', "V1's dc value is not a number for SPICE", "ngspice stops with a fatal error: 'Undefined parameter [___5]'.", 'Write 5'],
    ];
    for (const [line, title, says, fixLabel] of cases) {
      const text = src(line);
      const t = traps(text).find((x) => x.line === 2 && /character|look-alike|nbsp/.test(x.id))!;
      expect([t.title, t.severity], line).toEqual([title, 'error']);
      expect(t.ngspice, line).toContain(says);
      expect(t.fixes.map((f) => f.label), line).toEqual([fixLabel]);
      expect(ids(applyFix(text, t.fixes[0]!)).filter((id) => id !== 'dangling-node'), line).toEqual([]);
    }
    expect(first('* t\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u ic=\u200b1\n.tran 0.1m 2m uic\n.end\n', 'invisible-character').title).toBe("C1's ic value is not a number for SPICE");
    expect(first('* t\nV1 a 0 1\nR1 a 0 1k m=\u200b2\n.op\n.end\n', 'invisible-character').ngspice).toBe("ngspice stops with a fatal error: 'Undefined parameter [___2]'. [invisible-character-50, invisible-character-52, invisible-character-53]");
    // Read short: no message, never V1's value or its unit.
    const pulse = first(src('V1 in 0 PULSE(0 1\u200b0 0 1n 1n 1 2)'), 'invisible-character');
    expect([pulse.title, pulse.ngspice, pulse.fixes.map((f) => f.label)]).toEqual(["A word in V1's PULSE is read as 1, not 10",
      'ngspice stops reading the number at the zero-width space and ignores the rest of the word, without a message: it reads 1. [invisible-character-1, invisible-character-2, invisible-character-51]', ['Write 10']]);
    expect(first('* t\nV1 a 0 1\nR1 a 0 1k m=1\u200b0\n.op\n.end\n', 'invisible-character').title).toBe("R1's m value is read as 1, not 10");
    // The guard: a function's first or second word, a setting: never "unknown parameter"; a place no run shows: no trap.
    for (const line of ['V1 in 0 PULSE(\u200b0 1 0 1n 1n 1 2)', 'V1 in 0 SIN(\u200b0 1 1k)', 'V1 in 0 PWL(\u200b0 0 1m 1)', 'V1 in 0 EXP(0 \u200b1 0 1m 1m 1m)', 'V1 in 0 SFFM(0 \u200b1 1k 1 100)', 'C2 in 0 1u ic=\u200b2']) {
      for (const t of traps(src(line))) expect(t.ngspice, line).not.toContain('unknown parameter (');
    }
    expect(traps(src('V1 in 0 AM(1 \u200b1 1k 10 0)')).filter((t) => t.line === 2)).toEqual([]);
    expect(traps(src('V1 in 0 TRNOISE(\u200b1m 1n 0 0)')).filter((t) => t.line === 2)).toEqual([]);
  });

  it('a sign with a space after it is said part by part: a polynomial error natively on E, F, G and H, a model warning on C and L (CR1-3; unknown-word-25 to -32)', () => {
    const net = (line: string): string => `* t\nV1 a 0 1\nR0 a 0 1k\n${line}\nR1 b 0 1k\n.op\n.end\n`;
    for (const [line, claim] of [['E1 b 0 a 0 - 2', 25], ['F1 0 b V1 - 2', 26], ['G1 0 b a 0 - 1m', 27], ['H1 b 0 V1 + 2', 28]] as const) {
      const t = first(net(line), 'unknown-word');
      expect(t.ngspice, line).toBe(`PlainSpice's engine stops: 'unknown parameter (${line.includes('+') ? '+' : '-'})'. Native ngspice 47 and 42 read the line as a polynomial and stop: 'MIF-ERROR ... Bad real value'. [unknown-word-${claim}]`);
      expect(ids(applyFix(net(line), t.fixes[0]!)), line).toEqual([]);
    }
    for (const [line, claim] of [['C1 b 0 - 5u', 29], ['L1 b 0 + 5u', 30]] as const) {
      expect(first(net(line), 'unknown-word').ngspice, line).toMatch(new RegExp(`^ngspice looks for a model called [-+], warns 'can't find model', and stops: 'unknown parameter \\([-+]\\)'\\. \\[unknown-word-${claim}\\]$`));
    }
    expect(first(net('R2 b 0 - 5'), 'unknown-word').ngspice).toBe("ngspice stops: 'unknown parameter (-)'. [unknown-word-31]");
    expect(first(net('I1 0 b + 1m'), 'unknown-word').ngspice).toBe("ngspice stops: 'unknown parameter (+)'. [unknown-word-32]");
    expect(first('* t\nV1 a 0 - 5\nR1 a 0 1k\n.op\n.end\n', 'unknown-word').ngspice).toBe("ngspice stops: 'unknown parameter (-)'. [space-character-13]");
  });

  it('only a top-level .param line\'s names are values outside a subcircuit, after .end too (CR1-7; unknown-word-33 to -37)', () => {
    const stops = ['* t\n.subckt foo x y Vs=5\nR1 x y 1k\n.ends\nV1 a 0 Vs\nR1 a 0 1k\n.op\n.end\n', '* t\n.subckt foo x y params: Vs=5\nR1 x y 1k\n.ends\nV1 a 0 Vs\nR1 a 0 1k\n.op\n.end\n',
      '* t\n.subckt foo x y\n.param Vs=5\nR1 x y 1k\n.ends\nV1 a 0 Vs\nR1 a 0 1k\n.op\n.end\n', '* t\n.func f(x) {x*2}\nV1 a 0 f\nR1 a 0 1k\n.op\n.end\n'];
    for (const text of stops) expect(ids(text), text).toEqual(['unknown-word']);
    for (const text of ['* t\nV1 a 0 Vs\nR1 a 0 1k\n.op\n.end\n.param Vs=5\n', '* t\nV1 a 0 Vs\nR1 a 0 1k\n.op\n.end;x\n.param Vs=5\n', '* t\n.param Vs=5\nV1 a 0 Vs\nR1 a 0 1k\n.op\n.end\n']) {
      expect(ids(text), text).not.toContain('unknown-word');
    }
    // Inside a subcircuit its own parameters are left alone, as before.
    expect(ids('* t\n.subckt foo x y Rv=5\nR1 x y Rv\n.ends\nX1 a 0 foo\nV1 a 0 1\n.op\n.end\n')).not.toContain('unknown-word');
  });

  it('reads a .dc line by place: missing numbers, a number too many, braces, a .param name, a name with a hidden character, words after the second sweep (CR1-4, CR1-6, CR1-12)', () => {
    const net = (line: string): string => `* t\n.param st=1 lo=-5\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n${line}\n.end\n`;
    for (const line of ['.dc V1', '.dc V1 0', '.dc V1 0 5 1 V2', '.dc V1 0 5 1 V2 0', '.dc temp']) {
      const found = traps(net(line));
      expect(found.map((t) => [t.id, t.title.replace(/ for \w+$/, '')]), line).toEqual([['dc-sweep-problems', '.dc needs a start, a stop and a step']]);
      expect(found[0]!.ngspice, line).toMatch(/^ngspice 47 stops: 'Bad syntax!'\. ngspice 42 never finishes\. \[dc-sweep-problems-1[12]\]$/);
    }
    // A number where the second sweep's name goes: one number too many, deleted by the fix; never "Sweep V1 instead".
    for (const [line, title, fixed] of [['.dc V1 0 5 1 2', 'One number too many on this .dc line', '.dc V1 0 5 1'], ['.dc V1 0 5 1 2 3', '2 numbers too many on this .dc line', '.dc V1 0 5 1'],
      ['.dc V1 0 5 1 2 3 4 5', '4 numbers too many on this .dc line', '.dc V1 0 5 1']] as const) {
      const t = first(net(line), 'dc-sweep-problems');
      expect(t.title, line).toBe(title);
      expect(applyFix(net(line), t.fixes[0]!), line).toBe(net(fixed));
      expect(ids(net(fixed))).toEqual([]);
    }
    expect(first(net('.dc V1 0 5 1 2 3 4 5'), 'dc-sweep-problems').ngspice).toContain('[dc-sweep-problems-14]');
    // "Sweep V1 instead" never makes the line sweep the same source twice.
    const one = '* t\nV1 in 0 1\nR1 in 0 1k\n';
    expect(first(`${one}.dc V1 0 5 1 V9 0 1 0.5\n.end\n`, 'dc-sweep-problems').fixes).toEqual([]);
    expect(first(`${one}.dc V9 0 5 1\n.end\n`, 'dc-sweep-problems').fixes.map((f) => f.label)).toEqual(['Sweep V1 instead']);
    // Braces and quotes are numbers numparam works out; a .param name without them is no number, and the fix writes the braces.
    for (const line of ['.dc V1 0 5 {st}', '.dc V1 {lo} 5 1', ".dc V1 {lo} {lo*-1} 'st'"]) expect(ids(net(line)), line).toEqual([]);
    const bare = first(net('.dc V1 0 5 st'), 'dc-sweep-problems');
    expect([bare.title, bare.fixes.map((f) => f.label)]).toEqual(['The step of this sweep is not a number', ['Write {st}']]);
    expect(bare.ngspice).toContain('dc-sweep-problems-18');
    expect(ids(applyFix(net('.dc V1 0 5 st'), bare.fixes[0]!))).toEqual([]);
    // A name with a hidden character or a look-alike: named, quoted as ngspice spells it, and taken out by the fix.
    const zw = first(`${one}.dc \u200bV1 0 5 1\n.end\n`, 'dc-sweep-problems');
    expect([zw.title, zw.fixes.map((f) => f.label)]).toEqual(['A zero-width space (U+200B) hides in the name V1', ['Take it out: sweep V1']]);
    expect(zw.ngspice).toBe("ngspice stops when the sweep starts: 'Voltage source, current source, or resistor named \"___v1\" is not in the circuit'. [dc-sweep-problems-15]");
    for (const x of texts(zw)) expect(x).not.toContain('\u200b');
    expect(ids(applyFix(`${one}.dc \u200bV1 0 5 1\n.end\n`, zw.fixes[0]!))).toEqual([]);
    const fw = first(`${one}.dc V\uff11 0 5 1\n.end\n`, 'dc-sweep-problems');
    expect([fw.title, fw.fixes.map((f) => f.label), fw.ngspice.includes('"v___"')]).toEqual(['The name V1 is written with the fullwidth digit \uff11', ['Write V1'], true]);
    // ngspice ignores words after the second sweep: no trap (dc-sweep-problems-19).
    expect(ids(net('.dc V1 0 5 1 V2 0 1 0.5 7'))).toEqual([]);
    // The letter O: Write 0 for the start and the stop, never a step of 0 (CR1-8).
    expect(first(net('.dc V1 O 5 1'), 'dc-sweep-problems').fixes.map((f) => f.label)).toEqual(['Write 0']);
    expect(first(net('.dc V1 -5 O 1'), 'dc-sweep-problems').fixes.map((f) => f.label)).toEqual(['Write 0']);
    const stepO = first(net('.dc V1 0 5 O'), 'dc-sweep-problems');
    expect([stepO.fixes, stepO.why.includes('a letter O where the digit 0 belongs')]).toEqual([[], true]);
  });

  it('a .tran stop of 0 or less stops ngspice, and a word the character checks explain is left to them, with no raw character in any label (CR1-13; tran-problems-8, -9)', () => {
    const rc = '* t\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n';
    for (const line of ['.tran 0.1m 0', '.tran 0.1m -1m']) {
      const t = first(`${rc}${line}\n.end\n`, 'tran-problems');
      expect([t.title, t.severity, t.ngspice], line).toEqual(['The stop time of .tran must be more than 0', 'error', "ngspice stops: 'TSTOP is invalid, must be greater than zero.' [tran-problems-8]"]);
    }
    expect(ids(applyFix(`${rc}.tran 0.1m -1m\n.end\n`, first(`${rc}.tran 0.1m -1m\n.end\n`, 'tran-problems').fixes[0]!))).toEqual([]);
    expect(ids(`${rc}.tran 0.1m 0\u200b.5\n.end\n`)).toEqual(['invisible-character']);
    // A character after the scale letter changes nothing (invisible-character-4), and no label shows it.
    const info = first(`${rc}.tran 1 5m\u200b\n.end\n`, 'tran-problems');
    for (const x of texts(info)) expect(x).not.toContain('\u200b');
  });

  it('the letter O for a zero is caught with a unit, meg or two Os, and a lone A or F after it is a unit, never atto or femto (CR1-8, CR1-9; look-alike-letter-15)', () => {
    const r1 = (value: string): Trap[] => traps(`* t\nV1 in 0 10\nR1 in out ${value}\nR2 out 0 10k\n.op\n.end\n`);
    for (const [value, written] of [['1Ok\u03a9', '10k\u03a9'], ['1Omeg', '10meg'], ['1OOk', '100k'], ['1OkOhm', '10kOhm'], ['1Okohms', '10kohms'], ['1O\u03a9', '10'], ['1OOhm', '10']] as const) {
      const found = r1(value);
      expect(found.map((t) => t.id), value).toEqual(['look-alike-letter']);
      expect(found[0]!.fixes.map((f) => f.label.replace(/ \(.*\)$/, '')), value).toEqual([`Write ${written}`]);
      expect(ids(applyFix(`* t\nV1 in 0 10\nR1 in out ${value}\nR2 out 0 10k\n.op\n.end\n`, found[0]!.fixes[0]!)), value).toEqual([]);
    }
    for (const value of ['1Ohm', '100\u041e\u043c', '1k\u041e\u043c', '10ohm', '2Ohms', '1\u041e\u043c', '1OH']) expect(r1(value).map((t) => t.id), value).toEqual([]);
    // A lone A or F is a unit: 10 A and 10 F, written without the letter, so no fix leads to atto or femto.
    const amps = first('* t\nI1 0 a 1OA\nR1 a 0 1\n.op\n.end\n', 'look-alike-letter');
    expect([amps.title, amps.fixes.map((f) => f.label)]).toEqual(["I1's value is read as 1\u00a0A, not 10\u00a0A", ['Write 10 (10\u00a0A)']]);
    expect(ids(applyFix('* t\nI1 0 a 1OA\nR1 a 0 1\n.op\n.end\n', amps.fixes[0]!))).toEqual([]);
    const farads = first('* t\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in a 1k\nC1 a 0 1OF\n.tran 1m 2m\n.end\n', 'look-alike-letter');
    expect(farads.fixes.map((f) => f.label)).toEqual(['Write 10 (10\u00a0F)']);
    expect(first('* t\nI1 0 a 1OmA\nR1 a 0 1\n.op\n.end\n', 'look-alike-letter').fixes.map((f) => f.label)).toEqual(['Write 10mA (10\u00a0mA)']);
  });

  it('E\'s and F\'s main value is their gain in every check, G\'s and H\'s their value (CR1-14)', () => {
    const net = (line: string): string => `* t\nV1 a 0 1\nR0 a 0 1k\n${line}\nR1 b 0 1k\n.op\n.end\n`;
    expect(first(net('E1 b 0 a 0 \u200b2'), 'invisible-character').title).toBe("E1's gain is not a number for SPICE");
    expect(first(net('E1 b 0 a 0 2\u200b0'), 'invisible-character').title).toBe("E1's gain is read as a gain of 2, not a gain of 20");
    expect(first(net('F1 0 b V1 \u22122'), 'look-alike-letter').title).toBe("F1's gain is not a number for SPICE");
    expect(first(net('F1 0 b V1 -\u20092'), 'space-character').title).toBe("F1's gain is not a number for SPICE");
    expect(first(net('E1 b 0 a 0 1Ok'), 'look-alike-letter').title).toBe("E1's gain is read as a gain of 1, not a gain of 10000");
    expect(first(net('G1 0 b a 0 \u200b2m'), 'invisible-character').title).toBe("G1's value is not a number for SPICE");
  });
});
