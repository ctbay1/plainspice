# Numbers and syntax: what ngspice reads

What PlainSpice's number reader (`src/spice/numbers.ts`), netlist parser (`src/spice/parse.ts`) and
element catalog (`src/spice/elements.ts`) rely on. Every claim below has its netlist and what native
ngspice 47, native ngspice 42 and our WebAssembly engine printed for it. Nothing here is from memory.

**How it was checked (9 November 2026).** Each netlist was saved as a file and run three ways:

- native ngspice 47, built from the release tarball (the version our engine is compiled from), as
  `ngspice -b file.cir` (the printout) and `ngspice -b -r out.raw file.cir` (every vector at full
  precision, from the binary rawfile);
- native ngspice 42 (Ubuntu's `ngspice 42+ds-3build1` package), the same two ways;
- our engine, which runs exactly `ngspice -b -r /out.raw /circuit.cir` in WebAssembly
  (`src/engine/ngspice.ts`).

The excerpts are verbatim, with three cuts: the model and device listing and the resource report at the
end of a printout are left out, file paths are shortened to the file name, and an invisible carriage
return, no-break space or form feed is shown as `<CR>`, `<NBSP>` or `<FF>`. The printout rounds to 7
significant digits (6 for negative numbers); the rawfile values are the exact doubles. Plain
`ngspice -b` runs no `.dc` or `.tran` without a `.print` line; with `-r`, as our engine runs it,
everything runs.

**The tests.** `tests/golden/facts-numbers.test.ts` runs every netlist here through our engine on every
`npm run test:golden`. It checks the vectors bit for bit, the messages and whether the run fails, and it
checks that the parser reads the same netlist the way the engine did (for example, that the value the
parser gives `R1 n1 0 1,5k` is the 5000 Ω the engine used). The unit tests
`tests/unit/spice-numbers.test.ts` and `tests/unit/spice-parse.test.ts` cover the same rules without the
engine; the number test also reproduces the 48 value spellings of the research run (each put on a
current source, a resistor and a capacitor, in ngspice 42 and 47).

## Summary

**Numbers** (section 1)

- A value is one word. A word ends at a space, tab, `,`, `=`, `(`, `)`, `*`, `/`, `^`, and at a `+` or
  `-` that follows a digit or a letter, except right after an exponent `e` (N8, N10, N12, N13).
- Inside the word: digits, an optional point and more digits, an optional exponent (`e` or `d`), then at
  most one scale letter. Everything after that is ignored (N3, N4, N6, N7, N11).
- Scale letters, in any case: T G K U N P F A, `M` is milli, `MEG` is mega, `MIL` is a thousandth of an
  inch (N1, N2, N3). The micro sign `µ` counts as `u`; the Greek letter `μ` does not (N5), and
  letters are compared byte by byte, so the Kelvin sign `K` is not `k` (N18).
- Units are ignored, which bites when a unit starts with a scale letter: `1MOhm` is a milliohm, `3A` is
  3 attoamperes, `1F` is a femtofarad (N4).
- On a resistor line a second number replaces the first, silently: `1,5k` is 5 kΩ, `1d-3` is −3 Ω,
  `1k-2` is −2 Ω (N9, N10, N13, V2). On a source line the same slips stop ngspice with
  "unknown parameter" (N8, N12, N14).
- ngspice computes digits × 10ⁿ in double precision, so `0.3` is 0.30000000000000004 (N15).

**Lines** (section 2)

- Line 1 is the title whatever it says, so a part written there disappears (S1–S3). Only a first line
  starting with `@` is different: then nothing at all is read (S4).
- Comment lines start with `*`, `#` (ngspice 47), `;`, or one of `= [ ] ? ( ) & % $ " ! : ,` or a form
  feed (which draw one warning) (S6, S8, S10, S11, S36). End-of-line comments start at `;` anywhere, at `$` after a space, tab
  or comma, and at `//` (S12–S14). A `*`, `#` or single `/` in the middle of a line is an error (S7, S9,
  S15). Lines starting with `*#` or `##` are commands, not comments (S16, S17).
- A `+` line continues the last line before it that is not a comment or a `*#` command (S18, S19,
  S23, S37), and so does the line after one that ends in two backslashes (S24). A `;` or odd-character comment line in between
  takes the continuation, and the part loses it (S20, S21). A `+` line right after the title is ignored
  (S22).
- `.end` (any case) does not stop ngspice reading a file: parts after it count (S25, S26, S28), unless a
  comment is glued to it (S27). A line starting with `@` does stop it, silently (S29, S30).
- Lines between `.control` and `.endc` are commands (S31). Leading spaces and tabs, tabs between words
  and Windows line ends do not matter; a carriage return inside a line is deleted (S32–S35).

**Words and names** (section 3)

- Commas and `=` separate words (W1, W2); parentheses around source functions are optional (W3); a
  no-break space does not separate words (W4); a node name can contain `(` (W5).
- Node and part names ignore capital letters (W6, W7). A micro sign as the first character makes a U
  line, because ngspice reads it as `u` (W15).
- `0` and `gnd` in any case are ground, except `gnd` as the last word of a line, which is an ordinary node
  (W8–W12). `ground` and `00` are ordinary nodes (W13, W14).

**Which number counts** (section 4): on a source line a plain number beats `dc`, and the last `dc` beats
an earlier one (V1); on a resistor line the second number counts (V2). A value can also be given by name:
`resistance=`, `r=`, and `c=` on a current source (V3).

**First letters** (section 5): what each first letter means, which ones need a `.model` line or a
`.subckt`, and which are not in our engine (A, N, O).

## 1. Numbers

How ngspice reads a value. PlainSpice mirrors this in `src/spice/numbers.ts` (`readNumber`), and the unit test `tests/unit/spice-numbers.test.ts` reproduces all 48 spellings of the research run. Each netlist below puts the spelling on voltage sources (V1 n1 0 <value>), because a voltage source sets its node to exactly that value, so v(n1) is the number ngspice read.

### N1. `1M` is one milli-unit: on a current source it is 1 mA

SPICE ignores capital letters, so `M` is the same as `m`: milli. `I1 0 n1 1M` pushes 0.001 A into a 1 Ω resistor, so v(n1) = 1 mV. Mega is written `meg`. ngspice says nothing.

```spice
* 1M on a current source
I1 0 n1 1M
R1 n1 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               1.000000e-03
  rawfile from ngspice -b -r (exit 0): v(n1) = 0.001
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 0.001
```

### N2. `M` and `m` are milli; `MEG`, `Meg` and `meg` are mega

The scale letters are read without regard to case.

```spice
* M is milli in any case; MEG is mega
V1 n1 0 1M
V2 n2 0 1m
V3 n3 0 1meg
V4 n4 0 1MEG
V5 n5 0 1Meg
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n5                               1.000000e+06
        n4                               1.000000e+06
        n3                               1.000000e+06
        n2                               1.000000e-03
        n1                               1.000000e-03
        v1#branch                        0.000000e+00
        v2#branch                        0.000000e+00
        v3#branch                        0.000000e+00
        v4#branch                        0.000000e+00
        v5#branch                        0.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 0.001, v(n2) = 0.001, v(n3) = 1000000, v(n4) = 1000000, v(n5) = 1000000
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 0.001, v(n2) = 0.001, v(n3) = 1000000, v(n4) = 1000000, v(n5) = 1000000
```

### N3. The scale letters: T G K U N P F A, M (milli), MEG, MIL, in either case

tera 1e12, giga 1e9, kilo 1e3, micro 1e-6, nano 1e-9, pico 1e-12, femto 1e-15, atto 1e-18, mil 25.4e-6 (a thousandth of an inch). Upper case reads the same as lower case, so `F` is femto and `A` is atto.

```spice
* every scale letter
V1 n1 0 1t
V2 n2 0 1g
V3 n3 0 1k
V4 n4 0 1u
V5 n5 0 1n
V6 n6 0 1p
V7 n7 0 1f
V8 n8 0 1a
V9 n9 0 1mil
V10 n10 0 1T
V11 n11 0 1G
V12 n12 0 1K
V13 n13 0 1U
V14 n14 0 1N
V15 n15 0 1P
V16 n16 0 1F
V17 n17 0 1A
V18 n18 0 1MIL
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n18                              2.540000e-05
        n17                              1.000000e-18
        n16                              1.000000e-15
        n15                              1.000000e-12
        n14                              1.000000e-09
        n13                              1.000000e-06
        n12                              1.000000e+03
        n11                              1.000000e+09
        n10                              1.000000e+12
        n9                               2.540000e-05
        n8                               1.000000e-18
        n7                               1.000000e-15
        n6                               1.000000e-12
        n5                               1.000000e-09
        n4                               1.000000e-06
        n3                               1.000000e+03
        n2                               1.000000e+09
        n1                               1.000000e+12
        v1#branch                        0.000000e+00
        v2#branch                        0.000000e+00
        v3#branch                        0.000000e+00
        v4#branch                        0.000000e+00
        v5#branch                        0.000000e+00
        v6#branch                        0.000000e+00
        v7#branch                        0.000000e+00
        v8#branch                        0.000000e+00
        v9#branch                        0.000000e+00
        v10#branch                       0.000000e+00
        v11#branch                       0.000000e+00
        v12#branch                       0.000000e+00
        v13#branch                       0.000000e+00
        v14#branch                       0.000000e+00
        v15#branch                       0.000000e+00
        v16#branch                       0.000000e+00
        v17#branch                       0.000000e+00
        v18#branch                       0.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 1000000000000, v(n2) = 1000000000, v(n3) = 1000, v(n4) = 0.000001, v(n5) = 1e-9, v(n6) = 1e-12, v(n7) = 1e-15, v(n8) = 1e-18, v(n9) = 0.000025399999999999997, v(n10) = 1000000000000, v(n11) = 1000000000, v(n12) = 1000, v(n13) = 0.000001, v(n14) = 1e-9, v(n15) = 1e-12, v(n16) = 1e-15, v(n17) = 1e-18, v(n18) = 0.000025399999999999997
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 1000000000000, v(n2) = 1000000000, v(n3) = 1000, v(n4) = 0.000001, v(n5) = 1e-9, v(n6) = 1e-12, v(n7) = 1e-15, v(n8) = 1e-18, v(n9) = 0.000025399999999999997, v(n10) = 1000000000000, v(n11) = 1000000000, v(n12) = 1000, v(n13) = 0.000001, v(n14) = 1e-9, v(n15) = 1e-12, v(n16) = 1e-15, v(n17) = 1e-18, v(n18) = 0.000025399999999999997
```

### N4. Letters after the number and its scale letter are ignored

So a unit after the number does nothing (`10V` is 10), and a unit that starts with a scale letter changes the value: `10kOhm` is 10 k, `1MOhm` is 1 m (milli), `3A` is 3 × 10⁻¹⁸ (atto), `1megohm` is a million and `1milli` is one mil (25.4 × 10⁻⁶). No message.

```spice
* letters after the number and its scale letter are ignored
V1 n1 0 10kOhm
V2 n2 0 1MOhm
V3 n3 0 10V
V4 n4 0 3A
V5 n5 0 100mV
V6 n6 0 1x
V7 n7 0 1megohm
V8 n8 0 1milli
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n8                               2.540000e-05
        n7                               1.000000e+06
        n6                               1.000000e+00
        n5                               1.000000e-01
        n4                               3.000000e-18
        n3                               1.000000e+01
        n2                               1.000000e-03
        n1                               1.000000e+04
        v1#branch                        0.000000e+00
        v2#branch                        0.000000e+00
        v3#branch                        0.000000e+00
        v4#branch                        0.000000e+00
        v5#branch                        0.000000e+00
        v6#branch                        0.000000e+00
        v7#branch                        0.000000e+00
        v8#branch                        0.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 10000, v(n2) = 0.001, v(n3) = 10, v(n4) = 3.0000000000000002e-18, v(n5) = 0.1, v(n6) = 1, v(n7) = 1000000, v(n8) = 0.000025399999999999997
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 10000, v(n2) = 0.001, v(n3) = 10, v(n4) = 3.0000000000000002e-18, v(n5) = 0.1, v(n6) = 1, v(n7) = 1000000, v(n8) = 0.000025399999999999997
```

### N5. The micro sign `µ` works like `u`; the Greek letter `μ` is ignored

ngspice turns the micro sign (U+00B5) into `u` before reading the line. The Greek small letter mu (U+03BC) looks the same but is a different character: ngspice ignores it, so `1μ` is 1.

```spice
* the micro sign and the Greek letter mu
V1 n1 0 1µ
V2 n2 0 1μ
V3 n3 0 4.7µF
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n3                               4.700000e-06
        n2                               1.000000e+00
        n1                               1.000000e-06
        v1#branch                        0.000000e+00
        v2#branch                        0.000000e+00
        v3#branch                        0.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 0.000001, v(n2) = 1, v(n3) = 0.0000047
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 0.000001, v(n2) = 1, v(n3) = 0.0000047
```

### N6. Digits after the scale letter are ignored: `2k2` is 2 k, not 2.2 k

Resistor colour-code spellings such as `2k2` and `4k7` lose their last digit. (ngspice reads them as 2.2 k only in its LTspice compatibility mode, which PlainSpice does not use.)

```spice
* digits after the scale letter are ignored
V1 n1 0 2k2
V2 n2 0 4k7
V3 n3 0 1meg5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n3                               1.000000e+06
        n2                               4.000000e+03
        n1                               2.000000e+03
        v1#branch                        0.000000e+00
        v2#branch                        0.000000e+00
        v3#branch                        0.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2000, v(n2) = 4000, v(n3) = 1000000
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2000, v(n2) = 4000, v(n3) = 1000000
```

### N7. Exponents: `e` or `d`, either case; an exponent and a scale letter both apply

`1e3`, `1E3` and `1d3` are 1000, `1e-3` is 0.001, `1e3k` is a million, `2.5e+2` is 250.

```spice
* exponents with e or d
V1 n1 0 1e3
V2 n2 0 1E3
V3 n3 0 1d3
V4 n4 0 1e-3
V5 n5 0 1e3k
V6 n6 0 2.5e+2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n6                               2.500000e+02
        n5                               1.000000e+06
        n4                               1.000000e-03
        n3                               1.000000e+03
        n2                               1.000000e+03
        n1                               1.000000e+03
        v1#branch                        0.000000e+00
        v2#branch                        0.000000e+00
        v3#branch                        0.000000e+00
        v4#branch                        0.000000e+00
        v5#branch                        0.000000e+00
        v6#branch                        0.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 1000, v(n2) = 1000, v(n3) = 1000, v(n4) = 0.001, v(n5) = 1000000, v(n6) = 250
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 1000, v(n2) = 1000, v(n3) = 1000, v(n4) = 0.001, v(n5) = 1000000, v(n6) = 250
```

### N8. A minus sign after `d` starts a new word: on a source line `1d-3` is an error

ngspice splits a line into words before it reads numbers, and its word splitter only accepts a sign right after an `e`. So `1d-3` is the two words `1d` and `-3`. A source line has no parameter called `-3`, so ngspice stops.

```spice
* d with a minus sign on a source line
V1 n1 0 1d-3
R1 n1 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 n1 0 1d-3
      unknown parameter (-3) 
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 n1 0 1d-3
      unknown parameter (-3) 
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
our engine (wasm), as ngspice -b -r (exit 1):
    Error on line 2 or its substitute:
      v1 n1 0 1d-3
      unknown parameter (-3) 
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none: nothing ran)
```

### N9. On a resistor line that second word replaces the value: `R1 n1 0 1d-3` is −3 Ω

A resistor line takes a second plain number as its value (see V2), so `1d-3` gives R1 = −3 Ω, silently: 1 A into R1 gives v(n1) = −3 V.

```spice
* d with a minus sign on a resistor line
I1 0 n1 1
R1 n1 0 1d-3
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               -3.00000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = -3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = -3
```

### N10. A minus sign after a scale letter also starts a new word: `R1 n1 0 1k-2` is −2 Ω

The same word rule: a `+` or `-` after a digit or a letter (other than an exponent `e`) ends the word.

```spice
* a value with a minus sign glued on
I1 0 n1 1
R1 n1 0 1k-2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               -2.00000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = -2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = -2
```

### N11. The number stops at the first character it cannot use

`1_000` is 1, `1.5.2` is 1.5, `1:5` is 1; `1.`, `.5`, `-2` and `+3` are read as written. No message.

```spice
* the number stops at the first character it cannot use
V1 n1 0 1_000
V2 n2 0 1.5.2
V3 n3 0 1.
V4 n4 0 .5
V5 n5 0 -2
V6 n6 0 +3
V7 n7 0 1:5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n7                               1.000000e+00
        n6                               3.000000e+00
        n5                               -2.00000e+00
        n4                               5.000000e-01
        n3                               1.000000e+00
        n2                               1.500000e+00
        n1                               1.000000e+00
        v1#branch                        0.000000e+00
        v2#branch                        0.000000e+00
        v3#branch                        0.000000e+00
        v4#branch                        0.000000e+00
        v5#branch                        0.000000e+00
        v6#branch                        0.000000e+00
        v7#branch                        0.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 1, v(n2) = 1.5, v(n3) = 1, v(n4) = 0.5, v(n5) = -2, v(n6) = 3, v(n7) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 1, v(n2) = 1.5, v(n3) = 1, v(n4) = 0.5, v(n5) = -2, v(n6) = 3, v(n7) = 1
```

### N12. A space between the number and its letter makes two words: `1 k` stops ngspice

Values are one word: `V1 n1 0 1 k` gives the source a value of 1 and then a parameter `k`, which does not exist.

```spice
* a space between the number and its scale letter
V1 n1 0 1 k
R1 n1 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 n1 0 1 k
      unknown parameter (k) 
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 n1 0 1 k
      unknown parameter (k) 
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
our engine (wasm), as ngspice -b -r (exit 1):
    Error on line 2 or its substitute:
      v1 n1 0 1 k
      unknown parameter (k) 
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none: nothing ran)
```

### N13. A decimal comma on a resistor line gives the second number: `1,5k` is 5 kΩ

The comma separates words, so `1,5k` is the two numbers 1 and 5k, and a resistor takes the second one. 1 A into R1 gives v(n1) = 5000 V. No message.

```spice
* a decimal comma in a resistor value
I1 0 n1 1
R1 n1 0 1,5k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               5.000000e+03
  rawfile from ngspice -b -r (exit 0): v(n1) = 5000
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 5000
```

### N14. On a source line `1,5` stops ngspice: unknown parameter (5)

A source line takes one plain number; the second word `5` would have to be a parameter name.

```spice
* a decimal comma in a source value
V1 n1 0 1,5
R1 n1 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 n1 0 1,5
      unknown parameter (5) 
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 n1 0 1,5
      unknown parameter (5) 
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
our engine (wasm), as ngspice -b -r (exit 1):
    Error on line 2 or its substitute:
      v1 n1 0 1,5
      unknown parameter (5) 
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none: nothing ran)
```

### N15. ngspice computes digits × a power of ten, so `0.3` is 0.30000000000000004

It collects all the digits as one whole number and multiplies by a power of ten from C's `pow`: `0.3` is 3 × 0.1, `3.3` is 33 × 0.1. Native ngspice 47 and 42 give identical doubles; our engine (musl's `pow` instead of glibc's) agrees except for `1e126`, one unit in the last place higher. `readNumber` gives the native values.

```spice
* how ngspice computes a value: digits times a power of ten
V1 n1 0 0.3
V2 n2 0 1e-4
V3 n3 0 2.2k
V4 n4 0 1e23
V5 n5 0 1e126
V6 n6 0 1.1
V7 n7 0 3.3
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n7                               3.300000e+00
        n6                               1.100000e+00
        n5                              1.000000e+126
        n4                               1.000000e+23
        n3                               2.200000e+03
        n2                               1.000000e-04
        n1                               3.000000e-01
        v1#branch                        0.000000e+00
        v2#branch                        0.000000e+00
        v3#branch                        0.000000e+00
        v4#branch                        0.000000e+00
        v5#branch                        0.000000e+00
        v6#branch                        0.000000e+00
        v7#branch                        0.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 0.30000000000000004, v(n2) = 0.0001, v(n3) = 2200, v(n4) = 1.0000000000000001e+23, v(n5) = 1e+126, v(n6) = 1.1, v(n7) = 3.3000000000000003
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 0.30000000000000004, v(n2) = 0.0001, v(n3) = 2200, v(n4) = 1.0000000000000001e+23, v(n5) = 1.0000000000000001e+126, v(n6) = 1.1, v(n7) = 3.3000000000000003
```

### N16. Huge numbers follow C: the exponent wraps around at 2³², 1e400 is infinity

The exponent is a 32-bit integer, so `1e4294967296` is 1 and `1e4294967297` is 10. A 30-digit number keeps about 16 digits. `1e400` overflows to infinity, `1e-400` underflows to 0.

```spice
* very long numbers and exponents
V1 n1 0 1e4294967296
V2 n2 0 1e4294967297
V3 n3 0 123456789012345678901234567890
V4 n4 0 1e400
V5 n5 0 1e-400
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n5                               0.000000e+00
        n4                                        inf
        n3                               1.234568e+29
        n2                               1.000000e+01
        n1                               1.000000e+00
        v1#branch                        0.000000e+00
        v2#branch                        0.000000e+00
        v3#branch                        0.000000e+00
        v4#branch                        0.000000e+00
        v5#branch                        0.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 1, v(n2) = 10, v(n3) = 1.2345678901234566e+29, v(n4) = Infinity, v(n5) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 1, v(n2) = 10, v(n3) = 1.2345678901234566e+29, v(n4) = Infinity, v(n5) = 0
```

### N17. Expressions in braces or single quotes are evaluated by ngspice

`{1k*2}` is 2000 and `'2*3'` is 6.000000000000002 (ngspice's expression code rounds differently). PlainSpice does not evaluate expressions: the parser keeps them as one word with no number.

```spice
* expressions in braces or quotes
I1 0 n1 1
R1 n1 0 {1k*2}
I2 0 n2 1
R2 n2 0 '2*3'
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n2                               6.000000e+00
        n1                               2.000000e+03
  rawfile from ngspice -b -r (exit 0): v(n1) = 2000, v(n2) = 6.000000000000002
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2000, v(n2) = 6.000000000000002
```

### N18. Letters are compared byte by byte: the Kelvin sign `K` is not `k`

The Kelvin sign (U+212A) looks like a capital K, but it is a different character, so ngspice ignores it: `1K` with it is 1, not 1000.

```spice
* the Kelvin sign is not k
V1 n1 0 1K
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               1.000000e+00
        v1#branch                        0.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 1
```

## 2. Lines: the title, comments, continuations, .end

How ngspice decides what each line is. PlainSpice mirrors this in `src/spice/parse.ts` (`NetlistLine.kind`).

### S1. Line 1 is always the title: a part written there disappears

Here V1 is the title, so there is no source: v(n1) = 0 and ngspice says nothing.

```spice
V1 n1 0 6
R1 n1 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               0.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 0
```

### S2. A blank first line is the title too

When ngspice reads a file, as our engine does, an empty first line is the title and the circuit after it is complete.

```spice

V1 n1 0 6
R1 n1 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               6.000000e+00
        v1#branch                        -3.00000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 6, i(v1) = -3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 6, i(v1) = -3
```

### S3. A dot command on line 1 is also just the title

Here `.op` is the title, so there is no analysis and nothing runs.

```spice
.op
V1 n1 0 6
R1 n1 0 2
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  rawfile from ngspice -b -r (exit 0): (no rawfile data)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 0): (no rawfile data)
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: (none: nothing ran)
```

### S4. Exception: a first line starting with `@` ends the netlist before the title

ngspice stops reading at a line starting with `@` (see S29), even on line 1, so it has no circuit at all. (Native ngspice 47 even crashes when asked for a rawfile here.)

```spice
@ title
V1 n1 0 6
R1 n1 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  rawfile from ngspice -b -r (exit signal SIGSEGV): (no rawfile data)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
our engine (wasm), as ngspice -b -r (exit 1):
    Error: there aren't any circuits loaded.
  vectors: (none: nothing ran)
```

### S5. A title ending in two backslashes swallows line 2

Two backslashes at the end of a line continue it on the next line (S24). The title cannot be continued, so line 2 (`I1 0 n1 1`) is dropped silently and v(n1) = 0.

```spice
title ending in two backslashes \\
I1 0 n1 1
R1 n1 0 2
R2 n1 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               0.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 0
```

### S6. A star at the start of a line makes a comment

`* R9 n1 0 1` is ignored: v(n1) = 2 V from R1 alone.

```spice
* a star at the start of a line makes a comment
I1 0 n1 1
* R9 n1 0 1
R1 n1 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2
```

### S7. A star in the middle of a line is not a comment

`R1 n1 0 2 * 5` stops ngspice: `*` is read as a parameter name.

```spice
* a star in the middle of a line is not a comment
I1 0 n1 1
R1 n1 0 2 * 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      r1 n1 0 2 * 5
      unknown parameter (*) 
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
ngspice 42, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      r1 n1 0 2 * 5
      unknown parameter (*) 
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
our engine (wasm), as ngspice -b -r (exit 1):
    Error on line 3 or its substitute:
      r1 n1 0 2 * 5
      unknown parameter (*) 
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none: nothing ran)
```

### S8. A hash at the start of a line is a comment in ngspice 47 (an error in 42)

ngspice 47 turns a leading `#` into `*`. ngspice 42 does not, and stops with "unknown device type".

```spice
* a hash at the start of a line
I1 0 n1 1
R1 n1 0 2
# R9 n1 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      # r9 n1 0 1
     unknown device type - error 
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2
```

### S9. A hash in the middle of a line is not a comment

Only `;`, `$` and `//` start an end-of-line comment.

```spice
* a hash in the middle of a line
I1 0 n1 1
R1 n1 0 2 # 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '#' from line
        r1 n1 0 2 # 5
    Error on line 3 or its substitute:
      r1 n1 0 2 # 5
      unknown parameter (#) 
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '#' from line
        r1 n1 0 2 # 5
    Error on line 3 or its substitute:
      r1 n1 0 2 # 5
      unknown parameter (#) 
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
our engine (wasm), as ngspice -b -r (exit 1):
    warning, can't find model '#' from line
        r1 n1 0 2 # 5
    Error on line 3 or its substitute:
      r1 n1 0 2 # 5
      unknown parameter (#) 
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none: nothing ran)
```

### S10. A line starting with = [ ] ? ( ) & % $ " ! : , becomes a comment, with one warning

ngspice warns once for the whole netlist and treats every such line as a comment.

```spice
* odd first characters turn a line into a comment
I1 0 n1 1
R1 n1 0 2
$ R9 n1 0 1
! R8 n1 0 1
% R7 n1 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
    Warning: Unusual leading characters like '$' or others out of '= [] ? () & % $"!:,\f'
        in netlist or included files, will be replaced with '*'.
        check line  $ r9 n1 0 1
        line no. 4 from file syn-unusual-first.cir!
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42, ngspice -b (exit 0):
        n1                               2.000000e+00
    Warning: Unusual leading characters like '$' or others out of '= [] ? () & % $"!:,\f'
        in netlist or included files, will be replaced with '*'.
        Check line no 4:  $ r9 n1 0 1
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
our engine (wasm), as ngspice -b -r (exit 0):
    Warning: Unusual leading characters like '$' or others out of '= [] ? () & % $"!:,\f'
        in netlist or included files, will be replaced with '*'.
        check line  $ r9 n1 0 1
        line no. 4 from file circuit.cir!
  vectors: v(n1) = 2
```

### S11. A semicolon at the start of a line makes a comment, silently

```spice
* a semicolon at the start of a line
I1 0 n1 1
R1 n1 0 2
; R9 n1 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2
```

### S12. A semicolon anywhere starts an end-of-line comment

`R1 n1 0 2;5` and `R2 n2 0 3 ; 5` are 2 Ω and 3 Ω: the 5s are comments.

```spice
* end-of-line comments with ;
I1 0 n1 1
R1 n1 0 2;5
I2 0 n2 1
R2 n2 0 3 ; 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n2                               3.000000e+00
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2, v(n2) = 3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2, v(n2) = 3
```

### S13. A dollar sign starts an end-of-line comment only after a space, tab or comma

`2 $ 5`, `3 $5` and `6,$ 5` lose the 5. In `4$ 5` the `$` is glued to the 4, so it is part of the word `4$` (read as 4) and the 5 is a second number, which a resistor takes (5 Ω).

```spice
* end-of-line comments with $
I1 0 n1 1
R1 n1 0 2 $ 5
I2 0 n2 1
R2 n2 0 3 $5
I3 0 n3 1
R3 n3 0 4$ 5
I4 0 n4 1
R4 n4 0 6,$ 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n4                               6.000000e+00
        n3                               5.000000e+00
        n2                               3.000000e+00
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2, v(n2) = 3, v(n3) = 5, v(n4) = 6
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2, v(n2) = 3, v(n3) = 5, v(n4) = 6
```

### S14. Two slashes start an end-of-line comment, with or without a space

```spice
* end-of-line comments with //
I1 0 n1 1
R1 n1 0 2 // 5
I2 0 n2 1
R2 n2 0 3//5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n2                               3.000000e+00
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2, v(n2) = 3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2, v(n2) = 3
```

### S15. One slash does not

```spice
* one slash is not a comment
I1 0 n1 1
R1 n1 0 2 / 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '/' from line
        r1 n1 0 2 / 5
    Error on line 3 or its substitute:
      r1 n1 0 2 / 5
      unknown parameter (/) 
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '/' from line
        r1 n1 0 2 / 5
    Error on line 3 or its substitute:
      r1 n1 0 2 / 5
      unknown parameter (/) 
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
our engine (wasm), as ngspice -b -r (exit 1):
    warning, can't find model '/' from line
        r1 n1 0 2 / 5
    Error on line 3 or its substitute:
      r1 n1 0 2 / 5
      unknown parameter (/) 
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none: nothing ran)
```

### S16. A line starting with `*#` is a command, not a comment

ngspice runs `*#` lines as commands even outside `.control`, here `echo`. PlainSpice marks them as control lines.

```spice
* a line starting with *# is a command
I1 0 n1 1
R1 n1 0 2
*# echo starhash-command-ran
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    starhash-command-ran
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    starhash-command-ran
  vectors: v(n1) = 2
```

### S17. So is `##` in ngspice 47 (an error in 42)

ngspice 47 turns the first `#` into `*`, which makes `*#`.

```spice
* a line starting with ## becomes a *# command
I1 0 n1 1
R1 n1 0 2
## echo hashhash-command-ran
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    hashhash-command-ran
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      ## echo hashhash-command-ran
     unknown device type - error 
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
our engine (wasm), as ngspice -b -r (exit 0):
    hashhash-command-ran
  vectors: v(n1) = 2
```

### S18. A line starting with `+` continues the line before

```spice
* a + line continues the line before it
I1 0 n1 1
R1 n1 0
+ 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2
```

### S19. Comment lines (`*`, `#`, `$`, `//`) and blank lines may sit in between

Each `+` line joins the last line before it that is not a comment: R1 to R4 get 2, 3, 4 and 5 Ω. The comment lines in between are dropped while joining, so even the `$` line draws no warning here.

```spice
* comment and blank lines between a line and its continuation
I1 0 n1 1
R1 n1 0
* a star comment

+ 2
I2 0 n2 1
R2 n2 0
# a hash comment
+ 3
I3 0 n3 1
R3 n3 0
$ a dollar comment
+ 4
I4 0 n4 1
R4 n4 0
// a slash comment
+ 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n4                               5.000000e+00
        n3                               4.000000e+00
        n2                               3.000000e+00
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2, v(n2) = 3, v(n3) = 4, v(n4) = 5
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2, v(n2) = 3, v(n3) = 4, v(n4) = 5
```

### S20. A `;` comment line in between takes the continuation, and the part is dropped

ngspice joins continuation lines before it turns `;` lines into comments, so `+ 2` is joined to the `;` line and lost with it. R1 has no value and is dropped with a warning; only R0 (1 kΩ) is left.

```spice
* a ; comment line between a line and its continuation
I1 0 n1 1
R0 n1 0 1k
R1 n1 0
; a semicolon comment
+ 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               1.000000e+03
    Warning: 'r1 n1 0' is not a valid resistor instance line, ignored!
  rawfile from ngspice -b -r (exit 0): v(n1) = 1000
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    Warning: 'r1 n1 0' is not a valid resistor instance line, ignored!
  vectors: v(n1) = 1000
```

### S21. So does a line starting with one of the odd characters

The warning shows the joined line: `! an odd comment  2`.

```spice
* a ! line between a line and its continuation
I1 0 n1 1
R0 n1 0 1k
R1 n1 0
! an odd comment
+ 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               1.000000e+03
    Warning: Unusual leading characters like '!' or others out of '= [] ? () & % $"!:,\f'
        in netlist or included files, will be replaced with '*'.
        check line  ! an odd comment  2
        line no. 5 from file syn-continuation-odd-line.cir!
    Warning: 'r1 n1 0' is not a valid resistor instance line, ignored!
  rawfile from ngspice -b -r (exit 0): v(n1) = 1000
ngspice 42, ngspice -b (exit 0):
        n1                               1.000000e+03
    Warning: Unusual leading characters like '!' or others out of '= [] ? () & % $"!:,\f'
        in netlist or included files, will be replaced with '*'.
        Check line no 5:  ! an odd comment  2
    Warning: 'r1 n1 0' is not a valid resistor instance line, ignored!
  rawfile from ngspice -b -r (exit 0): v(n1) = 1000
our engine (wasm), as ngspice -b -r (exit 0):
    Warning: Unusual leading characters like '!' or others out of '= [] ? () & % $"!:,\f'
        in netlist or included files, will be replaced with '*'.
        check line  ! an odd comment  2
        line no. 5 from file circuit.cir!
    Warning: 'r1 n1 0' is not a valid resistor instance line, ignored!
  vectors: v(n1) = 1000
```

### S22. A `+` line right after the title has nothing to continue: it is ignored silently

The `+ R1 n1 0 2` line is dropped without a message: v(n1) = 4 V from R2 alone.

```spice
* a + line right after the title
+ R1 n1 0 2
I1 0 n1 1
R2 n1 0 4
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               4.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 4
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 4
```

### S23. Dot commands can be continued too

`.dc V1 0 2` + `+ 1` sweeps 0, 1, 2. (Plain `ngspice -b` runs no `.dc` without a `.print` line; with `-r`, as our engine runs it, it does.)

```spice
* a continued dot command
V1 in 0 1
R1 in 0 1
.dc V1 0 2
+ 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  rawfile from ngspice -b -r (exit 0): v(v-sweep) = [0, 1, 2]
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 0): v(v-sweep) = [0, 1, 2]
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(v-sweep) = [0, 1, 2]
```

### S24. Two backslashes at the end of a line continue it on the next line

```spice
* two backslashes at the end of a line
I1 0 n1 1
R1 n1 0 \\
2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2
```

### S25. ngspice keeps reading after `.end`: a part after `.end` is in the circuit

R2 after `.end` is read: 2 Ω ∥ 2 Ω = 1 Ω, so v(n1) = 1 V. PlainSpice marks such lines `after-end` and does not parse them as parts; the trap checks flag them.

```spice
* lines after .end
I1 0 n1 1
R1 n1 0 2
.op
.end
R2 n1 0 2
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 1
```

### S26. `.END` works like `.end`

```spice
* .END in capitals
I1 0 n1 1
R1 n1 0 2
.op
.END
R2 n1 0 2
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 1
```

### S27. But `.end` with a comment glued on (`.end;...`) makes ngspice stop there

The plain `.end` check needs a space or the end of the line after `.end`; `.end;the end` is only recognised later, when ngspice stops at it. R2 is not read: v(n1) = 2 V.

```spice
* .end with a comment glued to it
I1 0 n1 1
R1 n1 0 2
.op
.end;the end
R2 n1 0 2
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2
```

### S28. A `+` line after `.end` continues the last part before `.end`

`+ 3` joins R1, which then has two numbers and takes the second: v(n1) = 3 V.

```spice
* a + line after .end
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3
```

### S29. A line starting with `@` silently ends the netlist

R2 after it is not read: v(n1) = 2 V. No message.

```spice
* a line starting with @
I1 0 n1 1
R1 n1 0 2
.op
@ anything
R2 n1 0 2
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2
```

### S30. ... also when it is indented

```spice
* an indented line starting with @
I1 0 n1 1
R1 n1 0 2
.op
   @ anything
R2 n1 0 2
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2
```

### S31. Lines between `.control` and `.endc` are commands, not parts

`R2 n1 0 2` inside `.control` is run as a command, which does not exist; the circuit has only R1.

```spice
* lines inside .control are commands, not parts
I1 0 n1 1
R1 n1 0 2
.op
.control
R2 n1 0 2
.endc
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
    r2: no such command available in ngspice
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    r2: no such command available in ngspice
  vectors: v(n1) = 2
```

### S32. Leading spaces and tabs do not matter

An indented part, an indented `+` line and an indented `*` comment all work.

```spice
* leading spaces and tabs
I1 0 n1 1
   R1 n1 0
	+ 2
   * R9 n1 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2
```

### S33. Tabs separate words like spaces

```spice
* tabs separate words
I1	0	n1	1
R1	n1	0	2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2
```

### S34. Windows line ends (CR LF) are fine

```spice
* Windows line ends<CR>
I1 0 n1 1<CR>
R1 n1 0 2<CR>
.op<CR>
.end<CR>
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2
```

### S35. A carriage return inside a line is deleted, joining its two halves

`R1 n1 0 2<CR>5` is read as `R1 n1 0 25`: v(n1) = 25 V.

```spice
* a carriage return inside a line
I1 0 n1 1
R1 n1 0 2<CR>5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.500000e+01
  rawfile from ngspice -b -r (exit 0): v(n1) = 25
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 25
```

### S36. A form feed at the start of a line also makes a comment, with the warning

A form feed is invisible; in the warning it stands between the quotes (shown here as `<FF>`).

```spice
* a form feed at the start of a line
I1 0 n1 1
R1 n1 0 2
<FF>R9 n1 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
    Warning: Unusual leading characters like '<FF>' or others out of '= [] ? () & % $"!:,\f'
        in netlist or included files, will be replaced with '*'.
        check line  <FF>r9 n1 0 1
        line no. 4 from file syn-formfeed-first.cir!
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42, ngspice -b (exit 0):
        n1                               2.000000e+00
    Warning: Unusual leading characters like '<FF>' or others out of '= [] ? () & % $"!:,\f'
        in netlist or included files, will be replaced with '*'.
        Check line no 4:  <FF>r9 n1 0 1
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
our engine (wasm), as ngspice -b -r (exit 0):
    Warning: Unusual leading characters like '<FF>' or others out of '= [] ? () & % $"!:,\f'
        in netlist or included files, will be replaced with '*'.
        check line  <FF>r9 n1 0 1
        line no. 4 from file circuit.cir!
  vectors: v(n1) = 2
```

### S37. A `*#` command line between a line and its continuation does not break it

ngspice skips every line starting with `*` while joining continuation lines, commands included: R1 gets its 2 Ω, and the command still runs.

```spice
* a *# line between a line and its continuation
I1 0 n1 1
R1 n1 0
*# echo between
+ 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2
```

## 3. Words, names and ground

How ngspice splits a part line into words and names its nodes. PlainSpice mirrors this in `src/spice/parse.ts` (tokens, `Element.nodes`, `Netlist.nodes`).

### W1. Commas separate words anywhere on a part line, also between nodes

`V1 n1,0 6` is `V1 n1 0 6`.

```spice
* commas separate words
V1 n1,0 6
R1 n1 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               6.000000e+00
        v1#branch                        -3.00000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 6, i(v1) = -3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 6, i(v1) = -3
```

### W2. `=` separates a name from its value: `r=2`, `dc=6`

```spice
* name=value
I1 0 n1 1
R1 n1 0 r=2
V2 n2 0 dc=6
R2 n2 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n2                               6.000000e+00
        n1                               2.000000e+00
        v2#branch                        -6.00000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2, v(n2) = 6
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2, v(n2) = 6
```

### W3. Parentheses around source functions are optional; `DC` and `AC` in any case

`PULSE(2 5 ...)`, `PULSE (2 5 ...)` and `pulse 2 5 ...` are the same source: in `.op` it sits at its starting value, 2 V. `dc 3 ac 1` and `DC 4 AC 1 0` give 3 V and 4 V.

```spice
* source functions with and without parentheses
V1 n1 0 PULSE(2 5 0 1u 1u 1 2)
V2 n2 0 PULSE (2 5 0 1u 1u 1 2)
V3 n3 0 pulse 2 5 0 1u 1u 1 2
V4 n4 0 dc 3 ac 1
V5 n5 0 DC 4 AC 1 0
R1 n1 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n5                               4.000000e+00
        n4                               3.000000e+00
        n3                               2.000000e+00
        n2                               2.000000e+00
        n1                               2.000000e+00
        v1#branch                        -2.00000e+00
        v2#branch                        0.000000e+00
        v3#branch                        0.000000e+00
        v4#branch                        0.000000e+00
        v5#branch                        0.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2, v(n2) = 2, v(n3) = 2, v(n4) = 3, v(n5) = 4
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2, v(n2) = 2, v(n3) = 2, v(n4) = 3, v(n5) = 4
```

### W4. A no-break space is not a space: it glues two words together

`R1 n1 0<NBSP>2` has the nodes `n1` and `0<NBSP>2` and no value, so it is dropped. A no-break space can come in when a netlist is copied from a web page or a PDF.

```spice
* a no-break space is not a space
I1 0 n1 1
R1 n1 0<NBSP>2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               1.000000e+00
    Warning: 'r1 n1 0__2' is not a valid resistor instance line, ignored!
  rawfile from ngspice -b -r (exit 0): v(n1) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    Warning: 'r1 n1 0__2' is not a valid resistor instance line, ignored!
  vectors: v(n1) = 1
```

### W5. A node name can contain `(`: `a(1)` is the node `a(1`

ngspice ends a node name at a space, tab, `,`, `=` or `)`, but not at `(`.

```spice
* a node name with parentheses
I1 0 a(1) 1
R1 a(1) 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a(1                              2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(a(1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a(1) = 2
```

### W6. Node names ignore capital letters: `N1` and `n1` are one node

```spice
* node names ignore capital letters
V1 N1 0 6
R1 n1 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               6.000000e+00
        v1#branch                        -3.00000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 6, i(v1) = -3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 6, i(v1) = -3
```

### W7. Part names ignore capital letters: `R1` and `r1` are the same part

So ngspice stops: two parts may not share a name.

```spice
* part names ignore capital letters
V1 n1 0 6
R1 n1 0 2
r1 n1 0 4
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      r1 n1 0 4
    device already exists, bail out
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      r1 n1 0 4
    device already exists, bail out
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
our engine (wasm), as ngspice -b -r (exit 1):
    Error on line 4 or its substitute:
      r1 n1 0 4
    device already exists, bail out
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none: nothing ran)
```

### W8. `0` and `gnd` in any case are ground

`gnd`, `GND` and `Gnd` all join node 0.

```spice
* ground names
V1 a gnd 6
R1 a GND 2
V2 b Gnd 3
R2 b 0 3
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                3.000000e+00
        a                                6.000000e+00
        v1#branch                        -3.00000e+00
        v2#branch                        -1.00000e+00
  rawfile from ngspice -b -r (exit 0): v(a) = 6, v(b) = 3, i(v2) = -1, i(v1) = -3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 6, v(b) = 3, i(v2) = -1, i(v1) = -3
```

### W9. Except `gnd` as the last word of a line: then it is an ordinary node called `gnd`

ngspice replaces `gnd` by `0` only when a space, `)` or `,` follows it. In `Vx b gnd` (a 0 V ammeter to ground) nothing follows, so Vx ends in a separate node `gnd`, no current flows (i(vx) = 0) and b sits at 6 V instead of 0 V. No message.

```spice
* gnd as the last word of a line
V1 a 0 6
R1 a b 2
Vx b gnd
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        gnd                              6.000000e+00
        b                                6.000000e+00
        a                                6.000000e+00
        v1#branch                        0.000000e+00
        vx#branch                        0.000000e+00
    Note: vx: has no value, DC 0 assumed
  rawfile from ngspice -b -r (exit 0): v(b) = 6, v(gnd) = 6, i(vx) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    Note: vx: has no value, DC 0 assumed
  vectors: v(b) = 6, v(gnd) = 6, i(vx) = 0
```

### W10. Spaces after it do not help

ngspice removes spaces at the end of a line first.

```spice
* gnd as the last word, followed by spaces
V1 a 0 6
R1 a b 2
Vx b gnd   
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        gnd                              6.000000e+00
        b                                6.000000e+00
        a                                6.000000e+00
        v1#branch                        0.000000e+00
        vx#branch                        0.000000e+00
    Note: vx: has no value, DC 0 assumed
  rawfile from ngspice -b -r (exit 0): v(b) = 6, v(gnd) = 6, i(vx) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    Note: vx: has no value, DC 0 assumed
  vectors: v(b) = 6, v(gnd) = 6, i(vx) = 0
```

### W11. Nor does an end-of-line comment after it

The comment is removed first, then the spaces.

```spice
* gnd as the last word, followed by a comment
V1 a 0 6
R1 a b 2
Vx b gnd ; ammeter
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        gnd                              6.000000e+00
        b                                6.000000e+00
        a                                6.000000e+00
        v1#branch                        0.000000e+00
        vx#branch                        0.000000e+00
    Note: vx: has no value, DC 0 assumed
  rawfile from ngspice -b -r (exit 0): v(b) = 6, v(gnd) = 6, i(vx) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    Note: vx: has no value, DC 0 assumed
  vectors: v(b) = 6, v(gnd) = 6, i(vx) = 0
```

### W12. A continuation line after it does: then `gnd` is ground

`Vx b gnd` + `+ 0` is `Vx b gnd 0`: now a space follows `gnd`.

```spice
* gnd at the end of a line that is continued
V1 a 0 6
R1 a b 2
Vx b gnd
+ 0
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                0.000000e+00
        a                                6.000000e+00
        v1#branch                        -3.00000e+00
        vx#branch                        3.000000e+00
  rawfile from ngspice -b -r (exit 0): v(b) = 0, i(vx) = 3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(b) = 0, i(vx) = 3
```

### W13. `ground` is an ordinary node name

With no node 0 the voltages cannot be pinned down: ngspice warns about a singular matrix and prints numbers that cannot be trusted (only their difference, 6 V, is right).

```spice
* ground is an ordinary name
V1 a ground 6
R1 a ground 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        ground                           3.000333e+00
        a                                9.000333e+00
        v1#branch                        -3.00000e+00
    Warning: singular matrix:  check node ground
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node ground
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: singular matrix:  check node ground
    Warning: singular matrix:  check node ground
    Warning: singular matrix:  check node ground
    Warning: singular matrix:  check node ground
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  rawfile from ngspice -b -r (exit 0): v(a) = 9.00033307426206, v(ground) = 3.0003330742710626
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    Warning: singular matrix:  check node ground
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node ground
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: singular matrix:  check node ground
    Warning: singular matrix:  check node ground
    Warning: singular matrix:  check node ground
    Warning: singular matrix:  check node ground
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  vectors: v(a) = 9.00033307426206, v(ground) = 3.0003330742710626
```

### W14. `00` is an ordinary node name

The same as W13.

```spice
* 00 is an ordinary name
V1 a 00 6
R1 a 00 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        V(00)                            3.000333e+00
        a                                9.000333e+00
        v1#branch                        -3.00000e+00
    Warning: singular matrix:  check node 00
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node 00
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: singular matrix:  check node 00
    Warning: singular matrix:  check node 00
    Warning: singular matrix:  check node 00
    Warning: singular matrix:  check node 00
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  rawfile from ngspice -b -r (exit 0): v(a) = 9.00033307426206, v(00) = 3.0003330742710626
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    Warning: singular matrix:  check node 00
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node 00
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: singular matrix:  check node 00
    Warning: singular matrix:  check node 00
    Warning: singular matrix:  check node 00
    Warning: singular matrix:  check node 00
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  vectors: v(a) = 9.00033307426206, v(00) = 3.0003330742710626
```

### W15. A micro sign as the first character makes a U line

ngspice turns `µ` into `u` before it reads the line, so `µ1 a 0 5` is the part `u1`, a uniform RC line, which needs a model.

```spice
* a micro sign as the first letter
Rref a 0 1
µ1 a 0 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      u1 a 0 5
    Unable to find definition of model 
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
ngspice 42, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      u1 a 0 5
    Unable to find definition of model 
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile data)
our engine (wasm), as ngspice -b -r (exit 1):
    Error on line 3 or its substitute:
      u1 a 0 5
    Unable to find definition of model 
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none: nothing ran)
```

## 4. Which number a part line uses

When a line gives more than one number, ngspice does not complain; it picks one. `Element.value` is the one it picks.

### V1. On a source line a plain number beats `dc`, and the last `dc` beats an earlier one

`V1 n1 0 5 dc 6` is 5 V; `V2 n2 0 dc 6 dc 7` is 7 V.

```spice
* a plain number and dc on one source line
V1 n1 0 5 dc 6
V2 n2 0 dc 6 dc 7
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n2                               7.000000e+00
        n1                               5.000000e+00
        v1#branch                        0.000000e+00
        v2#branch                        0.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 5, v(n2) = 7
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 5, v(n2) = 7
```

### V2. On a resistor line a second number replaces the first

`R1 n1 0 1 2` is 2 Ω. This is why `1,5k` (N13) is 5 kΩ.

```spice
* two numbers on a resistor line
I1 0 n1 1
R1 n1 0 1 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2
```

### V3. The value can be given by name: `resistance=5`, `r=2`, `c=3` on a current source

`R1 n1 0 resistance=5` is 5 Ω; in `R2 n2 0 1 r=2` the 2 replaces the 1; `I3 0 n3 c=3` is 3 A (on a current source `c` means its DC current).

```spice
* the value given by name
I1 0 n1 1
R1 n1 0 resistance=5
I2 0 n2 1
R2 n2 0 1 r=2
I3 0 n3 c=3
R3 n3 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n3                               3.000000e+00
        n2                               2.000000e+00
        n1                               5.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 5, v(n2) = 2, v(n3) = 3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 5, v(n2) = 2, v(n3) = 3
```

## 5. First letters

What a line starting with each letter does, from one template: `* first letter X`, `Rref a 0 1`,
`X1 a 0 5`, `.op`, `.end` (the research run used the same template for 57 first characters; section 2
covers the punctuation). The table shows the first message that explains the result, verbatim ("same":
ngspice 42 printed the same). `src/spice/elements.ts` describes each letter, and the golden test checks
its `inEngine` and `needs` against these messages from our engine.

| line | what the letter needs | ngspice 47 | ngspice 42 | our engine |
|---|---|---|---|---|
| `A1 a 0 5` | not in our engine: XSPICE is left out | `MIF-ERROR - unable to find definition of model 5` | same | `unknown device type - error` |
| `B1 a 0 5` | needs V= or I=; a malformed B line is fatal | `ERROR: mal formed B source instance: b1 a 0 5` | `ERROR: mal formed B line: b1 a 0 5` | `ERROR: mal formed B source instance: b1 a 0 5` |
| `C1 a 0 5` | accepted with a bare value | accepted, v(a) = 0 | same | accepted, v(a) = 0 |
| `D1 a 0 5` | needs a .model line | `could not find a valid modelname` | same | `could not find a valid modelname` |
| `E1 a 0 5` | needs 4 nodes and a gain | `Error: not enough parameters in line` | same | `Error: Transient op failed, timestep too small` (singular matrix, no results) |
| `F1 a 0 5` | needs 2 nodes, a voltage source and a gain | `Error: not enough parameters in line` | same | `Fatal error: f1: unknown controlling source 5` |
| `G1 a 0 5` | needs 4 nodes and a gain | `Error: not enough parameters in line` | same | `Error: Transient op failed, timestep too small` (singular matrix, no results) |
| `H1 a 0 5` | needs 2 nodes, a voltage source and a gain | `Error: not enough parameters in line` | same | `Fatal error: h1: unknown controlling source 5` |
| `I1 a 0 5` | accepted with a bare value | accepted, v(a) = -5 | same | accepted, v(a) = -5 |
| `J1 a 0 5` | needs a .model line | `Unable to find definition of model` | same | `Unable to find definition of model` |
| `K1 a 0 5` | couples two inductors | `Fatal error: k1: coupling to non-existent inductor a.` | same | `Fatal error: k1: coupling to non-existent inductor a.` |
| `L1 a 0 5` | accepted with a bare value | accepted, v(a) = 0 | same | accepted, v(a) = 0 |
| `M1 a 0 5` | needs a .model line | `could not find a valid modelname` | same | `could not find a valid modelname` |
| `N1 a 0 5` | not in our engine: OSDI is left out | `Unable to find definition of model 5` | `could not find a valid modelname` | `unknown device type - error` |
| `O1 a 0 5` | not in our engine: the LTRA model is left out | `Unable to find definition of model` | same | `Device type LossyXmissionLine not supported by this binary` |
| `P1 a 0 5` | needs a .model line | `Unable to find definition of model 5` | same | `Unable to find definition of model 5` |
| `Q1 a 0 5` | needs a .model line | `could not find a valid modelname` | same | `could not find a valid modelname` |
| `R1 a 0 5` | accepted with a bare value | accepted, v(a) = 0 | same | accepted, v(a) = 0 |
| `S1 a 0 5` | needs a .model line | `Unable to find definition of model` | same | `Unable to find definition of model` |
| `T1 a 0 5` | needs z0= and td= | `Fatal error: t1: transmission line z0 must be given` | same | `Fatal error: t1: transmission line z0 must be given` |
| `U1 a 0 5` | needs a .model line | `Unable to find definition of model` | same | `Unable to find definition of model` |
| `V1 a 0 5` | accepted with a bare value | accepted, v(a) = 5 | same | accepted, v(a) = 5 |
| `W1 a 0 5` | needs a .model line | `Unable to find definition of model` | same | `Unable to find definition of model` |
| `X1 a 0 5` | needs a .subckt | `Error: unknown subckt: x1 a 0 5` | same | `Error: unknown subckt: x1 a 0 5` |
| `Y1 a 0 5` | needs a .model line | `model name is not found` | same | `model name is not found` |
| `Z1 a 0 5` | needs a .model line | `Unable to find definition of model` | same | `Unable to find definition of model` |

- C, I, L, R and V take a bare value. In `.op` a capacitor is an open circuit and an inductor is a short,
  so with only the 1 Ω resistor v(a) = 0; `I1 a 0 5` pulls 5 A out of a, so v(a) = −5 V; `V1 a 0 5`
  holds a at 5 V.
- E, F, G and H need more fields. Native ngspice says so ("not enough parameters in line"), but that
  check is only compiled with XSPICE (`inp_poly_2g6_compat` in `src/frontend/inpcom.c`), which our engine
  leaves out. So our engine reads `E1 a 0 5` as a source controlled by a node `5` that nothing else
  touches (singular matrix, no results), and `F1 a 0 5` as reading the current of a source called `5`
  ("unknown controlling source 5"). The trap checks catch missing fields before a run.
- A (XSPICE code models), N (Verilog-A through OSDI) and O (the LTRA lossy line) are not in our engine
  (decision 0003, `engine/README.md`): it says "unknown device type" or "not supported by this binary".
- X needs a `.subckt`. (After printing "unknown subckt", native ngspice 47 crashes when it is asked for a
  rawfile; our engine stops cleanly with "there aren't any circuits loaded".)

### L1. An `O` line (lossy transmission line) runs in native ngspice but not in our engine

With a proper `.model ... ltra`, native ngspice 47 and 42 simulate it; our engine leaves the LTRA model out (its source has no licence grant: decision 0003), so it stops with this message. No first- or second-year circuit needs it.

```spice
* an O line (lossy line)
V1 a 0 1
Rs a b 1
O1 b 0 c 0 lmod
Rl c 0 1
.model lmod ltra r=1 l=1n g=0 c=1p len=1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        o1#i2                            -3.33333e-01
        o1#i1                            3.333333e-01
        c                                3.333333e-01
        b                                6.666667e-01
        a                                1.000000e+00
        v1#branch                        -3.33333e-01
  rawfile from ngspice -b -r (exit 0): v(a) = 1, v(b) = 0.6666666666666667, v(c) = 0.3333333333333334, v(o1#i1) = 0.3333333333333333, v(o1#i2) = -0.3333333333333334, i(v1) = -0.33333333333333326
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1):
    Error on line 4 or its substitute:
      o1 b 0 c 0 lmod
    Device type LossyXmissionLine not supported by this binary
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none: nothing ran)
```

## 6. Where our engine differs from native ngspice 47

For every netlist in this file our engine gave the same vectors, bit for bit, and the same messages
(file names aside) as native ngspice 47, except:

- `1e126` reads one unit in the last place higher, because the engine's C library (musl) computes
  `pow(10, 126)` differently from glibc. A run of every exponent from −340 to 308 found no other
  (N15). `readNumber` gives the native value.
- E, F, G and H lines with too few fields: no "not enough parameters" message (section 5).
- A, N and O lines: not in the engine (section 5, L1).
- A netlist with no circuit in it (S4, and the unknown subcircuit of section 5): native ngspice 47
  crashes when asked for a rawfile; ours prints "Error: there aren't any circuits loaded." and stops.

Between native 42 and 47, the differences in this file are: `#` and `##` at the start of a line (S8,
S17: 47 only), the wording of some messages, and how a resistor below 1e-12 Ω is kept (47 raises it to
1e-12 Ω with a warning; this concerns the resistor, not the reading of the number, see the 48 spellings
in `tests/unit/spice-numbers.test.ts`).

## 7. What the parser does differently on purpose

- Lines after `.end` are marked `after-end` and are not read as parts, although ngspice reads them from a
  file (S25, S26, S28). A beginner writes them expecting them to be ignored, so the trap checks flag
  them. Blank lines and comments after `.end` keep their kind.
- Expressions in braces or single quotes stay one word with no number: PlainSpice does not evaluate them
  (N17).
- Nodes inside `.subckt ... .ends` belong to the subcircuit, so they are left out of `Netlist.nodes`.
- `readNumber` gives native ngspice's value for `1e126`, not our engine's (N15).
- The parser follows ngspice's default mode, which our engine always runs in (it prints "Note: No
  compatibility mode selected!"). A compatibility mode would change some readings: in the LTspice mode,
  set in a `.spiceinit` file, `2k2` on a resistor is 2.2 kΩ (research run of 9 November 2026).

## 8. Checking again

To re-check a claim by hand, save its netlist as a file (with a real carriage return or no-break space
where `<CR>` or `<NBSP>` is shown) and run `ngspice -b file.cir` and `ngspice -b -r out.raw file.cir`
with native ngspice 47 (built as `CLAUDE.md` describes) and 42. `npm run test:golden` re-checks our
engine on every run. When PlainSpice moves to a new ngspice version, run every netlist here with the new
native ngspice and update the excerpts where the output changed.
