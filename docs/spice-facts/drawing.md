# The drawing lines: what ngspice does with them

PlainSpice can keep a circuit's drawing (where each part sits, the wires, the node names) inside
the netlist, as comment lines, so a circuit from a video opens drawn exactly as in the video
(`src/schematic/format.ts`, decision [0013](../decisions/0013-schematic-model.md)). That is only
safe if ngspice ignores those lines completely. This file is the evidence; the claim's ID is named
in the code that relies on it.

**How it was checked (10 November 2026).** Two netlists that differ only in the drawing lines were
saved as files and run three ways, as for the other facts ([README](README.md)):

- native ngspice 47, built from the release tarball, as `ngspice -b file.cir` and
  `ngspice -b -r out.raw file.cir`;
- native ngspice 42 (Ubuntu's `ngspice 42+ds-3build1` package), the same two ways;
- our WebAssembly engine, which runs exactly `ngspice -b -r /out.raw /circuit.cir`.

The printouts are verbatim; as in the other files, the model and device listings and the resource
report at the end are left out.

**The test.** `tests/golden/facts-drawing.test.ts` runs both netlists through our engine on every
`npm run test:golden`: the vectors must be the same bit for bit and equal to native ngspice 47's, with
no message, and PlainSpice's parser must read every drawing line as a comment.

## drawing-1: ngspice ignores the drawing lines

**Claim.** A line `* plainspice-drawing v1` and lines starting with `*@` (part positions, with
or without a `side=` field, the `part` form for a part named like a keyword, ground symbols, wires
written as `x,y` points, node labels with or without `side=`, fields PlainSpice does not know,
lines PlainSpice cannot read, and a block under another version's header) change nothing: the same
printout, the same results file byte for byte, no warning, in native ngspice 47 and 42 and in our
engine.

**Why.** A line whose first character is `*` is a comment (S6 in
[numbers-and-syntax.md](numbers-and-syntax.md)); the only `*` lines ngspice runs are those starting
with `*#` (S16), and `*@` is not one. The block is written just before `.end`, so it moves no other
line's number.

With the drawing (`with-drawing.cir`):

```
* drawing lines are comments
V1 in 0 6
R1 in out 1k
R2 out 0 2k
.op
* plainspice-drawing v1
*@ V1 0 3 0 m
*@ R1 4 0 270 side=below
*@ R2 7 3 0
*@ part Ground 12 3 90
*@ ground 0 6 0 style=bars
*@ wire 0,1 0,0 2,0
*@ wire 6,0 7,0 7,1
*@ wire 0,5 0,6 7,6 7,5
*@ label in 0 0
*@ label out 7 0 side=above-right
*@ R9 1 2 45 x
*@
* plainspice-drawing v2
*@ R1 4 0 270 anything=1
.end
```

Without it (`without-drawing.cir`):

```
* drawing lines are comments
V1 in 0 6
R1 in out 1k
R2 out 0 2k
.op
.end
```

Native ngspice 47, `ngspice -b with-drawing.cir`:

```
Note: No compatibility mode selected!


Circuit: * drawing lines are comments

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	out                              4.000000e+00
	in                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -2.00000e-03
```

Native ngspice 47, `ngspice -b -r with-drawing-47.raw with-drawing.cir`:

```
Note: No compatibility mode selected!


Circuit: * drawing lines are comments

binary raw file "with-drawing-47.raw"
Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver
No. of Data Columns : 3  

No. of Data Rows : 1
```

Native ngspice 42, `ngspice -b with-drawing.cir`:

```
Using SPARSE 1.3 as Direct Linear Solver

Note: No compatibility mode selected!


Circuit: * drawing lines are comments

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000


No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	out                              4.000000e+00
	in                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -2.00000e-03
```

The same commands on `without-drawing.cir`: in both versions the printouts are identical once the
lines with timings and memory sizes are removed (`diff` prints nothing for `-b`; for `-b -r` it
prints only the line naming the results file, `binary raw file "with-drawing-47.raw"` against
`"without-drawing-47.raw"`), and the results files are identical byte for byte (`cmp -l` lists 0
differing bytes, for 47 and for 42; both runs fell in the same second, so even the `Date:` line
matches). Rawfile values, both netlists, both versions: `v(in)` = 6, `v(out)` = 4,
`i(v1)` = −0.002.

First recorded on 10 November 2026 with the v1 lines alone; recorded again the same day with the
`side=` fields, an unknown field (`style=bars`) and the v2 block added, with the same results.

Our engine, both netlists: exit code 0, no diagnostics, nothing on stderr, the same stdout apart
from timings, and `v(in)` = 6, `v(out)` = 4, `i(v1)` = −0.002, the same doubles as native 47.

**Also relied on by Explain** (final reviews, 12 November 2026). `src/spice/explain.ts` gives a run
of drawing lines one entry, "Lines 11–32: Drawing lines", which says what they are for and that
ngspice skips them because a line starting with `*` is a comment (S6). It finds them the way
`src/schematic/format.ts` does. `tests/golden/facts-explain.test.ts` runs a video example (p01-3,
22 drawing lines) with and without its drawing lines through our engine, checks the same vectors
bit for bit and the same messages, and checks that entry.
