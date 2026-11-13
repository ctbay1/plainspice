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
- **Corrected after the second re-check: bounded work covers the whole drawing, not only its wires**
  (P2 and P3). "Its work grows with the drawing lines and the wire they draw ..., never with their
  square" held for the wires only. A 542-character link that puts 60 parts at one point froze a
  computer for 1.4 s and a phone slowed four times for 6 s, and each key typed on a card for 1.5 to
  3.5 s; with 1900 names piled there too (a 1007-character link), 37 to 47 s on a computer and 164 s
  on the phone. On a slanted lattice at the format's limits (a 30 kB link), every hover, click and key
  cost 0.6 to 2.3 s of drawing, and opening it 5.5 to 6.5 s on the phone. Decision 0013 says how
  building and drawing are bounded now: reconcile's first step, the names and ground symbols piled at
  a point, the render, and the places tried for a card or a note. A key typed on a card also builds
  the drawing once, not twice: the page takes the schematic `keepDrawing` built to tell whether the
  new value would move a part (`schematicOf`, `src/app/card-edit.ts`).

  Corrected after the critic of these fixes: the budget first written here did not hold. Long
  slanted wire far from 60 parts piled at one point (159 pieces of 62 × 62) was checked by every
  place tried for every part, and the routes that joined the parts again went through all the wire
  for each route: 1 s to open or for each key on a computer and 3.5 to 5.8 s on the slowed phone,
  where the parts alone took 0.25 s. And every key typed on a card built the piled lines again. Now
  a piece of wire is filed where it runs (decision 0013), the routes keep the islands up to date and
  look only near themselves, a value typed on a card where the lines pile parts writes where the
  parts are drawn without building the pile again (`keepDrawing`), and an undo or a redo draws a
  text the page has just built without building it again. The budget below is for every shape the
  reviewers, the skeptics, the critic and this lane built inside the limits, each named in
  `tests/unit/schematic-shapes-work.test.ts`.

  The budget at the format's limits (2000 drawing lines, 20,000 grid units and points, 60 parts
  drawn, a 32,000-character link, or saved work as large), as the page's longest task on a computer
  and on a Pixel 7 slowed four times (corrected after the critic of the second round of these fixes,
  below):
  - opening: up to about 1 s on a computer and 4.5 s on the slowed phone (the heaviest, 60 parts
    piled in a slanted lattice of 70 × 70 points round or through their pins: 0.9 to 1.0 s and 4.0
    to 4.2 s; the 542-character link that P3 reported: 0.2 s and 1.3 s);
  - a hover, a selection or the focus ring: no long task; a click on a part with its card placed: up
    to about 0.1 s;
  - a key typed on a card: one build, of the text it writes (where crafted lines pile parts, the first
    key builds once more, the text the drawing shown would make, to check it); up to 0.45 s on a
    computer and 1.4 s on the slowed phone on the heaviest wire, which every build goes through; where
    the lines pile parts, the drawing shown is written and the pile not built again (up to 0.25 s and
    0.75 s, beside a 99 × 99 grid), unless it cannot be (more wire than a reading takes, names the
    repairs left without their wire, slanted wire they draw again when they read it): then each key
    builds the pile again, as an opening does, up to 0.8 s and 2.7 s; an undo of the card's change: no
    build;
  - an edit made in the drawing (move, turn, mirror, wire, delete, rename, disconnect, a name moved):
    two to four builds of what the edit writes (the lines as the page shows them, so a pile no
    longer), up to 0.5 s on a computer and 1.8 s on the slowed phone, and its undo no build; an edit
    whose drawing would need more lines or more wire than a reading takes is refused, in plain words,
    never written in part.
  The tests count the work, so they hold on any machine (decision 0013 lists them).

  Measured on 13 November on the shared machine at a load of 0.4 to 1.5 (3 for the keys on the
  lattice round the parts), this build first and the build re-checked (b060bc8) in brackets
  (computer: 1280 × 800; phone: Pixel 7 slowed four times; the page's longest task each time):
  - the 542-character link: on a computer opening 0.24 s (0.74 s), two keys no long task (0.64 and
    0.56 s, then 0.60 and 0.55 s), an undo no long task (0.58 s); on the phone opening 1.35 s, keys
    0.16 s at most;
  - the critic's long slanted wire with the 60 parts (a 1,557-character link): opening 0.26 s
    (1.81 s), keys and undo no long task (1.73 and 1.70 s, then 1.64 and 1.55 s; undo 1.69 s); phone
    opening 1.45 s (the critic measured 7.4 s on the build re-checked), keys 0.15 s;
  - with 1650 ground symbols in a block round the parts too (6,897 characters): opening 0.46 s
    (2.94 s), keys 0.08 and 0.06 s (3.07 and 2.94 s, then 3.03 and 3.09 s), undo no long task
    (2.71 s); phone opening 2.38 s, keys 0.29 s at most (the critic measured 5.3 to 5.8 s on the
    first fix); with 1650 names instead (10,127 characters): 0.40 s (10.1 s), keys no long task;
    phone 1.79 s, keys 0.16 s;
  - the 60 parts with their own nodes among the ground symbols and the long wire: 0.68 s (2.78 s),
    keys 0.09 and 0.05 s (3.01 and 2.84 s); phone 2.11 s, keys 0.39 s;
  - turning, moving and deleting a part with the keys on these piles and the lattices: 0.06 to
    0.34 s each on a computer, each undo no long task; on the phone 0.12 to 0.95 s, measured at a
    load of 13 to 14;
  - this lane's own: 115 routes beside a 70 × 70 grid (29,137 characters): 0.59 s (2.73 s), keys
    0.09 s (2.28 and 1.95 s); beside a 99 × 99 grid kept as saved work (160 kB): 0.74 s (3.57 s), keys
    0.12 s (3.27 and 3.28 s), an undo 0.42 s (the editor taking back the whole drawing block); the
    parts inside a slanted lattice that touches none of them (30,174 characters): 0.68 s (2.95 s),
    keys no long task (2.97 and 2.75 s); a lattice hanging from V1's pin: 0.65 s (3.59 s), keys
    0.17 s (2.81 and 3.33 s); on the phone these open in 3.0 to 3.8 s, and take a key in 0.55 s at
    most;
  - the heaviest wire, which every build goes through (no pile): the first critic's 31 kB wave opens
    in 0.43 s and takes a key in 0.44 s; the 100 × 100 grid kept as saved work 0.50 s and 0.28 s;
    the slanted lattice (29,278 characters) 0.53 s and 0.18 s, a hover no long task (0.42 s), a
    click 0.10 s (1.22 s), Escape 0.05 s (0.56 s); on the phone they open in 1.7 to 2.1 s and take a
    key in 0.7 to 1.3 s, and a tap on the lattice makes no long task;
  - a build in Node, the process's CPU time, best of three at a load of 0.7 to 1.9: the 542-character
    link 0.13 s (0.18 s on the first fix of this round), the critic's shapes 0.12 to 0.44 s (0.88 to
    1.73 s), this lane's heaviest 0.47 to 0.95 s (0.59 to 3.36 s).

  Where crafted drawing lines put parts on other nodes' pins (the build moves ten parts or more, or
  any on a drawing of a thousand pieces of wire or more), the first value typed on a card writes the
  drawing the page shows in place of the lines: the parts where they are drawn, and the wires, names
  and ground symbols the repairs drew. Every build of such lines moves the parts again whatever the
  value, and the card builds each key from the text it opened on, so without it each key and each
  visit built the pile again. The lines are written only when a reading takes them all and reads them
  back as the drawing shown, which the first value checks by building the text it writes (the page
  then draws that build); otherwise each value changes only the value. This is the card's rule of
  decisions 0016 and 0017 widened by one case, recorded there: a value changes only the value, unless
  the new value would move a part, or crafted lines pile parts that every build moves. A student's own
  drawing never has so many moved, so there it changes only the value. Put back gives the text the
  card opened on, exactly. The lines of parts and nodes the netlist does not have yet stay as
  written, as decision 0013 says (writing the drawing for a value that would move a part dropped them
  too, before this round). The page keeps the last four schematics it built and the one a card opened
  on while it types, so an undo or a redo of a card's change builds nothing.

  Corrected after the critic of the second round of these fixes (D5 to D7). The rule above wrote the
  drawing shown without reading it back. On 60 parts piled beside a 70 × 70 grid, the first value
  typed wrote 4,921 lines: a reading stops at 2000, so most of the grid vanished (wire elements in the
  page went from 4,869 to 108); 900 names the repairs had left where they took their wire away were
  dropped when read; a slanted lattice through the parts' pins was drawn again, differently; and
  beside a 99 × 99 grid the repairs draw 20,077 grid units, more than a reading takes. The build
  re-checked drew those links unchanged. It also reached a student's own circuit: a divider whose two
  resistors meet pin to pin, after a node renamed in the text moved one, had the repaired drawing
  written over its lines by the first value typed, and Put back no longer gave the text it opened on.
  An edit made in the drawing lost wire the same way, older than this lane: it writes a line for each
  piece of wire, and a joined grid typed in 140 lines is 4,770 pieces, so a part moved beside it kept
  the first 2000 lines and dropped a third of the grid. Now the lines are chained when a line for each
  piece would be more than a reading takes, and read back exactly as before (decision 0013); an edit
  whose drawing still does not fit is refused; a value writes the drawing shown only on crafted lines
  and only when it fits and reads back as shown, and a value that would move a part writes its lines
  only when they fit. So the keys measured above on the parts inside a slanted lattice (no long task)
  wrote lines a reading cut short; they now build the pile, as below.

  Measured again on 13 November at a load of 0.7 to 2.8, this build first and the build re-checked
  (b060bc8) in brackets, the page's longest task:
  - the 542-character link: on a computer opening 0.21 s (0.92 s), keys no long task (0.65 and
    0.56 s, then 0.57 and 0.54 s), an undo no long task (0.65 s); on the phone opening 1.26 s, keys
    0.21 and 0.08 s, an undo no long task;
  - 60 parts piled beside a 70 × 70 grid (a 29,113-character link): opening 0.57 s (2.61 s), keys
    0.16 and 0.10 s (2.31 and 2.09 s, then 2.01 and 2.08 s), the picture and the Checks as before the
    key, 293 lines written; on the phone 2.28 s, keys 0.49 and 0.30 s; a part deleted 0.18 s, on the
    phone 0.92 s, its undo under 0.1 s;
  - with 900 names on stubs instead (a 10,597-character link, the value written alone): 0.45 s
    (2.35 s), keys 0.27 and 0.18 s (2.25 and 2.24 s, then 2.01 and 2.01 s); phone 1.74 s, keys 1.10
    and 0.79 s;
  - 60 parts in a slanted lattice of 70 × 70 points through their pins, and round them without
    touching (30,141-character links, the value written alone): opening 0.98 and 1.0 s (4.73 and
    4.28 s), keys 0.53 to 0.79 s (3.66 and 4.32 s, then 3.32 and 3.88 s; 3.59 and 3.79 s, then 3.73
    and 3.73 s), an undo no long task (3.27 and 3.90 s; 3.39 and 3.90 s); on the phone opening 4.0
    and 4.2 s, keys 2.4 to 2.7 s;
  - beside a 99 × 99 grid kept as saved work: 60 parts piled (the drawing shown does not fit, the
    value written alone) open in 0.75 s and take keys in 0.51 and 0.55 s, on the phone 3.3 s and 2.0
    and 1.7 s, and an edit whose drawing still does not fit is refused (a part deleted); nine parts
    (the drawing written) 0.63 s, keys 0.21 and 0.15 s, on the phone 2.27 s, keys 0.68 and 0.51 s;
  - the 100 × 100 grid kept as saved work, every unit of it now written in 205 lines: R1 turned in
    0.49 s, deleted in 0.26 s, each undo no long task; on the phone turned in 1.72 s;
  - a student's divider whose renamed node moved R2, and nine and eleven parts at one point: keys no
    long task on a computer, at most 0.05 s on the phone; the divider and the nine parts keep their
    lines as written, the eleven parts get the drawing shown;
  - a value typed on every piled shape the critics and this lane built (57 shapes, Node CPU at a load
    of 2.4 to 2.6): the picture stays on all, Put back gives the opened text on all, no text has more
    than 2000 drawing lines; the drawing shown is written on 42 (keys 0.005 to 0.47 s), and on the 15
    others each key is one build of the piled lines, up to 1.05 s on the lattices and 0.07 s on the
    small piles.
