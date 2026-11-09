# 0002. UI framework: React 19 with React Aria Components

- Status: accepted (Tarık, 9 Nov 2026)
- Date: 2026-11-09

## Context

PlainSpice must meet WCAG 2.2 AA from day one: everything by keyboard, screen-reader
descriptions, high-contrast and large-text modes, reduced motion. The first app is
netlist-first (an editor, explanations, trap checks, results, plots); later comes an SVG
schematic editor kept in sync with the netlist both ways, and a Turkish UI. It is maintained by
Tarık and Claude-run sessions, and should attract student contributors.

## Options measured

Seven candidates were built as the same small app (heading, counter, list, accessible tabs; then
a full widget kit: tabs, dialog, menu, disclosure, toggle, combobox, tooltip, toast) with Vite 8
and TypeScript, checked with axe-core 4.14 and Chromium's accessibility tree, and timed at 6x
CPU slowdown (median of 15 cold loads).

| | Widget kit, JS gzip | Ready at 6x CPU, first visit | Accessibility kit | Notes |
|---|---|---|---|---|
| **React 19.3 + React Aria Components 1.22** | 142.6 kB (133.4 kB with en-US + tr-TR only) | 725 ms (about 250 ms on repeat visits) | deepest: Adobe's screen-reader test matrix, announcements in 34 locales including Turkish, drag-and-drop and keyboard-move hooks | type-checks with TypeScript 7 |
| Svelte 5.57 + Bits UI 2.20 | 71.9 kB | 307 ms | good widgets, no announcement strings; compiler a11y warnings | svelte-check needs TypeScript ≤ 6 |
| Vue 3.5 + Reka UI | 71.4 kB | 355 ms | good | vue-tsc needs TypeScript < 7 |
| Preact 11 + Zag | 69.7 kB | 219 ms | React Aria crashes on Preact 11 (`createElementNS`) | |
| SolidJS 1.9 + Kobalte | 53.1 kB | 338 ms | Kobalte's tab panel has no name | Solid 2 / Kobalte 2 migrations imminent |
| Lit + Web Awesome | 74.0 kB + CSS | 349 ms | shadow DOM drops cross-root `aria-labelledby` (only Chromium has a fix) | tab list cannot be named |
| no framework | smallest | fastest | every widget hand-written and hand-tested | |

Weighted score (Tarık's priority order): React 4.21, Svelte 4.11, Vue 3.86, Preact 3.71,
Solid 3.46, vanilla 3.14, Lit 2.82. React and Svelte were close; accessibility depth decided.

## Decision

**React 19 with React Aria Components**, with these rules to keep its cost bounded:

- The model is plain TypeScript with no React imports: netlist parser, trap checks,
  explanations, results, share links, export, and later the schematic model and undo history
  (`src/spice/`, `src/engine/`, `src/share/`, ...). React only renders.
- CodeMirror 6 is mounted imperatively; the netlist text never lives in React state.
- Only en-US and tr-TR strings ship (`@react-aria/optimize-locales-plugin`).
- Dialogs, menus, combobox and toasts are lazy-loaded; plots load only when there are vectors.
- Lint with Oxlint's jsx-a11y rules; axe runs in Playwright on every main state.
- A Turkish speaker reviews React Aria's tr-TR strings before the Turkish UI ships (one plural
  is already known to be wrong: "3 seçenekler" should be "3 seçenek").

## Consequences

- About 70–90 kB more JavaScript than Svelte, and about 0.4 s more start-up on a slow phone's
  first visit (0.1 s on later visits; the PWA cache helps).
- Fine-grained updates matter for the schematic editor: dragging one part costs 0.3–1.5 ms per
  step with memoised React at 50–1000 parts (Svelte: under 0.1 ms). Fine at classroom scale; the
  editor's hot path can use refs or direct SVG updates if needed.
- TypeScript 7 works for the whole project (no svelte-check/vue-tsc constraint).
