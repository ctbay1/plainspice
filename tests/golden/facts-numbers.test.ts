/**
 * docs/spice-facts/numbers-and-syntax.md, checked against our WebAssembly engine.
 *
 * Every claim's netlist runs through the engine (the same code the page uses) and the claimed
 * result is asserted: rawfile vectors bit for bit as native ngspice 47 gave them, the messages
 * ngspice prints, whether the run fails. Then the parser (src/spice/parse.ts, numbers.ts) reads
 * the same netlist, and what it says must agree with what the engine computed. The first-letter
 * table checks the element catalog (src/spice/elements.ts) the same way.
 *
 * The netlists and values come from runs of native ngspice 47 and 42 recorded on 9 Nov 2026; the
 * document shows those outputs verbatim. If a new ngspice reads a netlist differently, this test
 * fails and the document must be checked again.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { NgspiceEngine } from '../../src/engine/ngspice.ts';
import type { RunResult } from '../../src/engine/types.ts';
import { elementInfo } from '../../src/spice/elements.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import type { Element, Netlist } from '../../src/spice/types.ts';

interface Fact {
  /** The claim's ID in numbers-and-syntax.md. */
  code: string;
  id: string;
  title: string;
  netlist: string;
  /** Rawfile vectors, exactly as native ngspice 47 gave them (except where noted in N15). */
  vectors?: Record<string, number | number[]>;
  /** Text the run prints, on stdout or stderr. */
  prints?: string[];
  /** The run gives no results. */
  fails?: true;
  /** The engine marks the numbers unreliable: ngspice's DC solution failed. */
  unreliable?: true;
}

