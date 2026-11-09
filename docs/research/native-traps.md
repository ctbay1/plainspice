# Beginner traps: what native ngspice actually does

Every row below was produced by running the netlist, not from memory. Versions: ngspice 42 (`/usr/bin/ngspice`, Ubuntu 42+ds-3build1) and ngspice 47 (built from the release tarball, see `native.md`). 'Batch' is `ngspice -b file.cir` (plus a second run with `-r file.raw`). 'Non-batch' is what a browser app sees: the interactive CLI driven through stdin (`source`, `run`; this is how EEcircuit-engine drives its wasm build) and the shared library libngspice 47 driven through `ngSpice_Circ` + `ngSpice_Command("run")` (scripts/shared_run.py). Batch mode stops at the first netlist error (`inp.c`: 'ngspice stopped due to error, no simulation run!'); the non-batch modes never abort, and `ngSpice_Circ`/`run` return 0 even when the netlist failed to load or the analysis failed, so an app must read the stderr text and check for a current plot with non-empty vectors.

Reaction classes: **ERROR** = no results; **WARNING/NOTE, results anyway** = a message on stderr but numbers are produced (exit code 0); **SILENT WRONG ANSWER** = no message at all and numbers that are not what the beginner meant; **silent, correct** = no message, behaviour as intended.

## Summary table

| item | trap | case | ngspice reaction (batch; both versions unless stated) | exact message (ngspice 47 stderr, deduplicated) | evidence file |
|---|---|---|---|---|---|
| 1 | 1M meant as a megaohm | `T01a_1M_megaohm` | SILENT WRONG ANSWER: 1M = 1e-3 ohm, v(n2) = 5.999999994 (meant 3) | `(none)` | `traps/out/T01a_1M_megaohm.47.txt` (`.42.txt`) |
| 1 | 1MOhm meant as a megaohm | `T01b_1MOhm` | SILENT WRONG ANSWER: 1MOhm = 1e-3 ohm (1MEGohm = 1e6) | `(none)` | `traps/out/T01b_1MOhm.47.txt` (`.42.txt`) |
| 2 | 3A current source | `T02_3A_current_source` | SILENT WRONG ANSWER: 3A = 3e-18 A, v(n1) = 1.2e-17 V | `(none)` | `traps/out/T02_3A_current_source.47.txt` (`.42.txt`) |
| 3 | no node 0 at all | `T03a_no_ground` | WARNING, results anyway (exit 0): singular matrix, then 'transient op' fallback gives arbitrary node voltages (a = 9.000333, b = 3.000333) | `Warning: singular matrix:  check node b / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Note: Transient op finished successfully` | `traps/out/T03a_no_ground.47.txt` (`.42.txt`) |
| 3 | ground written gnd | `T03b_gnd_lower` | silent, correct: gnd is node 0 | `(none)` | `traps/out/T03b_gnd_lower.47.txt` (`.42.txt`) |
| 3 | ground written GND | `T03c_GND_upper` | silent, correct: GND is node 0 (input is lower-cased) | `(none)` | `traps/out/T03c_GND_upper.47.txt` (`.42.txt`) |
| 3 | Gnd and 0 mixed | `T03e_Gnd_mixed` | silent, correct: Gnd and 0 are the same node | `(none)` | `traps/out/T03e_Gnd_mixed.47.txt` (`.42.txt`) |
| 3 | ground written ground | `T03d_ground_word` | WARNING, results anyway: 'ground' is an ordinary node, same as no ground | `Warning: singular matrix:  check node ground / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Note: Transient op finished successfully` | `traps/out/T03d_ground_word.47.txt` (`.42.txt`) |
| 3 | ground written 00 | `T03f_double_zero` | WARNING, results anyway: '00' is an ordinary node, same as no ground | `Warning: singular matrix:  check node 00 / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Note: Transient op finished successfully` | `traps/out/T03f_double_zero.47.txt` (`.42.txt`) |
| 3 | 'ground' on one element, 0 elsewhere | `T03g_ground_and_zero` | SILENT WRONG ANSWER: v(n1) = 0, v(ground) = -6, source current 0 | `(none)` | `traps/out/T03g_ground_and_zero.47.txt` (`.42.txt`) |
| 4 | node with one connection | `T04a_dangling_resistor` | silent: no message; v(n2) = v(n1) = 6, no current (numerically right) | `(none)` | `traps/out/T04a_dangling_resistor.47.txt` (`.42.txt`) |
| 4 | resistor with both ends unconnected | `T04b_floating_resistor` | WARNING, results anyway: singular matrix, transient op, v(n3) = v(n4) = 0 | `Warning: singular matrix:  check node n3 / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Note: Transient op finished successfully` | `traps/out/T04b_floating_resistor.47.txt` (`.42.txt`) |
| 5 | I source in series with C | `T05a_isrc_series_cap` | WARNING, results anyway: singular matrix, transient op, v(b) = 0.01 V (arbitrary) | `Warning: singular matrix:  check node b / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Note: Transient op finished successfully` | `traps/out/T05a_isrc_series_cap.47.txt` (`.42.txt`) |
| 5 | I source into a capacitor-only node | `T05b_isrc_into_cap_node` | WARNING, results anyway: singular matrix, transient op, v(n1) = 0.01 V (arbitrary) | `Warning: singular matrix:  check node n1 / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Note: Transient op finished successfully` | `traps/out/T05b_isrc_into_cap_node.47.txt` (`.42.txt`) |
| 5 | two different I sources in series | `T05c_two_isrc_series` | SILENT WRONG ANSWER: no message; v(n1) = -0.001 V = (1 mA - 2 mA) x 1 ohm | `(none)` | `traps/out/T05c_two_isrc_series.47.txt` (`.42.txt`) |
| 5 | two equal I sources in series | `T05d_two_equal_isrc_series` | SILENT: no message; v(n1) = 0 (undefined in theory) | `(none)` | `traps/out/T05d_two_equal_isrc_series.47.txt` (`.42.txt`) |
| 5 | I source into a node with nothing else | `T05e_isrc_only_node` | SILENT WRONG ANSWER: no message; v(n1) = 1 V for 1 A (as if 1 ohm to ground) | `(none)` | `traps/out/T05e_isrc_only_node.47.txt` (`.42.txt`) |
| 6 | two different V sources in parallel | `T06a_vsrc_parallel_different` | ERROR, no results (batch exit 1); non-batch: plot op1 with zero-length vectors, run returns 0 | `Warning: singular matrix:  check node v1#branch / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Error: Transient op failed, timestep too small / Error: The operating point could not be simulated successfully. / Any of  ...` | `traps/out/T06a_vsrc_parallel_different.47.txt` (`.42.txt`) |
| 6 | V source shorted by a 0 V source | `T06b_vsrc_shorted_by_0V` | ERROR, no results (same as above) | `Warning: singular matrix:  check node v1#branch / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Error: Transient op failed, timestep too small / Error: The operating point could not be simulated successfully. / Any of  ...` | `traps/out/T06b_vsrc_shorted_by_0V.47.txt` (`.42.txt`) |
| 6 | two equal V sources in parallel | `T06c_vsrc_parallel_equal` | ERROR, no results (same as above) | `Warning: singular matrix:  check node v1#branch / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Error: Transient op failed, timestep too small / Error: The operating point could not be simulated successfully. / Any of  ...` | `traps/out/T06c_vsrc_parallel_equal.47.txt` (`.42.txt`) |
| 7 | two R1 | `T07a_duplicate_R1` | ERROR, no results: device already exists | `Error on line 4 or its substitute: / r1 n1 0 4 / device already exists, bail out / Simulation interrupted due to error! / Error: incomplete or empty netlist / or no ".plot", ".print", or ".fourier" lines in batch mode; / no simulations run!` | `traps/out/T07a_duplicate_R1.47.txt` (`.42.txt`) |
| 7 | R1 and r1 | `T07b_R1_and_r1` | ERROR, no results: names are case-insensitive | `Error on line 4 or its substitute: / r1 n1 0 4 / device already exists, bail out / Simulation interrupted due to error! / Error: incomplete or empty netlist / or no ".plot", ".print", or ".fourier" lines in batch mode; / no simulations run!` | `traps/out/T07b_R1_and_r1.47.txt` (`.42.txt`) |
| 7 | two V1 | `T07c_duplicate_V1` | ERROR, no results | `Error on line 3 or its substitute: / v1 n2 0 3 / device already exists, bail out / Simulation interrupted due to error! / Error: incomplete or empty netlist / or no ".plot", ".print", or ".fourier" lines in batch mode; / no simulations run!` | `traps/out/T07c_duplicate_V1.47.txt` (`.42.txt`) |
| 7 | two R1 on different nodes | `T07d_duplicate_R1_different_nodes` | ERROR, no results | `Error on line 4 or its substitute: / r1 n2 0 4 / device already exists, bail out / Simulation interrupted due to error! / Error: incomplete or empty netlist / or no ".plot", ".print", or ".fourier" lines in batch mode; / no simulations run!` | `traps/out/T07d_duplicate_R1_different_nodes.47.txt` (`.42.txt`) |
| 9 | R1 a 0 | `T09a_missing_value_R` | WARNING, results anyway: the resistor is dropped | `Warning: 'r1 a 0' is not a valid resistor instance line, ignored!` | `traps/out/T09a_missing_value_R.47.txt` (`.42.txt`) |
| 9 | V1 a 0 | `T09b_missing_value_V` | NOTE, results anyway: DC 0 assumed | `Note: v1: has no value, DC 0 assumed` | `traps/out/T09b_missing_value_V.47.txt` (`.42.txt`) |
| 9 | I1 0 a | `T09c_missing_value_I` | NOTE, results anyway: DC 0 assumed | `Note: i1: has no value, DC 0 assumed` | `traps/out/T09c_missing_value_I.47.txt` (`.42.txt`) |
| 9 | C1 b 0 | `T09d_missing_value_C` | WARNING, results anyway: the capacitor is dropped | `Warning: 'c1 b 0' is not a valid capacitor instance line, ignored!` | `traps/out/T09d_missing_value_C.47.txt` (`.42.txt`) |
| 10 | R1 a 0 1,5k | `T10a_decimal_comma_R` | SILENT WRONG ANSWER: resistance becomes 5000 ohm (comma is a separator) | `(none)` | `traps/out/T10a_decimal_comma_R.47.txt` (`.42.txt`) |
| 10 | V1 a 0 1,5 | `T10b_decimal_comma_V` | ERROR, no results: unknown parameter (5) | `Error on line 2 or its substitute: / v1 a 0 1,5 / unknown parameter (5) / Simulation interrupted due to error! / Error: incomplete or empty netlist / or no ".plot", ".print", or ".fourier" lines in batch mode; / no simulations run!` | `traps/out/T10b_decimal_comma_V.47.txt` (`.42.txt`) |
| 10 | I1 0 a 2,5 | `T10c_decimal_comma_I` | ERROR, no results: unknown parameter (5) | `Error on line 2 or its substitute: / i1 0 a 2,5 / unknown parameter (5) / Simulation interrupted due to error! / Error: incomplete or empty netlist / or no ".plot", ".print", or ".fourier" lines in batch mode; / no simulations run!` | `traps/out/T10c_decimal_comma_I.47.txt` (`.42.txt`) |
| 11 | no .end | `T11a_missing_end` | silent, correct from a file (batch, source); ERROR via ngSpice_Circ (shared lib): .end statement is missing | `(none)` | `traps/out/T11a_missing_end.47.txt` (`.42.txt`) |
| 11 | no title: V1 line first | `T11b_missing_title` | SILENT WRONG ANSWER: V1 line becomes the title and is dropped, v(n1) = 0 | `(none)` | `traps/out/T11b_missing_title.47.txt` (`.42.txt`) |
| 11 | no title: R1 line first | `T11c_missing_title_resistor_first` | SILENT WRONG ANSWER: R1 line becomes the title and is dropped | `(none)` | `traps/out/T11c_missing_title_resistor_first.47.txt` (`.42.txt`) |
| 11 | blank first line | `T11d_blank_first_line` | file: blank line is the title, circuit fine; ngSpice_Circ: blank line skipped, V1 becomes the title (SILENT WRONG ANSWER) | `(none)` | `traps/out/T11d_blank_first_line.47.txt` (`.42.txt`) |
| 11 | element after .end | `T11e_lines_after_end` | file (batch, source): line IS read (i(v1) = -5); ngSpice_Circ: line ignored (i(v1) = -2). Silent either way | `(none)` | `traps/out/T11e_lines_after_end.47.txt` (`.42.txt`) |
| 12 | .tf v(n1) V9 | `T12a_tf_missing_source` | ERROR, no results: source not in circuit | `Warning: Transfer function source v9 not in circuit / doAnalyses: not found / run simulation(s) aborted` | `traps/out/T12a_tf_missing_source.47.txt` (`.42.txt`) |
| 12 | .tf v(n9) V1 | `T12b_tf_missing_node` | SILENT WRONG ANSWER: transfer_function 0, output impedance 1 ohm, no message | `(none)` | `traps/out/T12b_tf_missing_node.47.txt` (`.42.txt`) |
| 12 | .tf v(n1) R1 | `T12c_tf_resistor_as_input` | ERROR, no results: source not of proper type | `Warning: Transfer function source r1 not of proper type / doAnalyses: not found / run simulation(s) aborted` | `traps/out/T12c_tf_resistor_as_input.47.txt` (`.42.txt`) |
| 13 | N1 vs n1 | `T13_node_case` | silent, correct: node names are case-insensitive (same node) | `(none)` | `traps/out/T13_node_case.47.txt` (`.42.txt`) |
| 14 | 0 ohm resistor | `T14a_zero_ohm` | 42: SILENT, R set to 1e-3 ohm, v(b) = 5.997001 (wrong in the 4th digit); 47: WARNING, R set to 1e-12, v(b) = 6.000000 | `Warning: Value of resistor r1 is too small, set to 1.000000e-12` | `traps/out/T14a_zero_ohm.47.txt` (`.42.txt`) |
| 14 | 0 ohm across a V source | `T14b_zero_ohm_alone` | 42: silent, i(v1) = -6000 A; 47: WARNING, i(v1) = -6e12 A | `Warning: Value of resistor r1 is too small, set to 1.000000e-12` | `traps/out/T14b_zero_ohm_alone.47.txt` (`.42.txt`) |
| 15 | node connected only to capacitors | `T15a_cap_only_node` | WARNING, results anyway: singular matrix, transient op, v(b) = 3.0 | `Warning: singular matrix:  check node b / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Note: Transient op finished successfully` | `traps/out/T15a_cap_only_node.47.txt` (`.42.txt`) |
| 15 | capacitor-only node next to a divider | `T15b_cap_only_node_with_r` | WARNING, WRONG results: transient op gives v(c) = 0.0887 V for a node that is 3 V at DC | `Warning: singular matrix:  check node b / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Note: Transient op finished successfully` | `traps/out/T15b_cap_only_node_with_r.47.txt` (`.42.txt`) |
| extra | .print dc v(b), no node b | `T16_unknown_node_in_print` | batch: ERROR, analysis not run; non-batch: dc results (the .print line is not used) | `Warning: can't parse 'b': ignored / Error: no data saved for D.C. Transfer curve analysis; analysis not run / doAnalyses: not found / run simulation(s) aborted / Error: .print: no dc analysis found.` | `traps/out/T16_unknown_node_in_print.47.txt` (`.42.txt`) |
| extra | a line starting with @ | `T19_at_sign_line` | SILENT: the netlist ends at that line (later lines incl. .op are dropped), so nothing runs | `Error: incomplete or empty netlist / or no ".plot", ".print", or ".fourier" lines in batch mode; / no simulations run!` | `traps/out/T19_at_sign_line.47.txt` (`.42.txt`) |
| extra | .dc V1 0 12 0 | `T20a_dc_step_zero` | 42: HANGS (endless sweep at 0, rawfile grew to 1.26 GB in 60 s); 47: ERROR 'Bad syntax!' | `[from the -r run; plain -b runs no .dc/.tran without .print] Error on line 6 or its substitute: / .dc v1 0 12 0 / Bad syntax! / Simulation interrupted due to error! / Error: circuit not parsed. / Note: no resource usage information for 'time', / or no active circuit available` | `traps/out/T20a_dc_step_zero.47.txt` (`.42.txt`) |
| extra | .dc V1 0 12 -1 | `T20b_dc_step_negative` | SILENT: 0 points, no message | `[from the -r run; plain -b runs no .dc/.tran without .print] (none)` | `traps/out/T20b_dc_step_negative.47.txt` (`.42.txt`) |
| extra | .dc V1 12 0 1 | `T20c_dc_start_gt_stop` | SILENT: 0 points, no message | `[from the -r run; plain -b runs no .dc/.tran without .print] (none)` | `traps/out/T20c_dc_start_gt_stop.47.txt` (`.42.txt`) |
| extra | .dc V1 0 12 | `T20d_dc_missing_step` | 42: HANGS; 47: ERROR 'Bad syntax!' | `[from the -r run; plain -b runs no .dc/.tran without .print] Error on line 6 or its substitute: / .dc v1 0 12 / Bad syntax! / Simulation interrupted due to error! / Error: circuit not parsed. / Note: no resource usage information for 'time', / or no active circuit available` | `traps/out/T20d_dc_missing_step.47.txt` (`.42.txt`) |
| extra | .dc V9 0 12 1 | `T20e_dc_unknown_source` | ERROR when the sweep runs: source not in the circuit | `[from the -r run; plain -b runs no .dc/.tran without .print] Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "v9" is not in the circuit / doAnalyses: no such device / run simulation(s) aborted` | `traps/out/T20e_dc_unknown_source.47.txt` (`.42.txt`) |
| extra | .dc V1 0 12 20 | `T20f_dc_step_too_big` | SILENT: 1 point (V1 = 0) | `[from the -r run; plain -b runs no .dc/.tran without .print] (none)` | `traps/out/T20f_dc_step_too_big.47.txt` (`.42.txt`) |
| extra | .tran 5m | `T21a_tran_one_arg` | ERROR: TSTOP is invalid | `[from the -r run; plain -b runs no .dc/.tran without .print] Error on line 6 or its substitute: / .tran 5m / TSTOP is invalid, must be greater than zero. / Simulation interrupted due to error! / Error: circuit not parsed. / Note: no resource usage information for 'time', / or no active circuit available` | `traps/out/T21a_tran_one_arg.47.txt` (`.42.txt`) |
| extra | .tran 0 5m | `T21b_tran_zero_step` | ERROR: TSTEP is invalid | `[from the -r run; plain -b runs no .dc/.tran without .print] Error on line 6 or its substitute: / .tran 0 5m / TSTEP is invalid, must be greater than zero. / Simulation interrupted due to error! / Error: circuit not parsed. / Note: no resource usage information for 'time', / or no active circuit available` | `traps/out/T21b_tran_zero_step.47.txt` (`.42.txt`) |
| extra | .tran 1 5m | `T21c_tran_step_gt_stop` | SILENT: runs, 59 points | `[from the -r run; plain -b runs no .dc/.tran without .print] (none)` | `traps/out/T21c_tran_step_gt_stop.47.txt` (`.42.txt`) |
| extra | .tran 10u 5m 6m | `T21d_tran_tstart_gt_tstop` | ERROR: TSTART is invalid | `[from the -r run; plain -b runs no .dc/.tran without .print] Error on line 6 or its substitute: / .tran 10u 5m 6m / TSTART is invalid, must be less than TSTOP. / Simulation interrupted due to error! / Error: circuit not parsed. / Note: no resource usage information for 'time', / or no active circuit available` | `traps/out/T21d_tran_tstart_gt_tstop.47.txt` (`.42.txt`) |
| extra | no analysis line | `T21e_no_analysis` | batch: no simulations run (exit 1); shared lib: 'No job ... defined' | `Error: incomplete or empty netlist / or no ".plot", ".print", or ".fourier" lines in batch mode; / no simulations run!` | `traps/out/T21e_no_analysis.47.txt` (`.42.txt`) |

