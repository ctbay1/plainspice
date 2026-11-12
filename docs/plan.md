# Plan

*Updated 11 November 2026: milestone 1 is done; milestone 2 (drawing circuits): steps A, B and C are done; its final reviews are next.*

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
- **Step B: the schematic editor** (item 4, decision 0017): parts are placed, wired, moved,
  turned, mirrored, reversed and deleted on the drawing, with a mouse, a finger or only the keyboard,
  each change one undo step in the netlist (its `*@` lines), run live and said aloud. What a click
  would do is shown before it: the part in hand with the nodes it would connect to (or why it cannot
  go there), a wire's route, a part dragged with its wires following. After placing, the new part's
  card opens on its value; the first part on a blank page also writes `.op` and `.end`, and says so.
  T turns, M mirrors, Shift+R reverses, Shift+arrow keys move, Delete deletes, W wires, A opens the
  Add a part form; the keys are on the buttons, in the hint line, in Help and in Ctrl+K. Without a
  pointer, the form (a kind, a value, two nodes from lists) and each card's Connections (Connect to…,
  Disconnect) build and rewire a circuit; a node's card renames it, and a name another node has
  makes the two one node. On a phone: the Parts sheet, a tap to see where a part goes and Place, a
  finger held still on a part to drag it, two to zoom, wires by taps, and a turned drawing shown as
  drawn while editing. Start here was built on a blank page with the mouse and again with the keys
  only, and ngspice gives out = 4 V both times (end-to-end tests on a computer and a phone, axe in
  seven editing states).
  Three reviews (interaction, accessibility, the netlist kept in step) then tried it hard, and their
  findings were fixed the same day (decision 0017, "After the reviews of step B"): no edit loses or
  changes the student's text behind their back (a move during typing, moving the ground symbol, the
  folded `*@` lines, Reverse with `gnd`, a part added with the form to a drawn circuit, a drawing
  that would connect other than the netlist); hand-drawn wires stay square; a piece of wire is the
  stretch between junctions; the card's keys act on its part; the focus is never lost after an edit;
  a finger pans unless it holds still on a part; the drawing is an application to screen readers;
  a part moved with the keys stays in view and is said; calmer red pen and pencil numbers while
  building. New tests: `schematic-edit-review.test.ts` (with a seeded run of random edits on every
  e04, p02 and p01 example) and `tests/e2e/editor-review.spec.ts`. A re-check of all three reviews
  on a clean build then found what was still wrong, and that was fixed too (decision 0017, "After
  the re-check"):
  nothing typed or deleted at the edges of the folded `*@` lines goes unseen; pencil numbers are only
  this circuit's and are named on the status line; one rule for the card's keys, badges and hint;
  words after a turn or a move find a free place (22 of 108 turns of the videos' drawings put words
  on something, every turn did before); straight rails; the Wire tool ends where its preview showed;
  a placed controlled source stays marked until chosen; Undo on a phone's status line; a tap is acted
  on once however slow the device (its click was taken again after 400 ms). A last look at
  the words and these documents (12 Nov) made each sentence say what the netlist now has, in one word
  for one idea: a line that still names a deleted part is given by its number after the delete; a
  piece cut off a node names the parts whose ends moved, and deleting the last ground symbol says the
  circuit has no ground; "connect", a part's "end", a node's "name", and "node out" in sentences;
  every refusal says why and what to do (a place on a wire, an F with nothing to read, Delete on a
  node, keys on a piece of wire); the Add a part form checks its value as the card does; the first
  edit made on the drawing says it wrote the `*@` lines; Help and Ctrl+K have every editing key and
  command; key names spelled one way (decision 0017, "After the re-check").
- **Step C: the examples drawn as in the videos** (item 2, decision 0018): all 20 examples open
  drawn the way their videos draw them, with the node names the videos write, and a link made from
  one carries its drawing. The drawings are recorded from the channel's own drawing code
  (`scripts/video-drawings/record.py` parses the episode files and runs only their drawing
  statements; it never imports them), converted to the grid with every change and its reason written
  down (`plan.ts`, `convert.ts`), and checked by the tests: each block is what the converter makes,
  clean, connecting exactly what the netlist connects, every name beside its own wire. Each example
  next to its video, and every change from the video: [`docs/design/video/`](design/video/README.md).
  On a phone, a video's own drawing gets "As in the video" (any other "As drawn"), until the student
  changes the drawing. Two drawing fixes the examples showed: a name on the left of its point is
  drawn up to it (e04-4's "s = 40 V" stood 2 to 5 squares away), and a phone's turned view places
  the names again when one has no room once turned: 12 of the 20 examples open whole on a phone held
  upright, up from 8; p02-4, the checkpoint's circuit, now opens turned but needs dragging (the
  video's drawing is less long and low than the automatic layout's ladder).
- **Next: the final reviews of milestone 2**, then fixes.

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
- **Step B's known gaps**: a piece of wire can be deleted but not dragged; what a controlled source
  reads is chosen from lists, not by tapping the drawing; turning a part in a crowded drawing can
  still put its words on something (22 of 108 turns of the videos' drawings); automatic node names
  keep their numbers when nodes merge (n1, n4); the phone's layout used with a mouse and keys (large
  text on a laptop) gives touch words; a new circuit's title line is `* circuit` (a name for Tarık to
  choose). The drawing is an application to screen readers, which NVDA and JAWS should take as focus
  mode: to be tried with them (above), as are browsers other than Chromium.
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

- **The "b" and the "0" of the videos** (decision 0018): the Thévenin and Norton videos write the
  terminal b at the end of the ground wire, and some write 0 beside it; the drawing format can only
  name ground by its symbol. A label that writes another name (`*@ label 0 x y name=b`) would say it,
  but every link made from then on would carry it, so it is your call. Until then the ground wire is
  b, as in the netlist.

- **Links with drawings are longer**: an example's link now carries its video's drawing, about 200
  characters more (e04's six links: 3,188 characters of a description's 5,000, 1,798 without the
  drawings). Links already in descriptions keep working, laid out automatically.

Answered on 10 November 2026: the address is plainspice.com; `LICENSE` names Tarık; no trademark
registration for now (a quick search found no other PlainSpice); the example library follows the
four public videos in channel order; "Open this circuit" links run at once (`run=1`); "amps" stays.
