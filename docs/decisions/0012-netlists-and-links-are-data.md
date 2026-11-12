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
  check (before, `.tran 0.1m 0<zero-width space>.5` got "The step is longer than the whole run" and a fix
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
  -53); a number read short there runs on without a message (-51). Their subjects say what they are ("A
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
