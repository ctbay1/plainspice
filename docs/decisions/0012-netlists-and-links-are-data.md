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
  Invisible meant U+00AD, U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+2066–U+2069 and U+FEFF (all the
  default-ignorable characters since the re-check, below); the
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
  "Make it 1meg" and "Make it 1m (1 mΩ)" (after the re-check: see below). Elsewhere on a line such a
  character glues two words into one (space-character-4, nbsp-1): a warning that names it, with the
  fix "Replace it with a normal space". A value that starts with one is an error (space-character-5).
  The words name the character ("a thin space (U+2009)"), in the checks and in Explain, and the
  netlist editor shows it, the no-break space too, as a dot with that name.
- **A capital M that is no M** (critic of the fixes above). A Greek capital Μ (the M key of a Greek
  keyboard), a Cyrillic М or a fullwidth Ｍ looks like M, which is milli in SPICE; a student who types
  one means mega. So for those look-alikes the check offers "Make it 10meg" first for a resistor or a
  gain, and "Make it 10m (10 mΩ)", never "Write 10M", which that check would
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
- **The node-name checks grow with the netlist again, not with its square** (code review of the
  merged build, code-2). The checks for node names (non-ascii-node, invisible-character,
  space-character, look-alike-letter) rename a node on the drawing's `*@ label` line too, and read
  every line of the netlist again for each node they renamed; the new names of nodes with the same
  plain letters (x, x2, x3 …) were counted up from 2 for each. `readNetlist` runs while the page
  renders, so a 13.9 kB link (2000 such nodes among 100,000 comment lines) froze the page for about
  5 s on opening and after every key, and 4000 names with the same plain letters took 1.2 s. Now the
  label lines are read once, on the first rename, and the next number for each name is kept: the
  checks take about 0.3 s on that link (fix-base, which had none of them, 0.12 s), and in Chromium the
  page's longest task is 0.28 s on opening it and 0.2 s after a key (5.6 s and 5.7 s before); a
  6.6 kB link whose one fix renames 2048 nodes, 0.29 s (5.9 s). The test
  (`tests/unit/spice-traps.test.ts`, "renames thousands of nodes among thousands of lines …") builds
  each kind of name, and one X line whose one fix renames all its nodes, ten times larger among ten
  times the lines, and allows at most three times the work of ten small ones, timed as the work it
  is (`work-time.ts`): the old code took six to eight times as much, the new one about as much.
  Later (names lane, second critic, 2): the node names on the commands for ngspice (`.control`, `*#`
  and `##` lines), which these checks read for their sentences and renames, were found with a regex
  that read the rest of the line again from every `v(` with no `)` after it, so one long `.control`
  line of `v(` (a 326-character link) froze the page for 6.5 s on opening and 6 s after each key.
  Each `v(` and the first `)` after it are now found once: the checks take 4 ms on that 120 kB line
  (7.4 s before), and in Chromium the link opens in 0.54 s with a longest task of 0.15 s, and a key
  takes 71 ms with no long task (7.2 s, 6.5 s and 6.0 s before). A test of its own times the line
  (`tests/unit/spice-traps.test.ts`, "reads one long .control line of v( with no ) …"; the old code:
  799 ms once, 88 ms for ten small ones), with 20 ms of room, since the work is a few milliseconds.
- The parser's own reading of a directive had the same shape (found by the names lane, fixed by the
  integrator): `nodeRefsInDirective` (`src/spice/parse.ts`) made each `v(` name every word after it
  up to the first `)`, or to the end of the line when there was none, so a `.print` line of `v(` with
  no `)` gave references by the square of its length: 2000 `v(` (4 kB) gave 2 million references and
  0.7 s, and 8000 used up the 2 GB a Node process has, which in a tab means a crash, from a link of
  a few hundred characters. Each word is now named once, by the first bracket that holds it, and each
  `)` is looked for once: 32 000 `v(` (64 kB) take 50 ms and give 32 000 references. Every netlist
  in the repository (147 files) names exactly the same words as before; on 87 hand-made directive
  lines with open and nested brackets the only change is that a word named several times (by each
  bracket around it) is now named once. The test (`tests/unit/spice-parse.test.ts`, "names each word
  of a directive once …") counts the references, which does not depend on the machine's load; the old
  code gave 500 504 where it expects 1004.
  The editor's reading of the `.control` lines (`controlNodeRefs` in `src/schematic/edit.ts`, which
  every edit that names a node reads, and a delete) had the same shape and is read the same way now:
  one line of 4000 `v(` gave 8 million names and 1.5 s on each such edit, now 4000 names in 5 ms,
  the same names, first to last, as before on 71 hand-made `.control` lines (the old code only named
  some words more than once). Its test ("reads a long .control line of v( once …",
  `tests/unit/schematic-edit-disconnect.test.ts`) runs the old code out of memory.