const FACTS: Fact[] = [
  { code: 'N1', id: 'num-1M-current', title: "1M is one milli-unit: on a current source it is 1 mA", netlist: "* 1M on a current source\nI1 0 n1 1M\nR1 n1 0 1\n.op\n.end\n", vectors: { "v(n1)": 0.001 } },
  { code: 'N2', id: 'num-m-case-meg', title: "M and m are milli; MEG, Meg and meg are mega", netlist: "* M is milli in any case; MEG is mega\nV1 n1 0 1M\nV2 n2 0 1m\nV3 n3 0 1meg\nV4 n4 0 1MEG\nV5 n5 0 1Meg\n.op\n.end\n", vectors: { "v(n1)": 0.001, "v(n2)": 0.001, "v(n3)": 1000000, "v(n4)": 1000000, "v(n5)": 1000000 } },
  { code: 'N3', id: 'num-scale-letters', title: "The scale letters: T G K U N P F A, M (milli), MEG, MIL, in either case", netlist: "* every scale letter\nV1 n1 0 1t\nV2 n2 0 1g\nV3 n3 0 1k\nV4 n4 0 1u\nV5 n5 0 1n\nV6 n6 0 1p\nV7 n7 0 1f\nV8 n8 0 1a\nV9 n9 0 1mil\nV10 n10 0 1T\nV11 n11 0 1G\nV12 n12 0 1K\nV13 n13 0 1U\nV14 n14 0 1N\nV15 n15 0 1P\nV16 n16 0 1F\nV17 n17 0 1A\nV18 n18 0 1MIL\n.op\n.end\n", vectors: { "v(n1)": 1000000000000, "v(n2)": 1000000000, "v(n3)": 1000, "v(n4)": 0.000001, "v(n5)": 1e-9, "v(n6)": 1e-12, "v(n7)": 1e-15, "v(n8)": 1e-18, "v(n9)": 0.000025399999999999997, "v(n10)": 1000000000000, "v(n11)": 1000000000, "v(n12)": 1000, "v(n13)": 0.000001, "v(n14)": 1e-9, "v(n15)": 1e-12, "v(n16)": 1e-15, "v(n17)": 1e-18, "v(n18)": 0.000025399999999999997 } },
  { code: 'N4', id: 'num-units-ignored', title: "Letters after the number and its scale letter are ignored", netlist: "* letters after the number and its scale letter are ignored\nV1 n1 0 10kOhm\nV2 n2 0 1MOhm\nV3 n3 0 10V\nV4 n4 0 3A\nV5 n5 0 100mV\nV6 n6 0 1x\nV7 n7 0 1megohm\nV8 n8 0 1milli\n.op\n.end\n", vectors: { "v(n1)": 10000, "v(n2)": 0.001, "v(n3)": 10, "v(n4)": 3.0000000000000002e-18, "v(n5)": 0.1, "v(n6)": 1, "v(n7)": 1000000, "v(n8)": 0.000025399999999999997 } },
  { code: 'N5', id: 'num-micro-sign', title: "The micro sign \u00b5 works like u; the Greek letter \u03bc is ignored", netlist: "* the micro sign and the Greek letter mu\nV1 n1 0 1\u00b5\nV2 n2 0 1\u03bc\nV3 n3 0 4.7\u00b5F\n.op\n.end\n", vectors: { "v(n1)": 0.000001, "v(n2)": 1, "v(n3)": 0.0000047 } },
  { code: 'N6', id: 'num-digits-after-scale', title: "Digits after the scale letter are ignored: 2k2 is 2 k, not 2.2 k", netlist: "* digits after the scale letter are ignored\nV1 n1 0 2k2\nV2 n2 0 4k7\nV3 n3 0 1meg5\n.op\n.end\n", vectors: { "v(n1)": 2000, "v(n2)": 4000, "v(n3)": 1000000 } },
  { code: 'N7', id: 'num-exponents', title: "Exponents: e or d, either case; an exponent and a scale letter both apply", netlist: "* exponents with e or d\nV1 n1 0 1e3\nV2 n2 0 1E3\nV3 n3 0 1d3\nV4 n4 0 1e-3\nV5 n5 0 1e3k\nV6 n6 0 2.5e+2\n.op\n.end\n", vectors: { "v(n1)": 1000, "v(n2)": 1000, "v(n3)": 1000, "v(n4)": 0.001, "v(n5)": 1000000, "v(n6)": 250 } },
  { code: 'N8', id: 'num-d-minus-source', title: "A minus sign after d starts a new word: on a source line 1d-3 is an error", netlist: "* d with a minus sign on a source line\nV1 n1 0 1d-3\nR1 n1 0 1\n.op\n.end\n", prints: ["unknown parameter (-3)"], fails: true },
  { code: 'N9', id: 'num-d-minus-resistor', title: "On a resistor line that second word replaces the value: R1 n1 0 1d-3 is −3 Ω", netlist: "* d with a minus sign on a resistor line\nI1 0 n1 1\nR1 n1 0 1d-3\n.op\n.end\n", vectors: { "v(n1)": -3 } },
  { code: 'N10', id: 'syn-plus-after-r-value', title: "A minus sign after a scale letter also starts a new word: R1 n1 0 1k-2 is −2 Ω", netlist: "* a value with a minus sign glued on\nI1 0 n1 1\nR1 n1 0 1k-2\n.op\n.end\n", vectors: { "v(n1)": -2 } },
  { code: 'N11', id: 'num-stops-early', title: "The number stops at the first character it cannot use", netlist: "* the number stops at the first character it cannot use\nV1 n1 0 1_000\nV2 n2 0 1.5.2\nV3 n3 0 1.\nV4 n4 0 .5\nV5 n5 0 -2\nV6 n6 0 +3\nV7 n7 0 1:5\n.op\n.end\n", vectors: { "v(n1)": 1, "v(n2)": 1.5, "v(n3)": 1, "v(n4)": 0.5, "v(n5)": -2, "v(n6)": 3, "v(n7)": 1 } },
  { code: 'N12', id: 'num-space-error', title: "A space between the number and its letter makes two words: 1 k stops ngspice", netlist: "* a space between the number and its scale letter\nV1 n1 0 1 k\nR1 n1 0 1\n.op\n.end\n", prints: ["unknown parameter (k)"], fails: true },
  { code: 'N13', id: 'num-comma-resistor', title: "A decimal comma on a resistor line gives the second number: 1,5k is 5 kΩ", netlist: "* a decimal comma in a resistor value\nI1 0 n1 1\nR1 n1 0 1,5k\n.op\n.end\n", vectors: { "v(n1)": 5000 } },
  { code: 'N14', id: 'num-comma-source', title: "On a source line 1,5 stops ngspice: unknown parameter (5)", netlist: "* a decimal comma in a source value\nV1 n1 0 1,5\nR1 n1 0 1\n.op\n.end\n", prints: ["unknown parameter (5)"], fails: true },
  { code: 'N15', id: 'num-arithmetic', title: "ngspice computes digits × a power of ten, so 0.3 is 0.30000000000000004", netlist: "* how ngspice computes a value: digits times a power of ten\nV1 n1 0 0.3\nV2 n2 0 1e-4\nV3 n3 0 2.2k\nV4 n4 0 1e23\nV5 n5 0 1e126\nV6 n6 0 1.1\nV7 n7 0 3.3\n.op\n.end\n", vectors: { "v(n1)": 0.30000000000000004, "v(n2)": 0.0001, "v(n3)": 2200, "v(n4)": 1.0000000000000001e+23, "v(n5)": 1.0000000000000001e+126, "v(n6)": 1.1, "v(n7)": 3.3000000000000003 } },
  { code: 'N16', id: 'num-huge', title: "Huge numbers follow C: the exponent wraps around at 2³², 1e400 is infinity", netlist: "* very long numbers and exponents\nV1 n1 0 1e4294967296\nV2 n2 0 1e4294967297\nV3 n3 0 123456789012345678901234567890\nV4 n4 0 1e400\nV5 n5 0 1e-400\n.op\n.end\n", vectors: { "v(n1)": 1, "v(n2)": 10, "v(n3)": 1.2345678901234566e+29, "v(n4)": Infinity, "v(n5)": 0 } },
  { code: 'N17', id: 'num-expression', title: "Expressions in braces or single quotes are evaluated by ngspice", netlist: "* expressions in braces or quotes\nI1 0 n1 1\nR1 n1 0 {1k*2}\nI2 0 n2 1\nR2 n2 0 '2*3'\n.op\n.end\n", vectors: { "v(n1)": 2000, "v(n2)": 6.000000000000002 } },
  { code: 'N18', id: 'num-kelvin-sign', title: "Letters are compared byte by byte: the Kelvin sign K is not k", netlist: "* the Kelvin sign is not k\nV1 n1 0 1\u212a\n.op\n.end\n", vectors: { "v(n1)": 1 } },
  { code: 'S1', id: 'syn-title-element', title: "Line 1 is always the title: a part written there disappears", netlist: "V1 n1 0 6\nR1 n1 0 2\n.op\n.end\n", vectors: { "v(n1)": 0 } },
  { code: 'S2', id: 'syn-title-blank', title: "A blank first line is the title too", netlist: "\nV1 n1 0 6\nR1 n1 0 2\n.op\n.end\n", vectors: { "v(n1)": 6, "i(v1)": -3 } },
  { code: 'S3', id: 'syn-title-dot', title: "A dot command on line 1 is also just the title", netlist: ".op\nV1 n1 0 6\nR1 n1 0 2\n.end\n", fails: true },
  { code: 'S4', id: 'syn-title-at', title: "Exception: a first line starting with @ ends the netlist before the title", netlist: "@ title\nV1 n1 0 6\nR1 n1 0 2\n.op\n.end\n", prints: ["there aren't any circuits loaded"], fails: true },
  { code: 'S5', id: 'syn-title-backslashes', title: "A title ending in two backslashes swallows line 2", netlist: "title ending in two backslashes \\\\\nI1 0 n1 1\nR1 n1 0 2\nR2 n1 0 2\n.op\n.end\n", vectors: { "v(n1)": 0 } },
  { code: 'S6', id: 'syn-star-line', title: "A star at the start of a line makes a comment", netlist: "* a star at the start of a line makes a comment\nI1 0 n1 1\n* R9 n1 0 1\nR1 n1 0 2\n.op\n.end\n", vectors: { "v(n1)": 2 } },
  { code: 'S7', id: 'syn-star-midline', title: "A star in the middle of a line is not a comment", netlist: "* a star in the middle of a line is not a comment\nI1 0 n1 1\nR1 n1 0 2 * 5\n.op\n.end\n", prints: ["unknown parameter (*)"], fails: true },
  { code: 'S8', id: 'syn-hash-line', title: "A hash at the start of a line is a comment in ngspice 47 (an error in 42)", netlist: "* a hash at the start of a line\nI1 0 n1 1\nR1 n1 0 2\n# R9 n1 0 1\n.op\n.end\n", vectors: { "v(n1)": 2 } },
  { code: 'S9', id: 'syn-hash-midline', title: "A hash in the middle of a line is not a comment", netlist: "* a hash in the middle of a line\nI1 0 n1 1\nR1 n1 0 2 # 5\n.op\n.end\n", prints: ["unknown parameter (#)"], fails: true },
  { code: 'S10', id: 'syn-unusual-first', title: "A line starting with = [ ] ? ( ) & % $ \" ! : , becomes a comment, with one warning", netlist: "* odd first characters turn a line into a comment\nI1 0 n1 1\nR1 n1 0 2\n$ R9 n1 0 1\n! R8 n1 0 1\n% R7 n1 0 1\n.op\n.end\n", vectors: { "v(n1)": 2 }, prints: ["Unusual leading characters"] },
  { code: 'S11', id: 'syn-semicolon-line', title: "A semicolon at the start of a line makes a comment, silently", netlist: "* a semicolon at the start of a line\nI1 0 n1 1\nR1 n1 0 2\n; R9 n1 0 1\n.op\n.end\n", vectors: { "v(n1)": 2 } },
  { code: 'S12', id: 'syn-inline-semicolon', title: "A semicolon anywhere starts an end-of-line comment", netlist: "* end-of-line comments with ;\nI1 0 n1 1\nR1 n1 0 2;5\nI2 0 n2 1\nR2 n2 0 3 ; 5\n.op\n.end\n", vectors: { "v(n1)": 2, "v(n2)": 3 } },
  { code: 'S13', id: 'syn-inline-dollar', title: "A dollar sign starts an end-of-line comment only after a space, tab or comma", netlist: "* end-of-line comments with $\nI1 0 n1 1\nR1 n1 0 2 $ 5\nI2 0 n2 1\nR2 n2 0 3 $5\nI3 0 n3 1\nR3 n3 0 4$ 5\nI4 0 n4 1\nR4 n4 0 6,$ 5\n.op\n.end\n", vectors: { "v(n1)": 2, "v(n2)": 3, "v(n3)": 5, "v(n4)": 6 } },
  { code: 'S14', id: 'syn-inline-slashes', title: "Two slashes start an end-of-line comment, with or without a space", netlist: "* end-of-line comments with //\nI1 0 n1 1\nR1 n1 0 2 // 5\nI2 0 n2 1\nR2 n2 0 3//5\n.op\n.end\n", vectors: { "v(n1)": 2, "v(n2)": 3 } },
  { code: 'S15', id: 'syn-single-slash', title: "One slash does not", netlist: "* one slash is not a comment\nI1 0 n1 1\nR1 n1 0 2 / 5\n.op\n.end\n", prints: ["unknown parameter (/)"], fails: true },
  { code: 'S16', id: 'syn-star-hash', title: "A line starting with *# is a command, not a comment", netlist: "* a line starting with *# is a command\nI1 0 n1 1\nR1 n1 0 2\n*# echo starhash-command-ran\n.op\n.end\n", vectors: { "v(n1)": 2 }, prints: ["starhash-command-ran"] },
  { code: 'S17', id: 'syn-double-hash', title: "So is ## in ngspice 47 (an error in 42)", netlist: "* a line starting with ## becomes a *# command\nI1 0 n1 1\nR1 n1 0 2\n## echo hashhash-command-ran\n.op\n.end\n", vectors: { "v(n1)": 2 }, prints: ["hashhash-command-ran"] },
  { code: 'S18', id: 'syn-continuation', title: "A line starting with + continues the line before", netlist: "* a + line continues the line before it\nI1 0 n1 1\nR1 n1 0\n+ 2\n.op\n.end\n", vectors: { "v(n1)": 2 } },
  { code: 'S19', id: 'syn-continuation-skips', title: "Comment lines (*, #, $, //) and blank lines may sit in between", netlist: "* comment and blank lines between a line and its continuation\nI1 0 n1 1\nR1 n1 0\n* a star comment\n\n+ 2\nI2 0 n2 1\nR2 n2 0\n# a hash comment\n+ 3\nI3 0 n3 1\nR3 n3 0\n$ a dollar comment\n+ 4\nI4 0 n4 1\nR4 n4 0\n// a slash comment\n+ 5\n.op\n.end\n", vectors: { "v(n1)": 2, "v(n2)": 3, "v(n3)": 4, "v(n4)": 5 } },
  { code: 'S20', id: 'syn-continuation-semicolon', title: "A ; comment line in between takes the continuation, and the part is dropped", netlist: "* a ; comment line between a line and its continuation\nI1 0 n1 1\nR0 n1 0 1k\nR1 n1 0\n; a semicolon comment\n+ 2\n.op\n.end\n", vectors: { "v(n1)": 1000 }, prints: ["'r1 n1 0' is not a valid resistor instance line, ignored!"] },
  { code: 'S21', id: 'syn-continuation-odd-line', title: "So does a line starting with one of the odd characters", netlist: "* a ! line between a line and its continuation\nI1 0 n1 1\nR0 n1 0 1k\nR1 n1 0\n! an odd comment\n+ 2\n.op\n.end\n", vectors: { "v(n1)": 1000 }, prints: ["'r1 n1 0' is not a valid resistor instance line, ignored!"] },
  { code: 'S22', id: 'syn-continuation-first', title: "A + line right after the title has nothing to continue: it is ignored silently", netlist: "* a + line right after the title\n+ R1 n1 0 2\nI1 0 n1 1\nR2 n1 0 4\n.op\n.end\n", vectors: { "v(n1)": 4 } },
  { code: 'S23', id: 'syn-continuation-dot', title: "Dot commands can be continued too", netlist: "* a continued dot command\nV1 in 0 1\nR1 in 0 1\n.dc V1 0 2\n+ 1\n.end\n", vectors: { "v(v-sweep)": [0, 1, 2] } },
  { code: 'S24', id: 'syn-backslashes', title: "Two backslashes at the end of a line continue it on the next line", netlist: "* two backslashes at the end of a line\nI1 0 n1 1\nR1 n1 0 \\\\\n2\n.op\n.end\n", vectors: { "v(n1)": 2 } },
  { code: 'S25', id: 'syn-end-then-more', title: "ngspice keeps reading after .end: a part after .end is in the circuit", netlist: "* lines after .end\nI1 0 n1 1\nR1 n1 0 2\n.op\n.end\nR2 n1 0 2\n", vectors: { "v(n1)": 1 } },
  { code: 'S26', id: 'syn-end-upper', title: ".END works like .end", netlist: "* .END in capitals\nI1 0 n1 1\nR1 n1 0 2\n.op\n.END\nR2 n1 0 2\n", vectors: { "v(n1)": 1 } },
  { code: 'S27', id: 'syn-end-glued-comment', title: "But .end with a comment glued on (.end;...) makes ngspice stop there", netlist: "* .end with a comment glued to it\nI1 0 n1 1\nR1 n1 0 2\n.op\n.end;the end\nR2 n1 0 2\n", vectors: { "v(n1)": 2 } },
  { code: 'S28', id: 'syn-end-continued', title: "A + line after .end continues the last part before .end", netlist: "* a + line after .end\nI1 0 n1 1\n.op\nR1 n1 0 2\n.end\n+ 3\n", vectors: { "v(n1)": 3 } },
  { code: 'S29', id: 'syn-at-line', title: "A line starting with @ silently ends the netlist", netlist: "* a line starting with @\nI1 0 n1 1\nR1 n1 0 2\n.op\n@ anything\nR2 n1 0 2\n.end\n", vectors: { "v(n1)": 2 } },
  { code: 'S30', id: 'syn-at-indented', title: "... also when it is indented", netlist: "* an indented line starting with @\nI1 0 n1 1\nR1 n1 0 2\n.op\n   @ anything\nR2 n1 0 2\n.end\n", vectors: { "v(n1)": 2 } },
  { code: 'S31', id: 'syn-control-block', title: "Lines between .control and .endc are commands, not parts", netlist: "* lines inside .control are commands, not parts\nI1 0 n1 1\nR1 n1 0 2\n.op\n.control\nR2 n1 0 2\n.endc\n.end\n", vectors: { "v(n1)": 2 }, prints: ["r2: no such command available in ngspice"] },
  { code: 'S32', id: 'syn-leading-space', title: "Leading spaces and tabs do not matter", netlist: "* leading spaces and tabs\nI1 0 n1 1\n   R1 n1 0\n\t+ 2\n   * R9 n1 0 1\n.op\n.end\n", vectors: { "v(n1)": 2 } },
  { code: 'S33', id: 'syn-tabs', title: "Tabs separate words like spaces", netlist: "* tabs separate words\nI1\t0\tn1\t1\nR1\tn1\t0\t2\n.op\n.end\n", vectors: { "v(n1)": 2 } },
  { code: 'S34', id: 'syn-crlf', title: "Windows line ends (CR LF) are fine", netlist: "* Windows line ends\r\nI1 0 n1 1\r\nR1 n1 0 2\r\n.op\r\n.end\r\n", vectors: { "v(n1)": 2 } },
  { code: 'S35', id: 'syn-cr-midline', title: "A carriage return inside a line is deleted, joining its two halves", netlist: "* a carriage return inside a line\nI1 0 n1 1\nR1 n1 0 2\r5\n.op\n.end\n", vectors: { "v(n1)": 25 } },
  { code: 'S36', id: 'syn-formfeed-first', title: "A form feed at the start of a line also makes a comment, with the warning", netlist: "* a form feed at the start of a line\nI1 0 n1 1\nR1 n1 0 2\n\fR9 n1 0 1\n.op\n.end\n", vectors: { "v(n1)": 2 }, prints: ["Unusual leading characters"] },
  { code: 'S37', id: 'syn-continuation-after-starhash', title: "A *# command line between a line and its continuation does not break it", netlist: "* a *# line between a line and its continuation\nI1 0 n1 1\nR1 n1 0\n*# echo between\n+ 2\n.op\n.end\n", vectors: { "v(n1)": 2 }, prints: ["between"] },
  { code: 'W1', id: 'syn-comma-nodes', title: "Commas separate words anywhere on a part line, also between nodes", netlist: "* commas separate words\nV1 n1,0 6\nR1 n1 0 2\n.op\n.end\n", vectors: { "v(n1)": 6, "i(v1)": -3 } },
  { code: 'W2', id: 'syn-equals', title: "= separates a name from its value: r=2, dc=6", netlist: "* name=value\nI1 0 n1 1\nR1 n1 0 r=2\nV2 n2 0 dc=6\nR2 n2 0 1\n.op\n.end\n", vectors: { "v(n1)": 2, "v(n2)": 6 } },
  { code: 'W3', id: 'syn-parens', title: "Parentheses around source functions are optional; DC and AC in any case", netlist: "* source functions with and without parentheses\nV1 n1 0 PULSE(2 5 0 1u 1u 1 2)\nV2 n2 0 PULSE (2 5 0 1u 1u 1 2)\nV3 n3 0 pulse 2 5 0 1u 1u 1 2\nV4 n4 0 dc 3 ac 1\nV5 n5 0 DC 4 AC 1 0\nR1 n1 0 1\n.op\n.end\n", vectors: { "v(n1)": 2, "v(n2)": 2, "v(n3)": 2, "v(n4)": 3, "v(n5)": 4 } },
  { code: 'W4', id: 'syn-nbsp', title: "A no-break space is not a space: it glues two words together", netlist: "* a no-break space is not a space\nI1 0 n1 1\nR1 n1 0\u00a02\n.op\n.end\n", vectors: { "v(n1)": 1 }, prints: ["is not a valid resistor instance line, ignored!"] },
  { code: 'W5', id: 'syn-paren-node', title: "A node name can contain (: a(1) is the node a(1", netlist: "* a node name with parentheses\nI1 0 a(1) 1\nR1 a(1) 0 2\n.op\n.end\n", vectors: { "v(a(1)": 2 } },
  { code: 'W6', id: 'syn-node-case', title: "Node names ignore capital letters: N1 and n1 are one node", netlist: "* node names ignore capital letters\nV1 N1 0 6\nR1 n1 0 2\n.op\n.end\n", vectors: { "v(n1)": 6, "i(v1)": -3 } },
  { code: 'W7', id: 'syn-name-case', title: "Part names ignore capital letters: R1 and r1 are the same part", netlist: "* part names ignore capital letters\nV1 n1 0 6\nR1 n1 0 2\nr1 n1 0 4\n.op\n.end\n", prints: ["device already exists"], fails: true },
  { code: 'W8', id: 'syn-gnd', title: "0 and gnd in any case are ground", netlist: "* ground names\nV1 a gnd 6\nR1 a GND 2\nV2 b Gnd 3\nR2 b 0 3\n.op\n.end\n", vectors: { "v(a)": 6, "v(b)": 3, "i(v1)": -3, "i(v2)": -1 } },
  { code: 'W9', id: 'syn-gnd-last-word', title: "Except gnd as the last word of a line: then it is an ordinary node called gnd", netlist: "* gnd as the last word of a line\nV1 a 0 6\nR1 a b 2\nVx b gnd\n.op\n.end\n", vectors: { "v(b)": 6, "v(gnd)": 6, "i(vx)": 0 } },
  { code: 'W10', id: 'syn-gnd-trailing-space', title: "Spaces after it do not help", netlist: "* gnd as the last word, followed by spaces\nV1 a 0 6\nR1 a b 2\nVx b gnd   \n.op\n.end\n", vectors: { "v(b)": 6, "v(gnd)": 6, "i(vx)": 0 } },
  { code: 'W11', id: 'syn-gnd-comment-after', title: "Nor does an end-of-line comment after it", netlist: "* gnd as the last word, followed by a comment\nV1 a 0 6\nR1 a b 2\nVx b gnd ; ammeter\n.op\n.end\n", vectors: { "v(b)": 6, "v(gnd)": 6, "i(vx)": 0 } },
  { code: 'W12', id: 'syn-gnd-continued', title: "A continuation line after it does: then gnd is ground", netlist: "* gnd at the end of a line that is continued\nV1 a 0 6\nR1 a b 2\nVx b gnd\n+ 0\n.op\n.end\n", vectors: { "v(b)": 0, "i(vx)": 3 } },
  { code: 'W13', id: 'syn-ground-word', title: "ground is an ordinary node name", netlist: "* ground is an ordinary name\nV1 a ground 6\nR1 a ground 2\n.op\n.end\n", vectors: { "v(a)": 9.00033307426206, "v(ground)": 3.0003330742710626 }, prints: ["singular matrix:  check node ground"], unreliable: true },
  { code: 'W14', id: 'syn-double-zero', title: "00 is an ordinary node name", netlist: "* 00 is an ordinary name\nV1 a 00 6\nR1 a 00 2\n.op\n.end\n", vectors: { "v(a)": 9.00033307426206, "v(00)": 3.0003330742710626 }, prints: ["singular matrix:  check node 00"], unreliable: true },
  { code: 'W15', id: 'syn-micro-first', title: "A micro sign as the first character makes a U line", netlist: "* a micro sign as the first letter\nRref a 0 1\n\u00b51 a 0 5\n.op\n.end\n", prints: ["Unable to find definition of model"], fails: true },
  { code: 'V1', id: 'syn-lead-wins', title: "On a source line a plain number beats dc, and the last dc beats an earlier one", netlist: "* a plain number and dc on one source line\nV1 n1 0 5 dc 6\nV2 n2 0 dc 6 dc 7\n.op\n.end\n", vectors: { "v(n1)": 5, "v(n2)": 7 } },
  { code: 'V2', id: 'syn-two-numbers', title: "On a resistor line a second number replaces the first", netlist: "* two numbers on a resistor line\nI1 0 n1 1\nR1 n1 0 1 2\n.op\n.end\n", vectors: { "v(n1)": 2 } },
  { code: 'V3', id: 'syn-keyword-values', title: "The value can be given by name: resistance=5, r=2, c=3 on a current source", netlist: "* the value given by name\nI1 0 n1 1\nR1 n1 0 resistance=5\nI2 0 n2 1\nR2 n2 0 1 r=2\nI3 0 n3 c=3\nR3 n3 0 1\n.op\n.end\n", vectors: { "v(n1)": 5, "v(n2)": 2, "v(n3)": 3 } },
  { code: 'L1', id: 'elem-o-line', title: "An O line (lossy transmission line) runs in native ngspice but not in our engine", netlist: "* an O line (lossy line)\nV1 a 0 1\nRs a b 1\nO1 b 0 c 0 lmod\nRl c 0 1\n.model lmod ltra r=1 l=1n g=0 c=1p len=1\n.op\n.end\n", prints: ["Device type LossyXmissionLine not supported by this binary"], fails: true },
];

