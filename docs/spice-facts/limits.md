# Fixed spaces: titles and names ngspice copies without checking their length

In a few places ngspice copies a title or a name into a space of fixed size (a C array of 100, 512
or 513 bytes) without checking that it fits. Past the end, native ngspice stops ("buffer overflow
detected", "stack smashing detected") or runs on with its memory overwritten, and PlainSpice's
engine runs on, writes a broken results file or crashes. No real netlist comes near these lengths,
but a link can carry anything, and a title can be a pasted problem statement. So the copy PlainSpice
gives ngspice (`src/spice/run-netlist.ts`, decision [0012](../decisions/0012-netlists-and-links-are-data.md))
keeps inside every space below, but for one way past it that we know: what a `.control` block computes
while it runs (limit-11). This file is the evidence; the claim IDs are named in that code.

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
that build; the boundaries below were then found by halving. A second pass, the same day, read every
fixed-size `char` array of the source that the netlist's text can reach (`src/frontend`, the parser,
`src/misc` and the devices our engine is built with) and ran each that copies without a bound:
limit-9 (a model's version) and limit-10 (names made inside subcircuits, printed by a `.control`
block) came from it, and the place where a line's comment starts (limit-5). The rest copy with a bound
(`snprintf`, `strncpy`), hold only numbers, sit in commands a netlist does not reach in batch mode
(`.meas` is refused with `-r`: "No .measure possible in batch mode (-b) with -r rawfile set!"), or
belong to models our engine leaves out (`OUTerror`, used only by HiSIM-HV 2). A third pass, after a
review of the first fix, ran what ngspice does to a line before it copies it, which the first two
missed: it takes the blanks out of brackets (limit-13), joins string parameters (limit-14), makes the
names of a `.probe` line (limit-15), builds circuits with `circbyline` inside each other (limit-16),
names a `print` or `write` formula with its text and writes a wrong `meas` word into 100 bytes
(limit-17); and it found that of the `.control` commands only the analyses are copied whole (limit-6).

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
line counts. On line 1 native ngspice 47 and 42, built with XSPICE, read a line that starts with a
blank as written: ` .title ` and 497 letters is a title of 505 bytes there and stops them, while our
engine and the sanitized build, built without XSPICE, take the 497 letters; `.title` at the very start
of line 1 is a `.title` line to all of them. It is the same in `.op`, `.dc`, `.tran`, `.ac` and `.tf`.
Without a results file (`ngspice -b`), `.op` and `.tf` print the long title and run; `.dc`, `.tran` and
`.ac` with no `.print` line run nothing there, whatever the title (ngspice 47: "Error: incomplete or
empty netlist", exit 1; ngspice 42: exit 1).

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
after `.end`. `.title` + 600 bytes followed by `.title short` runs: the last one counts. Line 1 of
` .title ` and 496 letters (504 bytes) runs in native 47 and 42; with 497 letters, `-b -r` (exit 134):
"*** buffer overflow detected ***: terminated" (`-b` runs; the sanitized build runs both). Line 1 of
`.title ` and 498 letters (505 bytes) runs in all of them.

**Our engine** has no such check (Emscripten's C library does not check these copies): titles of 505 to 523
bytes run, with the numbers of a short title, on overwritten memory. From 524 to 527 bytes it leaves a
results file without its `Binary:` part or crashes (`RuntimeError: memory access out of bounds`), as
what lies past the space differs: 524 bytes gave the first when the engine was started from the wasm
bytes and the second when it was started from a compiled module, each every time; 525 and 527 gave the
first and 526 the second both ways. Every length we ran from 528 to 560 bytes, and 600 and 1,000,
crashes it. A crash is what Playwright's browser shows as a crashed page (the second re-check's P1).

## limit-2: a title cut to 504 bytes gives the numbers of a short title

**Claim.** The copy PlainSpice runs keeps the first 504 bytes of each title, cut between two
characters: of line 1, whole, and of each `.title` line's words after `.title`. That copy runs in native ngspice 47
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
(`outitf.c:1306`). **Our engine** runs them all, 506 and 512 bytes too. gettoks takes the blanks out
of the brackets first, so `.save i( a b c )` is the name `abc` (limit-13).

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
`D1 b 0 dm`); native 47 and 42 end each with exit 134 or 1, from run to run (the B source and the E
source with `VALUE=` gave 134 in one run of both and 1 in another). **Our engine** crashes on the B,
E and G ones with `VALUE=`, `vol=` and `cur=` (`RuntimeError: memory access out of bounds`), stops the
`TABLE` one with `Undefined parameter [x]`, and runs the `.model` one, giving v(b) = 1.538 V from a
diode model made of the bytes past the line. In lines that ngspice does not read this way (`R3 c 0 v(b`,
`R3 c 0 {1k+v(b}`, `C3 c 0 {1n+v(b}`, `F1 c 0 Vm {2+temper*0+v(b}`, `E1 c 0 b v(a`, `.tf v(b V1`,
`.save v(b`) ngspice stops with its own message and the sanitized build reports nothing; for
`R3 c 0 v(b`: `ERROR: mal formed resistor instance R: r3 c 0 v(b`.

