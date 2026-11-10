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
| [traps.md](traps.md) | What ngspice does with each beginner trap PlainSpice checks for (the scale letters, ground, floating nodes, current sources with no path, loops of voltage sources, duplicate names, unknown first letters, missing values, `.tf`/`.dc` on names that don't exist …), so each check says what really happens and its fix changes only what it should | `src/spice/traps.ts`, `src/spice/graph.ts` | `tests/golden/facts-traps.test.ts` (and `tests/unit/spice-traps.test.ts`) |
| [explanations.md](explanations.md) | What each kind of line means (parts, sources and their waveforms, dot commands), what each analysis computes and saves, which way currents and powers are counted, and what ngspice's messages mean | `src/spice/explain.ts`, `src/spice/describe.ts` | `tests/golden/facts-explain.test.ts` (and `tests/unit/spice-explain.test.ts`, `tests/unit/spice-describe.test.ts`) |

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

## Where the evidence came from

The facts in all three files were run for them on 9 November 2026. Two parts come from the
research runs of the same day, which are not in the repository, so their results are copied here:
the 48 value spellings (each put on a current source, a resistor and a capacitor, in ngspice 42 and 47;
the table is in `tests/unit/spice-numbers.test.ts`) and the first-character sweep (57 first characters;
the 26 letters were run again for section 5 of `numbers-and-syntax.md`).
