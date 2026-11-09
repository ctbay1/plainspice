# 0001. TypeScript and Vite

- Status: accepted (Tarık's brief, 9 Nov 2026)
- Date: 2026-11-09

## Context

The app is a static web page: a netlist editor, explanations, trap checks,
results and plots around ngspice compiled to WebAssembly. It must run with no
server (share links carry the whole circuit), work offline as a PWA and load
quickly on a phone. It will be maintained by Tarık and by Claude-run sessions,
so the toolchain should catch mistakes early and stay boring.

## Decision

- **TypeScript** in strict mode for all code (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`). The netlist parser, the trap checks and the
  result interpretation are pure TypeScript modules with no UI dependency, so
  they can be unit-tested in Node and reused by the later schematic editor.
- **Vite** for the dev server and the production build (static files only,
  deployed to GitHub Pages under a sub-path). Web Workers are bundled with
  Vite's `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`
  pattern, and the ngspice `.wasm` is served as a separate static file (never
  inlined), so the browser can cache it and it stays a replaceable library
  (see 0003 and 0005).
- **Vitest** for unit and golden tests (shares Vite's config and transforms).
- **Playwright** for end-to-end and accessibility tests (see 0008).

Versions at the time of writing (npm registry, 9 Nov 2026): TypeScript 7.0.2,
Vite 8.3.7, Vitest 5.1.0, Playwright 1.65.0 (the repo pins the version whose
browsers CI installs; see 0008).

## Consequences

- One language end to end; the engine boundary (Worker messages) is typed.
- Anything that needs Node-only APIs (recording native ngspice output,
  making share links from `.cir` files) lives in `scripts/`, not in `src/`.
- If a tool in the chain does not yet support TypeScript 7's compiler, we pin
  the newest TypeScript it supports and note it here.
