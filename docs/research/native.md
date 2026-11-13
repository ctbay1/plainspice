# Native ngspice ground truth: fixtures, conventions, traps (ngspice 42 and 47)

Date: 2026-11-09. Everything below was obtained by running native ngspice; nothing about SPICE behaviour is
from memory. Source-code references are to the ngspice-47 release tree at
`<scratch>/src/ngspice47/ngspice-47` (written `src47/` below).
All evidence paths are relative to the data directory
`<scratch>/research/native/` unless they start with `/` or `src47/`.

Companion files: `traps.md` (Part C in full, verbatim outputs), `fixtures.json` (Part A data),
`conventions/suffixes.md` + `conventions/suffixes.json` (number strings), `version_diff.json` (Part D, machine-made diff).

---

## 0. Headlines

1. **All channel fixtures (F1a-F5) and D1 agree with the expected values to 6 significant figures in both
   ngspice 42 and 47, and 42 and 47 give bit-identical vectors for them.** No disagreement with the channel's
   expected values was found. (`fixtures.json` → `fixtures.<id>.runs.<ver>.checks`, `compare_42_vs_47`.)
2. **T1 (.tran) is "close to" 5(1-e^(-t/1 ms)) but not to 6 significant figures**: the 1 us rise of the PULSE alone
   shifts the curve by up to 2.5 mV. Against the exact response to the 1 us ramp, ngspice is within 1.53e-5 V
   everywhere. 42 and 47 use different time grids (519 vs 520 points), so T1 can never be a bitwise golden test.
3. **Batch mode prints 7 significant digits for values >= 0 and only 6 for negative values** (`6.000000e+00`,
   `-3.00000e+00`). Full precision comes from the binary rawfile (`-r`, float64), the shared library, or
   `set numdgt=16` in a `.control` block. `.options numdgt=` does nothing to the batch printout.
   ASCII rawfile: `SPICE_ASCIIRAWFILE=1` or `.options filetype=ascii` (16 significant digits).
4. **libngspice 47 (`ngSpice_Circ` + `run`, what a wasm app is likely to call) returns vectors bit-identical to the
   batch rawfile for every fixture**, including T1's 520 points.
5. **ngspice's worst habit for beginners: when the DC matrix is singular (no ground, capacitor-only node, current
   source into a capacitor) it falls back to a "transient op" and reports numbers with exit code 0.** Those numbers
   can be plainly wrong even for nodes that are well defined (T15b: 0.0887 V on a node that is 3 V).
   Several other traps produce no message at all: 1M, 3A, 1MOhm, `1,5k` on a resistor (= 5 kohm), missing title,
   current sources in series or into an empty node (an invisible 1 ohm to ground), `.tf` on a non-existent node,
   a line starting with `@` (ends the netlist).
6. **In the non-batch modes nothing stops on errors and every API call returns 0**: `ngSpice_Circ` and
   `ngSpice_Command("run")` return 0 for duplicate names, parse errors and failed operating points. Some errors are
   fatal (malformed B line, unbalanced `'`/`{`): the CLI exits and the shared library calls ControlledExit and must
   be reset (a wasm build of the CLI would presumably have to be re-instantiated; not tested).
7. **42 vs 47 behaviour differences that matter**: 0 ohm resistors (42 silently 1 mohm, 47 1e-12 ohm with a warning);
   `.dc V1 0 12 0` or a missing step (42 loops forever, 47 "Bad syntax!"); the transient time grid; `#` as a
   comment; and a **47 segfault** in `ngspice -b -r` when no circuit could be built (E/F/G/H with too few fields,
   unknown subcircuit).

---

## 1. Setup

### 1.1 Binaries

| | ngspice 42 | ngspice 47 |
|---|---|---|
| binary | `/usr/bin/ngspice` (Ubuntu package `ngspice 42+ds-3build1`, `dpkg -l`) | `<scratch>/native/ngspice-47/bin/ngspice` |
| `ngspice --version` | `** ngspice-42 : Circuit level simulation program` / `** Compiled with KLU Direct Linear Solver` / `** Creation Date: Sun Mar 31 20:15:14 UTC 2024` (`logs/ngspice-42-version.txt`) | `** ngspice-47 : Circuit level simulation program` / `** Compiled with KLU Direct Linear Solver` / `** Copyright 2001-2026, The ngspice team.` / `** Creation Date: Mon Nov  9 19:06:57 UTC 2026` (`logs/ngspice-47-version.txt`) |
| default linear solver | `Using SPARSE 1.3 as Direct Linear Solver` (on stderr) | `Using SPARSE 1.3 as Direct Linear Solver` (on stdout) |
| spinit | loads XSPICE code models; `num_threads` commented out | loads XSPICE code models (+ `tlines.cm`); `set num_threads=8` |

**ngspice 47 build** (succeeded first time; configure 26 s, `make -j3` 2 min 22 s; `logs/configure-47.log`, `logs/make-47.log`, `logs/make-install-47.log`):

```
cwd: <scratch>/native/build-47
<scratch>/src/ngspice47/ngspice-47/configure --prefix=<scratch>/native/ngspice-47 --with-x=no --disable-debug --with-readline=no
make -j3 && make install
```

Configure summary lines (`logs/configure-47.log`): `KLU solver enabled`, `XSPICE features included`,
`OSDI features included`, `OpenMP feature enabled`, `GNU readline disabled.`, `checking for fftw3.h... no`
(libfftw3-dev is not installed, so FFTW is not used; irrelevant for .op/.tf/.dc/.tran), `checking for flex... no`
(harmless: the release tarball ships generated parsers). CFLAGS: `-O2 -s -Wall ... -std=gnu11 -fopenmp`.

**Extra (not asked, built to answer "what does a wasm app see"):** the same tree as a shared library, in a separate
directory: `configure --prefix=.../native/ngspice-47-shared --with-ngshared --with-x=no --disable-debug --with-readline=no`
(`logs/build-47-shared.log`), giving `.../native/ngspice-47-shared/lib/libngspice.so`. I did not touch
`scratchpad/wasm`.

### 1.2 How the runs were made

Scripts (all in `scripts/`, run with `python3 -I`):

