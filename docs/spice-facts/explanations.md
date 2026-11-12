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
  other way, from c into node 0 (P4).
- E: V(+) − V(−) = gain × (V(c+) − V(c−)). G: gain × (V(c+) − V(c−)) amps from its first node into its
  second. F: gain × the current in its control source, the same way. H: V(+) − V(−) = gain × that
  current (P5–P8). The control source of F and H must be a voltage source: V, E, H or a B line
  with V=, not a resistor, an inductor or a B line with I= (P7, P10, P10b, P10c, P10d). A 0 V source
  is a wire that measures its current (P9).
- In `.op` and `.dc` a capacitor is an open circuit and an inductor a short circuit (P11, P12, A31).
- ngspice 47 turns 0 Ω (and anything below 1e-12 Ω) into 1e-12 Ω with a warning, and currents next to
  it come out inaccurate (P13, P24). A negative resistance is accepted silently (P14). An R, C or L with
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
  0 without a message (A6).
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
the same rules (C4–C7); savecurrents gives wrong currents for switches in `.op` (C8); a current that is 0 can
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

`I1 0 a 3` pulls 3 A out of ground and pushes it into a, so 3 A flow down through the 4 Ω resistor: a = +12 V. Written `I2 b 0 3`, the current is pulled out of b instead: b = −12 V. A negative value pushes the current the other way: `I3 0 c -3` pulls 3 A out of c and pushes it into ground, so c = −12 V, as for I2 (Explain says "Its value is negative, so the current flows the other way: I3 pushes 3 A from node c, through the source, into ground (node 0).": words re-check 12, 12 November 2026).

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

### P14. A negative resistance is accepted without a message

1 A into a −2 Ω resistor gives −2 V, with no message.

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
ngspice 42: the same output, exit code and rawfile values as ngspice 47
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
ngspice 42: the same output, exit code and rawfile values as ngspice 47
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
ngspice 42: the same output, exit code and rawfile values as ngspice 47
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
ngspice 42: the same output, exit code and rawfile values as ngspice 47
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
ngspice 42: the same output, exit code and rawfile values as ngspice 47
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
  rawfile: (no data: header without a Binary: or Values: section)
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
ngspice 42: the same output, exit code and rawfile values as ngspice 47
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
ngspice 42: the same output, exit code and rawfile values as ngspice 47
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

A tiny current is not always noise: `I1 0 n1 3A` is a 3 aA source (unit-letter-1 in traps.md), and ngspice gives v(n1) = 1.2e−17 V across 4 Ω, a real 3 aA. So is a tiny current next to large ones (C9e to C9g), and one that flows on from a real tiny current, though the ends of the part it flows through are as close as R1's here (C9h to C9l). PlainSpice never compares a current with the circuit's other currents: it decides from the circuit's own numbers, first which currents are real, then which of the others are 0 (C9d).

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

PlainSpice decides this from the circuit's own numbers, never by comparing a current with the circuit's other currents (decision 0015, `roundingNoise` in `src/spice/describe.ts`). First it finds the currents that are real: one of at least 1 pA, ngspice's current tolerance (abstol, C9c); a current source's own value (C9e); a resistor with a real voltage across it, at least 1 µV and more than 4 steps of a double (C9f, C9l), and a G that reads one; an F that copies a real current; a part next to one whose current PlainSpice does not read (a diode, a transistor, a subcircuit, a switch), which may carry that part's current; and, since the currents at a node add up to 0, the parts that carry the difference where the real currents at a node do not add up to 0, and a part in series with a real current (C9h to C9k). A current below 1 pA that is not real is noise when the circuit makes it 0: a resistor whose two ends are at the same voltage (at most 4 steps of a double apart; a balanced circuit leaves 1 or 2, C9, C9b, C9l); a part that carries the only current left at one of its nodes; an F that copies, or a G that reads, something that is 0. A number below the smallest normal double, 2⁻¹⁰²² (about 2.2e−308), is never noise (C9k). A node voltage below 1 µV, ngspice's voltage tolerance (vntol, C9c), is noise when the node is joined to ground through parts with no voltage across them (here R6). PlainSpice shows each as 0 A or 0 V, and says what ngspice gave in a note.

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