- **What ngspice does on an analysis line, said place by place** (re-check of the fixes, S2). A number
  of an analysis line that starts with an invisible character, a look-alike or a character that looks
  like a space got "ngspice stops: 'unknown parameter (___2m)'", which ngspice prints only on part
  lines; for an .ac stop frequency it does not even stop. What ngspice does depends on the place of
  the word, so the check says it place by place, from a run of each (invisible-character-8 to -21):
  .tran's step and stop ("TSTEP/TSTOP is invalid"), its start and largest step ("unknown parameter on
  .tran - ignored", though it runs nothing), every number of a .dc sweep (ngspice 47: "Bad syntax!";
  ngspice 42 takes the word for a second source, said for a line of one sweep only, as recorded), .ac's
  points and start (a warning, then "AC startfreq <= 0"), .ac's stop (a warning, and it runs anyway, up
  to 1000 times the start frequency), and .noise's points, start and stop ("Frequency of 0 is invalid").
  Any other place has no recorded run, so the character checks leave its words alone: .four (which a
  run with a results file ignores anyway, invisible-character-27), .disto, .pz, .sens, .sp, a .noise's
  points per summary. A
  character inside such a number ends it, as in a value; what ngspice then does with the number it reads
  depends on the place too, and "without a message" holds only where a run shows ngspice running on
  with it (invisible-character-22, three stops still past their start, and -44; see "What the number
  read does, place by place" below). A unit test runs every place with each kind of character and
  checks that no trap on an analysis line quotes "unknown parameter".
- **A .dc line read by place** (S5). The dc-sweep check read numbers greedily and took a word it could
  not read for the name of the next sweep, so `.dc V1 −5 5 1` (a minus sign from a document) got ".dc
  sweeps −5, which is not in the circuit" and ".dc needs a step", whose fixes led to `.dc V1 V1 5 1
  -400m`, "No traps found" and a failed run. Now it reads each sweep as ngspice 47 does: a name, then
  the start, the stop and the step. A word another check explains (an invisible character, a
  look-alike, a character that looks like a space) leaves the line to that check, whose fix is the only
  one; a word that is no number where a number goes is said there ("The start of this sweep is not a
  number", ngspice 47: "Bad syntax!", dc-sweep-problems-9, -10), with "Write 0" for a letter O; where
  the step goes, a part's name or temp still means the step is missing. The words for ngspice's own
  "Bad syntax!" on a .dc line (`describe.ts`) blame the step only when it is missing or 0, and
  otherwise say "ngspice cannot read this line".
- **On a capacitor or an inductor, a model warning** (S4). For C and L, ngspice also looks a value word
  with a character outside ASCII up as a model and warns "can't find model" (invisible-character-7,
  look-alike-letter-7), as for the Greek mu and a thin space; the invisible-character, look-alike and
  capital-M words now say so there, instead of "without a message". R, V, I, E, F, G and H stay "without
  a message".
- **The milli fix says what it writes** (words-recheck-6). For a capital M from another alphabet, after
  a character that looks like a space, or after a normal space (`10 M`), ngspice reads neither mega nor
  milli: 10 Ω, or M as a setting. So the second fix is "Make it 10m (10 mΩ)", worded like the mega one,
  in the order mega-as-milli uses; "Keep milli: write 10m" stays only in mega-as-milli, where ngspice
  does read milli. A unit test checks that no character check's fix starts with "Keep".
- **No value word, settings only, or a value word ngspice cannot read** (S6, C3). These were one case
  in three places. E, F, G and H: with nothing after the nodes, native 47 stops (missing-value-4 to
  -7); with settings but no number (`gain`, `m=2`), native 47, 42 and our engine use 0 and say nothing
  (missing-value-11 to -14); a word ngspice cannot read where the gain goes is no missing gain at all,
  but the character checks' or unknown-word's. A word where any part's value goes (`Av`, `Rload`,
  `five`) is said as that: ngspice stops at it ("unknown parameter (av)", native 47 too, with no
  polynomial; on R, C and L after a model warning; unknown-word-13 to -21), with no fix that comments it
  out and leaves the part with no value; its words suggest the number, or a `.param` line and braces
  (unknown-word-23). A name defined on a `.param` line is that value, as ngspice reads it, so it is no
  trap (unknown-word-22, -24), and Explain uses its value. A source whose value word ngspice cannot read is
  no ammeter in the circuit's words (`describe.ts`), and Explain gives it no "has no value" note, which
  it now keeps for a source with nothing after its nodes or an AC value alone; with `dc` and no number
  ngspice prints no note (P16b), and Explain says "without a message".
- **A 0 another check explains** (C1). `0<zero-width space>.47`, `0R47`, `0k47` and `0．47` are read as
  0, but 470 mΩ was meant: the zero-ohm warning, whose "Use a 0 V source" would make a short, now
  steps aside for the check that explains the value; the error for a resistor straight across a
  source stays (zero-ohm-2). That check now says what zero-ohm says of a 0 (zero-ohm-4): ngspice 47
  warns and uses 1e-12 Ω, ngspice 42 used 1 mΩ without a word, never "without a message" (critic of the
  re-check fixes, CR1-1, below).
- **A sign then a character that looks like a space** (C2). `-<thin space>5` is no number, and ngspice
  stops; it got the glue warning, whose "Replace it with a normal space" left `- 5`, which ngspice also
  stops at (space-character-13), and a comment fix that left 0 V. Now the space-character (or nbsp)
  check says where the character is, as for an invisible one, and writes the value, "Write -5"
  (space-character-12, -14, nbsp-3); `- 5` with a normal space gets "Write -5" too.
- **The letter O where the digit 0 belongs** (C4). `1Ok` and `1оk` (Cyrillic о) are 1 Ω, `1О00` is
  1 Ω and `O.47k` is no number (look-alike-letter-10, -11). One narrow check covers the plain letter and
  its look-alikes alike: an O between digits, an O after a digit before one scale letter that ends the
  word (not m), and an O at the start before a decimal point; never before a unit, so `100Ом` (Russian
  for 100 Ω) and `1kОм` stay as meant, and `10кОм` keeps its к warning only. LOOK_ALIKES still maps о
  and ο to the letter o, as decided above: only this check reads them as a digit. Its fix writes the
  zero, where the old comment fix left R1 with no value.
- **Every invisible character, and the decimal points of documents** (C5). Invisible now means all of
  Unicode's default-ignorable characters (U+034F, U+061C, U+115F–U+1160, U+17B4–U+17B5,
  U+180B–U+180F, U+3164, U+FE00–U+FE0F, U+FFA0, the tag characters ...) with the line and paragraph
  separators and the next-line character (invisible-character-23 to -25), written with escapes and the
  u flag, as a raw line separator would end a regular expression. Each has a name in words, its own
  ("a Hangul filler (U+3164)") or its range's, else "an invisible character (U+XXXX)", so the words
  never show one and nothing reads a name that is not there. A middle dot, a one-dot leader, a small
  full stop and the Arabic decimal separator are read as a decimal point in a value's words only
  (`4·7k` is 4 Ω; look-alike-letter-9, -13; `4·7 kΩ` too, space-before-suffix-18), each named as what
  it is, never "a dash". Any other character outside ASCII inside a number, with a digit after it
  (`4。7k`), is said as what ngspice reads, without a fix (look-alike-letter-12), and Explain names it
  instead of "Don't type units after numbers".
- **What the number read does, place by place** (critic of the re-check fixes, CR1-1, CR1-2, CR1-13).
  The step-asides of C1 and S5 left the covering check alone, and its words said "without a message"
  (rkm-notation: "says nothing") for numbers ngspice cannot use: a resistor read as 0 (ngspice 47 warns
  "Value of resistor r1 is too small" and uses 1e-12 Ω; 42 used 1 mΩ), a `.tran` step or stop of 0
  ("TSTEP/TSTOP is invalid"), a `.dc` step of 0 (47: "Bad syntax!"; 42 never finishes), an `.ac` start of
  0 ("AC startfreq <= 0"), while the status line on the same screen said ngspice had stopped. We keep
  one trap per word: the check that explains how the word is written owns it, and now says what ngspice
  does with the number it reads there, weighed with the line's other numbers as ngspice reads them, from a
  run of each place (zero-ohm-4, invisible-character-28 to -44), and is an error where ngspice stops.
  "Without a message" is said only where a run shows ngspice running on with that number. We chose this
  over the critic's other way (keeping the zero-ohm warning or the step-0 error beside it): two cards for
  one word would say the same consequence twice with two different buttons, of which "Use a 0 V source"
  makes a short where 470 mΩ was meant; the true words and the fix that writes what was meant ("Write
  0.47", "Write 0.5") are in one card. `checkTran`, as `checkDc` already did, leaves such a word to that
  check (corrected by the second critic, CR2-1, below: only the conclusions that word's reading decides) (before, `.tran 0.1m 0<zero-width space>.5` got "The step is longer than the whole run" and a fix
  that wrote a step of 0 with the raw character in its label), and a stop time of 0 or less is now an
  error of its own (tran-problems-8, -9; "Make it 1" for `-1`). The status words for ngspice's "TSTOP is
  invalid" (`describe.ts`) say "The .tran stop time must be more than 0" when the line has a stop time,
  and keep "With one number, ngspice has no stop time" for a line of one number. Away from a part's value
  the number meant is said as written ("This value is read as 0, not 0.1m", never "not 1e-4"). The same
  holds for a word that a character looking like a space glues on an analysis line (`.dc V1 0 5
  0<thin space>.5`): ngspice reads it as one number cut short, so the glue check says what the place
  does with it (space-character-16 to -18), never "says nothing about it", and offers only a fix that can
  make the line run: a normal space where the line lacks a word and the number read does no harm (`.dc
  V1 0 5<thin space>1`), else taking the character out, since a normal space keeps the same number at
  that place, or makes one word too many.
- **A source's function, AC value and settings have places of their own** (CR1-5). A word in PULSE, SIN,
  PWL, EXP or SFFM, in the AC value or phase, or in a setting's value got the part-value quote "unknown
  parameter (___0)" and was called "V1's value", with V1's unit in its fix. From runs of each place: the
  first number of a function gives "parameter value out of range or the wrong type", the second "no such
  parameter on this device or parameter is missing" (42: "no such parameter on this device"), later ones
  "unknown parameter" (invisible-character-45 to -47); the AC value and phase "unknown parameter" (-48,
  -49); a setting's value (`m=`, `dc=`, `ic=`) numparam's fatal "Undefined parameter [___2]" (-50, -52,
  -53); a number read short there runs on without a message where a run shows it (-51, -56; narrowed by the
  second critic, CR2-3, below). Their subjects say what they are ("A
  word in V1's PULSE", "V1's AC value", "R1's m value") and their fixes give no unit. A place with no
  recorded run (AM, TRNOISE and the like) is left alone by the character checks and by unknown-word.
- **One word for E's and F's gain** (CR1-14): "E1's gain" in the character checks too, as unknown-word
  and missing-value say it.
- **A sign with a space, said part by part** (CR1-3). `E1 b 0 a 0 - 2`: native 47 and 42 (both built with
  XSPICE) read a polynomial and stop with "MIF-ERROR ... Bad real value", and only our engine says
  "unknown parameter (-)" (unknown-word-25 to -28); on C and L ngspice first warns that it can't find a
  model called `-` (-29, -30); R, V and I stop at the sign (-31, -32, space-character-13). The fix "Write
  -2" stays.
- **Only a top-level .param's names are values outside a subcircuit** (CR1-7). A subcircuit's own
  parameter, a `.param` inside a subcircuit and a `.func`'s name are no value at the top level: ngspice
  stops (unknown-word-33 to -35), so they are flagged again, and the words say where the name has its
  value ("it has a value only inside the subcircuit foo", "the name of a function (on a .func line)")
  instead of "no .param line gives it a value". A `.param` line after `.end`, even `.end;comment`, is read
  (unknown-word-36, -37), so its names are values, in Checks and in Explain.
- **A .dc line read by place, to the end** (CR1-4, CR1-6, CR1-8, CR1-11, CR1-12). A word in braces or
  quotes is a number numparam works out, so the sweep runs (dc-sweep-problems-17): no trap, no "stops"
  note in Explain, and the "Bad syntax!" words blame the step only when that step comes to 0; a `.param`
  name without braces stops ngspice 47 (-18), with "Write {st}". A sweep missing its numbers (`.dc V1 0`,
  a second sweep's name alone) gets one error (-11, -12); a number where a second sweep's name goes is
  "One number too many", deleted by its fix (-13, -14), never "Sweep V1 instead", which wrote a line
  ngspice 47 rejects; a name with a hidden or look-alike character is said with the character named and
  quoted as ngspice spells it ("___v1"), with "Take it out: sweep V1" (-15, -16); words after the second
  sweep are ignored (-19). The letter O gets "Write 0" for the start and the stop only: at the step the
  words say that 0 would not do either. Explain's summary and the circuit's analysis sentence say that
  ngspice 47 stops at a `.dc` line it cannot read ("see Checks"), never a sweep that runs.
- **The letter O, with a unit, meg or more Os** (CR1-8, CR1-9, CR1-10). `1OkΩ`, `1Omeg`, `1OOk`, `1OkOhm`
  and `1OuF` read as 1 too (look-alike-letter-15) and are flagged; a lone A or F after the O is the unit,
  as space-before-suffix reads it (`1OA` is meant as 10 A, not 10 aA). Explain names the letter O as
  Checks does ("Write 10k") instead of "Don't type units after numbers", and its note for a stray
  character ends as Checks does: with the model warning on C and L, and never "without a message" (a
  resistor read as 0 has Explain's own note on 0 Ω beside it).
- **Known limits, recorded** (critic of the re-check fixes). A brace expression that comes to 0 (a `.dc`
  step `{st}` with `st=0`) is not flagged by Checks, though the "Bad syntax!" words name the step. Words
  in a function with no recorded run (AM, TRNOISE) are left alone. The letter O at the end of a value
  (`10о`) is not flagged, as a unit could be meant; `0O47` is read by the check as 0047. A glued word on an
  analysis line where the line lacks a word says what is read there, not what ngspice does with the line
  as a whole (`.tran 1u<thin space>2m` has no stop time). Explain and the circuit's words for a `.tran`
  stop of 0 ("this line has no stop time", "from 0 to 0 s") are as before.
- **A character word never hides its line's other problem** (second critic of the re-check fixes, CR2-1).
  `checkTran` skipped a whole `.tran` line, and `checkDc` a whole sweep, when a character check covered one
  word, and that check, weighing only its own number, said "without a message" where ngspice stopped at
  another word: `.tran 0 2<thin space>ms` (a step of 0), `.tran 2<thin space>ms` (no stop time), `.dc V9 0
  5<zero-width space>0 1` (no V9). Now the line is read as ngspice 47 reads it (`lineOutcome` in
  `src/spice/traps.ts`, from inp2dot.c, dctrcurv.c, acan.c and noisean.c: the step, then the stop, then the
  start of `.tran`; the words of each `.dc` sweep, then its source, then its points; `.ac`'s defaults and its
  start; `.noise`'s frequencies, then its run). A character check says the line's outcome only when its
  place's words describe it exactly (each outcome names the word that decides it: TSTEP@0, BAD@7), "without a
  message" only when the line runs without one, and otherwise nothing ("it reads 2."): the line's own check
  says its problem, as on a line without the character, and its fixes write the number meant, never the
  character back. We chose this over the critic's other way (the line's own outcome, for every combination,
  from a run): the outcomes ngspice reaches are many, and a check of its own already says each, from its own
  runs; the facts invisible-character-58, -60 to -63 and space-character-19 show such lines. On `.tran`, whose
  first problem stops ngspice, a character's own stop is said even when a later word is wrong too (-58).
  Where a word glued by a character that looks like a space may be two words, the line is still left to the
  glue check. A `.dc` line ngspice 47 stops at ("Bad syntax!") is never said to meet a missing source in 47
  (ngspice 42 does, dc-sweep-problems-25), and no points are said of a line ngspice stops at. `.ac lin` has no
  check of its start: a start of 0 runs from 0 Hz (invisible-character-57), where the words had said it stops.
- **Linear in a long PWL** (CR2-2). Working out each word's place walked back over the words before it, so
  a PWL of N numbers took time in N²: 22 s for 16,000 points, 2 s per keystroke at 4,000. The places of a
  part line are now worked out in one pass (`partPlaces`, once per line), and a PWL's times are weighed from
  a count of their falls made once: 16,000 points take 0.1 to 0.3 s, and 0.4 s with a character in every
  time (measured at load 8 on 4 cores). A unit test
  checks that ten PWLs of 1,000 points take about as long as one of 10,000.
- **"Without a message" in a function or a setting, only where a run shows it** (CR2-3). A PWL's times must
  rise: a time read short out of order makes ngspice warn that the source "has non-increasing PWL time
  points", which the words now say (invisible-character-59); a resistor's value written r= or resistance= and
  read as 0 gets zero-ohm's words (zero-ohm-5). "Without a message" stays for the places runs show:
  invisible-character-51 (narrowed to what it recorded) and -56 (every other place of PULSE, SIN, EXP, SFFM
  and PWL, the AC phase, values written dc=, r=, resistance=, c=, l= and gain=; written c= or l=, the value is
  not looked up as a model). No claim is made where a run is missing or ngspice weighs the number with
  others: SFFM's carrier, modulation index and signal frequency, a value at time 0 beside a DC value (ngspice
  notes when they differ), a source's DC value beside a function, a PWL with r= (whose repeat time must be one
  of its times), any other setting.
- **Two sweeps** (CR2-4). "No points" was recorded on lines of one sweep. In two sweeps ngspice computes the
  first sweep for each value of the second, so a second sweep the wrong way leaves the first computed once,
  with the second at its start (dc-sweep-problems-20, -26), a first sweep the wrong way stays at its start
  while the second runs from its second value (-21, -27), both the wrong way give no points (-22), and a
  step past the end gives one value of that sweep (-23, -24). The checks say so, as a warning (ngspice gives
  results), for the plain words and the character words alike (invisible-character-54, -55), and so does
  Explain.
- **Parameters across subcircuits** (CR2-5). Inside a subcircuit ngspice gives a word a value from the top
  level's `.param` lines and the subcircuit's own (its `.subckt` line and the `.param` lines in it), never
  another subcircuit's, and never a `.func`'s name: those stop it (unknown-word-38, -39) and are flagged again.
- **The sign check takes the number after it** (CR2-6). `R3 a 0 - 1<zero-width space>0` got "Write -1<zero-width space>0"
  with the character in the label and the fix, and a second card saying "without a message" on a line ngspice
  stops at the sign. The number after a sign standing alone is now the sign check's: one card, its value
  written without the character ("Write -10"), and no character card for that word (unknown-word-52).
- **ngspice's names in a subcircuit** (CR2-7). ngspice builds a subcircuit's parts once for each X line that
  uses it and names them by it: r.x1.r1. The zero-ohm words quote that name, once for each X line
  (zero-ohm-6); for a subcircuit inside another, or one no X line uses, they say the warning without a name.
- **Settings on E to H lines, and where a value goes** (CR2-8). After an E's or H's gain, m= stops native
  ngspice 47 and 42 too, with no polynomial (unknown-word-40, -41); F and G take m, their multiplier; any other
  name=value there is read natively as a polynomial, as the words already said (unknown-word-51). A setting
  written where the value goes (`G1 0 b a 0 gm=1m`, `R1 a 0 x=5`) stops every part at its name, with no
  model warning (unknown-word-42 to -50): the words say the part has no setting of that name and offer "Write
  1m", never a .param line and braces.
- **Known limits after the second critic.** A line with two problems where the character's reading decides
  the first is said by the character check on `.tran` and `.dc` (the first stop), and left unsaid on `.ac` and
  `.noise`, whose outcomes combine warnings; their own problems, as on lines without a character, have no
  check of their own. A word glued by a character that looks like a space between digits (`.dc V1 0 5<thin
  space>1`) still leaves the line to the glue check. On a `.dc` line with a missing source and a step of 0,
  each card says what each version does, as the runs show.
- **Such a character in a node name is named on every line** (re-check S11). Explain named an
  invisible character in a node name on part lines only. On .tf, .ic, .save and .print lines (and in
  the .tf note for a node that is not in the circuit) it wrote the name with the character hidden in
  it ("the output resistance at node ou<ZWSP>t", which reads as the node out); it never named a
  look-alike letter in a node name; and the circuit overview and the results' words did the same. Now
  one function, `nodeNameInWords` (`src/spice/explain.ts`), names it wherever a sentence names the
  node (and, after the critic of the fix, the floating-node and dangling-node checks and the
  no-single-answer message, which wrote "ou<ZWSP>t has no DC path to ground" and "ou___t"): "node out
  (written with a zero-width space in it)", "node o ut (one word for SPICE: written with a thin space,
  not a space)", "node оut (written with the Cyrillic letter о, which looks like o)". On .ic, .save
  and .print lines such a voltage is said in words ("the voltage at node out (written with a
  zero-width space in it) starts at 1 V"), and the .tf formula leaves the character out, the words
  after it naming it (in the summary, the box on the paper and the Numbers panel's .tf table, which
  wrote "v(ou<ZWSP>t)" until the critic of the fix). So does the card's formula, "V(in) − V(out) = 2
  V", whose spoken form names it after the formula ("V(in) minus V(out) is 2 volts, where out is node
  out (written with a zero-width space in it)") unless the words before it, "node … is higher", name
  it already (critic of the fix: a screen reader heard V(out), the node it is not). A name all in
  another alphabet (α) or with a Turkish letter is meant as written, and not named. The .tf check
  keeps an error on a name that is a node of the circuit but for such a character, as on any node no
  part connects to: ngspice's numbers for it are a transfer function of 0 and an output impedance of 1
  Ω (tf-problems-8), so the run is "Not reliable" and the paper draws no .tf box, as for a typo (the
  critic of the S11 fix found that leaving it to the character's warning made the run a green
  "Finished", with "Transfer function v(out) / V1: 0 V/V" drawn as an answer). Its words name the
  character and never say "There is no node called out" with a button "Use out": ".tf asks about a
  node with a zero-width space (U+200B) in its name, not the node out", and the fix "Take it out: use
  out" ("Write the plain letter o: out" for a look-alike), as the character's own warning offers it
  for the whole node. For a name that is no node either, the error names the character too. After
  the second critic of the fix: that error names the node as the other words do ('not the node
  "ground"', "not node1", 'Take it out: use "ground"'; none for an ordinary node called gnd, which
  v( ) reads as ground); a name with characters of more than one kind has each one named, in the
  error and wherever `nodeNameInWords` names it ("оut (written with the Cyrillic letter о, which
  looks like o, and a zero-width space)"), where only the first kind was; with the character in the
  parts' node and not in the .tf, the check says so (".tf asks about node out, but the parts are on
  another node: out (written with a zero-width space in it)", tf-problems-9), never "There is no node
  called out", and offers no button, since its "Use out" wrote the character into the .tf (no near
  name the check offers has such a character); a part's name in i( ) or as the input is named the
  same way, ngspice's message quoted in its own spelling ("v___1", tf-problems-10); and a .tf after
  .end, which ngspice runs, is checked as one above it, its words naming the node as written, not as
  ngspice spells it (tf-problems-11). Known gap:
  the short forms still write such a name as it is written, so the character is there unseen: a
  sweep's "v(out) = 3.5 V", the Plot's legend, the Numbers panel's Node column and the notes at the
  end of netlist lines (the checks warn about the node, and the sentences beside them name the
  character).
- **Never a netlist that ngspice would write past the end of a fixed space** (second re-check, P1). A
  title of more than 504 bytes stops `ngspice -b -r` ("buffer overflow detected": it writes
  `Title: ` and the title into 513 bytes), and in a few other places ngspice copies a name into 100
  or 512 bytes without checking (limit-1 to limit-19 in [`../spice-facts/limits.md`](../spice-facts/limits.md)).
  Our engine has no such check: a title of 505 to 523 bytes ran on overwritten memory, a longer one
  crashed it, which Playwright's browser shows as a crashed page; a real Chromium said "the simulation
  engine crashed", and saved work with such a title did that on every visit. The copy ngspice runs
  (`src/spice/run-netlist.ts`) now:
  - cuts line 1, whole (native ngspice reads ` .title …` there as written), and every `.title` line's
    title (a `.title` line counts anywhere, even after `.end`) to its first 504 bytes, between two
    characters; the student's text keeps it, and the ngspice
    output panel says what was cut and why. The numbers are those of a short title (limit-2). A title
    is the one thing a student pastes long: a problem statement.
  - is not run at all when ngspice would write past a space: a word of more than 250 bytes (anything
    between blanks, brackets, commas, `=`, `{ }`, quotes and operators; a part line's first words and
    a `.save` line's words as ngspice takes them whole), a name ngspice makes inside subcircuits of
    more than 250 bytes (a part's `r.x1.x2.r1`, a node's `x1.x2.n1`: it saves currents under them and
    a `.control` block prints them), a formula's `v(…)` or `i(…)` of more than 500 bytes, an analysis
    command of more than 500 bytes as ngspice writes it (`.op` and its words with one blank each), or a
    `.model` line's version of more than 90 bytes (ngspice copies it into 100, limit-9). An analysis
    command is any line ngspice runs as one: a `.control` block's, after `.end` too, a line that starts
    with `*#` anywhere (and `##`, `;#` and the like), every line of an `*ng_script` file (one that starts
    with `;` too), with `pre_` taken off and the commands a `;` separates on a `*#` line (limit-18); its
    words are read as ngspice's control reader makes them, blanks kept in quotes, a `~` as the engine's
    home folder, and a command with choices in braces (`{a,b}`, a word each) is not run (limit-19). The
    lines after `.end` are part of the circuit to ngspice, which makes `.end` a comment and reads on, and
    get every check of the lines before it (limit-18). The words are measured as ngspice makes them: without the blanks inside brackets where it takes them out (`.save i( a b c )` is one name,
    limit-13), with the text a string parameter stands for where `{…}` puts it (limit-14), the names a
    `.probe` line makes and the formula it writes for `p(…)` (limit-15), and the name `print`, `write`,
    `fft`, `psd`, `spec` and `asciiplot` give a formula, its words with one blank each and the quotes
    ngspice adds (limit-17); a `meas` command's words keep to 50 bytes, as ngspice writes a
    wrong one with its message into 100 (limit-17). A line's comment is cut exactly where ngspice cuts
    it, before these checks, and its words are never read: a `$` glued to a word starts none, so
    `B1 c 0 V=1$+v(b` is a formula with a `v(` and no `)`. The lines of `circbyline` commands, which
    ngspice reads as a netlist, are checked as one, a circuit at each `.end`, once: its title (its first
    line, and a `.title` line's words) keeps to 504 bytes, and a `circbyline` command inside it is
    refused, as ngspice crashes on it (limit-12, limit-16); so is a netlist that sets `ngbehavior` and
    builds a circuit, which ngspice then reads in another mode (with `ps` a `$` starts no comment). The run fails with the reason, the line and
    what to do: the status line says "PlainSpice did not run it" and why, the Numbers panel and the
    alert "The simulation could not run:" and why (the path a failed run already had), and nothing
    reaches ngspice, from the app, the
    checkpoint, the prototypes or the spike page. The alert says a reason once: while the student
    types on in a refused line, each pause fails again with the same reason, which is not said again
    until it changes; a run Run asks for says it each time (decision 0010).
    250, not 511: ngspice joins two names in one space when it turns a resistor's
    formula into a B source (`v(n1, n2)`), and a `.control` block's `display` writes about 40 more
    bytes around a name (limit-10); one number for every name, written or made inside subcircuits, is
    simpler to say than one per place. Where ngspice joins more than two (a `.probe` line's formula: a
    part's, a terminal's and a node's name; words in brackets), the word it makes is measured, not the
    names in it. With every name that short, `.options savecurrents` is added
    for every `.op` that runs (decision 0011). No netlist we have comes near: all 147 in the repository
    give the same copy as before.
  - Checked with ngspice 47 built with AddressSanitizer, configured like the engine: every kind of
    word at 600, 5,000 and 20,000 bytes, at the limits and one byte over, each place found by reading
    every fixed-size array of the source that a netlist reaches, and, after a review of the first fix,
    what ngspice does to a line before it copies it (1,154 netlists). Of the 301 copies PlainSpice runs,
    291 give no report and no stop; three are limit-11 (below), five are lines starting with a vertical
    tab, or a byte order mark and a blank, before `.title`, which ngspice refuses and which the
    sanitized build reports as an overlapping `memcpy` at any length (no write past a space), and two
    include a file that crashes native ngspice for no length (`/proc/meminfo`, the netlist itself). Our
    engine crashes on one, again no length: a netlist that includes itself. After a review of the second
    fix, which found commands where no check looked (`*#` lines, after `.end`) and words longer than they
    are written (braces, quotes, `~`), 367 more netlists: of the 184 copies PlainSpice runs, two stop
    native 47 and the sanitized build for a length, both what this record leaves open (limit-11, below),
    eleven for something else (a `compose` of a formula, `.param=` at any length), and none crashes our
    engine; no copy it ran before changed. The limits
    are below ngspice's own (100 and 504 to 511 bytes), so a little room is left for what the search did
    not try.
  - **Only analysis commands keep to 500 bytes** in a `.control` block, as only they are copied into 512
    (limit-6). The first version of this fix refused every `.control` line over 500 bytes, though
    ngspice runs a long `print`, `echo` or `let` line, and said a reason that was not true; such
    netlists, which ran on b060bc8, run again. The checks of a circuit built with `circbyline` went
    one level deeper for each circuit built inside it, so a 2 kB link took a second of processor time
    at every pause; such a circuit is now checked once, and one inside it refused. Three checks added then
    grew with the square of the text too, and froze the page at every pause: a 5.6 kB link of 1,500 parts
    and 30,000 empty `.probe` lines for 4 s on a computer and 16 s on a phone (each `.probe` line walked
    every part), a `.model` line of 20,000 `version={x}` (each looked through every `{…}`), a chain of string
    parameters (one name a pass, and a chain of 12,000 ran out of stack, "a bug in PlainSpice"); and three
    regular expressions tried every start of a long line (a `.probe` line's `a( a( …`, blanks in a `.probe`
    request or a `meas` line). What `alli` keeps is now worked out once, braces found by place, string
    parameters once each without recursion, and the lines read in one pass: the longest task of those
    links is that of b060bc8 again (computer: 142, 97 and 92 ms; Pixel 7 at four times slower: 589, 385
    and 364 ms), and unit tests hold each to ten small netlists' time.
  - **A typo found on the way**: a B source, an E or G source with a formula, or a `.model` line with
    `temper`, whose `v(` or `i(` has no `)` (`B1 c 0 V=v(b`) makes ngspice look for the `)` past the
    end of the line. Native ngspice 47
    and 42 stop ("stack smashing detected") or print bytes they read past it; our engine crashed, so
    typing such a formula with live runs crashed it at every pause. It is not run either: "the v( in this
    formula has no ) after it … Add the )". Only where ngspice reads on (limit-5): in an R, C or L
    formula, an F with `temper`, a `.tf` or `.save` line, ngspice stops with its own message, which the
    student sees as before.
  - **Checks say nothing** about these. A title cut is no mistake: the run gives every number, and the
    output panel says what the copy changed. A refused netlist already says which line and why in the
    status line, the Numbers panel and the live region, and the run copy, not the trap checks, decides
    what ngspice gets: the checks may fail softly (a bug there shows fewer checks), while this must
    hold. If preparing the copy fails (a bug), nothing runs.
  - Not taken: making the engine itself check (a patch to ngspice's C code). It would need the engine
    rebuilt, and native ngspice, which PlainSpice runs like, stops the same way; it is the better fix
    for later, sent upstream.
  - **Still open: what ngspice's commands compute while they run** (limit-11). Commands make a small
    program, in a `.control` block, on `*#` lines anywhere or in an `*ng_script` file (limit-18): `set t =
    $s$s$s$s$s$s` joins short words into a 600-byte name, and `display` then writes it past 512 bytes;
    `alias xx op` makes `xx` and long words an analysis command of more than 512 bytes; after `op`,
    `$curplottitle` is the circuit's title, so `op $curplottitle $curplottitle` writes two titles; `echo`
    with `>` writes a file of commands that `source` then runs. Native
    ngspice stops; our engine runs on with its memory overwritten. PlainSpice does not run the program
    before ngspice does, so it gives ngspice the commands as written, measured as their words are
    (limit-19). Backquotes, which put a shell command's output in a command, are no way past: our engine
    runs no shell command. A `.control` block writes nothing to the results file (A36): PlainSpice shows
    its words in the ngspice output panel only. Not running any command (no `.control` block, no `*#`
    line or its kin, no `*ng_script` file) would close this; refusing only commands with a `$`, an
    `alias` or a `source` would too, with fewer netlists refused, but a `foreach` over values with `$`, the way
    ngspice's manual sweeps a part, is one. Either changes what this record allows above ("Never a
    program": the commands run, `system()` refuses), so it is Tarık's choice. An earlier version of this
    bullet said not running `.control` blocks would close it: it would not, as `*#` lines run outside
    them.


## After the last pass (13 November 2026)

- **A message one version prints is said as that version's** (last pass F10). Five trap texts quoted
  ngspice 47's words as plain "ngspice", where native ngspice 42 prints other words or runs: "no such
  parameter on this device or parameter is missing" (42: "no such parameter on this device"), on a
  value R, C or L can only report written after the value (space-before-suffix-12, unknown-word-6,
  and the C and L runs recorded beside them), "mal formed B source instance" (42: "mal formed B
  line", fatal-syntax-7), "no simulations run!" (42: 'Note: No ".plot", ".print", or ".fourier"
  lines; no simulations run', no-analysis-1), and "unimplemented dot command" for `.pss`, which
  ngspice 47 as built for PlainSpice does not know and ngspice 42 does (unknown-dot-command-2, A29b): it is
  an experimental build option (`--enable-pss` in ngspice's `configure.ac`), off by default and on in
  Ubuntu's ngspice 42 package, so the words say "as built for PlainSpice" and "as Ubuntu builds it".
  Each now says "ngspice 47 …" with ngspice 42's words beside it, as the newer texts do; for `.pss`
  the title and the why say "ngspice 47" too, and a misspelt dot command, which stops both, keeps
  "ngspice" and cites only unknown-dot-command-1. The fallback ngspice takes when its DC solution
  fails is quoted as it prints it, "Note: Transient op started", where five texts quoted a
  lower-case 'transient op'. A unit test (`tests/unit/traps-last-pass-words.test.ts`) checks, on the
  parts that reach these texts, that none of these 47-only messages is put to plain "ngspice". The
  skeptic of the problem found the same message misquoted on sources: `V1 n2 0 dc 5 p`, `V1 n2 0 5 i`,
  `I2 0 n1 1 p` and `I2 0 n1 1 v` got "unknown parameter (p)", where native 47 and 42 say "no such
  parameter on this device…", as V's i and p and I's v and p are values the source can only report;
  the checks now say so, from the source tables of `src/spice/parse.ts` (`isReportOnlyParameter`, which
  Explain reads too), since the round-1 critic's C4 below. This fix first gave the checks a table of their
  own in `src/spice/traps.ts` and left the parser's tables as they were; an earlier version of this bullet
  still said so (corrected after the integration check, X6). The runs are recorded as
  space-before-suffix-20 and unknown-word-57 (first beside space-before-suffix-12 and unknown-word-6). We
  chose naming each version over the skeptic's other way, quoting under plain
  "ngspice" only the words both versions print ("no such parameter on this device", "no simulations
  run"), which is shorter: the texts beside these already name each version where the two differ
  (invisible-character-46 with this very message, the .dc checks, zero-ohm), the ngspice output panel
  shows ngspice 47's whole line, and for a B line the two messages share only "mal formed B".
- **A resistance below 1e-12 Ω that is not 0** (last pass F4). The words for a 0 (C1, CR1-1 above)
  covered a value of exactly 0 only: on `R1 n1 0 3a` the unit-letter card said "ngspice reads 3a as 3
  attoohms and says nothing", where native ngspice 47 warns "Value of resistor r1 is too small, set to
  1.000000e-12" and uses 1e-12 Ω, and the zero-ohm card beside it said "ngspice 42 used 0.001 Ω", where
  ngspice 42 keeps 3 aΩ as written (P24). From runs of every such value (zero-ohm-7, zero-ohm-8):
  ngspice 47 uses 1e-12 Ω, or −1e-12 Ω for a negative value (quoted "set to -1.000000e-12"), with a
  warning; ngspice 42 keeps any value that is not 0 as written, without a word, and uses 1 mΩ for 0
  only. The words every check gives a resistor's value (`zeroOhm` in `src/spice/traps.ts`: unit-letter,
  mega-as-milli, rkm-notation, greek-mu, the character checks, the settings, a decimal comma, a sign)
  now say that for any value below 1e-12 Ω in size, and the zero-ohm check leaves such a value to the
  check that explains how it is written, as it did for a 0: one card for one word, whose fix writes
  what was meant ("Write 3 (3 ohms)"), where "Use a 0 V source instead" would make a short. The error
  for a resistor straight across a source stays beside it ("its current comes out enormous" for a value
  that is not 0; 6e12 A in ngspice 47 with 3a too). We chose this over the reviewer's other ways (no
  unit-letter card on a resistor, which would leave only the 0 V source; or "see the other check",
  which keeps two cards for one word), as the skeptic of the problem argued.
- **No digit of one test** (last pass F5). "ngspice 42 used 0.001 Ω without a word, which changed the
  answer in the 4th digit" was said for every 0 Ω resistor, but holds for zero-ohm-1's circuit (a load of
  a few ohms) only: with a subcircuit the answer changes in the 3rd digit (zero-ohm-6), in series with
  1 kΩ in the 6th (P13), and the skeptic of the problem found the 6th to 8th digit for the kΩ circuits
  beginners draw. The trap's sources are not shown on the page, so a student would read the digit as
  the size of the change in their own circuit. The words now stop at "ngspice 42 used 0.001 Ω without a
  word", as the character checks' words for a 0 do. We chose this over "which, in one test, changed the
  answer in the 4th digit", the reviewer's first way.
- **The why of a value below 1e-12 Ω that is not 0** (the words lane's round-1 critic, C3). "A
  resistance this small is almost 0, and SPICE can't use a resistance of 0" read as if SPICE took 1 fΩ
  for 0, which neither version does. The why is now ngspice 47's floor, in the Numbers panel's words:
  "ngspice 47 cannot use a resistance below 10⁻¹² Ω: it uses 10⁻¹² Ω instead, and the currents next to
  it can come out inaccurate" ("this close to 0" and −10⁻¹² Ω for a negative value). "Can", where the
  Numbers panel said "come out" (it says "can" and the value used too since the integration check, P4
  below): where a current source sets the current, the resistor carries exactly
  it in both versions; in series with 1 kΩ across 6 V, ngspice 47 gives the source 5.859 mA for 6 mA and
  ngspice 42 gives 0 A (zero-ohm-9). The why for a 0 stays the arithmetic one.
- **One card for a Greek μ in such a value** (C6). zero-ohm leaves a value another check explains to that
  check, but greek-mu ran after it, so `0μ47` and `1e-13μ` kept both cards, with the same words. zero-ohm
  now runs after greek-mu, at the end of the line-by-line checks in `checkTraps`; none of the checks
  between can mark a resistor's value, and their fresh names use other stems.
- **A value a source can only report, in one table** (C4, C5). V's `i` and `p` and I's `v` and `p`,
  which only `traps.ts` knew, are in the source tables of `src/spice/parse.ts`
  (`isReportOnlyParameter`), so Explain says of them what the Checks panel says ("no such parameter on
  this device"), where it said "unknown parameter"; how a line is parsed and the editor's table do not
  change. ngspice's other values a source reports (pos_node, acreal … in vsrc.c and isrc.c) are not
  listed: no beginner writes them, and their words are as before. For a current source the why says
  "(such as its voltage or its power)", as its current is what its line sets. The same rule for the word
  after a space corrects `1 volt` on an inductor, which got "unknown parameter (volt)" where both
  versions print their "no such parameter" words. Each part's runs are records of their own
  (space-before-suffix-19, -20, unknown-word-56, -57; C7), cited by the texts part by part.

- **Run says a refused netlist's reason each time** (the last pass, C3-2 and a11y-phone-1). The reason
  said once was meant for the pauses while the student types on in a refused line; it also silenced Run,
  Ctrl+Enter and Ctrl+K's "Run ngspice now" after the first alert. A run Run asks for is now always said,
  as decision 0010 records.
- **The status line says "PlainSpice did not run it"** for a refused netlist (the last pass, C3-4), where
  it said "ngspice could not run" though ngspice was never asked: beside "… so PlainSpice did not run it",
  the two sentences said opposite things, and for a word over 250 bytes ngspice runs the netlist (native
  47 and 42, exit 0), so the headline was false about ngspice. `solveText` throws a `NotRunError`, the
  failed outcome is marked refused (`live.ts`), and `words.ts` gives it its own headline, the words of
  the reasons themselves; an engine that stops keeps "ngspice could not run". This record said the
  Numbers panel said "ngspice could not run" too: it says "The simulation could not run:", as the alert
  does, and both stay so, true of either failure. Measured by the last pass's skeptic at 320 px: the
  headline is 143 px wide (131 px before), and the page does not scroll sideways. Not taken: "Not run"
  (45 px), which reads like "Not run yet", a link waiting for Run; and "The simulation could not run"
  for every failure, which would take the engine's failures their own words. Tests:
  `tests/unit/app-words.test.ts` and `tests/unit/app-run-copy.test.tsx` (the headline, and an engine that
  stops keeping its own), `tests/unit/app-live.test.ts` (the outcome), `tests/e2e/run-copy.spec.ts` (the
  five refused links say the new headline and not "ngspice could not run").
- **A node's card and the ngspice output panel give the reason too** (the last pass, a11y-phone-2). A
  refused netlist has no run record, so a node's card fell back to "No voltage yet: ngspice runs the
  circuit in a moment." and the output panel to "Nothing yet: ngspice has not run this circuit.", while
  nothing would run until the netlist changed. A node's card now follows a part's card (decision 0016):
  the check that stopped the numbers, or, when nothing runs without Run, the status line's words (here
  the reason; for no analysis line, a link opened without running, Stop or a time-out, what to do, which
  was "in a moment" on fix-base too), and "in a moment" only while a run is on its way. The output panel
  says "The simulation could not run:" and why, as the Numbers panel and the alert do, for the netlist as
  it is now. Not taken: leaving the output panel's "Nothing yet: ngspice has not run this circuit.", true
  of a netlist ngspice never got (its skeptic's view), whose "yet" promises a run that does not come
  until the netlist changes. Tests: `tests/unit/app-run-copy.test.tsx` (the refused netlist's node card
  and output panel; a node's card with no analysis line and on a link not run; both fail on c520a49).
  In the built site (1280 × 800, the reviewer's link): the node card's voltage row reads the reason
  (c520a49: "No voltage yet: ngspice runs the circuit in a moment."); on an iPhone SE at 150 % text the
  card's sheet scrolls it whole into view, with no sideways scroll.
- **Run says why while live runs are paused too** (the critic of the first fixes, CR1-1). Live runs pause
  for a link opened without running, a netlist that asks for very many points, a slow run, Stop and a
  time-out, and the status line gave the pause's words ("Not run yet · This link opens without running:
  press Run (Ctrl+Enter) to run it.") before it looked at how the last run went. So Run on a refused
  netlist gave the alert, but the status line, and with it a node's card and a part's card (above), said
  "press Run" right after Run. While live runs are paused a change runs nothing, so a run of the text as
  it is now that failed, or found no analysis line, came from Run: the status line now says it as when
  live runs are on ("PlainSpice did not run it" and why, "ngspice could not run" and why, "Nothing to run
  yet · Add an analysis line…"), and the cards follow. A text changed since keeps the pause's words. Not
  taken: lifting a link's pause after a Run that fails, as after one that finishes quickly: a change
  typed while that Run ran would then not run, and the status line would give the failure of the text
  before it (`live.ts` keeps no text typed during a pause). Tests: `tests/unit/app-words.test.ts` (each
  of the five pauses with a refused netlist, an engine that stopped and no analysis line; a changed text
  keeps the pause's words), `tests/unit/app-run-copy.test.tsx` (Run on a link opened without running: the
  status line, the node card and R1's card give the reason), `tests/e2e/run-copy.spec.ts` (the same link
  in the built site, both projects); all fail on a0fcb61. In the built site (1280 × 800, the critic's
  probes): Run on that link gives "PlainSpice did not run it · Line 4: …", and the node card and R1's card
  the reason; Ctrl+Enter on the 120,001-point sweep with the B line typed in gives the same, for line 6; Run
  on a link opened without running of a netlist with no analysis line gives "Nothing to run yet · Add an
  analysis line…" (a0fcb61: "Not run yet" or "Live runs paused" and "press Run", each time).
- **A slow run whose numbers are not answers says so on the status line** (the round-2 critic of these
  fixes, CR2-2). A run over 1.5 s pauses live runs itself, and the status line gave the pause's words for
  every outcome but CR1-1's two: after a 9 s run that found an error (two capacitors in series, 2,000,000
  points), "Live runs paused · The last run took 9.1 s, so ngspice does not run after every change: press
  Run (Ctrl+Enter)." in the paused tone, while the drawing's red pen, both cards, the Numbers panel and the
  announcements said the numbers were not answers. While live runs are paused, a finished run of the text
  as it is now is that slow run (a quick Run turns live runs on again, `live.ts`), so when its numbers are
  not answers the status line now says how it went, as after a quick run ("Not reliable · A check found an
  error: …", in the bad tone); the pause is still said aloud ("That run took … s, so ngspice now runs only
  when you press Run"), and a change brings the pause's words back. A slow run whose numbers are answers
  keeps the pause's words: they are what to know then. Tests: `tests/unit/app-words.test.ts` (fails on
  0104ec1). In the built site (1280 × 800, the critic's link): after a 10.7 s run, "Not reliable · A check
  found an error: b has no DC path to ground." (rc3: "Live runs paused · …"); after a change, the pause's
  words.
- **The Plot panel gives the reason too** (the round-2 critic, CR2-3). For a sweep PlainSpice does not run,
  the Plot panel, and the Plot sheet on a phone, said only "The plot comes once ngspice has run this
  netlist.", a run that does not come until the netlist changes (it added the status line's words for the
  paused tone only). For a run of the netlist as it is now that failed (a netlist PlainSpice does not run,
  or an engine that stopped), it now says "The simulation could not run:" and why, as the ngspice output
  panel does (above). Not taken: the status line's words after "The plot comes once…" for the bad tone too,
  which would keep that promise. Tests: `tests/unit/app-run-copy.test.tsx` (fails on 0104ec1). In the built
  site (the critic's refused `.tran` link, 1280 × 800 and the Plot sheet on an iPhone SE): "The simulation
  could not run: Line 5: …" (rc3: "The plot comes once ngspice has run this netlist."), with no sideways
  scroll and the zoom where it was.


## After the integration check (14 November 2026)

- **The Numbers panel and Explain say of "is too small" what the zero-ohm check says** (integration check P4). The
  note for ngspice 47's warning ("Value of resistor … is too small, set to …") said "it uses 10⁻¹² Ω instead, and
  the currents next to it come out inaccurate" for every resistor. The zero-ohm check on the same page says of
  −3 aΩ "it uses −10⁻¹² Ω instead, and the currents next to it can come out inaccurate", as native ngspice 47
  does ("set to -1.000000e-12", zero-ohm-7) and as the runs show (zero-ohm-9: where a current source sets the
  current, the resistor carries exactly it). The note now takes the sign from ngspice's own line: for a negative
  value it says the check's words ("ngspice 47 cannot use a resistance this close to 0: it uses −10⁻¹² Ω
  instead"), for 0 and the rest it keeps "0 Ω (or anything below 10⁻¹² Ω)" and "10⁻¹² Ω", and both say "can come
  out inaccurate". P24b in explanations.md is new: a 0 Ω resistor fed by a current source carries exactly that
  current in ngspice 47 (at 1e-12 Ω) and 42 (at 1 mΩ), so "can" holds for a 0 as well (P13 shows the "can": 5.859
  mA for 6 mA). Not taken: the reviewer's one sentence for both signs ("10⁻¹² Ω (−10⁻¹² Ω for a negative value)"),
  which gives every student both values where ngspice's line already says which one it used; and reading the sign
  from the part's value, which a `.param` or a resistor inside a subcircuit (`r.x1.r1`) makes harder to find, where
  ngspice's line always has it. Tests: `tests/unit/spice-describe.test.ts` (the words for each sign, and without
  ngspice's line; fails on 3e61833), `tests/golden/facts-explain.test.ts` (P24b's run; the words on the runs of P13,
  P24 and P24b) and `tests/golden/facts-traps-last-pass.test.ts` (on zero-ohm-9's runs the note says what the check
  says); with 3e61833's `describe.ts`, 5 of these golden tests fail (zero-ohm-9's three runs, the words on P13, P24
  and P24b, and the engine run of 0, 1f, −3e-18, 3a and −3a below). Explain's notes on such a line
  (`src/spice/explain.ts`, unchanged since fix-base) said a third
  thing on the same page, as the skeptic of the problem found: for −3e-18, "ngspice accepts a negative resistance
  without a message" and "ngspice 47 raises a resistance below 10⁻¹² Ω to 10⁻¹² Ω", where ngspice 47 warns and
  uses −10⁻¹² Ω; and for 0, "the currents next to it come out inaccurate". A negative value closer to 0 than
  10⁻¹² Ω now gets its own note, "ngspice 47 uses −10⁻¹² Ω for a negative resistance this close to 0, with a
  warning", and no "without a message", which stays for any other negative resistance (−2 Ω: P14); the note
  for 0 says "can". Tests: `tests/unit/spice-explain.test.ts` (−3e-18, −3a and −0.5p; −2 and 1e-15 as before;
  the note for 0), and in `tests/golden/facts-explain.test.ts` an engine run of each of 0, 1f, −3e-18, 3a and
  −3a, on which the Checks, the Numbers panel and Explain name the value ngspice 47 used and none says "come out
  inaccurate" without "can" or "without a message" (it fails with 3e61833's `explain.ts` alone, and with both
  files).
- **The records say where the code is** (integration check X6). The F10 bullet above named a table of the checks'
  own in `src/spice/traps.ts`, SOURCE_REPORTS, and said the parser's tables were left as they were; its own C4/C5
  bullet had since moved those values into the parser's source tables (`isReportOnlyParameter` in
  `src/spice/parse.ts`), and no such table is left. The bullet now says where they are, keeping what the first fix
  did, as this record does elsewhere. The facts README had no section for the noise lane's facts of the last pass
  (C8b, C9w to C9w.14, C9x to C9x.6, C9y to C9y.6, and the C9 records it changed); it has one now, after the other
  lanes' sections. Tests: `tests/unit/facts-records.test.ts` checks that each code name written in backticks in a
  decision record's sections after the last pass is in the code (43 names here; on 3e61833 it finds that table's
  name missing), and that the README names every C8b, C9w, C9x and C9y fact of explanations.md, by itself or in a
  range (on 3e61833, all 27 are missing).
- **Where Explain's notes on a resistance this close to 0 begin, run and pinned** (the round-1 critic of these
  fixes, C1-1). Explain's notes for such a value start below 10⁻¹² Ω in size (`Math.abs(v) < 1e-12` in
  `src/spice/explain.ts`), and no test held that edge: with `<=` every test still passed, and Explain would say
  of `R1 n1 0 -1e-12` that ngspice 47 warns and uses −10⁻¹² Ω, where native ngspice 47 prints nothing. P24c in
  explanations.md is new: native ngspice 47 and 42 keep exactly 1e-12 Ω and −1e-12 Ω without a word, and one part
  in a million closer to 0 (±0.999999e-12 Ω) ngspice 47 warns and uses ±1e-12 Ω, where ngspice 42 keeps the value
  silently. Tests: `tests/unit/spice-explain.test.ts` (−1e-12 gets P14's note and 1e-12 no note of a tiny value;
  ±0.999999e-12 get theirs) and `tests/golden/facts-explain.test.ts` (P24c's run: no warning for R1 and R2, and
  neither the Checks, the Numbers panel nor Explain calls them too small, where each does for R3 and R4). Both
  fail with `<=`; the golden one also fails if the zero-ohm check's edge moves the same way.
- **P14 says which negative resistance** (C1-3). Its heading said "A negative resistance is accepted without a
  message", which ngspice 47 does not do for one closer to 0 than 1e-12 Ω: it warns and uses −1e-12 Ω (zero-ohm-7,
  re-run in native 47 and 42 with P14's own netlist). The heading now says "such as −2 Ω", and a sentence says that
  one closer to 0 is the exception, as the introduction of explanations.md and Explain's notes do; P14's netlist,
  runs and golden row are unchanged. Test: `tests/unit/facts-records.test.ts` (fails on 3e61833).