**Why.** The copy loop stops only at `)`, not at the end of the line: `while (*s != ')') buf[i++] = *s++;`.

**Where the line ends for ngspice.** ngspice cuts an end-of-line comment before it reads a formula
(`src/frontend/inpcom.c`, `inp_stripcomments_line()`): at a `;`, at `//`, and at a `$` only after a
blank, a comma or a tab (inside a `.control` block: at a `$` before a blank), and never inside quotes.
So a `$` glued to a word, or a `;` in quotes, starts no comment, and a `v(` after it with no `)` is read
past the end of the line like the ones above:

```
B1 c 0 V=1$+v(b
B1 c 0 V=1 *$ v(b
B1 c 0 V=v(b)*1 ";" + v(b
B1 c 0 V=v(b)*1 ';' + v(b
```

(each in place of `B1` in the netlist above): native ngspice 47 and 42, `-b -r` and `-b` (exit 134):

```
*** stack smashing detected ***: terminated
```

The sanitized build: `ERROR: AddressSanitizer: heap-buffer-overflow … READ of size 1 … in
inp_modify_exp … in inp_bsource_compat`, for all four. **Our engine** crashes on the last three
(`RuntimeError: memory access out of bounds`) and stops the first with `YYparse error, syntax error,
in expression` (exit 1). With the comment really a comment, `B1 c 0 V=v(b) $ v(b`, `B1 c 0 V=v(b),$ v(b`,
`B1 c 0 V=v(b)<tab>$ v(b`, `B1 c 0 V=v(b); v(b` and `B1 c 0 V=v(b) // v(b` run in all of them, with
v(c) = 6 V (exit 0; the sanitized build reports nothing).

A comment's words reach no space: `R2 b 0 2k ; ` followed by 20,000 letters, the same after `$ ` and
after `// `, and a `.control` block's `op $ ` and `print v(b) ; ` each followed by 20,000 letters, run in
native 47 and 42 (`-b -r` and `-b`, exit 0); the sanitized build reports nothing, and our engine gives
v(b) = 6 V, i(@r1[i]) = 3 mA, as native 47 does. So PlainSpice never reads a comment's words, nor a
`.model` line's version in one (`version=3.3.0 ; version=` and 150 letters runs, exit 0).

## limit-6: an analysis command of a `.control` block is copied whole into a space of 512 bytes

