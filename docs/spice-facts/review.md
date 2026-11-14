# Review of the SPICE core, 10 November 2026

An adversarial review of `src/spice/` (`parse.ts`, `numbers.ts`, `elements.ts`, `graph.ts`, `traps.ts`,
`explain.ts`, `describe.ts`, `run-netlist.ts`): every sentence the trap checks, the explanations and
the results in words say about how SPICE behaves was matched to its evidence in this folder, or run
in ngspice; the trap checks were run on every netlist we have; every fix was applied and run; the
parser's offsets were fuzzed; the wording was checked for one word per idea; and the speed was
measured. Every finding below was confirmed by a run or a test before it was fixed.

## How it was checked

- **Claims.** Each trap text, explanation and message names the claim it rests on (`[unknown-word-1]`,
  `// P10d`). Claims were read against their evidence blocks; sentences without one were run on native
  ngspice 47 (built like our engine), native ngspice 42 and our engine. A script also took every
  netlist below, found the traps, and checked that each message a trap quotes (`'unknown parameter
  (k)'`) appears in the output of the run it describes: 736 quotes, all accounted for (the 13 that
  were not found are batch-mode texts the trap attributes correctly, see "Rejected").
- **Netlists.** The 10 fixtures (`tests/fixtures`), the 63 netlists of the channel's episodes
  (`solved-circuits/design`, read only), the 114 corpus netlists (`tests/corpus/traps`,
  `tests/corpus/letters`, the same as the research runs), every `spice` block of the three facts
  files, and about 60 netlists written for this review: 760 netlists in all. For each, the engine's
  result was compared with the traps: a failed or unreliable run with no error or warning trap is a
  possible false negative; an error trap on a clean run a possible false alarm.
- **Fixes.** Every fix offered on every one of those netlists (337) was applied: the trap must go,
  no new error or warning may appear, and when it was the netlist's only problem the engine must run
  the result cleanly. 0 problems remain.
- **Offsets.** 51 000 random netlists (tabs, CR LF, a carriage return inside a word, Ω, ı, İ, ş,
  combining accents, emoji, no-break spaces, continuation lines, end-of-line comments of every kind,
  odd first characters): every token, field, node reference, trap span, fix range and explanation
  span is exact (`text.slice(from, to) === token.text`), every trap sits on the line its span starts
  on, nothing throws, and no text contains `undefined` or `NaN`. A smaller version is now a unit test.
- **Speed.** Parse, checks and explanations of 2000-line netlists, normal and pathological, warm and
  cold, in Node 22.
- **The app.** A production build (into a scratch folder) served on its own port and opened in
  headless Chromium with a netlist carrying the new cases: the two new traps show with their fixes,
  F reading E1 gets no trap, the G line's value is labelled "amps per volt", the labels use the true
  minus sign, and the page logs no errors.

The scripts and their outputs stayed outside the repository, like the earlier evidence runs; the
netlists and recorded values of every new claim are in `tests/golden/facts-traps.test.ts` and
`tests/golden/facts-explain.test.ts`, which re-run them through the engine.

## Findings fixed