| script | what it does |
|---|---|
| `ngrun.py` | runs a binary with stdout and stderr captured separately (and a pty variant for a terminal-like interleaved capture) |
| `rawparse.py` | parser for ngspice rawfiles, binary (`Binary:`, little-endian float64, real or complex, several plots per file) and ASCII (`Values:`) |
| `sigfig.py` | the agreement rule: `\|a-b\| <= 0.5*10^(floor(log10(max(\|a\|,\|b\|)))-5)`, `\|x\| <= 1e-12` counts as zero |
| `run_fixtures.py` | Part A: every fixture x version x {`-b`, `-b` on a pty, `-b -r x.raw`, `SPICE_ASCIIRAWFILE=1 -b -r`, `.print` variant, `numdgt=16` variant} → `fixtures.json` |
| `run_cases.py` | runs every `*.cir` of a folder with `-b` and `-b -r`, writes `<case>.<ver>.txt` (command, exit code, stdout, stderr verbatim) and `summary.json` |
| `run_modes.py`, `shared_run.py` | the non-batch modes: interactive CLI `ngspice -n -p` fed `source <file> / run / echo $curplot / set numdgt=16 / print all / quit`, and libngspice 47 via ctypes (`ngSpice_Init`, `ngSpice_Circ`, `ngSpice_Command("run")`, `ngSpice_CurPlot`, `ngSpice_AllVecs`, `ngGet_Vec_Info`) |
| `gen_suffix_cases.py`, `summarize_suffix.py` | the number-string cases and their table |
| `gen_traps_md.py` | builds `traps.md` from the evidence files |
| `diff_versions.py`, `merge_fixture_extras.py` | Part D diff (`version_diff.json`), extra sections of `fixtures.json` |

Why the non-batch modes matter: batch mode aborts on the first netlist error, the other modes do not
(`src47/src/sharedspice.c:231` `bool ft_batchmode = FALSE;`). EEcircuit-engine drives its wasm CLI build in
interactive mode with the command list `[" ", "source test.cir", "destroy all", "run", "write out.raw"]`
(`<scratch>/src/eelab-dev_EEcircuit-engine/src/simulationLink.ts:24`).

---

## 2. Part A: fixtures

### 2.1 Netlists

Each file is `fixtures/<id>.cir` with a title line first and `.end` last, exactly as specified:

```
F1a  V1 n1 0 6 / R1 n1 0 2 / .op                 F1b  V1 0 n1 6 / R1 n1 0 2 / .op
F2a  I1 0 n1 3 / R1 n1 0 4 / .op                 F2b  I1 n1 0 3 / R1 n1 0 4 / .op
F3a  V1 n1 0 6 / R1 n1 n2 1M / R2 n2 0 1meg / .op
F3b  V1 n1 0 6 / R1 n1 n2 1meg / R2 n2 0 1meg / .op
F4   V1 s 0 24 / R1 s n1 6 / R2 n1 0 3 / R3 n1 a 2 / .tf v(a) V1
F5   Itest 0 a 1 / Vx a x 0 / R2 x n1 2 / R1 n1 0 4 / F1 0 n1 Vx 2 / .op
D1   V1 in 0 0 / R1 in out 1k / R2 out 0 2k / .dc V1 0 12 1                       (ours)
T1   V1 in 0 PULSE(0 5 0 1u 1u 1 2) / R1 in out 1k / C1 out 0 1u / .tran 10u 5m  (ours)
```

### 2.2 Results against the expected values (full precision, binary rawfile)

Values are Python `repr` of the float64 read from the rawfile; 42 and 47 are identical in every row.
"6 sf" = the agreement rule. Rows marked *derived* are my hand calculation, added to pin down signs.

| fixture | vector (rawfile name) | expected | ngspice 42 = 47 | 6 sf |
|---|---|---|---|---|
| F1a | `v(n1)` | 6 | 6.0 | pass |
| F1a | `i(v1)` | -3 (*derived*) | -3.0 | pass |
| F1b | `v(n1)` | -6 | -6.0 | pass |
| F1b | `i(v1)` | -3 (*derived*: the source still delivers 18 W) | -3.0 | pass |
| F2a | `v(n1)` | 12 | 12.0 | pass |
| F2b | `v(n1)` | -12 | -12.0 | pass |
| F3a | `v(n2)` | about 6 | 5.999999994 | pass (vs 6: diff 6.0e-9) |
| F3a | `v(n2)` | 6*1e6/(1e6+1e-3) (*derived*) | 5.999999994 | pass (diff 8.9e-16) |
| F3a | `i(v1)` | -6/(1e6+1e-3) = -5.999999994e-06 (*derived*) | -5.99999930273043e-06 | pass (diff 6.9e-13, tolerance 5e-12) |
| F3b | `v(n2)` | 3 | 3.0 | pass |
| F3b | `i(v1)` | -3e-6 (*derived*) | -3e-06 | pass |
| F4 | `v(Transfer_function)` | 1/3 | 0.33333333333333337 | pass (1 ulp) |
| F4 | `v(output_impedance_at_V(a))` | 4 | 4.0 | pass |
| F4 | `v(v1#Input_impedance)` | 9 | 9.0 | pass |
| F5 | `v(a)` | 14 | 14.0 | pass |
| F5 | `v(x)`, `v(n1)`, `i(vx)` | 14, 12, 1 (*derived*) | 14.0, 12.0, 1.0 | pass |
| D1 | `v(out)` over 13 points | (2/3)*V1 | max abs error 8.9e-16 | pass (13/13) |
| D1 | `i(v1)` over 13 points | -V1/3k (*derived*) | max abs error 8.7e-19 | pass (13/13) |
| T1 | `v(out)` | close to 5(1-exp(-t/1ms)) | see 2.6 | close, not 6 sf |

Evidence: `fixtures.json` → `fixtures.<id>.runs.42|47.checks`; raw files `runs/fixtures/<ver>/<id>/<id>.raw`.

### 2.3 What batch mode prints, and how many digits

`ngspice -b F1a.cir` prints (ngspice 47, verbatim excerpt, `runs/fixtures/47/F1a/batch.stdout.txt`):

```
No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00
```

followed by a model and device parameter listing (`Resistor models ...`, `Resistor: Simple linear resistor ... i 3 p 18`)
and a resource footer. The rule is in `src47/src/misc/printnum.c:19-45`: `sprintf(buf, "%.*e", n, num)` with
`n = 6` (or `numdgt` when set) and `n--` for negative numbers. So:

* **values >= 0: 7 significant digits** (`6.000000e+00`); **negative values: 6 significant digits** (`-3.00000e+00`).
  Same rule for the `.tf` printout (`transfer_function = 3.333333e-01`, `src47/src/frontend/dotcards.c:269`),
  for `print` and for `.print` columns.
* The device listing after an `.op` uses 6-significant-digit `%g`-style numbers (`2.9985`, `0.00899101`, `9.0016e-12`).
* `.print` output is paginated (title, date and column header repeated about every 58 rows: 9 headers for T1's 519 rows in 42,
  `runs/fixtures/42/T1/batch_print.stdout.txt`).
* **Without a `.print`/`.plot` line, batch mode does not run `.dc` or `.tran` at all**: D1 and T1 end with
  `Note: No ".plot", ".print", or ".fourier" lines; no simulations run` (42) or
  `Error: incomplete or empty netlist` / `or no ".plot", ".print", or ".fourier" lines in batch mode;` /
  `no simulations run!` (47), exit code 1 (`src47/src/main.c:1577-1592`). `.op` and `.tf` are printed automatically.
  With `-r` everything runs (`main.c:1561`). The `print` variants (`fixtures/variants/D1.print.cir`, `T1.print.cir`) show the
  `.print` format.
* Stream split: the results go to stdout; warnings and errors to stderr. ngspice 42 prints the solver banner on stderr,
  47 on stdout. Exit code is 0 whenever an analysis "succeeded", including the transient-op fallback of Part C.
* The circuit title is lower-cased in every output, including the rawfile `Title:` (ASCII letters only:
  `Title With UPPER case and Tarık's ÜMLAUTS` → `title with upper case and tarık's Ümlauts`,
  `conventions/out/B23_title_case.47.txt`).

Printed text is therefore a poor golden source: a negative value printed with 6 digits sits exactly on the edge of the
6-significant-figure rule. Use the rawfile or the API vectors.

### 2.4 Full precision: binary rawfile and parser

`ngspice -b -r <id>.raw <file>` writes a binary rawfile: a text header (`Title`, `Date`, [`Command:` in 47 only],
`Plotname`, `Flags: real`, `No. Variables`, `No. Points`, `Variables:` with `index name type`), then `Binary:` and
`No. Points` rows of float64 (little-endian). Parser: `scripts/rawparse.py` (also handles complex data and several plots
per file). Rawfile names differ from in-memory names (see 3.8): `v(n1)`, `i(v1)`, `v(Transfer_function)`.
A run with `-r` prints only `No. of Data Columns`/`Rows`, not the results.

### 2.5 ASCII rawfile and higher printed precision (all verified in 42 and 47)

| goal | how | evidence |
|---|---|---|
| ASCII rawfile | environment `SPICE_ASCIIRAWFILE=1` with `-r` (`src47/src/misc/ivars.c:103-105`) | `runs/fixtures/*/*/<id>.ascii.raw` |
| ASCII rawfile | `.options filetype=ascii` in the netlist, with `-r` | `conventions/printing/out/P3_options_filetype_ascii.<ver>.raw` |
| ASCII rawfile | `.control` / `set filetype=ascii` / `.endc` plus `-r`, or `set filetype=ascii` + `write file.raw` inside `.control` | `conventions/printing/out/P5_*`, `P4_*` |
| ASCII precision | values are written with `%.15e` = 16 significant digits (`src47/src/frontend/outitf.c:91,1085`), e.g. `6.000000000000000e+00`; for every fixture the ASCII values equal the binary values rounded to `%.15e` (`fixtures.json` → `ascii_equals_binary_rounded_to_15e`: true everywhere) | |
| more printed digits | `.control` / `set numdgt=16` / `.endc` added to the netlist (the analysis still comes from the dot line): `n2 5.9999999940000004e+00`, `v1#branch -5.999999302730430e-06` (17 and 16 significant digits) | `conventions/printing/out/P2_set_numdgt_in_control.<ver>.txt`, `fixtures/variants/*.numdgt16.cir` |
| does **not** work | `.options numdgt=15` in the netlist: printout unchanged (`6.000000e+00`) in 42 and 47 | `conventions/printing/out/P1_options_numdgt.<ver>.txt` |

Note on `.control` in batch mode: if the netlist has a dot analysis line **and** the control block issues `run`, batch
mode simulates twice (control block, then the batch pass, `main.c:1577`). Put only `set` commands in the block, or put
the analysis only in the block (then ngspice prints `Note: Simulation executed from .control section`).

### 2.6 Flags (things to know, none is a disagreement with the channel's values)

* **T1 is not a 6-significant-figure test.** 42: 519 points, 47: 520 points; first time 0, last 5e-3; smallest step
  8.4e-10 s, largest 1e-5 s (= TSTEP); only 2 points (0 and 5 ms) lie on the 10 us grid, so the output is not on a
  uniform grid. Against the simple formula the largest difference is 2.498e-3 V at t = 1 us (only t = 0 agrees to 6 sf).
  Against the exact response to the 1 us ramp, `5 - 5(tau/tr)(e^(tr/tau)-1)e^(-t/tau)` for t > tr, the largest
  difference is 1.5254e-5 V (42, at t = 1.002 ms) and 1.5248e-5 V (47, t = 1.005 ms); 170 points agree to 6 sf.
  Samples, linearly interpolated between ngspice's own points (`fixtures.json` → `T1.runs.<ver>.checks[0].samples`;
  near t = 0 linear interpolation over a 10 us step itself adds up to about 5e-5 V, more than the simulation error
  measured at ngspice's points):

  | t | 42 | 47 | exact ramp | simple formula |
  |---|---|---|---|---|
  | 0.1 ms | 0.47351839 | 0.47349725 | 0.47355006 | 0.47581291 |
  | 1 ms | 3.15968372 | 3.15967512 | 3.15968279 | 3.16060279 |
  | 2 ms | 4.32299112 | 4.32298795 | 4.32298513 | 4.32332358 |
  | 5 ms | 4.966294817 | 4.966294815 | 4.966293415 | 4.966310265 |

  Recommendation: test T1 against the exact-ramp formula with an absolute tolerance (2e-5 V covers both versions),
  or against a native run of the same ngspice version on the same time points, never bitwise across versions.
* **F3a's source current is ill-conditioned** (1 mohm in series with 1 Mohm): `i(v1)` is right to only ~7 digits
  (-5.99999930273e-06 vs exact -5.999999994e-06). With `.options klu` it becomes -5.999999608263806e-06. Both pass the
  6 sf rule, but a wasm build with a different solver or compiler may legitimately differ in the 8th digit.