/** First letters (numbers-and-syntax.md, section 5): [letter, v(a) when accepted, ngspice's message otherwise]. */
const LETTERS: [string, number | null, string | null][] = [
  ['A', null, "unknown device type - error"],
  ['B', null, "ERROR: mal formed B source instance: b1 a 0 5"],
  ['C', 0, null],
  ['D', null, "could not find a valid modelname"],
  ['E', null, "Error: Transient op failed, timestep too small"],
  ['F', null, "Fatal error: f1: unknown controlling source 5"],
  ['G', null, "Error: Transient op failed, timestep too small"],
  ['H', null, "Fatal error: h1: unknown controlling source 5"],
  ['I', -5, null],
  ['J', null, "Unable to find definition of model"],
  ['K', null, "Fatal error: k1: coupling to non-existent inductor a."],
  ['L', 0, null],
  ['M', null, "could not find a valid modelname"],
  ['N', null, "unknown device type - error"],
  ['O', null, "Device type LossyXmissionLine not supported by this binary"],
  ['P', null, "Unable to find definition of model 5"],
  ['Q', null, "could not find a valid modelname"],
  ['R', 0, null],
  ['S', null, "Unable to find definition of model"],
  ['T', null, "Fatal error: t1: transmission line z0 must be given"],
  ['U', null, "Unable to find definition of model"],
  ['V', 5, null],
  ['W', null, "Unable to find definition of model"],
  ['X', null, "Error: unknown subckt: x1 a 0 5"],
  ['Y', null, "model name is not found"],
  ['Z', null, "Unable to find definition of model"],
];