| # | What was wrong | Evidence | Fix |
|---|---|---|---|
| 1 | **control-source fired on correct circuits.** F or H reading the current of an E or H output, or of a B line with V=, got the error "E1 is not a voltage source … ngspice stops: unknown controlling source", while ngspice runs them (the explanation of the same line said so: a contradiction). A B line with I= was said to stop with "unknown controlling source"; in fact ngspice accepts the name, finds a singular matrix and the operating point fails. | control-source-4, -5; P10b, P10d. "Unknown controlling source" for a current source, a capacitor, a G and an F output: control-source-6 to -9 (and the resistor and inductor: control-source-2, P10c). | `hasReadableCurrent` (graph.ts) is the one rule for traps, explanations and typo suggestions; B with I= has its own text. |
| 2 | **fatal-syntax fired on correct expressions.** `.func dbl(x) {2*x}` was told "x is not defined: add a .param line", and so were the nodes in `B1 out 0 V={2*v(in)}`, `{2*i(V1)}` and `R4 in 0 {2*v(in)}`. ngspice runs all of them. | fatal-syntax-10, -11 | `.func` bodies are skipped; what v( ) and i( ) enclose is not a parameter name. |
| 3 | **No trap for a word ngspice can't use after a value** (false negatives, among them corpus L30): `R1 a 0 1k load`, `C1 b 0 1u big`, `V1 a 0 5 battery`, `R1 a 0 1k 2k 3k`, `V1 n1 0 1d-3`, `R1 n1 0 1k i`, `E1 b 0 a 0 2 3`. ngspice stops ("unknown parameter", or "no such parameter on this device" for a value the part only reports). Worse, the explanation called `load` (and the `k` of `1 k`) "a parameter" while the space-before-suffix trap said ngspice stops at it. | unknown-word-1 to -11 | The parser now knows the settings of R, C, L, E, F, G and H from ngspice 47's parameter tables (res.c, cap.c, ind.c, vcvs.c, vccs.c, cccs.c, ccvs.c; including the `tc=a b` form of inp2r.c and the multiplier m of F and G). Any other word is `other`; a new trap, `unknown-word`, explains it and offers to turn it into a comment, or to write `1e-3` for `1d-3`. The explanation says what ngspice does with the word, part by part. |
| 4 | **No trap for an unknown dot command** (corpus L31, `.tarn`, `.step`, `.foo`): ngspice stops before anything runs. The explanation already said so (A29). | unknown-dot-command-1 to -3, A29 | New trap `unknown-dot-command`, with "Use .tran" when the name is one slip from a common command (`.end` offered only on the last line, `.ends` only inside a subcircuit: an extra `.ends` is a fatal error), and "make the line a comment". no-analysis stays quiet when the unknown command is a misspelt analysis. |
| 5 | **`.pss`, `.hb`, `.sens2` were called "another ngspice analysis"** (no trap, a reassuring explanation), but ngspice 47 as built and our engine stop at them; so does a lone `.endl`, which was listed as known. | A29b, A29c, unknown-dot-command-2, -3 | Removed from the known lists; they now get the unknown-dot-command trap. |
| 6 | **`.lib` with one word** (`.lib models.lib`) had no trap; ngspice does not recognise it and stops. | include-not-available-3 | include-not-available has a text for it; the explanation adds a note. |
| 7 | **The missing-value trap and explanation said an R, C or L without a value is left out of the circuit,** also when settings follow the nodes. Then ngspice keeps it: a resistor at 1 mΩ with a warning, a capacitor or inductor without capacitance or inductance, silently. The circuit graph also left such parts out. | missing-value-8 to -10 (missing-value-1, -2 for the "left out" case) | The texts and `isBuilt` follow ngspice's parsers (inp2r.c, inp2c.c, inp2l.c): left out only when nothing follows the nodes. |
| 8 | **The explanation of an E, F, G or H line without a gain said "PlainSpice's engine finds no single answer (a singular matrix) and gives no results"**; our engine reads the gain as 0 and runs (the trap said this correctly). The singular-matrix message in the results also blamed such lines. | missing-value-4 to -7; M9 is about too few nodes | A note that matches the trap; the message keys on too few nodes only. |
| 9 | **Left-out models got the MOSFET message.** For a HICUM BJT (npn level=8) and a JFET2 (njf level=2) the explanation and the results said ngspice prints "could not find a valid modelname" and offered "use level=1"; it prints "Unable to find definition of given model" and "Unknown device type for model jm". JFET2 was also called a chip-design model. | model-not-in-engine-3, -4; M8 | `leftOutModel` returns the message and the kind of model; the level=1 hint is for MOSFETs only. |
| 10 | **decimal-comma on an inductor** said "says nothing"; ngspice warns "can't find model '1,5m'" (the evidence block showed it; its title said "silently"). | decimal-comma-3 | Text and title now mention the warning, as for a capacitor. |
| 11 | **voltage-loop with only `.tran … uic`** quoted "The operating point could not be simulated successfully"; with uic there is no operating point and ngspice stops with "Timestep too small". | voltage-loop-7 | The text depends on whether an operating point is needed. |
| 12 | **A P line** (corpus L15, `P1 a 0 5`) was said to stop with "model name is not found"; ngspice says "Unable to find definition of model 5". | unknown-letter-16, -17 | The trap finds the word ngspice takes for the model the way inp2p.c does. |
| 13 | **E, F, G and H with p, v or i after the value** (`E1 b 0 a 0 2 p`): the trap quoted "unknown parameter (p)"; our engine says "no such parameter on this device or parameter is missing". | space-before-suffix-15, unknown-word-11 | The message follows the parameter tables. |
| 14 | **The diode fix for `D1 a 0 5`** added `.model 5 D`, which still fails (a number is no model name). | missing-model-7 | The fix names a standard model, `dmod`, and the text says why. |
| 15 | **The explanation of `.dc C1 …`** said "There is no C1 in the circuit"; C1 is there, .dc just can't sweep a capacitor (the trap said so). | dc-sweep-problems-7 | A note that says what C1 is. |
| 16 | **`4R7` was explained as a unit after the number** ("Don't type units after numbers"); it is a resistor code, read as 4 Ω. | rkm-notation-1 | A note in the words of the rkm-notation trap. |
| 17 | **A first line starting with `@`:** the trap quoted "there aren't any circuits loaded" as ngspice's; native 47 crashes there with a results file, and only ngspice 42 and our engine print it. | unknown-letter-5 | Attributed to PlainSpice's engine. |
| 18 | **One word for one idea: G and H.** The field table called G's and H's values "transconductance" and "transresistance"; the catalog, the trap texts and the sentences said "amps per volt" and "volts per amp". | | The plain words everywhere (the roles in the code keep their names). |
| 19 | **The true minus sign.** The catalog's labels and several trap texts wrote "- node", "control - node", "10^-18", "a gain of -2", "from -2 A to -5 A" with the ASCII hyphen. | | U+2212 in every label and display text, superscripts for powers of ten; netlist words are still quoted as written. A unit test checks the trap texts. |
| 20 | **savecurrents** was described as saving "every part (R, C, L, F, G, I, B …)" with no evidence beyond A2 and C7. | A2b (diodes, BJTs and MOSFETs too) | The setting's text names them. |
| 21 | **Speed.** Four parts of the checks grew with the square of the netlist: the typo search for dangling nodes (every node against every node, and every candidate against every part to find a voltage source across it), the fresh names for duplicate parts, and the de-duplication of traps. A 2000-line netlist with a thousand dangling nodes took 2.0–2.6 s, a thousand duplicates 2.0–2.5 s. | measured | An index of names one edit apart (`TypoIndex`), a set of voltage-source node pairs, a counter per name stem, and a set of trap keys. Those netlists now take 60–200 ms with the explanations; a normal 2000-line netlist takes 30–40 ms warm for parse, checks and explanations (it was about 50 ms), and 60–180 ms cold, when the JavaScript engine has not compiled the code yet. Unit tests check both, with limits generous enough for CI. |