Where 42 prints a different message, it is shown in the per-case sections below. The most common 42/47 difference is the closing line of a batch run that did not simulate: 42 prints `Note: No ".plot", ".print", or ".fourier" lines; no simulations run`, 47 prints `Error: incomplete or empty netlist` / `or no ".plot", ".print", or ".fourier" lines in batch mode;` / `no simulations run!`. Both exit with code 1.

## Item 8: first letters

Template (`traps/letters/Lnn.cir`): title line, `Rref a 0 1`, `<X>1 a 0 5`, `.op`, `.end` (the reference resistor is called Rref so that the R case does not collide with R1).

| char | case | 42 batch | 47 batch | message (47 stderr; 42 if different) | results in non-batch modes |
|---|---|---|---|---|---|
| `A` | L00 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / a1 a 0 5 / MIF-ERROR - unable to find definition of model 5` | shared 47: plot const |
| `B` | L01 | rejected (exit 1) | rejected (exit 1) | `ERROR: mal formed B source instance: b1 a 0 5 / in line no. 3 of file L01.cir / ERROR: fatal error in ngspice, exit(1) **[42:** ERROR: mal formed B line: b1 a 0 5 / ERROR: fatal error in ngspice, exit(1)**]**` | shared 47: plot const, ControlledExit(1) 'ngspice.dll cannot recover and awaits to be reset'; interactive CLI exited (exit 1) |
| `C` | L02 | accepted, v(a) = 0.0 | accepted, v(a) = 0.0 | `(none)` | shared 47: plot op1 |
| `D` | L03 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / d1 a 0 5 / could not find a valid modelname` | shared 47: plot const |
| `E` | L04 | rejected (exit 1) | rejected (exit 1) | `Error: not enough parameters in line / e1 a 0 5 / line no 3, file L04.cir / No circuit loaded! **[42:** Error: not enough parameters in line / e1 a 0 5 / No circuit loaded!**]**` | shared 47: plot const |
| `F` | L05 | rejected (exit 1) | rejected (exit 1) | `Error: not enough parameters in line / f1 a 0 5 / line no 3, file L05.cir / No circuit loaded! **[42:** Error: not enough parameters in line / f1 a 0 5 / No circuit loaded!**]**` | shared 47: plot const |
| `G` | L06 | rejected (exit 1) | rejected (exit 1) | `Error: not enough parameters in line / g1 a 0 5 / line no 3, file L06.cir / No circuit loaded! **[42:** Error: not enough parameters in line / g1 a 0 5 / No circuit loaded!**]**` | shared 47: plot const |
| `H` | L07 | rejected (exit 1) | rejected (exit 1) | `Error: not enough parameters in line / h1 a 0 5 / line no 3, file L07.cir / No circuit loaded! **[42:** Error: not enough parameters in line / h1 a 0 5 / No circuit loaded!**]**` | shared 47: plot const |
| `I` | L08 | accepted, v(a) = -5.0 | accepted, v(a) = -5.0 | `(none)` | shared 47: plot op1 |
| `J` | L09 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / j1 a 0 5 / Unable to find definition of model` | shared 47: plot const |
| `K` | L10 | rejected (exit 1) | rejected (exit 1) | `Fatal error: k1: coupling to non-existent inductor a. / doAnalyses: not found / run simulation(s) aborted` | shared 47: plot const |
| `L` | L11 | accepted, v(a) = 0.0 | accepted, v(a) = 0.0 | `(none)` | shared 47: plot op1 |
| `M` | L12 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / m1 a 0 5 / could not find a valid modelname` | shared 47: plot const |
| `N` | L13 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / n1 a 0 5 / Unable to find definition of model 5 **[42:** Error on line 3 or its substitute: / n1 a 0 5 / could not find a valid modelname**]**` | shared 47: plot const |
| `O` | L14 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / o1 a 0 5 / Unable to find definition of model` | shared 47: plot const |
| `P` | L15 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / p1 a 0 5 / Unable to find definition of model 5` | shared 47: plot const |
| `Q` | L16 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / q1 a 0 5 / could not find a valid modelname` | shared 47: plot const |
| `R` | L17 | accepted, v(a) = 0.0 | accepted, v(a) = 0.0 | `(none)` | shared 47: plot op1 |
| `S` | L18 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / s1 a 0 5 / Unable to find definition of model` | shared 47: plot const |
| `T` | L19 | rejected (exit 1) | rejected (exit 1) | `Fatal error: t1: transmission line z0 must be given / doAnalyses: no such parameter on this device or parameter is missing / run simulation(s) aborted **[42:** Fatal error: t1: transmission line z0 must be given / doAnalyses: no such parameter on this device / run simulation(s) aborted**]**` | shared 47: plot const |
| `U` | L20 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / u1 a 0 5 / Unable to find definition of model` | shared 47: plot const |
| `V` | L21 | accepted, v(a) = 5.0 | accepted, v(a) = 5.0 | `(none)` | shared 47: plot op1 |
| `W` | L22 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / w1 a 0 5 / Unable to find definition of model` | shared 47: plot const |
| `X` | L23 | rejected (exit 1) | rejected (exit 1) | `Error: unknown subckt: x1 a 0 5 / in line no. 3 from file L23.cir **[42:** Error: unknown subckt: x1 a 0 5**]**` | shared 47: plot const |
| `Y` | L24 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / y1 a 0 5 / model name is not found` | shared 47: plot const |
| `Z` | L25 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / z1 a 0 5 / Unable to find definition of model` | shared 47: plot const |
| `0` | L26 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / 01 a 0 5 / unknown device type - error` | shared 47: plot const |
| `1` | L27 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / 11 a 0 5 / unknown device type - error` | shared 47: plot const |
| `9` | L28 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / 91 a 0 5 / unknown device type - error` | shared 47: plot const |
| `*` | L29 | accepted, v(a) = 0.0 | accepted, v(a) = 0.0 | `(none)` | shared 47: plot op1 |
| `+` | L30 | rejected (exit 1) | rejected (exit 1) | `Error on line 2 or its substitute: / rref a 0 1 1 a 0 5 / unknown parameter (a)` | shared 47: plot const |
| `.` | L31 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / .1 a 0 5 / unimplemented dot command '.1'` | shared 47: plot const |
| `#` | L32 | rejected (exit 1) | accepted, v(a) = 0.0 | `(none) **[42:** Error on line 3 or its substitute: / #1 a 0 5 / unknown device type - error**]**` | shared 47: plot op1 |
| `$` | L33 | accepted, v(a) = 0.0 | accepted, v(a) = 0.0 | `Warning: Unusual leading characters like '$' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / check line  $1 a 0 5 / line no. 3 from file L33.cir! **[42:** Warning: Unusual leading characters like '$' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / Check line no 3:  $1 a 0 5**]**` | shared 47: plot op1 |
| `;` | L34 | accepted, v(a) = 0.0 | accepted, v(a) = 0.0 | `(none)` | shared 47: plot op1 |
| `/` | L35 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / /1 a 0 5 / unknown device type - error` | shared 47: plot const |
| `-` | L36 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / -1 a 0 5 / unknown device type - error` | shared 47: plot const |
| `&` | L37 | accepted, v(a) = 0.0 | accepted, v(a) = 0.0 | `Warning: Unusual leading characters like '&' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / check line  &1 a 0 5 / line no. 3 from file L37.cir! **[42:** Warning: Unusual leading characters like '&' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / Check line no 3:  &1 a 0 5**]**` | shared 47: plot op1 |
| `!` | L38 | accepted, v(a) = 0.0 | accepted, v(a) = 0.0 | `Warning: Unusual leading characters like '!' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / check line  !1 a 0 5 / line no. 3 from file L38.cir! **[42:** Warning: Unusual leading characters like '!' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / Check line no 3:  !1 a 0 5**]**` | shared 47: plot op1 |
| `@` | L39 | rejected (exit 1) | rejected (exit 1) | `(none)` | shared 47: plot const |
| `%` | L40 | accepted, v(a) = 0.0 | accepted, v(a) = 0.0 | `Warning: Unusual leading characters like '%' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / check line  %1 a 0 5 / line no. 3 from file L40.cir! **[42:** Warning: Unusual leading characters like '%' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / Check line no 3:  %1 a 0 5**]**` | shared 47: plot op1 |
| `(` | L41 | accepted, v(a) = 0.0 | accepted, v(a) = 0.0 | `Warning: Unusual leading characters like '(' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / check line  (1 a 0 5 / line no. 3 from file L41.cir! **[42:** Warning: Unusual leading characters like '(' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / Check line no 3:  (1 a 0 5**]**` | shared 47: plot op1 |
| `=` | L42 | accepted, v(a) = 0.0 | accepted, v(a) = 0.0 | `Warning: Unusual leading characters like '=' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / check line  =1 a 0 5 / line no. 3 from file L42.cir! **[42:** Warning: Unusual leading characters like '=' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / Check line no 3:  =1 a 0 5**]**` | shared 47: plot op1 |
| `~` | L43 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / ~1 a 0 5 / unknown device type - error` | shared 47: plot const |
| `_` | L44 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / _1 a 0 5 / unknown device type - error` | shared 47: plot const |
| `'` | L45 | rejected (exit 1) | rejected (exit 1) | `Error in netlist line no. 4, new internal line no. 3: / Closing "}" not found in line fragment / {1 a 0 5. / ERROR: fatal error in ngspice, exit(1) **[42:** Netlist line no. 3: / Closing "}" not found in line fragment / {1 a 0 5. / ERROR: fatal error in ngspice, exit(1)**]**` | shared 47: plot const, ControlledExit(1) 'ngspice.dll cannot recover and awaits to be reset'; interactive CLI exited (exit 1) |
| `"` | L46 | accepted, v(a) = 0.0 | accepted, v(a) = 0.0 | `Warning: Unusual leading characters like '"' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / check line  "1 a 0 5 / line no. 3 from file L46.cir! **[42:** Warning: Unusual leading characters like '"' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / Check line no 3:  "1 a 0 5**]**` | shared 47: plot op1 |
| `{` | L47 | rejected (exit 1) | rejected (exit 1) | `Error in netlist line no. 4, new internal line no. 3: / Closing "}" not found in line fragment / {1 a 0 5. / ERROR: fatal error in ngspice, exit(1) **[42:** Netlist line no. 3: / Closing "}" not found in line fragment / {1 a 0 5. / ERROR: fatal error in ngspice, exit(1)**]**` | shared 47: plot const, ControlledExit(1) 'ngspice.dll cannot recover and awaits to be reset'; interactive CLI exited (exit 1) |
| `[` | L48 | accepted, v(a) = 0.0 | accepted, v(a) = 0.0 | `Warning: Unusual leading characters like '[' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / check line  [1 a 0 5 / line no. 3 from file L48.cir! **[42:** Warning: Unusual leading characters like '[' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / Check line no 3:  [1 a 0 5**]**` | shared 47: plot op1 |
| `<` | L49 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / <1 a 0 5 / unknown device type - error` | shared 47: plot const |
| `?` | L50 | accepted, v(a) = 0.0 | accepted, v(a) = 0.0 | `Warning: Unusual leading characters like '?' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / check line  ?1 a 0 5 / line no. 3 from file L50.cir! **[42:** Warning: Unusual leading characters like '?' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / Check line no 3:  ?1 a 0 5**]**` | shared 47: plot op1 |
| `,` | L51 | accepted, v(a) = 0.0 | accepted, v(a) = 0.0 | `Warning: Unusual leading characters like ',' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / check line  ,1 a 0 5 / line no. 3 from file L51.cir! **[42:** Warning: Unusual leading characters like ',' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / Check line no 3:  ,1 a 0 5**]**` | shared 47: plot op1 |
| `:` | L52 | accepted, v(a) = 0.0 | accepted, v(a) = 0.0 | `Warning: Unusual leading characters like ':' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / check line  :1 a 0 5 / line no. 3 from file L52.cir! **[42:** Warning: Unusual leading characters like ':' or others out of '= [] ? () & % $"!:,\f' / in netlist or included files, will be replaced with '*'. / Check line no 3:  :1 a 0 5**]**` | shared 47: plot op1 |
| `^` | L53 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / ^1 a 0 5 / unknown device type - error` | shared 47: plot const |
| `\|` | L54 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / \|1 a 0 5 / unknown device type - error` | shared 47: plot const |
| `\` | L55 | rejected (exit 1) | rejected (exit 1) | `Error on line 3 or its substitute: / \1 a 0 5 / unknown device type - error` | shared 47: plot const |
| `` ` `` | L56 | rejected (exit 1) | rejected (exit 1) | `` Error on line 3 or its substitute: / `1 a 0 5 / unknown device type - error `` | shared 47: plot const |

Reading the table: C, I, L, R, V take a 2-node line with a bare value (5 F, 5 A, 5 H, 5 ohm, 5 V). D, M, Q need a model; J, O, S, U, W, Z, Y, P need a model or more terminals; E, F, G, H need more fields; A is an XSPICE code-model instance; B needs `V=` or `I=` and a malformed B line is FATAL (the CLI exits, the shared library calls ControlledExit and must be reset); K and T fail only when the analysis starts; X needs a .subckt. `*` and `;` start comments; `#` is a comment in 47 but an error in 42; `$ & ! % ( = " [ ? , :` as first character trigger one warning and the line is turned into a comment; `+` continues the previous line; `.` is a dot command; a line starting with `@` silently ends the netlist (`inpcom.c` line 1431); `'` and `{` start an expression and are FATAL when unbalanced; digits and `/ - ~ _ < ^ | \ backtick` give 'unknown device type - error'.

