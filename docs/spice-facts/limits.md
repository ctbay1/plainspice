# Fixed spaces: titles and names ngspice copies without checking their length

In a few places ngspice copies a title or a name into a space of fixed size (a C array of 512 or
513 bytes) without checking that it fits. Past the end, native ngspice stops ("buffer overflow
detected", "stack smashing detected") or runs on with its memory overwritten, and PlainSpice's
engine runs on, writes a broken results file or crashes. No real netlist comes near these lengths,
but a link can carry anything, and a title can be a pasted problem statement. So the copy PlainSpice
gives ngspice (`src/spice/run-netlist.ts`, decision [0012](../decisions/0012-netlists-and-links-are-data.md))
keeps inside every space below. This file is the evidence; the claim IDs are named in that code.

**How it was checked (13 November 2026).** Each netlist was run four ways, as for the other facts
([README](README.md)): native ngspice 47 and 42, as `ngspice -b -r out.raw file.cir` (the results
file read back) and as `ngspice -b file.cir`, and our WebAssembly engine, which runs exactly
`ngspice -b -r /out.raw /circuit.cir`. A fifth run finds the writes that native ngspice does not
notice: ngspice 47 built from the same tarball with AddressSanitizer (`-fsanitize=address`),
configured like our engine (`--disable-xspice --disable-osdi --disable-klu --disable-openmp`, the
patches of `engine/patches/`). It stops at the first byte written past a space and names the
space. The overflow places were found in the source and then by running every kind of word (titles,
part, node, model, subcircuit and parameter names, values, formulas, `.save`, `.print`, `.meas`,
`.four`, `.probe`, `.ic`, `.options`, `.control` commands) at 600, 5,000 and 20,000 bytes through
that build; the boundaries below were then found by halving.

The long words are runs of one letter (`W…W`); the netlists show their length instead. glibc prints
"buffer overflow detected" and "stack smashing detected" on standard error (with
`LIBC_FATAL_STDERR_=1`) and ngspice ends with exit code 134. Resource reports are left out.

**The test.** `tests/golden/facts-limits.test.ts` runs the engine's side of each claim on every
`npm run test:golden`, and that the copy PlainSpice runs stays inside.

## limit-1: `ngspice -b -r` stops on a title of more than 504 bytes

**Claim.** Writing its results file, ngspice puts `Title: `, the title and a line end into a space
of 513 bytes (`src/frontend/outitf.c`, `fileInit()`: `char buf[513]; sprintf(buf, "Title: %s\n",
run->name);`), so a title of 504 bytes runs and one of 505 bytes stops ngspice 47 and 42. Bytes of
UTF-8 count: 251 letters `ş` (2 bytes each) after `* ` make 504 bytes and run; one more byte
stops it. The title is line 1, whole, or the words after `.title` on a `.title` line (in any case,
after blanks, anywhere in the netlist: in a subcircuit, and even after `.end`); the last `.title`
line counts. It is the same in `.op`, `.dc`, `.tran`, `.ac` and `.tf`. Without a results file
(`ngspice -b`), ngspice prints the long title and runs.

**Why.** "Title: " is 7 bytes, the line end and the end of the string 2: 7 + 504 + 2 = 513.

```
* W…W                (line 1: 504 bytes, then 505 bytes)
V1 a 0 9
R1 a b 1k
R2 b 0 2k
.op
.end
```

504 bytes, native ngspice 47, `-b -r` (exit 0; ngspice 42 the same):

```
Circuit: * WWWWWWWW…
binary raw file "out.raw"
Doing analysis at TEMP = 27.000000 and TNOM = 27.000000
No. of Data Columns : 3
```

with v(a) = 9, v(b) = 6, i(v1) = −0.003 in the results file. 505 bytes, `-b -r`, ngspice 47 and 42
(exit 134, nothing in the results file):

```
*** buffer overflow detected ***: terminated
```

The same 505 bytes with `-b`, ngspice 47 (42 the same):

```
Circuit: * WWWWWWWW…
Doing analysis at TEMP = 27.000000 and TNOM = 27.000000
	Node                                  Voltage
	b                                6.000000e+00
	a                                9.000000e+00
```

The sanitized build, 505 bytes: `ERROR: AddressSanitizer: stack-buffer-overflow … WRITE of size 514 …
in sprintf … in fileInit src/frontend/outitf.c:917`. The same stop, with `.dc V1 0 9 3`, `.tran 1u
10u`, `.ac dec 2 1k 10k` and `.tf v(b) V1` in place of `.op`, and for `* w` followed by 251 `ş`
(505 bytes); for `.title` + 505 bytes on line 2, `  .TITLE` + 505 bytes, and `.title` + 505 bytes
after `.end`. `.title` + 600 bytes followed by `.title short` runs: the last one counts.

**Our engine** has no such check (Emscripten's C library does not check these copies): titles of 505 to 523
bytes run, with the numbers of a short title, on overwritten memory; 524 bytes crashes it
(`RuntimeError: memory access out of bounds`), 525 and 527 bytes leave a results file without its
`Binary:` part, and 526 bytes and from 528 bytes crash it. A crash is what Playwright's browser
shows as a crashed page (the second re-check's P1).

## limit-2: a title cut to 504 bytes gives the numbers of a short title

**Claim.** The copy PlainSpice runs keeps the first 504 bytes of each title, cut between two
characters (and of each `.title` line's words after `.title`). That copy runs in native ngspice 47
and 42 and in our engine, and gives exactly the vectors of the same netlist titled `* short`, in
`.op`, `.dc`, `.tran`, `.ac` and `.tf` (each version's own, bit for bit; 42's `.tran` differs from
47's in the last bits, title or not). The engine agrees with native 47 to 6 significant figures.

**Why.** ngspice uses the title only in its printout and the results file's header.

Native 47, `-b -r`, the cut copy and `* short`, the same (`.dc V1 0 9 3`):

```
v(v-sweep) = 0, 3, 6, 9    v(a) = 0, 3, 6, 9    v(b) = 0, 2, 4, 6    i(v1) = 0, -0.001, -0.002, -0.003
```

The golden test runs a title of 600 bytes, one of `* w` and 400 `ş`, and `.title` lines of 1,000 bytes
on line 2, in a subcircuit and after `.end`, in all five analyses.

## limit-3: to save a part's current, ngspice copies its full name into a space of 512 bytes

**Claim.** With `.options savecurrents`, ngspice saves the current of each R, C, L, B, F, G, W, S,
M, J, Q, D and I part as `@name[i]` (or `[id]`, `[ic]` …; `src/frontend/inp.c`,
`inp_savecurrents()`), and to save it copies the name, the bytes up to `[`, into a space of 512 bytes
with no check (`src/frontend/outitf.c`, `parseSpecial()`: `char namebuf[BSIZE_SP]`, `BSIZE_SP` =
512). A name of 511 bytes fits; one of 512 bytes is written past the end. Inside subcircuits a
part's full name is its letter, the X lines down to it and its name: `Rz` inside `Xyy` inside `Xxx`
inside `Xzz` is `r.xzz.xxx.xyy.rz`. Native ngspice 47 and 42 run on past the end (exit 0, all
values; a plain copy loop, which glibc's checks do not see); the sanitized build stops at it. Without
`.options savecurrents` the same names run in all of them.

**Why.** `namebuf` holds the name and the end of the string: 511 + 1 = 512.

```
* t
V1 a 0 9
R1 a b 1k
.subckt s3 p q
Rz p q 1k
.ends
.subckt s2 p q
Xyy p q s3
Rw p q 1k
.ends
.subckt s1 p q
Xxx p q s2
.ends
Xzz b 0 s1
.op
.options savecurrents
.end
```

Native ngspice 47 and 42, `-b -r` (exit 0), the results file's vectors:

```
	0	v(a)	voltage
	1	v(b)	voltage
	2	i(v1)	current
	3	i(@r1[i])	current
	4	i(@r.xzz.xxx.xyy.rz[i])	current
	5	i(@r.xzz.xxx.rw[i])	current
```

With `R` + 511 W's (a name of 512 bytes) in place of the subcircuits, and with the same depth of
names (`Xz…z` and `Xy…y` of 200 bytes, `Rr…r` of 108: `r.xz…z.xy…y.rr…r`, 512 bytes): ngspice 47 and
42 exit 0 with every current; the sanitized build: `ERROR: AddressSanitizer: stack-buffer-overflow …
WRITE of size 1 … in parseSpecial src/frontend/outitf.c:1306 … in beginPlot src/frontend/outitf.c:417
… in DCop`. With names of 511 bytes it reports nothing. **Our engine** runs the 512-byte name and
crashes on a part name of 600 bytes (`RuntimeError: memory access out of bounds`), which it runs
without `.options savecurrents`.

## limit-4: on a `.save` line, ngspice copies `i(name)` and `@name[…]` into spaces of 513 and 512 bytes

**Claim.** `.save i(V…)` makes ngspice write `name#branch` into a space of 513 bytes
(`src/frontend/dotcards.c`, `gettoks()`: `char buf[513]; sprintf(buf, "%s#branch", l + 1);`): a
name of 505 bytes runs, 506 bytes stops ngspice 47 and 42 (`-b -r` and `-b`, exit 134):

```
*** buffer overflow detected ***: terminated
```

`.save @R…[i]` and `.save @R2[…]` go through `parseSpecial()` (limit-3): 511 bytes run; at 512 bytes
native ngspice runs on (exit 0) and the sanitized build stops in `parseSpecial`
(`outitf.c:1306`). **Our engine** runs them all, 506 and 512 bytes too.

**Why.** 505 + 7 (`#branch`) + 1 = 513.

## limit-5: in a formula, ngspice copies each name and each `v(…)` into a space of 512 bytes, and reads on past the end of the line after a `v(` with no `)`

**Claim.** Before it reads a formula, ngspice copies each word of it into a space of 512 bytes
(`src/frontend/inpcom.c`, `inp_modify_exp()`: `char buf[512];`): a name, and a `v(…)` or `i(…)`
from its `v` to its `)`, whatever is between. This is done for B sources, and for the B sources
ngspice makes of an E or G source with `VALUE=`, `vol=`, `cur=` or `TABLE`, of R, C and L parts whose
value is a formula with `v(…)` or `i(…)` (an R becomes `i = v(n1, n2)/(…)`, so its two node names
end up in one `v(…)`), of `.func` and of formulas with `temper`. A name or `v(…)` of 511 bytes
runs; at 512 bytes native ngspice 47 and 42 run on (exit 0) and the sanitized build stops
(`stack-buffer-overflow … WRITE of size 1 … in inp_modify_exp src/frontend/inpcom.c:7626 … in
inp_bsource_compat`); for the R, the two node names together: 506 bytes run, 507 do not.

A `v(` or `i(` with no `)` after it is copied until a `)` turns up in memory past the end of the
line: in a B source, an E or G source with a formula and a `.model` line with `temper`. That is a
typo, not a long name. It stops ngspice 47 and 42, or, as what lies past the line differs from run to
run, ends in an error made of the bytes it read:

```
* t
V1 a 0 9
R1 a b 1k
R2 b 0 2k
B1 c 0 V=v(b
R3 c 0 1k
.op
.end
```

Native ngspice 47 and 42, `-b -r` (exit 134):

```
*** stack smashing detected ***: terminated
```

ngspice 47, `-b` (it read bytes past the line, then gave up; exit 1):

```
Preparing expression for numparam
What is this?
��Y���
```

The sanitized build: `ERROR: AddressSanitizer: heap-buffer-overflow … READ of size 1 … in
inp_modify_exp src/frontend/inpcom.c:7622`. The same report for `B1 c 0 I=I(V1)*2+i(V1`,
`E1 c 0 VALUE=v(b`, `E1 c 0 VALUE={v(b}`, `E1 c 0 vol={v(b}`, `E1 c 0 TABLE {v(b} = (0,0) (1,1)`,
`G1 c 0 cur={v(b}`, `G1 c 0 VALUE=v(b` and `.model dm D is={1e-14+temper*0+v(b}` (with
`D1 b 0 dm`); native 47 ends each with exit 134, 42 with 134 or 1. **Our engine** crashes on the B,
E and G ones with `VALUE=`, `vol=` and `cur=` (`RuntimeError: memory access out of bounds`), stops the
`TABLE` one with `Undefined parameter [x]`, and runs the `.model` one, giving v(b) = 1.538 V from a
diode model made of the bytes past the line. In lines that ngspice does not read this way (`R3 c 0 v(b`,
`R3 c 0 {1k+v(b}`, `C3 c 0 {1n+v(b}`, `F1 c 0 Vm {2+temper*0+v(b}`, `E1 c 0 b v(a`, `.tf v(b V1`,
`.save v(b`) ngspice stops with its own message and the sanitized build reports nothing; for
`R3 c 0 v(b`: `ERROR: mal formed resistor instance R: r3 c 0 v(b`.

**Why.** The copy loop stops only at `)`, not at the end of the line: `while (*s != ')') buf[i++] = *s++;`.

## limit-6: a `.control` command is copied whole into a space of 512 bytes

**Claim.** An analysis command of a `.control` block is written with a dot in front into a space of
512 bytes (`src/frontend/spiceif.c`, `if_run()`: `sprintf(buf, ".%s", s)`): `op` and a word of 507
bytes runs, 508 bytes stops ngspice 47 and 42 (`-b -r` and `-b`, exit 134, "buffer overflow
detected"). `print` of a vector whose name is 512 bytes stops them too (`vec_basename()` copies the
name into 512 bytes with `strcpy`); 511 bytes runs. A netlist whose first line starts with
`*ng_script` is all commands. **Our engine** runs on (a `.control` block writes nothing to the
results file, A36).

**Why.** The command's words are joined with single spaces: `.` + `op` + a space + 507 + the end of
the string = 512.

## limit-7: `.save alli` copies `@` and a part's internal node into a space of 512 bytes

**Claim.** `.save alli` saves the currents of the nodes inside a part (a diode with `rs`, a
transistor), and copies `@` and the internal node's name, the part's full name with `#internal` or
`#collector`, into a space of 512 bytes with `strncat`: a diode name of 501 bytes runs, 502 bytes
stops ngspice 47 and 42 (`-b -r` and `-b`, exit 134, "buffer overflow detected"). **Our engine**
runs on.

## limit-8: names ngspice copies into no fixed space

**Claim.** As written (without `.options savecurrents`), names of 20,000 bytes run in native ngspice
47 and 42 (`-b -r`) with the right numbers, the sanitized build reports nothing, and our engine
runs them: a node name, a model name, a parameter name, a subcircuit name, a part name, the names of
a `.tf` line, a comment line. So do long lines of short words: a PWL source of 2,000 points (about
20,000 bytes), a B source of 400 terms, a `.save` of 500 names, a subcircuit of 300 pins. With `-b`
(no results file) the `.tf` of 20,000-byte names stops ngspice 47 and 42 when it prints the
transfer function ("buffer overflow detected"); with `-b -r` it does not.

PlainSpice still gives ngspice words of at most 250 bytes everywhere: one rule for every word, so
that two names, as ngspice joins them in a formula, still fit in 512 bytes.

## PlainSpice's copy (`src/spice/run-netlist.ts`)

| What | The copy ngspice runs | Relies on |
|---|---|---|
| Line 1 and each `.title` line's title over 504 bytes | cut to its first 504 bytes, between two characters; the ngspice output panel says so | limit-1, limit-2 |
| `.op` without `.options savecurrents` | the line is added only while every part's full name (`r.x1.r1`) is at most 500 bytes; else not, and the panel says why | limit-3 |
| A word over 250 bytes (between blanks, brackets, `,` `=` `{ }`, quotes and operators), a part line's first words or a `.save` line's word as ngspice takes them whole | not run: the status line says which line and why | limit-3 to limit-7 |
| A `v(…)` or `i(…)` over 500 bytes in a formula, or a `v(` with no `)` in a B, E or G formula or a `.model` with `temper` | not run | limit-5 |
| A `.control` command (or a line of an `*ng_script` file) over 500 bytes | not run | limit-6 |
| The student's own `.options savecurrents` or `.save alli` with a full part name over 500 bytes | not run | limit-3, limit-7 |

Checked with the sanitized build on 13 November 2026: of 452 netlists (every case above at 600,
5,000 and 20,000 bytes, at the limits and one byte over, and the fact netlists), PlainSpice runs 109
and refuses 343; the 109 copies it runs, at the limits too (words of 250 bytes, a `v(…)` and a
`.control` line of 500, full names of 500 with every current saved), give no AddressSanitizer report
and no stop. Every netlist in the repository (147) gets the same copy as before.

A `.control` block is a small program: it can build a vector's name in a loop, longer than any line,
and PlainSpice cannot see that before ngspice runs it. Such a block writes nothing to the results
file (A36).
