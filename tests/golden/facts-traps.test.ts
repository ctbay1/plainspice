/**
 * docs/spice-facts/traps.md, checked against our WebAssembly engine.
 *
 * Every netlist behind a trap's claims runs through the engine (the same code the page uses), and
 * what the trap says ngspice does is asserted: the vectors, the messages, whether the run fails or is
 * marked unreliable. Then the trap checks (src/spice/traps.ts) read the same netlist and must find
 * exactly the traps listed for it, and every fix those traps offer is applied and run through the
 * engine, which must then run cleanly (no error, results it can trust).
 *
 * The netlists and values come from runs of native ngspice 47 and 42 and of this engine, recorded on
 * 9 Nov 2026; the document shows those outputs verbatim. Vectors are compared exactly with what the
 * engine gave then, which is bit for bit what native ngspice 47 gave, except where noted: `sig6`
 * (a final value compared with native 47's to 6 significant figures, because the time grids differ)
 * and the E, F, G and H lines where native 47's XSPICE behaves differently by design (missing-value-4
 * to -7, space-before-suffix-11). If a new engine reads a netlist differently, this test fails and the
 * document must be checked again.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { agrees } from '../../src/engine/compare.ts';
import { NgspiceEngine } from '../../src/engine/ngspice.ts';
import type { RunResult } from '../../src/engine/types.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import { applyFix, checkTraps } from '../../src/spice/traps.ts';

interface Fact {
  /** The claim's ID in traps.md. */
  code: string;
  netlist: string;
  /** Rawfile vectors, exactly. */
  vectors?: Record<string, number | number[]>;
  /** The last point of a vector (a transient run). */
  last?: Record<string, number>;
  /** Compare `last` to 6 significant figures (native ngspice 47's value). */
  sig6?: true;
  /** Text the run prints, on stdout or stderr. */
  prints?: string[];
  /** The run gives no results. */
  fails?: true;
  /** The engine marks the numbers unreliable: ngspice's DC solution failed. */
  unreliable?: true;
  /** What checkTraps finds, in order. */
  traps: string[];
}