- **Characters that are not what they look like** (security review F2). Text copied from a web page
  or a PDF can carry invisible characters, and a phone or another keyboard can type a letter from
  another alphabet that looks like a scale letter. ngspice reads bytes and writes each byte outside
  printable ASCII as `_` (W16), so `1<zero-width space>k` is 1 Ω and `1к` (Cyrillic) is 1 Ω while the
  netlist reads 1k; a node name with an invisible character is another node. The checks
  invisible-character and look-alike-letter (`src/spice/traps.ts`, `src/spice/characters.ts`) flag a
  value only when its reading changes once the invisible characters are removed and the look-alikes
  written as the letters they look like, so `1kΩ`, a Turkish node name or a zero-width space after
  the scale letter is no trap; they say what ngspice reads and offer the plain value ("Write 1k").
  Invisible means U+00AD, U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+2066–U+2069 and U+FEFF; the
  look-alikes are the Cyrillic and Greek letters that look like Latin ones, the fullwidth letters and
  digits, a minus sign, dashes and the Kelvin sign (the Greek mu keeps its own check). A node name with
  an invisible character gets a fix that takes it out, which joins it to the node of that name when
  there is one, as was meant, so no fix reads "Rename out to out". The words never show such a
  character: they name it ("a zero-width space (U+200B)"), in the checks and in Explain, and the
  netlist editor shows it as a dot with that name (CodeMirror's highlightSpecialChars, with the set
  above added). ngspice's own messages are quoted with its spelling ("unknown parameter (y__k)").
  What the checks say of each kind was run: letters from other alphabets (look-alike-letter-1), and
  the Kelvin sign, fullwidth digits and full stop, minus signs and dashes (look-alike-letter-3), each
  said in a whole sentence ("The value has a minus sign (U+2212), which looks like -.").
