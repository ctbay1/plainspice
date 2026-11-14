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
import { ABSTOL, VNTOL, annotateLines, describeCircuit, describeResults, explainDiagnostic, roundingNoise, shownSweep, type ResultsInWords } from '../../src/spice/describe.ts';
import { explainLine, explainNetlist, readAnalysis } from '../../src/spice/explain.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { netlistToRun, RUN_COPY_WORDS, SAVE_CURRENTS_LINE } from '../../src/spice/run-netlist.ts';
import { applyFix, checkTraps } from '../../src/spice/traps.ts';
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
  { code: 'A2c', id: 'an-plus-after-end', netlist: "* a + line after .end\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n", vectors: { "v(n1)": 3 } },
  { code: 'A2c', id: 'an-plus-after-end-added', netlist: "* a + line after .end\nI1 0 n1 1\n.op\nR1 n1 0 2\n.options savecurrents\n.end\n+ 3\n", vectors: { "v(n1)": 2, "i(@i1[current])": 1, "i(@r1[i])": 1 } },
  { code: 'A2c', id: 'an-plus-after-end-moved', netlist: "* a + line after .end\nI1 0 n1 1\n.op\nR1 n1 0 2\n+ 3\n.options savecurrents\n.end\n", vectors: { "v(n1)": 3, "i(@i1[current])": 1, "i(@r1[i])": 1 } },
  { code: 'A2c', id: 'an-plus-after-end-vsource', netlist: "* a + line after .end, with a voltage source\nV1 a 0 6\nR1 a b 1\n.op\nR2 b 0 2\n.end\n+ 3\n", vectors: { "v(a)": 6, "v(b)": 4.5, "i(v1)": -1.5 } },
  { code: 'A2c', id: 'an-plus-after-end-b', netlist: "* a + line after .end, with a B source\nV1 a 0 9\nR1 a b 1k\nR2 b 0 2k\n.op\nR3 c 0 1k\nB1 c 0 V=1+\n.end\n+ v(b)\n", vectors: { "v(a)": 9, "v(b)": 6, "v(c)": 7, "i(b1)": -0.007, "i(v1)": -0.003000000000000001 } },
  { code: 'A2d', id: 'an-savecurrents-after-end', netlist: "* .options savecurrents after .end\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.options savecurrents\n", vectors: { "v(n1)": 3, "i(@i1[current])": 1, "i(@r1[i])": 1 } },
  { code: 'A2d', id: 'an-savecurrents-after-glued-end', netlist: "* .options savecurrents after .end with a comment glued on\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end;x\n+ 3\n.options savecurrents\n", vectors: { "v(n1)": 2, "i(@i1[current])": 1, "i(@r1[i])": 1 } },
  { code: 'A2d', id: 'an-savecurrents-after-at', netlist: "* .options savecurrents after a line starting with @\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n@ x\n.options savecurrents\n", vectors: { "v(n1)": 3 } },
  { code: 'A2d', id: 'an-savecurrents-in-control', netlist: "* .options savecurrents in a .control block\nI1 0 n1 1\n.op\nR1 n1 0 2\n.control\n.options savecurrents\n.endc\n.end\n+ 3\n", vectors: { "v(n1)": 2, "i(@i1[current])": 1, "i(@r1[i])": 1 } },
  { code: 'A2d', id: 'an-savecurrents-plus-after-end', netlist: "* .options before .end, savecurrents on a + line after it\nI1 0 n1 1\nR1 n1 0 2\n.op\n.options\n.end\n+ savecurrents\n", vectors: { "v(n1)": 2, "i(@i1[current])": 1, "i(@r1[i])": 1 } },
  { code: 'A2d', id: 'an-savecurrents-command', netlist: "* the command option savecurrents\nI1 0 n1 1\n.op\nR1 n1 0 2\n.control\noption savecurrents\n.endc\n.end\n+ 3\n", vectors: { "v(n1)": 2 } },
  { code: 'A2d', id: 'an-savecurrents-in-control-after-end', netlist: "* .options savecurrents in a .control block after .end\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.control\n.options savecurrents\n.endc\n", vectors: { "v(n1)": 3, "i(@i1[current])": 1, "i(@r1[i])": 1 } },
  { code: 'A2d', id: 'an-savecurrents-opt-in-capitals', netlist: "* .OPT SaveCurrents, indented, with a comment\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n  .OPT SaveCurrents ; a note\n", vectors: { "v(n1)": 3, "i(@i1[current])": 1, "i(@r1[i])": 1 } },
  { code: 'A2d', id: 'an-savecurrents-optfoo', netlist: "* .optfoo savecurrents_mos1\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.optfoo savecurrents_mos1\n", vectors: { "v(n1)": 3, "i(@i1[current])": 1, "i(@r1[i])": 1 } },
  { code: 'A2d', id: 'an-savecurrents-in-a-comment', netlist: "* savecurrents in a comment only\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.options temp=27 ; savecurrents\n* .options savecurrents\n", vectors: { "v(n1)": 3 } },
  { code: 'A2d', id: 'an-savecurrents-starhash-command', netlist: "* the command option savecurrents on a *# line\nI1 0 n1 1\n.op\nR1 n1 0 2\n*# option savecurrents\n.end\n+ 3\n", vectors: { "v(n1)": 3 } },
  { code: 'A2d', id: 'an-savecurrents-set-command', netlist: "* the command set savecurrents\nI1 0 n1 1\n.op\nR1 n1 0 2\n.control\nset savecurrents\n.endc\n.end\n+ 3\n", vectors: { "v(n1)": 2 } },
  { code: 'A2e', id: 'an-savecurrents-backslash', netlist: "* .options ending in two backslashes, after .end\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.options \\\\\nsavecurrents\n", vectors: { "v(n1)": 3, "i(@i1[current])": 1, "i(@r1[i])": 1 } },
  { code: 'A2e', id: 'an-savecurrents-backslash-blank-chain', netlist: "* two backslashes, a blank line, two backslashes again\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.options \\\\\n\ntemp=27 \\\\\nsavecurrents\n", vectors: { "v(n1)": 3, "i(@i1[current])": 1, "i(@r1[i])": 1 } },
  { code: 'A2e', id: 'an-savecurrents-backslash-comment-title', netlist: "* two backslashes before a comment line and a .title line\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.options \\\\\n* a note \\\\\n.title savecurrents\n", vectors: { "v(n1)": 3, "i(@i1[current])": 1, "i(@r1[i])": 1 } },
  { code: 'A2e', id: 'an-savecurrents-no-backslash-star-dollar-title', netlist: "* comment lines ending in two backslashes\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n* a note \\\\\n$ a note \\\\\n.title x \\\\\n.options savecurrents\n", vectors: { "v(n1)": 3, "i(@i1[current])": 1, "i(@r1[i])": 1 }, prints: ["Warning: Unusual leading characters like '$' or others out of '= [] ? () & % $\"!:,\\f'"], codes: ["unusual-leading-character"] },
  { code: 'A2e', id: 'an-savecurrents-backslash-hash', netlist: "* a # line ending in two backslashes\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.options\n# a note \\\\\nsavecurrents\n", vectors: { "v(n1)": 3, "i(@i1[current])": 1, "i(@r1[i])": 1 } },
  { code: 'A2e', id: 'an-savecurrents-backslash-in-comment', netlist: "* two backslashes inside a ; comment\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.options temp=27 ; a note \\\\\nsavecurrents\n", vectors: { "v(n1)": 3, "i(@i1[current])": 1, "i(@r1[i])": 1 } },
  { code: 'A2e', id: 'an-savecurrents-backslash-hdl-biaschk', netlist: "* two backslashes, then .hdl and .biaschk lines\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.options \\\\\n.hdl x\n.biaschk\nsavecurrents\n", vectors: { "v(n1)": 3, "i(@i1[current])": 1, "i(@r1[i])": 1 }, prints: ["Warning: Dot command .hdl is not supported, ingnored","Warning: Dot command .biaschk is not supported, ingnored"], codes: ["warning","warning"] },
  { code: 'A2e', id: 'an-savecurrents-title-backslash', netlist: "a title ending in two backslashes \\\\\n.options savecurrents\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n", vectors: { "v(n1)": 3 } },
  { code: 'A2e', id: 'an-savecurrents-control-dollar', netlist: "* $savecurrents in a .control block after .end\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.control\n.options temp=27 $savecurrents\n.endc\n", vectors: { "v(n1)": 3, "i(@i1[current])": 1, "i(@r1[i])": 1 } },
  { code: 'A2e', id: 'an-savecurrents-control-glued-dollar', netlist: "* 27$ savecurrents in a .control block after .end\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.control\n.options temp=27$ savecurrents\n.endc\n", vectors: { "v(n1)": 3 } },
  { code: 'A2e', id: 'an-savecurrents-control-plus-dollar', netlist: "* + $savecurrents in a .control block\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.control\n.options temp=27\n+ $savecurrents\n.endc\n", vectors: { "v(n1)": 3, "i(@i1[current])": 1, "i(@r1[i])": 1 } },
  { code: 'A2e', id: 'an-savecurrents-dollar-outside-control', netlist: "* $savecurrents outside a .control block\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.options temp=27 $savecurrents\n", vectors: { "v(n1)": 3 } },
  { code: 'A2e', id: 'an-savecurrents-unclosed-control', netlist: "* .control with no .endc\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.options temp=27 $savecurrents\n.control\necho hi\n", vectors: { "v(n1)": 3, "i(@i1[current])": 1, "i(@r1[i])": 1 }, prints: ["Warning: Missing .endc statement!"], codes: ["warning"] },
  { code: 'A2e', id: 'an-savecurrents-stray-endc', netlist: "* an .endc with no .control\nI1 0 n1 1\n.op\nR1 n1 0 2\n.endc\n.end\n+ 3\n.options temp=27 $savecurrents\n", vectors: { "v(n1)": 2, "i(@i1[current])": 1, "i(@r1[i])": 1 }, prints: ["Warning: Missing .control statement!","Warning: misplaced .endc card"], codes: ["warning","warning"] },
  { code: 'A2e', id: 'an-savecurrents-title-endc', netlist: ".endc as the title\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.options temp=27 $savecurrents\n", vectors: { "v(n1)": 3, "i(@i1[current])": 1, "i(@r1[i])": 1 } },
  { code: 'A2e', id: 'an-savecurrents-backslash-control', netlist: "* two backslashes before .control\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n.options \\\\\n.control\n.options temp=27 $savecurrents\n.endc\n", vectors: { "v(n1)": 3 }, prints: ["Warning: Missing .control statement!","Warning: misplaced .endc card"], codes: ["warning","warning"] },
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
  { code: 'A3f', id: 'an-skip-unused', netlist: "* lines ngspice would stop at, in a subcircuit no X line uses\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.tran 0 -1\n.foo bar\n.ends\n.op\n.end\n", vectors: { "v(in)": 5, "v(out)": 2.5, "i(v1)": -0.0025 } },
  { code: 'A3f', id: 'an-skip-used-tran', netlist: "* the same .tran, in a subcircuit an X line uses\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.tran 0 -1\n.ends\nX1 out 0 s\n.op\n.end\n", prints: ["TSTEP is invalid, must be greater than zero."], fails: true },
  { code: 'A3f', id: 'an-skip-used-dot', netlist: "* the same dot command, in a subcircuit an X line uses\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.foo bar\n.ends\nX1 out 0 s\n.op\n.end\n", prints: ["unimplemented dot command '.foo'"], fails: true },
  { code: 'A3f', id: 'an-skip-no-ends', netlist: "* a .subckt with no .ends, and the .op after it\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.op\n.end\n", prints: ["Mismatch of .subckt ... .ends statements!"], fails: true },
  { code: 'A3f', id: 'an-skip-open-other', netlist: "* the .op in a subcircuit no X line uses, and a .subckt with no .ends\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.op\n.ends\n.subckt t c d\nR8 c d 1k\n.end\n", prints: ["Mismatch of .subckt ... .ends statements!"], fails: true },
  { code: 'A3f', id: 'an-skip-extra-ends', netlist: "* the .op in a subcircuit no X line uses, and one .ends too many\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.op\n.ends\n.ends\n.end\n", prints: ["Mismatch of .subckt ... .ends statements!"], fails: true },
  { code: 'A3f', id: 'an-skip-ends-after-end', netlist: "* the .ends after .end, which ngspice reads\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.op\n.end\n.ends\n", fails: true },
  { code: 'A3f', id: 'an-skip-macro-open', netlist: "* a .macro with no .eom, and the .op after it\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.macro s a b\nR9 a b 1k\n.op\n.end\n", fails: true },
  { code: 'A3f', id: 'an-skip-through', netlist: "* .op in inner, which only X2 uses, inside outer, which no X line uses\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt outer p q\nX2 p q inner\n.ends\n.subckt inner a b\nR9 a b 1k\n.op\n.ends\n.end\n", fails: true },
  { code: 'A3f', id: 'an-skip-through-ac', netlist: "* the same with .ac\nV1 in 0 AC 1\nR1 in out 1k\nR2 out 0 1k\n.subckt outer p q\nX2 p q inner\n.ends\n.subckt inner a b\nR9 a b 1k\n.ac dec 1 1k 10k\n.ends\n.end\n", prints: ["v1: has no value, DC 0 assumed"], fails: true },
  { code: 'A3f', id: 'an-skip-through-two', netlist: "* two steps out: inner only in mid, mid only in top, top in no X line\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt top p q\nX3 p q mid\n.ends\n.subckt mid p q\nX2 p q inner\n.ends\n.subckt inner a b\nR9 a b 1k\n.op\n.ends\n.end\n", fails: true },
  { code: 'A3f', id: 'an-skip-through-several', netlist: "* inner used by X2 in outer and X3 in other, which no X line uses\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt outer p q\nX2 p q inner\n.ends\n.subckt other p q\nX3 p q inner\n.ends\n.subckt inner a b\nR9 a b 1k\n.op\n.ends\n.end\n", fails: true },
  { code: 'A3f', id: 'an-skip-through-loop', netlist: "* a loop: outer uses inner, inner uses outer, the main circuit neither\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt outer p q\nX2 p q inner\n.ends\n.subckt inner a b\nR9 a b 1k\nX1 a b outer\n.op\n.ends\n.end\n", fails: true },
  { code: 'A3f', id: 'an-skip-through-nested', netlist: "* inner defined inside outer, which no X line uses\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt outer p q\nX2 p q inner\n.subckt inner a b\nR9 a b 1k\n.op\n.ends\n.ends\n.end\n", fails: true },
  { code: 'A3f', id: 'an-skip-through-mixed', netlist: "* an .op in s, which no X line uses, and a .tf in inner, which only X2 in outer uses\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.op\n.ends\n.subckt outer p q\nX2 p q inner\n.ends\n.subckt inner c d\nR8 c d 1k\n.tf v(out) V1\n.ends\n.end\n", fails: true },
  { code: 'A3f', id: 'an-skip-through-three', netlist: "* three steps out: inner only in s3, s3 only in s2, s2 only in s1, s1 in no X line\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s1 p q\nX1 p q s2\n.ends\n.subckt s2 p q\nX1 p q s3\n.ends\n.subckt s3 p q\nX1 p q inner\n.ends\n.subckt inner a b\nR9 a b 1k\n.op\n.ends\n.end\n", fails: true },
  { code: 'A3f', id: 'an-skip-through-four', netlist: "* four steps out: inner only in s4, s4 only in s3, s3 only in s2, s2 only in s1, s1 in no X line\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s1 p q\nX1 p q s2\n.ends\n.subckt s2 p q\nX1 p q s3\n.ends\n.subckt s3 p q\nX1 p q s4\n.ends\n.subckt s4 p q\nX1 p q inner\n.ends\n.subckt inner a b\nR9 a b 1k\n.op\n.ends\n.end\n", fails: true },
  { code: 'A3f', id: 'an-skip-through-three-x', netlist: "* inner used by three X lines, all in outer, which no X line uses\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt outer p q\nX1 p q inner\nX2 p q inner\nX3 p q inner\n.ends\n.subckt inner a b\nR9 a b 1k\n.op\n.ends\n.end\n", fails: true },
  { code: 'A3f', id: 'an-skip-through-four-x', netlist: "* inner used by four X lines, all in outer, which no X line uses\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt outer p q\nX1 p q inner\nX2 p q inner\nX3 p q inner\nX4 p q inner\n.ends\n.subckt inner a b\nR9 a b 1k\n.op\n.ends\n.end\n", fails: true },
  { code: 'A3f', id: 'an-skip-through-four-used', netlist: "* the same four steps, with X0 using s1 in the main circuit and .tf v(out) V1 in place of the .op\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nX0 out 0 s1\n.subckt s1 p q\nX1 p q s2\n.ends\n.subckt s2 p q\nX1 p q s3\n.ends\n.subckt s3 p q\nX1 p q s4\n.ends\n.subckt s4 p q\nX1 p q inner\n.ends\n.subckt inner a b\nR9 a b 1k\n.tf v(out) V1\n.ends\n.end\n", vectors: { "v(Transfer_function)": 0.3333333333333333, "v(v1#Input_impedance)": 1499.9999999999998, "v(output_impedance_at_V(out))": 333.3333333333333 } },
  { code: 'A3f', id: 'an-tf-subckt-through-used', netlist: "* the same chain, used: X1 uses outer, whose X2 uses inner\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nX1 out 0 outer\n.subckt outer p q\nX2 p q inner\n.ends\n.subckt inner a b\nR9 a b 1k\n.tf v(out) V1\n.ends\n.end\n", vectors: { "v(Transfer_function)": 0.3333333333333333, "v(v1#Input_impedance)": 1499.9999999999998, "v(output_impedance_at_V(out))": 333.3333333333333 } },
  { code: 'A3f', id: 'an-skip-stopped', netlist: "* ngspice stops at .foo before it would skip the .op\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.foo bar\n.subckt s a b\nR9 a b 1k\n.op\n.ends\n.end\n", prints: ["unimplemented dot command '.foo'"], fails: true },
  { code: 'A3f', id: 'an-skip-include', netlist: "* an .include inside a subcircuit no X line uses\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.include nosuchfile.cir\n.ends\n.op\n.end\n", prints: ["Could not find include file nosuchfile.cir"], fails: true },
  { code: 'A3g', id: 'an-tf-subckt-gnd', netlist: "* a .tf inside a subcircuit an X line uses, measured from gnd\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.tf v(out,gnd) V1\n.ends\nX1 out 0 s\n.end\n", vectors: { "v(Transfer_function)": 0.3333333333333333, "v(v1#Input_impedance)": 1499.9999999999998, "v(output_impedance_at_V(out,0))": 333.3333333333333 } },
  { code: 'A3g', id: 'an-tf-subckt-gnd-a', netlist: "* the same .tf from the subcircuit's own node a\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.tf v(a,gnd) V1\n.ends\nX1 out 0 s\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 1499.9999999999998, "v(output_impedance_at_V(a,0))": 1 } },
  { code: 'A3g', id: 'an-tf-subckt-gnd-zz', netlist: "* the same .tf with a node no part connects to in place of gnd\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.tf v(a,zz) V1\n.ends\nX1 out 0 s\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 1499.9999999999998, "v(output_impedance_at_V(a,zz))": 2 } },
  { code: 'A3g', id: 'an-tf-subckt-gnd-alone', netlist: "* the same .tf of gnd alone\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.subckt s a b\nR9 a b 1k\n.tf v(gnd) V1\n.ends\nX1 out 0 s\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 1499.9999999999998, "v(output_impedance_at_V(0))": 0 } },
  { code: 'A3g', id: 'an-tf-subckt-gnd-beside', netlist: "* the same .tf beside an ordinary node called gnd\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nR3 in x 1k\nVx x gnd\nR4 x 0 1k\n.subckt s a b\nR9 a b 1k\n.tf v(out,gnd) V1\n.ends\nX1 out 0 s\n.end\n", vectors: { "v(Transfer_function)": 0.3333333333333333, "v(v1#Input_impedance)": 857.1428571428571, "v(output_impedance_at_V(out,0))": 333.3333333333333 }, prints: ["vx: has no value, DC 0 assumed"] },
  { code: 'A3h', id: 'an-tf-inner', netlist: "* a .tf of the node m inside the subcircuit X1 uses\nV1 in 0 10\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\n.ends\n.tf v(x1.m) V1\n.end\n", vectors: { "v(Transfer_function)": 0.5000000000000551, "v(v1#Input_impedance)": 2000.0000000002203, "v(output_impedance_at_V(x1.m))": 500.0000000000551 } },
  { code: 'A3h', id: 'an-tf-inner-caps', netlist: "* the same .tf in capitals\nV1 in 0 10\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\n.ends\n.tf v(X1.M) V1\n.end\n", vectors: { "v(Transfer_function)": 0.5000000000000551, "v(v1#Input_impedance)": 2000.0000000002203, "v(output_impedance_at_V(x1.m))": 500.0000000000551 } },
  { code: 'A3h', id: 'an-tf-inner-after-end', netlist: "* the same .tf, with the X line after .end\nV1 in 0 10\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\n.ends\n.tf v(x1.m) V1\n.end\nX1 in out div\n", vectors: { "v(Transfer_function)": 0.5000000000000551, "v(v1#Input_impedance)": 2000.0000000002203, "v(output_impedance_at_V(x1.m))": 500.0000000000551 } },
  { code: 'A3h', id: 'an-op-inner-nested', netlist: "* nested subcircuits: the node names ngspice makes\nV1 in 0 10\nX1 in out outer\nR9 out 0 1k\n.subckt outer p q\nR1 p n 1k\nX2 n q inner\n.ends\n.subckt inner a b\nR2 a m 1k\nR3 m 0 1k\nR4 m b 1k\n.ends\n.op\n.end\n", vectors: { "v(in)": 10, "v(x1.n)": 6.25, "v(x1.x2.m)": 2.5, "v(out)": 1.25, "i(v1)": -0.00375 } },
  { code: 'A3h', id: 'an-tf-inner-nested', netlist: "* a .tf of the node m inside X2, inside X1\nV1 in 0 10\nX1 in out outer\nR9 out 0 1k\n.subckt outer p q\nR1 p n 1k\nX2 n q inner\n.ends\n.subckt inner a b\nR2 a m 1k\nR3 m 0 1k\nR4 m b 1k\n.ends\n.tf v(x1.x2.m) V1\n.end\n", vectors: { "v(Transfer_function)": 0.25, "v(v1#Input_impedance)": 2666.6666666666665, "v(output_impedance_at_V(x1.x2.m))": 500 } },
  { code: 'A3h', id: 'an-tf-inner-outer', netlist: "* a .tf of the node n inside X1, beside X2\nV1 in 0 10\nX1 in out outer\nR9 out 0 1k\n.subckt outer p q\nR1 p n 1k\nX2 n q inner\n.ends\n.subckt inner a b\nR2 a m 1k\nR3 m 0 1k\nR4 m b 1k\n.ends\n.tf v(x1.n) V1\n.end\n", vectors: { "v(Transfer_function)": 0.625, "v(v1#Input_impedance)": 2666.6666666666665, "v(output_impedance_at_V(x1.n))": 625 } },
  { code: 'A3h', id: 'an-tf-inner-port', netlist: "* a .tf of x1.a, where a is a node of the .subckt line\nV1 in 0 10\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\n.ends\n.tf v(x1.a) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 2000.0000000002203, "v(output_impedance_at_V(x1.a))": 1 } },
  { code: 'A3h', id: 'an-tf-inner-unused', netlist: "* a .tf of x2.m, where X2 is only inside a subcircuit no X line uses\nV1 in 0 10\nR9 in 0 1k\n.subckt outer p q\nX2 p q div\n.ends\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\n.ends\n.tf v(x2.m) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 1000, "v(output_impedance_at_V(x2.m))": 1 } },
  { code: 'A3h', id: 'an-tf-inner-input', netlist: "* a .tf whose input is the source Vs inside X1\nV1 in 0 10\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\nVs m q 0\nR4 q 0 1k\n.ends\n.tf v(out) v.x1.vs\n.end\n", vectors: { "v(Transfer_function)": 0.33333333333335785, "v(v.x1.vs#Input_impedance)": 1500.000000000055, "v(output_impedance_at_V(out))": 334.3333333333578 } },
  { code: 'A3h', id: 'an-tf-inner-current', netlist: "* a .tf of the current in the source Vs inside X1\nV1 in 0 10\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\nVs m q 0\nR4 q 0 1k\n.ends\n.tf i(v.x1.vs) V1\n.end\n", vectors: { "v(Transfer_function)": 0.0003333333333333578, "v(v1#Input_impedance)": 1500.000000000055, "v(v.x1.vs#Output_impedance)": 100000000000000000000 } },
  { code: 'A3h', id: 'an-tf-inner-current-plain', netlist: "* a .tf of x1.vs, which is no name of a part\nV1 in 0 10\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\nVs m q 0\nR4 q 0 1k\n.ends\n.tf i(x1.vs) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 1500.000000000055, "v(x1.vs#Output_impedance)": 100000000000000000000 } },
  { code: 'A3h', id: 'an-tf-inner-isource', netlist: "* a .tf whose input is the current source Is inside X1\nV1 in 0 10\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\nIs 0 m 1m\n.ends\n.tf v(out) i.x1.is\n.end\n", vectors: { "v(Transfer_function)": 500.0000000000551, "v(i.x1.is#Input_impedance)": 500.0000000000551, "v(output_impedance_at_V(out))": 501.0000000000551 } },
  { code: 'A3h', id: 'an-tf-inner-global', netlist: "* a .tf of x1.vdd, where vdd is a .global node\n.global vdd\nV1 in 0 10\nVd vdd 0 2\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m vdd 1k\nR3 m b 1\n.ends\n.tf v(x1.vdd) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 2000.0000000002203, "v(output_impedance_at_V(x1.vdd))": 1 } },
  { code: 'A3h', id: 'an-tf-inner-global-m', netlist: "* the same, with .tf v(x1.m) V1\n.global vdd\nV1 in 0 10\nVd vdd 0 2\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m vdd 1k\nR3 m b 1\n.ends\n.tf v(x1.m) V1\n.end\n", vectors: { "v(Transfer_function)": 0.5000000000000551, "v(v1#Input_impedance)": 2000.0000000002203, "v(output_impedance_at_V(x1.m))": 500.0000000000551 } },
  { code: 'A3h', id: 'an-tf-inner-dotted', netlist: "* a .tf of the node m.1 inside X1\nV1 in 0 10\nX1 in out div\n.subckt div a b\nR1 a m.1 1k\nR2 m.1 0 1k\nR3 m.1 b 1\n.ends\n.tf v(x1.m.1) V1\n.end\n", vectors: { "v(Transfer_function)": 0.5000000000000551, "v(v1#Input_impedance)": 2000.0000000002203, "v(output_impedance_at_V(x1.m.1))": 500.0000000000551 } },
  { code: 'A3h', id: 'an-op-inner-dotted', netlist: "* the nodes the .op names, m.1 inside X1 among them\nV1 in 0 10\nX1 in out div\n.subckt div a b\nR1 a m.1 1k\nR2 m.1 0 1k\nR3 m.1 b 1\n.ends\n.op\n.end\n", vectors: { "v(in)": 10, "v(x1.m.1)": 5.000000000000551, "v(out)": 5.000000000000551, "i(v1)": -0.004999999999999449 } },
  { code: 'A3h', id: 'an-tf-inner-xdot', netlist: "* a .tf of the node m inside X1.a, an X line whose name has a dot\nV1 in 0 10\nX1.a in out div\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\n.ends\n.tf v(x1.a.m) V1\n.end\n", vectors: { "v(Transfer_function)": 0.5000000000000551, "v(v1#Input_impedance)": 2000.0000000002203, "v(output_impedance_at_V(x1.a.m))": 500.0000000000551 } },
  { code: 'A3h', id: 'an-tf-inner-partdot', netlist: "* a .tf whose input is Vs.1 inside X1\nV1 in 0 10\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\nVs.1 m q 0\nR4 q 0 1k\n.ends\n.tf v(out) v.x1.vs.1\n.end\n", vectors: { "v(Transfer_function)": 0.33333333333335785, "v(v.x1.vs.1#Input_impedance)": 1500.000000000055, "v(output_impedance_at_V(out))": 334.3333333333578 } },
  { code: 'A3h', id: 'an-tf-inner-nested-dot', netlist: "* a .tf of the node m.1 inside X2, inside X1\nV1 in 0 10\nX1 in out outer\nR9 out 0 1k\n.subckt outer p q\nR1 p n 1k\nX2 n q inner\n.ends\n.subckt inner a b\nR2 a m.1 1k\nR3 m.1 0 1k\nR4 m.1 b 1k\n.ends\n.tf v(x1.x2.m.1) V1\n.end\n", vectors: { "v(Transfer_function)": 0.25, "v(v1#Input_impedance)": 2666.6666666666665, "v(output_impedance_at_V(x1.x2.m.1))": 500 } },
  { code: 'A3h', id: 'an-tf-inner-dot-none', netlist: "* a .tf of x1.m.1, where the subcircuit has m and no m.1\nV1 in 0 10\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\n.ends\n.tf v(x1.m.1) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 2000.0000000002203, "v(output_impedance_at_V(x1.m.1))": 1 } },
  { code: 'A3h', id: 'an-tf-inner-zero', netlist: "* a .tf of x1.0, ground's name after X1\nV1 in 0 10\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\n.ends\n.tf v(x1.0) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 2000.0000000002203, "v(output_impedance_at_V(x1.0))": 1 } },
  { code: 'A3h', id: 'an-tf-inner-gnd', netlist: "* a .tf of x1.gnd, where gnd inside the subcircuit is ground\nV1 in 0 10\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m gnd 1k\nR3 m b 1\n.ends\n.tf v(x1.gnd) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 2000.0000000002203, "v(output_impedance_at_V(x1.gnd))": 1 } },
  { code: 'A3h', id: 'an-tf-inner-letter', netlist: "* a .tf whose input is i.x1.vs, where Vs is a voltage source\nV1 in 0 10\nX1 in out div\n.subckt div a b\nR1 a m 1k\nR2 m 0 1k\nR3 m b 1\nVs m q 0\nR4 q 0 1k\n.ends\n.tf v(out) i.x1.vs\n.end\n", prints: ["Transfer function source i.x1.vs not in circuit"], fails: true },
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
  { code: 'C8b', id: 'cur-transistor-terminals', netlist: "* the currents savecurrents gives a transistor, a MOSFET and a JFET\nV1 vcc 0 9\nRc vcc c 1k\nRb vcc b 100k\nQ1 c b 0 qmod\nRd vcc d 1k\nM1 d g 0 0 mmod\nVg g 0 2\nRj vcc dj 1k\nJ1 dj gj 0 jmod\nVgj gj 0 -0.5\n.model qmod npn bf=100\n.model mmod nmos level=1 vto=1 kp=1m\n.model jmod njf vto=-2 beta=1m\n.options savecurrents\n.op\n.end\n", vectors: {"i(@rc[i])": 0.008171436673483043, "i(@rb[i])": 8.171436755511125e-05, "i(@q1[ic])": 0.008171437395948791, "i(@q1[ie])": -0.008253151771565406, "i(@q1[ib])": 8.171437478805107e-05, "i(@q1[is])": 8.285633265169585e-13, "i(@rd[i])": 0.0005000000085099981, "i(@m1[id])": 0.00050000000851, "i(@m1[is])": -0.0005, "i(@m1[ig])": 0, "i(@m1[ib])": -8.509999991490001e-12, "i(@j1[id])": 0.00225000000726, "i(@j1[is])": -0.002249999999490002, "i(@j1[ig])": -7.769998131313016e-12, "i(@j1[igd])": -7.259999992129622e-12} },
  { code: 'C8b', id: 'cur-transistor-terminals-dc', netlist: "* the same, in a .dc sweep of one point\nV1 vcc 0 9\nRc vcc c 1k\nRb vcc b 100k\nQ1 c b 0 qmod\nRd vcc d 1k\nM1 d g 0 0 mmod\nVg g 0 2\nRj vcc dj 1k\nJ1 dj gj 0 jmod\nVgj gj 0 -0.5\n.model qmod npn bf=100\n.model mmod nmos level=1 vto=1 kp=1m\n.model jmod njf vto=-2 beta=1m\n.options savecurrents\n.dc V1 9 9 1\n.end\n", vectors: {"i(@q1[ic])": [0.008171437395948791], "i(@q1[ie])": [-0.008253151771565406], "i(@q1[ib])": [8.171437478805107e-05], "i(@q1[is])": [8.285633265169585e-13], "i(@m1[id])": [0.00050000000851], "i(@j1[igd])": [-7.259999992129622e-12]} },
  { code: 'C8b', id: 'cur-transistor-pin-ammeters', netlist: "* C8b's transistor with 0 V ammeters on its four terminals\nV1 vcc 0 9\nRc vcc c 1k\nVc c ci 0\nRb vcc b 100k\nVb b bi 0\nQ1 ci bi ei si qmod\nVe ei 0 0\nVs si 0 0\n.model qmod npn bf=100\n.options savecurrents\n.op\n.end\n", vectors: {"v(c)": 0.8285742076290443, "v(b)": 0.8285741256053445, "i(vs)": 8.285742076290444e-13, "i(ve)": 0.008253140050286323, "i(vb)": 8.171425874394657e-05, "i(vc)": 0.008171425792370957, "i(@q1[ic])": 0.008174875762571438, "i(@q1[ie])": -0.008256624521854302, "i(@q1[ib])": 8.174875845428842e-05, "i(@q1[is])": 8.285742076290444e-13} },
  { code: 'C8b', id: 'cur-transistor-pin-ammeters-off', netlist: "* the C9 transistor with ammeters on each of its four terminals\nV1 top 0 9\nVc top c 0\nQ1 c xb e s qmod\nVb x xb 0\nVe e 0 0\nVs s 0 0\nRx x 0 1meg\n.model qmod npn\n.options savecurrents\n.op\n.end\n", vectors: {"v(xb)": 9.000081999484785e-06, "i(vs)": 9e-12, "i(ve)": 1.0903522937356526e-16, "i(vb)": -9.000081999484783e-12, "i(vc)": 1.8000191034714156e-11, "i(@q1[ic])": 9.00019103471416e-12, "i(@q1[ie])": -9.000109035229373e-12, "i(@q1[ib])": -9.000081999484786e-12, "i(@q1[is])": 9e-12} },
  { code: 'C8b', id: 'cur-transistor-subckt-dc', netlist: "* a BJT and a MOSFET inside nested subcircuits, swept\nVcc c 0 5\nIb 0 b 10u\nX1 c b 0 amp\nX2 c 0 mstage\n.subckt amp c b e\nQ1 c b e qn\n.ends\n.subckt mstage d s\nX3 d s inner\n.ends\n.subckt inner d s\nM1 d g s s mn\nVg g s 2\n.ends\n.model qn npn(bf=100)\n.model mn nmos level=1 vto=1 kp=1m\n.options savecurrents\n.op\n.dc Vcc 0 5 1\n.end\n", vectors: {"i(@q.x1.q1[ic])": [-9.90099221751518e-06, 0.0010192711265172513, 0.0010047059306697115, 0.0010000473279857189, 0.0010000108469359402, 0.0010000003497277078], "i(@q.x1.q1[is])": [0, 1e-12, 2e-12, 3e-12, 4e-12, 5e-12], "i(@m.x2.x3.m1[id])": [0, 0.00050000000101, 0.00050000000201, 0.00050000000301, 0.00050000000401, 0.00050000000501]} },
  { code: 'C8b', id: 'cur-transistor-devhelp', netlist: "* device help\nV1 a 0 1\nR1 a 0 1\n.control\ndevhelp bjt\ndevhelp mos1\ndevhelp jfet\n.endc\n.end\n", prints: ["  222\t ic        \t out\t Current at collector node", "  223\t ib        \t out\t Current at base node", "  247\t ie        \t out\t Emitter current", "  248\t is        \t out\t Substrate current", "  215\t id        \t out\t Drain current", "   18\t is        \t out\t Source current", "   17\t ig        \t out\t Gate current ", "   16\t ib        \t out\t Bulk current ", "  308\t ig        \t out\t Current at gate node", "  309\t id        \t out\t Current at drain node", "  319\t is        \t out\t Source current", "  310\t igd       \t out\t Current G-D"], fails: true },
  { code: 'C9w', id: 'cur-exact-temp-sin-m1', netlist: "* the bridge of C9 with an ammeter, a .temp line, a SIN beside V1's DC value and m=1 on R5\nV1 top 0 DC 9 SIN(9 1 1k)\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a m 1k m=1\nVm m b 0\n.temp 100\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 9.0, "v(a)": 4.499999999999999, "v(b)": 4.499999999999999, "v(m)": 4.499999999999999, "i(vm)": -2.168404344971009e-19, "i(v1)": -0.0014074468085106388, "i(@r1[i])": 0.0004500000000000001, "i(@r2[i])": 0.00044999999999999993, "i(@r3[i])": 0.0009574468085106385, "i(@r4[i])": 0.0009574468085106381, "i(@r5[i])": 0.0} },
  { code: 'C9w.2', id: 'cur-rule-ammeter-in-series', netlist: "* the bridge of C9 with an ammeter, with ngspice's own gmin written out\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a m 1k\nVm m b 0\n.options gmin=1e-12\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 9.0, "v(a)": 4.499999999999999, "v(b)": 4.499999999999999, "v(m)": 4.499999999999999, "i(vm)": -2.168404344971009e-19, "i(v1)": -0.0014074468085106388, "i(@r1[i])": 0.0004500000000000001, "i(@r2[i])": 0.00044999999999999993, "i(@r3[i])": 0.0009574468085106385, "i(@r4[i])": 0.0009574468085106381, "i(@r5[i])": 0.0} },
  { code: 'C9w.3', id: 'cur-rule-maybe-noise', netlist: "* the C9n ladder read through a 1 uohm wire, a 0 V ammeter and a 1 Tohm meter, with ngspice's own gmin written out\nV1 n0 0 1.5\nR1 n0 n1 1.5k\nR2 n1 0 12\nR3 n1 n2 1.5k\nR4 n2 0 12\nR5 n2 n3 1.5k\nR6 n3 0 12\nR7 n3 n4 1.5k\nR8 n4 0 12\nRw n3 p 1u\nVm p q 0\nRvm q 0 1t\n.options gmin=1e-12\n.options savecurrents\n.op\n.end\n", vectors: {"v(n0)": 1.5, "v(n1)": 0.011811755997793995, "v(n2)": 9.301171983709262e-05, "v(n3)": 7.324215167679475e-07, "v(n4)": 5.812869180697997e-09, "v(p)": 7.324215167679475e-07, "v(q)": 7.324215167679475e-07, "i(vm)": 7.324215167679474e-19, "i(v1)": -0.0009921254960014707, "i(@r1[i])": 0.0009921254960014707, "i(@r2[i])": 0.0009843129998161663, "i(@r3[i])": 7.812496185304601e-06, "i(@r4[i])": 7.750976653091051e-06, "i(@r5[i])": 6.151953221354978e-08, "i(@r6[i])": 6.103512639732895e-08, "i(@r7[i])": 4.844057650581663e-10, "i(@r8[i])": 4.844057650581663e-10, "i(@rw[i])": 0.0, "i(@rvm[i])": 7.324215167679474e-19} },
  { code: 'C9w.4', id: 'cur-page-digits-carrier', netlist: "* a G of 1e6 S reads a 1e15 ohm resistor that carries no current; its load holds a 1 aA source\nV1 top 0 3.3\nRw top f1 100u\nVa f1 n 0\nR2 n 0 150\nR1 n f2 1e15\nC1 f2 0 1p\nG1 0 g n f2 1e6\nR3 g 0 820k\nI1 0 g 1n\n.options savecurrents\n.op\n.end\n", vectors: {"v(n)": 3.2999978000014667, "v(f2)": 3.2999978000014663, "v(g)": 0.00146484375, "i(@r1[i])": 4.4408920985006265e-31, "i(@g1[i])": 4.440892098500626e-10, "i(@r3[i])": 1.7863948170731707e-09} },
  { code: 'C9w.5', id: 'cur-spread-ammeters', netlist: "* C9m's two equal arms fed through a 1 uOhm wire, a 1 GOhm resistor and two 0 V ammeters\nV1 top 0 9\nRw top s 1u\nRg s 0 1g\nVa s v3 0\nVb v3 n1 0\nRl n1 0 820\nR1 n1 n2 15k\nR2 n2 n3 330\nR3 n3 0 33k\nR4 n1 n4 15k\nR5 n4 n5 330\nR6 n5 0 33k\nR7 n3 n5 100k\n.options savecurrents\n.op\n.end\n", vectors: {"v(s)": 8.99999998865194, "v(v3)": 9.000001907348633, "v(n1)": 9.000001907348633, "v(n3)": 6.145252698996582, "v(n5)": 6.145252698996587, "i(va)": 0.011348050087690353, "i(@r7[i])": -5.329070518200752e-20} },
  { code: 'C9w.6', id: 'cur-save-judged', netlist: "* C9m with a .save line naming the link and its ends\nV1 n1 0 9\nR1 n1 n2 15k\nR2 n2 n3 330\nR3 n3 0 33k\nR4 n1 n4 15k\nR5 n4 n5 330\nR6 n5 0 33k\nR7 n3 n5 100k\n.save v(n3) v(n5) @r7[i]\n.op\n.end\n", vectors: {"v(n3)": 6.145251396648049, "v(n5)": 6.145251396648042, "i(@r7[i])": 6.217248937900877e-20} },
  { code: 'C9w.7', id: 'cur-sweep-off-wire', netlist: "* the 1 nohm wire of C9n.4, its .op and a long sweep\nV1 top1 0 1.5\nR1 top1 d2 270k\nR2 d2 0 820\nR3 d2 p3 1n\nR4 p3 0 10meg\n.options savecurrents\n.op\n.dc V1 0 1.5 0.00025\n.end\n", summaries: { "i(@r3[i])": { points: 6001, first: 0, last: 0 } } },
  { code: 'C9w.8', id: 'cur-guarded-maybe-noise', netlist: "* a reverse diode's leak beside a 1 nV divider: the exact solution keeps the run's tiny values as ngspice gives them\nV1 top1 0 0.5\nR1 top1 s2 1m\nR2 s2 0 1e12\nD1 d3 s2 dmod\nR3 d3 0 120k\nR4 d3 x4 1.2\nC1 x4 0 1n\nV2 d3 v5 0\nR5 v5 0 1\nF1 0 f6 V1 1m\nR6 f6 0 10\nV3 n1 0 1n\nR7 n1 n2 1k\nR8 n2 0 1k\n.model dmod D(is=1e-14)\n.options savecurrents\n.op\n.end\n", vectors: {"v(d3)": 5.099938892338058e-13, "v(n2)": 5.000000000000001e-10, "i(v2)": 5.099938892338058e-13, "i(v3)": -5e-13, "i(@r3[i])": 4.2499490769483816e-18, "i(@r5[i])": 5.099938892338058e-13, "i(@r7[i])": 4.999999999999999e-13, "i(@r8[i])": 5.000000000000002e-13} },
  { code: 'C9w.9', id: 'cur-wire-two-ammeters', netlist: "* a 1 nohm wire into two 0 V ammeters in series (the skeptic of the last pass, P1-1n)\nV1 a 0 9\nRw a b 1n\nVm1 b c 0\nVm2 c d 0\nRl d 0 820\n.options savecurrents\n.op\n.end\n", vectors: {"v(b)": 8.999999999989024, "v(c)": 8.9994049072265625, "v(d)": 8.9994049072265625, "i(vm1)": 0.010974884033203125, "i(vm2)": 0.010974884033203125, "i(@rw[i])": 0.010976108910654146, "i(@rl[i])": 0.010974884033203125} },
  { code: 'C9w.10', id: 'cur-tf-lost-ratio', netlist: "* C9n.5's 1 n wire in series with 10 meg, with .op, .dc and .tf of the wire's voltage\nV1 top1 0 1.5\nR1 top1 d2 270k\nR2 d2 0 820\nR3 d2 p3 1n\nR4 p3 0 10meg\n.options savecurrents\n.op\n.dc V1 0 1.5 0.5\n.tf v(d2,p3) V1\n.end\n", vectors: {"v(d2)": [0.0, 0.001513784765078957, 0.003027569530157914, 0.0045413542952368715], "i(@r3[i])": [0.0, 0.0, 0.0, 0.0], "v(Transfer_function)": 0.0, "v(v1#Input_impedance)": 270819.92615659133, "v(output_impedance_at_V(d2,p3))": 1e-09} },
  { code: 'C9w.11', id: 'cur-tf-lost-alone', netlist: "* a 100 ohm resistor feeding a 1e20 ohm load: only the .tf of the voltage across it\nV1 top 0 10\nR1 top s 100\nR2 s 0 1e20\n.tf v(top,s) V1\n.end\n", vectors: {"v(Transfer_function)": 0.0, "v(v1#Input_impedance)": 1e+20, "v(output_impedance_at_V(top,s))": 100.0} },
  { code: 'C9w.12', id: 'cur-tf-off-ratio', netlist: "* a bridge 1e-14 off balance read through a chain of resistors, with .tf of one link's voltage\nV1 top1 0 5\nR1 top1 a2 1.8\nR2 a2 0 680\nR3 top1 b3 0.18\nR4 b3 0 68.0000000000007\nR5 a2 m4 2.7k\nR6 m4 m5 120\nR7 m5 m6 3.3k\nR8 m6 m7 4.7meg\nR9 m7 m8 4.7k\nR10 m8 m9 5.6k\nR11 m9 m10 12k\nR12 m10 m11 56\nR13 m11 b3 68k\n.options savecurrents\n.op\n.tf v(m7,m8) V1\n.end\n", vectors: {"v(m7)": 4.986799647990032, "v(m8)": 4.986799647990031, "v(Transfer_function)": 1.1102230246251565e-16, "v(v1#Input_impedance)": 61.98181818182076, "v(output_impedance_at_V(m7,m8))": 4695.394537384268} },
  { code: 'C9w.13', id: 'cur-rule-sweep-op-state', netlist: "* the balanced bridge of C9 with a .param line, its .op and a sweep of V1 to its own 9 V\n.param rtop=10k rbot=10k\nV1 top 0 9\nR1 top a {rtop}\nR2 a 0 {rbot}\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\n.options savecurrents\n.op\n.dc V1 0 9 3\n.end\n", vectors: {"i(@r5[i])": [0.0, 0.0, 0.0, -8.881784197001253e-19]} },
  { code: 'C9w.14', id: 'cur-rule-sweep-op-state-q', netlist: "* the balanced bridge of C9 beside a transistor, with .op and .dc V1 0 9 3\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nQ1 top x 0 qmod\nRx x 0 1meg\n.model qmod npn\n.options savecurrents\n.op\n.dc V1 0 9 3\n.tf v(a,b) V1\n.end\n", vectors: {"i(@r5[i])": [0.0, 0.0, 0.0, -8.881784197001253e-19], "v(Transfer_function)": -5.551115123125783e-17} },
  { code: 'C9x', id: 'cur-opamp-e15', netlist: "* an op-amp as an E of 1e15: a non-inverting amplifier of gain 2.773\nV1 in 0 3.3\nE1 out 0 in inm 1e15\nR1 inm 0 220\nR2 out inm 390\nRl out 0 390\n.options savecurrents\n.op\n.end\n", vectors: {"v(in)": 3.3000000000000003, "v(out)": 9.5, "v(inm)": 3.299999999999991, "i(e1)": -0.04025641025641028, "i(v1)": 0, "i(@r1[i])": 0.014999999999999958, "i(@r2[i])": 0.015897435897435922, "i(@rl[i])": 0.02435897435897436} },
  { code: 'C9x', id: 'cur-opamp-diff-e12', netlist: "* a difference amplifier as an E of 1e12, 2 V and 1.5 V, gain 2\nV1 a 0 2\nV2 b 0 1.5\nR1 a inm 10k\nR2 inm out 20k\nR3 b inp 10k\nR4 inp 0 20k\nE1 out 0 inp inm 1e12\n.options savecurrents\n.op\n.end\n", vectors: {"v(inm)": 1.0000000000009999, "v(out)": -0.9998779296875, "v(inp)": 1, "i(e1)": 9.9993896484425e-05, "i(@r2[i])": 9.9993896484425e-05} },
  { code: 'C9x', id: 'cur-opamp-balanced-e9', netlist: "* a balanced difference amplifier as an E of 1e9, 5 V on both inputs\nV1 a 0 5\nR1 a inm 10k\nR2 inm out 10k\nR3 a inp 10k\nR4 inp 0 10k\nE1 out 0 inp inm 1e9\n.options savecurrents\n.op\n.end\n", vectors: {"v(inm)": 2.5000000000000004, "v(out)": -4.76837158203125e-07, "v(inp)": 2.5, "i(e1)": 0.00025000004768371587, "i(@r2[i])": 0.00025000004768371587} },
  { code: 'C9x.2', id: 'cur-spread-past-double', netlist: "* a 1e-12 ohm wire beside 1e300 ohm: conductances more than the largest double apart\nV1 a 0 1\nR1 a b 1e-12\nR2 b 0 1e300\nR3 b 0 1k\n.options savecurrents\n.op\n.end\n", vectors: {"v(b)": 0.999999999999999, "i(v1)": -0.0009765625, "i(@r1[i])": 0.0009992007221626409, "i(@r2[i])": 9.99999999999999e-301, "i(@r3[i])": 0.000999999999999999} },
  { code: 'C9x.3', id: 'cur-unchecked-plus-after-end', netlist: "* a + line after .end\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n", vectors: {"v(n1)": 3} },
  { code: 'C9x.4', id: 'cur-rule-sweep-step-rounding', netlist: "* the balanced bridge of C9 with a .param line, its .op and a sweep of V1 in 0.01 V steps\n.param rtop=10k\nV1 top 0 9\nR1 top a {rtop}\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\n.options savecurrents\n.op\n.dc V1 0 9 0.01\n.end\n", summaries: {"v(v-sweep)": { points: 901, first: 0, last: 8.999999999999853 }, "i(@r5[i])": { points: 901, first: 0, last: -8.881784197001253e-19 }} },
  { code: 'C9x.5', id: 'cur-rule-tf-maybe', netlist: "* the balanced bridge of C9 beside a transistor, with .op and .tf v(a,b) V1\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nQ1 top x 0 qmod\nRx x 0 1meg\n.model qmod npn\n.options savecurrents\n.op\n.tf v(a,b) V1\n.end\n", vectors: {"v(a)": 4.499999999999999, "v(b)": 4.5, "v(Transfer_function)": -5.551115123125783e-17, "v(v1#Input_impedance)": 6394.5577413485535} },
  { code: 'C9x.6', id: 'cur-control-run', netlist: "* bridge control\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a m 1k\nVm m b 0\n.options savecurrents\n.op\n.dc V1 0 9 3\n.tf v(a,b) V1\n.control\nrun\n.endc\n.end\n", vectors: {"v(a)": [0, 1.4999999999999996, 2.999999999999999, 4.499999999999999], "i(vm)": [0, -5.421010862427522e-20, -1.0842021724855044e-19, -2.168404344971009e-19], "i(@r5[i])": [0, 0, 0, 0]} },
  { code: 'C9x.6', id: 'cur-control-run-c9o', netlist: "* a balanced bridge whose ammeter an H of 1 G reads, run from a .control block\nV1 top 0 9\nR1 top a 180k\nR2 a 0 3.9meg\nR3 top b 18k\nR4 b 0 390k\nR5 a m 4.7\nVm m b 0\nH1 out 0 Vm 1g\nRl out 0 1k\n.options savecurrents\n.op\n.control\nrun\n.endc\n.end\n", vectors: {"v(out)": -1.9350975899792844e-07, "i(h1)": 1.9350975899792844e-10, "i(vm)": -1.9350975899792844e-16, "i(@rl[i])": -1.9350975899792844e-10} },
  { code: 'C9y', id: 'cur-sweep-idle-source', netlist: "* V2 holds node b's own 6 V, so R3 carries nothing when V1 is 9 V\nV1 a 0 9\nR1 a b 3k\nR2 b 0 6k\nV2 c 0 6\nR3 b c 1k\n.options savecurrents\n.op\n.dc V1 0 9 0.01\n.end\n", summaries: {"v(v-sweep)": { points: 901, first: 0, last: 8.999999999999853 }, "v(b)": { points: 901, first: 4.0, last: 5.999999999999967 }, "i(v2)": { points: 901, first: -0.002, last: -3.2959746043559335e-17 }} },
  { code: 'C9y.2', id: 'cur-sweep-idle-source-12', netlist: "* V2 delivers no power when V1 is 12 V\nV1 a 0 12\nV2 c 0 6\nR1 a b 1k\nR2 b c 1k\nR3 b 0 1k\n.op\n.dc V1 0 12 0.1\n.end\n", summaries: {"v(v-sweep)": { points: 121, first: 0, last: 11.999999999999973 }, "v(b)": { points: 121, first: 2.0, last: 5.999999999999991 }, "i(v2)": { points: 121, first: -0.004, last: -8.673617379884035e-18 }} },
  { code: 'C9y.2', id: 'cur-sweep-idle-source-12-half', netlist: "* V2 delivers no power when V1 is 12 V, swept in 0.5 V steps\nV1 a 0 12\nV2 c 0 6\nR1 a b 1k\nR2 b c 1k\nR3 b 0 1k\n.op\n.dc V1 0 12 0.5\n.end\n", summaries: {"v(v-sweep)": { points: 25, first: 0, last: 12 }, "i(v2)": { points: 25, first: -0.004, last: 0 }} },
  { code: 'C9y.3', id: 'cur-sweep-idle-source-rule', netlist: "* V2 holds node b's own 6 V, so R3 carries nothing when V1 is 9 V; a .param line\n.param rb=6k\nV1 a 0 9\nR1 a b 3k\nR2 b 0 {rb}\nV2 c 0 6\nR3 b c 1k\n.options savecurrents\n.op\n.dc V1 0 9 0.01\n.end\n", summaries: {"v(v-sweep)": { points: 901, first: 0, last: 8.999999999999853 }, "i(v2)": { points: 901, first: -0.002, last: -3.2959746043559335e-17 }} },
  { code: 'C9y.4', id: 'cur-sweep-idle-source-large', netlist: "* V2 holds node b's own 6 V, so R3 carries nothing when V1 is 9 V; a sweep too large to look through\nV1 a 0 9\nR1 a b 3k\nR2 b 0 6k\nV2 c 0 6\nR3 b c 1k\n.options savecurrents\n.op\n.dc V1 0 9 0.00001\n.end\n", summaries: {"v(v-sweep)": { points: 900001, first: 0, last: 8.999999999828448 }, "v(b)": { points: 900001, first: 4.0, last: 5.999999999961877 }} },
  { code: 'C9y.5', id: 'cur-unchecked-beside-opamp', netlist: "* a + line after .end, beside an op-amp buffer modelled as an E of 1e6\nV2 x 0 1\nE1 y 0 x y 1e6\nR2 y 0 1k\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n", vectors: {"v(x)": 1.0, "v(y)": 0.9999990000010001, "v(n1)": 3.0, "i(e1)": -0.0009999990000010002} },
  { code: 'C9y.5', id: 'cur-unchecked-beside-opamps', netlist: "* a + line after .end, beside three op-amp stages modelled as E of 1e5\nV2 x 0 1\nE1 y 0 x y 1e5\nE2 z 0 y z 1e5\nE3 w 0 z w 1e5\nR2 w 0 1k\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n", vectors: {"v(y)": 0.999990000099999, "v(z)": 0.9999800002999961, "v(w)": 0.9999700005999902, "v(n1)": 3.0, "i(e3)": -0.0009999700005999903} },
  { code: 'C9y.6', id: 'cur-sweep-meant-digits', netlist: "* V2 idle at 9.12345 V, swept up to it in 100 uV steps\nV1 a 0 9.12345\nR1 a b 3k\nR2 b 0 6k\nV2 c 0 6.0823\nR3 b c 1k\n.options savecurrents\n.op\n.dc V1 9.12245 9.12345 0.0001\n.end\n", summaries: {"v(v-sweep)": { points: 11, first: 9.12245, last: 9.123449999999998 }, "i(v1)": { points: 11, first: -0.0010134574074074079, last: -0.0010137166666666663 }} },
  { code: 'C9y.6', id: 'cur-sweep-rounding-boundary', netlist: "* a bridge with an ammeter and a CCCS, node a2 at 5.2875 V when V1 is 9 V\nV1 top1 0 9\nR1 top1 a2 330k\nR2 a2 0 470k\nR3 top1 b3 33meg\nR4 b3 0 47meg\nR5 a2 m4 68\nV2 m4 b3 0\nF1 0 o5 V2 2\nR6 o5 0 270\n.options savecurrents\n.op\n.dc V1 0 9 0.9\n.end\n", summaries: {"v(v-sweep)": { points: 11, first: 0, last: 9.000000000000002 }, "v(a2)": { points: 11, first: 0, last: 5.287500000000817 }} },
  { code: 'C9y.6', id: 'cur-sweep-off-op', netlist: "* 1e15 ohms in series with 10 ohms\nV1 top1 0 0.5\nR1 top1 s2 10\nR2 s2 0 1e15\n.options savecurrents\n.op\n.dc V1 0 0.5 0.08333333333333333\n.end\n", summaries: {"v(v-sweep)": { points: 7, first: 0, last: 0.5000000000000001 }, "i(v1)": { points: 7, first: 0, last: -4.996003610813204e-16 }} },
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
  { code: 'C9m', id: 'cur-noise-arms', netlist: "* two equal arms of three resistors and a link: no current through R7\nV1 n1 0 9\nR1 n1 n2 15k\nR2 n2 n3 330\nR3 n3 0 33k\nR4 n1 n4 15k\nR5 n4 n5 330\nR6 n5 0 33k\nR7 n3 n5 100k\n.options savecurrents\n.op\n.end\n", vectors: {"v(n1)": 9, "v(n2)": 6.206703910614529, "v(n3)": 6.145251396648049, "v(n4)": 6.2067039106145225, "v(n5)": 6.145251396648042, "i(v1)": -0.00037243947858473, "i(@r1[i])": 0.00018621973929236477, "i(@r2[i])": 0.00018621973929236395, "i(@r3[i])": 0.00018621973929236512, "i(@r4[i])": 0.00018621973929236517, "i(@r5[i])": 0.00018621973929236395, "i(@r6[i])": 0.00018621973929236493, "i(@r7[i])": 6.217248937900877e-20} },
  { code: 'C9m.2', id: 'cur-noise-arms-9-steps', netlist: "* two equal arms of three resistors and a 3.3 k link: no current through R7\nV1 n1 0 15\nR1 n1 n2 4.7k\nR2 n2 n3 100\nR3 n3 0 150k\nR4 n1 n4 4.7k\nR5 n4 n5 100\nR6 n5 0 150k\nR7 n3 n5 3.3k\n.options savecurrents\n.op\n.end\n", vectors: {"v(n1)": 15, "v(n2)": 14.54457364341081, "v(n3)": 14.534883720930189, "v(n4)": 14.544573643410827, "v(n5)": 14.534883720930205, "i(v1)": -0.0001937984496124174, "i(@r1[i])": 0.00009689922480621051, "i(@r2[i])": 0.00009689922480621505, "i(@r3[i])": 0.00009689922480620126, "i(@r4[i])": 0.0000968992248062071, "i(@r5[i])": 0.00009689922480621505, "i(@r6[i])": 0.00009689922480620137, "i(@r7[i])": -4.8446095620006835e-18} },
  { code: 'C9n', id: 'cur-real-ladder-meter', netlist: "* a ladder from 1.5 V, node n3 read by a 1 T voltmeter through a 1 u wire\nV1 n0 0 1.5\nR1 n0 n1 1.5k\nR2 n1 0 12\nR3 n1 n2 1.5k\nR4 n2 0 12\nR5 n2 n3 1.5k\nR6 n3 0 12\nR7 n3 n4 1.5k\nR8 n4 0 12\nRw n3 p 1u\nRvm p 0 1t\n.options savecurrents\n.op\n.end\n", vectors: {"v(n0)": 1.5, "v(n1)": 0.011811755997793995, "v(n2)": 0.00009301171983709262, "v(n3)": 7.324215167679476e-7, "v(n4)": 5.812869180697998e-9, "v(p)": 7.324215167679476e-7, "i(v1)": -0.0009921254960014707, "i(@r1[i])": 0.0009921254960014707, "i(@r2[i])": 0.0009843129998161663, "i(@r3[i])": 0.000007812496185304601, "i(@r4[i])": 0.000007750976653091051, "i(@r5[i])": 6.151953221354978e-8, "i(@r6[i])": 6.103512639732897e-8, "i(@r7[i])": 4.844057650581663e-10, "i(@r8[i])": 4.844057650581665e-10, "i(@rw[i])": 0, "i(@rvm[i])": 7.324215167679475e-19} },
  { code: 'C9n.2', id: 'cur-real-divider-meter', netlist: "* a 1 G over 10 ohm divider read by a 1e20 ohm voltmeter through a 100 ohm probe\nV1 in 0 24\nR1 in mid 1g\nR2 mid 0 10\nRp mid p 100\nRvm p 0 1e20\n.options savecurrents\n.op\n.end\n", vectors: {"v(in)": 24, "v(mid)": 2.3999999760000004e-7, "v(p)": 2.3999999760000004e-7, "i(v1)": -2.3999999760000007e-8, "i(@r1[i])": 2.3999999760000004e-8, "i(@r2[i])": 2.3999999760000007e-8, "i(@rp[i])": 0, "i(@rvm[i])": 2.3999999760000002e-27} },
  { code: 'C9n.3', id: 'cur-real-1n-source', netlist: "* a 1 nV source\nV1 top 0 1n\nR1 top s 1\nR2 s 0 1e20\nVm top v 0\nR3 v 0 27k\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 1e-9, "v(s)": 1e-9, "v(v)": 1e-9, "i(vm)": 3.703703703703704e-14, "i(v1)": -3.703703703703704e-14, "i(@r1[i])": 0, "i(@r2[i])": 1e-29, "i(@r3[i])": 3.703703703703704e-14} },
  { code: 'C9o', id: 'cur-noise-gain-h', netlist: "* a balanced bridge whose ammeter an H of 1 G reads\nV1 top 0 9\nR1 top a 180k\nR2 a 0 3.9meg\nR3 top b 18k\nR4 b 0 390k\nR5 a m 4.7\nVm m b 0\nH1 out 0 Vm 1g\nRl out 0 1k\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 9, "v(a)": 8.602941176467256, "v(b)": 8.602941176467258, "v(m)": 8.602941176467258, "v(out)": -1.9350975899792844e-7, "i(h1)": 1.9350975899792844e-10, "i(vm)": -1.9350975899792844e-16, "i(v1)": -0.000024264705882556586, "i(@r1[i])": 0.0000022058823529596873, "i(@r2[i])": 0.000002205882352940322, "i(@r3[i])": 0.000022058823529596775, "i(@r4[i])": 0.000022058823529403225, "i(@r5[i])": -3.7794826370218095e-16, "i(@rl[i])": -1.9350975899792844e-10} },
  { code: 'C9o.2', id: 'cur-noise-gain-e', netlist: "* the balanced bridge of C9 read by an E of 1e6 into 100 ohms\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nE1 out 0 a b 1e6\nRl out 0 100\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 9, "v(a)": 4.499999999999999, "v(b)": 4.5, "v(out)": -9.313225746154785e-10, "i(e1)": 9.313225746154785e-12, "i(v1)": -0.0014074468085106386, "i(@r1[i])": 0.0004500000000000001, "i(@r2[i])": 0.00044999999999999993, "i(@r3[i])": 0.0009574468085106382, "i(@r4[i])": 0.0009574468085106382, "i(@r5[i])": -8.881784197001253e-19, "i(@rl[i])": -9.313225746154785e-12} },
  { code: 'C9o.3', id: 'cur-real-e-fed', netlist: "* the same E, its output fed from 5 V through 1 k\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nE1 out 0 a b 1e6\nV2 x 0 5\nRx x out 1k\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 9, "v(a)": 4.499999999999999, "v(b)": 4.5, "v(out)": -9.313225746154785e-10, "v(x)": 5, "i(e1)": 0.005000000000931323, "i(v2)": -0.005000000000931323, "i(v1)": -0.0014074468085106386, "i(@r1[i])": 0.0004500000000000001, "i(@r2[i])": 0.00044999999999999993, "i(@r3[i])": 0.0009574468085106382, "i(@r4[i])": 0.0009574468085106382, "i(@r5[i])": -8.881784197001253e-19, "i(@rx[i])": 0.005000000000931323} },
  { code: 'C9p', id: 'cur-noise-tf', netlist: "* the balanced bridge of C9 with .tf v(a,b) V1\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\n.tf v(a,b) V1\n.end\n", vectors: {"v(Transfer_function)": -5.551115123125783e-17, "v(v1#Input_impedance)": 6394.557823129251, "v(output_impedance_at_V(a,b))": 880.2395209580839} },
  { code: 'C9p.2', id: 'cur-noise-tf-current', netlist: "* the bridge of C9d with .tf i(Vm) V1\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a m 1k\nVm m b 0\n.tf i(Vm) V1\n.end\n", vectors: {"v(Transfer_function)": -2.710505431213761e-20, "v(v1#Input_impedance)": 6394.557823129248, "v(vm#Output_impedance)": 100000000000000000000} },
  { code: 'C9p.3', id: 'cur-noise-dc', netlist: "* the bridge of C9d swept by .dc V1 0 9 3\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a m 1k\nVm m b 0\n.dc V1 0 9 3\n.end\n", vectors: {"v(v-sweep)": [0,3,6,9], "v(top)": [0,3,6,9], "v(a)": [0,1.4999999999999996,2.999999999999999,4.499999999999999], "v(b)": [0,1.4999999999999996,2.999999999999999,4.499999999999999], "v(m)": [0,1.4999999999999996,2.999999999999999,4.499999999999999], "i(vm)": [0,-5.421010862427522e-20,-1.0842021724855044e-19,-2.168404344971009e-19], "i(v1)": [0,-0.000469148936170213,-0.000938297872340426,-0.0014074468085106388]} },
  { code: 'C9p.4', id: 'cur-real-tf-tiny', netlist: "* a real ratio far smaller than noise: 1 Meg over 1e-12 ohm\nV1 in 0 1\nR1 in out 1meg\nR2 out 0 1e-12\n.tf v(out) V1\n.end\n", vectors: {"v(Transfer_function)": 9.999999999999999e-19, "v(v1#Input_impedance)": 1000000, "v(output_impedance_at_V(out))": 1e-12} },
  { code: 'C9q', id: 'cur-noise-2a-bridge', netlist: "* the balanced bridge of C9 fed by a current source written 2A (2 attoamps)\nI1 0 top 2A\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 1.2789115646258505e-14, "v(a)": 6.394557823129253e-15, "v(b)": 6.394557823129254e-15, "i(@i1[current])": 2e-18, "i(@r1[i])": 6.394557823129252e-19, "i(@r2[i])": 6.394557823129254e-19, "i(@r3[i])": 1.3605442176870746e-18, "i(@r4[i])": 1.3605442176870753e-18, "i(@r5[i])": -7.888609052210118e-34} },
  { code: 'C9r', id: 'cur-noise-f-two-loads', netlist: "* the bridge of C9d, its F feeding two resistors side by side\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a m 1k\nVm m b 0\nF1 0 out Vm 1000\nR6 out 0 1k\nR7 out 0 1k\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 9, "v(a)": 4.499999999999999, "v(b)": 4.499999999999999, "v(m)": 4.499999999999999, "v(out)": -1.0842021724855044e-13, "i(vm)": -2.168404344971009e-19, "i(v1)": -0.0014074468085106388, "i(@r1[i])": 0.0004500000000000001, "i(@r2[i])": 0.00044999999999999993, "i(@r3[i])": 0.0009574468085106385, "i(@r4[i])": 0.0009574468085106381, "i(@r5[i])": 0, "i(@f1[i])": -2.1684043449710089e-16, "i(@r6[i])": -1.0842021724855044e-16, "i(@r7[i])": -1.0842021724855044e-16} },
  { code: 'C9r.2', id: 'cur-noise-g-two-loads', netlist: "* the balanced bridge of C9 read by a G feeding two resistors side by side\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nG1 0 out a b 1m\nR6 out 0 1k\nR7 out 0 2k\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 9, "v(a)": 4.499999999999999, "v(b)": 4.5, "v(out)": -8.881784197001252e-16, "i(v1)": -0.0014074468085106386, "i(@r1[i])": 0.0004500000000000001, "i(@r2[i])": 0.00044999999999999993, "i(@r3[i])": 0.0009574468085106382, "i(@r4[i])": 0.0009574468085106382, "i(@r5[i])": -8.881784197001253e-19, "i(@g1[i])": -8.881784197001253e-19, "i(@r6[i])": -8.881784197001253e-19, "i(@r7[i])": -4.440892098500626e-19} },
  { code: 'C9n.4', id: 'cur-real-wire-rounded', netlist: "* a 1 n wire in series with 10 meg, from a 1.5 V divider\nV1 top1 0 1.5\nR1 top1 d2 270k\nR2 d2 0 820\nR3 d2 p3 1n\nR4 p3 0 10meg\n.options savecurrents\n.op\n.end\n", vectors: {"v(top1)": 1.5, "v(d2)": 0.0045413542952368715, "v(p3)": 0.0045413542952368715, "i(v1)": -5.538735724832456e-06, "i(@r1[i])": 5.538735724832456e-06, "i(@r2[i])": 5.538236945410819e-06, "i(@r3[i])": 0, "i(@r4[i])": 4.5413542952368713e-10} },
  { code: 'C9o.4', id: 'cur-noise-gain-h-diode', netlist: "* the H of 1 G reading a balanced bridge's ammeter, with a diode\nV1 top 0 9\nR1 top a 180k\nR2 a 0 3.9meg\nR3 top b 18k\nR4 b 0 390k\nR5 a m 4.7\nVm m b 0\nH1 out 0 Vm 1g\nRl out 0 1k\nD1 0 top dmod\n.model dmod d\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 9, "v(a)": 8.602941176467256, "v(b)": 8.602941176467258, "v(m)": 8.602941176467258, "v(out)": -1.9350975899792844e-07, "i(h1)": 1.9350975899792844e-10, "i(vm)": -1.9350975899792844e-16, "i(v1)": -2.426471489255658e-05, "i(@r1[i])": 2.2058823529596873e-06, "i(@r2[i])": 2.205882352940322e-06, "i(@r3[i])": 2.2058823529596775e-05, "i(@r4[i])": 2.2058823529403225e-05, "i(@r5[i])": -3.7794826370218095e-16, "i(@rl[i])": -1.9350975899792844e-10, "i(@d1[id])": -9.00999999968093e-12} },
  { code: 'C9o.5', id: 'cur-rule-gain-e-temp', netlist: "* the balanced bridge of C9 read by an E of 1e6 into 100 ohms, with ngspice's own gmin written out\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nE1 out 0 a b 1e6\nRl out 0 100\n.options gmin=1e-12\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 9, "v(a)": 4.499999999999999, "v(b)": 4.5, "v(out)": -9.313225746154785e-10, "i(e1)": 9.313225746154785e-12, "i(v1)": -0.0014074468085106386, "i(@r1[i])": 0.0004500000000000001, "i(@r2[i])": 0.00044999999999999993, "i(@r3[i])": 0.0009574468085106382, "i(@r4[i])": 0.0009574468085106382, "i(@r5[i])": -8.881784197001253e-19, "i(@rl[i])": -9.313225746154785e-12} },
  { code: 'C9p.5', id: 'cur-real-dc-cross', netlist: "* a divider swept through 0: .dc V1 -1 1 0.1\nV1 a 0 0\nR1 a b 1k\nR2 b 0 2k\n.dc V1 -1 1 0.1\n.end\n", vectors: {"v(v-sweep)": [-1,-0.9,-0.8,-0.7000000000000001,-0.6000000000000001,-0.5000000000000001,-0.40000000000000013,-0.30000000000000016,-0.20000000000000015,-0.10000000000000014,-1.3877787807814457e-16,0.09999999999999987,0.19999999999999987,0.2999999999999999,0.3999999999999999,0.4999999999999999,0.5999999999999999,0.6999999999999998,0.7999999999999998,0.8999999999999998,0.9999999999999998], "v(a)": [-1,-0.9,-0.8,-0.7000000000000001,-0.6000000000000001,-0.5000000000000001,-0.40000000000000013,-0.30000000000000016,-0.20000000000000015,-0.10000000000000014,-1.3877787807814457e-16,0.09999999999999987,0.19999999999999987,0.2999999999999999,0.3999999999999999,0.4999999999999999,0.5999999999999999,0.6999999999999998,0.7999999999999998,0.8999999999999998,0.9999999999999998], "v(b)": [-0.6666666666666666,-0.6,-0.5333333333333333,-0.46666666666666673,-0.4,-0.33333333333333337,-0.2666666666666667,-0.20000000000000007,-0.13333333333333341,-0.06666666666666676,-9.25185853854297e-17,0.06666666666666658,0.13333333333333325,0.1999999999999999,0.2666666666666666,0.33333333333333326,0.39999999999999986,0.46666666666666656,0.5333333333333332,0.5999999999999999,0.6666666666666665], "i(v1)": [0.0003333333333333334,0.00030000000000000014,0.0002666666666666667,0.00023333333333333339,0.00020000000000000004,0.00016666666666666674,0.0001333333333333334,0.00010000000000000007,6.666666666666672e-05,3.3333333333333376e-05,4.6259292692714865e-20,-3.333333333333328e-05,-6.666666666666662e-05,-9.999999999999996e-05,-0.00013333333333333329,-0.00016666666666666663,-0.00019999999999999998,-0.00023333333333333333,-0.00026666666666666657,-0.00030000000000000003,-0.00033333333333333327]} },
  { code: 'C9s', id: 'cur-imprecise-wire', netlist: "* the balanced bridge of C9 with a 1e-12 ohm wire in its middle branch\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nRw a m 1e-12\nR5 m b 1k\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 9, "v(a)": 4.32056594239515, "v(b)": 4.374128347650329, "v(m)": 4.32056594239515, "i(v1)": -0.001452171416898713, "i(@r1[i])": 0.00046794340576048507, "i(@r2[i])": 0.000432056594239515, "i(@r3[i])": 0.000984228011138228, "i(@r4[i])": 0.0009306656058830487, "i(@rw[i])": 0, "i(@r5[i])": -5.356240525517908e-05} },
  { code: 'C9s.2', id: 'cur-imprecise-g', netlist: "* a balanced bridge with a 1 n wire, read by a G of 1000\nV1 top1 0 15\nR1 top1 s2 1u\nR2 s2 0 1meg\nR3 s2 a3 2.7meg\nR4 a3 0 3.9k\nR5 s2 b4 2.7meg\nR6 b4 0 3.9k\nR7 a3 m5 1n\nR8 m5 b4 1meg\nG1 0 g6 a3 b4 1e3\nR9 g6 0 1.2k\n.options savecurrents\n.op\n.end\n", vectors: {"v(top1)": 15, "v(s2)": 14.999999999973905, "v(a3)": 0.021649312700191603, "v(b4)": 0.021635469421805404, "v(m5)": 0.021649312700191607, "v(g6)": 16.61193406343955, "i(v1)": -2.6093795895576477e-05, "i(@r1[i])": 2.609468197078968e-05, "i(@r2[i])": 1.4999999999973905e-05, "i(@r3[i])": 5.547537291582857e-06, "i(@r4[i])": 5.551105820561949e-06, "i(@r5[i])": 5.5475424187229995e-06, "i(@r6[i])": 5.547556262001386e-06, "i(@r7[i])": -3.4694469519536138e-09, "i(@r8[i])": 1.3843278386202472e-11, "i(@g1[i])": 0.013843278386199004, "i(@r9[i])": 0.013843278386199625} },
  { code: 'C9n.5', id: 'cur-real-dc-wire-rounded', netlist: "* a 1 n wire in series with 10 meg, from a 1.5 V divider, with .op and .dc V1 0 1.5 0.5\nV1 top1 0 1.5\nR1 top1 d2 270k\nR2 d2 0 820\nR3 d2 p3 1n\nR4 p3 0 10meg\n.options savecurrents\n.op\n.dc V1 0 1.5 0.5\n.end\n", vectors: {"v(v-sweep)": [0.0, 0.5, 1.0, 1.5], "v(top1)": [0.0, 0.5, 1.0, 1.5], "v(d2)": [0.0, 0.001513784765078957, 0.003027569530157914, 0.0045413542952368715], "v(p3)": [0.0, 0.001513784765078957, 0.003027569530157914, 0.0045413542952368715], "i(v1)": [0.0, -1.8462452416108186e-06, -3.6924904832216373e-06, -5.538735724832456e-06], "i(@r1[i])": [0.0, 1.8462452416108186e-06, 3.6924904832216373e-06, 5.538735724832456e-06], "i(@r2[i])": [0.0, 1.846078981803606e-06, 3.692157963607212e-06, 5.538236945410819e-06], "i(@r3[i])": [0.0, 0.0, 0.0, 0.0], "i(@r4[i])": [0.0, 1.513784765078957e-10, 3.027569530157914e-10, 4.5413542952368713e-10]} },
  { code: 'C9p.6', id: 'cur-noise-tf-gain-h', netlist: "* the H of 1 G reading a balanced bridge's ammeter, with .op and .tf v(out) V1\nV1 top 0 9\nR1 top a 180k\nR2 a 0 3.9meg\nR3 top b 18k\nR4 b 0 390k\nR5 a m 4.7\nVm m b 0\nH1 out 0 Vm 1g\nRl out 0 1k\n.op\n.tf v(out) V1\n.end\n", vectors: {"v(top)": 9.0, "v(a)": 8.602941176467256, "v(b)": 8.602941176467258, "v(m)": 8.602941176467258, "v(out)": -1.9350975899792844e-07, "i(h1)": 1.9350975899792844e-10, "i(vm)": -1.9350975899792844e-16, "i(v1)": -2.4264705882556586e-05, "v(Transfer_function)": -2.1500237300155906e-08, "v(v1#Input_impedance)": 370909.0909059788, "v(output_impedance_at_V(out))": 0.0} },
  { code: 'C9s.3', id: 'cur-imprecise-g-10mv', netlist: "* C9s.2 with R4 and R6 at 1.8k: the bridge at 10 mV, read by a G of 1000 through a 1 n wire\nV1 top1 0 15\nR1 top1 s2 1u\nR2 s2 0 1meg\nR3 s2 a3 2.7meg\nR4 a3 0 1.8k\nR5 s2 b4 2.7meg\nR6 b4 0 1.8k\nR7 a3 m5 1n\nR8 m5 b4 1meg\nG1 0 g6 a3 b4 1e3\nR9 g6 0 1.2k\n.options savecurrents\n.op\n.end\n", vectors: {"v(top1)": 15.0, "v(s2)": 14.999999999973896, "v(a3)": 0.009995088299682636, "v(b4)": 0.009993340917990978, "v(m5)": 0.009995088299682636, "v(g6)": 2.0968580299886526, "i(v1)": -2.6103109121322632e-05, "i(@r1[i])": 2.610356375498668e-05, "i(@r2[i])": 1.4999999999973897e-05, "i(@r3[i])": 5.551853670990449e-06, "i(@r4[i])": 5.552826833157019e-06, "i(@r5[i])": 5.551854318168854e-06, "i(@r6[i])": 5.551856065550544e-06, "i(@r7[i])": 0.0, "i(@r8[i])": 1.747381691657307e-12, "i(@g1[i])": 0.001747381691657307, "i(@r9[i])": 0.0017473816916572106} },
  { code: 'C9s.4', id: 'cur-imprecise-e-12v', netlist: "* a 12 V supply, a 1000:1 divider, the C9 bridge with a 10 p wire, and an E of gain 1000\nV1 top 0 12\nRd1 top s 999k\nRd2 s 0 1k\nR1 s a 10k\nR2 a 0 10k\nR3 s b 4.7k\nR4 b 0 4.7k\nRw a m 10p\nR5 m b 1k\nE1 out 0 a b 1000\nRl out 0 10k\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 12.0, "v(s)": 0.010318868972790083, "v(a)": 0.004882133225318444, "v(b)": 0.0049649097211622055, "v(m)": 0.004882133225318445, "v(out)": -0.08277649584376157, "i(e1)": 8.277649584376158e-06, "i(v1)": -1.200168281384105e-05, "i(@rd1[i])": 1.200168281384105e-05, "i(@rd2[i])": 1.0318868972790084e-05, "i(@r1[i])": 5.436735747471639e-07, "i(@r2[i])": 4.882133225318445e-07, "i(@r3[i])": 1.1391402663038038e-06, "i(@r4[i])": 1.0563637704600437e-06, "i(@rw[i])": -8.673617379884035e-08, "i(@r5[i])": -8.27764958437607e-08, "i(@rl[i])": -8.277649584376158e-06} },
  { code: 'C9s.5', id: 'cur-imprecise-unbalanced', netlist: "* the bridge of C9s made unbalanced (R2 12k): a real current through the 1e-12 ohm wire and R5\nV1 top 0 9\nR1 top a 10k\nR2 a 0 12k\nR3 top b 4.7k\nR4 b 0 4.7k\nRw a m 1e-12\nR5 m b 1k\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 9.0, "v(a)": 4.32056594239515, "v(b)": 4.374128347650329, "v(m)": 4.32056594239515, "i(v1)": -0.001452171416898713, "i(@r1[i])": 0.00046794340576048507, "i(@r2[i])": 0.0003600471618662625, "i(@r3[i])": 0.000984228011138228, "i(@r4[i])": 0.0009306656058830487, "i(@rw[i])": 0.0, "i(@r5[i])": -5.356240525517908e-05} },
  { code: 'C9t', id: 'cur-diode-e-fed', netlist: "* the C9 bridge read by an E of 1e6, fed 5 mA through 1k from 5 V, with a diode across V1\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nE1 out 0 a b 1e6\nV2 x 0 5\nRx x out 1k\nD1 0 top dmod\n.model dmod d\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 9.0, "v(a)": 4.499999999999999, "v(b)": 4.5, "v(out)": -9.313225746154785e-10, "v(x)": 5.0, "i(e1)": 0.005000000000931323, "i(v2)": -0.005000000000931323, "i(v1)": -0.0014074468175206383, "i(@r1[i])": 0.0004500000000000001, "i(@r2[i])": 0.00044999999999999993, "i(@r3[i])": 0.0009574468085106382, "i(@r4[i])": 0.0009574468085106382, "i(@r5[i])": -8.881784197001253e-19, "i(@rx[i])": 0.005000000000931323, "i(@d1[id])": -9.00999999968093e-12} },
  { code: 'C9t.2', id: 'cur-diode-quiet', netlist: "* a G reading the balanced bridge of C9 drives 1k, with a diode and 1k beside it\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nG1 0 out a b 1m\nR6 out 0 1k\nD1 out x dmod\nR7 x 0 1k\n.model dmod d\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 9.0, "v(a)": 4.5, "v(b)": 4.500000000000001, "v(out)": -8.881784197001252e-16, "v(x)": -1.231405126604393e-24, "i(v1)": -0.0014074468085106383, "i(@r1[i])": 0.00045000000000000004, "i(@r2[i])": 0.00045000000000000004, "i(@r3[i])": 0.0009574468085106381, "i(@r4[i])": 0.0009574468085106385, "i(@r5[i])": -8.881784197001253e-19, "i(@g1[i])": -8.881784197001253e-19, "i(@r6[i])": -8.881784197001253e-19, "i(@d1[id])": -1.2312373330778934e-27, "i(@r7[i])": -1.231405126604393e-27} },
  { code: 'C9t.3', id: 'cur-diode-real-femtovolts', netlist: "* a bridge 1e-13 off balance read by an H of 1 meg, with a diode beside it\nV1 top1 0 12\nR1 top1 a2 56\nR2 a2 0 22000\nR3 top1 b3 280\nR4 b3 0 110000.000000011\nR5 a2 m4 6.8k\nV2 m4 b3 0\nH1 h5 0 V2 1meg\nR6 h5 0 47\nD1 top1 d7 dmod\nR8 d7 top1 10\nR9 d7 l9 330\nR10 l9 0 120k\n.model dmod D(is=1e-14)\n.options savecurrents\n.op\n.end\n", vectors: {"v(top1)": 12.0, "v(a2)": 11.969532100108815, "v(b3)": 11.969532100108818, "v(m4)": 11.969532100108816, "v(h5)": -4.3368086899420177e-13, "v(d7)": 11.999002825328251, "v(l9)": 11.966096061160062, "i(h1)": 9.227252531791527e-15, "i(v2)": -4.336808689942018e-19, "i(v1)": -0.0007526010362732122, "i(@r1[i])": 0.0005440696409140244, "i(@r2[i])": 0.000544069640914037, "i(@r3[i])": 0.0001088139281827922, "i(@r4[i])": 0.00010881392818279655, "i(@r5[i])": -2.6122894697062505e-19, "i(@r6[i])": -9.227252531791527e-15, "i(@d1[id])": 1.3902345916013558e-15, "i(@r8[i])": -9.971746717489794e-05, "i(@r9[i])": 9.971746717632979e-05, "i(@r10[i])": 9.971746717633385e-05} },
  { code: 'C9t.4', id: 'cur-diode-series-resistance', netlist: "* a diode with a 10 ohm series resistance, fed through 1k from 5 V\nV1 1 0 5\nR1 1 2 1k\nD1 2 0 dmod\n.model dmod D(is=1e-14 rs=10)\n.options savecurrents\n.op\n.end\n", vectors: {"v(1)": 5.0, "v(2)": 0.7352825914137034, "i(v1)": -0.004264717408586296, "i(@r1[i])": 0.004264717408586296, "i(@d1[id])": 0.004265322389487809} },
  { code: 'C9n.6', id: 'cur-real-dc-wire-diode-across', netlist: "* the 1 n wire of C9n.4 in series with 10 meg, with a diode across V1, with .op and .dc V1 0 1.5 0.5\nV1 top1 0 1.5\nR1 top1 d2 270k\nR2 d2 0 820\nR3 d2 p3 1n\nR4 p3 0 10meg\nD1 0 top1 dmod\n.model dmod d\n.options savecurrents\n.op\n.dc V1 0 1.5 0.5\n.end\n", vectors: {"v(v-sweep)": [0,0.5,1,1.5], "v(top1)": [0,0.5,1,1.5], "v(d2)": [0,0.001513784765078957,0.003027569530157914,0.0045413542952368715], "v(p3)": [0,0.001513784765078957,0.003027569530157914,0.0045413542952368715], "i(v1)": [0,-0.0000018462459349228635,-0.000003692491493221405,-0.000005538737234832387], "i(@r1[i])": [0,0.0000018462452416108186,0.0000036924904832216373,0.000005538735724832456], "i(@r2[i])": [0,0.000001846078981803606,0.000003692157963607212,0.000005538236945410819], "i(@r3[i])": [0,0,0,0], "i(@r4[i])": [0,1.513784765078957e-10,3.027569530157914e-10,4.5413542952368713e-10], "i(@d1[id])": [0,-5.099981391833937e-13,-1.0099997673979242e-12,-1.5099999310808666e-12]} },
  { code: 'C9r.3', id: 'cur-rule-f-two-readers', netlist: "* an F of 1000 into two loads and an F of 1 into a 0 V ammeter, both reading the ammeter of a balanced bridge, with ngspice's own gmin written out\nV1 top 0 9\nR1 top a 180k\nR2 a 0 3.9meg\nR3 top b 18k\nR4 b 0 390k\nR5 a m 4.7\nVm m b 0\nF1 0 out Vm 1000\nR6 out 0 1k\nR7 out 0 1k\nF2 0 y Vm 1\nVx y 0 0\n.options gmin=1e-12\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 9, "v(a)": 8.602941176467256, "v(b)": 8.602941176467258, "v(m)": 8.602941176467258, "v(out)": -9.675487949896422e-11, "v(y)": 0, "i(vm)": -1.9350975899792844e-16, "i(vx)": -1.9350975899792844e-16, "i(v1)": -0.000024264705882556586, "i(@r1[i])": 0.0000022058823529596873, "i(@r2[i])": 0.000002205882352940322, "i(@r3[i])": 0.000022058823529596775, "i(@r4[i])": 0.000022058823529403225, "i(@r5[i])": -3.7794826370218095e-16, "i(@f1[i])": -1.9350975899792844e-13, "i(@r6[i])": -9.675487949896422e-14, "i(@r7[i])": -9.675487949896422e-14, "i(@f2[i])": -1.9350975899792844e-16} },
  { code: 'C9t.5', id: 'cur-diode-dc-tia', netlist: "* the H of 1 G reading a balanced bridge's ammeter, with a diode across V1, with .op and .dc V1 0 9 3\nV1 top 0 9\nR1 top a 180k\nR2 a 0 3.9meg\nR3 top b 18k\nR4 b 0 390k\nR5 a m 4.7\nVm m b 0\nH1 out 0 Vm 1g\nRl out 0 1k\nD1 0 top dmod\n.model dmod d\n.options savecurrents\n.op\n.dc V1 0 9 3\n.end\n", vectors: {"v(v-sweep)": [0,3,6,9], "v(top)": [0,3,6,9], "v(a)": [0,2.8676470588224197,5.735294117644839,8.602941176467256], "v(b)": [0,2.8676470588224197,5.735294117644839,8.602941176467258], "v(m)": [0,2.8676470588224197,5.735294117644839,8.602941176467258], "v(out)": [0,-6.450325299930948e-8,-1.2900650599861896e-7,-1.9350975899792844e-7], "i(h1)": [0,6.450325299930948e-11,1.2900650599861896e-10,1.9350975899792844e-10], "i(vm)": [0,-6.450325299930948e-17,-1.2900650599861896e-16,-1.9350975899792844e-16], "i(v1)": [0,-0.000008088238304186694,-0.000016176476598370973,-0.00002426471489255658], "i(@r1[i])": [0,7.352941176532241e-7,0.0000014705882353064482,0.0000022058823529596873], "i(@r2[i])": [0,7.352941176467743e-7,0.0000014705882352935485,0.000002205882352940322], "i(@r3[i])": [0,0.0000073529411765322414,0.000014705882353064483,0.000022058823529596775], "i(@r4[i])": [0,0.000007352941176467742,0.000014705882352935485,0.000022058823529403225], "i(@r5[i])": [0,0,0,-3.7794826370218095e-16], "i(@rl[i])": [0,-6.450325299930948e-11,-1.2900650599861896e-10,-1.9350975899792844e-10], "i(@d1[id])": [0,-3.0099999913851085e-12,-6.009999998923139e-12,-9.00999999968093e-12]} },
  { code: 'C9t.6', id: 'cur-diode-dc-quiet-point', netlist: "* a G reading the balanced bridge of C9 drives R6 and R7, with a diode from x to y, which V2 sets, swept\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nG1 0 out a b 1m\nR6 out x 1k\nR7 x 0 1k\nD1 x y dmod\nV2 y 0 0\n.model dmod d\n.options savecurrents\n.op\n.dc V2 0 2 1\n.end\n", vectors: {"v(v-sweep)": [0,1,2], "v(top)": [9,9,9], "v(a)": [4.5,4.5,4.5], "v(b)": [4.500000000000001,4.500000000000001,4.500000000000001], "v(out)": [-1.7763568394002505e-15,1.3866223724789961e-9,2.0099975017728866e-9], "v(x)": [-8.881784190848286e-16,1.38662323026232e-9,2.009998735343814e-9], "v(y)": [0,1,2], "i(v2)": [-1.2305932679744663e-27,-1.3866240880456443e-12,-2.0099999689147417e-12], "i(v1)": [-0.0014074468085106383,-0.0014074468085106383,-0.0014074468085106383], "i(@r1[i])": [0.00045000000000000004,0.00045000000000000004,0.00045000000000000004], "i(@r2[i])": [0.00045000000000000004,0.00045000000000000004,0.00045000000000000004], "i(@r3[i])": [0.0009574468085106381,0.0009574468085106381,0.0009574468085106381], "i(@r4[i])": [0.0009574468085106385,0.0009574468085106385,0.0009574468085106385], "i(@r5[i])": [-8.881784197001253e-19,-8.881784197001253e-19,-8.881784197001253e-19], "i(@g1[i])": [-8.881784197001253e-19,-8.881784197001253e-19,-8.881784197001253e-19], "i(@r6[i])": [-8.881784203154217e-19,-8.577833239847295e-19,-1.2335709274332335e-18], "i(@r7[i])": [-8.881784190848286e-19,1.3866232302623201e-12,2.009998735343814e-12], "i(@d1[id])": [-1.231237333694002e-27,-1.0099997660113e-12,-2.0099999689147417e-12]} },
  { code: 'C9t.7', id: 'cur-diode-wire-current', netlist: "* the 1 n wire of C9n.4 in series with 10 meg, from a 1.5 V divider, with a diode from the divider to ground\nV1 top1 0 1.5\nR1 top1 d2 270k\nR2 d2 0 820\nR3 d2 p3 1n\nR4 p3 0 10meg\nD1 d2 0 dmod\n.model dmod d\n.options savecurrents\n.op\n.end\n", vectors: {"v(top1)": 1.5, "v(d2)": 0.004541354295384195, "v(p3)": 0.004541354295384194, "i(v1)": -0.0000055387357248319104, "i(@r1[i])": 0.0000055387357248319104, "i(@r2[i])": 0.000005538236945590481, "i(@r3[i])": 8.673617379884034e-10, "i(@r4[i])": 4.5413542953841937e-10, "i(@d1[id])": 6.460724084056888e-15} },
  { code: 'C9t.8', id: 'cur-diode-wire-warning', netlist: "* the bridge with a 1e-12 ohm wire (C9s), fed through 100 ohms, with a diode from top to ground\nV1 in 0 9\nR0 in top 100\nD1 top 0 dmod\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nRw a m 1e-12\nR5 m b 1k\n.model dmod d\n.options savecurrents\n.op\n.end\n", vectors: {"v(in)": 9, "v(top)": 0.7691572401059934, "v(a)": 0.3926329591523753, "v(b)": 0.39022867882420265, "v(m)": 0.39263295915237534, "i(v1)": -0.08230842759894007, "i(@r0[i])": 0.08230842759894007, "i(@d1[id])": 0.08219017562144401, "i(@r1[i])": 0.00003765242809536181, "i(@r2[i])": 0.00003926329591523753, "i(@r3[i])": 0.00008062309814506186, "i(@r4[i])": 0.00008302737847323461, "i(@rw[i])": -0.00005551115123125783, "i(@r5[i])": 0.000002404280328172692} },
  { code: 'C9t.9', id: 'cur-diode-dc-zero-point', netlist: "* two equal diode arms with 1k between them, swept from 0 V: .op and .dc V1 0 9 3\nV1 top 0 9\nD1 top a dmod\nR2 a 0 10k\nD2 top b dmod\nR4 b 0 10k\nR5 a b 1k\n.model dmod d\n.options savecurrents\n.op\n.dc V1 0 9 3\n.end\n", vectors: {"v(v-sweep)": [0,3,6,9], "v(top)": [0,3,6,9], "v(a)": [-7.3985058599438795e-25,2.381405664529363,5.356213084449984,8.344256960500747], "v(b)": [-7.39850585636142e-25,2.3814056645293626,5.356213084449984,8.344256960500747], "i(v1)": [1.47970117163053e-28,-0.0004762811329058689,-0.0010712426168900668,-0.0016688513921001569], "i(@d1[id])": [7.39850585994388e-37,0.00024363384418924443,0.0006452722319805792,0.0010244640191150918], "i(@r2[i])": [-7.39850585994388e-29,0.0002381405664529363,0.0005356213084449984,0.0008344256960500747], "i(@d2[id])": [7.3985058563614194e-37,0.00024363384418924874,0.0006452722319805792,0.0010244640191150918], "i(@r4[i])": [-7.398505856361421e-29,0.00023814056645293628,0.0005356213084449984,0.0008344256960500747], "i(@r5[i])": [-3.582459542440043e-37,4.440892098500626e-19,0,0]} },
  { code: 'C9t.10', id: 'cur-diode-loop-spurious', netlist: "* a bridge whose ammeter an F of 1e9 and an H of 1 meg read, with a diode and 2.2 meg in a loop from top1 (the generated circuit s5-137)\nV1 top1 0 100\nR1 top1 a2 3.3k\nR2 a2 0 12\nR3 top1 b3 330\nR4 b3 0 1.2\nR5 a2 m4 560\nV2 m4 b3 0\nF1 0 o5 V2 1e9\nR6 o5 0 22k\nH1 h6 0 V2 1meg\nR7 h6 0 270k\nV3 b3 v7 0\nV4 v7 v8 0\nV5 v8 v9 0\nV6 v9 v10 0\nR8 v10 0 12\nR9 b3 a11 12\nR10 a11 0 5.6\nR11 b3 b12 12000\nR12 b12 0 5605.6\nR13 a11 m13 1.2k\nR14 m13 m14 100k\nR15 m14 m15 2.2\nR16 m15 m16 22k\nR17 m16 m17 2.2\nR18 m17 m18 220\nR19 m18 m19 8.2k\nR20 m19 b12 22k\nD1 d20 top1 dmod\nR21 d20 top1 2.2meg\nE1 e21 0 b3 0 1\nR22 e21 0 27\n.model dmod D(is=1e-14)\n.options savecurrents\n.op\n.end\n", vectors: {"v(top1)": 100, "v(a2)": 0.3612333515243817, "v(b3)": 0.31039299140572524, "v(m4)": 0.31039299140572524, "v(o5)": 1997299861.804358, "v(h6)": 90.78635735474354, "v(v7)": 0.31039299140572524, "v(v8)": 0.31039299140572524, "v(v9)": 0.31039299140572524, "v(v10)": 0.31039299140572524, "v(a11)": 0.09876140798879642, "v(b12)": 0.09882708871827177, "v(m13)": 0.09876192103799805, "v(m14)": 0.09880467513813368, "v(m15)": 0.09880467607872388, "v(m16)": 0.09881408198065472, "v(m17)": 0.09881408292124493, "v(m18)": 0.09881417698026354, "v(m19)": 0.09881768281641147, "v(d20)": 100.67855799103364, "v(e21)": 0.31039299140572524, "i(v2)": 0.00009078635735474354, "i(h1)": -0.00033624576798053164, "i(e1)": -0.011496036718730564, "i(v6)": 0.02586608261714377, "i(v5)": 0.02586608261714377, "i(v4)": 0.02586608261714377, "i(v3)": 0.02586608261714377, "i(v1)": -0.33228328385891703, "i(@r1[i])": 0.03019356565105322, "i(@r2[i])": 0.03010277929369847, "i(@r3[i])": 0.30208971820786146, "i(@r4[i])": 0.25866082617143765, "i(@r5[i])": 0.00009078635735474365, "i(@f1[i])": 90786.35735474354, "i(@r6[i])": 90786.35735474354, "i(@r7[i])": 0.00033624576798053164, "i(@r8[i])": 0.02586608261714377, "i(@r9[i])": 0.01763596528474407, "i(@r10[i])": 0.01763596571228507, "i(@r11[i])": 0.00001763049189062112, "i(@r12[i])": 0.000017630064349627473, "i(@r13[i])": -4.2754100136368123e-10, "i(@r14[i])": -4.275410013562797e-10, "i(@r15[i])": -4.2754100133950016e-10, "i(@r16[i])": -4.275409968563439e-10, "i(@r17[i])": -4.2754100133950016e-10, "i(@r18[i])": -4.275409937067169e-10, "i(@r19[i])": -4.2754099364994414e-10, "i(@r20[i])": -4.275409936499441e-10, "i(@d1[id])": 0.0024750251429858545, "i(@r21[i])": 3.084354504698374e-7, "i(@r22[i])": 0.011496036718730564} },
  { code: 'C9t.11', id: 'cur-diode-tf-conductance', netlist: "* the balanced bridge of C9 with a reverse-biased diode from a to top, .op and .tf v(a,b) V1\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nD1 a top dmod\n.model dmod d\n.op\n.tf v(a,b) V1\n.end\n", vectors: {"v(top)": 9, "v(a)": 4.500000009047006, "v(b)": 4.500000006346407, "i(v1)": -0.0014074468107656381, "v(Transfer_function)": 2.994011705226285e-10, "v(v1#Input_impedance)": 6394.557812906659, "v(output_impedance_at_V(a,b))": 880.2395205995194} },
  { code: 'C9u', id: 'cur-rest-diode-sweep', netlist: "* the I-V curve of a diode swept from 0 V, its source at 0 V for the .op\nV1 in 0 0\nR1 in a 1k\nD1 a 0 dmod\n.model dmod d\n.options savecurrents\n.op\n.dc V1 0 1 0.25\n.end\n", vectors: {"v(v-sweep)": [0, 0.25, 0.5, 0.75, 1], "v(in)": [0, 0.25, 0.5, 0.75, 1], "v(a)": [7.323378444748195e-29, 0.24999984210234252, 0.4977237724822676, 0.6051466622248889, 0.6296706738025182], "i(v1)": [7.323378444748195e-32, -1.578976574598441e-10, -2.276227517732359e-06, -0.00014485333777511107, -0.00037032932619748187], "i(@r1[i])": [-7.323378444748195e-32, 1.5789765747675767e-10, 2.2762275177323765e-06, 0.00014485333777511112, 0.0003703293261974818], "i(@d1[id])": [7.323378444748195e-41, 1.5789765748689402e-10, 2.276227641451018e-06, 0.00014485699554772006, 0.0003738685935656918]} },
  { code: 'C9u.2', id: 'cur-floor-open-loop-e', netlist: "* the bridge of C9s.4 (a 10 pOhm wire at 5 mV beside 12 V) beside an open-loop E of 100k reading the supply\nV1 top 0 12\nRd1 top s 999k\nRd2 s 0 1k\nR1 s a 10k\nR2 a 0 10k\nR3 s b 4.7k\nR4 b 0 4.7k\nRw a m 10p\nR5 m b 1k\nE1 out 0 top 0 100k\nRl out 0 10k\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 12, "v(s)": 0.010318868972790083, "v(a)": 0.004882133225318445, "v(b)": 0.0049649097211622055, "v(m)": 0.004882133225318445, "v(out)": 1200000, "i(e1)": -120, "i(v1)": -1.200168281384105e-05, "i(@rd1[i])": 1.200168281384105e-05, "i(@rd2[i])": 1.0318868972790084e-05, "i(@r1[i])": 5.436735747471639e-07, "i(@r2[i])": 4.882133225318445e-07, "i(@r3[i])": 1.1391402663038038e-06, "i(@r4[i])": 1.0563637704600437e-06, "i(@rw[i])": 0, "i(@r5[i])": -8.27764958437607e-08, "i(@rl[i])": 120} },
  { code: 'C9u.3', id: 'cur-diodes-alike', netlist: "* two equal diode arms, a link between their middle nodes, read by an ammeter\nV1 top 0 9\nR0 top t 100\nD1 t a dmod\nR1 a c 1k\nR2 c 0 2.2k\nD2 t b dmod\nR3 b d 1k\nR4 d 0 2.2k\nR5 c m 4.7k\nVm m d 0\n.model dmod d\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 9, "v(t)": 8.51049266859241, "v(a)": 7.83211730252121, "v(c)": 5.384580645483332, "v(b)": 7.832117302521211, "v(d)": 5.384580645483333, "v(m)": 5.384580645483333, "i(vm)": -2.168404344971009e-19, "i(v1)": -0.004895073314075904, "i(@r0[i])": 0.004895073314075908, "i(@d1[id])": 0.002457611230743598, "i(@r1[i])": 0.002447536657037878, "i(@r2[i])": 0.0024475366570378783, "i(@d2[id])": 0.0024576112307435195, "i(@r3[i])": 0.002447536657037878, "i(@r4[i])": 0.0024475366570378787, "i(@r5[i])": -1.8897413185109047e-19} },
  { code: 'C9u.4', id: 'cur-temp-sweep-exact', netlist: "* the C9 bridge, .op and a temperature sweep\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\n.options savecurrents\n.op\n.dc TEMP 0 50 25\n.end\n", vectors: {"temp-sweep": [0, 25, 50], "v(top)": [9, 9, 9], "v(a)": [4.499999999999999, 4.499999999999999, 4.499999999999999], "v(b)": [4.5, 4.5, 4.5], "i(v1)": [-0.0014074468085106386, -0.0014074468085106386, -0.0014074468085106386], "i(@r1[i])": [0.0004500000000000001, 0.0004500000000000001, 0.0004500000000000001], "i(@r2[i])": [0.00044999999999999993, 0.00044999999999999993, 0.00044999999999999993], "i(@r3[i])": [0.0009574468085106382, 0.0009574468085106382, 0.0009574468085106382], "i(@r4[i])": [0.0009574468085106382, 0.0009574468085106382, 0.0009574468085106382], "i(@r5[i])": [-8.881784197001253e-19, -8.881784197001253e-19, -8.881784197001253e-19]} },
  { code: 'C9u.5', id: 'cur-r-sweep-rule', netlist: "* the C9 bridge, .op and a sweep of R5\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\n.options savecurrents\n.op\n.dc R5 1k 2k 500\n.end\n", vectors: {"res-sweep": [1000, 1500, 2000], "v(top)": [9, 9, 9], "v(a)": [4.499999999999999, 4.499999999999999, 4.499999999999999], "v(b)": [4.5, 4.5, 4.5], "i(v1)": [-0.0014074468085106386, -0.0014074468085106386, -0.0014074468085106386], "i(@r1[i])": [0.0004500000000000001, 0.0004500000000000001, 0.0004500000000000001], "i(@r2[i])": [0.00044999999999999993, 0.00044999999999999993, 0.00044999999999999993], "i(@r3[i])": [0.0009574468085106382, 0.0009574468085106382, 0.0009574468085106382], "i(@r4[i])": [0.0009574468085106382, 0.0009574468085106382, 0.0009574468085106382], "i(@r5[i])": [-8.881784197001253e-19, -5.921189464667501e-19, -4.440892098500626e-19]} },
  { code: 'C9u.6', id: 'cur-lost-only-exact', netlist: "* a 1.5 V source, 47 ohms and a current source written 1A (1 attoamp) in one loop\nV1 top1 0 1.5\nR1 top1 i2 47\nI1 0 i2 1A\n.options savecurrents\n.op\n.end\n", vectors: {"v(top1)": 1.5, "v(i2)": 1.5, "i(v1)": 0, "i(@r1[i])": 0, "i(@i1[current])": 1e-18} },
  { code: 'C9u.7', id: 'cur-diode-warning-known', netlist: "* a bridge with a 1 nOhm wire read by a G of 1 mS, and a diode with 5.6 ohms from a2 to ground\nV1 top1 0 9\nR1 top1 a2 4.7meg\nR2 a2 0 33k\nR3 top1 b3 4.7meg\nR4 b3 0 33k\nR5 a2 m4 1n\nR6 m4 b3 100meg\nR7 top1 s5 1k\nR8 s5 0 1e15\nG1 0 g6 a2 b3 1m\nR9 g6 0 3.3\nD1 a2 d7 dmod\nR10 d7 0 5.6\n.model dmod D(is=1e-14)\n.options savecurrents\n.op\n.end\n", vectors: {"v(top1)": 9, "v(a2)": 0.06301395023536004, "v(b3)": 0.06275098412432668, "v(m4)": 0.06301395023536004, "v(s5)": 8.999999999991001, "v(g6)": 8.677881664100572e-07, "v(d7)": 9.369770927092972e-13, "i(v1)": -3.8030287463696474e-06, "i(@r1[i])": 1.9014863935669448e-06, "i(@r2[i])": 1.9095136434957588e-06, "i(@r3[i])": 1.9015423438033348e-06, "i(@r4[i])": 1.901544973464445e-06, "i(@r5[i])": 0, "i(@r6[i])": 2.6296611103335257e-12, "i(@r7[i])": 8.999023748401669e-15, "i(@r8[i])": 8.999999999991002e-15, "i(@g1[i])": 2.6296611103335256e-07, "i(@r9[i])": 2.629661110333506e-07, "i(@d1[id])": 1.6731733798380313e-13, "i(@r10[i])": 1.6731733798380306e-13} },
  { code: 'C9u.8', id: 'cur-probe-wire-ladder', netlist: "* a 20-section ladder of 27k and 270, read at n8 by a 1e14 ohm meter through a 1 nOhm wire\nV1 top1 0 5\nR1 top1 n2 27k\nR2 n2 0 270\nR3 n2 n3 27k\nR4 n3 0 270\nR5 n3 n4 27k\nR6 n4 0 270\nR7 n4 n5 27k\nR8 n5 0 270\nR9 n5 n6 27k\nR10 n6 0 270\nR11 n6 n7 27k\nR12 n7 0 270\nR13 n7 n8 27k\nR14 n8 0 270\nR15 n8 n9 27k\nR16 n9 0 270\nR17 n9 n10 27k\nR18 n10 0 270\nR19 n10 n11 27k\nR20 n11 0 270\nR21 n11 n12 27k\nR22 n12 0 270\nR23 n12 n13 27k\nR24 n13 0 270\nR25 n13 n14 27k\nR26 n14 0 270\nR27 n14 n15 27k\nR28 n15 0 270\nR29 n15 n16 27k\nR30 n16 0 270\nR31 n16 n17 27k\nR32 n17 0 270\nR33 n17 n18 27k\nR34 n18 0 270\nR35 n18 n19 27k\nR36 n19 0 270\nR37 n19 n20 27k\nR38 n20 0 270\nR39 n20 n21 27k\nR40 n21 0 270\nR41 n8 p22 1n\nR42 p22 0 1e14\n.options savecurrents\n.op\n.end\n", vectors: {"v(top1)": 5, "v(n2)": 0.04902432036075849, "v(n3)": 0.0004806767973668559, "v(n4)": 4.712970660819228e-06, "v(n5)": 4.621003670537149e-08, "v(n6)": 4.5308312866507694e-10, "v(n7)": 4.442418466369907e-12, "v(n8)": 4.355490465360492e-14, "v(n9)": 4.2704991980412374e-16, "v(n10)": 4.187166415702717e-18, "v(n11)": 4.105459755344378e-20, "v(n12)": 4.0253474854840795e-22, "v(n13)": 3.946798493834904e-24, "v(n14)": 3.869782275222429e-26, "v(n15)": 3.7942689197377853e-28, "v(n16)": 3.7202291011218854e-30, "v(n17)": 3.6476340653763185e-32, "v(n18)": 3.576455619596522e-34, "v(n19)": 3.50666612134043e-36, "v(n20)": 3.4382417071680744e-38, "v(n21)": 3.4041997100674006e-40, "v(p22)": 4.355490465360491e-14, "i(v1)": -0.0001833694696162682, "i(@r1[i])": 0.0001833694696162682, "i(@r2[i])": 0.00018157155689169812, "i(@r3[i])": 1.7979127245700606e-06, "i(@r4[i])": 1.780284434692059e-06, "i(@r5[i])": 1.762828987800136e-08, "i(@r6[i])": 1.7455446891923066e-08, "i(@r7[i])": 1.7284298607829096e-10, "i(@r8[i])": 1.7114828409396848e-10, "i(@r9[i])": 1.6947019843224596e-12, "i(@r10[i])": 1.6780856617225073e-12, "i(@r11[i])": 1.6616322599952112e-14, "i(@r12[i])": 1.6453401727295952e-14, "i(@r13[i])": 1.6292087265615931e-16, "i(@r14[i])": 1.6131446168001822e-16, "i(@r15[i])": 1.5973279531037331e-18, "i(@r16[i])": 1.5816663696449028e-18, "i(@r17[i])": 1.5661583458830407e-20, "i(@r18[i])": 1.5508023761861914e-20, "i(@r19[i])": 1.535596969684916e-22, "i(@r20[i])": 1.5205406501275474e-22, "i(@r21[i])": 1.5056319557368655e-24, "i(@r22[i])": 1.4908694390681776e-24, "i(@r23[i])": 1.476251666868789e-26, "i(@r24[i])": 1.4617772199388533e-26, "i(@r25[i])": 1.447444692993585e-28, "i(@r26[i])": 1.4332526945268256e-28, "i(@r27[i])": 1.4191998466759448e-30, "i(@r28[i])": 1.4052847850880687e-30, "i(@r29[i])": 1.3915061587876173e-32, "i(@r30[i])": 1.3778626300451428e-32, "i(@r31[i])": 1.3643528742474527e-34, "i(@r32[i])": 1.3509755797690069e-34, "i(@r33[i])": 1.3377294478445753e-36, "i(@r34[i])": 1.3246131924431563e-36, "i(@r35[i])": 1.3116255401418954e-38, "i(@r36[i])": 1.2987652301260852e-38, "i(@r37[i])": 1.2860310015810181e-40, "i(@r38[i])": 1.2734228545066943e-40, "i(@r39[i])": 1.2608147074323703e-42, "i(@r40[i])": 1.2608147074323707e-42, "i(@r41[i])": 6.310887241768094e-21, "i(@r42[i])": 4.355490465360491e-28} },
  { code: 'C9v', id: 'cur-carried-moved', netlist: "* the bridge of C9s.4 beside an open-loop comparator: an E of 100k reading a 12 V reference, pulled up by 10k to the bridge supply\nV1 top 0 12\nRd1 top s 999k\nRd2 s 0 1k\nR1 s a 10k\nR2 a 0 10k\nR3 s b 4.7k\nR4 b 0 4.7k\nRw a m 10p\nR5 m b 1k\nV2 x 0 12\nE1 out 0 x 0 100k\nRp top out 10k\n.options savecurrents\n.op\n.end\n", vectors: {"v(top)": 12, "v(s)": 0.01033421695321993, "v(a)": 0.0049610739788227285, "v(b)": 0.005022576813983098, "v(m)": 0.0049610739788227285, "v(x)": 12, "v(out)": 1200000, "i(e1)": -119.9988, "i(v2)": 0, "i(v1)": 119.99878799833255, "i(@rd1[i])": 0.000012001667450497277, "i(@rd2[i])": 0.00001033421695321993, "i(@r1[i])": 5.373142974397202e-7, "i(@r2[i])": 4.961073978822728e-7, "i(@r3[i])": 0.000001130136199837624, "i(@r4[i])": 0.0000010686333646772549, "i(@rw[i])": 0, "i(@r5[i])": -6.150283516036942e-8, "i(@rp[i])": -119.9988} },
  { code: 'C9v.2', id: 'cur-isweep-diode', netlist: "* the I-V curve of a diode fed by a current source swept from 0, its source at 0 for the .op\nI1 0 a 0\nD1 a 0 dmod\nR1 a 0 1k\n.model dmod d\n.options savecurrents\n.op\n.dc I1 0 1m 0.25m\n.end\n", vectors: {"i(i-sweep)": [0, 0.00025, 0.0005, 0.00075, 0.001], "v(a)": [7.323378444748195e-29, 0.24999999965334396, 0.49773230174399913, 0.6053289558374666, 0.6296832256158842], "i(@i1[current])": [0, 0.00025, 0.0005, 0.00075, 0.001], "i(@d1[id])": [7.323378444748195e-41, 1.5789861798765783e-10, 0.0000022769783780108205, 0.00014588154085181518, 0.0003740500697960956], "i(@r1[i])": [7.323378444748195e-32, 0.000249999999653344, 0.0004977323017439991, 0.0006053289558374666, 0.0006296832256158842]} },
  { code: 'C9v.3', id: 'cur-page-digits', netlist: "* two equal arms of three resistors and a link (C9m), fed through a 30 nOhm wire\nV1 n0 0 9\nRs n0 n1 30n\nR1 n1 n2 15k\nR2 n2 n3 330\nR3 n3 0 33k\nR4 n1 n4 15k\nR5 n4 n5 330\nR6 n5 0 33k\nR7 n3 n5 100k\n.options savecurrents\n.op\n.end\n", vectors: {"v(n0)": 9, "v(n1)": 8.999999999988827, "v(n2)": 6.206703910606817, "v(n3)": 6.145251396640413, "v(n4)": 6.206703910606823, "v(n5)": 6.145251396640419, "i(v1)": -0.0003724098205566406, "i(@rs[i])": 0.0003724428173275858, "i(@r1[i])": 0.00018621973929213402, "i(@r2[i])": 0.00018621973929213248, "i(@r3[i])": 0.00018621973929213372, "i(@r4[i])": 0.0001862197392921336, "i(@r5[i])": 0.00018621973929213248, "i(@r6[i])": 0.0001862197392921339, "i(@r7[i])": -6.217248937900877e-20} },
  { code: 'C9v.4', id: 'cur-one-voltage-drawn-apart', netlist: "* a balanced bridge with a 1 nOhm wire in its middle branch\nV1 top1 0 24\nR1 top1 a2 100k\nR2 a2 0 270\nR3 top1 b3 10k\nR4 b3 0 27\nR5 a2 m4 1n\nR6 m4 b3 2.7k\n.options savecurrents\n.op\n.end\n", vectors: {"v(top1)": 24, "v(a2)": 0.06462493801314731, "v(b3)": 0.06462550546077958, "v(m4)": 0.06462493801314731, "i(v1)": -0.0026328912000737905, "i(@r1[i])": 0.00023935375061986855, "i(@r2[i])": 0.00023935162227091598, "i(@r3[i])": 0.0023935374494539223, "i(@r4[i])": 0.0023935372392881325, "i(@r5[i])": 0, "i(@r6[i])": -2.1016578973016892e-10} },
  { code: 'C9v.5', id: 'cur-rounding-boundary', netlist: "* a balanced bridge whose middle nodes are at exactly 343.75 mV\nV1 top1 0 0.5\nR1 top1 a2 150\nR2 a2 0 330\nR3 top1 b3 15\nR4 b3 0 33\nR5 a2 m4 27\nR6 m4 m5 6.8k\nR7 m5 b3 820\n.options savecurrents\n.op\n.end\n", vectors: {"v(top1)": 0.5, "v(a2)": 0.3437499999999999, "v(b3)": 0.34375, "v(m4)": 0.34374999999999983, "v(m5)": 0.34375, "i(v1)": -0.011458333333333336, "i(@r1[i])": 0.0010416666666666675, "i(@r2[i])": 0.0010416666666666664, "i(@r3[i])": 0.010416666666666666, "i(@r4[i])": 0.010416666666666668, "i(@r5[i])": 2.05596856412066e-18, "i(@r6[i])": -2.4490213778496098e-20, "i(@r7[i])": 0} },
  { code: 'C9v.6', id: 'cur-rest-idle-source', netlist: "* a diode at rest, its source at 0 V, beside a 5 V source charging only a capacitor\nV1 in 0 0\nR1 in a 1k\nD1 a 0 dmod\nV2 x 0 5\nC1 x 0 1u\n.model dmod d\n.options savecurrents\n.op\n.end\n", vectors: {"v(in)": 0, "v(a)": 7.323378444748195e-29, "v(x)": 5, "i(v2)": 0, "i(v1)": 7.323378444748195e-32, "i(@r1[i])": -7.323378444748195e-32, "i(@d1[id])": 7.323378444748195e-41, "i(@c1[i])": 0} },
  { code: 'C9v.7', id: 'cur-op-r-sweep', netlist: "* two equal arms of three resistors and a link (C9m), .op and a sweep of R1\nV1 n1 0 9\nR1 n1 n2 15k\nR2 n2 n3 330\nR3 n3 0 33k\nR4 n1 n4 15k\nR5 n4 n5 330\nR6 n5 0 33k\nR7 n3 n5 100k\n.options savecurrents\n.op\n.dc R1 10k 20k 5k\n.end\n", vectors: {"res-sweep": [10000, 15000, 20000], "v(n1)": [9, 9, 9], "v(n2)": [6.877278362577043, 6.206703910614529, 5.6827369940333], "v(n3)": [6.807228548542084, 6.145251396648049, 5.62800215443485], "v(n4)": [6.268079719104217, 6.2067039106145225, 6.158746680760464], "v(n5)": [6.207977472924511, 6.145251396648042, 6.096239107737195], "i(v1)": [-0.0003944001824686815, -0.00037243947858473, -0.00035528003824763724], "i(@r1[i])": [0.00021227216374229574, 0.00018621973929236477, 0.00016586315029833498], "i(@r2[i])": [0.00021227216374229872, 0.00018621973929236395, 0.00016586315029833382], "i(@r3[i])": [0.00020627965298612374, 0.00018621973929236512, 0.00017054551983135908], "i(@r4[i])": [0.00018212801872638553, 0.00018621973929236517, 0.00018941688794930241], "i(@r5[i])": [0.00018212801872638333, 0.00018621973929236395, 0.00018941688794929979], "i(@r6[i])": [0.00018812052948256094, 0.00018621973929236493, 0.00018473451841627864], "i(@r7[i])": [0.000005992510756175733, 6.217248937900877e-20, -0.000004682369533023447]} },
  { code: 'C9v.8', id: 'cur-op-2src-sweep', netlist: "* the C9 bridge, .op and a sweep of two sources\nV1 top 0 9\nR1 top a 10k\nR2 a 0 10k\nR3 top b 4.7k\nR4 b 0 4.7k\nR5 a b 1k\nV2 x 0 1\nR6 x 0 1k\n.options savecurrents\n.op\n.dc V1 0 9 9 V2 0 1 1\n.end\n", vectors: {"v(v-sweep)": [0, 9, 0, 9], "v(top)": [0, 9, 0, 9], "v(a)": [0, 4.499999999999999, 0, 4.499999999999999], "v(b)": [0, 4.5, 0, 4.5], "v(x)": [0, 0, 1, 1], "i(v2)": [0, 0, -0.001, -0.001], "i(v1)": [0, -0.0014074468085106386, 0, -0.0014074468085106386], "i(@r1[i])": [0, 0.0004500000000000001, 0, 0.0004500000000000001], "i(@r2[i])": [0, 0.00044999999999999993, 0, 0.00044999999999999993], "i(@r3[i])": [0, 0.0009574468085106382, 0, 0.0009574468085106382], "i(@r4[i])": [0, 0.0009574468085106382, 0, 0.0009574468085106382], "i(@r5[i])": [0, -8.881784197001253e-19, 0, -8.881784197001253e-19], "i(@r6[i])": [0, 0, 0.001, 0.001]} },
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
  /** A line Explain says ngspice skips: an analysis in a subcircuit no X line uses (A3f). */
  const ignoredLine = (n: Netlist, i: number): boolean => (explainLine(n, i)?.notes[0] ?? '').startsWith('ngspice skips this line');

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

  it('a .tf in a subcircuit no X line uses is left out, as ngspice skips it; one an X line uses is the main circuit\'s (A3f)', () => {
    // Only the .tf v(out) after .ends runs: its numbers are v(out)'s, never named v(a,gnd).
    const sub = describeRun(fact('A3f').netlist, runs.get('an-tf-subckt')!);
    expect(plain(sub.words.tf?.transferFunction?.text)).toBe('v(out)/V1 = 0.5 (V/V)');
    expect(sub.words.tf?.at).toBe('at node out');
    expect(sub.words.warnings.map((w) => w.code)).not.toContain('tf-node-missing');
    expect(describeCircuit(sub.netlist)).toContain('Analysis: transfer function from V1 to v(out).');
    expect(explainLine(sub.netlist, 6)!.notes).toEqual(['ngspice skips this line: it is inside the subcircuit s (from line 5), and no X line uses that subcircuit. Put analysis lines in the main circuit, outside .subckt … .ends.']);
    // With nothing else, nothing runs, whatever the analysis.
    for (const id of ['an-tf-subckt-alone', 'an-op-subckt', 'an-dc-subckt', 'an-tran-subckt', 'an-ac-subckt', 'an-noise-subckt']) {
      const f = FACTS.find((x) => x.id === id)!;
      expect(runs.get(id)!.plots, id).toEqual([]);
      expect(describeCircuit(parseNetlist(f.netlist)), id).toContain('Its analysis lines are inside a subcircuit that no X line uses, where ngspice skips them, so ngspice will run nothing.');
      const line = parseNetlist(f.netlist).lines.findIndex((l) => l.directive && ['.tf', '.op', '.dc', '.tran', '.ac', '.noise'].includes(l.directive.name));
      expect(explainLine(parseNetlist(f.netlist), line)!.notes[0], id).toMatch(/^ngspice skips this line/);
    }
    // Used by an X line, the .tf is the main circuit's: v(out) is the main circuit's out (1/3, 333.3 Ω).
    const used = describeRun(FACTS.find((x) => x.id === 'an-tf-subckt-used')!.netlist, runs.get('an-tf-subckt-used')!);
    expect(plain(used.words.tf?.transferFunction?.text)).toBe('v(out)/V1 = 0.3333 (V/V)');
    expect(explainLine(used.netlist, 7)!.notes.join(' ')).not.toContain('ngspice skips this line');
    // Once for each X line that uses it.
    expect(runs.get('an-tf-subckt-twice')!.plots.filter((p) => /transfer function/i.test(p.plotname)).length).toBe(2);
  });

  it('every analysis line in a subcircuit no X line uses: the run\'s first message and the status line say why nothing ran (A3f, last pass F3)', () => {
    for (const id of ['an-tf-subckt-alone', 'an-op-subckt', 'an-dc-subckt', 'an-tran-subckt', 'an-ac-subckt', 'an-noise-subckt']) {
      const f = FACTS.find((x) => x.id === id)!;
      const d = describeRun(f.netlist, runs.get(id)!);
      const word = d.netlist.lines[6]!.directive!.token.text;
      const title = `${word} is inside the subcircuit s, which no X line uses`;
      expect([d.words.status, d.words.warnings[0]?.code, d.words.warnings[0]?.severity, d.words.warnings[0]?.title, d.words.warnings[0]?.line], id).toEqual(['failed', 'no-analysis', 'error', title, 7]);
      expect(d.words.warnings[0]?.why, id).toBe('ngspice skips an analysis line between .subckt and .ends when no X line uses that subcircuit, so it ran nothing, and with a results file it says nothing about it. Put analysis lines in the main circuit, outside .subckt … .ends.');
      expect(d.words.summary, id).toBe(`ngspice finished but gave no results: ${title}. Open the results for details.`);
    }
    // ngspice's note about V1 (an AC value alone is no DC value) comes after it: it is no reason.
    expect(describeRun(FACTS.find((x) => x.id === 'an-ac-subckt')!.netlist, runs.get('an-ac-subckt')!).words.warnings.map((m) => m.title)).toEqual(['.ac is inside the subcircuit s, which no X line uses', 'V1 has no value: 0 V']);
    // ngspice reads none of such a subcircuit's lines: a .tran and a dot command it stops at elsewhere say nothing there.
    expect(runs.get('an-skip-unused')!.stderr).not.toMatch(/TSTEP|unimplemented/);
  });

  it('a gnd in the v( ) of a .tf inside a subcircuit an X line uses is ground, as at the top level (A3g, last pass regress-2)', () => {
    const said = (id: string): Described => describeRun(FACTS.find((x) => x.id === id)!.netlist, runs.get(id)!);
    const main = said('an-tf-subckt-gnd');
    expect([main.words.tf?.at, plain(main.words.tf?.transferFunction?.text), main.words.warnings]).toEqual(['between node out and ground', 'v(out,gnd)/V1 = 0.3333 (V/V)', []]);
    expect(explainLine(main.netlist, 6)!.fields.find((f) => f.label === 'output')?.meaning).toBe('the output: the voltage at node out, measured from ground');
    // The subcircuit's own a is a new node with nothing on it (A3f): its warning only, never one for gnd.
    const a = said('an-tf-subckt-gnd-a');
    expect([a.words.tf?.at, a.words.warnings.map((m) => m.title)]).toEqual(['between node a and ground', ['a is not a node of the circuit']]);
    expect(said('an-tf-subckt-gnd-alone').words.tf?.at).toBe('at ground');
    expect(said('an-tf-subckt-gnd-beside').words.tf?.at).toBe('between node out and ground');
    for (const id of ['an-tf-subckt-gnd', 'an-tf-subckt-gnd-a', 'an-tf-subckt-gnd-alone', 'an-tf-subckt-gnd-beside']) {
      const d = said(id);
      const words = [d.words.summary, d.words.summarySpeech, ...d.words.warnings.map((m) => m.title), ...explainLine(d.netlist, d.netlist.analyses[0]!)!.fields.map((f) => f.meaning)].join(' ');
      expect(words, id).not.toMatch(/"gnd"|node gnd/);
    }
  });

  it('x1.m, ngspice\'s name for the node m inside the subcircuit X1 uses, is a node of the circuit, and Explain says which (A3h, last pass C3-6)', () => {
    const said = (id: string): Described => describeRun(FACTS.find((x) => x.id === id)!.netlist, runs.get(id)!);
    for (const id of ['an-tf-inner', 'an-tf-inner-caps', 'an-tf-inner-after-end', 'an-tf-inner-nested', 'an-tf-inner-outer']) {
      const d = said(id);
      expect([d.words.status, d.words.warnings.map((m) => m.code)], id).toEqual(['ok', []]);
      expect(checkTraps(d.netlist).filter((t) => t.id === 'tf-problems'), id).toEqual([]);
    }
    expect(plain(said('an-tf-inner').words.tf?.transferFunction?.text)).toBe('v(x1.m)/V1 = 0.5 (V/V)');
    expect(explainLine(said('an-tf-inner').netlist, 8)!.notes).toEqual(["x1.m is ngspice's name for node m of the subcircuit div (from line 4), inside X1: ngspice names a node inside a subcircuit by its X line, a dot and the node's own name."]);
    expect(explainLine(said('an-tf-inner-nested').netlist, 13)!.notes).toEqual(["x1.x2.m is ngspice's name for node m of the subcircuit inner (from line 9), inside X2, inside X1: ngspice names a node inside a subcircuit by its X lines, each followed by a dot, and the node's own name."]);
    // The names the .op gives the nodes inside: x1.n, and x1.x2.m inside X2.
    expect(said('an-op-inner-nested').words.nodes.map((n) => n.node)).toEqual(expect.arrayContaining(['x1.n', 'x1.x2.m']));
    // A part there, by ngspice's name for it: the input (V/V, and V/A for a current source) or the i( ) of a .tf.
    for (const [id, ratio] of [['an-tf-inner-input', 'v(out)/v.x1.vs = 0.3333 (V/V)'], ['an-tf-inner-current', 'i(v.x1.vs)/V1 = 3.333e-4 (A/V)'], ['an-tf-inner-isource', 'v(out)/i.x1.is = 500 (V/A)'], ['an-tf-inner-global-m', 'v(x1.m)/V1 = 0.5 (V/V)']] as const) {
      const d = said(id);
      expect([d.words.status, d.words.warnings.map((m) => m.code), plain(d.words.tf?.transferFunction?.text)], id).toEqual(['ok', [], ratio]);
      expect(checkTraps(d.netlist).filter((t) => t.id === 'tf-problems'), id).toEqual([]);
    }
    expect(explainLine(said('an-tf-inner-input').netlist, 10)!.notes).toEqual(["v.x1.vs is ngspice's name for Vs of the subcircuit div (from line 4), inside X1: ngspice names a part inside a subcircuit by its first letter, its X line and its own name, joined by dots."]);
    expect(checkTraps(said('an-tf-inner-current-plain').netlist).filter((t) => t.id === 'tf-problems').map((t) => t.title)).toEqual(['i(x1.vs) needs a voltage source']);
    // No node: a node of the .subckt line (x1.a), an X line only inside a subcircuit no X line uses (x2.m), a .global node (x1.vdd): 0 and 1 Ω.
    for (const [id, name] of [['an-tf-inner-port', 'x1.a'], ['an-tf-inner-unused', 'x2.m'], ['an-tf-inner-global', 'x1.vdd']] as const) {
      const d = said(id);
      expect(d.words.warnings.map((m) => m.title), id).toEqual([`${name} is not a node of the circuit`]);
      expect(checkTraps(d.netlist).filter((t) => t.id === 'tf-problems').map((t) => t.title), id).toEqual([`.tf asks about node ${name}, which is not in the circuit`]);
    }
  });

  it('.subckt and .ends lines that do not pair up stop ngspice before it skips a line, so nothing says it skips one (A3f, last pass critic1-1)', () => {
    const said = (id: string): Described => describeRun(FACTS.find((x) => x.id === id)!.netlist, runs.get(id)!);
    for (const id of ['an-skip-no-ends', 'an-skip-open-other', 'an-skip-extra-ends']) {
      const d = said(id);
      expect(d.words.warnings.map((m) => m.why), id).toEqual(['ngspice says: Error: Mismatch of .subckt ... .ends statements!']);
      expect(explainLine(d.netlist, 6)!.notes, id).toEqual([]);
      expect(describeCircuit(d.netlist), id).not.toMatch(/skip/);
    }
    // As ngspice counts: an .ends after .end pairs up, and it does not count .macro; the .op is skipped and nothing is said.
    for (const id of ['an-skip-ends-after-end', 'an-skip-macro-open']) {
      const d = said(id);
      expect(d.words.warnings[0]?.title, id).toBe('.op is inside the subcircuit s, which no X line uses');
      expect(explainLine(d.netlist, 6)!.notes[0], id).toMatch(/^ngspice skips this line/);
    }
  });

  it('a subcircuit only a skipped subcircuit\'s X line uses is skipped too: the first message says why, naming the X lines (A3f, last pass critic1-4)', () => {
    const said = (id: string): Described => describeRun(FACTS.find((x) => x.id === id)!.netlist, runs.get(id)!);
    const inner = 'inside the subcircuit inner, which only X2 uses, and X2 is inside the subcircuit outer';
    expect(said('an-skip-through').words.warnings.map((m) => [m.code, m.title, m.line])).toEqual([['no-analysis', `.op is ${inner}, which no X line uses`, 10]]);
    expect(said('an-skip-through-nested').words.warnings[0]?.title).toBe(`.op is ${inner}, which no X line uses`);
    expect(said('an-skip-through-two').words.warnings[0]?.title).toBe('.op is inside the subcircuit inner, which only X2 uses, and X2 is inside the subcircuit mid, which only X3 uses, and X3 is inside the subcircuit top, which no X line uses');
    expect(said('an-skip-through-several').words.warnings[0]?.title).toBe('.op is inside the subcircuit inner, which the main circuit does not use, directly or through other subcircuits');
    expect(said('an-skip-through-loop').words.warnings[0]?.title).toBe(`.op is ${inner}, which the main circuit does not use, directly or through other subcircuits`);
    // Lines in two subcircuits, one of them skipped only through outer: said for both, as one the main circuit does not use.
    const mixed = said('an-skip-through-mixed');
    expect([mixed.words.warnings[0]?.title, describeCircuit(mixed.netlist).endsWith('Its analysis lines are inside subcircuits that the main circuit does not use, directly or through other subcircuits, where ngspice skips them, so ngspice will run nothing.')]).toEqual(['The analysis lines are inside subcircuits that the main circuit does not use, directly or through other subcircuits', true]);
    // ngspice's note that V1 has no DC value comes second: it is no reason.
    expect(said('an-skip-through-ac').words.warnings.map((m) => [m.severity, m.title])).toEqual([['error', `.ac is ${inner}, which no X line uses`], ['note', 'V1 has no value: 0 V']]);
    // Used from the main circuit, through X1 and then X2, the .tf runs as the main circuit's: 1/3.
    const used = said('an-tf-subckt-through-used');
    expect([used.words.status, used.words.warnings, plain(used.words.tf?.transferFunction?.text)]).toEqual(['ok', [], 'v(out)/V1 = 0.3333 (V/V)']);
    // ngspice reads an .include in a subcircuit no X line uses all the same: it stops there (critic1-8).
    expect(said('an-skip-include').words.warnings[0]?.title).toBe('ngspice cannot find the file nosuchfile.cir');
  });

  it('the words name at most three steps out, of at most three X lines each, then say what holds; ngspice skips the line all the same (A3f, the integration check X2)', () => {
    const said = (id: string): Described => describeRun(FACTS.find((x) => x.id === id)!.netlist, runs.get(id)!);
    const steps = 'which only X1 uses, and X1 is inside the subcircuit s4, which only X1 uses, and X1 is inside the subcircuit s3, which only X1 uses, and X1 is inside the subcircuit s2';
    expect(said('an-skip-through-three').words.warnings[0]?.title).toBe('.op is inside the subcircuit inner, which only X1 uses, and X1 is inside the subcircuit s3, which only X1 uses, and X1 is inside the subcircuit s2, which only X1 uses, and X1 is inside the subcircuit s1, which no X line uses');
    const four = said('an-skip-through-four');
    expect([four.words.status, four.words.warnings[0]?.title]).toEqual(['failed', `.op is inside the subcircuit inner, ${steps}, which the main circuit does not use, directly or through other subcircuits`]);
    expect(explainLine(four.netlist, 18)!.notes).toEqual(['ngspice skips this line: it is inside the subcircuit inner (from line 17), which only X1 uses, and X1 is inside the subcircuit s4 (from line 14), which only X1 uses, and X1 is inside the subcircuit s3 (from line 11), which only X1 uses, and X1 is inside the subcircuit s2 (from line 8), which the main circuit does not use, directly or through other subcircuits. Put analysis lines in the main circuit, outside .subckt … .ends.']);
    expect(said('an-skip-through-three-x').words.warnings[0]?.title).toBe('.op is inside the subcircuit inner, which only X1, X2 and X3 use, and they are inside the subcircuit outer, which no X line uses');
    expect(said('an-skip-through-four-x').words.warnings[0]?.title).toBe('.op is inside the subcircuit inner, which the main circuit does not use, directly or through other subcircuits');
    // Used from the main circuit through the four steps, the .tf runs: 1/3, as native 47 and 42 give it.
    const used = said('an-skip-through-four-used');
    expect([used.words.status, used.words.warnings, plain(used.words.tf?.transferFunction?.text)]).toEqual(['ok', [], 'v(out)/V1 = 0.3333 (V/V)']);
  });

  it('a dot inside a name ngspice builds, and names that are no node or part of a subcircuit: x1.0, x1.gnd, i.x1.vs (A3h, last pass critic1-3, critic1-5)', () => {
    const said = (id: string): Described => describeRun(FACTS.find((x) => x.id === id)!.netlist, runs.get(id)!);
    const tfProblems = (d: Described): string[] => checkTraps(d.netlist).filter((t) => t.id === 'tf-problems').map((t) => t.title);
    for (const [id, ratio] of [['an-tf-inner-dotted', 'v(x1.m.1)/V1 = 0.5 (V/V)'], ['an-tf-inner-xdot', 'v(x1.a.m)/V1 = 0.5 (V/V)'], ['an-tf-inner-partdot', 'v(out)/v.x1.vs.1 = 0.3333 (V/V)'], ['an-tf-inner-nested-dot', 'v(x1.x2.m.1)/V1 = 0.25 (V/V)']] as const) {
      const d = said(id);
      expect([d.words.status, d.words.warnings.map((m) => m.code), plain(d.words.tf?.transferFunction?.text), tfProblems(d)], id).toEqual(['ok', [], ratio, []]);
    }
    expect(said('an-op-inner-dotted').words.nodes.map((n) => n.node)).toContain('x1.m.1');
    // A new node with nothing on it, natively 0 and 1 Ω: x1.m.1 beside m, ground's names after X1 (ground is the main circuit's).
    for (const [id, name] of [['an-tf-inner-dot-none', 'x1.m.1'], ['an-tf-inner-zero', 'x1.0'], ['an-tf-inner-gnd', 'x1.gnd']] as const) {
      const d = said(id);
      expect([d.words.warnings.map((m) => m.title), tfProblems(d)], id).toEqual([[`${name} is not a node of the circuit`], [`.tf asks about node ${name}, which is not in the circuit`]]);
    }
    // i.x1.vs: Vs is a voltage source, so its name starts with v; ngspice stops ("Transfer function source i.x1.vs not in circuit").
    expect(tfProblems(said('an-tf-inner-letter'))).toEqual([".tf's input i.x1.vs is not in the circuit"]);
    // A run ngspice stops for another reason gets that reason only, never the skipped lines' beside it.
    expect(said('an-skip-stopped').words.warnings.map((m) => m.code)).toEqual(['unknown-dot-command']);
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

  it('A2c: a + line after .end continues the last line before .end, so the copy leaves .options savecurrents out and says why; with .end moved to the bottom it has the line, 3 V and every current (the last pass, regress-3)', () => {
    const byId = (id: string): Fact => FACTS.find((f) => f.id === id)!;
    const names = (id: string): string[] => runs.get(id)!.plots.flatMap((p) => p.variables.map((v) => v.name)).sort();
    // As written, the run saves the current only in voltage sources (A1): none here, V1's there.
    expect(names('an-plus-after-end')).toEqual(['v(n1)']);
    expect(names('an-plus-after-end-vsource')).toEqual(['i(v1)', 'v(a)', 'v(b)']);
    // The copy PlainSpice runs is the netlist as written, with the note naming the + line and the line it continues.
    const s28 = byId('an-plus-after-end').netlist;
    expect(netlistToRun(parseNetlist(s28))).toEqual({ text: s28, added: [], notes: [RUN_COPY_WORDS.plusAfterEnd(6, 4)] });
    // The line added just before .end would take R1's place: 2 V, not 3 V (an-plus-after-end-added). The after-end
    // check's fix moves .end to the bottom; the copy then adds the line before it, and runs with 3 V and both currents.
    const trap = checkTraps(parseNetlist(s28)).find((t) => t.id === 'after-end')!;
    const moved = netlistToRun(parseNetlist(applyFix(s28, trap.fixes.find((f) => f.label === 'Move .end to the bottom')!)));
    expect([moved.added, moved.notes, moved.text]).toEqual([[SAVE_CURRENTS_LINE], [], byId('an-plus-after-end-moved').netlist]);
    // Explain says PlainSpice adds the line only where the copy does.
    const op = (text: string): string => explainLine(parseNetlist(text), 2)!.notes.join(' ');
    expect(op(s28)).not.toContain('adds that line');
    expect(op(applyFix(s28, trap.fixes[0]!))).toContain('PlainSpice adds that line to the copy it runs');
  });

  it('A2c, A2d, A2e: the copy says why the parts’ currents are missing exactly where the run saves none, and Explain’s .op line says "does not add" only there (the round-1 critic’s CR1-2; the round-2 critic’s CR2-1)', () => {
    const rows = FACTS.filter((f) => f.code === 'A2c' || f.code === 'A2d' || f.code === 'A2e');
    expect(rows.length).toBe(33);
    for (const f of rows) {
      const n = parseNetlist(f.netlist);
      const names = runs.get(f.id)!.plots.flatMap((p) => p.variables.map((v) => v.name));
      // A part's own current (i(@r1[i]), i(@i1[current])) comes only with .options savecurrents (A1, A2).
      const saved = names.some((name) => name.startsWith('i(@'));
      const { added, notes } = netlistToRun(n);
      expect(added, f.id).toEqual([]);
      expect(notes.length === 1 && notes[0]!.startsWith('PlainSpice did not add .options savecurrents'), f.id).toBe(!saved);
      const op = explainLine(n, n.analyses.find((i) => n.lines[i]!.directive!.name === '.op')!)!.notes.join(' ');
      expect(op.includes('does not add that line'), f.id).toBe(!saved);
      expect(op.includes('adds that line'), f.id).toBe(false);
    }
    // Which currents a run saves without the line depends on the parts: a B line with V= keeps its own (decision 0011's netlist).
    expect(runs.get('an-plus-after-end-b')!.plots.flatMap((p) => p.variables.map((v) => v.name)).sort()).toEqual(['i(b1)', 'i(v1)', 'v(a)', 'v(b)', 'v(c)']);
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
    // The why: the circuit makes the current 0, as its exact solution shows (decision 0015).
    expect(plain(note.why)).toContain('the two ends of R5, node a and node b, are at the same voltage, 4.5 V.');
    expect(note.why).toContain("Solved exactly, with fractions, from the netlist's values, the circuit makes it exactly 0, so PlainSpice shows 0 A.");
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

  it('C9h-C9j: a tiny real current flows on through the parts in series and side by side: shown as ngspice gives it, with no rounding-noise note, and the warning that ngspice\'s answers are off (critic of round 2, critic of round 3)', () => {
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
    // The messages they show, exactly (the critic of round 3: the warning they carry since round 2 was recorded nowhere).
    const why = (list: string): string => `Solved exactly, with fractions, from the netlist's values, ${list}. ngspice computes with about 16 significant digits, and solving this circuit loses most of them. PlainSpice shows ngspice's numbers as it gives them, so they may not agree with each other.`;
    const messages = (code: string): string[] => ofFact(code).words.warnings.map((m) => `${m.code}: ${plain(m.title)}: ${plain(m.why)}`);
    expect(messages('C9h')).toEqual([`imprecise-answers: Some of ngspice's answers here are off: ${why('V1 carries 2 aA, where ngspice gives 1.735 aA; and R1 carries 2 aA, where ngspice gives 1.776 aA')}`]);
    expect(messages('C9i')).toEqual([`imprecise-answers: Some of ngspice's answers here are off: ${why('V1 carries 120 fA, where ngspice gives 120.1 fA; and R1 carries 120 fA, where ngspice gives 120.1 fA')}`]);
    expect(messages('C9j')).toEqual([`imprecise-answers: Some of ngspice's answers here are off: ${why('R1 carries 1 aA, where ngspice gives 1.776 aA; R2 carries 1 aA, where ngspice gives 1.776 aA; and V1 carries 2 aA, where ngspice gives 3.469 aA')}`]);
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

describe('after the re-check of 12 November 2026: what the circuit makes exactly 0 is 0, and nothing else (C9m-C9r; decision 0015)', () => {
  /** Exactly, bit for bit, as in the block above. */
  const exactly = (code: string): void => {
    const f = fact(code);
    const r = runs.get(f.id)!;
    for (const [name, want] of Object.entries(f.vectors ?? {})) expect(vectorValues(r.plots, name), `${code} ${name}`).toEqual(Array.isArray(want) ? want : [want]);
  };
  /** The parts and nodes said as 0 because ngspice gave rounding noise of a 0. */
  const noise = (d: Described): string[] => [...d.words.currents.filter((c) => c.noise !== undefined).map((c) => c.name), ...d.words.nodes.filter((n) => n.noise !== undefined).map((n) => `node ${n.node}`)];
  const note = (d: Described): string => plain(d.words.warnings.find((m) => m.code === 'rounding-noise')?.why) ?? '';
  const lostNote = (d: Described): string => plain(d.words.warnings.find((m) => m.code === 'rounded-to-0')?.why) ?? '';
  /** The warning that ngspice's answers are off (opCheck 'imprecise'). */
  const offNote = (d: Described): string => plain(d.words.warnings.find((m) => m.code === 'imprecise-answers')?.why) ?? '';
  const node = (d: Described, name: string): string | undefined => plain(d.words.nodes.find((n) => n.node === name)?.text);

  it('C9m-C9v.8: our engine gives these values as native ngspice 47 does, to the last bit', () => {
    for (const code of ['C9m', 'C9m.2', 'C9n', 'C9n.2', 'C9n.3', 'C9n.4', 'C9n.5', 'C9o', 'C9o.2', 'C9o.3', 'C9o.4', 'C9o.5', 'C9p', 'C9p.2', 'C9p.3', 'C9p.4', 'C9p.5', 'C9p.6', 'C9q', 'C9r', 'C9r.2', 'C9s', 'C9s.2', 'C9s.3', 'C9s.4', 'C9s.5', 'C9t', 'C9t.2', 'C9t.3', 'C9t.4', 'C9n.6', 'C9r.3', 'C9t.5', 'C9t.6', 'C9t.7', 'C9t.8', 'C9t.9', 'C9t.10', 'C9t.11', 'C9u', 'C9u.2', 'C9u.3', 'C9u.4', 'C9u.5', 'C9u.6', 'C9u.7', 'C9u.8', 'C9v', 'C9v.2', 'C9v.3', 'C9v.4', 'C9v.5', 'C9v.6', 'C9v.7', 'C9v.8']) exactly(code);
  });

  it('C9m: two equal arms and a link: the link carries 0 A, though ngspice leaves its ends 7 and 9 steps of a double apart (spice S1)', () => {
    for (const [code, given] of [['C9m', 6.217248937900877e-20], ['C9m.2', -4.8446095620006835e-18]] as const) {
      const d = ofFact(code);
      expect(noise(d), code).toEqual(['R7']);
      expect(d.words.currents.find((c) => c.name === 'R7'), code).toMatchObject({ value: 0, noise: given, text: 'no current through R7' });
      expect(note(d), code).toContain('the two ends of R7, node n3 and node n5, are at the same voltage');
    }
  });

  it('C9n: a real voltage below 1 µV and the currents beside it are shown as ngspice gives them, with no noise note (noise N1); the wire\'s current ngspice gives as exactly 0 is the exact one, never "no current" (the critic of the re-check\'s fixes)', () => {
    const ladder = ofFact('C9n');
    expect(noise(ladder)).toEqual([]);
    expect([node(ladder, 'n3'), node(ladder, 'p'), node(ladder, 'n4')]).toEqual(['732.4 nV', '732.4 nV', '5.813 nV']);
    expect(plain(currentText(ladder, 'R6'))).toBe('61.04 nA from node n3 to ground through R6');
    expect(plain(currentText(ladder, 'Rvm'))).toBe('7.324e-19 A from node p to ground through Rvm');
    expect(note(ladder)).toBe('');
    expect(plain(currentText(ladder, 'Rw'))).toBe('7.324e-19 A from node n3 to node p through Rw');
    expect(ladder.words.currents.find((c) => c.name === 'Rw')!.given).toBe(0);
    expect(lostNote(ladder)).toContain('ngspice gave Rw exactly 0 A.');
    const divider = ofFact('C9n.2');
    expect([noise(divider), node(divider, 'mid'), node(divider, 'p'), plain(currentText(divider, 'Rp'))]).toEqual([[], '240 nV', '240 nV', '2.4e-27 A from node mid to node p through Rp']);
    const source = ofFact('C9n.3');
    expect([noise(source), node(source, 'top'), plain(currentText(source, 'R3')), plain(currentText(source, 'R1'))]).toEqual([[], '1 nV', '37.04 fA from node v to ground through R3', '1e-29 A from node top to node s through R1']);
  });

  it('C9n.4: a 1 nΩ wire in series with 10 MΩ carries 454.1 pA, which ngspice gives as exactly 0: PlainSpice shows the exact 454.1 pA, as R4 in series, with a note, never "no current"', () => {
    const d = ofFact('C9n.4');
    expect(roundingNoise(d.netlist, d.results).by).toBe('exact');
    expect(plain(currentText(d, 'R3'))).toBe('454.1 pA from node d2 to node p3 through R3');
    expect(plain(currentText(d, 'R4'))).toBe('454.1 pA from node p3 to ground through R4');
    expect(d.words.currents.find((c) => c.name === 'R3')).toMatchObject({ given: 0, across: 4.541390789483498e-19 });
    expect(note(d)).toBe('');
    expect(lostNote(d)).toBe(
      "ngspice gave R3 exactly 0 A. But a current flows through R3: the 4.541e-19 V across it is too small beside the 4.541 mV at its ends, node d2 and node p3, for ngspice's arithmetic (about 16 significant digits), so both ends come out as the same number. Solved exactly, with fractions, from the netlist's values, R3 carries 454.1 pA, so PlainSpice shows 454.1 pA.",
    );
  });

  it('C9o: noise of a 0 that a gain of 1e9 lifts to 193.5 pA is 0, with every part it drives; a real 5 mA at 0 V is kept, with no power (noise N2)', () => {
    const h = ofFact('C9o');
    expect(noise(h)).toEqual(['R5', 'Vm', 'H1', 'Rl', 'node out']);
    expect(note(h)).toContain('Rl -1.935098e-10 A and node out -1.935098e-07 V.');
    expect(note(h)).not.toContain('below 1 pA');
    expect(noise(ofFact('C9o.2'))).toEqual(['R5', 'E1', 'Rl', 'node out']);
    const fed = ofFact('C9o.3');
    expect(noise(fed)).toEqual(['R5', 'node out']);
    const e1 = fed.words.currents.find((c) => c.name === 'E1')!;
    expect([e1.value, e1.power]).toEqual([0.005000000000931323, undefined]);
  });

  it('C9p: the .tf ratio and the .dc points of the balanced bridge are 0, with ngspice\'s numbers in the note; a real 1e-18 V/V is kept (spice S8)', () => {
    expect(ofFact('C9p').words.tf!.transferFunction).toMatchObject({ value: 0, noise: -5.551115123125783e-17, text: 'v(a,b)/V1 = 0 (V/V)' });
    expect(ofFact('C9p.2').words.tf!.transferFunction).toMatchObject({ value: 0, noise: -2.710505431213761e-20 });
    const dc = ofFact('C9p.3');
    expect(dc.words.sweeps[0]!.final.find((f) => f.name === 'i(vm)')).toMatchObject({ value: 0, noise: -2.168404344971009e-19 });
    expect(Array.from(shownSweep(dc.netlist, dc.results)!.series.find((s) => s.name === 'i(vm)')!.values)).toEqual([0, 0, 0, 0]);
    expect(note(dc)).toContain('ngspice gave i(vm) -5.421011e-20 A at V1 = 3 V');
    const tiny = ofFact('C9p.4').words.tf!.transferFunction!;
    expect([tiny.value, tiny.noise]).toEqual([9.999999999999999e-19, undefined]);
  });

  it('C9q: the bridge fed by 2 aA: R5 is 0 A, the source and the arms keep their attoamps (noise N3)', () => {
    const d = ofFact('C9q');
    expect(noise(d)).toEqual(['R5']);
    expect(d.words.currents.find((c) => c.name === 'R5')!.noise).toBe(-7.888609052210118e-34);
    expect(plain(currentText(d, 'I1'))).toBe('2 aA from ground to node top through I1');
  });

  it('C9r: an F or a G that copies or reads a 0 into two loads side by side: every load is 0 A and node out 0 V (spice S3)', () => {
    expect(noise(ofFact('C9r'))).toEqual(['Vm', 'F1', 'R6', 'R7', 'node out']);
    expect(noise(ofFact('C9r.2'))).toEqual(['R5', 'G1', 'R6', 'R7', 'node out']);
    for (const code of ['C9r', 'C9r.2']) expect(roundingNoise(ofFact(code).netlist, ofFact(code).results).by, code).toBe('exact');
  });

  it('C9o.4: with a diode, whose current the exact solution leaves free, the H of 1 GΩ still makes exactly 0: out is 0 V and Rl carries 0 A, whatever current the diode carries (the critic of round 2)', () => {
    const d = ofFact('C9o.4');
    expect(roundingNoise(d.netlist, d.results).by).toBe('exact');
    expect(noise(d)).toEqual(['R5', 'Vm', 'H1', 'Rl', 'node out']);
    expect([node(d, 'out'), plain(currentText(d, 'Rl'))]).toEqual(['0 V', 'no current through Rl']);
    expect(d.words.nodes.find((n) => n.node === 'out')!.level).toBe(0);
    expect(note(d)).toContain("from the netlist's values, the circuit makes each of them exactly 0, whatever current its diodes carry, so PlainSpice shows 0 A and 0 V.");
  });

  it('C9o.5: with a line PlainSpice does not model exactly (ngspice\'s own gmin) the rule decides: out keeps ngspice\'s −931.3 pV, which E1 makes from the voltage between a and b, so R5 between them keeps ngspice\'s 8.882e-19 A, not 0 A with "its two ends at the same voltage" (the critic of round 2)', () => {
    const d = ofFact('C9o.5');
    expect(roundingNoise(d.netlist, d.results).by).toBe('rule');
    expect(noise(d)).toEqual([]);
    expect([node(d, 'out'), plain(currentText(d, 'R5')), plain(currentText(d, 'E1')), plain(currentText(d, 'Rl'))]).toEqual(['−931.3 pV', '8.882e-19 A from node b to node a through R5', '9.313 pA from node out to ground through E1', '9.313 pA from ground to node out through Rl']);
    expect(note(d)).toBe('');
  });

  it('C9p.5: a .dc point is judged at the value ngspice swept the source to: -1 1 0.1 reaches −1.39e-16 V, where v(a) is real; no noise, no note', () => {
    const d = ofFact('C9p.5');
    expect(d.results.dc!.scale.values[10]).toBe(-1.3877787807814457e-16);
    expect(shownSweep(d.netlist, d.results)).toBe(d.results.dc);
    expect(note(d)).toBe('');
  });

  it('C9s: ngspice\'s answers 4 % from the exact ones (a 1e-12 Ω wire), and 16.61 V for an exact 0 (a G of 1000 through a 1 nΩ wire): shown as ngspice gives them, by the rule, no noise, with a warning that gives the exact values', () => {
    const wire = ofFact('C9s');
    expect(roundingNoise(wire.netlist, wire.results).by).toBe('rule');
    expect([node(wire, 'a'), node(wire, 'm'), node(wire, 'b'), plain(currentText(wire, 'R5'))]).toEqual(['4.321 V', '4.321 V', '4.374 V', '53.56 µA from node b to node m through R5']);
    expect([noise(wire), note(wire)]).toEqual([[], '']);
    expect(offNote(wire)).toContain('R5 carries no current, where ngspice gives 53.56 µA;');
    const g = ofFact('C9s.2');
    expect(roundingNoise(g.netlist, g.results).by).toBe('rule');
    expect([node(g, 'g6'), plain(currentText(g, 'G1')), noise(g), note(g)]).toEqual(['16.61 V', '13.84 mA from ground to node g6 through G1', [], '']);
    expect(offNote(g)).toContain('node g6 is at 0 V, where ngspice gives 16.61 V;');
  });

  // After the critic of round 2 of the re-check's fixes (13 November 2026): every answer compared, .tf and .dc as the .op, and diodes.
  it('C9s.3 and C9s.4: a bridge at a few millivolts beside a 15 or 12 V source, where ngspice is off, is compared too: its 2.097 V and −82.78 mV are shown as ngspice gives them, never called rounding noise, with a warning', () => {
    const g = ofFact('C9s.3');
    expect(roundingNoise(g.netlist, g.results).by).toBe('rule');
    expect([node(g, 'g6'), plain(currentText(g, 'G1')), plain(currentText(g, 'R9')), noise(g), note(g)]).toEqual(['2.097 V', '1.747 mA from ground to node g6 through G1', '1.747 mA from node g6 to ground through R9', [], '']);
    expect(offNote(g)).toContain('node g6 is at 0 V, where ngspice gives 2.097 V; G1 carries no current, where ngspice gives 1.747 mA;');
    const e = ofFact('C9s.4');
    expect(roundingNoise(e.netlist, e.results).by).toBe('rule');
    expect([node(e, 'a'), node(e, 'out'), plain(currentText(e, 'E1')), noise(e), note(e)]).toEqual(['4.882 mV', '−82.78 mV', '8.278 µA from node out to ground through E1', [], '']);
    expect(offNote(e)).toContain('node out is at 0 V, where ngspice gives −82.78 mV; E1 carries no current, where ngspice gives 8.278 µA;');
  });

  it('C9s.5: the unbalanced bridge with a 1e-12 Ω wire: ngspice\'s Rw 0 A and R5 53.56 µA the other way are shown as it gives them, and the warning says both carry 46.46 µA', () => {
    const d = ofFact('C9s.5');
    expect(roundingNoise(d.netlist, d.results).by).toBe('rule');
    expect([plain(currentText(d, 'Rw')), plain(currentText(d, 'R5')), node(d, 'a')]).toEqual(['no current through Rw', '53.56 µA from node b to node m through R5', '4.321 V']);
    expect(d.words.currents.filter((c) => c.given !== undefined || c.noise !== undefined)).toEqual([]);
    expect(offNote(d)).toContain('R5 carries 46.46 µA, where ngspice gives 53.56 µA the other way; Rw carries 46.46 µA, where ngspice gives 0 A;');
  });

  it('C9p.6: the .tf of the bridge an H of 1 GΩ reads is 0 V/V beside its .op\'s 0 V at out: ngspice\'s −2.15e-8 is its rounding lifted by the gain', () => {
    const d = ofFact('C9p.6');
    expect(d.words.tf!.transferFunction).toMatchObject({ value: 0, noise: -2.1500237300155906e-8, text: 'v(out)/V1 = 0 (V/V)' });
    expect(node(d, 'out')).toBe('0 V');
  });

  it('C9n.5: at V1 = 1.5 V the sweep\'s words say R3\'s exact 454.1 pA, as the .op beside it, though ngspice gives 0 at every point', () => {
    const d = ofFact('C9n.5');
    expect(plain(currentText(d, 'R3'))).toBe('454.1 pA from node d2 to node p3 through R3');
    expect(d.words.sweeps[0]!.final.find((f) => f.name === 'i(@r3[i])')).toMatchObject({ value: 4.5413907894834974e-10, given: 0 });
    expect(Array.from(shownSweep(d.netlist, d.results)!.series.find((s) => s.name === 'i(@r3[i])')!.values)).toEqual([0, 1.5137969298278324e-10, 3.027593859655665e-10, 4.5413907894834974e-10]);
  });

  it('C9t: with a diode, whose current is left free, the E reading the balanced bridge still carries its real 5 mA at exactly 0 V: out 0 V, no power', () => {
    const d = ofFact('C9t');
    expect(roundingNoise(d.netlist, d.results).by).toBe('exact');
    expect([node(d, 'out'), plain(currentText(d, 'E1')), d.words.currents.find((c) => c.name === 'E1')!.power]).toEqual(['0 V', '5 mA from node out to ground through E1', undefined]);
    expect(noise(d)).toEqual(['R5', 'node out']);
  });

  it('C9t.2: a diode with exactly 0 V across it carries 0 A: the G reading the balanced bridge drives its resistors and the diode at 0 V, all exactly 0', () => {
    const d = ofFact('C9t.2');
    expect(roundingNoise(d.netlist, d.results).by).toBe('exact');
    expect(noise(d)).toEqual(['R5', 'G1', 'R6', 'R7', 'node out', 'node x']);
    // ngspice leaves the diode −1.23e-27 A (its gmin across ngspice's rounding of its 0 V).
    expect(d.results.op!.currents.find((c) => c.element === '@d1[id]')!.value).toBe(-1.2312373330778934e-27);
  });

  it('C9t.3: with a diode, a bridge 1e-13 off balance read by an H of 1 MΩ: h5\'s real −433.7 fV is shown as ngspice gives it, never 0 V; since the last pass with the warning, which names its exact −425.9 fV', () => {
    const d = ofFact('C9t.3');
    expect(roundingNoise(d.netlist, d.results).by).toBe('rule');
    expect([node(d, 'h5'), noise(d)]).toEqual(['−433.7 fV', []]);
    expect(offNote(d)).toContain('node h5 is at −425.9 fV, where ngspice gives −433.7 fV');
  });

  it('C9t.4: ngspice gives a diode\'s current as its last iteration\'s: with a 10 Ω series resistance, @d1[id] is 1.4e-4 off the 4.2647 mA that flows through R1 into it; the exact solution takes the current Kirchhoff\'s law gives it', () => {
    const d = ofFact('C9t.4');
    const id = d.results.op!.currents.find((c) => c.element === '@d1[id]')!.value;
    const r1 = d.results.op!.currents.find((c) => c.element === 'r1')!.value;
    expect(Math.abs(id - r1) / r1).toBeGreaterThan(1e-4);
    expect(roundingNoise(d.netlist, d.results).by).toBe('exact');
  });

  it('C9n.6: with a diode across V1, which changes nothing in the divider, R3\'s real 454.1 pA, which ngspice gives as 0, is shown exactly in the .op and at each point of the sweep', () => {
    const d = ofFact('C9n.6');
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'R3')), d.words.currents.find((c) => c.name === 'R3')!.given]).toEqual(['exact', '454.1 pA from node d2 to node p3 through R3', 0]);
    expect(d.words.sweeps[0]!.final.find((f) => f.name === 'i(@r3[i])')).toMatchObject({ value: 4.5413907894834974e-10, given: 0 });
    expect(Array.from(shownSweep(d.netlist, d.results)!.series.find((s) => s.name === 'i(@r3[i])')!.values)).toEqual([0, 1.5137969298278324e-10, 3.027593859655665e-10, 4.5413907894834974e-10]);
  });

  it('C9r.3: the rule gives an F its number back with the current it copies: F2 of 1 reading the Vm that F1\'s loads gave back shows 193.5 aA, not "copies a current that is 0"', () => {
    const d = ofFact('C9r.3');
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'Vm')), plain(currentText(d, 'F2')), plain(currentText(d, 'Vx')), noise(d)]).toEqual([
      'rule',
      'Vm measures 193.5 aA flowing from node b to node m',
      '193.5 aA from node y to ground through F2',
      'Vx measures 193.5 aA flowing from ground to node y',
      [],
    ]);
  });

  it('C9t.5: with a diode, the sweep is decided as the .op is, each diode\'s current free at each point: out is 0 V in the .op and at V1 = 9 V in the sweep, where ngspice gives −193.5 nV; the diode\'s own −9.01 pA stays', () => {
    const d = ofFact('C9t.5');
    const last = (name: string) => d.words.sweeps[0]!.final.find((f) => f.name === name)!;
    expect([node(d, 'out'), plain(last('v(out)').text), last('v(out)').noise, plain(last('i(@rl[i])').text), plain(last('i(@d1[id])').text)]).toEqual(['0 V', 'v(out) = 0 V', -1.9350975899792844e-7, 'i(@rl[i]) = 0 A', 'i(@d1[id]) = −9.01 pA']);
    expect(Array.from(shownSweep(d.netlist, d.results)!.series.find((s) => s.name === 'v(out)')!.values)).toEqual([0, 0, 0, 0]);
  });

  it('C9t.6: a diode with 0 V across it at one point of the sweep carries 0 A there only: at V2 = 0 V, the .op\'s point, R7 and x are 0, as in the .op; at 1 and 2 V they keep ngspice\'s real 1.387 and 2.01 pA', () => {
    const d = ofFact('C9t.6');
    expect([plain(currentText(d, 'R7')), node(d, 'x')]).toEqual(['no current through R7', '0 V']);
    const shown = (name: string): number[] => Array.from(shownSweep(d.netlist, d.results)!.series.find((s) => s.name === name)!.values);
    expect([shown('i(@r7[i])'), shown('v(x)'), shown('i(@r6[i])')]).toEqual([
      [0, 1.3866232302623201e-12, 2.009998735343814e-12],
      [0, 1.38662323026232e-9, 2.009998735343814e-9],
      [0, 0, 0],
    ]);
  });

  it('C9t.7: a diode\'s current is taken at the node whose law ngspice\'s rounding leaves nearest 0 (here ground, not the 1 nΩ wire\'s node): no warning claims d2 is at 4.542 mV; since the last pass the warning names R3\'s 867.4 pA for 454.1 pA, which no floor excuses', () => {
    const d = ofFact('C9t.7');
    expect([roundingNoise(d.netlist, d.results).by, node(d, 'd2'), plain(currentText(d, 'R3'))]).toEqual(['rule', '4.541 mV', '867.4 pA from node d2 to node p3 through R3']);
    expect(offNote(d)).toBe("Solved exactly, with fractions, from the netlist's values, R3 carries 454.1 pA, where ngspice gives 867.4 pA. ngspice computes with about 16 significant digits, and solving this circuit loses most of them. PlainSpice shows ngspice's numbers as it gives them, so they may not agree with each other.");
  });

  it('C9t.8: with a diode, the warning that ngspice\'s answers are off names only the values no diode\'s current changes: Rw and R5, which the balanced bridge makes 0 whatever top is', () => {
    const d = ofFact('C9t.8');
    expect(offNote(d)).toBe("Solved exactly, with fractions, from the netlist's values, Rw carries no current, where ngspice gives 55.51 µA; and R5 carries no current, where ngspice gives 2.404 µA. ngspice computes with about 16 significant digits, and solving this circuit loses most of them. PlainSpice shows ngspice's numbers as it gives them, so they may not agree with each other.");
  });

  it('C9t.9: at V1 = 0 V, where the circuit makes every value 0, ngspice\'s Newton leftovers (−7.4e-25 V at a and b) are shown as 0; R5, 0 because the two diodes, placed alike, carry the same current, is 0 at every point, ngspice\'s 4.441e-19 A at 3 V too (the critic of round 3)', () => {
    const d = ofFact('C9t.9');
    const shown = (name: string): number[] => Array.from(shownSweep(d.netlist, d.results)!.series.find((s) => s.name === name)!.values);
    expect([shown('v(a)')[0], shown('v(b)')[0], shown('i(@r5[i])')]).toEqual([0, 0, [0, 0, 0, 0]]);
    expect(d.results.dc!.series.find((s) => s.name === 'i(@r5[i])')!.values[1]).toBe(4.440892098500626e-19);
  });

  it('C9t.10: ngspice settles on a current around a loop of a diode and 2.2 MΩ that nothing drives; a diode taken as carrying 0 A must carry less than 1 pA by ngspice\'s numbers, so the rule decides: R21 shows ngspice\'s 308.4 nA, not "rounding noise" beside d20 at 100.7 V', () => {
    const d = ofFact('C9t.10');
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'R21')), node(d, 'd20'), noise(d)]).toEqual(['rule', '308.4 nA from node d20 to node top1 through R21', '100.7 V', []]);
  });

  it('C9t.11: a .tf of a circuit with a diode is left as ngspice gives it: the diode\'s conductance unbalances the bridge for a change of V1, so v(a,b)/V1 = 2.994e-10 V/V is real, though the circuit with the diode at 0 A makes it exactly 0', () => {
    const d = ofFact('C9t.11');
    expect([roundingNoise(d.netlist, d.results).by, d.words.tf!.transferFunction!.value, d.words.tf!.transferFunction!.noise, plain(d.words.tf!.transferFunction!.text)]).toEqual(['exact', 2.994011705226285e-10, undefined, 'v(a,b)/V1 = 2.994e-10 (V/V)']);
  });
  it('C9u: a diode\'s I-V sweep from 0 V: the .op, at rest, and the sweep\'s 0 V point show ngspice\'s Newton leftovers as 0, both notes saying D1 has 0 V across it, so it carries no current (the critic of round 3)', () => {
    const d = ofFact('C9u');
    expect([roundingNoise(d.netlist, d.results).by, node(d, 'a'), plain(currentText(d, 'R1')), noise(d)]).toEqual(['exact', '0 V', 'no current through R1', ['V1', 'R1', 'node a']]);
    expect(note(d)).toContain('the circuit makes each of them exactly 0 (D1 has 0 V across it, so it carries no current), so PlainSpice shows 0 A and 0 V.');
    expect(Array.from(shownSweep(d.netlist, d.results)!.series.find((s) => s.name === 'v(a)')!.values)[0]).toBe(0);
  });

  it('C9u.2: an open-loop E making 1.2 MV beside the bridge of C9s.4 no longer hides ngspice\'s 4.882 mV for 5.189 mV: ngspice\'s numbers with the warning, not R5 as 0 A at "the same voltage, 5.189 mV"', () => {
    const d = ofFact('C9u.2');
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'R5')), note(d)]).toEqual(['rule', '82.78 nA from node b to node m through R5', '']);
    expect(plain(d.words.warnings.find((m) => m.code === 'imprecise-answers')!.why)).toContain('node a is at 5.189 mV, where ngspice gives 4.882 mV');
  });

  it('C9u.3: two equal diode arms: the diodes, placed alike, carry the same current, so the link and its ammeter carry exactly 0, with a note that says so', () => {
    const d = ofFact('C9u.3');
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'R5')), noise(d)]).toEqual(['exact', 'no current through R5', ['R5', 'Vm']]);
    expect(note(d)).toContain('the circuit makes each of them exactly 0 (D1 and D2, placed alike in the circuit, carry the same current), so PlainSpice shows 0 A.');
  });

  it('C9u.4 and C9u.5: beside a sweep of the temperature both the .op and the sweep are decided exactly, R5 0 at every point; beside a sweep of a resistor the .op is decided exactly and the sweep at its point at the .op\'s own state, R5 = 1 kΩ, the other points left as ngspice gives them (the critic of round 4)', () => {
    const t = ofFact('C9u.4');
    expect([roundingNoise(t.netlist, t.results).by, Array.from(shownSweep(t.netlist, t.results)!.series.find((s) => s.name === 'i(@r5[i])')!.values)]).toEqual(['exact', [0, 0, 0]]);
    const r = ofFact('C9u.5');
    expect([roundingNoise(r.netlist, r.results).by, Array.from(shownSweep(r.netlist, r.results)!.series.find((s) => s.name === 'i(@r5[i])')!.values), plain(currentText(r, 'R5'))]).toEqual(['exact', [0, -5.921189464667501e-19, -4.440892098500626e-19], 'no current through R5']);
    expect(note(r)).toContain('Solved exactly, with fractions, from the netlist\'s values, the circuit makes it exactly 0, so PlainSpice shows 0 A.');
    expect(plain(r.words.warnings.filter((m) => m.code === 'rounding-noise')[1]!.why)).toContain('ngspice gave i(@r5[i]) -8.881784e-19 A at R5 = 1 kΩ.');
  });

  it('C9u.6: ngspice gives the 1 aA of a loop as exactly 0 in V1 and R1, every other value exact: decided exactly, both shown at their exact 1 aA with the rounded-to-0 note, no warning', () => {
    const d = ofFact('C9u.6');
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'V1')), plain(currentText(d, 'R1')), plain(currentText(d, 'I1'))]).toEqual(['exact', '1 aA from node top1 to ground through V1', '1 aA from node i2 to node top1 through R1', '1 aA from ground to node i2 through I1']);
    expect(d.words.warnings.map((m) => m.code)).toEqual(['rounded-to-0']);
  });

  it('C9u.7 and C9u.8: the warning names a2, which the diode moves by 5 nV where ngspice is 0.26 mV off; and a 1 nΩ probe wire on a ladder is caught, ngspice\'s 43.55 fV for 43.56 fV', () => {
    const d = ofFact('C9u.7');
    expect(roundingNoise(d.netlist, d.results).by).toBe('rule');
    expect(plain(d.words.warnings.find((m) => m.code === 'imprecise-answers')!.why)).toContain('node a2 is at 62.75 mV, where ngspice gives 63.01 mV');
    const p = ofFact('C9u.8');
    expect(roundingNoise(p.netlist, p.results).by).toBe('rule');
    expect(plain(p.words.warnings.find((m) => m.code === 'imprecise-answers')!.why)).toContain('node p22 is at 43.56 fV, where ngspice gives 43.55 fV');
  });

  const warning = (d: Described): string | undefined => plain(d.words.warnings.find((m) => m.code === 'imprecise-answers')?.why);
  const shownSeries = (d: Described, name: string): number[] => Array.from(shownSweep(d.netlist, d.results)!.series.find((s) => s.name === name)!.values);
  const givenSeries = (d: Described, name: string): number[] => Array.from(d.results.dc!.series.find((s) => s.name === name)!.values);

  it('C9v: a comparator pulled up to the bridge\'s rail moves the rail\'s current, not the bridge: ngspice\'s 4.961 mV for 5.189 mV is shown with the warning, R5 its 61.5 nA, and no noise note (the critic of round 4)', () => {
    const d = ofFact('C9v');
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'R5')), note(d)]).toEqual(['rule', '61.5 nA from node b to node m through R5', '']);
    expect(warning(d)).toContain('R5 carries no current, where ngspice gives 61.5 nA; R2 carries 518.9 nA, where ngspice gives 496.1 nA; node a is at 5.189 mV, where ngspice gives 4.961 mV');
  });

  it('C9v.2: a diode\'s I-V curve fed by a current source swept from 0: the .op and the sweep\'s first point, at rest, show ngspice\'s leftovers as 0, each point\'s diode current worked out with I1 at that point', () => {
    const d = ofFact('C9v.2');
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'R1')), shownSeries(d, 'v(a)')[0]]).toEqual(['exact', 'no current through R1', 0]);
    expect(note(d)).toContain('(D1 has 0 V across it, so it carries no current)');
  });

  it('C9v.3 to C9v.5: an answer is off where the page draws it with other digits: V1\'s 372.4098 µA for 372.4395 µA is drawn alike, so R7 is 0 with the note; a2 and m4 drawn 64.62 mV beside b3\'s 64.63 mV, all three at one voltage, get the warning; at exactly 343.75 mV, a rounding boundary, ngspice\'s numbers a step apart get none', () => {
    const digits = ofFact('C9v.3');
    expect([roundingNoise(digits.netlist, digits.results).by, plain(currentText(digits, 'R7')), warning(digits)]).toEqual(['exact', 'no current through R7', undefined]);
    const split = ofFact('C9v.4');
    expect([roundingNoise(split.netlist, split.results).by, plain(currentText(split, 'R6'))]).toEqual(['rule', '210.2 pA from node b3 to node m4 through R6']);
    expect(warning(split)).toContain('R6 carries no current, where ngspice gives 210.2 pA; node a2 is at 64.63 mV, where ngspice gives 64.62 mV; and node m4 is at 64.63 mV, where ngspice gives 64.62 mV.');
    const boundary = ofFact('C9v.5');
    expect([roundingNoise(boundary.netlist, boundary.results).by, warning(boundary), plain(currentText(boundary, 'R6'))]).toEqual(['exact', undefined, 'no current through R6']);
  });

  it('C9v.6: a diode at rest beside a 5 V source charging only a capacitor is a circuit at rest: ngspice\'s leftovers are 0, x keeps its 5 V', () => {
    const d = ofFact('C9v.6');
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'R1')), plain(currentText(d, 'V1'))]).toEqual(['exact', 'no current through R1', 'V1 measures no current']);
    expect(plain(d.words.nodes.find((n) => n.node === 'x')!.text)).toBe('5 V');
    expect(note(d)).toContain('(D1 has 0 V across it, so it carries no current)');
  });

  it('C9v.7 and C9v.8: beside a sweep of a resistor or of two sources, the .op is decided exactly, and so is the sweep\'s point at the .op\'s own state (R1 = 15 kΩ; V1 = 9 V, V2 = 1 V), the others left as ngspice gives them', () => {
    const r = ofFact('C9v.7');
    expect([roundingNoise(r.netlist, r.results).by, plain(currentText(r, 'R7'))]).toEqual(['exact', 'no current through R7']);
    const r7 = givenSeries(r, 'i(@r7[i])');
    expect(shownSeries(r, 'i(@r7[i])')).toEqual([r7[0], 0, r7[2]]);
    expect(plain(r.words.warnings.filter((m) => m.code === 'rounding-noise')[1]!.why)).toContain('ngspice gave i(@r7[i]) 6.217249e-20 A at R1 = 15 kΩ.');
    const two = ofFact('C9v.8');
    expect([roundingNoise(two.netlist, two.results).by, plain(currentText(two, 'R5'))]).toEqual(['exact', 'no current through R5']);
    const r5 = givenSeries(two, 'i(@r5[i])');
    expect(shownSeries(two, 'i(@r5[i])')).toEqual([r5[0], r5[1], r5[2], 0]);
    expect(plain(two.words.warnings.filter((m) => m.code === 'rounding-noise')[1]!.why)).toContain('at V1 = 9 V, V2 = 1 V.');
  });
});

