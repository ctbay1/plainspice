# Beginner traps: what ngspice does with them

What PlainSpice's trap checks (`src/spice/traps.ts`, with the circuit graph in `src/spice/graph.ts`) rely
on. Each trap tells the student what went wrong, why, and what ngspice does with it, and most offer a
one-click fix. Every sentence about what ngspice does comes from a run below: the netlist, what native
ngspice 47 and native ngspice 42 printed, and what our WebAssembly engine gave. Nothing here is from
memory, and nothing claims how LTspice behaves (it cannot be run here).

**How it was checked (9 November 2026).** Each netlist was saved as a file and run three ways, as in
[numbers-and-syntax.md](numbers-and-syntax.md):

- native ngspice 47, built from the release tarball (the version our engine is compiled from), as
  `ngspice -b file.cir` (the printout) and `ngspice -b -r out.raw file.cir` (every vector at full
  precision, from the binary rawfile); plain `ngspice -b` runs no `.dc` or `.tran` without a `.print`
  line, so for those the `-r` run is the one that simulates;
- native ngspice 42 (Ubuntu's `ngspice 42+ds-3build1` package), the same two ways;
- our engine, which runs exactly `ngspice -b -r /out.raw /circuit.cir` in WebAssembly
  (`src/engine/ngspice.ts`).

The excerpts are verbatim, with these cuts: the start-up banner, the device and model listing and the
resource report are left out; the "Last Node Voltages" table ngspice prints when its DC solution fails is
replaced by a marker; a warning repeated word for word is shown once; file paths are shortened to the file
name; long vectors are shown by their length and last value; invisible characters are written `<NBSP>`,
`<CR>`, `<FF>`, and in the sections added after the final reviews `<ZWSP>` (a zero-width space), `<BOM>`
(a byte order mark), `<WJ>` (a word joiner), `<SHY>` (a soft hyphen), `<LRM>` (a left-to-right mark),
`<RLO>` (a right-to-left override) and `<ZWJ>` (a zero-width joiner), and in those added after the critic of
their fixes the characters that look like a space: `<THIN>` (a thin space), `<NNBSP>` (a narrow no-break
space), `<IDEO>` (an ideographic space), `<OGHAM>` (an ogham space mark), `<NQSP>`, `<MQSP>` (an en and an em
quad), `<ENSP>`, `<EMSP>` (an en and an em space), `<3MSP>`, `<4MSP>`, `<6MSP>` (three-, four- and
six-per-em spaces), `<FSP>` (a figure space), `<PSP>` (a punctuation space), `<HSP>` (a hair space) and
`<MMSP>` (a medium mathematical space).

**Where our engine differs from native ngspice 47.** It is built without XSPICE, OSDI and some device
models (`engine/README.md`). The trap texts say so where it shows: native 47 reads extra numbers after an
E, F, G or H value as a polynomial (XSPICE), and stops with "not enough parameters in line" where our
engine reads a missing gain as 0; A and N lines and the models left out run natively but not in our
engine. One more difference turned up and is outside the traps' claims: with a 1 ns pulse edge, the
transient time grid of our engine differs from native 47's (decimal-comma-3, space-before-suffix-8: 59 and
64 points against 83 and 77), while the final values agree to 6 significant figures or better.

**The tests.** `tests/golden/facts-traps.test.ts` runs every netlist here through our engine on every
`npm run test:golden` and asserts the claimed result (vectors, messages, whether the run fails or is marked
unreliable), checks that `checkTraps` finds exactly the traps listed for it, and runs every fix those traps
offer through the engine, which must then run cleanly. The unit tests (`tests/unit/spice-traps.test.ts`)
cover each trap on a minimal netlist, every fix, the channel's episode netlists and random input, without
the engine.

**The claim IDs** (`mega-as-milli-1`, `voltage-loop-5`, ...) are cited in brackets at the end of each
trap's `ngspice` text in `src/spice/traps.ts`, so a reader can go from a sentence the interface shows to the
run that justifies it. A unit test checks that every cited ID has its section here.

## Summary