What each letter means to ngspice (syntax comments from `src47/src/spicelib/parser/inppas2.c` lines 107-250; device names from the `devhelp` command, `conventions/devhelp.47.txt`):

| letter | ngspice device | syntax (inppas2.c comment) |
|---|---|---|
| A | XSPICE code model instance (`gain`, `int`, `pwl`, ...) | `Aname <cm connections> <mname>` |
| B | ASRC, Arbitrary Source (behavioural) | `Bname <node> <node> [V=expr] [I=expr]` |
| C | Capacitor | `Cname <node> <node> <val> [IC=<val>]` |
| D | Diode (model required) | `Dname <node> <node> <model> [<val>] [OFF] [IC=<val>]` |
| E | VCVS | `Ename <node> <node> <node> <node> <val>` |
| F | CCCS | `Fname <node> <node> <vname> <val>` |
| G | VCCS | `Gname <node> <node> <node> <node> <val>` |
| H | CCVS (devhelp's description text says 'Linear current controlled current source') | `Hname <node> <node> <vname> <val>` |
| I | Isource | `Iname <node> <node> [ [DC] <val>] [AC [<val> [<val> ] ] ]` |
| J | JFET | `Jname <node> <node> <node> <model> [<val>] [OFF]` |
| K | mutual (coupled inductors) | `Kname Lname Lname <val>` |
| L | Inductor | `Lname <node> <node> <val> [IC=<val>]` |
| M | MOSFET (Mos1..9, BSIM, ...) | `Mname <node> <node> <node> <node> <model> [L=<val>] ...` |
| N | Verilog-A (OSDI) device | `Nname [<node>...]  [<mname>]` |
| O | LTRA, lossy transmission line | `Oname <node> <node> <node> <node> <model>` |
| P | CplLines, coupled multiconductor lines | `Pname <node> <node> ... <gnd> <node> <node> ... <gnd> [<modname>]` |
| Q | BJT | `Qname <node> <node> <node> [<node>] <model> [<val>] [OFF]` |
| R | Resistor | `Rname <node> <node> [<val>][<mname>][w=<val>][l=<val>]` |
| S | Switch, voltage controlled | `Sname <node> <node> <node> <node> [<modname>] [IC]` |
| T | Tranline, lossless transmission line | `Tname <node> <node> <node> <node> [TD=<val>] ...` |
| U | URC, uniform R.C. line | `Uname <node> <node> <model> [l=<val>] [n=<val>]` |
| V | Vsource | `Vname <node> <node> [ [DC] <val>] [AC [<val> [<val> ] ] ]` |
| W | CSwitch, current controlled switch | `Wname <node> <node> <vctrl> [<modname>] [IC]` |
| X | subcircuit call | `(expanded before parsing; needs a .subckt)` |
| Y | TransLine, simple lossy transmission line | `Yname <node> <node> R=<val> L=<val> G=<val> C=<val> len=<val>` |
| Z | MESFET (MES, MESA, HFET) | `Zname <node> <node> <node> <model> [<val>] [OFF]` |

So a beginner's `W1` (wire), `S1` (switch), `T1` (transformer), `K1` (constant), `O1`, `U1`, `Y1`, `P1`, `N1`, `Z1`, `A1` are all read as other devices; with the 2-node template every one of them is rejected.

## Per-case evidence (verbatim)

Each block is the verbatim stdout and stderr of `ngspice -b`, except that the device/model parameter listing that batch mode prints after an .op (and the resource-usage footer) is replaced by a marker; the full text is in the evidence file. stdout and stderr were captured separately, so their relative order is not shown (see `runs/fixtures/*/F*/batch_terminal.stdout.txt` for a terminal-interleaved example).

### T01a_1M_megaohm: 1M meant as a megaohm

Netlist (`traps/cases/T01a_1M_megaohm.cir`):

```spice
T01a: 1M meant as a megaohm (it is a milliohm)
V1 n1 0 6
R1 n1 n2 1M
R2 n2 0 1meg
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T01a_1M_megaohm.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t01a: 1m meant as a megaohm (it is a milliohm)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n2                               6.000000e+00
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -6.00000e-06

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, v(n2) = 5.999999994, i(v1) = -5.99999930273043e-06

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T01a_1M_megaohm.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t01a: 1m meant as a megaohm (it is a milliohm)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n2                               6.000000e+00
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -6.00000e-06

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, v(n2) = 5.999999994, i(v1) = -5.99999930273043e-06

Non-batch modes (evidence `traps/modes_out/T01a_1M_megaohm.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -5.99999930273043e-06, n2 = 5.999999994, n1 = 6.0

### T01b_1MOhm: 1MOhm meant as a megaohm

Netlist (`traps/cases/T01b_1MOhm.cir`):

```spice
T01b: 1MOhm meant as a megaohm (still a milliohm)
V1 n1 0 6
R1 n1 n2 1MOhm
R2 n2 0 1MEGohm
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T01b_1MOhm.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t01b: 1mohm meant as a megaohm (still a milliohm)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n2                               6.000000e+00
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -6.00000e-06

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, v(n2) = 5.999999994, i(v1) = -5.99999930273043e-06

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T01b_1MOhm.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t01b: 1mohm meant as a megaohm (still a milliohm)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n2                               6.000000e+00
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -6.00000e-06

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, v(n2) = 5.999999994, i(v1) = -5.99999930273043e-06

Non-batch modes (evidence `traps/modes_out/T01b_1MOhm.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -5.99999930273043e-06, n2 = 5.999999994, n1 = 6.0

### T02_3A_current_source: 3A current source

Netlist (`traps/cases/T02_3A_current_source.cir`):

```spice
T02: a 3A current source (A is atto, 3e-18 A)
I1 0 n1 3A
R1 n1 0 4
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T02_3A_current_source.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t02: a 3a current source (a is atto, 3e-18 a)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               1.200000e-17

	Source	Current
	------	-------

[... 48 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 1.2000000000000001e-17

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T02_3A_current_source.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t02: a 3a current source (a is atto, 3e-18 a)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               1.200000e-17

	Source	Current
	------	-------

[... 48 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 1.2000000000000001e-17

Non-batch modes (evidence `traps/modes_out/T02_3A_current_source.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: n1 = 1.2000000000000001e-17

### T03a_no_ground: no node 0 at all

Netlist (`traps/cases/T03a_no_ground.cir`):

```spice
T03a: no ground (no node 0 anywhere)
V1 a b 6
R1 a b 2
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T03a_no_ground.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t03a: no ground (no node 0 anywhere)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	b                                3.000333e+00
	a                                9.000333e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
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
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 9.00033307426206, v(b) = 3.0003330742710626, i(v1) = -2.9999999999924993

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T03a_no_ground.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t03a: no ground (no node 0 anywhere)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	b                                3.000333e+00
	a                                9.000333e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
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
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 9.00033307426206, v(b) = 3.0003330742710626, i(v1) = -2.9999999999924993

Non-batch modes (evidence `traps/modes_out/T03a_no_ground.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -2.9999999999924993, b = 3.0003330742710626, a = 9.00033307426206; stderr: Warning: singular matrix:  check node b / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Note: Transient op finished successfully

### T03b_gnd_lower: ground written gnd

Netlist (`traps/cases/T03b_gnd_lower.cir`):

```spice
T03b: ground written as gnd
V1 n1 gnd 6
R1 n1 gnd 2
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T03b_gnd_lower.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t03b: ground written as gnd

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, i(v1) = -3.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T03b_gnd_lower.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t03b: ground written as gnd

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, i(v1) = -3.0

Non-batch modes (evidence `traps/modes_out/T03b_gnd_lower.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -3.0, n1 = 6.0

### T03c_GND_upper: ground written GND

Netlist (`traps/cases/T03c_GND_upper.cir`):

```spice
T03c: ground written as GND
V1 n1 GND 6
R1 n1 GND 2
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T03c_GND_upper.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t03c: ground written as gnd

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, i(v1) = -3.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T03c_GND_upper.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t03c: ground written as gnd

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, i(v1) = -3.0

Non-batch modes (evidence `traps/modes_out/T03c_GND_upper.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -3.0, n1 = 6.0

### T03e_Gnd_mixed: Gnd and 0 mixed

Netlist (`traps/cases/T03e_Gnd_mixed.cir`):

```spice
T03e: ground written as Gnd, mixed with 0
V1 n1 Gnd 6
R1 n1 0 2
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T03e_Gnd_mixed.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t03e: ground written as gnd, mixed with 0

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, i(v1) = -3.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T03e_Gnd_mixed.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t03e: ground written as gnd, mixed with 0

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, i(v1) = -3.0

Non-batch modes (evidence `traps/modes_out/T03e_Gnd_mixed.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -3.0, n1 = 6.0

### T03d_ground_word: ground written ground

Netlist (`traps/cases/T03d_ground_word.cir`):

```spice
T03d: ground written as ground
V1 n1 ground 6
R1 n1 ground 2
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T03d_ground_word.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t03d: ground written as ground

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	ground                           3.000333e+00
	n1                               9.000333e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
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
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 9.00033307426206, v(ground) = 3.0003330742710626, i(v1) = -2.9999999999924993

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T03d_ground_word.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t03d: ground written as ground

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	ground                           3.000333e+00
	n1                               9.000333e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
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
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 9.00033307426206, v(ground) = 3.0003330742710626, i(v1) = -2.9999999999924993

Non-batch modes (evidence `traps/modes_out/T03d_ground_word.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -2.9999999999924993, ground = 3.0003330742710626, n1 = 9.00033307426206; stderr: Warning: singular matrix:  check node ground / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Note: Transient op finished successfully

### T03f_double_zero: ground written 00

Netlist (`traps/cases/T03f_double_zero.cir`):

```spice
T03f: ground written as 00
V1 n1 00 6
R1 n1 00 2
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T03f_double_zero.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t03f: ground written as 00

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	V(00)                            3.000333e+00
	n1                               9.000333e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
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
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 9.00033307426206, v(00) = 3.0003330742710626, i(v1) = -2.9999999999924993

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T03f_double_zero.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t03f: ground written as 00

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	V(00)                            3.000333e+00
	n1                               9.000333e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
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
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 9.00033307426206, v(00) = 3.0003330742710626, i(v1) = -2.9999999999924993

Non-batch modes (evidence `traps/modes_out/T03f_double_zero.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -2.9999999999924993, V(00) = 3.0003330742710626, n1 = 9.00033307426206; stderr: Warning: singular matrix:  check node 00 / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Note: Transient op finished successfully

### T03g_ground_and_zero: 'ground' on one element, 0 elsewhere

Netlist (`traps/cases/T03g_ground_and_zero.cir`):

```spice
T03g: one source to ground, one resistor to 0 (are they the same node?)
V1 n1 ground 6
R1 n1 0 2
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T03g_ground_and_zero.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t03g: one source to ground, one resistor to 0 (are they the same node?)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	ground                           -6.00000e+00
	n1                               0.000000e+00

	Source	Current
	------	-------

	v1#branch                        0.000000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 0.0, v(ground) = -6.0, i(v1) = 0.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T03g_ground_and_zero.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t03g: one source to ground, one resistor to 0 (are they the same node?)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	ground                           -6.00000e+00
	n1                               0.000000e+00

	Source	Current
	------	-------

	v1#branch                        0.000000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 0.0, v(ground) = -6.0, i(v1) = 0.0

Non-batch modes (evidence `traps/modes_out/T03g_ground_and_zero.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = 0.0, ground = -6.0, n1 = 0.0

### T04a_dangling_resistor: node with one connection

Netlist (`traps/cases/T04a_dangling_resistor.cir`):

```spice
T04a: a node with only one connection (dangling end of R2)
V1 n1 0 6
R1 n1 0 2
R2 n1 n2 3
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T04a_dangling_resistor.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t04a: a node with only one connection (dangling end of r2)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n2                               6.000000e+00
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, v(n2) = 6.0, i(v1) = -3.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T04a_dangling_resistor.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t04a: a node with only one connection (dangling end of r2)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n2                               6.000000e+00
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, v(n2) = 6.0, i(v1) = -3.0

Non-batch modes (evidence `traps/modes_out/T04a_dangling_resistor.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -3.0, n2 = 6.0, n1 = 6.0

### T04b_floating_resistor: resistor with both ends unconnected

Netlist (`traps/cases/T04b_floating_resistor.cir`):

```spice
T04b: a resistor whose both nodes connect to nothing else
V1 n1 0 6
R1 n1 0 2
R2 n3 n4 3
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T04b_floating_resistor.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t04b: a resistor whose both nodes connect to nothing else

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n4                               0.000000e+00
	n3                               0.000000e+00
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
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
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 5.9999999999939995, v(n3) = 0.0, v(n4) = 0.0, i(v1) = -2.9999999999939995

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T04b_floating_resistor.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t04b: a resistor whose both nodes connect to nothing else

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n4                               0.000000e+00
	n3                               0.000000e+00
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
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
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 5.9999999999939995, v(n3) = 0.0, v(n4) = 0.0, i(v1) = -2.9999999999939995

Non-batch modes (evidence `traps/modes_out/T04b_floating_resistor.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -2.9999999999939995, n4 = 0.0, n3 = 0.0, n1 = 5.9999999999939995; stderr: Warning: singular matrix:  check node n3 / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Note: Transient op finished successfully

### T05a_isrc_series_cap: I source in series with C

Netlist (`traps/cases/T05a_isrc_series_cap.cir`):

```spice
T05a: a current source in series with a capacitor (node b has only I1 and C1)
V1 a 0 5
R1 a c 1k
I1 c b 1m
C1 b 0 1u
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T05a_isrc_series_cap.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t05a: a current source in series with a capacitor (node b has only i1 and c1)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	b                                1.000000e-02
	c                                4.000000e+00
	a                                5.000000e+00

	Source	Current
	------	-------

	v1#branch                        -1.00000e-03

[... 94 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
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
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 4.9999999999949996, v(c) = 3.9999999959949997, v(b) = 0.009999999999950042, i(v1) = -0.001000000003999

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T05a_isrc_series_cap.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t05a: a current source in series with a capacitor (node b has only i1 and c1)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	b                                1.000000e-02
	c                                4.000000e+00
	a                                5.000000e+00

	Source	Current
	------	-------

	v1#branch                        -1.00000e-03

[... 94 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
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
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 4.9999999999949996, v(c) = 3.9999999959949997, v(b) = 0.009999999999950042, i(v1) = -0.001000000003999

Non-batch modes (evidence `traps/modes_out/T05a_isrc_series_cap.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -0.001000000003999, b = 0.009999999999950042, c = 3.9999999959949997, a = 4.9999999999949996; stderr: Warning: singular matrix:  check node b / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Note: Transient op finished successfully

### T05b_isrc_into_cap_node: I source into a capacitor-only node

Netlist (`traps/cases/T05b_isrc_into_cap_node.cir`):

```spice
T05b: a current source feeding a node that only has a capacitor
I1 0 n1 1m
C1 n1 0 1u
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T05b_isrc_into_cap_node.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t05b: a current source feeding a node that only has a capacitor

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               1.000000e-02

	Source	Current
	------	-------

[... 44 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Warning: singular matrix:  check node n1

Note: Starting dynamic gmin stepping
Warning: singular matrix:  check node n1

Warning: Dynamic gmin stepping failed
Note: Starting true gmin stepping
Warning: singular matrix:  check node n1

Warning: singular matrix:  check node n1

Warning: singular matrix:  check node n1

Warning: singular matrix:  check node n1

Warning: True gmin stepping failed
Note: Starting source stepping
Warning: source stepping failed
Note: Transient op started
Note: Transient op finished successfully
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 0.009999999999950042

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T05b_isrc_into_cap_node.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t05b: a current source feeding a node that only has a capacitor

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               1.000000e-02

	Source	Current
	------	-------

[... 44 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
Warning: singular matrix:  check node n1

Note: Starting dynamic gmin stepping
Warning: singular matrix:  check node n1

Warning: Dynamic gmin stepping failed
Note: Starting true gmin stepping
Warning: singular matrix:  check node n1

Warning: singular matrix:  check node n1

Warning: singular matrix:  check node n1

Warning: singular matrix:  check node n1

Warning: True gmin stepping failed
Note: Starting source stepping
Warning: source stepping failed
Note: Transient op started
Note: Transient op finished successfully
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 0.009999999999950042

Non-batch modes (evidence `traps/modes_out/T05b_isrc_into_cap_node.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: n1 = 0.009999999999950042; stderr: Warning: singular matrix:  check node n1 / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Note: Transient op finished successfully

### T05c_two_isrc_series: two different I sources in series

Netlist (`traps/cases/T05c_two_isrc_series.cir`):

```spice
T05c: two different current sources in series
I1 0 n1 1m
I2 n1 0 2m
R1 n2 0 1k
V1 n2 0 1
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T05c_two_isrc_series.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t05c: two different current sources in series

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n2                               1.000000e+00
	n1                               -1.00000e-03

	Source	Current
	------	-------

	v1#branch                        -1.00000e-03

[... 68 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = -0.001, v(n2) = 1.0, i(v1) = -0.001

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T05c_two_isrc_series.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t05c: two different current sources in series

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n2                               1.000000e+00
	n1                               -1.00000e-03

	Source	Current
	------	-------

	v1#branch                        -1.00000e-03

[... 68 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = -0.001, v(n2) = 1.0, i(v1) = -0.001

Non-batch modes (evidence `traps/modes_out/T05c_two_isrc_series.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -0.001, n2 = 1.0, n1 = -0.001

### T05d_two_equal_isrc_series: two equal I sources in series

Netlist (`traps/cases/T05d_two_equal_isrc_series.cir`):

```spice
T05d: two equal current sources in series (node n1 voltage undefined)
I1 0 n1 1m
I2 n1 0 1m
R1 n2 0 1k
V1 n2 0 1
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T05d_two_equal_isrc_series.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t05d: two equal current sources in series (node n1 voltage undefined)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n2                               1.000000e+00
	n1                               0.000000e+00

	Source	Current
	------	-------

	v1#branch                        -1.00000e-03

[... 68 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 0.0, v(n2) = 1.0, i(v1) = -0.001

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T05d_two_equal_isrc_series.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t05d: two equal current sources in series (node n1 voltage undefined)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n2                               1.000000e+00
	n1                               0.000000e+00

	Source	Current
	------	-------

	v1#branch                        -1.00000e-03

[... 68 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 0.0, v(n2) = 1.0, i(v1) = -0.001

Non-batch modes (evidence `traps/modes_out/T05d_two_equal_isrc_series.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -0.001, n2 = 1.0, n1 = 0.0

### T05e_isrc_only_node: I source into a node with nothing else

Netlist (`traps/cases/T05e_isrc_only_node.cir`):

```spice
T05e: a current source into a node that has nothing else
I1 0 n1 1
V1 n2 0 1
R1 n2 0 1
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T05e_isrc_only_node.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t05e: a current source into a node that has nothing else

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n2                               1.000000e+00
	n1                               1.000000e+00

	Source	Current
	------	-------

	v1#branch                        -1.00000e+00

[... 68 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 1.0, v(n2) = 1.0, i(v1) = -1.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T05e_isrc_only_node.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t05e: a current source into a node that has nothing else

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n2                               1.000000e+00
	n1                               1.000000e+00

	Source	Current
	------	-------

	v1#branch                        -1.00000e+00

[... 68 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 1.0, v(n2) = 1.0, i(v1) = -1.0

Non-batch modes (evidence `traps/modes_out/T05e_isrc_only_node.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -1.0, n2 = 1.0, n1 = 1.0

### T06a_vsrc_parallel_different: two different V sources in parallel

Netlist (`traps/cases/T06a_vsrc_parallel_different.cir`):

```spice
T06a: two different voltage sources in parallel
V1 n1 0 5
V2 n1 0 3
R1 n1 0 1k
.op
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T06a_vsrc_parallel_different.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t06a: two different voltage sources in parallel

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

DC solution failed -

Last Node Voltages
------------------

Node                                   Last Voltage        Previous Iter
----                                   ------------        -------------
n1                                                0                    0
v2#branch                                         0                    3 *
v1#branch                                         0                    5 *
--- stderr ---
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
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T06a_vsrc_parallel_different.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t06a: two different voltage sources in parallel

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

DC solution failed -

Last Node Voltages
------------------

Node                                   Last Voltage        Previous Iter
----                                   ------------        -------------
n1                                                0                    0
v2#branch                                         0                    3 *
v1#branch                                         0                    5 *
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
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
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T06a_vsrc_parallel_different.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = complex or empty (length 0), v2#branch = complex or empty (length 0), n1 = complex or empty (length 0); stderr: Warning: singular matrix:  check node v1#branch / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Error: Transient op failed, timestep too small / Error: The operating point could not be simulated successfully. / Any of the following steps may fail.! / doAnalyses: OP:  Timestep too small; cause unrecorded. / run simulation(s) aborted

### T06b_vsrc_shorted_by_0V: V source shorted by a 0 V source

Netlist (`traps/cases/T06b_vsrc_shorted_by_0V.cir`):

```spice
T06b: a voltage source shorted by a 0 V source
V1 n1 0 5
Vshort n1 0 0
R1 n1 0 1k
.op
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T06b_vsrc_shorted_by_0V.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t06b: a voltage source shorted by a 0 v source

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

DC solution failed -

Last Node Voltages
------------------

Node                                   Last Voltage        Previous Iter
----                                   ------------        -------------
n1                                                0                    0
vshort#branch                                     0                    0
v1#branch                                         0                    5 *
--- stderr ---
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
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T06b_vsrc_shorted_by_0V.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t06b: a voltage source shorted by a 0 v source

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

DC solution failed -

Last Node Voltages
------------------

Node                                   Last Voltage        Previous Iter
----                                   ------------        -------------
n1                                                0                    0
vshort#branch                                     0                    0
v1#branch                                         0                    5 *
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
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
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T06b_vsrc_shorted_by_0V.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = complex or empty (length 0), vshort#branch = complex or empty (length 0), n1 = complex or empty (length 0); stderr: Warning: singular matrix:  check node v1#branch / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Error: Transient op failed, timestep too small / Error: The operating point could not be simulated successfully. / Any of the following steps may fail.! / doAnalyses: OP:  Timestep too small; cause unrecorded. / run simulation(s) aborted

### T06c_vsrc_parallel_equal: two equal V sources in parallel

Netlist (`traps/cases/T06c_vsrc_parallel_equal.cir`):

```spice
T06c: two equal voltage sources in parallel
V1 n1 0 5
V2 n1 0 5
R1 n1 0 1k
.op
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T06c_vsrc_parallel_equal.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t06c: two equal voltage sources in parallel

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

DC solution failed -

Last Node Voltages
------------------

Node                                   Last Voltage        Previous Iter
----                                   ------------        -------------
n1                                                0                    0
v2#branch                                         0                    5 *
v1#branch                                         0                    5 *
--- stderr ---
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
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T06c_vsrc_parallel_equal.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t06c: two equal voltage sources in parallel

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

DC solution failed -

Last Node Voltages
------------------

Node                                   Last Voltage        Previous Iter
----                                   ------------        -------------
n1                                                0                    0
v2#branch                                         0                    5 *
v1#branch                                         0                    5 *
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
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
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T06c_vsrc_parallel_equal.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = complex or empty (length 0), v2#branch = complex or empty (length 0), n1 = complex or empty (length 0); stderr: Warning: singular matrix:  check node v1#branch / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Error: Transient op failed, timestep too small / Error: The operating point could not be simulated successfully. / Any of the following steps may fail.! / doAnalyses: OP:  Timestep too small; cause unrecorded. / run simulation(s) aborted

### T07a_duplicate_R1: two R1

Netlist (`traps/cases/T07a_duplicate_R1.cir`):

```spice
T07a: two resistors both named R1
V1 n1 0 6
R1 n1 0 2
R1 n1 0 4
.op
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T07a_duplicate_R1.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t07a: two resistors both named r1
--- stderr ---
Error on line 4 or its substitute:
  r1 n1 0 4
device already exists, bail out
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T07a_duplicate_R1.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t07a: two resistors both named r1
--- stderr ---
Error on line 4 or its substitute:
  r1 n1 0 4
device already exists, bail out
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T07a_duplicate_R1.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: const
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: const
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot const: no results (current plot is 'const'); stderr: Error on line 4 or its substitute: / r1 n1 0 4 / device already exists, bail out / Error: circuit not parsed.

### T07b_R1_and_r1: R1 and r1

Netlist (`traps/cases/T07b_R1_and_r1.cir`):

```spice
T07b: R1 and r1
V1 n1 0 6
R1 n1 0 2
r1 n1 0 4
.op
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T07b_R1_and_r1.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t07b: r1 and r1
--- stderr ---
Error on line 4 or its substitute:
  r1 n1 0 4
device already exists, bail out
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T07b_R1_and_r1.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t07b: r1 and r1
--- stderr ---
Error on line 4 or its substitute:
  r1 n1 0 4
device already exists, bail out
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T07b_R1_and_r1.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: const
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: const
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot const: no results (current plot is 'const'); stderr: Error on line 4 or its substitute: / r1 n1 0 4 / device already exists, bail out / Error: circuit not parsed.

### T07c_duplicate_V1: two V1

Netlist (`traps/cases/T07c_duplicate_V1.cir`):

```spice
T07c: two voltage sources both named V1
V1 n1 0 6
V1 n2 0 3
R1 n1 0 2
R2 n2 0 3
.op
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T07c_duplicate_V1.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t07c: two voltage sources both named v1
--- stderr ---
Error on line 3 or its substitute:
  v1 n2 0 3
device already exists, bail out
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T07c_duplicate_V1.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t07c: two voltage sources both named v1
--- stderr ---
Error on line 3 or its substitute:
  v1 n2 0 3
device already exists, bail out
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T07c_duplicate_V1.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: const
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: const
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot const: no results (current plot is 'const'); stderr: Error on line 3 or its substitute: / v1 n2 0 3 / device already exists, bail out / Error: circuit not parsed.

### T07d_duplicate_R1_different_nodes: two R1 on different nodes

Netlist (`traps/cases/T07d_duplicate_R1_different_nodes.cir`):

```spice
T07d: two resistors named R1 on different nodes
V1 n1 0 6
R1 n1 n2 2
R1 n2 0 4
.op
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T07d_duplicate_R1_different_nodes.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t07d: two resistors named r1 on different nodes
--- stderr ---
Error on line 4 or its substitute:
  r1 n2 0 4
device already exists, bail out
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T07d_duplicate_R1_different_nodes.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t07d: two resistors named r1 on different nodes
--- stderr ---
Error on line 4 or its substitute:
  r1 n2 0 4
device already exists, bail out
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T07d_duplicate_R1_different_nodes.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: const
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: const
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot const: no results (current plot is 'const'); stderr: Error on line 4 or its substitute: / r1 n2 0 4 / device already exists, bail out / Error: circuit not parsed.

### T09a_missing_value_R: R1 a 0

Netlist (`traps/cases/T09a_missing_value_R.cir`):

```spice
T09a: a resistor with no value
V1 a 0 6
R1 a 0
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T09a_missing_value_R.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t09a: a resistor with no value

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	a                                6.000000e+00

	Source	Current
	------	-------

	v1#branch                        0.000000e+00

No matching models
[... 21 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Warning: 'r1 a 0' is not a valid resistor instance line, ignored!
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 6.0, i(v1) = 0.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T09a_missing_value_R.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t09a: a resistor with no value

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	a                                6.000000e+00

	Source	Current
	------	-------

	v1#branch                        0.000000e+00

No matching models
[... 21 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Warning: 'r1 a 0' is not a valid resistor instance line, ignored!

Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 6.0, i(v1) = 0.0

Non-batch modes (evidence `traps/modes_out/T09a_missing_value_R.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = 0.0, a = 6.0; stderr: Warning: 'r1 a 0' is not a valid resistor instance line, ignored!

### T09b_missing_value_V: V1 a 0

Netlist (`traps/cases/T09b_missing_value_V.cir`):

```spice
T09b: a voltage source with no value
V1 a 0
R1 a 0 2
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T09b_missing_value_V.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t09b: a voltage source with no value

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	a                                0.000000e+00

	Source	Current
	------	-------

	v1#branch                        0.000000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Note: v1: has no value, DC 0 assumed
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 0.0, i(v1) = 0.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T09b_missing_value_V.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t09b: a voltage source with no value

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	a                                0.000000e+00

	Source	Current
	------	-------

	v1#branch                        0.000000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
Note: v1: has no value, DC 0 assumed
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 0.0, i(v1) = 0.0

Non-batch modes (evidence `traps/modes_out/T09b_missing_value_V.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = 0.0, a = 0.0; stderr: Note: v1: has no value, DC 0 assumed

### T09c_missing_value_I: I1 0 a

Netlist (`traps/cases/T09c_missing_value_I.cir`):

```spice
T09c: a current source with no value
I1 0 a
R1 a 0 2
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T09c_missing_value_I.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t09c: a current source with no value

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	a                                0.000000e+00

	Source	Current
	------	-------

[... 48 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Note: i1: has no value, DC 0 assumed
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 0.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T09c_missing_value_I.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t09c: a current source with no value

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	a                                0.000000e+00

	Source	Current
	------	-------

[... 48 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
Note: i1: has no value, DC 0 assumed
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 0.0

Non-batch modes (evidence `traps/modes_out/T09c_missing_value_I.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: a = 0.0; stderr: Note: i1: has no value, DC 0 assumed

### T09d_missing_value_C: C1 b 0

Netlist (`traps/cases/T09d_missing_value_C.cir`):

```spice
T09d: a capacitor with no value
V1 a 0 6
R1 a b 2
C1 b 0
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T09d_missing_value_C.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t09d: a capacitor with no value

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	b                                6.000000e+00
	a                                6.000000e+00

	Source	Current
	------	-------

	v1#branch                        0.000000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Warning: 'c1 b 0' is not a valid capacitor instance line, ignored!
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 6.0, v(b) = 6.0, i(v1) = 0.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T09d_missing_value_C.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t09d: a capacitor with no value

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	b                                6.000000e+00
	a                                6.000000e+00

	Source	Current
	------	-------

	v1#branch                        0.000000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Warning: 'c1 b 0' is not a valid capacitor instance line, ignored!

Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 6.0, v(b) = 6.0, i(v1) = 0.0

Non-batch modes (evidence `traps/modes_out/T09d_missing_value_C.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = 0.0, b = 6.0, a = 6.0; stderr: Warning: 'c1 b 0' is not a valid capacitor instance line, ignored!

### T10a_decimal_comma_R: R1 a 0 1,5k

Netlist (`traps/cases/T10a_decimal_comma_R.cir`):

```spice
T10a: a decimal comma in a resistor value (1,5k)
V1 a 0 6
R1 a 0 1,5k
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T10a_decimal_comma_R.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t10a: a decimal comma in a resistor value (1,5k)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	a                                6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -1.20000e-03

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 6.0, i(v1) = -0.0012000000000000001

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T10a_decimal_comma_R.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t10a: a decimal comma in a resistor value (1,5k)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	a                                6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -1.20000e-03

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 6.0, i(v1) = -0.0012000000000000001

Non-batch modes (evidence `traps/modes_out/T10a_decimal_comma_R.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -0.0012000000000000001, a = 6.0

### T10b_decimal_comma_V: V1 a 0 1,5

Netlist (`traps/cases/T10b_decimal_comma_V.cir`):

```spice
T10b: a decimal comma in a source value (1,5)
V1 a 0 1,5
R1 a 0 1
.op
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T10b_decimal_comma_V.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t10b: a decimal comma in a source value (1,5)
--- stderr ---
Error on line 2 or its substitute:
  v1 a 0 1,5
  unknown parameter (5) 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T10b_decimal_comma_V.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t10b: a decimal comma in a source value (1,5)
--- stderr ---
Error on line 2 or its substitute:
  v1 a 0 1,5
  unknown parameter (5) 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T10b_decimal_comma_V.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: const
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: const
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot const: no results (current plot is 'const'); stderr: Error on line 2 or its substitute: / v1 a 0 1,5 / unknown parameter (5) / Error: circuit not parsed.

### T10c_decimal_comma_I: I1 0 a 2,5

Netlist (`traps/cases/T10c_decimal_comma_I.cir`):

```spice
T10c: a decimal comma in a current source value (2,5)
I1 0 a 2,5
R1 a 0 1
.op
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T10c_decimal_comma_I.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t10c: a decimal comma in a current source value (2,5)
--- stderr ---
Error on line 2 or its substitute:
  i1 0 a 2,5
  unknown parameter (5) 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T10c_decimal_comma_I.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t10c: a decimal comma in a current source value (2,5)
--- stderr ---
Error on line 2 or its substitute:
  i1 0 a 2,5
  unknown parameter (5) 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T10c_decimal_comma_I.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: const
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: const
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot const: no results (current plot is 'const'); stderr: Error on line 2 or its substitute: / i1 0 a 2,5 / unknown parameter (5) / Error: circuit not parsed.

### T11a_missing_end: no .end

Netlist (`traps/cases/T11a_missing_end.cir`):

```spice
T11a: no .end line
V1 n1 0 6
R1 n1 0 2
.op
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T11a_missing_end.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t11a: no .end line

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, i(v1) = -3.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T11a_missing_end.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t11a: no .end line

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, i(v1) = -3.0

Non-batch modes (evidence `traps/modes_out/T11a_missing_end.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot const: no results (current plot is 'const'); stderr: Error: .end statement is missing in netlist! / Error: there aren't any circuits loaded.

### T11b_missing_title: no title: V1 line first

Netlist (`traps/cases/T11b_missing_title.cir`):

```spice
V1 n1 0 6
R1 n1 0 2
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T11b_missing_title.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: v1 n1 0 6

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               0.000000e+00

	Source	Current
	------	-------

[... 31 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 0.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T11b_missing_title.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: v1 n1 0 6

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               0.000000e+00

	Source	Current
	------	-------

[... 31 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 0.0

Non-batch modes (evidence `traps/modes_out/T11b_missing_title.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: n1 = 0.0

### T11c_missing_title_resistor_first: no title: R1 line first

Netlist (`traps/cases/T11c_missing_title_resistor_first.cir`):

```spice
R1 n1 0 2
V1 n1 0 6
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T11c_missing_title_resistor_first.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: r1 n1 0 2

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        0.000000e+00

No matching models
[... 21 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, i(v1) = 0.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T11c_missing_title_resistor_first.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: r1 n1 0 2

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        0.000000e+00

No matching models
[... 21 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, i(v1) = 0.0

Non-batch modes (evidence `traps/modes_out/T11c_missing_title_resistor_first.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = 0.0, n1 = 6.0

### T11d_blank_first_line: blank first line

Netlist (`traps/cases/T11d_blank_first_line.cir`):

```spice

V1 n1 0 6
R1 n1 0 2
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T11d_blank_first_line.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: 

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, i(v1) = -3.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T11d_blank_first_line.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: 

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, i(v1) = -3.0

Non-batch modes (evidence `traps/modes_out/T11d_blank_first_line.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: n1 = 0.0

### T11e_lines_after_end: element after .end

Netlist (`traps/cases/T11e_lines_after_end.cir`):

```spice
T11e: are lines after .end read? (R1 comes after .end)
V1 n1 0 6
R2 n1 0 3
.op
.end
R1 n1 0 2
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T11e_lines_after_end.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t11e: are lines after .end read? (r1 comes after .end)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -5.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, i(v1) = -5.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T11e_lines_after_end.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t11e: are lines after .end read? (r1 comes after .end)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -5.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, i(v1) = -5.0

Non-batch modes (evidence `traps/modes_out/T11e_lines_after_end.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -2.0, n1 = 6.0

### T12a_tf_missing_source: .tf v(n1) V9

Netlist (`traps/cases/T12a_tf_missing_source.cir`):

```spice
T12a: .tf naming a source that does not exist
V1 s 0 24
R1 s n1 6
R2 n1 0 3
.tf v(n1) V9
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T12a_tf_missing_source.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t12a: .tf naming a source that does not exist

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver
--- stderr ---
Warning: Transfer function source v9 not in circuit
doAnalyses: not found

run simulation(s) aborted
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T12a_tf_missing_source.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t12a: .tf naming a source that does not exist

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
Warning: Transfer function source v9 not in circuit
doAnalyses: not found

run simulation(s) aborted
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T12a_tf_missing_source.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: const
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: const
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot const: no results (current plot is 'const'); stderr: Warning: Transfer function source v9 not in circuit / doAnalyses: not found / run simulation(s) aborted

### T12b_tf_missing_node: .tf v(n9) V1

Netlist (`traps/cases/T12b_tf_missing_node.cir`):

```spice
T12b: .tf naming an output node that does not exist
V1 s 0 24
R1 s n1 6
R2 n1 0 3
.tf v(n9) V1
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T12b_tf_missing_node.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t12b: .tf naming an output node that does not exist

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
Transfer function information:
transfer_function = 0.000000e+00
output_impedance_at_v(n9) = 1.000000e+00
v1#input_impedance = 9.000000e+00
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Transfer Function': v(Transfer_function) = 0.0, v(v1#Input_impedance) = 9.0, v(output_impedance_at_V(n9)) = 1.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T12b_tf_missing_node.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t12b: .tf naming an output node that does not exist

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
Transfer function information:
transfer_function = 0.000000e+00
output_impedance_at_v(n9) = 1.000000e+00
v1#input_impedance = 9.000000e+00
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Transfer Function': v(Transfer_function) = 0.0, v(v1#Input_impedance) = 9.0, v(output_impedance_at_V(n9)) = 1.0

Non-batch modes (evidence `traps/modes_out/T12b_tf_missing_node.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: tf1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: tf1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot tf1: output_impedance_at_V(n9) = 1.0, v1#Input_impedance = 9.0, Transfer_function = 0.0

### T12c_tf_resistor_as_input: .tf v(n1) R1

Netlist (`traps/cases/T12c_tf_resistor_as_input.cir`):

```spice
T12c: .tf naming a resistor as the input source
V1 s 0 24
R1 s n1 6
R2 n1 0 3
.tf v(n1) R1
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T12c_tf_resistor_as_input.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t12c: .tf naming a resistor as the input source

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver
--- stderr ---
Warning: Transfer function source r1 not of proper type
doAnalyses: not found

run simulation(s) aborted
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T12c_tf_resistor_as_input.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t12c: .tf naming a resistor as the input source

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
Warning: Transfer function source r1 not of proper type
doAnalyses: not found

run simulation(s) aborted
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T12c_tf_resistor_as_input.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: const
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: const
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot const: no results (current plot is 'const'); stderr: Warning: Transfer function source r1 not of proper type / doAnalyses: not found / run simulation(s) aborted

### T13_node_case: N1 vs n1

Netlist (`traps/cases/T13_node_case.cir`):

```spice
T13: node names N1 and n1
V1 N1 0 6
R1 n1 0 2
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T13_node_case.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t13: node names n1 and n1

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
(empty)
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, i(v1) = -3.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T13_node_case.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t13: node names n1 and n1

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	n1                               6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(n1) = 6.0, i(v1) = -3.0

Non-batch modes (evidence `traps/modes_out/T13_node_case.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -3.0, n1 = 6.0

### T14a_zero_ohm: 0 ohm resistor

Netlist (`traps/cases/T14a_zero_ohm.cir`):

```spice
T14a: a 0 ohm resistor
V1 a 0 6
R1 a b 0
R2 b 0 2
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T14a_zero_ohm.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t14a: a 0 ohm resistor

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	b                                6.000000e+00
	a                                6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -3.00000e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Warning: Value of resistor r1 is too small, set to 1.000000e-12
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 6.0, v(b) = 5.999999999997, i(v1) = -3.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T14a_zero_ohm.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t14a: a 0 ohm resistor

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	b                                5.997001e+00
	a                                6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -2.99850e+00

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 6.0, v(b) = 5.997001499250375, i(v1) = -2.998500749624327

Non-batch modes (evidence `traps/modes_out/T14a_zero_ohm.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -3.0, b = 5.999999999997, a = 6.0; stderr: Warning: Value of resistor r1 is too small, set to 1.000000e-12

### T14b_zero_ohm_alone: 0 ohm across a V source

Netlist (`traps/cases/T14b_zero_ohm_alone.cir`):

```spice
T14b: a 0 ohm resistor straight across a voltage source
V1 a 0 6
R1 a 0 0
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T14b_zero_ohm_alone.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t14b: a 0 ohm resistor straight across a voltage source

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	a                                6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -6.00000e+12

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Warning: Value of resistor r1 is too small, set to 1.000000e-12
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 6.0, i(v1) = -6000000000000.0

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T14b_zero_ohm_alone.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t14b: a 0 ohm resistor straight across a voltage source

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	a                                6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -6.00000e+03

[... 51 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 6.0, i(v1) = -6000.0

Non-batch modes (evidence `traps/modes_out/T14b_zero_ohm_alone.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -6000000000000.0, a = 6.0; stderr: Warning: Value of resistor r1 is too small, set to 1.000000e-12

### T15a_cap_only_node: node connected only to capacitors

Netlist (`traps/cases/T15a_cap_only_node.cir`):

```spice
T15a: a node connected only to capacitors in .op
V1 a 0 6
C1 a b 1u
C2 b 0 1u
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T15a_cap_only_node.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t15a: a node connected only to capacitors in .op

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	b                                3.000000e+00
	a                                6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -2.44427e-12

[... 47 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
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
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 5.9999999999939995, v(b) = 2.9999999999819513, i(v1) = -2.4442670110147446e-12

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T15a_cap_only_node.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t15a: a node connected only to capacitors in .op

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	b                                3.000000e+00
	a                                6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -2.44427e-12

[... 47 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
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
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 5.9999999999939995, v(b) = 2.9999999999819513, i(v1) = -2.4442670110147446e-12

Non-batch modes (evidence `traps/modes_out/T15a_cap_only_node.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -2.4442670110147446e-12, b = 2.9999999999819513, a = 5.9999999999939995; stderr: Warning: singular matrix:  check node b / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Note: Transient op finished successfully

### T15b_cap_only_node_with_r: capacitor-only node next to a divider

Netlist (`traps/cases/T15b_cap_only_node_with_r.cir`):

```spice
T15b: a node connected only to capacitors, with a resistor elsewhere
V1 a 0 6
R1 a c 1k
C1 c b 1u
C2 b 0 2u
R2 c 0 1k
.op
.end
```

ngspice 47, `ngspice -b` (exit code 0; evidence `traps/out/T15b_cap_only_node_with_r.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t15b: a node connected only to capacitors, with a resistor elsewhere

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	b                                2.955447e-02
	c                                8.866340e-02
	a                                6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -5.91134e-03

[... 77 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
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
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 5.9999999999939995, v(c) = 0.08866339997380636, v(b) = 0.029554466657885997, i(v1) = -0.005911336600014282

ngspice 42, `ngspice -b` (exit code 0; evidence `traps/out/T15b_cap_only_node_with_r.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t15b: a node connected only to capacitors, with a resistor elsewhere

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
	Node                                  Voltage
	----                                  -------
	----	-------
	b                                2.955447e-02
	c                                8.866340e-02
	a                                6.000000e+00

	Source	Current
	------	-------

	v1#branch                        -5.91134e-03

[... 77 lines of device/model parameter listing omitted; see evidence file ...]
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
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
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Operating Point': v(a) = 5.9999999999939995, v(c) = 0.08866339997380636, v(b) = 0.029554466657885997, i(v1) = -0.005911336600014282

Non-batch modes (evidence `traps/modes_out/T15b_cap_only_node_with_r.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: op1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: op1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot op1: v1#branch = -0.005911336600014282, b = 0.029554466657885997, c = 0.08866339997380636, a = 5.9999999999939995; stderr: Warning: singular matrix:  check node b / Note: Starting dynamic gmin stepping / Warning: Dynamic gmin stepping failed / Note: Starting true gmin stepping / Warning: True gmin stepping failed / Note: Starting source stepping / Warning: source stepping failed / Note: Transient op started / Note: Transient op finished successfully

### T16_unknown_node_in_print: .print dc v(b), no node b

Netlist (`traps/cases/T16_unknown_node_in_print.cir`):

```spice
T16: .print of a node that does not exist (with .dc)
V1 a 0 0
R1 a 0 1k
.dc V1 0 1 1
.print dc v(b)
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T16_unknown_node_in_print.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t16: .print of a node that does not exist (with .dc)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

Using SPARSE 1.3 as Direct Linear Solver
--- stderr ---
Warning: can't parse 'b': ignored
Error: no data saved for D.C. Transfer curve analysis; analysis not run
doAnalyses: not found

run simulation(s) aborted
Error: .print: no dc analysis found.
```

With `-r` (binary rawfile): exit 0; rawfile plot 'DC transfer characteristic': v(v-sweep) = 2 points, v(a) = 2 points, i(v1) = 2 points

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T16_unknown_node_in_print.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t16: .print of a node that does not exist (with .dc)

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000
--- stderr ---
Using SPARSE 1.3 as Direct Linear Solver
Warning: can't parse 'b': ignored
Error: no data saved for D.C. Transfer curve analysis; analysis not run
doAnalyses: not found

run simulation(s) aborted
Error: .print: no dc analysis found.
```

With `-r` (binary rawfile): exit 0; rawfile plot 'DC transfer characteristic': v(v-sweep) = 2 points, v(a) = 2 points, i(v1) = 2 points

Non-batch modes (evidence `traps/modes_out/T16_unknown_node_in_print.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: dc1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: dc1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot dc1: v1#branch = 2 points, a = 2 points, v-sweep = 2 points

### T19_at_sign_line: a line starting with @

Netlist (`traps/cases/T19_at_sign_line.cir`):

```spice
T19: a line starting with @ ends the netlist
V1 n1 0 6
R2 n1 0 3
@ note: R1 below
R1 n1 0 2
.op
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T19_at_sign_line.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t19: a line starting with @ ends the netlist
--- stderr ---
Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 0; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T19_at_sign_line.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t19: a line starting with @ ends the netlist
--- stderr ---
Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit 0; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T19_at_sign_line.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: const
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: const
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot const: no results (current plot is 'const'); stderr: Warning: No job (tran, ac, op etc.) defined: / run simulation not started

### T20a_dc_step_zero: .dc V1 0 12 0

Netlist (`traps/cases/T20a_dc_step_zero.cir`):

```spice
T20a: .dc with a zero step
V1 in 0 0
R1 in out 1k
R2 out 0 2k
C1 out 0 1u
.dc V1 0 12 0
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T20a_dc_step_zero.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t20a: .dc with a zero step
--- stderr ---
Error on line 6 or its substitute:
  .dc v1 0 12 0
Bad syntax! 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T20a_dc_step_zero.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t20a: .dc with a zero step
--- stderr ---
Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit None (timed out after 60 s and was killed); no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T20a_dc_step_zero.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit TIMEOUT after 30 s (killed), current plot after run: (none: killed after the timeout)
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: const
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot const: no results (current plot is 'const'); stderr: Error on line 6 or its substitute: / .dc v1 0 12 0 / Bad syntax! / Error: circuit not parsed.

### T20b_dc_step_negative: .dc V1 0 12 -1

Netlist (`traps/cases/T20b_dc_step_negative.cir`):

```spice
T20b: .dc with a negative step and an increasing range
V1 in 0 0
R1 in out 1k
R2 out 0 2k
C1 out 0 1u
.dc V1 0 12 -1
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T20b_dc_step_negative.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t20b: .dc with a negative step and an increasing range
--- stderr ---
Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 0; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T20b_dc_step_negative.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t20b: .dc with a negative step and an increasing range
--- stderr ---
Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit 0; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T20b_dc_step_negative.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: dc1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: dc1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot dc1: v1#branch = complex or empty (length 0), out = complex or empty (length 0), in = complex or empty (length 0), v-sweep = complex or empty (length 0)

### T20c_dc_start_gt_stop: .dc V1 12 0 1

Netlist (`traps/cases/T20c_dc_start_gt_stop.cir`):

```spice
T20c: .dc from 12 down to 0 with a positive step
V1 in 0 0
R1 in out 1k
R2 out 0 2k
C1 out 0 1u
.dc V1 12 0 1
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T20c_dc_start_gt_stop.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t20c: .dc from 12 down to 0 with a positive step
--- stderr ---
Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 0; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T20c_dc_start_gt_stop.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t20c: .dc from 12 down to 0 with a positive step
--- stderr ---
Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit 0; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T20c_dc_start_gt_stop.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: dc1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: dc1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot dc1: v1#branch = complex or empty (length 0), out = complex or empty (length 0), in = complex or empty (length 0), v-sweep = complex or empty (length 0)

### T20d_dc_missing_step: .dc V1 0 12

Netlist (`traps/cases/T20d_dc_missing_step.cir`):

```spice
T20d: .dc without a step
V1 in 0 0
R1 in out 1k
R2 out 0 2k
C1 out 0 1u
.dc V1 0 12
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T20d_dc_missing_step.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t20d: .dc without a step
--- stderr ---
Error on line 6 or its substitute:
  .dc v1 0 12
Bad syntax! 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T20d_dc_missing_step.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t20d: .dc without a step
--- stderr ---
Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit None (timed out after 60 s and was killed); no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T20d_dc_missing_step.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit TIMEOUT after 30 s (killed), current plot after run: (none: killed after the timeout)
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: const
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot const: no results (current plot is 'const'); stderr: Error on line 6 or its substitute: / .dc v1 0 12 / Bad syntax! / Error: circuit not parsed.

### T20e_dc_unknown_source: .dc V9 0 12 1

Netlist (`traps/cases/T20e_dc_unknown_source.cir`):

```spice
T20e: .dc sweeping a source that does not exist
V1 in 0 0
R1 in out 1k
R2 out 0 2k
C1 out 0 1u
.dc V9 0 12 1
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T20e_dc_unknown_source.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t20e: .dc sweeping a source that does not exist
--- stderr ---
Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T20e_dc_unknown_source.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t20e: .dc sweeping a source that does not exist
--- stderr ---
Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T20e_dc_unknown_source.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: const
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: const
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot const: no results (current plot is 'const'); stderr: Fatal error: DC Transfer Function: Voltage source, current source, or resistor named "v9" is not in the circuit / doAnalyses: no such device / run simulation(s) aborted

### T20f_dc_step_too_big: .dc V1 0 12 20

Netlist (`traps/cases/T20f_dc_step_too_big.cir`):

```spice
T20f: .dc step larger than the range
V1 in 0 0
R1 in out 1k
R2 out 0 2k
C1 out 0 1u
.dc V1 0 12 20
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T20f_dc_step_too_big.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t20f: .dc step larger than the range
--- stderr ---
Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 0; rawfile plot 'DC transfer characteristic': v(v-sweep) = 0.0, v(in) = 0.0, v(out) = 0.0, i(v1) = 0.0

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T20f_dc_step_too_big.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t20f: .dc step larger than the range
--- stderr ---
Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit 0; rawfile plot 'DC transfer characteristic': v(v-sweep) = 0.0, v(in) = 0.0, v(out) = 0.0, i(v1) = 0.0

Non-batch modes (evidence `traps/modes_out/T20f_dc_step_too_big.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: dc1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: dc1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot dc1: v1#branch = 0.0, out = 0.0, in = 0.0, v-sweep = 0.0

### T21a_tran_one_arg: .tran 5m

Netlist (`traps/cases/T21a_tran_one_arg.cir`):

```spice
T21a: .tran with one argument
V1 in 0 0
R1 in out 1k
R2 out 0 2k
C1 out 0 1u
.tran 5m
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T21a_tran_one_arg.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t21a: .tran with one argument
--- stderr ---
Error on line 6 or its substitute:
  .tran 5m
TSTOP is invalid, must be greater than zero.
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T21a_tran_one_arg.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t21a: .tran with one argument
--- stderr ---
Error on line 6 or its substitute:
  .tran 5m
TSTOP is invalid, must be greater than zero.
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T21a_tran_one_arg.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: const
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: const
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot const: no results (current plot is 'const'); stderr: Error on line 6 or its substitute: / .tran 5m / TSTOP is invalid, must be greater than zero. / Error: circuit not parsed.

### T21b_tran_zero_step: .tran 0 5m

Netlist (`traps/cases/T21b_tran_zero_step.cir`):

```spice
T21b: .tran with a zero step
V1 in 0 0
R1 in out 1k
R2 out 0 2k
C1 out 0 1u
.tran 0 5m
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T21b_tran_zero_step.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t21b: .tran with a zero step
--- stderr ---
Error on line 6 or its substitute:
  .tran 0 5m
TSTEP is invalid, must be greater than zero.
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T21b_tran_zero_step.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t21b: .tran with a zero step
--- stderr ---
Error on line 6 or its substitute:
  .tran 0 5m
TSTEP is invalid, must be greater than zero.
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T21b_tran_zero_step.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: const
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: const
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot const: no results (current plot is 'const'); stderr: Error on line 6 or its substitute: / .tran 0 5m / TSTEP is invalid, must be greater than zero. / Error: circuit not parsed.

### T21c_tran_step_gt_stop: .tran 1 5m

Netlist (`traps/cases/T21c_tran_step_gt_stop.cir`):

```spice
T21c: .tran with step larger than stop
V1 in 0 0
R1 in out 1k
R2 out 0 2k
C1 out 0 1u
.tran 1 5m
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T21c_tran_step_gt_stop.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t21c: .tran with step larger than stop
--- stderr ---
Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Transient Analysis': time = 59 points, v(in) = 59 points, v(out) = 59 points, i(v1) = 59 points

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T21c_tran_step_gt_stop.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t21c: .tran with step larger than stop
--- stderr ---
Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit 0; rawfile plot 'Transient Analysis': time = 59 points, v(in) = 59 points, v(out) = 59 points, i(v1) = 59 points

Non-batch modes (evidence `traps/modes_out/T21c_tran_step_gt_stop.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: tran1
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: tran1
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot tran1: v1#branch = 59 points, out = 59 points, in = 59 points, time = 59 points

### T21d_tran_tstart_gt_tstop: .tran 10u 5m 6m

Netlist (`traps/cases/T21d_tran_tstart_gt_tstop.cir`):

```spice
T21d: .tran with tstart after tstop
V1 in 0 0
R1 in out 1k
R2 out 0 2k
C1 out 0 1u
.tran 10u 5m 6m
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T21d_tran_tstart_gt_tstop.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t21d: .tran with tstart after tstop
--- stderr ---
Error on line 6 or its substitute:
  .tran 10u 5m 6m
TSTART is invalid, must be less than TSTOP.
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T21d_tran_tstart_gt_tstop.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t21d: .tran with tstart after tstop
--- stderr ---
Error on line 6 or its substitute:
  .tran 10u 5m 6m
TSTART is invalid, must be less than TSTOP.
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit 1; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T21d_tran_tstart_gt_tstop.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: const
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: const
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot const: no results (current plot is 'const'); stderr: Error on line 6 or its substitute: / .tran 10u 5m 6m / TSTART is invalid, must be less than TSTOP. / Error: circuit not parsed.

### T21e_no_analysis: no analysis line

Netlist (`traps/cases/T21e_no_analysis.cir`):

```spice
T21e: no analysis line at all
V1 in 0 0
R1 in out 1k
R2 out 0 2k
C1 out 0 1u
* (no analysis)
.end
```

ngspice 47, `ngspice -b` (exit code 1; evidence `traps/out/T21e_no_analysis.47.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t21e: no analysis line at all
--- stderr ---
Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

With `-r` (binary rawfile): exit 0; no data in the rawfile

ngspice 42, `ngspice -b` (exit code 1; evidence `traps/out/T21e_no_analysis.42.txt`):

```text
--- stdout ---
Note: No compatibility mode selected!

Circuit: t21e: no analysis line at all
--- stderr ---
Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

With `-r` (binary rawfile): exit 0; no data in the rawfile

Non-batch modes (evidence `traps/modes_out/T21e_no_analysis.inter.42.txt`, `.inter.47.txt`, `.shared47.json`):

- interactive CLI 42 (`source`, `run`): exit 0, current plot after run: const
- interactive CLI 47 (`source`, `run`): exit 0, current plot after run: const
- libngspice 47 (`ngSpice_Circ` + `run`): ngSpice_Circ returned 0, run returned 0, plot const: no results (current plot is 'const'); stderr: Warning: No job (tran, ac, op etc.) defined: / run simulation not started

## First-letter cases, verbatim stderr

### L00 `A`

```spice
first-letter test [A]
Rref a 0 1
A1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L00.47.txt`):

```text
Error on line 3 or its substitute:
  a1 a 0 5
MIF-ERROR - unable to find definition of model 5
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L00.42.txt`):

```text
Error on line 3 or its substitute:
  a1 a 0 5
 MIF-ERROR - unable to find definition of model 5
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L01 `B`

```spice
first-letter test [B]
Rref a 0 1
B1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L01.47.txt`):

```text
ERROR: mal formed B source instance: b1 a 0 5
    in line no. 3 of file <scratch>/research/native/traps/letters/L01.cir

ERROR: fatal error in ngspice, exit(1)
```

ngspice 42, exit 1, stderr (`traps/letters_out/L01.42.txt`):

```text
ERROR: mal formed B line: b1 a 0 5

ERROR: fatal error in ngspice, exit(1)
```

### L02 `C`

```spice
first-letter test [C]
Rref a 0 1
C1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L02.47.txt`):

```text
(empty)
```

ngspice 42, exit 0, stderr (`traps/letters_out/L02.42.txt`):

```text
Using SPARSE 1.3 as Direct Linear Solver
```

### L03 `D`

```spice
first-letter test [D]
Rref a 0 1
D1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L03.47.txt`):

```text
Error on line 3 or its substitute:
  d1 a 0 5
could not find a valid modelname
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L03.42.txt`):

```text
Error on line 3 or its substitute:
  d1 a 0 5
could not find a valid modelname
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L04 `E`

```spice
first-letter test [E]
Rref a 0 1
E1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L04.47.txt`):

```text
Error: not enough parameters in line
   e1 a 0 5
    line no 3, file <scratch>/research/native/traps/letters/L04.cir
No circuit loaded!
Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L04.42.txt`):

```text
Error: not enough parameters in line
   e1 a 0 5
No circuit loaded!
Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L05 `F`

```spice
first-letter test [F]
Rref a 0 1
F1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L05.47.txt`):

```text
Error: not enough parameters in line
   f1 a 0 5
    line no 3, file <scratch>/research/native/traps/letters/L05.cir
No circuit loaded!
Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L05.42.txt`):

```text
Error: not enough parameters in line
   f1 a 0 5
No circuit loaded!
Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L06 `G`

```spice
first-letter test [G]
Rref a 0 1
G1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L06.47.txt`):

```text
Error: not enough parameters in line
   g1 a 0 5
    line no 3, file <scratch>/research/native/traps/letters/L06.cir
No circuit loaded!
Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L06.42.txt`):

```text
Error: not enough parameters in line
   g1 a 0 5
No circuit loaded!
Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L07 `H`

```spice
first-letter test [H]
Rref a 0 1
H1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L07.47.txt`):

```text
Error: not enough parameters in line
   h1 a 0 5
    line no 3, file <scratch>/research/native/traps/letters/L07.cir
No circuit loaded!
Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L07.42.txt`):

```text
Error: not enough parameters in line
   h1 a 0 5
No circuit loaded!
Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L08 `I`

```spice
first-letter test [I]
Rref a 0 1
I1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L08.47.txt`):

```text
(empty)
```

ngspice 42, exit 0, stderr (`traps/letters_out/L08.42.txt`):

```text
Using SPARSE 1.3 as Direct Linear Solver
```

### L09 `J`

```spice
first-letter test [J]
Rref a 0 1
J1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L09.47.txt`):

```text
Error on line 3 or its substitute:
  j1 a 0 5
Unable to find definition of model 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L09.42.txt`):

```text
Error on line 3 or its substitute:
  j1 a 0 5
Unable to find definition of model 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L10 `K`

```spice
first-letter test [K]
Rref a 0 1
K1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L10.47.txt`):

```text
Fatal error: k1: coupling to non-existent inductor a.
doAnalyses: not found

run simulation(s) aborted
```

ngspice 42, exit 1, stderr (`traps/letters_out/L10.42.txt`):

```text
Fatal error: k1: coupling to non-existent inductor a.
doAnalyses: not found

run simulation(s) aborted
```

### L11 `L`

```spice
first-letter test [L]
Rref a 0 1
L1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L11.47.txt`):

```text
(empty)
```

ngspice 42, exit 0, stderr (`traps/letters_out/L11.42.txt`):

```text
Using SPARSE 1.3 as Direct Linear Solver
```

### L12 `M`

```spice
first-letter test [M]
Rref a 0 1
M1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L12.47.txt`):

```text
Error on line 3 or its substitute:
  m1 a 0 5
could not find a valid modelname
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L12.42.txt`):

```text
Error on line 3 or its substitute:
  m1 a 0 5
could not find a valid modelname
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L13 `N`

```spice
first-letter test [N]
Rref a 0 1
N1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L13.47.txt`):

```text
Error on line 3 or its substitute:
  n1 a 0 5
Unable to find definition of model 5
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L13.42.txt`):

```text
Error on line 3 or its substitute:
  n1 a 0 5
could not find a valid modelname
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L14 `O`

```spice
first-letter test [O]
Rref a 0 1
O1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L14.47.txt`):

```text
Error on line 3 or its substitute:
  o1 a 0 5
Unable to find definition of model 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L14.42.txt`):

```text
Error on line 3 or its substitute:
  o1 a 0 5
Unable to find definition of model 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L15 `P`

```spice
first-letter test [P]
Rref a 0 1
P1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L15.47.txt`):

```text
Error on line 3 or its substitute:
  p1 a 0 5
Unable to find definition of model 5
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L15.42.txt`):

```text
Error on line 3 or its substitute:
  p1 a 0 5
Unable to find definition of model 5
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L16 `Q`

```spice
first-letter test [Q]
Rref a 0 1
Q1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L16.47.txt`):

```text
Error on line 3 or its substitute:
  q1 a 0 5
could not find a valid modelname
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L16.42.txt`):

```text
Error on line 3 or its substitute:
  q1 a 0 5
could not find a valid modelname
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L17 `R`

```spice
first-letter test [R]
Rref a 0 1
R1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L17.47.txt`):

```text
(empty)
```

ngspice 42, exit 0, stderr (`traps/letters_out/L17.42.txt`):

```text
Using SPARSE 1.3 as Direct Linear Solver
```

### L18 `S`

```spice
first-letter test [S]
Rref a 0 1
S1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L18.47.txt`):

```text
Error on line 3 or its substitute:
  s1 a 0 5
Unable to find definition of model 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L18.42.txt`):

```text
Error on line 3 or its substitute:
  s1 a 0 5
Unable to find definition of model 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L19 `T`

```spice
first-letter test [T]
Rref a 0 1
T1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L19.47.txt`):

```text
Fatal error: t1: transmission line z0 must be given
doAnalyses: no such parameter on this device or parameter is missing

run simulation(s) aborted
```

ngspice 42, exit 1, stderr (`traps/letters_out/L19.42.txt`):

```text
Fatal error: t1: transmission line z0 must be given
doAnalyses: no such parameter on this device

run simulation(s) aborted
```

### L20 `U`

```spice
first-letter test [U]
Rref a 0 1
U1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L20.47.txt`):

```text
Error on line 3 or its substitute:
  u1 a 0 5
Unable to find definition of model 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L20.42.txt`):

```text
Error on line 3 or its substitute:
  u1 a 0 5
Unable to find definition of model 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L21 `V`

```spice
first-letter test [V]
Rref a 0 1
V1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L21.47.txt`):

```text
(empty)
```

ngspice 42, exit 0, stderr (`traps/letters_out/L21.42.txt`):

```text
Using SPARSE 1.3 as Direct Linear Solver
```

### L22 `W`

```spice
first-letter test [W]
Rref a 0 1
W1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L22.47.txt`):

```text
Error on line 3 or its substitute:
  w1 a 0 5
Unable to find definition of model 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L22.42.txt`):

```text
Error on line 3 or its substitute:
  w1 a 0 5
Unable to find definition of model 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L23 `X`

```spice
first-letter test [X]
Rref a 0 1
X1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L23.47.txt`):

```text
Error: unknown subckt: x1 a 0 5
    in line no. 3 from file <scratch>/research/native/traps/letters/L23.cir
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L23.42.txt`):

```text
Error: unknown subckt: x1 a 0 5
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L24 `Y`

```spice
first-letter test [Y]
Rref a 0 1
Y1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L24.47.txt`):

```text
Error on line 3 or its substitute:
  y1 a 0 5
model name is not found
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L24.42.txt`):

```text
Error on line 3 or its substitute:
  y1 a 0 5
model name is not found
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L25 `Z`

```spice
first-letter test [Z]
Rref a 0 1
Z1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L25.47.txt`):

```text
Error on line 3 or its substitute:
  z1 a 0 5
Unable to find definition of model 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L25.42.txt`):

```text
Error on line 3 or its substitute:
  z1 a 0 5
Unable to find definition of model 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L26 `0`

```spice
first-letter test [0]
Rref a 0 1
01 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L26.47.txt`):

```text
Error on line 3 or its substitute:
  01 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L26.42.txt`):

```text
Error on line 3 or its substitute:
  01 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L27 `1`

```spice
first-letter test [1]
Rref a 0 1
11 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L27.47.txt`):

```text
Error on line 3 or its substitute:
  11 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L27.42.txt`):

```text
Error on line 3 or its substitute:
  11 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L28 `9`

```spice
first-letter test [9]
Rref a 0 1
91 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L28.47.txt`):

```text
Error on line 3 or its substitute:
  91 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L28.42.txt`):

```text
Error on line 3 or its substitute:
  91 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L29 `*`

```spice
first-letter test [*]
Rref a 0 1
*1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L29.47.txt`):

```text
(empty)
```

ngspice 42, exit 0, stderr (`traps/letters_out/L29.42.txt`):

```text
Using SPARSE 1.3 as Direct Linear Solver
```

### L30 `+`

```spice
first-letter test [+]
Rref a 0 1
+1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L30.47.txt`):

```text
Error on line 2 or its substitute:
  rref a 0 1 1 a 0 5
  unknown parameter (a) 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L30.42.txt`):