* **KLU vs Sparse** (both binaries contain KLU but default to Sparse): F5 bit-identical; F3a `i(v1)` differs by 3.1e-13;
  T1 same grid, `v(out)` differs by at most 3.6e-14 (`fixtures.json` → `klu_vs_sparse`). All within 6 sf.
* **Batch `-b` alone runs no `.dc`/`.tran`** (2.3). A golden harness must use `-r` (or `.print`, or the API).

### 2.7 Non-batch modes give the same numbers

For every fixture, libngspice 47 (`ngSpice_Circ` + `run`) returns vectors **bit-identical** to the 47 batch rawfile
(`fixtures.json` → `fixtures.<id>.non_batch.shared_lib_47.bitwise_equal_to_batch_47_rawfile` = true for all ten).
The interactive CLI (`source`, `run`) produced the same current plots (`op1`, `tf1`, `dc1`, `tran1`).

### 2.8 `fixtures.json` layout

`versions` (binary, version text, origin incl. the configure line), `fixtures.<id>`: `origin` (channel/ours),
`netlist`, `variants` (print/numdgt16 netlists), `runs.<42|47>`: `printed.batch` (cmd, exit, stdout, stderr),
`printed.batch_terminal` (pty capture), `printed.batch_print` / `batch_numdgt16`, `raw_binary_run`, `raw_ascii_run`,
`plots` (parsed binary rawfile: names, types, full-precision data), `raw_ascii_text` (the ASCII strings), `checks`;
`compare_42_vs_47`; `non_batch` (shared library and interactive CLI). Top level also has `klu_vs_sparse` and `printing`.

---

## 3. Part B: conventions the UI will state (each verified by a run)

Evidence folder: `conventions/cases/*.cir`, outputs `conventions/out/<case>.<ver>.txt` (+ `.raw`, `summary.json`).
All results in this section are identical in 42 and 47.

### 3.1 Voltage source current: `v1#branch` = `i(v1)`

**Positive = current flowing into the + terminal (first node), through the source, out of the - terminal.** A source
that delivers power therefore shows a negative current.

