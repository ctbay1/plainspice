# 0009. Tests and CI

- Status: accepted
- Date: 2026-11-09

## Decision

Four kinds of tests, all run in GitHub Actions on every push and pull request; `main` deploys to
GitHub Pages only when they pass (`.github/workflows/ci.yml`).

1. **Unit tests** (Vitest, Node or jsdom): the number reader, the netlist parser, the trap checks
   (each trap fires on its netlist, each fix removes it, no false alarms on the fixtures and the
   channel's netlists), explanations, share links, export, the rawfile reader, formatting.
2. **Golden tests** (Vitest, Node): every fixture in `tests/fixtures/` runs through the
   WebAssembly engine, the same code the page runs, and must agree to **6 significant figures**
   with native ngspice 47 (every vector, including `.tran`), native ngspice 42 (`.op`, `.tf`,
   `.dc`), the numbers native ngspice prints, and the values worked out by hand. The native
   results are recorded in `tests/golden/native/` by `scripts/record-native.ts`; CI does not need
   native ngspice.
3. **Fact tests** (Vitest, Node, `tests/golden/facts-*.test.ts`): every statement the UI makes
   about how SPICE behaves (in trap messages and explanations) has a netlist that is run through
   the engine and checked; `docs/spice-facts/` holds the native evidence.
4. **End-to-end and accessibility tests** (Playwright, Chromium): the app loads, runs a fixture
   and shows the right numbers; trap fixes; share links round trip; keyboard-only use; a phone
   viewport; axe-core with the WCAG 2.2 AA rules on every main state; high contrast, large text
   and forced colours.

Playwright is pinned to the version whose browsers are installed in Claude's cloud sessions
(1.63.0), so local and CI runs match; CI installs that version's Chromium.

## Consequences

- A new ngspice version means re-recording native results with the same version
  (`npm run record:native -- --ngspice <path>`), then the golden tests say what changed.
- `.tran` comparisons need the same ngspice version (time grids differ between 42 and 47).
- Screen-reader behaviour beyond the accessibility tree needs a manual pass with real screen
  readers (NVDA, VoiceOver, TalkBack): listed in the plan.