```text
Error on line 2 or its substitute:
  rref a 0 1 1 a 0 5
  unknown parameter (a) 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L31 `.`

```spice
first-letter test [.]
Rref a 0 1
.1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L31.47.txt`):

```text
Error on line 3 or its substitute:
  .1 a 0 5
 unimplemented dot command '.1'
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L31.42.txt`):

```text
Error on line 3 or its substitute:
  .1 a 0 5
 unimplemented dot command '.1'
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L32 `#`

```spice
first-letter test [#]
Rref a 0 1
#1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L32.47.txt`):

```text
(empty)
```

ngspice 42, exit 1, stderr (`traps/letters_out/L32.42.txt`):

```text
Error on line 3 or its substitute:
  #1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L33 `$`

```spice
first-letter test [$]
Rref a 0 1
$1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L33.47.txt`):

```text
Warning: Unusual leading characters like '$' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    check line  $1 a 0 5
    line no. 3 from file <scratch>/research/native/traps/letters/L33.cir!
```

ngspice 42, exit 0, stderr (`traps/letters_out/L33.42.txt`):

```text
Warning: Unusual leading characters like '$' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    Check line no 3:  $1 a 0 5

Using SPARSE 1.3 as Direct Linear Solver
```

### L34 `;`

```spice
first-letter test [;]
Rref a 0 1
;1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L34.47.txt`):

```text
(empty)
```

ngspice 42, exit 0, stderr (`traps/letters_out/L34.42.txt`):

```text
Using SPARSE 1.3 as Direct Linear Solver
```

### L35 `/`

```spice
first-letter test [/]
Rref a 0 1
/1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L35.47.txt`):

```text
Error on line 3 or its substitute:
  /1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L35.42.txt`):

```text
Error on line 3 or its substitute:
  /1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L36 `-`