- **Characters that look like a space but are none for SPICE** (critic of the fixes above). Documents
  write a thin or narrow no-break space between a number and its unit (`4.7 kΩ`) and between groups
  of digits (`10 000`); Chinese and Japanese input gives the ideographic space. ngspice splits words
  only at ASCII white space (a space, a tab ...), so it reads these as part of the word: `4.7<thin space>kΩ` is 4.7 Ω and
  `10<thin space>000` is 10, without a message (space-character-1 to -3; the no-break space does the
  same, nbsp-2). The check space-character covers U+1680, U+2000–U+200A, U+202F, U+205F and U+3000;
  the no-break space U+00A0 keeps its own check, nbsp, which now reads a value the same way. A value
  word is read the way documents write values (`spacedValue` in `src/spice/characters.ts`): a number,
  the space, then a scale letter and a unit, or groups of three digits; a lone a or f after the space
  is a unit (amps, farads), as space-before-suffix reads it. It is flagged only when that differs from
  what ngspice reads (`4.7k<thin space>Ω` is still 4.7 kΩ, space-character-6), with a fix that writes
  the value for SPICE, `4.7k` or `10000`, never just the space taken out, which would turn `2 A` into
  `2A`, 2 attoamps. After a capital M, mega in a document and milli in SPICE, the fixes are
  "Make it 1meg" and "Keep milli: write 1m", as mega-as-milli offers them. Elsewhere on a line such a
  character glues two words into one (space-character-4, nbsp-1): a warning that names it, with the
  fix "Replace it with a normal space". A value that starts with one is an error (space-character-5).
  The words name the character ("a thin space (U+2009)"), in the checks and in Explain, and the
  netlist editor shows it, the no-break space too, as a dot with that name.
