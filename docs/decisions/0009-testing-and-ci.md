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

## As built (10 November 2026)

- CI has two jobs side by side: **check** (typecheck, unit, golden and fact tests, the build) and
  **e2e** (the built app served by `vite preview`, 30 Playwright tests on a desktop profile at
  1280×800 and a phone profile, the Pixel 7). The site deploys only when both pass; a failing
  e2e run keeps the Playwright report as an artifact for 14 days.
- The e2e tests type every fixture into the editor and check the tables against the hand values
  and native ngspice 47 (the `.dc` and `.tran` CSVs at every point), and run axe with the
  WCAG 2.2 AA tags in 17 states per profile.
- CI's check job also runs `npm run lint` (oxlint with its accessibility and React rules).
- `vite preview` sends `ngspice.wasm` uncompressed and with `Cache-Control: no-cache`, so local
  load measurements overstate the engine download: GitHub Pages sends it gzipped (about 608 KiB).
- Fonts differ between machines, and layout bugs can hide behind them: the first CI run found a
  lost click at 320 px with large text that only GitHub's wider fonts showed. To try a run with
  fonts like the runners' on a machine with Inter installed:
  `FONTCONFIG_FILE=$PWD/tests/e2e/fonts-like-ci.conf npm run test:e2e`.

## Consequences

- A new ngspice version means re-recording native results with the same version
  (`npm run record:native -- --ngspice <path>`), then the golden tests say what changed.
- `.tran` comparisons need the same ngspice version (time grids differ between 42 and 47).
- Screen-reader behaviour beyond the accessibility tree needs a manual pass with real screen
  readers (NVDA, VoiceOver, TalkBack): listed in the plan.

## After the final reviews (12 November 2026)

Some tests failed only on a busy machine: the checks ran on 4 cores shared with other builds and
tests, at a load of 14 to 25. Each was tried again with busy processes beside it (`node -e
"for(;;){}"`, 6 to 10 of them: load 8 to 20), ten or twenty times before and after.

- **What the page did wrong, fixed in the page**, each with a test that sends the events in the order a
  busy page meets them and fails without the fix (decisions 0016 and 0017): a wire started at the end the
  pointer had left (the Wire tool read the preview drawn for the pointer's last move, which a busy page
  had not drawn yet); the second click of a double click landed on the card that had come to rest under
  the pointer; the service worker answered the design pages with a broken copy of the app. A test is
  never made to wait longer or expect less instead.
- **A test made to wait for what it is about**: the double click's own test sends its second click once
  the card has come to rest; a machine too slow to send it within a double click's time (450 ms) has not
  tried what the test is about, so it tries again, up to five times, and says so if it never could. A
  double click that ended too late to be one is tried again too. The test runs two ways, because the
  page's fix has two parts and one way of running cannot try both:
  - *The second press handled at once* (the page gets to it while the card is still sliding): it guards
    the cause of the failure seen under load, that the move is the first click's doing when nothing came
    between that click and the move, however long the page took (the count of presses and keys). Put back
    the old time limit (250 ms) and it fails 3 of 3; take away the card letting presses through just
    after the move and it fails 3 of 3.
  - *The second press handled late* (the page is busy as it comes in, until a double click's time after
    the move has passed): it guards that a press is judged by when it was made, its own time, not when a
    busy page got to it. Timed by when the page got to it, it fails 3 of 3; without the pass-through, 3 of 3.
  Both also check that R2's card stays open through the double click. With the time limit put back, the
  card closed under the second press and, once the drawing had slid back, a late double click found R2's
  value again and opened the card on it: the second critic of these fixes showed the late way passed
  then. With the check it fails that way too (3 of 3), whenever the page gets to the press.
- **Heavy unit tests have their own time limit**, written next to them with what they cost: those that
  take 0.4 to 1.5 s alone (the converter for each video's drawing, random edits and turns of every
  example, 160 random circuits laid out, 1500 random netlists checked, Node started six times) ran 6 to
  10 times slower at load 16, past vitest's 5 s; at load 20 tests of 0.1 to 0.4 s alone took up to
  15 times as long (the whole app mounted in jsdom: 5.7 s), so those that came near the limit there have
  one too. 30 s each, as the app's own slow tests already had.
- **A speed check times the work, not the wait** (`tests/unit/work-time.ts`): by the thread's own
  processor time where Node counts it (`process.threadCpuUsage`), else the clock, the least of several
  tries taken in turns. By the clock, at load 25 the parser's 10 000 lines came out 30 times slower than
  1 000 (the larger netlist waits for a processor more often), and the trap checks took 740 ms for a
  limit of 500 at load 16. The checks of how time grows with length compare equal work, 10 000 lines at
  once against ten netlists of 1 000, since the processor time is counted in steps of 4 ms; their limits
  are the ones they had (2.5 times, as 25 times one netlist of 1 000). A parser made quadratic in a
  scratch copy fails it (at the limit of 400 ms, or, made only mildly quadratic, by how its time grows).
- **The build checks every link of the built pages** (second re-check, P4). The design index linked
  "both views side by side" to a picture under `docs/`, which is not deployed: GitHub Pages answered
  404, while `vite preview` answers any missing path with the app page (200), so no browser test could
  see it. The picture is now on the page as a figure (Vite emits it under `assets/`, which the service
  worker leaves out of the offline download; under `public/` the offline download would have taken
  its 381 kB) and the words link to it. `scripts/dist-links.ts`, run on `dist/` at the end of every
  build (`vite.config.ts`), resolves every relative `href`, `src` and `srcset` of every page to a file,
  or a folder with an `index.html`, as GitHub Pages serves it, and every `#id` to an id of its page; a
  broken one fails the build. The engine's source tarball may be missing from a build made without it
  (CI fetches it only for the build it deploys, where it is checked like any file). On b060bc8's build
  it finds exactly the picture link (172 links in 9 pages); `tests/unit/dist-links.test.ts` tests the
  check itself, and `tests/e2e/run-copy.spec.ts` the link on the page.

