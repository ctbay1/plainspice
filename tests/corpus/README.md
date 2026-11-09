# Test corpus

Netlists and data recorded while studying how native ngspice behaves (9 Nov 2026; the reports are
in `docs/research/native.md` and `docs/research/native-traps.md`). CC0 1.0, like the fixtures.

- `traps/`: one netlist per beginner trap (the `T…` names match the table in
  `docs/research/native-traps.md`, which has ngspice 42 and 47's verbatim output for each).
- `letters/`: a two-node line starting with every letter, digit and punctuation mark
  (`L…` names), to see which first characters ngspice accepts.
- `numbers/suffixes.json`: how ngspice 42 and 47 read 48 spellings of numbers (`1M`, `1meg`, `3A`,
  `2k2`, `1µ`, `1μ`, ...), measured by running them.