**Claim.** An analysis command of a `.control` block (`op`, `tran`, `ac`, `dc`, `tf`, `noise`, `pz`,
`disto`, `sens`, `adjsen`, and in builds with them `pss`, `sp` and `hb`; in any case) is written with a
dot in front, its words joined with one blank each, into a space of 512 bytes
(`src/frontend/spiceif.c`, `if_run()`: `s = wl_flatten(args); sprintf(buf, ".%s", s)`): `op` and a word
of 507 bytes runs, 508 bytes stops ngspice 47 and 42 (`-b -r` and `-b`, exit 134, "buffer overflow
detected"), and so do `op` and five words of 100 bytes and one of 3 (508 bytes joined), and `OP` and a
word of 508. No other command is copied this way: a `print` line of 525 and of 755 bytes, an `echo` of
1,495 and a `let` of 1,007 run in native 47 and 42 (`-b -r` and `-b`, exit 0), and the sanitized build
reports nothing. `print` of a vector whose name is 512 bytes stops them (`vec_basename()` copies the
name into 512 bytes with `strcpy`); 511 bytes runs (limit-10, limit-17). A netlist whose first line
starts with `*ng_script` is all commands. **Our engine** runs on (a `.control` block writes nothing to
the results file, A36), and gives what native 47 and 42 print for the long `print` line: `v(b) =
6.000000e+00`, once for each of its 104 `v(b)`.

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
(no results file) two more places stop ngspice 47 and 42 ("buffer overflow detected"): printing the
transfer function of a `.tf` with 20,000-byte names, and a `.print dc v(n1,n2)` with two node names of
300 bytes, which `fixem()` (`src/frontend/dotcards.c`) rewrites into 512 bytes (with names of 200
bytes it runs). With `-b -r` neither does: ngspice writes the results file instead and skips `.print`
lines.

PlainSpice still gives ngspice words of at most 250 bytes everywhere: one rule for every word, so
that two names, as ngspice joins them in a formula, still fit in 512 bytes. Two is not always the most:
a `.probe` line's formula joins a part's name, a terminal's and a node's in one word (limit-15), and
ngspice joins words written apart in brackets (limit-13). There PlainSpice measures the word ngspice
makes, not the names in it. The names ngspice makes inside subcircuits keep to the same 250 bytes
(limit-10): those reach the spaces of limit-3, limit-7 and limit-10.

## limit-9: a `.model` line's version is copied into a space of 100 bytes

**Claim.** For a MOSFET model of level 8 or 49 (BSIM3) or 14 or 54 (BSIM4), ngspice looks for
`version` on the `.model` line and copies the word after it, up to a blank, into a space of 100 bytes
with no check (`src/spicelib/parser/inpfindv.c`, `INPfindVer()`: `where = strstr(line, "version");`,
then blanks, `=`, `,`, `(`, `)` and `+` skipped, then `sscanf(where, "%s", version)` into `char
ver[100]` of `INPdomodel()`). It does so only when a part uses the model, and before it looks for the
model in its build, so our engine, which leaves BSIM3 and BSIM4 out, copies it too. A version of 99
bytes fits; at 100 bytes the end of the string is written past the space; from 150 bytes native
ngspice 47 and 42 stop.

**Why.** The word and the end of the string: 99 + 1 = 100.

```
* t
V1 a 0 9
R1 a b 1k
M1 b b 0 0 mm
R2 b 0 2k
.model mm nmos level=8 version=4W…W     (the version: 99, 100, 150 bytes)
.op
.end
```

99 bytes, native ngspice 47, `-b -r` (exit 1; ngspice 42 the same, and `-b` too; the version names
no BSIM3 version):

```
Error on line 4 or its substitute:
  m1 b b 0 0 mm
could not find a valid modelname
    Simulation interrupted due to error!
Error: circuit not parsed.
```

100 bytes: the same printout and exit code in native 47 and 42; the sanitized build: `ERROR:
AddressSanitizer: stack-buffer-overflow … WRITE of size 101 … in __isoc23_sscanf … in INPfindVer`.
150 bytes, and `level=14` with 150 bytes, native 47 and 42, `-b -r` and `-b` (exit 134):

```
*** stack smashing detected ***: terminated
```

The same 150-byte model with no part using it runs in all of them (exit 0, v(b) = 6). **Our engine**
gives the 99- and 100-byte ones the same "could not find a valid modelname" (exit 1), crashes on the
150-byte ones (`RuntimeError: memory access out of bounds`, levels 8 and 14) and runs the unused one.

## limit-10: a `.control` block prints a name made inside subcircuits through spaces of 512 bytes

**Claim.** Inside subcircuits ngspice names a node with the X lines in front, `x1.x2.n1`, and a
part with its letter too, `r.x1.x2.r1` (limit-3), so a full name can be much longer than any word
written in the netlist. A `.control` block that prints it copies it whole into 512 bytes: `print`
with `strcpy` (`src/frontend/vectors.c`, `vec_basename()`, lines 1122 to 1126), `display` with the
words around it (`src/frontend/plotting/pvec.c`, line 15: `sprintf(buf, "    %-20s: %s, %s, %d long",
d->v_name, …)`). A node of 511 bytes prints; 512 bytes stop native 47 and 42; `display` stops them
from 490 bytes. Without a `.control` block, and without saving currents (limit-3), the same names run.

**Why.** For `print`: the name and the end of the string, 511 + 1 = 512. For `display`: four blanks,
the name, ": ", the vector's type and "real" or "complex", and its length, which pass 512 bytes with a
name of about 480.

```
* t
V1 a 0 9
R1 a b 1k
.subckt inner p q
Ri p n…n 1k
Rj n…n q 1k
.ends
.subckt outer p q
Xb…b p q inner
.ends
Xa…a b 0 outer
.op
.control
op
print all        (or display)
.endc
.end
```

`Xa…a` and `Xb…b` of 250 bytes and a node of 9 bytes make `xa…a.xb…b.n…n` 511 bytes: native 47 and 42
run it (exit 0). With a node of 10 or 18 bytes (512, 520), native ngspice 47 and 42, `-b -r` and
`-b` (exit 134):

```
*** buffer overflow detected ***: terminated
```

With `display`, X names of 150 bytes and full names of 480 and 490 bytes: 480 runs; 490 stops native
47 and 42 the same way, and the sanitized build reports `stack-buffer-overflow … WRITE of size 518 …
in pvec src/frontend/plotting/pvec.c:15 … in com_display`. The 600-byte name without the `.control`
block runs everywhere (exit 0, v(b) = 6, the sanitized build reports nothing). **Our engine** prints
511 and 512 bytes and crashes on 520 (`RuntimeError: memory access out of bounds`); with `display`
it runs on at 490 bytes, its memory overwritten.

At PlainSpice's limit, every full name 250 bytes (X names of 100 bytes and a node of 48, or parts
`r.x….x….r…` and `d.x….x….d…` of 250 with `rs`), with `print all`, `display`, `.save alli` and
`.options savecurrents`: native 47 and 42 run them, the node at v = 3 V and the currents in the
results file, the sanitized build reports nothing, and our engine gives the same numbers.

