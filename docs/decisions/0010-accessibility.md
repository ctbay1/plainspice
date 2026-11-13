# 0010. Accessibility baseline: WCAG 2.2 AA from day one

- Status: accepted
- Date: 2026-11-09

## Decision

PlainSpice targets **WCAG 2.2 level AA** in every release, checked automatically (axe-core in
Playwright) and by hand. Concretely:

- **Keyboard:** everything works without a mouse; the tab order follows the page (Run comes
  before the editor; Tab leaves the editor); visible focus everywhere (2.4.7, 2.4.11 not
  obscured); shortcuts are listed and never single printable keys without a modifier (2.1.4);
  dragging always has a button alternative (2.5.7); targets at least 24 × 24 px (2.5.8), 44 px
  for main buttons.
- **Screen readers:** landmarks and headings; React Aria widgets (tabs, dialogs, menus,
  toggles) for correct roles and keyboard patterns; results in real tables with captions; a
  polite live region announces "Simulation finished …" and errors; the circuit and its results
  are also described in words (`src/spice/describe.ts`); numbers are spoken with units in words
  ("minus 6 volts"); decorative canvases and inline widgets are hidden from screen readers
  because the same information is in the tables.
- **Colour:** text contrast at least 4.5:1 and UI parts 3:1 in every theme (tested); node and
  plot colours from colour-blind-safe palettes (tested by simulation for protanopia,
  deuteranopia and tritanopia), and never the only signal: names, icons, dashes and markers too.
- **Modes:** high contrast (a toggle, and `prefers-contrast: more`), forced colours (Windows
  High Contrast keeps working), large text (125 % and 150 %, everything sized in rem; reflow at
  320 px without horizontal scrolling, 1.4.10), reduced motion (a toggle and
  `prefers-reduced-motion`: no animations or smooth scrolling). Settings are remembered on the
  device.
- **Language:** plain words a first-year student can follow; one word for one idea; `lang`
  attributes; strings in catalogs so a Turkish UI can follow.
- **Phone:** works at 320 px wide and with touch; no feature needs hover.

## Consequences

- Every pull request runs axe on the main states; a violation fails CI.
- Manual checks before each release: keyboard-only walk-through, NVDA + Firefox, VoiceOver +
  Safari (macOS and iOS), TalkBack + Chrome, 200 % zoom, Windows High Contrast. These need people
  and devices; they are in the plan.

## After the final reviews (12 November 2026)

The second re-check of the merged build found the polite region silent where a screen reader needs it
(AP-3, WCAG 4.1.3: the status line's "Running…" and "Finished in 35 ms" are in no live region, so the
announcement is how a run's end is heard). The words were not said twice in a row, and the guard
compared only the spoken summary: a run the student asked for on an unchanged circuit was never said,
and neither was a value changed in a `.dc` or `.tran` circuit, whose summary gives only its number of
points ("a DC sweep of 13 points"). Now (`src/app/App.tsx`, the results announcement; `live.ts` keeps
on a run's outcome whether Run asked for it):

- **A run Run asks for is always said**: the Run button, Ctrl+Enter, Ctrl+K's "Run ngspice now", a link
  that runs, and a Run that waited for the run before it. In the words its results give, the same words
  when they are the same; never "the same results", which is false for a sweep whose numbers changed
  while its words did not (the reviewer's "Finished in N ms, the same results" was not taken).
- **A run after a change is said when its results changed**, compared number by number as the words say
  them: every node, every current, the `.tf` ratios and each sweep, not only the summary, which counts
  the currents and gives a sweep its points. A comment typed (the same numbers) says nothing, as before;
  the first run of a circuit opened is always said.
- **A sweep's spoken summary also says its last point**, in the words its results card on the paper
  says it: "Simulation finished: a DC sweep of 13 points. When V1 is 12 volts: the voltage at node in
  is 12 volts, the voltage at node out is 6 volts, the current in V1 is minus 6 milliamps." A sighted
  student sees the card's numbers change; the operating point's summary already says the first four
  node voltages. The numbers are ngspice's, at the point facts A7 (`.dc V1 0 12 1` ends at 12 V) and
  A16 (a `.tran` ends at its stop time) give. Only the spoken summary changes: the Numbers panel's
  written summary keeps its words, beside the card that shows the last point.
- **The last point is said as the operating point's nodes are: its first four values, then how many
  more** (`DESCRIBE_STRINGS.summaryValues`, as `summaryNodes` says "and 1 more node"). The critic of
  these fixes heard all 8 values of a six-stage RC ladder (`.tran 10u 2m`) after every change and every
  Run, where a five-node `.op` said four and counted the rest: two rules for one thing. Now: "Simulation
  finished: a transient to 2 milliseconds, 228 time points. At 2 milliseconds: the voltage at node in is
  5 volts, the voltage at node n1 is 4.526 volts, the voltage at node n2 is 4.079 volts, the voltage at
  node n3 is 3.686 volts and 4 more values." (native ngspice 47 and 42 alike: 228 points; at 2 ms v(n1)
  = 4.525632, v(n2) = 4.078858, v(n3) = 3.685655). The results card, the Numbers panel and their words
  for screen readers keep every value (`SweepWords.speech`); only the live region, said after each run,
  is cut, and its first four are the ones the card lists first. Considered: only the values that changed
  since the last announcement, which says a different set each time and nothing of the ones that stayed.

Tests (`tests/unit/app-smoke.test.tsx`) count the paragraphs the polite region gets, as they come: a
paragraph stays there for 10 s, so a check of the region's words passes on the one from before. Start
here, then Run, then Ctrl+Enter: two more (none on the merged build); a comment typed: none. The DC
sweep example with R2 changed to 1k: one more, with v(out) = 6 V (none on the merged build); then Run:
one more. The numbers the words do not say each have a test that fails without them (the critic of these
fixes: the DC sweep's test passes on its words alone): R3 changed in a divider, only the currents moving
(v(in) = 6 V and v(out) = 4 V either way, i(v1) −8 mA then −5 mA in native ngspice 47 and 42), and R6
changed in a five-node circuit, only the fifth node moving (5 V then 7.5 V), are each said once in the
same words, and silent without `resultsHeard`; Start here opened again from the menu is said again, and
silent without the circuit opened in the key (`circuitKey`). `tests/unit/sweep-end.test.ts`: a sweep of
six values says four and "2 more values", its words for the panel all six (all six said on the previous
fix).

In the browser (1280 × 800, every live region watched): Start here's Run, Ctrl+Enter with nothing and
with R2 focused, Ctrl+K's "Run ngspice now" and Run twice after a change are each said once (b060bc8:
none of the six); a value changed on a card is said once, as before. The DC sweep with R2 at 1k is said
with v(out) = 6 V and Run says it again; the 120,001-point sweep, whose live runs wait for Run, is said
after each Ctrl+Enter, the second time with 6 V (b060bc8: the second not at all); RC charging with R1 at
2k is said with v(out) = 4.589 V and −205.3 µA at 5 ms (native ngspice 47: 4.58947 V and −2.05263e-04
A), and again for Run (b060bc8: neither).
