/**
 * docs/spice-facts/explanations.md, checked against our WebAssembly engine, and the words
 * PlainSpice builds from real engine runs (src/spice/explain.ts, src/spice/describe.ts).
 *
 * 1. Every claim's netlist runs through the engine (the same code the page uses). Its vectors must
 *    agree with what native ngspice 47 gave to 6 significant figures, and its messages, its codes
 *    (src/engine/diagnostics.ts) and whether it fails must be as recorded.
 * 2. What the explanations predict must match the run: .dc and .ac point counts, the largest .tran
 *    step, the values a source has in .op, and the numbers in the sentences about V, I, E, F, G, H.
 * 3. The results in words, on the fixtures and the claims: directions, power, .tf words, sweeps,
 *    the plain words for each message, and the notes for the editor.
 *
 * The netlists and native values come from runs of native ngspice 47 and 42 on 9 Nov 2026; the
 * document shows those outputs verbatim. If a new ngspice reads a netlist differently, this test
 * fails and the document must be checked again.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { agrees } from '../../src/engine/compare.ts';
import { NgspiceEngine } from '../../src/engine/ngspice.ts';
import { interpretPlots, type AnalysisResults } from '../../src/engine/results.ts';
import type { RawPlot, RunResult } from '../../src/engine/types.ts';
import { formatSI } from '../../src/format/si.ts';
import { ABSTOL, VNTOL, annotateLines, describeCircuit, describeResults, explainDiagnostic, type ResultsInWords } from '../../src/spice/describe.ts';
import { explainLine, explainNetlist, readAnalysis } from '../../src/spice/explain.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import type { Netlist } from '../../src/spice/types.ts';

interface Fact {
  /** The claim's ID in explanations.md. */
  code: string;
  id: string;
  netlist: string;
  /** Rawfile vectors as native ngspice 47 gave them (complex vectors: the magnitude). */
  vectors?: Record<string, number | number[]>;
  /** Long vectors: our engine's point count, and native 47's first value, last value and largest step. */
  summaries?: Record<string, { points: number; first: number; last: number; maxStep?: number }>;
  /** A vector interpolated at these times on native 47's time points. */
  at?: { vector: string; times: number[]; values: number[] };
  /** Text the run prints, on stdout or stderr. */
  prints?: string[];
  /** Diagnostic codes our engine must give. */
  codes?: string[];
  /** The run gives no results. */
  fails?: true;
  /** The engine marks the numbers unreliable: ngspice's DC solution failed. */
  unreliable?: true;
}