- **A capital M that is no M** (critic of the fixes above). A Greek capital Μ (the M key of a Greek
  keyboard), a Cyrillic М or a fullwidth Ｍ looks like M, which is milli in SPICE; a student who types
  one means mega. So for those look-alikes the check offers "Make it 10meg" first for a resistor or a
  gain, and "Keep milli: write 10m", as mega-as-milli does, never "Write 10M", which that check would
  then flag. A small м stays m, milli.
- **A look-alike letter in a node name** (critic of the fixes above). `оut` with a Cyrillic о is the
  node __ut for ngspice, not out (look-alike-letter-5). When a node name is a Latin word with such
  letters in it, the look-alike-letter check names the letter ("The node оut has the Cyrillic letter
  о") and its fix writes the plain letters: "Connect to out" when a node out exists, as the
  invisible-character check does, else "Rename оut to out". A name with no Latin letter (α, Ом) is
  meant as written and stays the non-ascii-node check's, whose fix still gives a plain name (n1); a
  name with a Turkish letter too (çоk) stays that check's, and its fix writes the look-alike plain
  (cok, not ck). An invisible character right after a sign is said where it is, the place first:
  "Right after the -, it has a zero-width space (U+200B)" (invisible-character-6); after the critic of
  round 2, a look-alike there too: "Right after the -, it has the fullwidth digit ５, which looks like 5"
  (look-alike-letter-6), where "which looks like 5 right after the -" read as if the 5 were.
- **Groups of digits with a unit, and no split inside a value** (critic of round 2). Documents write
  `10 000 Ω`, `4 700 Ω` and `1 000 µF` with a thin space before the unit too; ngspice still stops
  reading at the first one, so they are 10 Ω, 4 Ω and 1 F (space-character-7, -8). `spacedValue` now
  reads groups of three digits with a unit after them, or a scale letter on the last group (`1 000k`),
  so the check says "R1's value is read as 10 Ω, not 10 kΩ" and offers "Write 10000 (10 kΩ)". Before,
  such a word fell to the glue check, whose "Replace it with a normal space" made `10 000 Ω` three
  words that stop ngspice (space-character-9), and whose next fix left a 0 Ω resistor. So a part's
  value never gets that fix: a number written some other way (`1<thin space>2`, `0.000<thin space>001`)
  is said as ngspice reads it ("R1's value is read as 1 Ω") when taking the characters out changes
  that, with the fix "Take it out: write 12" (space-character-11). Other words keep the glue check, where
  two words were meant: `PULSE(0<thin space>1 …`, and a part line a word short. On a capacitor or an
  inductor the words now say that ngspice also warns that it can't find a model with the word's name
  (space-character-8), as for the Greek mu. In a node name the character makes another node
  (`o<thin space>ut` is `o___ut`, space-character-10): the check names it ("The node o ut has a thin
  space (U+2009) in it") and, as for an invisible character, its fix takes it out, "Take it out:
  connect to out" when a node out exists, else "Take it out: name the node out"; the dangling-node
  check says nothing about the pair, so no button reads "Rename out to o ut".
