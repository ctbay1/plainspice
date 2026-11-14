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
`<MMSP>` (a medium mathematical space), and in those added after the re-check of the fixes (12 November 2026) `<LSEP>` (a line separator), `<PSEP>` (a paragraph separator), `<NEL>` (a next-line character), `<MVS>` (a Mongolian vowel separator), `<ALM>` (an Arabic letter mark), `<CGJ>` (a combining grapheme joiner), `<HCF>`, `<HJF>`, `<HF>`, `<HWHF>` (the Hangul choseong, jungseong, plain and halfwidth fillers), `<VS16>` (a variation selector) and `<LANG>` (a language tag).

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
| [unit-letter](#unit-letter) | `3A` (atto), `1F` on a capacitor (femto) | warning, info | reads atto or femto, silently (on a resistor ngspice 47 warns that it is too small: see zero-ohm) |
| [greek-mu](#greek-mu) | the Greek letter μ in a value | warning | ignores it; silently, except a model warning on C and L |
| [rkm-notation](#rkm-notation) | `2k2`, `4k7`, `1M5`, `4R7` | warning | ignores the digits after the letter, silently (`0R47` is 0 Ω: see zero-ohm) |
| [decimal-comma](#decimal-comma) | `1,5k` | error, warning | R, C, L: keeps the second number; V, I: stops |
| [sign-in-value](#sign-in-value) | `1k-2`, `1d-3` on R, C or L | warning | keeps the second number: −2 Ω, silently (C, L: a model warning) |
| [space-before-suffix](#space-before-suffix) | `1 k`, `5 V`, `1 m` | error | stops, or silently takes the word as a setting |
| [midline-comment](#midline-comment) | `R1 a b 2 * load` | error | stops |
| [nbsp](#nbsp) | a no-break space between two words, or between a value and its unit (`4.7<NBSP>kΩ`), or right after a sign (`-<NBSP>1m`), or in a formula | warning, error | glues two words, silently; ends the number (on C and L ngspice warns it can't find a model; a resistor read as 0: see zero-ohm); after a sign or in a formula: stops |
| [missing-value](#missing-value) | `R1 a 0`, `V1 a 0`, `E1 a 0 c 0`, `E1 a 0 c 0 gain` (not an E or G given by a formula, `VALUE={...}`) | error, warning | R, C, L left out; V, I are 0; E-H: see text |
| [missing-fields](#missing-fields) | `R1 a`, `V1 a`, `E1 a 0 2`, `F1 0 a 5`; one word before an E's formula: `E1 e 0 x VALUE={2}` | error, warning | R, C, L left out; others stop or misread |
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
| [model-not-in-engine](#model-not-in-engine) | BSIM, HiSIM, SOI, HICUM, JFET2 levels, O lines (LTRA), and E, F, G or H written with POLY or TABLE (XSPICE) | error | our engine stops; native 47 runs it |
| [dc-sweep-problems](#dc-sweep-problems) | `.dc` with a zero or missing step, the wrong direction, a step past the end, a source not in the circuit, a word that is no number where a number goes, a sweep missing its numbers, a number too many, a name with a hidden character | error, warning | stops, hangs (42), or no points; in two sweeps a sweep the wrong way never moves |
| [tran-problems](#tran-problems) | `.tran` with one number, a step or a stop time of 0 or less, a start after the stop, a step longer than the run | error, info | stops; or runs anyway (info) |
| [tf-problems](#tf-problems) | `.tf` of a missing node, i( ) of a non-source, a missing or wrong input | error | silent wrong answers, or stops |
| [no-analysis](#no-analysis) | no analysis line | error | runs nothing |
| [missing-end](#missing-end) | no `.end` | info | fine from a file |
| [after-end](#after-end) | lines after `.end` | warning | still read from a file (unless `.end;...`) |
| [zero-ohm](#zero-ohm) | a resistor below 1e-12 Ω, `r=0` too (a 0 another check explains is that check's, with the same words) | warning, error | 47: 1e-12 Ω with a warning (inside a subcircuit for r.x1.r1; −1e-12 Ω for a negative value); 42: 1 mΩ for 0, any other value as written, silently; across a source: absurd currents |
| [fatal-syntax](#fatal-syntax) | an unclosed `{` or `'`, an undefined parameter, a malformed B line, an E or G formula ngspice can't read (`VALUE=3`, `VALUE=2*v(out)`, `VALUE=`) | error | stops with a fatal error |
| [include-not-available](#include-not-available) | `.include`, `.lib file section`, `.lib` with one word | error | stops: the file is not there, or `.lib` is not recognised |
| [lost-continuation](#lost-continuation) | a `+` line that ngspice loses | warning | loses it, silently |
| [unknown-word](#unknown-word) | a word after a part's value that is no setting of the part: `R1 a 0 1k load`, `V1 a 0 5 battery`, `1d-3` on a source; a word where the value goes that is no number and no `.param` name it can see: `E1 b 0 a 0 Av`; a setting the part does not have where its value goes: `G1 0 b a 0 gm=1m`; a sign with a space after it: `- 5`; `m=` after an E's or H's gain | error | stops ("unknown parameter"; E-H natively: a polynomial error, but not for a setting where the value goes, or `m=`) |
| [unknown-dot-command](#unknown-dot-command) | a dot command ngspice does not know: `.tarn`, `.pss` | error | stops before anything runs |
| [non-ascii-node](#non-ascii-node) | a node name with a letter outside a to z (`giriş`); two names ngspice spells the same (`ş` and `ç`) | warning, error | writes each byte as `_`; joins the two nodes, silently |
| [invisible-character](#invisible-character) | an invisible character inside a value (`1<ZWSP>k`) or a node name (`ou<ZWSP>t`), a number of `.tran`, `.dc`, `.ac` or `.noise`, of a source's function, AC value or setting | warning, error | ends the number silently (on C and L, ngspice warns it can't find a model; a resistor read as 0: see zero-ohm); another node; at the start of a value: stops; elsewhere: as the place does with the number read, or nothing claimed where the line has a problem of its own |
| [look-alike-letter](#look-alike-letter) | a letter from another alphabet in a value (`1к`, `1κ`, `1ｋ`, `2м`), the Kelvin sign, a fullwidth digit or full stop, a minus sign or a dash from a document (`1e−3`, `−5`), a document's decimal point (`4·7k`), the letter O for the digit 0 (`1Ok`, `1OkΩ`, `1OOk`, `1OA`, `O.47k`), another character outside ASCII inside a number (`4。7k`) | warning, error | ends the number silently (on C and L, ngspice warns it can't find a model; a resistor read as 0: see zero-ohm); at the start of a value: stops; elsewhere: as the place does with the number read |
| [space-character](#space-character) | another character that looks like a space: a thin, narrow no-break or ideographic space between a value and its unit (`4.7<THIN>kΩ`), between groups of digits (`10<THIN>000`, `10<THIN>000<THIN>Ω`), right after a sign (`-<THIN>5`), in a node name (`o<THIN>ut`), in a formula (`V=v(out)<THIN>*2`) or between two words | warning, error | ends the number silently (on C and L, ngspice warns it can't find a model; a resistor read as 0: see zero-ohm); another node; glues two words, silently (on an analysis line the glued word is one number: as its place does with it); at the start of a value, right after a sign or in a formula: stops |
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

On a resistor an atto value is below 1e-12 Ω (`3a` is 3e-18 Ω): ngspice 47 raises it to 1e-12 Ω and warns, and ngspice 42 keeps it as written, without a word (zero-ohm-7, zero-ohm-8, P24). After the last pass (13 November 2026, F4) this check says so there, where it said "says nothing", and the zero-ohm check leaves such a value to it: one card for the word, whose fix writes the number meant.

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
    rawfile: a Transient Analysis plot whose header says 0 points (no results); 40 bytes of zeros, one point's worth, follow its Binary: line
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

After the last pass (13 November 2026): a capacitor's `p` and an inductor's `v` and `volt` give the same two messages, each version its own (space-before-suffix-19), and so do a voltage source's `p` and a current source's `p` and `v` (space-before-suffix-20).

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

What PlainSpice shows for space-before-suffix-18 (error, line 3):

> **4·7 kΩ: the space splits the value in two.** SPICE reads 4·7 kΩ as two words, 4·7 and kΩ, and stops reading 4·7 at the middle dot (U+00B7). Write 4.7k.
>
> *ngspice:* ngspice looks for a model called kΩ, warns 'can't find model', and stops: 'unknown parameter (k__)'. [space-before-suffix-1, space-before-suffix-16, space-before-suffix-18]
>
> *Fixes:* "Write 4.7k"

### space-before-suffix-18. 4·7 kΩ as a British document writes it: ngspice reads 4, then stops at kΩ

Added after the re-check (12 November 2026, C5). The middle dot ends the number (look-alike-letter-9) and the space splits off the unit, so the check reads the pair as the document meant it and writes 4.7k in one click.

```spice
* a middle dot and a space, as a British document writes 4·7 kΩ
V1 in 0 10
R1 in out 4·7 kΩ
R2 out 0 10k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'kΩ' from line
        r1 in out 4·7 kΩ
    Error on line 3 or its substitute:
      r1 in out 4__7 k__
      unknown parameter (k__)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'kΩ' from line
        r1 in out 4·7 kΩ
    Error on line 3 or its substitute:
      r1 in out 4__7 k__
      unknown parameter (k__)
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

### space-before-suffix-19. A capacitor's or an inductor's p, and an inductor's v or volt, after a space: values the part can only report, so ngspice 47 stops with "no such parameter on this device or parameter is missing" (ngspice 42: "no such parameter on this device")

Added after the round-1 critic of the last pass's fixes (13 November 2026, C7), as the record of the runs space-before-suffix-12 noted in a paragraph. `1 p` on a capacitor or an inductor and `1 v` or `1 volt` on an inductor are two words for ngspice, and the second names a value the part can only report: its power, an inductor's voltage (ngspice's tables in cap.c and ind.c, and `src/spice/parse.ts`). So each version stops with its own words of space-before-suffix-12, which the check says: "ngspice 47 stops: 'no such parameter on this device or parameter is missing' (ngspice 42: 'no such parameter on this device')". Until then the check quoted "unknown parameter (volt)" for `volt`, and cited space-before-suffix-12, a resistor's record, for the others. Its fix joins the words (`1p`, `1`).

```spice
* a space before p on a capacitor: p is its power, which it can only report
V1 in 0 1
R9 in out 1k
C1 out 0 1 p
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      c1 out 0 1 p
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      c1 out 0 1 p
    no such parameter on this device
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same lines as ngspice 47 -b -r
    vectors: (none)
```

```spice
* a space before v on an inductor: v is its voltage, which it can only report
V1 in 0 1
R9 in out 1k
L1 out 0 1 v
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      l1 out 0 1 v
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      l1 out 0 1 v
    no such parameter on this device
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same lines as ngspice 47 -b -r
    vectors: (none)
```

```spice
* a space before volt on an inductor: volt is its voltage too
V1 in 0 1
R9 in out 1k
L1 out 0 1 volt
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      l1 out 0 1 volt
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      l1 out 0 1 volt
    no such parameter on this device
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same lines as ngspice 47 -b -r
    vectors: (none)
```

```spice
* a space before p on an inductor: p is its power, which it can only report
V1 in 0 1
R9 in out 1k
L1 out 0 1 p
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      l1 out 0 1 p
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      l1 out 0 1 p
    no such parameter on this device
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same lines as ngspice 47 -b -r
    vectors: (none)
```

PlainSpice's checks: `space-before-suffix`; `space-before-suffix`; `space-before-suffix`; `space-before-suffix`.

### space-before-suffix-20. A voltage source's p and a current source's p or v after a space: the same two messages; a voltage source reports no v, so `5 v` gives "unknown parameter (v)"

Added after the round-1 critic of the last pass's fixes (13 November 2026, C4 and C7). A voltage source can only report its current (`i`) and its power (`p`), a current source its voltage (`v`) and its power (`p`) (vsrc.c and isrc.c), so `dc 5 p`, `1 p` (1 pA meant) and `1 v` stop ngspice 47 with "no such parameter on this device or parameter is missing" and ngspice 42 with "no such parameter on this device", where the check quoted "unknown parameter" until the last pass (F10). A voltage source has no `v` to report: `5 v` gives "unknown parameter (v)" in both versions, as the check says.

```spice
* a space before p on a voltage source: p is its power, which it can only report
V1 a 0 dc 5 p
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 dc 5 p
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 dc 5 p
    no such parameter on this device
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same lines as ngspice 47 -b -r
    vectors: (none)
```

```spice
* a space before p on a current source: 1 p meant as 1 pA
I1 0 a 1 p
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a 1 p
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a 1 p
    no such parameter on this device
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same lines as ngspice 47 -b -r
    vectors: (none)
```

```spice
* a space before v on a current source: v is its voltage, which it can only report
I1 0 a 1 v
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a 1 v
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a 1 v
    no such parameter on this device
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same lines as ngspice 47 -b -r
    vectors: (none)
```

```spice
* a space before v on a voltage source, which reports no v
V1 a 0 5 v
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 5 v
      unknown parameter (v)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 5 v
      unknown parameter (v)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same lines as ngspice 47 -b -r
    vectors: (none)
```

PlainSpice's checks: `space-before-suffix`; `space-before-suffix`; `space-before-suffix`; `space-before-suffix`.

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

A no-break space (U+00A0) inside a word of a part, dot-command or continuation line, usually from text copied out of a web page or a PDF. Warning. Fix: a normal space. In a formula ngspice stops, and the fix takes it out (nbsp-4; added after the last pass, 13 November 2026, as for the other characters that look like a space, space-character-22). Between a value and its unit, as documents write `4.7 kΩ` (added after the critic of the fixes for the final reviews, 12 November 2026), the value is read the way the document meant it and the fix writes it for SPICE, `4.7k`, as for the other characters that look like a space (space-character).

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

What PlainSpice shows for nbsp-3 (error, line 2):

> **I1's value is not a number for SPICE.** Right after the -, it has a no-break space (U+00A0), which looks like a space but is none for SPICE (it often comes with text copied from a document or a web page), so SPICE does not read the word as a number. Write -1m.
>
> *ngspice:* ngspice stops: 'unknown parameter (-__1m)'. [nbsp-3]
>
> *Fixes:* "Write -1m (−1 mA)"

### nbsp-3. Right after a sign a no-break space makes the word no number too: -<NBSP>1m stops ngspice

Added after the re-check (12 November 2026, C2), as space-character-12 for the no-break space.

```spice
* a no-break space right after the minus sign of a value
I1 0 a -<NBSP>1m
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a -__1m
      unknown parameter (-__1m)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a -__1m
      unknown parameter (-__1m)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `nbsp`.

### nbsp-4. A no-break space in a formula stops ngspice too: taken out, the formula runs

```spice
* a no-break space in a formula
V1 in 0 5
R1 in out 1k
R2 out 0 1k
B1 e 0 V=v(out)<NBSP>*2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      b1 e 0 v= v(out) _ _ *   2.0000000000e+00
      unknown parameter (_)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      b1 e 0 v= v(out) _ _ *   2.0000000000e+00
      unknown parameter (_)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
after the fix "Take it out" (nbsp), which writes `B1 e 0 V=v(out)*2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, i(b1) = -0.005, i(v1) = -0.0025
```

PlainSpice's checks: `nbsp`.

### nbsp-5. A no-break space between v and its bracket: "Undefined parameter [v]", as for a thin space

Added after the last pass (13 November 2026, round-1 critic of the formulas lane, CR1-4). As with a thin space (space-character-23), ngspice takes the v for a name of its own and stops with a fatal error: "Undefined parameter [v]", then "Cannot compute substitute". In braces too, and with a capital V. The fix takes the character out, and the formula runs.

```spice
* a no-break space between v and its bracket
V1 in 0 5
R1 in out 1k
R2 out 0 1k
B1 e 0 V=v<NBSP>(out)*2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error in netlist line no. 7, new internal line no. 5:
    Undefined parameter [v]
    Error in netlist line no. 7, new internal line no. 5:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Netlist line no. 5:
    Undefined parameter [v]
    Netlist line no. 5:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
after the fix "Take it out" (nbsp), which writes `B1 e 0 V=v(out)*2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, i(b1) = -0.005, i(v1) = -0.0025
in braces (V={v<NBSP>(out)*2}):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error in netlist line no. 7, new internal line no. 5:
      Undefined parameter [v]
      Cannot compute substitute
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      Undefined parameter [v]
      Cannot compute substitute
      ERROR: fatal error in ngspice, exit(1)
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
on an E line (VALUE={v<NBSP>(out)*2}):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error in netlist line no. 9, new internal line no. 5:
      Undefined parameter [v]
      Cannot compute substitute
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      Undefined parameter [v]
      Cannot compute substitute
      ERROR: fatal error in ngspice, exit(1)
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
a capital V (V=V<NBSP>(out)*2):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error in netlist line no. 7, new internal line no. 5:
      Undefined parameter [v]
      Cannot compute substitute
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      Undefined parameter [v]
      Cannot compute substitute
      ERROR: fatal error in ngspice, exit(1)
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
v alone, no bracket after it (V=v<NBSP>*2+v(out)*2):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error in netlist line no. 7, new internal line no. 5:
      Undefined parameter [v]
      Cannot compute substitute
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      Undefined parameter [v]
      Cannot compute substitute
      ERROR: fatal error in ngspice, exit(1)
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
```

PlainSpice's checks: `nbsp`.

### nbsp-6. Two no-break spaces in a formula, the first after a number: one error, and its fix takes both out

Added after the last pass (13 November 2026, round-1 critic of the formulas lane, CR1-4). Text copied from a web page often has a no-break space on each side of an operator. ngspice stops at the first: after a number, "unknown parameter (_)" (space-character-27). Before, the checks read 2<NBSP> as a value and left that character in the fix's text, which then stopped ngspice with no check left; the fix now takes every such character out of the formula, and it runs.

```spice
* two no-break spaces in a formula
V1 in 0 5
R1 in out 1k
R2 out 0 1k
B1 e 0 V=2<NBSP>*<NBSP>v(out)
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      b1 e 0 v=   2.0000000000e+00 _ _ * _ _ v(out)
      unknown parameter (_)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      b1 e 0 v=   2.0000000000e+00 _ _ * _ _ v(out)
      unknown parameter (_)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
after the fix "Take them out" (nbsp), which writes `B1 e 0 V=2*v(out)`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, i(b1) = -0.005, i(v1) = -0.0025
```

PlainSpice's checks: `nbsp`.

### nbsp-7. A no-break space between VALUE and its { (without =): ngspice drops it, and the line runs (no trap)

Added after the round-2 critic of the formulas lane (13 November 2026, CR2-6). After VALUE without `=`, ngspice takes an E's or G's formula from its first `{` and drops what stands before it (inp_compat), a no-break space too, with a normal space before it or not, and even right after VALUE, which it still reads as the word value (no letter, digit or `_` follows). Before `=` the same: VALUE<NBSP>=v(out)*2 runs. Native 47 and 42 and our engine run each line below (e1 = 5 V, e2 = 7.5 V, e3 = 10 V). Only right after `=` does the character stop ngspice, as at the start of any formula (space-character-25).

```spice
* a no-break space between VALUE and its brace
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e1 0 VALUE <NBSP>{v(out)*2}
R1e e1 0 1k
E2 e2 0 VALUE<NBSP>{v(out)*3}
R2e e2 0 1k
E3 e3 0 VALUE<NBSP>=v(out)*4
R3e e3 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e3_int1                          1.000000e+01
        e3                               1.000000e+01
        e2_int1                          7.500000e+00
        e2                               7.500000e+00
        e1_int1                          5.000000e+00
        e1                               5.000000e+00
        out                              2.500000e+00
        in                               5.000000e+00
        v1#branch                        -2.50000e-03
        e1#branch                        -5.00000e-03
        e2#branch                        -7.50000e-03
        e3#branch                        -1.00000e-02
        be1#branch                       0.000000e+00
        be2#branch                       0.000000e+00
        be3#branch                       0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 2.5, v(e1) = 5, v(e1_int1) = 5, v(e2) = 7.5, v(e2_int1) = 7.5, v(e3) = 10, v(e3_int1) = 10, i(be3) = 0, i(be2) = 0, i(be1) = 0, i(e3) = -0.01, i(e2) = -0.0075, i(e1) = -0.005, i(v1) = -0.0025
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 5, v(out) = 2.5, v(e1) = 5, v(e1_int1) = 5, v(e2) = 7.5, v(e2_int1) = 7.5, v(e3) = 10, v(e3_int1) = 10, i(be3) = 0, i(be2) = 0, i(be1) = 0, i(e3) = -0.01, i(e2) = -0.0075, i(e1) = -0.005, i(v1) = -0.0025
G1 0 g VALUE<THIN>{v(out)*2m}, a thin space:
    ngspice 47 and 42, -b -r (exit 0): v(in) = 5, v(out) = 2.5, v(g) = 5, v(g1_int1) = 0.005, i(bg1) = 0, i(v1) = -0.0025
    our engine (exit 0): v(in) = 5, v(out) = 2.5, v(g) = 5, v(g1_int1) = 0.005, i(bg1) = 0, i(v1) = -0.0025
E1 e 0 VALUE=<NBSP>{v(out)*2}, the character right after =, which PlainSpice's checks call an error (nbsp):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
```

PlainSpice's checks: no trap.

### nbsp-8. A name with a no-break space that only a formula reads is a node nothing connects to: 'singular matrix', and no results

Added after the round-2 critic of the formulas lane (13 November 2026, CR2-2). As space-character-32: ngspice reads v(out<NBSP>) as the node out__, which no part connects to, warns "singular matrix: check node out__" and stops. Taken out, the formula reads out: e = 5 V.

```spice
* a no-break space in a name only a formula reads
V1 in 0 5
R1 in out 1k
R2 out 0 1k
B1 e 0 V=v(out<NBSP>)*2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    DC solution failed -
    Last Node Voltages
    Node                                   Last Voltage        Previous Iter
    ----                                   ------------        -------------
    in                                                0                    0
    out                                               0                    0
    e                                                 0                    0
    out__                                             0                    0
    b1#branch                                         0                    0
    v1#branch                                         0                    5 *
    Warning: singular matrix:  check node out__
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node out__
    Warning: singular matrix:  check node out__
    Warning: singular matrix:  check node out__
    Warning: singular matrix:  check node out__
    Warning: singular matrix:  check node out__
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
    rawfile: (no rawfile data)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
after the fix "Take it out: connect to node out" (nbsp), which writes `B1 e 0 V=v(out)*2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, i(b1) = -0.005, i(v1) = -0.0025
```

PlainSpice's checks: `nbsp`.

## missing-value

A part line with its nodes but no value. R, C and L: warning (ngspice leaves the part out when nothing follows the nodes; with settings such as m=2 or ic=0 it keeps it: a resistor at 1 mΩ with a warning, a capacitor or inductor without capacitance or inductance, silently: missing-value-8 to -10). V and I: warning (ngspice uses 0); for V the fix writes the 0 explicitly, which is right for an ammeter. E, F, G and H: error, because native ngspice 47 stops while PlainSpice's engine silently uses 0. After the re-check of the fixes (12 November 2026, S6), E, F, G and H are told apart by what follows the nodes: with nothing at all, native 47 stops (missing-value-4 to -7); with settings but no number (`gain`, `m=2`), native 47 and 42, like our engine, use 0 and say nothing (missing-value-11 to -14); a word ngspice cannot read where the gain goes is no missing gain, but the character checks' or unknown-word's (invisible-character-26, look-alike-letter-14, unknown-word-18 to -21). After the last pass (13 November 2026, code review C3-5): an E given by a formula, `VALUE={...}` or `vol={...}`, and a G given by `VALUE={...}` or `cur={...}`, has two nodes and no gain, and needs none: ngspice turns the line into a B source, and native 47 and 42 and our engine run it (missing-value-15 to -17). Before, its words were read as control nodes and a gain: "E1 has no gain", "value has no DC path to ground", and no numbers.

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

What PlainSpice shows for missing-value-11 (error, line 4):

> **E1 has no gain.** An E line ends with its gain: E1 out 0 c 0 2 makes the voltage at out 2 x the voltage at c. E1 has settings but no gain, so its output is 0.
>
> *ngspice:* ngspice uses 0 and says nothing: in one test E1's output stayed at 0. [missing-value-11, missing-value-12]
>
> *Fixes:* none

### missing-value-11. E with the word gain but no number: native 47 and 42, like our engine, use 0 and say nothing

Added after the re-check (12 November 2026, S6). The output stays at 0 V, without a message from any of the three.

```spice
* E with the word gain but no number
V1 a 0 1
R0 a 0 1k
E1 b 0 a 0 gain
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
            b                                0.000000e+00
            a                                1.000000e+00
            v1#branch                        -1.00000e-03
            e1#branch                        0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 1, v(b) = 0, i(e1) = 0, i(v1) = -0.001
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 1, v(b) = 0, i(e1) = 0, i(v1) = -0.001
```

PlainSpice's checks: `missing-value`.

### missing-value-12. G with a setting (m=2) but no value: the same

```spice
* G with a setting but no value
V1 a 0 1
R0 a 0 1k
G1 0 b a 0 m=2
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
            b                                0.000000e+00
            a                                1.000000e+00
            v1#branch                        -1.00000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 1, v(b) = 0, i(v1) = -0.001
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 1, v(b) = 0, i(v1) = -0.001
```

PlainSpice's checks: `missing-value`.

### missing-value-13. F with a setting but no gain: the same

```spice
* F with a setting but no gain
V1 a 0 1
R0 a 0 1k
F1 0 b V1 m=2
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
            b                                0.000000e+00
            a                                1.000000e+00
            v1#branch                        -1.00000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 1, v(b) = 0, i(v1) = -0.001
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 1, v(b) = 0, i(v1) = -0.001
```

PlainSpice's checks: `missing-value`.

### missing-value-14. H with the word gain but no number: the same

```spice
* H with the word gain but no number
V1 a 0 1
R0 a 0 1k
H1 b 0 V1 gain
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
            b                                0.000000e+00
            a                                1.000000e+00
            v1#branch                        -1.00000e-03
            h1#branch                        0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 1, v(b) = 0, i(h1) = 0, i(v1) = -0.001
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 1, v(b) = 0, i(h1) = 0, i(v1) = -0.001
```

PlainSpice's checks: `missing-value`.

### missing-value-15. An E given by a formula, VALUE={...}, has no gain and needs none (no trap)

ngspice reads `VALUE=` on an E line as a formula for its output (inp_compat in its inpcom.c makes the line a B source, `be1`, whose node `e1_int1` the printout lists), so the line has two nodes and no control nodes or gain. Native ngspice 47 and 42 and our engine give e = 5 V. Before this check read the form, PlainSpice said "E1 has no gain", "value has no DC path to ground" and "{v(out)*2} has no DC path to ground", and showed no numbers (code review C3-5).

```spice
* an E given by a formula
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e 0 VALUE={v(out)*2}
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e1_int1                          5.000000e+00
        e                                5.000000e+00
        out                              2.500000e+00
        in                               5.000000e+00
        v1#branch                        -2.50000e-03
        e1#branch                        -5.00000e-03
        be1#branch                       0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, i(be1) = 0, i(e1) = -0.005, i(v1) = -0.0025
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, i(be1) = 0, i(e1) = -0.005, i(v1) = -0.0025
```

PlainSpice's checks: no trap.

### missing-value-16. The other ways to write it: value =, VALUE without =, vol=, vol='...', and the formula on a + line (no trap)

`VALUE` in any case, with `=` or without, `vol=` with braces or single quotes (ngspice makes the quotes braces), and the formula on a continuation line: each E gives 5 V in native 47 and 42 and in our engine.

```spice
* E given by a formula, written five ways
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e1 0 value = {v(out)*2}
R1e e1 0 1k
E2 e2 0 VALUE {v(out)*2}
R2e e2 0 1k
E3 e3 0 vol={v(out)*2}
R3e e3 0 1k
E4 e4 0 vol='v(out)*2'
R4e e4 0 1k
E5 e5 0 VALUE=
+ {v(out)*2}
R5e e5 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e5_int1                          5.000000e+00
        e5                               5.000000e+00
        e4_int1                          5.000000e+00
        e4                               5.000000e+00
        e3_int1                          5.000000e+00
        e3                               5.000000e+00
        e2_int1                          5.000000e+00
        e2                               5.000000e+00
        e1_int1                          5.000000e+00
        e1                               5.000000e+00
        out                              2.500000e+00
        in                               5.000000e+00
        v1#branch                        -2.50000e-03
        e1#branch                        -5.00000e-03
        e2#branch                        -5.00000e-03
        e3#branch                        -5.00000e-03
        e4#branch                        -5.00000e-03
        e5#branch                        -5.00000e-03
        be1#branch                       0.000000e+00
        be2#branch                       0.000000e+00
        be3#branch                       0.000000e+00
        be4#branch                       0.000000e+00
        be5#branch                       0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 2.5, v(e1) = 5, v(e1_int1) = 5, v(e2) = 5, v(e2_int1) = 5, v(e3) = 5, v(e3_int1) = 5, v(e4) = 5, v(e4_int1) = 5, v(e5) = 5, v(e5_int1) = 5, i(be5) = 0, i(be4) = 0, i(be3) = 0, i(be2) = 0, i(be1) = 0, i(e5) = -0.005, i(e4) = -0.005, i(e3) = -0.005, i(e2) = -0.005, i(e1) = -0.005, i(v1) = -0.0025
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 5, v(out) = 2.5, v(e1) = 5, v(e1_int1) = 5, v(e2) = 5, v(e2_int1) = 5, v(e3) = 5, v(e3_int1) = 5, v(e4) = 5, v(e4_int1) = 5, v(e5) = 5, v(e5_int1) = 5, i(be5) = 0, i(be4) = 0, i(be3) = 0, i(be2) = 0, i(be1) = 0, i(e5) = -0.005, i(e4) = -0.005, i(e3) = -0.005, i(e2) = -0.005, i(e1) = -0.005, i(v1) = -0.0025
```

PlainSpice's checks: no trap.

### missing-value-17. A G given by a formula: VALUE= or cur= (no trap)

On a G line ngspice reads `VALUE=` and `cur=` as a formula for the current the source pushes (again a B source, `bg1`, with a node `g1_int1`): 5 mA from ground into g1 and g2, so 5 V across each 1 kΩ, in native 47 and 42 and in our engine.

```spice
* G given by a formula
V1 in 0 5
R1 in out 1k
R2 out 0 1k
G1 0 g1 VALUE={v(out)*2m}
Rg1 g1 0 1k
G2 0 g2 cur='v(out)*2m'
Rg2 g2 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        g2_int1                          5.000000e-03
        g2                               5.000000e+00
        g1_int1                          5.000000e-03
        g1                               5.000000e+00
        out                              2.500000e+00
        in                               5.000000e+00
        v1#branch                        -2.50000e-03
        bg1#branch                       0.000000e+00
        bg2#branch                       0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 2.5, v(g1) = 5, v(g1_int1) = 0.005, v(g2) = 5, v(g2_int1) = 0.005, i(bg2) = 0, i(bg1) = 0, i(v1) = -0.0025
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 5, v(out) = 2.5, v(g1) = 5, v(g1_int1) = 0.005, v(g2) = 5, v(g2_int1) = 0.005, i(bg2) = 0, i(bg1) = 0, i(v1) = -0.0025
```

PlainSpice's checks: no trap.

## missing-fields

A part line with fewer nodes than the part needs, or an F or H line without its control source (a number where the source's name goes counts as missing). R, C and L: warning (left out); V, I, E, F, G and H: error. These parts are also left out of the circuit checks below, because their words are misread. After the last pass (13 November 2026, code review C3-5): exactly one word between an E's or G's output nodes and its formula (`E1 e 0 x VALUE={2}`) stops native ngspice ("not enough parameters in line"), whose XSPICE first reads the line as a polynomial, while our engine drops the word as ngspice drops two or more: a warning whose fix takes the word out (missing-fields-9).

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

### missing-fields-9. One word between an E's output nodes and its formula: native ngspice stops, our engine drops it (warning)

Added after the last pass (13 November 2026, code review C3-5). With exactly one word there, native ngspice first reads the line as a polynomial (inp_poly_2g6_compat, an XSPICE step) and stops: "not enough parameters in line" (47 with -b -r then never finished: stopped after 30 s here, and it crashed in an earlier run). Our engine, built without XSPICE, drops the word as ngspice drops two or more (unknown-word-54, -55) and gives e = 2 V. The fix takes the word out; then all three give e = 2 V.

```spice
* one word between the output nodes and the formula
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e 0 x VALUE={2}
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: not enough parameters in line
       e1 e 0 x value={2}
        line no 5, file c.cir
    No circuit loaded!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit null)
    rawfile: (did not finish in 30 s: stopped)
ngspice 42, ngspice -b (exit 1):
    Error: not enough parameters in line
       e1 e 0 x value={2}
    No circuit loaded!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: there aren't any circuits loaded.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 5, v(out) = 2.5, v(e) = 2, v(e1_int1) = 2, i(be1) = 0, i(e1) = -0.002, i(v1) = -0.0025
after the fix "Take out x" (missing-fields), which writes `E1 e 0 VALUE={2}`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 2, v(e1_int1) = 2, i(be1) = 0, i(e1) = -0.002, i(v1) = -0.0025
```

PlainSpice's checks: `missing-fields`.

### missing-fields-10. One word before a formula with a bracket in it, or VALUE {…} without =: native ngspice runs it too (no trap)

Added after the last pass (13 November 2026, formulas lane, round 2). Native ngspice's XSPICE step that stops at one word before a formula (missing-fields-9; inp_poly_2g6_compat in its inpcom.c) reads the words after it up to a blank or a bracket: when a bracket comes, as in v(out), or the formula follows VALUE in braces without =, it finds what it looks for and lets the line through, and ngspice drops the word as our engine does. So E1 e 0 x VALUE={v(out)*2} gives e = 5 V in all three, and the checks say nothing; with no bracket after the word (VALUE={2}, VALUE = {2}, cur={2m}) native ngspice stops, and the check warns (the last runs below).

```spice
* one word before a formula with a bracket
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e 0 x VALUE={v(out)*2}
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e1_int1                          5.000000e+00
        e                                5.000000e+00
        out                              2.500000e+00
        in                               5.000000e+00
        v1#branch                        -2.50000e-03
        e1#branch                        -5.00000e-03
        be1#branch                       0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, i(be1) = 0, i(e1) = -0.005, i(v1) = -0.0025
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, i(be1) = 0, i(e1) = -0.005, i(v1) = -0.0025
VALUE {2}, without =:
    ngspice 47 and 42, -b -r (exit 0): v(in) = 5, v(out) = 2.5, v(e) = 2, v(e1_int1) = 2, i(be1) = 0, i(e1) = -0.002, i(v1) = -0.0025
    our engine (exit 0): v(in) = 5, v(out) = 2.5, v(e) = 2, v(e1_int1) = 2, i(be1) = 0, i(e1) = -0.002, i(v1) = -0.0025
VALUE=v(out)*2, without braces:
    ngspice 47 and 42, -b -r (exit 0): v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, i(be1) = 0, i(e1) = -0.005, i(v1) = -0.0025
    our engine (exit 0): v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, i(be1) = 0, i(e1) = -0.005, i(v1) = -0.0025
vol='v(out)*2':
    ngspice 47 and 42, -b -r (exit 0): v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, i(be1) = 0, i(e1) = -0.005, i(v1) = -0.0025
    our engine (exit 0): v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, i(be1) = 0, i(e1) = -0.005, i(v1) = -0.0025
a G line, cur={v(out)*2m}:
    ngspice 47 and 42, -b -r (exit 0): v(in) = 5, v(out) = 2.5, v(e) = 5, v(g1_int1) = 0.005, i(bg1) = 0, i(v1) = -0.0025
    our engine (exit 0): v(in) = 5, v(out) = 2.5, v(e) = 5, v(g1_int1) = 0.005, i(bg1) = 0, i(v1) = -0.0025
no bracket: VALUE = {2}, which the check warns about:
    ngspice 47, -b -r (exit null): (did not finish in 30 s: stopped)
      Error: not enough parameters in line
      Error: incomplete or empty netlist
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error: not enough parameters in line
      Error: there aren't any circuits loaded.
    our engine (exit 0): v(in) = 5, v(out) = 2.5, v(e) = 2, v(e1_int1) = 2, i(be1) = 0, i(e1) = -0.002, i(v1) = -0.0025
no bracket: cur={2m}, which the check warns about:
    ngspice 47, -b -r (exit null): (did not finish in 30 s: stopped)
      Error: not enough parameters in line
      Error: incomplete or empty netlist
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error: not enough parameters in line
      Error: there aren't any circuits loaded.
    our engine (exit 0): v(in) = 5, v(out) = 2.5, v(e) = 2, v(g1_int1) = 0.002, i(bg1) = 0, i(v1) = -0.0025
```

PlainSpice's checks: no trap.

### missing-fields-11. Words between VALUE (without =) and the formula's { are dropped too: the line runs (no trap)

Added after the round-2 critic of the formulas lane (13 November 2026, CR2-6). ngspice takes the formula from its first `{` (a quote is one too: ngspice makes it a brace) and drops the words before it, as it drops those before VALUE (unknown-word-54, missing-fields-10): VALUE x {v(out)*2} gives e = 5 V, and VALUE v(out) {2} gives 2 V, as the v(out) before the brace is dropped. Native 47 and 42 and our engine agree. Without a `{`, VALUE v(out)*2 stops ngspice (fatal-syntax-14).

```spice
* words between VALUE and its brace
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e1 0 VALUE x {v(out)*2}
R1e e1 0 1k
E2 e2 0 VALUE v(out) {2}
R2e e2 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e2_int1                          2.000000e+00
        e2                               2.000000e+00
        e1_int1                          5.000000e+00
        e1                               5.000000e+00
        out                              2.500000e+00
        in                               5.000000e+00
        v1#branch                        -2.50000e-03
        e1#branch                        -5.00000e-03
        e2#branch                        -2.00000e-03
        be1#branch                       0.000000e+00
        be2#branch                       0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 2.5, v(e1) = 5, v(e1_int1) = 5, v(e2) = 2, v(e2_int1) = 2, i(be2) = 0, i(be1) = 0, i(e2) = -0.002, i(e1) = -0.005, i(v1) = -0.0025
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 5, v(out) = 2.5, v(e1) = 5, v(e1_int1) = 5, v(e2) = 2, v(e2_int1) = 2, i(be2) = 0, i(be1) = 0, i(e2) = -0.002, i(e1) = -0.005, i(v1) = -0.0025
E1 e 0 VALUE x 'v(out)*2', a formula in quotes:
    ngspice 47 and 42, -b -r (exit 0): v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, i(be1) = 0, i(e1) = -0.005, i(v1) = -0.0025
    our engine (exit 0): v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, i(be1) = 0, i(e1) = -0.005, i(v1) = -0.0025
```

PlainSpice's checks: no trap.

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
    rawfile: an Operating Point plot with 0 points, its header only (no results)
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
> *ngspice:* ngspice warns 'singular matrix', falls back to a transient op ('Note: Transient op started') and still prints numbers. They are not the answer: in one test a 6 V source's + node came out at 9.000333 V. [no-ground-1]
>
> *Fixes:* "Make node b the ground (rename it to 0)"

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

> **Node "ground" is not ground: ground is node 0.** In SPICE, ground is the node called 0 (gnd works too). Node "ground" is just an ordinary node, so the parts on it are not connected to ground.
>
> *ngspice:* ngspice says nothing and treats node "ground" as an ordinary node. In one test, V1 n1 ground 6 with R1 n1 0 2 gave v(n1) = 0 and no current at all. [ground-misnamed-1, ground-misnamed-3]
>
> *Fixes:* "Rename node \"ground\" to 0"

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

> **Only R2 touches node n2.** No current flows in R2, so node n2 sits at the same voltage as node n1. That is right for an open terminal where you measure a voltage; if R2 should connect to something, check this node name.
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

> **Node b has no DC path to ground.** At DC a capacitor is an open circuit, so nothing connects node b to ground. SPICE can't pin its voltage down: its equations have no single answer. Engineers often add a very large resistor (1 GΩ) from such a node to ground: it gives SPICE a DC path and changes almost nothing else.
>
> *ngspice:* ngspice warns 'singular matrix: check node b', falls back to a transient op ('Note: Transient op started') and still prints numbers. They can't be trusted: in one test a node that is 3 V at DC came out at 0.0887 V. [floating-dc-1, floating-dc-2, floating-dc-3, floating-dc-5]
>
> *Fixes:* "Add a 1 GΩ resistor from node b to ground"

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
    rawfile: an Operating Point plot with 0 points, its header only (no results)
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
    rawfile: an Operating Point plot with 0 points, its header only (no results)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, marked unreliable, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `floating-dc`, `floating-dc` (one for c, one for d).

## current-source-no-path

A floating group (as in floating-dc) that a current source touches: I, the output of F or G, or a B source with I=. Error. What ngspice does depends on what else is there, so the text says which case it is.

What PlainSpice shows for current-source-no-path-1 (error, line 4):

> **I1's current has nowhere to go.** A current source pushes its current through whatever it is connected to. Here node b has no DC path back to ground (a capacitor is an open circuit at DC), so the current has nowhere to go and the voltage there is not defined.
>
> *ngspice:* ngspice warns 'singular matrix', falls back to a transient op ('Note: Transient op started') and prints numbers that can't be trusted. [current-source-no-path-1]
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
    rawfile: an Operating Point plot with 0 points, its header only (no results)
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
    rawfile: an Operating Point plot with 0 points, its header only (no results)
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
    rawfile: an Operating Point plot with 0 points, its header only (no results)
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
    rawfile: an Operating Point plot with 0 points, its header only (no results)
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
    rawfile: an Operating Point plot with 0 points, its header only (no results)
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
    rawfile: an Operating Point plot with 0 points, its header only (no results)
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
    rawfile: a Transient Analysis plot with 0 points, its header only (no results)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Warning: singular matrix:  check node v1#branch
    doAnalyses: TRAN:  Timestep too small; initial timepoint: cause unrecorded.
    run simulation(s) aborted
    rawfile: a Transient Analysis plot with 0 points, its header only (no results)
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

Two parts with the same name, ignoring case, in the same scope (the main circuit, or one subcircuit). Error, at the later one. Fix: rename it to the next free name (`R1` to `R2`, or `R3` when R2 is taken). Names are compared as ngspice reads them: `Rş` and `Rç` are both `r__` (duplicate-name-3), `Rµ` and `Ru` both `ru` (duplicate-name-4); such names get that reason, not the capital letters, and a fix in plain letters (`Rc`, `Ru2`).

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

### duplicate-name-4. Rµ and Ru are the same name: ngspice reads the micro sign as u

Added after the re-check of the merged build, 12 November 2026 (S9). ngspice reads µ as u (W15), so
`Rµ` is the part `ru`, the same name as `Ru`, and it stops at the second. These names differ by more
than capital letters, so the check gives this reason, not "SPICE ignores capital letters"; its fix is
the next free name in plain letters (`Ru2`: the old "Rename it Rµ" for `Ru` then `Rµ` changed nothing).

What PlainSpice shows for duplicate-name-4 (error, line 4):

> **Rµ and Ru are the same name for ngspice.** Every part needs its own name. ngspice reads the micro sign µ as u, so Rµ and Ru are both ru.
>
> *ngspice:* ngspice stops at the second one: 'device already exists, bail out'. [duplicate-name-4]
>
> *Fixes:* "Rename it Ru2"

```spice
* Rµ and Ru are the same name: ngspice reads µ as u
V1 a 0 6
Rµ a 0 2
Ru a 0 3
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      ru a 0 3
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
      ru a 0 3
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

With `Ru` first and `Rµ` second, native 47 and 42 stop the same way at line 4 (`ru a 0 3`). And a
name renamed to another letter outside a to z can still clash: `Rş` with `Rö` stops at `r__ a 0 3`
(native 47 and 42), which is why the Numbers panel says to rename one of them with the letters a to z
(M4b in explanations.md).

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

After the last pass (13 November 2026, code review C3-5): an E, F, G or H line written with POLY(n), or an E
or G line written with TABLE, which ngspice builds from an XSPICE block: native ngspice 47 runs it (42 too,
but for a TABLE after control nodes, model-not-in-engine-14), and PlainSpice's engine stops ("XSPICE is
required to run the 'poly' option", "unknown device type"; model-not-in-engine-7 to -14). POLY(n)'s
controls are read as ngspice reads them, n pairs of control nodes on E and G and n voltage sources on F and
H, and nothing else on the line is said to be wrong: before, its words were read as nodes and a gain, and
the checks said "poly(1 has no DC path to ground" and "SPICE can't use 0 on this line". For POLY(1) with
the coefficients 0 and k the fix writes the plain gain k, which gives what native ngspice gives
(model-not-in-engine-7, -9 to -11).

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

### model-not-in-engine-7. E with POLY(1): native 47 and 42 run it, our engine (without XSPICE) stops

POLY(n) writes a dependent source as a polynomial of n controls; ngspice builds it from an XSPICE block (`a$poly$e1`), which our engine leaves out, so it stops with "XSPICE is required to run the 'poly' option". POLY(1) out 0 0 2 is 0 + 2 × v(out): the plain gain 2, which the fix writes, and which gives what native ngspice gave (5 V).

```spice
* an E written with POLY(1)
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e 0 POLY(1) out 0 0 2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e                                5.000000e+00
        out                              2.500000e+00
        in                               5.000000e+00
        a$poly$e1#branch_1_0             -5.00000e-03
        v1#branch                        -2.50000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 2.5, v(e) = 5, i(v1) = -0.0025, i(a$poly$e1) = -0.005
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error: XSPICE is required to run the 'poly' option in instance e1 e 0 poly(1) out 0 0 2
    line no 5 of file /circuit.cir
    See manual chapt. 28 for installation instructions
    ERROR: fatal error in ngspice, exit(1)
    vectors: (none)
after the fix "Write it without POLY: E1 e 0 out 0 2" (model-not-in-engine), which writes `E1 e 0 out 0 2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, i(e1) = -0.005, i(v1) = -0.0025
```

PlainSpice's checks: `model-not-in-engine`.

### model-not-in-engine-8. E with TABLE: native 47 and 42 run it, our engine stops

TABLE makes the output follow a table of points of a formula; ngspice builds it from an XSPICE `pwl` block (`ae1`), which our engine leaves out: "unknown device type". No fix: a table has no plain gain.

```spice
* an E written with TABLE
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e 0 TABLE {v(out)} = (0,0) (5,10)
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e1_int2                          2.500000e+00
        e1_int1                          5.000000e+00
        e                                5.000000e+00
        out                              2.500000e+00
        in                               5.000000e+00
        ae1#branch_1_0                   0.000000e+00
        v1#branch                        -2.50000e-03
        e1#branch                        -5.00000e-03
        be1#branch                       0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, v(e1_int2) = 2.5, i(be1) = 0, i(e1) = -0.005, i(v1) = -0.0025, i(ae1) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 5 or its substitute:
    ae1 %v(e1_int2) %v(e1_int1) xfer_e1
    unknown device type - error
    Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `model-not-in-engine`.

### model-not-in-engine-9. F with POLY(1): the same, and its plain gain

An F (and an H) reads the current in a voltage source; with POLY(1) Vx 0 2 its output is 2 × i(Vx), the plain gain 2, which the fix writes: 10 V, as native ngspice gave.

```spice
* an F written with POLY(1)
V1 in 0 5
Vx in out 0
R2 out 0 1k
F1 0 e POLY(1) Vx 0 2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e                                1.000000e+01
        out                              5.000000e+00
        in                               5.000000e+00
        v1#branch                        -5.00000e-03
        vx#branch                        5.000000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 5, v(e) = 10, i(vx) = 0.005, i(v1) = -0.005
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error: XSPICE is required to run the 'poly' option in instance f1 0 e poly(1) vx 0 2
    line no 5 of file /circuit.cir
    See manual chapt. 28 for installation instructions
    ERROR: fatal error in ngspice, exit(1)
    vectors: (none)
after the fix "Write it without POLY: F1 0 e Vx 2" (model-not-in-engine), which writes `F1 0 e Vx 2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 5, v(e) = 10, i(vx) = 0.005, i(v1) = -0.005
```

PlainSpice's checks: `model-not-in-engine`.

### model-not-in-engine-10. G with POLY(1): the same

```spice
* a G written with POLY(1)
V1 in 0 5
R1 in out 1k
R2 out 0 1k
G1 0 e POLY(1) out 0 0 2m
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e                                5.000000e+00
        out                              2.500000e+00
        in                               5.000000e+00
        v1#branch                        -2.50000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 2.5, v(e) = 5, i(v1) = -0.0025
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error: XSPICE is required to run the 'poly' option in instance g1 0 e poly(1) out 0 0 2m
    line no 5 of file /circuit.cir
    See manual chapt. 28 for installation instructions
    ERROR: fatal error in ngspice, exit(1)
    vectors: (none)
after the fix "Write it without POLY: G1 0 e out 0 2m" (model-not-in-engine), which writes `G1 0 e out 0 2m`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, i(v1) = -0.0025
```

PlainSpice's checks: `model-not-in-engine`.

### model-not-in-engine-11. H with POLY(1): the same

```spice
* an H written with POLY(1)
V1 in 0 5
Vx in out 0
R2 out 0 1k
H1 e 0 POLY(1) Vx 0 1k
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e                                5.000000e+00
        out                              5.000000e+00
        in                               5.000000e+00
        a$poly$h1#branch_1_0             -5.00000e-03
        v1#branch                        -5.00000e-03
        vx#branch                        5.000000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 5, v(e) = 5, i(vx) = 0.005, i(v1) = -0.005, i(a$poly$h1) = -0.005
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error: XSPICE is required to run the 'poly' option in instance h1 e 0 poly(1) vx 0 1k
    line no 5 of file /circuit.cir
    See manual chapt. 28 for installation instructions
    ERROR: fatal error in ngspice, exit(1)
    vectors: (none)
after the fix "Write it without POLY: H1 e 0 Vx 1k" (model-not-in-engine), which writes `H1 e 0 Vx 1k`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 5, v(e) = 5, i(h1) = -0.005, i(vx) = 0.005, i(v1) = -0.005
```

PlainSpice's checks: `model-not-in-engine`.

### model-not-in-engine-12. E with POLY(2): two controls, no plain gain (no fix)

POLY(2) out 0 in 0 0 1 1 is 0 + v(out) + v(in) = 7.5 V natively. No gain does that, so no fix is offered.

```spice
* an E written with POLY(2)
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e 0 POLY(2) out 0 in 0 0 1 1
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e                                7.500000e+00
        out                              2.500000e+00
        in                               5.000000e+00
        a$poly$e1#branch_1_0             -7.50000e-03
        v1#branch                        -2.50000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 2.5, v(e) = 7.5, i(v1) = -0.0025, i(a$poly$e1) = -0.0075
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error: XSPICE is required to run the 'poly' option in instance e1 e 0 poly(2) out 0 in 0 0 1 1
    line no 5 of file /circuit.cir
    See manual chapt. 28 for installation instructions
    ERROR: fatal error in ngspice, exit(1)
    vectors: (none)
```

PlainSpice's checks: `model-not-in-engine`.

### model-not-in-engine-13. G with TABLE: the same as E

```spice
* a G written with TABLE
V1 in 0 5
R1 in out 1k
R2 out 0 1k
G1 0 e TABLE {v(out)} = (0,0) (5,10m)
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        g1_int2                          2.500000e+00
        g1_int1                          5.000000e-03
        e                                5.000000e+00
        out                              2.500000e+00
        in                               5.000000e+00
        ag1#branch_1_0                   0.000000e+00
        v1#branch                        -2.50000e-03
        bg1#branch                       0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 2.5, v(e) = 5, v(g1_int1) = 0.005, v(g1_int2) = 2.5, i(bg1) = 0, i(v1) = -0.0025, i(ag1) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 5 or its substitute:
    ag1 %v(g1_int2) %v(g1_int1) xfer_g1
    unknown device type - error
    Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `model-not-in-engine`.

### model-not-in-engine-14. E with control nodes and then TABLE= (LTspice's way): native 47 runs it, 42 and our engine stop

```spice
* an E with control nodes and a table
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e 0 out 0 table=(0,0,5,10)
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e1_int1                          5.000000e+00
        e                                5.000000e+00
        out                              2.500000e+00
        in                               5.000000e+00
        ae1#branch_1_0                   0.000000e+00
        v1#branch                        -2.50000e-03
        e1#branch                        -5.00000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, i(e1) = -0.005, i(v1) = -0.0025, i(ae1) = 0
ngspice 42, ngspice -b (exit 1):
    Netlist line no. 5:
    Syntax error: letter [,]
    Netlist line no. 5:
     Expression err: 0,5,10)}
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 5 or its substitute:
    ae1 %vd(out 0) %v(e1_int1) xfer_e1
    unknown device type - error
    Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `model-not-in-engine`.

## dc-sweep-problems

Each sweep of a `.dc` line (a second, nested one too), read by place as ngspice 47 reads it: a name, then the start, the stop and the step. After the re-check of the fixes (12 November 2026, S5): a word that is no number where a number goes is said there (dc-sweep-problems-9, -10), never taken for the name of another sweep, and a word one of the character checks explains (`−5` with a minus sign from a document) leaves the line to that check, so no fix rewrites the sweep around it. Errors, except a step bigger than the range (warning: one point). Fixes: ten steps across the range, swap the ends, or flip the step's sign; a sweep of a missing source gets the circuit's only source. After the critic of those fixes (12 November 2026, CR1-2, CR1-4, CR1-6, CR1-8, CR1-12): the check that explains a word says what its place does with the number read (a step read as 0 stops ngspice 47: invisible-character-32); a sweep missing its numbers gets one error (dc-sweep-problems-11, -12); a number where a second sweep's name goes is one number too many, and the fix deletes it, never "Sweep V1 instead" (-13, -14); a name with a character that is not what it looks like is said with the character named, quoted as ngspice spells it (-15, -16); a word in braces or quotes is a number numparam works out, so the sweep runs (-17), while a `.param` name without braces stops ngspice 47 (-18); words after the second sweep are ignored (-19); and a letter O gets "Write 0" where the start and the stop go, never the step.

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

Recorded on a line of one sweep. In two sweeps such a sweep never moves, and the results are not empty (dc-sweep-problems-20, -21, -26, -27; added after the second critic of the re-check fixes, 12 November 2026, CR2-4).

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
    rawfile: a DC transfer characteristic plot with 0 points, its header only (no results)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: a DC transfer characteristic plot with 0 points, its header only (no results)
our engine (wasm), as ngspice -b -r (exit 0, no results):
    vectors: (none)
    diagnostics: rawfile (header without a Binary: or Values: section)
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-4. Start above stop with a positive step: no points, silently

Recorded on a line of one sweep; in two sweeps see dc-sweep-problems-20 to -22.

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
    rawfile: a DC transfer characteristic plot with 0 points, its header only (no results)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: a DC transfer characteristic plot with 0 points, its header only (no results)
our engine (wasm), as ngspice -b -r (exit 0, no results):
    vectors: (none)
    diagnostics: rawfile (header without a Binary: or Values: section)
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

What PlainSpice shows for dc-sweep-problems-9 (error, line 4):

> **The start of this sweep is not a number.** .dc V1 needs three numbers after the name: the start, the stop and the step, for example .dc V1 0 5 1. Here O stands where the start goes, with a letter O where the digit 0 belongs.
>
> *ngspice:* ngspice 47 stops: 'Bad syntax!'. [dc-sweep-problems-9, dc-sweep-problems-10]
>
> *Fixes:* "Write 0"

What PlainSpice shows for dc-sweep-problems-10 (error, line 4):

> **The stop of this sweep is not a number.** .dc V1 needs three numbers after the name: the start, the stop and the step, for example .dc V1 0 5 1. Here V1 stands where the stop goes.
>
> *ngspice:* ngspice 47 stops: 'Bad syntax!'. [dc-sweep-problems-9, dc-sweep-problems-10]
>
> *Fixes:* none

What PlainSpice shows for dc-sweep-problems-11 (error, line 4):

> **.dc needs a start, a stop and a step for V1.** .dc sweeps a source from a start to a stop in steps, three numbers after its name: .dc V1 0 5 1 sweeps it from 0 to 5 in steps of 1. Here V1 has only 0 after it.
>
> *ngspice:* ngspice 47 stops: 'Bad syntax!'. ngspice 42 never finishes. [dc-sweep-problems-11]
>
> *Fixes:* none

What PlainSpice shows for dc-sweep-problems-13 (error, line 4):

> **One number too many on this .dc line.** .dc V1 0 5 1 is a whole sweep: the source, the start, the stop and the step. SPICE takes the next word, 2, for the name of a second source to sweep, and there is no part called 2.
>
> *ngspice:* ngspice 47 stops: 'Bad syntax!'. ngspice 42 takes 2 for the name of a second source to sweep, and stops: 'Voltage source, current source, or resistor named "2" is not in the circuit'. [dc-sweep-problems-13]
>
> *Fixes:* "Delete 2"

What PlainSpice shows for dc-sweep-problems-15 (error, line 4):

> **A zero-width space (U+200B) hides in the name V1.** It is a character you cannot see (it often comes with text copied from a web page or a PDF), and SPICE keeps it in the name, so .dc names no part of the circuit: not V1.
>
> *ngspice:* ngspice stops when the sweep starts: 'Voltage source, current source, or resistor named "___v1" is not in the circuit'. [dc-sweep-problems-15]
>
> *Fixes:* "Take it out: sweep V1"

What PlainSpice shows for dc-sweep-problems-18 (error, line 5):

> **The step of this sweep is not a number.** .dc V1 needs three numbers after the name: the start, the stop and the step, for example .dc V1 0 5 1. Here st stands where the step goes. To use the value st has on its .param line, write it in braces: {st}.
>
> *ngspice:* ngspice 47 stops: 'Bad syntax!'. [dc-sweep-problems-9, dc-sweep-problems-10, dc-sweep-problems-18]
>
> *Fixes:* "Write {st}"

### dc-sweep-problems-9. A word that is no number where the start goes: ngspice 47 says 'Bad syntax!'

Added after the re-check (12 November 2026, S5). The letter O typed for the digit 0; the fix writes 0. ngspice 42 reads the word as the name of a second sweep instead.

```spice
* the letter O where the start of a .dc sweep goes
V1 in 0 1
R1 in 0 1k
.dc V1 O 5 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .dc v1 o 5 1
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "o" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-10. The same where the stop goes

ngspice 42 runs this line without a sweep: no points, no message.

```spice
* the source named again where the stop of a .dc sweep goes
V1 in 0 1
R1 in 0 1k
.dc V1 0 V1 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .dc v1 0 v1 1
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: a DC transfer characteristic plot with 0 points, its header only (no results)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-11. A sweep that ends before its stop: ngspice 47 says 'Bad syntax!', ngspice 42 never finishes

Added after the critic of the re-check fixes (12 November 2026, CR1-6), with the rest of the line read by place as ngspice 47 reads it (inp2dot.c): a name, the start, the stop and the step; then a second sweep the same way; anything after that is ignored (-19). ngspice 47 stops when the line ends before a sweep has its three numbers (-11, -12; a missing step is dc-sweep-problems-2), takes a number where the second name goes for a name (-13, -14), and reads a name with a character that is not what it looks like as no part's (-15, -16). Words in braces or quotes are numbers numparam works out first (-17), but a .param name without them is not (-18).

```spice
* a .dc sweep with only its start
V1 in 0 1
R1 in 0 1k
.dc V1 0
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .dc v1 0
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit null)
    rawfile: (did not finish in 20 s: stopped)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-12. A second sweep with its name only: the same

```spice
* a second .dc sweep with its name only
V1 in 0 1
V2 b 0 1
R1 in b 1k
.dc V1 0 5 1 V2
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .dc v1 0 5 1 v2
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit null)
    rawfile: (did not finish in 20 s: stopped)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-13. One number too many: ngspice 47 says 'Bad syntax!', ngspice 42 takes it for a source

```spice
* one number too many on a .dc line
V1 in 0 1
R1 in 0 1k
.dc V1 0 5 1 2
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .dc v1 0 5 1 2
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "2" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-14. Four numbers too many make a second sweep of a part called 2: both versions stop when the sweep starts

```spice
* four numbers too many on a .dc line
V1 in 0 1
R1 in 0 1k
.dc V1 0 5 1 2 3 4 5
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "2" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "2" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-15. An invisible character in the name: no part is called that, and ngspice stops when the sweep starts

```spice
* a zero-width space before the name of the source to sweep
V1 in 0 1
R1 in 0 1k
.dc <ZWSP>V1 0 5 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "___v1" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "___v1" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-16. A fullwidth digit in the name: the same

```spice
* a fullwidth digit in the name of the source to sweep
V1 in 0 1
R1 in 0 1k
.dc V１ 0 5 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "v___" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "v___" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-17. Expressions in braces or quotes are numbers ngspice works out: the sweep runs (no trap)

```spice
* expressions in braces and quotes on a .dc line
.param lo=-5 hi=5 st=1
V1 in 0 1
R1 in 0 1k
.dc V1 {lo} {hi} 'st'
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep): 11 points, last 5, v(in): 11 points, last 5, i(v1): 11 points, last -0.005
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep): 11 points, last 5, v(in): 11 points, last 5, i(v1): 11 points, last -0.005
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(v-sweep): 11 points, last 5, v(in): 11 points, last 5, i(v1): 11 points, last -0.005
```

PlainSpice's checks: none.

### dc-sweep-problems-18. A .param name without braces is no number: ngspice 47 says 'Bad syntax!'

```spice
* a .param name without braces where the step goes
.param st=1
V1 in 0 1
R1 in 0 1k
.dc V1 0 5 st
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .dc v1 0 5 st
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "st" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-19. Words after the second sweep are ignored (no trap)

```spice
* a word after the second sweep
V1 in 0 1
V2 b 0 1
R1 in b 1k
.dc V1 0 5 1 V2 0 1 0.5 7
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep): 18 points, last 5, v(in): 18 points, last 5, v(b): 18 points, last 1, i(v2): 18 points, last 0.004, i(v1): 18 points, last -0.004
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep): 18 points, last 5, v(in): 18 points, last 5, v(b): 18 points, last 1, i(v2): 18 points, last 0.004, i(v1): 18 points, last -0.004
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(v-sweep): 18 points, last 5, v(in): 18 points, last 5, v(b): 18 points, last 1, i(v2): 18 points, last 0.004, i(v1): 18 points, last -0.004
```

PlainSpice's checks: none.

### dc-sweep-problems-20. Two sweeps, the second the wrong way: it never moves, and the first runs once, at the second's start

Added after the second critic of the re-check fixes (12 November 2026, CR2-4). "No points" (dc-sweep-problems-3, -4) was recorded on lines of one sweep. In two sweeps ngspice computes the first sweep, then steps the second, and stops when that one is past its end: a second sweep the wrong way leaves the first computed once, with V2 at its start (dctrcurv.c). 6 points, V2 = 2 in each.

```spice
* the second sweep goes the wrong way: start 2 above stop 1, step up
V1 in 0 1
V2 b 0 1
R1 in b 1k
.dc V1 0 5 1 V2 2 1 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep): 6 points, last 5, v(in): 6 points, last 5, v(b): 6 points, last 2, i(v2): 6 points, last 0.003, i(v1): 6 points, last -0.003
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep): 6 points, last 5, v(in): 6 points, last 5, v(b): 6 points, last 2, i(v2): 6 points, last 0.003, i(v1): 6 points, last -0.003
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(v-sweep): 6 points, last 5, v(in): 6 points, last 5, v(b): 6 points, last 2, i(v2): 6 points, last 0.003, i(v1): 6 points, last -0.003
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-21. Two sweeps, the first the wrong way: V1 stays at its start, and the second skips its first value

The first sweep is past its end at once, so ngspice steps the second sweep before it computes anything: 2 points, V1 = 2 in both, V2 = 0.5 and 1.

```spice
* the first sweep goes the wrong way: start 2 above stop 1, step up
V1 in 0 1
V2 b 0 1
R1 in b 1k
.dc V1 2 1 1 V2 0 1 0.5
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep) = 2, 2, v(in) = 2, 2, v(b) = 0.5, 1, i(v2) = 0.0015, 0.001, i(v1) = -0.0015, -0.001
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep) = 2, 2, v(in) = 2, 2, v(b) = 0.5, 1, i(v2) = 0.0015, 0.001, i(v1) = -0.0015, -0.001
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(v-sweep) = 2, 2, v(in) = 2, 2, v(b) = 0.5, 1, i(v2) = 0.0015, 0.001, i(v1) = -0.0015, -0.001
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-22. Two sweeps, both the wrong way: no points, without a message

```spice
* both sweeps go the wrong way
V1 in 0 1
V2 b 0 1
R1 in b 1k
.dc V1 2 1 1 V2 2 1 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: a DC transfer characteristic plot with 0 points, its header only (no results)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: a DC transfer characteristic plot with 0 points, its header only (no results)
our engine (wasm), as ngspice -b -r (exit 0, no results):
    vectors: (none)
    diagnostics: rawfile (header without a Binary: or Values: section)
```

PlainSpice's checks: `dc-sweep-problems`, `dc-sweep-problems`.

### dc-sweep-problems-23. Two sweeps, the second's step past its end: the first runs once, at the second's start

```spice
* the second sweep's step jumps past its stop
V1 in 0 1
V2 b 0 1
R1 in b 1k
.dc V1 0 5 1 V2 0 1 5
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep): 6 points, last 5, v(in): 6 points, last 5, v(b): 6 points, last 0, i(v2): 6 points, last 0.005, i(v1): 6 points, last -0.005
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep): 6 points, last 5, v(in): 6 points, last 5, v(b): 6 points, last 0, i(v2): 6 points, last 0.005, i(v1): 6 points, last -0.005
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(v-sweep): 6 points, last 5, v(in): 6 points, last 5, v(b): 6 points, last 0, i(v2): 6 points, last 0.005, i(v1): 6 points, last -0.005
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-24. Two sweeps, the first's step past its end: only V1's start, at each value of V2

```spice
* the first sweep's step jumps past its stop
V1 in 0 1
V2 b 0 1
R1 in b 1k
.dc V1 0 1 5 V2 0 1 0.5
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep) = 0, 0, 0, v(in) = 0, 0, 0, v(b) = 0, 0.5, 1, i(v2) = 0, -0.0005, -0.001, i(v1) = 0, 0.0005, 0.001
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep) = 0, 0, 0, v(in) = 0, 0, 0, v(b) = 0, 0.5, 1, i(v2) = 0, -0.0005, -0.001, i(v1) = 0, 0.0005, 0.001
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(v-sweep) = 0, 0, 0, v(in) = 0, 0, 0, v(b) = 0, 0.5, 1, i(v2) = 0, -0.0005, -0.001, i(v1) = 0, 0.0005, 0.001
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-25. A step of 0 and a source not in the circuit: ngspice 47 stops at the step, ngspice 42 at the source

Added after the second critic of the re-check fixes (CR2-1). ngspice 47 checks the step as it reads the line and stops ('Bad syntax!') before any run; ngspice 42 has no such check and stops when the sweep starts, at the missing source, instead of sweeping for ever (dc-sweep-problems-2).

```spice
* V9 is not in the circuit, and the step is 0
V1 in 0 1
R1 in 0 1k
.dc V9 0 5 0
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .dc v9 0 5 0
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
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

PlainSpice's checks: `dc-sweep-problems`, `dc-sweep-problems`.

### dc-sweep-problems-26. Two sweeps, the second's step the wrong way: the same

```spice
* the second sweep's step goes down from 0 towards 1
V1 in 0 1
V2 b 0 1
R1 in b 1k
.dc V1 0 5 1 V2 0 1 -0.5
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep): 6 points, last 5, v(in): 6 points, last 5, v(b): 6 points, last 0, i(v2): 6 points, last 0.005, i(v1): 6 points, last -0.005
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep): 6 points, last 5, v(in): 6 points, last 5, v(b): 6 points, last 0, i(v2): 6 points, last 0.005, i(v1): 6 points, last -0.005
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(v-sweep): 6 points, last 5, v(in): 6 points, last 5, v(b): 6 points, last 0, i(v2): 6 points, last 0.005, i(v1): 6 points, last -0.005
```

PlainSpice's checks: `dc-sweep-problems`.

### dc-sweep-problems-27. Two sweeps, the first's step the wrong way: the same

```spice
* the first sweep's step goes down from 0 towards 5
V1 in 0 1
V2 b 0 1
R1 in b 1k
.dc V1 0 5 -1 V2 0 1 0.5
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep) = 0, 0, v(in) = 0, 0, v(b) = 0.5, 1, i(v2) = -0.0005, -0.001, i(v1) = 0.0005, 0.001
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep) = 0, 0, v(in) = 0, 0, v(b) = 0.5, 1, i(v2) = -0.0005, -0.001, i(v1) = 0.0005, 0.001
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(v-sweep) = 0, 0, v(in) = 0, 0, v(b) = 0.5, 1, i(v2) = -0.0005, -0.001, i(v1) = 0.0005, 0.001
```

PlainSpice's checks: `dc-sweep-problems`.

## tran-problems

The numbers of a `.tran` line (`uic` aside): step, stop, start. Errors, except a step longer than the whole run (info: ngspice chooses its own steps). Fixes: a step of a hundredth of the stop time, or remove the start time. After the critic of the re-check fixes (12 November 2026, CR1-13): a stop time of 0 or less stops ngspice too (tran-problems-8, -9; a negative one gets "Make it" with the sign taken off), and a word one of the character checks explains (`0<ZWSP>.5`) is left to that check, which says what ngspice does with the number it reads there (invisible-character-28 to -31), so no fix here reads it as 0 or shows the character.

What PlainSpice shows for tran-problems-1 (error, line 5):

> **.tran needs a stop time.** .tran needs at least two numbers: the step and the stop time, for example .tran 50u 5m. With one number, SPICE takes it as the step and finds no stop time.
>
> *ngspice:* ngspice stops: 'TSTOP is invalid, must be greater than zero.' [tran-problems-1]
>
> *Fixes:* "Use 5m as the stop time: .tran 50u 5m"

What PlainSpice shows for tran-problems-8 (error, line 5):

> **The stop time of .tran must be more than 0.** .tran 0.1m 0 means: steps of 0.1m up to 0. The stop time has to be a positive time, the length of the run.
>
> *ngspice:* ngspice stops: 'TSTOP is invalid, must be greater than zero.' [tran-problems-8]
>
> *Fixes:* none

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

### tran-problems-8. .tran with a stop time of 0: 'TSTOP is invalid'

Added after the critic of the re-check fixes (12 November 2026, CR1-13): ngspice reads the step first, then the stop time, and stops at a stop time that is not more than 0.

```spice
* .tran with a stop time of 0
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 0.1m 0
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0.1m 0
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
      .tran 0.1m 0
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

### tran-problems-9. .tran with a negative stop time: the same

```spice
* .tran with a negative stop time
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 0.1m -1m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0.1m -1m
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
      .tran 0.1m -1m
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

## tf-problems

The output and the input of a `.tf` line. A missing output node and `i( )` of anything but a voltage source give wrong numbers silently; a missing input or one that is not V or I stops ngspice. Error. Fixes: a node whose name looks like a typo of the one written; the circuit's only source as the input. An output written with an invisible character, one that looks like a space or a look-alike letter is another node with nothing on it (tf-problems-8): the error names the character, and its fix writes the name as the other lines do; the other way round, with the character in the parts' node, it says so and leaves the fix to the character's own warning (tf-problems-9); a part's name in `.tf` written so is named the same way (tf-problems-10). A `.tf` after `.end`, which ngspice runs, is checked too (tf-problems-11), and one in a subcircuit the main circuit does not use, which ngspice skips, is not (A3f in explanations.md); `x1.m`, ngspice's name for the node m inside the subcircuit X1 uses, is a node of the circuit (A3h).

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
  the same with .tf v(<ZWSP>0) V1, ground written with a zero-width space, ngspice -b (exit 0):
    transfer_function = 0.000000e+00
    output_impedance_at_v(___0) = 1.000000e+00
    v1#input_impedance = 3.000000e+03
ngspice 42: the same printouts, exit codes and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(Transfer_function) = 0, v(v1#Input_impedance) = 2999.9999999999995, v(output_impedance_at_V(ou___t)) = 1;
    with v(оut): v(output_impedance_at_V(__ut)) = 1; with v(o<THIN>ut): v(output_impedance_at_V(o___ut)) = 1; with
    v(о<ZWSP>ut): v(output_impedance_at_V(_____ut)) = 1; with v(<ZWSP>0): v(output_impedance_at_V(___0)) = 1,
    each with a transfer function of 0; with v(out):
    v(Transfer_function) = 0.6666666666666666, v(output_impedance_at_V(out)) = 666.6666666666666
```

As a second output the character adds 1 Ω, as tf-problems-2 says: v(out,mi<ZWSP>d) is v(out) less a node
with nothing on it, so the transfer function is out's 0.75 and the output impedance 750 + 1 = 751 Ω, where
v(out,mid) gives 0.5 and 1 kΩ. So that error quotes tf-problems-2's words, never "comes out 0" (critic of
the S11 fix, round 2). Ground written so is another node too: v(<ZWSP>0) above gives 0 and 1 Ω, and
v(out,gn<ZWSP>d), where gnd is ground, gives out's 2/3 and 666.7 + 1 Ω; the error says "not ground (node 0)".

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
  V1 in gnd 6, R1 in out 1k, R2 out gnd 2k and .tf v(out,gn<ZWSP>d) V1, ngspice -b (exit 0):
    transfer_function = 6.666667e-01
    output_impedance_at_v(out,gn___d) = 6.676667e+02
    v1#input_impedance = 3.000000e+03
ngspice 42: the same printouts, exit codes and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(Transfer_function) = 0.75, v(v1#Input_impedance) = 4000, v(output_impedance_at_V(out,mi___d)) = 751;
    with v(out,gn<ZWSP>d): v(Transfer_function) = 0.6666666666666666, v(output_impedance_at_V(out,gn___d)) = 667.6666666666666
```

PlainSpice's checks: `invisible-character`, `tf-problems` (with v(оut): `look-alike-letter`, `tf-problems`; with
v(o<THIN>ut): `space-character`, `tf-problems`; with v(о<ZWSP>ut): `invisible-character`, `tf-problems`, whose
words name both characters; with v(out,mi<ZWSP>d), v(<ZWSP>0) and v(out,gn<ZWSP>d): `invisible-character`,
`tf-problems`).

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
> *ngspice:* ngspice reads the circuit and runs nothing. In batch mode ngspice 47 ends with 'no simulations run!' and ngspice 42 with 'Note: No ".plot", ".print", or ".fourier" lines; no simulations run'; PlainSpice's engine gives no results and no message. [no-analysis-1]
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

> **Lines after .end.** ngspice does not stop reading at .end: it still reads these lines when it runs a file, so they are part of the circuit. Keep .end as the last line.
>
> *ngspice:* ngspice still reads the lines after .end from a file and builds them into the circuit, without a message: in one test a resistor after .end changed the source current from −2 A to −5 A. [after-end-1]
>
> *Fixes:* "Move .end to the bottom"

What PlainSpice shows for after-end-2 (warning, line 6):

> **Lines after .end.** ngspice stops reading at this .end, so it skips the lines after it. Keep .end as the last line.
>
> *ngspice:* ngspice stops reading at a .end with a comment glued to it (.end;...) and skips every line after it, without a message. [after-end-2]
>
> *Fixes:* "Move .end to the bottom"

Whole lines ngspice does not read are lines it "skips", as Explain says for the same lines (decision
0017, W11; words re-check 10); after a plain .end it reads them, so those are never said to be skipped.

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

A resistor whose value is less than 1e-12 Ω in size (ngspice 47's limit, resparam.c), 0 included. Warning. Fix: a 0 V source in its place, offered only when that adds no loop of voltage sources and the line has nothing else on it (zero-ohm-3). An error, with no fix, when the resistor sits straight across a voltage source, or a chain of voltage sources and inductors whose voltages need not add up to 0: its current then has no finite answer, and ngspice's stand-in gives an absurd one (zero-ohm-2: 6e12 A from a 6 V source). After the re-check of the fixes (12 November 2026, C1), a 0 that another check already explains (`0<ZWSP>.47`, `0R47`, `0k47`, `0．47`: 470 mΩ was meant) is that check's, whose fix writes what was meant; the 0 V source would make a short. The error across a source stays. After the critic of those fixes (12 November 2026, CR1-1), that check says what this one says of a 0, from the runs of zero-ohm-4: ngspice 47 uses 1e-12 Ω and warns, ngspice 42 used 1 mΩ without a word; never "without a message" or "says nothing".

After the last pass (13 November 2026, F4 and F5), the same for a value below 1e-12 Ω that is not 0 (zero-ohm-7, zero-ohm-8, P24): ngspice 47 uses 1e-12 Ω, or −1e-12 Ω for a negative value, and warns ("set to -1.000000e-12" for a negative one), and ngspice 42 keeps the value as written, without a word; only a value of exactly 0 becomes 1 mΩ in ngspice 42. Such a value that another check explains (`3a`, unit-letter) is that check's alone, whose words say what each version does, where "Use a 0 V source" would make a short where 3 Ω was meant; the error across a source stays. The words for a 0 no longer say that ngspice 42's 1 mΩ "changed the answer in the 4th digit": that is zero-ohm-1's circuit only (zero-ohm-6 changes in the 3rd digit, P13 in the 6th), and a student would read it as the size of the change in their own circuit (F5). After the round-1 critic of those fixes (C3, C6): the why for such a value that is not 0 is ngspice 47's floor, in the Numbers panel's words ("ngspice 47 cannot use a resistance below 10⁻¹² Ω: it uses 10⁻¹² Ω instead, and the currents next to it can come out inaccurate", zero-ohm-9), where it said that SPICE cannot use a resistance of 0; and a Greek μ in a 0 or tiny value (`0μ47`, `1e-13μ`) is greek-mu's alone, as greek-mu now runs before this check.

What PlainSpice shows for zero-ohm-1 (warning, line 3):

> **R1 has a resistance of 0 Ω.** SPICE can't use a resistance of exactly 0: a resistor's current is its voltage divided by its resistance. For a wire, give both ends the same node name; to measure the current in a wire, use a 0 V source (the ammeter trick).
>
> *ngspice:* ngspice 47 uses 1e-12 Ω instead and warns 'Value of resistor r1 is too small, set to 1.000000e-12'. ngspice 42 used 0.001 Ω without a word. [zero-ohm-1, zero-ohm-2]
>
> *Fixes:* "Use a 0 V source instead (VR1)"

What PlainSpice shows for zero-ohm-2 (error, line 3):

> **R1 shorts V1: its current has no finite answer.** A resistance of 0 straight across a voltage source would need an endless current: a resistor's current is its voltage divided by its resistance. For a wire, give both ends the same node name; a wire across a source shorts it, so check where R1 should go.
>
> *ngspice:* ngspice 47 uses 1e-12 Ω instead and warns: 'Value of resistor r1 is too small, set to 1.000000e-12'; in one test a 6 V source then gave 6e12 A, an artefact, not an answer. [zero-ohm-2]
>
> *Fixes:* none

What PlainSpice shows for zero-ohm-4 (warning, line 3):

> **R1's value is read as 0 Ω, not 470 mΩ.** A zero-width space (U+200B) sits between 0 and .47: a character you cannot see, which often comes with text copied from a web page or a PDF. SPICE stops reading the number at it, so the .47 after it does not count. Write 0.47.
>
> *ngspice:* ngspice stops reading the number at the zero-width space and ignores the rest of the word: it reads 0 Ω, which ngspice 47 cannot use: it uses 1e-12 Ω instead and warns 'Value of resistor r1 is too small, set to 1.000000e-12' (ngspice 42 used 0.001 Ω without a word). [invisible-character-1, invisible-character-2, zero-ohm-1, zero-ohm-4]
>
> *Fixes:* "Write 0.47 (470 mΩ)"

What PlainSpice shows for zero-ohm-4 (warning, line 4):

> **0R47 is read as 0, not 0.47.** On resistor codes and schematics 0R47 means 0.47: the letter stands for the decimal point. SPICE stops reading the number at the letter and ignores the 47 after it. Write 0.47.
>
> *ngspice:* ngspice reads 0R47 as 0 Ω (R2), which ngspice 47 cannot use: it uses 1e-12 Ω instead and warns 'Value of resistor r2 is too small, set to 1.000000e-12' (ngspice 42 used 0.001 Ω without a word). [rkm-notation-1, zero-ohm-1, zero-ohm-4]
>
> *Fixes:* "Write 0.47 (470 mΩ)"

What PlainSpice shows for zero-ohm-7 (warning, line 3):

> **R1 has a resistance of 1 fΩ.** ngspice 47 cannot use a resistance below 10⁻¹² Ω: it uses 10⁻¹² Ω instead, and the currents next to it can come out inaccurate. For a wire, give both ends the same node name; to measure the current in a wire, use a 0 V source (the ammeter trick).
>
> *ngspice:* ngspice 47 uses 1e-12 Ω instead and warns 'Value of resistor r1 is too small, set to 1.000000e-12'. ngspice 42 keeps it as written, without a word. [zero-ohm-7, zero-ohm-9]
>
> *Fixes:* "Use a 0 V source instead (VR1)"

What PlainSpice shows for zero-ohm-7 (warning, line 5):

> **R2 has a resistance of −3 aΩ.** ngspice 47 cannot use a resistance this close to 0: it uses −10⁻¹² Ω instead, and the currents next to it can come out inaccurate. For a wire, give both ends the same node name; to measure the current in a wire, use a 0 V source (the ammeter trick).
>
> *ngspice:* ngspice 47 uses −1e-12 Ω instead and warns 'Value of resistor r2 is too small, set to -1.000000e-12'. ngspice 42 keeps it as written, without a word. [zero-ohm-7, zero-ohm-9]
>
> *Fixes:* "Use a 0 V source instead (VR2)"

What PlainSpice shows for zero-ohm-8 (warning, line 3):

> **3a means 3 attoohms.** A is not amps here: SPICE reads it as the scale letter a, atto (10⁻¹⁸), and it does not use units. Write the number alone: 3 means 3 ohms.
>
> *ngspice:* ngspice reads 3a as 3 attoohms, which ngspice 47 cannot use: it uses 1e-12 Ω instead and warns 'Value of resistor r1 is too small, set to 1.000000e-12' (ngspice 42 keeps it as written, without a word). [unit-letter-1, unit-letter-2, zero-ohm-7]
>
> *Fixes:* "Write 3 (3 ohms)"

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

### zero-ohm-4. A value read as 0 because of how it is written does the same: 47 warns for each resistor, 42 uses 1 mΩ silently

Added after the critic of the re-check fixes (12 November 2026, CR1-1): 0<ZWSP>.47, 0R47, 0k47, 0．47, 0·47, 0<THIN>.47, 0<NBSP>.47, 0。47 and 1,0 all read as 0, so ngspice 47 warns for each and uses 1e-12 Ω, and ngspice 42 uses 1 mΩ without a word, as for a 0 written plainly (zero-ohm-1). The check that explains how the value is written (invisible-character, rkm-notation, look-alike-letter, space-character, nbsp, decimal-comma) says so, never "without a message"; zero-ohm leaves the value to it, as its 0 V source would make a short where 470 mΩ was meant.

```spice
* values read as 0 because of how they are written
V1 a 0 1
R1 a b 0<ZWSP>.47
R2 b c 0R47
R3 c d 0k47
R4 d e 0．47
R5 e f 0·47
R6 f g 0<THIN>.47
R7 g h 0<NBSP>.47
R8 h i 0。47
R9 i j 1,0
R10 j 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
            j                                1.000000e+00
            i                                1.000000e+00
            h                                1.000000e+00
            g                                1.000000e+00
            f                                1.000000e+00
            e                                1.000000e+00
            d                                1.000000e+00
            c                                1.000000e+00
            b                                1.000000e+00
            a                                1.000000e+00
            v1#branch                        -1.00012e+00
    Warning: Value of resistor r1 is too small, set to 1.000000e-12
    Warning: Value of resistor r2 is too small, set to 1.000000e-12
    Warning: Value of resistor r3 is too small, set to 1.000000e-12
    Warning: Value of resistor r4 is too small, set to 1.000000e-12
    Warning: Value of resistor r5 is too small, set to 1.000000e-12
    Warning: Value of resistor r6 is too small, set to 1.000000e-12
    Warning: Value of resistor r7 is too small, set to 1.000000e-12
    Warning: Value of resistor r8 is too small, set to 1.000000e-12
    Warning: Value of resistor r9 is too small, set to 1.000000e-12
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 1, v(b) = 0.9999999999989999, v(c) = 0.9999999999979998, v(d) = 0.9999999999969997, v(e) = 0.9999999999959996, v(f) = 0.9999999999949996, v(g) = 0.9999999999939995, v(h) = 0.9999999999929994, v(i) = 0.9999999999919993, v(j) = 0.9999999999909992, i(v1) = -1.0001220703125
ngspice 42, ngspice -b (exit 0):
            j                                9.910803e-01
            i                                9.920714e-01
            h                                9.930624e-01
            g                                9.940535e-01
            f                                9.950446e-01
            e                                9.960357e-01
            d                                9.970268e-01
            c                                9.980178e-01
            b                                9.990089e-01
            a                                1.000000e+00
            v1#branch                        -9.91080e-01
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 1, v(b) = 0.9990089197224978, v(c) = 0.9980178394449957, v(d) = 0.9970267591674934, v(e) = 0.9960356788899911, v(f) = 0.9950445986124886, v(g) = 0.9940535183349861, v(h) = 0.9930624380574835, v(i) = 0.992071357779981, v(j) = 0.9910802775024785, i(v1) = -0.9910802775021921
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(a) = 1, v(b) = 0.9999999999989999, v(c) = 0.9999999999979998, v(d) = 0.9999999999969997, v(e) = 0.9999999999959996, v(f) = 0.9999999999949996, v(g) = 0.9999999999939995, v(h) = 0.9999999999929994, v(i) = 0.9999999999919993, v(j) = 0.9999999999909992, i(v1) = -1.0001220703125
```

PlainSpice's checks: `invisible-character`, `rkm-notation`, `rkm-notation`, `look-alike-letter`, `look-alike-letter`, `space-character`, `nbsp`, `look-alike-letter`, `decimal-comma`.

### zero-ohm-5. A resistor written r= or resistance= and read as 0: ngspice 47 warns it is too small, as for any 0

Added after the second critic of the re-check fixes (12 November 2026, CR2-3). r= and resistance= give the resistor its value, so a 0 there is zero-ohm-1's: ngspice 47 uses 1e-12 Ω and warns; ngspice 42 uses 1 mΩ without a word.

```spice
* r= and resistance= read as 0: 0<ZWSP>.47 reads 0
V1 a 0 1
R1 a b r=0<ZWSP>.47
R2 b 0 1
V2 c 0 1
R3 c d resistance=0<ZWSP>.47
R4 d 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
            d                                1.000000e+00
            c                                1.000000e+00
            b                                1.000000e+00
            a                                1.000000e+00
            v1#branch                        -1.00012e+00
            v2#branch                        -1.00012e+00
    Warning: Value of resistor r1 is too small, set to 1.000000e-12
    Warning: Value of resistor r3 is too small, set to 1.000000e-12
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 1, v(b) = 0.9999999999989999, v(c) = 1, v(d) = 0.9999999999989999, i(v2) = -1.0001220703125, i(v1) = -1.0001220703125
ngspice 42, ngspice -b (exit 0):
            d                                9.990010e-01
            c                                1.000000e+00
            b                                9.990010e-01
            a                                1.000000e+00
            v1#branch                        -9.99001e-01
            v2#branch                        -9.99001e-01
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 1, v(b) = 0.999000999000999, v(c) = 1, v(d) = 0.999000999000999, i(v2) = -0.9990009990009412, i(v1) = -0.9990009990009412
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(a) = 1, v(b) = 0.9999999999989999, v(c) = 1, v(d) = 0.9999999999989999, i(v2) = -1.0001220703125, i(v1) = -1.0001220703125
```

PlainSpice's checks: `invisible-character`, `invisible-character`.

### zero-ohm-6. Inside a subcircuit ngspice names the resistor by the X line that uses it: r.x1.r1

Added after the second critic of the re-check fixes (12 November 2026, CR2-7). ngspice builds each resistor of the subcircuit once for each X line, named letter.instance.name, and warns for each: r.x1.r1 and r.x2.r1, not r1. The checks quote that name, once for each X line that uses the subcircuit.

```spice
* a resistor of 0 in a subcircuit used twice, one written 0, one read as 0
.subckt div a b
R1 a b 0
R2 b 0 1
R3 b c 0<ZWSP>.47
R4 c 0 1
.ends
V1 in 0 1
X1 in out1 div
X2 in out2 div
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
            x2.c                             1.000000e+00
            out2                             1.000000e+00
            x1.c                             1.000000e+00
            out1                             1.000000e+00
            in                               1.000000e+00
            v1#branch                        -4.00024e+00
    Warning: Value of resistor r.x1.r1 is too small, set to 1.000000e-12
    Warning: Value of resistor r.x1.r3 is too small, set to 1.000000e-12
    Warning: Value of resistor r.x2.r1 is too small, set to 1.000000e-12
    Warning: Value of resistor r.x2.r3 is too small, set to 1.000000e-12
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 1, v(out1) = 0.9999999999979999, v(x1.c) = 0.9999999999969998, v(out2) = 0.9999999999979999, v(x2.c) = 0.9999999999969998, i(v1) = -4.000244140625
ngspice 42, ngspice -b (exit 0):
            x2.c                             9.970080e-01
            out2                             9.980050e-01
            x1.c                             9.970080e-01
            out1                             9.980050e-01
            in                               1.000000e+00
            v1#branch                        -3.99003e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 1, v(out1) = 0.9980049870339113, v(x1.c) = 0.9970079790548565, v(out2) = 0.9980049870339113, v(x2.c) = 0.9970079790548565, i(v1) = -3.9900259321775593
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(in) = 1, v(out1) = 0.9999999999979999, v(x1.c) = 0.9999999999969998, v(out2) = 0.9999999999979999, v(x2.c) = 0.9999999999969998, i(v1) = -4.000244140625
```

PlainSpice's checks: `zero-ohm`, `invisible-character`.

### zero-ohm-7. Below 1e-12 Ω but not 0: ngspice 47 uses 1e-12 Ω (−1e-12 Ω for a negative value) and warns; ngspice 42 keeps the value as written, silently

Added after the last pass (13 November 2026, F4). A current of 1 A goes into each resistor, so each node sits at the resistance ngspice uses: ngspice 47 raises 1e-15 and 3a (3e-18) to 1e-12 Ω and −3e-18 to −1e-12 Ω, with a warning for each; ngspice 42 keeps all three as written and says nothing. Only a value of exactly 0 becomes 1 mΩ in ngspice 42 (zero-ohm-1). R1 and R2 get zero-ohm's warning; 3a is unit-letter's alone (zero-ohm-8).

```spice
* resistances below 1e-12 ohm that are not 0, 1 A into each: each node is at the resistance used
I1 0 n1 1
R1 n1 0 1e-15
I2 0 n2 1
R2 n2 0 -3e-18
I3 0 n3 1
R3 n3 0 3a
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n3                               1.000000e-12
        n2                               -1.00000e-12
        n1                               1.000000e-12
    Warning: Value of resistor r1 is too small, set to 1.000000e-12
    Warning: Value of resistor r2 is too small, set to -1.000000e-12
    Warning: Value of resistor r3 is too small, set to 1.000000e-12
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 1e-12, v(n2) = -1e-12, v(n3) = 1e-12
ngspice 42, ngspice -b (exit 0):
        n3                               3.000000e-18
        n2                               -3.00000e-18
        n1                               1.000000e-15
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 1e-15, v(n2) = -3.0000000000000002e-18, v(n3) = 3.0000000000000002e-18
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(n1) = 1e-12, v(n2) = -1e-12, v(n3) = 1e-12
```

PlainSpice's checks: `zero-ohm`, `zero-ohm`, `unit-letter`.

### zero-ohm-8. 3a on a resistor: one check for the word; in series ngspice 42's current goes wrong, and across a source ngspice 47 gives 6e12 A

Added after the last pass (13 November 2026, F4). 3a is read as 3 attoohms (unit-letter), which ngspice 47 raises to 1e-12 Ω with a warning, as in zero-ohm-7. In series with 2 Ω, ngspice 47 gives the 3 A of a wire; ngspice 42 keeps 3 aΩ and gives the source a current of 0 A, though 6 V sits across the 2 Ω. Straight across a 6 V source, ngspice 47 gives 6e12 A, as for a 0 (zero-ohm-2), and ngspice 42 gives 2e18 A. The unit-letter check owns each 3a, and its words say what each version does; the error for the resistor across the source stays, as for a 0.

```spice
* 3a in series with 2 ohm, and 3a across a voltage source
V1 a 0 6
R1 a b 3a
R2 b 0 2
V2 c 0 6
R3 c 0 3a
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        c                                6.000000e+00
        b                                6.000000e+00
        a                                6.000000e+00
        v1#branch                        -3.00000e+00
        v2#branch                        -6.00000e+12
    Warning: Value of resistor r1 is too small, set to 1.000000e-12
    Warning: Value of resistor r3 is too small, set to 1.000000e-12
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 6, v(b) = 5.999999999997, v(c) = 6, i(v2) = -6000000000000, i(v1) = -3
ngspice 42, ngspice -b (exit 0):
        c                                6.000000e+00
        b                                6.000000e+00
        a                                6.000000e+00
        v1#branch                        0.000000e+00
        v2#branch                        -2.00000e+18
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 6, v(b) = 6, v(c) = 6, i(v2) = -2000000000000000000, i(v1) = 0
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(a) = 6, v(b) = 5.999999999997, v(c) = 6, i(v2) = -6000000000000, i(v1) = -3
```

PlainSpice's checks: `unit-letter`, `unit-letter`, `zero-ohm`.

### zero-ohm-9. Below 1e-12 Ω but not 0: the currents next to the resistor can come out inaccurate, in ngspice 47 as for a 0 (P13), and in ngspice 42 too

Added after the round-1 critic of the last pass's fixes (13 November 2026, C3), for the zero-ohm check's why for such a value: "ngspice 47 cannot use a resistance below 10⁻¹² Ω: it uses 10⁻¹² Ω instead, and the currents next to it can come out inaccurate", the words of the Numbers panel's note too (P13, P24). Each resistor is in series with 1 kΩ across 6 V, so the exact current is 6 mA, run as PlainSpice runs an .op (`.options savecurrents`, A2 in explanations.md). ngspice 47 raises 1 fΩ to 1e-12 Ω, as it does a 0 (P13), and gives V1 5.859 mA and R1 6.217 mA; it makes −3 aΩ −1e-12 Ω and gives V1 4.883 mA and R1 5.329 mA. R2's 6 mA is right in both. ngspice 42 keeps each value and gives V1 and R1 0 A. Where a current source sets the current (P24's 3a), R1 carries exactly that 1 A in both versions: the currents can come out inaccurate, not always.

```spice
* 1 femtoohm in series with 1k, as PlainSpice runs it (.options savecurrents)
V1 a 0 6
R1 a b 1f
R2 b 0 1k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0), the model and device listings left out:
        b                                6.000000e+00
        a                                6.000000e+00
        @r2[i]                           6.000000e-03
        @r1[i]                           6.217249e-03
        v1#branch                        -5.85938e-03
    Warning: Value of resistor r1 is too small, set to 1.000000e-12
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 6, v(b) = 5.999999999999994, i(v1) = -0.005859375, i(@r1[i]) = 0.006217248937900877, i(@r2[i]) = 0.005999999999999994
ngspice 42, ngspice -b (exit 0), the model and device listings left out:
        b                                6.000000e+00
        a                                6.000000e+00
        @r2[i]                           6.000000e-03
        @r1[i]                           0.000000e+00
        v1#branch                        0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 6, v(b) = 6, i(v1) = 0, i(@r1[i]) = 0, i(@r2[i]) = 0.006
our engine (wasm), as ngspice -b -r (exit 0):
    the same message as ngspice 47
    vectors: v(a) = 6, v(b) = 5.999999999999994, i(v1) = -0.005859375, i(@r1[i]) = 0.006217248937900877, i(@r2[i]) = 0.005999999999999994
    diagnostics: resistor-too-small (r1)
```

```spice
* minus 3 attoohms in series with 1k, as PlainSpice runs it (.options savecurrents)
V1 a 0 6
R1 a b -3e-18
R2 b 0 1k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0), the model and device listings left out:
        b                                6.000000e+00
        a                                6.000000e+00
        @r2[i]                           6.000000e-03
        @r1[i]                           5.329071e-03
        v1#branch                        -4.88281e-03
    Warning: Value of resistor r1 is too small, set to -1.000000e-12
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 6, v(b) = 6.000000000000005, i(v1) = -0.0048828125, i(@r1[i]) = 0.005329070518200751, i(@r2[i]) = 0.006000000000000005
ngspice 42, ngspice -b (exit 0), the model and device listings left out:
        b                                6.000000e+00
        a                                6.000000e+00
        @r2[i]                           6.000000e-03
        @r1[i]                           -0.000000e+00
        v1#branch                        0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 6, v(b) = 6, i(v1) = 0, i(@r1[i]) = -0, i(@r2[i]) = 0.006
our engine (wasm), as ngspice -b -r (exit 0):
    the same message as ngspice 47
    vectors: v(a) = 6, v(b) = 6.000000000000005, i(v1) = -0.0048828125, i(@r1[i]) = 0.005329070518200751, i(@r2[i]) = 0.006000000000000005
    diagnostics: resistor-too-small (r1)
```

```spice
* 3a on a resistor, as PlainSpice runs it (.options savecurrents)
I1 0 n1 1
R1 n1 0 3a
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0), the model and device listings left out:
        n1                               1.000000e-12
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
    Warning: Value of resistor r1 is too small, set to 1.000000e-12
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 1e-12, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42, ngspice -b (exit 0), the model and device listings left out:
        n1                               3.000000e-18
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 3.0000000000000002e-18, i(@i1[current]) = 1, i(@r1[i]) = 1
our engine (wasm), as ngspice -b -r (exit 0):
    the same message as ngspice 47
    vectors: v(n1) = 1e-12, i(@i1[current]) = 1, i(@r1[i]) = 1
    diagnostics: resistor-too-small (r1)
```

PlainSpice's checks: `zero-ohm`; `zero-ohm`; `unit-letter`.

## fatal-syntax

An expression whose `{` or `'` is never closed; a name in an expression that no `.param`, `.func` or subcircuit `params:` defines (only `temper`, `hertz` and `time` are known without one, fatal-syntax-6); a B line without V= or I=, or with nothing after it. Error. Fixes: close the expression; for `pi` and `e`, add a `.param` with the constant (fatal-syntax-9). After the last pass (13 November 2026, code review C3-5): an E or G given by a formula that ngspice cannot read, because the formula has no braces and starts with a number (`VALUE=3`, `VALUE=2*v(out)`) or follows VALUE without `=` (fatal-syntax-12 to -14; fix: put it in braces), or because it is empty (fatal-syntax-15). Without braces ngspice adds them itself before a letter or a bracket, so `VALUE=v(out)*2` is no trap (fatal-syntax-16). After the round-2 critic of those fixes (13 November 2026, CR2-1): ngspice adds them before a sign that stands before a letter or a bracket too (`VALUE=-v(out)*2`, `VALUE=(1+v(out))*2`, no trap, fatal-syntax-19), but not before a sign and a number (`VALUE=-2*v(out)`) or a name that starts with true or false, which stop it (fatal-syntax-18). A node called `value` anywhere on an E or G line is read as VALUE: as an output node, a POLY control node or the control − node too (fatal-syntax-20); the fix renames it, and braces are offered for none of these.

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

### fatal-syntax-12. An E's formula that is a plain number, without braces (VALUE=3): ngspice stops

Added after the last pass (13 November 2026, code review C3-5). ngspice takes an E's or G's formula from its `{` to the end of the line (inp_compat), and adds the braces itself unless the formula starts with a number, with a sign or not (fatal-syntax-16, -18, -19). VALUE=3 has none, so native 47 and 42 and our engine stop: "mal formed E source instance". The fix puts the formula in braces; then all three give e = 3 V.

```spice
* VALUE=3 without braces
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e 0 VALUE=3
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    ERROR: mal formed E source instance: e1 e 0   vol=3
        in line no. 5 of file c.cir
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    ERROR: mal formed E line: e1 e 0   vol=3
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    ERROR: mal formed E source instance: e1 e 0   vol=3
    in line no. 5 of file /circuit.cir
    ERROR: fatal error in ngspice, exit(1)
    vectors: (none)
after the fix "Put it in braces: {3}" (fatal-syntax), which writes `E1 e 0 VALUE={3}`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 3, v(e1_int1) = 3, i(be1) = 0, i(e1) = -0.003, i(v1) = -0.0025
```

PlainSpice's checks: `fatal-syntax`.

### fatal-syntax-13. A formula that starts with a number (VALUE=2*v(out), cur=2m*v(out)), without braces: ngspice stops

Added after the last pass (13 November 2026, code review C3-5). Written the other way round, v(out)*2, the same formula runs (fatal-syntax-16). The fix puts it in braces; then all three give e = 5 V. The G line below stops the same way: "mal formed G source instance".

```spice
* VALUE=2*v(out) without braces
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e 0 VALUE=2*v(out)
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    ERROR: mal formed E source instance: e1 e 0   vol=2*v(out)
        in line no. 5 of file c.cir
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    ERROR: mal formed E line: e1 e 0   vol=2*v(out)
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    ERROR: mal formed E source instance: e1 e 0   vol=2*v(out)
    in line no. 5 of file /circuit.cir
    ERROR: fatal error in ngspice, exit(1)
    vectors: (none)
after the fix "Put it in braces: {2*v(out)}" (fatal-syntax), which writes `E1 e 0 VALUE={2*v(out)}`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, i(be1) = 0, i(e1) = -0.005, i(v1) = -0.0025
G1 0 e cur=2m*v(out), which PlainSpice's checks say the same way (`fatal-syntax`, fix: Put it in braces):
    ngspice 47, -b -r (exit 1): (no rawfile)
      ERROR: mal formed G source instance: g1 0 e cur=2m*v(out)
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      ERROR: mal formed G line: g1 0 e cur=2m*v(out)
      ERROR: fatal error in ngspice, exit(1)
    our engine (exit 1, no results): (none)
```

PlainSpice's checks: `fatal-syntax`.

### fatal-syntax-14. VALUE without = and without braces (VALUE v(out)*2): ngspice stops

Added after the last pass (13 November 2026, code review C3-5). Without `=` ngspice adds no braces, whatever the formula starts with. The fix puts it in braces, VALUE {v(out)*2}, which runs as VALUE={v(out)*2} does (missing-value-16): e = 5 V.

```spice
* VALUE without = and without braces
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e 0 VALUE v(out)*2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    ERROR: mal formed E source instance: e1 e 0  vol= v(out)*2
        in line no. 5 of file c.cir
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    ERROR: mal formed E line: e1 e 0  vol= v(out)*2
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    ERROR: mal formed E source instance: e1 e 0  vol= v(out)*2
    in line no. 5 of file /circuit.cir
    ERROR: fatal error in ngspice, exit(1)
    vectors: (none)
after the fix "Put it in braces: {v(out)*2}" (fatal-syntax), which writes `E1 e 0 VALUE {v(out)*2}`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, i(be1) = 0, i(e1) = -0.005, i(v1) = -0.0025
```

PlainSpice's checks: `fatal-syntax`.

### fatal-syntax-15. An E with an empty formula (VALUE=, VALUE={} or VALUE alone): ngspice stops

Added after the last pass (13 November 2026, code review C3-5). As for a B line's empty formula (fatal-syntax-8). No fix: only the student knows the formula.

```spice
* an empty formula
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e 0 VALUE=
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    YYparse error, syntax error, in expression: parsing stopped at line 5
         in
    from file    c.cir
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    PTerror: syntax error, parsing stopped at
    Error on line 5 or its substitute:
      be1 e1_int1 0 v=
    parameter value out of range or the wrong type
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    YYparse error, syntax error, in expression: parsing stopped at line 5
    in
    from file    /circuit.cir
    ERROR: fatal error in ngspice, exit(1)
    vectors: (none)
E1 e 0 VALUE={}, which PlainSpice's checks say the same way:
    ngspice 47, -b -r (exit 1): (no rawfile)
      YYparse error, syntax error, in expression: parsing stopped at line 5
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      PTerror: syntax error, parsing stopped at
      Error on line 5 or its substitute:
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none)
E1 e 0 VALUE with nothing after it, which PlainSpice's checks say the same way (its words: 'mal formed E source instance'):
    ngspice 47, -b -r (exit 1): (no rawfile)
      ERROR: mal formed E source instance: e1 e 0  vol=
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      ERROR: mal formed E line: e1 e 0  vol=
      ERROR: fatal error in ngspice, exit(1)
    our engine (exit 1, no results): (none)
```

PlainSpice's checks: `fatal-syntax`.

### fatal-syntax-16. A formula without braces that starts with a letter or a bracket gets its braces from ngspice (no trap)

Added after the last pass (13 November 2026, code review C3-5). v(out)*2, (v(out)*2), a `.param` name and G's cur=v(out)*2m: native 47 and 42 and our engine run each one (e1 = 5 V, e2 = 5 V, e3 = 8 V, g = 5 V).

```spice
* formulas without braces that ngspice reads
.param k=4
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e1 0 VALUE=v(out)*2
R1e e1 0 1k
E2 e2 0 VALUE=(v(out)*2)
R2e e2 0 1k
E3 e3 0 VALUE=k*2
R3e e3 0 1k
G1 0 g cur=v(out)*2m
Rg g 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        g1_int1                          5.000000e-03
        g                                5.000000e+00
        e3_int1                          8.000000e+00
        e3                               8.000000e+00
        e2_int1                          5.000000e+00
        e2                               5.000000e+00
        e1_int1                          5.000000e+00
        e1                               5.000000e+00
        out                              2.500000e+00
        in                               5.000000e+00
        v1#branch                        -2.50000e-03
        e1#branch                        -5.00000e-03
        e2#branch                        -5.00000e-03
        e3#branch                        -8.00000e-03
        be1#branch                       0.000000e+00
        be2#branch                       0.000000e+00
        be3#branch                       0.000000e+00
        bg1#branch                       0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 2.5, v(e1) = 5, v(e1_int1) = 5, v(e2) = 5, v(e2_int1) = 5, v(e3) = 8, v(e3_int1) = 8, v(g) = 5, v(g1_int1) = 0.005, i(bg1) = 0, i(be3) = 0, i(be2) = 0, i(be1) = 0, i(e3) = -0.008, i(e2) = -0.005, i(e1) = -0.005, i(v1) = -0.0025
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 5, v(out) = 2.5, v(e1) = 5, v(e1_int1) = 5, v(e2) = 5, v(e2_int1) = 5, v(e3) = 8, v(e3_int1) = 8, v(g) = 5, v(g1_int1) = 0.005, i(bg1) = 0, i(be3) = 0, i(be2) = 0, i(be1) = 0, i(e3) = -0.008, i(e2) = -0.005, i(e1) = -0.005, i(v1) = -0.0025
```

PlainSpice's checks: no trap.

### fatal-syntax-17. A node called value on an E or G line: ngspice reads the word as VALUE, and braces do not help

Added after the last pass (13 November 2026, round-1 critic of the formulas lane, CR1-10). ngspice reads the word value as VALUE, the start of a formula, wherever it stands on an E or G line, so E1 e 0 value 0 2 is a formula 0 2, which it can't read: "mal formed E source instance" (ngspice 42: "mal formed E line"). In braces it can't either ("unknown parameter (2.0000000000e+00)", the second run below), so the checks offer no braces there. Renamed (val), the node is a node again, and e = 5 V.

```spice
* a node called value
V1 in 0 5
R1 in value 1k
R2 value 0 1k
E1 e 0 value 0 2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    ERROR: mal formed E source instance: e1 e 0  vol= 0 2
        in line no. 5 of file c.cir
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    ERROR: mal formed E line: e1 e 0  vol= 0 2
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    ERROR: mal formed E source instance: e1 e 0  vol= 0 2
    in line no. 5 of file /circuit.cir
    ERROR: fatal error in ngspice, exit(1)
    vectors: (none)
after the fix "Rename the node value to val" (fatal-syntax), which writes `R1 in val 1k`, `R2 val 0 1k`, `E1 e 0 val 0 2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(val) = 2.5, v(e) = 5, i(e1) = -0.005, i(v1) = -0.0025
the braces the check offered before (E1 e 0 value {0 2}):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (2.0000000000e+00)
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (2.0000000000e+00)
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
on a G line (G1 0 e value 0 2m):
    ngspice 47, -b -r (exit 1): (no rawfile)
      ERROR: mal formed G source instance: g1 0 e  cur= 0 2m
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      ERROR: mal formed G line: g1 0 e  cur= 0 2m
      ERROR: fatal error in ngspice, exit(1)
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
```

PlainSpice's checks: `fatal-syntax`.

### fatal-syntax-18. A formula without braces that starts with a sign and a number (VALUE=-2*v(out)), or with a name that starts with true or false: ngspice stops

Added after the round-2 critic of the formulas lane (13 November 2026, CR2-1). After `=` ngspice puts braces round a formula itself, unless it starts with a digit or a `.`, with a sign and a digit (or a `.` and a digit), or with the letters true or false (inp_fix_param_values in its inpcom.c). So VALUE=-2*v(out) and VALUE=-.5*v(out) stop as VALUE=2*v(out) does (fatal-syntax-13): "mal formed E source instance". The fix puts the formula in braces; then all three give e = -5 V. A `.param` name that starts with true or false (truek) stops the same way, and runs in braces.

```spice
* VALUE=-2*v(out) without braces
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e 0 VALUE=-2*v(out)
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    ERROR: mal formed E source instance: e1 e 0   vol=-2*v(out)
        in line no. 5 of file c.cir
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    ERROR: mal formed E line: e1 e 0   vol=-2*v(out)
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    ERROR: mal formed E source instance: e1 e 0   vol=-2*v(out)
    in line no. 5 of file /circuit.cir
    ERROR: fatal error in ngspice, exit(1)
    vectors: (none)
after the fix "Put it in braces: {-2*v(out)}" (fatal-syntax), which writes `E1 e 0 VALUE={-2*v(out)}`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = -5, v(e1_int1) = -5, i(be1) = 0, i(e1) = 0.005, i(v1) = -0.0025
E1 e 0 VALUE=-.5*v(out), which PlainSpice's checks say the same way:
    ngspice 47, -b -r (exit 1): (no rawfile)
      ERROR: mal formed E source instance: e1 e 0   vol=-.5*v(out)
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      ERROR: mal formed E line: e1 e 0   vol=-.5*v(out)
      ERROR: fatal error in ngspice, exit(1)
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
G1 0 e cur=-2m*v(out), which PlainSpice's checks say the same way:
    ngspice 47, -b -r (exit 1): (no rawfile)
      ERROR: mal formed G source instance: g1 0 e cur=-2m*v(out)
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      ERROR: mal formed G line: g1 0 e cur=-2m*v(out)
      ERROR: fatal error in ngspice, exit(1)
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
E1 e 0 VALUE=truek*v(out) with .param truek=2, which PlainSpice's checks say the same way:
    ngspice 47, -b -r (exit 1): (no rawfile)
      ERROR: mal formed E source instance: e1 e 0   vol=truek*v(out)
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      ERROR: mal formed E line: e1 e 0   vol=truek*v(out)
      ERROR: fatal error in ngspice, exit(1)
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after its fix, E1 e 0 VALUE={truek*v(out)}:
    ngspice 47 and 42, -b -r (exit 0): v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, i(be1) = 0, i(e1) = -0.005, i(v1) = -0.0025
    our engine (exit 0): v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, i(be1) = 0, i(e1) = -0.005, i(v1) = -0.0025
```

PlainSpice's checks: `fatal-syntax`.

### fatal-syntax-19. A formula without braces that starts with a sign before a letter or a bracket, or with a bracket, gets its braces from ngspice (no trap)

Added after the round-2 critic of the formulas lane (13 November 2026, CR2-1). -v(out)*2, (1+v(out))*2, G's cur=-v(out)/1k and (2)*v(out): native 47 and 42 and our engine run each one (e1 = -5 V, e2 = 7 V, g = -2.5 V, e3 = 5 V). The braces ngspice adds end at the first blank outside brackets, and the line still runs with blanks after a bracket: (1+v(out)) * 2 gives 7 V too.

```spice
* formulas without braces that start with a sign or a bracket
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e1 0 VALUE=-v(out)*2
R1e e1 0 1k
E2 e2 0 VALUE=(1+v(out))*2
R2e e2 0 1k
G1 0 g cur=-v(out)/1k
Rg g 0 1k
E3 e3 0 VALUE=(2)*v(out)
R3e e3 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e3_int1                          5.000000e+00
        e3                               5.000000e+00
        g1_int1                          -2.50000e-03
        g                                -2.50000e+00
        e2_int1                          7.000000e+00
        e2                               7.000000e+00
        e1_int1                          -5.00000e+00
        e1                               -5.00000e+00
        out                              2.500000e+00
        in                               5.000000e+00
        v1#branch                        -2.50000e-03
        e1#branch                        5.000000e-03
        e2#branch                        -7.00000e-03
        e3#branch                        -5.00000e-03
        be1#branch                       0.000000e+00
        be2#branch                       0.000000e+00
        bg1#branch                       0.000000e+00
        be3#branch                       0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 2.5, v(e1) = -5, v(e1_int1) = -5, v(e2) = 7, v(e2_int1) = 7, v(g) = -2.5, v(g1_int1) = -0.0025, v(e3) = 5, v(e3_int1) = 5, i(be3) = 0, i(bg1) = 0, i(be2) = 0, i(be1) = 0, i(e3) = -0.005, i(e2) = -0.007, i(e1) = 0.005, i(v1) = -0.0025
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 5, v(out) = 2.5, v(e1) = -5, v(e1_int1) = -5, v(e2) = 7, v(e2_int1) = 7, v(g) = -2.5, v(g1_int1) = -0.0025, v(e3) = 5, v(e3_int1) = 5, i(be3) = 0, i(bg1) = 0, i(be2) = 0, i(be1) = 0, i(e3) = -0.005, i(e2) = -0.007, i(e1) = 0.005, i(v1) = -0.0025
E1 e 0 VALUE=(1+v(out)) * 2, with blanks after the bracket:
    ngspice 47 and 42, -b -r (exit 0): v(in) = 5, v(out) = 2.5, v(e) = 7, v(e1_int1) = 7, i(be1) = 0, i(e1) = -0.007, i(v1) = -0.0025
    our engine (exit 0): v(in) = 5, v(out) = 2.5, v(e) = 7, v(e1_int1) = 7, i(be1) = 0, i(e1) = -0.007, i(v1) = -0.0025
E1 e 0 VALUE=-truek*v(out) with .param truek=2: a sign before the name, so the braces come:
    ngspice 47 and 42, -b -r (exit 0): v(in) = 5, v(out) = 2.5, v(e) = -5, v(e1_int1) = -5, i(be1) = 0, i(e1) = 0.005, i(v1) = -0.0025
    our engine (exit 0): v(in) = 5, v(out) = 2.5, v(e) = -5, v(e1_int1) = -5, i(be1) = 0, i(e1) = 0.005, i(v1) = -0.0025
E1 e 0 VALUE (1+v(out))*2, without =: no braces from ngspice (fatal-syntax-14):
    ngspice 47, -b -r (exit 1): (no rawfile)
      ERROR: mal formed E source instance: e1 e 0  vol= (1+v(out))*2
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      ERROR: mal formed E line: e1 e 0  vol= (1+v(out))*2
      ERROR: fatal error in ngspice, exit(1)
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
```

PlainSpice's checks: no trap.

### fatal-syntax-20. A node called value as an E's control − node, an output node or a POLY control node: ngspice reads the word as VALUE there too and stops; with braces after it, it runs a constant

Added after the round-2 critic of the formulas lane (13 November 2026, CR2-4). ngspice reads the first word value on an E or G line as VALUE wherever it stands (search_plain_identifier, then inp_compat), not only right after the output nodes (fatal-syntax-17). As the control − node (E1 e 0 mid value 2, below), an output node (E1 value 0 mid 0 2, G1 0 value mid 0 2m) or a POLY control node, the line becomes a formula ngspice can't read: "mal formed E source instance". Braces after it (E1 e 0 mid value {2}, which the checks offered before) make the line run, but as the constant 2 V: the control nodes count for nothing. Renamed (val), the node is a node again: e = 2 × (3.333 − 1.667) = 3.333 V, in native 47 and 42 and our engine.

```spice
* a node called value as the control - node
V1 in 0 5
R1 in mid 1k
R2 mid value 1k
R3 value 0 1k
E1 e 0 mid value 2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    ERROR: mal formed E source instance: e1 e 0 mid  vol= 2
        in line no. 6 of file c.cir
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    ERROR: mal formed E line: e1 e 0 mid  vol= 2
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    ERROR: mal formed E source instance: e1 e 0 mid  vol= 2
    in line no. 6 of file /circuit.cir
    ERROR: fatal error in ngspice, exit(1)
    vectors: (none)
after the fix "Rename the node value to val" (fatal-syntax), which writes `R2 mid val 1k`, `R3 val 0 1k`, `E1 e 0 mid val 2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(mid) = 3.333333333333333, v(val) = 1.6666666666666665, v(e) = 3.333333333333333, i(e1) = -0.003333333333333333, i(v1) = -0.001666666666666667
with the gain in braces, E1 e 0 mid value {2}, which PlainSpice's checks call a warning: it runs, as a constant:
    ngspice 47 and 42, -b -r (exit 0): v(in) = 5, v(mid) = 3.333333333333333, v(value) = 1.6666666666666665, v(e) = 2, v(e1_int1) = 2, i(be1) = 0, i(e1) = -0.002, i(v1) = -0.001666666666666667
    our engine (exit 0): v(in) = 5, v(mid) = 3.333333333333333, v(value) = 1.6666666666666665, v(e) = 2, v(e1_int1) = 2, i(be1) = 0, i(e1) = -0.002, i(v1) = -0.001666666666666667
an output node called value, E1 value 0 mid 0 2, which PlainSpice's checks say the same way:
    ngspice 47, -b -r (exit 1): (no rawfile)
      ERROR: mal formed E source instance: e1  vol= 0 mid 0 2
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      ERROR: mal formed E line: e1  vol= 0 mid 0 2
      ERROR: fatal error in ngspice, exit(1)
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
on a G line, G1 0 value mid 0 2m, which PlainSpice's checks say the same way:
    ngspice 47, -b -r (exit 1): (no rawfile)
      ERROR: mal formed G source instance: g1 0  cur= mid 0 2m
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      ERROR: mal formed G line: g1 0  cur= mid 0 2m
      ERROR: fatal error in ngspice, exit(1)
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
a POLY control node called value, E1 e 0 POLY(1) value 0 0 2, which PlainSpice's checks say the same way (not that native ngspice runs the POLY):
    ngspice 47, -b -r (exit 1): (no rawfile)
      ERROR: mal formed E source instance: e1 e 0 poly(1)  vol= 0 0 2
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      ERROR: mal formed E line: e1 e 0 poly(1)  vol= 0 0 2
      ERROR: fatal error in ngspice, exit(1)
    our engine (exit 1, no results): (none)
      Error: XSPICE is required to run the 'poly' option in instance e1 e 0 poly(1) value 0 0 2
      ERROR: fatal error in ngspice, exit(1)
```

PlainSpice's checks: `fatal-syntax`.

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

### lost-continuation-3. A + line right after the title is skipped silently

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

A word after a part's value that ngspice cannot use there, on R, C, L, V, I, E, F, G and H lines: a note written without a semicolon, a value the part can only report (i, p), one number too many, or the second half of `1d-3` (a sign after a letter starts a new word, N8). The parser knows each part's settings from ngspice 47's parameter tables (`src/spice/parse.ts`), so `m=2`, `tc1=1m`, `ic=0` and the like are not flagged. Error: ngspice stops; on E, F, G and H lines our engine stops while native 47 reads a polynomial (XSPICE). Words a more specific trap explains (a decimal comma, a space before a scale letter, a mid-line comment) are left to it. Fixes: turn the word and the rest of the line into a comment with `;`, or write `1e-3` for `1d-3`. After the re-check of the fixes (12 November 2026, S6): a word where the value goes, with no value before it (`R1 a 0 Rload`, `E1 b 0 a 0 Av`), is said as that: it is no number, so ngspice stops, on E, F, G and H lines too, with no polynomial (unknown-word-13 to -21); its fix is never a comment, which would leave the part with no value, and a sign with a space after it (`- 5`) gets Write -5 (space-character-13). A name defined on a `.param` line is that value there, so it is no trap (unknown-word-22 to -24). After the critic of those fixes (12 November 2026): a sign with a space after it is said part by part (CR1-3): on E, F, G and H lines native 47 and 42 read a polynomial and stop with a MIF-ERROR while our engine says "unknown parameter (-)" (unknown-word-25 to -28), on C and L ngspice first warns that it can't find a model called `-` (-29, -30), and R, V and I stop at the sign (-31, -32, space-character-13). Only a top-level `.param` line's names are values outside a subcircuit, after `.end` too, as ngspice reads them (-36, -37); a subcircuit's own parameter, a `.param` inside a subcircuit and a `.func`'s name are not, and ngspice stops (-33 to -35), so the words say where the name has its value (CR1-7). After the last pass (13 November 2026, code review C3-5): two words ngspice takes out before it reads an E, F, G or H line are no trap. HSPICE's word for the kind of part after the output nodes (`vcvs`, `vccs`, `cccs`, `ccvs`) goes when the line has exactly seven words (E, G) or six (F, H), and stays as a node with one word more (unknown-word-53); two or more words between an E's or G's output nodes and its formula (`E1 e 0 in 0 VALUE={...}`, a gain left on the line) are dropped, so the output is the formula alone (unknown-word-54, -55; one word: missing-fields-9).

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

After the last pass (13 November 2026): the same two messages for a capacitor's `i`, an inductor's `flux` and a resistor's `sens_dc` (unknown-word-56), and for a voltage source's `i` and a current source's `v` (unknown-word-57).

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

What PlainSpice shows for unknown-word-13 (error, line 4):

> **R1's value is not a number.** Rload stands where R1's value goes, but it is not a number, and no .param line gives it a value, so SPICE stops there. Write the number itself, or give Rload a value on a .param line and write it in braces: {Rload}.
>
> *ngspice:* ngspice looks for a model called rload, warns 'can't find model', and stops: 'unknown parameter (rload)'. [unknown-word-13, unknown-word-23]
>
> *Fixes:* none

What PlainSpice shows for unknown-word-18 (error, line 4):

> **E1's gain is not a number.** Av stands where E1's gain goes, but it is not a number, and no .param line gives it a value, so SPICE stops there. Write the number itself, or give Av a value on a .param line and write it in braces: {Av}.
>
> *ngspice:* ngspice stops: 'unknown parameter (av)'. [unknown-word-18, unknown-word-23]
>
> *Fixes:* none

What PlainSpice shows for space-character-13 (error, line 2):

> **V1's value is not a number.** The - and the 5 are two words for SPICE: a space after a sign splits the value in two, and a sign alone is no number, so SPICE stops there. Write -5.
>
> *ngspice:* ngspice stops: 'unknown parameter (-)'. [space-character-13]
>
> *Fixes:* "Write -5 (−5 V)"

What PlainSpice shows for unknown-word-25 (error, line 4):

> **E1's gain is not a number.** The - and the 2 are two words for SPICE: a space after a sign splits the value in two, and a sign alone is no number, so SPICE stops there. Write -2.
>
> *ngspice:* PlainSpice's engine stops: 'unknown parameter (-)'. Native ngspice 47 and 42 read the line as a polynomial and stop: 'MIF-ERROR ... Bad real value'. [unknown-word-25]
>
> *Fixes:* "Write -2 (a gain of −2)"

What PlainSpice shows for unknown-word-29 (error, line 4):

> **C1's value is not a number.** The - and the 5u are two words for SPICE: a space after a sign splits the value in two, and a sign alone is no number, so SPICE stops there. Write -5u.
>
> *ngspice:* ngspice looks for a model called -, warns 'can't find model', and stops: 'unknown parameter (-)'. [unknown-word-29]
>
> *Fixes:* "Write -5u (−5 µF)"

What PlainSpice shows for unknown-word-33 (error, line 5):

> **V1's value is not a number.** Vs stands where V1's value goes, but it has a value only inside the subcircuit foo, and this line is outside it, so SPICE stops there. Write the number itself, or give Vs a value on a .param line outside the subcircuit and write it in braces: {Vs}.
>
> *ngspice:* ngspice stops: 'unknown parameter (vs)'. [unknown-word-16, unknown-word-23, unknown-word-33, unknown-word-34]
>
> *Fixes:* none

What PlainSpice shows for unknown-word-35 (error, line 3):

> **V1's value is not a number.** f stands where V1's value goes, but it is the name of a function (on a .func line), not a number, so SPICE stops there. Write the number itself.
>
> *ngspice:* ngspice stops: 'unknown parameter (f)'. [unknown-word-16, unknown-word-35]
>
> *Fixes:* none

### unknown-word-13. A word where a resistor's value goes: ngspice looks for a model with its name, warns, and stops

Added after the re-check (12 November 2026, S6): a textbook symbol where the number goes, with no `.param` line that defines it.

```spice
* a textbook symbol as a resistor's value
V1 a 0 1
R0 a 0 1k
R1 a 0 Rload
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'rload' from line
        r1 a 0 rload
    Error on line 4 or its substitute:
      r1 a 0 rload
      unknown parameter (rload)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'rload' from line
        r1 a 0 rload
    Error on line 4 or its substitute:
      r1 a 0 rload
      unknown parameter (rload)
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

### unknown-word-14. The same where a capacitor's value goes

```spice
* a textbook symbol as a capacitor's value
V1 a 0 1
R0 a b 1k
C1 b 0 Cx
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'cx' from line
        c1 b 0 cx
    Error on line 4 or its substitute:
      c1 b 0 cx
      unknown parameter (cx)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'cx' from line
        c1 b 0 cx
    Error on line 4 or its substitute:
      c1 b 0 cx
      unknown parameter (cx)
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

### unknown-word-15. The same where an inductor's value goes

```spice
* a textbook symbol as an inductor's value
V1 a 0 1
R0 a b 1k
L1 b 0 Lx
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'lx' from line
        l1 b 0 lx
    Error on line 4 or its substitute:
      l1 b 0 lx
      unknown parameter (lx)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'lx' from line
        l1 b 0 lx
    Error on line 4 or its substitute:
      l1 b 0 lx
      unknown parameter (lx)
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

### unknown-word-16. A word where a voltage source's value goes: ngspice stops

```spice
* a textbook symbol as a voltage source's value
V1 a 0 Vs
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 vs
      unknown parameter (vs)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 vs
      unknown parameter (vs)
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

### unknown-word-17. The same where a current source's value goes

```spice
* a textbook symbol as a current source's value
I1 0 a Is
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a is
      unknown parameter (is)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a is
      unknown parameter (is)
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

### unknown-word-18. A word where E's gain goes: native 47 stops too, 'unknown parameter (av)', with no polynomial

Native 47's XSPICE reads extra words after a gain as a polynomial (unknown-word-5); with no gain before the word, it stops at it like 42 and our engine.

```spice
* a textbook symbol as the gain of E
V1 a 0 1
R0 a 0 1k
E1 b 0 a 0 Av
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      e1 b 0 a 0 av
      unknown parameter (av)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      e1 b 0 a 0 av
      unknown parameter (av)
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

### unknown-word-19. The same where F's gain goes

```spice
* a textbook symbol as the gain of F
V1 a 0 1
R0 a 0 1k
F1 0 b V1 beta
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      f1 0 b v1 beta
      unknown parameter (beta)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      f1 0 b v1 beta
      unknown parameter (beta)
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

### unknown-word-20. The same where G's value goes

```spice
* a textbook symbol as the value of G
V1 a 0 1
R0 a 0 1k
G1 0 b a 0 gm
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      g1 0 b a 0 gm
      unknown parameter (gm)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      g1 0 b a 0 gm
      unknown parameter (gm)
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

### unknown-word-21. The same where H's value goes

```spice
* a textbook symbol as the value of H
V1 a 0 1
R0 a 0 1k
H1 b 0 V1 rm
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      h1 b 0 v1 rm
      unknown parameter (rm)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      h1 b 0 v1 rm
      unknown parameter (rm)
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

### unknown-word-22. A name from a .param line where the value goes is that value, for every part: no trap (R, C and L also warn about a model)

ngspice puts each parameter's value in place of its name: V1 is 5 V, R1 2 kΩ (2.5 mA), E1's gain 10, F1's 2, G1's 1 mA/V and H1's 1 kΩ. On R, C and L it also looks the name up as a model first and warns that it finds none.

```spice
* names from a .param line where each part's value goes
.param Rl=2k Cx=1u Lx=1m Vs=5 Is=1m Av=10 beta=2 gm=1m rm=1k
V1 a 0 Vs
R1 a 0 Rl
C1 a 0 Cx
L1 a b Lx
R2 b 0 1k
I1 0 c Is
R3 c 0 1k
E1 d 0 a 0 Av
R4 d 0 1k
F1 0 e V1 beta
R5 e 0 1k
G1 0 f a 0 gm
R6 f 0 1k
H1 g 0 V1 rm
R7 g 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
            g                                -7.50000e+00
            f                                5.000000e+00
            e                                -1.50000e+01
            d                                5.000000e+01
            c                                1.000000e+00
            b                                5.000000e+00
            a                                5.000000e+00
            e1#branch                        -5.00000e-02
            l1#branch                        5.000000e-03
            h1#branch                        7.500000e-03
            v1#branch                        -7.50000e-03
    warning, can't find model 'rl' from line
        r1 a 0 rl
    warning, can't find model 'cx' from line
        c1 a 0 cx
    warning, can't find model 'lx' from line
        l1 a b lx
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 5, v(b) = 5, v(c) = 1, v(d) = 50, v(e) = -15, v(f) = 5, v(g) = -7.5, i(v1) = -0.0075, i(h1) = 0.0075, i(l1) = 0.005, i(e1) = -0.05
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(a) = 5, v(b) = 5, v(c) = 1, v(d) = 50, v(e) = -15, v(f) = 5, v(g) = -7.5, i(v1) = -0.0075, i(h1) = 0.0075, i(l1) = 0.005, i(e1) = -0.05
```

PlainSpice's checks: none.

### unknown-word-23. The same names in braces: the same values, without a warning

What the unknown-word check suggests for a name with no `.param` line: give it a value there and write it in braces.

```spice
* the same names in braces
.param Rl=2k Cx=1u Lx=1m Vs=5 Is=1m Av=10 beta=2 gm=1m rm=1k
V1 a 0 {Vs}
R1 a 0 {Rl}
C1 a 0 {Cx}
L1 a b {Lx}
R2 b 0 1k
I1 0 c {Is}
R3 c 0 1k
E1 d 0 a 0 {Av}
R4 d 0 1k
F1 0 e V1 {beta}
R5 e 0 1k
G1 0 f a 0 {gm}
R6 f 0 1k
H1 g 0 V1 {rm}
R7 g 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
            g                                -7.50000e+00
            f                                5.000000e+00
            e                                -1.50000e+01
            d                                5.000000e+01
            c                                1.000000e+00
            b                                5.000000e+00
            a                                5.000000e+00
            e1#branch                        -5.00000e-02
            l1#branch                        5.000000e-03
            h1#branch                        7.500000e-03
            v1#branch                        -7.50000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 5, v(b) = 5, v(c) = 1, v(d) = 50, v(e) = -15, v(f) = 5, v(g) = -7.5, i(v1) = -0.0075, i(h1) = 0.0075, i(l1) = 0.005, i(e1) = -0.05
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 5, v(b) = 5, v(c) = 1, v(d) = 50, v(e) = -15, v(f) = 5, v(g) = -7.5, i(v1) = -0.0075, i(h1) = 0.0075, i(l1) = 0.005, i(e1) = -0.05
```

PlainSpice's checks: none.

### unknown-word-24. The same for a .param whose value is an expression

`.param Av={2*5}` makes Av 10 where E1's gain goes, as a plain number does (unknown-word-22): no trap, and Explain calls it a name from a `.param` line.

```spice
* a gain named on a .param line whose value is an expression
.param Av={2*5}
V1 a 0 1
R0 a 0 1k
E1 b 0 a 0 Av
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
            b                                1.000000e+01
            a                                1.000000e+00
            v1#branch                        -1.00000e-03
            e1#branch                        -1.00000e-02
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 1, v(b) = 10, i(e1) = -0.01, i(v1) = -0.001
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 1, v(b) = 10, i(e1) = -0.01, i(v1) = -0.001
```

PlainSpice's checks: none.

### unknown-word-25. A sign with a space after it where E's gain goes: our engine says 'unknown parameter (-)', native 47 and 42 read a polynomial and stop

Added after the critic of the re-check fixes (12 November 2026, CR1-3): what ngspice says of - 5 (a sign, a space, the number) depends on the part. Native ngspice 47 and 42, both built with XSPICE, read an E, F, G or H line whose gain is no number as a polynomial and stop with a polynomial error (-25 to -28); our engine, built without XSPICE, says "unknown parameter". On a capacitor or an inductor ngspice first looks the sign up as a model (-29, -30); on R, V and I it stops at the sign (-31, -32, space-character-13). A + does the same as a -. The check's fix writes the sign and the number together.

```spice
* a minus sign with a space after it where E's gain goes
V1 a 0 1
R0 a 0 1k
E1 b 0 a 0 - 2
R1 b 0 1k
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
    e1 b 0 a 0 - 2
    unknown parameter (-)
    Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-word`.

### unknown-word-26. The same where F's gain goes

```spice
* a minus sign with a space after it where F's gain goes
V1 a 0 1
R0 a 0 1k
F1 0 b V1 - 2
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line:
      a$poly$f1 %vnam [ v1 ] %id ( 0 b ) a$poly$f1
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
      a$poly$f1 %vnam [ v1 ] %id ( 0 b ) a$poly$f1
    MIF-ERROR - model: a$poly$f1 - Bad real value
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
    f1 0 b v1 - 2
    unknown parameter (-)
    Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-word`.

### unknown-word-27. The same where G's value goes

```spice
* a minus sign with a space after it where G's value goes
V1 a 0 1
R0 a 0 1k
G1 0 b a 0 - 1m
R1 b 0 1k
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
    g1 0 b a 0 - 1m
    unknown parameter (-)
    Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-word`.

### unknown-word-28. The same where H's value goes, with a + sign

```spice
* a plus sign with a space after it where H's value goes
V1 a 0 1
R0 a 0 1k
H1 b 0 V1 + 2
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line:
      a$poly$h1 %vnam [ v1 ] %vd ( b 0 ) a$poly$h1
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
      a$poly$h1 %vnam [ v1 ] %vd ( b 0 ) a$poly$h1
    MIF-ERROR - model: a$poly$h1 - Bad real value
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
    h1 b 0 v1 + 2
    unknown parameter (+)
    Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-word`.

### unknown-word-29. On a capacitor ngspice first looks the sign up as a model, then stops

```spice
* a minus sign with a space after it where a capacitor's value goes
V1 a 0 1
R1 a b 1k
C1 b 0 - 5u
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '-' from line
        c1 b 0 - 5u
    Error on line 4 or its substitute:
      c1 b 0 - 5u
      unknown parameter (-)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '-' from line
        c1 b 0 - 5u
    Error on line 4 or its substitute:
      c1 b 0 - 5u
      unknown parameter (-)
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

### unknown-word-30. On an inductor too, with a + sign

```spice
* a plus sign with a space after it where an inductor's value goes
V1 a 0 1
R1 a b 1k
L1 b 0 + 5u
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '+' from line
        l1 b 0 + 5u
    Error on line 4 or its substitute:
      l1 b 0 + 5u
      unknown parameter (+)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '+' from line
        l1 b 0 + 5u
    Error on line 4 or its substitute:
      l1 b 0 + 5u
      unknown parameter (+)
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

### unknown-word-31. On a resistor ngspice stops at the sign, with no model warning

```spice
* a minus sign with a space after it where a resistor's value goes
V1 a 0 1
R1 a 0 - 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      r1 a 0 - 5
      unknown parameter (-)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      r1 a 0 - 5
      unknown parameter (-)
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

### unknown-word-32. On a current source the same, with a + sign

```spice
* a plus sign with a space after it where a current source's value goes
I1 0 a + 1m
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a + 1m
      unknown parameter (+)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a + 1m
      unknown parameter (+)
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

### unknown-word-33. A subcircuit's own parameter is no value outside it: ngspice stops

Added after the critic of the re-check fixes (12 November 2026, CR1-7): only a name from a .param line outside every subcircuit is a value a part can name at the top level (unknown-word-22), and such a line counts after .end too (-36, -37). A subcircuit's own parameters (-33), a .param line inside a subcircuit (-34) and a .func's name (-35) are not: ngspice stops, "unknown parameter", so the check says so.

```spice
* a subcircuit's own parameter named where a value goes outside it
.subckt foo x y Vs=5
R1 x y 1k
.ends
V1 a 0 Vs
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      v1 a 0 vs
      unknown parameter (vs)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      v1 a 0 vs
      unknown parameter (vs)
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

### unknown-word-34. A .param line inside a subcircuit: the same

```spice
* a .param line inside a subcircuit, its name used outside it
.subckt foo x y
.param Vs=5
R1 x y 1k
.ends
V1 a 0 Vs
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 6 or its substitute:
      v1 a 0 vs
      unknown parameter (vs)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 6 or its substitute:
      v1 a 0 vs
      unknown parameter (vs)
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

### unknown-word-35. A .func's name: the same

```spice
* a .func name where a value goes
.func f(x) {x*2}
V1 a 0 f
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      v1 a 0 f
      unknown parameter (f)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      v1 a 0 f
      unknown parameter (f)
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

### unknown-word-36. A .param line after .end is read: the name is its value

```spice
* a .param line after .end
V1 a 0 Vs
R1 a 0 1k
.op
.end
.param Vs=5
```

```text
ngspice 47, ngspice -b (exit 0):
            a                                5.000000e+00
            v1#branch                        -5.00000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 5, i(v1) = -0.005
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 5, i(v1) = -0.005
```

PlainSpice's checks: `after-end`.

### unknown-word-37. After .end;comment too

ngspice leaves out the parts after .end;comment (after-end-2), but its numparam still reads a .param line there.

```spice
* a .param line after .end with a comment glued to it
V1 a 0 Vs
R1 a 0 1k
.op
.end;x
.param Vs=5
```

```text
ngspice 47, ngspice -b (exit 0):
            a                                5.000000e+00
            v1#branch                        -5.00000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 5, i(v1) = -0.005
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 5, i(v1) = -0.005
```

PlainSpice's checks: `after-end`.

### unknown-word-38. Inside a subcircuit, another subcircuit's parameter is no value: ngspice stops

Added after the second critic of the re-check fixes (12 November 2026, CR2-5). Inside a subcircuit ngspice gives a word its value from the top level's .param lines and from that subcircuit's own (its .subckt line and the .param lines in it), never from another subcircuit's: it warns that it can't find a model rv and stops at r.x2.r1. A subcircuit's own parameter written bare inside it runs (2 kΩ here for foo, as before).

```spice
* bar's R1 names foo's parameter Rv
.subckt foo x y Rv=2k
R1 x y {Rv}
.ends
.subckt bar x y
R1 x y Rv
.ends
V1 a 0 1
X1 a 0 foo
X2 a 0 bar
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'rv' from line
        r1 x y rv
    Error on line 6 or its substitute:
      r.x2.r1 a 0 rv
      unknown parameter (rv)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'rv' from line
        r1 x y rv
    Error on line:
      r.x2.r1 a 0 rv
      unknown parameter (rv)
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

### unknown-word-39. Inside a subcircuit, a .func's name is no value either

```spice
* bar's R1 names the function f
.func f(x) {x*2}
.subckt bar x y
R1 x y f
.ends
V1 a 0 1
X2 a 0 bar
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'f' from line
        r1 x y f
    Error on line 4 or its substitute:
      r.x2.r1 a 0 f
      unknown parameter (f)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'f' from line
        r1 x y f
    Error on line:
      r.x2.r1 a 0 f
      unknown parameter (f)
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

### unknown-word-40. m= after an E's gain: ngspice stops at m, natively too, with no polynomial

Added after the second critic of the re-check fixes (12 November 2026, CR2-8). F and G take m, their multiplier (F1 0 b V1 2 m=3 runs with a gain of 6); E and H do not, and native ngspice 47 and 42 stop at it as our engine does, 'unknown parameter (m)', where any other extra word after the gain is read as part of a polynomial (unknown-word-5, -51).

```spice
* m=3 after E1's gain
V1 a 0 1
R0 a 0 1k
E1 b 0 a 0 2 m=3
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      e1 b 0 a 0 2 m=3
      unknown parameter (m)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      e1 b 0 a 0 2 m=3
      unknown parameter (m)
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

### unknown-word-41. m= after an H's value: the same

```spice
* m=3 after H1's value
V1 a 0 1
R0 a 0 1k
H1 b 0 V1 2 m=3
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      h1 b 0 v1 2 m=3
      unknown parameter (m)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      h1 b 0 v1 2 m=3
      unknown parameter (m)
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

### unknown-word-42. Where a resistor's value goes, a setting it does not have (x=5): ngspice stops, with no model warning

Added after the second critic of the re-check fixes (12 November 2026, CR2-8). A word followed by = where the value goes is a setting for SPICE, and the part has none called x: ngspice stops at it on every part. Unlike a bare word there (unknown-word-13 to -15), no model is looked up first, and on E to H lines native 47 reads no polynomial. The value is the number alone: R1 a 0 5.

```spice
* x=... where R1's value goes
V1 a 0 1
R1 a 0 x=5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      r1 a 0 x=5
      unknown parameter (x)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 3 or its substitute:
      r1 a 0 x=5
      unknown parameter (x)
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

### unknown-word-43. The same on a capacitor

```spice
* x=... where C1's value goes
V1 a 0 1
R1 a b 1k
C1 b 0 x=5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      c1 b 0 x=5
      unknown parameter (x)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      c1 b 0 x=5
      unknown parameter (x)
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

### unknown-word-44. The same on an inductor

```spice
* x=... where L1's value goes
V1 a 0 1
R1 a b 1k
L1 b 0 x=5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      l1 b 0 x=5
      unknown parameter (x)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      l1 b 0 x=5
      unknown parameter (x)
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

### unknown-word-45. The same on a voltage source

```spice
* x=... where V1's value goes
V1 a 0 x=5
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 x=5
      unknown parameter (x)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 x=5
      unknown parameter (x)
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

### unknown-word-46. The same on a current source

```spice
* x=... where I1's value goes
I1 0 a x=5
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a x=5
      unknown parameter (x)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a x=5
      unknown parameter (x)
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

### unknown-word-47. The same on an E line, natively too: no polynomial

```spice
* x=... where E1's value goes
V1 a 0 1
R0 a 0 1k
E1 b 0 a 0 x=5
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      e1 b 0 a 0 x=5
      unknown parameter (x)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      e1 b 0 a 0 x=5
      unknown parameter (x)
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

### unknown-word-48. The same on an F line

```spice
* x=... where F1's value goes
V1 a 0 1
R0 a 0 1k
F1 0 b V1 x=5
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      f1 0 b v1 x=5
      unknown parameter (x)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      f1 0 b v1 x=5
      unknown parameter (x)
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

### unknown-word-49. The same on a G line: gm=1m, a transconductance's textbook name

```spice
* gm=... where G1's value goes
V1 a 0 1
R0 a 0 1k
G1 0 b a 0 gm=1m
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      g1 0 b a 0 gm=1m
      unknown parameter (gm)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      g1 0 b a 0 gm=1m
      unknown parameter (gm)
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

### unknown-word-50. The same on an H line

```spice
* x=... where H1's value goes
V1 a 0 1
R0 a 0 1k
H1 b 0 V1 x=5
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      h1 b 0 v1 x=5
      unknown parameter (x)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      h1 b 0 v1 x=5
      unknown parameter (x)
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

### unknown-word-51. Another name=value after an E's gain is read natively as part of a polynomial

Only m is read as a setting there: x=3 gives native 47 and 42 the polynomial error of unknown-word-5, and our engine 'unknown parameter (x)'.

```spice
* x=3 after E1's gain
V1 a 0 1
R0 a 0 1k
E1 b 0 a 0 2 x=3
R1 b 0 1k
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
    e1 b 0 a 0 2 x=3
    unknown parameter (x)
    Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

PlainSpice's checks: `unknown-word`.

### unknown-word-52. A sign with a space before a number with a hidden character in it: ngspice still stops at the sign

Added after the second critic of the re-check fixes (CR2-6): ngspice stops at the sign, as for - 10 (unknown-word-31), and never reads the number after it, so the checks say the sign's error alone, and its fix writes -10 without the character.

```spice
* a resistor written - 1<ZWSP>0
V1 a 0 1
R3 a 0 - 1<ZWSP>0
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '1<ZWSP>0' from line
        r3 a 0 - 1<ZWSP>0
    Error on line 3 or its substitute:
      r3 a 0 - 1___0
      unknown parameter (-)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '1<ZWSP>0' from line
        r3 a 0 - 1<ZWSP>0
    Error on line 3 or its substitute:
      r3 a 0 - 1___0
      unknown parameter (-)
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

### unknown-word-53. HSPICE's word for the kind of part (E1 e 0 vcvs out 0 2): ngspice takes it out of a line of seven words (E, G) or six (F, H) (no trap)

Added after the last pass (13 November 2026, code review C3-5). HSPICE writes the kind of a controlled source after its two output nodes: `vcvs` on E lines, `vccs` on G, `cccs` on F and `ccvs` on H. ngspice takes the word out before it reads the line (inp_compat in its inpcom.c, replace_token), but only when the line has exactly seven words (E, G) or six (F, H), so each source here works as usual: native 47 and 42 and our engine give e = 5 V, g = 5 V, f = 5 V and h = 2.5 V. Before, PlainSpice read the word as a node or a voltage source and said "vcvs has no DC path to ground", "SPICE can't use 2 on this line", "There is no voltage source called cccs" and "F1's gain is not a number". With one more word on the line, ngspice keeps the word as a node and stops at the word after the gain, native ngspice 47 and 42 too, before they simulate anything (the second and third runs below). After the round-1 critic of the formulas lane (13 November 2026, CR1-8) the checks say so: unknown-word quotes that stop and no longer says that native ngspice 47 reads a polynomial and runs, and the no-DC-path error for the word kept as a node ("vcvs has no DC path to ground", with ngspice's singular-matrix warning, which never comes) is left out.

```spice
* the word for the kind of controlled source, as HSPICE writes it
V1 in 0 5
Vs in mid 0
R1 mid out 1k
R2 out 0 1k
E1 e 0 vcvs out 0 2
Re e 0 1k
G1 0 g vccs out 0 2m
Rg g 0 1k
F1 0 f cccs Vs 2
Rf f 0 1k
H1 h 0 ccvs Vs 1k
Rh h 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        h                                2.500000e+00
        f                                5.000000e+00
        g                                5.000000e+00
        e                                5.000000e+00
        out                              2.500000e+00
        mid                              5.000000e+00
        in                               5.000000e+00
        v1#branch                        -2.50000e-03
        e1#branch                        -5.00000e-03
        h1#branch                        -2.50000e-03
        vs#branch                        2.500000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(mid) = 5, v(out) = 2.5, v(e) = 5, v(g) = 5, v(f) = 5, v(h) = 2.5, i(vs) = 0.0025, i(h1) = -0.0025, i(e1) = -0.005, i(v1) = -0.0025
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 5, v(mid) = 5, v(out) = 2.5, v(e) = 5, v(g) = 5, v(f) = 5, v(h) = 2.5, i(vs) = 0.0025, i(h1) = -0.0025, i(e1) = -0.005, i(v1) = -0.0025
with one more word (E1 e 0 vcvs out 0 2 m=1, eight words), which PlainSpice's checks say as `unknown-word` (SPICE can't use 2 on this line):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (2)
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (2)
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
the same on a G line (G1 0 e vccs out 0 2m m=1), which the checks say as `unknown-word` (SPICE can't use 2m on this line):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (2m)
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (2m)
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
```

PlainSpice's checks: no trap.

### unknown-word-54. Two words between the output nodes and VALUE= or cur= (E1 e 0 in 0 VALUE={...}): ngspice drops them, the output is the formula alone (no trap)

Added after the last pass (13 November 2026, code review C3-5). When an E or G line has two more words after its output nodes and then the formula, ngspice drops the two words (inp_compat in its inpcom.c keeps the output nodes and the formula), so they change nothing: `E2 e2 0 out 0 VALUE={2}` gives e2 = 2 V whatever v(out) is. Native 47 and 42 and our engine give e = 5 V, g = 5 V and e2 = 2 V. Before, PlainSpice said "E1 has no setting called VALUE", "G1 has no setting called cur" and "E2 has no setting called VALUE". Explain shows the two words as words ngspice drops.

```spice
* two words between the output nodes and the formula
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e 0 in 0 VALUE={v(out)*2}
Re e 0 1k
G1 0 g in 0 cur={v(out)*2m}
Rg g 0 1k
E2 e2 0 out 0 VALUE={2}
Re2 e2 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e2_int1                          2.000000e+00
        e2                               2.000000e+00
        g1_int1                          5.000000e-03
        g                                5.000000e+00
        e1_int1                          5.000000e+00
        e                                5.000000e+00
        out                              2.500000e+00
        in                               5.000000e+00
        v1#branch                        -2.50000e-03
        e1#branch                        -5.00000e-03
        e2#branch                        -2.00000e-03
        be1#branch                       0.000000e+00
        bg1#branch                       0.000000e+00
        be2#branch                       0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, v(g) = 5, v(g1_int1) = 0.005, v(e2) = 2, v(e2_int1) = 2, i(be2) = 0, i(bg1) = 0, i(be1) = 0, i(e2) = -0.002, i(e1) = -0.005, i(v1) = -0.0025
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, v(g) = 5, v(g1_int1) = 0.005, v(e2) = 2, v(e2_int1) = 2, i(be2) = 0, i(bg1) = 0, i(be1) = 0, i(e2) = -0.002, i(e1) = -0.005, i(v1) = -0.0025
```

PlainSpice's checks: no trap.

### unknown-word-55. Three or more words between the output nodes and the formula: ngspice drops them too (no trap)

Added after the last pass (13 November 2026, code review C3-5). ngspice keeps an E's or G's output nodes and its formula and drops every word between, however many (inp_compat in its inpcom.c takes the formula from its `{` to the end of the line), so a gain left on the line when VALUE= was added changes nothing: native 47 and 42 and our engine give e = 5 V and e2 = 2 V. Before, PlainSpice said "SPICE can't use VALUE on this line" for E1, and "a has no DC path to ground" and "E2's gain is not a number" for E2.

```spice
* words between the output nodes and the formula
V1 in 0 5
R1 in out 1k
R2 out 0 1k
E1 e 0 out 0 2 VALUE={v(out)*2}
Re e 0 1k
E2 e2 0 a b c d VALUE={2}
Re2 e2 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e2_int1                          2.000000e+00
        e2                               2.000000e+00
        e1_int1                          5.000000e+00
        e                                5.000000e+00
        out                              2.500000e+00
        in                               5.000000e+00
        v1#branch                        -2.50000e-03
        e1#branch                        -5.00000e-03
        e2#branch                        -2.00000e-03
        be1#branch                       0.000000e+00
        be2#branch                       0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, v(e2) = 2, v(e2_int1) = 2, i(be2) = 0, i(be1) = 0, i(e2) = -0.002, i(e1) = -0.005, i(v1) = -0.0025
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 5, v(out) = 2.5, v(e) = 5, v(e1_int1) = 5, v(e2) = 2, v(e2_int1) = 2, i(be2) = 0, i(be1) = 0, i(e2) = -0.002, i(e1) = -0.005, i(v1) = -0.0025
```

PlainSpice's checks: no trap.

### unknown-word-56. A capacitor's i, an inductor's flux and a resistor's sens_dc after the value: values the part can only report, so ngspice 47 stops with "no such parameter on this device or parameter is missing" (ngspice 42: "no such parameter on this device")

Added after the round-1 critic of the last pass's fixes (13 November 2026, C7), as the record of the runs unknown-word-6 noted in a paragraph. A capacitor reports its current (`i`), an inductor its flux, a resistor its sensitivities (`sens_dc` and the like, which ngspice first looks up as a model on a resistor's line, as unknown-word-6's `i`), and a line cannot set them. Each version stops with its own words, which the check says, citing this record; until the last pass it put ngspice 47's words to plain "ngspice" (F10).

```spice
* the current of a capacitor, written after its value
V1 in 0 1
R9 in out 1k
C1 out 0 1u i
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      c1 out 0 1u i
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      c1 out 0 1u i
    no such parameter on this device
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same lines as ngspice 47 -b -r
    vectors: (none)
```

```spice
* the flux of an inductor, written after its value
V1 in 0 1
R9 in out 1k
L1 out 0 1m flux
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      l1 out 0 1m flux
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      l1 out 0 1m flux
    no such parameter on this device
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same lines as ngspice 47 -b -r
    vectors: (none)
```

```spice
* the dc sensitivity of a resistor, written after its value
V1 in 0 1
R9 in out 1k
R1 out 0 1k sens_dc
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'sens_dc' from line
        r1 out 0 1k sens_dc
    Error on line 4 or its substitute:
      r1 out 0 1k sens_dc
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'sens_dc' from line
        r1 out 0 1k sens_dc
    Error on line 4 or its substitute:
      r1 out 0 1k sens_dc
    no such parameter on this device
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same lines as ngspice 47 -b -r
    vectors: (none)
```

PlainSpice's checks: `unknown-word`; `unknown-word`; `unknown-word`.

### unknown-word-57. A voltage source's i, and a current source's v after its AC value: values the source can only report, the same two messages; a current source reports no i, so `1 i` gives "unknown parameter (i)"

Added after the round-1 critic of the last pass's fixes (13 November 2026, C4, C5 and C7). The check's why says what the source can report: "(such as its current or its power)" for a voltage source, and "(such as its voltage or its power)" for a current source, whose current is what its line sets (C5). Explain gives these words the same meaning, "a value ngspice can report for this part, not one a line can set: ngspice stops ("no such parameter on this device")", where it said "unknown parameter" until then (C4): both read the source's table in `src/spice/parse.ts`. A current source has no `i` to report: `1 i` gives "unknown parameter (i)" in both versions, as the check and Explain say.

```spice
* the current of a voltage source, written after its value
V1 a 0 5 i
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 5 i
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 5 i
    no such parameter on this device
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same lines as ngspice 47 -b -r
    vectors: (none)
```

```spice
* the voltage of a current source, written after its AC value
I1 0 a 1 ac 1 v
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a 1 ac 1 v
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a 1 ac 1 v
    no such parameter on this device
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same lines as ngspice 47 -b -r
    vectors: (none)
```

```spice
* a current source reports no i
I1 0 a 1 i
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a 1 i
      unknown parameter (i)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      i1 0 a 1 i
      unknown parameter (i)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines up to "Simulation interrupted due to error!", then:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same lines as ngspice 47 -b -r
    vectors: (none)
```

PlainSpice's checks: `unknown-word`; `unknown-word`; `unknown-word`.

## unknown-dot-command

A line starting with a dot that is not a dot command ngspice 47 knows (the list is `isKnownDotCommand` in `src/spice/explain.ts`, A29). Error: ngspice stops before anything runs. When it looks like a slip in a common command (a letter more, less, swapped or changed), the fix offers that command, and the no-analysis trap stays quiet for a misspelt analysis. Fix: the command it looks like, or make the line a comment.

What PlainSpice shows for unknown-dot-command-1 (error, line 4):

> **ngspice does not know .tarn.** A line starting with a dot is a dot command for SPICE, and .tarn is not one ngspice knows. Did you mean .tran? To keep the line as a note, start it with * instead.
>
> *ngspice:* ngspice stops before running anything, with 'unimplemented dot command' for .tarn. [unknown-dot-command-1]
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
    rawfile: v(a) = 1, i(v1) = -0.001 (the .op), then a Time Domain Periodic Steady State Analysis plot with 0 points, its header only
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
a to z (or A to Z), the micro sign aside (ngspice reads it as u: a node written aµ in one place and au
in another is one node, non-ascii-node-5): ngspice writes each byte of such a letter as `_` (W16 in
numbers-and-syntax.md), so its printout and results call `giriş` `giri__`. Warning, with a fix to the
nearest plain letters (`giris`; the letters that have no plain form are left out, and a name another
node has gets a number). Two names ngspice spells the same are one node for it (W17): error, because
ngspice then simulates a different circuit from the one written, with a fix that gives each its plain
letters; but two that differ only in capital letters (`Çıkış` and `çıkış`) are the one node the netlist
means: a warning, whose fix gives them one plain name (non-ascii-node-27), unless a part has an end on each,
which ngspice then joins: that stays the error (non-ascii-node-28). The fixes rename the node wherever ngspice reads its name, and on the drawing's `*@ label` line, and
never give a name another node has (that would join two nodes), nor one of ground's (0 and gnd, which
would join the node to ground), nor a name that reads as ground (ground, earth, 00 …), which the
ground-misnamed check would flag: `gñd` becomes `gnd2`, not `gnd` (non-ascii-node-6); they also rename
the node on the commands for ngspice (a .control block, `*#` and `##` lines), inside `v(...)` and after
`save`, and on .print and .plot lines inside `v(...)` and bare. After the last pass (13 November 2026, code
review C3-1) they also rename it in the formulas that read it (`v(...)` on a B line, on an E or G line
given by `VALUE=`, `vol=`, `cur=` or `TABLE`, and in an R, C or L value written as a formula:
non-ascii-node-15, -16), on the four nodes of a `.pz` line (-19), and on the lines after a plain `.end`,
which ngspice reads as part of the circuit (S25; non-ascii-node-17, -18); any other word on a line
ngspice reads that is the name is renamed too, so the old name is left nowhere ngspice reads it. Before,
they renamed only the part lines and the dot commands' `v(...)`: a formula then read a node with nothing on
it, and ngspice stopped with no check left, or a part after `.end` was cut off and the numbers changed
silently. The same holds for the invisible-character, space-character, nbsp and look-alike-letter fixes
(invisible-character-67, space-character-24, look-alike-letter-18). After the round-1 critic of those fixes
(13 November 2026, CR1-1, CR1-3): a name that a formula, a dot command, a .print line or a command for
ngspice only reads, or that a part after `.end` names, is the node parts connect to that ngspice spells the
same, so `v(Çıkış)` reads the node `çıkış` (both are `____k____`): no second node for the check that finds
names ngspice makes one, and the rename changes it with the node (non-ascii-node-20 to -22); the words of a
title and of `echo` are text, never renamed. The rename also reaches a name bare on `.save` (-23), the names
on `.global` and the lines inside a subcircuit that name such a node (-24), and the `v(...)` of a `.func`'s
formula (-25). After the round-2 critic of those fixes (13 November 2026, CR2-2, CR2-3): names that differ only in
capital letters on part lines are one node for the dangling-node and floating-dc checks too, and the rename
of either, the checks' and the drawing editor's, changes all of them, so "Rename" and "Move .end to the
bottom" give the same circuit in either order (non-ascii-node-27); a name only a formula reads, when no part
is on a node ngspice spells that way, is a node nothing connects to: an error, as ngspice warns "singular
matrix" and gives no results, and no rename is offered unless a node the parts are on has its plain letters
(non-ascii-node-26). What ngspice does is said only as far
as it holds in every run, with a sentence more when a .print or .plot line (non-ascii-node-3) or a
command for ngspice (non-ascii-node-4) names the node; that a save there leaves PlainSpice's run no
results is said only when it leaves ngspice nothing else to save (non-ascii-node-7 to -9), that ngspice
-b runs no analysis only when nothing else can be printed or saved (non-ascii-node-13), and ngspice's
warning is quoted only when ngspice gives it (non-ascii-node-14); for names ngspice makes one node, one
sentence of each kind lists the names. A name with an invisible character or a no-break space is
left to those checks (invisible-character, nbsp). PlainSpice matches ngspice's results back to the
netlist's names (`src/spice/describe.ts`), so the drawing, the Numbers panel and the announcement say
`giriş`.

What PlainSpice shows for non-ascii-node-1 (warning, line 2):

> **ngspice spells the node giriş as giri__.** ngspice writes each letter other than a to z (or A to Z) in a node name as underscores (ş as __), so its printout and results call this node giri__, and two names can become one node. A name in plain letters avoids both.
>
> *ngspice:* ngspice spells the node giri__ in its printout and results, without a message. [non-ascii-node-1]
>
> *Fixes:* "Rename node giriş to giris"

What PlainSpice shows for non-ascii-node-2 (error, line 3):

> **Node ş and node ç are one node for ngspice.** ngspice writes each letter other than a to z (or A to Z) in a node name as underscores, so node ş and node ç both become __: one node. It simulates a different circuit from the one written here. Give each node a name in plain letters.
>
> *ngspice:* ngspice spells node ş and node ç as __ and makes them one node, without a message: in one test this put both ends of a resistor on that node, so it carried no current. [non-ascii-node-2]
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

### non-ascii-node-3. A .print or .plot line keeps the letters as written: ngspice -b finds no node çıkış there

Added after the re-check of the merged build, 12 November 2026 (S10). ngspice leaves .print and .plot
lines out of the step that writes the letters outside ASCII as `_` (`inp_casefix`, skipped for them in
its `src/frontend/inp.c`; the micro sign is still read as u, earlier, and capital letters become small),
so there `çıkış` is not `____k____`, the node it built: run as `ngspice -b`, it warns "can't parse
'çıkış'" and prints nothing for that line, not even for a name it finds on the same line (`.print dc
v(çıkış) i(V1)` prints no table at all); a .print line of its own for v(in) still prints its table. When
nothing else can be printed or saved, it runs no analysis (exit 1): here, every word of every .print and
.plot line is a name it can't parse, the analyses are .dc, .tran or .ac, and nothing else saves anything.
With anything else, an .op or a .tf, a name it finds, a .save line, savecurrents, a .meas or .four line,
it runs (non-ascii-node-13), so the check says "it runs no analysis" only in the first case (the second
critic of the names lane, 1, found the earlier "when that line was all it had to print it runs no
analysis" said beside an .op and a .tf that ran). The name may stand bare, as ngspice reads a word
without brackets on these lines (`.print dc çıkış` prints v(çıkış) for it), and draws the same warning
(second critic, 3). With a results file (`-b -r`, as PlainSpice runs it), ngspice reads .print and .plot
lines and leaves them out (".print line ignored since rawfile was produced."), and the run is not
affected. So the check says "without a message" only when no such line names the node, and says this
when one does, for a line whose analysis the netlist runs (ngspice saves a `.print tran` line's names
only for a .tran, and warns about them only then), with ngspice's warning as ngspice spells the name
there: `µş` as `uş`, `çAk` as `çak` (names lane critic, 3, which also found "prints nothing for it" and
"skips those lines" short of what happens). It quotes the warning only when ngspice gives it: a save of
the name in a command for ngspice takes it away (non-ascii-node-14). The one-click rename writes the
plain name on that line too, inside `v(...)` and bare; the fixed netlist runs under `ngspice -b` and
prints its table (exit 0, native 47 and 42). With ngspice's own spelling, `.print dc v(____k____)`, the
table prints; a name with only the micro sign, `.print dc v(aµ)`, prints as `v(au)`.

What PlainSpice shows for non-ascii-node-3 (warning, line 3):

> **ngspice spells the node çıkış as ____k____.** ngspice writes each letter other than a to z (or A to Z) in a node name as underscores (ç as __), so its printout and results call this node ____k____, and two names can become one node. A name in plain letters avoids both.
>
> *ngspice:* ngspice spells the node ____k____ in its printout and results. On a .print or .plot line it reads the name as written, so it finds no node çıkış there: run as ngspice -b, it warns "can't parse 'çıkış'" and prints nothing for that line; with nothing else it can print or save, it runs no analysis ("no data saved"). PlainSpice's run leaves .print and .plot lines out (ngspice: ".print line ignored since rawfile was produced."). [non-ascii-node-1, non-ascii-node-3]
>
> *Fixes:* "Rename node çıkış to cikis"

```spice
* a .print line naming a node with Turkish letters
V1 in 0 12
R1 in çıkış 1k
R2 çıkış 0 2k
.dc V1 0 12 6
.print dc v(çıkış)
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Warning: can't parse 'çıkış': ignored
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Error: .print: no dc analysis found.
  ngspice -b -r out.raw (exit 0), which prints instead:
    .print line ignored since rawfile was produced.
    rawfile: v(v-sweep) = 0, 6, 12, v(in) = 0, 6, 12, v(____k____) = 0, 4, 8, i(v1) = 0, -0.002, -0.004
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    .print line ignored since rawfile was produced.
    vectors: v(v-sweep) = 0, 6, 12, v(in) = 0, 6, 12, v(____k____) = 0, 4, 8, i(v1) = 0, -0.002, -0.004
```

The same in other forms, native 47 and 42 alike, `ngspice -b`:

```text
.plot dc v(çıkış) (exit 1):
    Warning: can't parse 'çıkış': ignored
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    ...
    Error: .plot: no dc analysis found.
  ngspice -b -r: .plot line ignored since rawfile was produced. (exit 0)
.print tran v(çıkış), with .tran 10u 20u (exit 1):
    Warning: can't parse 'çıkış': ignored
    Error: no data saved for Transient analysis; analysis not run
    ...
    Error: .print: no tran analysis found.
.print dc v(çıkış) i(V1) (exit 0, and no table at all):
    Warning: can't parse 'çıkış': ignored
    Warning from checkvalid: vector çıkış is not available or has zero length.
.print op v(çıkış), with .op (exit 0; the operating point's own printout still lists ____k____ = 8):
    Warning: can't parse 'çıkış': ignored
    Warning from checkvalid: vector çıkış is not available or has zero length.
.print dc v(in) and .print dc v(çıkış), two lines (exit 0; the v(in) line prints its table):
    Warning: can't parse 'çıkış': ignored
    Warning from checkvalid: vector çıkış is not available or has zero length.
    Index   v-sweep         v(in)
    0       0.000000e+00    0.000000e+00
    1       6.000000e+00    6.000000e+00
    2       1.200000e+01    1.200000e+01
.print dc V(µş), for a node written µş (exit 1):
    Warning: can't parse 'uş': ignored
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    ...
.print dc V(çAk), for a node written çAk (exit 1):
    Warning: can't parse 'çak': ignored
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    ...
.print dc çıkış, the name bare (exit 1):
    Warning: can't parse 'çıkış': ignored
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    ...
  after the rename, .print dc cikis (exit 0): the table prints, Index v-sweep cikis, 0 4 8 for cikis
.plot dc çıkış, bare on a .plot line (exit 1): the same warning, no data saved, ".plot: no dc analysis found."
.print dc çıkış in, and .print dc v(in) çıkış (exit 0, no table): the same warning, and
    Warning from checkvalid: vector çıkış is not available or has zero length.
.print ac vdb(çıkış), with .ac dec 1 1k 10k (exit 1):
    Warning: can't parse 'çıkış': ignored
    Error: no data saved for A.C. Small signal analysis; analysis not run
.plot ac xlog vdb(çıkış), with .ac (exit 1): the same; ngspice drops xlog from the words to save
.print dc v(çıkış) v(ş), for two nodes with such letters (exit 1):
    Warning: can't parse 'çıkış': ignored
    Warning: can't parse 'ş': ignored
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
  the same with the two on two .print lines, or v(ş) on a + line after .print dc v(çıkış) (exit 1)
.print dc v(çıkış) ; v(in), a comment after it (exit 1): the same as .print dc v(çıkış)
.print dc v(çıkış), with .dc V1 0 12 6 and .tran 1u 2u (exit 1): neither runs:
    Warning: can't parse 'çıkış': ignored
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    Error: no data saved for Transient analysis; analysis not run
.print tran v(çıkış), with only .dc (exit 1): no warning; the .dc saves nothing:
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    ...
    Error: .print: no tran analysis found.
  the same for .print op v(çıkış) with only .dc ("no op analysis found")
.print v(çıkış), with no analysis named (exit 1): ngspice takes v(çıkış) for the analysis:
    Warning: no nodes given: .print v(çıkış)
.print dc v (çıkış), a space before the bracket (exit 1): Warning: can't parse 'v': ignored
.print dc (çıkış) (exit 1): Warning: no nodes given: .print dc (çıkış)
  ngspice -b -r, each of them: .print line ignored since rawfile was produced. (exit 0)
```

The check says no sentence for a line whose analysis the netlist does not run, nor for the last three
forms, where ngspice reads no node çıkış.

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-4. A command for ngspice keeps the letters as written too: a save that names only such a node leaves nothing to save, and PlainSpice's run gives no results

Added after the re-check of the merged build, 12 November 2026 (S10); narrowed after the critic of the
names lane (1), which found the analysis running whenever something else was saved. The lines of a
`.control` block (and `*#` and `##` lines) are commands for ngspice, and it reads them as written:
`print v(çıkış)` finds no vector çıkış, although the run just made `____k____`, and `save v(çıkış)`, or
`save çıkış`, saves nothing. When nothing else is saved, ngspice has nothing to save and the analysis
does not run ("no data saved … analysis not run"). PlainSpice runs the netlist with a results file, and
then ngspice runs the analyses once more at the end, with every save of the block, so its run gives no
results even when the save comes after a `run` (which works under plain `ngspice -b`); our engine gives
no results. Anything else to save keeps the run going (non-ascii-node-7 to -9), so the check says this
only when every save names nothing ngspice finds, and only for .dc, .tran and .ac, whose results are node
voltages: a .tf saves no node voltage at all, so there even the plain name would leave nothing to save.
The one-click rename writes the plain name inside `v(...)`, and after `save`, on these lines too; the
fixed netlist runs (exit 0, native 47 and 42, and our engine: v(cikis) = 0, 4, 8). `let`, `meas` and
`write` find no vector `çıkış` either (native 47 and 42: 'RHS "v(çıkış)" invalid', 'no such vector as
v(çıkış)', 'no writable vector found').

What PlainSpice shows for non-ascii-node-4 (warning, line 3):

> **ngspice spells the node çıkış as ____k____.** ngspice writes each letter other than a to z (or A to Z) in a node name as underscores (ç as __), so its printout and results call this node ____k____, and two names can become one node. A name in plain letters avoids both.
>
> *ngspice:* ngspice spells the node ____k____ in its printout and results. In a .control block it reads the name as written too, so it finds no node çıkış there: save v(çıkış) saves nothing, and since nothing else is saved, PlainSpice's run gives no results ("no data saved"). [non-ascii-node-1, non-ascii-node-4]
>
> *Fixes:* "Rename node çıkış to cikis"

```spice
* commands in a .control block naming a node with Turkish letters
V1 in 0 12
R1 in çıkış 1k
R2 çıkış 0 2k
.dc V1 0 12 6
.control
run
print v(çıkış)
save v(çıkış)
run
.endc
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Warning from checkvalid: vector çıkış is not available or has zero length.
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1):
    Warning from checkvalid: vector çıkış is not available or has zero length.
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    rawfile: (no rawfile data)
ngspice 42, ngspice -b (exit 1):
    Warning from checkvalid: vector çıkış is not available or has zero length.
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

A `*# save v(çıkış)` line in place of the .control block does the same (native 47 and 42, `-b -r`,
exit 1: "Error: no data saved for D.C. Transfer curve analysis; analysis not run"). So do these, in a
.control block with a `run` after the save, native 47 and 42 alike, and our engine (no results):

```text
save çıkış, without v(...) (ngspice -b -r, exit 1):
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
SAVE V(çıkış), in capitals (exit 1): the same
run first, then save v(çıkış) (exit 1; under ngspice -b the run before the save works, exit 0):
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
with .tran 1u 2u in place of .dc (exit 1):
    Error: no data saved for Transient analysis; analysis not run
with .ac dec 1 1k 10k in place of .dc (exit 1):
    Error: no data saved for A.C. Small signal analysis; analysis not run
with .tf v(in) V1 in place of .dc (exit 1):
    Error: no data saved for transfer function analysis; analysis not run
after the rename (save cikis, SAVE V(cikis), run then save v(cikis), .tran, .ac): exit 0, v(cikis) saved;
  with .tf, exit 1 still: no data saved for transfer function analysis
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-5. aµ and au are one node: ngspice reads the micro sign as u

Added after the re-check of the merged build, 12 November 2026 (words re-check 8). ngspice reads the
micro sign µ as u on every line (W15), so `aµ` and `au` are one node, `au`: R1, with an end on each,
has both ends on it and carries no current, and all 6 mA of V1 flow through R2. PlainSpice's parser
reads µ as u too, so its drawing shows R1 with both ends on one node, as ngspice simulates it: unlike
ş and ç (non-ascii-node-2), the numbers are answers for the circuit drawn, so this is a warning, not an
error. Its fix gives the µ spelling a plain name of its own, as the netlist reads to a person; the fixed
netlist is a divider (native 47 and 42, and our engine: v(au2) = 12, v(au) = 8, i(@r1[i]) = 0.004).
Only the spellings on part lines count. When no part has an end on each, the two spellings are one node
written two ways (`V1 aµ 0 12` with `R1 au 0 2k`: v(au) = 12, i(v1) = -0.006, native 47 and 42): a note,
whose fix writes the node one way ("Write au for aµ"). "Carries no current" is said only for a resistor,
a capacitor or a diode with an end on each (non-ascii-node-10); for any other part the check says which
of its ends are joined (non-ascii-node-11).

What PlainSpice shows for non-ascii-node-5 (warning, line 3):

> **Node aµ and node au are one node for ngspice.** ngspice reads the micro sign µ as u, so node aµ and node au are the same node: R1 has both ends on it and carries no current. Give node aµ a name of its own in plain letters.
>
> *ngspice:* ngspice reads µ as u and makes node aµ and node au one node, au, without a message: in one test a resistor with an end on each carried no current. [non-ascii-node-5]
>
> *Fixes:* "Rename node aµ to au2"

```spice
* aµ and au are one node
V1 aµ 0 12
R1 aµ au 1k
R2 au 0 2k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        au                               1.200000e+01
        @r2[i]                           6.000000e-03
        @r1[i]                           0.000000e+00
        v1#branch                        -6.00000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(au) = 12, i(v1) = -0.006, i(@r1[i]) = 0, i(@r2[i]) = 0.006
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(au) = 12, i(v1) = -0.006, i(@r1[i]) = 0, i(@r2[i]) = 0.006
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-6. gñd is the node g__d, not ground: the fix never names it gnd

Added after the re-check of the merged build, 12 November 2026 (code-3). The plain letters of `gñd`
are `gnd`, ground's other name (W8): a fix that renamed it gnd would join it to ground and change the
circuit, so the fixes skip ground's names and the names that read as ground. In this run g__d and
gnd2 are ordinary nodes at 2.5 V, with 2.5 mA through each of their resistors, while R6, between gnd
and ground, carries nothing: gnd is ground. Here the fix gives `gnd3`, because `gnd2` is taken.

```spice
* gñd is not ground, and neither is gnd2: gnd is
V1 a 0 5
R1 a gñd 1k
R2 gñd 0 1k
R3 a gnd2 1k
R4 gnd2 0 1k
R5 a gnd 1k
R6 gnd 0 1k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        gnd2                             2.500000e+00
        g__d                             2.500000e+00
        a                                5.000000e+00
        @r6[i]                           0.000000e+00
        @r5[i]                           5.000000e-03
        @r4[i]                           2.500000e-03
        @r3[i]                           2.500000e-03
        @r2[i]                           2.500000e-03
        @r1[i]                           2.500000e-03
        v1#branch                        -1.00000e-02
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 5, v(g__d) = 2.5, v(gnd2) = 2.5, i(v1) = -0.009999999999999998, i(@r1[i]) = 0.0025, i(@r2[i]) = 0.0025, i(@r3[i]) = 0.0025, i(@r4[i]) = 0.0025, i(@r5[i]) = 0.005, i(@r6[i]) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 5, v(g__d) = 2.5, v(gnd2) = 2.5, i(v1) = -0.009999999999999998, i(@r1[i]) = 0.0025, i(@r2[i]) = 0.0025, i(@r3[i]) = 0.0025, i(@r4[i]) = 0.0025, i(@r5[i]) = 0.005, i(@r6[i]) = 0
after the fix ("Rename gñd to gnd3"), ngspice 47, 42 and our engine, -b -r (exit 0):
    v(gnd3) = 2.5, as g__d was, and every current as before
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-7. A save that also names something ngspice finds: that is saved, and the analysis runs

Added after the critic of the names lane, 12 November 2026 (1). `save v(çıkış) i(v1)` saves i(v1): the
analysis runs and gives it, with the sweep, though `v(çıkış)` saves nothing. So the check says only that
ngspice finds no node çıkış there, never that the run gives no results. The same holds for any other
name ngspice finds on a save (below), and, as the second critic of the names lane found (4), when
`savecurrents` stands on a continuation line of `.options`, when a `reset` follows the save (ngspice
loads the circuit again and saves every vector), and when the save sits inside an `if` that does not
run it. The check claims no results after any command that loads, resets or switches the circuit
(`reset`, `source`, `remcirc`, `setcirc` …), takes saves back (`delete`) or decides which commands run
(`if`, `while`, `goto` …).

What PlainSpice shows for non-ascii-node-7 (warning, line 3):

> **ngspice spells the node çıkış as ____k____.** ngspice writes each letter other than a to z (or A to Z) in a node name as underscores (ç as __), so its printout and results call this node ____k____, and two names can become one node. A name in plain letters avoids both.
>
> *ngspice:* ngspice spells the node ____k____ in its printout and results. In a .control block it reads the name as written too, so it finds no node çıkış there. [non-ascii-node-1, non-ascii-node-4]
>
> *Fixes:* "Rename node çıkış to cikis"

```spice
* a save that names a current too: the analysis runs
V1 in 0 12
R1 in çıkış 1k
R2 çıkış 0 2k
.dc V1 0 12 6
.control
save v(çıkış) i(v1)
run
.endc
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Note: Simulation executed from .control section
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep) = 0, 6, 12, i(v1) = 0, -0.002, -0.004
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(v-sweep) = 0, 6, 12, i(v1) = 0, -0.002, -0.004
```

The same with another name in place of `i(v1)`, native 47 and 42 alike, `ngspice -b -r`, exit 0:

```text
save v(çıkış) in, a bare node name: rawfile: v(v-sweep) = 0, 6, 12, v(in) = 0, 6, 12
save v(çıkış) @r1[i]: rawfile: v(v-sweep) = 0, 6, 12, i(@r1[i]) = 0, 0.002, 0.004
*# save v(çıkış) i(v1), in place of the .control block: rawfile: v(v-sweep) = 0, 6, 12, i(v1) = 0, -0.002, -0.004
.save v(in), with save v(çıkış) in the block: rawfile: v(v-sweep) = 0, 6, 12, v(in) = 0, 6, 12
.options savecurrents, with save v(çıkış) in the block: rawfile: v(v-sweep) = 0, 6, 12, i(@r1[i]) = 0, 0.002, 0.004, i(@r2[i]) = 0, 0.002, 0.004
save v(çıkış), then delete all: rawfile: v(v-sweep) = 0, 6, 12, v(in) = 0, 6, 12, v(____k____) = 0, 4, 8, i(v1) = 0, -0.002, -0.004
.options reltol=1e-3, then + savecurrents on its continuation line: rawfile: v(v-sweep) = 0, 6, 12, i(@r1[i]) = 0, 0.002, 0.004, i(@r2[i]) = 0, 0.002, 0.004
save v(çıkış), then reset ("Reset re-loads circuit * t"): rawfile: v(v-sweep) = 0, 6, 12, v(in) = 0, 6, 12, v(____k____) = 0, 4, 8, i(v1) = 0, -0.002, -0.004
if 0 / save v(çıkış) / end, then run: rawfile: v(v-sweep) = 0, 6, 12, v(in) = 0, 6, 12, v(____k____) = 0, 4, 8, i(v1) = 0, -0.002, -0.004
our engine, as ngspice -b -r: the same vectors for each
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-8. With save all the node is saved anyway, as ____k____

Added after the critic of the names lane, 12 November 2026 (1). `save all` (or `save allv`) saves every
node, so the node is in the results under ngspice's own spelling, and the analysis runs; `save v(çıkış)`
after it changes nothing. The check's words are non-ascii-node-7's.

```spice
* save all before the save: the node is saved anyway
V1 in 0 12
R1 in çıkış 1k
R2 çıkış 0 2k
.dc V1 0 12 6
.control
save all
save v(çıkış)
run
.endc
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Note: Simulation executed from .control section
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep) = 0, 6, 12, v(in) = 0, 6, 12, v(____k____) = 0, 4, 8, i(v1) = 0, -0.002, -0.004
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(v-sweep) = 0, 6, 12, v(in) = 0, 6, 12, v(____k____) = 0, 4, 8, i(v1) = 0, -0.002, -0.004
save v(çıkış) allv, native 47 and 42 and our engine, -b -r (exit 0): the same vectors
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-9. With .op, PlainSpice's run saves every part's current too, so the save leaves the run going

Added after the critic of the names lane, 12 November 2026 (1). For an operating point PlainSpice adds
`.options savecurrents` to the copy it runs (`src/spice/run-netlist.ts`, A2 in explanations.md), and
ngspice then saves the current of every resistor, capacitor, inductor, diode … with `.save @r1[i]`
lines of its own. With a save in a .control block it adds no `.save all`, so only those currents are
saved: the operating point runs and gives them, without the node voltages. Written without
savecurrents, as ngspice runs the file itself, the same netlist stops ("no data saved for D.C.
Operating point analysis", `-b -r`, exit 1, native 47 and 42). The check's words are
non-ascii-node-7's.

```spice
* .op as PlainSpice runs it, with .options savecurrents
V1 in 0 12
R1 in çıkış 1k
R2 çıkış 0 2k
.op
.control
save v(çıkış)
run
.endc
.options savecurrents
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        ____k____                        8.000000e+00
        in                               1.200000e+01
        @r2[i]                           4.000000e-03
        @r1[i]                           4.000000e-03
        v1#branch                        -4.00000e-03
  ngspice -b -r out.raw (exit 0)
    OP information in rawfile.
    rawfile: i(@r1[i]) = 0.004, i(@r2[i]) = 0.004
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: i(@r1[i]) = 0.004, i(@r2[i]) = 0.004
without .options savecurrents, ngspice -b -r (exit 1), native 47 and 42 and our engine:
    Error: no data saved for D.C. Operating point analysis; analysis not run
  and PlainSpice, which adds the line before .end: vectors i(@r1[i]) = 0.004, i(@r2[i]) = 0.004
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-10. A capacitor or a diode with an end on aµ and one on au carries no current either

Added after the critic of the names lane, 12 November 2026 (2). As for the resistor of non-ascii-node-5,
both ends of C1 and of D1 are on the one node au, so neither has a voltage across it, and neither
carries a current at any point of the run, while R1 and R2 carry the source's. So the check says "has
both ends on it and carries no current" for a resistor, a capacitor or a diode with an end on each
spelling, and for no other part (non-ascii-node-11), nor for a capacitor given a starting voltage
(non-ascii-node-12).

What PlainSpice shows for non-ascii-node-10 (warning, line 4):

> **Node aµ and node au are one node for ngspice.** ngspice reads the micro sign µ as u, so node aµ and node au are the same node: C1 and D1 have both ends on it and carry no current. Give node aµ a name of its own in plain letters.
>
> *ngspice:* ngspice reads µ as u and makes node aµ and node au one node, au, without a message: in tests a resistor, a capacitor and a diode with an end on each carried no current. [non-ascii-node-5, non-ascii-node-10]
>
> *Fixes:* "Rename node aµ to au2"

```spice
* a capacitor and a diode with an end on aµ and one on au
V1 in 0 PULSE(0 12 0 10u 10u 1 2)
R1 in aµ 1k
C1 aµ au 1u
D1 aµ au dd
R2 au 0 2k
.model dd D
.options savecurrents
.tran 10u 50u
.end
```

```text
ngspice 47, ngspice -b (exit 1), as for any .tran with no .print line:
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0), 62 points:
    i(@c1[i]) = 0 and i(@d1[id]) = 0 at every point
    last point: v(in) = 12, v(au) = 8, i(v1) = -0.004, i(@r1[i]) = 0.004, i(@r2[i]) = 0.004
ngspice 42, ngspice -b (exit 1): Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0): 62 points on a slightly different time grid, the same last point,
    i(@c1[i]) = 0 and i(@d1[id]) = 0 at every point
our engine (wasm), as ngspice -b -r (exit 0): the same as ngspice 47, 62 points, i(@c1[i]) and
  i(@d1[id]) 0 at every point
D1 alone, in .op (D1 aµ au dd between R1 and R2), native 47 and 42 and our engine, -b -r (exit 0):
    rawfile: v(in) = 12, v(au) = 8, i(v1) = -0.004, i(@r1[i]) = 0.004, i(@d1[id]) = 0, i(@r2[i]) = 0.004
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-11. Another part with ends on aµ and au still works: a current source carries its current

Added after the critic of the names lane, 12 November 2026 (2), which found "E1 has both ends on it and
carries no current" next to E1 delivering 666.7 µA. Ends of any part on aµ and au are joined, but what
that does depends on the part: I1 here still drives its 1 mA, from the node back into the node; a
dependent source and a transistor still work; a voltage source with both ends there stops ngspice, and an
inductor makes the matrix singular (the voltage-loop check says so for those two: voltage-loop-8 to -11).
So for any part other than a resistor, a capacitor or a diode, the check says only which ends are joined
("which joins both ends of I1", "two ends of E1") and that ngspice makes the two spellings one node.

What PlainSpice shows for non-ascii-node-11 (warning, line 4):

> **Node aµ and node au are one node for ngspice.** ngspice reads the micro sign µ as u, so node aµ and node au are the same node, which joins both ends of I1. Give node aµ a name of its own in plain letters.
>
> *ngspice:* ngspice reads µ as u and makes node aµ and node au one node, au. [non-ascii-node-5, non-ascii-node-11]
>
> *Fixes:* "Rename node aµ to au2"

```spice
* a current source with an end on aµ and one on au
V1 in 0 12
R1 in aµ 1k
I1 aµ au 1m
R2 au 0 2k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        au                               8.000000e+00
        in                               1.200000e+01
        @r2[i]                           4.000000e-03
        @i1[current]                     1.000000e-03
        @r1[i]                           4.000000e-03
        v1#branch                        -4.00000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 12, v(au) = 8, i(v1) = -0.004, i(@r1[i]) = 0.004, i(@i1[current]) = 0.001, i(@r2[i]) = 0.004
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 12, v(au) = 8, i(v1) = -0.004, i(@r1[i]) = 0.004, i(@i1[current]) = 0.001, i(@r2[i]) = 0.004
```

Other parts in place of I1, native 47 and 42 alike and our engine, `ngspice -b -r`, each with `.options
savecurrents` and `.op`:

```text
E1 aµ 0 in au 2, with V1 in 0 1 and R1 au 0 1k (exit 0): E1 still works
    rawfile: v(in) = 1, v(au) = 0.6666666666666666, i(e1) = -0.0006666666666666666, i(v1) = 0, i(@r1[i]) = 0.0006666666666666666
G1 aµ au in 0 1m, with V1 in 0 1, R0 in 0 1k, R1 aµ 0 1k, R2 au 0 1k (exit 0): G1 drives its 1 mA
    rawfile: v(in) = 1, v(au) = 0, i(v1) = -0.001, i(@r0[i]) = 0.001, i(@g1[i]) = 0.001, i(@r1[i]) = 0, i(@r2[i]) = 0
Q1 aµ au 0 qn, collector on aµ and base on au, V1 in 0 5, R1 in aµ 1k, R2 au 0 1meg, .model qn npn (exit 0)
    rawfile: v(in) = 5, v(au) = 0.8110227811525323, i(v1) = -0.004188977218847468, i(@r1[i]) = 0.004188977218847468,
      i(@q1[ic]) = 0.004147427496806713, i(@q1[ie]) = -0.004188901773396827, i(@q1[ib]) = 4.147427577908991e-05, ...
V2 aµ au 5, in place of I1, without savecurrents (exit 1, no results):
    Fatal error: instance v2 is a shorted VSRC
    doAnalyses: operation not supported
    run simulation(s) aborted
L1 aµ au 1m, in place of I1 (exit 0, with warnings):
    Warning: singular matrix:  check node l1#branch
    ...
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
    rawfile: v(in) = 11.999999999987999, v(au) = 7.999999994658666, i(l1) = 0, i(v1) = -0.004000000005325332,
      i(@r1[i]) = 0.0040000000053293325, i(@l1[i]) = 0, i(@r2[i]) = 0.0039999999973293334
```

PlainSpice's checks: `non-ascii-node` (and for V2 and L1 `voltage-loop` too).

### non-ascii-node-12. A capacitor given a starting voltage, with an end on aµ and one on au, carries current at the first point

Added after the second critic of the names lane, 12 November 2026 (5), which found "C1 has both ends on
it and carries no current" for this netlist. With `ic=5` and `.tran … uic`, ngspice starts C1 at 5 V
although both its ends are on the one node au, and C1 discharges in the first step: −5000 A at the first
point (t = 1 ns), then 0, while R1 and R2 carry the source's 4 mA throughout. Without uic, or with an
`.ic` line in place of `ic=`, it stays at 0, and a diode given `ic=0.7` stays at 0 too (below). So the
check says "carries no current" for no capacitor with an `ic=` value: it says which ends are joined, as
for the parts of non-ascii-node-11, and cites this fact.

What PlainSpice shows for non-ascii-node-12 (warning, line 4):

> **Node aµ and node au are one node for ngspice.** ngspice reads the micro sign µ as u, so node aµ and node au are the same node, which joins both ends of C1. Give node aµ a name of its own in plain letters.
>
> *ngspice:* ngspice reads µ as u and makes node aµ and node au one node, au. [non-ascii-node-5, non-ascii-node-12]
>
> *Fixes:* "Rename node aµ to au2"

```spice
* a capacitor given a starting voltage, with an end on aµ and one on au
V1 in 0 12
R1 in aµ 1k
C1 aµ au 1u ic=5
R2 au 0 2k
.options savecurrents
.tran 1u 10u uic
.end
```

```text
ngspice 47, ngspice -b (exit 1), as for any .tran with no .print line:
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0), 76 points:
    Operating point simulation skipped by 'uic',
      now using transient initial conditions.
    first point: time = 1e-09, v(in) = 12, v(au) = 8, i(v1) = -0.004, i(@r1[i]) = 0.004, i(@c1[i]) = -4999.999999999999, i(@r2[i]) = 0.004
    i(@c1[i]) = 0 at every later point
    last point: time = 9.999999999999999e-06, v(in) = 12, v(au) = 8, i(v1) = -0.004, i(@r1[i]) = 0.004, i(@c1[i]) = 0, i(@r2[i]) = 0.004
ngspice 42, ngspice -b (exit 1): Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0): "Using transient initial conditions", and the same summary: 76 points, the same
  first and last points, i(@c1[i]) = 0 at every later point; 2 of its time points differ slightly (9.306e-7 s
  where 47 has 8.653e-7 s, 9.9e-6 s where 47 has 9.85e-6 s), with the same values
our engine (wasm), as ngspice -b -r (exit 0): the same 76 points, i(@c1[i]) = -4999.999999999999 at the
  first point and 0 at every later one, v(au) = 8 and i(@r1[i]) = 0.004 throughout
```

The same netlist in other forms, native 47 and 42 alike and our engine, `ngspice -b -r` (exit 0):

```text
.tran 1u 10u, without uic: i(@c1[i]) = 0 at every point (59 points)
C1 aµ au 1u without ic=, and .ic v(aµ)=5, with .tran 1u 10u: i(@c1[i]) = 0 at every point (59 points)
D1 aµ au dd ic=0.7 in place of C1, .model dd D, with .tran 1u 10u uic: i(@d1[id]) = 0 at every point (61 points)
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-13. With anything else to print or save, ngspice -b runs the analysis: only the line is lost

Added after the second critic of the names lane, 12 November 2026 (1). The check said "when that line
was all it had to print it runs no analysis" whenever a .print or .plot line named the node, but ngspice
-b runs the analysis whenever something can be printed or saved: here `v(in)` on the same line, which
it finds, so the sweep runs (exit 0), and only the line prints nothing, not even v(in). The same holds
with an .op or a .tf, which save everything for themselves, with a name it finds anywhere on a .print or
.plot line, with two names in one `v(...)` (the second, `in`, is found), and with a .save line, `.options
savecurrents` (on a continuation line too), a .meas or a .four line (below). So the check says "it runs
no analysis" only when every word of every .print and .plot line is a name it can't parse, every
analysis is a .dc, .tran or .ac, and nothing else saves anything; with a .control block, `*#` or `##`
lines, a .probe line or lines after .end it says nothing about the run either way.

What PlainSpice shows for non-ascii-node-13 (warning, line 3):

> **ngspice spells the node çıkış as ____k____.** ngspice writes each letter other than a to z (or A to Z) in a node name as underscores (ç as __), so its printout and results call this node ____k____, and two names can become one node. A name in plain letters avoids both.
>
> *ngspice:* ngspice spells the node ____k____ in its printout and results. On a .print or .plot line it reads the name as written, so it finds no node çıkış there: run as ngspice -b, it warns "can't parse 'çıkış'" and prints nothing for that line. PlainSpice's run leaves .print and .plot lines out (ngspice: ".print line ignored since rawfile was produced."). [non-ascii-node-1, non-ascii-node-3]
>
> *Fixes:* "Rename node çıkış to cikis"

```spice
* a .print line naming a node with Turkish letters beside one ngspice finds
V1 in 0 12
R1 in çıkış 1k
R2 çıkış 0 2k
.dc V1 0 12 6
.print dc v(in) v(çıkış)
.end
```

```text
ngspice 47, ngspice -b (exit 0), and no table at all:
    Warning: can't parse 'çıkış': ignored
    Warning from checkvalid: vector çıkış is not available or has zero length.
  ngspice -b -r out.raw (exit 0)
    .print line ignored since rawfile was produced.
    rawfile: v(v-sweep) = 0, 6, 12, v(in) = 0, 6, 12, v(____k____) = 0, 4, 8, i(v1) = 0, -0.002, -0.004
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    .print line ignored since rawfile was produced.
    vectors: v(v-sweep) = 0, 6, 12, v(in) = 0, 6, 12, v(____k____) = 0, 4, 8, i(v1) = 0, -0.002, -0.004
```

The analysis runs in these too, native 47 and 42 alike, `ngspice -b` (exit 0), each with "can't parse
'çıkış'" and nothing printed for the .print line:

```text
.op with .print op v(çıkış): the operating point's own printout still lists ____k____ = 8, in = 12
.tf v(çıkış) V1 with .print tf v(çıkış): transfer_function = 6.666667e-01 is printed
.print dc v(çıkış) i(V1); .print dc v(çıkış,in); .print dc v(in,çıkış); .print dc çıkış in
.print dc v(çıkış), with another line .print dc i(V1) (that line prints its table)
.print dc v(çıkış), with .save v(in), .save all, .options savecurrents, or .options reltol=1e-3 and + savecurrents
.print dc v(çıkış), with .meas dc m1 max v(in) (m1 = 1.20000e+01 is printed)
.print tran v(çıkış), with .tran 10u 2m and .four 1k v(in) (the Fourier table is printed)
.print dc v(çıkış), with .probe v(in)
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-14. A save of the name in a command for ngspice takes the .print line's warning away

Added after the second critic of the names lane, 12 November 2026 (1). ngspice saves a name once: the
first save of it stands, and a later one is dropped. It reads the commands for ngspice (a .control
block, `*#` and `##` lines) while it loads the file, before the .print and .plot lines, so a `save
v(çıkış)` there comes first, and it saves nothing (non-ascii-node-4). The .print line's `çıkış` is then
no save of its own, and ngspice, which warns only about a .print line's names, gives no "can't parse
'çıkış'" (exit 1, "no data saved", twice: once for the run in the block, once for the .print lines).
Likewise an earlier `.print tran v(çıkış)` takes the warning from a later `.print dc v(çıkış)` when only
the .dc runs. A .save line does not: there ngspice writes the letters as underscores, so it saves the
node ____k____, another name, and the warning stays (the analysis then runs). So the check quotes the
warning only when the first .print or .plot line naming the node is for an analysis the netlist runs,
no command for ngspice saves the name, and there are no lines after .end; otherwise it says only that
ngspice prints nothing for that line.

What PlainSpice shows for non-ascii-node-14 (warning, line 3):

> **ngspice spells the node çıkış as ____k____.** ngspice writes each letter other than a to z (or A to Z) in a node name as underscores (ç as __), so its printout and results call this node ____k____, and two names can become one node. A name in plain letters avoids both.
>
> *ngspice:* ngspice spells the node ____k____ in its printout and results. On a .print or .plot line it reads the name as written, so it finds no node çıkış there: run as ngspice -b, it prints nothing for that line. PlainSpice's run leaves .print and .plot lines out (ngspice: ".print line ignored since rawfile was produced."). In a .control block it reads the name as written too, so it finds no node çıkış there: save v(çıkış) saves nothing, and since nothing else is saved, PlainSpice's run gives no results ("no data saved"). [non-ascii-node-1, non-ascii-node-3, non-ascii-node-4]
>
> *Fixes:* "Rename node çıkış to cikis"

```spice
* a save of the name in a .control block, read before the .print line
V1 in 0 12
R1 in çıkış 1k
R2 çıkış 0 2k
.dc V1 0 12 6
.print dc v(çıkış)
.control
save v(çıkış)
run
.endc
.end
```

```text
ngspice 47, ngspice -b (exit 1), no "can't parse":
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Error: .print: no dc analysis found.
  ngspice -b -r out.raw (exit 1): the same two errors, then
    .print line ignored since rawfile was produced.
    rawfile: (no rawfile data)
ngspice 42: the same printout and exit codes as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    .print line ignored since rawfile was produced.
```

In other forms, native 47 and 42 alike, `ngspice -b`:

```text
*# save v(çıkış), then .print dc v(çıkış) (exit 1): no "can't parse"; no data saved
.print tran v(çıkış), then .print dc v(çıkış), with only .dc (exit 1): no "can't parse"; no data saved
.print dc v(çıkış), then .print tran v(çıkış), with only .dc (exit 1): Warning: can't parse 'çıkış': ignored
.save v(çıkış), or .save çıkış, then .print dc v(çıkış) (exit 0): Warning: can't parse 'çıkış': ignored,
  and the sweep runs, saving ____k____
if 0 / save v(çıkış) / end in a .control block, then .print dc v(çıkış) (exit 1): the save never runs, so
  Warning: can't parse 'çıkış': ignored (the check, which does not follow an if, does not quote it)
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-15. A node a formula reads is that node: the rename changes it in the formula too

B1's formula reads v(çıkış), the node R1 and R2 make, which ngspice spells ____k____ there too: b = 10 V. The rename writes cikis in the formula as well, and the circuit is the same (b = 10 V, cikis = 5 V). Before this, the fix wrote cikis only on R1 and R2: the formula then read a node with nothing on it, and native 47 and 42 stopped ("singular matrix: check node ____k____", "The operating point could not be simulated successfully"), with no check left (code review C3-1).

```spice
* a node a formula reads, with Turkish letters
V1 giris 0 10
R1 giris çıkış 1k
R2 çıkış 0 1k
B1 b 0 V=v(çıkış)*2
Rb b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                1.000000e+01
        ____k____                        5.000000e+00
        giris                            1.000000e+01
        v1#branch                        -5.00000e-03
        b1#branch                        -1.00000e-02
  ngspice -b -r out.raw (exit 0)
    rawfile: v(giris) = 10, v(____k____) = 5, v(b) = 10, i(b1) = -0.01, i(v1) = -0.005
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(giris) = 10, v(____k____) = 5, v(b) = 10, i(b1) = -0.01, i(v1) = -0.005
after the fix "Rename node çıkış to cikis" (non-ascii-node), which writes `R1 giris cikis 1k`, `R2 cikis 0 1k`, `B1 b 0 V=v(cikis)*2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(giris) = 10, v(cikis) = 5, v(b) = 10, i(b1) = -0.01, i(v1) = -0.005
the netlist the fix wrote before (only R1 and R2 renamed):
    ngspice 47 and 42, -b -r (exit 1): (no rawfile data)
      Warning: singular matrix:  check node ____k____
      Warning: Dynamic gmin stepping failed
      Warning: True gmin stepping failed
      Warning: source stepping failed
      Error: Transient op failed, timestep too small
      Error: The operating point could not be simulated successfully.
    our engine (exit 1, no results): (none)
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-16. The same in the other formulas: I=, v(a,b), E with VALUE=, and a resistor written as a formula

```spice
* formulas that read a node with Turkish letters
V1 giris 0 10
R1 giris çıkış 1k
R2 çıkış 0 1k
B2 0 b2 I=v(çıkış)/1k
Rb2 b2 0 1k
B3 b3 0 V=v(giris,çıkış)
Rb3 b3 0 1k
E1 e 0 VALUE={v(çıkış)*2}
Re e 0 1k
R4 x 0 R={1k+v(çıkış)}
Rx giris x 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        x                                5.012469e+00
        e1_int1                          1.000000e+01
        e                                1.000000e+01
        b3                               5.000000e+00
        b2                               5.000000e+00
        ____k____                        5.000000e+00
        giris                            1.000000e+01
        v1#branch                        -9.98753e-03
        e1#branch                        -1.00000e-02
        b3#branch                        -5.00000e-03
        be1#branch                       0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(giris) = 10, v(____k____) = 5, v(b2) = 5, v(b3) = 5, v(e) = 10, v(e1_int1) = 10, v(x) = 5.012468827930174, i(be1) = 0, i(b3) = -0.005, i(e1) = -0.01, i(v1) = -0.009987531172069825
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(giris) = 10, v(____k____) = 5, v(b2) = 5, v(b3) = 5, v(e) = 10, v(e1_int1) = 10, v(x) = 5.012468827930174, i(be1) = 0, i(b3) = -0.005, i(e1) = -0.01, i(v1) = -0.009987531172069825
after the fix "Rename node çıkış to cikis" (non-ascii-node), which writes `R1 giris cikis 1k`, `R2 cikis 0 1k`, `B2 0 b2 I=v(cikis)/1k`, `B3 b3 0 V=v(giris,cikis)`, `E1 e 0 VALUE={v(cikis)*2}`, `R4 x 0 R={1k+v(cikis)}`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(giris) = 10, v(cikis) = 5, v(b2) = 5, v(b3) = 5, v(e) = 10, v(e1_int1) = 10, v(x) = 5.012468827930174, i(be1) = 0, i(b3) = -0.005, i(e1) = -0.01, i(v1) = -0.009987531172069825
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-17. A part after .end is read: the rename changes it there too

ngspice reads the lines after a plain .end (S25), so R3 is in the circuit: 3.333 V. The rename writes cikis on R3 too, and the circuit is the same; "Rename" and "Move .end to the bottom" now give the same circuit in either order. Before, R3 kept çıkış after the rename and was cut off: cikis = 5 V, i(v1) = −5 mA, with only the after-end warning left.

```spice
* a part after .end on a node with Turkish letters
V1 giris 0 10
R1 giris çıkış 1k
R2 çıkış 0 1k
.op
.end
R3 çıkış 0 1k
```

```text
ngspice 47, ngspice -b (exit 0):
        ____k____                        3.333333e+00
        giris                            1.000000e+01
        v1#branch                        -6.66667e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(giris) = 10, v(____k____) = 3.333333333333333, i(v1) = -0.006666666666666667
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(giris) = 10, v(____k____) = 3.333333333333333, i(v1) = -0.006666666666666667
after the fix "Rename node çıkış to cikis" (non-ascii-node), which writes `R1 giris cikis 1k`, `R2 cikis 0 1k`, `R3 cikis 0 1k`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(giris) = 10, v(cikis) = 3.333333333333333, i(v1) = -0.006666666666666667
after the fix "Move .end to the bottom" (after-end), which writes `R3 çıkış 0 1k`, `.end`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(giris) = 10, v(____k____) = 3.333333333333333, i(v1) = -0.006666666666666667
the netlist the fix wrote before (R3 left on çıkış):
    ngspice 47 and 42, -b -r (exit 0): v(giris) = 10, v(cikis) = 5, v(____k____) = 0, i(v1) = -0.005
    our engine (exit 0): v(giris) = 10, v(cikis) = 5, v(____k____) = 0, i(v1) = -0.005
```

PlainSpice's checks: `non-ascii-node`, `after-end`.

### non-ascii-node-18. A .tf after .end: the rename changes its node too

A `.tf` after a plain .end runs (A3c): transfer_function = 0.5. The rename writes the plain name in it too, and it keeps 0.5. Renamed only before .end, the .tf asked about a node with nothing on it: transfer function 0 (`-b -r`, native 47 and 42).

```spice
* a .tf after .end on a node with Turkish letters
V1 giris 0 10
R1 giris çıkış 1k
R2 çıkış 0 1k
.end
.tf v(çıkış) V1
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 5.000000e-01
    output_impedance_at_v(____k____) = 5.000000e+02
    v1#input_impedance = 2.000000e+03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(Transfer_function) = 0.5, v(v1#Input_impedance) = 2000, v(output_impedance_at_V(____k____)) = 500
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(Transfer_function) = 0.5, v(v1#Input_impedance) = 2000, v(output_impedance_at_V(____k____)) = 500
after the fix "Rename node çıkış to cikis" (non-ascii-node), which writes `R1 giris cikis 1k`, `R2 cikis 0 1k`, `.tf v(cikis) V1`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(Transfer_function) = 0.5, v(v1#Input_impedance) = 2000, v(output_impedance_at_V(cikis)) = 500
after the fix "Move .end to the bottom" (after-end), which writes `.tf v(çıkış) V1`, `.end`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(Transfer_function) = 0.5, v(v1#Input_impedance) = 2000, v(output_impedance_at_V(____k____)) = 500
the netlist the fix wrote before (the .tf left on çıkış):
    ngspice 47 and 42, -b -r (exit 0): v(Transfer_function) = 0, v(v1#Input_impedance) = 2000, v(output_impedance_at_V(____k____)) = 1
    our engine (exit 0): v(Transfer_function) = 0, v(v1#Input_impedance) = 2000, v(output_impedance_at_V(____k____)) = 1
```

PlainSpice's checks: `non-ascii-node`, `after-end`.

### non-ascii-node-19. .pz names its four nodes bare: the rename changes them too

`.pz in 0 out 0 vol pz` names the input and output nodes without v( ). The rename writes the plain name there too: one pole at −2000 rad/s, before and after. Left as it was, the .pz asked about a node with nothing on it, and native 47 and 42 stopped: "The input signal is shorted on the way to the output" (`-b -r`).

```spice
* .pz on a node with Turkish letters
V1 giris 0 dc 10 ac 1
R1 giris çıkış 1k
R2 çıkış 0 1k
C1 çıkış 0 1u
.pz giris 0 çıkış 0 vol pz
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(pole(1)) = -2000
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(pole(1)) = -2000
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(pole(1)) = -2000
after the fix "Rename node çıkış to cikis" (non-ascii-node), which writes `R1 giris cikis 1k`, `R2 cikis 0 1k`, `C1 cikis 0 1u`, `.pz giris 0 cikis 0 vol pz`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(pole(1)) = -2000
the netlist the fix wrote before (the .pz left on çıkış):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error: incomplete or empty netlist
      doAnalyses: The input signal is shorted on the way to the output
    ngspice 42, -b -r (exit 1): (no rawfile)
      doAnalyses: The input signal is shorted on the way to the output
    our engine (exit 1, no results): (none)
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-20. A formula that writes the node with a capital letter (v(Çıkış)) reads the node çıkış: the rename changes it there too

Added after the last pass (13 November 2026, round-1 critic of the formulas lane, CR1-1). ngspice writes each byte of a letter outside a to z as `_` wherever it reads a node's name, so Çıkış and çıkış are one node for it, ____k____: the formulas read the node that R1 and R2 connect to, and b = e = 10 V. A name a formula only reads, written so, is that node: the check gives the warning for çıkış alone, and its fix renames the formulas too, so the numbers stay the same. Before, the checks counted Çıkış as another node: "çıkış and Çıkış are one node for ngspice", an error that hid the numbers, whose fix wrote Cikis2 into the formulas, a node with nothing on it (native 47: "singular matrix: check node cikis2").

```spice
* formulas that write the node with a capital letter
V1 giris 0 10
R1 giris çıkış 1k
R2 çıkış 0 1k
B1 b 0 V=v(Çıkış)*2
Rb b 0 1k
E1 e 0 VALUE={v(Çıkış)*2}
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e1_int1                          1.000000e+01
        e                                1.000000e+01
        b                                1.000000e+01
        ____k____                        5.000000e+00
        giris                            1.000000e+01
        v1#branch                        -5.00000e-03
        e1#branch                        -1.00000e-02
        b1#branch                        -1.00000e-02
        be1#branch                       0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(giris) = 10, v(____k____) = 5, v(b) = 10, v(e) = 10, v(e1_int1) = 10, i(be1) = 0, i(b1) = -0.01, i(e1) = -0.01, i(v1) = -0.005
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(giris) = 10, v(____k____) = 5, v(b) = 10, v(e) = 10, v(e1_int1) = 10, i(be1) = 0, i(b1) = -0.01, i(e1) = -0.01, i(v1) = -0.005
after the fix "Rename node çıkış to cikis" (non-ascii-node), which writes `R1 giris cikis 1k`, `R2 cikis 0 1k`, `B1 b 0 V=v(cikis)*2`, `E1 e 0 VALUE={v(cikis)*2}`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(giris) = 10, v(cikis) = 5, v(b) = 10, v(e) = 10, v(e1_int1) = 10, i(be1) = 0, i(b1) = -0.01, i(e1) = -0.01, i(v1) = -0.005
the netlist the error's fix wrote before (Cikis2 in the formulas):
    ngspice 47 and 42, -b -r (exit 1): (no rawfile data)
      DC solution failed -
      Warning: singular matrix:  check node cikis2
      Warning: Dynamic gmin stepping failed
      Warning: True gmin stepping failed
      Warning: source stepping failed
      Error: Transient op failed, timestep too small
      Error: The operating point could not be simulated successfully.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-21. .pz that writes the node with a capital letter: the rename changes it there too

Added after the last pass (13 November 2026, round-1 critic of the formulas lane, CR1-1). The same on a .pz line: .pz giris 0 Çıkış 0 reads the node çıkış, and gives the pole at −2000 before the rename and after it. Before, the checks said "çıkış and Çıkış are one node for ngspice", an error, and its fix wrote Cikis2 on the .pz line, a node with nothing on it, so the run aborted (the second run below).

```spice
* .pz that writes the node with a capital letter
V1 giris 0 dc 10 ac 1
R1 giris çıkış 1k
R2 çıkış 0 1k
C1 çıkış 0 1u
.pz giris 0 Çıkış 0 vol pz
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(pole(1)) = -2000
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(pole(1)) = -2000
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(pole(1)) = -2000
after the fix "Rename node çıkış to cikis" (non-ascii-node), which writes `R1 giris cikis 1k`, `R2 cikis 0 1k`, `C1 cikis 0 1u`, `.pz giris 0 cikis 0 vol pz`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(pole(1)) = -2000
the netlist the error's fix wrote before (Cikis2 on the .pz line):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error: incomplete or empty netlist
      doAnalyses: The input signal is shorted on the way to the output
    ngspice 42, -b -r (exit 1): (no rawfile)
      doAnalyses: The input signal is shorted on the way to the output
    our engine (exit 1, no results): (none)
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-22. A part after .end that writes the node with a capital letter is on that node: the rename changes it there too

Added after the last pass (13 November 2026, round-1 critic of the formulas lane, CR1-1). ngspice reads the lines after a plain .end (S25), and R3 Çıkış is on ____k____ with R2: 3.333 V. The rename writes cikis on R3 too, and the circuit is the same. Before, R3 kept Çıkış and was cut off: cikis = 5 V, i(v1) = −5 mA (the second run below), with only the after-end warning left.

```spice
* a part after .end that writes the node with a capital letter
V1 giris 0 10
R1 giris çıkış 1k
R2 çıkış 0 1k
.op
.end
R3 Çıkış 0 1k
```

```text
ngspice 47, ngspice -b (exit 0):
        ____k____                        3.333333e+00
        giris                            1.000000e+01
        v1#branch                        -6.66667e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(giris) = 10, v(____k____) = 3.333333333333333, i(v1) = -0.006666666666666667
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(giris) = 10, v(____k____) = 3.333333333333333, i(v1) = -0.006666666666666667
after the fix "Rename node çıkış to cikis" (non-ascii-node), which writes `R1 giris cikis 1k`, `R2 cikis 0 1k`, `R3 cikis 0 1k`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(giris) = 10, v(cikis) = 3.333333333333333, i(v1) = -0.006666666666666667
after the fix "Move .end to the bottom" (after-end), which writes `R3 Çıkış 0 1k`, `.end`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(giris) = 10, v(____k____) = 3.333333333333333, i(v1) = -0.006666666666666667
the netlist the fix wrote before (R3 left on Çıkış):
    ngspice 47 and 42, -b -r (exit 0): v(giris) = 10, v(cikis) = 5, v(____k____) = 0, i(v1) = -0.005
    our engine (exit 0): v(giris) = 10, v(cikis) = 5, v(____k____) = 0, i(v1) = -0.005
```

PlainSpice's checks: `non-ascii-node`, `after-end`.

### non-ascii-node-23. .save names the node bare: the rename changes it there too

Added after the last pass (13 November 2026, round-1 critic of the formulas lane, CR1-3). ngspice saves a node named bare on .save as v(name); it writes the letters of the name as `_` there, as on part lines, so .save çıkış saves ____k____ (and so does .save Çıkış). The rename writes cikis on the .save line too. Left there, the old name saves nothing: run as PlainSpice runs it (-b -r), ngspice says "no data saved for D.C. Operating point analysis; analysis not run" (the second run below), and PlainSpice's run, which also saves every part's current for .op, gives the currents but no node voltage. A bare name on .probe is no node: ngspice warns "Strange parameter" and ignores it (the third run).

```spice
* .save names the node bare
V1 giris 0 10
R1 giris çıkış 1k
R2 çıkış 0 1k
.save çıkış
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        ____k____                        5.000000e+00
        giris                            1.000000e+01
        v1#branch                        -5.00000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(____k____) = 5
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(____k____) = 5
after the fix "Rename node çıkış to cikis" (non-ascii-node), which writes `R1 giris cikis 1k`, `R2 cikis 0 1k`, `.save cikis`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(cikis) = 5
the old name left on .save after the rename:
    ngspice 47 and 42, -b -r (exit 1): (no rawfile)
      Error: no data saved for D.C. Operating point analysis; analysis not run
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
a bare name on .probe:
    ngspice 47 and 42, -b -r (exit 0): v(in) = 10, v(out) = 5, i(r2) = 0.005, i(r1) = 0.005, i(v1) = -0.005
      Warning: Strange parameter in line *probe out, ingnored
    our engine (exit 0): v(in) = 10, v(out) = 5, i(r2) = 0.005, i(r1) = 0.005, i(v1) = -0.005, with the same messages as ngspice 47
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-24. .global makes the node one node in every subcircuit: the rename changes it there and inside the subcircuit

Added after the last pass (13 November 2026, round-1 critic of the formulas lane, CR1-3). .global çıkış makes çıkış one node in the subcircuit sub too, so R2, inside it, is on the same node as R1 and R3: 1 kΩ in parallel with 2 kΩ, 4 V. The rename writes cikis on the .global line, on R1 and R3, and on R2 inside the subcircuit, and the circuit is the same. A rename that left the subcircuit's line would cut R2 off: cikis = 6.667 V (the second run below).

```spice
* .global with a node with Turkish letters
.global çıkış
V1 giris 0 10
R1 giris çıkış 1k
R3 çıkış 0 2k
X1 sub
.subckt sub
R2 çıkış 0 1k
.ends
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        ____k____                        4.000000e+00
        giris                            1.000000e+01
        v1#branch                        -6.00000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(giris) = 10, v(____k____) = 4, i(v1) = -0.006
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(giris) = 10, v(____k____) = 4, i(v1) = -0.006
after the fix "Rename node çıkış to cikis" (non-ascii-node), which writes `.global cikis`, `R1 giris cikis 1k`, `R3 cikis 0 2k`, `R2 cikis 0 1k`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(giris) = 10, v(cikis) = 4, i(v1) = -0.006
R2's line in the subcircuit left with the old name:
    ngspice 47 and 42, -b -r (exit 0): v(giris) = 10, v(cikis) = 6.666666666666666, v(x1.____k____) = 0, i(v1) = -0.003333333333333334
    our engine (exit 0): v(giris) = 10, v(cikis) = 6.666666666666666, v(x1.____k____) = 0, i(v1) = -0.003333333333333334
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-25. A .func's formula reads the node: the rename changes it there too

Added after the last pass (13 November 2026, round-1 critic of the formulas lane, CR1-3). .func vo() {v(çıkış)} reads the node wherever vo() is used: b = 10 V. The rename writes cikis inside the .func too, and the numbers stay the same. ngspice reads every name inside v(...) of a .func as a node, even one of the function's own names: .func vd(a,b) {v(a)-v(b)} reads the nodes a and b, not the words vd is given (the second run below: "singular matrix: check nodes b1#branch and a").

```spice
* a .func that reads a node with Turkish letters
V1 giris 0 10
R1 giris çıkış 1k
R2 çıkış 0 1k
.func vo() {v(çıkış)}
B1 b 0 V=vo()*2
Rb b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                1.000000e+01
        ____k____                        5.000000e+00
        giris                            1.000000e+01
        v1#branch                        -5.00000e-03
        b1#branch                        -1.00000e-02
  ngspice -b -r out.raw (exit 0)
    rawfile: v(giris) = 10, v(____k____) = 5, v(b) = 10, i(b1) = -0.01, i(v1) = -0.005
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(giris) = 10, v(____k____) = 5, v(b) = 10, i(b1) = -0.01, i(v1) = -0.005
after the fix "Rename node çıkış to cikis" (non-ascii-node), which writes `R1 giris cikis 1k`, `R2 cikis 0 1k`, `.func vo() {v(cikis)}`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(giris) = 10, v(cikis) = 5, v(b) = 10, i(b1) = -0.01, i(v1) = -0.005
a .func with words of its own inside v(...):
    ngspice 47 and 42, -b -r (exit 1): (no rawfile data)
      DC solution failed -
      Warning: singular matrix:  check nodes b1#branch and a
      Warning: Dynamic gmin stepping failed
      Warning: True gmin stepping failed
      Warning: source stepping failed
      Error: Transient op failed, timestep too small
      Error: The operating point could not be simulated successfully.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-26. A name with Turkish letters that only a formula reads, and no part is on: a node nothing connects to, 'singular matrix', and no results

Added after the round-2 critic of the formulas lane (13 November 2026, CR2-2). ngspice spells çıkış as ____k____, and when no part is on a node it spells that way (here the parts are on out), the formula reads a node nothing connects to: "singular matrix: check node ____k____", and no results. Renaming it to cikis would leave it so; the checks offer no fix then. When the parts are on cikis (the second run), the formula was written for that node, and the fix connects it there: e = 10 V.

```spice
* Turkish letters in a name only a formula reads
V1 in 0 5
R1 in out 1k
R2 out 0 1k
B1 e 0 V=v(çıkış)*2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    DC solution failed -
    Last Node Voltages
    Node                                   Last Voltage        Previous Iter
    ----                                   ------------        -------------
    in                                                0                    0
    out                                               0                    0
    e                                                 0                    0
    ____k____                                         0                    0
    b1#branch                                         0                    0
    v1#branch                                         0                    5 *
    Warning: singular matrix:  check node ____k____
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node ____k____
    Warning: singular matrix:  check node ____k____
    Warning: singular matrix:  check node ____k____
    Warning: singular matrix:  check node ____k____
    Warning: singular matrix:  check node ____k____
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
    rawfile: (no rawfile data)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
with the parts on cikis, V1 giris 0 10 / R1 giris cikis 1k / R2 cikis 0 1k and B1 e 0 V=v(çıkış)*2, which PlainSpice's checks say the same way, with the fix "Connect to cikis":
    ngspice 47 and 42, -b -r (exit 1): (no rawfile data)
      DC solution failed -
      Warning: singular matrix:  check node ____k____
      Warning: Dynamic gmin stepping failed
      Warning: True gmin stepping failed
      Warning: source stepping failed
      Error: Transient op failed, timestep too small
      Error: The operating point could not be simulated successfully.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after that fix, B1 e 0 V=v(cikis)*2:
    ngspice 47 and 42, -b -r (exit 0): v(giris) = 10, v(cikis) = 5, v(e) = 10, i(b1) = -0.01, i(v1) = -0.005
    our engine (exit 0): v(giris) = 10, v(cikis) = 5, v(e) = 10, i(b1) = -0.01, i(v1) = -0.005
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-27. Two spellings that differ only in capital letters (Çıkış and çıkış) on part lines are one node for ngspice, as written: the rename of both gives the same numbers

Added after the round-2 critic of the formulas lane (13 November 2026, CR2-3). ngspice writes each letter outside a to z as underscores, so Çıkış and çıkış are both ____k____: one node, which is what a netlist that writes one name with and without a capital means (as N1 and n1 are one node, W6). The divider gives 5 V there, in native 47 and 42 and our engine; renamed to one plain name (Cikis, as the fix writes), the same 5 V. The same for an E whose control node is written Çıkış (e = 10 V before and after), and for a part after .end that writes Çıkış: 3.333 V and i(v1) = -6.667 mA, whether .end is moved first or the node is renamed first. Different letters ngspice spells alike (ş and ç) stay two nodes for the student: non-ascii-node-2.

```spice
* two spellings of one node
V1 giris 0 10
R1 giris Çıkış 1k
R2 çıkış 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        ____k____                        5.000000e+00
        giris                            1.000000e+01
        v1#branch                        -5.00000e-03
  ngspice -b -r out.raw (exit 0)
    rawfile: v(giris) = 10, v(____k____) = 5, i(v1) = -0.005
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(giris) = 10, v(____k____) = 5, i(v1) = -0.005
after the fix "Rename node Çıkış and node çıkış to Cikis" (non-ascii-node), which writes `R1 giris Cikis 1k`, `R2 Cikis 0 1k`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(giris) = 10, v(cikis) = 5, i(v1) = -0.005
an E whose control node is written with the capital, E1 e 0 Çıkış 0 2 (R1 and R2 on çıkış), which PlainSpice's checks say the same way:
    ngspice 47 and 42, -b -r (exit 0): v(giris) = 10, v(____k____) = 5, v(e) = 10, i(e1) = -0.01, i(v1) = -0.005
    our engine (exit 0): v(giris) = 10, v(____k____) = 5, v(e) = 10, i(e1) = -0.01, i(v1) = -0.005
after its fix, E1 e 0 cikis 0 2 (R1 and R2 on cikis):
    ngspice 47 and 42, -b -r (exit 0): v(giris) = 10, v(cikis) = 5, v(e) = 10, i(e1) = -0.01, i(v1) = -0.005
    our engine (exit 0): v(giris) = 10, v(cikis) = 5, v(e) = 10, i(e1) = -0.01, i(v1) = -0.005
R3 Çıkış after .end, with R1 and R2 on çıkış (non-ascii-node-22):
    ngspice 47 and 42, -b -r (exit 0): v(giris) = 10, v(____k____) = 3.333333333333333, i(v1) = -0.006666666666666667
    our engine (exit 0): v(giris) = 10, v(____k____) = 3.333333333333333, i(v1) = -0.006666666666666667
the same with .end moved to the bottom first (R3 Çıkış a part line), which PlainSpice's checks say the same way:
    ngspice 47 and 42, -b -r (exit 0): v(giris) = 10, v(____k____) = 3.333333333333333, i(v1) = -0.006666666666666667
    our engine (exit 0): v(giris) = 10, v(____k____) = 3.333333333333333, i(v1) = -0.006666666666666667
after both fixes, in either order (R1, R2 and R3 on cikis):
    ngspice 47 and 42, -b -r (exit 0): v(giris) = 10, v(cikis) = 3.333333333333333, i(v1) = -0.006666666666666667
    our engine (exit 0): v(giris) = 10, v(cikis) = 3.333333333333333, i(v1) = -0.006666666666666667
```

PlainSpice's checks: `non-ascii-node`.

### non-ascii-node-28. A part with an end on each of two spellings that differ only in capital letters has them joined by ngspice: no one node as the netlist means, so it stays the error

Added after the integration check of the last pass (14 November 2026, X1). A netlist that puts a part between Çıkış and çıkış wrote two nodes there, as one that puts a part between aµ and au does (non-ascii-node-5): ngspice spells both ____k____ and joins the part's ends, so R2 carries no current and the divider gives 5 V, where the two nodes written give 6.667 V and 3.333 V. A current source there drives its 1 mA from the node into the same node and changes nothing; a voltage source there stops ngspice ("instance v2 is a shorted VSRC"); an E reading there reads 0 V. So PlainSpice says these are one node for ngspice and that it simulates a different circuit from the one written (the error of non-ascii-node-2), and its fix gives each spelling a plain name of its own, after which the circuit runs as written. Only parts outside subcircuits and after a plain .end count: inside a subcircuit the names are its own. With no part across, the spellings stay the one node of non-ascii-node-27.

```spice
* a resistor between two spellings of one name
V1 in 0 10
R1 in Çıkış 1k
R2 Çıkış çıkış 1k
R3 çıkış 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        ____k____                        5.000000e+00
        in                               1.000000e+01
        v1#branch                        -5.00000e-03
     device                    r3                    r2                    r1
          i                 0.005                     0                 0.005
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 10, v(____k____) = 5, i(v1) = -0.005
  with .options savecurrents, -b -r (exit 0)
    rawfile: v(in) = 10, v(____k____) = 5, i(v1) = -0.005, i(@r1[i]) = 0.005, i(@r2[i]) = 0, i(@r3[i]) = 0.005
ngspice 42: the same printout, exit codes and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 10, v(____k____) = 5, i(v1) = -0.005
    with .options savecurrents: i(@r1[i]) = 0.005, i(@r2[i]) = 0, i(@r3[i]) = 0.005
after the fix "Write Cikis for Çıkış and cikis2 for çıkış" (non-ascii-node), which writes `R1 in Cikis 1k`, `R2 Cikis cikis2 1k`, `R3 cikis2 0 1k`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 10, v(cikis) = 6.666666666666666, v(cikis2) = 3.333333333333333, i(v1) = -0.003333333333333334
I1 Çıkış çıkış 1m in place of R2, with .options savecurrents:
    ngspice 47 and 42, -b -r (exit 0): v(in) = 10, v(____k____) = 5, i(v1) = -0.005, i(@r1[i]) = 0.005, i(@i1[current]) = 0.001, i(@r3[i]) = 0.005
    our engine (exit 0): the same values
  after the fix (I1 Cikis cikis2 1m):
    ngspice 47 and 42, -b -r (exit 0) and our engine: v(in) = 10, v(cikis) = 9, v(cikis2) = 1, i(v1) = -0.0009999999999999992
V2 Çıkış çıkış 1 in place of R2:
    ngspice 47 and 42, -b and -b -r (exit 1): Fatal error: instance v2 is a shorted VSRC
    our engine (exit 1): Fatal error: instance v2 is a shorted VSRC
E1 out 0 Çıkış çıkış 2 with Ro out 0 1k, beside R2:
    ngspice 47 and 42, -b -r (exit 0): v(in) = 10, v(____k____) = 5, v(out) = 0, i(e1) = 0, i(v1) = -0.005
    our engine (exit 0): v(in) = 10, v(____k____) = 5, v(out) = 0, i(e1) = 0, i(v1) = -0.005
```

PlainSpice's checks: `non-ascii-node` (the error, for R2, I1, V2 and E1 alike, and for such a part after a plain .end).

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
shows it as a dot with that name. After the re-check of those fixes (12 November 2026): invisible means all of Unicode's
default-ignorable characters, with the line and paragraph separators and the next-line character
(invisible-character-23 to -25), each named in words; on a capacitor or an inductor ngspice also warns
that it can't find a model with the word's name (invisible-character-7), so the words say so there; and
on an analysis line ngspice never says "unknown parameter": what it does with a word it cannot read
depends on the place of the word, and the words say it place by place (invisible-character-8 to -21),
or leave out a place no run shows. After the critic of those fixes (12 November 2026, CR1-1, CR1-2,
CR1-5): what ngspice does with a number it reads short depends on the place too, weighed with the line's
other numbers (invisible-character-28 to -44): a `.tran` step or stop time of 0 stops it, a `.dc` step of
0 stops ngspice 47, `.ac` and `.noise` warn or stop, and the words say so there, "without a message" only
where ngspice runs on with the number (-22, -44); a resistor read as 0 gets zero-ohm's words
(zero-ohm-4); and a word in a source's function (PULSE, SIN, PWL, EXP, SFFM), its AC value or phase, or
a setting's value (`m=`, `dc=`, `ic=`) has a place of its own, with what ngspice says there (-45 to -53),
and is never called the part's value.

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
> *Fixes:* "Take it out: connect to node out"

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

What PlainSpice shows for invisible-character-7 (warning, line 4):

> **C1's value is read as 2 F, not 2 µF.** A zero-width space (U+200B) sits between 2 and u: a character you cannot see, which often comes with text copied from a web page or a PDF. SPICE stops reading the number at it, so the u after it does not count. Write 2u.
>
> *ngspice:* ngspice stops reading the number at the zero-width space and ignores the rest of the word: it reads 2 F, and only warns that it can't find a model with the word's name. [invisible-character-1, invisible-character-2, invisible-character-7]
>
> *Fixes:* "Write 2u (2 µF)"

What PlainSpice shows for invisible-character-9 (error, line 5):

> **This value is not a number for SPICE.** It starts with a zero-width space (U+200B), a character you cannot see (it often comes with text copied from a web page or a PDF), so SPICE does not read the word as a number. Write 2m.
>
> *ngspice:* ngspice stops: 'TSTOP is invalid, must be greater than zero.' [invisible-character-9]
>
> *Fixes:* "Write 2m"

What PlainSpice shows for invisible-character-13 (error, line 4):

> **This value is not a number for SPICE.** It starts with a zero-width space (U+200B), a character you cannot see (it often comes with text copied from a web page or a PDF), so SPICE does not read the word as a number. Write 5.
>
> *ngspice:* ngspice 47 stops: 'Bad syntax!'. ngspice 42 takes the word for the name of a second source to sweep, and stops: 'Voltage source, current source, or resistor named "___5" is not in the circuit'. [invisible-character-13]
>
> *Fixes:* "Write 5"

What PlainSpice shows for invisible-character-18 (error, line 5):

> **This value is not a number for SPICE.** It starts with a zero-width space (U+200B), a character you cannot see (it often comes with text copied from a web page or a PDF), so SPICE does not read the word as a number. Write 5k.
>
> *ngspice:* ngspice warns: 'Warning, ngspice assumes default parameter(s) for ac simulation', and runs anyway, up to 1000 times the start frequency (1 kHz) instead of the stop written here. [invisible-character-18]
>
> *Fixes:* "Write 5k"

What PlainSpice shows for invisible-character-22 (warning, line 5):

> **This value is read as 5, not 50.** A zero-width space (U+200B) sits between 5 and 0: a character you cannot see, which often comes with text copied from a web page or a PDF. SPICE stops reading the number at it, so the 0 after it does not count. Write 50.
>
> *ngspice:* ngspice stops reading the number at the zero-width space and ignores the rest of the word, without a message: it reads 5. [invisible-character-1, invisible-character-2, invisible-character-22]
>
> *Fixes:* "Write 50"

What PlainSpice shows for invisible-character-23 (warning, line 3):

> **R1's value is read as 4 Ω, not 4.7 kΩ.** A line separator (U+2028) sits between 4 and .7k: a character you cannot see, which often comes with text copied from a web page or a PDF. SPICE stops reading the number at it, so the .7k after it does not count. Write 4.7k.
>
> *ngspice:* ngspice stops reading the number at the line separator and ignores the rest of the word, without a message: it reads 4 Ω. [invisible-character-1, invisible-character-23]
>
> *Fixes:* "Write 4.7k (4.7 kΩ)"

What PlainSpice shows for invisible-character-28 (error, line 5):

> **This value is read as 0, not 0.1m.** A zero-width space (U+200B) sits between 0 and .1m: a character you cannot see, which often comes with text copied from a web page or a PDF. SPICE stops reading the number at it, so the .1m after it does not count. Write 0.1m.
>
> *ngspice:* ngspice stops reading the number at the zero-width space and ignores the rest of the word: it reads 0, and ngspice stops: 'TSTEP is invalid, must be greater than zero.' [invisible-character-1, invisible-character-2, invisible-character-28]
>
> *Fixes:* "Write 0.1m"

What PlainSpice shows for invisible-character-32 (error, line 4):

> **This value is read as 0, not 0.5.** A zero-width space (U+200B) sits between 0 and .5: a character you cannot see, which often comes with text copied from a web page or a PDF. SPICE stops reading the number at it, so the .5 after it does not count. Write 0.5.
>
> *ngspice:* ngspice stops reading the number at the zero-width space and ignores the rest of the word: it reads 0, and a step of 0 stops ngspice 47: 'Bad syntax!'. ngspice 42 never finishes. [invisible-character-1, invisible-character-2, invisible-character-32, dc-sweep-problems-1]
>
> *Fixes:* "Write 0.5"

What PlainSpice shows for invisible-character-45 (error, line 2):

> **A word in V1's PULSE is not a number for SPICE.** It starts with a zero-width space (U+200B), a character you cannot see (it often comes with text copied from a web page or a PDF), so SPICE does not read the word as a number. Write 0.
>
> *ngspice:* ngspice stops: 'parameter value out of range or the wrong type'. [invisible-character-45]
>
> *Fixes:* "Write 0"

What PlainSpice shows for invisible-character-50 (error, line 3):

> **R1's m value is not a number for SPICE.** It starts with a zero-width space (U+200B), a character you cannot see (it often comes with text copied from a web page or a PDF), so SPICE does not read the word as a number. Write 2.
>
> *ngspice:* ngspice stops with a fatal error: 'Undefined parameter [___2]'. [invisible-character-50, invisible-character-52, invisible-character-53]
>
> *Fixes:* "Write 2"

### invisible-character-7. On a capacitor or an inductor ngspice also warns that it can't find a model: 2<ZWSP>u is 2 F, 3<ZWSP>m is 3 H

Added after the re-check of the fixes for the final reviews (12 November 2026, S4). The same character in a capacitor's and an inductor's value ends the number as in a resistor's (invisible-character-1), and for these two parts ngspice also looks the whole word up as a model name and warns that it finds none, as for the Greek mu (greek-mu-2) and a thin space (space-character-8). So on C and L the checks say "and only warns that it can't find a model with the word's name", never "without a message". C1 is 2 F and L1 is 3 H: through 1 Ω, out has barely risen after 1 ms, and b has barely dropped. Native 47's time grid differs from 42's and from our engine's (81, 80 and 59 points); the final values agree to 6 significant figures.

```spice
* a zero-width space in a capacitor's and an inductor's value
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1
C1 out 0 2<ZWSP>u
R2 in b 1
L1 b 0 3<ZWSP>m
.tran 0.1m 1m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '2<ZWSP>u' from line
        c1 out 0 2<ZWSP>u
    warning, can't find model '3<ZWSP>m' from line
        l1 b 0 3<ZWSP>m
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: time: 81 points, last 0.001, v(in): 81 points, last 1, v(out): 81 points, last 0.0004998747709848901, v(b): 81 points, last 0.9996667223826431, i(l1): 81 points, last 0.00033327761735695444, i(v1): 81 points, last -0.9998334028463721
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '2<ZWSP>u' from line
        c1 out 0 2<ZWSP>u
    warning, can't find model '3<ZWSP>m' from line
        l1 b 0 3<ZWSP>m
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: time: 80 points, last 0.001, v(in): 80 points, last 1, v(out): 80 points, last 0.0004998747709849339, v(b): 80 points, last 0.999666722382643, i(l1): 80 points, last 0.00033327761735696697, i(v1): 80 points, last -0.999833402846372
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    in                                           0
    out                                          0
    b                                            0
    l1#branch                                    0
    v1#branch                                    0
    warning, can't find model '2<ZWSP>u' from line
    c1 out 0 2<ZWSP>u
    warning, can't find model '3<ZWSP>m' from line
    l1 b 0 3<ZWSP>m
    vectors: time: 59 points, last 0.001, v(in): 59 points, last 1, v(out): 59 points, last 0.0004998750208322771, v(b): 59 points, last 0.9996667222160498, i(l1): 59 points, last 0.00033327778395019126, i(v1): 59 points, last -0.9998334027631179
```

PlainSpice's checks: `invisible-character` (twice).

### invisible-character-8. At the start of .tran's step the word is no number: ngspice stops, 'TSTEP is invalid'

Added after the re-check (12 November 2026, S2): on an analysis line a number that starts with a character ngspice writes as `_` is no number, as on a part line, but ngspice never says "unknown parameter" there. What it does depends on the place of the word, so the checks say it place by place, from the runs below (invisible-character-8 to -21), and leave alone the words of any place no run shows (`.four`, which a run with a results file ignores anyway, invisible-character-27, `.disto`, `.pz`, `.sens`, `.sp`, a `.noise`'s points per summary). The character does not matter, only the place: ngspice writes each byte outside printable ASCII as `_` (W16), and look-alike-letter-8 and space-character-15 show the same with a minus sign and a thin space. ngspice reads the step as 0, then reads the same word again for the stop.

```spice
* a zero-width space before the step of .tran
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran <ZWSP>0.1m 2m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran ___0.1m 2m
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
      .tran ___0.1m 2m
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

PlainSpice's checks: `invisible-character`.

### invisible-character-9. At the start of .tran's stop time: 'TSTOP is invalid'

```spice
* a zero-width space before the stop time of .tran
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 0.1m <ZWSP>2m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0.1m ___2m
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
      .tran 0.1m ___2m
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

PlainSpice's checks: `invisible-character`.

### invisible-character-10. At the start of .tran's start time: 'unknown parameter on .tran - ignored', and ngspice runs nothing

ngspice says the word is ignored, but the error stops it: the circuit is not parsed and no analysis runs.

```spice
* a zero-width space before the start time of .tran
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 0.1m 2m <ZWSP>1m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0.1m 2m ___1m
     Error: unknown parameter on .tran - ignored
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0.1m 2m ___1m
     Error: unknown parameter on .tran - ignored
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

### invisible-character-11. At the start of .tran's largest step: the same

```spice
* a zero-width space before the largest step of .tran
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 0.1m 2m 0 <ZWSP>1u
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0.1m 2m 0 ___1u
     Error: unknown parameter on .tran - ignored
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0.1m 2m 0 ___1u
     Error: unknown parameter on .tran - ignored
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

### invisible-character-12. At the start of a .dc sweep's start: ngspice 47 says 'Bad syntax!', ngspice 42 takes the word for a second source

ngspice 47 reads a word it cannot read as 0 and reads the same word again for the next number, so the step comes out 0 and it stops ('Bad syntax!', as for a step of 0, dc-sweep-problems-1). ngspice 42, without that check, reads the word on as the name of a second sweep and stops when the sweep starts, under `-b -r`.

```spice
* a zero-width space before the start of a .dc sweep
V1 in 0 1
R1 in 0 1k
.dc V1 <ZWSP>0 5 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .dc v1 ___0 5 1
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "___0" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `invisible-character`.

### invisible-character-13. At the start of a .dc sweep's stop: the same

```spice
* a zero-width space before the stop of a .dc sweep
V1 in 0 1
R1 in 0 1k
.dc V1 0 <ZWSP>5 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .dc v1 0 ___5 1
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "___5" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `invisible-character`.

### invisible-character-14. At the start of a .dc sweep's step: the same

```spice
* a zero-width space before the step of a .dc sweep
V1 in 0 1
R1 in 0 1k
.dc V1 0 5 <ZWSP>1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .dc v1 0 5 ___1
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "___1" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `invisible-character`.

### invisible-character-15. In a second .dc sweep: ngspice 47 says 'Bad syntax!'; ngspice 42 did not finish

ngspice 42 was stopped after 8 s (as with a step of 0, dc-sweep-problems-1), so the checks say only what ngspice 47 does here.

```spice
* a zero-width space before the start of a second .dc sweep
V1 in 0 1
V2 b 0 1
R1 in b 1k
.dc V1 0 5 1 V2 <ZWSP>0 1 0.5
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .dc v1 0 5 1 v2 ___0 1 0.5
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit null)
    rawfile: (did not finish in 8 s: stopped)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `invisible-character`.

### invisible-character-16. At the start of .ac's number of points: ngspice warns that it assumes default parameters, then stops: 'AC startfreq <= 0'

ngspice puts 10 points in place of the word, then reads the same word for the start frequency, which comes out 0.

```spice
* a zero-width space before the number of points of .ac
V1 in 0 DC 0 AC 1
R1 in out 1k
C1 out 0 1u
.ac dec <ZWSP>10 1 1k
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac dec ___10 1 1k'
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    ERROR: AC startfreq <= 0
    doAnalyses: parameter value out of range or the wrong type
    run simulation(s) aborted
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac dec ___10 1 1k'
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    ERROR: AC startfreq <= 0
    doAnalyses: parameter value out of range or the wrong type
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `invisible-character`.

### invisible-character-17. At the start of .ac's start frequency: the same

```spice
* a zero-width space before the start frequency of .ac
V1 in 0 DC 0 AC 1
R1 in out 1k
C1 out 0 1u
.ac dec 10 <ZWSP>1 1k
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac dec 10 ___1 1k'
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    ERROR: AC startfreq <= 0
    doAnalyses: parameter value out of range or the wrong type
    run simulation(s) aborted
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac dec 10 ___1 1k'
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    ERROR: AC startfreq <= 0
    doAnalyses: parameter value out of range or the wrong type
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `invisible-character`.

### invisible-character-18. At the start of .ac's stop frequency: ngspice warns and runs anyway, up to 1000 times the start frequency

The run goes on, with the stop frequency ngspice puts in place of one below the start: 1000 times the start frequency (ngspice 47, inp2dot.c), so 1 Hz to 1 kHz here, not to the 5 kHz written. So the check says that ngspice runs, never that it stops; it is still an error, as the frequencies are not the ones written.

```spice
* a zero-width space before the stop frequency of .ac
V1 in 0 DC 0 AC 1
R1 in out 1k
C1 out 0 1u
.ac dec 10 1 <ZWSP>5k
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac dec 10 1 ___5k'
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: frequency: 31 points, last 1000.000000000002, v(in): 31 points, last 1, v(out): 31 points, last 0.02470452303185754, i(v1): 31 points, last -0.0009752954769681424
ngspice 42, ngspice -b (exit 1):
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac dec 10 1 ___5k'
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: frequency: 31 points, last 1000.000000000002, v(in): 31 points, last 1, v(out): 31 points, last 0.02470452303185754, i(v1): 31 points, last -0.0009752954769681424
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: frequency: 31 points, last 1000.000000000002, v(in): 31 points, last 1, v(out): 31 points, last 0.02470452303185754, i(v1): 31 points, last -0.0009752954769681424
```

PlainSpice's checks: `invisible-character`.

### invisible-character-19. At the start of .noise's number of points: 'Frequency of 0 is invalid'

```spice
* a zero-width space before the number of points of .noise
V1 in 0 DC 0 AC 1
R1 in out 1k
C1 out 0 1u
.noise v(out) V1 dec <ZWSP>10 1 1k
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .noise v(out) v1 dec ___10 1 1k
    Frequency of 0 is invalid
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .noise v(out) v1 dec ___10 1 1k
    Frequency of 0 is invalid
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

### invisible-character-20. At the start of .noise's start frequency: the same

```spice
* a zero-width space before the start frequency of .noise
V1 in 0 DC 0 AC 1
R1 in out 1k
C1 out 0 1u
.noise v(out) V1 dec 10 <ZWSP>1 1k
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .noise v(out) v1 dec 10 ___1 1k
    Frequency of 0 is invalid
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .noise v(out) v1 dec 10 ___1 1k
    Frequency of 0 is invalid
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

### invisible-character-21. At the start of .noise's stop frequency: the same

```spice
* a zero-width space before the stop frequency of .noise
V1 in 0 DC 0 AC 1
R1 in out 1k
C1 out 0 1u
.noise v(out) V1 dec 10 1 <ZWSP>1k
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .noise v(out) v1 dec 10 1 ___1k
    Frequency of 0 is invalid
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .noise v(out) v1 dec 10 1 ___1k
    Frequency of 0 is invalid
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

### invisible-character-22. Inside the stop of .dc, .ac or .tran a character ends the number there, as in a value, and a stop still past the start runs without a message: 5<ZWSP>0 is 5, 20к is 20, 2<THIN>m is 2

Narrowed after the critic of the re-check fixes (12 November 2026, CR1-2): this run shows three stops read short but still past their start, and no more. A number read as 0, or read past the line's other numbers, does what its place does with it (invisible-character-28 to -43), and the other places where ngspice runs on with the number are invisible-character-44. What the warnings say of a word on an analysis line: the .dc sweep goes to 5 (6 points), the .ac sweep to 20 Hz (14 points) and the .tran run to 2 s. The three analyses run in one netlist, as nothing stops ngspice; on a line with a problem of its own, nothing is said of the line's outcome for the character (invisible-character-44). Native 47's time grid differs from 42's and from our engine's (2066, 2066 and 2017 points); the last time is 2 s in all three.

```spice
* characters inside the numbers of analysis lines
V1 in 0 DC 1 AC 1 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.dc V1 0 5<ZWSP>0 1
.ac dec 10 1 20к
.tran 1m 2<THIN>m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0), which also prints:
    Note: v1: dc value used for op instead of transient time=0 value.
    rawfile: frequency: 14 points, last 19.999999999999982, v(in): 14 points, last 1, v(out): 14 points, last 0.9844541235984988, i(v1): 14 points, last -0.000015545876401501122; v(v-sweep): 6 points, last 5, v(in): 6 points, last 5, v(out): 6 points, last 5, i(v1): 6 points, last 0; time: 2066 points, last 2, v(in): 2066 points, last 0, v(out): 2066 points, last 4.14019e-318, i(v1): 2066 points, last 4.14e-321
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0), which also prints:
    Note: v1: dc value used for op instead of transient time=0 value.
    rawfile: frequency: 14 points, last 19.999999999999982, v(in): 14 points, last 1, v(out): 14 points, last 0.9844541235984988, i(v1): 14 points, last -0.000015545876401501122; v(v-sweep): 6 points, last 5, v(in): 6 points, last 5, v(out): 6 points, last 5, i(v1): 6 points, last 0; time: 2066 points, last 2, v(in): 2066 points, last 0, v(out): 2066 points, last 4.64095e-318, i(v1): 2066 points, last 4.64e-321
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    in                                           0
    out                                          0
    v1#branch                                    0
    Note: v1: dc value used for op instead of transient time=0 value.
    vectors: frequency: 14 points, last 19.999999999999982, v(in): 14 points, last 1, v(out): 14 points, last 0.9844541235984988, i(v1): 14 points, last -0.000015545876401501122; v(v-sweep): 6 points, last 5, v(in): 6 points, last 5, v(out): 6 points, last 5, i(v1): 6 points, last 0; time: 2017 points, last 2, v(in): 2017 points, last 0, v(out): 2017 points, last 5.49174e-319, i(v1): 2017 points, last 5.5e-322
```

PlainSpice's checks: `invisible-character`, `look-alike-letter`, `space-character`.

### invisible-character-23. More invisible characters do the same inside a value: line and paragraph separators, a next-line character, a Mongolian vowel separator, an Arabic letter mark, a combining grapheme joiner, the Hangul fillers, a variation selector, a language tag

Added after the re-check (12 November 2026, C5): characters the first list left out. Each draws nothing in a line, so 4<X>.7k reads 4.7k but is 4 Ω. The check now takes all of Unicode's default-ignorable characters, and the line and paragraph separators and the next-line character, and names each one in words.

```spice
* more invisible characters inside a value
I1 0 n1 1
R1 n1 0 4<LSEP>.7k
I2 0 n2 1
R2 n2 0 4<PSEP>.7k
I3 0 n3 1
R3 n3 0 4<NEL>.7k
I4 0 n4 1
R4 n4 0 4<MVS>.7k
I5 0 n5 1
R5 n5 0 4<ALM>.7k
I6 0 n6 1
R6 n6 0 4<CGJ>.7k
I7 0 n7 1
R7 n7 0 4<HCF>.7k
I8 0 n8 1
R8 n8 0 4<HJF>.7k
I9 0 n9 1
R9 n9 0 4<HF>.7k
I10 0 n10 1
R10 n10 0 4<HWHF>.7k
I11 0 n11 1
R11 n11 0 4<VS16>.7k
I12 0 n12 1
R12 n12 0 4<LANG>.7k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
            n12                              4.000000e+00
            n11                              4.000000e+00
            n10                              4.000000e+00
            n9                               4.000000e+00
            n8                               4.000000e+00
            n7                               4.000000e+00
            n6                               4.000000e+00
            n5                               4.000000e+00
            n4                               4.000000e+00
            n3                               4.000000e+00
            n2                               4.000000e+00
            n1                               4.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 4, v(n2) = 4, v(n3) = 4, v(n4) = 4, v(n5) = 4, v(n6) = 4, v(n7) = 4, v(n8) = 4, v(n9) = 4, v(n10) = 4, v(n11) = 4, v(n12) = 4
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 4, v(n2) = 4, v(n3) = 4, v(n4) = 4, v(n5) = 4, v(n6) = 4, v(n7) = 4, v(n8) = 4, v(n9) = 4, v(n10) = 4, v(n11) = 4, v(n12) = 4
```

PlainSpice's checks: `invisible-character` (twelve times).

### invisible-character-24. At the start of a value one of them makes the word no number too: ngspice stops

```spice
* a line separator before a value
V1 in 0 10
R1 in out <LSEP>4.7k
R2 out 0 10k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '<LSEP>4.7k' from line
        r1 in out <LSEP>4.7k
    Error on line 3 or its substitute:
      r1 in out ___4.7k
      unknown parameter (___4.7k)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '<LSEP>4.7k' from line
        r1 in out <LSEP>4.7k
    Error on line 3 or its substitute:
      r1 in out ___4.7k
      unknown parameter (___4.7k)
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

### invisible-character-25. In a node name one of them makes another node: o<MVS>ut is o___ut, not out

```spice
* a Mongolian vowel separator inside a node name
V1 in 0 10
R1 in out 2k
R2 o<MVS>ut 0 2k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
            o___ut                           0.000000e+00
            out                              1.000000e+01
            in                               1.000000e+01
            v1#branch                        0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(in) = 10, v(out) = 10, v(o___ut) = 0, i(v1) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(in) = 10, v(out) = 10, v(o___ut) = 0, i(v1) = 0
```

PlainSpice's checks: `invisible-character`.

### invisible-character-26. At the start of an E's gain the word is no number: ngspice stops, 'unknown parameter (___2)', not 'not enough parameters'

Added after the re-check (12 November 2026, S6). A gain that ngspice cannot read is no missing gain: native 47 and 42 and our engine all stop at the word, so the only check is the character's, and its fix writes the gain.

```spice
* a zero-width space before the gain of E
V1 a 0 1
R0 a 0 1k
E1 b 0 a 0 <ZWSP>2
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      e1 b 0 a 0 ___2
      unknown parameter (___2)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      e1 b 0 a 0 ___2
      unknown parameter (___2)
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

### invisible-character-27. Before .four's frequency: ngspice reads no number, and a run with a results file ignores the .four line anyway

Why the checks leave the words of a `.four` line alone (re-check, 12 November 2026, S2): run as `ngspice -b`, ngspice says the frequency is bad and finds no data for it; run as `ngspice -b -r`, as PlainSpice runs it, it skips the whole line with a note and the run goes on. Nothing in the line changes what PlainSpice shows.

```spice
* a zero-width space before the frequency of .four
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 0.1m 2m
.four <ZWSP>1k v(out)
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Initial Transient Solution
    in                                           0
    out                                          0
    v1#branch                                    0
    Error: bad fundamental freq ___1k
    No transient data available for fourier analysis
  ngspice -b -r out.raw (exit 0), which prints instead of the two errors:
    .fourier line ignored since rawfile was produced.
    rawfile: time: 78 points, last 0.002, v(in): 78 points, last 1, v(out): 78 points, last 0.8646994810384804, i(v1): 78 points, last -0.00013530051896151957
ngspice 42, ngspice -b (exit 0):
    Initial Transient Solution
    in                                           0
    out                                          0
    v1#branch                                    0
    Error: bad fundamental freq ___1k
    No transient data available for fourier analysis
  ngspice -b -r out.raw (exit 0), which prints instead of the two errors:
    .fourier line ignored since rawfile was produced.
    rawfile: time: 78 points, last 0.002, v(in): 78 points, last 1, v(out): 78 points, last 0.8646998098739246, i(v1): 78 points, last -0.00013530019012607546
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    in                                           0
    out                                          0
    v1#branch                                    0
    .fourier line ignored since rawfile was produced.
    vectors: time: 59 points, last 0.002, v(in): 59 points, last 1, v(out): 59 points, last 0.8646997736181392, i(v1): 59 points, last -0.00013530022638186083
```

PlainSpice's checks: none.

### invisible-character-28. .tran's step read as 0: ngspice stops, 'TSTEP is invalid'

Added after the critic of the re-check fixes (12 November 2026, CR1-2). Inside a number of an analysis line a character ends the number, as in a value (invisible-character-22), and what ngspice does then depends on the number it reads at that place, weighed with the line's other numbers as ngspice reads them: a .tran step or stop time of 0 stops ngspice, and so does a start time that is not before the stop time (-28 to -31); a .dc step of 0 stops ngspice 47 and keeps 42 going for ever, and a sweep the wrong way round has no points (-32, -33); .ac warns and runs on with points or a stop of its own, or stops at a start of 0 (-34 to -37); .noise stops at 0 points or a frequency of 0, warns at a single frequency, and computes nothing when the stop is below the start (-38 to -43). Where the number read runs on, ngspice says nothing (-22, -44). So the checks say, place by place, what the number read does there, and never "without a message" where ngspice stops or warns. Here 0<ZWSP>.1m reads 0.

```spice
* a zero-width space inside .tran's step: it reads 0
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 0<ZWSP>.1m 2m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0___.1m 2m
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
      .tran 0___.1m 2m
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

PlainSpice's checks: `invisible-character`.

### invisible-character-29. .tran's stop time read as 0: 'TSTOP is invalid'

```spice
* a zero-width space inside .tran's stop time: it reads 0
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 0.1m 0<ZWSP>.5
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0.1m 0___.5
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
      .tran 0.1m 0___.5
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

PlainSpice's checks: `invisible-character`.

### invisible-character-30. .tran's start time read as no less than the stop time: 'TSTART is invalid'

1<ZWSP>m reads 1, one second, which is not before the stop time of 2 ms.

```spice
* a zero-width space inside .tran's start time: it reads 1 s, after the stop
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 0.1m 2m 1<ZWSP>m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0.1m 2m 1___m
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
      .tran 0.1m 2m 1___m
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

PlainSpice's checks: `invisible-character`.

### invisible-character-31. .tran's stop time read as no more than the start time: the same

1<ZWSP>0 reads 1, one second, which is not after the start time of 2 s; the 10 s meant would be.

```spice
* a zero-width space inside .tran's stop time: it reads 1 s, before the start
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 0.1 1<ZWSP>0 2
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0.1 1___0 2
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
      .tran 0.1 1___0 2
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

PlainSpice's checks: `invisible-character`.

### invisible-character-32. A .dc step read as 0: ngspice 47 says 'Bad syntax!', ngspice 42 never finishes

As a step written 0 (dc-sweep-problems-1): ngspice 47 checks each sweep's step for 0 as it reads the line (inp2dot.c), and 42 keeps sweeping the first point.

```spice
* a zero-width space inside a .dc step: it reads 0
V1 in 0 1
R1 in 0 1k
.dc V1 0 5 0<ZWSP>.5
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .dc v1 0 5 0___.5
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit null)
    rawfile: (did not finish in 20 s: stopped)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `invisible-character`.

### invisible-character-33. A .dc stop read below the start, on a line of one sweep: the sweep has no points, without a message

On a line of two sweeps the sweep never moves instead (invisible-character-54, -55; second critic of the re-check fixes, CR2-4).

1<ZWSP>0 reads 1, below the start of 2, and the step goes up: as dc-sweep-problems-4, ngspice runs no points and says nothing.

```spice
* a zero-width space inside a .dc stop: it reads 1, below the start
V1 in 0 1
R1 in 0 1k
.dc V1 2 1<ZWSP>0 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: a DC transfer characteristic plot with 0 points, its header only (no results)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: a DC transfer characteristic plot with 0 points, its header only (no results)
our engine (wasm), as ngspice -b -r (exit 0, no results):
    vectors: (none)
    diagnostics: rawfile (header without a Binary: or Values: section)
```

PlainSpice's checks: `invisible-character`.

### invisible-character-34. .ac's number of points read as 0: ngspice warns, and runs with points of its own

With dec ngspice runs 31 points from 1 Hz to 1 kHz (10 a decade), with lin 10 points, with oct 100: points of its own, each after the warning.

```spice
* a zero-width space inside .ac's number of points: it reads 0
V1 in 0 AC 1
R1 in out 1k
C1 out 0 1u
.ac dec 0<ZWSP>.5 1 1k
.ac lin 0<ZWSP>.5 1 1k
.ac oct 0<ZWSP>.5 1 1k
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac dec 0___.5 1 1k'
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac lin 0___.5 1 1k'
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac oct 0___.5 1 1k'
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0), which also prints:
    Note: v1: has no value, DC 0 assumed
    rawfile: frequency: 100 points, last 955.4257833336895, v(in): 100 points, last 1, v(out): 100 points, last 0.026999723268978912, i(v1): 100 points, last -0.0009730002767310211; frequency: 10 points, last 1000, v(in): 10 points, last 1, v(out): 10 points, last 0.024704523031857648, i(v1): 10 points, last -0.0009752954769681423; frequency: 31 points, last 1000.000000000002, v(in): 31 points, last 1, v(out): 31 points, last 0.02470452303185754, i(v1): 31 points, last -0.0009752954769681424
ngspice 42, ngspice -b (exit 1):
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac dec 0___.5 1 1k'
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac lin 0___.5 1 1k'
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac oct 0___.5 1 1k'
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0), which also prints:
    Note: v1: has no value, DC 0 assumed
    rawfile: frequency: 100 points, last 955.4257833336895, v(in): 100 points, last 1, v(out): 100 points, last 0.026999723268978912, i(v1): 100 points, last -0.0009730002767310211; frequency: 10 points, last 1000, v(in): 10 points, last 1, v(out): 10 points, last 0.024704523031857648, i(v1): 10 points, last -0.0009752954769681423; frequency: 31 points, last 1000.000000000002, v(in): 31 points, last 1, v(out): 31 points, last 0.02470452303185754, i(v1): 31 points, last -0.0009752954769681424
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: frequency: 100 points, last 955.4257833336895, v(in): 100 points, last 1, v(out): 100 points, last 0.026999723268978912, i(v1): 100 points, last -0.0009730002767310211; frequency: 10 points, last 1000, v(in): 10 points, last 1, v(out): 10 points, last 0.024704523031857648, i(v1): 10 points, last -0.0009752954769681423; frequency: 31 points, last 1000.000000000002, v(in): 31 points, last 1, v(out): 31 points, last 0.02470452303185754, i(v1): 31 points, last -0.0009752954769681424
```

PlainSpice's checks: `invisible-character`, `invisible-character`, `invisible-character`.

### invisible-character-35. .ac's start frequency read as 0: 'AC startfreq <= 0'

Unlike a word ngspice cannot read at all (invisible-character-17), a start read as 0 brings no warning first.

```spice
* a zero-width space inside .ac's start frequency: it reads 0
V1 in 0 AC 1
R1 in out 1k
C1 out 0 1u
.ac dec 10 0<ZWSP>.5 1k
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Note: v1: has no value, DC 0 assumed
    ERROR: AC startfreq <= 0
    doAnalyses: parameter value out of range or the wrong type
    run simulation(s) aborted
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Note: v1: has no value, DC 0 assumed
    ERROR: AC startfreq <= 0
    doAnalyses: parameter value out of range or the wrong type
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `invisible-character`.

### invisible-character-36. .ac's stop frequency read below the start: ngspice warns, and runs up to 1000 times the start

2<ZWSP>0k reads 2, below the start of 100 Hz: ngspice runs from 100 Hz to 100 kHz, as when the stop is no number at all (invisible-character-18).

```spice
* a zero-width space inside .ac's stop frequency: it reads 2, below the start
V1 in 0 AC 1
R1 in out 1k
C1 out 0 1u
.ac dec 10 100 2<ZWSP>0k
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac dec 10 100 2___0k'
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0), which also prints:
    Note: v1: has no value, DC 0 assumed
    rawfile: frequency: 31 points, last 100000.00000000013, v(in): 31 points, last 1, v(out): 31 points, last 0.0000025330231748357815, i(v1): 31 points, last -0.0009999974669768251
ngspice 42, ngspice -b (exit 1):
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac dec 10 100 2___0k'
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0), which also prints:
    Note: v1: has no value, DC 0 assumed
    rawfile: frequency: 31 points, last 100000.00000000013, v(in): 31 points, last 1, v(out): 31 points, last 0.0000025330231748357815, i(v1): 31 points, last -0.0009999974669768251
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: frequency: 31 points, last 100000.00000000013, v(in): 31 points, last 1, v(out): 31 points, last 0.0000025330231748357815, i(v1): 31 points, last -0.0009999974669768251
```

PlainSpice's checks: `invisible-character`.

### invisible-character-37. .ac's start frequency read above the stop: the same

5<ZWSP>k reads 5, above the stop of 1 Hz: ngspice runs from 5 Hz to 5 kHz.

```spice
* a zero-width space inside .ac's start frequency: it reads 5, above the stop
V1 in 0 AC 1
R1 in out 1k
C1 out 0 1u
.ac dec 10 5<ZWSP>k 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac dec 10 5___k 1'
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0), which also prints:
    Note: v1: has no value, DC 0 assumed
    rawfile: frequency: 31 points, last 5000.000000000007, v(in): 31 points, last 1, v(out): 31 points, last 0.0010121862773065427, i(v1): 31 points, last -0.0009989878137226934
ngspice 42, ngspice -b (exit 1):
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac dec 10 5___k 1'
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0), which also prints:
    Note: v1: has no value, DC 0 assumed
    rawfile: frequency: 31 points, last 5000.000000000007, v(in): 31 points, last 1, v(out): 31 points, last 0.0010121862773065427, i(v1): 31 points, last -0.0009989878137226934
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: frequency: 31 points, last 5000.000000000007, v(in): 31 points, last 1, v(out): 31 points, last 0.0010121862773065427, i(v1): 31 points, last -0.0009989878137226934
```

PlainSpice's checks: `invisible-character`.

### invisible-character-38. .noise's number of points read as 0: ngspice warns, then aborts the run

```spice
* a zero-width space inside .noise's number of points: it reads 0
V1 in 0 DC 0 AC 1
R1 in out 1k
R2 out 0 1k
.noise v(out) V1 dec 0<ZWSP>.5 1 1k
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Warning: Number of steps for noise measurement has to be larger than 0,
    but currently is 0
    doAnalyses: parameter value out of range or the wrong type
    run simulation(s) aborted
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Warning: Number of steps for noise measurement has to be larger than 0,
    but currently is 0
    doAnalyses: parameter value out of range or the wrong type
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `invisible-character`.

### invisible-character-39. .noise's start frequency read as 0: 'Frequency of 0 is invalid'

```spice
* a zero-width space inside .noise's start frequency: it reads 0
V1 in 0 DC 0 AC 1
R1 in out 1k
R2 out 0 1k
.noise v(out) V1 dec 10 0<ZWSP>.5 1k
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .noise v(out) v1 dec 10 0___.5 1k
    Frequency of 0 is invalid
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .noise v(out) v1 dec 10 0___.5 1k
    Frequency of 0 is invalid
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

### invisible-character-40. .noise's stop frequency read as 0: the same

```spice
* a zero-width space inside .noise's stop frequency: it reads 0
V1 in 0 DC 0 AC 1
R1 in out 1k
R2 out 0 1k
.noise v(out) V1 dec 10 1 0<ZWSP>.5
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .noise v(out) v1 dec 10 1 0___.5
    Frequency of 0 is invalid
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .noise v(out) v1 dec 10 1 0___.5
    Frequency of 0 is invalid
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

### invisible-character-41. .noise's stop frequency read as the start frequency: ngspice warns, and computes that one frequency

```spice
* a zero-width space inside .noise's stop frequency: it reads 1, the start
V1 in 0 DC 0 AC 1
R1 in out 1k
R2 out 0 1k
.noise v(out) V1 dec 10 1 1<ZWSP>k
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0), which also prints:
    Warning: Noise measurement at a single frequency 1 only!
    rawfile: frequency = 1, onoise_spectrum = 2.8788944172303367e-9, inoise_spectrum = 5.757788834460673e-9
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0), which also prints:
    Warning: Noise measurement at a single frequency 1 only!
    rawfile: frequency = 1, onoise_spectrum = 2.8788944172303367e-9, inoise_spectrum = 5.757788834460673e-9
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: frequency = 1, onoise_spectrum = 2.8788944172303367e-9, inoise_spectrum = 5.757788834460673e-9
```

PlainSpice's checks: `invisible-character`.

### invisible-character-42. .noise's stop frequency read below the start: no frequencies, without a message

2<ZWSP>0k reads 2, below the start of 100 Hz: the results are only the two totals, both 0.

```spice
* a zero-width space inside .noise's stop frequency: it reads 2, below the start
V1 in 0 DC 0 AC 1
R1 in out 1k
R2 out 0 1k
.noise v(out) V1 dec 10 100 2<ZWSP>0k
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(onoise_total) = 0, v(inoise_total) = 0
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(onoise_total) = 0, v(inoise_total) = 0
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(onoise_total) = 0, v(inoise_total) = 0
```

PlainSpice's checks: `invisible-character`.

### invisible-character-43. .noise's start frequency read above the stop: the same

```spice
* a zero-width space inside .noise's start frequency: it reads 5, above the stop
V1 in 0 DC 0 AC 1
R1 in out 1k
R2 out 0 1k
.noise v(out) V1 dec 10 5<ZWSP>k 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(onoise_total) = 0, v(inoise_total) = 0
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(onoise_total) = 0, v(inoise_total) = 0
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(onoise_total) = 0, v(inoise_total) = 0
```

PlainSpice's checks: `invisible-character`.

### invisible-character-44. Numbers read short elsewhere on .tran, .dc, .ac and .noise run on without a message

As for invisible-character-22, each line here is otherwise fine. On a line with a problem of its own (a step of 0, a word it lacks, a source not in the circuit) ngspice does what that problem does, whatever the number reads: the checks then say that problem and claim nothing for the character (invisible-character-61 to -63, space-character-19; second critic of the re-check fixes, CR2-1).

The places invisible-character-22 leaves out, each with a number read short that ngspice can use: .dc's start and step (1<ZWSP>0 reads 1: 20 points), .ac's points and start (1 a decade from 1 Hz: 4 points), .noise's points, start and stop (two .noise lines: 4 points, then 4 points up to 2 Hz), and .tran's step, start time and largest step (1<ZWSP>0u reads 1 s, 1<ZWSP>0m 1 s: a run from 1 s to 2 s). Native 47's time grid differs from 42's and from our engine's; the last time is 2 s in all three.

```spice
* numbers read short that ngspice runs with, without a message
V1 in 0 DC 0 AC 1 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.dc V1 1<ZWSP>0 20 1<ZWSP>0
.ac dec 1<ZWSP>0 1<ZWSP>0 1k
.noise v(out) V1 dec 1<ZWSP>0 1<ZWSP>0 1k
.noise v(out) V1 dec 10 1 2<ZWSP>0k
.tran 1<ZWSP>0u 2 1<ZWSP>0m 1<ZWSP>0u
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: frequency: 4 points, last 999.9999999999995, v(in): 4 points, last 1, v(out): 4 points, last 0.02470452303185767, i(v1): 4 points, last -0.0009752954769681423; v(v-sweep): 20 points, last 20, v(in): 20 points, last 20, v(out): 20 points, last 20, i(v1): 20 points, last 0; time: 61 points, last 2, v(in): 61 points, last 0, v(out): 61 points, last -6.085361329695868e-11, i(v1): 61 points, last -6.085361329695869e-14; frequency: 4 points, last 1.99526231496888, onoise_spectrum: 4 points, last 4.0710516257692375e-9, inoise_spectrum: 4 points, last 4.071371529487329e-9; v(onoise_total) = 4.061525957100633e-9, v(inoise_total) = 4.06175656077321e-9; frequency: 4 points, last 1000.0000000000006, onoise_spectrum: 4 points, last 6.399248452075048e-10, inoise_spectrum: 4 points, last 4.071371529487329e-9; v(onoise_total) = 5.500871983192194e-8, v(inoise_total) = 2.6449023357499975e-7
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: frequency: 4 points, last 999.9999999999995, v(in): 4 points, last 1, v(out): 4 points, last 0.02470452303185767, i(v1): 4 points, last -0.0009752954769681423; v(v-sweep): 20 points, last 20, v(in): 20 points, last 20, v(out): 20 points, last 20, i(v1): 20 points, last 0; time: 61 points, last 2, v(in): 61 points, last 0, v(out): 61 points, last -5.9663064781772616e-12, i(v1): 61 points, last -5.9663064781772615e-15; frequency: 4 points, last 1.99526231496888, onoise_spectrum: 4 points, last 4.0710516257692375e-9, inoise_spectrum: 4 points, last 4.071371529487329e-9; v(onoise_total) = 4.061525957100633e-9, v(inoise_total) = 4.06175656077321e-9; frequency: 4 points, last 1000.0000000000006, onoise_spectrum: 4 points, last 6.399248452075048e-10, inoise_spectrum: 4 points, last 4.071371529487329e-9; v(onoise_total) = 5.500871983192194e-8, v(inoise_total) = 2.6449023357499975e-7
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    in                                           0
    out                                          0
    v1#branch                                    0
    vectors: frequency: 4 points, last 999.9999999999995, v(in): 4 points, last 1, v(out): 4 points, last 0.02470452303185767, i(v1): 4 points, last -0.0009752954769681423; v(v-sweep): 20 points, last 20, v(in): 20 points, last 20, v(out): 20 points, last 20, i(v1): 20 points, last 0; time: 32 points, last 2, v(in): 32 points, last 0, v(out): 32 points, last 6.778194539509261e-11, i(v1): 32 points, last 6.778194539509262e-14; frequency: 4 points, last 1.99526231496888, onoise_spectrum: 4 points, last 4.0710516257692375e-9, inoise_spectrum: 4 points, last 4.071371529487329e-9; v(onoise_total) = 4.061525957100633e-9, v(inoise_total) = 4.06175656077321e-9; frequency: 4 points, last 1000.0000000000006, onoise_spectrum: 4 points, last 6.399248452075048e-10, inoise_spectrum: 4 points, last 4.071371529487329e-9; v(onoise_total) = 5.500871983192194e-8, v(inoise_total) = 2.6449023357499975e-7
```

PlainSpice's checks: `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`.

### invisible-character-45. In a source's PULSE, SIN, PWL, EXP or SFFM, a first number ngspice cannot read: 'parameter value out of range or the wrong type'

Added after the critic of the re-check fixes (12 November 2026, CR1-5): the words of a source's function are no part's value, and ngspice never says "unknown parameter" about the first of them. It reads the numbers of PULSE, SIN, PWL, EXP and SFFM into a list, which ends at a word it cannot read: with no number before that word it says the value is out of range (here), with one it says a number is missing (-46), and after that the word is an unknown parameter (-47). The function does not matter, only how many numbers come before the word: -45 to -47 show PULSE, EXP and PWL; nor does the character, as ngspice writes each byte outside printable ASCII as `_` (W16). A number read short in a function runs on (-51). The checks call the word "a word in V1's PULSE", never V1's value.

```spice
* a zero-width space before PULSE's first number
V1 in 0 PULSE(<ZWSP>0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 0.1m 2m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 in 0 pulse(___0 1 0 1n 1n 1 2)
    parameter value out of range or the wrong type
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 in 0 pulse(___0 1 0 1n 1n 1 2)
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

PlainSpice's checks: `invisible-character`.

### invisible-character-46. After one number: 'no such parameter on this device or parameter is missing' (ngspice 42: 'no such parameter on this device')

```spice
* a zero-width space before EXP's second number
V1 in 0 EXP(0 <ZWSP>1 0 1m 1m 1m)
R1 in out 1k
C1 out 0 1u
.tran 0.1m 2m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 in 0 exp(0 ___1 0 1m 1m 1m)
    no such parameter on this device or parameter is missing
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 in 0 exp(0 ___1 0 1m 1m 1m)
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

PlainSpice's checks: `invisible-character`.

### invisible-character-47. After two numbers or more: 'unknown parameter (___1m)'

```spice
* a zero-width space before PWL's third number
V1 in 0 PWL(0 0 <ZWSP>1m 1)
R1 in out 1k
C1 out 0 1u
.tran 0.1m 2m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 in 0 pwl(0 0 ___1m 1)
      unknown parameter (___1m)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 in 0 pwl(0 0 ___1m 1)
      unknown parameter (___1m)
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

### invisible-character-48. At the start of a source's AC value: 'unknown parameter (___1)'

ngspice gives AC its own value of 1 and phase of 0 first (ac ( 1 0 )), then stops at the word. The checks call it V1's AC value.

```spice
* a zero-width space before the AC value
V1 in 0 1 AC <ZWSP>1
R1 in out 1k
C1 out 0 1u
.ac dec 10 1 1k
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 in 0 1 ac ( 1 0 ) ___1
      unknown parameter (___1)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 in 0 1 ac ( 1 0 ) ___1
      unknown parameter (___1)
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

### invisible-character-49. At the start of the AC phase: the same

```spice
* a zero-width space before the AC phase
V1 in 0 AC 1 <ZWSP>90
R1 in out 1k
C1 out 0 1u
.ac dec 10 1 1k
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 in 0 ac 1 ___90
      unknown parameter (___90)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 in 0 ac 1 ___90
      unknown parameter (___90)
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

### invisible-character-50. At the start of a setting's value: numparam stops, 'Undefined parameter [___2]'

ngspice's numparam reads every name=value of every line before anything else, takes a value that is no number for the name of a parameter, finds none, and stops with a fatal error, whatever the part and the setting: m= on a resistor here, dc= on a source (-52), ic= on a capacitor (-53). The checks call it R1's m value, V1's dc value, C1's ic value.

```spice
* a zero-width space at the start of a resistor's m=
V1 a 0 1
R1 a 0 1k m=<ZWSP>2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error in netlist line no. 4, new internal line no. 3:
    Undefined parameter [___2]
    Error in netlist line no. 4, new internal line no. 3:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Netlist line no. 3:
    Undefined parameter [___2]
    Netlist line no. 3:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `invisible-character`.

### invisible-character-51. Numbers read short in PULSE's, EXP's and SFFM's second number, SIN's frequency, a PWL time still in order, the AC value, m= and ic=: no message

1<ZWSP>0 reads 1 in PULSE, EXP, SFFM, the AC value, m= and ic=; 1<ZWSP>k and 1<ZWSP>m read 1 in SIN and PWL. ngspice says nothing.

Narrowed after the second critic of the re-check fixes (12 November 2026, CR2-3): these are the places this run shows, each read short to a number ngspice can use. The other numbers of the functions, the AC phase and the values written name=value are invisible-character-56. A number read short is not always silent: a PWL time read out of order makes ngspice warn (invisible-character-59), a resistor's r= read as 0 is too small for ngspice 47 (zero-ohm-5), a value at time 0 that differs from a DC value written beside it gets a note, and SFFM weighs its carrier, modulation index and signal frequency against each other. The checks say the first two, and claim nothing for the others.

```spice
* numbers read short in functions, AC values and settings
V1 in 0 DC 0 AC 1<ZWSP>0 PULSE(0 1<ZWSP>0 0 1n 1n 1 2)
V2 a 0 SIN(0 1 1<ZWSP>k)
V3 b 0 PWL(0 0 1<ZWSP>m 1)
V4 c 0 EXP(0 1<ZWSP>0 0 1m 1m 1m)
V5 d 0 SFFM(0 1<ZWSP>0 1k 1 100)
R1 in out 1k m=1<ZWSP>0
C1 out 0 1u ic=1<ZWSP>0
Ra a 0 1k
Rb b 0 1k
Rc c 0 1k
Rd d 0 1k
.tran 0.1m 2m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: time: 78 points, last 0.002, v(in): 78 points, last 1, v(a): 78 points, last 0.012566039883352607, v(b): 78 points, last 0.002, v(c): 78 points, last 0.21831082194880724, v(d): 78 points, last 0.8140296083596738, v(out): 78 points, last 0.8646994810384804, i(v5): 78 points, last -0.0008140296083596738, i(v4): 78 points, last -0.00021831082194880724, i(v3): 78 points, last -0.000002, i(v2): 78 points, last -0.000012566039883352608, i(v1): 78 points, last -0.00013530051896151957
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: time: 78 points, last 0.002, v(in): 78 points, last 1, v(a): 78 points, last 0.012566039883352607, v(b): 78 points, last 0.002, v(c): 78 points, last 0.21831082194880724, v(d): 78 points, last 0.8140296083596738, v(out): 78 points, last 0.8646998098739246, i(v5): 78 points, last -0.0008140296083596738, i(v4): 78 points, last -0.00021831082194880724, i(v3): 78 points, last -0.000002, i(v2): 78 points, last -0.000012566039883352608, i(v1): 78 points, last -0.00013530019012607546
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    in                                           0
    a                                            0
    b                                            0
    c                                            0
    d                                            0
    out                                          0
    v5#branch                                    0
    v4#branch                                    0
    v3#branch                                    0
    v2#branch                                    0
    v1#branch                                    0
    vectors: time: 59 points, last 0.002, v(in): 59 points, last 1, v(a): 59 points, last 0.012566039883352607, v(b): 59 points, last 0.002, v(c): 59 points, last 0.21831082194880724, v(d): 59 points, last 0.8140296083596736, v(out): 59 points, last 0.8646997736181392, i(v5): 59 points, last -0.0008140296083596737, i(v4): 59 points, last -0.00021831082194880724, i(v3): 59 points, last -0.000002, i(v2): 59 points, last -0.000012566039883352608, i(v1): 59 points, last -0.00013530022638186083
```

PlainSpice's checks: `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`.

### invisible-character-52. The same for a source's dc=

```spice
* a zero-width space at the start of a source's dc=
V1 a 0 dc=<ZWSP>5
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error in netlist line no. 3, new internal line no. 2:
    Undefined parameter [___5]
    Error in netlist line no. 3, new internal line no. 2:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Netlist line no. 2:
    Undefined parameter [___5]
    Netlist line no. 2:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `invisible-character`.

### invisible-character-53. The same for a capacitor's ic=

```spice
* a zero-width space at the start of a capacitor's ic=
V1 in 0 1
R1 in out 1k
C1 out 0 1u ic=<ZWSP>1
.tran 0.1m 2m uic
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error in netlist line no. 5, new internal line no. 4:
    Undefined parameter [___1]
    Error in netlist line no. 5, new internal line no. 4:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Netlist line no. 4:
    Undefined parameter [___1]
    Netlist line no. 4:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `invisible-character`.

### invisible-character-54. In two sweeps, a character in the second sweep's stop reads it below the start: that sweep never moves

Added after the second critic of the re-check fixes (12 November 2026, CR2-4). In a line of two sweeps a sweep with no points is no empty result: as dc-sweep-problems-20, ngspice computes the first sweep once, with V2 at its start, 2, and says nothing.

```spice
* a zero-width space inside the second sweep's stop of .dc: it reads 1, below the start of 2
V1 in 0 1
V2 b 0 1
R1 in b 1k
.dc V1 0 5 1 V2 2 1<ZWSP>0 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep): 6 points, last 5, v(in): 6 points, last 5, v(b): 6 points, last 2, i(v2): 6 points, last 0.003, i(v1): 6 points, last -0.003
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep): 6 points, last 5, v(in): 6 points, last 5, v(b): 6 points, last 2, i(v2): 6 points, last 0.003, i(v1): 6 points, last -0.003
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(v-sweep): 6 points, last 5, v(in): 6 points, last 5, v(b): 6 points, last 2, i(v2): 6 points, last 0.003, i(v1): 6 points, last -0.003
```

PlainSpice's checks: `invisible-character`.

### invisible-character-55. In two sweeps, a character in the first sweep's stop reads it below the start: V1 stays at its start

As dc-sweep-problems-21: ngspice keeps V1 at 2 and takes V2 from its second value on (0.5 and 1), without a message.

```spice
* a zero-width space inside the first sweep's stop of .dc: it reads 1, below the start of 2
V1 in 0 1
V2 b 0 1
R1 in b 1k
.dc V1 2 1<ZWSP>0 1 V2 0 1 0.5
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep) = 2, 2, v(in) = 2, 2, v(b) = 0.5, 1, i(v2) = 0.0015, 0.001, i(v1) = -0.0015, -0.001
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep) = 2, 2, v(in) = 2, 2, v(b) = 0.5, 1, i(v2) = 0.0015, 0.001, i(v1) = -0.0015, -0.001
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(v-sweep) = 2, 2, v(in) = 2, 2, v(b) = 0.5, 1, i(v2) = 0.0015, 0.001, i(v1) = -0.0015, -0.001
```

PlainSpice's checks: `invisible-character`.

### invisible-character-56. The other numbers of PULSE, SIN, EXP, SFFM and PWL, the AC phase, and a value written name=value, read short: no message either

Added after the second critic of the re-check fixes (12 November 2026, CR2-3), beside invisible-character-51: each place of each function read short once, several of them to 0 (a pulse width, a period, SIN's frequency, EXP's time constants), PWL's values, the AC phase, the value of a source, a resistor, a capacitor, an inductor and E and F written dc=, r=, resistance=, c=, l= and gain=, and m= and ic= read as 0. ngspice says nothing about any of them (it puts its own numbers in place of a 0 where it needs one). No source here has a DC value beside its function: ngspice notes when the two differ at time 0 (not run here), and SFFM's carrier, modulation index and signal frequency are weighed against each other in a run (it warns of a modulation index past FC/FM), so the checks make no claim there. Written c= and l=, the value is no word ngspice looks up as a model: no model warning, unlike C1 out 0 1<ZWSP>u (invisible-character-7).

```spice
* numbers read short in the other places of PULSE, SIN, EXP, SFFM and PWL, in the AC phase, and in values written name=value
V1 n1 0 PULSE(1<ZWSP>0 1 0 1n 1n 1 2)
V2 n2 0 PULSE(0 1 1<ZWSP>0u 1n 1n 1 2)
V3 n3 0 PULSE(0 1 0 1<ZWSP>0u 1n 1 2)
V4 n4 0 PULSE(0 1 0 1n 1<ZWSP>0u 1 2)
V5 n5 0 PULSE(0 1 0 1n 1n 0<ZWSP>.5m 1m)
V6 n6 0 PULSE(0 1 0 1n 1n 0.2m 0<ZWSP>.5m)
V7 n7 0 PULSE(0 1 0 1n 1n 1 2 4<ZWSP>5)
V8 n8 0 SIN(1<ZWSP>0 1 1k)
V9 n9 0 SIN(0 1 0<ZWSP>.5k)
V10 n10 0 SIN(0 1 1k 1<ZWSP>0u)
V11 n11 0 SIN(0 1 1k 0 1<ZWSP>0)
V12 n12 0 SIN(0 1 1k 0 0 4<ZWSP>5)
V13 n13 0 EXP(1<ZWSP>0 1 0 1m 1m 1m)
V14 n14 0 EXP(0 1 1<ZWSP>0u 1m 1m 1m)
V15 n15 0 EXP(0 1 0 0<ZWSP>.1m 1m 1m)
V16 n16 0 EXP(0 1 0 1m 1<ZWSP>0m 1m)
V17 n17 0 EXP(0 1 0 1m 1m 0<ZWSP>.1m)
V18 n18 0 SFFM(1<ZWSP>0 1 1k 1 100)
V19 n19 0 SFFM(0 1 1k 1 100 1<ZWSP>0u)
V20 n20 0 SFFM(0 1 1k 1 100 0 4<ZWSP>5)
V21 n21 0 SFFM(0 1 1k 1 100 0 0 4<ZWSP>5)
V22 n22 0 PWL(0 1<ZWSP>0 1m 2)
V23 n23 0 PWL(0 0 1m 2<ZWSP>0)
V24 n24 0 DC 1 AC 1 4<ZWSP>5
V25 n25 0 dc=1<ZWSP>0
E1 n26 0 n1 0 gain=1<ZWSP>0
Rln1 n1 0 1k
Rln2 n2 0 1k
Rln3 n3 0 1k
Rln4 n4 0 1k
Rln5 n5 0 1k
Rln6 n6 0 1k
Rln7 n7 0 1k
Rln8 n8 0 1k
Rln9 n9 0 1k
Rln10 n10 0 1k
Rln11 n11 0 1k
Rln12 n12 0 1k
Rln13 n13 0 1k
Rln14 n14 0 1k
Rln15 n15 0 1k
Rln16 n16 0 1k
Rln17 n17 0 1k
Rln18 n18 0 1k
Rln19 n19 0 1k
Rln20 n20 0 1k
Rln21 n21 0 1k
Rln22 n22 0 1k
Rln23 n23 0 1k
Rln24 n24 0 1k
Rln25 n25 0 1k
Rln26 n26 0 1k
I27 0 n27 1m
R27 n27 0 r=1<ZWSP>0
I28 0 n28 1m
R28 n28 0 resistance=1<ZWSP>0
V29 a29 0 PULSE(0 1 0 1n 1n 1 2)
R29 a29 n29 1k
C29 n29 0 c=1<ZWSP>u
V30 a30 0 PULSE(0 1 0 1n 1n 1 2)
R30 a30 n30 1k
L30 n30 0 l=1<ZWSP>m
V31 a31 0 1
Ra31 a31 0 1k
F31 0 n31 V31 gain=1<ZWSP>0
R31 n31 0 1k
I32 0 n32 1m
R32 n32 0 1k m=0<ZWSP>.5
R33 n32 0 1k
V34 a34 0 1
R34 a34 n34 1k
C34 n34 0 1u ic=0<ZWSP>.5
.tran 0.1m 2m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: time: 137 points, last 0.002, v(n1): 137 points, last 1, v(n2): 137 points, last 0, v(n3): 137 points, last 0.002, v(n4): 137 points, last 1, v(n5): 137 points, last 0, v(n6): 137 points, last 0, v(n7): 137 points, last 1, v(n8): 137 points, last 0.9999999999999996, v(n9): 137 points, last -2.4492935982947064e-16, v(n10): 137 points, last 0, v(n11): 137 points, last -4.888799812842442e-16, v(n12): 137 points, last 0.06975647374412403, v(n13): 137 points, last 1, v(n14): 137 points, last 0, v(n15): 137 points, last 0.3678794355686459, v(n16): 137 points, last 0.8504313807773649, v(n17): 137 points, last -0.1495232192928726, v(n18): 137 points, last 1.8140296083596739, v(n19): 137 points, last 0, v(n20): 137 points, last 0.8250528511913956, v(n21): 137 points, last 0.8525628638810873, v(n22): 137 points, last 2, v(n23): 137 points, last 2, v(n24): 137 points, last 1, v(n25): 137 points, last 1, v(n26): 137 points, last 1, v(n27): 137 points, last 0.001, v(n28): 137 points, last 0.001, v(a29): 137 points, last 1, v(n29): 137 points, last 0.0000019999975000526903, v(a30): 137 points, last 1, v(n30): 137 points, last 0.13530293701755625, v(a31): 137 points, last 1, v(n31): 137 points, last -1, v(n32): 137 points, last 1, v(a34): 137 points, last 1, v(n34): 137 points, last 0.9999999999999998, i(v31): 137 points, last -0.001, i(l30): 137 points, last 0.0008646970629824431, i(e1): 137 points, last -0.001, i(v34): 137 points, last -2.168404344971009e-19, i(v30): 137 points, last -0.0008646970629824438, i(v29): 137 points, last -0.0009999980000025, i(v25): 137 points, last -0.001, i(v24): 137 points, last -0.001, i(v23): 137 points, last -0.002, i(v22): 137 points, last -0.002, i(v21): 137 points, last -0.0008525628638810873, i(v20): 137 points, last -0.0008250528511913956, i(v19): 137 points, last 0, i(v18): 137 points, last -0.0018140296083596738, i(v17): 137 points, last 0.0001495232192928726, i(v16): 137 points, last -0.000850431380777365, i(v15): 137 points, last -0.00036787943556864587, i(v14): 137 points, last 0, i(v13): 137 points, last -0.001, i(v12): 137 points, last -0.00006975647374412402, i(v11): 137 points, last 4.888799812842442e-19, i(v10): 137 points, last 0, i(v9): 137 points, last 2.4492935982947063e-19, i(v8): 137 points, last -0.0009999999999999996, i(v7): 137 points, last -0.001, i(v6): 137 points, last 0, i(v5): 137 points, last 0, i(v4): 137 points, last -0.001, i(v3): 137 points, last -0.000002, i(v2): 137 points, last 0, i(v1): 137 points, last -0.001
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: time: 106 points, last 0.002, v(n1): 106 points, last 1, v(n2): 106 points, last 0, v(n3): 106 points, last 0.002, v(n4): 106 points, last 1, v(n5): 106 points, last 0, v(n6): 106 points, last 0, v(n7): 106 points, last 1, v(n8): 106 points, last 0.9999999999999996, v(n9): 106 points, last -2.4492935982947064e-16, v(n10): 106 points, last 0, v(n11): 106 points, last -4.888799812842442e-16, v(n12): 106 points, last 0.06975647374412403, v(n13): 106 points, last 1, v(n14): 106 points, last 0, v(n15): 106 points, last 0.3678794355686459, v(n16): 106 points, last 0.8504313807773649, v(n17): 106 points, last -0.1495232192928726, v(n18): 106 points, last 1.8140296083596739, v(n19): 106 points, last 0.8240423933728557, v(n20): 106 points, last 0.8250528511913956, v(n21): 106 points, last 0.8140296083596738, v(n22): 106 points, last 2, v(n23): 106 points, last 2, v(n24): 106 points, last 1, v(n25): 106 points, last 1, v(n26): 106 points, last 1, v(n27): 106 points, last 0.001, v(n28): 106 points, last 0.001, v(a29): 106 points, last 1, v(n29): 106 points, last 0.0000019999975000446905, v(a30): 106 points, last 1, v(n30): 106 points, last 0.1353027885330249, v(a31): 106 points, last 1, v(n31): 106 points, last -1, v(n32): 106 points, last 1, v(a34): 106 points, last 1, v(n34): 106 points, last 0.9999999999999997, i(v31): 106 points, last -0.001, i(l30): 106 points, last 0.0008646972114669671, i(e1): 106 points, last -0.001, i(v34): 106 points, last -4.336808689942018e-19, i(v30): 106 points, last -0.0008646972114669751, i(v29): 106 points, last -0.0009999980000025, i(v25): 106 points, last -0.001, i(v24): 106 points, last -0.001, i(v23): 106 points, last -0.002, i(v22): 106 points, last -0.002, i(v21): 106 points, last -0.0008140296083596738, i(v20): 106 points, last -0.0008250528511913956, i(v19): 106 points, last -0.0008240423933728556, i(v18): 106 points, last -0.0018140296083596738, i(v17): 106 points, last 0.0001495232192928726, i(v16): 106 points, last -0.000850431380777365, i(v15): 106 points, last -0.00036787943556864587, i(v14): 106 points, last 0, i(v13): 106 points, last -0.001, i(v12): 106 points, last -0.00006975647374412402, i(v11): 106 points, last 4.888799812842442e-19, i(v10): 106 points, last 0, i(v9): 106 points, last 2.4492935982947063e-19, i(v8): 106 points, last -0.0009999999999999996, i(v7): 106 points, last -0.001, i(v6): 106 points, last 0, i(v5): 106 points, last 0, i(v4): 106 points, last -0.001, i(v3): 106 points, last -0.000002, i(v2): 106 points, last 0, i(v1): 106 points, last -0.001
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    n1                                           1
    n2                                           0
    n3                                           0
    n4                                           0
    n5                                           0
    n6                                           0
    n7                                           0
    n8                                           1
    n9                                           0
    n10                                          0
    n11                                          0
    n12                                  0.0697565
    n13                                          1
    n14                                          0
    n15                                          0
    n16                                          0
    n17                                          0
    n18                                          0
    n19                                          0
    n20                                          0
    n21                                          0
    n22                                          1
    n23                                          0
    n24                                          1
    n25                                          1
    n26                                          1
    n27                                      0.001
    n28                                      0.001
    a29                                          0
    n29                                          0
    a30                                          0
    n30                                          0
    a31                                          1
    n31                                         -1
    n32                                          1
    a34                                          1
    n34                                          1
    v31#branch                              -0.001
    l30#branch                                   0
    e1#branch                               -0.001
    v34#branch                                   0
    v30#branch                                   0
    v29#branch                                   0
    v25#branch                              -0.001
    v24#branch                              -0.001
    v23#branch                                   0
    v22#branch                              -0.001
    v21#branch                                   0
    v20#branch                                   0
    v19#branch                                   0
    v18#branch                                   0
    v17#branch                                   0
    v16#branch                                   0
    v15#branch                                   0
    v14#branch                                   0
    v13#branch                              -0.001
    v12#branch                        -6.97565e-05
    v11#branch                                   0
    v10#branch                                   0
    v9#branch                                    0
    v8#branch                               -0.001
    v7#branch                                    0
    v6#branch                                    0
    v5#branch                                    0
    v4#branch                                    0
    v3#branch                                    0
    v2#branch                                    0
    v1#branch                               -0.001
    vectors: time: 65 points, last 0.002, v(n1): 65 points, last 1, v(n2): 65 points, last 0, v(n3): 65 points, last 0.002, v(n4): 65 points, last 1, v(n5): 65 points, last 0, v(n6): 65 points, last 0, v(n7): 65 points, last 1, v(n8): 65 points, last 0.9999999999999996, v(n9): 65 points, last -2.4492935982947064e-16, v(n10): 65 points, last 0, v(n11): 65 points, last -4.888799812842442e-16, v(n12): 65 points, last 0.06975647374412403, v(n13): 65 points, last 1, v(n14): 65 points, last 0, v(n15): 65 points, last 0.3678794355686459, v(n16): 65 points, last 0.8504313807773649, v(n17): 65 points, last -0.1495232192928726, v(n18): 65 points, last 1.8140296083596736, v(n19): 65 points, last 0, v(n20): 65 points, last 0.8250528511913956, v(n21): 65 points, last 0.8525628638810873, v(n22): 65 points, last 2, v(n23): 65 points, last 2, v(n24): 65 points, last 1, v(n25): 65 points, last 1, v(n26): 65 points, last 1, v(n27): 65 points, last 0.001, v(n28): 65 points, last 0.001, v(a29): 65 points, last 1, v(n29): 65 points, last 0.000001999997999985299, v(a30): 65 points, last 1, v(n30): 65 points, last 0.1353046553256334, v(a31): 65 points, last 1, v(n31): 65 points, last -1, v(n32): 65 points, last 1, v(a34): 65 points, last 1, v(n34): 65 points, last 0.9999999999999998, i(v31): 65 points, last -0.001, i(l30): 65 points, last 0.0008646953446743607, i(e1): 65 points, last -0.001, i(v34): 65 points, last -2.168404344971009e-19, i(v30): 65 points, last -0.0008646953446743666, i(v29): 65 points, last -0.0009999980000020001, i(v25): 65 points, last -0.001, i(v24): 65 points, last -0.001, i(v23): 65 points, last -0.002, i(v22): 65 points, last -0.002, i(v21): 65 points, last -0.0008525628638810873, i(v20): 65 points, last -0.0008250528511913956, i(v19): 65 points, last 0, i(v18): 65 points, last -0.0018140296083596736, i(v17): 65 points, last 0.0001495232192928726, i(v16): 65 points, last -0.000850431380777365, i(v15): 65 points, last -0.00036787943556864587, i(v14): 65 points, last 0, i(v13): 65 points, last -0.001, i(v12): 65 points, last -0.00006975647374412402, i(v11): 65 points, last 4.888799812842442e-19, i(v10): 65 points, last 0, i(v9): 65 points, last 2.4492935982947063e-19, i(v8): 65 points, last -0.0009999999999999996, i(v7): 65 points, last -0.001, i(v6): 65 points, last 0, i(v5): 65 points, last 0, i(v4): 65 points, last -0.001, i(v3): 65 points, last -0.000002, i(v2): 65 points, last 0, i(v1): 65 points, last -0.001
```

PlainSpice's checks: `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`, `invisible-character`.

### invisible-character-57. .ac lin with its start read as 0 runs from 0 Hz, without a message

Added after the second critic of the re-check fixes (CR2-1). A start of 0 stops a dec or oct sweep ('AC startfreq <= 0', invisible-character-35), but a lin sweep has no such check (acan.c): it runs its 10 points from 0 Hz, and the note printed is about V1's DC value, not this word.

```spice
* a zero-width space inside the start of a lin .ac sweep: it reads 0
V1 in 0 AC 1
R1 in out 1k
C1 out 0 1u
.ac lin 10 0<ZWSP>.5 1k
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0), which also prints:
    Note: v1: has no value, DC 0 assumed
    rawfile: frequency: 10 points, last 999.9999999999999, v(in): 10 points, last 1, v(out): 10 points, last 0.024704523031857648, i(v1): 10 points, last -0.0009752954769681423
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0), which also prints:
    Note: v1: has no value, DC 0 assumed
    rawfile: frequency: 10 points, last 999.9999999999999, v(in): 10 points, last 1, v(out): 10 points, last 0.024704523031857648, i(v1): 10 points, last -0.0009752954769681423
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: frequency: 10 points, last 999.9999999999999, v(in): 10 points, last 1, v(out): 10 points, last 0.024704523031857648, i(v1): 10 points, last -0.0009752954769681423
```

PlainSpice's checks: `invisible-character`.

### invisible-character-58. A .tran line with two problems: ngspice stops at the first, in its order, here the step read as 0

Added after the second critic of the re-check fixes (CR2-1). ngspice reads the step, then the stop time, then the start time, and stops at the first that is wrong (inp2dot.c): 'TSTEP is invalid', not 'TSTOP'. So the words of a character in the step say what ngspice does even though the stop time is wrong too; the stop time's error (tran-problems-9) shows once the step is fixed.

```spice
* a step read as 0 and a negative stop time: the step is checked first
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 0<ZWSP>.1m -1m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0___.1m -1m
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
      .tran 0___.1m -1m
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

PlainSpice's checks: `invisible-character`.

### invisible-character-59. PWL times read out of order: ngspice warns that the source "has non-increasing PWL time points"

Added after the second critic of the re-check fixes (CR2-3). A PWL's times must rise: ngspice compares each with the one before it as it reads the list (vsrcpar.c, isrcpar.c) and warns, for a voltage source and a current source alike, then runs. So a time read short is said with this warning when it lands out of order, and "without a message" only where the times still rise (invisible-character-51).

```spice
* PWL times read short: 1<ZWSP>m reads 1, after the next time of 2m
V1 a 0 PWL(0 0 1<ZWSP>m 1 2m 0)
Ra a 0 1k
I1 0 b PWL(1<ZWSP>m 0 2m 1m)
Rb b 0 1k
.tran 0.1m 3m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Warning : voltage source v1 has non-increasing PWL time points.
    Warning : current source i1 has non-increasing PWL time points.
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: time: 59 points, last 0.003, v(a): 59 points, last 0, v(b): 59 points, last 0, i(v1): 59 points, last 0
ngspice 42, ngspice -b (exit 1):
    Warning : voltage source v1 has non-increasing PWL time points.
    Warning : current source i1 has non-increasing PWL time points.
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: time: 59 points, last 0.003, v(a): 59 points, last 0, v(b): 59 points, last 0, i(v1): 59 points, last 0
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    a                                            0
    b                                            0
    v1#branch                                    0
    Warning : voltage source v1 has non-increasing PWL time points.
    Warning : current source i1 has non-increasing PWL time points.
    vectors: time: 59 points, last 0.003, v(a): 59 points, last 0, v(b): 59 points, last 0, i(v1): 59 points, last 0
```

PlainSpice's checks: `invisible-character`, `invisible-character`.

### invisible-character-60. A .dc line with two problems: a step read as 0, then a second sweep with no step

Added after the second critic of the re-check fixes (CR2-1). ngspice 47 stops at the first sweep's step ('Bad syntax!') before it reads the second sweep; ngspice 42 never finishes, as with a step of 0 alone (invisible-character-32). The second sweep's missing step shows once the first is fixed.

```spice
* a step read as 0, and a second sweep with no step
V1 in 0 1
V2 b 0 1
R1 in b 1k
.dc V1 0 5 0<ZWSP>.5 V2 0 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .dc v1 0 5 0___.5 v2 0 1
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit null)
    rawfile: (did not finish in 15 s: stopped)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `invisible-character`.

### invisible-character-61. A character in .tran's stop time on a line whose step is 0: the step stops ngspice, whatever the stop reads

Added after the second critic of the re-check fixes (CR2-1). Before, the character check hid the line's own error and said "without a message". The stop time reads 2 here, and would be 2m written as meant: either way the step of 0 stops ngspice ('TSTEP is invalid', tran-problems-2). So the step's error shows, and the character's words make no claim about the line.

```spice
* a step of 0, and a zero-width space inside the stop time
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 0 2<ZWSP>m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0 2___m
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
      .tran 0 2___m
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

PlainSpice's checks: `tran-problems`, `invisible-character`.

### invisible-character-62. A character in a .dc stop on a line that sweeps a source not in the circuit: the source stops ngspice

```spice
* V9 is not in the circuit, and a zero-width space inside the stop
V1 in 0 1
R1 in 0 1k
.dc V9 0 5<ZWSP>0 1
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

PlainSpice's checks: `dc-sweep-problems`, `invisible-character`.

### invisible-character-63. A character in an .ac start on a line with no stop: ngspice warns and assumes its own stop, whatever the start reads

The start reads 1 (it would be 10): ngspice warns that it assumes default parameters and runs up to 1000 times the start, 31 points. The warning is the missing stop's, not the character's.

```spice
* .ac with no stop frequency, and a zero-width space inside the start
V1 in 0 AC 1
R1 in out 1k
C1 out 0 1u
.ac dec 10 1<ZWSP>0
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac dec 10 1___0'
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0), which also prints:
    Note: v1: has no value, DC 0 assumed
    rawfile: frequency: 31 points, last 1000.000000000002, v(in): 31 points, last 1, v(out): 31 points, last 0.02470452303185754, i(v1): 31 points, last -0.0009752954769681424
ngspice 42, ngspice -b (exit 1):
    Warning, ngspice assumes default parameter(s) for ac simulation
        Check your input line '.ac dec 10 1___0'
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0), which also prints:
    Note: v1: has no value, DC 0 assumed
    rawfile: frequency: 31 points, last 1000.000000000002, v(in): 31 points, last 1, v(out): 31 points, last 0.02470452303185754, i(v1): 31 points, last -0.0009752954769681424
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: frequency: 31 points, last 1000.000000000002, v(in): 31 points, last 1, v(out): 31 points, last 0.02470452303185754, i(v1): 31 points, last -0.0009752954769681424
```

PlainSpice's checks: `invisible-character`.

### invisible-character-64. In two sweeps, the second sweep's step read as 0: the same as in one sweep

Added after the second critic of the re-check fixes (12 November 2026, CR2-1, CR2-4): as invisible-character-32 on a line of one sweep, ngspice 47 stops ('Bad syntax!') and ngspice 42 never finishes.

```spice
* a zero-width space inside the second sweep's step: it reads 0
V1 in 0 1
V2 b 0 1
R1 in b 1k
.dc V1 0 5 1 V2 0 1 0<ZWSP>.5
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .dc v1 0 5 1 v2 0 1 0___.5
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit null)
    rawfile: (did not finish in 15 s: stopped)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `invisible-character`.

### invisible-character-65. On a .print line ngspice reads the name with the character as written: ngspice -b finds no such node there

Added after the critic of the names lane, 12 November 2026 (4). As for a letter outside ASCII
(non-ascii-node-3), ngspice leaves .print and .plot lines out of the step that writes such characters as
`_`, so there `ou<ZWSP>t` is not `ou___t`, the node it built: run as `ngspice -b`, it warns that it
can't parse the name and prints nothing for that line, and, with nothing else it can print or save,
runs no analysis (non-ascii-node-13 says when); PlainSpice's run leaves the line out. The check said "without a message" here; now it says
so only when no such line names the node, and its words name the character, never show it.

What PlainSpice shows for invisible-character-65 (warning, line 3):

> **A zero-width space (U+200B) hides in the node name out.** It is a character you cannot see (it often comes with text copied from a web page or a PDF), and SPICE keeps it in the name, so this is a node called ou___t for ngspice.
>
> *ngspice:* ngspice keeps the character in the name, as underscores (ou___t), and makes a separate node: in one test the resistor on it carried no current. On a .print or .plot line it reads the name as written, with the character in it, so it finds no such node there: run as ngspice -b, it warns that it can't parse the name and prints nothing for that line; with nothing else it can print or save, it runs no analysis ("no data saved"). PlainSpice's run leaves .print and .plot lines out (ngspice: ".print line ignored since rawfile was produced."). [invisible-character-3, invisible-character-65]
>
> *Fixes:* "Take it out: name the node out"

```spice
* a zero-width space in a node name, on a .print line
V1 in 0 12
R1 in ou<ZWSP>t 1k
R2 ou<ZWSP>t 0 2k
.dc V1 0 12 6
.print dc v(ou<ZWSP>t)
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Warning: can't parse 'ou<ZWSP>t': ignored
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Error: .print: no dc analysis found.
  ngspice -b -r out.raw (exit 0), which prints instead:
    .print line ignored since rawfile was produced.
    rawfile: v(v-sweep) = 0, 6, 12, v(in) = 0, 6, 12, v(ou___t) = 0, 4, 8, i(v1) = 0, -0.002, -0.004
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    .print line ignored since rawfile was produced.
    vectors: v(v-sweep) = 0, 6, 12, v(in) = 0, 6, 12, v(ou___t) = 0, 4, 8, i(v1) = 0, -0.002, -0.004
after the fix ("Take it out: name the node out"), native 47 and 42 and our engine: ngspice -b prints the v(out) table (exit 0);
  -b -r gives v(out) = 0, 4, 8
```

PlainSpice's checks: `invisible-character`.

### invisible-character-66. In a .control block too: a save of the name saves nothing, and with nothing else saved PlainSpice's run gives no results

Added after the critic of the names lane, 12 November 2026 (4). As non-ascii-node-4 for a letter outside
ASCII: a command for ngspice reads the name as written, so `save v(ou<ZWSP>t)` saves nothing, and with
nothing else to save the analysis does not run, in PlainSpice's run too. The rename used to leave the
.control line as it was, so the fixed netlist still gave no results; it now writes the plain name there
too. When the save also names something ngspice finds, the run goes on (as non-ascii-node-7: `save
v(ou<ZWSP>t) i(v1)`, native 47 and 42 and our engine, -b -r, exit 0, v(v-sweep) and i(v1) saved), and
the check says only that ngspice finds no such node there.

What PlainSpice shows for invisible-character-66 (warning, line 3):

> **A zero-width space (U+200B) hides in the node name out.** It is a character you cannot see (it often comes with text copied from a web page or a PDF), and SPICE keeps it in the name, so this is a node called ou___t for ngspice.
>
> *ngspice:* ngspice keeps the character in the name, as underscores (ou___t), and makes a separate node: in one test the resistor on it carried no current. In a .control block it reads the name as written too, with the character in it, so it finds no such node there: the save of that name saves nothing, and since nothing else is saved, PlainSpice's run gives no results ("no data saved"). [invisible-character-3, invisible-character-66]
>
> *Fixes:* "Take it out: name the node out"

```spice
* a zero-width space in a node name, saved in a .control block
V1 in 0 12
R1 in ou<ZWSP>t 1k
R2 ou<ZWSP>t 0 2k
.dc V1 0 12 6
.control
save v(ou<ZWSP>t)
run
.endc
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1):
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    vectors: (none)
after the fix ("Take it out: name the node out", which now writes out in the save too), native 47 and 42 and our engine,
  -b -r (exit 0): v(v-sweep) = 0, 6, 12, v(out) = 0, 4, 8
```

PlainSpice's checks: `invisible-character`.

### invisible-character-67. A hidden character in a node a formula reads: the fix takes it out there too

```spice
* a zero-width space in a node a formula reads
V1 giris 0 10
R1 giris ou<ZWSP>t 1k
R2 ou<ZWSP>t 0 1k
B1 b 0 V=v(ou<ZWSP>t)*2
Rb b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                1.000000e+01
        ou___t                           5.000000e+00
        giris                            1.000000e+01
        v1#branch                        -5.00000e-03
        b1#branch                        -1.00000e-02
  ngspice -b -r out.raw (exit 0)
    rawfile: v(giris) = 10, v(ou___t) = 5, v(b) = 10, i(b1) = -0.01, i(v1) = -0.005
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(giris) = 10, v(ou___t) = 5, v(b) = 10, i(b1) = -0.01, i(v1) = -0.005
after the fix "Take it out: name the node out" (invisible-character), which writes `R1 giris out 1k`, `R2 out 0 1k`, `B1 b 0 V=v(out)*2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(giris) = 10, v(out) = 5, v(b) = 10, i(b1) = -0.01, i(v1) = -0.005
```

PlainSpice's checks: `invisible-character`.

### invisible-character-68. A name with a zero-width space that only a formula reads is a node nothing connects to: 'singular matrix', and no results

Added after the round-2 critic of the formulas lane (13 November 2026, CR2-2). ngspice keeps the character in the name (out___), as on a part line (invisible-character-3), but no part is on that node, so it warns "singular matrix: check node out___" and stops. Taken out, the formula reads out: e = 5 V.

```spice
* a zero-width space in a name only a formula reads
V1 in 0 5
R1 in out 1k
R2 out 0 1k
B1 e 0 V=v(out<ZWSP>)*2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    DC solution failed -
    Last Node Voltages
    Node                                   Last Voltage        Previous Iter
    ----                                   ------------        -------------
    in                                                0                    0
    out                                               0                    0
    e                                                 0                    0
    out___                                            0                    0
    b1#branch                                         0                    0
    v1#branch                                         0                    5 *
    Warning: singular matrix:  check node out___
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node out___
    Warning: singular matrix:  check node out___
    Warning: singular matrix:  check node out___
    Warning: singular matrix:  check node out___
    Warning: singular matrix:  check node out___
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
    rawfile: (no rawfile data)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
after the fix "Take it out: connect to node out" (invisible-character), which writes `B1 e 0 V=v(out)*2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, i(b1) = -0.005, i(v1) = -0.0025
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
"Make it 10meg" and "Make it 10m (10 mΩ)", never "Write 10M", which is milli (look-alike-letter-4); the milli fix
says what it writes, as nothing is milli there: ngspice reads 10 Ω (re-check, 12 November 2026);
and a node name whose letters outside ASCII all look like Latin ones (`оut` with a Cyrillic о) gets
the fix that writes them plain, which joins it to the node of that name, "Connect to out"
(look-alike-letter-5). After the re-check of those fixes (12 November 2026): on a capacitor or an
inductor ngspice also warns that it can't find a model with the word's name (look-alike-letter-7); a
document's decimal point (a middle dot, a one-dot leader, a small full stop, the Arabic decimal
separator) is no decimal point for SPICE, so 4·7k is 4 Ω (look-alike-letter-9, -13), and only in a
value is it read as one; the letter O where the digit 0 belongs ends the number too, so 1Ok is 1 Ω
(look-alike-letter-10, -11), flagged only where nothing else can be meant (an O between digits, before
a scale letter that ends the word, or at the start before a decimal point; never before a unit, so
100Ом stays as meant); and any other character outside ASCII inside a number, with a digit after it,
ends it as well (look-alike-letter-12), said without a fix, as what was meant is not clear. After the
critic of those fixes (12 November 2026, CR1-8, CR1-9): the letter O is caught with a unit after the
scale letter, with meg, and as a run of Os (`1OkΩ`, `1Omeg`, `1OOk`: look-alike-letter-15), and a lone
A or F after it is the unit, not atto or femto (`1OA` is meant as 10 A), as space-before-suffix reads
them; the words of a resistor read as 0 are zero-ohm's (zero-ohm-4).

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
> *Fixes:* "Make it 10meg (10 MΩ)", "Make it 10m (10 mΩ)"

What PlainSpice shows for look-alike-letter-4 (warning, line 5):

> **R2's value is read as 10 Ω, not 10 MΩ.** The value has the Cyrillic letter М, which looks like M. SPICE knows only the plain letter M, so it ignores this one like a unit. For mega, write meg (a capital M is milli in SPICE): 10meg.
>
> *ngspice:* ngspice stops reading the number at the Cyrillic letter М, without a message: it reads 10 Ω. [look-alike-letter-4, mega-as-milli-1]
>
> *Fixes:* "Make it 10meg (10 MΩ)", "Make it 10m (10 mΩ)"

What PlainSpice shows for look-alike-letter-4 (warning, line 7):

> **R3's value is read as 10 Ω, not 10 MΩ.** The value has the fullwidth letter Ｍ, which looks like M. SPICE knows only the plain letter M, so it ignores this one like a unit. For mega, write meg (a capital M is milli in SPICE): 10meg.
>
> *ngspice:* ngspice stops reading the number at the fullwidth letter Ｍ, without a message: it reads 10 Ω. [look-alike-letter-4, mega-as-milli-1]
>
> *Fixes:* "Make it 10meg (10 MΩ)", "Make it 10m (10 mΩ)"

What PlainSpice shows for look-alike-letter-5 (warning, line 4):

> **The node оut has the Cyrillic letter о.** It looks like o, but SPICE knows only the plain letter o, so this is not the node out the other lines name: it is another node, and the parts on it are not connected to node out.
>
> *ngspice:* ngspice writes the letter's bytes as underscores (__ut) and makes a separate node, without a message: in one test the resistor on it carried no current. [look-alike-letter-5]
>
> *Fixes:* "Connect to node out"

What PlainSpice shows for look-alike-letter-6 (error, line 2):

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

What PlainSpice shows for look-alike-letter-7 (warning, line 4):

> **C1's value is read as 2 F, not 2 kF.** The value has the Cyrillic letter к, which looks like k. SPICE knows only the plain letter k, so it ignores this one like a unit. Write 2k.
>
> *ngspice:* ngspice stops reading the number at the Cyrillic letter к: it reads 2 F, and only warns that it can't find a model with the word's name. [look-alike-letter-1, look-alike-letter-7]
>
> *Fixes:* "Write 2k (2 kF)"

What PlainSpice shows for look-alike-letter-7 (warning, line 6):

> **L1's value is read as 3 H.** The value has the Greek letter Μ, which looks like M. SPICE knows only the plain letter M, so it ignores this one like a unit. For mega, write meg (a capital M is milli in SPICE): 3meg.
>
> *ngspice:* ngspice stops reading the number at the Greek letter Μ: it reads 3 H, and only warns that it can't find a model with the word's name. [look-alike-letter-4, mega-as-milli-1, look-alike-letter-7]
>
> *Fixes:* "Make it 3m (3 mH)", "Make it 3meg (3 MH)"

What PlainSpice shows for look-alike-letter-8 (error, line 4):

> **This value is not a number for SPICE.** It starts with a minus sign (U+2212), which looks like -, so SPICE does not read the word as a number. Write -5.
>
> *ngspice:* ngspice 47 stops: 'Bad syntax!'. ngspice 42 takes the word for the name of a second source to sweep, and stops: 'Voltage source, current source, or resistor named "___5" is not in the circuit'. [invisible-character-12]
>
> *Fixes:* "Write -5"

What PlainSpice shows for look-alike-letter-9 (warning, line 3):

> **R1's value is read as 4 Ω, not 4.7 kΩ.** The value has a middle dot (U+00B7), which some documents use as a decimal point. SPICE knows only the plain decimal point, so it ignores this one like a unit, and the 7k after it. Write 4.7k.
>
> *ngspice:* ngspice stops reading the number at the middle dot (U+00B7), without a message: it reads 4 Ω. [look-alike-letter-9]
>
> *Fixes:* "Write 4.7k (4.7 kΩ)"

What PlainSpice shows for look-alike-letter-10 (warning, line 3):

> **R1's value is read as 1 Ω, not 10 kΩ.** The value has the letter O after the 1, not the digit 0. SPICE stops reading the number at a letter, so it ignores it and the k after it. Write 10k.
>
> *ngspice:* ngspice stops reading the number at the letter O, without a message: it reads 1 Ω. [look-alike-letter-10, look-alike-letter-15]
>
> *Fixes:* "Write 10k (10 kΩ)"

What PlainSpice shows for look-alike-letter-10 (warning, line 7):

> **R3's value is read as 1 Ω, not 1 kΩ.** The value has the Cyrillic letter О after the 1, not the digit 0. SPICE stops reading the number at a letter, so it ignores it and the 00 after it. Write 1000.
>
> *ngspice:* ngspice stops reading the number at the Cyrillic letter О, without a message: it reads 1 Ω. [look-alike-letter-10, look-alike-letter-15]
>
> *Fixes:* "Write 1000 (1 kΩ)"

What PlainSpice shows for look-alike-letter-11 (error, line 3):

> **R1's value starts with the letter O, not the digit 0.** It starts with the letter O, which looks like the digit 0, so SPICE does not read the word as a number. Write 0.47k.
>
> *ngspice:* ngspice stops: 'unknown parameter (o.47k)'. [look-alike-letter-11]
>
> *Fixes:* "Write 0.47k (470 Ω)"

What PlainSpice shows for look-alike-letter-12 (warning, line 3):

> **R1's value is read as 4 Ω.** The value has the character 。 (U+3002), which is no part of a number for SPICE: it stops reading the number there, so the 7k after it does not count.
>
> *ngspice:* ngspice stops reading the number at the character 。 (U+3002), without a message: it reads 4 Ω. [look-alike-letter-12]
>
> *Fixes:* none

What PlainSpice shows for look-alike-letter-15 (warning, line 3):

> **R1's value is read as 1 Ω, not 10 kΩ.** The value has the letter O after the 1, not the digit 0. SPICE stops reading the number at a letter, so it ignores it and the kΩ after it. Write 10kΩ.
>
> *ngspice:* ngspice stops reading the number at the letter O, without a message: it reads 1 Ω. [look-alike-letter-10, look-alike-letter-15]
>
> *Fixes:* "Write 10kΩ (10 kΩ)"

What PlainSpice shows for look-alike-letter-15 (warning, line 7):

> **R3's value is read as 1 Ω, not 100 kΩ.** The value has the letters OO after the 1, not the digits 00. SPICE stops reading the number at a letter, so it ignores them and the k after them. Write 100k.
>
> *ngspice:* ngspice stops reading the number at the letters OO, without a message: it reads 1 Ω. [look-alike-letter-10, look-alike-letter-15]
>
> *Fixes:* "Write 100k (100 kΩ)"

What PlainSpice shows for look-alike-letter-15 (warning, line 10):

> **I5's value is read as 1 A, not 10 A.** The value has the letter O after the 1, not the digit 0. SPICE stops reading the number at a letter, so it ignores it and the A after it. Write 10.
>
> *ngspice:* ngspice stops reading the number at the letter O, without a message: it reads 1 A. [look-alike-letter-10, look-alike-letter-15]
>
> *Fixes:* "Write 10 (10 A)"

### look-alike-letter-7. On a capacitor or an inductor ngspice also warns that it can't find a model: 2к is 2 F, 3Μ is 3 H

Added after the re-check (12 November 2026, S4), as invisible-character-7 for the look-alikes: C1 is 2 F and L1 is 3 H, and ngspice warns about a model called after each word.

```spice
* letters from other alphabets in a capacitor's and an inductor's value
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1
C1 out 0 2к
R2 in b 1
L1 b 0 3Μ
.tran 0.1m 1m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '2к' from line
        c1 out 0 2к
    warning, can't find model '3Μ' from line
        l1 b 0 3Μ
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: time: 81 points, last 0.001, v(in): 81 points, last 1, v(out): 81 points, last 0.0004998747709848901, v(b): 81 points, last 0.9996667223826431, i(l1): 81 points, last 0.00033327761735695444, i(v1): 81 points, last -0.9998334028463721
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '2к' from line
        c1 out 0 2к
    warning, can't find model '3Μ' from line
        l1 b 0 3Μ
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: time: 80 points, last 0.001, v(in): 80 points, last 1, v(out): 80 points, last 0.0004998747709849339, v(b): 80 points, last 0.999666722382643, i(l1): 80 points, last 0.00033327761735696697, i(v1): 80 points, last -0.999833402846372
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    in                                           0
    out                                          0
    b                                            0
    l1#branch                                    0
    v1#branch                                    0
    warning, can't find model '2к' from line
    c1 out 0 2к
    warning, can't find model '3Μ' from line
    l1 b 0 3Μ
    vectors: time: 59 points, last 0.001, v(in): 59 points, last 1, v(out): 59 points, last 0.0004998750208322771, v(b): 59 points, last 0.9996667222160498, i(l1): 59 points, last 0.00033327778395019126, i(v1): 59 points, last -0.9998334027631179
```

PlainSpice's checks: `look-alike-letter` (twice).

### look-alike-letter-8. A minus sign from a document at the start of a .dc sweep's number does what any such character does there: ngspice 47 says 'Bad syntax!'

Added after the re-check (12 November 2026, S2, S5). The same as invisible-character-12: the place, not the character, decides what ngspice says. The dc-sweep-problems check leaves the line to this one, so its fix, Write -5, is the only one, and it runs.

```spice
* a minus sign from a document as the start of a .dc sweep
V1 in 0 1
R1 in 0 1k
.dc V1 −5 5 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .dc v1 ___5 5 1
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "___5" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `look-alike-letter`.

### look-alike-letter-9. A middle dot, a one-dot leader, a small full stop or an Arabic decimal separator is no decimal point: 4·7k is 4 Ω

Added after the re-check (12 November 2026, C5). British documents write 4·7 kΩ with a middle dot; ngspice stops reading the number at each of these, without a message.

```spice
* characters that look like a decimal point, or are one in a document
I1 0 n1 1
R1 n1 0 4·7k
I2 0 n2 1
R2 n2 0 4․7k
I3 0 n3 1
R3 n3 0 4﹒7k
I4 0 n4 1
R4 n4 0 4٫7k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
            n4                               4.000000e+00
            n3                               4.000000e+00
            n2                               4.000000e+00
            n1                               4.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 4, v(n2) = 4, v(n3) = 4, v(n4) = 4
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 4, v(n2) = 4, v(n3) = 4, v(n4) = 4
```

PlainSpice's checks: `look-alike-letter` (four times).

### look-alike-letter-10. The letter O where a zero belongs ends the number: 1Ok, 1оk and 1О00 are 1 Ω; 100Ом (Russian for 100 Ω) is 100 Ω, 10кОм is 10 Ω and 1kОм 1 kΩ

Added after the re-check (12 November 2026, C4). The plain letter O and the Cyrillic о and О read alike: ngspice stops at the letter. The Russian unit Ом is read as meant, after a number (100 Ω) and after a plain k (1 kΩ), so the check never flags an O before a unit; 10кОм is 10 Ω because of the Cyrillic к, which look-alike-letter-1 covers. On a capacitor, 1On is 1 F, with a model warning.

```spice
* the letter O where a zero belongs, and the Russian unit Ом
I1 0 n1 1
R1 n1 0 1Ok
I2 0 n2 1
R2 n2 0 1оk
I3 0 n3 1
R3 n3 0 1О00
I4 0 n4 1
R4 n4 0 100Ом
I5 0 n5 1
R5 n5 0 10кОм
I6 0 n6 1
R6 n6 0 1kОм
C1 n1 0 1On
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
            n6                               1.000000e+03
            n5                               1.000000e+01
            n4                               1.000000e+02
            n3                               1.000000e+00
            n2                               1.000000e+00
            n1                               1.000000e+00
    warning, can't find model '1on' from line
        c1 n1 0 1on
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 1, v(n2) = 1, v(n3) = 1, v(n4) = 100, v(n5) = 10, v(n6) = 1000
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(n1) = 1, v(n2) = 1, v(n3) = 1, v(n4) = 100, v(n5) = 10, v(n6) = 1000
```

PlainSpice's checks: `look-alike-letter` (five times).

### look-alike-letter-11. At the start of a value the letter O makes the word no number: O.47k stops ngspice

Added after the re-check (12 November 2026, C4). The fix writes 0.47k; before, the only fix made O.47k a comment, which left R1 with no value.

```spice
* the letter O at the start of a value
V1 in 0 10
R1 in out O.47k
R2 out 0 10k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model 'o.47k' from line
        r1 in out o.47k
    Error on line 3 or its substitute:
      r1 in out o.47k
      unknown parameter (o.47k)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'o.47k' from line
        r1 in out o.47k
    Error on line 3 or its substitute:
      r1 in out o.47k
      unknown parameter (o.47k)
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

### look-alike-letter-12. Any other character outside ASCII inside a number ends it too: 4。7k, 4•7k and 4·7k (the Greek ano teleia) are 4 Ω

Added after the re-check (12 November 2026, C5): an ideographic full stop (from a Chinese or Japanese keyboard), a bullet and the Greek ano teleia, which looks like a middle dot. What was meant is not clear, so the check says what ngspice reads and offers no fix.

```spice
* characters SPICE does not know inside a number
I1 0 n1 1
R1 n1 0 4。7k
I2 0 n2 1
R2 n2 0 4•7k
I3 0 n3 1
R3 n3 0 4·7k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
            n3                               4.000000e+00
            n2                               4.000000e+00
            n1                               4.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 4, v(n2) = 4, v(n3) = 4
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 4, v(n2) = 4, v(n3) = 4
```

PlainSpice's checks: `look-alike-letter` (three times).

### look-alike-letter-13. At the start of a value a middle dot makes the word no number: ·47k stops ngspice

```spice
* a middle dot at the start of a value
V1 in 0 10
R1 in out ·47k
R2 out 0 10k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    warning, can't find model '·47k' from line
        r1 in out ·47k
    Error on line 3 or its substitute:
      r1 in out __47k
      unknown parameter (__47k)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model '·47k' from line
        r1 in out ·47k
    Error on line 3 or its substitute:
      r1 in out __47k
      unknown parameter (__47k)
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

### look-alike-letter-14. A minus sign from a document as an E's gain: ngspice stops, 'unknown parameter (___2)'

Added after the re-check (12 November 2026, S6), as invisible-character-26.

```spice
* a minus sign from a document as the gain of E
V1 a 0 1
R0 a 0 1k
E1 b 0 a 0 −2
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      e1 b 0 a 0 ___2
      unknown parameter (___2)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      e1 b 0 a 0 ___2
      unknown parameter (___2)
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

### look-alike-letter-15. The letter O for a zero before a unit, meg or another O ends the number too: 1OkΩ, 1Omeg, 1OOk, 1OkOhm and 1OA are 1, 1OuF is 1 F

Added after the critic of the re-check fixes (12 November 2026, CR1-8, CR1-9): the forms students write with a unit, with meg, or with the O twice, read as the 1 before the O, as look-alike-letter-10's do. A lone A or F after the O is a unit, amps or farads: the fix writes 10, since 10A or 10F would be atto or femto for SPICE.

```spice
* the letter O for a zero, with a unit, meg or two Os
I1 0 a 1
R1 a 0 1OkΩ
I2 0 b 1
R2 b 0 1Omeg
I3 0 c 1
R3 c 0 1OOk
I4 0 d 1
R4 d 0 1OkOhm
I5 0 e 1OA
R5 e 0 1
V6 f 0 1
C6 f 0 1OuF
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
            f                                1.000000e+00
            e                                1.000000e+00
            d                                1.000000e+00
            c                                1.000000e+00
            b                                1.000000e+00
            a                                1.000000e+00
            v6#branch                        0.000000e+00
    warning, can't find model '1ouf' from line
        c6 f 0 1ouf
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 1, v(b) = 1, v(c) = 1, v(d) = 1, v(e) = 1, v(f) = 1, i(v6) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    the same messages as ngspice 47
    vectors: v(a) = 1, v(b) = 1, v(c) = 1, v(d) = 1, v(e) = 1, v(f) = 1, i(v6) = 0
```

PlainSpice's checks: `look-alike-letter`, `look-alike-letter`, `look-alike-letter`, `look-alike-letter`, `look-alike-letter`, `look-alike-letter`.

### look-alike-letter-16. On a .print line ngspice reads a look-alike as written: ngspice -b finds no node оut there

Added after the critic of the names lane, 12 November 2026 (4). As for a letter outside ASCII
(non-ascii-node-3): on a .print or .plot line `оut`, with a Cyrillic о, is not `__ut`, the node ngspice
built, so run as `ngspice -b` it warns "can't parse 'оut'", prints nothing for that line, and, with
nothing else it can print or save, runs no analysis (non-ascii-node-13 says when); PlainSpice's run
leaves the line out. The check said
"without a message" here; now it says so only when no such line names the node.

What PlainSpice shows for look-alike-letter-16 (warning, line 3):

> **The node оut has the Cyrillic letter о.** It looks like o, but SPICE knows only the plain letter o, so ngspice calls this node __ut.
>
> *ngspice:* ngspice writes the letter's bytes as underscores (__ut) and makes a separate node: in one test the resistor on it carried no current. On a .print or .plot line it reads the name as written, so it finds no node оut there: run as ngspice -b, it warns "can't parse 'оut'" and prints nothing for that line; with nothing else it can print or save, it runs no analysis ("no data saved"). PlainSpice's run leaves .print and .plot lines out (ngspice: ".print line ignored since rawfile was produced."). [look-alike-letter-5, look-alike-letter-16]
>
> *Fixes:* "Rename node оut to out"

```spice
* a Cyrillic о in a node name, on a .print line
V1 in 0 12
R1 in оut 1k
R2 оut 0 2k
.dc V1 0 12 6
.print dc v(оut)
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Warning: can't parse 'оut': ignored
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Error: .print: no dc analysis found.
  ngspice -b -r out.raw (exit 0), which prints instead:
    .print line ignored since rawfile was produced.
    rawfile: v(v-sweep) = 0, 6, 12, v(in) = 0, 6, 12, v(__ut) = 0, 4, 8, i(v1) = 0, -0.002, -0.004
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    .print line ignored since rawfile was produced.
    vectors: v(v-sweep) = 0, 6, 12, v(in) = 0, 6, 12, v(__ut) = 0, 4, 8, i(v1) = 0, -0.002, -0.004
after the fix ("Rename оut to out"), native 47 and 42 and our engine: ngspice -b prints the v(out) table (exit 0);
  -b -r gives v(out) = 0, 4, 8
```

PlainSpice's checks: `look-alike-letter`.

### look-alike-letter-17. In a .control block too: save v(оut) saves nothing, and with nothing else saved PlainSpice's run gives no results

Added after the critic of the names lane, 12 November 2026 (4). As non-ascii-node-4: `save v(оut)` saves
nothing, and with nothing else to save the analysis does not run, in PlainSpice's run too; the rename
now writes `out` on the .control line too. With something else saved the run goes on (`save v(оut)
i(v1)`, native 47 and 42 and our engine, -b -r, exit 0).

What PlainSpice shows for look-alike-letter-17 (warning, line 3):

> **The node оut has the Cyrillic letter о.** It looks like o, but SPICE knows only the plain letter o, so ngspice calls this node __ut.
>
> *ngspice:* ngspice writes the letter's bytes as underscores (__ut) and makes a separate node: in one test the resistor on it carried no current. In a .control block it reads the name as written too, so it finds no node оut there: save v(оut) saves nothing, and since nothing else is saved, PlainSpice's run gives no results ("no data saved"). [look-alike-letter-5, look-alike-letter-17]
>
> *Fixes:* "Rename node оut to out"

```spice
* a Cyrillic о in a node name, saved in a .control block
V1 in 0 12
R1 in оut 1k
R2 оut 0 2k
.dc V1 0 12 6
.control
save v(оut)
run
.endc
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1):
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    vectors: (none)
after the fix ("Rename оut to out", which now writes out in the save too), native 47 and 42 and our engine,
  -b -r (exit 0): v(v-sweep) = 0, 6, 12, v(out) = 0, 4, 8
```

PlainSpice's checks: `look-alike-letter`.

### look-alike-letter-18. A look-alike letter in a node a formula reads: the fix writes the plain letter there too

```spice
* a Cyrillic o in a node a formula reads
V1 giris 0 10
R1 giris оut 1k
R2 оut 0 1k
B1 b 0 V=v(оut)*2
Rb b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                1.000000e+01
        __ut                             5.000000e+00
        giris                            1.000000e+01
        v1#branch                        -5.00000e-03
        b1#branch                        -1.00000e-02
  ngspice -b -r out.raw (exit 0)
    rawfile: v(giris) = 10, v(__ut) = 5, v(b) = 10, i(b1) = -0.01, i(v1) = -0.005
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(giris) = 10, v(__ut) = 5, v(b) = 10, i(b1) = -0.01, i(v1) = -0.005
after the fix "Rename оut to out" (look-alike-letter), which writes `R1 giris out 1k`, `R2 out 0 1k`, `B1 b 0 V=v(out)*2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(giris) = 10, v(out) = 5, v(b) = 10, i(b1) = -0.01, i(v1) = -0.005
```

PlainSpice's checks: `look-alike-letter`.

### look-alike-letter-19. A name with a Cyrillic о that only a formula reads is a node nothing connects to: 'singular matrix', and no results

Added after the round-2 critic of the formulas lane (13 November 2026, CR2-2). ngspice writes the letter's bytes as underscores (__ut), as on a part line (look-alike-letter-5), but no part is on that node, so it warns "singular matrix: check node __ut" and stops. With the plain letter, the formula reads out: e = 5 V.

```spice
* a Cyrillic o in a name only a formula reads
V1 in 0 5
R1 in out 1k
R2 out 0 1k
B1 e 0 V=v(оut)*2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    DC solution failed -
    Last Node Voltages
    Node                                   Last Voltage        Previous Iter
    ----                                   ------------        -------------
    in                                                0                    0
    out                                               0                    0
    e                                                 0                    0
    __ut                                              0                    0
    b1#branch                                         0                    0
    v1#branch                                         0                    5 *
    Warning: singular matrix:  check node __ut
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node __ut
    Warning: singular matrix:  check node __ut
    Warning: singular matrix:  check node __ut
    Warning: singular matrix:  check node __ut
    Warning: singular matrix:  check node __ut
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
    rawfile: (no rawfile data)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
after the fix "Connect to out" (look-alike-letter), which writes `B1 e 0 V=v(out)*2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, i(b1) = -0.005, i(v1) = -0.0025
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

After the last pass (13 November 2026, code review C3-1): in a B source's formula (a B line's, and an E
or G line's given by `VALUE=`, `vol=` or `cur=`, which ngspice makes a B line) ngspice reads the character
as part of a name, and stops: "unknown parameter (_)", or right after a `v`, "Undefined parameter [v]",
with braces around the formula or not (space-character-22, -23; nbsp-4 for a no-break space). An error, whose fix takes the character out: a
normal space between a `v` and its bracket stops ngspice too (space-character-23). Inside a node's name in
a formula, `v(o<THIN>ut)`, it is that node, and the node's check takes it out there as on the part lines
(space-character-24); the glue check's "Replace it with a normal space" wrote `v(o ut)` there, which
ngspice cannot read.

After the round-1 critic of those fixes (13 November 2026, CR1-2, CR1-4, CR1-5): the check reads the whole
formula, from its start to the end of its last line, and so also finds the character after a number
(`2<THIN>*v(out)`) and at the end (`v(out)*2<THIN>`), which the value checks used to take for part of a
value; one error for the part, whose fix takes every such character out of the formula, so none is left
for ngspice to stop at (nbsp-6). One that keeps a B line's own setting apart from its formula (`tc1=`) becomes
a normal space instead (space-character-30). What ngspice says depends on what stands before the first one:
at the start of the formula "parameter value out of range or the wrong type" (space-character-25), after
an operator or a minus sign "The internal check of parse tree … failed" and then the same (-26), after a
number or the formula's closing brace "unknown parameter (_)" (-27), after an opening bracket, a comma or a
? ngspice 47's fatal "YYparse error" and ngspice 42's "PTerror: syntax error" (-28), after a `v` of its own
"Undefined parameter [v]" (-23; nbsp-5 for a no-break space); anywhere else the check says only that
ngspice stops (-29). Indexes of characters are counted as JavaScript counts them, so an emoji or a math
letter before such a character (𝑥 from an equation editor) no longer stopped every check.

After the re-check of those fixes (12 November 2026): a sign followed by such a character (`-<THIN>5`,
or a minus sign from a document and then one) is no number either, and ngspice stops; the check says
where the character is, as for an invisible one, and its fix writes the sign and the number together,
never "Replace it with a normal space", since `- 5` with a normal space stops ngspice too, at the `-`
(space-character-12 to -14, nbsp-3). After a capital M the milli fix says what it writes, "Make it 1m
(1 mΩ)": ngspice reads neither mega nor milli there.

After the critic of the re-check fixes (12 November 2026, CR1-1, CR1-2): a resistor's value read as 0
gets zero-ohm's words (zero-ohm-4), and on an analysis line a word glued by such a character is one number
for ngspice, cut short at the character, so the glue check says what the place does with the number read
(a `.dc` step of `0<THIN>.5` reads 0: ngspice 47 stops, space-character-16, -17; elsewhere it runs with
it, -18), never "says nothing about it". Its fix is the one that can make the line run: a normal space
where the line lacks a word and the number read does no harm (`.dc V1 0 5<THIN>1`), else taking the
character out (`.dc V1 0 5 0.5`), as a normal space would leave the same number at that place, or one
word too many.

What PlainSpice shows for space-character-16 (error, line 4):

> **A thin space (U+2009) glues "0 .5" into one word.** This line has a thin space (U+2009), which often comes with text copied from a document or a web page. It looks like a space, but SPICE does not treat it as one, so the words on either side become one word.
>
> *ngspice:* ngspice reads the thin space as part of the word, so its number ends there: it reads 0, and a step of 0 stops ngspice 47: 'Bad syntax!'. ngspice 42 never finishes. [space-character-16, space-character-17, invisible-character-32, dc-sweep-problems-1]
>
> *Fixes:* "Take it out: write 0.5"

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
> *Fixes:* "Make it 1meg (1 MΩ)", "Make it 1m (1 mΩ)"

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

> **The node o ut has a thin space (U+2009) in it.** It looks like a space, but SPICE does not treat it as one: it keeps it in the name, so this is not the node out the other lines name but another node, and the parts on it are not connected to node out.
>
> *ngspice:* ngspice keeps the character in the name, as underscores (o___ut), and makes a separate node, without a message: in one test the resistor on it carried no current. [space-character-10]
>
> *Fixes:* "Take it out: connect to node out"

What PlainSpice shows for space-character-10 (warning, line 5):

> **The node o ut has a no-break space (U+00A0) in it.** It looks like a space, but SPICE does not treat it as one: it keeps it in the name, so this is not the node out the other lines name but another node, and the parts on it are not connected to node out.
>
> *ngspice:* ngspice keeps the character in the name, as underscores (o__ut), and makes a separate node, without a message: in one test the resistor on it carried no current. [space-character-10]
>
> *Fixes:* "Take it out: connect to node out"

What PlainSpice shows for space-character-11 (warning, line 3):

> **R1's value is read as 0 Ω.** A thin space (U+2009) sits between 0.000 and 001 (it often comes with text copied from a document or a web page). It looks like a space, but SPICE does not treat it as one: it stops reading the number there, so the 001 after it does not count. Without it, the value reads 0.000001.
>
> *ngspice:* ngspice stops reading the number at the thin space and ignores the rest of the word: it reads 0 Ω, which ngspice 47 cannot use: it uses 1e-12 Ω instead and warns 'Value of resistor r1 is too small, set to 1.000000e-12' (ngspice 42 used 0.001 Ω without a word). [space-character-11, zero-ohm-1, zero-ohm-4]
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

PlainSpice's checks: `space-character`, `space-character`.

What PlainSpice shows for space-character-12 (error, line 2):

> **V1's value is not a number for SPICE.** Right after the -, it has a thin space (U+2009), which looks like a space but is none for SPICE (it often comes with text copied from a document or a web page), so SPICE does not read the word as a number. Write -5.
>
> *ngspice:* ngspice stops: 'unknown parameter (-___5)'. [space-character-12]
>
> *Fixes:* "Write -5 (−5 V)"

What PlainSpice shows for space-character-14 (error, line 2):

> **V1's value is not a number for SPICE.** It starts with a minus sign (U+2212), which looks like -, then a thin space (U+2009), which looks like a space but is none for SPICE (it often comes with text copied from a document or a web page), so SPICE does not read the word as a number. Write -5.
>
> *ngspice:* ngspice stops: 'unknown parameter (______5)'. [space-character-14]
>
> *Fixes:* "Write -5 (−5 V)"

### space-character-12. Right after a sign it makes the word no number: -<THIN>5 stops ngspice

Added after the re-check (12 November 2026, C2). The fix writes -5, which gives −5 V.

```spice
* a thin space right after the minus sign of a value
V1 a 0 -<THIN>5
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

PlainSpice's checks: `space-character`.

### space-character-13. With a normal space after the sign, the sign is a word of its own: V1 a 0 - 5 stops ngspice at the -

Why the fix for space-character-12 never puts a normal space where the character was. The unknown-word check offers Write -5 here.

```spice
* a normal space right after the minus sign of a value
V1 a 0 - 5
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 - 5
      unknown parameter (-)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 - 5
      unknown parameter (-)
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

### space-character-14. A minus sign from a document, then a thin space: −<THIN>5 stops ngspice too

```spice
* a minus sign from a document, then a thin space
V1 a 0 −<THIN>5
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 ______5
      unknown parameter (______5)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 2 or its substitute:
      v1 a 0 ______5
      unknown parameter (______5)
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

### space-character-15. At the start of .tran's stop time a thin space does what a zero-width space does: 'TSTOP is invalid'

Added after the re-check (12 November 2026, S2), as invisible-character-9.

```spice
* a thin space before the stop time of .tran
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 0.1m <THIN>2m
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0.1m ___2m
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
      .tran 0.1m ___2m
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

PlainSpice's checks: `space-character`.

### space-character-16. Inside a number of an analysis line a thin space ends the number: a .dc step of 0<THIN>.5 reads 0, so ngspice 47 says 'Bad syntax!' and ngspice 42 never finishes

Added after the critic of the re-check fixes (12 November 2026, CR1-2). On an analysis line the glue check's words said that ngspice says nothing about the character; but ngspice reads the glued word as one number, cut short at the character, here 0, and a step of 0 stops it as a zero-width space does (invisible-character-32). So on an analysis line the glue check says what the place does with the number read, as the character checks do (invisible-character-28 to -44), and its fix takes the character out: a normal space would keep the 0 at that place.

```spice
* a thin space inside a .dc step: it reads 0
V1 in 0 1
R1 in 0 1k
.dc V1 0 5 0<THIN>.5
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .dc v1 0 5 0___.5
    Bad syntax!
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit null)
    rawfile: (did not finish in 15 s: stopped)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
```

PlainSpice's checks: `space-character`.

### space-character-17. At .tran's stop time the same: 0<THIN>.5 reads 0, 'TSTOP is invalid'

```spice
* a thin space inside .tran's stop time: it reads 0
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 0.1m 0<THIN>.5
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0.1m 0___.5
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
      .tran 0.1m 0___.5
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

PlainSpice's checks: `space-character`.

### space-character-18. Where the number read can be used, ngspice runs with it: a .dc stop of 1<THIN>0 reads 1, two points

The sweep goes from 0 to 1 in steps of 1, not to 10.

```spice
* a thin space inside a .dc stop: it reads 1
V1 in 0 1
R1 in 0 1k
.dc V1 0 1<THIN>0 1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep) = 0, 1, v(in) = 0, 1, i(v1) = 0, -0.001
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 0)
    rawfile: v(v-sweep) = 0, 1, v(in) = 0, 1, i(v1) = 0, -0.001
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(v-sweep) = 0, 1, v(in) = 0, 1, i(v1) = 0, -0.001
```

PlainSpice's checks: `space-character`.

### space-character-19. A thin space in .tran's stop time, as documents write 2 ms, on a line whose step is 0: the step stops ngspice

Added after the second critic of the re-check fixes (CR2-1): as invisible-character-61, the step's error shows beside the thin space's words.

```spice
* a step of 0, and the stop time written 2<thin space>ms
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 0 2<THIN>ms
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      .tran 0 2___ms
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
      .tran 0 2___ms
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

PlainSpice's checks: `tran-problems`, `space-character`.


### space-character-20. On a .print line ngspice reads the name with the character as written: ngspice -b finds no such node there

Added after the critic of the names lane, 12 November 2026 (4). As for a letter outside ASCII
(non-ascii-node-3): on a .print or .plot line `o<THIN>ut` is not `o___ut`, the node ngspice built (its
words end only at an ASCII space or tab), so run as `ngspice -b` it warns that it can't parse the name,
prints nothing for that line, and, with nothing else it can print or save, runs no analysis
(non-ascii-node-13 says when); PlainSpice's run leaves the line out. The check said "without a message" here; now it says so only when no such line
names the node, and its words name the character, never show it.

What PlainSpice shows for space-character-20 (warning, line 3):

> **The node o ut has a thin space (U+2009) in it.** It looks like a space, but SPICE does not treat it as one: it keeps it in the name, so this is a node called o___ut for ngspice.
>
> *ngspice:* ngspice keeps the character in the name, as underscores (o___ut), and makes a separate node: in one test the resistor on it carried no current. On a .print or .plot line it reads the name as written, with the character in it, so it finds no such node there: run as ngspice -b, it warns that it can't parse the name and prints nothing for that line; with nothing else it can print or save, it runs no analysis ("no data saved"). PlainSpice's run leaves .print and .plot lines out (ngspice: ".print line ignored since rawfile was produced."). [space-character-10, space-character-20]
>
> *Fixes:* "Take it out: name the node out"

```spice
* a thin space in a node name, on a .print line
V1 in 0 12
R1 in o<THIN>ut 1k
R2 o<THIN>ut 0 2k
.dc V1 0 12 6
.print dc v(o<THIN>ut)
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Warning: can't parse 'o<THIN>ut': ignored
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Error: .print: no dc analysis found.
  ngspice -b -r out.raw (exit 0), which prints instead:
    .print line ignored since rawfile was produced.
    rawfile: v(v-sweep) = 0, 6, 12, v(in) = 0, 6, 12, v(o___ut) = 0, 4, 8, i(v1) = 0, -0.002, -0.004
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    .print line ignored since rawfile was produced.
    vectors: v(v-sweep) = 0, 6, 12, v(in) = 0, 6, 12, v(o___ut) = 0, 4, 8, i(v1) = 0, -0.002, -0.004
after the fix ("Take it out: name the node out"), native 47 and 42 and our engine: ngspice -b prints the v(out) table (exit 0);
  -b -r gives v(out) = 0, 4, 8
```

The same with a no-break space, `o<NBSP>ut` (ngspice's node `o__ut`; the check's id is `nbsp`), native 47
and 42: `ngspice -b` warns "can't parse 'o<NBSP>ut': ignored" and runs no analysis (exit 1); `-b -r`
leaves the line out and gives v(o__ut) = 0, 4, 8 (exit 0), as our engine does.

PlainSpice's checks: `space-character`.

### space-character-21. In a .control block too: a save of the name saves nothing, and with nothing else saved PlainSpice's run gives no results

Added after the critic of the names lane, 12 November 2026 (4). As non-ascii-node-4: `save v(o<THIN>ut)`
saves nothing (a thin space does not end a word there either), and with nothing else to save the
analysis does not run, in PlainSpice's run too; the rename now writes `out` on the .control line too.

What PlainSpice shows for space-character-21 (warning, line 3):

> **The node o ut has a thin space (U+2009) in it.** It looks like a space, but SPICE does not treat it as one: it keeps it in the name, so this is a node called o___ut for ngspice.
>
> *ngspice:* ngspice keeps the character in the name, as underscores (o___ut), and makes a separate node: in one test the resistor on it carried no current. In a .control block it reads the name as written too, with the character in it, so it finds no such node there: the save of that name saves nothing, and since nothing else is saved, PlainSpice's run gives no results ("no data saved"). [space-character-10, space-character-21]
>
> *Fixes:* "Take it out: name the node out"

```spice
* a thin space in a node name, saved in a .control block
V1 in 0 12
R1 in o<THIN>ut 1k
R2 o<THIN>ut 0 2k
.dc V1 0 12 6
.control
save v(o<THIN>ut)
run
.endc
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1):
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    doAnalyses: not found
    run simulation(s) aborted
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1): the same lines as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error: no data saved for D.C. Transfer curve analysis; analysis not run
    vectors: (none)
after the fix ("Take it out: name the node out", which now writes out in the save too), native 47 and 42 and our engine,
  -b -r (exit 0): v(v-sweep) = 0, 6, 12, v(out) = 0, 4, 8
```

The same with a no-break space, `o<NBSP>ut` (the check's id is `nbsp`), native 47 and 42 and our engine,
`-b -r`: "no data saved for D.C. Transfer curve analysis", exit 1, no results; with the fix, v(out) = 0,
4, 8. With something else saved the run goes on (`save v(o<THIN>ut) i(v1)`, `save v(o<NBSP>ut) i(v1)`:
exit 0, i(v1) saved).

PlainSpice's checks: `space-character`.

### space-character-22. A character that looks like a space in a formula stops ngspice: taken out, the formula runs

In a formula, ngspice reads the character as part of a name (each of its bytes becomes `_`), and the formula has no such name: "unknown parameter (_)". A normal space would do there, but taking it out always does, so the fix takes it out. (ngspice also prints "Preparing expression for numparam" and "What is this?" with the bytes it could not read; those lines are left out below.)

```spice
* a thin space in a formula
V1 in 0 5
R1 in out 1k
R2 out 0 1k
B1 e 0 V=v(out)<THIN>*2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      b1 e 0 v= v(out) _ _ _ *   2.0000000000e+00
      unknown parameter (_)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      b1 e 0 v= v(out) _ _ _ *   2.0000000000e+00
      unknown parameter (_)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
after the fix "Take it out" (space-character), which writes `B1 e 0 V=v(out)*2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, i(b1) = -0.005, i(v1) = -0.0025
```

PlainSpice's checks: `space-character`.

### space-character-23. Between v and its bracket: ngspice takes the v for a .param name, and a normal space would stop it too

Right after `v`, ngspice reads the v as a name of its own: "Undefined parameter [v]". With a normal space there, outside braces, it stops too (`V=v (out)*2`, native 47 and 42 and our engine: "Undefined parameter [v]", "Cannot compute substitute"), so here the fix must take the character out.

```spice
* a thin space between v and its bracket
V1 in 0 5
R1 in out 1k
R2 out 0 1k
B1 e 0 V=v<THIN>(out)*2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error in netlist line no. 7, new internal line no. 5:
    Undefined parameter [v]
    Error in netlist line no. 7, new internal line no. 5:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Netlist line no. 5:
    Undefined parameter [v]
    Netlist line no. 5:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
after the fix "Take it out" (space-character), which writes `B1 e 0 V=v(out)*2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, i(b1) = -0.005, i(v1) = -0.0025
with a normal space there, V=v (out)*2:
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error in netlist line no. 7, new internal line no. 5:
      Undefined parameter [v]
      Cannot compute substitute
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      Undefined parameter [v]
      Cannot compute substitute
      ERROR: fatal error in ngspice, exit(1)
    our engine (exit 1, no results): (none)
```

PlainSpice's checks: `space-character`.

### space-character-24. A character that looks like a space in a node a formula reads: the fix takes it out of the formula too

The node o<THIN>ut, on R1, R2 and in the formula, is one node (ngspice spells it o___ut): b = 10 V. "Take it out: name the node out" writes out in all three, and the circuit is the same. The fix the check offered before for the formula, "Replace it with a normal space", wrote v(o ut), which ngspice cannot read: native 47 "YYparse error, syntax error, in expression", 42 "PTerror: syntax error"; that fix is no longer offered there.

```spice
* a thin space in a node a formula reads
V1 giris 0 10
R1 giris o<THIN>ut 1k
R2 o<THIN>ut 0 1k
B1 b 0 V={v(o<THIN>ut)*2}
Rb b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                1.000000e+01
        o___ut                           5.000000e+00
        giris                            1.000000e+01
        v1#branch                        -5.00000e-03
        b1#branch                        -1.00000e-02
  ngspice -b -r out.raw (exit 0)
    rawfile: v(giris) = 10, v(o___ut) = 5, v(b) = 10, i(b1) = -0.01, i(v1) = -0.005
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(giris) = 10, v(o___ut) = 5, v(b) = 10, i(b1) = -0.01, i(v1) = -0.005
after the fix "Take it out: name the node out" (space-character), which writes `R1 giris out 1k`, `R2 out 0 1k`, `B1 b 0 V={v(out)*2}`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(giris) = 10, v(out) = 5, v(b) = 10, i(b1) = -0.01, i(v1) = -0.005
the netlist the old fix "Replace it with a normal space" wrote, V={v(o ut)*2}:
    ngspice 47, -b -r (exit 1): (no rawfile)
      YYparse error, syntax error, in expression: parsing stopped at line 5
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      PTerror: syntax error, parsing stopped at
      Error on line 5 or its substitute:
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none)
```

PlainSpice's checks: `space-character`.

### space-character-25. At the start of a formula: "parameter value out of range or the wrong type"

Added after the last pass (13 November 2026, round-1 critic of the formulas lane, CR1-4). ngspice reads each byte of the character as a name (`_`), and what it says depends on what stands before it in the formula. Right after V=, I=, VALUE=, vol= or cur=, after the formula's { or quote, or after a + there, it is the first thing of the formula: "parameter value out of range or the wrong type". The fix takes the character out, and the formula runs. (ngspice also prints "Preparing expression for numparam" and "What is this?" with the bytes it could not read; those lines are left out below.)

```spice
* a thin space at the start of a formula
V1 in 0 5
R1 in out 1k
R2 out 0 1k
B1 e 0 V=<THIN>v(out)*2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    oops
    Error on line 5 or its substitute:
      b1 e 0 v= _ _ _ v(out) *   2.0000000000e+00
    parameter value out of range or the wrong type
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    oops
    Error on line 5 or its substitute:
      b1 e 0 v= _ _ _ v(out) *   2.0000000000e+00
    parameter value out of range or the wrong type
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
after the fix "Take it out" (space-character), which writes `B1 e 0 V=v(out)*2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, i(b1) = -0.005, i(v1) = -0.0025
a no-break space there (V=<NBSP>v(out)*2):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after a blank (V= <THIN>v(out)*2):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
in braces (V={<THIN>v(out)*2}):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
on an E line (VALUE={<THIN>v(out)*2}):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
on an E line without braces (VALUE=<THIN>v(out)*2):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
in quotes (vol='<THIN>v(out)*2'):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
on a G line (cur={<THIN>v(out)*2m}):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after a + at the start (V=+<THIN>v(out)*2):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
an ideographic space (V=<IDEO>v(out)*2):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
```

PlainSpice's checks: `space-character`.

### space-character-26. After an operator or a minus sign: "The internal check of parse tree … failed", then "parameter value out of range or the wrong type"

Added after the last pass (13 November 2026, round-1 critic of the formulas lane, CR1-4). After an operator (* / ^ + - < > == && || :), or after a minus sign at the start of the formula, ngspice first says that the internal check of its parse tree failed, with the formula between the two halves of that sentence, and then the same as at the start. The fix takes the character out, and the formula runs.

```spice
* a thin space after an operator in a formula
V1 in 0 5
R1 in out 1k
R2 out 0 1k
B1 e 0 V=v(out)*<THIN>2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    oops
    Error: The internal check of parse tree
    v(out) * _ _ _   2.0000000000e+00
    failed
    Error on line 5 or its substitute:
      b1 e 0 v= v(out) * _ _ _   2.0000000000e+00
    parameter value out of range or the wrong type
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    oops
    Error: The internal check of parse tree
    v(out) * _ _ _   2.0000000000e+00
    failed
    Error on line 5 or its substitute:
      b1 e 0 v= v(out) * _ _ _   2.0000000000e+00
    parameter value out of range or the wrong type
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
after the fix "Take it out" (space-character), which writes `B1 e 0 V=v(out)*2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, i(b1) = -0.005, i(v1) = -0.0025
after + (V=v(out)+<THIN>1):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after - (V=v(out)-<THIN>1):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after / (V=v(out)/<THIN>0.5):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after ^ (V=v(out)^<THIN>1):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after > (V=v(out)><THIN>1?10:0):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after < (V=v(out)<<THIN>1?0:10):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after == (V=v(out)==<THIN>2.5?10:0):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after && (V=v(out)>1&&<THIN>v(in)>1?10:0):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after || (V=v(out)>1||<THIN>v(in)>1?10:0):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after : (V=v(out)>1?10:<THIN>0):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after a minus sign at the start (I=-<THIN>v(out)/1k):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
a no-break space (V=v(out)*<NBSP>2):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
in braces (V={v(out)*<THIN>2}):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
on an E line (VALUE={v(out)*<THIN>2}):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
```

PlainSpice's checks: `space-character`.

### space-character-27. After a number or the formula's closing brace: "unknown parameter (_)"

Added after the last pass (13 November 2026, round-1 critic of the formulas lane, CR1-4). After a number, as after a closing bracket (space-character-22), ngspice has read a whole formula and takes the bytes after it for another of the line's settings: "unknown parameter (_)". Here the character groups the digits of 1000, as documents do: the fix takes it out and writes 1000, and the formula gives e = 2.5 V. The same holds after a number at the end of the formula and after its closing brace.

```spice
* a thin space between the digits of a number in a formula
V1 in 0 5
R1 in out 1k
R2 out 0 1k
B1 e 0 V={1<THIN>000*v(out)/1k}
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      b1 e 0 v=   1.0000000000e+00 _ _ _   0.0000000000e+00 * v(out) /   1.0000000000e+03
      unknown parameter (_)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      b1 e 0 v=   1.0000000000e+00 _ _ _   0.0000000000e+00 * v(out) /   1.0000000000e+03
      unknown parameter (_)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
after the fix "Take it out" (space-character), which writes `B1 e 0 V={1000*v(out)/1k}`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 2.5, i(b1) = -0.0025, i(v1) = -0.0025
after a number before an operator (V=2<THIN>*v(out)):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (_)
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (_)
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after a number at the end (V=v(out)*2<THIN>):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (_)
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (_)
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
a no-break space there (V=v(out)*2<NBSP>):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (_)
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (_)
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after a number with a scale letter (V=v(out)*2m<THIN>*1k):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (_)
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (_)
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after the formula's closing brace (V={v(out)*2}<THIN>):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (_)
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (_)
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after an E's formula in braces (VALUE={v(out)*2}<THIN>):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (_)
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (_)
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after an E's formula without braces (VALUE=v(out)*2<THIN>):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (_)
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (_)
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
```

PlainSpice's checks: `space-character`.

### space-character-28. After a bracket, a comma or a ?: ngspice 47 "YYparse error", a fatal error, and ngspice 42 "PTerror: syntax error"

Added after the last pass (13 November 2026, round-1 critic of the formulas lane, CR1-4). After an opening bracket (not v's), a comma between a function's words or the ? of a choice, ngspice 47 stops with a fatal error, "YYparse error, syntax error, in expression"; ngspice 42 says "PTerror: syntax error" and then "parameter value out of range or the wrong type". Our engine says what ngspice 47 says. A sign there changes nothing. The fix takes the character out, and the formula runs.

```spice
* a thin space after a bracket in a formula
V1 in 0 5
R1 in out 1k
R2 out 0 1k
B1 e 0 V=(<THIN>v(out))*2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    YYparse error, syntax error, in expression: parsing stopped at line 5
        _ _ v(out) ) *   2.0000000000e+00 in  _ v(out) ) *   2.0000000000e+00
    from file    c.cir
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    PTerror: syntax error, parsing stopped at
        _ _ v(out) ) *   2.0000000000e+00
    Error on line 5 or its substitute:
      b1 e 0 v= ( _ _ _ v(out) ) *   2.0000000000e+00
    parameter value out of range or the wrong type
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    YYparse error, syntax error, in expression: parsing stopped at line 5
    _ _ v(out) ) *   2.0000000000e+00 in  _ v(out) ) *   2.0000000000e+00
    from file    /circuit.cir
    ERROR: fatal error in ngspice, exit(1)
    vectors: (none)
after the fix "Take it out" (space-character), which writes `B1 e 0 V=(v(out))*2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, i(b1) = -0.005, i(v1) = -0.0025
after a comma (V=max(v(out),<THIN>1)*2):
    ngspice 47, -b -r (exit 1): (no rawfile)
      YYparse error, syntax error, in expression: parsing stopped at line 5
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      PTerror: syntax error, parsing stopped at
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
a no-break space there (V=max(v(out),<NBSP>1)*2):
    ngspice 47, -b -r (exit 1): (no rawfile)
      YYparse error, syntax error, in expression: parsing stopped at line 5
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      PTerror: syntax error, parsing stopped at
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after a ? (V=v(out)>1?<THIN>10:0):
    ngspice 47, -b -r (exit 1): (no rawfile)
      YYparse error, syntax error, in expression: parsing stopped at line 5
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      PTerror: syntax error, parsing stopped at
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after a sign after a bracket (V=(-<THIN>v(out))*-2):
    ngspice 47, -b -r (exit 1): (no rawfile)
      YYparse error, syntax error, in expression: parsing stopped at line 5
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      PTerror: syntax error, parsing stopped at
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
in braces (V={(<THIN>v(out))*2}):
    ngspice 47, -b -r (exit 1): (no rawfile)
      YYparse error, syntax error, in expression: parsing stopped at line 5
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      PTerror: syntax error, parsing stopped at
      Error on line 5 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
```

PlainSpice's checks: `space-character`.

### space-character-29. Anywhere else in a formula ngspice stops too, with other words

Added after the last pass (13 November 2026, round-1 critic of the formulas lane, CR1-4). After a function's name, before its bracket, ngspice says only "Cannot compute substitute" (a fatal error); after a name it does not know, "Undefined parameter" with that name; after one it knows, "unknown parameter (_)"; inside the V= of a B line, "unknown parameter (v___)". Wherever it stands, ngspice stops: the checks say only that, where no run above shows the words. The fix takes the character out.

```spice
* a thin space after a function's name in a formula
V1 in 0 5
R1 in out 1k
R2 out 0 1k
B1 e 0 V=abs<THIN>(v(out))*2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error in netlist line no. 7, new internal line no. 5:
     Expression err: abs}) _ _ _ ( v(out) ) *   2.0000000000e+00
    Error in netlist line no. 7, new internal line no. 5:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Netlist line no. 5:
     Expression err: abs}) _ _ _ ( v(out) ) *   2.0000000000e+00
    Netlist line no. 5:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
after the fix "Take it out" (space-character), which writes `B1 e 0 V=abs(v(out))*2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, i(b1) = -0.005, i(v1) = -0.0025
after a name it does not know (V=xv<THIN>(out)*2):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error in netlist line no. 7, new internal line no. 5:
      Undefined parameter [xv]
      Cannot compute substitute
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      Undefined parameter [xv]
      Cannot compute substitute
      ERROR: fatal error in ngspice, exit(1)
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after i, before its bracket (V=i<THIN>(V1)*-2k):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error in netlist line no. 7, new internal line no. 5:
      Undefined parameter [i]
      Cannot compute substitute
      ERROR: fatal error in ngspice, exit(1)
    ngspice 42, -b -r (exit 1): (no rawfile)
      Undefined parameter [i]
      Cannot compute substitute
      ERROR: fatal error in ngspice, exit(1)
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
after a name it knows (V=v(out)*2+temper<THIN>*0):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (_)
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (_)
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
between V and = (V<THIN>=v(out)*2):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (v___)
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (v___)
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
```

PlainSpice's checks: `space-character`.

### space-character-30. Between a formula and B's own setting tc1=: the fix writes a normal space there

Added after the last pass (13 November 2026, round-1 critic of the formulas lane, CR1-4). A B line may give settings after its formula (tc1=, tc2=, temp=, dtemp=, reciproctc=), and a blank must keep them apart from it. With a thin space there ngspice stops ("unknown parameter (_)", as after any number: space-character-27); taken out, the formula and tc1 become one word, and ngspice stops again (the second run below). So the fix writes a normal space there, and the line runs.

```spice
* a thin space between a formula and tc1=
V1 in 0 5
R1 in out 1k
R2 out 0 1k
B1 e 0 V=v(out)*2<THIN>tc1=0
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      b1 e 0 v= v(out) *   2.0000000000e+00 _ _ _ tc1=0
      unknown parameter (_)
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 5 or its substitute:
      b1 e 0 v= v(out) *   2.0000000000e+00 _ _ _ tc1=0
      unknown parameter (_)
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
after the fix "Take it out" (space-character), which writes `B1 e 0 V=v(out)*2 tc1=0`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, i(b1) = -0.005, i(v1) = -0.0025
the character taken out (V=v(out)*2tc1=0):
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (1.0000000000e+00)
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error on line 5 or its substitute:
      unknown parameter (1.0000000000e+00)
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
```

PlainSpice's checks: `space-character`.
### space-character-31. A thin space in the name of the source i(...) reads: 'unknown controlling source v___s', after any other such character's message

Added after the round-2 critic of the formulas lane (13 November 2026, CR2-5). Inside the bracket of i(...), a character that looks like a space is part of the source's name: ngspice writes its bytes as _ and finds no source v___s, once the circuit is built ("Fatal error: b1: unknown controlling source v___s", then 47: "doAnalyses: no such parameter on this device or parameter is missing", 42: "... on this device"). The same for a no-break space (v__s) and in an E's formula (be1). As ngspice looks for the source last, any other such character in the formula is what it reports (an operator's below: the parse tree check). Taken out, the formula runs: e = 2.5 V.

```spice
* a thin space in the name of the source i() reads
V1 in 0 5
Vs in mid 0
R1 mid out 1k
R2 out 0 1k
B1 e 0 V=i(V<THIN>s)*1k
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Fatal error: b1: unknown controlling source v___s
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Fatal error: b1: unknown controlling source v___s
    doAnalyses: no such parameter on this device
    run simulation(s) aborted
  ngspice -b -r out.raw (exit 1)
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
after the fix "Take it out" (space-character), which writes `B1 e 0 V=i(Vs)*1k`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(mid) = 5, v(out) = 2.5, v(e) = 2.5, i(b1) = -0.0025, i(vs) = 0.0025, i(v1) = -0.0025
a no-break space, B1 e 0 V=i(V<NBSP>s)*1k:
    ngspice 47 and 42, -b -r (exit 1): (no rawfile)
      Fatal error: b1: unknown controlling source v__s
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
in an E's formula, E1 e 0 VALUE={i(V<THIN>s)*1k}:
    ngspice 47 and 42, -b -r (exit 1): (no rawfile)
      Fatal error: be1: unknown controlling source v___s
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
with another one after an operator, B1 e 0 V=i(V<THIN>s)*<THIN>1k: the operator's message:
    ngspice 47, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 6 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: incomplete or empty netlist
      Error: circuit not parsed.
    ngspice 42, -b -r (exit 1): (no rawfile)
      Error: The internal check of parse tree
      failed
      Error on line 6 or its substitute:
      parameter value out of range or the wrong type
      Simulation interrupted due to error!
      Error: circuit not parsed.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
```

PlainSpice's checks: `space-character`.

### space-character-32. A name with a thin space that only a formula reads is a node nothing connects to: 'singular matrix', and no results

Added after the round-2 critic of the formulas lane (13 November 2026, CR2-2). ngspice keeps the character in the name (o___ut), as on a part line (space-character-10), but here no part is on that node: only B1's formula reads it, so the circuit's matrix has a row of nothing. ngspice warns "singular matrix: check node o___ut" six times and stops ("The operating point could not be simulated successfully"), with any analysis (the rawfile of a .tran or .dc run has no points). The same for an E's formula. Taken out, the formula reads out: e = 5 V.

```spice
* a thin space in a name only a formula reads
V1 in 0 5
R1 in out 1k
R2 out 0 1k
B1 e 0 V=v(o<THIN>ut)*2
Re e 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    DC solution failed -
    Last Node Voltages
    Node                                   Last Voltage        Previous Iter
    ----                                   ------------        -------------
    in                                                0                    0
    out                                               0                    0
    e                                                 0                    0
    o___ut                                            0                    0
    b1#branch                                         0                    0
    v1#branch                                         0                    5 *
    Warning: singular matrix:  check node o___ut
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node o___ut
    Warning: singular matrix:  check node o___ut
    Warning: singular matrix:  check node o___ut
    Warning: singular matrix:  check node o___ut
    Warning: singular matrix:  check node o___ut
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
    rawfile: (no rawfile data)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    the same messages as ngspice 47
    vectors: (none)
after the fix "Take it out: connect to node out" (space-character), which writes `B1 e 0 V=v(out)*2`:
    native 47 and 42 (-b -r, exit 0) and our engine: v(in) = 5, v(out) = 2.5, v(e) = 5, i(b1) = -0.005, i(v1) = -0.0025
in an E's formula, E1 e 0 VALUE={v(out<THIN>)*2}:
    ngspice 47 and 42, -b -r (exit 1): (no rawfile data)
      DC solution failed -
      Warning: singular matrix:  check node out___
      Warning: Dynamic gmin stepping failed
      Warning: True gmin stepping failed
      Warning: source stepping failed
      Error: Transient op failed, timestep too small
      Error: The operating point could not be simulated successfully.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
with .tran 1u 10u instead of .op:
    ngspice 47, -b -r (exit 1): (no rawfile data)
      Error: incomplete or empty netlist
      Warning: singular matrix:  check node o___ut
      Warning: Dynamic gmin stepping failed
      Warning: True gmin stepping failed
      Warning: source stepping failed
      Error: Transient op failed, timestep too small
      Error: The operating point could not be simulated successfully.
      Error: Finding the operating point for transient simulation failed
    ngspice 42, -b -r (exit 1): (no rawfile data)
      Warning: singular matrix:  check node o___ut
      Warning: Dynamic gmin stepping failed
      Warning: True gmin stepping failed
      Warning: source stepping failed
      Error: Transient op failed, timestep too small
      Error: The operating point could not be simulated successfully.
    our engine (exit 1, no results): (none), with the same messages as ngspice 47
```

PlainSpice's checks: `space-character`.
