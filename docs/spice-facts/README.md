# SPICE facts

Tarık's rule: anything PlainSpice says about how SPICE behaves, in the interface or in the code that
decides what to say, is checked by running ngspice. Never from memory, never from another simulator's
manual. So every such claim has a home in this folder, with three things:

1. **the netlist** that shows it, small enough to read;
2. **what ngspice printed**: a verbatim excerpt from native ngspice 47 (the version our engine is built
   from) and native ngspice 42, and what our WebAssembly engine gave;
3. **a test** in `tests/golden/facts-<topic>.test.ts` that runs the netlist through our engine on every
   `npm run test:golden` and asserts the claimed result. If a new ngspice reads the netlist differently,
   the test fails and the claim is checked again.

Each claim has an ID (N1, S20, W9, ...) and a title that states it in plain words, followed by the
"why". Code that relies on a claim names its ID, so a reader can go from a rule in the code to the
ngspice output that justifies it. PlainSpice never claims how LTspice behaves: it cannot be run here.

## Files

| File | What it covers | Relied on by | Test |
|---|---|---|---|
| [numbers-and-syntax.md](numbers-and-syntax.md) | How ngspice reads numbers (scale letters, `M` is milli, units ignored, decimal commas, exponents), lines (the title, comments, continuation lines, `.end`, `@`, `.control`), words, node names and ground, which number a part line uses, and what each first letter means | `src/spice/numbers.ts`, `src/spice/parse.ts`, `src/spice/elements.ts` | `tests/golden/facts-numbers.test.ts` (and the unit tests `tests/unit/spice-numbers.test.ts`, `tests/unit/spice-parse.test.ts`) |
| [traps.md](traps.md) | What ngspice does with each beginner trap PlainSpice checks for (the scale letters, ground, floating nodes, current sources with no path, loops of voltage sources, duplicate names, unknown first letters, missing values, `.tf`/`.dc` on names that don't exist, words and dot commands ngspice doesn't know, invisible characters and look-alike letters, characters that look like a space, node names ngspice spells with underscores …), so each check says what really happens and its fix changes only what it should | `src/spice/traps.ts`, `src/spice/graph.ts` | `tests/golden/facts-traps.test.ts` (and `tests/unit/spice-traps.test.ts`) |
| [explanations.md](explanations.md) | What each kind of line means (parts, sources and their waveforms, dot commands), what each analysis computes and saves, which way currents and powers are counted, and what ngspice's messages mean | `src/spice/explain.ts`, `src/spice/describe.ts` | `tests/golden/facts-explain.test.ts` (and `tests/unit/spice-explain.test.ts`, `tests/unit/spice-describe.test.ts`) |
| [drawing.md](drawing.md) | That ngspice ignores the drawing lines PlainSpice keeps in a netlist (`* plainspice-drawing v1` and the `*@` lines, with their `side=` fields, fields PlainSpice does not know, and another version's block): same printout, same results file byte for byte, no warning | `src/schematic/format.ts`, and `src/spice/explain.ts` (Explain's one entry for the drawing lines) | `tests/golden/facts-drawing.test.ts`, the drawing case in `tests/golden/facts-explain.test.ts` (and `tests/unit/schematic-format.test.ts`) |
| [limits.md](limits.md) | Where ngspice copies a title or a name into a space of fixed size without checking its length (the title in 513 bytes, a saved part's full name, `i(…)` and `@…[…]` on a `.save` line, a formula's names and `v(…)` and where a line's comment starts, an analysis command of a `.control` block, `.save alli`, a `.model` line's version in 100 bytes, names made inside subcircuits printed by a `.control` block, a circuit built with `circbyline` and its `.title` line, names ngspice joins by taking the blanks out of brackets, string parameters, the names of a `.probe` line, the name `print`, `write`, `fft`, `psd`, `spec` and `asciiplot` give a formula, a wrong `meas` word in 100 bytes), which lines ngspice runs as commands (a `*#` line anywhere, after `.end` too) and how its control reader makes their words (quotes, braces, `~`), what native ngspice and our engine do past the end, what reaches no such space (an end-of-line comment), and the one way past PlainSpice's checks it knows (what ngspice's commands compute while they run, from variables, aliases and the files they write) | `src/spice/run-netlist.ts` (the copy ngspice runs) | `tests/golden/facts-limits.test.ts` (and `tests/unit/spice-run-netlist.test.ts`) |

