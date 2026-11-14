# Explanations and results in words: what ngspice does

What PlainSpice's line explanations (`src/spice/explain.ts`) and results in words
(`src/spice/describe.ts`) say about how SPICE behaves, and the runs that show it. Every claim below
has its netlist and what native ngspice 47, native ngspice 42 and our WebAssembly engine printed for
it. Nothing here is from memory, and nothing is claimed about LTspice, which cannot be run here.

How numbers are read (`1M` is a milliohm, `3A` is 3 attoamperes, `10kOhm`, `2k2`, `1,5k` …), how lines
are read (the title, comments, continuation lines, `.end`, `@`) and what each first letter means are
in [numbers-and-syntax.md](numbers-and-syntax.md) (claims N, S, W, V, L); the explanations rely on
those too and name them in the code.

**How it was checked (9 November 2026).** Each netlist was saved as a file and run three ways:

- native ngspice 47, built from the release tarball (the version our engine is compiled from), as
  `ngspice -b file.cir` (the printout) and `ngspice -b -r out.raw file.cir` (every vector at full
  precision, from the binary rawfile);
- native ngspice 42 (Ubuntu's `ngspice 42+ds-3build1` package), the same two ways;
- our engine, which runs exactly `ngspice -b -r /out.raw /circuit.cir` in WebAssembly
  (`src/engine/ngspice.ts`), with the codes `src/engine/diagnostics.ts` gives its messages.

The excerpts are verbatim, with three cuts: the model and device listing and the resource report at
the end of a printout are left out, file paths are shortened to the file name, and ngspice's
"Note: No compatibility mode selected!", "Circuit: …", "Doing analysis at …" and solver lines are
dropped. Plain `ngspice -b` runs no `.dc`, `.tran` or `.ac` without a `.print` line, so for those the
output of the `-r` run is shown instead. Long vectors are summarised (points, first and last value,
largest step); a piecewise-linear source is read at its corners, interpolated linearly between
ngspice's own time points. Complex `.ac` vectors are shown as magnitudes.

**The tests.** `tests/golden/facts-explain.test.ts` runs every netlist here through our engine on
every `npm run test:golden`. It checks the vectors against native ngspice 47 to 6 significant figures,
the messages, the diagnostic codes and whether the run fails. It then checks that what the
explanations predict matches the run (the `.dc` and `.ac` point counts, the largest `.tran` step,
each source's value in `.op`, the numbers in the sentences about V, I, E, F, G and H), and the words
`describe.ts` builds from real runs: currents and their direction, power, the `.tf` words, the
sweeps, and the plain words for each message. The unit tests `tests/unit/spice-explain.test.ts` and
`tests/unit/spice-describe.test.ts` cover the same texts without the engine.

## Summary

**Parts** (section 1)

- A resistor works either way round, and the part lines can come in any order (P1, P2); line 1 is
  always the title (S1 in numbers-and-syntax.md).
- `V1 n1 0 6` means V(n1) − V(0) = 6 V; written `V1 0 n1 6` it makes n1 −6 V; `V6 c d -3` holds c 3 V
  below d (P3). `I1 0 a 3` pushes 3 A from node 0, through the source, into a; `I3 0 c -3` pushes 3 A the
  other way, from c into node 0 (P4). A source .dc sweeps has no one value there (P4b, A7); beside a SIN,
  .op uses the source's value and .tran follows the SIN from time 0 (P3b, P4c).
- E: V(+) − V(−) = gain × (V(c+) − V(c−)). G: gain × (V(c+) − V(c−)) amps from its first node into its
  second. F: gain × the current in its control source, the same way. H: V(+) − V(−) = gain × that
  current (P5–P8). The control source of F and H must be a voltage source: V, E, H or a B line
  with V=, not a resistor, an inductor or a B line with I= (P7, P10, P10b, P10c, P10d). A 0 V source
  is a wire that measures its current (P9).
- In `.op` and `.dc` a capacitor is an open circuit and an inductor a short circuit (P11, P12, A31).
- ngspice 47 turns 0 Ω (and anything below 1e-12 Ω in size) into 1e-12 Ω, or −1e-12 Ω for a negative value,
  with a warning, and currents next to it can come out inaccurate (P13, P24, P24b, P24c; zero-ohm-7, zero-ohm-9
  in traps.md). Any other negative resistance is accepted silently (P14). An R, C or L with
  nothing after its nodes is dropped with a warning (with settings but no value it is kept:
  missing-value-8 to -10 in traps.md); a source with no value is 0, with a note (P15, P15b, P16).
- In `.op`, a PULSE, SIN, PWL or EXP source without a DC value uses its value at time 0 (P17); an AC
  value alone is not a DC value (P16). The arguments of PULSE, SIN, PWL and EXP (P18–P20b). K couples
  two inductors by name (P21). Blank lines are ignored (P22). `ic=` and `uic` (P23).

**Analyses and other dot commands** (section 2)

- `.op` saves every node voltage and the current of every V, E, H and L; `.options savecurrents` adds
  every R, C, L, F, G and I current (A1, A2).
- `.tf v(a) V1` gives v(a)/V1, the input resistance seen by V1 and the output (Thévenin) resistance
  at a, which ngspice calls impedances (A3); a gnd inside `v( )` there is ground, even beside an ordinary
  node called gnd (A3b); a `.tf` written after `.end` runs too, and ngspice names its output in its
  own words, `v(out,mid)` (A3c); the input can be a current source (A4); for a current
  output ngspice's "output impedance" is 1e20 Ω (A5); a `.tf` node that is not in the circuit gives
  0 without a message (A6). An analysis line in a subcircuit the main circuit does not use (no X line
  uses it, or only X lines of such subcircuits) is skipped, as are its parts and dot commands, though
  ngspice still reads an `.include` there; in one the main circuit uses, it runs as the main circuit's,
  once for each X line; `.subckt` and `.ends` lines that do not pair up stop ngspice first (A3f); gnd
  is ground there too (A3g). ngspice names a node inside a subcircuit by its X lines, each followed by
  a dot, and its own name, `x1.m`, `x1.m.1`, and a part there after its first letter, `v.x1.vs`, and a
  `.tf` can use either (A3h).
- `.dc` point counts, including steps like 0.1, ranges the step does not divide, downward sweeps,
  empty sweeps and nested sweeps; `.dc` can sweep V, I, R and TEMP (A7–A15).
- `.tran`: ngspice picks its own time points; the largest step is tstep, or (tstop − tstart)/50 when
  that is smaller, or tmax; results start at tstart (A16–A19). `.ac` point counts for dec, oct and
  lin, and `lin` with 2 points gives 1 (A20–A22b).
- `.param`, `.save`, `.print` and `.plot` (ignored when a results file is written), `.include` and
  `.lib` (no files in the browser), `.control` (runs first), `.meas` (skipped with a results file),
  unknown dot commands (stop; so do `.pss`, `.hb` and `.sens2` in ngspice 47 as built, A29b, A29c),
  `.model` types, `.ic` (A23–A33); dot commands ngspice knows but
  PlainSpice does not explain yet do not stop it (A34); `.subckt` … `.ends` and X lines (A35); a
  `.control` block runs even without an analysis line, but writes nothing to the results file (A36).

**Currents and power** (section 3): a voltage source's current is positive entering at its + node,
so a source whose + side is the higher one reads negative while it delivers power, and one with a
negative value reads positive (C1, C1b, C2); a part's current is positive from its first
node to its second, and a current source reports its value as written (C3); F, G, E, H and B follow
the same rules (C4–C7); savecurrents gives wrong currents for switches in `.op` (C8), and a transistor's
currents named by its terminals, which the words name the same way (C8b); a current that is 0 can
come out as rounding noise of about 10⁻¹⁸ A, far below ngspice's current tolerance abstol, 1 pA (C9–C9c), and
the noise passes on through the parts it drives (C9d), while a tiny current the circuit makes is real
(C9e–C9g).

**Messages** (section 4): no ground, capacitor-only nodes, floating parts, voltage-source loops,
duplicate names, lines that are no part, missing subcircuits and models, models our engine leaves
out, missing fields, `.tf`, `.dc` and `.tran` mistakes, missing inductors, undefined parameters,
unclosed expressions, B lines without V= or I=, and a netlist with no analysis (M1–M21).

**Where native ngspice and our engine differ** (all noted at their claims): a BSIM3 MOSFET runs in
native ngspice but not in our engine, which leaves the chip-design models out (M8); an E line with too
few fields draws "not enough parameters" in native ngspice and a singular matrix in ours (M9); for an
empty `.dc` sweep native ngspice writes a results file with no data, which our rawfile reader rejects
(A11); a PWL source's time points differ slightly (67 points in our engine, 68 in native 47), while the
waveform agrees (P20); native ngspice 47 crashes on two netlists where our engine just stops (M6, M9).

## 1. Parts

What explain.ts says about part lines: which way round sources work, what a capacitor and an inductor do in .op, the source functions for .tran, and what ngspice does with values it cannot use. Spellings of numbers (1M, 3A, 10kOhm, 2k2, 1,5k …) are in numbers-and-syntax.md (N1–N18).

### P1. A resistor works either way round; only the sign of its current changes

R2 is written the other way round, 0 first. The circuit is the same: both nodes sit at 6 V and both sources give 3 A. Only the sign of the resistor's own current (with savecurrents) changes, because SPICE counts it from the first node written to the second.

```spice
* a resistor works either way round
V1 a 0 6
R1 a 0 2
V2 b 0 6
R2 0 b 2
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                6.000000e+00
        a                                6.000000e+00
        @r2[i]                           -3.00000e+00
        @r1[i]                           3.000000e+00
        v1#branch                        -3.00000e+00
        v2#branch                        -3.00000e+00
  rawfile from ngspice -b -r (exit 0): v(a) = 6, v(b) = 6, i(v1) = -3, i(v2) = -3, i(@r1[i]) = 3, i(@r2[i]) = -3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 6, v(b) = 6, i(v1) = -3, i(v2) = -3, i(@r1[i]) = 3, i(@r2[i]) = -3
```

### P2. The order of the part lines does not matter

This is F5 with its part lines in a different order: the numbers are the same as F5's (`tests/fixtures/f5-thevenin-cccs.cir`). Only the part lines move: line 1 is always the title (S1 in numbers-and-syntax.md), and the explanation tells students to put the parts before `.end`, because ngspice still reads a part written after a plain `.end` (S25), which the after-end check explains.

```spice
* the order of the lines does not matter
F1 0 n1 Vx 2
R1 n1 0 4
R2 x n1 2
Vx a x 0
Itest 0 a 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                1.400000e+01
        x                                1.400000e+01
        n1                               1.200000e+01
        vx#branch                        1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(a) = 14, v(x) = 14, v(n1) = 12, i(vx) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 14, v(x) = 14, v(n1) = 12, i(vx) = 1
```

### P3. A voltage source sets V(+ node) − V(− node) to its value

`V1 n1 0 6` makes n1 6 V above ground; written `V2 0 n2 6`, the source makes ground 6 V above n2, so n2 is −6 V. Between two nodes, `V4 a b 6` holds a 6 V above b: a = 10 V, so b = 4 V. A negative value between two nodes holds the + node below the − node by its size: `V6 c d -3` with c = 6 V gives d = 9 V, so c sits 3 V below d (Explain says "So node c sits 3 V below node d.", never "−3 V above": words re-check 12, 12 November 2026).

```spice
* a voltage source sets V(+) - V(-)
V1 n1 0 6
R1 n1 0 2
V2 0 n2 6
R2 n2 0 2
V3 a 0 10
V4 a b 6
R3 b 0 2
V5 c 0 6
V6 c d -3
R4 d 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        d                                9.000000e+00
        c                                6.000000e+00
        b                                4.000000e+00
        a                                1.000000e+01
        n2                               -6.00000e+00
        n1                               6.000000e+00
        v1#branch                        -3.00000e+00
        v2#branch                        -3.00000e+00
        v3#branch                        -2.00000e+00
        v4#branch                        2.000000e+00
        v5#branch                        -4.50000e+00
        v6#branch                        4.500000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 6, v(n2) = -6, v(a) = 10, v(b) = 4, v(c) = 6, v(d) = 9
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 6, v(n2) = -6, v(a) = 10, v(b) = 4, v(c) = 6, v(d) = 9
```

### P4. A current source pushes its current from its first node, through the source, into its second

`I1 0 a 3` pulls 3 A out of ground and pushes it into a, so 3 A flow down through the 4 Ω resistor: a = +12 V. Written `I2 b 0 3`, the current is pulled out of b instead: b = −12 V. A negative value pushes the current the other way: `I3 0 c -3` pulls 3 A out of c and pushes it into ground, so c = −12 V, as for I2 (Explain says "Its value is negative, so the current flows the other way: I3 pushes 3 A from node c, through the source, into ground (node 0).": words re-check 12, 12 November 2026; and the overview "I3: a −3 A current source: its value is negative, so it pushes 3 A from node c into ground.", where it said "pushing current from ground into node c" until the critic of that fix).

```spice
* a current source pushes current from its first node to its second
I1 0 a 3
R1 a 0 4
I2 b 0 3
R2 b 0 4
I3 0 c -3
R3 c 0 4
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        c                                -1.20000e+01
        b                                -1.20000e+01
        a                                1.200000e+01
  rawfile from ngspice -b -r (exit 0): v(a) = 12, v(b) = -12, v(c) = -12
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 12, v(b) = -12, v(c) = -12
```

### P5. E: V(+ node) − V(− node) = gain × (V(control + node) − V(control − node))

E1 makes out1 = 2 × v(c) = 4 V. E2 has its control nodes swapped (0, c), so out2 = 2 × (0 − 2) = −4 V.

```spice
* E: the voltage at out1 is 2 x the voltage at c
V1 c 0 2
E1 out1 0 c 0 2
R1 out1 0 1
E2 out2 0 0 c 2
R2 out2 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out2                             -4.00000e+00
        out1                             4.000000e+00
        c                                2.000000e+00
        v1#branch                        0.000000e+00
        e1#branch                        -4.00000e+00
        e2#branch                        4.000000e+00
  rawfile from ngspice -b -r (exit 0): v(c) = 2, v(out1) = 4, v(out2) = -4
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(c) = 2, v(out1) = 4, v(out2) = -4
```

### P6. G: transconductance × (V(control + node) − V(control − node)) amps, from its first node into its second

G1 pushes 0.5 A per volt of v(c) (2 V), that is 1 A, from ground into out2, so out2 = +1 V across 1 Ω. G2 is written the other way round and pulls the current out of out3: −1 V.

```spice
* G: 0.5 amps for every volt at c, pushed from ground into out2
V1 c 0 2
G1 0 out2 c 0 0.5
R2 out2 0 1
G2 out3 0 c 0 0.5
R3 out3 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out3                             -1.00000e+00
        out2                             1.000000e+00
        c                                2.000000e+00
        v1#branch                        0.000000e+00
  rawfile from ngspice -b -r (exit 0): v(c) = 2, v(out2) = 1, v(out3) = -1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(c) = 2, v(out2) = 1, v(out3) = -1
```

### P7. F: gain × the current in the control source, from its first node into its second

The 0 V source Vs carries the current from c to d: 2 V across Rd = 1 Ω is 2 A, and i(vs) = +2 because the current enters Vs at its + node. F1 pushes 3 × 2 A = 6 A from ground into out3: 6 V across 1 Ω.

```spice
* F: 3 x the current in Vs, pushed from ground into out3
V1 c 0 2
Vs c d 0
Rd d 0 1
F1 0 out3 Vs 3
R3 out3 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out3                             6.000000e+00
        d                                2.000000e+00
        c                                2.000000e+00
        v1#branch                        -2.00000e+00
        vs#branch                        2.000000e+00
  rawfile from ngspice -b -r (exit 0): i(vs) = 2, v(out3) = 6
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: i(vs) = 2, v(out3) = 6
```

### P8. H: V(+ node) − V(− node) = transresistance × the current in the control source

With i(vs) = 2 A as in P7, H1 makes out4 = 4 V per ampere × 2 A = 8 V.

```spice
* H: the voltage at out4 is 4 volts for every amp in Vs
V1 c 0 2
Vs c d 0
Rd d 0 1
H1 out4 0 Vs 4
R4 out4 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out4                             8.000000e+00
        d                                2.000000e+00
        c                                2.000000e+00
        v1#branch                        -2.00000e+00
        vs#branch                        2.000000e+00
        h1#branch                        -8.00000e+00
  rawfile from ngspice -b -r (exit 0): i(vs) = 2, v(out4) = 8
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: i(vs) = 2, v(out4) = 8
```

### P9. A 0 V source is a wire that measures the current through it (the ammeter trick)

Vx sits between a and b like a wire (both are 6 V), and its current is the current in that branch: 3 A, positive because it enters Vx at its + node, a.

```spice
* a 0 V source measures the current in its branch
V1 a 0 6
Vx a b 0
R1 b 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                6.000000e+00
        a                                6.000000e+00
        v1#branch                        -3.00000e+00
        vx#branch                        3.000000e+00
  rawfile from ngspice -b -r (exit 0): v(a) = 6, v(b) = 6, i(vx) = 3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 6, v(b) = 6, i(vx) = 3
```

### P10. F and H cannot read the current of a resistor: unknown controlling source

F1 names the resistor R1 as its control source. ngspice cannot read a resistor's current and stops. ngspice prints this as a "Fatal error" line, which `src/engine/diagnostics.ts` does not classify; `describe.ts` finds it in the output itself.

```spice
* F can only read the current of a voltage source
V1 a 0 6
R1 a 0 2
F1 0 o R1 2
R2 o 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Fatal error: f1: unknown controlling source r1
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Fatal error: f1: unknown controlling source r1
    doAnalyses: no such parameter on this device
    run simulation(s) aborted
  rawfile from ngspice -b -r (exit 1): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Fatal error: f1: unknown controlling source r1
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
  vectors: (none)
  diagnostics: run-aborted
```

### P10b. A controlled voltage source (E or H) works as the control source of F or H, like a V source

E and H sources have a branch current like a voltage source, so F and H can read it: F1 reads i(e1) = −2 A and makes p = −2 V; H2 reads i(h1) = −2 A and makes k = 3 × −2 = −6 V.

```spice
* F reading the current of an E source, H reading the current of an H source
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
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
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
  rawfile from ngspice -b -r (exit 0): i(e1) = -2, v(p) = -2, i(vs) = 1, v(h) = 2, i(h1) = -2, v(k) = -6
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: i(e1) = -2, v(p) = -2, i(vs) = 1, v(h) = 2, i(h1) = -2, v(k) = -6
```

### P10c. An inductor cannot be the control source: unknown controlling source

An inductor has a branch current in the results (A1), but F cannot read it as its control.

```spice
* F reading the current of an inductor
V1 a 0 6
L1 a b 1m
R1 b 0 2
F1 0 o L1 2
R2 o 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Fatal error: f1: unknown controlling source l1
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Fatal error: f1: unknown controlling source l1
    doAnalyses: no such parameter on this device
    run simulation(s) aborted
  rawfile from ngspice -b -r (exit 1): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Fatal error: f1: unknown controlling source l1
    doAnalyses: no such parameter on this device or parameter is missing
    run simulation(s) aborted
  vectors: (none)
  diagnostics: run-aborted
```

### P10d. A B line with V= works as the control source too; a B line with I= does not

B1 with V= is a voltage source with a branch current, so F2 reads it like a V source. B1 delivers 2 A into Rc, so its current reads −2 A (positive entering at the + node, as for a V source in C1), and F2 pushes that −2 A from ground into q: v(q) = −2 V. A B line with I= has no current to read: control-source-5 in traps.md shows the singular matrix.

```spice
* F reading a B source with V=
V1 a 0 6
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
        a                                6.000000e+00
        v1#branch                        0.000000e+00
        b1#branch                        -2.00000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(c) = 12, v(q) = -2, i(b1) = -2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(c) = 12, v(q) = -2, i(b1) = -2
```

### P11. In .op a capacitor is an open circuit: no current flows through it

R1 and R2 form a divider, 6 V × 4/6 = 4 V at b, exactly as if C1 were not there; C1's current is 0 and the source gives 6 V / 6 Ω = 1 A.

```spice
* in .op a capacitor is an open circuit
V1 a 0 6
R1 a b 2
C1 b 0 1u
R2 b 0 4
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                4.000000e+00
        a                                6.000000e+00
        @r2[i]                           1.000000e+00
        @c1[i]                           0.000000e+00
        @r1[i]                           1.000000e+00
        v1#branch                        -1.00000e+00
  rawfile from ngspice -b -r (exit 0): v(a) = 6, v(b) = 4, i(v1) = -1, i(@c1[i]) = 0, i(@r2[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 6, v(b) = 4, i(v1) = -1, i(@c1[i]) = 0, i(@r2[i]) = 1
```

### P12. In .op an inductor is a short circuit: both ends sit at the same voltage

b and c sit at the same voltage, 4 V, so L1 has no voltage across it, and the divider R1, R2 carries 1 A through L1.

```spice
* in .op an inductor is a short circuit
V1 a 0 6
R1 a b 2
L1 b c 1m
R2 c 0 4
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        c                                4.000000e+00
        b                                4.000000e+00
        a                                6.000000e+00
        v1#branch                        -1.00000e+00
        l1#branch                        1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(b) = 4, v(c) = 4, i(l1) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(b) = 4, v(c) = 4, i(l1) = 1
```

### P13. ngspice 47 cannot use 0 Ω: it warns and uses 1e-12 Ω (ngspice 42 silently used 1 mΩ)

ngspice 47 replaces the 0 Ω by 1e-12 Ω and warns. The node voltages are right, but the source current comes out as 5.859 mA instead of 6 mA: a resistance that small makes the current inaccurate. ngspice 42 instead used 1 mΩ silently.

```spice
* a 0 ohm resistor
V1 a 0 6
R1 a b 0
R2 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                6.000000e+00
        a                                6.000000e+00
        v1#branch                        -5.85938e-03
    Warning: Value of resistor r1 is too small, set to 1.000000e-12
  rawfile from ngspice -b -r (exit 0): v(b) = 5.999999999999994, i(v1) = -0.005859375
ngspice 42, ngspice -b (exit 0):
        b                                5.999994e+00
        a                                6.000000e+00
        v1#branch                        -5.99999e-03
  rawfile from ngspice -b -r (exit 0): v(b) = 5.999994000006, i(v1) = -0.005999994000376319
our engine (wasm), as ngspice -b -r (exit 0):
    Warning: Value of resistor r1 is too small, set to 1.000000e-12
  vectors: v(b) = 5.999999999999994, i(v1) = -0.005859375
  diagnostics: resistor-too-small (r1)
```

### P14. A negative resistance such as −2 Ω is accepted without a message

1 A into a −2 Ω resistor gives −2 V, with no message. One closer to 0 than 1e-12 Ω is the exception: ngspice 47
warns and uses −1e-12 Ω instead, where ngspice 42 keeps it without a word (zero-ohm-7 in traps.md; both keep
exactly −1e-12 Ω, P24c).

```spice
* a negative resistance is accepted without a message
I1 0 n1 1
R1 n1 0 -2
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

### P15. A resistor with no value is dropped, with a warning

ngspice drops R1 and says so; the circuit is then V1 and R0 alone (2 A).

```spice
* a resistor with no value
V1 a 0 6
R0 a 0 3
R1 a 0
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                6.000000e+00
        v1#branch                        -2.00000e+00
    Warning: 'r1 a 0' is not a valid resistor instance line, ignored!
  rawfile from ngspice -b -r (exit 0): v(a) = 6, i(v1) = -2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    Warning: 'r1 a 0' is not a valid resistor instance line, ignored!
  vectors: v(a) = 6, i(v1) = -2
  diagnostics: line-ignored (resistor)
```

### P15b. A capacitor or an inductor with no value is dropped too

The same happens to C1 and L1: both are dropped, and b is the divider R1, R2 alone (4 V).

```spice
* a capacitor and an inductor with no value
V1 a 0 6
R1 a b 2
C1 b 0
L1 b c
R2 b 0 4
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                4.000000e+00
        a                                6.000000e+00
        v1#branch                        -1.00000e+00
    Warning: 'c1 b 0' is not a valid capacitor instance line, ignored!
    Warning: 'l1 b c' is not a valid inductor instance line, ignored!
  rawfile from ngspice -b -r (exit 0): v(b) = 4
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    Warning: 'c1 b 0' is not a valid capacitor instance line, ignored!
    Warning: 'l1 b c' is not a valid inductor instance line, ignored!
  vectors: v(b) = 4
  diagnostics: line-ignored (capacitor), line-ignored (inductor)
```

### P16. A source with no DC value is 0 in .op, with a note; an AC value alone is not a DC value

A source with no value is 0 V (or 0 A), with a note. `AC 1` alone is no DC value either: the note says so for V2 too.

```spice
* a source with no DC value
V1 a 0
R1 a 0 1
V2 b 0 AC 1
R2 b 0 1
I1 0 c
R3 c 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        c                                0.000000e+00
        b                                0.000000e+00
        a                                0.000000e+00
        v1#branch                        0.000000e+00
        v2#branch                        0.000000e+00
    Note: i1: has no value, DC 0 assumed
    Note: v2: has no value, DC 0 assumed
    Note: v1: has no value, DC 0 assumed
  rawfile from ngspice -b -r (exit 0): v(a) = 0, v(b) = 0, v(c) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    Note: i1: has no value, DC 0 assumed
    Note: v2: has no value, DC 0 assumed
    Note: v1: has no value, DC 0 assumed
  vectors: v(a) = 0, v(b) = 0, v(c) = 0
  diagnostics: no-value-dc0 (i1), no-value-dc0 (v2), no-value-dc0 (v1)
```

### P17. In .op a PULSE, SIN, PWL or EXP source without a DC value uses its value at time 0

Without a DC value, each source uses its value at time 0: the PULSE starts at 1 V, the SIN at its offset 2 V, the PWL at 4 V, the EXP at 3 V. No message.

```spice
* in .op a PULSE, SIN, PWL or EXP source uses its value at time 0
V1 a 0 PULSE(1 3 1m 1m 2m 3m 10m)
R1 a 0 1
V2 b 0 SIN(2 1 1k)
R2 b 0 1
V3 c 0 PWL(0 4 1m 5)
R3 c 0 1
V4 d 0 EXP(3 5 1m 1m)
R4 d 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        d                                3.000000e+00
        c                                4.000000e+00
        b                                2.000000e+00
        a                                1.000000e+00
        v1#branch                        -1.00000e+00
        v2#branch                        -2.00000e+00
        v3#branch                        -4.00000e+00
        v4#branch                        -3.00000e+00
  rawfile from ngspice -b -r (exit 0): v(a) = 1, v(b) = 2, v(c) = 4, v(d) = 3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 1, v(b) = 2, v(c) = 4, v(d) = 3
```

### P18. PULSE(V1 V2 TD TR TF PW PER): start value, pulse value, delay, rise time, fall time, width, period

The source is 1 V until the delay (1 ms), rises to 3 V in 1 ms, stays there for the width (3 ms, until 5 ms), falls back in 2 ms (at 1 V from 7 ms), and starts again one period (10 ms) after the first start, at 11 ms. The values below are read off ngspice's own time points (which include these corners), interpolated linearly in between.

```spice
* PULSE(V1 V2 TD TR TF PW PER)
V1 a 0 PULSE(1 3 1m 1m 2m 3m 10m)
R1 a 0 1
.tran 0.1m 13m
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    a                                            1
    v1#branch                                   -1
    No. of Data Rows : 156
  rawfile: time: 156 points from 0 to 0.013000000000000001, largest step 0.0001, v(a) at time 0, 0.001, 0.002, 0.005, 0.006, 0.007, 0.011, 0.012 s: 1, 1, 3, 3, 2, 1, 1, 3
ngspice 42: the same output, exit code and summary as ngspice 47; 7 of its 156 time points differ slightly:
  each is the last point before a corner of the pulse or the end (0.000928 s where 47 has 0.000914 s,
  before the corner at 1 ms), with v(a) on the same pulse at each
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    a                                            1
    v1#branch                                   -1
    No. of Data Rows : 156
  vectors: time: 156 points from 0 to 0.013000000000000001, largest step 0.0001, v(a) at time 0, 0.001, 0.002, 0.005, 0.006, 0.007, 0.011, 0.012 s: 1, 1, 3, 3, 2, 1, 1, 3
```

### P19. SIN(VO VA FREQ TD): offset, amplitude, frequency, delay

Before the delay (1 ms) the source stays at its offset, 1 V. Then it swings 2 V above and below it at 1 kHz: 3 V at 1.25 ms, −1 V at 1.75 ms.

```spice
* SIN(VO VA FREQ TD)
V1 a 0 SIN(1 2 1k 1m)
R1 a 0 1
.tran 1u 2m
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    a                                            1
    v1#branch                                   -1
    No. of Data Rows : 2008
  rawfile: time: 2008 points from 0 to 0.002, largest step 0.000001, v(a) at time 0, 0.0005, 0.001, 0.00125, 0.0015, 0.00175, 0.002 s: 1, 1, 1.00253337901, 2.99999204116, 0.999999992666, -0.999992041161, 1
ngspice 42: the same output, exit code and summary as ngspice 47, and the same rawfile values except one
  time point near the end (0.00199928 s where 47 has 0.00199914 s)
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    a                                            1
    v1#branch                                   -1
    No. of Data Rows : 2008
  vectors: time: 2008 points from 0 to 0.002, largest step 0.000001, v(a) at time 0, 0.0005, 0.001, 0.00125, 0.0015, 0.00175, 0.002 s: 1, 1, 1.00253337901, 2.99999204116, 0.999999992666, -0.999992041161, 1
```

### P19b. SIN: the sixth number, PHASE, shifts the wave (in degrees)

With a phase of 90°, the wave starts at the top of its swing: 1 V at time 0, 0 V a quarter period later.

```spice
* SIN with a phase of 90 degrees
V1 a 0 SIN(0 1 1k 0 0 90)
R1 a 0 1
.tran 1u 1m
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    a                                            1
    v1#branch                                   -1
    No. of Data Rows : 1008
  rawfile: time: 1008 points from 0 to 0.001, largest step 0.000001, v(a) at time 0, 0.00025, 0.0005 s: 1, -3.66716992276e-9, -0.999996020581
ngspice 42: the same output, exit code and summary as ngspice 47, and the same rawfile values except one
  time point near the end (0.00099928 s where 47 has 0.00099914 s)
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    a                                            1
    v1#branch                                   -1
    No. of Data Rows : 1008
  vectors: time: 1008 points from 0 to 0.001, largest step 0.000001, v(a) at time 0, 0.00025, 0.0005 s: 1, -3.66716992276e-9, -0.999996020581
```

### P19c. SIN: the fifth number, THETA, damps the wave: the amplitude is multiplied by exp(−THETA × t)

With a damping of 1000 per second, the swing shrinks by exp(−1000 × t): at 0.25 ms the peak is exp(−0.25) = 0.7788 V, at 0.75 ms the trough is −exp(−0.75) = −0.4724 V.

```spice
* SIN with damping
V1 b 0 SIN(0 1 1k 0 1000)
R1 b 0 1
.tran 1u 1m
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    b                                            0
    v1#branch                                    0
    No. of Data Rows : 1008
  rawfile: time: 1008 points from 0 to 0.001, largest step 0.000001, v(b) at time 0, 0.00025, 0.00075 s: 0, 0.778797761047, -0.472364719791
ngspice 42: the same output, exit code and summary as ngspice 47, and the same rawfile values except one
  time point near the end (0.00099928 s where 47 has 0.00099914 s)
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    b                                            0
    v1#branch                                    0
    No. of Data Rows : 1008
  vectors: time: 1008 points from 0 to 0.001, largest step 0.000001, v(b) at time 0, 0.00025, 0.00075 s: 0, 0.778797761047, -0.472364719791
```

### P20. PWL(t1 v1 t2 v2 ...): straight lines between (time, value) pairs, then the last value

The source follows straight lines between (0 s, 0 V), (1 ms, 5 V), (2 ms, 5 V) and (3 ms, 0 V), and keeps the last value after that.

```spice
* PWL(t1 v1 t2 v2 ...)
V1 a 0 PWL(0 0 1m 5 2m 5 3m 0)
R1 a 0 1
.tran 0.1m 4m
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    a                                            0
    v1#branch                                    0
    No. of Data Rows : 68
  rawfile: time: 68 points from 0 to 0.004, largest step 0.00008, v(a) at time 0, 0.0005, 0.001, 0.002, 0.0025, 0.003, 0.004 s: 0, 2.5, 5, 5, 2.5, 5.55111512313e-17, 0
ngspice 42, ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    a                                            0
    v1#branch                                    0
    No. of Data Rows : 67
  rawfile: time: 67 points from 0 to 0.004, largest step 0.00008, v(a) at time 0, 0.0005, 0.001, 0.002, 0.0025, 0.003, 0.004 s: 0, 2.5, 5, 5, 2.5, 5.55111512313e-17, 0
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    a                                            0
    v1#branch                                    0
    No. of Data Rows : 67
  vectors: time: 67 points from 0 to 0.004, largest step 0.00008, v(a) at time 0, 0.0005, 0.001, 0.002, 0.0025, 0.003, 0.004 s: 0, 2.5, 5, 5, 2.5, 5.55111512313e-17, 0
```

### P20b. EXP(V1 V2 TD1 TAU1 TD2 TAU2): towards V2 from TD1 with time constant TAU1, back towards V1 from TD2 with TAU2

0 V until 1 ms, then towards 1 V with a 1 ms time constant (1 − e⁻¹ = 0.6321 V at 2 ms), and from 3 ms back towards 0 V with a 1 ms time constant.

```spice
* EXP(V1 V2 TD1 TAU1 TD2 TAU2)
V1 a 0 EXP(0 1 1m 1m 3m 1m)
R1 a 0 1
.tran 1u 5m
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    a                                            0
    v1#branch                                    0
    No. of Data Rows : 5008
  rawfile: time: 5008 points from 0 to 0.005, largest step 0.000001, v(a) at time 0, 0.001, 0.002, 0.003, 0.004 s: 0, 0.000201571778641, 0.632120521741, 0.864463131341, 0.318092404872
ngspice 42: the same output, exit code and summary as ngspice 47, and the same rawfile values except one
  time point near the end (0.00499928 s where 47 has 0.00499914 s)
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    a                                            0
    v1#branch                                    0
    No. of Data Rows : 5008
  vectors: time: 5008 points from 0 to 0.005, largest step 0.000001, v(a) at time 0, 0.001, 0.002, 0.003, 0.004 s: 0, 0.000201571778641, 0.632120521741, 0.864463131341, 0.318092404872
```

### P21. K couples two inductors by name

L1 and L2 are coupled by K1, so the 1 kHz signal on L1 appears across L2's load (0.877 V). L3 and L4, with no K line, are not coupled: v(d) = 0.

```spice
* K couples two inductors by name
V1 a 0 AC 1
R0 a p 1
L1 p 0 1m
L2 b 0 1m
R1 b 0 1k
K1 L1 L2 0.9
R2 a q 1
L3 q 0 1m
L4 d 0 1m
R3 d 0 1k
.ac lin 1 1k 1k
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 1
    Note: v1: has no value, DC 0 assumed
  rawfile: frequency = 1000, v(b) (magnitude) = 0.8881110720920539, v(d) (magnitude) = 0
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 1
    Note: v1: has no value, DC 0 assumed
  vectors: frequency = 1000, v(b) (magnitude) = 0.8881110720920539, v(d) (magnitude) = 0
  diagnostics: no-value-dc0 (v1)
```

### P22. Blank lines are ignored

Blank lines between the parts change nothing: the same 6 V and −3 A as F1a.

```spice
* blank lines are ignored

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

### P23. ic= on a capacitor is its starting voltage when .tran has uic

C1 starts at 2 V (its ic=) instead of the 0 V operating point, and discharges through R1 towards 0 V (the source is 0 V). With uic, ngspice's first saved point is just after time 0.

```spice
* ic= with .tran uic
V1 in 0 0
R1 in out 1k
C1 out 0 1u ic=2
.tran 10u 1m uic
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    Operating point simulation skipped by 'uic',
      now using transient initial conditions.
    No. of Data Rows : 111
  rawfile: time: 111 points from 1e-7 to 0.001, largest step 0.00001, v(out): 111 points from 1.9998000199980004 to 0.7357530610830221
ngspice 42, ngspice -b -r (exit 0):
    Using transient initial conditions
    No. of Data Rows : 111
  rawfile: time: 111 points from 1e-7 to 0.001, largest step 0.00001, v(out): 111 points from 1.9998000199980004 to 0.7357530170076223
our engine (wasm), as ngspice -b -r (exit 0):
    Operating point simulation skipped by 'uic',
      now using transient initial conditions.
    No. of Data Rows : 111
  vectors: time: 111 points from 1e-7 to 0.001, largest step 0.00001, v(out): 111 points from 1.9998000199980004 to 0.7357530610830221
```

### P24. A resistance below 1e-12 Ω, such as 3a, is raised to 1e-12 Ω by ngspice 47, with the same warning

```spice
* 3a on a resistor
I1 0 n1 1
R1 n1 0 3a
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               1.000000e-12
    Warning: Value of resistor r1 is too small, set to 1.000000e-12
  rawfile from ngspice -b -r (exit 0): v(n1) = 1e-12
ngspice 42, ngspice -b (exit 0):
        n1                               3.000000e-18
  rawfile from ngspice -b -r (exit 0): v(n1) = 3.0000000000000002e-18
our engine (wasm), as ngspice -b -r (exit 0):
    Warning: Value of resistor r1 is too small, set to 1.000000e-12
  vectors: v(n1) = 1e-12
  diagnostics: resistor-too-small (r1)
```

### P24b. Where a current source sets the current, a 0 Ω resistor carries exactly that current: the currents next to a resistor ngspice 47 cannot use can come out inaccurate, not always

Added after the integration check of 14 November 2026 (P4), for the Numbers panel's words for ngspice's "is
too small" warning and Explain's note for a 0 Ω resistor. ngspice 47 raises the 0 Ω to 1e-12 Ω with its warning, as in P13, and ngspice 42 uses 1 mΩ
without a word; in both, R1 and I1 carry exactly 1 A, as for 3a (zero-ohm-9). In P13, in series with 1 kΩ
across 6 V, the source's current comes out as 5.859 mA for 6 mA. So the words say the currents next to such a
resistor "can come out inaccurate", where they said "come out inaccurate". They also say the value ngspice 47
used, which its warning gives: 10⁻¹² Ω, or −10⁻¹² Ω for a negative value ("set to -1.000000e-12", zero-ohm-7),
in the zero-ohm check's words ("a resistance this close to 0").

```spice
* a 0 ohm resistor where a current source sets the current, as PlainSpice runs it (.options savecurrents)
I1 0 n1 1
R1 n1 0 0
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
  rawfile from ngspice -b -r (exit 0): v(n1) = 1e-12, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42, ngspice -b (exit 0), the model and device listings left out:
        n1                               1.000000e-03
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 0.001, i(@i1[current]) = 1, i(@r1[i]) = 1
our engine (wasm), as ngspice -b -r (exit 0):
    Warning: Value of resistor r1 is too small, set to 1.000000e-12
  vectors: v(n1) = 1e-12, i(@i1[current]) = 1, i(@r1[i]) = 1
  diagnostics: resistor-too-small (r1)
```

### P24c. Exactly 1e-12 Ω, or −1e-12 Ω, is kept without a warning: only a value closer to 0 gets ngspice 47's warning

Added after the round-1 critic of the integration check's fixes (14 November 2026, C1-1), for where Explain's
notes on a resistance this close to 0 begin. 1 A goes into each resistor, so each node sits at the resistance
ngspice uses. Both versions keep exactly 1e-12 Ω and −1e-12 Ω and say nothing. One part in a million closer
to 0, at ±0.999999e-12 Ω, ngspice 47 warns and uses ±1e-12 Ω, as for 3a (P24) and −3e-18 (zero-ohm-7 in
traps.md), where ngspice 42 keeps the value without a word. So the Checks, the Numbers panel and Explain say
nothing of R1 and R2 being too small, and Explain gives R2 the note of P14, "ngspice accepts a negative
resistance without a message".

```spice
* 1e-12 ohm and -1e-12 ohm are kept, a millionth closer to 0 is not, 1 A into each
I1 0 n1 1
R1 n1 0 1e-12
I2 0 n2 1
R2 n2 0 -1e-12
I3 0 n3 1
R3 n3 0 0.999999e-12
I4 0 n4 1
R4 n4 0 -0.999999e-12
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0), the model and device listings left out:
        n4                               -1.00000e-12
        n3                               1.000000e-12
        n2                               -1.00000e-12
        n1                               1.000000e-12
    Warning: Value of resistor r3 is too small, set to 1.000000e-12
    Warning: Value of resistor r4 is too small, set to -1.000000e-12
  rawfile from ngspice -b -r (exit 0): v(n1) = 1e-12, v(n2) = -1e-12, v(n3) = 1e-12, v(n4) = -1e-12
ngspice 42, ngspice -b (exit 0), the model and device listings left out:
        n4                               -9.99999e-13
        n3                               9.999990e-13
        n2                               -1.00000e-12
        n1                               1.000000e-12
  rawfile from ngspice -b -r (exit 0): v(n1) = 1e-12, v(n2) = -1e-12, v(n3) = 9.99999e-13, v(n4) = -9.99999e-13
our engine (wasm), as ngspice -b -r (exit 0):
    Warning: Value of resistor r3 is too small, set to 1.000000e-12
    Warning: Value of resistor r4 is too small, set to -1.000000e-12
  vectors: v(n1) = 1e-12, v(n2) = -1e-12, v(n3) = 1e-12, v(n4) = -1e-12
  diagnostics: resistor-too-small (r3), resistor-too-small (r4)
```

### P3b. With a SIN as well, .op uses the source's value and .tran follows the SIN from time 0

`V1 a b -3 SIN(0 1 1k)` has a DC value, −3 V, and a transient function. In .op ngspice uses the
value: a = −1.5 V and b = 1.5 V, so a sits 3 V below b, as P3 says it (ngspice notes that it uses
the DC value for the operating point). In .tran the value is not used, not even at the start: the
SIN starts at its offset, 0, so V(a) − V(b) starts at 0 and swings between about −1 and 1 V. So
Explain's "So node a sits 3 V below node b." is followed by "In .op the source has that value; in
.tran it follows its SIN from time 0 instead." (critic of words re-check 12's fix, 12 November
2026: with .tran only, that "so" was backed by no run).

```spice
* a voltage source of -3 V with a SIN, in .op
V1 a b -3 SIN(0 1 1k)
R1 a 0 1k
R2 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Note: v1: dc value used for op instead of transient time=0 value.
        b                                1.500000e+00
        a                                -1.50000e+00
        v1#branch                        1.500000e-03
  rawfile from ngspice -b -r (exit 0): v(a) = -1.5, v(b) = 1.5, i(v1) = 0.0015
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = -1.5, v(b) = 1.5, i(v1) = 0.0015
```

```spice
* a voltage source of -3 V with a SIN, in .tran
V1 a b -3 SIN(0 1 1k)
R1 a 0 1k
R2 b 0 1k
.tran 0.1m 2m
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    Note: v1: dc value used for op instead of transient time=0 value.
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    a                                            0
    b                                            0
    v1#branch                                    0
    No. of Data Rows : 59
  rawfile: time: 59 points from 0 to 0.002, largest step 0.00004, v(a) at time 0, 0.00025, 0.00075 s: 0, 0.49954267455, -0.49607160000 (v(b) the opposite)
ngspice 42: the same output and rawfile values as ngspice 47, except one time point near the end (0.0019712 s where 47 has 0.0019656 s)
our engine (wasm), as ngspice -b -r (exit 0):
  the same note and initial solution as ngspice 47
  vectors: time: 59 points from 0 to 0.002, largest step 0.00004, v(a) at time 0, 0.00025, 0.00075 s: 0, 0.49954267455, -0.49607160000
```

### P4b. A current source a .dc line sweeps has no one value there

`.dc I1 -5m 5m 1m` sets I1 to −5 mA, −4 mA, ..., 5 mA in turn; its own −2 mA is not used. At 5 mA
the current goes from a, through I1, into ground, so a = −5 V; at −5 mA it goes the other way and a
= 5 V. So Explain says only which way I1 pushes its current, and "The .dc on line 4 sweeps this
source, so in that analysis its value changes.", as for a swept voltage source (A7), and the
overview says "I1: a current source pushing current from node a into ground, swept by .dc." (critic
of words re-check 12's fix, 12 November 2026: they said "its value is negative, so it pushes 2 mA
from ground into node a", which no point of the sweep does at 5 mA).

```spice
* a current source of -2 mA swept by .dc
I1 a 0 -2m
R1 a 0 1k
.dc I1 -5m 5m 1m
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 11
  rawfile: i(i-sweep) = [-0.005, -0.004, -0.003, -0.002, -0.001, 0, 0.001, 0.002, 0.003, 0.004, 0.005], v(a) = [5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5]
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 11
  vectors: i(i-sweep) = [-0.005, -0.004, -0.003, -0.002, -0.001, 0, 0.001, 0.002, 0.003, 0.004, 0.005], v(a) = [5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5]
```

### P4c. With a SIN as well, .op uses the current source's value and .tran follows the SIN

`I1 a 0 -2m SIN(0 1m 1k)`: in .op ngspice uses −2 mA, so 2 mA flow from ground into a and a = 2 V,
as P4 says it. In .tran it follows the SIN from time 0: a starts at 0 and swings between about −1
and 1 V, and is never 2 V. So Explain's sentence about the negative value is followed by "In .op the
source has that value; in .tran it follows its SIN from time 0 instead.", and the overview says "so
in .op it pushes 2 mA from ground into node a" (critic of words re-check 12's fix, 12 November
2026).

```spice
* a current source of -2 mA with a SIN, in .op
I1 a 0 -2m SIN(0 1m 1k)
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Note: i1: dc value used for op instead of transient time=0 value.
        a                                2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(a) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 2
```

```spice
* a current source of -2 mA with a SIN, in .tran
I1 a 0 -2m SIN(0 1m 1k)
R1 a 0 1k
.tran 0.1m 2m
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    Note: i1: dc value used for op instead of transient time=0 value.
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    a                                            0
    No. of Data Rows : 59
  rawfile: time: 59 points from 0 to 0.002, largest step 0.00004, v(a) at time 0, 0.00025, 0.00075 s: 0, -0.99908534909, 0.99214320000; between -0.999971575673983 and 0.9930314824871339
ngspice 42: the same output and rawfile values as ngspice 47, except one time point near the end (0.0019712 s where 47 has 0.0019656 s)
our engine (wasm), as ngspice -b -r (exit 0):
  the same note and initial solution as ngspice 47
  vectors: time: 59 points from 0 to 0.002, largest step 0.00004, v(a) at time 0, 0.00025, 0.00075 s: 0, -0.99908534909, 0.99214320000
```

### P16b. A source with dc but no number after it is 0 in .op too, without a note

Added after the re-check of the fixes (12 November 2026, C3). `dc` with no number is a DC value of 0 for ngspice, so it prints no "has no value" note, with an AC value after it or not; Explain says "without a message" for these. A source whose value word ngspice cannot read (`−5` with a minus sign from a document) is neither: ngspice stops at the word (look-alike-letter-2, invisible-character-6, space-character-12 in traps.md), so Explain gives it no note about a missing value.

```spice
* a source with dc but no number after it
V1 a 0 dc
R1 a 0 1
V2 b 0 dc AC 1
R2 b 0 1
I1 0 c dc
R3 c 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
            c                                0.000000e+00
            b                                0.000000e+00
            a                                0.000000e+00
            v1#branch                        0.000000e+00
            v2#branch                        0.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(a) = 0, v(b) = 0, v(c) = 0, i(v2) = 0, i(v1) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(a) = 0, v(b) = 0, v(c) = 0, i(v2) = 0, i(v1) = 0
```

## 2. Analyses and other dot commands

What each analysis computes and saves, how many points ngspice computes for .dc and .ac (explain.ts counts them the way ngspice does: `dcSweepPoints`, `acSweepPoints`), how it steps .tran, and what the other dot commands do in a run like ours (`ngspice -b -r`).

### A1. .op saves every node voltage and the current in every voltage source (and in E, H and L)

Without savecurrents, the results are every node voltage plus i(v1), i(vs), i(e1), i(h1) and i(l1): the branch currents of voltage sources, E and H sources and inductors. There is no i(r1) and no i(i1).

```spice
* .op: what it saves
V1 a 0 10
R1 a b 2
L1 b c 1m
R2 c 0 3
C1 c 0 1u
I1 0 c 1
E1 e 0 c 0 2
RE e 0 4
Vs c d 0
RD d 0 5
F1 0 f Vs 3
RF f 0 1
G1 0 g c 0 0.1
RG g 0 1
H1 h 0 Vs 7
RH h 0 1
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        h                                8.129032e+00
        g                                5.806452e-01
        f                                3.483871e+00
        d                                5.806452e+00
        e                                1.161290e+01
        c                                5.806452e+00
        b                                5.806452e+00
        a                                1.000000e+01
        v1#branch                        -2.09677e+00
        e1#branch                        -2.90323e+00
        l1#branch                        2.096774e+00
        h1#branch                        -8.12903e+00
        vs#branch                        1.161290e+00
  rawfile from ngspice -b -r (exit 0): v(a) = 10, v(b) = 5.806451612903226, v(c) = 5.806451612903226, v(e) = 11.612903225806452, v(d) = 5.806451612903226, v(f) = 3.483870967741936, v(g) = 0.5806451612903226, v(h) = 8.129032258064516, i(vs) = 1.1612903225806452, i(h1) = -8.129032258064516, i(l1) = 2.096774193548387, i(e1) = -2.903225806451613, i(v1) = -2.096774193548387
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 10, v(b) = 5.806451612903226, v(c) = 5.806451612903226, v(e) = 11.612903225806452, v(d) = 5.806451612903226, v(f) = 3.483870967741936, v(g) = 0.5806451612903226, v(h) = 8.129032258064516, i(vs) = 1.1612903225806452, i(h1) = -8.129032258064516, i(l1) = 2.096774193548387, i(e1) = -2.903225806451613, i(v1) = -2.096774193548387
```

### A2. .options savecurrents also saves the current through every R, C, L, F, G and I

With `.options savecurrents`, ngspice adds a current for every R, C, L, F, G and I part (`i(@r1[i])`, `i(@i1[current])` …). V, E and H get nothing extra: they already have their branch current. C1's current is 0 (an open circuit in .op), and L1's equals i(l1).

```spice
* .op with .options savecurrents
V1 a 0 10
R1 a b 2
L1 b c 1m
R2 c 0 3
C1 c 0 1u
I1 0 c 1
E1 e 0 c 0 2
RE e 0 4
Vs c d 0
RD d 0 5
F1 0 f Vs 3
RF f 0 1
G1 0 g c 0 0.1
RG g 0 1
H1 h 0 Vs 7
RH h 0 1
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        h                                8.129032e+00
        g                                5.806452e-01
        f                                3.483871e+00
        d                                5.806452e+00
        e                                1.161290e+01
        c                                5.806452e+00
        b                                5.806452e+00
        a                                1.000000e+01
        @rh[i]                           8.129032e+00
        @rg[i]                           5.806452e-01
        @g1[i]                           5.806452e-01
        @rf[i]                           3.483871e+00
        @f1[i]                           3.483871e+00
        @rd[i]                           1.161290e+00
        @re[i]                           2.903226e+00
        @i1[current]                     1.000000e+00
        @c1[i]                           0.000000e+00
        @r2[i]                           1.935484e+00
        @l1[i]                           2.096774e+00
        @r1[i]                           2.096774e+00
        v1#branch                        -2.09677e+00
        e1#branch                        -2.90323e+00
        l1#branch                        2.096774e+00
        h1#branch                        -8.12903e+00
        vs#branch                        1.161290e+00
  rawfile from ngspice -b -r (exit 0): v(a) = 10, v(b) = 5.806451612903226, v(c) = 5.806451612903226, v(e) = 11.612903225806452, v(d) = 5.806451612903226, v(f) = 3.483870967741936, v(g) = 0.5806451612903226, v(h) = 8.129032258064516, i(vs) = 1.1612903225806452, i(h1) = -8.129032258064516, i(l1) = 2.096774193548387, i(e1) = -2.903225806451613, i(v1) = -2.096774193548387, i(@r1[i]) = 2.096774193548387, i(@l1[i]) = 2.096774193548387, i(@r2[i]) = 1.935483870967742, i(@c1[i]) = 0, i(@i1[current]) = 1, i(@re[i]) = 2.903225806451613, i(@rd[i]) = 1.1612903225806452, i(@f1[i]) = 3.483870967741936, i(@rf[i]) = 3.483870967741936, i(@g1[i]) = 0.5806451612903226, i(@rg[i]) = 0.5806451612903226, i(@rh[i]) = 8.129032258064516
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 10, v(b) = 5.806451612903226, v(c) = 5.806451612903226, v(e) = 11.612903225806452, v(d) = 5.806451612903226, v(f) = 3.483870967741936, v(g) = 0.5806451612903226, v(h) = 8.129032258064516, i(vs) = 1.1612903225806452, i(h1) = -8.129032258064516, i(l1) = 2.096774193548387, i(e1) = -2.903225806451613, i(v1) = -2.096774193548387, i(@r1[i]) = 2.096774193548387, i(@l1[i]) = 2.096774193548387, i(@r2[i]) = 1.935483870967742, i(@c1[i]) = 0, i(@i1[current]) = 1, i(@re[i]) = 2.903225806451613, i(@rd[i]) = 1.1612903225806452, i(@f1[i]) = 3.483870967741936, i(@rf[i]) = 3.483870967741936, i(@g1[i]) = 0.5806451612903226, i(@rg[i]) = 0.5806451612903226, i(@rh[i]) = 8.129032258064516
```

### A2b. .options savecurrents saves the currents of diodes, BJTs and MOSFETs too

With savecurrents ngspice also saves the terminal currents of semiconductor parts: the diode current @d1[id], the BJT currents @q1[ic], [ib], [ie], [is], the MOSFET currents @m1[id], [ig], [is], [ib]. PlainSpice does not show them yet (src/spice/describe.ts).

```spice
* savecurrents with a diode, a BJT and a MOSFET
V1 a 0 5
R1 a b 1k
D1 b 0 dmod
.model dmod D
Vc c 0 5
Vb bb 0 0.7
Q1 c bb 0 qm
.model qm npn
M1 c bb 0 0 nm
.model nm nmos
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        bb                               7.000000e-01
        c                                5.000000e+00
        b                                6.928910e-01
        a                                5.000000e+00
        @m1[ib]                          -5.01000e-12
        @m1[ig]                          0.000000e+00
        @m1[is]                          -4.90000e-06
        @m1[id]                          4.900005e-06
        @q1[is]                          5.000000e-12
        @q1[ib]                          5.670311e-07
        @q1[ie]                          -5.72705e-05
        @q1[ic]                          5.670347e-05
        @d1[id]                          4.307675e-03
        @r1[i]                           4.307109e-03
        v1#branch                        -4.30711e-03
        vc#branch                        -6.16035e-05
        vb#branch                        -5.67031e-07
  ngspice -b -r out.raw (exit 0)
    rawfile: i(@d1[id]) = 0.004307674725988779, i(@q1[ic]) = 0.00005670347201442283, i(@m1[id]) = 0.0000049000050100000015
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: i(@d1[id]) = 0.004307674725988779, i(@q1[ic]) = 0.00005670347201442283, i(@m1[id]) = 0.0000049000050100000015
```

### A2c. A `+` line after `.end` continues the last line before `.end`, so `.options savecurrents` added just before `.end` would take that line's place

ngspice does not stop reading at `.end` (S25): it makes `.end` a comment, and a `+` line after it continues the last line before it that is no comment (S28, limit-18). Here `+ 3` continues R1, which takes the second value, 3 Ω: v(n1) = 3 V. Without `.options savecurrents`, ngspice saves no current through R1 and none from I1 (A1, A2): the results file has v(n1) alone. Which currents a run saves without the line depends on the parts: below, a voltage source keeps its current, and so does a B line with V=. With the line added just before `.end`, `+ 3` continues that line instead, R1 keeps 2 Ω and v(n1) is 2 V. So PlainSpice leaves the line out of the copy it runs here (decision 0011), and the ngspice output panel says why, with what the line does in Explain's words (ngspice saves the current through every part only with it), not with a list of the currents saved without it; it says nothing where the student's own `.options savecurrents` line, which ngspice reads after `.end` too, saves every current (A2d). With `.end` moved to the bottom (the after-end check's fix), the line goes in before it, and the run has the same 3 V and every current.

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

With `.options savecurrents` just before `.end`:

```spice
* a + line after .end
I1 0 n1 1
.op
R1 n1 0 2
.options savecurrents
.end
+ 3
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2, i(@i1[current]) = 1, i(@r1[i]) = 1
```

With `.end` moved to the bottom and the line added before it, as PlainSpice runs the netlist after the after-end check's fix "Move .end to the bottom":

```spice
* a + line after .end
I1 0 n1 1
.op
R1 n1 0 2
+ 3
.options savecurrents
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
```

With a voltage source, as written: its current is saved, the resistors' are not (R2 takes 3 Ω: v(b) = 6 × 3/4 = 4.5 V).

```spice
* a + line after .end, with a voltage source
V1 a 0 6
R1 a b 1
.op
R2 b 0 2
.end
+ 3
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                4.500000e+00
        a                                6.000000e+00
        v1#branch                        -1.50000e+00
  rawfile from ngspice -b -r (exit 0): v(a) = 6, v(b) = 4.5, i(v1) = -1.5
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 6, v(b) = 4.5, i(v1) = -1.5
```

With a B line with V=, as written (decision 0011's netlist): `+ v(b)` continues B1, whose formula is then 1+v(b) = 1 + 6 = 7 V; ngspice saves B1's current and V1's, not the resistors' (13 November 2026, the round-1 critic of the last pass's fixes).

```spice
* a + line after .end, with a B source
V1 a 0 9
R1 a b 1k
R2 b 0 2k
.op
R3 c 0 1k
B1 c 0 V=1+
.end
+ v(b)
```

```text
ngspice 47, ngspice -b (exit 0):
        c                                7.000000e+00
        b                                6.000000e+00
        a                                9.000000e+00
        v1#branch                        -3.00000e-03
        b1#branch                        -7.00000e-03
  rawfile from ngspice -b -r (exit 0): v(a) = 9, v(b) = 6, v(c) = 7, i(b1) = -0.007, i(v1) = -0.003000000000000001
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 9, v(b) = 6, v(c) = 7, i(b1) = -0.007, i(v1) = -0.003000000000000001
```

### A2d. ngspice reads an `.options savecurrents` line after `.end` too, even after a `.end` with a comment glued on; not after a line starting with `@`, and the command `option savecurrents` saves no current

Before it reads the circuit, ngspice takes every line that starts with `.opt` out of the whole netlist (inp_getopts), and `.options savecurrents` works wherever that line is: after `.end` (S25), even after a `.end` with a comment glued on, after which ngspice reads no more parts (S27: `+ 3` is lost there and v(n1) is 2 V, yet both currents are saved), in a `.control` block, and with `savecurrents` on a `+` line after `.end` that continues an `.options` line before it. A line starting with `@` ends what ngspice reads (S29), so an `.options` line after it does nothing; and the command `option savecurrents` (in a `.control` block, or on a `*#` line) saves no current, nor does `set savecurrents`. ngspice finds the word as inp_savecurrents does, anywhere in such a line (`.OPT SaveCurrents`, `.optfoo savecurrents_mos1` too), and not in its comment; which lines ngspice joins to it, and where a comment starts, follow its rules for every line (A2e: two backslashes at the end of a line, and the comments of a `.control` block). So when a `+` line after `.end` keeps PlainSpice's line out of the copy (A2c), the ngspice output panel says nothing of missing currents, and Explain's `.op` line has no note, where the student's own line saves every current (src/spice/run-netlist.ts, `saveCurrentsLeftOut`; 13 November 2026, the round-1 critic of the last pass's fixes).

```spice
* .options savecurrents after .end
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
.options savecurrents
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
```

After a `.end` with a comment glued on: no more parts (R1 keeps 2 Ω), but the `.options` line.

```spice
* .options savecurrents after .end with a comment glued on
I1 0 n1 1
.op
R1 n1 0 2
.end;x
+ 3
.options savecurrents
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2, i(@i1[current]) = 1, i(@r1[i]) = 1
```

After a line starting with `@`: not read, so no current is saved.

```spice
* .options savecurrents after a line starting with @
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
@ x
.options savecurrents
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3
```

In a `.control` block (here `+ 3` continues `.endc`, so R1 keeps 2 Ω).

```spice
* .options savecurrents in a .control block
I1 0 n1 1
.op
R1 n1 0 2
.control
.options savecurrents
.endc
.end
+ 3
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2, i(@i1[current]) = 1, i(@r1[i]) = 1
```

`savecurrents` on a `+` line after `.end`, which continues the `.options` line before it.

```spice
* .options before .end, savecurrents on a + line after it
I1 0 n1 1
R1 n1 0 2
.op
.options
.end
+ savecurrents
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2, i(@i1[current]) = 1, i(@r1[i]) = 1
```

The command `option savecurrents` in a `.control` block: no current is saved.

```spice
* the command option savecurrents
I1 0 n1 1
.op
R1 n1 0 2
.control
option savecurrents
.endc
.end
+ 3
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2
```

In a `.control` block after `.end` too.

```spice
* .options savecurrents in a .control block after .end
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
.control
.options savecurrents
.endc
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
```

`.OPT` in capitals, indented, with a comment after it: ngspice reads the line in lower case.

```spice
* .OPT SaveCurrents, indented, with a comment
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
  .OPT SaveCurrents ; a note
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
```

A line that starts with `.opt`, with `savecurrents` inside a longer word.

```spice
* .optfoo savecurrents_mos1
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
.optfoo savecurrents_mos1
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
```

`savecurrents` only in a comment: no current is saved.

```spice
* savecurrents in a comment only
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
.options temp=27 ; savecurrents
* .options savecurrents
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3
```

The command `option savecurrents` on a `*#` line: no current is saved.

```spice
* the command option savecurrents on a *# line
I1 0 n1 1
.op
R1 n1 0 2
*# option savecurrents
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

The command `set savecurrents` in a `.control` block: no current is saved.

```spice
* the command set savecurrents
I1 0 n1 1
.op
R1 n1 0 2
.control
set savecurrents
.endc
.end
+ 3
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 2
```

### A2e. ngspice reads an `.options` line as it reads every line: after a line that ends in two backslashes, the next line is a `+` line, and in a `.control` block a `$` starts a comment only before a blank

Before ngspice takes the `.opt` lines out of the netlist (A2d), it reads each line of the file (inp_read), cuts the comments (inp_stripcomments_deck) and joins the `+` lines (inp_stitch_continuation_lines). Three of its rules there decide whether an `.options savecurrents` line saves every current:

- A line that ends in two backslashes makes the next line a `+` line, whatever that line is (a comment line, a `.title` line), past blank lines and past the `.hdl` and `.biaschk` lines that ngspice 47 drops. ngspice looks for the backslashes before it cuts the comment, on the title too, but not on a line that starts with `*` or `$`, nor on a `.title` or `.end` line, which it has made a comment by then.
- From a `.control` line to the line before `.endc`, a `$` starts a comment only before a blank, so `$savecurrents` is read there; outside a `.control` block a `$` after a blank starts one.
- ngspice counts the `.control` lines less the `.endc` lines (the title too, and a `.control` line that two backslashes made a `+` line, which opens no block). Unless that comes to 0, it cuts the comment of every line by the `.control` rule.

So PlainSpice reads the student's lines the same way before the ngspice output panel says why the parts' currents are missing, and before Explain's `.op` line says "does not add" (src/spice/run-netlist.ts, `readsSaveCurrents`; 13 November 2026, the round-2 critic of the last pass's fixes). Each netlist below has `+ 3` after `.end`, so PlainSpice adds no `.options savecurrents` line of its own (A2c); the note comes exactly where the run below has no part's own current.

A line after one that ends in two backslashes is a `+` line (here after `.end`): `savecurrents` continues the `.options` line, and both currents are saved (the round-2 critic's netlist).

```spice
* .options ending in two backslashes, after .end
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
.options \\
savecurrents
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
```

Past a blank line, which ngspice drops, and on again: a `+` line made this way can end in two backslashes too.

```spice
* two backslashes, a blank line, two backslashes again
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
.options \\

temp=27 \\
savecurrents
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
```

Whatever the next line is: a comment line becomes a `+` line (and, ending in two backslashes, makes the next one a `+` line too), and so does a `.title` line.

```spice
* two backslashes before a comment line and a .title line
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
.options \\
* a note \\
.title savecurrents
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
```

Not after a line that starts with `*` or `$`, nor after a `.title` line, which ngspice has made a comment by then: the `.options` line after them is a line of its own (were it a `+` line, it would continue R1).

```spice
* comment lines ending in two backslashes
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
* a note \\
$ a note \\
.title x \\
.options savecurrents
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
    Warning: Unusual leading characters like '$' or others out of '= [] ? () & % $"!:,\f'
        in netlist or included files, will be replaced with '*'.
        check line  $ a note \\
        line no. 8 from file circuit.cir!
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
    Warning: Unusual leading characters like '$' or others out of '= [] ? () & % $"!:,\f'
        in netlist or included files, will be replaced with '*'.
        Check line no 8:  $ a note \\
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
our engine (wasm), as ngspice -b -r (exit 0):
    Warning: Unusual leading characters like '$' or others out of '= [] ? () & % $"!:,\f'
        in netlist or included files, will be replaced with '*'.
        check line  $ a note \\
        line no. 8 from file /circuit.cir!
  vectors: v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
  diagnostics: unusual-leading-character
```

After a line that starts with `#`, ngspice does look for the two backslashes (it makes the line a comment only later).

```spice
* a # line ending in two backslashes
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
.options
# a note \\
savecurrents
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
```

ngspice looks for the two backslashes before it cuts the comment, so they count inside a comment too.

```spice
* two backslashes inside a ; comment
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
.options temp=27 ; a note \\
savecurrents
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
```

ngspice 47 drops a `.hdl` line and a `.biaschk` line with a warning, so the line after them is the `+` line; ngspice 42 stops at them.

```spice
* two backslashes, then .hdl and .biaschk lines
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
.options \\
.hdl x
.biaschk
savecurrents
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
    Warning: Dot command .hdl is not supported, ingnored
        line no. 8, .hdl x
        file circuit.cir
        This message will be posted only once!
    Warning: Dot command .biaschk is not supported, ingnored
        This message will be posted only once!
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42, ngspice -b (exit 1):
    Error on line 9 or its substitute:
      .biaschk
     unimplemented dot command '.biaschk'
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 0):
    Warning: Dot command .hdl is not supported, ingnored
        line no. 8, .hdl x
        file /circuit.cir
        This message will be posted only once!
    Warning: Dot command .biaschk is not supported, ingnored
        This message will be posted only once!
  vectors: v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
  diagnostics: warning, warning
```

The title counts too: after a title that ends in two backslashes, line 2 is a `+` line, which continues no line, and ngspice ignores it: no current is saved.

```spice
a title ending in two backslashes \\
.options savecurrents
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

In a `.control` block a `$` starts a comment only before a blank, so `$savecurrents` is read, and both currents are saved (the round-2 critic's netlist).

```spice
* $savecurrents in a .control block after .end
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
.control
.options temp=27 $savecurrents
.endc
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
```

In a `.control` block a `$` before a blank starts a comment, even glued to the word before it: no current is saved (the round-2 critic's netlist).

```spice
* 27$ savecurrents in a .control block after .end
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
.control
.options temp=27$ savecurrents
.endc
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3
```

The same rule on a `+` line in a `.control` block.

```spice
* + $savecurrents in a .control block
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
.control
.options temp=27
+ $savecurrents
.endc
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
```

Outside a `.control` block a `$` after a blank starts a comment: no current is saved.

```spice
* $savecurrents outside a .control block
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
.options temp=27 $savecurrents
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3
```

With a `.control` line and no `.endc`, ngspice cuts the comment of every line by the `.control` rule, a line before `.control` too.

```spice
* .control with no .endc
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
.options temp=27 $savecurrents
.control
echo hi
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
    Warning: Missing .endc statement!
        in file circuit.cir
        This may cause subsequent errors.
    .end: no such command available in ngspice
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
    Warning: Missing .endc statement!
        This may cause subsequent errors.
    .end: no such command available in ngspice
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
our engine (wasm), as ngspice -b -r (exit 0):
    Warning: Missing .endc statement!
        in file /circuit.cir
        This may cause subsequent errors.
    .end: no such command available in ngspice
  vectors: v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
  diagnostics: warning
```

The same with an `.endc` line and no `.control`: ngspice counts the `.control` lines less the `.endc` lines, and unless that is 0, every line is cut by the `.control` rule.

```spice
* an .endc with no .control
I1 0 n1 1
.op
R1 n1 0 2
.endc
.end
+ 3
.options temp=27 $savecurrents
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               2.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
    Warning: Missing .control statement!
        in file circuit.cir
        This may cause subsequent errors.
    Warning: misplaced .endc card
  rawfile from ngspice -b -r (exit 0): v(n1) = 2, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42, ngspice -b (exit 0):
        n1                               2.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
    Warning: Missing .control statement!
        This may cause subsequent errors.
    Warning: misplaced .endc card
  rawfile from ngspice -b -r (exit 0): v(n1) = 2, i(@i1[current]) = 1, i(@r1[i]) = 1
our engine (wasm), as ngspice -b -r (exit 0):
    Warning: Missing .control statement!
        in file /circuit.cir
        This may cause subsequent errors.
    Warning: misplaced .endc card
  vectors: v(n1) = 2, i(@i1[current]) = 1, i(@r1[i]) = 1
  diagnostics: warning, warning
```

The title counts in that sum too.

```spice
.endc as the title
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
.options temp=27 $savecurrents
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
        @r1[i]                           1.000000e+00
        @i1[current]                     1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 3, i(@i1[current]) = 1, i(@r1[i]) = 1
```

A `.control` line made a `+` line by two backslashes counts in that sum, but opens no block: the `.options` line after it is cut by the rule outside one, and no current is saved.

```spice
* two backslashes before .control
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
.options \\
.control
.options temp=27 $savecurrents
.endc
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               3.000000e+00
    Warning: Missing .control statement!
        in file circuit.cir
        This may cause subsequent errors.
    Warning: misplaced .endc card
  rawfile from ngspice -b -r (exit 0): v(n1) = 3
ngspice 42, ngspice -b (exit 0):
        n1                               3.000000e+00
    Warning: Missing .control statement!
        This may cause subsequent errors.
    Warning: misplaced .endc card
  rawfile from ngspice -b -r (exit 0): v(n1) = 3
our engine (wasm), as ngspice -b -r (exit 0):
    Warning: Missing .control statement!
        in file /circuit.cir
        This may cause subsequent errors.
    Warning: misplaced .endc card
  vectors: v(n1) = 3
  diagnostics: warning, warning
```

### A3. .tf v(a) V1 gives the transfer function v(a)/V1, the input resistance seen by V1 and the output resistance at a

F4: v(a) = 24 × 3/9 = 8 V, so the transfer function is 8/24 = 1/3; V1 sees R1 + R2 = 9 Ω; looking back into a with V1 replaced by a short, the resistance is R3 + R1 ‖ R2 = 2 + 2 = 4 Ω, the Thévenin resistance at a. ngspice writes the three as `transfer_function`, `v1#input_impedance` and `output_impedance_at_v(a)`.

```spice
* F4: output impedance at v(a) with .tf
V1 s 0 24
R1 s n1 6
R2 n1 0 3
R3 n1 a 2
.tf v(a) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 3.333333e-01
    output_impedance_at_v(a) = 4.000000e+00
    v1#input_impedance = 9.000000e+00
  rawfile from ngspice -b -r (exit 0): v(Transfer_function) = 0.33333333333333337, v(v1#Input_impedance) = 9, v(output_impedance_at_V(a)) = 4
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(Transfer_function) = 0.33333333333333337, v(v1#Input_impedance) = 9, v(output_impedance_at_V(a)) = 4
```

### A4. The .tf input can be a current source: the transfer function is then in V/A

I1 pushes 1 A into a; R1 ‖ (R2 + R3) = 2 Ω, so a = 2 V and b = 1 V: v(b)/I1 = 1 V per ampere. I1 sees 2 Ω, and the resistance at b is R3 ‖ (R2 + R1) = 1.5 Ω.

```spice
* .tf with a current source as the input
I1 0 a 1
R1 a 0 4
R2 a b 2
R3 b 0 2
.tf v(b) I1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 1.000000e+00
    i1#input_impedance = 2.000000e+00
    output_impedance_at_v(b) = 1.500000e+00
  rawfile from ngspice -b -r (exit 0): v(Transfer_function) = 1, v(i1#Input_impedance) = 2, v(output_impedance_at_V(b)) = 1.5
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(Transfer_function) = 1, v(i1#Input_impedance) = 2, v(output_impedance_at_V(b)) = 1.5
```

### A5. For a current output, i(Vm), ngspice reports an output impedance of 1e20 Ω

The transfer function i(Vm)/V1 is right (5/3 A for 10 V: 1/6 A per volt), and so is the input resistance (4 Ω). But for a current output ngspice's output impedance is 1e20 Ω, which is not a resistance of this circuit.

```spice
* .tf with a current as the output
V1 a 0 10
R1 a b 2
Vm b c 0
R2 c 0 3
R3 b 0 6
.tf i(Vm) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 1.666667e-01
    v1#input_impedance = 4.000000e+00
    vm#output_impedance = 1.000000e+20
  rawfile from ngspice -b -r (exit 0): v(Transfer_function) = 0.16666666666666666, v(v1#Input_impedance) = 4, v(vm#Output_impedance) = 100000000000000000000
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(Transfer_function) = 0.16666666666666666, v(v1#Input_impedance) = 4, v(vm#Output_impedance) = 100000000000000000000
```

### A6. .tf on a node that is not in the circuit: no message, a transfer function of 0

n9 appears nowhere else in the netlist. ngspice prints no message and gives a transfer function of 0 and an output impedance of 1 Ω.

```spice
* .tf names a node that is not in the circuit
V1 n1 0 6
R1 n1 0 2
.tf v(n9) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 0.000000e+00
    output_impedance_at_v(n9) = 1.000000e+00
    v1#input_impedance = 2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(Transfer_function) = 0, v(v1#Input_impedance) = 2, v(output_impedance_at_V(n9)) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(Transfer_function) = 0, v(v1#Input_impedance) = 2, v(output_impedance_at_V(n9)) = 1
```

### A7. .dc V1 0 12 1 runs 13 points: 0, 1, ..., 12

D1: 0, 1, ..., 12 V is 13 points, and v(out) = 2/3 × V1 at each.

```spice
* D1: a divider swept from 0 to 12 V with .dc
V1 in 0 0
R1 in out 1k
R2 out 0 2k
.dc V1 0 12 1
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 13
  rawfile: v(v-sweep) = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], v(out) = [0, 0.6666666666666666, 1.3333333333333333, 2, 2.6666666666666665, 3.333333333333333, 4, 4.666666666666666, 5.333333333333333, 6, 6.666666666666666, 7.333333333333332, 8]
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 13
  vectors: v(v-sweep) = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], v(out) = [0, 0.6666666666666666, 1.3333333333333333, 2, 2.6666666666666665, 3.333333333333333, 4, 4.666666666666666, 5.333333333333333, 6, 6.666666666666666, 7.333333333333332, 8]
```

### A8. .dc V1 0 1 0.1 runs 11 points, although 0.1 is not exact in binary

ngspice adds the step again and again, so the last value is 0.9999999999999999, not 1; it still counts as reaching stop, because ngspice allows a tiny tolerance (1e3 × the double's epsilon). 11 points.

```spice
* .dc in steps of 0.1
V1 in 0 0
R1 in 0 1k
.dc V1 0 1 0.1
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 11
  rawfile: v(v-sweep) = [0, 0.1, 0.2, 0.30000000000000004, 0.4, 0.5, 0.6, 0.7, 0.7999999999999999, 0.8999999999999999, 0.9999999999999999]
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 11
  vectors: v(v-sweep) = [0, 0.1, 0.2, 0.30000000000000004, 0.4, 0.5, 0.6, 0.7, 0.7999999999999999, 0.8999999999999999, 0.9999999999999999]
```

### A9. The sweep stops at the last step that does not pass stop: .dc V1 0 12 5 is 0, 5, 10

0, 5 and 10 V; 15 V would pass stop, so the sweep ends at 10 V.

```spice
* .dc with a step that does not divide the range
V1 in 0 0
R1 in 0 1k
.dc V1 0 12 5
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 3
  rawfile: v(v-sweep) = [0, 5, 10]
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 3
  vectors: v(v-sweep) = [0, 5, 10]
```

### A10. A negative step sweeps downwards: .dc V1 12 0 -3 is 12, 9, 6, 3, 0

```spice
* .dc sweeping downwards
V1 in 0 0
R1 in 0 1k
.dc V1 12 0 -3
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 5
  rawfile: v(v-sweep) = [12, 9, 6, 3, 0]
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 5
  vectors: v(v-sweep) = [12, 9, 6, 3, 0]
```

### A11. Start above stop with a positive step: no points, and no message

No points at all, and no message. See below for what our engine does with the empty results.

```spice
* .dc with start above stop
V1 in 0 0
R1 in 0 1k
.dc V1 12 0 1
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 0
  rawfile: a DC transfer characteristic plot with 0 points, its header only (no results)
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, no results):
    No. of Data Rows : 0
  vectors: (none)
  diagnostics: rawfile
```

Native ngspice exits 0 and writes a results file with no data rows. Our engine also exits 0, but its rawfile reader (src/engine/rawfile.ts) rejects a file with no data section, so the run is reported as failed with a "rawfile" message.

### A12. Two sources in one .dc: every combination, the first source changing fastest

The first source, V1, runs through 0, 1, 2 V for each value of V2 (0 V, then 1 V): 6 points. The scale `v(v-sweep)` holds only V1's values.

```spice
* a nested .dc sweep
V1 a 0 0
R1 a 0 1k
V2 b 0 0
R2 b 0 1k
.dc V1 0 2 1 V2 0 1 1
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 6
  rawfile: v(v-sweep) = [0, 1, 2, 0, 1, 2], v(a) = [0, 1, 2, 0, 1, 2], v(b) = [0, 0, 0, 1, 1, 1]
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 6
  vectors: v(v-sweep) = [0, 1, 2, 0, 1, 2], v(a) = [0, 1, 2, 0, 1, 2], v(b) = [0, 0, 0, 1, 1, 1]
```

### A13. .dc can sweep a current source (the sweep is called i-sweep)

The scale is `i(i-sweep)` (amperes): a = 2 Ω × I1.

```spice
* .dc sweeping a current source
I1 0 a 0
R1 a 0 2
.dc I1 0 3 1
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 4
  rawfile: i(i-sweep) = [0, 1, 2, 3], v(a) = [0, 2, 4, 6]
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 4
  vectors: i(i-sweep) = [0, 1, 2, 3], v(a) = [0, 2, 4, 6]
```

### A14. .dc can sweep a resistor (res-sweep)

The scale is `res-sweep` (ohms): R2 takes 1k, 2k, 3k.

```spice
* .dc sweeping a resistor
V1 a 0 6
R1 a b 1k
R2 b 0 1k
.dc R2 1k 3k 1k
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 3
  rawfile: res-sweep = [1000, 2000, 3000], v(a) = [6, 6, 6], v(b) = [3, 4, 4.5], i(v1) = [-0.003, -0.002, -0.0014999999999999996]
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 3
  vectors: res-sweep = [1000, 2000, 3000], v(a) = [6, 6, 6], v(b) = [3, 4, 4.5], i(v1) = [-0.003, -0.002, -0.0014999999999999996]
```

### A15. .dc can sweep the temperature (temp-sweep, in °C)

The scale is `temp-sweep` (°C).

```spice
* .dc sweeping the temperature
V1 a 0 6
R1 a 0 1k
.dc TEMP 0 100 50
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 3
  rawfile: temp-sweep = [0, 50, 100], v(a) = [6, 6, 6], i(v1) = [-0.006, -0.006, -0.006]
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 3
  vectors: temp-sweep = [0, 50, 100], v(a) = [6, 6, 6], i(v1) = [-0.006, -0.006, -0.006]
```

### A16. .tran 10u 5m: ngspice picks its own time points, at most 10 µs apart, from 0 to 5 ms

T1: 520 time points from 0 to 5 ms, chosen by ngspice; the largest step is 10 µs, the tstep.

```spice
* T1 (ours): an RC circuit charging, with .tran
V1 in 0 PULSE(0 5 0 1u 1u 1 2)
R1 in out 1k
C1 out 0 1u
.tran 10u 5m
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    in                                           0
    out                                          0
    v1#branch                                    0
    No. of Data Rows : 520
  rawfile: time: 520 points from 0 to 0.005, largest step 0.00001, v(out): 520 points from 0 to 4.9662948154327164
ngspice 42, ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    in                                           0
    out                                          0
    v1#branch                                    0
    No. of Data Rows : 519
  rawfile: time: 519 points from 0 to 0.005, largest step 0.00001, v(out): 519 points from 0 to 4.966294816661053
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    in                                           0
    out                                          0
    v1#branch                                    0
    No. of Data Rows : 520
  vectors: time: 520 points from 0 to 0.005, largest step 0.00001, v(out): 520 points from 0 to 4.9662948154327164
```

### A17. When tstep is larger than (tstop − tstart)/50, the largest step is (tstop − tstart)/50

Here tstep (1 ms) is more than (5 ms − 0)/50 = 0.1 ms, so the largest step is 0.1 ms: 73 points.

```spice
* .tran with a large tstep
V1 in 0 PULSE(0 5 0 1u 1u 1 2)
R1 in out 1k
C1 out 0 1u
.tran 1m 5m
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    in                                           0
    out                                          0
    v1#branch                                    0
    No. of Data Rows : 73
  rawfile: time: 73 points from 0 to 0.005, largest step 0.0001
ngspice 42: the same output, exit code and summary as ngspice 47; its last point before the corner at 1 µs is
  at 8.693e-7 s, where 47's is at 7.196e-7 s, and from there its time points part from 47's (60 of the 73
  differ), and the values with them; its last point is the same to 7 significant figures (v(out) = 4.966430 V)
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    in                                           0
    out                                          0
    v1#branch                                    0
    No. of Data Rows : 73
  vectors: time: 73 points from 0 to 0.005, largest step 0.0001
```

### A18. tmax, the fourth number, sets the largest step

With tmax = 2 µs the largest step is 2 µs: 2517 points.

```spice
* .tran with tmax
V1 in 0 PULSE(0 5 0 1u 1u 1 2)
R1 in out 1k
C1 out 0 1u
.tran 10u 5m 0 2u
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    in                                           0
    out                                          0
    v1#branch                                    0
    No. of Data Rows : 2517
  rawfile: time: 2517 points from 0 to 0.005, largest step 0.000002
ngspice 42: the same output, exit code and summary as ngspice 47; its last point before the corner at 1 µs is
  at 8.693e-7 s, where 47's is at 7.196e-7 s, and from there its time points part from 47's (2504 of the 2517
  differ), and the values with them; its last point is the same to 9 significant figures (v(out) = 4.96629347 V)
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    in                                           0
    out                                          0
    v1#branch                                    0
    No. of Data Rows : 2517
  vectors: time: 2517 points from 0 to 0.005, largest step 0.000002
```

### A19. tstart, the third number, is where the saved results begin

With tstart = 2 ms the saved results begin at about 2 ms (2.005 ms here) and end at 5 ms: 301 points.

```spice
* .tran with tstart
V1 in 0 PULSE(0 5 0 1u 1u 1 2)
R1 in out 1k
C1 out 0 1u
.tran 10u 5m 2m
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    in                                           0
    out                                          0
    v1#branch                                    0
    No. of Data Rows : 301
  rawfile: time: 301 points from 0.0020052993070292045 to 0.005, largest step 0.00001
ngspice 42, ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    in                                           0
    out                                          0
    v1#branch                                    0
    No. of Data Rows : 301
  rawfile: time: 301 points from 0.0020019241048268846 to 0.005, largest step 0.00001
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    in                                           0
    out                                          0
    v1#branch                                    0
    No. of Data Rows : 301
  vectors: time: 301 points from 0.0020052993070292045 to 0.005, largest step 0.00001
```

### A20. .ac dec 10 1 1k: 10 points per decade from 1 Hz to 1 kHz, 31 points

From 1 Hz to 1 kHz is 3 decades: 30 steps of 10^(1/10), 31 points.

```spice
* .ac with 10 points per decade
V1 a 0 AC 1
R1 a b 1k
C1 b 0 1u
.ac dec 10 1 1k
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 31
    Note: v1: has no value, DC 0 assumed
  rawfile: frequency: 31 points from 1 to 1000.000000000002, largest step 205.671765276
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 31
    Note: v1: has no value, DC 0 assumed
  vectors: frequency: 31 points from 1 to 1000.000000000002, largest step 205.671765276
  diagnostics: no-value-dc0 (v1)
```

### A21. .ac oct 2 1 8: 2 points per octave from 1 Hz to 8 Hz, 7 points

From 1 Hz to 8 Hz is 3 octaves: 6 steps of 2^(1/2), 7 points (1, 1.414, 2, ... 8 Hz).

```spice
* .ac with 2 points per octave
V1 a 0 AC 1
R1 a b 1k
C1 b 0 1u
.ac oct 2 1 8
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 7
    Note: v1: has no value, DC 0 assumed
  rawfile: frequency = [1, 1.414213562373095, 1.9999999999999996, 2.8284271247461894, 3.9999999999999987, 5.656854249492378, 7.9999999999999964]
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 7
    Note: v1: has no value, DC 0 assumed
  vectors: frequency = [1, 1.414213562373095, 1.9999999999999996, 2.8284271247461894, 3.9999999999999987, 5.656854249492378, 7.9999999999999964]
  diagnostics: no-value-dc0 (v1)
```

### A22. .ac lin 5 1 2: 5 points in all, evenly spaced

5 points in all, 0.25 Hz apart.

```spice
* .ac with 5 points in all
V1 a 0 AC 1
R1 a b 1k
C1 b 0 1u
.ac lin 5 1 2
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 5
    Note: v1: has no value, DC 0 assumed
  rawfile: frequency = [1, 1.25, 1.5, 1.75, 2]
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 5
    Note: v1: has no value, DC 0 assumed
  vectors: frequency = [1, 1.25, 1.5, 1.75, 2]
  diagnostics: no-value-dc0 (v1)
```

### A22b. .ac lin with 2 points gives only 1 point (ngspice needs at least 3 to step)

ngspice computes the spacing only for 3 points or more; with 2 it computes just the first frequency.

```spice
* .ac lin 2
V1 a 0 AC 1
R1 a b 1k
C1 b 0 1u
.ac lin 2 1 2
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 1
    Note: v1: has no value, DC 0 assumed
  rawfile: frequency = 1
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 1
    Note: v1: has no value, DC 0 assumed
  vectors: frequency = 1
  diagnostics: no-value-dc0 (v1)
```

### A23. .param gives a name to a number; {name} uses it

R1 = {rval} = 2 kΩ, so 1 mA gives 2 V.

```spice
* .param gives a name to a number
.param rval=2k
I1 0 n1 1m
R1 n1 0 {rval}
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

### A24. With .save, the results file keeps only what .save names

The results file holds only v(out). (The batch printout of plain `ngspice -b` still lists every node, but our engine reads the results file.)

```spice
* .save keeps only what it names
V1 in 0 6
R1 in out 1k
R2 out 0 2k
.save v(out)
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out                              4.000000e+00
        in                               6.000000e+00
        v1#branch                        -2.00000e-03
  rawfile from ngspice -b -r (exit 0): v(out) = 4
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(out) = 4
```

### A25. When ngspice writes a results file, as PlainSpice runs it, it ignores .print

The .print line even names a node that does not exist; with a results file, ngspice ignores it and runs the sweep.

```spice
* .print naming a node that does not exist
V1 a 0 6
R1 a 0 2
.print dc v(b)
.dc V1 0 6 3
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 3
    .print line ignored since rawfile was produced.
  rawfile: v(v-sweep) = [0, 3, 6], v(a) = [0, 3, 6], i(v1) = [0, -1.5, -3]
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 3
    .print line ignored since rawfile was produced.
  vectors: v(v-sweep) = [0, 3, 6], v(a) = [0, 3, 6], i(v1) = [0, -1.5, -3]
```

### A25b. The same holds for .plot

```spice
* .plot in a run that writes a results file
V1 a 0 6
R1 a 0 2
.plot dc v(a)
.dc V1 0 6 3
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 3
    .plot line ignored since rawfile was produced.
  rawfile: v(v-sweep) = [0, 3, 6], v(a) = [0, 3, 6], i(v1) = [0, -1.5, -3]
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 3
    .plot line ignored since rawfile was produced.
  vectors: v(v-sweep) = [0, 3, 6], v(a) = [0, 3, 6], i(v1) = [0, -1.5, -3]
```

### A26. .include needs a file, and PlainSpice has none to give: ngspice stops

ngspice cannot find the file and stops with a fatal error. Our engine has no file system of the user's, so .include can never find a file there.

```spice
* .include a file
.include models.lib
V1 a 0 6
R1 a 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: Could not find include file models.lib
        While reading an-include.cir
    ERROR: fatal error in ngspice, exit(1)
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error: Could not find include file models.lib
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error: Could not find include file models.lib
        While reading circuit.cir
    ERROR: fatal error in ngspice, exit(1)
  vectors: (none)
  diagnostics: error, fatal
```

### A27. A .control block runs first, as ngspice commands; the results come from the dot commands

The block's `print v(a)` runs before the analysis ("vector a is not available"); then the .op line runs, and the results file holds its operating point.

```spice
* a .control block next to a .op line
V1 a 0 6
R1 a 0 2
.op
.control
print v(a)
.endc
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                6.000000e+00
        v1#branch                        -3.00000e+00
    Warning from checkvalid: vector a is not available or has zero length.
  rawfile from ngspice -b -r (exit 0): v(a) = 6, i(v1) = -3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    Warning from checkvalid: vector a is not available or has zero length.
  vectors: v(a) = 6, i(v1) = -3
  diagnostics: warning
```

### A28. ngspice skips .meas when it writes a results file, as PlainSpice runs it

The transient runs and its results are saved, but the measurement is skipped, with this message on stderr.

```spice
* .meas in a -r run
V1 in 0 PULSE(0 5 0 1u 1u 1 2)
R1 in out 1k
C1 out 0 1u
.tran 10u 5m
.meas tran vmax MAX v(out)
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    in                                           0
    out                                          0
    v1#branch                                    0
    No. of Data Rows : 520
    No .measure possible in batch mode (-b) with -r rawfile set!
    Remove rawfile and use .print or .plot or
    select interactive mode (optionally with .control section) instead.
  rawfile: time: 520 points from 0 to 0.005, largest step 0.00001
ngspice 42, ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    in                                           0
    out                                          0
    v1#branch                                    0
    No. of Data Rows : 519
    No .measure possible in batch mode (-b) with -r rawfile set!
    Remove rawfile and use .print or .plot or
    select interactive mode (optionally with .control section) instead.
  rawfile: time: 519 points from 0 to 0.005, largest step 0.00001
our engine (wasm), as ngspice -b -r (exit 0):
    Initial Transient Solution
    --------------------------
    Node                                   Voltage
    ----                                   -------
    in                                           0
    out                                          0
    v1#branch                                    0
    No. of Data Rows : 520
    No .measure possible in batch mode (-b) with -r rawfile set!
    Remove rawfile and use .print or .plot or
    select interactive mode (optionally with .control section) instead.
  vectors: time: 520 points from 0 to 0.005, largest step 0.00001
```

### A29. A dot command ngspice does not know stops it: unimplemented dot command

ngspice stops at the line: no results.

```spice
* an unknown dot command
V1 a 0 6
R1 a 0 2
.foo bar
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .foo bar
     unimplemented dot command '.foo'
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .foo bar
     unimplemented dot command '.foo'
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      .foo bar
     unimplemented dot command '.foo'
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none)
  diagnostics: circuit-not-parsed [line 4]
```

### A29b. .pss, .hb and .sens2 stop native ngspice 47 and our engine: unimplemented dot command

ngspice 47 built as for our engine has no periodic steady-state (.pss), harmonic balance (.hb) or .sens2 analysis, so these lines stop it like any unknown dot command. ngspice 42 knows .pss (unknown-dot-command-2 in traps.md); none of them knows .hb or .sens2.

```spice
* .hb in a netlist
V1 a 0 1
R1 a 0 1k
.hb
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .hb
     unimplemented dot command '.hb'
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .hb
     unimplemented dot command '.hb'
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      .hb
     unimplemented dot command '.hb'
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

### A29c. .sens2 stops them too

The same for .sens2, in ngspice 47 and 42 alike.

```spice
* .sens2 in a netlist
V1 a 0 1
R1 a 0 1k
.sens2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .sens2
     unimplemented dot command '.sens2'
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      .sens2
     unimplemented dot command '.sens2'
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  ngspice -b -r out.raw (exit 1), which also prints:
    Error: circuit not parsed.
    rawfile: (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      .sens2
     unimplemented dot command '.sens2'
        Simulation interrupted due to error!
    Error: circuit not parsed.
    vectors: (none)
```

### A30. .model types: D (diode), NPN and PNP (BJT), NJF (JFET), NMOS and PMOS (MOSFET), SW and CSW (switches)

Each model type is used by a part of the matching letter, and ngspice accepts them all (the numbers themselves do not matter here).

```spice
* .model types
V1 a 0 5
R1 a b 1k
D1 b 0 dmod
.model dmod D
R2 a c 1k
Q1 c c 0 qn
.model qn NPN
R3 a d 1k
Q2 0 0 d qp
.model qp PNP
R4 a e 1k
J1 e 0 0 jn
.model jn NJF
R5 a f 1k
M1 f a 0 0 mn
.model mn NMOS level=1
R6 a g 1k
M2 g 0 a a mp
.model mp PMOS level=1
R7 a h 1k
S1 h 0 a 0 sw1
.model sw1 SW
Vs a i 0
R8 i 0 1k
R9 a k 1k
W1 k 0 Vs csw1
.model csw1 CSW
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        k                                4.995005e-03
        i                                5.000000e+00
        h                                4.995005e-03
        g                                5.000000e+00
        f                                4.750622e+00
        e                                4.600000e+00
        d                                8.110232e-01
        c                                8.110232e-01
        b                                6.928876e-01
        a                                5.000000e+00
        v1#branch                        -2.83245e-02
        vs#branch                        5.000000e-03
  rawfile from ngspice -b -r (exit 0): v(b) = 0.6928875985993175, v(c) = 0.8110232441373441, v(d) = 0.8110232441423211, v(e) = 4.59999999539, v(f) = 4.750621889658553, v(g) = 5, v(h) = 0.004995004995004996, v(k) = 0.004995004995004996
ngspice 42, ngspice -b (exit 0):
        k                                4.995005e-03
        i                                5.000000e+00
        h                                4.995005e-03
        g                                5.000000e+00
        f                                4.750622e+00
        e                                4.600000e+00
        d                                8.110232e-01
        c                                8.110232e-01
        b                                6.928876e-01
        a                                5.000000e+00
        v1#branch                        -2.83245e-02
        vs#branch                        5.000000e-03
  rawfile from ngspice -b -r (exit 0): v(b) = 0.6928875988183998, v(c) = 0.8110232445277725, v(d) = 0.8110232445327493, v(e) = 4.59999999539, v(f) = 4.750621889658553, v(g) = 5, v(h) = 0.004995004995004996, v(k) = 0.004995004995004996
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(b) = 0.6928875985993175, v(c) = 0.8110232441373441, v(d) = 0.8110232441423211, v(e) = 4.59999999539, v(f) = 4.750621889658553, v(g) = 5, v(h) = 0.004995004995004996, v(k) = 0.004995004995004996
```

### A31. In a .dc sweep a capacitor is an open circuit and an inductor a short circuit too

At each point v(b) = V1/2, as if C1 were not there, and c and d sit at the same voltage, as if L1 were a wire.

```spice
* .dc with a capacitor and an inductor
V1 a 0 0
R1 a b 1k
C1 b 0 1u
R2 b 0 1k
R3 a c 1k
L1 c d 1m
R4 d 0 1k
.dc V1 0 2 1
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 3
  rawfile: v(v-sweep) = [0, 1, 2], v(b) = [0, 0.5, 1], v(c) = [0, 0.5, 1], v(d) = [0, 0.5, 1]
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 3
  vectors: v(v-sweep) = [0, 1, 2], v(b) = [0, 0.5, 1], v(c) = [0, 0.5, 1], v(d) = [0, 0.5, 1]
```

### A32. .ic sets a starting node voltage for .tran with uic

With `.ic v(out)=3` and uic, out starts at 3 V and discharges through R1.

```spice
* .ic with .tran uic
V1 in 0 0
R1 in out 1k
C1 out 0 1u
.ic v(out)=3
.tran 10u 1m uic
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    Operating point simulation skipped by 'uic',
      now using transient initial conditions.
    No. of Data Rows : 111
  rawfile: time: 111 points from 1e-7 to 0.001, largest step 0.00001, v(out): 111 points from 2.9997000299970007 to 1.103629591624538
ngspice 42, ngspice -b -r (exit 0):
    Using transient initial conditions
    No. of Data Rows : 111
  rawfile: time: 111 points from 1e-7 to 0.001, largest step 0.00001, v(out): 111 points from 2.9997000299970007 to 1.1036295255114383
our engine (wasm), as ngspice -b -r (exit 0):
    Operating point simulation skipped by 'uic',
      now using transient initial conditions.
    No. of Data Rows : 111
  vectors: time: 111 points from 1e-7 to 0.001, largest step 0.00001, v(out): 111 points from 2.9997000299970007 to 1.103629591624538
```

### A33. .lib also needs a file: ngspice stops

Like .include, .lib cannot find its file in our engine, and ngspice stops.

```spice
* .lib a file
.lib models.lib tt
V1 a 0 6
R1 a 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: Could not find library file models.lib
    ERROR, library file models.lib not found
    ERROR: fatal error in ngspice, exit(1)
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error: Could not find library file models.lib
    ERROR, library file models.lib not found
    ERROR: fatal error in ngspice, exit(1)
  vectors: (none)
  diagnostics: error, fatal
```

### A34. Dot commands ngspice knows, such as .global, .nodeset, .func, .temp and .noise, do not stop it

PlainSpice does not explain these lines yet, but ngspice reads them and runs: the run below gives results, with only the note about V1 having no DC value. (Plain `ngspice -b` stops at the .noise line for lack of a .print line; with a results file, as our engine runs it, everything runs.)

```spice
* dot commands ngspice knows
V1 a 0 AC 1
R1 a 0 1k
.global vdd
.nodeset v(a)=1
.width out=80
.func dbl(x) {2*x}
.temp 27
.csparam xx=1
.op
.noise v(a) V1 dec 1 1 10
.end
```

```text
ngspice 47, ngspice -b -r (exit 0):
    No. of Data Rows : 1
    No. of Data Rows : 2
    No. of Data Rows : 1
    Note: v1: has no value, DC 0 assumed
  rawfile: v(a) = 0
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    No. of Data Rows : 1
    No. of Data Rows : 2
    No. of Data Rows : 1
    Note: v1: has no value, DC 0 assumed
  vectors: v(a) = 0
  diagnostics: no-value-dc0 (v1)
```

### A35. .subckt … .ends defines a subcircuit; an X line uses it with its own nodes

X1 connects the subcircuit div between a and b: its two 1 kΩ resistors halve the 2 V at a, so b = 1 V.

```spice
* a subcircuit
.subckt div in out
R1 in out 1k
R2 out 0 1k
.ends
V1 a 0 2
X1 a b div
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                1.000000e+00
        a                                2.000000e+00
        v1#branch                        -1.00000e-03
  rawfile from ngspice -b -r (exit 0): v(a) = 2, v(b) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 2, v(b) = 1
```

### A36. A .control block runs even when the netlist has no analysis line

ngspice runs the commands in a .control block (here op and print), in batch mode too, so a netlist whose only analysis is inside .control does run. With a results file (-r) the block writes nothing to it, so PlainSpice has no results to show and points to the ngspice output tab.

```spice
* an operating point run from a .control block
V1 a 0 1
R1 a 0 1k
.control
op
print v(a)
.endc
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    v(a) = 1.000000e+00
    Note: Simulation executed from .control section
  ngspice -b -r out.raw (exit 0)
    rawfile: (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, no results):
     Reference value :  0.00000e+00
    v(a) = 1.000000e+00
    OP information in rawfile.
    vectors: (none)
```

### A3b. In .tf's v( ), gnd is ground, even beside an ordinary node called gnd

ngspice reads a gnd that a `)` or a `,` follows as node 0 (it rewrites the word before reading the line),
so `.tf v(out,gnd) V1` is v(out,0), the voltage at out measured from ground: ngspice names the output
`v(out,0)`, and the transfer function is out's 0.5. Here the circuit also has an ordinary node called
gnd, at 2.5 V in `.op` (`Vx x gnd`: as the last word of a line gnd is no ground, W9). Were the `.tf`'s
gnd that node, the output would be v(out) − v(gnd), whose transfer function is 0.5 − 0.5 = 0. So the
.tf words say "between node out and ground", never "node gnd" (code review 1, 12 November 2026).

```spice
* .tf: gnd in v( ) is ground, even beside an ordinary node called gnd
V1 in 0 5
R1 in out 1k
R2 out 0 1k
R3 in x 1k
Vx x gnd
R4 x 0 1k
.tf v(out,gnd) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Note: vx: has no value, DC 0 assumed
    Transfer function information:
    transfer_function = 5.000000e-01
    output_impedance_at_v(out,0) = 5.000000e+02
    v1#input_impedance = 1.000000e+03
  rawfile from ngspice -b -r (exit 0): v(Transfer_function) = 0.5, v(v1#Input_impedance) = 1000, v(output_impedance_at_V(out,0)) = 500
  the same netlist with .op for .tf, ngspice -b (exit 0): gnd 2.500000e+00, x 2.500000e+00, out 2.500000e+00, in 5.000000e+00; rawfile v(gnd) = 2.5
  the same netlist with .tf v(gnd) V1, ngspice -b (exit 0):
    Note: vx: has no value, DC 0 assumed
    Transfer function information:
    transfer_function = 0.000000e+00
    output_impedance_at_v(0) = 0.000000e+00
    v1#input_impedance = 1.000000e+03
  rawfile from ngspice -b -r (exit 0): v(Transfer_function) = 0, v(v1#Input_impedance) = 1000, v(output_impedance_at_V(0)) = 0
ngspice 42: the same printouts, exit codes and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, the note "vx: has no value, DC 0 assumed"):
  vectors: v(Transfer_function) = 0.5, v(v1#Input_impedance) = 1000, v(output_impedance_at_V(out,0)) = 500; with .op: v(gnd) = 2.5;
  with .tf v(gnd) V1: v(Transfer_function) = 0, v(v1#Input_impedance) = 1000, v(output_impedance_at_V(0)) = 0
```

`.tf v(gnd) V1` alone is the voltage at ground, 0 (ngspice names it `v(0)`), not that of the ordinary
node gnd, whose transfer function would be 0.5. So the .tf check never offers "Use gnd" for a typo of
such a node: written in `v( )`, the name would measure ground (12 November 2026).

### A3c. A .tf written after .end runs too, and ngspice names its output in its own words

ngspice keeps reading after a plain `.end` (S25 in numbers-and-syntax.md), so a `.tf` written there
runs. PlainSpice does not read lines after `.end` as dot commands (the after-end check asks for them
to be moved), so its .tf words take the nodes from ngspice's own name for the output,
`output_impedance_at_v(out,mid)`: "between node out and node mid", as for a `.tf` above `.end` (code
review 5, 12 November 2026). out − mid is 5 V × 1k/3k, a transfer function of 1/3; V1 sees 3 kΩ; and
between out and mid the resistance is R2 ∥ (R1 + R3) = 1k ∥ 2k = 666.7 Ω.

```spice
* a .tf written after .end
V1 in 0 5
R1 in out 1k
R2 out mid 1k
R3 mid 0 1k
.end
.tf v(out,mid) V1
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 3.333333e-01
    output_impedance_at_v(out,mid) = 6.666667e+02
    v1#input_impedance = 3.000000e+03
  rawfile from ngspice -b -r (exit 0): v(Transfer_function) = 0.3333333333333333, v(v1#Input_impedance) = 2999.9999999999995, v(output_impedance_at_V(out,mid)) = 666.6666666666667
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(Transfer_function) = 0.3333333333333333, v(v1#Input_impedance) = 2999.9999999999995, v(output_impedance_at_V(out,mid)) = 666.6666666666667
```

### A3d. After .end too, a current source as the input makes the transfer function V/A

A4's netlist with its `.tf` written after `.end`: ngspice runs it and gives A4's three numbers, so the
transfer function is 1 V per ampere, not "1 (V/V)". PlainSpice has no reading of a line after `.end`
(A3c), so its .tf words take the input's kind from the part ngspice names (`i1#input_impedance` is I1,
a current source): "1 volt per amp, which is an ohm", as for A4 (critic of the words re-check's fix,
12 November 2026).

```spice
* .tf with a current source as the input, written after .end
I1 0 a 1
R1 a 0 4
R2 a b 2
R3 b 0 2
.end
.tf v(b) I1
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 1.000000e+00
    i1#input_impedance = 2.000000e+00
    output_impedance_at_v(b) = 1.500000e+00
  rawfile from ngspice -b -r (exit 0): v(Transfer_function) = 1, v(i1#Input_impedance) = 2, v(output_impedance_at_V(b)) = 1.5
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(Transfer_function) = 1, v(i1#Input_impedance) = 2, v(output_impedance_at_V(b)) = 1.5
```

### A3e. After .end too, a current output is the current in its source: i(Vm), A/A from a current source

A current source drives a current output, with the `.tf` after `.end`. I1 pushes 1 A into a; all of it
flows through R1 to b, where it splits between R3 (6 Ω) and Vm with R2 (3 Ω): i(Vm) = 1 A × 6/9 = 2/3
A, a transfer function of 2/3 A per ampere. I1 sees R1 + (6 Ω ∥ 3 Ω) = 4 Ω, and for a current output
ngspice's output impedance is 1e20 Ω, as in A5. ngspice names the output by its source
(`vm#output_impedance`), so PlainSpice's words name that part as the netlist writes it, "i(Vm)" and
"the current in Vm", where they said "i(vm)" and "the current in i(vm)", and in A/A (critic of the
words re-check's fix, 12 November 2026). Written above `.end`, the same netlist gives the same three
numbers.

```spice
* .tf from a current source to a current, written after .end
I1 0 a 1
R1 a b 2
Vm b c 0
R2 c 0 3
R3 b 0 6
.end
.tf i(Vm) I1
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 6.666667e-01
    i1#input_impedance = 4.000000e+00
    vm#output_impedance = 1.000000e+20
  rawfile from ngspice -b -r (exit 0): v(Transfer_function) = 0.6666666666666667, v(i1#Input_impedance) = 4, v(vm#Output_impedance) = 100000000000000000000
  the same with the .tf above .end, ngspice -b (exit 0): the same printout and rawfile values
ngspice 42: the same printouts, exit codes and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(Transfer_function) = 0.6666666666666667, v(i1#Input_impedance) = 4, v(vm#Output_impedance) = 100000000000000000000
```

### A3f. An analysis line in a subcircuit the main circuit does not use is skipped; in one it uses, it runs as the main circuit's

Added after the second critic of the words re-check's fix (12 November 2026). A `.tf` between `.subckt`
and `.ends` is not the circuit's `.tf` when no X line uses that subcircuit: ngspice skips it, and runs
the `.tf v(out)` after `.ends` (0.5 and 500 Ω), which the words named "Transfer function v(a,gnd) / V1"
until then, with an error that said ngspice makes a new node for a. With nothing else, nothing runs:
the same for `.op`, `.dc`, `.tran`, `.ac` and `.noise` there. So the words, the checks and the overview leave
such a line out, and Explain says that ngspice skips it. When an X line uses the subcircuit, ngspice
runs the line as if the main circuit had it, once for each such X line, with the main circuit's node
names: `.tf v(out)` there is the main circuit's out, and `.tf v(a)` a new node a with nothing on it (0
and 1 Ω, as tf-problems-1), not the subcircuit's a; so such a line is read and checked as one in the
main circuit.

```spice
* a .tf inside a subcircuit, and one in the main circuit
V1 in 0 5
R1 in out 1k
R2 out 0 1k
.subckt s a b
R9 a b 1k
.tf v(a,gnd) V1
.ends
.tf v(out) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 5.000000e-01
    output_impedance_at_v(out) = 5.000000e+02
    v1#input_impedance = 2.000000e+03
  rawfile from ngspice -b -r (exit 0): v(Transfer_function) = 0.5, v(v1#Input_impedance) = 2000, v(output_impedance_at_V(out)) = 500
  without the .tf v(out) line, and .op in its place: v(in) = 5, v(out) = 2.5, and no transfer function
  with no other analysis line, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0): no rawfile; the same with .op, .dc V1 0 5 1, .tran 1m 5m,
    .ac dec 1 1k 10k or .noise v(out) V1 dec 1 1k 10k (V1 in 0 AC 1 for the last two) in the
    subcircuit instead of the .tf, where in the main circuit .noise gives its two plots
  with X1 out 0 s (the subcircuit used), .tf v(out) V1 inside it and .op after .ends, ngspice -b (exit 0):
    transfer_function = 3.333333e-01
    output_impedance_at_v(out) = 3.333333e+02
    v1#input_impedance = 1.500000e+03
  the same with .tf v(a) V1 inside it: transfer_function = 0.000000e+00, output_impedance_at_v(a) = 1.000000e+00
  the same as the first with X2 in 0 s too: two "Transfer function information" blocks, each 1/3 and 333.3 Ω
ngspice 42: the same printouts, exit codes and rawfile values as ngspice 47, except "Note: No ".plot",
  ".print", or ".fourier" lines; no simulations run" in -b mode, and an exit code of 1 in -b mode for the
  used subcircuit ("no data saved for D.C. Operating point analysis"), whose rawfile is the same
our engine (wasm), as ngspice -b -r:
  exit 0, vectors: v(Transfer_function) = 0.5, v(v1#Input_impedance) = 2000, v(output_impedance_at_V(out)) = 500;
  no results for the others with no analysis outside the subcircuit; with X1: 0.3333333333333333 and 333.3333333333333;
  with v(a): 0 and 1; with X1 and X2: two Transfer Function plots
```

"Skipped" is the word for a whole line ngspice does not read (W11), and it runs none of such a
subcircuit's analysis lines, parts and dot commands: a `.tran` and a dot command it stops at anywhere
else say nothing there, and the `.op` after `.ends` runs; in a subcircuit an X line uses, the same lines
stop it (13 November 2026, the last pass: F2; the netlists are golden rows an-skip-unused,
an-skip-used-tran and an-skip-used-dot). It still reads an `.include` there, as below, so the words use
"skips" for its analysis lines, never for every line of the subcircuit (the round-1 critic of the last
pass's fixes, critic1-8).

```spice
* lines ngspice would stop at, in a subcircuit no X line uses
V1 in 0 5
R1 in out 1k
R2 out 0 1k
.subckt s a b
R9 a b 1k
.tran 0 -1
.foo bar
.ends
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0): out 2.500000e+00, in 5.000000e+00, v1#branch -2.50000e-03, and no other message
  rawfile from ngspice -b -r (exit 0, no message): v(in) = 5, v(out) = 2.5, i(v1) = -0.0025
  with X1 out 0 s before the .op and the .tran alone in the subcircuit, ngspice -b (exit 1):
    Error on line 7 or its substitute:
      .tran 0 -1
    TSTEP is invalid, must be greater than zero.
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r (exit 1): the same first four lines, then "Error: circuit not parsed.", and no rawfile
  the same with .foo bar alone in that subcircuit: " unimplemented dot command '.foo'" in place of the
    TSTEP line, exit 1, and no rawfile with -r
ngspice 42: the same values and exit codes, with "Error on line:" for "Error on line 7 or its
  substitute:" and 'Note: No ".plot", ".print", or ".fourier" lines; no simulations run' for the -b
  ending
our engine (wasm), as ngspice -b -r: exit 0, vectors: v(in) = 5, v(out) = 2.5, i(v1) = -0.0025;
  with X1: exit 1, "TSTEP is invalid, must be greater than zero." and "unimplemented dot command
  '.foo'", no results
```

When every analysis line is in such a subcircuit, ngspice runs nothing and, with a results file, says
nothing about it. PlainSpice's results say why, as the run's first message and in the status line,
never "ngspice printed no message that says why" (last pass F3): ".tf is inside the subcircuit s,
which no X line uses", with "ngspice skips an analysis line between .subckt and .ends when no X line
uses that subcircuit, so it ran nothing …" and the line to go to; for `.ac` and `.noise`, before
ngspice's note that V1 has no DC value, which is no reason. These are golden rows
an-tf-subckt-alone, an-op-subckt, an-dc-subckt, an-tran-subckt, an-ac-subckt and an-noise-subckt.

The main circuit uses a subcircuit through its own X lines, and then through the X lines of each
subcircuit it uses; ngspice skips the analysis lines of every other subcircuit, so also of one that only
an X line inside a skipped subcircuit uses (13 November 2026, the round-1 critic of the last pass's
fixes, critic1-4: PlainSpice counted any X line as a use, so its status said ngspice gave no reason,
Explain called the `.op` one that runs, and an `.ac` there got "V1 has no value" as the reason). Here
inner is used only by X2, and X2 is a line of outer, which no X line uses: ngspice runs nothing and,
with a results file, says nothing, as above. The words say why and name the X lines: ".op is inside
the subcircuit inner, which only X2 uses, and X2 is inside the subcircuit outer, which no X line uses",
with "ngspice skips an analysis line between .subckt and .ends unless the main circuit uses that
subcircuit, through its own X lines or those of the subcircuits they use, …"; Explain's note on the line
says the same with each subcircuit's line. Where X lines in two such subcircuits use inner, or two
subcircuits use only each other, they say inner (or the last one named) is one "which the main circuit
does not use, directly or through other subcircuits".

```spice
* .op in inner, which only X2 uses, inside outer, which no X line uses
V1 in 0 5
R1 in out 1k
R2 out 0 1k
.subckt outer p q
X2 p q inner
.ends
.subckt inner a b
R9 a b 1k
.op
.ends
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  ngspice -b -r out.raw (exit 0): no rawfile, and no message
  the same, exit codes and all, with .ac dec 1 1k 10k there in place of the .op (V1 in 0 AC 1), where
    -b -r prints only "Note: v1: has no value, DC 0 assumed"; two steps out (.subckt top holding
    X3 p q mid, .subckt mid holding X2 p q inner); with inner used by X2 in outer and by X3 in a
    second subcircuit other, neither used; with X1 a b outer inside inner (a loop, the main circuit
    using neither); with .subckt inner … .ends written inside outer; and with an .op in a subcircuit s
    no X line uses beside a .tf v(out) V1 in inner (the words: "The analysis lines are inside
    subcircuits that the main circuit does not use, directly or through other subcircuits")
  with X1 out 0 outer in the main circuit and .tf v(out) V1 in place of the .op, ngspice -b (exit 0):
    transfer_function = 3.333333e-01
    output_impedance_at_v(out) = 3.333333e+02
    v1#input_impedance = 1.500000e+03
  rawfile: v(Transfer_function) = 0.3333333333333333, v(v1#Input_impedance) = 1499.9999999999998, v(output_impedance_at_V(out)) = 333.3333333333333
ngspice 42: the same exit codes, notes and rawfile values, with 'Note: No ".plot", ".print", or
  ".fourier" lines; no simulations run' for the -b ending
our engine (wasm), as ngspice -b -r: no results for each skipped one, with only the note about V1 for
  the .ac; with X1: the same vectors, bit for bit (golden rows an-skip-through, -through-ac,
  -through-two, -through-several, -through-loop, -through-nested, -through-mixed and
  an-tf-subckt-through-used)
```

ngspice counts the lines it reads that start with `.subckt` and with `.ends` (all but the title line,
the lines after `.end` too, up to a line starting with @), and when the counts differ it stops before it
builds anything: "Mismatch of .subckt ... .ends statements!" (inp_check_syntax in inpcom.c). So with a
`.subckt` and no `.ends`, the `.op` after it is not skipped as above: ngspice stops, and moving the `.op`
out of the subcircuit would not help, as the missing line is `.ends` (the round-1 critic, critic1-1:
Explain said "ngspice skips this line … Put analysis lines in the main circuit"). The overview and
Explain then say nothing of skipping, and ngspice's message is the run's reason. The same with another
`.subckt` left open, or one `.ends` too many. ngspice counts no `.macro` and no `.eom` (it renames them
later), and an `.ends` after `.end` counts: with those, the counts pair up, and the `.op` is skipped as
above, with nothing said.

```spice
* a .subckt with no .ends, and the .op after it
V1 in 0 5
R1 in out 1k
R2 out 0 1k
.subckt s a b
R9 a b 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1), the same with -b -r (no rawfile):
    Error: Mismatch of .subckt ... .ends statements!
        in file an-skip-no-ends.cir
        This will cause subsequent errors.
    Check line .subckt s a b
    ERROR: fatal error in ngspice, exit(1)
  the same, with "Check line .subckt t c d", with .ends after the .op and then .subckt t c d and
    R8 c d 1k, with no .ends; and with "Check .ends in line number 9" with two .ends after the .op
  with the .op in the main circuit, above a .subckt s a b and R9 a b 1k with no .ends: the same
    message when spaces come before .subckt, and when the two lines come after .end or after
    ".end;stop"; after a line starting with @, where ngspice stops reading, none: the .op runs
    (in = 5, out = 2.5)
  with .ends written after .end, ngspice -b (exit 1): "no simulations run!"; -b -r (exit 0): no
    rawfile and no message, as above; the same with .macro s a b in place of .subckt s a b
ngspice 42: the same messages and exit codes, without the "in file" line, and 'Note: No ".plot",
  ".print", or ".fourier" lines; no simulations run' for the -b ending of the last two
our engine (wasm), as ngspice -b -r: exit 1 and "Mismatch of .subckt ... .ends statements!" for the
  first three, no results and no message for the last two (golden rows an-skip-no-ends,
  -open-other, -extra-ends, -ends-after-end and -macro-open)
```

When ngspice stops at another line first, that line's message is the run's reason, never this one
beside it: with `.foo bar` in the main circuit and the `.op` in a subcircuit no X line uses, ngspice
47 and 42 stop at the `.foo` (" unimplemented dot command '.foo'", exit 1, with -b and -b -r), and the
words say only that (golden row an-skip-stopped). And ngspice still reads an `.include` inside such a
subcircuit: with `.include nosuchfile.cir` there and the `.op` after `.ends`, 47 and 42 stop with
"Error: Could not find include file nosuchfile.cir" (exit 1, with -b and -b -r; 47 adds "ERROR: fatal
error in ngspice, exit(1)", 42 "Error: there aren't any circuits loaded." with -r), as our engine does
(golden row an-skip-include).

### A3g. In a subcircuit an X line uses, a gnd in a .tf's v( ) is ground too

ngspice turns gnd into 0 on every line before it runs a `.tf` between `.subckt` and `.ends` as the main
circuit's (A3f), the subcircuit's lines included (inp_fix_gnd_name, as A3b), so `.tf v(out,gnd) V1`
there is v(out,0): ngspice names its output `v(out,0)`, and out's transfer function is 1/3 (R1 against
R2 ∥ R9, 1k against 500 Ω). The words say "between node out and ground", as for the same line above
`.subckt`, never 'node "gnd"', and give no warning that gnd is not a node (last pass regress-2: they
said '"gnd" is not a node of the circuit … these .tf numbers mean nothing' under the right 0.3333). A
node of the subcircuit's own, `v(a,gnd)`, is a new node with nothing on it (A3f): 0 and 1 Ω, one
warning, for a; written `v(a,zz)`, with a second new node, 2 Ω. Beside an ordinary node called gnd
(`Vx x gnd`, W9), the `.tf`'s gnd is still ground.

```spice
* a .tf inside a subcircuit an X line uses, measured from gnd
V1 in 0 5
R1 in out 1k
R2 out 0 1k
.subckt s a b
R9 a b 1k
.tf v(out,gnd) V1
.ends
X1 out 0 s
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 3.333333e-01
    output_impedance_at_v(out,0) = 3.333333e+02
    v1#input_impedance = 1.500000e+03
  rawfile from ngspice -b -r (exit 0): v(Transfer_function) = 0.3333333333333333, v(v1#Input_impedance) = 1499.9999999999998, v(output_impedance_at_V(out,0)) = 333.3333333333333
  the same with .tf v(a,gnd) V1 in the subcircuit, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 0.000000e+00
    output_impedance_at_v(a,0) = 1.000000e+00
    v1#input_impedance = 1.500000e+03
  rawfile: v(Transfer_function) = 0, v(v1#Input_impedance) = 1499.9999999999998, v(output_impedance_at_V(a,0)) = 1
  with .tf v(a,zz) V1: output_impedance_at_v(a,zz) = 2.000000e+00, transfer_function = 0.000000e+00;
    rawfile v(output_impedance_at_V(a,zz)) = 2
  with .tf v(gnd) V1: output_impedance_at_v(0) = 0.000000e+00, transfer_function = 0.000000e+00;
    rawfile v(output_impedance_at_V(0)) = 0
  with R3 in x 1k, Vx x gnd and R4 x 0 1k added (an ordinary node gnd, at 2.5 V), ngspice -b (exit 0):
    Note: vx: has no value, DC 0 assumed
    Transfer function information:
    transfer_function = 3.333333e-01
    output_impedance_at_v(out,0) = 3.333333e+02
    v1#input_impedance = 8.571429e+02
  rawfile: v(Transfer_function) = 0.3333333333333333, v(v1#Input_impedance) = 857.1428571428571, v(output_impedance_at_V(out,0)) = 333.3333333333333
ngspice 42: the same printouts, exit codes and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): the same vectors, bit for bit, in each of the five
  (golden rows an-tf-subckt-gnd, -gnd-a, -gnd-zz, -gnd-alone and -gnd-beside)
```

### A3h. ngspice names a node inside a subcircuit by its X lines, a dot and its own name, and a .tf can ask about it

ngspice builds a subcircuit once for each X line that uses it, and names each node of the
subcircuit's own (not a node of its `.subckt` line, which takes the X line's node, and not ground) by
that X line, a dot and the node: m inside X1 is `x1.m`, in lower case. With subcircuits inside
subcircuits it names them all, from the main circuit's X line down: m of the subcircuit X2 uses, X2
being a line of the subcircuit X1 uses, is `x1.x2.m`, and that subcircuit's own n is `x1.n`. So `.tf
v(x1.m) V1` measures the node m inside X1: here 0.5 and 500 Ω (R1 and R2 halve 10 V, and R3 carries no
current). Capitals do not matter (`X1.M`), and an X line after `.end`, which ngspice reads (S25),
counts too. PlainSpice took such a name for a node no part connects to: an error ('.tf asks about node
x1.m, which is not in the circuit') and a warning that the numbers mean nothing, under the right ones
(last pass C3-6). Now the checks and the words read it as ngspice does, and Explain says which node it
is: "x1.m is ngspice's name for node m of the subcircuit div (from line 4), inside X1". A dotted name
that is no such node keeps the error, as ngspice makes it a new node with nothing on it (0 and 1 Ω,
tf-problems-1): `x1.a`, a node of the `.subckt` line, and `x2.m`, where X2 is a line only of a
subcircuit no X line uses (A3f).

```spice
* a .tf of the node m inside the subcircuit X1 uses
V1 in 0 10
X1 in out div
.subckt div a b
R1 a m 1k
R2 m 0 1k
R3 m b 1
.ends
.tf v(x1.m) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 5.000000e-01
    output_impedance_at_v(x1.m) = 5.000000e+02
    v1#input_impedance = 2.000000e+03
  rawfile from ngspice -b -r (exit 0): v(Transfer_function) = 0.5000000000000551, v(v1#Input_impedance) = 2000.0000000002203, v(output_impedance_at_V(x1.m)) = 500.0000000000551
  the same with .tf v(X1.M) V1, and with X1 in out div written after .end: the same printout (named
    v(x1.m)) and rawfile values
  with .tf v(x1.a) V1: transfer_function = 0.000000e+00, output_impedance_at_v(x1.a) = 1.000000e+00,
    v1#input_impedance = 2.000000e+03; rawfile v(output_impedance_at_V(x1.a)) = 1
  nested, X1 in out outer and R9 out 0 1k, with .subckt outer p q: R1 p n 1k, X2 n q inner, and
    .subckt inner a b: R2 a m 1k, R3 m 0 1k, R4 m b 1k; with .op, ngspice -b (exit 0):
        out                              1.250000e+00
        x1.x2.m                          2.500000e+00
        x1.n                             6.250000e+00
        in                               1.000000e+01
        v1#branch                        -3.75000e-03
    and its devices r.x1.r1, r.x1.x2.r2, r.x1.x2.r3, r.x1.x2.r4 and r9;
    rawfile v(in) = 10, v(x1.n) = 6.25, v(x1.x2.m) = 2.5, v(out) = 1.25, i(v1) = -0.00375
  with .tf v(x1.x2.m) V1 there: transfer_function = 2.500000e-01, output_impedance_at_v(x1.x2.m) =
    5.000000e+02, v1#input_impedance = 2.666667e+03; rawfile 0.25, 2666.6666666666665 and 500
  with .tf v(x1.n) V1 there: transfer_function = 6.250000e-01, output_impedance_at_v(x1.n) =
    6.250000e+02; rawfile 0.625, 2666.6666666666665 and 625
  with V1 in 0 10 and R9 in 0 1k, .subckt outer p q holding only X2 p q div, no X line using outer,
    and .tf v(x2.m) V1: transfer_function = 0.000000e+00, output_impedance_at_v(x2.m) =
    1.000000e+00, v1#input_impedance = 1.000000e+03; rawfile 0, 1000 and 1
ngspice 42: the same printouts, exit codes and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): the same vectors, bit for bit, in each (golden rows
  an-tf-inner, -inner-caps, -inner-after-end, an-op-inner-nested, an-tf-inner-nested, -inner-outer,
  -inner-port and -inner-unused)
```

ngspice names a part there the same way, after its first letter: Vs inside X1 is `v.x1.vs` (as in
its device list, `r.x1.x2.r4` above), and a `.tf` can take it as its input (0.3333 and 1.5 kΩ, the
input named `v.x1.vs#input_impedance`) or its `i( )` (3.333e-4 A/V); a current source there,
`i.x1.is`, makes the transfer function V/A. So the .tf check, the words and Explain read such a name
as that part, and Explain says which ("v.x1.vs is ngspice's name for Vs of the subcircuit div …"),
where the check said ngspice stops ("Transfer function source v.x1.vs not in circuit") and Explain
that it runs no analysis (the skeptic of C3-6). `x1.vs` is no part's name: 0 and 1e20 Ω, as
tf-problems-5, and the error stays. A node a `.global` line names is the main circuit's, not one of the
subcircuit's own: `x1.vdd` is a new node (0 and 1 Ω), while `x1.m` beside it is still m inside X1.

```spice
* a .tf whose input is the source Vs inside X1
V1 in 0 10
X1 in out div
.subckt div a b
R1 a m 1k
R2 m 0 1k
R3 m b 1
Vs m q 0
R4 q 0 1k
.ends
.tf v(out) v.x1.vs
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 3.333333e-01
    output_impedance_at_v(out) = 3.343333e+02
    v.x1.vs#input_impedance = 1.500000e+03
  rawfile from ngspice -b -r (exit 0): v(Transfer_function) = 0.33333333333335785, v(v.x1.vs#Input_impedance) = 1500.000000000055, v(output_impedance_at_V(out)) = 334.3333333333578
  with .tf i(v.x1.vs) V1: transfer_function = 3.333333e-04, v.x1.vs#output_impedance = 1.000000e+20,
    v1#input_impedance = 1.500000e+03; rawfile 0.0003333333333333578, 1500.000000000055 and 1e20
  with .tf i(x1.vs) V1: transfer_function = 0.000000e+00, v1#input_impedance = 1.500000e+03,
    x1.vs#output_impedance = 1.000000e+20; rawfile 0, 1500.000000000055 and 1e20
  with Is 0 m 1m in place of Vs and R4, and .tf v(out) i.x1.is: transfer_function = 5.000000e+02,
    i.x1.is#input_impedance = 5.000000e+02, output_impedance_at_v(out) = 5.010000e+02; rawfile
    500.0000000000551, 500.0000000000551 and 501.0000000000551
  .global vdd, Vd vdd 0 2, and R2 m vdd 1k in place of R2 m 0 1k (no Vs, no R4), .tf v(x1.vdd) V1:
    transfer_function = 0.000000e+00, output_impedance_at_v(x1.vdd) = 1.000000e+00,
    v1#input_impedance = 2.000000e+03; rawfile 0, 2000.0000000002203 and 1; the same with .tf
    v(x1.m) V1: 5.000000e-01, 5.000000e+02 and 2.000000e+03; rawfile 0.5000000000000551,
    2000.0000000002203 and 500.0000000000551
ngspice 42: the same printouts, exit codes and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): the same vectors, bit for bit, in each (golden rows
  an-tf-inner-input, -inner-current, -inner-current-plain, -inner-isource, -inner-global and
  -inner-global-m)
```

A name ngspice builds this way may hold a dot of the netlist's own, in the node's name, the X line's or
the part's: m.1 inside X1 is `x1.m.1`, m inside X1.a is `x1.a.m`, Vs.1 inside X1 is `v.x1.vs.1`, and m.1
inside X2, inside X1, is `x1.x2.m.1` (13 November 2026, the round-1 critic of the last pass's fixes,
critic1-3: PlainSpice split such a name at every dot and gave `x1.m.1` the error of a node no part
connects to, beside the right 0.5). PlainSpice reads it back as ngspice builds it: each X line whose name
starts what is left, then a node or part of the subcircuit that X line uses. A name with no such node
keeps its error, as ngspice makes it a new node with nothing on it: `x1.m.1` where the subcircuit has m
and no m.1; and ground is the main circuit's, so `x1.0`, and `x1.gnd` where the subcircuit's gnd is
ground, are new nodes too (0 and 1 Ω). A part's name starts with its own letter: `i.x1.vs` names no part
when Vs is a voltage source, and ngspice stops (the round-1 critic, critic1-5).

```spice
* a .tf of the node m.1 inside X1
V1 in 0 10
X1 in out div
.subckt div a b
R1 a m.1 1k
R2 m.1 0 1k
R3 m.1 b 1
.ends
.tf v(x1.m.1) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Transfer function information:
    transfer_function = 5.000000e-01
    output_impedance_at_v(x1.m.1) = 5.000000e+02
    v1#input_impedance = 2.000000e+03
  rawfile from ngspice -b -r (exit 0): v(Transfer_function) = 0.5000000000000551, v(v1#Input_impedance) = 2000.0000000002203, v(output_impedance_at_V(x1.m.1)) = 500.0000000000551
  with .op in place of the .tf: x1.m.1 5.000000e+00 among the node voltages; rawfile v(in) = 10,
    v(x1.m.1) = 5.000000000000551, v(out) = 5.000000000000551, i(v1) = -0.004999999999999449
  with X1.a in out div, m in place of m.1, and .tf v(x1.a.m) V1: the same numbers, named
    output_impedance_at_v(x1.a.m); rawfile 0.5000000000000551, 2000.0000000002203 and 500.0000000000551
  with Vs.1 m q 0 and R4 q 0 1k in the subcircuit, m in place of m.1, and .tf v(out) v.x1.vs.1:
    transfer_function = 3.333333e-01, output_impedance_at_v(out) = 3.343333e+02,
    v.x1.vs.1#input_impedance = 1.500000e+03; rawfile 0.33333333333335785, 1500.000000000055 and
    334.3333333333578
  nested as above, with m.1 in place of m in inner, and .tf v(x1.x2.m.1) V1: transfer_function =
    2.500000e-01, output_impedance_at_v(x1.x2.m.1) = 5.000000e+02, v1#input_impedance =
    2.666667e+03; rawfile 0.25, 2666.6666666666665 and 500
  with m in place of m.1 in the subcircuit, the same .tf v(x1.m.1) V1: transfer_function =
    0.000000e+00, output_impedance_at_v(x1.m.1) = 1.000000e+00, v1#input_impedance = 2.000000e+03;
    rawfile 0, 2000.0000000002203 and 1
  with m, and .tf v(x1.0) V1: output_impedance_at_v(x1.0) = 1.000000e+00, transfer_function =
    0.000000e+00; rawfile 0, 2000.0000000002203 and 1; the same with R2 m gnd 1k and .tf v(x1.gnd) V1,
    named output_impedance_at_v(x1.gnd)
  with Vs m q 0 and R4 q 0 1k in the subcircuit, m, and .tf v(out) i.x1.vs (exit 1, with -b and -b -r,
    no rawfile):
    Warning: Transfer function source i.x1.vs not in circuit
    doAnalyses: not found
    run simulation(s) aborted
ngspice 42: the same printouts, exit codes and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r: the same vectors, bit for bit, and the same messages and exit
  code (golden rows an-tf-inner-dotted, an-op-inner-dotted, an-tf-inner-xdot, -inner-partdot,
  -inner-nested-dot, -inner-dot-none, -inner-zero, -inner-gnd and -inner-letter)
```

## 3. Currents and power in the results

The signs describe.ts turns into directions ("3 A from n1 to 0 through R1") and power ("V1 delivers 18 W").

### C1. A voltage source whose + side is the higher one shows a negative current while it delivers power

F1a: i(v1) = −3: the current leaves V1 at its + node, so V1 delivers (6 V × 3 A =) 18 W to R1.

```spice
* F1a: a 6 V source across a 2 ohm resistor
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

### C1b. A voltage source with a negative value that delivers power shows a positive current

V1 0 n1 -6 puts its + side on ground and sets V(0) − V(n1) = −6 V, so n1 sits at 6 V and its + side is the lower one. It still drives 3 A through R1 and delivers 18 W, but that current enters V1 at its + node (from ground) and leaves at n1, so i(v1) = +3. Which sign means "delivers power" depends on which side is the higher one: negative when the + side is higher (C1), positive when it is lower.

```spice
* a source with a negative value that delivers power
V1 0 n1 -6
R1 n1 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               6.000000e+00
        v1#branch                        3.000000e+00
  ngspice -b -r out.raw (exit 0)
    rawfile: v(n1) = 6, i(v1) = 3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    vectors: v(n1) = 6, i(v1) = 3
```

### C2. A voltage source that absorbs power shows a positive current

V2 (12 V) pushes 2 A through R1 into V1's + node: i(v1) = +2, so V1 absorbs (6 V × 2 A =) 12 W, like a battery being charged; i(v2) = −2: V2 delivers 24 W.

```spice
* V1 absorbing power (V2 pushes current into the + node of V1)
V1 a 0 6
V2 b 0 12
R1 b a 3
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                1.200000e+01
        a                                6.000000e+00
        v1#branch                        2.000000e+00
        v2#branch                        -2.00000e+00
  rawfile from ngspice -b -r (exit 0): v(a) = 6, v(b) = 12, i(v2) = -2, i(v1) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 6, v(b) = 12, i(v2) = -2, i(v1) = 2
```

### C3. A part's current is positive from its first node to its second; a current source reports its value as written

R1 at +12 V carries +3 A (from n1 to 0), R2 at −12 V carries −3 A (that is, 3 A from 0 to n2). Both current sources report +3 A, their value as written, whichever way round they are.

```spice
* current directions with savecurrents
I1 0 n1 3
R1 n1 0 4
I2 n2 0 3
R2 n2 0 4
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n2                               -1.20000e+01
        n1                               1.200000e+01
        @r2[i]                           -3.00000e+00
        @i2[current]                     3.000000e+00
        @r1[i]                           3.000000e+00
        @i1[current]                     3.000000e+00
  rawfile from ngspice -b -r (exit 0): v(n1) = 12, v(n2) = -12, i(@i1[current]) = 3, i(@r1[i]) = 3, i(@i2[current]) = 3, i(@r2[i]) = -3
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 12, v(n2) = -12, i(@i1[current]) = 3, i(@r1[i]) = 3, i(@i2[current]) = 3, i(@r2[i]) = -3
```

### C4. F and G currents are positive from their first node, through the source, to their second

F1 pushes 4 A into o: @f1[i] = +4 (from its first node, 0, through F1, to o). F2 is written the other way round and pulls 4 A out of p: @f2[i] = +4 again (from p, through F2, to 0). The same holds for G1 and G2.

```spice
* F and G current directions
V1 c 0 2
Vs c d 0
Rd d 0 1
F1 0 o Vs 2
Ro o 0 1
F2 p 0 Vs 2
Rp p 0 1
G1 0 q c 0 0.5
Rq q 0 1
G2 r 0 c 0 0.5
Rr r 0 1
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        r                                -1.00000e+00
        q                                1.000000e+00
        p                                -4.00000e+00
        o                                4.000000e+00
        d                                2.000000e+00
        c                                2.000000e+00
        @rr[i]                           -1.00000e+00
        @g2[i]                           1.000000e+00
        @rq[i]                           1.000000e+00
        @g1[i]                           1.000000e+00
        @rp[i]                           -4.00000e+00
        @f2[i]                           4.000000e+00
        @ro[i]                           4.000000e+00
        @f1[i]                           4.000000e+00
        @rd[i]                           2.000000e+00
        v1#branch                        -2.00000e+00
        vs#branch                        2.000000e+00
  rawfile from ngspice -b -r (exit 0): i(vs) = 2, v(o) = 4, v(p) = -4, v(q) = 1, v(r) = -1, i(@f1[i]) = 4, i(@f2[i]) = 4, i(@g1[i]) = 1, i(@g2[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: i(vs) = 2, v(o) = 4, v(p) = -4, v(q) = 1, v(r) = -1, i(@f1[i]) = 4, i(@f2[i]) = 4, i(@g1[i]) = 1, i(@g2[i]) = 1
```

### C5. F5 with savecurrents: every current of the Thévenin test circuit

The words `describe.ts` gives these numbers are checked in tests/golden/facts-explain.test.ts: "3 A from n1 to 0 through R1", "Vx measures 1 A flowing from a to x", "Itest delivers 14 W", "F1 delivers 24 W".

```spice
* F5: Thevenin resistance with a dependent source (test source method)
Itest 0 a 1
Vx a x 0
R2 x n1 2
R1 n1 0 4
F1 0 n1 Vx 2
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n1                               1.200000e+01
        x                                1.400000e+01
        a                                1.400000e+01
        @f1[i]                           2.000000e+00
        @r1[i]                           3.000000e+00
        @r2[i]                           1.000000e+00
        @itest[current]                  1.000000e+00
        vx#branch                        1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(a) = 14, v(x) = 14, v(n1) = 12, i(vx) = 1, i(@itest[current]) = 1, i(@r2[i]) = 1, i(@r1[i]) = 3, i(@f1[i]) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 14, v(x) = 14, v(n1) = 12, i(vx) = 1, i(@itest[current]) = 1, i(@r2[i]) = 1, i(@r1[i]) = 3, i(@f1[i]) = 2
```

### C6. E and H currents count like a voltage source: positive entering at the + node

Like a voltage source's, E's and H's currents are negative when they deliver power: E1 drives 6 V into 2 Ω (3 A out of its + node: i(e1) = −3), H1 drives 8 V into 2 Ω (i(h1) = −4).

```spice
* E and H branch currents
V1 c 0 2
Vs c d 0
Rd d 0 1
E1 e 0 c 0 3
Re e 0 2
H1 h 0 Vs 4
Rh h 0 2
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        h                                8.000000e+00
        e                                6.000000e+00
        d                                2.000000e+00
        c                                2.000000e+00
        v1#branch                        -2.00000e+00
        e1#branch                        -3.00000e+00
        vs#branch                        2.000000e+00
        h1#branch                        -4.00000e+00
  rawfile from ngspice -b -r (exit 0): v(c) = 2, v(d) = 2, v(e) = 6, v(h) = 8, i(h1) = -4, i(vs) = 2, i(e1) = -3, i(v1) = -2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(c) = 2, v(d) = 2, v(e) = 6, v(h) = 8, i(h1) = -4, i(vs) = 2, i(e1) = -3, i(v1) = -2
```

### C7. A B source with I= pushes its current from its first node, through the source, into its second

B1 pushes its 2 A from 0 into b, like a current source: @b1[i] = +2 and b = +2 V.

```spice
* a B source current with savecurrents
B1 0 b I=2
Rb b 0 1
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                2.000000e+00
        @rb[i]                           2.000000e+00
        @b1[i]                           2.000000e+00
  rawfile from ngspice -b -r (exit 0): v(b) = 2, i(@b1[i]) = 2, i(@rb[i]) = 2
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(b) = 2, i(@b1[i]) = 2, i(@rb[i]) = 2
```

### C8. savecurrents gives wrong currents for switches (S, W) in .op: they use the off resistance

Both switches are on (1 Ω), and the resistors show the real currents, 1.5 A and 1 A. But @s1[i] and @w1[i] come out as 1.5 nA and 1 nA: the currents through the off resistance (1e9 Ω). ngspice 42 and 47 agree. So PlainSpice does not show savecurrents values for switches.

```spice
* switch currents with savecurrents
V1 a 0 6
S1 a c a 0 swm
Rc c 0 3
.model swm SW(vt=1 ron=1 roff=1e9)
Vs a d 0
Rd d 0 6
W1 a e Vs wm
Re e 0 5
.model wm CSW(it=0.5 ron=1 roff=1e9)
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e                                5.000000e+00
        d                                6.000000e+00
        c                                4.500000e+00
        a                                6.000000e+00
        @re[i]                           1.000000e+00
        @w1[i]                           1.000000e-09
        @rd[i]                           1.000000e+00
        @rc[i]                           1.500000e+00
        @s1[i]                           1.500000e-09
        v1#branch                        -3.50000e+00
        vs#branch                        1.000000e+00
  rawfile from ngspice -b -r (exit 0): v(c) = 4.5, v(e) = 5, i(vs) = 1, i(@s1[i]) = 1.5000000000000002e-9, i(@rc[i]) = 1.5, i(@w1[i]) = 1e-9, i(@re[i]) = 1
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(c) = 4.5, v(e) = 5, i(vs) = 1, i(@s1[i]) = 1.5000000000000002e-9, i(@rc[i]) = 1.5, i(@w1[i]) = 1e-9, i(@re[i]) = 1
```

### C8b. A transistor's savecurrents vectors are named by its terminals: @q1[ic] the collector's, [ib] the base's, [ie] the emitter's, [is] the substrate's

With savecurrents ngspice saves one current for each terminal of a BJT, a MOSFET and a JFET (A2b), each
named by the letters in brackets, which ngspice's own `devhelp` describes: for a BJT, ic "Current at
collector node", ib "Current at base node", ie "Emitter current" and is "Substrate current"; for a MOSFET
(level 1), id "Drain current", is "Source current", ig "Gate current" and ib "Bulk current"; for a JFET,
ig "Current at gate node", id "Current at drain node", is "Source current" and igd "Current G-D". So
[is] is a BJT's substrate current, but a MOSFET's or a JFET's source current. These are the model's own
quantities, from ngspice's last iteration, not always the current through the pin, and they keep no one
direction: with a 0 V ammeter on each of the BJT's four terminals (the two netlists after devhelp's,
native 47 and 42 alike), Q1's [ic] is 8.174876 mA where the collector's ammeter measures 8.171426 mA flowing
in; [is] is +8.285742e−13 A where the substrate's ammeter measures that current flowing out of the part;
and [ie] is −(ic + ib + is): with its collector at 9 V and its base fed through 1 MΩ, Q1's [ie] is
−9.000109e−12 A where the emitter's ammeter measures 1.09e−16 A, and the collector's measures 1.800019e−11 A,
[ic] and [is] together. In C8b's own run [ie] is −(ic + ib + is),
−8.253152 mA. ngspice 42 and 47 agree, and so does our engine. So a sweep's words name each current by its
terminal, as devhelp does, and claim no direction: "the collector current of Q1 is 8.171 milliamps", "the
gate-to-drain current of J1" (`describe.ts`, the sweep's last point), and "the collector current of q.x1.q1"
for a Q1 inside a subcircuit, which ngspice names q.x1.q1 (its letter first); they said "the current in Q1"
for all four (the last pass before milestone 2's release), and "the current in q.x1.q1" for all four of a
subcircuit's (the critic of the last pass's fixes).

```spice
* the currents savecurrents gives a transistor, a MOSFET and a JFET
V1 vcc 0 9
Rc vcc c 1k
Rb vcc b 100k
Q1 c b 0 qmod
Rd vcc d 1k
M1 d g 0 0 mmod
Vg g 0 2
Rj vcc dj 1k
J1 dj gj 0 jmod
Vgj gj 0 -0.5
.model qmod npn bf=100
.model mmod nmos level=1 vto=1 kp=1m
.model jmod njf vto=-2 beta=1m
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
          @j1[igd]                         -7.26000e-12
          @j1[ig]                          -7.77000e-12
          @j1[is]                          -2.25000e-03
          @j1[id]                          2.250000e-03
          @rj[i]                           2.250000e-03
          @m1[ib]                          -8.51000e-12
          @m1[ig]                          0.000000e+00
          @m1[is]                          -5.00000e-04
          @m1[id]                          5.000000e-04
          @rd[i]                           5.000000e-04
          @q1[is]                          8.285633e-13
          @q1[ib]                          8.171437e-05
          @q1[ie]                          -8.25315e-03
          @q1[ic]                          8.171437e-03
          @rb[i]                           8.171437e-05
          @rc[i]                           8.171437e-03
  rawfile from ngspice -b -r (exit 0): i(vgj) = 7.769998131313016e-12, i(@rc[i]) = 0.008171436673483043, i(@rb[i]) = 8.171436755511125e-05, i(@q1[ic]) = 0.008171437395948791, i(@q1[ie]) = -0.008253151771565406, i(@q1[ib]) = 8.171437478805107e-05, i(@q1[is]) = 8.285633265169585e-13, i(@rd[i]) = 0.0005000000085099981, i(@m1[id]) = 0.00050000000851, i(@m1[is]) = -0.0005, i(@m1[ig]) = 0, i(@m1[ib]) = -8.509999991490001e-12, i(@rj[i]) = 0.002250000007259999, i(@j1[id]) = 0.00225000000726, i(@j1[is]) = -0.002249999999490002, i(@j1[ig]) = -7.769998131313016e-12, i(@j1[igd]) = -7.259999992129622e-12
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: i(vgj) = 7.769998131313016e-12, i(@rc[i]) = 0.008171436673483043, i(@rb[i]) = 8.171436755511125e-05, i(@q1[ic]) = 0.008171437395948791, i(@q1[ie]) = -0.008253151771565406, i(@q1[ib]) = 8.171437478805107e-05, i(@q1[is]) = 8.285633265169585e-13, i(@rd[i]) = 0.0005000000085099981, i(@m1[id]) = 0.00050000000851, i(@m1[is]) = -0.0005, i(@m1[ig]) = 0, i(@m1[ib]) = -8.509999991490001e-12, i(@rj[i]) = 0.002250000007259999, i(@j1[id]) = 0.00225000000726, i(@j1[is]) = -0.002249999999490002, i(@j1[ig]) = -7.769998131313016e-12, i(@j1[igd]) = -7.259999992129622e-12
```

```spice
* device help
V1 a 0 1
R1 a 0 1
.control
devhelp bjt
devhelp mos1
devhelp jfet
.endc
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    222         ic                 out         Current at collector node
    223         ib                 out         Current at base node
    247         ie                 out         Emitter current
    248         is                 out         Substrate current
    215         id                 out         Drain current
     18         is                 out         Source current
     17         ig                 out         Gate current
     16         ib                 out         Bulk current
    308         ig                 out         Current at gate node
    309         id                 out         Current at drain node
    319         is                 out         Source current
    310         igd                out         Current G-D
  ngspice -b -r out.raw (exit 0): the same lines, and no results file (there is no analysis, A36)
ngspice 42: the same printout, exit codes and no results file, as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): the same lines, and no results
```

```spice
* C8b's transistor with 0 V ammeters on its four terminals
V1 vcc 0 9
Rc vcc c 1k
Vc c ci 0
Rb vcc b 100k
Vb b bi 0
Q1 ci bi ei si qmod
Ve ei 0 0
Vs si 0 0
.model qmod npn bf=100
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0), its currents:
          @q1[is]                          8.285742e-13
          @q1[ib]                          8.174876e-05
          @q1[ie]                          -8.25662e-03
          @q1[ic]                          8.174876e-03
          @rb[i]                           8.171426e-05
          @rc[i]                           8.171426e-03
          vc#branch                        8.171426e-03
          vb#branch                        8.171426e-05
          ve#branch                        8.253140e-03
          vs#branch                        8.285742e-13
  rawfile from ngspice -b -r (exit 0): v(vcc) = 9, v(c) = 0.8285742076290443, v(ci) = 0.8285742076290443, v(b) = 0.8285741256053445, v(bi) = 0.8285741256053445, v(ei) = 0, v(si) = 0, i(vs) = 8.285742076290444e-13, i(ve) = 0.008253140050286323, i(vb) = 8.171425874394657e-05, i(vc) = 0.008171425792370957, i(v1) = -0.008253140051114903, i(@rc[i]) = 0.008171425792370957, i(@rb[i]) = 8.171425874394657e-05, i(@q1[ic]) = 0.008174875762571438, i(@q1[ie]) = -0.008256624521854302, i(@q1[ib]) = 8.174875845428842e-05, i(@q1[is]) = 8.285742076290444e-13
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: the same doubles as ngspice 47
```

```spice
* the C9 transistor with ammeters on each of its four terminals
V1 top 0 9
Vc top c 0
Q1 c xb e s qmod
Vb x xb 0
Ve e 0 0
Vs s 0 0
Rx x 0 1meg
.model qmod npn
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0), its currents:
          @q1[is]                          9.000000e-12
          @q1[ib]                          -9.00008e-12
          @q1[ie]                          -9.00011e-12
          @q1[ic]                          9.000191e-12
          vc#branch                        1.800019e-11
          vb#branch                        -9.00008e-12
          ve#branch                        1.090352e-16
          vs#branch                        9.000000e-12
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(c) = 9, v(xb) = 9.000081999484785e-06, v(e) = 0, v(s) = 0, v(x) = 9.000081999484785e-06, i(vs) = 9e-12, i(ve) = 1.0903522937356526e-16, i(vb) = -9.000081999484783e-12, i(vc) = 1.8000191034714156e-11, i(v1) = -1.8000191034714156e-11, i(@q1[ic]) = 9.00019103471416e-12, i(@q1[ie]) = -9.000109035229373e-12, i(@q1[ib]) = -9.000081999484786e-12, i(@q1[is]) = 9e-12, i(@rx[i]) = 9.000081999484785e-12
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: the same doubles as ngspice 47
```

```spice
* the same, in a .dc sweep of one point
V1 vcc 0 9
Rc vcc c 1k
Rb vcc b 100k
Q1 c b 0 qmod
Rd vcc d 1k
M1 d g 0 0 mmod
Vg g 0 2
Rj vcc dj 1k
J1 dj gj 0 jmod
Vgj gj 0 -0.5
.model qmod npn bf=100
.model mmod nmos level=1 vto=1 kp=1m
.model jmod njf vto=-2 beta=1m
.options savecurrents
.dc V1 9 9 1
.end
```

```text
ngspice 47, ngspice -b -r out.raw (exit 0; plain ngspice -b runs no .dc without a .print line):
  rawfile: i(@q1[ic]) = 0.008171437395948791, i(@q1[ie]) = -0.008253151771565406, i(@q1[ib]) = 8.171437478805107e-05, i(@q1[is]) = 8.285633265169585e-13, i(@m1[id]) = 0.00050000000851, i(@j1[igd]) = -7.259999992129622e-12
ngspice 42: the same exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: i(@q1[ic]) = 0.008171437395948791, i(@q1[ie]) = -0.008253151771565406, i(@q1[ib]) = 8.171437478805107e-05, i(@q1[is]) = 8.285633265169585e-13, i(@m1[id]) = 0.00050000000851, i(@j1[igd]) = -7.259999992129622e-12
  words (describe.ts), the sweep's last point: … the collector current of Q1 is 8.171 milliamps, the emitter current of Q1 is minus 8.253 milliamps, the base current of Q1 is 81.71 microamps, the substrate current of Q1 is 828.6 femtoamps, … the drain current of M1 is 500 microamps, … the gate-to-drain current of J1 is minus 7.26 picoamps
```

```spice
* a BJT and a MOSFET inside nested subcircuits, swept
Vcc c 0 5
Ib 0 b 10u
X1 c b 0 amp
X2 c 0 mstage
.subckt amp c b e
Q1 c b e qn
.ends
.subckt mstage d s
X3 d s inner
.ends
.subckt inner d s
M1 d g s s mn
Vg g s 2
.ends
.model qn npn(bf=100)
.model mn nmos level=1 vto=1 kp=1m
.options savecurrents
.op
.dc Vcc 0 5 1
.end
```

```text
ngspice 47, ngspice -b -r out.raw (exit 0), the sweep's last point (Vcc = 5 V): i(@q.x1.q1[ic]) = 0.0010000003497277078, i(@q.x1.q1[ie]) = -0.0010100003547310857, i(@q.x1.q1[ib]) = 1.0000000003377878e-05, i(@q.x1.q1[is]) = 5e-12, i(@m.x2.x3.m1[id]) = 0.00050000000501, i(@m.x2.x3.m1[is]) = -0.0005, i(@m.x2.x3.m1[ig]) = 0, i(@m.x2.x3.m1[ib]) = -5.01e-12, i(v.x2.x3.vg) = 0
ngspice 42: the same exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): the same doubles as ngspice 47, but for i(@q.x1.q1[is]) and i(@m.x2.x3.m1[is]) at Vcc = 0 V, which native gives as −0 and our engine as 0
  words (describe.ts), the sweep's last point: … the collector current of q.x1.q1 is 1 milliamp, the emitter current of q.x1.q1 is minus 1.01 milliamps, the base current of q.x1.q1 is 10 microamps, the substrate current of q.x1.q1 is 5 picoamps, the drain current of m.x2.x3.m1 is 500 microamps, … the current in v.x2.x3.vg is 0 amps
```

### C9. A current that is 0 can come out as rounding noise, about 10⁻¹⁸ A: in a balanced bridge, R5 shows −8.88e−19 A

Added after the final reviews of 12 November 2026 (student review). The bridge is balanced (10 kΩ over 10 kΩ, 4.7 kΩ over 4.7 kΩ), so a and b sit at the same voltage and no current flows through R5. ngspice's arithmetic leaves a remainder: v(a) comes out one unit in the last place below 4.5 V (4.499999999999999), so @r5[i] = (v(a) − v(b)) / 1 kΩ = −8.88e−19 A, while the other currents are 0.45 mA and 0.96 mA, about 10¹⁵ times larger. Native 47, native 42 and our engine give the same doubles. PlainSpice shows such a current as 0 A, with no arrow and no power, and says what ngspice gave (decision 0015).

```spice
* a balanced bridge: no current through R5
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                4.500000e+00
        a                                4.500000e+00
        top                              9.000000e+00
        @r5[i]                           -8.88178e-19
        @r4[i]                           9.574468e-04
        @r3[i]                           9.574468e-04
        @r2[i]                           4.500000e-04
        @r1[i]                           4.500000e-04
        v1#branch                        -1.40745e-03
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, i(v1) = -0.0014074468085106386, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, i(v1) = -0.0014074468085106386, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19
```

### C9b. When every true current is 0, every current ngspice gives can be such noise

The homework circuit with its 0 V ammeter written `Vm x gnd` (gnd as the last word is an ordinary node, W9, so Vm carries nothing): the only path left is V1, R1, R3 and F1. R3 brings into b the current that flows through V1 and R1, and F1 takes twice that current out of b; only 0 balances node b, so every current is 0 and every node sits at 12 V. ngspice gives currents of about 10⁻¹⁸ A, the node voltages a few units in the last place below 12 V. The same doubles in native 47, native 42 and our engine. Here every current is noise, so comparing a current with the largest one ngspice gives tells nothing; the circuit's own numbers do. R1 and R3 have their two ends at the same voltage, to the last bits of a double (12 against 11.999999999999998, and 11.999999999999998 against 11.999999999999995), so they carry no current; then V1 is the only current left at node in, and F1 copies V1's current, so they carry none either (C9d says how PlainSpice decides this).

```spice
* a 0 V ammeter whose last word is gnd: no current anywhere
V1 in 0 12
R1 in a 1k
R2 a x 2k
Vm x gnd
R3 a b 3k
F1 0 b V1 2
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                1.200000e+01
        gnd                              1.200000e+01
        x                                1.200000e+01
        a                                1.200000e+01
        in                               1.200000e+01
        @f1[i]                           -3.46945e-18
        @r3[i]                           1.184238e-18
        @r2[i]                           0.000000e+00
        @r1[i]                           1.776357e-18
        vm#branch                        0.000000e+00
        v1#branch                        -1.73472e-18
    Note: vm: has no value, DC 0 assumed
  rawfile from ngspice -b -r (exit 0): v(in) = 12, v(a) = 11.999999999999998, v(x) = 11.999999999999998, v(gnd) = 11.999999999999998, v(b) = 11.999999999999995, i(v1) = -1.734723475976807e-18, i(vm) = 0, i(@r1[i]) = 1.7763568394002505e-18, i(@r2[i]) = 0, i(@r3[i]) = 1.1842378929335003e-18, i(@f1[i]) = -3.469446951953614e-18
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
    Note: vm: has no value, DC 0 assumed
  vectors: v(in) = 12, v(a) = 11.999999999999998, v(x) = 11.999999999999998, v(gnd) = 11.999999999999998, v(b) = 11.999999999999995, i(v1) = -1.734723475976807e-18, i(vm) = 0, i(@r1[i]) = 1.7763568394002505e-18, i(@r2[i]) = 0, i(@r3[i]) = 1.1842378929335003e-18, i(@f1[i]) = -3.469446951953614e-18
```

A tiny current is not always noise: `I1 0 n1 3A` is a 3 aA source (unit-letter-1 in traps.md), and ngspice gives v(n1) = 1.2e−17 V across 4 Ω, a real 3 aA. So is a tiny current next to large ones (C9e to C9g), and one that flows on from a real tiny current, though the ends of the part it flows through are as close as R1's here (C9h to C9l). PlainSpice never compares a current with the circuit's other currents: it solves the circuit exactly, with fractions, and shows as 0 only what the circuit makes exactly 0 (C9d).

### C9c. ngspice's current tolerance, abstol, is 1e-12 A (1 pA) by default, and its voltage tolerance, vntol, 1e-6 V (1 µV)

ngspice's `options` command lists the tolerances it works to. The absolute tolerance for currents, abstol, is 1e-12 A in native 47, native 42 and our engine; the one for node voltages, vntol, is 1e-6 V; the relative one, reltol, is 0.001. A current that ngspice gives as 10⁻¹⁸ A is a million times smaller than abstol.

```spice
* ngspice's tolerances
V1 a 0 1
R1 a 0 1k
.control
op
options
.endc
.end
```

```text
ngspice 47, ngspice -b (exit 0), the lines about tolerances of the listing:
    Tolerances (absolute):
    abstol      (current) = 1e-12
    chgtol      (charge)  = 1e-14
    vntol       (voltage) = 1e-06
    pivtol      (pivot)   = 1e-13

    Tolerances (relative):
    reltol      (current) = 0.001
    pivrel      (pivot)   = 0.001
ngspice 42: the same lines
our engine (wasm), as ngspice -b -r (exit 0, no results file: the .control block writes none, A36):
    the same lines
```

### C9d. Rounding noise passes on: what an F makes of a 0 V source's noise, the resistor it drives and the voltage there are noise too

Added after the critic of the fixes for the final reviews (12 November 2026). The bridge of C9 with a 0 V source Vm in R5's branch, and F1 copying 1000 × Vm's current into R6. R5 carries exactly 0 A here; Vm, the only other current at node m, gives −2.17e−19 A. F1 and R6 then give −2.17e−16 A, and node out −2.17e−13 V: all noise of a 0, because a current that is 0 copied 1000 times is still 0, and a resistor that carries no current has no voltage across it. The same doubles in native 47, native 42 and our engine.

PlainSpice decides this exactly, never by comparing a current with the circuit's other currents (decision 0015, `roundingNoise` in `src/spice/describe.ts`, `src/spice/exact.ts`). For a circuit of resistors, capacitors (open in .op, P11), inductors (wires), V and I sources with plain values (0 when they have none, P9, P16), and E, F, G and H with plain gains, it solves the netlist's own values with fractions, read as ngspice reads each word (its scale letters, 2A as 2 attoamps, 10M as 10 milli), but as the exact decimal the netlist writes. A diode is taken as a part whose current is left free: a value that is 0 whatever current the diodes carry is exactly 0 (C9t), at each point of a sweep too (C9t.5, C9t.6), each diode's current taken from Kirchhoff's law at the nodes where ngspice's rounding leaves it least (C9t.7). It first checks that ngspice simulated that same circuit: its node voltages and branch currents must solve the exact equations as closely as its own rounding can (Kirchhoff's law at the nodes against the nodes' sizes, the branches' own equations against theirs, at most 2⁻³⁰ times the spread of the circuit's conductances; at most 3.8e−15 and 4.4e−11 over the 9,627 netlists of the re-check's corpora and the repository that it models exactly, though a 1 nΩ to 10 µΩ wire into 0 V ammeters leaves up to 1.9e−3, C9w.5, C9w.9; with a .save line that keeps only some values, no such check, C9w.6), and every part's current it reports must be its own numbers' product, to within its rounding. Then it checks that ngspice solved it to the digits the page shows: no node voltage, no V, E, H or L current and no R, G or F current it reports whose exact value is not 0 may be drawn with other digits than the exact value and be more than 5e−5 from it (since the last pass whatever rounding leaves of the numbers it is worked out from, C9w.4; a value a diode's current changes only beyond that, 2⁻³⁰ of their size, a controlled source's rounding carried only to what its output moves, C9u.2, C9v), and nodes at exactly one voltage must be drawn alike, beyond rounding (C9v.3, C9v.4). Where one is farther off (a 1e−12 Ω wire makes ngspice's answers 4 % off, C9s; a bridge at 10 mV beside 15 V gives 2.097 V for an exact 0, C9s.3), PlainSpice shows ngspice's numbers, decided by the rule below, and a warning gives the exact values of those farthest off (with diodes, only of values no diode's current changes, C9w.8). Otherwise a current or node voltage whose exact value is 0 is noise of a 0, whatever its size (C9o), and one whose exact value is not 0 is real, however tiny (C9n), shown as ngspice gives it, or as the exact solution gives it where ngspice's arithmetic rounded it to exactly 0 (C9n.4; with diodes, only where no diode's current changes it, C9n.6): here R5's ends are exactly at the same voltage, Vm's current is exactly 0, F1 copies 1000 × 0, and R6 carries 0 into node out, which is at exactly 0 V. Two nodes are at the same voltage when their exact voltages are equal, whatever ngspice's last bits say (4.499999999999999 against 4.5 in C9): a balanced circuit can leave 7 steps of a double or more (C9m). The .tf ratio and each point of a .dc sweep are decided the same way (C9p, C9p.6, C9n.5): since the last pass, a real ratio ngspice gives as exactly 0 is shown as the exact one beside an .op (with none, a sweep) decided exactly, and a ratio drawn with other digits than the exact one, a 0 with nothing decided beside it among them, is shown as ngspice gives it with a warning (C9w.10 to C9w.12). For other circuits (a transistor, a switch, a subcircuit, a part with settings, .param, .temp and other .options, a circuit too large to solve within a fixed amount of work), and where ngspice's answers are farther from the exact ones (C9s), PlainSpice keeps a rule that decides from ngspice's own numbers (where it has the exact solution beside it, a value whose exact value is not 0 is never noise): a current below 1 pA (C9c) that nothing real flows through is noise when the part's two ends are within 4 steps of a double, or it copies or reads a 0, or it is a source that carries the only current left at a node; a resistor's current that ngspice gives as exactly 0 proves nothing there (C9n); where the currents shown at a node do not add up to 0, the 0s there get ngspice's numbers back, and so does a 0 that a controlled source shown with a value makes it from (the resistors written as 0 that join the two nodes an E or a G reads, the current an F copies; C9o.5); and no node voltage is written as 0 V. PlainSpice shows each value that is noise of a 0 as 0 A or 0 V, and says what ngspice gave in a note.

```spice
* a balanced bridge with a 0 V ammeter in R5, and an F that reads it
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a m 1k
Vm m b 0
F1 0 out Vm 1000
R6 out 0 1k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out                              -2.16840e-13
        m                                4.500000e+00
        b                                4.500000e+00
        a                                4.500000e+00
        top                              9.000000e+00
        @r6[i]                           -2.16840e-16
        @f1[i]                           -2.16840e-16
        @r5[i]                           0.000000e+00
        @r4[i]                           9.574468e-04
        @r3[i]                           9.574468e-04
        @r2[i]                           4.500000e-04
        @r1[i]                           4.500000e-04
        v1#branch                        -1.40745e-03
        vm#branch                        -2.16840e-19
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.499999999999999, v(m) = 4.499999999999999, v(out) = -2.1684043449710089e-13, i(vm) = -2.168404344971009e-19, i(v1) = -0.0014074468085106388, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106385, i(@r4[i]) = 0.0009574468085106381, i(@r5[i]) = 0, i(@f1[i]) = -2.1684043449710089e-16, i(@r6[i]) = -2.1684043449710089e-16
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.499999999999999, v(m) = 4.499999999999999, v(out) = -2.1684043449710089e-13, i(vm) = -2.168404344971009e-19, i(v1) = -0.0014074468085106388, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106385, i(@r4[i]) = 0.0009574468085106381, i(@r5[i]) = 0, i(@f1[i]) = -2.1684043449710089e-16, i(@r6[i]) = -2.1684043449710089e-16
```

### C9e. A tiny current is real when the circuit makes it: a source written 2A (2 attoamps) next to a 12 V divider gives exactly its own 2e−18 A

The superposition circuit of a first-year course, with the current source written `2A`, which SPICE reads as 2 attoamps (unit-letter-1 in traps.md). ngspice gives @i1[current] = 2e−18 A, the source's own value, next to 4 mA in R1 and R2 (the source's share of their currents, about 10⁻¹⁸ A, is lost in their rounding). A current source's current is its own value, so it is never noise: PlainSpice shows 2 aA, and the unit-letter check says why it is so small. Compared with the circuit's other currents it is a million million times smaller than 4 mA, which is why a rule that compared sizes would wrongly call it noise.

```spice
* superposition: a 12 V source and a 2 A current source (2 attoamps)
V1 a 0 12
R1 a b 1k
R2 b 0 2k
I1 0 b 2A
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                8.000000e+00
        a                                1.200000e+01
        @i1[current]                     2.000000e-18
        @r2[i]                           4.000000e-03
        @r1[i]                           4.000000e-03
        v1#branch                        -4.00000e-03
  rawfile from ngspice -b -r (exit 0): v(a) = 12, v(b) = 8, i(v1) = -0.004, i(@r1[i]) = 0.004, i(@r2[i]) = 0.004, i(@i1[current]) = 2e-18
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 12, v(b) = 8, i(v1) = -0.004, i(@r1[i]) = 0.004, i(@r2[i]) = 0.004, i(@i1[current]) = 2e-18
```

### C9f. So is the current of a resistor whose ends are far apart: 1e14 Ω across 12 V carries 1.2e−13 A, next to 1.2 A

R2 has 12 V across it, so its 1.2e−13 A (120 fA) is real, though about 10⁻¹³ of R1's 1.2 A: its two ends are not at the same voltage.

```spice
* a 100 T resistor across 12 V, next to a 1.2 A current
V1 in 0 12
R1 in 0 10
R2 in 0 1e14
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        in                               1.200000e+01
        @r2[i]                           1.200000e-13
        @r1[i]                           1.200000e+00
        v1#branch                        -1.20000e+00
  rawfile from ngspice -b -r (exit 0): v(in) = 12, i(v1) = -1.20000000000012, i(@r1[i]) = 1.2000000000000002, i(@r2[i]) = 1.2e-13
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(in) = 12, i(v1) = -1.20000000000012, i(@r1[i]) = 1.2000000000000002, i(@r2[i]) = 1.2e-13
```

### C9g. And of a resistor next to one used as a wire: 1 TΩ beside a 1 nΩ wire carries 5e−13 A

The 1 nΩ resistor R1, a wire, makes a node voltage over its resistance huge (0.5 V / 1 nΩ = 5e8 A), but R3 has 0.5 V across it, so its 0.5 pA is real. (ngspice gives the wire's own current as 5.000445e−4 A against R2's 5e−4 A: it divides the rounding of the wire's node voltages by 1 nΩ.)

```spice
* a 1 n resistor used as a wire, and a 1 T resistor
V1 in 0 0.5
R1 in a 1n
R2 a 0 1k
R3 a 0 1T
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                5.000000e-01
        in                               5.000000e-01
        @r3[i]                           5.000000e-13
        @r2[i]                           5.000000e-04
        @r1[i]                           5.000445e-04
        v1#branch                        -5.00023e-04
  rawfile from ngspice -b -r (exit 0): v(in) = 0.5, v(a) = 0.49999999999949996, i(v1) = -0.000500023365020752, i(@r1[i]) = 0.0005000444502911704, i(@r2[i]) = 0.0004999999999995, i(@r3[i]) = 4.999999999995e-13
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(in) = 0.5, v(a) = 0.49999999999949996, i(v1) = -0.000500023365020752, i(@r1[i]) = 0.0005000444502911704, i(@r2[i]) = 0.0004999999999995, i(@r3[i]) = 4.999999999995e-13
```

### C9h. A tiny current flows on through every part of its loop: in a loop with a source written 2A, R1 and V1 carry its 2 aA

Added after the critic of round 2 (12 November 2026). A 12 V source, 1 kΩ and a current source written `2A`, which SPICE reads as 2 attoamps (unit-letter-1 in traps.md), in one loop. I1 pushes 2e−18 A into node b, and R1 is the only other part there, so R1 carries it, and then V1: the currents at a node add up to 0. 2 aA through 1 kΩ is 2e−15 V, less than the step between two doubles at 12 V (1.8e−15 V), so ngspice gives node b one step above 12 V (12.000000000000002), and R1's current comes out as that one step over 1 kΩ, −1.776e−18 A: the 2 aA to within ngspice's rounding. R1's two ends are as close as R5's in the balanced bridge (C9), but here the circuit makes a current flow, so PlainSpice shows what ngspice gave (R1 1.776 aA, V1 1.735 aA), and the unit-letter check says why it is so small. Those numbers are 11 and 13 % from the circuit's 2 aA: since the critic of round 2 of the re-check's fixes the page adds the warning that ngspice's answers are off, "V1 carries 2 aA, where ngspice gives 1.735 aA; and R1 carries 2 aA, where ngspice gives 1.776 aA" (a value as large as any other current at its nodes is held to 5e−5 of itself). The same doubles in native 47, native 42 and our engine.

```spice
* a 12 V source, 1 k and a current source written 2A (2 attoamps) in one loop
V1 a 0 12
R1 a b 1k
I1 0 b 2A
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                1.200000e+01
        a                                1.200000e+01
        @i1[current]                     2.000000e-18
        @r1[i]                           -1.77636e-18
        v1#branch                        1.734723e-18
  rawfile from ngspice -b -r (exit 0): v(a) = 12, v(b) = 12.000000000000002, i(v1) = 1.734723475976807e-18, i(@r1[i]) = -1.7763568394002505e-18, i(@i1[current]) = 2e-18
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 12, v(b) = 12.000000000000002, i(v1) = 1.734723475976807e-18, i(@r1[i]) = -1.7763568394002505e-18, i(@i1[current]) = 2e-18
```

### C9i. A resistor in series with one 10¹³ times larger carries the same real current: 10 Ω and 100 TΩ across 12 V each carry 1.2e−13 A

R2 has 12 V across it, so it lets 1.2e−13 A through (as in C9f), and R1 is the only other part at node a, so it carries the same current, though it has only 1.2e−12 V across it, 10⁻¹³ of 12 V. Its two ends are 675 steps of a double apart (12 against 11.9999999999988): far more than the 1 or 2 steps the balanced bridges of C9 and C9b leave (other balanced circuits leave 7 or 9, C9m). ngspice's 120.1 fA for V1 and R1 is 7e−4 from the circuit's 120 fA, so the page shows ngspice's numbers with the warning that they are off: "V1 carries 120 fA, where ngspice gives 120.1 fA; and R1 carries 120 fA, where ngspice gives 120.1 fA". The same doubles in native 47, native 42 and our engine.

```spice
* 12 V across 10 ohms in series with 100 T ohms
V1 in 0 12
R1 in a 10
R2 a 0 1e14
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                1.200000e+01
        in                               1.200000e+01
        @r2[i]                           1.200000e-13
        @r1[i]                           1.200817e-13
        v1#branch                        -1.20126e-13
  rawfile from ngspice -b -r (exit 0): v(in) = 12, v(a) = 11.9999999999988, i(v1) = -1.2012613126444194e-13, i(@r1[i]) = 1.2008172234345695e-13, i(@r2[i]) = 1.19999999999988e-13
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(in) = 12, v(a) = 11.9999999999988, i(v1) = -1.2012613126444194e-13, i(@r1[i]) = 1.2008172234345695e-13, i(@r2[i]) = 1.19999999999988e-13
```

### C9j. Side by side, both carry it: in the loop of C9h with two 1 kΩ resistors, each carries 1 aA

I1's 2 aA now splits between R1 and R2, 1 aA each. ngspice gives each −1.776e−18 A (one step of a double over 1 kΩ, as in C9h) and V1 3.469e−18 A: the currents to within its rounding. Node b has three parts here, so it is the rule for a node, not only for parts in series, that says R1 and R2 carry I1's current: where the real currents at a node do not add up to 0, the node's other parts carry the difference. Those numbers are far from the circuit's 1 aA and 2 aA, so the page shows them with the warning that ngspice's answers are off: "R1 carries 1 aA, where ngspice gives 1.776 aA; R2 carries 1 aA, where ngspice gives 1.776 aA; and V1 carries 2 aA, where ngspice gives 3.469 aA". The same doubles in native 47, native 42 and our engine.

```spice
* the loop of C9h with two 1 k resistors side by side
V1 a 0 12
R1 a b 1k
R2 a b 1k
I1 0 b 2A
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                1.200000e+01
        a                                1.200000e+01
        @i1[current]                     2.000000e-18
        @r2[i]                           -1.77636e-18
        @r1[i]                           -1.77636e-18
        v1#branch                        3.469447e-18
  rawfile from ngspice -b -r (exit 0): v(a) = 12, v(b) = 12.000000000000002, i(v1) = 3.469446951953614e-18, i(@r1[i]) = -1.7763568394002505e-18, i(@r2[i]) = -1.7763568394002505e-18, i(@i1[current]) = 2e-18
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(a) = 12, v(b) = 12.000000000000002, i(v1) = 3.469446951953614e-18, i(@r1[i]) = -1.7763568394002505e-18, i(@r2[i]) = -1.7763568394002505e-18, i(@i1[current]) = 2e-18
```

### C9k. A long ladder: section 30 of a 1000-section ladder has the same nanovolts and femtoamps as in a 100-section ladder, and the far end goes below the smallest normal double, then to 0

Each section of this ladder (1 kΩ along, 2 kΩ and 10 kΩ down to ground, the second through a 0 V source) divides the voltage by about 2.4. Section 30 gets the same doubles in a ladder of 100 sections and in one of 1000: v(n30) = 1.395 nV and 697.5 fA through Rb30, real values the circuit makes, below vntol and abstol, and PlainSpice shows them as ngspice gives them. Far down the long ladder the values go below 2⁻¹⁰²² (about 2.2e−308), the smallest normal double, where a double has fewer and fewer digits (n940: 1.57e−308), down to the smallest double there is, 5e−324 (n987), and then 0 (n988 to n1000). Those numbers are what is left of real values too small for a double, not noise of a 0: PlainSpice never calls a number below 2⁻¹⁰²² noise. The same doubles in native 47, native 42 and our engine. The netlists are shortened here to their first and last sections; the printouts to the lines for these nodes and this resistor (the 1000-section one lists 2000 node voltages and 4001 currents).

```spice
* a ladder of 100 sections: each divides the voltage again
V1 n0 0 10
Ra1 n0 n1 1k
Rb1 n1 0 2k
Vm1 n1 m1 0
Rc1 m1 0 10k
* (shortened: the same four lines for each section k = 2 to 99: Ra<k> n<k-1> n<k> 1k, Rb<k> n<k> 0 2k, Vm<k> n<k> m<k> 0, Rc<k> m<k> 0 10k)
Ra100 n99 n100 1k
Rb100 n100 0 2k
Vm100 n100 m100 0
Rc100 m100 0 10k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n100                             2.068510e-32
        n30                              1.394957e-09
        @rb30[i]                         6.974785e-13
  rawfile from ngspice -b -r (exit 0): v(n30) = 1.3949570192590355e-9, v(n100) = 2.0685102856568829e-32, i(@rb30[i]) = 6.974785096295177e-13
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n30) = 1.3949570192590355e-9, v(n100) = 2.0685102856568829e-32, i(@rb30[i]) = 6.974785096295177e-13
```

```spice
* a ladder of 1000 sections: each divides the voltage again
V1 n0 0 10
Ra1 n0 n1 1k
Rb1 n1 0 2k
Vm1 n1 m1 0
Rc1 m1 0 10k
* (shortened: the same four lines for each section k = 2 to 999: Ra<k> n<k-1> n<k> 1k, Rb<k> n<k> 0 2k, Vm<k> n<k> m<k> 0, Rc<k> m<k> 0 10k)
Ra1000 n999 n1000 1k
Rb1000 n1000 0 2k
Vm1000 n1000 m1000 0
Rc1000 m1000 0 10k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n988                             0.000000e+00
        n987                            4.940656e-324
        n940                            1.571228e-308
        n939                            3.347757e-308
        n100                             1.407784e-32
        n30                              1.394957e-09
        @rb30[i]                         6.974785e-13
  rawfile from ngspice -b -r (exit 0): v(n30) = 1.3949570192590355e-9, v(n100) = 1.4077842058616815e-32, v(n939) = 3.347756568565453e-308, v(n940) = 1.571228079166437e-308, v(n987) = 5e-324, v(n988) = 0, i(@rb30[i]) = 6.974785096295177e-13
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n30) = 1.3949570192590355e-9, v(n100) = 1.4077842058616815e-32, v(n939) = 3.347756568565453e-308, v(n940) = 1.571228079166437e-308, v(n987) = 5e-324, v(n988) = 0, i(@rb30[i]) = 6.974785096295177e-13
```

### C9l. Ends more than a few steps of a double apart carry a real current: a 1e15 Ω voltmeter across R2 of the balanced bridge makes 2.7 fA flow through R5

The bridge of C9 with a 1e15 Ω resistor from a to ground, as an ideal voltmeter is often drawn. It takes 4.5e−15 A from node a, so a sinks by 9e−12 V and b by 6.3e−12 V, and R5 carries 2.696e−15 A from b to a; solving the netlist's equations exactly, with fractions, gives −2.6946e−15 A. R5's two ends are 3035 steps of a double apart (4.499999999990972 against 4.499999999993667), where the balanced bridge's are 1 apart (C9) and C9b's 1 and 2. Over 300 bridges with random values (resistors written to 15 digits; native 47, native 42 and our engine give the same doubles for all 300; each also solved exactly, with fractions, from the doubles its values are), wherever ngspice's R5 current was rounding noise (at least twice the exact current, or less than half of it), its two ends were at most 2 steps apart, in 104 bridges; wherever they were more than 4 steps apart, in 42, ngspice's current was the circuit's own, within a factor of 2 of the exact one. That held for those bridges, not as a rule: two equal arms of three resistors leave 7 or 9 steps of a double where the circuit makes no current (C9m). So PlainSpice decides from the exact solution where it can (C9d): here R5's exact current is −2.6946e−15 A, a real current, shown as ngspice gives it; the 4-step rule is left only for circuits it does not solve exactly. Since the last pass (C9w.4) the page draws ngspice's 2.696 fA with the warning "R5 carries 2.695 fA, where ngspice gives 2.696 fA": its digits are not the exact value's, 4e−4 from it. The same doubles in native 47, native 42 and our engine.

```spice
* the balanced bridge of C9 with a 1e15 ohm voltmeter across R2
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
Rvm a 0 1e15
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                4.500000e+00
        a                                4.500000e+00
        top                              9.000000e+00
        @rvm[i]                          4.500000e-15
        @r5[i]                           -2.69562e-15
        @r4[i]                           9.574468e-04
        @r3[i]                           9.574468e-04
        @r2[i]                           4.500000e-04
        @r1[i]                           4.500000e-04
        v1#branch                        -1.40745e-03
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 4.499999999990972, v(b) = 4.499999999993667, i(v1) = -0.0014074468085128885, i(@r1[i]) = 0.00045000000000090286, i(@r2[i]) = 0.00044999999999909717, i(@r3[i]) = 0.0009574468085119857, i(@r4[i]) = 0.0009574468085092909, i(@r5[i]) = -2.6956215037898802e-15, i(@rvm[i]) = 4.499999999990972e-15
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 4.499999999990972, v(b) = 4.499999999993667, i(v1) = -0.0014074468085128885, i(@r1[i]) = 0.00045000000000090286, i(@r2[i]) = 0.00044999999999909717, i(@r3[i]) = 0.0009574468085119857, i(@r4[i]) = 0.0009574468085092909, i(@r5[i]) = -2.6956215037898802e-15, i(@rvm[i]) = 4.499999999990972e-15
```

### C9m. A balanced circuit can leave the ends of a part 7, 9 or more steps of a double apart: two equal arms of three resistors and a link carry no current through the link

Added after the re-check of 12 November 2026 (spice S1). The two arms are the same resistors in the same order, so n3 and n5 sit at exactly the same voltage, 9 × 33 kΩ / 48.33 kΩ = 6.14525139664804... V, and R7 carries no current. ngspice's arithmetic leaves n3 about 4.5 steps of a double above that value and n5 about 2.5 below: 7 steps apart, so @r7[i] = 6.2e−20 A. With arms of 4.7 kΩ, 100 Ω and 150 kΩ and a 3.3 kΩ link the ends come out 9 steps apart, and R7 gives −4.8e−18 A. So "a balanced circuit leaves 1 or 2 steps" (C9, C9b) holds for those bridges, not as a rule: a rule that takes ends at most 4 steps apart as the same voltage would draw both as currents with an arrow. PlainSpice solves such a circuit exactly (C9d): R7's current is exactly 0, so it shows 0 A, with a note that gives ngspice's number. The same doubles in native 47, native 42 and our engine.

```spice
* two equal arms of three resistors and a link: no current through R7
V1 n1 0 9
R1 n1 n2 15k
R2 n2 n3 330
R3 n3 0 33k
R4 n1 n4 15k
R5 n4 n5 330
R6 n5 0 33k
R7 n3 n5 100k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n5                               6.145251e+00
        n4                               6.206704e+00
        n3                               6.145251e+00
        n2                               6.206704e+00
        n1                               9.000000e+00
        @r7[i]                           6.217249e-20
        @r6[i]                           1.862197e-04
        @r5[i]                           1.862197e-04
        @r4[i]                           1.862197e-04
        @r3[i]                           1.862197e-04
        @r2[i]                           1.862197e-04
        @r1[i]                           1.862197e-04
        v1#branch                        -3.72439e-04
  rawfile from ngspice -b -r (exit 0): v(n1) = 9, v(n2) = 6.206703910614529, v(n3) = 6.145251396648049, v(n4) = 6.2067039106145225, v(n5) = 6.145251396648042, i(v1) = -0.00037243947858473, i(@r1[i]) = 0.00018621973929236477, i(@r2[i]) = 0.00018621973929236395, i(@r3[i]) = 0.00018621973929236512, i(@r4[i]) = 0.00018621973929236517, i(@r5[i]) = 0.00018621973929236395, i(@r6[i]) = 0.00018621973929236493, i(@r7[i]) = 6.217248937900877e-20
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 9, v(n2) = 6.206703910614529, v(n3) = 6.145251396648049, v(n4) = 6.2067039106145225, v(n5) = 6.145251396648042, i(v1) = -0.00037243947858473, i(@r1[i]) = 0.00018621973929236477, i(@r2[i]) = 0.00018621973929236395, i(@r3[i]) = 0.00018621973929236512, i(@r4[i]) = 0.00018621973929236517, i(@r5[i]) = 0.00018621973929236395, i(@r6[i]) = 0.00018621973929236493, i(@r7[i]) = 6.217248937900877e-20
```

```spice
* two equal arms of three resistors and a 3.3 k link: no current through R7
V1 n1 0 15
R1 n1 n2 4.7k
R2 n2 n3 100
R3 n3 0 150k
R4 n1 n4 4.7k
R5 n4 n5 100
R6 n5 0 150k
R7 n3 n5 3.3k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n5                               1.453488e+01
        n4                               1.454457e+01
        n3                               1.453488e+01
        n2                               1.454457e+01
        n1                               1.500000e+01
        @r7[i]                           -4.84461e-18
        @r6[i]                           9.689922e-05
        @r5[i]                           9.689922e-05
        @r4[i]                           9.689922e-05
        @r3[i]                           9.689922e-05
        @r2[i]                           9.689922e-05
        @r1[i]                           9.689922e-05
        v1#branch                        -1.93798e-04
  rawfile from ngspice -b -r (exit 0): v(n1) = 15, v(n2) = 14.54457364341081, v(n3) = 14.534883720930189, v(n4) = 14.544573643410827, v(n5) = 14.534883720930205, i(v1) = -0.0001937984496124174, i(@r1[i]) = 0.00009689922480621051, i(@r2[i]) = 0.00009689922480621505, i(@r3[i]) = 0.00009689922480620126, i(@r4[i]) = 0.0000968992248062071, i(@r5[i]) = 0.00009689922480621505, i(@r6[i]) = 0.00009689922480620137, i(@r7[i]) = -4.8446095620006835e-18
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n1) = 15, v(n2) = 14.54457364341081, v(n3) = 14.534883720930189, v(n4) = 14.544573643410827, v(n5) = 14.534883720930205, i(v1) = -0.0001937984496124174, i(@r1[i]) = 0.00009689922480621051, i(@r2[i]) = 0.00009689922480621505, i(@r3[i]) = 0.00009689922480620126, i(@r4[i]) = 0.0000968992248062071, i(@r5[i]) = 0.00009689922480621505, i(@r6[i]) = 0.00009689922480620137, i(@r7[i]) = -4.8446095620006835e-18
```

### C9n. A real voltage below 1 µV is real: a ladder node read by a 1 TΩ voltmeter through a 1 µΩ wire is at 732.4 nV, though ngspice gives the wire's current as exactly 0

Added after the re-check of 12 November 2026 (noise N1). The ladder's third node sits at 732.4 nV, and R6 carries 61.04 nA from it to ground: both real. So does the voltmeter Rvm, 7.324e−19 A, and so does the 1 µΩ wire Rw in series with it; but the wire's 7.3e−25 V drop is below one step of a double at 7.3e−7 V (1.06e−22 V), so n3 and p come out as the same double and ngspice gives Rw exactly 0 A. Solved exactly, every one of these values is real, so PlainSpice shows each as ngspice gives it, except Rw's: ngspice's exactly 0 there is its arithmetic, not the circuit, so PlainSpice shows the exact 7.324e−19 A, the meter's current, keeps ngspice's 0 in the Numbers panel's ngspice column, and says why in a note; the card says the 7.324e−25 V across Rw (C9n.4). A rule that took Rw's 0 as proof would make Rvm "the only current left at p" and draw n3 and p as 0 V next to R6's 61.04 nA: by ngspice's numbers alone, Rw's 0 cannot be told from the 0 of R5 in C9d, which is the circuit's own. The same holds for a 1 GΩ over 10 Ω divider read by a 1e20 Ω voltmeter through a 100 Ω probe (mid is at 240 nV, R2 carries 24 nA, the probe's current comes out exactly 0 and is shown as the exact 2.4e−27 A), and for a node that a 1 nV source sets (37.04 fA flow from it through R3; R1's 1e−29 A comes out exactly 0 and is shown exactly). The same doubles in native 47, native 42 and our engine.

Added after the critic of the re-check's fixes (12 November 2026): ngspice's 0 for a real current is not only in such far corners. A 1 nΩ wire R3 in series with 10 MΩ, at the 4.541 mV of a 270 kΩ over 820 Ω divider, carries 454.1 pA, as R4 does; but the 4.541e−19 V across the wire is about half a step of a double at 4.541 mV (a step is 8.7e−19 V there), far below what ngspice's arithmetic keeps in this circuit (its d2 is 36 nV from the exact one), so d2 and p3 come out as the same double and ngspice gives R3 exactly 0 A. It read "no current through R3" next to "R4 454.1 pA" in series with it. PlainSpice shows R3's exact 454.1 pA, the card the 4.541e−19 V across it, and a note says ngspice gave exactly 0 A and why.

```spice
* a ladder from 1.5 V, node n3 read by a 1 T voltmeter through a 1 u wire
V1 n0 0 1.5
R1 n0 n1 1.5k
R2 n1 0 12
R3 n1 n2 1.5k
R4 n2 0 12
R5 n2 n3 1.5k
R6 n3 0 12
R7 n3 n4 1.5k
R8 n4 0 12
Rw n3 p 1u
Rvm p 0 1t
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        p                                7.324215e-07
        n4                               5.812869e-09
        n3                               7.324215e-07
        n2                               9.301172e-05
        n1                               1.181176e-02
        n0                               1.500000e+00
        @rvm[i]                          7.324215e-19
        @rw[i]                           0.000000e+00
        @r8[i]                           4.844058e-10
        @r7[i]                           4.844058e-10
        @r6[i]                           6.103513e-08
        @r5[i]                           6.151953e-08
        @r4[i]                           7.750977e-06
        @r3[i]                           7.812496e-06
        @r2[i]                           9.843130e-04
        @r1[i]                           9.921255e-04
        v1#branch                        -9.92125e-04
  rawfile from ngspice -b -r (exit 0): v(n0) = 1.5, v(n1) = 0.011811755997793995, v(n2) = 0.00009301171983709262, v(n3) = 7.324215167679476e-7, v(n4) = 5.812869180697998e-9, v(p) = 7.324215167679476e-7, i(v1) = -0.0009921254960014707, i(@r1[i]) = 0.0009921254960014707, i(@r2[i]) = 0.0009843129998161663, i(@r3[i]) = 0.000007812496185304601, i(@r4[i]) = 0.000007750976653091051, i(@r5[i]) = 6.151953221354978e-8, i(@r6[i]) = 6.103512639732897e-8, i(@r7[i]) = 4.844057650581663e-10, i(@r8[i]) = 4.844057650581665e-10, i(@rw[i]) = 0, i(@rvm[i]) = 7.324215167679475e-19
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n0) = 1.5, v(n1) = 0.011811755997793995, v(n2) = 0.00009301171983709262, v(n3) = 7.324215167679476e-7, v(n4) = 5.812869180697998e-9, v(p) = 7.324215167679476e-7, i(v1) = -0.0009921254960014707, i(@r1[i]) = 0.0009921254960014707, i(@r2[i]) = 0.0009843129998161663, i(@r3[i]) = 0.000007812496185304601, i(@r4[i]) = 0.000007750976653091051, i(@r5[i]) = 6.151953221354978e-8, i(@r6[i]) = 6.103512639732897e-8, i(@r7[i]) = 4.844057650581663e-10, i(@r8[i]) = 4.844057650581665e-10, i(@rw[i]) = 0, i(@rvm[i]) = 7.324215167679475e-19
```

```spice
* a 1 G over 10 ohm divider read by a 1e20 ohm voltmeter through a 100 ohm probe
V1 in 0 24
R1 in mid 1g
R2 mid 0 10
Rp mid p 100
Rvm p 0 1e20
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        p                                2.400000e-07
        mid                              2.400000e-07
        in                               2.400000e+01
        @rvm[i]                          2.400000e-27
        @rp[i]                           0.000000e+00
        @r2[i]                           2.400000e-08
        @r1[i]                           2.400000e-08
        v1#branch                        -2.40000e-08
  rawfile from ngspice -b -r (exit 0): v(in) = 24, v(mid) = 2.3999999760000004e-7, v(p) = 2.3999999760000004e-7, i(v1) = -2.3999999760000007e-8, i(@r1[i]) = 2.3999999760000004e-8, i(@r2[i]) = 2.3999999760000007e-8, i(@rp[i]) = 0, i(@rvm[i]) = 2.3999999760000002e-27
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(in) = 24, v(mid) = 2.3999999760000004e-7, v(p) = 2.3999999760000004e-7, i(v1) = -2.3999999760000007e-8, i(@r1[i]) = 2.3999999760000004e-8, i(@r2[i]) = 2.3999999760000007e-8, i(@rp[i]) = 0, i(@rvm[i]) = 2.3999999760000002e-27
```

```spice
* a 1 nV source
V1 top 0 1n
R1 top s 1
R2 s 0 1e20
Vm top v 0
R3 v 0 27k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        v                                1.000000e-09
        s                                1.000000e-09
        top                              1.000000e-09
        @r3[i]                           3.703704e-14
        @r2[i]                           1.000000e-29
        @r1[i]                           0.000000e+00
        v1#branch                        -3.70370e-14
        vm#branch                        3.703704e-14
  rawfile from ngspice -b -r (exit 0): v(top) = 1e-9, v(s) = 1e-9, v(v) = 1e-9, i(vm) = 3.703703703703704e-14, i(v1) = -3.703703703703704e-14, i(@r1[i]) = 0, i(@r2[i]) = 1e-29, i(@r3[i]) = 3.703703703703704e-14
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 1e-9, v(s) = 1e-9, v(v) = 1e-9, i(vm) = 3.703703703703704e-14, i(v1) = -3.703703703703704e-14, i(@r1[i]) = 0, i(@r2[i]) = 1e-29, i(@r3[i]) = 3.703703703703704e-14
```

```spice
* a 1 n wire in series with 10 meg, from a 1.5 V divider
V1 top1 0 1.5
R1 top1 d2 270k
R2 d2 0 820
R3 d2 p3 1n
R4 p3 0 10meg
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        p3                               4.541354e-03
        d2                               4.541354e-03
        top1                             1.500000e+00
        @r4[i]                           4.541354e-10
        @r3[i]                           0.000000e+00
        @r2[i]                           5.538237e-06
        @r1[i]                           5.538736e-06
        v1#branch                        -5.53874e-06
  rawfile from ngspice -b -r (exit 0): v(top1) = 1.5, v(d2) = 0.0045413542952368715, v(p3) = 0.0045413542952368715, i(v1) = -0.000005538735724832456, i(@r1[i]) = 0.000005538735724832456, i(@r2[i]) = 0.000005538236945410819, i(@r3[i]) = 0, i(@r4[i]) = 4.5413542952368713e-10
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top1) = 1.5, v(d2) = 0.0045413542952368715, v(p3) = 0.0045413542952368715, i(v1) = -0.000005538735724832456, i(@r1[i]) = 0.000005538735724832456, i(@r2[i]) = 0.000005538236945410819, i(@r3[i]) = 0, i(@r4[i]) = 4.5413542952368713e-10
```

Added after the critic of round 2 of the re-check's fixes (13 November 2026) (C9n.5): the circuit of C9n.4 swept by ".dc V1 0 1.5 0.5" beside its .op. ngspice gives R3's current as exactly 0 at every point, its two ends coming out as the same double each time, though R3 carries V1 × 302.8 pA per volt, as R4 does: 151.4 pA at 0.5 V, 302.8 pA at 1 V and 454.1 pA at 1.5 V. The .op's words showed the exact 454.1 pA while the sweep's said 0 A at the same point. In a circuit solved exactly every value is a + b·V1, so PlainSpice shows the exact value at each point where ngspice gives exactly 0 for a real value, judged at the x ngspice swept the source to (C9p.5), in the sweep's words and in the Plot panel, with a note, and keeps ngspice's 0 in the Plot table's column "as ngspice gave it". With no .print line, ngspice −b runs no .dc, so the printout shows the .op. The same doubles in native 47, native 42 and our engine.

```spice
* a 1 n wire in series with 10 meg, from a 1.5 V divider, with .op and .dc V1 0 1.5 0.5
V1 top1 0 1.5
R1 top1 d2 270k
R2 d2 0 820
R3 d2 p3 1n
R4 p3 0 10meg
.options savecurrents
.op
.dc V1 0 1.5 0.5
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        p3                               4.541354e-03
        d2                               4.541354e-03
        top1                             1.500000e+00
        @r4[i]                           4.541354e-10
        @r3[i]                           0.000000e+00
        @r2[i]                           5.538237e-06
        @r1[i]                           5.538736e-06
        v1#branch                        -5.53874e-06
  rawfile from ngspice -b -r (exit 0): v(v-sweep) = [0, 0.5, 1, 1.5], v(top1) = [0, 0.5, 1, 1.5], v(d2) = [0, 0.001513784765078957, 0.003027569530157914, 0.0045413542952368715], v(p3) = [0, 0.001513784765078957, 0.003027569530157914, 0.0045413542952368715], i(v1) = [0, -0.0000018462452416108186, -0.0000036924904832216373, -0.000005538735724832456], i(@r1[i]) = [0, 0.0000018462452416108186, 0.0000036924904832216373, 0.000005538735724832456], i(@r2[i]) = [0, 0.000001846078981803606, 0.000003692157963607212, 0.000005538236945410819], i(@r3[i]) = [0, 0, 0, 0], i(@r4[i]) = [0, 1.513784765078957e-10, 3.027569530157914e-10, 4.5413542952368713e-10]; v(top1) = 1.5, v(d2) = 0.0045413542952368715, v(p3) = 0.0045413542952368715, i(v1) = -0.000005538735724832456, i(@r1[i]) = 0.000005538735724832456, i(@r2[i]) = 0.000005538236945410819, i(@r3[i]) = 0, i(@r4[i]) = 4.5413542952368713e-10
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(v-sweep) = [0, 0.5, 1, 1.5], v(top1) = [0, 0.5, 1, 1.5], v(d2) = [0, 0.001513784765078957, 0.003027569530157914, 0.0045413542952368715], v(p3) = [0, 0.001513784765078957, 0.003027569530157914, 0.0045413542952368715], i(v1) = [0, -0.0000018462452416108186, -0.0000036924904832216373, -0.000005538735724832456], i(@r1[i]) = [0, 0.0000018462452416108186, 0.0000036924904832216373, 0.000005538735724832456], i(@r2[i]) = [0, 0.000001846078981803606, 0.000003692157963607212, 0.000005538236945410819], i(@r3[i]) = [0, 0, 0, 0], i(@r4[i]) = [0, 1.513784765078957e-10, 3.027569530157914e-10, 4.5413542952368713e-10]; v(top1) = 1.5, v(d2) = 0.0045413542952368715, v(p3) = 0.0045413542952368715, i(v1) = -0.000005538735724832456, i(@r1[i]) = 0.000005538735724832456, i(@r2[i]) = 0.000005538236945410819, i(@r3[i]) = 0, i(@r4[i]) = 4.5413542952368713e-10
```

Added after the critic of round 2 of the re-check's fixes (13 November 2026), with its second fix (C9n.6): the circuit of C9n.5 with a diode across V1. A diode's current is left free (C9t), and R3's current does not depend on it: V1 holds top1 at its voltage whatever current D1 carries. So R3's exact value is the one without the diode, and ngspice gives it as exactly 0 in the .op and at every point of the sweep, as in C9n.5. PlainSpice shows the exact 454.1 pA in the .op, and 151.4, 302.8 and 454.1 pA at 0.5, 1 and 1.5 V, with ngspice's 0 in the Numbers panel's ngspice column and in the Plot table's column "as ngspice gave it", and the note of C9n.4. Before, with any diode in the circuit, ngspice's 0 stayed: a real current shown as 0. A value that a diode's current changes keeps ngspice's 0: its exact value depends on that current, which only ngspice's numbers give (C9t.7). The same doubles in native 47, native 42 and our engine.

```spice
* the 1 n wire of C9n.4 in series with 10 meg, with a diode across V1, with .op and .dc V1 0 1.5 0.5
V1 top1 0 1.5
R1 top1 d2 270k
R2 d2 0 820
R3 d2 p3 1n
R4 p3 0 10meg
D1 0 top1 dmod
.model dmod d
.options savecurrents
.op
.dc V1 0 1.5 0.5
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        p3                               4.541354e-03
        d2                               4.541354e-03
        top1                             1.500000e+00
        @d1[id]                          -1.51000e-12
        @r4[i]                           4.541354e-10
        @r3[i]                           0.000000e+00
        @r2[i]                           5.538237e-06
        @r1[i]                           5.538736e-06
        v1#branch                        -5.53874e-06
  rawfile from ngspice -b -r (exit 0): v(v-sweep) = [0, 0.5, 1, 1.5], v(top1) = [0, 0.5, 1, 1.5], v(d2) = [0, 0.001513784765078957, 0.003027569530157914, 0.0045413542952368715], v(p3) = [0, 0.001513784765078957, 0.003027569530157914, 0.0045413542952368715], i(v1) = [0, -0.0000018462459349228635, -0.000003692491493221405, -0.000005538737234832387], i(@r1[i]) = [0, 0.0000018462452416108186, 0.0000036924904832216373, 0.000005538735724832456], i(@r2[i]) = [0, 0.000001846078981803606, 0.000003692157963607212, 0.000005538236945410819], i(@r3[i]) = [0, 0, 0, 0], i(@r4[i]) = [0, 1.513784765078957e-10, 3.027569530157914e-10, 4.5413542952368713e-10], i(@d1[id]) = [0, -5.099981391833937e-13, -1.0099997673979242e-12, -1.5099999310808666e-12]; v(top1) = 1.5, v(d2) = 0.0045413542952368715, v(p3) = 0.0045413542952368715, i(v1) = -0.000005538737234832387, i(@r1[i]) = 0.000005538735724832456, i(@r2[i]) = 0.000005538236945410819, i(@r3[i]) = 0, i(@r4[i]) = 4.5413542952368713e-10, i(@d1[id]) = -1.5099999310808666e-12
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(v-sweep) = [0, 0.5, 1, 1.5], v(top1) = [0, 0.5, 1, 1.5], v(d2) = [0, 0.001513784765078957, 0.003027569530157914, 0.0045413542952368715], v(p3) = [0, 0.001513784765078957, 0.003027569530157914, 0.0045413542952368715], i(v1) = [0, -0.0000018462459349228635, -0.000003692491493221405, -0.000005538737234832387], i(@r1[i]) = [0, 0.0000018462452416108186, 0.0000036924904832216373, 0.000005538735724832456], i(@r2[i]) = [0, 0.000001846078981803606, 0.000003692157963607212, 0.000005538236945410819], i(@r3[i]) = [0, 0, 0, 0], i(@r4[i]) = [0, 1.513784765078957e-10, 3.027569530157914e-10, 4.5413542952368713e-10], i(@d1[id]) = [0, -5.099981391833937e-13, -1.0099997673979242e-12, -1.5099999310808666e-12]; v(top1) = 1.5, v(d2) = 0.0045413542952368715, v(p3) = 0.0045413542952368715, i(v1) = -0.000005538737234832387, i(@r1[i]) = 0.000005538735724832456, i(@r2[i]) = 0.000005538236945410819, i(@r3[i]) = 0, i(@r4[i]) = 4.5413542952368713e-10, i(@d1[id]) = -1.5099999310808666e-12
```

### C9o. Rounding noise of a 0 that a large gain lifts above 1 pA is still 0: an H of 1 GΩ reading a balanced bridge's ammeter gives 193.5 pA through 1 kΩ

Added after the re-check of 12 November 2026 (noise N2). The bridge is balanced (180 kΩ over 3.9 MΩ and 18 kΩ over 390 kΩ, both 3/65), so the 0 V source Vm carries no current, H1 makes 1 GΩ × 0 A = 0 V, node out is at 0 V and Rl carries no current. ngspice leaves −1.9e−16 A in Vm, and H1 multiplies it by 10⁹: out = −1.935e−7 V and Rl −193.5 pA, above ngspice's 1 pA current tolerance (C9c). The circuit makes each of them exactly 0, and the size is what H1's gain makes of ngspice's rounding, so PlainSpice shows 0 V and 0 A, with a note that gives ngspice's numbers. An E of 10⁶ reading the bridge of C9 into 100 Ω does the same (out −931.3 pV, Rl −9.3 pA). Fed from 5 V through 1 kΩ, the same E carries a real 5 mA at exactly 0 V: PlainSpice shows its 5 mA and node out as 0 V, and no power for E1 (no voltage across it). The same doubles in native 47, native 42 and our engine.

Added after the critic of the re-check's fixes (12 November 2026), and corrected after the critic of round 2 (13 November 2026) (C9o.4): the same circuit with a diode from ground to top. A diode's current is left free (C9t): H1's control, Vm's current, is exactly 0 whatever current the diode carries, so out is exactly 0 V and Rl and H1 carry 0 A, as without the diode; PlainSpice shows them so, with a note that says the circuit makes them exactly 0 "whatever current its diodes carry" (until the critic of round 4 this fact quoted the note's earlier words, "from the netlist's values and its diodes' currents", which the critic of round 3 found said the opposite of how the 0 was found). Before, a circuit with a diode was left to the rule for other circuits, which kept out at ngspice's −193.5 nV beside Rl's 193.5 pA and, since it took Vm as noise, drew H1's 193.5 pA beside a 0 that H1 makes it from. The rule still decides a circuit with a transistor, a switch or a line PlainSpice does not model exactly (`.options gmin`; a .temp line until the last pass, C9w): there no node is written as 0 V, Vm keeps its −193.5 aA (the current H1 makes out from is real by the page's numbers), and out, Rl and H1 keep ngspice's numbers, H1 with the power they make. The same doubles in native 47, native 42 and our engine.

Added after the critic of round 2 (13 November 2026) (C9o.5): the E of 10⁶ reading the bridge of C9 into 100 Ω, with ngspice's own gmin written out (`.options gmin=1e-12`; a .temp 27 line until the last pass, which PlainSpice now models exactly, C9w: the same doubles). ngspice gives the same doubles as without the line (1e-12 is its default gmin), but PlainSpice does not model a gmin option exactly, so the rule for other circuits decides. It writes no node as 0 V, so out keeps ngspice's −931.3 pV, which E1 makes from the voltage between a and b; and R5, between those two nodes, keeps ngspice's 8.882e−19 A from b to a. Before, the rule showed R5 as 0 A, "its two ends at the same voltage", beside the voltage E1 makes from theirs. ngspice's numbers agree with each other only to its rounding (10⁶ × (v(a) − v(b)) is −888.2 pV, out −931.3 pV): each of them is noise of a 0. The same doubles in native 47, native 42 and our engine.

```spice
* a balanced bridge whose ammeter an H of 1 G reads
V1 top 0 9
R1 top a 180k
R2 a 0 3.9meg
R3 top b 18k
R4 b 0 390k
R5 a m 4.7
Vm m b 0
H1 out 0 Vm 1g
Rl out 0 1k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out                              -1.93510e-07
        m                                8.602941e+00
        b                                8.602941e+00
        a                                8.602941e+00
        top                              9.000000e+00
        @rl[i]                           -1.93510e-10
        @r5[i]                           -3.77948e-16
        @r4[i]                           2.205882e-05
        @r3[i]                           2.205882e-05
        @r2[i]                           2.205882e-06
        @r1[i]                           2.205882e-06
        v1#branch                        -2.42647e-05
        vm#branch                        -1.93510e-16
        h1#branch                        1.935098e-10
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 8.602941176467256, v(b) = 8.602941176467258, v(m) = 8.602941176467258, v(out) = -1.9350975899792844e-7, i(h1) = 1.9350975899792844e-10, i(vm) = -1.9350975899792844e-16, i(v1) = -0.000024264705882556586, i(@r1[i]) = 0.0000022058823529596873, i(@r2[i]) = 0.000002205882352940322, i(@r3[i]) = 0.000022058823529596775, i(@r4[i]) = 0.000022058823529403225, i(@r5[i]) = -3.7794826370218095e-16, i(@rl[i]) = -1.9350975899792844e-10
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 8.602941176467256, v(b) = 8.602941176467258, v(m) = 8.602941176467258, v(out) = -1.9350975899792844e-7, i(h1) = 1.9350975899792844e-10, i(vm) = -1.9350975899792844e-16, i(v1) = -0.000024264705882556586, i(@r1[i]) = 0.0000022058823529596873, i(@r2[i]) = 0.000002205882352940322, i(@r3[i]) = 0.000022058823529596775, i(@r4[i]) = 0.000022058823529403225, i(@r5[i]) = -3.7794826370218095e-16, i(@rl[i]) = -1.9350975899792844e-10
```

```spice
* the balanced bridge of C9 read by an E of 1e6 into 100 ohms
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
E1 out 0 a b 1e6
Rl out 0 100
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out                              -9.31323e-10
        b                                4.500000e+00
        a                                4.500000e+00
        top                              9.000000e+00
        @rl[i]                           -9.31323e-12
        @r5[i]                           -8.88178e-19
        @r4[i]                           9.574468e-04
        @r3[i]                           9.574468e-04
        @r2[i]                           4.500000e-04
        @r1[i]                           4.500000e-04
        v1#branch                        -1.40745e-03
        e1#branch                        9.313226e-12
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, v(out) = -9.313225746154785e-10, i(e1) = 9.313225746154785e-12, i(v1) = -0.0014074468085106386, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19, i(@rl[i]) = -9.313225746154785e-12
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, v(out) = -9.313225746154785e-10, i(e1) = 9.313225746154785e-12, i(v1) = -0.0014074468085106386, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19, i(@rl[i]) = -9.313225746154785e-12
```

```spice
* the same E, its output fed from 5 V through 1 k
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
E1 out 0 a b 1e6
V2 x 0 5
Rx x out 1k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        x                                5.000000e+00
        out                              -9.31323e-10
        b                                4.500000e+00
        a                                4.500000e+00
        top                              9.000000e+00
        @rx[i]                           5.000000e-03
        @r5[i]                           -8.88178e-19
        @r4[i]                           9.574468e-04
        @r3[i]                           9.574468e-04
        @r2[i]                           4.500000e-04
        @r1[i]                           4.500000e-04
        v1#branch                        -1.40745e-03
        v2#branch                        -5.00000e-03
        e1#branch                        5.000000e-03
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, v(out) = -9.313225746154785e-10, v(x) = 5, i(e1) = 0.005000000000931323, i(v2) = -0.005000000000931323, i(v1) = -0.0014074468085106386, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19, i(@rx[i]) = 0.005000000000931323
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, v(out) = -9.313225746154785e-10, v(x) = 5, i(e1) = 0.005000000000931323, i(v2) = -0.005000000000931323, i(v1) = -0.0014074468085106386, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19, i(@rx[i]) = 0.005000000000931323
```

```spice
* the H of 1 G reading a balanced bridge's ammeter, with a diode
V1 top 0 9
R1 top a 180k
R2 a 0 3.9meg
R3 top b 18k
R4 b 0 390k
R5 a m 4.7
Vm m b 0
H1 out 0 Vm 1g
Rl out 0 1k
D1 0 top dmod
.model dmod d
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out                              -1.93510e-07
        m                                8.602941e+00
        b                                8.602941e+00
        a                                8.602941e+00
        top                              9.000000e+00
        @d1[id]                          -9.01000e-12
        @rl[i]                           -1.93510e-10
        @r5[i]                           -3.77948e-16
        @r4[i]                           2.205882e-05
        @r3[i]                           2.205882e-05
        @r2[i]                           2.205882e-06
        @r1[i]                           2.205882e-06
        v1#branch                        -2.42647e-05
        vm#branch                        -1.93510e-16
        h1#branch                        1.935098e-10
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 8.602941176467256, v(b) = 8.602941176467258, v(m) = 8.602941176467258, v(out) = -1.9350975899792844e-7, i(h1) = 1.9350975899792844e-10, i(vm) = -1.9350975899792844e-16, i(v1) = -0.00002426471489255658, i(@r1[i]) = 0.0000022058823529596873, i(@r2[i]) = 0.000002205882352940322, i(@r3[i]) = 0.000022058823529596775, i(@r4[i]) = 0.000022058823529403225, i(@r5[i]) = -3.7794826370218095e-16, i(@rl[i]) = -1.9350975899792844e-10, i(@d1[id]) = -9.00999999968093e-12
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 8.602941176467256, v(b) = 8.602941176467258, v(m) = 8.602941176467258, v(out) = -1.9350975899792844e-7, i(h1) = 1.9350975899792844e-10, i(vm) = -1.9350975899792844e-16, i(v1) = -0.00002426471489255658, i(@r1[i]) = 0.0000022058823529596873, i(@r2[i]) = 0.000002205882352940322, i(@r3[i]) = 0.000022058823529596775, i(@r4[i]) = 0.000022058823529403225, i(@r5[i]) = -3.7794826370218095e-16, i(@rl[i]) = -1.9350975899792844e-10, i(@d1[id]) = -9.00999999968093e-12
```

```spice
* the balanced bridge of C9 read by an E of 1e6 into 100 ohms, with ngspice's own gmin written out
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
E1 out 0 a b 1e6
Rl out 0 100
.options gmin=1e-12
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out                              -9.31323e-10
        b                                4.500000e+00
        a                                4.500000e+00
        top                              9.000000e+00
        @rl[i]                           -9.31323e-12
        @r5[i]                           -8.88178e-19
        @r4[i]                           9.574468e-04
        @r3[i]                           9.574468e-04
        @r2[i]                           4.500000e-04
        @r1[i]                           4.500000e-04
        v1#branch                        -1.40745e-03
        e1#branch                        9.313226e-12
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, v(out) = -9.313225746154785e-10, i(e1) = 9.313225746154785e-12, i(v1) = -0.0014074468085106386, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19, i(@rl[i]) = -9.313225746154785e-12
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, v(out) = -9.313225746154785e-10, i(e1) = 9.313225746154785e-12, i(v1) = -0.0014074468085106386, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19, i(@rl[i]) = -9.313225746154785e-12
```

### C9p. The .tf ratio and the .dc points of a balanced bridge are rounding noise of a 0 too

Added after the re-check of 12 November 2026 (spice S8). ".tf v(a,b) V1" on the bridge of C9 prints transfer_function = −5.55112e−17: v(a) and v(b) are both exactly half of V1, so the ratio is exactly 0. ".tf i(Vm) V1" gives −2.71e−20 A/V for a current that is 0. ".dc V1 0 9 3" of the bridge with Vm gives i(vm) = −5.4e−20, −1.08e−19 and −2.17e−19 A at 3, 6 and 9 V, exactly 0 at each point. In a circuit PlainSpice solves exactly every value is a + b·V1, so one more exact solution gives the ratio and every point, each judged at the value ngspice swept V1 to (C9p.5): PlainSpice shows 0 V/V and 0 A, in its words, on the card and in the Plot panel, with a note that gives ngspice's numbers, which the Numbers panel's printed column and the Plot panel's table and CSV keep. A real ratio far smaller than that noise stays as it is: 1 MΩ over 1e−12 Ω gives 1e−18 V/V. With no .print line, ngspice −b runs no .dc (record-native.ts), so the .dc block gives the rawfile values. .tran is left as ngspice gives it. The same doubles in native 47, native 42 and our engine.

Added after the critic of the re-check's fixes (12 November 2026): ngspice reaches a sweep's points by adding the step in doubles, so ".dc V1 -1 1 0.1" of a 1 kΩ over 2 kΩ divider reaches −1.3877787807814457e−16 V at its eleventh point, where the student wrote 0, and v(a), which follows V1, is a real −1.39e−16 V there, as the Plot panel's x says. Judged at the student's 0, v(a) was called noise there, next to that x. Each point is now judged at ngspice's own x, read exactly: a value a + b·V1 is 0 at a point only when ngspice's x is −a/b exactly, so this sweep has no noise and no note.

```spice
* the balanced bridge of C9 with .tf v(a,b) V1
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
.tf v(a,b) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        transfer_function = -5.55112e-17
        output_impedance_at_v(a,b) = 8.802395e+02
        v1#input_impedance = 6.394558e+03
  rawfile from ngspice -b -r (exit 0): v(Transfer_function) = -5.551115123125783e-17, v(v1#Input_impedance) = 6394.557823129251, v(output_impedance_at_V(a,b)) = 880.2395209580839
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(Transfer_function) = -5.551115123125783e-17, v(v1#Input_impedance) = 6394.557823129251, v(output_impedance_at_V(a,b)) = 880.2395209580839
```

```spice
* the bridge of C9d with .tf i(Vm) V1
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a m 1k
Vm m b 0
.tf i(Vm) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        transfer_function = -2.71051e-20
        v1#input_impedance = 6.394558e+03
        vm#output_impedance = 1.000000e+20
  rawfile from ngspice -b -r (exit 0): v(Transfer_function) = -2.710505431213761e-20, v(v1#Input_impedance) = 6394.557823129248, v(vm#Output_impedance) = 100000000000000000000
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(Transfer_function) = -2.710505431213761e-20, v(v1#Input_impedance) = 6394.557823129248, v(vm#Output_impedance) = 100000000000000000000
```

```spice
* the bridge of C9d swept by .dc V1 0 9 3
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a m 1k
Vm m b 0
.dc V1 0 9 3
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
  rawfile from ngspice -b -r (exit 0): v(v-sweep) = [0, 3, 6, 9], v(top) = [0, 3, 6, 9], v(a) = [0, 1.4999999999999996, 2.999999999999999, 4.499999999999999], v(b) = [0, 1.4999999999999996, 2.999999999999999, 4.499999999999999], v(m) = [0, 1.4999999999999996, 2.999999999999999, 4.499999999999999], i(vm) = [0, -5.421010862427522e-20, -1.0842021724855044e-19, -2.168404344971009e-19], i(v1) = [0, -0.000469148936170213, -0.000938297872340426, -0.0014074468085106388]
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 0): v(v-sweep) = [0, 3, 6, 9], v(top) = [0, 3, 6, 9], v(a) = [0, 1.4999999999999996, 2.999999999999999, 4.499999999999999], v(b) = [0, 1.4999999999999996, 2.999999999999999, 4.499999999999999], v(m) = [0, 1.4999999999999996, 2.999999999999999, 4.499999999999999], i(vm) = [0, -5.421010862427522e-20, -1.0842021724855044e-19, -2.168404344971009e-19], i(v1) = [0, -0.000469148936170213, -0.000938297872340426, -0.0014074468085106388]
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(v-sweep) = [0, 3, 6, 9], v(top) = [0, 3, 6, 9], v(a) = [0, 1.4999999999999996, 2.999999999999999, 4.499999999999999], v(b) = [0, 1.4999999999999996, 2.999999999999999, 4.499999999999999], v(m) = [0, 1.4999999999999996, 2.999999999999999, 4.499999999999999], i(vm) = [0, -5.421010862427522e-20, -1.0842021724855044e-19, -2.168404344971009e-19], i(v1) = [0, -0.000469148936170213, -0.000938297872340426, -0.0014074468085106388]
```

```spice
* a real ratio far smaller than noise: 1 Meg over 1e-12 ohm
V1 in 0 1
R1 in out 1meg
R2 out 0 1e-12
.tf v(out) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        transfer_function = 1.000000e-18
        output_impedance_at_v(out) = 1.000000e-12
        v1#input_impedance = 1.000000e+06
  rawfile from ngspice -b -r (exit 0): v(Transfer_function) = 9.999999999999999e-19, v(v1#Input_impedance) = 1000000, v(output_impedance_at_V(out)) = 1e-12
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(Transfer_function) = 9.999999999999999e-19, v(v1#Input_impedance) = 1000000, v(output_impedance_at_V(out)) = 1e-12
```

```spice
* a divider swept through 0: .dc V1 -1 1 0.1
V1 a 0 0
R1 a b 1k
R2 b 0 2k
.dc V1 -1 1 0.1
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
  rawfile from ngspice -b -r (exit 0): v(v-sweep) = [-1, -0.9, -0.8, -0.7000000000000001, -0.6000000000000001, -0.5000000000000001, -0.40000000000000013, -0.30000000000000016, -0.20000000000000015, -0.10000000000000014, -1.3877787807814457e-16, 0.09999999999999987, 0.19999999999999987, 0.2999999999999999, 0.3999999999999999, 0.4999999999999999, 0.5999999999999999, 0.6999999999999998, 0.7999999999999998, 0.8999999999999998, 0.9999999999999998], v(a) = [-1, -0.9, -0.8, -0.7000000000000001, -0.6000000000000001, -0.5000000000000001, -0.40000000000000013, -0.30000000000000016, -0.20000000000000015, -0.10000000000000014, -1.3877787807814457e-16, 0.09999999999999987, 0.19999999999999987, 0.2999999999999999, 0.3999999999999999, 0.4999999999999999, 0.5999999999999999, 0.6999999999999998, 0.7999999999999998, 0.8999999999999998, 0.9999999999999998], v(b) = [-0.6666666666666666, -0.6, -0.5333333333333333, -0.46666666666666673, -0.4, -0.33333333333333337, -0.2666666666666667, -0.20000000000000007, -0.13333333333333341, -0.06666666666666676, -9.25185853854297e-17, 0.06666666666666658, 0.13333333333333325, 0.1999999999999999, 0.2666666666666666, 0.33333333333333326, 0.39999999999999986, 0.46666666666666656, 0.5333333333333332, 0.5999999999999999, 0.6666666666666665], i(v1) = [0.0003333333333333334, 0.00030000000000000014, 0.0002666666666666667, 0.00023333333333333339, 0.00020000000000000004, 0.00016666666666666674, 0.0001333333333333334, 0.00010000000000000007, 0.00006666666666666672, 0.000033333333333333376, 4.6259292692714865e-20, -0.00003333333333333328, -0.00006666666666666662, -0.00009999999999999996, -0.00013333333333333329, -0.00016666666666666663, -0.00019999999999999998, -0.00023333333333333333, -0.00026666666666666657, -0.00030000000000000003, -0.00033333333333333327]
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 0): v(v-sweep) = [-1, -0.9, -0.8, -0.7000000000000001, -0.6000000000000001, -0.5000000000000001, -0.40000000000000013, -0.30000000000000016, -0.20000000000000015, -0.10000000000000014, -1.3877787807814457e-16, 0.09999999999999987, 0.19999999999999987, 0.2999999999999999, 0.3999999999999999, 0.4999999999999999, 0.5999999999999999, 0.6999999999999998, 0.7999999999999998, 0.8999999999999998, 0.9999999999999998], v(a) = [-1, -0.9, -0.8, -0.7000000000000001, -0.6000000000000001, -0.5000000000000001, -0.40000000000000013, -0.30000000000000016, -0.20000000000000015, -0.10000000000000014, -1.3877787807814457e-16, 0.09999999999999987, 0.19999999999999987, 0.2999999999999999, 0.3999999999999999, 0.4999999999999999, 0.5999999999999999, 0.6999999999999998, 0.7999999999999998, 0.8999999999999998, 0.9999999999999998], v(b) = [-0.6666666666666666, -0.6, -0.5333333333333333, -0.46666666666666673, -0.4, -0.33333333333333337, -0.2666666666666667, -0.20000000000000007, -0.13333333333333341, -0.06666666666666676, -9.25185853854297e-17, 0.06666666666666658, 0.13333333333333325, 0.1999999999999999, 0.2666666666666666, 0.33333333333333326, 0.39999999999999986, 0.46666666666666656, 0.5333333333333332, 0.5999999999999999, 0.6666666666666665], i(v1) = [0.0003333333333333334, 0.00030000000000000014, 0.0002666666666666667, 0.00023333333333333339, 0.00020000000000000004, 0.00016666666666666674, 0.0001333333333333334, 0.00010000000000000007, 0.00006666666666666672, 0.000033333333333333376, 4.6259292692714865e-20, -0.00003333333333333328, -0.00006666666666666662, -0.00009999999999999996, -0.00013333333333333329, -0.00016666666666666663, -0.00019999999999999998, -0.00023333333333333333, -0.00026666666666666657, -0.00030000000000000003, -0.00033333333333333327]
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(v-sweep) = [-1, -0.9, -0.8, -0.7000000000000001, -0.6000000000000001, -0.5000000000000001, -0.40000000000000013, -0.30000000000000016, -0.20000000000000015, -0.10000000000000014, -1.3877787807814457e-16, 0.09999999999999987, 0.19999999999999987, 0.2999999999999999, 0.3999999999999999, 0.4999999999999999, 0.5999999999999999, 0.6999999999999998, 0.7999999999999998, 0.8999999999999998, 0.9999999999999998], v(a) = [-1, -0.9, -0.8, -0.7000000000000001, -0.6000000000000001, -0.5000000000000001, -0.40000000000000013, -0.30000000000000016, -0.20000000000000015, -0.10000000000000014, -1.3877787807814457e-16, 0.09999999999999987, 0.19999999999999987, 0.2999999999999999, 0.3999999999999999, 0.4999999999999999, 0.5999999999999999, 0.6999999999999998, 0.7999999999999998, 0.8999999999999998, 0.9999999999999998], v(b) = [-0.6666666666666666, -0.6, -0.5333333333333333, -0.46666666666666673, -0.4, -0.33333333333333337, -0.2666666666666667, -0.20000000000000007, -0.13333333333333341, -0.06666666666666676, -9.25185853854297e-17, 0.06666666666666658, 0.13333333333333325, 0.1999999999999999, 0.2666666666666666, 0.33333333333333326, 0.39999999999999986, 0.46666666666666656, 0.5333333333333332, 0.5999999999999999, 0.6666666666666665], i(v1) = [0.0003333333333333334, 0.00030000000000000014, 0.0002666666666666667, 0.00023333333333333339, 0.00020000000000000004, 0.00016666666666666674, 0.0001333333333333334, 0.00010000000000000007, 0.00006666666666666672, 0.000033333333333333376, 4.6259292692714865e-20, -0.00003333333333333328, -0.00006666666666666662, -0.00009999999999999996, -0.00013333333333333329, -0.00016666666666666663, -0.00019999999999999998, -0.00023333333333333333, -0.00026666666666666657, -0.00030000000000000003, -0.00033333333333333327]
```

Added after the critic of round 2 of the re-check's fixes (13 November 2026) (C9p.6): the bridge of C9o, read by the H of 1 GΩ, with .op and ".tf v(out) V1". ngspice gives transfer_function = −2.15e−8 V/V; its .op gives out −193.5 nV. The circuit makes out 0 V for every V1 (H1 makes 1 GΩ × 0 A), so the ratio is exactly 0, and −2.15e−8 is ngspice's rounding of the balance lifted by H1's gain, as in the .op. A .tf alone gives no node voltages to check its circuit against, so PlainSpice calls a ratio noise only below 2⁻³⁰ of the largest change the input makes in a value of the output's kind, and −2.15e−8 is far above that (a changes by 0.956 V per volt of V1). With an .op beside it that PlainSpice decides exactly (ngspice simulated this circuit and solved it to the page's digits), an exact 0 ratio is 0 whatever its size, as the .op's values are: PlainSpice shows v(out)/V1 = 0 (V/V) beside out 0 V, with a note; ".tf i(Vm) V1" (−2.15e−17 A/V) the same. ngspice 42 −b, with .op and .tf together, prints "no data saved for transfer function analysis" and exits 1 but writes the same values to its rawfile; native 47 and our engine give the same doubles.

```spice
* the H of 1 G reading a balanced bridge's ammeter, with .op and .tf v(out) V1
V1 top 0 9
R1 top a 180k
R2 a 0 3.9meg
R3 top b 18k
R4 b 0 390k
R5 a m 4.7
Vm m b 0
H1 out 0 Vm 1g
Rl out 0 1k
.op
.tf v(out) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out                              -1.93510e-07
        m                                8.602941e+00
        b                                8.602941e+00
        a                                8.602941e+00
        top                              9.000000e+00
        v1#branch                        -2.42647e-05
        vm#branch                        -1.93510e-16
        h1#branch                        1.935098e-10
        transfer_function = -2.15002e-08
        output_impedance_at_v(out) = 0.000000e+00
        v1#input_impedance = 3.709091e+05
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 8.602941176467256, v(b) = 8.602941176467258, v(m) = 8.602941176467258, v(out) = -1.9350975899792844e-7, i(h1) = 1.9350975899792844e-10, i(vm) = -1.9350975899792844e-16, i(v1) = -0.000024264705882556586; v(Transfer_function) = -2.1500237300155906e-8, v(v1#Input_impedance) = 370909.0909059788, v(output_impedance_at_V(out)) = 0
ngspice 42, ngspice -b (exit 1):
        out                              -1.93510e-07
        m                                8.602941e+00
        b                                8.602941e+00
        a                                8.602941e+00
        top                              9.000000e+00
        v1#branch                        -2.42647e-05
        vm#branch                        -1.93510e-16
        h1#branch                        1.935098e-10
    Error: no data saved for transfer function analysis; analysis not run
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 8.602941176467256, v(b) = 8.602941176467258, v(m) = 8.602941176467258, v(out) = -1.9350975899792844e-7, i(h1) = 1.9350975899792844e-10, i(vm) = -1.9350975899792844e-16, i(v1) = -0.000024264705882556586; v(Transfer_function) = -2.1500237300155906e-8, v(v1#Input_impedance) = 370909.0909059788, v(output_impedance_at_V(out)) = 0
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 8.602941176467256, v(b) = 8.602941176467258, v(m) = 8.602941176467258, v(out) = -1.9350975899792844e-7, i(h1) = 1.9350975899792844e-10, i(vm) = -1.9350975899792844e-16, i(v1) = -0.000024264705882556586; v(Transfer_function) = -2.1500237300155906e-8, v(v1#Input_impedance) = 370909.0909059788, v(output_impedance_at_V(out)) = 0
```

### C9q. Noise of a 0 below 1 pA everywhere: the bridge of C9 fed by a current source written 2A (2 attoamps)

Added after the re-check of 12 November 2026 (noise N3). `2A` is 2 attoamps (unit-letter-1 in traps.md), so every current here is below 1 pA, and every one but R5's is real: the arms carry their share of I1's 2 aA. R5's ends are both exactly at 6.395 fV, so it carries no current; ngspice gives a and b one step of a double apart and R5 −7.9e−34 A. A rule that makes every part at a node real when the real tiny currents there do not add up showed it as a current with an arrow; solved exactly, it is 0, so PlainSpice shows 0 A with a note, and I1 and the arms as ngspice gives them. The same doubles in native 47, native 42 and our engine.

```spice
* the balanced bridge of C9 fed by a current source written 2A (2 attoamps)
I1 0 top 2A
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                6.394558e-15
        a                                6.394558e-15
        top                              1.278912e-14
        @r5[i]                           -7.88861e-34
        @r4[i]                           1.360544e-18
        @r3[i]                           1.360544e-18
        @r2[i]                           6.394558e-19
        @r1[i]                           6.394558e-19
        @i1[current]                     2.000000e-18
  rawfile from ngspice -b -r (exit 0): v(top) = 1.2789115646258505e-14, v(a) = 6.394557823129253e-15, v(b) = 6.394557823129254e-15, i(@i1[current]) = 2e-18, i(@r1[i]) = 6.394557823129252e-19, i(@r2[i]) = 6.394557823129254e-19, i(@r3[i]) = 1.3605442176870746e-18, i(@r4[i]) = 1.3605442176870753e-18, i(@r5[i]) = -7.888609052210118e-34
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 1.2789115646258505e-14, v(a) = 6.394557823129253e-15, v(b) = 6.394557823129254e-15, i(@i1[current]) = 2e-18, i(@r1[i]) = 6.394557823129252e-19, i(@r2[i]) = 6.394557823129254e-19, i(@r3[i]) = 1.3605442176870746e-18, i(@r4[i]) = 1.3605442176870753e-18, i(@r5[i]) = -7.888609052210118e-34
```

### C9r. A source that copies or reads a 0 drives loads that carry 0: an F into two resistors side by side, a G into two

Added after the re-check of 12 November 2026 (spice S3). F1 copies 1000 × Vm's current, which is 0 in the bridge of C9d, into R6 and R7 side by side; G1 reads the voltage between a and b of the bridge of C9, which is 0, into 1 kΩ and 2 kΩ side by side. Every load's current and node out's voltage are 0. ngspice gives F1 −2.17e−16 A, R6 and R7 −1.08e−16 A each and out −1.08e−13 V; G1 −8.9e−19 A, R6 −8.9e−19 A, R7 −4.4e−19 A and out −8.9e−16 V. PlainSpice shows every one of them as 0 (the exact solution), so the drawing keeps Kirchhoff's current law at out: a rule that needed the "only current left" at out zeroed F1 or G1 but left the loads' attoamps. The same doubles in native 47, native 42 and our engine.

```spice
* the bridge of C9d, its F feeding two resistors side by side
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a m 1k
Vm m b 0
F1 0 out Vm 1000
R6 out 0 1k
R7 out 0 1k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out                              -1.08420e-13
        m                                4.500000e+00
        b                                4.500000e+00
        a                                4.500000e+00
        top                              9.000000e+00
        @r7[i]                           -1.08420e-16
        @r6[i]                           -1.08420e-16
        @f1[i]                           -2.16840e-16
        @r5[i]                           0.000000e+00
        @r4[i]                           9.574468e-04
        @r3[i]                           9.574468e-04
        @r2[i]                           4.500000e-04
        @r1[i]                           4.500000e-04
        v1#branch                        -1.40745e-03
        vm#branch                        -2.16840e-19
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.499999999999999, v(m) = 4.499999999999999, v(out) = -1.0842021724855044e-13, i(vm) = -2.168404344971009e-19, i(v1) = -0.0014074468085106388, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106385, i(@r4[i]) = 0.0009574468085106381, i(@r5[i]) = 0, i(@f1[i]) = -2.1684043449710089e-16, i(@r6[i]) = -1.0842021724855044e-16, i(@r7[i]) = -1.0842021724855044e-16
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.499999999999999, v(m) = 4.499999999999999, v(out) = -1.0842021724855044e-13, i(vm) = -2.168404344971009e-19, i(v1) = -0.0014074468085106388, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106385, i(@r4[i]) = 0.0009574468085106381, i(@r5[i]) = 0, i(@f1[i]) = -2.1684043449710089e-16, i(@r6[i]) = -1.0842021724855044e-16, i(@r7[i]) = -1.0842021724855044e-16
```

```spice
* the balanced bridge of C9 read by a G feeding two resistors side by side
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
G1 0 out a b 1m
R6 out 0 1k
R7 out 0 2k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out                              -8.88178e-16
        b                                4.500000e+00
        a                                4.500000e+00
        top                              9.000000e+00
        @r7[i]                           -4.44089e-19
        @r6[i]                           -8.88178e-19
        @g1[i]                           -8.88178e-19
        @r5[i]                           -8.88178e-19
        @r4[i]                           9.574468e-04
        @r3[i]                           9.574468e-04
        @r2[i]                           4.500000e-04
        @r1[i]                           4.500000e-04
        v1#branch                        -1.40745e-03
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, v(out) = -8.881784197001252e-16, i(v1) = -0.0014074468085106386, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19, i(@g1[i]) = -8.881784197001253e-19, i(@r6[i]) = -8.881784197001253e-19, i(@r7[i]) = -4.440892098500626e-19
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, v(out) = -8.881784197001252e-16, i(v1) = -0.0014074468085106386, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19, i(@g1[i]) = -8.881784197001253e-19, i(@r6[i]) = -8.881784197001253e-19, i(@r7[i]) = -4.440892098500626e-19
```

Added after the critic of round 2 of the re-check's fixes (13 November 2026), with its second fix (C9r.3): the bridge of C9o read by an F of 1000 into two loads of 1 kΩ, and by an F of 1 into a 0 V ammeter, with ngspice's own gmin written out (a .temp line until the last pass, which PlainSpice now models exactly, C9w: the same doubles), so the rule for other circuits decides. The bridge is balanced: every value here that is not the bridge's own is noise of a 0. ngspice gives Vm −193.5 aA, F1 193.5 fA, R6 and R7 96.75 fA each, F2 and Vx 193.5 aA. The rule first takes Vm as noise (the only current left at m once R5, whose two ends ngspice gives a step apart, is taken as 0), then gives it back: F1's two loads keep their femtoamps (Kirchhoff's law at out), and F1 makes them from Vm. F2 kept its 0, "it pushes 1 × the current in Vm, which is 0", beside Vm's 193.5 aA: its equation broke on the page. Now each F that copies a current given back gets its number back too, and F2 and Vx show ngspice's 193.5 aA. The same doubles in native 47, native 42 and our engine.

```spice
* an F of 1000 into two loads and an F of 1 into a 0 V ammeter, both reading the ammeter of a balanced bridge, with ngspice's own gmin written out
V1 top 0 9
R1 top a 180k
R2 a 0 3.9meg
R3 top b 18k
R4 b 0 390k
R5 a m 4.7
Vm m b 0
F1 0 out Vm 1000
R6 out 0 1k
R7 out 0 1k
F2 0 y Vm 1
Vx y 0 0
.options gmin=1e-12
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        y                                0.000000e+00
        out                              -9.67549e-11
        m                                8.602941e+00
        b                                8.602941e+00
        a                                8.602941e+00
        top                              9.000000e+00
        @f2[i]                           -1.93510e-16
        @r7[i]                           -9.67549e-14
        @r6[i]                           -9.67549e-14
        @f1[i]                           -1.93510e-13
        @r5[i]                           -3.77948e-16
        @r4[i]                           2.205882e-05
        @r3[i]                           2.205882e-05
        @r2[i]                           2.205882e-06
        @r1[i]                           2.205882e-06
        v1#branch                        -2.42647e-05
        vx#branch                        -1.93510e-16
        vm#branch                        -1.93510e-16
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 8.602941176467256, v(b) = 8.602941176467258, v(m) = 8.602941176467258, v(out) = -9.675487949896422e-11, v(y) = 0, i(vm) = -1.9350975899792844e-16, i(vx) = -1.9350975899792844e-16, i(v1) = -0.000024264705882556586, i(@r1[i]) = 0.0000022058823529596873, i(@r2[i]) = 0.000002205882352940322, i(@r3[i]) = 0.000022058823529596775, i(@r4[i]) = 0.000022058823529403225, i(@r5[i]) = -3.7794826370218095e-16, i(@f1[i]) = -1.9350975899792844e-13, i(@r6[i]) = -9.675487949896422e-14, i(@r7[i]) = -9.675487949896422e-14, i(@f2[i]) = -1.9350975899792844e-16
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 8.602941176467256, v(b) = 8.602941176467258, v(m) = 8.602941176467258, v(out) = -9.675487949896422e-11, v(y) = 0, i(vm) = -1.9350975899792844e-16, i(vx) = -1.9350975899792844e-16, i(v1) = -0.000024264705882556586, i(@r1[i]) = 0.0000022058823529596873, i(@r2[i]) = 0.000002205882352940322, i(@r3[i]) = 0.000022058823529596775, i(@r4[i]) = 0.000022058823529403225, i(@r5[i]) = -3.7794826370218095e-16, i(@f1[i]) = -1.9350975899792844e-13, i(@r6[i]) = -9.675487949896422e-14, i(@r7[i]) = -9.675487949896422e-14, i(@f2[i]) = -1.9350975899792844e-16
```

### C9s. ngspice's answers can be far from the exact ones: with a 1e−12 Ω wire in its middle branch, the balanced bridge's ends come out at 4.321 V and 4.374 V, where the circuit makes them 4.5 V

Added after the critic of the re-check's fixes (12 November 2026). The bridge of C9 with its middle branch made of a 1e−12 Ω wire Rw and a 1 kΩ R5: a, m and b are all at exactly 4.5 V, and no current flows in the middle branch. ngspice gives a = m = 4.320566 V and b = 4.374128 V, and R5 53.56 µA: the wire's conductance of 10¹² S beside the others' 10⁻⁴ S makes ngspice's equations ill-conditioned, and its LU factorisation in doubles keeps fewer than two correct digits of a, m and b. Its values still solve the equations to within its rounding (what they leave is a tiny share of the wire's 4.5e12 A terms), so the residual check alone passed them, and PlainSpice wrote R5 as 0 A between nodes it wrote as 4.321 V and 4.374 V, with a note that said both ends were at 4.5 V. Now PlainSpice also compares ngspice's answers with the exact ones: each node voltage and each V, E, H and L current whose exact value is not 0 must be within 5e−5 of it (less than half a unit in the last of the 4 digits the page shows), beyond what rounding leaves, 2⁻³⁰ of the largest value of its kind. Here they are 4 % off, so PlainSpice shows ngspice's numbers, decided by the rule for other circuits, with no rounding noise and no exact value mixed in, and a warning: "Some of ngspice's answers here are off. Solved exactly, with fractions, from the netlist's values, R5 carries no current, where ngspice gives 53.56 µA; R1 carries 450 µA, where ngspice gives 467.9 µA; node a is at 4.5 V, where ngspice gives 4.321 V; node m is at 4.5 V, where ngspice gives 4.321 V; and 5 more. ngspice computes with about 16 significant digits, and solving this circuit loses most of them. PlainSpice shows ngspice's numbers as it gives them, so they may not agree with each other." Read by a G of 1000 through a 1 nΩ wire, a bridge at 21.6 mV makes g6 16.61 V and G1 13.84 mA in ngspice where the circuit makes 0 V and 0 A: ngspice's a3 and b4 are 13.8 µV apart where the circuit makes them equal. PlainSpice shows those numbers too, as ngspice gives them, and the warning begins "node g6 is at 0 V, where ngspice gives 16.61 V". The same doubles in native 47, native 42 and our engine.

Added after the critic of round 2 of the re-check's fixes (13 November 2026). The answers were compared only where their exact value was at least 1e−3 of the largest of their kind, so a bridge at a few millivolts beside a 12 or 15 V source was never compared, however far off ngspice was there, and its exact 0s were called rounding noise beside ngspice's other numbers. C9s.3 is C9s.2 with R4 and R6 at 1.8 kΩ: a3 and b4 at 10 mV, where ngspice's are 1.75 µV apart, and g6 2.097 V, G1 and R9 1.747 mA, all exactly 0 in the circuit; the page called them rounding noise and drew 0s beside ngspice's a3 9.995 mV, which is 1.8e−4 of it off. C9s.4 puts the C9 bridge, with a 10 pΩ wire, behind a 1000:1 divider from 12 V and reads it with an E of 1000: ngspice gives a 4.882 mV (5.9 % from the exact 5.189 mV) and out −82.78 mV, which the page drew as 0 V beside E1 = 1000 × V(a, b) with a and b 83 µV apart. Both are now compared (2⁻³⁰ of 15 V or 12 V is about 1e−8 V, far below the 1.75 µV and 0.31 mV they are off), so PlainSpice shows ngspice's numbers with the warning. C9s.5 is C9s made unbalanced (R2 12 kΩ): a current flows through the wire and R5, 46.46 µA from m to b, but ngspice gives the wire exactly 0 A (a and m the same double) and R5 53.56 µA the other way; the page shows ngspice's numbers, and the warning names the currents of resistors that are off too: "R5 carries 46.46 µA, where ngspice gives 53.56 µA the other way; Rw carries 46.46 µA, where ngspice gives 0 A; …". The exact value of a current ngspice gives as 0 is not put in there (C9n.4's way): beside ngspice's other numbers, several per cent off, it pushed current into node m from both sides. The same doubles in native 47, native 42 and our engine.

```spice
* the balanced bridge of C9 with a 1e-12 ohm wire in its middle branch
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
Rw a m 1e-12
R5 m b 1k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        m                                4.320566e+00
        b                                4.374128e+00
        a                                4.320566e+00
        top                              9.000000e+00
        @r5[i]                           -5.35624e-05
        @rw[i]                           0.000000e+00
        @r4[i]                           9.306656e-04
        @r3[i]                           9.842280e-04
        @r2[i]                           4.320566e-04
        @r1[i]                           4.679434e-04
        v1#branch                        -1.45217e-03
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 4.32056594239515, v(b) = 4.374128347650329, v(m) = 4.32056594239515, i(v1) = -0.001452171416898713, i(@r1[i]) = 0.00046794340576048507, i(@r2[i]) = 0.000432056594239515, i(@r3[i]) = 0.000984228011138228, i(@r4[i]) = 0.0009306656058830487, i(@rw[i]) = 0, i(@r5[i]) = -0.00005356240525517908
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 4.32056594239515, v(b) = 4.374128347650329, v(m) = 4.32056594239515, i(v1) = -0.001452171416898713, i(@r1[i]) = 0.00046794340576048507, i(@r2[i]) = 0.000432056594239515, i(@r3[i]) = 0.000984228011138228, i(@r4[i]) = 0.0009306656058830487, i(@rw[i]) = 0, i(@r5[i]) = -0.00005356240525517908
```

```spice
* a balanced bridge with a 1 n wire, read by a G of 1000
V1 top1 0 15
R1 top1 s2 1u
R2 s2 0 1meg
R3 s2 a3 2.7meg
R4 a3 0 3.9k
R5 s2 b4 2.7meg
R6 b4 0 3.9k
R7 a3 m5 1n
R8 m5 b4 1meg
G1 0 g6 a3 b4 1e3
R9 g6 0 1.2k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        g6                               1.661193e+01
        m5                               2.164931e-02
        b4                               2.163547e-02
        a3                               2.164931e-02
        s2                               1.500000e+01
        top1                             1.500000e+01
        @r9[i]                           1.384328e-02
        @g1[i]                           1.384328e-02
        @r8[i]                           1.384328e-11
        @r7[i]                           -3.46945e-09
        @r6[i]                           5.547556e-06
        @r5[i]                           5.547542e-06
        @r4[i]                           5.551106e-06
        @r3[i]                           5.547537e-06
        @r2[i]                           1.500000e-05
        @r1[i]                           2.609468e-05
        v1#branch                        -2.60938e-05
  rawfile from ngspice -b -r (exit 0): v(top1) = 15, v(s2) = 14.999999999973905, v(a3) = 0.021649312700191603, v(b4) = 0.021635469421805404, v(m5) = 0.021649312700191607, v(g6) = 16.61193406343955, i(v1) = -0.000026093795895576477, i(@r1[i]) = 0.00002609468197078968, i(@r2[i]) = 0.000014999999999973905, i(@r3[i]) = 0.000005547537291582857, i(@r4[i]) = 0.000005551105820561949, i(@r5[i]) = 0.0000055475424187229995, i(@r6[i]) = 0.000005547556262001386, i(@r7[i]) = -3.4694469519536138e-9, i(@r8[i]) = 1.3843278386202472e-11, i(@g1[i]) = 0.013843278386199004, i(@r9[i]) = 0.013843278386199625
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top1) = 15, v(s2) = 14.999999999973905, v(a3) = 0.021649312700191603, v(b4) = 0.021635469421805404, v(m5) = 0.021649312700191607, v(g6) = 16.61193406343955, i(v1) = -0.000026093795895576477, i(@r1[i]) = 0.00002609468197078968, i(@r2[i]) = 0.000014999999999973905, i(@r3[i]) = 0.000005547537291582857, i(@r4[i]) = 0.000005551105820561949, i(@r5[i]) = 0.0000055475424187229995, i(@r6[i]) = 0.000005547556262001386, i(@r7[i]) = -3.4694469519536138e-9, i(@r8[i]) = 1.3843278386202472e-11, i(@g1[i]) = 0.013843278386199004, i(@r9[i]) = 0.013843278386199625
```

```spice
* C9s.2 with R4 and R6 at 1.8k: the bridge at 10 mV, read by a G of 1000 through a 1 n wire
V1 top1 0 15
R1 top1 s2 1u
R2 s2 0 1meg
R3 s2 a3 2.7meg
R4 a3 0 1.8k
R5 s2 b4 2.7meg
R6 b4 0 1.8k
R7 a3 m5 1n
R8 m5 b4 1meg
G1 0 g6 a3 b4 1e3
R9 g6 0 1.2k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        g6                               2.096858e+00
        m5                               9.995088e-03
        b4                               9.993341e-03
        a3                               9.995088e-03
        s2                               1.500000e+01
        top1                             1.500000e+01
        @r9[i]                           1.747382e-03
        @g1[i]                           1.747382e-03
        @r8[i]                           1.747382e-12
        @r7[i]                           0.000000e+00
        @r6[i]                           5.551856e-06
        @r5[i]                           5.551854e-06
        @r4[i]                           5.552827e-06
        @r3[i]                           5.551854e-06
        @r2[i]                           1.500000e-05
        @r1[i]                           2.610356e-05
        v1#branch                        -2.61031e-05
  rawfile from ngspice -b -r (exit 0): v(top1) = 15, v(s2) = 14.999999999973896, v(a3) = 0.009995088299682636, v(b4) = 0.009993340917990978, v(m5) = 0.009995088299682636, v(g6) = 2.0968580299886526, i(v1) = -0.000026103109121322632, i(@r1[i]) = 0.00002610356375498668, i(@r2[i]) = 0.000014999999999973897, i(@r3[i]) = 0.000005551853670990449, i(@r4[i]) = 0.000005552826833157019, i(@r5[i]) = 0.000005551854318168854, i(@r6[i]) = 0.000005551856065550544, i(@r7[i]) = 0, i(@r8[i]) = 1.747381691657307e-12, i(@g1[i]) = 0.001747381691657307, i(@r9[i]) = 0.0017473816916572106
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top1) = 15, v(s2) = 14.999999999973896, v(a3) = 0.009995088299682636, v(b4) = 0.009993340917990978, v(m5) = 0.009995088299682636, v(g6) = 2.0968580299886526, i(v1) = -0.000026103109121322632, i(@r1[i]) = 0.00002610356375498668, i(@r2[i]) = 0.000014999999999973897, i(@r3[i]) = 0.000005551853670990449, i(@r4[i]) = 0.000005552826833157019, i(@r5[i]) = 0.000005551854318168854, i(@r6[i]) = 0.000005551856065550544, i(@r7[i]) = 0, i(@r8[i]) = 1.747381691657307e-12, i(@g1[i]) = 0.001747381691657307, i(@r9[i]) = 0.0017473816916572106
```

```spice
* a 12 V supply, a 1000:1 divider, the C9 bridge with a 10 p wire, and an E of gain 1000
V1 top 0 12
Rd1 top s 999k
Rd2 s 0 1k
R1 s a 10k
R2 a 0 10k
R3 s b 4.7k
R4 b 0 4.7k
Rw a m 10p
R5 m b 1k
E1 out 0 a b 1000
Rl out 0 10k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out                              -8.27765e-02
        m                                4.882133e-03
        b                                4.964910e-03
        a                                4.882133e-03
        s                                1.031887e-02
        top                              1.200000e+01
        @rl[i]                           -8.27765e-06
        @r5[i]                           -8.27765e-08
        @rw[i]                           -8.67362e-08
        @r4[i]                           1.056364e-06
        @r3[i]                           1.139140e-06
        @r2[i]                           4.882133e-07
        @r1[i]                           5.436736e-07
        @rd2[i]                          1.031887e-05
        @rd1[i]                          1.200168e-05
        v1#branch                        -1.20017e-05
        e1#branch                        8.277650e-06
  rawfile from ngspice -b -r (exit 0): v(top) = 12, v(s) = 0.010318868972790083, v(a) = 0.004882133225318444, v(b) = 0.0049649097211622055, v(m) = 0.004882133225318445, v(out) = -0.08277649584376157, i(e1) = 0.000008277649584376158, i(v1) = -0.00001200168281384105, i(@rd1[i]) = 0.00001200168281384105, i(@rd2[i]) = 0.000010318868972790084, i(@r1[i]) = 5.436735747471639e-7, i(@r2[i]) = 4.882133225318445e-7, i(@r3[i]) = 0.0000011391402663038038, i(@r4[i]) = 0.0000010563637704600437, i(@rw[i]) = -8.673617379884035e-8, i(@r5[i]) = -8.27764958437607e-8, i(@rl[i]) = -0.000008277649584376158
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 12, v(s) = 0.010318868972790083, v(a) = 0.004882133225318444, v(b) = 0.0049649097211622055, v(m) = 0.004882133225318445, v(out) = -0.08277649584376157, i(e1) = 0.000008277649584376158, i(v1) = -0.00001200168281384105, i(@rd1[i]) = 0.00001200168281384105, i(@rd2[i]) = 0.000010318868972790084, i(@r1[i]) = 5.436735747471639e-7, i(@r2[i]) = 4.882133225318445e-7, i(@r3[i]) = 0.0000011391402663038038, i(@r4[i]) = 0.0000010563637704600437, i(@rw[i]) = -8.673617379884035e-8, i(@r5[i]) = -8.27764958437607e-8, i(@rl[i]) = -0.000008277649584376158
```

```spice
* the bridge of C9s made unbalanced (R2 12k): a real current through the 1e-12 ohm wire and R5
V1 top 0 9
R1 top a 10k
R2 a 0 12k
R3 top b 4.7k
R4 b 0 4.7k
Rw a m 1e-12
R5 m b 1k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        m                                4.320566e+00
        b                                4.374128e+00
        a                                4.320566e+00
        top                              9.000000e+00
        @r5[i]                           -5.35624e-05
        @rw[i]                           0.000000e+00
        @r4[i]                           9.306656e-04
        @r3[i]                           9.842280e-04
        @r2[i]                           3.600472e-04
        @r1[i]                           4.679434e-04
        v1#branch                        -1.45217e-03
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 4.32056594239515, v(b) = 4.374128347650329, v(m) = 4.32056594239515, i(v1) = -0.001452171416898713, i(@r1[i]) = 0.00046794340576048507, i(@r2[i]) = 0.0003600471618662625, i(@r3[i]) = 0.000984228011138228, i(@r4[i]) = 0.0009306656058830487, i(@rw[i]) = 0, i(@r5[i]) = -0.00005356240525517908
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 4.32056594239515, v(b) = 4.374128347650329, v(m) = 4.32056594239515, i(v1) = -0.001452171416898713, i(@r1[i]) = 0.00046794340576048507, i(@r2[i]) = 0.0003600471618662625, i(@r3[i]) = 0.000984228011138228, i(@r4[i]) = 0.0009306656058830487, i(@rw[i]) = 0, i(@r5[i]) = -0.00005356240525517908
```

### C9t. With a diode, a value that is 0 whatever current the diode carries is exactly 0: the E reading the balanced bridge, fed 5 mA, carries it at exactly 0 V beside a diode

Added after the critic of round 2 of the re-check's fixes (13 November 2026). A diode's current depends on its model, so PlainSpice cannot work it out exactly. But a diode is a part with two ends whose current, whatever it is, flows in at one end and out at the other (its series resistance, gmin and junction are inside it, C9t.4), and the rest of the circuit is as exact as without it. So PlainSpice solves the circuit with each diode's current left free: the operating point with every diode at 0 A, and the change a unit current through each diode makes (one diode for each branch of a forest of the diodes' graph: diodes side by side reach the rest of the circuit as one current). A value that is 0 in each of these solutions is 0 whatever current the diodes carry: exactly 0. The operating point itself takes each diode's current from Kirchhoff's law with ngspice's other values, and is checked against ngspice's values as one without diodes is. Here a diode is across V1: E1's control, a and b, is exactly 0 in every solution, so node out is exactly 0 V, and E1 carries the real 5 mA that V2 drives through Rx, at 0 V, with no power; ngspice gives out −931.3 pV. A diode's own current is not a value PlainSpice shows. A node whose only DC path goes through diodes makes these equations singular, and the circuit is left to the rule for other circuits; so is a circuit with more than 16 diodes. The same doubles in native 47, native 42 and our engine.

```spice
* the C9 bridge read by an E of 1e6, fed 5 mA through 1k from 5 V, with a diode across V1
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
E1 out 0 a b 1e6
V2 x 0 5
Rx x out 1k
D1 0 top dmod
.model dmod d
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        x                                5.000000e+00
        out                              -9.31323e-10
        b                                4.500000e+00
        a                                4.500000e+00
        top                              9.000000e+00
        @d1[id]                          -9.01000e-12
        @rx[i]                           5.000000e-03
        @r5[i]                           -8.88178e-19
        @r4[i]                           9.574468e-04
        @r3[i]                           9.574468e-04
        @r2[i]                           4.500000e-04
        @r1[i]                           4.500000e-04
        v1#branch                        -1.40745e-03
        v2#branch                        -5.00000e-03
        e1#branch                        5.000000e-03
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, v(out) = -9.313225746154785e-10, v(x) = 5, i(e1) = 0.005000000000931323, i(v2) = -0.005000000000931323, i(v1) = -0.0014074468175206383, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19, i(@rx[i]) = 0.005000000000931323, i(@d1[id]) = -9.00999999968093e-12
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, v(out) = -9.313225746154785e-10, v(x) = 5, i(e1) = 0.005000000000931323, i(v2) = -0.005000000000931323, i(v1) = -0.0014074468175206383, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19, i(@rx[i]) = 0.005000000000931323, i(@d1[id]) = -9.00999999968093e-12
```

A diode with exactly 0 V across it carries no current: 0 V across its junction makes 0 A, and its series resistance then drops nothing (C9t.2). G1 reads the balanced bridge, so with every diode at 0 A, out and x are exactly 0 V and D1 has 0 V across it; no other diode changes that voltage, so D1 carries 0 A, and R6, R7, G1, out and x are exactly 0. ngspice leaves out at −8.9e−16 V, x at −1.2e−24 V and D1 at −1.23e−27 A. With D1's current left free, R6, R7 and x would be real in its unit solution, and PlainSpice would draw ngspice's noise as currents. Where another diode's current changes such a diode's voltage, it is not taken as 0: a balanced bridge with a diode in its middle branch and a second diode feeding node a through 1 MΩ carries a real 31.37 fA through R5, shown as ngspice gives it.

```spice
* a G reading the balanced bridge of C9 drives 1k, with a diode and 1k beside it
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
G1 0 out a b 1m
R6 out 0 1k
D1 out x dmod
R7 x 0 1k
.model dmod d
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        x                                -1.23141e-24
        out                              -8.88178e-16
        b                                4.500000e+00
        a                                4.500000e+00
        top                              9.000000e+00
        @r7[i]                           -1.23141e-27
        @d1[id]                          -1.23124e-27
        @r6[i]                           -8.88178e-19
        @g1[i]                           -8.88178e-19
        @r5[i]                           -8.88178e-19
        @r4[i]                           9.574468e-04
        @r3[i]                           9.574468e-04
        @r2[i]                           4.500000e-04
        @r1[i]                           4.500000e-04
        v1#branch                        -1.40745e-03
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 4.5, v(b) = 4.500000000000001, v(out) = -8.881784197001252e-16, v(x) = -1.231405126604393e-24, i(v1) = -0.0014074468085106383, i(@r1[i]) = 0.00045000000000000004, i(@r2[i]) = 0.00045000000000000004, i(@r3[i]) = 0.0009574468085106381, i(@r4[i]) = 0.0009574468085106385, i(@r5[i]) = -8.881784197001253e-19, i(@g1[i]) = -8.881784197001253e-19, i(@r6[i]) = -8.881784197001253e-19, i(@d1[id]) = -1.2312373330778934e-27, i(@r7[i]) = -1.231405126604393e-27
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 4.5, v(b) = 4.500000000000001, v(out) = -8.881784197001252e-16, v(x) = -1.231405126604393e-24, i(v1) = -0.0014074468085106383, i(@r1[i]) = 0.00045000000000000004, i(@r2[i]) = 0.00045000000000000004, i(@r3[i]) = 0.0009574468085106381, i(@r4[i]) = 0.0009574468085106385, i(@r5[i]) = -8.881784197001253e-19, i(@g1[i]) = -8.881784197001253e-19, i(@r6[i]) = -8.881784197001253e-19, i(@d1[id]) = -1.2312373330778934e-27, i(@r7[i]) = -1.231405126604393e-27
```

A real value next to a diode is shown as ngspice gives it (C9t.3, the critic's s2-527 without its ladder): the bridge of R1 to R4 is 1e−13 off balance (R4 is 110000.000000011 Ω), and the H of 1 MΩ makes h5 a real −425.9 fV, which ngspice gives as −433.7 fV, within what its rounding leaves beside 12 V. Decided by the rule for other circuits, as circuits with a diode were until now, the critic's s2-527 read "h5 0 V" and "V2 measures no current". Since the last pass (C9w.4) a floor no longer excuses a value drawn with other digits: h5 keeps ngspice's −433.7 fV, now with the warning, which names its exact −425.9 fV.

```spice
* a bridge 1e-13 off balance read by an H of 1 meg, with a diode beside it
V1 top1 0 12
R1 top1 a2 56
R2 a2 0 22000
R3 top1 b3 280
R4 b3 0 110000.000000011
R5 a2 m4 6.8k
V2 m4 b3 0
H1 h5 0 V2 1meg
R6 h5 0 47
D1 top1 d7 dmod
R8 d7 top1 10
R9 d7 l9 330
R10 l9 0 120k
.model dmod D(is=1e-14)
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        l9                               1.196610e+01
        d7                               1.199900e+01
        h5                               -4.33681e-13
        m4                               1.196953e+01
        b3                               1.196953e+01
        a2                               1.196953e+01
        top1                             1.200000e+01
        @r10[i]                          9.971747e-05
        @r9[i]                           9.971747e-05
        @r8[i]                           -9.97175e-05
        @d1[id]                          1.390235e-15
        @r6[i]                           -9.22725e-15
        @r5[i]                           -2.61229e-19
        @r4[i]                           1.088139e-04
        @r3[i]                           1.088139e-04
        @r2[i]                           5.440696e-04
        @r1[i]                           5.440696e-04
        v1#branch                        -7.52601e-04
        v2#branch                        -4.33681e-19
        h1#branch                        9.227253e-15
  rawfile from ngspice -b -r (exit 0): v(top1) = 12, v(a2) = 11.969532100108815, v(b3) = 11.969532100108818, v(m4) = 11.969532100108816, v(h5) = -4.3368086899420177e-13, v(d7) = 11.999002825328251, v(l9) = 11.966096061160062, i(h1) = 9.227252531791527e-15, i(v2) = -4.336808689942018e-19, i(v1) = -0.0007526010362732122, i(@r1[i]) = 0.0005440696409140244, i(@r2[i]) = 0.000544069640914037, i(@r3[i]) = 0.0001088139281827922, i(@r4[i]) = 0.00010881392818279655, i(@r5[i]) = -2.6122894697062505e-19, i(@r6[i]) = -9.227252531791527e-15, i(@d1[id]) = 1.3902345916013558e-15, i(@r8[i]) = -0.00009971746717489794, i(@r9[i]) = 0.00009971746717632979, i(@r10[i]) = 0.00009971746717633385
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top1) = 12, v(a2) = 11.969532100108815, v(b3) = 11.969532100108818, v(m4) = 11.969532100108816, v(h5) = -4.3368086899420177e-13, v(d7) = 11.999002825328251, v(l9) = 11.966096061160062, i(h1) = 9.227252531791527e-15, i(v2) = -4.336808689942018e-19, i(v1) = -0.0007526010362732122, i(@r1[i]) = 0.0005440696409140244, i(@r2[i]) = 0.000544069640914037, i(@r3[i]) = 0.0001088139281827922, i(@r4[i]) = 0.00010881392818279655, i(@r5[i]) = -2.6122894697062505e-19, i(@r6[i]) = -9.227252531791527e-15, i(@d1[id]) = 1.3902345916013558e-15, i(@r8[i]) = -0.00009971746717489794, i(@r9[i]) = 0.00009971746717632979, i(@r10[i]) = 0.00009971746717633385
```

ngspice gives a diode's current, @d1[id], as its last iteration's (C9t.4): with a 10 Ω series resistance, 4.265322 mA, where R1 brings 4.264717 mA into node 2, the diode's only other part: 1.4e−4 off. So PlainSpice never uses @d1[id]; it takes each diode's current from Kirchhoff's law with ngspice's other values.

```spice
* a diode with a 10 ohm series resistance, fed through 1k from 5 V
V1 1 0 5
R1 1 2 1k
D1 2 0 dmod
.model dmod D(is=1e-14 rs=10)
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        V(2)                             7.352826e-01
        V(1)                             5.000000e+00
        @d1[id]                          4.265322e-03
        @r1[i]                           4.264717e-03
        v1#branch                        -4.26472e-03
  rawfile from ngspice -b -r (exit 0): v(1) = 5, v(2) = 0.7352825914137034, i(v1) = -0.004264717408586296, i(@r1[i]) = 0.004264717408586296, i(@d1[id]) = 0.004265322389487809
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(1) = 5, v(2) = 0.7352825914137034, i(v1) = -0.004264717408586296, i(@r1[i]) = 0.004264717408586296, i(@d1[id]) = 0.004265322389487809
```

Added after the critic of round 2 of the re-check's fixes (13 November 2026), with its second fix (C9t.5): the H of 1 GΩ of C9o.4, with a diode across V1, with .op and ".dc V1 0 9 3", whose last point is the .op's 9 V. The .op showed out 0 V and Rl 0 A (C9o.4), while the sweep of a circuit with a diode was left as ngspice gives it, and its words said v(out) = −193.5 nV and i(@rl[i]) = −193.5 pA at V1 = 9 V, beside the .op's 0 V at the same point. A sweep is now decided as the operating point is, with each diode's current left free at each point: out, H1, Vm, R5 and Rl are 0 at every point, whatever current D1 carries, so PlainSpice shows 0 there in the sweep's words and in the Plot panel, with a note that gives ngspice's numbers. D1's own −9.01 pA at 9 V is real (V1 holds it reverse-biased) and stays. With no .print line, ngspice −b runs no .dc, so the printout shows the .op. The same doubles in native 47, native 42 and our engine.

```spice
* the H of 1 G reading a balanced bridge's ammeter, with a diode across V1, with .op and .dc V1 0 9 3
V1 top 0 9
R1 top a 180k
R2 a 0 3.9meg
R3 top b 18k
R4 b 0 390k
R5 a m 4.7
Vm m b 0
H1 out 0 Vm 1g
Rl out 0 1k
D1 0 top dmod
.model dmod d
.options savecurrents
.op
.dc V1 0 9 3
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out                              -1.93510e-07
        m                                8.602941e+00
        b                                8.602941e+00
        a                                8.602941e+00
        top                              9.000000e+00
        @d1[id]                          -9.01000e-12
        @rl[i]                           -1.93510e-10
        @r5[i]                           -3.77948e-16
        @r4[i]                           2.205882e-05
        @r3[i]                           2.205882e-05
        @r2[i]                           2.205882e-06
        @r1[i]                           2.205882e-06
        v1#branch                        -2.42647e-05
        vm#branch                        -1.93510e-16
        h1#branch                        1.935098e-10
  rawfile from ngspice -b -r (exit 0): v(v-sweep) = [0, 3, 6, 9], v(top) = [0, 3, 6, 9], v(a) = [0, 2.8676470588224197, 5.735294117644839, 8.602941176467256], v(b) = [0, 2.8676470588224197, 5.735294117644839, 8.602941176467258], v(m) = [0, 2.8676470588224197, 5.735294117644839, 8.602941176467258], v(out) = [0, -6.450325299930948e-8, -1.2900650599861896e-7, -1.9350975899792844e-7], i(h1) = [0, 6.450325299930948e-11, 1.2900650599861896e-10, 1.9350975899792844e-10], i(vm) = [0, -6.450325299930948e-17, -1.2900650599861896e-16, -1.9350975899792844e-16], i(v1) = [0, -0.000008088238304186694, -0.000016176476598370973, -0.00002426471489255658], i(@r1[i]) = [0, 7.352941176532241e-7, 0.0000014705882353064482, 0.0000022058823529596873], i(@r2[i]) = [0, 7.352941176467743e-7, 0.0000014705882352935485, 0.000002205882352940322], i(@r3[i]) = [0, 0.0000073529411765322414, 0.000014705882353064483, 0.000022058823529596775], i(@r4[i]) = [0, 0.000007352941176467742, 0.000014705882352935485, 0.000022058823529403225], i(@r5[i]) = [0, 0, 0, -3.7794826370218095e-16], i(@rl[i]) = [0, -6.450325299930948e-11, -1.2900650599861896e-10, -1.9350975899792844e-10], i(@d1[id]) = [0, -3.0099999913851085e-12, -6.009999998923139e-12, -9.00999999968093e-12]; v(top) = 9, v(a) = 8.602941176467256, v(b) = 8.602941176467258, v(m) = 8.602941176467258, v(out) = -1.9350975899792844e-7, i(h1) = 1.9350975899792844e-10, i(vm) = -1.9350975899792844e-16, i(v1) = -0.00002426471489255658, i(@r1[i]) = 0.0000022058823529596873, i(@r2[i]) = 0.000002205882352940322, i(@r3[i]) = 0.000022058823529596775, i(@r4[i]) = 0.000022058823529403225, i(@r5[i]) = -3.7794826370218095e-16, i(@rl[i]) = -1.9350975899792844e-10, i(@d1[id]) = -9.00999999968093e-12
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(v-sweep) = [0, 3, 6, 9], v(top) = [0, 3, 6, 9], v(a) = [0, 2.8676470588224197, 5.735294117644839, 8.602941176467256], v(b) = [0, 2.8676470588224197, 5.735294117644839, 8.602941176467258], v(m) = [0, 2.8676470588224197, 5.735294117644839, 8.602941176467258], v(out) = [0, -6.450325299930948e-8, -1.2900650599861896e-7, -1.9350975899792844e-7], i(h1) = [0, 6.450325299930948e-11, 1.2900650599861896e-10, 1.9350975899792844e-10], i(vm) = [0, -6.450325299930948e-17, -1.2900650599861896e-16, -1.9350975899792844e-16], i(v1) = [0, -0.000008088238304186694, -0.000016176476598370973, -0.00002426471489255658], i(@r1[i]) = [0, 7.352941176532241e-7, 0.0000014705882353064482, 0.0000022058823529596873], i(@r2[i]) = [0, 7.352941176467743e-7, 0.0000014705882352935485, 0.000002205882352940322], i(@r3[i]) = [0, 0.0000073529411765322414, 0.000014705882353064483, 0.000022058823529596775], i(@r4[i]) = [0, 0.000007352941176467742, 0.000014705882352935485, 0.000022058823529403225], i(@r5[i]) = [0, 0, 0, -3.7794826370218095e-16], i(@rl[i]) = [0, -6.450325299930948e-11, -1.2900650599861896e-10, -1.9350975899792844e-10], i(@d1[id]) = [0, -3.0099999913851085e-12, -6.009999998923139e-12, -9.00999999968093e-12]; v(top) = 9, v(a) = 8.602941176467256, v(b) = 8.602941176467258, v(m) = 8.602941176467258, v(out) = -1.9350975899792844e-7, i(h1) = 1.9350975899792844e-10, i(vm) = -1.9350975899792844e-16, i(v1) = -0.00002426471489255658, i(@r1[i]) = 0.0000022058823529596873, i(@r2[i]) = 0.000002205882352940322, i(@r3[i]) = 0.000022058823529596775, i(@r4[i]) = 0.000022058823529403225, i(@r5[i]) = -3.7794826370218095e-16, i(@rl[i]) = -1.9350975899792844e-10, i(@d1[id]) = -9.00999999968093e-12
```

Added after the critic of round 2 of the re-check's fixes (13 November 2026), with its second fix (C9t.6): a G reads the balanced bridge of C9 into R6 and R7, and a diode joins x to y, which V2 sets; ".dc V2 0 2 1" sweeps V2 from its own 0 V, the .op's. With every diode at 0 A, D1 has V2 across it, so it has exactly 0 V across it only at V2 = 0: there it carries 0 A, and out, x, R6, R7, V2's current and D1's own are exactly 0, as the .op says. At 1 and 2 V, D1 lets a current through, which R7 carries (ngspice gives 1.387 pA and 2.01 pA) with x at 1.387 nV and 2.01 nV: real values, shown as ngspice gives them. PlainSpice works out which diodes are free at each point: at the point where a diode has 0 V across it whatever the others carry, it carries 0 A there only. R6 is in series with G1, which reads 0 V at every point: 0 at every point. The same doubles in native 47, native 42 and our engine.

```spice
* a G reading the balanced bridge of C9 drives R6 and R7, with a diode from x to y, which V2 sets, swept
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
G1 0 out a b 1m
R6 out x 1k
R7 x 0 1k
D1 x y dmod
V2 y 0 0
.model dmod d
.options savecurrents
.op
.dc V2 0 2 1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        y                                0.000000e+00
        x                                -8.88178e-16
        out                              -1.77636e-15
        b                                4.500000e+00
        a                                4.500000e+00
        top                              9.000000e+00
        @d1[id]                          -1.23124e-27
        @r7[i]                           -8.88178e-19
        @r6[i]                           -8.88178e-19
        @g1[i]                           -8.88178e-19
        @r5[i]                           -8.88178e-19
        @r4[i]                           9.574468e-04
        @r3[i]                           9.574468e-04
        @r2[i]                           4.500000e-04
        @r1[i]                           4.500000e-04
        v1#branch                        -1.40745e-03
        v2#branch                        -1.23059e-27
  rawfile from ngspice -b -r (exit 0): v(v-sweep) = [0, 1, 2], v(top) = [9, 9, 9], v(a) = [4.5, 4.5, 4.5], v(b) = [4.500000000000001, 4.500000000000001, 4.500000000000001], v(out) = [-1.7763568394002505e-15, 1.3866223724789961e-9, 2.0099975017728866e-9], v(x) = [-8.881784190848286e-16, 1.38662323026232e-9, 2.009998735343814e-9], v(y) = [0, 1, 2], i(v2) = [-1.2305932679744663e-27, -1.3866240880456443e-12, -2.0099999689147417e-12], i(v1) = [-0.0014074468085106383, -0.0014074468085106383, -0.0014074468085106383], i(@r1[i]) = [0.00045000000000000004, 0.00045000000000000004, 0.00045000000000000004], i(@r2[i]) = [0.00045000000000000004, 0.00045000000000000004, 0.00045000000000000004], i(@r3[i]) = [0.0009574468085106381, 0.0009574468085106381, 0.0009574468085106381], i(@r4[i]) = [0.0009574468085106385, 0.0009574468085106385, 0.0009574468085106385], i(@r5[i]) = [-8.881784197001253e-19, -8.881784197001253e-19, -8.881784197001253e-19], i(@g1[i]) = [-8.881784197001253e-19, -8.881784197001253e-19, -8.881784197001253e-19], i(@r6[i]) = [-8.881784203154217e-19, -8.577833239847295e-19, -1.2335709274332335e-18], i(@r7[i]) = [-8.881784190848286e-19, 1.3866232302623201e-12, 2.009998735343814e-12], i(@d1[id]) = [-1.231237333694002e-27, -1.0099997660113e-12, -2.0099999689147417e-12]; v(top) = 9, v(a) = 4.5, v(b) = 4.500000000000001, v(out) = -1.7763568394002505e-15, v(x) = -8.881784190848286e-16, v(y) = 0, i(v2) = -1.2305932679744663e-27, i(v1) = -0.0014074468085106383, i(@r1[i]) = 0.00045000000000000004, i(@r2[i]) = 0.00045000000000000004, i(@r3[i]) = 0.0009574468085106381, i(@r4[i]) = 0.0009574468085106385, i(@r5[i]) = -8.881784197001253e-19, i(@g1[i]) = -8.881784197001253e-19, i(@r6[i]) = -8.881784203154217e-19, i(@r7[i]) = -8.881784190848286e-19, i(@d1[id]) = -1.231237333694002e-27
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(v-sweep) = [0, 1, 2], v(top) = [9, 9, 9], v(a) = [4.5, 4.5, 4.5], v(b) = [4.500000000000001, 4.500000000000001, 4.500000000000001], v(out) = [-1.7763568394002505e-15, 1.3866223724789961e-9, 2.0099975017728866e-9], v(x) = [-8.881784190848286e-16, 1.38662323026232e-9, 2.009998735343814e-9], v(y) = [0, 1, 2], i(v2) = [-1.2305932679744663e-27, -1.3866240880456443e-12, -2.0099999689147417e-12], i(v1) = [-0.0014074468085106383, -0.0014074468085106383, -0.0014074468085106383], i(@r1[i]) = [0.00045000000000000004, 0.00045000000000000004, 0.00045000000000000004], i(@r2[i]) = [0.00045000000000000004, 0.00045000000000000004, 0.00045000000000000004], i(@r3[i]) = [0.0009574468085106381, 0.0009574468085106381, 0.0009574468085106381], i(@r4[i]) = [0.0009574468085106385, 0.0009574468085106385, 0.0009574468085106385], i(@r5[i]) = [-8.881784197001253e-19, -8.881784197001253e-19, -8.881784197001253e-19], i(@g1[i]) = [-8.881784197001253e-19, -8.881784197001253e-19, -8.881784197001253e-19], i(@r6[i]) = [-8.881784203154217e-19, -8.577833239847295e-19, -1.2335709274332335e-18], i(@r7[i]) = [-8.881784190848286e-19, 1.3866232302623201e-12, 2.009998735343814e-12], i(@d1[id]) = [-1.231237333694002e-27, -1.0099997660113e-12, -2.0099999689147417e-12]; v(top) = 9, v(a) = 4.5, v(b) = 4.500000000000001, v(out) = -1.7763568394002505e-15, v(x) = -8.881784190848286e-16, v(y) = 0, i(v2) = -1.2305932679744663e-27, i(v1) = -0.0014074468085106383, i(@r1[i]) = 0.00045000000000000004, i(@r2[i]) = 0.00045000000000000004, i(@r3[i]) = 0.0009574468085106381, i(@r4[i]) = 0.0009574468085106385, i(@r5[i]) = -8.881784197001253e-19, i(@g1[i]) = -8.881784197001253e-19, i(@r6[i]) = -8.881784203154217e-19, i(@r7[i]) = -8.881784190848286e-19, i(@d1[id]) = -1.231237333694002e-27
```

Added after the critic of round 2 of the re-check's fixes (13 November 2026), with its second fix (C9t.7): the 1 nΩ wire of C9n.4 with a diode from d2 to ground. PlainSpice takes a diode's current from Kirchhoff's law with ngspice's other values, at a node of the diode's (C9t.4). At d2 that law has R3's current, worked out from its two ends, which ngspice gives a step apart: one step of a double at 4.5 mV over 1 nΩ is 8.7e−10 A, so the diode's current came out as 4.1e−10 A where it carries 6.5e−15 A, and the values worked out with it were 1e−4 off: a warning said "node d2 is at 4.542 mV, where ngspice gives 4.541 mV", though the circuit puts d2 at 4.541 mV, as ngspice gives it. Ground's law has only V1's, R2's and R4's currents, each at most a step of a double off. PlainSpice now takes each diode's current at the node whose law ngspice's rounding leaves nearest 0, by an estimate (a resistor's current can be off by a step of each end's voltage over its resistance), here ground. The circuit was then decided exactly, with no warning: R3 kept ngspice's 867.4 pA (its two ends a step apart over 1 nΩ; the circuit makes it 454.1 pA), and R4 its 454.1 pA. Since the last pass (C9w.4) no floor excuses R3's other digits: the run is shown as ngspice gives it with the warning "R3 carries 454.1 pA, where ngspice gives 867.4 pA", which says nothing of d2. The same doubles in native 47, native 42 and our engine.

```spice
* the 1 n wire of C9n.4 in series with 10 meg, from a 1.5 V divider, with a diode from the divider to ground
V1 top1 0 1.5
R1 top1 d2 270k
R2 d2 0 820
R3 d2 p3 1n
R4 p3 0 10meg
D1 d2 0 dmod
.model dmod d
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        p3                               4.541354e-03
        d2                               4.541354e-03
        top1                             1.500000e+00
        @d1[id]                          6.460724e-15
        @r4[i]                           4.541354e-10
        @r3[i]                           8.673617e-10
        @r2[i]                           5.538237e-06
        @r1[i]                           5.538736e-06
        v1#branch                        -5.53874e-06
  rawfile from ngspice -b -r (exit 0): v(top1) = 1.5, v(d2) = 0.004541354295384195, v(p3) = 0.004541354295384194, i(v1) = -0.0000055387357248319104, i(@r1[i]) = 0.0000055387357248319104, i(@r2[i]) = 0.000005538236945590481, i(@r3[i]) = 8.673617379884034e-10, i(@r4[i]) = 4.5413542953841937e-10, i(@d1[id]) = 6.460724084056888e-15
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top1) = 1.5, v(d2) = 0.004541354295384195, v(p3) = 0.004541354295384194, i(v1) = -0.0000055387357248319104, i(@r1[i]) = 0.0000055387357248319104, i(@r2[i]) = 0.000005538236945590481, i(@r3[i]) = 8.673617379884034e-10, i(@r4[i]) = 4.5413542953841937e-10, i(@d1[id]) = 6.460724084056888e-15
```

Added after the critic of round 2 of the re-check's fixes (13 November 2026), with its second fix (C9t.8): the bridge of C9s with its 1e−12 Ω wire, fed through 100 Ω, with a diode from top to ground. ngspice's answers are off: it gives Rw 55.51 µA and R5 2.404 µA, where the circuit makes both 0 for any current the diode carries (the bridge is balanced), so the page shows ngspice's numbers, decided by the rule, with a warning. Every other value here depends on the diode's current (node a is half of top), and that current only ngspice's numbers give, so their exact values are not known: the warning names only values that no diode's current changes, "Rw carries no current, where ngspice gives 55.51 µA; and R5 carries no current, where ngspice gives 2.404 µA", and none at all when every value that is off depends on a diode's current. The same doubles in native 47, native 42 and our engine.

```spice
* the bridge with a 1e-12 ohm wire (C9s), fed through 100 ohms, with a diode from top to ground
V1 in 0 9
R0 in top 100
D1 top 0 dmod
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
Rw a m 1e-12
R5 m b 1k
.model dmod d
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        m                                3.926330e-01
        b                                3.902287e-01
        a                                3.926330e-01
        top                              7.691572e-01
        in                               9.000000e+00
        @r5[i]                           2.404280e-06
        @rw[i]                           -5.55112e-05
        @r4[i]                           8.302738e-05
        @r3[i]                           8.062310e-05
        @r2[i]                           3.926330e-05
        @r1[i]                           3.765243e-05
        @d1[id]                          8.219018e-02
        @r0[i]                           8.230843e-02
        v1#branch                        -8.23084e-02
  rawfile from ngspice -b -r (exit 0): v(in) = 9, v(top) = 0.7691572401059934, v(a) = 0.3926329591523753, v(b) = 0.39022867882420265, v(m) = 0.39263295915237534, i(v1) = -0.08230842759894007, i(@r0[i]) = 0.08230842759894007, i(@d1[id]) = 0.08219017562144401, i(@r1[i]) = 0.00003765242809536181, i(@r2[i]) = 0.00003926329591523753, i(@r3[i]) = 0.00008062309814506186, i(@r4[i]) = 0.00008302737847323461, i(@rw[i]) = -0.00005551115123125783, i(@r5[i]) = 0.000002404280328172692
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(in) = 9, v(top) = 0.7691572401059934, v(a) = 0.3926329591523753, v(b) = 0.39022867882420265, v(m) = 0.39263295915237534, i(v1) = -0.08230842759894007, i(@r0[i]) = 0.08230842759894007, i(@d1[id]) = 0.08219017562144401, i(@r1[i]) = 0.00003765242809536181, i(@r2[i]) = 0.00003926329591523753, i(@r3[i]) = 0.00008062309814506186, i(@r4[i]) = 0.00008302737847323461, i(@rw[i]) = -0.00005551115123125783, i(@r5[i]) = 0.000002404280328172692
```

Added after the critic of round 2 of the re-check's fixes (13 November 2026), with its second fix (C9t.9): two equal diode arms with 1 kΩ between them, swept from 0 V by ".dc V1 0 9 3". At V1 = 0 the circuit makes every value 0, and each diode, with 0 V across it, carries 0 A; ngspice's Newton iterations leave v(a) and v(b) at −7.4e−25 V, R5 at −3.6e−37 A and each diode at 7.4e−37 A there. No equation weighs these against anything larger, so at such a point PlainSpice holds each of ngspice's values to 2⁻³⁰ of the largest it gives of that kind over the sweep (9 V; 1.669 mA), the share of rounding the answers check allows, and shows them as 0. R5 is 0 only when the two diodes carry the same current; they are placed alike (C9u.3), so they do, and R5 is 0 at every point, ngspice's 4.441e−19 A at 3 V too (until the critic of round 3 it kept that number, as a value a diode's current changes). The same doubles in native 47, native 42 and our engine.

```spice
* two equal diode arms with 1k between them, swept from 0 V: .op and .dc V1 0 9 3
V1 top 0 9
D1 top a dmod
R2 a 0 10k
D2 top b dmod
R4 b 0 10k
R5 a b 1k
.model dmod d
.options savecurrents
.op
.dc V1 0 9 3
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                8.349366e+00
        a                                8.349366e+00
        top                              9.000000e+00
        @r5[i]                           0.000000e+00
        @r4[i]                           8.349366e-04
        @d2[id]                          8.408256e-04
        @r2[i]                           8.349366e-04
        @d1[id]                          8.408256e-04
        v1#branch                        -1.66987e-03
  rawfile from ngspice -b -r (exit 0): v(v-sweep) = [0, 3, 6, 9], v(top) = [0, 3, 6, 9], v(a) = [-7.3985058599438795e-25, 2.381405664529363, 5.356213084449984, 8.344256960500747], v(b) = [-7.39850585636142e-25, 2.3814056645293626, 5.356213084449984, 8.344256960500747], i(v1) = [1.47970117163053e-28, -0.0004762811329058689, -0.0010712426168900668, -0.0016688513921001569], i(@d1[id]) = [7.39850585994388e-37, 0.00024363384418924443, 0.0006452722319805792, 0.0010244640191150918], i(@r2[i]) = [-7.39850585994388e-29, 0.0002381405664529363, 0.0005356213084449984, 0.0008344256960500747], i(@d2[id]) = [7.3985058563614194e-37, 0.00024363384418924874, 0.0006452722319805792, 0.0010244640191150918], i(@r4[i]) = [-7.398505856361421e-29, 0.00023814056645293628, 0.0005356213084449984, 0.0008344256960500747], i(@r5[i]) = [-3.582459542440043e-37, 4.440892098500626e-19, 0, 0]; v(top) = 9, v(a) = 8.349366331712673, v(b) = 8.349366331712673, i(v1) = -0.001669873266342714, i(@d1[id]) = 0.0008408255839864705, i(@r2[i]) = 0.0008349366331712674, i(@d2[id]) = 0.0008408255839864705, i(@r4[i]) = 0.0008349366331712674, i(@r5[i]) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(v-sweep) = [0, 3, 6, 9], v(top) = [0, 3, 6, 9], v(a) = [-7.3985058599438795e-25, 2.381405664529363, 5.356213084449984, 8.344256960500747], v(b) = [-7.39850585636142e-25, 2.3814056645293626, 5.356213084449984, 8.344256960500747], i(v1) = [1.47970117163053e-28, -0.0004762811329058689, -0.0010712426168900668, -0.0016688513921001569], i(@d1[id]) = [7.39850585994388e-37, 0.00024363384418924443, 0.0006452722319805792, 0.0010244640191150918], i(@r2[i]) = [-7.39850585994388e-29, 0.0002381405664529363, 0.0005356213084449984, 0.0008344256960500747], i(@d2[id]) = [7.3985058563614194e-37, 0.00024363384418924874, 0.0006452722319805792, 0.0010244640191150918], i(@r4[i]) = [-7.398505856361421e-29, 0.00023814056645293628, 0.0005356213084449984, 0.0008344256960500747], i(@r5[i]) = [-3.582459542440043e-37, 4.440892098500626e-19, 0, 0]; v(top) = 9, v(a) = 8.349366331712673, v(b) = 8.349366331712673, i(v1) = -0.001669873266342714, i(@d1[id]) = 0.0008408255839864705, i(@r2[i]) = 0.0008349366331712674, i(@d2[id]) = 0.0008408255839864705, i(@r4[i]) = 0.0008349366331712674, i(@r5[i]) = 0
```

Added after the critic of round 2 of the re-check's fixes (13 November 2026), with its second fix (C9t.10): a generated circuit (s5-137) with a diode D1 and 2.2 MΩ in a loop from top1, nothing else at d20, beside a bridge whose ammeter an F of 10⁹ reads into 22 kΩ. Nothing drives a current around that loop: with D1 at 0 A, d20 is at top1's 100 V, D1 has 0 V across it and so carries 0 A, and R21 carries 0. ngspice settles elsewhere: d20 at 100.68 V, R21 0.31 µA, and D1 2.475 mA, which does not add up at d20 with R21's current. The circuit's other values are far larger (o5 at 2 GV, F1 90.79 kA), so what ngspice's numbers leave of Kirchhoff's law at d20 (0.31 µA, with D1 taken at 0 A) and d20's 0.68 V from 100 V passed the checks of ngspice's values, and PlainSpice called R21's 0.31 µA rounding noise, "the two ends of R21 at the same voltage, 100 V", beside d20 drawn at 100.7 V. A diode the exact solution takes as carrying 0 A must now carry less than ngspice's current tolerance, 1 pA (C9c), by Kirchhoff's law with ngspice's other values; here it carries 0.31 µA, so the rule for other circuits decides and shows ngspice's numbers: R21 308.4 nA from d20 to top1. The same doubles in native 47, native 42 and our engine.

```spice
* a bridge whose ammeter an F of 1e9 and an H of 1 meg read, with a diode and 2.2 meg in a loop from top1 (the generated circuit s5-137)
V1 top1 0 100
R1 top1 a2 3.3k
R2 a2 0 12
R3 top1 b3 330
R4 b3 0 1.2
R5 a2 m4 560
V2 m4 b3 0
F1 0 o5 V2 1e9
R6 o5 0 22k
H1 h6 0 V2 1meg
R7 h6 0 270k
V3 b3 v7 0
V4 v7 v8 0
V5 v8 v9 0
V6 v9 v10 0
R8 v10 0 12
R9 b3 a11 12
R10 a11 0 5.6
R11 b3 b12 12000
R12 b12 0 5605.6
R13 a11 m13 1.2k
R14 m13 m14 100k
R15 m14 m15 2.2
R16 m15 m16 22k
R17 m16 m17 2.2
R18 m17 m18 220
R19 m18 m19 8.2k
R20 m19 b12 22k
D1 d20 top1 dmod
R21 d20 top1 2.2meg
E1 e21 0 b3 0 1
R22 e21 0 27
.model dmod D(is=1e-14)
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        e21                              3.103930e-01
        d20                              1.006786e+02
        m19                              9.881768e-02
        m18                              9.881418e-02
        m17                              9.881408e-02
        m16                              9.881408e-02
        m15                              9.880468e-02
        m14                              9.880468e-02
        m13                              9.876192e-02
        b12                              9.882709e-02
        a11                              9.876141e-02
        v10                              3.103930e-01
        v9                               3.103930e-01
        v8                               3.103930e-01
        v7                               3.103930e-01
        h6                               9.078636e+01
        o5                               1.997300e+09
        m4                               3.103930e-01
        b3                               3.103930e-01
        a2                               3.612334e-01
        top1                             1.000000e+02
        @r22[i]                          1.149604e-02
        @r21[i]                          3.084355e-07
        @d1[id]                          2.475025e-03
        @r20[i]                          -4.27541e-10
        @r19[i]                          -4.27541e-10
        @r18[i]                          -4.27541e-10
        @r17[i]                          -4.27541e-10
        @r16[i]                          -4.27541e-10
        @r15[i]                          -4.27541e-10
        @r14[i]                          -4.27541e-10
        @r13[i]                          -4.27541e-10
        @r12[i]                          1.763006e-05
        @r11[i]                          1.763049e-05
        @r10[i]                          1.763597e-02
        @r9[i]                           1.763597e-02
        @r8[i]                           2.586608e-02
        @r7[i]                           3.362458e-04
        @r6[i]                           9.078636e+04
        @f1[i]                           9.078636e+04
        @r5[i]                           9.078636e-05
        @r4[i]                           2.586608e-01
        @r3[i]                           3.020897e-01
        @r2[i]                           3.010278e-02
        @r1[i]                           3.019357e-02
        v1#branch                        -3.32283e-01
        v3#branch                        2.586608e-02
        v4#branch                        2.586608e-02
        v5#branch                        2.586608e-02
        v6#branch                        2.586608e-02
        e1#branch                        -1.14960e-02
        h1#branch                        -3.36246e-04
        v2#branch                        9.078636e-05
  rawfile from ngspice -b -r (exit 0): v(top1) = 100, v(a2) = 0.3612333515243817, v(b3) = 0.31039299140572524, v(m4) = 0.31039299140572524, v(o5) = 1997299861.804358, v(h6) = 90.78635735474354, v(v7) = 0.31039299140572524, v(v8) = 0.31039299140572524, v(v9) = 0.31039299140572524, v(v10) = 0.31039299140572524, v(a11) = 0.09876140798879642, v(b12) = 0.09882708871827177, v(m13) = 0.09876192103799805, v(m14) = 0.09880467513813368, v(m15) = 0.09880467607872388, v(m16) = 0.09881408198065472, v(m17) = 0.09881408292124493, v(m18) = 0.09881417698026354, v(m19) = 0.09881768281641147, v(d20) = 100.67855799103364, v(e21) = 0.31039299140572524, i(v2) = 0.00009078635735474354, i(h1) = -0.00033624576798053164, i(e1) = -0.011496036718730564, i(v6) = 0.02586608261714377, i(v5) = 0.02586608261714377, i(v4) = 0.02586608261714377, i(v3) = 0.02586608261714377, i(v1) = -0.33228328385891703, i(@r1[i]) = 0.03019356565105322, i(@r2[i]) = 0.03010277929369847, i(@r3[i]) = 0.30208971820786146, i(@r4[i]) = 0.25866082617143765, i(@r5[i]) = 0.00009078635735474365, i(@f1[i]) = 90786.35735474354, i(@r6[i]) = 90786.35735474354, i(@r7[i]) = 0.00033624576798053164, i(@r8[i]) = 0.02586608261714377, i(@r9[i]) = 0.01763596528474407, i(@r10[i]) = 0.01763596571228507, i(@r11[i]) = 0.00001763049189062112, i(@r12[i]) = 0.000017630064349627473, i(@r13[i]) = -4.2754100136368123e-10, i(@r14[i]) = -4.275410013562797e-10, i(@r15[i]) = -4.2754100133950016e-10, i(@r16[i]) = -4.275409968563439e-10, i(@r17[i]) = -4.2754100133950016e-10, i(@r18[i]) = -4.275409937067169e-10, i(@r19[i]) = -4.2754099364994414e-10, i(@r20[i]) = -4.275409936499441e-10, i(@d1[id]) = 0.0024750251429858545, i(@r21[i]) = 3.084354504698374e-7, i(@r22[i]) = 0.011496036718730564
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top1) = 100, v(a2) = 0.3612333515243817, v(b3) = 0.31039299140572524, v(m4) = 0.31039299140572524, v(o5) = 1997299861.804358, v(h6) = 90.78635735474354, v(v7) = 0.31039299140572524, v(v8) = 0.31039299140572524, v(v9) = 0.31039299140572524, v(v10) = 0.31039299140572524, v(a11) = 0.09876140798879642, v(b12) = 0.09882708871827177, v(m13) = 0.09876192103799805, v(m14) = 0.09880467513813368, v(m15) = 0.09880467607872388, v(m16) = 0.09881408198065472, v(m17) = 0.09881408292124493, v(m18) = 0.09881417698026354, v(m19) = 0.09881768281641147, v(d20) = 100.67855799103364, v(e21) = 0.31039299140572524, i(v2) = 0.00009078635735474354, i(h1) = -0.00033624576798053164, i(e1) = -0.011496036718730564, i(v6) = 0.02586608261714377, i(v5) = 0.02586608261714377, i(v4) = 0.02586608261714377, i(v3) = 0.02586608261714377, i(v1) = -0.33228328385891703, i(@r1[i]) = 0.03019356565105322, i(@r2[i]) = 0.03010277929369847, i(@r3[i]) = 0.30208971820786146, i(@r4[i]) = 0.25866082617143765, i(@r5[i]) = 0.00009078635735474365, i(@f1[i]) = 90786.35735474354, i(@r6[i]) = 90786.35735474354, i(@r7[i]) = 0.00033624576798053164, i(@r8[i]) = 0.02586608261714377, i(@r9[i]) = 0.01763596528474407, i(@r10[i]) = 0.01763596571228507, i(@r11[i]) = 0.00001763049189062112, i(@r12[i]) = 0.000017630064349627473, i(@r13[i]) = -4.2754100136368123e-10, i(@r14[i]) = -4.275410013562797e-10, i(@r15[i]) = -4.2754100133950016e-10, i(@r16[i]) = -4.275409968563439e-10, i(@r17[i]) = -4.2754100133950016e-10, i(@r18[i]) = -4.275409937067169e-10, i(@r19[i]) = -4.2754099364994414e-10, i(@r20[i]) = -4.275409936499441e-10, i(@d1[id]) = 0.0024750251429858545, i(@r21[i]) = 3.084354504698374e-7, i(@r22[i]) = 0.011496036718730564
```

Added after the critic of round 2 of the re-check's fixes (13 November 2026), with its second fix (C9t.11): the balanced bridge of C9 with a diode from a to top, reverse-biased by 4.5 V, with .op and ".tf v(a,b) V1". In the operating point a diode's current is left free (C9t). A .tf's ratio is a small change, and a diode passes a small change as a conductance at its operating point (here about gmin, 10⁻¹² S), not as a fixed current: with it beside R1, the bridge is no longer balanced for a change of V1, and ngspice gives v(a,b)/V1 = 2.994e−10 V/V, a real ratio. With the diode at 0 A the circuit's ratio is exactly 0, so PlainSpice leaves the .tf of a circuit with a diode as ngspice gives it, and shows 2.994e−10 (V/V). ngspice 42 −b, with .op and .tf together, prints "no data saved for transfer function analysis" and exits 1 but writes the same values to its rawfile; native 47 and our engine give the same doubles.

```spice
* the balanced bridge of C9 with a reverse-biased diode from a to top, .op and .tf v(a,b) V1
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
D1 a top dmod
.model dmod d
.op
.tf v(a,b) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                4.500000e+00
        a                                4.500000e+00
        top                              9.000000e+00
        v1#branch                        -1.40745e-03
        transfer_function = 2.994012e-10
        output_impedance_at_v(a,b) = 8.802395e+02
        v1#input_impedance = 6.394558e+03
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 4.500000009047006, v(b) = 4.500000006346407, i(v1) = -0.0014074468107656381; v(Transfer_function) = 2.994011705226285e-10, v(v1#Input_impedance) = 6394.557812906659, v(output_impedance_at_V(a,b)) = 880.2395205995194
ngspice 42, ngspice -b (exit 1):
        b                                4.500000e+00
        a                                4.500000e+00
        top                              9.000000e+00
        v1#branch                        -1.40745e-03
    Error: no data saved for transfer function analysis; analysis not run
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 4.500000009047006, v(b) = 4.500000006346407, i(v1) = -0.0014074468107656381; v(Transfer_function) = 2.994011705226285e-10, v(v1#Input_impedance) = 6394.557812906659, v(output_impedance_at_V(a,b)) = 880.2395205995194
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 4.500000009047006, v(b) = 4.500000006346407, i(v1) = -0.0014074468107656381; v(Transfer_function) = 2.994011705226285e-10, v(v1#Input_impedance) = 6394.557812906659, v(output_impedance_at_V(a,b)) = 880.2395205995194
```

### C9u. A circuit at rest, a value tiny beside the numbers it is worked out from, and two diodes placed alike: an I-V sweep of a diode from 0 V, whose .op is all leftovers of ngspice's Newton iterations

Added after the critic of round 3 of the re-check's fixes (13 November 2026). A diode's I-V curve swept from 0 V, with its source at 0 V for the .op: at V1 = 0 the circuit makes every value exactly 0. With every diode at 0 A, D1 has exactly 0 V across it, and 0 V across a diode makes 0 A through it (C9t.2), so it carries none. ngspice's Newton iterations leave v(a) at 7.323e−29 V, V1 and R1 at 7.323e−32 A and the diode at 7.3e−41 A, in the .op and at the sweep's 0 V point alike. No equation weighs these against anything larger: each of the circuit's equations holds only leftovers. So at rest PlainSpice holds each of ngspice's values to 2⁻³⁰ of ngspice's own tolerances, vntol (1 µV) and abstol (1 pA), or of the largest value of its kind the run's sweep gives (here 1 V and 370.3 µA), the larger, and shows them as 0: "the circuit makes each of them exactly 0 (D1 has 0 V across it, so it carries no current)". Before, the .op was left to the rule and drew 7.323e−32 A with arrows, beside a sweep note that called the same values rounding noise of exact 0s at the same point. The same doubles in native 47, native 42 and our engine.

```spice
* the I-V curve of a diode swept from 0 V, its source at 0 V for the .op
V1 in 0 0
R1 in a 1k
D1 a 0 dmod
.model dmod d
.options savecurrents
.op
.dc V1 0 1 0.25
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                7.323378e-29
        in                               0.000000e+00
        @d1[id]                          7.323378e-41
        @r1[i]                           -7.32338e-32
        v1#branch                        7.323378e-32
  rawfile from ngspice -b -r (exit 0): v(v-sweep) = [0, 0.25, 0.5, 0.75, 1], v(in) = [0, 0.25, 0.5, 0.75, 1], v(a) = [7.323378444748195e-29, 0.24999984210234252, 0.4977237724822676, 0.6051466622248889, 0.6296706738025182], i(v1) = [7.323378444748195e-32, -1.578976574598441e-10, -0.000002276227517732359, -0.00014485333777511107, -0.00037032932619748187], i(@r1[i]) = [-7.323378444748195e-32, 1.5789765747675767e-10, 0.0000022762275177323765, 0.00014485333777511112, 0.0003703293261974818], i(@d1[id]) = [7.323378444748195e-41, 1.5789765748689402e-10, 0.000002276227641451018, 0.00014485699554772006, 0.0003738685935656918]; v(in) = 0, v(a) = 7.323378444748195e-29, i(v1) = 7.323378444748195e-32, i(@r1[i]) = -7.323378444748195e-32, i(@d1[id]) = 7.323378444748195e-41
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(v-sweep) = [0, 0.25, 0.5, 0.75, 1], v(in) = [0, 0.25, 0.5, 0.75, 1], v(a) = [7.323378444748195e-29, 0.24999984210234252, 0.4977237724822676, 0.6051466622248889, 0.6296706738025182], i(v1) = [7.323378444748195e-32, -1.578976574598441e-10, -0.000002276227517732359, -0.00014485333777511107, -0.00037032932619748187], i(@r1[i]) = [-7.323378444748195e-32, 1.5789765747675767e-10, 0.0000022762275177323765, 0.00014485333777511112, 0.0003703293261974818], i(@d1[id]) = [7.323378444748195e-41, 1.5789765748689402e-10, 0.000002276227641451018, 0.00014485699554772006, 0.0003738685935656918]; v(in) = 0, v(a) = 7.323378444748195e-29, i(v1) = 7.323378444748195e-32, i(@r1[i]) = -7.323378444748195e-32, i(@d1[id]) = 7.323378444748195e-41
```

Added after the critic of round 3 of the re-check's fixes (13 November 2026) (C9u.2): the bridge of C9s.4, a few millivolts beside a 12 V supply with a 10 pΩ wire, beside an E of 100k reading the supply into 10 kΩ, as an open-loop op-amp used as a comparator: out is at 1.2 MV and E1 carries 120 A. ngspice gives the bridge as in C9s.4, a and m at 4.882 mV and b at 4.965 mV, where the circuit makes all three 5.189 mV and R5 carry 0 A (E1 reads top and takes no current from it). The check that ngspice's answers are the exact ones allowed each answer 2⁻³⁰ of the largest exact value of its kind anywhere in the circuit: 1.2 MV made that 1.1 mV, the bridge's 0.31 mV passed, and the page drew R5 as 0 A, "its two ends at the same voltage, 5.189 mV", between tags of 4.882 mV and 4.965 mV. Each answer is now held to 2⁻³⁰ of the numbers it is worked out from: a node to the terms of Kirchhoff's law at it over its conductance, or to the own equation of a source there; a current to the currents that flow at its nodes. A controlled source that reads another part of the circuit (the parts that conduct to each other, ground taken out) adds its gain times the floor of what it reads to the answers its output moves, by how much it moves each: until the critic of round 4 it added that to every answer of the part its output reaches, which this fact said was "2⁻³⁰ of the numbers it is worked out from" and was not (C9v: a comparator pulled up to the bridge's own rail hid the same error again). Here E1 drives a load of its own and reads top, so it moves no node of the bridge. The bridge's floor is about 1e−11 V, and the page shows ngspice's numbers, R5 at 82.78 nA, with the warning that gives the exact values. The same doubles in native 47, native 42 and our engine.

```spice
* the bridge of C9s.4 (a 10 pOhm wire at 5 mV beside 12 V) beside an open-loop E of 100k reading the supply
V1 top 0 12
Rd1 top s 999k
Rd2 s 0 1k
R1 s a 10k
R2 a 0 10k
R3 s b 4.7k
R4 b 0 4.7k
Rw a m 10p
R5 m b 1k
E1 out 0 top 0 100k
Rl out 0 10k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out                              1.200000e+06
        m                                4.882133e-03
        b                                4.964910e-03
        a                                4.882133e-03
        s                                1.031887e-02
        top                              1.200000e+01
        @rl[i]                           1.200000e+02
        @r5[i]                           -8.27765e-08
        @rw[i]                           0.000000e+00
        @r4[i]                           1.056364e-06
        @r3[i]                           1.139140e-06
        @r2[i]                           4.882133e-07
        @r1[i]                           5.436736e-07
        @rd2[i]                          1.031887e-05
        @rd1[i]                          1.200168e-05
        v1#branch                        -1.20017e-05
        e1#branch                        -1.20000e+02
  rawfile from ngspice -b -r (exit 0): v(top) = 12, v(s) = 0.010318868972790083, v(a) = 0.004882133225318445, v(b) = 0.0049649097211622055, v(m) = 0.004882133225318445, v(out) = 1200000, i(e1) = -120, i(v1) = -0.00001200168281384105, i(@rd1[i]) = 0.00001200168281384105, i(@rd2[i]) = 0.000010318868972790084, i(@r1[i]) = 5.436735747471639e-7, i(@r2[i]) = 4.882133225318445e-7, i(@r3[i]) = 0.0000011391402663038038, i(@r4[i]) = 0.0000010563637704600437, i(@rw[i]) = 0, i(@r5[i]) = -8.27764958437607e-8, i(@rl[i]) = 120
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 12, v(s) = 0.010318868972790083, v(a) = 0.004882133225318445, v(b) = 0.0049649097211622055, v(m) = 0.004882133225318445, v(out) = 1200000, i(e1) = -120, i(v1) = -0.00001200168281384105, i(@rd1[i]) = 0.00001200168281384105, i(@rd2[i]) = 0.000010318868972790084, i(@r1[i]) = 5.436735747471639e-7, i(@r2[i]) = 4.882133225318445e-7, i(@r3[i]) = 0.0000011391402663038038, i(@r4[i]) = 0.0000010563637704600437, i(@rw[i]) = 0, i(@r5[i]) = -8.27764958437607e-8, i(@rl[i]) = 120
```

Added after the critic of round 3 of the re-check's fixes (13 November 2026) (C9u.3): two equal diode arms fed through 100 Ω from 9 V, each a diode, 1 kΩ and 2.2 kΩ, with 4.7 kΩ and a 0 V ammeter between their middles c and d. The arms are the same, so c and d are at exactly the same voltage and R5 and Vm carry 0 A. ngspice gives c and d one step of a double apart (5.384580645483332 against 5.384580645483333), Vm −2.168e−19 A and R5 −1.890e−19 A. A diode's current is left free (C9t), and R5's current is then c·I1 − c·I2: 0 only when the two diodes carry the same current. PlainSpice finds the diodes placed alike: the same model line, their own currents (on no loop of diodes), the same voltage across each with every diode at 0 A, and the same voltage across each from each class's currents together (an equitable partition of the diodes' own equations, refined until it holds). The circuit's equations then have a solution with their currents equal, and ngspice's numbers must show that solution: the currents Kirchhoff's law gives the two within 2⁻³⁰ of the largest sum of the sizes of a node's terms (a circuit placed alike can settle unevenly, as a latch does; then the diodes are taken one by one). So R5 and Vm are 0 A, "(D1 and D2, placed alike in the circuit, carry the same current)". Before, both were drawn with ngspice's numbers and arrows. The same doubles in native 47, native 42 and our engine.

```spice
* two equal diode arms, a link between their middle nodes, read by an ammeter
V1 top 0 9
R0 top t 100
D1 t a dmod
R1 a c 1k
R2 c 0 2.2k
D2 t b dmod
R3 b d 1k
R4 d 0 2.2k
R5 c m 4.7k
Vm m d 0
.model dmod d
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        m                                5.384581e+00
        d                                5.384581e+00
        b                                7.832117e+00
        c                                5.384581e+00
        a                                7.832117e+00
        t                                8.510493e+00
        top                              9.000000e+00
        @r5[i]                           -1.88974e-19
        @r4[i]                           2.447537e-03
        @r3[i]                           2.447537e-03
        @d2[id]                          2.457611e-03
        @r2[i]                           2.447537e-03
        @r1[i]                           2.447537e-03
        @d1[id]                          2.457611e-03
        @r0[i]                           4.895073e-03
        v1#branch                        -4.89507e-03
        vm#branch                        -2.16840e-19
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(t) = 8.51049266859241, v(a) = 7.83211730252121, v(c) = 5.384580645483332, v(b) = 7.832117302521211, v(d) = 5.384580645483333, v(m) = 5.384580645483333, i(vm) = -2.168404344971009e-19, i(v1) = -0.004895073314075904, i(@r0[i]) = 0.004895073314075908, i(@d1[id]) = 0.002457611230743598, i(@r1[i]) = 0.002447536657037878, i(@r2[i]) = 0.0024475366570378783, i(@d2[id]) = 0.0024576112307435195, i(@r3[i]) = 0.002447536657037878, i(@r4[i]) = 0.0024475366570378787, i(@r5[i]) = -1.8897413185109047e-19
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(t) = 8.51049266859241, v(a) = 7.83211730252121, v(c) = 5.384580645483332, v(b) = 7.832117302521211, v(d) = 5.384580645483333, v(m) = 5.384580645483333, i(vm) = -2.168404344971009e-19, i(v1) = -0.004895073314075904, i(@r0[i]) = 0.004895073314075908, i(@d1[id]) = 0.002457611230743598, i(@r1[i]) = 0.002447536657037878, i(@r2[i]) = 0.0024475366570378783, i(@d2[id]) = 0.0024576112307435195, i(@r3[i]) = 0.002447536657037878, i(@r4[i]) = 0.0024475366570378787, i(@r5[i]) = -1.8897413185109047e-19
```

Added after the critic of round 3 of the re-check's fixes (13 November 2026) (C9u.4): the balanced bridge of C9 with .op and ".dc TEMP 0 50 25". No part of it changes with the temperature: a resistor without temperature coefficients keeps its value (tc1 and tc2 are 0 unless written, and a part with them is left to the rule), so ngspice gives the .op's values at 0, 25 and 50 °C, R5's −8.882e−19 A at each. PlainSpice decides such a sweep exactly, each point being the .op's circuit, a + 0·s (a diode's current, which does change with the temperature, is left free at each point): R5 is 0 at every point as in the .op, and the note says "i(@r5[i]) −8.881784e−19 A at 0 °C, … at 25 °C and … at 50 °C". Before, a sweep of the temperature was left as ngspice gives it, and its words gave R5 −8.882e−19 A at 50 °C, the .op's own state, beside the .op's "exactly 0". The same doubles in native 47, native 42 and our engine.

```spice
* the C9 bridge, .op and a temperature sweep
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
.options savecurrents
.op
.dc TEMP 0 50 25
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                4.500000e+00
        a                                4.500000e+00
        top                              9.000000e+00
        @r5[i]                           -8.88178e-19
        @r4[i]                           9.574468e-04
        @r3[i]                           9.574468e-04
        @r2[i]                           4.500000e-04
        @r1[i]                           4.500000e-04
        v1#branch                        -1.40745e-03
  rawfile from ngspice -b -r (exit 0): temp-sweep = [0, 25, 50], v(top) = [9, 9, 9], v(a) = [4.499999999999999, 4.499999999999999, 4.499999999999999], v(b) = [4.5, 4.5, 4.5], i(v1) = [-0.0014074468085106386, -0.0014074468085106386, -0.0014074468085106386], i(@r1[i]) = [0.0004500000000000001, 0.0004500000000000001, 0.0004500000000000001], i(@r2[i]) = [0.00044999999999999993, 0.00044999999999999993, 0.00044999999999999993], i(@r3[i]) = [0.0009574468085106382, 0.0009574468085106382, 0.0009574468085106382], i(@r4[i]) = [0.0009574468085106382, 0.0009574468085106382, 0.0009574468085106382], i(@r5[i]) = [-8.881784197001253e-19, -8.881784197001253e-19, -8.881784197001253e-19]; v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, i(v1) = -0.0014074468085106386, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: temp-sweep = [0, 25, 50], v(top) = [9, 9, 9], v(a) = [4.499999999999999, 4.499999999999999, 4.499999999999999], v(b) = [4.5, 4.5, 4.5], i(v1) = [-0.0014074468085106386, -0.0014074468085106386, -0.0014074468085106386], i(@r1[i]) = [0.0004500000000000001, 0.0004500000000000001, 0.0004500000000000001], i(@r2[i]) = [0.00044999999999999993, 0.00044999999999999993, 0.00044999999999999993], i(@r3[i]) = [0.0009574468085106382, 0.0009574468085106382, 0.0009574468085106382], i(@r4[i]) = [0.0009574468085106382, 0.0009574468085106382, 0.0009574468085106382], i(@r5[i]) = [-8.881784197001253e-19, -8.881784197001253e-19, -8.881784197001253e-19]; v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, i(v1) = -0.0014074468085106386, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19
```

Added after the critic of round 3 of the re-check's fixes (13 November 2026), and corrected after the critic of round 4 (C9u.5): the same bridge with ".dc R5 1k 2k 500". A sweep of a resistor changes the circuit at each point, which the exact solution of the netlist does not follow (nor does it follow a sweep of two sources); ngspice gives R5 −8.882e−19, −5.921e−19 and −4.441e−19 A at 1, 1.5 and 2 kΩ. Its point at R5 = 1 kΩ is the .op's own circuit: ngspice sets the resistor to the sweep's value and works its conductance out as in the .op (dctrcurv.c), and gives every value there as in the .op. So the .op is decided exactly, R5 0 A with "the circuit makes it exactly 0", and that point of the sweep, checked as an operating point, shows R5 as 0 too, with the sweep's note "ngspice gave i(@r5[i]) -8.881784e-19 A at R5 = 1 kΩ"; the points at 1.5 and 2 kΩ, other circuits, keep ngspice's numbers. Round 3 left the .op to the rule, which said "It is below 1 pA, ngspice's current tolerance" here and drew C9m's exact 0 with an arrow (C9v.7). Before round 3, the .op called that value rounding noise of an exact 0 beside the sweep's words giving it as a current. The same doubles in native 47, native 42 and our engine.

```spice
* the C9 bridge, .op and a sweep of R5
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
.options savecurrents
.op
.dc R5 1k 2k 500
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                4.500000e+00
        a                                4.500000e+00
        top                              9.000000e+00
        @r5[i]                           -8.88178e-19
        @r4[i]                           9.574468e-04
        @r3[i]                           9.574468e-04
        @r2[i]                           4.500000e-04
        @r1[i]                           4.500000e-04
        v1#branch                        -1.40745e-03
  rawfile from ngspice -b -r (exit 0): res-sweep = [1000, 1500, 2000], v(top) = [9, 9, 9], v(a) = [4.499999999999999, 4.499999999999999, 4.499999999999999], v(b) = [4.5, 4.5, 4.5], i(v1) = [-0.0014074468085106386, -0.0014074468085106386, -0.0014074468085106386], i(@r1[i]) = [0.0004500000000000001, 0.0004500000000000001, 0.0004500000000000001], i(@r2[i]) = [0.00044999999999999993, 0.00044999999999999993, 0.00044999999999999993], i(@r3[i]) = [0.0009574468085106382, 0.0009574468085106382, 0.0009574468085106382], i(@r4[i]) = [0.0009574468085106382, 0.0009574468085106382, 0.0009574468085106382], i(@r5[i]) = [-8.881784197001253e-19, -5.921189464667501e-19, -4.440892098500626e-19]; v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, i(v1) = -0.0014074468085106386, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: res-sweep = [1000, 1500, 2000], v(top) = [9, 9, 9], v(a) = [4.499999999999999, 4.499999999999999, 4.499999999999999], v(b) = [4.5, 4.5, 4.5], i(v1) = [-0.0014074468085106386, -0.0014074468085106386, -0.0014074468085106386], i(@r1[i]) = [0.0004500000000000001, 0.0004500000000000001, 0.0004500000000000001], i(@r2[i]) = [0.00044999999999999993, 0.00044999999999999993, 0.00044999999999999993], i(@r3[i]) = [0.0009574468085106382, 0.0009574468085106382, 0.0009574468085106382], i(@r4[i]) = [0.0009574468085106382, 0.0009574468085106382, 0.0009574468085106382], i(@r5[i]) = [-8.881784197001253e-19, -5.921189464667501e-19, -4.440892098500626e-19]; v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, i(v1) = -0.0014074468085106386, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19
```

Added after the critic of round 3 of the re-check's fixes (13 November 2026) (C9u.6): a 1.5 V source, 47 Ω and a current source written 1A, 1 attoamp (unit-letter-1 in traps.md), in one loop: I1's 1 aA flows through R1 and V1. 47 aV across R1 is far below one step of a double at 1.5 V (2.2e−16 V), so ngspice gives top1 and i2 as the same double, and R1 and V1 exactly 0 A; every other value is the exact one. Such a 0 is ngspice's arithmetic, not the circuit's (C9n), and where it is the only kind of value off, with every other current, the resistors' too, the exact one, the run is this circuit's, solved to the page's digits: PlainSpice shows V1 and R1 at their exact 1 aA, with ngspice's 0 in the Numbers panel's ngspice column and the note of C9n, and Kirchhoff's law holds on the page. Before, such a run was taken as off: the warning sat beside "V1: no current", "R1: no current" and "I1: 1 aA". Where ngspice gives another current with no correct digit beside such a 0 (3 aA through 150 Ω at 5 V, where it gives R1 5.921 aA the other way), the exact value would sit beside it, and the page keeps ngspice's numbers with the warning. The same doubles in native 47, native 42 and our engine.

```spice
* a 1.5 V source, 47 ohms and a current source written 1A (1 attoamp) in one loop
V1 top1 0 1.5
R1 top1 i2 47
I1 0 i2 1A
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        i2                               1.500000e+00
        top1                             1.500000e+00
        @i1[current]                     1.000000e-18
        @r1[i]                           0.000000e+00
        v1#branch                        0.000000e+00
  rawfile from ngspice -b -r (exit 0): v(top1) = 1.5, v(i2) = 1.5, i(v1) = 0, i(@r1[i]) = 0, i(@i1[current]) = 1e-18
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top1) = 1.5, v(i2) = 1.5, i(v1) = 0, i(@r1[i]) = 0, i(@i1[current]) = 1e-18
```

Added after the critic of round 3 of the re-check's fixes (13 November 2026) (C9u.7): a bridge of 4.7 MΩ over 33 kΩ arms with a 1 nΩ wire and 100 MΩ in its middle branch, read by a G of 1 mS into 3.3 Ω, with a diode and 5.6 Ω from a2 to ground. The wire beside megohms makes the equations ill-conditioned: ngspice gives a2 and m4 63.01 mV, where the circuit makes them 62.75 mV, as ngspice gives b3, and G1 263 nA, where the circuit makes it −5.48 pA, 48,000 times smaller and the other way. The diode's current, which only ngspice's numbers give (167.3 fA), moves a2 by about 5 nV, 1/50,000 of ngspice's error there, so a2's exact value is known to the page's digits. The warning now names such values, "node a2 is at 62.75 mV, where ngspice gives 63.01 mV", and leaves out those the diode's current moves by more than 5e−5 of them or by more than a thousandth of their gap (G1, g6). Before, a value any diode's current changed was never named, here every value off, and the page showed ngspice's numbers with no warning. The same doubles in native 47, native 42 and our engine.

```spice
* a bridge with a 1 nOhm wire read by a G of 1 mS, and a diode with 5.6 ohms from a2 to ground
V1 top1 0 9
R1 top1 a2 4.7meg
R2 a2 0 33k
R3 top1 b3 4.7meg
R4 b3 0 33k
R5 a2 m4 1n
R6 m4 b3 100meg
R7 top1 s5 1k
R8 s5 0 1e15
G1 0 g6 a2 b3 1m
R9 g6 0 3.3
D1 a2 d7 dmod
R10 d7 0 5.6
.model dmod D(is=1e-14)
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        d7                               9.369771e-13
        g6                               8.677882e-07
        s5                               9.000000e+00
        m4                               6.301395e-02
        b3                               6.275098e-02
        a2                               6.301395e-02
        top1                             9.000000e+00
        @r10[i]                          1.673173e-13
        @d1[id]                          1.673173e-13
        @r9[i]                           2.629661e-07
        @g1[i]                           2.629661e-07
        @r8[i]                           9.000000e-15
        @r7[i]                           8.999024e-15
        @r6[i]                           2.629661e-12
        @r5[i]                           0.000000e+00
        @r4[i]                           1.901545e-06
        @r3[i]                           1.901542e-06
        @r2[i]                           1.909514e-06
        @r1[i]                           1.901486e-06
        v1#branch                        -3.80303e-06
  rawfile from ngspice -b -r (exit 0): v(top1) = 9, v(a2) = 0.06301395023536004, v(b3) = 0.06275098412432668, v(m4) = 0.06301395023536004, v(s5) = 8.999999999991001, v(g6) = 8.677881664100572e-7, v(d7) = 9.369770927092972e-13, i(v1) = -0.0000038030287463696474, i(@r1[i]) = 0.0000019014863935669448, i(@r2[i]) = 0.0000019095136434957588, i(@r3[i]) = 0.0000019015423438033348, i(@r4[i]) = 0.000001901544973464445, i(@r5[i]) = 0, i(@r6[i]) = 2.6296611103335257e-12, i(@r7[i]) = 8.999023748401669e-15, i(@r8[i]) = 8.999999999991002e-15, i(@g1[i]) = 2.6296611103335256e-7, i(@r9[i]) = 2.629661110333506e-7, i(@d1[id]) = 1.6731733798380313e-13, i(@r10[i]) = 1.6731733798380306e-13
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top1) = 9, v(a2) = 0.06301395023536004, v(b3) = 0.06275098412432668, v(m4) = 0.06301395023536004, v(s5) = 8.999999999991001, v(g6) = 8.677881664100572e-7, v(d7) = 9.369770927092972e-13, i(v1) = -0.0000038030287463696474, i(@r1[i]) = 0.0000019014863935669448, i(@r2[i]) = 0.0000019095136434957588, i(@r3[i]) = 0.0000019015423438033348, i(@r4[i]) = 0.000001901544973464445, i(@r5[i]) = 0, i(@r6[i]) = 2.6296611103335257e-12, i(@r7[i]) = 8.999023748401669e-15, i(@r8[i]) = 8.999999999991002e-15, i(@g1[i]) = 2.6296611103335256e-7, i(@r9[i]) = 2.629661110333506e-7, i(@d1[id]) = 1.6731733798380313e-13, i(@r10[i]) = 1.6731733798380306e-13
```

Added after the critic of round 3 of the re-check's fixes (13 November 2026) (C9u.8): a ladder of 20 sections of 27 kΩ and 270 Ω from 5 V, read at n8 by a 1e14 Ω meter through a 1 nΩ wire. The wire's 1e9 S beside the 3.8 mS of the ladder at n8 makes ngspice's elimination lose digits there: n8 and p22 come out at 43.55 fV where the circuit makes them 43.56 fV, 5.5e−5 off, and each node beyond n8 is off by the same share. The answers check allowed 2⁻³⁰ of the ladder's 5 V, 4.7e−9 V, and let it through; each node's floor is now 2⁻³⁰ of the terms of its own equations (about 1e−13 V at n8), so the page shows ngspice's numbers with the warning. The same doubles in native 47, native 42 and our engine.

```spice
* a 20-section ladder of 27k and 270, read at n8 by a 1e14 ohm meter through a 1 nOhm wire
V1 top1 0 5
R1 top1 n2 27k
R2 n2 0 270
R3 n2 n3 27k
R4 n3 0 270
R5 n3 n4 27k
R6 n4 0 270
R7 n4 n5 27k
R8 n5 0 270
R9 n5 n6 27k
R10 n6 0 270
R11 n6 n7 27k
R12 n7 0 270
R13 n7 n8 27k
R14 n8 0 270
R15 n8 n9 27k
R16 n9 0 270
R17 n9 n10 27k
R18 n10 0 270
R19 n10 n11 27k
R20 n11 0 270
R21 n11 n12 27k
R22 n12 0 270
R23 n12 n13 27k
R24 n13 0 270
R25 n13 n14 27k
R26 n14 0 270
R27 n14 n15 27k
R28 n15 0 270
R29 n15 n16 27k
R30 n16 0 270
R31 n16 n17 27k
R32 n17 0 270
R33 n17 n18 27k
R34 n18 0 270
R35 n18 n19 27k
R36 n19 0 270
R37 n19 n20 27k
R38 n20 0 270
R39 n20 n21 27k
R40 n21 0 270
R41 n8 p22 1n
R42 p22 0 1e14
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        p22                              4.355490e-14
        n21                              3.404200e-40
        n20                              3.438242e-38
        n19                              3.506666e-36
        n18                              3.576456e-34
        n17                              3.647634e-32
        n16                              3.720229e-30
        n15                              3.794269e-28
        n14                              3.869782e-26
        n13                              3.946798e-24
        n12                              4.025347e-22
        n11                              4.105460e-20
        n10                              4.187166e-18
        n9                               4.270499e-16
        n8                               4.355490e-14
        n7                               4.442418e-12
        n6                               4.530831e-10
        n5                               4.621004e-08
        n4                               4.712971e-06
        n3                               4.806768e-04
        n2                               4.902432e-02
        top1                             5.000000e+00
        @r42[i]                          4.355490e-28
        @r41[i]                          6.310887e-21
        @r40[i]                          1.260815e-42
        @r39[i]                          1.260815e-42
        @r38[i]                          1.273423e-40
        @r37[i]                          1.286031e-40
        @r36[i]                          1.298765e-38
        @r35[i]                          1.311626e-38
        @r34[i]                          1.324613e-36
        @r33[i]                          1.337729e-36
        @r32[i]                          1.350976e-34
        @r31[i]                          1.364353e-34
        @r30[i]                          1.377863e-32
        @r29[i]                          1.391506e-32
        @r28[i]                          1.405285e-30
        @r27[i]                          1.419200e-30
        @r26[i]                          1.433253e-28
        @r25[i]                          1.447445e-28
        @r24[i]                          1.461777e-26
        @r23[i]                          1.476252e-26
        @r22[i]                          1.490869e-24
        @r21[i]                          1.505632e-24
        @r20[i]                          1.520541e-22
        @r19[i]                          1.535597e-22
        @r18[i]                          1.550802e-20
        @r17[i]                          1.566158e-20
        @r16[i]                          1.581666e-18
        @r15[i]                          1.597328e-18
        @r14[i]                          1.613145e-16
        @r13[i]                          1.629209e-16
        @r12[i]                          1.645340e-14
        @r11[i]                          1.661632e-14
        @r10[i]                          1.678086e-12
        @r9[i]                           1.694702e-12
        @r8[i]                           1.711483e-10
        @r7[i]                           1.728430e-10
        @r6[i]                           1.745545e-08
        @r5[i]                           1.762829e-08
        @r4[i]                           1.780284e-06
        @r3[i]                           1.797913e-06
        @r2[i]                           1.815716e-04
        @r1[i]                           1.833695e-04
        v1#branch                        -1.83369e-04
  rawfile from ngspice -b -r (exit 0): v(top1) = 5, v(n2) = 0.04902432036075849, v(n3) = 0.0004806767973668559, v(n4) = 0.000004712970660819228, v(n5) = 4.621003670537149e-8, v(n6) = 4.5308312866507694e-10, v(n7) = 4.442418466369907e-12, v(n8) = 4.355490465360492e-14, v(n9) = 4.2704991980412374e-16, v(n10) = 4.187166415702717e-18, v(n11) = 4.105459755344378e-20, v(n12) = 4.0253474854840795e-22, v(n13) = 3.946798493834904e-24, v(n14) = 3.869782275222429e-26, v(n15) = 3.7942689197377853e-28, v(n16) = 3.7202291011218854e-30, v(n17) = 3.6476340653763185e-32, v(n18) = 3.576455619596522e-34, v(n19) = 3.50666612134043e-36, v(n20) = 3.4382417071680744e-38, v(n21) = 3.4041997100674006e-40, v(p22) = 4.355490465360491e-14, i(v1) = -0.0001833694696162682, i(@r1[i]) = 0.0001833694696162682, i(@r2[i]) = 0.00018157155689169812, i(@r3[i]) = 0.0000017979127245700606, i(@r4[i]) = 0.000001780284434692059, i(@r5[i]) = 1.762828987800136e-8, i(@r6[i]) = 1.7455446891923066e-8, i(@r7[i]) = 1.7284298607829096e-10, i(@r8[i]) = 1.7114828409396848e-10, i(@r9[i]) = 1.6947019843224596e-12, i(@r10[i]) = 1.6780856617225073e-12, i(@r11[i]) = 1.6616322599952112e-14, i(@r12[i]) = 1.6453401727295952e-14, i(@r13[i]) = 1.6292087265615931e-16, i(@r14[i]) = 1.6131446168001822e-16, i(@r15[i]) = 1.5973279531037331e-18, i(@r16[i]) = 1.5816663696449028e-18, i(@r17[i]) = 1.5661583458830407e-20, i(@r18[i]) = 1.5508023761861914e-20, i(@r19[i]) = 1.535596969684916e-22, i(@r20[i]) = 1.5205406501275474e-22, i(@r21[i]) = 1.5056319557368655e-24, i(@r22[i]) = 1.4908694390681776e-24, i(@r23[i]) = 1.476251666868789e-26, i(@r24[i]) = 1.4617772199388533e-26, i(@r25[i]) = 1.447444692993585e-28, i(@r26[i]) = 1.4332526945268256e-28, i(@r27[i]) = 1.4191998466759448e-30, i(@r28[i]) = 1.4052847850880687e-30, i(@r29[i]) = 1.3915061587876173e-32, i(@r30[i]) = 1.3778626300451428e-32, i(@r31[i]) = 1.3643528742474527e-34, i(@r32[i]) = 1.3509755797690069e-34, i(@r33[i]) = 1.3377294478445753e-36, i(@r34[i]) = 1.3246131924431563e-36, i(@r35[i]) = 1.3116255401418954e-38, i(@r36[i]) = 1.2987652301260852e-38, i(@r37[i]) = 1.2860310015810181e-40, i(@r38[i]) = 1.2734228545066943e-40, i(@r39[i]) = 1.2608147074323703e-42, i(@r40[i]) = 1.2608147074323707e-42, i(@r41[i]) = 6.310887241768094e-21, i(@r42[i]) = 4.355490465360491e-28
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top1) = 5, v(n2) = 0.04902432036075849, v(n3) = 0.0004806767973668559, v(n4) = 0.000004712970660819228, v(n5) = 4.621003670537149e-8, v(n6) = 4.5308312866507694e-10, v(n7) = 4.442418466369907e-12, v(n8) = 4.355490465360492e-14, v(n9) = 4.2704991980412374e-16, v(n10) = 4.187166415702717e-18, v(n11) = 4.105459755344378e-20, v(n12) = 4.0253474854840795e-22, v(n13) = 3.946798493834904e-24, v(n14) = 3.869782275222429e-26, v(n15) = 3.7942689197377853e-28, v(n16) = 3.7202291011218854e-30, v(n17) = 3.6476340653763185e-32, v(n18) = 3.576455619596522e-34, v(n19) = 3.50666612134043e-36, v(n20) = 3.4382417071680744e-38, v(n21) = 3.4041997100674006e-40, v(p22) = 4.355490465360491e-14, i(v1) = -0.0001833694696162682, i(@r1[i]) = 0.0001833694696162682, i(@r2[i]) = 0.00018157155689169812, i(@r3[i]) = 0.0000017979127245700606, i(@r4[i]) = 0.000001780284434692059, i(@r5[i]) = 1.762828987800136e-8, i(@r6[i]) = 1.7455446891923066e-8, i(@r7[i]) = 1.7284298607829096e-10, i(@r8[i]) = 1.7114828409396848e-10, i(@r9[i]) = 1.6947019843224596e-12, i(@r10[i]) = 1.6780856617225073e-12, i(@r11[i]) = 1.6616322599952112e-14, i(@r12[i]) = 1.6453401727295952e-14, i(@r13[i]) = 1.6292087265615931e-16, i(@r14[i]) = 1.6131446168001822e-16, i(@r15[i]) = 1.5973279531037331e-18, i(@r16[i]) = 1.5816663696449028e-18, i(@r17[i]) = 1.5661583458830407e-20, i(@r18[i]) = 1.5508023761861914e-20, i(@r19[i]) = 1.535596969684916e-22, i(@r20[i]) = 1.5205406501275474e-22, i(@r21[i]) = 1.5056319557368655e-24, i(@r22[i]) = 1.4908694390681776e-24, i(@r23[i]) = 1.476251666868789e-26, i(@r24[i]) = 1.4617772199388533e-26, i(@r25[i]) = 1.447444692993585e-28, i(@r26[i]) = 1.4332526945268256e-28, i(@r27[i]) = 1.4191998466759448e-30, i(@r28[i]) = 1.4052847850880687e-30, i(@r29[i]) = 1.3915061587876173e-32, i(@r30[i]) = 1.3778626300451428e-32, i(@r31[i]) = 1.3643528742474527e-34, i(@r32[i]) = 1.3509755797690069e-34, i(@r33[i]) = 1.3377294478445753e-36, i(@r34[i]) = 1.3246131924431563e-36, i(@r35[i]) = 1.3116255401418954e-38, i(@r36[i]) = 1.2987652301260852e-38, i(@r37[i]) = 1.2860310015810181e-40, i(@r38[i]) = 1.2734228545066943e-40, i(@r39[i]) = 1.2608147074323703e-42, i(@r40[i]) = 1.2608147074323707e-42, i(@r41[i]) = 6.310887241768094e-21, i(@r42[i]) = 4.355490465360491e-28
```

### C9v. What a controlled source's rounding reaches, what the page draws, a current source swept into a diode, a circuit at rest beside a source that drives nothing, and the .op beside a sweep of a resistor or of two sources

Added after the critic of round 4 of the re-check's fixes (13 November 2026). The bridge of C9s.4, a few millivolts beside a 12 V supply with a 10 pΩ wire, beside an open-loop comparator: an E of 100k reading a 12 V reference, its output pulled up to the bridge's supply by 10 kΩ. ngspice gives the bridge's a and m 4.961 mV and b 5.023 mV, where the circuit makes all three 5.189 mV and R5 carry 0 A, and R5 61.5 nA. E1 makes 1.2 MV and pushes 120 A through Rp into top, which V1 holds at 12 V. What E1 makes is off by its gain times the rounding of what it reads; the floor of each answer took that for every node of the part E1's output reaches, 2.4 MV over 2³⁰ (2.2 mV), so the bridge's 0.23 mV error passed and the page drew R5 as 0 A, "its two ends at the same voltage, 5.189 mV", between tags of 4.961 and 5.023 mV. Now the floor follows how much E1's output moves each answer, from one more exact solution with a unit change of what E1 makes: it moves V1's current and the voltage at out, and no node of the bridge, which V1 holds. The bridge keeps its own floor of about 1e−11 V, and the page shows ngspice's numbers with the warning: "R5 carries no current, where ngspice gives 61.5 nA; R2 carries 518.9 nA, where ngspice gives 496.1 nA; node a is at 5.189 mV, where ngspice gives 4.961 mV …". An H of 1 GΩ reading a bridge 1e−14 off balance moves its own output by all it makes, so that output keeps the floor of its gain times the ammeter's (C9u.2's test). The same doubles in native 47, native 42 and our engine.

```spice
* the bridge of C9s.4 beside an open-loop comparator: an E of 100k reading a 12 V reference, pulled up by 10k to the bridge supply
V1 top 0 12
Rd1 top s 999k
Rd2 s 0 1k
R1 s a 10k
R2 a 0 10k
R3 s b 4.7k
R4 b 0 4.7k
Rw a m 10p
R5 m b 1k
V2 x 0 12
E1 out 0 x 0 100k
Rp top out 10k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        out                              1.200000e+06
        x                                1.200000e+01
        m                                4.961074e-03
        b                                5.022577e-03
        a                                4.961074e-03
        s                                1.033422e-02
        top                              1.200000e+01
        @rp[i]                           -1.19999e+02
        @r5[i]                           -6.15028e-08
        @rw[i]                           0.000000e+00
        @r4[i]                           1.068633e-06
        @r3[i]                           1.130136e-06
        @r2[i]                           4.961074e-07
        @r1[i]                           5.373143e-07
        @rd2[i]                          1.033422e-05
        @rd1[i]                          1.200167e-05
        v1#branch                        1.199988e+02
        v2#branch                        0.000000e+00
        e1#branch                        -1.19999e+02
  rawfile from ngspice -b -r (exit 0): v(top) = 12, v(s) = 0.01033421695321993, v(a) = 0.0049610739788227285, v(b) = 0.005022576813983098, v(m) = 0.0049610739788227285, v(x) = 12, v(out) = 1200000, i(e1) = -119.9988, i(v2) = 0, i(v1) = 119.99878799833255, i(@rd1[i]) = 0.000012001667450497277, i(@rd2[i]) = 0.00001033421695321993, i(@r1[i]) = 5.373142974397202e-7, i(@r2[i]) = 4.961073978822728e-7, i(@r3[i]) = 0.000001130136199837624, i(@r4[i]) = 0.0000010686333646772549, i(@rw[i]) = 0, i(@r5[i]) = -6.150283516036942e-8, i(@rp[i]) = -119.9988
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 12, v(s) = 0.01033421695321993, v(a) = 0.0049610739788227285, v(b) = 0.005022576813983098, v(m) = 0.0049610739788227285, v(x) = 12, v(out) = 1200000, i(e1) = -119.9988, i(v2) = 0, i(v1) = 119.99878799833255, i(@rd1[i]) = 0.000012001667450497277, i(@rd2[i]) = 0.00001033421695321993, i(@r1[i]) = 5.373142974397202e-7, i(@r2[i]) = 4.961073978822728e-7, i(@r3[i]) = 0.000001130136199837624, i(@r4[i]) = 0.0000010686333646772549, i(@rw[i]) = 0, i(@r5[i]) = -6.150283516036942e-8, i(@rp[i]) = -119.9988
```

Added after the critic of round 4 of the re-check's fixes (13 November 2026) (C9v.2): a diode's I-V curve fed by a current source swept from 0 to 1 mA, the source at 0 for the .op. At I1 = 0 the circuit makes every value exactly 0, and D1, with 0 V across it, carries 0 A (C9t.2); ngspice's Newton iterations leave v(a) at 7.323e−29 V and R1 at 7.323e−32 A, in the .op and at the sweep's first point alike. Each sweep point's diode current is the one Kirchhoff's law gives from ngspice's other values with I1 at that point's value; it was worked out with I1 at its netlist value, 0, so every point but the first failed its check, the sweep was left as ngspice gives it, and the .op beside it went to the rule, which drew 7.323e−32 A with arrows. Now both are decided exactly: node a 0 V, R1 and I1 0 A, "(D1 has 0 V across it, so it carries no current)", and the sweep's note says the same "there". The same doubles in native 47, native 42 and our engine.

```spice
* the I-V curve of a diode fed by a current source swept from 0, its source at 0 for the .op
I1 0 a 0
D1 a 0 dmod
R1 a 0 1k
.model dmod d
.options savecurrents
.op
.dc I1 0 1m 0.25m
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                7.323378e-29
        @r1[i]                           7.323378e-32
        @d1[id]                          7.323378e-41
        @i1[current]                     0.000000e+00
  rawfile from ngspice -b -r (exit 0): i(i-sweep) = [0, 0.00025, 0.0005, 0.00075, 0.001], v(a) = [7.323378444748195e-29, 0.24999999965334396, 0.49773230174399913, 0.6053289558374666, 0.6296832256158842], i(@i1[current]) = [0, 0.00025, 0.0005, 0.00075, 0.001], i(@d1[id]) = [7.323378444748195e-41, 1.5789861798765783e-10, 0.0000022769783780108205, 0.00014588154085181518, 0.0003740500697960956], i(@r1[i]) = [7.323378444748195e-32, 0.000249999999653344, 0.0004977323017439991, 0.0006053289558374666, 0.0006296832256158842]; v(a) = 7.323378444748195e-29, i(@i1[current]) = 0, i(@d1[id]) = 7.323378444748195e-41, i(@r1[i]) = 7.323378444748195e-32
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: i(i-sweep) = [0, 0.00025, 0.0005, 0.00075, 0.001], v(a) = [7.323378444748195e-29, 0.24999999965334396, 0.49773230174399913, 0.6053289558374666, 0.6296832256158842], i(@i1[current]) = [0, 0.00025, 0.0005, 0.00075, 0.001], i(@d1[id]) = [7.323378444748195e-41, 1.5789861798765783e-10, 0.0000022769783780108205, 0.00014588154085181518, 0.0003740500697960956], i(@r1[i]) = [7.323378444748195e-32, 0.000249999999653344, 0.0004977323017439991, 0.0006053289558374666, 0.0006296832256158842]; v(a) = 7.323378444748195e-29, i(@i1[current]) = 0, i(@d1[id]) = 7.323378444748195e-41, i(@r1[i]) = 7.323378444748195e-32
```

Added after the critic of round 4 of the re-check's fixes (13 November 2026) (C9v.3): the two equal arms of C9m fed through a 30 nΩ wire. The circuit makes n3 and n5 the same voltage and R7 carry 0 A; ngspice gives R7 −6.217e−20 A, its ends 7 steps of a double apart (C9m), and V1 372.4098 µA where the circuit makes 372.4395 µA, 8e−5 of it. Both are drawn "372.4 µA", and every other value too is drawn with the exact value's digits, so nothing on the page is off: the run is decided exactly, R7 0 A with the note. An answer is off when the page draws it with other digits than its exact value and it is more than 5e−5 from it beyond rounding; the currents of the R, G and F that ngspice reports count, each beyond what rounding leaves of the node voltages it is worked out from (a 1 nΩ wire's current, worked out from two voltages a step apart, has no digit ngspice can give). Before, V1's 8e−5 made the run off, the rule drew R7 as 6.217e−20 A with an arrow, and the warning, which names only values drawn differently, was empty. The same doubles in native 47, native 42 and our engine.

```spice
* two equal arms of three resistors and a link (C9m), fed through a 30 nOhm wire
V1 n0 0 9
Rs n0 n1 30n
R1 n1 n2 15k
R2 n2 n3 330
R3 n3 0 33k
R4 n1 n4 15k
R5 n4 n5 330
R6 n5 0 33k
R7 n3 n5 100k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n5                               6.145251e+00
        n4                               6.206704e+00
        n3                               6.145251e+00
        n2                               6.206704e+00
        n1                               9.000000e+00
        n0                               9.000000e+00
        @r7[i]                           -6.21725e-20
        @r6[i]                           1.862197e-04
        @r5[i]                           1.862197e-04
        @r4[i]                           1.862197e-04
        @r3[i]                           1.862197e-04
        @r2[i]                           1.862197e-04
        @r1[i]                           1.862197e-04
        @rs[i]                           3.724428e-04
        v1#branch                        -3.72410e-04
  rawfile from ngspice -b -r (exit 0): v(n0) = 9, v(n1) = 8.999999999988827, v(n2) = 6.206703910606817, v(n3) = 6.145251396640413, v(n4) = 6.206703910606823, v(n5) = 6.145251396640419, i(v1) = -0.0003724098205566406, i(@rs[i]) = 0.0003724428173275858, i(@r1[i]) = 0.00018621973929213402, i(@r2[i]) = 0.00018621973929213248, i(@r3[i]) = 0.00018621973929213372, i(@r4[i]) = 0.0001862197392921336, i(@r5[i]) = 0.00018621973929213248, i(@r6[i]) = 0.0001862197392921339, i(@r7[i]) = -6.217248937900877e-20
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n0) = 9, v(n1) = 8.999999999988827, v(n2) = 6.206703910606817, v(n3) = 6.145251396640413, v(n4) = 6.206703910606823, v(n5) = 6.145251396640419, i(v1) = -0.0003724098205566406, i(@rs[i]) = 0.0003724428173275858, i(@r1[i]) = 0.00018621973929213402, i(@r2[i]) = 0.00018621973929213248, i(@r3[i]) = 0.00018621973929213372, i(@r4[i]) = 0.0001862197392921336, i(@r5[i]) = 0.00018621973929213248, i(@r6[i]) = 0.0001862197392921339, i(@r7[i]) = -6.217248937900877e-20
```

Added after the critic of round 4 of the re-check's fixes (13 November 2026) (C9v.4): a balanced bridge from 24 V with a 1 nΩ wire and 2.7 kΩ in its middle branch. The circuit makes a2, m4 and b3 the same voltage, 64.6255 mV, and R6 carry 0 A. ngspice gives a2 and m4 64.62494 mV and b3 64.62551 mV, each within 5e−5 of the exact voltage, drawn 64.62 mV and 64.63 mV, and R6 210.2 pA. A 0 for R6, "its two ends at the same voltage", would sit between tags that differ: nodes at exactly one voltage whose numbers ngspice gives are drawn differently, beyond rounding, are off on the page. The page shows ngspice's numbers with the warning "R6 carries no current, where ngspice gives 210.2 pA; node a2 is at 64.63 mV, where ngspice gives 64.62 mV; and node m4 is at 64.63 mV, where ngspice gives 64.62 mV". The same doubles in native 47, native 42 and our engine.

```spice
* a balanced bridge with a 1 nOhm wire in its middle branch
V1 top1 0 24
R1 top1 a2 100k
R2 a2 0 270
R3 top1 b3 10k
R4 b3 0 27
R5 a2 m4 1n
R6 m4 b3 2.7k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        m4                               6.462494e-02
        b3                               6.462551e-02
        a2                               6.462494e-02
        top1                             2.400000e+01
        @r6[i]                           -2.10166e-10
        @r5[i]                           0.000000e+00
        @r4[i]                           2.393537e-03
        @r3[i]                           2.393537e-03
        @r2[i]                           2.393516e-04
        @r1[i]                           2.393538e-04
        v1#branch                        -2.63289e-03
  rawfile from ngspice -b -r (exit 0): v(top1) = 24, v(a2) = 0.06462493801314731, v(b3) = 0.06462550546077958, v(m4) = 0.06462493801314731, i(v1) = -0.0026328912000737905, i(@r1[i]) = 0.00023935375061986855, i(@r2[i]) = 0.00023935162227091598, i(@r3[i]) = 0.0023935374494539223, i(@r4[i]) = 0.0023935372392881325, i(@r5[i]) = 0, i(@r6[i]) = -2.1016578973016892e-10
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top1) = 24, v(a2) = 0.06462493801314731, v(b3) = 0.06462550546077958, v(m4) = 0.06462493801314731, i(v1) = -0.0026328912000737905, i(@r1[i]) = 0.00023935375061986855, i(@r2[i]) = 0.00023935162227091598, i(@r3[i]) = 0.0023935374494539223, i(@r4[i]) = 0.0023935372392881325, i(@r5[i]) = 0, i(@r6[i]) = -2.1016578973016892e-10
```

Added after the critic of round 4 of the re-check's fixes (13 November 2026) (C9v.5): a balanced bridge whose middle nodes are at exactly 343.75 mV (11/32 V), on a rounding boundary of the page's four digits. ngspice gives a2 and m4 0.3437499999999999 and 0.34374999999999983, b3 and m5 0.34375, a step or two of a double apart: it lost nothing. The page draws them 343.7 mV and 343.8 mV, and R6, between m4 and m5, as 0 A with the note. Two nodes at exactly one voltage drawn differently are off only beyond rounding: here a warning that ngspice lost most of its digits would not be true. The drawn digits differ by one in the last where the exact value lies on a rounding boundary, as the answers check allows (exact.ts ANSWER_GAP). The same doubles in native 47, native 42 and our engine.

```spice
* a balanced bridge whose middle nodes are at exactly 343.75 mV
V1 top1 0 0.5
R1 top1 a2 150
R2 a2 0 330
R3 top1 b3 15
R4 b3 0 33
R5 a2 m4 27
R6 m4 m5 6.8k
R7 m5 b3 820
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        m5                               3.437500e-01
        m4                               3.437500e-01
        b3                               3.437500e-01
        a2                               3.437500e-01
        top1                             5.000000e-01
        @r7[i]                           0.000000e+00
        @r6[i]                           -2.44902e-20
        @r5[i]                           2.055969e-18
        @r4[i]                           1.041667e-02
        @r3[i]                           1.041667e-02
        @r2[i]                           1.041667e-03
        @r1[i]                           1.041667e-03
        v1#branch                        -1.14583e-02
  rawfile from ngspice -b -r (exit 0): v(top1) = 0.5, v(a2) = 0.3437499999999999, v(b3) = 0.34375, v(m4) = 0.34374999999999983, v(m5) = 0.34375, i(v1) = -0.011458333333333336, i(@r1[i]) = 0.0010416666666666675, i(@r2[i]) = 0.0010416666666666664, i(@r3[i]) = 0.010416666666666666, i(@r4[i]) = 0.010416666666666668, i(@r5[i]) = 2.05596856412066e-18, i(@r6[i]) = -2.4490213778496098e-20, i(@r7[i]) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top1) = 0.5, v(a2) = 0.3437499999999999, v(b3) = 0.34375, v(m4) = 0.34374999999999983, v(m5) = 0.34375, i(v1) = -0.011458333333333336, i(@r1[i]) = 0.0010416666666666675, i(@r2[i]) = 0.0010416666666666664, i(@r3[i]) = 0.010416666666666666, i(@r4[i]) = 0.010416666666666668, i(@r5[i]) = 2.05596856412066e-18, i(@r6[i]) = -2.4490213778496098e-20, i(@r7[i]) = 0
```

Added after the critic of round 4 of the re-check's fixes (13 November 2026) (C9v.6): the diode at rest of C9u beside a 5 V source charging only a capacitor. No current flows anywhere: V2 holds x at 5 V and drives nothing (C1 is open in an .op). Kirchhoff's law at each node holds nothing but ngspice's Newton leftovers (7.323e−32 A in V1 and R1, 7.323e−29 V at a), and the check that ngspice's values are this circuit's weighs them against themselves, so the run fell to the rule, which drew them with arrows. A circuit where no current flows is checked as any other first; where its equations hold nothing but leftovers, it is checked as one at rest: each node voltage within 2⁻³⁰ of its exact voltage (x's 5 V), of vntol or of the sweep's largest, each current within 2⁻³⁰ of abstol or of the sweep's largest. Node a is 0 V, V1 and R1 0 A, "(D1 has 0 V across it, so it carries no current)". The same doubles in native 47, native 42 and our engine.

```spice
* a diode at rest, its source at 0 V, beside a 5 V source charging only a capacitor
V1 in 0 0
R1 in a 1k
D1 a 0 dmod
V2 x 0 5
C1 x 0 1u
.model dmod d
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        x                                5.000000e+00
        a                                7.323378e-29
        in                               0.000000e+00
        @c1[i]                           0.000000e+00
        @d1[id]                          7.323378e-41
        @r1[i]                           -7.32338e-32
        v1#branch                        7.323378e-32
        v2#branch                        0.000000e+00
  rawfile from ngspice -b -r (exit 0): v(in) = 0, v(a) = 7.323378444748195e-29, v(x) = 5, i(v2) = 0, i(v1) = 7.323378444748195e-32, i(@r1[i]) = -7.323378444748195e-32, i(@d1[id]) = 7.323378444748195e-41, i(@c1[i]) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(in) = 0, v(a) = 7.323378444748195e-29, v(x) = 5, i(v2) = 0, i(v1) = 7.323378444748195e-32, i(@r1[i]) = -7.323378444748195e-32, i(@d1[id]) = 7.323378444748195e-41, i(@c1[i]) = 0
```

Added after the critic of round 4 of the re-check's fixes (13 November 2026) (C9v.7): the two equal arms of C9m with ".dc R1 10k 20k 5k". The circuit makes R7 carry 0 A at R1 = 15 kΩ, the .op's own value, and a real current at 10 and 20 kΩ (ngspice gives −4.682 µA at 20 kΩ). The .op is decided exactly, R7 0 A with the note, and the sweep's point at 15 kΩ, the .op's own circuit, checked as an operating point, shows R7 as 0 too: "ngspice gave i(@r7[i]) 6.217249e-20 A at R1 = 15 kΩ". The other points keep ngspice's numbers. Before, beside a sweep the exact solution does not follow, the .op was left to the rule, which drew R7's exact 0 as 6.217e−20 A with an arrow and no note. The same doubles in native 47, native 42 and our engine.

```spice
* two equal arms of three resistors and a link (C9m), .op and a sweep of R1
V1 n1 0 9
R1 n1 n2 15k
R2 n2 n3 330
R3 n3 0 33k
R4 n1 n4 15k
R5 n4 n5 330
R6 n5 0 33k
R7 n3 n5 100k
.options savecurrents
.op
.dc R1 10k 20k 5k
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        n5                               6.145251e+00
        n4                               6.206704e+00
        n3                               6.145251e+00
        n2                               6.206704e+00
        n1                               9.000000e+00
        @r7[i]                           6.217249e-20
        @r6[i]                           1.862197e-04
        @r5[i]                           1.862197e-04
        @r4[i]                           1.862197e-04
        @r3[i]                           1.862197e-04
        @r2[i]                           1.862197e-04
        @r1[i]                           1.862197e-04
        v1#branch                        -3.72439e-04
  rawfile from ngspice -b -r (exit 0): res-sweep = [10000, 15000, 20000], v(n1) = [9, 9, 9], v(n2) = [6.877278362577043, 6.206703910614529, 5.6827369940333], v(n3) = [6.807228548542084, 6.145251396648049, 5.62800215443485], v(n4) = [6.268079719104217, 6.2067039106145225, 6.158746680760464], v(n5) = [6.207977472924511, 6.145251396648042, 6.096239107737195], i(v1) = [-0.0003944001824686815, -0.00037243947858473, -0.00035528003824763724], i(@r1[i]) = [0.00021227216374229574, 0.00018621973929236477, 0.00016586315029833498], i(@r2[i]) = [0.00021227216374229872, 0.00018621973929236395, 0.00016586315029833382], i(@r3[i]) = [0.00020627965298612374, 0.00018621973929236512, 0.00017054551983135908], i(@r4[i]) = [0.00018212801872638553, 0.00018621973929236517, 0.00018941688794930241], i(@r5[i]) = [0.00018212801872638333, 0.00018621973929236395, 0.00018941688794929979], i(@r6[i]) = [0.00018812052948256094, 0.00018621973929236493, 0.00018473451841627864], i(@r7[i]) = [0.000005992510756175733, 6.217248937900877e-20, -0.000004682369533023447]; v(n1) = 9, v(n2) = 6.206703910614529, v(n3) = 6.145251396648049, v(n4) = 6.2067039106145225, v(n5) = 6.145251396648042, i(v1) = -0.00037243947858473, i(@r1[i]) = 0.00018621973929236477, i(@r2[i]) = 0.00018621973929236395, i(@r3[i]) = 0.00018621973929236512, i(@r4[i]) = 0.00018621973929236517, i(@r5[i]) = 0.00018621973929236395, i(@r6[i]) = 0.00018621973929236493, i(@r7[i]) = 6.217248937900877e-20
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: res-sweep = [10000, 15000, 20000], v(n1) = [9, 9, 9], v(n2) = [6.877278362577043, 6.206703910614529, 5.6827369940333], v(n3) = [6.807228548542084, 6.145251396648049, 5.62800215443485], v(n4) = [6.268079719104217, 6.2067039106145225, 6.158746680760464], v(n5) = [6.207977472924511, 6.145251396648042, 6.096239107737195], i(v1) = [-0.0003944001824686815, -0.00037243947858473, -0.00035528003824763724], i(@r1[i]) = [0.00021227216374229574, 0.00018621973929236477, 0.00016586315029833498], i(@r2[i]) = [0.00021227216374229872, 0.00018621973929236395, 0.00016586315029833382], i(@r3[i]) = [0.00020627965298612374, 0.00018621973929236512, 0.00017054551983135908], i(@r4[i]) = [0.00018212801872638553, 0.00018621973929236517, 0.00018941688794930241], i(@r5[i]) = [0.00018212801872638333, 0.00018621973929236395, 0.00018941688794929979], i(@r6[i]) = [0.00018812052948256094, 0.00018621973929236493, 0.00018473451841627864], i(@r7[i]) = [0.000005992510756175733, 6.217248937900877e-20, -0.000004682369533023447]; v(n1) = 9, v(n2) = 6.206703910614529, v(n3) = 6.145251396648049, v(n4) = 6.2067039106145225, v(n5) = 6.145251396648042, i(v1) = -0.00037243947858473, i(@r1[i]) = 0.00018621973929236477, i(@r2[i]) = 0.00018621973929236395, i(@r3[i]) = 0.00018621973929236512, i(@r4[i]) = 0.00018621973929236517, i(@r5[i]) = 0.00018621973929236395, i(@r6[i]) = 0.00018621973929236493, i(@r7[i]) = 6.217248937900877e-20
```

Added after the critic of round 4 of the re-check's fixes (13 November 2026) (C9v.8): the bridge of C9 with ".dc V1 0 9 9 V2 0 1 1", a sweep of two sources. ngspice runs V1 from 0 to 9 V for each value of V2, which it starts at 0 and steps by adding 1 V; its last point is V1 = 9 V and V2 = 1 V, the .op's own state. The .op is decided exactly, R5 0 A, and so is that point: "ngspice gave i(@r5[i]) -8.881784e-19 A at V1 = 9 V, V2 = 1 V", and the sweep's words give "i(@r5[i]) = 0 A" at the last point; the other three points keep ngspice's numbers. The same doubles in native 47, native 42 and our engine.

```spice
* the C9 bridge, .op and a sweep of two sources
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
V2 x 0 1
R6 x 0 1k
.options savecurrents
.op
.dc V1 0 9 9 V2 0 1 1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        x                                1.000000e+00
        b                                4.500000e+00
        a                                4.500000e+00
        top                              9.000000e+00
        @r6[i]                           1.000000e-03
        @r5[i]                           -8.88178e-19
        @r4[i]                           9.574468e-04
        @r3[i]                           9.574468e-04
        @r2[i]                           4.500000e-04
        @r1[i]                           4.500000e-04
        v1#branch                        -1.40745e-03
        v2#branch                        -1.00000e-03
  rawfile from ngspice -b -r (exit 0): v(v-sweep) = [0, 9, 0, 9], v(top) = [0, 9, 0, 9], v(a) = [0, 4.499999999999999, 0, 4.499999999999999], v(b) = [0, 4.5, 0, 4.5], v(x) = [0, 0, 1, 1], i(v2) = [0, 0, -0.001, -0.001], i(v1) = [0, -0.0014074468085106386, 0, -0.0014074468085106386], i(@r1[i]) = [0, 0.0004500000000000001, 0, 0.0004500000000000001], i(@r2[i]) = [0, 0.00044999999999999993, 0, 0.00044999999999999993], i(@r3[i]) = [0, 0.0009574468085106382, 0, 0.0009574468085106382], i(@r4[i]) = [0, 0.0009574468085106382, 0, 0.0009574468085106382], i(@r5[i]) = [0, -8.881784197001253e-19, 0, -8.881784197001253e-19], i(@r6[i]) = [0, 0, 0.001, 0.001]; v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, v(x) = 1, i(v2) = -0.001, i(v1) = -0.0014074468085106386, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19, i(@r6[i]) = 0.001
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(v-sweep) = [0, 9, 0, 9], v(top) = [0, 9, 0, 9], v(a) = [0, 4.499999999999999, 0, 4.499999999999999], v(b) = [0, 4.5, 0, 4.5], v(x) = [0, 0, 1, 1], i(v2) = [0, 0, -0.001, -0.001], i(v1) = [0, -0.0014074468085106386, 0, -0.0014074468085106386], i(@r1[i]) = [0, 0.0004500000000000001, 0, 0.0004500000000000001], i(@r2[i]) = [0, 0.00044999999999999993, 0, 0.00044999999999999993], i(@r3[i]) = [0, 0.0009574468085106382, 0, 0.0009574468085106382], i(@r4[i]) = [0, 0.0009574468085106382, 0, 0.0009574468085106382], i(@r5[i]) = [0, -8.881784197001253e-19, 0, -8.881784197001253e-19], i(@r6[i]) = [0, 0, 0.001, 0.001]; v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.5, v(x) = 1, i(v2) = -0.001, i(v1) = -0.0014074468085106386, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106382, i(@r4[i]) = 0.0009574468085106382, i(@r5[i]) = -8.881784197001253e-19, i(@r6[i]) = 0.001
```

### C9w. After the last pass: lines that leave the operating point as it is are solved exactly, an ammeter in series with a resistor ngspice gives 0 A carries 0 by the rule too, and the rule says which tiny values it cannot tell from noise

Added after the last pass before milestone 2's release (13 November 2026; regress-1). The bridge of C9 read by a 0 V
ammeter, Vm, in series with R5. ngspice gives R5 exactly 0 A (its two ends one double, 4.499999999999999) and Vm
−2.168e−19 A; the circuit makes both exactly 0. With a .temp line, a DC value written beside a transient function, or
m=1 on a resistor, ngspice gives every vector the same double as without them, in native 47 and 42, each change alone
and all together (also `.temp 27`, `.temp −40`, `.options temp=-40`, a PULSE, a PWL or an EXP beside the DC value, "9
SIN(0 1 1k)" and "SIN(9 1 1k) DC 9"; and in a circuit of every kind PlainSpice models, an E, a G, an F, an H, a C, an L
and an I among them, at −40 °C, 27 °C and 150 °C, its .op, .dc and .tf). Before, each of these lines left the circuit to
the rule for other circuits, which drew "Vm measures 2.168e-19 A" beside "R5: no current", alone in series at node m,
with no note. Now PlainSpice models each exactly (still behind the check that ngspice simulated this circuit, decision
0015): Vm is 0 A with the note.

```spice
* the bridge of C9 with an ammeter, a .temp line, a SIN beside V1's DC value and m=1 on R5
V1 top 0 DC 9 SIN(9 1 1k)
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a m 1k m=1
Vm m b 0
.temp 100
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
          m                                4.500000e+00
          b                                4.500000e+00
          a                                4.500000e+00
          top                              9.000000e+00
          @r5[i]                           0.000000e+00
          @r4[i]                           9.574468e-04
          @r3[i]                           9.574468e-04
          @r2[i]                           4.500000e-04
          @r1[i]                           4.500000e-04
          v1#branch                        -1.40745e-03
          vm#branch                        -2.16840e-19
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.499999999999999, v(m) = 4.499999999999999, i(vm) = -2.168404344971009e-19, i(v1) = -0.0014074468085106388, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106385, i(@r4[i]) = 0.0009574468085106381, i(@r5[i]) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.499999999999999, v(m) = 4.499999999999999, i(vm) = -2.168404344971009e-19, i(v1) = -0.0014074468085106388, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106385, i(@r4[i]) = 0.0009574468085106381, i(@r5[i]) = 0
```

```text
  words (describe.ts): Vm measures no current; the note: "ngspice gave Vm -2.168404e-19 A. That is rounding noise,
  what its arithmetic leaves of a current that is 0: every other current at node m is 0, and the currents at a node
  add up to 0. Solved exactly, with fractions, from the netlist's values, the circuit makes it exactly 0, so
  PlainSpice shows 0 A."
```

Added after the last pass (13 November 2026) (C9w.2): the same bridge with ngspice's own gmin written out, a line
PlainSpice does not model exactly, so the rule for other circuits decides: the same doubles again. The rule now takes
a source whose only partner at a node is a resistor that ngspice gives exactly 0 A, its two ends one double, as
carrying 0 (the page shows 0 V across that resistor and no current through it), as b060bc8 did: Vm is 0 A with the
rule's note.

```spice
* the bridge of C9 with an ammeter, with ngspice's own gmin written out
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a m 1k
Vm m b 0
.options gmin=1e-12
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
          m                                4.500000e+00
          b                                4.500000e+00
          a                                4.500000e+00
          top                              9.000000e+00
          @r5[i]                           0.000000e+00
          @r4[i]                           9.574468e-04
          @r3[i]                           9.574468e-04
          @r2[i]                           4.500000e-04
          @r1[i]                           4.500000e-04
          v1#branch                        -1.40745e-03
          vm#branch                        -2.16840e-19
  rawfile from ngspice -b -r (exit 0): v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.499999999999999, v(m) = 4.499999999999999, i(vm) = -2.168404344971009e-19, i(v1) = -0.0014074468085106388, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106385, i(@r4[i]) = 0.0009574468085106381, i(@r5[i]) = 0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(top) = 9, v(a) = 4.499999999999999, v(b) = 4.499999999999999, v(m) = 4.499999999999999, i(vm) = -2.168404344971009e-19, i(v1) = -0.0014074468085106388, i(@r1[i]) = 0.0004500000000000001, i(@r2[i]) = 0.00044999999999999993, i(@r3[i]) = 0.0009574468085106385, i(@r4[i]) = 0.0009574468085106381, i(@r5[i]) = 0
```

```text
  words (describe.ts): Vm measures no current; the note ends "It is below 1 pA, ngspice's current tolerance (its
  abstol option), so PlainSpice shows 0 A."
```

Added after the last pass (13 November 2026) (C9w.3): the ladder of C9n read through a 1 µΩ wire, a 0 V ammeter and a
1 TΩ meter, on the rule path. A real 0.73 aA flows through all three, but ngspice gives the wire exactly 0 A, its two
ends one double. The rule takes Vm as 0 at p, then gives its number back at q, where Rvm's current is shown (the
currents shown at a node add up to 0): Vm keeps its real 7.324e−19 A. Node q has the very double of n3, which R6's
61 nA to ground proves real, so q is real; since the critic of the last pass's fixes, a node proven real proves the
current of a resistor from it to ground too, its voltage over its resistance, so Rvm's 7.324e−19 A is real, and Vm's
with it (the only two currents at q). No note calls them maybe noise (one did, "2 currents may be rounding noise",
beside q's real 732.4 nV). Solved exactly (without the gmin line) they are real too, and the wire's 7.324e−19 A is
shown exactly (C9n). Since the critic of round 2 of the last pass's fixes, the rule gives the wire that current too: Vm,
the only other part at node p, carries a current proven real, so by Kirchhoff's law the wire, which ngspice gives as
exactly 0 A, carries it as well, and a note says why (it was drawn "no current" beside Vm's 7.324e−19 A).

```spice
* the C9n ladder read through a 1 uohm wire, a 0 V ammeter and a 1 Tohm meter, with ngspice's own gmin written out
V1 n0 0 1.5
R1 n0 n1 1.5k
R2 n1 0 12
R3 n1 n2 1.5k
R4 n2 0 12
R5 n2 n3 1.5k
R6 n3 0 12
R7 n3 n4 1.5k
R8 n4 0 12
Rw n3 p 1u
Vm p q 0
Rvm q 0 1t
.options gmin=1e-12
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
          q                                7.324215e-07
          p                                7.324215e-07
          n4                               5.812869e-09
          n3                               7.324215e-07
          n2                               9.301172e-05
          n1                               1.181176e-02
          n0                               1.500000e+00
          @rvm[i]                          7.324215e-19
          @rw[i]                           0.000000e+00
          @r8[i]                           4.844058e-10
          @r7[i]                           4.844058e-10
          @r6[i]                           6.103513e-08
          @r5[i]                           6.151953e-08
          @r4[i]                           7.750977e-06
          @r3[i]                           7.812496e-06
          @r2[i]                           9.843130e-04
          @r1[i]                           9.921255e-04
          v1#branch                        -9.92125e-04
          vm#branch                        7.324215e-19
  rawfile from ngspice -b -r (exit 0): v(n0) = 1.5, v(n1) = 0.011811755997793995, v(n2) = 9.301171983709262e-05, v(n3) = 7.324215167679475e-07, v(n4) = 5.812869180697997e-09, v(p) = 7.324215167679475e-07, v(q) = 7.324215167679475e-07, i(vm) = 7.324215167679474e-19, i(v1) = -0.0009921254960014707, i(@r1[i]) = 0.0009921254960014707, i(@r2[i]) = 0.0009843129998161663, i(@r3[i]) = 7.812496185304601e-06, i(@r4[i]) = 7.750976653091051e-06, i(@r5[i]) = 6.151953221354978e-08, i(@r6[i]) = 6.103512639732895e-08, i(@r7[i]) = 4.844057650581663e-10, i(@r8[i]) = 4.844057650581663e-10, i(@rw[i]) = 0, i(@rvm[i]) = 7.324215167679474e-19
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n0) = 1.5, v(n1) = 0.011811755997793995, v(n2) = 9.301171983709262e-05, v(n3) = 7.324215167679475e-07, v(n4) = 5.812869180697997e-09, v(p) = 7.324215167679475e-07, v(q) = 7.324215167679475e-07, i(vm) = 7.324215167679474e-19, i(v1) = -0.0009921254960014707, i(@r1[i]) = 0.0009921254960014707, i(@r2[i]) = 0.0009843129998161663, i(@r3[i]) = 7.812496185304601e-06, i(@r4[i]) = 7.750976653091051e-06, i(@r5[i]) = 6.151953221354978e-08, i(@r6[i]) = 6.103512639732895e-08, i(@r7[i]) = 4.844057650581663e-10, i(@r8[i]) = 4.844057650581663e-10, i(@rw[i]) = 0, i(@rvm[i]) = 7.324215167679474e-19
```

```text
  words (describe.ts): Rw: 7.324e-19 A from node n3 to node p, with the note "Rw's current is not 0, though ngspice gave 0:
  ngspice gave Rw exactly 0 A. But Vm, the only other part at node p, carries 7.324e-19 A, and the currents at a node add
  up to 0, so Rw carries 7.324e-19 A too. Rw's two ends, node n3 and node p, come out as the same number: …"; Vm
  measures 7.324e-19 A flowing from node p to node q; Rvm 7.324e-19 A; no note that they may be rounding noise
```

Added after the last pass (13 November 2026) (C9w.4; carrier-zero-beside-own-noise): a G of 10⁶ S reads a 1e15 Ω
resistor that the circuit makes carry no current (its far end holds only a capacitor), so G1 makes exactly 0 A, node g
is at 1 nA × 820 kΩ = 820 µV and R3 carries 1 nA. ngspice gives n and f2 one step of a double apart (4.4e−16 V), which
G1 turns into 444.1 pA: node g 1.465 mV and R3 1.786 nA, 79 % off. The floor of node g, G1's gain times the rounding
of what it reads, excused the gap, the run was decided exactly, and the page drew "G1: no current" beside the 1.465 mV
its own rounding makes, with no warning. Since the last pass a value drawn with other digits than its exact value and
more than 5e−5 from it is off on the page, whatever its floor: the run is shown as ngspice gives it, G1's 444.1 pA
too, with the warning: "Solved exactly, with fractions, from the netlist's values, G1 carries no current, where ngspice
gives 444.1 pA; R1 carries no current, where ngspice gives 4.441e-31 A; node g is at 820 µV, where ngspice gives
1.465 mV; and R3 carries 1 nA, where ngspice gives 1.786 nA. …"

```spice
* a G of 1e6 S reads a 1e15 ohm resistor that carries no current; its load holds a 1 aA source
V1 top 0 3.3
Rw top f1 100u
Va f1 n 0
R2 n 0 150
R1 n f2 1e15
C1 f2 0 1p
G1 0 g n f2 1e6
R3 g 0 820k
I1 0 g 1n
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
          g                                1.464844e-03
          f2                               3.299998e+00
          n                                3.299998e+00
          f1                               3.299998e+00
          top                              3.300000e+00
          @i1[current]                     1.000000e-09
          @r3[i]                           1.786395e-09
          @g1[i]                           4.440892e-10
          @c1[i]                           0.000000e+00
          @r1[i]                           4.440892e-31
          @r2[i]                           2.199999e-02
          @rw[i]                           2.199999e-02
          v1#branch                        -2.20000e-02
          va#branch                        2.199999e-02
  rawfile from ngspice -b -r (exit 0): v(n) = 3.2999978000014667, v(f2) = 3.2999978000014663, v(g) = 0.00146484375, i(@r1[i]) = 4.4408920985006265e-31, i(@g1[i]) = 4.440892098500626e-10, i(@r3[i]) = 1.7863948170731707e-09
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n) = 3.2999978000014667, v(f2) = 3.2999978000014663, v(g) = 0.00146484375, i(@r1[i]) = 4.4408920985006265e-31, i(@g1[i]) = 4.440892098500626e-10, i(@r3[i]) = 1.7863948170731707e-09
```

Added after the last pass (13 November 2026) (C9w.5; silent-rule-same-circuit-check): the two equal arms of C9m fed
through a 1 µΩ wire, 1 GΩ and two 0 V ammeters. ngspice's solution leaves 1.9 µV across the 0 V ammeter Va (s at
8.99999998865194 V, v3 at 9.000001907348633 V): its values leave 1.07e−7 of the sizes of the exact equations, beyond the
same-circuit check's 2⁻³⁰, and the run went to the rule, which drew R7's exact 0 as −5.329e−20 A with an arrow and said
nothing. Yet every answer is drawn with its exact digits (n1 "9 V" for 8.99999998865…). What ngspice's arithmetic
leaves of the equations grows with how far apart the circuit's conductances are, here 1e15 (1 µΩ beside 1 GΩ); the check
now allows its share that many times over, the products of the R, F, G and I keeping their own (a run of another
circuit, R2 1 ppm off, still fails there), and the run is judged by what the page draws: decided exactly, R7 0 A with
the note.

```spice
* C9m's two equal arms fed through a 1 uOhm wire, a 1 GOhm resistor and two 0 V ammeters
V1 top 0 9
Rw top s 1u
Rg s 0 1g
Va s v3 0
Vb v3 n1 0
Rl n1 0 820
R1 n1 n2 15k
R2 n2 n3 330
R3 n3 0 33k
R4 n1 n4 15k
R5 n4 n5 330
R6 n5 0 33k
R7 n3 n5 100k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
          n5                               6.145253e+00
          n4                               6.206705e+00
          n3                               6.145253e+00
          n2                               6.206705e+00
          n1                               9.000002e+00
          v3                               9.000002e+00
          s                                9.000000e+00
          top                              9.000000e+00
          @r7[i]                           -5.32907e-20
          @r6[i]                           1.862198e-04
          @r5[i]                           1.862198e-04
          @r4[i]                           1.862198e-04
          @r3[i]                           1.862198e-04
          @r2[i]                           1.862198e-04
          @r1[i]                           1.862198e-04
          @rl[i]                           1.097561e-02
          @rg[i]                           9.000000e-09
          @rw[i]                           1.134806e-02
          v1#branch                        -1.13481e-02
          va#branch                        1.134805e-02
          vb#branch                        1.134805e-02
  rawfile from ngspice -b -r (exit 0): v(s) = 8.99999998865194, v(v3) = 9.000001907348633, v(n1) = 9.000001907348633, v(n3) = 6.145252698996582, v(n5) = 6.145252698996587, i(va) = 0.011348050087690353, i(@r7[i]) = -5.329070518200752e-20
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(s) = 8.99999998865194, v(v3) = 9.000001907348633, v(n1) = 9.000001907348633, v(n3) = 6.145252698996582, v(n5) = 6.145252698996587, i(va) = 0.011348050087690353, i(@r7[i]) = -5.329070518200752e-20
```

Added after the last pass (13 November 2026) (C9w.6): C9m with a .save line that keeps the link and its two ends.
ngspice gives only those three values, so no equation can be checked; they are judged by the page's digits alone (only
where a .save line explains the missing values, and with no diode, whose current only the other values would give):
v(n3) and v(n5) are drawn with their exact digits, so R7 is 0 A with the note, where the rule drew 6.217e−20 A.

```spice
* C9m with a .save line naming the link and its ends
V1 n1 0 9
R1 n1 n2 15k
R2 n2 n3 330
R3 n3 0 33k
R4 n1 n4 15k
R5 n4 n5 330
R6 n5 0 33k
R7 n3 n5 100k
.save v(n3) v(n5) @r7[i]
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
          n5                               6.145251e+00
          n4                               6.206704e+00
          n3                               6.145251e+00
          n2                               6.206704e+00
          n1                               9.000000e+00
          @r7[i]                           6.217249e-20
          v1#branch                        -3.72439e-04
  rawfile from ngspice -b -r (exit 0): v(n3) = 6.145251396648049, v(n5) = 6.145251396648042, i(@r7[i]) = 6.217248937900877e-20
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(n3) = 6.145251396648049, v(n5) = 6.145251396648042, i(@r7[i]) = 6.217248937900877e-20
```

Added after the last pass (13 November 2026) (C9w.7): the 1 nΩ wire of C9n.4, its .op and a sweep of 6001 points. At
V1 = 1.125 V, a point the sweep checks, ngspice gives the wire's two ends a step of a double apart, so its current is
that step over 1 nΩ, 433.7 pA, where 340.6 pA flows; at most points (V1 = 1.5 V among them) it gives exactly 0. No
floor excuses other digits since the last pass, so the sweep is not decided exactly: it is shown as ngspice gives it,
with a warning, "Solved exactly, with fractions, from the netlist's values, at V1 = 1.125 V, R3 carries 340.6 pA, where
ngspice gives 433.7 pA. … PlainSpice shows the sweep as ngspice gives it, but at ngspice's point nearest the operating
point's 1.5 V, 1.5000000000000846 V (its 250 µV step added up in doubles), where it shows what the operating point
shows, so its numbers may not agree with each other." (It said "but at V1 = 1.5 V, the operating point's own state"
until the critic of round 2 of the last pass's fixes: that point is not the .op's state bit for bit; every value there
reads as the .op shows it, which is what makes it stand for that state, C9y.) The .op beside it
is decided on its own, exactly, with R3's 454.1 pA. The sweep's last point is at 1.5000000000000846 V, a few steps of a
double from the .op's own 1.5 V (ngspice adds its step once a point); since the critic of the last pass's fixes it is
taken as the .op's state, judged at its own x, and shows R3's exact 454.1 pA with the note, where it showed ngspice's
0 A beside the .op's 454.1 pA (C9x.4).

```spice
* the 1 nohm wire of C9n.4, its .op and a long sweep
V1 top1 0 1.5
R1 top1 d2 270k
R2 d2 0 820
R3 d2 p3 1n
R4 p3 0 10meg
.options savecurrents
.op
.dc V1 0 1.5 0.00025
.end
```

```text
ngspice 47, ngspice -b -r out.raw (exit 0; plain ngspice -b runs no .dc without a .print line), at V1 = 1.125 V and 1.5000000000000846 V, then the .op:
  rawfile: v(d2) = [0.0034060157214275306, 0.004541354295237127], v(p3) = [0.00340601572142753, 0.004541354295237127], i(@r3[i]) = [4.336808689942017e-10, 0], i(@r4[i]) = [3.40601572142753e-10, 4.541354295237127e-10], v(d2) = 0.0045413542952368715, v(p3) = 0.0045413542952368715, i(@r3[i]) = 0, i(@r4[i]) = 4.5413542952368713e-10
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
ngspice 42: the same exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: v(d2) = [0.0034060157214275306, 0.004541354295237127], v(p3) = [0.00340601572142753, 0.004541354295237127], i(@r3[i]) = [4.336808689942017e-10, 0], i(@r4[i]) = [3.40601572142753e-10, 4.541354295237127e-10], v(d2) = 0.0045413542952368715, v(p3) = 0.0045413542952368715, i(@r3[i]) = 0, i(@r4[i]) = 4.5413542952368713e-10
```

Added after the last pass (13 November 2026) (C9w.8): a reverse diode beside a 1 nV divider. D1 sits from d3 (near
0 V) to s2 (500 mV), so it leaks is plus gmin times 0.5 V, 510 fA, into R5 through the 0 V ammeter V2, and node d3 sits
at 510 fV; the divider V3, R7, R8 carries 500 fA and puts n2 at 500 pV. Every one of these is below abstol or vntol.
PlainSpice takes a diode's current only from ngspice's numbers (C9t), and the values worked out with it here come out
with other digits than ngspice's; each hangs on that current, so no warning can name it, and the rule decides with the
exact solution beside it. Until now that dropped the note the rule writes for the tiny values it cannot tell
from noise, so "V2 measures 510 fA" and "node d3 510 fV" were drawn as answers with nothing said. Now the note stays:
"3 currents and 3 node voltages may be rounding noise", "ngspice gave R3 4.249949e-18 A, V2 5.099939e-13 A,
R5 5.099939e-13 A, node d3 5.099939e-13 V and 2 more node voltages, each in the tables above. …". It leaves out what
the exact solution shows real whatever current the diode carries: the divider's 500 fA and n2's 500 pV (by the rule
alone, with ngspice's own gmin written out, the note names 6 currents and 4 node voltages), and what a warning names
when one is shown.

```spice
* a reverse diode's leak beside a 1 nV divider: the exact solution keeps the run's tiny values as ngspice gives them
V1 top1 0 0.5
R1 top1 s2 1m
R2 s2 0 1e12
D1 d3 s2 dmod
R3 d3 0 120k
R4 d3 x4 1.2
C1 x4 0 1n
V2 d3 v5 0
R5 v5 0 1
F1 0 f6 V1 1m
R6 f6 0 10
V3 n1 0 1n
R7 n1 n2 1k
R8 n2 0 1k
.model dmod D(is=1e-14)
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b -r out.raw (exit 0):
  rawfile: v(d3) = 5.099938892338058e-13, v(x4) = 5.099938892338058e-13, v(v5) = 5.099938892338058e-13, v(n2) = 5.000000000000001e-10, i(v2) = 5.099938892338058e-13, i(v3) = -5e-13, i(@d1[id]) = -5.099981391828827e-13, i(@r3[i]) = 4.2499490769483816e-18, i(@r5[i]) = 5.099938892338058e-13, i(@r7[i]) = 4.999999999999999e-13, i(@r8[i]) = 5.000000000000002e-13
ngspice 42: the same exit code and rawfile values as ngspice 47 (its -b printout lists fewer diode model parameters)
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: the same doubles as ngspice 47
```

Added after the last pass (13 November 2026) (C9w.9; silent-rule-same-circuit-check, the skeptic's P1-1n): a 1 nΩ
wire into two 0 V ammeters in series and an 820 Ω load. ngspice puts c and d at 8.999404907226562 V, where the circuit
puts them at 8.999999999989024 V, and gives the ammeters 10.974884 mA, where 10.975610 mA flows, as through the wire
(10.98 mA): its arithmetic loses most of its digits beside the wire's 10⁹ S. Its numbers then left 1.07e−7 of the
equations' sizes and more, past the same-circuit check's 2⁻³⁰, and the rule decided alone with nothing said: "9 V",
"8.999 V", the wire's 10.98 mA beside "Vm1 measures 10.97 mA". The check now allows what the spread of the circuit's
conductances lets ngspice's rounding leave, and judges the run by the page's digits: here the warning "Some of
ngspice's answers here are off", "… V1 carries 10.98 mA, where ngspice gives 10.97 mA; Vm1 carries 10.98 mA, where
ngspice gives 10.97 mA; …", and the page shows ngspice's numbers.

```spice
* a 1 nohm wire into two 0 V ammeters in series (the skeptic of the last pass, P1-1n)
V1 a 0 9
Rw a b 1n
Vm1 b c 0
Vm2 c d 0
Rl d 0 820
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b -r out.raw (exit 0):
  rawfile: v(a) = 9, v(b) = 8.999999999989024, v(c) = 8.999404907226562, v(d) = 8.999404907226562, i(vm2) = 0.010974884033203125, i(vm1) = 0.010974884033203125, i(v1) = -0.010974884033203125, i(@rw[i]) = 0.010976108910654146, i(@rl[i]) = 0.010974884033203125
ngspice 42: the same exit code and rawfile values as ngspice 47 (its -b printout lists the source's settings in another layout)
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: the same doubles as ngspice 47
```

Added after the last pass (13 November 2026) (C9w.10 to C9w.12; tf-lost-ratio-contradiction): the .tf ratio judged
as the .op beside it is. C9w.10 is C9n.5 with ".tf v(d2,p3) V1". ngspice gives the ratio as exactly 0: with V1 at
1 V, d2 and p3 come out as the same double, as in its .op. The circuit makes it 3.028e−19 V/V (the wire's 1 nΩ over
the divider's resistance), and the .op beside it, decided exactly, shows R3's 454.1 pA, whose card says "V(d2) −
V(p3) = 4.541e−19 V": "v(d2,p3)/V1 = 0 V/V" beside it contradicted the page. The ratio is now shown as the exact
3.028e−19 V/V, the Numbers panel keeps ngspice's 0.000000e+00 in its own column, and a note says why: "ngspice
gave v(d2,p3)/V1 as exactly 0. The ratio is too small beside the larger numbers ngspice works it out from for its
arithmetic (about 16 significant digits), so it comes out as 0. Solved exactly, with fractions, from the netlist's
values, it is 3.028e-19 V/V, so PlainSpice shows 3.028e-19 V/V." With no .op, a sweep beside the .tf decided
exactly does the same. With nothing beside it decided exactly (C9w.11, a .tf alone of a 100 Ω resistor into
1e20 Ω, which ngspice gives as 0 for 1e−18 V/V; or beside an .op whose answers are off), ngspice's 0 stays, with
the warning "ngspice's transfer function is off": "Solved exactly, with fractions, from the netlist's values,
v(top,s)/V1 is 1e-18 V/V, where ngspice gives 0 V/V. …". A ratio ngspice gives drawn with other digits than the
exact one, and more than 5e−5 from it, gets the same warning (C9w.12: a bridge 1e−14 off balance read through a
chain of resistors, where ngspice gives v(m7,m8)/V1 = 1.11e−16 V/V, one step of a double at 5 V, and the circuit
makes −2.656e−20 V/V). A ratio the circuit makes exactly 0 is decided as before (C9p, C9p.6), and a circuit with a
diode keeps ngspice's ratio (its ratio depends on the diode's conductance at the operating point).

```spice
* C9n.5's 1 n wire in series with 10 meg, with .op, .dc and .tf of the wire's voltage
V1 top1 0 1.5
R1 top1 d2 270k
R2 d2 0 820
R3 d2 p3 1n
R4 p3 0 10meg
.options savecurrents
.op
.dc V1 0 1.5 0.5
.tf v(d2,p3) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0): transfer_function = 0.000000e+00
ngspice 47, ngspice -b -r out.raw (exit 0), the .tf: v(Transfer_function) = 0, v(v1#Input_impedance) = 270819.92615659133, v(output_impedance_at_V(d2,p3)) = 1e-09; the .op: v(d2) = v(p3) = 0.0045413542952368715, i(@r3[i]) = 0, i(@r4[i]) = 4.5413542952368713e-10
ngspice 42: the same exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): the same doubles as ngspice 47
```

```spice
* a 100 ohm resistor feeding a 1e20 ohm load: only the .tf of the voltage across it
V1 top 0 10
R1 top s 100
R2 s 0 1e20
.tf v(top,s) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0): transfer_function = 0.000000e+00
ngspice 47, ngspice -b -r out.raw (exit 0): v(Transfer_function) = 0, v(v1#Input_impedance) = 1e+20, v(output_impedance_at_V(top,s)) = 100
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): the same doubles as ngspice 47
```

```spice
* a bridge 1e-14 off balance read through a chain of resistors, with .tf of one link's voltage
V1 top1 0 5
R1 top1 a2 1.8
R2 a2 0 680
R3 top1 b3 0.18
R4 b3 0 68.0000000000007
R5 a2 m4 2.7k
R6 m4 m5 120
R7 m5 m6 3.3k
R8 m6 m7 4.7meg
R9 m7 m8 4.7k
R10 m8 m9 5.6k
R11 m9 m10 12k
R12 m10 m11 56
R13 m11 b3 68k
.options savecurrents
.op
.tf v(m7,m8) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0): transfer_function = 1.110223e-16
ngspice 47, ngspice -b -r out.raw (exit 0), the .tf: v(Transfer_function) = 1.1102230246251565e-16, v(v1#Input_impedance) = 61.98181818182076, v(output_impedance_at_V(m7,m8)) = 4695.394537384268; the .op: v(m7) = 4.986799647990032, v(m8) = 4.986799647990031
ngspice 42: the same exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): the same doubles as ngspice 47
```

Added after the last pass (13 November 2026) (C9w.13, C9w.14; rule-op-vs-sweep-tf): the bridge of C9 with a .param
line, and beside a transistor, each with its .op and ".dc V1 0 9 3". The rule decides their .op (PlainSpice does not
model a .param line or a transistor exactly) and shows R5's −8.882e−19 A as 0 A, "its two ends at the same voltage";
at V1 = 9 V, the .op's own state, ngspice's sweep gives R5 the very same −8.881784197001253e−19 A, and the sweep's
words and Plot panel showed it there beside the .op's 0. Now the sweep shows 0 at that point too, with a note: "ngspice
gave i(@r5[i]) -8.881784e-19 A at V1 = 9 V. At V1 = 9 V, the operating point's own state, ngspice gives it the very
number the operating point shows as 0, as the operating point's note says. So PlainSpice shows 0 there too, in these
words and in the Plot panel; at the other points the sweep is as ngspice gives it." (Since the critic of round 2 of
the last pass's fixes the note says why each 0 is 0 there, ngspice's very number or the point's own numbers, and no
longer that ngspice gives "the operating point's numbers" there, which beside a transistor it need not.) The other
points keep ngspice's
numbers (at 8.5 V, a step of 0.5 V, R5's −8.882e−19 A stays). Beside the transistor, the .tf of v(a,b) keeps ngspice's
−5.551e−17 V/V: a slope, which the rule cannot decide.

```spice
* the balanced bridge of C9 with a .param line, its .op and a sweep of V1 to its own 9 V
.param rtop=10k rbot=10k
V1 top 0 9
R1 top a {rtop}
R2 a 0 {rbot}
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
.options savecurrents
.op
.dc V1 0 9 3
.end
```

```spice
* the balanced bridge of C9 beside a transistor, with .op and .dc V1 0 9 3
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
Q1 top x 0 qmod
Rx x 0 1meg
.model qmod npn
.options savecurrents
.op
.dc V1 0 9 3
.tf v(a,b) V1
.end
```

```text
ngspice 47, ngspice -b -r out.raw (exit 0), both: the sweep's i(@r5[i]) = [0, 0, 0, -8.881784197001253e-19]; the .op's i(@r5[i]) = -8.881784197001253e-19, v(a) = 4.499999999999999, v(b) = 4.5; beside the transistor, v(Transfer_function) = -5.551115123125783e-17
ngspice 42: the same exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): the same doubles as ngspice 47 (beside the transistor, but for i(@q1[is]) at V1 = 0, which native gives as −0 and our engine as 0)
```

### C9x. After the critic of the last pass's fixes: an amplifier's gain is counted in the check that ngspice simulated this circuit, numbers that cannot be checked are said to be so, a sweep's point at the .op's state is found within its step's rounding, and a .tf beside the rule's .op gets a note

Added after the critic of the last pass's fixes (13 November 2026). An op-amp modelled as an E of high gain: ngspice's
arithmetic, which leaves a step of a double at the E's inputs, lifts it by the gain at the output, so its numbers can be
far from the circuit's, and they leave much of the equations unbalanced (9.2e−3 of their sizes for an E of 1e15, 1.5e−5
for 1e12, 2.4e−8 for 1e9, each about 1e−17 of its gain). The check that ngspice simulated this circuit allowed only
what the spread of its conductances lets ngspice's rounding leave, so these runs went to the rule, which drew node out
9.5 V where the circuit makes 9.15 V, R1 15 mA and R2 15.9 mA in series, with nothing said. The check now also allows
what the circuit's E, F and H amplify (the product of their gains; an H's transresistance times the largest
conductance), and the run is judged by the page's digits: the non-inverting amplifier of gain 2.773 and the difference
amplifier of gain 2 get the warning that names the exact values; the balanced difference amplifier, whose out is
exactly 0 V, is 0 V with the note (it drew "−476.8 nV" and "E1 delivers 119.2 pW").

```spice
* an op-amp as an E of 1e15: a non-inverting amplifier of gain 2.773
V1 in 0 3.3
E1 out 0 in inm 1e15
R1 inm 0 220
R2 out inm 390
Rl out 0 390
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
          inm                              3.300000e+00
          out                              9.500000e+00
          in                               3.300000e+00
          @rl[i]                           2.435897e-02
          @r2[i]                           1.589744e-02
          @r1[i]                           1.500000e-02
          v1#branch                        0.000000e+00
          e1#branch                        -4.02564e-02
  rawfile from ngspice -b -r (exit 0): v(in) = 3.3000000000000003, v(out) = 9.5, v(inm) = 3.299999999999991, i(e1) = -0.04025641025641028, i(v1) = 0, i(@r1[i]) = 0.014999999999999958, i(@r2[i]) = 0.015897435897435922, i(@rl[i]) = 0.02435897435897436
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: the same doubles as ngspice 47
  words (describe.ts): node out: 9.5 V, R2 15.9 mA, as ngspice gives them, with the warning "Some of ngspice's answers
  here are off": "Solved exactly, with fractions, from the netlist's values, R2 carries 15 mA, where ngspice gives
  15.9 mA; E1 carries 38.46 mA, where ngspice gives 40.26 mA; Rl carries 23.46 mA, where ngspice gives 24.36 mA; and
  node out is at 9.15 V, where ngspice gives 9.5 V. …"
```

```spice
* a difference amplifier as an E of 1e12, 2 V and 1.5 V, gain 2
V1 a 0 2
V2 b 0 1.5
R1 a inm 10k
R2 inm out 20k
R3 b inp 10k
R4 inp 0 20k
E1 out 0 inp inm 1e12
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
          inp                              1.000000e+00
          out                              -9.99878e-01
          inm                              1.000000e+00
          b                                1.500000e+00
          a                                2.000000e+00
          @r4[i]                           5.000000e-05
          @r3[i]                           5.000000e-05
          @r2[i]                           9.999390e-05
          @r1[i]                           1.000000e-04
          v1#branch                        -1.00000e-04
          v2#branch                        -5.00000e-05
          e1#branch                        9.999390e-05
  rawfile from ngspice -b -r (exit 0): v(a) = 2, v(b) = 1.5, v(inm) = 1.0000000000009999, v(out) = -0.9998779296875, v(inp) = 1, i(e1) = 9.9993896484425e-05, i(v2) = -5.000000000000001e-05, i(v1) = -9.999999999990001e-05, i(@r1[i]) = 9.999999999990001e-05, i(@r2[i]) = 9.9993896484425e-05, i(@r3[i]) = 5e-05, i(@r4[i]) = 5e-05
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: the same doubles as ngspice 47
  words (describe.ts): node out: −999.9 mV, with the warning: "… node out is at −1 V, where ngspice gives −999.9 mV;
  E1 carries 100 µA, where ngspice gives 99.99 µA; and R2 carries 100 µA, where ngspice gives 99.99 µA. …"
```

```spice
* a balanced difference amplifier as an E of 1e9, 5 V on both inputs
V1 a 0 5
R1 a inm 10k
R2 inm out 10k
R3 a inp 10k
R4 inp 0 10k
E1 out 0 inp inm 1e9
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
          inp                              2.500000e+00
          out                              -4.76837e-07
          inm                              2.500000e+00
          a                                5.000000e+00
          @r4[i]                           2.500000e-04
          @r3[i]                           2.500000e-04
          @r2[i]                           2.500000e-04
          @r1[i]                           2.500000e-04
          v1#branch                        -5.00000e-04
          e1#branch                        2.500000e-04
  rawfile from ngspice -b -r (exit 0): v(a) = 5, v(inm) = 2.5000000000000004, v(out) = -4.76837158203125e-07, v(inp) = 2.5, i(e1) = 0.00025000004768371587, i(v1) = -0.0005, i(@r1[i]) = 0.00024999999999999995, i(@r2[i]) = 0.00025000004768371587, i(@r3[i]) = 0.00025, i(@r4[i]) = 0.00025
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: the same doubles as ngspice 47
  words (describe.ts): node out: 0 V; E1 makes no power; the note "Node out is shown as 0 V: ngspice gave node out
  -4.768372e-07 V. That is rounding noise, … node out is joined to ground through parts with no voltage across them.
  Solved exactly, with fractions, from the netlist's values, the circuit makes it exactly 0, so PlainSpice shows 0 V."
```

Added after the critic of the last pass's fixes (13 November 2026) (C9x.2): conductances more than the largest double
apart, a 1e−12 Ω wire beside 1e300 Ω. Their spread overflowed to infinity, and describing the run stopped with "not a
finite number": the page lost its words. An allowance that large holds whatever ngspice's numbers leave (no equation's
sum is larger than the sum of its terms' sizes), and the run is judged by the page's digits: ngspice's 976.6 µA for V1,
where 1 mA flows, gets the warning.

```spice
* a 1e-12 ohm wire beside 1e300 ohm: conductances more than the largest double apart
V1 a 0 1
R1 a b 1e-12
R2 b 0 1e300
R3 b 0 1k
.options savecurrents
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
          b                                1.000000e+00
          a                                1.000000e+00
          @r3[i]                           1.000000e-03
          @r2[i]                          1.000000e-300
          @r1[i]                           9.992007e-04
          v1#branch                        -9.76562e-04
  rawfile from ngspice -b -r (exit 0): v(a) = 1, v(b) = 0.999999999999999, i(v1) = -0.0009765625, i(@r1[i]) = 0.0009992007221626409, i(@r2[i]) = 9.99999999999999e-301, i(@r3[i]) = 0.000999999999999999
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0):
  vectors: the same doubles as ngspice 47
  words (describe.ts): the warning "… V1 carries 1 mA, where ngspice gives 976.6 µA; and R1 carries 1 mA, where ngspice
  gives 999.2 µA. …"
```

Added after the critic of the last pass's fixes (13 November 2026) (C9x.3): S28's "+ 3" after .end continues R1, so
ngspice's R1 is 3 Ω and n1 is at 3 V, where the circuit PlainSpice reads has R1 2 Ω. ngspice's numbers then leave a
fifth of Kirchhoff's law at n1 unbalanced, far past what its arithmetic can leave in a circuit whose conductances are
alike and which amplifies nothing. Treated as ngspice's lost digits, the page would say "node n1 is at 2 V, where ngspice
gives 3 V", which is false. Where ngspice's numbers agree with their own products (here there are none) but not with the
equations of the circuit PlainSpice reads, past that allowance, the rule decides, as for another circuit, and a note
says the numbers could not be checked: it was the rule with nothing said. With diodes, whose currents ngspice settles to
its tolerances only, such leftovers say neither, and the rule decides with its own notes.

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
  words (describe.ts): node n1: 3 V; the note "PlainSpice could not check ngspice's numbers": "ngspice's numbers in the
  operating point do not fit the circuit PlainSpice reads from this netlist: the currents at one of its nodes do not add
  up to 0, or a source does not make what it is written to make, by more than ngspice's arithmetic can leave. Either
  ngspice lost most of its digits solving this circuit, or it reads a line of the netlist otherwise than PlainSpice does.
  So PlainSpice shows ngspice's numbers as it gives them, finding rounding noise from those numbers alone, and they may
  not agree with each other."
```

Added after the critic of the last pass's fixes (13 November 2026) (C9x.4): ngspice adds a sweep's step once a point, in
doubles, so ".dc V1 0 9 0.01" ends at 8.999999999999853 V, not 9 V; the page names that point "V1 = 9 V". There ngspice
gives R5 of C9's bridge the very −8.881784197001253e−19 A of its .op. Beside the .op the rule decides (a .param line, a
transistor, a .control block), the sweep's point at the .op's own state was found only where ngspice's x is the netlist's
9 bit for bit, so the sweep said "At V1 = 9 V: … i(@r5[i]) = −8.882e-19 A" beside the .op's "R5: no current". It is now
found within what that adding up can leave (a few steps of a double for each point, within a quarter of the step): R5 is
0 A there too, with the note. On the exact path such a point is judged at its own x, as every other point of a sweep
the exact solution decides: C9w.7's last point, 1.5000000000000846 V, shows R3's exact 454.1 pA. Since the critic of
round 2 of these fixes, such a point stands for the .op's state only where every value it shows reads as the .op shows
it (here: R5's 0, v(a) and v(b) 4.5 V, …, though only R5's double is the .op's: v(a) is 4.499999999999926 there, not
4.499999999999999), and the note says what it is: "ngspice's point nearest the operating point's 9 V, 8.999999999999853 V
(its 10 mV step added up in doubles)", no longer "the operating point's own state, where ngspice gives the operating
point's numbers" (C9y).

```spice
* the balanced bridge of C9 with a .param line, its .op and a sweep of V1 in 0.01 V steps
.param rtop=10k
V1 top 0 9
R1 top a {rtop}
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
.options savecurrents
.op
.dc V1 0 9 0.01
.end
```

```text
ngspice 47, ngspice -b (exit 0), the .op:
          b                                4.500000e+00
          a                                4.500000e+00
          @r5[i]                           -8.88178e-19
ngspice 47, ngspice -b -r out.raw (exit 0), the sweep's last two points, then the .op: v(v-sweep) = [8.989999999999853, 8.999999999999853], v(a) = [4.4949999999999255, 4.499999999999926], v(b) = [4.4949999999999255, 4.499999999999927], i(@r5[i]) = [0, -8.881784197001253e-19], v(a) = 4.499999999999999, v(b) = 4.5, i(@r5[i]) = -8.881784197001253e-19
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): the same doubles as ngspice 47
  words (describe.ts): "At V1 = 9 V: … i(@r5[i]) = 0 A", with the note "ngspice gave i(@r5[i]) -8.881784e-19 A at
  V1 = 9 V. At ngspice's point nearest the operating point's 9 V, 8.999999999999853 V (its 10 mV step added up in
  doubles), ngspice gives it the very number the operating point shows as 0, as the operating point's note says. …"
```

Added after the critic of the last pass's fixes (13 November 2026) (C9x.5): beside an .op the rule decides, the .tf of C9's
bridge beside a transistor gives v(a,b)/V1 = −5.551115123125783e−17, a step of a double at 0.5 V/V, while the .op's note
says that node a and node b are at the same voltage. A ratio is a slope, which the rule cannot decide, so it stays
ngspice's; but where the .op beside it shows its output as 0 (or as maybe noise itself) and the ratio is less than
RESIDUAL_SHARE, about a billionth, of what its input makes of itself in the output's unit (a volt for each volt; the
input resistance's current or voltage otherwise), a note says it may be rounding noise or a real ratio that small. A
ratio of 0.5 V/V, of 3.6 V/A from a source of 1 aA, or of a ladder's far node that the .op shows real, gets none; where
the .op's own note says the output node's voltage may be rounding noise (a ladder's node the rule cannot prove real),
the .tf's note says so of the ratio too ("In the operating point the voltage at node n6 may itself be rounding noise").

```spice
* the balanced bridge of C9 beside a transistor, with .op and .tf v(a,b) V1
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a b 1k
Q1 top x 0 qmod
Rx x 0 1meg
.model qmod npn
.options savecurrents
.op
.tf v(a,b) V1
.end
```

```text
ngspice 47, ngspice -b (exit 0):
  transfer_function = -5.55112e-17
  output_impedance_at_v(a,b) = 8.802395e+02
  v1#input_impedance = 6.394558e+03
  rawfile from ngspice -b -r (exit 0): v(a) = 4.499999999999999, v(b) = 4.5, i(@r5[i]) = -8.881784197001253e-19, v(Transfer_function) = -5.551115123125783e-17, v(v1#Input_impedance) = 6394.5577413485535
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): the same doubles as ngspice 47
  words (describe.ts): "v(a,b)/V1 = −5.551e-17 (V/V)", with the note "The transfer function may be rounding noise":
  "ngspice gave v(a,b)/V1 = -5.551115e-17. In the operating point node a and node b are at the same voltage, and this
  ratio is less than a billionth of a volt for each volt of V1, so it may be rounding noise, what ngspice's arithmetic
  leaves of a ratio that is exactly 0, or a real ratio that small. PlainSpice cannot tell which from ngspice's numbers
  alone, so it shows it as ngspice gives it."
```

Added after the critic of the last pass's fixes (13 November 2026) (C9x.6): a .control block that only runs. ngspice -b
-r runs the netlist's analyses, then the block's run does them again ("Doing analysis" twice), but writes one set of
plots, the very doubles of the same netlist without the block: with an .op alone, and with .op, .dc and .tf. Until now
such a block left the circuit to the rule (the record said, wrongly, that its operating point came out otherwise): C9o
run from it drew "node out: −193.5 nV" and "H1 delivers 37.45 aW". It is now modelled exactly, still behind the check
that ngspice simulated this circuit; any other line in the block (op, set, print, alter, write) still leaves it to the
rule.

```spice
* bridge control
V1 top 0 9
R1 top a 10k
R2 a 0 10k
R3 top b 4.7k
R4 b 0 4.7k
R5 a m 1k
Vm m b 0
.options savecurrents
.op
.dc V1 0 9 3
.tf v(a,b) V1
.control
run
.endc
.end
```

```text
ngspice 47, ngspice -b -r out.raw (exit 0): "Doing analysis at TEMP = 27.000000 and TNOM = 27.000000", "No. of Data Rows : 4", ": 1", ": 1", 'binary raw file "out.raw"', then "Doing analysis …" and the three row counts again for the block's run, with no second results file; the file holds three plots (the .dc, the .op, the .tf), the same doubles as the same netlist without the .control block: v(a) = [0, 1.4999999999999996, 2.999999999999999, 4.499999999999999], i(vm) = [0, -5.421010862427522e-20, -1.0842021724855044e-19, -2.168404344971009e-19], i(@r5[i]) = [0, 0, 0, 0] in the sweep; with only its .op, v(a) = 4.499999999999999, i(vm) = -2.168404344971009e-19, i(@r5[i]) = 0, as without the block
ngspice 42: the same exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): three plots, the same doubles as ngspice 47
  words (describe.ts), C9o run from such a block: node out: 0 V, H1 and Rl no current, with the note "4 currents are
  shown as 0 A, and node out as 0 V", as without the block
```

### C9y. After the critic of round 2 of the last pass's fixes: a sweep's point is named by ngspice's own value where a value there reads otherwise than at the value its steps say, near a series' own 0 the page draws the exact digits, and each part of the circuit gets its own allowance in the check that ngspice simulated it

Added after the critic of round 2 of the last pass's fixes (13 November 2026). V2 holds node b at its own 6 V when V1 is
9 V, so V2 and R3 carry no current there, a source idle at its design point. ngspice adds a sweep's step once a point, in
doubles, so ".dc V1 0 9 0.01" ends at 8.999999999999853 V, 147.4 fV short of 9 V; there V2 and R3 carry a real
(9 V − x) / 4.5 kΩ = 32.76 aA, which ngspice gives as 32.96 aA and 32.86 aA: worked out from node b's 6 V, a value that
small has no 4th digit in ngspice's arithmetic. The page named that point "V1 = 9 V" and warned "at V1 = 9 V, V2 carries
32.76 aA, where ngspice gives 32.96 aA", false at 9 V, where the circuit makes it 0, as the .op beside it shows ("V2: no
current"); the whole sweep was then left as ngspice gives it. Now (1) near a series' own 0, within ANSWER_FLOOR of its
largest size, ngspice's digits are no sign that its answers are off, and the page draws the exact ones, −32.76 aA for
both, with a note, so the sweep is decided exactly; and (2) a value at that point reads otherwise than at 9 V, so the
point is named by ngspice's own value, "At V1 = 8.999999999999853 V: …", with a note that says why. A value tiny along
its whole series, C9h's loop of 2 aA or C9w.7's wire, is held to its own digits as before.

```spice
* V2 holds node b's own 6 V, so R3 carries nothing when V1 is 9 V
V1 a 0 9
R1 a b 3k
R2 b 0 6k
V2 c 0 6
R3 b c 1k
.options savecurrents
.op
.dc V1 0 9 0.01
.end
```

```text
ngspice 47, ngspice -b (exit 0; plain -b runs no .dc without a .print line), the .op:
          @r3[i]                           0.000000e+00
          v2#branch                        0.000000e+00
ngspice 47, ngspice -b -r out.raw (exit 0), the sweep's last two points, then the .op: v(v-sweep) = [8.989999999999853, 8.999999999999853], v(b) = [5.9977777777777455, 5.999999999999967], v(c) = [6.0, 6.0], i(v2) = [-2.2222222222541277e-06, -3.2959746043559335e-17], i(@r3[i]) = [-2.222222222254544e-06, -3.286260152890463e-17]; the .op: v(a) = 9.0, v(b) = 6.0, v(c) = 6.0, i(v2) = 0.0, i(@r3[i]) = 0.0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): the same doubles as ngspice 47
  words (describe.ts): V2: no current through V2; "At V1 = 8.999999999999853 V: … i(v2) = −32.76 aA, … i(@r3[i]) =
  −32.76 aA."; the notes "2 results are shown with their exact digits near 0 in the DC sweep: ngspice gave i(v2)
  -3.295975e-17 A at V1 = 8.999999999999853 V and i(@r3[i]) -3.286260e-17 A at V1 = 8.999999999999853 V. Each is too
  small beside the larger numbers ngspice works them out from for its arithmetic (about 16 significant digits) to give
  their digits. …" and "The DC sweep's last point is V1 = 8.999999999999853 V, not 9 V: ngspice adds the step, 10 mV,
  to V1 once a point, in doubles (about 16 significant digits), so its points drift from the values the steps say: its
  last point is 8.999999999999853 V, 147.4 fV short of 9 V. There the circuit makes i(v2) −32.76 aA, where at 9 V it
  makes 0 A. So PlainSpice names that point by ngspice's own value."; no warning
```

Added after the critic of round 2 of the last pass's fixes (13 November 2026) (C9y.2): the same with V2 idle at 12 V,
swept in steps of 0.1 V and of 0.5 V. ".dc V1 0 12 0.1" ends at 11.999999999999973 V, where V2 carries the exact
8.882 aA, which ngspice gives as 8.674 aA; the page draws 8.882 aA at "V1 = 11.999999999999973 V", with no warning (it
warned "at V1 = 12 V, V2 carries 8.882 aA, where ngspice gives 8.674 aA"). In steps of 0.5 V, which doubles add up
exactly, the sweep ends at 12 V, where ngspice gives V2 exactly 0, and nothing is said.

```spice
* V2 delivers no power when V1 is 12 V
V1 a 0 12
V2 c 0 6
R1 a b 1k
R2 b c 1k
R3 b 0 1k
.op
.dc V1 0 12 0.1
.end
```

```text
ngspice 47, ngspice -b (exit 1): "Error: no data saved for D.C. Transfer curve analysis; analysis not run"
ngspice 47, ngspice -b -r out.raw (exit 0), the sweep's last point, then the .op: v(v-sweep) = 11.999999999999973, v(b) = 5.999999999999991, i(v2) = -8.673617379884035e-18; the .op: v(a) = 12.0, v(b) = 6.0, i(v2) = 0.0
with ".dc V1 0 12 0.5": the last point v(v-sweep) = 12.0, v(b) = 6.0, i(v2) = 0.0
ngspice 42: the same exit codes and rawfile values as ngspice 47, both ways
our engine (wasm), as ngspice -b -r (exit 0): the same doubles as ngspice 47, both ways
  words (describe.ts): "At V1 = 11.999999999999973 V: … i(v2) = −8.882 aA, …"; with a 0.5 V step, "At V1 = 12 V: …
  i(v2) = 0 A, …" and no note
```

Added after the critic of round 2 of the last pass's fixes (13 November 2026) (C9y.3): the circuit of C9y with a
.param line, so that the rule decides. The .op shows V2 and R3 carrying no current, ngspice's own exact 0s. Its sweep's
point nearest 9 V, 8.999999999999853 V, shows V2's −32.96 aA where the .op shows 0, so it does not stand for the .op's
state: it keeps ngspice's numbers, unmarked, and is named by its own value, with the note "… There ngspice gives i(v2)
−32.96 aA, where the operating point, at 9 V, shows 0 A. So PlainSpice names that point by ngspice's own value." (It said
"At V1 = 9 V: … i(v2) = −32.96 aA" beside the .op's "V2: no current", with nothing said.)

```spice
* V2 holds node b's own 6 V, so R3 carries nothing when V1 is 9 V; a .param line
.param rb=6k
V1 a 0 9
R1 a b 3k
R2 b 0 {rb}
V2 c 0 6
R3 b c 1k
.options savecurrents
.op
.dc V1 0 9 0.01
.end
```

```text
ngspice 47, ngspice -b (exit 0), the .op: @r3[i] 0.000000e+00, v2#branch 0.000000e+00
ngspice 47, ngspice -b -r out.raw (exit 0): the very doubles of C9y (the sweep's last point v(v-sweep) = 8.999999999999853, i(v2) = -3.2959746043559335e-17, i(@r3[i]) = -3.286260152890463e-17; the .op's i(v2) = 0.0, i(@r3[i]) = 0.0)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): the same doubles as ngspice 47
```

Added after the critic of round 2 of the last pass's fixes (13 November 2026) (C9y.4): the circuit of C9y swept in steps
of 10 µV, 900,001 points of 8 results, more than PlainSpice looks through (SWEEP_VALUES). Its last point is
8.999999999828448 V, 171.6 pV short of 9 V, where V2 carries a real 38.12 fA. The note for such a sweep said "… except at
V1 = 9 V, the operating point's own state, where the sweep shows what the operating point shows", beside "i(v2) =
−38.12 fA" and the .op's "V2: no current". A point found within the step's rounding of the .op's value now stands for its
state only where every value it shows reads as the .op shows it: this one does not, so the note names no such point,
and the sweep's words name it by its own value, "At V1 = 8.999999999828448 V: … i(v2) = −38.12 fA".

```spice
* V2 holds node b's own 6 V, so R3 carries nothing when V1 is 9 V; a sweep too large to look through
V1 a 0 9
R1 a b 3k
R2 b 0 6k
V2 c 0 6
R3 b c 1k
.options savecurrents
.op
.dc V1 0 9 0.00001
.end
```

```text
ngspice 47, ngspice -b (exit 0), the .op: @r3[i] 0.000000e+00, v2#branch 0.000000e+00
ngspice 47, ngspice -b -r out.raw (exit 0), the sweep's 900001st point, then the .op: v(v-sweep) = 8.999999999828448, v(b) = 5.999999999961877, i(v2) = -3.81231504698043e-14, i(@r3[i]) = -3.812328230878848e-14; the .op: i(v2) = 0.0, i(@r3[i]) = 0.0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): the same doubles as ngspice 47
```

Added after the critic of round 2 of the last pass's fixes (13 November 2026) (C9y.5): S28's "+ 3" after .end, which
makes ngspice's R1 3 Ω (C9x.3), beside an op-amp buffer modelled as an E of 1e6, and beside three such buffers of 1e5.
The check that ngspice simulated the circuit PlainSpice reads allowed every equation RESIDUAL_SHARE times the product of
every gain in the circuit, 1e6 or 1e15, which let n1's leftover of a fifth pass as lost digits: "node n1 is at 2 V, where
ngspice gives 3 V". A controlled source lifts only the leftovers of the part of the circuit it drives (and of the parts
those drive), and nothing joins the op-amps to n1, so n1's equation keeps its own allowance, and the note says that
ngspice's numbers could not be checked, as for S28 alone. Within the part an op-amp drives its gain still counts: C9x's
amplifier of 1e15 keeps its warning beside a separate 1 A source and 2 Ω.

```spice
* a + line after .end, beside an op-amp buffer modelled as an E of 1e6
V2 x 0 1
E1 y 0 x y 1e6
R2 y 0 1k
I1 0 n1 1
.op
R1 n1 0 2
.end
+ 3
```

```text
ngspice 47, ngspice -b (exit 0): n1 3.000000e+00, v2#branch 0.000000e+00
ngspice 47, ngspice -b -r out.raw (exit 0): v(x) = 1.0, v(y) = 0.9999990000010001, v(n1) = 3.0, i(e1) = -0.0009999990000010002, i(v2) = 0.0
with three buffers of 1e5 (E1 y 0 x y 1e5, E2 z 0 y z 1e5, E3 w 0 z w 1e5, R2 w 0 1k): v(y) = 0.999990000099999, v(z) = 0.9999800002999961, v(w) = 0.9999700005999902, v(n1) = 3.0
ngspice 42: the same printout, exit code and rawfile values as ngspice 47, both
our engine (wasm), as ngspice -b -r (exit 0): the same doubles as ngspice 47, both
  words (describe.ts): node n1: 3 V; the note "PlainSpice could not check ngspice's numbers: …"; no warning
```

Added after the critic of round 2 of the last pass's fixes (13 November 2026) (C9y.6): which points are named by
ngspice's own value, and what their note says. (1) V2 is idle when V1 is at 9.12345 V, and ".dc V1 9.12245 9.12345
0.0001" ends at 9.123449999999998 V, 1.717 fV short of it, where V2 carries a real −3.815e-19 A (ngspice gives exactly
0 there, so the page draws the exact value with its note). The point is named by its own value, and the note says the
value it was meant to be at, and was checked against, with all its digits: "not 9.12345 V" (it said "not 9.123 V", and
"where at 9.123 V it makes 0 A", false at 9.123 V). For a point found near the .op's state by the rule, that value is
the .op's own double, so "3.3" in ngspice's .op, 3.3000000000000003 V (N15), is never written "3.3 V" beside a last
point of 3.3 V. (2) In a bridge whose node a2 is at 5.2875 V when V1 is 9 V, ".dc V1 0 9 0.9" ends at
9.000000000000002 V, where the circuit makes v(a2) 5.287500000000001 V: "5.288 V" against "5.287 V" at 9 V only because
the value sits on a rounding boundary of the page's 4 digits, as ngspice's own 5.287500000000817 V there does. Two
values are told apart only when they also differ by more than ANSWER_GAP, as an answer is off, so the point keeps
"V1 = 9 V" (it was named "V1 = 9.000000000000002 V", "There the circuit makes v(a2) 5.288 V, where at 9 V it makes
5.287 V"). (3) 10 Ω in series with 1e15 Ω: solving it loses most of ngspice's digits, and the .op's answers are off (V1
carries 500 aA, which ngspice gives as 506.5 aA). The sweep's last point, 500.0000000000001 mV, shows V1's −499.6 aA,
another rounding of the same 500 aA. Where the exact solution is this run's circuit (its .op checked as this circuit's,
answers off or not), it decides whether moving the source to ngspice's x changes a value on the page; here it does not,
so the point keeps "V1 = 500 mV" (it was named by its own value, with "There ngspice gives i(v1) −499.6 aA, where the
operating point, at 500 mV, shows −506.5 aA", as if the 111 aV had made the difference). Where there is no such exact
solution (C9y.3's .param line, a transistor), ngspice's numbers at the point against the .op's decide, whatever made them
differ: the page cannot tell the drift from ngspice's own rounding or its Newton tolerances there, and either way the
point does not show what the .op shows.

```spice
* V2 idle at 9.12345 V, swept up to it in 100 uV steps
V1 a 0 9.12345
R1 a b 3k
R2 b 0 6k
V2 c 0 6.0823
R3 b c 1k
.options savecurrents
.op
.dc V1 9.12245 9.12345 0.0001
.end
```

```text
ngspice 47, ngspice -b (exit 0), the .op: a 9.123450e+00, b 6.082300e+00, c 6.082300e+00, @r3[i] 0.000000e+00, v2#branch 0.000000e+00
ngspice 47, ngspice -b -r out.raw (exit 0), the sweep's last point: v(v-sweep) = 9.123449999999998, v(b) = 6.0823, i(v2) = 0.0, i(@r3[i]) = 0.0, i(v1) = -0.0010137166666666663; the .op: v(a) = 9.12345, i(v2) = 0.0
ngspice 42: the same .op printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): the same doubles as ngspice 47
  words (describe.ts): "The DC sweep's last point is V1 = 9.123449999999998 V, not 9.12345 V: … its last point is
  9.123449999999998 V, 1.717 fV short of 9.12345 V. There the circuit makes i(v2) −3.815e-19 A, where at 9.12345 V it
  makes 0 A. …"
```

```spice
* a bridge with an ammeter and a CCCS, node a2 at 5.2875 V when V1 is 9 V
V1 top1 0 9
R1 top1 a2 330k
R2 a2 0 470k
R3 top1 b3 33meg
R4 b3 0 47meg
R5 a2 m4 68
V2 m4 b3 0
F1 0 o5 V2 2
R6 o5 0 270
.options savecurrents
.op
.dc V1 0 9 0.9
.end
```

```text
ngspice 47, ngspice -b (exit 0), the .op: a2 5.287500e+00, top1 9.000000e+00, v2#branch 3.726945e-20
ngspice 47, ngspice -b -r out.raw (exit 0), the sweep's last point: v(v-sweep) = 9.000000000000002, v(a2) = 5.287500000000817; the .op: v(top1) = 9.0, v(a2) = 5.287500000000816
ngspice 42: the same .op printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): the same doubles as ngspice 47
  words (describe.ts): "At V1 = 9 V: v(top1) = 9 V, v(a2) = 5.288 V, …"; no note about the point
```

```spice
* 1e15 ohms in series with 10 ohms
V1 top1 0 0.5
R1 top1 s2 10
R2 s2 0 1e15
.options savecurrents
.op
.dc V1 0 0.5 0.08333333333333333
.end
```

```text
ngspice 47, ngspice -b (exit 0), the .op: s2 5.000000e-01, top1 5.000000e-01, @r2[i] 5.000000e-16, @r1[i] 5.051515e-16, v1#branch -5.06539e-16
ngspice 47, ngspice -b -r out.raw (exit 0), the sweep's last point: v(v-sweep) = 0.5000000000000001, i(v1) = -4.996003610813204e-16, i(@r1[i]) = 4.996003610813204e-16; the .op: i(v1) = -5.065392549852277e-16
ngspice 42: the same .op printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0): the same doubles as ngspice 47
  words (describe.ts): the warning "Some of ngspice's answers here are off: … V1 carries 500 aA, where ngspice gives
  506.5 aA; …"; "At V1 = 500 mV: v(top1) = 500 mV, …"; no note about the point
```

## 4. Messages

Each message explainDiagnostic puts into plain words, with the netlist that makes ngspice print it and the codes `src/engine/diagnostics.ts` gives it in our engine.

### M1. No ground: singular matrix, then a "transient op", and numbers that cannot be trusted

With no node 0, the voltages float. ngspice warns about a singular matrix, tries gmin stepping and source stepping, and then a "transient op". It still prints numbers (a = 9.0003 V, b = 3.0003 V): only their difference, 6 V, is right.

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
    Warning: singular matrix:  check node b
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: singular matrix:  check node b
    Warning: singular matrix:  check node b
    Warning: singular matrix:  check node b
    Warning: singular matrix:  check node b
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  rawfile from ngspice -b -r (exit 0): v(a) = 9.00033307426206, v(b) = 3.0003330742710626, i(v1) = -2.9999999999924993
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    Warning: singular matrix:  check node b
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node b
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: singular matrix:  check node b
    Warning: singular matrix:  check node b
    Warning: singular matrix:  check node b
    Warning: singular matrix:  check node b
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  vectors: v(a) = 9.00033307426206, v(b) = 3.0003330742710626, i(v1) = -2.9999999999924993
  diagnostics: singular-matrix (b), gmin-stepping-failed, source-stepping-failed, transient-op-fallback
```

### M2. A node joined only through capacitors has no DC path: the fallback numbers can be wrong even elsewhere

Node b connects only to capacitors, which are open in .op. ngspice's fallback even gets c wrong: 0.0887 V, where the divider gives 3 V.

```spice
* T15b: a node connected only to capacitors, with a resistor elsewhere
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
    Warning: singular matrix:  check node b
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: singular matrix:  check node b
    Warning: singular matrix:  check node b
    Warning: singular matrix:  check node b
    Warning: singular matrix:  check node b
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  rawfile from ngspice -b -r (exit 0): v(a) = 5.9999999999939995, v(c) = 0.08866339997380636, v(b) = 0.029554466657885997, i(v1) = -0.005911336600014282
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    Warning: singular matrix:  check node b
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node b
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: singular matrix:  check node b
    Warning: singular matrix:  check node b
    Warning: singular matrix:  check node b
    Warning: singular matrix:  check node b
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  vectors: v(a) = 5.9999999999939995, v(c) = 0.08866339997380636, v(b) = 0.029554466657885997, i(v1) = -0.005911336600014282
  diagnostics: singular-matrix (b), gmin-stepping-failed, source-stepping-failed, transient-op-fallback
```

### M2b. A current source in series with a capacitor has no DC path either

The current source has no DC path: its only way on is through C1. The fallback numbers are arbitrary.

```spice
* T05a: a current source in series with a capacitor
I1 0 a 1m
C1 a b 1u
R1 b 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        b                                1.000000e+00
        a                                1.010000e+00
    Warning: singular matrix:  check node a
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node a
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: singular matrix:  check node a
    Warning: singular matrix:  check node a
    Warning: singular matrix:  check node a
    Warning: singular matrix:  check node a
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  rawfile from ngspice -b -r (exit 0): v(a) = 1.0099999979842442, v(b) = 0.9999999979942681
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    Warning: singular matrix:  check node a
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node a
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: singular matrix:  check node a
    Warning: singular matrix:  check node a
    Warning: singular matrix:  check node a
    Warning: singular matrix:  check node a
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  vectors: v(a) = 1.0099999979842442, v(b) = 0.9999999979942681
  diagnostics: singular-matrix (a), gmin-stepping-failed, source-stepping-failed, transient-op-fallback
```

### M2c. A resistor joined to nothing else: singular matrix at its node

R2's nodes n3 and n4 connect to nothing else.

```spice
* T04b: a resistor whose both nodes connect to nothing else
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
    Warning: singular matrix:  check node n3
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: singular matrix:  check node n3
    Warning: singular matrix:  check node n3
    Warning: singular matrix:  check node n3
    Warning: singular matrix:  check node n3
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  rawfile from ngspice -b -r (exit 0): v(n1) = 5.9999999999939995, v(n3) = 0, v(n4) = 0, i(v1) = -2.9999999999939995
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    Warning: singular matrix:  check node n3
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node n3
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: singular matrix:  check node n3
    Warning: singular matrix:  check node n3
    Warning: singular matrix:  check node n3
    Warning: singular matrix:  check node n3
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  vectors: v(n1) = 5.9999999999939995, v(n3) = 0, v(n4) = 0, i(v1) = -2.9999999999939995
  diagnostics: singular-matrix (n3), gmin-stepping-failed, source-stepping-failed, transient-op-fallback
```

### M3. Two voltage sources in parallel: singular matrix at a branch, and no results

V1 and V2 both set n1, to different values: the current in V1 has no single answer. Here even the fallback fails, and there are no results.

```spice
* T06a: two different voltage sources in parallel
V1 n1 0 5
V2 n1 0 3
R1 n1 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    DC solution failed -
    Last Node Voltages
    ------------------
    Node                                   Last Voltage        Previous Iter
    ----                                   ------------        -------------
    n1                                                0                    0
    v2#branch                                         0                    3 *
    v1#branch                                         0                    5 *
    Warning: singular matrix:  check node v1#branch
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node v1#branch
    Warning: singular matrix:  check node v1#branch
    Warning: singular matrix:  check node v1#branch
    Warning: singular matrix:  check node v1#branch
    Warning: singular matrix:  check node v1#branch
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
  rawfile from ngspice -b -r (exit 1): an Operating Point plot with 0 points, its header only (no results)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, marked unreliable, no results):
    DC solution failed -
    Last Node Voltages
    ------------------
    Node                                   Last Voltage        Previous Iter
    ----                                   ------------        -------------
    n1                                                0                    0
    v2#branch                                         0                    3 *
    v1#branch                                         0                    5 *
    Warning: singular matrix:  check node v1#branch
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node v1#branch
    Warning: singular matrix:  check node v1#branch
    Warning: singular matrix:  check node v1#branch
    Warning: singular matrix:  check node v1#branch
    Warning: singular matrix:  check node v1#branch
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
  diagnostics: singular-matrix (v1#branch), gmin-stepping-failed, source-stepping-failed, transient-op-fallback, transient-op-failed, op-failed, run-aborted
```

### M3b. A voltage source shorted by a 0 V source: the same

A 0 V source across V1 is the same conflict.

```spice
* T06b: a voltage source shorted by a 0 V source
V1 n1 0 5
Vx n1 0 0
R1 n1 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    DC solution failed -
    Last Node Voltages
    ------------------
    Node                                   Last Voltage        Previous Iter
    ----                                   ------------        -------------
    n1                                                0                    0
    vx#branch                                         0                    0
    v1#branch                                         0                    5 *
    Warning: singular matrix:  check node v1#branch
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node v1#branch
    Warning: singular matrix:  check node v1#branch
    Warning: singular matrix:  check node v1#branch
    Warning: singular matrix:  check node v1#branch
    Warning: singular matrix:  check node v1#branch
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
  rawfile from ngspice -b -r (exit 1): an Operating Point plot with 0 points, its header only (no results)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, marked unreliable, no results):
    DC solution failed -
    Last Node Voltages
    ------------------
    Node                                   Last Voltage        Previous Iter
    ----                                   ------------        -------------
    n1                                                0                    0
    vx#branch                                         0                    0
    v1#branch                                         0                    5 *
    Warning: singular matrix:  check node v1#branch
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node v1#branch
    Warning: singular matrix:  check node v1#branch
    Warning: singular matrix:  check node v1#branch
    Warning: singular matrix:  check node v1#branch
    Warning: singular matrix:  check node v1#branch
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
  diagnostics: singular-matrix (v1#branch), gmin-stepping-failed, source-stepping-failed, transient-op-fallback, transient-op-failed, op-failed, run-aborted
```

### M3c. A voltage source with an inductor across it (a short in .op): singular matrix, and fallback numbers that cannot be trusted

In .op the inductor is a short across V1. ngspice warns at the inductor's branch (l1#branch); the fallback gives numbers (here i(l1) = 50 mA), which mean nothing.

```spice
* a voltage source with an inductor across it
V1 a 0 5
L1 a 0 1m
R1 a 0 1k
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        a                                5.000000e+00
        v1#branch                        -5.50000e-02
        l1#branch                        5.000000e-02
    Warning: singular matrix:  check node l1#branch
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node l1#branch
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: singular matrix:  check node l1#branch
    Warning: singular matrix:  check node l1#branch
    Warning: singular matrix:  check node l1#branch
    Warning: singular matrix:  check node l1#branch
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  rawfile from ngspice -b -r (exit 0): v(a) = 4.9999999999949996, i(l1) = 0.049999999999950126, i(v1) = -0.05499999999989012
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable):
    Warning: singular matrix:  check node l1#branch
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node l1#branch
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: singular matrix:  check node l1#branch
    Warning: singular matrix:  check node l1#branch
    Warning: singular matrix:  check node l1#branch
    Warning: singular matrix:  check node l1#branch
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  vectors: v(a) = 4.9999999999949996, i(l1) = 0.049999999999950126, i(v1) = -0.05499999999989012
  diagnostics: singular-matrix (l1#branch), gmin-stepping-failed, source-stepping-failed, transient-op-fallback
```

### M4. Two parts with the same name (capital letters ignored): device already exists

R1 and r1 are the same name, because ngspice ignores capital letters (W7).

```spice
* T07b: R1 and r1
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
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      r1 n1 0 4
    device already exists, bail out
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      r1 n1 0 4
    device already exists, bail out
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none)
  diagnostics: duplicate-name [line 4], circuit-not-parsed
```

### M5. A line starting with a digit is no part: unknown device type

A part's name starts with the letter that says what it is; a digit is no such letter.

```spice
* a line starting with a digit
V1 a 0 6
R1 a 0 2
1k a 0 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      1k a 0 5
     unknown device type - error 
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      1k a 0 5
     unknown device type - error 
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      1k a 0 5
     unknown device type - error 
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none)
  diagnostics: unknown-device [line 4], circuit-not-parsed
```

### M5b. A line starting with a letter outside A–Z (here Ü) is no part either

Ü is not one of the letters A–Z, so this is no part either.

```spice
* a line starting with a non-ASCII letter
V1 a 0 6
R1 a 0 2
Ü1 a 0 5
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
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      __1 a 0 5
     unknown device type - error 
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      __1 a 0 5
     unknown device type - error 
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none)
  diagnostics: unknown-device [line 4], circuit-not-parsed
```

### M6. X calls a subcircuit that is not defined: unknown subckt

Native ngspice 47 crashes (segmentation fault) on this netlist with `-b -r`, as the research found for netlists where no circuit could be built; our engine exits with code 1.

```spice
* X without a .subckt
V1 a 0 6
R1 a 0 2
X1 a 0 amp
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: unknown subckt: x1 a 0 amp
        in line no. 4 from file msg-unknown-subckt.cir
        Simulation interrupted due to error!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  rawfile from ngspice -b -r (exit signal SIGSEGV): (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error: unknown subckt: x1 a 0 amp
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error: unknown subckt: x1 a 0 amp
        in line no. 4 from file circuit.cir
        Simulation interrupted due to error!
    Error: there aren't any circuits loaded.
  vectors: (none)
  diagnostics: unknown-subcircuit (x1), error
```

### M7. A diode with no .model line: ngspice cannot find the model

ngspice warns that it cannot find the model, then stops.

```spice
* a diode without a .model line
V1 a 0 5
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
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42, ngspice -b (exit 1):
    warning, can't find model 'dmod' from line
        d1 b 0 dmod
    Error on line 4 or its substitute:
      d1 b 0 dmod
    could not find a valid modelname
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    warning, can't find model 'dmod' from line
        d1 b 0 dmod
    Error on line 4 or its substitute:
      d1 b 0 dmod
    could not find a valid modelname
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none)
  diagnostics: warning, missing-model [line 4], circuit-not-parsed
```

### M8. A MOSFET model that PlainSpice leaves out (BSIM3, level=8): "could not find a valid modelname"

```spice
* a MOSFET with a BSIM3 model (level=8)
Vd d 0 1
Vg g 0 1
M1 d g 0 0 nm
.model nm nmos level=8
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
    Warning -- Version not specified on line "level=8"
    Setting version to 'default'.
        g                                1.000000e+00
        d                                1.000000e+00
        vd#branch                        -1.01098e-12
        vg#branch                        0.000000e+00
    Checking parameters for BSIM 3.3 model nm
    Warning: Pd = 0 is less than W.
    Warning: Ps = 0 is less than W.
  rawfile from ngspice -b -r (exit 0): v(d) = 1, v(g) = 1, i(vg) = 0, i(vd) = -1.0109828756861149e-12
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Warning -- Version not specified on line "level=8"
    Setting version to 'default'.
    Error on line 4 or its substitute:
      m1 d g 0 0 nm
    could not find a valid modelname
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none)
  diagnostics: missing-model [line 4], circuit-not-parsed, warning
```

Native ngspice 47 and 42 run this circuit (they have BSIM3); our engine leaves BSIM3 out (engine/build.sh, REMOVED_MODELS), so it stops.

### M9. An E line with too few fields: native ngspice says "not enough parameters"; our engine gets a singular matrix

On native ngspice the line stops with "not enough parameters in line" (and 47 then crashes with `-b -r`).

```spice
* an E line with too few fields
Rref a 0 1
E1 a 0 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: not enough parameters in line
       e1 a 0 5
        line no 3, file msg-not-enough.cir
    No circuit loaded!
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  rawfile from ngspice -b -r (exit signal SIGSEGV): (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error: not enough parameters in line
       e1 a 0 5
    No circuit loaded!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, marked unreliable, no results):
    DC solution failed -
    Last Node Voltages
    ------------------
    Node                                   Last Voltage        Previous Iter
    ----                                   ------------        -------------
    a                                                 0                    0
    5                                                 0                    0
                                                      0                    0
    e1#branch                                         0                    0
    Warning: singular matrix:  check node 5
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node 5
    Warning: singular matrix:  check node 5
    Warning: singular matrix:  check node 5
    Warning: singular matrix:  check node 5
    Warning: singular matrix:  check node 5
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
  diagnostics: singular-matrix (5), gmin-stepping-failed, source-stepping-failed, transient-op-fallback, transient-op-failed, op-failed, run-aborted
```

Native ngspice checks the field count in its XSPICE code; our engine leaves XSPICE out, so the line is read with missing nodes and the matrix is singular.

### M10. .tf names a source that is not in the circuit

V9 is not in the circuit; ngspice runs no analysis.

```spice
* T12a: .tf naming a source that does not exist
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
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Warning: Transfer function source v9 not in circuit
    doAnalyses: not found
    run simulation(s) aborted
  vectors: (none)
  diagnostics: tf-source-missing (v9), run-aborted
```

### M11. .tf names a resistor as its input: not of proper type

The input of .tf must be a voltage or current source.

```spice
* T12c: .tf naming a resistor as the input source
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
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Warning: Transfer function source r1 not of proper type
    doAnalyses: not found
    run simulation(s) aborted
  vectors: (none)
  diagnostics: tf-source-type (r1), run-aborted
```

### M12. .dc sweeps a source that is not in the circuit

ngspice looks for a voltage source, a current source or a resistor called V9 (the temperature would be TEMP).

```spice
* T20e: .dc sweeping a source that does not exist
V1 in 0 0
R1 in out 1k
R2 out 0 2k
.dc V9 0 12 1
.end
```

```text
ngspice 47, ngspice -b -r (exit 1):
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "v9" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
  rawfile: (no rawfile)
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "v9" is not in the circuit
    doAnalyses: no such device
    run simulation(s) aborted
  vectors: (none)
  diagnostics: sweep-source-missing (v9), run-aborted
```

### M13. .dc with a step of 0: ngspice 47 says "Bad syntax!" (ngspice 42 loops forever)

ngspice 47 checks the step; ngspice 42 does not, and loops forever (the research stopped it after 60 s), so 42 was not run here.

```spice
* T20a: .dc with a step of 0
V1 in 0 0
R1 in out 1k
R2 out 0 2k
.dc V1 0 12 0
.end
```

```text
ngspice 47, ngspice -b -r (exit 1):
    Error on line 5 or its substitute:
      .dc v1 0 12 0
    Bad syntax! 
        Simulation interrupted due to error!
    Error: circuit not parsed.
  rawfile: (no rawfile)
ngspice 42: not run (it loops forever on this netlist: research case T20a)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 5 or its substitute:
      .dc v1 0 12 0
    Bad syntax! 
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none)
  diagnostics: bad-syntax [line 5], circuit-not-parsed
```

### M13b. .dc with no step: also "Bad syntax!" in ngspice 47

```spice
* T20d: .dc with no step
V1 in 0 0
R1 in out 1k
R2 out 0 2k
.dc V1 0 12
.end
```

```text
ngspice 47, ngspice -b -r (exit 1):
    Error on line 5 or its substitute:
      .dc v1 0 12
    Bad syntax! 
        Simulation interrupted due to error!
    Error: circuit not parsed.
  rawfile: (no rawfile)
ngspice 42: not run (it loops forever on this netlist: research case T20a)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 5 or its substitute:
      .dc v1 0 12
    Bad syntax! 
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none)
  diagnostics: bad-syntax [line 5], circuit-not-parsed
```

### M14. .tran with one number: TSTOP is invalid

```spice
* T21a: .tran with one argument
V1 in 0 0
R1 in out 1k
R2 out 0 2k
C1 out 0 1u
.tran 5m
.end
```

```text
ngspice 47, ngspice -b -r (exit 1):
    Error on line 6 or its substitute:
      .tran 5m
    TSTOP is invalid, must be greater than zero.
        Simulation interrupted due to error!
    Error: circuit not parsed.
  rawfile: (no rawfile)
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 6 or its substitute:
      .tran 5m
    TSTOP is invalid, must be greater than zero.
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none)
  diagnostics: bad-tran-arguments (TSTOP) [line 6], circuit-not-parsed
```

### M15. .tran with a step of 0: TSTEP is invalid

```spice
* T21b: .tran with a zero step
V1 in 0 0
R1 in out 1k
R2 out 0 2k
C1 out 0 1u
.tran 0 5m
.end
```

```text
ngspice 47, ngspice -b -r (exit 1):
    Error on line 6 or its substitute:
      .tran 0 5m
    TSTEP is invalid, must be greater than zero.
        Simulation interrupted due to error!
    Error: circuit not parsed.
  rawfile: (no rawfile)
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 6 or its substitute:
      .tran 0 5m
    TSTEP is invalid, must be greater than zero.
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none)
  diagnostics: bad-tran-arguments (TSTEP) [line 6], circuit-not-parsed
```

### M15b. .tran with tstart after tstop: TSTART is invalid

```spice
* T21d: .tran with tstart after tstop
V1 in 0 0
R1 in out 1k
R2 out 0 2k
C1 out 0 1u
.tran 10u 5m 6m
.end
```

```text
ngspice 47, ngspice -b -r (exit 1):
    Error on line 6 or its substitute:
      .tran 10u 5m 6m
    TSTART is invalid, must be less than TSTOP.
        Simulation interrupted due to error!
    Error: circuit not parsed.
  rawfile: (no rawfile)
ngspice 42: the same output, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 6 or its substitute:
      .tran 10u 5m 6m
    TSTART is invalid, must be less than TSTOP.
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none)
  diagnostics: bad-tran-arguments (TSTART) [line 6], circuit-not-parsed
```

### M16. K names an inductor that does not exist

K1 names L2, which does not exist.

```spice
* K naming an inductor that does not exist
V1 a 0 6
L1 a b 1m
R1 b 0 1
K1 L1 L2 0.9
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Fatal error: k1: coupling to non-existent inductor l2.
    doAnalyses: not found
    run simulation(s) aborted
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42: the same printout, exit code and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Fatal error: k1: coupling to non-existent inductor l2.
    doAnalyses: not found
    run simulation(s) aborted
  vectors: (none)
  diagnostics: missing-inductor, run-aborted
```

### M17. An expression uses a name no .param defines: Undefined parameter

{rx} needs a .param line that gives rx a value.

```spice
* an undefined parameter
V1 a 0 6
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
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Netlist line no. 3:
    Undefined parameter [rx]
    Netlist line no. 3:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  rawfile from ngspice -b -r (exit 1): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error in netlist line no. 4, new internal line no. 3:
    Undefined parameter [rx]
    Error in netlist line no. 4, new internal line no. 3:
    Cannot compute substitute
    ERROR: fatal error in ngspice, exit(1)
  vectors: (none)
  diagnostics: undefined-parameter (rx) [line 3], fatal [line 3]
```

### M18. An expression with no closing brace stops ngspice (a fatal error)

The brace is never closed: ngspice stops with a fatal error.

```spice
* an expression with no closing brace
V1 a 0 6
R1 a 0 {2*3
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error in netlist line no. 4, new internal line no. 3:
    Closing "}" not found in line fragment
        {2*3.
    ERROR: fatal error in ngspice, exit(1)
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Netlist line no. 3:
    Closing "}" not found in line fragment
        {2*3.
    ERROR: fatal error in ngspice, exit(1)
  rawfile from ngspice -b -r (exit 1): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error in netlist line no. 4, new internal line no. 3:
    Closing "}" not found in line fragment
        {2*3.
    ERROR: fatal error in ngspice, exit(1)
  vectors: (none)
  diagnostics: fatal-syntax [line 3], fatal
```

### M19. A B line without V= or I= stops ngspice (a fatal error)

A B line needs V= or I=; ngspice stops with a fatal error.

```spice
* a B line without V= or I=
Rref a 0 1
B1 a 0 5
.op
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    ERROR: mal formed B source instance: b1 a 0 5
        in line no. 3 of file msg-b-malformed.cir
    ERROR: fatal error in ngspice, exit(1)
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42, ngspice -b (exit 1):
    ERROR: mal formed B line: b1 a 0 5
    ERROR: fatal error in ngspice, exit(1)
  rawfile from ngspice -b -r (exit 1): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    ERROR: mal formed B source instance: b1 a 0 5
        in line no. 3 of file circuit.cir
    ERROR: fatal error in ngspice, exit(1)
  vectors: (none)
  diagnostics: fatal-syntax, fatal
```

### M20. No analysis line: ngspice runs nothing, and with a results file it says nothing about it

With `-r` (as our engine runs ngspice), there is no message at all: no results and exit code 0. Plain `ngspice -b` (without `-r`) does say "no simulations run".

```spice
* T21e: no analysis line at all
V1 in 0 0
R1 in out 1k
R2 out 0 2k
C1 out 0 1u
* (no analysis)
.end
```

```text
ngspice 47, ngspice -b (exit 1):
    Error: incomplete or empty netlist
           or no ".plot", ".print", or ".fourier" lines in batch mode;
    no simulations run!
  rawfile from ngspice -b -r (exit 0): (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 0): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 0, no results):
  vectors: (none)
```

### M21. A line starting with { is read as an expression; unclosed, it stops ngspice

ngspice reads { as the start of an expression; without the closing brace it stops with a fatal error.

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
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Netlist line no. 4:
    Closing "}" not found in line fragment
        {1 a 0 5.
    ERROR: fatal error in ngspice, exit(1)
  rawfile from ngspice -b -r (exit 1): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error in netlist line no. 5, new internal line no. 4:
    Closing "}" not found in line fragment
        {1 a 0 5.
    ERROR: fatal error in ngspice, exit(1)
  vectors: (none)
  diagnostics: fatal-syntax [line 4], fatal
```

### M2d. ngspice points at a node in its own spelling: ou___t for a name with a hidden character, __iki__ for ÇIKIŞ

Added after the critic of the words re-check's fix (12 November 2026). As in M2, the node between the
two capacitors has no DC path; here its name is written with a zero-width space, which ngspice keeps
as underscores (W16, invisible-character-3), so it points at `ou___t`. With `ÇIKIŞ` in its place (and
`GİRİŞ` for `in`) it points at `__iki__`, with `aµ` at `au`, and with an ordinary node named `ground` at
`ground`. So the words map ngspice's name back to the node it spells, as the results' words do (W16),
and name it as written: "Node out (written with a zero-width space in it) has no DC path to ground",
"Node ÇIKIŞ has no DC path to ground", 'Node "ground" has no DC path to ground' (they said "No single
answer at node ou___t" and "at node __iki__"); the drawing writes the note at that node; and the
floating-dc check quotes the warning as ngspice prints it ('singular matrix: check node ou___t').

```spice
* t
V1 in 0 5
C1 in ou<ZWSP>t 1u
C2 ou<ZWSP>t 0 1u
.op
.end
```

```text
ngspice 47, ngspice -b (exit 0):
        ou___t                           2.500000e+00
        in                               5.000000e+00
        v1#branch                        -1.57030e-12
    Warning: singular matrix:  check node ou___t
    Note: Starting dynamic gmin stepping
    Warning: singular matrix:  check node ou___t
    Warning: Dynamic gmin stepping failed
    Note: Starting true gmin stepping
    Warning: singular matrix:  check node ou___t
    Warning: singular matrix:  check node ou___t
    Warning: singular matrix:  check node ou___t
    Warning: singular matrix:  check node ou___t
    Warning: True gmin stepping failed
    Note: Starting source stepping
    Warning: source stepping failed
    Note: Transient op started
    Note: Transient op finished successfully
  rawfile from ngspice -b -r (exit 0): v(in) = 4.9999999999949996, v(ou___t) = 2.4999999999849893, i(v1) = -1.5702994460298214e-12
  the same with V1 GİRİŞ 0 5, C1 GİRİŞ ÇIKIŞ 1u, C2 ÇIKIŞ 0 1u: the same warnings with "check node __iki__";
    rawfile v(g__r____) = 4.9999999999949996, v(__iki__) = 2.4999999999849893, i(v1) = -1.5702994460298214e-12
  with aµ for ou<ZWSP>t: "check node au", rawfile v(au) = 2.4999999999849893; with ground: "check node ground",
    rawfile v(ground) = 2.4999999999849893 (an ordinary node, W13)
ngspice 42: the same printouts, exit codes and rawfile values as ngspice 47
our engine (wasm), as ngspice -b -r (exit 0, marked unreliable): the same messages ("check node ou___t";
  "check node __iki__" for ÇIKIŞ)
  vectors: v(in) = 4.9999999999949996, v(ou___t) = 2.4999999999849893, i(v1) = -1.5702994460298214e-12; for ÇIKIŞ:
    v(g__r____) = 4.9999999999949996, v(__iki__) = 2.4999999999849893, i(v1) = -1.5702994460298214e-12
  diagnostics: singular-matrix (ou___t; __iki__), gmin-stepping-failed, source-stepping-failed, transient-op-fallback
```

### M4b. Rş and Rç are the same name too: ngspice spells both r__

Added after the re-check of the merged build, 12 November 2026 (S9). ngspice writes each byte of a
letter outside a to z as `_` (W18), so it stops at `Rç` (`r__ a 0 3`), the same name as `Rş` on line 3.
The Numbers panel finds that earlier part the way ngspice compares names and gives this reason, as the
duplicate-name check does (duplicate-name-3 in traps.md); it said "Two parts are called Rç … SPICE
ignores capital letters", naming neither the other part nor the reason. It also says to rename one of
them with the letters a to z: `Rş` with `Rö` stops the same way (`r__ a 0 3`, native 47 and 42).

```spice
* Rş and Rç: the same name for ngspice
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
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      r__ a 0 3
    device already exists, bail out
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      r__ a 0 3
    device already exists, bail out
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none)
  diagnostics: duplicate-name [line 4], circuit-not-parsed
```

What the Numbers panel says: "**Rş and Rç are the same name for ngspice.** Each part needs its own
name. ngspice writes each letter other than a to z (or A to Z) in a name as underscores, so Rç here is
the same name as Rş on line 3: both are r__. ngspice stops at the second one ("device already exists").
Rename one of them with the letters a to z."

### M4c. Rµ and Ru are the same name: ngspice reads the micro sign as u

Added after the re-check of the merged build, 12 November 2026 (S9). ngspice reads µ as u (W15), so it
stops at `Ru` (`ru a 0 3`), the same name as `Rµ` on line 3 (duplicate-name-4 in traps.md). Not a
matter of capital letters, which the Numbers panel said.

```spice
* Rµ and Ru: the same name for ngspice
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
  rawfile from ngspice -b -r (exit 1): (no rawfile)
ngspice 42, ngspice -b (exit 1):
    Error on line 4 or its substitute:
      ru a 0 3
    device already exists, bail out
        Simulation interrupted due to error!
    Note: No ".plot", ".print", or ".fourier" lines; no simulations run
  rawfile from ngspice -b -r (exit 1): (no rawfile)
our engine (wasm), as ngspice -b -r (exit 1, no results):
    Error on line 4 or its substitute:
      ru a 0 3
    device already exists, bail out
        Simulation interrupted due to error!
    Error: circuit not parsed.
  vectors: (none)
  diagnostics: duplicate-name [line 4], circuit-not-parsed
```

What the Numbers panel says: "**Rµ and Ru are the same name for ngspice.** Each part needs its own
name. ngspice reads the micro sign µ as u, so Ru here is the same name as Rµ on line 3: both are ru.
ngspice stops at the second one ("device already exists"). Rename one of them with the letters a to z."

## How the code uses these facts

| Code | Claims |
|---|---|
| `explain.ts`: R, C, L lines (either way round, open/short in `.op` and `.dc`, 0 Ω, negative values, missing values) | P1, P2, P11–P15b, P24, A31 |
| `explain.ts`: V and I lines (+ node and − node, from node and to node, 0 V ammeters, values in `.op`, PULSE/SIN/PWL/EXP arguments, AC values, a source .dc sweeps) | P3, P3b, P4, P4b, P4c, P9, P16–P20b |
| `explain.ts`: E, F, G, H and K lines, and their control sources | P5–P8, P10–P10d, P21, M9 (and missing-value-4 to -7 in traps.md) |
| `explain.ts`: `.op`, `.tf`, `.dc`, `.tran`, `.ac` (`readAnalysis`, `dcSweepPoints`, `acSweepPoints`, `unusedSubcircuit`, `innerNode`) | A1–A22b, A3f–A3h, A31, M10–M15b |
| `explain.ts`: other dot commands, models, subcircuits, unknown dot commands | A2, A2b, A23–A30 (with A29b, A29c), A32–A35, M6, M8 |
| `describe.ts`: directions, power, ammeters, `.tf` words, switches left out, rounding noise shown as 0 A and 0 V, real values ngspice rounds to 0 shown exactly (`exact.ts`) | C1–C9v, A3–A6 (with A3b–A3h) |
| `describe.ts`: `explainDiagnostic` and the messages of `describeResults` | M1–M21, P10, P13, P15, P16, A6, A11, A26–A29, A33 |

Re-running the evidence: the netlists, the scripts that run them through native ngspice 47, 42 and
our engine, and the generator of this file's evidence blocks were kept outside the repository during
this work (as for numbers-and-syntax.md); the netlists and the native values are in
`tests/golden/facts-explain.test.ts`, which re-runs every netlist through our engine.