| Trap | What it catches | Severity | What ngspice does |
|---|---|---|---|
| [mega-as-milli](#mega-as-milli) | `1M`, `4.7M`, `1MOhm` as a value | warning | reads milli, silently |
| [unit-letter](#unit-letter) | `3A` (atto), `1F` on a capacitor (femto) | warning, info | reads atto or femto, silently |
| [greek-mu](#greek-mu) | the Greek letter μ in a value | warning | ignores it; silently, except a model warning on C and L |
| [rkm-notation](#rkm-notation) | `2k2`, `4k7`, `1M5`, `4R7` | warning | ignores the digits after the letter, silently |
| [decimal-comma](#decimal-comma) | `1,5k` | error, warning | R, C, L: keeps the second number; V, I: stops |
| [sign-in-value](#sign-in-value) | `1k-2`, `1d-3` on R, C or L | warning | keeps the second number: −2 Ω, silently (C, L: a model warning) |
| [space-before-suffix](#space-before-suffix) | `1 k`, `5 V`, `1 m` | error | stops, or silently takes the word as a setting |
| [midline-comment](#midline-comment) | `R1 a b 2 * load` | error | stops |
| [nbsp](#nbsp) | a no-break space between two words, or between a value and its unit (`4.7<NBSP>kΩ`) | warning | glues two words, silently; ends the number silently |
| [missing-value](#missing-value) | `R1 a 0`, `V1 a 0`, `E1 a 0 c 0` | error, warning | R, C, L left out; V, I are 0; E-H: see text |
| [missing-fields](#missing-fields) | `R1 a`, `V1 a`, `E1 a 0 2`, `F1 0 a 5` | error, warning | R, C, L left out; others stop or misread |
| [control-source](#control-source) | `F1 0 a V9 2` with no V9, or a control with no current to read (R, L, C, I, F, G, a B line with I=) | error | stops |
| [missing-title](#missing-title) | a part or a dot command on line 1 | warning | skips it, silently |
| [no-ground](#no-ground) | no node `0` or `gnd` | error | singular matrix, numbers that are not the answer |
| [ground-misnamed](#ground-misnamed) | `ground`, `00`, a last-word `gnd`, next to a real ground | warning | an ordinary node, silently |
| [dangling-node](#dangling-node) | a node only one resistor or inductor touches | warning, info | nothing; that part carries no current |
| [floating-dc](#floating-dc) | a node only capacitors, control inputs or a gate reach | error | singular matrix; numbers that can't be trusted, or no results |
| [current-source-no-path](#current-source-no-path) | a current source into a node with no DC path | error | singular matrix, or silently as if 1 Ω |
| [voltage-loop](#voltage-loop) | voltage sources in parallel, an inductor across a source | error | V loops: stops; with L: numbers that can't be trusted |
| [duplicate-name](#duplicate-name) | two parts called R1 (or R1 and r1, or Rş and Rç) | error | stops |
| [unknown-letter](#unknown-letter) | a line starting with a digit, `@`, A, N, or a W, S, T, U, Y, Z, P, K that lacks what it needs | error | stops, or stops reading (`@`) |
| [missing-model](#missing-model) | D, Q, J, M without a .model line | error | stops |
| [missing-subcircuit](#missing-subcircuit) | X without a .subckt | error | stops |
| [model-not-in-engine](#model-not-in-engine) | BSIM, HiSIM, SOI, HICUM, JFET2 levels, and O lines (LTRA) | error | our engine stops; native 47 runs it |
| [dc-sweep-problems](#dc-sweep-problems) | `.dc` with a zero or missing step, the wrong direction, a step past the end, a source not in the circuit | error, warning | stops, hangs (42), or no points |
| [tran-problems](#tran-problems) | `.tran` with one number, a step of 0 or less, a start after the stop, a step longer than the run | error, info | stops; or runs anyway (info) |
| [tf-problems](#tf-problems) | `.tf` of a missing node, i( ) of a non-source, a missing or wrong input | error | silent wrong answers, or stops |
| [no-analysis](#no-analysis) | no analysis line | error | runs nothing |
| [missing-end](#missing-end) | no `.end` | info | fine from a file |
| [after-end](#after-end) | lines after `.end` | warning | still read from a file (unless `.end;...`) |
| [zero-ohm](#zero-ohm) | a resistor below 1e-12 Ω | warning, error | 47: 1e-12 Ω with a warning; 42: 1 mΩ silently; across a source: absurd currents |
| [fatal-syntax](#fatal-syntax) | an unclosed `{` or `'`, an undefined parameter, a malformed B line | error | stops with a fatal error |
| [include-not-available](#include-not-available) | `.include`, `.lib file section`, `.lib` with one word | error | stops: the file is not there, or `.lib` is not recognised |
| [lost-continuation](#lost-continuation) | a `+` line that ngspice loses | warning | loses it, silently |
| [unknown-word](#unknown-word) | a word after a part's value that is no setting of the part: `R1 a 0 1k load`, `V1 a 0 5 battery`, `1d-3` on a source | error | stops ("unknown parameter") |
| [unknown-dot-command](#unknown-dot-command) | a dot command ngspice does not know: `.tarn`, `.pss` | error | stops before anything runs |
| [non-ascii-node](#non-ascii-node) | a node name with a letter outside a to z (`giriş`); two names ngspice spells the same (`ş` and `ç`) | warning, error | writes each byte as `_`; joins the two nodes, silently |
| [invisible-character](#invisible-character) | an invisible character inside a value (`1<ZWSP>k`) or a node name (`ou<ZWSP>t`) | warning, error | ends the number silently; another node; at the start of a value: stops |
| [look-alike-letter](#look-alike-letter) | a letter from another alphabet in a value (`1к`, `1κ`, `1ｋ`, `2м`), the Kelvin sign, a fullwidth digit or full stop, a minus sign or a dash from a document (`1e−3`, `−5`) | warning, error | ends the number silently; at the start of a value: stops |
| [space-character](#space-character) | another character that looks like a space: a thin, narrow no-break or ideographic space between a value and its unit (`4.7<THIN>kΩ`), between groups of digits (`10<THIN>000`, `10<THIN>000<THIN>Ω`), in a node name (`o<THIN>ut`) or between two words | warning, error | ends the number silently; another node; glues two words, silently; at the start of a value: stops |

## mega-as-milli

A part value whose scale letter is a capital `M` alone (not `MEG`, not `MIL`) on R, C, L, V, I, E, F, G or H. A lower-case `m` is not flagged: the channel teaches `m` for milli, and a 10 mΩ shunt is real. Warning. Two fixes: mega (`1meg`) and milli (`1m`); mega comes first on resistors and gains, milli first on sources, capacitors and inductors. A value like `1M5` is resistor code and goes to rkm-notation instead.

What PlainSpice shows for mega-as-milli-1 (warning, line 3):

> **1M means 1 milliohm (1 mΩ), not 1 megaohm (1 MΩ).** SPICE ignores capital letters, so a capital M is the same as a small m: milli. For mega, write meg: 1meg.
>
> *ngspice:* ngspice reads 1M as 1 mΩ and says nothing. [mega-as-milli-1, mega-as-milli-2, mega-as-milli-3]
>
> *Fixes:* "Make it 1meg (1 MΩ)", "Keep milli: write 1m"

### mega-as-milli-1. 1M on a resistor is one milliohm, silently

```spice
* 1M meant as a megaohm
V1 n1 0 6
R1 n1 n2 1M
R2 n2 0 1meg
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n2                               6.000000e+00
        n1                               6.000000e+00
        v1#branch                        -6.00000e-06
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n2) = 5.999999994, i(v1) = -0.00000599999930273043
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n2) = 5.999999994, i(v1) = -0.00000599999930273043
```

PlainSpice's checks: `mega-as-milli`.

### mega-as-milli-2. 1MOhm is still a milliohm (the Ohm is ignored); 1MEGohm is a megaohm

```spice
* 1MOhm and 1MEGohm
V1 n1 0 6
R1 n1 n2 1MOhm
R2 n2 0 1MEGohm
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n2                               6.000000e+00
        n1                               6.000000e+00
        v1#branch                        -6.00000e-06
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n2) = 5.999999994, i(v1) = -0.00000599999930273043
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n2) = 5.999999994, i(v1) = -0.00000599999930273043
```

PlainSpice's checks: `mega-as-milli`.

### mega-as-milli-3. M is milli on sources and gains too

```spice
* M on a voltage source, a current source and a gain
V1 n1 0 5M
R1 n1 0 1
I1 0 n2 2M
R2 n2 0 1
E1 n3 0 n1 0 1M
R3 n3 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n3                               5.000000e-06
        n2                               2.000000e-03
        n1                               5.000000e-03
        v1#branch                        -5.00000e-03
        e1#branch                        -5.00000e-06
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 0.005, v(n2) = 0.002, v(n3) = 0.000005
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 0.005, v(n2) = 0.002, v(n3) = 0.000005
```

PlainSpice's checks: `mega-as-milli`, `mega-as-milli`, `mega-as-milli`.

## unit-letter

A value whose scale letter is `A`/`a` (atto) on any part with a main value, or `F` (femto) on a capacitor. Warning; a lower-case `f` on a capacitor is only info, because femtofarads are sometimes meant. Fix: the number alone (`3`, `1`). `100mA` or `10uF` raise nothing: the scale letter is m or u and the letters after it are ignored (unit-letter-3).

What PlainSpice shows for unit-letter-1 (warning, line 2):

> **3A means 3 attoamps.** A is not amps here: SPICE reads it as the scale letter a, atto (10⁻¹⁸), and it does not use units. Write the number alone: 3 means 3 amps.
>
> *ngspice:* ngspice reads 3A as 3 attoamps and says nothing. [unit-letter-1, unit-letter-2]
>
> *Fixes:* "Write 3 (3 amps)"

### unit-letter-1. 3A is 3 attoamperes, silently

```spice
* 3A on a current source
I1 0 n1 3A
R1 n1 0 4
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               1.200000e-17
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 1.2000000000000001e-17
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 1.2000000000000001e-17
```

PlainSpice's checks: `unit-letter`.

### unit-letter-2. 1F on a capacitor is one femtofarad: the capacitor charges at once

```spice
* 1F on a capacitor
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1F
.tran 1u 5u
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 69 points, last 1.000014344867142
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 69 points, last 1.000014344815675
our engine (wasm), as ngspice -b -r (exit 0):
    in                                           0
    out                                          0
    v1#branch                                    0
    vectors: v(out): 69 points, last 1.000014344867142
```

PlainSpice's checks: `unit-letter`.

### unit-letter-3. 100mA is fine: milli, then the A is ignored (no trap)

```spice
* 100mA
I1 0 n1 100mA
R1 n1 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               1.000000e-01
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 0.1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 0.1
```

PlainSpice's checks: no trap.

## greek-mu

A number followed by the Greek letter μ (U+03BC), in a part line or an analysis line. ngspice knows the micro sign µ (U+00B5), which raises nothing. Warning. Fix: `u`. On a capacitor or an inductor ngspice also looks for a model named after the word and warns that it can't find one (greek-mu-2); the value is still the number alone, and the trap text says so.

What PlainSpice shows for greek-mu-1 (warning, line 3):

> **4.7μ is read as 4.7 Ω: SPICE ignores this μ.** This μ is the Greek letter mu, not the micro sign µ that SPICE knows (phone keyboards often type the Greek one). SPICE ignores it like a unit. Write u for micro: 4.7u.
>
> *ngspice:* ngspice reads 4.7μ as 4.7 Ω and says nothing. [greek-mu-1]
>
> *Fixes:* "Write u for micro: 4.7u"

What PlainSpice shows for greek-mu-2 (warning, line 4):

> **2μF is read as 2 F: SPICE ignores this μ.** This μ is the Greek letter mu, not the micro sign µ that SPICE knows (phone keyboards often type the Greek one). SPICE ignores it like a unit. Write u for micro: 2uF.
>
> *ngspice:* ngspice reads 2μF as 2 F; it only warns that it can't find a model called '2μf'. [greek-mu-2]
>
> *Fixes:* "Write u for micro: 2uF"

### greek-mu-1. The Greek letter μ is ignored; the micro sign µ works

```spice
* the Greek letter mu and the micro sign
I1 0 n1 1
R1 n1 0 4.7μ
V2 n2 0 4.7µ
R2 n2 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n2                               4.700000e-06
        n1                               4.700000e+00
        v2#branch                        -4.70000e-06
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 4.7, v(n2) = 0.0000047
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 4.7, v(n2) = 0.0000047
```

PlainSpice's checks: `greek-mu`.

### greek-mu-2. On a capacitor or an inductor ngspice also warns that it can't find a model named after the word

The same Greek μ on C and L: ngspice reads 2μF as 2 F and 3μH as 3 H, and for these two parts it also looks for a model called 2μf (3μh) and warns that it can't find one. The value really is 2 F: C1 holds the charge of 2 F through 1 Ω, so out has barely moved after 1 ms.

```spice
* the Greek letter mu on a capacitor and an inductor
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1
C1 out 0 2μF
R2 in b 1
L1 b 0 3μH
.tran 0.1m 1m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '2μf' from line
        c1 out 0 2μf
    warning, can't find model '3μh' from line
        l1 b 0 3μh
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 81 points, last 0.0004998747709848901, v(b): 81 points, last 0.9996667223826431
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '2μf' from line
        c1 out 0 2μf
    warning, can't find model '3μh' from line
        l1 b 0 3μh
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 80 points, last 0.0004998747709849339, v(b): 80 points, last 0.999666722382643
our engine (wasm), as ngspice -b -r (exit 0):
    in                                           0
    out                                          0
    b                                            0
    l1#branch                                    0
    v1#branch                                    0
    warning, can't find model '2μf' from line
        c1 out 0 2μf
    warning, can't find model '3μh' from line
        l1 b 0 3μh
    vectors: v(out): 59 points, last 0.0004998750208322771, v(b): 59 points, last 0.9996667222160498
```

PlainSpice's checks: `greek-mu`, `greek-mu`.

## rkm-notation

A main value written in resistor code: digits, one of R K M G T (or m u n p) standing for the decimal point, digits. Only when ngspice's value differs from the code's (so `1k0` is fine). `M` is mega in resistor code, `m` milli. Warning. Fix: the decimal spelling (`2.2k`, `1.5meg`, `4.7`).

What PlainSpice shows for rkm-notation-1 (warning, line 3):

> **2k2 is read as 2k, not 2.2k.** On resistor codes and schematics 2k2 means 2.2k: the letter stands for the decimal point. SPICE stops reading the number at the letter and ignores the 2 after it. Write 2.2k.
>
> *ngspice:* ngspice reads 2k2 as 2 kΩ (R1) and says nothing. [rkm-notation-1]
>
> *Fixes:* "Write 2.2k (2.2 kΩ)"

### rkm-notation-1. 2k2 is 2 kΩ, 1M5 is 1 mΩ, 4R7 is 4 Ω: the digits after the letter are ignored

```spice
* resistor-code values
I1 0 n1 1
R1 n1 0 2k2
I2 0 n2 1
R2 n2 0 1M5
I3 0 n3 1
R3 n3 0 4R7
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n3                               4.000000e+00
        n2                               1.000000e-03
        n1                               2.000000e+03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 2000, v(n2) = 0.001, v(n3) = 4
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 2000, v(n2) = 0.001, v(n3) = 4
```

PlainSpice's checks: `rkm-notation`, `rkm-notation`, `rkm-notation`.

## decimal-comma

A main value written with a decimal comma: digits, a comma and more digits, with nothing in between. On R, C and L it is a warning (ngspice keeps the second number: silently on R, with only a model warning on C and L); on V, I, E, F, G and H an error. Commas between source-function arguments, `PULSE(0,5,...)`, are fine. Fix: a point.

What PlainSpice shows for decimal-comma-1 (warning, line 3):

> **1,5k: SPICE reads the comma as a space.** SPICE writes decimals with a point. A comma separates words, so 1,5k is two numbers, 1 and 5k.
>
> *ngspice:* ngspice reads two numbers, 1 and 5k, keeps the second one and says nothing: R1 gets 5 kΩ. [decimal-comma-1, decimal-comma-2, decimal-comma-3]
>
> *Fixes:* "Write 1.5k"

### decimal-comma-1. On a resistor 1,5k is 5 kΩ, silently

```spice
* a decimal comma on a resistor
I1 0 n1 1
R1 n1 0 1,5k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               5.000000e+03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 5000
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 5000
```

PlainSpice's checks: `decimal-comma`.

### decimal-comma-2. On a capacitor 1,5u is 5 µF, with only a model warning

```spice
* a decimal comma on a capacitor (RC = 5 us if C is 5u)
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1
C1 out 0 1,5u
.tran 0.1u 5u
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '1,5u' from line
        c1 out 0 1,5u
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 73 points, last 0.6320957369930835
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '1,5u' from line
        c1 out 0 1,5u
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 73 points, last 0.6320957403152144
our engine (wasm), as ngspice -b -r (exit 0):
    in                                           0
    out                                          0
    v1#branch                                    0
    warning, can't find model '1,5u' from line
        c1 out 0 1,5u
    vectors: v(out): 73 points, last 0.6320957369930835
```

PlainSpice's checks: `decimal-comma`.

### decimal-comma-3. On an inductor 1,5m is 5 mH, with only a model warning

```spice
* a decimal comma on an inductor (L/R = 5 ms if L is 5m)
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1
L1 out 0 1,5m
.tran 0.1m 5m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '1,5m' from line
        l1 out 0 1,5m
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 83 points, last 0.3678675214980326
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '1,5m' from line
        l1 out 0 1,5m
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 83 points, last 0.36786749778530825
our engine (wasm), as ngspice -b -r (exit 0):
    in                                           0
    out                                          0
    l1#branch                                    0
    v1#branch                                    0
    warning, can't find model '1,5m' from line
        l1 out 0 1,5m
    vectors: v(out): 59 points, last 0.3678675319811592
```

PlainSpice's checks: `decimal-comma`.

### decimal-comma-4. On a voltage source 1,5 stops ngspice

```spice
* a decimal comma on a voltage source
V1 a 0 1,5
R1 a 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 1,5
      unknown parameter (5)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 1,5
      unknown parameter (5)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `decimal-comma`.

### decimal-comma-5. On a current source 2,5 stops ngspice

```spice
* a decimal comma on a current source
I1 0 a 2,5
R1 a 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a 2,5
      unknown parameter (5)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a 2,5
      unknown parameter (5)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `decimal-comma`.

### decimal-comma-6. On an E gain: our engine stops, native 47 reads a polynomial

```spice
* a decimal comma on a gain
V1 a 0 1
R0 a 0 1
E1 b 0 a 0 1,5
R1 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                6.000000e+00
        a                                1.000000e+00
        a$poly$e1#branch_1_0             -6.00000e+00
        v1#branch                        -1.00000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 1, v(b) = 6, i(v1) = -1, i(a$poly$e1) = -6
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      e1 b 0 a 0 1,5
      unknown parameter (5)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `decimal-comma`.

### decimal-comma-7. On a G value: the same

```spice
* a decimal comma on a transconductance
V1 a 0 1
R0 a 0 1
G1 0 b a 0 1,5
R1 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                6.000000e+00
        a                                1.000000e+00
        v1#branch                        -1.00000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 1, v(b) = 6, i(v1) = -1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      g1 0 b a 0 1,5
      unknown parameter (5)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `decimal-comma`.

### decimal-comma-8. On an F gain: the same

```spice
* a decimal comma on a current gain
V1 a 0 1
Vx a c 0
R0 c 0 1
F1 0 b Vx 1,5
R1 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                6.000000e+00
        c                                1.000000e+00
        a                                1.000000e+00
        v1#branch                        -1.00000e+00
        vx#branch                        1.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 1, v(c) = 1, v(b) = 6, i(vx) = 1, i(v1) = -1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 5 or its substitute:
      f1 0 b vx 1,5
      unknown parameter (5)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `decimal-comma`.

### decimal-comma-9. On an H value: the same

```spice
* a decimal comma on a transresistance
V1 a 0 1
Vx a c 0
R0 c 0 1
H1 b 0 Vx 1,5
R1 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                6.000000e+00
        c                                1.000000e+00
        a                                1.000000e+00
        a$poly$h1#branch_1_0             -6.00000e+00
        v1#branch                        -1.00000e+00
        vx#branch                        1.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 1, v(c) = 1, v(b) = 6, i(vx) = 1, i(v1) = -1, i(a$poly$h1) = -6
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 5 or its substitute:
      h1 b 0 vx 1,5
      unknown parameter (5)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `decimal-comma`.

## sign-in-value

A `+` or `−` glued inside the value of a resistor, capacitor or inductor: `1k-2`, `1d-3`, `1k+2`. ngspice ends a number at a + or − after a digit or a letter (N9, N10 in numbers-and-syntax.md), so the part reads two numbers and keeps the second one, silently on R; on C and L with a warning that it can't find a model named after the whole word. Warning. Fix: `1e-3` when the first number ends in d or e (an exponent was meant), otherwise keep the first number. On V, I, E, F, G and H ngspice stops at the second number instead: that is unknown-word (unknown-word-9).

What PlainSpice shows for sign-in-value-1 (warning, line 3):

> **1k-2: SPICE reads two numbers, 1k and −2.** A + or − right after a digit or a letter starts a new number in SPICE, so 1k-2 is two numbers, and R1 takes the second one. For an exponent, write e: 1e-3.
>
> *ngspice:* ngspice reads two numbers, 1k and -2, keeps the second one and says nothing: R1 gets −2 Ω. [sign-in-value-1]
>
> *Fixes:* "Keep 1k (1 kΩ)"

### sign-in-value-1. A + or − inside a resistor value starts a second number, which the resistor takes, silently

ngspice ends a number at a + or − after a digit or a letter, so 1k-2 is the two numbers 1k and −2, 1d-3 is 1d and −3 (d is no exponent there), and 1k+2 is 1k and +2. A resistor keeps the last number it reads, so R1 is −2 Ω, R2 −3 Ω and R3 2 Ω: 1 A into each gives −2 V, −3 V and 2 V. Nothing is printed about it.

```spice
* a sign inside a resistor's value
I1 0 a 1
R1 a 0 1k-2
I2 0 b 1
R2 b 0 1d-3
I3 0 c 1
R3 c 0 1k+2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        c                                2.000000e+00
        b                                -3.00000e+00
        a                                -2.00000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = -2, v(b) = -3, v(c) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = -2, v(b) = -3, v(c) = 2
```

PlainSpice's checks: `sign-in-value`, `sign-in-value`, `sign-in-value`.

### sign-in-value-2. On a capacitor or an inductor too, with a warning that it can't find a model

The same on C and L: 1u-2 gives C1 a capacitance of −2 F and 1m-2 gives L1 an inductance of −2 H, and for these two parts ngspice also warns that it can't find a model called 1u-2 or 1m-2. The waveforms show the negative values: with 1 V switched on through 1 Ω, out runs away below 0 (1 − e^(t/2) = −0.6487 V after 1 s) where a 1 µF capacitor would follow in at once, and b grows (e^(t/2) = 1.649 V) where a 1 mH inductor would short it to 0 V.

```spice
* a sign inside a capacitor's and an inductor's value
V1 in 0 PULSE(0 1 0 1n 1n 10 20)
R1 in out 1
C1 out 0 1u-2
R2 in b 1
L1 b 0 1m-2
.tran 10m 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '1u-2' from line
        c1 out 0 1u-2
    warning, can't find model '1m-2' from line
        l1 b 0 1m-2
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 140 points, last -0.6487229588969943, v(b): 140 points, last 1.6487229588969943
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '1u-2' from line
        c1 out 0 1u-2
    warning, can't find model '1m-2' from line
        l1 b 0 1m-2
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 139 points, last -0.6487229675210122, v(b): 139 points, last 1.6487229675210122
our engine (wasm), as ngspice -b -r (exit 0):
    in                                           0
    out                                          0
    b                                            0
    l1#branch                                    0
    v1#branch                                    0
    warning, can't find model '1u-2' from line
        c1 out 0 1u-2
    warning, can't find model '1m-2' from line
        l1 b 0 1m-2
    vectors: v(out): 108 points, last -0.64872296771743, v(b): 108 points, last 1.64872296771743
```

PlainSpice's checks: `sign-in-value`, `sign-in-value`.

## space-before-suffix

A plain number followed, after spaces, by a word that is a scale letter, a unit, or both (`k`, `V`, `kOhm`, `uF`). Error. ngspice usually stops, but some of these words are names of the part's own settings: `m` is the multiplier of R, C, L, I, G and F, and with no value it makes the part carry nothing, silently (space-before-suffix-7 to -11). Fix: join them, dropping a unit (`1k`, `5`); a lone `M` gets the mega and milli fixes.

What PlainSpice shows for space-before-suffix-1 (error, line 3):

> **1 k: the space splits the value in two.** SPICE reads 1 k as two words: the number 1, then k as a separate word. Write the letter right after the number.
>
> *ngspice:* ngspice looks for a model called k, warns 'can't find model', and stops: 'unknown parameter (k)'. [space-before-suffix-1]
>
> *Fixes:* "Write 1k"

### space-before-suffix-1. R1 n1 0 1 k: ngspice looks for a model k, then stops

```spice
* a space before k on a resistor
I1 0 n1 1
R1 n1 0 1 k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'k' from line
        r1 n1 0 1 k
    Error on line 3 or its substitute:
      r1 n1 0 1 k
      unknown parameter (k)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'k' from line
        r1 n1 0 1 k
    Error on line 3 or its substitute:
      r1 n1 0 1 k
      unknown parameter (k)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `space-before-suffix`.

### space-before-suffix-2. V1 n1 0 5 V stops ngspice

```spice
* a space before a unit on a voltage source
V1 n1 0 5 V
R1 n1 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 n1 0 5 v
      unknown parameter (v)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 n1 0 5 v
      unknown parameter (v)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `space-before-suffix`.

### space-before-suffix-3. I1 0 n1 3 A stops ngspice

```spice
* a space before a unit on a current source
I1 0 n1 3 A
R1 n1 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 n1 3 a
      unknown parameter (a)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 n1 3 a
      unknown parameter (a)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `space-before-suffix`.

### space-before-suffix-4. C1 out 0 1 u stops ngspice (no model warning on a capacitor)

```spice
* a space before u on a capacitor
V1 in 0 1
R1 in out 1k
C1 out 0 1 u
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      c1 out 0 1 u
      unknown parameter (u)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      c1 out 0 1 u
      unknown parameter (u)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `space-before-suffix`.

### space-before-suffix-5. L1 out 0 1 u: the same

```spice
* a space before u on an inductor
V1 in 0 1
R1 in out 1k
L1 out 0 1 u
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      l1 out 0 1 u
      unknown parameter (u)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      l1 out 0 1 u
      unknown parameter (u)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `space-before-suffix`.

### space-before-suffix-6. E1 b 0 a 0 2 k: our engine stops (native 47 too, with a polynomial error)

```spice
* a space before k on a gain
V1 a 0 1
R0 a 0 1
E1 b 0 a 0 2 k
R1 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line:
      a$poly$e1 %vd [ a 0 ] %vd ( b 0 ) a$poly$e1
    MIF-ERROR - model: a$poly$e1 - Bad real value
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line:
      a$poly$e1 %vd [ a 0 ] %vd ( b 0 ) a$poly$e1
    MIF-ERROR - model: a$poly$e1 - Bad real value
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      e1 b 0 a 0 2 k
      unknown parameter (k)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `space-before-suffix`.

### space-before-suffix-7. R1 n1 0 1 m runs, and R1 carries no current: m is its multiplier, given no value

```spice
* a space before m on a resistor
I1 0 n1 1
R1 n1 0 1 m
R2 n1 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               1.000000e+00
    warning, can't find model 'm' from line
        r1 n1 0 1 m
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(n1) = 1
```

PlainSpice's checks: `space-before-suffix`.

### space-before-suffix-8. C1 out 0 1 m runs, and C1 has no capacitance (it charges at once)

```spice
* a space before m on a capacitor
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1 m
.tran 0.1m 1m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 77 points, last 1
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 77 points, last 1
our engine (wasm), as ngspice -b -r (exit 0):
    in                                           0
    out                                          0
    v1#branch                                    0
    vectors: v(out): 64 points, last 1
```

PlainSpice's checks: `space-before-suffix`.

### space-before-suffix-9. L1 out 0 1 m: a .tran stops

```spice
* a space before m on an inductor
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
L1 out 0 1 m
.tran 0.1m 1m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    doAnalyses: TRAN:  Timestep too small; initial timepoint: cause unrecorded.
    run simulation(s) aborted
    rawfile: time = 0, v(in) = 0, v(out) = 0, i(l1) = 0, i(v1) = 0
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    doAnalyses: TRAN:  Timestep too small; initial timepoint: cause unrecorded.
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    in                                           0
    out                                          0
    l1#branch                                    0
    v1#branch                                    0
    doAnalyses: TRAN:  Timestep too small; initial timepoint: cause unrecorded.
    run simulation(s) aborted
    vectors: time = 0, v(in) = 0, v(out) = 0, i(l1) = 0, i(v1) = 0
```

PlainSpice's checks: `space-before-suffix`.

### space-before-suffix-10. I1 0 a 3 m runs, and I1 pushes no current

```spice
* a space before m on a current source
I1 0 a 3 m
R1 a 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 0
```

PlainSpice's checks: `space-before-suffix`.

### space-before-suffix-11. G1 0 b a 0 2 m: our engine runs it with no current; native 47 stops

```spice
* a space before m on a transconductance
V1 a 0 1
R0 a 0 1
G1 0 b a 0 2 m
R1 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line:
      a$poly$g1 %vd [ a 0 ] %id ( 0 b ) a$poly$g1
    MIF-ERROR - model: a$poly$g1 - Bad real value
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line:
      a$poly$g1 %vd [ a 0 ] %id ( 0 b ) a$poly$g1
    MIF-ERROR - model: a$poly$g1 - Bad real value
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(b) = 0
```

PlainSpice's checks: `space-before-suffix`.

### space-before-suffix-12. R1 n1 0 1 p: no such parameter

```spice
* a space before p on a resistor
I1 0 n1 1
R1 n1 0 1 p
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'p' from line
        r1 n1 0 1 p
    Error on line 3 or its substitute:
      r1 n1 0 1 p
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'p' from line
        r1 n1 0 1 p
    Error on line 3 or its substitute:
      r1 n1 0 1 p
    no such parameter on this device
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `space-before-suffix`.

### space-before-suffix-13. G1 0 b a 0 2 k

```spice
* a space before k on a transconductance
V1 a 0 1
R0 a 0 1
G1 0 b a 0 2 k
R1 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line:
      a$poly$g1 %vd [ a 0 ] %id ( 0 b ) a$poly$g1
    MIF-ERROR - model: a$poly$g1 - Bad real value
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line:
      a$poly$g1 %vd [ a 0 ] %id ( 0 b ) a$poly$g1
    MIF-ERROR - model: a$poly$g1 - Bad real value
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      g1 0 b a 0 2 k
      unknown parameter (k)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `space-before-suffix`.

### space-before-suffix-14. F1 0 b Vx 2 k

```spice
* a space before k on a current gain
V1 a 0 1
Vx a c 0
R0 c 0 1
F1 0 b Vx 2 k
R1 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line:
      a$poly$f1 %vnam [ vx ] %id ( 0 b ) a$poly$f1
    MIF-ERROR - model: a$poly$f1 - Bad real value
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line:
      a$poly$f1 %vnam [ vx ] %id ( 0 b ) a$poly$f1
    MIF-ERROR - model: a$poly$f1 - Bad real value
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 5 or its substitute:
      f1 0 b vx 2 k
      unknown parameter (k)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `space-before-suffix`.

### space-before-suffix-15. E1 b 0 a 0 2 p: our engine stops with "no such parameter" (p is a value E reports)

The space splits off p, which an E line can only report (its power), so our engine stops with "no such parameter on this device"; native 47 reads a polynomial and stops too.

```spice
* a space before p on a gain
V1 a 0 1
R0 a 0 1
E1 b 0 a 0 2 p
R1 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line:
      a$poly$e1 %vd [ a 0 ] %vd ( b 0 ) a$poly$e1
    MIF-ERROR - model: a$poly$e1 - Bad real value
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line:
      a$poly$e1 %vd [ a 0 ] %vd ( b 0 ) a$poly$e1
    MIF-ERROR - model: a$poly$e1 - Bad real value
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      e1 b 0 a 0 2 p
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `space-before-suffix`.

### space-before-suffix-16. R1 n1 0 1 Ω: ngspice quotes the Ω as __

Added after the final reviews of 12 November 2026. ngspice writes each byte of a letter outside ASCII as `_` (W16), so its message names the word `__`, while the model warning shows the Ω as written.

```spice
* a space before the ohm sign
I1 0 n1 1
R1 n1 0 1 Ω
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'Ω' from line
    r1 n1 0 1 Ω
    Error on line 3 or its substitute:
      r1 n1 0 1 __
      unknown parameter (__)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'Ω' from line
    r1 n1 0 1 Ω
    Error on line 3 or its substitute:
      r1 n1 0 1 __
      unknown parameter (__)
    Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `space-before-suffix`.

### space-before-suffix-17. C1 out 0 1 µ: ngspice quotes the µ as u

ngspice turns the micro sign into `u` before it reads the line (N5, W16).

```spice
* a space before the micro sign
V1 in 0 1
R1 in out 1k
C1 out 0 1 µ
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      c1 out 0 1 u
      unknown parameter (u)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      c1 out 0 1 u
      unknown parameter (u)
    Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `space-before-suffix`.

## midline-comment

A word starting with `*`, `#` or a single `/` after the value of an R, C, L, V, I, E, F, G or H line: a comment written the way it works only at the start of a line. Error. Fix: `;`, which starts an end-of-line comment anywhere (midline-comment-8).

What PlainSpice shows for midline-comment-1 (error, line 3):

> *** in the middle of a line is not a comment.** A * starts a comment only at the beginning of a line. For a comment after a part, use a semicolon: ; like this.
>
> *ngspice:* ngspice stops: 'unknown parameter (*)'. [midline-comment-1 ... midline-comment-6, midline-comment-9]
>
> *Fixes:* "Use ; for the comment"

### midline-comment-1. A * after a resistor value stops ngspice

```spice
* a star after a resistor value
I1 0 n1 1
R1 n1 0 2 * load
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      r1 n1 0 2 * load
      unknown parameter (*)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      r1 n1 0 2 * load
      unknown parameter (*)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `midline-comment`.

### midline-comment-2. A * after a source value stops ngspice

```spice
* a star after a source value
V1 a 0 5 * supply
R1 a 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 5 * supply
      unknown parameter (*)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 5 * supply
      unknown parameter (*)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `midline-comment`.

### midline-comment-3. So does a #

```spice
* a hash after a resistor value
I1 0 n1 1
R1 n1 0 2 # load
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '#' from line
        r1 n1 0 2 # load
    Error on line 3 or its substitute:
      r1 n1 0 2 # load
      unknown parameter (#)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '#' from line
        r1 n1 0 2 # load
    Error on line 3 or its substitute:
      r1 n1 0 2 # load
      unknown parameter (#)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `midline-comment`.

### midline-comment-4. And a single /

```spice
* a slash after a resistor value
I1 0 n1 1
R1 n1 0 2 / load
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '/' from line
        r1 n1 0 2 / load
    Error on line 3 or its substitute:
      r1 n1 0 2 / load
      unknown parameter (/)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '/' from line
        r1 n1 0 2 / load
    Error on line 3 or its substitute:
      r1 n1 0 2 / load
      unknown parameter (/)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `midline-comment`.

### midline-comment-5. On a capacitor, a current source and a gain too

```spice
* a star after a capacitor value
V1 in 0 1
R1 in out 1k
C1 out 0 1u * filter
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      c1 out 0 1u * filter
      unknown parameter (*)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      c1 out 0 1u * filter
      unknown parameter (*)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `midline-comment`.

### midline-comment-6. A * after a current source value

```spice
* a star after a current source value
I1 0 n1 3 * source
R1 n1 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 n1 3 * source
      unknown parameter (*)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 n1 3 * source
      unknown parameter (*)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `midline-comment`.

### midline-comment-7. A * after a gain

```spice
* a star after a gain
V1 a 0 1
R0 a 0 1
E1 b 0 a 0 2 * amplifier
R1 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line:
      a$poly$e1 %vd [ a 0 ] %vd ( b 0 ) a$poly$e1
    MIF-ERROR - model: a$poly$e1 - Bad real value
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line:
      a$poly$e1 %vd [ a 0 ] %vd ( b 0 ) a$poly$e1
    MIF-ERROR - model: a$poly$e1 - Bad real value
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      e1 b 0 a 0 2 * amplifier
      unknown parameter (*)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `midline-comment`.

### midline-comment-9. A * after an inductor value

```spice
* a star after an inductor value
V1 in 0 1
R1 in out 1k
L1 out 0 1m * choke
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      l1 out 0 1m * choke
      unknown parameter (*)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      l1 out 0 1m * choke
      unknown parameter (*)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `midline-comment`.

### midline-comment-10. A * after a G value

```spice
* a star after a transconductance
V1 a 0 1
R0 a 0 1
G1 0 b a 0 2 * amplifier
R1 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line:
      a$poly$g1 %vd [ a 0 ] %id ( 0 b ) a$poly$g1
    MIF-ERROR - model: a$poly$g1 - Bad real value
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line:
      a$poly$g1 %vd [ a 0 ] %id ( 0 b ) a$poly$g1
    MIF-ERROR - model: a$poly$g1 - Bad real value
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      g1 0 b a 0 2 * amplifier
      unknown parameter (*)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `midline-comment`.

### midline-comment-11. A * after an F gain

```spice
* a star after a current gain
V1 a 0 1
Vx a c 0
R0 c 0 1
F1 0 b Vx 2 * amplifier
R1 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line:
      a$poly$f1 %vnam [ vx ] %id ( 0 b ) a$poly$f1
    MIF-ERROR - model: a$poly$f1 - Bad real value
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line:
      a$poly$f1 %vnam [ vx ] %id ( 0 b ) a$poly$f1
    MIF-ERROR - model: a$poly$f1 - Bad real value
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 5 or its substitute:
      f1 0 b vx 2 * amplifier
      unknown parameter (*)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `midline-comment`.

### midline-comment-12. A * after an H value

```spice
* a star after a transresistance
V1 a 0 1
Vx a c 0
R0 c 0 1
H1 b 0 Vx 2 * amplifier
R1 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line:
      a$poly$h1 %vnam [ vx ] %vd ( b 0 ) a$poly$h1
    MIF-ERROR - model: a$poly$h1 - Bad real value
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line:
      a$poly$h1 %vnam [ vx ] %vd ( b 0 ) a$poly$h1
    MIF-ERROR - model: a$poly$h1 - Bad real value
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 5 or its substitute:
      h1 b 0 vx 2 * amplifier
      unknown parameter (*)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `midline-comment`.

### midline-comment-8. A ; is the end-of-line comment that works

```spice
* a semicolon after a value
I1 0 n1 1
R1 n1 0 2 ; load
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 2
```

PlainSpice's checks: no trap.

## nbsp

A no-break space (U+00A0) inside a word of a part, dot-command or continuation line, usually from text copied out of a web page or a PDF. Warning. Fix: a normal space. Between a value and its unit, as documents write `4.7 kΩ` (added after the critic of the fixes for the final reviews, 12 November 2026), the value is read the way the document meant it and the fix writes it for SPICE, `4.7k`, as for the other characters that look like a space (space-character).

What PlainSpice shows for nbsp-1 (warning, line 3):

> **A no-break space glues "0 2" into one word.** This line has a no-break space (it often comes with text copied from a web page or a PDF). It looks like a space, but SPICE does not treat it as one, so the words on either side become one word.
>
> *ngspice:* ngspice reads the no-break space as part of the word and says nothing about it; in one test R1 n1 0<no-break space>2 became a resistor with the node "0 2" and no value, which ngspice then left out. [nbsp-1]
>
> *Fixes:* "Replace it with a normal space"

What PlainSpice shows for nbsp-2 (warning, line 3):

> **R1's value is read as 4.7 Ω, not 4.7 kΩ.** A no-break space (U+00A0) sits between 4.7 and kΩ, as documents write a number and its unit. It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the kΩ after it does not count. SPICE needs no space and no units: write 4.7k.
>
> *ngspice:* ngspice stops reading the number at the no-break space and ignores the rest of the word, without a message: it reads 4.7 Ω. [nbsp-2]
>
> *Fixes:* "Write 4.7k (4.7 kΩ)"

### nbsp-1. A no-break space glues two words into one

```spice
* a no-break space before the value
I1 0 n1 1
R1 n1 0<NBSP>2
R2 n1 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               1.000000e+00
    Warning: 'r1 n1 0__2' is not a valid resistor instance line, ignored!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(n1) = 1
```

PlainSpice's checks: `missing-value`, `nbsp`.

### nbsp-2. Between a value and its unit it ends the number: 4.7<NBSP>kΩ is 4.7 Ω

Added after the critic of the fixes for the final reviews (12 November 2026). Documents write a no-break space between a number and its unit so the two stay on one line. ngspice reads it as part of the word, so the number ends there and the rest of the word is ignored, without a message: R1 is 4.7 Ω, and out sits at 9.99 V instead of 5 V.

```spice
* a no-break space between the value and its unit
V1 in 0 10
R1 in out 4.7<NBSP>kΩ
R2 out 0 4.7k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out                              9.990010e+00
        in                               1.000000e+01
        v1#branch                        -2.12553e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 10, v(out) = 9.99000999000999, i(v1) = -0.0021255340404278122
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 10, v(out) = 9.99000999000999, i(v1) = -0.0021255340404278122
```

PlainSpice's checks: `nbsp`.

## missing-value

A part line with its nodes but no value. R, C and L: warning (ngspice leaves the part out when nothing follows the nodes; with settings such as m=2 or ic=0 it keeps it: a resistor at 1 mΩ with a warning, a capacitor or inductor without capacitance or inductance, silently: missing-value-8 to -10). V and I: warning (ngspice uses 0); for V the fix writes the 0 explicitly, which is right for an ammeter. E, F, G and H: error, because native ngspice 47 stops while PlainSpice's engine silently uses 0.

What PlainSpice shows for missing-value-1 (warning, line 4):

> **R1 has no value.** A resistor line is: name, node, node, value. Without a value SPICE can't use the resistor.
>
> *ngspice:* ngspice leaves R1 out of the circuit and warns: 'not a valid resistor instance line, ignored!'. [missing-value-1, missing-value-2]
>
> *Fixes:* none

### missing-value-1. A resistor without a value is left out

```spice
* a resistor without a value
V1 a 0 6
R2 a 0 3
R1 a 0
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                6.000000e+00
        v1#branch                        -2.00000e+00
    Warning: 'r1 a 0' is not a valid resistor instance line, ignored!
  ngspice -b -r out.raw (exit 0)
    rawfile: i(v1) = -2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: i(v1) = -2
```

PlainSpice's checks: `missing-value`.

### missing-value-2. So is a capacitor or an inductor

```spice
* a capacitor and an inductor without a value
V1 a 0 6
R1 a b 2
C1 b 0
R2 b c 2
L1 c 0
R3 c 0 4
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        c                                3.000000e+00
        b                                4.500000e+00
        a                                6.000000e+00
        v1#branch                        -7.50000e-01
    Warning: 'c1 b 0' is not a valid capacitor instance line, ignored!
    Warning: 'l1 c 0' is not a valid inductor instance line, ignored!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(b) = 4.5, v(c) = 3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(b) = 4.5, v(c) = 3
```

PlainSpice's checks: `missing-value`, `missing-value`.

### missing-value-3. A source without a value is 0 V or 0 A, with only a note

```spice
* sources without a value
V1 a 0
R1 a 0 2
I1 0 b
R2 b 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                0.000000e+00
        a                                0.000000e+00
        v1#branch                        0.000000e+00
    Note: i1: has no value, DC 0 assumed
    Note: v1: has no value, DC 0 assumed
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 0, v(b) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(a) = 0, v(b) = 0
```

PlainSpice's checks: `missing-value`, `missing-value`.

### missing-value-4. E without a gain: native 47 stops, our engine uses 0

```spice
* E without a gain
V1 c 0 3
R1 c 0 1
E1 a 0 c 0
R2 a 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: not enough parameters in line
       e1 a 0 c 0
        line no 4, file circuit.cir
    No circuit loaded!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit signal SIGSEGV)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error: not enough parameters in line
       e1 a 0 c 0
    No circuit loaded!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: there aren't any circuits loaded.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 0
```

PlainSpice's checks: `missing-value`.

### missing-value-5. G without a value: the same

```spice
* G without a value
V1 c 0 3
R1 c 0 1
G1 0 a c 0
R2 a 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: not enough parameters in line
       g1 0 a c 0
        line no 4, file circuit.cir
    No circuit loaded!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit signal SIGSEGV)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error: not enough parameters in line
       g1 0 a c 0
    No circuit loaded!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: there aren't any circuits loaded.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 0
```

PlainSpice's checks: `missing-value`.

### missing-value-6. F without a gain: the same

```spice
* F without a gain
V1 c 0 3
Vx c d 0
R1 d 0 1
F1 0 a Vx
R2 a 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: not enough parameters in line
       f1 0 a vx
        line no 5, file circuit.cir
    No circuit loaded!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit signal SIGSEGV)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error: not enough parameters in line
       f1 0 a vx
    No circuit loaded!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: there aren't any circuits loaded.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 0
```

PlainSpice's checks: `missing-value`.

### missing-value-7. H without a value: the same

```spice
* H without a value
V1 c 0 3
Vx c d 0
R1 d 0 1
H1 a 0 Vx
R2 a 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: not enough parameters in line
       h1 a 0 vx
        line no 5, file circuit.cir
    No circuit loaded!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit signal SIGSEGV)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error: not enough parameters in line
       h1 a 0 vx
    No circuit loaded!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: there aren't any circuits loaded.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 0
```

PlainSpice's checks: `missing-value`.

### missing-value-8. A resistor with a setting but no value is kept at 1 mΩ, with a warning

ngspice leaves an R line out only when nothing follows its nodes. With a setting such as m=2 and no value, it keeps the resistor at 1 mΩ and warns.

```spice
* a resistor with a setting but no value
I1 0 a 1
R0 a 0 1k
R1 a 0 m=2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                4.999998e-04
    Warning: r1: resistance too low or not given, set to 1 mOhm
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 0.000499999750000125
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    Warning: r1: resistance too low or not given, set to 1 mOhm
    vectors: v(a) = 0.000499999750000125
```

PlainSpice's checks: `missing-value`.

### missing-value-9. A capacitor with ic= but no value has no capacitance, silently

The same line shape on a capacitor runs without a message, and the capacitor holds no charge: out follows in at once.

```spice
* a capacitor with ic= but no value
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 ic=0.5
.tran 1u 5u
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 69 points, last 1
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 69 points, last 1
our engine (wasm), as ngspice -b -r (exit 0):
    in                                           0
    out                                          0
    v1#branch                                    0
    vectors: v(out): 69 points, last 1
```

PlainSpice's checks: `missing-value`.

### missing-value-10. An inductor with ic= but no value has no inductance: a wire, silently

On an inductor the same line runs without a message too, and the inductor is a plain wire: out stays at 0 V.

```spice
* an inductor with ic= but no value
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
L1 out 0 ic=1m
.tran 1u 5u
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 69 points, last 0
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 69 points, last 0
our engine (wasm), as ngspice -b -r (exit 0):
    in                                           0
    out                                          0
    l1#branch                                    0
    v1#branch                                    0
    vectors: v(out): 69 points, last 0
```

PlainSpice's checks: `missing-value`.

## missing-fields

A part line with fewer nodes than the part needs, or an F or H line without its control source (a number where the source's name goes counts as missing). R, C and L: warning (left out); V, I, E, F, G and H: error. These parts are also left out of the circuit checks below, because their words are misread.

What PlainSpice shows for missing-fields-1 (warning, line 4):

> **R1 needs two nodes.** A resistor line is: name, node, node, value. R1 has only one node.
>
> *ngspice:* ngspice leaves R1 out of the circuit and warns: 'not a valid resistor instance line, ignored!'. [missing-fields-1]
>
> *Fixes:* none

### missing-fields-1. A resistor, capacitor or inductor with one node is left out

```spice
* parts with one node
V1 a 0 6
R2 a 0 3
R1 a
C1 a
L1 a
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                6.000000e+00
        v1#branch                        -2.00000e+00
    Warning: 'r1 a' is not a valid resistor instance line, ignored!
    Warning: 'c1 a' is not a valid capacitor instance line, ignored!
    Warning: 'l1 a' is not a valid inductor instance line, ignored!
  ngspice -b -r out.raw (exit 0)
    rawfile: i(v1) = -2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: i(v1) = -2
```

PlainSpice's checks: `missing-fields`, `missing-fields`, `missing-fields`.

### missing-fields-2. A voltage source with one node stops ngspice

```spice
* a voltage source with one node
V1 a
R1 a 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error in line   v1 a
        Not enough parameters for v source
        line no. 2 from file circuit.cir
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error in line   v1 a
        Not enough parameters
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `missing-fields`.

### missing-fields-3. A current source with one node stops ngspice

```spice
* a current source with one node
I1 a
R1 a 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error in line   i1 a
        Not enough parameters for i source
        line no. 2 from file circuit.cir
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error in line   i1 a
        Not enough parameters
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `missing-fields`.

### missing-fields-4. E with three nodes: native 47 stops, our engine takes the gain for a node

```spice
* E without its control - node
V1 c 0 3
R1 c 0 1
E1 a 0 2
R2 a 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: not enough parameters in line
       e1 a 0 2
        line no 4, file circuit.cir
    No circuit loaded!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit signal SIGSEGV)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error: not enough parameters in line
       e1 a 0 2
    No circuit loaded!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: there aren't any circuits loaded.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, marked unreliable, no results):
    DC solution failed -
    [ngspice lists the last node voltages here]
    Warning: singular matrix:  check node
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Error: Transient op failed, timestep too small
    Error: The operating point could not be simulated successfully.
        Any of the following steps may fail.!
    doAnalyses: OP:  Timestep too small; cause unrecorded.
    run simulation(s) aborted
    vectors: (none)
```

PlainSpice's checks: `missing-fields`.

### missing-fields-5. G with three nodes: the same

```spice
* G without its control - node
V1 c 0 3
R1 c 0 1
G1 0 a 2
R2 a 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: not enough parameters in line
       g1 0 a 2
        line no 4, file circuit.cir
    No circuit loaded!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit signal SIGSEGV)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error: not enough parameters in line
       g1 0 a 2
    No circuit loaded!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: there aren't any circuits loaded.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, marked unreliable, no results):
    DC solution failed -
    [ngspice lists the last node voltages here]
    Warning: singular matrix:  check node
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Error: Transient op failed, timestep too small
    Error: The operating point could not be simulated successfully.
        Any of the following steps may fail.!
    doAnalyses: OP:  Timestep too small; cause unrecorded.
    run simulation(s) aborted
    vectors: (none)
```

PlainSpice's checks: `missing-fields`.

### missing-fields-6. F without a control source: native 47 stops, our engine too

```spice
* F without a control source
V1 c 0 3
R1 c 0 1
F1 0 a
R2 a 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: not enough parameters in line
       f1 0 a
        line no 4, file circuit.cir
    No circuit loaded!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit signal SIGSEGV)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error: not enough parameters in line
       f1 0 a
    No circuit loaded!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: there aren't any circuits loaded.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Fatal error: f1: unknown controlling source
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
    vectors: (none)
```

PlainSpice's checks: `missing-fields`.

### missing-fields-7. F with a number where the control source goes

```spice
* F with its gain but no control source
V1 c 0 3
R1 c 0 1
F1 0 a 5
R2 a 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: not enough parameters in line
       f1 0 a 5
        line no 4, file circuit.cir
    No circuit loaded!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit signal SIGSEGV)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error: not enough parameters in line
       f1 0 a 5
    No circuit loaded!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: there aren't any circuits loaded.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Fatal error: f1: unknown controlling source 5
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
    vectors: (none)
```

PlainSpice's checks: `missing-fields`.

### missing-fields-8. H without a control source: the same

```spice
* H without a control source
V1 c 0 3
R1 c 0 1
H1 a 0 2
R2 a 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: not enough parameters in line
       h1 a 0 2
        line no 4, file circuit.cir
    No circuit loaded!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit signal SIGSEGV)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error: not enough parameters in line
       h1 a 0 2
    No circuit loaded!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: there aren't any circuits loaded.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Fatal error: h1: unknown controlling source 2
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
    vectors: (none)
```

PlainSpice's checks: `missing-fields`.

## control-source

An F or H line whose control source is not a voltage source of the netlist (missing, or another kind of part). V, E and H can be read, and so can a B line with V= (control-source-4); a resistor, an inductor, a capacitor, a current source, an F or G output stop ngspice (control-source-2, -6 to -9, P10c), and a B line with I= gives a singular matrix (control-source-5). Error. Fix: a source with a current to read whose name looks like a typo of the one written.

What PlainSpice shows for control-source-1 (error, line 4):

> **There is no voltage source called V9.** F and H read a current. But SPICE can only read the current through a voltage source. So first, put a 0 V source in the branch you want to measure: the ammeter trick.
>
> *ngspice:* ngspice stops: 'f1: unknown controlling source v9'. [control-source-1, control-source-2, control-source-6]
>
> *Fixes:* none

### control-source-1. F naming a source that does not exist

```spice
* F naming a missing source
V1 c 0 3
R1 c 0 1
F1 0 a V9 2
R2 a 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Fatal error: f1: unknown controlling source v9
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Fatal error: f1: unknown controlling source v9
    doAnalyses: no such parameter on this device
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `control-source`.

### control-source-2. F naming a resistor

```spice
* F naming a resistor
V1 c 0 3
R1 c 0 1
F1 0 a R1 2
R2 a 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Fatal error: f1: unknown controlling source r1
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Fatal error: f1: unknown controlling source r1
    doAnalyses: no such parameter on this device
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `control-source`.

### control-source-3. H naming a source that does not exist

```spice
* H naming a missing source
V1 c 0 3
R1 c 0 1
H1 a 0 V9 2
R2 a 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Fatal error: h1: unknown controlling source v9
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Fatal error: h1: unknown controlling source v9
    doAnalyses: no such parameter on this device
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `control-source`.

### control-source-4. F and H can read the current of E, H and a B line with V= (no trap)

E and H outputs are voltage sources, and so is a B line with V=: each has a branch current that F and H can read, like a V source (P10b, P10d in explanations.md). ngspice runs without a message.

```spice
* F and H reading the current of E, H and a B source with V=
V1 a 0 6
E1 e 0 a 0 1
Re e 0 3
F1 0 p E1 1
Rp p 0 1
Vs a b 0
Rb b 0 6
H1 h 0 Vs 2
Rh h 0 1
H2 k 0 H1 3
Rk k 0 1
B1 c 0 V=2*v(a)
Rc c 0 6
F2 0 q B1 1
Rq q 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        q                                -2.00000e+00
        c                                1.200000e+01
        k                                -6.00000e+00
        h                                2.000000e+00
        b                                6.000000e+00
        p                                -2.00000e+00
        e                                6.000000e+00
        a                                6.000000e+00
        v1#branch                        -1.00000e+00
        vs#branch                        1.000000e+00
        h1#branch                        -2.00000e+00
        h2#branch                        6.000000e+00
        e1#branch                        -2.00000e+00
        b1#branch                        -2.00000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(p) = -2, v(k) = -6, v(q) = -2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(p) = -2, v(k) = -6, v(q) = -2
```

PlainSpice's checks: none.

### control-source-5. A B line with I= has no current to read: singular matrix, then ngspice stops

ngspice accepts the name of a B current source as the control, but there is no branch current behind it: the matrix is singular and the operating point fails.

```spice
* F reading a B source with I=
V1 a 0 6
B1 0 b I=v(a)/6
Rb b 0 6
F1 0 p B1 1
Rp p 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    DC solution failed -
    [ngspice lists the last node voltages here]
    Warning: singular matrix:  check node b1#branch
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Error: Transient op failed, timestep too small
    Error: The operating point could not be simulated successfully.
        Any of the following steps may fail.!
    doAnalyses: OP:  Timestep too small; cause unrecorded.
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no data)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, marked unreliable, no results):
    DC solution failed -
    [ngspice lists the last node voltages here]
    Warning: singular matrix:  check node b1#branch
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Error: Transient op failed, timestep too small
    Error: The operating point could not be simulated successfully.
        Any of the following steps may fail.!
    doAnalyses: OP:  Timestep too small; cause unrecorded.
    run simulation(s) aborted
    vectors: (none)
```

PlainSpice's checks: `control-source`.

### control-source-6. F naming a current source: unknown controlling source

A current source has no branch current of its own, so ngspice does not accept it as the control.

```spice
* F naming a current source
V1 a 0 6
Ra a 0 6
I1 0 b 2
Rb b 0 6
F1 0 p I1 1
Rp p 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Fatal error: f1: unknown controlling source i1
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Fatal error: f1: unknown controlling source i1
    doAnalyses: no such parameter on this device
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Fatal error: f1: unknown controlling source i1
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
    vectors: (none)
```

PlainSpice's checks: `control-source`.

### control-source-7. F naming a capacitor: the same

The same message for a capacitor.

```spice
* F naming a capacitor
V1 a 0 6
C1 a 0 1u
Ra a 0 6
F1 0 p C1 1
Rp p 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Fatal error: f1: unknown controlling source c1
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Fatal error: f1: unknown controlling source c1
    doAnalyses: no such parameter on this device
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Fatal error: f1: unknown controlling source c1
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
    vectors: (none)
```

PlainSpice's checks: `control-source`.

### control-source-8. H naming a G output: the same

G and F outputs are current sources, so they are not accepted either.

```spice
* H naming a G source
V1 a 0 6
Ra a 0 6
G1 0 g a 0 1
Rg g 0 1
H1 h 0 G1 3
Rh h 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Fatal error: h1: unknown controlling source g1
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Fatal error: h1: unknown controlling source g1
    doAnalyses: no such parameter on this device
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Fatal error: h1: unknown controlling source g1
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
    vectors: (none)
```

PlainSpice's checks: `control-source`.

### control-source-9. H naming an F output: the same

The same for an F output.

```spice
* H naming an F source
V1 a 0 6
Vs a b 0
Rb b 0 6
F1 0 f Vs 2
Rf f 0 1
H1 h 0 F1 3
Rh h 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Fatal error: h1: unknown controlling source f1
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Fatal error: h1: unknown controlling source f1
    doAnalyses: no such parameter on this device
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Fatal error: h1: unknown controlling source f1
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
    vectors: (none)
```

PlainSpice's checks: `control-source`.

## missing-title

Line 1 reads as a part whose nodes the rest of the netlist uses (with a value that is a number), or as a known dot command. Warning. Fix: insert a title line `* my circuit` above it.

What PlainSpice shows for missing-title-1 (warning, line 1):

> **Line 1 is the title, so V1 is left out.** SPICE always skips the first line, so make it a title. A part written there would silently disappear.
>
> *ngspice:* ngspice reads line 1 as the title and builds the circuit without V1; it says nothing. [missing-title-1]
>
> *Fixes:* "Add a title line above it"

### missing-title-1. A part on line 1 is the title: it disappears silently

```spice
V1 n1 0 6
R1 n1 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 0
```

PlainSpice's checks: `missing-title`, `dangling-node`.

### missing-title-2. A dot command on line 1 is the title too: it never runs

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
  ngspice -b -r out.raw (exit 0)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 0, no results):
    vectors: (none)
```

PlainSpice's checks: `missing-title`.

## no-ground

No part connects to ground. Error. Fix: rename a node to `0`: the one with a ground-like name (`ground`, `00`, a `gnd` that is not ground, ...), otherwise the - node of the first voltage source.

What PlainSpice shows for no-ground-1 (error, line 2):

> **No ground: no node is called 0.** Without ground, SPICE can't pin the voltages down. It warns about a singular matrix, which means its equations have no single answer, and any numbers it still prints can't be trusted. Every circuit needs one node called 0 (gnd works too).
>
> *ngspice:* ngspice warns 'singular matrix', falls back to a 'transient op' and still prints numbers. They are not the answer: in one test a 6 V source's + node came out at 9.000333 V. [no-ground-1]
>
> *Fixes:* "Make b the ground (rename it to 0)"

### no-ground-1. No node 0: singular matrix, and numbers that are not the answer

```spice
* no ground
V1 a b 6
R1 a b 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                3.000333e+00
        a                                9.000333e+00
        v1#branch                        -3.00000e+00
    Warning: singular matrix:  check node b
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 9.00033307426206, v(b) = 3.0003330742710626
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    the same messages as ngspice 47
    vectors: v(a) = 9.00033307426206, v(b) = 3.0003330742710626
```

PlainSpice's checks: `no-ground`.

### no-ground-2. The same with a current source in the circuit

```spice
* example 1 without a node 0
V1 n1 n3 6
R1 n1 n2 2
R2 n2 n3 4
I1 n3 n2 3
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n2                               4.999722e-01
        n3                               -7.50003e+00
        n1                               -1.50003e+00
        v1#branch                        1.000000e+00
    Warning: singular matrix:  check node n2
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = -1.5000277577273613, v(n3) = -7.500027757734862, v(n2) = 0.499972242269472, i(v1) = 0.9999999999999166
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    the same messages as ngspice 47
    vectors: v(n1) = -1.5000277577273613, v(n3) = -7.500027757734862, v(n2) = 0.499972242269472, i(v1) = 0.9999999999999166
```

PlainSpice's checks: `no-ground`.

## ground-misnamed

The netlist has a ground, and another node has a ground-like name: `ground`, `00`, `earth`, `agnd`, `dgnd`, `gnd0`, or `gnd` as the last word of its line (which ngspice keeps as an ordinary node; numbers-and-syntax.md, W9). Warning. Fix: rename it to `0`.

What PlainSpice shows for ground-misnamed-1 (warning, line 2):

> **ground is not ground: ground is node 0.** In SPICE, ground is the node called 0 (gnd works too). ground is just another node name, so the parts on it are not connected to ground.
>
> *ngspice:* ngspice says nothing and treats ground as an ordinary node. In one test, V1 n1 ground 6 with R1 n1 0 2 gave v(n1) = 0 and no current at all. [ground-misnamed-1, ground-misnamed-3]
>
> *Fixes:* "Rename ground to 0"

### ground-misnamed-1. ground next to 0: two different nodes, silently

```spice
* ground on one part, 0 on the other
V1 n1 ground 6
R1 n1 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        ground                           -6.00000e+00
        n1                               0.000000e+00
        v1#branch                        0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 0, v(ground) = -6, i(v1) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 0, v(ground) = -6, i(v1) = 0
```

PlainSpice's checks: `ground-misnamed`.

### ground-misnamed-2. gnd as the last word of a line is a node called gnd: the ammeter reads 0

```spice
* a 0 V ammeter to gnd
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
  ngspice -b -r out.raw (exit 0)
    rawfile: v(b) = 6, v(gnd) = 6, i(vx) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(b) = 6, v(gnd) = 6, i(vx) = 0
```

PlainSpice's checks: `missing-value`, `ground-misnamed`.

### ground-misnamed-3. 00 next to 0: the same

```spice
* 00 on one part, 0 on the other
V1 n1 00 6
R1 n1 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        V(00)                            -6.00000e+00
        n1                               0.000000e+00
        v1#branch                        0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 0, v(00) = -6, i(v1) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 0, v(00) = -6, i(v1) = 0
```

PlainSpice's checks: `ground-misnamed`.

## dangling-node

A node (not ground, not named in any directive) with exactly one connection, the end of a resistor or inductor. When another node's name looks like a typo of it (one character more or less, or two letters swapped), a warning with up to two rename fixes; otherwise an info note, because an open terminal is how a Thevenin voltage is measured. Voltage-source outputs left open are measurements and raise nothing.

What PlainSpice shows for dangling-node-1 (info, line 4):

> **Only R2 touches n2.** No current flows in R2, so n2 sits at the same voltage as n1. That is right for an open terminal where you measure a voltage; if R2 should connect to something, check this node name.
>
> *ngspice:* ngspice says nothing: R2 carries no current, so it changes nothing else in the circuit. [dangling-node-1]
>
> *Fixes:* none

### dangling-node-1. A resistor with one end on nothing carries no current: ngspice says nothing

```spice
* a node with one connection
V1 n1 0 6
R1 n1 0 2
R2 n1 n2 3
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n2                               6.000000e+00
        n1                               6.000000e+00
        v1#branch                        -3.00000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 6, v(n2) = 6, i(v1) = -3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 6, v(n2) = 6, i(v1) = -3
```

PlainSpice's checks: `dangling-node`.

### dangling-node-2. A typo in a node name (n12 for n2) changes the answer silently: v(n2) is 12 V, not 8 V

```spice
* typo in a node name
V1 n1 0 6
R1 n1 n2 2
R2 n12 0 4
I1 0 n2 3
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n12                              0.000000e+00
        n2                               1.200000e+01
        n1                               6.000000e+00
        v1#branch                        3.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n2) = 12
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n2) = 12
```

PlainSpice's checks: `dangling-node`.

## floating-dc

A group of nodes with no DC path to ground: what touches it are capacitors, the control nodes of E and G, MOSFET gates, or parts joining only the group's own nodes. Error. For capacitors and gates the fix adds a 1 GΩ resistor to ground. Not raised when every analysis is `.tran ... uic` and only capacitors reach the group (floating-dc-6). ngspice's warning names one node, which the check quotes only when it is the only node with no DC path: in a larger group, or beside another group, ngspice may name any of them (floating-dc-7, -8, -10). Control inputs alone stop ngspice (floating-dc-4); joined by a resistor, they get numbers that can't be trusted (floating-dc-9).

What PlainSpice shows for floating-dc-1 (error, line 3):

> **b has no DC path to ground.** At DC a capacitor is an open circuit, so nothing connects b to ground. SPICE can't pin its voltage down: its equations have no single answer. Engineers often add a very large resistor (1 GΩ) from such a node to ground: it gives SPICE a DC path and changes almost nothing else.
>
> *ngspice:* ngspice warns 'singular matrix: check node b', falls back to a 'transient op' and still prints numbers. They can't be trusted: in one test a node that is 3 V at DC came out at 0.0887 V. [floating-dc-1, floating-dc-2, floating-dc-3, floating-dc-5]
>
> *Fixes:* "Add a 1 GΩ resistor from b to ground"

### floating-dc-1. A node between two capacitors has no DC path: singular matrix

```spice
* a node connected only to capacitors
V1 a 0 6
C1 a b 1u
C2 b 0 1u
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                3.000000e+00
        a                                6.000000e+00
        v1#branch                        -2.44427e-12
    Warning: singular matrix:  check node b
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  ngspice -b -r out.raw (exit 0)
    rawfile: v(b) = 2.9999999999819513
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    the same messages as ngspice 47
    vectors: v(b) = 2.9999999999819513
```

PlainSpice's checks: `floating-dc`.

### floating-dc-2. Next to a divider the numbers are wrong: v(c) = 0.0887 V for a node that is 3 V at DC

```spice
* a capacitor-only node next to a divider
V1 a 0 6
R1 a c 1k
C1 c b 1u
C2 b 0 2u
R2 c 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                2.955447e-02
        c                                8.866340e-02
        a                                6.000000e+00
        v1#branch                        -5.91134e-03
    Warning: singular matrix:  check node b
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  ngspice -b -r out.raw (exit 0)
    rawfile: v(c) = 0.08866339997380636
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    the same messages as ngspice 47
    vectors: v(c) = 0.08866339997380636
```

PlainSpice's checks: `floating-dc`.

### floating-dc-3. A resistor with both ends on nothing: singular matrix

```spice
* a resistor whose two nodes connect to nothing else
V1 n1 0 6
R1 n1 0 2
R2 n3 n4 3
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n4                               0.000000e+00
        n3                               0.000000e+00
        n1                               6.000000e+00
        v1#branch                        -3.00000e+00
    Warning: singular matrix:  check node n3
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 5.9999999999939995, v(n3) = 0, v(n4) = 0, i(v1) = -2.9999999999939995
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    the same messages as ngspice 47
    vectors: v(n1) = 5.9999999999939995, v(n3) = 0, v(n4) = 0, i(v1) = -2.9999999999939995
```

PlainSpice's checks: `floating-dc`.

### floating-dc-4. A control node with nothing else on it: singular matrix, then ngspice stops

```spice
* a control node with nothing else
V1 a 0 6
R1 a 0 2
E1 out 0 c 0 2
R2 out 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    DC solution failed -
    [ngspice lists the last node voltages here]
    Warning: singular matrix:  check node c
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Error: Transient op failed, timestep too small
    Error: The operating point could not be simulated successfully.
        Any of the following steps may fail.!
    doAnalyses: OP:  Timestep too small; cause unrecorded.
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, marked unreliable, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `floating-dc`.

### floating-dc-5. A MOSFET gate with nothing else on it: singular matrix

```spice
* a MOSFET with a floating gate
V1 d 0 5
R1 d dd 1k
M1 dd g 0 0 nm
.model nm nmos level=1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        g                                0.000000e+00
        dd                               5.000000e+00
        d                                5.000000e+00
        v1#branch                        -1.00100e-11
    Warning: singular matrix:  check node g
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  ngspice -b -r out.raw (exit 0)
    rawfile: v(d) = 4.9999999999949996, v(dd) = 4.999999989985, v(g) = 0, i(v1) = -1.000999977351924e-11
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    the same messages as ngspice 47
    vectors: v(d) = 4.9999999999949996, v(dd) = 4.999999989985, v(g) = 0, i(v1) = -1.000999977351924e-11
```

PlainSpice's checks: `floating-dc`.

### floating-dc-6. With .tran ... uic the capacitor-only node is fine (no trap)

```spice
* a capacitor-only node, tran with uic
V1 a 0 6
C1 a b 1u
C2 b 0 1u
.tran 1u 10u uic
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(b): 66 points, last 2.9999999999999996
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(b): 66 points, last 2.9999999999999996
our engine (wasm), as ngspice -b -r (exit 0):
    Operating point simulation skipped by 'uic',
      now using transient initial conditions.
    vectors: v(b): 66 points, last 2.9999999999999996
```

PlainSpice's checks: no trap.

### floating-dc-7. In a group of two nodes ngspice may name either one: check node x, not node1

node1 and x have no DC path: C1 and C2 are open at DC, and R1 joins only the two of them. ngspice's
warning names x, the second of them in the netlist, so the check quotes a node only when it is the
only node with no DC path (floating-dc-1, -4, -5, M2d); here it says ngspice names one of them
(second critic of the words re-check's fix, 12 November 2026). In floating-dc-3 it names the first, n3.

```spice
* a floating group of two nodes: ngspice names x, not node1
V1 in 0 5
C1 in node1 1u
R1 node1 x 1k
C2 x 0 1u
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        x                                4.950332e-02
        node1                            4.950497e+00
        in                               5.000000e+00
        v1#branch                        -4.90099e-03
    Warning: singular matrix:  check node x
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 4.9999999999949996, v(node1) = 4.950496683061028, v(x) = 0.04950331688396305, i(v1) = -0.0049009933711090525
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    the same messages as ngspice 47
    vectors: v(in) = 4.9999999999949996, v(node1) = 4.950496683061028, v(x) = 0.04950331688396305, i(v1) = -0.0049009933711090525
```

PlainSpice's checks: `floating-dc` (ngspice "names one of the nodes with no DC path", never "check node node1").

### floating-dc-8. With two nodes that have no DC path, ngspice names only one of them: check node a

a and b each sit between two capacitors, two separate groups. ngspice warns about a only; with the
lines for b written first, it warns about b only (the same run otherwise). So each group's check
says ngspice names one of the nodes with no DC path, never "check node b" for b's group.

```spice
* two capacitor-only nodes
V1 in 0 6
C1 in a 1u
C2 a 0 1u
C3 in b 1u
C4 b 0 1u
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                3.000000e+00
        a                                3.000000e+00
        in                               6.000000e+00
        v1#branch                        -4.88853e-12
    Warning: singular matrix:  check node a
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5.9999999999939995, v(a) = 2.9999999999819513, v(b) = 2.9999999999819513, i(v1) = -4.888534022029489e-12
  with C3 and C4 written before C1 and C2: Warning: singular matrix:  check node b, and the same values
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    the same messages as ngspice 47
    vectors: v(in) = 5.9999999999939995, v(a) = 2.9999999999819513, v(b) = 2.9999999999819513, i(v1) = -4.888534022029489e-12
```

PlainSpice's checks: `floating-dc`, `floating-dc` (one for a, one for b).

### floating-dc-9. Two control nodes joined by a resistor: singular matrix, but ngspice prints numbers

E1's control input reads c and d, and R3 joins only the two of them, so nothing sets their voltage.
Unlike a control node with nothing else on it (floating-dc-4), ngspice does not stop here: its
'transient op' finishes and it prints numbers, which mean nothing for c and d. So the check says
ngspice "either stops or prints numbers that can't be trusted" (second critic of the words re-check's
fix, 12 November 2026; it said that ngspice stops).

```spice
* a control input on two nodes joined only by a resistor
V1 a 0 6
R1 a 0 2
E1 out 0 c d 2
R2 out 0 1
R3 c d 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        d                                0.000000e+00
        c                                0.000000e+00
        out                              0.000000e+00
        a                                6.000000e+00
        v1#branch                        -3.00000e+00
        e1#branch                        0.000000e+00
    Warning: singular matrix:  check node c
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 5.9999999999939995, v(out) = 0, v(c) = 0, v(d) = 0, i(e1) = 0, i(v1) = -2.9999999999939995
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    the same messages as ngspice 47
    vectors: v(a) = 5.9999999999939995, v(out) = 0, v(c) = 0, v(d) = 0, i(e1) = 0, i(v1) = -2.9999999999939995
```

PlainSpice's checks: `floating-dc`.

### floating-dc-10. Two control nodes with nothing else on them: ngspice names d only, then stops

c and d are each a group of their own, as in floating-dc-4. ngspice warns about d only, not c, and
stops as it does there.

```spice
* a control input on two nodes with nothing else on them
V1 a 0 6
R1 a 0 2
E1 out 0 c d 2
R2 out 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    DC solution failed -
    [ngspice lists the last node voltages here]
    Warning: singular matrix:  check node d
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Error: Transient op failed, timestep too small
    Error: The operating point could not be simulated successfully.
        Any of the following steps may fail.!
    doAnalyses: OP:  Timestep too small; cause unrecorded.
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: an Operating Point plot with 0 points (no results)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, marked unreliable, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `floating-dc`, `floating-dc` (one for c, one for d).

## current-source-no-path

A floating group (as in floating-dc) that a current source touches: I, the output of F or G, or a B source with I=. Error. What ngspice does depends on what else is there, so the text says which case it is.

What PlainSpice shows for current-source-no-path-1 (error, line 4):

> **I1's current has nowhere to go.** A current source pushes its current through whatever it is connected to. Here b has no DC path back to ground (a capacitor is an open circuit at DC), so the current has nowhere to go and the voltage there is not defined.
>
> *ngspice:* ngspice warns 'singular matrix', falls back to a 'transient op' and prints numbers that can't be trusted. [current-source-no-path-1]
>
> *Fixes:* none

### current-source-no-path-1. A current source in series with a capacitor: singular matrix

```spice
* a current source in series with a capacitor
V1 a 0 5
R1 a c 1k
I1 c b 1m
C1 b 0 1u
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                1.000000e-02
        c                                4.000000e+00
        a                                5.000000e+00
        v1#branch                        -1.00000e-03
    Warning: singular matrix:  check node b
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  ngspice -b -r out.raw (exit 0)
    rawfile: v(b) = 0.009999999999950042
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    the same messages as ngspice 47
    vectors: v(b) = 0.009999999999950042
```

PlainSpice's checks: `current-source-no-path`.

### current-source-no-path-2. Two different current sources in series: silently as if 1 Ω to ground

```spice
* two different current sources in series
I1 0 n1 1m
I2 n1 0 2m
R1 n2 0 1k
V1 n2 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n2                               1.000000e+00
        n1                               -1.00000e-03
        v1#branch                        -1.00000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = -0.001
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = -0.001
```

PlainSpice's checks: `current-source-no-path`.

### current-source-no-path-3. A current source into a node with nothing else: 1 A gives 1 V, silently

```spice
* a current source into a node with nothing else
I1 0 n1 1
V1 n2 0 1
R1 n2 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n2                               1.000000e+00
        n1                               1.000000e+00
        v1#branch                        -1.00000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 1
```

PlainSpice's checks: `current-source-no-path`.

### current-source-no-path-4. A G output into a node with nothing else: singular matrix, then ngspice stops

```spice
* a G output into a node with nothing else
V1 c 0 3
R1 c 0 1
G1 0 g c 0 0.5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    DC solution failed -
    [ngspice lists the last node voltages here]
    Warning: singular matrix:  check node g
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Error: Transient op failed, timestep too small
    Error: The operating point could not be simulated successfully.
        Any of the following steps may fail.!
    doAnalyses: OP:  Timestep too small; cause unrecorded.
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, marked unreliable, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `current-source-no-path`.

### current-source-no-path-5. An F output into a node with nothing else: the same

```spice
* an F output into a node with nothing else
V1 c 0 3
Vx c d 0
R1 d 0 1
F1 0 f Vx 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    DC solution failed -
    [ngspice lists the last node voltages here]
    Warning: singular matrix:  check node f
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Error: Transient op failed, timestep too small
    Error: The operating point could not be simulated successfully.
        Any of the following steps may fail.!
    doAnalyses: OP:  Timestep too small; cause unrecorded.
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, marked unreliable, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `current-source-no-path`.

## voltage-loop

A loop made only of voltage sources (V, and the outputs of E and H) and inductors, which are wires at DC; a part with both ends on one node counts. Reported at the part that closes the loop. Error. Loops through an inductor are not raised when every analysis is `.tran ... uic` (voltage-loop-6); loops of sources still fail then (voltage-loop-7).

What PlainSpice shows for voltage-loop-1 (error, line 3):

> **V1 and V2 are in parallel.** Two voltage sources in parallel each insist on their own voltage, and even equal ones leave SPICE unable to split the current between them: its equations have no single answer.
>
> *ngspice:* ngspice warns 'singular matrix' and then stops: 'The operating point could not be simulated successfully'. No results. [voltage-loop-1, voltage-loop-2, voltage-loop-3, voltage-loop-4]
>
> *Fixes:* none

### voltage-loop-1. Two different voltage sources in parallel: ngspice stops

```spice
* two different voltage sources in parallel
V1 n1 0 5
V2 n1 0 3
R1 n1 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    DC solution failed -
    [ngspice lists the last node voltages here]
    Warning: singular matrix:  check node v1#branch
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Error: Transient op failed, timestep too small
    Error: The operating point could not be simulated successfully.
        Any of the following steps may fail.!
    doAnalyses: OP:  Timestep too small; cause unrecorded.
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, marked unreliable, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `voltage-loop`.

### voltage-loop-2. Two equal ones too

```spice
* two equal voltage sources in parallel
V1 n1 0 5
V2 n1 0 5
R1 n1 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    DC solution failed -
    [ngspice lists the last node voltages here]
    Warning: singular matrix:  check node v1#branch
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Error: Transient op failed, timestep too small
    Error: The operating point could not be simulated successfully.
        Any of the following steps may fail.!
    doAnalyses: OP:  Timestep too small; cause unrecorded.
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, marked unreliable, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `voltage-loop`.

### voltage-loop-3. A voltage source shorted by a 0 V source

```spice
* a voltage source shorted by a 0 V source
V1 n1 0 5
Vshort n1 0 0
R1 n1 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    DC solution failed -
    [ngspice lists the last node voltages here]
    Warning: singular matrix:  check node v1#branch
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Error: Transient op failed, timestep too small
    Error: The operating point could not be simulated successfully.
        Any of the following steps may fail.!
    doAnalyses: OP:  Timestep too small; cause unrecorded.
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, marked unreliable, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `voltage-loop`.

### voltage-loop-4. An E output across a voltage source

```spice
* an E output across a voltage source
V1 a 0 6
R1 a 0 2
E1 a 0 a 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    DC solution failed -
    [ngspice lists the last node voltages here]
    Warning: singular matrix:  check node v1#branch
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Error: Transient op failed, timestep too small
    Error: The operating point could not be simulated successfully.
        Any of the following steps may fail.!
    doAnalyses: OP:  Timestep too small; cause unrecorded.
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, marked unreliable, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `voltage-loop`.

### voltage-loop-5. An inductor across a voltage source: singular matrix, numbers that cannot be trusted

```spice
* an inductor across a voltage source
V1 a 0 6
R1 a 0 2
L1 a 0 1m
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                6.000000e+00
        v1#branch                        -3.06000e+00
        l1#branch                        6.000000e-02
    Warning: singular matrix:  check node l1#branch
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  ngspice -b -r out.raw (exit 0)
    rawfile: i(l1) = 0.05999999999994027
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    the same messages as ngspice 47
    vectors: i(l1) = 0.05999999999994027
```

PlainSpice's checks: `voltage-loop`.

### voltage-loop-6. With .tran ... uic the inductor is fine (no trap)

```spice
* an inductor across a voltage source, tran with uic
V1 a 0 6
R1 a 0 2
L1 a 0 1m
.tran 1u 10u uic
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: i(l1): 61 points, last 0.060000000000000386
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: i(l1): 61 points, last 0.06000000000000038
our engine (wasm), as ngspice -b -r (exit 0):
    Operating point simulation skipped by 'uic',
      now using transient initial conditions.
    vectors: i(l1): 61 points, last 0.060000000000000386
```

PlainSpice's checks: no trap.

### voltage-loop-7. Two voltage sources in parallel fail with .tran ... uic too

```spice
* two voltage sources in parallel, tran with uic
V1 a 0 5
V2 a 0 3
R1 a 0 1k
.tran 1u 10u uic
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Warning: singular matrix:  check node v1#branch
    doAnalyses: TRAN:  Timestep too small; initial timepoint: cause unrecorded.
    run simulation(s) aborted
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Warning: singular matrix:  check node v1#branch
    doAnalyses: TRAN:  Timestep too small; initial timepoint: cause unrecorded.
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, marked unreliable, no results):
    Operating point simulation skipped by 'uic',
      now using transient initial conditions.
    Warning: singular matrix:  check node v1#branch
    doAnalyses: TRAN:  Timestep too small; initial timepoint: cause unrecorded.
    run simulation(s) aborted
    vectors: (none)
```

PlainSpice's checks: `voltage-loop`.

### voltage-loop-8. A voltage source with both ends on one node: ngspice stops

```spice
* a voltage source with both ends on one node
V1 a 0 6
R1 a 0 2
V2 a a 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Fatal error: instance v2 is a shorted VSRC
    doAnalyses: operation not supported
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `voltage-loop`.

### voltage-loop-9. An E output with both ends on one node

```spice
* an E output with both ends on one node
V1 a 0 6
R1 a 0 2
E1 a a a 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Fatal error: instance e1 is a shorted VCVS
    doAnalyses: operation not supported
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `voltage-loop`.

### voltage-loop-10. An H output with both ends on one node

```spice
* an H output with both ends on one node
V1 a 0 6
Vx a b 0
R1 b 0 2
H1 a a Vx 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Fatal error: instance h1 is a shorted CCVS
    doAnalyses: operation not supported
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `voltage-loop`.

### voltage-loop-11. An inductor with both ends on one node: singular matrix

```spice
* an inductor with both ends on one node
V1 a 0 6
R1 a 0 2
L1 a a 1m
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                6.000000e+00
        v1#branch                        -3.00000e+00
        l1#branch                        0.000000e+00
    Warning: singular matrix:  check node l1#branch
    Note: Starting dynamic gmin stepping
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 5.9999999999939995, i(l1) = 0, i(v1) = -2.9999999999939995
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    the same messages as ngspice 47
    vectors: v(a) = 5.9999999999939995, i(l1) = 0, i(v1) = -2.9999999999939995
```

PlainSpice's checks: `voltage-loop`.

## duplicate-name

Two parts with the same name, ignoring case, in the same scope (the main circuit, or one subcircuit). Error, at the later one. Fix: rename it to the next free name (`R1` to `R2`, or `R3` when R2 is taken).

What PlainSpice shows for duplicate-name-1 (error, line 4):

> **Two parts are called R1.** Every part needs its own name, and SPICE ignores capital letters, so R1 and r1 count as the same name.
>
> *ngspice:* ngspice stops at the second one: 'device already exists, bail out'. [duplicate-name-1, duplicate-name-2]
>
> *Fixes:* "Rename it R2"

### duplicate-name-1. Two parts called R1

```spice
* two resistors both named R1
V1 n1 0 6
R1 n1 0 2
R1 n1 0 4
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
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      r1 n1 0 4
    device already exists, bail out
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `duplicate-name`.

### duplicate-name-2. R1 and r1 are the same name

```spice
* R1 and r1
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
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      r1 n1 0 4
    device already exists, bail out
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `duplicate-name`.

### duplicate-name-3. Rş and Rç are the same name too: ngspice spells both r__

Added after the final reviews of 12 November 2026. ngspice writes each byte of a letter outside ASCII
as `_` (W18 in numbers-and-syntax.md), so `Rş` and `Rç` are both `r__`, and it stops at the second.

What PlainSpice shows for duplicate-name-3 (error, line 4):

> **Rş and Rç are the same name for ngspice.** Every part needs its own name. ngspice writes each letter other than a to z (or A to Z) in a name as underscores, so Rş and Rç are both r__.
>
> *ngspice:* ngspice stops at the second one: 'device already exists, bail out'. [duplicate-name-3]
>
> *Fixes:* "Rename it Rc"

```spice
* two part names that become one
V1 a 0 6
Rş a 0 2
Rç a 0 3
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      r__ a 0 3
    device already exists, bail out
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      r__ a 0 3
    device already exists, bail out
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `duplicate-name`.

## unknown-letter

Lines ngspice cannot read as the part the student meant: a first character that is no part letter; a line starting with `@` (ngspice silently stops reading there); A and N lines, which PlainSpice's engine leaves out; and letters beginners use for something else, when what the letter needs is missing: W (a current-controlled switch, not a wire), S, T (a transmission line, not a transformer), U, Y, Z, P, K. Error. Fixes: make the line a comment; for `W1 a b`, a 0 V source as the wire (unknown-letter-9).

What PlainSpice shows for unknown-letter-1 (error, line 4):

> **SPICE can't read a line starting with 2.** Every part line starts with a letter that says what the part is: R for a resistor, V for a voltage source, and so on. A line starting with 2 is not a part. To keep it as a note, start it with * to make it a comment.
>
> *ngspice:* ngspice stops: 'unknown device type - error'. [unknown-letter-1, unknown-letter-2]
>
> *Fixes:* "Make the line a comment"

### unknown-letter-1. A line starting with a digit (a note without *) stops ngspice

```spice
* a note without a star
V1 a 0 6
R1 a 0 2
2 resistors in parallel
R2 a 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      2 resistors in parallel
     unknown device type - error
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      2 resistors in parallel
     unknown device type - error
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `unknown-letter`.

### unknown-letter-2. So does a line starting with a non-ASCII letter

```spice
* a non-ASCII first letter
V1 a 0 6
R1 a 0 2
Ω1 a 0 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      __1 a 0 5
     unknown device type - error
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      __1 a 0 5
     unknown device type - error
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `unknown-letter`.

### unknown-letter-3. A line starting with { is a fatal error

```spice
* a line starting with a brace
V1 a 0 6
R1 a 0 2
{1 a 0 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error in netlist line no. 5, new internal line no. 4:
    Closing "}" not found in line fragment
        {1 a 0 5.
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Netlist line no. 4:
    Closing "}" not found in line fragment
        {1 a 0 5.
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `unknown-letter`.

### unknown-letter-4. A line starting with @ silently ends the netlist: nothing runs

```spice
* a line starting with @
V1 n1 0 6
R2 n1 0 3
@ note: R1 below
R1 n1 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 0, no results):
    vectors: (none)
```

PlainSpice's checks: `unknown-letter`.

### unknown-letter-5. A first line starting with @: nothing is read at all

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
  ngspice -b -r out.raw (exit signal SIGSEGV)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: there aren't any circuits loaded.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error: there aren't any circuits loaded.
    vectors: (none)
```

PlainSpice's checks: `unknown-letter`.

### unknown-letter-6. An A line (XSPICE): native 47 runs it, our engine does not

```spice
* an XSPICE gain block
V1 a 0 6
R1 b 0 1k
A1 a b gainmod
.model gainmod gain(gain=2)
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                1.200000e+01
        a                                6.000000e+00
        a1#branch_1_0                    -1.20000e-02
        v1#branch                        0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 6, v(b) = 12, i(v1) = 0, i(a1) = -0.012
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      a1 a b gainmod
     unknown device type - error
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-letter`.

### unknown-letter-7. An N line (OSDI): our engine does not know the letter

```spice
* an OSDI device line
V1 a 0 6
R1 b 0 1k
N1 a b vamod
.model vamod resistor r=1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      n1 a b vamod
    incorrect model type! Expected OSDI device
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      n1 a b vamod
    incorrect model type! Expected OSDI device
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      n1 a b vamod
     unknown device type - error
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-letter`.

### unknown-letter-8. W meant as a wire: W is a current-controlled switch

```spice
* W meant as a wire
V1 a 0 6
R1 b 0 2
W1 a b
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      w1 a b
    Unable to find definition of model
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      w1 a b
    Unable to find definition of model
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `unknown-letter`.

### unknown-letter-9. The same line with a 0 V source as the wire runs

```spice
* a 0 V source as a wire
V1 a 0 6
R1 b 0 2
VW1 a b 0
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                6.000000e+00
        a                                6.000000e+00
        v1#branch                        -3.00000e+00
        vw1#branch                       3.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(b) = 6, i(vw1) = 3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(b) = 6, i(vw1) = 3
```

PlainSpice's checks: no trap.

### unknown-letter-10. S without a model

```spice
* S meant as a switch
V1 a 0 6
R1 b 0 2
S1 a b
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      s1 a b
    Unable to find definition of model
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      s1 a b
    Unable to find definition of model
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `unknown-letter`.

### unknown-letter-11. T meant as a transformer: T is a transmission line

```spice
* T meant as a transformer
V1 a 0 6
R1 b 0 2
T1 a 0 b 0
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Fatal error: t1: transmission line z0 must be given
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Fatal error: t1: transmission line z0 must be given
    doAnalyses: no such parameter on this device
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `unknown-letter`.

### unknown-letter-12. K meant as a constant: K couples two inductors

```spice
* K meant as a constant
V1 a 0 6
R1 a 0 2
K1 a 0 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Fatal error: k1: coupling to non-existent inductor a.
    doAnalyses: not found
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `unknown-letter`.

### unknown-letter-13. U, Y, Z and P need a .model line too (U shown)

```spice
* U without a model
V1 a 0 6
R1 a 0 2
U1 a 0 b
R2 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      u1 a 0 b
    Unable to find definition of model
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      u1 a 0 b
    Unable to find definition of model
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `unknown-letter`.

### unknown-letter-14. Y without a model

```spice
* Y without a model
V1 a 0 6
R1 a 0 2
Y1 a 0 b 0
R2 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      y1 a 0 b 0
    model name is not found
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      y1 a 0 b 0
    model name is not found
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `unknown-letter`.

### unknown-letter-15. Z without a model

```spice
* Z without a model
V1 a 0 6
R1 a b 2
Z1 b a 0
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      z1 b a 0
    Unable to find definition of model
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      z1 b a 0
    Unable to find definition of model
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `unknown-letter`.

### unknown-letter-16. P without a model

```spice
* P without a model
V1 a 0 6
R1 a 0 2
P1 a 0 b 0
R2 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      p1 a 0 b 0
    model name is not found
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      p1 a 0 b 0
    model name is not found
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `unknown-letter`.

### unknown-letter-17. P1 a 0 5: ngspice takes 5 for the model name

The P parser counts the words after the name and reads lines in pairs; with three words it takes the third for the model name.

```spice
first-letter test [P]
Rref a 0 1
P1 a 0 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      p1 a 0 5
    Unable to find definition of model 5
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      p1 a 0 5
    Unable to find definition of model 5
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 3 or its substitute:
      p1 a 0 5
    Unable to find definition of model 5
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-letter`.

## missing-model

A diode, BJT, JFET or MOSFET whose model is not defined by a .model line. Error. Fix (diodes only): add `.model dmod D`, a standard diode (missing-model-3).

What PlainSpice shows for missing-model-1 (error, line 4):

> **D1 needs a .model line.** The behaviour of a diode comes from a .model line, and the part line names it after the nodes, for example D1 anode cathode dmod with .model dmod D.
>
> *ngspice:* ngspice stops: 'could not find a valid modelname'. [missing-model-1, missing-model-2, missing-model-4, missing-model-5, missing-model-6]
>
> *Fixes:* "Add .model dmod D (a standard diode)"

### missing-model-1. A diode with no model name

```spice
* a diode with no model
V1 a 0 6
R1 a b 1k
D1 b 0
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      d1 b 0
    could not find a valid modelname
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      d1 b 0
    could not find a valid modelname
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `missing-model`.

### missing-model-2. A diode naming a model with no .model line

```spice
* a diode with no .model line
V1 a 0 6
R1 a b 1k
D1 b 0 dmod
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'dmod' from line
        d1 b 0 dmod
    Error on line 4 or its substitute:
      d1 b 0 dmod
    could not find a valid modelname
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'dmod' from line
        d1 b 0 dmod
    Error on line 4 or its substitute:
      d1 b 0 dmod
    could not find a valid modelname
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `missing-model`.

### missing-model-3. The diode with .model dmod D runs

```spice
* a diode with its .model line
V1 a 0 6
R1 a b 1k
D1 b 0 dmod
.model dmod D
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                6.982620e-01
        a                                6.000000e+00
        v1#branch                        -5.30174e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(b) = 0.6982620329744134
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(b) = 0.6982620329744134
```

PlainSpice's checks: no trap.

### missing-model-4. A BJT naming a model with no .model line

```spice
* a BJT with no .model line
V1 a 0 6
R1 a c 1k
R2 a b 100k
Q1 c b 0 qmod
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'qmod' from line
        q1 c b 0 qmod
    Error on line 5 or its substitute:
      q1 c b 0 qmod
    could not find a valid modelname
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'qmod' from line
        q1 c b 0 qmod
    Error on line 5 or its substitute:
      q1 c b 0 qmod
    could not find a valid modelname
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `missing-model`.

### missing-model-5. A MOSFET naming a model with no .model line

```spice
* a MOSFET with no .model line
V1 d 0 5
V2 g 0 2
R1 d dd 1k
M1 dd g 0 0 nm
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'nm' from line
        m1 dd g 0 0 nm
    Error on line 5 or its substitute:
      m1 dd g 0 0 nm
    could not find a valid modelname
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'nm' from line
        m1 dd g 0 0 nm
    Error on line 5 or its substitute:
      m1 dd g 0 0 nm
    could not find a valid modelname
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `missing-model`.

### missing-model-6. A JFET naming a model with no .model line

```spice
* a JFET with no .model line
V1 d 0 5
R1 d dd 1k
J1 dd 0 0 jm
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'jm' from line
        j1 dd 0 0 jm
    Error on line 4 or its substitute:
      j1 dd 0 0 jm
    Unable to find definition of model jm
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'jm' from line
        j1 dd 0 0 jm
    Error on line 4 or its substitute:
      j1 dd 0 0 jm
    Unable to find definition of model jm
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `missing-model`.

### missing-model-7. A number where the diode model goes (D1 a 0 5) is no model name

A diode has no value; ngspice reads the 5 as the model name and finds no such model. The fix names a standard model, dmod.

```spice
first-letter test [D]
Rref a 0 1
D1 a 0 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      d1 a 0 5
    could not find a valid modelname
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      d1 a 0 5
    could not find a valid modelname
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 3 or its substitute:
      d1 a 0 5
    could not find a valid modelname
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `missing-model`.

## missing-subcircuit

An X line whose subcircuit is not defined by `.subckt`. Error.

What PlainSpice shows for missing-subcircuit-1 (error, line 4):

> **X1 needs a .subckt definition.** A line starting with X uses a subcircuit, defined between .subckt amp ... and .ends. This netlist has no such definition.
>
> *ngspice:* ngspice stops: 'unknown subckt'. [missing-subcircuit-1]
>
> *Fixes:* none

### missing-subcircuit-1. An X line with no .subckt

```spice
* a subcircuit call with no definition
V1 a 0 6
R1 a b 1k
X1 b 0 amp
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: unknown subckt: x1 b 0 amp
        in line no. 4 from file circuit.cir
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit signal SIGSEGV)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error: unknown subckt: x1 b 0 amp
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: there aren't any circuits loaded.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error: unknown subckt: x1 b 0 amp
        in line no. 4 from file circuit.cir
        Simulation interrupted due to error!
    Error: there aren't any circuits loaded.
    vectors: (none)
```

PlainSpice's checks: `missing-subcircuit`.

## model-not-in-engine

A part using a .model whose type and level select a model PlainSpice's engine leaves out (engine/build.sh, `REMOVED_MODELS`; the level map is ngspice 47's inpdomod.c): MOSFET levels 4, 5, 8/49 (BSIM3), 14/54 (BSIM4), 10/58, 55-57, 60, 68, 73; BJT level 8 (HICUM2); JFET level 2 (JFET2); and every O line (LTRA). A .model nothing uses is harmless (model-not-in-engine-6). Error.

What PlainSpice shows for model-not-in-engine-1 (error, line 4):

> **PlainSpice's engine has no BSIM3 model.** level=49 in .model nm selects BSIM3, a model for chip design. PlainSpice's engine leaves it out (its licence terms differ from ngspice's), and first- and second-year circuits don't need it: level=1 is the classic MOSFET model.
>
> *ngspice:* Native ngspice 47 runs it; PlainSpice's engine stops: 'could not find a valid modelname'. [model-not-in-engine-1, model-not-in-engine-2, model-not-in-engine-3, model-not-in-engine-4]
>
> *Fixes:* none

### model-not-in-engine-1. A BSIM3 MOSFET (level=49): native 47 runs it, our engine does not

```spice
* a BSIM3 MOSFET
V1 d 0 1
V2 g 0 1
M1 d g 0 0 nm l=1u w=1u
.model nm nmos level=49
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Warning -- Version not specified on line "level=49"
    Setting version to 'default'.
        g                                1.000000e+00
        d                                1.000000e+00
        v1#branch                        -1.01000e-12
        v2#branch                        0.000000e+00
    Checking parameters for BSIM 3.3 model nm
    Warning: Pd = 0 is less than W.
    Warning: Ps = 0 is less than W.
  ngspice -b -r out.raw (exit 0)
    rawfile: v(d) = 1, v(g) = 1, i(v2) = 0, i(v1) = -1.010001621521459e-12
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Warning -- Version not specified on line "level=49"
    Setting version to 'default'.
    Error on line 4 or its substitute:
      m1 d g 0 0 nm l=1u w=1u
    could not find a valid modelname
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `model-not-in-engine`.

### model-not-in-engine-2. A BSIM4 MOSFET (level=54): the same

```spice
* a BSIM4 MOSFET
V1 d 0 1
V2 g 0 1
M1 d g 0 0 nm l=1u w=1u
.model nm nmos level=54
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Warning -- Version not specified on line "level=54"
    Setting version to 'default'.
        g                                1.000000e+00
        d                                1.000000e+00
        v1#branch                        -1.16140e-04
        v2#branch                        0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(d) = 1, v(g) = 1, i(v2) = 0, i(v1) = -0.00011613986288662011
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Warning -- Version not specified on line "level=54"
    Setting version to 'default'.
    Error on line 4 or its substitute:
      m1 d g 0 0 nm l=1u w=1u
    could not find a valid modelname
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `model-not-in-engine`.

### model-not-in-engine-3. A HICUM BJT (npn level=8)

```spice
* a HICUM BJT
V1 c 0 1
V2 b 0 0.7
Q1 c b 0 qm
.model qm npn level=8
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                7.000000e-01
        c                                1.000000e+00
        v1#branch                        -5.66319e-05
        v2#branch                        -5.67035e-07
  ngspice -b -r out.raw (exit 0)
    rawfile: v(c) = 1, v(b) = 0.7000000000000001, i(v2) = -5.670354770422316e-7, i(v1) = -0.00005663194265568923
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      q1 c b 0 qm
    Unable to find definition of given model
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `model-not-in-engine`.

### model-not-in-engine-4. A JFET2 JFET (njf level=2)

```spice
* a JFET2 JFET
V1 d 0 1
V2 g 0 0
J1 d g 0 jm
.model jm njf level=2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        g                                0.000000e+00
        d                                1.000000e+00
        v1#branch                        -2.86863e-04
        v2#branch                        1.010000e-12
  ngspice -b -r out.raw (exit 0)
    rawfile: v(d) = 1, v(g) = 0, i(v2) = 1.01e-12, i(v1) = -0.0002868630248901369
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      j1 d g 0 jm
    Unknown device type for model jm
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `model-not-in-engine`.

### model-not-in-engine-5. An O line (LTRA)

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
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 1, v(b) = 0.6666666666666667, v(c) = 0.3333333333333334, v(o1#i1) = 0.3333333333333333, v(o1#i2) = -0.3333333333333334, i(v1) = -0.33333333333333326
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      o1 b 0 c 0 lmod
    Device type LossyXmissionLine not supported by this binary
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `model-not-in-engine`.

### model-not-in-engine-6. An unused BSIM3 .model line is harmless (no trap)

```spice
* an unused BSIM3 model
V1 a 0 1
R1 a 0 1
.model nm nmos level=49
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                1.000000e+00
        v1#branch                        -1.00000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 1
```

PlainSpice's checks: no trap.

## dc-sweep-problems

Each sweep of a `.dc` line (a second, nested one too). Errors, except a step bigger than the range (warning: one point). Fixes: ten steps across the range, swap the ends, or flip the step's sign; a sweep of a missing source gets the circuit's only source.

What PlainSpice shows for dc-sweep-problems-1 (error, line 5):

> **A step of 0 never reaches the stop.** .dc V1 0 12 0 means: sweep V1 from 0 to 12 in steps of 0. A step of 0 never moves away from the start.
>
> *ngspice:* ngspice 47 stops: 'Bad syntax!'. ngspice 42 never finishes: it keeps sweeping the first point. [dc-sweep-problems-1, dc-sweep-problems-2]
>
> *Fixes:* "Use a step of 1.2 (10 steps)"

### dc-sweep-problems-1. A zero step: ngspice 47 stops, ngspice 42 never finishes

```spice
* .dc with a zero step
V1 in 0 0
R1 in out 1k
R2 out 0 2k
.dc V1 0 12 0
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .dc v1 0 12 0
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42: not run. ngspice 42 sweeps the first point forever: in the research run its rawfile grew to 1.26 GB in 60 s before it was stopped (research notes, native-traps.md, T20a).
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-2. A missing step: the same

```spice
* .dc without a step
V1 in 0 0
R1 in out 1k
R2 out 0 2k
.dc V1 0 12
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .dc v1 0 12
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42: not run. ngspice 42 never finishes, as with a zero step (research notes, native-traps.md, T20d).
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-3. A negative step on a rising range: no points, silently

```spice
* .dc with a negative step and a rising range
V1 in 0 0
R1 in out 1k
R2 out 0 2k
.dc V1 0 12 -1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 0, no results):
    vectors: (none)
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-4. Start above stop with a positive step: no points, silently

```spice
* .dc from 12 down to 0 with a positive step
V1 in 0 0
R1 in out 1k
R2 out 0 2k
.dc V1 12 0 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 0, no results):
    vectors: (none)
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-5. A step bigger than the range: one point

```spice
* .dc with a step larger than the range
V1 in 0 0
R1 in out 1k
R2 out 0 2k
.dc V1 0 12 20
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep) = 0, v(out) = 0
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep) = 0, v(out) = 0
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(v-sweep) = 0, v(out) = 0
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-6. Sweeping a source that does not exist

```spice
* .dc sweeping a missing source
V1 in 0 0
R1 in out 1k
R2 out 0 2k
.dc V9 0 12 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "v9" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "v9" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-7. Sweeping a capacitor

```spice
* .dc sweeping a capacitor
V1 in 0 1
R1 in out 1k
C1 out 0 1u
.dc C1 1u 2u 1u
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "c1" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "c1" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-8. Sweeping downwards with a negative step works (no trap)

```spice
* .dc from 12 down to 0 with a negative step
V1 in 0 0
R1 in out 1k
R2 out 0 2k
.dc V1 12 0 -1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep) = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep) = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(v-sweep) = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
```

PlainSpice's checks: no trap.

## tran-problems

The numbers of a `.tran` line (`uic` aside): step, stop, start. Errors, except a step longer than the whole run (info: ngspice chooses its own steps). Fixes: a step of a hundredth of the stop time, or remove the start time.

What PlainSpice shows for tran-problems-1 (error, line 5):

> **.tran needs a stop time.** .tran needs at least two numbers: the step and the stop time, for example .tran 50u 5m. With one number, SPICE takes it as the step and finds no stop time.
>
> *ngspice:* ngspice stops: 'TSTOP is invalid, must be greater than zero.' [tran-problems-1]
>
> *Fixes:* "Use 5m as the stop time: .tran 50u 5m"

### tran-problems-1. .tran with one number

```spice
* .tran with one argument
V1 in 0 1
R1 in out 1k
C1 out 0 1u
.tran 5m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 5m
    TSTOP is invalid, must be greater than zero.
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 5m
    TSTOP is invalid, must be greater than zero.
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `tran-problems`.

### tran-problems-2. .tran with a zero step

```spice
* .tran with a zero step
V1 in 0 1
R1 in out 1k
C1 out 0 1u
.tran 0 5m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0 5m
    TSTEP is invalid, must be greater than zero.
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0 5m
    TSTEP is invalid, must be greater than zero.
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `tran-problems`.

### tran-problems-3. .tran with a step longer than the run: it runs anyway

```spice
* .tran with a step larger than the stop time
V1 in 0 PULSE(0 1 0 1u 1u 1 2)
R1 in out 1k
C1 out 0 1u
.tran 1 5m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: time: 73 points, last 0.005, v(out): 73 points, last 0.9932860712518419
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: time: 73 points, last 0.005, v(out): 73 points, last 0.9932860790999656
our engine (wasm), as ngspice -b -r (exit 0):
    in                                           0
    out                                          0
    v1#branch                                    0
    vectors: time: 73 points, last 0.005, v(out): 73 points, last 0.9932860712518419
```

PlainSpice's checks: `tran-problems`.

### tran-problems-4. .tran with the start after the stop

```spice
* .tran with tstart after tstop
V1 in 0 1
R1 in out 1k
C1 out 0 1u
.tran 10u 5m 6m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 10u 5m 6m
    TSTART is invalid, must be less than TSTOP.
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 10u 5m 6m
    TSTART is invalid, must be less than TSTOP.
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `tran-problems`.

### tran-problems-5. .tran with the start equal to the stop

```spice
* .tran with tstart equal to tstop
V1 in 0 1
R1 in out 1k
C1 out 0 1u
.tran 1u 5m 5m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 1u 5m 5m
    TSTART is invalid, must be less than TSTOP.
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 1u 5m 5m
    TSTART is invalid, must be less than TSTOP.
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `tran-problems`.

### tran-problems-6. .tran with no numbers

```spice
* .tran with no arguments
V1 in 0 1
R1 in out 1k
C1 out 0 1u
.tran
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran
    TSTEP is invalid, must be greater than zero.
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran
    TSTEP is invalid, must be greater than zero.
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `tran-problems`.

### tran-problems-7. .tran with a negative step

```spice
* .tran with a negative step
V1 in 0 1
R1 in out 1k
C1 out 0 1u
.tran -1u 5m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran -1u 5m
    TSTEP is invalid, must be greater than zero.
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran -1u 5m
    TSTEP is invalid, must be greater than zero.
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `tran-problems`.

## tf-problems

The output and the input of a `.tf` line. A missing output node and `i( )` of anything but a voltage source give wrong numbers silently; a missing input or one that is not V or I stops ngspice. Error. Fixes: a node whose name looks like a typo of the one written; the circuit's only source as the input. An output written with an invisible character, one that looks like a space or a look-alike letter is another node with nothing on it (tf-problems-8): the error names the character, and its fix writes the name as the other lines do; the other way round, with the character in the parts' node, it says so and leaves the fix to the character's own warning (tf-problems-9); a part's name in `.tf` written so is named the same way (tf-problems-10). A `.tf` after `.end`, which ngspice runs, is checked too (tf-problems-11), and one in a subcircuit no X line uses, which ngspice ignores, is not (A3f in explanations.md).

What PlainSpice shows for tf-problems-1 (error, line 5):

> **.tf asks about node n9, which is not in the circuit.** There is no node called n9: no part connects to it. .tf v(n9) needs a node of the circuit.
>
> *ngspice:* ngspice says nothing: it makes a new node with nothing connected, as if 1 Ω went from it to ground. The transfer function comes out 0 and the output impedance 1 Ω. [tf-problems-1]
>
> *Fixes:* none

### tf-problems-1. An output node that does not exist: transfer function 0, output impedance 1 Ω, silently

```spice
* .tf naming an output node that does not exist
V1 s 0 24
R1 s n1 6
R2 n1 0 3
.tf v(n9) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 0.000000e+00
    output_impedance_at_v(n9) = 1.000000e+00
    v1#input_impedance = 9.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(Transfer_function) = 0, v(output_impedance_at_V(n9)) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(Transfer_function) = 0, v(output_impedance_at_V(n9)) = 1
```

PlainSpice's checks: `tf-problems`.

### tf-problems-2. A second output node that does not exist adds 1 Ω, silently

```spice
* .tf with a second output node that does not exist
V1 s 0 24
R1 s n1 6
R2 n1 0 3
.tf v(n1,n9) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 3.333333e-01
    output_impedance_at_v(n1,n9) = 3.000000e+00
    v1#input_impedance = 9.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(Transfer_function) = 0.3333333333333333, v(output_impedance_at_V(n1,n9)) = 3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(Transfer_function) = 0.3333333333333333, v(output_impedance_at_V(n1,n9)) = 3
```

PlainSpice's checks: `tf-problems`.

### tf-problems-3. An input source that does not exist

```spice
* .tf naming a source that does not exist
V1 s 0 24
R1 s n1 6
R2 n1 0 3
.tf v(n1) V9
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Warning: Transfer function source v9 not in circuit
    doAnalyses: not found
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `tf-problems`.

### tf-problems-4. A resistor as the input

```spice
* .tf naming a resistor as the input
V1 s 0 24
R1 s n1 6
R2 n1 0 3
.tf v(n1) R1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Warning: Transfer function source r1 not of proper type
    doAnalyses: not found
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `tf-problems`.

### tf-problems-5. i( ) of a resistor: transfer function 0, silently

```spice
* .tf with the current of a resistor as the output
V1 s 0 24
R1 s n1 6
R2 n1 0 3
.tf i(R1) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 0.000000e+00
    r1#output_impedance = 1.000000e+20
    v1#input_impedance = 9.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(Transfer_function) = 0, v(r1#Output_impedance) = 100000000000000000000
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(Transfer_function) = 0, v(r1#Output_impedance) = 100000000000000000000
```

PlainSpice's checks: `tf-problems`.

### tf-problems-6. No input source

```spice
* .tf with no input source
V1 s 0 24
R1 s n1 6
R2 n1 0 3
.tf v(n1)
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Warning: Transfer function source  not in circuit
    doAnalyses: not found
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `tf-problems`.

### tf-problems-7. i( ) of a source that does not exist: the same as a resistor

```spice
* .tf with the current of a missing source as the output
V1 s 0 24
R1 s n1 6
R2 n1 0 3
.tf i(V9) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 0.000000e+00
    v1#input_impedance = 9.000000e+00
    v9#output_impedance = 1.000000e+20
  ngspice -b -r out.raw (exit 0)
    rawfile: v(Transfer_function) = 0, v(v9#Output_impedance) = 100000000000000000000
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(Transfer_function) = 0, v(v9#Output_impedance) = 100000000000000000000
```

PlainSpice's checks: `tf-problems`.

### tf-problems-8. An output node written with a character that is not what it looks like is another node: transfer function 0, output impedance 1 Ω, silently

Added after the critic of the words re-check's fix (12 November 2026, S11). `ou<ZWSP>t` looks like out,
the node R1 and R2 are on, but ngspice keeps the zero-width space in the name (as `ou___t`, as in
invisible-character-3), so the .tf asks about a node with nothing connected: the numbers are those of
tf-problems-1, not out's 2/3 and 666.7 Ω. A Cyrillic о (`__ut`, as in look-alike-letter-5) and a thin
space (`o___ut`, as in space-character-10) do the same. So the check keeps an error here, as for any
node no part connects to, in words that name the character; it never says "There is no node called
out" or offers "Use out": its fix writes the name as the other lines do.

```spice
* .tf on a node written with a zero-width space
V1 in 0 6
R1 in out 1k
R2 out 0 2k
.tf v(ou<ZWSP>t) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 0.000000e+00
    output_impedance_at_v(ou___t) = 1.000000e+00
    v1#input_impedance = 3.000000e+03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(Transfer_function) = 0, v(v1#Input_impedance) = 2999.9999999999995, v(output_impedance_at_V(ou___t)) = 1
  the same with .tf v(оut) V1 (a Cyrillic о), ngspice -b (exit 0):
    transfer_function = 0.000000e+00
    output_impedance_at_v(__ut) = 1.000000e+00
    v1#input_impedance = 3.000000e+03
  the same with .tf v(o<THIN>ut) V1, ngspice -b (exit 0):
    transfer_function = 0.000000e+00
    output_impedance_at_v(o___ut) = 1.000000e+00
    v1#input_impedance = 3.000000e+03
  the same with .tf v(out) V1, ngspice -b (exit 0):
    transfer_function = 6.666667e-01
    output_impedance_at_v(out) = 6.666667e+02
    v1#input_impedance = 3.000000e+03
  the same with .tf v(о<ZWSP>ut) V1 (a Cyrillic о and a zero-width space), ngspice -b (exit 0):
    transfer_function = 0.000000e+00
    output_impedance_at_v(_____ut) = 1.000000e+00
    v1#input_impedance = 3.000000e+03
ngspice 42: the same printouts, exit codes and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(Transfer_function) = 0, v(v1#Input_impedance) = 2999.9999999999995, v(output_impedance_at_V(ou___t)) = 1;
    with v(оut): v(output_impedance_at_V(__ut)) = 1; with v(o<THIN>ut): v(output_impedance_at_V(o___ut)) = 1; with
    v(о<ZWSP>ut): v(output_impedance_at_V(_____ut)) = 1, each with a transfer function of 0; with v(out):
    v(Transfer_function) = 0.6666666666666666, v(output_impedance_at_V(out)) = 666.6666666666666
```

As a second output the character adds 1 Ω, as tf-problems-2 says: v(out,mi<ZWSP>d) is v(out) less a node
with nothing on it, so the transfer function is out's 0.75 and the output impedance 750 + 1 = 751 Ω, where
v(out,mid) gives 0.5 and 1 kΩ. So that error quotes tf-problems-2's words, never "comes out 0" (critic of
the S11 fix, round 2).

```spice
* .tf with a second output node written with a zero-width space
V1 in 0 6
R1 in out 1k
R2 out mid 2k
R3 mid 0 1k
.tf v(out,mi<ZWSP>d) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 7.500000e-01
    output_impedance_at_v(out,mi___d) = 7.510000e+02
    v1#input_impedance = 4.000000e+03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(Transfer_function) = 0.75, v(v1#Input_impedance) = 4000, v(output_impedance_at_V(out,mi___d)) = 751
  the same with .tf v(out,mid) V1, ngspice -b (exit 0):
    transfer_function = 5.000000e-01
    output_impedance_at_v(out,mid) = 1.000000e+03
    v1#input_impedance = 4.000000e+03
ngspice 42: the same printouts, exit codes and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(Transfer_function) = 0.75, v(v1#Input_impedance) = 4000, v(output_impedance_at_V(out,mi___d)) = 751
```

PlainSpice's checks: `invisible-character`, `tf-problems` (with v(оut): `look-alike-letter`, `tf-problems`; with
v(o<THIN>ut): `space-character`, `tf-problems`; with v(о<ZWSP>ut): `invisible-character`, `tf-problems`, whose
words name both characters; with v(out,mi<ZWSP>d): `invisible-character`, `tf-problems`).

### tf-problems-9. The other way round: the parts' node has the character, and .tf writes the name plainly

Added after the second critic of the S11 fix (12 November 2026). R1 and R2 are on `ou<ZWSP>t` (`ou___t`
for ngspice), and `.tf v(out)` asks about out, a node no part connects to: 0 and 1 Ω, as in
tf-problems-1. The check says so, ".tf asks about node out, but the parts are on another node: out
(written with a zero-width space in it)", and offers no button: one writing the parts' name into the
.tf would put a third hidden character in the netlist (the critic's case); the character's own warning
on the part lines takes it out, and then the .tf asks about their node. A Cyrillic о on the part
lines does the same.

```spice
* .tf v(out) with the parts on a node written with a zero-width space
V1 in 0 6
R1 in ou<ZWSP>t 1k
R2 ou<ZWSP>t 0 2k
.tf v(out) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 0.000000e+00
    output_impedance_at_v(out) = 1.000000e+00
    v1#input_impedance = 3.000000e+03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(Transfer_function) = 0, v(v1#Input_impedance) = 2999.9999999999995, v(output_impedance_at_V(out)) = 1
  the same with R1 in оut 1k and R2 оut 0 2k (a Cyrillic о), ngspice -b (exit 0):
    transfer_function = 0.000000e+00
    output_impedance_at_v(out) = 1.000000e+00
    v1#input_impedance = 3.000000e+03
ngspice 42: the same printouts, exit codes and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(Transfer_function) = 0, v(v1#Input_impedance) = 2999.9999999999995, v(output_impedance_at_V(out)) = 1,
    the same with the Cyrillic о
```

PlainSpice's checks: `invisible-character`, `tf-problems` (with the Cyrillic о: `look-alike-letter`, `tf-problems`).

### tf-problems-10. A part's name in .tf written with such a character is another name: i( ) reads nothing, and an input stops ngspice

Added after the second critic of the S11 fix (12 November 2026). `i(V<ZWSP>m)` names no part (ngspice
spells it `v___m`), so ngspice gives tf-problems-7's numbers, a transfer function of 0 and an output
impedance of 1e20 Ω, without a message; `V<ZWSP>1` as the input stops ngspice, which quotes it in its
own spelling, `v___1`. The check names the character, never shows it, quotes ngspice's message as it
prints it, and its fix writes the name as the other lines do ("Take it out: use Vm").

```spice
* .tf i( ) of a source written with a zero-width space
V1 in 0 6
R1 in out 1k
Vm out mid 0
R2 mid 0 2k
.tf i(V<ZWSP>m) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 0.000000e+00
    v1#input_impedance = 3.000000e+03
    v___m#output_impedance = 1.000000e+20
  ngspice -b -r out.raw (exit 0)
    rawfile: v(Transfer_function) = 0, v(v1#Input_impedance) = 3000.0000000000005, v(v___m#Output_impedance) = 1e+20
  the same netlist with .tf i(Vm) V<ZWSP>1, ngspice -b (exit 1):
    Warning: Transfer function source v___1 not in circuit
  ngspice -b -r out.raw (exit 1): no rawfile
ngspice 42: the same printouts, exit codes and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r:
    exit 0, vectors: v(Transfer_function) = 0, v(v1#Input_impedance) = 3000.0000000000005, v(v___m#Output_impedance) = 1e+20;
    with V<ZWSP>1 as the input: exit 1, "Warning: Transfer function source v___1 not in circuit", no results
```

PlainSpice's checks: `tf-problems` (each).

### tf-problems-11. A .tf written after .end is checked too: ngspice runs it, a typo or a hidden character there included

Added after the second critic of the S11 fix (12 November 2026). ngspice reads the lines after a plain
`.end` (after-end-1) and runs a `.tf` there (A3c in explanations.md), so a `.tf v(ou<ZWSP>t)` or
`.tf v(outt)` after `.end` gives a transfer function of 0 and an output impedance of 1 Ω, as above
`.end` (tf-problems-1, -8). The check reads such a line as one above `.end` (the run is "Not reliable",
and its fix writes the name as the other lines do); a node that a part written after `.end` makes is a
node of the circuit, as for ngspice.

```spice
* .tf after .end on a node written with a zero-width space
V1 in 0 6
R1 in out 1k
R2 out 0 2k
.end
.tf v(ou<ZWSP>t) V1
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 0.000000e+00
    output_impedance_at_v(ou___t) = 1.000000e+00
    v1#input_impedance = 3.000000e+03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(Transfer_function) = 0, v(v1#Input_impedance) = 2999.9999999999995, v(output_impedance_at_V(ou___t)) = 1
  the same with .tf v(outt) V1 after .end, ngspice -b (exit 0):
    transfer_function = 0.000000e+00
    output_impedance_at_v(outt) = 1.000000e+00
    v1#input_impedance = 3.000000e+03
  the same with R3 out x 1k and .tf v(x) V1 after .end, ngspice -b (exit 0):
    transfer_function = 6.666667e-01
    output_impedance_at_v(x) = 1.666667e+03
    v1#input_impedance = 3.000000e+03
ngspice 42: the same printouts, exit codes and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(Transfer_function) = 0, v(v1#Input_impedance) = 2999.9999999999995, v(output_impedance_at_V(ou___t)) = 1;
    with v(outt): v(output_impedance_at_V(outt)) = 1; with v(x): v(Transfer_function) = 0.6666666666666666,
    v(output_impedance_at_V(x)) = 1666.6666666666665
```

PlainSpice's checks: `after-end`, `tf-problems` (with v(x): `after-end` only).

## no-analysis

A netlist with parts but no analysis line (and no .control block). Error. Fix: add `.op` before `.end`.

What PlainSpice shows for no-analysis-1 (error, line 4):

> **No analysis: nothing will run.** A netlist describes a circuit; an analysis line tells SPICE what to work out. .op finds the DC voltages and currents, .dc sweeps a source, .tran shows how the circuit changes in time.
>
> *ngspice:* ngspice reads the circuit and runs nothing. In batch mode it ends with 'no simulations run!'; PlainSpice's engine gives no results and no message. [no-analysis-1]
>
> *Fixes:* "Add .op before .end"

### no-analysis-1. No analysis line: nothing runs

```spice
* no analysis line
V1 a 0 6
R1 a 0 2
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 0, no results):
    vectors: (none)
```

PlainSpice's checks: `no-analysis`.

## missing-end

No `.end` line. Info. Fix: add it at the bottom.

What PlainSpice shows for missing-end-1 (info, line 4):

> **No .end line.** A netlist ends with .end, its last line. ngspice runs this one without it, so this is only a note: add .end at the bottom, and keep new lines above it, because ngspice still reads lines written after .end.
>
> *ngspice:* ngspice reads the file to its last line and runs it normally, without a message; with a .end, it still reads the lines after it. [missing-end-1, after-end-1]
>
> *Fixes:* "Add .end at the bottom"

### missing-end-1. No .end: harmless from a file

```spice
* no .end line
V1 n1 0 6
R1 n1 0 2
.op
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               6.000000e+00
        v1#branch                        -3.00000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 6, i(v1) = -3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 6, i(v1) = -3
```

PlainSpice's checks: `missing-end`.

## after-end

Lines after `.end` that are not blank or comments. Warning. Fix: move `.end` to the bottom, which keeps what ngspice reads from a file.

What PlainSpice shows for after-end-1 (warning, line 6):

> **Lines after .end.** Everything after .end looks ignored, but ngspice still reads these lines when it runs a file, so they are part of the circuit. Keep .end as the last line.
>
> *ngspice:* ngspice still reads the lines after .end from a file and builds them into the circuit, without a message: in one test a resistor after .end changed the source current from −2 A to −5 A. [after-end-1]
>
> *Fixes:* "Move .end to the bottom"

### after-end-1. A part after .end is still read from a file

```spice
* a part after .end
V1 n1 0 6
R2 n1 0 3
.op
.end
R1 n1 0 2
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               6.000000e+00
        v1#branch                        -5.00000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: i(v1) = -5
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: i(v1) = -5
```

PlainSpice's checks: `after-end`.

### after-end-2. After .end;comment it is not

```spice
* .end with a comment glued to it
V1 n1 0 6
R2 n1 0 3
.op
.end;the end
R1 n1 0 2
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               6.000000e+00
        v1#branch                        -2.00000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: i(v1) = -2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: i(v1) = -2
```

PlainSpice's checks: `after-end`.

## zero-ohm

A resistor whose value is less than 1e-12 Ω in size (ngspice 47's limit, resparam.c), 0 included. Warning. Fix: a 0 V source in its place, offered only when that adds no loop of voltage sources and the line has nothing else on it (zero-ohm-3). An error, with no fix, when the resistor sits straight across a voltage source, or a chain of voltage sources and inductors whose voltages need not add up to 0: its current then has no finite answer, and ngspice's stand-in gives an absurd one (zero-ohm-2: 6e12 A from a 6 V source).

What PlainSpice shows for zero-ohm-1 (warning, line 3):

> **R1 has a resistance of 0 Ω.** SPICE can't use a resistance of exactly 0: a resistor's current is its voltage divided by its resistance. For a wire, give both ends the same node name; to measure the current in a wire, use a 0 V source (the ammeter trick).
>
> *ngspice:* ngspice 47 uses 1e-12 Ω instead and warns: 'Value of resistor r1 is too small, set to 1.000000e-12'. ngspice 42 used 0.001 Ω without a word, which changed the answer in the 4th digit. [zero-ohm-1, zero-ohm-2]
>
> *Fixes:* "Use a 0 V source instead (VR1)"

What PlainSpice shows for zero-ohm-2 (error, line 3):

> **R1 shorts V1: its current has no finite answer.** A resistance of 0 straight across a voltage source would need an endless current: a resistor's current is its voltage divided by its resistance. For a wire, give both ends the same node name; a wire across a source shorts it, so check where R1 should go.
>
> *ngspice:* ngspice 47 uses 1e-12 Ω instead and warns: 'Value of resistor r1 is too small, set to 1.000000e-12'; in one test a 6 V source then gave 6e12 A, an artefact, not an answer. [zero-ohm-2]
>
> *Fixes:* none

### zero-ohm-1. A 0 Ω resistor: 47 uses 1e-12 Ω and warns, 42 used 1 mΩ silently

```spice
* a 0 ohm resistor
V1 a 0 6
R1 a b 0
R2 b 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                6.000000e+00
        a                                6.000000e+00
        v1#branch                        -3.00000e+00
    Warning: Value of resistor r1 is too small, set to 1.000000e-12
  ngspice -b -r out.raw (exit 0)
    rawfile: v(b) = 5.999999999997
ngspice 42, ngspice -b (exit 0):
        b                                5.997001e+00
        a                                6.000000e+00
        v1#branch                        -2.99850e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(b) = 5.997001499250375
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(b) = 5.999999999997
```

PlainSpice's checks: `zero-ohm`.

### zero-ohm-2. A 0 Ω resistor straight across a voltage source

```spice
* a 0 ohm resistor across a voltage source
V1 a 0 6
R1 a 0 0
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                6.000000e+00
        v1#branch                        -6.00000e+12
    Warning: Value of resistor r1 is too small, set to 1.000000e-12
  ngspice -b -r out.raw (exit 0)
    rawfile: i(v1) = -6000000000000
ngspice 42, ngspice -b (exit 0):
        a                                6.000000e+00
        v1#branch                        -6.00000e+03
  ngspice -b -r out.raw (exit 0)
    rawfile: i(v1) = -6000
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: i(v1) = -6000000000000
```

PlainSpice's checks: `zero-ohm`.

### zero-ohm-3. The 0 V source in its place runs cleanly (the fix)

```spice
* a 0 V source in place of the 0 ohm resistor
V1 a 0 6
VR1 a b 0
R2 b 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                6.000000e+00
        a                                6.000000e+00
        v1#branch                        -3.00000e+00
        vr1#branch                       3.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(b) = 6, i(vr1) = 3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(b) = 6, i(vr1) = 3
```

PlainSpice's checks: no trap.

## fatal-syntax

An expression whose `{` or `'` is never closed; a name in an expression that no `.param`, `.func` or subcircuit `params:` defines (only `temper`, `hertz` and `time` are known without one, fatal-syntax-6); a B line without V= or I=, or with nothing after it. Error. Fixes: close the expression; for `pi` and `e`, add a `.param` with the constant (fatal-syntax-9).

What PlainSpice shows for fatal-syntax-1 (error, line 3):

> **A { is never closed.** Braces { } (or single quotes ' ') hold an expression that SPICE works out, like {2*R}. Each opening one needs its closing partner on the same line.
>
> *ngspice:* ngspice stops with a fatal error: 'Closing "}" not found in line fragment'. [fatal-syntax-1, fatal-syntax-2]
>
> *Fixes:* "Close it: {1k}"

### fatal-syntax-1. A { that is never closed

```spice
* an unclosed brace
V1 a 0 1
R1 a 0 {1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error in netlist line no. 4, new internal line no. 3:
    Closing "}" not found in line fragment
        {1k.
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Netlist line no. 3:
    Closing "}" not found in line fragment
        {1k.
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `fatal-syntax`.

### fatal-syntax-2. A ' that is never closed

```spice
* an unclosed quote
V1 a 0 1
R1 a 0 '2*3
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error in netlist line no. 4, new internal line no. 3:
    Closing "}" not found in line fragment
        {2*3.
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Netlist line no. 3:
    Closing "}" not found in line fragment
        {2*3.
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `fatal-syntax`.

### fatal-syntax-3. A name in braces with no .param

```spice
* an undefined parameter
V1 a 0 1
R1 a 0 {rx}
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error in netlist line no. 4, new internal line no. 3:
    Undefined parameter [rx]
    Error in netlist line no. 4, new internal line no. 3:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Netlist line no. 3:
    Undefined parameter [rx]
    Netlist line no. 3:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `fatal-syntax`.

### fatal-syntax-4. pi is not predefined inside braces

```spice
* pi inside braces
I1 0 a 1
R1 a 0 {2*pi}
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error in netlist line no. 4, new internal line no. 3:
    Undefined parameter [pi]
    Error in netlist line no. 4, new internal line no. 3:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Netlist line no. 3:
    Undefined parameter [pi]
    Netlist line no. 3:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `fatal-syntax`.

### fatal-syntax-5. With .param the same name works (no trap)

```spice
* a defined parameter
.param rx=2k
V1 a 0 1
R1 a 0 {rx}
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                1.000000e+00
        v1#branch                        -5.00000e-04
  ngspice -b -r out.raw (exit 0)
    rawfile: i(v1) = -0.0005
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: i(v1) = -0.0005
```

PlainSpice's checks: no trap.

### fatal-syntax-6. temper, hertz and time are known inside braces (no trap)

```spice
* names numparam knows
I1 0 a 1
R1 a 0 {1+temper}
I2 0 b 1
R2 b 0 {1+hertz}
I3 0 c 1
R3 c 0 {1+time}
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        c                                1.000000e+00
        b                                1.000000e+00
        a                                2.800000e+01
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 28, v(b) = 1, v(c) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 28, v(b) = 1, v(c) = 1
```

PlainSpice's checks: no trap.

### fatal-syntax-9. With .param pi=3.141592653589793 the expression runs (the fix)

```spice
* pi inside braces, defined
.param pi=3.141592653589793
I1 0 a 1
R1 a 0 {2*pi}
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                6.283185e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 6.283185307179586
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 6.283185307179586
```

PlainSpice's checks: no trap.

### fatal-syntax-7. A B line without V= or I=

```spice
* a B line without V= or I=
V1 a 0 1
R1 a 0 1
B1 b 0 5
R2 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    ERROR: mal formed B source instance: b1 b 0 5
        in line no. 4 of file circuit.cir
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    ERROR: mal formed B line: b1 b 0 5
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `fatal-syntax`.

### fatal-syntax-8. A B line with an empty formula

```spice
* a B line with an empty formula
V1 a 0 1
R1 a 0 1
B1 b 0 V=
R2 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    YYparse error, syntax error, in expression: parsing stopped at line 4
         in
    from file    circuit.cir
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    PTerror: syntax error, parsing stopped at
    Error on line 4 or its substitute:
      b1 b 0 v=
    parameter value out of range or the wrong type
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `fatal-syntax`.

### fatal-syntax-10. A .func body uses its own arguments (no trap)

x is the argument of dbl, not a parameter: ngspice runs without a .param x.

```spice
* a function with an argument
V1 a 0 1
R1 a 0 1k
.func dbl(x) {2*x}
R2 a 0 {dbl(1k)}
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                1.000000e+00
        v1#branch                        -1.50000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: i(v1) = -0.0015
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: i(v1) = -0.0015
```

PlainSpice's checks: none.

### fatal-syntax-11. v( ) and i( ) inside braces name nodes and sources, not parameters (no trap)

In a B source, and in a resistor value too, {2*v(in)} and {2*i(V1)} run without any .param.

```spice
* v() and i() inside braces
V1 in 0 1
R1 in 0 1k
B1 out 0 V={2*v(in)}
R2 out 0 1k
B2 o2 0 V={2*i(V1)}
R3 o2 0 1k
R4 in 0 {2*v(in)}
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        o2                               -1.00200e+00
        out                              2.000000e+00
        in                               1.000000e+00
        b1#branch                        -2.00000e-03
        v1#branch                        -5.01000e-01
        b2#branch                        1.002000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out) = 2, v(o2) = -1.002
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(out) = 2, v(o2) = -1.002
```

PlainSpice's checks: none.

## include-not-available

An `.include` (or `.inc`) line, or `.lib` with a file and a section. Error. A `.lib` with one word is no command ngspice knows, and gets its own text (include-not-available-3).

What PlainSpice shows for include-not-available-1 (error, line 4):

> **PlainSpice can't read other files.** This line asks SPICE to read models.lib from your computer. PlainSpice runs ngspice inside this page with only the netlist you see, so it can't open other files. Copy what you need from that file into the netlist instead.
>
> *ngspice:* ngspice stops with a fatal error: 'Could not find include file models.lib'. [include-not-available-1]
>
> *Fixes:* none

### include-not-available-1. .include of a file

```spice
* an include line
V1 a 0 1
R1 a 0 1
.include models.lib
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: Could not find include file models.lib
        While reading circuit.cir
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error: Could not find include file models.lib
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: there aren't any circuits loaded.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `include-not-available`.

### include-not-available-2. .lib of a file

```spice
* a lib line
V1 a 0 1
R1 a 0 1
.lib models.lib tt
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: Could not find library file models.lib
    ERROR, library file models.lib not found
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `include-not-available`.

### include-not-available-3. .lib with one word is no command ngspice knows

ngspice reads .lib as "file section". With one word (a file name, or a section name) it does not recognise the line and stops before anything runs.

```spice
* .lib with one word
V1 a 0 1
R1 a 0 1k
.lib models.lib
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .lib models.lib
     unimplemented dot command '.lib'
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .lib models.lib
     unimplemented dot command '.lib'
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      .lib models.lib
     unimplemented dot command '.lib'
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `include-not-available`.

## lost-continuation

A `+` line whose card is a `;` or odd-character comment line (ngspice joins it to that comment), or that comes right after the title (nothing to continue). Warning. Fixes: start the comment with `*` (lost-continuation-4), or remove the `+`.

What PlainSpice shows for lost-continuation-1 (warning, line 6):

> **This + line is lost in the comment above it.** A + line continues the last line before it, and ngspice counts a comment starting with ; as such a line. So the words on this line go into the comment, not into R1. Comments starting with * may sit in between.
>
> *ngspice:* ngspice joins the + line to the comment line, so its words are lost and R1 is read without them (in one test ngspice then left the part out: 'not a valid resistor instance line'). [lost-continuation-1, lost-continuation-2]
>
> *Fixes:* "Make the comment start with *"

### lost-continuation-1. A ; comment between a part and its + line takes the + line

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
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 1000
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(n1) = 1000
```

PlainSpice's checks: `missing-value`, `lost-continuation`.

### lost-continuation-2. So does a line starting with ! (with a warning)

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
        line no. 5 from file circuit.cir!
    Warning: 'r1 n1 0' is not a valid resistor instance line, ignored!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 1000
ngspice 42, ngspice -b (exit 0):
        n1                               1.000000e+03
    Warning: Unusual leading characters like '!' or others out of '= [] ? () & % $"!:,\f'
        in netlist or included files, will be replaced with '*'.
        Check line no 5:  ! an odd comment  2
    Warning: 'r1 n1 0' is not a valid resistor instance line, ignored!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 1000
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(n1) = 1000
```

PlainSpice's checks: `missing-value`, `lost-continuation`.

### lost-continuation-3. A + line right after the title is ignored silently

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
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 4
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 4
```

PlainSpice's checks: `lost-continuation`.

### lost-continuation-4. With a * comment in between it works (the fix)

```spice
* a * comment line between a line and its continuation
I1 0 n1 1
R0 n1 0 1k
R1 n1 0
* a star comment
+ 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               1.996008e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 1.996007984031936
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 1.996007984031936
```

PlainSpice's checks: no trap.

## unknown-word

A word after a part's value that ngspice cannot use there, on R, C, L, V, I, E, F, G and H lines: a note written without a semicolon, a value the part can only report (i, p), one number too many, or the second half of `1d-3` (a sign after a letter starts a new word, N8). The parser knows each part's settings from ngspice 47's parameter tables (`src/spice/parse.ts`), so `m=2`, `tc1=1m`, `ic=0` and the like are not flagged. Error: ngspice stops; on E, F, G and H lines our engine stops while native 47 reads a polynomial (XSPICE). Words a more specific trap explains (a decimal comma, a space before a scale letter, a mid-line comment) are left to it. Fixes: turn the word and the rest of the line into a comment with `;`, or write `1e-3` for `1d-3`.

What PlainSpice shows for unknown-word-1 (error, line 3):

> **SPICE can't use load on this line.** SPICE reads the words after a part's value as its settings, written name=value (like m=2), and load is not a setting of a resistor, so it stops there. To add a note at the end of a line, start it with a semicolon: ; like this.
>
> *ngspice:* ngspice stops: 'unknown parameter (load)'. [unknown-word-1, unknown-word-2, unknown-word-3, unknown-word-7]
>
> *Fixes:* "Make load and the rest of the line a comment"

### unknown-word-1. A word after a resistor value stops ngspice: unknown parameter

A note written after the value without a semicolon is read as a parameter name. load is not a parameter of a resistor, so ngspice stops (it first looks for a model called load).

```spice
* an unknown word after a resistor value
V1 a 0 5
R1 a 0 1k load
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'load' from line
        r1 a 0 1k load
    Error on line 3 or its substitute:
      r1 a 0 1k load
      unknown parameter (load)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'load' from line
        r1 a 0 1k load
    Error on line 3 or its substitute:
      r1 a 0 1k load
      unknown parameter (load)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    warning, can't find model 'load' from line
        r1 a 0 1k load
    Error on line 3 or its substitute:
      r1 a 0 1k load
      unknown parameter (load)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-word`.

### unknown-word-2. The same after a capacitor value

The same on a capacitor line, without the model warning.

```spice
* an unknown word after a capacitor value
V1 a 0 5
R1 a b 1k
C1 b 0 1u big
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      c1 b 0 1u big
      unknown parameter (big)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      c1 b 0 1u big
      unknown parameter (big)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      c1 b 0 1u big
      unknown parameter (big)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-word`.

### unknown-word-3. The same after a voltage source value

A source line knows DC, AC, the waveforms and a few named settings; any other word stops ngspice.

```spice
* a stray word after a voltage source value
V1 a 0 5 battery
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 5 battery
      unknown parameter (battery)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 5 battery
      unknown parameter (battery)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 2 or its substitute:
      v1 a 0 5 battery
      unknown parameter (battery)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-word`.

### unknown-word-4. A number after a gain: our engine stops, native 47 reads a polynomial and runs

Our engine, built without XSPICE, stops at the extra number. Native ngspice 47 and 42 read the two numbers as the coefficients of a polynomial and run.

```spice
* a second number after a gain
V1 a 0 1
R0 a 0 1
E1 b 0 a 0 2 3
R1 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                5.000000e+00
        a                                1.000000e+00
        a$poly$e1#branch_1_0             -5.00000e+00
        v1#branch                        -1.00000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(b) = 5
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      e1 b 0 a 0 2 3
      unknown parameter (3)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-word`.

### unknown-word-5. A word after a gain: our engine stops, native 47 stops too (a polynomial error)

Our engine stops with "unknown parameter"; native ngspice 47 reads the word as part of a polynomial and stops with an XSPICE error.

```spice
* a word after a gain
V1 a 0 1
R0 a 0 1
E1 b 0 a 0 2 fast
R1 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line:
      a$poly$e1 %vd [ a 0 ] %vd ( b 0 ) a$poly$e1
    MIF-ERROR - model: a$poly$e1 - Bad real value
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line:
      a$poly$e1 %vd [ a 0 ] %vd ( b 0 ) a$poly$e1
    MIF-ERROR - model: a$poly$e1 - Bad real value
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      e1 b 0 a 0 2 fast
      unknown parameter (fast)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-word`.

### unknown-word-6. A value the part can only report (i) stops ngspice with "no such parameter"

i (the current) and p (the power) are values ngspice reports for a resistor; a netlist cannot set them.

```spice
* a value the resistor can only report
I1 0 n1 1
R1 n1 0 1k i
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'i' from line
        r1 n1 0 1k i
    Error on line 3 or its substitute:
      r1 n1 0 1k i
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'i' from line
        r1 n1 0 1k i
    Error on line 3 or its substitute:
      r1 n1 0 1k i
    no such parameter on this device
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    warning, can't find model 'i' from line
        r1 n1 0 1k i
    Error on line 3 or its substitute:
      r1 n1 0 1k i
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-word`.

### unknown-word-7. The same after an inductor value

The same on an inductor line.

```spice
* an unknown word after an inductor value
V1 a 0 5
R1 a b 1k
L1 b 0 1m coil
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      l1 b 0 1m coil
      unknown parameter (coil)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      l1 b 0 1m coil
      unknown parameter (coil)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      l1 b 0 1m coil
      unknown parameter (coil)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-word`.

### unknown-word-8. A third number on a resistor stops ngspice

A second number replaces the value (V2 in numbers-and-syntax.md); a third is one too many.

```spice
* three numbers on a resistor
V1 a 0 5
R1 a 0 1k 2k 3k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      r1 a 0 1k 2k 3k
      unknown parameter (3k)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      r1 a 0 1k 2k 3k
      unknown parameter (3k)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 3 or its substitute:
      r1 a 0 1k 2k 3k
      unknown parameter (3k)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-word`.

### unknown-word-9. 1d-3 on a source: the -3 is a new word, and ngspice stops (the fix writes 1e-3)

A minus sign after the d starts a new word (N8 in numbers-and-syntax.md), so the source line has an extra word -3.

```spice
* 1d-3 on a voltage source
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
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 n1 0 1d-3
      unknown parameter (-3)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 2 or its substitute:
      v1 n1 0 1d-3
      unknown parameter (-3)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-word`.

### unknown-word-10. A + line that was meant as a part joins the line above it

The test corpus netlist L30: the + line continues Rref, so ngspice reads Rref a 0 1 1 a 0 5 and stops at a.

```spice
first-letter test [+]
Rref a 0 1
+1 a 0 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      rref a 0 1 1 a 0 5
      unknown parameter (a)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      rref a 0 1 1 a 0 5
      unknown parameter (a)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 2 or its substitute:
      rref a 0 1 1 a 0 5
      unknown parameter (a)
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `dangling-node`, `unknown-word`.

### unknown-word-11. i after a gain: our engine says "no such parameter", native 47 a polynomial error

i, v and p name values an E, F, G or H part can only report, so our engine gives the other message; native ngspice 47 reads the word as part of a polynomial.

```spice
* i after a gain
V1 a 0 1
R0 a 0 1
E1 b 0 a 0 2 i
R1 b 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line:
      a$poly$e1 %vd [ a 0 ] %vd ( b 0 ) a$poly$e1
    MIF-ERROR - model: a$poly$e1 - Bad real value
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line:
      a$poly$e1 %vd [ a 0 ] %vd ( b 0 ) a$poly$e1
    MIF-ERROR - model: a$poly$e1 - Bad real value
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      e1 b 0 a 0 2 i
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-word`.

### unknown-word-12. A word with a letter outside ASCII is quoted with underscores: yük is y__k

Added after the final reviews of 12 November 2026 (W16).

```spice
* a word with a Turkish letter after a value
V1 a 0 5
R1 a 0 1k yük
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'yük' from line
    r1 a 0 1k yük
    Error on line 3 or its substitute:
      r1 a 0 1k y__k
      unknown parameter (y__k)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'yük' from line
    r1 a 0 1k yük
    Error on line 3 or its substitute:
      r1 a 0 1k y__k
      unknown parameter (y__k)
    Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `unknown-word`.

## unknown-dot-command

A line starting with a dot that is not a dot command ngspice 47 knows (the list is `isKnownDotCommand` in `src/spice/explain.ts`, A29). Error: ngspice stops before anything runs. When it looks like a slip in a common command (a letter more, less, swapped or changed), the fix offers that command, and the no-analysis trap stays quiet for a misspelt analysis. Fix: the command it looks like, or make the line a comment.

What PlainSpice shows for unknown-dot-command-1 (error, line 4):

> **ngspice does not know .tarn.** A line starting with a dot is a dot command for SPICE, and .tarn is not one ngspice knows. Did you mean .tran? To keep the line as a note, start it with * instead.
>
> *ngspice:* ngspice stops before running anything, with 'unimplemented dot command' for .tarn. [unknown-dot-command-1, unknown-dot-command-2]
>
> *Fixes:* "Use .tran", "Make the line a comment"

### unknown-dot-command-1. A misspelt dot command stops ngspice before anything runs

.tarn is not a dot command, so ngspice stops before it runs the .op on the next line.

```spice
* a misspelt dot command
V1 a 0 1
R1 a 0 1k
.tarn 1u 1m
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .tarn 1u 1m
     unimplemented dot command '.tarn'
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .tarn 1u 1m
     unimplemented dot command '.tarn'
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      .tarn 1u 1m
     unimplemented dot command '.tarn'
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-dot-command`.

### unknown-dot-command-2. .pss is unknown to ngspice 47 as built (ngspice 42 knows it)

The periodic steady-state analysis is not compiled into native ngspice 47 built as for our engine, nor into our engine: both stop. Ubuntu's ngspice 42 knows .pss.

```spice
* .pss in a netlist
V1 a 0 1
R1 a 0 1k
.pss 1k 1m a 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .pss 1k 1m a 1
     unimplemented dot command '.pss'
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
        a                                1.000000e+00
        v1#branch                        -1.00000e-03
    Periodic Steady State Analysis Started
    PSS Guessed Frequency 1000
    PSS Points 1
    PSS Harmonics number 0
    PSS Steady Coefficient 0
    PSS sc_iter 0
    PSS Stabilization Time 0.001
    Error: no data saved for Periodic Steady State analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1), which also prints:
    Exiting from stabilization
    Time of first shooting evaluation will be 0.002
    RHS on exiting from stabilization: 1               -0.001
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Panic: breakpoint in the past - HELP!
    Strange behavior
    CKTtime: 0.00203687
    time_temp: 0.001
    In shooting...
    Shooting cycle iteration number:   0 || rr: 0 || predsum: -5e-10
    No detectable dynamic on voltages nodes or currents branches. PSS analysis aborted
    doAnalyses: impossible error - can't occur
    rawfile: (no data)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      .pss 1k 1m a 1
     unimplemented dot command '.pss'
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-dot-command`.

### unknown-dot-command-3. .endl in the netlist stops ngspice too

.endl closes a section of a library file; ngspice does not read library sections from the netlist itself, so .endl there is unknown.

```spice
* .endl in the netlist
V1 a 0 1
R1 a 0 1k
.endl
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .endl
     unimplemented dot command '.endl'
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .endl
     unimplemented dot command '.endl'
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      .endl
     unimplemented dot command '.endl'
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-dot-command`.

## non-ascii-node

Added after the final reviews of 12 November 2026 (kept review F3). A node name with a letter outside
a to z (or A to Z), the micro sign aside: ngspice writes each byte of such a letter as `_` (W16 in
numbers-and-syntax.md), so its printout and results call `giriş` `giri__`. Warning, with a fix to the
nearest plain letters (`giris`; the letters that have no plain form are left out, and a name another
node has gets a number). Two names ngspice spells the same are one node for it (W17): error, because
ngspice then simulates a different circuit from the one written, with a fix that gives each its plain
letters. The fixes rename the node everywhere it is named, and on the drawing's `*@ label` line, and
never give a name another node has (that would join two nodes). A name with an invisible character or
a no-break space is left to those checks (invisible-character, nbsp). PlainSpice matches ngspice's
results back to the netlist's names (`src/spice/describe.ts`), so the drawing, the Numbers panel and
the announcement say `giriş`.

What PlainSpice shows for non-ascii-node-1 (warning, line 2):

> **ngspice calls the node giriş giri__.** ngspice writes each letter other than a to z (or A to Z) in a node name as underscores (ş as __), so its printout and results call this node giri__, and two names can become one node. A name in plain letters avoids both.
>
> *ngspice:* ngspice runs it and spells the node giri__, without a message. [non-ascii-node-1]
>
> *Fixes:* "Rename giriş to giris"

What PlainSpice shows for non-ascii-node-2 (error, line 3):

> **ş and ç are one node for ngspice.** ngspice writes each letter other than a to z (or A to Z) in a node name as underscores, so ş and ç both become __: one node. It simulates a different circuit from the one written here. Give each node a name in plain letters.
>
> *ngspice:* ngspice spells ş and ç as __ and makes them one node, without a message: in one test this put both ends of a resistor on that node, so it carried no current. [non-ascii-node-2]
>
> *Fixes:* "Write s for ş and c for ç"

### non-ascii-node-1. giriş is the node giri__: the circuit runs, with ngspice's own names

```spice
* node names with Turkish letters
V1 giriş 0 12
R1 giriş çıkış 1k
R2 çıkış 0 2k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        ____k____                        8.000000e+00
        giri__                           1.200000e+01
        v1#branch                        -4.00000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(giri__) = 12, v(____k____) = 8, i(v1) = -0.004
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(giri__) = 12, v(____k____) = 8, i(v1) = -0.004
```

PlainSpice's checks: `non-ascii-node` (twice).

### non-ascii-node-2. ş and ç are both __: one node, and R1 carries nothing

The drawing shows a divider; ngspice puts both ends of R1 on `__`, so R1 carries no current and V1's
6 mA all flow through R2.

```spice
* two node names that become one
V1 ş 0 12
R1 ş ç 1k
R2 ç 0 2k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        __                               1.200000e+01
        v1#branch                        -6.00000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(__) = 12, i(v1) = -0.006
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(__) = 12, i(v1) = -0.006
```

PlainSpice's checks: `non-ascii-node`.

## invisible-character

Added after the final reviews of 12 November 2026 (security review F2). An invisible character (a
zero-width space, a zero-width joiner or non-joiner, a word joiner, a byte order mark, a soft hyphen, a
direction mark, embedding, override or isolate) in a value or a node name, as text copied from a web
page or a PDF can carry. ngspice reads bytes and writes every byte outside printable ASCII as `_`
(W16), so in a value the character ends the number and the rest of the word is ignored, and in a node
name it makes another node. A value is flagged only when its reading changes once the invisible
characters are removed and look-alike letters written as the letters they look like: `1k<ZWSP>` is still
1 kΩ (invisible-character-4), and no trap. Warning, with a fix that writes the value without it; error
when the value starts with one, because ngspice then stops. In a node name: warning, with a fix that
takes the character out (and so joins the node to the one of that name, if there is one, as was meant).
The words name the character ("a zero-width space (U+200B)") and never show it; the netlist editor
shows it as a dot with that name.

What PlainSpice shows for invisible-character-1 (warning, line 3):

> **R1's value is read as 1 Ω, not 1 kΩ.** A zero-width space (U+200B) sits between 1 and k: a character you cannot see, which often comes with text copied from a web page or a PDF. SPICE stops reading the number at it, so the k after it does not count. Write 1k.
>
> *ngspice:* ngspice stops reading the number at the zero-width space and ignores the rest of the word, without a message: it reads 1 Ω. [invisible-character-1, invisible-character-2]
>
> *Fixes:* "Write 1k (1 kΩ)"

What PlainSpice shows for invisible-character-3 (warning, line 4):

> **A zero-width space (U+200B) hides in the node name out.** It is a character you cannot see (it often comes with text copied from a web page or a PDF), and SPICE keeps it in the name, so this is not the node out the other lines name but another node.
>
> *ngspice:* ngspice keeps the character in the name, as underscores (ou___t), and makes a separate node, without a message: in one test the resistor on it carried no current. [invisible-character-3]
>
> *Fixes:* "Take it out: connect to out"

What PlainSpice shows for invisible-character-5 (error, line 4):

> **R1's value is not a number for SPICE.** It starts with a zero-width space (U+200B), a character you cannot see (it often comes with text copied from a web page or a PDF), so SPICE does not read the word as a number. Write 2k.
>
> *ngspice:* ngspice stops: 'unknown parameter (___2k)'. [invisible-character-5]
>
> *Fixes:* "Write 2k (2 kΩ)"

What PlainSpice shows for invisible-character-6 (error, line 2):

> **V1's value is not a number for SPICE.** Right after the -, it has a zero-width space (U+200B), a character you cannot see (it often comes with text copied from a web page or a PDF), so SPICE does not read the word as a number. Write -5.
>
> *ngspice:* ngspice stops: 'unknown parameter (-___5)'. [invisible-character-6]
>
> *Fixes:* "Write -5 (−5 V)"

### invisible-character-1. A zero-width space inside a value ends the number: 1<ZWSP>k is 1 Ω

```spice
* a zero-width space inside a value
V1 in 0 6
R1 in out 1<ZWSP>k
R2 out 0 2k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out                              5.997001e+00
        in                               6.000000e+00
        v1#branch                        -2.99850e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 6, v(out) = 5.997001499250375, i(v1) = -0.0029985007496247107
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 6, v(out) = 5.997001499250375, i(v1) = -0.0029985007496247107
```

PlainSpice's checks: `invisible-character`.

### invisible-character-2. So do the other invisible characters: a byte order mark, a word joiner, a soft hyphen, a direction mark, a zero-width joiner

```spice
* other invisible characters inside a value
I1 0 n1 1
R1 n1 0 1<BOM>k
I2 0 n2 1
R2 n2 0 1<WJ>k
I3 0 n3 1
R3 n3 0 1<SHY>k
I4 0 n4 1
R4 n4 0 1<LRM>k
I5 0 n5 1
R5 n5 0 1<RLO>k
I6 0 n6 1
R6 n6 0 1<ZWJ>k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n6                               1.000000e+00
        n5                               1.000000e+00
        n4                               1.000000e+00
        n3                               1.000000e+00
        n2                               1.000000e+00
        n1                               1.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 1, v(n2) = 1, v(n3) = 1, v(n4) = 1, v(n5) = 1, v(n6) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 1, v(n2) = 1, v(n3) = 1, v(n4) = 1, v(n5) = 1, v(n6) = 1
```

PlainSpice's checks: `invisible-character` (six times).

### invisible-character-3. In a node name it makes another node: ou<ZWSP>t is ou___t, not out

R2 hangs on its own node, so no current flows: out stays at 6 V.

```spice
* a zero-width space inside a node name
V1 in 0 6
R1 in out 1k
R2 ou<ZWSP>t 0 2k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        ou___t                           0.000000e+00
        out                              6.000000e+00
        in                               6.000000e+00
        v1#branch                        0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 6, v(out) = 6, v(ou___t) = 0, i(v1) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 6, v(out) = 6, v(ou___t) = 0, i(v1) = 0
```

PlainSpice's checks: `invisible-character`.

### invisible-character-4. After the scale letter it changes nothing: 1k<ZWSP> is 1 kΩ (no trap)

```spice
* a zero-width space after the scale letter
V1 in 0 6
R1 in out 1k<ZWSP>
R2 out 0 2k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out                              4.000000e+00
        in                               6.000000e+00
        v1#branch                        -2.00000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 6, v(out) = 4, i(v1) = -0.002
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 6, v(out) = 4, i(v1) = -0.002
```

PlainSpice's checks: none.

### invisible-character-5. At the start of a value the word is no number: ngspice stops

```spice
* a zero-width space before a resistor value
I1 0 a 1
R0 a 0 1k
R1 a 0 <ZWSP>2k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '<ZWSP>2k' from line
    r1 a 0 <ZWSP>2k
    Error on line 4 or its substitute:
      r1 a 0 ___2k
      unknown parameter (___2k)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '<ZWSP>2k' from line
    r1 a 0 <ZWSP>2k
    Error on line 4 or its substitute:
      r1 a 0 ___2k
      unknown parameter (___2k)
    Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `invisible-character`.

### invisible-character-6. Right after a sign it makes the word no number too: -<ZWSP>5, and ngspice stops

Added after the critic of the fixes for the final reviews (12 November 2026): the check now says where the character is, right after the -, instead of "it starts with" it.

```spice
* a zero-width space right after the minus sign of a value
V1 a 0 -<ZWSP>5
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 -___5
      unknown parameter (-___5)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 -___5
      unknown parameter (-___5)
    Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `invisible-character`.

## look-alike-letter

Added after the final reviews of 12 November 2026 (security review F2). A letter from another alphabet,
or the fullwidth form of a letter or digit, that looks like the scale letter or digit a value needs:
the Cyrillic к and м, the Greek κ, the fullwidth ｋ, the Kelvin sign, a fullwidth digit or full stop,
a minus sign or a dash from a document. ngspice writes their bytes as `_` (W16), so it stops reading
the number at them and ignores the rest of the word, like a unit, or, when the value starts with one,
reads no number and stops. Flagged only when the reading changes once they are written as the letters
they look like (the Greek mu has a check of its own, greek-mu). Warning, or error when ngspice stops;
the fix writes the plain letter. Added after the critic of those fixes (12 November 2026): a capital M
from another alphabet (the M key of a Greek keyboard) is meant as mega, so its fixes are mega-as-milli's,
"Make it 10meg" and "Keep milli: write 10m", never "Write 10M", which is milli (look-alike-letter-4);
and a node name whose letters outside ASCII all look like Latin ones (`оut` with a Cyrillic о) gets
the fix that writes them plain, which joins it to the node of that name, "Connect to out"
(look-alike-letter-5).

What PlainSpice shows for look-alike-letter-1 (warning, line 3):

> **R1's value is read as 1 Ω, not 1 kΩ.** The value has the Cyrillic letter к, which looks like k. SPICE knows only the plain letter k, so it ignores this one like a unit. Write 1k.
>
> *ngspice:* ngspice stops reading the number at the Cyrillic letter к, without a message: it reads 1 Ω. [look-alike-letter-1]
>
> *Fixes:* "Write 1k (1 kΩ)"

What PlainSpice shows for look-alike-letter-2 (error, line 2):

> **V1's value is not a number for SPICE.** It starts with a minus sign (U+2212), which looks like -, so SPICE does not read the word as a number. Write -5.
>
> *ngspice:* ngspice stops: 'unknown parameter (___5)'. [look-alike-letter-2]
>
> *Fixes:* "Write -5 (−5 V)"

What PlainSpice shows for look-alike-letter-3 (warning, line 9):

> **R4's value is read as 1 Ω, not 1 mΩ.** The value has a minus sign (U+2212), which looks like -. SPICE knows only the plain - sign, so it ignores this one like a unit, and the 3 after it. Write 1e-3.
>
> *ngspice:* ngspice stops reading the number at the minus sign (U+2212), without a message: it reads 1 Ω. [look-alike-letter-3]
>
> *Fixes:* "Write 1e-3 (1 mΩ)"

What PlainSpice shows for look-alike-letter-4 (warning, line 3):

> **R1's value is read as 10 Ω, not 10 MΩ.** The value has the Greek letter Μ, which looks like M. SPICE knows only the plain letter M, so it ignores this one like a unit. For mega, write meg (a capital M is milli in SPICE): 10meg.
>
> *ngspice:* ngspice stops reading the number at the Greek letter Μ, without a message: it reads 10 Ω. [look-alike-letter-4, mega-as-milli-1]
>
> *Fixes:* "Make it 10meg (10 MΩ)", "Keep milli: write 10m"

What PlainSpice shows for look-alike-letter-4 (warning, line 5):

> **R2's value is read as 10 Ω, not 10 MΩ.** The value has the Cyrillic letter М, which looks like M. SPICE knows only the plain letter M, so it ignores this one like a unit. For mega, write meg (a capital M is milli in SPICE): 10meg.
>
> *ngspice:* ngspice stops reading the number at the Cyrillic letter М, without a message: it reads 10 Ω. [look-alike-letter-4, mega-as-milli-1]
>
> *Fixes:* "Make it 10meg (10 MΩ)", "Keep milli: write 10m"

What PlainSpice shows for look-alike-letter-4 (warning, line 7):

> **R3's value is read as 10 Ω, not 10 MΩ.** The value has the fullwidth letter Ｍ, which looks like M. SPICE knows only the plain letter M, so it ignores this one like a unit. For mega, write meg (a capital M is milli in SPICE): 10meg.
>
> *ngspice:* ngspice stops reading the number at the fullwidth letter Ｍ, without a message: it reads 10 Ω. [look-alike-letter-4, mega-as-milli-1]
>
> *Fixes:* "Make it 10meg (10 MΩ)", "Keep milli: write 10m"

What PlainSpice shows for look-alike-letter-5 (warning, line 4):

> **The node оut has the Cyrillic letter о.** It looks like o, but SPICE knows only the plain letter o, so this is not the node out the other lines name: it is another node, and the parts on it are not connected to out.
>
> *ngspice:* ngspice writes the letter's bytes as underscores (__ut) and makes a separate node, without a message: in one test the resistor on it carried no current. [look-alike-letter-5]
>
> *Fixes:* "Connect to out"

What PlainSpice shows for look-alike-letter-6(error, line 2):

> **V1's value is not a number for SPICE.** Right after the -, it has the fullwidth digit ５, which looks like 5, so SPICE does not read the word as a number. Write -5.
>
> *ngspice:* ngspice stops: 'unknown parameter (-___)'. [look-alike-letter-6]
>
> *Fixes:* "Write -5 (−5 V)"

### look-alike-letter-1. к (Cyrillic), κ (Greek) and ｋ (fullwidth) are not k, and м (Cyrillic) is not m: ngspice ignores them

```spice
* letters that look like k and m
I1 0 n1 1
R1 n1 0 1к
I2 0 n2 1
R2 n2 0 1κ
I3 0 n3 1
R3 n3 0 1ｋ
I4 0 n4 1
R4 n4 0 2м
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n4                               2.000000e+00
        n3                               1.000000e+00
        n2                               1.000000e+00
        n1                               1.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 1, v(n2) = 1, v(n3) = 1, v(n4) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 1, v(n2) = 1, v(n3) = 1, v(n4) = 2
```

PlainSpice's checks: `look-alike-letter` (four times).

### look-alike-letter-2. A value starting with a minus sign from a document (U+2212) is no number: ngspice stops

```spice
* a minus sign copied from a document on a voltage source
V1 a 0 −5
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 ___5
      unknown parameter (___5)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 ___5
      unknown parameter (___5)
    Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `look-alike-letter`.

### look-alike-letter-3. Nor are the Kelvin sign, a fullwidth digit or full stop, a minus sign or a dash what they look like: 1K, 1０k, 1．5k, 1e−3 and 1e–3 are all 1 Ω

```spice
* a Kelvin sign, a fullwidth digit and full stop, a minus sign and a dash in values
I1 0 n1 1
R1 n1 0 1K
I2 0 n2 1
R2 n2 0 1０k
I3 0 n3 1
R3 n3 0 1．5k
I4 0 n4 1
R4 n4 0 1e−3
I5 0 n5 1
R5 n5 0 1e–3
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n5                               1.000000e+00
        n4                               1.000000e+00
        n3                               1.000000e+00
        n2                               1.000000e+00
        n1                               1.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 1, v(n2) = 1, v(n3) = 1, v(n4) = 1, v(n5) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 1, v(n2) = 1, v(n3) = 1, v(n4) = 1, v(n5) = 1
```

PlainSpice's checks: `look-alike-letter` (five times).

### look-alike-letter-4. Nor is a capital M from another alphabet an M: 10Μ (Greek), 10М (Cyrillic) and 10Ｍ (fullwidth) are 10 Ω

Each node sits at 10 µV with 1 µA in, so each resistor is 10 Ω. A plain capital M would make it 10 mΩ, milli (mega-as-milli-1); the student who types one of these letters means mega.

```spice
* letters that look like a capital M: Greek, Cyrillic and fullwidth
I1 0 n1 1u
R1 n1 0 10Μ
I2 0 n2 1u
R2 n2 0 10М
I3 0 n3 1u
R3 n3 0 10Ｍ
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n3                               1.000000e-05
        n2                               1.000000e-05
        n1                               1.000000e-05
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 0.000009999999999999999, v(n2) = 0.000009999999999999999, v(n3) = 0.000009999999999999999
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 0.000009999999999999999, v(n2) = 0.000009999999999999999, v(n3) = 0.000009999999999999999
```

PlainSpice's checks: `look-alike-letter` (three times).

### look-alike-letter-5. In a node name a look-alike makes another node: оut (Cyrillic о) is __ut, not out

As an invisible character does (invisible-character-3): out is left with only R1, which carries no current, and R2 sits on the node __ut.

```spice
* a Cyrillic o in a node name
V1 in 0 6
R1 in out 1k
R2 оut 0 2k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        __ut                             0.000000e+00
        out                              6.000000e+00
        in                               6.000000e+00
        v1#branch                        0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 6, v(out) = 6, v(__ut) = 0, i(v1) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 6, v(out) = 6, v(__ut) = 0, i(v1) = 0
```

PlainSpice's checks: `look-alike-letter`.

### look-alike-letter-6. Right after a sign a look-alike makes the word no number too: -５ stops ngspice

Added after the critic of round 2 (12 November 2026). The minus sign is the plain `-`, and the fullwidth digit ５ (U+FF15) comes right after it: ngspice writes the digit's three bytes as `___` and stops, as it does for a minus sign from a document at the start of a value (look-alike-letter-2). The check says where the character is, the place first: "Right after the -, it has the fullwidth digit ５, which looks like 5".

```spice
* a fullwidth digit right after the minus sign of a value
V1 a 0 -５
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 -___
      unknown parameter (-___)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 -___
      unknown parameter (-___)
    Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `look-alike-letter`.

## space-character

Added after the critic of the fixes for the final reviews (12 November 2026). A character that looks like a
space but is none for SPICE, other than the no-break space (which has its own check, nbsp): the thin space
and the narrow no-break space that documents put between a number and its unit (`4.7 kΩ`) or between groups
of digits (`10 000`), the ideographic space of Chinese and Japanese input, and Unicode's other spaces.
ngspice splits words only at ASCII white space (a space, a tab ...) and writes every byte outside printable ASCII as `_` (W16), so
it reads such a character as part of the word: inside a value the number ends there and the rest of the word
is ignored, without a message; between two words it glues them into one; at the start of a value the word is
no number, and ngspice stops. A value is read the way documents write values: a number, the space, a scale
letter and a unit (`4.7<THIN>kΩ` is meant as 4.7k; after a capital M, mega: `1<THIN>MΩ` is meant as 1meg,
and the fix also offers milli, as mega-as-milli does), or groups of three digits (`10<THIN>000` is meant as
10000). Flagged when that differs from what ngspice reads: `4.7k<THIN>Ω` is still 4.7 kΩ (space-character-6),
and no trap. Warning, with a fix that writes the value for SPICE; error when the value starts with one. The
words name the character ("a thin space (U+2009)") and never show it; the netlist editor shows it as a dot
with that name, and Explain names it too.

After the critic of round 2 (12 November 2026): groups of digits are read with a unit after them too,
as documents write `10 000 Ω`, `4 700 Ω` or `1 000 µF` (`10<THIN>000<THIN>Ω` is meant as 10000,
`1<THIN>000k` as 1000k; space-character-7, -8), and a number written some other way (`1<THIN>2`,
`0.000<THIN>001`) is flagged when taking the characters out changes what ngspice reads, with the fix
"Take it out" (space-character-11). Inside a value the fix is never "Replace it with a normal space": with
normal spaces `10 000 Ω` is three words, and ngspice stops (space-character-9). On a capacitor or an
inductor ngspice also warns that it can't find a model with the value word's name (space-character-8). In a
node name the character makes another node (`o<THIN>ut` is `o___ut`, space-character-10): the check
names it and its fix takes it out, which connects the parts to `out` when the netlist has that node; the
dangling-node check then says nothing about the pair. Where a part on the node has no value, the character
stands where a space was meant, and the glue check's fix stays (space-character-4).

What PlainSpice shows for space-character-1 (warning, line 3):

> **R1's value is read as 4.7 Ω, not 4.7 kΩ.** A thin space (U+2009) sits between 4.7 and kΩ, as documents write a number and its unit. It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the kΩ after it does not count. SPICE needs no space and no units: write 4.7k.
>
> *ngspice:* ngspice stops reading the number at the thin space and ignores the rest of the word, without a message: it reads 4.7 Ω. [space-character-1]
>
> *Fixes:* "Write 4.7k (4.7 kΩ)"

What PlainSpice shows for space-character-1 (warning, line 5):

> **R3's value is read as 1 Ω, not 1 MΩ.** A thin space (U+2009) sits between 1 and MΩ, as documents write a number and its unit. It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the MΩ after it does not count. SPICE needs no space and no units, and a capital M is milli in SPICE: for mega, write meg: 1meg.
>
> *ngspice:* ngspice stops reading the number at the thin space and ignores the rest of the word, without a message: it reads 1 Ω. [space-character-1]
>
> *Fixes:* "Make it 1meg (1 MΩ)", "Keep milli: write 1m"

What PlainSpice shows for space-character-3 (warning, line 3):

> **R1's value is read as 10 Ω, not 10 kΩ.** A thin space (U+2009) sits between 10 and 000, as documents group digits. It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the 000 after it does not count. Write the number without it: 10000.
>
> *ngspice:* ngspice stops reading the number at the thin space and ignores the rest of the word, without a message: it reads 10 Ω. [space-character-3]
>
> *Fixes:* "Write 10000 (10 kΩ)"

What PlainSpice shows for space-character-3 (warning, line 5):

> **R2's value is read as 2 Ω, not 2.2 kΩ.** A narrow no-break space (U+202F) sits between 2 and 200, as documents group digits. It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the 200 after it does not count. Write the number without it: 2200.
>
> *ngspice:* ngspice stops reading the number at the narrow no-break space and ignores the rest of the word, without a message: it reads 2 Ω. [space-character-2, space-character-3]
>
> *Fixes:* "Write 2200 (2.2 kΩ)"

What PlainSpice shows for space-character-4 (warning, line 3):

> **A thin space (U+2009) glues "0 2" into one word.** This line has a thin space (U+2009), which often comes with text copied from a document or a web page. It looks like a space, but SPICE does not treat it as one, so the words on either side become one word.
>
> *ngspice:* ngspice reads the thin space as part of the word and says nothing about it; in one test R1 n1 0<thin space>2 became a resistor with the node "0 2" and no value, which ngspice then left out. [space-character-2, space-character-4]
>
> *Fixes:* "Replace it with a normal space"

What PlainSpice shows for space-character-5 (error, line 4):

> **R1's value is not a number for SPICE.** It starts with a thin space (U+2009), which looks like a space but is none for SPICE (it often comes with text copied from a document or a web page), so SPICE does not read the word as a number. Write 2k.
>
> *ngspice:* ngspice stops: 'unknown parameter (___2k)'. [space-character-5]
>
> *Fixes:* "Write 2k (2 kΩ)"

What PlainSpice shows for space-character-7 (warning, line 3):

> **R1's value is read as 10 Ω, not 10 kΩ.** A thin space (U+2009) sits between 10 and 000, as documents group digits. It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the 000 Ω after it does not count. SPICE needs no space and no units: write 10000.
>
> *ngspice:* ngspice stops reading the number at the thin space and ignores the rest of the word, without a message: it reads 10 Ω. [space-character-7]
>
> *Fixes:* "Write 10000 (10 kΩ)"

What PlainSpice shows for space-character-7 (warning, line 5):

> **R2's value is read as 4 Ω, not 4.7 kΩ.** A thin space (U+2009) sits between 4 and 700, as documents group digits. It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the 700 Ω after it does not count. SPICE needs no space and no units: write 4700.
>
> *ngspice:* ngspice stops reading the number at the thin space and ignores the rest of the word, without a message: it reads 4 Ω. [space-character-7]
>
> *Fixes:* "Write 4700 (4.7 kΩ)"

What PlainSpice shows for space-character-7 (warning, line 7):

> **R3's value is read as 1 Ω, not 1 MΩ.** A thin space (U+2009) sits between 1 and 000k, as documents group digits. It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the 000k after it does not count. SPICE needs no space and no units: write 1000k.
>
> *ngspice:* ngspice stops reading the number at the thin space and ignores the rest of the word, without a message: it reads 1 Ω. [space-character-7]
>
> *Fixes:* "Write 1000k (1 MΩ)"

What PlainSpice shows for space-character-8 (warning, line 4):

> **C1's value is read as 1 F, not 1 mF.** A thin space (U+2009) sits between 1 and 000, as documents group digits. It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the 000 µF after it does not count. SPICE needs no space and no units: write 1000u.
>
> *ngspice:* ngspice stops reading the number at the thin space and ignores the rest of the word: it reads 1 F, and only warns that it can't find a model with the word's name. [space-character-7, space-character-8]
>
> *Fixes:* "Write 1000u (1 mF)"

What PlainSpice shows for space-character-8 (warning, line 6):

> **C2's value is read as 470 F, not 470 µF.** A thin space (U+2009) sits between 470 and µF, as documents write a number and its unit. It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the µF after it does not count. SPICE needs no space and no units: write 470u.
>
> *ngspice:* ngspice stops reading the number at the thin space and ignores the rest of the word: it reads 470 F, and only warns that it can't find a model with the word's name. [space-character-1, space-character-8]
>
> *Fixes:* "Write 470u (470 µF)"

What PlainSpice shows for space-character-10 (warning, line 3):

> **The node o ut has a thin space (U+2009) in it.** It looks like a space, but SPICE does not treat it as one: it keeps it in the name, so this is not the node out the other lines name but another node, and the parts on it are not connected to out.
>
> *ngspice:* ngspice keeps the character in the name, as underscores (o___ut), and makes a separate node, without a message: in one test the resistor on it carried no current. [space-character-10]
>
> *Fixes:* "Take it out: connect to out"

What PlainSpice shows for space-character-10 (warning, line 5):

> **The node o ut has a no-break space (U+00A0) in it.** It looks like a space, but SPICE does not treat it as one: it keeps it in the name, so this is not the node out the other lines name but another node, and the parts on it are not connected to out.
>
> *ngspice:* ngspice keeps the character in the name, as underscores (o__ut), and makes a separate node, without a message: in one test the resistor on it carried no current. [space-character-10]
>
> *Fixes:* "Take it out: connect to out"

What PlainSpice shows for space-character-11 (warning, line 3):

> **R1's value is read as 0 Ω.** A thin space (U+2009) sits between 0.000 and 001 (it often comes with text copied from a document or a web page). It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the 001 after it does not count. Without it, the value reads 0.000001.
>
> *ngspice:* ngspice stops reading the number at the thin space and ignores the rest of the word, without a message: it reads 0 Ω. [space-character-11]
>
> *Fixes:* "Take it out: write 0.000001 (1 µΩ)"

What PlainSpice shows for space-character-11 (warning, line 6):

> **R3's value is read as 1 Ω.** A thin space (U+2009) sits between 1 and 2 (it often comes with text copied from a document or a web page). It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the 2 after it does not count. Without it, the value reads 12.
>
> *ngspice:* ngspice stops reading the number at the thin space and ignores the rest of the word, without a message: it reads 1 Ω. [space-character-11]
>
> *Fixes:* "Take it out: write 12 (12 Ω)"

### space-character-1. A thin space between a value and its unit ends the number: 4.7<THIN>kΩ is 4.7 Ω, and 1<THIN>MΩ is 1 Ω

The divider the critic of the fixes copied from a PDF: R1 is 4.7 Ω, not 4.7 kΩ, so out sits at 9.99 V instead of 5 V; R3 is 1 Ω, not 1 MΩ.

```spice
* a thin space between a value and its unit, as documents write 4.7 kΩ and 1 MΩ
V1 in 0 10
R1 in out 4.7<THIN>kΩ
R2 out 0 4.7k
R3 in out2 1<THIN>MΩ
R4 out2 0 1meg
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out2                             9.999990e+00
        out                              9.990010e+00
        in                               1.000000e+01
        v1#branch                        -2.13553e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 10, v(out) = 9.99000999000999, v(out2) = 9.999990000010001, i(v1) = -0.002135534030427877
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 10, v(out) = 9.99000999000999, v(out2) = 9.999990000010001, i(v1) = -0.002135534030427877
```

PlainSpice's checks: `space-character` (twice).

### space-character-2. So do the other characters that look like a space: 1<X>k is 1 Ω for each of them

The narrow no-break space (`<NNBSP>`), the ideographic space (`<IDEO>`), the ogham space mark, the en and em quads and spaces, the three-, four- and six-per-em spaces, the figure, punctuation, thin and hair spaces and the medium mathematical space: each node sits at 1 V, so each resistor is 1 Ω.

```spice
* the other space characters inside a value
I1 0 n1 1
R1 n1 0 1<OGHAM>k
I2 0 n2 1
R2 n2 0 1<NQSP>k
I3 0 n3 1
R3 n3 0 1<MQSP>k
I4 0 n4 1
R4 n4 0 1<ENSP>k
I5 0 n5 1
R5 n5 0 1<EMSP>k
I6 0 n6 1
R6 n6 0 1<3MSP>k
I7 0 n7 1
R7 n7 0 1<4MSP>k
I8 0 n8 1
R8 n8 0 1<6MSP>k
I9 0 n9 1
R9 n9 0 1<FSP>k
I10 0 n10 1
R10 n10 0 1<PSP>k
I11 0 n11 1
R11 n11 0 1<THIN>k
I12 0 n12 1
R12 n12 0 1<HSP>k
I13 0 n13 1
R13 n13 0 1<NNBSP>k
I14 0 n14 1
R14 n14 0 1<MMSP>k
I15 0 n15 1
R15 n15 0 1<IDEO>k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n15                              1.000000e+00
        n14                              1.000000e+00
        n13                              1.000000e+00
        n12                              1.000000e+00
        n11                              1.000000e+00
        n10                              1.000000e+00
        n9                               1.000000e+00
        n8                               1.000000e+00
        n7                               1.000000e+00
        n6                               1.000000e+00
        n5                               1.000000e+00
        n4                               1.000000e+00
        n3                               1.000000e+00
        n2                               1.000000e+00
        n1                               1.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 1, v(n2) = 1, v(n3) = 1, v(n4) = 1, v(n5) = 1, v(n6) = 1, v(n7) = 1, v(n8) = 1, v(n9) = 1, v(n10) = 1, v(n11) = 1, v(n12) = 1, v(n13) = 1, v(n14) = 1, v(n15) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 1, v(n2) = 1, v(n3) = 1, v(n4) = 1, v(n5) = 1, v(n6) = 1, v(n7) = 1, v(n8) = 1, v(n9) = 1, v(n10) = 1, v(n11) = 1, v(n12) = 1, v(n13) = 1, v(n14) = 1, v(n15) = 1
```

PlainSpice's checks: `space-character` (15 times).

### space-character-3. Between groups of digits it ends the number too: 10<THIN>000 is 10

```spice
* a thin space between groups of digits, as documents write 10 000
I1 0 n1 1
R1 n1 0 10<THIN>000
I2 0 n2 1
R2 n2 0 2<NNBSP>200
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n2                               2.000000e+00
        n1                               1.000000e+01
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 10, v(n2) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 10, v(n2) = 2
```

PlainSpice's checks: `space-character` (twice).

### space-character-4. Between two words it glues them into one: R1 n1 0<THIN>2 has the node "0 2" and no value

ngspice writes the thin space's three bytes as `___` and leaves R1 out, as with a no-break space (nbsp-1).

```spice
* a thin space between two words of a line
I1 0 n1 1
R1 n1 0<THIN>2
R2 n1 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               1.000000e+00
    Warning: 'r1 n1 0___2' is not a valid resistor instance line, ignored!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(n1) = 1
```

PlainSpice's checks: `missing-value`, `space-character`.

### space-character-5. At the start of a value the word is no number: ngspice stops

```spice
* a value that starts with a thin space
I1 0 a 1
R0 a 0 1k
R1 a 0 <THIN>2k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '<THIN>2k' from line
    r1 a 0 <THIN>2k
    Error on line 4 or its substitute:
      r1 a 0 ___2k
      unknown parameter (___2k)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '<THIN>2k' from line
    r1 a 0 <THIN>2k
    Error on line 4 or its substitute:
      r1 a 0 ___2k
      unknown parameter (___2k)
    Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `space-character`.

### space-character-6. After the scale letter it changes nothing: 4.7k<THIN>Ω is 4.7 kΩ (no trap)

```spice
* a thin space after the scale letter changes nothing
V1 in 0 10
R1 in out 4.7k<THIN>Ω
R2 out 0 4.7k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out                              5.000000e+00
        in                               1.000000e+01
        v1#branch                        -1.06383e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 10, v(out) = 5, i(v1) = -0.0010638297872340426
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 10, v(out) = 5, i(v1) = -0.0010638297872340426
```

PlainSpice's checks: none.

### space-character-7. Groups of digits with a unit after them end the number at the first space too: 10<THIN>000<THIN>Ω is 10 Ω, 4<THIN>700<THIN>Ω is 4 Ω, 1<THIN>000k is 1 Ω

Added after the critic of round 2 (12 November 2026). As documents write 10 kΩ, 4.7 kΩ and 1 MΩ with their digits in groups: each resistor gets 1 A, so each node voltage is the resistance ngspice uses.

```spice
* groups of digits and a unit, as documents write 10 000 Ω, 4 700 Ω and 1 000k
I1 0 n1 1
R1 n1 0 10<THIN>000<THIN>Ω
I2 0 n2 1
R2 n2 0 4<THIN>700<THIN>Ω
I3 0 n3 1
R3 n3 0 1<THIN>000k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n3                               1.000000e+00
        n2                               4.000000e+00
        n1                               1.000000e+01
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 10, v(n2) = 4, v(n3) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 10, v(n2) = 4, v(n3) = 1
```

PlainSpice's checks: `space-character` (3 times).

### space-character-8. On a capacitor the same, and ngspice also looks the word up as a model: 1<THIN>000<THIN>µF is 1 F, 470<THIN>µF is 470 F

A capacitor's value word is also looked up as a model name, as with the Greek mu (greek-mu-2), so ngspice warns that it can't find a model with the word's name (it writes µ as u in the message). With 1 F and 470 F through 1 Ω, the capacitors charge by 1 mV and 2.1 µV in 1 ms; with 1000 µF and 470 µF they would charge to 0.63 V and 0.88 V. Native 47's time grid differs from 42's and from our engine's here (81, 80 and 59 points); the final values agree to 6 significant figures.

```spice
* 1 000 µF and 470 µF as documents write them, on capacitors
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1
C1 out 0 1<THIN>000<THIN>µF
R2 in out2 1
C2 out2 0 470<THIN>µF
.tran 0.1m 1m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '1<THIN>000<THIN>uf' from line
        c1 out 0 1<THIN>000<THIN>uf
    warning, can't find model '470<THIN>uf' from line
        c2 out2 0 470<THIN>uf
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 81 points, last 0.000999499667207256, v(out2): 81 points, last 0.000002127656247281666
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '1<THIN>000<THIN>uf' from line
        c1 out 0 1<THIN>000<THIN>uf
    warning, can't find model '470<THIN>uf' from line
        c2 out2 0 470<THIN>uf
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(out): 80 points, last 0.000999499667207603, v(out2): 80 points, last 0.000002127656247281665
our engine (wasm), as ngspice -b -r (exit 0):
    in                                           0
    out                                          0
    out2                                         0
    v1#branch                                    0
    warning, can't find model '1<THIN>000<THIN>uf' from line
        c1 out 0 1<THIN>000<THIN>uf
    warning, can't find model '470<THIN>uf' from line
        c2 out2 0 470<THIN>uf
    vectors: v(out): 59 points, last 0.0009995001666473623, v(out2): 59 points, last 0.00000212765731100201
```

PlainSpice's checks: `space-character` (twice).

### space-character-9. With normal spaces the groups are separate words: R1 in out 10 000 Ω stops ngspice

Why the fix for a value never puts a normal space where the character was: ngspice then reads 10 and 000 as two numbers and uses the last one (0, so 47 sets it to 1e-12 Ω, zero-ohm-1), and stops at Ω, which it spells `__` (W16).

```spice
* 10 000 Ω written with normal spaces: three words
V1 in 0 10
R1 in out 10 000 Ω
R2 out 0 10k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Warning: Value of resistor r1 is too small, set to 1.000000e-12
    Error on line 3 or its substitute:
      r1 in out 10 000 __
      unknown parameter (__)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      r1 in out 10 000 __
      unknown parameter (__)
    Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `zero-ohm`, `unknown-word`.

### space-character-10. In a node name it makes another node: o<THIN>ut is o___ut, and o<NBSP>ut is o__ut, not out

ngspice writes each byte of the character as `_` (the thin space has three, the no-break space two), so R1 and R3 end on nodes of their own, and no current flows: v(out) = 0 and i(v1) = 0.

```spice
* a thin space and a no-break space inside node names
V1 in 0 10
R1 in o<THIN>ut 2k
R2 out 0 2k
R3 in o<NBSP>ut 2k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        o__ut                            1.000000e+01
        out                              0.000000e+00
        o___ut                           1.000000e+01
        in                               1.000000e+01
        v1#branch                        0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 10, v(o___ut) = 10, v(out) = 0, v(o__ut) = 10, i(v1) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 10, v(o___ut) = 10, v(out) = 0, v(o__ut) = 10, i(v1) = 0
```

PlainSpice's checks: `space-character`, `nbsp`.

### space-character-11. Between digits not grouped in threes it ends the number as well: 0.000<THIN>001 is 0, 1<THIN>2 is 1

ngspice reads 0.000 for R1, a resistance of 0, which ngspice 47 sets to 1e-12 Ω with a warning and ngspice 42 to 1 mΩ without one (zero-ohm-1, zero-ohm-2), and 1 for R3.

```spice
* a thin space that is not between groups of three digits: 0.000 001 and 1 2
I1 0 n1 1
R1 n1 0 0.000<THIN>001
R2 n1 0 1
I2 0 n2 1
R3 n2 0 1<THIN>2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n2                               1.000000e+00
        n1                               1.000000e-12
    Warning: Value of resistor r1 is too small, set to 1.000000e-12
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 9.99999999999e-13, v(n2) = 1
ngspice 42, ngspice -b (exit 0):
        n2                               1.000000e+00
        n1                               9.990010e-04
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 0.000999000999000999, v(n2) = 1
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(n1) = 9.99999999999e-13, v(n2) = 1
```

PlainSpice's checks: `space-character`, `zero-ohm`, `space-character`.
