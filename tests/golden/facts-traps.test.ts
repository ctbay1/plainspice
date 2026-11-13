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
import { applyEdit, buildSchematic } from '../../src/schematic/index.ts';
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
  /**
   * The netlist has more than one problem, so no single fix makes it run: each fix must take its own trap away,
   * and the fixes, applied one after another as the traps then offer them, must give a clean run.
   */
  several?: true;
  /**
   * Two traps of the same kind, each with its own fix (two nodes with no DC path, floating-dc-8): a fix
   * mends its own trap only, so the fixes are applied in turn, each to the netlist the one before made,
   * and the last netlist must run cleanly.
   */
  fixInTurn?: true;
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
  { code: 'missing-fields-9', netlist: "* one word between the output nodes and the formula\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e 0 x VALUE={2}\nRe e 0 1k\n.op\n.end\n", vectors: { "v(e)": 2 }, traps: ['missing-fields'] },
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
  { code: 'floating-dc-7', netlist: "* a floating group of two nodes: ngspice names x, not node1\nV1 in 0 5\nC1 in node1 1u\nR1 node1 x 1k\nC2 x 0 1u\n.op\n.end\n", vectors: { "v(in)": 4.9999999999949996, "v(node1)": 4.950496683061028, "v(x)": 0.04950331688396305, "i(v1)": -0.0049009933711090525 }, prints: ["singular matrix:  check node x"], unreliable: true, traps: ['floating-dc'] },
  { code: 'floating-dc-8', netlist: "* two capacitor-only nodes\nV1 in 0 6\nC1 in a 1u\nC2 a 0 1u\nC3 in b 1u\nC4 b 0 1u\n.op\n.end\n", vectors: { "v(in)": 5.9999999999939995, "v(a)": 2.9999999999819513, "v(b)": 2.9999999999819513, "i(v1)": -4.888534022029489e-12 }, prints: ["singular matrix:  check node a"], unreliable: true, traps: ['floating-dc', 'floating-dc'], fixInTurn: true },
  { code: 'floating-dc-9', netlist: "* a control input on two nodes joined only by a resistor\nV1 a 0 6\nR1 a 0 2\nE1 out 0 c d 2\nR2 out 0 1\nR3 c d 1k\n.op\n.end\n", vectors: { "v(a)": 5.9999999999939995, "v(out)": 0, "v(c)": 0, "v(d)": 0, "i(e1)": 0, "i(v1)": -2.9999999999939995 }, prints: ["singular matrix:  check node c", "Transient op finished successfully"], unreliable: true, traps: ['floating-dc'] },
  { code: 'floating-dc-10', netlist: "* a control input on two nodes with nothing else on them\nV1 a 0 6\nR1 a 0 2\nE1 out 0 c d 2\nR2 out 0 1\n.op\n.end\n", prints: ["singular matrix:  check node d", "operating point could not be simulated"], fails: true, unreliable: true, traps: ['floating-dc', 'floating-dc'] },
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
  { code: 'tf-problems-8', netlist: "* .tf on a node written with a zero-width space\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.tf v(ou​t) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 2999.9999999999995, "v(output_impedance_at_V(ou___t))": 1 }, traps: ['invisible-character', 'tf-problems'] },
  { code: 'tf-problems-8-cyrillic', netlist: "* .tf on a node written with a Cyrillic o\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.tf v(оut) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 2999.9999999999995, "v(output_impedance_at_V(__ut))": 1 }, traps: ['look-alike-letter', 'tf-problems'] },
  { code: 'tf-problems-8-thin', netlist: "* .tf on a node written with a thin space\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.tf v(o ut) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 2999.9999999999995, "v(output_impedance_at_V(o___ut))": 1 }, traps: ['space-character', 'tf-problems'] },
  { code: 'tf-problems-8-two', netlist: "* .tf on a node written with a Cyrillic o and a zero-width space\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.tf v(\u043e\u200but) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 2999.9999999999995, "v(output_impedance_at_V(_____ut))": 1 }, traps: ['invisible-character', 'tf-problems'] },
  { code: 'tf-problems-8-second', netlist: "* .tf with a second output node written with a zero-width space\nV1 in 0 6\nR1 in out 1k\nR2 out mid 2k\nR3 mid 0 1k\n.tf v(out,mi\u200bd) V1\n.end\n", vectors: { "v(Transfer_function)": 0.75, "v(v1#Input_impedance)": 4000, "v(output_impedance_at_V(out,mi___d))": 751 }, traps: ['invisible-character', 'tf-problems'] },
  { code: 'tf-problems-8-ground', netlist: "* .tf on ground written with a zero-width space\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.tf v(​0) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 2999.9999999999995, "v(output_impedance_at_V(___0))": 1 }, traps: ['invisible-character', 'tf-problems'] },
  { code: 'tf-problems-8-gnd-second', netlist: "* .tf with gnd written with a zero-width space as the second node\nV1 in gnd 6\nR1 in out 1k\nR2 out gnd 2k\n.tf v(out,gn​d) V1\n.end\n", vectors: { "v(Transfer_function)": 0.6666666666666666, "v(v1#Input_impedance)": 2999.9999999999995, "v(output_impedance_at_V(out,gn___d))": 667.6666666666666 }, traps: ['invisible-character', 'tf-problems'] },
  { code: 'tf-problems-9', netlist: "* .tf v(out) with the parts on a node written with a zero-width space\nV1 in 0 6\nR1 in ou\u200bt 1k\nR2 ou\u200bt 0 2k\n.tf v(out) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 2999.9999999999995, "v(output_impedance_at_V(out))": 1 }, traps: ['invisible-character', 'tf-problems'] },
  { code: 'tf-problems-9-cyrillic', netlist: "* .tf v(out) with the parts on a node written with a Cyrillic o\nV1 in 0 6\nR1 in \u043eut 1k\nR2 \u043eut 0 2k\n.tf v(out) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 2999.9999999999995, "v(output_impedance_at_V(out))": 1 }, traps: ['look-alike-letter', 'tf-problems'] },
  { code: 'tf-problems-10', netlist: "* .tf i( ) of a source written with a zero-width space\nV1 in 0 6\nR1 in out 1k\nVm out mid 0\nR2 mid 0 2k\n.tf i(V\u200bm) V1\n.end\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 3000.0000000000005, "v(v___m#Output_impedance)": 100000000000000000000 }, traps: ['tf-problems'] },
  { code: 'tf-problems-10-input', netlist: "* .tf with its input written with a zero-width space\nV1 in 0 6\nR1 in out 1k\nVm out mid 0\nR2 mid 0 2k\n.tf i(Vm) V\u200b1\n.end\n", prints: ["Transfer function source v___1 not in circuit"], fails: true, traps: ['tf-problems'] },
  { code: 'tf-problems-11', netlist: "* .tf after .end on a node written with a zero-width space\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.end\n.tf v(ou\u200bt) V1\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 2999.9999999999995, "v(output_impedance_at_V(ou___t))": 1 }, traps: ['after-end', 'tf-problems'] },
  { code: 'tf-problems-11-typo', netlist: "* .tf after .end on a node that does not exist\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.end\n.tf v(outt) V1\n", vectors: { "v(Transfer_function)": 0, "v(v1#Input_impedance)": 2999.9999999999995, "v(output_impedance_at_V(outt))": 1 }, traps: ['after-end', 'tf-problems'] },
  { code: 'tf-problems-11-part', netlist: "* .tf after .end on a node a part after .end makes\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.end\nR3 out x 1k\n.tf v(x) V1\n", vectors: { "v(Transfer_function)": 0.6666666666666666, "v(v1#Input_impedance)": 2999.9999999999995, "v(output_impedance_at_V(x))": 1666.6666666666665 }, traps: ['after-end'] },
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
  { code: 'fatal-syntax-12', netlist: "* VALUE=3 without braces\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e 0 VALUE=3\nRe e 0 1k\n.op\n.end\n", prints: ["mal formed E source instance"], fails: true, traps: ['fatal-syntax'] },
  { code: 'fatal-syntax-13', netlist: "* VALUE=2*v(out) without braces\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e 0 VALUE=2*v(out)\nRe e 0 1k\n.op\n.end\n", prints: ["mal formed E source instance"], fails: true, traps: ['fatal-syntax'] },
  { code: 'fatal-syntax-14', netlist: "* VALUE without = and without braces\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e 0 VALUE v(out)*2\nRe e 0 1k\n.op\n.end\n", prints: ["mal formed E source instance"], fails: true, traps: ['fatal-syntax'] },
  { code: 'fatal-syntax-15', netlist: "* an empty formula\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e 0 VALUE=\nRe e 0 1k\n.op\n.end\n", prints: ["YYparse error, syntax error, in expression"], fails: true, traps: ['fatal-syntax'] },
  { code: 'fatal-syntax-16', netlist: "* formulas without braces that ngspice reads\n.param k=4\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e1 0 VALUE=v(out)*2\nR1e e1 0 1k\nE2 e2 0 VALUE=(v(out)*2)\nR2e e2 0 1k\nE3 e3 0 VALUE=k*2\nR3e e3 0 1k\nG1 0 g cur=v(out)*2m\nRg g 0 1k\n.op\n.end\n", vectors: { "v(e1)": 5, "v(e2)": 5, "v(e3)": 8, "v(g)": 5 }, traps: [] },
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
  { code: 'invisible-character-65', netlist: "* a zero-width space in a node name, on a .print line\nV1 in 0 12\nR1 in ou\u200bt 1k\nR2 ou\u200bt 0 2k\n.dc V1 0 12 6\n.print dc v(ou\u200bt)\n.end\n", vectors: { "v(ou___t)": [0, 4, 8], "i(v1)": [0, -0.002, -0.004] }, prints: [".print line ignored since rawfile was produced."], traps: ['invisible-character'] },
  { code: 'invisible-character-66', netlist: "* a zero-width space in a node name, saved in a .control block\nV1 in 0 12\nR1 in ou\u200bt 1k\nR2 ou\u200bt 0 2k\n.dc V1 0 12 6\n.control\nsave v(ou\u200bt)\nrun\n.endc\n.end\n", prints: ["no data saved for D.C. Transfer curve analysis; analysis not run"], fails: true, traps: ['invisible-character'] },
  { code: 'look-alike-letter-1', netlist: "* letters that look like k and m\nI1 0 n1 1\nR1 n1 0 1к\nI2 0 n2 1\nR2 n2 0 1κ\nI3 0 n3 1\nR3 n3 0 1ｋ\nI4 0 n4 1\nR4 n4 0 2м\n.op\n.end\n", vectors: { "v(n1)": 1, "v(n2)": 1, "v(n3)": 1, "v(n4)": 2 }, traps: ['look-alike-letter', 'look-alike-letter', 'look-alike-letter', 'look-alike-letter'] },
  { code: 'look-alike-letter-2', netlist: "* a minus sign copied from a document on a voltage source\nV1 a 0 −5\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (___5)"], fails: true, traps: ['look-alike-letter'] },
  { code: 'look-alike-letter-3', netlist: "* a Kelvin sign, a fullwidth digit and full stop, a minus sign and a dash in values\nI1 0 n1 1\nR1 n1 0 1\u212a\nI2 0 n2 1\nR2 n2 0 1\uff10k\nI3 0 n3 1\nR3 n3 0 1\uff0e5k\nI4 0 n4 1\nR4 n4 0 1e\u22123\nI5 0 n5 1\nR5 n5 0 1e\u20133\n.op\n.end\n", vectors: { "v(n1)": 1, "v(n2)": 1, "v(n3)": 1, "v(n4)": 1, "v(n5)": 1 }, traps: ['look-alike-letter', 'look-alike-letter', 'look-alike-letter', 'look-alike-letter', 'look-alike-letter'] },
  { code: 'look-alike-letter-4', netlist: "* letters that look like a capital M: Greek, Cyrillic and fullwidth\nI1 0 n1 1u\nR1 n1 0 10\u039c\nI2 0 n2 1u\nR2 n2 0 10\u041c\nI3 0 n3 1u\nR3 n3 0 10\uff2d\n.op\n.end\n", vectors: { "v(n1)": 0.000009999999999999999, "v(n2)": 0.000009999999999999999, "v(n3)": 0.000009999999999999999 }, traps: ['look-alike-letter', 'look-alike-letter', 'look-alike-letter'] },
  { code: 'look-alike-letter-5', netlist: "* a Cyrillic o in a node name\nV1 in 0 6\nR1 in out 1k\nR2 \u043eut 0 2k\n.op\n.end\n", vectors: { "v(in)": 6, "v(out)": 6, "v(__ut)": 0, "i(v1)": 0 }, traps: ['look-alike-letter'] },
  { code: 'look-alike-letter-6', netlist: "* a fullwidth digit right after the minus sign of a value\nV1 a 0 -\uff15\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (-___)"], fails: true, traps: ['look-alike-letter'] },
  { code: 'look-alike-letter-16', netlist: "* a Cyrillic \u043e in a node name, on a .print line\nV1 in 0 12\nR1 in \u043eut 1k\nR2 \u043eut 0 2k\n.dc V1 0 12 6\n.print dc v(\u043eut)\n.end\n", vectors: { "v(__ut)": [0, 4, 8], "i(v1)": [0, -0.002, -0.004] }, prints: [".print line ignored since rawfile was produced."], traps: ['look-alike-letter'] },
  { code: 'look-alike-letter-17', netlist: "* a Cyrillic \u043e in a node name, saved in a .control block\nV1 in 0 12\nR1 in \u043eut 1k\nR2 \u043eut 0 2k\n.dc V1 0 12 6\n.control\nsave v(\u043eut)\nrun\n.endc\n.end\n", prints: ["no data saved for D.C. Transfer curve analysis; analysis not run"], fails: true, traps: ['look-alike-letter'] },
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
  { code: 'space-character-11', netlist: "* a thin space that is not between groups of three digits: 0.000 001 and 1 2\nI1 0 n1 1\nR1 n1 0 0.000 001\nR2 n1 0 1\nI2 0 n2 1\nR3 n2 0 1 2\n.op\n.end\n", vectors: { "v(n1)": 9.99999999999e-13, "v(n2)": 1 }, prints: ["Value of resistor r1 is too small, set to 1.000000e-12"], traps: ['space-character', 'space-character'] },
  { code: 'space-character-20', netlist: "* a thin space in a node name, on a .print line\nV1 in 0 12\nR1 in o\u2009ut 1k\nR2 o\u2009ut 0 2k\n.dc V1 0 12 6\n.print dc v(o\u2009ut)\n.end\n", vectors: { "v(o___ut)": [0, 4, 8], "i(v1)": [0, -0.002, -0.004] }, prints: [".print line ignored since rawfile was produced."], traps: ['space-character'] },
  { code: 'space-character-21', netlist: "* a thin space in a node name, saved in a .control block\nV1 in 0 12\nR1 in o\u2009ut 1k\nR2 o\u2009ut 0 2k\n.dc V1 0 12 6\n.control\nsave v(o\u2009ut)\nrun\n.endc\n.end\n", prints: ["no data saved for D.C. Transfer curve analysis; analysis not run"], fails: true, traps: ['space-character'] },
  // Added after the re-check of the fixes, 12 Nov 2026: on C and L a model warning too (S4); what ngspice does with a
  // word it cannot read on an analysis line, by its place (S2), and .dc read by place (S5); more characters (C5); the
  // letter O (C4); a sign before a space-like character (C2); a word where the value goes (S6).
  { code: 'invisible-character-7', netlist: "* a zero-width space in a capacitor's and an inductor's value\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1\nC1 out 0 2\u200bu\nR2 in b 1\nL1 b 0 3\u200bm\n.tran 0.1m 1m\n.end\n", last: { "v(out)": 0.0004998747709848901, "v(b)": 0.9996667223826431 }, sig6: true, prints: ["can't find model '2\u200bu'", "can't find model '3\u200bm'"], traps: ['invisible-character', 'invisible-character'] },
  { code: 'look-alike-letter-7', netlist: "* letters from other alphabets in a capacitor's and an inductor's value\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1\nC1 out 0 2\u043a\nR2 in b 1\nL1 b 0 3\u039c\n.tran 0.1m 1m\n.end\n", last: { "v(out)": 0.0004998747709848901, "v(b)": 0.9996667223826431 }, sig6: true, prints: ["can't find model '2\u043a'", "can't find model '3\u039c'"], traps: ['look-alike-letter', 'look-alike-letter'] },
  { code: 'invisible-character-8', netlist: "* a zero-width space before the step of .tran\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran \u200b0.1m 2m\n.end\n", prints: ["TSTEP is invalid, must be greater than zero."], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-9', netlist: "* a zero-width space before the stop time of .tran\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 0.1m \u200b2m\n.end\n", prints: ["TSTOP is invalid, must be greater than zero."], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-10', netlist: "* a zero-width space before the start time of .tran\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 0.1m 2m \u200b1m\n.end\n", prints: ["Error: unknown parameter on .tran - ignored"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-11', netlist: "* a zero-width space before the largest step of .tran\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 0.1m 2m 0 \u200b1u\n.end\n", prints: ["Error: unknown parameter on .tran - ignored"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-12', netlist: "* a zero-width space before the start of a .dc sweep\nV1 in 0 1\nR1 in 0 1k\n.dc V1 \u200b0 5 1\n.end\n", prints: ["Bad syntax!"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-13', netlist: "* a zero-width space before the stop of a .dc sweep\nV1 in 0 1\nR1 in 0 1k\n.dc V1 0 \u200b5 1\n.end\n", prints: ["Bad syntax!"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-14', netlist: "* a zero-width space before the step of a .dc sweep\nV1 in 0 1\nR1 in 0 1k\n.dc V1 0 5 \u200b1\n.end\n", prints: ["Bad syntax!"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-15', netlist: "* a zero-width space before the start of a second .dc sweep\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 0 5 1 V2 \u200b0 1 0.5\n.end\n", prints: ["Bad syntax!"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-16', netlist: "* a zero-width space before the number of points of .ac\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac dec \u200b10 1 1k\n.end\n", prints: ["Warning, ngspice assumes default parameter(s) for ac simulation", "AC startfreq <= 0"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-17', netlist: "* a zero-width space before the start frequency of .ac\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac dec 10 \u200b1 1k\n.end\n", prints: ["Warning, ngspice assumes default parameter(s) for ac simulation", "AC startfreq <= 0"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-18', netlist: "* a zero-width space before the stop frequency of .ac\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac dec 10 1 \u200b5k\n.end\n", last: { "frequency": 1000.000000000002, "v(out)": 0.02470452303185754 }, prints: ["Warning, ngspice assumes default parameter(s) for ac simulation"], traps: ['invisible-character'] },
  { code: 'invisible-character-19', netlist: "* a zero-width space before the number of points of .noise\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.noise v(out) V1 dec \u200b10 1 1k\n.end\n", prints: ["Frequency of 0 is invalid"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-20', netlist: "* a zero-width space before the start frequency of .noise\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.noise v(out) V1 dec 10 \u200b1 1k\n.end\n", prints: ["Frequency of 0 is invalid"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-21', netlist: "* a zero-width space before the stop frequency of .noise\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.noise v(out) V1 dec 10 1 \u200b1k\n.end\n", prints: ["Frequency of 0 is invalid"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-22', netlist: "* characters inside the numbers of analysis lines\nV1 in 0 DC 1 AC 1 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.dc V1 0 5\u200b0 1\n.ac dec 10 1 20\u043a\n.tran 1m 2\u2009m\n.end\n", vectors: { "v(v-sweep)": [0, 1, 2, 3, 4, 5] }, last: { "frequency": 19.999999999999982, "time": 2 }, traps: ['invisible-character', 'look-alike-letter', 'space-character'] },
  { code: 'invisible-character-27', netlist: "* a zero-width space before the frequency of .four\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 0.1m 2m\n.four \u200b1k v(out)\n.end\n", last: { "time": 0.002 }, prints: [".fourier line ignored since rawfile was produced."], traps: [] },
  { code: 'look-alike-letter-8', netlist: "* a minus sign from a document as the start of a .dc sweep\nV1 in 0 1\nR1 in 0 1k\n.dc V1 \u22125 5 1\n.end\n", prints: ["Bad syntax!"], fails: true, traps: ['look-alike-letter'] },
  { code: 'space-character-15', netlist: "* a thin space before the stop time of .tran\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 0.1m \u20092m\n.end\n", prints: ["TSTOP is invalid, must be greater than zero."], fails: true, traps: ['space-character'] },
  { code: 'dc-sweep-problems-9', netlist: "* the letter O where the start of a .dc sweep goes\nV1 in 0 1\nR1 in 0 1k\n.dc V1 O 5 1\n.end\n", prints: ["Bad syntax!"], fails: true, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-10', netlist: "* the source named again where the stop of a .dc sweep goes\nV1 in 0 1\nR1 in 0 1k\n.dc V1 0 V1 1\n.end\n", prints: ["Bad syntax!"], fails: true, traps: ['dc-sweep-problems'] },
  { code: 'invisible-character-23', netlist: "* more invisible characters inside a value\nI1 0 n1 1\nR1 n1 0 4\u2028.7k\nI2 0 n2 1\nR2 n2 0 4\u2029.7k\nI3 0 n3 1\nR3 n3 0 4\u0085.7k\nI4 0 n4 1\nR4 n4 0 4\u180e.7k\nI5 0 n5 1\nR5 n5 0 4\u061c.7k\nI6 0 n6 1\nR6 n6 0 4\u034f.7k\nI7 0 n7 1\nR7 n7 0 4\u115f.7k\nI8 0 n8 1\nR8 n8 0 4\u1160.7k\nI9 0 n9 1\nR9 n9 0 4\u3164.7k\nI10 0 n10 1\nR10 n10 0 4\uffa0.7k\nI11 0 n11 1\nR11 n11 0 4\ufe0f.7k\nI12 0 n12 1\nR12 n12 0 4\udb40\udc01.7k\n.op\n.end\n", vectors: { "v(n1)": 4, "v(n2)": 4, "v(n3)": 4, "v(n4)": 4, "v(n5)": 4, "v(n6)": 4, "v(n7)": 4, "v(n8)": 4, "v(n9)": 4, "v(n10)": 4, "v(n11)": 4, "v(n12)": 4 }, traps: ['invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character'] },
  { code: 'invisible-character-24', netlist: "* a line separator before a value\nV1 in 0 10\nR1 in out \u20284.7k\nR2 out 0 10k\n.op\n.end\n", prints: ["unknown parameter (___4.7k)"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-25', netlist: "* a Mongolian vowel separator inside a node name\nV1 in 0 10\nR1 in out 2k\nR2 o\u180eut 0 2k\n.op\n.end\n", vectors: { "v(in)": 10, "v(out)": 10, "v(o___ut)": 0, "i(v1)": 0 }, traps: ['invisible-character'] },
  { code: 'look-alike-letter-9', netlist: "* characters that look like a decimal point, or are one in a document\nI1 0 n1 1\nR1 n1 0 4\u00b77k\nI2 0 n2 1\nR2 n2 0 4\u20247k\nI3 0 n3 1\nR3 n3 0 4\ufe527k\nI4 0 n4 1\nR4 n4 0 4\u066b7k\n.op\n.end\n", vectors: { "v(n1)": 4, "v(n2)": 4, "v(n3)": 4, "v(n4)": 4 }, traps: ['look-alike-letter', 'look-alike-letter', 'look-alike-letter', 'look-alike-letter'] },
  { code: 'look-alike-letter-12', netlist: "* characters SPICE does not know inside a number\nI1 0 n1 1\nR1 n1 0 4\u30027k\nI2 0 n2 1\nR2 n2 0 4\u20227k\nI3 0 n3 1\nR3 n3 0 4\u03877k\n.op\n.end\n", vectors: { "v(n1)": 4, "v(n2)": 4, "v(n3)": 4 }, traps: ['look-alike-letter', 'look-alike-letter', 'look-alike-letter'] },
  { code: 'look-alike-letter-13', netlist: "* a middle dot at the start of a value\nV1 in 0 10\nR1 in out \u00b747k\nR2 out 0 10k\n.op\n.end\n", prints: ["unknown parameter (__47k)"], fails: true, traps: ['look-alike-letter'] },
  { code: 'space-before-suffix-18', netlist: "* a middle dot and a space, as a British document writes 4\u00b77 k\u03a9\nV1 in 0 10\nR1 in out 4\u00b77 k\u03a9\nR2 out 0 10k\n.op\n.end\n", prints: ["can't find model 'k\u03a9'", "unknown parameter (k__)"], fails: true, traps: ['space-before-suffix'] },
  { code: 'look-alike-letter-10', netlist: "* the letter O where a zero belongs, and the Russian unit \u041e\u043c\nI1 0 n1 1\nR1 n1 0 1Ok\nI2 0 n2 1\nR2 n2 0 1\u043ek\nI3 0 n3 1\nR3 n3 0 1\u041e00\nI4 0 n4 1\nR4 n4 0 100\u041e\u043c\nI5 0 n5 1\nR5 n5 0 10\u043a\u041e\u043c\nI6 0 n6 1\nR6 n6 0 1k\u041e\u043c\nC1 n1 0 1On\n.op\n.end\n", vectors: { "v(n1)": 1, "v(n2)": 1, "v(n3)": 1, "v(n4)": 100, "v(n5)": 10, "v(n6)": 1000 }, prints: ["can't find model '1on'"], traps: ['look-alike-letter', 'look-alike-letter', 'look-alike-letter', 'look-alike-letter', 'look-alike-letter'] },
  { code: 'look-alike-letter-11', netlist: "* the letter O at the start of a value\nV1 in 0 10\nR1 in out O.47k\nR2 out 0 10k\n.op\n.end\n", prints: ["unknown parameter (o.47k)"], fails: true, traps: ['look-alike-letter'] },
  { code: 'space-character-12', netlist: "* a thin space right after the minus sign of a value\nV1 a 0 -\u20095\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (-___5)"], fails: true, traps: ['space-character'] },
  { code: 'space-character-13', netlist: "* a normal space right after the minus sign of a value\nV1 a 0 - 5\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (-)"], fails: true, traps: ['unknown-word'] },
  { code: 'space-character-14', netlist: "* a minus sign from a document, then a thin space\nV1 a 0 \u2212\u20095\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (______5)"], fails: true, traps: ['space-character'] },
  { code: 'nbsp-3', netlist: "* a no-break space right after the minus sign of a value\nI1 0 a -\u00a01m\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (-__1m)"], fails: true, traps: ['nbsp'] },
  { code: 'invisible-character-26', netlist: "* a zero-width space before the gain of E\nV1 a 0 1\nR0 a 0 1k\nE1 b 0 a 0 \u200b2\nR1 b 0 1k\n.op\n.end\n", prints: ["unknown parameter (___2)"], fails: true, traps: ['invisible-character'] },
  { code: 'look-alike-letter-14', netlist: "* a minus sign from a document as the gain of E\nV1 a 0 1\nR0 a 0 1k\nE1 b 0 a 0 \u22122\nR1 b 0 1k\n.op\n.end\n", prints: ["unknown parameter (___2)"], fails: true, traps: ['look-alike-letter'] },
  { code: 'missing-value-11', netlist: "* E with the word gain but no number\nV1 a 0 1\nR0 a 0 1k\nE1 b 0 a 0 gain\nR1 b 0 1k\n.op\n.end\n", vectors: { "v(a)": 1, "v(b)": 0 }, traps: ['missing-value'] },
  { code: 'missing-value-12', netlist: "* G with a setting but no value\nV1 a 0 1\nR0 a 0 1k\nG1 0 b a 0 m=2\nR1 b 0 1k\n.op\n.end\n", vectors: { "v(a)": 1, "v(b)": 0 }, traps: ['missing-value'] },
  { code: 'missing-value-13', netlist: "* F with a setting but no gain\nV1 a 0 1\nR0 a 0 1k\nF1 0 b V1 m=2\nR1 b 0 1k\n.op\n.end\n", vectors: { "v(a)": 1, "v(b)": 0 }, traps: ['missing-value'] },
  { code: 'missing-value-14', netlist: "* H with the word gain but no number\nV1 a 0 1\nR0 a 0 1k\nH1 b 0 V1 gain\nR1 b 0 1k\n.op\n.end\n", vectors: { "v(a)": 1, "v(b)": 0 }, traps: ['missing-value'] },
  { code: 'unknown-word-13', netlist: "* a textbook symbol as a resistor's value\nV1 a 0 1\nR0 a 0 1k\nR1 a 0 Rload\n.op\n.end\n", prints: ["can't find model 'rload'", "unknown parameter (rload)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-14', netlist: "* a textbook symbol as a capacitor's value\nV1 a 0 1\nR0 a b 1k\nC1 b 0 Cx\n.op\n.end\n", prints: ["can't find model 'cx'", "unknown parameter (cx)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-15', netlist: "* a textbook symbol as an inductor's value\nV1 a 0 1\nR0 a b 1k\nL1 b 0 Lx\n.op\n.end\n", prints: ["can't find model 'lx'", "unknown parameter (lx)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-16', netlist: "* a textbook symbol as a voltage source's value\nV1 a 0 Vs\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (vs)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-17', netlist: "* a textbook symbol as a current source's value\nI1 0 a Is\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (is)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-18', netlist: "* a textbook symbol as the gain of E\nV1 a 0 1\nR0 a 0 1k\nE1 b 0 a 0 Av\nR1 b 0 1k\n.op\n.end\n", prints: ["unknown parameter (av)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-19', netlist: "* a textbook symbol as the gain of F\nV1 a 0 1\nR0 a 0 1k\nF1 0 b V1 beta\nR1 b 0 1k\n.op\n.end\n", prints: ["unknown parameter (beta)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-20', netlist: "* a textbook symbol as the value of G\nV1 a 0 1\nR0 a 0 1k\nG1 0 b a 0 gm\nR1 b 0 1k\n.op\n.end\n", prints: ["unknown parameter (gm)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-21', netlist: "* a textbook symbol as the value of H\nV1 a 0 1\nR0 a 0 1k\nH1 b 0 V1 rm\nR1 b 0 1k\n.op\n.end\n", prints: ["unknown parameter (rm)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-22', netlist: "* names from a .param line where each part's value goes\n.param Rl=2k Cx=1u Lx=1m Vs=5 Is=1m Av=10 beta=2 gm=1m rm=1k\nV1 a 0 Vs\nR1 a 0 Rl\nC1 a 0 Cx\nL1 a b Lx\nR2 b 0 1k\nI1 0 c Is\nR3 c 0 1k\nE1 d 0 a 0 Av\nR4 d 0 1k\nF1 0 e V1 beta\nR5 e 0 1k\nG1 0 f a 0 gm\nR6 f 0 1k\nH1 g 0 V1 rm\nR7 g 0 1k\n.op\n.end\n", vectors: { "v(a)": 5, "v(b)": 5, "v(c)": 1, "v(d)": 50, "v(e)": -15, "v(f)": 5, "v(g)": -7.5, "i(v1)": -0.0075 }, prints: ["can't find model 'rl'"], traps: [] },
  { code: 'unknown-word-23', netlist: "* the same names in braces\n.param Rl=2k Cx=1u Lx=1m Vs=5 Is=1m Av=10 beta=2 gm=1m rm=1k\nV1 a 0 {Vs}\nR1 a 0 {Rl}\nC1 a 0 {Cx}\nL1 a b {Lx}\nR2 b 0 1k\nI1 0 c {Is}\nR3 c 0 1k\nE1 d 0 a 0 {Av}\nR4 d 0 1k\nF1 0 e V1 {beta}\nR5 e 0 1k\nG1 0 f a 0 {gm}\nR6 f 0 1k\nH1 g 0 V1 {rm}\nR7 g 0 1k\n.op\n.end\n", vectors: { "v(a)": 5, "v(b)": 5, "v(c)": 1, "v(d)": 50, "v(e)": -15, "v(f)": 5, "v(g)": -7.5, "i(v1)": -0.0075 }, traps: [] },
  { code: 'unknown-word-24', netlist: "* a gain named on a .param line whose value is an expression\n.param Av={2*5}\nV1 a 0 1\nR0 a 0 1k\nE1 b 0 a 0 Av\nR1 b 0 1k\n.op\n.end\n", vectors: { "v(a)": 1, "v(b)": 10 }, traps: [] },
  // Added after the critic of the re-check fixes, 12 Nov 2026: a resistor read as 0 (CR1-1); what a number read short
  // does at its place (CR1-2); a sign with a space on E-H, C and L (CR1-3); .param names (CR1-7); a source's function,
  // AC words and settings (CR1-5); .dc by place (CR1-4, -6, -12); a .tran stop of 0 (CR1-13); the letter O (CR1-8, -9).
  { code: 'zero-ohm-4', netlist: "* values read as 0 because of how they are written\nV1 a 0 1\nR1 a b 0\u200b.47\nR2 b c 0R47\nR3 c d 0k47\nR4 d e 0\uff0e47\nR5 e f 0\u00b747\nR6 f g 0\u2009.47\nR7 g h 0\u00a0.47\nR8 h i 0\u300247\nR9 i j 1,0\nR10 j 0 1\n.op\n.end\n", vectors: { "v(j)": 0.9999999999909992, "i(v1)": -1.0001220703125 }, prints: ["Value of resistor r1 is too small, set to 1.000000e-12", "Value of resistor r9 is too small, set to 1.000000e-12"], traps: ['invisible-character', 'rkm-notation', 'rkm-notation', 'look-alike-letter', 'look-alike-letter', 'space-character', 'nbsp', 'look-alike-letter', 'decimal-comma'] },
  { code: 'zero-ohm-5', netlist: "* r= and resistance= read as 0: 0\u200b.47 reads 0\nV1 a 0 1\nR1 a b r=0\u200b.47\nR2 b 0 1\nV2 c 0 1\nR3 c d resistance=0\u200b.47\nR4 d 0 1\n.op\n.end\n", vectors: { "v(b)": 0.9999999999989999, "v(d)": 0.9999999999989999 }, prints: ["Warning: Value of resistor r1 is too small, set to 1.000000e-12", "Warning: Value of resistor r3 is too small, set to 1.000000e-12"], traps: ['invisible-character', 'invisible-character'] },
  { code: 'zero-ohm-6', netlist: "* a resistor of 0 in a subcircuit used twice, one written 0, one read as 0\n.subckt div a b\nR1 a b 0\nR2 b 0 1\nR3 b c 0\u200b.47\nR4 c 0 1\n.ends\nV1 in 0 1\nX1 in out1 div\nX2 in out2 div\n.op\n.end\n", prints: ["Value of resistor r.x1.r1 is too small", "Value of resistor r.x2.r1 is too small", "Value of resistor r.x1.r3 is too small"], traps: ['zero-ohm', 'invisible-character'] },
  { code: 'invisible-character-28', netlist: "* a zero-width space inside .tran's step: it reads 0\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 0\u200b.1m 2m\n.end\n", prints: ["TSTEP is invalid, must be greater than zero."], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-29', netlist: "* a zero-width space inside .tran's stop time: it reads 0\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 0.1m 0\u200b.5\n.end\n", prints: ["TSTOP is invalid, must be greater than zero."], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-30', netlist: "* a zero-width space inside .tran's start time: it reads 1 s, after the stop\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 0.1m 2m 1\u200bm\n.end\n", prints: ["TSTART is invalid, must be less than TSTOP."], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-31', netlist: "* a zero-width space inside .tran's stop time: it reads 1 s, before the start\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 0.1 1\u200b0 2\n.end\n", prints: ["TSTART is invalid, must be less than TSTOP."], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-32', netlist: "* a zero-width space inside a .dc step: it reads 0\nV1 in 0 1\nR1 in 0 1k\n.dc V1 0 5 0\u200b.5\n.end\n", prints: ["Bad syntax!"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-33', netlist: "* a zero-width space inside a .dc stop: it reads 1, below the start\nV1 in 0 1\nR1 in 0 1k\n.dc V1 2 1\u200b0 1\n.end\n", fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-34', netlist: "* a zero-width space inside .ac's number of points: it reads 0\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac dec 0\u200b.5 1 1k\n.ac lin 0\u200b.5 1 1k\n.ac oct 0\u200b.5 1 1k\n.end\n", last: { "frequency": 955.4257833336895 }, prints: ["Warning, ngspice assumes default parameter(s) for ac simulation"], traps: ['invisible-character', 'invisible-character', 'invisible-character'] },
  { code: 'invisible-character-35', netlist: "* a zero-width space inside .ac's start frequency: it reads 0\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac dec 10 0\u200b.5 1k\n.end\n", prints: ["AC startfreq <= 0"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-36', netlist: "* a zero-width space inside .ac's stop frequency: it reads 2, below the start\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac dec 10 100 2\u200b0k\n.end\n", last: { "frequency": 100000.00000000013 }, prints: ["Warning, ngspice assumes default parameter(s) for ac simulation"], traps: ['invisible-character'] },
  { code: 'invisible-character-37', netlist: "* a zero-width space inside .ac's start frequency: it reads 5, above the stop\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac dec 10 5\u200bk 1\n.end\n", last: { "frequency": 5000.000000000007 }, prints: ["Warning, ngspice assumes default parameter(s) for ac simulation"], traps: ['invisible-character'] },
  { code: 'invisible-character-38', netlist: "* a zero-width space inside .noise's number of points: it reads 0\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nR2 out 0 1k\n.noise v(out) V1 dec 0\u200b.5 1 1k\n.end\n", prints: ["Number of steps for noise measurement has to be larger than 0", "run simulation(s) aborted"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-39', netlist: "* a zero-width space inside .noise's start frequency: it reads 0\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nR2 out 0 1k\n.noise v(out) V1 dec 10 0\u200b.5 1k\n.end\n", prints: ["Frequency of 0 is invalid"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-40', netlist: "* a zero-width space inside .noise's stop frequency: it reads 0\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nR2 out 0 1k\n.noise v(out) V1 dec 10 1 0\u200b.5\n.end\n", prints: ["Frequency of 0 is invalid"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-41', netlist: "* a zero-width space inside .noise's stop frequency: it reads 1, the start\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nR2 out 0 1k\n.noise v(out) V1 dec 10 1 1\u200bk\n.end\n", vectors: { "frequency": 1 }, prints: ["Noise measurement at a single frequency 1 only!"], traps: ['invisible-character'] },
  { code: 'invisible-character-42', netlist: "* a zero-width space inside .noise's stop frequency: it reads 2, below the start\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nR2 out 0 1k\n.noise v(out) V1 dec 10 100 2\u200b0k\n.end\n", vectors: { "v(onoise_total)": 0, "v(inoise_total)": 0 }, traps: ['invisible-character'] },
  { code: 'invisible-character-43', netlist: "* a zero-width space inside .noise's start frequency: it reads 5, above the stop\nV1 in 0 DC 0 AC 1\nR1 in out 1k\nR2 out 0 1k\n.noise v(out) V1 dec 10 5\u200bk 1\n.end\n", vectors: { "v(onoise_total)": 0, "v(inoise_total)": 0 }, traps: ['invisible-character'] },
  { code: 'invisible-character-44', netlist: "* numbers read short that ngspice runs with, without a message\nV1 in 0 DC 0 AC 1 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.dc V1 1\u200b0 20 1\u200b0\n.ac dec 1\u200b0 1\u200b0 1k\n.noise v(out) V1 dec 1\u200b0 1\u200b0 1k\n.noise v(out) V1 dec 10 1 2\u200b0k\n.tran 1\u200b0u 2 1\u200b0m 1\u200b0u\n.end\n", last: { "v(v-sweep)": 20, "time": 2 }, sig6: true, traps: ['invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character'] },
  { code: 'invisible-character-45', netlist: "* a zero-width space before PULSE's first number\nV1 in 0 PULSE(\u200b0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 0.1m 2m\n.end\n", prints: ["parameter value out of range or the wrong type"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-46', netlist: "* a zero-width space before EXP's second number\nV1 in 0 EXP(0 \u200b1 0 1m 1m 1m)\nR1 in out 1k\nC1 out 0 1u\n.tran 0.1m 2m\n.end\n", prints: ["no such parameter on this device or parameter is missing"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-47', netlist: "* a zero-width space before PWL's third number\nV1 in 0 PWL(0 0 \u200b1m 1)\nR1 in out 1k\nC1 out 0 1u\n.tran 0.1m 2m\n.end\n", prints: ["unknown parameter (___1m)"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-48', netlist: "* a zero-width space before the AC value\nV1 in 0 1 AC \u200b1\nR1 in out 1k\nC1 out 0 1u\n.ac dec 10 1 1k\n.end\n", prints: ["unknown parameter (___1)"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-49', netlist: "* a zero-width space before the AC phase\nV1 in 0 AC 1 \u200b90\nR1 in out 1k\nC1 out 0 1u\n.ac dec 10 1 1k\n.end\n", prints: ["unknown parameter (___90)"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-50', netlist: "* a zero-width space at the start of a resistor's m=\nV1 a 0 1\nR1 a 0 1k m=\u200b2\n.op\n.end\n", prints: ["Undefined parameter [___2]", "Cannot compute substitute"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-51', netlist: "* numbers read short in functions, AC values and settings\nV1 in 0 DC 0 AC 1\u200b0 PULSE(0 1\u200b0 0 1n 1n 1 2)\nV2 a 0 SIN(0 1 1\u200bk)\nV3 b 0 PWL(0 0 1\u200bm 1)\nV4 c 0 EXP(0 1\u200b0 0 1m 1m 1m)\nV5 d 0 SFFM(0 1\u200b0 1k 1 100)\nR1 in out 1k m=1\u200b0\nC1 out 0 1u ic=1\u200b0\nRa a 0 1k\nRb b 0 1k\nRc c 0 1k\nRd d 0 1k\n.tran 0.1m 2m\n.end\n", last: { "v(in)": 1, "v(a)": 0.012566039883352607, "v(b)": 0.002, "v(c)": 0.21831082194880724, "v(d)": 0.8140296083596736, "v(out)": 0.8646997736181392 }, sig6: true, traps: ['invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character'] },
  { code: 'invisible-character-52', netlist: "* a zero-width space at the start of a source's dc=\nV1 a 0 dc=\u200b5\nR1 a 0 1k\n.op\n.end\n", prints: ["Undefined parameter [___5]"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-53', netlist: "* a zero-width space at the start of a capacitor's ic=\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1u ic=\u200b1\n.tran 0.1m 2m uic\n.end\n", prints: ["Undefined parameter [___1]"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-54', netlist: "* a zero-width space inside the second sweep's stop of .dc: it reads 1, below the start of 2\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 0 5 1 V2 2 1\u200b0 1\n.end\n", vectors: { "v(v-sweep)": [0, 1, 2, 3, 4, 5], "v(b)": [2, 2, 2, 2, 2, 2] }, traps: ['invisible-character'] },
  { code: 'invisible-character-55', netlist: "* a zero-width space inside the first sweep's stop of .dc: it reads 1, below the start of 2\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 2 1\u200b0 1 V2 0 1 0.5\n.end\n", vectors: { "v(v-sweep)": [2, 2], "v(b)": [0.5, 1] }, traps: ['invisible-character'] },
  { code: 'invisible-character-57', netlist: "* a zero-width space inside the start of a lin .ac sweep: it reads 0\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac lin 10 0\u200b.5 1k\n.end\n", vectors: { "frequency": [0, 111.11111111111111, 222.22222222222223, 333.33333333333337, 444.44444444444446, 555.5555555555555, 666.6666666666666, 777.7777777777777, 888.8888888888888, 999.9999999999999] }, traps: ['invisible-character'] },
  { code: 'invisible-character-58', netlist: "* a step read as 0 and a negative stop time: the step is checked first\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 0\u200b.1m -1m\n.end\n", prints: ["TSTEP is invalid, must be greater than zero."], fails: true, several: true, traps: ['invisible-character'] },
  { code: 'invisible-character-59', netlist: "* PWL times read short: 1\u200bm reads 1, after the next time of 2m\nV1 a 0 PWL(0 0 1\u200bm 1 2m 0)\nRa a 0 1k\nI1 0 b PWL(1\u200bm 0 2m 1m)\nRb b 0 1k\n.tran 0.1m 3m\n.end\n", last: { "v(a)": 0, "v(b)": 0 }, sig6: true, prints: ["Warning : voltage source v1 has non-increasing PWL time points.", "Warning : current source i1 has non-increasing PWL time points."], traps: ['invisible-character', 'invisible-character'] },
  { code: 'invisible-character-60', netlist: "* a step read as 0, and a second sweep with no step\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 0 5 0\u200b.5 V2 0 1\n.end\n", prints: ["Bad syntax!"], fails: true, several: true, traps: ['invisible-character'] },
  { code: 'invisible-character-61', netlist: "* a step of 0, and a zero-width space inside the stop time\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 0 2\u200bm\n.end\n", prints: ["TSTEP is invalid, must be greater than zero."], fails: true, several: true, traps: ['tran-problems', 'invisible-character'] },
  { code: 'invisible-character-62', netlist: "* V9 is not in the circuit, and a zero-width space inside the stop\nV1 in 0 1\nR1 in 0 1k\n.dc V9 0 5\u200b0 1\n.end\n", prints: ["named \"v9\" is not in the circuit"], fails: true, several: true, traps: ['dc-sweep-problems', 'invisible-character'] },
  { code: 'invisible-character-63', netlist: "* .ac with no stop frequency, and a zero-width space inside the start\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac dec 10 1\u200b0\n.end\n", vectors: { "frequency": [1, 1.2589254117941673, 1.5848931924611136, 1.99526231496888, 2.5118864315095806, 3.16227766016838, 3.9810717055349736, 5.011872336272725, 6.309573444801935, 7.9432823472428185, 10.000000000000005, 12.58925411794168, 15.848931924611145, 19.95262314968881, 25.118864315095824, 31.622776601683825, 39.81071705534977, 50.11872336272729, 63.0957344480194, 79.43282347242825, 100.00000000000014, 125.89254117941691, 158.4893192461116, 199.52623149688827, 251.18864315095843, 316.2277660168385, 398.10717055349795, 501.1872336272732, 630.9573444801945, 794.3282347242831, 1000.000000000002] }, prints: ["Warning, ngspice assumes default parameter(s) for ac simulation"], traps: ['invisible-character'] },
  { code: 'invisible-character-64', netlist: "* a zero-width space inside the second sweep's step: it reads 0\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 0 5 1 V2 0 1 0\u200b.5\n.end\n", prints: ["Bad syntax!"], fails: true, traps: ['invisible-character'] },
  { code: 'invisible-character-56', netlist: "* numbers read short in the other places of PULSE, SIN, EXP, SFFM and PWL, in the AC phase, and in values written name=value\nV1 n1 0 PULSE(1\u200b0 1 0 1n 1n 1 2)\nV2 n2 0 PULSE(0 1 1\u200b0u 1n 1n 1 2)\nV3 n3 0 PULSE(0 1 0 1\u200b0u 1n 1 2)\nV4 n4 0 PULSE(0 1 0 1n 1\u200b0u 1 2)\nV5 n5 0 PULSE(0 1 0 1n 1n 0\u200b.5m 1m)\nV6 n6 0 PULSE(0 1 0 1n 1n 0.2m 0\u200b.5m)\nV7 n7 0 PULSE(0 1 0 1n 1n 1 2 4\u200b5)\nV8 n8 0 SIN(1\u200b0 1 1k)\nV9 n9 0 SIN(0 1 0\u200b.5k)\nV10 n10 0 SIN(0 1 1k 1\u200b0u)\nV11 n11 0 SIN(0 1 1k 0 1\u200b0)\nV12 n12 0 SIN(0 1 1k 0 0 4\u200b5)\nV13 n13 0 EXP(1\u200b0 1 0 1m 1m 1m)\nV14 n14 0 EXP(0 1 1\u200b0u 1m 1m 1m)\nV15 n15 0 EXP(0 1 0 0\u200b.1m 1m 1m)\nV16 n16 0 EXP(0 1 0 1m 1\u200b0m 1m)\nV17 n17 0 EXP(0 1 0 1m 1m 0\u200b.1m)\nV18 n18 0 SFFM(1\u200b0 1 1k 1 100)\nV19 n19 0 SFFM(0 1 1k 1 100 1\u200b0u)\nV20 n20 0 SFFM(0 1 1k 1 100 0 4\u200b5)\nV21 n21 0 SFFM(0 1 1k 1 100 0 0 4\u200b5)\nV22 n22 0 PWL(0 1\u200b0 1m 2)\nV23 n23 0 PWL(0 0 1m 2\u200b0)\nV24 n24 0 DC 1 AC 1 4\u200b5\nV25 n25 0 dc=1\u200b0\nE1 n26 0 n1 0 gain=1\u200b0\nRln1 n1 0 1k\nRln2 n2 0 1k\nRln3 n3 0 1k\nRln4 n4 0 1k\nRln5 n5 0 1k\nRln6 n6 0 1k\nRln7 n7 0 1k\nRln8 n8 0 1k\nRln9 n9 0 1k\nRln10 n10 0 1k\nRln11 n11 0 1k\nRln12 n12 0 1k\nRln13 n13 0 1k\nRln14 n14 0 1k\nRln15 n15 0 1k\nRln16 n16 0 1k\nRln17 n17 0 1k\nRln18 n18 0 1k\nRln19 n19 0 1k\nRln20 n20 0 1k\nRln21 n21 0 1k\nRln22 n22 0 1k\nRln23 n23 0 1k\nRln24 n24 0 1k\nRln25 n25 0 1k\nRln26 n26 0 1k\nI27 0 n27 1m\nR27 n27 0 r=1\u200b0\nI28 0 n28 1m\nR28 n28 0 resistance=1\u200b0\nV29 a29 0 PULSE(0 1 0 1n 1n 1 2)\nR29 a29 n29 1k\nC29 n29 0 c=1\u200bu\nV30 a30 0 PULSE(0 1 0 1n 1n 1 2)\nR30 a30 n30 1k\nL30 n30 0 l=1\u200bm\nV31 a31 0 1\nRa31 a31 0 1k\nF31 0 n31 V31 gain=1\u200b0\nR31 n31 0 1k\nI32 0 n32 1m\nR32 n32 0 1k m=0\u200b.5\nR33 n32 0 1k\nV34 a34 0 1\nR34 a34 n34 1k\nC34 n34 0 1u ic=0\u200b.5\n.tran 0.1m 2m\n.end\n", last: { "v(n1)": 1, "v(n27)": 0.001, "v(n29)": 0.000001999997999985299, "v(n30)": 0.1353046553256334, "v(n31)": -1, "v(n32)": 1 }, sig6: true, traps: ['invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character', 'invisible-character'] },
  { code: 'unknown-word-25', netlist: "* a minus sign with a space after it where E's gain goes\nV1 a 0 1\nR0 a 0 1k\nE1 b 0 a 0 - 2\nR1 b 0 1k\n.op\n.end\n", prints: ["unknown parameter (-)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-26', netlist: "* a minus sign with a space after it where F's gain goes\nV1 a 0 1\nR0 a 0 1k\nF1 0 b V1 - 2\nR1 b 0 1k\n.op\n.end\n", prints: ["unknown parameter (-)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-27', netlist: "* a minus sign with a space after it where G's value goes\nV1 a 0 1\nR0 a 0 1k\nG1 0 b a 0 - 1m\nR1 b 0 1k\n.op\n.end\n", prints: ["unknown parameter (-)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-28', netlist: "* a plus sign with a space after it where H's value goes\nV1 a 0 1\nR0 a 0 1k\nH1 b 0 V1 + 2\nR1 b 0 1k\n.op\n.end\n", prints: ["unknown parameter (+)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-29', netlist: "* a minus sign with a space after it where a capacitor's value goes\nV1 a 0 1\nR1 a b 1k\nC1 b 0 - 5u\n.op\n.end\n", prints: ["can't find model '-'", "unknown parameter (-)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-30', netlist: "* a plus sign with a space after it where an inductor's value goes\nV1 a 0 1\nR1 a b 1k\nL1 b 0 + 5u\n.op\n.end\n", prints: ["can't find model '+'", "unknown parameter (+)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-31', netlist: "* a minus sign with a space after it where a resistor's value goes\nV1 a 0 1\nR1 a 0 - 5\n.op\n.end\n", prints: ["unknown parameter (-)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-32', netlist: "* a plus sign with a space after it where a current source's value goes\nI1 0 a + 1m\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (+)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-33', netlist: "* a subcircuit's own parameter named where a value goes outside it\n.subckt foo x y Vs=5\nR1 x y 1k\n.ends\nV1 a 0 Vs\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (vs)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-34', netlist: "* a .param line inside a subcircuit, its name used outside it\n.subckt foo x y\n.param Vs=5\nR1 x y 1k\n.ends\nV1 a 0 Vs\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (vs)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-35', netlist: "* a .func name where a value goes\n.func f(x) {x*2}\nV1 a 0 f\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (f)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-36', netlist: "* a .param line after .end\nV1 a 0 Vs\nR1 a 0 1k\n.op\n.end\n.param Vs=5\n", vectors: { "v(a)": 5 }, traps: ['after-end'] },
  { code: 'unknown-word-37', netlist: "* a .param line after .end with a comment glued to it\nV1 a 0 Vs\nR1 a 0 1k\n.op\n.end;x\n.param Vs=5\n", vectors: { "v(a)": 5 }, traps: ['after-end'] },
  { code: 'unknown-word-38', netlist: "* bar's R1 names foo's parameter Rv\n.subckt foo x y Rv=2k\nR1 x y {Rv}\n.ends\n.subckt bar x y\nR1 x y Rv\n.ends\nV1 a 0 1\nX1 a 0 foo\nX2 a 0 bar\n.op\n.end\n", prints: ["can't find model 'rv'", "unknown parameter (rv)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-39', netlist: "* bar's R1 names the function f\n.func f(x) {x*2}\n.subckt bar x y\nR1 x y f\n.ends\nV1 a 0 1\nX2 a 0 bar\n.op\n.end\n", prints: ["can't find model 'f'", "unknown parameter (f)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-40', netlist: "* m=3 after E1's gain\nV1 a 0 1\nR0 a 0 1k\nE1 b 0 a 0 2 m=3\nR1 b 0 1k\n.op\n.end\n", prints: ["unknown parameter (m)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-41', netlist: "* m=3 after H1's value\nV1 a 0 1\nR0 a 0 1k\nH1 b 0 V1 2 m=3\nR1 b 0 1k\n.op\n.end\n", prints: ["unknown parameter (m)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-42', netlist: "* x=... where R1's value goes\nV1 a 0 1\nR1 a 0 x=5\n.op\n.end\n", prints: ["unknown parameter (x)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-43', netlist: "* x=... where C1's value goes\nV1 a 0 1\nR1 a b 1k\nC1 b 0 x=5\n.op\n.end\n", prints: ["unknown parameter (x)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-44', netlist: "* x=... where L1's value goes\nV1 a 0 1\nR1 a b 1k\nL1 b 0 x=5\n.op\n.end\n", prints: ["unknown parameter (x)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-45', netlist: "* x=... where V1's value goes\nV1 a 0 x=5\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (x)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-46', netlist: "* x=... where I1's value goes\nI1 0 a x=5\nR1 a 0 1k\n.op\n.end\n", prints: ["unknown parameter (x)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-47', netlist: "* x=... where E1's value goes\nV1 a 0 1\nR0 a 0 1k\nE1 b 0 a 0 x=5\nR1 b 0 1k\n.op\n.end\n", prints: ["unknown parameter (x)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-48', netlist: "* x=... where F1's value goes\nV1 a 0 1\nR0 a 0 1k\nF1 0 b V1 x=5\nR1 b 0 1k\n.op\n.end\n", prints: ["unknown parameter (x)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-49', netlist: "* gm=... where G1's value goes\nV1 a 0 1\nR0 a 0 1k\nG1 0 b a 0 gm=1m\nR1 b 0 1k\n.op\n.end\n", prints: ["unknown parameter (gm)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-50', netlist: "* x=... where H1's value goes\nV1 a 0 1\nR0 a 0 1k\nH1 b 0 V1 x=5\nR1 b 0 1k\n.op\n.end\n", prints: ["unknown parameter (x)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-51', netlist: "* x=3 after E1's gain\nV1 a 0 1\nR0 a 0 1k\nE1 b 0 a 0 2 x=3\nR1 b 0 1k\n.op\n.end\n", prints: ["unknown parameter (x)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-52', netlist: "* a resistor written - 1\u200b0\nV1 a 0 1\nR3 a 0 - 1\u200b0\n.op\n.end\n", prints: ["unknown parameter (-)"], fails: true, traps: ['unknown-word'] },
  { code: 'unknown-word-53', netlist: "* the word for the kind of controlled source, as HSPICE writes it\nV1 in 0 5\nVs in mid 0\nR1 mid out 1k\nR2 out 0 1k\nE1 e 0 vcvs out 0 2\nRe e 0 1k\nG1 0 g vccs out 0 2m\nRg g 0 1k\nF1 0 f cccs Vs 2\nRf f 0 1k\nH1 h 0 ccvs Vs 1k\nRh h 0 1k\n.op\n.end\n", vectors: { "v(e)": 5, "v(g)": 5, "v(f)": 5, "v(h)": 2.5 }, traps: [] },
  { code: 'unknown-word-54', netlist: "* two words between the output nodes and the formula\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e 0 in 0 VALUE={v(out)*2}\nRe e 0 1k\nG1 0 g in 0 cur={v(out)*2m}\nRg g 0 1k\nE2 e2 0 out 0 VALUE={2}\nRe2 e2 0 1k\n.op\n.end\n", vectors: { "v(e)": 5, "v(g)": 5, "v(e2)": 2 }, traps: [] },
  { code: 'unknown-word-55', netlist: "* words between the output nodes and the formula\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e 0 out 0 2 VALUE={v(out)*2}\nRe e 0 1k\nE2 e2 0 a b c d VALUE={2}\nRe2 e2 0 1k\n.op\n.end\n", vectors: { "v(e)": 5, "v(e2)": 2 }, traps: [] },
  { code: 'dc-sweep-problems-11', netlist: "* a .dc sweep with only its start\nV1 in 0 1\nR1 in 0 1k\n.dc V1 0\n.end\n", prints: ["Bad syntax!"], fails: true, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-12', netlist: "* a second .dc sweep with its name only\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 0 5 1 V2\n.end\n", prints: ["Bad syntax!"], fails: true, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-13', netlist: "* one number too many on a .dc line\nV1 in 0 1\nR1 in 0 1k\n.dc V1 0 5 1 2\n.end\n", prints: ["Bad syntax!"], fails: true, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-14', netlist: "* four numbers too many on a .dc line\nV1 in 0 1\nR1 in 0 1k\n.dc V1 0 5 1 2 3 4 5\n.end\n", prints: ["named \"2\" is not in the circuit"], fails: true, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-15', netlist: "* a zero-width space before the name of the source to sweep\nV1 in 0 1\nR1 in 0 1k\n.dc \u200bV1 0 5 1\n.end\n", prints: ["named \"___v1\" is not in the circuit"], fails: true, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-16', netlist: "* a fullwidth digit in the name of the source to sweep\nV1 in 0 1\nR1 in 0 1k\n.dc V\uff11 0 5 1\n.end\n", prints: ["named \"v___\" is not in the circuit"], fails: true, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-17', netlist: "* expressions in braces and quotes on a .dc line\n.param lo=-5 hi=5 st=1\nV1 in 0 1\nR1 in 0 1k\n.dc V1 {lo} {hi} 'st'\n.end\n", last: { "v(v-sweep)": 5 }, traps: [] },
  { code: 'dc-sweep-problems-18', netlist: "* a .param name without braces where the step goes\n.param st=1\nV1 in 0 1\nR1 in 0 1k\n.dc V1 0 5 st\n.end\n", prints: ["Bad syntax!"], fails: true, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-19', netlist: "* a word after the second sweep\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 0 5 1 V2 0 1 0.5 7\n.end\n", last: { "v(v-sweep)": 5 }, traps: [] },
  { code: 'dc-sweep-problems-20', netlist: "* the second sweep goes the wrong way: start 2 above stop 1, step up\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 0 5 1 V2 2 1 1\n.end\n", vectors: { "v(v-sweep)": [0, 1, 2, 3, 4, 5], "v(b)": [2, 2, 2, 2, 2, 2] }, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-21', netlist: "* the first sweep goes the wrong way: start 2 above stop 1, step up\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 2 1 1 V2 0 1 0.5\n.end\n", vectors: { "v(v-sweep)": [2, 2], "v(b)": [0.5, 1] }, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-22', netlist: "* both sweeps go the wrong way\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 2 1 1 V2 2 1 1\n.end\n", fails: true, traps: ['dc-sweep-problems', 'dc-sweep-problems'] },
  { code: 'dc-sweep-problems-23', netlist: "* the second sweep's step jumps past its stop\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 0 5 1 V2 0 1 5\n.end\n", vectors: { "v(v-sweep)": [0, 1, 2, 3, 4, 5], "v(b)": [0, 0, 0, 0, 0, 0] }, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-24', netlist: "* the first sweep's step jumps past its stop\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 0 1 5 V2 0 1 0.5\n.end\n", vectors: { "v(v-sweep)": [0, 0, 0], "v(b)": [0, 0.5, 1] }, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-25', netlist: "* V9 is not in the circuit, and the step is 0\nV1 in 0 1\nR1 in 0 1k\n.dc V9 0 5 0\n.end\n", prints: ["Bad syntax!"], fails: true, several: true, traps: ['dc-sweep-problems', 'dc-sweep-problems'] },
  { code: 'dc-sweep-problems-26', netlist: "* the second sweep's step goes down from 0 towards 1\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 0 5 1 V2 0 1 -0.5\n.end\n", vectors: { "v(v-sweep)": [0, 1, 2, 3, 4, 5], "v(b)": [0, 0, 0, 0, 0, 0] }, traps: ['dc-sweep-problems'] },
  { code: 'dc-sweep-problems-27', netlist: "* the first sweep's step goes down from 0 towards 5\nV1 in 0 1\nV2 b 0 1\nR1 in b 1k\n.dc V1 0 5 -1 V2 0 1 0.5\n.end\n", vectors: { "v(v-sweep)": [0, 0], "v(b)": [0.5, 1] }, traps: ['dc-sweep-problems'] },
  { code: 'tran-problems-8', netlist: "* .tran with a stop time of 0\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 0.1m 0\n.end\n", prints: ["TSTOP is invalid, must be greater than zero."], fails: true, traps: ['tran-problems'] },
  { code: 'tran-problems-9', netlist: "* .tran with a negative stop time\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 0.1m -1m\n.end\n", prints: ["TSTOP is invalid, must be greater than zero."], fails: true, traps: ['tran-problems'] },
  { code: 'look-alike-letter-15', netlist: "* the letter O for a zero, with a unit, meg or two Os\nI1 0 a 1\nR1 a 0 1Ok\u03a9\nI2 0 b 1\nR2 b 0 1Omeg\nI3 0 c 1\nR3 c 0 1OOk\nI4 0 d 1\nR4 d 0 1OkOhm\nI5 0 e 1OA\nR5 e 0 1\nV6 f 0 1\nC6 f 0 1OuF\n.op\n.end\n", vectors: { "v(a)": 1, "v(b)": 1, "v(c)": 1, "v(d)": 1, "v(e)": 1 }, prints: ["can't find model '1ouf'"], traps: ['look-alike-letter', 'look-alike-letter', 'look-alike-letter', 'look-alike-letter', 'look-alike-letter', 'look-alike-letter'] },
  // A thin space glued inside a number of an analysis line: one number for ngspice, cut short (CR1-2).
  { code: 'space-character-16', netlist: "* a thin space inside a .dc step: it reads 0\nV1 in 0 1\nR1 in 0 1k\n.dc V1 0 5 0\u2009.5\n.end\n", prints: ["Bad syntax!"], fails: true, traps: ['space-character'] },
  { code: 'space-character-17', netlist: "* a thin space inside .tran's stop time: it reads 0\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 0.1m 0\u2009.5\n.end\n", prints: ["TSTOP is invalid, must be greater than zero."], fails: true, traps: ['space-character'] },
  { code: 'space-character-18', netlist: "* a thin space inside a .dc stop: it reads 1\nV1 in 0 1\nR1 in 0 1k\n.dc V1 0 1\u20090 1\n.end\n", vectors: { "v(v-sweep)": [0, 1] }, traps: ['space-character'] },
  { code: 'space-character-19', netlist: "* a step of 0, and the stop time written 2<thin space>ms\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 0 2\u2009ms\n.end\n", prints: ["TSTEP is invalid, must be greater than zero."], fails: true, several: true, traps: ['tran-problems', 'space-character'] },
  // The last pass (13 November 2026). An E or G given by a formula, a table or a polynomial, read as ngspice
  // reads it (code review C3-5): a formula runs everywhere and is no missing gain; POLY and TABLE run natively
  // but stop our engine (no XSPICE). A rename reaches every place ngspice reads the node's name (C3-1):
  // formulas, .pz's nodes and the lines after .end; a character that looks like a space in a formula stops ngspice.
  { code: 'missing-value-15', netlist: "* an E given by a formula\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e 0 VALUE={v(out)*2}\nRe e 0 1k\n.op\n.end\n", vectors: { "v(e)": 5, "i(e1)": -0.005 }, traps: [] },
  { code: 'missing-value-16', netlist: "* E given by a formula, written five ways\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e1 0 value = {v(out)*2}\nR1e e1 0 1k\nE2 e2 0 VALUE {v(out)*2}\nR2e e2 0 1k\nE3 e3 0 vol={v(out)*2}\nR3e e3 0 1k\nE4 e4 0 vol='v(out)*2'\nR4e e4 0 1k\nE5 e5 0 VALUE=\n+ {v(out)*2}\nR5e e5 0 1k\n.op\n.end\n", vectors: { "v(e1)": 5, "v(e2)": 5, "v(e3)": 5, "v(e4)": 5, "v(e5)": 5 }, traps: [] },
  { code: 'missing-value-17', netlist: "* G given by a formula\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nG1 0 g1 VALUE={v(out)*2m}\nRg1 g1 0 1k\nG2 0 g2 cur='v(out)*2m'\nRg2 g2 0 1k\n.op\n.end\n", vectors: { "v(g1)": 5, "v(g2)": 5 }, traps: [] },
  { code: 'model-not-in-engine-7', netlist: "* an E written with POLY(1)\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e 0 POLY(1) out 0 0 2\nRe e 0 1k\n.op\n.end\n", prints: ["XSPICE is required to run the 'poly' option"], fails: true, traps: ['model-not-in-engine'] },
  { code: 'model-not-in-engine-8', netlist: "* an E written with TABLE\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e 0 TABLE {v(out)} = (0,0) (5,10)\nRe e 0 1k\n.op\n.end\n", prints: ["unknown device type"], fails: true, traps: ['model-not-in-engine'] },
  { code: 'model-not-in-engine-9', netlist: "* an F written with POLY(1)\nV1 in 0 5\nVx in out 0\nR2 out 0 1k\nF1 0 e POLY(1) Vx 0 2\nRe e 0 1k\n.op\n.end\n", prints: ["XSPICE is required to run the 'poly' option"], fails: true, traps: ['model-not-in-engine'] },
  { code: 'model-not-in-engine-10', netlist: "* a G written with POLY(1)\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nG1 0 e POLY(1) out 0 0 2m\nRe e 0 1k\n.op\n.end\n", prints: ["XSPICE is required to run the 'poly' option"], fails: true, traps: ['model-not-in-engine'] },
  { code: 'model-not-in-engine-11', netlist: "* an H written with POLY(1)\nV1 in 0 5\nVx in out 0\nR2 out 0 1k\nH1 e 0 POLY(1) Vx 0 1k\nRe e 0 1k\n.op\n.end\n", prints: ["XSPICE is required to run the 'poly' option"], fails: true, traps: ['model-not-in-engine'] },
  { code: 'model-not-in-engine-12', netlist: "* an E written with POLY(2)\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e 0 POLY(2) out 0 in 0 0 1 1\nRe e 0 1k\n.op\n.end\n", prints: ["XSPICE is required to run the 'poly' option"], fails: true, traps: ['model-not-in-engine'] },
  { code: 'model-not-in-engine-13', netlist: "* a G written with TABLE\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nG1 0 e TABLE {v(out)} = (0,0) (5,10m)\nRe e 0 1k\n.op\n.end\n", prints: ["unknown device type"], fails: true, traps: ['model-not-in-engine'] },
  { code: 'model-not-in-engine-14', netlist: "* an E with control nodes and a table\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e 0 out 0 table=(0,0,5,10)\nRe e 0 1k\n.op\n.end\n", prints: ["unknown device type"], fails: true, traps: ['model-not-in-engine'] },
  { code: 'non-ascii-node-15', netlist: "* a node a formula reads, with Turkish letters\nV1 giris 0 10\nR1 giris \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 1k\nB1 b 0 V=v(\u00e7\u0131k\u0131\u015f)*2\nRb b 0 1k\n.op\n.end\n", vectors: { "v(b)": 10, "v(____k____)": 5 }, traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-16', netlist: "* formulas that read a node with Turkish letters\nV1 giris 0 10\nR1 giris \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 1k\nB2 0 b2 I=v(\u00e7\u0131k\u0131\u015f)/1k\nRb2 b2 0 1k\nB3 b3 0 V=v(giris,\u00e7\u0131k\u0131\u015f)\nRb3 b3 0 1k\nE1 e 0 VALUE={v(\u00e7\u0131k\u0131\u015f)*2}\nRe e 0 1k\nR4 x 0 R={1k+v(\u00e7\u0131k\u0131\u015f)}\nRx giris x 1k\n.op\n.end\n", vectors: { "v(b2)": 5, "v(b3)": 5, "v(e)": 10, "v(x)": 5.012468827930174 }, traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-17', netlist: "* a part after .end on a node with Turkish letters\nV1 giris 0 10\nR1 giris \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 1k\n.op\n.end\nR3 \u00e7\u0131k\u0131\u015f 0 1k\n", vectors: { "v(____k____)": 3.333333333333333, "i(v1)": -0.006666666666666667 }, traps: ['non-ascii-node', 'after-end'] },
  { code: 'non-ascii-node-18', netlist: "* a .tf after .end on a node with Turkish letters\nV1 giris 0 10\nR1 giris \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 1k\n.end\n.tf v(\u00e7\u0131k\u0131\u015f) V1\n", vectors: { "v(Transfer_function)": 0.5 }, traps: ['non-ascii-node', 'after-end'] },
  { code: 'non-ascii-node-19', netlist: "* .pz on a node with Turkish letters\nV1 giris 0 dc 10 ac 1\nR1 giris \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 1k\nC1 \u00e7\u0131k\u0131\u015f 0 1u\n.pz giris 0 \u00e7\u0131k\u0131\u015f 0 vol pz\n.end\n", traps: ['non-ascii-node'] },
  { code: 'invisible-character-67', netlist: "* a zero-width space in a node a formula reads\nV1 giris 0 10\nR1 giris ou\u200bt 1k\nR2 ou\u200bt 0 1k\nB1 b 0 V=v(ou\u200bt)*2\nRb b 0 1k\n.op\n.end\n", vectors: { "v(b)": 10 }, traps: ['invisible-character'] },
  { code: 'look-alike-letter-18', netlist: "* a Cyrillic o in a node a formula reads\nV1 giris 0 10\nR1 giris \u043eut 1k\nR2 \u043eut 0 1k\nB1 b 0 V=v(\u043eut)*2\nRb b 0 1k\n.op\n.end\n", vectors: { "v(b)": 10 }, traps: ['look-alike-letter'] },
  { code: 'space-character-22', netlist: "* a thin space in a formula\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nB1 e 0 V=v(out)\u2009*2\nRe e 0 1k\n.op\n.end\n", prints: ["unknown parameter (_)"], fails: true, traps: ['space-character'] },
  { code: 'space-character-23', netlist: "* a thin space between v and its bracket\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nB1 e 0 V=v\u2009(out)*2\nRe e 0 1k\n.op\n.end\n", prints: ["Undefined parameter [v]"], fails: true, traps: ['space-character'] },
  { code: 'space-character-24', netlist: "* a thin space in a node a formula reads\nV1 giris 0 10\nR1 giris o\u2009ut 1k\nR2 o\u2009ut 0 1k\nB1 b 0 V={v(o\u2009ut)*2}\nRb b 0 1k\n.op\n.end\n", vectors: { "v(b)": 10 }, traps: ['space-character'] },
  { code: 'nbsp-4', netlist: "* a no-break space in a formula\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nB1 e 0 V=v(out)\u00a0*2\nRe e 0 1k\n.op\n.end\n", prints: ["unknown parameter (_)"], fails: true, traps: ['nbsp'] },  // The round-1 critic of the formulas lane (13 November 2026). A name a formula, a dot command or a part after .end
  // writes with a capital letter (Çıkış) is the node ngspice spells the same (çıkış): renamed with it (CR1-1). The
  // renames reach .save, .global and a .func's formula too (CR1-3). A character that looks like a space anywhere in a
  // formula is taken out, and the words ngspice says depend on where it stands (CR1-2, CR1-4); a node called value
  // on an E line (CR1-10); one word before a formula that native ngspice lets through (missing-fields-10).
  { code: 'non-ascii-node-20', netlist: "* formulas that write the node with a capital letter\nV1 giris 0 10\nR1 giris \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 1k\nB1 b 0 V=v(\u00c7\u0131k\u0131\u015f)*2\nRb b 0 1k\nE1 e 0 VALUE={v(\u00c7\u0131k\u0131\u015f)*2}\nRe e 0 1k\n.op\n.end\n", vectors: { "v(b)": 10, "v(e)": 10, "v(____k____)": 5 }, traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-21', netlist: "* .pz that writes the node with a capital letter\nV1 giris 0 dc 10 ac 1\nR1 giris \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 1k\nC1 \u00e7\u0131k\u0131\u015f 0 1u\n.pz giris 0 \u00c7\u0131k\u0131\u015f 0 vol pz\n.end\n", traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-22', netlist: "* a part after .end that writes the node with a capital letter\nV1 giris 0 10\nR1 giris \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 1k\n.op\n.end\nR3 \u00c7\u0131k\u0131\u015f 0 1k\n", vectors: { "v(____k____)": 3.333333333333333, "i(v1)": -0.006666666666666667 }, traps: ['non-ascii-node', 'after-end'] },
  { code: 'non-ascii-node-23', netlist: "* .save names the node bare\nV1 giris 0 10\nR1 giris \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 1k\n.save \u00e7\u0131k\u0131\u015f\n.op\n.end\n", vectors: { "v(____k____)": 5 }, traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-24', netlist: "* .global with a node with Turkish letters\n.global \u00e7\u0131k\u0131\u015f\nV1 giris 0 10\nR1 giris \u00e7\u0131k\u0131\u015f 1k\nR3 \u00e7\u0131k\u0131\u015f 0 2k\nX1 sub\n.subckt sub\nR2 \u00e7\u0131k\u0131\u015f 0 1k\n.ends\n.op\n.end\n", vectors: { "v(____k____)": 4 }, traps: ['non-ascii-node'] },
  { code: 'non-ascii-node-25', netlist: "* a .func that reads a node with Turkish letters\nV1 giris 0 10\nR1 giris \u00e7\u0131k\u0131\u015f 1k\nR2 \u00e7\u0131k\u0131\u015f 0 1k\n.func vo() {v(\u00e7\u0131k\u0131\u015f)}\nB1 b 0 V=vo()*2\nRb b 0 1k\n.op\n.end\n", vectors: { "v(b)": 10, "v(____k____)": 5 }, traps: ['non-ascii-node'] },
  { code: 'fatal-syntax-17', netlist: "* a node called value\nV1 in 0 5\nR1 in value 1k\nR2 value 0 1k\nE1 e 0 value 0 2\nRe e 0 1k\n.op\n.end\n", prints: ["mal formed E source instance"], fails: true, traps: ['fatal-syntax'] },
  { code: 'missing-fields-10', netlist: "* one word before a formula with a bracket\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e 0 x VALUE={v(out)*2}\nRe e 0 1k\n.op\n.end\n", vectors: { "v(e)": 5 }, traps: [] },
  { code: 'space-character-25', netlist: "* a thin space at the start of a formula\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nB1 e 0 V=\u2009v(out)*2\nRe e 0 1k\n.op\n.end\n", prints: ["parameter value out of range or the wrong type"], fails: true, traps: ['space-character'] },
  { code: 'space-character-26', netlist: "* a thin space after an operator in a formula\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nB1 e 0 V=v(out)*\u20092\nRe e 0 1k\n.op\n.end\n", prints: ["The internal check of parse tree", "parameter value out of range or the wrong type"], fails: true, traps: ['space-character'] },
  { code: 'space-character-27', netlist: "* a thin space between the digits of a number in a formula\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nB1 e 0 V={1\u2009000*v(out)/1k}\nRe e 0 1k\n.op\n.end\n", prints: ["unknown parameter (_)"], fails: true, traps: ['space-character'] },
  { code: 'space-character-28', netlist: "* a thin space after a bracket in a formula\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nB1 e 0 V=(\u2009v(out))*2\nRe e 0 1k\n.op\n.end\n", prints: ["YYparse error, syntax error, in expression"], fails: true, traps: ['space-character'] },
  { code: 'space-character-29', netlist: "* a thin space after a function's name in a formula\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nB1 e 0 V=abs\u2009(v(out))*2\nRe e 0 1k\n.op\n.end\n", prints: ["Cannot compute substitute"], fails: true, traps: ['space-character'] },
  { code: 'space-character-30', netlist: "* a thin space between a formula and tc1=\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nB1 e 0 V=v(out)*2\u2009tc1=0\nRe e 0 1k\n.op\n.end\n", prints: ["unknown parameter (_)"], fails: true, traps: ['space-character'] },
  { code: 'nbsp-5', netlist: "* a no-break space between v and its bracket\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nB1 e 0 V=v\u00a0(out)*2\nRe e 0 1k\n.op\n.end\n", prints: ["Undefined parameter [v]"], fails: true, traps: ['nbsp'] },
  { code: 'nbsp-6', netlist: "* two no-break spaces in a formula\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nB1 e 0 V=2\u00a0*\u00a0v(out)\nRe e 0 1k\n.op\n.end\n", prints: ["unknown parameter (_)"], fails: true, traps: ['nbsp'] },
  // After the round-2 critic of the formulas lane (13 November 2026): a formula without braces that starts with a sign
  // and a number stops ngspice, one that starts with a sign before a letter or with a bracket runs (CR2-1).
  { code: 'fatal-syntax-18', netlist: "* VALUE=-2*v(out) without braces\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e 0 VALUE=-2*v(out)\nRe e 0 1k\n.op\n.end\n", prints: ["mal formed E source instance"], fails: true, traps: ['fatal-syntax'] },
  { code: 'fatal-syntax-19', netlist: "* formulas without braces that start with a sign or a bracket\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e1 0 VALUE=-v(out)*2\nR1e e1 0 1k\nE2 e2 0 VALUE=(1+v(out))*2\nR2e e2 0 1k\nG1 0 g cur=-v(out)/1k\nRg g 0 1k\nE3 e3 0 VALUE=(2)*v(out)\nR3e e3 0 1k\n.op\n.end\n", vectors: { "v(e1)": -5, "v(e2)": 7, "v(g)": -2.5, "v(e3)": 5 }, traps: [] },
  // After VALUE without =, ngspice drops what stands before the formula's {: a no-break space or words (CR2-6).
  { code: 'nbsp-7', netlist: "* a no-break space between VALUE and its brace\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e1 0 VALUE \u00a0{v(out)*2}\nR1e e1 0 1k\nE2 e2 0 VALUE\u00a0{v(out)*3}\nR2e e2 0 1k\nE3 e3 0 VALUE\u00a0=v(out)*4\nR3e e3 0 1k\n.op\n.end\n", vectors: { "v(e1)": 5, "v(e2)": 7.5, "v(e3)": 10 }, traps: [] },
  { code: 'missing-fields-11', netlist: "* words between VALUE and its brace\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\nE1 e1 0 VALUE x {v(out)*2}\nR1e e1 0 1k\nE2 e2 0 VALUE v(out) {2}\nR2e e2 0 1k\n.op\n.end\n", vectors: { "v(e1)": 5, "v(e2)": 2 }, traps: [] },
  // A node called value as the control - node, an output node or a POLY control node (CR2-4).
  { code: 'fatal-syntax-20', netlist: "* a node called value as the control - node\nV1 in 0 5\nR1 in mid 1k\nR2 mid value 1k\nR3 value 0 1k\nE1 e 0 mid value 2\nRe e 0 1k\n.op\n.end\n", prints: ["mal formed E source instance"], fails: true, traps: ['fatal-syntax'] },
];

const root = resolve(import.meta.dirname, '../..');
const runs = new Map<string, RunResult>();
const fixed = new Map<string, { label: string; netlist: string; run: RunResult }[]>();
/** For a netlist with several problems: the fixes applied in turn, and the run of what they give. */
const inTurn = new Map<string, { netlist: string; run: RunResult }>();

beforeAll(async () => {
  const engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
  for (const f of FACTS) {
    runs.set(f.code, await engine.run(f.netlist));
    const list: { label: string; netlist: string; run: RunResult }[] = [];
    if (f.fixInTurn) {
      let netlist = f.netlist;
      const labels: string[] = [];
      for (let k = 0; k < f.traps.length; k++) {
        const t = checkTraps(parseNetlist(netlist)).find((x) => x.fixes.length > 0);
        if (!t) break;
        labels.push(`${t.id}: ${t.fixes[0]!.label}`);
        netlist = applyFix(netlist, t.fixes[0]!);
      }
      list.push({ label: labels.join(', then '), netlist, run: await engine.run(netlist) });
    } else {
      for (const t of checkTraps(parseNetlist(f.netlist))) {
        for (const fix of t.fixes) {
          const netlist = applyFix(f.netlist, fix);
          list.push({ label: `${t.id}: ${fix.label}`, netlist, run: await engine.run(netlist) });
        }
      }
    }
    fixed.set(f.code, list);
    if (f.several) {
      // The first fix of the first trap that has one, again and again, until no trap offers a fix.
      let netlist = f.netlist;
      for (let k = 0; k < 10; k++) {
        const next = checkTraps(parseNetlist(netlist)).find((t) => t.fixes.length > 0);
        if (!next) break;
        netlist = applyFix(netlist, next.fixes[0]!);
      }
      inTurn.set(f.code, { netlist, run: await engine.run(netlist) });
    }
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
    if (fact.several) {
      // Each fix takes its own trap away; the fixes in turn give a clean run.
      const before = checkTraps(parseNetlist(fact.netlist));
      for (const t of before) {
        for (const fix of t.fixes) {
          const after = checkTraps(parseNetlist(applyFix(fact.netlist, fix)));
          expect(after.filter((x) => x.id === t.id).length, `${t.id}: ${fix.label}`).toBeLessThan(before.filter((x) => x.id === t.id).length);
        }
      }
      expect(before.some((t) => t.fixes.length > 0)).toBe(true);
      const last = inTurn.get(fact.code)!;
      expect(last.run.ok, `${last.netlist}${last.run.stderr}`).toBe(true);
      expect(last.run.unreliable, last.netlist).toBe(false);
      expect(checkTraps(parseNetlist(last.netlist)).filter((t) => t.severity !== 'info'), last.netlist).toEqual([]);
      return;
    }
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

it('C3-1: a rename reaches the formulas, .pz and the lines after .end, so the renamed netlist gives the same numbers', () => {
  const rename = (code: string): { label: string; netlist: string; run: RunResult } => fixed.get(code)!.find((f) => !f.label.startsWith('after-end'))!;
  // [fact, the old name, the numbers before, the same numbers after the rename, by the new name]
  const cases: [string, string, Record<string, number>, Record<string, number>][] = [
    ['non-ascii-node-15', '\u00e7\u0131k\u0131\u015f', { 'v(b)': 10, 'v(____k____)': 5 }, { 'v(b)': 10, 'v(cikis)': 5 }],
    ['non-ascii-node-16', '\u00e7\u0131k\u0131\u015f', { 'v(b2)': 5, 'v(b3)': 5, 'v(e)': 10, 'v(x)': 5.012468827930174 }, { 'v(b2)': 5, 'v(b3)': 5, 'v(e)': 10, 'v(x)': 5.012468827930174 }],
    ['non-ascii-node-17', '\u00e7\u0131k\u0131\u015f', { 'v(____k____)': 3.333333333333333, 'i(v1)': -0.006666666666666667 }, { 'v(cikis)': 3.333333333333333, 'i(v1)': -0.006666666666666667 }],
    ['non-ascii-node-18', '\u00e7\u0131k\u0131\u015f', { 'v(Transfer_function)': 0.5 }, { 'v(Transfer_function)': 0.5, 'v(output_impedance_at_V(cikis))': 500 }],
    ['non-ascii-node-19', '\u00e7\u0131k\u0131\u015f', { 'v(pole(1))': -2000 }, { 'v(pole(1))': -2000 }],
    ['invisible-character-67', 'ou\u200bt', { 'v(b)': 10, 'v(ou___t)': 5 }, { 'v(b)': 10, 'v(out)': 5 }],
    ['look-alike-letter-18', '\u043eut', { 'v(b)': 10, 'v(__ut)': 5 }, { 'v(b)': 10, 'v(out)': 5 }],
    ['space-character-24', 'o\u2009ut', { 'v(b)': 10, 'v(o___ut)': 5 }, { 'v(b)': 10, 'v(out)': 5 }],
  ];
  for (const [code, old, before, after] of cases) {
    const f = rename(code);
    expect(f.netlist, `${code}: ${f.label}`).not.toContain(old);
    for (const [name, want] of Object.entries(before)) expect(vector(runs.get(code)!, name), `${code} before: ${name}`).toEqual([want]);
    for (const [name, want] of Object.entries(after)) expect(vector(f.run, name), `${code} after: ${name}`).toEqual([want]);
  }
});

it('C3-1: "Rename" and "Move .end to the bottom" give the same circuit in either order (non-ascii-node-17)', () => {
  const text = FACTS.find((f) => f.code === 'non-ascii-node-17')!.netlist;
  const step = (netlist: string, id: string): string => applyFix(netlist, checkTraps(parseNetlist(netlist)).find((t) => t.id === id)!.fixes[0]!);
  const one = step(step(text, 'non-ascii-node'), 'after-end');
  const other = step(step(text, 'after-end'), 'non-ascii-node');
  expect(one).toBe(other);
  expect(one).toContain('R3 cikis 0 1k');
});

it('CR1-1, CR1-3: a name written with a capital letter, .save, .global and a .func are renamed with the node, so the renamed netlist gives the same numbers', () => {
  // [fact, the numbers before, the same numbers after the rename, by the new name]
  const cases: [string, Record<string, number>, Record<string, number>][] = [
    ['non-ascii-node-20', { 'v(b)': 10, 'v(e)': 10, 'v(____k____)': 5 }, { 'v(b)': 10, 'v(e)': 10, 'v(cikis)': 5 }],
    ['non-ascii-node-21', { 'v(pole(1))': -2000 }, { 'v(pole(1))': -2000 }],
    ['non-ascii-node-22', { 'v(____k____)': 3.333333333333333, 'i(v1)': -0.006666666666666667 }, { 'v(cikis)': 3.333333333333333, 'i(v1)': -0.006666666666666667 }],
    ['non-ascii-node-23', { 'v(____k____)': 5 }, { 'v(cikis)': 5 }],
    ['non-ascii-node-24', { 'v(____k____)': 4 }, { 'v(cikis)': 4 }],
    ['non-ascii-node-25', { 'v(b)': 10, 'v(____k____)': 5 }, { 'v(b)': 10, 'v(cikis)': 5 }],
  ];
  for (const [code, before, after] of cases) {
    const f = fixed.get(code)!.find((x) => x.label.startsWith('non-ascii-node'))!;
    expect(f.label, code).toBe('non-ascii-node: Rename çıkış to cikis');
    // Neither spelling is left on a line ngspice reads (the title is a comment line here).
    expect(f.netlist.split('\n').slice(1).join('\n'), code).not.toMatch(/çıkış|Çıkış/);
    for (const [name, want] of Object.entries(before)) expect(vector(runs.get(code)!, name), `${code} before: ${name}`).toEqual([want]);
    for (const [name, want] of Object.entries(after)) expect(vector(f.run, name), `${code} after: ${name}`).toEqual([want]);
  }
  // The check for names ngspice makes one says nothing: Çıkış in a formula is no second node (CR1-1).
  for (const code of ['non-ascii-node-20', 'non-ascii-node-21']) expect(checkTraps(parseNetlist(FACTS.find((x) => x.code === code)!.netlist)).map((t) => t.severity), code).toEqual(['warning']);
});

it('CR1-3: the drawing editor\'s rename reaches .save, .global and a .func\'s formula, before and after .end: the same numbers', async () => {
  const engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
  const cases: [string, string, Record<string, number>][] = [
    ['.save', '* t\nV1 in 0 10\nR1 in out 1k\nR2 out 0 1k\n.save out\n.op\n.end\n', { 'v(out)': 5 }],
    ['.save after .end', '* t\nV1 in 0 10\nR1 in out 1k\nR2 out 0 1k\n.op\n.end\n.save out\n', { 'v(out)': 5 }],
    ['.global', '* t\n.global out\nV1 in 0 10\nR1 in out 1k\nR3 out 0 2k\nX1 sub\n.subckt sub\nR2 out 0 1k\n.ends\n.op\n.end\n', { 'v(out)': 4 }],
    ['.func', '* t\n.func vo() {v(out)}\nV1 in 0 10\nR1 in out 1k\nR2 out 0 1k\nB1 b 0 V=vo()*2\nRb b 0 1k\n.op\n.end\n', { 'v(out)': 5, 'v(b)': 10 }],
  ];
  for (const [form, text, want] of cases) {
    const r = applyEdit(buildSchematic(text), { kind: 'rename-node', node: 'out', name: 'vout' }, { drawingInText: true });
    expect(r.ok, `${form}: ${r.reason}`).toBe(true);
    const before = await engine.run(text);
    const after = await engine.run(r.text);
    for (const [name, v] of Object.entries(want)) {
      expect(vector(before, name), `${form} before: ${name}`).toEqual([v]);
      expect(vector(after, name.replace('(out)', '(vout)')), `${form} after: ${name}\n${r.text}`).toEqual([v]);
    }
  }
});

it('CR1-2, CR1-4: the fix takes every character that looks like a space out of the formula, wherever it stands, and the formula runs', () => {
  for (const code of ['space-character-25', 'space-character-26', 'space-character-27', 'space-character-28', 'space-character-29', 'space-character-30', 'nbsp-5', 'nbsp-6']) {
    const [f] = fixed.get(code)!;
    expect(f!.netlist, code).not.toMatch(/[   -   　]/);
    expect(vector(f!.run, 'v(e)'), code).toEqual([code === 'space-character-27' ? 2.5 : 5]);
  }
  // Before B's own setting the character becomes a normal space: without one, ngspice stops again (space-character-30).
  expect(fixed.get('space-character-30')![0]!.netlist).toContain('B1 e 0 V=v(out)*2 tc1=0\n');
  expect(fixed.get('nbsp-6')![0]!.label).toBe('nbsp: Take them out');
});

it('fatal-syntax-17: a node called value is renamed, on the E line too, and E1 then gives what native ngspice gave', () => {
  const [f] = fixed.get('fatal-syntax-17')!;
  expect(f!.label).toBe('fatal-syntax: Rename the node value to val');
  expect(f!.netlist).toContain('E1 e 0 val 0 2');
  expect(vector(f!.run, 'v(e)')).toEqual([5]);
});

it('fatal-syntax-20: a node called value as the control − node is renamed, and E1 then gives what native ngspice gave (3.333 V), not the constant 2 V braces gave (CR2-4)', () => {
  const [f] = fixed.get('fatal-syntax-20')!;
  expect(f!.label).toBe('fatal-syntax: Rename the node value to val');
  expect(f!.netlist).toContain('E1 e 0 mid val 2');
  expect(vector(f!.run, 'v(e)')).toEqual([3.333333333333333]);
});

it('model-not-in-engine-7, -9 to -11: POLY(1) with the coefficients 0 and k is written as the plain gain k, which gives what native ngspice gave', () => {
  const cases: [string, string, Record<string, number>][] = [
    ['model-not-in-engine-7', 'model-not-in-engine: Write it without POLY: E1 e 0 out 0 2', { 'v(e)': 5 }],
    ['model-not-in-engine-9', 'model-not-in-engine: Write it without POLY: F1 0 e Vx 2', { 'v(e)': 10 }],
    ['model-not-in-engine-10', 'model-not-in-engine: Write it without POLY: G1 0 e out 0 2m', { 'v(e)': 5 }],
    ['model-not-in-engine-11', 'model-not-in-engine: Write it without POLY: H1 e 0 Vx 1k', { 'v(e)': 5 }],
  ];
  for (const [code, label, want] of cases) {
    const [f] = fixed.get(code)!;
    expect(f!.label).toBe(label);
    for (const [name, v] of Object.entries(want)) expect(vector(f!.run, name), `${code}: ${name}`).toEqual([v]);
  }
  // POLY(2) and TABLE have no plain gain: no fix (model-not-in-engine-8, -12 to -14).
  for (const code of ['model-not-in-engine-8', 'model-not-in-engine-12', 'model-not-in-engine-13', 'model-not-in-engine-14']) expect(fixed.get(code), code).toEqual([]);
});

it('runs every offered fix (there are many)', () => {
  expect([...fixed.values()].flat().length).toBeGreaterThan(90);
});
