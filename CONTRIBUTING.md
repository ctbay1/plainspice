# Contributing to PlainSpice

Thank you for helping. PlainSpice is for first- and second-year students learning circuit
analysis, so every change is judged by one question: *can a beginner follow it, and is it
true?* Please be kind and patient with each other; assume good intent.

## Four rules

1. **Every claim about SPICE is checked by running ngspice.** If the app says how ngspice
   behaves (a trap message, an explanation, a sign convention), the netlist that shows it, the
   verbatim ngspice output and a test that runs it through our engine must exist
   (`docs/spice-facts/`, `tests/golden/facts-*.test.ts`). Never from memory. We never claim how
   LTspice behaves unless someone has run it.
2. **Accessibility is not optional.** WCAG 2.2 AA ([decision 0010](docs/decisions/0010-accessibility.md)):
   everything by keyboard, screen-reader names and descriptions, contrast, no colour-only
   signals, high-contrast / large-text / reduced-motion modes, 320 px wide. axe must pass.
3. **Plain words.** A first-year student must follow every sentence. One word for one idea,
   used the same way everywhere ("ground", "node", "+ node", "from node"). Say *why*, not just
   *what*.
4. **Numbers must match native ngspice to 6 significant figures.** The golden tests enforce it.

## Getting started

Node 22 or newer.

```bash
npm ci
```

```bash
npm run dev
```

Open the URL Vite prints. The engine (`engine/dist/`) is committed, so you don't need
Emscripten unless you change it.

## Tests

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:e2e
```

- `npm test` runs the unit tests and the golden tests (every fixture through the WebAssembly
  engine, compared with recorded native ngspice 47 and 42).
- `npm run test:e2e` runs Playwright (Chromium) with axe-core accessibility checks.

## Changing the engine

See [`engine/README.md`](engine/README.md). After `npm run engine:build`, record native ngspice
of the same version (`npm run record:native -- --ngspice /path/to/ngspice`) and run the golden
tests; regenerate `docs/fixture-results.md` with
`node --experimental-strip-types scripts/fixture-report.ts`.

## Where things live

| Path | What |
|---|---|
| `src/spice/` | the netlist model: number reader, parser, trap checks, explanations (plain TypeScript, no UI) |
| `src/engine/` | ngspice in a Web Worker, the rawfile reader, results and message classification |
| `src/editor/`, `src/plot/`, `src/share/`, `src/export/` | editor (CodeMirror 6), plots (uPlot), share links, export |
| `src/app/` | the React user interface |
| `engine/` | the ngspice WebAssembly build: script, patches, outputs |
| `tests/` | unit, golden (native vs WebAssembly), facts, end-to-end |
| `docs/decisions/` | why things are the way they are |

## Pull requests

- Small and focused, with tests. Explain the beginner-facing effect in the description.
- New user-facing text goes in the string catalogs (a Turkish UI is planned).
- CI must be green: typecheck, unit, golden and end-to-end tests with axe.

## Licence

By contributing you agree that your code is released under the [MIT licence](LICENSE) and your
documentation under CC BY 4.0, as the rest of the project (GitHub's terms: inbound = outbound).
The names "PlainSpice" and "Solved Circuits" are covered by [`TRADEMARKS.md`](TRADEMARKS.md).
