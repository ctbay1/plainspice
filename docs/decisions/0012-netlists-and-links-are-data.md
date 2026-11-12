# 0012. Netlists and links are data, never code

- Status: accepted
- Date: 2026-11-10
- Evidence: the security and robustness review of 10 November 2026 (findings M1 to M5, m1 to m8)

## Context

Every Solved Circuits video will carry "Open this circuit" links, and anyone can make a link that
holds any text (decision 0008). A link is opened with one click, often on a phone, sometimes with
`run=1`. The same netlists also run outside the browser: in the golden tests, the scripts and any
future check of episode netlists in CI.

## Decision

A netlist, whether typed, pasted or opened from a link, is treated as untrusted data:

- **Never HTML.** The netlist goes only into the editor (as text) and the engine (as a file);
  nothing from it or from a link is put into the page as HTML. A Content-Security-Policy on the
  app page (a `<meta>`, since GitHub Pages sets no headers) allows only the site's own scripts,
  WebAssembly compilation and one hashed inline script, as a second line of defence.
- **Never a program.** ngspice's `.control` blocks run, but `system()` refuses in every
  environment (`engine/no-system.js`), so `shell` and `gnuplot` cannot start anything, in the
  browser or under Node.
- **Bounded work.** Links are limited before and after unpacking (32,000 characters, 256 kB of
  text). The app draws at most 50 checks of each severity and underlines at most 200 in the
  editor; no step of parsing, checking or explaining grows with the square of the netlist's
  length any more (a 25,000-line link opens in about a second);
  ngspice's output is kept up to 1 MB per stream; a run stops after 20 s.
- **Never the student's work.** Opening a link or an example shows that circuit without
  replacing the netlist the student saved: the opened circuit is saved, and the link leaves the
  address bar, only when the student edits it.

## Consequences

- A `.control` loop that prints forever runs until the 20 s time-out (with flat memory): an
  earlier stop would need a change inside the engine.
- Styles need `'unsafe-inline'` in the policy (CodeMirror and React Aria set styles), and the
  inline preload script must keep its hash in step: `vite.config.ts` computes it at build time.
- Native ngspice has no such guard: record only netlists you trust with `scripts/record-native.ts`.
- Resolved on 10 November 2026: the site has its own origin, `https://plainspice.com/`, so its
  local storage and the service worker's caches are no longer shared with the account's other
  GitHub Pages sites (the old `ctbay1.github.io` address only forwards).

## After the final reviews (12 November 2026)

- **The same policy on every page of the site** (security review F3). The engine check, the
  licences page and the design pages (Tarık's three prototypes, the lab, the checkpoint) had no
  policy, though they run on the app's origin, next to the student's saved netlist and settings, and
  the prototypes write HTML with innerHTML (no injection was found: they escape or only test what a
  link gives them). Each now carries the app's policy without the hash of the app page's inline
  script, which only the app page has; their manifest link is still removed. Under it, two small
  symbol fonts of a prototype, which Vite had put into its CSS as data: URLs (it inlines files under
  4 kB), were refused, so fonts are never inlined (`build.assetsInlineLimit` in `vite.config.ts`):
  they are files like every other font, and the policy stays one for the whole site. Checked: every
  page works under it with no policy violation, clicking every button of the prototypes and the
  checkpoint on a computer and a phone (`tests/e2e/words-review.spec.ts` loads each page). Serving
  the design pages from another origin, the review's other option, was not needed.
- **Bounded work now covers the drawing lines too** (security:F1). A 187-character link that
  repeated one short piece of wire 100 times froze the page for 6 s (25 s on a phone slowed four
  times), and a 575-character one with 1999 repeats for minutes: the wire handling of the schematic
  model joined every piece at a point with every other piece there, and cut dead ends one piece per
  pass over the whole drawing. Now its work grows with the drawing lines and the wire they draw,
  both bounded by the format (2000 lines, 20,000 grid units, 20,000 points), never with their
  square; decision 0013 says how. The same links now draw in about 0.4 s on a computer (as fast as
  the circuit without the extra lines) and about 1 s on the slowed phone; the reviewer's patterns at
  the format's limits take 20 to 400 ms to build on a developer's machine (they took seconds to
  minutes). The tests build each pattern at the limits (`tests/unit/schematic-format.test.ts`,
  "limits: wire over wire ..."; `tests/unit/schematic-route.test.ts`, "wire over wire ...") with
  limits about ten times what they take on a developer's machine (1 s at 100 lines, 5 s at the
  limits, 2 s for the long chain), so a busy CI machine passes and the old code still fails.
- **Corrected after the critic of the fix round.** "The worst drawings at the format's limits take
  20 to 400 ms" did not hold. A 31 kB link inside the limits, with no ground symbol, a wire through
  every place one could go, and a 9,900-piece square wave of another node, took about 4 s to build
  and kept a phone slowed four times busy for 27 to 31 s: the search for the ground symbol's place
  checked every point of ground's wire against every wire, and the phone then rebuilt the drawing up
  to four times to find no clean turn. Now that search looks only at the wires near each place and
  tries at most 100 places; the phone does not try to turn a drawing of more than 100 parts or 1000
  pieces of wire (decision 0013); and the wire handling indexes and merges each version of the
  copper once, in flat arrays. That link now draws in 0.9 s on a computer (9.8 s on the release
  reviewed, fix-base) and 3.3 s on the slowed phone. A drawing at the limits like it, with tens of
  thousands of grid points of wire, takes about half a second to build on a developer's machine
  (0.8 s the first time), not milliseconds; turning it takes none. Its test allows 5 s for the build
  and 1 s for the turn (`tests/unit/schematic-format.test.ts`, "builds a drawing with a wire through
  every point of ground's wire ..."). An edit on such a drawing rebuilds it about three times: 0.6 to
  1 s here (0.9 to 1.5 s before this round). Separately, a netlist with thousands of parts still lays
  out slowly.
- **The search is guarded by counting its work, not by timing it** (second critic of the fix round).
  A time limit that allows for a busy machine cannot tell the two searches apart: the first fix's,
  which checked every wire for each point of ground's wire, built that link in about 3.4 s, inside
  5 s. `tests/unit/schematic-ground-search.test.ts` counts the checks of a piece of wire through a
  box while building the link and a control (the same link with the ground symbol and its lead
  given, so nothing is searched): the search may add fewer checks than the drawing has pieces of
  wire (9,951). It adds about 370; the first fix's added 48 million.