```spice
first-letter test [-]
Rref a 0 1
-1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L36.47.txt`):

```text
Error on line 3 or its substitute:
  -1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L36.42.txt`):

```text
Error on line 3 or its substitute:
  -1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L37 `&`

```spice
first-letter test [&]
Rref a 0 1
&1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L37.47.txt`):

```text
Warning: Unusual leading characters like '&' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    check line  &1 a 0 5
    line no. 3 from file <scratch>/research/native/traps/letters/L37.cir!
```

ngspice 42, exit 0, stderr (`traps/letters_out/L37.42.txt`):

```text
Warning: Unusual leading characters like '&' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    Check line no 3:  &1 a 0 5

Using SPARSE 1.3 as Direct Linear Solver
```

### L38 `!`

```spice
first-letter test [!]
Rref a 0 1
!1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L38.47.txt`):

```text
Warning: Unusual leading characters like '!' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    check line  !1 a 0 5
    line no. 3 from file <scratch>/research/native/traps/letters/L38.cir!
```

ngspice 42, exit 0, stderr (`traps/letters_out/L38.42.txt`):

```text
Warning: Unusual leading characters like '!' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    Check line no 3:  !1 a 0 5

Using SPARSE 1.3 as Direct Linear Solver
```

### L39 `@`

```spice
first-letter test [@]
Rref a 0 1
@1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L39.47.txt`):

```text
Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L39.42.txt`):

```text
Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L40 `%`