Added after the critic of round 2 (12 November 2026). A 12 V source, 1 kΩ and a current source written `2A`, which SPICE reads as 2 attoamps (unit-letter-1 in traps.md), in one loop. I1 pushes 2e−18 A into node b, and R1 is the only other part there, so R1 carries it, and then V1: the currents at a node add up to 0. 2 aA through 1 kΩ is 2e−15 V, less than the step between two doubles at 12 V (1.8e−15 V), so ngspice gives node b one step above 12 V (12.000000000000002), and R1's current comes out as that one step over 1 kΩ, −1.776e−18 A: the 2 aA to within ngspice's rounding. R1's two ends are as close as R5's in the balanced bridge (C9), but here the circuit makes a current flow, so PlainSpice shows what ngspice gave (R1 1.776 aA, V1 1.735 aA), and the unit-letter check says why it is so small. The same doubles in native 47, native 42 and our engine.

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

R2 has 12 V across it, so it lets 1.2e−13 A through (as in C9f), and R1 is the only other part at node a, so it carries the same current, though it has only 1.2e−12 V across it, 10⁻¹³ of 12 V. Its two ends are 675 steps of a double apart (12 against 11.9999999999988): far more than the 1 or 2 steps a balanced circuit leaves (C9, C9b). The same doubles in native 47, native 42 and our engine.

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

I1's 2 aA now splits between R1 and R2, 1 aA each. ngspice gives each −1.776e−18 A (one step of a double over 1 kΩ, as in C9h) and V1 3.469e−18 A: the currents to within its rounding. Node b has three parts here, so it is the rule for a node, not only for parts in series, that says R1 and R2 carry I1's current: where the real currents at a node do not add up to 0, the node's other parts carry the difference. The same doubles in native 47, native 42 and our engine.

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

The bridge of C9 with a 1e15 Ω resistor from a to ground, as an ideal voltmeter is often drawn. It takes 4.5e−15 A from node a, so a sinks by 9e−12 V and b by 6.3e−12 V, and R5 carries 2.696e−15 A from b to a; solving the netlist's equations exactly, with fractions, gives −2.6946e−15 A. R5's two ends are 3035 steps of a double apart (4.499999999990972 against 4.499999999993667), where the balanced bridge's are 1 apart (C9) and C9b's 1 and 2. Over 300 bridges with random values (resistors written to 15 digits; native 47, native 42 and our engine give the same doubles for all 300; each also solved exactly, with fractions, from the doubles its values are), wherever ngspice's R5 current was rounding noise (at least twice the exact current, or less than half of it), its two ends were at most 2 steps apart, in 104 bridges; wherever they were more than 4 steps apart, in 42, ngspice's current was the circuit's own, within a factor of 2 of the exact one. So PlainSpice takes two voltages as the same only when they are at most 4 steps of a double apart. The same doubles in native 47, native 42 and our engine.

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
  rawfile from ngspice -b -r (exit 1): (no data: header without a Binary: or Values: section)
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
  rawfile from ngspice -b -r (exit 1): (no data: header without a Binary: or Values: section)
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

## How the code uses these facts

| Code | Claims |
|---|---|
| `explain.ts`: R, C, L lines (either way round, open/short in `.op` and `.dc`, 0 Ω, negative values, missing values) | P1, P2, P11–P15b, P24, A31 |
| `explain.ts`: V and I lines (+ node and − node, from node and to node, 0 V ammeters, values in `.op`, PULSE/SIN/PWL/EXP arguments, AC values) | P3, P4, P9, P16–P20b |
| `explain.ts`: E, F, G, H and K lines, and their control sources | P5–P8, P10–P10d, P21, M9 (and missing-value-4 to -7 in traps.md) |
| `explain.ts`: `.op`, `.tf`, `.dc`, `.tran`, `.ac` (`readAnalysis`, `dcSweepPoints`, `acSweepPoints`) | A1–A22b, A31, M10–M15b |
| `explain.ts`: other dot commands, models, subcircuits, unknown dot commands | A2, A2b, A23–A30 (with A29b, A29c), A32–A35, M6, M8 |
| `describe.ts`: directions, power, ammeters, `.tf` words, switches left out, rounding noise shown as 0 A and 0 V | C1–C9g, A3–A6 |
| `describe.ts`: `explainDiagnostic` and the messages of `describeResults` | M1–M21, P10, P13, P15, P16, A6, A11, A26–A29, A33 |

Re-running the evidence: the netlists, the scripts that run them through native ngspice 47, 42 and
our engine, and the generator of this file's evidence blocks were kept outside the repository during
this work (as for numbers-and-syntax.md); the netlists and the native values are in
`tests/golden/facts-explain.test.ts`, which re-runs every netlist through our engine.