const letterNetlist = (letter: string): string => `* first letter ${letter}\nRref a 0 1\n${letter}1 a 0 5\n.op\n.end\n`;

const root = resolve(import.meta.dirname, '../..');
const runs = new Map<string, RunResult>();

beforeAll(async () => {
  const engine = await NgspiceEngine.create(createNgspice, readFileSync(join(root, 'engine/dist/ngspice.wasm')));
  for (const f of FACTS) runs.set(f.id, await engine.run(f.netlist));
  for (const [letter] of LETTERS) runs.set(`letter-${letter}`, await engine.run(letterNetlist(letter)));
});

const vector = (r: RunResult, name: string): number[] | undefined => {
  for (const p of r.plots) {
    const i = p.variables.findIndex((v) => v.name === name);
    if (i >= 0) return Array.from(p.real[i]!);
  }
  return undefined;
};
const v = (r: RunResult, name: string): number => {
  const values = vector(r, name);
  if (!values) throw new Error(`no vector ${name}`);
  return values[0]!;
};
const el = (n: Netlist, key: string): Element => {
  const e = n.lines.find((l) => l.element?.key === key)?.element;
  if (!e) throw new Error(`no part ${key}`);
  return e;
};
const val = (n: Netlist, key: string): number | undefined => el(n, key).value?.number?.value;
const keys = (n: Netlist): string[] => n.elements.map((i) => n.lines[i]!.element!.key);
const kinds = (n: Netlist): string[] => n.lines.map((l) => l.kind);
const words = (e: Element): string[] => e.fields.map((f) => `${f.role}:${f.token.text}`);
const nodeNames = (e: Element): string[] => e.nodes.map((r) => r.name);