```spice
first-letter test [%]
Rref a 0 1
%1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L40.47.txt`):

```text
Warning: Unusual leading characters like '%' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    check line  %1 a 0 5
    line no. 3 from file <scratch>/research/native/traps/letters/L40.cir!
```

ngspice 42, exit 0, stderr (`traps/letters_out/L40.42.txt`):

```text
Warning: Unusual leading characters like '%' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    Check line no 3:  %1 a 0 5

Using SPARSE 1.3 as Direct Linear Solver
```

### L41 `(`

```spice
first-letter test [(]
Rref a 0 1
(1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L41.47.txt`):

```text
Warning: Unusual leading characters like '(' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    check line  (1 a 0 5
    line no. 3 from file <scratch>/research/native/traps/letters/L41.cir!
```

ngspice 42, exit 0, stderr (`traps/letters_out/L41.42.txt`):

```text
Warning: Unusual leading characters like '(' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    Check line no 3:  (1 a 0 5

Using SPARSE 1.3 as Direct Linear Solver
```

### L42 `=`

```spice
first-letter test [=]
Rref a 0 1
=1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L42.47.txt`):

```text
Warning: Unusual leading characters like '=' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    check line  =1 a 0 5
    line no. 3 from file <scratch>/research/native/traps/letters/L42.cir!
```

