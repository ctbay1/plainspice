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

  The budget at the format's limits (2000 drawing lines, 20,000 grid units and points, 60 parts
  drawn, a 32,000-character link, or saved work as large), as the page's longest task on a computer
  and on a Pixel 7 slowed four times:
  - opening: up to about 0.6 s on a computer, and up to about two and a half seconds on the slowed
    phone, four for the heaviest drawings (30 kB of wire, the 100 × 100 grid kept as saved work, 60
    parts in one square turned every way: 2.5 to 3.7 s; a build of each is 0.25 to 0.7 s of CPU in
    Node, where a pile of parts, names or ground symbols at one point is about 0.2 s);
  - a hover, a selection or the focus ring: no long task (only the highlights are drawn again); a
    click on a part with its card placed: up to about 0.1 s, and a tap 0.17 s on the phone;
  - a key typed on a card (one build) or an edit (move, turn, mirror, wire, delete, rename,
    disconnect, a name moved, undo: two to four builds): up to about 0.45 s on a computer and 1.4 s
    on the slowed phone, and up to 0.55 s and 2.4 s on the heaviest drawings of wire.
  The tests count the work, so they hold on any machine (decision 0013 lists them).

  Measured on 13 November on the shared machine, this build first and the build re-checked (b060bc8)
  in brackets; the load was 1 to 4 for this build (7.5 for the long names) and 2 to 10 for the other,
  and the builds' CPU time in Node, best of three at load 5, depends little on it:
  - the 542-character link: on a computer opening 0.27 s (0.97 s), a key 0.18 s (0.91 s, then
    0.76 s: two builds), Delete 0.09 s (0.25 s), Undo no long task (0.90 s); on the slowed Pixel 7,
    opening 1.44 s (4.10 s) and a key 0.60 s (3.63 s, then 3.08 s); a build 0.20 s of CPU (1.53 s);
  - the 1007-character link with 1900 names: opening 0.29 s (33.8 s), a key 0.20 s (36.2 s, then
    33.6 s), Undo no long task (34.2 s); on the phone, opening 1.6 s (164 s, the re-check's); a
    build 0.17 s (40.2 s); the same names over one square, 1900 ground symbols at the point, every
    part in one square: builds of 0.25 s, 0.13 s and 0.26 s (53.6 s, 10.0 s and 1.52 s), opening
    0.31 to 0.52 s and a key 0.24 to 0.44 s, on the phone opening 1.6 to 3.7 s and a key 0.75 to
    1.3 s;
  - the 861-character link, 60 parts at one point with 500-character node names (load 7.5 to 10):
    a build 0.18 s (1.22 s); opening 0.62 s (1.52 s), a key 0.38 s (1.13 s, then 0.89 s); on the
    phone opening 2.5 s (6.0 s) and a key 1.1 s (4.05 s, then 3.34 s);
  - the slanted lattice (30 kB): opening 0.43 s (1.01 s), a hover no long task and 30 ms of CPU
    (0.49 s), a click 0.06 s (0.95 s), a key 0.28 s (0.80 s), Escape 0.06 s (0.61 s), Delete 0.19 s
    (0.77 s), Undo 0.31 s (1.01 s); on the phone, opening 1.86 s (3.67 s), a tap 0.12 s (2.43 s), a
    key 0.97 s (3.21 s); with a trap on R1 (its red-pen note), opening 0.56 s (1.66 s) and on the
    phone 1.94 s (6.31 s), a tap 0.17 s (2.32 s) and a key 1.38 s (4.23 s);
  - a red-pen note next to R1 on a drawing that reaches ±2000, the whole drawing in view: 2 ms of
    CPU in Node (1.7 s, every place along the paper made and sorted);
  - the heaviest drawings of wire, already linear: the first critic's 31 kB wave opens in 0.59 s
    (0.66 s), takes a key in 0.39 s (0.53 s, then 0.39 s) and Delete in 0.55 s (0.77 s); on the
    phone it opens in 2.5 s (2.7 s) and takes a key in 2.35 s, in one task now (1.69 s, then
    1.43 s); the 100 × 100 grid kept as saved work (122 kB) opens in 0.61 s (0.75 s at load 7) and
    takes a click in 0.07 s (0.78 s) and a key in 0.35 s (0.45 s, then 0.49 s), on the phone 3.0 s
    (3.1 s) and a key in 1.8 s (1.84 s, then 1.97 s); builds of 0.69 s and 0.62 s (0.78 s and
    0.80 s).

  The first value typed on a card does not write the repaired drawing lines when they differ from the
  lines in the text (the 60 parts at one point, say), though later visits would then build faster
  (27 ms instead of 190 ms here). The card's rule stays the one decision 0016 gives: a value changes
  only the value, unless the new value would move a part. Writing them would rewrite 60 lines of the
  student's text for one key, and drop the lines kept for parts not in the netlist yet, which only a
  change made in the drawing drops; and once each build is bounded, a visit costs a build like the
  one that opened the link.
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