/** Each "Vk nk 0 <value>" sets nk to exactly the number ngspice read: the parser must read the same. */
const sameAsSources = (n: Netlist, r: RunResult): void => {
  for (const i of n.elements) {
    const e = n.lines[i]!.element!;
    const node = e.nodes[0]?.name;
    if (e.letter === 'V' && node) expect(val(n, e.key), e.key).toBe(v(r, `v(${node})`));
  }
};
const resistorIsVoltage = (pairs: [string, string][]) => (n: Netlist, r: RunResult): void => {
  // 1 A into each resistor: its node voltage is its resistance.
  for (const [part, node] of pairs) expect(val(n, part), part).toBe(v(r, node));
};
const r1 = resistorIsVoltage([['r1', 'v(n1)']]);

const PARSER: Record<string, (n: Netlist, r: RunResult) => void> = {
  N1: (n, r) => expect(val(n, 'i1')).toBe(v(r, 'v(n1)')),
  N2: sameAsSources,
  N3: sameAsSources,
  N4: sameAsSources,
  N5: sameAsSources,
  N6: sameAsSources,
  N7: sameAsSources,
  N8: (n) => expect(words(el(n, 'v1'))).toEqual(['name:V1', 'plus:n1', 'minus:0', 'value:1d', 'other:-3']),
  N9: r1,
  N10: r1,
  N11: sameAsSources,
  N12: (n) => expect(words(el(n, 'v1'))).toEqual(['name:V1', 'plus:n1', 'minus:0', 'value:1', 'other:k']),
  N13: r1,
  N14: (n) => expect(words(el(n, 'v1'))).toEqual(['name:V1', 'plus:n1', 'minus:0', 'value:1', 'other:5']),
  N15: (n, r) => {
    for (const k of [1, 2, 3, 4, 6, 7]) expect(val(n, `v${k}`)).toBe(v(r, `v(n${k})`));
    // The one known difference: musl's pow(10, 126) in our engine is one unit in the last place
    // above glibc's, which native ngspice uses; the parser gives the native value.
    expect(val(n, 'v5')).toBe(1e126);
    expect(v(r, 'v(n5)')).toBe(1.0000000000000001e126);
  },
  N16: sameAsSources,
  N18: sameAsSources,
  N17: (n) => {
    expect(el(n, 'r1').value).toEqual({ token: expect.objectContaining({ text: '{1k*2}' }) });
    expect(el(n, 'r2').value).toEqual({ token: expect.objectContaining({ text: "'2*3'" }) });
  },
  S1: (n) => {
    expect(n.lines[0]!.kind).toBe('title');
    expect(keys(n)).toEqual(['r1']);
  },
  S2: (n) => {
    expect(n.lines[0]!.kind).toBe('title');
    expect(keys(n)).toEqual(['v1', 'r1']);
  },
  S3: (n) => {
    expect(n.lines[0]!.kind).toBe('title');
    expect(n.analyses).toEqual([]);
  },
  S4: (n) => {
    expect(n.lines[0]!.kind).toBe('invalid');
    expect(keys(n)).toEqual([]);
  },
  S5: (n) => {
    expect(n.lines[1]!.kind).toBe('continuation');
    expect(n.lines[1]!.continues).toBeUndefined();
    expect(keys(n)).toEqual(['r1', 'r2']);
  },
  S6: (n, r) => {
    expect(n.lines[2]!.kind).toBe('comment');
    r1(n, r);
  },
  S7: (n) => expect(words(el(n, 'r1')).slice(4)).toEqual(['other:*', 'other:5']),
  S8: (n, r) => {
    expect(n.lines[3]!.kind).toBe('comment');
    r1(n, r);
  },
  S9: (n) => expect(words(el(n, 'r1')).slice(4)).toEqual(['other:#', 'other:5']),
  S10: (n) => expect(kinds(n).slice(3, 6)).toEqual(['comment', 'comment', 'comment']),
  S11: (n) => expect(n.lines[3]!.kind).toBe('comment'),
  S12: resistorIsVoltage([['r1', 'v(n1)'], ['r2', 'v(n2)']]),
  S13: resistorIsVoltage([['r1', 'v(n1)'], ['r2', 'v(n2)'], ['r3', 'v(n3)'], ['r4', 'v(n4)']]),
  S14: resistorIsVoltage([['r1', 'v(n1)'], ['r2', 'v(n2)']]),
  S15: (n) => expect(words(el(n, 'r1')).slice(4)).toEqual(['other:/', 'other:5']),
  S16: (n) => expect(n.lines[3]!.kind).toBe('control'),
  S17: (n) => expect(n.lines[3]!.kind).toBe('control'),
  S18: (n, r) => {
    expect(n.lines[3]).toMatchObject({ kind: 'continuation', continues: 2 });
    r1(n, r);
  },
  S19: resistorIsVoltage([['r1', 'v(n1)'], ['r2', 'v(n2)'], ['r3', 'v(n3)'], ['r4', 'v(n4)']]),
  S20: (n, r) => {
    expect(n.lines[5]).toMatchObject({ kind: 'continuation', continues: 4 });
    expect(el(n, 'r1').value).toBeUndefined();
    expect(val(n, 'r0')).toBe(v(r, 'v(n1)'));
  },
  S21: (n, r) => {
    expect(n.lines[5]).toMatchObject({ kind: 'continuation', continues: 4 });
    expect(el(n, 'r1').value).toBeUndefined();
    expect(val(n, 'r0')).toBe(v(r, 'v(n1)'));
  },
  S22: (n, r) => {
    expect(n.lines[1]!.kind).toBe('continuation');
    expect(n.lines[1]!.continues).toBeUndefined();
    expect(keys(n)).toEqual(['i1', 'r2']);
    expect(val(n, 'r2')).toBe(v(r, 'v(n1)'));
  },
  S23: (n, r) => {
    expect(n.lines[3]!.directive!.args.map((t) => t.text)).toEqual(['V1', '0', '2', '1']);
    expect(vector(r, 'v(v-sweep)')).toEqual([0, 1, 2]);
  },
  S24: r1,
  // ngspice reads parts after .end; PlainSpice marks them after-end instead (the trap checks flag them).
  S25: (n, r) => {
    expect([n.end, n.lines[5]!.kind, keys(n)]).toEqual([4, 'after-end', ['i1', 'r1']]);
    expect(v(r, 'v(n1)')).toBe(1);
  },
  S26: (n, r) => {
    expect([n.end, n.lines[5]!.kind, keys(n)]).toEqual([4, 'after-end', ['i1', 'r1']]);
    expect(v(r, 'v(n1)')).toBe(1);
  },
  S27: (n, r) => {
    expect([n.end, n.lines[5]!.kind]).toEqual([4, 'after-end']);
    expect(val(n, 'r1')).toBe(v(r, 'v(n1)'));
  },
  S28: (n, r) => {
    expect([n.end, n.lines[5]!.kind]).toEqual([4, 'after-end']);
    expect([val(n, 'r1'), v(r, 'v(n1)')]).toEqual([2, 3]);
  },
  S29: (n, r) => {
    expect(kinds(n).slice(4, 7)).toEqual(['invalid', 'after-end', 'after-end']);
    expect(n.end).toBeUndefined();
    r1(n, r);
  },
  S30: (n, r) => {
    expect(kinds(n).slice(4, 7)).toEqual(['invalid', 'after-end', 'after-end']);
    r1(n, r);
  },
  S31: (n) => {
    expect(kinds(n)).toEqual(['title', 'element', 'element', 'directive', 'control', 'control', 'control', 'directive', 'blank']);
    expect(keys(n)).toEqual(['i1', 'r1']);
  },
  S32: r1,
  S33: r1,
  S34: r1,
  S35: (n, r) => {
    expect(el(n, 'r1').value!.token.text).toBe('2\r5');
    r1(n, r);
  },
  S36: (n, r) => {
    expect(n.lines[3]!.kind).toBe('comment');
    r1(n, r);
  },
  S37: (n, r) => {
    expect(n.lines[3]!.kind).toBe('control');
    expect(n.lines[4]).toMatchObject({ kind: 'continuation', continues: 2 });
    r1(n, r);
  },
  W1: (n) => expect(nodeNames(el(n, 'v1'))).toEqual(['n1', '0']),
  W2: (n, r) => {
    r1(n, r);
    expect(val(n, 'v2')).toBe(v(r, 'v(n2)'));
  },
  W3: (n, r) => {
    for (const k of [1, 2, 3]) {
      const f = el(n, `v${k}`).sourceFunction!;
      expect([f.name, f.args.length]).toEqual(['pulse', 7]);
      expect(Number(f.args[0]!.text)).toBe(v(r, `v(n${k})`));
    }
    expect(val(n, 'v4')).toBe(v(r, 'v(n4)'));
    expect(val(n, 'v5')).toBe(v(r, 'v(n5)'));
  },
  W4: (n) => {
    expect(nodeNames(el(n, 'r1'))).toEqual(['n1', '0\u00a02']);
    expect(el(n, 'r1').value).toBeUndefined();
  },
  W5: (n) => expect(nodeNames(el(n, 'r1'))).toEqual(['a(1', '0']),
  W6: (n) => expect(n.nodes.get('n1')!.connections.map((c) => c.element)).toEqual(['v1', 'r1']),
  W7: (n) => expect(keys(n)).toEqual(['v1', 'r1', 'r1']),
  W8: (n) => expect(n.nodes.get('0')!.refs.map((t) => t.text)).toEqual(['gnd', 'GND', 'Gnd', '0']),
  W9: (n) => expect([nodeNames(el(n, 'vx')), n.nodes.get('gnd')!.ground]).toEqual([['b', 'gnd'], false]),
  W10: (n) => expect([nodeNames(el(n, 'vx')), n.nodes.get('gnd')!.ground]).toEqual([['b', 'gnd'], false]),
  W11: (n) => expect([nodeNames(el(n, 'vx')), n.nodes.get('gnd')!.ground]).toEqual([['b', 'gnd'], false]),
  W12: (n) => expect(el(n, 'vx').nodes[1]).toMatchObject({ name: '0', ground: true }),
  W13: (n) => expect([nodeNames(el(n, 'v1')), n.nodes.has('0')]).toEqual([['a', 'ground'], false]),
  W14: (n) => expect([nodeNames(el(n, 'v1')), n.nodes.has('0')]).toEqual([['a', '00'], false]),
  W15: (n) => expect([el(n, 'u1').letter, el(n, 'u1').name.text]).toEqual(['U', '\u00b51']),
  V1: (n, r) => expect([val(n, 'v1'), val(n, 'v2')]).toEqual([v(r, 'v(n1)'), v(r, 'v(n2)')]),
  V2: r1,
  V3: (n, r) => {
    resistorIsVoltage([['r1', 'v(n1)'], ['r2', 'v(n2)']])(n, r);
    // 3 A into 1 Ω: v(n3) is the current source's value.
    expect(val(n, 'i3')).toBe(v(r, 'v(n3)'));
  },
  L1: (n) => expect(words(el(n, 'o1'))).toEqual(['name:O1', 'node:b', 'node:0', 'node:c', 'node:0', 'model:lmod']),
};