const FACTS: Fact[] = [
  { code: 'P1', id: 'part-either-way', netlist: "* a resistor works either way round\nV1 a 0 6\nR1 a 0 2\nV2 b 0 6\nR2 0 b 2\n.options savecurrents\n.op\n.end\n", vectors: { "v(a)": 6, "v(b)": 6, "i(v1)": -3, "i(v2)": -3, "i(@r1[i])": 3, "i(@r2[i])": -3 } },
  { code: 'P2', id: 'part-line-order', netlist: "* the order of the lines does not matter\nF1 0 n1 Vx 2\nR1 n1 0 4\nR2 x n1 2\nVx a x 0\nItest 0 a 1\n.op\n.end\n", vectors: { "v(a)": 14, "v(x)": 14, "v(n1)": 12, "i(vx)": 1 } },
  { code: 'P3', id: 'part-vsource', netlist: "* a voltage source sets V(+) - V(-)\nV1 n1 0 6\nR1 n1 0 2\nV2 0 n2 6\nR2 n2 0 2\nV3 a 0 10\nV4 a b 6\nR3 b 0 2\nV5 c 0 6\nV6 c d -3\nR4 d 0 2\n.op\n.end\n", vectors: { "v(n1)": 6, "v(n2)": -6, "v(a)": 10, "v(b)": 4, "v(c)": 6, "v(d)": 9 } },
  { code: 'P3b', id: 'part-vsource-sin-op', netlist: "* a voltage source of -3 V with a SIN, in .op\nV1 a b -3 SIN(0 1 1k)\nR1 a 0 1k\nR2 b 0 1k\n.op\n.end\n", vectors: { "v(a)": -1.5, "v(b)": 1.5, "i(v1)": 0.0015 }, prints: ["v1: dc value used for op instead of transient time=0 value."] },
  { code: 'P3b', id: 'part-vsource-sin-tran', netlist: "* a voltage source of -3 V with a SIN, in .tran\nV1 a b -3 SIN(0 1 1k)\nR1 a 0 1k\nR2 b 0 1k\n.tran 0.1m 2m\n.end\n", summaries: { "time": { points: 59, first: 0, last: 0.002, maxStep: 0.00004 } }, at: { vector: "v(a)", times: [0, 0.00025, 0.00075], values: [0, 0.4995426745460798, -0.49607160000231176] }, prints: ["v1: dc value used for op instead of transient time=0 value."] },
  { code: 'P4', id: 'part-isource', netlist: "* a current source pushes current from its first node to its second\nI1 0 a 3\nR1 a 0 4\nI2 b 0 3\nR2 b 0 4\nI3 0 c -3\nR3 c 0 4\n.op\n.end\n", vectors: { "v(a)": 12, "v(b)": -12, "v(c)": -12 } },
  { code: 'P4b', id: 'part-isource-swept', netlist: "* a current source of -2 mA swept by .dc\nI1 a 0 -2m\nR1 a 0 1k\n.dc I1 -5m 5m 1m\n.end\n", vectors: { "i(i-sweep)": [-0.005, -0.004, -0.003, -0.002, -0.001, 0, 0.001, 0.002, 0.003, 0.004, 0.005], "v(a)": [5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5] } },
  { code: 'P4c', id: 'part-isource-sin-op', netlist: "* a current source of -2 mA with a SIN, in .op\nI1 a 0 -2m SIN(0 1m 1k)\nR1 a 0 1k\n.op\n.end\n", vectors: { "v(a)": 2 }, prints: ["i1: dc value used for op instead of transient time=0 value."] },
  { code: 'P4c', id: 'part-isource-sin-tran', netlist: "* a current source of -2 mA with a SIN, in .tran\nI1 a 0 -2m SIN(0 1m 1k)\nR1 a 0 1k\n.tran 0.1m 2m\n.end\n", summaries: { "time": { points: 59, first: 0, last: 0.002, maxStep: 0.00004 } }, at: { vector: "v(a)", times: [0, 0.00025, 0.00075], values: [0, -0.9990853490921596, 0.9921432000046235] }, prints: ["i1: dc value used for op instead of transient time=0 value."] },
  { code: 'P5', id: 'part-vcvs', netlist: "* E: the voltage at out1 is 2 x the voltage at c\nV1 c 0 2\nE1 out1 0 c 0 2\nR1 out1 0 1\nE2 out2 0 0 c 2\nR2 out2 0 1\n.op\n.end\n", vectors: { "v(c)": 2, "v(out1)": 4, "v(out2)": -4 } },
  { code: 'P6', id: 'part-vccs', netlist: "* G: 0.5 amps for every volt at c, pushed from ground into out2\nV1 c 0 2\nG1 0 out2 c 0 0.5\nR2 out2 0 1\nG2 out3 0 c 0 0.5\nR3 out3 0 1\n.op\n.end\n", vectors: { "v(c)": 2, "v(out2)": 1, "v(out3)": -1 } },
  { code: 'P7', id: 'part-cccs', netlist: "* F: 3 x the current in Vs, pushed from ground into out3\nV1 c 0 2\nVs c d 0\nRd d 0 1\nF1 0 out3 Vs 3\nR3 out3 0 1\n.op\n.end\n", vectors: { "i(vs)": 2, "v(out3)": 6 } },
  { code: 'P8', id: 'part-ccvs', netlist: "* H: the voltage at out4 is 4 volts for every amp in Vs\nV1 c 0 2\nVs c d 0\nRd d 0 1\nH1 out4 0 Vs 4\nR4 out4 0 1\n.op\n.end\n", vectors: { "i(vs)": 2, "v(out4)": 8 } },
  { code: 'P9', id: 'part-ammeter', netlist: "* a 0 V source measures the current in its branch\nV1 a 0 6\nVx a b 0\nR1 b 0 2\n.op\n.end\n", vectors: { "v(a)": 6, "v(b)": 6, "i(vx)": 3 } },
  { code: 'P10', id: 'part-control-not-vsource', netlist: "* F can only read the current of a voltage source\nV1 a 0 6\nR1 a 0 2\nF1 0 o R1 2\nR2 o 0 1\n.op\n.end\n", prints: ["unknown controlling source r1"], fails: true },
  { code: 'P10b', id: 'part-control-e-h', netlist: "* F reading the current of an E source, H reading the current of an H source\nV1 a 0 6\nE1 e 0 a 0 1\nRe e 0 3\nF1 0 p E1 1\nRp p 0 1\nVs a b 0\nRb b 0 6\nH1 h 0 Vs 2\nRh h 0 1\nH2 k 0 H1 3\nRk k 0 1\n.op\n.end\n", vectors: { "i(e1)": -2, "v(p)": -2, "i(vs)": 1, "v(h)": 2, "i(h1)": -2, "v(k)": -6 } },
  { code: 'P10c', id: 'part-control-inductor', netlist: "* F reading the current of an inductor\nV1 a 0 6\nL1 a b 1m\nR1 b 0 2\nF1 0 o L1 2\nR2 o 0 1\n.op\n.end\n", prints: ["unknown controlling source l1"], fails: true },
  { code: 'P10d', id: 'part-control-b', netlist: "* F reading a B source with V=\nV1 a 0 6\nB1 c 0 V=2*v(a)\nRc c 0 6\nF2 0 q B1 1\nRq q 0 1\n.op\n.end\n", vectors: { "v(c)": 12, "v(q)": -2, "i(b1)": -2 } },
  { code: 'P11', id: 'part-cap-open', netlist: "* in .op a capacitor is an open circuit\nV1 a 0 6\nR1 a b 2\nC1 b 0 1u\nR2 b 0 4\n.options savecurrents\n.op\n.end\n", vectors: { "v(a)": 6, "v(b)": 4, "i(v1)": -1, "i(@c1[i])": 0, "i(@r2[i])": 1 } },
  { code: 'P12', id: 'part-ind-short', netlist: "* in .op an inductor is a short circuit\nV1 a 0 6\nR1 a b 2\nL1 b c 1m\nR2 c 0 4\n.op\n.end\n", vectors: { "v(b)": 4, "v(c)": 4, "i(l1)": 1 } },
  { code: 'P13', id: 'part-zero-ohm', netlist: "* a 0 ohm resistor\nV1 a 0 6\nR1 a b 0\nR2 b 0 1k\n.op\n.end\n", vectors: { "v(b)": 5.999999999999994, "i(v1)": -0.005859375 }, prints: ["Value of resistor r1 is too small, set to 1.000000e-12"], codes: ["resistor-too-small"] },
  { code: 'P14', id: 'part-negative-r', netlist: "* a negative resistance is accepted without a message\nI1 0 n1 1\nR1 n1 0 -2\n.op\n.end\n", vectors: { "v(n1)": -2 } },
  { code: 'P15', id: 'part-r-no-value', netlist: "* a resistor with no value\nV1 a 0 6\nR0 a 0 3\nR1 a 0\n.op\n.end\n", vectors: { "v(a)": 6, "i(v1)": -2 }, prints: ["'r1 a 0' is not a valid resistor instance line, ignored!"], codes: ["line-ignored"] },
  { code: 'P15b', id: 'part-cl-no-value', netlist: "* a capacitor and an inductor with no value\nV1 a 0 6\nR1 a b 2\nC1 b 0\nL1 b c\nR2 b 0 4\n.op\n.end\n", vectors: { "v(b)": 4 }, prints: ["'c1 b 0' is not a valid capacitor instance line, ignored!","'l1 b c' is not a valid inductor instance line, ignored!"] },
  { code: 'P16', id: 'part-v-no-value', netlist: "* a source with no DC value\nV1 a 0\nR1 a 0 1\nV2 b 0 AC 1\nR2 b 0 1\nI1 0 c\nR3 c 0 1\n.op\n.end\n", vectors: { "v(a)": 0, "v(b)": 0, "v(c)": 0 }, prints: ["v1: has no value, DC 0 assumed","v2: has no value, DC 0 assumed","i1: has no value, DC 0 assumed"], codes: ["no-value-dc0"] },
  { code: 'P16b', id: 'part-v-dc-no-number', netlist: "* a source with dc but no number after it\nV1 a 0 dc\nR1 a 0 1\nV2 b 0 dc AC 1\nR2 b 0 1\nI1 0 c dc\nR3 c 0 1\n.op\n.end\n", vectors: { "v(a)": 0, "v(b)": 0, "v(c)": 0 } },
  { code: 'P17', id: 'part-tran-func-op', netlist: "* in .op a PULSE, SIN, PWL or EXP source uses its value at time 0\nV1 a 0 PULSE(1 3 1m 1m 2m 3m 10m)\nR1 a 0 1\nV2 b 0 SIN(2 1 1k)\nR2 b 0 1\nV3 c 0 PWL(0 4 1m 5)\nR3 c 0 1\nV4 d 0 EXP(3 5 1m 1m)\nR4 d 0 1\n.op\n.end\n", vectors: { "v(a)": 1, "v(b)": 2, "v(c)": 4, "v(d)": 3 } },
  { code: 'P18', id: 'part-pulse', netlist: "* PULSE(V1 V2 TD TR TF PW PER)\nV1 a 0 PULSE(1 3 1m 1m 2m 3m 10m)\nR1 a 0 1\n.tran 0.1m 13m\n.end\n", summaries: { "time": { points: 156, first: 0, last: 0.013000000000000001, maxStep: 0.0001 } }, at: { vector: "v(a)", times: [0, 0.001, 0.002, 0.005, 0.006, 0.007, 0.011, 0.012], values: [1, 1, 3, 3, 2, 1, 1, 3] } },
  { code: 'P19', id: 'part-sin', netlist: "* SIN(VO VA FREQ TD)\nV1 a 0 SIN(1 2 1k 1m)\nR1 a 0 1\n.tran 1u 2m\n.end\n", summaries: { "time": { points: 2008, first: 0, last: 0.002, maxStep: 0.000001 } }, at: { vector: "v(a)", times: [0, 0.0005, 0.001, 0.00125, 0.0015, 0.00175, 0.002], values: [1, 1, 1.00253337901, 2.99999204116, 0.999999992666, -0.999992041161, 1] } },
  { code: 'P19b', id: 'part-sin-phase', netlist: "* SIN with a phase of 90 degrees\nV1 a 0 SIN(0 1 1k 0 0 90)\nR1 a 0 1\n.tran 1u 1m\n.end\n", summaries: { "time": { points: 1008, first: 0, last: 0.001, maxStep: 0.000001 } }, at: { vector: "v(a)", times: [0, 0.00025, 0.0005], values: [1, -3.66716992276e-9, -0.999996020581] } },
  { code: 'P19c', id: 'part-sin-damping', netlist: "* SIN with damping\nV1 b 0 SIN(0 1 1k 0 1000)\nR1 b 0 1\n.tran 1u 1m\n.end\n", summaries: { "time": { points: 1008, first: 0, last: 0.001, maxStep: 0.000001 } }, at: { vector: "v(b)", times: [0, 0.00025, 0.00075], values: [0, 0.778797761047, -0.472364719791] } },
  { code: 'P20', id: 'part-pwl', netlist: "* PWL(t1 v1 t2 v2 ...)\nV1 a 0 PWL(0 0 1m 5 2m 5 3m 0)\nR1 a 0 1\n.tran 0.1m 4m\n.end\n", summaries: { "time": { points: 67, first: 0, last: 0.004, maxStep: 0.00008 } }, at: { vector: "v(a)", times: [0, 0.0005, 0.001, 0.002, 0.0025, 0.003, 0.004], values: [0, 2.5, 5, 5, 2.5, 5.55111512313e-17, 0] } },
  { code: 'P20b', id: 'part-exp', netlist: "* EXP(V1 V2 TD1 TAU1 TD2 TAU2)\nV1 a 0 EXP(0 1 1m 1m 3m 1m)\nR1 a 0 1\n.tran 1u 5m\n.end\n", summaries: { "time": { points: 5008, first: 0, last: 0.005, maxStep: 0.000001 } }, at: { vector: "v(a)", times: [0, 0.001, 0.002, 0.003, 0.004], values: [0, 0.000201571778641, 0.632120521741, 0.864463131341, 0.318092404872] } },
  { code: 'P21', id: 'part-k-coupling', netlist: "* K couples two inductors by name\nV1 a 0 AC 1\nR0 a p 1\nL1 p 0 1m\nL2 b 0 1m\nR1 b 0 1k\nK1 L1 L2 0.9\nR2 a q 1\nL3 q 0 1m\nL4 d 0 1m\nR3 d 0 1k\n.ac lin 1 1k 1k\n.end\n", vectors: { "frequency": 1000, "v(b)": 0.8881110720920539, "v(d)": 0 } },
  { code: 'P22', id: 'part-blank-lines', netlist: "* blank lines are ignored\n\nV1 n1 0 6\n\n\nR1 n1 0 2\n\n.op\n\n.end\n", vectors: { "v(n1)": 6, "i(v1)": -3 } },
  { code: 'P23', id: 'part-ic-uic', netlist: "* ic= with .tran uic\nV1 in 0 0\nR1 in out 1k\nC1 out 0 1u ic=2\n.tran 10u 1m uic\n.end\n", summaries: { "time": { points: 111, first: 1e-7, last: 0.001, maxStep: 0.00001 }, "v(out)": { points: 111, first: 1.9998000199980004, last: 0.7357530610830221 } } },
  { code: 'P24', id: 'part-tiny-r', netlist: "* 3a on a resistor\nI1 0 n1 1\nR1 n1 0 3a\n.op\n.end\n", vectors: { "v(n1)": 1e-12 }, prints: ["Value of resistor r1 is too small, set to 1.000000e-12"], codes: ["resistor-too-small"] },
  { code: 'A1', id: 'an-op-vectors', netlist: "* .op: what it saves\nV1 a 0 10\nR1 a b 2\nL1 b c 1m\nR2 c 0 3\nC1 c 0 1u\nI1 0 c 1\nE1 e 0 c 0 2\nRE e 0 4\nVs c d 0\nRD d 0 5\nF1 0 f Vs 3\nRF f 0 1\nG1 0 g c 0 0.1\nRG g 0 1\nH1 h 0 Vs 7\nRH h 0 1\n.op\n.end\n", vectors: { "v(a)": 10, "v(b)": 5.806451612903226, "v(c)": 5.806451612903226, "v(e)": 11.612903225806452, "v(d)": 5.806451612903226, "v(f)": 3.483870967741936, "v(g)": 0.5806451612903226, "v(h)": 8.129032258064516, "i(vs)": 1.1612903225806452, "i(h1)": -8.129032258064516, "i(l1)": 2.096774193548387, "i(e1)": -2.903225806451613, "i(v1)": -2.096774193548387 } },
  { code: 'A2', id: 'an-savecurrents', netlist: "* .op with .options savecurrents\nV1 a 0 10\nR1 a b 2\nL1 b c 1m\nR2 c 0 3\nC1 c 0 1u\nI1 0 c 1\nE1 e 0 c 0 2\nRE e 0 4\nVs c d 0\nRD d 0 5\nF1 0 f Vs 3\nRF f 0 1\nG1 0 g c 0 0.1\nRG g 0 1\nH1 h 0 Vs 7\nRH h 0 1\n.options savecurrents\n.op\n.end\n", vectors: { "v(a)": 10, "v(b)": 5.806451612903226, "v(c)": 5.806451612903226, "v(e)": 11.612903225806452, "v(d)": 5.806451612903226, "v(f)": 3.483870967741936, "v(g)": 0.5806451612903226, "v(h)": 8.129032258064516, "i(vs)": 1.1612903225806452, "i(h1)": -8.129032258064516, "i(l1)": 2.096774193548387, "i(e1)": -2.903225806451613, "i(v1)": -2.096774193548387, "i(@r1[i])": 2.096774193548387, "i(@l1[i])": 2.096774193548387, "i(@r2[i])": 1.935483870967742, "i(@c1[i])": 0, "i(@i1[current])": 1, "i(@re[i])": 2.903225806451613, "i(@rd[i])": 1.1612903225806452, "i(@f1[i])": 3.483870967741936, "i(@rf[i])": 3.483870967741936, "i(@g1[i])": 0.5806451612903226, "i(@rg[i])": 0.5806451612903226, "i(@rh[i])": 8.129032258064516 } },
  { code: 'A2b', id: 'an-savecurrents-semiconductors', netlist: "* savecurrents with a diode, a BJT and a MOSFET\nV1 a 0 5\nR1 a b 1k\nD1 b 0 dmod\n.model dmod D\nVc c 0 5\nVb bb 0 0.7\nQ1 c bb 0 qm\n.model qm npn\nM1 c bb 0 0 nm\n.model nm nmos\n.options savecurrents\n.op\n.end\n", vectors: { "i(@d1[id])": 0.004307674725988779, "i(@q1[ic])": 0.00005670347201442283, "i(@m1[id])": 0.0000049000050100000015 } },
  { code: 'A3', id: 'an-tf', netlist: "* F4: output impedance at v(a) with .tf\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\nR3 n1 a 2\n.tf v(a) V1\n.end\n", vectors: { "v(Transfer_function)": 0.33333333333333337, "v(v1#Input_impedance)": 9, "v(output_impedance_at_V(a))": 4 } },
  { code: 'A3b', id: 'an-tf-gnd', netlist: "* .tf: gnd in v( ) is ground, even beside an ordinary node called gnd\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nR3 in x 1k\nVx x gnd\nR4 x 0 1k\n.tf v(out,gnd) V1\n.end\n", vectors: { "v(Transfer_function)": 0.5, "v(v1#Input_impedance)": 1000, "v(output_impedance_at_V(out,0))": 500 }, prints: ["vx: has no value, DC 0 assumed"], codes: ["no-value-dc0"] },
  { code: 'A3b-op', id: 'an-tf-gnd-op', netlist: "* .op beside the .tf of a3b: the ordinary node gnd\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nR3 in x 1k\nVx x gnd\nR4 x 0 1k\n.op\n.end\n", vectors: { "v(in)": 5, "v(out)": 2.5, "v(x)": 2.5, "v(gnd)": 2.5, "i(vx)": 0, "i(v1)": -0.004999999999999999 }, prints: ["vx: has no value, DC 0 assumed"], codes: ["no-value-dc0"] },
  { code: 'A3b-alone', id: 'an-tf-gnd-alone', netlist: "* .tf v(gnd): the voltage at ground, even beside an ordinary node called gnd\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nR3 in x 1k\nVx x gnd\nR4 x 0 1k\n.tf v(gnd) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 1000, "v(output_impedance_at_V(0))": 0 }, prints: ["vx: has no value, DC 0 assumed"], codes: ["no-value-dc0"] },
  { code: 'A3c', id: 'an-tf-after-end', netlist: "* a .tf written after .end\nV1 in 0 5\nR1 in out 1k\nR2 out mid 1k\nR3 mid 0 1k\n.end\n.tf v(out,mid) V1\n", vectors: { "v(Transfer_function)": 0.3333333333333333, "v(v1#Input_impedance)": 2999.9999999999995, "v(output_impedance_at_V(out,mid))": 666.6666666666667 } },
  { code: 'A3d', id: 'an-tf-isource-after-end', netlist: "* .tf with a current source as the input, written after .end\nI1 0 a 1\nR1 a 0 4\nR2 a b 2\nR3 b 0 2\n.end\n.tf v(b) I1\n", vectors: { "v(Transfer_function)": 1, "v(i1#Input_impedance)": 2, "v(output_impedance_at_V(b))": 1.5 } },
  { code: 'A3e', id: 'an-tf-current-after-end', netlist: "* .tf from a current source to a current, written after .end\nI1 0 a 1\nR1 a b 2\nVm b c 0\nR2 c 0 3\nR3 b 0 6\n.end\n.tf i(Vm) I1\n", vectors: { "v(Transfer_function)": 0.6666666666666667, "v(i1#Input_impedance)": 4, "v(vm#Output_impedance)": 100000000000000000000 } },
  { code: 'A3f', id: 'an-tf-subckt', netlist: "* a .tf inside a subcircuit, and one in the main circuit\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.tf v(a,gnd) V1\n.ends\n.tf v(out) V1\n.end\n", vectors: { "v(Transfer_function)": 0.5, "v(v1#Input_impedance)": 2000, "v(output_impedance_at_V(out))": 500 } },
  { code: 'A3f', id: 'an-tf-subckt-op', netlist: "* a .tf only inside a subcircuit, with .op in the main circuit\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.tf v(a,gnd) V1\n.ends\n.op\n.end\n", vectors: { "v(in)": 5, "v(out)": 2.5, "i(v1)": -0.0025 } },
  { code: 'A3f', id: 'an-tf-subckt-alone', netlist: "* a .tf only inside a subcircuit, and no other analysis\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.tf v(a,gnd) V1\n.ends\n.end\n", fails: true },
  { code: 'A3f', id: 'an-op-subckt', netlist: "* .op only inside a subcircuit\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.op\n.ends\n.end\n", fails: true },
  { code: 'A3f', id: 'an-dc-subckt', netlist: "* .dc only inside a subcircuit\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.dc V1 0 5 1\n.ends\n.end\n", fails: true },
  { code: 'A3f', id: 'an-tran-subckt', netlist: "* .tran only inside a subcircuit\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.tran 1m 5m\n.ends\n.end\n", fails: true },
  { code: 'A3f', id: 'an-ac-subckt', netlist: "* .ac only inside a subcircuit\nV1 in 0 AC 1\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.ac dec 1 1k 10k\n.ends\n.end\n", fails: true },
  { code: 'A3f', id: 'an-noise-subckt', netlist: "* .noise only inside a subcircuit\nV1 in 0 AC 1\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.noise v(out) V1 dec 1 1k 10k\n.ends\n.end\n", fails: true },
  { code: 'A3f', id: 'an-tf-subckt-used', netlist: "* a .tf inside a used subcircuit naming a top node\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nX1 out 0 s\n.subckt s a b\nR9 a b 1k\n.tf v(out) V1\n.ends\n.op\n.end\n", vectors: { "v(out)": 1.6666666666666665, "v(Transfer_function)": 0.3333333333333333, "v(v1#Input_impedance)": 1499.9999999999998, "v(output_impedance_at_V(out))": 333.3333333333333 } },
  { code: 'A3f', id: 'an-tf-subckt-port', netlist: "* a .tf on a port node inside a used subcircuit\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nX1 out 0 s\n.subckt s a b\nR9 a b 1k\n.tf v(a) V1\n.ends\n.op\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 1499.9999999999998, "v(output_impedance_at_V(a))": 1 } },
  { code: 'A3f', id: 'an-tf-subckt-twice', netlist: "* a .tf inside a subcircuit used twice\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nX1 out 0 s\nX2 in 0 s\n.subckt s a b\nR9 a b 1k\n.tf v(out) V1\n.ends\n.op\n.end\n", vectors: { "v(Transfer_function)": 0.3333333333333333, "v(v1#Input_impedance)": 600, "v(output_impedance_at_V(out))": 333.3333333333333 } },
  { code: 'A4', id: 'an-tf-isource', netlist: "* .tf with a current source as the input\nI1 0 a 1\nR1 a 0 4\nR2 a b 2\nR3 b 0 2\n.tf v(b) I1\n.end\n", vectors: { "v(Transfer_function)": 1, "v(i1#Input_impedance)": 2, "v(output_impedance_at_V(b))": 1.5 } },
  { code: 'A5', id: 'an-tf-current-out', netlist: "* .tf with a current as the output\nV1 a 0 10\nR1 a b 2\nVm b c 0\nR2 c 0 3\nR3 b 0 6\n.tf i(Vm) V1\n.end\n", vectors: { "v(Transfer_function)": 0.16666666666666666, "v(v1#Input_impedance)": 4, "v(vm#Output_impedance)": 100000000000000000000 } },
  { code: 'A6', id: 'an-tf-missing-node', netlist: "* .tf names a node that is not in the circuit\nV1 n1 0 6\nR1 n1 0 2\n.tf v(n9) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 2, "v(output_impedance_at_V(n9))": 1 } },
  { code: 'A7', id: 'an-dc-13', netlist: "* D1: a divider swept from 0 to 12 V with .dc\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 0 12 1\n.end\n", vectors: { "v(v-sweep)": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], "v(out)": [0, 0.6666666666666666, 1.3333333333333333, 2, 2.6666666666666665, 3.333333333333333, 4, 4.666666666666666, 5.333333333333333, 6, 6.666666666666666, 7.333333333333332, 8] } },
  { code: 'A8', id: 'an-dc-tenths', netlist: "* .dc in steps of 0.1\nV1 in 0 0\nR1 in 0 1k\n.dc V1 0 1 0.1\n.end\n", vectors: { "v(v-sweep)": [0, 0.1, 0.2, 0.30000000000000004, 0.4, 0.5, 0.6, 0.7, 0.7999999999999999, 0.8999999999999999, 0.9999999999999999] } },
  { code: 'A9', id: 'an-dc-partial', netlist: "* .dc with a step that does not divide the range\nV1 in 0 0\nR1 in 0 1k\n.dc V1 0 12 5\n.end\n", vectors: { "v(v-sweep)": [0, 5, 10] } },
  { code: 'A10', id: 'an-dc-down', netlist: "* .dc sweeping downwards\nV1 in 0 0\nR1 in 0 1k\n.dc V1 12 0 -3\n.end\n", vectors: { "v(v-sweep)": [12, 9, 6, 3, 0] } },
  { code: 'A11', id: 'an-dc-empty', netlist: "* .dc with start above stop\nV1 in 0 0\nR1 in 0 1k\n.dc V1 12 0 1\n.end\n", prints: ["No. of Data Rows : 0"], codes: ["rawfile"], fails: true },
  { code: 'A12', id: 'an-dc-nested', netlist: "* a nested .dc sweep\nV1 a 0 0\nR1 a 0 1k\nV2 b 0 0\nR2 b 0 1k\n.dc V1 0 2 1 V2 0 1 1\n.end\n", vectors: { "v(v-sweep)": [0, 1, 2, 0, 1, 2], "v(a)": [0, 1, 2, 0, 1, 2], "v(b)": [0, 0, 0, 1, 1, 1] } },
  { code: 'A13', id: 'an-dc-isweep', netlist: "* .dc sweeping a current source\nI1 0 a 0\nR1 a 0 2\n.dc I1 0 3 1\n.end\n", vectors: { "i(i-sweep)": [0, 1, 2, 3], "v(a)": [0, 2, 4, 6] } },
  { code: 'A14', id: 'an-dc-rsweep', netlist: "* .dc sweeping a resistor\nV1 a 0 6\nR1 a b 1k\nR2 b 0 1k\n.dc R2 1k 3k 1k\n.end\n", vectors: { "res-sweep": [1000, 2000, 3000], "v(a)": [6, 6, 6], "v(b)": [3, 4, 4.5], "i(v1)": [-0.003, -0.002, -0.0014999999999999996] } },
  { code: 'A15', id: 'an-dc-temp', netlist: "* .dc sweeping the temperature\nV1 a 0 6\nR1 a 0 1k\n.dc TEMP 0 100 50\n.end\n", vectors: { "temp-sweep": [0, 50, 100], "v(a)": [6, 6, 6], "i(v1)": [-0.006, -0.006, -0.006] } },
  { code: 'A16', id: 'an-tran-tstep', netlist: "* T1 (ours): an RC circuit charging, with .tran\nV1 in 0 PULSE(0 5 0 1u 1u 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m\n.end\n", summaries: { "time": { points: 520, first: 0, last: 0.005, maxStep: 0.00001 }, "v(out)": { points: 520, first: 0, last: 4.9662948154327164 } } },
  { code: 'A17', id: 'an-tran-fiftieth', netlist: "* .tran with a large tstep\nV1 in 0 PULSE(0 5 0 1u 1u 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 1m 5m\n.end\n", summaries: { "time": { points: 73, first: 0, last: 0.005, maxStep: 0.0001 } } },
  { code: 'A18', id: 'an-tran-tmax', netlist: "* .tran with tmax\nV1 in 0 PULSE(0 5 0 1u 1u 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m 0 2u\n.end\n", summaries: { "time": { points: 2517, first: 0, last: 0.005, maxStep: 0.000002 } } },
  { code: 'A19', id: 'an-tran-tstart', netlist: "* .tran with tstart\nV1 in 0 PULSE(0 5 0 1u 1u 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m 2m\n.end\n", summaries: { "time": { points: 301, first: 0.0020052993070292045, last: 0.005, maxStep: 0.00001 } } },
  { code: 'A20', id: 'an-ac-dec', netlist: "* .ac with 10 points per decade\nV1 a 0 AC 1\nR1 a b 1k\nC1 b 0 1u\n.ac dec 10 1 1k\n.end\n", summaries: { "frequency": { points: 31, first: 1, last: 1000.000000000002, maxStep: 205.671765276 } } },
  { code: 'A21', id: 'an-ac-oct', netlist: "* .ac with 2 points per octave\nV1 a 0 AC 1\nR1 a b 1k\nC1 b 0 1u\n.ac oct 2 1 8\n.end\n", vectors: { "frequency": [1, 1.414213562373095, 1.9999999999999996, 2.8284271247461894, 3.9999999999999987, 5.656854249492378, 7.9999999999999964] } },
  { code: 'A22', id: 'an-ac-lin', netlist: "* .ac with 5 points in all\nV1 a 0 AC 1\nR1 a b 1k\nC1 b 0 1u\n.ac lin 5 1 2\n.end\n", vectors: { "frequency": [1, 1.25, 1.5, 1.75, 2] } },
  { code: 'A22b', id: 'an-ac-lin-two', netlist: "* .ac lin 2\nV1 a 0 AC 1\nR1 a b 1k\nC1 b 0 1u\n.ac lin 2 1 2\n.end\n", vectors: { "frequency": 1 } },
  { code: 'A23', id: 'an-param', netlist: "* .param gives a name to a number\n.param rval=2k\nI1 0 n1 1m\nR1 n1 0 {rval}\n.op\n.end\n", vectors: { "v(n1)": 2 } },
  { code: 'A24', id: 'an-save', netlist: "* .save keeps only what it names\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.save v(out)\n.op\n.end\n", vectors: { "v(out)": 4 } },
  { code: 'A25', id: 'an-print-ignored', netlist: "* .print naming a node that does not exist\nV1 a 0 6\nR1 a 0 2\n.print dc v(b)\n.dc V1 0 6 3\n.end\n", vectors: { "v(v-sweep)": [0, 3, 6], "v(a)": [0, 3, 6], "i(v1)": [0, -1.5, -3] }, prints: [".print line ignored since rawfile was produced."] },
  { code: 'A25b', id: 'an-plot-ignored', netlist: "* .plot in a run that writes a results file\nV1 a 0 6\nR1 a 0 2\n.plot dc v(a)\n.dc V1 0 6 3\n.end\n", vectors: { "v(v-sweep)": [0, 3, 6], "v(a)": [0, 3, 6], "i(v1)": [0, -1.5, -3] }, prints: [".plot line ignored since rawfile was produced."] },
  { code: 'A26', id: 'an-include', netlist: "* .include a file\n.include models.lib\nV1 a 0 6\nR1 a 0 2\n.op\n.end\n", prints: ["Could not find include file models.lib"], codes: ["fatal"], fails: true },
  { code: 'A27', id: 'an-control', netlist: "* a .control block next to a .op line\nV1 a 0 6\nR1 a 0 2\n.op\n.control\nprint v(a)\n.endc\n.end\n", vectors: { "v(a)": 6, "i(v1)": -3 }, prints: ["vector a is not available or has zero length"], codes: ["warning"] },
  { code: 'A28', id: 'an-meas', netlist: "* .meas in a -r run\nV1 in 0 PULSE(0 5 0 1u 1u 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m\n.meas tran vmax MAX v(out)\n.end\n", summaries: { "time": { points: 520, first: 0, last: 0.005, maxStep: 0.00001 } }, prints: ["No .measure possible in batch mode (-b) with -r rawfile set!"] },
  { code: 'A29', id: 'an-unknown-dot', netlist: "* an unknown dot command\nV1 a 0 6\nR1 a 0 2\n.foo bar\n.op\n.end\n", prints: ["unimplemented dot command '.foo'"], fails: true },
  { code: 'A29b', id: 'an-hb-unknown', netlist: "* .hb in a netlist\nV1 a 0 1\nR1 a 0 1k\n.hb\n.op\n.end\n", prints: ["unimplemented dot command '.hb'"], fails: true },
  { code: 'A29c', id: 'an-sens2-unknown', netlist: "* .sens2 in a netlist\nV1 a 0 1\nR1 a 0 1k\n.sens2\n.op\n.end\n", prints: ["unimplemented dot command '.sens2'"], fails: true },
  { code: 'A30', id: 'an-model-types', netlist: "* .model types\nV1 a 0 5\nR1 a b 1k\nD1 b 0 dmod\n.model dmod D\nR2 a c 1k\nQ1 c c 0 qn\n.model qn NPN\nR3 a d 1k\nQ2 0 0 d qp\n.model qp PNP\nR4 a e 1k\nJ1 e 0 0 jn\n.model jn NJF\nR5 a f 1k\nM1 f a 0 0 mn\n.model mn NMOS level=1\nR6 a g 1k\nM2 g 0 a a mp\n.model mp PMOS level=1\nR7 a h 1k\nS1 h 0 a 0 sw1\n.model sw1 SW\nVs a i 0\nR8 i 0 1k\nR9 a k 1k\nW1 k 0 Vs csw1\n.model csw1 CSW\n.op\n.end\n", vectors: { "v(b)": 0.6928875985993175, "v(c)": 0.8110232441373441, "v(d)": 0.8110232441423211, "v(e)": 4.59999999539, "v(f)": 4.750621889658553, "v(g)": 5, "v(h)": 0.004995004995004996, "v(k)": 0.004995004995004996 } },
  { code: 'A31', id: 'an-dc-cap-open', netlist: "* .dc with a capacitor and an inductor\nV1 a 0 0\nR1 a b 1k\nC1 b 0 1u\nR2 b 0 1k\nR3 a c 1k\nL1 c d 1m\nR4 d 0 1k\n.dc V1 0 2 1\n.end\n", vectors: { "v(v-sweep)": [0, 1, 2], "v(b)": [0, 0.5, 1], "v(c)": [0, 0.5, 1], "v(d)": [0, 0.5, 1] } },
  { code: 'A32', id: 'an-ic', netlist: "* .ic with .tran uic\nV1 in 0 0\nR1 in out 1k\nC1 out 0 1u\n.ic v(out)=3\n.tran 10u 1m uic\n.end\n", summaries: { "time": { points: 111, first: 1e-7, last: 0.001, maxStep: 0.00001 }, "v(out)": { points: 111, first: 2.9997000299970007, last: 1.103629591624538 } } },
  { code: 'A33', id: 'an-lib', netlist: "* .lib a file\n.lib models.lib tt\nV1 a 0 6\nR1 a 0 2\n.op\n.end\n", fails: true },
  { code: 'A34', id: 'an-known-dots', netlist: "* dot commands ngspice knows\nV1 a 0 AC 1\nR1 a 0 1k\n.global vdd\n.nodeset v(a)=1\n.width out=80\n.func dbl(x) {2*x}\n.temp 27\n.csparam xx=1\n.op\n.noise v(a) V1 dec 1 1 10\n.end\n", vectors: { "v(a)": 0 } },
  { code: 'A36', id: 'an-control-only', netlist: "* an operating point run from a .control block\nV1 a 0 1\nR1 a 0 1k\n.control\nop\nprint v(a)\n.endc\n.end\n", prints: ["v(a) = 1.000000e+00"], fails: true },
  { code: 'A35', id: 'an-subckt', netlist: "* a subcircuit\n.subckt div in out\nR1 in out 1k\nR2 out 0 1k\n.ends\nV1 a 0 2\nX1 a b div\n.op\n.end\n", vectors: { "v(a)": 2, "v(b)": 1 } },
  { code: 'C1', id: 'cur-v-delivers', netlist: "* F1a: a 6 V source across a 2 ohm resistor\nV1 n1 0 6\nR1 n1 0 2\n.op\n.end\n", vectors: { "v(n1)": 6, "i(v1)": -3 } },
  { code: 'C1b', id: 'cur-v-negative-delivers', netlist: "* a source with a negative value that delivers power\nV1 0 n1 -6\nR1 n1 0 2\n.op\n.end\n", vectors: { "v(n1)": 6, "i(v1)": 3 } },
  { code: 'C2', id: 'cur-v-absorbs', netlist: "* V1 absorbing power (V2 pushes current into the + node of V1)\nV1 a 0 6\nV2 b 0 12\nR1 b a 3\n.op\n.end\n", vectors: { "v(a)": 6, "v(b)": 12, "i(v2)": -2, "i(v1)": 2 } },
  { code: 'C3', id: 'cur-r-isource', netlist: "* current directions with savecurrents\nI1 0 n1 3\nR1 n1 0 4\nI2 n2 0 3\nR2 n2 0 4\n.options savecurrents\n.op\n.end\n", vectors: { "v(n1)": 12, "v(n2)": -12, "i(@i1[current])": 3, "i(@r1[i])": 3, "i(@i2[current])": 3, "i(@r2[i])": -3 } },
  { code: 'C4', id: 'cur-f-g', netlist: "* F and G current directions\nV1 c 0 2\nVs c d 0\nRd d 0 1\nF1 0 o Vs 2\nRo o 0 1\nF2 p 0 Vs 2\nRp p 0 1\nG1 0 q c 0 0.5\nRq q 0 1\nG2 r 0 c 0 0.5\nRr r 0 1\n.options savecurrents\n.op\n.end\n", vectors: { "i(vs)": 2, "v(o)": 4, "v(p)": -4, "v(q)": 1, "v(r)": -1, "i(@f1[i])": 4, "i(@f2[i])": 4, "i(@g1[i])": 1, "i(@g2[i])": 1 } },
  { code: 'C5', id: 'cur-f5', netlist: "* F5: Thevenin resistance with a dependent source (test source method)\nItest 0 a 1\nVx a x 0\nR2 x n1 2\nR1 n1 0 4\nF1 0 n1 Vx 2\n.options savecurrents\n.op\n.end\n", vectors: { "v(a)": 14, "v(x)": 14, "v(n1)": 12, "i(vx)": 1, "i(@itest[current])": 1, "i(@r2[i])": 1, "i(@r1[i])": 3, "i(@f1[i])": 2 } },
  { code: 'C6', id: 'cur-e-h', netlist: "* E and H branch currents\nV1 c 0 2\nVs c d 0\nRd d 0 1\nE1 e 0 c 0 3\nRe e 0 2\nH1 h 0 Vs 4\nRh h 0 2\n.op\n.end\n", vectors: { "v(c)": 2, "v(d)": 2, "v(e)": 6, "v(h)": 8, "i(h1)": -4, "i(vs)": 2, "i(e1)": -3, "i(v1)": -2 } },
  { code: 'C7', id: 'cur-b', netlist: "* a B source current with savecurrents\nB1 0 b I=2\nRb b 0 1\n.options savecurrents\n.op\n.end\n", vectors: { "v(b)": 2, "i(@b1[i])": 2, "i(@rb[i])": 2 } },
  { code: 'C8', id: 'cur-switch-wrong', netlist: "* switch currents with savecurrents\nV1 a 0 6\nS1 a c a 0 swm\nRc c 0 3\n.model swm SW(vt=1 ron=1 roff=1e9)\nVs a d 0\nRd d 0 6\nW1 a e Vs wm\nRe e 0 5\n.model wm CSW(it=0.5 ron=1 roff=1e9)\n.options savecurrents\n.op\n.end\n", vectors: { "v(c)": 4.5, "v(e)": 5, "i(vs)": 1, "i(@s1[i])": 1.5000000000000002e-9, "i(@rc[i])": 1.5, "i(@w1[i])": 1e-9, "i(@re[i])": 1 } },
  { code: 'C9', id: 'cur-noise-bridge', netlist: "* a balanced bridge: no current through R5\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\n.options savecurrents\n.op\n.end\n", vectors: { "v(top)": 9, "v(a)": 4.499999999999999, "v(b)": 4.5, "i(v1)": -0.0014074468085106386, "i(@r1[i])": 0.0004500000000000001, "i(@r2[i])": 0.00044999999999999993, "i(@r3[i])": 0.0009574468085106382, "i(@r4[i])": 0.0009574468085106382, "i(@r5[i])": -8.881784197001253e-19 } },
  { code: 'C9b', id: 'cur-noise-everywhere', netlist: "* a 0 V ammeter whose last word is gnd: no current anywhere\nV1 in 0 12\nR1 in a 1k\nR2 a x 2k\nVm x gnd\nR3 a b 3k\nF1 0 b V1 2\n.options savecurrents\n.op\n.end\n", vectors: { "v(in)": 12, "v(a)": 11.999999999999998, "v(x)": 11.999999999999998, "v(gnd)": 11.999999999999998, "v(b)": 11.999999999999995, "i(v1)": -1.734723475976807e-18, "i(vm)": 0, "i(@r1[i])": 1.7763568394002505e-18, "i(@r2[i])": 0, "i(@r3[i])": 1.1842378929335003e-18, "i(@f1[i])": -3.469446951953614e-18 }, prints: ["vm: has no value, DC 0 assumed"], codes: ["no-value-dc0"] },
  { code: 'C9c', id: 'cur-abstol', netlist: "* ngspice's tolerances\nV1 a 0 1\nR1 a 0 1k\n.control\nop\noptions\n.endc\n.end\n", prints: ["abstol      (current) = 1e-12", "vntol       (voltage) = 1e-06", "reltol      (current) = 0.001"], fails: true },
  { code: 'C9d', id: 'cur-noise-passes-on', netlist: "* a balanced bridge with a 0 V ammeter in R5, and an F that reads it\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a m 1k\nVm m b 0\nF1 0 out Vm 1000\nR6 out 0 1k\n.options savecurrents\n.op\n.end\n", vectors: { "v(top)": 9, "v(a)": 4.499999999999999, "v(b)": 4.499999999999999, "v(m)": 4.499999999999999, "v(out)": -2.1684043449710089e-13, "i(vm)": -2.168404344971009e-19, "i(v1)": -0.0014074468085106388, "i(@r1[i])": 0.0004500000000000001, "i(@r2[i])": 0.00044999999999999993, "i(@r3[i])": 0.0009574468085106385, "i(@r4[i])": 0.0009574468085106381, "i(@r5[i])": 0, "i(@f1[i])": -2.1684043449710089e-16, "i(@r6[i])": -2.1684043449710089e-16 } },
  { code: 'C9e', id: 'cur-tiny-source', netlist: "* superposition: a 12 V source and a 2 A current source (2 attoamps)\nV1 a 0 12\nR1 a b 1k\nR2 b 0 2k\nI1 0 b 2A\n.options savecurrents\n.op\n.end\n", vectors: { "v(a)": 12, "v(b)": 8, "i(v1)": -0.004, "i(@r1[i])": 0.004, "i(@r2[i])": 0.004, "i(@i1[current])": 2e-18 } },
  { code: 'C9f', id: 'cur-tiny-big-r', netlist: "* a 100 T resistor across 12 V, next to a 1.2 A current\nV1 in 0 12\nR1 in 0 10\nR2 in 0 1e14\n.options savecurrents\n.op\n.end\n", vectors: { "v(in)": 12, "i(v1)": -1.20000000000012, "i(@r1[i])": 1.2000000000000002, "i(@r2[i])": 1.2e-13 } },
  { code: 'C9g', id: 'cur-tiny-next-to-wire', netlist: "* a 1 n resistor used as a wire, and a 1 T resistor\nV1 in 0 0.5\nR1 in a 1n\nR2 a 0 1k\nR3 a 0 1T\n.options savecurrents\n.op\n.end\n", vectors: { "v(in)": 0.5, "v(a)": 0.49999999999949996, "i(v1)": -0.000500023365020752, "i(@r1[i])": 0.0005000444502911704, "i(@r2[i])": 0.0004999999999995, "i(@r3[i])": 4.999999999995e-13 } },
  { code: 'C9h', id: 'cur-tiny-loop', netlist: "* a 12 V source, 1 k and a current source written 2A (2 attoamps) in one loop\nV1 a 0 12\nR1 a b 1k\nI1 0 b 2A\n.options savecurrents\n.op\n.end\n", vectors: { "v(a)": 12, "v(b)": 12.000000000000002, "i(v1)": 1.734723475976807e-18, "i(@r1[i])": -1.7763568394002505e-18, "i(@i1[current])": 2e-18 } },
  { code: 'C9i', id: 'cur-tiny-series', netlist: "* 12 V across 10 ohms in series with 100 T ohms\nV1 in 0 12\nR1 in a 10\nR2 a 0 1e14\n.options savecurrents\n.op\n.end\n", vectors: { "v(in)": 12, "v(a)": 11.9999999999988, "i(v1)": -1.2012613126444194e-13, "i(@r1[i])": 1.2008172234345695e-13, "i(@r2[i])": 1.19999999999988e-13 } },
  { code: 'C9j', id: 'cur-tiny-side-by-side', netlist: "* the loop of C9h with two 1 k resistors side by side\nV1 a 0 12\nR1 a b 1k\nR2 a b 1k\nI1 0 b 2A\n.options savecurrents\n.op\n.end\n", vectors: { "v(a)": 12, "v(b)": 12.000000000000002, "i(v1)": 3.469446951953614e-18, "i(@r1[i])": -1.7763568394002505e-18, "i(@r2[i])": -1.7763568394002505e-18, "i(@i1[current])": 2e-18 } },
  { code: 'C9l', id: 'cur-bridge-voltmeter', netlist: "* the balanced bridge of C9 with a 1e15 ohm voltmeter across R2\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nRvm a 0 1e15\n.options savecurrents\n.op\n.end\n", vectors: { "v(top)": 9, "v(a)": 4.499999999990972, "v(b)": 4.499999999993667, "i(v1)": -0.0014074468085128885, "i(@r1[i])": 0.00045000000000090286, "i(@r2[i])": 0.00044999999999909717, "i(@r3[i])": 0.0009574468085119857, "i(@r4[i])": 0.0009574468085092909, "i(@r5[i])": -2.6956215037898802e-15, "i(@rvm[i])": 4.499999999990972e-15 } },
  { code: 'M1', id: 'msg-no-ground', netlist: "* no ground\nV1 a b 6\nR1 a b 2\n.op\n.end\n", vectors: { "v(a)": 9.00033307426206, "v(b)": 3.0003330742710626, "i(v1)": -2.9999999999924993 }, prints: ["singular matrix:  check node b","Transient op started"], codes: ["singular-matrix","gmin-stepping-failed","source-stepping-failed","transient-op-fallback"], unreliable: true },
  { code: 'M2', id: 'msg-cap-node', netlist: "* T15b: a node connected only to capacitors, with a resistor elsewhere\nV1 a 0 6\nR1 a c 1k\nC1 c b 1u\nC2 b 0 2u\nR2 c 0 1k\n.op\n.end\n", vectors: { "v(a)": 5.9999999999939995, "v(c)": 0.08866339997380636, "v(b)": 0.029554466657885997, "i(v1)": -0.005911336600014282 }, prints: ["singular matrix:  check node b"], codes: ["singular-matrix","transient-op-fallback"], unreliable: true },
  { code: 'M2b', id: 'msg-isource-cap', netlist: "* T05a: a current source in series with a capacitor\nI1 0 a 1m\nC1 a b 1u\nR1 b 0 1k\n.op\n.end\n", vectors: { "v(a)": 1.0099999979842442, "v(b)": 0.9999999979942681 }, codes: ["singular-matrix","transient-op-fallback"], unreliable: true },
  { code: 'M2c', id: 'msg-floating-r', netlist: "* T04b: a resistor whose both nodes connect to nothing else\nV1 n1 0 6\nR1 n1 0 2\nR2 n3 n4 3\n.op\n.end\n", vectors: { "v(n1)": 5.9999999999939995, "v(n3)": 0, "v(n4)": 0, "i(v1)": -2.9999999999939995 }, prints: ["singular matrix:  check node n3"], codes: ["singular-matrix","transient-op-fallback"], unreliable: true },
  { code: 'M2d', id: 'msg-cap-node-zw', netlist: "* t\nV1 in 0 5\nC1 in ou\u200bt 1u\nC2 ou\u200bt 0 1u\n.op\n.end\n", vectors: { "v(in)": 4.9999999999949996, "v(ou___t)": 2.4999999999849893, "i(v1)": -1.5702994460298214e-12 }, prints: ["singular matrix:  check node ou___t"], codes: ["singular-matrix","transient-op-fallback"], unreliable: true },
  { code: 'M2d-tr', id: 'msg-cap-node-tr', netlist: "* t\nV1 G\u0130R\u0130\u015e 0 5\nC1 G\u0130R\u0130\u015e \u00c7IKI\u015e 1u\nC2 \u00c7IKI\u015e 0 1u\n.op\n.end\n", vectors: { "v(g__r____)": 4.9999999999949996, "v(__iki__)": 2.4999999999849893, "i(v1)": -1.5702994460298214e-12 }, prints: ["singular matrix:  check node __iki__"], codes: ["singular-matrix","transient-op-fallback"], unreliable: true },
  { code: 'M3', id: 'msg-parallel-v', netlist: "* T06a: two different voltage sources in parallel\nV1 n1 0 5\nV2 n1 0 3\nR1 n1 0 1k\n.op\n.end\n", prints: ["singular matrix:  check node v1#branch","Transient op failed, timestep too small"], codes: ["singular-matrix","transient-op-failed","op-failed"], fails: true, unreliable: true },
  { code: 'M3b', id: 'msg-v-shorted-0v', netlist: "* T06b: a voltage source shorted by a 0 V source\nV1 n1 0 5\nVx n1 0 0\nR1 n1 0 1k\n.op\n.end\n", prints: ["singular matrix:  check node"], codes: ["singular-matrix","op-failed"], fails: true, unreliable: true },
  { code: 'M3c', id: 'msg-v-shorted-l', netlist: "* a voltage source with an inductor across it\nV1 a 0 5\nL1 a 0 1m\nR1 a 0 1k\n.op\n.end\n", vectors: { "v(a)": 4.9999999999949996, "i(l1)": 0.049999999999950126, "i(v1)": -0.05499999999989012 }, prints: ["singular matrix:  check node l1#branch"], codes: ["singular-matrix","transient-op-fallback"], unreliable: true },
  { code: 'M4', id: 'msg-duplicate', netlist: "* T07b: R1 and r1\nV1 n1 0 6\nR1 n1 0 2\nr1 n1 0 4\n.op\n.end\n", prints: ["device already exists"], codes: ["duplicate-name"], fails: true },
  { code: 'M4b', id: 'msg-duplicate-letters', netlist: "* R\u015f and R\u00e7: the same name for ngspice\nV1 a 0 6\nR\u015f a 0 2\nR\u00e7 a 0 3\n.op\n.end\n", prints: ["device already exists", "r__ a 0 3"], codes: ["duplicate-name"], fails: true },
  { code: 'M4c', id: 'msg-duplicate-micro', netlist: "* R\u00b5 and Ru: the same name for ngspice\nV1 a 0 6\nR\u00b5 a 0 2\nRu a 0 3\n.op\n.end\n", prints: ["device already exists", "ru a 0 3"], codes: ["duplicate-name"], fails: true },
  { code: 'M5', id: 'msg-unknown-device', netlist: "* a line starting with a digit\nV1 a 0 6\nR1 a 0 2\n1k a 0 5\n.op\n.end\n", prints: ["unknown device type - error"], codes: ["unknown-device"], fails: true },
  { code: 'M5b', id: 'msg-unknown-device-nonascii', netlist: "* a line starting with a non-ASCII letter\nV1 a 0 6\nR1 a 0 2\nÜ1 a 0 5\n.op\n.end\n", prints: ["unknown device type - error"], codes: ["unknown-device"], fails: true },
  { code: 'M6', id: 'msg-unknown-subckt', netlist: "* X without a .subckt\nV1 a 0 6\nR1 a 0 2\nX1 a 0 amp\n.op\n.end\n", prints: ["unknown subckt"], codes: ["unknown-subcircuit"], fails: true },
  { code: 'M7', id: 'msg-missing-model', netlist: "* a diode without a .model line\nV1 a 0 5\nR1 a b 1k\nD1 b 0 dmod\n.op\n.end\n", codes: ["missing-model"], fails: true },
  { code: 'M8', id: 'msg-bsim3', netlist: "* a MOSFET with a BSIM3 model (level=8)\nVd d 0 1\nVg g 0 1\nM1 d g 0 0 nm\n.model nm nmos level=8\n.op\n.end\n", codes: ["missing-model"], fails: true },
  { code: 'M9', id: 'msg-not-enough', netlist: "* an E line with too few fields\nRref a 0 1\nE1 a 0 5\n.op\n.end\n", fails: true, unreliable: true },
  { code: 'M10', id: 'msg-tf-missing', netlist: "* T12a: .tf naming a source that does not exist\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\n.tf v(n1) V9\n.end\n", prints: ["Transfer function source v9 not in circuit"], codes: ["tf-source-missing"], fails: true },
  { code: 'M11', id: 'msg-tf-type', netlist: "* T12c: .tf naming a resistor as the input source\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\n.tf v(n1) R1\n.end\n", prints: ["Transfer function source r1 not of proper type"], codes: ["tf-source-type"], fails: true },
  { code: 'M12', id: 'msg-dc-missing', netlist: "* T20e: .dc sweeping a source that does not exist\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V9 0 12 1\n.end\n", prints: ["is not in the circuit"], codes: ["sweep-source-missing"], fails: true },
  { code: 'M13', id: 'msg-dc-step-zero', netlist: "* T20a: .dc with a step of 0\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 0 12 0\n.end\n", prints: ["Bad syntax!"], codes: ["bad-syntax"], fails: true },
  { code: 'M13b', id: 'msg-dc-no-step', netlist: "* T20d: .dc with no step\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 0 12\n.end\n", prints: ["Bad syntax!"], codes: ["bad-syntax"], fails: true },
  { code: 'M14', id: 'msg-tran-one', netlist: "* T21a: .tran with one argument\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\nC1 out 0 1u\n.tran 5m\n.end\n", prints: ["TSTOP is invalid, must be greater than zero."], codes: ["bad-tran-arguments"], fails: true },
  { code: 'M15', id: 'msg-tran-zero', netlist: "* T21b: .tran with a zero step\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\nC1 out 0 1u\n.tran 0 5m\n.end\n", prints: ["TSTEP is invalid, must be greater than zero."], codes: ["bad-tran-arguments"], fails: true },
  { code: 'M15b', id: 'msg-tran-tstart', netlist: "* T21d: .tran with tstart after tstop\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\nC1 out 0 1u\n.tran 10u 5m 6m\n.end\n", prints: ["TSTART is invalid, must be less than TSTOP."], codes: ["bad-tran-arguments"], fails: true },
  { code: 'M16', id: 'msg-k-missing', netlist: "* K naming an inductor that does not exist\nV1 a 0 6\nL1 a b 1m\nR1 b 0 1\nK1 L1 L2 0.9\n.op\n.end\n", prints: ["coupling to non-existent inductor l2"], codes: ["missing-inductor"], fails: true },
  { code: 'M17', id: 'msg-undefined-param', netlist: "* an undefined parameter\nV1 a 0 6\nR1 a 0 {rx}\n.op\n.end\n", prints: ["Undefined parameter [rx]"], codes: ["undefined-parameter","fatal"], fails: true },
  { code: 'M18', id: 'msg-unclosed-brace', netlist: "* an expression with no closing brace\nV1 a 0 6\nR1 a 0 {2*3\n.op\n.end\n", codes: ["fatal"], fails: true },
  { code: 'M19', id: 'msg-b-malformed', netlist: "* a B line without V= or I=\nRref a 0 1\nB1 a 0 5\n.op\n.end\n", codes: ["fatal-syntax","fatal"], fails: true },
  { code: 'M20', id: 'msg-no-analysis', netlist: "* T21e: no analysis line at all\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\nC1 out 0 1u\n* (no analysis)\n.end\n", fails: true },
  { code: 'M21', id: 'msg-brace-line', netlist: "* a line starting with a brace\nV1 a 0 6\nR1 a 0 2\n{1 a 0 5\n.op\n.end\n", codes: ["fatal-syntax","fatal"], fails: true },
];

const FIXTURES = [
  'f1a-voltage-source',
  'f1b-voltage-source-swapped',
  'f2a-current-source',
  'f2b-current-source-swapped',
  'f3a-1M-trap',
  'f3b-1meg',
  'f4-tf-output-impedance',
  'f5-thevenin-cccs',
  'd1-dc-divider-sweep',
  't1-tran-rc-charge',
];

const root = resolve(import.meta.dirname, '../..');
let engine: NgspiceEngine;
const runs = new Map<string, RunResult>();
const fixtureRuns = new Map<string, RunResult>();

const fact = (code: string): Fact => {
  const f = FACTS.find((x) => x.code === code);
  if (!f) throw new Error(`no fact ${code}`);
  return f;
};

/** The app asks ngspice for every part's current by adding this line before .end (as the spike page does). */
const withSaveCurrents = (text: string): string => text.replace(/^(\s*\.end\b)/im, '.options savecurrents\n$1');
const fixtureText = (id: string): string => readFileSync(join(root, `tests/fixtures/${id}.cir`), 'utf8');

/** A vector's values: real parts, or magnitudes for complex vectors other than the frequency. */
function vectorValues(plots: RawPlot[], name: string): number[] | undefined {
  for (const p of plots) {
    const i = p.variables.findIndex((v) => v.name === name);
    if (i < 0) continue;
    const re = Array.from(p.real[i]!);
    if (!p.imag || name === 'frequency') return re;
    const im = p.imag[i]!;
    return re.map((x, k) => Math.hypot(x, im[k]!));
  }
  return undefined;
}

function interpolate(t: number[], y: number[], x: number): number {
  if (x <= t[0]!) return y[0]!;
  for (let i = 1; i < t.length; i++) {
    if (t[i]! >= x) return t[i] === t[i - 1] ? y[i]! : y[i - 1]! + ((y[i]! - y[i - 1]!) * (x - t[i - 1]!)) / (t[i]! - t[i - 1]!);
  }
  return y[y.length - 1]!;
}

function largestStep(t: number[]): number {
  let m = 0;
  for (let i = 1; i < t.length; i++) m = Math.max(m, t[i]! - t[i - 1]!);
  return m;
}

interface Described {
  netlist: Netlist;
  run: RunResult;
  results: AnalysisResults;
  words: ResultsInWords;
}

function describeRun(text: string, run: RunResult): Described {
  const netlist = parseNetlist(text);
  const results = interpretPlots(run.plots);
  return { netlist, run, results, words: describeResults(netlist, results, run) };
}

const ofFact = (code: string): Described => describeRun(fact(code).netlist, runs.get(fact(code).id)!);
const ofFixture = (id: string, saveCurrents = true): Described =>
  describeRun(saveCurrents ? withSaveCurrents(fixtureText(id)) : fixtureText(id), fixtureRuns.get(saveCurrents ? id : `${id}:plain`)!);
const currentText = (d: Described, name: string): string | undefined => d.words.currents.find((c) => c.name === name)?.text;
const powerText = (d: Described, name: string): string | undefined => d.words.currents.find((c) => c.name === name)?.power?.text;
/** formatSI separates number and unit with a no-break space; the expectations below use a plain space. */
const plain = (s: string | undefined): string | undefined => s?.replace(/ /g, ' ');

beforeAll(async () => {
  engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
  for (const f of FACTS) runs.set(f.id, await engine.run(f.netlist));
  for (const id of FIXTURES) {
    fixtureRuns.set(id, await engine.run(withSaveCurrents(fixtureText(id))));
    fixtureRuns.set(`${id}:plain`, await engine.run(fixtureText(id)));
  }
});

// ------------------------------------------------------------------ 1. the claims

describe.each(FACTS)('$code ($id)', (f) => {
  it('runs in our engine as native ngspice 47 ran it', () => {
    const r = runs.get(f.id)!;
    for (const [name, want] of Object.entries(f.vectors ?? {})) {
      const got = vectorValues(r.plots, name);
      expect(got, `${name} missing in the wasm run`).toBeDefined();
      const wants = Array.isArray(want) ? want : [want];
      expect(got!.length, name).toBe(wants.length);
      wants.forEach((w, i) => expect(agrees(got![i]!, w), `${name}[${i}]: wasm ${got![i]} vs native 47 ${w}`).toBe(true));
    }
    for (const [name, s] of Object.entries(f.summaries ?? {})) {
      const got = vectorValues(r.plots, name);
      expect(got, `${name} missing in the wasm run`).toBeDefined();
      expect(got!.length, `${name} points`).toBe(s.points);
      expect(agrees(got![0]!, s.first), `${name} first`).toBe(true);
      expect(agrees(got![got!.length - 1]!, s.last), `${name} last`).toBe(true);
      if (s.maxStep !== undefined) expect(agrees(largestStep(got!), s.maxStep), `${name} largest step`).toBe(true);
    }
    if (f.at) {
      const t = vectorValues(r.plots, 'time')!;
      const y = vectorValues(r.plots, f.at.vector)!;
      f.at.times.forEach((x, i) => {
        const got = interpolate(t, y, x);
        expect(agrees(got, f.at!.values[i]!, 6, 1e-9), `${f.at!.vector} at ${x}: ${got} vs ${f.at!.values[i]}`).toBe(true);
      });
    }
    const all = `${r.stdout}\n${r.stderr}`;
    for (const p of f.prints ?? []) expect(all).toContain(p);
    const codes = r.diagnostics.map((d) => d.code);
    for (const c of f.codes ?? []) expect(codes).toContain(c);
    expect(r.ok, 'ok').toBe(!f.fails);
    expect(r.unreliable, 'unreliable').toBe(!!f.unreliable);
  });
});

// ------------------------------------------------------------------ 2. predictions

describe('what the explanations predict matches the run', () => {
  /** A line Explain says ngspice ignores: an analysis in a subcircuit no X line uses (A3f). */
  const ignoredLine = (n: Netlist, i: number): boolean => (explainLine(n, i)?.notes[0] ?? '').startsWith('ngspice ignores this line');

  it('counts the .dc points as ngspice does (A7–A15, A31)', () => {
    let checked = 0;
    for (const f of FACTS) {
      const n = parseNetlist(f.netlist);
      for (const i of n.analyses) {
        const a = readAnalysis(n, i);
        if (a?.kind !== 'dc' || a.points === undefined) continue;
        // A3f: in a subcircuit no X line uses, ngspice runs no point of it.
        if (ignoredLine(n, i)) {
          expect(interpretPlots(runs.get(f.id)!.plots).dc, f.id).toBeUndefined();
          continue;
        }
        const dc = interpretPlots(runs.get(f.id)!.plots).dc;
        expect(dc?.scale.values.length ?? 0, f.code).toBe(a.points);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it('counts the .ac points as ngspice does (A20–A22b)', () => {
    let checked = 0;
    for (const f of FACTS) {
      const n = parseNetlist(f.netlist);
      for (const i of n.analyses) {
        const a = readAnalysis(n, i);
        if (a?.kind !== 'ac' || a.points === undefined) continue;
        // A3f: in a subcircuit no X line uses, ngspice runs no point of it.
        if (ignoredLine(n, i)) {
          expect(vectorValues(runs.get(f.id)!.plots, 'frequency'), f.id).toBeUndefined();
          continue;
        }
        expect(vectorValues(runs.get(f.id)!.plots, 'frequency')?.length, f.code).toBe(a.points);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('predicts the largest .tran step, and where the saved results begin (A16–A19)', () => {
    let checked = 0;
    for (const f of FACTS) {
      const n = parseNetlist(f.netlist);
      for (const i of n.analyses) {
        const a = readAnalysis(n, i);
        if (a?.kind !== 'tran' || a.maxStep === undefined) continue;
        const t = vectorValues(runs.get(f.id)!.plots, 'time');
        if (!t) continue;
        expect(agrees(largestStep(t), a.maxStep), `${f.code}: ${largestStep(t)} vs ${a.maxStep}`).toBe(true);
        expect(t[0]!, f.code).toBeGreaterThanOrEqual(a.tstart ?? 0);
        expect(agrees(t[t.length - 1]!, a.tstop!), f.code).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it('gives each source function the value it has in .op (P17)', () => {
    const f = fact('P17');
    const n = parseNetlist(f.netlist);
    const op = interpretPlots(runs.get(f.id)!.plots).op!;
    const lines = n.lines.filter((l) => l.element?.sourceFunction);
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      const node = line.element!.nodes[0]!.name;
      const v = op.nodes.find((x) => x.node === node)!.value;
      expect(explainLine(n, line.index)!.summary).toContain(`value at time 0: ${formatSI(v, 'V')}.`);
    }
  });

  it('says a source with dc and no number is 0 without a message, as the run prints none (P16b; re-check C3)', () => {
    const f = fact('P16b');
    const r = runs.get(f.id)!;
    expect(`${r.stdout}\n${r.stderr}`).not.toContain('has no value');
    const n = parseNetlist(f.netlist);
    for (const [line, unit] of [[1, 'V'], [3, 'V'], [5, 'A']] as const) {
      expect(explainLine(n, line)!.notes, f.code).toContain(`This source has dc but no number after it, so in .op ngspice uses 0 ${unit}, without a message.`);
      expect(explainLine(n, line)!.notes.join(' '), f.code).not.toContain('says so in a note');
    }
    // A source with nothing after its nodes, or an AC value alone, keeps the note ngspice prints (P16).
    const p16 = parseNetlist(fact('P16').netlist);
    expect(explainLine(p16, 1)!.notes.join(' ')).toContain('says so in a note ("has no value, DC 0 assumed")');
  });

  it('says where a voltage source puts its node, as the run finds it (P3)', () => {
    const f = fact('P3');
    const n = parseNetlist(f.netlist);
    const v = (node: string): string => formatSI(interpretPlots(runs.get(f.id)!.plots).op!.nodes.find((x) => x.node === node)!.value, 'V');
    expect(explainLine(n, 1)!.summary).toContain(`so node n1 sits at ${v('n1')}.`);
    expect(explainLine(n, 3)!.summary).toContain(`so node n2 sits at ${v('n2')}.`);
    expect(explainLine(n, 6)!.summary).toContain('So node a sits 6 V above node b.');
    expect(v('a')).toBe('10 V');
    expect(v('b')).toBe('4 V');
    // A negative value between two nodes: its size and "below", as the run finds it (words re-check 12).
    expect(plain(explainLine(n, 9)!.summary)).toContain('SPICE reads that as V(c) − V(d) = −3 V. So node c sits 3 V below node d.');
    expect(explainLine(n, 9)!.summary).not.toContain('above');
    expect(plain(v('c'))).toBe('6 V');
    expect(plain(v('d'))).toBe('9 V');
  });

  it('says which way a current source with a negative value pushes its current, as the run finds it (P4)', () => {
    const f = fact('P4');
    const n = parseNetlist(f.netlist);
    const v = (node: string): number => interpretPlots(runs.get(f.id)!.plots).op!.nodes.find((x) => x.node === node)!.value;
    expect(plain(explainLine(n, 1)!.summary)).toContain('So I1 pushes 3 A from ground (node 0), through the source, into node a.');
    // I3 0 c -3: 3 A from c into ground, so c is below ground, as b is (words re-check 12).
    expect(plain(explainLine(n, 5)!.summary)).toContain('Its value is negative, so the current flows the other way: I3 pushes 3 A from node c, through the source, into ground (node 0).');
    // The overview (and the drawing's description) say it the same way (critic of words re-check 12).
    expect(plain(describeCircuit(n))).toContain('I3: a −3 A current source: its value is negative, so it pushes 3 A from node c into ground.');
    expect(plain(describeCircuit(n))).toContain('I2: a 3 A current source pushing current from node b into ground.');
    expect(v('a')).toBe(12);
    expect(v('c')).toBe(-12);
    expect(v('c')).toBe(v('b'));
  });

  it('says a source .dc sweeps has no one value there, and that a value beside a SIN is .op\'s, as the runs find it (P3b, P4b, P4c)', () => {
    // P4b: the sweep sets I1 from −5 mA to 5 mA; at 5 mA the current goes from a into ground, a = −5 V.
    const swept = parseNetlist(fact('P4b').netlist);
    const sweep = interpretPlots(runs.get('part-isource-swept')!.plots).dc!;
    expect(sweep.series.find((x) => x.name === 'v(a)')!.values.at(-1)).toBe(-5);
    expect(plain(explainLine(swept, 1)!.summary)).toContain('So I1 pushes its current from node a, through the source, into ground (node 0). The .dc on line 4 sweeps this source, so in that analysis its value changes.');
    expect(explainLine(swept, 1)!.summary).not.toMatch(/negative|pushes 2 mA/);
    expect(plain(describeCircuit(swept))).toContain('I1: a current source pushing current from node a into ground, swept by .dc.');
    // P4c: .op uses −2 mA (a = 2 V); .tran follows the SIN from time 0 (a starts at 0, never 2 V).
    const isin = parseNetlist(fact('P4c').netlist);
    expect(interpretPlots(runs.get('part-isource-sin-op')!.plots).op!.nodes.find((x) => x.node === 'a')!.value).toBe(2);
    const tran = interpretPlots(runs.get('part-isource-sin-tran')!.plots).tran!.series.find((x) => x.name === 'v(a)')!.values;
    expect(tran[0]).toBe(0);
    expect(Math.max(...tran)).toBeLessThan(1);
    expect(plain(explainLine(isin, 1)!.summary)).toContain('Its value is negative, so the current flows the other way: I1 pushes 2 mA from ground (node 0), through the source, into node a. In .op the source has that value; in .tran it follows its SIN from time 0 instead.');
    expect(plain(describeCircuit(isin))).toContain('I1: a −2 mA current source: its value is negative, so in .op it pushes 2 mA from ground into node a.');
    // P3b: the same for a voltage source: in .op a sits 3 V below b; .tran starts V(a) − V(b) at 0.
    const vsin = parseNetlist(fact('P3b').netlist);
    const op = interpretPlots(runs.get('part-vsource-sin-op')!.plots).op!;
    expect(op.nodes.find((x) => x.node === 'b')!.value - op.nodes.find((x) => x.node === 'a')!.value).toBe(3);
    expect(interpretPlots(runs.get('part-vsource-sin-tran')!.plots).tran!.series.find((x) => x.name === 'v(a)')!.values[0]).toBe(0);
    expect(plain(explainLine(vsin, 1)!.summary)).toContain('So node a sits 3 V below node b. In .op the source has that value; in .tran it follows its SIN from time 0 instead.');
  });

  it('says what E, G, F and H do in the channel\'s words (P5–P8)', () => {
    const summary = (code: string, line: number): string => plain(explainLine(parseNetlist(fact(code).netlist), line)!.summary)!;
    expect(summary('P5', 2)).toBe('The voltage at node out1, measured from ground, is 2 × the voltage at node c, measured from ground. SPICE reads it as V(out1) − V(0) = 2 × (V(c) − V(0)).');
    expect(summary('P6', 2)).toBe('500 mA for every volt at node c, pushed from ground (node 0) into node out2. SPICE reads it as a current of 0.5 × (V(c) − V(0)) flowing from ground, through G1, into node out2.');
    expect(summary('P7', 4)).toBe('3 × the current in Vs, pushed from ground (node 0) into node out3. The current in Vs counts as positive when it flows from its + side (node c), through Vs, to its − side (node d).');
    expect(summary('P8', 4)).toBe('The voltage at node out4, measured from ground, is 4 V for every amp in Vs. The current in Vs counts as positive when it flows from its + side (node c), through Vs, to its − side (node d).');
  });

  it('explains every line of every claim netlist, with no gaps', () => {
    for (const f of FACTS) {
      const n = parseNetlist(f.netlist);
      expect(explainNetlist(n).map((e) => e.line), f.code).toEqual(n.lines.map((l) => l.number));
    }
  });
});

// ------------------------------------------------------------------ 3. results in words

describe('results in words: the fixtures, run with .options savecurrents as the app adds it', () => {
  it('F1a: V1 delivers 18 W, and 3 A flow from n1 to 0 through R1 (C1)', () => {
    const d = ofFixture('f1a-voltage-source');
    expect(d.words.status).toBe('ok');
    expect(plain(currentText(d, 'R1'))).toBe('3 A from node n1 to ground through R1');
    expect(plain(currentText(d, 'V1'))).toBe('3 A from ground to node n1 through V1');
    expect(plain(powerText(d, 'V1'))).toBe('V1 delivers 18 W');
    expect(plain(d.words.nodes[0]?.text)).toBe('6 V');
    expect(plain(d.words.summary)).toBe('Simulation finished: node n1 = 6 V; 2 currents. Open the results for details.');
    const notes = annotateLines(d.netlist, d.results, d.run).map((a) => [a.line, plain(a.text)]);
    expect(notes).toEqual([[2, 'delivers 18 W, 3 A out of +'], [3, '3 A, n1 → 0']]);
  });

  it('F1b: the swapped source still delivers 18 W', () => {
    const d = ofFixture('f1b-voltage-source-swapped');
    expect(plain(d.words.nodes[0]?.text)).toBe('−6 V');
    expect(plain(powerText(d, 'V1'))).toBe('V1 delivers 18 W');
    expect(plain(currentText(d, 'R1'))).toBe('3 A from ground to node n1 through R1');
  });

  it('F2a and F2b: the current source pushes 3 A one way or the other, and delivers 36 W (P4, C3)', () => {
    const a = ofFixture('f2a-current-source');
    expect(plain(currentText(a, 'I1'))).toBe('3 A from ground to node n1 through I1');
    expect(plain(powerText(a, 'I1'))).toBe('I1 delivers 36 W');
    expect(plain(currentText(a, 'R1'))).toBe('3 A from node n1 to ground through R1');
    const b = ofFixture('f2b-current-source-swapped');
    expect(plain(currentText(b, 'I1'))).toBe('3 A from node n1 to ground through I1');
    expect(plain(powerText(b, 'I1'))).toBe('I1 delivers 36 W');
    expect(plain(currentText(b, 'R1'))).toBe('3 A from ground to node n1 through R1');
  });

  it('F3a and F3b: 1M is a milliohm, 1meg a megaohm', () => {
    const a = ofFixture('f3a-1M-trap');
    expect(plain(a.words.nodes.find((n) => n.node === 'n2')?.text)).toBe('6 V');
    expect(plain(currentText(a, 'R1'))).toBe('6 µA from node n1 to node n2 through R1');
    expect(plain(explainLine(a.netlist, 2)!.fields.find((f) => f.label === 'value')?.meaning)).toBe('1 mΩ (milli!)');
    const b = ofFixture('f3b-1meg');
    expect(plain(b.words.nodes.find((n) => n.node === 'n2')?.text)).toBe('3 V');
    expect(plain(currentText(b, 'R1'))).toBe('3 µA from node n1 to node n2 through R1');
  });

  it('F4: the output resistance at v(a) is 4 Ω, the Thévenin resistance (A3)', () => {
    const d = ofFixture('f4-tf-output-impedance');
    const tf = d.words.tf!;
    expect(plain(tf.transferFunction?.text)).toBe('v(a)/V1 = 0.3333 (V/V)');
    expect(plain(tf.inputResistance?.text)).toBe('input resistance seen by V1: 9 Ω (ngspice calls it the input impedance)');
    expect(plain(tf.outputResistance?.text)).toBe('output resistance at node a: 4 Ω, the Thévenin resistance seen at node a (ngspice calls it the output impedance)');
    expect(tf.outputResistance?.speech).toBe('the output resistance at node a is 4 ohms, the Thévenin resistance');
  });

  it('.tf words on real runs name each output node one way: a gnd in v( ) is ground (A3b); a .tf after .end takes ngspice\'s names (A3c)', () => {
    const gnd = describeRun(fact('A3b').netlist, runs.get('an-tf-gnd')!);
    expect(gnd.words.tf?.at).toBe('between node out and ground');
    expect(plain(gnd.words.tf?.outputResistance?.text)).toBe('output resistance between node out and ground: 500 Ω, the Thévenin resistance seen between node out and ground (ngspice calls it the output impedance)');
    expect(gnd.words.tf?.transferFunction?.speech).toBe('the transfer function from V1 to the voltage between node out and ground is 0.5 volts per volt');
    expect(explainLine(gnd.netlist, 7)!.fields.find((f) => f.label === 'output')?.meaning).toBe('the output: the voltage at node out, measured from ground');
    // The .op of the same circuit: the ordinary node gnd the .tf's gnd is not.
    expect(describeRun(fact('A3b-op').netlist, runs.get('an-tf-gnd-op')!).words.nodes.find((n) => n.node === 'gnd')?.value).toBe(2.5);
    // v(gnd) alone is the voltage at ground (ngspice: output_impedance_at_V(0)), so the .tf check never
    // offers "Use gnd" for a typo of that ordinary node: it would measure ground.
    const alone = describeRun(fact('A3b-alone').netlist, runs.get('an-tf-gnd-alone')!);
    expect(alone.words.tf?.at).toBe('at ground');
    expect(alone.words.tf?.transferFunction?.speech).toBe('the transfer function from V1 to the voltage at ground is 0 volts per volt');
    const after = describeRun(fact('A3c').netlist, runs.get('an-tf-after-end')!);
    expect(after.words.tf?.at).toBe('between node out and node mid');
    expect(plain(after.words.tf?.transferFunction?.text)).toBe('v(out,mid)/V1 = 0.3333 (V/V)');
    expect(plain(after.words.tf?.inputResistance?.text)).toBe('input resistance seen by V1: 3 kΩ (ngspice calls it the input impedance)');
    expect(after.words.tf?.outputResistance?.speech).toBe('the output resistance between node out and node mid is 666.7 ohms, the Thévenin resistance');
    // A4's netlist with its .tf after .end: a current source as the input, V/A as above .end (A3d).
    const a4 = describeRun(fact('A3d').netlist, runs.get('an-tf-isource-after-end')!).words.tf!;
    const a4Above = ofFact('A4').words.tf!;
    expect([a4.ratio, plain(a4.transferFunction?.text), a4.transferFunction?.speech]).toEqual(['V/A', 'v(b)/I1 = 1 (V/A)', 'the transfer function from I1 to the voltage at node b is 1 volt per amp, which is an ohm']);
    expect([a4.transferFunction?.speech, a4.outputResistance?.text, a4.inputResistance?.text]).toEqual([a4Above.transferFunction?.speech, a4Above.outputResistance?.text, a4Above.inputResistance?.text]);
    // A current output after .end is the current in its part, named as written (A3e).
    const a3e = describeRun(fact('A3e').netlist, runs.get('an-tf-current-after-end')!).words.tf!;
    expect([a3e.output, a3e.ratio, plain(a3e.transferFunction?.text), a3e.transferFunction?.speech]).toEqual(['i(Vm)', 'A/A', 'i(Vm)/I1 = 0.6667 (A/A)', 'the transfer function from I1 to the current in Vm is 0.6667 amps per amp']);
    expect(plain(a3e.outputResistance?.text)).toBe("ngspice's output impedance for i(Vm): 1e+20 Ω, a stand-in number rather than a resistance of your circuit");
  });

  it('a .tf in a subcircuit no X line uses is left out, as ngspice leaves it out; one an X line uses is the main circuit\'s (A3f)', () => {
    // Only the .tf v(out) after .ends runs: its numbers are v(out)'s, never named v(a,gnd).
    const sub = describeRun(fact('A3f').netlist, runs.get('an-tf-subckt')!);
    expect(plain(sub.words.tf?.transferFunction?.text)).toBe('v(out)/V1 = 0.5 (V/V)');
    expect(sub.words.tf?.at).toBe('at node out');
    expect(sub.words.warnings.map((w) => w.code)).not.toContain('tf-node-missing');
    expect(describeCircuit(sub.netlist)).toContain('Analysis: transfer function from V1 to v(out).');
    expect(explainLine(sub.netlist, 6)!.notes).toEqual(['ngspice ignores this line: it is inside the subcircuit s (from line 5), and no X line uses that subcircuit. Put analysis lines in the main circuit, outside .subckt … .ends.']);
    // With nothing else, nothing runs, whatever the analysis.
    for (const id of ['an-tf-subckt-alone', 'an-op-subckt', 'an-dc-subckt', 'an-tran-subckt', 'an-ac-subckt', 'an-noise-subckt']) {
      const f = FACTS.find((x) => x.id === id)!;
      expect(runs.get(id)!.plots, id).toEqual([]);
      expect(describeCircuit(parseNetlist(f.netlist)), id).toContain('Its analysis lines are inside a subcircuit that no X line uses, where ngspice ignores them, so ngspice will run nothing.');
      const line = parseNetlist(f.netlist).lines.findIndex((l) => l.directive && ['.tf', '.op', '.dc', '.tran', '.ac', '.noise'].includes(l.directive.name));
      expect(explainLine(parseNetlist(f.netlist), line)!.notes[0], id).toMatch(/^ngspice ignores this line/);
    }
    // Used by an X line, the .tf is the main circuit's: v(out) is the main circuit's out (1/3, 333.3 Ω).
    const used = describeRun(FACTS.find((x) => x.id === 'an-tf-subckt-used')!.netlist, runs.get('an-tf-subckt-used')!);
    expect(plain(used.words.tf?.transferFunction?.text)).toBe('v(out)/V1 = 0.3333 (V/V)');
    expect(explainLine(used.netlist, 7)!.notes.join(' ')).not.toContain('ngspice ignores this line');
    // Once for each X line that uses it.
    expect(runs.get('an-tf-subckt-twice')!.plots.filter((p) => /transfer function/i.test(p.plotname)).length).toBe(2);
  });

  it('F5: 3 A from n1 to 0 through R1; Vx measures 1 A; Itest and F1 deliver 14 W and 24 W (C5)', () => {
    const d = ofFixture('f5-thevenin-cccs');
    expect(d.words.nodes.map((n) => [n.node, plain(n.text), n.colourIndex])).toEqual([['a', '14 V', 0], ['x', '14 V', 1], ['n1', '12 V', 2]]);
    expect(plain(currentText(d, 'R1'))).toBe('3 A from node n1 to ground through R1');
    expect(plain(currentText(d, 'R2'))).toBe('1 A from node x to node n1 through R2');
    expect(plain(currentText(d, 'Vx'))).toBe('Vx measures 1 A flowing from node a to node x');
    expect(d.words.currents.find((c) => c.name === 'Vx')?.power).toBeUndefined();
    expect(plain(currentText(d, 'F1'))).toBe('2 A from ground to node n1 through F1');
    expect(plain(powerText(d, 'Itest'))).toBe('Itest delivers 14 W');
    expect(plain(powerText(d, 'F1'))).toBe('F1 delivers 24 W');
    expect(d.words.currents.find((c) => c.name === 'R1')?.speech).toBe('3 amps flow from node n1 to ground through R1');
    expect(plain(d.words.summary)).toBe('Simulation finished: node a = 14 V, node x = 14 V, node n1 = 12 V; 5 currents. Open the results for details.');
  });

  it('F5 without savecurrents: only the 0 V source has a current, and the other lines show their voltage (A1)', () => {
    const d = ofFixture('f5-thevenin-cccs', false);
    expect(d.words.currents.map((c) => c.name)).toEqual(['Vx']);
    const notes = annotateLines(d.netlist, d.results, d.run).map((a) => [a.line, plain(a.text)]);
    expect(notes).toEqual([[2, '−14 V across'], [3, '1 A, a → x'], [4, '2 V across'], [5, '12 V across'], [6, '−12 V across']]);
  });

  it('D1: a DC sweep of 13 points, ending at v(out) = 8 V (A7)', () => {
    const d = ofFixture('d1-dc-divider-sweep', false);
    const s = d.words.sweeps[0]!;
    expect(s.points).toBe(13);
    expect(plain(s.text)).toBe('DC sweep of V1 from 0 V to 12 V in steps of 1 V: 13 points. At V1 = 12 V: v(in) = 12 V, v(out) = 8 V, i(v1) = −4 mA.');
    expect(s.speech).toContain('the voltage at node out is 8 volts, the current in V1 is minus 4 milliamps');
  });

  it('T1: a transient over 5 ms on ngspice\'s own time points (A16)', () => {
    const d = ofFixture('t1-tran-rc-charge', false);
    const s = d.words.sweeps[0]!;
    expect(s.kind).toBe('tran');
    expect(s.points).toBe(520);
    expect(plain(s.text)).toBe('Transient from 0 s to 5 ms: 520 time points. At 5 ms: v(in) = 5 V, v(out) = 4.966 V, i(v1) = −33.71 µA.');
  });

  it('describes every fixture circuit for a screen reader', () => {
    const d = ofFixture('f5-thevenin-cccs', false);
    expect(plain(describeCircuit(d.netlist))).toBe(
      '5 parts and 3 nodes besides ground (a, x, n1). Itest: a 1 A current source pushing current from ground into node a. Vx: a 0 V source from node a to node x: a wire, through which ngspice measures the current (the ammeter trick). R2: a 2 Ω resistor between node x and node n1. R1: a 4 Ω resistor between node n1 and ground. F1: a current-controlled current source pushing 2 × the current in Vx from ground into node n1. Analysis: operating point.',
    );
    for (const id of FIXTURES) expect(describeCircuit(parseNetlist(fixtureText(id))).length, id).toBeGreaterThan(40);
  });
});

describe('results in words: currents and power (C1–C8, A5)', () => {
  it('C1, C1b: which sign means "delivers" depends on which side of the source is the higher one', () => {
    const c1 = ofFact('C1');
    expect(plain(powerText(c1, 'V1'))).toBe('V1 delivers 18 W');
    expect(c1.words.currents.find((c) => c.name === 'V1')!.value).toBeLessThan(0);
    expect(explainLine(c1.netlist, 1)!.notes.join(' ')).toContain('while this source delivers power, with its + side the higher one, its current is negative');
    // V1 0 n1 -6: the + side is the lower one, so the source delivers 18 W with a positive current.
    const c1b = ofFact('C1b');
    expect(plain(powerText(c1b, 'V1'))).toBe('V1 delivers 18 W');
    expect(c1b.words.currents.find((c) => c.name === 'V1')!.value).toBeGreaterThan(0);
    expect(plain(currentText(c1b, 'V1'))).toBe('3 A from ground to node n1 through V1');
    const note = explainLine(c1b.netlist, 1)!.notes.join(' ');
    expect(note).toContain('Its value is negative, so its + side is the lower one: while it delivers power, its current is positive.');
    expect(note).not.toContain('negative current');
  });

  it('A36: a netlist whose only analysis is in .control runs; PlainSpice says so instead of "nothing to run"', () => {
    const d = ofFact('A36');
    expect(d.words.status).toBe('failed');
    expect(d.words.ngspiceError).toBe(false);
    expect(d.words.warnings.map((m) => m.code)).toEqual(['control-only']);
    expect(d.words.summary).toBe('ngspice finished but gave no results: ngspice ran the .control block. Open the results for details.');
  });

  it('C2: a source that absorbs power says so, and its note says the current goes into +', () => {
    const d = ofFact('C2');
    expect(plain(powerText(d, 'V1'))).toBe('V1 absorbs 12 W');
    expect(plain(powerText(d, 'V2'))).toBe('V2 delivers 24 W');
    expect(plain(annotateLines(d.netlist, d.results, d.run).find((a) => a.line === 2)?.text)).toBe('absorbs 12 W, 2 A into +');
  });

  it('C3: resistor directions from the sign; current sources from their value', () => {
    const d = ofFact('C3');
    expect(plain(currentText(d, 'R1'))).toBe('3 A from node n1 to ground through R1');
    expect(plain(currentText(d, 'R2'))).toBe('3 A from ground to node n2 through R2');
    expect(plain(currentText(d, 'I2'))).toBe('3 A from node n2 to ground through I2');
    expect(plain(powerText(d, 'I1'))).toBe('I1 delivers 36 W');
    expect(plain(powerText(d, 'I2'))).toBe('I2 delivers 36 W');
  });

  it('C4: F and G push their current into the node they name second', () => {
    const d = ofFact('C4');
    expect(plain(currentText(d, 'F1'))).toBe('4 A from ground to node o through F1');
    expect(plain(currentText(d, 'F2'))).toBe('4 A from node p to ground through F2');
    expect(plain(currentText(d, 'G1'))).toBe('1 A from ground to node q through G1');
    expect(plain(currentText(d, 'G2'))).toBe('1 A from node r to ground through G2');
  });

  it('C6, C7: E, H and B sources deliver power', () => {
    expect(plain(powerText(ofFact('C6'), 'E1'))).toBe('E1 delivers 18 W');
    expect(plain(powerText(ofFact('C6'), 'H1'))).toBe('H1 delivers 32 W');
    expect(plain(currentText(ofFact('C7'), 'B1'))).toBe('2 A from ground to node b through B1');
    expect(plain(powerText(ofFact('C7'), 'B1'))).toBe('B1 delivers 4 W');
  });

  it('C8: switch currents from savecurrents are left out, because ngspice gets them wrong', () => {
    const d = ofFact('C8');
    expect(d.results.op!.currents.map((c) => c.element)).toEqual(expect.arrayContaining(['s1', 'w1']));
    expect(d.words.currents.map((c) => c.element)).not.toContain('s1');
    expect(d.words.currents.map((c) => c.element)).not.toContain('w1');
    expect(plain(currentText(d, 'Rc'))).toBe('1.5 A from node c to ground through Rc');
  });

  it('A1, A2: an inductor appears once, with its branch current', () => {
    const d = ofFact('A2');
    expect(d.words.currents.filter((c) => c.element === 'l1')).toHaveLength(1);
    expect(plain(currentText(d, 'L1'))).toBe('2.097 A from node b to node c through L1');
    expect(plain(currentText(d, 'C1'))).toBe('no current through C1');
  });

  it('A5: for a current output, the 1e20 Ω output impedance is not called a resistance', () => {
    const tf = ofFact('A5').words.tf!;
    expect(plain(tf.transferFunction?.text)).toBe('i(Vm)/V1 = 0.1667 (A/V)');
    expect(plain(tf.outputResistance?.text)).toBe("ngspice's output impedance for i(Vm): 1e+20 Ω, a stand-in number rather than a resistance of your circuit");
  });

  it('A4: a current-source input gives a ratio in V/A', () => {
    const tf = ofFact('A4').words.tf!;
    expect(tf.ratio).toBe('V/A');
    expect(tf.transferFunction?.speech).toBe('the transfer function from I1 to the voltage at node b is 1 volt per amp, which is an ohm');
    expect(plain(tf.outputResistance?.text)).toContain('output resistance at node b: 1.5 Ω');
  });
});

describe('results in words: ngspice\'s messages, from real runs (M1–M21 and others)', () => {
  const cases: [code: string, status: ResultsInWords['status'], title: string, line?: number][] = [
    ['M1', 'unreliable', 'No ground (node 0)'],
    ['M2', 'unreliable', 'Node b has no DC path to ground'],
    ['M2b', 'unreliable', 'Node a has no DC path to ground'],
    ['M2c', 'unreliable', 'Node n3 is not connected to the rest of the circuit'],
    ['M2d', 'unreliable', 'Node out (written with a zero-width space in it) has no DC path to ground'],
    ['M2d-tr', 'unreliable', 'Node \u00c7IKI\u015e has no DC path to ground'],
    ['M3', 'failed', 'V1 is in a loop of voltage sources or shorts', 2],
    ['M3b', 'failed', 'V1 is in a loop of voltage sources or shorts', 2],
    ['M3c', 'unreliable', 'L1 is in a loop of voltage sources or shorts', 3],
    ['M4', 'failed', 'Two parts are called R1', 4],
    ['M4b', 'failed', 'R\u015f and R\u00e7 are the same name for ngspice', 4],
    ['M4c', 'failed', 'R\u00b5 and Ru are the same name for ngspice', 4],
    ['M5', 'failed', 'A line starts with 1', 4],
    ['M5b', 'failed', 'A line starts with Ü', 4],
    ['M6', 'failed', 'No subcircuit called amp', 4],
    ['M7', 'failed', 'No model for D1', 4],
    ['M8', 'failed', "The model of M1 is not in PlainSpice's engine", 4],
    ['M9', 'failed', 'E1 is missing fields', 3],
    ['M10', 'failed', '.tf: there is no V9', 5],
    ['M11', 'failed', '.tf: R1 is not a source', 5],
    ['M12', 'failed', '.dc: there is no V9', 5],
    ['M13', 'failed', '.dc needs a step that is not 0', 5],
    ['M13b', 'failed', '.dc needs a step that is not 0', 5],
    ['M14', 'failed', '.tran needs a step and a stop time', 6],
    ['M15', 'failed', 'The .tran step must be more than 0', 6],
    ['M15b', 'failed', 'tstart must come before tstop', 6],
    ['M16', 'failed', 'There is no inductor called L2', 5],
    ['M17', 'failed', 'No .param defines rx', 3],
    ['M18', 'failed', 'An expression is not closed', 3],
    ['M19', 'failed', 'A B line needs V= or I=', 3],
    ['M20', 'failed', 'Nothing to run'],
    ['M21', 'failed', 'An expression is not closed', 4],
    ['P10', 'failed', 'F1 cannot read the current of R1', 4],
    ['P10c', 'failed', 'F1 cannot read the current of L1', 5],
    ['P13', 'ok', 'R1 is too small for ngspice', 3],
    ['P15', 'ok', 'R1 was left out', 4],
    ['P16', 'ok', 'V1 has no value: 0 V', 2],
    ['A6', 'ok', 'n9 is not a node of the circuit', 4],
    ['A11', 'failed', 'The .dc sweep has no points', 4],
    ['A26', 'failed', 'ngspice cannot find the file models.lib', 2],
    ['A27', 'ok', 'A .control command ran before the results existed'],
    ['A28', 'ok', '.meas was skipped', 6],
    ['A29', 'failed', 'ngspice does not know .foo', 4],
    ['A29b', 'failed', 'ngspice does not know .hb', 4],
    ['A33', 'failed', 'ngspice cannot find the file models.lib', 2],
  ];

  it.each(cases)('%s: %s, "%s"', (code, status, title, line) => {
    const d = ofFact(code);
    expect(d.words.status).toBe(status);
    const m = d.words.warnings.find((w) => w.title === title);
    expect(m, d.words.warnings.map((w) => w.title).join(' | ')).toBeDefined();
    if (line !== undefined) expect(m!.line).toBe(line);
    expect(m!.why.length).toBeGreaterThan(20);
    // The live summary leads with the first problem when the run failed or can't be trusted.
    if (status !== 'ok') expect(d.words.summary.toLowerCase()).toContain(title.toLowerCase().slice(0, 12));
  });

  it('M4b, M4c: two part names that differ by more than capital letters get the reason ngspice joins them, and the earlier part (S9)', () => {
    const letters = ofFact('M4b').words.warnings.find((w) => w.code === 'duplicate-name')!;
    expect(letters.why).toBe(
      'Each part needs its own name. ngspice writes each letter other than a to z (or A to Z) in a name as underscores, so R\u00e7 here is the same name as R\u015f on line 3: both are r__. ngspice stops at the second one ("device already exists"). Rename one of them with the letters a to z.',
    );
    const micro = ofFact('M4c').words.warnings.find((w) => w.code === 'duplicate-name')!;
    expect(micro.why).toBe(
      'Each part needs its own name. ngspice reads the micro sign \u00b5 as u, so Ru here is the same name as R\u00b5 on line 3: both are ru. ngspice stops at the second one ("device already exists"). Rename one of them with the letters a to z.',
    );
    // R1 and r1 keep the capital letters (M4).
    expect(ofFact('M4').words.warnings.find((w) => w.code === 'duplicate-name')!.why).toContain('SPICE ignores capital letters, so r1 here is the same name as R1 on line 3');
  });

  it('puts "these numbers can\'t be trusted" first on an unreliable run, and gives no inline notes', () => {
    const d = ofFact('M1');
    expect(d.words.warnings[0]!.code).toBe('unreliable');
    expect(d.words.summary).toBe("Simulation finished, but its numbers can't be trusted: no ground (node 0). Open the results for details.");
    expect(annotateLines(d.netlist, d.results, d.run)).toEqual([]);
  });

  it('explains every diagnostic of every claim run without throwing, in words', () => {
    for (const f of FACTS) {
      const r = runs.get(f.id)!;
      const n = parseNetlist(f.netlist);
      for (const diag of r.diagnostics) {
        const w = explainDiagnostic(diag, n);
        expect(w.title.length, `${f.code} ${diag.code}`).toBeGreaterThan(3);
        expect(w.why.length, `${f.code} ${diag.code}`).toBeGreaterThan(10);
        if (w.line !== undefined) expect(w.line).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

// ------------------------------------------------------------------ after the final reviews

describe('after the final reviews (12 November 2026)', () => {
  it('drawing-1: a video example runs the same with and without its drawing lines, and Explain gives them one entry that says ngspice skips them (kept F2)', async () => {
    const text = readFileSync(join(root, 'examples/p01/p01-3-ccvs-supernode.cir'), 'utf8');
    const bare = text
      .split('\n')
      .filter((l) => !/^\s*\*(@|\s*plainspice-drawing)/i.test(l))
      .join('\n');
    const [drawn, plain] = [await engine.run(text), await engine.run(bare)];
    expect(drawn.ok && plain.ok).toBe(true);
    expect(drawn.plots.map((p) => p.variables.map((v) => v.name))).toEqual(plain.plots.map((p) => p.variables.map((v) => v.name)));
    drawn.plots.forEach((p, k) => p.real.forEach((v, i) => expect(Array.from(v), p.variables[i]!.name).toEqual(Array.from(plain.plots[k]!.real[i]!))));
    expect(drawn.diagnostics).toEqual(plain.diagnostics);
    const entries = explainNetlist(parseNetlist(text));
    expect(entries.filter((e) => e.heading.startsWith('Drawing line'))).toEqual([
      {
        line: 11,
        lastLine: 32,
        heading: 'Drawing lines',
        summary: 'These lines say where each part, wire and node name is drawn; PlainSpice reads them to draw the circuit. ngspice skips them: a line that starts with * is a comment.',
        fields: [],
        notes: [],
      },
    ]);
    expect(entries.filter((e) => e.heading === 'Comment')).toHaveLength(1);
  });
});

describe('after the final reviews (12 November 2026): rounding noise is 0 A (student review; C9–C9c)', () => {
  /** Exactly, bit for bit: `agrees` counts any two values below 1e-12 as equal, so it cannot check noise. */
  const exactly = (code: string): void => {
    const f = fact(code);
    const r = runs.get(f.id)!;
    for (const [name, want] of Object.entries(f.vectors ?? {})) expect(vectorValues(r.plots, name), `${code} ${name}`).toEqual([want]);
  };

  it('C9, C9b: our engine gives the same noise as native ngspice 47, to the last bit', () => {
    exactly('C9');
    exactly('C9b');
  });

  it('C9c: abstol and vntol, ngspice\'s tolerances for currents and voltages, are 1e-12 A and 1e-6 V: the floors describe.ts uses', () => {
    expect(runs.get(fact('C9c').id)!.stdout).toMatch(/abstol\s+\(current\) = 1e-12\n/);
    expect(runs.get(fact('C9c').id)!.stdout).toMatch(/vntol\s+\(voltage\) = 1e-06\n/);
    expect(ABSTOL).toBe(1e-12);
    expect(VNTOL).toBe(1e-6);
  });

  it('C9: the balanced bridge says R5 carries no current, with no arrow, and says what ngspice gave', () => {
    const d = ofFact('C9');
    const r5 = d.words.currents.find((c) => c.name === 'R5')!;
    expect(r5).toMatchObject({ value: 0, noise: -8.881784197001253e-19, text: 'no current through R5', speech: 'no current flows through R5' });
    expect(r5.power).toBeUndefined();
    expect(annotateLines(d.netlist, d.results, d.run).find((a) => a.line === 7)).toMatchObject({ text: '0 A', speech: 'no current flows' });
    const note = d.words.warnings.find((m) => m.code === 'rounding-noise')!;
    expect(note).toMatchObject({ severity: 'note', title: "R5's current is shown as 0 A", line: 7 });
    expect(note.why).toContain('ngspice gave R5 -8.881784e-19 A.');
    // The why: the circuit makes the current 0, and ngspice's number is below its tolerance.
    expect(plain(note.why)).toContain('the two ends of R5, node a and node b, are at the same voltage, 4.5 V.');
    expect(note.why).toContain("below 1 pA, ngspice's current tolerance (its abstol option), so PlainSpice shows 0 A.");
    // The other currents are real and keep their words; a note is no problem for the summary.
    expect(plain(currentText(d, 'R1'))).toBe('450 µA from node top to node a through R1');
    expect(d.words.summary).not.toMatch(/warning/);
  });

  it('C9b: when every current is noise, none is drawn, none delivers or absorbs power, and the note gives each value', () => {
    const d = ofFact('C9b');
    expect(d.words.status).toBe('ok');
    for (const c of d.words.currents) {
      expect(c.value, c.name).toBe(0);
      expect(c.power, c.name).toBeUndefined();
    }
    expect(d.words.currents.filter((c) => c.noise !== undefined).map((c) => [c.name, c.noise])).toEqual([
      ['V1', -1.734723475976807e-18],
      ['R1', 1.7763568394002505e-18],
      ['R3', 1.1842378929335003e-18],
      ['F1', -3.469446951953614e-18],
    ]);
    const note = d.words.warnings.find((m) => m.code === 'rounding-noise')!;
    expect(note.title).toBe('4 currents are shown as 0 A');
    expect(note.why).toContain('ngspice gave V1 -1.734723e-18 A, R1 1.776357e-18 A, R3 1.184238e-18 A and F1 -3.469447e-18 A.');
    expect(annotateLines(d.netlist, d.results, d.run).every((a) => a.text === '0 A')).toBe(true);
  });

  it('C9, C9b, C9d-C9g: our engine gives these noise and tiny currents as native ngspice 47 does, to the last bit', () => {
    for (const code of ['C9d', 'C9e', 'C9f', 'C9g']) exactly(code);
  });

  it('C9d: the noise passes on: Vm, F1 that copies it and R6 that F1 drives carry no current, and node out is at 0 V (critic of round 1)', () => {
    const d = ofFact('C9d');
    expect(d.words.currents.filter((c) => c.noise !== undefined).map((c) => [c.name, c.value, c.noise])).toEqual([
      ['Vm', 0, -2.168404344971009e-19],
      ['F1', 0, -2.1684043449710089e-16],
      ['R6', 0, -2.1684043449710089e-16],
    ]);
    for (const c of d.words.currents.filter((x) => x.noise !== undefined)) expect(c.power, c.name).toBeUndefined();
    const out = d.words.nodes.find((n) => n.node === 'out')!;
    expect([out.value, out.noise, plain(out.text)]).toEqual([0, -2.1684043449710089e-13, '0 V']);
    // The other numbers are answers and keep their words.
    expect(plain(currentText(d, 'R1'))).toBe('450 µA from node top to node a through R1');
    const note = d.words.warnings.find((m) => m.code === 'rounding-noise')!;
    expect(note.title).toBe('3 currents are shown as 0 A, and node out as 0 V');
    expect(note.why).toContain('ngspice gave Vm -2.168404e-19 A, F1 -2.168404e-16 A, R6 -2.168404e-16 A and node out -2.168404e-13 V.');
    expect(annotateLines(d.netlist, d.results, d.run).find((a) => a.line === 10)).toMatchObject({ text: '0 A' });
  });

  it('C9e-C9g: a tiny current the circuit makes is shown as ngspice gives it, next to large currents too: 2 aA, 120 fA, 0.5 pA, and no note (critic of round 1)', () => {
    const cases: [string, string, number][] = [
      ['C9e', 'I1', 2e-18],
      ['C9f', 'R2', 1.2e-13],
      ['C9g', 'R3', 4.999999999995e-13],
    ];
    for (const [code, name, value] of cases) {
      const d = ofFact(code);
      expect(d.words.status, code).toBe('ok');
      expect(d.words.currents.map((c) => c.noise), code).toEqual(d.words.currents.map(() => undefined));
      expect(d.words.currents.find((c) => c.name === name)!.value, code).toBe(value);
      expect(d.words.warnings.some((m) => m.code === 'rounding-noise'), code).toBe(false);
    }
    expect(plain(currentText(ofFact('C9e'), 'I1'))).toBe('2 aA from ground to node b through I1');
    expect(plain(currentText(ofFact('C9f'), 'R2'))).toBe('120 fA from node in to ground through R2');
  });

  it('C9h-C9j, C9l: our engine gives these tiny currents as native ngspice 47 does, to the last bit', () => {
    for (const code of ['C9h', 'C9i', 'C9j', 'C9l']) exactly(code);
  });

  it('C9h-C9j: a tiny real current flows on through the parts in series and side by side: shown as ngspice gives it, with no note (critic of round 2)', () => {
    const cases: [string, string, number][] = [
      ['C9h', 'R1', -1.7763568394002505e-18],
      ['C9h', 'V1', 1.734723475976807e-18],
      ['C9i', 'R1', 1.2008172234345695e-13],
      ['C9i', 'V1', -1.2012613126444194e-13],
      ['C9j', 'R2', -1.7763568394002505e-18],
      ['C9j', 'V1', 3.469446951953614e-18],
    ];
    for (const [code, name, value] of cases) {
      const d = ofFact(code);
      expect(d.words.currents.map((c) => c.noise), code).toEqual(d.words.currents.map(() => undefined));
      expect(d.words.currents.find((c) => c.name === name)!.value, `${code} ${name}`).toBe(value);
      expect(d.words.warnings.some((m) => m.code === 'rounding-noise'), code).toBe(false);
    }
    // The critic saw "2 aA, delivers 24 aW" next to R1 "0 A" and V1 "0 A". Now R1 and V1 carry I1's current, to within ngspice's rounding.
    expect(plain(currentText(ofFact('C9h'), 'R1'))).toBe('1.776 aA from node b to node a through R1');
    expect(plain(powerText(ofFact('C9h'), 'V1'))).toBe('V1 absorbs 20.82 aW');
    expect(plain(currentText(ofFact('C9i'), 'R1'))).toBe('120.1 fA from node in to node a through R1');
  });

  it('C9l: ends 3000 units in the last place apart carry a real current: the voltmeter across R2 makes 2.696 fA flow through R5 (critic of round 2)', () => {
    const d = ofFact('C9l');
    const [a, b] = [d.results.op!.nodes.find((n) => n.node === 'a')!.value, d.results.op!.nodes.find((n) => n.node === 'b')!.value];
    expect(Math.abs(a - b) / 2 ** -50).toBeGreaterThan(3000);
    expect(d.words.currents.map((c) => c.noise)).toEqual(d.words.currents.map(() => undefined));
    expect(plain(currentText(d, 'R5'))).toBe('2.696 fA from node b to node a through R5');
    expect(d.words.warnings.some((m) => m.code === 'rounding-noise')).toBe(false);
    // Without the voltmeter, R5's ends are 1 unit in the last place apart and its current is noise (C9).
    expect(ofFact('C9').words.currents.find((c) => c.name === 'R5')!.noise).toBe(-8.881784197001253e-19);
  });

  it('C9k: a ladder of 1000 sections gives section 30 the same values as a ladder of 100, nanovolts and femtoamps that stay; its far end goes below the smallest normal double and then to 0 (critic of round 2)', async () => {
    const ladder = (sections: number): string => {
      const lines = [`* a ladder of ${sections} sections: each divides the voltage again`, 'V1 n0 0 10'];
      for (let k = 1; k <= sections; k++) lines.push(`Ra${k} n${k - 1} n${k} 1k`, `Rb${k} n${k} 0 2k`, `Vm${k} n${k} m${k} 0`, `Rc${k} m${k} 0 10k`);
      return [...lines, '.options savecurrents', '.op', '.end'].join('\n') + '\n';
    };
    const [short, long] = [ladder(100), ladder(1000)];
    const [r100, r1000] = [await engine.run(short), await engine.run(long)];
    // As native ngspice 47 and 42 gave them (docs/spice-facts/explanations.md, C9k).
    for (const r of [r100, r1000]) {
      expect(vectorValues(r.plots, 'v(n30)')).toEqual([1.3949570192590355e-9]);
      expect(vectorValues(r.plots, 'i(@rb30[i])')).toEqual([6.974785096295177e-13]);
    }
    expect(vectorValues(r100.plots, 'v(n100)')).toEqual([2.0685102856568829e-32]);
    expect(['v(n100)', 'v(n939)', 'v(n940)', 'v(n987)', 'v(n988)'].map((n) => vectorValues(r1000.plots, n)![0])).toEqual([1.4077842058616815e-32, 3.347756568565453e-308, 1.571228079166437e-308, 5e-324, 0]);
    for (const [text, r] of [[short, r100], [long, r1000]] as const) {
      const d = describeRun(text, r);
      expect(d.words.currents.filter((c) => c.noise !== undefined).map((c) => c.name)).toEqual([]);
      expect(d.words.nodes.filter((n) => n.noise !== undefined).map((n) => n.node)).toEqual([]);
      expect(plain(d.words.nodes.find((n) => n.node === 'n30')!.text)).toBe('1.395 nV');
      expect(plain(currentText(d, 'Rb30'))).toBe('697.5 fA from node n30 to ground through Rb30');
      expect(d.words.warnings.some((m) => m.code === 'rounding-noise')).toBe(false);
    }
  });

  it('a tiny current that is the whole circuit is not noise: the 3 aA of a 3a source stays 3 aA (unit-letter-1)', async () => {
    const text = '* 3A on a current source\nI1 0 n1 3A\nR1 n1 0 4\n.options savecurrents\n.op\n.end\n';
    const d = describeRun(text, await engine.run(text));
    expect(d.words.currents.map((c) => [c.name, c.value, c.noise])).toEqual([
      ['I1', 3.0000000000000002e-18, undefined],
      ['R1', 3.0000000000000002e-18, undefined],
    ]);
    expect(d.words.warnings.some((m) => m.code === 'rounding-noise')).toBe(false);
  });
});