describe('after the last pass (13 November 2026)', () => {
  it('C9w.4: a G that the circuit makes 0 A, whose own rounding lifts node g to 1.465 mV for 820 µV, keeps ngspice\'s 444.1 pA, with the warning; it was drawn "no current" beside it, the floor excusing node g', () => {
    const d = ofFact('C9w.4');
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'G1')), plain(d.words.nodes.find((n) => n.node === 'g')?.text)]).toEqual(['rule', '444.1 pA from ground to node g through G1', '1.465 mV']);
    expect(plain(d.words.warnings.find((m) => m.code === 'imprecise-answers')?.why)).toContain('G1 carries no current, where ngspice gives 444.1 pA; R1 carries no current, where ngspice gives 4.441e-31 A; node g is at 820 µV, where ngspice gives 1.465 mV; and R3 carries 1 nA, where ngspice gives 1.786 nA.');
  });

  it('C9w.5: a 1 µΩ wire into two 0 V ammeters leaves 1.07e-7 of the equations, within what the spread of its conductances allows; every answer drawn with its exact digits, R7 is 0 A with the note', () => {
    const d = ofFact('C9w.5');
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'R7'))]).toEqual(['exact', 'no current through R7']);
  });

  it('C9w.6: with a .save line, the values ngspice gives are judged by the page\'s digits: R7 0 A with the note', () => {
    const d = ofFact('C9w.6');
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'R7'))]).toEqual(['exact', 'no current through R7']);
  });

  it('C9w.7: a sweep whose checked point ngspice gives with other digits (R3 433.7 pA for 340.6 pA) is shown as ngspice gives it, with the warning, but at its last point, 1.5000000000000846 V, the .op\'s own state, which shows R3\'s exact 454.1 pA as the .op beside it does (it showed 0 A there)', () => {
    const d = ofFact('C9w.7');
    const r3 = Array.from(shownSweep(d.netlist, d.results)!.series.find((s) => s.name === 'i(@r3[i])')!.values);
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'R3')), plain(formatSI(r3[r3.length - 1]!, 'A')), r3[r3.length - 2]]).toEqual(['exact', '454.1 pA from node d2 to node p3 through R3', '454.1 pA', 0]);
    expect(plain(d.words.warnings.find((m) => m.title === "Some of ngspice's answers in the DC sweep are off")?.why)).toContain('at V1 = 1.125 V, R3 carries 340.6 pA, where ngspice gives 433.7 pA. ngspice computes with about 16 significant digits, and solving this circuit loses most of them there. PlainSpice shows the sweep as ngspice gives it, but at ngspice\'s point nearest the operating point\'s 1.5 V, 1.5000000000000846 V (its 250 µV step added up in doubles), where it shows what the operating point shows');
  });

  it('C9w.8: beside a reverse diode, whose leak only ngspice\'s numbers give, the rule\'s tiny values keep the note that they may be noise, but the 1 nV divider\'s 500 fA, real whatever the diode carries, is left out of it', () => {
    const d = ofFact('C9w.8');
    expect([roundingNoise(d.netlist, d.results).by, d.words.warnings.some((m) => m.code === 'imprecise-answers'), plain(currentText(d, 'R7'))]).toEqual(['rule', false, '500 fA from node n1 to node n2 through R7']);
    const maybe = d.words.warnings.find((m) => m.code === 'maybe-noise')!;
    expect(plain(maybe.title)).toBe('3 currents and 3 node voltages may be rounding noise');
    expect(plain(maybe.why)).toMatch(/^ngspice gave R3 4\.249949e-18 A, V2 5\.099939e-13 A, R5 5\.099939e-13 A, node d3 5\.099939e-13 V and 2 more node voltages, each in the tables above\. /);
  });

  it('C9w.9: a 1 nΩ wire into two 0 V ammeters in series, which ngspice gives 10.97 mA beside the wire\'s 10.98 mA, is shown as ngspice gives it with the warning; it was decided by the rule with nothing said', () => {
    const d = ofFact('C9w.9');
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'Vm1')), plain(d.words.nodes.find((n) => n.node === 'c')?.text)]).toEqual(['rule', 'Vm1 measures 10.97 mA flowing from node b to node c', '8.999 V']);
    expect(plain(d.words.warnings.find((m) => m.code === 'imprecise-answers')?.why)).toContain('V1 carries 10.98 mA, where ngspice gives 10.97 mA; Vm1 carries 10.98 mA, where ngspice gives 10.97 mA;');
  });

  it('C9w.10: a .tf ratio ngspice gives as exactly 0 beside an .op decided exactly is the exact 3.028e-19 V/V, with a note; it read "0 V/V" beside R3\'s card, "V(d2) − V(p3) = 4.541e-19 V" (tf-lost-ratio-contradiction)', () => {
    const d = ofFact('C9w.10');
    const q = d.words.tf!.transferFunction!;
    expect([roundingNoise(d.netlist, d.results).by, plain(q.text), q.given, plain(currentText(d, 'R3'))]).toEqual(['exact', 'v(d2,p3)/V1 = 3.028e-19 (V/V)', 0, '454.1 pA from node d2 to node p3 through R3']);
    const lost = d.words.warnings.find((m) => m.code === 'rounded-to-0' && m.title === 'The transfer function is not 0, though ngspice gave 0')!;
    expect(plain(lost.why)).toBe("ngspice gave v(d2,p3)/V1 as exactly 0. The ratio is too small beside the larger numbers ngspice works it out from for its arithmetic (about 16 significant digits), so it comes out as 0. Solved exactly, with fractions, from the netlist's values, it is 3.028e-19 V/V, so PlainSpice shows 3.028e-19 V/V.");
  });

  it('C9w.11: a .tf alone, with nothing beside it decided exactly, keeps ngspice\'s 0 V/V, with the warning that names the exact 1e-18 V/V', () => {
    const d = ofFact('C9w.11');
    const q = d.words.tf!.transferFunction!;
    expect([q.value, q.given, q.exact]).toEqual([0, undefined, 1e-18]);
    expect(plain(d.words.warnings.find((m) => m.title === "ngspice's transfer function is off")?.why)).toContain('v(top,s)/V1 is 1e-18 V/V, where ngspice gives 0 V/V.');
  });

  it('C9w.12: a .tf ratio ngspice gives as 1.11e-16 V/V, one step of a double at 5 V, where the circuit makes −2.656e-20 V/V, is shown with the warning; it was shown with nothing said', () => {
    const d = ofFact('C9w.12');
    expect(plain(d.words.tf!.transferFunction!.text)).toBe('v(m7,m8)/V1 = 1.11e-16 (V/V)');
    expect(plain(d.words.warnings.find((m) => m.title === "ngspice's transfer function is off")?.why)).toContain('v(m7,m8)/V1 is −2.656e-20 V/V, where ngspice gives 1.11e-16 V/V.');
  });

  it('C9w.13 and C9w.14: beside an .op the rule decides (a .param line; a transistor), the sweep\'s point at the .op\'s own 9 V shows the .op\'s 0 for R5, with a note; it gave −8.882e-19 A beside "R5: no current"; the .tf, a slope, stays ngspice\'s', () => {
    for (const code of ['C9w.13', 'C9w.14']) {
      const d = ofFact(code);
      const r5 = Array.from(shownSweep(d.netlist, d.results)!.series.find((s) => s.name === 'i(@r5[i])')!.values);
      expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'R5')), r5], code).toEqual(['rule', 'no current through R5', [0, 0, 0, 0]]);
      expect(plain(d.words.warnings.find((m) => m.title === 'i(@r5[i]) is shown as 0 at some points of the DC sweep')?.why), code).toBe("ngspice gave i(@r5[i]) -8.881784e-19 A at V1 = 9 V. At V1 = 9 V, the operating point's own state, ngspice gives it the very number the operating point shows as 0, as the operating point's note says. So PlainSpice shows 0 there too, in these words and in the Plot panel; at the other points the sweep is as ngspice gives it.");
    }
    expect(plain(ofFact('C9w.14').words.tf!.transferFunction!.text)).toBe('v(a,b)/V1 = −5.551e-17 (V/V)');
  });

  it('C9w: a .temp line, a SIN beside V1\'s DC value and m=1 on R5 leave the bridge\'s doubles as they are, and PlainSpice models them exactly: Vm is 0 A with the note, where the rule drew "Vm measures 2.168e-19 A" beside "R5: no current" (regress-1)', () => {
    const d = ofFact('C9w');
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'Vm')), plain(currentText(d, 'R5'))]).toEqual(['exact', 'Vm measures no current', 'no current through R5']);
    expect(plain(d.words.warnings.find((m) => m.code === 'rounding-noise')?.why)).toContain('every other current at node m is 0, and the currents at a node add up to 0. Solved exactly, with fractions');
  });

  it('C9w.2: by the rule, a source whose only partner at a node is a resistor ngspice gives exactly 0 A, its two ends one double, carries 0: Vm is 0 A with the rule\'s note', () => {
    const d = ofFact('C9w.2');
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'Vm'))]).toEqual(['rule', 'Vm measures no current']);
    expect(plain(d.words.warnings.find((m) => m.code === 'rounding-noise')?.why)).toContain("It is below 1 pA, ngspice's current tolerance (its abstol option), so PlainSpice shows 0 A.");
    expect(d.words.warnings.some((m) => m.code === 'maybe-noise')).toBe(false);
  });

  it('C9w.3: by the rule, Vm\'s real 7.324e-19 A after a 1 µΩ wire ngspice gives 0 A is given back at the meter\'s node; node q, the very double of n3, is real, so Rvm\'s q / 1 TΩ is proven real, and Vm in series with it: no note calls them maybe noise (it did, beside q\'s real 732.4 nV); and the wire carries what Vm carries, by Kirchhoff\'s law at node p, with the note (it was drawn "no current", the critic of round 2)', () => {
    const d = ofFact('C9w.3');
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'Vm')), plain(currentText(d, 'Rvm')), plain(currentText(d, 'Rw'))]).toEqual(['rule', 'Vm measures 7.324e-19 A flowing from node p to node q', '7.324e-19 A from node q to ground through Rvm', '7.324e-19 A from node n3 to node p through Rw']);
    expect(d.words.warnings.some((m) => m.code === 'maybe-noise')).toBe(false);
    expect(plain(d.words.warnings.find((m) => m.code === 'rounded-to-0')?.why)).toContain('But Vm, the only other part at node p, carries 7.324e-19 A, and the currents at a node add up to 0, so Rw carries 7.324e-19 A too.');
  });

  it('C8b: a sweep\'s words name a transistor\'s currents by their terminals, as ngspice\'s devhelp describes them, never "the current in Q1" four times', () => {
    const f = FACTS.find((x) => x.id === 'cur-transistor-terminals-dc')!;
    const speech = describeRun(f.netlist, runs.get(f.id)!).words.sweeps[0]!.speech;
    for (const said of ['the collector current of Q1 is 8.171 milliamps', 'the emitter current of Q1 is minus 8.253 milliamps', 'the base current of Q1 is 81.71 microamps', 'the substrate current of Q1 is 828.6 femtoamps', 'the drain current of M1 is 500 microamps', 'the source current of M1 is minus 500 microamps', 'the bulk current of M1 is minus 8.51 picoamps', 'the gate current of J1 is minus 7.77 picoamps', 'the gate-to-drain current of J1 is minus 7.26 picoamps'])
      expect(speech).toContain(said);
    expect(speech).not.toMatch(/the current in (Q1|M1|J1)\b/);
  });

  it('C8b: a transistor inside a subcircuit, which ngspice names q.x1.q1 and m.x2.x3.m1, is named by its terminals too: "the collector current of q.x1.q1", never "the current in q.x1.q1" four times', () => {
    const f = FACTS.find((x) => x.id === 'cur-transistor-subckt-dc')!;
    const speech = describeRun(f.netlist, runs.get(f.id)!).words.sweeps[0]!.speech;
    for (const said of ['the collector current of q.x1.q1 is 1 milliamp', 'the substrate current of q.x1.q1 is 5 picoamps', 'the drain current of m.x2.x3.m1 is 500 microamps', 'the current in v.x2.x3.vg is 0 amps']) expect(speech).toContain(said);
    expect(speech).not.toMatch(/the current in (q|m)\.x/);
  });

  const ofId = (id: string): Described => describeRun(FACTS.find((x) => x.id === id)!.netlist, runs.get(id)!);
  const why = (d: Described, code: string): string | undefined => plain(d.words.warnings.find((m) => m.code === code)?.why);

  it('C9x: an op-amp as an E of high gain is never decided by the rule with nothing said: out 9.5 V and −999.9 mV are shown with the warning that names 9.15 V and −1 V; the balanced one\'s out, exactly 0 V, is 0 V with the note (the critic of the last pass\'s fixes)', () => {
    const non = ofId('cur-opamp-e15');
    expect([roundingNoise(non.netlist, non.results).by, plain(non.words.nodes.find((n) => n.node === 'out')?.text)]).toEqual(['rule', '9.5 V']);
    expect(why(non, 'imprecise-answers')).toContain('R2 carries 15 mA, where ngspice gives 15.9 mA; E1 carries 38.46 mA, where ngspice gives 40.26 mA; Rl carries 23.46 mA, where ngspice gives 24.36 mA; and node out is at 9.15 V, where ngspice gives 9.5 V.');
    expect(why(ofId('cur-opamp-diff-e12'), 'imprecise-answers')).toContain('node out is at −1 V, where ngspice gives −999.9 mV;');
    const bal = ofId('cur-opamp-balanced-e9');
    expect([roundingNoise(bal.netlist, bal.results).by, plain(bal.words.nodes.find((n) => n.node === 'out')?.text), bal.words.currents.find((c) => c.name === 'E1')?.power]).toEqual(['exact', '0 V', undefined]);
    expect(why(bal, 'rounding-noise')).toContain('ngspice gave node out -4.768372e-07 V. That is rounding noise');
  });

  it('C9x.2: conductances more than the largest double apart are checked, not dropped (describing the run threw "not a finite number"): V1\'s 976.6 µA for 1 mA gets the warning', () => {
    const d = ofId('cur-spread-past-double');
    expect(d.words.status).toBe('ok');
    expect(why(d, 'imprecise-answers')).toContain('V1 carries 1 mA, where ngspice gives 976.6 µA; and R1 carries 1 mA, where ngspice gives 999.2 µA.');
  });

  it('C9x.3: S28\'s numbers, which do not fit the circuit PlainSpice reads (its "+ 3" after .end makes R1 3 Ω), get the note that they could not be checked, never "node n1 is at 2 V, where ngspice gives 3 V"', () => {
    const d = ofId('cur-unchecked-plus-after-end');
    expect([roundingNoise(d.netlist, d.results).by, plain(d.words.nodes[0]?.text), why(d, 'imprecise-answers')]).toEqual(['rule', '3 V', undefined]);
    expect(why(d, 'unchecked-answers')).toContain("ngspice's numbers in the operating point do not fit the circuit PlainSpice reads from this netlist");
  });

  it('C9x.4: beside an .op the rule decides, ".dc V1 0 9 0.01" ends at 8.999999999999853 V, the .op\'s own state within its step\'s rounding: R5 is 0 A there too, with the note (it gave −8.882e-19 A beside "R5: no current")', () => {
    const d = ofId('cur-rule-sweep-step-rounding');
    const r5 = Array.from(shownSweep(d.netlist, d.results)!.series.find((x) => x.name === 'i(@r5[i])')!.values);
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'R5')), r5[r5.length - 1]]).toEqual(['rule', 'no current through R5', 0]);
    expect(plain(d.words.sweeps[0]!.text)).toContain('At V1 = 9 V: v(top) = 9 V, v(a) = 4.5 V, v(b) = 4.5 V, i(v1) = −1.407 mA, i(@r1[i]) = 450 µA, i(@r2[i]) = 450 µA, i(@r3[i]) = 957.4 µA, i(@r4[i]) = 957.4 µA, i(@r5[i]) = 0 A.');
  });

  it('C9x.5: the .tf beside the rule\'s .op, v(a,b)/V1 = −5.551e-17 V/V where the .op says node a and node b are at the same voltage, gets the note that it may be rounding noise', () => {
    const d = ofId('cur-rule-tf-maybe');
    expect([plain(d.words.tf!.transferFunction!.text), d.words.tf!.transferFunction!.maybe]).toEqual(['v(a,b)/V1 = −5.551e-17 (V/V)', 'zero']);
    expect(plain(d.words.warnings.find((m) => m.title === 'The transfer function may be rounding noise')?.why)).toBe("ngspice gave v(a,b)/V1 = -5.551115e-17. In the operating point node a and node b are at the same voltage, and this ratio is less than a billionth of a volt for each volt of V1, so it may be rounding noise, what ngspice's arithmetic leaves of a ratio that is exactly 0, or a real ratio that small. PlainSpice cannot tell which from ngspice's numbers alone, so it shows it as ngspice gives it.");
  });

  it('C9x.6: a .control block that only runs leaves the results file as it is, and the circuit to the exact solution: Vm 0 A in the bridge, with its sweep; C9o\'s out 0 V and H1 no current (it drew −193.5 nV and 37.45 aW)', () => {
    const br = ofId('cur-control-run');
    expect([roundingNoise(br.netlist, br.results).by, plain(currentText(br, 'Vm'))]).toEqual(['exact', 'Vm measures no current']);
    expect(Array.from(shownSweep(br.netlist, br.results)!.series.find((x) => x.name === 'i(vm)')!.values)).toEqual([0, 0, 0, 0]);
    const c9o = ofId('cur-control-run-c9o');
    expect([roundingNoise(c9o.netlist, c9o.results).by, plain(c9o.words.nodes.find((n) => n.node === 'out')?.text), plain(currentText(c9o, 'H1'))]).toEqual(['exact', '0 V', 'no current through H1']);
  });

  it('C8b: a BJT\'s savecurrents vectors are its model\'s quantities, not always its pins\' currents: with a 0 V ammeter on each terminal, [is] is the substrate\'s ammeter current flowing out of the part, [ie] is −(ic + ib + is), and [ic] is not the collector\'s ammeter current', () => {
    for (const id of ['cur-transistor-pin-ammeters', 'cur-transistor-pin-ammeters-off']) {
      const plots = runs.get(id)!.plots;
      const v = (name: string): number => vectorValues(plots, name)![0]!;
      expect(v('i(@q1[is])'), id).toBe(v('i(vs)'));
      expect(Math.abs(v('i(@q1[ie])') + v('i(@q1[ic])') + v('i(@q1[ib])') + v('i(@q1[is])')), id).toBeLessThan(1e-15 * Math.abs(v('i(@q1[ie])')));
      expect(Math.abs(v('i(@q1[ic])') - v('i(vc)')), id).toBeGreaterThan(1e-4 * Math.abs(v('i(vc)')));
    }
  });

  it('C9y and C9y.2: a source idle at the netlist\'s value, swept up to it in 0.01 V or 0.1 V steps, ends a few steps of a double short of it, where it carries a real attoamp current: the page draws its exact digits, names the point by ngspice\'s own value, and says why, with no warning; a 0.5 V step lands on 12 V and nothing is said (the critic of round 2: "at V1 = 9 V, V2 carries 32.76 aA")', () => {
    const d = ofId('cur-sweep-idle-source');
    expect([roundingNoise(d.netlist, d.results).by, plain(currentText(d, 'V2')), why(d, 'imprecise-answers')]).toEqual(['exact', 'no current through V2', undefined]);
    expect(plain(d.words.sweeps[0]!.text)).toContain('At V1 = 8.999999999999853 V: v(a) = 9 V, v(b) = 6 V, v(c) = 6 V, i(v2) = −32.76 aA,');
    expect(why(d, 'sweep-point')).toContain('its last point is 8.999999999999853 V, 147.4 fV short of 9 V. There the circuit makes i(v2) −32.76 aA, where at 9 V it makes 0 A.');
    expect(why(d, 'exact-digits')).toContain('ngspice gave i(v2) -3.295975e-17 A at V1 = 8.999999999999853 V and i(@r3[i]) -3.286260e-17 A at V1 = 8.999999999999853 V.');
    const twelve = ofId('cur-sweep-idle-source-12');
    expect([plain(twelve.words.sweeps[0]!.text)?.includes('At V1 = 11.999999999999973 V: v(a) = 12 V, v(c) = 6 V, v(b) = 6 V, i(v2) = −8.882 aA,'), why(twelve, 'imprecise-answers')]).toEqual([true, undefined]);
    const half = ofId('cur-sweep-idle-source-12-half');
    expect([plain(half.words.sweeps[0]!.text)?.includes('At V1 = 12 V: v(a) = 12 V, v(c) = 6 V, v(b) = 6 V, i(v2) = 0 A,'), half.words.warnings.length]).toEqual([true, 0]);
  });

  it('C9y.3 and C9y.4: a point found within the step\'s rounding of the .op\'s 9 V that does not show what the .op shows (V2\'s −32.96 aA, 38.12 fA) is not the .op\'s state: by the rule it keeps ngspice\'s numbers and is named by its own value; past SWEEP_VALUES the note names no point as the .op\'s state', () => {
    const rule = ofId('cur-sweep-idle-source-rule');
    expect([roundingNoise(rule.netlist, rule.results).by, plain(currentText(rule, 'V2'))]).toEqual(['rule', 'no current through V2']);
    expect(plain(rule.words.sweeps[0]!.text)).toContain('At V1 = 8.999999999999853 V: v(a) = 9 V, v(b) = 6 V, v(c) = 6 V, i(v2) = −32.96 aA,');
    expect(why(rule, 'sweep-point')).toContain('There ngspice gives i(v2) −32.96 aA, where the operating point, at 9 V, shows 0 A.');
    const big = ofId('cur-sweep-idle-source-large');
    expect(why(big, 'sweep-not-checked')).not.toContain('operating point');
    expect(plain(big.words.sweeps[0]!.text)).toContain('At V1 = 8.999999999828448 V: v(a) = 9 V, v(b) = 6 V, v(c) = 6 V, i(v2) = −38.12 fA,');
  });

  it('C9y.6: a point is named by its own value only where the source moving from the value it was meant to have to ngspice\'s x changes a value on the page, and the note says that value with all its digits ("not 9.12345 V", never its 4 digits); a value crossing a rounding boundary of the 4 digits (a9761-1102) or ngspice\'s own rounding beside an .op whose answers are off (a9761-156) names no point', () => {
    const meant = ofId('cur-sweep-meant-digits');
    expect(plain(meant.words.warnings.find((m) => m.code === 'sweep-point')?.title)).toBe("The DC sweep's last point is V1 = 9.123449999999998 V, not 9.12345 V");
    expect(why(meant, 'sweep-point')).toContain('its last point is 9.123449999999998 V, 1.717 fV short of 9.12345 V. There the circuit makes i(v2) −3.815e-19 A, where at 9.12345 V it makes 0 A.');
    const boundary = ofId('cur-sweep-rounding-boundary');
    expect([roundingNoise(boundary.netlist, boundary.results).by, plain(boundary.words.sweeps[0]!.text)?.includes('At V1 = 9 V: v(top1) = 9 V, v(a2) = 5.288 V'), why(boundary, 'sweep-point')]).toEqual(['exact', true, undefined]);
    const off = ofId('cur-sweep-off-op');
    expect([plain(off.words.sweeps[0]!.text)?.includes('At V1 = 500 mV: v(top1) = 500 mV'), why(off, 'sweep-point')]).toEqual([true, undefined]);
    expect(why(off, 'imprecise-answers')).toContain('V1 carries 500 aA, where ngspice gives 506.5 aA');
  });

  it('C9y.5: S28\'s "+ 3" after .end beside op-amp buffers of 1e6 or three of 1e5, which nothing joins to n1: the note that ngspice\'s numbers could not be checked, never "node n1 is at 2 V, where ngspice gives 3 V"', () => {
    for (const id of ['cur-unchecked-beside-opamp', 'cur-unchecked-beside-opamps']) {
      const d = ofId(id);
      expect([plain(d.words.nodes.find((n) => n.node === 'n1')?.text), why(d, 'imprecise-answers')], id).toEqual(['3 V', undefined]);
      expect(why(d, 'unchecked-answers'), id).toContain("ngspice's numbers in the operating point do not fit the circuit PlainSpice reads from this netlist");
    }
  });
});