ngspice 42, exit 0, stderr (`traps/letters_out/L42.42.txt`):

```text
Warning: Unusual leading characters like '=' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    Check line no 3:  =1 a 0 5

Using SPARSE 1.3 as Direct Linear Solver
```

### L43 `~`

```spice
first-letter test [~]
Rref a 0 1
~1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L43.47.txt`):

```text
Error on line 3 or its substitute:
  ~1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L43.42.txt`):

```text
Error on line 3 or its substitute:
  ~1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L44 `_`

```spice
first-letter test [_]
Rref a 0 1
_1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L44.47.txt`):

```text
Error on line 3 or its substitute:
  _1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L44.42.txt`):

```text
Error on line 3 or its substitute:
  _1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L45 `'`

```spice
first-letter test [']
Rref a 0 1
'1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L45.47.txt`):

```text
Error in netlist line no. 4, new internal line no. 3:

Closing "}" not found in line fragment
    {1 a 0 5.

ERROR: fatal error in ngspice, exit(1)
```

ngspice 42, exit 1, stderr (`traps/letters_out/L45.42.txt`):

```text
Netlist line no. 3:
Closing "}" not found in line fragment
    {1 a 0 5.

ERROR: fatal error in ngspice, exit(1)
```

### L46 `"`

```spice
first-letter test ["]
Rref a 0 1
"1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L46.47.txt`):