const FACTS: Fact[] = [
  { code: 'mega-as-milli-1', netlist: "* 1M meant as a megaohm\nV1 n1 0 6\nR1 n1 n2 1M\nR2 n2 0 1meg\n.op\n.end\n", vectors: { "v(n2)": 5.999999994, "i(v1)": -0.00000599999930273043 }, traps: ['mega-as-milli'] },
  { code: 'mega-as-milli-2', netlist: "* 1MOhm and 1MEGohm\nV1 n1 0 6\nR1 n1 n2 1MOhm\nR2 n2 0 1MEGohm\n.op\n.end\n", vectors: { "v(n2)": 5.999999994, "i(v1)": -0.00000599999930273043 }, traps: ['mega-as-milli'] },
  { code: 'mega-as-milli-3', netlist: "* M on a voltage source, a current source and a gain\nV1 n1 0 5M\nR1 n1 0 1\nI1 0 n2 2M\nR2 n2 0 1\nE1 n3 0 n1 0 1M\nR3 n3 0 1\n.op\n.end\n", vectors: { "v(n1)": 0.005, "v(n2)": 0.002, "v(n3)": 0.000005 }, traps: ['mega-as-milli', 'mega-as-milli', 'mega-as-milli'] },
  { code: 'unit-letter-1', netlist: "* 3A on a current source\nI1 0 n1 3A\nR1 n1 0 4\n.op\n.end\n", vectors: { "v(n1)": 1.2000000000000001e-17 }, traps: ['unit-letter'] },
  { code: 'unit-letter-2', netlist: "* 1F on a capacitor\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1F\n.tran 1u 5u\n.end\n", last: { "v(out)": 1.000014344867142 }, traps: ['unit-letter'] },
  { code: 'unit-letter-3', netlist: "* 100mA\nI1 0 n1 100mA\nR1 n1 0 1\n.op\n.end\n", vectors: { "v(n1)": 0.1 }, traps: [] },
  { code: 'greek-mu-1', netlist: "* the Greek letter mu and the micro sign\nI1 0 n1 1\nR1 n1 0 4.7\u03bc\nV2 n2 0 4.7\u00b5\nR2 n2 0 1\n.op\n.end\n", vectors: { "v(n1)": 4.7, "v(n2)": 0.0000047 }, traps: ['greek-mu'] },
  { code: 'greek-mu-2', netlist: "* the Greek letter mu on a capacitor and an inductor\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1\nC1 out 0 2\u03bcF\nR2 in b 1\nL1 b 0 3\u03bcH\n.tran 0.1m 1m\n.end\n", last: { "v(out)": 0.0004998747709848901, "v(b)": 0.9996667223826431 }, sig6: true, prints: ["can't find model '2\u03bcf'", "can't find model '3\u03bch'"], traps: ['greek-mu', 'greek-mu'] },
  { code: 'rkm-notation-1', netlist: "* resistor-code values\nI1 0 n1 1\nR1 n1 0 2k2\nI2 0 n2 1\nR2 n2 0 1M5\nI3 0 n3 1\nR3 n3 0 4R7\n.op\n.end\n", vectors: { "v(n1)": 2000, "v(n2)": 0.001, "v(n3)": 4 }, traps: ['rkm-notation', 'rkm-notation', 'rkm-notation'] },
  { code: 'decimal-comma-1', netlist: "* a decimal comma on a resistor\nI1 0 n1 1\nR1 n1 0 1,5k\n.op\n.end\n", vectors: { "v(n1)": 5000 }, traps: ['decimal-comma'] },
  { code: 'decimal-comma-2', netlist: "* a decimal comma on a capacitor (RC = 5 us if C is 5u)\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1\nC1 out 0 1,5u\n.tran 0.1u 5u\n.end\n", last: { "v(out)": 0.6320957369930835 }, prints: ["can't find model '1,5u'"], traps: ['decimal-comma'] },
  { code: 'decimal-comma-3', netlist: "* a decimal comma on an inductor (L/R = 5 ms if L is 5m)\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1\nL1 out 0 1,5m\n.tran 0.1m 5m\n.end\n", last: { "v(out)": 0.3678675214980326 }, sig6: true, traps: ['decimal-comma'] },
  { code: 'decimal-comma-4', netlist: "* a decimal comma on a voltage source\nV1 a 0 1,5\nR1 a 0 1\n.op\n.end\n", prints: ["unknown parameter (5)"], fails: true, traps: ['decimal-comma'] },
  { code: 'decimal-comma-5', netlist: "* a decimal comma on a current source\nI1 0 a 2,5\nR1 a 0 1\n.op\n.end\n", prints: ["unknown parameter (5)"], fails: true, traps: ['decimal-comma'] },
  { code: 'decimal-comma-6', netlist: "* a decimal comma on a gain\nV1 a 0 1\nR0 a 0 1\nE1 b 0 a 0 1,5\nR1 b 0 1\n.op\n.end\n", prints: ["unknown parameter (5)"], fails: true, traps: ['decimal-comma'] },
  { code: 'decimal-comma-7', netlist: "* a decimal comma on a transconductance\nV1 a 0 1\nR0 a 0 1\nG1 0 b a 0 1,5\nR1 b 0 1\n.op\n.end\n", prints: ["unknown parameter (5)"], fails: true, traps: ['decimal-comma'] },
  { code: 'decimal-comma-8', netlist: "* a decimal comma on a current gain\nV1 a 0 1\nVx a c 0\nR0 c 0 1\nF1 0 b Vx 1,5\nR1 b 0 1\n.op\n.end\n", prints: ["unknown parameter (5)"], fails: true, traps: ['decimal-comma'] },
  { code: 'decimal-comma-9', netlist: "* a decimal comma on a transresistance\nV1 a 0 1\nVx a c 0\nR0 c 0 1\nH1 b 0 Vx 1,5\nR1 b 0 1\n.op\n.end\n", prints: ["unknown parameter (5)"], fails: true, traps: ['decimal-comma'] },
  { code: 'sign-in-value-1', netlist: "* a sign inside a resistor's value\nI1 0 a 1\nR1 a 0 1k-2\nI2 0 b 1\nR2 b 0 1d-3\nI3 0 c 1\nR3 c 0 1k+2\n.op\n.end\n", vectors: { "v(a)": -2, "v(b)": -3, "v(c)": 2 }, traps: ['sign-in-value', 'sign-in-value', 'sign-in-value'] },
  { code: 'sign-in-value-2', netlist: "* a sign inside a capacitor's and an inductor's value\nV1 in 0 PULSE(0 1 0 1n 1n 10 20)\nR1 in out 1\nC1 out 0 1u-2\nR2 in b 1\nL1 b 0 1m-2\n.tran 10m 1\n.end\n", last: { "v(out)": -0.6487229588969943, "v(b)": 1.6487229588969943 }, sig6: true, prints: ["can't find model '1u-2'", "can't find model '1m-2'"], traps: ['sign-in-value', 'sign-in-value'] },
  { code: 'space-before-suffix-1', netlist: "* a space before k on a resistor\nI1 0 n1 1\nR1 n1 0 1 k\n.op\n.end\n", prints: ["can't find model 'k'", "unknown parameter (k)"], fails: true, traps: ['space-before-suffix'] },
  { code: 'space-before-suffix-2', netlist: "* a space before a unit on a voltage source\nV1 n1 0 5 V\nR1 n1 0 1\n.op\n.end\n", prints: ["unknown parameter (v)"], fails: true, traps: ['space-before-suffix'] },
  { code: 'space-before-suffix-3', netlist: "* a space before a unit on a current source\nI1 0 n1 3 A\nR1 n1 0 2\n.op\n.end\n", prints: ["unknown parameter (a)"], fails: true, traps: ['space-before-suffix'] },
  { code: 'space-before-suffix-4', netlist: "* a space before u on a capacitor\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1 u\n.op\n.end\n", prints: ["unknown parameter (u)"], fails: true, traps: ['space-before-suffix'] },
  { code: 'space-before-suffix-5', netlist: "* a space before u on an inductor\nV1 in 0 1\nR1 in out 1k\nL1 out 0 1 u\n.op\n.end\n", prints: ["unknown parameter (u)"], fails: true, traps: ['space-before-suffix'] },
  { code: 'space-before-suffix-6', netlist: "* a space before k on a gain\nV1 a 0 1\nR0 a 0 1\nE1 b 0 a 0 2 k\nR1 b 0 1\n.op\n.end\n", prints: ["unknown parameter (k)"], fails: true, traps: ['space-before-suffix'] },
  { code: 'space-before-suffix-7', netlist: "* a space before m on a resistor\nI1 0 n1 1\nR1 n1 0 1 m\nR2 n1 0 1\n.op\n.end\n", vectors: { "v(n1)": 1 }, prints: ["can't find model 'm'"], traps: ['space-before-suffix'] },
  { code: 'space-before-suffix-8', netlist: "* a space before m on a capacitor\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1 m\n.tran 0.1m 1m\n.end\n", last: { "v(out)": 1 }, sig6: true, traps: ['space-before-suffix'] },
  { code: 'space-before-suffix-9', netlist: "* a space before m on an inductor\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nL1 out 0 1 m\n.tran 0.1m 1m\n.end\n", prints: ["Timestep too small"], fails: true, traps: ['space-before-suffix'] },
  { code: 'space-before-suffix-10', netlist: "* a space before m on a current source\nI1 0 a 3 m\nR1 a 0 1\n.op\n.end\n", vectors: { "v(a)": 0 }, traps: ['space-before-suffix'] },
  { code: 'space-before-suffix-11', netlist: "* a space before m on a transconductance\nV1 a 0 1\nR0 a 0 1\nG1 0 b a 0 2 m\nR1 b 0 1\n.op\n.end\n", vectors: { "v(b)": 0 }, traps: ['space-before-suffix'] },
  { code: 'space-before-suffix-12', netlist: "* a space before p on a resistor\nI1 0 n1 1\nR1 n1 0 1 p\n.op\n.end\n", prints: ["no such parameter on this device or parameter is missing"], fails: true, traps: ['space-before-suffix'] },
  { code: 'space-before-suffix-13', netlist: "* a space before k on a transconductance\nV1 a 0 1\nR0 a 0 1\nG1 0 b a 0 2 k\nR1 b 0 1\n.op\n.end\n", fails: true, traps: ['space-before-suffix'] },
  { code: 'space-before-suffix-14', netlist: "* a space before k on a current gain\nV1 a 0 1\nVx a c 0\nR0 c 0 1\nF1 0 b Vx 2 k\nR1 b 0 1\n.op\n.end\n", fails: true, traps: ['space-before-suffix'] },
  { code: 'midline-comment-1', netlist: "* a star after a resistor value\nI1 0 n1 1\nR1 n1 0 2 * load\n.op\n.end\n", prints: ["unknown parameter (*)"], fails: true, traps: ['midline-comment'] },
  { code: 'midline-comment-2', netlist: "* a star after a source value\nV1 a 0 5 * supply\nR1 a 0 1\n.op\n.end\n", prints: ["unknown parameter (*)"], fails: true, traps: ['midline-comment'] },
  { code: 'midline-comment-3', netlist: "* a hash after a resistor value\nI1 0 n1 1\nR1 n1 0 2 # load\n.op\n.end\n", prints: ["unknown parameter (#)"], fails: true, traps: ['midline-comment'] },
  { code: 'midline-comment-4', netlist: "* a slash after a resistor value\nI1 0 n1 1\nR1 n1 0 2 / load\n.op\n.end\n", prints: ["unknown parameter (/)"], fails: true, traps: ['midline-comment'] },
  { code: 'midline-comment-5', netlist: "* a star after a capacitor value\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u * filter\n.op\n.end\n", prints: ["unknown parameter (*)"], fails: true, traps: ['midline-comment'] },
  { code: 'midline-comment-6', netlist: "* a star after a current source value\nI1 0 n1 3 * source\nR1 n1 0 2\n.op\n.end\n", prints: ["unknown parameter (*)"], fails: true, traps: ['midline-comment'] },
  { code: 'midline-comment-7', netlist: "* a star after a gain\nV1 a 0 1\nR0 a 0 1\nE1 b 0 a 0 2 * amplifier\nR1 b 0 1\n.op\n.end\n", prints: ["unknown parameter (*)"], fails: true, traps: ['midline-comment'] },
  { code: 'midline-comment-9', netlist: "* a star after an inductor value\nV1 in 0 1\nR1 in out 1k\nL1 out 0 1m * choke\n.op\n.end\n", prints: ["unknown parameter (*)"], fails: true, traps: ['midline-comment'] },
  { code: 'midline-comment-10', netlist: "* a star after a transconductance\nV1 a 0 1\nR0 a 0 1\nG1 0 b a 0 2 * amplifier\nR1 b 0 1\n.op\n.end\n", fails: true, traps: ['midline-comment'] },
  { code: 'midline-comment-11', netlist: "* a star after a current gain\nV1 a 0 1\nVx a c 0\nR0 c 0 1\nF1 0 b Vx 2 * amplifier\nR1 b 0 1\n.op\n.end\n", fails: true, traps: ['midline-comment'] },
  { code: 'midline-comment-12', netlist: "* a star after a transresistance\nV1 a 0 1\nVx a c 0\nR0 c 0 1\nH1 b 0 Vx 2 * amplifier\nR1 b 0 1\n.op\n.end\n", fails: true, traps: ['midline-comment'] },
  { code: 'midline-comment-8', netlist: "* a semicolon after a value\nI1 0 n1 1\nR1 n1 0 2 ; load\n.op\n.end\n", vectors: { "v(n1)": 2 }, traps: [] },
  { code: 'nbsp-1', netlist: "* a no-break space before the value\nI1 0 n1 1\nR1 n1 0\u00a02\nR2 n1 0 1\n.op\n.end\n", vectors: { "v(n1)": 1 }, prints: ["is not a valid resistor instance line, ignored!"], traps: ['missing-value', 'nbsp'] },
  { code: 'nbsp-2', netlist: "* a no-break space between the value and its unit\nV1 in 0 10\nR1 in out 4.7\u00a0k\u03a9\nR2 out 0 4.7k\n.op\n.end\n", vectors: { "v(in)": 10, "v(out)": 9.99000999000999, "i(v1)": -0.0021255340404278122 }, traps: ['nbsp'] },
  { code: 'missing-value-1', netlist: "* a resistor without a value\nV1 a 0 6\nR2 a 0 3\nR1 a 0\n.op\n.end\n", vectors: { "i(v1)": -2 }, prints: ["'r1 a 0' is not a valid resistor instance line, ignored!"], traps: ['missing-value'] },
  { code: 'missing-value-2', netlist: "* a capacitor and an inductor without a value\nV1 a 0 6\nR1 a b 2\nC1 b 0\nR2 b c 2\nL1 c 0\nR3 c 0 4\n.op\n.end\n", vectors: { "v(b)": 4.5, "v(c)": 3 }, prints: ["'c1 b 0' is not a valid capacitor instance line, ignored!", "'l1 c 0' is not a valid inductor instance line, ignored!"], traps: ['missing-value', 'missing-value'] },
  { code: 'missing-value-3', netlist: "* sources without a value\nV1 a 0\nR1 a 0 2\nI1 0 b\nR2 b 0 2\n.op\n.end\n", vectors: { "v(a)": 0, "v(b)": 0 }, prints: ["v1: has no value, DC 0 assumed", "i1: has no value, DC 0 assumed"], traps: ['missing-value', 'missing-value'] },
  { code: 'missing-value-4', netlist: "* E without a gain\nV1 c 0 3\nR1 c 0 1\nE1 a 0 c 0\nR2 a 0 1\n.op\n.end\n", vectors: { "v(a)": 0 }, traps: ['missing-value'] },
  { code: 'missing-value-5', netlist: "* G without a value\nV1 c 0 3\nR1 c 0 1\nG1 0 a c 0\nR2 a 0 1\n.op\n.end\n", vectors: { "v(a)": 0 }, traps: ['missing-value'] },
  { code: 'missing-value-6', netlist: "* F without a gain\nV1 c 0 3\nVx c d 0\nR1 d 0 1\nF1 0 a Vx\nR2 a 0 1\n.op\n.end\n", vectors: { "v(a)": 0 }, traps: ['missing-value'] },
  { code: 'missing-value-7', netlist: "* H without a value\nV1 c 0 3\nVx c d 0\nR1 d 0 1\nH1 a 0 Vx\nR2 a 0 1\n.op\n.end\n", vectors: { "v(a)": 0 }, traps: ['missing-value'] },
  { code: 'missing-fields-1', netlist: "* parts with one node\nV1 a 0 6\nR2 a 0 3\nR1 a\nC1 a\nL1 a\n.op\n.end\n", vectors: { "i(v1)": -2 }, prints: ["'r1 a' is not a valid resistor instance line, ignored!", "'c1 a' is not a valid capacitor instance line, ignored!", "'l1 a' is not a valid inductor instance line, ignored!"], traps: ['missing-fields', 'missing-fields', 'missing-fields'] },
  { code: 'missing-fields-2', netlist: "* a voltage source with one node\nV1 a\nR1 a 0 2\n.op\n.end\n", prints: ["Not enough parameters"], fails: true, traps: ['missing-fields'] },
  { code: 'missing-fields-3', netlist: "* a current source with one node\nI1 a\nR1 a 0 2\n.op\n.end\n", prints: ["Not enough parameters"], fails: true, traps: ['missing-fields'] },
  { code: 'missing-fields-4', netlist: "* E without its control - node\nV1 c 0 3\nR1 c 0 1\nE1 a 0 2\nR2 a 0 1\n.op\n.end\n", fails: true, unreliable: true, traps: ['missing-fields'] },
  { code: 'missing-fields-5', netlist: "* G without its control - node\nV1 c 0 3\nR1 c 0 1\nG1 0 a 2\nR2 a 0 1\n.op\n.end\n", fails: true, unreliable: true, traps: ['missing-fields'] },
  { code: 'missing-fields-6', netlist: "* F without a control source\nV1 c 0 3\nR1 c 0 1\nF1 0 a\nR2 a 0 1\n.op\n.end\n", prints: ["unknown controlling source"], fails: true, traps: ['missing-fields'] },
  { code: 'missing-fields-7', netlist: "* F with its gain but no control source\nV1 c 0 3\nR1 c 0 1\nF1 0 a 5\nR2 a 0 1\n.op\n.end\n", prints: ["unknown controlling source 5"], fails: true, traps: ['missing-fields'] },
  { code: 'missing-fields-8', netlist: "* H without a control source\nV1 c 0 3\nR1 c 0 1\nH1 a 0 2\nR2 a 0 1\n.op\n.end\n", prints: ["unknown controlling source 2"], fails: true, traps: ['missing-fields'] },
  { code: 'control-source-1', netlist: "* F naming a missing source\nV1 c 0 3\nR1 c 0 1\nF1 0 a V9 2\nR2 a 0 1\n.op\n.end\n", prints: ["f1: unknown controlling source v9"], fails: true, traps: ['control-source'] },
  { code: 'control-source-2', netlist: "* F naming a resistor\nV1 c 0 3\nR1 c 0 1\nF1 0 a R1 2\nR2 a 0 1\n.op\n.end\n", prints: ["f1: unknown controlling source r1"], fails: true, traps: ['control-source'] },
  { code: 'control-source-3', netlist: "* H naming a missing source\nV1 c 0 3\nR1 c 0 1\nH1 a 0 V9 2\nR2 a 0 1\n.op\n.end\n", prints: ["h1: unknown controlling source v9"], fails: true, traps: ['control-source'] },
  { code: 'missing-title-1', netlist: "V1 n1 0 6\nR1 n1 0 2\n.op\n.end\n", vectors: { "v(n1)": 0 }, traps: ['missing-title', 'dangling-node'] },
  { code: 'missing-title-2', netlist: ".op\nV1 n1 0 6\nR1 n1 0 2\n.end\n", fails: true, traps: ['missing-title'] },
  { code: 'no-ground-1', netlist: "* no ground\nV1 a b 6\nR1 a b 2\n.op\n.end\n", vectors: { "v(a)": 9.00033307426206, "v(b)": 3.0003330742710626 }, prints: ["singular matrix"], unreliable: true, traps: ['no-ground'] },
  { code: 'no-ground-2', netlist: "* example 1 without a node 0\nV1 n1 n3 6\nR1 n1 n2 2\nR2 n2 n3 4\nI1 n3 n2 3\n.op\n.end\n", prints: ["singular matrix"], unreliable: true, traps: ['no-ground'] },
  { code: 'ground-misnamed-1', netlist: "* ground on one part, 0 on the other\nV1 n1 ground 6\nR1 n1 0 2\n.op\n.end\n", vectors: { "v(n1)": 0, "v(ground)": -6, "i(v1)": 0 }, traps: ['ground-misnamed'] },
  { code: 'ground-misnamed-2', netlist: "* a 0 V ammeter to gnd\nV1 a 0 6\nR1 a b 2\nVx b gnd\n.op\n.end\n", vectors: { "v(b)": 6, "v(gnd)": 6, "i(vx)": 0 }, traps: ['missing-value', 'ground-misnamed'] },
  { code: 'ground-misnamed-3', netlist: "* 00 on one part, 0 on the other\nV1 n1 00 6\nR1 n1 0 2\n.op\n.end\n", vectors: { "v(n1)": 0, "v(00)": -6, "i(v1)": 0 }, traps: ['ground-misnamed'] },
  { code: 'dangling-node-1', netlist: "* a node with one connection\nV1 n1 0 6\nR1 n1 0 2\nR2 n1 n2 3\n.op\n.end\n", vectors: { "v(n1)": 6, "v(n2)": 6, "i(v1)": -3 }, traps: ['dangling-node'] },
  { code: 'dangling-node-2', netlist: "* typo in a node name\nV1 n1 0 6\nR1 n1 n2 2\nR2 n12 0 4\nI1 0 n2 3\n.op\n.end\n", vectors: { "v(n2)": 12 }, traps: ['dangling-node'] },
  { code: 'floating-dc-1', netlist: "* a node connected only to capacitors\nV1 a 0 6\nC1 a b 1u\nC2 b 0 1u\n.op\n.end\n", vectors: { "v(b)": 2.9999999999819513 }, prints: ["singular matrix:  check node b"], unreliable: true, traps: ['floating-dc'] },
  { code: 'floating-dc-2', netlist: "* a capacitor-only node next to a divider\nV1 a 0 6\nR1 a c 1k\nC1 c b 1u\nC2 b 0 2u\nR2 c 0 1k\n.op\n.end\n", vectors: { "v(c)": 0.08866339997380636 }, prints: ["singular matrix:  check node b"], unreliable: true, traps: ['floating-dc'] },
  { code: 'floating-dc-3', netlist: "* a resistor whose two nodes connect to nothing else\nV1 n1 0 6\nR1 n1 0 2\nR2 n3 n4 3\n.op\n.end\n", prints: ["singular matrix:  check node n3"], unreliable: true, traps: ['floating-dc'] },
  { code: 'floating-dc-4', netlist: "* a control node with nothing else\nV1 a 0 6\nR1 a 0 2\nE1 out 0 c 0 2\nR2 out 0 1\n.op\n.end\n", prints: ["singular matrix:  check node c", "operating point could not be simulated"], fails: true, unreliable: true, traps: ['floating-dc'] },
  { code: 'floating-dc-5', netlist: "* a MOSFET with a floating gate\nV1 d 0 5\nR1 d dd 1k\nM1 dd g 0 0 nm\n.model nm nmos level=1\n.op\n.end\n", prints: ["singular matrix:  check node g"], unreliable: true, traps: ['floating-dc'] },
  { code: 'floating-dc-6', netlist: "* a capacitor-only node, tran with uic\nV1 a 0 6\nC1 a b 1u\nC2 b 0 1u\n.tran 1u 10u uic\n.end\n", last: { "v(b)": 2.9999999999999996 }, traps: [] },
  { code: 'current-source-no-path-1', netlist: "* a current source in series with a capacitor\nV1 a 0 5\nR1 a c 1k\nI1 c b 1m\nC1 b 0 1u\n.op\n.end\n", vectors: { "v(b)": 0.009999999999950042 }, prints: ["singular matrix:  check node b"], unreliable: true, traps: ['current-source-no-path'] },
  { code: 'current-source-no-path-2', netlist: "* two different current sources in series\nI1 0 n1 1m\nI2 n1 0 2m\nR1 n2 0 1k\nV1 n2 0 1\n.op\n.end\n", vectors: { "v(n1)": -0.001 }, traps: ['current-source-no-path'] },
  { code: 'current-source-no-path-3', netlist: "* a current source into a node with nothing else\nI1 0 n1 1\nV1 n2 0 1\nR1 n2 0 1\n.op\n.end\n", vectors: { "v(n1)": 1 }, traps: ['current-source-no-path'] },
  { code: 'current-source-no-path-4', netlist: "* a G output into a node with nothing else\nV1 c 0 3\nR1 c 0 1\nG1 0 g c 0 0.5\n.op\n.end\n", prints: ["singular matrix:  check node g", "operating point could not be simulated"], fails: true, unreliable: true, traps: ['current-source-no-path'] },
  { code: 'current-source-no-path-5', netlist: "* an F output into a node with nothing else\nV1 c 0 3\nVx c d 0\nR1 d 0 1\nF1 0 f Vx 2\n.op\n.end\n", prints: ["singular matrix:  check node f", "operating point could not be simulated"], fails: true, unreliable: true, traps: ['current-source-no-path'] },
  { code: 'voltage-loop-1', netlist: "* two different voltage sources in parallel\nV1 n1 0 5\nV2 n1 0 3\nR1 n1 0 1k\n.op\n.end\n", prints: ["singular matrix", "operating point could not be simulated"], fails: true, unreliable: true, traps: ['voltage-loop'] },
  { code: 'voltage-loop-2', netlist: "* two equal voltage sources in parallel\nV1 n1 0 5\nV2 n1 0 5\nR1 n1 0 1k\n.op\n.end\n", prints: ["singular matrix", "operating point could not be simulated"], fails: true, unreliable: true, traps: ['voltage-loop'] },
  { code: 'voltage-loop-3', netlist: "* a voltage source shorted by a 0 V source\nV1 n1 0 5\nVshort n1 0 0\nR1 n1 0 1k\n.op\n.end\n", prints: ["singular matrix", "operating point could not be simulated"], fails: true, unreliable: true, traps: ['voltage-loop'] },
  { code: 'voltage-loop-4', netlist: "* an E output across a voltage source\nV1 a 0 6\nR1 a 0 2\nE1 a 0 a 0 2\n.op\n.end\n", prints: ["singular matrix", "operating point could not be simulated"], fails: true, unreliable: true, traps: ['voltage-loop'] },
  { code: 'voltage-loop-5', netlist: "* an inductor across a voltage source\nV1 a 0 6\nR1 a 0 2\nL1 a 0 1m\n.op\n.end\n", vectors: { "i(l1)": 0.05999999999994027 }, prints: ["singular matrix:  check node l1#branch"], unreliable: true, traps: ['voltage-loop'] },
  { code: 'voltage-loop-6', netlist: "* an inductor across a voltage source, tran with uic\nV1 a 0 6\nR1 a 0 2\nL1 a 0 1m\n.tran 1u 10u uic\n.end\n", last: { "i(l1)": 0.060000000000000386 }, traps: [] },
  { code: 'voltage-loop-7', netlist: "* two voltage sources in parallel, tran with uic\nV1 a 0 5\nV2 a 0 3\nR1 a 0 1k\n.tran 1u 10u uic\n.end\n", prints: ["singular matrix:  check node v1#branch"], fails: true, unreliable: true, traps: ['voltage-loop'] },
  { code: 'voltage-loop-8', netlist: "* a voltage source with both ends on one node\nV1 a 0 6\nR1 a 0 2\nV2 a a 5\n.op\n.end\n", prints: ["instance v2 is a shorted VSRC"], fails: true, traps: ['voltage-loop'] },
  { code: 'voltage-loop-9', netlist: "* an E output with both ends on one node\nV1 a 0 6\nR1 a 0 2\nE1 a a a 0 2\n.op\n.end\n", prints: ["instance e1 is a shorted VCVS"], fails: true, traps: ['voltage-loop'] },
  { code: 'voltage-loop-10', netlist: "* an H output with both ends on one node\nV1 a 0 6\nVx a b 0\nR1 b 0 2\nH1 a a Vx 2\n.op\n.end\n", prints: ["instance h1 is a shorted CCVS"], fails: true, traps: ['voltage-loop'] },
  { code: 'voltage-loop-11', netlist: "* an inductor with both ends on one node\nV1 a 0 6\nR1 a 0 2\nL1 a a 1m\n.op\n.end\n", prints: ["singular matrix:  check node l1#branch"], unreliable: true, traps: ['voltage-loop'] },
  { code: 'duplicate-name-1', netlist: "* two resistors both named R1\nV1 n1 0 6\nR1 n1 0 2\nR1 n1 0 4\n.op\n.end\n", prints: ["device already exists"], fails: true, traps: ['duplicate-name'] },
  { code: 'duplicate-name-2', netlist: "* R1 and r1\nV1 n1 0 6\nR1 n1 0 2\nr1 n1 0 4\n.op\n.end\n", prints: ["device already exists"], fails: true, traps: ['duplicate-name'] },
  { code: 'unknown-letter-1', netlist: "* a note without a star\nV1 a 0 6\nR1 a 0 2\n2 resistors in parallel\nR2 a 0 2\n.op\n.end\n", prints: ["unknown device type - error"], fails: true, traps: ['unknown-letter'] },
  { code: 'unknown-letter-2', netlist: "* a non-ASCII first letter\nV1 a 0 6\nR1 a 0 2\n\u03a91 a 0 5\n.op\n.end\n", prints: ["unknown device type - error"], fails: true, traps: ['unknown-letter'] },
  { code: 'unknown-letter-3', netlist: "* a line starting with a brace\nV1 a 0 6\nR1 a 0 2\n{1 a 0 5\n.op\n.end\n", prints: ["Closing \"}\" not found"], fails: true, traps: ['unknown-letter'] },
  { code: 'unknown-letter-4', netlist: "* a line starting with @\nV1 n1 0 6\nR2 n1 0 3\n@ note: R1 below\nR1 n1 0 2\n.op\n.end\n", fails: true, traps: ['unknown-letter'] },
  { code: 'unknown-letter-5', netlist: "@ title\nV1 n1 0 6\nR1 n1 0 2\n.op\n.end\n", prints: ["there aren't any circuits loaded"], fails: true, traps: ['unknown-letter'] },
  { code: 'unknown-letter-6', netlist: "* an XSPICE gain block\nV1 a 0 6\nR1 b 0 1k\nA1 a b gainmod\n.model gainmod gain(gain=2)\n.op\n.end\n", prints: ["unknown device type - error"], fails: true, traps: ['unknown-letter'] },
  { code: 'unknown-letter-7', netlist: "* an OSDI device line\nV1 a 0 6\nR1 b 0 1k\nN1 a b vamod\n.model vamod resistor r=1k\n.op\n.end\n", prints: ["unknown device type - error"], fails: true, traps: ['unknown-letter'] },
  { code: 'unknown-letter-8', netlist: "* W meant as a wire\nV1 a 0 6\nR1 b 0 2\nW1 a b\n.op\n.end\n", prints: ["Unable to find definition of model"], fails: true, traps: ['unknown-letter'] },
  { code: 'unknown-letter-9', netlist: "* a 0 V source as a wire\nV1 a 0 6\nR1 b 0 2\nVW1 a b 0\n.op\n.end\n", vectors: { "v(b)": 6, "i(vw1)": 3 }, traps: [] },
  { code: 'unknown-letter-10', netlist: "* S meant as a switch\nV1 a 0 6\nR1 b 0 2\nS1 a b\n.op\n.end\n", prints: ["Unable to find definition of model"], fails: true, traps: ['unknown-letter'] },
  { code: 'unknown-letter-11', netlist: "* T meant as a transformer\nV1 a 0 6\nR1 b 0 2\nT1 a 0 b 0\n.op\n.end\n", prints: ["transmission line z0 must be given"], fails: true, traps: ['unknown-letter'] },
  { code: 'unknown-letter-12', netlist: "* K meant as a constant\nV1 a 0 6\nR1 a 0 2\nK1 a 0 5\n.op\n.end\n", prints: ["coupling to non-existent inductor a."], fails: true, traps: ['unknown-letter'] },
  { code: 'unknown-letter-13', netlist: "* U without a model\nV1 a 0 6\nR1 a 0 2\nU1 a 0 b\nR2 b 0 1\n.op\n.end\n", prints: ["Unable to find definition of model"], fails: true, traps: ['unknown-letter'] },
  { code: 'unknown-letter-14', netlist: "* Y without a model\nV1 a 0 6\nR1 a 0 2\nY1 a 0 b 0\nR2 b 0 1\n.op\n.end\n", prints: ["model name is not found"], fails: true, traps: ['unknown-letter'] },
  { code: 'unknown-letter-15', netlist: "* Z without a model\nV1 a 0 6\nR1 a b 2\nZ1 b a 0\n.op\n.end\n", prints: ["Unable to find definition of model"], fails: true, traps: ['unknown-letter'] },
  { code: 'unknown-letter-16', netlist: "* P without a model\nV1 a 0 6\nR1 a 0 2\nP1 a 0 b 0\nR2 b 0 1\n.op\n.end\n", prints: ["model name is not found"], fails: true, traps: ['unknown-letter'] },
  { code: 'missing-model-1', netlist: "* a diode with no model\nV1 a 0 6\nR1 a b 1k\nD1 b 0\n.op\n.end\n", prints: ["could not find a valid modelname"], fails: true, traps: ['missing-model'] },
  { code: 'missing-model-2', netlist: "* a diode with no .model line\nV1 a 0 6\nR1 a b 1k\nD1 b 0 dmod\n.op\n.end\n", prints: ["can't find model 'dmod'", "could not find a valid modelname"], fails: true, traps: ['missing-model'] },
  { code: 'missing-model-3', netlist: "* a diode with its .model line\nV1 a 0 6\nR1 a b 1k\nD1 b 0 dmod\n.model dmod D\n.op\n.end\n", vectors: { "v(b)": 0.6982620329744134 }, traps: [] },
  { code: 'missing-model-4', netlist: "* a BJT with no .model line\nV1 a 0 6\nR1 a c 1k\nR2 a b 100k\nQ1 c b 0 qmod\n.op\n.end\n", prints: ["could not find a valid modelname"], fails: true, traps: ['missing-model'] },
  { code: 'missing-model-5', netlist: "* a MOSFET with no .model line\nV1 d 0 5\nV2 g 0 2\nR1 d dd 1k\nM1 dd g 0 0 nm\n.op\n.end\n", prints: ["could not find a valid modelname"], fails: true, traps: ['missing-model'] },
  { code: 'missing-model-6', netlist: "* a JFET with no .model line\nV1 d 0 5\nR1 d dd 1k\nJ1 dd 0 0 jm\n.op\n.end\n", prints: ["Unable to find definition of model"], fails: true, traps: ['missing-model'] },
  { code: 'missing-subcircuit-1', netlist: "* a subcircuit call with no definition\nV1 a 0 6\nR1 a b 1k\nX1 b 0 amp\n.op\n.end\n", prints: ["unknown subckt"], fails: true, traps: ['missing-subcircuit'] },
  { code: 'model-not-in-engine-1', netlist: "* a BSIM3 MOSFET\nV1 d 0 1\nV2 g 0 1\nM1 d g 0 0 nm l=1u w=1u\n.model nm nmos level=49\n.op\n.end\n", prints: ["could not find a valid modelname"], fails: true, traps: ['model-not-in-engine'] },
  { code: 'model-not-in-engine-2', netlist: "* a BSIM4 MOSFET\nV1 d 0 1\nV2 g 0 1\nM1 d g 0 0 nm l=1u w=1u\n.model nm nmos level=54\n.op\n.end\n", prints: ["could not find a valid modelname"], fails: true, traps: ['model-not-in-engine'] },
  { code: 'model-not-in-engine-3', netlist: "* a HICUM BJT\nV1 c 0 1\nV2 b 0 0.7\nQ1 c b 0 qm\n.model qm npn level=8\n.op\n.end\n", prints: ["Unable to find definition of given model"], fails: true, traps: ['model-not-in-engine'] },
  { code: 'model-not-in-engine-4', netlist: "* a JFET2 JFET\nV1 d 0 1\nV2 g 0 0\nJ1 d g 0 jm\n.model jm njf level=2\n.op\n.end\n", prints: ["Unknown device type for model jm"], fails: true, traps: ['model-not-in-engine'] },
  { code: 'model-not-in-engine-5', netlist: "* an O line (lossy line)\nV1 a 0 1\nRs a b 1\nO1 b 0 c 0 lmod\nRl c 0 1\n.model lmod ltra r=1 l=1n g=0 c=1p len=1\n.op\n.end\n", prints: ["Device type LossyXmissionLine not supported by this binary"], fails: true, traps: ['model-not-in-engine'] },
  { code: 'model-not-in-engine-6', netlist: "* an unused BSIM3 model\nV1 a 0 1\nR1 a 0 1\n.model nm nmos level=49\n.op\n.end\n", vectors: { "v(a)": 1 }, traps: [] },
  { code: 'dc-sweep-problems-1', netlist: "* .dc with a zero step\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 0 12 0\n.end\n", prints: ["Bad syntax!"], fails: true, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-2', netlist: "* .dc without a step\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 0 12\n.end\n", prints: ["Bad syntax!"], fails: true, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-3', netlist: "* .dc with a negative step and a rising range\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 0 12 -1\n.end\n", fails: true, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-4', netlist: "* .dc from 12 down to 0 with a positive step\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 12 0 1\n.end\n", fails: true, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-5', netlist: "* .dc with a step larger than the range\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 0 12 20\n.end\n", vectors: { "v(v-sweep)": 0, "v(out)": 0 }, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-6', netlist: "* .dc sweeping a missing source\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V9 0 12 1\n.end\n", prints: ["named \"v9\" is not in the circuit"], fails: true, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-7', netlist: "* .dc sweeping a capacitor\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.dc C1 1u 2u 1u\n.end\n", prints: ["named \"c1\" is not in the circuit"], fails: true, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-8', netlist: "* .dc from 12 down to 0 with a negative step\nV1 in 0 0\nR1 in out 1k\nR2 out 0 2k\n.dc V1 12 0 -1\n.end\n", vectors: { "v(v-sweep)": [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0] }, traps: [] },
  { code: 'tran-problems-1', netlist: "* .tran with one argument\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran 5m\n.end\n", prints: ["TSTOP is invalid, must be greater than zero."], fails: true, traps: ['tran-problems'] },
  { code: 'tran-problems-2', netlist: "* .tran with a zero step\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran 0 5m\n.end\n", prints: ["TSTEP is invalid, must be greater than zero."], fails: true, traps: ['tran-problems'] },
  { code: 'tran-problems-3', netlist: "* .tran with a step larger than the stop time\nV1 in 0 PULSE(0 1 0 1u 1u 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 1 5m\n.end\n", last: { "time": 0.005, "v(out)": 0.9932860712518419 }, traps: ['tran-problems'] },
  { code: 'tran-problems-4', netlist: "* .tran with tstart after tstop\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m 6m\n.end\n", prints: ["TSTART is invalid, must be less than TSTOP."], fails: true, traps: ['tran-problems'] },
  { code: 'tran-problems-5', netlist: "* .tran with tstart equal to tstop\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran 1u 5m 5m\n.end\n", prints: ["TSTART is invalid, must be less than TSTOP."], fails: true, traps: ['tran-problems'] },
  { code: 'tran-problems-6', netlist: "* .tran with no arguments\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran\n.end\n", prints: ["TSTEP is invalid, must be greater than zero."], fails: true, traps: ['tran-problems'] },
  { code: 'tran-problems-7', netlist: "* .tran with a negative step\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n.tran -1u 5m\n.end\n", prints: ["TSTEP is invalid, must be greater than zero."], fails: true, traps: ['tran-problems'] },
  { code: 'tf-problems-1', netlist: "* .tf naming an output node that does not exist\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\n.tf v(n9) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(output_impedance_at_V(n9))": 1 }, traps: ['tf-problems'] },
  { code: 'tf-problems-2', netlist: "* .tf with a second output node that does not exist\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\n.tf v(n1,n9) V1\n.end\n", vectors: { "v(Transfer_function)": 0.3333333333333333, "v(output_impedance_at_V(n1,n9))": 3 }, traps: ['tf-problems'] },
  { code: 'tf-problems-3', netlist: "* .tf naming a source that does not exist\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\n.tf v(n1) V9\n.end\n", prints: ["Transfer function source v9 not in circuit"], fails: true, traps: ['tf-problems'] },
  { code: 'tf-problems-4', netlist: "* .tf naming a resistor as the input\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\n.tf v(n1) R1\n.end\n", prints: ["Transfer function source r1 not of proper type"], fails: true, traps: ['tf-problems'] },
  { code: 'tf-problems-5', netlist: "* .tf with the current of a resistor as the output\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\n.tf i(R1) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(r1#Output_impedance)": 100000000000000000000 }, traps: ['tf-problems'] },
  { code: 'tf-problems-6', netlist: "* .tf with no input source\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\n.tf v(n1)\n.end\n", prints: ["Transfer function source  not in circuit"], fails: true, traps: ['tf-problems'] },
  { code: 'tf-problems-7', netlist: "* .tf with the current of a missing source as the output\nV1 s 0 24\nR1 s n1 6\nR2 n1 0 3\n.tf i(V9) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v9#Output_impedance)": 100000000000000000000 }, traps: ['tf-problems'] },
  { code: 'no-analysis-1', netlist: "* no analysis line\nV1 a 0 6\nR1 a 0 2\n.end\n", fails: true, traps: ['no-analysis'] },
  { code: 'missing-end-1', netlist: "* no .end line\nV1 n1 0 6\nR1 n1 0 2\n.op\n", vectors: { "v(n1)": 6, "i(v1)": -3 }, traps: ['missing-end'] },
  { code: 'after-end-1', netlist: "* a part after .end\nV1 n1 0 6\nR2 n1 0 3\n.op\n.end\nR1 n1 0 2\n", vectors: { "i(v1)": -5 }, traps: ['after-end'] },
  { code: 'after-end-2', netlist: "* .end with a comment glued to it\nV1 n1 0 6\nR2 n1 0 3\n.op\n.end;the end\nR1 n1 0 2\n", vectors: { "i(v1)": -2 }, traps: ['after-end'] },
  { code: 'zero-ohm-1', netlist: "* a 0 ohm resistor\nV1 a 0 6\nR1 a b 0\nR2 b 0 2\n.op\n.end\n", vectors: { "v(b)": 5.999999999997 }, prints: ["Value of resistor r1 is too small, set to 1.000000e-12"], traps: ['zero-ohm'] },
  { code: 'zero-ohm-2', netlist: "* a 0 ohm resistor across a voltage source\nV1 a 0 6\nR1 a 0 0\n.op\n.end\n", vectors: { "i(v1)": -6000000000000 }, prints: ["Value of resistor r1 is too small, set to 1.000000e-12"], traps: ['zero-ohm'] },
  { code: 'zero-ohm-3', netlist: "* a 0 V source in place of the 0 ohm resistor\nV1 a 0 6\nVR1 a b 0\nR2 b 0 2\n.op\n.end\n", vectors: { "v(b)": 6, "i(vr1)": 3 }, traps: [] },
  { code: 'fatal-syntax-1', netlist: "* an unclosed brace\nV1 a 0 1\nR1 a 0 {1k\n.op\n.end\n", prints: ["Closing \"}\" not found in line fragment"], fails: true, traps: ['fatal-syntax'] },
  { code: 'fatal-syntax-2', netlist: "* an unclosed quote\nV1 a 0 1\nR1 a 0 '2*3\n.op\n.end\n", prints: ["Closing \"}\" not found in line fragment"], fails: true, traps: ['fatal-syntax'] },
  { code: 'fatal-syntax-3', netlist: "* an undefined parameter\nV1 a 0 1\nR1 a 0 {rx}\n.op\n.end\n", prints: ["Undefined parameter [rx]"], fails: true, traps: ['fatal-syntax'] },
  { code: 'fatal-syntax-4', netlist: "* pi inside braces\nI1 0 a 1\nR1 a 0 {2*pi}\n.op\n.end\n", prints: ["Undefined parameter [pi]"], fails: true, traps: ['fatal-syntax'] },
  { code: 'fatal-syntax-5', netlist: "* a defined parameter\n.param rx=2k\nV1 a 0 1\nR1 a 0 {rx}\n.op\n.end\n", vectors: { "i(v1)": -0.0005 }, traps: [] },
  { code: 'fatal-syntax-6', netlist: "* names numparam knows\nI1 0 a 1\nR1 a 0 {1+temper}\nI2 0 b 1\nR2 b 0 {1+hertz}\nI3 0 c 1\nR3 c 0 {1+time}\n.op\n.end\n", vectors: { "v(a)": 28, "v(b)": 1, "v(c)": 1 }, traps: [] },
  { code: 'fatal-syntax-9', netlist: "* pi inside braces, defined\n.param pi=3.141592653589793\nI1 0 a 1\nR1 a 0 {2*pi}\n.op\n.end\n", vectors: { "v(a)": 6.283185307179586 }, traps: [] },
  { code: 'fatal-syntax-7', netlist: "* a B line without V= or I=\nV1 a 0 1\nR1 a 0 1\nB1 b 0 5\nR2 b 0 1\n.op\n.end\n", prints: ["mal formed B source instance"], fails: true, traps: ['fatal-syntax'] },
  { code: 'fatal-syntax-8', netlist: "* a B line with an empty formula\nV1 a 0 1\nR1 a 0 1\nB1 b 0 V=\nR2 b 0 1\n.op\n.end\n", prints: ["YYparse error"], fails: true, traps: ['fatal-syntax'] },
  { code: 'include-not-available-1', netlist: "* an include line\nV1 a 0 1\nR1 a 0 1\n.include models.lib\n.op\n.end\n", prints: ["Could not find include file models.lib"], fails: true, traps: ['include-not-available'] },
  { code: 'include-not-available-2', netlist: "* a lib line\nV1 a 0 1\nR1 a 0 1\n.lib models.lib tt\n.op\n.end\n", prints: ["Could not find library file models.lib"], fails: true, traps: ['include-not-available'] },
  { code: 'lost-continuation-1', netlist: "* a ; comment line between a line and its continuation\nI1 0 n1 1\nR0 n1 0 1k\nR1 n1 0\n; a semicolon comment\n+ 2\n.op\n.end\n", vectors: { "v(n1)": 1000 }, prints: ["'r1 n1 0' is not a valid resistor instance line, ignored!"], traps: ['missing-value', 'lost-continuation'] },
  { code: 'lost-continuation-2', netlist: "* a ! line between a line and its continuation\nI1 0 n1 1\nR0 n1 0 1k\nR1 n1 0\n! an odd comment\n+ 2\n.op\n.end\n", vectors: { "v(n1)": 1000 }, prints: ["'r1 n1 0' is not a valid resistor instance line, ignored!"], traps: ['missing-value', 'lost-continuation'] },
  { code: 'lost-continuation-3', netlist: "* a + line right after the title\n+ R1 n1 0 2\nI1 0 n1 1\nR2 n1 0 4\n.op\n.end\n", vectors: { "v(n1)": 4 }, traps: ['lost-continuation'] },
  { code: 'lost-continuation-4', netlist: "* a * comment line between a line and its continuation\nI1 0 n1 1\nR0 n1 0 1k\nR1 n1 0\n* a star comment\n+ 2\n.op\n.end\n", vectors: { "v(n1)": 1.996007984031936 }, traps: [] },
  // Added by the core review of 10 Nov 2026 (docs/spice-facts/review.md).
  { code: 'control-source-4', netlist: "* F and H reading the current of E, H and a B source with V=\nV1 a 0 6\nE1 e 0 a 0 1\nRe e 0 3\nF1 0 p E1 1\nRp p 0 1\nVs a b 0\nRb b 0 6\nH1 h 0 Vs 2\nRh h 0 1\nH2 k 0 H1 3\nRk k 0 1\nB1 c 0 V=2*v(a)\nRc c 0 6\nF2 0 q B1 1\nRq q 0 1\n.op\n.end\n", vectors: {"v(p)":-2,"v(k)":-6,"v(q)":-2}, traps: [] },
  { code: 'control-source-5', netlist: "* F reading a B source with I=\nV1 a 0 6\nB1 0 b I=v(a)/6\nRb b 0 6\nF1 0 p B1 1\nRp p 0 1\n.op\n.end\n", prints: ["singular matrix:  check node b1#branch","The operating point could not be simulated successfully"], fails: true, unreliable: true, traps: ['control-source'] },
  { code: 'control-source-6', netlist: "* F naming a current source\nV1 a 0 6\nRa a 0 6\nI1 0 b 2\nRb b 0 6\nF1 0 p I1 1\nRp p 0 1\n.op\n.end\n", prints: ["f1: unknown controlling source i1"], fails: true, traps: ['control-source'] },
  { code: 'control-source-7', netlist: "* F naming a capacitor\nV1 a 0 6\nC1 a 0 1u\nRa a 0 6\nF1 0 p C1 1\nRp p 0 1\n.op\n.end\n", prints: ["f1: unknown controlling source c1"], fails: true, traps: ['control-source'] },
  { code: 'control-source-8', netlist: "* H naming a G source\nV1 a 0 6\nRa a 0 6\nG1 0 g a 0 1\nRg g 0 1\nH1 h 0 G1 3\nRh h 0 1\n.op\n.end\n", prints: ["h1: unknown controlling source g1"], fails: true, traps: ['control-source'] },
  { code: 'control-source-9', netlist: "* H naming an F source\nV1 a 0 6\nVs a b 0\nRb b 0 6\nF1 0 f Vs 2\nRf f 0 1\nH1 h 0 F1 3\nRh h 0 1\n.op\n.end\n", prints: ["h1: unknown controlling source f1"], fails: true, traps: ['control-source'] },
  { code: 'unknown-word-1', netlist: "* an unknown word after a resistor value\nV1 a 0 5\nR1 a 0 1k load\n.op\n.end\n", prints: ["unknown parameter (load)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-2', netlist: "* an unknown word after a capacitor value\nV1 a 0 5\nR1 a b 1k\nC1 b 0 1u big\n.op\n.end\n", prints: ["unknown parameter (big)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-3', netlist: "* a stray word after a voltage source value\nV1 a 0 5 battery\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (battery)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-4', netlist: "* a second number after a gain\nV1 a 0 1\nR0 a 0 1\nE1 b 0 a 0 2 3\nR1 b 0 1\n.op\n.end\n", prints: ["unknown parameter (3)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-5', netlist: "* a word after a gain\nV1 a 0 1\nR0 a 0 1\nE1 b 0 a 0 2 fast\nR1 b 0 1\n.op\n.end\n", prints: ["unknown parameter (fast)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-6', netlist: "* a value the resistor can only report\nI1 0 n1 1\nR1 n1 0 1k i\n.op\n.end\n", prints: ["no such parameter on this device or parameter is missing"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-7', netlist: "* an unknown word after an inductor value\nV1 a 0 5\nR1 a b 1k\nL1 b 0 1m coil\n.op\n.end\n", prints: ["unknown parameter (coil)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-8', netlist: "* three numbers on a resistor\nV1 a 0 5\nR1 a 0 1k 2k 3k\n.op\n.end\n", prints: ["unknown parameter (3k)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-9', netlist: "* 1d-3 on a voltage source\nV1 n1 0 1d-3\nR1 n1 0 1\n.op\n.end\n", prints: ["unknown parameter (-3)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-10', netlist: "first-letter test [+]\nRref a 0 1\n+1 a 0 5\n.op\n.end\n", prints: ["unknown parameter (a)"], fails: true, traps: ['dangling-node', 'unknown-word'] },
  { code: 'unknown-word-11', netlist: "* i after a gain\nV1 a 0 1\nR0 a 0 1\nE1 b 0 a 0 2 i\nR1 b 0 1\n.op\n.end\n", prints: ["no such parameter on this device or parameter is missing"], fails: true, traps: ['unknown-word'] },
  { code: 'space-before-suffix-15', netlist: "* a space before p on a gain\nV1 a 0 1\nR0 a 0 1\nE1 b 0 a 0 2 p\nR1 b 0 1\n.op\n.end\n", prints: ["no such parameter on this device or parameter is missing"], fails: true, traps: ['space-before-suffix'] },
  { code: 'unknown-dot-command-1', netlist: "* a misspelt dot command\nV1 a 0 1\nR1 a 0 1k\n.tarn 1u 1m\n.op\n.end\n", prints: ["unimplemented dot command '.tarn'"], fails: true, traps: ['unknown-dot-command'] },
  { code: 'unknown-dot-command-2', netlist: "* .pss in a netlist\nV1 a 0 1\nR1 a 0 1k\n.pss 1k 1m a 1\n.op\n.end\n", prints: ["unimplemented dot command '.pss'"], fails: true, traps: ['unknown-dot-command'] },
  { code: 'unknown-letter-17', netlist: "first-letter test [P]\nRref a 0 1\nP1 a 0 5\n.op\n.end\n", prints: ["Unable to find definition of model 5"], fails: true, traps: ['unknown-letter'] },
  { code: 'missing-model-7', netlist: "first-letter test [D]\nRref a 0 1\nD1 a 0 5\n.op\n.end\n", prints: ["could not find a valid modelname"], fails: true, traps: ['missing-model'] },
  { code: 'fatal-syntax-10', netlist: "* a function with an argument\nV1 a 0 1\nR1 a 0 1k\n.func dbl(x) {2*x}\nR2 a 0 {dbl(1k)}\n.op\n.end\n", vectors: {"i(v1)":-0.0015}, traps: [] },
  { code: 'fatal-syntax-11', netlist: "* v() and i() inside braces\nV1 in 0 1\nR1 in 0 1k\nB1 out 0 V={2*v(in)}\nR2 out 0 1k\nB2 o2 0 V={2*i(V1)}\nR3 o2 0 1k\nR4 in 0 {2*v(in)}\n.op\n.end\n", vectors: {"v(out)":2,"v(o2)":-1.002}, traps: [] },
  { code: 'include-not-available-3', netlist: "* .lib with one word\nV1 a 0 1\nR1 a 0 1k\n.lib models.lib\n.op\n.end\n", prints: ["unimplemented dot command '.lib'"], fails: true, traps: ['include-not-available'] },
  { code: 'unknown-dot-command-3', netlist: "* .endl in the netlist\nV1 a 0 1\nR1 a 0 1k\n.endl\n.op\n.end\n", prints: ["unimplemented dot command '.endl'"], fails: true, traps: ['unknown-dot-command'] },
  { code: 'missing-value-8', netlist: "* a resistor with a setting but no value\nI1 0 a 1\nR0 a 0 1k\nR1 a 0 m=2\n.op\n.end\n", vectors: {"v(a)":0.000499999750000125}, prints: ["r1: resistance too low or not given, set to 1 mOhm"], traps: ['missing-value'] },
  { code: 'missing-value-9', netlist: "* a capacitor with ic= but no value\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 ic=0.5\n.tran 1u 5u\n.end\n", last: { "v(out)": 1 }, traps: ['missing-value'] },
  { code: 'missing-value-10', netlist: "* an inductor with ic= but no value\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nL1 out 0 ic=1m\n.tran 1u 5u\n.end\n", last: { "v(out)": 0 }, traps: ['missing-value'] },
  // Added after the final reviews of 12 Nov 2026: names ngspice spells with underscores (W16-W18).
  { code: 'non-ascii-node-1', netlist: "* node names with Turkish letters\nV1 giri\u015f 0 12\nR1 giri\u015f \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 2k\n.op\n.end\n", vectors: { "v(giri__)": 12, "v(____k____)": 8, "i(v1)": -0.004 }, traps: ['non-ascii-node', 'non-ascii-node'] },
  { code: 'non-ascii-node-2', netlist: "* two node names that become one\nV1 \u015f 0 12\nR1 \u015f \u00e7 1k\nR2 \u00e7 0 2k\n.op\n.end\n", vectors: { "v(__)": 12, "i(v1)": -0.006 }, traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-3', netlist: "* a .print line naming a node with Turkish letters\nV1 in 0 12\nR1 in \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 2k\n.dc V1 0 12 6\n.print dc v(\u00e7\u0131k\u0131\u015f)\n.end\n", vectors: { "v(____k____)": [0, 4, 8], "i(v1)": [0, -0.002, -0.004] }, prints: [".print line ignored since rawfile was produced."], traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-4', netlist: "* commands in a .control block naming a node with Turkish letters\nV1 in 0 12\nR1 in \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 2k\n.dc V1 0 12 6\n.control\nrun\nprint v(\u00e7\u0131k\u0131\u015f)\nsave v(\u00e7\u0131k\u0131\u015f)\nrun\n.endc\n.end\n", prints: ["vector \u00e7\u0131k\u0131\u015f is not available or has zero length", "no data saved for D.C. Transfer curve analysis; analysis not run"], fails: true, traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-5', netlist: "* a\u00b5 and au are one node\nV1 a\u00b5 0 12\nR1 a\u00b5 au 1k\nR2 au 0 2k\n.options savecurrents\n.op\n.end\n", vectors: { "v(au)": 12, "i(v1)": -0.006, "i(@r1[i])": 0, "i(@r2[i])": 0.006 }, traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-6', netlist: "* g\u00f1d is not ground, and neither is gnd2: gnd is\nV1 a 0 5\nR1 a g\u00f1d 1k\nR2 g\u00f1d 0 1k\nR3 a gnd2 1k\nR4 gnd2 0 1k\nR5 a gnd 1k\nR6 gnd 0 1k\n.options savecurrents\n.op\n.end\n", vectors: { "v(g__d)": 2.5, "v(gnd2)": 2.5, "i(@r2[i])": 0.0025, "i(@r5[i])": 0.005, "i(@r6[i])": 0, "i(v1)": -0.009999999999999998 }, traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-7', netlist: "* a save that names a current too: the analysis runs\nV1 in 0 12\nR1 in \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 2k\n.dc V1 0 12 6\n.control\nsave v(\u00e7\u0131k\u0131\u015f) i(v1)\nrun\n.endc\n.end\n", vectors: { "v(v-sweep)": [0, 6, 12], "i(v1)": [0, -0.002, -0.004] }, traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-8', netlist: "* save all before the save: the node is saved anyway\nV1 in 0 12\nR1 in \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 2k\n.dc V1 0 12 6\n.control\nsave all\nsave v(\u00e7\u0131k\u0131\u015f)\nrun\n.endc\n.end\n", vectors: { "v(in)": [0, 6, 12], "v(____k____)": [0, 4, 8], "i(v1)": [0, -0.002, -0.004] }, traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-9', netlist: "* .op as PlainSpice runs it, with .options savecurrents\nV1 in 0 12\nR1 in \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 2k\n.op\n.control\nsave v(\u00e7\u0131k\u0131\u015f)\nrun\n.endc\n.options savecurrents\n.end\n", vectors: { "i(@r1[i])": 0.004, "i(@r2[i])": 0.004 }, traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-10', netlist: "* a capacitor and a diode with an end on a\u00b5 and one on au\nV1 in 0 PULSE(0 12 0 10u 10u 1 2)\nR1 in a\u00b5 1k\nC1 a\u00b5 au 1u\nD1 a\u00b5 au dd\nR2 au 0 2k\n.model dd D\n.options savecurrents\n.tran 10u 50u\n.end\n", last: { "v(au)": 8, "i(@c1[i])": 0, "i(@d1[id])": 0, "i(@r2[i])": 0.004 }, traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-11', netlist: "* a current source with an end on a\u00b5 and one on au\nV1 in 0 12\nR1 in a\u00b5 1k\nI1 a\u00b5 au 1m\nR2 au 0 2k\n.options savecurrents\n.op\n.end\n", vectors: { "v(au)": 8, "i(@i1[current])": 0.001, "i(@r1[i])": 0.004, "i(@r2[i])": 0.004 }, traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-12', netlist: "* a capacitor given a starting voltage, with an end on a\u00b5 and one on au\nV1 in 0 12\nR1 in a\u00b5 1k\nC1 a\u00b5 au 1u ic=5\nR2 au 0 2k\n.options savecurrents\n.tran 1u 10u uic\n.end\n", last: { "v(au)": 8, "i(@c1[i])": 0, "i(@r1[i])": 0.004, "i(@r2[i])": 0.004 }, traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-13', netlist: "* a .print line naming a node with Turkish letters beside one ngspice finds\nV1 in 0 12\nR1 in \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 2k\n.dc V1 0 12 6\n.print dc v(in) v(\u00e7\u0131k\u0131\u015f)\n.end\n", vectors: { "v(in)": [0, 6, 12], "v(____k____)": [0, 4, 8], "i(v1)": [0, -0.002, -0.004] }, prints: [".print line ignored since rawfile was produced."], traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-14', netlist: "* a save of the name in a .control block, read before the .print line\nV1 in 0 12\nR1 in \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 2k\n.dc V1 0 12 6\n.print dc v(\u00e7\u0131k\u0131\u015f)\n.control\nsave v(\u00e7\u0131k\u0131\u015f)\nrun\n.endc\n.end\n", prints: ["no data saved for D.C. Transfer curve analysis; analysis not run", ".print line ignored since rawfile was produced."], fails: true, traps: ['non-ascii-node'] },
  { code: 'duplicate-name-3', netlist: "* two part names that become one\nV1 a 0 6\nR\u015f a 0 2\nR\u00e7 a 0 3\n.op\n.end\n", prints: ["device already exists"], fails: true, traps: ['duplicate-name'] },
  { code: 'duplicate-name-4', netlist: "* R\u00b5 and Ru are the same name: ngspice reads \u00b5 as u\nV1 a 0 6\nR\u00b5 a 0 2\nRu a 0 3\n.op\n.end\n", prints: ["device already exists", "ru a 0 3"], fails: true, traps: ['duplicate-name'] },
  // Added after the final reviews of 12 Nov 2026: characters that are not what they look like (W16).
  { code: 'space-before-suffix-16', netlist: "* a space before the ohm sign\nI1 0 n1 1\nR1 n1 0 1 Ω\n.op\n.end\n", prints: ["unknown parameter (__)"], fails: true, traps: ['space-before-suffix'] },
  { code: 'space-before-suffix-17', netlist: "* a space before the micro sign\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1 µ\n.op\n.end\n", prints: ["unknown parameter (u)"], fails: true, traps: ['space-before-suffix'] },
  { code: 'unknown-word-12', netlist: "* a word with a Turkish letter after a value\nV1 a 0 5\nR1 a 0 1k yük\n.op\n.end\n", prints: ["unknown parameter (y__k)"], fails: true, traps: ['unknown-word'] },
  { code: 'invisible-character-1', netlist: "* a zero-width space inside a value\nV1 in 0 6\nR1 in out 1​k\nR2 out 0 2k\n.op\n.end\n", vectors: { "v(out)": 5.997001499250375, "i(v1)": -0.0029985007496247107 }, traps: ['invisible-character'] },
  { code: 'invisible-character-2', netlist: "* other invisible characters inside a value\nI1 0 n1 1\nR1 n1 0 1﻿k\nI2 0 n2 1\nR2 n2 0 1⁠k\nI3 0 n3 1\nR3 n3 0 1­k\nI4 0 n4 1\nR4 n4 0 1‎k\nI5 0 n5 1\nR5 n5 0 1‮k\nI6 0 n6 1\nR6 n6 0 1‍k\n.op\n.end\n", vectors: { "v(n1)": 1, "v(n2)": 1, "v(n3)": 1, "v(n4)": 1, "v(n5)": 1, "v(n6)": 1 }, traps: ['invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character'] },
  { code: 'invisible-character-3', netlist: "* a zero-width space inside a node name\nV1 in 0 6\nR1 in out 1k\nR2 ou​t 0 2k\n.op\n.end\n", vectors: { "v(out)": 6, "v(ou___t)": 0, "i(v1)": 0 }, traps: ['invisible-character'] },
  { code: 'invisible-character-4', netlist: "* a zero-width space after the scale letter\nV1 in 0 6\nR1 in out 1k​\nR2 out 0 2k\n.op\n.end\n", vectors: { "v(out)": 4, "i(v1)": -0.002 }, traps: [] },
  { code: 'invisible-character-5', netlist: "* a zero-width space before a resistor value\nI1 0 a 1\nR0 a 0 1k\nR1 a 0 ​2k\n.op\n.end\n", prints: ["unknown parameter (___2k)"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-6', netlist: "* a zero-width space right after the minus sign of a value\nV1 a 0 -\u200b5\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (-___5)"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-7', netlist: "* a zero-width space in a node name, on a .print line\nV1 in 0 12\nR1 in ou\u200bt 1k\nR2 ou\u200bt 0 2k\n.dc V1 0 12 6\n.print dc v(ou\u200bt)\n.end\n", vectors: { "v(ou___t)": [0, 4, 8], "i(v1)": [0, -0.002, -0.004] }, prints: [".print line ignored since rawfile was produced."], traps: ['invisible-character'] },
  { code: 'invisible-character-8', netlist: "* a zero-width space in a node name, saved in a .control block\nV1 in 0 12\nR1 in ou\u200bt 1k\nR2 ou\u200bt 0 2k\n.dc V1 0 12 6\n.control\nsave v(ou\u200bt)\nrun\n.endc\n.end\n", prints: ["no data saved for D.C. Transfer curve analysis; analysis not run"], fails: true, traps: ['invisible-character'] },
  { code: 'look-alike-letter-1', netlist: "* letters that look like k and m\nI1 0 n1 1\nR1 n1 0 1к\nI2 0 n2 1\nR2 n2 0 1κ\nI3 0 n3 1\nR3 n3 0 1ｋ\nI4 0 n4 1\nR4 n4 0 2м\n.op\n.end\n", vectors: { "v(n1)": 1, "v(n2)": 1, "v(n3)": 1, "v(n4)": 2 }, traps: ['look-alike-letter', 'look-alike-letter', 'look-alike-letter', 'look-alike-letter'] },
  { code: 'look-alike-letter-2', netlist: "* a minus sign copied from a document on a voltage source\nV1 a 0 −5\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (___5)"], fails: true, traps: ['look-alike-letter'] },
  { code: 'look-alike-letter-3', netlist: "* a Kelvin sign, a fullwidth digit and full stop, a minus sign and a dash in values\nI1 0 n1 1\nR1 n1 0 1\u212a\nI2 0 n2 1\nR2 n2 0 1\uff10k\nI3 0 n3 1\nR3 n3 0 1\uff0e5k\nI4 0 n4 1\nR4 n4 0 1e\u22123\nI5 0 n5 1\nR5 n5 0 1e\u20133\n.op\n.end\n", vectors: { "v(n1)": 1, "v(n2)": 1, "v(n3)": 1, "v(n4)": 1, "v(n5)": 1 }, traps: ['look-alike-letter', 'look-alike-letter', 'look-alike-letter', 'look-alike-letter', 'look-alike-letter'] },
  { code: 'look-alike-letter-4', netlist: "* letters that look like a capital M: Greek, Cyrillic and fullwidth\nI1 0 n1 1u\nR1 n1 0 10\u039c\nI2 0 n2 1u\nR2 n2 0 10\u041c\nI3 0 n3 1u\nR3 n3 0 10\uff2d\n.op\n.end\n", vectors: { "v(n1)": 0.000009999999999999999, "v(n2)": 0.000009999999999999999, "v(n3)": 0.000009999999999999999 }, traps: ['look-alike-letter', 'look-alike-letter', 'look-alike-letter'] },
  { code: 'look-alike-letter-5', netlist: "* a Cyrillic o in a node name\nV1 in 0 6\nR1 in out 1k\nR2 \u043eut 0 2k\n.op\n.end\n", vectors: { "v(in)": 6, "v(out)": 6, "v(__ut)": 0, "i(v1)": 0 }, traps: ['look-alike-letter'] },
  { code: 'look-alike-letter-6', netlist: "* a fullwidth digit right after the minus sign of a value\nV1 a 0 -\uff15\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (-___)"], fails: true, traps: ['look-alike-letter'] },
  { code: 'look-alike-letter-7', netlist: "* a Cyrillic \u043e in a node name, on a .print line\nV1 in 0 12\nR1 in \u043eut 1k\nR2 \u043eut 0 2k\n.dc V1 0 12 6\n.print dc v(\u043eut)\n.end\n", vectors: { "v(__ut)": [0, 4, 8], "i(v1)": [0, -0.002, -0.004] }, prints: [".print line ignored since rawfile was produced."], traps: ['look-alike-letter'] },
  { code: 'look-alike-letter-8', netlist: "* a Cyrillic \u043e in a node name, saved in a .control block\nV1 in 0 12\nR1 in \u043eut 1k\nR2 \u043eut 0 2k\n.dc V1 0 12 6\n.control\nsave v(\u043eut)\nrun\n.endc\n.end\n", prints: ["no data saved for D.C. Transfer curve analysis; analysis not run"], fails: true, traps: ['look-alike-letter'] },
  { code: 'space-character-1', netlist: "* a thin space between a value and its unit, as documents write 4.7 k\u03a9 and 1 M\u03a9\nV1 in 0 10\nR1 in out 4.7\u2009k\u03a9\nR2 out 0 4.7k\nR3 in out2 1\u2009M\u03a9\nR4 out2 0 1meg\n.op\n.end\n", vectors: { "v(in)": 10, "v(out)": 9.99000999000999, "v(out2)": 9.999990000010001, "i(v1)": -0.002135534030427877 }, traps: ['space-character', 'space-character'] },
  { code: 'space-character-2', netlist: "* the other space characters inside a value\nI1 0 n1 1\nR1 n1 0 1\u1680k\nI2 0 n2 1\nR2 n2 0 1\u2000k\nI3 0 n3 1\nR3 n3 0 1\u2001k\nI4 0 n4 1\nR4 n4 0 1\u2002k\nI5 0 n5 1\nR5 n5 0 1\u2003k\nI6 0 n6 1\nR6 n6 0 1\u2004k\nI7 0 n7 1\nR7 n7 0 1\u2005k\nI8 0 n8 1\nR8 n8 0 1\u2006k\nI9 0 n9 1\nR9 n9 0 1\u2007k\nI10 0 n10 1\nR10 n10 0 1\u2008k\nI11 0 n11 1\nR11 n11 0 1\u2009k\nI12 0 n12 1\nR12 n12 0 1\u200ak\nI13 0 n13 1\nR13 n13 0 1\u202fk\nI14 0 n14 1\nR14 n14 0 1\u205fk\nI15 0 n15 1\nR15 n15 0 1\u3000k\n.op\n.end\n", vectors: { "v(n1)": 1, "v(n2)": 1, "v(n3)": 1, "v(n4)": 1, "v(n5)": 1, "v(n6)": 1, "v(n7)": 1, "v(n8)": 1, "v(n9)": 1, "v(n10)": 1, "v(n11)": 1, "v(n12)": 1, "v(n13)": 1, "v(n14)": 1, "v(n15)": 1 }, traps: ['space-character', 'space-character', 'space-character', 'space-character', 'space-character', 'space-character', 'space-character', 'space-character', 'space-character', 'space-character', 'space-character', 'space-character', 'space-character', 'space-character', 'space-character'] },
  { code: 'space-character-3', netlist: "* a thin space between groups of digits, as documents write 10 000\nI1 0 n1 1\nR1 n1 0 10\u2009000\nI2 0 n2 1\nR2 n2 0 2\u202f200\n.op\n.end\n", vectors: { "v(n1)": 10, "v(n2)": 2 }, traps: ['space-character', 'space-character'] },
  { code: 'space-character-4', netlist: "* a thin space between two words of a line\nI1 0 n1 1\nR1 n1 0\u20092\nR2 n1 0 1\n.op\n.end\n", vectors: { "v(n1)": 1 }, prints: ["'r1 n1 0___2' is not a valid resistor instance line, ignored!"], traps: ['missing-value', 'space-character'] },
  { code: 'space-character-5', netlist: "* a value that starts with a thin space\nI1 0 a 1\nR0 a 0 1k\nR1 a 0 \u20092k\n.op\n.end\n", prints: ["unknown parameter (___2k)"], fails: true, traps: ['space-character'] },
  { code: 'space-character-6', netlist: "* a thin space after the scale letter changes nothing\nV1 in 0 10\nR1 in out 4.7k\u2009\u03a9\nR2 out 0 4.7k\n.op\n.end\n", vectors: { "v(in)": 10, "v(out)": 5, "i(v1)": -0.0010638297872340426 }, traps: [] },
  { code: 'space-character-7', netlist: "* groups of digits and a unit, as documents write 10 000 Ω, 4 700 Ω and 1 000k\nI1 0 n1 1\nR1 n1 0 10 000 Ω\nI2 0 n2 1\nR2 n2 0 4 700 Ω\nI3 0 n3 1\nR3 n3 0 1 000k\n.op\n.end\n", vectors: { "v(n1)": 10, "v(n2)": 4, "v(n3)": 1 }, traps: ['space-character', 'space-character', 'space-character'] },
  { code: 'space-character-8', netlist: "* 1 000 µF and 470 µF as documents write them, on capacitors\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1\nC1 out 0 1 000 µF\nR2 in out2 1\nC2 out2 0 470 µF\n.tran 0.1m 1m\n.end\n", last: { "v(out)": 0.000999499667207256, "v(out2)": 0.000002127656247281666 }, sig6: true, prints: ["can't find model '1 000 uf'", "can't find model '470 uf'"], traps: ['space-character', 'space-character'] },
  { code: 'space-character-9', netlist: "* 10 000 Ω written with normal spaces: three words\nV1 in 0 10\nR1 in out 10 000 Ω\nR2 out 0 10k\n.op\n.end\n", prints: ["Value of resistor r1 is too small, set to 1.000000e-12", "unknown parameter (__)"], fails: true, traps: ['zero-ohm', 'unknown-word'] },
  { code: 'space-character-10', netlist: "* a thin space and a no-break space inside node names\nV1 in 0 10\nR1 in o ut 2k\nR2 out 0 2k\nR3 in o ut 2k\n.op\n.end\n", vectors: { "v(in)": 10, "v(o___ut)": 10, "v(out)": 0, "v(o__ut)": 10, "i(v1)": 0 }, traps: ['space-character', 'nbsp'] },
  { code: 'space-character-11', netlist: "* a thin space that is not between groups of three digits: 0.000 001 and 1 2\nI1 0 n1 1\nR1 n1 0 0.000 001\nR2 n1 0 1\nI2 0 n2 1\nR3 n2 0 1 2\n.op\n.end\n", vectors: { "v(n1)": 9.99999999999e-13, "v(n2)": 1 }, prints: ["Value of resistor r1 is too small, set to 1.000000e-12"], traps: ['space-character', 'zero-ohm', 'space-character'] },
  { code: 'space-character-12', netlist: "* a thin space in a node name, on a .print line\nV1 in 0 12\nR1 in o\u2009ut 1k\nR2 o\u2009ut 0 2k\n.dc V1 0 12 6\n.print dc v(o\u2009ut)\n.end\n", vectors: { "v(o___ut)": [0, 4, 8], "i(v1)": [0, -0.002, -0.004] }, prints: [".print line ignored since rawfile was produced."], traps: ['space-character'] },
  { code: 'space-character-13', netlist: "* a thin space in a node name, saved in a .control block\nV1 in 0 12\nR1 in o\u2009ut 1k\nR2 o\u2009ut 0 2k\n.dc V1 0 12 6\n.control\nsave v(o\u2009ut)\nrun\n.endc\n.end\n", prints: ["no data saved for D.C. Transfer curve analysis; analysis not run"], fails: true, traps: ['space-character'] },
];

const root = resolve(import.meta.dirname, '../..');
const runs = new Map<string, RunResult>();
const fixed = new Map<string, { label: string; netlist: string; run: RunResult }[]>();

beforeAll(async () => {
  const engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
  for (const f of FACTS) {
    runs.set(f.code, await engine.run(f.netlist));
    const list: { label: string; netlist: string; run: RunResult }[] = [];
    for (const t of checkTraps(parseNetlist(f.netlist))) {
      for (const fix of t.fixes) {
        const netlist = applyFix(f.netlist, fix);
        list.push({ label: `${t.id}: ${fix.label}`, netlist, run: await engine.run(netlist) });
      }
    }
    fixed.set(f.code, list);
  }
});

const vector = (r: RunResult, name: string): number[] | undefined => {
  for (const p of r.plots) {
    const i = p.variables.findIndex((v) => v.name === name);
    if (i >= 0) return Array.from(p.real[i]!);
  }
  return undefined;
};

describe.each(FACTS)('$code', (fact) => {
  it('our engine does what the trap says ngspice does', () => {
    const r = runs.get(fact.code)!;
    expect(r.ok).toBe(!fact.fails);
    expect(r.unreliable).toBe(fact.unreliable === true);
    for (const [name, want] of Object.entries(fact.vectors ?? {})) {
      expect(vector(r, name), name).toEqual(Array.isArray(want) ? want : [want]);
    }
    for (const [name, want] of Object.entries(fact.last ?? {})) {
      const values = vector(r, name);
      expect(values, name).toBeDefined();
      const got = values![values!.length - 1]!;
      if (fact.sig6) expect(agrees(got, want), `${name}: ${got} vs ${want}`).toBe(true);
      else expect(got, name).toBe(want);
    }
    for (const text of fact.prints ?? []) expect(`${r.stdout}\n${r.stderr}`).toContain(text);
  });

  it('the trap checks find exactly these traps', () => {
    expect(checkTraps(parseNetlist(fact.netlist)).map((t) => t.id)).toEqual(fact.traps);
  });

  it('every fix the traps offer runs cleanly in our engine', () => {
    for (const f of fixed.get(fact.code)!) {
      expect(f.run.ok, `${f.label}\n${f.netlist}${f.run.stderr}`).toBe(true);
      expect(f.run.unreliable, `${f.label}\n${f.netlist}`).toBe(false);
    }
  });
});

it('non-ascii-node-6: the fix keeps gñd off ground: gnd3 is 2.5 V, as g__d was (code-3)', () => {
  const [f] = fixed.get('non-ascii-node-6')!;
  expect(f!.label).toBe('non-ascii-node: Rename g\u00f1d to gnd3');
  expect(vector(f!.run, 'v(gnd3)')).toEqual([2.5]);
  expect(vector(f!.run, 'i(@r2[i])')).toEqual([0.0025]);
});

it('non-ascii-node-3, -4, -14: the rename writes the plain name on the .print line and in the .control block too, and the run then gives v(cikis) (S10)', () => {
  for (const code of ['non-ascii-node-3', 'non-ascii-node-4', 'non-ascii-node-14']) {
    const [f] = fixed.get(code)!;
    expect(f!.netlist, code).not.toContain('\u00e7\u0131k\u0131\u015f');
    expect(vector(f!.run, 'v(cikis)'), code).toEqual([0, 4, 8]);
  }
});

it('non-ascii-node-5: the fix gives aµ a plain name of its own, and R1 then carries current: a divider (words-recheck-8)', () => {
  const [f] = fixed.get('non-ascii-node-5')!;
  expect(f!.label).toBe('non-ascii-node: Rename a\u00b5 to au2');
  expect(vector(f!.run, 'v(au2)')).toEqual([12]);
  expect(vector(f!.run, 'v(au)')).toEqual([8]);
  expect(vector(f!.run, 'i(@r1[i])')).toEqual([0.004]);
});

it('non-ascii-node-10: the capacitor and the diode between aµ and au carry no current at any point of the run (names lane critic, 2)', () => {
  const r = runs.get('non-ascii-node-10')!;
  for (const name of ['i(@c1[i])', 'i(@d1[id])']) {
    const values = vector(r, name)!;
    expect(values.length, name).toBe(62);
    expect(values.every((x) => x === 0), name).toBe(true);
  }
  // R1 and R2 carry the source's current all the while.
  expect(Math.max(...vector(r, 'i(@r1[i])')!)).toBe(0.004);
});

it('non-ascii-node-12: the capacitor given ic=5 between aµ and au carries −5000 A at the first point under uic, then nothing (names lane critic 2, 5)', () => {
  const r = runs.get('non-ascii-node-12')!;
  const values = vector(r, 'i(@c1[i])')!;
  expect(values.length).toBe(76);
  expect(agrees(values[0]!, -5000), String(values[0])).toBe(true);
  expect(values.slice(1).every((x) => x === 0)).toBe(true);
  expect(vector(r, 'i(@r1[i])')!.every((x) => x === 0.004)).toBe(true);
});

it('runs every offered fix (there are many)', () => {
  expect([...fixed.values()].flat().length).toBeGreaterThan(90);
});
