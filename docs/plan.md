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
- **Three design directions**, clickable on desktop and phone, all running real ngspice:
  <https://plainspice.com/design/> compares Notebook (the channel's paper look), Studio (a dark
  pro tool) and Playground (a light, hand-drawn whiteboard). Each was designed, critiqued by a
  second designer and refined. **Tarık chose Notebook** (decision 0014), with Playground's named
  parts toolbar and hint line, Studio's Ctrl+K and status line, and a plain-font setting; part
  positions live in the netlist, folded away (decision 0013).
- **The Notebook canvas** (`src/notebook/`, decision 0015): any netlist drawn from the schematic
  model in the chosen look, with the results written on it, solved live. **Checkpoint for Tarık**:
  <https://plainspice.com/design/checkpoint/> shows it on p02's dependent-source circuits (G1 and
  F1), on a computer and a phone. **Tarık approved it on 11 November ("Build the rest")**; phones
  open a wide drawing turned to fit, with "As in the video" one tap away.
- **The schematic model** (`src/schematic/`, decision 0013), which every direction needs: the
  circuit drawn from its netlist with a textbook-style automatic layout (all examples:
  <https://plainspice.com/design/lab/>), the drawing format, the edit operations for the
  schematic editor, and keyboard and screen-reader navigation; 900 tests.
- **Example library**: the circuits of the four public videos, in channel order (SPICE for
  Beginners, then p01, p02 and e04): 20 netlists in [examples/](../examples/), each crediting its
  video, first in the Examples menu. Each gives the values the channel recorded with native
  ngspice (`tests/golden/examples.test.ts`); the three "mistake" examples show the check they teach.
- **Step A: the app in the Notebook look** (decision 0016): the app at <https://plainspice.com/> is
  now the drawing first, solved by ngspice as you edit (items 3 and 5 above). One netlist text with
  one undo history behind the drawing and the Netlist panel; live runs a moment after each change,
  never two at once, paused (with the reason on the status line) for slow runs and very long
  `.tran`s; the panels (Netlist on the dark screen with the drawing lines folded, Checks, Explain,
  Numbers, Plot, ngspice output) open when wanted; Ctrl+K reaches every command; the first screen is
  Start here, already solved, inviting a change to R1. Every feature of the first app is kept, and
  the tests follow it (unit, jsdom with the real ngspice, and end to end on a computer and a phone,
  axe in every main state).
- **Step A, reviewed** (design, accessibility, and "is everything kept"; fixed on 11 Nov): a part's
  card now types into the netlist without ever leaving stray words behind, keeps a value SPICE cannot
  read in the field with the checks' reason and fix ("4,7k" → "Write 4.7k"), and Put back restores
  the line exactly; an undo or redo onto an example never overwrites the student's saved netlist;
  Run is not Stop while ngspice downloads, and a run=1 link runs however long; old numbers are
  marked as old (in pencil, and "Before your last change" for screen readers); links and exports
  carry the netlist exactly as written; the drawing follows the Text size setting, the card never
  covers the numbers (docked below the drawing when no side has room), larger text keeps the title,
  the tools and the tabs reachable, a phone on its side or 400 % zoom gets the phone's layout, and
  Windows High Contrast in a dark theme shows the drawing; traps are read out with each part;
  "This line" is back under the netlist; the empty netlist, a part ngspice leaves out, and the Plot
  panel say what is going on.
- **Next: step B**, the schematic editor (item 4): place, move and wire parts with the toolbar;
  until then the part tools say plainly that placing comes in the next update.

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
- **Step A's known gaps** (from the reviews, not done this round): the model's own sentences say
  units as symbols ("a 1 kΩ resistor", read "omega" by some screen readers) and "the ngspice output
  tab"; both are in src/spice and src/schematic and need a spoken variant there. Text-spacing
  overrides (WCAG 1.4.12) can make a result touch its arrow on the drawing. Netlist and another
  panel side by side on wide screens. The Plot panel is drawn again each time it opens.
- **Small known gaps**: the editor colours a word after an R, C or L value as a model name even
  when no `.model` defines it (the check underlines it as an error and explains it; the colour
  would need the netlist's model names inside CodeMirror's line-by-line highlighter); a
  `.control` loop that prints forever runs until the 20 s time-out (stopping it earlier needs a
  change inside the engine).
- **Later, designed for but not built**: AC analysis with Bode plots (log axes); cursors on plots
  for measurements; parameter sweeps (families of curves; the plot module already recognises
  nested sweeps).

## Open questions for Tarık

- **"Nothing after .end counts"**: ngspice does read a part written after a plain `.end` (fact S25,
  re-run on 11 Nov in native ngspice 47 and 42: with `R2 n1 0 2` after `.end`, n1 drops from 2 V to
  1 V); only `.end;…` with a comment glued on stops it. So the explanation says "the parts go
  before .end" as advice, and the after-end check explains what happens otherwise.

- Share links have no checksum (decision 0008): fine while links are clicked; worth adding only
  if links will ever be typed by hand.

Answered on 10 November 2026: the address is plainspice.com; `LICENSE` names Tarık; no trademark
registration for now (a quick search found no other PlainSpice); the example library follows the
four public videos in channel order; "Open this circuit" links run at once (`run=1`); "amps" stays.