| case | netlist | result |
|---|---|---|
| F1a | `V1 n1 0 6`, `R1 n1 0 2` | `v1#branch = -3` (source delivers 18 W) |
| F1b | `V1 0 n1 6`, `R1 n1 0 2` | `v(n1) = -6`, `v1#branch = -3` |
| B02 | `V1 a 0 6`, `V2 b 0 12`, `R1 b a 3` | `v1#branch = +2` (V2 pushes 2 A into V1's + terminal), `v2#branch = -2` |

`print i(v1)` and `print v1#branch` print the same number (`B01_vsrc_delivering`); the rawfile calls it `i(v1)`.
E and H sources and inductors have branch vectors with the same convention (`e1#branch = -0.6` for an E source feeding a
resistor, `B04`; `h1#branch = -1`, `B07`; `l1#branch`, `B09`).

### 3.2 Current source direction

**`I1 a b 3`: 3 A flow from node a through the source to node b, i.e. 3 A are pulled out of a and pushed into b.**
`I1 0 n1 3` with `R1 n1 0 4` gives `v(n1) = +12` (F2a); `I1 n1 0 3` gives `-12` (F2b). So the UI's "from node, to node"
= first node, second node. Current sources have no branch vector; with savecurrents they get `@i1[current]`, which is
the source value as written (`+3` for both orientations, `B03`), not a signed measurement.

### 3.3 E, F, G, H (`B04`-`B07`)

| element | syntax | verified convention | evidence |
|---|---|---|---|
| E (VCVS) | `E1 n+ n- nc+ nc- gain` | `v(n+) - v(n-) = gain * (v(nc+) - v(nc-))`: `E1 o 0 c 0 3` → o = 6; `E2 p 0 0 c 3` → p = -6; `E3 0 q c 0 3` → q = -6 (v(c) = 2) | `B04_vcvs_E` |
| G (VCCS) | `G1 n+ n- nc+ nc- gm` | current `gm*(v(nc+)-v(nc-))` flows from n+ through the source to n- (like an I source): `G1 0 o c 0 0.5` → o = +10 (1 A into o, 10 ohm load); `G2 p 0 c 0 0.5` → p = -10; `@g1[i] = @g2[i] = +1` | `B05_vccs_G` |
| F (CCCS) | `F1 n+ n- Vctl gain` | current `gain * i(Vctl)` flows from n+ through the source to n-; `i(Vctl)` uses the 3.1 convention (`vs#branch = +2` for `Vs a b 0` with current a→b): `F1 0 o Vs 2` → o = +4; `F2 p 0 Vs 2` → p = -4; `@f1[i] = @f2[i] = 4` | `B06_cccs_F`, F5 |
| H (CCVS) | `H1 n+ n- Vctl r` | `v(n+) - v(n-) = r * i(Vctl)`: `H1 o 0 Vs 5` → o = 10; `H2 0 p Vs 5` → p = -10 | `B07_ccvs_H` |

F5 checks the F convention end to end: `F1 0 n1 Vx 2` with `i(vx) = 1` pushes 2 A into n1, so v(n1) = 12 and
v(a) = 14 (the batch device listing also shows `i 2`, `v -12`, `p -24` for f1).

### 3.4 `.options savecurrents`

Implementation: `src47/src/frontend/inp.c:2416-2500` adds `.save all` (unless a save exists) and, per device line by
first letter: `r c l b f g w s` → `@name[i]`; `i` → `@name[current]`; `d` → `@name[id]`; `q` → `[ic] [ie] [ib] [is]`;
`j` → `[id] [is] [ig] [igd]`; `m` → `[id] [is] [ig] [ib]`. **V, E and H get nothing extra** (they already have `#branch`).
Observed with R, L, C, V, I, E, F, G, H in one `.op` (`B08_savecurrents_all`, `B09_savecurrents_names`):

```
@c1[i] @f1[i] @g1[i] @i1[current] @l1[i] @r1[i] @r2[i] @rd[i] @re[i] @rf[i] @rg[i] @rh[i]
e1#branch h1#branch l1#branch v1#branch vs#branch   (+ node voltages)
```

No `@v1[i]`, `@e1[i]` or `@h1[i]`. Signs: **`@r1[i]` is the current from the resistor's first node to its second
node** (`R1 n1 0 4` at 12 V: +3; `R2 n2 0 4` at -12 V: -3, `B03`); `@f1[i]`, `@g1[i]` are the current from n+ through the
device to n- (3.3); `@l1[i]` equals `l1#branch`; `@c1[i] = 0` in `.op`. In the batch `.op` printout these vectors are
listed in the "Source Current" table; **in the rawfile they are named `i(@r1[i])`, `i(@i1[current])`** etc. (the writer
wraps every current-type vector in `i(...)`), while the shared API and `print` use `@r1[i]`.

Caution for a "current through a wire" display: through a 1e-12 ohm resistor ngspice 47 reports `i 3.00027` for a true
3 A (`traps/out/T14a_zero_ohm.47.txt`): `(v(a)-v(b))/R` loses digits. Use a 0 V source as an ammeter instead.

### 3.5 `.tf`

| item | observed |
|---|---|
| plot | type `tf`, name `tf1` (`tf2`, ... for later runs), plotname `Transfer Function` (`B10_tf_variants`) |
| vectors, voltage output `.tf v(a) V1` | `Transfer_function`, `output_impedance_at_V(a)`, `v1#Input_impedance` |
| differential output `v(a,n1)` | `output_impedance_at_V(a,n1)` |
| current output `.tf i(Vm) V1` | `Transfer_function`, `vm#Output_impedance` (value **1e+20**), `v1#Input_impedance` (`B11_tf_dot_current`) |
| current-source input `.tf V(A) I1` | `i1#Input_impedance` |
| types | all three are typed `voltage`; the rawfile names are `v(Transfer_function)`, `v(output_impedance_at_V(a))`, `v(v1#Input_impedance)`, `v(vm#Output_impedance)` |
| case | names keep their mixed case in memory and in the rawfile; `print` lower-cases them (`transfer_function = 3.333333e-01`); lookup is case-insensitive (`print tf1.TRANSFER_FUNCTION` works, `B18_name_case`) |
| meaning (F4) | transfer function = v(a)/V1 = 1/3; input impedance = resistance seen by V1 = 9 ohm; output impedance = Thevenin resistance at the output = 4 ohm |

### 3.6 `.dc`

| sweep | scale vector (memory / rawfile) | type | evidence |
|---|---|---|---|
| voltage source `.dc V1 ...` | `v-sweep` / `v(v-sweep)` | voltage | `B12`, D1 |
| current source `.dc I1 ...` | `i-sweep` / `i(i-sweep)` | current | `B13` |
| resistor `.dc R1 1k 3k 1k` | `res-sweep` / `res-sweep` | `res-sweep` | `B14` |
| temperature `.dc TEMP ...` | `temp-sweep` / `temp-sweep` | `temp-sweep` | `B15` |

Plot type `dc` (`dc1`), plotname `DC transfer characteristic`; other vectors are the node voltages and branch currents
(`in`, `out`, `v1#branch`). A nested sweep `.dc V1 0 2 1 V2 0 1 1` gives one flat vector of 6 points, inner sweep
fastest, and `v-sweep` holds only the inner values (0,1,2,0,1,2); the batch rawfile has no `Dimensions` line (`B16`).
Plot names are `op1`, `tf1`, `dc1`, `tran1`, then `op2`, ... in one session.

### 3.7 Number strings (one tiny circuit per string and device: `I1 0 n1 <s>` into 1 ohm, `R1 n1 0 <s>` fed by 1 A, `C1 n1 0 <s>`)

Value actually used (`print v(n1)`, `@r1[resistance]`, `@c1[capacitance]` with `numdgt=16`). Same in 42 and 47
unless marked. Full table with messages: `conventions/suffixes.md`; data: `conventions/suffixes.json`; cases:
`conventions/suffix_cases/S{I,R,C}_nn.cir`; outputs: `conventions/suffix_out/`.

| string | I source | resistor | capacitor | note |
|---|---|---|---|---|
| `1M` | 0.001 | 0.001 | 0.001 | **M = milli** |
| `1m` | 0.001 | 0.001 | 0.001 | |
| `1meg`, `1MEG`, `1Meg` | 1e6 | 1e6 | 1e6 | |
| `1mil` | 2.54e-05 | 2.54e-05 | 2.54e-05 | 25.4e-6 |
| `3A`, `3a` | 3e-18 | 42: 3e-18; **47: 1e-12** + `Warning: Value of resistor r1 is too small, set to 1.000000e-12` | 3e-18 | **A = atto** |
| `1F`, `1f` | 1e-15 | 42: 1e-15; **47: 1e-12** + same warning | 1e-15 | **F = femto** |
| `1u` | 1e-06 | 1e-06 | 1e-06 | |
| `1µ` (U+00B5) | 1e-06 | 1e-06 | 1e-06 | translated to `u` (`src47/src/frontend/inpcom.c:9694-9705`) |
| `1μ` (Greek mu, U+03BC, extra) | **1** | **1** | **1** (+ `warning, can't find model '1μ' from line`) | not translated: silently ignored |
| `10k`, `10K` | 10000 | 10000 | 10000 | |
| `1g`, `1G` | 1e9 | 1e9 | 1e9 | |
| `1t`, `1T` | 1e12 | 1e12 | 1e12 | |
| `1p` | 1e-12 | 1e-12 | 1e-12 | |
| `1n` | 1e-09 | 1e-09 | 1e-09 | |
| `2.2k` | 2200 | 2200 | 2200 | |
| `2k2` | **2000** | **2000** | **2000** + `warning, can't find model '2k2' from line` | RKM codes only with `set ngbehavior=lt` in `.spiceinit`: then R and C `2k2` = 2200, `4k7` = 4700, but an I source still gets 2000 (`conventions/ltcompat/`; `src47/src/spicelib/parser/inp2r.c:81-85`) |
| `10kOhm` | 10000 | 10000 | 10000 (+ model warning) | letters after the scale factor are ignored |
| `10V` | 10 | 10 | 10 (+ model warning) | |
| `1e3`, `1E3` | 1000 | 1000 | 1000 | |
| `1 k` (space) | **error** | **error** | **error** | `Error on line 2 or its substitute:` / `i1 0 n1 1 k` / `unknown parameter (k)`; the R line also prints `warning, can't find model 'k' from line` |
| `1.` | 1 | 1 | 1 | |
| `.5` | 0.5 | 0.5 | 0.5 | |
| extras: `1MOhm`, `1Mohm` | 0.001 | 0.001 | 0.001 | **milli, silently** |
| `4.7MΩ` | 0.0047 | 0.0047 | 0.0047 | milli |
| `1kΩ` | 1000 | 1000 | 1000 | |
| `1mA`, `100mV` | 0.001, 0.1 | same | same | |
| `1e3k` | 1e6 | 1e6 | 1e6 | exponent and suffix both apply |
| `-2`, `+3` | -2, 3 | -2, 3 | -2, 3 | negative R and C accepted without a message |
| `5 V` (space) | error: `no such parameter on this device` (42) / `... or parameter is missing` (47) | error | error | |
| `1x` | 1 | 1 | 1 | `x` is not a scale factor |
| `4k7` | 4000 | 4000 | 4000 | |
| `1d3` | 1000 | 1000 | 1000 | `d` = exponent |
| `1meg5`, `1.5.2`, `1_000` | 1e6, 1.5, 1 | same | same | trailing characters ignored |

The suffix logic is `INPevaluate` (`src47/src/spicelib/parser/inpeval.c:13-204`, scale switch at line 143; `m`/`M`
is milli unless followed by `eg` or `il`). A value string is parsed up to the first character that is not part of a
number or the one scale letter, and the rest of the token is ignored. On capacitor lines, a value with trailing
letters additionally prints `warning, can't find model '<value>' from line` (the value is still used); resistor and
source lines stay silent.

### 3.8 Names: case, ground, numeric nodes, how each interface spells a vector

* **Element and node names are case-insensitive**: the whole netlist is lower-cased (`R1` and `r1` collide, T07b;
  `N1` and `n1` are one node, T13).
* **Ground**: node `0`; `gnd` in any case (`gnd`, `GND`, `Gnd`) is replaced by `0` (`src47/src/frontend/inpcom.c:2354-2390`,
  plus an automatic `.global gnd`, line 1919; disable with `no_auto_gnd`). `ground` and `00` are ordinary nodes
  (T03d, T03f, T03g).
* **Numeric node names**: in memory, the shared API and the batch printout a node called `1` is the vector `V(1)`
  (upper-case V, with parentheses); an alphanumeric node `n1` is just `n1`. `007` stays `V(007)` (string, not 7).
  The rawfile writes `v(1)`, `v(007)` (`conventions/out/B24_numeric_nodes.*`).
* Lookup in `print`/`ngGet_Vec_Info` is case-insensitive (`V(N1)` = `v(n1)`, `I(V1)` = `v1#branch`, `B18`).

| quantity | memory / shared API (`ngSpice_AllVecs`) | `print` output | binary/ASCII rawfile |
|---|---|---|---|
| node n1 | `n1` | `n1` or `v(n1)` | `v(n1)` |
| node 1 | `V(1)` | `v(1)` | `v(1)` |
| V source current | `v1#branch` | `v1#branch` / `i(v1)` | `i(v1)` |
| savecurrents | `@r1[i]`, `@i1[current]` | same | `i(@r1[i])`, `i(@i1[current])` |
| .tf | `Transfer_function`, `output_impedance_at_V(a)`, `v1#Input_impedance` | lower-cased | `v(...)` around each |
| .dc scale | `v-sweep`, `i-sweep`, `res-sweep`, `temp-sweep` | same | `v(v-sweep)`, `i(i-sweep)`, `res-sweep`, `temp-sweep` |
| .tran scale | `time` | `time` | `time` |

Order: the batch `.op` table lists nodes in reverse creation order (F5: `n1`, `x`, `a`); the rawfile and the API list
them in creation order (`a`, `x`, `n1`). `display` and `print all` sort alphabetically. The UI should sort itself.

### 3.9 Transient output grid

ngspice returns its own accepted time points, not a uniform grid (T1: 2 of 519 points on multiples of TSTEP; first
step 10 ns after t = 0; steps shrink around PULSE breakpoints; the largest step equals TSTEP = 10 us: with no TMAX the maximum step is TSTEP when TSTEP < (TSTOP-TSTART)/50,
otherwise (TSTOP-TSTART)/50, `src47/src/spicelib/analysis/traninit.c:24-33`). Plots must use the `time` vector.

---

## 4. Part C: beginner traps (summary; full netlists and verbatim output in `traps.md`)

Evidence folders: `traps/cases/` (netlists), `traps/out/` (batch `-b` and `-b -r`, both versions),
`traps/modes_out/` (interactive CLI 42/47 and libngspice 47), `traps/letters/`, `traps/letters_out/`,
`traps/letters_modes_out/` (first-letter sweep). Messages below are verbatim (ngspice 47 unless stated).

| # | trap | reaction | exact message | results anyway? |
|---|---|---|---|---|
| 1 | `R1 n1 n2 1M` meant as 1 Mohm | silent wrong answer | none | yes: v(n2) = 5.999999994 |
| 2 | `I1 0 n1 3A` | silent wrong answer | none | yes: 3e-18 A, v(n1) = 1.2e-17 |
| 3 | no node 0 | warning, then arbitrary numbers, exit 0 | `Warning: singular matrix:  check node b` ... `Note: Transient op started` / `Note: Transient op finished successfully` | yes: v(a) = 9.000333, v(b) = 3.000333 (only the difference is right) |
| 3 | `gnd`, `GND`, `Gnd` | correct (they are node 0) | none | yes |
| 3 | `ground`, `00` | same as no ground | `Warning: singular matrix:  check node ground` ... | yes, arbitrary |
| 4 | dangling resistor end | silent | none | yes, numerically right (no current) |
| 4 | resistor floating on both ends | warning, transient op | `Warning: singular matrix:  check node n3` ... | yes (n3 = n4 = 0) |
| 5 | I source in series with C / into a C-only node | warning, transient op | `Warning: singular matrix:  check node b` ... `Note: Transient op finished successfully` | yes, arbitrary (0.01 V) |
| 5 | two different I sources in series | **silent wrong answer** | none | yes: v(n1) = -0.001 V = (1 mA - 2 mA) x 1 ohm |
| 5 | I source into a node with nothing else | **silent wrong answer** | none | yes: 1 A gives v(n1) = 1 V |
| 6 | two V sources in parallel, or a V source shorted by a 0 V source | error | `Warning: singular matrix:  check node v1#branch` ... `Error: Transient op failed, timestep too small` / `Error: The operating point could not be simulated successfully.` / `doAnalyses: OP:  Timestep too small; cause unrecorded.` / `run simulation(s) aborted` | no (batch exit 1; API: plot `op1` with zero-length vectors) |
| 7 | duplicate names (`R1` twice, `R1` + `r1`, `V1` twice) | error | `Error on line 4 or its substitute:` / `r1 n1 0 4` / `device already exists, bail out` | no |
| 8 | first letters | see the two `traps.md` tables (results per character, and what device each letter means): C I L R V accepted; others rejected with model/parameter errors; B, `'`, `{` fatal; `$ & ! % ( = " [ ? , :` turned into comments with one warning; `#` comment (47) / error (42); `@` ends the netlist; digits `unknown device type - error` | | |
| 9 | missing value | R/C: warning, element dropped; V/I: note, 0 assumed | `Warning: 'r1 a 0' is not a valid resistor instance line, ignored!`; `Note: v1: has no value, DC 0 assumed` | yes |
| 10 | `1,5k` on a resistor | **silent wrong answer** | none | yes: R = 5000 ohm |
| 10 | `1,5` on a V or I source | error | `unknown parameter (5)` | no |
| 11 | no title line | **silent wrong answer** | none (`Circuit: v1 n1 0 6` shows the first element became the title) | yes, without that element |
| 11 | no `.end` | silent, fine from a file | via `ngSpice_Circ`: `Error: .end statement is missing in netlist!` (`src47/src/frontend/inp.c:2112`) | file: yes; API: no |
| 12 | `.tf` names a missing source | error | `Warning: Transfer function source v9 not in circuit` / `doAnalyses: not found` / `run simulation(s) aborted` | no |
| 12 | `.tf` names a missing node (extra) | **silent wrong answer** | none | yes: transfer function 0, output impedance 1 ohm |
| 13 | `N1` vs `n1` | same node | none | yes, correct |
| 14 | 0 ohm resistor | 42: silent, R = 1e-3 ohm; 47: warning, R = 1e-12 ohm | 47: `Warning: Value of resistor r1 is too small, set to 1.000000e-12` | yes (42: v(b) = 5.997001, 4th digit wrong) |
| 15 | node with only capacitors in `.op` | warning, transient op | `Warning: singular matrix:  check node b` ... | yes; can be wrong for other nodes too (T15b: v(c) = 0.0887 V, true 3 V) |

Further traps found on the way (all in `traps.md`): a line starting with `@` silently ends the netlist
(`src47/src/frontend/inpcom.c:1431`); ngspice reads lines **after** `.end` when reading a file (`.end` is turned into a
comment and reading continues, `inpcom.c:1877-1882`) but `ngSpice_Circ` stops at `.end`; a blank first line is the
title when reading a file but is skipped by `ngSpice_Circ` (the first element then becomes the title);
`.dc V1 0 12 -1` and `.dc V1 12 0 1` give 0 points without any message; `.dc V1 0 12 20` gives 1 point;
`.dc V1 0 12 0` or a missing step makes **ngspice 42 loop forever** (the rawfile reached 1.26 GB in 60 s,
`traps/out/HUGE_RAWFILES_NOTE.txt`) while 47 says `Bad syntax!`; `.tran 5m` → `TSTOP is invalid, must be greater than zero.`;
`.tran 0 5m` → `TSTEP is invalid, must be greater than zero.`; `.tran 1 5m` runs silently (59 points).

What the non-batch modes add (`traps/modes_out/*.shared47.json`, `*.inter.*.txt`):

* `ngSpice_Circ` returned 0 and `ngSpice_Command("run")` returned 0 in every trap case except the fatal ones; failure is
  visible only in the stderr text (`Error: circuit not parsed.`, `run simulation(s) aborted`, `Error: there aren't any
  circuits loaded.`) and in the current plot (`const` = nothing ran; or a new plot with zero-length vectors).
* Fatal errors (malformed B line, unbalanced `'` or `{`): the CLI exits with code 1 (`ERROR: fatal error in ngspice, exit(1)`);
  libngspice calls ControlledExit(1), `ngSpice_Circ` returns 1 and prints
  `Error: ngspice.dll cannot recover and awaits to be reset or detached` (`src47/src/sharedspice.c:2153`).
  A wasm build of the CLI should be expected to exit the same way (not tested here), so the worker must be re-created.
* The transient-op fallback (singular circuits) behaves the same in all modes: numbers, exit/return code 0, warnings on stderr.

---

## 5. Part D: differences between 42 and 47

Machine diff of every case: `version_diff.json` (`scripts/diff_versions.py`). Summary:

| area | ngspice 42 | ngspice 47 | evidence |
|---|---|---|---|
| fixture values F1a-F5, D1 | | bit-identical to 42 | `fixtures.json` → `compare_42_vs_47` |
| T1 time grid | 519 points; steps before the 1 us breakpoint 4.3008e-7, 1.3067e-7 | 520 points; 2.8038e-7, 2.8038e-7 (equalised; NEWS 46: "Equalise the last two time steps before a breakpoint", `src47/NEWS:43`) | `fixtures.json` → `T1.compare_42_vs_47` (first 11 points identical; after interpolating 47 onto 42's grid the largest v(out) difference is 5.5e-5 V, mostly interpolation error); accuracy vs exact ramp the same (1.525e-5 V) |
| other transients | `.tran 1 5m` (T21c): same point count, different times | | `version_diff.json` |
| 0 ohm resistor | silently 1e-3 ohm (`resistance 0.001` in the device listing; the old rule survives as a comment at `src47/src/spicelib/devices/res/resparam.c:42`) | 1e-12 ohm with `Warning: Value of resistor r1 is too small, set to 1.000000e-12` (`resparam.c:15,37-48`; NEWS 44 "Define 1e-12 as a minimum resistor value") | `traps/out/T14a_zero_ohm.*.txt`: v(b) 5.997001499 vs 5.999999999997 |
| resistors below 1e-12 (3a, 1f) | kept (3e-18) | clamped to 1e-12 with the warning | `conventions/suffix_out/SR_06..09.*.txt` |
| `.dc` with step 0 or no step | runs forever at the first value (killed after 60 s; interactive mode also hangs) | `Error on line 6 or its substitute:` / `.dc v1 0 12 0` / `Bad syntax!` (NEWS 45 "Error checking for .dc command") | `traps/out/T20a_*`, `T20d_*`, `traps/modes_out/T20a_*.inter.42.txt` |
| line starting with `#` | `unknown device type - error` | comment (`inpcom.c:3589`) | `traps/letters_out/L32.*.txt` |
| `N1 a 0 5` | `could not find a valid modelname` | `Unable to find definition of model 5` | `L13` |
| `ngspice -b -r` when no circuit could be built (E/F/G/H with too few fields, unknown subcircuit) | exit 1 | **segfault (exit 139)**. gdb: fault at `mov 0x318(%rax),%rdx` called from `main`; this matches `EVTdiscard()`, which batch mode calls unconditionally in the `-r` path (`src47/src/main.c:1566-1570`) → `set_all(g_mif_info.ckt=NULL)` reading `ckt->evt` (`src47/src/xspice/evt/evtprint.c:955-968`) | `traps/letters_out/L04..L07,L23.47.rawrun.txt`; plain `-b`, interactive and libngspice do not crash |
| batch run that did not simulate | `Note: No ".plot", ".print", or ".fourier" lines; no simulations run` | `Error: incomplete or empty netlist` / `or no ".plot", ".print", or ".fourier" lines in batch mode;` / `no simulations run!` | both exit 1 |
| error locations | `Error on line 3 or its substitute:` only | adds `line no 3, file <path>` / `in line no. 3 from file <path>` to several messages; `Error in netlist line no. 4, new internal line no. 3:` for brace errors | `traps/letters_out/L04.*`, `L45.*` |
| other wording | `ERROR: mal formed B line: b1 a 0 5`; `doAnalyses: no such parameter on this device` | `ERROR: mal formed B source instance: b1 a 0 5`; `... or parameter is missing` | `L01`, `L19` |
| solver banner | `Using SPARSE 1.3 as Direct Linear Solver` on stderr | same text on stdout, after `Doing analysis at TEMP = ...` | `runs/fixtures/*/F1a/batch.std*.txt` |
| batch rawfile header | no `Command:` line | `Command: ngspice-47, Build Mon Nov  9 19:06:57 UTC 2026` | any `.47.raw` |
| `Total analysis time (seconds)` | `= 0` | real value (`= 0.000108187`) | |
| device listing | `pulse         -` | `pulse                     -` (alignment only) | `runs/fixtures/*/F1a/batch.stdout.txt` |
| spinit | `*set num_threads=4` (commented) | `set num_threads=8` | installed spinit files |

Not different: every number string of 3.7 (except the resistor clamp), all sign conventions, savecurrents vectors,
`.tf`/`.dc` names, printed digits, ASCII/numdgt methods, the transient-op fallback and every other trap reaction.

---

## 6. What this means for the simulator

1. **Golden values**: take them from the binary rawfile (`-b -r`) or from the API vectors, never from printed text.
   For 47 they are bit-identical across batch, interactive and libngspice. Compare with the 6-sf rule; T1 with an absolute
   tolerance against the exact-ramp formula. Pin the ngspice version used for native goldens (47, the version being built to wasm).
2. **A golden harness must survive**: exit 139 from `47 -b -r` on unbuildable netlists, and (if 42 is ever used)
   endless `.dc` loops; always use a timeout and check the exit code.
3. **After every run the app must read stderr**: treat `singular matrix`, `gmin stepping`, `source stepping` or
   `Transient op started` as "these numbers are not a DC solution" and show the trap explanation instead of the numbers;
   treat `Error`, `circuit not parsed`, `run simulation(s) aborted`, an unchanged `const` plot or zero-length vectors as
   failure (return codes are 0).
4. **Checks the app must do before running, because ngspice says nothing**: `M`/`MOhm`/`MΩ` on a resistor (milli),
   `A`/`F` suffixes on sources, resistors and capacitors (atto/femto), Greek `μ` (ignored), `2k2`-style values (2000 in
   default mode), a comma inside a value, a first line that looks like an element (title trap), current sources in series
   or into a node with no other element, nodes named `ground`/`00`, `.tf` output nodes that do not exist, lines starting
   with `@`, empty `.dc` ranges (sign of step), and 0 ohm resistors (in T14a, 42 changed the answer in the 4th digit).
5. **Engine robustness**: pre-validate B lines and balanced quotes/braces (fatal errors kill the engine instance).
   Feed netlists with a title line and an explicit `.end` and no blank first line, so that file mode and `ngSpice_Circ`
   behave the same.
6. **Display**: currents through tiny resistors are inaccurate (use 0 V ammeters); transient results are on ngspice's own
   time points; node and vector names are lower-cased, numeric nodes appear as `V(1)`, and the title is lower-cased.

---

## 7. File index (`<scratch>/research/native/`)

| path | content |
|---|---|
| `fixtures/<id>.cir`, `fixtures/variants/` | the 10 fixtures; `.print` and `numdgt=16` variants |
| `fixtures.json` | Part A data (see 2.8) |
| `runs/fixtures/<ver>/<id>/` | raw files and every stdout/stderr of the fixture runs |
| `fixtures_modes_out/` | fixtures through interactive CLI 42/47 and libngspice 47 |
| `conventions/cases/`, `conventions/out/` | Part B cases B01-B24 and outputs |
| `conventions/suffix_cases/`, `conventions/suffix_out/`, `conventions/suffixes.{md,json}` | number strings |
| `conventions/ltcompat/` | `ngbehavior=lt` runs (RKM values) |
| `conventions/printing/` | numdgt and ASCII-rawfile methods |
| `traps/cases/`, `traps/out/`, `traps/modes_out/` | Part C cases T01-T21 and outputs (batch, `-r`, non-batch) |
| `traps/letters/`, `traps/letters_out/`, `traps/letters_modes_out/` | first-letter sweep L00-L56 |
| `traps.md` | Part C report with verbatim output |
| `version_diff.json` | Part D machine diff |
| `logs/` | configure/make logs, configure line, `--version` texts |
| `scripts/` | all scripts (1.2) |
| `work/` | scratch runs made while exploring (not referenced as evidence) |
| `<scratch>/native/ngspice-47/` | installed ngspice 47 (CLI) |
| `<scratch>/native/ngspice-47-shared/` | installed libngspice 47 |