describe.each(FACTS)('$code: $title', (fact) => {
  it('our engine gives what native ngspice 47 gave', () => {
    const r = runs.get(fact.id)!;
    expect(r.ok).toBe(!fact.fails);
    expect(r.unreliable).toBe(fact.unreliable === true);
    for (const [name, want] of Object.entries(fact.vectors ?? {})) {
      expect(vector(r, name), name).toEqual(Array.isArray(want) ? want : [want]);
    }
    for (const text of fact.prints ?? []) expect(`${r.stdout}\n${r.stderr}`).toContain(text);
  });

  it('the parser reads the netlist the way the engine did', () => {
    const check = PARSER[fact.code];
    expect(check, `no parser check for ${fact.code}`).toBeDefined();
    check!(parseNetlist(fact.netlist), runs.get(fact.id)!);
  });
});

describe('5. First letters: our engine, and the element catalog', () => {
  it.each(LETTERS)('%s1 a 0 5', (letter, va, message) => {
    const r = runs.get(`letter-${letter}`)!;
    if (va !== null) {
      expect(r.ok).toBe(true);
      expect(vector(r, 'v(a)')).toEqual([va]);
    } else {
      expect(r.ok).toBe(false);
      expect(`${r.stdout}\n${r.stderr}`).toContain(message);
    }
    const info = elementInfo(letter)!;
    expect(info.inEngine).toBe(!/unknown device type|not supported by this binary/.test(message ?? ''));
    if (/modelname|definition of model|model name is not found/.test(message ?? '')) expect(info.needs).toMatch(/\.model/);
    expect(info.explained).toBe(va !== null || 'EFGH'.includes(letter));
    expect(parseNetlist(letterNetlist(letter)).lines[2]!.element?.letter).toBe(letter);
  });
});