```text
Warning: Unusual leading characters like '"' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    check line  "1 a 0 5
    line no. 3 from file <scratch>/research/native/traps/letters/L46.cir!
```

ngspice 42, exit 0, stderr (`traps/letters_out/L46.42.txt`):

```text
Warning: Unusual leading characters like '"' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    Check line no 3:  "1 a 0 5

Using SPARSE 1.3 as Direct Linear Solver
```

### L47 `{`

```spice
first-letter test [{]
Rref a 0 1
{1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L47.47.txt`):

```text
Error in netlist line no. 4, new internal line no. 3:

Closing "}" not found in line fragment
    {1 a 0 5.

ERROR: fatal error in ngspice, exit(1)
```

ngspice 42, exit 1, stderr (`traps/letters_out/L47.42.txt`):

```text
Netlist line no. 3:
Closing "}" not found in line fragment
    {1 a 0 5.

ERROR: fatal error in ngspice, exit(1)
```

### L48 `[`

```spice
first-letter test [[]
Rref a 0 1
[1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L48.47.txt`):

```text
Warning: Unusual leading characters like '[' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    check line  [1 a 0 5
    line no. 3 from file <scratch>/research/native/traps/letters/L48.cir!
```

ngspice 42, exit 0, stderr (`traps/letters_out/L48.42.txt`):

```text
Warning: Unusual leading characters like '[' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    Check line no 3:  [1 a 0 5

Using SPARSE 1.3 as Direct Linear Solver
```

### L49 `<`

```spice
first-letter test [<]
Rref a 0 1
<1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L49.47.txt`):

```text
Error on line 3 or its substitute:
  <1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L49.42.txt`):

```text
Error on line 3 or its substitute:
  <1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L50 `?`

```spice
first-letter test [?]
Rref a 0 1
?1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L50.47.txt`):

```text
Warning: Unusual leading characters like '?' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    check line  ?1 a 0 5
    line no. 3 from file <scratch>/research/native/traps/letters/L50.cir!
```

ngspice 42, exit 0, stderr (`traps/letters_out/L50.42.txt`):

```text
Warning: Unusual leading characters like '?' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    Check line no 3:  ?1 a 0 5

Using SPARSE 1.3 as Direct Linear Solver
```

### L51 `,`

```spice
first-letter test [,]
Rref a 0 1
,1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L51.47.txt`):

```text
Warning: Unusual leading characters like ',' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    check line  ,1 a 0 5
    line no. 3 from file <scratch>/research/native/traps/letters/L51.cir!
```

ngspice 42, exit 0, stderr (`traps/letters_out/L51.42.txt`):

```text
Warning: Unusual leading characters like ',' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    Check line no 3:  ,1 a 0 5

Using SPARSE 1.3 as Direct Linear Solver
```

### L52 `:`

```spice
first-letter test [:]
Rref a 0 1
:1 a 0 5
.op
.end
```

ngspice 47, exit 0, stderr (`traps/letters_out/L52.47.txt`):

```text
Warning: Unusual leading characters like ':' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    check line  :1 a 0 5
    line no. 3 from file <scratch>/research/native/traps/letters/L52.cir!
```

ngspice 42, exit 0, stderr (`traps/letters_out/L52.42.txt`):

```text
Warning: Unusual leading characters like ':' or others out of '= [] ? () & % $"!:,\f'
    in netlist or included files, will be replaced with '*'.
    Check line no 3:  :1 a 0 5

Using SPARSE 1.3 as Direct Linear Solver
```

### L53 `^`

```spice
first-letter test [^]
Rref a 0 1
^1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L53.47.txt`):

```text
Error on line 3 or its substitute:
  ^1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L53.42.txt`):

```text
Error on line 3 or its substitute:
  ^1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L54 `|`

```spice
first-letter test [|]
Rref a 0 1
|1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L54.47.txt`):

```text
Error on line 3 or its substitute:
  |1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L54.42.txt`):

```text
Error on line 3 or its substitute:
  |1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L55 `\`

```spice
first-letter test [\]
Rref a 0 1
\1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L55.47.txt`):

```text
Error on line 3 or its substitute:
  \1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L55.42.txt`):

```text
Error on line 3 or its substitute:
  \1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

### L56 `` ` ``

```spice
first-letter test [`]
Rref a 0 1
`1 a 0 5
.op
.end
```

ngspice 47, exit 1, stderr (`traps/letters_out/L56.47.txt`):

```text
Error on line 3 or its substitute:
  `1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Error: incomplete or empty netlist
       or no ".plot", ".print", or ".fourier" lines in batch mode;
no simulations run!
```

ngspice 42, exit 1, stderr (`traps/letters_out/L56.42.txt`):

```text
Error on line 3 or its substitute:
  `1 a 0 5
 unknown device type - error 
    Simulation interrupted due to error!

Note: No ".plot", ".print", or ".fourier" lines; no simulations run
```