## limit-11: a `.control` block can make a name while it runs

**Claim.** A `.control` block is a small program: it can join variables into a word longer than any
line, and use it as a vector's name. Nothing in the netlist's text is long, so PlainSpice cannot see
it before ngspice runs it. Here every line is short and every word at most 100 bytes:

```
* t
V1 a 0 9
R1 a b 1k
R2 b 0 2k
.op
.control
op
set s = a…a          (100 bytes)
set t = $s$s$s$s$s$s
let $t = 1
display
.endc
.end
```

Native ngspice 47 and 42, `-b -r` and `-b` (exit 134):

```
*** buffer overflow detected ***: terminated
```

The sanitized build: `stack-buffer-overflow … WRITE of size 627 … in pvec` (limit-10). **Our
engine** runs on (exit 0, with the results of `.op`), its memory overwritten.

Variables are one of the block's ways to make a word while it runs; an alias is another. With
`alias xx op` and then `xx` followed by words of 250, 250 and 10 bytes, no line says `op` with those
words, but ngspice puts `op` in place of `xx` and writes `.op` and the words into 512 bytes (limit-6):
native 47 and 42, `-b -r` and `-b` (exit 134), "*** buffer overflow detected ***: terminated"; the
sanitized build: `stack-buffer-overflow … WRITE of size 517 … in if_run`. PlainSpice gives ngspice such
a block as written: what a `.control` block computes while it runs is the one way past the checks below
that we know of.

## limit-12: ngspice reads the lines of `circbyline` commands as a netlist, with the same spaces