## Adding a fact

- Put it in the file for its topic, or start a new file `docs/spice-facts/<topic>.md` with its own test
  `tests/golden/facts-<topic>.test.ts`, and add a row above.
- Write the claim as a sentence a first-year student can follow, then the why.
- Run the netlist with native ngspice 47 and 42, as `ngspice -b file.cir` (the printout) and
  `ngspice -b -r out.raw file.cir` (exact values from the binary rawfile), and through our engine.
  Copy the output verbatim; shorten only file paths and the long model and device listings, and say so.
- Note where 47 and 42 differ, and where our engine differs from native 47 (our build leaves out XSPICE,
  OSDI and some device models: `engine/README.md`).
- Native ngspice used so far: 47 built from the release tarball
  (`./configure --with-x=no --disable-debug --with-readline=no && make`, see `CLAUDE.md`), and 42 from
  Ubuntu's `ngspice 42+ds-3build1` package.

## The review of 10 November 2026

An adversarial review of `src/spice/` checked every sentence the trap checks, the explanations and the
results in words say about ngspice against this evidence, ran the trap checks on every netlist we have,
and fixed what it found: [review.md](review.md) lists each finding with its evidence. The claims it
added (control-source-4 to -9, unknown-word-1 to -11, unknown-dot-command-1 to -3, unknown-letter-17, missing-value-8 to -10,
missing-model-7, fatal-syntax-10 and -11, space-before-suffix-15, include-not-available-3, P10d, A2b,
A29b, A29c) were run the same way, on 10 November 2026, and are in the same tests.

## The final reviews of 12 November 2026

