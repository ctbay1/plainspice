# Plan

*Updated 10 November 2026: milestone 1 is done; milestone 2 (drawing circuits) has started.*

## Done: the first milestone

1. **Decisions** ([docs/decisions/](decisions/)): TypeScript + Vite (0001); React 19 with React Aria
   Components (0002, Tarık); our own pinned, reproducible ngspice 47 WebAssembly build (0003);
   uPlot behind our own accessible plot module (0004); MIT for our code, the engine under
   ngspice's terms (0005, Tarık); the name PlainSpice (0006, Tarık); CodeMirror 6 (0007); share
   links in the URL fragment (0008); tests and CI (0009); WCAG 2.2 AA (0010); for an operating
   point, the copy that runs saves every current (0011); netlists and links are data, never
   code (0012). Research behind them:
   [docs/research/](research/). EEcircuit studied first: [what we do differently](eecircuit-comparison.md).
2. **The engine and the spike**: ngspice 47 compiled to WebAssembly (0.62 MB gzip, the chip-design
   models with other licence terms left out), running in a Web Worker exactly like
   `ngspice -b -r`. **Fixture results** ([fixture-results.md](fixture-results.md)): every vector
   of every fixture agrees with native ngspice 47 to 6 significant figures, and all are bit-for-bit
   identical; `.op`, `.tf` and `.dc` also match Ubuntu's ngspice 42 exactly. **Nothing disagrees
   with the expected values in the brief.** Native ngspice 47 built with the engine's options
   gives the engine's results bit for bit even where an ordinary (XSPICE) build takes different
   time steps. Live: <https://plainspice.com/spike/>.
3. **The netlist-first app**, live at <https://plainspice.com/>:
   - an editor (CodeMirror 6) that reads each line the way ngspice does (the title, comments,
     continuation lines, ground, values), with node colours that are colour-blind-safe and never
     the only signal, and results at the end of each part's line ("3 A, n1 → 0");
   - every line explained as a field table in plain words, and the whole circuit described in words;
   - 36 beginner-trap checks with the why and one-click fixes (`1M`, `3A`, no ground, a node with one
     connection, a current source with no path, duplicate names, unknown first letters, a word
     ngspice stops at, an unknown dot command …);
   - the results in words: node voltages, every current with its direction and each source's power,
     `.tf` results, sweep summaries and ngspice's messages explained; when ngspice's DC solution
     fails, or a check finds an error, the numbers are never shown as answers;
   - plots for `.dc` and `.tran` with a summary, a keyboard cursor, a data table and CSV;
   - share links (the whole circuit in the link), export for ngspice and LTspice, the brief's
     fixtures as examples, text size, high contrast and reduced motion settings, a help dialog, and
     an installable app that works offline.

   Every sentence the app says about how SPICE behaves was run in native ngspice 47 and 42 and in
   our engine first: [docs/spice-facts/](spice-facts/) (numbers and syntax, traps, explanations),
   re-run by the golden tests.

   Five independent reviews followed, and every confirmed finding was fixed with a test: the SPICE
   core ([review.md](spice-facts/review.md), about 20 fixes, checked on 760 netlists including the
   channel's 63 episode netlists), and four reviews of the app: SPICE wording on screen (one
   blocker: numbers shown as answers after an error check; fixed), WCAG 2.2 AA, security and
   robustness ([decision 0012](decisions/0012-netlists-and-links-are-data.md)), and speed on
   phones (the engine is now downloaded once; typing in a 300-line netlist at 4× CPU slowdown:
   median 32 ms, was about 130 ms).
4. **Tests and CI** ([decision 0009](decisions/0009-testing-and-ci.md)): on every push, CI runs
   the typecheck, lint, 1925 unit tests and 1032 golden and fact tests (the engine against native
   ngspice, and every SPICE claim), the build, and 39 Playwright tests on a desktop and a phone
   profile (78 runs, with axe and the WCAG 2.2 AA rules in every main state); the site deploys only
   when all pass. The README screenshot comes from `npm run screenshot`.

## Milestone 2: make PlainSpice look and work like a real simulator (started 10 November 2026)

Tarık's verdict on milestone 1: the engine, the checks and the explanations are great, but it is
a text tool. Milestone 2 keeps everything underneath (engine, checks, explanations, tests,
accessibility, offline use, every share link) and changes how it looks and how it is used:

1. **Design first**: three visual directions for the whole app, desktop and phone, as clickable
   prototypes (the circuit canvas front and centre, a parts toolbar, results drawn on the circuit,
   the netlist, explanations and checks as panels). Tarık picks one.
2. **The circuit drawn from the netlist**: standard symbols, node colours, node voltages at the
   nodes, current arrows with values on the wires, redrawn after each run; automatic layout for
   small circuits; share links can carry exact part positions (a circuit opens drawn as in the
   video).
3. **Live**: re-run automatically as you edit; Run stays for long analyses.
4. **Schematic editor**: place R, C, L, V, I, E, F, G, H and ground; drag, rotate, wire, name
   nodes, edit values in place, undo and redo; the netlist stays in sync both ways; keyboard and
   screen reader.
5. **First screen**: a 6 V source and two resistors, already solved, inviting you to change R1.

Done so far:
- The site moved to <https://plainspice.com/> (Tarık's domain). Links, `make-link`, the README and
  the docs use it; links to the old address keep working (GitHub forwards them, and the
  share-link tests decode both kinds).
- `LICENSE`: "Tarık Bayraktar and PlainSpice contributors".
- **Example library**: the circuits of the four public videos, in channel order (SPICE for
  Beginners, then p01, p02 and e04): 20 netlists in [examples/](../examples/), each crediting its
  video, first in the Examples menu. Each gives the values the channel recorded with native
  ngspice (`tests/golden/examples.test.ts`); the three "mistake" examples show the check they teach.

## Next

- **Real people and devices** (needs Tarık or testers): a screen-reader pass (NVDA + Firefox,
  VoiceOver on macOS and iOS, TalkBack on Android), one real mid-range Android phone, Windows
  High Contrast; Firefox and Safari (only Chromium was available here).
- **LTspice**: open the exported `.net` files in LTspice on Tarık's PC; until then the export says
  "not checked in LTspice yet".
- **YouTube**: paste one "Open this circuit" link (`npm run make-link -- file.cir`) into an
  unlisted video's description and click it on a computer and a phone.
- **"Open this circuit" in the channel's pipeline**: add the links to the upload sheets in the
  solved-circuits repository (`deliver/`), starting with SPICE for Beginners (sp01).
- **Turkish UI**: the strings are in a catalog (`src/i18n/en.ts`); translate them, and have a
  Turkish speaker review React Aria's tr-TR strings (one plural is already known to be wrong).
- **Small known gaps**: the editor colours a word after an R, C or L value as a model name even
  when no `.model` defines it (the check underlines it as an error and explains it; the colour
  would need the netlist's model names inside CodeMirror's line-by-line highlighter); a
  `.control` loop that prints forever runs until the 20 s time-out (stopping it earlier needs a
  change inside the engine).
- **Later, designed for but not built**: AC analysis with Bode plots (log axes); cursors on plots
  for measurements; parameter sweeps (families of curves; the plot module already recognises
  nested sweeps).

## Open questions for Tarık

- Share links have no checksum (decision 0008): fine while links are clicked; worth adding only
  if links will ever be typed by hand.

Answered on 10 November 2026: the address is plainspice.com; `LICENSE` names Tarık; no trademark
registration for now (a quick search found no other PlainSpice); the example library follows the
four public videos in channel order; "Open this circuit" links run at once (`run=1`); "amps" stays.