**Claim.** A `.control` block or an `*ng_script` file can build a circuit line by line with
`circbyline`: ngspice keeps each line (the command's words, joined with one blank each) and, at
`circbyline .end`, reads them as a netlist, the way it reads a file; the next `circbyline` line starts
another circuit. That netlist meets every space above: a B source without its `)` (limit-5) and a node
made inside subcircuits, printed (limit-10), stop native ngspice and crash our engine as they do in a
netlist written out. Its title, and a circuit built inside it, are limit-16.

```
*ng_script
circbyline * t
circbyline V1 a 0 9
circbyline R1 a b 1k
circbyline R2 b 0 2k
circbyline B1 c 0 V=v(b
circbyline R3 c 0 1k
circbyline .end
op
print all
```

Native ngspice 47 and 42, `-b -r` and `-b`: they stop, with exit 134 (`*** stack smashing detected
***: terminated`) or 139 (a crash), from run to run; so does the same circuit built by `circbyline`
lines in a `.control` block of an ordinary netlist. With `X` names of 250 bytes and a node of 18
inside (`xa…a.xb…b.n…n`, 520 bytes), `print all` stops native 47 and 42, `-b -r` and `-b` (exit 134):

```
*** buffer overflow detected ***: terminated
```

**Our engine** crashes on all three (`RuntimeError: memory access out of bounds`). At PlainSpice's
limit, `X` names of 100 bytes and a node of 48 (250 bytes), native 47 and 42 and our engine run it
(exit 0) and print the same line:

```
xa…a.xb…b.n…n = 3.000000e+00
```

## limit-13: ngspice takes the blanks out of brackets, so words written apart become one name

**Claim.** In three places ngspice takes the blanks out of brackets before it reads the names in them
(`stripWhiteSpacesInsideParens()`, `src/misc/string.c`: after each `(`, every blank up to the first
`)`): gettoks, for the words of a `.save`, `.print`, `.plot`, `.four` or `.meas` line
(`src/frontend/dotcards.c`); `inp_meas_current()`, for a part's line with an `i(…)` of a part that is
not a voltage source, which it then writes that way (`src/frontend/inpcom.c`); and the expression reader
of `print`, `write`, `plot`, `meas` and the other commands that read vectors, when the command has a
`v(` or an `i(` (`ft_getpnames_quotes()`, `src/frontend/parse.c`). Words written apart then make one
name, which meets the spaces above: `.save i( a b c )` writes `abc#branch` into 513 bytes (limit-4), a B
source copies the joined name into 512 (limit-5), and `print v( … .x )` copies it, up to the dot, into
512 (`vec_get()`, `src/frontend/vectors.c`: `for (i = 0, s = word; *s != '.'; i++, s++) buf[i] = *s;`).

**Why.** `.save i( ` + 250 + ` ` + 250 + ` ` + 6 + ` )` is the name of 506 bytes: 506 + 7 (`#branch`) + 1 =
514, one more than 513.

```
* t
V1 a 0 9
R1 a b 1k
R2 b 0 2k
.save i( W…W W…W W…W )     (250, 250 and 5 or 6 letters; or three of 200, between blanks or tabs)
.op
.end
```

505 bytes joined, native 47 and 42, `-b -r` (exit 1; the name is no source):

```
Error: no data saved for D.C. Operating point analysis; analysis not run
```

506 bytes, and 600 (three of 200, with blanks or with tabs), native 47 and 42, `-b -r` and `-b` (exit 134):

```
*** buffer overflow detected ***: terminated
```

The sanitized build: `stack-buffer-overflow … WRITE of size 514 … in sprintf … in gettoks
src/frontend/dotcards.c:681 … in ft_dotsaves` (608 for 600). The same 600 bytes on a `.print dc`,
`.plot dc`, `.four` or `.meas tran` line stop native 47 and 42 with `-b` ("buffer overflow detected"),
not with `-b -r`, where ngspice skips those lines (limit-8).

`B1 c 0 V=i(R1)*1+( W…W W…W W…W )`: with 511 letters in the brackets, native 47 and 42 stop with their own
message ("Error in netlist line no. 8, new internal line no. 5", exit 1) and the sanitized build
reports nothing; with 512 the same message, and the sanitized build stops in `inp_modify_exp`
(`stack-buffer-overflow … WRITE of size 1 … inpcom.c:7635 … in inp_bsource_compat`); with 600, native 47
and 42, `-b -r` and `-b` (exit 134): "*** stack smashing detected ***: terminated". With `i(V1)` (a
source's own current, which ngspice leaves as it is) or no `i(`, the blanks stay and the 600 letters
give only the message.

`print v( W…W W…W W…W .x )` in a `.control` block: 511 letters before the dot run (native 47 and 42, exit
0, nothing reported); at 512 native 47 and 42 run on and the sanitized build stops in `vec_get`
(`WRITE of size 1 … vectors.c:592 … in PP_mksnode`); at 600 native 47 and 42 stop (exit 134, "stack
smashing detected"). `echo` and `let` take out no blanks: the same 600 letters run (`let` with "syntax
error in line segment").

**Our engine** crashes on the `.save` line of 600 bytes, with blanks or with tabs, and on the B source
of 600 (`RuntimeError: memory access out of bounds`); it runs the `.save` line of 506 with ngspice's
message ("no data saved …") where native 47 and 42 stop, and runs on with `print v( … .x )` at 512.
PlainSpice measures these words as ngspice joins them, at most 250 bytes (limit-8's rule). At that
limit, `.save i( W…W W…W W…W ) v(b)` with 100, 100 and 47 letters runs in native 47 (v(b) = 6, i(@r1[i]) =
i(@r2[i]) = 3 mA) and in our engine with the same numbers.

## limit-14: string parameters are joined, and their text goes where `{…}` is

**Claim.** numparam joins quoted texts and string parameters written together into one text
(`string_expr()`, `src/frontend/numparam/xpressn.c`: `"a""b"{s}`, or a bare name), in a `.param` line (in a
subcircuit too), in a `.subckt` line's defaults (`params: t="…"`) and in an X line's values; and it puts
the text in place of `{t}`, with a blank on each side (`stripbraces()` and `insertnumber()`,
`src/frontend/numparam/spicenum.c` and `xpressn.c`). No word of the netlist is long, but the text is: as a
node printed by a `.control` block (limit-10), in a `.save` line's brackets, which gettoks joins
(limit-13), and as a model's version (limit-9). A number takes at most 23 bytes there (`"% 23.15e"`,
without its blanks), but numbers in a `.save` line's brackets join too.

With `.param t="W…W""W…W""W…W"` (three of 200 letters, a text of 600 bytes):

- `.save i({t}) v(b)`: native 47 and 42, `-b -r` and `-b` (exit 134), "*** buffer overflow detected
  ***: terminated"; the sanitized build: `WRITE of size 608 … in gettoks`.
- `R2 b {t} 2k`, `R3 {t} 0 1k` and a `.control` block with `op` and `print all`: native 47 and 42,
  `-b -r` and `-b` (exit 134), "buffer overflow detected". Without the `.control` block it runs (exit 0).
- The same text as a `.subckt` line's default, as an X line's value (over a default of `"a"`), or in a
  `.param` line inside the subcircuit, with `Rx p {t} 1k` and `Ry {t} q 1k` inside and `print all`:
  native 47 stops ("buffer overflow detected", exit 134); native 42 does not read these forms ("error.",
  exit 1).

`.param t="4W…W""W…W"` (a text of 150 bytes) and `.model mm nmos level=8 version={t}` with `M1 b b 0 0
mm`: native 47 and 42, `-b -r` and `-b` (exit 134), "*** stack smashing detected ***: terminated"; the
sanitized build: `WRITE of size 151 … in INPfindVer`. A text of 90 bytes gives ngspice's own "could not
find a valid modelname" (exit 1, nothing reported); 100 bytes the same message, and the sanitized build
stops (`WRITE of size 101`). `.save i({1}{1}…)` with 30 numbers: native 47 and 42 (exit 134), "buffer
overflow detected" (sanitized: `WRITE of size 638 … in gettoks`); with 10 numbers it runs.

At PlainSpice's limit, a text of 250 bytes (`"W…W""W…W"`, 125 and 125) as the node, printed: native 47 and
42 run it (exit 0), with v(b) = 6.75 V and the node at 2.25 V (ngspice writes the text in lower case);
the sanitized build reports nothing; our engine gives the same numbers.

**Our engine** crashes on all of the 600-byte netlists above and on the version of 150
(`RuntimeError: memory access out of bounds`). PlainSpice works out the longest text each string
parameter can stand for (every definition counts, in subcircuits and X lines too, and the parameters
it names), and measures it where `{…}` puts it: at most 250 bytes as a word or joined in a `.save`
line's brackets (a number counted at its longest, 23 bytes), and 90 as a version.

## limit-15: a `.probe` line's names, and the formula it writes for `p(…)`

**Claim.** A `.probe` line makes ngspice add 0 V sources and name what they measure from the names of a
part, its terminals and its nodes (`inp_probe()` and `setallvsources()`, `src/frontend/inpc_probe.c`):
`i(R1)` and `alli` keep `r1#branch` (or `r1:<terminal>#branch` for each terminal of a part with more
than two), `vd(a,b)` keeps `vd_a:b`, `vd(R1:1,R2:2)` keeps `vd_r1:n1_r2:n2`, and `p(R1)` keeps `r1:power`
and writes a B source whose formula holds, for each terminal, `i(vcurr_r1:probe_int_<terminal>:<n>_<node>)`
and `v(probe_int_<node>_r1_<n>)`. A terminal's name is `n1`, `n2` … for most parts, `a` and `c` for a
diode, `d` `g` `s` `b_tj` … for a MOSFET, `c` `b` `e` … for a bipolar transistor, and the subcircuit's own
pin name for an X line (`get_terminal_name()`). The formula's words go into 512 bytes (limit-5), and a
`.control` block's `print` and `display` copy the names it keeps into 512 (limit-10).

**Why.** With nodes of 250 bytes, `i(vcurr_` + the part + `:probe_int_n1:1_` + the node + `)` is the two
names and 25 bytes: a part of 236 bytes makes 511 and fits; 237 makes 512.

```
* t
V1 a…a 0 9              (nodes a…a and b…b of 250 bytes)
R… a…a b…b 1k           (a part of 225, 236, 237 or 245 bytes)
R2 b…b 0 2k
.probe p(R…)
.op
.end
```

236 bytes: native 47 and 42 and the sanitized build run it (exit 0, nothing reported). 237 and 245:
native 47 and 42 run on (exit 0, a plain copy loop), and the sanitized build stops in `inp_modify_exp`
(`stack-buffer-overflow … WRITE of size 1 … inpcom.c:7626 … in inp_bsource_compat`); the same for
`p(X…)` of a 245-byte X line. A part of 225 bytes (a formula word of 500): native 47 (`-b -r`) gives
`r…:power` = 9 mW and v(b…) = 6 V, and our engine the same.

`vd(X…:1, X…:2)` of an X line of 250 bytes whose subcircuit has pins of 250 makes a name of 1,006 bytes:
without a `.control` block native 47 and 42 run it (exit 0); with `print all`, native 47 and 42 (exit
134): "*** buffer overflow detected ***: terminated". `i(X…, 1)` there with `display` (sanitized: `WRITE
of size 536 … in pvec`), and `vd(a…, b…)` of two 250-byte nodes with `display` (`WRITE of size 532 … in
pvec`), stop them the same way.

**Our engine** crashes on `p(R…)` of 245 bytes (`RuntimeError: memory access out of bounds`), ends
`p(X…)` of 245 in "YYparse error", and runs on with the printed names. PlainSpice works out these names
as `inp_probe` makes them: a word of the formula at most 500 bytes, as any formula's (limit-5), and a
name it keeps at most 250 (limit-8's rule).

## limit-16: a circuit built with `circbyline` has a title, and must not build one itself

**Claim.** A circuit built with `circbyline` (limit-12) starts at the first `circbyline` line after the
last `circbyline .end`, and its first line is its title: the command's words joined with one blank each
(`com_circbyline()` and `create_circbyline()`, `src/frontend/inp.c`). Writing its results file
(`-b -r`), ngspice copies that title into the 513 bytes of limit-1: a title of 504 bytes made of short
words runs, and 505 stops native 47 and 42, in the first circuit or in a second one. A circuit built
with `circbyline` that builds one itself (its own `.control` block, or its first line `*ng_script`,
has `circbyline` commands) makes ngspice write into the array of lines after reading it has freed it:
native 47 and 42 crash.

```
*ng_script
circbyline * ab ab … abcd     (a title of 504 bytes: "*", 166 times "ab", then "abcd"; with "abcde": 505)
circbyline V1 a 0 9
circbyline R1 a b 1k
circbyline R2 b 0 2k
circbyline .op
circbyline .end
op
print all
```

504 bytes: native 47 and 42 (exit 0) print `a = 9.000000e+00` and `b = 6.000000e+00`. 505 bytes, native
47 and 42, `-b -r` (exit 134; with `-b`, without a results file, they run):

```
*** buffer overflow detected ***: terminated
```

The sanitized build: `WRITE of size 514 … in fileInit`. A circuit built inside a built one (an
`*ng_script` circuit whose lines are `circbyline` commands, or a `.control` block of them inside):
native 47 and 42, `-b -r` and `-b`, crash (exit 139); the sanitized build: `SEGV on unknown address …
in create_circbyline src/frontend/inp.c:2098 … in com_circbyline`.

**Our engine** runs the 505-byte title on (exit 0), and reads no circuit from the nested ones ("there
aren't any circuits loaded", or exit 0 without results). PlainSpice checks each circuit once: its title
at most 504 bytes, as ngspice joins its words, its lines as a netlist, and no `circbyline` inside it.
Checked once, the work no longer grows with the depth: 250 kB of `circbyline` commands nested 100 deep,
which a link of 2 kB can hold, took a second of processor time to check at every pause; now 21 ms
(load 0.2).

## limit-17: `print` and `write` name a formula with its text; `meas` writes a wrong word into 100 bytes

**Claim.** `print` and `write` name what a formula gives with the formula's text, without its blanks,
and copy that name into 512 bytes (`vec_basename()`, limit-6): a formula of 509 bytes prints, 514 stops
native 47 and 42. `let`, `wrdata`, `plot`, `asciiplot`, `fourier` and `if` with the same formula of 999
bytes run. A `meas` command writes a word it cannot use, with its message, into a space of 100 bytes
(`char errbuf[100]` of `get_measure2()`, `src/frontend/com_measure2.c`: `sprintf(errbuf, "no such
vector as '%s'\n", meas->m_vec)`, and "bad syntax, cannot evaluate right hand side of %s=%s"): a vector
of 78 bytes that does not exist gives the message, 79 overflows.

```
* t
V1 a 0 9
R1 a b 1k
R2 b 0 2k
.op
.control
op
print v(b)+v(b)+…+v(b)     (102 terms: 509 bytes; 103 terms: 514)
.endc
.end
```

509 bytes: native 47 and 42 (exit 0) print it. 514 bytes, and 999 with `print` or with `write`, native 47
and 42, `-b -r` (exit 134):

```
*** buffer overflow detected ***: terminated
```

With 50 terms (249 bytes) native 47 and 42 print `v(b)+v(b)+…+v(b) = 3.000000e+02`, and so does our
engine. After `tran 10u 2m` in a `.control` block, `meas tran x max` and a vector of 78 letters that does
not exist gives "no such vector as …" (exit 0); 79 letters: the sanitized build stops (`WRITE of size
101 … in measure_parse_trigtarg`); `v(` and 100 letters: native 47 gives the message and stops (exit 134).

**Our engine** crashes on `write` of the 999-byte formula (`RuntimeError: memory access out of
bounds`), runs on with `print` of it, and gives the `meas` message at 79 letters. PlainSpice gives a
`print` or `write` formula at most 250 bytes, each formula on its own (`print v(a) v(b)` is two), and a
`meas` word at most 50 (a `name=value` as one word: the longest message leaves 50 bytes for both).

## PlainSpice's copy (`src/spice/run-netlist.ts`)

| What | The copy ngspice runs | Relies on |
|---|---|---|
| Line 1, whole, and each `.title` line's title over 504 bytes | cut to its first 504 bytes, between two characters; the ngspice output panel says so | limit-1, limit-2 |
| `.op` without `.options savecurrents` | the line is added before `.end` | limit-3 (with the rows below, every name it saves fits) |
| A word over 250 bytes (between blanks, brackets, `,` `=` `{ }`, quotes and operators), a part line's first words or a `.save` line's word as ngspice takes them whole | not run: the status line says which line and why | limit-3 to limit-7 |
| A name ngspice makes inside subcircuits (`r.x1.x2.r1`, `x1.x2.n1`) over 250 bytes | not run | limit-3, limit-7, limit-10 |
| A `v(…)` or `i(…)` over 500 bytes in a formula, or a `v(` with no `)` in a B, E or G formula or a `.model` with `temper` | not run | limit-5 |
| An end-of-line comment, cut where ngspice cuts it | never read | limit-5 |
| An analysis command of a `.control` block (or an `*ng_script` file) over 500 bytes, as ngspice writes it: a dot, then its words with one blank each | not run | limit-6 |
| A `.model` line's version over 90 bytes | not run | limit-9 |
| The lines of `circbyline` commands (in a `.control` block or an `*ng_script` file) | checked as the netlist ngspice reads from them, one circuit at each `.end`, by every row above; a problem is said at the command's line | limit-12 |
| Words ngspice joins by taking the blanks out of brackets (a `.save`, `.print`, `.plot`, `.four` or `.meas` line, a part's line with an `i(…)` of a part, `print`, `meas` and the other commands that read vectors) over 250 bytes joined | not run | limit-13 |
| The text a string parameter stands for, where `{…}` puts it: over 250 bytes as a word or joined in a `.save` line's brackets (numbers too), over 90 as a version | not run | limit-14 |
| A name a `.probe` line makes over 250 bytes, or a word of its `p(…)` formula over 500 | not run | limit-15 |
| A circuit built with `circbyline` whose title is over 504 bytes, as ngspice joins its words, or that has a `circbyline` command itself | not run | limit-16 |
| A `print` or `write` formula over 250 bytes (its text without blanks), a `meas` word over 50 | not run | limit-17 |

Checked with the sanitized build on 13 November 2026, twice. First: of 414 netlists (every case above at
600, 5,000 and 20,000 bytes, at the limits and one byte over, and the fact netlists), PlainSpice ran 137
and refused 277; 133 of the 137 copies gave no AddressSanitizer report and no stop. Then, after a review
of that fix: of 1,154 netlists (those, the review's own, and every case of limit-6 and limit-13 to
limit-17 at the limits and one byte over), PlainSpice runs 301 and refuses 853. Of the 301 copies it runs,
291 give no AddressSanitizer report, and native 47 and 42 run them without a stop. Of the other ten,
three are limit-11 (`display` of a name a variable makes, twice, and `alias`); five are lines that start
with a vertical tab, or a byte order mark and a blank, before `.title`, which ngspice 47 and 42 refuse
("unimplemented dot command '.title'") and on which the sanitized build reports `memcpy-param-overlap`
at any length (`.title x` too): no write past a space; and two include a file that crashes native
ngspice for no length: `.include /proc/meminfo` (native 47 ends with a crash, exit 139; the sanitized
build reports a SEGV in `ciprefix`) and a netlist that includes itself (native 47 and 42, exit 139). Our
engine crashes on one of the 301, for no length either: a netlist that includes itself (`.include
/circuit.cir`, "Maximum call stack size exceeded"). Every netlist in the repository (147) gets the same
copy as on b060bc8.

A `.control` block can still go past the checks while it runs (limit-11); it writes nothing to the
results file (A36), so PlainSpice shows its words in the ngspice output panel only.