What the fixes changed elsewhere: two corpus netlists gain the error they deserve (L30: unknown-word;
L31: unknown-dot-command); no fixture or episode netlist changed its traps. The app's tests did not
need changes.

## Rejected (checked, no change)

- **"ngspice … says nothing" while the engine reports an error, for a `.dc` with no points.** ngspice
  itself is silent; the error comes from our reader of the empty results file, and describe.ts
  explains it (A11). Correct as written.
- **"In batch mode it ends with 'no simulations run!'" is missing from the runs with a results
  file.** The sentence is about `ngspice -b` without one and says what our engine does instead
  (no-analysis-1). Correct.
- **after-end-2 and unknown-letter-4 say ngspice "stops reading" while the engine runs.** They are
  about reading the file, not about the run. Correct.
- **Lines starting with = [ ] ? ( ) & % $ " ! : , are not trapped.** ngspice turns them into
  comments, warns once and runs (S10, S36); the explanation of each says so. A trap would add noise.
- **"The currents next to it come out inaccurate" (0 Ω).** Shown by P13: 5.859 mA instead of 6 mA. After the
  integration check of 14 November 2026 (P4) the words say "can come out inaccurate": where a current source
  sets the current, the resistor carries exactly it (P24b).
- **"These numbers can't be trusted … (a singular matrix)" for every unreliable run.** The engine
  also marks a run unreliable after a failed gmin or source stepping without a singular matrix; but
  in every such run tried here (a diode straight across 1000 V, steep diodes, a latch) the fallback
  failed too and the run had no results, so the sentence was never shown wrongly. Not changed.
- **The info note on an open terminal** (`e04/spice/ex3_open.cir`, `spice/p2e1_oc.cir`): "a sits at
  the same voltage as n1. That is right for an open terminal" is correct (dangling-node-1).
- **"+ side" next to "+ node".** The field label is the node ("+ node"); the meaning says where the
  source's + side sits ("the + side is at n1"). Two ideas, two words, used the same way in all three
  files.

## Still open

- A B line whose expression uses an undefined name without braces (`B1 out 0 V=k*v(in)`) stops
  ngspice with "Undefined parameter [k]"; there is no trap. B lines are beyond the first-year scope,
  and reading unbraced B expressions risks false alarms.
- A diode with an extra word after its model (`D1 b 0 dmod fast`: ngspice takes dmod for a thermal
  node) and a `.ends` without `.subckt` (a fatal error) have no trap. Both were seen only in this
  review's own netlists.
- Speech says "amperes" (src/format/si.ts and the .tf ratio words) while the written labels say
  "amps per volt" and "volts per amp": written words follow the channel, speech follows the unit
  names. Changing si.ts is for its owner to decide.
- An expression that uses an undefined name is explained as "an expression: ngspice works out its
  value before running", next to the fatal-syntax trap that says ngspice stops. Not a contradiction
  about what an expression is, but the note could say so.
- **The editor's highlighting now disagrees with the parser on one point.** `src/editor/spice-tokens.ts`
  (not part of this review) has its own tables for V and I only, so in `R1 a 0 1k load` it still
  shows `load` as a parameter name, while the parser (and the new unknown-word trap) mark it as a
  word ngspice stops at. `partParameter(letter, word)` in parse.ts gives the editor the same tables;
  the agreement test (`tests/unit/editor-tokens-parser.test.ts`) does not cover such lines yet.
- The parser marks unknown words exactly for V, I, R, C, L, E, F, G and H only. On D, Q, M, J and
  the rest, any identifier after the model is still a "parameter", as the parser's own notes say.
