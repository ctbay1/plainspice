# Research notes (9 November 2026)

These are the research reports behind the decision records in [`../decisions/`](../decisions/).
They were written by research agents in the session that started PlainSpice, each with
evidence (file paths, commands and their output), and several were then checked by a second,
adversarial agent (the `*-factcheck.md` files). Paths starting with `<scratch>/` pointed into
that session's temporary workspace, which no longer exists; the evidence that matters is
quoted inline, and the reproducible parts live in this repository (`engine/`, `tests/golden/`,
`scripts/`).

| Report | Feeds decision | What it covers |
|---|---|---|
| [eecircuit.md](eecircuit.md) | [EEcircuit comparison](../eecircuit-comparison.md) | EEcircuit's code, features, accessibility, and what we do differently |
| [engine.md](engine.md), [engine-factcheck.md](engine-factcheck.md) | 0003 | eecircuit-engine 1.9.0 measured: version, size, failure modes, fixtures vs native |
| [builds.md](builds.md) | 0003 | every other ngspice-to-WebAssembly build found, and what building our own takes |
| [own-build.md](own-build.md) | 0003 | the first build plan (superseded by `engine/build.sh`) |
| [native.md](native.md), [native-traps.md](native-traps.md), [native-number-suffixes.md](native-number-suffixes.md) | 0003, the trap checks | native ngspice 42 and 47 on the fixtures, sign conventions, every beginner trap and every number spelling, with verbatim output |
| [framework.md](framework.md) | 0002 | seven UI frameworks measured for accessibility, size and speed |
| [plotting.md](plotting.md) | 0004 | plotting libraries measured; the accessible plot plan |
| [license.md](license.md), [license-factcheck.md](license-factcheck.md) | 0005 | ngspice's COPYING and sources, obligations, licence choice |
| [names.md](names.md) | 0006 | name candidates with npm and GitHub availability |

Where a fact-check corrected a report, the decision record follows the fact-check.