Claims added for the fixes after the final reviews of milestone 2, each run the same way (native
ngspice 47 and 42, and our engine) on 12 November 2026 and asserted by the same tests: C9, C9b, C9c
(a current that is 0 can come out as rounding noise; ngspice's current tolerance abstol is 1 pA) in
explanations.md; W16, W17, W18 (each byte of a letter outside ASCII in a name becomes `_`, so two
names can become one) in numbers-and-syntax.md; and in traps.md non-ascii-node-1, -2,
duplicate-name-3, invisible-character-1 to -5, look-alike-letter-1 to -3, unknown-word-12 and
space-before-suffix-16, -17. drawing-1 is now relied on by Explain too.

After the critic of those fixes, the same day: C9d (the noise passes on through what it drives, and a
node voltage can be noise too; vntol, ngspice's voltage tolerance, is 1 µV) and C9e, C9f, C9g (a
tiny current the circuit makes is real, next to large currents too) in explanations.md; nbsp-2 and
space-character-1 to -6 (a character that looks like a space is none for ngspice: in a value it ends
the number, between two words it glues them), look-alike-letter-4 (a capital M from another alphabet
is no M), look-alike-letter-5 (a look-alike in a node name makes another node) and invisible-character-6
(an invisible character right after a sign) in traps.md.

After the critic of round 2, the same day: C9h, C9i, C9j (a tiny real current flows on through the
parts in series and side by side with it, though their ends are a step of a double apart), C9k (a
ladder of 1000 sections: real nanovolts and femtoamps, and a far end below the smallest normal
double) and C9l (two ends more than a few steps of a double apart carry a real current; 300 random
bridges) in explanations.md; and in traps.md space-character-7 to -11 (groups of digits with a unit,
`10<THIN>000<THIN>Ω` is 10 Ω; on a capacitor ngspice also looks the word up as a model; with normal
spaces the groups are three words and ngspice stops; in a node name the character makes another node;
digits not grouped in threes end the number too) and look-alike-letter-6 (a look-alike right after a
sign: `-５` stops ngspice).

After the re-check of the merged build, the same day (the names lane): in traps.md non-ascii-node-3 (a
.print or .plot line keeps a node's letters as written, so `ngspice -b` finds no such node there),
non-ascii-node-4 (so does a command for ngspice: a `save v(çıkış)` that leaves nothing else saved stops
the analysis, in PlainSpice's run too), non-ascii-node-5 (ngspice reads the micro sign as u, so `aµ` and
`au` are one node), non-ascii-node-6 (`gñd` is the ordinary node `g__d`, while `gnd` is ground) and
duplicate-name-4 (`Rµ` and `Ru` are the same name); in explanations.md M4b and M4c (the Numbers panel's
words for `Rş` and `Rç`, `Rµ` and `Ru`).

After the critic of the names lane, the same day: in traps.md non-ascii-node-7 to -9 (a save that also
names something ngspice finds, `save all`, or the currents PlainSpice saves for .op keep the analysis
running), non-ascii-node-10 and -11 (a capacitor with no starting voltage or a diode across `aµ` and
`au` carries no current, as a resistor does; a current source, a dependent source or a transistor still
works, a voltage source stops ngspice), and invisible-character-65, -66, look-alike-letter-16, -17,
space-character-20, -21 (a .print line or a .control block reads a node name with such a character as
written, as for a Turkish letter).

After the second critic of the names lane, the same day: in traps.md non-ascii-node-12 (a capacitor
given a starting voltage, `ic=`, across `aµ` and `au` carries −5000 A at the first point under `uic`),
non-ascii-node-13 (with anything else to print or save, an .op or .tf, a name ngspice finds on the
line, a .save, savecurrents, .meas or .four line, `ngspice -b` runs the analysis: only the .print line
is lost) and non-ascii-node-14 (a save of the name in a command for ngspice, or an earlier .print line
for another analysis, takes ngspice's "can't parse" warning away); non-ascii-node-3 now lists a bare
name on a .print or .plot line (`.print dc çıkış`) and the other forms of those lines, and
non-ascii-node-7 three more saves that leave the run going (savecurrents on a continuation line, a
`reset`, a save inside `if 0`).

After the re-check of those fixes, the same day, each run the same way: in traps.md,
invisible-character-7 and look-alike-letter-7 (on a capacitor or an inductor ngspice also warns about a
model), invisible-character-8 to -22 (what ngspice does with a word it cannot read at each place of
`.tran`, `.dc`, `.ac` and `.noise`, never "unknown parameter"; inside such a number it ends it),
invisible-character-23 to -27 (the other default-ignorable characters, the line and paragraph
separators; an E's gain; a `.four` line, which a run with a results file skips), look-alike-letter-8 to -14 (a minus sign in a `.dc` line, a document's
decimal point, the letter O where a zero belongs, other characters outside ASCII inside a number),
space-character-12 to -15 and nbsp-3 (a sign followed by a character that looks like a space),
space-before-suffix-18 (`4·7 kΩ`), missing-value-11 to -14 (settings but no gain: 0, silently, in
native 47 too), unknown-word-13 to -24 (a word where a part's value goes; a `.param` name there is
that value) and dc-sweep-problems-9, -10 (a word that is no number where a `.dc` number goes); and in
explanations.md P16b (`dc` with no number: 0, without a note).

After the critic of the re-check fixes, the same day, each run the same way: in traps.md, zero-ohm-4 (a
value read as 0 because of how it is written: ngspice 47 warns for each resistor, 42 uses 1 mΩ),
invisible-character-28 to -44 (a number read short is weighed at its place: a `.tran` step or stop of 0,
a `.dc` step of 0, `.ac` and `.noise` numbers read as 0 or past the line's other numbers, and the places
where ngspice runs on with it; invisible-character-22 now claims only the stops it recorded),
invisible-character-45 to -53 (a word in a source's function, its AC value or phase, or a setting's
value: what ngspice says at each), look-alike-letter-15 (the letter O before a unit, meg or another O),
unknown-word-25 to -37 (a sign with a space after it, part by part: a polynomial natively on E-H; a
subcircuit's parameter, a `.param` in a subcircuit and a `.func` name are no value outside it; a
`.param` line after `.end` is read), dc-sweep-problems-11 to -19 (a sweep missing its numbers, a number
too many, a name with a character that is not what it looks like, braces and quotes, a `.param` name
without them, words after the second sweep), tran-problems-8, -9 (a stop time of 0 or less) and
space-character-16 to -18 (a word glued by a thin space on an analysis line is one number, cut short).

After the second critic of the re-check fixes, the same day, each run the same way: in traps.md,
invisible-character-58, -60 to -63 and space-character-19 (a character word on an analysis line with a
problem of its own: ngspice does what that problem does), -64 (a second sweep's step read as 0), -57 (a lin `.ac` start read as 0 runs from
0 Hz), -54, -55 and dc-sweep-problems-20 to -24, -26, -27 (a sweep the wrong way in two sweeps never
moves; both: no points), dc-sweep-problems-25 (a step of 0 and a missing source: 47 stops at the step,
42 at the source), invisible-character-56 (the other places of the source functions, the AC phase and
values written name=value, read short: no message) and -59 (PWL times read out of order: a warning),
zero-ohm-5, -6 (r= read as 0; ngspice's names inside a subcircuit, r.x1.r1) and unknown-word-38 to -52
(another subcircuit's parameter or a `.func` name inside a subcircuit, m= after an E or H gain, a
setting where a part's value goes, another name=value after E's gain, a sign before a hidden character).
A fact of two problems is marked `several` in its golden row: each fix takes its own trap away, and the
fixes applied in turn give a clean run.

After the words re-check of the merged fixes, the same day: A3b (a gnd inside `.tf`'s `v( )` is
ground, even beside an ordinary node called gnd) and A3c (a `.tf` written after `.end` runs, and
ngspice names its output in its own words, `v(out,mid)`) in explanations.md, on which the .tf words
rely; P3 and P4 now also run a source with a negative value between two nodes, which Explain says by
its size ("3 V below", "the current flows the other way"). After the critic of those fixes:
tf-problems-8 in traps.md (a `.tf` output written with an invisible character, one that looks like a
space or a look-alike letter is another node with nothing on it: a transfer function of 0 and an
output impedance of 1 Ω, so the .tf check keeps its error there); and in explanations.md M2d (ngspice
points at a node in its own spelling, `check node ou___t`, `check node __iki__`, which the words map
back to the node), A3d and A3e (a `.tf` after `.end` with a current source as the input, and with a
current output: the same numbers as above `.end`, so the same units and names). After the second
critic of those fixes: in traps.md floating-dc-7 to -10 (ngspice's "check node" names one node, of a
larger group or of another group, not always the first; control inputs joined by a resistor get
numbers, alone they stop ngspice), tf-problems-9 to -11 (the character in the parts' node rather than
in the `.tf`, in a part's name in `.tf`, and a `.tf` after `.end`, which ngspice runs) and two more
runs in tf-problems-8 (a second output, which adds 1 Ω, and a name with two kinds of character); in
explanations.md P3b, P4b and P4c (a source .dc sweeps has no one value there; beside a SIN, .op uses
the value and .tran the SIN) and A3f (an analysis line in a subcircuit no X line uses is ignored).

After the re-check of 12 November 2026 and the fixes of the rounding-noise rule (12 and 13 November):
C9m to C9v.8 in explanations.md (what the exact solution decides, ngspice's answers far off, .tf and
.dc of balanced bridges, diodes left free, a diode loop ngspice settles on a current around, a circuit
at rest, each answer's own floor, diodes placed alike, an .op decided with its sweep, and what the page
draws).

## Where the evidence came from

The facts in all three files were run for them on 9 November 2026. Two parts come from the
research runs of the same day, which are not in the repository, so their results are copied here:
the 48 value spellings (each put on a current source, a resistor and a capacitor, in ngspice 42 and 47;
the table is in `tests/unit/spice-numbers.test.ts`) and the first-character sweep (57 first characters;
the 26 letters were run again for section 5 of `numbers-and-syntax.md`).

## The second re-check of 13 November 2026

limit-1 to limit-12 in [limits.md](limits.md), run on 13 November 2026 with native ngspice 47 and 42,
an AddressSanitizer build of ngspice 47 configured like our engine, and our engine: a title of more
than 504 bytes stops `ngspice -b -r` (fileInit's 513 bytes), and the other places where ngspice
copies a name into 100 or 512 bytes without checking, found by reading every fixed-size array of the
source that a netlist reaches. The copy PlainSpice runs keeps inside all of them; limit-11 (what
ngspice's commands compute while they run, from variables, aliases and the files they write) is the one
way past it that we know. limit-13 to limit-17, run the same day after a review of that fix, are what ngspice does to a line
before it copies it: blanks taken out of brackets, string parameters joined, the names of a `.probe` line,
circuits built inside built ones, the names `print` and `write` give a formula, and `meas` words in 100
bytes. limit-18 and limit-19, after a review of the second fix, are the lines ngspice runs as commands
besides a `.control` block's (a `*#` line anywhere, `##` and `;#`, a `.control` block or a `*#` line after
`.end`, a `;` line in an `*ng_script` file, `pre_`), the lines after `.end`, which are part of the circuit
to it, and how its control reader makes their words (blanks kept in quotes, a backslash dropped, choices in
braces made into words, `~` made the home folder); limit-12, limit-16 and limit-17 gained `ngbehavior` set
before a built circuit, a built circuit's `.title` line, a formula's name with its blanks and quotes, and
`fft`, `psd`, `spec` and `asciiplot`.

## The last pass of 13 November 2026

A2c in [explanations.md](explanations.md), run the same way on 13 November 2026 (native ngspice 47 and 42,
and our engine): a `+` line after `.end` continues the last line before `.end`, so `.options savecurrents`
added just before `.end` would take that line's place (v(n1) 2 V instead of 3 V); as written, ngspice saves no
current through the resistors or from a current source, and with `.end` moved to the bottom, the line goes in
before it and the run has the same 3 V and every current. The run copy's note in the ngspice output panel and
Explain's `.op` note rely on it.

After the round-1 critic of those fixes (the same day, the same versions and modes): A2c says which currents
such a run keeps only for its own netlists (a voltage source's; and a B line's with V=, decision 0011's netlist,
a new run), where it said ngspice saves the current only in voltage sources, E and H sources and inductors
(false for a B line with V=; the note in the ngspice output panel now says what the line does instead). A2d is
new: ngspice reads an `.options savecurrents` line after `.end` too, even after a `.end` with a comment glued on,
and in a `.control` block, but not after a line starting with `@`, and the commands `option` and `set
savecurrents` save no current; the note and Explain's `.op` note say nothing of missing currents where the
student's own line saves every current.

After the round-2 critic (the same day, the same versions and modes): A2e is new. ngspice reads such a line
as it reads every line: after a line that ends in two backslashes, the next line is a `+` line (past blank
lines, and the `.hdl` and `.biaschk` lines ngspice 47 drops; not after a `*`, `$`, `.title` or `.end` line),
and in a `.control` block a `$` starts a comment only before a blank (on every line when the `.control` and
`.endc` lines are not as many). The note and Explain's `.op` note follow these rules too.

