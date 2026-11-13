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
`.end`, a `;` line in an `*ng_script` file, `pre_`) and how its control reader makes their words (blanks
kept in quotes, a backslash dropped, choices in braces made into words, `~` made the home folder); limit-16
and limit-17 gained a built circuit's `.title` line, a formula's name with its blanks and quotes, and
`fft`, `psd`, `spec` and `asciiplot`.
