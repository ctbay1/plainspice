# PlainSpice

A beginner-first, accessible circuit simulator in the browser for first- and second-year
students, made with Tarık for his YouTube channel Solved Circuits (@SolvedCircuits). Real SPICE:
ngspice 47 compiled to WebAssembly, run in a Web Worker exactly like `ngspice -b -r`. Our work is
everything around it: explanations in plain words, beginner-trap checks with one-click fixes,
accessibility, share links. Site: https://plainspice.com/ (deployed by CI from `main` to GitHub Pages; the old
https://ctbay1.github.io/plainspice/ address and its links forward there).

## Tarık's rules (from the brief, 9 Nov 2026)

- Work on `main`, small commits; end each session with what changed and what's next
  (`docs/plan.md`).
- Anything the UI says about how SPICE behaves must be checked by running ngspice, not taken
  from memory (`docs/spice-facts/`, `tests/golden/facts-*.test.ts`). Numbers must match native
  ngspice to 6 significant figures (golden tests).
- Ask Tarık before choices that are hard to undo (names, licences, frameworks, anything
  published). Otherwise decide, write a record in `docs/decisions/`, and keep going.
- If a toolchain download is blocked, say so and use a prebuilt build instead of working
  around the block.
- WCAG 2.2 AA from day one; plain words; one word for one idea; a "why" for every step.

## Commands

- `npm ci`, `npm run dev`, `npm run build`, `npm run preview`
- `npm run typecheck`, `npm test` (unit + golden), `npm run test:unit`, `npm run test:golden`, `npm run test:e2e`
- `npm run engine:build` (Emscripten 7.0.0, pinned; about 3 minutes), `npm run record:native -- --ngspice <path>`
- `node --experimental-strip-types scripts/fixture-report.ts` regenerates `docs/fixture-results.md`
- `node --experimental-strip-types scripts/make-link.ts file.cir` makes "Open this circuit" links

## Notes

- TypeScript 7, strict, erasable syntax only, `.ts` extensions in relative imports, so scripts
  run with `node --experimental-strip-types`.
- The model (`src/spice/`, `src/engine/`, `src/share/`, ...) is plain TypeScript without React;
  React only renders (decision 0002). CodeMirror is mounted imperatively.
- The engine build leaves out device models under non-BSD terms (`engine/build.sh`,
  `REMOVED_MODELS`); the site serves the engine's exact source next to the `.wasm` (LGPL,
  decision 0005). Don't inline the wasm.
- Native ngspice for recording goldens: Ubuntu's `ngspice` package is 42; build 47 from the
  release tarball (`./configure --with-x=no --disable-debug --with-readline=no && make`).
- Playwright is pinned to 1.63.0 to match the browsers preinstalled in Claude's cloud sessions.
- In Claude cloud sessions, push to `https://github.com/ctbay1/plainspice` (the repo was renamed
  from `circuit-sim`; the session's GitHub scope must include the new name).
